// [AP] the augmentation purchase planner.
//
//   node tools/staging/augplan/augplan.test.mjs
//   node tools/staging/augplan/augplan.test.mjs --fast   # skip the game-source calibration
//
// The governing claims, in the order they are checked:
//
//   AP1  descending base cost really is the cheapest order for a fixed set —
//        against brute force over every permutation, not asserted
//   AP2  the planner beats progress.js's price-descending greedy, measured in
//        log-multiplier per dollar on the game's real catalogue
//   AP3  NeuroFlux's DOUBLE escalation is priced right, several levels deep in
//        one plan
//   AP4  SoA augmentations are excluded from the 1.9 count and escalate each
//        other by 7x INSIDE a plan
//   AP5  reputation-gated augmentations are reported with the shortfall, never
//        silently dropped
//   AP6  CALIBRATION: every price the planner publishes matches the game's own
//        getAugCost, walked purchase by purchase
//   AP7  EXACTNESS: on small inputs the DP matches brute force over every subset
//        AND every ordering
//   AP8  the stopping rule returns the cheapest set that clears the bar
//   AP9  degenerate inputs return an empty plan instead of throwing, and an
//        unreadable budget throws instead of planning
//   AP10 prerequisites: the greedy violates them and the planner never does
//
// Every check names the real failure it prevents, in the style of
// tools/test/installgate.test.mjs, because a check whose failure message does
// not say what breaks is a check nobody will act on.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Check } from "../../test/harness.mjs";
import "./gameresolve.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const plan = await import("./augplan.js");
const gate = await import("installgate.js");

const {
  planPurchases,
  greedyByPrice,
  cheapestOrder,
  orderedCost,
  valueOf,
  nfgLevelsRepAllows,
  BASE_PRICE_MULT,
  NFG_LEVEL_MULT,
  SOA_COST_MULT,
  SOA_REP_MULT,
  SOA_AUGS,
  NFG,
  genericPriceMultiplier,
} = plan;

const FAST = process.argv.includes("--fast");
const FIXTURE = path.join(HERE, "fixture.json");
const fixture = fs.existsSync(FIXTURE) ? JSON.parse(fs.readFileSync(FIXTURE, "utf8")) : null;

const rel = (a, b) => (b === 0 ? Math.abs(a) : Math.abs(a - b) / Math.abs(b));

/* ---------------------------------------------------------------- helpers */

/** A deterministic PRNG, so a failure is reproducible rather than "sometimes". */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** The hacking-faction offer set this run actually faces, from the real catalogue. */
function realOffers({ rep = Infinity, nfgLevel = 0, factions = ["BitRunners", "The Black Hand", "NiteSec", "CyberSec", "Netburners"] } = {}) {
  if (!fixture) return [];
  return fixture.augmentations
    .filter((a) => a.factions.some((f) => factions.includes(f)))
    .map((a) => ({
      name: a.name,
      faction: a.factions.find((f) => factions.includes(f)),
      baseCost: a.baseCost,
      repReq: a.baseRepRequirement,
      factionRep: rep,
      mults: a.mults,
      prereqs: a.prereqs,
      isNFG: a.isNFG,
      isSoA: a.isSoA,
      nfgLevel,
    }));
}

/**
 * Brute force over EVERY subset and EVERY ordering.
 *
 * Recursive: at each step take any not-yet-taken singleton, or the next
 * NeuroFlux level, or stop. That enumerates the whole space the planner
 * searches plus every ordering it rules out by the rearrangement argument — so
 * if the planner's canonical form ever loses something, this finds it.
 */
function bruteForce({ singles, nfg = null, nfgCap = 0, r, money, targetM = null }) {
  let best = null;
  const bar = targetM ? Math.log(targetM) : null;
  const consider = (cost, value, seq) => {
    if (cost > money + 1e-9) return;
    if (bar !== null) {
      // Cheapest that clears the bar, falling back to most valuable.
      const clears = value >= bar - 1e-9;
      const bestClears = best && best.value >= bar - 1e-9;
      if (clears && (!bestClears || cost < best.cost - 1e-9)) best = { cost, value, seq: [...seq] };
      else if (!bestClears && (!best || value > best.value + 1e-9)) best = { cost, value, seq: [...seq] };
      return;
    }
    if (!best || value > best.value + 1e-9 || (Math.abs(value - best.value) <= 1e-9 && cost < best.cost - 1e-9)) {
      best = { cost, value, seq: [...seq] };
    }
  };
  const walk = (used, t, rank, cost, value, seq) => {
    consider(cost, value, seq);
    for (let i = 0; i < singles.length; i++) {
      if (used[i]) continue;
      const c = cost + singles[i].baseCost * Math.pow(r, rank);
      if (c > money + 1e-9) continue;
      used[i] = 1;
      seq.push(singles[i].name);
      walk(used, t, rank + 1, c, value + Math.log(singles[i].m), seq);
      seq.pop();
      used[i] = 0;
    }
    if (nfg && t < nfgCap) {
      const c = cost + nfg.baseCost * Math.pow(NFG_LEVEL_MULT, nfg.level + t) * Math.pow(r, rank);
      if (c <= money + 1e-9) {
        seq.push(`${NFG}#${t + 1}`);
        walk(used, t + 1, rank + 1, c, value + Math.log(nfg.m), seq);
        seq.pop();
      }
    }
  };
  walk(new Array(singles.length).fill(0), 0, 0, 0, 0, []);
  return best ?? { cost: 0, value: 0, seq: [] };
}

/* ================================================================== AP1 == */

