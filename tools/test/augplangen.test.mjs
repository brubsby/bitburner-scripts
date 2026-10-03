// [AG] THE PURCHASE PLANNER IN SLICES — augplan.planPurchasesGen.
//
// Live BN4.3 2026-10-03 11:23Z, after c434fdf put every batchAt in its own
// step: "PLAN BLOCKED THE PAGE: 94.1ms ... longest step 92.9ms in
// 'goweights-blade' (step 7797 of 10508)". One re-plan at the node's money
// (~$9.3b with the stock book counted) was ~90ms on its own. planPurchasesGen
// is the same planner yielding every PLAN_YIELD_UNITS work units (a DP
// transition plus the frontier it scans); planPurchases drains it.
//
//   AG1 IDENTICAL: on the real catalogue at $1b/$10b/$100b (plain, count
//       tickets, a stopping bar, owned prerequisites), the synchronous plan,
//       the drained generator at the default slice, at a fine slice and with
//       no yields at all are the same plan, value for value
//   AG2 THE BUDGET IN WORK UNITS, at $10b and $100b: the longest step's units,
//       priced at this run's own ms per unit (all of the run's time over all
//       of its units — load moves both together), stays under 10ms (planperf's
//       per-step bar: the page runs 2-4x slower against the 40ms slice); the
//       same plan unsliced is over it, so the check sees the live defect
//   AG3 THE WIRING: progress.js's replanAt carries .gen, the Bladeburner Go
//       weights and home verdict re-plan through it inside their generators,
//       and goweights/homeplan run a generator batchAt in their own steps

import "./gameresolve.mjs";
import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const A = await import("augplan.js");
const fx = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-augs.json"), "utf8"));
const OFFERS = fx.augmentations
  .map((a) => ({ name: a.name, faction: a.factions[0], baseCost: a.baseCost, repReq: a.baseRepRequirement, factionRep: 1e9, mults: a.mults, prereqs: a.prereqs, isNFG: a.isNFG, isSoA: a.isSoA, nfgLevel: 0 }))
  .filter((o) => o.faction);
const SRC = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8");
const drain = (g) => {
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
};
const STEP_MS = 10;

