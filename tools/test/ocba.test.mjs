// [OC] ADAPTIVE SIMULATION ALLOCATION.
//
// The plan prices on the browser's main thread. A re-decision spent the same
// 24 paired draws on an option 30h behind the incumbent as on its closest
// rival (the live 21:12Z install re-decision: 26 waits, 624 simulations,
// ~6s of work), and the 30-minute timer re-decided whether or not any
// committed margin could plausibly flip.
//
//   OC1  OCBA concentrates the draws on the close competitors: a far option
//        stops at n0, a close one runs on; the leaders (incumbent + best
//        alternative) price every draw
//   OC2  the same answer as every option on every draw: a clear synthetic
//        case, and the live fixtures (the 21:12Z re-decision screened and
//        with all 26 waits; the 13:41 install) — the choice and the committed
//        exit identical
//   OC3  CRN preserved: every option's samples are the full run's samples on
//        the draws it priced (a prefix, value for value); the leaders' are the
//        full arrays
//   OC4  the budgets: simBudget caps the simulations; the work budget stops
//        with the leaders in lockstep; ragged samples summarise and decide on
//        the draws both options priced (decide over a prefix = decide over
//        the truncated arrays); PLAN.ocba.on false is the full run

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const P = await import("../../plan.js");
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8");

function postOf(ps) {
  const c = ps.cadence;
  return {
    drift: { s: ps.s, nu: ps.driftNu ?? 4, a: 2, b: 2 * ps.s * ps.s },
    gymSdLn: 0.1,
    cadence: c ? { rate: { mean: Math.log(c.lnPerHour), sd: c.rateSdLn }, life: { mean: Math.log(c.cycleHours), sd: c.lifeSdLn }, own: { weight: c.ownWeight } } : null,
    expPost: ps.exp ? { perSec: ps.exp.perSec, sd: ps.exp.sdLn } : null,
    income: ps.income ? { perSec: ps.income.perSec, mean: Math.log(ps.income.perSec), sd: ps.income.sdLn } : null,
  };
}

// A synthetic market of options: a common shock every option shares (CRN
// cancels it in a pair) plus an option-specific wobble of scale sd.
const DRAWS = P.makeDraws({ drift: { s: 0.05, nu: 4, a: 2, b: 0.005 }, gymSdLn: 0.1 }, P.PLAN.N, 0xc0ffee);
const opt = (key, mu, sd) => ({ key, sim: (d) => mu * (1 + 0.1 * d.zc) + sd * Math.sin(d.i * 7.13 + mu) });
const OPTS = [opt("a", 50, 1), opt("near", 50.6, 1.5), opt("mid", 53, 1), opt("far", 80, 1), opt("farther", 120, 2)];
const off = { ...P.PLAN.ocba, on: false };
const sameArr = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);

