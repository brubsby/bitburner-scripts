// THE MEASURED DIFFERENCE: what progress.js's greedy buys versus what the
// planner buys, on the real catalogue, at the money and reputation this run
// will actually see.
//
//   node tools/staging/augplan/measure.mjs
//   node tools/staging/augplan/measure.mjs --money 1e10 --rep 2e5
//
// ---------------------------------------------------------------------------
// WHAT IS AND IS NOT CALIBRATED HERE, stated first because CLAUDE.md's rule is
// that silence reads as "checked and fine".
//
// NOT LIVE. On 2026-09-13 the save is BitNode 4 with Source-File 1 level 1 and
// nothing else. `ns.singularity` throws without SF4, so progress.js's whole
// purchasing path is dormant — and `state.json` shows `factions: []`, so even
// with SF4 there would be no offer set at all. **There is no live offer set to
// measure against, and inventing one would be the fabricated-validation failure
// this repo has already had twice.** So this is not "what the game would do
// right now"; it is "what the two algorithms do on the game's real catalogue".
//
// REAL: every baseCost, baseRepRequirement, multiplier set and faction listing
// comes out of ~/Repos/bitburner via fixture.json, and every price the planner
// computes from them is checked purchase-by-purchase against the game's own
// getAugCost in augplan.test.mjs [AP6] (worst error 2.8e-16).
//
// SWEPT, NOT ASSUMED: money and reputation. A single flattering operating point
// is how a comparison lies, so both are swept over four orders of magnitude and
// every row is printed, win or lose.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "./gameresolve.mjs";
const { planPurchases, greedyByPrice } = await import("./augplan.js");
const { RATE_CHANNELS } = await import("installgate.js");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixture.json");
if (!fs.existsSync(FIXTURE)) {
  console.error("fixture.json is missing — run `node tools/staging/augplan/fixture.mjs` first");
  process.exit(2);
}
const fixture = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : dflt;
};

/** progress.js:189-196 minus Daedalus, which this run is nowhere near joining. */
const FACTIONS = ["BitRunners", "The Black Hand", "NiteSec", "CyberSec", "Netburners"];

const offersAt = (rep, nfgLevel = 0) =>
  fixture.augmentations
    .filter((a) => a.factions.some((f) => FACTIONS.includes(f)))
    .map((a) => ({
      name: a.name,
      faction: a.factions.find((f) => FACTIONS.includes(f)),
      baseCost: a.baseCost,
      repReq: a.baseRepRequirement,
      factionRep: rep,
      mults: a.mults,
      prereqs: a.prereqs,
      isNFG: a.isNFG,
      isSoA: a.isSoA,
      nfgLevel,
    }));

const $ = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}b` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}m` : `$${n.toFixed(0)}`);

console.log(`augmentation planner vs progress.js greedy`);
console.log(`catalogue: bitburner v${fixture.gameVersion}, ${fixture.augmentations.length} augmentations`);
console.log(`factions:  ${FACTIONS.join(", ")}  (${offersAt(0).length} offers)`);
console.log(`channels:  ${RATE_CHANNELS.join(", ")}   (installgate.js RATE_CHANNELS)`);
console.log(`BitNode 4: AugmentationMoneyCost=${fixture.bn4.AugmentationMoneyCost}, AugmentationRepCost=${fixture.bn4.AugmentationRepCost}`);
console.log(`LIVE OFFER SET: none. The save has factions: [] and no Source-File 4, so nothing is purchasable today.`);
console.log();

const oneMoney = arg("money", null);
const oneRep = arg("rep", null);
const moneys = oneMoney ? [oneMoney] : [1e9, 1e10, 1e11, 1e12];
const reps = oneRep ? [oneRep] : [50e3, 200e3, 1e6];

const hdr = ["reputation", "money", "greedy M", "greedy $", "#", "planner M", "planner $", "#", "lnM/$ gain"];
console.log(hdr.map((h, i) => h.padStart([11, 8, 9, 10, 3, 10, 10, 3, 11][i])).join(" "));

