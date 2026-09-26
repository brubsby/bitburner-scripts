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
    if (planInstall.install !== true || planInstall.plan?.key !== "now") c8.fail("installgate must obey the plan's install-now decision (and publish it)");
    if (planHold.install !== false) c8.fail("installgate must obey the plan's hold even when no point wait beats now");
    if (planHold.exitBestWaitH !== 69) c8.fail("the gate must publish the plan's chosen wait and its expected exit", String(planHold.exitBestWaitH));
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    const need = [
      [/from 'plan\.js'/, "progress.js imports plan.js"],
      [/decideRoute\(\{ inputs: rec\.inputs, count: cc, routes, point: ranked, repPoint: repPerSec, prev: pc\.prev\?\.decisions\?\.countRoute/, "the count route is decided by the plan against its committed choice"],
      [/const cm = bayRoute\s*\n?\s*\?/, "the schedule's route (countRoute.best) is the plan's choice, the interim rule only its fallback"],
      [/bayes: planInstallOf\(ns, info, inputs, countCtx,/, "the count-aware exit comparison carries the plan's install decision"],
      [/bayes: now\.best \? planInstallOf\(ns, info, inputs, null,/, "the ordinary exit comparison carries the plan's install decision"],
      [/const b = exitCompare\?\.bayes\s*\n\s*if \(b && typeof b\.q50 === 'number'\) return \{ exitH: b\.q50/, "the published exit is the plan's median"],
      [/enter\(`plan-\$\{name\}`\)[\s\S]{0,200}leave\(`plan-\$\{name\}`\)/, "each Monte Carlo is bracketed by trace.js"],
    ];
    for (const [re, what] of need) if (!re.test(prog)) c8.fail(`${what} (source guard)`);
    const pubs = (prog.match(/publishPlan\(ns, info, planExtrasOf\(scheduleTarget, bodyStep, countRoute\)\)/g) ?? []).length;
    if (pubs !== 4) c8.fail(`the plan must be published on every path that orders: both install paths, the unplanned Covenant path and the ordinary end of the pass (found ${pubs} of 4)`);
  }
  checks.push(c8);

  // -----------------------------------------------------------------------
  const c9 = new Check("BY9", "healthcheck F reads the plan: missing / stale / broken / over budget / miscalibrated each FAIL loud; a sound plan passes with its interval and calibration noted");
  {
    c9.examined(7);
    const now = Date.parse("2026-09-26T13:00:00Z");
    const at = new Date(now - 5 * 60e3).toISOString();
    const good = { at, lastAugReset: 1, health: "ok", cpu: { ms: 120, budgetMs: 400, overBudget: false, draws: 24 }, calibration: { n: 20, cover80: 0.8, why: "20 sequential one-step predictions" }, exit: { meanH: 64, q10: 57, q50: 63, q90: 71, source: "install decision (now)" }, decisions: {} };
    const prog = { at };
    const gate = { at, lastAugReset: 1 };
    const chk = (plan, what) => P.planCheck(plan, { gate, progress: prog, now }).fails.some((f) => f.what.startsWith(what));
    const ok = P.planCheck(good, { gate, progress: prog, now });
    c9.note(`sound plan: ${ok.fails.length} fails; notes: ${ok.notes.join(" | ")}`);
    if (ok.fails.length) c9.fail("a sound plan must pass", JSON.stringify(ok.fails));
    if (!chk(null, "PLAN MISSING")) c9.fail("no plan while progress.js runs must fail");
    if (!chk({ ...good, at: new Date(now - 90 * 60e3).toISOString() }, "PLAN STALE")) c9.fail("a 90-min-old plan must fail");
    if (!chk({ ...good, health: "error", error: "route decision threw" }, "PLAN BROKEN")) c9.fail("a plan that recorded an error must fail");
    if (!chk({ ...good, cpu: { ms: 900, budgetMs: 400, overBudget: true } }, "PLAN OVER CPU BUDGET")) c9.fail("over budget must fail");
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

  return checks;
}
