#!/usr/bin/env node
// Runs the PROPOSED allocator against batch.js's own exported functions, on the
// real worlds and on adversarial inputs, offline.
//
//   node tools/sim/verify-alloc-shipped.mjs
//
// Same reason verify-argmax.mjs exists: docs/target-count.md validated a model
// through the simulator's batchPlan, the deployed code calls batch.js's
// planBatch, and the gap between the two put a dead batcher in front of the
// user. Anything that is going to be pasted into batch.js gets exercised
// against batch.js's functions first.
//
// It asserts what a simulator cannot:
//   * no throw, on real target lists and on a target with phi ~ 1e-6
//   * terminates in well under one 200ms controller tick, at 26PB
//   * the allocation is self-consistent: every share holds at least one whole
//     batch, shares never exceed the fleet, and the induced period is the
//     4*spacing floor for every saturated target
//   * batch.js's inlined ports of src/Hacking.ts still agree with the game's
//     own formulas out of ~/Repos/bitburner
//
// It also prints the per-target economics table that section 3 of
// docs/allocator.md quotes.
//
// Section 0 is the calibration: batch.js is RUNNING, and it reports its own
// plan and its own earnings per target in `.telemetry/batch.txt`. Asserting the
// offline planner against that is the strongest check available anywhere in
// this repo — it is literally the same function, on the same targets, at the
// same level, with the live answer to compare against. Nothing below section 0
// is safe to act on if section 0 fails.

import "./env.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSnapshot, loadSnapshot } from "./world.mjs";
import { check, checkWithin, failureCount, measuredBatch, report, uncheckable } from "./calibrate.mjs";
import { evenArgmax, fillToSat, saturationRam } from "./alloc.mjs";
import {
  calculateHackingChance,
  calculateHackingTime,
  calculatePercentMoneyHacked,
  calculateServerGrowthLog,
} from "./game.mjs";