let bestGain = 0;
let bestRow = null;
for (const rep of reps) {
  for (const money of moneys) {
    const offers = offersAt(rep);
    const g = greedyByPrice({ offers, money });
    const p = planPurchases({ offers, money });
    const per = (x) => (x.totalCost > 0 ? x.logM / x.totalCost : 0);
    const gain = per(g) > 0 ? per(p) / per(g) : Infinity;
    if (isFinite(gain) && gain > bestGain) {
      bestGain = gain;
      bestRow = { rep, money, g, p };
    }
    console.log(
      [
        `${(rep / 1e3).toFixed(0)}k`.padStart(11),
        $(money).padStart(8),
        g.M.toFixed(3).padStart(9),
        $(g.totalCost).padStart(10),
        String(g.buy.length).padStart(3),
        p.M.toFixed(3).padStart(10),
        $(p.totalCost).padStart(10),
        String(p.buy.length).padStart(3),
        (isFinite(gain) ? `${gain.toFixed(2)}x` : "inf").padStart(11),
      ].join(" "),
    );
  }
}

console.log();
console.log(`Largest gap: reputation ${(bestRow.rep / 1e3).toFixed(0)}k, budget ${$(bestRow.money)} — ${bestGain.toFixed(2)}x more log-multiplier per dollar.`);
console.log();

// ---- one scenario in full, because a table hides WHY -----------------------
const rep = oneRep ?? 200e3;
const money = oneMoney ?? 1e10;
const offers = offersAt(rep);
const g = greedyByPrice({ offers, money });
const p = planPurchases({ offers, money });

console.log(`--- worked example: ${$(money)}, ${(rep / 1e3).toFixed(0)}k reputation everywhere ---`);
console.log();
console.log(`GREEDY (progress.js:326-333, sort by price descending, buy what fits)`);
for (const b of g.buy) console.log(`   rank ${String(b.rank).padStart(2)}  ${$(b.price).padStart(9)}  m=${b.m.toFixed(3)}  ${b.name}`);
console.log(`   total ${$(g.totalCost)}  M=${g.M.toFixed(4)}  ln M=${g.logM.toFixed(4)}`);
if (g.failed.length) console.log(`   ${g.failed.length} purchase(s) the game would REJECT for unmet prerequisites: ${g.failed.map((f) => f.name).join(", ")}`);
const dead = g.buy.filter((b) => b.m <= 1 + 1e-12);
if (dead.length) console.log(`   ${$(dead.reduce((s, b) => s + b.price, 0))} of it on ${dead.length} augmentation(s) worth NOTHING on the value channels: ${dead.map((b) => b.name).join(", ")}`);
console.log();
console.log(`PLANNER`);
for (const b of p.buy) console.log(`   rank ${String(b.rank).padStart(2)}  ${$(b.price).padStart(9)}  m=${b.m.toFixed(3)}  ${b.name}${b.level ? ` (level ${b.level})` : ""}`);
console.log(`   total ${$(p.totalCost)}  M=${p.M.toFixed(4)}  ln M=${p.logM.toFixed(4)}  exact=${p.exact}`);
console.log();
const near = p.skipped.filter((s) => s.why === "reputation").sort((a, b) => a.short - b.short).slice(0, 5);
if (near.length) {
  console.log(`   closest reputation unlocks (what an errand would buy):`);
  for (const s of near) console.log(`     ${s.faction}: ${Math.round(s.short).toLocaleString()} more rep -> ${s.name}`);
}
console.log();
console.log(`RESULT: ${(p.logM / g.logM).toFixed(2)}x the log-multiplier for ${(p.totalCost / g.totalCost).toFixed(2)}x the money`);
console.log(`        = ${((p.logM / p.totalCost) / (g.logM / g.totalCost)).toFixed(2)}x more multiplier per dollar.`);
