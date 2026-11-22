// @ts-nocheck -- strict indexed-access checks relaxed for genealogy graph code
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, ReactFlowProvider, MiniMap, Background, BackgroundVariant, useReactFlow, type Node, type Edge, type Viewport } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { derive, ancestorsOf, descendantsOf, findPath } from "@/lib/genealogy/derive";
import { computeLayout, CARD_H, CARD_W } from "@/lib/genealogy/layout";
import { loadDataset, saveDataset, seedDataset } from "@/lib/genealogy/store";
import type { Dataset } from "@/lib/genealogy/types";
import { APP_CONFIG, viewportKeyFor } from "@/lib/app-config";
import { nodeTypes, BRANCH_LABEL_W, BRANCH_LABEL_H, GEN_LABEL_H, type PersonNodeData } from "./nodes";
import { PersonPanel } from "./PersonPanel";
import { Toolbar } from "./Toolbar";

const PALETTE = ["var(--branch-1)", "var(--branch-2)", "var(--branch-3)", "var(--branch-4)"];
const VP_KEY = viewportKeyFor(APP_CONFIG.id);
type Mode = { kind: "none" } | { kind: "anc" | "desc" | "root" | "path"; ids: string[]; label: string };

export default function AtlasApp() {
  const [ds, setDs] = useState<Dataset | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        let d = await loadDataset();
        if (!d) { d = await seedDataset(); await saveDataset(d); }
        setDs(d);
      } catch (e) { setErr(String(e)); }
    })();
  }, []);
  if (err) return <div className="grid h-screen place-items-center text-destructive">No se pudieron cargar los datos: {err}</div>;
  if (!ds) return <div className="grid h-screen place-items-center font-serif text-2xl text-gold">Desplegando el atlas…</div>;
  return <ReactFlowProvider><Atlas ds={ds} setDs={async (n) => { await saveDataset(n); setDs(n); }} /></ReactFlowProvider>;
}

