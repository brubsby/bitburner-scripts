// docs/invariants.md section A — every formula this repo copied must still
// match the game that implements it.
//
//   node tools/test/formulas.test.mjs
//
// ---------------------------------------------------------------------------
// How these checks are built, because the shape is the whole point.
//
// A constant copied into a script or a sentence is a fork, and a fork drifts
// silently. There are two ways to check a fork and they are not equally good:
//
//   SOURCE-VS-SOURCE (strong). Import the game's own function out of
//   tools/sim/game.bundle.mjs and compare its OUTPUT with ours over a sweep of
//   inputs. This survives a rename, a refactor, a change of constant, and a
//   change of shape — nothing about the check depends on the game's text. Most
//   rows below are this, and tools/sim/verify-batch.mjs is the existing worked
//   example of it.
//
//   TEXTUAL (weak). Parse the game's .ts and assert on the expression text,
//   with the file and line cited. Used only where the thing cannot be imported
//   and called: a branch that needs a whole live Player, or a rule that lives
//   inside a React component. Every one of these prints "[textual]" in its
//   note, because a passing textual check proves less than it looks like it
//   does — it will not notice the same logic moving to another file.
//
// The repo side is scanned as text either way, since prose has no output to
// compare. That is the direction A1 actually failed in: the formula was right
// in the game, right in one script, and wrong in three places that describe it.
//
// CALIBRATION: none, and none is needed. Both sides here are formulas — one out
// of ~/Repos/bitburner, one out of this repo — and agreement between them is the
// entire claim. That also bounds what it proves: it says nothing about whether
// the models built on top of these formulas reproduce anything the live game
// displays. tools/sim/calibrate.mjs and verify-alloc-shipped.mjs are where that
// question is asked; C6 in structure.test.mjs is what keeps it being asked.

import { Check } from "./harness.mjs";
import { allFiles, grepRepo, gameSource, gameFunction, dedupeAdjacent, rel as relErr } from "./acd-sources.mjs";
import path from "node:path";

import "../sim/env.mjs";
const g = await import("../sim/game.bundle.mjs");
const sfgate = await import("../../sfgate.js");
const homecost = await import("../../homecost.js");

/* ------------------------------------------------------------- scaffolding */

/** Minimal Player the pricing functions actually read. */
function asPlayer({ bitNode = 1, sf = {}, queued = [], owned = [] } = {}) {
  g.setPlayer({
    bitNodeN: bitNode,
    activeSourceFileLvl: (n) => sf[n] ?? 0,
    queuedAugmentations: queued,
    augmentations: owned,
    hasAugmentation: (n) => owned.some((a) => a.name === n),
    mults: { faction_rep: 1 },
    money: Infinity,
  });
}

/** Run `fn` with BitNode multipliers temporarily moved, then put them back. */
function withMults(patch, fn) {
  const saved = {};
  for (const k of Object.keys(patch)) saved[k] = g.currentNodeMults[k];
  Object.assign(g.currentNodeMults, patch);
  try {
    return fn();
  } finally {
    Object.assign(g.currentNodeMults, saved);
  }
}

const person = ({ hacking = 100, intelligence = 0, charisma = 0, factionRep = 1 } = {}) => ({
  skills: { hacking, intelligence, charisma },
  mults: { faction_rep: factionRep },
});

const NFG = "NeuroFlux Governor";

/**
 * Assert that `fn` scales linearly in one named input.
 *
 * Doubling an input that enters as a bare factor doubles the output. This is
 * what "the formula has N factors" means operationally, and unlike reading the
 * source it keeps working when the source is rearranged.
 */
function scalesLinearlyIn(check, label, at1, at2, ratio = 2) {
  const got = at2 / at1;
  const err = relErr(got, ratio);
  check.note(`${label}: doubling the input scaled the output x${got.toFixed(6)} (want x${ratio})`);
  if (err > 1e-9) check.fail(`${label} is not linear`, `x${got} where x${ratio} was expected`);
  return err <= 1e-9;
}

/* ================================================================== A1 ==== */

/**
 * `repFromDonation = amt / 1e6 * mults.faction_rep * currentNodeMults.FactionWorkRepGain`
 *
 * The third factor was missing from CLAUDE.md, docs/autonomy.md and nfg.js for
 * the whole of BitNode 1, where it is 1 and therefore harmless. It is 0.75 in
 * BN4 and 0.5 in BN2. The repo-side half of this check is the one that matters:
 * the game has never been wrong about this, we have.
 */
