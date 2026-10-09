// [QP] THE PURCHASE PLAN STARTS AT THE QUEUE, NOT AT AN EMPTY ONE.
//
// Live BitNode 12, 2026-10-09 ~13:27Z: twelve NeuroFlux levels had been queued
// at 04:22Z and never installed. Every pass since planned 34 augmentations —
// the 12 queued plus 22 more priced from rank 0 (Cranial Signal Processors -
// Gen I at $71.4m) — because progress.js handed augplan the offers at their
// UNQUEUED price (live / 1.9^12) and augplan's ranks started at 0. The game
// charges base x 1.9^(queued + rank): $158.03b, x2213 = 1.9^12. So:
//   - the purchase step: "STOPPED executing the plan at Cranial Signal
//     Processors - Gen I: planned $71400000, game says $158030685221
//     (221231.5% drift)" — nothing bought;
//   - the install: "HOLD: the batch ordered is not the batch priced (priced
//     34, ordered 12 ...) — buy the rest or re-plan next pass";
//   - the next pass re-planned the same 34. Neither moved for hours, and the
//     gate's exit (16.8h) was the exit of a batch nobody could buy.
//
//   QP1 THE PRICES: from the live state (12 NeuroFlux queued, the 22 offers),
//       every purchase the shipped plan publishes is what the game
//       (AugmentationHelpers.ts getAugCost: base x 1.14^level x
//       BN.AugmentationMoneyCost x 1.9^queuedNonSoA) charges when it is bought
//       in plan order after the queue — the executor's 1% drift check passes
//       on every item, and the plan's total fits the money it was planned on
//   QP2 NO DEADLOCK: where nothing more is worth (or can) be bought at the true
//       price, the plan is empty, the batch priced IS the queue, and the
//       install verdict is 'the batch ordered is the batch priced' — the gate
//       decides installing the 12 on its own exit, never "ordered != priced"
//   QP3 THE EMPTY QUEUE is unchanged: no queue, rank 0 at the live price

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const A = await import("augplan.js");
const P = await import("../../plan.js");
const PG = await import("../../progress.js");

const fx = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-augs.json"), "utf8"));
const NFG = "NeuroFlux Governor";
const BN12_MONEY = 1.02; // BitNode 12 at SF12 level 1: 71.4m / 70m (the live plan's own row)
// The 22 the live plan could not buy (installgate.txt 13:26:46Z), and NeuroFlux.
const LIVE22 = [
  "Cranial Signal Processors - Gen I", "Cranial Signal Processors - Gen II", "Cranial Signal Processors - Gen III",
  "Magnetism Amplifier", "Hacknet Node Core Direct-Neural Interface", "Speech Processor Implant", "Neurotrainer II",
  "Hacknet Node Kernel Direct-Neural Interface", "INFRARET Enhancement", "Social Negotiation Assistant (S.N.A)",
  "Combat Rib I", "Nuoptimal Nootropic Injector Implant", "Augmented Targeting I", "Speech Enhancement",
  "Hacknet Node CPU Architecture Neural-Upload", "Neural Wit Amplifier", "Hacknet Node Cache Architecture Neural-Upload",
  "LuminCloaking-V1 Skin Implant", "Hacknet Node NIC Architecture Neural-Upload", "Neurotrainer I", "Wired Reflexes",
  "NutriGen Implant",
];
const CAT = new Map(fx.augmentations.map((a) => [a.name, a]));
const NFG_OWNED = 30; // installed levels; the 12 queued sit on top

/** The game's price (getAugCost) with `queue` (names) queued. */
function gamePrice(name, queue) {
  const a = CAT.get(name);
  const queuedNonSoa = queue.filter((n) => !A.isSoa(n)).length;
  const generic = Math.pow(A.BASE_PRICE_MULT, queuedNonSoa);
  if (name === NFG) {
    const level = NFG_OWNED + queue.filter((n) => n === NFG).length;
    return a.baseCost * Math.pow(A.NFG_LEVEL_MULT, level) * BN12_MONEY * generic;
  }
  return a.baseCost * BN12_MONEY * generic;
}

