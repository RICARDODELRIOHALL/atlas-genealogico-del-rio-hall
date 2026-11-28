// @ts-nocheck -- strict indexed-access checks relaxed for genealogy graph code
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, ReactFlowProvider, MiniMap, Background, BackgroundVariant, useReactFlow, type Node, type Edge, type Viewport } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { derive, ancestorsOf, descendantsOf, findPath } from "@/lib/genealogy/derive";
import { computeLayout, CARD_H, CARD_W } from "@/lib/genealogy/layout";
import { loadDataset, prepareBundledUpdate, saveDataset, saveDatasetWithBackup, seedDataset } from "@/lib/genealogy/store";
import { merge as mergeDataset } from "@/lib/genealogy/importer";
import type { Dataset } from "@/lib/genealogy/types";
import { APP_CONFIG } from "@/lib/app-config";
import { nodeTypes, BRANCH_LABEL_W, BRANCH_LABEL_H, GEN_LABEL_H, type PersonNodeData } from "./nodes";
import { PersonPanel } from "./PersonPanel";
import { Toolbar } from "./Toolbar";

const PALETTE = ["var(--branch-1)", "var(--branch-2)", "var(--branch-3)", "var(--branch-4)"];
type Mode = { kind: "none" } | { kind: "anc" | "desc" | "root" | "path"; ids: string[]; label: string };

