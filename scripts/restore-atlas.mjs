import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const sourcePath = new URL("../src/data/atlas.json.gz", import.meta.url);
const atlasPath = new URL("../src/data/atlas.json", import.meta.url);

if (!existsSync(atlasPath)) {
  if (!existsSync(sourcePath)) {
    throw new Error("Falta src/data/atlas.json.gz.");
  }
  writeFileSync(atlasPath, gunzipSync(readFileSync(sourcePath)));
}

const atlas = JSON.parse(readFileSync(atlasPath, "utf8"));
const expected = { persons: 3962, links: 6364, unions: 1770 };
for (const [key, count] of Object.entries(expected)) {
  if (!Array.isArray(atlas[key]) || atlas[key].length !== count) {
    throw new Error(`El Atlas restaurado no coincide en ${key}.`);
  }
}

console.log("Atlas verificado: 3962 personas, 6364 vínculos parentales, 1770 uniones.");