function a1() {
  const c = new Check("A1", "repFromDonation has THREE factors (donation.ts:8)");

  // --- game side: prove each factor is load-bearing, by measurement --------
  const base = withMults({ FactionWorkRepGain: 1 }, () => g.repFromDonation(1e6, person({ factionRep: 1 })));
  c.note(`repFromDonation($1e6, faction_rep 1, FactionWorkRepGain 1) = ${base} rep`);
  c.examined(1);

  const doubledAmt = withMults({ FactionWorkRepGain: 1 }, () => g.repFromDonation(2e6, person({ factionRep: 1 })));
  scalesLinearlyIn(c, "factor 1 — donation amount", base, doubledAmt);

  const doubledRep = withMults({ FactionWorkRepGain: 1 }, () => g.repFromDonation(1e6, person({ factionRep: 2 })));
  scalesLinearlyIn(c, "factor 2 — mults.faction_rep", base, doubledRep);

  const doubledNode = withMults({ FactionWorkRepGain: 2 }, () => g.repFromDonation(1e6, person({ factionRep: 1 })));
  scalesLinearlyIn(c, "factor 3 — currentNodeMults.FactionWorkRepGain", base, doubledNode);
  c.examined(3);

  // The divisor, which the prose writes as the literal 1e6.
  if (g.CONSTANTS.DonateMoneyToRepDivisor !== 1e6) {
    c.fail("DonateMoneyToRepDivisor is no longer 1e6", `game says ${g.CONSTANTS.DonateMoneyToRepDivisor}`);
  }
  c.note(`CONSTANTS.DonateMoneyToRepDivisor = ${g.CONSTANTS.DonateMoneyToRepDivisor}`);

  // What the omission actually costs, so the number is on screen rather than
  // implied: BN4's FactionWorkRepGain is 0.75.
  const bn4 = withMults({ FactionWorkRepGain: 0.75 }, () => g.repFromDonation(1e6, person({ factionRep: 1 })));
  c.note(`in a node with FactionWorkRepGain 0.75 the same $1e6 buys ${bn4} rep — the two-factor form is 33% short`);

  // --- repo side: every written statement of the formula -------------------
  //
  // Two tiers, because they are different mistakes.
  //
  //   FAIL — a line that NAMES repFromDonation or donationForRep and writes
  //          out its factors. That is a statement of the formula, and one
  //          missing FactionWorkRepGain is simply wrong.
  //   WARN — a line that reasons about rep-per-dollar from `faction_rep` and
  //          the 1e6 divisor without naming the function. nfg.js's "faction_rep
  //          >= 1 so this is an upper bound" is the live instance: the bound
  //          only holds while FactionWorkRepGain >= 1/faction_rep. Already
  //          registered in tools/sim/bncheck.mjs, so it is a warning here
  //          rather than a second red line about the same known trade.
  //
  // Both tiers exempt a window that is *about* the omission — several files
  // quote the two-factor form in order to say it is wrong, and failing those
  // would make the check unkeepable and therefore deleted.
  const discussing = /two-factor|shorthand|drops\b|omit|is wrong|was stated|missing|break-even|does not know it exists|invariants\.md/i;
  // The donation divisor written as an operand: `/ 1e6`, `* 1e6`, `1e6 *`, or
  // the constant by name. `startingMoney: 1e6` and `75e6` are neither.
  const DIVISOR = /([/*]\s*1e6\b)|(\b1e6\s*[/*])|DonateMoneyToRepDivisor/;
  const named = dedupeAdjacent(grepRepo(/repFromDonation|donationForRep/, { pad: 3 }));
  let live = 0;
  let frozen = 0;
  for (const h of named) {
    c.examined(1);
    // Either BitNode rep term counts: the faction formula multiplies by
    // FactionWorkRepGain (reputation.ts:13), the company formula by
    // CompanyWorkRepGain (Work/Formulas.ts:156). A statement naming its own
    // node term is complete; the failure this hunts is naming NEITHER.
    if (/FactionWorkRepGain|CompanyWorkRepGain/.test(h.window)) continue;
    if (discussing.test(h.window)) continue;
    // A statement of the formula writes the divisor. A line that merely cites
    // the function ("PCMatrix's faction_rep 1.0777 compounds in repFromDonation")
    // is true and is not a formula.
    if (!/faction_rep/.test(h.window) || !DIVISOR.test(h.window)) continue;
    if (h.frozen) {
      frozen++;
      c.warn(`two-factor donation formula in a frozen copy — ${h.file}:${h.line}`, h.text);
    } else {
      live++;
      c.fail(`states repFromDonation with TWO factors — ${h.file}:${h.line}`, `${h.text}\n       missing currentNodeMults.FactionWorkRepGain`);
    }
  }

  const implied = dedupeAdjacent(
    grepRepo(/faction_rep/, { pad: 2 }).filter((h) => DIVISOR.test(h.window) && !/repFromDonation|donationForRep/.test(h.window)),
  );
  let assumed = 0;
  for (const h of implied) {
    c.examined(1);
    if (/FactionWorkRepGain/.test(h.window) || discussing.test(h.window) || h.frozen) continue;
    assumed++;
    c.warn(`rep-per-dollar reasoning without the third factor — ${h.file}:${h.line}`, `${h.text}\n       the bound holds only while FactionWorkRepGain >= 1/faction_rep (bncheck.mjs registers this)`);
  }

  c.note(`scanned ${named.length} named statements of the donation formula and ${implied.length} implied ones — ${live} live drift, ${frozen} frozen, ${assumed} unstated assumptions`);
  return c;
}

/* ================================================================== A2 ==== */

function a2() {
  const c = new Check("A2", "favorNeededToDonate() = floor(150 * FavorToDonateToFaction) (donation.ts:17)");

  if (g.CONSTANTS.BaseFavorToDonate !== 150) {
    c.fail("BaseFavorToDonate is no longer 150", `game says ${g.CONSTANTS.BaseFavorToDonate}`);
  }
  c.note(`CONSTANTS.BaseFavorToDonate = ${g.CONSTANTS.BaseFavorToDonate}`);
  c.examined(1);

  // floor(), and the multiplier, measured across the values real BitNodes use.
  for (const m of [1, 0.5, 0.75, 0.3, 0]) {
    const want = Math.floor(150 * m);
    const got = withMults({ FavorToDonateToFaction: m }, () => g.favorNeededToDonate());
    c.examined(1);
    c.note(`FavorToDonateToFaction ${m} -> favorNeededToDonate ${got} (want ${want})`);
    if (got !== want) c.fail(`favorNeededToDonate wrong at multiplier ${m}`, `got ${got}, want ${want}`);
  }

  // --- repo side -----------------------------------------------------------
  // nfg.js hardcodes the 150 and does not read the multiplier. That is a
  // legitimate in-game RAM trade (CLAUDE.md's Fidelity rule) only if it is
  // registered as a BitNode assumption; C5 owns the registration check, so this
  // one just asserts the hardcoded number still equals the game's base.
  const hits = grepRepo(/MIN_FAVOR\s*=\s*(\d+)|FAVOR_TO_DONATE\s*=\s*(\d+)/);
  for (const h of hits) {
    c.examined(1);
    const n = Number((h.text.match(/=\s*(\d+)/) || [])[1]);
    c.note(`${h.file}:${h.line} hardcodes favor threshold ${n}`);
    if (n !== g.CONSTANTS.BaseFavorToDonate) {
      c.fail(`${h.file}:${h.line} hardcodes ${n}, game's BaseFavorToDonate is ${g.CONSTANTS.BaseFavorToDonate}`, h.text);
    }
  }
  if (!hits.length) c.warn("no hardcoded favor threshold found to check", "the grep may have gone stale — A2 examined nothing on the repo side");
  return c;
}

/* ================================================================== A3 ==== */

function a3() {
  const c = new Check("A3", "repToFavor / favorToRep, and favorToRep(150) = 462,490 (favor.ts:12)");

  const at150 = g.favorToRep(150);
  c.note(`favorToRep(150) = ${at150.toFixed(4)}`);
  c.examined(1);
  if (Math.round(at150) !== 462490) c.fail("favorToRep(150) has moved", `game says ${at150}`);

  // The repo writes the formula as ln(1+r/25000)/ln(1.02). The game uses a
  // hand-written log(1.02) because the literal 1.02 lacks the precision
  // (favor.ts:10). Assert the two agree to the tolerance the repo's own number
  // is quoted at — six significant figures.
  const ours = (r) => Math.log(1 + r / 25000) / Math.log(1.02);
  let worst = 0;
  for (const r of [1, 1e3, 25000, 462490, 1e6, 1e9, 1e12]) {
    const e = relErr(ours(r), g.repToFavor(r));
    if (e > worst) worst = e;
    c.examined(1);
  }
  c.note(`ln(1+r/25000)/ln(1.02) vs the game's repToFavor: worst relative error ${worst.toExponential(3)} over 7 magnitudes`);
  if (worst > 1e-6) c.fail("the repo's written repToFavor disagrees with the game's", `worst relative error ${worst}`);

  // Round trip, which is what "bank exactly favorToRep(150)" relies on.
  const rt = relErr(g.repToFavor(g.favorToRep(150)), 150);
  c.note(`round trip repToFavor(favorToRep(150)) error ${rt.toExponential(3)}`);
  if (rt > 1e-9) c.fail("favorToRep/repToFavor do not round-trip", `error ${rt}`);

  // --- repo side: every quoted value of favorToRep(150) --------------------
  const hits = grepRepo(/462[,.]?490/);
  for (const h of hits) {
    c.examined(1);
    const n = Number((h.text.match(/462[,.]?490/) || [""])[0].replace(/[,.]/g, ""));
    if (n !== Math.round(at150)) c.fail(`${h.file}:${h.line} quotes ${n}`, h.text);
  }
  c.note(`checked ${hits.length} quotations of favorToRep(150) in the repo`);
  if (!hits.length) c.warn("nothing in the repo quotes favorToRep(150)", "the constant the endgame is sized off is not written down anywhere the check can see");
  return c;
}

/* ================================================================== A4 ==== */

function a4() {
  const c = new Check("A4", "NeuroFlux cost = base * 1.14^level * 1.9^queued, queued counting NFG itself");

  const aug = g.Augmentations[NFG];
  const LEV = g.CONSTANTS.NeuroFluxGovernorLevelMult;
  const MULT = g.CONSTANTS.MultipleAugMultiplier;
  c.note(`NeuroFluxGovernorLevelMult = ${LEV}, MultipleAugMultiplier = ${MULT}, baseCost $${aug.baseCost}, baseRep ${aug.baseRepRequirement}`);
  if (LEV !== 1.14) c.fail("NeuroFluxGovernorLevelMult is no longer 1.14", `game says ${LEV}`);
  if (MULT !== 1.9) c.fail("MultipleAugMultiplier is no longer 1.9", `game says ${MULT}`);
  c.examined(2);

  // Sweep owned levels x queued NFGs x other queued augs. The point of the
  // sweep is the *interaction*: every queued NFG counts BOTH as a level and as
  // a price multiplier, which is what makes the wall arrive at ~12 rather than
  // ~25.
  let worstMoney = 0;
  let worstRep = 0;
  let where = "";
  for (const ownedLvl of [0, 1, 5, 12]) {
    for (const queuedNfg of [0, 1, 3]) {
      for (const otherQueued of [0, 2]) {
        const owned = ownedLvl ? [{ name: NFG, level: ownedLvl }] : [];
        const queued = [
          ...Array.from({ length: queuedNfg }, () => ({ name: NFG })),
          ...Array.from({ length: otherQueued }, (_, i) => ({ name: `filler-${i}` })),
        ];
        asPlayer({ owned, queued });
        const got = g.getAugCost(aug);
        const level = ownedLvl + queuedNfg;
        const queuedCount = queuedNfg + otherQueued;
        const wantMoney = aug.baseCost * LEV ** level * MULT ** queuedCount;
        const wantRep = aug.baseRepRequirement * LEV ** level;
        const em = relErr(got.moneyCost, wantMoney);
        const er = relErr(got.repCost, wantRep);
        if (em > worstMoney) {
          worstMoney = em;
          where = `owned L${ownedLvl}, ${queuedNfg} queued NFG, ${otherQueued} other: game $${got.moneyCost} vs model $${wantMoney}`;
        }
        if (er > worstRep) worstRep = er;
        c.examined(1);
      }
    }
  }
  c.note(`24 (owned level x queued NFG x other queued) combinations: worst money error ${worstMoney.toExponential(3)}, worst rep error ${worstRep.toExponential(3)}`);
  if (worstMoney > 1e-9) c.fail("NFG money price does not match base * 1.14^level * 1.9^queued", where);
  if (worstRep > 1e-9) c.fail("NFG reputation price does not match base * 1.14^level", "rep must NOT carry the 1.9^queued term");

  // The specific claim "queued counting NFG itself", isolated.
  asPlayer({ owned: [], queued: [] });
  const l0 = g.getAugCost(aug).repCost;
  asPlayer({ owned: [], queued: [{ name: NFG }] });
  const l1 = g.getAugCost(aug).repCost;
  c.note(`one QUEUED NeuroFlux raises the next level's rep cost ${l0} -> ${l1} (x${(l1 / l0).toFixed(4)})`);
  if (relErr(l1 / l0, LEV) > 1e-9) c.fail("a queued NeuroFlux does not count toward its own level", `ratio ${l1 / l0}, want ${LEV}`);
  c.examined(1);

  // Where the wall lands, printed rather than asserted — it is a consequence,
  // not an invariant, and the number in the docs is "~12".
  const perLevel = LEV * MULT;
  c.note(`price climbs x${perLevel.toFixed(2)} per level bought in one install window (1.14 * 1.9) — 12 levels is x${(perLevel ** 12).toExponential(2)}`);
  return c;
}

/* ================================================================== A5 ==== */

function a5() {
  const c = new Check("A5", "aug money cost x1.9 per queued non-SoA aug; reputation cost does not scale");

  const aug = g.Augmentations["Augmented Targeting I"];
  const soa = g.soaAugmentationNames;
  c.note(`${soa.length} SoA augmentations are excluded from the queued count (AugmentationHelpers.ts:29-36)`);

  let worst = 0;
  for (const n of [0, 1, 2, 5, 10]) {
    asPlayer({ queued: Array.from({ length: n }, (_, i) => ({ name: `filler-${i}` })) });
    const got = g.getAugCost(aug);
    const wantMoney = aug.baseCost * g.CONSTANTS.MultipleAugMultiplier ** n;
    worst = Math.max(worst, relErr(got.moneyCost, wantMoney));
    c.examined(1);
    if (got.repCost !== aug.baseRepRequirement) {
      c.fail(`reputation cost scaled with ${n} queued augs`, `got ${got.repCost}, base ${aug.baseRepRequirement}`);
    }
  }
  c.note(`queued 0..10: worst money error vs base * 1.9^queued = ${worst.toExponential(3)}; rep cost held at ${aug.baseRepRequirement} throughout`);
  if (worst > 1e-9) c.fail("money cost does not scale 1.9^queued", `worst error ${worst}`);

  // SoA augs must NOT count toward the exponent.
  asPlayer({ queued: soa.slice(0, 3).map((name) => ({ name })) });
  const withSoa = g.getAugCost(aug).moneyCost;
  c.examined(1);
  c.note(`3 queued SoA augmentations -> money cost $${withSoa} (base $${aug.baseCost}); they must not count`);
  if (relErr(withSoa, aug.baseCost) > 1e-9) c.fail("SoA augmentations counted toward the price multiplier", `$${withSoa} vs base $${aug.baseCost}`);

  // The row says 1.9 flat. It is 1.9 only at SF11 level 0 — print the ladder,
  // because "buy most-expensive-first" is sized off this number.
  for (const lvl of [0, 1, 2, 3]) {
    asPlayer({ sf: { 11: lvl } });
    c.examined(1);
    c.note(`SF11 level ${lvl}: base price multiplier ${g.getBaseAugmentationPriceMultiplier().toFixed(4)}`);
  }
  asPlayer({ sf: {} });
  if (relErr(g.getBaseAugmentationPriceMultiplier(), 1.9) > 1e-9) {
    c.fail("base price multiplier at SF11 level 0 is not 1.9", `${g.getBaseAugmentationPriceMultiplier()}`);
  }
  return c;
}

/* ================================================================== A6 ==== */

function a6() {
  const c = new Check("A6", "homecost.js reproduces getUpgradeHomeRamCost / getUpgradeHomeCoresCost");

  // The game's functions take `this`; a stand-in with getHomeComputer() is all
  // either of them touches (PlayerObjectServerMethods.ts:30,42).
  const as = (maxRam, cpuCores) => ({ getHomeComputer: () => ({ maxRam, cpuCores }) });
  asPlayer({});

  let worstRam = 0;
  let ramWhere = "";
  for (let p = 3; p <= 30; p++) {
    const ram = 2 ** p;
    const want = withMults({ HomeComputerRamCost: 1 }, () => g.getUpgradeHomeRamCost.call(as(ram, 1)));
    const got = homecost.ramUpgradeCost(ram);
    const e = relErr(got, want);
    if (e > worstRam) {
      worstRam = e;
      ramWhere = `${ram}GB: game $${want.toExponential(6)} ours $${got.toExponential(6)}`;
    }
    c.examined(1);
  }
  c.note(`RAM upgrade cost over every doubling 8GB..2^30GB: worst relative error ${worstRam.toExponential(3)}`);
  if (worstRam > 1e-9) c.fail("homecost.ramUpgradeCost has drifted", ramWhere);

  let worstCore = 0;
  for (let cores = 1; cores <= 8; cores++) {
    const want = g.getUpgradeHomeCoresCost.call(as(8, cores));
    worstCore = Math.max(worstCore, relErr(homecost.coreUpgradeCost(cores), want));
    c.examined(1);
  }
  c.note(`core upgrade cost for 1..8 cores: worst relative error ${worstCore.toExponential(3)}`);
  if (worstCore > 1e-9) c.fail("homecost.coreUpgradeCost has drifted", "");

  // Caps.
  c.note(`MAX_HOME_RAM ${homecost.MAX_HOME_RAM} vs ServerConstants.HomeComputerMaxRam ${g.ServerConstants.HomeComputerMaxRam}`);
  c.examined(1);
  if (homecost.MAX_HOME_RAM !== g.ServerConstants.HomeComputerMaxRam) {
    c.fail("MAX_HOME_RAM is not the game's HomeComputerMaxRam", `${homecost.MAX_HOME_RAM} vs ${g.ServerConstants.HomeComputerMaxRam}`);
  }

  // The 8-core cap lives in a React component and cannot be imported. Textual,
  // and labelled as such.
  const coresBtn = gameSource("src/Locations/ui/CoresButton.tsx");
  const capLine = coresBtn.split("\n").findIndex((l) => /cpuCores\s*>=\s*(\d+)/.test(l));
  const capNum = Number((coresBtn.match(/cpuCores\s*>=\s*(\d+)/) || [])[1]);
  c.examined(1);
  c.note(`[textual] Locations/ui/CoresButton.tsx:${capLine + 1} caps cores at ${capNum}; homecost.MAX_HOME_CORES = ${homecost.MAX_HOME_CORES}`);
  if (!Number.isFinite(capNum)) {
    c.warn("could not find the core cap in CoresButton.tsx", "the textual check found no `cpuCores >= N` — it may have moved");
  } else if (capNum !== homecost.MAX_HOME_CORES) {
    c.fail("MAX_HOME_CORES disagrees with the game's UI cap", `game ${capNum}, ours ${homecost.MAX_HOME_CORES}`);
  }

  // HomeComputerRamCost is a BitNode multiplier homecost.js deliberately does
  // not read. Show what it costs to be wrong about, so the trade stays visible.
  const bn = withMults({ HomeComputerRamCost: 1.5 }, () => g.getUpgradeHomeRamCost.call(as(16384, 1)));
  c.note(`HomeComputerRamCost is not read by homecost.js: at 1.5 the 16TB upgrade is $${bn.toExponential(3)} vs our $${homecost.ramUpgradeCost(16384).toExponential(3)}`);
  return c;
}

/* ================================================================== A7 ==== */

function a7() {
  const c = new Check("A7", "getHackingWorkRepGain factors (reputation.ts:16)");

  const at = (opts, favor = 0) => g.getHackingWorkRepGain(person(opts), favor);
  const base = withMults({ FactionWorkRepGain: 1 }, () => at({ hacking: 100 }));
  c.note(`getHackingWorkRepGain(hacking 100, faction_rep 1, favor 0, share 1) = ${base} rep/cycle`);
  c.examined(1);

  withMults({ FactionWorkRepGain: 1 }, () => {
    scalesLinearlyIn(c, "hacking level", base, at({ hacking: 200 }));
    scalesLinearlyIn(c, "mults.faction_rep", base, at({ factionRep: 2 }));
    scalesLinearlyIn(c, "(1 + favor/100)", base, at({ hacking: 100 }, 100));
  });
  c.examined(3);

  // Factor four, which docs/invariants.md's own row A7 does not list.
  const doubledNode = withMults({ FactionWorkRepGain: 2 }, () => at({ hacking: 100 }));
  scalesLinearlyIn(c, "currentNodeMults.FactionWorkRepGain", base, doubledNode);
  c.examined(1);

  // The divisor.
  c.note(`CONSTANTS.MaxSkillLevel = ${g.CONSTANTS.MaxSkillLevel}; share bonus in this process = ${g.calculateCurrentShareBonus()}`);
  if (g.CONSTANTS.MaxSkillLevel !== 975) c.fail("MaxSkillLevel is no longer 975", `game says ${g.CONSTANTS.MaxSkillLevel}`);
  c.examined(1);

  // --- repo side -----------------------------------------------------------
  // The repo's model of this is `(level/975) * faction_rep * (1+favor/100) *
  // share`, in docs/roadmap.md and in tools/sim/daedalus-plan.mjs. That is the
  // same omission as A1, in the other rep channel.
  const ourModel = (level, factionRep, favor, share) => (level / 975) * factionRep * (1 + favor / 100) * share;
  const gameAt = (level, factionRep, favor, fwrg) =>
    withMults({ FactionWorkRepGain: fwrg }, () => g.getHackingWorkRepGain(person({ hacking: level, factionRep }), favor));

  const inBn1 = relErr(ourModel(213, 1, 0, 1), gameAt(213, 1, 0, 1));
  const inBn4 = relErr(ourModel(213, 1, 0, 1), gameAt(213, 1, 0, 0.75));
  c.note(`the repo's rep-rate model vs the game: error ${(inBn1 * 100).toFixed(4)}% at FactionWorkRepGain 1, ${(inBn4 * 100).toFixed(2)}% at 0.75`);
  c.examined(2);
  if (inBn1 > 1e-9) c.fail("the repo's rep-rate model disagrees with the game even in BitNode 1", `relative error ${inBn1}`);

  // A statement of this formula is a `/975` (or MaxSkillLevel/MAX_SKILL)
  // divisor with a `(1 + favor/100)` term near it. A bare mention of the
  // function name is not — go.js says "faction_rep is a direct factor in
  // getHackingWorkRepGain", which is true and not a formula.
  const stmts = dedupeAdjacent(
    grepRepo(/\b975\b|MaxSkillLevel|MAX_SKILL/, { pad: 3 }).filter(
      (h) => /favor\s*\/\s*100(?!\d)/.test(h.window) && h.file !== "docs/invariants.md",
    ),
  );
  const discussing = /omit|drops\b|is wrong|no favor term|does not list/i;
  for (const h of stmts) {
    c.examined(1);
    if (/FactionWorkRepGain/.test(h.window)) continue;
    if (discussing.test(h.window)) continue;
    if (h.frozen) c.warn(`rep-gain formula without FactionWorkRepGain in a frozen copy — ${h.file}:${h.line}`, h.text);
    else c.fail(`states getHackingWorkRepGain without currentNodeMults.FactionWorkRepGain — ${h.file}:${h.line}`, h.text);
  }
  c.note(`scanned ${stmts.length} written statements of the rep-gain formula (docs/invariants.md excluded — see below)`);

  // The spec row itself. Reported once, deliberately, rather than as one more
  // line in the list above: docs/invariants.md row A7 lists four factors and
  // the game applies five (FactionWorkRepGain), plus an intelligence bonus and
  // an SF15 charisma term that are both identity at BN1 with no intelligence.
  c.warn(
    "docs/invariants.md row A7 is itself incomplete",
    "it lists hacking level, faction_rep, (1+favor/100) and the share bonus.\n" +
      "reputation.ts:13 also multiplies by currentNodeMults.FactionWorkRepGain, and :19-21 by\n" +
      "calculateIntelligenceBonus(int, 1) and (int/3 + SF15>=3 ? charisma*0.1 : 0) in the numerator.\n" +
      "All three are identity in BitNode 1 with no intelligence, which is why the row reads right.",
  );
  return c;
}

/* ================================================================== A8 ==== */

function a8() {
  const c = new Check("A8", "w0r1d_d43m0n needs 3000 * WorldDaemonDifficulty (servers.ts / ServerHelpers.ts)");

  const wd = g.serverMetadata.find((s) => String(s.hostname) === "w0r1d_d43m0n" || String(s.specialName) === "w0r1d_d43m0n");
  c.examined(1);
  if (!wd) {
    c.fail("w0r1d_d43m0n is not in serverMetadata", "the host may have been renamed");
    return c;
  }
  c.note(`serverMetadata w0r1d_d43m0n.requiredHackingSkill = ${wd.requiredHackingSkill}`);
  if (wd.requiredHackingSkill !== 3000) c.fail("the base requirement is no longer 3000", `game says ${wd.requiredHackingSkill}`);

  // Where the multiplier is applied. This one is textual: it happens inside
  // initForeignServers, which needs a whole game world to call.
  const helpers = gameSource("src/Server/ServerHelpers.ts").split("\n");
  const idx = helpers.findIndex((l) => /requiredHackingSkill\s*\*=\s*currentNodeMults\.WorldDaemonDifficulty/.test(l));
  c.examined(1);
  if (idx < 0) {
    c.fail("WorldDaemonDifficulty is no longer applied in ServerHelpers.ts", "the scaling may have moved — the endgame gate is now unverified");
  } else {
    c.note(`[textual] Server/ServerHelpers.ts:${idx + 1}  ${helpers[idx].trim()}`);
  }

  // The per-BitNode numbers the repo quotes, against the game's own pure
  // function of the BitNode number. This is the part that would actually be
  // wrong on arrival somewhere new, and it is checkable for nodes never entered.
  const claimed = { 1: 3000, 2: 15000, 4: 9000 };
  for (const [n, want] of Object.entries(claimed)) {
    const mult = g.getBitNodeMultipliers(Number(n), 1).WorldDaemonDifficulty;
    const real = wd.requiredHackingSkill * mult;
    c.examined(1);
    c.note(`BitNode ${n}: WorldDaemonDifficulty ${mult} -> hacking ${real} (repo says ${want})`);
    if (real !== want) c.fail(`the repo's stated world-daemon level for BitNode ${n} is wrong`, `repo ${want}, game ${real}`);
  }

  const hits = grepRepo(/w0r1d_d43m0n|WorldDaemonDifficulty/, { pad: 1 }).filter((h) => /\b(9000|15000|6000)\b/.test(h.window));
  c.note(`${hits.length} repo line(s) quote a scaled world-daemon level: ${hits.map((h) => `${h.file}:${h.line}`).join(", ") || "none"}`);
  return c;
}

/* ============================================================== A9, A10 === */

function a9() {
  const c = new Check("A9", "Go getDifficultyMultiplier = (komi+0.5)*0.25, independent of board size");

  const KOMI = [1.5, 3.5, 5.5, 7.5];
  const SIZES = [5, 7, 9, 13, 19];
  const illuminatiKomi = g.opponentDetails[g.GoOpponent.Illuminati].komi;
  c.note(`Illuminati komi = ${illuminatiKomi}; the one board-size-dependent case is 5x5 against it`);

  let bad = 0;
  for (const komi of KOMI) {
    for (const size of SIZES) {
      const got = g.getDifficultyMultiplier(komi, size);
      const special = size === 5 && komi === illuminatiKomi;
      const want = special ? 8 : (komi + 0.5) * 0.25;
      c.examined(1);
      if (relErr(got, want) > 1e-12) {
        bad++;
        c.fail(`getDifficultyMultiplier(${komi}, ${size}) = ${got}, want ${want}`, "");
      }
    }
  }
  c.note(`${KOMI.length * SIZES.length} (komi, board size) combinations checked, ${bad} disagreed`);

  // The decision this drives: 13x13 vs 9x9 against the same opponent.
  const d = g.getDifficultyMultiplier(5.5, 13);
  c.note(`Daedalus komi 5.5 -> multiplier ${d} on every board size (so board choice is decided by score, not difficulty)`);

  // go.js states this formula in its header; check the text still says it.
  const stated = grepRepo(/\(komi\s*\+\s*0\.5\)\s*\*\s*0\.25/);
  c.note(`${stated.length} file(s) state (komi+0.5)*0.25: ${stated.map((h) => `${h.file}:${h.line}`).join(", ") || "none"}`);
  c.examined(stated.length);
  return c;
}

function a10() {
  const c = new Check("A10", "Go winstreak multiplier caps at x3 at 8 wins; negative streak is x0.5");

  const cases = [
    [-5, 0, 0.5],
    [-1, 0, 0.5],
    [0, 0, 1],
    [1, 0, 1.25],
    [4, 0, 2],
    [8, 0, 3],
    [20, 0, 3],
  ];
  for (const [streak, prev, want] of cases) {
    const got = g.getWinstreakMultiplier(streak, prev);
    c.examined(1);
    c.note(`getWinstreakMultiplier(${streak}, ${prev}) = ${got} (want ${want})`);
    if (relErr(got, want) > 1e-12) c.fail(`winstreak multiplier wrong at streak ${streak}`, `got ${got}, want ${want}`);
  }

  // The branch docs/invariants.md's row A10 does not mention: breaking a dry
  // streak pays up to 5x, which is larger than the cap the row describes.
  const dry = g.getWinstreakMultiplier(1, -8);
  c.examined(1);
  c.note(`breaking an 8-game losing streak pays x${dry} — larger than the x3 cap the invariant row describes (effect.ts:122-126)`);
  if (relErr(dry, 5) > 1e-12) c.fail("the dry-streak-broken bonus is no longer 5x at 8", `got ${dry}`);
  return c;
}

/* ================================================================= A11 ==== */

function a11() {
  const c = new Check("A11", "Go cheat access = sf14 > 1 || (sf14 === 1 && bitNode === 14)");

  // sfgate.js is the repo's copy of this rule and is pure, so it can simply be
  // run against the game's own condition over the whole grid.
  const gameRule = (sf14, node) => sf14 > 1 || (sf14 === 1 && node === 14);
  let bad = 0;
  for (let sf14 = 0; sf14 <= 3; sf14++) {
    for (const node of [1, 4, 13, 14]) {
      const resetInfo = { ownedSF: new Map([[14, sf14]]), currentNode: node };
      const ours = sfgate.canUseGoCheat(resetInfo);
      const want = gameRule(sf14, node);
      c.examined(1);
      if (ours !== want) {
        bad++;
        c.fail(`sfgate.canUseGoCheat(sf14=${sf14}, BN${node}) = ${ours}, game says ${want}`, "");
      }
    }
  }
  c.note(`16 (SF14 level x BitNode) combinations checked against the rule, ${bad} disagreed`);

  // And that the game's rule is still the one written above. Textual: the check
  // is a `throw` inside a NetscriptContext, so it cannot be called from here.
  const fn = gameFunction("src/Go/effects/netscriptGoImplementation.ts", "checkCheatApiAccess");
  c.examined(1);
  if (!fn) {
    c.fail("checkCheatApiAccess not found in netscriptGoImplementation.ts", "the rule may have moved; A11 is now unverified on the game side");
  } else {
    const hasLevel = /activeSourceFileLvl\(14\)\s*>\s*1/.test(fn.text);
    const hasNode = /activeSourceFileLvl\(14\)\s*===\s*1/.test(fn.text) && /bitNodeN\s*===\s*14/.test(fn.text);
    c.note(`[textual] ${fn.file}:${fn.line} checkCheatApiAccess — level>1 clause ${hasLevel ? "present" : "MISSING"}, in-BN14 clause ${hasNode ? "present" : "MISSING"}`);
    if (!hasLevel || !hasNode) c.fail("the game's cheat gate no longer matches sf14>1 || (sf14===1 && BN14)", fn.text.slice(0, 400));
  }

  // The capability being unused is itself the A11 failure mode ("Silent.
  // Capability exists and is never used"), so say whether anything calls it.
  const callers = grepRepo(/canUseGoCheat|go\.cheat\./).filter((h) => !h.frozen && !/sfgate\.js/.test(h.file));
  c.note(`callers of the cheat capability in live code: ${callers.map((h) => `${h.file}:${h.line}`).join(", ") || "NONE"}`);
  if (!callers.length) c.warn("nothing in live code gates on canUseGoCheat", "the rule is correct and unused — exactly the A11 failure mode");
  return c;
}

/* ================================================================= A12 ==== */

function a12() {
  const c = new Check("A12", "home RAM at BitNode entry: 128 (SF9>=2) / 32 (SF1>0) / 8 (Prestige.ts)");

  // Textual on the game side — the branch lives in the middle of
  // prestigeSourceFile and needs an entire game world to execute.
  const src = gameSource("src/Prestige.ts").split("\n");
  const idx = src.findIndex((l) => /setMaxRam\(/.test(l));
  const block = src.slice(Math.max(0, idx - 3), idx + 6).join("\n");
  const rules = [...block.matchAll(/activeSourceFileLvl\((\d+)\)\s*(>=?|===)\s*(\d+)[\s\S]*?setMaxRam\((\d+)\)/g)].map((m) => ({
    sf: Number(m[1]),
    op: m[2],
    lvl: Number(m[3]),
    ram: Number(m[4]),
  }));
  const fallback = Number((block.match(/else\s*\{\s*\n?\s*\w+\.setMaxRam\((\d+)\)/) || [])[1]);
  c.examined(1);
  c.note(`[textual] Prestige.ts:${idx + 1} — ${rules.map((r) => `SF${r.sf}${r.op}${r.lvl} -> ${r.ram}GB`).join(", ")}, else ${fallback}GB`);

  const expect = [
    { sf: 9, op: ">=", lvl: 2, ram: 128 },
    { sf: 1, op: ">", lvl: 0, ram: 32 },
  ];
  if (rules.length !== 2 || fallback !== 8) {
    c.fail("the home-RAM-on-entry ladder in Prestige.ts is not the shape sfgate.js assumes", block);
  } else {
    for (let i = 0; i < 2; i++) {
      const r = rules[i];
      const e = expect[i];
      if (r.sf !== e.sf || r.lvl !== e.lvl || r.ram !== e.ram) {
        c.fail(`Prestige.ts rule ${i} is SF${r.sf}${r.op}${r.lvl} -> ${r.ram}GB`, `sfgate.js assumes SF${e.sf}${e.op}${e.lvl} -> ${e.ram}GB`);
      }
    }
  }

  // The repo side is pure and can be run.
  const grid = [
    [{ 9: 2 }, 128],
    [{ 9: 3 }, 128],
    [{ 9: 1, 1: 1 }, 32],
    [{ 1: 3 }, 32],
    [{}, 8],
    [{ 9: 1 }, 8],
  ];
  for (const [sf, want] of grid) {
    const got = sfgate.homeStartRam({ ownedSF: new Map(Object.entries(sf).map(([k, v]) => [Number(k), v])), currentNode: 1 });
    c.examined(1);
    if (got !== want) c.fail(`sfgate.homeStartRam(${JSON.stringify(sf)}) = ${got}, want ${want}`, "");
  }
  c.note(`sfgate.homeStartRam checked over ${grid.length} Source-File combinations`);
  return c;
}

/* ================================================================= A13 ==== */

function a13() {
  const c = new Check("A13", "Singularity RAM x16/x4/x1 by SF4 level, full price inside BitNode 4");

  // RamCosts.singularity.* are the functions SF4Cost returns, so calling one
  // under a moved Player *is* the game's answer — no text involved.
  const probe = g.RamCosts.singularity.purchaseTor;
  asPlayer({ bitNode: 1, sf: { 4: 3 } });
  const basePrice = probe();
  c.note(`base cost of singularity.purchaseTor (SF4.3, outside BN4) = ${basePrice}GB`);
  c.examined(1);

  const grid = [
    [1, 0, 16],
    [1, 1, 16],
    [1, 2, 4],
    [1, 3, 1],
    [4, 0, 1],
    [4, 1, 1],
    [4, 3, 1],
    [2, 0, 16],
    [13, 2, 4],
  ];
  for (const [bitNode, sf4, wantMult] of grid) {
    asPlayer({ bitNode, sf: { 4: sf4 } });
    const gameMult = probe() / basePrice;
    const ours = sfgate.singularityRamMultiplier({ ownedSF: new Map([[4, sf4]]), currentNode: bitNode });
    c.examined(1);
    c.note(`BN${bitNode} SF4.${sf4}: game x${gameMult}, sfgate.js x${ours} (want x${wantMult})`);
    if (gameMult !== wantMult) c.fail(`the game's ladder moved at BN${bitNode} SF4.${sf4}`, `x${gameMult}, expected x${wantMult}`);
    if (ours !== gameMult) c.fail(`sfgate.singularityRamMultiplier disagrees at BN${bitNode} SF4.${sf4}`, `ours x${ours}, game x${gameMult}`);
  }

  // Check every singularity entry, not just the probe — a per-function
  // exception would be invisible above.
  asPlayer({ bitNode: 1, sf: { 4: 1 } });
  const at1 = Object.entries(g.RamCosts.singularity).map(([k, v]) => [k, typeof v === "function" ? v() : v]);
  asPlayer({ bitNode: 1, sf: { 4: 3 } });
  const at3 = Object.fromEntries(Object.entries(g.RamCosts.singularity).map(([k, v]) => [k, typeof v === "function" ? v() : v]));
  const odd = at1.filter(([k, v]) => relErr(v, at3[k] * 16) > 1e-9);
  c.examined(at1.length);
  c.note(`all ${at1.length} ns.singularity entries priced at SF4.1 and SF4.3 — ${odd.length} did not move by exactly 16x`);
  if (odd.length) c.fail("some singularity functions do not follow the SF4 ladder", odd.map(([k, v]) => `${k}: ${v} vs ${at3[k]}`).join("\n"));

  asPlayer({});
  return c;
}

/* ================================================================= A14 ==== */

function a14() {
  const c = new Check("A14", "prestigeHomeComputer preserves maxRam and cpuCores, and does not clear text files");

  // Source-vs-source: build a home server, run the game's own prestige on it.
  const home = new g.Server({ hostname: "home", maxRam: 16384 });
  home.cpuCores = 7;
  home.textFiles = new Map([["/tel/ui-lock.txt", { filename: "/tel/ui-lock.txt", content: "{}" }]]);
  home.serversOnNetwork = ["n00dles", "darkweb"];
  const beforePrograms = home.programs.length;

  g.prestigeHomeComputer(home);
  c.examined(1);
  c.note(`after prestigeHomeComputer: maxRam ${home.maxRam}GB, cpuCores ${home.cpuCores}, textFiles ${home.textFiles.size}, programs ${beforePrograms} -> ${home.programs.length}, serversOnNetwork ${home.serversOnNetwork.length}`);

  if (home.maxRam !== 16384) c.fail("prestigeHomeComputer reset maxRam", `now ${home.maxRam}`);
  if (home.cpuCores !== 7) c.fail("prestigeHomeComputer reset cpuCores", `now ${home.cpuCores}`);
  if (home.textFiles.size !== 1) c.fail("prestigeHomeComputer cleared text files", "stale lock/busy files no longer carry into the next life — boot.js:155 reasons on the opposite");
  if (home.serversOnNetwork.length !== 0) c.fail("prestigeHomeComputer no longer clears serversOnNetwork", "torbuy.js's re-buy assumption depends on this");

  // The money half of the row. Player.prestigeAugmentation needs a whole
  // PlayerObject, so this one is textual — but the *value* is evaluated from
  // the game's own constants rather than read off the comment.
  const src = gameSource("src/PersonObjects/Player/PlayerObjectGeneralMethods.ts").split("\n");
  const idx = src.findIndex((l) => /this\.money\s*=\s*\d+\s*\+\s*CONSTANTS\.Donations/.test(l));
  c.examined(1);
  if (idx < 0) {
    c.warn("could not find the money reset in Player.prestigeAugmentation", "the `this.money = N + CONSTANTS.Donations` line has moved");
  } else {
    const literal = Number((src[idx].match(/=\s*(\d+)\s*\+/) || [])[1]);
    const money = literal + g.CONSTANTS.Donations;
    c.note(`[textual] PlayerObjectGeneralMethods.ts:${idx + 1}  ${src[idx].trim()}  ->  $${money}`);

    // ...plus whatever owned augmentations hand back. This is almost certainly
    // where the repo's "$1m" came from, so name it rather than just failing.
    const starters = Object.values(g.Augmentations)
      .filter((a) => a.startingMoney)
      .map((a) => `${a.name} $${a.startingMoney.toExponential(0)}`);
    c.note(`Prestige.ts:85-88 then adds each owned augmentation's startingMoney: ${starters.join(", ")}`);
    c.note(
      `so the post-install balance is $${money} plus grants — "$1m" is only right on a save owning CashRoot Starter Kit,`,
    );
    c.note("and Server/ServerHelpers.ts (the file the repo cites for it) does not touch money at all.");

    const claims = grepRepo(/money resets to|resets money to/i, { pad: 0 });
    let bad = 0;
    for (const h of claims) {
      c.examined(1);
      const m = h.text.match(/\$([\d.]+)\s*([kmb]|million|thousand)?/i);
      const stated = m ? Number(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9, thousand: 1e3, million: 1e6 }[(m[2] || "").toLowerCase()] ?? 1) : NaN;
      if (!Number.isFinite(stated) || stated === money) continue;
      bad++;
      if (h.frozen) c.warn(`${h.file}:${h.line} states $${stated} post-install, in a frozen copy`, h.text);
      else c.fail(`${h.file}:${h.line} states post-install cash $${stated}, game says $${money}`, h.text);
    }
    c.note(`${claims.length} repo line(s) state a post-install cash figure, ${bad} disagree with the game`);
  }
  return c;
}

/* ================================================================= A15 ==== */

function a15() {
  const c = new Check("A15", "Faction.prestigeAugmentation converts rep to favor, then zeroes rep and isMember");

  let bad = 0;
  for (const [favor0, rep0] of [
    [0, 0],
    [0, 462490],
    [10, 100000],
    [149, 25000],
    [354, 1e7],
  ]) {
    const f = new g.Faction("Daedalus");
    f.setFavor(favor0);
    f.playerReputation = rep0;
    f.isMember = true;
    f.alreadyInvited = true;
    const want = g.repToFavor(g.favorToRep(favor0) + rep0);
    f.prestigeAugmentation();
    c.examined(1);
    const ok = relErr(f.favor, want) < 1e-9 && f.playerReputation === 0 && f.isMember === false;
    if (!ok) {
      bad++;
      c.fail(`favor ${favor0} + rep ${rep0}`, `got favor ${f.favor}, rep ${f.playerReputation}, isMember ${f.isMember}; want favor ${want}, rep 0, isMember false`);
    }
    if (favor0 === 0 && rep0 === 462490) {
      c.note(`banking favorToRep(150) = 462,490 rep through an install yields ${f.favor.toFixed(4)} favor`);
    }
  }
  c.note(`5 (favor, reputation) states run through the game's own Faction.prestigeAugmentation, ${bad} disagreed`);

  // The ordering claim: rep earned and NOT installed is gone.
  const f = new g.Faction("Daedalus");
  f.setFavor(0);
  f.playerReputation = 2.5e6;
  f.prestigeAugmentation();
  c.examined(1);
  c.note(`2.5M Daedalus reputation (the Red Pill) through an install becomes ${f.favor.toFixed(2)} favor and 0 reputation`);
  if (f.playerReputation !== 0) c.fail("reputation survives an install", `${f.playerReputation}`);
  return c;
}

/* ======================================================================== */

export async function run() {
  return [a1(), a2(), a3(), a4(), a5(), a6(), a7(), a8(), a9(), a10(), a11(), a12(), a13(), a14(), a15()];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const checks = await run();
  for (const c of checks) c.print();
  const failed = checks.filter((c) => c.fails.length).length;
  console.log(`\n${checks.length} checks, ${failed} failing`);
  process.exit(failed ? 1 : 0);
}
