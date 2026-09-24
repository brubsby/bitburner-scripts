// [IG] the economic install gate.
//
// The governing fact, asserted first (IG1), is that skill level is LINEAR in the
// multiplier and LOGARITHMIC in experience — so BitNode 4's hacking 9000 is
// unreachable by grinding at any rate, and installing is the only path. Every
// other check exists to make sure the gate never becomes the thing that stops
// the run from installing, which is the failure the first version of this file
// shipped: its floor made the threshold `M > 1.5` in every situation.

import fs from "node:fs";
import { Check } from "./harness.mjs";

const gate = await import("../../installgate.js");
const { shouldInstall, progressFactor, skillFromExp, expForSkill, multiplierNeeded, RATE_CHANNELS, scoreFutures, discountFutures, carryPredictions } = gate;
const { achievableRate } = await import("../../scorecard.js");

const H = 3600000;
// Enough experience to clear the (weak) experience floor, and a stall history
// long enough to clear the persistence requirement — so these helpers exercise
// the marginal-vs-average logic rather than tripping over the guards.
const EXP = 1e9;
// `futures: []` means "nothing further is reachable", which is the condition
// under which installing is correct. Tests that want the WAIT branch pass a
// future explicitly.
const at = (hours, M, prev, futures = []) =>
  shouldInstall({ ageMs: hours * H, M, queued: 5, exp: EXP, prev, futures });

