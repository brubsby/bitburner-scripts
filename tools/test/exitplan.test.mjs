// [XP] time-to-exit as a simulated trajectory, not a threshold ladder.
//
// exitplan.js exists because objective.bindingGate short-circuits on
// `!exitLevelReached` — "hacking >= exitLevel RIGHT NOW" — and hacking resets
// to 1 at every install, so the money gate below it was never consulted. The
// ladder could not compare "install now for a bigger multiplier" against
// "hold the cash", which is the only trade that matters at the end of a node.
//
// What gets pinned here is the SHAPE of the optimisation and its refusals. The
// rates it integrates are measured live by progress.js; no offline fixture can
// fake those honestly, so the numbers below are self-consistent inputs chosen
// to exercise the structure, not claims about the game.

import { Check } from "./harness.mjs";
import "./gameresolve.mjs";

const { exitHours, bestExitPolicy, hoursToLevel, hoursToMoney, hoursToRep, expForLevel, levelAt } = await import(
  "../../exitplan.js"
);

/** The live BitNode 5 state this module was written against. */
const LIVE = {
  money: 8.85e9,
  incomePerSec: 39e6,
  hacking: 4051,
  hackingExp: expForLevel(4051, 9.25),
  hackingMult: 9.25,
  expPerSec: 190000,
  repPerSec: 200,
  exitRep: 0,
  exitFavor: 78,
  cycleHours: 0.625,
  multGainPerCycle: 1.34,
  exitLevel: 4500,
  joinMoney: 100e9,
  terminalRep: 2.5e6,
  donationCost: 791e9,
};

