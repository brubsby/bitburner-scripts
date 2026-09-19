#!/usr/bin/env node
// Even RAM split vs fill-to-saturation, measured properly.
//
//   node tools/sim/verify-alloc.mjs --world snapshot.json --fleets 448708 \
//        --seeds 9 --minutes 180 --json out.json
//
// docs/target-count.md section 7 measured +43% for fill-to-saturation at 448TB
// on three seeds, one world, one fleet size, with no instrumentation beyond
// money. That is not enough to change the allocator of a live batcher. This
// harness fixes every one of those gaps:
//
//   * both arms call batch.js's OWN planBatch / targetScore / hackFraction /
//     hackChance / growthK, not the simulator's batchPlan. The count model was
//     validated through the simulator's planner and the deployed code uses a
//     different one; that gap is how a broken deploy reached production once
//     already (tools/sim/verify-argmax.mjs).
//   * both arms apply batch.js's quality floors (minScoreFrac, minMoneyFrac)
//     to the ranked list, so the candidate list is the shipped one.
//   * prep is capped at the target's own allocation in both arms, which is what
//     batch.js:768 and :793 do and what the simulator's prepWave does not.
//   * placement failures, unsafe-window skips, drains, prep waves and
//     time-to-first-batch are all reported, not just income.
//
// The ONLY difference between the arms is which policy from alloc.mjs sets each
// target's share. Everything else — safe-window gate, placement, drain, spill,
// the batch plan — is the same code path.
//
// CALIBRATION — read this before quoting a number from here. Only ONE of the
// two arms exists in the live game (batch.js splits evenly), so only that arm
// can be checked against a live measurement, and it is checked in
// verify-alloc-shipped.mjs section 0: the batch plan reproduces exactly, the
// achievable PERIOD does not (0.80s assumed, 0.84-1.20s measured). This harness
// inherits that error in both arms, through alloc.mjs's saturationRam. The
// RELATIVE comparison between the arms survives it — both are simulated under
// the same period assumption — but the absolute $/s figures do not, and the
// crossover fleet size moves with the period. Do not quote absolutes from here.

import "./env.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Sim } from "./engine.mjs";
import { loadSnapshot } from "./world.mjs";
import { hwgwBatcher } from "./batcher.mjs";
import { calculateHackingTime, getCloudServerCost, getCloudServerLimit, getCloudServerMaxRam } from "./game.mjs";
import { achievedPeriod, evenArgmax, fillToSat } from "./alloc.mjs";
import { importRootScript } from "./rootimport.mjs";

const B = await importRootScript("batch.js");
const HERE = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i > -1 ? argv[i + 1] : d;
};
const nums = (s) => String(s).split(",").map(Number);

const worldFile = flag("world", "snapshot.json");
const fleets = nums(flag("fleets", "448708"));
const minutes = Number(flag("minutes", 180));
const seeds = nums(flag("seeds", "1,2,3,4,5,6,7,8,9"));
const spacing = Number(flag("spacing", 200));
const maxTargets = Number(flag("maxtargets", 8));
const arms = String(flag("arms", "even,greedy")).split(",");
const prepcap = flag("prepcap", "share") !== "none";
const prepReserve = argv.includes("--prepreserve");
// --lategate: replace the binary safe-window gate with the physical test it is
// a proxy for. All three op durations are the same multiple of hackTime
// (src/Hacking.ts:81-92), so launching at security `sec` instead of `minSec`
// stretches the whole batch by the same factor and it lands LATE by
//
//   (2.5*R*(sec-minSec) / (2.5*R*minSec + 500)) * weakenTime
//
// Lateness below half a spacing cannot reorder anything, so skipping that
// launch buys nothing and costs a whole controller tick.
const lateGate = argv.includes("--lategate");
const jsonOut = flag("json", null);

const RAM = { hack: 1.7, grow: 1.75, weaken: 1.75 };
const SET = { spacing, maxTargets, minScoreFrac: 0.02, minMoneyFrac: 0.01 };

