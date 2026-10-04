// [EC] The exit forecast's calibration (exitcal.js) and the expected-loss
// commitment rule (plan.js decide). docs/bayes.md "Calibration" and
// "Decision rule".
//
//   EC1  DIAGNOSE: a forecast whose stated variance is overstated (revisions
//        0.4x the level interval's resolution) reads OVERSTATED, a hump PIT,
//        and the width multiplier shrinks to ~0.4 with a better CRPS
//   EC2  MARTINGALE: autocorrelated revisions (AR(1), calibrated scale) and
//        biased ones read STRUCTURAL; a calibrated martingale reads calibrated
//   EC3  the legacy one-step predictive is bayes.driftCalibration exactly; the
//        two suspects (prior weight, serial correlation) are named on data
//        built to show each
//   EC4  E-PROCESSES: false-alarm rate <= alpha under H0 by simulation (both
//        tests, continuously monitored); they fire on a 2x-too-narrow and a
//        2.5x-too-wide forecast
//   EC5  EXPECTED-LOSS RULE: switches on a large gain at low P, holds on a
//        small gain at high P (a rare large loss), the old rule reproducible
//        and logged beside it; one flag restores it
//   EC6  value of waiting: >= 0, falls as information per interval falls
//        (rho -> 1), rises with the width multiplier
//   EC7  the state persists and resumes (no pair counted twice; a fresh state
//        on another layout); the exit interval is scaled about its median
//        with the raw kept; levelOf reads fields or the source string
//   EC8  VALUE EQUIVALENCE: the ranking's differences are scored; committed
//        switches are logged with their promise and scored an hour later;
//        the commitment shadow log keeps both verdicts
//   EC9  LIVE REPLAY BN4 2026-10-02 (fixture-bn4-exitcal-0147.json): the 100%
//        one-step coverage is the prior's width; the level interval is too
//        narrow; the revisions are biased (the exit fell ~2.5h/h) — structural
//   EC10 wiring: progress.js carries the state across nodes, sets the
//        commitment calibration each pass, publishes the recalibrated exit
//        with the raw beside it; healthcheck reads planCheck

import "./gameresolve.mjs";
import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const B = await import("../../bayes.js");
const P = await import("../../plan.js");
const E = await import("../../exitcal.js");