export async function run() {
  const checks = [];

  // ---------------------------------------------------------------------
  const c1 = new Check("XP1", "the level curve round-trips against the game's own formula");
  {
    c1.examined(1);
    for (const [lvl, mult] of [
      [1, 1],
      [100, 1],
      [4500, 9.25],
      [4500, 18.41],
      [3000, 2.5],
    ]) {
      const exp = expForLevel(lvl, mult);
      const back = levelAt(exp, mult);
      // floor() in levelAt means it can land one below; never further.
      if (Math.abs(back - lvl) > 1) c1.fail(`level ${lvl} at mult ${mult}: round-trip gave ${back}`);
    }
    c1.note("expForLevel/levelAt agree to within the floor() of skill.ts:13 at five points");
  }
  checks.push(c1);

  // ---------------------------------------------------------------------
  const c2 = new Check("XP2", "the final climb is exponential in exitLevel/mult — the leg the trade turns on");
  {
    // This is WHY a threshold on current hacking is the wrong test: the climb
    // that decides the run happens AFTER the terminal install resets skills,
    // and it collapses from hours to seconds over a small multiplier gain.
    c2.examined(1);
    const at925 = hoursToLevel(4500, 9.25, 0, 190000);
    const at1240 = hoursToLevel(4500, 12.4, 0, 190000);
    if (!(at925 > 1)) c2.fail(`at mult 9.25 the climb must be hours, got ${at925}`);
    if (!(at1240 < 0.2)) c2.fail(`at mult 12.40 the climb must be minutes, got ${at1240}`);
    if (!(at925 / Math.max(at1240, 1e-9) > 10)) c2.fail("the cliff must be at least an order of magnitude");
    c2.note(`climb to 4500: ${at925.toFixed(2)}h at mult 9.25 -> ${at1240.toFixed(2)}h at 12.40`);

    // Already there costs nothing; no rate and not there is Infinity, which is
    // a real answer ("never at this rate") and NOT the null used for "cannot
    // tell". Collapsing those two is how a stall becomes invisible.
    c2.examined(2);
    if (hoursToLevel(100, 10, expForLevel(200, 10), 1e6) !== 0) c2.fail("already past the level must cost 0");
    if (hoursToLevel(4500, 1, 0, 0) !== Infinity) c2.fail("no exp rate and not there must be Infinity, not null");
    if (hoursToLevel(4500, 0, 0, 1e5) !== null) c2.fail("an unreadable multiplier must be null, not Infinity");
  }
  checks.push(c2);

  // ---------------------------------------------------------------------
  const c3 = new Check("XP3", "income RISES with level, so a post-install hoard is not the flat rate");
  {
    // A fresh life starts at level 1 earning almost nothing and accelerates.
    // Pricing the hoard at today's income would assume the rebuild away, which
    // is exactly the error that made plan C look impossible in daedalus-plan.
    c3.examined(1);
    const growing = hoursToMoney(100e9, { money0: 1262, incomeAtLevel1: (39e6 * 51) / (4051 + 50), mult: 12.4, exp0: 0, expPerSec: 190000 });
    const flatRate = (39e6 * 51) / (4051 + 50); // income at level 1, held constant
    const flat = (100e9 - 1262) / flatRate / 3600;
    if (!(growing < flat)) c3.fail(`a rising level must reach the target SOONER than a frozen level-1 rate: ${growing} vs ${flat}`);
    c3.note(`$100b from a fresh life: ${growing.toFixed(2)}h rising vs ${flat.toFixed(1)}h if the level never grew`);

    c3.examined(2);
    if (hoursToMoney(100, { money0: 200 }) !== 0) c3.fail("already funded must cost 0 hours");
    if (hoursToMoney(1e9, { money0: 0, incomeAtLevel1: 0, mult: 1 }) !== null) c3.fail("no income must refuse with null");
  }
  checks.push(c3);

  // ---------------------------------------------------------------------
  const c4 = new Check("XP4", "reputation is ground OR bought, and donations are not assumed");
  {
    c4.examined(1);
    const ground = hoursToRep(2.5e6, { rep0: 0, repPerSec: 200, favor: 78 });
    if (ground.how !== "ground") c4.fail(`below 150 favor reputation must be ground, got ${ground.how}`);
    if (Math.abs(ground.hours - 2.5e6 / 200 / 3600) > 1e-9) c4.fail("ground hours must be gap/rate");

    // Past the threshold it is a PURCHASE — but the money still has to be
    // earned, so it is priced through the caller's money leg, not free.
    c4.examined(2);
    let asked = null;
    const bought = hoursToRep(2.5e6, {
      rep0: 0,
      repPerSec: 200,
      favor: 200,
      // Passed explicitly: the threshold is 150 x FavorToDonateToFaction and
      // this module refuses to assume the BitNode-1 value ([C5]).
      favorToDonate: 150,
      donationCost: 791e9,
      moneyLeg: (d) => {
        asked = d;
        return 0.4;
      },
    });
    if (bought.how?.startsWith("donated") !== true) c4.fail(`past 150 favor it must donate, got ${bought.how}`);
    if (asked !== 791e9) c4.fail("the donation must be priced through the money leg");
    if (bought.hours !== 0.4) c4.fail("donation hours must come from the money leg");

    // No measured rate and no donation route = cannot tell.
    c4.examined(3);
    const r = hoursToRep(1e6, { rep0: 0, favor: 0 });
    if (r.hours !== null) c4.fail("without a rate or a donation route it must refuse");
    if (!r.how) c4.fail("a refusal must say why");

    // With the threshold UNKNOWN, a huge favor must NOT unlock donations —
    // assuming 150 would be right in BN1 and wrong wherever the multiplier is not 1.
    c4.examined(4);
    const noThreshold = hoursToRep(2.5e6, { rep0: 0, repPerSec: 200, favor: 1e6, donationCost: 1e9, moneyLeg: () => 0.1 });
    if (noThreshold.how !== "ground") c4.fail(`without favorToDonate the donation route must not be assumed, got ${noThreshold.how}`);
  }
  checks.push(c4);

  // ---------------------------------------------------------------------
  const c5 = new Check("XP5", "the optimisation finds an interior optimum, not an endpoint");
  {
    // THE POINT OF THE MODULE. Holding is slow because the final climb runs at
    // today's multiplier; installing forever is slow because each cycle costs
    // a life and resets the cash. The answer is in the middle, and a ladder
    // that short-circuits on a threshold cannot find it.
    c5.examined(1);
    const r = bestExitPolicy(LIVE, 6);
    if (!r.best) c5.fail(`the live state must be priceable: ${r.why}`);
    const hold = r.tried.find((t) => t.installsFirst === 0)?.hours;
    if (!(r.best.hours < hold)) c5.fail(`the optimum must beat holding: ${r.best.hours} vs ${hold}`);
    if (r.best.installsFirst === 0) c5.fail("at this state holding is NOT optimal — the climb at mult 9.25 costs hours");
    if (r.atSearchEdge) c5.fail("the optimum sits at the search bound — widen it, the answer may be beyond");
    c5.note(
      `k=0 ${hold.toFixed(2)}h -> best k=${r.best.installsFirst} at ${r.best.hours.toFixed(2)}h ` +
        `(searched to ${r.searchedTo}, interior)`,
    );

    // Convex-ish: past the optimum, more installs must cost more. A monotone
    // curve would mean the trade is not being made at all.
    c5.examined(2);
    const priced = r.tried.filter((t) => typeof t.hours === "number");
    const tail = priced.slice(r.best.installsFirst + 1);
    if (tail.length && !tail.every((t, i) => i === 0 || t.hours >= tail[i - 1].hours)) {
      c5.fail("beyond the optimum the total must rise monotonically");
    }

    // Every leg must be reported, or the number is unauditable.
    c5.examined(3);
    const names = r.best.legs.map((l) => l.leg);
    for (const want of ["hoard join money", "exit reputation", "climb to exit level"]) {
      if (!names.includes(want)) c5.fail(`the plan must report the '${want}' leg`);
    }
    c5.note(r.best.legs.map((l) => `${l.leg} ${l.hours.toFixed(2)}h`).join(" | "));
  }
  checks.push(c5);

  // ---------------------------------------------------------------------
  const c6 = new Check("XP6", "it refuses on unreadable state instead of returning a plausible number");
  {
    const cases = [
      ["no income", { ...LIVE, incomePerSec: 0 }],
      ["no multiplier", { ...LIVE, hackingMult: 0 }],
      ["no exit level", { ...LIVE, exitLevel: 0 }],
      ["install priced with no cycle length", { ...LIVE, installsFirst: 2, cycleHours: null }],
      ["install priced with no mult gain", { ...LIVE, installsFirst: 2, multGainPerCycle: null }],
    ];
    for (const [label, bad] of cases) {
      c6.examined(1);
      const r = exitHours(bad);
      if (r.hours !== null) c6.fail(`${label}: must refuse, got ${r.hours}`);
      if (!r.why) c6.fail(`${label}: a refusal must name what was missing`);
    }
    // And a refusal inside the search must not poison the whole search.
    c6.examined(1);
    const noCycle = bestExitPolicy({ ...LIVE, cycleHours: null }, 3);
    if (!noCycle.best) c6.fail("k=0 needs no cycle length, so the search must still find it");
    if (noCycle.best.installsFirst !== 0) c6.fail("with installs unpriceable only k=0 can win");
    c6.note("5 unreadable-input shapes refuse with a reason; an unpriceable install still leaves k=0 answerable");
  }
  checks.push(c6);

  // ---------------------------------------------------------------------
  const c7 = new Check("XP7", "count-ticket installs are not multiplier cycles — cycleStats must not measure them");
  {
    const { cycleStats } = await import("../../exitplan.js");
    c7.examined(3);
    // THE LIVE LEDGER, BitNode 10, 2026-09-24. Five of the last six lives were
    // count tickets: aug count up, hackMult flat, ~20 minutes each. The median
    // read multGainPerCycle 1.0 and cycleHours 0.33, bestExitPolicy concluded
    // installing could not grow the multiplier, and bindingGate fell through to
    // the destructive join-money hold: $2.8t protecting a $100b join that only
    // installs could make reachable. Hacking crawled 261 -> 263 in 20 minutes.
    const L = (lifeH, hackMult, augs) => ({ bitNode: 10, lifeH, hackMult, augs });
    const live = [
      L(3.25, 1.5242, 6), L(7.74, 1.667, 7), L(1.42, 1.667, 8), L(11.97, 1.7504, 12),
      L(0.33, 1.7504, 19), L(0.33, 1.7504, 22), L(0.33, 1.7504, 24), L(0.5, 1.7504, 26), L(0.33, 1.8379, 29),
    ];
    const r = cycleStats(live, 10);
    if (!(r.multGainPerCycle > 1.01)) c7.fail(`ticket installs must not collapse the growth estimate to 1.0, got ${r.multGainPerCycle}`);
    if (!(r.cycleHours > 1)) c7.fail(`twenty-minute ticket lives must not set the cycle length, got ${r.cycleHours}h`);
    if (r.ticketsExcluded !== 5) c7.fail(`five ticket installs are in this ledger (the 8, 19, 22, 24, 26 lives), excluded ${r.ticketsExcluded}`);
    // A MIXED batch — count rose AND the multiplier rose — is a real cycle.
    if (!live.slice(-1).every((l) => l.hackMult > 1.7504)) c7.fail("fixture: the last life is the mixed batch");
    // NOTHING MOVED — same count, same multiplier — is not a ticket: nothing
    // was bought for the count. It is an install that failed to raise the
    // multiplier, which is exactly what the growth estimate SHOULD see. Only a
    // RISE in the count marks a ticket (`>`, not `>=`).
    const flat = cycleStats([L(2, 1.5, 10), L(2, 1.5, 10), L(2, 1.6, 12), L(2, 1.7, 14)], 10);
    if (flat.ticketsExcluded !== 0) c7.fail(`a life where neither count nor multiplier moved must be KEPT, excluded ${flat.ticketsExcluded}`);
    // A life with no aug count is unclassifiable, and kept rather than guessed.
    // (The pos() guards on `augs` are redundant with JS itself — undefined > x
    // is false for every x — so no mutation of them can change behaviour; this
    // pins the outcome, which holds either way.)
    const noAugs = cycleStats([{ bitNode: 10, lifeH: 2, hackMult: 1.5 }, { bitNode: 10, lifeH: 2, hackMult: 1.5 }, { bitNode: 10, lifeH: 2, hackMult: 1.6 }], 10);
    if (noAugs.ticketsExcluded !== 0) c7.fail("a life missing `augs` cannot be classified a ticket and must be kept");
    c7.note(`live ledger: multGain ${r.multGainPerCycle.toFixed(4)}, cycle ${r.cycleHours.toFixed(2)}h, ${r.ticketsExcluded} ticket installs excluded (was 1.0 / 0.33h)`);
  }
  checks.push(c7);

  // ---------------------------------------------------------------------
  const c8 = new Check("XP8", "the level curve uses mults.hacking x HackingLevelMultiplier — and progress.js feeds only that");
  {
    const { effectiveHackingMultOf } = await import("../../exitplan.js");
    const fs = (await import("node:fs")).default;
    const path = (await import("node:path")).default;
    const { GAME } = await import("./build-ram.mjs");
    c8.examined(4);
    // The game's own statement of the formula, read rather than remembered.
    const person = fs.readFileSync(path.join(GAME, "src/PersonObjects/Person.ts"), "utf8");
    if (!/calculateSkill\(\s*this\.exp\.hacking,\s*this\.mults\.hacking \* currentNodeMults\.HackingLevelMultiplier/.test(person)) {
      c8.fail("Person.ts no longer computes the hacking level from mults.hacking x HackingLevelMultiplier — this correction assumes it does");
    }
    // …while getPlayer hands back the RAW multiplier.
    const nsf = fs.readFileSync(path.join(GAME, "src/NetscriptFunctions.ts"), "utf8");
    if (!/mults:\s*\{\s*\.\.\.Player\.mults\s*\}/.test(nsf)) c8.fail("getPlayer no longer returns raw Player.mults — the correction may now double-apply the factor");
    if (Math.abs(effectiveHackingMultOf(1.8379, 0.35) - 0.643265) > 1e-6) c8.fail("BitNode 10: 1.8379 x 0.35");
    if (effectiveHackingMultOf(1.5, 1) !== 1.5) c8.fail("a factor of 1 leaves the multiplier unchanged");
    if (effectiveHackingMultOf(1.5, undefined) !== null || effectiveHackingMultOf(null, 0.35) !== null) {
      c8.fail("unreadable input must REFUSE (null), never fall back to the raw value — that is 2.86x wrong in BitNode 10");
    }

    // THE STRUCTURAL GUARD. HackingLevelMultiplier appeared nowhere in the
    // planner, so every level projection ran on the raw value in eleven
    // BitNodes. No `hackingMult:` feed in progress.js may be the raw field.
    c8.examined(1);
    const src = fs.readFileSync(path.join(path.resolve(GAME, "../bitburner-scripts"), "progress.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    const raw = [...src.matchAll(/hackingMult:\s*player\.mults\??\.hacking\b/g)].length;
    if (raw) c8.fail(`${raw} \`hackingMult:\` feed(s) in progress.js pass the RAW multiplier into a level curve`, "use effectiveHackingMult(player, info)");
    const eff = [...src.matchAll(/hackingMult:\s*effectiveHackingMult\(/g)].length;
    if (eff < 5) c8.fail(`expected the level feeds to use effectiveHackingMult; found ${eff}`, "the parser found too few — a rotted check, not a clean repo");
    c8.note(`BN10 effective ${effectiveHackingMultOf(1.8379, 0.35).toFixed(4)} vs raw 1.8379 (2.86x); ${eff} level feeds use it, 0 raw`);
  }
  checks.push(c8);

  return checks;
}