function ap1() {
  const c = new Check("AP1", "descending base cost is the CHEAPEST order for a fixed set (rearrangement inequality)");
  // The rule this repo's CLAUDE.md mandates and the whole planner is built on.
  // If it is ever false the planner's canonical form is unsound and every cost
  // it publishes is a lower bound on what the game will charge.
  const rand = rng(20260913);
  let worst = 0;
  let counterexamples = 0;
  for (let trial = 0; trial < 60; trial++) {
    const n = 3 + Math.floor(rand() * 5); // 3..7 -> up to 5040 permutations
    const prices = Array.from({ length: n }, () => Math.round(1e6 * Math.pow(10, rand() * 4)));
    const r = [1.9, 1.9 * 0.96, 1.9 * 0.93, 7][Math.floor(rand() * 4)];
    const mine = cheapestOrder(prices, r).cost;
    let bestPerm = Infinity;
    const perm = (left, acc) => {
      if (!left.length) {
        bestPerm = Math.min(bestPerm, orderedCost(acc, r));
        return;
      }
      for (let i = 0; i < left.length; i++) perm(left.slice(0, i).concat(left.slice(i + 1)), acc.concat(left[i]));
    };
    perm(prices, []);
    c.examined(1);
    worst = Math.max(worst, rel(mine, bestPerm));
    if (mine > bestPerm + 1e-6) {
      counterexamples++;
      if (counterexamples === 1) c.fail(`descending order is not optimal on ${JSON.stringify(prices)} at r=${r}: descending $${mine} vs best permutation $${bestPerm}`,
        "the planner orders every plan this way; if this is false, every published price is too low and the executor runs out of money mid-plan");
    }
  }
  c.note(`60 random sets of 3-7 items at r in {1.9, 1.824, 1.767, 7}: every permutation enumerated, worst gap vs descending = ${worst.toExponential(2)}`);

  // The direction matters — show ASCENDING is genuinely worse, so a passing
  // check is not just "any order works on these numbers".
  const prices = [1e9, 5e8, 2e8, 1e8];
  const asc = orderedCost([...prices].sort((a, b) => a - b), BASE_PRICE_MULT);
  const desc = cheapestOrder(prices, BASE_PRICE_MULT).cost;
  c.examined(1);
  c.note(`[$1b, $500m, $200m, $100m] at 1.9: descending $${(desc / 1e6).toFixed(0)}m, ascending $${(asc / 1e6).toFixed(0)}m (${(asc / desc).toFixed(2)}x worse)`);
  if (!(asc > desc * 1.2)) c.fail("ascending order is not meaningfully worse than descending on a spread set", "the test would then pass for a planner that ignored order entirely");
  return c;
}

/* ================================================================== AP2 == */

function ap2() {
  const c = new Check("AP2", "the planner beats progress.js's price-descending greedy, in multiplier per dollar");
  if (!fixture) {
    c.warn("fixture.json is missing — run `node tools/staging/augplan/fixture.mjs`", "without the game's real catalogue this measurement is on invented numbers, which is the failure mode CLAUDE.md calls fabricated validation");
    return c;
  }

  // Reputation and money are SWEPT, not guessed. The live save has no factions
  // joined and no SF4, so there is no live offer set to read; what is real here
  // is the catalogue. Sweeping is how a single flattering point is avoided.
  const rows = [];
  let wins = 0;
  let ties = 0;
  let losses = 0;
  for (const rep of [50e3, 200e3, 1e6]) {
    for (const money of [1e9, 1e10, 1e11, 1e12]) {
      const offers = realOffers({ rep });
      const p = planPurchases({ offers, money });
      const g = greedyByPrice({ offers, money });
      c.examined(1);
      rows.push({ rep, money, p, g });
      if (p.logM > g.logM + 1e-9) wins++;
      else if (Math.abs(p.logM - g.logM) <= 1e-9) ties++;
      else losses++;
    }
  }

  for (const { rep, money, p, g } of rows) {
    const per = (x) => (x.totalCost > 0 ? x.logM / (x.totalCost / 1e9) : 0);
    c.note(
      `rep ${(rep / 1e3).toFixed(0)}k, $${(money / 1e9).toFixed(0)}b : ` +
        `planner M=${p.M.toFixed(3)} for $${(p.totalCost / 1e9).toFixed(2)}b (${p.buy.length} augs, ${per(p).toFixed(3)} lnM/$b) | ` +
        `greedy M=${g.M.toFixed(3)} for $${(g.totalCost / 1e9).toFixed(2)}b (${g.buy.length} augs, ${per(g).toFixed(3)} lnM/$b)`,
    );
  }
  c.note(`${wins} scenario(s) the planner wins, ${ties} tie, ${losses} lose`);

  if (losses > 0) c.fail(`the greedy beat the planner in ${losses} scenario(s)`, "the planner claims to be exact against this objective, so losing to a one-pass heuristic means the DP or the cost model is wrong");
  if (wins === 0) c.warn("the planner never beat the greedy on any swept scenario", "either the catalogue has no valueless expensive augmentations any more, or the two are being fed different inputs");

  // The specific defect that motivates the whole file, named rather than implied.
  const offers = realOffers({ rep: 1e6 });
  const g = greedyByPrice({ offers, money: 5e9 });
  const worthless = g.buy.filter((b) => b.m <= 1 + 1e-12);
  c.examined(1);
  if (worthless.length) {
    c.note(`at $5b the greedy spends $${(worthless.reduce((s, b) => s + b.price, 0) / 1e9).toFixed(2)}b on ${worthless.length} augmentation(s) worth NOTHING on ${gate.RATE_CHANNELS.join("/")}: ${worthless.map((b) => b.name).join(", ")}`);
  } else {
    c.warn("the greedy bought nothing valueless at $5b", "the headline claim in augplan.js's header is that it does; if the catalogue changed, the header must too");
  }
  const p = planPurchases({ offers, money: 5e9 });
  c.examined(1);
  if (p.buy.some((b) => b.m <= 1 + 1e-12)) c.fail("the planner bought an augmentation with no value on the rate channels", "it costs money AND pushes every later purchase up an exponent — it is strictly dominated by not buying it");
  return c;
}

/* ================================================================== AP3 == */

