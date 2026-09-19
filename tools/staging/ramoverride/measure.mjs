// Measure the two constants every staged RAISE_CEILING is built from, with the
// game's own RAM calculator. Writes ceilings.json, which stage.mjs reads.
//
//   node tools/staging/ramoverride/stage.mjs     # emit with the current ceilings
//   node tools/staging/ramoverride/measure.mjs   # re-measure from what was emitted
//   node tools/staging/ramoverride/stage.mjs     # emit again with the real numbers
//
// The ceiling is `nonSing + singBase * mult`. Only the ns.singularity namespace
// is scaled by Source-File 4 level (RamCostGenerator.ts:82-96 wraps exactly that
// namespace in SF4Cost), so pricing the same file at mult=1 and mult=16 gives
// two equations in two unknowns:
//
//   full(1)  = nonSing + 1*singBase
//   full(16) = nonSing + 16*singBase
//
// Hand-computing these from an entry table is how an off-by-one identifier cost
// slips in: the first draft of ramgrow.js exported a function called `grow`,
// which the checker prices at 0.15GB by NAME (ns.grow, invariant B1), and the
// arithmetic looked fine. Solving from two measurements cannot miss that.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load, asSave, priceOverlay } from "../../test/ram.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

await load();

const files = fs.readdirSync(HERE).filter((f) => f.endsWith(".js"));
const overlay = {};
for (const f of files) overlay[f] = fs.readFileSync(path.join(HERE, f), "utf8");

const out = {};
for (const f of files) {
  if (!/ns\.ramOverride\(/.test(overlay[f])) continue;
  // Strip the declaration so the calculator reports the FULL price.
  const scratch = { ...overlay, [f]: overlay[f].replace(/ns\.ramOverride\(\s*[\d.]+\s*\)\s*;?/, "") };

  asSave({ bitNode: 4, sf: {} });
  const full1 = priceOverlay(scratch, f);
  asSave({ bitNode: 1, sf: {} });
  const full16 = priceOverlay(scratch, f);
  if (full1.error || full16.error) {
    console.log(`${f.padEnd(20)} ERROR ${full1.error ?? full16.error}`);
    continue;
  }
  const singBase = Math.round(((full16.cost - full1.cost) / 15) * 100) / 100;
  const nonSing = Math.round((full1.cost - singBase) * 100) / 100;
  out[f] = { nonSing, singBase };
  console.log(`${f.padEnd(20)} full(1)=${full1.cost.toFixed(2)}  full(16)=${full16.cost.toFixed(2)}  ->  ${nonSing} + ${singBase}*mult`);
}

fs.writeFileSync(path.join(HERE, "ceilings.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`\nwrote ceilings.json (${Object.keys(out).length} files)`);
