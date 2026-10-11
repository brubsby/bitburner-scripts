// Builds tools/test/fixture-bn13-giftlife.json from one live BN13.1 pass
// (a copy of .telemetry taken 2026-10-11 ~02:46Z, after the 02:34:22Z
// install): the exit inputs, the plan record (posteriors, the life length,
// install and stanek decisions), the node's offers from the snapshots (as
// mkfix-bn13-lifegrowth.mjs), the lifetimes ledger and stanek.js's record
// (the placed layout and the fleet the charger is placed on).
//
//   node tools/sim/exitjump/mkfix-bn13-giftlife.mjs <dir>
//
// NOT CALIBRATED: it builds a fixture and prices nothing — tools/test/giftlife.test.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "..", "test", "fixture-bn13-giftlife.json");
const d = process.argv[2];
if (!d) throw new Error("usage: mkfix-bn13-giftlife.mjs <dir>");
const KEYS = ["hacking", "hacking_exp", "faction_rep", "hacking_money", "hacking_chance", "hacking_speed", "hacking_grow"];
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
const st = rd("stanek.txt");
const joined = new Set([...Object.entries(rep.favor), ...Object.entries(rep.rep)].filter(([, v]) => v > 0).map(([k]) => k));
const offers = [];
for (const [fac, augs] of Object.entries(cat)) {
  if (!joined.has(fac)) continue;
  for (const name of augs) offers.push({ name, faction: fac, baseCost: price.price[name], repReq: price.repReq[name], favor: rep.favor[fac] ?? 0, mults: Object.fromEntries(KEYS.map((k) => [k, stats[name]?.[k] ?? 1])) });
}
const pass = {
  at: ei.at,
  lastAugReset: ei.lastAugReset,
  node: ei.bitNode,
  inputs: ei.inputs,
  plan: { at: plan.at, lastAugReset: plan.lastAugReset, node: plan.node, exit: plan.exit, posteriors: plan.posteriors, decisions: { lifeLength: plan.decisions?.lifeLength ?? null, install: plan.decisions?.install ?? null, stanek: plan.decisions?.stanek ?? null } },
  offers,
  owned,
  ledger: JSON.parse(fs.readFileSync(path.join(d, "lifetimes.txt"), "utf8")),
  stanek: { node: st.node, lastAugReset: st.lastAugReset, layout: st.layout, fleet: st.fleet, charger: { gb: st.charger?.gb, threads: st.charger?.threads, H: st.charger?.H } },
};
fs.writeFileSync(OUT, JSON.stringify({ why: "BN13.1 2026-10-11 ~02:44Z: the life length decision priced every later-lives length L0.5..L24 on one gift factor (the measured rates), though the gift's charges clear at every install and regrow — a longer life spends more of itself at a higher charge", passes: [pass] }));
console.log(`wrote ${OUT}: ${pass.at} L${pass.inputs.cycleHours} ${offers.length} offers, fleet ${st.fleet?.gb}GB`);
