import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
const compressed = new URL("../src/data/atlas.json.gz", import.meta.url);
const atlasPath = new URL("../src/data/atlas.json", import.meta.url);
if (!existsSync(atlasPath)) writeFileSync(atlasPath, gunzipSync(readFileSync(compressed)));
const atlas = JSON.parse(readFileSync(atlasPath, "utf8"));
const expected = { persons: 2926, links: 6364, unions: 724 };
for (const [key, count] of Object.entries(expected)) {
  if (!Array.isArray(atlas[key]) || atlas[key].length !== count) throw new Error(`Atlas mismatch in ${key}: expected ${count}, got ${atlas[key]?.length}`);
}
console.log("Atlas verified: 2926 persons, 6364 parental links, 724 unions.");
