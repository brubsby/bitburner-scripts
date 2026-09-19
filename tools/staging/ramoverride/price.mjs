// Four-regime price table for a set of scripts, root or staged.
//
//   node tools/staging/ramoverride/price.mjs                 # the candidates, as shipped
//   node tools/staging/ramoverride/price.mjs --staged        # the staged rewrites too
//   node tools/staging/ramoverride/price.mjs --entries faction.js
//
// Uses the game's own Script/RamCalculations.ts through tools/test/ram.mjs,
// which is calibrated to 0.00% against the live game's calculateRam.

import fs from "node:fs";
import path from "node:path";
import { load, asSave, ramOf, priceOverlay, source, REPO } from "../../test/ram.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);

export const REGIMES = [
  { id: "BN4", bitNode: 4, sf: {} },
  { id: "BN1/noSF", bitNode: 1, sf: {} },
  { id: "BN1/SF4.1", bitNode: 1, sf: { 4: 1 } },
  { id: "BN14/SF14.1", bitNode: 14, sf: { 14: 1 } },
];

export const CANDIDATES = [
  "progress.js",
  "sleeve.js",
  "faction.js",
  "crime.js",
  "bladeburner.js",
  "training.js",
  "createProgram.js",
  "healer.js",
];

await load();

const argv = process.argv.slice(2);
const wantStaged = argv.includes("--staged");
const entriesFor = argv.includes("--entries") ? argv[argv.indexOf("--entries") + 1] : null;

function stagedCode(name) {
  const p = path.join(HERE, name);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

/** Every staged .js as an overlay, so a staged script importing another staged
 *  module (ramgrow.js) resolves against the staged copy. Pricing against a
 *  partial overlay prices a DIFFERENT import graph than the one that ships. */
const STAGED = Object.fromEntries(
  fs.readdirSync(HERE).filter((f) => f.endsWith(".js")).map((f) => [f, fs.readFileSync(path.join(HERE, f), "utf8")]),
);

function row(name, code) {
  const cells = [];
  for (const r of REGIMES) {
    asSave(r);
    const v = code == null ? ramOf(name) : priceOverlay({ ...STAGED, [name]: code }, name);
    cells.push(v.error ? `ERR(${v.error.slice(0, 22)})` : v.cost.toFixed(2));
  }
  return cells;
}

if (entriesFor) {
  asSave(REGIMES[0]);
  const code = wantStaged ? stagedCode(entriesFor) : null;
  const r = code == null ? ramOf(entriesFor) : priceOverlay({ ...STAGED, [entriesFor]: code }, entriesFor);
  console.log(`${entriesFor} in BN4: ${r.error ?? r.cost}`);
  for (const e of (r.entries ?? []).sort((a, b) => b.cost - a.cost)) console.log(`  ${String(e.cost).padStart(7)}  ${e.type.padEnd(10)} ${e.name}`);
  process.exit(0);
}

const names = argv.filter((a) => a.endsWith(".js"));
const list = names.length ? names : CANDIDATES;

console.log(`${"script".padEnd(20)} ${REGIMES.map((r) => r.id.padStart(12)).join("")}`);
for (const n of list) {
  console.log(`${n.padEnd(20)} ${row(n, null).map((c) => c.padStart(12)).join("")}   (as shipped)`);
  if (wantStaged) {
    const code = stagedCode(n);
    if (code) console.log(`${"".padEnd(20)} ${row(n, code).map((c) => c.padStart(12)).join("")}   (staged)`);
  }
}