function Atlas({ ds, setDs }: { ds: Dataset; setDs: (d: Dataset) => Promise<void> }) {
  const rf = useReactFlow();
  const d = useMemo(() => derive(ds), [ds]);
  const layout = useMemo(() => computeLayout(d, ds.meta.root), [d, ds.meta.root]);
  const [selected, setSelected] = useState<string | null>(null);
  const [selApp, setSelApp] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "none" });
  const [pathFrom, setPathFrom] = useState<string | null>(null);
  // Keep all records in Atlas, but show only the component connected to the
  // selected central person at first. The branch filter can reveal the rest.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(["Sin conexión"]));
  const [zoomLvl, setZoomLvl] = useState<"far" | "mid" | "near">("mid");
  const flagged = useMemo(() => { const s = new Set<string>(); for (const i of d.issues) if (i.severity !== "info") i.ids.forEach((x) => s.add(x)); return s; }, [d]);

  const appBranch = useMemo(() => {
    const m = new Map<string, string>(); const byKey = new Map(layout.apps.map((a) => [a.key, a]));
    for (const a of layout.apps) {
      if (a.group === "pending") { m.set(a.key, d.connected.has(a.personId) ? "Conexión lateral" : "Sin conexión"); continue; }
      if (a.depth === 0) { m.set(a.key, "Central"); continue; }
      if (a.depth === 1) { m.set(a.key, "Padres"); continue; }
      let x = a; while (x.depth > 2) x = byKey.get(x.childKey!)!;
      m.set(a.key, d.branches.get(x.personId)?.[0] ?? "Sin conexión");
    }
    return m;
  }, [layout, d]);
  const branchList = useMemo(() => [...new Set(appBranch.values())].filter((b) => b !== "Central" && b !== "Padres"), [appBranch]);
  const BRANCH_COLORS = useMemo(() => {
    const m: Record<string, string> = { Central: "var(--gold)", Padres: "var(--gold)" };
    branchList.filter((b) => b !== "Sin conexión").forEach((b, i) => { m[b] = PALETTE[i % PALETTE.length]; });
    return m;
  }, [branchList]);

  const hl = useMemo(() => new Set(mode.kind === "none" ? [] : mode.ids), [mode]);
  const baseNodes = useMemo<Node[]>(() => {
    const n: Node[] = layout.apps.map((a) => ({
      id: a.key, type: "person", position: { x: a.x, y: a.y - CARD_H / 2 }, draggable: false, connectable: false,
      data: { p: d.byId.get(a.personId)!, gen: a.gen, isRef: a.isRef, branch: appBranch.get(a.key)!, flagged: flagged.has(a.personId), color: BRANCH_COLORS[appBranch.get(a.key)!] } satisfies PersonNodeData,
    }));
    for (const u of layout.unions) n.push({ id: u.key, type: "union", position: { x: u.x - 4, y: u.y - 4 }, draggable: false, selectable: false, data: {} });
    const top = layout.bounds.minY;
    for (const c of layout.columns) n.push({ id: `g${c.gen}`, type: "glabel", position: { x: c.x, y: top - GEN_LABEL_H - 80 },
      width: CARD_W, height: GEN_LABEL_H, draggable: false, selectable: false, data: { gen: c.gen, count: c.count } });
    for (const a of layout.apps) if (a.depth === 2 && a.group === "main") {
      const b = appBranch.get(a.key)!;
      n.push({ id: `b${a.key}`, type: "blabel", position: { x: layout.bounds.minX - BRANCH_LABEL_W - 180, y: a.y - BRANCH_LABEL_H / 2 },
        width: BRANCH_LABEL_W, height: BRANCH_LABEL_H, draggable: false, selectable: false,
        data: { label: b, color: BRANCH_COLORS[b] ?? "var(--branch-other)" } });
    }
    return n;
  }, [layout, d, appBranch, flagged, BRANCH_COLORS]);
  const baseEdges = useMemo<Edge[]>(() => {
    const e: Edge[] = [];
    for (const u of layout.unions) {
      e.push({ id: `e${u.key}`, source: u.childKey, target: u.key, type: "smoothstep", selectable: false, focusable: false });
      for (const p of u.parentKeys) e.push({ id: `e${u.key}-${p}`, source: u.key, target: p, type: "step", selectable: false, focusable: false });
    }
    return e;
  }, [layout]);
  const appPerson = useMemo(() => new Map(layout.apps.map((a) => [a.key, a.personId])), [layout]);
  const unionByKey = useMemo(() => new Map(layout.unions.map((u) => [u.key, u])), [layout]);
  const nodes = useMemo(() => baseNodes.flatMap((n) => {
    if (n.type !== "person") {
      if (n.type === "blabel") return hidden.has(n.data.label) ? [] : [n];
      if (n.type === "union") { const u = unionByKey.get(n.id); return u && (hidden.has(appBranch.get(u.childKey)!) || u.parentKeys.some((k) => hidden.has(appBranch.get(k)!))) ? [] : [n]; }
      return [n];
    }
    if (hidden.has(appBranch.get(n.id)!)) return [];
    const pid = appPerson.get(n.id)!;
    const cls = [hl.has(pid) ? "hl" : "", selApp === n.id || (selected === pid && !selApp) ? "sel" : selected === pid ? "hl" : ""].join(" ").trim();
    return [cls ? { ...n, className: cls } : n];
  }), [baseNodes, hl, selected, selApp, hidden, appBranch, appPerson, unionByKey]);
  const visibleNodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);
  const edges = useMemo(() => {
    const visibleEdges = baseEdges.filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target));
    if (!hl.size) return visibleEdges;
    return visibleEdges.map((e) => {
      const s = appPerson.get(e.source) ?? null, t = appPerson.get(e.target) ?? null;
      const ok = (x: string | null, key: string) => (x ? hl.has(x) : (() => { const u = unionByKey.get(key); return !!u && hl.has(appPerson.get(u.childKey)!) && u.parentKeys.some((k) => hl.has(appPerson.get(k)!)); })());
      return ok(s, e.source) && ok(t, e.target) ? { ...e, className: "hl" } : e;
    });
  }, [baseEdges, visibleNodeIds, hl, appPerson, unionByKey]);

  const goTo = useCallback((pid: string, appKey?: string) => {
    const apps = layout.byPerson.get(pid); if (!apps?.length) return;
    const a = (appKey && apps.find((x) => x.key === appKey)) || apps.find((x) => !x.isRef) || apps[0];
    const branch = appBranch.get(a.key);
    if (branch && hidden.has(branch)) setHidden(new Set([...hidden].filter((value) => value !== branch)));
    setSelected(pid); setSelApp(a.key);
    rf.setCenter(a.x + CARD_W / 2, a.y, { zoom: Math.max(rf.getZoom(), 0.9), duration: 900 });
  }, [layout, rf, appBranch, hidden]);
  const fitAll = useCallback(() => rf.fitView({ duration: 900, padding: { top: "140px", bottom: "24px", left: "24px", right: "24px" }, minZoom: 0.005 }), [rf]);
  const goRoot = useCallback(() => goTo(ds.meta.root), [goTo, ds.meta.root]);
  const prevRoot = useRef(ds.meta.root);
  useEffect(() => {
    if (prevRoot.current === ds.meta.root) return;
    prevRoot.current = ds.meta.root;
    if (ds.meta.root) setTimeout(() => goTo(ds.meta.root), 50);
  }, [ds.meta.root, goTo]);
  const goGen = useCallback((g: number) => {
    const c = layout.columns.find((c) => c.gen === g); if (!c) return;
    rf.fitBounds({ x: c.x - 40, y: c.minY - 400, width: CARD_W + 80, height: c.maxY - c.minY + 800 }, { duration: 900, padding: 0.05 });
  }, [layout, rf]);

  const initialVp = useRef<Viewport | null>((() => { try { return JSON.parse(sessionStorage.getItem(VP_KEY) ?? "null"); } catch { return null; } })());
  const onInit = useCallback(() => {
    const roots = layout.byPerson.get(ds.meta.root);
    const root = roots?.find((a) => !a.isRef) ?? roots?.[0];
    const centerRoot = () => { if (root) rf.setCenter(root.x + CARD_W / 2, root.y, { zoom: 0.75 }); };
    if (!initialVp.current) { centerRoot(); return; }
    void rf.setViewport(initialVp.current).then(() => {
      // A saved view can point at a disconnected branch, which is hidden again
      // on startup. Recover to the central person only when the viewport would
      // otherwise show no person cards at all.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!document.querySelector(".react-flow__node-person")) centerRoot();
      }));
    });
  }, [rf, layout, ds.meta.root]);
  const onMove = useCallback((_: unknown, vp: Viewport) => {
    const lvl = vp.zoom < 0.22 ? "far" : vp.zoom < 0.6 ? "mid" : "near";
    setZoomLvl((o) => (o === lvl ? o : lvl));
  }, []);

  const actions = {
    anc: (id: string) => setMode({ kind: "anc", ids: [id, ...ancestorsOf(d, id)], label: `Ascendencia de ${d.byId.get(id)!.name}` }),
    desc: (id: string) => setMode({ kind: "desc", ids: [id, ...descendantsOf(d, id)], label: `Descendencia de ${d.byId.get(id)!.name}` }),
    toRoot: (id: string) => {
      const p = findPath(d, id, ds.meta.root);
      if (!p) return toast.error("No existe una ruta demostrable hasta la persona central.");
      setMode({ kind: "root", ids: p, label: `Ruta hasta la persona central (${p.length - 1} vínculos)` });
    },
    rootId: ds.meta.root,
    setRoot: async (id: string) => { await setDs({ ...ds, meta: { ...ds.meta, root: id } }); setMode({ kind: "none" }); toast.success(`${d.byId.get(id)!.name} es ahora la persona central.`); },
    path: (a: string, b: string) => {
      const p = findPath(d, a, b);
      if (!p) { toast.error("No existe una ruta demostrable entre estas dos personas en los datos."); return null; }
      setMode({ kind: "path", ids: p, label: `Ruta: ${d.byId.get(a)!.name} → ${d.byId.get(b)!.name}` }); return p;
    },
  };

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-canvas" data-testid="atlas-canvas" data-zoom={zoomLvl}>
      <ReactFlow
        className={`atlas-flow${hl.size ? " dimmed" : ""}`}
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onInit={onInit} onMove={onMove}
        onMoveEnd={(_, vp) => sessionStorage.setItem(VP_KEY, JSON.stringify(vp))}
        onNodeClick={(_, n) => { if (n.type === "person") { setSelected(appPerson.get(n.id)!); setSelApp(n.id); } }}
        onPaneClick={() => setSelApp(null)}
        minZoom={0.005} maxZoom={2.5} onlyRenderVisibleElements nodesDraggable={false} nodesConnectable={false}
        elementsSelectable={false} zoomOnDoubleClick proOptions={{ hideAttribution: true }} panOnScroll={false}
        panOnDrag zoomOnPinch
      >
        <Background variant={BackgroundVariant.Dots} gap={40} size={1.2} color="var(--canvas-dot)" />
        <MiniMap pannable zoomable className="!hidden md:!block" nodeColor={(n) => n.type === "person" ? ((n.className ?? "").includes("hl") || (n.className ?? "").includes("sel") ? "var(--gold)" : BRANCH_COLORS[(n.data as PersonNodeData).branch] ?? "var(--branch-other)") : "transparent"} maskColor="oklch(0.13 0.025 260 / 0.7)" />
      </ReactFlow>
      <Toolbar ds={ds} d={d} layout={layout} branchList={branchList} hidden={hidden} setHidden={setHidden}
        goTo={goTo} goRoot={goRoot} fitAll={fitAll} goGen={goGen} mode={mode} clearMode={() => setMode({ kind: "none" })}
        setDs={setDs} selected={selected} />
      {ds.persons.length === 0 && <EmptyState onImport={() => document.getElementById("atlas-import-input")?.click()} />}
      {selected && d.byId.has(selected) && (
        <PersonPanel d={d} id={selected} appCount={layout.byPerson.get(selected)?.length ?? 0} onClose={() => { setSelected(null); setSelApp(null); }}
          goTo={goTo} actions={actions} pathFrom={pathFrom} setPathFrom={setPathFrom} />
      )}
    </div>
  );
}

function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] grid place-items-center p-6">
      <div className="pointer-events-auto max-w-lg rounded-lg border border-border bg-card/95 p-8 text-center shadow-2xl backdrop-blur">
        <div className="font-serif text-3xl font-semibold text-gold">Un atlas por escribir</div>
        <p className="mt-3 text-sm text-muted-foreground">Esta plantilla no contiene personas. Importa un archivo JSON, CSV o Excel con identificadores y vínculos de padre y madre; después abre cualquier ficha y pulsa «Fijar como persona central» para reorganizar el árbol.</p>
        <Button className="mt-6" onClick={onImport}><Upload className="mr-2 h-4 w-4" />Importar datos</Button>
        <p className="mt-4 text-xs text-muted-foreground">Los datos quedan guardados solo en este dispositivo y navegador. iPhone y Windows no se sincronizan. Borrar los datos del navegador puede eliminar tu árbol; descarga y conserva copias JSON.</p>
      </div>
    </div>
  );
}
