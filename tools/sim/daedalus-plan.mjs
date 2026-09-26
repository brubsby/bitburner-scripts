// Which BitRunners augmentations to buy, and whether to install before the
// Daedalus grind.
//
//   node tools/sim/daedalus-plan.mjs
//
// ---------------------------------------------------------------------------
// The situation. Daedalus is joined. The only thing between us and leaving
// BitNode 1 is The Red Pill: 2.5M Daedalus reputation (Augmentations.ts:1954),
// after which an install wires w0r1d_d43m0n into the network (Prestige.ts:174)
// and backdooring it needs hacking 3000 (Server/data/servers.ts:1553).
//
// Three facts from source drive the whole answer:
//
// 1. Reputation gain is LINEAR in hacking level and in mults.faction_rep, and
//    carries a (1 + favor/100) term (PersonObjects/formulas/reputation.ts:16).
//    Daedalus favor is 0 and BitRunners favor is 131, so the same work earns
//    2.31x less at Daedalus than it does where we are standing right now.
//
// 2. Hacking level is LINEAR in the hacking multiplier and logarithmic in
//    experience (skill.ts:13). So multiplier, not grinding, is the lever — and
//    multiplier feeds reputation linearly via (1).
//
// 3. A QUEUED augmentation does nothing. Multipliers only move at install, and
//    install RESETS faction reputation to 0 and membership to false
//    (Faction.ts:79-83). So every NeuroFlux level bought during the Daedalus
//    grind is inert for the whole grind, and any install must happen strictly
//    before it, never during.
//
// (3) is what makes this a real decision rather than a preference: the
// multiplier we will have accumulated by the end is worth nothing unless we
// stop and install BEFORE starting the 2.5M grind.
//
// ---------------------------------------------------------------------------
// CALIBRATION. Every input below is read from the live save and from
// `.telemetry/` at run time, and the model then reproduces the ONE quantity the
// game itself displays — the Daedalus reputation-per-second readout — before
// any of its conclusions are printed. See the CHECK block.
//
// This is not decoration. The first version of this file was off by ~2.7x
// because it used the wrong `faction_rep` value and omitted the
// cycles-per-second conversion, and the numbers still looked plausible. The
// second failure mode is the one the live reads fix: the inputs were hardcoded
// from a snapshot of the save and went stale within hours — `faction_rep` had
// moved 3.20 -> 3.52, banked exp 1.56e11 -> 1.05e12 and the exp rate 2.8e7 ->
// 1.9e8 while the constants sat still. A model with right formulas and stale
// inputs is wrong in exactly the way nothing catches.
// ---------------------------------------------------------------------------

import "./env.mjs";
import { incomeModel } from "../../trajectory.js";
import { checkWithin, failureCount, livePlayer, measuredBatch, measuredExpRate, measuredRepRate, nfgLevel, report, telemetry, workedFaction } from "./calibrate.mjs";

const MAX_SKILL = 975; // CONSTANTS.MaxSkillLevel
// reputation.ts:13 and donation.ts:8 BOTH carry currentNodeMults.FactionWorkRepGain,
// and this file omitted it for the whole of BitNode 1 — harmlessly, because it is
// 1 there. It is 0.75 in BN4, 0.5 in BN2, 0.6 in BN13, so the omission is a 25-50%
// error the moment the model is pointed anywhere else.
const nodeMults = (await import("./game.bundle.mjs")).getBitNodeMultipliers((await livePlayer()).bitNodeN ?? 1, 1);
const FactionWorkRepGain = nodeMults.FactionWorkRepGain;