/** progress.js's offers and plan for a queue and a budget, through its own helpers. */
function livePlan(queue, money) {
  const q = PG.queuedPricingOf(queue, 0);
  const offers = [...LIVE22, NFG].map((name) => {
    const a = CAT.get(name);
    return { name, faction: "The Black Hand", baseCost: gamePrice(name, queue) / (A.isSoa(name) ? 1 : q.unqueue), repReq: a.baseRepRequirement, factionRep: 1e12, mults: a.mults, prereqs: a.prereqs, favor: 150, nfgLevel: 0 };
  });
  const args = PG.purchasePlanArgsOf({ offers, money, q, owned: [], soaOwned: 0, ticketsWanted: 0, oneoff: { money } });
  return A.planPurchases(args);
}

/** The executor (progress.js purchase step) against the GAME: buy in order, stop on >1% drift. */
function execute(plan, queue) {
  const q = [...queue];
  const bought = [];
  for (const item of plan.buy) {
    const live = gamePrice(item.name, q);
    const planned = item.price - (item.donation ?? 0);
    const drift = Math.abs(live - planned) / Math.max(planned, 1);
    if (drift > 0.01) return { bought, stoppedAt: { name: item.name, planned, live, drift } };
    q.push(item.name);
    bought.push(item.name);
  }
  return { bought, stoppedAt: null };
}

export async function run() {
  const checks = [];
  const QUEUE = Array(12).fill(NFG);
  const MONEY = 5.52e12 + 0.25e12; // cash + book, 13:28Z

  {
    const c = new Check("QP1", "from 12 queued, every planned purchase is priced at what the game charges after the queue");
    const plan = livePlan(QUEUE, MONEY);
    const ex = execute(plan, QUEUE);
    c.examined(plan.buy.length);
    c.note(`plan: ${plan.buy.length} item(s), $${(plan.totalCost / 1e9).toFixed(1)}b of $${(MONEY / 1e9).toFixed(1)}b; first ${plan.buy[0] ? `${plan.buy[0].name} at $${(plan.buy[0].price / 1e9).toFixed(2)}b` : "none"}`);
    if (ex.stoppedAt) c.fail(`STOPPED at ${ex.stoppedAt.name}: planned $${ex.stoppedAt.planned.toFixed(0)}, game says $${ex.stoppedAt.live.toFixed(0)} (${(ex.stoppedAt.drift * 100).toFixed(1)}% drift)`, "the plan priced the queue as empty: augplan ranks must start at the queued non-SoA count");
    if (plan.totalCost > MONEY * (1 + 1e-9)) c.fail(`the plan costs $${plan.totalCost.toExponential(3)} against $${MONEY.toExponential(3)}`, "a plan that does not fit its budget is not executable");
    checks.push(c);
  }

  {
    const c = new Check("QP2", "nothing affordable at the true price: the batch priced is the queue, and the install is not refused for it");
    const money = 50e9; // below Gen I's $158b after 12 queued
    const plan = livePlan(QUEUE, money);
    const ex = execute(plan, QUEUE);
    const priced = [...QUEUE, ...plan.buy.map((b) => b.name)];
    const ordered = [...QUEUE, ...ex.bought];
    const v = P.installBatchVerdictOf({ priced, bought: ordered, pricedH: 16.8, repricedH: 23.7, alternatives: [{ key: "wait 0.25h", H: 16.9 }] });
    c.examined(plan.buy.length + 1);
    c.note(`plan ${plan.buy.length} item(s) at $${(money / 1e9).toFixed(0)}b; verdict: ${v.why}`);
    if (plan.buy.length) c.fail(`the plan buys ${plan.buy.map((b) => b.name).join(", ")} on $${(money / 1e9).toFixed(0)}b`, "after 12 queued nothing in this catalogue costs under $50b");
    if (!v.same || !v.install) c.fail(`install verdict: ${v.why}`, "the batch priced must be the batch the game can order — the queue as it is");
    checks.push(c);
  }

  {
    const c = new Check("QP3", "an empty queue plans from rank 0 at the live price");
    const plan = livePlan([], MONEY);
    const ex = execute(plan, []);
    c.examined(plan.buy.length);
    c.note(`plan: ${plan.buy.length} item(s), $${(plan.totalCost / 1e9).toFixed(1)}b`);
    if (ex.stoppedAt) c.fail(`STOPPED at ${ex.stoppedAt.name} with nothing queued (${(ex.stoppedAt.drift * 100).toFixed(1)}% drift)`, "the empty-queue path regressed");
    if (!(plan.buy.length > 12)) c.fail(`only ${plan.buy.length} item(s) on $${(MONEY / 1e9).toFixed(0)}b with nothing queued`, "the empty queue should buy most of this catalogue");
    checks.push(c);
  }
  return checks;
}