export async function run() {
  const out = [];

  {
    const c = new Check("OC1", "OCBA concentrates the draws on the close competitors (n_k ∝ (σ_k/δ_k)², Bonferroni share of PLAN.ocba.pcs): far options stop at n0, the close one runs on, the leaders price every draw");
    for (const committed of [null, "a"]) {
      const ev = P.evaluate(OPTS, DRAWS, { budgetMs: 1e9, alloc: { ...P.PLAN.ocba, committed, switchCost: {} } });
      const n = ev.alloc.perOption;
      c.note(`committed ${committed}: ${ev.alloc.why}`);
      if (!(ev.alloc.mode === "ocba")) c.fail("the adaptive allocation did not run");
      if (!(n.a === DRAWS.length)) c.fail(`the best (and incumbent) must price every draw (${n.a})`);
      if (!(n.far === P.PLAN.ocba.n0 && n.farther === P.PLAN.ocba.n0)) c.fail(`options 30h+ behind must stop at n0 = ${P.PLAN.ocba.n0} (far ${n.far}, farther ${n.farther})`);
      if (!(n.near > n.mid && n.near > n.far)) c.fail(`the close competitor must get the most draws among the rest (near ${n.near}, mid ${n.mid}, far ${n.far})`);
      if (!(ev.alloc.sims < OPTS.length * DRAWS.length && ev.alloc.saved === OPTS.length * DRAWS.length - ev.alloc.sims)) c.fail(`it must save simulations and count them (${ev.alloc.sims} sims, saved ${ev.alloc.saved})`);
      if (!(ev.n === DRAWS.length)) c.fail(`n is the leaders' draws (${ev.n})`);
      c.examined(5);
    }
    // OCBA's ratio: two non-leaders with equal δ, the noisier gets more draws.
    const two = [opt("a", 50, 0.5), opt("alt", 50.5, 0.5), opt("calm", 52, 0.3), opt("noisy", 52, 6)];
    const ev = P.evaluate(two, DRAWS, { budgetMs: 1e9, alloc: { ...P.PLAN.ocba, committed: "a" } });
    c.note(`equal gaps, unequal noise: ${ev.alloc.why}`);
    if (!(ev.alloc.perOption.noisy > ev.alloc.perOption.calm)) c.fail(`the noisier difference must get more draws (noisy ${ev.alloc.perOption.noisy}, calm ${ev.alloc.perOption.calm})`);
    out.push(c);
  }

  {
    const c = new Check("OC2", "THE SAME ANSWER as every option on every draw: a clear case, and the live fixtures (21:12Z re-decision screened and with all 26 waits; 13:41 install) — choice and committed exit identical");
    // Under both commitment rules (COMMIT.rule): the expected-loss rule ranks
    // switch candidates by gain less the value of waiting, so a noisy best-mean
    // alternative ("wild") beside a steady one ("steady") must not be settled
    // by mean alone.
    const OPTS2 = [opt("inc", 60, 1), opt("wild", 50, 14), opt("steady", 50.8, 0.5), opt("far2", 75, 1)];
    for (const rule of ["expected-loss", "p-better"]) {
      const was = P.setCommitCalibration({ rule });
      try {
        for (const [set, committed] of [[OPTS, null], [OPTS, "a"], [OPTS, "far"], [OPTS2, "inc"], [OPTS2, null]]) {
          const full = P.evaluate(set, DRAWS, { budgetMs: 1e9 });
          const oc = P.evaluate(set, DRAWS, { budgetMs: 1e9, alloc: { ...P.PLAN.ocba, committed } });
          const a = P.decide({ samples: full.samples, committed });
          const b = P.decide({ samples: oc.samples, committed });
          const tag = `synthetic (${rule}), committed ${committed}`;
          if (!(a.choice === b.choice && a.switched === b.switched && a.gainH === b.gainH && a.pWin === b.pWin && (a.vowH ?? null) === (b.vowH ?? null))) c.fail(`${tag}: full ${a.choice} (gain ${a.gainH}, pWin ${a.pWin}, vow ${a.vowH}) vs adaptive ${b.choice} (gain ${b.gainH}, pWin ${b.pWin}, vow ${b.vowH})`);
          if (!(a.stats[a.choice].meanH === b.stats[b.choice].meanH)) c.fail(`${tag}: the chosen exit moved ${a.stats[a.choice].meanH} -> ${b.stats[b.choice].meanH}`);
          if (set === OPTS2 && committed === "inc") c.note(`${tag}: ${a.choice} (${a.why.slice(0, 90)}...); ${oc.alloc.why}`);
          c.examined(1);
        }
      } finally {
        P.setCommitCalibration(was);
      }
    }
    const R = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-redecide-2112.json"), "utf8"));
    const RD = P.makeDraws(postOf(R.posteriors), P.PLAN.N, P.seedOf(R.lastAugReset, R.node));
    const H = (spec) => P.trajectoryOf(spec)(R.exitinputs);
    const point = {
      now: { hours: H({ kind: "wait", waitH: 0 }) },
      waits: R.install.options.filter((o) => /^w[\d.]+$/.test(o.key)).map((o) => {
        const w = +o.key.slice(1);
        const gw = w >= 2 ? R.install.gains : null;
        return { waitH: w, hours: H({ kind: "wait", waitH: w, gains: gw }), installGains: gw };
      }),
      never: { hours: H({ kind: "never" }) },
      committedGains: R.prev.gains,
    };
    for (const [label, extra] of [["screened", {}], ["all 26 waits", { installTopK: Infinity, installReach: Infinity }]]) {
      const args = { inputs: R.exitinputs, point, prev: R.prev, draws: RD, redecide: true, budgetMs: 1e9, now: Date.parse(R.at), reachSd: R.posteriors.s, ...extra };
      const t0 = performance.now();
      const full = P.decideInstall({ ...args, ocba: off });
      const t1 = performance.now();
      const oc = P.decideInstall({ ...args });
      const t2 = performance.now();
      c.note(`21:12Z ${label}: full ${full.key} ${full.meanH}h, ${full.alloc.sims} sims (${(t1 - t0).toFixed(0)}ms); adaptive ${oc.key} ${oc.meanH}h, ${oc.alloc.why} (${(t2 - t1).toFixed(0)}ms, the second run reads the first's memo)`);
      if (!(full.key === oc.key && full.meanH === oc.meanH && full.q10 === oc.q10 && full.q90 === oc.q90 && full.switched === oc.switched && full.pWin === oc.pWin && full.gainH === oc.gainH)) c.fail(`21:12Z ${label}: the adaptive allocation changed the decision`, `full ${full.key} ${full.meanH}h (pWin ${full.pWin}, gain ${full.gainH}) vs ${oc.key} ${oc.meanH}h (pWin ${oc.pWin}, gain ${oc.gainH})`);
      if (!(oc.n === P.PLAN.N)) c.fail(`21:12Z ${label}: the leaders must price all ${P.PLAN.N} draws (${oc.n})`);
      if (label !== "screened" && !(oc.alloc.sims <= 0.6 * full.alloc.sims)) c.fail(`21:12Z ${label}: the 26-wait re-decision must save at least 40% of its simulations (${oc.alloc.sims} of ${full.alloc.sims})`);
      c.examined(1);
    }
    out.push(c);
  }

  {
    const c = new Check("OC3", "COMMON RANDOM NUMBERS preserved: every option's adaptive samples are the full run's on the draws it priced (a prefix, value for value, structural noise included); the leaders' are the full arrays");
    const full = P.evaluate(OPTS, DRAWS, { budgetMs: 1e9 });
    for (const committed of [null, "a", "mid"]) {
      const oc = P.evaluate(OPTS, DRAWS, { budgetMs: 1e9, alloc: { ...P.PLAN.ocba, committed } });
      for (const o of OPTS) {
        const s = oc.samples[o.key];
        if (!sameArr(s, full.samples[o.key].slice(0, s.length))) c.fail(`committed ${committed}: ${o.key}'s samples are not the full run's prefix`);
        if (!sameArr(oc.raw[o.key], full.raw[o.key].slice(0, s.length))) c.fail(`committed ${committed}: ${o.key}'s raw exits are not the full run's prefix`);
        c.examined(1);
      }
      for (const l of oc.alloc.leaders) if (!sameArr(oc.samples[l], full.samples[l])) c.fail(`committed ${committed}: leader ${l} must equal the full run's samples`);
    }
    // The same trajectory (noise key) in two options draws the same noise in both modes.
    const twin = [{ ...opt("x", 50, 1), noiseKey: "T" }, { ...opt("y", 50, 1), noiseKey: "T" }, opt("z", 90, 1)];
    const ev = P.evaluate(twin, DRAWS, { budgetMs: 1e9, alloc: { ...P.PLAN.ocba } });
    const m = Math.min(ev.samples.x.length, ev.samples.y.length);
    if (!sameArr(ev.samples.x.slice(0, m), ev.samples.y.slice(0, m))) c.fail("one trajectory's noise key must draw the same noise in every option that prices it");
    out.push(c);
  }

  {
    const c = new Check("OC4", "THE BUDGETS AND RAGGED SAMPLES: simBudget caps the simulations; the work budget stops with the leaders in lockstep; decide over ragged samples = decide over the arrays truncated to the draws both priced; summarize's CRN-adjusted mean; on: false is the full run");
    const capped = P.evaluate(OPTS, DRAWS, { budgetMs: 1e9, alloc: { ...P.PLAN.ocba, committed: "a", simBudget: 60 } });
    if (!(capped.alloc.sims <= 60)) c.fail(`simBudget 60: ${capped.alloc.sims} simulations`);
    c.note(`simBudget 60: ${capped.alloc.why}`);
    // A clock that advances 1 per call: the work budget stops mid-run.
    let t = 0;
    const tick = () => t++;
    const timed = P.evaluate(OPTS, DRAWS, { budgetMs: 40, now: tick, alloc: { ...P.PLAN.ocba, committed: "a" } });
    const ln = timed.alloc.leaders.map((l) => timed.samples[l].length);
    c.note(`work budget: ${timed.alloc.why}`);
    if (!timed.overBudget) c.fail("the work budget must stop this run");
    if (!(Math.max(...ln) - Math.min(...ln) <= 1)) c.fail(`the leaders must stay in lockstep under a budget stop (${ln.join(", ")})`);
    // decide on ragged samples equals decide on the truncated pairs.
    const rag = { c: [10, 11, 12, 13, 14, 15], a: [9.5, 11.2, 11.9, 12.5], b: [20, 21, 22, 23, 24, 25] };
    const d = P.decide({ samples: rag, committed: "c" });
    const D = rag.c.slice(0, 4).map((x, i) => x - (rag.a[i] + P.PLAN.switchCostH));
    const gain = D.reduce((s, x) => s + x, 0) / 4;
    if (!(Math.abs(d.gainH - +gain.toFixed(3)) < 1e-9)) c.fail(`ragged decide must pair over the draws both priced (gain ${d.gainH} vs ${gain.toFixed(3)})`);
    const st = P.summarize(rag).stats;
    const adj = rag.c.reduce((s, x) => s + x, 0) / 6 + rag.a.reduce((s, x, i) => s + (x - rag.c[i]), 0) / 4;
    if (!(st.a.nDraws === 4 && Math.abs(st.a.meanH - +adj.toFixed(3)) < 1e-9 && st.a.meanOwnH === +(rag.a.reduce((s, x) => s + x, 0) / 4).toFixed(3))) c.fail("summarize: a short option's mean is the CRN control-variate estimate on all N, its own mean kept", JSON.stringify(st.a));
    const full = P.evaluate(OPTS, DRAWS, { budgetMs: 1e9 });
    const offRun = P.evaluate(OPTS, DRAWS, { budgetMs: 1e9, alloc: { ...P.PLAN.ocba, on: false } });
    if (!(offRun.alloc.mode === "full" && OPTS.every((o) => sameArr(offRun.samples[o.key], full.samples[o.key])))) c.fail("PLAN.ocba.on false must be every option on every draw");
    // Equal arrays summarise exactly as before (no nDraws, no adjustment).
    if (Object.values(P.summarize(full.samples).stats).some((s) => "nDraws" in s || "meanOwnH" in s)) c.fail("full samples must summarise unchanged");
    c.examined(6);
    out.push(c);
  }

  return out;
}