function ap3() {
  const c = new Check("AP3", "NeuroFlux escalates on BOTH axes, including several levels inside one plan");
  // getLevel() (Augmentation.ts:238-246) counts owned level PLUS every queued
  // copy, so level t of a plan costs base * 1.14^(owned+t) * 1.9^rank. Pricing
  // only one of the two exponents makes a 6-level plan look 2x cheaper than it
  // is, and the executor then runs out of money partway through.
  const base = 750e3;
  const offers = [{ name: NFG, faction: "CyberSec", baseCost: base, repReq: 1, factionRep: 1e12, mults: { hacking: 1.01, hacking_money: 1.01, faction_rep: 1.01 }, isNFG: true, nfgLevel: 0 }];
  const p = planPurchases({ offers, money: 1e9 });
  c.examined(1);
  if (p.buy.length < 4) c.fail(`only ${p.buy.length} NeuroFlux level(s) planned against $1b from level 0`, "a $750k first level against a $1b budget must reach several levels; one level means the chain was not expanded");
  let worst = 0;
  for (let t = 0; t < p.buy.length; t++) {
    const want = base * Math.pow(NFG_LEVEL_MULT, t) * Math.pow(BASE_PRICE_MULT, t);
    worst = Math.max(worst, rel(p.buy[t].price, want));
    c.examined(1);
  }
  c.note(`${p.buy.length} levels from level 0 against $1b, total $${(p.totalCost / 1e6).toFixed(1)}m, M=${p.M.toFixed(4)}; worst price error vs base*1.14^t*1.9^t = ${worst.toExponential(2)}`);
  if (worst > 1e-9) c.fail("a NeuroFlux level inside a plan is not priced base * 1.14^t * 1.9^t", "one exponent is being applied and the other is not");

  // Levels bought on top of an OWNED level start from that level, not from 0.
  const owned = planPurchases({ offers: [{ ...offers[0], nfgLevel: 10 }], money: 1e9 });
  c.examined(1);
  if (owned.buy.length && rel(owned.buy[0].price, base * Math.pow(NFG_LEVEL_MULT, 10)) > 1e-9) {
    c.fail(`the first level above owned level 10 was priced $${owned.buy[0].price}, not $${base * Math.pow(NFG_LEVEL_MULT, 10)}`, "the owned level must feed the 1.14 exponent, or every late-game plan is wildly under-priced");
  }
  c.note(`at owned level 10 the next level is $${(base * Math.pow(NFG_LEVEL_MULT, 10) / 1e6).toFixed(2)}m and ${owned.buy.length} level(s) fit in $1b (vs ${p.buy.length} from level 0)`);

  // The 2.166x wall, and the reputation threshold count.
  c.examined(1);
  const step = NFG_LEVEL_MULT * BASE_PRICE_MULT;
  if (rel(step, 2.166) > 1e-9) c.fail(`the per-level step inside a cycle is ${step}, not 1.14*1.9`, "the wall at ~12 levels is sized off this number");
  c.examined(1);
  // rep for level j is repReq * 1.14^j, and rep is never consumed.
  if (nfgLevelsRepAllows(1000, 999) !== 0) c.fail("rep below the next level's requirement must allow 0 levels");
  if (nfgLevelsRepAllows(1000, 1000) !== 1) c.fail("rep exactly at the requirement must allow exactly 1 level");
  if (nfgLevelsRepAllows(1000, 1000 * Math.pow(NFG_LEVEL_MULT, 5)) !== 6) c.fail("rep for 1.14^5 above the requirement must allow 6 levels", "reputation is a threshold, not a budget — it is not consumed by a purchase (FactionHelpers.tsx:102,120)");
  c.examined(1);
  return c;
}

/* ================================================================== AP4 == */

function ap4() {
  const c = new Check("AP4", "SoA augmentations are excluded from the 1.9 count and escalate EACH OTHER by 7x in-plan");
  const mults = { hacking: 1.2 };
  const soa = SOA_AUGS.slice(0, 3).map((name) => ({ name, faction: "Shadows of Anarchy", baseCost: 1e6, repReq: 10e3, factionRep: 1e9, mults, isSoA: true }));
  const ordinary = [
    { name: "Big", faction: "F", baseCost: 10e6, repReq: 0, factionRep: 1, mults: { hacking: 1.5 } },
    { name: "Small", faction: "F", baseCost: 1e6, repReq: 0, factionRep: 1, mults: { hacking: 1.4 } },
  ];

  const p = planPurchases({ offers: ordinary.concat(soa), money: 1e9 });
  const byName = new Map(p.buy.map((b) => [b.name, b]));
  c.examined(1);
  // The two ordinary augmentations must be priced at ranks 0 and 1 — the three
  // SoA purchases must not have pushed them up the 1.9 ladder.
  if (!byName.has("Big") || rel(byName.get("Big").price, 10e6) > 1e-9) {
    c.fail(`the most expensive ordinary aug was priced $${byName.get("Big")?.price} rather than its base $10m`, "an SoA purchase counted toward the generic 1.9 exponent — AugmentationHelpers.ts:33-36 filters them out of it");
  }
  c.examined(1);
  if (!byName.has("Small") || rel(byName.get("Small").price, 1e6 * BASE_PRICE_MULT) > 1e-9) {
    c.fail(`the second ordinary aug was priced $${byName.get("Small")?.price} rather than base * 1.9`, "SoA purchases must not occupy generic ranks");
  }

  // And the SoA block escalates on its OWN counter: 7^0, 7^1, 7^2. Person.ts:232-240
  // counts QUEUED augs, so this happens INSIDE one plan — the thing both the
  // brief for this file and tools/staging/augplan.js got wrong.
  const soaBuys = p.buy.filter((b) => b.kind === "soa");
  c.examined(soaBuys.length);
  let worst = 0;
  soaBuys.forEach((b, k) => {
    worst = Math.max(worst, rel(b.price, 1e6 * Math.pow(SOA_COST_MULT, k)));
  });
  c.note(`${soaBuys.length} SoA bought at ${soaBuys.map((b) => `$${(b.price / 1e6).toFixed(0)}m`).join(", ")} — the 7^k ladder; worst error ${worst.toExponential(2)}`);
  if (soaBuys.length < 2) c.fail(`only ${soaBuys.length} SoA augmentation(s) planned against $1b`, "three $1m SoA augs cost $1m + $7m + $49m = $57m, which fits easily; fewer means the SoA sub-problem is not running");
  if (worst > 1e-9) c.fail("SoA prices do not follow base * 7^(SoA already owned or queued)", "pricing them as order-independent under-charges the second by 7x and the third by 49x");

  // soaOwned shifts the whole ladder, because owned and queued count alike.
  const withOwned = planPurchases({ offers: soa, money: 1e9, soaOwned: 2 });
  c.examined(1);
  if (withOwned.buy.length && rel(withOwned.buy[0].price, 1e6 * SOA_COST_MULT * SOA_COST_MULT) > 1e-9) {
    c.fail(`with 2 SoA already held the first purchase was $${withOwned.buy[0].price}, not $${1e6 * 49}`, "AugmentationHelpers.ts:150 counts owned and queued identically");
  }

  // SoA reputation escalates too (1.3^k), so a plan can be rep-limited partway
  // through the block rather than at the first item.
  const tight = planPurchases({
    offers: SOA_AUGS.slice(0, 3).map((name) => ({ name, faction: "SoA", baseCost: 1e6, repReq: 10e3, factionRep: 12e3, mults, isSoA: true })),
    money: 1e12,
  });
  c.examined(1);
  c.note(`rep 12k against a 10k SoA requirement escalating at 1.3^k: ${tight.buy.length} of 3 bought (10k, 13k, 16.9k needed)`);
  if (tight.buy.length !== 1) c.fail(`rep 12k bought ${tight.buy.length} SoA augmentations, expected 1`, "the second needs 10k*1.3 = 13k reputation (AugmentationHelpers.ts:152); ignoring the escalation plans a purchase the game will reject");
  if (rel(SOA_REP_MULT, 1.3) > 1e-12) c.fail("SoARepMult is not 1.3");
  return c;
}

