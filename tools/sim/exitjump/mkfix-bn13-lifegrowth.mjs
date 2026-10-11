// Builds tools/test/fixture-bn13-lifegrowth.json from two live BN13.1 passes
// of 2026-10-11 (copies of .telemetry taken at 01:28Z and 01:43Z): each
// pass's exit inputs (/tel/exitinputs.txt) and plan record (posteriors, the
// life length and install decisions), the node's offers from that pass's
// snapshots (snap-catalog / augprice / augstats / rep / owned) and the
// lifetimes ledger.
//
// The passes: 01:28Z committed L0.5 (published exit mean 390.9h, the point
// unpriceable, after "switch L24 -> L0.5: 333h sooner (sd 1127h)"); 01:43Z
// committed L4 (mean 246.0h, after L0.5 -> L3 -> L4 switches, one of them a
// SWITCH ARTEFACT of 5257.6h). The cross-node cadence puts this node at
// ~0.06 ln(M)/h; the purchase model alone at 0.0027.
//
//   node tools/sim/exitjump/mkfix-bn13-lifegrowth.mjs <dir 01:28Z> <dir 01:43Z>
//
// NOT CALIBRATED: it builds a fixture and prices nothing (no decision is
// made from it) — tools/test/lifegrowth.test.mjs carries the CHECKs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "..", "test", "fixture-bn13-lifegrowth.json");
const dirs = process.argv.slice(2);
if (dirs.length < 1) throw new Error("usage: mkfix-bn13-lifegrowth.mjs <dir> [<dir> ...]");
const KEYS = ["hacking", "hacking_exp", "faction_rep", "hacking_money", "hacking_chance", "hacking_speed", "hacking_grow"];
const passes = dirs.map((d) => {
  const rd = (f) => {
    const j = JSON.parse(fs.readFileSync(path.join(d, f), "utf8"));
    return j.data ?? j;
  };
  const ei = rd("exitinputs.txt");
  const plan = rd("plan.txt");
  const price = rd("snap-augprice.txt");
  const cat = rd("snap-catalog.txt").augs;
  const stats = rd("snap-augstats.txt").stats;
  const rep = rd("snap-rep.txt");
  const owned = rd("snap-owned.txt").owned;
  const joined = new Set([...Object.entries(rep.favor), ...Object.entries(rep.rep)].filter(([, v]) => v > 0).map(([k]) => k));
  const offers = [];
  for (const [fac, augs] of Object.entries(cat)) {
    if (!joined.has(fac)) continue;
    for (const name of augs) offers.push({ name, faction: fac, baseCost: price.price[name], repReq: price.repReq[name], favor: rep.favor[fac] ?? 0, mults: Object.fromEntries(KEYS.map((k) => [k, stats[name]?.[k] ?? 1])) });
  }
  return {
    at: ei.at,
    lastAugReset: ei.lastAugReset,
    node: ei.bitNode,
    inputs: ei.inputs,
    plan: { at: plan.at, lastAugReset: plan.lastAugReset, node: plan.node, exit: plan.exit, posteriors: plan.posteriors, decisions: { lifeLength: plan.decisions?.lifeLength ?? null, install: plan.decisions?.install ?? null } },
    offers,
    owned,
    ledger: JSON.parse(fs.readFileSync(path.join(d, "lifetimes.txt"), "utf8")),
  };
});
fs.writeFileSync(OUT, JSON.stringify({ why: "BN13.1 2026-10-11: the purchase model held every later life at today's money (x1.0013 a 0.5h life) and the cadence posterior on it (0.0027/h x/÷ 21, no own life) — exits of 250-5500h, switches of 333h (sd 1127h) and a 5257.6h SWITCH ARTEFACT", passes }));
console.log(`wrote ${OUT}: ${passes.map((p) => `${p.at} L${p.inputs.cycleHours} ${p.offers.length} offers`).join("; ")}`);