export async function run() {
  const checks = [];

  // ---- AG1 -----------------------------------------------------------------
  {
    const c = new Check("AG1", "planPurchasesGen drained is planPurchases, value for value, at any slice size");
    const owned = OFFERS.filter((o) => !o.isNFG && !o.isSoA && !(o.prereqs ?? []).length).slice(0, 4).map((o) => o.name);
    const variants = (m) => [
      ["plain", { offers: OFFERS, money: m }],
      ["tickets", { offers: OFFERS, money: m, ticketsWanted: 3 }],
      ["bar", { offers: OFFERS, money: m, targetM: 1.5 }],
      ["owned", { offers: OFFERS, money: m, owned, soaOwned: 1 }],
    ];
    for (const m of [1e9, 1e10, 1e11]) {
      for (const [name, o] of variants(m)) {
        const sync = JSON.stringify(A.planPurchases(o));
        const runs = [["default", {}], ["unsliced", { yieldEvery: Infinity }], ...(m <= 1e9 ? [["fine", { yieldEvery: 997 }]] : [])];
        for (const [label, opt] of runs) {
          const g = JSON.stringify(drain(A.planPurchasesGen(o, { ...opt, cache: false })));
          c.examined(1);
          if (g !== sync) c.fail(`AG1 $${m.toExponential(0)} ${name}: the ${label} generator's plan differs from planPurchases`, `${g.slice(0, 160)} / ${sync.slice(0, 160)}`);
        }
      }
    }
    c.note(`every variant identical across slice sizes (the DP's own optimality against brute force is augplan.test.mjs's)`);
    checks.push(c);
  }

  // ---- AG2 -----------------------------------------------------------------
  {
    const c = new Check("AG2", `one planPurchasesGen step stays under ${STEP_MS}ms of work at $10b and $100b (work units priced at the run's own rate)`);
    const timed = (o, opt) => {
      const work = {};
      const g = A.planPurchasesGen(o, { ...opt, cache: false, work });
      let longest = 0;
      let steps = 0;
      const t0 = performance.now();
      let t = t0;
      for (;;) {
        const r = g.next();
        const t2 = performance.now();
        longest = Math.max(longest, t2 - t);
        t = t2;
        steps++;
        if (r.done) break;
      }
      const ms = t - t0;
      return { work, steps, ms, longest, perUnit: ms / Math.max(1, work.total) };
    };
    for (const m of [1e10, 1e11]) {
      const o = { offers: OFFERS, money: m, ticketsWanted: 3 };
      const s = timed(o, {});
      const u = timed(o, { yieldEvery: Infinity });
      const predicted = s.work.maxStep * s.perUnit;
      const unsliced = u.work.maxStep * u.perUnit;
      c.examined(2);
      if (!(s.work.maxStep <= 2 * s.work.every)) c.fail(`AG2 $${m.toExponential(0)}: a step of ${s.work.maxStep} units against a slice of ${s.work.every}`);
      if (!(predicted < STEP_MS)) c.fail(`AG2 $${m.toExponential(0)}: the longest step is ${s.work.maxStep} units = ${predicted.toFixed(1)}ms at ${(s.perUnit * 1e6).toFixed(1)}ns/unit (budget ${STEP_MS}ms)`);
      if (!(unsliced >= STEP_MS)) c.fail(`AG2 $${m.toExponential(0)}: unsliced the plan is ${unsliced.toFixed(1)}ms in one step — the check cannot see the live defect at this money`);
      c.note(`$${m.toExponential(0)}: ${s.work.total} units in ${s.steps} steps (${s.ms.toFixed(0)}ms); longest ${s.work.maxStep} units = ${predicted.toFixed(1)}ms predicted (${s.longest.toFixed(1)}ms wall, GC included); unsliced one step of ${u.work.maxStep} units = ${unsliced.toFixed(0)}ms`);
    }
    checks.push(c);
  }

  // ---- AG3 -----------------------------------------------------------------
  {
    const c = new Check("AG3", "the coop-sliced re-planners run planPurchasesGen inside their own steps");
    const pg = SRC("progress.js");
    const gw = SRC("goweights.js");
    const hp = SRC("homeplan.js");
    c.examined(3);
    if (!/function replanner\(argsOf\) \{\s*const f = \(m, offersAt = null\) => planPurchases\(argsOf\(m, offersAt\)\)\s*f\.gen = \(m, offersAt = null\) => planPurchasesGen\(argsOf\(m, offersAt\)\)/.test(pg)) c.fail("AG3 progress.js replanner does not carry the generator form");
    if ((pg.match(/replanAt = replanner\(/g)?.length ?? 0) !== 2) c.fail("AG3 progress.js: both replanAt assignments must go through replanner (one would re-plan synchronously under the pacer)");
    if (/replanAt = \(m, offersAt = null\) =>/.test(pg)) c.fail("AG3 progress.js assigns a replanAt with no generator form");
    if ((pg.match(/yield\* replanGen\(replanAt, Math\.max\(0, m\)\)/g)?.length ?? 0) !== 2) c.fail("AG3 the Bladeburner Go weights and home verdict must re-plan through replanGen inside their generators");
    if ((gw.match(/yield\* callOut\(batchAt\(/g)?.length ?? 0) !== 3) c.fail("AG3 goweights.bladeGoWeightsGen must run every batchAt through callOut");
    if ((hp.match(/yield\* callOut\(batchAt\(/g)?.length ?? 0) !== 2) c.fail("AG3 homeplan.bladeHomeExitGen must run both batchAt calls through callOut");
    // callOut runs a generator in the caller's steps and passes a value through.
    const GW = await import("goweights.js");
    const g = GW.callOut((function* () { yield; yield; return 7; })());
    let n = 0;
    let r;
    do {
      r = g.next();
      n++;
    } while (!r.done);
    c.examined(2);
    if (r.value !== 7 || n !== 3) c.fail(`AG3 callOut did not run the generator in the caller's steps (${n} steps, ${r.value})`);
    if (drain(GW.callOut({ gains: {} })).gains === undefined) c.fail("AG3 callOut did not pass a plain batch through");
    checks.push(c);
  }
  return checks;
}