/* ================================================================== AP5 == */

function ap5() {
  const c = new Check("AP5", "reputation-gated augmentations are REPORTED with the shortfall, never silently dropped");
  // "Which augmentation is one faction errand away" is the most useful thing
  // this module can tell the run, and it is exactly what a filter throws away.
  const offers = [
    { name: "Reachable", faction: "NiteSec", baseCost: 1e6, repReq: 1000, factionRep: 5000, mults: { hacking: 1.1 } },
    { name: "Just short", faction: "NiteSec", baseCost: 1e6, repReq: 6000, factionRep: 5000, mults: { hacking: 2 } },
    { name: "Far off", faction: "BitRunners", baseCost: 1e6, repReq: 1e6, factionRep: 0, mults: { hacking: 3 } },
  ];
  const p = planPurchases({ offers, money: 1e12 });
  const rep = p.skipped.filter((s) => s.why === "reputation");
  c.examined(3);
  if (rep.length !== 2) c.fail(`${rep.length} augmentation(s) reported as rep-gated, expected 2`, "an augmentation that vanishes from both `buy` and `skipped` is indistinguishable from one that does not exist — the run can never learn what reputation would unlock");
  const short = new Map(rep.map((s) => [s.name, s]));
  if (short.get("Just short")?.short !== 1000) c.fail(`the shortfall for 'Just short' was ${short.get("Just short")?.short}, expected 1000`, "the shortfall is the input to the time-cost model in NOTES.md §5");
  if (short.get("Far off")?.short !== 1e6) c.fail("the shortfall for a faction at zero reputation is wrong");
  c.note(`skipped: ${rep.map((s) => `${s.name} short ${s.short.toLocaleString()} rep at ${s.faction}`).join("; ")}`);
  c.examined(1);
  if (p.buy.some((b) => b.name !== "Reachable")) c.fail("a rep-gated augmentation was planned", "purchaseAugmentation compares faction.playerReputation < repCost (FactionHelpers.tsx:102) and returns false — the plan would be unexecutable and fail silently");

  // Reputation is never CONSUMED: two augmentations from one faction each need
  // only their own requirement, so buying the expensive one does not lock out
  // the cheap one.
  const both = planPurchases({
    offers: [
      { name: "Expensive rep", faction: "F", baseCost: 1e6, repReq: 100e3, factionRep: 100e3, mults: { hacking: 1.5 } },
      { name: "Cheap rep", faction: "F", baseCost: 1e6, repReq: 90e3, factionRep: 100e3, mults: { hacking: 1.4 } },
    ],
    money: 1e12,
  });
  c.examined(1);
  if (both.buy.length !== 2) c.fail(`${both.buy.length} of 2 augmentations planned from one faction`, "reputation is a threshold, not a budget — purchaseAugmentation's only spend is Player.loseMoney (FactionHelpers.tsx:120)");
  return c;
}

/* ================================================================== AP6 == */

