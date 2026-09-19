#!/usr/bin/env node
// Measure the batcher's earnings against target count at pinned fleet sizes,
// and compare with the analytic prediction from target-count.mjs.
//
//   node tools/sim/target-count-sweep.mjs --fleets 32768 --counts 1,2,3,4,6,8 --minutes 180 --seeds 3
//
// This is the same experiment as docs/optimizer-log.md section 17 (whose arms
// live in strategies.mjs as pin32768N*/pin98304N*/liveN*), but parameterised so
// fleet sizes that have no registry entry can be measured too. It reuses
// strategies.mjs's own atTotalRam and batcher.mjs's hwgwBatcher — nothing about
// the batcher or the world is reimplemented here.
//
// CALIBRATION: none here, by construction — this measures the SIMULATED batcher,
// and the simulated batcher's dispatch rate is the thing the live game
// disagrees with (target-count.mjs's CHECK: modelled income +40% against
// .telemetry/batch.txt). Run `node tools/sim/target-count.mjs` first and read
// its CHECK block. The counts this sweep produces are comparable to each other;
// the dollar figures are not comparable to the live game.

import "./env.mjs";
import { Sim } from "./engine.mjs";
import { loadSnapshot } from "./world.mjs";
import { atTotalRam } from "./strategies.mjs";
import { batchIndex, batchPlan, hwgwBatcher } from "./batcher.mjs";

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i > -1 ? argv[i + 1] : d;
};
const nums = (s) => String(s).split(",").map(Number);

const fleets = nums(flag("fleets", "32768"));
const counts = nums(flag("counts", "1,2,3,4,6,8"));
const minutes = Number(flag("minutes", 180));
const seeds = Number(flag("seeds", 3));
const spacing = Number(flag("spacing", 200));

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(0)}b` : `$${(n / 1e6).toFixed(1)}m`);

/**
 * The proposed rule, end to end: choose the count that maximises
 *
 *     income(n) = sum_i min( money_i/(4e), (totalRam/n) * money_i/(gb_i*weakenTime_i) )
 *
 * This is the arm that answers "does the rule as written pick the right count
 * when it has to pick it itself", rather than "is the model's curve the right
 * shape". Everything except chooseTargets is the shipped batcher.
 */
function modelBatcher(maxTargets = 8) {
  const b = hwgwBatcher({ nTargets: 1, maxTargets, spacing, label: `hwgw model rule (<=${maxTargets})` });
  b.chooseTargets = function (sim) {
    const ranked = [...sim.targets()]
      .filter((t) => t.moneyMax > 0)
      .map((t) => ({ t, s: batchIndex(t, sim) }))
      .filter((x) => x.s > 0)
      .sort((a, c) => c.s - a.s)
      .slice(0, maxTargets);
    if (!ranked.length) return [];
    const totalRam = sim.totalRam();
    let bestN = 1;
    let bestInc = -1;
    for (let n = 1; n <= ranked.length; n++) {
      const share = totalRam / n;
      let inc = 0;
      for (let i = 0; i < n; i++) {
        const plan = batchPlan(sim, ranked[i].t, { maxRam: share / 4, margin: 1.1 });
        if (!plan) continue;
        inc += Math.min(plan.money / (4 * spacing), (share * plan.money) / (plan.ram * plan.weakenTime));
      }
      if (inc > bestInc) {
        bestInc = inc;
        bestN = n;
      }
    }
    return ranked.slice(0, bestN).map((x) => x.t.hostname);
  };
  return b;
}

const world = loadSnapshot();
const out = {};
for (const gb of fleets) {
  const row = {};
  if (argv.includes("--rule")) {
    const runs = [];
    for (let seed = 1; seed <= seeds; seed++)
      runs.push(new Sim(world, { seed }).run(atTotalRam(modelBatcher(), gb), minutes * 60_000).moneyStolen);
    row.rule = median(runs);
    console.error(`  ${gb}GB rule: ${fmt(row.rule)}`);
  }
  for (const n of counts) {
    const runs = [];
    for (let seed = 1; seed <= seeds; seed++) {
      const strat = atTotalRam(hwgwBatcher({ nTargets: n, maxTargets: 16, spacing, label: `hwgw ${n}t` }), gb);
      const r = new Sim(world, { seed }).run(strat, minutes * 60_000);
      runs.push(r.moneyStolen);
    }
    row[n] = median(runs);
    console.error(`  ${gb}GB n=${n}: ${fmt(row[n])}`);
  }
  out[gb] = row;
  // The rule arm is scored against the best PINNED count, so it is excluded
  // from the argmax it is being compared to.
  const best = Object.entries(row)
    .filter(([k]) => k !== "rule")
    .reduce((a, b) => (b[1] > a[1] ? b : a));
  console.log(`fleet ${gb}GB -> measured best n = ${best[0]}`);
  for (const [n, v] of Object.entries(row))
    console.log(`   n=${String(n).padStart(2)}  ${fmt(v).padStart(8)}  ${((v / best[1]) * 100).toFixed(0).padStart(4)}%`);
}
console.log(JSON.stringify(out));
process.exit(0);
