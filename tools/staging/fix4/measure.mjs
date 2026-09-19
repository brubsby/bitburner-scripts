// Re-derive RAISE_CEILING for the fix4 staging copies with the game's own RAM
// calculator, exactly as tools/staging/ramoverride/measure.mjs does for the
// already-staged set.
//
//   node tools/staging/fix4/measure.mjs
//
// The ceiling is `nonSing + singBase * mult`; only the ns.singularity namespace
// is scaled by Source-File 4 level (RamCostGenerator.ts:82-96), so pricing the
// same file at mult=1 (inside BN4) and mult=16 (BN1, no SF4) gives two
// equations in two unknowns. Solving from two MEASUREMENTS rather than adding
// up an entry table is what catches invariant B1 — a local whose bare name is
// in the ns cost tree.
//
// It also prints the price WITH the override in place (which must be exactly
// 2.6 in all four regimes, i.e. what R1/R2 assert) and the declared ceiling read
// out of the file, so a mismatch is visible here and not only in npm test.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load, asSave, priceOverlay } from "../../test/ram.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

await load();

const REGIMES = [
  { id: "BN4", bitNode: 4, sf: {}, mult: 1 },
  { id: "BN1/noSF", bitNode: 1, sf: {}, mult: 16 },
  { id: "BN1/SF4.1", bitNode: 1, sf: { 4: 1 }, mult: 16 },
  { id: "BN14/SF14.1", bitNode: 14, sf: { 14: 1 }, mult: 16 },
];

const files = fs.readdirSync(HERE).filter((f) => f.endsWith(".js"));
const overlay = {};
for (const f of files) overlay[f] = fs.readFileSync(path.join(HERE, f), "utf8");

let bad = 0;
for (const f of files) {
  if (!/ns\.ramOverride\(/.test(overlay[f])) continue;
  const stripped = { ...overlay, [f]: overlay[f].replace(/ns\.ramOverride\(\s*[\d.]+\s*\)\s*;?/, "") };

  asSave({ bitNode: 4, sf: {} });
  const full1 = priceOverlay(stripped, f);
  asSave({ bitNode: 1, sf: {} });
  const full16 = priceOverlay(stripped, f);
  if (full1.error || full16.error) {
    console.log(`${f.padEnd(18)} ERROR ${full1.error ?? full16.error}`);
    bad++;
    continue;
  }
  const singBase = Math.round(((full16.cost - full1.cost) / 15) * 100) / 100;
  const nonSing = Math.round((full1.cost - singBase) * 100) / 100;

  const m = /const\s+RAISE_CEILING\s*=\s*\(([A-Za-z_$][\w$]*)\)\s*=>\s*([^\n]+)/.exec(overlay[f]);
  const ceilingFn = m ? new Function(m[1], `return (${m[2].replace(/\s*\/\/.*$/, "").replace(/;\s*$/, "")})`) : null;

  console.log(
    `${f.padEnd(18)} full(1)=${full1.cost.toFixed(2).padStart(7)}  full(16)=${full16.cost.toFixed(2).padStart(8)}` +
      `  ->  measured ${nonSing} + ${singBase}*mult` +
      (ceilingFn ? `   declared ${ceilingFn(1)} / ${ceilingFn(16)}` : "   (no RAISE_CEILING found)"),
  );

  for (const r of REGIMES) {
    asSave(r);
    const withOverride = priceOverlay(overlay, f);
    const full = priceOverlay(stripped, f);
    const ceiling = ceilingFn ? ceilingFn(r.mult) : NaN;
    const okDeclared = !withOverride.error && Math.abs(withOverride.cost - 2.6) < 1e-9;
    const okCeiling = ceilingFn && ceiling + 1e-9 >= full.cost;
    if (!okDeclared || !okCeiling) bad++;
    console.log(
      `    ${r.id.padEnd(12)} declared-price ${String(withOverride.cost ?? withOverride.error).padStart(7)}` +
        ` ${okDeclared ? "ok " : "BAD"}   full ${full.cost.toFixed(2).padStart(8)}  ceiling ${String(ceiling).padStart(8)} ${okCeiling ? "ok" : "BAD"}`,
    );
  }
  asSave(REGIMES[0]);
}
console.log(bad ? `\n${bad} problem(s)` : "\nall clear");
process.exit(bad ? 1 : 0);
