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

  return checks;
}
