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
  const c3 = new Check("BY3", "structural error: the (Student-t) posterior learns s, and the sequential calibration covers ~80% when the model is right");
  {
    c3.examined(4);
    const rand = B.rngOf(23);
    const t0 = Date.parse("2026-09-26T00:00:00Z");
    const mk = (s, n) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const truth = 100 - i * 0.25;
        // The model's own error: Student-t (nu 4) with scale s — a normal over
        // a Gamma(2, 2) mixture weight.
        const lam = B.gammaOf(2, rand) / 2;
        out.push({ at: new Date(t0 + i * 0.25 * 3.6e6).toISOString(), exitH: truth * Math.exp((s * B.normalOf(rand)) / Math.sqrt(lam)), life: 1, ver: "v1", boot: 1 });
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
    // CRN ACROSS PASSES: the same seed gives the same draws, and a posterior
    // appearing (the rep rate's) does not shift any other component's z.
    const again = P.makeDraws(post, 400, 1);
    const withRep = P.makeDraws({ ...post, rep: B.logRatePosterior([{ at: "2026-09-26T00:00:00Z", v: 10 }]) }, 400, 1);
    if (!again.every((d, i) => d.r === dA[i].r && d.s2 === dA[i].s2 && d.zc === dA[i].zc)) c4.fail("draws must be reproducible from the seed (CRN across passes of a life)");
    if (!withRep.every((d, i) => d.r === dA[i].r && d.s2 === dA[i].s2)) c4.fail("a new posterior must not shift the other components' draws");
    c4.examined(2);
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
    let r4 = null;
    try {
      r4 = P.decide({ samples: gone, committed: "A" });
    } catch (e) {
      r4 = { choice: null, why: `threw: ${e}` };
    }
    if (r4.choice !== "B") c5.fail("a committed option infeasible in most draws is released", r4.why);
    // Skewed evidence: the alternative wins 90% of draws by 0.1h and loses
    // 10% by 10h — probable but not expected to be better: stay.
    const skew = { A: Array.from({ length: N }, () => 100), B: Array.from({ length: N }, (_, i) => (i % 10 === 0 ? 110 : 99.8)) };
    const r7 = P.decide({ samples: skew, committed: "A" });
    if (r7.choice !== "A") c5.fail("an alternative better in 90% of draws but worse in expectation must not be taken", r7.why);
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

  // -----------------------------------------------------------------------
  const c6 = new Check("BY6", "REPLAY: the count route over recorded BN8 passes (2026-09-26) and the 12:12->12:17 Syndicate->SmartJaw flip — argmin vs interim hysteresis vs the plan");
  {
    const X = await import("../../exitplan.js");
    const C = await import("../../countexit.js");
    const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn8-1232.json"), "utf8"));
    const rows = fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn8-stockhist.txt"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const count = { short: 1, ladder: [], nfg: F.nfg };
    // Live work routes carry no join/grind split: the whole detour is the
    // grind (scales with the rep rate), stated.
    const split = (r) => ({ ...r, laterPrice: r.price, joinH: r.via === "work" ? 0 : r.detourH, grindH: r.via === "work" ? r.detourH : 0 });
    const key = P.routeKey;
    const passes = F.passes ?? [];
    c6.examined(passes.length + 2);
    if (passes.length < 4) c6.fail(`the fixture must carry at least 4 recorded passes (has ${passes.length})`);
    // (1) RECORDED PASSES. Each pass: its recorded exit inputs and its
    // recorded top routes. A rule's committed route, when it drops out of a
    // pass's top list, is carried at its last recorded detour less the time
    // spent working it (sunk progress).
    const rules = {
      argmin: { committed: null, switches: 0, choices: [], regret: [] },
      interim: { committed: null, switches: 0, choices: [], regret: [] },
      plan: { committed: null, prev: null, switches: 0, choices: [], regret: [] },
    };
    const lastSeen = new Map();
    const obs = [];
    const points = [];
    let prevAt = null;
    for (const p of passes) {
      const dtH = prevAt ? (Date.parse(p.at) - Date.parse(prevAt)) / 3.6e6 : 0;
      prevAt = p.at;
      const routes = (p.routes ?? []).map(split);
      for (const r of routes) lastSeen.set(key(r), { r, at: p.at });
      for (const rule of Object.values(rules)) {
        const k = rule.committed;
        if (k && !routes.some((r) => key(r) === k) && lastSeen.has(k)) {
          const s = lastSeen.get(k);
          const done = (Date.parse(p.at) - Date.parse(s.at)) / 3.6e6;
          const d = Math.max(0, s.r.detourH - done);
          routes.push({ ...s.r, detourH: d, grindH: s.r.grindH > 0 ? d : 0, joinH: s.r.grindH > 0 ? 0 : d });
        }
      }
      const point = C.bestCountRoute(X.bestExitPolicy, p.inputs, count, routes);
      const hOf = (k) => point.tried.find((t) => key(t) === k)?.hours ?? null;
      const best = point.best ? key(point.best.route) : null;
      const minH = point.best?.hours ?? null;
      const take = (rule, k) => {
        if (rule.committed && k !== rule.committed) rule.switches++;
        rule.committed = k;
        rule.choices.push(k ? k.split("|").slice(0, 2).join("@") : null);
        const h = hOf(k);
        if (typeof h === "number" && typeof minH === "number") rule.regret.push(h - minH);
      };
      take(rules.argmin, best);
      const cm = C.commitRoute(point, routes, rules.interim.committed ? Object.fromEntries(["name", "faction", "via"].map((f, i) => [f, rules.interim.committed.split("|")[i]])) : null, { tolPerH: F.waitTolPerH ?? 12.26 });
      take(rules.interim, cm.best ? key(cm.best.route) : null);
      obs.push({ at: p.at, v: p.inputs.repPerSec });
      points.push({ at: p.at, life: F.lastAugReset, h: Object.fromEntries(point.tried.filter((t) => t.hours !== null).slice(0, 8).map((t) => [key(t), t.hours])) });
      const post = P.posteriorsOf({ stockRows: rows, warmupH: p.inputs.capitalWarmupH ?? 0.15, exitSamples: F.exitSamples, obs: { rep: obs }, optionPoints: points });
      const draws = P.makeDraws(post, P.PLAN.N, P.seedOf(F.lastAugReset, 8));
      const d = P.decideRoute({ inputs: p.inputs, count, routes, point, repPoint: p.inputs.repPerSec, prev: rules.plan.prev, draws, redecide: true, budgetMs: 1e9 });
      rules.plan.prev = d;
      take(rules.plan, d.key);
      if (rules.plan.choices.length === passes.length) c6.note(`last pass: ${d.why}`);
    }
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    for (const [name, r] of Object.entries(rules)) c6.note(`${name.padEnd(8)} switches ${r.switches}, mean point regret ${mean(r.regret)?.toFixed(2)}h: ${r.choices.join(" -> ")}`);
    const recorded = passes.map((p) => p.chosen?.split("|").slice(0, 2).join("@"));
    c6.note(`recorded live (interim) choices: ${recorded.join(" -> ")}`);
    if (rules.plan.switches > rules.argmin.switches) c6.fail("the plan must not switch more often than the argmin");
    if (!(mean(rules.plan.regret) <= mean(rules.interim.regret) + 1e-9)) c6.fail("the plan must not hold a worse route than the interim hysteresis on the recorded passes");

    // (2) 12:12 -> 12:17: The Syndicate committed (strength trained, 0.95h of
    // detour left); on the next pass an alternative (SmartJaw at Bachman)
    // prices 3h sooner — inside the measured forecast error — then 20h sooner.
    const inputs = F.inputs;
    const syn = { name: "The Shadow's Simulacrum", faction: "The Syndicate", via: "work", price: 4e8, laterPrice: 4e8, detourH: 0.95, joinH: 0.45, grindH: 0.5, hacking: 1, exp: 1, rep: 1.15 };
    const hS = C.routeExitFixed(X.bestExitPolicy, inputs, count, syn);
    // SmartJaw (x1.1 hacking, bought by donation) with its detour set so its
    // point exit is `gap` hours sooner than the committed route's (bisection).
    const jawAt = (gap) => {
      const mk = (dH) => ({ name: "SmartJaw", faction: "Bachman & Associates", via: "donation", price: 1e8, laterPrice: 1e8, detourH: dH, joinH: dH, grindH: 0, hacking: 1.1, exp: 1, rep: 1.25 });
      let lo = 0, hi = 40;
      for (let i = 0; i < 50; i++) {
        const m = (lo + hi) / 2;
        const h = C.routeExitFixed(X.bestExitPolicy, inputs, count, mk(m));
        if (h !== null && h < hS - gap) lo = m;
        else hi = m;
      }
      return mk(lo);
    };
    // The option-specific error measured from the RECORDED passes' own top-8 rankings.
    const recPoints = passes.map((p) => ({ at: p.at, life: F.lastAugReset, h: Object.fromEntries((p.routes ?? []).filter((r) => r.hours !== null).map((r) => [key(r), r.hours])) }));
    const post = P.posteriorsOf({ stockRows: rows, warmupH: 0.15, exitSamples: F.exitSamples, obs: { rep: [{ at: F.gateAt, v: 13.04 }] }, optionPoints: recPoints });
    c6.note(`posteriors: trader ${(post.trader.perHour.mean * 100).toFixed(0)}%/h ± ${(post.trader.perHour.sd * 100).toFixed(0)}; exit forecast error ${(100 * post.drift.s).toFixed(1)}% (${post.drift.pairs} pairs); option-specific ${(100 * post.jitter.si).toFixed(2)}% (${post.jitter.n} pairs)`);
    const draws = P.makeDraws(post, P.PLAN.N, 99);
    const prev = { key: key(syn) };
    for (const gap of [0.5, 1, 3, 5]) {
      const jaw = jawAt(gap);
      const hJ = C.routeExitFixed(X.bestExitPolicy, inputs, count, jaw);
      const routes = [syn, jaw];
      const point = C.bestCountRoute(X.bestExitPolicy, inputs, count, routes);
      const old = point.best?.name;
      const d = P.decideRoute({ inputs, count, routes, point, repPoint: 13.04, prev, draws, redecide: true, budgetMs: 1e9 });
      c6.note(`12:17 with SmartJaw ${gap}h sooner (point ${hS.toFixed(2)}h vs ${hJ.toFixed(2)}h): argmin -> ${old}; plan -> ${d.name} (${d.why})`);
      if (old !== "SmartJaw") c6.fail(`fixture: the argmin must flip to SmartJaw at a ${gap}h gap`);
      if (gap <= 0.5 && d.name !== syn.name) c6.fail(`a ${gap}h point advantage (the live near-ties were 0.01-0.06h) must not move the committed route`);
      if (gap >= 3 && d.name !== "SmartJaw") c6.fail(`a ${gap}h advantage with the ranking stable to ~1% between passes is clear evidence: the plan must switch`);
    }
  }
  checks.push(c6);

  // -----------------------------------------------------------------------
  const c7 = new Check("BY7", "CPU: a full re-decision (route + install, N draws) fits the per-pass budget on the live fixture, and the budget stops a slow Monte Carlo with every option at the same N");
  {
    c7.examined(3);
    const X = await import("../../exitplan.js");
    const C = await import("../../countexit.js");
    const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn8-1232.json"), "utf8"));
    const rows = fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn8-stockhist.txt"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const count = { short: 1, ladder: [{ name: "CRTX42-AA Gene Modification", price: 2.25e8, laterPrice: 2.25e8, hacking: 1.08, exp: 1.15 }], nfg: F.nfg };
    const routes = F.routes.map((r) => ({ ...r, laterPrice: r.price, joinH: r.via === "work" ? 0 : r.detourH, grindH: r.via === "work" ? r.detourH : 0 }));
    const t0 = performance.now();
    const post = P.posteriorsOf({ stockRows: rows, warmupH: 0.15, exitSamples: F.exitSamples, obs: { rep: [{ at: F.gateAt, v: 13.04 }] } });
    const draws = P.makeDraws(post, P.PLAN.N, 7);
    const point = C.bestCountRoute(X.bestExitPolicy, F.inputs, count, routes);
    const dr = P.decideRoute({ inputs: F.inputs, count, routes, point, repPoint: 13.04, draws, budgetMs: P.PLAN.budgetMs });
    const nowC = C.bestCountExit(X.bestExitPolicy, F.inputs, count, { firstInstallH: 0 });
    const waits = [0.25, 0.5, 1, 2, 4].map((w) => {
      const r = C.bestCountExit(X.bestExitPolicy, F.inputs, count, { firstInstallH: w });
      return { waitH: w, hours: r.best?.hours ?? null, n: r.best?.n ?? null, lifeH: r.best?.lifeH ?? null };
    });
    const mcStart = performance.now();
    const di = P.decideInstall({ inputs: F.inputs, count, point: { now: { hours: nowC.best.hours, n: nowC.best.n, lifeH: nowC.best.lifeH }, waits }, repPoint: 13.04, draws, budgetMs: P.PLAN.budgetMs });
    const ms = performance.now() - t0;
    c7.note(`one full pass in node: ${ms.toFixed(0)}ms (route MC ${dr.ms}ms over ${dr.n} draws, install MC ${di.ms}ms over ${di.n}); budget ${P.PLAN.budgetMs}ms for the Monte Carlo on the game's main thread`);
    c7.note(`exit: ${di.key} mean ${di.meanH}h, 80% ${di.q10}-${di.q90}h; route ${dr.name} mean ${dr.meanH}h`);
    // The browser runs this 2-3x slower than node: the node figure must leave that headroom.
    if (!(dr.ms + di.ms < P.PLAN.budgetMs / 3)) c7.fail(`the Monte Carlo took ${dr.ms + di.ms}ms in node: no 3x headroom under the ${P.PLAN.budgetMs}ms budget`);
    if (dr.overBudget || di.overBudget) c7.fail("the fixture pass must not hit the budget");
    // A slow simulator: the budget stops it, every option at the same N, flagged.
    const slow = (d) => {
      const e = performance.now() + 15;
      while (performance.now() < e);
      return 50 + d.i;
    };
    const ev = P.evaluate([{ key: "a", sim: slow }, { key: "b", sim: slow }], P.makeDraws(post, 24, 1), { budgetMs: 60 });
    c7.note(`slow simulator (15ms/eval), 60ms budget: stopped at N=${ev.n} in ${ev.ms}ms, overBudget ${ev.overBudget}`);
    if (!(ev.overBudget && ev.n < 24 && ev.samples.a.length === ev.samples.b.length)) c7.fail("the budget must stop the Monte Carlo draw-major and say so");
  }
  checks.push(c7);

  // -----------------------------------------------------------------------
  const c8 = new Check("BY8", "wiring: the count route, the install gate and the published exit read the ONE committed plan; the plan is published on both exit paths, traced and metered");
  {
    c8.examined(9);
    const IG = await import("../../installgate.js");
    const H = 3600e3;
    const base = { ageMs: 2 * H, M: 1.01, queued: 1, exp: 1e9, prev: null, futures: [], countShort: 1, countGain: 1, countTiming: { installNow: true, why: "x" }, capitalNode: true };
    const ex = { countAware: true, nowH: 70, neverH: null, waits: [{ waitMs: 4 * H, H: 60 }], waitTolPerH: 0.5 };
    // The point comparison alone would hold (10h saving beats 0.5h/h x 4h).
    const alone = IG.shouldInstall({ ...base, exitCompare: ex });
    const planInstall = IG.shouldInstall({ ...base, exitCompare: { ...ex, bayes: { install: true, key: "now", waitMs: 0, H: 70.2, q10: 60, q50: 70, q90: 82, why: "stays on now" } } });
    const planHold = IG.shouldInstall({ ...base, exitCompare: { ...ex, waits: [], bayes: { install: false, key: "w2", waitMs: 2 * H, H: 69, q10: 60, q50: 69, q90: 80, why: "switch" } } });
    c8.note(`point comparison alone: install ${alone.install}; plan says now: install ${planInstall.install}; plan says wait 2h: install ${planHold.install} (${planHold.why.slice(0, 90)})`);
    if (alone.install !== false) c8.fail("fixture: the point comparison alone should hold");
    if (planInstall.install !== true || planInstall.planDecision?.key !== "now") c8.fail("installgate must obey the plan's install-now decision (and publish it)");
    if (planHold.install !== false) c8.fail("installgate must obey the plan's hold even when no point wait beats now");
    if (planHold.exitBestWaitH !== 69) c8.fail("the gate must publish the plan's chosen wait and its expected exit", String(planHold.exitBestWaitH));
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    const need = [
      [/from 'plan\.js'/, "progress.js imports plan.js"],
      [/await planDecide\(pc, 'countRoute', \(\) => decideRouteGen\(\{ inputs: rec\.inputs, count: cc, routes, point: ranked, repPoint: repPerSec, prev: pc\.prev\?\.decisions\?\.countRoute/, "the count route is decided by the plan against its committed choice"],
      [/const cm = bayRoute\s*\n?\s*\?/, "the schedule's route (countRoute.best) is the plan's choice, the interim rule only its fallback"],
      [/bayes: await planInstallOf\(ns, info, inputs, countCtx,/, "the count-aware exit comparison carries the plan's install decision"],
      [/const bayes = now\.best \? await planInstallOf\(ns, info, inputs, null,[^\n]*\n[\s\S]*?bayes,\n/, "the ordinary exit comparison carries the plan's install decision"],
      [/const b = exitCompare\?\.bayes\s*\n\s*if \(b && typeof b\.q50 === 'number'\) return \{ exitH: b\.q50/, "the published exit is the plan's median"],
      [/enter\(`plan-\$\{name\}`\)[\s\S]{0,200}d = await pc\.pacer\.slices\(genFn\(\), `plan-\$\{name\}`\)[\s\S]{0,200}leave\(`plan-\$\{name\}`\)/, "each Monte Carlo is bracketed by trace.js and run in the pacer's slices"],
      [/const ranked = await paced\(bestCountRouteGen\(/, "the count-route scan runs in slices"],
      [/const nowC = await paced\(bestCountExitGen\(/, "the count-aware exit scan runs in slices"],
    ];
    for (const [re, what] of need) if (!re.test(prog)) c8.fail(`${what} (source guard)`);
    const pubs = (prog.match(/publishPlan\(ns, info, planExtrasOf\(scheduleTarget, bodyStep, countRoute\)\)/g) ?? []).length;
    if (pubs !== 4) c8.fail(`the plan must be published on every path that orders: both install paths, the unplanned Covenant path and the ordinary end of the pass (found ${pubs} of 4)`);
  }
  checks.push(c8);

  // -----------------------------------------------------------------------
  const c9 = new Check("BY9", "healthcheck F reads the plan: missing / stale / broken / over budget / miscalibrated each FAIL loud; a sound plan passes with its interval and calibration noted");
  {
    c9.examined(11);
    const now = Date.parse("2026-09-26T13:00:00Z");
    const at = new Date(now - 5 * 60e3).toISOString();
    const good = { at, lastAugReset: 1, health: "ok", cpu: { cpuMs: 900, wallMs: 1400, waitMs: 20, maxBlockMs: 41.2, maxBlockLimitMs: 50, yields: 22, budgetMs: 1200, blocked: false, truncated: false, N: 24, draws: 24 }, calibration: { n: 20, cover80: 0.8, why: "20 sequential one-step predictions" }, exit: { meanH: 64, q10: 57, q50: 63, q90: 71, source: "install decision (now)" }, decisions: {} };
    const prog = { at };
    const gate = { at, lastAugReset: 1 };
    const chk = (plan, what) => P.planCheck(plan, { gate, progress: prog, now }).fails.some((f) => f.what.startsWith(what));
    const ok = P.planCheck(good, { gate, progress: prog, now });
    c9.note(`sound plan: ${ok.fails.length} fails; notes: ${ok.notes.join(" | ")}`);
    if (ok.fails.length) c9.fail("a sound plan must pass", JSON.stringify(ok.fails));
    if (!chk(null, "PLAN MISSING")) c9.fail("no plan while progress.js runs must fail");
    if (!chk({ ...good, at: new Date(now - 90 * 60e3).toISOString() }, "PLAN STALE")) c9.fail("a 90-min-old plan must fail");
    if (!chk({ ...good, health: "error", error: "route decision threw" }, "PLAN BROKEN")) c9.fail("a plan that recorded an error must fail");
    // The page-freeze metric is the longest block, not the total: 900ms of
    // work in 41ms slices passes; one 120ms block fails.
    if (!chk({ ...good, cpu: { ...good.cpu, maxBlockMs: 120, blocked: true } }, "PLAN BLOCKED THE PAGE")) c9.fail("a 120ms synchronous block must fail");
    const named = P.planCheck({ ...good, cpu: { ...good.cpu, maxBlockMs: 150, blocked: true, sections: { "plan-grafts": { maxStepMs: 148, maxStepAt: 1, steps: 90 }, "plan-install": { maxStepMs: 6, maxStepAt: 3, steps: 200 } } } }, { gate, progress: prog, now }).fails.find((f) => f.what.startsWith("PLAN BLOCKED"));
    c9.note(`attributed: ${named?.what}`);
    if (!/'plan-grafts' \(step 1 of 90\)/.test(named?.what ?? "")) c9.fail("the blocked-page failure must name the section and step that held the page");
    if (chk({ ...good, cpu: { ...good.cpu, cpuMs: 5000 } }, "PLAN")) c9.fail("a large total in short slices is not a page freeze");
    if (!chk({ ...good, cpu: { ...good.cpu, draws: 4, truncated: true } }, "PLAN UNDER-SAMPLED")) c9.fail("4 of 24 draws must fail as under-sampled");
    if (!chk({ ...good, cpu: { ms: 900, budgetMs: 400, overBudget: true } }, "PLAN OVER CPU BUDGET")) c9.fail("a pre-slicing record over its total budget still fails");
    if (!chk({ ...good, calibration: { n: 20, cover80: 0.4, why: "x" } }, "PLAN MISCALIBRATED")) c9.fail("40% coverage of an 80% interval must fail");
    if (!chk({ ...good, calibration: { n: 20, cover80: 1.0, why: "x" } }, "PLAN MISCALIBRATED")) c9.fail("100% coverage of an 80% interval (underconfident) must fail");
    if (chk({ ...good, calibration: { n: 5, cover80: 0.2, why: "x" } }, "PLAN MISCALIBRATED")) c9.fail("five pairs are too few to call miscalibration");
    const hc = fs.readFileSync(path.join(REPO_ROOT, "tools/healthcheck.mjs"), "utf8");
    if (!/planCheck\(readTel\("plan\.txt"\), \{ gate, progress: prog, now: Date\.now\(\) \}\)/.test(hc)) c9.fail("healthcheck section F must run planCheck on /tel/plan.txt");
  }
  checks.push(c9);

  // -----------------------------------------------------------------------
  const c10 = new Check("BY10", "sleeves and spends read the plan's rule: the sleeve objective is committed on the shared draws; a purchase needs its saving to beat the measured option-specific error");
  {
    c10.examined(6);
    const si = 0.009; // measured live 2026-09-26 (BY6)
    const tie = P.decideSpend({ deltaH: -0.01, withoutH: 70, si });
    const clear = P.decideSpend({ deltaH: -3, withoutH: 70, si });
    const worse = P.decideSpend({ deltaH: 0.5, withoutH: 70, si });
    c10.note(`spend -0.01h: ${tie.why}`);
    c10.note(`spend -3h: ${clear.why}`);
    if (tie.buy) c10.fail("a 0.01h saving on a 70h exit is a tie: hold");
    if (!clear.buy) c10.fail("a 3h saving against a ~0.9h option error: buy");
    if (worse.buy) c10.fail("a purchase that lengthens the exit is never bought");
    if (P.decideSpend({ deltaH: null, withoutH: 70, si }) !== null) c10.fail("an unpriced verdict is null (the caller's fallback), not a hold");
    // decideAmong keeps the incumbent objective on a tie.
    const post = P.posteriorsOf({ exitSamples: [] });
    const draws = P.makeDraws(post, 24, 3);
    const opts = [{ key: "rep", sim: () => 60 }, { key: "exp", sim: () => 59.95 }];
    const kept = P.decideAmong({ options: opts, prev: { key: "rep" }, draws });
    c10.note(`sleeve objective, exp 0.05h better: ${kept.why}`);
    if (kept.key !== "rep") c10.fail("the committed sleeve objective must survive a 0.05h tie");
    // No event: the committed objective is held and only it is evaluated
    // (even against a far better alternative — re-deciding waits for an event).
    let calls = 0;
    const held = P.decideAmong({ options: [{ key: "rep", sim: () => (calls++, 60) }, { key: "exp", sim: () => (calls++, 40) }], prev: { key: "rep", decidedAt: "2026-09-26T12:00:00Z", why: "x" }, draws, redecide: false });
    if (!(held.key === "rep" && held.held === true && calls === draws.length)) c10.fail("without an event the committed choice is held and only it is priced", JSON.stringify({ key: held.key, held: held.held, calls }));
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    if (!/const pd = decideSpend\(\{ deltaH: r\.deltaH, withoutH: r\.withoutH/.test(prog) || !/buy: pd \? pd\.buy : r\.deltaH < 0/.test(prog)) c10.fail("every spend verdict must pass through plan.decideSpend (source guard)");
  }
  checks.push(c10);

  // -----------------------------------------------------------------------
  const c11 = new Check("BY11", "YIELDING: a live-size pass (232 count routes, the install scans, the route + install Monte Carlo, the graft search on the 14:47 live inputs) never holds the page for more than 50ms in node, and slicing changes no result");
  {
    c11.examined(5);
    const X = await import("../../exitplan.js");
    const C = await import("../../countexit.js");
    const GP = await import("../../graftplan.js");
    const CO = await import("../../coop.js");
    const FV = await import("../../favor.js");
    const { bitNodeMults } = await import("../../bitNodeMultipliers.js");
    const BP = await import("../../bodyplan.js");
    const Fx = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn8-1128.json"), "utf8"));
    const G = await import("./fixture-bn8-graft.mjs");
    const rows = fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn8-stockhist.txt"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    // The 11:28 routes (50, as B8s builds them), replicated under distinct
    // faction names to the live pass's 232, each replica's detour moved by a
    // few seconds so exitplan's memo cannot answer it for free — the same
    // per-route cost as a distinct route.
    const owned = new Set(Fx.owned);
    const SK = ["strength", "defense", "dexterity", "agility"];
    const person = { skills: { ...Fx.skills }, exp: { ...Fx.exp }, city: Fx.city, money: 1e9, mults: Object.fromEntries([...SK, "charisma", "hacking"].flatMap((s) => [[s, 1], [`${s}_exp`, 1]])) };
    const gymH = (to) => BP.gymLegs(Object.fromEntries(SK.map((s) => [s, to])), person, 1).hours;
    const toAug = (a) => ({ name: a.name, baseCost: a.price, repReq: a.repReq, mults: a.mults, prereqs: a.prereqs ?? [] });
    const offers = Fx.joined.filter((f) => Fx.factions[f]).flatMap((f) => Fx.factions[f].augs.map((a) => ({ ...toAug(a), faction: f, factionRep: Fx.factions[f].rep, favor: Fx.factions[f].favor })));
    const candidates = ["Slum Snakes", "Tetrads"].map((f, i) => ({ name: f, joinH: gymH(i ? 75 : 30), rep: 0, favor: Fx.factions[f].favor, augs: Fx.factions[f].augs.map(toAug) }));
    const base50 = C.countRoutes({ offers, candidates, owned, repPerSec: 4 / 1.5, donation: (f, rep) => FV.donationForRep(rep, 1, bitNodeMults(8).FactionWorkRepGain) });
    const routes = [];
    for (let k = 0; routes.length < 232; k++) for (const r of base50) if (routes.length < 232) routes.push({ ...r, faction: `${r.faction}#${k}`, detourH: r.detourH + k * 0.001, joinH: (r.joinH ?? 0) + k * 0.001 });
    const inputs = Fx.exitInputs.inputs;
    const nfgA = Fx.factions["Slum Snakes"].augs.find((a) => a.name === "NeuroFlux Governor");
    const count = { short: 1, ladder: [], nfg: { price: nfgA.price, level: 0 } };
    // The install scans price the count gate's ladder (the cheapest ticket, as BY7).
    const countI = { short: 1, ladder: [{ name: "CRTX42-AA Gene Modification", price: 2.25e8, laterPrice: 2.25e8, hacking: 1.08, exp: 1.15 }], nfg: count.nfg };
    const post = P.posteriorsOf({ stockRows: rows, warmupH: 0.15, exitSamples: JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn8-1232.json"), "utf8")).exitSamples });
    const draws = P.makeDraws(post, P.PLAN.N, 5);
    const priceExit = (x) => {
      const r = X.bestExitPolicy(x);
      return r.degenerate ? null : r.best?.hours ?? null;
    };
    // The pass, as progress.js runs it: every step a generator.
    function* pass(clock, graftBudgetMs, mcBudgetMs) {
      const ranked = yield* C.bestCountRouteGen(X.bestExitPolicy, inputs, count, routes);
      const route = yield* P.decideRouteGen({ inputs, count, routes, point: ranked, repPoint: 4 / 1.5, draws, budgetMs: mcBudgetMs, clock, now: 0 });
      const nowC = yield* C.bestCountExitGen(X.bestExitPolicy, inputs, countI, { firstInstallH: 0 });
      const waits = [];
      for (const w of [0.25, 0.5, 1, 2, 4]) {
        const r = yield* C.bestCountExitGen(X.bestExitPolicy, inputs, countI, { firstInstallH: w });
        waits.push({ waitH: w, hours: r.best?.hours ?? null, n: r.best?.n ?? null, lifeH: r.best?.lifeH ?? null });
      }
      const install = yield* P.decideInstallGen({ inputs, count: countI, point: { now: { hours: nowC.best?.hours ?? null, n: nowC.best?.n, lifeH: nowC.best?.lifeH ?? null }, waits }, repPoint: 4 / 1.5, draws, budgetMs: mcBudgetMs, clock, now: 0 });
      const grafts = yield* GP.chooseGraftsGen({ candidates: G.CANDIDATES, priceExit, base: G.INPUTS, intelligence: G.INTELLIGENCE, ownedNames: G.OWNED, budgetMs: graftBudgetMs, now: clock, maxGrafts: graftBudgetMs === Infinity ? 2 : 12 });
      return { ranked: ranked.tried.length, routeKey: route.key, routeStats: [route.meanH, route.q10, route.q90, route.pBest], install: [install.key, install.meanH, install.q10, install.q90], grafts: (grafts.grafts ?? []).map((g) => g.name), graftH: grafts.withH };
    }
    // (1) Identical results: drained synchronously vs sliced (no budgets bind).
    const sync = CO.drain(pass(() => 0, Infinity, Infinity));
    const pacer0 = CO.makePacer({ sliceMs: P.PLAN.sliceMs, yieldFn: () => new Promise((r) => setImmediate(r)) });
    const sliced = await pacer0.slices(pass(pacer0.cpuNow, Infinity, Infinity));
    if (sync.install[0] === null || sync.routeKey === null) c11.fail("fixture: the install and route decisions must price", JSON.stringify(sync));
    if (JSON.stringify(sync) !== JSON.stringify(sliced)) c11.fail("slicing must not change any result (CRN, same work order)", `${JSON.stringify(sync)}\nvs\n${JSON.stringify(sliced)}`);
    else c11.note(`sync == sliced: route ${sync.routeKey.split("|").slice(0, 2).join(" @ ")}, install ${sync.install[0]} (mean ${sync.install[1]}h), grafts [${sync.grafts.join(", ")}] (${sync.ranked} routes ranked)`);
    // (2) The live budgets: the longest synchronous block, work vs wall.
    const pacer = CO.makePacer({ sliceMs: P.PLAN.sliceMs, yieldFn: () => new Promise((r) => setImmediate(r)) });
    const w0 = performance.now();
    await pacer.slices(pass(pacer.cpuNow, 250, P.PLAN.budgetMs), "live-pass");
    const sec = pacer.stats.sections["live-pass"];
    c11.note(`section 'live-pass': ${sec?.steps} steps, longest step ${sec?.maxStepMs?.toFixed(1)}ms (step ${sec?.maxStepAt}), longest block ${sec?.maxBlockMs?.toFixed(1)}ms`);
    if (!(sec && sec.steps > 100 && sec.maxStepMs > 0 && sec.maxStepMs < P.PLAN.maxBlockMs && Math.abs(sec.cpuMs - pacer.stats.cpuMs) < 1)) c11.fail("the pacer must attribute work, steps and the longest step to the section that ran them");
    const wall = performance.now() - w0;
    const st = pacer.stats;
    c11.note(`live-size pass in node: ${st.cpuMs.toFixed(0)}ms work over ${wall.toFixed(0)}ms wall, ${st.yields} yields, longest block ${st.maxBlockMs.toFixed(1)}ms (limit ${P.PLAN.maxBlockMs}ms, slice ${P.PLAN.sliceMs}ms)`);
    if (!(st.maxBlockMs <= P.PLAN.maxBlockMs)) c11.fail(`a ${st.maxBlockMs.toFixed(1)}ms synchronous block exceeds ${P.PLAN.maxBlockMs}ms`);
    if (!(st.yields >= Math.floor(st.cpuMs / (P.PLAN.maxBlockMs + 10)))) c11.fail("the pacer must yield about once per slice of work");
    // (3) Unsliced, the same pass is one block — the check can see the fault.
    const t0 = performance.now();
    CO.drain(pass(() => performance.now() - t0, 250, P.PLAN.budgetMs));
    const whole = performance.now() - t0;
    c11.note(`the same pass drained without yielding: one ${whole.toFixed(0)}ms block`);
    if (!(whole > P.PLAN.maxBlockMs)) c11.fail("fixture: the unsliced pass should exceed the block limit (else this check proves nothing)");
    // (4) The work clock excludes the pauses: a slow yield does not truncate a budgeted search.
    const slowPacer = CO.makePacer({ sliceMs: 5, yieldFn: () => new Promise((r) => setTimeout(r, 30)) });
    let seen = 0;
    const counted = await slowPacer.slices((function* () {
      const t = slowPacer.cpuNow();
      for (let i = 0; i < 40; i++) {
        const e = performance.now() + 1;
        while (performance.now() < e);
        seen++;
        if (slowPacer.cpuNow() - t > 150) break; // a budget in WORK ms: ~40ms of work, ~300ms of wall
        yield;
      }
      return seen;
    })());
    c11.note(`work clock: 40 x 1ms of work across ${slowPacer.stats.yields} 30ms pauses read ${slowPacer.stats.cpuMs.toFixed(0)}ms of work, ${slowPacer.stats.waitMs.toFixed(0)}ms waiting`);
    if (!(counted === 40 && slowPacer.stats.cpuMs < 200 && slowPacer.stats.waitMs > 100)) c11.fail("the pacer's work clock must exclude the time spent yielded");
  }
  checks.push(c11);

  // -----------------------------------------------------------------------
  const c12 = new Check("BY12", "ONE TRAJECTORY: the graft decision prices on the committed install's trajectory, so the two decisions' committed exits agree (live 17:51 they read 23.0h and 84.9h); and a trajectory with no further install cycles does not swing with the cadence draw");
  {
    c12.examined(6);
    const X = await import("../../exitplan.js");
    const GP = await import("../../graftplan.js");
    const G = await import("./fixture-bn8-graft.mjs");
    const rows = fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn8-stockhist.txt"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const post = P.posteriorsOf({ stockRows: rows, warmupH: 0.16, exitSamples: JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn8-1232.json"), "utf8")).exitSamples });
    // The live 17:51 ln(M)/h posterior: 0.0185 ± 0.0093 per hour, as a
    // cadence posterior (ln scale), the life length held at the inputs'.
    post.cadence = { rate: { mean: Math.log(0.0185), sd: 0.0093 / 0.0185 }, life: { mean: Math.log(G.INPUTS.cycleHours), sd: 0 } };
    const draws = P.makeDraws(post, P.PLAN.N, 17);
    const now = Date.parse(G.AT);
    const inputs = G.INPUTS;
    const specs = ["Embedded Netburner Module Core Implant", "Embedded Netburner Module Core V2 Upgrade", "Embedded Netburner Module Core V3 Upgrade", "Xanipher"].map((n) => GP.graftSpecOf(G.CANDIDATES.find((c) => c.name === n), G.INTELLIGENCE, { entropy: true }));
    const withG = (x) => ({ ...x, finalGrafts: specs, graftStartMoney: 9.375e10 });
    // The install options as progress.js builds them (no count gate): now,
    // waits with their batch's gains (a 4h batch lifting hacking x1.94, as
    // live), never.
    const g4 = { hacking: 1.94, rep: 1.02, income: 4.74, exp: 1.35 };
    const pointOf = (x) => ({
      now: { hours: X.bestExitPolicy({ ...x, firstInstallH: 0 }, 400, 1).best?.hours },
      waits: [{ waitH: 1, hours: X.bestExitPolicy({ ...x, firstInstallH: 1 }, 400, 1).best?.hours }, { waitH: 4, installGains: g4, hours: X.bestExitPolicy({ ...x, firstInstallH: 4, installGains: g4, nextInstallGain: g4.hacking }, 400, 1).best?.hours }],
      never: { hours: X.bestExitPolicy(x, 0, 0).best?.hours },
    });
    // Pass 1: the install decision (inputs without grafts yet).
    const inst1 = P.decideInstall({ inputs, point: pointOf(inputs), draws, now, budgetMs: 1e9 });
    // The graft decision, on inst1's trajectory (as graftDecisionOf).
    const basis = P.basisOf(inst1, now);
    const traj = P.trajectoryOf(basis, {});
    const gd = P.decideAmong({ options: [{ key: "none", noiseKey: P.noiseKeyOf(basis, inputs), sim: (d) => traj(P.applyDraw(inputs, d), d) }, { key: "grafts", noiseKey: P.noiseKeyOf(basis, withG(inputs)), sim: (d) => traj(P.applyDraw(withG(inputs), d), d) }], draws, budgetMs: 1e9 });
    const gdRec = { ...gd, basisNoiseKey: P.noiseKeyOf(basis, gd.key === "grafts" ? withG(inputs) : inputs) };
    // Pass 2: the install decision on inputs carrying the committed grafts, held.
    const carried = gd.key === "grafts" ? withG(inputs) : inputs;
    const inst2 = P.decideInstall({ inputs: carried, point: pointOf(carried), prev: inst1, draws, now, redecide: false, budgetMs: 1e9 });
    const cons = P.consistencyOf(inst2, gdRec, { si: post.jitter?.si ?? 0.02 });
    c12.note(`install ${inst1.key} (mean ${inst1.meanH}h); grafts '${gd.key}' on that basis: none ${gd.options.find((o) => o.key === "none")?.meanH}h, grafts ${gd.options.find((o) => o.key === "grafts")?.meanH}h; install held with the grafts: ${inst2.meanH}h — ${cons.why}`);
    if (cons.ok !== true) c12.fail("the committed install and graft decisions must agree on one basis", JSON.stringify(cons));
    // Same trajectory, same draws, same noise key: not merely within noise — identical.
    if (!(cons.diffH === 0)) c12.fail(`one trajectory priced by two decisions must draw the same noise (identical exits), got a ${cons.diffH}h difference`);
    // Negative control: the pre-fix graft pricing (the default policy, no
    // install batch) claimed against the same basis must read INCONSISTENT.
    const legacy = P.decideAmong({ options: [{ key: gd.key, noiseKey: gdRec.basisNoiseKey, sim: (d) => { const r = X.bestExitPolicy(P.applyDraw(carried, d)); return r.degenerate ? null : r.best?.hours ?? null; } }], draws, budgetMs: 1e9 });
    const bad = P.consistencyOf(inst2, { ...gdRec, meanH: legacy.meanH, samples: legacy.samples });
    c12.note(`the pre-fix basis (default policy): ${legacy.meanH}h against the install's ${inst2.meanH}h — ${bad.why}`);
    if (bad.ok !== false) c12.fail("fixture: the default-policy pricing must be caught as inconsistent (else the check proves nothing)");
    // MC mean vs point: the grafts option's point, mean and median; and with
    // the ln(M)/h posterior removed (point cadence), the mean falls to the point.
    const gOpt = gd.options.find((o) => o.key === "grafts");
    const gPoint = traj(withG(inputs));
    const noLn = P.makeDraws({ ...post, cadence: null }, P.PLAN.N, 17);
    const gd0 = P.decideAmong({ options: [{ key: "grafts", sim: (d) => traj(P.applyDraw(withG(inputs), d), d) }], draws: noLn, budgetMs: 1e9 });
    c12.note(`grafts option: point ${gPoint?.toFixed(1)}h, MC mean ${gOpt?.meanH}h / median ${gOpt?.q50}h / 80% ${gOpt?.q10}-${gOpt?.q90}h; without the cadence uncertainty: mean ${gd0.meanH}h / median ${gd0.q50}h / 80% ${gd0.q10}-${gd0.q90}h — the tails are draws of a slow or fast multiplier (the cadence rate is drawn lognormal around its median, so the MC median sits near the point)`);
    // (The cadence draw's reach into the interval is BY15's: this committed
    // trajectory installs its 4h batch and climbs, so the between-install
    // cadence barely moves it — the mean-vs-point gap here is the rest of the
    // posterior, and the cadence is no longer drawn on a linear scale that
    // put draws at ~0 ln(M)/h.)
    if (!(gOpt && Math.abs(gOpt.meanH - gd0.meanH) < 0.05 * gd0.meanH)) c12.fail("a trajectory with no further install cycles must not swing with the cadence draw");
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    if (!/const basis = basisOf\(pc\.prev\?\.decisions\?\.install \?\? null, Date\.now\(\)\)\s*\n\s*const traj = trajectoryOf\(basis,/.test(prog)) c12.fail("graftDecisionOf must price on the committed install's trajectory (source guard)");
    if (!/pcx\.consistency = consistencyOf\(pcx\.decisions\.install, pcx\.decisions\.grafts/.test(prog)) c12.fail("progress.js must check the install and graft decisions' consistency every pass (source guard)");
    if (!/const spec = basisOf\(inst, Date\.now\(\)\)[\s\S]{0,200}pcx\.graftReprice\(spec(, pcx\.installInputs \?\? null)?\)/.test(prog)) c12.fail("progress.js must re-price the graft decision when the install decision switched this pass (source guard)");
  }
  checks.push(c12);

  // -----------------------------------------------------------------------
  const c13 = new Check("BY13", "FORECAST ERROR IS ONE MODEL'S ERROR: pairs across a model version, a page reload or an install are excluded (and counted); the version is the planner's whole import graph; one mis-priced pass is down-weighted (Student-t) — replayed on the live 2026-09-27 sample history");
  {
    c13.examined(8);
    const t0 = Date.parse("2026-09-27T00:00:00Z");
    const at = (h) => new Date(t0 + h * 3.6e6).toISOString();
    // A forecast that is right (falls 1h/h, 3% noise) except that a deploy
    // every 5 samples re-prices it (x1.3 / x0.75 alternately, as ~15 deploys
    // a node do): version-tagged, the jumps are not forecast error.
    const rand = B.rngOf(3);
    const S = [];
    for (let i = 0; i < 40; i++) {
      const h = i * 0.25;
      const k = Math.floor(i / 5);
      S.push({ at: at(h), exitH: (60 - h) * (k % 2 ? 1.3 : 1) * Math.exp(0.03 * B.normalOf(rand)), life: 1, ver: `v${k}`, boot: 1 });
    }
    const tagged = B.driftPosterior(S);
    const blind = B.driftPosterior(S.map((x) => ({ ...x, ver: "same" })));
    c13.note(`7 deploys re-pricing x1.3/x0.77: version-blind s ${(100 * blind.s).toFixed(1)}% (${blind.pairs} pairs) vs version-aware ${(100 * tagged.s).toFixed(1)}% (${tagged.pairs} pairs, excluded ${JSON.stringify(tagged.excluded)})`);
    if (!(tagged.excluded.version === 7 && tagged.s < 0.06 && blind.s > 1.5 * tagged.s)) c13.fail("the pairs across the deploys must be excluded, leaving the model's own ~3% (and the version-blind fit must read more)");
    const reboot = B.driftPosterior(S.map((x, i) => ({ ...x, ver: "A", boot: i < 22 ? 1 : 2 })));
    if (reboot.excluded.boot !== 1) c13.fail("a pair across a page reload must be excluded");
    const legacy = B.driftPosterior(S.map(({ ver, boot, ...x }) => x));
    if (!(legacy.pairs === 0 && legacy.excluded.untagged === 39)) c13.fail("untagged pairs cannot be told apart from a deploy: excluded (and counted), never trusted");
    // The model version: every module in the planner's import graph.
    const read = (f) => {
      try {
        return fs.readFileSync(path.join(REPO_ROOT, f), "utf8");
      } catch {
        return "";
      }
    };
    const v0 = P.modelVersionFrom(read, "progress.js");
    const vMod = P.modelVersionFrom((f) => (f === "exitplan.js" ? read(f) + "\n// changed" : read(f)), "progress.js");
    const vDeep = P.modelVersionFrom((f) => (f === "coop.js" ? read(f) + "\n// changed" : read(f)), "progress.js");
    const vOut = P.modelVersionFrom((f) => (f === "go.js" ? read(f) + "\n// changed" : read(f)), "progress.js");
    c13.note(`model version ${v0} (modules in progress.js's import graph); exitplan edited -> ${vMod}; coop.js (imported by countexit/graftplan) edited -> ${vDeep}; go.js (not imported) edited -> ${vOut}`);
    if (!(Number(v0.split(".")[1]) > 20)) c13.fail("the version must cover the planner's whole import graph", v0);
    if (vMod === v0 || vDeep === v0) c13.fail("an edit to any module in the graph, however deep, must change the version");
    if (vOut !== v0) c13.fail("a module outside the graph must not change the version");
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    if (!/exitH: \+exitH\.toFixed\(2\), life: info\?\.lastAugReset \?\? null, source, ver: MODEL_VERSION, boot: PAGE_BOOT \}/.test(prog)) c13.fail("every exit sample must carry the model version and the page (source guard)");
    if (!/MODEL_VERSION = modelVersionOf\(ns\)/.test(prog) || !/PAGE_BOOT = pageBoot\(\)/.test(prog)) c13.fail("the version and the page must be taken at planner start (source guard)");
    // REPLAY on the live history (untagged; the commits of planner modules
    // are the known deploys — a lower bound).
    const L = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn8-exitcal-0927.json"), "utf8"));
    const dep = L.deploys.map(Date.parse);
    const byCommit = L.samples.map((x) => ({ ...x, ver: dep.filter((d) => d <= Date.parse(x.at)).length, boot: 1 }));
    const gauss = (() => {
      const pr = B.driftPairs(L.samples.map((x) => ({ ...x, ver: 0, boot: 1 })));
      const p = B.igUpdate(B.PRIORS.drift, pr.map((x) => x.r / Math.SQRT2));
      return Math.sqrt(p.b / (p.a - 1));
    })();
    const robustAll = B.driftPosterior(L.samples.map((x) => ({ ...x, ver: 0, boot: 1 })));
    const robustVer = B.driftPosterior(byCommit);
    const calOld = B.driftCalibration(L.samples.map((x) => ({ ...x, ver: 0, boot: 1 })), B.PRIORS.drift, 1e6);
    const calNew = B.driftCalibration(byCommit);
    const iv = (s, H) => `${(H * Math.exp(-1.2816 * s)).toFixed(1)}-${(H * Math.exp(1.2816 * s)).toFixed(1)}h`;
    const H = L.livePlan.exit.q50;
    c13.note(`live history (${L.samples.length} samples): Gaussian, all pairs (as live): s ${(100 * gauss).toFixed(1)}% -> structural 80% on the ${H}h median ${iv(gauss, H)} (live plan ${L.livePlan.exit.q10}-${L.livePlan.exit.q90}h)`);
    c13.note(`  Student-t, all pairs: s ${(100 * robustAll.s).toFixed(1)}% (${robustAll.outliers} outlier pair(s)) -> ${iv(robustAll.s, H)}; + excluding the ${robustVer.excluded.version} pair(s) across the ${L.deploys.length} committed deploys: s ${(100 * robustVer.s).toFixed(1)}% -> ${iv(robustVer.s, H)}`);
    c13.note(`  calibration: Gaussian-like ${calOld.why}; new ${calNew.why}`);
    c13.note(`  the 60% was one pass: 05:32 read 108.5h between 16.1h and 12.7h (r = +5.7 then -0.9); with it down-weighted the rest of the node's forecasts err ~${(100 * robustAll.s).toFixed(0)}%`);
    if (!(gauss > 0.5 && robustAll.s < 0.15)) c13.fail("fixture: the Gaussian fit should read the blip as ~60% error and the robust fit should not");
    if (!(Math.abs(calNew.cover80 - 0.8) <= Math.abs(calOld.cover80 - 0.8) + 0.02)) c13.fail("the robust, version-aware predictive must be at least as well calibrated as the old one on the live history", `${calOld.cover80} -> ${calNew.cover80}`);
  }
  checks.push(c13);

  // -----------------------------------------------------------------------
  const c14 = new Check("BY14", "A FRESH LIFE IS NOT BLIND: an income or reputation rate this life cannot measure yet comes from earlier lives (earnings ledger x multiplier) or the game-formula estimate, drawn in every Monte Carlo draw — the exit prices, marked, with the wider interval that implies (replay: BN1 00:18, batcher prepping)");
  {
    c14.examined(8);
    const X = await import("../../exitplan.js");
    const { bitNodeMults } = await import("../../bitNodeMultipliers.js");
    const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn1-freshlife-0018.json"), "utf8"));
    const live = F.exitInputs.inputs;
    const exitOf = (x) => {
      const r = X.bestExitPolicy(x);
      return r.degenerate ? null : r.best?.hours ?? null;
    };
    // (a) As live: no measured reputation rate -> the whole exit unpriced.
    const asLive = X.bestExitPolicy(live);
    c14.note(`as live 00:18: exit ${asLive.best?.hours ?? "UNPRICED"} (${asLive.why ?? ""})`);
    if (asLive.best) c14.fail("fixture: the live inputs should reproduce the unpriced exit");
    const withRep = { ...live, repPerSec: F.estimatedBaseRepPerSec, repFromEstimate: true, repSource: "formula estimate" };
    // (b) The lead's case: this life's income not measurable either (batcher prepping, no trader return).
    const noIncome = { ...withRep, incomePerSec: 0, capitalReturnPerSec: 0 };
    if (exitOf(noIncome) !== null) c14.fail("fixture: with no income the exit must be unpriced");
    const ageH = (Date.parse(F.exitInputs.at) - F.exitInputs.lastAugReset) / 3.6e6;
    // The fixture's lives predate tel.js's hacking column (two-element
    // samples), and at $1e5-1e6/s their totals sit inside the bound on the
    // trader, hacknet and crime: the hacking stream is not separable, so the
    // legacy form yields NO prior (streams [SI5]/[SI7]) — never the total. The
    // machinery is replayed on the same lives recorded split (hacking = the
    // total, as a BN1 life with no other income would record it).
    const shmOf = (n) => (bitNodeMults(n)?.ScriptHackMoneyGain === 0 ? 0 : bitNodeMults(n)?.ScriptHackMoney);
    const legacyPr = B.incomePrior({ earnings: F.earnings, ledger: F.lifetimes, node: 1, ageH, hackMultNow: live.hackingMult / (bitNodeMults(1).HackingLevelMultiplier ?? 1), shm: shmOf });
    c14.note(`the fixture's legacy (pre-split) lives: ${legacyPr ? legacyPr.why : "no prior — hacking not separable from the totals at this age"}`);
    if (legacyPr) c14.fail("these legacy totals are inside the non-hacking bound: they must not become a hacking prior", legacyPr.why);
    const splitEarnings = { lives: Object.fromEntries(Object.entries(F.earnings.lives).map(([k, L]) => [k, { ...L, samples: L.samples.map((q) => [q[0], q[1], q[1]]) }])) };
    const pr = B.incomePrior({ earnings: splitEarnings, ledger: F.lifetimes, node: 1, ageH, hackMultNow: live.hackingMult / (bitNodeMults(1).HackingLevelMultiplier ?? 1), shm: shmOf });
    if (!pr) c14.fail("the earnings ledger holds completed BN1 lives: the income prior must exist");
    else c14.note(pr.why);
    const fromPrior = pr ? { ...noIncome, incomePerSec: pr.perSec, incomeFromPrior: true, incomeSource: pr.why } : noIncome;
    const post = P.posteriorsOf({ exitSamples: [], income: pr });
    const draws = P.makeDraws(post, P.PLAN.N, 5);
    const mc = (inp) => P.decideAmong({ options: [{ key: "plan", sim: (d) => exitOf(P.applyDraw(inp, d)) }], draws, budgetMs: 1e9 });
    const a = mc(fromPrior);
    // Each source's own spread, the other held measured.
    const incomeOnly = mc({ ...fromPrior, repFromEstimate: false });
    const measured = mc({ ...fromPrior, repFromEstimate: false, incomeFromPrior: false });
    const repOnly = mc({ ...fromPrior, incomeFromPrior: false });
    c14.note(`widths: income prior alone ${(incomeOnly.q90 - incomeOnly.q10).toFixed(1)}h, rep estimate alone ${(repOnly.q90 - repOnly.q10).toFixed(1)}h, both measured ${(measured.q90 - measured.q10).toFixed(1)}h`);
    if (!(incomeOnly.q90 - incomeOnly.q10 > 1.2 * (measured.q90 - measured.q10))) c14.fail("the income prior must be drawn (its spread must reach the interval)");
    if (!(repOnly.q90 - repOnly.q10 > (measured.q90 - measured.q10))) c14.fail("the reputation estimate's residual must be drawn");
    if (pr && !(pr.sd > pr.sdLife)) c14.fail("the prior for THIS life is the predictive (node mean's uncertainty + one life's scatter), wider than one life's scatter");
    c14.note(`income from prior + rep from the estimate: exit median ${a.q50}h, 80% ${a.q10}-${a.q90}h (width ${(a.q90 - a.q10).toFixed(1)}h); the same median income taken as MEASURED: ${measured.q10}-${measured.q90}h (width ${(measured.q90 - measured.q10).toFixed(1)}h)`);
    if (!(Number.isFinite(a.q50) && a.q50 > 0)) c14.fail("the fresh life must publish a finite exit");
    if (!(a.q90 - a.q10 > 1.2 * (measured.q90 - measured.q10))) c14.fail("an income drawn from earlier lives must widen the interval over a measured one");
    // Cross-node: a node's first life borrows other nodes' lives, wider still.
    const first = B.incomePrior({ earnings: { lives: Object.fromEntries(Object.entries(splitEarnings.lives).filter(([, L]) => L.node !== 1)) }, ledger: F.lifetimes, node: 1, ageH, hackMultNow: 1.3, shm: shmOf });
    c14.note(first ? `a node's first life: ${first.why}` : "a node's first life: no other node's scripts earned (BN8 pays nothing) — no prior, the exit stays unpriced and says so");
    if (first && !(first.sd > pr.sd)) c14.fail("borrowing another node's lives must be wider than this node's own");
    // Nothing leaks where income IS measured: the draw leaves a measured income alone.
    const d0 = draws[0];
    if (P.applyDraw({ ...withRep, incomePerSec: 5 }, d0).incomePerSec !== 5) c14.fail("a measured income must not be replaced by the prior's draw");
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    if (!/const pr = incomePostOf\(ns, info, player\)\s*\n\s*if \(!pr\) return \{\}\s*\n\s*const flat = [^\n]*\n\s*return \{ incomePerSec: flat \+ pr\.perSec, incomeFlatPerSec: flat, incomeFromPrior: true, incomeSource: pr\.label \}/.test(prog)) c14.fail("exitInputsOf must take the hacking stream from the income posterior, marked (source guard)");
    if (!/repFromEstimate: true, repSource:/.test(prog) || !/income: incomePostOf\(ns, info, ns\.getPlayer\(\)\)[,} ]/.test(prog)) c14.fail("the reputation estimate and the income posterior must reach the inputs and the posteriors (source guard)");
  }
  checks.push(c14);

  // -----------------------------------------------------------------------
  const c15 = new Check("BY15", "THE INSTALL CADENCE IS A POSTERIOR, hierarchical over nodes: a node's own lives dominate within one or two, other nodes only shrink toward the cross-node mean, stall lives and re-recorded entries excluded, both rate and life length drawn in the Monte Carlo (replay: BN1 00:58, cadence borrowed from BN8's x1.103 per 9.31h)");
  {
    c15.examined(10);
    const X = await import("../../exitplan.js");
    const { bitNodeMults } = await import("../../bitNodeMultipliers.js");
    const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn1-cadence-0058.json"), "utf8"));
    const L = F.lifetimes;
    const live = F.exitInputs.inputs;
    const covOf = (n) => (bitNodeMults(n) ? Math.log(bitNodeMults(n).AugmentationMoneyCost * bitNodeMults(n).AugmentationRepCost) : 0);
    const now1 = live.hackingMult / (bitNodeMults(1).HackingLevelMultiplier ?? 1);
    const z = 1.2816;
    const band = (m) => `${Math.exp(m.mean - z * m.sd).toFixed(4)}-${Math.exp(m.mean + z * m.sd).toFixed(4)}`;
    // (a) The ledger, cleaned: one 14h BN8 life was recorded nine times, one
    // 8.6h life twice; gains credited to the life that bought them.
    const lives = B.ledgerLives(L, { node: 1, hackMultNow: now1 });
    const b8 = lives.filter((l) => l.node === 8);
    if (lives.dups !== 9 || b8.length !== 9) c15.fail(`re-recorded ledger entries must merge (9 duplicates, 9 BN8 lives), got ${lives.dups} / ${b8.length}`);
    const long = b8.find((l) => Math.abs(l.lifeH - 14.16) < 1e-9);
    if (!(long && long.records === 9 && Math.abs(long.g - Math.log(10.681849819777456 / 7.1652662366001305)) < 1e-9)) c15.fail("the 14h life's gain is its successor's multiplier over its own (credited to the life that bought it)", JSON.stringify(long));
    if (b8[b8.length - 1].g !== null) c15.fail("the node's terminal life (next entry another node) has no measured gain");
    const b1 = lives.filter((l) => l.node === 1);
    if (!(b1.length === 2 && Math.abs(b1[1].g - Math.log(now1 / b1[1].hackMult)) < 1e-9)) c15.fail("the last finished life of the current node takes this life's multiplier as its successor");
    // (b) The posteriors, BN1 and BN8.
    const c1 = B.cadencePosterior(L, 1, { hackMultNow: now1, covOf });
    const c8 = B.cadencePosterior(L, 8, { covOf });
    c15.note(`BN1: ${c1.why}; ln(M)/h 80% ${band(c1.rate)}, life ${c1.cycleHours.toFixed(2)}h (80% ${Math.exp(c1.life.mean - z * c1.life.sd).toFixed(2)}-${Math.exp(c1.life.mean + z * c1.life.sd).toFixed(2)}h); own lives alone ${c1.nodes[1].perHour.toFixed(4)}/h over ${c1.nodes[1].cycleHours.toFixed(2)}h`);
    c15.note(`BN8: ${c8.why}; ln(M)/h 80% ${band(c8.rate)}, own lives alone ${c8.nodes[8].perHour.toFixed(4)}/h over ${c8.nodes[8].cycleHours.toFixed(2)}h`);
    if (!(c1.own.weight > 0.5)) c15.fail(`two of BN1's own lives must carry most of its rate, got ${c1.own.weight}`);
    const own1 = Math.log(c1.nodes[1].perHour);
    const own8 = Math.log(c8.nodes[8].perHour);
    const pri1 = c1.rate.prior.mean;
    if (!(c1.rate.mean > Math.min(own1, pri1) && c1.rate.mean < Math.max(own1, pri1))) c15.fail("BN1's rate must be its own shrunk toward the cross-node mean (between its own and the prior from the other nodes)");
    if (!(Math.abs(c1.rate.mean - own1) < Math.abs(c1.rate.mean - pri1))) c15.fail("BN1's own lives must dominate: its posterior nearer its own rate than the cross-node prior");
    void own8;
    // The count rule's lives are their own regime: the 23:33 life ended by
    // "install: COUNT BATCH" is excluded and counted, not averaged in.
    if (c1.own.countLives !== 1) c15.fail(`BN1's count-rule life must be excluded and counted, got ${c1.own.countLives}`);
    if (!(c8.own.stalls === 1 && c8.own.gained === 7)) c15.fail(`BN8: the count-ticket life (multiplier unchanged) is a stall, excluded and counted — got ${c8.own.stalls} stalls / ${c8.own.gained} gaining`);
    // The node's own lives enter ONCE: with no other node, its prior is the
    // stated hyperprior exactly (they must not also move the cross-node mean).
    const solo = B.cadencePosterior(L.filter((e) => e.bitNode === 1), 1, { hackMultNow: now1, covOf });
    const H = B.PRIORS.cadence.rate;
    if (!(Math.abs(solo.rate.prior.mean - H.mu0) < 1e-12 && Math.abs(solo.rate.prior.sd - Math.hypot(H.smu, H.tau)) < 1e-12)) c15.fail("a node's own lives must not inform its own prior (double counting)", JSON.stringify(solo.rate.prior));
    // (c) Stalls are a separate state: adding stall lives moves nothing but their count.
    const stalled = [...L, ...[1, 2, 3].map((k) => ({ at: new Date(Date.parse(L[L.length - 1].at) + k * 3.6e6).toISOString(), bitNode: 1, lifeH: 0.9, hackMult: now1 }))];
    const cs = B.cadencePosterior(stalled, 1, { hackMultNow: now1, covOf });
    if (!(cs.own.stalls === 3 && Math.abs(cs.rate.mean - c1.rate.mean) < 1e-9 && Math.abs(cs.life.mean - c1.life.mean) < 1e-9)) c15.fail("stall lives (multiplier unmoved) must not enter the rate or life length", `${cs.own.stalls} stalls, rate ${cs.rate.mean} vs ${c1.rate.mean}`);
    // (d) Own lives dominate: a node with five lives at 5x the others' rate lands near its own.
    const fast = [...L, ...[0, 1, 2, 3, 4, 5].map((k) => ({ at: new Date(Date.parse("2026-10-01T00:00:00Z") + k * 3 * 3.6e6).toISOString(), bitNode: 5, lifeH: 3, hackMult: Math.exp(0.25 * 3 * k) }))];
    const c5 = B.cadencePosterior(fast, 5, { covOf });
    if (!(Math.abs(c5.rate.mean - Math.log(0.25)) < 0.3 && c5.own.weight > 0.8)) c15.fail(`five own lives must dominate the cross-node mean: ${c5.lnPerHour}/h vs own 0.25/h (weight ${c5.own.weight})`);
    // (e) A node with no life: the cross-node mean, own weight 0, wider than any node's own.
    const c2 = B.cadencePosterior(L, 2, { covOf });
    if (!(c2.own.weight === 0 && c2.rate.sd > c1.rate.sd && c2.rate.sd > c8.rate.sd && c2.rate.sd >= B.PRIORS.cadence.rate.tau)) c15.fail("a node without lives takes the cross-node mean, wider than tau");
    // (f) The covariate: dearer augmentations (BN10, ln(5x2)) -> a slower prior rate and longer lives.
    const c10 = B.cadencePosterior(L, 10, { covOf });
    if (!(c10.rate.mean < c2.rate.mean && c10.life.mean > c2.life.mean)) c15.fail("the aug-price covariate must slow the prior rate and lengthen the prior life of a dearer node");
    c15.note(`no-life nodes: BN2 (c=0) ${c2.lnPerHour.toFixed(4)}/h x/÷${Math.exp(z * c2.rate.sd).toFixed(1)}, BN10 (c=${covOf(10).toFixed(2)}) ${c10.lnPerHour.toFixed(4)}/h, ${c10.cycleHours.toFixed(1)}h lives`);
    // (g) The installCadence wrapper: medians as point inputs, never a borrowed node.
    const cad = X.installCadence(L, 1, { hackMultNow: now1, covOf });
    if (!(cad.source === "posterior" && cad.node === 1 && Math.abs(cad.stats.cycleHours - c1.cycleHours) < 1e-12 && Math.abs(cad.stats.multGainPerCycle - Math.exp(c1.lnPerHour * c1.cycleHours)) < 1e-12)) c15.fail("installCadence must publish the posterior's medians for this node", JSON.stringify(cad.stats));
    // (h) Drawn: every draw carries its own rate and life, paired across seeds.
    const post = P.posteriorsOf({ exitSamples: [], cadence: c1 });
    const draws = P.makeDraws(post, P.PLAN.N, 5);
    const again = P.makeDraws(post, P.PLAN.N, 5);
    const rates = draws.map((d) => d.lnPerHour);
    const lens = draws.map((d) => d.cycleH);
    if (!(new Set(rates).size === draws.length && new Set(lens).size === draws.length)) c15.fail("the cadence rate and life length must be drawn per draw");
    if (!draws.every((d, i) => d.lnPerHour === again[i].lnPerHour && d.cycleH === again[i].cycleH)) c15.fail("cadence draws must be common random numbers (same seed, same draw)");
    const o = P.applyDraw(live, draws[0]);
    if (!(o.cycleHours === draws[0].cycleH && Math.abs(o.multGainPerCycle - Math.exp(draws[0].lnPerHour * draws[0].cycleH)) < 1e-12)) c15.fail("applyDraw must set the cycle and its gain from the same draw");
    // (i) The replay: BN1's exit on its own cadence posterior, drawn.
    const exitOf = (x) => {
      const r = X.bestExitPolicy(x);
      return r.degenerate ? null : r.best?.hours ?? null;
    };
    const mc = (inp, p) => P.decideAmong({ options: [{ key: "plan", sim: (d) => exitOf(P.applyDraw(inp, d)) }], draws: P.makeDraws(p, P.PLAN.N, 5), budgetMs: 1e9 });
    const post0 = P.posteriorsOf({ exitSamples: [] });
    const withCad = { ...live, cycleHours: cad.stats.cycleHours, multGainPerCycle: cad.stats.multGainPerCycle };
    const borrowed = mc(live, post0);
    const pointOnly = mc(withCad, post0);
    const drawn = mc(withCad, post);
    c15.note(`BN1 exit, as live (BN8's cadence borrowed, x${live.multGainPerCycle.toFixed(3)} per ${live.cycleHours.toFixed(2)}h): median ${borrowed.q50}h, 80% ${borrowed.q10}-${borrowed.q90}h`);
    c15.note(`BN1 exit on its cadence posterior (x${cad.stats.multGainPerCycle.toFixed(3)} per ${cad.stats.cycleHours.toFixed(2)}h), drawn: median ${drawn.q50}h, 80% ${drawn.q10}-${drawn.q90}h (the medians as a point: ${pointOnly.q10}-${pointOnly.q90}h)`);
    if (!(Number.isFinite(drawn.q50) && drawn.q50 < borrowed.q10)) c15.fail("BN1's own faster cadence must bring the exit below the borrowed BN8 interval");
    if (!(drawn.q90 - drawn.q10 > 1.5 * (pointOnly.q90 - pointOnly.q10))) c15.fail("the cadence posterior must be drawn (its spread must reach the interval)");
    // (j) Wired (source guards).
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    if (!/const cadence = installCadence\(JSON\.parse\(ns\.read\('\/tel\/lifetimes\.txt'\) \|\| '\[\]'\), info\?\.currentNode, cadenceOptsOf\(player\)\)/.test(prog)) c15.fail("exitInputsOf must take the cadence posterior with this life's multiplier and the covariate (source guard)");
    if (!/cadence: installCadence\(ledger, info\?\.currentNode, \{ \.\.\.cadenceOptsOf\(ns\.getPlayer\(\)\), modelPrior: cadenceModelPriorOf\(ns, info\) \}\)\?\.posterior \?\? null/.test(prog)) c15.fail("the plan's posteriors must carry the cadence posterior, on the purchase model's prior where it priced (source guard)");
  }
  checks.push(c15);

  // -----------------------------------------------------------------------
  const c16 = new Check("BY16", "THE COMMITTED PLAN DECIDES THE COUNT BATCH outside capital nodes: replay BN1 02:58 — the plan chose w0.068 (24.8h) over installing (28.6h), the 30-min future held a second ticket, and the count rule's 'waiting cannot add one' installed one ticket anyway");
  {
    c16.examined(5);
    const IG = await import("../../installgate.js");
    const R = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn1-installgate-0258.json"), "utf8"));
    const d = R.plan; // the Bayesian decision, published under `plan` at the time (the collision fixed in c86b4d4)
    const H = 3600e3;
    const bayes = { install: d.install, key: d.key, waitMs: 0.068 * H, H: d.meanH, q10: d.q10, q50: d.q50, q90: d.q90, why: d.why };
    const exitCompare = { nowH: R.exitNowH, neverH: R.exitNeverH, waits: [{ waitMs: 0.068 * H, H: R.exitBestWaitH }], bayes, joinModelled: true };
    const base = { ageMs: R.ageMs, M: R.M, queued: R.queued, exp: 1e9, prev: null, futures: R.futures, countShort: R.countShort, countGain: R.countGain, countTiming: { installNow: true, reason: "exhausted", why: R.countTimingWhy }, capitalNode: false, binding: R.binding, exitCompare };
    const g = IG.shouldInstall(base);
    const more = (R.futures ?? []).find((f) => (f.buy ?? []).filter((n) => n !== "NeuroFlux Governor").length > 1);
    c16.note(`recorded: install ${R.install} by ${R.planOverride}; ${more ? `the ${more.waitMs / 60000}-min future buys ${more.buy.filter((n) => n !== "NeuroFlux Governor").join(" + ")}` : "no future adds a ticket"}`);
    c16.note(`replayed: install ${g.install}, count decided by ${g.countDecidedBy} — ${g.why.slice(0, 220)}`);
    if (!more) c16.fail("fixture: the 02:58 futures should show waiting adds a ticket");
    if (g.install !== false || g.countDecidedBy !== "plan" || g.planAgrees !== true) c16.fail("with the plan waiting, the count batch must wait (the plan decides, and agrees with the gate)", JSON.stringify({ i: g.install, by: g.countDecidedBy, a: g.planAgrees, o: g.planOverride }));
    // The plan says install: the count batch installs, the plan's reason named.
    const gNow = IG.shouldInstall({ ...base, exitCompare: { ...exitCompare, bayes: { ...bayes, install: true, key: "now", waitMs: 0, H: R.exitNowH } } });
    if (gNow.install !== true || gNow.countDecidedBy !== "plan") c16.fail("with the plan installing now, the count batch installs by the plan");
    // The plan chose 'never' (its trajectory has no Daedalus count): the count rule stands.
    const gNever = IG.shouldInstall({ ...base, exitCompare: { ...exitCompare, bayes: { ...bayes, install: false, key: "never" } } });
    if (gNever.install !== true || gNever.countDecidedBy === "plan") c16.fail("a plan that says 'never' must not stop the count from banking — the count rule is the fallback");
    // No plan: the count rule, as before.
    const gNo = IG.shouldInstall({ ...base, exitCompare: { ...exitCompare, bayes: undefined } });
    if (gNo.install !== true || gNo.countDecidedBy !== "priced") c16.fail("without a plan the count timing decides, as before");
    // The trader's realised fit (return + per-install warm-up) is used in EVERY
    // node where the history measures it, not only where money is capital.
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    const fitSrc = prog.slice(prog.indexOf("function capitalFitOf(ns, info) {"), prog.indexOf("function capitalFitOf(ns, info) {") + 3500);
    if (/^\s*if \(bitNodeMults\(info\?\.currentNode\)\?\.ScriptHackMoneyGain !== 0\) return null/m.test(fitSrc) || !/realisedCapital\(rows\) \?\? \(capitalNode &&/.test(fitSrc)) c16.fail("capitalFitOf must fit the trader wherever it has history (the steady-rate stand-in only where money is capital) — source guard");
  }
  checks.push(c16);

  // -----------------------------------------------------------------------
  const c17 = new Check("BY17", "ONE BASIS IS A TRAJECTORY AND ITS INPUTS: the graft decision's inputs are built earlier in the pass than the install decision's; right after an install they differ, and a rebase onto the install's trajectory alone read 18.56h vs 19.23h (live BN1 06:04) — the rebase takes the install decision's inputs too, and consistencyOf names differing inputs");
  {
    c17.examined(6);
    const X = await import("../../exitplan.js");
    const GP = await import("../../graftplan.js");
    const G = await import("./fixture-bn8-graft.mjs");
    const rows = fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn8-stockhist.txt"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const post = P.posteriorsOf({ stockRows: rows, warmupH: 0.16, exitSamples: JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn8-1232.json"), "utf8")).exitSamples });
    const draws = P.makeDraws(post, P.PLAN.N, 17);
    const now = Date.parse(G.AT);
    const specs = ["Embedded Netburner Module Core Implant", "Embedded Netburner Module Core V2 Upgrade"].map((n) => GP.graftSpecOf(G.CANDIDATES.find((c) => c.name === n), G.INTELLIGENCE, { entropy: true }));
    const withG = (x) => ({ ...x, finalGrafts: specs, graftStartMoney: 9.375e10 });
    // A: the graft decision's build (early in the pass). B: the install
    // decision's (later): the book has grown half again in between — the
    // shape of a fresh life's ramp between two reads.
    const A = G.INPUTS;
    const B = { ...A, expPerSec: A.expPerSec * 1.5, capitalReturnPerSec: A.capitalReturnPerSec * 1.3 };
    const pointOf = (x) => ({ now: { hours: X.bestExitPolicy({ ...x, firstInstallH: 0 }, 400, 1).best?.hours }, waits: [{ waitH: 1, hours: X.bestExitPolicy({ ...x, firstInstallH: 1 }, 400, 1).best?.hours }], never: { hours: X.bestExitPolicy(x, 0, 0).best?.hours } });
    const inst = P.decideInstall({ inputs: withG(B), point: pointOf(withG(B)), draws, now, budgetMs: 1e9 });
    inst.inputsKey = P.inputsKeyOf(withG(B));
    const spec = P.basisOf(inst, now);
    const traj = P.trajectoryOf(spec, {});
    const priced = (inp) => {
      const d = P.decideAmong({ options: [{ key: "none", noiseKey: P.noiseKeyOf(spec, inp), sim: (dr) => traj(P.applyDraw(inp, dr), dr) }, { key: "grafts", noiseKey: P.noiseKeyOf(spec, withG(inp)), sim: (dr) => traj(P.applyDraw(withG(inp), dr), dr) }], prev: { key: "grafts" }, redecide: false, draws, budgetMs: 1e9 });
      return { ...d, basisNoiseKey: P.noiseKeyOf(spec, withG(inp)), inputsKey: P.inputsKeyOf(inp) };
    };
    const oldRebase = priced(A); // the trajectory rebased, the inputs the graft decision's own
    const newRebase = priced(B); // trajectory AND inputs the install decision's
    const cOld = P.consistencyOf(inst, oldRebase, { si: 0.02 });
    const cOldBlind = P.consistencyOf({ ...inst, inputsKey: undefined }, { ...oldRebase, inputsKey: undefined }, { si: 0.02 });
    const cNew = P.consistencyOf(inst, newRebase, { si: 0.02 });
    c17.note(`install ${inst.key} on B: ${inst.meanH}h; grafts rebased on its trajectory with A's inputs: ${oldRebase.meanH}h (${cOldBlind.why}); with B's: ${newRebase.meanH}h (${cNew.why})`);
    if (!(cOld.ok === false && cOld.sameInputs === false)) c17.fail("a graft decision priced from other inputs on the same trajectory must be named as such", JSON.stringify(cOld));
    if (!(cNew.ok === true && cNew.diffH === 0)) c17.fail("rebased on the install decision's trajectory and inputs, the two decisions must price one exit exactly", JSON.stringify(cNew));
    if (!(Math.abs(oldRebase.meanH - inst.meanH) > 0.01)) c17.fail("fixture: different inputs should move the exit (else the check proves nothing)");
    if (P.inputsKeyOf(withG(A)) !== P.inputsKeyOf(A)) c17.fail("the inputs key must ignore the grafts a graft option adds");
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    if (!/\(gd\.basisNoiseKey !== inst\.noiseKey \|\| \(inst\.inputsKey && gd\.inputsKey !== inst\.inputsKey\)( \|\||\))/.test(prog) || !/pcx\.graftReprice\(spec, pcx\.installInputs \?\? null\)/.test(prog)) c17.fail("progress.js must rebase the graft decision onto the install decision's inputs when they differ (source guard)");
    if (!/pc\.installInputs = inputs\s*\n\s*if \(d && typeof d === 'object'\) d\.inputsKey = inputsKeyOf\(inputs\)/.test(prog)) c17.fail("the install decision must record the inputs it priced (source guard)");
  }
  checks.push(c17);

  // -----------------------------------------------------------------------
  const c18 = new Check("BY18", "THE LIFE'S LENGTH IS CHOSEN FROM WHAT A LIFE BUYS (lifeplan): reputation reset at every install against each augmentation's requirement, favour banked, the 1.9x money step — replay the 02:58 and 03:24 lives: the exit prefers long lives over the ~25-min ones the count rule ran");
  {
    c18.examined(8);
    const LP = await import("../../lifeplan.js");
    const X = await import("../../exitplan.js");
    const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn1-lifeplan-0610.json"), "utf8"));
    const I = F.exitInputs.inputs;
    const ms = LP.moneyScaleOf(F.earnings, 1, I);
    c18.note(`calibration: ${ms.why}`);
    const at = (T) => {
      const owned = new Set(F.owned);
      let back = 0;
      for (const e of F.lifetimes) if (Date.parse(e.at) >= Date.parse(T) && Array.isArray(e.installBatch)) for (const n of e.installBatch) (n === LP.NFG ? back++ : owned.delete(n));
      const catalogue = LP.catalogueOf({ catalog: F.catalog, price: F.price, repReq: F.repReq, stats: F.stats, prereq: F.prereq, owned: [...owned], joined: F.factions });
      if (catalogue.nfg) {
        catalogue.nfg.price /= Math.pow(LP.NFG_LEVEL_MULT, back);
        catalogue.nfg.repReq /= Math.pow(LP.NFG_LEVEL_MULT, back);
      }
      return { owned, catalogue };
    };
    const run = (T, o = {}) => {
      const { owned, catalogue } = at(T);
      return LP.cadenceByPurchases({ inputs: I, catalogue, favor: F.favor, owned: [...owned], repPerHour0: (o.repPerHour0 ?? I.repPerSec * 3600), moneyScale: ms.scale, bestExitPolicy: X.bestExitPolicy });
    };
    for (const [T, lifeH] of [["2026-09-28T02:58:00Z", 1.24], ["2026-09-28T03:24:00Z", 0.42]]) {
      const r = run(T);
      if (!r) {
        c18.fail(`${T}: the purchase model priced no life length`);
        continue;
      }
      const row = (L) => r.table.find((x) => x.L === L);
      c18.note(`${T.slice(11, 16)} (the rule's life was ${lifeH}h): ${r.why.split(" — ")[0]}; per length: ${r.table.map((x) => `${x.L}h ${x.perHour}/h exit ${x.H}h`).join(", ")}`);
      if (!(r.cycleHours >= 4)) c18.fail(`${T}: with reputation reset at every install a sub-4h life must not be the soonest exit, chose ${r.cycleHours}h`);
      if (!(row(0.5).H > r.exitH + 10 && row(0.5).perHour < row(r.cycleHours).perHour)) c18.fail(`${T}: half-hour lives must buy less per hour and exit later`);
      const { owned, catalogue } = at(T);
      const b = LP.lifeBatch({ items: catalogue.items, nfg: catalogue.nfg, state: { owned, favor: { ...F.favor }, nfgLevel: 0 }, L: lifeH, money: LP.freshLifeMoney(I, lifeH, ms.scale), repPerHour0: I.repPerSec * 3600 });
      c18.note(`  a ${lifeH}h life then buys ${b.chosen.length} augmentation(s) + ${b.nfgLevels} NeuroFlux (x${b.gain.toFixed(3)}): ${b.chosen.join(", ") || "none"}`);
    }
    // The mechanism: with reputation never binding (the old model's blind
    // spot), short lives look free again — the ranking must move toward them.
    const free = run("2026-09-28T03:24:00Z", { repPerHour0: 1e12 });
    const bound = run("2026-09-28T03:24:00Z");
    c18.note(`reputation unbounded: ${free.cycleHours}h lives (${free.table.find((x) => x.L === 0.5).perHour}/h at 0.5h); bounded: ${bound.cycleHours}h (${bound.table.find((x) => x.L === 0.5).perHour}/h)`);
    if (!(free.table.find((x) => x.L === 0.5).perHour > bound.table.find((x) => x.L === 0.5).perHour * 2)) c18.fail("the reputation requirement must be what makes short lives poor (unbounded, 0.5h lives buy far more)");
    // Favour accrues across lives.
    const { owned, catalogue } = at("2026-09-28T03:24:00Z");
    const seq = LP.lifeSequence({ items: catalogue.items, nfg: catalogue.nfg, favor: F.favor, owned: [...owned], L: 8, lives: 3, moneyAt: (L) => LP.freshLifeMoney(I, L, ms.scale), repPerHour0: I.repPerSec * 3600 });
    if (!(seq.length === 3 && seq.every((s) => Number.isFinite(s.lnGain)))) c18.fail("lifeSequence must price every life");
    const st0 = { owned: new Set(owned), favor: { ...F.favor }, nfgLevel: 0 };
    const b1 = LP.lifeBatch({ items: catalogue.items, nfg: catalogue.nfg, state: st0, L: 2, money: LP.freshLifeMoney(I, 2, ms.scale), repPerHour0: I.repPerSec * 3600 });
    const hi = { ...st0, favor: Object.fromEntries(Object.entries(F.favor).map(([k, v]) => [k, v + 100])) };
    const b2 = LP.lifeBatch({ items: catalogue.items, nfg: catalogue.nfg, state: hi, L: 2, money: LP.freshLifeMoney(I, 2, ms.scale), repPerHour0: I.repPerSec * 3600 });
    if (!(b2.lnGain > b1.lnGain)) c18.fail("more favour must buy more in the same life (the rate is base x (1 + favor/100))");
    // NeuroFlux needs its reputation too (x1.14 a level): money alone buys none.
    const poor = LP.lifeBatch({ items: catalogue.items, nfg: catalogue.nfg, state: { ...st0, favor: { ...F.favor } }, L: 1, money: 1e15, repPerHour0: 1 });
    if (poor.nfgLevels !== 0) c18.fail(`NeuroFlux bought without its reputation (${poor.nfgLevels} levels on ~1 rep)`);
    // The draws keep the chosen length, and what a life of it buys is the
    // drawn rate of the posterior whose prior IS the purchase model.
    const inp = { ...I, cycleHours: 8, multGainPerCycle: 1.25, cadenceFrom: "purchase model", cadenceRateMedian: 0.03 };
    const o = P.applyDraw(inp, { lnPerHour: 0.06, cycleH: 1.2 });
    if (!(o.cycleHours === 8 && Math.abs(Math.log(o.multGainPerCycle) - 0.06 * 8) < 1e-12)) c18.fail("a draw must keep the purchase model's life length and buy the drawn rate over it", JSON.stringify({ c: o.cycleHours, g: o.multGainPerCycle }));
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    // The length is now the PLAN's committed one (lifelength.test.mjs LL*), the gain the model-prior posterior's
    // rate at it through lifeplan.lifeInputsOf.
    if (!/const x = lifeInputsOf\(out, pc, Lc, post, \{ lifeLength: lifeWhy, catalogue \}\)/.test(prog) || !/const Lc = c && buys\(c\.L\) \? c\.L : provisionalLifeL\(/.test(prog)) c18.fail("exitInputsOf must take the committed life length, the gain the model-prior posterior's rate over it (source guard)");
    {
      const row = { L: 8, lnMean: 0.2 };
      const post = { rate: { mean: Math.log(0.03), sd: 0.4, weight: 0.3 }, modelPrior: { lnPerHour: 0.2 / 8 } };
      const x = LP.lifeInputsOf(I, { table: [row] }, 8, post);
      if (!(x && x.cycleHours === 8 && Math.abs(Math.log(x.multGainPerCycle) - 0.03 * 8) < 1e-12 && x.cadenceFrom === "purchase model")) c18.fail("lifeInputsOf at the prior's own length must price the posterior's median rate over it", JSON.stringify({ c: x?.cycleHours, g: x?.multGainPerCycle }));
    }
  }
  checks.push(c18);

  // -----------------------------------------------------------------------
  const c19 = new Check("BY19", "THE PACER PREDICTS A STEP FROM WHAT THAT STEP COST BEFORE: a cheap run followed by one 32ms step (live BN9 'plan-gang' step 20 of 25, a 59.1ms block) — the first pass blocks past 50ms, every later pass yields before the slow step");
  {
    c19.examined(4);
    const CO = await import("../../coop.js");
    let T = 0;
    const costs = [...Array(19).fill(1), 32, ...Array(5).fill(1)];
    function* work() {
      for (const c of costs) {
        T += c;
        yield;
      }
      return "done";
    }
    const memory = new Map();
    const run = async () => {
      const p = CO.makePacer({ sliceMs: 40, yieldFn: async () => {}, now: () => T, memory });
      const v = await p.slices(work(), "plan-gang");
      return { v, maxBlock: p.stats.maxBlockMs, yields: p.stats.yields };
    };
    const first = await run();
    const second = await run();
    const third = await run();
    c19.note(`pass 1 (nothing recorded): longest block ${first.maxBlock}ms, ${first.yields} yield(s); pass 2: ${second.maxBlock}ms, ${second.yields}; pass 3: ${third.maxBlock}ms`);
    if (!(first.v === "done" && second.v === "done")) c19.fail("the generator must complete");
    if (!(first.maxBlock > 50)) c19.fail("fixture: without a record the slow step should overrun (else the test proves nothing)");
    if (!(second.maxBlock <= 40 && third.maxBlock <= 40)) c19.fail(`with the step's cost recorded the pacer must yield before it (blocks ${second.maxBlock}ms, ${third.maxBlock}ms)`);
    // The record decays: a step that became cheap stops forcing yields.
    for (let i = 0; i < 12; i++) {
      costs[19] = 1;
      await run();
    }
    const cheap = await run();
    if (!(cheap.yields === 0)) c19.fail(`a step that became cheap must stop forcing yields (${cheap.yields})`);
    // ACROSS A PROCESS RESTART (progress.js is a fresh process every pass):
    // the memory rides the page's storage — a new process, a new in-module
    // Map, the same localStorage.
    costs[19] = 32;
    const kv = new Map();
    const storage = { getItem: (k) => (kv.has(k) ? kv.get(k) : null), setItem: (k, v) => kv.set(k, String(v)) };
    const runProc = async () => {
      const p = CO.makePacer({ sliceMs: 40, yieldFn: async () => {}, now: () => T, memory: new Map(), store: CO.stepMemoryStore(storage) });
      await p.slices(work(), "plan-gang");
      return p.stats.maxBlockMs;
    };
    const proc1 = await runProc();
    const proc2 = await runProc();
    const saved = kv.get(CO.STEP_MEMORY_KEY) ?? "";
    c19.note(`process 1: ${proc1}ms; process 2 (fresh memory, same page storage): ${proc2}ms; stored ${saved.length} bytes: ${saved.slice(0, 80)}`);
    if (!(proc1 > 50 && proc2 <= 40)) c19.fail(`the step-cost memory must survive a process restart (blocks ${proc1}ms then ${proc2}ms)`);
    if (!(saved.length < 200 && !/\[0,/.test(saved))) c19.fail("only the costly steps are persisted (the cheap ones are predicted from the step just run)");
    // A storage that throws is a no-op, never an error.
    const bad = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); } };
    const pb = CO.makePacer({ sliceMs: 40, yieldFn: async () => {}, now: () => T, memory: new Map(), store: CO.stepMemoryStore(bad) });
    if ((await pb.slices(work(), "plan-gang")) !== "done") c19.fail("a failing storage must not break the pacer");
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    if (!/makePacer\(\{ sliceMs: PLAN\.sliceMs, yieldFn: pageYieldOf\(ns\), store: stepMemoryStore\(pageStorage\(\)\) \}\)/.test(prog)) c19.fail("progress.js's pass pacer must persist its step memory (source guard)");
  }
  checks.push(c19);

  // -----------------------------------------------------------------------
  const c20 = new Check("BY20", "ONE RUN IS ONE PAGE, NOT ONE PROCESS: progress.js is a fresh process every pass, and pairs keyed on the process start never existed (live BN9 2026-09-30: s at its 10% prior all day, 41 pairs 'across a restart', calibration n 0, rep posterior null) — keyed on the page, a page reload, a model version or a telemetry gap > 1h breaks a run, a pass does not; replayed on the live 12:55Z history");
  {
    c20.examined(9);
    const t0 = Date.parse("2026-09-30T00:00:00Z");
    const at = (h) => new Date(t0 + h * 3.6e6).toISOString();
    // One page, one version, a sample every 15 min from a new process each
    // pass: every consecutive pair counts.
    const rand = B.rngOf(11);
    const S = [];
    for (let i = 0; i < 20; i++) S.push({ at: at(i * 0.25), exitH: (30 - i * 0.25) * Math.exp(0.05 * B.normalOf(rand)), life: 1, ver: "v", boot: 777 });
    const d = B.driftPosterior(S);
    if (!(d.pairs === 19 && d.excluded.boot === 0)) c20.fail("passes of one page must pair", JSON.stringify(d.excluded));
    // A telemetry gap longer than PAIR_MAX_GAP_H (a freeze, a suspend, a
    // stalled planner) breaks the run; one missed pass does not.
    const gapped = S.map((x, i) => (i >= 10 ? { ...x, at: at(i * 0.25 + 1.5) } : x));
    const g = B.driftPosterior(gapped);
    if (!(g.excluded.stale === 1 && g.pairs === 18)) c20.fail("a pair across a gap > 1h must be excluded as stale (and counted)", JSON.stringify(g.excluded));
    const missed = S.filter((_, i) => i !== 5);
    if (B.driftPairs(missed).excluded.stale !== 0) c20.fail("one missed pass (30 min) is not a gap");
    if (!/across a page reload/.test(d.why) || !/telemetry gap/.test(d.why)) c20.fail("the reason names the page and the gap", d.why);
    // runTail: the trailing run of a buffer.
    const buf = [
      { at: at(0), v: 1, ver: "old", boot: 1 },
      { at: at(0.1), v: 2, ver: "v", boot: 1 },
      { at: at(0.2), v: 3, ver: "v", boot: 2 },
      { at: at(1.9), v: 4, ver: "v", boot: 2 },
      { at: at(2.0), v: 5, ver: "v", boot: 2 },
    ];
    const r = B.runTail(buf, { ver: "v", boot: 2, at: at(2.1) });
    c20.note(`runTail: kept ${r.kept.map((x) => x.v).join(",")}, dropped ${JSON.stringify(r.dropped)}`);
    if (r.kept.map((x) => x.v).join(",") !== "4,5" || r.dropped.stale !== 3) c20.fail("runTail keeps the run after the last gap", JSON.stringify(r));
    const r2 = B.runTail(buf.slice(1, 3), { ver: "v", boot: 2, at: at(0.3) });
    if (r2.kept.map((x) => x.v).join(",") !== "3" || r2.dropped.boot !== 1) c20.fail("runTail drops another page's entries", JSON.stringify(r2));
    const r3 = B.runTail(buf.slice(3), { ver: "v", boot: 2, at: at(3.5) });
    if (r3.kept.length !== 0) c20.fail("a buffer whose last entry is older than the gap is not carried");
    const r4 = B.runTail(buf.slice(3), { ver: "w", boot: 2, at: at(2.1) });
    if (r4.kept.length !== 0 || r4.dropped.version !== 2) c20.fail("another version's entries are dropped", JSON.stringify(r4));
    // The option jitter pairs on the same rule.
    const pts = [0, 0.08, 0.16, 0.24].map((h, i) => ({ at: at(h), life: 1, ver: "v", boot: 9, h: { a: 10 + i * 0.01, b: 12 - i * 0.02 } }));
    if (B.jitterPosterior(pts).n !== 3) c20.fail("option points of one page pair across passes");
    if (B.jitterPosterior(pts.map((p, i) => ({ ...p, boot: i }))).n !== 0) c20.fail("option points across page reloads do not pair");
    // The page id: one value for the page's life, whatever the process.
    const T = await import("../../trace.js");
    if (!(T.pageBoot() === T.pageBoot() && T.pageBoot() === Math.round(performance.timeOrigin))) c20.fail("trace.pageBoot is performance.timeOrigin", `${T.pageBoot()} vs ${performance.timeOrigin}`);
    // Wiring: every consumer on the page tag, none on the process start.
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    if (/PLANNER_BOOT|boot: Date\.now\(\)/.test(prog)) c20.fail("progress.js must not tag forecasts with the process start (source guard)");
    if ((prog.match(/ver: MODEL_VERSION, boot: PAGE_BOOT/g) ?? []).length !== 5) c20.fail("the exit samples, both rate buffers, the option points and the run they are read against carry the page (source guard)");
    if (!/const r = runTail\(v, cur\)/.test(prog) || !/tail\('points', prev\.points\)/.test(prog)) c20.fail("planCtxOf must keep the buffers' trailing run (runTail), not a per-process filter (source guard)");
    if (!/runDropped: pc\.runDropped/.test(prog)) c20.fail("plan.txt must publish what the run rule dropped (source guard)");
    // REPLAY: live BN9 2026-09-30 12:55Z.
    const L = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-exitcal-0930.json"), "utf8"));
    const reload = Date.parse(L.pageLoadedAfter);
    const pageOf = (x) => (x.boot === undefined ? x : { ...x, boot: Date.parse(x.at) > reload ? "B" : "A" });
    const asLive = B.driftPosterior(L.samples);
    const byPage = B.driftPosterior(L.samples.map(pageOf));
    const cal = B.driftCalibration(L.samples.map(pageOf));
    const repRun = B.runTail(L.rep.map(pageOf), { ver: L.ver, boot: "B", at: L.at });
    const repPost = B.logRatePosterior(repRun.kept);
    c20.note(`as live (per process): ${asLive.why}`);
    c20.note(`per page: ${byPage.why}`);
    c20.note(`calibration: ${cal.why}; rep: ${repRun.kept.length} observations of version ${L.ver} -> median ${Math.exp(repPost?.mean ?? NaN).toFixed(2)} rep/s, sd of ln ${repPost?.sd?.toFixed(3)} (live: no posterior)`);
    if (!(asLive.pairs === 0 && asLive.s === Math.sqrt(B.PRIORS.drift.b / (B.PRIORS.drift.a - 1)))) c20.fail("fixture: the per-process tags leave the drift at its prior", asLive.why);
    if (!(byPage.pairs >= 40 && byPage.excluded.boot === 0 && byPage.s < 0.1)) c20.fail("keyed on the page the day's pairs count and the posterior leaves its prior", byPage.why);
    if (!(cal.n >= 40 && cal.cover80 > 0.6 && cal.cover80 < 0.95)) c20.fail("the calibration is measured on them", cal.why);
    if (!(repRun.kept.length >= 15 && repPost && repPost.sd < 0.2)) c20.fail("the rep observations of the current version accumulate", JSON.stringify(repRun.dropped));
  }
  checks.push(c20);

  return checks;
}