export default function AtlasApp() {
  const [ds, setDs] = useState<Dataset | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const module = await import("@/data/familysearch-branch-lhwp-97z2.json");
        const branch = structuredClone((module.default ?? module) as unknown as Dataset);
        const base = await seedDataset();
        const bundled = mergeDataset(base, branch, "familysearch-branch-lhwp-97z2", "FamilySearch · LHWP-6YX a 97Z2-2CB").ds;
        const archivePriorParentage = (dataset: Dataset) => {
          const childId = "FS:LTKH-4FN";
          const outdatedParentIds = new Set(["FS:LYWX-CBR", "FS:9CQX-DXX"]);
          const priorLinks = dataset.links.filter((link) => link.child === childId && outdatedParentIds.has(link.parent));
          if (!priorLinks.length) return false;
          const person = dataset.persons.find((candidate) => candidate.id === childId);
          if (!person) return false;
          dataset.links = dataset.links.filter((link) => !priorLinks.includes(link));
          for (const link of priorLinks) {
            const record = {
              type: "previously-published-parent-link",
              status: "preserved-as-provenance-not-active",
              reason: "La vista de parentesco consultada el 2026-11-25 muestra a Margaret of Brotherton como hija de Thomas of Brotherton y Alice de Hayles.",
              originalLink: structuredClone(link),
            };
            if (!person.originals.some((original) => JSON.stringify(original.record) === JSON.stringify(record))) {
              person.originals.push({ source: link.sources[0] ?? "familysearch-parentage-history", record });
            }
          }
          return true;
        };
        let d = await loadDataset();
        if (!d) {
          d = bundled;
          archivePriorParentage(d);
          await saveDataset(d);
        } else {
          const update = prepareBundledUpdate(d, bundled);
          d = update.dataset;
          const archived = archivePriorParentage(d);
          if (update.backupKey) await saveDatasetWithBackup(d, update.backupKey);
          else if (archived) await saveDatasetWithBackup(d, "backup:parentage-claim-before-familysearch-2026-11-25");
        }
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
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [zoomLvl, setZoomLvl] = useState<"far" | "mid" | "near">("mid");

  const appBranch = useMemo(() => {
    const m = new Map<string, string>(); const byKey = new Map(layout.apps.map((a) => [a.key, a]));
    for (const a of layout.apps) {
      if (a.group === "pending") { m.set(a.key, "Sin conexión"); continue; }
      if (a.depth === 0) { m.set(a.key, a.personId === ds.meta.root ? "Central" : "Hermanos"); continue; }
      if (a.depth === 1) { m.set(a.key, "Padres"); continue; }
      let x = a; while (x.depth > 2) x = byKey.get(x.childKey!)!;
      m.set(a.key, d.branches.get(x.personId)?.[0] ?? "Sin conexión");
    }
    return m;
  }, [layout, d, ds.meta.root]);
  const branchList = useMemo(() => [...new Set(appBranch.values())].filter((b) => b !== "Central" && b !== "Padres"), [appBranch]);
  const BRANCH_COLORS = useMemo(() => {
    const m: Record<string, string> = { Central: "var(--gold)", Padres: "var(--gold)" };
    branchList.filter((b) => b !== "Sin conexión").forEach((b, i) => { m[b] = PALETTE[i % PALETTE.length]; });
    return m;
  }, [branchList]);

  const uniqueApps = useMemo(() => {
    const byId = new Map<string, (typeof layout.apps)[number]>();
    for (const a of layout.apps) {
      const prior = byId.get(a.personId);
      if (!prior || (prior.isRef && !a.isRef)) byId.set(a.personId, a);
    }
    return [...byId.values()];
  }, [layout]);
  const canonicalByPerson = useMemo(() => new Map(uniqueApps.map((a) => [a.personId, a])), [uniqueApps]);
  const canonicalKeyByAppearance = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of layout.apps) m.set(a.key, canonicalByPerson.get(a.personId)!.key);
    return m;
  }, [layout, canonicalByPerson]);
  const canonicalByKey = useMemo(() => new Map(uniqueApps.map((a) => [a.key, a])), [uniqueApps]);
  const personBranches = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const a of layout.apps) {
      const set = m.get(a.personId) ?? new Set<string>();
      set.add(appBranch.get(a.key)!);
      m.set(a.personId, set);
    }
    return m;
  }, [layout, appBranch]);
  const displayUnions = useMemo(() => {
    const grouped = new Map<string, { key: string; childKeys: string[]; parentKeys: string[] }>();
    for (const union of layout.unions) {
      const parentKeys = [...new Set(union.parentKeys.map((key) => canonicalKeyByAppearance.get(key)).filter(Boolean))].sort();
      const childKeys = [...new Set(union.childKeys.map((key) => canonicalKeyByAppearance.get(key)).filter(Boolean))];
      if (!parentKeys.length || !childKeys.length) continue;
      const signature = parentKeys.join("|");
      const group = grouped.get(signature) ?? { key: `j${parentKeys.join("+")}`, parentKeys, childKeys: [] };
      for (const childKey of childKeys) if (!group.childKeys.includes(childKey)) group.childKeys.push(childKey);
      grouped.set(signature, group);
    }
    return [...grouped.values()].map((union) => {
      const parents = union.parentKeys.map((key) => canonicalByKey.get(key)!);
      const children = union.childKeys.map((key) => canonicalByKey.get(key)!);
      const childRight = children.reduce((sum, a) => sum + a.x + a.width, 0) / children.length;
      const parentLeft = parents.reduce((sum, a) => sum + a.x, 0) / parents.length;
      return { ...union, x: (childRight + parentLeft) / 2, y: parents.reduce((sum, a) => sum + a.y, 0) / parents.length };
    });
  }, [layout, canonicalKeyByAppearance, canonicalByKey]);
  const hl = useMemo(() => new Set(mode.kind === "none" ? [] : mode.ids), [mode]);
  const baseNodes = useMemo<Node[]>(() => {
    const n: Node[] = uniqueApps.map((a) => ({
      id: a.key, type: "person", position: { x: a.x, y: a.y - a.height / 2 }, width: a.width, height: a.height, draggable: false, connectable: false,
      data: { p: d.byId.get(a.personId)!, gen: a.gen, isRef: false, branch: appBranch.get(a.key)!, color: BRANCH_COLORS[appBranch.get(a.key)!] } satisfies PersonNodeData,
    }));
    for (const u of displayUnions) n.push({ id: u.key, type: "union", position: { x: u.x - 4, y: u.y - 4 }, draggable: false, selectable: false, data: {} });
    const top = layout.bounds.minY;
    for (const c of layout.columns) n.push({ id: `g${c.gen}`, type: "glabel", position: { x: c.x, y: top - GEN_LABEL_H - 80 },
      width: CARD_W, height: GEN_LABEL_H, draggable: false, selectable: false, data: { gen: c.gen, count: c.count } });
    for (const a of uniqueApps) if (a.depth === 2 && a.group === "main") {
      const b = appBranch.get(a.key)!;
      n.push({ id: `b${a.key}`, type: "blabel", position: { x: layout.bounds.minX - BRANCH_LABEL_W - 180, y: a.y - BRANCH_LABEL_H / 2 },
        width: BRANCH_LABEL_W, height: BRANCH_LABEL_H, draggable: false, selectable: false,
        data: { label: b, color: BRANCH_COLORS[b] ?? "var(--branch-other)" } });
    }
    return n;
  }, [layout, d, appBranch, BRANCH_COLORS, uniqueApps, displayUnions]);
  const baseEdges = useMemo<Edge[]>(() => {
    const e: Edge[] = [];
    for (const u of displayUnions) {
      for (const childKey of u.childKeys) e.push({ id: `e${u.key}-${childKey}`, source: childKey, target: u.key, type: "smoothstep", selectable: false, focusable: false });
      for (const p of u.parentKeys) e.push({ id: `e${u.key}-${p}`, source: u.key, target: p, type: "step", selectable: false, focusable: false });
    }
    return e;
  }, [displayUnions]);
  const appPerson = useMemo(() => new Map(uniqueApps.map((a) => [a.key, a.personId])), [uniqueApps]);
  const unionByKey = useMemo(() => new Map(displayUnions.map((u) => [u.key, u])), [displayUnions]);
  const isPersonHidden = (personId: string) => [...(personBranches.get(personId) ?? [])].every((branch) => hidden.has(branch));
  const nodes = useMemo(() => baseNodes.map((n) => {
    if (n.type !== "person") {
      if (n.type === "blabel") return { ...n, hidden: hidden.has(n.data.label) };
      if (n.type === "union") { const u = unionByKey.get(n.id); return u && u.childKeys.every((key) => isPersonHidden(appPerson.get(key)!)) && u.parentKeys.every((key) => isPersonHidden(appPerson.get(key)!)) ? { ...n, hidden: true } : n; }
      return n;
    }
    const pid = appPerson.get(n.id)!;
    const cls = [hl.has(pid) ? "hl" : "", selApp === n.id || (selected === pid && !selApp) ? "sel" : selected === pid ? "hl" : ""].join(" ").trim();
    const hide = isPersonHidden(pid);
    return cls || hide ? { ...n, className: cls, hidden: hide } : n;
  }), [baseNodes, hl, selected, selApp, hidden, appBranch, appPerson, unionByKey, personBranches]);
  const edges = useMemo(() => {
    if (!hl.size) return baseEdges;
    return baseEdges.map((e) => {
      const s = appPerson.get(e.source) ?? null, t = appPerson.get(e.target) ?? null;
      const ok = (x: string | null, key: string) => (x ? hl.has(x) : (() => { const u = unionByKey.get(key); return !!u && u.childKeys.some((childKey) => hl.has(appPerson.get(childKey)!)) && u.parentKeys.some((parentKey) => hl.has(appPerson.get(parentKey)!)); })());
      return ok(s, e.source) && ok(t, e.target) ? { ...e, className: "hl" } : e;
    });
  }, [baseEdges, hl, appPerson, unionByKey]);

  const goTo = useCallback((pid: string, appKey?: string) => {
    const a = canonicalByPerson.get(pid);
    if (!a) { if (d.byId.has(pid)) { setSelected(pid); setSelApp(null); } return; }
    setSelected(pid); setSelApp(a.key);
    rf.setCenter(a.x + a.width / 2, a.y, { zoom: Math.max(rf.getZoom(), 0.9), duration: 900 });
  }, [canonicalByPerson, rf, d]);
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

  const onInit = useCallback(() => {
    const r = layout.byPerson.get(ds.meta.root)?.[0];
    if (r) rf.setCenter(r.x + CARD_W / 2, r.y, { zoom: 0.75 });
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
    <div className="relative h-dvh w-full overflow-hidden bg-canvas" data-zoom={zoomLvl}>
      <ReactFlow
        className={`atlas-flow${hl.size ? " dimmed" : ""}`}
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onInit={onInit} onMove={onMove}
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
        <PersonPanel d={d} id={selected} appCount={1} onClose={() => { setSelected(null); setSelApp(null); }}
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