// THE FINAL GATE IS NOT 3000 EVERYWHERE. w0r1d_d43m0n's base requirement is
// 3000, and ServerHelpers.ts:423 multiplies it:
//     server.requiredHackingSkill *= currentNodeMults.WorldDaemonDifficulty
// That is 1 in BitNode 1, where this file was written — and 1.5 here in BN5
// (BitNode.tsx case 5), 5 in BN2, 3 in BN4, 2 in several others. Hardcoding
// 3000 understated the real target by 33% in this node and by 5x in BN2, on
// the one number the whole endgame is aimed at. progress.js already computes
// it correctly and publishes `target: 4500`; this file disagreed with it.
const WD_BASE_HACKING = 3000; // Server/data/servers.ts
const WD_TARGET = WD_BASE_HACKING * (nodeMults.WorldDaemonDifficulty ?? 1);
const CYCLES_PER_SEC = 5; // 1000 / CONSTANTS.MilliPerCycle
const CORE_BONUS = (cores) => 1 + (Math.max(1, cores) - 1) / 16; // ServerHelpers getCoreBonus

// --- live state, read now ----------------------------------------------------
const player = await livePlayer();
const state = telemetry("state.json");
const status = telemetry("status.txt");

const HACK_MULT0 = player.mults.hacking;
const FACTION_REP0 = player.mults.faction_rep;
const EXP0 = player.exp.hacking;
const HOME_CORES = state.home.cores;

// calculateCurrentShareBonus() = 1 + ln(shareThreads)/25, where shareThreads
// counts *effective* threads: raw threads x intelligence bonus x the host's
// core bonus (NetworkShare/Share.ts:22-24, :43-48). The `+ 1` is the game's own
// initial value, so the bonus is 1 when nothing is sharing.
const shareThreads =
  1 +
  status.processes
    .filter((p) => p.script === "share.js")
    .reduce((a, p) => a + p.threads * CORE_BONUS(p.host === "home" ? HOME_CORES : 1), 0);
const SHARE_BONUS = 1 + Math.log(shareThreads) / 25;

const BITRUNNERS_REP0 = state.factionRep?.BitRunners?.rep ?? 0;
const BITRUNNERS_FAVOR = state.factionRep?.BitRunners?.favor ?? 0;
const DAEDALUS_REP0 = state.factionRep?.Daedalus?.rep ?? 0;
const DAEDALUS_FAVOR = state.factionRep?.Daedalus?.favor ?? 0;

const expMeas = measuredExpRate(HACK_MULT0);
const batchMeas = measuredBatch();
const EXP_RATE = expMeas.expPerSec; // exp/sec, from the live level curve
// $/sec. batch.js's own attribution FIRST-CHOICE but not only choice: it counts
// money the batcher credits to its targets, which is 0 for the whole early part
// of a life (8 batches in, `earned: 0`) and never includes coding contracts,
// hacknet, or anything else. tel.js measures what the player is ACTUALLY earning
// across every source, which is the quantity plan C needs — "how fast can we
// accumulate $989b" does not care which script earned it.
//
// Live: batch.js said $0/s while tel.js said $234,041/s and 4sigma sat fully
// prepped at 100% money / minimum security. Pricing the donation route off the
// batch figure alone made it UNPRICEABLE for reasons that had nothing to do
// with the plan.
const batchRate = batchMeas.dollarsPerSec;
const liveStatus = telemetry("status.txt");
const liveRate = typeof liveStatus?.incomePerSec === "number" ? liveStatus.incomePerSec : NaN;
const MONEY_RATE = isFinite(liveRate) && liveRate > 0 ? liveRate : batchRate;
const MONEY_SOURCE =
  isFinite(liveRate) && liveRate > 0 ? `tel.js incomePerSec (all sources)` : `batch.js attribution`;
