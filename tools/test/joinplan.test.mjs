// [JP] the join boundary — forecasting when a faction becomes joinable.
//
// The failure this module exists to prevent is a planner blind to factions it
// has not joined: measured live, the joined set capped augmentation quality at
// x1.28 while BitRunners held a x2.84 one backdoor away, and the ranking
// concluded NeuroFlux was competitive. The forecasts here are what let a
// locked faction compete in the same ranking as an open one.
//
// The refusal semantics get as much testing as the arithmetic, because an
// unknown that reads as an answer is this repo's most expensive bug class:
// a wait guessed at zero ranks a locked faction as open; guessed at infinity
// it hides the faction silently. Both must be impossible.

import { Check } from "./harness.mjs";
import "./gameresolve.mjs";

const jp = await import("../../joinplan.js");
const { hoursToHackingLevel, timeToMeet, meet, joinWait } = jp;
const { skillFromExp, expForSkill } = await import("../../installgate.js");

export async function run() {
  const checks = [];

  /* ---------------------------------------------------------------- JP1 --- */
  const c1 = new Check("JP1", "the hacking-level forecast inverts the game's own skill curve");
  {
    // Round trip through the shared formula (skill.ts:13): if the forecast says
    // T hours, then exp + rate*T*3600 must actually reach the target level.
    for (const [exp, mult, rate, target] of [
      [120e3, 1.9, 60, 505], // the live BitRunners case, roughly
      [1e6, 2.0322, 200, 800],
      [500, 1, 1, 50],
    ]) {
      c1.examined(1);
      const h = hoursToHackingLevel(target, { exp, mult, expPerSec: rate });
      if (h === null || h <= 0) {
        c1.fail(`no forecast for target ${target} from exp ${exp}`);
        continue;
      }
      const reached = skillFromExp(exp + rate * h * 3600, mult);
      if (reached < target) c1.fail(`forecast ${h.toFixed(2)}h reaches only level ${reached}, not ${target}`);
      // and not wastefully past it: one second earlier must NOT have reached it
      const early = skillFromExp(exp + rate * (h * 3600 - 1), mult);
      if (early >= target) c1.fail(`forecast overshoots: level ${target} was already reached 1s earlier`);
    }
    c1.examined(1);
    if (hoursToHackingLevel(300, { exp: expForSkill(300, 2) + 1, mult: 2, expPerSec: 10 }) !== 0) {
      c1.fail("an already-met target must be 0 hours, not a forecast");
    }
    c1.examined(1);
    // No rate, target unmet: refuse. Zero rate is not slow, it is unknown.
    for (const rate of [0, -1, NaN, undefined]) {
      if (hoursToHackingLevel(505, { exp: 1000, mult: 1, expPerSec: rate }) !== null) {
        c1.fail(`rate ${String(rate)} produced a forecast for an unmet target`);
      }
    }
  }
  checks.push(c1);

  /* ---------------------------------------------------------------- JP2 --- */
  const c2 = new Check("JP2", "each requirement type forecasts, satisfies, or REFUSES — never guesses");
  {
    const state = {
      hacking: 337, hackingExp: 120e3, hackingMult: 1.9, expPerSec: 60,
      money: 20e6, incomePerSec: 50e3,
      augCount: 8,
      backdoors: { CSEC: true },
      serverLevels: { "run4theh111z": 505, CSEC: 54 },
    };

    c2.examined(1);
    // backdoor already done: 0 regardless of level
    if (timeToMeet({ type: "backdoorInstalled", server: "CSEC" }, state) !== 0) c2.fail("a done backdoor must be 0");
    c2.examined(1);
    // backdoor pending: forecast via the server's required level
    const bd = timeToMeet({ type: "backdoorInstalled", server: "run4theh111z" }, state);
    if (!(bd > 0)) c2.fail(`run4theh111z should forecast positive hours, got ${bd}`);
    c2.examined(1);
    // backdoor on an unknown server: refuse
    if (timeToMeet({ type: "backdoorInstalled", server: "mystery" }, state) !== null) {
      c2.fail("an unknown server's backdoor must be null, not guessed");
    }
    c2.examined(1);
    // money: satisfied, forecast, and refusal without income
    if (timeToMeet({ type: "money", money: 10e6 }, state) !== 0) c2.fail("held money must satisfy");
    const mh = timeToMeet({ type: "money", money: 20e6 + 50e3 * 3600 }, state);
    if (Math.abs(mh - 1) > 1e-9) c2.fail(`one hour of income should forecast 1h, got ${mh}`);
    if (timeToMeet({ type: "money", money: 1e12 }, { money: 5 }) !== null) c2.fail("no income rate must refuse");
    c2.examined(1);
    // numAugmentations: only moves at installs — satisfied or refuse, never an ETA
    if (timeToMeet({ type: "numAugmentations", numAugmentations: 8 }, state) !== 0) c2.fail("8 of 8 augs is satisfied");
    if (timeToMeet({ type: "numAugmentations", numAugmentations: 30 }, state) !== null) {
      c2.fail("an unmet aug count must refuse — there is no rate to divide by");
    }
    c2.examined(1);
    // types with no measured rate: karma, jobs, hacknet — refuse them all
    for (const type of ["karma", "employedBy", "hacknetRAM", "numPeopleKilled", "companyReputation"]) {
      if (timeToMeet({ type }, state) !== null) c2.fail(`${type} has no measured rate and must refuse`);
    }
    c2.examined(1);
    // a malformed requirement is unknown, not satisfied
    for (const bad of [null, {}, { type: 42 }, "skills"]) {
      if (timeToMeet(bad, state) !== null) c2.fail(`malformed requirement ${JSON.stringify(bad)} did not refuse`);
    }
  }
  checks.push(c2);

  /* ---------------------------------------------------------------- JP3 --- */
  const c3 = new Check("JP3", "compound semantics: every=max and poisoned by unknown, some=best known branch");
  {
    const state = {
      hacking: 337, hackingExp: 120e3, hackingMult: 1.9, expPerSec: 60,
      money: 20e6, incomePerSec: 50e3, augCount: 8, backdoors: {}, serverLevels: { x: 505 },
    };
    const fast = { type: "money", money: 20e6 + 50e3 * 3600 }; // 1h
    const slow = { type: "backdoorInstalled", server: "x" }; // hours, via hacking 505
    const unknown = { type: "karma", karma: -90 };
    const met = { type: "money", money: 1 };

    const slowH = timeToMeet(slow, state);
    c3.examined(1);
    // every = the max: the binding requirement is the slowest one
    const every = timeToMeet({ type: "everyCondition", conditions: [fast, slow, met] }, state);
    if (every !== Math.max(1, slowH)) c3.fail(`every should be the max (${Math.max(1, slowH)}), got ${every}`);
    c3.examined(1);
    // one unknown conjunct poisons the whole thing — it COULD be the binding one
    if (timeToMeet({ type: "everyCondition", conditions: [fast, unknown] }, state) !== null) {
      c3.fail("an unknown conjunct must poison the conjunction — it could be the binding requirement");
    }
    c3.examined(1);
    // some = the min over KNOWN branches; unknown branches cannot beat a known one
    const some = timeToMeet({ type: "someCondition", conditions: [unknown, fast, slow] }, state);
    if (some !== 1) c3.fail(`some should take the best known branch (1h), got ${some}`);
    c3.examined(1);
    if (timeToMeet({ type: "someCondition", conditions: [unknown] }, state) !== null) {
      c3.fail("all-unknown branches must refuse");
    }
    c3.examined(1);
    // not: satisfied now iff the inner is unmet; we never forecast losing progress
    if (timeToMeet({ type: "not", condition: fast }, state) !== 0) c3.fail("not(unmet) is satisfied now");
    if (timeToMeet({ type: "not", condition: met }, state) !== null) {
      c3.fail("not(met) must refuse — becoming worse is not forecastable");
    }
  }
  checks.push(c3);

  /* ---------------------------------------------------------------- JP4 --- */
  const c4 = new Check("JP4", "joinWait: the LIVE BitRunners shape, blockers named, refusal loud");
  {
    // The case this was built for: backdoor run4theh111z (hacking 505), from
    // our approximate live state at the time of writing.
    const state = {
      hacking: 337, hackingExp: 118e3, hackingMult: 1.9, expPerSec: 55,
      money: 20e6, incomePerSec: 50e3, augCount: 8,
      backdoors: { CSEC: true, "avmnite-02h": true },
      serverLevels: { "run4theh111z": 505 },
    };
    const w = joinWait([{ type: "backdoorInstalled", server: "run4theh111z" }], state);
    c4.examined(1);
    if (!w.known || !(w.hours > 0)) c4.fail(`BitRunners should forecast, got ${JSON.stringify(w)}`);
    else c4.note(`BitRunners at these rates: ~${w.hours.toFixed(1)}h to hacking 505`);
    c4.examined(1);
    if (!w.blockers.length || w.blockers[0].type !== "backdoorInstalled") {
      c4.fail("the blocker must be NAMED — a bare number cannot be checked against the game");
    }

    c4.examined(1);
    // Daedalus's shape: every(30 augs, money, hacking). Unmet augs poison it —
    // the whole faction must read UNKNOWN, with the blockers still listed.
    const daed = joinWait([
      { type: "numAugmentations", numAugmentations: 30 },
      { type: "money", money: 100e9 },
      { type: "skills", skills: { hacking: 2500 } },
    ], state);
    if (daed.known) c4.fail("Daedalus with unmet aug count must be unknown, not scheduled");
    if (daed.blockers.length !== 3) c4.fail("all three blockers must still be reported");
    c4.examined(1);
    // Eligible NOW is exactly zero — that is the joinable-invite case.
    const open = joinWait([{ type: "backdoorInstalled", server: "CSEC" }], state);
    if (open.hours !== 0 || !open.known) c4.fail("a met requirement set must be exactly 0 hours");
    c4.examined(1);
    // Unreadable requirement list: refuse, do not treat as no requirements.
    for (const bad of [null, undefined, "x", {}]) {
      const r = joinWait(bad, state);
      if (r.known || r.hours !== null) c4.fail(`requirements ${String(bad)} must be unknown, not open`);
    }
  }
  checks.push(c4);

  /* ---------------------------------------------------------------- JP5 --- */
  const c5 = new Check("JP5", "company reputation is ACTIVE time, and it overlaps passive waits in wall-clock");
  {
    const companyCtx = { hacking: 500, charisma: 30, companyRepMult: 1, nodeCompanyRepMult: 1, jobs: {}, repByCompany: {}, measuredRates: {} };
    const state = {
      hackingExp: 120e3, hackingMult: 1.9, expPerSec: 60,
      money: 20e6, incomePerSec: 50e3,
      backdoors: {}, serverLevels: { fulcrumassets: 1100 },
      companyCtx,
    };

    c5.examined(1);
    // A company requirement is 100% active — it displaces faction work.
    const co = meet({ type: "companyReputation", company: "ECorp", reputation: 300e3 }, state);
    if (!co || !(co.hours > 0)) c5.fail("ECorp 300k must forecast");
    else if (co.active !== co.hours) c5.fail(`company hours must be fully active, got active ${co.active} of ${co.hours}`);

    c5.examined(1);
    // THE OVERLAP: Fulcrum's shape is every(backdoor fulcrumassets, company rep).
    // The backdoor wait is passive and runs while we sit at the desk, so the
    // total is max(passive, active), NOT the sum.
    const bd = meet({ type: "backdoorInstalled", server: "fulcrumassets" }, state);
    const both = meet({ type: "everyCondition", conditions: [
      { type: "backdoorInstalled", server: "fulcrumassets" },
      { type: "companyReputation", company: "Fulcrum Technologies", reputation: 300e3 },
    ]}, state);
    const fulcrumCo = meet({ type: "companyReputation", company: "Fulcrum Technologies", reputation: 300e3 }, state);
    if (!both) c5.fail("the Fulcrum conjunction must be priceable");
    else {
      if (Math.abs(both.hours - Math.max(bd.hours, fulcrumCo.hours)) > 1e-9) {
        c5.fail(`every must overlap: expected max(${bd.hours.toFixed(1)}, ${fulcrumCo.hours.toFixed(1)}), got ${both.hours.toFixed(1)}`);
      }
      if (Math.abs(both.active - fulcrumCo.hours) > 1e-9) c5.fail("only the company part is active");
      c5.note(`Fulcrum: backdoor ${bd.hours.toFixed(1)}h passive OVERLAPS ${fulcrumCo.hours.toFixed(1)}h at the desk -> ${both.hours.toFixed(1)}h total`);
    }

    c5.examined(1);
    // TWO active parts serialise — one work slot.
    const two = meet({ type: "everyCondition", conditions: [
      { type: "companyReputation", company: "ECorp", reputation: 100e3 },
      { type: "companyReputation", company: "MegaCorp", reputation: 100e3 },
    ]}, state);
    const a = meet({ type: "companyReputation", company: "ECorp", reputation: 100e3 }, state);
    const b = meet({ type: "companyReputation", company: "MegaCorp", reputation: 100e3 }, state);
    if (!two || Math.abs(two.hours - (a.hours + b.hours)) > 1e-9) c5.fail("two company grinds share one work slot and must SUM");

    c5.examined(1);
    // employedBy: held = 0; hirable = 0 (applyToCompany is instant); neither = refuse.
    if (timeToMeet({ type: "employedBy", company: "ECorp" }, state) !== 0) c5.fail("hirable at ECorp (hacking 500 >= 250) must be 0");
    if (timeToMeet({ type: "employedBy", company: "ECorp" }, { companyCtx: { ...companyCtx, hacking: 100, charisma: 0 } }) !== null) {
      c5.fail("unqualified for every rung must refuse — we do not model stat training");
    }
    if (timeToMeet({ type: "employedBy", company: "ECorp" }, { companyCtx: { ...companyCtx, hacking: 100, jobs: { ECorp: "Intern" } } }) !== 0) {
      c5.fail("a held job satisfies regardless of stats");
    }

    c5.examined(1);
    // joinWait surfaces activeHours and labels the company blocker with them.
    const w = joinWait([{ type: "companyReputation", company: "ECorp", reputation: 300e3 }], state);
    if (!w.known || Math.abs(w.activeHours - w.hours) > 1e-9) c5.fail("a pure company wait is all active");
    if (w.blockers[0]?.detail !== "ECorp" || !(w.blockers[0]?.activeHours > 0)) c5.fail("the blocker must name the company and its active hours");

    c5.examined(1);
    // A measured live rate outranks the formula (the calibration loop). The
    // measurement belongs to the rung we HOLD, so the scenario must be one
    // where we are already working: rep 100k, parked at Junior. From there the
    // whole remaining walk is the measured rung.
    // The measurement now binds to the HELD position (heldPosition from
    // player.jobs), because a rate measured as a Junior says nothing about
    // the Senior desk — so the scenario must actually hold the job.
    const held = { ...companyCtx, repByCompany: { ECorp: 100e3 }, jobs: { ECorp: "Junior Software Engineer" } };
    const est = meet({ type: "companyReputation", company: "ECorp", reputation: 300e3 },
      { ...state, companyCtx: held });
    const measured = meet({ type: "companyReputation", company: "ECorp", reputation: 300e3 },
      { ...state, companyCtx: { ...held, measuredRates: { ECorp: 100 } } });
    if (!(measured && est && measured.hours < est.hours / 10)) {
      c5.fail(`a measured 100 rep/s must dominate the ~2.4 rep/s estimate: ${measured?.hours} vs ${est?.hours}`);
    }
  }
  checks.push(c5);

  /* ---------------------------------------------------------------- JP6 --- */
  const c6 = new Check("JP6", "company stints cross the install boundary: over-window desks ladder through company favour");
  {
    const companyCtx = {
      hacking: 500, charisma: 30, companyRepMult: 2, nodeCompanyRepMult: 1,
      jobs: {}, repByCompany: {}, measuredRates: {}, favorByCompany: {},
      chaExp: 0, chaMult: 1.595, chaExpMult: 1.754, uniChaExpPerSec: 4 * 4 * 1.754,
    };
    const base = {
      hackingExp: 3e5, hackingMult: 1.9, expPerSec: 400,
      money: 1e9, incomePerSec: 1e5, backdoors: {}, serverLevels: {},
      companyCtx,
    };
    const windowed = { ...base, windowH: 1.72, lifeAgeH: 0.5, rateGrowthPerCycle: 1.034 };
    const ecorp = { type: "companyReputation", company: "ECorp", reputation: 400e3 };

    c6.examined(1);
    // Without window inputs: the continuous stint (the old fiction).
    const cont = meet(ecorp, base);
    // With them: the same requirement ladders — hours grow to wall-clock
    // across cycles, and the blocker says how many installs it spans.
    const lad = meet(ecorp, windowed);
    if (!cont || !lad) c6.fail("both arms must price");
    else {
      if (!(cont.hours > windowed.windowH)) c6.fail("the fixture must exceed one window or this test proves nothing");
      if (!(lad.hours > cont.hours * 1.5)) c6.fail(`laddered hours must exceed continuous: ${lad.hours?.toFixed(1)} vs ${cont.hours.toFixed(1)}`);
      if (!(lad.spansInstalls > 0)) c6.fail("the laddered forecast must carry spansInstalls");
      if (Math.abs(lad.holdH - cont.hours) > 1e-9) c6.fail("holdH must preserve the continuous alternative");
      if (lad.active !== lad.hours) c6.fail("desk laddering is still fully active — each cycle's window is at the desk");
      c6.note(`ECorp 400k: ${cont.hours.toFixed(1)}h continuous fiction -> ${lad.hours.toFixed(0)}h across ${lad.spansInstalls} installs`);
    }

    c6.examined(1);
    // A stint that FITS the remaining window is untouched.
    const nearCtx = { ...companyCtx, repByCompany: { ECorp: 395e3 }, jobs: { ECorp: "Junior Software Engineer" }, measuredRates: { ECorp: 100 } };
    const near = meet({ type: "companyReputation", company: "ECorp", reputation: 400e3 }, { ...windowed, companyCtx: nearCtx });
    if (!near || near.spansInstalls) c6.fail(`a within-window stint must not ladder: ${JSON.stringify(near)}`);

    c6.examined(1);
    // Company favour shortens the company ladder, exactly as faction favour
    // shortens the faction one.
    const favCtx = { ...companyCtx, favorByCompany: { ECorp: 100 } };
    const favLad = meet(ecorp, { ...windowed, companyCtx: favCtx });
    if (!(favLad && favLad.hours < lad.hours)) c6.fail("banked company favour must shorten the ladder");

    c6.examined(1);
    // joinWait surfaces the spanning info on the blocker for telemetry.
    const w = joinWait([ecorp], windowed);
    if (!w.known || !(w.blockers[0]?.spansInstalls > 0) || !(w.blockers[0]?.holdH > 0)) {
      c6.fail(`the blocker must carry spansInstalls and holdH: ${JSON.stringify(w.blockers[0])}`);
    }
  }
  checks.push(c6);

  /* ---------------------------------------------------------------- JP7 --- */
  const c7 = new Check("JP7", "endgame forecasts: the aug count from the measured ledger, hacking levels across installs");
  {
    const base = {
      hacking: 813, hackingExp: 5.7e6, hackingMult: 3.08, expPerSec: 800,
      money: 34e9, incomePerSec: 7.3e6,
      windowH: 1.72, lifeAgeH: 0.5, rateGrowthPerCycle: 1.034,
      backdoors: {}, serverLevels: { fulcrumassets: 1100 },
    };

    c7.examined(1);
    // Daedalus's 30-aug gate: refused without a measured count rate (guessing
    // priced it as imminent from day one), forecast once the ledger measures.
    const req = { type: "numAugmentations", numAugmentations: 30 };
    if (timeToMeet(req, { ...base, augCount: 15 }) !== null) c7.fail("no measured rate must still refuse");
    const withRate = timeToMeet(req, { ...base, augCount: 15, augsPerWindow: 2.5 });
    if (Math.abs(withRate - Math.ceil(15 / 2.5) * 1.72) > 1e-9) c7.fail(`15 short at 2.5/window is 6 windows, got ${withRate}`);
    if (timeToMeet(req, { ...base, augCount: 31, augsPerWindow: 2.5 }) !== 0) c7.fail("already past the count is 0");

    c7.examined(1);
    // Hacking targets beyond THIS life ladder across installs instead of
    // pricing per-life fiction — the model that once said 172,658h for
    // fulcrumassets. Level 2500 at mult 3.08 is unreachable in one 1.72h
    // window; with the multiplier compounding it must land at a finite,
    // multi-window figure far below the per-life fantasy.
    const perLifeFiction = hoursToHackingLevel(2500, { exp: base.hackingExp, mult: base.hackingMult, expPerSec: base.expPerSec });
    const windowed = timeToMeet({ type: "skills", skills: { hacking: 2500 } }, base);
    if (!(windowed > base.windowH)) c7.fail("2500 must span installs");
    if (!(windowed < perLifeFiction)) c7.fail(`the ladder (${windowed?.toFixed(0)}h) must beat the per-life fiction (${perLifeFiction?.toFixed(0)}h)`);
    c7.note(`hacking 2500: ${windowed.toFixed(1)}h across installs (per-life fiction said ${perLifeFiction.toFixed(0)}h)`);

    c7.examined(1);
    // A target within this life stays on the exact per-life forecast.
    const near = timeToMeet({ type: "skills", skills: { hacking: 850 } }, base);
    const nearLife = hoursToHackingLevel(850, { exp: base.hackingExp, mult: base.hackingMult, expPerSec: base.expPerSec });
    if (Math.abs(near - nearLife) > 1e-9) c7.fail("within-life targets must not ladder");

    c7.examined(1);
    // The backdoor case rides the same windowed ladder.
    const bd = timeToMeet({ type: "backdoorInstalled", server: "fulcrumassets" }, base);
    if (!(bd > 0 && bd < 200)) c7.fail(`fulcrumassets must be a sane multi-window figure now, got ${bd}`);

    c7.examined(1);
    // No window measured: the old per-life behaviour stands, exactly.
    const noWin = timeToMeet({ type: "skills", skills: { hacking: 2500 } }, { ...base, windowH: undefined });
    if (Math.abs(noWin - perLifeFiction) > 1e-9) c7.fail("without a window the per-life forecast is all there is");
  }
  checks.push(c7);

  return checks;
}