async function ap6() {
  const c = new Check("AP6", "CALIBRATION: every published price matches the game's own getAugCost, purchase by purchase");
  if (FAST) {
    c.warn("skipped with --fast", "the planner's entire cost model is a hand-port of getAugCost; without this check the suite proves only that the port agrees with itself");
    return c;
  }
  if (!fixture) {
    c.warn("fixture.json is missing", "run `node tools/staging/augplan/fixture.mjs`");
    return c;
  }

  const t0 = Date.now();
  await import("../../sim/env.mjs");
  const g = await import("../../sim/game.bundle.mjs");

  const setPlayer = ({ queued = [], owned = [], sf = {} }) =>
    g.setPlayer({
      bitNodeN: 4,
      activeSourceFileLvl: (n) => sf[n] ?? 0,
      queuedAugmentations: queued,
      augmentations: owned,
      hasAugmentation: (n, ignoreQueued = false) =>
        owned.some((a) => a.name === n) || (!ignoreQueued && queued.some((a) => a.name === n)),
      mults: { faction_rep: 1 },
      money: Infinity,
    });

  // The BitNode we are in, read rather than assumed. The brief for this module
  // asserted BN4's AugmentationMoneyCost is not 1; BitNode.tsx:627-655 does not
  // set it, so BitNodeMultipliers.ts:13 applies and it is.
  const bn4 = g.getBitNodeMultipliers(4, 1);
  c.examined(2);
  c.note(`BitNode 4: AugmentationMoneyCost = ${bn4.AugmentationMoneyCost}, AugmentationRepCost = ${bn4.AugmentationRepCost} (defaults; BN4 sets neither)`);
  if (bn4.AugmentationMoneyCost !== 1) c.fail(`BN4 AugmentationMoneyCost is ${bn4.AugmentationMoneyCost}`, "every measurement in NOTES.md assumes 1 for this node");
  Object.assign(g.currentNodeMults, { AugmentationMoneyCost: 1, AugmentationRepCost: 1 });

  // ---- walk a real plan through the game's own pricing ---------------------
  const offers = realOffers({ rep: 1e6, nfgLevel: 0 });
  const p = planPurchases({ offers, money: 5e10, nodeMoneyMult: bn4.AugmentationMoneyCost });
  const queued = [];
  let worst = 0;
  let where = "";
  for (const b of p.buy) {
    setPlayer({ queued });
    const aug = g.Augmentations[b.name];
    if (!aug) {
      c.fail(`the planner named an augmentation the game does not have: ${b.name}`);
      continue;
    }
    const got = g.getAugCost(aug).moneyCost;
    const e = rel(b.price, got);
    if (e > worst) {
      worst = e;
      where = `${b.name} at rank ${b.rank}: plan $${b.price.toFixed(2)} vs game $${got.toFixed(2)}`;
    }
    queued.push({ name: b.name });
    c.examined(1);
  }
  c.note(`${p.buy.length}-purchase plan walked through getAugCost one purchase at a time: worst relative price error ${worst.toExponential(3)}${where ? ` (${where})` : ""}`);
  if (worst > 1e-9) c.fail("a planned price does not match what the game will charge", `${where}\nthe executor would run out of money mid-plan, and the shortfall would surface as purchaseAugmentation silently returning false`);

  // ---- the NeuroFlux double escalation, against the game -------------------
  const nfgAug = g.Augmentations[NFG];
  const nfgPlan = planPurchases({
    offers: [{ name: NFG, faction: "CyberSec", baseCost: nfgAug.baseCost, repReq: nfgAug.baseRepRequirement, factionRep: 1e12, mults: nfgAug.mults, isNFG: true, nfgLevel: 3 }],
    money: 1e9,
  });
  const q2 = [];
  let worstNfg = 0;
  for (const b of nfgPlan.buy) {
    setPlayer({ queued: q2, owned: [{ name: NFG, level: 3 }] });
    worstNfg = Math.max(worstNfg, rel(b.price, g.getAugCost(nfgAug).moneyCost));
    q2.push({ name: NFG });
    c.examined(1);
  }
  c.note(`${nfgPlan.buy.length} NeuroFlux levels above owned level 3, $${(nfgPlan.totalCost / 1e6).toFixed(2)}m total: worst error vs getAugCost ${worstNfg.toExponential(3)}`);
  if (worstNfg > 1e-9) c.fail("NeuroFlux prices inside a plan do not match getAugCost", "getLevel() counts owned level PLUS every queued copy (Augmentation.ts:238-246)");

  // ---- the SoA counter counts QUEUED augs ---------------------------------
  const soaAug = g.Augmentations[SOA_AUGS[0]];
  setPlayer({});
  const alone = g.getAugCost(soaAug).moneyCost;
  setPlayer({ queued: [{ name: SOA_AUGS[1] }] });
  const afterQueued = g.getAugCost(soaAug).moneyCost;
  setPlayer({ owned: [{ name: SOA_AUGS[1] }] });
  const afterOwned = g.getAugCost(soaAug).moneyCost;
  c.examined(3);
  c.note(`${SOA_AUGS[0]}: alone $${alone.toLocaleString()}, with one SoA QUEUED $${afterQueued.toLocaleString()}, with one OWNED $${afterOwned.toLocaleString()}`);
  if (rel(afterQueued, alone * SOA_COST_MULT) > 1e-9) {
    c.fail("a QUEUED SoA augmentation does not raise the next SoA price by 7x", "Person.ts:232-240 counts queued augs by default, so an in-plan SoA purchase DOES escalate the rest — tools/staging/augplan.js prices them as order-independent and is wrong by 7x on the second");
  }
  if (rel(afterQueued, afterOwned) > 1e-9) c.fail("queued and owned SoA augmentations are counted differently");

  // ---- an SoA purchase must not move an ordinary price --------------------
  setPlayer({ queued: [{ name: SOA_AUGS[0] }, { name: SOA_AUGS[1] }] });
  const ordinary = g.Augmentations["Augmented Targeting I"];
  c.examined(1);
  if (rel(g.getAugCost(ordinary).moneyCost, ordinary.baseCost) > 1e-9) {
    c.fail("queued SoA augmentations counted toward the generic 1.9 exponent", "AugmentationHelpers.ts:33-36 filters soaAugmentationNames out of the count");
  }

  // ---- our transcribed SoA list is the game's -----------------------------
  c.examined(1);
  const gameSoa = [...g.soaAugmentationNames].sort();
  if (JSON.stringify(gameSoa) !== JSON.stringify([...SOA_AUGS].sort())) {
    c.fail("SOA_AUGS has drifted from soaAugmentationNames", `game: ${gameSoa.join(", ")}\nours: ${[...SOA_AUGS].sort().join(", ")}`);
  }

  // ---- the constants ------------------------------------------------------
  for (const [name, ours, theirs] of [
    ["MultipleAugMultiplier", BASE_PRICE_MULT, g.CONSTANTS.MultipleAugMultiplier],
    ["NeuroFluxGovernorLevelMult", NFG_LEVEL_MULT, g.CONSTANTS.NeuroFluxGovernorLevelMult],
    ["SoACostMult", SOA_COST_MULT, g.CONSTANTS.SoACostMult],
    ["SoARepMult", SOA_REP_MULT, g.CONSTANTS.SoARepMult],
  ]) {
    c.examined(1);
    if (ours !== theirs) c.fail(`${name}: this module says ${ours}, the game says ${theirs}`);
  }
  // The SF11 ladder, which the brief quotes and which scales every plan.
  for (const lvl of [0, 1, 2, 3]) {
    setPlayer({ sf: { 11: lvl } });
    c.examined(1);
    const theirs = g.getBaseAugmentationPriceMultiplier();
    if (rel(genericPriceMultiplier(lvl), theirs) > 1e-12) c.fail(`SF11 level ${lvl}: genericPriceMultiplier gives ${genericPriceMultiplier(lvl)}, the game gives ${theirs}`);
  }
  c.note(`SF11 ladder checked at levels 0-3; calibration took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return c;
}

/* ================================================================== AP7 == */

function ap7() {
  const c = new Check("AP7", "EXACTNESS: the DP matches brute force over every subset AND every ordering");
  // The planner claims to be exact, which is a much stronger claim than "good".
  // If it is only nearly exact it should say so, per CLAUDE.md's rule that a
  // model states its calibration or states that it has none.
  const rand = rng(4242);
  let worst = 0;
  let mismatches = 0;
  let biggestFrontier = 0;
  for (let trial = 0; trial < 40; trial++) {
    const n = 3 + Math.floor(rand() * 4); // 3..6 singletons
    const singles = Array.from({ length: n }, (_, i) => ({
      name: `A${i}`,
      faction: "F",
      baseCost: Math.round(1e6 * Math.pow(10, rand() * 3)),
      repReq: 0,
      factionRep: 1,
      mults: { hacking: 1 + rand() * 0.8 },
    }));
    const withM = singles.map((s) => ({ ...s, m: valueOf(s.mults) }));
    const nfgCap = Math.floor(rand() * 4); // 0..3 levels
    const nfgBase = Math.round(5e5 * (0.5 + rand()));
    const nfgRow = nfgCap
      ? { name: NFG, faction: "F", baseCost: nfgBase, repReq: 1, factionRep: 1e18, mults: { hacking: 1.01, hacking_money: 1.01, faction_rep: 1.01 }, isNFG: true, nfgLevel: 0, nfgMaxLevels: nfgCap }
      : null;
    const money = Math.round(1e6 * Math.pow(10, 1 + rand() * 3));
    const offers = nfgRow ? singles.concat([nfgRow]) : singles;

    const p = planPurchases({ offers, money });
    biggestFrontier = Math.max(biggestFrontier, p.stats.frontier);
    const bf = bruteForce({
      singles: withM,
      nfg: nfgRow ? { baseCost: nfgBase, level: 0, m: valueOf(nfgRow.mults) } : null,
      nfgCap,
      r: BASE_PRICE_MULT,
      money,
    });
    c.examined(1);
    worst = Math.max(worst, Math.abs(p.logM - bf.value));
    if (p.logM < bf.value - 1e-9) {
      mismatches++;
      if (mismatches === 1) {
        c.fail(
          `the DP found ln M = ${p.logM.toFixed(8)} where brute force found ${bf.value.toFixed(8)} (n=${n}, nfgCap=${nfgCap}, $${money})`,
          `plan: ${p.buy.map((b) => b.name).join(" -> ")}\nbest: ${bf.seq.join(" -> ")}\nthe module advertises exact=${p.exact}; if it is not exact it must say so`,
        );
      }
    }
    if (p.totalCost > money + 1e-6) c.fail(`the plan costs $${p.totalCost} against a budget of $${money}`, "an unexecutable plan discovered by failing is the worst shape in CLAUDE.md's table");
    if (!p.exact) c.fail("the planner reported exact: false on a small input", `${p.approximation}`);
  }
  c.note(`40 random instances (3-6 singletons, 0-3 NeuroFlux levels, budgets $10m-$10b): worst |DP - brute force| on ln M = ${worst.toExponential(2)}, largest Pareto frontier seen = ${biggestFrontier}`);
  if (mismatches) c.fail(`${mismatches} of 40 instances were not optimal`);

  // Tractability on a realistic full-size input, since "exact" is only useful
  // if it returns. The whole hacking catalogue is 30 offers with two prereq
  // chains and a NeuroFlux chain.
  if (fixture) {
    const t0 = Date.now();
    const big = planPurchases({ offers: realOffers({ rep: 1e6 }), money: 1e12 });
    const ms = Date.now() - t0;
    c.examined(1);
    c.note(`the full ${big.stats.offers}-offer catalogue at $1t: ${big.stats.singletons} singletons + chains ${JSON.stringify(big.stats.chains.map((x) => `${x.id}(${x.length})`))}, frontier ${big.stats.frontier}, ${ms}ms, exact=${big.exact}`);
    if (!big.exact) c.fail(`the planner fell back to a heuristic on a realistic input: ${big.approximation}`, "the header claims an exact method is tractable at this size");
    if (ms > 10000) c.fail(`the planner took ${ms}ms on a realistic input`, "progress.js runs every five minutes and cannot spend ten seconds of the browser's main thread planning");
  }
  return c;
}

/* ================================================================== AP8 == */

function ap8() {
  const c = new Check("AP8", "the stopping rule buys the CHEAPEST set that clears the bar, not the most valuable that fits");
  // Augmentations are wiped on BitNode entry (PlayerObjectGeneralMethods.ts:174
  // does `this.augmentations = []` inside prestigeSourceFile), so multiplier
  // past what is needed to reach hacking 9000 is destroyed unused. This path
  // cannot fire on today's save — we hold ~1.13x and need ~13x — which is
  // exactly why it has to be checked synthetically rather than waited for.
  const offers = [
    { name: "Cheap+", faction: "F", baseCost: 1e6, repReq: 0, factionRep: 1, mults: { hacking: 2 } },
    { name: "Dear+", faction: "F", baseCost: 100e6, repReq: 0, factionRep: 1, mults: { hacking: 2.2 } },
    { name: "Dearer+", faction: "F", baseCost: 500e6, repReq: 0, factionRep: 1, mults: { hacking: 2.4 } },
  ];
  const unbounded = planPurchases({ offers, money: 1e12 });
  c.examined(1);
  if (unbounded.buy.length !== 3) c.fail(`without a target the planner bought ${unbounded.buy.length} of 3 affordable augmentations`, "with money to spare and every item valuable, the unbounded objective must take all of them");

  const bounded = planPurchases({ offers, money: 1e12, targetM: 1.9 });
  c.examined(1);
  c.note(`unbounded: M=${unbounded.M.toFixed(2)} for $${(unbounded.totalCost / 1e6).toFixed(1)}m | targetM=1.9: M=${bounded.M.toFixed(2)} for $${(bounded.totalCost / 1e6).toFixed(1)}m (${bounded.buy.map((b) => b.name).join(", ")})`);
  if (bounded.buy.length !== 1 || bounded.buy[0].name !== "Cheap+") {
    c.fail(`with a 1.9x bar the planner bought ${bounded.buy.map((b) => b.name).join(", ") || "nothing"}, not the single $1m augmentation that clears it`,
      "money spent on multiplier past the exit threshold is destroyed on node entry; it should have gone to income or to home RAM, which survives");
  }
  if (!(bounded.M >= 1.9 - 1e-9)) c.fail(`the bounded plan gives M=${bounded.M}, below the 1.9 bar`, "a stopping rule that stops short of the bar is worse than no stopping rule");
  if (!bounded.stats.stoppedAtTarget) c.fail("the result does not report that it stopped at the target", "a silently different objective is indistinguishable from a bug");

  // An unreachable bar must fall back to the most valuable affordable set,
  // never to nothing.
  const unreachable = planPurchases({ offers, money: 1e12, targetM: 1e6 });
  c.examined(1);
  if (unreachable.buy.length !== 3) c.fail(`an unreachable target produced a ${unreachable.buy.length}-item plan`, "the bar is an upper bound on useful spending, not a precondition for buying anything");
  if (unreachable.stats.stoppedAtTarget) c.fail("an unreachable target was reported as reached");

  // And it agrees with brute force under the same rule.
  const singles = offers.map((o) => ({ ...o, m: valueOf(o.mults) }));
  const bf = bruteForce({ singles, r: BASE_PRICE_MULT, money: 1e12, targetM: 1.9 });
  c.examined(1);
  if (rel(bounded.totalCost, bf.cost) > 1e-9) c.fail(`the bounded plan costs $${bounded.totalCost} where brute force clears the same bar for $${bf.cost}`);

  // The bar the run is actually chasing, printed so the objective is visible.
  c.examined(1);
  const need = gate.multiplierNeeded(9000, 1e12);
  c.note(`for reference: reaching hacking 9000 with 1e12 exp banked needs about ${need.toFixed(1)}x — installgate.js:multiplierNeeded, skill.ts:13`);
  if (!(need > 1)) c.fail("multiplierNeeded says the exit is already reached at 1x", "the stopping rule would then fire immediately and buy nothing, forever");
  return c;
}

/* ================================================================== AP9 == */

function ap9() {
  const c = new Check("AP9", "degenerate inputs return an empty plan; an unreadable budget throws instead of planning");
  const offers = [{ name: "A", faction: "F", baseCost: 1e9, repReq: 0, factionRep: 1, mults: { hacking: 2 } }];
  for (const [name, input] of [
    ["no offers at all", { offers: [], money: 1e12 }],
    ["undefined offers", { money: 1e12 }],
    ["zero money", { offers, money: 0 }],
    ["the $1,262 an install leaves behind", { offers, money: 1262 }],
    ["everything rep-gated", { offers: [{ ...offers[0], repReq: 1e9, factionRep: 0 }], money: 1e12 }],
    ["everything valueless", { offers: [{ ...offers[0], mults: { hacking_exp: 10 } }], money: 1e12 }],
  ]) {
    c.examined(1);
    let p;
    try {
      p = planPurchases(input);
    } catch (e) {
      c.fail(`${name} threw: ${e.message}`, "progress.js runs this every five minutes; a throw here kills the whole progression pass, and the install gate with it");
      continue;
    }
    if (p.buy.length !== 0) c.fail(`${name} produced a ${p.buy.length}-item plan`);
    if (p.M !== 1) c.fail(`${name} produced M=${p.M}, not 1`, "installgate.js refuses on M <= 1, which is the thrash guard — an empty plan reporting M > 1 would break it");
    if (p.totalCost !== 0) c.fail(`${name} produced a non-zero cost`);
  }

  // The $1,262 case is the thrash guard installgate.js's header argues from, and
  // it now depends on the PLAN rather than on the QUEUE. Asserted, not assumed.
  const postInstall = planPurchases({ offers: realOffers({ rep: 1e6 }), money: 1262 });
  c.examined(1);
  c.note(`immediately after an install ($1,262, PlayerObjectGeneralMethods.ts:102): plan is ${postInstall.buy.length} item(s), M=${postInstall.M}`);
  if (postInstall.M > 1) {
    c.fail("a plan against $1,262 reports M > 1", "installgate.js's no-thrash argument is that M is 1 right after an install. Moving the gate onto the PLANNED set keeps that true only if nothing is affordable at $1,262 — if this fails, the gate can install in a loop");
  }

  // Malformed input must be loud, not quietly treated as zero.
  for (const [name, input] of [
    ["NaN money", { offers, money: NaN }],
    ["undefined money", { offers }],
    ["a price ratio of 1", { offers, money: 1e12, r: 1 }],
  ]) {
    c.examined(1);
    let threw = false;
    try {
      planPurchases(input);
    } catch {
      threw = true;
    }
    if (!threw) c.fail(`${name} was accepted`, "'I could not tell' must never encode as 'it is fine' — a budget of NaN silently planning nothing looks exactly like a run with no money");
  }

  // An unreadable PRICE must not poison the plan, but must be reported.
  const bad = planPurchases({ offers: offers.concat([{ name: "Broken", faction: "F", baseCost: undefined, repReq: 0, factionRep: 1, mults: { hacking: 5 } }]), money: 1e12 });
  c.examined(1);
  if (!bad.skipped.some((s) => s.name === "Broken" && s.why === "unreadable-price")) {
    c.fail("an augmentation with an unreadable price was not reported", "a missing price resolving to 0 would make it look free and put it first in every plan");
  }
  return c;
}

/* ================================================================= AP10 == */

function ap10() {
  const c = new Check("AP10", "prerequisites: descending PRICE violates them, and the planner never does");
  // checkIfPlayerCanPurchaseAugmentation (FactionHelpers.tsx:88-95) rejects a
  // purchase whose prereqs are unmet, and hasAugmentationPrereqs (:56-58) counts
  // QUEUED augs, so a prereq bought earlier in the same plan counts. 34 of the
  // game's augmentations have prereqs. progress.js buys strictly by descending
  // price, which puts Gen V before Gen I — the purchase fails, and
  // purchaseAugmentation returning false is silently ignored at progress.js:329.
  const chain = [
    { name: "Gen I", faction: "F", baseCost: 70e6, repReq: 0, factionRep: 1, mults: { hacking: 1.05 }, prereqs: [] },
    { name: "Gen II", faction: "F", baseCost: 125e6, repReq: 0, factionRep: 1, mults: { hacking: 1.07 }, prereqs: ["Gen I"] },
    { name: "Gen III", faction: "F", baseCost: 550e6, repReq: 0, factionRep: 1, mults: { hacking: 1.09 }, prereqs: ["Gen I", "Gen II"] },
  ];
  const g = greedyByPrice({ offers: chain, money: 1e12 });
  c.examined(1);
  c.note(`greedy at $1t on a 3-deep prereq chain: bought ${g.buy.map((b) => b.name).join(", ") || "nothing"}; ${g.failed.length} purchase(s) the game would reject (${g.failed.map((f) => `${f.name} needs ${f.needs.join("+")}`).join("; ")})`);
  if (g.failed.length === 0) c.fail("the greedy model did not reproduce progress.js's prerequisite bug", "the comparison in AP2 is then measuring something other than the shipped behaviour");

  const p = planPurchases({ offers: chain, money: 1e12 });
  c.examined(1);
  const pos = new Map(p.buy.map((b, i) => [b.name, i]));
  for (const a of chain) {
    for (const req of a.prereqs) {
      if (!pos.has(a.name)) continue;
      c.examined(1);
      if (!pos.has(req) || pos.get(req) > pos.get(a.name)) {
        c.fail(`${a.name} is planned at step ${pos.get(a.name)} but its prerequisite ${req} is at ${pos.get(req) ?? "never"}`,
          "the game rejects the purchase and purchaseAugmentation returns false, which nothing reports — the augmentation is simply never bought");
      }
    }
  }
  c.note(`planner: ${p.buy.map((b) => b.name).join(" -> ")} for $${(p.totalCost / 1e6).toFixed(0)}m, M=${p.M.toFixed(4)}`);
  if (p.buy.length !== 3) c.fail(`the planner bought ${p.buy.length} of a 3-item chain against $1t`, "all three are affordable and all three have value; a shorter plan means the chain model is over-constraining");

  // A dependent whose prerequisite is not on offer cannot be bought at all.
  const orphan = planPurchases({ offers: [chain[2]], money: 1e12 });
  c.examined(1);
  if (orphan.buy.length !== 0) c.fail("an augmentation whose prerequisites are not available was planned");
  if (!orphan.skipped.some((s) => s.why === "prereq-unavailable")) c.fail("an unbuyable dependent was dropped without a reason", "it looks identical to an augmentation that does not exist");

  // On the real catalogue, every planned purchase must be legal.
  if (fixture) {
    const real = planPurchases({ offers: realOffers({ rep: 1e6 }), money: 1e12 });
    const byName = new Map(fixture.augmentations.map((a) => [a.name, a]));
    const seen = new Set();
    let violations = 0;
    for (const b of real.buy) {
      for (const req of byName.get(b.name)?.prereqs ?? []) {
        c.examined(1);
        if (!seen.has(req)) violations++;
      }
      seen.add(b.name);
    }
    c.note(`the real ${real.stats.offers}-offer catalogue at $1t: ${real.buy.length} purchases, ${violations} prerequisite violation(s), ${real.restricted.length} group(s) flattened from a partial order`);
    if (violations) c.fail(`${violations} planned purchase(s) would be rejected by the game for unmet prerequisites`);
    for (const r of real.restricted) c.note(`restricted (documented, never illegal): ${r.group.join(" -> ")}`);
  }
  return c;
}

/* ------------------------------------------------------------------------ */

export async function run() {
  return [ap1(), ap2(), ap3(), ap4(), ap5(), await ap6(), ap7(), ap8(), ap9(), ap10()];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const checks = await run();
  for (const c of checks) c.print();
  const fails = checks.reduce((s, c) => s + c.fails.length, 0);
  const warns = checks.reduce((s, c) => s + c.warns.length, 0);
  const examined = checks.reduce((s, c) => s + c.counted, 0);
  console.log(`\n${checks.length} checks, ${examined} things examined, ${fails} FAIL, ${warns} WARN`);
  process.exit(fails ? 1 : 0);
}