// ZERO IS NOT A RATE, IT IS AN ABSENCE. batch.js reports dollarsPerSec 0 for
// the whole of its prep phase (health "prepping"), which after every install is
// the state this model is most likely to be run in. Plan C's cost is
// `donation / MONEY_RATE`, so a zero silently became Infinity — and ONLY plan C
// divides by it. Plans A and B kept printing finite hours, so the ranking line
// still looked like a ranking while the arm most likely to win had been zeroed
// out. Live: "plan A 24.28 h | plan B 17.53 h | plan C Infinity h" with plan C's
// own components finite at 257 min + 4.45 h.
//
// An unmeasured income must therefore disqualify the COMPARISON, not lose one
// arm of it quietly.
const MONEY_MEASURED = typeof MONEY_RATE === "number" && isFinite(MONEY_RATE) && MONEY_RATE > 0;
// TRAJECTORY, NOT SNAPSHOT. `dollars / rate` assumes today's income holds for
// the whole horizon, and over a horizon of hundreds of hours that is simply
// false — income scales with (level + 50) and the level keeps climbing. Live,
// the flat form priced plan C at 1193 h off $232k/s measured 46 minutes into a
// life; the same donation is 27 h at the $10m/s a mature fleet reaches. A
// ranking dominated by that assumption is not a ranking.
//
// progress.js already prices its futures this way (incomeModel().moneyBy);
// this file did not, so the two disagreed about the same question. Same pure
// module, so they cannot drift apart.
//
// CAVEAT, stated rather than hidden: the model grows exp at EXP_RATE, measured
// while the run was hacking. Much of the Daedalus grind is faction work, which
// earns less hacking exp, so this is optimistic on the rep-grinding stretches.
// It is still far closer than assuming no growth at all, and moneyBy() floors
// at the flat figure so it can never project LESS than the snapshot.
// Built LAZILY. `levelOf` is a const arrow declared further down the file, so
// constructing this at module top level put it in the temporal dead zone
// (`Cannot access 'levelOf' before initialization`). Memoising behind a call
// makes the ordering irrelevant instead of merely currently-correct — the same
// trap cost a suite-wide module load failure in installgate.js today.
let _itraj;
const traj = () => {
  if (_itraj === undefined) {
    _itraj = incomeModel({
      incomePerSec: MONEY_RATE,
      hacking: levelOf(EXP0, HACK_MULT0),
      hackingExp: EXP0,
      hackingMult: HACK_MULT0,
      expPerSec: EXP_RATE,
    });
  }
  return _itraj;
};
const hoursToEarn = (dollars) => {
  if (!MONEY_MEASURED) return NaN;
  if (!(dollars > 0)) return 0;
  const itraj = traj();
  if (!itraj?.grows) return dollars / MONEY_RATE / 3600;
  // moneyBy is monotonic in h, so invert by bisection rather than algebra.
  let hi = 1;
  while (itraj.moneyBy(hi) < dollars && hi < 1e7) hi *= 2;
  if (itraj.moneyBy(hi) < dollars) return Infinity;
  let lo = 0;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (itraj.moneyBy(mid) < dollars) lo = mid;
    else hi = mid;
  }
  return hi;
};

// AND THE EARNING IS NOT SEQUENTIAL WITH THE GRINDING. The old total added
// `hoursToEarn(donation)` to the reputation grind, as though the fleet stopped
// earning while the player worked for a faction. It does not — the batcher runs
// throughout. What plan C actually needs is for the money to be in hand by the
// time the grind ends, so the two overlap and the cost is the LONGER of them,
// not the sum. Money already banked counts too.
// CASH + THE TRADER'S BOOK (nodeecon.wealthOf): where stock.js trades, cash
// is ~$0 on a book worth billions, and the book is what act-liquidate.js
// raises the donation from. A stale or absent stock.txt counts no equity.
const STOCK_TEL = telemetry("stock.txt");
const STOCK_EQUITY = STOCK_TEL && Date.now() - Date.parse(STOCK_TEL.at ?? "") < 10 * 60e3 && Number.isFinite(STOCK_TEL.equity) ? STOCK_TEL.equity : 0;
const MONEY_ON_HAND = (player.money ?? 0) + STOCK_EQUITY;
const planCHours = (grindHours, dollars) => {
  const earn = hoursToEarn(Math.max(0, dollars - MONEY_ON_HAND));
  return Math.max(grindHours, earn) + REBUILD_HOURS + FINAL_INSTALL_HOURS;
};
const hrs = (h) => (Number.isFinite(h) ? `${h.toFixed(2)} h` : "UNPRICED (income not measured)");
const REBUILD_HOURS = 1.0; // install -> fleet and level restored