import { importRootScript } from "./rootimport.mjs";
// NOT a bare `await import("../../batch.js")` — that throws
// ERR_MODULE_NOT_FOUND on batch.js's `from 'status.js'` and killed this
// file at module load, so it checked nothing and said nothing.
const B = await importRootScript("batch.js");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argvFlag = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : null;
};
const RAM = { hack: 1.7, grow: 1.75, weaken: 1.75 };
const SET = { spacing: 200, maxTargets: 8, minScoreFrac: 0.02, minMoneyFrac: 0.01 };
const gbf = (g) => (g >= 1e6 ? `${(g / 1e6).toFixed(2)}PB` : g >= 1e3 ? `${(g / 1e3).toFixed(1)}TB` : `${g.toFixed(0)}GB`);
const $ = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}b` : `$${(n / 1e6).toFixed(1)}m`);

// check / checkWithin / report live in calibrate.mjs so that the calibration
// section and the invariant sections share one failure count and one exit code.

// --- build batch.js-shaped targets from a snapshot ---------------------------
function worldTargets(w) {
  const person = {
    skills: { hacking: w.player.hacking, intelligence: w.player.intelligence ?? 0 },
    mults: {
      hacking: 1, hacking_chance: 1, hacking_speed: 1, hacking_money: 1, hacking_grow: 1, hacking_exp: 1,
      ...(w.player.mults ?? {}),
    },
  };
  const mults = {
    chance: person.mults.hacking_chance,
    speed: person.mults.hacking_speed,
    money: person.mults.hacking_money,
    growth: person.mults.hacking_grow,
  };
  const out = [];
  for (const s of w.servers) {
    if (!s.hasAdminRights || !(s.moneyMax > 0)) continue;
    if (s.requiredHackingSkill > w.player.hacking) continue;
    const prepped = { ...s, hackDifficulty: s.minDifficulty, moneyAvailable: s.moneyMax };
    const t = {
      host: s.hostname,
      level: w.player.hacking,
      mults,
      required: s.requiredHackingSkill,
      minSec: s.minDifficulty,
      maxMoney: s.moneyMax,
      sec: s.hackDifficulty,
      money: s.moneyAvailable,
      growth: s.serverGrowth,
      hackTime: calculateHackingTime(prepped, person) * 1000,
      hackTimeNow: calculateHackingTime(s, person) * 1000,
    };
    t.phi = B.hackFraction(t.level, t.required, t.minSec, mults);
    t.chance = B.hackChance(t.level, t.required, t.minSec, mults);
    t.k = B.growthK(t.minSec, t.growth, mults);
    t.kNow = t.k;
    // The game's own formulas, for the port check below.
    t._gamePhi = calculatePercentMoneyHacked(prepped, person);
    t._gameChance = calculateHackingChance(prepped, person);
    t._gameK = calculateServerGrowthLog(prepped, 1, person, 1);
    out.push(t);
  }
  return out;
}

function rank(ts) {
  const ranked = ts.map((t) => ({ t, s: B.targetScore(t) })).filter((r) => r.s > 0).sort((a, b) => b.s - a.s);
  if (!ranked.length) return [];
  const bestScore = ranked[0].s;
  const bestMoney = ranked.reduce((m, r) => Math.max(m, r.t.maxMoney), 0);
  const w = ranked.filter((r) => r.s >= bestScore * SET.minScoreFrac && r.t.maxMoney >= bestMoney * SET.minMoneyFrac);
  return (w.length ? w : ranked).slice(0, SET.maxTargets);
}

// --- 0. CALIBRATION against the batcher that is running right now ------------
//
// Three things get asserted, in increasing order of how badly they have been
// got wrong before:
//
//   a. worker RAM. The simulator once priced threads at 1.7/1.75GB while the
//      supervisor deployed a 2.4GB worker — 30% too cheap, and every RAM-budget
//      conclusion built on it was wrong by that factor. So do not remember it;
//      ask the game's own calculateRam.
//   b. the batch plan. batch.js's planBatch, offline, against the plan batch.js
//      chose in-game for the same target at the same level.
//   c. the achievable PERIOD. This is the one the allocator turns on:
//      `saturationRam` assumes a saturated pipeline lands a batch every
//      4*spacing = 800ms, and satRam scales linearly with that assumption. If
//      the controller cannot actually hit 800ms, every satRam is too small and
//      fillToSat spreads over too many targets.
console.log("\n0. CALIBRATION — batch.js offline vs batch.js in the live game");
let bt = null;
try {
  bt = measuredBatch();
} catch (e) {
  uncheckable("live batcher", e.message);
}
if (bt) {
  const { liveWorkerRam } = await import("./calibrate.mjs");
  const liveRam = await liveWorkerRam();
  check(
    Math.abs(liveRam.hack - RAM.hack) < 1e-9 && Math.abs(liveRam.grow - RAM.grow) < 1e-9 && Math.abs(liveRam.weaken - RAM.weaken) < 1e-9,
    `worker RAM: this file uses ${RAM.hack}/${RAM.grow}/${RAM.weaken}, the game prices h.js/g.js/w.js at ${liveRam.hack}/${liveRam.grow}/${liveRam.weaken}`,
  );

  const live = await fetchSnapshot();
  // Compare at the level batch.txt was WRITTEN at, not the level the save has
  // now. The controller re-plans every few seconds and the level climbs a point
  // every ~40s, so a fresh read disagrees with the reported plan by a thread or
  // two purely because of the gap between the two reads — which would make this
  // check flap and get ignored, the worst possible outcome for a calibration.
  live.player.hacking = bt.hackingLevel ?? live.player.hacking;
  const byHost = new Map(worldTargets(live).map((t) => [t.host, t]));
  const share = bt.ram.total / bt.targets.length;
  console.log(
    `   live: ${bt.targets.length} targets, fleet ${gbf(bt.ram.total)}, share ${gbf(share)}, ` +
      `hacking ${live.player.hacking}, uptime ${(bt.uptimeSec / 3600).toFixed(2)}h`,
  );
  console.log("   host               h  g  w1 w2   gb model/live     $/batch model/live      period");
  let planMatches = 0;
  let planned = 0;
  let mGb = 0, lGb = 0, mMoney = 0, lMoney = 0;
  const periods = [];
  for (const T of bt.targets) {
    const t = byHost.get(T.host);
    if (!t || !T.plan) continue;
    const p = B.planBatch(t, RAM, share / 4);
    planned++;
    const same = p.h === T.plan.h && p.g === T.plan.g && p.w1 === T.plan.w1 && p.w2 === T.plan.w2;
    if (same) planMatches++;
    mGb += p.gb;
    lGb += T.plan.gb;
    mMoney += p.money;
    lMoney += T.moneyPerBatch;
    periods.push(T.periodSecMeasured);
    console.log(
      `   ${T.host.padEnd(16)} ${String(p.h).padStart(3)}${String(p.g).padStart(4)}${String(p.w1).padStart(4)}${String(p.w2).padStart(3)}  ` +
        `${p.gb.toFixed(0).padStart(5)}/${String(T.plan.gb).padEnd(6)} ${$(p.money).padStart(9)}/${$(T.moneyPerBatch).padEnd(9)} ` +
        `${T.periodSecMeasured.toFixed(2)}s${same ? "" : "   <- plan differs"}`,
    );
  }
  check(planMatches === planned, `planBatch reproduces the live plan exactly on ${planMatches}/${planned} targets`);
  checkWithin("batch RAM summed over live targets", mGb, lGb, 0.02, (x) => gbf(x));
  checkWithin("$/batch summed over live targets", mMoney, lMoney, 0.1, $);
  // The realized period, against the floor saturationRam assumes.
  const floor = (4 * SET.spacing) / 1000;
  const worstPeriod = Math.max(...periods);
  checkWithin(
    `achievable period vs the ${floor}s floor saturationRam assumes (worst of ${periods.length} targets)`,
    floor,
    worstPeriod,
    0.15,
    (x) => `${x.toFixed(2)}s`,
  );
  console.log(
    `   measured periods ${Math.min(...periods).toFixed(2)}s..${worstPeriod.toFixed(2)}s; ` +
      `satRam and every cap below are computed at ${floor}s and are therefore optimistic by up to ` +
      `${(((worstPeriod / floor) - 1) * 100).toFixed(0)}%.`,
  );
}

// --- 1. the inlined ports still match the game -------------------------------
console.log("\n1. batch.js's inlined src/Hacking.ts ports vs the game's own formulas");
for (const f of ["snapshot.json", "snapshot-live.json"]) {
  const w = loadSnapshot(path.join(HERE, f));
  const ts = worldTargets(w);
  let worst = 0;
  let worstWhat = "";
  for (const t of ts) {
    for (const [a, b, what] of [
      [t.phi, t._gamePhi, "phi"],
      [t.chance, t._gameChance, "chance"],
      [t.k, t._gameK, "k"],
    ]) {
      const rel = b === 0 ? (a === 0 ? 0 : 1) : Math.abs(a - b) / Math.abs(b);
      if (rel > worst) {
        worst = rel;
        worstWhat = `${t.host}.${what} port=${a} game=${b}`;
      }
    }
  }
  check(worst < 1e-9, `${f}: ${ts.length} targets, worst relative error ${worst.toExponential(2)} ${worstWhat}`);
}

// --- 2. per-target economics, both worlds ------------------------------------
for (const f of ["snapshot.json", "snapshot-live.json"]) {
  const w = loadSnapshot(path.join(HERE, f));
  const cand = rank(worldTargets(w));
  console.log(`\n2. ${f} (hacking ${w.player.hacking}) — top ${cand.length} by targetScore, eps=${SET.spacing}`);
  console.log("   host              batch GB   weakenT      $/batch     satRam     cap $/s   rate $/GB/s");
  let cum = 0;
  for (const { t } of cand) {
    const p = B.planBatch(t, RAM, Infinity);
    const wt = 4 * t.hackTime;
    const sat = saturationRam(p, t.hackTime, SET.spacing);
    cum += sat;
    const cap = p.money / (4 * SET.spacing / 1000);
    const rate = p.money / (p.gb * (wt / 1000));
    console.log(
      `   ${t.host.padEnd(16)} ${String(Math.round(p.gb)).padStart(8)} ${(wt / 1000).toFixed(1).padStart(9)}s ` +
        `${$(p.money).padStart(12)} ${gbf(sat).padStart(10)} ${$(cap).padStart(11)} ${rate.toFixed(0).padStart(13)}`,
    );
  }
  console.log(`   cumulative saturation over these ${cand.length}: ${gbf(cum)}`);
}

// --- 3. the allocator on real worlds, every fleet size -----------------------
const FLEETS = [32768, 98304, 448708, 1.6e6, 6.4e6, 26.2e6];
for (const f of ["snapshot.json", "snapshot-live.json"]) {
  const w = loadSnapshot(path.join(HERE, f));
  const cand = rank(worldTargets(w));
  console.log(`\n3. ${f}: fillToSat vs evenArgmax`);
  for (const totalRam of FLEETS) {
    const t0 = process.hrtime.bigint();
    const shares = fillToSat(cand, totalRam, RAM, B.planBatch, SET);
    const us = Number(process.hrtime.bigint() - t0) / 1000;
    const n = evenArgmax(cand, totalRam, RAM, B.planBatch, SET);
    const sum = [...shares.values()].reduce((a, b) => a + b, 0);
    // Invariants.
    let ok = sum <= totalRam + 1e-6 && shares.size >= 1;
    let periodsAtFloor = 0;
    for (const [host, gb] of shares) {
      const t = cand.find((c) => c.t.host === host).t;
      const p = B.planBatch(t, RAM, gb / 4);
      if (gb < p.gb) ok = false;
      const maxInFlight = Math.max(1, Math.floor(gb / p.gb));
      const period = Math.max(4 * SET.spacing, (4 * t.hackTime) / maxInFlight);
      if (period <= 4 * SET.spacing + 1e-9) periodsAtFloor++;
    }
    console.log(
      `   ${gbf(totalRam).padStart(7)}  fill n=${shares.size} (${periodsAtFloor} saturated, ` +
        `${((sum / totalRam) * 100).toFixed(0)}% of fleet allocated, ${us.toFixed(0)}us)   even n=${n}`,
    );
    check(ok, `${gbf(totalRam)} invariants (shares <= fleet, every share holds a batch)`);
    check(us < 20000, `${gbf(totalRam)} allocator cost ${us.toFixed(0)}us < 20ms`);
  }
}

// --- 4. adversarial: phi -> 0, huge hMax, absurd fleet -----------------------
console.log("\n4. adversarial targets (verify-argmax.mjs's list, phi ~ 1e-6)");
const LEVEL = 2296;
const mults = { chance: 1.6, speed: 1.6, money: 1.68, growth: 1.46 };
const mk = (name, required, minSec, growth, maxMoney, hackTime) => {
  const t = { host: name, level: LEVEL, required, minSec, maxMoney, growth, hackTime, sec: minSec, money: maxMoney, mults };
  t.phi = B.hackFraction(LEVEL, required, minSec, mults);
  t.chance = B.hackChance(LEVEL, required, minSec, mults);
  t.k = B.growthK(minSec, growth, mults);
  t.kNow = t.k;
  return t;
};
const adv = rank([
  mk("ecorp", 1050, 33, 50, 1.5e12, 25000),
  mk("megacorp", 1040, 33, 50, 1.4e12, 24000),
  mk("kuai-gong", 1030, 32, 55, 1.3e12, 23000),
  mk("4sigma", 500, 18, 60, 1.6e11, 9000),
  mk("clarkinc", 520, 19, 60, 1.5e11, 9500),
  mk("barely-hackable", LEVEL - 2, 90, 5, 5e11, 40000),
  mk("n00dles", 1, 1, 5, 1.75e6, 900),
]);
for (const totalRam of [2, 64, 1024, 32768, 448708, 26.2e6, 1e9]) {
  const t0 = process.hrtime.bigint();
  let shares;
  let threw = null;
  try {
    shares = fillToSat(adv, totalRam, RAM, B.planBatch, SET);
  } catch (e) {
    threw = e;
  }
  const us = Number(process.hrtime.bigint() - t0) / 1000;
  const sum = shares ? [...shares.values()].reduce((a, b) => a + b, 0) : 0;
  check(
    !threw && shares.size >= 1 && sum <= totalRam + 1e-6 && us < 200000,
    `fleet ${gbf(totalRam)}: n=${shares?.size} sum=${gbf(sum)} ${us.toFixed(0)}us${threw ? ` THREW ${threw}` : ""}`,
  );
}

// --- 5. transcription check against a patched batch.js -----------------------
//
//   node tools/sim/verify-alloc-shipped.mjs --patched ../../batch.js
//
// alloc.mjs is what was validated; the patch in docs/allocator.md section 9 is a
// hand transcription of it into main()'s call site. Hand transcription is
// exactly how the argmax deploy went wrong. This lifts the allocator loop back
// OUT of a patched batch.js by text, runs it, and asserts it returns the same
// Map as fillToSat on every world and fleet size. Run it after applying the
// patch and before restarting the controller.
const patchedPath = argvFlag("patched");
if (patchedPath) {
  const src = fs.readFileSync(path.resolve(HERE, patchedPath), "utf8");
  // Start at periodFloor, which the loop below closes over.
  const begin = src.indexOf("          const periodFloor =");
  const end = src.indexOf("          want = [...shares.keys()]");
  console.log(`\n5. allocator loop lifted out of ${patchedPath}`);
  if (begin < 0 || end < 0 || end < begin) {
    check(false, "could not find the allocator loop (markers `const periodFloor =` .. `want = [...shares.keys()]`)");
  } else {
    const body = src.slice(begin, end);
    // eslint-disable-next-line no-new-func
    const lifted = new Function("cand", "totalRam", "ram", "planBatch", "SETTINGS", "S", `let shares;\n${body}\nreturn shares`);
    const SETL = { ...SET, loopMs: 200 };
    for (const f of ["snapshot.json", "snapshot-live.json"]) {
      const cand = rank(worldTargets(loadSnapshot(path.join(HERE, f))));
      // Two states, because the loop has two paths: a cold controller (no
      // counters yet, so it must fall back to the 4*spacing floor) and a warm
      // one (measured period). A transcription that silently dropped the
      // measured branch would pass the cold check alone.
      const cold = new Map();
      const warm = new Map(
        cand.map((c, i) => [c.t.host, { batches: 1000, unsafeSkips: 100 * (i + 1), placeFails: 13 * i }]),
      );
      for (const [label, S, opts] of [
        ["cold", cold, SET],
        ["warm", warm, { ...SETL, stats: (h) => warm.get(h) }],
      ]) {
        for (const totalRam of FLEETS) {
          const mine = fillToSat(cand, totalRam, RAM, B.planBatch, opts);
          const theirs = lifted(cand, totalRam, RAM, B.planBatch, { ...SET, loopMs: 200 }, S);
          const same =
            theirs instanceof Map &&
            theirs.size === mine.size &&
            [...mine].every(([h, g]) => Math.abs((theirs.get(h) ?? -1) - g) < 1e-6);
          check(same, `${f} ${label} ${gbf(totalRam)}: patched loop == fillToSat (n=${mine.size})`);
        }
      }
    }
  }
}

report("verify-alloc-shipped");
process.exit(failureCount() ? 1 : 0);