const T0 = Date.parse("2026-10-01T00:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

/**
 * A synthetic forecast: E_0 = e0, a sample every dh hours, the level sd
 * shrinking as information arrives uniformly (sigma_t^2 = s0^2 E_t / e0), and
 * each revision u_t = k x (its martingale sd) x noise_t + bias x dh, noise
 * AR(1) with coefficient phi (unit marginal variance). Returns exit samples.
 */
function forecast({ n = 160, e0 = 60, s0 = 6, dh = 0.25, k = 1, phi = 0, bias = 0, seed = 1, life = 1 } = {}) {
  const rand = B.rngOf(seed);
  const out = [];
  let E0 = e0;
  let eps = B.normalOf(rand);
  for (let i = 0; i <= n; i++) {
    const sd = s0 * Math.sqrt(Math.max(1e-6, E0 / e0));
    out.push({ at: iso(T0 + i * dh * 3.6e6), exitH: +E0.toFixed(4), life, ver: "v", boot: 1, source: `plan: synthetic, 80% interval ${(E0 - E.EXITCAL.z80 * sd).toFixed(4)}-${(E0 + E.EXITCAL.z80 * sd).toFixed(4)}h` });
    const msd = sd * Math.sqrt(Math.min(1, dh / E0));
    eps = phi * eps + Math.sqrt(1 - phi * phi) * B.normalOf(rand);
    E0 = Math.max(dh * 2, E0 - dh + k * msd * eps + bias * dh);
  }
  return out;
}

export async function run() {
  const checks = [];

  // -----------------------------------------------------------------------
  const c1 = new Check("EC1", "DIAGNOSE: an overstated-variance forecast reads OVERSTATED (hump PIT, X < 0.5), and the width multiplier shrinks toward the true 0.4 with a better CRPS");
  {
    const S = forecast({ k: 0.4, seed: 11 });
    const r = E.exitCalibrationReport(S);
    c1.examined(S.length);
    c1.note(`verdict: ${r.martingale.why}`);
    c1.note(`PIT (martingale): ${r.pit.martingale.why}`);
    c1.note(`${r.recal.why}; CRPS raw ${r.crps.since.rawH}h -> recalibrated ${r.crps.since.recalH}h; horizons ${JSON.stringify(r.horizons.map((h) => [h.k, h.within.martingaleCover]))}`);
    if (r.martingale.verdict !== "overstated") c1.fail(`a 0.4x forecast must read OVERSTATED, read ${r.martingale.verdict}`, r.martingale.why);
    if (r.pit.martingale.width !== "hump") c1.fail("its PIT must be a hump", r.pit.martingale.why);
    if (!(r.martingale.X < 0.5)) c1.fail(`excess movement X must be < 0.5 (0.16 expected), read ${r.martingale.X}`);
    if (!(r.recal.m > 0.3 && r.recal.m < 0.55)) c1.fail(`the multiplier must approach 0.4, read ${r.recal.m}`);
    if (!(r.recal.applied < 1 && r.recal.applied > r.recal.m)) c1.fail("the applied multiplier is shrunk toward 1 by n / (n + n0)", JSON.stringify(r.recal));
    if (!(r.crps.since.recalH < r.crps.since.rawH)) c1.fail("narrowing a too-wide interval must improve CRPS", JSON.stringify(r.crps.since));
    if (r.crps.since.worse) c1.fail("CRPS 'worse' must not be flagged when it improved");
    // Calibrated: m stays near 1 and the verdict is calibrated.
    const ok = E.exitCalibrationReport(forecast({ k: 1, seed: 12 }));
    c1.note(`calibrated forecast: ${ok.martingale.why}; ${ok.recal.why}`);
    if (ok.martingale.verdict !== "calibrated") c1.fail(`a calibrated martingale must read calibrated, read ${ok.martingale.verdict}`, ok.martingale.why);
    if (!(ok.recal.m > 0.75 && ok.recal.m < 1.35)) c1.fail(`a calibrated forecast's multiplier stays near 1, read ${ok.recal.m}`);
    // Tiny n moves nothing much: 3 revisions apply at most n/(n+8) of ln m.
    const tiny = E.exitCalibrationReport(forecast({ n: 3, k: 0.4, seed: 13 }));
    if (!(Math.abs(Math.log(tiny.recal.applied)) <= (3 / 11) * Math.abs(Math.log(tiny.recal.m)) + 0.01)) c1.fail("with 3 revisions the applied multiplier must be shrunk by 3/11", JSON.stringify(tiny.recal));
  }
  checks.push(c1);

  // -----------------------------------------------------------------------
  const c2 = new Check("EC2", "MARTINGALE TEST: autocorrelated revisions and biased revisions read STRUCTURAL; a jump at an install is named");
  {
    const ar = E.exitCalibrationReport(forecast({ k: 1, phi: 0.7, seed: 21 }));
    c2.examined(3);
    c2.note(`AR(1) 0.7: ${ar.martingale.why}`);
    if (!ar.martingale.structural || !ar.martingale.reasons.some((x) => /autocorrelated/.test(x))) c2.fail("AR(1) revisions must read STRUCTURAL (autocorrelated)", ar.martingale.why);
    const bi = E.exitCalibrationReport(forecast({ n: 60, k: 1, bias: -1.5, seed: 22 }));
    c2.note(`biased -1.5h/h: ${bi.martingale.why}`);
    if (!bi.martingale.structural || !bi.martingale.reasons.some((x) => /biased/.test(x))) c2.fail("revisions drifting 1.5h/h must read STRUCTURAL (biased)", bi.martingale.why);
    if (!(bi.martingale.realisedPerH < -2)) c2.fail(`the realised movement must read ~-2.5h/h, read ${bi.martingale.realisedPerH}`);
    // A jump across an install: two lives, the second starting 15 level sds away.
    const a = forecast({ n: 20, seed: 23, life: 1 });
    const b = forecast({ n: 20, seed: 24, life: 2, e0: a[a.length - 1].exitH + 40 }).map((x, i) => ({ ...x, at: iso(Date.parse(a[a.length - 1].at) + (i + 1) * 0.25 * 3.6e6) }));
    const j = E.exitCalibrationReport([...a, ...b]);
    c2.note(`install jump: ${JSON.stringify(j.martingale.jumps)}`);
    if (!j.martingale.jumps.length || !j.martingale.reasons.some((x) => /jumps at installs/.test(x))) c2.fail("a 40h jump across an install must be named", j.martingale.why);
  }
  checks.push(c2);

  // -----------------------------------------------------------------------
  const c3 = new Check("EC3", "the legacy one-step predictive is bayes.driftCalibration exactly; suspect (a) the prior's weight and (b) serial correlation are each named where the data shows it");
  {
    const fx = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn4-exitcal-0147.json"), "utf8"));
    const S = fx.samples;
    const dc = B.driftCalibration(S);
    const L = E.legacyPredictiveOf(E.revisionsOf(S));
    const cov = L.filter((p) => p.hit).length / L.length;
    c3.examined(S.length);
    if (!(dc.n >= 20)) c3.fail("the fixture must carry pairs to compare", String(dc.n));
    c3.note(`BN4 01:47Z fixture: driftCalibration n ${dc.n} cover ${dc.cover80}; legacyPredictiveOf n ${L.length} cover ${cov.toFixed(3)}`);
    if (L.length !== dc.n || Math.abs(cov - dc.cover80) > 1e-3) c3.fail("the legacy predictive must reproduce driftCalibration's pairs and coverage", `${L.length}/${dc.n}, ${cov}/${dc.cover80}`);
    const pitMean = L.reduce((s, p) => s + p.pit, 0) / L.length;
    if (Math.abs(pitMean - dc.pitMean) > 2e-3) c3.fail("and its PIT", `${pitMean} vs ${dc.pitMean}`);
    // (a) tiny relative revisions (~1%) under the 10% prior: the prior holds b.
    const small = E.exitCalibrationReport(forecast({ n: 30, k: 1, s0: 1.5, seed: 31 }));
    c3.note(`(a) ${small.suspects.prior.why}`);
    if (!small.suspects.prior.guilty) c3.fail("revisions far below the prior's 10% after 30 pairs: the prior must be named as setting the width", small.suspects.prior.why);
    if (!(small.cover80 > 0.9)) c3.fail("and the legacy coverage must read too wide", String(small.cover80));
    // (b) streaky hits: a persistent error, hits and misses in runs.
    const streak = E.suspectsOf(E.revisionsOf(forecast({ n: 60, k: 1, phi: 0.95, s0: 30, seed: 32 })), E.legacyPredictiveOf(E.revisionsOf(forecast({ n: 60, k: 1, phi: 0.95, s0: 30, seed: 32 }))));
    c3.note(`(b) ${streak.serial.why}`);
    if (!(streak.serial.nEff < streak.serial.n)) c3.fail("serially correlated hits must give n_eff < n", streak.serial.why);
    if (!(E.nEffOf(30, 0.5) === 10 && E.nEffOf(30, -0.3) === 30)) c3.fail("n_eff = n (1 - rho) / (1 + rho) for rho > 0, n otherwise");
  }
  checks.push(c3);

  // -----------------------------------------------------------------------
  const c4 = new Check("EC4", "E-PROCESSES are anytime-valid: false-alarm rate <= alpha under H0, monitored after every revision (simulation); both fire on a miscalibrated forecast");
  {
    const runs = 1000;
    const steps = 200;
    let aN = 0;
    let aW = 0;
    let mism = 0;
    for (let s = 1; s <= runs; s++) {
      const rand = B.rngOf(4000 + s);
      const ep = E.calStateNew().eproc;
      let an = false;
      let aw = false;
      for (let i = 0; i < steps; i++) {
        const z = B.normalOf(rand);
        E.epStep(ep.narrow, E.narrowInc(z), E.EXITCAL.eproc.narrow);
        E.epStep(ep.wide, E.wideInc(z), E.EXITCAL.eproc.wide);
        an = an || ep.narrow.e >= 1 / E.EXITCAL.alpha;
        aw = aw || ep.wide.e >= 1 / E.EXITCAL.alpha;
      }
      aN += an;
      aW += aw;
      // The recorded crossing is the 1/alpha crossing, no other.
      if (!!ep.narrow.crossedAt !== an || !!ep.wide.crossedAt !== aw) mism++;
    }
    c4.examined(runs * steps);
    if (mism) c4.fail(`crossedAt disagreed with e >= 1/alpha on ${mism} run(s)`);
    const slack = 2 * Math.sqrt((0.05 * 0.95) / runs);
    c4.note(`H0 (exact predictive), ${runs} runs x ${steps} looks: ever alarmed narrow ${(aN / runs).toFixed(3)}, wide ${(aW / runs).toFixed(3)} (alpha ${E.EXITCAL.alpha}, MC slack ${slack.toFixed(3)})`);
    if (aN / runs > E.EXITCAL.alpha + slack) c4.fail(`narrow false-alarm rate ${aN / runs} > alpha`);
    if (aW / runs > E.EXITCAL.alpha + slack) c4.fail(`wide false-alarm rate ${aW / runs} > alpha`);
    // Power, no recalibration (the raw tests): 2x too narrow, 2.5x too wide.
    let hitN = 0;
    let hitW = 0;
    for (let s = 1; s <= 50; s++) {
      const rand = B.rngOf(9000 + s);
      const ep = E.calStateNew().eproc;
      for (let i = 0; i < 100; i++) {
        E.epStep(ep.narrow, E.narrowInc(2 * B.normalOf(rand)), E.EXITCAL.eproc.narrow);
        E.epStep(ep.wide, E.wideInc(0.4 * B.normalOf(rand)), E.EXITCAL.eproc.wide);
      }
      hitN += ep.narrow.crossedAt ? 1 : 0;
      hitW += ep.wide.crossedAt ? 1 : 0;
    }
    c4.note(`power over 100 revisions: 2x too narrow alarmed ${hitN}/50, 2.5x too wide ${hitW}/50`);
    if (hitN < 45) c4.fail("a 2x-too-narrow forecast must alarm within 100 revisions (>= 90%)");
    if (hitW < 45) c4.fail("a 2.5x-too-wide forecast must alarm within 100 revisions (>= 90%)");
    // Through the report: the RAW wide test fires on the overstated forecast.
    const r = E.exitCalibrationReport(forecast({ k: 0.4, seed: 41 }));
    c4.note(`overstated forecast through the report: ${r.eprocess.rawWide.why}; recalibrated: ${r.eprocess.wide.why}`);
    if (!r.eprocess.rawWide.crossedAt) c4.fail("the raw too-wide e-process must have crossed on a 0.4x forecast");
  }
  checks.push(c4);

  // -----------------------------------------------------------------------
  const c5 = new Check("EC5", "EXPECTED-LOSS COMMITMENT: switches on a large gain at low P(better), holds on a small gain at high P with a rare large loss; the P >= 0.8 rule reproducible and logged; one flag restores it");
  {
    const rand = B.rngOf(55);
    const N = 400;
    const A = Array.from({ length: N }, () => 100);
    // Large gain, low P: D ~ N(2, 10^2) -> P(D > 0) ~ 0.58.
    const big = { A, B: A.map(() => 100 - 2.05 - 10 * B.normalOf(rand)) };
    const r1 = P.decide({ samples: big, committed: "A" });
    c5.examined(4);
    c5.note(`large gain, low P: ${r1.why}`);
    if (r1.choice !== "B") c5.fail("a 2h expected gain at P ~ 0.58 must switch under the expected-loss rule", r1.why);
    if (r1.commit?.old?.switch !== false || r1.commit.agree !== false) c5.fail("the P >= 0.8 rule holds there, and the record says they disagree", JSON.stringify(r1.commit));
    // Small gain, high P: +0.05h in 92% of draws, -0.4h in 8%.
    const small = { A, B: A.map((_, i) => (i % 12 === 0 ? 100.4 + 0.05 : 100 - 0.05 - 0.05)) };
    const r2 = P.decide({ samples: small, committed: "A" });
    c5.note(`small gain, high P: ${r2.why}`);
    if (r2.choice !== "A") c5.fail("a 0.013h expected gain over a rare 0.45h loss must hold (waiting is worth more)", r2.why);
    if (r2.commit?.old?.switch !== true) c5.fail("the P >= 0.8 rule switches there (P 92%)", JSON.stringify(r2.commit));
    // The old rule reproducible: decide(rule p-better) === decideByPBetter, field for field.
    let same = 0;
    for (let t = 0; t < 30; t++) {
      const rr = B.rngOf(500 + t);
      const g = 3 * (rr() - 0.5);
      const sd = 0.2 + 3 * rr();
      const s = { A: A.map(() => 100 + B.normalOf(rr)), B: A.map(() => 100 - g + sd * B.normalOf(rr)), C: A.map(() => 100.5 + 2 * B.normalOf(rr)) };
      const o = P.decideByPBetter({ samples: s, committed: "A" });
      const p = P.decide({ samples: s, committed: "A", rule: "p-better" });
      const n = P.decide({ samples: s, committed: "A" });
      const strip = ({ commit, stats, ...x }) => JSON.stringify(x);
      if (strip(p) === strip(o) && n.commit.old.switch === (o.switched === true)) same++;
    }
    c5.note(`old rule reproduced on ${same}/30 random comparisons`);
    if (same !== 30) c5.fail("decide under 'p-better' must equal decideByPBetter, and the shadow must carry its verdict");
    // One flag: COMMIT.rule.
    const was = P.setCommitCalibration({ rule: "p-better" });
    const r3 = P.decide({ samples: big, committed: "A" });
    P.setCommitCalibration(was);
    if (r3.choice !== "A" || r3.commit.rule !== "p-better") c5.fail("COMMIT.rule 'p-better' must restore the old rule", r3.why);
    if (P.COMMIT.rule !== "expected-loss") c5.fail("the default rule is expected-loss");
  }
  checks.push(c5);

  // -----------------------------------------------------------------------
  const c6 = new Check("EC6", "THE VALUE OF WAITING: never negative; zero information per interval (rho -> 1) is worth nothing; a wider calibrated spread is worth more");
  {
    const rand = B.rngOf(66);
    const D = Array.from({ length: 200 }, () => 0.3 + B.normalOf(rand));
    const v = (o) => P.valueOfWaiting(D, o).vowH;
    c6.examined(5);
    const a = v({ rho: 0.5 });
    const b = v({ rho: 0.9 });
    const c = v({ rho: 0.999 });
    const d = v({ rho: 0.9, widthMult: 3 });
    c6.note(`VOW at rho 0.5 ${a.toFixed(3)}h, 0.9 ${b.toFixed(3)}h, 0.999 ${c.toFixed(3)}h; x3 width at 0.9 ${d.toFixed(3)}h`);
    if (![a, b, c, d].every((x) => x >= 0)) c6.fail("VOW must be >= 0");
    if (!(a > b && b > c && c < 0.02)) c6.fail("VOW must fall as information per interval falls");
    if (!(d > b)) c6.fail("VOW must rise with the width multiplier");
    // Gaussian check: tau psi(mu / tau), psi(x) = phi(x) - x (1 - Phi(x)).
    const tau = Math.sqrt(1 - 0.81);
    const psi = (x) => E.normPdf(x) - x * (1 - E.normCdf(x));
    const exact = tau * psi(0.3 / tau);
    const big = Array.from({ length: 20000 }, (_, i) => 0.3 + B.normalOf(B.rngOf(7000 + i)));
    const mc = P.valueOfWaiting(big, { rho: 0.9 }).vowH;
    c6.note(`Gaussian preposterior: closed form ${exact.toFixed(4)}h, on 20000 draws ${mc.toFixed(4)}h`);
    if (Math.abs(mc - exact) > 0.01) c6.fail("the draws' VOW must match tau psi(mu/tau) for a Gaussian D");
  }
  checks.push(c6);

  // -----------------------------------------------------------------------
  const c7 = new Check("EC7", "STATE: persisted and resumed without double counting, a fresh state on another layout; the exit interval scaled about its median with the raw kept; levelOf reads fields or the source");
  {
    const S = forecast({ n: 80, k: 0.5, seed: 71 });
    const all = E.exitCalibrationReport(S);
    const half = E.exitCalibrationReport(S.slice(0, 41));
    const resumed = E.exitCalibrationReport(S, { state: JSON.parse(JSON.stringify(half.state)) });
    const again = E.exitCalibrationReport(S, { state: resumed.state });
    c7.examined(4);
    c7.note(`one go: m ${all.recal.m}, n ${all.recal.n}; in two passes: m ${resumed.recal.m}, n ${resumed.recal.n}; a third pass over the same samples processed ${again.processed}`);
    if (resumed.recal.n !== all.recal.n || Math.abs(resumed.recal.m - all.recal.m) > 1e-9) c7.fail("two passes must equal one pass over the same revisions");
    if (again.processed !== 0 || again.recal.n !== all.recal.n) c7.fail("a revision must never be counted twice");
    if (resumed.eprocess.narrow.n !== all.eprocess.narrow.n) c7.fail("the e-processes resume too");
    // Another layout is another predictive: it starts fresh AT THE WINDOW'S
    // LAST REVISION (stateVersion 2, 2026-10-04) — the old forecast's errors
    // are not replayed into the new multiplier and e-processes — and resumes
    // from there; no state at all replays the window as before (`all`).
    const fresh = E.exitCalibrationReport(S.slice(0, 60), { state: { v: 999 } });
    const after = E.exitCalibrationReport(S, { state: fresh.state });
    if (!fresh.stateFresh || !fresh.stateRestarted || fresh.recal.n !== 0 || fresh.processed !== 0) c7.fail("another layout's state starts fresh at the last revision (and says so)", `stateFresh ${fresh.stateFresh}, restarted ${fresh.stateRestarted}, n ${fresh.recal.n}, processed ${fresh.processed}`);
    const expectNew = E.revisionsOf(S).filter((r) => r.inRun && Date.parse(r.at) > Date.parse(fresh.state.lastAt)).length;
    if (after.recal.n !== expectNew) c7.fail("the restarted state counts only the revisions after its restart", `n ${after.recal.n} vs ${expectNew}`);
    const ex = E.recalIntervalOf({ q10: 27.664, q50: 29.014, q90: 30.401 }, 2);
    c7.note(`recalIntervalOf x2: ${JSON.stringify(ex)}`);
    if (!(Math.abs(ex.q10 - (29.014 - 2 * 1.35)) < 1e-3 && Math.abs(ex.q90 - (29.014 + 2 * 1.387)) < 1e-3 && ex.rawQ10 === 27.664 && ex.rawQ90 === 30.401)) c7.fail("q10/q90 must move 2x from the median, the raw kept");
    if (E.recalIntervalOf({ q10: 1, q50: 2, q90: 3 }, null).q10 !== 1) c7.fail("no multiplier: the raw interval");
    const lv = E.levelOf({ source: "plan: the Bladeburner route (21 black ops, bbplan.bladeExit), 80% interval 43.447-54.277h" });
    if (!lv || Math.abs(lv.sd - (54.277 - 43.447) / 2.563) > 0.01) c7.fail("levelOf must read the source's interval", JSON.stringify(lv));
    if (E.levelOf({ q10: 1, q90: 3, source: "80% interval 5-9h" }).q10 !== 1) c7.fail("explicit fields win over the source");
    if (E.levelOf({ source: "sensitivity base" }) !== null) c7.fail("no interval: null, never a default");
  }
  checks.push(c7);

  // -----------------------------------------------------------------------
  const c8 = new Check("EC8", "VALUE EQUIVALENCE: the ranking's differences scored sequentially; a committed switch logged with its promise and scored an hour later; the commitment shadow log");
  {
    const rand = B.rngOf(81);
    const pts = Array.from({ length: 30 }, (_, i) => ({ at: iso(T0 + i * 5 * 60e3), life: 1, ver: "v", boot: 1, h: { a: 50 * Math.exp(0.02 * B.normalOf(rand)), b: 52 * Math.exp(0.02 * B.normalOf(rand)), c: 55 * Math.exp(0.02 * B.normalOf(rand)) } }));
    const d = E.diffCalibrationOf(pts);
    c8.examined(3);
    c8.note(`differences: ${d.why}`);
    if (!(d.n === 58 && d.cover80 > 0.5)) c8.fail("29 pass pairs x 2 options against the reference must be scored", d.why);
    const S = forecast({ n: 12, seed: 82 });
    const prevPlan = { at: S[2].at, lastAugReset: 1, exit: { meanH: S[2].exitH }, decisions: { install: { key: "w1", held: false, switched: true, gainH: 0.8, pWin: 0.7, decidedAt: S[2].at, commit: { rule: "expected-loss", switch: true, agree: false, old: { switch: false, key: "now", pWin: 0.7 }, new: { switch: true, key: "w1", gainH: 0.8, vowH: 0.1 } } }, fourS: { key: "none", held: true } } };
    const r = E.exitCalibrationReport(S, { prevPlan });
    c8.note(`switches: ${r.values.switches.why}; ledger ${JSON.stringify(r.state.switches)}`);
    if (r.state.switches.length !== 1 || !Number.isFinite(r.state.switches[0].erosionH)) c8.fail("the switch must be logged and scored once an hour of samples follows it");
    const r2 = E.exitCalibrationReport(S, { prevPlan, state: r.state });
    if (r2.state.switches.length !== 1) c8.fail("the same switch read again must not be logged twice");
    if (r.state.commitLog.length !== 1 || r.state.commitLog[0].agree !== false || r.state.commitLog[0].oldSwitch !== false) c8.fail("the commitment shadow log keeps both verdicts", JSON.stringify(r.state.commitLog));
    const notes = [];
    P.calibrationCheckOf(r, () => {}, notes);
    if (!notes.some((x) => /commitment shadow: 1 decision\(s\) logged, 1 where/.test(x))) c8.fail("the healthcheck notes must report the disagreement", notes.join(" | "));
  }
  checks.push(c8);

  // -----------------------------------------------------------------------
  const c9 = new Check("EC9", "LIVE REPLAY BN4 2026-10-02 (PLAN MISCALIBRATED at 100%): the one-step width is the prior's; the level interval is too narrow; the revisions are biased — the verdict is STRUCTURAL, and the multiplier WIDENS");
  {
    const fx = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn4-exitcal-0147.json"), "utf8"));
    const r = E.exitCalibrationReport(fx.samples, { legacy: B.driftCalibration(fx.samples) });
    c9.examined(fx.samples.length);
    c9.note(`${r.why}`);
    c9.note(`suspects: (a) ${r.suspects.prior.why} (b) ${r.suspects.serial.why}`);
    c9.note(`martingale lives: ${r.martingale.lives.map((l) => `${l.n} rev X ${l.X} ${l.excessPerH}h/h`).join('; ')}`);
    c9.note(`${r.recal.why}; CRPS raw ${r.crps.since.rawH}h vs recalibrated ${r.crps.since.recalH}h; rho ${r.rho.why}`);
    const ex = E.recalIntervalOf(fx.planExit, r.recal.applied);
    c9.note(`the 01:47Z exit 80% ${fx.planExit.q10}-${fx.planExit.q90}h -> ${ex.q10}-${ex.q90}h (x${r.recal.applied})`);
    if (r.cover80 !== 1) c9.fail("the fixture's legacy coverage is the 100% healthcheck read", String(r.cover80));
    if (!r.suspects.prior.guilty) c9.fail("suspect (a), the prior's weight, must be named", r.suspects.prior.why);
    if (r.suspects.serial.guilty) c9.fail("suspect (b) is not the cause on this data (the hits do not run in streaks)", r.suspects.serial.why);
    if (!(r.martingaleCover80 < 0.5)) c9.fail("the level interval must read too narrow (< 50% of revisions inside)", String(r.martingaleCover80));
    if (!r.martingale.structural || !r.martingale.reasons.some((x) => /biased/.test(x))) c9.fail("the verdict must be STRUCTURAL (biased revisions)", r.martingale.why);
    if (!(r.recal.applied > 2)) c9.fail("the multiplier must widen the level interval", r.recal.why);
    if (!(r.crps.since.recalH < r.crps.since.rawH)) c9.fail("and widening must improve CRPS", JSON.stringify(r.crps.since));
  }
  checks.push(c9);

  // -----------------------------------------------------------------------
  const c10 = new Check("EC10", "WIRING: progress.js carries the calibration state across nodes, sets the commitment calibration every pass, publishes the recalibrated exit beside the raw; healthcheck runs planCheck");
  {
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    const plan = fs.readFileSync(path.join(REPO_ROOT, "plan.js"), "utf8");
    c10.examined(5);
    const iState = prog.indexOf("const calState = prev?.calibration?.state ?? null");
    const iNode = prog.indexOf("if (prev && prev.node !== info?.currentNode) prev = null");
    if (iState < 0 || iNode < 0 || iState > iNode) c10.fail("the state must be read BEFORE the plan is dropped for another node");
    if (!/posteriorsOf\(\{ traderBelief[^\n]*calState, prevPlan: prev \}\)/.test(prog)) c10.fail("posteriorsOf must receive calState and prevPlan");
    if (!/setCommitCalibration\(\{ widthMult: post\.calibration\?\.recal\?\.applied/.test(prog)) c10.fail("progress.js must set the commitment calibration from the report each pass");
    if (!/recalIntervalOf\(\{ q10: ex\.q10, q50: ex\.q50, q90: ex\.q90 \}/.test(prog)) c10.fail("the published exit must be recalibrated (raw kept)");
    if (!/exitCalibrationReport\(exitSamples/.test(plan)) c10.fail("posteriorsOf must build the calibration with exitcal");
    if (!/rule: commitRuleText\(\)/.test(prog)) c10.fail("plan.txt must state the active and the shadow rule");
  }
  checks.push(c10);

  return checks;
}
