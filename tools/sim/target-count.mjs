#!/usr/bin/env node
// How many targets should the batcher run? — the analytic model, and its
// validation against the measured sweep (docs/optimizer-log.md section 17).
//
//   node tools/sim/target-count.mjs                    model at the three measured fleets
//   node tools/sim/target-count.mjs --fleets 32768,98304,448708
//   node tools/sim/target-count.mjs --table            per-target plan/rate/saturation dump
//
// Nothing here is invented: every per-target quantity comes from the game's own
// formulas via batcher.mjs's batchPlan (the same function the simulated batcher
// dispatches with), and the allocation rule modelled is the one the batcher
// actually implements — an EVEN split of the fleet over the chosen targets
// (batcher.mjs dispatch: `share = sim.totalRam() / this._targets.length`).
//
// CALIBRATION. Right formulas are not enough — this model's OUTPUT is a dollar
// rate, and a rate can be wrong by a factor even when every term in it is
// exact. So before any of the tables below, it reproduces what `batch.js` is
// earning right now at its own fleet size and target count, and prints the
// error. See the CHECK section; `--no-check` skips it and is a bad idea.

import "./env.mjs";
import { Sim } from "./engine.mjs";
import { fetchSnapshot, loadSnapshot } from "./world.mjs";
import { batchIndex, batchPlan } from "./batcher.mjs";
import { checkWithin, failureCount, measuredBatch, report } from "./calibrate.mjs";

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i > -1 ? argv[i + 1] : d;
};
const has = (n) => argv.includes(`--${n}`);

const spacing = Number(flag("spacing", 200));
const minInFlight = Number(flag("mininflight", 4));
const fleets = String(flag("fleets", "32768,98304,448708")).split(",").map(Number);
const maxN = Number(flag("maxn", 16));

const snapshot = loadSnapshot();
const sim = new Sim(snapshot, { seed: 1 });
sim.nuke();

// A run of any length raises the hacking level, and every quantity here moves
// with it (hackTime falls as 1/(L+50), phi rises). --exp evaluates the model at
// the experience total a run reaches rather than at its starting level, which
// is the like-for-like comparison against a 180-minute measurement.
const expOverride = flag("exp", null);
if (expOverride !== null) sim.gainExp(Number(expOverride) - sim.player.hackExp);
console.log(`world: hacking level ${sim.hacking}, ${ranked0()} targets at or below it`);
function ranked0() {
  return [...sim.targets()].filter((t) => t.moneyMax > 0).length;
}

const ranked = [...sim.targets()]
  .filter((t) => t.moneyMax > 0)
  .map((t) => ({ t, s: batchIndex(t, sim) }))
  .filter((x) => x.s > 0)
  .sort((a, b) => b.s - a.s);

/**
 * Per-target pipeline economics at a given per-target RAM share.
 *
 * plan.money is the money one batch takes (times hack chance); plan.ram is what
 * that batch holds; every op in the batch holds its RAM for one weakenTime.
 * So:
 *   rate   = money per ms per GB of RAM held  = money / (ram * weakenTime)
 *   satRam = the RAM at which the pipeline is full at the tightest legal
 *            period (4*spacing) = ram * weakenTime / (4*spacing)
 *   cap    = income at saturation = money / (4*spacing)
 * and income(share) = min(cap, rate * share), exactly the piecewise-linear the
 * batcher's own `period = max(4*spacing, weakenTime/floor(share/ram))` produces.
 */
function econ(x, share) {
  const plan = batchPlan(sim, x.t, { maxRam: share / minInFlight, margin: 1.1 });
  if (!plan) return null;
  const rate = plan.money / (plan.ram * plan.weakenTime);
  return {
    host: x.t.hostname,
    score: x.s,
    plan,
    rate,
    satRam: (plan.ram * plan.weakenTime) / (4 * spacing),
    cap: plan.money / (4 * spacing),
    income: (sh) => Math.min(plan.money / (4 * spacing), rate * sh),
  };
}

