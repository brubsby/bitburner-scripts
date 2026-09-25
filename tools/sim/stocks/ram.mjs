// Static RAM of the stock scripts, from the game's own calculator
// (tools/test/ram.mjs), against the pre-rewrite stock.js from git.
//
//   node tools/sim/stocks/ram.mjs
// CALIBRATION: the calculator itself is calibrated against the live game by
// tools/test/ram.mjs (printed there); this only prices three files with it.

import { execFileSync } from "node:child_process";
import fs from "node:fs";

const m = await import("../../test/ram.mjs");
await m.load();
m.asSave({ bitNode: 8, sf: { 4: 1 } });
const price = (code, name) => m.priceCode(code, name);
let old = null;
try {
  old = execFileSync("git", ["show", "ee29130:stock.js"], { cwd: m.REPO, encoding: "utf8" });
} catch {
  /* no history */
}
for (const [label, code, name] of [
  ["stock.js (before, ee29130)", old, "stock.js"],
  ["stock.js", fs.readFileSync(`${m.REPO}/stock.js`, "utf8"), "stock.js"],
]) {
  if (!code) continue;
  const r = price(code, name);
  console.log(`${label.padEnd(28)} ${r?.cost ?? JSON.stringify(r)} GB`);
  if (r?.entries) console.log("   " + r.entries.filter((e) => e.cost > 0).map((e) => `${e.name} ${e.cost}`).join(", "));
}
process.exit(0);