// NeuroFlux: reputation cost rises 1.14x per level. Above 150 favor reputation
// is simply bought:
// repFromDonation = amount/1e6 * faction_rep * currentNodeMults.FactionWorkRepGain
// (Faction/formulas/donation.ts:8-10). We donate at The Black Hand (354 favor,
// every augmentation already owned).
//
// getAugCost (AugmentationHelpers.ts:132-137): repCost = 500 * 1.14^getLevel(),
// and getLevel() counts owned + queued, so the NEXT level's exponent is the
// number of NFGs already owned plus queued. Derived rather than pasted, then
// checked against what augbuy.js last saw.
const NFG_BASE_REP = 500; // Augmentations.ts:1160
const NFG_BASE_COST = 750e3; // Augmentations.ts:1161
const NFG_LEVEL_MULT = 1.14; // CONSTANTS.NeuroFluxGovernorLevelMult
const NFG_LEVEL0 = nfgLevel(player);
const NFG_NEXT_REP = NFG_BASE_REP * Math.pow(NFG_LEVEL_MULT, NFG_LEVEL0);

// Unowned BitRunners augmentations: rep cost and hacking multiplier.
const BITRUNNERS_AUGS = [
  { name: "Neural Accelerator", rep: 2e5, hack: 1.1 },
  { name: "Cranial Signal Processors G5", rep: 2.5e5, hack: 1.3 },
  { name: "Artificial Bio-neural Network", rep: 2.75e5, hack: 1.12 },
  { name: "BitRunners Neurolink", rep: 8.75e5, hack: 1.15 },
  { name: "Embedded Netburner Module Core V2", rep: 1e6, hack: 1.08 },
];

// favor.ts:12 — repToFavor(r) = ln(1 + r/25000)/ln(1.02), and its inverse.
// Needed before the plans because an install converts the reputation standing
// at that moment into favor (Faction.ts:79) and the (1 + favor/100) term in
// every subsequent grind depends on the result.
const LOG_1P02 = 0.019802627296179712;
const favorToRep = (f) => 25000 * Math.expm1(LOG_1P02 * f);
const repToFavor = (r) => Math.log1p(r / 25000) / LOG_1P02;
/** Faction.ts:79: prestige sets favor = addRepToFavor(favor, playerReputation). */
const favorAfterInstall = (favor, rep) => repToFavor(favorToRep(favor) + rep);

const levelOf = (exp, hackMult) => hackMult * (32 * Math.log(exp + 534.6) - 200);
const repPerSec = (level, factionRep, favor) =>
  CYCLES_PER_SEC * (level / MAX_SKILL) * factionRep * (1 + favor / 100) * SHARE_BONUS * FactionWorkRepGain;
const expFor = (level, hackMult) => Math.exp((level / hackMult + 200) / 32) - 534.6;

/** Grind one faction to `target` rep. Returns hours and money earned meanwhile. */
function grindTo(target, { rep0, favor, hackMult, factionRep, exp }) {
  const dt = 60;
  let rep = rep0;
  let e = exp;
  let t = 0;
  for (; t < 500 * 3600 && rep < target; t += dt) {
    rep += repPerSec(levelOf(e, hackMult), factionRep, favor) * dt;
    e += EXP_RATE * dt;
  }
  return { hours: t / 3600, money: (t * MONEY_RATE) / 1, exp: e };
}

/**
 * How many NeuroFlux levels `cash` buys in ONE install cycle.
 *
 * Two costs, and the second is what actually stops us. The donation that buys
 * the reputation rises 1.14x per level. But the augmentation's own money price
 * is `baseCost * 1.14^level * 1.9^queuedAugs` (AugmentationHelpers.ts:133-138,
 * :29-36) — and every NeuroFlux level already queued counts toward that
 * exponent. So the money price rises by 1.14 * 1.9 = 2.17x per level within a
 * cycle and overtakes the donation after about ten levels.
 *
 * That 1.9^queued term resets at install. It is the reason an intermediate
 * install is not merely "cash in the multiplier early" — it is the only way to
 * buy the next batch of levels at anything like a sane price.
 */
