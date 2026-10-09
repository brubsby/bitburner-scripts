// Builds tools/test/fixture-bn12-exitjump-1401.json from the records around
// the live BN12 install of 2026-10-09T14:01:56.769Z (22 augmentations, 12 of
// them NeuroFlux levels): the new life's 14:22:03Z exit inputs and plan
// (recorded by a one-minute copier of .telemetry/{plan,exitinputs}.txt —
// the 14:07Z pass that first fired EXIT JUMP was not archived), the install
// record, the lifetimes ledger, the pre-install player from history.jsonl
// (14:01:37Z) and the earnings ledger's multipliers, and the node's offers
// from the 14:26Z snapshots.
//
//   node tools/sim/exitjump/mkfix-bn12-1401.mjs <dir with exitinputs-142245.json, plan-142245.json>
//
// It builds a fixture and prices nothing: DO NOT DECIDE ANYTHING from it —
// attribute-bn12-1401.mjs and tools/test/exitjump1401.test.mjs carry the CHECKs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "..", "test", "fixture-bn12-exitjump-1401.json");
const REC = process.argv[2];
const TEL = process.argv[3] ?? path.join(process.env.HOME, "Repos/bitburner-scripts/.telemetry");
const j = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const ei = j(path.join(REC, "exitinputs-142245.json"));
const plan = j(path.join(REC, "plan-142245.json"));
const rd = (f) => j(path.join(TEL, f)).data;
const price = rd("snap-augprice.txt");
const cat = rd("snap-catalog.txt").augs;
const stats = rd("snap-augstats.txt").stats;
const rep = rd("snap-rep.txt");
const owned = rd("snap-owned.txt").owned;
const installLast = j(path.join(TEL, "install-last.txt"));
const ledger = j(path.join(TEL, "lifetimes.txt"));
const earnings = j(path.join(TEL, "earnings.txt"));
// The factions this node has joined (favor or reputation held).
const joined = new Set([...Object.entries(rep.favor), ...Object.entries(rep.rep)].filter(([, v]) => v > 0).map(([k]) => k));
const KEYS = ["hacking", "hacking_exp", "faction_rep", "hacking_money", "hacking_chance", "hacking_speed", "hacking_grow"];
const offers = [];
for (const [fac, augs] of Object.entries(cat)) {
  if (!joined.has(fac)) continue;
  for (const name of augs) offers.push({ name, faction: fac, baseCost: price.price[name], repReq: price.repReq[name], favor: rep.favor[fac] ?? 0, mults: Object.fromEntries(KEYS.map((k) => [k, stats[name]?.[k] ?? 1])) });
}
const batchGains = (() => {
  const prod = (ks) => installLast.batch.reduce((g, n) => ks.reduce((h, k) => h * (stats[n]?.[k] ?? 1), g), 1);
  return { hacking: prod(["hacking"]), rep: prod(["faction_rep"]), income: prod(["hacking_money", "hacking_chance", "hacking_speed"]), exp: prod(["hacking_exp"]) };
})();
// The pre-install player: history.jsonl's last row before the install.
const hist = fs.readFileSync(path.join(TEL, "history.jsonl"), "utf8").split("\n").filter((l) => l.includes('"at":"2026-10-09T14:01:'));
const preRow = hist.map((l) => JSON.parse(l)).filter((r) => r.at < installLast.at).pop();
const preLife = earnings.lives[String(installLast.lastAugReset)];
const postLife = earnings.lives[String(ei.lastAugReset)];
const fx = {
  why: "BN12 2026-10-09 14:01:56Z install: EXIT JUMP AT INSTALL — the install priced the next life at the purchase model's 48h-mean per-life gain; the new life prices it by its own batch",
  installLast: { at: installLast.at, lastAugReset: installLast.lastAugReset, exits: installLast.exits, batch: installLast.batch, carry: installLast.carry },
  exitJump: plan.exitJump,
  post: {
    at: ei.at,
    lastAugReset: ei.lastAugReset,
    inputs: ei.inputs,
    install: { key: plan.decisions.install.key, spec: plan.decisions.install.spec, pointH: plan.decisions.install.pointH, meanH: plan.decisions.install.meanH },
    hackMultRaw: postLife.inputs.mults.hacking,
    // The purchase step's plan at 14:27Z (the table's afterBatch: 3 augs, 2 NeuroFlux levels).
    planBatch: ["Magnetism Amplifier", "Embedded Netburner Module", "Hacknet Node Kernel Direct-Neural Interface"],
    planNfg: 2,
  },
  pre: {
    at: preRow.at,
    hacking: preRow.skills.hacking,
    hackingExp: preRow.exp.hacking,
    hackMultRaw: preLife.inputs.mults.hacking,
    expPerSec: installLast.carry.exp.perSec,
    batchGains,
    cadenceModel: ledger[ledger.length - 1].cadenceModel,
  },
  ledger,
  offers,
  owned,
  nfgOwned: 13,
};
fs.writeFileSync(OUT, JSON.stringify(fx));
console.log(`wrote ${OUT}: ${offers.length} offers, ${ledger.length} ledger lives, pre ${preRow.at} hacking ${preRow.skills.hacking}`);
