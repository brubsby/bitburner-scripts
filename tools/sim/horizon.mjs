// Which hacking controller to run, decided by minimum time to leave the BitNode.
//
//   node tools/sim/horizon.mjs              live decision + every calibration
//   node tools/sim/horizon.mjs --json       the same, machine readable
//   node tools/sim/horizon.mjs --floor 0.5  counterfactual: seed.js at another floor
//
// ---------------------------------------------------------------------------
// WHAT THIS IS
// ---------------------------------------------------------------------------
//
// `seed.js`+`early.js` and `batch.js` are two controls of one control problem.
// Choosing between them by "which earns more right now" scores a capital
// investment as an operating loss — the error CLAUDE.md records under "the
// simulator scored end-of-run cash". Choosing by "cumulative dollars over a
// horizon" is better but still wrong, because dollars are not the objective:
//
//   **The objective is time to leave the BitNode.** Money, experience, fleet
//   RAM, rooted servers, port programs and home RAM are all instrumental. Each
//   is worth exactly how much it shortens that time.
//
// So this file solves a minimum-time control problem, coarsely, in closed form
// where one exists. Sections:
//
//   0  live inputs, and the BitNode multipliers                     [CHECK]
//   1  the terminal condition, and what it says about experience
//   2  the two controllers as rate models                           [CHECK]
//   3  the regime ladder: where the piecewise-stationary model breaks
//   4  shadow prices, and therefore the price of experience
//   5  the decision, and the break-even that flips it
//
// ---------------------------------------------------------------------------
// CALIBRATION — read this before using any number below
// ---------------------------------------------------------------------------
//
// CALIBRATED: the `early.js` rate model, by INTEGRATION over the whole recorded
// life rather than against a single window. Section 2c walks every sample in
// `history.jsonl` since the last prestige, rebuilds the fleet at each one from
// the recorded rooted count, replays `seed.js`'s own placement, and advances a
// per-target money state; the cumulative dollars and cumulative experience are
// then compared to what the game recorded. The error is printed for every fleet
// phase, pass or fail. The assertion is taken on the longest phase — 389 minutes
// and 85% of the samples — because that is the only stretch of this life in
// which `early.js` is documented to have been the sole controller.
//
// NOT CALIBRATED: the `batch.js` rate model and its prep cost. `batch.js` has
// never landed a batch in this life — `.telemetry/batch.txt` reports
// `batches: 0` — and its one recorded run is not a measurement of anything: it
// dispatched 9 operations in 482 seconds, at 97% reported fleet utilisation,
// because `seed.js --watch` was re-seeding `early.js` underneath it every 60s.
// The batch arm is computed from the game's own formulas and from `batch.js`'s
// own exported `planBatch`, with no live anchor. Section 5 reports how far wrong
// it would have to be to change the decision, which is the only honest thing to
// do with an uncalibrated arm.
//
// NOT CALIBRATED: the `--floor` counterfactual in section 6, though less badly
// than it looks — see the note printed there.
//
// ALSO NOT CALIBRATED, and not calibratable: nothing here models the `share.js`
// reputation channel, coding contracts, or anything the player does by hand.
// Live money includes all of them, which is why the life-total comparison in
// section 2c is printed and deliberately NOT asserted.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import game, {
  calculateGrowTime,
  calculateHackingChance,
  calculateHackingExpGain,
  calculateHackingTime,
  calculatePercentMoneyHacked,
  calculateServerGrowthLog,
  calculateSkill,
  calculateExp,
  calculateWeakenTime,
  getCoreBonus,
  getWeakenEffect,
  numCycleForGrowthCorrected,
  ServerConstants,
  currentNodeMults,
  DarkWebItems,
} from "./game.mjs";
import { fetchSnapshot } from "./world.mjs";
import { check, checkWithin, report, uncheckable, TELEMETRY, CTL_PORT } from "./calibrate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const JSONOUT = process.argv.includes("--json");
const argOf = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const say = (...a) => {
  if (!JSONOUT) console.log(...a);
};
// calibrate.mjs's check/checkWithin/report print with console.log, which would
// corrupt --json's stdout. They are diverted to stderr rather than silenced:
// "I could not tell" must never be quieter than "it is fine" (CLAUDE.md).
const realLog = console.log;
if (JSONOUT) console.log = (...a) => console.error(...a);
const emitJson = (o) => {
  console.log = realLog;
  realLog(JSON.stringify(o, null, 2));
};
const $ = (n) =>
  !isFinite(n)
    ? "$inf"
    : Math.abs(n) >= 1e9
      ? `$${(n / 1e9).toFixed(2)}b`
      : Math.abs(n) >= 1e6
        ? `$${(n / 1e6).toFixed(2)}m`
        : Math.abs(n) >= 1e3
          ? `$${(n / 1e3).toFixed(1)}k`
          : `$${n.toFixed(1)}`;
const hms = (s) =>
  !isFinite(s)
    ? "never"
    : s >= 86400
      ? `${(s / 86400).toFixed(1)}d`
      : s >= 3600
        ? `${(s / 3600).toFixed(1)}h`
        : s >= 60
          ? `${(s / 60).toFixed(1)}min`
          : `${s.toFixed(0)}s`;

// ===========================================================================
// 0. LIVE INPUTS
// ===========================================================================

/** Every sample the daemon has appended, oldest first. */
function history() {
  const p = path.join(TELEMETRY, "history.jsonl");
  if (!fs.existsSync(p)) throw new Error(`no live measurement: ${p} missing`);
  const out = [];
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line);
      if (d.totalPlaytime) out.push(d);
    } catch {
      /* a partially flushed last line */
    }
  }
  return out;
}

/**
 * Only the samples since the most recent prestige.
 *
 * `.telemetry/*` survives an install (invariant A14), so "this life" has to be
 * established from a signal inside the data rather than assumed:
 * `playtimeSinceLastAug` is monotone within a life and resets at one.
 */
function thisLife(rows = history()) {
  let start = 0;
  for (let i = 1; i < rows.length; i++) if (rows[i].playtimeSinceLastAug < rows[i - 1].playtimeSinceLastAug) start = i;
  return rows.slice(start);
}

/**
 * `batch.js`'s own exported functions, loaded from the shipped file.
 *
 * A plain `await import("../../batch.js")` throws — `batch.js` imports
 * `status.js` by bare specifier and node has no such package. That is exactly
 * the invariant-B5 shape ("a test that stops testing and still reports green"),
 * and it is why `verify-alloc-shipped.mjs` currently dies at module load. Here
 * the ONLY edit is the module specifier, rewritten to a file URL; the count of
 * rewrites is asserted so a future change to batch.js's imports cannot silently
 * turn this into a transcription.
 */