function nfgLevels(cash, factionRep, level0 = 82, queued0 = 0) {
  let n = 0;
  let repCost = NFG_NEXT_REP;
  let level = level0;
  for (;;) {
    const donation = (repCost / factionRep) * 1e6;
    const price = NFG_BASE_COST * Math.pow(1.14, level) * Math.pow(1.9, queued0 + n);
    if (cash < donation + price) return n;
    cash -= donation + price;
    repCost *= 1.14;
    level++;
    n++;
  }
}

const RED_PILL = 2.5e6;

// ---------------------------------------------------------------------------
// CHECK — reproduce what the game is showing, before concluding anything.
//
// `repPerSec` is the single function every plan below is an integral of, so if
// it is wrong by x, every plan's duration is wrong by 1/x and the comparison
// between them can invert. The game displays this number live in the character
// overview and the daemon records it in `.telemetry/history.jsonl`, so there is
// no excuse for not asserting against it.
//
// Tolerance is 5%. The plans differ by hours; 5% of a ten-hour grind is half an
// hour, which is below the gap between any two plans here. An error bigger than
// that means an input is stale and the ranking is not safe to act on.
// ---------------------------------------------------------------------------
console.log("=== CHECK: does this model reproduce the live game? ===");
// Measure whichever faction is actually being worked. Naming Daedalus and
// BitRunners made this check unreachable in any run grinding something else —
// live in BitNode 5 it was CyberSec, so the calibration could never fire and
// every duration below stayed permanently unverified.
const repMeas =
  measuredRepRate(workedFaction() ?? "\u0000none") ?? measuredRepRate("Daedalus") ?? measuredRepRate("BitRunners");
if (!repMeas) {
  console.log("  ----  reputation rate: NOT CALIBRATED — no faction-work window in .telemetry/history.jsonl.");
  console.log("        Start faction work, wait ~5 minutes, and re-run. Until then treat every duration below as unverified.");
} else {
  // Integrate the model over the recorded window rather than evaluating it at a
  // point: the level and the favor both moved during it, and a point estimate
  // would quietly absorb that drift.
  let predicted = 0;
  const s = repMeas.samples;
  for (let i = 1; i < s.length; i++) {
    const dt = (s[i].t - s[i - 1].t) / 1000;
    // Player.focusPenalty() is 0.8 unfocused with no SF4 (FactionWork.tsx:38).
    predicted += repPerSec((s[i - 1].level + s[i].level) / 2, FACTION_REP0, s[i - 1].favor) * (s[i - 1].focused ? 1 : 0.8) * dt;
  }
  checkWithin(
    `${repMeas.faction} rep/sec over ${repMeas.seconds.toFixed(0)}s of game time`,
    predicted / repMeas.seconds,
    repMeas.repPerSec,
    0.05,
    (x) => x.toFixed(2),
  );
}
// The NeuroFlux cost curve decides plan B's whole premise, and augbuy.js prints
// what the game charged it last time it tried.
const nfgLive = telemetry("nfg.txt");
// THE RECORD MUST BE ABOUT THIS LIFE. .telemetry/*.txt survives a prestige and
// a BitNode change, so nfg.txt can describe a run that no longer exists — and
// it says nothing about which life it came from except the level in its own
// text. Cross-checking a BitNode 5 model against a BitNode 1 leftover is not a
// calibration, it is a units error with a timestamp.
//
// Live: nfg.txt dated 2026-09-17 from BitNode 1 at NeuroFlux L115 (1.535e9 rep,
// BitRunners 561 favor, $686t) was compared against this life's L18 (4.6e3 rep)
// and reported "err -100.0%". That FAIL was the model's only failing check, so
// the whole plan printed "unsafe to act on" and the one tool that answers "how
// long left in this BitNode" refused to answer — because of a file from a
// different BitNode.
//
// A level mismatch means the record is not about the level we are pricing, so
// this degrades to "could not cross-check", which is deliberately NOT "fine".
const nfgLevelSeen = nfgLive?.detail ? Number(nfgLive.detail.match(/\bL(\d+):/)?.[1]) : NaN;
const nfgFresh = Number.isFinite(nfgLevelSeen) && nfgLevelSeen === NFG_LEVEL0 + 1;
if (nfgLive?.detail && /\((\d+)\/(\d+)\)/.test(nfgLive.detail) && nfgFresh) {
  checkWithin(
    `NeuroFlux L${NFG_LEVEL0 + 1} rep cost vs augbuy.js's last attempt`,
    NFG_NEXT_REP,
    Number(nfgLive.detail.match(/\((\d+)\/(\d+)\)/)[2]),
    0.01,
    (x) => (x / 1e6).toFixed(1) + "M",
  );
} else if (nfgLive?.detail && Number.isFinite(nfgLevelSeen) && !nfgFresh) {
  console.log(
    `  ----  NeuroFlux rep cost: not cross-checked — nfg.txt describes L${nfgLevelSeen}, this life is at ` +
      `L${NFG_LEVEL0 + 1} (stale record from a previous life/BitNode, dated ${nfgLive.at ?? "unknown"}).`,
  );
} else {
  console.log("  ----  NeuroFlux rep cost: not cross-checked — .telemetry/nfg.txt has no cost line yet");
}
console.log(
  `  inputs: hack x${HACK_MULT0.toFixed(3)}, faction_rep x${FACTION_REP0.toFixed(3)}, exp ${EXP0.toExponential(2)} ` +
    `(level ${levelOf(EXP0, HACK_MULT0).toFixed(0)}), share x${SHARE_BONUS.toFixed(3)}, ` +
    `exp ${EXP_RATE.toExponential(2)}/s, income $${(MONEY_RATE / 1e6).toFixed(3)}m/s via ${MONEY_SOURCE}, NFG L${NFG_LEVEL0}`,
);
console.log(`  Daedalus ${DAEDALUS_REP0.toLocaleString()} rep at favor ${DAEDALUS_FAVOR}; BitRunners ${BITRUNNERS_REP0.toLocaleString()} at favor ${BITRUNNERS_FAVOR}`);
if (report("daedalus-plan") > 0) {
  console.log("\n!! The model does not reproduce the live game. Everything below is unsafe to act on.\n");
}

