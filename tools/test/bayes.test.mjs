// [BY] The Bayesian decision layer (bayes.js, plan.js, docs/bayes.md).
//
//   BY1  conjugate updates reproduce their closed forms (NIG, IG, Student-t)
//   BY2  the trader posterior recovers a known return; pooled lives are not
//        falsely certain; the live history fixture agrees with realisedCapital
//   BY3  the structural-error posterior and its calibration: data drawn from
//        the model cover ~80%; an overconfident prior on jumpy data does not
//   BY4  common random numbers: a paired comparison has far less variance
//        than an unpaired one
//   BY5  the commitment rule: stays on a near-tie, switches on clear
//        evidence, releases a gone option, argmin without an incumbent;
//        re-decides on events only

import "./gameresolve.mjs";
import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const B = await import("../../bayes.js");
const P = await import("../../plan.js");
const econ = await import("../../nodeecon.js");

const close = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

export async function run() {
  const checks = [];

  // -----------------------------------------------------------------------
  const c1 = new Check("BY1", "conjugate updates reproduce their closed forms");
  {
    c1.examined(7);
    // Textbook NIG: prior (0, 1, 1, 1), data 1,2,3 -> k 4, m 1.5, a 2.5,
    // b = 1 + 1/2 * 2 + 1/2 * 1*3*(2-0)^2/4 = 3.5.
    const p = B.nigUpdate({ m: 0, k: 1, a: 1, b: 1 }, [1, 2, 3]);
    if (!(close(p.k, 4, 1e-12) && close(p.m, 1.5, 1e-12) && close(p.a, 2.5, 1e-12) && close(p.b, 3.5, 1e-12))) c1.fail("NIG update off its closed form", JSON.stringify(p));
    // Sequential = batch.
    const s1 = B.nigUpdate(B.nigUpdate({ m: 0.3, k: 0.5, a: 2, b: 0.7 }, [1.2, -0.4]), [2.2, 0.9, 1.1]);
    const s2 = B.nigUpdate({ m: 0.3, k: 0.5, a: 2, b: 0.7 }, [1.2, -0.4, 2.2, 0.9, 1.1]);
    if (!["m", "k", "a", "b"].every((k) => close(s1[k], s2[k], 1e-10))) c1.fail("sequential NIG updates differ from the batch update", JSON.stringify({ s1, s2 }));
    // Weights are precisions: weight 2 on one point = that point with half the variance -> m, k match a duplicated point.
    const w = B.nigUpdate({ m: 0, k: 1, a: 1, b: 1 }, [1, 3], [2, 1]);
    const d = B.nigUpdate({ m: 0, k: 1, a: 1, b: 1 }, [1, 1, 3]);
    if (!(close(w.m, d.m, 1e-12) && close(w.k, d.k, 1e-12) && close(w.b, d.b, 1e-12))) c1.fail("a precision weight of 2 must equal a duplicated observation in m, k, b", JSON.stringify({ w, d }));
    // IG with known mean: a + n/2, b + sum x^2 / 2.
    const ig = B.igUpdate({ a: 2, b: 0.5 }, [1, -2, 0.5]);
    if (!(ig.a === 3.5 && close(ig.b, 0.5 + (1 + 4 + 0.25) / 2, 1e-12))) c1.fail("IG update off its closed form", JSON.stringify(ig));
    // Student-t CDF: t=2, df=5 -> 0.94903; t=-1, df=1 (Cauchy) -> 0.25.
    const t1 = B.tCdf(2, 5), t2 = B.tCdf(-1, 1);
    c1.note(`tCdf(2,5)=${t1.toFixed(5)} (0.94903), tCdf(-1,1)=${t2.toFixed(5)} (0.25)`);
    if (!(close(t1, 0.94903, 1e-4) && close(t2, 0.25, 1e-6))) c1.fail("Student-t CDF off");
    // Draws: the sample mean of mu and of sigma^2 match the posterior's.
    const post = B.nigUpdate({ m: 0, k: 1, a: 3, b: 2 }, [0.5, 1.5, 1]);
    const rand = B.rngOf(7);
    let sm = 0, ss = 0;
    const M = 20000;
    for (let i = 0; i < M; i++) {
      const x = B.nigDraw(post, rand);
      sm += x.mu;
      ss += x.s2;
    }
    const es2 = post.b / (post.a - 1);
    c1.note(`nigDraw over ${M}: mean mu ${(sm / M).toFixed(4)} vs ${post.m.toFixed(4)}, mean s2 ${(ss / M).toFixed(4)} vs ${es2.toFixed(4)}`);
    if (!(close(sm / M, post.m, 0.02) && close(ss / M, es2, 0.03))) c1.fail("NIG draws do not match the posterior moments");
    const mm = B.nigMeanMarginal(post);
    if (!close(mm.scale, Math.sqrt(post.b / (post.a * post.k)), 1e-12)) c1.fail("marginal of mu must be t(2a, m, sqrt(b/(a k)))");
  }
  checks.push(c1);

  // -----------------------------------------------------------------------
  const c2 = new Check("BY2", "the trader posterior: recovers a known return, pools lives by random effects, agrees with the realised fit on the live history");
  {
    c2.examined(5);
    // Synthetic: 3 lives at 60%/h per hour of ticks with per-interval noise.
    const rand = B.rngOf(11);
    const rows = [];
    const rTrue = 0.6; // per hour
    for (let life = 0; life < 3; life++) {
      let w = 250e6, pnl = 0;
      for (let t = 9; t <= 1209; t += 10) {
        const dtH = (10 * 6) / 3600;
        const g = Math.exp(rTrue * dtH + 0.02 * Math.sqrt(dtH) * B.normalOf(rand));
        pnl += w * (g - 1);
        w *= g;
        rows.push({ t, wealth: w, lifePnl: pnl, externalFlows: 0 });
      }
    }
    const p = B.traderPosterior(rows);
    c2.note(`synthetic 60%/h over 3 lives: ${(p.perHour.mean * 100).toFixed(1)}%/h ± ${(p.perHour.sd * 100).toFixed(1)}`);
    if (!(Math.abs(p.perHour.mean - rTrue) < 3 * p.perHour.sd + 1e-3)) c2.fail("posterior mean more than 3 sd from the true return");
    if (!(p.lives === 3)) c2.fail("three runs should be three lives");
    // Heterogeneous lives: tau > 0 and the pooled sd wider than a naive pooled fit.
    const rows2 = [];
    for (const [life, r] of [[0, 0.2], [1, 0.9], [2, 0.5]]) {
      let w = 250e6, pnl = 0;
      for (let t = 9; t <= 1209; t += 10) {
        const g = Math.exp(r * (60 / 3600) + 0.02 * Math.sqrt(60 / 3600) * B.normalOf(rand));
        pnl += w * (g - 1);
        w *= g;
        rows2.push({ t, wealth: w, lifePnl: pnl, externalFlows: 0 });
      }
    }
    const h = B.traderPosterior(rows2);
    c2.note(`lives at 20/90/50%/h: pooled ${(h.perHour.mean * 100).toFixed(1)}%/h ± ${(h.perHour.sd * 100).toFixed(1)} (tau ${(Math.sqrt(h.tau2) * 100).toFixed(1)})`);
    if (!(h.tau2 > 0 && h.perHour.sd > 0.1)) c2.fail("lives that disagree must widen the posterior (random effects), not average into false certainty", JSON.stringify(h));
    // The live fixture (2026-09-26 04:11-10:14).
    const live = fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn8-stockhist.txt"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const rc = econ.realisedCapital(live);
    const lp = B.traderPosterior(live, { warmupH: rc.warmupH });
    c2.note(`live fixture: posterior ${lp.perSec.mean.toExponential(3)}/s ± ${lp.perSec.sd.toExponential(2)} (${lp.why}); realisedCapital ${rc.r.toExponential(3)}/s; the rejected estimates were 3.4e-5/s (ledger) and 2.22e-4/s (model)`);
    if (!(Math.abs(lp.perSec.mean - rc.r) < 3 * lp.perSec.sd)) c2.fail("the posterior and the realised fit disagree on the same history by more than 3 sd");
    if (!(Math.abs(3.4e-5 - lp.perSec.mean) > 3 * lp.perSec.sd)) c2.fail("the posterior should exclude the ledger's 3.4e-5/s (that fit was the bug)");
    if (B.traderPosterior([{ t: 1, wealth: 1, lifePnl: 0 }]) !== null) c2.fail("no intervals must be null, never a zero return");
  }
  checks.push(c2);

  // -----------------------------------------------------------------------
  const c3 = new Check("BY3", "structural error: the posterior learns s, and the sequential calibration covers ~80% when the model is right");
  {
    c3.examined(4);
    const rand = B.rngOf(23);
    const t0 = Date.parse("2026-09-26T00:00:00Z");
    const mk = (s, n) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const truth = 100 - i * 0.25;
        out.push({ at: new Date(t0 + i * 0.25 * 3.6e6).toISOString(), exitH: truth * Math.exp(s * B.normalOf(rand)), life: 1 });
      }
      return out;
    };
    const S = mk(0.15, 300);
    const d = B.driftPosterior(S);
    const cal = B.driftCalibration(S);
    c3.note(`s = 15% truth: posterior ${(100 * d.s).toFixed(1)}% over ${d.pairs} pairs; ${cal.why}`);
    if (!(Math.abs(d.s - 0.15) < 0.03)) c3.fail("the drift posterior does not recover s");
    if (!(cal.cover80 > 0.72 && cal.cover80 < 0.88)) c3.fail(`a calibrated model must cover ~80%, got ${cal.cover80}`);
    // Jumpy data (a 50% relative jump every 4th sample) under a tight prior:
    // early pairs fall outside — PIT extremes — visible as miscalibration.
    const J = mk(0.01, 40).map((x, i) => (i % 4 === 3 ? { ...x, exitH: x.exitH * 1.5 } : x));
    const cj = B.driftCalibration(J, { a: 50, b: 49 * 0.01 * 0.01 });
    c3.note(`jumps under an overconfident prior: ${cj.why}`);
    if (!(cj.cover80 < 0.7)) c3.fail("an overconfident prior on jumpy data must show poor coverage");
    if (B.driftCalibration([]).cover80 !== null) c3.fail("no pairs: coverage is unknown (null), not 0 or 1");
  }
  checks.push(c3);

  // -----------------------------------------------------------------------
  const c4 = new Check("BY4", "common random numbers: the paired comparison's variance is a small fraction of the unpaired one");
  {
    c4.examined(2);
    const post = P.posteriorsOf({ stockRows: fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn8-stockhist.txt"), "utf8").trim().split("\n").map((l) => JSON.parse(l)), warmupH: 0.15, exitSamples: JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn8-1232.json"), "utf8")).exitSamples });
    // Two options that both depend on the trader return, one slightly more.
    const simA = (d) => 50 + 2e5 * (2.5e-4 - d.r);
    const simB = (d) => 50.5 + 1.8e5 * (2.5e-4 - d.r);
    const dA = P.makeDraws(post, 400, 1), dB = P.makeDraws(post, 400, 2);
    const paired = P.evaluate([{ key: "a", sim: simA }, { key: "b", sim: simB }], dA, { budgetMs: 1e9 });
    const ea = P.evaluate([{ key: "a", sim: simA }], dA, { budgetMs: 1e9 }).samples.a;
    const eb = P.evaluate([{ key: "b", sim: simB }], dB, { budgetMs: 1e9 }).samples.b;
    const v = (xs) => {
      const m = xs.reduce((s, x) => s + x, 0) / xs.length;
      return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
    };
    const vp = v(paired.samples.a.map((x, i) => x - paired.samples.b[i]));
    const vu = v(ea.map((x, i) => x - eb[i]));
    c4.note(`Var(H_a - H_b): paired ${vp.toFixed(2)} vs unpaired ${vu.toFixed(2)} (ratio ${(vp / vu).toFixed(3)}), trader sd ${post.trader.perSec.sd.toExponential(2)}/s, s ${(100 * post.drift.s).toFixed(1)}%`);
    if (!(vp < 0.3 * vu)) c4.fail("CRN must cut the variance of a paired difference well below the unpaired one");
  }
  checks.push(c4);

  // -----------------------------------------------------------------------
  const c5 = new Check("BY5", "the commitment rule: stay on a near-tie, switch on clear evidence net of switch cost, release a gone option, argmin without an incumbent; re-decide on events only");
  {
    c5.examined(9);
    const N = 200;
    const rand = B.rngOf(5);
    const common = Array.from({ length: N }, () => 10 * B.normalOf(rand));
    const own = (sd) => Array.from({ length: N }, () => sd * B.normalOf(rand));
    const nA = own(3), nB = own(3);
    const tie = { A: common.map((c, i) => 100 + c + nA[i]), B: common.map((c, i) => 99.6 + c + nB[i]) };
    const r1 = P.decide({ samples: tie, committed: "A" });
    c5.note(`near-tie (0.4h on 100h, own sd 3h): ${r1.why}`);
    if (r1.choice !== "A" || r1.switched) c5.fail("a 0.4h expected gain inside the option-specific noise must not switch");
    const clear = { A: tie.A, B: common.map((c, i) => 92 + c + nB[i]) };
    const r2 = P.decide({ samples: clear, committed: "A" });
    c5.note(`clear (8h): ${r2.why}`);
    if (r2.choice !== "B" || !r2.switched) c5.fail("an 8h gain better in nearly every paired draw must switch");
    const r3 = P.decide({ samples: clear, committed: "A", switchCost: { B: 9 } });
    if (r3.choice !== "A") c5.fail("the same gain must not switch when switching costs more than it saves", r3.why);
    const gone = { A: Array(N).fill(null), B: tie.B };
    const r4 = P.decide({ samples: gone, committed: "A" });
    if (r4.choice !== "B") c5.fail("a committed option infeasible in most draws is released", r4.why);
    const r5 = P.decide({ samples: clear, committed: null });
    if (r5.choice !== "B") c5.fail("without an incumbent the least expected exit wins", r5.why);
    // Monotone in theta: a stricter threshold never switches more.
    const r6 = P.decide({ samples: clear, committed: "A", theta: 1.01 });
    if (r6.switched) c5.fail("theta above 1 can never switch");
    // Events.
    const prev = { lastAugReset: 1, decidedAt: new Date(0).toISOString(), posteriors: { trader: { mean: 2e-4, sd: 2e-5 }, s: 0.15 } };
    const now = 10 * 60e3;
    const quiet = P.redecideEvents(prev, { lastAugReset: 1, now, trader: { perSec: { mean: 2.05e-4 } }, drift: { s: 0.16 }, committedAvailable: true });
    if (quiet.length) c5.fail("no event: the plan holds", quiet.join("; "));
    const moved = P.redecideEvents(prev, { lastAugReset: 1, now, trader: { perSec: { mean: 2.5e-4 } }, drift: { s: 0.16 }, committedAvailable: true });
    if (!moved.some((e) => /trader posterior moved/.test(e))) c5.fail("a trader posterior moving 2.5 sd is an event");
    const life = P.redecideEvents(prev, { lastAugReset: 2, now, trader: { perSec: { mean: 2e-4 } }, drift: { s: 0.15 }, committedAvailable: true });
    if (!life.some((e) => /new life/.test(e))) c5.fail("an install is an event");
    const old = P.redecideEvents(prev, { lastAugReset: 1, now: 31 * 60e3, trader: { perSec: { mean: 2e-4 } }, drift: { s: 0.15 }, committedAvailable: true });
    if (!old.some((e) => /min since/.test(e))) c5.fail("the max age is an event");
  }
  checks.push(c5);

  return checks;
}