async function loadShipped(file) {
  const src = fs.readFileSync(path.join(REPO, file), "utf8");
  const re = /from (["'])([A-Za-z0-9_./-]+\.js)\1/g;
  const n = (src.match(re) || []).length;
  const rewritten = src.replace(re, (_m, _q, f) => `from ${JSON.stringify(pathToFileURL(path.join(REPO, f)).href)}`);
  const mod = await import("data:text/javascript;base64," + Buffer.from(rewritten).toString("base64"));
  return { mod, rewrites: n };
}

/** Script RAM as the GAME prices it. Read-only over the control port. */
async function liveScriptRam(files) {
  const out = {};
  for (const f of files) {
    const res = await fetch(`http://localhost:${CTL_PORT}/rpc`, {
      method: "POST",
      body: JSON.stringify({ method: "calculateRam", params: { filename: f, server: "home" } }),
    });
    const { result, error } = await res.json();
    if (error) throw new Error(`calculateRam ${f}: ${error}`);
    out[f] = result;
  }
  return out;
}

// ===========================================================================
// SERVER / PERSON SHAPES
// ===========================================================================

/**
 * A server object the game's own formulas accept, at a chosen security and
 * money. `baseDifficulty` is carried through untouched because
 * `calculateHackingExpGain` reads it and it is NOT the current difficulty.
 */
const at = (s, { difficulty = s.hackDifficulty, money = s.moneyAvailable } = {}) => ({
  ...s,
  hackDifficulty: difficulty,
  moneyAvailable: money,
  hasAdminRights: true,
});

const person = (player) => ({
  skills: { hacking: player.hacking, intelligence: player.intelligence ?? 0 },
  mults: player.mults,
  hackExp: player.hackExp,
});

/** hacking level multiplier: the player's own times the BitNode's. */
const levelMult = (player) => player.mults.hacking * currentNodeMults.HackingLevelMultiplier;

/** calculateSkill inverted (skill.ts:21). */
const expForLevel = (L, m) => Math.exp((L / m + 200) / 32) - 534.6;

// ===========================================================================
// 2a. early.js AS A RATE MODEL
// ===========================================================================
//
// early.js is a strict priority ladder run by N threads on one host:
//
//     if   sec   > minSec + SLACK   -> weaken(N)
//     elif money < FLOOR * maxMoney -> grow(N)
//     else                          -> hack(N)
//
// It is NOT a scheduler, so there is no plan to read. But whatever order it
// runs the three operations in, a steady state must conserve both the server's
// money and its security. Those two conservation laws plus the RAM budget
// determine the thread-rates uniquely, and the rates are all we need.
//
// Let h, g, w be thread-rates (threads x ops per second) against one target,
// and m the money the server holds while it is being hacked.
//
//   money      c*phi*m*h = (k*m_g + 1)*g          hack drains phi*m per thread
//                                                 (NetscriptHelpers.tsx:630),
//                                                 grow adds (m+n)*e^(k n) - m
//                                                 ~ m*k*n + n (grow.ts:37-46)
//   security   0.002*h + 0.004*g = 0.05*cb*w      Constants.ts ServerFortifyAmount,
//                                                 getWeakenEffect
//   RAM        r*(h*T_h + g*T_g + w*T_w) = R      duration is charged at launch
//
// with T_g = 3.2*T_h and T_w = 4*T_h (Hacking.ts:78-95). Solving,
//
//   beta  = g/h = c*phi*m / (k*m_g + 1)
//   gamma = w/h = (0.002 + 0.004*beta) / (0.05*cb)
//   h     = R / (r * T_h * (1 + 3.2*beta + 4*gamma))
//
//   $/sec   = c * phi * m * h
//   exp/sec = e * (h*q + g + w),   q = c + (1-c)/4
//
// q is the hack experience derating: a failed hack still pays a quarter
// (NetscriptHelpers.tsx:618-619), and grow and weaken pay in full
// (NetscriptFunctions.ts:291, :365). Dropping q, as every naive index does,
// overstates experience on a low-chance target by up to 4x.
//
// TWO THINGS THE MODEL READS RATHER THAN ASSUMES.
//
// * The operating security. The loop's deadband is `minSec + SECURITY_SLACK`,
//   but where inside the deadband it actually sits depends on how many hosts
//   share the target and how much one weaken overshoots. The live save answers
//   directly: every server under early.js reads minSec + 4.3 .. minSec + 5.0.
//   So `slack` is MEASURED from the save, not taken from early.js's constant.
//
// * The operating money. Same: the save shows every drained target at exactly
//   5.0% of maxMoney, which is `seed.js --floor 0.05`. For counterfactual
//   floors the model computes it, with the overshoot term below.
//
// THE OVERSHOOT TERM. The loop grows until money >= floor*maxMoney and then
// hacks, so on a low-growth target money sits at the floor. On a high-growth
// one a single grow op of N threads multiplies money by e^(k*N), which can jump
// straight to maxMoney — n00dles (serverGrowth 3000) sits at 30% against a 5%
// floor for exactly this reason. Money then decays geometrically back to the
// floor, and the time-average of a geometric decay is the LOGARITHMIC mean
// (m1 - m0)/ln(m1/m0), which is what `equilibriumMoney` returns.

export const SECURITY_SLACK_DEFAULT = 5; // early.js:30
export const FORTIFY = ServerConstants.ServerFortifyAmount;

/**
 * Money the target holds on average under early.js, and the money it holds
 * when a grow lands (which is what sizes the grow side of the balance).
 */
export function equilibriumMoney(s, personObj, { floor, perHostThreads, cores = 1, difficulty }) {
  const m0 = Math.min(s.moneyMax, floor * s.moneyMax);
  const k = calculateServerGrowthLog(at(s, { difficulty }), 1, personObj, cores);
  const m1 = Math.min(s.moneyMax, m0 * Math.exp(k * Math.max(1, perHostThreads)));
  const mean = m1 > m0 * 1.0000001 ? (m1 - m0) / Math.log(m1 / m0) : m0;
  return { hackMean: mean, growAt: m0, peak: m1 };
}

/**
 * Rates for ONE target served by `ramGb` of early.js threads.
 *
 * `perHostThreads` only enters through the overshoot term; the balance itself
 * is per-thread and so is independent of how the RAM is split across hosts.
 */
export function earlyTargetRate(
  s,
  personObj,
  { ramGb, floor, slack, ramPerThread, cores = 1, difficulty = null, money = null },
) {
  const D = difficulty ?? Math.min(99, s.minDifficulty + slack);
  const perHost = Math.max(1, Math.floor(ramGb / ramPerThread));
  const eq = equilibriumMoney(s, personObj, { floor, perHostThreads: perHost, cores, difficulty: D });
  const mHack = money ?? eq.hackMean;
  const mGrow = money ?? eq.growAt;

  const sv = at(s, { difficulty: D, money: mHack });
  const T = calculateHackingTime(sv, personObj);
  const phi = calculatePercentMoneyHacked(sv, personObj);
  const c = calculateHackingChance(sv, personObj);
  const k = calculateServerGrowthLog(sv, 1, personObj, cores);
  const e = calculateHackingExpGain(sv, personObj);
  const cb = getCoreBonus(cores);

  if (!(phi > 0) || !(T > 0) || !(s.moneyMax > 0)) {
    return { host: s.hostname, ramGb, dollarsPerSec: 0, expPerSec: 0, phi, chance: c, T, beta: 0, gamma: 0, money: mHack };
  }

  // beta is 0 when growth cannot keep up at all (k = 0, a no-growth server):
  // the loop then drains it once and the steady state is zero income.
  // calculateGrowMoney caps at moneyMax (grow.ts:48-56), so a grow op whose
  // e^(k*N) would overshoot the cap wastes the threads past it. That is the
  // term that stops "raise the floor" from being free all the way to 100%:
  // headroom is ln(moneyMax/m)/k threads, and once the per-host thread count
  // exceeds it, restoring a dollar costs proportionally more grow.
  const headroom = k > 0 ? Math.log(s.moneyMax / Math.max(1, mGrow)) / k : Infinity;
  const growWaste = headroom > 0 && perHost > headroom ? perHost / headroom : 1;
  const beta = k > 0 ? ((c * phi * mHack) / (k * mGrow + 1)) * growWaste : Infinity;
  if (!isFinite(beta)) {
    return { host: s.hostname, ramGb, dollarsPerSec: 0, expPerSec: 0, phi, chance: c, T, beta, gamma: 0, money: mHack };
  }
  const gamma = (FORTIFY + 2 * FORTIFY * beta) / (getWeakenEffect(1, cores) / 1) / 1;
  // getWeakenEffect(1, cores) already carries the core bonus and the BitNode's
  // ServerWeakenRate, so no separate cb term here.
  const h = ramGb / (ramPerThread * T * (1 + 3.2 * beta + 4 * gamma));
  const q = c + (1 - c) / 4;

  return {
    host: s.hostname,
    ramGb,
    perHostThreads: perHost,
    difficulty: D,
    money: mHack,
    phi,
    chance: c,
    k,
    T,
    beta,
    gamma,
    threadsHack: h,
    dollarsPerSec: c * phi * mHack * h,
    expPerSec: e * (h * q + beta * h + gamma * h),
    cb,
  };
}

/**
 * seed.js's placement, reproduced exactly (seed.js:131-193).
 *
 * Hosts sorted by maxRam descending, targets by maxMoney descending, paired by
 * INDEX with wraparound; home keeps `homereserve` GB free. This matters: it is
 * what decides that the biggest host works the richest server, and a model that
 * pooled the fleet would get a different — and wrong — answer.
 */
export function seedPlan(servers, player, { ramPerThread, homeReserve = 12, homeUsedByOthers = 0, target = null }) {
  const level = player.hacking;
  const rooted = servers.filter((s) => s.hasAdminRights);
  const targets = rooted
    .filter((s) => s.moneyMax > 0 && s.requiredHackingSkill <= level)
    .sort((a, b) => b.moneyMax - a.moneyMax);
  const hosts = rooted.slice().sort((a, b) => b.maxRam - a.maxRam);
  if (!targets.length) return { assign: new Map(), targets, hosts, totalThreads: 0 };

  const assign = new Map();
  let totalThreads = 0;
  for (let i = 0; i < hosts.length; i++) {
    const h = hosts[i];
    const t = target ? targets.find((x) => x.hostname === target) : targets[i % targets.length];
    if (!t) continue;
    const reserve = h.hostname === "home" ? homeReserve + homeUsedByOthers : 0;
    const free = h.maxRam - reserve;
    const threads = Math.floor(free / ramPerThread);
    if (threads < 1) continue;
    totalThreads += threads;
    const cur = assign.get(t.hostname) ?? [];
    cur.push({ host: h.hostname, threads, gb: threads * ramPerThread, cores: h.cpuCores ?? 1 });
    assign.set(t.hostname, cur);
  }
  return { assign, targets, hosts, totalThreads };
}

/**
 * Seconds before a target under early.js starts paying at the modelled rate.
 *
 * early.js is usually described as having no setup cost, and at the floor it is
 * running at it does not. That is only true because the floor is BELOW where
 * the targets already sit. Raise the floor and the loop's `grow` branch has to
 * lift the balance first, earning nothing on that target while it does — which
 * is the same shape of investment `batch.js` makes, just smaller. Charging it
 * is the difference between an honest comparison and the one this file exists
 * to replace.
 *
 * Below the floor every thread grows (the ladder's `grow` branch), so money
 * rises as e^(k*g*t) and the ramp is ln(target/now)/(k*g).
 */
export function earlyRampSeconds(s, personObj, { ramGb, floor, slack, ramPerThread, cores = 1 }) {
  const want = floor * s.moneyMax;
  const have = Math.max(1, s.moneyAvailable);
  if (have >= want) return 0;
  const D = Math.min(99, s.minDifficulty + slack);
  const sv = at(s, { difficulty: D, money: have });
  const k = calculateServerGrowthLog(sv, 1, personObj, cores);
  if (!(k > 0)) return Infinity;
  const Tg = calculateGrowTime(sv, personObj);
  // A grow fortifies by 2*ServerFortifyAmount per used thread, and the loop
  // stops to weaken once the deadband is exceeded; that duty is charged the
  // same way as in the steady state.
  const gamma = (2 * FORTIFY) / getWeakenEffect(1, cores);
  const g = ramGb / (ramPerThread * Tg * (1 + (4 / 3.2) * gamma));
  return Math.log(want / have) / (k * g);
}

/** Fleet-wide early.js rates under seed.js's placement. */
export function earlyFleetRate(servers, player, opts) {
  const p = person(player);
  const plan = seedPlan(servers, player, opts);
  const rows = [];
  for (const [host, blocks] of plan.assign) {
    const s = servers.find((x) => x.hostname === host);
    const gb = blocks.reduce((a, b) => a + b.gb, 0);
    // One row per host-block so the overshoot term sees the real per-host
    // thread count, then summed.
    let d = 0;
    let e = 0;
    let last = null;
    for (const b of blocks) {
      const r = earlyTargetRate(s, p, { ...opts, ramGb: b.gb, cores: b.cores });
      d += r.dollarsPerSec;
      e += r.expPerSec;
      last = r;
    }
    const setupSeconds = earlyRampSeconds(s, p, { ...opts, ramGb: gb, cores: blocks[0]?.cores ?? 1 });
    rows.push({ ...last, host, ramGb: gb, dollarsPerSec: d, expPerSec: e, blocks: blocks.length, setupSeconds });
  }
  rows.sort((a, b) => b.dollarsPerSec - a.dollarsPerSec);
  return {
    rows,
    dollarsPerSec: rows.reduce((a, r) => a + r.dollarsPerSec, 0),
    expPerSec: rows.reduce((a, r) => a + r.expPerSec, 0),
    ramGb: rows.reduce((a, r) => a + r.ramGb, 0),
    threads: plan.totalThreads,
  };
}

// ===========================================================================
// 2b. batch.js AS A RATE MODEL
// ===========================================================================
//
// Unlike early.js, batch.js HAS a plan, and it exports the function that makes
// it. So this arm calls `planBatch` out of the shipped file rather than
// reimplementing it, and the only modelling left is (i) the period the
// dispatcher achieves and (ii) the prep that has to happen first.
//
// PERIOD. batch.js:933 is `period = max(4*spacing, weakenTime/maxInFlight)`
// with `maxInFlight = floor(slice/plan.gb)`. `target-count.mjs` and `alloc.mjs`
// over-predicted live income by +38.5% by using `4*spacing` unconditionally;
// that term is a FLOOR, not the period. Two corrections, both mechanical:
//
//   * a launch can only happen on a controller tick, so the floor is
//     `ceil(4*spacing/loopMs)*loopMs`, not `4*spacing`;
//   * on a fleet this small `weakenTime/maxInFlight` is the binding term by
//     orders of magnitude — at 844GB and a 500-thread plan, maxInFlight is 1
//     and the period IS one weakenTime.
//
// The third term in alloc.mjs's fitted law, `loopMs*(skips+placeFails)/batches`,
// cannot be evaluated here: this life has `batches: 0`. It is reported as an
// unknown and swept in section 5.
//
// PREP. Measured from the game's own durations rather than assumed, following
// batch.js's two strict phases (batch.js:814-884):
//
//   phase 1  weaken to minSec, in waves of `totalRam/nTargets/ram.weaken`
//            threads, each wave taking calculateWeakenTime AT CURRENT security
//            (batch.js:830 — using the prepped figure here under-estimates by
//            the security ratio, 3-6x on a degraded target);
//   phase 2  grow to maxMoney at minimum security, in waves of
//            `budget/(ram.grow + 0.08*ram.weaken)` threads, each wave taking
//            calculateGrowTime and multiplying money by e^(k*waveThreads).

export const BATCH = { spacing: 200, loopMs: 200, margin: 1.1, maxTargets: 8, minMoneyFrac: 0.01, minScoreFrac: 0.02 };

/** The `t` object batch.js's planBatch/targetScore expect, built from a snapshot server. */
export function batchTarget(s, player, { useShippedPhi }) {
  const p = person(player);
  const minSec = s.minDifficulty;
  const prepped = at(s, { difficulty: minSec, money: s.moneyMax });
  const now = at(s, { difficulty: Math.max(s.hackDifficulty, minSec) });
  // batch.js without Formulas.exe uses its own inlined ports, which omit
  // currentNodeMults.ScriptHackMoney (bncheck.mjs ASSUMPTIONS, and see the
  // report in docs/horizon.md). `useShippedPhi` models the controller AS
  // SHIPPED; false models a controller that has the BitNode right.
  const truePhi = calculatePercentMoneyHacked(prepped, p);
  const phi = useShippedPhi ? truePhi / currentNodeMults.ScriptHackMoney : truePhi;
  return {
    host: s.hostname,
    level: player.hacking,
    required: s.requiredHackingSkill,
    minSec,
    maxMoney: s.moneyMax,
    sec: s.hackDifficulty,
    money: s.moneyAvailable,
    growth: s.serverGrowth,
    hackTime: calculateHackingTime(prepped, p) * 1000, // batch.js works in ms
    hackTimeNow: calculateHackingTime(now, p) * 1000,
    phi,
    truePhi,
    chance: calculateHackingChance(prepped, p),
    k: calculateServerGrowthLog(prepped, 1, p, 1),
    kNow: calculateServerGrowthLog(now, 1, p, 1),
    expGain: calculateHackingExpGain(prepped, p),
    _server: s,
  };
}

/** Prep seconds for one target, following batch.js's own two phases. */
export function prepSeconds(t, player, { fleetGb, nTargets, ram }) {
  const p = person(player);
  const s = t._server;
  const excess = Math.max(0, s.hackDifficulty - s.minDifficulty);
  let seconds = 0;
  const detail = { weakenWaves: 0, growWaves: 0, weakenSec: 0, growSec: 0 };

  // --- phase 1: security to the floor -------------------------------------
  if (excess > 0) {
    const perThread = getWeakenEffect(1, 1);
    const wShare = Math.floor(fleetGb / Math.max(1, nTargets) / ram.weaken);
    let left = excess;
    let guard = 0;
    while (left > 1e-9 && guard++ < 64) {
      const sv = at(s, { difficulty: s.minDifficulty + left });
      const waveSec = calculateWeakenTime(sv, p);
      const done = Math.min(left, wShare * perThread);
      if (!(done > 0)) return { seconds: Infinity, ...detail };
      left -= done;
      seconds += waveSec;
      detail.weakenSec += waveSec;
      detail.weakenWaves++;
    }
  }

  // --- phase 2: money, at minimum security --------------------------------
  if (s.moneyAvailable < s.moneyMax) {
    const prepped = at(s, { difficulty: s.minDifficulty });
    const waveSec = calculateGrowTime(prepped, p);
    const k = t.k;
    const perGrow = ram.grow + 0.08 * ram.weaken; // batch.js:877
    const budget = Math.min(fleetGb, fleetGb / Math.max(1, nTargets));
    const gPerWave = Math.floor(budget / perGrow);
    if (!(k > 0) || gPerWave < 1) return { seconds: Infinity, ...detail };
    let money = Math.max(1, s.moneyAvailable);
    let guard = 0;
    while (money < s.moneyMax && guard++ < 64) {
      const need = numCycleForGrowthCorrected(prepped, s.moneyMax, money, 1, p);
      const wave = Math.min(gPerWave, Math.max(1, Math.ceil(need)));
      money = Math.min(s.moneyMax, (money + wave) * Math.exp(k * wave));
      seconds += waveSec;
      detail.growSec += waveSec;
      detail.growWaves++;
    }
  }
  return { seconds, ...detail };
}

/**
 * Steady-state rates for one batched target, plus the prep that precedes them.
 *
 * `skipFactor` is alloc.mjs's `1 + loopMs*(skips+placeFails)/(batches*period)`
 * term, which cannot be measured in this life. Default 1 = the optimistic end.
 */
export function batchTargetRate(t, player, { fleetGb, nTargets, ram, planBatch, skipFactor = 1 }) {
  const slice = fleetGb / Math.max(1, nTargets);
  // batch.js caps the hack op by the LARGEST SINGLE free block (invariant B5).
  // Offline, the best case is the largest host in the fleet.
  const plan = planBatch(t, ram, slice / 4, t._largestBlock ?? Infinity);
  if (!plan) return { host: t.host, plan: null, dollarsPerSec: 0, expPerSec: 0, ramGb: 0 };

  const weakenTime = t.hackTime * 4; // ms
  const maxInFlight = Math.max(1, Math.floor(slice / plan.gb));
  const floorMs = Math.ceil((4 * BATCH.spacing) / BATCH.loopMs) * BATCH.loopMs;
  const period = Math.max(floorMs, weakenTime / maxInFlight) * skipFactor;

  // plan.money is computed with the controller's own phi. The money actually
  // taken uses the TRUE phi, which in a BitNode where ScriptHackMoney != 1 is
  // not the same number.
  const realF = Math.min(0.99, t.truePhi * plan.h);
  const moneyPerBatch = realF * t.maxMoney * t.chance;

  const q = t.chance + (1 - t.chance) / 4;
  const threads = plan.h * q + plan.g + plan.w1 + plan.w2;
  const ramInUse = Math.min(slice, Math.ceil(weakenTime / period) * plan.gb);

  // RAM the pipeline cannot use goes to spill weaken (batch.js:1000+): no
  // money, full experience, held for one weakenTime.
  const spillGb = Math.max(0, slice - ramInUse);
  const spillThreadsPerSec = spillGb / ram.weaken / (weakenTime / 1000);

  return {
    host: t.host,
    plan,
    period: period / 1000,
    maxInFlight,
    moneyPerBatch,
    plannedMoneyPerBatch: plan.money,
    dollarsPerSec: moneyPerBatch / (period / 1000),
    expPerSec: (t.expGain * threads) / (period / 1000) + t.expGain * spillThreadsPerSec,
    ramGb: ramInUse,
    spillGb,
  };
}

/**
 * batch.js's own target-count argmax (batch.js:740-762), then the fleet totals.
 *
 * Reproduced rather than replaced, because the decision is about the shipped
 * controller. The one change is that the income proxy in the argmax is
 * batch.js's, which uses `4*spacing`; the REPORTED rates use the real period.
 */
export function batchFleetRate(servers, player, { fleetGb, ram, planBatch, targetScore, skipFactor = 1, useShippedPhi }) {
  const level = player.hacking;
  const cand = servers
    .filter((s) => s.hasAdminRights && s.moneyMax > 0 && s.requiredHackingSkill <= level)
    .map((s) => batchTarget(s, player, { useShippedPhi }));
  if (!cand.length) return { rows: [], dollarsPerSec: 0, expPerSec: 0, nTargets: 0 };
  const richest = Math.max(...cand.map((t) => t.maxMoney));
  const scored = cand
    .map((t) => ({ t, score: targetScore(t) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = scored[0]?.score ?? 0;
  const worthwhile = scored.filter(
    (r) => r.score >= best * BATCH.minScoreFrac && r.t.maxMoney >= richest * BATCH.minMoneyFrac,
  );
  const pool = (worthwhile.length ? worthwhile : scored).slice(0, BATCH.maxTargets);
  const largestBlock = Math.max(...servers.filter((s) => s.hasAdminRights).map((s) => s.maxRam));
  for (const r of pool) r.t._largestBlock = largestBlock;

  let bestN = 1;
  let bestInc = -1;
  for (let n = 1; n <= pool.length; n++) {
    const slice = fleetGb / n;
    let inc = 0;
    for (let i = 0; i < n; i++) {
      const p = planBatch(pool[i].t, ram, slice / 4, largestBlock);
      if (!p) continue;
      inc += Math.min(p.money / (4 * BATCH.spacing), (slice * p.money) / (p.gb * pool[i].t.hackTime * 4));
    }
    if (inc > bestInc) {
      bestInc = inc;
      bestN = n;
    }
  }

  const chosen = pool.slice(0, bestN);
  const rows = chosen.map((r) => ({
    ...batchTargetRate(r.t, player, { fleetGb, nTargets: bestN, ram, planBatch, skipFactor }),
    prep: prepSeconds(r.t, player, { fleetGb, nTargets: bestN, ram }),
    t: r.t,
  }));
  return {
    rows,
    nTargets: bestN,
    dollarsPerSec: rows.reduce((a, r) => a + r.dollarsPerSec, 0),
    expPerSec: rows.reduce((a, r) => a + r.expPerSec, 0),
    prepSeconds: Math.max(0, ...rows.map((r) => r.prep.seconds)),
  };
}

// ===========================================================================
// 3. THE REGIME LADDER
// ===========================================================================
//
// The rate models above are stationary: they hold while the target set, the
// fleet and the level are fixed. Every one of those changes in steps, and each
// step is where the model stops being valid. A receding-horizon (MPC) solve is
// justified exactly here: the dynamics are piecewise-stationary between steps,
// so the horizon should be the next step, not an arbitrary window.
//
// Two kinds of step, and they are driven by different currencies:
//
//   MONEY steps   a port program roots more servers -> more fleet RAM.
//                 A home RAM upgrade -> more fleet RAM.
//                 Neither adds a TARGET: everything a new port program unlocks
//                 in this save needs hacking 425+.
//   LEVEL steps   a rooted server crosses requiredHackingSkill and becomes a
//                 target. This is the ONLY thing that makes a dollar of server
//                 money accessible, and the ladder is dense: omega-net at 201,
//                 the-hub at 282, computek at 346, rho-construction at 509.
//                 Faction backdoors sit on the same ladder (avmnite-02h 210,
//                 I.I.I.I 341, run4theh111z 506).

export function regimeLadder(servers, player, money, ratePerSec, expPerSec) {
  const m = levelMult(player);
  const E = player.hackExp;
  const level = player.hacking;
  const rooted = new Set(servers.filter((s) => s.hasAdminRights).map((s) => s.hostname));
  const out = [];

  // --- level steps: a rooted server becomes hackable -----------------------
  const nextTargets = servers
    .filter((s) => rooted.has(s.hostname) && s.moneyMax > 0 && s.requiredHackingSkill > level)
    .sort((a, b) => a.requiredHackingSkill - b.requiredHackingSkill)
    .slice(0, 4);
  for (const s of nextTargets) {
    const need = expForLevel(s.requiredHackingSkill, m) - E;
    out.push({
      kind: "level",
      what: `${s.hostname} becomes hackable (level ${s.requiredHackingSkill}, ${$(s.moneyMax)} max)`,
      seconds: expPerSec > 0 ? need / expPerSec : Infinity,
      detail: { level: s.requiredHackingSkill, exp: need },
    });
  }
  // --- level steps: a story server becomes backdoorable --------------------
  const STORY = {
    CSEC: "CyberSec",
    "avmnite-02h": "NiteSec",
    "I.I.I.I": "The Black Hand",
    run4theh111z: "BitRunners",
    ".": "The Covenant/illuminati path",
    "The-Cave": "Daedalus (The Cave)",
  };
  for (const [host, faction] of Object.entries(STORY)) {
    const s = servers.find((x) => x.hostname === host);
    if (!s || s.requiredHackingSkill <= level) continue;
    const need = expForLevel(s.requiredHackingSkill, m) - E;
    out.push({
      kind: "level",
      what: `${host} backdoorable -> ${faction} (level ${s.requiredHackingSkill})`,
      seconds: expPerSec > 0 ? need / expPerSec : Infinity,
      detail: { level: s.requiredHackingSkill, exp: need },
    });
  }

  // --- money steps: port programs -----------------------------------------
  const ownedPrograms = new Set(player.programs);
  const OPENERS = ["BruteSSH.exe", "FTPCrack.exe", "relaySMTP.exe", "HTTPWorm.exe", "SQLInject.exe"];
  const ownedCount = OPENERS.filter((f) => ownedPrograms.has(f)).length;
  for (let i = ownedCount; i < OPENERS.length; i++) {
    const file = OPENERS[i];
    const item = Object.values(DarkWebItems).find((d) => d.program === file || d.name === file);
    const price = item?.price ?? null;
    const gained = servers.filter(
      (s) => !s.hasAdminRights && !s.purchasedByPlayer && s.numOpenPortsRequired <= i + 1,
    );
    const gainedGb = gained.reduce((a, s) => a + s.maxRam, 0);
    const newTargets = gained.filter((s) => s.moneyMax > 0 && s.requiredHackingSkill <= level).length;
    out.push({
      kind: "money",
      what: `${file} (${$(price)}) -> +${gainedGb}GB fleet, +${newTargets} hackable targets`,
      seconds: price === null ? Infinity : ratePerSec > 0 ? Math.max(0, price - money) / ratePerSec : Infinity,
      detail: { price, gainedGb, newTargets, cumulative: i + 1 - ownedCount > 1 },
    });
  }

  // --- money steps: home RAM ----------------------------------------------
  // PlayerObjects/Player/PlayerObjectServerMethods.ts:30 — the game's own
  // expression, evaluated without a Player because the bundle's `Player` is
  // never populated offline. Constants come out of the bundle, not memory.
  const home = servers.find((s) => s.hostname === "home");
  if (home) {
    const cost =
      home.maxRam *
      ServerConstants.BaseCostFor1GBOfRamHome *
      Math.pow(1.58, Math.log2(home.maxRam)) *
      currentNodeMults.HomeComputerRamCost;
    out.push({
      kind: "money",
      what: `home RAM ${home.maxRam} -> ${home.maxRam * 2}GB (${$(cost)})`,
      seconds: ratePerSec > 0 ? Math.max(0, cost - money) / ratePerSec : Infinity,
      detail: { price: cost, gainedGb: home.maxRam },
    });
  }

  out.sort((a, b) => a.seconds - b.seconds);
  return out;
}

// ===========================================================================
// RUNNABLE
// ===========================================================================

async function main() {
  const out = {};

  // ---- 0. live inputs ----------------------------------------------------
  const snap = await fetchSnapshot();
  const player = snap.player;
  const servers = snap.servers;
  out.live = { bitNode: snap.bitNode, level: player.hacking, money: player.money, hackExp: player.hackExp };

  say(`live: BitNode ${snap.bitNode}, hacking ${player.hacking}, exp ${player.hackExp.toExponential(3)}, ` +
      `${$(player.money)}, home ${player.homeRam}GB/${player.homeCores} cores, ` +
      `${servers.filter((s) => s.hasAdminRights).length}/${servers.length} rooted`);

  say("\n0. CHECK — BitNode multipliers");
  // The bundle initialises currentNodeMults to all-ones and nothing in
  // tools/sim/ has ever set it. In BitNode 4 that makes every hack-money figure
  // 5x too high and every experience figure 2.5x too high, with every formula
  // exactly right. Assert, fix, and print.
  const sf = snap.player.sourceFiles?.get?.(snap.bitNode) ?? 1;
  const want = game.getBitNodeMultipliers(snap.bitNode, sf);
  const wasWrong = currentNodeMults.ScriptHackMoney !== want.ScriptHackMoney;
  Object.assign(currentNodeMults, want);
  check(
    currentNodeMults.ScriptHackMoney === want.ScriptHackMoney && currentNodeMults.HackExpGain === want.HackExpGain,
    `currentNodeMults set to BitNode ${snap.bitNode}: ScriptHackMoney ${want.ScriptHackMoney}, ` +
      `HackExpGain ${want.HackExpGain}, WorldDaemonDifficulty ${want.WorldDaemonDifficulty}` +
      (wasWrong ? "  [the bundle default was 1 — every other tool in tools/sim/ is still running BN1 physics]" : ""),
  );
  out.nodeMults = { ScriptHackMoney: want.ScriptHackMoney, HackExpGain: want.HackExpGain, WorldDaemonDifficulty: want.WorldDaemonDifficulty };

  // ---- 1. the terminal condition ----------------------------------------
  const m = levelMult(player);
  const daemon = servers.find((s) => s.hostname === "w0r1d_d43m0n");
  const Lstar = daemon ? daemon.requiredHackingSkill : 3000 * currentNodeMults.WorldDaemonDifficulty;
  const expStar = expForLevel(Lstar, m);
  say(`\n1. TERMINAL CONDITION — backdoor w0r1d_d43m0n at hacking ${Lstar}`);
  say(`   level multiplier m = ${m.toFixed(4)} (player ${player.mults.hacking} x BitNode ${currentNodeMults.HackingLevelMultiplier})`);
  say(`   exp needed at this m: ${expStar.toExponential(2)}    (have ${player.hackExp.toExponential(3)})`);
  say(`   dL/dln(m) = L = ${player.hacking}      dL/dln(E) = 32m = ${(32 * m).toFixed(1)}`);
  say(`   -> a 1% multiplier is worth ${(player.hacking / (32 * m)).toFixed(1)}x a 1% of experience today,` +
      ` and ${(Lstar / (32 * m)).toFixed(0)}x at the terminal level.`);
  say(`   -> the terminal condition is a MULTIPLIER condition. Experience has no terminal value;`);
  say(`      it is destroyed by the install that buys the multiplier (Prestige.ts / A14).`);
  for (const L of [player.hacking + 1, 210, 341, 506, 2500, Lstar]) {
    if (L <= player.hacking) continue;
    say(`      level ${String(L).padStart(5)} needs exp ${expForLevel(L, m).toExponential(2)}` +
        `  (${(expForLevel(L, m) / player.hackExp).toFixed(2)}x what we hold)`);
  }
  out.terminal = { Lstar, m, expStar };

  // ---- 2. controller rate models ----------------------------------------
  say("\n2. CONTROLLER RATE MODELS");
  const ramInfo = await liveScriptRam(["early.js", "h.js", "g.js", "w.js"]);
  const ram = { hack: ramInfo["h.js"], grow: ramInfo["g.js"], weaken: ramInfo["w.js"] };
  const earlyRam = ramInfo["early.js"];
  say(`   worker RAM, from the game's own calculateRam: early.js ${earlyRam}GB, ` +
      `h.js ${ram.hack}GB g.js ${ram.grow}GB w.js ${ram.weaken}GB`);

  // Operating security, MEASURED off the live save rather than taken from
  // early.js's SECURITY_SLACK constant.
  const drained = servers.filter(
    (s) => s.hasAdminRights && s.moneyMax > 0 && s.requiredHackingSkill <= player.hacking && s.hackDifficulty > s.minDifficulty + 0.05,
  );
  const slackSamples = drained.map((s) => s.hackDifficulty - s.minDifficulty).filter((x) => x <= SECURITY_SLACK_DEFAULT + 1);
  const measuredSlack = slackSamples.length ? slackSamples.reduce((a, b) => a + b, 0) / slackSamples.length : SECURITY_SLACK_DEFAULT;
  const floorSamples = servers
    .filter((s) => s.hasAdminRights && s.moneyMax > 0 && s.requiredHackingSkill <= player.hacking)
    .map((s) => s.moneyAvailable / s.moneyMax);
  const measuredFloor = floorSamples.length ? Math.min(...floorSamples) : 0.05;
  say(`   MEASURED from the save: operating security minSec+${measuredSlack.toFixed(2)} ` +
      `(${slackSamples.length} targets), lowest money fraction ${(measuredFloor * 100).toFixed(1)}%`);

  const floor = Number(argOf("floor", measuredFloor));
  const modelledFloorIsLive = Math.abs(floor - measuredFloor) < 1e-9;

  // ---- 2c. CALIBRATION against history windows ---------------------------
  say("\n2c. CALIBRATION — early.js integrated over the whole recorded life");
  const life = thisLife();
  const bt = backtestEarly(life, servers, player, {
    ramPerThread: earlyRam,
    slack: measuredSlack,
    floor: measuredFloor,
  });
  out.phases = bt.phases;
  say(`   ${life.length} samples since the last prestige, ` +
      `${(life[life.length - 1].playtimeSinceLastAug / 3600e3).toFixed(2)}h of game time, ${bt.phases.length} fleet phases`);
  say(`   phase                                  model $ (drain+income)      live $   err      model exp    live exp   err`);
  for (const ph of bt.phases) {
    if (ph.seconds < 60) continue;
    const e$ = ph.liveMoney > 0 ? ph.modelMoney / ph.liveMoney - 1 : NaN;
    const ee = ph.liveExp > 0 ? ph.modelExp / ph.liveExp - 1 : NaN;
    say(
      `   t=${ph.t0.toFixed(0).padStart(3)}..${ph.t1.toFixed(0).padStart(3)}min ` +
        `${String(ph.rooted).padStart(2)}root/${String(ph.homeRam).padStart(3)}GB L${String(ph.L0).padStart(3)}->${String(ph.L1).padStart(3)} ` +
        `${$(ph.modelMoney).padStart(9)} (${$(ph.modelDrain)}+${$(ph.modelSteady)})` +
        `${$(ph.liveMoney).padStart(11)} ${(isFinite(e$) ? (e$ >= 0 ? "+" : "") + (e$ * 100).toFixed(0) + "%" : "  -").padStart(6)} ` +
        `${ph.modelExp.toExponential(2).padStart(10)} ${ph.liveExp.toExponential(2).padStart(10)} ` +
        `${(isFinite(ee) ? (ee >= 0 ? "+" : "") + (ee * 100).toFixed(0) + "%" : "  -").padStart(6)}` +
        (ph.drops > 0 ? `   (${$(ph.drops)} spent)` : ""),
    );
  }
  // The check is taken on the LONGEST phase and on the life total. A short
  // phase is dominated by whatever the boot sequence happened to be doing, and
  // the life total folds every phase together so no single one can hide.
  const longest = bt.phases.slice().sort((a, b) => b.seconds - a.seconds)[0];
  const tot = bt.phases.reduce(
    (a, p) => ({
      modelMoney: a.modelMoney + p.modelMoney,
      liveMoney: a.liveMoney + p.liveMoney,
      modelExp: a.modelExp + p.modelExp,
      liveExp: a.liveExp + p.liveExp,
      modelDrain: a.modelDrain + p.modelDrain,
      modelSteady: a.modelSteady + p.modelSteady,
    }),
    { modelMoney: 0, liveMoney: 0, modelExp: 0, liveExp: 0, modelDrain: 0, modelSteady: 0 },
  );
  if (!longest) check(false, "NO BACKTEST PHASES — the early.js arm is uncalibrated on this history");
  else {
    say(`   longest phase: t=${longest.t0.toFixed(0)}..${longest.t1.toFixed(0)}min, ${(longest.seconds / 60).toFixed(0)}min, ` +
        `${longest.rooted} rooted = ${longest.fleetGb}GB, level ${longest.L0}->${longest.L1}`);
    // Tolerance: what this protects is a controller choice whose current margin
    // is an order of magnitude, so 25% is comfortably decisive and 15% would be
    // asking the model to resolve something the decision does not depend on.
    checkWithin("   longest phase, cumulative $  ", longest.modelMoney, longest.liveMoney, 0.25, $);
    checkWithin("   longest phase, cumulative exp", longest.modelExp, longest.liveExp, 0.25, (x) => x.toExponential(2));
    // The life total is PRINTED but not asserted, and the reason is stated
    // rather than left as a silent exemption: this model is a model of
    // early.js, and after t~406min of this life early.js was not the only thing
    // earning — batch.js ran, and the recorded income exceeds anything the
    // fleet could produce from hacking alone. Asserting against a mixture would
    // be asserting against a quantity the model does not claim to predict.
    // A phase is flagged below wherever live income exceeds the model by more
    // than 2x, which is the signature.
    const mixed = bt.phases.filter((p) => p.seconds > 60 && p.liveMoney > 2 * p.modelMoney);
    say(`   whole life: model ${$(tot.modelMoney)} vs live ${$(tot.liveMoney)}  ` +
        `err ${((tot.modelMoney / tot.liveMoney - 1) * 100).toFixed(1)}%   NOT ASSERTED — ` +
        `${mixed.length} phase(s) carry income this model does not claim: ` +
        `${mixed.map((p) => `t=${p.t0.toFixed(0)}min (${$(p.liveMoney)} vs ${$(p.modelMoney)})`).join(", ") || "none"}`);
    say(`   whole life, exp: model ${tot.modelExp.toExponential(2)} vs live ${tot.liveExp.toExponential(2)}  ` +
        `err ${((tot.modelExp / tot.liveExp - 1) * 100).toFixed(1)}%   (same caveat; experience is over-predicted on the`);
    say(`     large-fleet phases, where seed.js was competing with batch.js for hosts rather than filling them)`);
    say(`   of the model's ${$(tot.modelMoney)} over the life, ${$(tot.modelDrain)} ` +
        `(${((100 * tot.modelDrain) / Math.max(1, tot.modelMoney)).toFixed(0)}%) is DRAINING starting balances — capital, paid once — ` +
        `and only ${$(tot.modelSteady)} is income.`);
    say(`   NOTE: live money also includes anything else that paid the player (coding contracts, terminal work).`);
  }
  out.backtest = { total: tot, longest };

  // ---- present-state rates ----------------------------------------------
  const homeUsed = 0;
  const early = earlyFleetRate(servers, player, {
    ramPerThread: earlyRam,
    floor,
    slack: measuredSlack,
    homeReserve: 12,
    homeUsedByOthers: homeUsed,
  });
  say(`\n   early.js NOW  (floor ${(floor * 100).toFixed(1)}%${modelledFloorIsLive ? ", the live value" : ", COUNTERFACTUAL — NOT CALIBRATED"}):`);
  say(`     ${early.ramGb.toFixed(0)}GB over ${early.rows.length} targets, ${early.threads} threads` +
      ` -> ${$(early.dollarsPerSec)}/sec, ${early.expPerSec.toFixed(2)} exp/sec`);
  for (const r of early.rows.slice(0, 6)) {
    say(`       ${r.host.padEnd(18)} ${String(r.ramGb.toFixed(0)).padStart(5)}GB  ${$(r.dollarsPerSec).padStart(9)}/s` +
        `  ${r.expPerSec.toFixed(2).padStart(6)} exp/s  phi=${r.phi.toExponential(2)} chance=${r.chance.toFixed(2)} T=${r.T.toFixed(0)}s`);
  }

  const { mod: B, rewrites } = await loadShipped("batch.js");
  check(rewrites === 1, `batch.js loaded from source with ${rewrites} module-specifier rewrite (expect 1)`);
  const fleetGb = servers.filter((s) => s.hasAdminRights).reduce((a, s) => a + s.maxRam, 0);
  const batch = batchFleetRate(servers, player, {
    fleetGb,
    ram,
    planBatch: B.planBatch,
    targetScore: B.targetScore,
    useShippedPhi: true,
  });
  const batchIdeal = batchFleetRate(servers, player, {
    fleetGb,
    ram,
    planBatch: B.planBatch,
    targetScore: B.targetScore,
    useShippedPhi: false,
  });
  say(`\n   batch.js NOW (as shipped, ${fleetGb}GB fleet):`);
  uncheckable("batch.js throughput", "batches: 0 in .telemetry/batch.txt — this life has never landed one");
  say(`     ${batch.nTargets} target(s) chosen by batch.js's own argmax` +
      ` -> ${$(batch.dollarsPerSec)}/sec, ${batch.expPerSec.toFixed(2)} exp/sec after ${hms(batch.prepSeconds)} of prep`);
  for (const r of batch.rows) {
    say(`       ${r.host.padEnd(18)} period ${r.period.toFixed(1)}s inFlight ${r.maxInFlight}` +
        `  plan h=${r.plan?.h} g=${r.plan?.g} w=${r.plan?.w1}+${r.plan?.w2} ${r.plan?.gb.toFixed(0)}GB` +
        `  ${$(r.moneyPerBatch)}/batch (batch.js thinks ${$(r.plannedMoneyPerBatch)})` +
        `  prep ${hms(r.prep.seconds)} = ${r.prep.weakenWaves}w+${r.prep.growWaves}g`);
  }
  say(`     with the BitNode's ScriptHackMoney in its own phi, batch.js would instead reach ` +
      `${$(batchIdeal.dollarsPerSec)}/sec — the gap is bncheck's ASSUMPTIONS entry for hackFraction.`);

  out.rates = {
    early: { dollarsPerSec: early.dollarsPerSec, expPerSec: early.expPerSec, ramGb: early.ramGb },
    batch: { dollarsPerSec: batch.dollarsPerSec, expPerSec: batch.expPerSec, prepSeconds: batch.prepSeconds },
    batchIdeal: { dollarsPerSec: batchIdeal.dollarsPerSec, expPerSec: batchIdeal.expPerSec },
  };

  // ---- 3. the regime ladder ---------------------------------------------
  //
  // The horizon is not chosen; it is the soonest moment at which the
  // piecewise-stationary premise fails. It is also POLICY-DEPENDENT — the two
  // controllers earn money and experience at different rates and so reach the
  // step changes at different times — so both are computed and the SHORTER is
  // used, because that is where the model stops being able to speak for either.
  say("\n3. REGIME LADDER — where the stationary model stops being valid");
  const ladderE = regimeLadder(servers, player, player.money, early.dollarsPerSec, early.expPerSec);
  const ladderB = regimeLadder(servers, player, player.money, batch.dollarsPerSec, batch.expPerSec);
  for (let i = 0; i < Math.min(9, ladderE.length); i++) {
    const r = ladderE[i];
    const b = ladderB.find((x) => x.what === r.what);
    say(`   early ${hms(r.seconds).padStart(9)} | batch ${hms(b?.seconds ?? Infinity).padStart(9)}  [${r.kind}] ${r.what}`);
  }
  // Only the MONEY rungs end the horizon. A level rung changes the target set,
  // and every rate function here derives its target set from the level — so the
  // numerical integration in section 5 crosses those rungs exactly rather than
  // stopping at them. Ending the horizon at a level rung would make the whole
  // decision hypersensitive to whichever server happens to be two levels away:
  // the 14th target joining a 13-target fleet moves the rate by a few percent,
  // and it is not a reason to stop reasoning.
  //
  // A money rung is different: it buys FLEET RAM, which no rate function here
  // re-derives, so the model really does go stale at one.
  const moneyE = ladderE.filter((r) => r.kind === "money");
  const moneyB = ladderB.filter((r) => r.kind === "money");
  const hE = moneyE.length ? moneyE[0].seconds : Infinity;
  const hB = moneyB.length ? moneyB[0].seconds : Infinity;
  const horizon = Math.min(hE, hB);
  out.ladder = ladderE.slice(0, 10);
  out.horizon = horizon;
  say(`   LEVEL rungs are carried exactly by the integration in section 5 (every rate function derives its`);
  say(`   target set from the level), so they do not end the horizon. MONEY rungs buy fleet RAM, which no`);
  say(`   rate function re-derives, so they do.`);
  say(`   -> horizon H = ${hms(horizon)}  (${(hE <= hB ? moneyE[0] : moneyB[0])?.what ?? "no money rung"};` +
      ` early.js would reach it in ${hms(hE)}, batch.js in ${hms(hB)} — the sooner binds)`);

  // ---- 4. shadow prices --------------------------------------------------
  //
  // Minimum-time control. Write the life's value function as T(x), the seconds
  // remaining to the terminal condition. The shadow prices are
  //     lambda_M = -dT/dM      seconds saved per dollar
  //     lambda_E = -dT/dE      seconds saved per exp point
  // and the exchange rate pi = lambda_E/lambda_M is the dollar price of
  // experience. It is NOT a free parameter.
  //
  // Under reinvestment the income rate is proportional to accumulated capital,
  // so money compounds exponentially: M(t) = M0 e^(t/tau) and T = tau ln(C/M0),
  // giving lambda_M = tau/M0 = 1/rho. An extra unit of experience raises rho by
  // a FRACTION delta = (1/rho)(drho/dE), which shortens tau by the same
  // fraction, giving lambda_E = T*delta. Hence
  //
  //     pi = lambda_E / lambda_M = T * drho/dE
  //
  // and the compounding CANCELS — it changes the level of both prices but not
  // the ratio. That is the result that makes this cheap: we do not have to
  // model the reinvestment loop to price experience, only to decide when to
  // install and whether to buy RAM.
  //
  // T here is the remaining life, not the horizon: experience earned now is not
  // destroyed at a regime change, only at an install. The horizon bounds the
  // DECISION, not the value of what the decision earns.
  say("\n4. SHADOW PRICES");
  // The derivative has to be taken over a whole level: calculateSkill FLOORS,
  // so any bump smaller than the remaining exp-to-next-level returns exactly
  // zero and would read as "experience is worthless" — a lookup that silently
  // defaults, in the CLAUDE.md sense.
  // calculateExp, not the plain inverse: the game's own inverse carries an
  // epsilon-walk to guarantee calculateSkill(calculateExp(L)) === L
  // (skill.ts:23-37), and without it the bump lands one ULP short and the
  // derivative reads zero.
  const dE = Math.max(1, calculateExp(player.hacking + 1, m) - player.hackExp);
  const bumped = { ...player, hackExp: player.hackExp + dE, hacking: calculateSkill(player.hackExp + dE, m) };
  check(bumped.hacking === player.hacking + 1, `shadow-price finite difference moved the level ${player.hacking} -> ${bumped.hacking}`);
  const earlyUp = earlyFleetRate(servers, bumped, {
    ramPerThread: earlyRam,
    floor,
    slack: measuredSlack,
    homeReserve: 12,
    homeUsedByOthers: homeUsed,
  });
  const dRhodE = (earlyUp.dollarsPerSec - early.dollarsPerSec) / dE;
  say(`   drho/dE = ${dRhodE.toExponential(3)} $/sec per exp point (finite difference over ${dE.toFixed(0)} exp,` +
      ` level ${player.hacking} -> ${bumped.hacking})`);
  const lifeSeconds = Number(argOf("life", NaN));
  const H = horizon;
  const piH = H * dRhodE;
  say(`   pi = T * drho/dE. At the horizon T = H = ${hms(H)}:  pi = ${$(piH)} per exp point.`);
  say(`     one hacking level here costs ${(expForLevel(player.hacking + 1, m) - player.hackExp).toFixed(0)} exp` +
      ` = ${$((expForLevel(player.hacking + 1, m) - player.hackExp) * piH)} at this price.`);
  say(`   NOTE the derivation, not the number: pi is the CONTINUOUS channel only — experience raising`);
  say(`   income. The THRESHOLD channel (a level crossing unlocking a target or a faction) is not in pi;`);
  say(`   it is the horizon itself, and is handled by the receding horizon rather than by a price.`);
  out.shadow = { dRhodE, horizon: H, piAtHorizon: piH };

  // ---- 5. the decision ---------------------------------------------------
  //
  // Cumulative value to the horizon, in dollars, with experience integrated
  // rather than priced: rho(t) = rho0 + (drho/dE)*eps*t over a stationary
  // segment, so
  //
  //     V(H) = rho0*H + 0.5*(drho/dE)*eps*H^2 - (prep already spent)
  //
  // The quadratic term IS the experience channel; pi = H*drho/dE falls out of
  // it and is reported above as a diagnostic rather than used as an input.
  say("\n5. DECISION");
  //   V(H) = sum_i rho_i * max(0, H - setup_i)          money, delayed by setup
  //        + 0.5 * (drho/dE) * eps * H^2                the experience channel
  //
  // Experience is NOT delayed by setup in either arm, and that asymmetry is
  // real rather than a convenience: batch.js's prep is entirely grow and
  // weaken, and early.js's ramp is entirely grow, and both pay FULL experience
  // per thread (NetscriptFunctions.ts:291, :365). Only the money is deferred.
  const dRhodE_b = dRhodE; // the level channel is a property of the servers, not the controller
  //
  // The Taylor form above is only good while the level moves by about one. For
  // the rollout it is replaced by a coarse numerical solve: step time forward,
  // carry experience, recompute the level from calculateSkill, and re-evaluate
  // the rate. That costs a few dozen evaluations, removes the linearisation
  // error entirely, and — because every rate function already filters targets
  // by requiredHackingSkill — it crosses the LEVEL rungs of the ladder by
  // itself instead of stopping at them.
  const armValue = (rateAt, h, steps = 40) => {
    if (!(h > 0)) return 0;
    const cache = new Map();
    const at_ = (L) => {
      if (!cache.has(L)) cache.set(L, rateAt(L));
      return cache.get(L);
    };
    let E = player.hackExp;
    let money = 0;
    const dt = h / steps;
    for (let i = 0; i < steps; i++) {
      const t = i * dt;
      const r = at_(calculateSkill(E, m));
      for (const row of r.rows) {
        const s = row.setupSeconds ?? 0;
        const live = Math.max(0, Math.min(dt, t + dt - s));
        money += row.dollarsPerSec * live;
      }
      E += r.expPerSec * dt;
    }
    return money;
  };
  const atLevel = (base) => (L) => base({ ...player, hacking: L, hackExp: calculateExp(L, m) });
  const earlyAt = atLevel((p) =>
    earlyFleetRate(servers, p, { ramPerThread: earlyRam, floor, slack: measuredSlack, homeReserve: 12, homeUsedByOthers: homeUsed }),
  );
  const earlyHalfAt = atLevel((p) =>
    earlyFleetRate(servers, p, { ramPerThread: earlyRam, floor: 0.5, slack: measuredSlack, homeReserve: 12, homeUsedByOthers: homeUsed }),
  );
  const batchAt = atLevel((p) => {
    const r = batchFleetRate(servers, p, {
      fleetGb,
      ram,
      planBatch: B.planBatch,
      targetScore: B.targetScore,
      useShippedPhi: true,
    });
    return { ...r, rows: r.rows.map((x) => ({ ...x, setupSeconds: x.prep.seconds })) };
  });
  const vEarly = armValue(earlyAt, H);
  const vBatch = armValue(batchAt, H);
  const earlySetup = Math.max(0, ...early.rows.map((r) => r.setupSeconds ?? 0));
  say(`   horizon H = ${hms(H)}`);
  say(`   early.js: ${$(early.dollarsPerSec)}/s + ${early.expPerSec.toFixed(2)} exp/s, setup <= ${hms(earlySetup)}` +
      `   -> V = ${$(vEarly)}`);
  say(`   batch.js: ${$(batch.dollarsPerSec)}/s + ${batch.expPerSec.toFixed(2)} exp/s, setup ${hms(batch.prepSeconds)}` +
      ` -> V = ${$(vBatch)}`);
  // The third arm, which is not a controller swap at all: seed.js's money floor
  // (section 6). It belongs in the decision because it is the same objective
  // and a far cheaper control.
  const earlyHalf = earlyFleetRate(servers, player, {
    ramPerThread: earlyRam,
    floor: 0.5,
    slack: measuredSlack,
    homeReserve: 12,
    homeUsedByOthers: homeUsed,
  });
  const vEarlyHalf = armValue(earlyHalfAt, H);
  const halfSetup = Math.max(0, ...earlyHalf.rows.map((r) => r.setupSeconds ?? 0));
  say(`   seed.js --floor 0.5 (a flag, not a controller): ${$(earlyHalf.dollarsPerSec)}/s + ` +
      `${earlyHalf.expPerSec.toFixed(2)} exp/s, setup <= ${hms(halfSetup)} -> V = ${$(vEarlyHalf)}`);
  const arms = [
    [`early.js as running (--floor ${measuredFloor.toFixed(2)})`, vEarly],
    ["early.js at --floor 0.5", vEarlyHalf],
    ["batch.js", vBatch],
  ].sort((a, b) => b[1] - a[1]);
  const winner = arms[0][0];
  say(`   -> ${winner}   (${arms.map((a) => `${a[0]} ${$(a[1])}`).join("  >  ")})`);

  // TERMINAL VALUE. Truncating at H and stopping is precisely the error this
  // file exists to avoid: it charges batch.js the whole prep and credits it
  // only the stub of horizon that remains. A prepped target is an ASSET that
  // survives the regime change — a level crossing adds a target, it does not
  // un-prep the one already running — so the honest MPC form carries a terminal
  // value V(x(H)). Roll the ladder forward instead of asserting one: value to
  // each of the first few rungs, with prep paid once.
  // Rollout. Past the FIRST rung the piecewise-stationary premise has, by
  // construction, already failed for the money channel — a port program or a
  // home upgrade is bought and the fleet steps. The level channel is carried
  // exactly by the integration above. So these rows are a sensitivity to the
  // horizon, not a forecast, and the further down the column the weaker they
  // are. They are here because the whole question is which way the answer
  // moves with the horizon.
  say("\n   ROLLOUT — cumulative value against horizon (setup paid once; level channel integrated)");
  say(`     horizon        early(--floor ${measuredFloor.toFixed(2)})  early(--floor 0.5)      batch.js   winner`);
  const probes = [...new Set([60, 300, ...ladderE.slice(0, 5).map((r) => r.seconds), 3600, 4 * 3600, 12 * 3600])]
    .filter((x) => isFinite(x) && x > 0)
    .sort((a, b) => a - b);
  for (const hR of probes) {
    const a = armValue(earlyAt, hR);
    const c2 = armValue(earlyHalfAt, hR);
    const b = armValue(batchAt, hR);
    const best = [["early", a], ["early@0.5", c2], ["batch", b]].sort((x, y) => y[1] - x[1])[0][0];
    const rung = ladderE.find((r) => Math.abs(r.seconds - hR) < 1);
    say(`     ${hms(hR).padStart(9)} ${$(a).padStart(16)} ${$(c2).padStart(18)} ${$(b).padStart(13)}   ${best.padEnd(10)}` +
        (rung ? ` [${rung.what.slice(0, 44)}]` : ""));
  }

  // break-even horizon
  const breakEven = (A, Bf) => {
    let lo = 1;
    let hi = 86400;
    if (armValue(Bf, hi) <= armValue(A, hi)) return null;
    if (armValue(Bf, lo) > armValue(A, lo)) return lo;
    for (let i = 0; i < 30; i++) {
      const mid = Math.sqrt(lo * hi);
      if (armValue(Bf, mid) > armValue(A, mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  };
  const flip = breakEven(earlyAt, batchAt);
  const flipHalf = breakEven(earlyHalfAt, batchAt);
  say(`   break-even, batch.js over early.js as running:  ` +
      `${flip === null ? "never within 3 days" : hms(flip)}   (the horizon is ${hms(H)})`);
  say(`   break-even, batch.js over early.js at floor 0.5: ` +
      `${flipHalf === null ? "never within 3 days" : hms(flipHalf)}`);
  out.decision = { winner, vEarly, vBatch, breakEvenSeconds: flip, horizon: H };

  // sensitivity to the one thing that is NOT calibrated
  say("\n   SENSITIVITY — the batch arm has no live anchor. How wrong would it have to be to flip?");
  const bestEarly = Math.max(vEarly, vEarlyHalf);
  if (vBatch <= 0) {
    say(`     batch.js earns nothing at all over this horizon — its prep (${hms(batch.prepSeconds)}) exceeds it.`);
  } else {
    const ratio = bestEarly / vBatch;
    say(
      vBatch >= bestEarly
        ? `     the batch model would have to be over-predicting by ${(1 / ratio).toFixed(1)}x for the best early.js arm to win.`
        : `     the batch model would have to be under-predicting by ${ratio.toFixed(1)}x for batch.js to win.`,
    );
  }
  // The prep cost is the other uncalibrated input. How long would prep have to
  // run before the horizon eats the whole advantage?
  let prepFlip = null;
  for (let ps = 0; ps <= H * 4; ps += Math.max(1, H / 400)) {
    const bActive = Math.max(0, H - ps);
    const b = batch.dollarsPerSec * bActive + 0.5 * dRhodE_b * batch.expPerSec * bActive * bActive;
    if (b < vEarly) {
      prepFlip = ps;
      break;
    }
  }
  say(`     prep would have to take ${prepFlip === null ? "longer than 4H" : hms(prepFlip)} ` +
      `(model says ${hms(batch.prepSeconds)}) before early.js wins over this horizon.`);
  out.decision.prepFlipSeconds = prepFlip;
  for (const sf2 of [1, 1.5, 2, 3]) {
    const b2 = batchFleetRate(servers, player, {
      fleetGb,
      ram,
      planBatch: B.planBatch,
      targetScore: B.targetScore,
      useShippedPhi: true,
      skipFactor: sf2,
    });
    say(`     skipFactor ${sf2.toFixed(1)} (alloc.mjs's unmeasurable term): ${$(b2.dollarsPerSec)}/s,` +
        ` ${b2.expPerSec.toFixed(2)} exp/s`);
  }

  // ---- 6. the other control: seed.js's money floor -----------------------
  //
  // The model says something about `--floor` that is worth stating separately,
  // because it is a two-line change rather than a controller swap.
  //
  // At the floor, the conservation solution has beta = c*phi*m/(k*m + 1), and
  // for k*m >> 1 — which holds by three orders of magnitude on every target
  // here — beta is INDEPENDENT of m. So raising the floor does not change how
  // the threads are split between hack, grow and weaken: it changes only the
  // balance each hack is taken from. Income is therefore linear in the floor
  // and experience is unchanged by it.
  say("\n6. THE OTHER CONTROL — seed.js --floor");
  say(`   beta = c*phi*m/(k*m + 1) is independent of m once k*m >> 1, so the thread split does not`);
  say(`   move with the floor: income should be LINEAR in it and experience FLAT.`);
  for (const f of [0.05, 0.1, 0.25, 0.5, 0.75]) {
    const r = earlyFleetRate(servers, player, {
      ramPerThread: earlyRam,
      floor: f,
      slack: measuredSlack,
      homeReserve: 12,
      homeUsedByOthers: homeUsed,
    });
    say(`     floor ${(f * 100).toFixed(0).padStart(3)}%: ${$(r.dollarsPerSec).padStart(9)}/s  ${r.expPerSec.toFixed(2).padStart(7)} exp/s` +
        (Math.abs(f - measuredFloor) < 1e-9 ? "   <- the live value" : ""));
  }
  const startFrac = currentNodeMults.ServerStartingMoney / (25 * currentNodeMults.ServerMaxMoney);
  say(`   The curve bends at high floors because calculateGrowMoney caps at moneyMax: past`);
  say(`   ln(moneyMax/m)/k threads a grow op's extra threads do nothing, so restoring a dollar costs more.`);
  uncheckable(
    "the --floor sweep",
    `the live game runs exactly one floor. It is NOT pure extrapolation: the backtest above reproduces ` +
      `this life while its targets fall from ${(startFrac * 100).toFixed(1)}% of maxMoney (their prestige balance) ` +
      `to the ${(measuredFloor * 100).toFixed(0)}% floor, so the linearity in m is exercised over a ` +
      `${(startFrac / measuredFloor).toFixed(1)}x range of money by measured data. Above ` +
      `${(startFrac * 100).toFixed(0)}% it is extrapolation. Cheap to settle: set seed.js --floor and re-run this file.`,
  );

  const fails = report("horizon");
  if (JSONOUT) emitJson(out);
  process.exit(fails ? 1 : 0);
}
// ===========================================================================
// 2c. BACKTEST — the early.js model against the whole recorded life
// ===========================================================================
//
// Comparing a stationary rate to a measured money derivative does not work
// here, for a reason that is itself the most useful thing in this file:
//
//   **Most of what early.js "earns" early in a life is not income.** A server
//   that becomes hackable is holding `ServerStartingMoney/(25*ServerMaxMoney)`
//   of its maximum — 26.7% in BitNode 4 — and `early.js` with `--floor 0.05`
//   drains it to 5% and leaves it there. That 21.7% is a STOCK, paid once. The
//   339-minute stretch of this life that averages $498/sec earns about half of
//   its total that way, and the steady-state income underneath is a fifth of
//   the headline number.
//
// So the backtest integrates a per-target money state instead. Each target has
// one state variable, and early.js's own branch decides its dynamics:
//
//   money above the floor   the loop never calls grow, so every thread hacks:
//                           dm/dt = -c*phi*h*m, an exponential decay, and the
//                           player's income is exactly -dm/dt. Closed form over
//                           a step.
//   money at the floor      the conservation solution in section 2a: money
//                           held constant, income c*phi*m_bar*h.
//
// The crossing between the two is solved for within the step rather than
// resolved at step granularity, so the result does not depend on the telemetry
// sampling interval.
//
// The fleet is rebuilt at every sample from the recorded rooted count, using
// the fact that rooting is gated on OPEN PORTS ALONE (ns.nuke,
// NetscriptFunctions.ts:504-520) so the rooted set is a prefix of the port
// ladder. Placement is seed.js's own index pairing at that moment's level.
//
// Measured income is `(M_end - M_start) + sum of every drop`, because a drop is
// a purchase; taking the plain difference would report income as a lower bound
// and silently pass a model that is too small.

export function backtestEarly(life, servers, player, { ramPerThread, slack, floor }) {
  const nonPurch = servers.filter((s) => s.hostname !== "home" && !s.purchasedByPlayer && s.hostname !== "darkweb");
  const byPorts = (k) => nonPurch.filter((s) => s.numOpenPortsRequired <= k);
  const prefixFor = (rooted) => {
    let ports = 0;
    let bestD = Infinity;
    for (let k = 0; k <= 5; k++) {
      const d = Math.abs(byPorts(k).length + 1 - rooted);
      if (d < bestD) {
        bestD = d;
        ports = k;
      }
    }
    return { ports, delta: bestD };
  };

  const p0 = person(player);
  const m = levelMult(player);
  // A server at prestige holds baseMoney*ServerStartingMoney against a maximum
  // of 25*baseMoney*ServerMaxMoney (Server.ts:75-77), and there is no passive
  // regrowth — the only callers of processSingleServerGrowth are ns.grow, the
  // terminal command and the offline catch-up. So an unhackable server sits
  // exactly where it started until we can reach it.
  const startFrac = currentNodeMults.ServerStartingMoney / (25 * currentNodeMults.ServerMaxMoney);
  const money = new Map(nonPurch.map((s) => [s.hostname, s.moneyMax * startFrac]));

  const phases = [];
  let cur = null;
  let prev = null;
  for (const d of life) {
    const { ports, delta } = prefixFor(d.servers.rooted);
    const key = `${d.servers.rooted}|${d.home.ram}`;
    if (!cur || cur.key !== key) {
      cur = {
        key,
        ports,
        delta,
        rooted: d.servers.rooted,
        homeRam: d.home.ram,
        t0: d.playtimeSinceLastAug / 60000,
        t1: d.playtimeSinceLastAug / 60000,
        seconds: 0,
        L0: d.skills.hacking,
        L1: d.skills.hacking,
        modelMoney: 0,
        modelDrain: 0,
        modelSteady: 0,
        modelExp: 0,
        liveMoney: 0,
        liveExp: 0,
        drops: 0,
        fleetGb: 0,
      };
      phases.push(cur);
    }
    if (prev) {
      const dt = (d.totalPlaytime - prev.totalPlaytime) / 1000;
      if (dt > 0 && dt < 3600) {
        const fleet = [
          { ...servers.find((s) => s.hostname === "home"), maxRam: prev.home.ram, hasAdminRights: true },
          ...byPorts(prefixFor(prev.servers.rooted).ports).map((s) => ({ ...s, hasAdminRights: true })),
        ];
        const step = stepEarly(fleet, money, { ...player, hacking: prev.skills.hacking }, p0, dt, {
          ramPerThread,
          slack,
          floor,
        });
        cur.modelMoney += step.money;
        cur.modelDrain += step.drain;
        cur.modelSteady += step.steady;
        cur.modelExp += step.exp;
        cur.fleetGb = fleet.reduce((a, s) => a + s.maxRam, 0);
        cur.seconds += dt;
        // Measured income is the sum of the POSITIVE steps. A negative step is
        // a purchase; netting it off would report income as a lower bound and
        // so would silently pass a model that is too small.
        const dm = d.money - prev.money;
        if (dm < 0) cur.drops += -dm;
        else cur.liveMoney += dm;
        cur.liveExp += expForLevel(d.skills.hacking, m) - expForLevel(prev.skills.hacking, m);
      }
    }
    cur.t1 = d.playtimeSinceLastAug / 60000;
    cur.L1 = d.skills.hacking;
    prev = d;
  }
  return { phases, money };
}

/** One integration step of the early.js state, over `dt` seconds. */
function stepEarly(fleet, money, playerAtLevel, p0, dt, { ramPerThread, slack, floor }) {
  const plan = seedPlan(fleet, playerAtLevel, { ramPerThread, homeReserve: 12 });
  const p = { ...p0, skills: { ...p0.skills, hacking: playerAtLevel.hacking } };
  let outMoney = 0;
  let outDrain = 0;
  let outSteady = 0;
  let outExp = 0;
  for (const [host, blocks] of plan.assign) {
    const s = fleet.find((x) => x.hostname === host);
    if (!s) continue;
    const D = Math.min(99, s.minDifficulty + slack);
    const floorMoney = floor * s.moneyMax;
    for (const b of blocks) {
      let mNow = money.get(host) ?? s.moneyMax * 0.2667;
      const sv = at(s, { difficulty: D, money: mNow });
      const T = calculateHackingTime(sv, p);
      const phi = calculatePercentMoneyHacked(sv, p);
      const c = calculateHackingChance(sv, p);
      const k = calculateServerGrowthLog(sv, 1, p, b.cores);
      const e = calculateHackingExpGain(sv, p);
      const w1 = getWeakenEffect(1, b.cores);
      if (!(phi > 0) || !(T > 0)) continue;
      const q = c + (1 - c) / 4;
      let left = dt;

      // --- above the floor: pure drain, no grow ----------------------------
      if (mNow > floorMoney * (1 + 1e-9)) {
        const gamma = FORTIFY / w1;
        const h = b.gb / (ramPerThread * T * (1 + 4 * gamma));
        const lambda = c * phi * h;
        const tCross = lambda > 0 ? Math.log(mNow / floorMoney) / lambda : Infinity;
        const tUse = Math.min(left, tCross);
        const mNew = mNow * Math.exp(-lambda * tUse);
        outMoney += mNow - mNew;
        outDrain += mNow - mNew;
        outExp += e * (h * q + gamma * h) * tUse;
        mNow = mNew;
        left -= tUse;
      }

      // --- at the floor: the conservation steady state ----------------------
      if (left > 0) {
        const r = earlyTargetRate(s, p, { ramGb: b.gb, floor, slack, ramPerThread, cores: b.cores, difficulty: D });
        outMoney += r.dollarsPerSec * left;
        outSteady += r.dollarsPerSec * left;
        outExp += r.expPerSec * left;
        mNow = floorMoney;
      }
      money.set(host, mNow);
    }
  }
  return { money: outMoney, drain: outDrain, steady: outSteady, exp: outExp };
}


if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