console.log("\n=== which BitRunners augmentations are reachable ===");
console.log(`BitRunners: ${BITRUNNERS_REP0.toLocaleString()} rep, favor ${BITRUNNERS_FAVOR} (below 150 — cannot donate)\n`);
let cum = 1;
for (const a of BITRUNNERS_AUGS) {
  const g = grindTo(a.rep, {
    rep0: BITRUNNERS_REP0,
    favor: BITRUNNERS_FAVOR,
    hackMult: HACK_MULT0,
    factionRep: FACTION_REP0,
    exp: EXP0,
  });
  cum *= a.hack;
  console.log(
    `  ${a.name.padEnd(34)} ${(a.rep / 1e3).toFixed(0).padStart(4)}k rep  ` +
      `x${a.hack.toFixed(2)}  reach in ${g.hours < 0.02 ? "now" : (g.hours * 60).toFixed(0) + " min"}  (cumulative x${cum.toFixed(3)})`,
  );
}

console.log("\n=== plan A: no intermediate install, grind Daedalus at today's multiplier ===");
const a1 = grindTo(2.75e5, {
  rep0: BITRUNNERS_REP0,
  favor: BITRUNNERS_FAVOR,
  hackMult: HACK_MULT0,
  factionRep: FACTION_REP0,
  exp: EXP0,
});
// No install in this plan, so Daedalus keeps the reputation and favor it has.
const a2 = grindTo(RED_PILL, { rep0: DAEDALUS_REP0, favor: DAEDALUS_FAVOR, hackMult: HACK_MULT0, factionRep: FACTION_REP0, exp: a1.exp });
console.log(`  BitRunners to 275k (top 3 augs): ${(a1.hours * 60).toFixed(0)} min`);
console.log(`  Daedalus to 2.5M at mult ${HACK_MULT0}: ${a2.hours.toFixed(2)} h`);
console.log(`  TOTAL ${(a1.hours + a2.hours).toFixed(2)} h  (augs stay queued and inert throughout)`);

