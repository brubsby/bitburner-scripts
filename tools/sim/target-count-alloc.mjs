#!/usr/bin/env node
// Does the ALLOCATOR, not the count, explain the rejected saturation model?
//
//   node tools/sim/target-count-alloc.mjs --fleets 448708 --minutes 180 --seeds 3
//
// prior-art.md 9h says: fill the best target to its saturation RAM, spill the
// surplus to the next. That is a fractional knapsack with capacities, and the
// count that falls out of it ("take ranked targets until the summed saturation
// covers the fleet") is only the right count IF the batcher allocates that way.
// batch.js and batcher.mjs do not: both give every chosen target an equal share
// (`share = totalRam / targets.length`).
//
// This arm runs the same batcher with a greedy capped allocation instead, so
// the two hypotheses can be told apart:
//
//   even   : n chosen by argmax of the piecewise-linear income model
//   greedy : n chosen by cumulative saturation, RAM handed out fill-first
//
// The batcher itself is untouched. `share` is the only thing that changes, and
// it is changed by handing dispatch a proxy of the sim whose totalRam() reports
// `share * targets.length` for the target currently being served — so every
// other behaviour (safe-window gate, placement, drain, spill) is literally the
// same code path.
//
// NOT CALIBRATED, and it cannot be: the greedy arm has never run in the live
// game, so there is no live measurement of it to assert against. The even arm
// can be and is — verify-alloc-shipped.mjs section 0 — and it shows the
// simulated period (0.80s) is 33% shorter than the live one (up to 1.20s). Both
// arms here inherit that, so read this as a comparison between two hypotheses
// under one shared and known-optimistic assumption, never as a forecast.

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

const fleets = nums(flag("fleets", "448708"));
const minutes = Number(flag("minutes", 180));
const seeds = Number(flag("seeds", 3));
const spacing = Number(flag("spacing", 200));
const evenCounts = nums(flag("even", "7,8"));
const maxTargets = Number(flag("maxtargets", 16));

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(0)}b` : `$${(n / 1e6).toFixed(1)}m`);

/** Proxy a sim so totalRam() reports `n * share` and everything else passes through. */
function simWithShare(sim, share, n) {
  return new Proxy(sim, {
    get(target, prop, recv) {
      if (prop === "totalRam") return () => share * n;
      const v = Reflect.get(target, prop, recv);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

/** hwgwBatcher, but RAM is filled into ranked targets up to each one's saturation. */
function greedyBatcher(opts = {}) {
  const b = hwgwBatcher({ ...opts, nTargets: maxTargets, maxTargets, spacing });
  b.name = opts.label ?? "hwgw greedy-saturation allocation";
  b._shares = new Map();
  b._nextAlloc = -1;

  const origTick = b.tick.bind(b);
  b.tick = function (sim) {
    if (sim.t >= this._nextAlloc) {
      this._nextAlloc = sim.t + 30_000;
      const ranked = [...sim.targets()]
        .filter((t) => t.moneyMax > 0)
        .map((t) => ({ t, s: batchIndex(t, sim) }))
        .filter((x) => x.s > 0)
        .sort((a, b2) => b2.s - a.s);
      let left = sim.totalRam();
      this._shares = new Map();
      for (const x of ranked) {
        if (left <= 0 || this._shares.size >= maxTargets) break;
        const plan = batchPlan(sim, x.t, { maxRam: left / 4, margin: 1.1 });
        if (!plan) continue;
        const sat = (plan.ram * plan.weakenTime) / (4 * spacing);
        const give = Math.min(sat, left);
        // A target whose allocation cannot hold even one batch is not a target,
        // it is a prep bill: it would still be prepped, and prep draws on the
        // whole fleet's free RAM. Stopping here is what makes the greedy count
        // fall out of the allocation rather than being a separate decision.
        if (give < plan.ram) break;
        this._shares.set(x.t.hostname, give);
        left -= give;
      }
    }
    origTick(sim);
  };

  const origServe = b.serve.bind(b);
  b.serve = function (sim, name) {
    const share = this._shares.get(name);
    if (!share) return origServe(sim, name);
    return origServe(simWithShare(sim, share, Math.max(1, this._targets.length)), name);
  };
  // Serve exactly the targets that received an allocation. Serving the whole
  // ranked head instead is a real bug and it was made here first: the unfunded
  // targets still enter prep, and prep draws on the whole fleet's free RAM, so
  // at 32,768GB — where the best target alone absorbs everything — the arm
  // earned 36% of a single-target even split purely on prep contention.
  b.chooseTargets = function (sim) {
    return [...this._shares.keys()];
  };
  return b;
}

const world = loadSnapshot();
for (const gb of fleets) {
  const rows = [];
  for (const n of evenCounts) {
    const runs = [];
    for (let seed = 1; seed <= seeds; seed++)
      runs.push(
        new Sim(world, { seed }).run(
          atTotalRam(hwgwBatcher({ nTargets: n, maxTargets: 16, spacing, label: `even ${n}t` }), gb),
          minutes * 60_000,
        ).moneyStolen,
      );
    rows.push({ arm: `even split, n=${n}`, v: median(runs) });
    console.log(`  ${gb}GB even n=${n}: ${fmt(rows.at(-1).v)}`);
  }
  const runs = [];
  for (let seed = 1; seed <= seeds; seed++)
    runs.push(new Sim(world, { seed }).run(atTotalRam(greedyBatcher(), gb), minutes * 60_000).moneyStolen);
  rows.push({ arm: "greedy fill to saturation", v: median(runs) });
  console.log(`  ${gb}GB greedy: ${fmt(rows.at(-1).v)}`);

  const best = rows.reduce((a, b2) => (b2.v > a.v ? b2 : a));
  console.log(`\nfleet ${gb}GB — best: ${best.arm} ${fmt(best.v)}`);
  for (const r of rows) console.log(`   ${r.arm.padEnd(28)} ${fmt(r.v).padStart(8)}  ${((r.v / best.v) * 100).toFixed(0)}%`);
}
process.exit(0);
