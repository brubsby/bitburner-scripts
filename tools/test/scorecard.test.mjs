// [SC] the forecast scorekeeper — measurements outrank constants, guards are loud.
//
// The regression this suite pins happened live: the pipeline priced every
// ladder at the dated fallback g = 1.034 while its own ledger had measured
// 1.213, because a min-3-samples guard silently substituted the constant.
// SC1's first assertion IS that exact ledger.

import { Check } from "./harness.mjs";
import "./gameresolve.mjs";

const { measureFromLedger, installRecord, ledgerScores } = await import("../../scorecard.js");

export async function run() {
  const checks = [];

  /* ---------------------------------------------------------------- SC1 --- */
  const c1 = new Check("SC1", "THE LIVE BUG, pinned: two entries is a measurement, not a case for the fallback");
  {
    // The ledger exactly as found on 2026-09-15 when the bug was caught.
    const live = [
      { lifeH: 1.93, hackMult: 2.05 },
      { lifeH: 6.92, hackMult: 2.49 },
    ];
    const m = measureFromLedger(live);
    c1.examined(1);
    if (m.windowMeta.gSource !== "measured") c1.fail("two mult samples must MEASURE g, not fall back — this was the bug");
    if (Math.abs(m.rateGrowthPerCycle - 2.49 / 2.05) > 1e-9) c1.fail(`g should be 1.2146…, got ${m.rateGrowthPerCycle}`);
    c1.examined(1);
    if (m.windowMeta.windowSource !== "measured") c1.fail("two lives must measure the window");
    if (m.windowH !== 1.93) c1.fail(`lower median of [1.93, 6.92] is 1.93 (the conservative window), got ${m.windowH}`);
    c1.note(`the live ledger now measures g=${m.rateGrowthPerCycle.toFixed(3)}, window=${m.windowH}h — the pipeline was running 1.034 / 1.72`);

    c1.examined(1);
    // One entry (or none): the dated fallbacks, NAMED as fallbacks.
    const young = measureFromLedger([{ lifeH: 2, hackMult: 2 }]);
    if (young.windowMeta.gSource !== "fallback" || young.windowMeta.windowSource !== "fallback") {
      c1.fail("a single entry has no delta — the fallback must stand and say so");
    }
    if (young.rateGrowthPerCycle !== 1.034 || young.windowH !== 1.72) c1.fail("the fallbacks are the dated 2026-09-15 measurements");
    c1.examined(1);
    // augsPerWindow: absent until measurable — joinplan's refusal depends on it.
    if ("augsPerWindow" in measureFromLedger(live)) c1.fail("no augs fields yet means NO augsPerWindow, not zero");
    const withAugs = measureFromLedger([{ lifeH: 2, hackMult: 2, augs: 15 }, { lifeH: 2, hackMult: 2.4, augs: 20 }]);
    if (withAugs.augsPerWindow !== 5) c1.fail(`15 -> 20 over one delta is 5/window, got ${withAugs.augsPerWindow}`);
  }
  checks.push(c1);

  /* ---------------------------------------------------------------- SC2 --- */
  const c2 = new Check("SC2", "a binding clamp is LOUD, and unreadable entries never poison a measurement");
  {
    c2.examined(1);
    // Growth beyond the widened clamp: capped AND flagged. The old clamp of
    // 1.2 sat exactly on the real regime and bound silently.
    const hot = measureFromLedger([{ lifeH: 1, hackMult: 1 }, { lifeH: 1, hackMult: 1.8 }]);
    if (hot.rateGrowthPerCycle !== 1.5) c2.fail(`raw 1.8 must clamp to 1.5, got ${hot.rateGrowthPerCycle}`);
    if (hot.windowMeta.gClampBinding !== true) c2.fail("a binding clamp must announce itself");
    if (Math.abs(hot.windowMeta.gRaw - 1.8) > 1e-9) c2.fail("the raw figure is published next to the clamp");
    c2.examined(1);
    const cool = measureFromLedger([{ lifeH: 1, hackMult: 2.05 }, { lifeH: 1, hackMult: 2.49 }]);
    if (cool.windowMeta.gClampBinding !== false) c2.fail("a non-binding clamp reports false, not absence");
    c2.examined(1);
    // Garbage entries are filtered, not fatal; a shrinking mult floors g at 1.
    const messy = measureFromLedger([{ lifeH: NaN, hackMult: 3 }, { lifeH: 2, hackMult: "x" }, { lifeH: 1.5, hackMult: 2.4 }, { lifeH: 2.5, hackMult: 2.6 }]);
    if (messy.windowMeta.windowSource !== "measured" || messy.windowH !== 2) c2.fail("readable lives [2, 1.5, 2.5] must still measure through garbage neighbours (lower median 2)");
    const shrink = measureFromLedger([{ lifeH: 1, hackMult: 3 }, { lifeH: 1, hackMult: 2 }]);
    if (shrink.rateGrowthPerCycle !== 1) c2.fail("growth floors at 1 — a ladder must never price on decay");
  }
  checks.push(c2);

  /* ---------------------------------------------------------------- SC3 --- */
  const c3 = new Check("SC3", "install records carry predictions forward and score the previous ones");
  {
    const used = { g: 1.2, windowH: 1.9, augsPerWindow: 3 };
    c3.examined(1);
    const first = installRecord(null, { lifeH: 2.0, hackMult: 2.5, augs: 15, bitNode: 1 }, used);
    if (Math.abs(first.predicted.nextMult - 3.0) > 1e-9) c3.fail("nextMult = mult x g");
    if (first.predicted.nextLifeH !== 1.9 || first.predicted.nextAugs !== 18) c3.fail("window and count predictions ride the used inputs");
    if (first.scores) c3.fail("no prior prediction means NO scores — absence is 'nothing on record', not 1.0");

    c3.examined(1);
    const second = installRecord(first, { lifeH: 2.85, hackMult: 3.3, augs: 17, bitNode: 1 }, used);
    if (Math.abs(second.scores.mult - 3.3 / 3.0) > 1e-3) c3.fail("mult scored actual/predicted");
    if (Math.abs(second.scores.lifeH - 2.85 / 1.9) > 1e-3) c3.fail("lifeH scored actual/predicted (the key is NOT `window` — that identifier costs 25GB of DOM charge)");
    if (Math.abs(second.scores.augs - 17 / 18) > 1e-3) c3.fail("augs scored actual/predicted");

    c3.examined(1);
    // The rolling report: geometric means per family, 1.0 = calibrated.
    const third = installRecord(second, { lifeH: 1.9, hackMult: 3.96, augs: 20, bitNode: 1 }, used);
    const rep = ledgerScores([first, second, third]);
    if (rep.mult.n !== 2) c3.fail("two scored installs, two samples");
    const geo = Math.sqrt((3.3 / 3.0) * (3.96 / 3.96));
    if (Math.abs(rep.mult.geoMean - +geo.toFixed(3)) > 1e-9) c3.fail(`geoMean hand-check: ${rep.mult.geoMean} vs ${geo}`);
    c3.examined(1);
    // SCORES DO NOT CROSS BITNODES. A forecast made in BitNode 4 describes
    // BitNode 4's multipliers, server money and experience rates; scored
    // against a BitNode 1 life it measures the node, not the forecaster.
    // Live, the first entry after the flume read `mult: 0.046` — which is
    // exactly 1.16/25.382, an SF1-reset multiplier against a BN4 prediction.
    // Those values feed ledgerScores, so one node change would poison the
    // calibration line for the twenty entries it takes to age out.
    const crossed = installRecord({ ...second, bitNode: 4 }, { lifeH: 2.85, hackMult: 1.16, augs: 0, bitNode: 1 }, used);
    if (crossed.scores) c3.fail(`a BitNode 4 prediction scored a BitNode 1 life: ${JSON.stringify(crossed.scores)}`);
    // Untagged is REFUSED, not assumed to match — unknown is not equal. Every
    // entry written before the field existed is in this state.
    for (const [prevN, actualN] of [[undefined, 1], [1, undefined], [undefined, undefined]]) {
      c3.examined(1);
      const e = installRecord({ ...second, bitNode: prevN }, { lifeH: 2.85, hackMult: 3.3, augs: 17, bitNode: actualN }, used);
      if (e.scores) c3.fail(`untagged pair (${prevN}, ${actualN}) scored anyway`);
    }

    c3.examined(1);
    // Partial inputs degrade per-field, never throw.
    const bare = installRecord(null, { lifeH: 2 }, {});
    if (bare.predicted) c3.fail("nothing usable to predict from must carry no prediction block");
    if (Object.keys(ledgerScores([])).length !== 0) c3.fail("an empty ledger reports nothing");
  }
  checks.push(c3);

  /* ---------------------------------------------------------------- SC4 --- */
  const c4 = new Check("SC4", "the regime shift, pinned: recent-lives median + score-driven bias correction");
  {
    // The exact live ledger of 2026-09-15 22:53 — old-regime lives (6.92,
    // 4.50) followed by the post-flywheel regime (1.0-1.6h), with the lifeH
    // scores the scorekeeper had accumulated. The full-ledger median said
    // 1.58-1.93 while lives ran ~1.3; geoMean of scores was 0.631.
    const live = [
      { lifeH: 1.93, hackMult: 2.05 },
      { lifeH: 6.92, hackMult: 2.49 },
      { lifeH: 4.5, hackMult: 3.08 },
      { lifeH: 1.5, hackMult: 3.17, scores: { lifeH: 0.777 } },
      { lifeH: 2.0, hackMult: 3.43, scores: { lifeH: 0.444 } },
      { lifeH: 1.0, hackMult: 3.79, scores: { lifeH: 0.518 } },
      { lifeH: 1.25, hackMult: 3.99, scores: { lifeH: 0.625 } },
      { lifeH: 1.58, hackMult: 4.19, scores: { lifeH: 0.819 } },
      { lifeH: 1.33, hackMult: 4.4, scores: { lifeH: 0.689 } },
    ];
    const m = measureFromLedger(live);
    c4.examined(1);
    // Recent-8 lives: [6.92,4.5,1.5,2.0,1.0,1.25,1.58,1.33] -> lower median 1.5,
    // then the bias factor geoMean(scores) ~0.6349 (clamped floor 0.6+) pulls
    // it toward the true regime.
    const scores = [0.777, 0.444, 0.518, 0.625, 0.819, 0.689];
    const geo = Math.exp(scores.reduce((a, v) => a + Math.log(v), 0) / scores.length);
    const expect = 1.5 * Math.max(0.6, geo);
    if (Math.abs(m.windowH - expect) > 1e-9) c4.fail(`window should be 1.5 x bias(${geo.toFixed(3)}) = ${expect.toFixed(3)}, got ${m.windowH}`);
    if (!(m.windowH < 1.1)) c4.fail("the corrected window must land near the true ~1.0-1.3h regime, not the trailing 1.58-1.93");
    c4.note(`live regime shift: raw median 1.5h x bias ${m.windowMeta.windowBias} = ${m.windowH.toFixed(2)}h (uncorrected full-ledger said 1.58-1.93 vs ~1.3 real)`);
    c4.examined(1);
    if (m.windowMeta.windowBias === undefined) c4.fail("the bias factor must be published");
    if (m.windowMeta.windowBiasClampBinding !== false) c4.fail("a non-binding bias clamp reports false");
    c4.examined(1);
    // Calibrated forecasts leave the median untouched — the correction is a
    // no-op at score 1.0, so it cannot introduce drift of its own.
    const calm = live.map((e) => (e.scores ? { ...e, scores: { lifeH: 1.0 } } : e));
    const mc = measureFromLedger(calm);
    if (Math.abs(mc.windowH - 1.5) > 1e-9) c4.fail("score 1.0 must apply no correction");
    c4.examined(1);
    // Fewer than three scores: median only — one bad score must not steer.
    const young = live.slice(0, 5);
    const my = measureFromLedger(young);
    if (my.windowMeta.windowBias !== undefined) c4.fail("bias needs >=3 scores before it may steer");
    c4.examined(1);
    // A wild score clamps AND announces.
    const wild = live.map((e) => (e.scores ? { ...e, scores: { lifeH: 0.2 } } : e));
    const mw = measureFromLedger(wild);
    if (mw.windowMeta.windowBiasClampBinding !== true) c4.fail("a clamped bias must be loud");
    if (Math.abs(mw.windowMeta.windowBias - 0.6) > 1e-9) c4.fail("the clamp floor is 0.6");
  }
  checks.push(c4);

  return checks;
}