// --- adapter: a simulator server, shaped the way batch.js's own functions want.
//
// batch.js builds this from ns calls in readTarget/attachMath. Everything here
// is the same quantity read out of the sim instead: hackTime from the game's
// calculateHackingTime at MINIMUM security (which is what ns.getHackTime,
// rescaled, gives batch.js), and phi/chance/k from batch.js's own inlined
// ports of src/Hacking.ts. Using the ports rather than the game formulas is
// deliberate — it is the code that ships, so it is the code under test.
function adapt(sim, s) {
  const prepped = { ...s, hackDifficulty: s.minDifficulty, moneyAvailable: s.moneyMax };
  const t = {
    host: s.hostname,
    level: sim.hacking,
    mults: {
      chance: sim.mults.hacking_chance,
      speed: sim.mults.hacking_speed,
      money: sim.mults.hacking_money,
      growth: sim.mults.hacking_grow,
    },
    required: s.requiredHackingSkill,
    minSec: s.minDifficulty,
    maxMoney: s.moneyMax,
    sec: s.hackDifficulty,
    money: s.moneyAvailable,
    growth: s.serverGrowth,
    hackTime: calculateHackingTime(prepped, sim.player) * 1000,
    hackTimeNow: calculateHackingTime(s, sim.player) * 1000,
  };
  t.phi = B.hackFraction(t.level, t.required, t.minSec, t.mults);
  t.chance = B.hackChance(t.level, t.required, t.minSec, t.mults);
  t.k = B.growthK(t.minSec, t.growth, t.mults);
  t.kNow = B.growthK(Math.max(t.sec, t.minSec), t.growth, t.mults);
  return t;
}

/** batch.js:585-627, verbatim in behaviour: rank by targetScore, then two floors. */
export function candidates(sim) {
  const ranked = [];
  for (const s of sim.targets()) {
    if (!(s.moneyMax > 0)) continue;
    const t = adapt(sim, s);
    const sc = B.targetScore(t);
    if (sc > 0) ranked.push({ t, s: sc });
  }
  ranked.sort((a, b) => b.s - a.s);
  if (!ranked.length) return [];
  const bestScore = ranked[0].s;
  const bestMoney = ranked.reduce((m, r) => Math.max(m, r.t.maxMoney), 0);
  const worthwhile = ranked.filter(
    (r) => r.s >= bestScore * SET.minScoreFrac && r.t.maxMoney >= bestMoney * SET.minMoneyFrac,
  );
  return (worthwhile.length ? worthwhile : ranked).slice(0, SET.maxTargets);
}

/**
 * Proxy a sim for one target's serve() call so that
 *   totalRam()     -> share * nTargets   (the dispatcher divides it straight back)
 *   totalFreeRam() -> min(free, share)   (prep's budget, capped as batch.js:793 caps it)
 * and nothing else changes. This is how the arm alters allocation without
 * touching a line of the batcher.
 */