function incomeAt(totalRam, n) {
  const share = totalRam / n;
  let sum = 0;
  const parts = [];
  for (let i = 0; i < n && i < ranked.length; i++) {
    const e = econ(ranked[i], share);
    if (!e) continue;
    const inc = e.income(share);
    parts.push({ host: e.host, inc, sat: share >= e.satRam });
    sum += inc;
  }
  return { total: sum, parts };
}

const fmt = (n) =>
  n >= 1e12 ? `$${(n / 1e12).toFixed(2)}t` : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}b` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}m` : `$${(n / 1e3).toFixed(1)}k`;

// ---------------------------------------------------------------------------
// CHECK — against the batcher that is running right now.
//
// `batch.js` reports its own plan and its own earnings per target in
// `.telemetry/batch.txt`, so the model can be held to both halves of what it
// claims, separately:
//
//   1. batch composition — GB per batch and $ per batch. This tests the
//      formulas and the inputs. If it passes, phi / chance / growth / hackTime
//      and the server's real stats are all right.
//   2. income — total $/s at the live fleet and live target count. This tests
//      the SCALE, which is the part no amount of source-reading catches, because
//      it lives in `cap = money/(4*spacing)`: the assumption that a pipeline
//      really does land one batch every 800ms.
//
// Splitting them is the point. A model can pass (1) and fail (2) badly, and
// then every "best n" below is an argmax of a curve with the wrong shape.
// ---------------------------------------------------------------------------
if (!has("no-check")) {
  console.log("=== CHECK: does this model reproduce the live batcher? ===");
  let bt = null;
  try {
    bt = measuredBatch();
  } catch (e) {
    console.log(`  ----  NOT CALIBRATED — ${e.message}`);
  }
  if (bt) {
    const live = await fetchSnapshot();
    const lsim = new Sim(live, { seed: 1 });
    lsim.nuke();
    // Compare at the level batch.txt was written at, not the one the save has
    // now — the level climbs a point every ~40s and a check that flaps is a
    // check that gets ignored.
    if (bt.hackingLevel) lsim.player.skills.hacking = bt.hackingLevel;
    const byHost = new Map([...lsim.targets()].map((t) => [t.hostname, t]));
    const liveShare = bt.fleetGb / bt.targets.length;
    let mGb = 0, lGb = 0, mPer = 0, lPer = 0, mInc = 0;
    console.log(
      `  live: ${bt.targets.length} targets, fleet ${(bt.fleetGb / 1e6).toFixed(2)}PB, share ${(liveShare / 1e3).toFixed(0)}GB, ` +
        `hacking ${live.player.hacking}, uptime ${(bt.uptimeSec / 3600).toFixed(2)}h`,
    );
    console.log("  host              batchGB model/live   $/batch model/live    period model/live");
    for (const T of bt.targets) {
      const t = byHost.get(T.host);
      if (!t) continue;
      const p = batchPlan(lsim, t, { maxRam: liveShare / minInFlight, margin: 1.1 });
      if (!p) continue;
      const inFlight = Math.max(1, Math.floor(liveShare / p.ram));
      const period = Math.max(4 * spacing, p.weakenTime / inFlight);
      mGb += p.ram;
      lGb += T.plan?.gb ?? 0;
      mPer += p.money;
      lPer += T.moneyPerBatch;
      mInc += p.money / (period / 1000);
      console.log(
        `  ${T.host.padEnd(16)} ${p.ram.toFixed(0).padStart(8)}/${String(T.plan?.gb ?? "?").padEnd(6)} ` +
          `${fmt(p.money).padStart(10)}/${fmt(T.moneyPerBatch).padEnd(10)} ` +
          `${(period / 1000).toFixed(2).padStart(7)}s/${T.periodSecMeasured.toFixed(2)}s`,
      );
    }
    checkWithin("batch RAM, summed over the live targets", mGb, lGb, 0.05, (x) => `${x.toFixed(0)}GB`);
    checkWithin("$ per batch, summed over the live targets", mPer, lPer, 0.1, fmt);
    checkWithin("total income at the live fleet", mInc, bt.dollarsPerSec, 0.15, (x) => `${fmt(x)}/s`);
    if (report("target-count") > 0) {
      console.log(
        "\n!! This model does not reproduce the live batcher's income. The per-target\n" +
          "!! economics are still usable; the ABSOLUTE rates and the argmax below are not,\n" +
          "!! because the error is in the saturation cap, which is what decides the argmax.\n",
      );
    }
  }
  console.log();
}

