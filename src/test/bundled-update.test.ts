import { describe, expect, it } from "vitest";
import { prepareBundledUpdate } from "@/lib/genealogy/store";
import type { Dataset } from "@/lib/genealogy/types";

const person = (id: string, name: string) => ({
  id, fsId: id, name, altNames: [], sex: "" as const, birth: "", death: "", marriage: "", baptism: "", burial: "",
  birthPlace: "", deathPlace: "", marriagePlace: "", notes: [], sources: [], originals: [],
});

const dataset = (people: ReturnType<typeof person>[], marker?: string): Dataset => ({
  meta: { root: "I1", sources: [], ...(marker ? { appliedUpdates: [marker] } : {}) },
  persons: people, links: [], pendingRefs: [], issues: [], unions: [],
});

describe("actualizaciones incluidas del Atlas", () => {
  it("fusiona registros nuevos sin reemplazar personas del usuario y solicita respaldo", () => {
    const current = dataset([person("I1", "Ricardo"), person("P1", "Persona editada")]);
    current.persons.find((p) => p.id === "P1")!.notes.push("Nota local que debe conservarse");
    const bundled = dataset([person("I1", "Ricardo"), person("P1", "Persona fuente"), person("P2", "Antepasado")], "rama:v1");
    bundled.links.push({ child: "P1", parent: "P2", role: "", sources: ["rama"] });
    current.unions = [{ a: "P1", b: "I1", marriage: "1384", sources: ["local"] }];
    bundled.unions = [{ a: "P1", b: "I1", marriage: "2 de julio de 1384", sources: ["rama"], originalRecords: [{ source: "rama", record: { marriage: "2 de julio de 1384" } }] }];

    const result = prepareBundledUpdate(current, bundled);
    expect(result.backupKey).toContain("rama:v1");
    expect(result.dataset.persons.map((p) => p.id)).toEqual(["I1", "P1", "P2"]);
    expect(result.dataset.persons.find((p) => p.id === "P1")!.name).toBe("Persona editada");
    expect(result.dataset.persons.find((p) => p.id === "P1")!.notes).toContain("Nota local que debe conservarse");
    expect(result.dataset.links).toHaveLength(1);
    expect(result.dataset.unions?.[0]?.marriage).toBe("1384");
    expect(result.dataset.unions?.[0]?.originalRecords?.[0]?.record).toEqual({ marriage: "2 de julio de 1384" });
    expect(prepareBundledUpdate(result.dataset, bundled).backupKey).toBeNull();
  });
});