console.log("\n=== plan B: buy all 5, install, then grind Daedalus ===");
const b1 = grindTo(1e6, {
  rep0: BITRUNNERS_REP0,
  favor: BITRUNNERS_FAVOR,
  hackMult: HACK_MULT0,
  factionRep: FACTION_REP0,
  exp: EXP0,
});
const augMult = BITRUNNERS_AUGS.reduce((m, a) => m * a.hack, 1);
const n = nfgLevels(b1.money, FACTION_REP0, NFG_LEVEL0);
const hackMultB = HACK_MULT0 * augMult * Math.pow(1.01, n);
const factionRepB = FACTION_REP0 * Math.pow(1.01, n);
const expAfterRebuild = EXP_RATE * REBUILD_HOURS * 3600;
// The install zeroes Daedalus reputation and converts it to favor first.
const favorB = favorAfterInstall(DAEDALUS_FAVOR, DAEDALUS_REP0);
const b2 = grindTo(RED_PILL, { rep0: 0, favor: favorB, hackMult: hackMultB, factionRep: factionRepB, exp: expAfterRebuild });
console.log(`  BitRunners to 1M (all 5 augs): ${(b1.hours * 60).toFixed(0)} min, earning $${(b1.money / 1e12).toFixed(0)}t`);
console.log(`  that buys ${n} NeuroFlux levels -> x${Math.pow(1.01, n).toFixed(3)} on everything`);
console.log(`  install + rebuild: ${REBUILD_HOURS.toFixed(1)} h`);
console.log(`  post-install: hackMult ${hackMultB.toFixed(2)}, faction_rep ${factionRepB.toFixed(2)}, level ${levelOf(expAfterRebuild, hackMultB).toFixed(0)}`);
console.log(`  Daedalus to 2.5M: ${b2.hours.toFixed(2)} h`);
console.log(`  TOTAL ${(b1.hours + REBUILD_HOURS + b2.hours).toFixed(2)} h`);

console.log("\n=== plan C: bank Daedalus FAVOR before that install, then buy the rep ===");
// Reputation is wiped at install, but not wasted: it is converted to favor
// first (Faction.ts:79, addRepToFavor). And favor is worth far more than the
// (1 + favor/100) work bonus suggests, because at 150 it unlocks donations
// (donation.ts:17, BaseFavorToDonate = 150 and FavorToDonateToFaction = 1 in
// BN1) — after which reputation stops being a grind and becomes a purchase:
//   donationForRep(rep) = rep * 1e6 / mults.faction_rep / FactionWorkRepGain
//                                                          (donation.ts:12)
//
// favorToRep(150) is the exact amount of Daedalus reputation to bank. Banking
// more is wasted: past 150 the only thing extra favor buys is a work bonus we
// will not be using, because we will be donating instead.
const FAVOR_TO_DONATE = 150;
const BANK_REP = favorToRep(FAVOR_TO_DONATE);

// donationForRep uses CONSTANTS.DonateMoneyToRepDivisor = 1e6 (Constants.ts:33).
// This is the number that decides the whole endgame and it is easy to be three
// orders of magnitude wrong about: 2.5M reputation is ~$692 BILLION, not
// trillion. We are holding $91,700b. The Red Pill is not a grind, it is 0.75%
// of the current bank — the only thing standing in front of it is 150 favor.
const donation = (RED_PILL * 1e6) / factionRepB;

// Two variants, differing in how much BitRunners reputation we bother with
// first. Once donations are unlocked the hacking multiplier no longer gates
// The Red Pill at all — it only has to be big enough to make hacking 3000
// cheap after the FINAL install, and ~x7 already makes that instant.
const FINAL_INSTALL_HOURS = 1.0; // second install: rebuild, re-buy port openers, backdoor