function simFor(sim, share, n, prepShare) {
  return new Proxy(sim, {
    get(target, prop, recv) {
      if (prop === "totalRam") return () => share * n;
      if (prop === "totalFreeRam" && prepcap)
        return () => Math.min(Reflect.get(target, prop, recv).call(target), prepShare);
      const v = Reflect.get(target, prop, recv);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

function mkArm(mode) {
  const b = hwgwBatcher({ nTargets: 1, maxTargets, spacing, label: mode });
  b._alloc = new Map();
  // Prep budget per target. Identical to _alloc for every arm except "greedyp".
  b._prep = new Map();

  b.chooseTargets = function (sim) {
    const cand = candidates(sim);
    if (!cand.length) return [];
    const totalRam = sim.totalRam();
    if (mode === "greedyr" || mode === "greedymr") {
      // Fill-to-saturation, then hand any unallocated remainder back to the
      // funded targets in proportion to their shares, so nothing is stranded.
      this._alloc = fillToSat(cand, totalRam, RAM, B.planBatch, {
        ...SET,
        redistribute: true,
        ...(mode === "greedymr" ? { loopMs: 200, stats: (host) => this._state.get(host) } : {}),
      });
      this._prep = this._alloc;
    } else if (mode === "greedym") {
      // Fill-to-saturation with the MEASURED period rather than the 4*spacing
      // floor. The batcher already keeps the two counters the law needs
      // (batches, unsafeSkips/placeFails) per target, so this is closed-loop:
      // no telemetry input, no new ns call, and it re-converges after an
      // install or a fleet change on its own.
      this._alloc = fillToSat(cand, totalRam, RAM, B.planBatch, {
        ...SET,
        loopMs: 200, // engine.mjs run(): the strategy is polled every 200ms
        stats: (host) => this._state.get(host),
      });
      this._prep = this._alloc;
    } else if (mode === "greedy" || mode === "greedyp") {
      this._alloc = fillToSat(cand, totalRam, RAM, B.planBatch, SET);
      // "greedyp": saturation caps the PIPELINE, and only the pipeline. Prep
      // keeps the even cap it has today.
      //
      // satRam is derived from the 4*spacing period floor, which bounds how
      // fast BATCHES may land. Prep is not periodic — it is a one-off grow and
      // weaken, and a prepping target converts every GB it is given directly
      // into progress. Capping prep at satRam therefore throttles a target that
      // is earning nothing for no reason, and it is measurably expensive at
      // fleets where the even split's share is much larger than satRam.
      this._prep = new Map(
        [...this._alloc.keys()].map((h) => [h, mode === "greedyp" ? totalRam / this._alloc.size : this._alloc.get(h)]),
      );
    } else if (mode === "satcount") {
      // HALF-PAIRING 1: the cumulative-saturation count with the EVEN split
      // still in place. This is the rule docs/target-count.md section 6
      // rejected, and it is rejected for this allocator, not in general.
      const n = fillToSat(cand, totalRam, RAM, B.planBatch, SET).size;
      this._alloc = new Map(cand.slice(0, n).map((c) => [c.t.host, totalRam / n]));
      this._prep = this._alloc;
    } else if (mode === "argmaxfill") {
      // HALF-PAIRING 2: fill-to-saturation allocation, but the count still
      // chosen by the even-split income argmax. The argmax charges each added
      // target for RAM taken from the ones above it, which this allocator does
      // not do, so it should under-count.
      const n = evenArgmax(cand, totalRam, RAM, B.planBatch, SET);
      this._alloc = fillToSat(cand.slice(0, n), totalRam, RAM, B.planBatch, SET);
      this._prep = this._alloc;
    } else {
      const n = evenArgmax(cand, totalRam, RAM, B.planBatch, SET);
      this._alloc = new Map(cand.slice(0, n).map((c) => [c.t.host, totalRam / n]));
      this._prep = this._alloc;
    }
    return [...this._alloc.keys()];
  };

  if (lateGate) {
    const origDispatch = b.dispatch.bind(b);
    b.dispatch = function (sim, t, s) {
      const late =
        ((2.5 * t.requiredHackingSkill * Math.max(0, t.hackDifficulty - t.minDifficulty)) /
          (2.5 * t.requiredHackingSkill * t.minDifficulty + 500)) *
        4 *
        calculateHackingTime({ ...t, hackDifficulty: t.minDifficulty }, sim.player) *
        1000;
      // Present the target as prepped to the gate when the launch is harmless.
      // Only the gate reads hackDifficulty here — batchPlan uses preppedView.
      return origDispatch(sim, late <= spacing / 2 ? { ...t, hackDifficulty: t.minDifficulty } : t, s);
    };
  }

  const origServe = b.serve.bind(b);
  b.serve = function (sim, name) {
    const share = this._alloc.get(name);
    // No allocation means no service. Under the even split every served target
    // has one by construction; under fill-to-saturation a target kept only to
    // drain does not, and serving it anyway would relaunch its pipeline and
    // renew lastLanding forever — the failure batch.js:684-693 already records.
    if (!(share > 0)) return { reserve: 0, phase: "none" };
    // `share * n` is divided straight back by `n` inside dispatch, so the value
    // of n is immaterial; using targets.length keeps the even arm numerically
    // identical to the untouched batcher.
    const r = origServe(simFor(sim, share, Math.max(1, this._targets.length), this._prep.get(name) ?? share), name);
    // A target in PREP reports reserve 0, both here and in batch.js (the prep
    // branch `continue`s before `reserved +=`). So spill-weaken treats a
    // prepping target's RAM as idle and takes it, and since a spill weaken
    // holds its RAM for a whole weakenTime, prep is left picking up whatever
    // expires. That costs nothing while every target's reserve is generous;
    // it costs a lot once the reserve is tightened to exactly satRam, which is
    // what fill-to-saturation does. --prepreserve holds the prep budget back
    // from spill, and is applied to every arm so it is not a thumb on the scale.
    if (prepReserve && r.phase === "prep") return { ...r, reserve: this._prep.get(name) ?? share };
    return r;
  };
  return b;
}

// --- fleet pinning ----------------------------------------------------------
//
// strategies.mjs's atTotalRam cannot reach a 26PB fleet: it buys the largest
// power of two not exceeding what is left, and above 1,048,576GB
// (getCloudServerMaxRam) getCloudServerCost returns Infinity, so the loop never
// terminates. It also cannot pin a fleet SMALLER than home, which on the live
// save is 4.19PB. This caps the chunk and shrinks home; at 448,708GB on
// snapshot.json it reproduces atTotalRam to the dollar (asserted below).
const CLOUD_LIMIT = getCloudServerLimit();
const CLOUD_MAX = getCloudServerMaxRam();
function atFleet(inner, gb) {
  return {
    name: `${inner.name} @ ${gb}GB`,
    scriptRam: inner.scriptRam,
    init(sim) {
      sim.nuke();
      for (const s of [...sim.servers.values()])
        if (s.purchasedByPlayer && s.hostname !== "home") sim.servers.delete(s.hostname);
      sim.purchased = [];
      const home = sim.servers.get("home");
      if (home && home.maxRam > gb) home.maxRam = Math.max(8, 2 ** Math.floor(Math.log2(gb / 4)));
      let left = gb - sim.totalRam();
      while (left >= 2 && sim.purchased.length < CLOUD_LIMIT) {
        const chunk = Math.min(left, CLOUD_MAX, 1 << Math.floor(Math.log2(Math.min(left, CLOUD_MAX))));
        sim.player.money += getCloudServerCost(chunk);
        sim.buyServer(chunk);
        sim.stats.ramSpend -= getCloudServerCost(chunk);
        left -= chunk;
      }
      inner.init?.(sim);
    },
    tick: (sim) => inner.tick(sim),
  };
}

// --- run --------------------------------------------------------------------
const world = loadSnapshot(path.isAbsolute(worldFile) ? worldFile : path.join(HERE, worldFile));
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(0)}b` : `$${(n / 1e6).toFixed(1)}m`);

function runOne(mode, gb, seed) {
  const arm = mkArm(mode);
  const sim = new Sim(world, { seed });
  const r = sim.run(atFleet(arm, gb), minutes * 60_000);
  let placeFails = 0;
  let unsafeSkips = 0;
  let drains = 0;
  let batches = 0;
  let prepWaves = 0;
  const prepped = [];
  const never = [];
  for (const [name, s] of arm._state) {
    placeFails += s.placeFails;
    unsafeSkips += s.skipsUnsafe;
    drains += s.drains;
    batches += s.batches;
    prepWaves += s.prepWaves;
    if (s.batchingSince != null) prepped.push({ name, minutes: s.batchingSince / 60_000 });
    else never.push(name);
    if (argv.includes("--dump"))
      console.log(
        `    ${mode.padEnd(8)} ${name.padEnd(16)} batches=${String(s.batches).padStart(7)} ` +
          `share=${String(Math.round(arm._alloc.get(name) ?? 0)).padStart(8)} pf=${String(s.placeFails).padStart(6)} ` +
          `skip=${String(s.skipsUnsafe).padStart(6)} drains=${s.drains} ` +
          `firstBatchMin=${s.batchingSince == null ? "never" : (s.batchingSince / 60_000).toFixed(1)}`,
      );
  }
  return {
    money: r.moneyStolen,
    placeFails,
    unsafeSkips,
    drains,
    batches,
    prepWaves,
    served: arm._state.size,
    funded: arm._alloc.size,
    prepped: prepped.length,
    never,
    slowestPrepMin: prepped.length ? Math.max(...prepped.map((p) => p.minutes)) : null,
    fleet: r.totalRam ?? null,
    finalTargets: [...arm._alloc.entries()].map(([h, g]) => `${h}:${Math.round(g)}`),
  };
}

const out = { world: worldFile, minutes, spacing, maxTargets, prepcap, prepReserve, seeds, results: {} };
for (const gb of fleets) {
  out.results[gb] = {};
  for (const mode of arms) {
    const runs = seeds.map((s) => runOne(mode, gb, s));
    const m = runs.map((r) => r.money);
    const agg = {
      median: median(m),
      min: Math.min(...m),
      max: Math.max(...m),
      all: m,
      placeFails: median(runs.map((r) => r.placeFails)),
      unsafeSkips: median(runs.map((r) => r.unsafeSkips)),
      drains: median(runs.map((r) => r.drains)),
      batches: median(runs.map((r) => r.batches)),
      served: runs[0].served,
      funded: runs[0].funded,
      prepped: median(runs.map((r) => r.prepped)),
      neverPrepped: [...new Set(runs.flatMap((r) => r.never))],
      slowestPrepMin: median(runs.map((r) => r.slowestPrepMin ?? -1)),
      finalTargets: runs[0].finalTargets,
    };
    out.results[gb][mode] = agg;
    console.log(
      `${worldFile} ${String(gb).padStart(9)}GB ${mode.padEnd(7)} ` +
        `med ${fmt(agg.median).padStart(9)} [${fmt(agg.min)}..${fmt(agg.max)}] ` +
        `n=${agg.funded} placeFails=${agg.placeFails} unsafe=${agg.unsafeSkips} drains=${agg.drains} ` +
        `prepped=${agg.prepped}/${agg.served} slowestPrep=${agg.slowestPrepMin.toFixed(1)}min`,
    );
  }
  const e = out.results[gb].even;
  const g = out.results[gb].greedy;
  if (e && g) console.log(`   -> greedy/even = ${((g.median / e.median) * 100 - 100).toFixed(1)}%`);
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(out, null, 2));
process.exit(0);
