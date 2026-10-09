// [SC] THE MONEY / EXP SPLIT IS CONTROLLED CLOSED-LOOP.
//
// User, 2026-10-09: "we should be doing closed loop control on the hacking vs
// experience tuning". 601eba2 priced the split every pass but OPEN-LOOP: the
// money side was the target-count model (moneyModelOf, +40% over live income
// in BN1) and the farm's exp was (1 - s) of the fleet's, while live at 16:00Z
// the farm held ~4.5TB of a 36TB fleet (target-limited: its exp does not fall
// as the money share rises) and nothing the running split measured reached the
// price. splitctl.js closes the loop: batch.js meters what the running split
// yields, the controller calibrates the model with it (Bayesian, the model as
// prior) and picks the next split on the exit with dwell, step limits, a
// priced retarget and exploration only when knowing could move the optimum.
//
//   SC1  CLOSED LOOP CONVERGES: plants whose TRUE rates differ from the
//        model — money x0.6 falling with the split, money x1.4 with the farm
//        target-limited (modelled unsaturated), money x0.3, a tilt that is
//        exact at the running split and wrong away from it, and the live
//        16:12Z state at x0.71 — on the real exit simulator, each ends within
//        2 min of exit of the TRUE optimum, every move <= the step limit, at
//        most one direction reversal, <= 3 probes, never SPLIT OSCILLATING.
//        The OPEN-LOOP controller (measurements ignored) on the same plant
//        misses by > 3 min in every discriminating scenario — so reverting to
//        open loop turns this red. (Offline: seeds 1/2/3/7/11 over 8h, max
//        1.4 min, no reversal, no probe.)
//   SC2  THE METER measures from batch.js's counters after settle only:
//        ramp excluded, rate = counted / window, bucket SE, RAM per GB.
//   SC3  THE CALIBRATION is a Bayesian regression on ln(measured/model):
//        no data = the model (prior); one share pins the scale; two shares
//        identify the tilt; the model-vs-measured error is published and
//        `diverged` past +-40%.
//   SC4  WIRING: batch.js meters (money drops, farm and money exp units, RAM
//        held) and publishes splitMeasure + splitModel; progress.js's
//        farmVerdictOf runs splitControl on them from either mode with its
//        own last state; the healthcheck fails on SPLIT OSCILLATING / SPLIT
//        MODEL OFF / SPLIT UNMEASURED.
//   SC5  ONE INCOME-AT-SHARE (live 16:43Z: the exit priced the future at the
//        $1.70e5/s the batcher earned while the farm held the fleet): the
//        exit inputs every decision reads are conditioned on the
//        controller's split through the controller's own function — the
//        conditioned exit IS the controller's price of its split; the Monte
//        Carlo draws move with it; splitRaw restores the measured inputs.
//
// CALIBRATION: the plants' model curves are moneyModelOf / farmHoldGB on toy
// targets sized to a whole-fleet income ($5e6/s on the 14:47Z fleet; the live
// 16:12Z moneyPreview, $1.8e9/s on 139TB) and the farms of those times; the
// exits are exitplan.bestExitPolicy on the recorded /tel/exitinputs.txt
// (fixture-bn12-farmsplit-1450.json, fixture-bn12-splitctl-1600.json,
// fixture-bn12-split-income-1643.json).

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const C = await import("../../splitctl.js");
const E = await import("../../expfarm.js");
const X = await import("../../exitplan.js");

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn12-splitctl-1600.json"), "utf8"));
const I = F.exitinputs.inputs;
const code = (f) =>
  fs
    .readFileSync(path.join(REPO_ROOT, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
const fnBody = (src, name) => {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) return null;
  const j = src.indexOf("\nfunction ", i + 10);
  return src.slice(i, j < 0 ? undefined : j);
};

// ------------------------------------------------------------- the plant
// A PLANT is one exit surface (exitplan.bestExitPolicy on recorded live
// inputs) and one MODEL (the curves batch.js would publish: moneyModelOf on
// eight toy money targets scaled to `moneyFleet` $/s on the whole fleet,
// expfarm.farmHoldGB for the farm). A SCENARIO is the plant's TRUTH: the model
// x a scale and a shape the model does not have.
//
//   A  the 14:47Z fixture (fixture-bn12-farmsplit-1450.json, 36TB, the farm
//      unsaturated at T 1.3s) with hacking money the only income: the
//      regime of the live 15:57Z grid (farm alone 20.4h, 10% money 11.07h,
//      75% 13.28h) — money-bound at small s, exp-bound at large, so where the
//      optimum sits is worth minutes and a model error can move it.
//   L  the live 16:12Z fixture (139TB, farm target-limited): the exit is FLAT
//      across the split (8.48-8.56h) — the controller must not churn.
const SPACING = 200;
const LSTEP = 0.02; // the exit table's step in ln(income), ln(exp)
const FS = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn12-farmsplit-1450.json"), "utf8"));
function makePlant({ name, inputs, total, farm, moneyFleet, other }) {
  const targets = [1.6, 1.4, 1.2, 1.0, 0.9, 0.8, 0.6, 0.5].map((m, i) => ({ money: m, gb: 134, hackTimeMs: 20000 * (1 + 0.1 * i), score: 1.4e-4 }));
  const raw = E.moneyModelOf(targets.length, (i) => targets[i], { fleetGB: total, spacingMs: SPACING }).modelIncomePerSec;
  for (const t of targets) t.money *= moneyFleet / raw;
  const model = { shares: C.SPLIT_GRID, money: [], moneyExp: [], farmExp: [] };
  for (const s of C.SPLIT_GRID) {
    const m = s > 0 ? E.moneyModelOf(targets.length, (i) => targets[i], { fleetGB: s * total, spacingMs: SPACING }) : null;
    model.money.push(m ? m.modelIncomePerSec : 0);
    model.moneyExp.push(m ? m.batchScorePerGBms * m.moneyGB * 1000 : 0);
    model.farmExp.push(farm.score * E.farmHoldGB({ poolGB: (1 - s) * total, T: farm.T, phi: farm.phi, chance: 1, weakenRate: 1 }) * 1000);
  }
  // THE PLANT'S EXIT, read through a lazy bilinear table in (ln income,
  // ln exp) at 2% steps: the split moves only those two inputs, the surface is
  // smooth, and the controller and the truth read the SAME function — the
  // table changes no comparison, it keeps ~100 passes x 6 runs to hundreds of
  // real exits.
  const memo = new Map();
  const corner = (i, j) => {
    const k = `${i}|${j}`;
    if (!memo.has(k)) memo.set(k, X.bestExitPolicy({ ...inputs, incomePerSec: Math.exp(i * LSTEP), expPerSec: Math.exp(j * LSTEP) })?.best?.hours ?? null);
    return memo.get(k);
  };
  const bestExit = (x) => {
    const u = Math.log(Math.max(1, x.incomePerSec)) / LSTEP;
    const v = Math.log(Math.max(1e-9, x.expPerSec)) / LSTEP;
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const h = [corner(i, j), corner(i + 1, j), corner(i, j + 1), corner(i + 1, j + 1)];
    if (h.some((y) => typeof y !== "number")) return null;
    return { best: { hours: (1 - fu) * (1 - fv) * h[0] + fu * (1 - fv) * h[1] + (1 - fu) * fv * h[2] + fu * fv * h[3] } };
  };
  const at = (key) => (s) => C.curveAt(model, key, s);
  return { name, inputs, total, model, at, bestExit, other, memo };
}
const PA = makePlant({ name: "A", inputs: FS.exitinputs.inputs, total: FS.batch.ram.total, farm: { T: 1300, phi: 0.01, score: FS.batch.expFarm.scorePerGBms }, moneyFleet: 5e6, other: 1e4 });
const PL = makePlant({ name: "L", inputs: I, total: F.batch.ram.total, farm: { T: F.expFarm.hackTimeSec * 1000, phi: 0.05, score: F.expFarm.scorePerGBms }, moneyFleet: F.batch.moneyPreview.modelIncomePerSec, other: Math.max(1e5, I.incomePerSec - F.batch.totals.earnedPerSec) });

// The truths. `discriminates`: the model alone misses the true optimum by
// minutes here (asserted below, so the scenario cannot quietly stop testing).
const SCEN = [
  { name: "A: money x0.6 and falling x0.78 per +10% of split (pipelines saturate sooner than modelled)", plant: PA, discriminates: true, T: { money: (s) => 0.6 * PA.at("money")(s) * Math.exp(-2.5 * (s - 0.1)), farmExp: PA.at("farmExp"), moneyExp: PA.at("moneyExp") } },
  { name: "A: money x1.4, the farm target-limited at 20% of the fleet (modelled unsaturated)", plant: PA, discriminates: true, T: { money: (s) => 1.4 * PA.at("money")(s), farmExp: (s) => Math.min(PA.at("farmExp")(s), 0.2 * PA.at("farmExp")(0)), moneyExp: PA.at("moneyExp") } },
  // A pure SCALE error is absorbed by the inputs measured at the running split
  // (the exit is priced from there): the open loop lands near the truth too.
  { name: "A: money x0.3 (the model over-predicts 3x)", plant: PA, discriminates: false, T: { money: (s) => 0.3 * PA.at("money")(s), farmExp: PA.at("farmExp"), moneyExp: PA.at("moneyExp") } },
  // Exactly right AT the running split, wrong in its tilt: the measurement
  // there agrees with the model, the mean says hold, and only a measurement at
  // a neighbour can show the money falling off — exploration's case.
  { name: "A from 70%: money exactly modelled at 70%, rising x2.7 per -50% of split (tilt only)", plant: PA, discriminates: true, s0: 0.7, T: { money: (s) => PA.at("money")(s) * Math.exp(-2 * (s - 0.7)), farmExp: PA.at("farmExp"), moneyExp: PA.at("moneyExp") } },
  // STABILITY on a flat optimum (55% and 35% within 0.7 min of exit) where an
  // earlier law ping-ponged 55 <-> 60 and re-probed a measured 40% every
  // 35 min (seed 11): it must settle — no more than 3 probes, never
  // oscillating.
  { name: "A, seed 11: money x0.6 falling x0.86 per +10% (a flat optimum, from a chosen 35%)", plant: PA, discriminates: false, seed: 11, s0: 0.35, own: true, T: { money: (s) => 0.6 * PA.at("money")(s) * Math.exp(-1.5 * (s - 0.1)), farmExp: PA.at("farmExp"), moneyExp: PA.at("moneyExp") } },
  { name: "L: live 16:12Z, money x0.71 (+40% over-prediction), farm x0.5", plant: PL, discriminates: false, T: { money: (s) => PL.at("money")(s) / 1.4, farmExp: (s) => 0.5 * PL.at("farmExp")(s), moneyExp: PL.at("moneyExp") } },
];

function truthOf(P, T) {
  const S0 = 0.1;
  const flat = P.inputs.expFlatPerSec > 0 ? Math.min(P.inputs.expFlatPerSec, P.inputs.expPerSec) : 0;
  // the measured script exp at S0 is the fixture's; the truth's units scale to it
  const scale = (P.inputs.expPerSec - flat) / (T.farmExp(S0) + T.moneyExp(S0));
  const inputs = (s) => ({ ...P.inputs, incomePerSec: P.other + T.money(s), expPerSec: flat + scale * (T.farmExp(s) + T.moneyExp(s)) });
  const H = (s) => P.bestExit(inputs(s))?.best?.hours ?? null;
  let opt = { frac: null, hours: Infinity };
  for (const s of C.SPLIT_GRID) if (s <= C.SPLIT.maxFrac + 1e-9 && H(s) < opt.hours) opt = { frac: s, hours: H(s) };
  return { inputs, H, opt };
}

/** A meter on split s that began 20 min before `now`, settled 5 min in, with 15 one-minute buckets of T's rates (x noise()). */
function liveMeter(P, T, s, now, noise = () => 0) {
  const m = C.meterNew(s, now - 20 * 60e3);
  C.meterTick(m, now - 15 * 60e3, 0, { ready: true, moneyGB: 1, farmGB: 1 });
  for (let i = 14; i >= 0; i--) {
    C.meterAdd(m, "money", T.money(s) * 60 * Math.max(0, 1 + 0.05 * noise()));
    C.meterAdd(m, "farmE", T.farmExp(s) * 60 * Math.max(0, 1 + 0.05 * noise()));
    C.meterAdd(m, "moneyE", T.moneyExp(s) * 60 * Math.max(0, 1 + 0.05 * noise()));
    C.meterTick(m, now - i * 60e3, 60e3, { ready: true, moneyGB: s * P.total * 0.8, farmGB: (1 - s) * P.total * 0.5 });
  }
  return m;
}

/**
 * Run the plant under the controller for `hours` from split s0, the way the
 * game runs it: progress.js decides every 5 min, batch.js applies a published
 * split ~30s later and starts a new segment, the money side ramps (8 min up:
 * prep of new targets; 3 min down) at half rate, measurements carry 5% noise
 * per one-minute bucket. Returns the trajectory.
 */
function simulate(P, T, { learn = true, hours = 8, s0 = 0.1, seed = 7, trace = false, own = false } = {}) {
  const tr = truthOf(P, T);
  let rng = seed;
  const noise = () => {
    // Box-Muller on a small LCG: deterministic
    rng = (rng * 1103515245 + 12345) % 2147483648;
    const u = (rng + 1) / 2147483649;
    rng = (rng * 1103515245 + 12345) % 2147483648;
    const v = (rng + 1) / 2147483649;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  let now = Date.parse("2026-10-09T16:12:00Z");
  let s = s0;
  let meter = liveMeter(P, T, s, now, noise); // the live split has run 20 min
  let applyAt = null;
  let pendingS = null;
  let rampUntil = now;
  // `own`: the running split is one the controller chose (not a start).
  let state = own ? { ...C.ctlNew(1, null), switches: [{ at: now - 30 * 60e3, from: s0 - 0.05, to: s0, kind: "exploit" }] } : null;
  const moves = [];
  const passes = [];
  for (let minute = 0; minute < hours * 60; minute++) {
    now += 60e3;
    if (applyAt !== null && now >= applyAt) {
      const up = pendingS > s;
      s = pendingS;
      meter = C.meterNew(s, now);
      rampUntil = now + (up ? 8 : 3) * 60e3;
      applyAt = null;
    }
    const ramping = now < rampUntil;
    const k = ramping ? 0.5 : 1;
    C.meterAdd(meter, "money", k * T.money(s) * 60 * Math.max(0, 1 + 0.05 * noise()));
    C.meterAdd(meter, "farmE", T.farmExp(s) * 60 * Math.max(0, 1 + 0.05 * noise()));
    C.meterAdd(meter, "moneyE", k * T.moneyExp(s) * 60 * Math.max(0, 1 + 0.05 * noise()));
    C.meterTick(meter, now, 60e3, { ready: !ramping, moneyGB: s * P.total * 0.8, farmGB: (1 - s) * P.total * 0.5 });
    if (minute % 5 === 4) {
      // The hacking stream the inputs carry is what the plant EARNED — half
      // while the money side ramps (the 16:43Z collapse in miniature); the
      // controller replaces it with its calibrated curve (inputsAt).
      const hackNow = (ramping ? 0.5 : 1) * T.money(s);
      const r = C.splitControl({ bestExitPolicy: P.bestExit, inputs: { ...tr.inputs(s), incomePerSec: P.other + hackNow }, share0: s, measure: C.meterReport(meter, now), model: P.model, state, nowMs: now, lastAugReset: 1, learn, hackPerSec: hackNow });
      if (r.frac === null) throw new Error(`controller refused: ${r.why}`);
      state = r.state;
      passes.push({ minute, s, kind: r.kind, frac: r.frac, osc: r.oscillating, r: trace ? r : undefined });
      if (r.frac !== s && r.kind !== "pending" && applyAt === null) {
        moves.push({ minute, from: s, to: r.frac, kind: r.kind, why: r.why });
        pendingS = r.frac;
        applyAt = now + 30e3;
      }
    }
  }
  return { s, tr, moves, passes, state, oscillatedEver: passes.some((p) => p.osc) };
}

// THE TOLERANCE the closed loop is held to: 2 min of a ~27h exit (0.12%) —
// the controller's own stopping band is the hysteresis (1 min) plus one
// posterior sd of the gain, and seeds 1/2/3/7/11 land within 1.4 min. The
// whole mixed range of these surfaces spans 3-10 min, so a looser bound would
// pass any split; the model alone must miss by > OPEN_MISS_H in every
// discriminating scenario or the scenario is not testing the loop.
const TOL_H = 2 / 60;
const OPEN_MISS_H = 3 / 60;

// For tracing a scenario by hand (not a check).
export const __debug = { SCEN, simulate, truthOf };

export async function run() {
  const checks = [];

  // -------------------------------------------------------------------
  {
    const c = new Check("SC1", "closed loop: a plant whose true rates differ from the model converges to the TRUE optimum split without oscillating; the open loop does not");
    let openWrong = 0;
    const t0 = Date.now();
    for (const { name, plant: P, T, discriminates, s0 = 0.1, seed = 7, own = false } of SCEN) {
      c.examined(1);
      const cl = simulate(P, T, { learn: true, hours: 4, s0, seed, own });
      const ol = discriminates ? simulate(P, T, { learn: false, hours: 2, s0 }) : null;
      const { opt, H } = cl.tr;
      // A run that ends mid-probe (an explore not yet returned from) rests
      // where the probe left from: the trial is a measurement in progress.
      const sw = cl.state.switches;
      const probing = sw.length && sw[sw.length - 1].kind === "explore" && sw[sw.length - 1].to === cl.s;
      const rest = probing ? sw[sw.length - 1].from : cl.s;
      const hCl = H(rest);
      const hOl = ol ? H(ol.s) : null;
      const { reversals: rev, probes: done } = C.reversalsOf(probing ? sw.slice(0, -1) : sw, Infinity, Infinity);
      const probes = done + (probing ? 1 : 0);
      // A START (the running split is not one the controller chose) goes
      // straight to the estimate by design; every later move is step-limited.
      const maxStep = cl.moves.filter((m) => m.kind !== "start").reduce((a, m) => Math.max(a, Math.abs(m.to - m.from)), 0);
      c.note(`${name}: TRUE optimum ${Math.round(opt.frac * 100)}% ${opt.hours.toFixed(2)}h | closed loop -> ${Math.round(rest * 100)}%${probing ? ` (probing ${Math.round(cl.s * 100)}%)` : ""} ${hCl.toFixed(2)}h in ${cl.moves.length} moves [${cl.moves.map((m) => `${m.minute}m ${Math.round(m.from * 100)}->${Math.round(m.to * 100)} ${m.kind}`).join(", ")}] | open loop -> ${ol ? `${Math.round(ol.s * 100)}% ${hOl.toFixed(2)}h` : "not run (not a discriminating scenario)"}`);
      if (!(hCl - opt.hours <= TOL_H)) c.fail(`${name}: the closed loop ended at ${Math.round(rest * 100)}% (${hCl.toFixed(3)}h), ${((hCl - opt.hours) * 60).toFixed(1)} min of exit from the true optimum ${Math.round(opt.frac * 100)}% (${opt.hours.toFixed(3)}h)`);
      if (maxStep > C.SPLIT.stepMax + 1e-9) c.fail(`${name}: a move of ${(maxStep * 100).toFixed(0)}% exceeds the step limit ${C.SPLIT.stepMax * 100}%`);
      if (rev > 1) c.fail(`${name}: ${rev} direction reversals — the controller oscillates: ${cl.moves.map((m) => `${Math.round(m.from * 100)}->${Math.round(m.to * 100)}`).join(" ")}`);
      if (probes > 3) c.fail(`${name}: ${probes} explore/return probes in 4h — probing churn`);
      if (cl.oscillatedEver) c.fail(`${name}: the controller published oscillating`);
      if (cl.moves.length > 12) c.fail(`${name}: ${cl.moves.length} moves in 4h — not settling`);
      if (discriminates && hOl - opt.hours > OPEN_MISS_H) openWrong++;
      else if (discriminates) c.fail(`${name}: the open loop is within ${((hOl - opt.hours) * 60).toFixed(1)} min of the true optimum — this scenario no longer tests closing the loop`);
    }
    // The scenarios must DISCRIMINATE: the open loop (the model alone) misses
    // the true optimum in most of them, or this check proves nothing.
    c.note(`open loop misses the true optimum by > ${(OPEN_MISS_H * 60).toFixed(1)} min in ${openWrong}/${SCEN.filter((x) => x.discriminates).length} discriminating scenarios; ${PA.memo.size + PL.memo.size} exits priced in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("SC2", "the meter: settle excludes the ramp; rate = counted / window; bucket SE; RAM held per GB");
    c.examined(5);
    const t0 = 1e12;
    const m = C.meterNew(0.25, t0);
    let t = t0;
    // 5 minutes of ramp at a huge rate: must not count
    for (let i = 0; i < 5; i++) {
      t += 60e3;
      C.meterAdd(m, "money", 1e12);
      C.meterTick(m, t, 60e3, { ready: false, moneyGB: 100, farmGB: 50 });
    }
    if (m.settledAt !== null) c.fail("the meter settled while not ready");
    t += 60e3;
    C.meterTick(m, t, 60e3, { ready: true, moneyGB: 100, farmGB: 50 });
    const rates = [100, 120, 80, 100];
    for (const r of rates) {
      t += 60e3;
      C.meterAdd(m, "money", r * 60);
      C.meterAdd(m, "farmE", 10 * 60);
      C.meterTick(m, t, 60e3, { ready: true, moneyGB: 100, farmGB: 50 });
    }
    const rep = C.meterReport(m, t);
    const se = Math.sqrt(((0 + 400 + 400 + 0) / 3) / 4);
    if (!rep.settled || rep.settleSec !== 360) c.fail(`settle: ${JSON.stringify({ settled: rep.settled, settleSec: rep.settleSec })}`);
    if (rep.n !== 4 || Math.abs(rep.money.perSec - 100) > 1e-9) c.fail(`the ramp leaked into the rate: ${JSON.stringify(rep.money)} over n ${rep.n}`);
    if (Math.abs(rep.money.se - se) > 1e-9) c.fail(`bucket SE ${rep.money.se} vs ${se}`);
    if (Math.abs(rep.perGB.moneyPerGBs - 1) > 1e-9 || Math.abs(rep.perGB.farmExpPerGBs - 0.2) > 1e-9) c.fail(`per GB: ${JSON.stringify(rep.perGB)}`);
    // never ready: force-settled after maxUnsettledMs, and says so
    const m2 = C.meterNew(0.5, t0);
    C.meterTick(m2, t0 + C.SPLIT.maxUnsettledMs + 1, 60e3, { ready: false });
    if (!(m2.settledAt !== null && m2.forced)) c.fail("a segment that never settles must be force-settled after maxUnsettledMs and flagged forced");
    c.note(`ramp excluded (settle ${rep.settleSec}s), $${rep.money.perSec}/s +- ${rep.money.se.toFixed(2)} over ${rep.n} buckets, $${rep.perGB.moneyPerGBs}/GB-s`);
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("SC3", "calibration: Bayesian on ln(measured/model) with the model as prior; scale from one share, tilt from two; error published, diverged past 40%");
    c.examined(5);
    const p0 = C.fitStream([], "money", 0);
    if (p0.a !== 0 || p0.b !== 0) c.fail(`no data must be the model (a 0, b 0): ${JSON.stringify(p0)}`);
    const ob = (frac, meas, model, se = 0.01 * meas) => ({ frac, at: 0, money: { meas, se, model } });
    const p1 = C.fitStream([ob(0.1, 60, 100)], "money", 0);
    if (!(Math.abs(Math.exp(p1.a + p1.b * (0.1 - 0.5)) - 0.6) < 0.03)) c.fail(`one share must pin the curve there: ${Math.exp(p1.a + p1.b * -0.4)} vs 0.6`);
    const p2 = C.fitStream([ob(0.1, 60, 100), ob(0.4, 30, 100)], "money", 0);
    const fitAt = (p, s) => Math.exp(p.a + p.b * (s - 0.5));
    if (!(Math.abs(fitAt(p2, 0.1) - 0.6) < 0.03 && Math.abs(fitAt(p2, 0.4) - 0.3) < 0.02)) c.fail(`two shares must identify the tilt: ${fitAt(p2, 0.1)} / ${fitAt(p2, 0.4)}`);
    if (!(p2.C[1][1] < p1.C[1][1] / 4)) c.fail(`a second share must shrink the tilt's variance: ${p1.C[1][1]} -> ${p2.C[1][1]}`);
    // diverged + error published, through the controller
    const { plant: P, T } = SCEN.find((x) => x.name.startsWith("L:"));
    const tr = truthOf(P, T);
    const now = 2e12;
    const m = liveMeter(P, T, 0.1, now);
    const r = C.splitControl({ bestExitPolicy: P.bestExit, inputs: tr.inputs(0.1), share0: 0.1, measure: C.meterReport(m, now), model: P.model, state: null, nowMs: now, lastAugReset: 1 });
    const em = r.calib?.money?.err;
    c.note(`money err ${em === undefined ? "?" : (em * 100).toFixed(1)}%, farm err ${(r.calib.farmExp.err * 100).toFixed(1)}%; diverged: ${JSON.stringify(r.diverged)}`);
    if (!(Math.abs(em - (1 / 1.4 - 1)) < 0.01)) c.fail(`the published money error must be measured/model - 1 = -28.6%: ${em}`);
    if (!r.diverged.some((d) => d.startsWith("farmExp"))) c.fail("a farm stream at x0.5 of its model (beyond +-40%) must be published diverged");
    if (r.diverged.some((d) => d.startsWith("money"))) c.fail("money at -28.6% is inside the 40% tolerance and must not be flagged");
    const h = C.splitHealth({ control: r }, { expFarm: {}, splitMeasure: {} });
    if (!h.some((p) => /SPLIT MODEL OFF/.test(p.what))) c.fail(`splitHealth must fail SPLIT MODEL OFF on a diverged stream: ${JSON.stringify(h)}`);
    if (!C.splitHealth({ control: { ...r, oscillating: true, reversals3h: 3, switches3h: 4 } }, {}).some((p) => /SPLIT OSCILLATING/.test(p.what))) c.fail("splitHealth must fail SPLIT OSCILLATING");
    if (!C.splitHealth(null, { expFarm: {} }).some((p) => /SPLIT UNMEASURED/.test(p.what))) c.fail("splitHealth must fail when the farm runs without a meter");
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("SC4", "wiring: batch.js meters and publishes; progress.js runs splitControl on it with its own state; the healthcheck runs splitHealth");
    c.examined(10);
    const b = code("batch.js");
    const p = code("progress.js");
    const h = code("tools/healthcheck.mjs");
    const fv = fnBody(p, "farmVerdictOf");
    const ft = fnBody(b, "farmTick");
    if (!ft || (ft.match(/meterAdd\(meter, 'farmE'/g) ?? []).length < 4) c.fail("farmTick must count every farm launch (prep weaken, wave weaken, grow, hacks) into the meter");
    if (!/meterAdd\(meter, 'money', dropped\)/.test(b)) c.fail("batch.js must meter the money targets' drops");
    if ((b.match(/meterAdd\(meter, 'moneyE'/g) ?? []).length < 4) c.fail("batch.js must meter the money side's exp (prep weaken, prep grow+weaken, batches, spill)");
    if (!/meterTick\(meter, now, tickMs, \{ ready, moneyGB: moneyHeld/.test(b)) c.fail("batch.js must tick the meter with readiness and the RAM each side holds");
    if (!/splitMeasure: meter \? meterReport\(meter, now\) : null/.test(b) || !/splitModel,/.test(b)) c.fail("batch.txt must publish splitMeasure and splitModel");
    if (!/meterNew\(frac, now\)/.test(b) || !/meter\.hostKey !== hk/.test(b)) c.fail("a new split, or a new set of money targets, must start a new measurement segment");
    if (!/farmHoldGB\(/.test(b)) c.fail("the farm's model curve must be its own wave sizing (expfarm.farmHoldGB)");
    if (!fv || !/splitControl\(\{ bestExitPolicy, inputs: raw, share0, measure: b\.splitMeasure, model: b\.splitModel, state: prevCtl, [^}]*hackPerSec: inputs\?\.split\?\.hackPerSec/.test(fv)) c.fail("progress.js farmVerdictOf must run splitControl on batch.txt's measurement and model, its own last state, the raw inputs and their hacking stream");
    if (!fv || !/const raw = splitRaw\(inputs\)/.test(fv)) c.fail("farmVerdictOf must price from the inputs as measured at the running split (splitRaw)");
    if (!fv || !/const share0 = b\.expFarm \? [^\n]* : 1/.test(fv)) c.fail("the controller must run from money mode too (share0 1): a life opens there");
    if (!fv || !/control: \{ \.\.\.pub, state \}/.test(fv)) c.fail("the controller's state and published fields must be written to /tel/expfarm.txt `control`");
    if (!/splitHealth\(/.test(h)) c.fail("tools/healthcheck.mjs must run splitctl.splitHealth (SPLIT OSCILLATING / SPLIT MODEL OFF)");
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("SC5", "one income-at-share: the exit inputs every decision reads are conditioned on the controller's split through the controller's own function");
    c.examined(6);
    // Live BN12 16:43Z (life of 16:32Z): the exit inputs carried $1.70e5/s —
    // the hacking stream the batcher earned under the split it ran, $6.68e7/s
    // the life before — and the exit priced the whole future at it.
    const X0 = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn12-split-income-1643.json"), "utf8"));
    const raw = X0.inputs;
    const hack = Math.max(0, raw.incomePerSec - raw.contractMoneyPerSec);
    const now = Date.parse(X0.at);
    // A controller that measured the 16:12Z split (L, money x0.71) carries
    // its calibration into this life; it prices from the raw inputs.
    const { plant: P, T } = SCEN.find((x) => x.name.startsWith("L:"));
    const m = liveMeter(P, T, 0.1, now);
    const r0 = C.splitControl({ bestExitPolicy: X.bestExitPolicy, inputs: raw, share0: 0.1, measure: C.meterReport(m, now), model: P.model, state: null, nowMs: now, lastAugReset: X0.lastAugReset, bitNode: 12, hackPerSec: hack });
    if (r0.frac === null) c.fail(`the controller refused: ${r0.why}`);
    else {
      const rec = { at: X0.at, lastAugReset: X0.lastAugReset, priced: true, moneyShare: r0.frac, control: { calib: r0.calib } };
      const batch = { expFarm: { moneyShare: 0.1 }, splitModel: P.model };
      const cond = C.splitConditioned(raw, { rec, batch, lastAugReset: X0.lastAugReset, nowMs: now, hackPerSec: hack });
      const hRaw = X.bestExitPolicy(raw)?.best?.hours;
      const hCond = X.bestExitPolicy(cond)?.best?.hours;
      c.note(`16:43Z inputs: raw $${Math.round(raw.incomePerSec)}/s -> exit ${hRaw.toFixed(2)}h; conditioned on the controller's ${Math.round(r0.frac * 100)}% [${r0.kind}]: $${Math.round(cond.incomePerSec)}/s -> ${hCond.toFixed(2)}h (the controller priced that split ${r0.shareH.toFixed(2)}h); ${cond.split?.why}`);
      if (!cond.split?.conditioned) c.fail(`the inputs were not conditioned: ${cond.split?.why}`);
      // ONE SOURCE OF TRUTH: the exit every other decision prices IS the controller's price of its split.
      if (!(Math.abs(hCond - r0.shareH) < 1e-6)) c.fail(`the conditioned exit ${hCond}h is not the controller's own price of its split ${r0.shareH}h — two income-at-share functions`);
      const M = (s) => C.curveAt(P.model, "money", s) * r0.calib.money.scale * Math.exp(r0.calib.money.tilt * (s - 0.5));
      if (!(Math.abs(cond.incomePerSec - (raw.incomePerSec - hack + M(r0.frac))) < 1e-6 * cond.incomePerSec)) c.fail(`the hacking stream must be replaced by the calibrated curve at the split: ${cond.incomePerSec} vs ${raw.incomePerSec - hack + M(r0.frac)}`);
      if (!(hRaw - hCond > 1)) c.fail(`conditioning must undo the 16:43Z collapse (raw ${hRaw.toFixed(2)}h vs ${hCond.toFixed(2)}h)`);
      const back = C.splitRaw(cond);
      if (back.incomePerSec !== raw.incomePerSec || back.expPerSec !== raw.expPerSec || "incomeSplitDelta" in back || "split" in back) c.fail("splitRaw must restore the inputs as measured (the controller prices from them)");
      // stale / other-life / open-loop records leave the inputs as measured, and say so
      for (const [why, rr] of [["another life", { ...rec, lastAugReset: 1 }], ["stale", { ...rec, at: "2026-10-09T15:00:00Z" }], ["no calibration", { ...rec, control: null }]]) {
        const u = C.splitConditioned(raw, { rec: rr, batch, lastAugReset: X0.lastAugReset, nowMs: now, hackPerSec: hack });
        if (u.split?.conditioned !== false || u.incomePerSec !== raw.incomePerSec || !u.split?.why) c.fail(`${why}: must stay unconditioned with a why (${JSON.stringify(u.split)})`);
      }
    }
    // The Monte Carlo draws of the hacking stream move with it (plan.applyDraw), floored at 0.
    const PL_ = await import("../../plan.js");
    const d = { incomeLn: Math.log(5000) };
    const up = PL_.applyDraw({ incomeFromPrior: true, incomeFlatPerSec: 1000, incomePerSec: 6000, incomeSplitDelta: 7000 }, d);
    const dn = PL_.applyDraw({ incomeFromPrior: true, incomeFlatPerSec: 1000, incomePerSec: 6000, incomeSplitDelta: -9000 }, d);
    if (Math.abs(up.incomePerSec - 13000) > 1e-6 || Math.abs(dn.incomePerSec - 1000) > 1e-6) c.fail(`plan.applyDraw must shift the hacking draw by incomeSplitDelta, floored at 0: ${up.incomePerSec} / ${dn.incomePerSec}`);
    // wiring: every exit of the pass is built from the conditioned inputs
    const p = code("progress.js");
    if (!/const out = splitConditionedOf\(ns, info, exitInputsBaseOf\(/.test(p)) c.fail("progress.js exitInputsGen must condition the base inputs on the split (splitConditionedOf)");
    if (!/splitConditioned\(base, \{ rec: readJson\(ns, '\/tel\/expfarm\.txt'\), batch: readJson\(ns, '\/tel\/batch\.txt'\)/.test(p)) c.fail("splitConditionedOf must use the controller's published record and batch.js's model");
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("SC6", "the law, piece by piece on a toy exit: start, dwell, step limit, confidence margin, priced retarget, return after a trial, calibration across an install");
    c.examined(8);
    // A toy plant: money linear in s, the farm linear in 1 - s, a convex exit
    // (optimum 30%); everything decided here is one call, no simulation.
    const G = C.SPLIT_GRID;
    const MODEL = { shares: G, money: G.map((s) => 2e7 * s), moneyExp: G.map((s) => 1e3 * s), farmExp: G.map((s) => 1e5 * (1 - s)) };
    const exitOf = (x) => ({ best: { hours: 5 + 2e7 / Math.max(1, x.incomePerSec) + 6e5 / x.expPerSec } });
    const base = (s) => ({ incomePerSec: 2e7 * s + 1e5, expPerSec: 1e5 * (1 - s) + 1e3 * s + 1, expFlatPerSec: 0 });
    const now = 3e12;
    const seg = (s, { settled = true, ageMin = 30 } = {}) => ({ segId: `seg:${s}:${ageMin}`, frac: s, ageSec: ageMin * 60, settled, settleSec: 300, forced: false, n: settled ? 10 : 0, money: settled ? { perSec: 2e7 * s, se: 2e5 * s } : null, farmExp: settled ? { perSec: 1e5 * (1 - s), se: 1e3 * (1 - s) } : null, moneyExp: settled ? { perSec: 1e3 * s, se: 10 * s + 1e-9 } : null });
    const snap2 = (x) => Math.round(x * 1e6) / 1e6;
    const st = (extra = {}) => ({ v: 1, bitNode: 12, lastAugReset: 5, obs: [], switches: [{ at: now - 3600e3, from: 0.05, to: 0.1, kind: "exploit" }], target: null, targetAt: null, s0: null, s0Since: null, ...extra });
    // The running split is one the controller chose (else it is a START).
    const settledAt = (s0, extra = {}) => st({ s0, s0Since: now - 40 * 60e3, switches: [{ at: now - 3600e3, from: snap2(s0 - 0.05), to: s0, kind: "exploit" }], ...extra });
    const obsOf = (fs, settleSec = 300) => fs.map((f, i) => ({ segId: `t${i}`, frac: f, at: now, n: 20, settleSec, forced: false, money: { meas: 2e7 * f, se: 2e4 * f, model: 2e7 * f }, farmExp: { meas: 1e5 * (1 - f), se: 100 * (1 - f), model: 1e5 * (1 - f) }, moneyExp: { meas: 1e3 * f, se: f, model: 1e3 * f } }));
    const run = (s0, { state = null, meter = {}, lastAugReset = 5 } = {}) => C.splitControl({ bestExitPolicy: exitOf, inputs: base(s0), share0: s0, measure: seg(s0, meter), model: MODEL, state, nowMs: now, lastAugReset, bitNode: 12, hackPerSec: 2e7 * s0 });
    const say = (name, r) => c.note(`${name}: [${r.kind}] ${Math.round(r.frac * 100)}% — ${r.why.slice(0, 150)}`);
    // START: a life's opening split, nothing settled, nothing switched -> straight to the optimum (no step limit).
    const a = run(0.1, { meter: { settled: false, ageMin: 2 } });
    say("start", a);
    if (a.kind !== "start" || a.frac !== 0.3) c.fail(`a life's opening split must go straight to the posterior's optimum 30%: [${a.kind}] ${a.frac}`);
    // DWELL: a split the controller just chose, unsettled, whose gain to the optimum lies inside the
    // posterior's band, waits for its measurement (25% -> 30%: minutes at the mean, +- tens).
    const b = run(0.25, { meter: { settled: false, ageMin: 2 }, state: st({ switches: [{ at: now - 2 * 60e3, from: 0.1, to: 0.25, kind: "exploit" }] }) });
    say("just moved, unsettled", b);
    if (b.kind !== "dwell" || b.frac !== 0.25) c.fail(`an unsettled split whose gain is inside the uncertainty band must dwell: [${b.kind}] ${b.frac}`);
    // PRICED DWELL: the same unsettled split 4.4h from the optimum — waiting costs more than the
    // measurement could change, so the step is taken now (live 17:53Z held 0% for "41.1 min").
    const pd = run(0.1, { meter: { settled: false, ageMin: 2 }, state: st() });
    say("unsettled, 4.4h from the optimum", pd);
    if (pd.kind !== "exploit" || Math.abs(pd.frac - 0.25) > 1e-9 || !pd.dwell?.overridden) c.fail(`a dwell priced above its measurement's value must give way to a step-limited move: [${pd.kind}] ${pd.frac} ${JSON.stringify(pd.dwell)}`);
    // STEP LIMIT: settled and well past dwell, 10% -> the 30% optimum moves 15%, not 20%.
    const d = run(0.1, { state: settledAt(0.1) });
    say("step", d);
    if (d.kind !== "exploit" || Math.abs(d.frac - 0.25) > 1e-9) c.fail(`a move is limited to ${C.SPLIT.stepMax * 100}%: [${d.kind}] ${d.frac}`);
    // CONFIDENCE: 25% -> 30% gains minutes at the mean; with the posterior at its prior (one share measured) the
    // spread is larger than the gain — no exploit. With six shares measured tight on the model, the same move goes.
    const loose = run(0.25, { state: settledAt(0.25) });
    const tight = run(0.25, { state: settledAt(0.25, { obs: obsOf([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) }) });
    say("loose posterior", loose);
    say("tight posterior", tight);
    if (!(loose.gainH > C.SPLIT.hystH && loose.gainH - C.SPLIT.zGain * loose.sdGainH < C.SPLIT.hystH)) c.fail(`precondition: the loose case must gain more than the hysteresis at the mean and less than it after the margin (gain ${loose.gainH}, sd ${loose.sdGainH})`);
    else if (loose.kind === "exploit") c.fail(`an exploit inside the posterior's own spread chases its bias: [${loose.kind}] gain ${(loose.gainH * 60).toFixed(1)} +- ${(loose.sdGainH * 60).toFixed(1)} min`);
    if (tight.kind !== "exploit" || tight.frac !== 0.3) c.fail(`a confident gain must be taken: [${tight.kind}] ${tight.frac}`);
    // PRICED RETARGET: the same confident move with ramps measured at 3h each costs more than it gains.
    const slow = run(0.25, { state: settledAt(0.25, { obs: obsOf([0.1, 0.2, 0.3, 0.4, 0.5, 0.6], 3 * 3600) }) });
    say("3h ramps", slow);
    if (!(slow.costH > 0)) c.fail(`a retarget must be priced (cost ${slow.costH})`);
    if (slow.kind === "exploit") c.fail(`a move whose ramp costs more than it gains must not be taken: [${slow.kind}] cost ${(slow.costH * 60).toFixed(1)} min vs gain ${(tight.gainH * 60).toFixed(1)}`);
    // RETURN: a trial 30% -> 35% measured; the mean prefers where it came from -> back, with no confidence margin.
    const back = run(0.35, { state: settledAt(0.35, { switches: [{ at: now - 3600e3, from: 0.2, to: 0.3, kind: "exploit" }, { at: now - 40 * 60e3, from: 0.3, to: 0.35, kind: "explore" }] }) });
    say("after a trial", back);
    if (back.kind !== "return" || back.frac !== 0.3) c.fail(`a trial the mean does not prefer must return to its origin: [${back.kind}] ${back.frac}`);
    // THE WHOLE PATH CLEARS THE HYSTERESIS, not each step: a surface falling 0.1h per unit of split, every
    // 15% step 0.9 min (under the 1-min hysteresis), the path to 95% 5.1 min — the first step is taken
    // (a per-step rule stopped SC1 at 25% of a 90% optimum).
    const flatExit = (x) => ({ best: { hours: 10 - (0.1 * x.incomePerSec) / 2e7 } });
    const tightAll = obsOf([0.1, 0.3, 0.5, 0.7, 0.9]);
    const walk = C.splitControl({ bestExitPolicy: flatExit, inputs: base(0.1), share0: 0.1, measure: seg(0.1), model: MODEL, state: settledAt(0.1, { obs: tightAll }), nowMs: now, lastAugReset: 5, bitNode: 12, hackPerSec: 2e7 * 0.1 });
    say("flat path", walk);
    if (walk.kind !== "exploit" || Math.abs(walk.frac - 0.25) > 1e-9) c.fail(`a path worth ${(0.085 * 60).toFixed(1)} min in 0.9-min steps must be walked: [${walk.kind}] ${walk.frac}`);
    // OSCILLATION: three direction reversals inside 3h are published and damp the law (dwell x3).
    const flip = (i) => ({ at: now - (100 - 20 * i) * 60e3, from: i % 2 ? 0.1 : 0.25, to: i % 2 ? 0.25 : 0.1, kind: "exploit" });
    const osc = run(0.25, { state: st({ switches: [0, 1, 2, 3].map(flip), s0: 0.25, s0Since: now - 15 * 60e3 }) });
    say("after 3 reversals", osc);
    if (!osc.oscillating || osc.reversals3h !== 3) c.fail(`3 reversals in 3h must publish oscillating: ${osc.oscillating}, ${osc.reversals3h}`);
    if (osc.kind !== "dwell") c.fail(`an oscillating controller must damp (dwell x${C.SPLIT.oscDamp}): [${osc.kind}] after 15 min`);
    // ACROSS AN INSTALL (same node): the observations carry, the switches and the target do not.
    const carried = run(0.1, { state: settledAt(0.1, { lastAugReset: 4, obs: obsOf([0.2, 0.4]), target: 0.6, targetAt: now - 60e3 }), lastAugReset: 5 });
    if (carried.state.obs.length < 2 || carried.state.switches.some((w) => w.at < now - 60e3) || carried.state.lastAugReset !== 5) c.fail(`a new life must keep the calibration and drop the switches: ${carried.state.obs.length} obs, ${carried.state.switches.length} switches, life ${carried.state.lastAugReset}`);
    const otherNode = C.splitControl({ bestExitPolicy: exitOf, inputs: base(0.1), share0: 0.1, measure: seg(0.1), model: MODEL, state: settledAt(0.1, { obs: obsOf([0.2, 0.4]) }), nowMs: now, lastAugReset: 5, bitNode: 9 });
    if (otherNode.state.obs.some((o) => o.segId.startsWith("t"))) c.fail("another node's calibration must not carry");
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("SC7", "the live 17:53:52Z state: a restart's 0% priced 4.1h worse is left now — the dwell is priced against the gap, a restart is a start, the wait published is the real one");
    c.examined(6);
    // batch.js restarted ~17:49Z and came back at 0% (no verdict yet); the
    // first controller pass (62e2718) published [dwell] "41.1 min left on 0%
    // (settled, 3/5 buckets, 4 min on this split); best now 20% 4.14h vs
    // 8.23h". The fixture is that pass's own exit inputs, batch.js's model and
    // the segment as published (n 3, the farm's measured rate).
    const L = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn12-splitdwell-1753.json"), "utf8"));
    const ef = L.expfarm;
    const now = Date.parse(ef.at);
    const segP = ef.control.segment;
    const ob = ef.control.state.obs.find((o) => o.segId === segP.segId);
    const measure = { segId: segP.segId, frac: 0, ageSec: segP.ageMin * 60, settled: true, settleSec: 0, forced: false, n: segP.n, money: { perSec: 0, se: 0 }, farmExp: { perSec: ob.farmExp.meas, se: ob.farmExp.se }, moneyExp: { perSec: 0, se: 0 } };
    const raw = C.splitRaw(L.exitinputs.inputs);
    const hack = L.exitinputs.inputs.split?.hackPerSec ?? null;
    const call = (state) => C.splitControl({ bestExitPolicy: X.bestExitPolicy, inputs: raw, share0: 0, measure, model: L.batch.splitModel, state, nowMs: now, lastAugReset: ef.lastAugReset, bitNode: 12, hackPerSec: hack });
    const r = call(null);
    c.note(`17:53Z replayed: [${r.kind}] ${Math.round(r.frac * 100)}% — ${String(r.why).slice(0, 220)}`);
    if (!r.grid) {
      c.fail(`the controller refused: ${r.why}`);
      checks.push(c);
      return checks;
    }
    // The replay reproduces the published pricing (calibration of the fixture, printed either way).
    const pub20 = ef.grid.find((g) => g.frac === 0.2)?.hours;
    c.note(`replay vs published: 0% ${r.runH.toFixed(3)}h vs ${ef.runH.toFixed(3)}h; 20% ${r.grid.find((g) => g.frac === 0.2)?.hours.toFixed(3)}h vs ${pub20.toFixed(3)}h`);
    // 0.1h: batch.js's model curves in the fixture are 6s newer than the pass's; the decision's gap is 4.1h.
    if (!(Math.abs(r.runH - ef.runH) < 0.1 && Math.abs(r.grid.find((g) => g.frac === 0.2).hours - pub20) < 0.1)) c.fail("the replay does not reproduce the published 17:53Z pricing — the fixture is not the live state");
    if (r.frac === 0 || r.kind === "dwell") c.fail(`a split the controller prices ${(r.runH - r.best.hours).toFixed(2)}h worse must not be held for a measurement: [${r.kind}] ${r.frac}`);
    if (r.kind !== "start") c.fail(`a running split this controller did not choose (batch.js restarted at 0%) is a start: [${r.kind}]`);
    // Not a start (the controller chose 0% itself): the priced dwell must still let it go.
    const own = call({ ...C.ctlNew(ef.lastAugReset, 12), switches: [{ at: now - 5 * 60e3, from: 0.1, to: 0, kind: "exploit" }], s0: 0, s0Since: now - segP.ageMin * 60e3 });
    c.note(`chosen by the controller itself: [${own.kind}] ${Math.round(own.frac * 100)}% — dwell ${JSON.stringify(own.dwell)}`);
    if (own.kind !== "exploit" || !(Math.abs(own.frac - C.SPLIT.stepMax) < 1e-9)) c.fail(`a dwell priced at more than the measurement is worth must give way to the step: [${own.kind}] ${own.frac}`);
    if (!own.dwell?.overridden) c.fail("the override must be published (control.dwell.overridden)");
    // The wait published is the real one: 2 buckets to go, not maxDwell - age (41.1 min), and no damping on a fresh process.
    if (!(own.dwell?.waitMin <= C.SPLIT.dwellMs / 6e4)) c.fail(`the published wait must be the buckets or the dwell left, not maxDwell - age: ${own.dwell?.waitMin ?? `unpublished (dwellLeftMin ${own.dwellLeftMin})`} min`);
    if (own.oscillating || r.oscillating) c.fail("a restart is not a reversal: oscillating must stay false");
    checks.push(c);
  }

  return checks;
}