for (const [label, brTarget, brAugs] of [
  ["C  all 5 BitRunners augs first", 1e6, BITRUNNERS_AUGS],
  ["C' top 3 only, then Daedalus", 2.75e5, BITRUNNERS_AUGS.slice(0, 3)],
  ["C'' skip BitRunners entirely", BITRUNNERS_REP0, []],
]) {
  const g1 = grindTo(brTarget, {
    rep0: BITRUNNERS_REP0,
    favor: BITRUNNERS_FAVOR,
    hackMult: HACK_MULT0,
    factionRep: FACTION_REP0,
    exp: EXP0,
  });
  // Banking happens BEFORE the install, so it starts from what Daedalus
  // already holds, not from zero.
  const g2 = grindTo(BANK_REP, { rep0: DAEDALUS_REP0, favor: DAEDALUS_FAVOR, hackMult: HACK_MULT0, factionRep: FACTION_REP0, exp: g1.exp });
  const mult = HACK_MULT0 * brAugs.reduce((m, a) => m * a.hack, 1) * Math.pow(1.01, n);
  const total = planCHours(g1.hours + g2.hours, donation);
  const exp3000 = expFor(WD_TARGET, mult);
  console.log(
    `  ${label.padEnd(32)} BitRunners ${(g1.hours * 60).toFixed(0).padStart(3)} min + ` +
      `Daedalus ${g2.hours.toFixed(2)} h -> TOTAL ${hrs(total)} ` +
      `(mult ${mult.toFixed(2)}, hacking ${WD_TARGET} in ${(exp3000 / 3e8 / 60).toFixed(1)} min)`,
  );
}
console.log(`\n  donation for 2.5M rep at faction_rep ${factionRepB.toFixed(2)}: $${(donation / 1e9).toFixed(0)}b`);
console.log(`  Daedalus reputation to bank for ${FAVOR_TO_DONATE} favor: ${BANK_REP.toFixed(0)}`);

const c2 = grindTo(BANK_REP, { rep0: DAEDALUS_REP0, favor: DAEDALUS_FAVOR, hackMult: HACK_MULT0, factionRep: FACTION_REP0, exp: b1.exp });
const cTotal = planCHours(b1.hours + c2.hours, donation);
const aTotal = a1.hours + a2.hours;
const bTotal = b1.hours + REBUILD_HOURS + b2.hours;
console.log(`\nplan A ${aTotal.toFixed(2)} h | plan B ${bTotal.toFixed(2)} h | plan C ${hrs(cTotal)}`);
if (!MONEY_MEASURED) {
  console.log(
    `\n!! NOT A RANKING. Plan C is the donation route — it converts money into reputation — and income is\n` +
      `   unmeasured (batch.js health "${batchMeas.health ?? "?"}", dollarsPerSec ${MONEY_RATE}), so its cost cannot be\n` +
      `   priced at all. A and B do not spend money and are unaffected, which is exactly what makes this\n` +
      `   dangerous: two finite numbers next to one missing one still read as a comparison. Re-run once the\n` +
      `   batcher leaves prep and is earning.`,
  );
}

console.log("\nfavor banked vs reputation spent earning it:");
for (const r of [100e3, 250e3, BANK_REP, 1e6]) {
  console.log(
    `  ${(r / 1e3).toFixed(0).padStart(4)}k rep -> favor ${repToFavor(r).toFixed(1).padStart(5)}` +
      (repToFavor(r) >= FAVOR_TO_DONATE ? "   <- donations unlocked" : `   (work bonus x${(1 + repToFavor(r) / 100).toFixed(2)} only)`),
  );
}

console.log(`\n=== and the final gate: hacking ${WD_TARGET} to backdoor w0r1d_d43m0n (3000 x WorldDaemonDifficulty ${nodeMults.WorldDaemonDifficulty ?? 1}) ===`);
for (const [label, m] of [
  ["today", HACK_MULT0],
  ["+ top 3 BitRunners augs", HACK_MULT0 * 1.1 * 1.3 * 1.12],
  ["plan B (all 5 + NeuroFlux)", hackMultB],
]) {
  const e = expFor(WD_TARGET, m);
  console.log(`  ${label.padEnd(28)} mult ${m.toFixed(2)}  needs ${e.toExponential(2)} exp  = ${(e / 3e8 / 60).toFixed(1)} min at 3e8/s`);
}

// The exit code carries the calibration verdict, so a failed CHECK is visible
// to anything that runs this in a pipeline rather than reading the output.
process.exit(failureCount() ? 1 : 0);