export function run() {
  const checks = [];

  /* ---------------------------------------------------------------- IG1 --- */
  const c1 = new Check("IG1", "the exit condition is multiplier-bound, not grind-bound (skill.ts:13)");
  {
    // Against the game's own formula, and the reason the whole model is shaped
    // the way it is. If this ever stops holding, the gate's premise is gone.
    // Computed from skill.ts:13 directly: floor(mult * (32*ln(exp+534.6) - 200)).
    for (const [exp, mult, want] of [[1000, 1, 34], [1e6, 1, 242], [1e6, 2, 484]]) {
      c1.examined(1);
      const got = skillFromExp(exp, mult);
      if (Math.abs(got - want) > 1) c1.fail(`skillFromExp(${exp}, ${mult}) = ${got}, expected ~${want}`);
    }
    // Round trip.
    for (const lvl of [100, 1000, 2500]) {
      c1.examined(1);
      if (skillFromExp(expForSkill(lvl), 1) !== lvl) c1.fail(`expForSkill/skillFromExp do not round-trip at level ${lvl}`);
    }
    // The headline: at mult 1 the BN4 target is absurd; at 10x it is ordinary.
    c1.examined(1);
    const flat = expForSkill(9000, 1);
    if (!(flat > 1e100)) c1.fail(`level 9000 at mult 1 needs only ${flat.toExponential(2)} exp — the premise that grinding cannot work is wrong`);
    c1.examined(1);
    const boosted = expForSkill(9000, 10);
    if (!(boosted < 1e18)) c1.fail(`level 9000 at mult 10 needs ${boosted.toExponential(2)} exp — multipliers do not rescue it as claimed`);
    c1.note(`level 9000 needs ${flat.toExponential(2)} exp at 1x, ${boosted.toExponential(2)} at 10x — installing is the only path`);
    c1.examined(1);
    // The multiplier the run is actually chasing, at a plausible banked exp.
    const need = multiplierNeeded(9000, 1e12);
    if (!(need > 5 && need < 40)) c1.fail(`multiplierNeeded(9000, 1e12) = ${need} — outside any plausible range`);
    c1.note(`with 1e12 exp banked, reaching 9000 needs about ${need.toFixed(1)}x hacking multiplier`);
  }
  checks.push(c1);

  /* ---------------------------------------------------------------- IG2 --- */
  const c2 = new Check("IG2", "it installs when accumulation stalls, and waits while it does not");
  {
    // Stalled: M unchanged over the last interval, so marginal is 0 and the
    // average is positive. This is the common case — reputation or money has
    // gated further purchases and there is nothing to wait for.
    c2.examined(1);
    const stalled = at(6, 1.3, { ageMs: 5 * H, M: 1.3 });
    if (!stalled.install) c2.fail(`a stalled cycle did not install: ${stalled.why}`, "marginal 0 is always below a positive average");

    // Still buying: something materially better is REACHABLE, so waiting wins.
    // Note this is now a statement about the future, not about the last
    // interval — which is the whole point of the rewrite.
    c2.examined(1);
    const buying = at(6, 1.3, { ageMs: 5 * H, M: 1.3 }, [{ waitMs: 2 * H, M: 2.6 }]);
    if (buying.install) c2.fail(`a cycle with a better future installed early: ${buying.why}`);

    // A modest gain that is NOT enough to beat the average should still install.
    c2.examined(1);
    const slowing = at(10, 1.32, { ageMs: 9 * H, M: 1.3 });
    if (!slowing.install) c2.fail(`a slowing cycle did not install: ${slowing.why}`);
  }
  checks.push(c2);

  /* ---------------------------------------------------------------- IG3 --- */
  const c3 = new Check("IG3", "SMALL gains are not refused on principle — the old M>1.5 bar is gone");
  {
    // This is the regression that matters. A single NeuroFlux Governor is
    // +1% on each basket channel (M = 1.01^3 = 1.0303). The previous model
    // demanded M > 1.5 always and would refuse it forever. In a node that can
    // only be left by multiplying, refusing every small gain never reaches the
    // exit — so with accumulation stalled, this must install.
    const nfg = { hacking: 1.01, hacking_money: 1.01, faction_rep: 1.01 };
    const M = progressFactor([nfg]);
    c3.examined(1);
    if (!(M > 1.03 && M < 1.031)) c3.fail(`one NeuroFlux should give M=1.0303, got ${M}`);
    c3.examined(1);
    const d = shouldInstall({ ageMs: 8 * H, M, queued: 1, exp: EXP, prev: { ageMs: 7 * H, M }, futures: [] });
    if (!d.install) c3.fail(`a stalled cycle holding one NeuroFlux refused to install: ${d.why}`,
      "level is linear in the multiplier, so 3% compounded over many cycles is exactly how the exit is reached");
    c3.examined(1);
    // Four NeuroFlux — the real queue observed live.
    const M4 = progressFactor([nfg, nfg, nfg, nfg]);
    if (!(M4 > 1.12 && M4 < 1.13)) c3.fail(`four NeuroFlux should give M=1.1268, got ${M4}`);
  }
  checks.push(c3);

  /* ---------------------------------------------------------------- IG4 --- */
  const c4 = new Check("IG4", "unreadable or empty inputs refuse rather than default to yes");
  {
    const prev = { ageMs: 5 * H, M: 1.2 };
    for (const [name, input] of [
      ["nothing queued", { ageMs: 6 * H, M: 1.5, queued: 0, prev }],
      ["M of exactly 1", { ageMs: 6 * H, M: 1, queued: 3, prev }],
      ["M below 1", { ageMs: 6 * H, M: 0.9, queued: 3, prev }],
      ["NaN M", { ageMs: 6 * H, M: NaN, queued: 3, prev }],
      ["undefined M", { ageMs: 6 * H, M: undefined, queued: 3, prev }],
      ["NaN age", { ageMs: NaN, M: 1.5, queued: 3, prev }],
      ["life younger than the floor", { ageMs: 60000, M: 1.5, queued: 3, prev: { ageMs: 0, M: 1.4 } }],
      ["no previous sample", { ageMs: 6 * H, M: 1.5, queued: 3 }],
      ["previous sample from the future", { ageMs: 6 * H, M: 1.5, queued: 3, prev: { ageMs: 9 * H, M: 1.2 } }],
    ]) {
      c4.examined(1);
      const d = shouldInstall(input);
      if (d.install) c4.fail(`${name} was ACCEPTED`, "'I could not tell' must never encode as 'it is fine'");
    }
  }
  checks.push(c4);

  /* ---------------------------------------------------------------- IG5 --- */
  const c5 = new Check("IG5", "progressFactor composes, ignores absent channels, and is basket-bound");
  {
    c5.examined(1);
    if (progressFactor([]) !== 1) c5.fail("an empty queue must give M = 1, not 0");
    c5.examined(1);
    if (Math.abs(progressFactor([{ hacking: 2 }]) - 2) > 1e-12) c5.fail("absent channels must be treated as 1");
    c5.examined(1);
    if (Math.abs(progressFactor([{ hacking: 2 }, { hacking: 3 }]) - 6) > 1e-12) c5.fail("augmentations must compose multiplicatively");
    c5.examined(1);
    // Experience is worth only its logarithm against this objective, so an
    // exp-only augmentation must not inflate M. Neurotrainer I is the live case.
    if (progressFactor([{ hacking_exp: 10 }]) !== 1) {
      c5.fail(`a channel outside RATE_CHANNELS (${RATE_CHANNELS.join(", ")}) changed M`,
        "level is logarithmic in exp, so counting exp multipliers would overstate the gain from an install");
    }
    c5.examined(1);
    if (progressFactor([null, undefined]) !== 1) c5.fail("null stats entries must not poison M");
    c5.examined(1);
    if (RATE_CHANNELS[0] !== "hacking") c5.fail("`hacking` must lead the basket — it is the channel the exit condition scales with linearly");

    // The rate channels that multiply income INDEPENDENTLY must all be present.
    // Omitting them scored HiveMind and Neuralstimulator at ZERO and undervalued
    // the Cranial Signal Processors line by up to 2.33x, measured against the
    // game's own augmentation table.
    c5.examined(1);
    for (const ch of ["hacking_money", "hacking_speed", "hacking_chance", "hacking_grow", "faction_rep"]) {
      if (!RATE_CHANNELS.includes(ch)) {
        c5.fail(`${ch} is missing from RATE_CHANNELS`,
          "income ~ money_per_hack x hacks_per_second x success_rate, and these multiply it independently");
      }
    }
    c5.examined(1);
    // And the one exclusion this file defends, from the formula rather than taste.
    if (RATE_CHANNELS.includes("hacking_exp")) {
      c5.fail("hacking_exp must stay OUT of the basket",
        "level is mult * (32*ln(exp+534.6) - 200) — logarithmic in experience, so an exp multiplier is worth only its log");
    }
  }
  checks.push(c5);

  /* ---------------------------------------------------------------- IG6 --- */
  const c6 = new Check("IG6", "monotone: a bigger haul and a longer wait both push toward installing");
  {
    const prev = { ageMs: 5 * H, M: 1.2 };
    c6.examined(1);
    // A larger M raises the average, making the stall look worse by comparison.
    if (!(at(6, 2.0, prev).rateNow > at(6, 1.3, prev).rateNow)) c6.fail("a larger M must raise the accumulation rate");
    c6.examined(1);
    // The same M held for longer lowers the average — the cycle is going stale.
    if (!(at(20, 1.3, prev).rateNow < at(6, 1.3, prev).rateNow)) c6.fail("holding the same M for longer must lower the accumulation rate");
    c6.examined(1);
    // A cycle that has stalled stays installed-worthy as it ages.
    const older = shouldInstall({ ageMs: 30 * H, M: 1.3, queued: 5, exp: EXP, prev: { ageMs: 29 * H, M: 1.3 }, futures: [] });
    if (!older.install) c6.fail(`a long-stalled cycle must install: ${older.why}`);
    c6.examined(1);
    // The sample is always returned so the caller can persist it, even on refusal.
    const refused = shouldInstall({ ageMs: 60000, M: 1.5, queued: 1 });
    if (!refused.sample || refused.sample.M !== 1.5) c6.fail("every decision must return a `sample` to persist, including refusals");
  }
  checks.push(c6);

  /* ---------------------------------------------------------------- IG7 --- */
  const c7 = new Check("IG7", "the live thrash is refused for the RIGHT reason: something better was reachable");
  {
    // THE REGRESSION, replayed from the telemetry that caught it:
    //   pending ['NeuroFlux Governor']  M=1.0303  age 60min
    // Two earlier rules installed on this. The first compared payback against a
    // horizon; the second compared a five-minute marginal against the cycle
    // average and fired on any quiet window. Both asked about the PAST.
    const M = progressFactor([{ hacking: 1.01, hacking_money: 1.01, faction_rep: 1.01 }]);
    const prev = { ageMs: 55 * 60000, M };

    // With more augmentations reachable, holding is correct — and it stays
    // correct no matter how long the cycle has been quiet, which is exactly
    // what the stall timer could not express.
    for (const ageMin of [60, 120, 600]) {
      c7.examined(1);
      const d = shouldInstall({ ageMs: ageMin * 60000, M, queued: 1, exp: 1e9, prev,
        futures: [{ waitMs: 60 * 60000, M: M * 1.5 }] });
      if (d.install) c7.fail(`installed at ${ageMin}min while a 1.5x haul was one hour away: ${d.why}`,
        "this is the trade that reset hacking to 1, three times");
    }

    // And it must install once nothing further is reachable — refusing forever
    // is the other failure, and in a multiplier-bound node it is the worse one.
    c7.examined(1);
    const done = shouldInstall({ ageMs: 60 * 60000, M, queued: 1, exp: 1e9, prev, futures: [] });
    if (!done.install) c7.fail(`refused with nothing left to buy: ${done.why}`);

    // A future that is worse per hour than installing now must NOT hold: a
    // large haul far away can be worth less than a small one banked today.
    c7.examined(1);
    const slow = shouldInstall({ ageMs: 60 * 60000, M, queued: 1, exp: 1e9, prev,
      futures: [{ waitMs: 400 * 60000, M: M * 1.05 }] });
    if (!slow.install) c7.fail(`held for a haul that pays a WORSE rate: ${slow.why}`,
      "the rule is ln(M)/time, not 'is more coming'");

    // The experience floor still binds regardless of the future.
    c7.examined(1);
    const noExp = shouldInstall({ ageMs: 60 * 60000, M: 2, queued: 5, exp: 0, prev: { ageMs: 55 * 60000, M: 2 }, futures: [] });
    if (noExp.install) c7.fail(`installed with no experience banked: ${noExp.why}`);
  }
  checks.push(c7);

  /* ---------------------------------------------------------------- IG8 --- */
  const c8 = new Check("IG8", "the Go bonus is REPORTED but not charged — because it regrows");
  {
    // Go node power multiplies faction_rep (effect.ts:90) and an install zeroes
    // it (Go.ts:34-47), so charging it as a divisor on M looks right. It is not,
    // and the live run proved it: the bonus REGROWS on the same timescale as
    // everything else (9.98% ten minutes after an install, 62.58% at 6.1 hours,
    // in a 6.1-hour life). Steady state before is mult*(1+B) and after is
    // mult*M*(1+B) — the same B, which cancels. The transient is the rebuild,
    // and `A` already measures that.
    //
    // Charging it anyway DEADLOCKED the gate: at B = 62.5% an install needed
    // M > 1.625 to break even, nine augmentations worth M = 1.3587 were refused,
    // and the bar kept rising because B grows without bound. In a node whose
    // exit is multiplier-bound, that is the worst failure available.
    const nfg = { hacking: 1.01, hacking_money: 1.01, faction_rep: 1.01 };
    const M = progressFactor(Array(8).fill(nfg));
    const base = { ageMs: 3 * H, queued: 8, exp: 1e9, prev: { ageMs: 2 * H, M }, futures: [] };

    // The decision must be INVARIANT to the Go bonus.
    const ref = shouldInstall({ ...base, M, goBonusPct: 0 });
    for (const pct of [0, 14, 62.5, 200]) {
      c8.examined(1);
      const d = shouldInstall({ ...base, M, goBonusPct: pct });
      if (d.install !== ref.install || Math.abs(d.rateNow - ref.rateNow) > 1e-12) {
        c8.fail(`a ${pct}% Go bonus changed the decision (install=${d.install}, rate=${d.rateNow})`,
          "the bonus regrows and cancels between steady states; charging it double-counts the rebuild that A already prices");
      }
    }

    // THE LIVE DEADLOCK, replayed: 9 augs at M=1.3587 with a 62.49% bonus were
    // refused. They must now install.
    c8.examined(1);
    const live = shouldInstall({ ageMs: 367 * 60000, M: 1.3587, queued: 9, exp: 1e9,
      prev: { ageMs: 360 * 60000, M: 1.3587 }, futures: [], goBonusPct: 62.49 });
    if (!live.install) c8.fail(`the live deadlock still refuses: ${live.why}`,
      "hacking was 412 against the 9000 needed to leave, and the only way there is installing");

    // But it is still REPORTED, so the cost is visible even though it is not charged.
    c8.examined(1);
    if (live.goBonusPct !== 62.49) c8.fail("the Go bonus must still be published for visibility");

    // And ln(M) must stay positive — a negative rate inverts the comparison.
    c8.examined(1);
    const noGain = shouldInstall({ ...base, M: 0.8, queued: 3, goBonusPct: 0 });
    if (noGain.install) c8.fail("M <= 1 must refuse outright rather than compare negative rates");
  }
  checks.push(c8);

  /* ---------------------------------------------------------------- IG9 --- */
  const c9 = new Check("IG9", "faction favour gained at the install DOES multiply M — the mirror of the Go bonus");
  {
    // The symmetry that decides both: does it survive the install?
    //   Go node power   zeroed and REGROWS   -> cancels, must not count (IG8)
    //   faction favour  granted and PERMANENT -> counts
    // Favour multiplies all future faction work by 1 + favor/100
    // (reputation.ts:9) and is never lost, so it is a real permanent gain.
    const nfg = { hacking: 1.01, hacking_money: 1.01, faction_rep: 1.01 };
    const M = progressFactor(Array(9).fill(nfg));
    const base = { ageMs: 6 * H, queued: 9, exp: 1e9, prev: { ageMs: 5 * H, M }, futures: [] };

    c9.examined(1);
    if (Math.abs(shouldInstall({ ...base, M, favorGain: 1 }).Meff - M) > 1e-12) {
      c9.fail("a favour gain of 1 must leave M untouched");
    }
    c9.examined(1);
    const g = shouldInstall({ ...base, M, favorGain: 1.2808 });
    if (Math.abs(g.Meff - M * 1.2808) > 1e-9) c9.fail(`Meff was ${g.Meff}, expected M * 1.2808`);
    c9.examined(1);
    if (!(g.rateNow > shouldInstall({ ...base, M, favorGain: 1 }).rateNow)) {
      c9.fail("a larger favour gain must raise the value of installing");
    }

    // IT MUST NOT MANUFACTURE AN EARLY INSTALL. Right after an install
    // reputation is ~0, so the gain is ~1 and contributes nothing — the term
    // rewards waiting, which is the opposite of the failure mode this file has
    // shipped twice.
    c9.examined(1);
    const fresh = shouldInstall({ ...base, M, favorGain: 1.0 });
    const banked = shouldInstall({ ...base, M, favorGain: 1.28 });
    if (!(banked.Meff > fresh.Meff)) c9.fail("banking reputation must make installing MORE attractive, not less");

    // A gain below 1 is nonsense (favour never decreases) and must be ignored
    // rather than allowed to penalise.
    for (const bad of [0.5, 0, -1, NaN, undefined, null, "1.2"]) {
      c9.examined(1);
      const d = shouldInstall({ ...base, M, favorGain: bad });
      if (Math.abs(d.Meff - M) > 1e-12) c9.fail(`a favourGain of ${String(bad)} changed Meff to ${d.Meff}`);
    }

    // Futures are charged the same gain — otherwise waiting would appear to
    // forfeit favour it would in fact receive.
    c9.examined(1);
    const w = shouldInstall({ ...base, M, favorGain: 1.1, futures: [{ waitMs: 2 * H, M: M * 1.2, favorGain: 1.15 }] });
    const expected = Math.log(M * 1.2 * 1.15) / ((8 * H) / 3600000);
    if (Math.abs(w.rateWait - expected) > 1e-9) c9.fail(`rateWait ${w.rateWait} did not use the future's own favour gain (expected ${expected})`);
  }
  checks.push(c9);

  /* --------------------------------------------------------------- IG10 --- */
  const c10 = new Check("IG10", "the terminal install is never refused — The Red Pill has no multipliers BY DESIGN");
  {
    // THE RUN-ENDING CASE. augplan.js prices The Red Pill with a synthetic
    // selection value and then subtracts it back out of the reported M
    // (augplan.js:911-916, :984), so a plan whose only purchase is The Red Pill
    // reports M = exp(0) = 1 EXACTLY. Every other branch of this gate reads
    // M = 1 as "this install buys nothing" and holds — which refuses the last
    // install of the BitNode on the grounds that finishing it does not raise
    // the hacking multiplier.
    //
    // So this check pins the override against each guard SEPARATELY. A future
    // edit that reinstates any one of them silently would strand the run at the
    // final step, with every other check in this file still passing.
    c10.examined(1);
    const vetoed = shouldInstall({ ageMs: 8 * H, M: 1, queued: 1, exp: EXP, futures: [] });
    if (vetoed.install) c10.fail("without `terminal`, M=1 must still hold — the veto is right in general");
    if (!/no gain/.test(vetoed.why)) c10.fail(`the ordinary M=1 refusal changed wording: ${vetoed.why}`);

    for (const [label, o] of [
      ["M is exactly 1", { ageMs: 8 * H, M: 1, queued: 1, exp: EXP, futures: [] }],
      ["the life is newborn (minAgeMs)", { ageMs: 60000, M: 1, queued: 1, exp: EXP, futures: [] }],
      ["experience is zero (expOk)", { ageMs: 8 * H, M: 1, queued: 1, exp: 0, futures: [] }],
      ["a better future exists (waitBeats)", { ageMs: 8 * H, M: 1, queued: 1, exp: EXP, futures: [{ waitMs: 2 * H, M: 50 }] }],
      ["all four at once", { ageMs: 60000, M: 1, queued: 1, exp: 0, futures: [{ waitMs: 2 * H, M: 50 }] }],
    ]) {
      c10.examined(1);
      const d = shouldInstall({ ...o, terminal: true });
      if (!d.install) c10.fail(`terminal install refused when ${label}: ${d.why}`);
      if (!d.terminal) c10.fail(`terminal flag missing from the decision when ${label}`);
    }
    c10.examined(1);
    if (!/RED PILL/.test(shouldInstall({ ageMs: 8 * H, M: 1, queued: 1, exp: EXP, terminal: true }).why)) {
      c10.fail("the terminal decision must SAY why it overrode the gate — a silent override is unauditable");
    }

    // The override is not a way in for bad data. `terminal` buys a bypass of
    // the ECONOMIC tests only; a plan nobody can read is still refused, because
    // "I could not tell" must not encode as "install".
    c10.examined(1);
    for (const bad of [
      { ageMs: 8 * H, M: NaN, queued: 1 },
      { ageMs: NaN, M: 1, queued: 1 },
      { ageMs: 8 * H, M: 1, queued: 0 },
      { ageMs: 8 * H, M: 1, queued: undefined },
    ]) {
      if (shouldInstall({ ...bad, exp: EXP, terminal: true }).install) {
        c10.fail(`terminal must not override an unreadable input: ${JSON.stringify(bad)}`);
      }
    }
    // And it is opt-IN: only `true` counts, so a truthy accident cannot arm it.
    c10.examined(1);
    for (const sloppy of [1, "yes", {}, [], "false"]) {
      if (shouldInstall({ ageMs: 8 * H, M: 1, queued: 1, exp: EXP, terminal: sloppy }).install) {
        c10.fail(`terminal armed by a non-boolean ${JSON.stringify(sloppy)} — it must be strictly true`);
      }
    }
    c10.note("M=1 on a Red Pill plan is the EXPECTED reading, not a missing gain — the override is pinned against all four guards");
  }
  checks.push(c10);

  /* --------------------------------------------------------------- IG11 --- */
  const c11 = new Check("IG11", "the stopping rule is marginal-vs-rho, and rho makes it immune to dead time");
  {
    // THE DEFECT THIS REPLACES. The average-vs-average rule reduces to
    // `ln(M_future)/ln(M_now) > 1 + wait/A`, so a large A drives the bar toward
    // 1. Live: nine hours stalled at a 32GB home put A at 12.7h, dropping the
    // bar to 1.03 and holding an install that 1.95h of real progress (bar 1.21)
    // would have taken. Dead time made the gate MORE patient.
    const M = 2.9717;
    const future = [{ waitMs: 0.4 * H, M: 3.4429 }];
    c11.examined(1);
    const stalled = shouldInstall({ ageMs: 12.7 * H, M, queued: 18, exp: EXP, prev: { ageMs: 12.3 * H, M: 2.8 }, futures: future });
    const honest = shouldInstall({ ageMs: 1.95 * H, M, queued: 18, exp: EXP, prev: { ageMs: 1.55 * H, M: 2.8 }, futures: future });
    if (stalled.install === honest.install) {
      c11.fail("the old rule is supposed to be A-sensitive — if this stops differing, the fixture no longer reproduces the bug it documents");
    }
    c11.note(`no rho: A=12.7h -> ${stalled.install ? "install" : "hold"}, A=1.95h -> ${honest.install ? "install" : "hold"} (the same decision, two denominators)`);

    // THE FIX: with rho, A is not in the rule at all. Same M, same future, four
    // wildly different life ages — one answer.
    c11.examined(1);
    const marginal = (Math.log(3.4429) - Math.log(M)) / 0.4; // 0.368 ln(M)/h
    for (const [rho, want] of [
      [marginal * 0.5, false], // margin still beats a fresh life -> keep going
      [marginal * 2.0, true], // a fresh life does better -> cash in
    ]) {
      const seen = new Set();
      for (const A of [0.5, 1.95, 12.7, 200]) {
        const d = shouldInstall({ ageMs: A * H, M, queued: 18, exp: EXP, prev: { ageMs: A * H * 0.9, M: 2.8 }, futures: future, rho });
        seen.add(d.install);
        if (d.install !== want) c11.fail(`rho=${rho.toFixed(3)}, A=${A}h: install=${d.install}, expected ${want}`);
      }
      if (seen.size !== 1) c11.fail(`rho=${rho.toFixed(3)}: the decision moved with A — rho must not reference the life's age`);
    }
    c11.note(`marginal of the 0.4h wait = ${marginal.toFixed(4)} ln(M)/h; decision invariant across A in {0.5, 1.95, 12.7, 200}h`);

    // Provenance is published on both paths — a silent fallback is unauditable.
    c11.examined(1);
    const noRho = shouldInstall({ ageMs: 5 * H, M, queued: 18, exp: EXP, prev: { ageMs: 4 * H, M: 2.8 }, futures: future });
    if (!/fallback/.test(noRho.rhoSource)) c11.fail(`absent rho must announce the fallback, got ${noRho.rhoSource}`);
    if (shouldInstall({ ageMs: 5 * H, M, queued: 18, exp: EXP, prev: { ageMs: 4 * H, M: 2.8 }, futures: future, rho: 0.2 }).rho !== 0.2) {
      c11.fail("a measured rho must be published for audit");
    }
    // A rho nobody could measure is refused, never defaulted.
    for (const bad of [0, -1, NaN, "0.3", null, undefined]) {
      c11.examined(1);
      const d = shouldInstall({ ageMs: 5 * H, M, queued: 18, exp: EXP, prev: { ageMs: 4 * H, M: 2.8 }, futures: future, rho: bad });
      if (d.rho !== null) c11.fail(`rho ${JSON.stringify(bad)} must refuse to null, got ${d.rho}`);
    }

    /* -- the estimator ----------------------------------------------------- */
    // SAME BITNODE ONLY. BitNode 4 multiplies server money by 0.1125 and hacking
    // experience by 0.4; its rates say nothing about BitNode 1's.
    c11.examined(1);
    const led = [
      { bitNode: 4, lnM: 3.0, lifeH: 1.0 }, // 3.00/h — must not leak into BN1
      { bitNode: 1, lnM: 1.0, lifeH: 2.0 }, // 0.50/h
      { bitNode: 1, lnM: 1.2, lifeH: 2.0 }, // 0.60/h
      { bitNode: 1, lnM: 9.0, lifeH: 1.0 }, // 9.00/h — one anomaly
    ];
    const r1 = achievableRate(led, 1);
    if (!r1 || r1.n !== 3) c11.fail(`BitNode filter failed: ${JSON.stringify(r1)}`);
    // MEDIAN, not mean: the mean of {0.5, 0.6, 9.0} is 3.37 and would claim a
    // rate no ordinary life here reaches, installing far too early.
    if (Math.abs(r1.rate - 0.6) > 1e-9) c11.fail(`expected the median 0.60, got ${r1.rate}`);
    c11.examined(1);
    // Refusals: too few samples, untagged entries, unusable durations/rewards.
    for (const bad of [
      [[{ bitNode: 1, lnM: 1, lifeH: 2 }], 1],
      [[{ lnM: 1, lifeH: 2 }, { lnM: 2, lifeH: 2 }], 1],
      [[{ bitNode: 1, lnM: 1, lifeH: 0 }, { bitNode: 1, lnM: 2, lifeH: 0.001 }], 1],
      [[{ bitNode: 1, lnM: 0, lifeH: 2 }, { bitNode: 1, lnM: -1, lifeH: 2 }], 1],
      [null, 1],
      [[{ bitNode: 1, lnM: 1, lifeH: 2 }], undefined],
    ]) {
      if (achievableRate(bad[0], bad[1]) !== null) c11.fail(`must refuse: ${JSON.stringify(bad[0])} @ node ${bad[1]}`);
    }
    c11.note("rho refuses on <2 same-node lives, untagged entries, zero-length lives and non-positive rewards — first life of a node has no rho by definition");
  }
  checks.push(c11);

  /* --------------------------------------------------------------- IG12 --- */
  const c12 = new Check("IG12", "ln(M) that adds no distinct augmentation is not progress while the count gate binds");
  {
    // THE TREADMILL. Daedalus admits on 30 DISTINCT augmentations. NeuroFlux is
    // the only repeatable one and contributes to that count exactly never, but
    // it is the most efficient ln(M) purchase in the game — so life after life
    // banked multiplier, cleared this gate honestly, reset the reputation that
    // buys real augmentations, and left the exit as far away as before.
    // Measured in BitNode 1, the distinct count after six installs:
    //     17 -> 18 (+1) -> 18 (+0) -> 21 (+3) -> 21 (+0) -> 21 (+0) -> 21 (+0)
    const base = { ageMs: 8 * H, M: 1.9, queued: 12, exp: EXP, prev: { ageMs: 7 * H, M: 1.4 }, futures: [] };
    c12.examined(1);
    const treadmill = shouldInstall({ ...base, countShort: 9, countGain: 0, countReachableLater: true });
    if (treadmill.install) c12.fail(`a zero-count install cleared the gate while 9 augmentations short: ${treadmill.why}`);
    if (!/ZERO distinct/.test(treadmill.why)) c12.fail(`the hold must say what it is holding for: ${treadmill.why}`);

    // One real augmentation is enough — this is a gate on direction, not size.
    c12.examined(1);
    const moving = shouldInstall({ ...base, countShort: 9, countGain: 1, countReachableLater: true });
    if (!moving.install) c12.fail(`an install that advances the count was refused: ${moving.why}`);

    // THE ESCAPE, and the reason this is not another deadlock. Every guard we
    // have had to repair this session held forever because it could not say
    // what would end it. This one ends when nothing is reachable by waiting —
    // a real terminal condition read from the plan's own `skipped` list, not a
    // timer and not a sample count.
    c12.examined(1);
    const nothingLeft = shouldInstall({ ...base, countShort: 9, countGain: 0, countReachableLater: false });
    if (!nothingLeft.install) c12.fail(`nothing reachable by waiting must release the hold, else the run stalls forever: ${nothingLeft.why}`);

    // Count is irrelevant once the gate is met — never a brake on a finished run.
    c12.examined(1);
    for (const o of [
      { countShort: 0, countGain: 0, countReachableLater: true },
      { countShort: 0, countGain: 0, countReachableLater: false },
    ]) {
      if (!shouldInstall({ ...base, ...o }).install) c12.fail(`countShort 0 must not gate anything: ${JSON.stringify(o)}`);
    }
    // Absent/garbage count inputs degrade to the old behaviour rather than
    // holding on a number nobody supplied.
    c12.examined(1);
    for (const bad of [{}, { countShort: NaN, countGain: 0 }, { countShort: "9", countGain: 0, countReachableLater: true }]) {
      if (!shouldInstall({ ...base, ...bad }).install) c12.fail(`unreadable count inputs must not create a hold: ${JSON.stringify(bad)}`);
    }
    // And it never overrides the terminal install — the Red Pill ends the node,
    // which is the exit the count gate exists to reach.
    c12.examined(1);
    if (!shouldInstall({ ...base, M: 1, countShort: 9, countGain: 0, countReachableLater: true, terminal: true }).install) {
      c12.fail("the count gate must not block THE RED PILL — finishing is what the count was for");
    }
    c12.note("holds on zero count progress, releases on one augmentation or on nothing being reachable, ignores unreadable inputs");
  }
  checks.push(c12);

  /* --------------------------------------------------------------- IG13 --- */
  const c13 = new Check("IG13", "no undeclared floors: the young-life thrash is refused by a DERIVED rule, not a constant");
  {
    // minAgeMs is gone. It was a 15-minute floor on the life's age that this
    // file's own JSDoc described as "belt-and-braces... NOT load-bearing",
    // while being the only thing holding the live run. A number nobody derived,
    // standing in for an argument nobody finished.
    //
    // Deleting a safety net is only honest if the thing it caught is still
    // caught, so this reproduces the failure that motivated it — v2 installing
    // a single NeuroFlux (M = 1.0303) three times in four hours, hacking 260 ->
    // 183 — and requires it to be refused for a REASON, by a rule derived from
    // the objective.
    const nfg = progressFactor([{ hacking: 1.01, hacking_money: 1.01, faction_rep: 1.01 }]);
    c13.examined(1);
    const thrash = shouldInstall({
      ageMs: 0.2 * H, M: nfg, queued: 1, exp: EXP,
      prev: { ageMs: 0.1 * H, M: nfg }, futures: [],
      countShort: 9, countGain: 0, countReachableLater: true,
    });
    if (thrash.install) c13.fail(`the historical thrash case installed: ${thrash.why}`);
    if (/only .* old/.test(thrash.why)) c13.fail(`refused by an age floor, which is supposed to be gone: ${thrash.why}`);
    if (!/ZERO distinct/.test(thrash.why)) {
      c13.fail(`refused, but not by a derived rule — the reason must name the objective: ${thrash.why}`);
    }

    // The floor is really gone: a life seconds old, with the count gate
    // satisfied and nothing better reachable, installs. Under renewal-reward
    // that is correct — if no wait beats what a fresh life sustains, waiting is
    // simply worse, and the clock has no vote.
    c13.examined(1);
    const young = shouldInstall({
      ageMs: 60000, M: 1.6, queued: 4, exp: EXP,
      prev: { ageMs: 30000, M: 1.5 }, futures: [],
      countShort: 0, countGain: 0,
    });
    if (!young.install) c13.fail(`a 1-minute life with nothing better reachable must install, not wait out a clock: ${young.why}`);

    // And the source carries no floor to re-grow: minAgeMs/minStalls may appear
    // in prose explaining their removal, never as code.
    c13.examined(1);
    const src = fs.readFileSync(new URL("../../installgate.js", import.meta.url), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    for (const banned of ["minAgeMs", "minStalls"]) {
      if (code.includes(banned)) c13.fail(`\`${banned}\` is back in installgate.js's CODE — an undeclared floor on an optimisation`);
    }
    c13.note("the thrash is refused by the count gate; a 1-minute life with nothing reachable installs; no age floor in code");
  }
  checks.push(c13);

  // ---------------------------------------------------------------------
  const c14 = new Check("IG14", "the futures are calibrated: a projection that never arrives stops justifying a wait");
  {
    const NOW = 1_000_000_000;
    // THE LIVE CASE, BitNode 5, first life. The gate reported for hours:
    //   "hold: 14 aug(s), M=1.8587. Waiting 0.3h buys M=3.1299"
    // while the plan's M never once moved off 1.8587. Scoring the GAIN (not
    // the level) is what makes this read as total non-delivery.
    const stalled = scoreFutures(
      [{ dueAt: NOW - 1, waitMs: 15 * 60000, predictedM: 3.1299, baselineM: 1.8587 }],
      1.8587,
      NOW,
    );
    c14.examined(1);
    if (stalled.trust !== 0) c14.fail(`a future that delivered nothing must score trust 0, got ${stalled.trust}`);
    const collapsed = discountFutures([{ waitMs: 15 * 60000, M: 3.1299 }], 1.8587, stalled.trust);
    if (Math.abs(collapsed[0].M - 1.8587) > 1e-9) {
      c14.fail(`trust 0 must collapse the future onto the present, got M=${collapsed[0].M}`);
    }
    c14.note(`stalled projection: predicted 3.1299 from 1.8587, delivered 1.8587 -> trust ${stalled.trust}, future collapses to ${collapsed[0].M.toFixed(4)}`);

    // ...and that collapse must actually change the VERDICT, which is the
    // whole point. A=20h is where the rho===null fallback gets so patient that
    // any improvement wins.
    c14.examined(2);
    const A = 20 * H;
    const common = { ageMs: A, M: 1.8587, queued: 14, exp: EXP, prev: { ageMs: A - 300000, M: 1.8587 }, countShort: 0, countGain: 0 };
    const believing = shouldInstall({ ...common, futures: [{ waitMs: 15 * 60000, M: 3.1299 }] });
    const calibrated = shouldInstall({ ...common, futures: collapsed });
    if (believing.install) {
      c14.note("NOTE: the undiscounted future already installs here — the regression this guards is elsewhere");
    }
    if (!calibrated.install) {
      c14.fail(`with the future calibrated away there is nothing better coming, so it must install: ${calibrated.why}`);
    }
    c14.note(`at A=20h: undiscounted -> install=${believing.install}, calibrated -> install=${calibrated.install}`);


    // THE PASS-TO-PASS CYCLE, which is where the first version of this broke.
    // scoreFutures() was correct in isolation and the list it scored was
    // rebuilt from scratch every pass, so a 15-minute horizon never survived
    // the 5-minute cadence: five live passes over 20 minutes, trust=None
    // throughout. Simulate the real loop rather than a hand-built list.
    c14.examined(5);
    const PASS = 5 * 60_000;
    const HORIZONS = [15, 30, 60].map((m) => ({ waitMs: m * 60_000, M: 3.1299 }));
    let pending = [];
    let samples = [];
    let firedAt = null;
    let t = NOW;
    for (let pass = 0; pass < 8 && firedAt === null; pass++, t += PASS) {
      const cal = scoreFutures(pending, 1.8587, t, samples);
      samples = cal.samples;
      if (cal.trust === 0) firedAt = pass;
      pending = carryPredictions(pending, HORIZONS, 1.8587, t);
    }
    if (firedAt === null) {
      c14.fail(
        "over 8 passes (40 simulated minutes) no projection ever matured — trust never leaves null",
        "this is the exact shipped bug: predictions overwritten each pass never reach their own horizon",
      );
    }
    c14.note(`multi-pass loop: a 15-minute horizon matures and trust reaches 0 on pass ${firedAt} (~${firedAt * 5} min)`);

    // And trust must SURVIVE a pass that matures nothing, or it flickers back
    // to null and the gate defers again.
    c14.examined(6);
    const quiet = scoreFutures([], 1.8587, t + PASS, samples);
    if (quiet.trust !== 0) c14.fail(`trust must carry over a pass with nothing matured, got ${quiet.trust}`);

    // A projection that DOES come true must keep its credibility, or the gate
    // would install the moment anything was ever mispredicted.
    c14.examined(3);
    const honest = scoreFutures([{ dueAt: NOW - 1, waitMs: 3600000, predictedM: 3.0, baselineM: 2.0 }], 3.0, NOW);
    if (honest.trust !== 1) c14.fail(`a projection that delivered in full must score trust 1, got ${honest.trust}`);
    const kept = discountFutures([{ waitMs: 3600000, M: 3.0 }], 2.0, honest.trust);
    if (kept[0].M !== 3.0) c14.fail("trust 1 must leave the future untouched");

    // Absence is not a measurement: no matured projection means NO adjustment
    // and a stated reason, never a fabricated number.
    c14.examined(4);
    const none = scoreFutures([], 1.86, NOW);
    if (none.trust !== null) c14.fail(`with nothing matured trust must be null, got ${none.trust}`);
    if (!none.source) c14.fail("an unadjusted result must say why");
    const untouched = discountFutures([{ waitMs: 900000, M: 3.0 }], 1.86, none.trust);
    if (untouched[0].M !== 3.0) c14.fail("a null trust must leave the futures alone");
    // A projection that has not come due yet is not evidence either.
    const early = scoreFutures([{ dueAt: NOW + 60000, waitMs: 900000, predictedM: 3.0, baselineM: 2.0 }], 2.0, NOW);
    if (early.trust !== null) c14.fail("a projection whose horizon has not elapsed must not be scored");
    c14.note(`unmatured and empty both yield trust=null ("${none.source}")`);
  }
  checks.push(c14);

  // ---------------------------------------------------------------------
  const c15 = new Check("IG15", "every verdict names the stopping rule that produced it (rho vs the fallback)");
  {
    // WHY: `waitBeats` is computed one of two completely different ways —
    // marginal-vs-rho when rho is measured, and the average-vs-average form
    // this file documents as getting MORE patient the longer a life stalls
    // when it is not. Which one ran is the first thing anyone debugging a
    // stalled gate needs, and the early returns published neither field, so
    // "rho was never supplied" and "rho exists but we exited early" looked
    // identical from telemetry. Live in BitNode 5 that cost a wrong reading:
    // rho was 0.5011 from 3 completed lives and the published gate showed no
    // rho at all. installgate.js's own comment: "a fallback that is silent is
    // a fallback nobody audits."
    const RHO = { rho: 0.5011, rhoMeta: "median of 3 completed BitNode 5 life/lives" };
    const paths = [
      ["first sample this cycle (early return)", { ageMs: H, M: 1.5, queued: 3, exp: EXP, futures: [] }],
      ["no augmentations queued", { ageMs: H, M: 1, queued: 0, exp: EXP, futures: [], prev: { ageMs: H / 2, M: 1 } }],
      ["full verdict", { ageMs: 5 * H, M: 1.5, queued: 3, exp: EXP, futures: [], prev: { ageMs: 4 * H, M: 1.4 } }],
    ];
    for (const [label, args] of paths) {
      c15.examined(1);
      const withRho = shouldInstall({ ...args, ...RHO });
      if (withRho.rho !== RHO.rho) c15.fail(`${label}: measured rho must survive to the verdict, got ${withRho.rho}`);
      if (withRho.rhoSource !== RHO.rhoMeta) c15.fail(`${label}: rhoSource must carry the provenance verbatim, got ${withRho.rhoSource}`);

      c15.examined(1);
      const without = shouldInstall(args);
      if (without.rho !== null) c15.fail(`${label}: absent rho must report null, not ${without.rho}`);
      if (!/fallback/.test(String(without.rhoSource))) {
        c15.fail(`${label}: the fallback must NAME itself, got ${without.rhoSource}`);
      }
    }
    c15.note(`${paths.length} exit paths checked: each reports rho and rhoSource, and the fallback says so in as many words`);
  }
  checks.push(c15);

  // ---------------------------------------------------------------------
  const c16 = new Check("IG16", "a COUNT BATCH installs at M=1 — the count gate cannot be passed any other way");
  {
    const base = { ageMs: 12 * H, exp: EXP, prev: null, futures: [] };
    // THE LIVE CASE. BitNode 10, 2026-09-24: seven tickets planned, M = 1,
    // countGain 7, countShort 18 — and nothing installed for 11.9 hours,
    // because `M <= 1` returned before the count was ever read. progress.js
    // only buys inside `if (gate.install)`, so the tickets were never even
    // purchased. This asserts it exactly as it was stuck.
    c16.examined(1);
    const live = shouldInstall({ ...base, M: 1, queued: 7, countShort: 18, countGain: 7, countReachableLater: true });
    if (live.install !== true) c16.fail(`seven tickets toward an 18-short count gate must INSTALL at M=1, got hold: ${live.why}`);
    if (live.countInstall !== true) c16.fail("and it must say the count is why");
    if (!/COUNT BATCH/.test(live.why ?? "")) c16.fail(`the reason must name the count batch, not a multiplier: ${live.why}`);

    // NOT gated on countReachableLater: with a gang generating reputation that
    // is true forever, and a hold that cannot state what ends it is a deadlock.
    c16.examined(1);
    if (live.install !== true) c16.fail("countReachableLater: true must not hold a count batch — it never becomes false while a gang runs");

    // ANTI-THRASH: a single ticket right after an install would reset the money
    // that was about to buy several more.
    c16.examined(1);
    const tiny = shouldInstall({ ...base, M: 1, queued: 1, countShort: 18, countGain: 1 });
    if (tiny.install !== false) c16.fail(`one ticket when 18 are needed is below the floor and must hold, got install: ${tiny.why}`);

    // THE FINISHING BATCH is never refused for being small.
    c16.examined(1);
    const last = shouldInstall({ ...base, M: 1, queued: 1, countShort: 1, countGain: 1 });
    if (last.install !== true) c16.fail(`the batch that finishes the gate must install whatever its size, got hold: ${last.why}`);
    const lastTwo = shouldInstall({ ...base, M: 1, queued: 2, countShort: 2, countGain: 2 });
    if (lastTwo.install !== true) c16.fail("two needed and two queued must install");

    // DESTRUCTIVE STILL VETOES: banking count does not outrank losing the gate
    // an install would destroy.
    c16.examined(1);
    const dest = shouldInstall({ ...base, M: 1, queued: 7, countShort: 18, countGain: 7, binding: { gate: "money", destroyedByInstall: true, why: "the join money" } });
    if (dest.install !== false) c16.fail("a destructive binding gate must still veto a count install");

    // THE TREADMILL IS STILL HELD: zero distinct gain is not a count batch, so
    // the M<=1 refusal stands exactly as before.
    c16.examined(1);
    const tread = shouldInstall({ ...base, M: 1, queued: 3, countShort: 18, countGain: 0 });
    if (tread.install !== false) c16.fail("a zero-count queue (NeuroFlux only) must still be refused at M=1");
    // ...and it must now PUBLISH the count state it refused on, not nulls.
    if (tread.countShort !== 18 || tread.countGain !== 0) {
      c16.fail(`the M<=1 refusal must publish countShort/countGain, got ${tread.countShort}/${tread.countGain}`, "they were null on exactly the path that stalled on the count");
    }

    // No count gate at all: behaviour unchanged.
    c16.examined(1);
    const nogate = shouldInstall({ ...base, M: 1, queued: 7, countShort: 0, countGain: 7 });
    if (nogate.install !== false) c16.fail("with no count gate outstanding, M=1 still refuses");

    c16.note(`live case (M=1, 7 tickets, 18 short) -> ${live.install ? "INSTALL" : "hold"}; 1 of 18 -> ${tiny.install ? "install" : "hold"}; 1 of 1 -> ${last.install ? "install" : "hold"}; floor ${gate.COUNT_MIN_BATCH}`);
  }
  checks.push(c16);

  // ---------------------------------------------------------------------
  const c17 = new Check("IG17", "a PRICED count timing overrides the floor in both directions, and says which decided");
  {
    const base = { ageMs: 12 * H, exp: EXP, prev: null, futures: [], M: 1 };
    // THE FLOOR'S MISTAKE, reversed. At three tickets in a mature life the
    // DP says a bigger batch is faster; the floor of three installed here.
    c17.examined(1);
    const wait = shouldInstall({ ...base, queued: 3, countShort: 18, countGain: 3, countTiming: { installNow: false, why: "wait for 7: 0.13h more this life" } });
    if (wait.install !== false) c17.fail(`a priced "wait for a bigger batch" must HOLD even at the floor, got install: ${wait.why}`);
    if (wait.countDecidedBy !== "priced") c17.fail("and it must say the priced timing decided");
    if (!/bigger batch is faster/.test(wait.why ?? "")) c17.fail(`the hold must name the priced reason: ${wait.why}`);

    // And below the floor, a priced "install now" must INSTALL.
    c17.examined(1);
    const go = shouldInstall({ ...base, queued: 2, countShort: 18, countGain: 2, countTiming: { installNow: true, why: "install 2 now" } });
    if (go.install !== true) c17.fail(`a priced "install now" must install even below the floor, got: ${go.why}`);
    if (go.countDecidedBy !== "priced") c17.fail("priced must be named as the decider");

    // UNPRICED: installNow null falls back to the floor, and SAYS so.
    c17.examined(1);
    const blind = shouldInstall({ ...base, queued: 2, countShort: 18, countGain: 2, countTiming: { installNow: null, why: "only 1 completed life/lives recorded" } });
    if (blind.install !== false) c17.fail("unpriced below the floor must hold");
    if (blind.countDecidedBy !== "floor") c17.fail("an unpriced timing must hand the decision to the floor");
    if (!/not yet priced/.test(blind.why ?? "")) c17.fail(`the fallback must say the timing is unpriced, with its reason: ${blind.why}`);
    if (!/completed life/.test(blind.why ?? "")) c17.fail("and carry the timing's own reason for refusing");

    // DESTRUCTIVE still vetoes a priced install.
    c17.examined(1);
    const dest = shouldInstall({ ...base, queued: 5, countShort: 18, countGain: 5, countTiming: { installNow: true, why: "install" }, binding: { gate: "money", destroyedByInstall: true, why: "join money" } });
    if (dest.install !== false) c17.fail("a destructive gate vetoes even a priced install");

    // A priced HOLD must not be overridden by the M<=1 early return reading as
    // a different cause: the count batch reaches its own decision.
    c17.examined(1);
    if (/no gain on/.test(wait.why ?? "")) c17.fail("a priced count hold must not be reported as the M<=1 multiplier refusal");

    c17.note(`priced wait at 3 -> ${wait.install ? "install" : "hold"}; priced install at 2 -> ${go.install ? "install" : "hold"}; unpriced at 2 -> ${blind.install ? "install" : "hold"} via ${blind.countDecidedBy}`);
  }
  checks.push(c17);

  const c18 = new Check("IG18", "install vs hold is decided by simulated exits when they are priced; the rate rule is only the named fallback");
  {
    const prev = { ageMs: 1 * H, M: 1.5 };
    const futures = [{ waitMs: 2 * H, M: 3 }, { waitMs: 4 * H, M: 5 }];
    const base = { ageMs: 3 * H, exp: EXP, prev, futures, M: 2, queued: 4 };
    c18.examined(6);
    const now = shouldInstall({ ...base, exitCompare: { nowH: 50, neverH: 90, waits: [{ waitMs: 2 * H, H: 55 }, { waitMs: 4 * H, H: 60 }] } });
    if (now.install !== true || now.decidedBy !== "exit-sim") c18.fail(`the soonest exit is installing now: ${now.why}`);
    const wait = shouldInstall({ ...base, exitCompare: { nowH: 50, neverH: 90, waits: [{ waitMs: 2 * H, H: 55 }, { waitMs: 4 * H, H: 45 }] } });
    if (wait.install !== false || wait.bestWait?.waitMs !== 4 * H) c18.fail(`a wait whose exit is sooner must hold, naming that wait: ${wait.why}`);
    const never = shouldInstall({ ...base, exitCompare: { nowH: 50, neverH: 40, waits: [{ waitMs: 2 * H, H: 55 }] } });
    if (never.install !== false || never.holdForever !== true) c18.fail(`never installing again, when sooner, is the final window: ${never.why}`);
    // The rate rule would hold here (big M ahead); the exit says install — the exit decides.
    const disagree = shouldInstall({ ...base, rho: 0.0001, exitCompare: { nowH: 10, neverH: 99, waits: [{ waitMs: 4 * H, H: 11 }] } });
    if (disagree.install !== true) c18.fail("when the exit is priced, the rate rule must not overrule it");
    const fb = shouldInstall({ ...base, exitCompare: { nowH: null, why: "exit unpriced" } });
    if (!/^rate-fallback/.test(fb.decidedBy ?? "")) c18.fail(`an unpriced exit falls back to the rate rule and says so: ${fb.decidedBy}`);
    // The count batch is its own gate and still installs.
    const count = shouldInstall({ ...base, M: 1, countShort: 10, countGain: 5, countTiming: { installNow: true, why: "t" }, exitCompare: { nowH: 50, neverH: 40, waits: [] } });
    if (count.install !== true) c18.fail("a priced count batch still installs");
  }
  checks.push(c18);

  return checks;
}