if (has("table")) {
  console.log("\nper-target economics at an unconstrained batch (share = Infinity)\n");
  console.log(
    "  " + "host".padEnd(20) + "h".padStart(5) + "g".padStart(7) + "batchGB".padStart(10) +
      "wkT(s)".padStart(8) + "f".padStart(7) + "$/batch".padStart(11) +
      "satRam(GB)".padStart(12) + "cap $/s".padStart(11) + "rate $/GB/s".padStart(13),
  );
  console.log("  " + "-".repeat(104));
  for (const x of ranked.slice(0, maxN)) {
    const e = econ(x, Infinity);
    if (!e) continue;
    const p = e.plan;
    console.log(
      "  " + e.host.padEnd(20) + String(p.h).padStart(5) + String(p.g).padStart(7) +
        p.ram.toFixed(0).padStart(10) + (p.weakenTime / 1000).toFixed(1).padStart(8) +
        p.f.toFixed(3).padStart(7) + fmt(p.money).padStart(11) +
        e.satRam.toFixed(0).padStart(12) + fmt(e.cap * 1000).padStart(11) +
        (e.rate * 1000).toFixed(1).padStart(13),
    );
  }
}

/**
 * The rejected model, for comparison: take ranked targets until their
 * saturation RAM covers the fleet. That is the right answer to a *different*
 * allocator — one that fills the best target to its cap and spills the surplus
 * (prior-art 9h). The batcher splits the fleet evenly instead, so this
 * overcounts whenever the tail targets are worth less than what the split costs
 * the head ones.
 */
function greedyCount(totalRam) {
  let sum = 0;
  for (let i = 0; i < ranked.length; i++) {
    const e = econ(ranked[i], Infinity);
    if (!e) continue;
    sum += e.satRam;
    if (sum >= totalRam) return i + 1;
  }
  return ranked.length;
}

console.log("\nmodel: income(n) = sum_i min( money_i/(4e), (totalRam/n) * money_i/(ram_i*weakenTime_i) )\n");
for (const fleet of fleets) {
  const rows = [];
  for (let n = 1; n <= Math.min(maxN, ranked.length); n++) rows.push({ n, ...incomeAt(fleet, n) });
  const best = rows.reduce((a, b) => (b.total > a.total ? b : a));
  console.log(
    `  fleet ${fleet.toLocaleString()}GB  ->  best n = ${best.n}` +
      `   (greedy-saturation model would say ${greedyCount(fleet)})`,
  );
  for (const r of rows) {
    const bar = "#".repeat(Math.round((r.total / best.total) * 40));
    console.log(
      `    n=${String(r.n).padStart(2)}  ${fmt(r.total * 1000).padStart(10)}/s  ` +
        `${(r.total / best.total * 100).toFixed(0).padStart(4)}%  ${bar}  ` +
        `sat:${r.parts.filter((p) => p.sat).length}/${r.parts.length}`,
    );
  }
  console.log();
}

// jsdom keeps the event loop alive after the work is done; run.mjs exits
// explicitly for the same reason. The exit code carries the calibration result
// so a failed CHECK cannot be scrolled past.
process.exit(failureCount() ? 1 : 0);
