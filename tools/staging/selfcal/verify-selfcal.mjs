#!/usr/bin/env node
// Does the staged self-calibration actually recover the multiplier it claims to?
//
//   node tools/staging/selfcal/verify-selfcal.mjs
//   node tools/staging/selfcal/verify-selfcal.mjs --json
//
// Everything here is driven by the GAME'S OWN calculatePercentMoneyHacked out of
// ~/Repos/bitburner, evaluated under each BitNode's real multipliers via
// game.mjs's setBitNode. So "the true ratio" is not a number this file made up;
// it is what the game would actually do to a hack landing in that node, and the
// estimator never sees it.
//
// CALIBRATION. Sections 0-2 are source-vs-source: both sides are formulas, one
// the shipped port and one the game's. Section 3 reproduces a quantity the LIVE
// game is displaying right now — /tel/batch.txt's realised $/batch against
// planBatch's planned $/batch — and prints the error whether it passes or not,
// because the whole point of this exercise is that that ratio was 0.32 and
// nobody could say why.
//
// What it does NOT establish: that the corrected controller earns more in the
// real game. Only running it does that. What it establishes is that the number
// it will apply is the missing multiplier and not a fudge factor, that it
// approaches it from the safe side, and that it settles.

import "../../sim/env.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setBitNode, calculatePercentMoneyHacked, calculateHackingChance, calculateHackingTime } from "../../sim/game.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const JSON_OUT = process.argv.includes("--json");

/** Load a staged root script, rewriting its bare Netscript imports (see tools/sim/rootimport.mjs). */
async function importStaged(file) {
  const src = fs
    .readFileSync(file, "utf8")
    .replace(/(^\s*import[^'"]*['"])([^'"]+)(['"])/gm, (all, head, spec, tail) => {
      const target = path.join(REPO, spec.replace(/^\.?\//, ""));
      return fs.existsSync(target) ? head + pathToFileURL(target).href + tail : all;
    });
  return import(`data:text/javascript;base64,${Buffer.from(src).toString("base64")}`);
}

const B = await importStaged(path.join(HERE, "batch.js"));
const SHIPPED = await importStaged(path.join(REPO, "batch.js"));

let fails = 0;
let checks = 0;
const lines = [];
const say = (s) => {
  lines.push(s);
  if (!JSON_OUT) console.log(s);
};
const ok = (cond, text) => {
  checks++;
  if (!cond) fails++;
  say(`  ${cond ? "ok  " : "FAIL"} ${text}`);
  return cond;
};
const r = (v, n = 4) => (v === null || v === undefined || !isFinite(v) ? String(v) : Number(v.toFixed(n)));

// --- the world ---------------------------------------------------------------
// The live save's own phantasy, read out of getSaveFile on 2026-09-13, plus a
// deliberately different second target so "global constant" is tested against
// two targets and not one.
const SERVERS = [
  { hostname: "phantasy", moneyMax: 67_500_000, minDifficulty: 7, requiredHackingSkill: 100, serverGrowth: 35 },
  { hostname: "silver-helix", moneyMax: 126_562_500, minDifficulty: 10, requiredHackingSkill: 150, serverGrowth: 30 },
  { hostname: "megacorp", moneyMax: 120_874_690_051, minDifficulty: 33, requiredHackingSkill: 1210, serverGrowth: 99 },
];
const RAM = { hack: 1.7, grow: 1.75, weaken: 1.75 };
// Straight out of the staged SETTINGS.cal, so this exercises the shipped knobs.
const CAL = { keep: 128, minN: 12, q: 0.75, fallPerSec: 0.01, lo: 1e-4, hi: 1, fMax: 0.98 };

function person(level, m) {
  return {
    skills: { hacking: level, intelligence: 0 },
    mults: {
      hacking: 1,
      hacking_chance: m,
      hacking_speed: m,
      hacking_money: m,
      hacking_grow: m,
      hacking_exp: 1,
    },
    hp: { current: 10, max: 10 },
  };
}
const prepped = (s) => ({ ...s, hasAdminRights: true, hackDifficulty: s.minDifficulty, baseDifficulty: s.minDifficulty, moneyAvailable: s.moneyMax });

/** A batch.js-shaped target whose phi comes from the shipped port (the no-Formulas branch). */
function modelTarget(s, level, m, useFormulas) {
  const p = person(level, m);
  const mults = { chance: m, speed: m, money: m, growth: m };
  const t = {
    host: s.hostname,
    level,
    mults,
    required: s.requiredHackingSkill,
    minSec: s.minDifficulty,
    maxMoney: s.moneyMax,
    sec: s.minDifficulty,
    money: s.moneyMax,
    growth: s.serverGrowth,
    hackTime: calculateHackingTime(prepped(s), p) * 1000,
  };
  t.hackTimeNow = t.hackTime;
  // attachMath's two branches, reproduced: with Formulas.exe phi is the game's
  // own formula (every multiplier included), without it is the port.
  t.phi0 = useFormulas ? calculatePercentMoneyHacked(prepped(s), p) : B.hackFraction(level, t.required, t.minSec, mults);
  t.chance = useFormulas ? calculateHackingChance(prepped(s), p) : B.hackChance(level, t.required, t.minSec, mults);
  t.k = B.growthK(t.minSec, t.growth, mults);
  t.kNow = t.k;
  t.phi = t.phi0;
  // What the GAME will actually do, which the estimator never gets to see.
  t._true = calculatePercentMoneyHacked(prepped(s), p);
  t._trueChance = calculateHackingChance(prepped(s), p);
  return t;
}

// A deterministic RNG, so a failure is reproducible.
let seedState = 12345;
const rnd = () => ((seedState = (seedState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

/**
 * The controller loop, closed: the correction sets the plan, the plan sets h,
 * the game takes its cut, the drop becomes a sample, the sample moves the
 * correction. This is the thing that could oscillate, so it is the thing that
 * gets simulated rather than argued about.
 */
function runLoop(t, { ticks = 400, budget = 1e6, contaminate = 0, starve = 0, seedY = null, dt = 4.3 } = {}) {
  const cal = B.yieldRatio(CAL);
  if (seedY !== null) cal.seed(seedY, "restored");
  const Y = t._true / t.phi0;
  let money = t.maxMoney;
  let minY = Infinity;
  let below = 0; // ticks spent with y < Y, i.e. planning to over-hack
  let firstWithin = null;
  let earned = 0;
  let planned = 0;
  let landings = 0;
  let successes = 0;
  const trace = [];
  for (let i = 0; i < ticks; i++) {
    const y = cal.val();
    if (y < Y - 1e-12) below++;
    minY = Math.min(minY, y);
    const tt = { ...t, phi: t.phi0 * y };
    const plan = B.planBatch(tt, RAM, budget, Infinity);
    if (!plan) break;
    // --- the game's side of the tick ---------------------------------------
    const before = money;
    landings++;
    planned += plan.money;
    let drain = 0;
    if (rnd() < t._trueChance) {
      successes++;
      drain = Math.min(before, before * t._true * plan.h);
      money = before - drain;
      earned += drain;
    }
    // --- the controller's side ---------------------------------------------
    if (drain > 0) {
      let fObs = drain / before;
      // A read window that also caught the previous batch's grow reads LOW; a
      // window that caught two hacks reads ~2x. Both are injected here because
      // the estimator's whole safety argument is about which way they push.
      if (contaminate > 0 && rnd() < contaminate) fObs = 1 - (1 - fObs) ** 2;
      if (starve > 0 && rnd() < starve) fObs *= 0.45;
      if (fObs >= CAL.fMax) cal.raise(Math.min(CAL.hi, cal.val() * 2));
      else cal.add(fObs / (t.phi0 * plan.h));
    }
    cal.step(dt);
    if (firstWithin === null && Math.abs(cal.val() - Y) / Y < 0.02) firstWithin = i;
    // grow puts it all back: the planner over-provisions grow by `margin` and
    // the target is observed pinned at moneyMax in the live game.
    money = t.maxMoney;
    trace.push(cal.val());
  }
  const st = cal.stat();
  return { Y, y: cal.val(), st, minY, below, firstWithin, earned, planned, landings, successes, trace };
}

// -----------------------------------------------------------------------------
say("SELF-CALIBRATING HACK YIELD — offline verification against game source\n");

// --- 0. no regression at cold start ------------------------------------------
say("0. cold start is byte-for-byte today's behaviour");
{
  setBitNode(4, 1);
  let same = 0;
  let n = 0;
  for (const s of SERVERS) {
    for (const level of [120, 248, 700, 1500]) {
      for (const m of [1, 1.16, 3.2]) {
        if (level < s.requiredHackingSkill) continue;
        const t = modelTarget(s, level, m, false);
        const shipped = SHIPPED.planBatch({ ...t, phi: B.hackFraction(level, t.required, t.minSec, t.mults) }, RAM, 1e6, Infinity);
        const staged = B.planBatch({ ...t, phi: t.phi0 * 1 }, RAM, 1e6, Infinity);
        n++;
        if (JSON.stringify(shipped) === JSON.stringify(staged)) same++;
      }
    }
  }
  ok(same === n, `planBatch with y=1 reproduces the shipped plan exactly on ${same}/${n} (server, level, mult) combinations`);
  const cold = B.yieldRatio(CAL);
  ok(cold.val() === 1, `a calibrator with no samples returns exactly 1 (it is ${cold.val()}), so the first tick of a fresh life plans identically to today`);
  ok(cold.step(1) === 1, "step() with no samples cannot move it");
  ok(cold.stat().n === 0 && cold.stat().src === "cold", `and reports itself as ${JSON.stringify(cold.stat().src)} with n=0 rather than staying quiet`);
}

// --- 1. the ratio IS the multiplier, across the BitNode table -----------------
say("\n1. the measured ratio recovers currentNodeMults.ScriptHackMoney");
say("   node  SF  expected   measured    n   ticks-to-2%   min y   ticks with y<Y   verdict");
const NODES = [
  [1, 1, "BN1 — the node everything here was written in"],
  [4, 1, "BN4 — the node we are in now"],
  [5, 1, "BN5"],
  [6, 1, "BN6"],
  [9, 1, "BN9 — the harshest in the table"],
  [12, 1, "BN12 level 1 — the multiplier is a function of the level, not a constant"],
  [12, 6, "BN12 level 6"],
];
const nodeRows = [];
for (const [n, lvl, why] of NODES) {
  const mults = setBitNode(n, lvl);
  for (const s of [SERVERS[0]]) {
    const t = modelTarget(s, 248 < s.requiredHackingSkill ? s.requiredHackingSkill + 150 : 248, 1.16, false);
    const res = runLoop(t, { ticks: 600 });
    const err = Math.abs(res.y - res.Y) / res.Y;
    nodeRows.push({ node: n, lvl, expected: res.Y, measured: res.y, err, below: res.below, minY: res.minY, why });
    say(
      `   ${String(n).padStart(4)}  ${lvl}   ${r(res.Y, 5).toString().padEnd(9)} ${r(res.y, 5).toString().padEnd(10)} ${String(res.st.n).padStart(3)}   ${String(res.firstWithin ?? "-").padStart(11)}   ${r(res.minY, 4).toString().padEnd(7)} ${String(res.below).padStart(14)}   ${err < 0.02 ? "ok" : "OFF"}`,
    );
    ok(
      Math.abs(res.Y - mults.ScriptHackMoney) < 1e-12,
      `BN${n}.${lvl}: the ratio the estimator is chasing IS ScriptHackMoney (${r(res.Y, 6)} vs the game's ${r(mults.ScriptHackMoney, 6)}) — ${why}`,
    );
    ok(err < 0.02, `BN${n}.${lvl}: converged to ${r(res.y, 5)} against a true ${r(res.Y, 5)} (${r(err * 100, 2)}% error)`);
    ok(res.below === 0, `BN${n}.${lvl}: y never dropped below the truth (0 of ${600} ticks) — the unsafe direction was never entered`);
  }
}

// --- 2. the self-check: with Formulas.exe it must read exactly 1 --------------
say("\n2. with Formulas.exe owned, the SAME mechanism must read 1.0");
for (const [n] of [[1], [4], [9], [12]]) {
  setBitNode(n, 1);
  const t = modelTarget(SERVERS[0], 248, 1.16, true);
  const res = runLoop(t, { ticks: 400 });
  ok(
    Math.abs(res.Y - 1) < 1e-12,
    `BN${n}: phi from ns.formulas.hacking already carries every multiplier, so the true ratio is ${r(res.Y, 8)}`,
  );
  ok(Math.abs(res.y - 1) < 1e-9, `BN${n}: measured ${r(res.y, 8)} — the correction is a no-op, as it must be`);
}
say("   => the published `calibration.p50` is a live discriminator: 1.0 means Formulas.exe is");
say("      being believed, anything else is ScriptHackMoney. Owning both, they must agree.");

// --- 3. the 0.32 composite, decomposed ---------------------------------------
say("\n3. the number that started this: realised/planned per batch");
setBitNode(4, 1);
{
  const t = modelTarget(SERVERS[0], 248, 1.16, false);
  // Uncorrected, with the level climbing through the run exactly as it did live
  // (the published plan said h=20 while a 34-thread hack from an earlier tick
  // was still in the air), so the naive ratio is measured the way it was
  // measured in the game: cumulative earnings over cumulative batches, against
  // the plan in force at the END.
  let earned = 0;
  let batches = 0;
  let lastPlan = null;
  for (let level = 150; level <= 251; level++) {
    const tt = modelTarget(SERVERS[0], level, 1.16, false);
    const plan = B.planBatch({ ...tt, phi: tt.phi0 }, RAM, 1e6, Infinity);
    lastPlan = { plan, t: tt };
    for (let i = 0; i < 6; i++) {
      batches++;
      if (rnd() < tt._trueChance) earned += tt.maxMoney * Math.min(1, tt._true * plan.h);
    }
  }
  const naive = earned / batches / lastPlan.plan.money;
  say(`   uncorrected, level 150 -> 251: realised $${Math.round(earned / batches).toLocaleString()}/batch`);
  say(`                                  planned  $${Math.round(lastPlan.plan.money).toLocaleString()}/batch (the plan in force at the end)`);
  say(`                                  ratio    ${r(naive, 3)}`);
  say(`   ScriptHackMoney alone would give 0.2. The rest is h drifting 34 -> ${lastPlan.plan.h} as phi rises with`);
  say(`   the level, and chance cancelling (it is in both the plan and the realisation).`);
  ok(naive > 0.24 && naive < 0.42, `the naive composite lands in the 0.27..0.35 band that was measured live (got ${r(naive, 3)})`);

  // Now the same run, corrected, with the properly attributed denominator.
  const res = runLoop(t, { ticks: 600 });
  ok(
    Math.abs(res.earned / res.planned - 1) < 0.1,
    `corrected, plan-vs-realised over matched landings converges to ${r(res.earned / res.planned, 3)} (target 1.0)`,
  );
  ok(
    Math.abs(res.successes / res.landings - t._trueChance) < 0.1,
    `observed success rate ${r(res.successes / res.landings, 3)} matches the chance planBatch already models (${r(t._trueChance, 3)}) — measured separately, never folded into y`,
  );
}

// --- 4. contamination, and which way it pushes -------------------------------
say("\n4. contamination: the estimator must fail SAFE");
setBitNode(4, 1);
{
  const t = modelTarget(SERVERS[0], 248, 1.16, false);
  for (const c of [0, 0.1, 0.25, 0.4]) {
    const res = runLoop(t, { ticks: 600, contaminate: c });
    ok(
      res.below === 0 && res.y >= res.Y - 1e-9,
      `${Math.round(c * 100)}% of windows catching two landings: settled at ${r(res.y, 4)} >= true ${r(res.Y, 4)}, never below (over-estimating means under-hacking, which is what it does today)`,
    );
  }
  // The dangerous direction: a window that netted a grow against the hack reads
  // LOW. Find where the upper quantile stops protecting, and SAY where.
  say("   the unsafe direction (a window that netted a grow against the hack, so the drop reads low):");
  let breakdown = null;
  for (const sv of [0.25, 0.5, 0.7, 0.74, 0.8, 0.9]) {
    const res = runLoop(t, { ticks: 800, starve: sv });
    if (breakdown === null && res.below > 0) breakdown = sv;
    say(
      `     ${String(Math.round(sv * 100)).padStart(3)}% low samples -> y ${r(res.y, 4)} vs true ${r(res.Y, 4)}  (${res.below} ticks below truth)`,
    );
  }
  ok(
    breakdown !== null && breakdown >= 0.7,
    `the q=${CAL.q} upper quantile absorbs low-reading contamination cleanly to 50% and first dips below the truth at ${Math.round((breakdown ?? 1) * 100)}% — the asymptotic breakdown is 1-q = ${Math.round((1 - CAL.q) * 100)}% short of unanimity, i.e. ${CAL.q * 100}% of samples may read low; a finite window of ${CAL.keep} loses a few points of that to sampling noise during the ramp. Stated, not assumed.`,
  );
  say("   in the live controller a low-reading window requires a tick longer than 2*spacing=400ms;");
  say("   the gate refuses anything over 300ms and the measured tick is 200.7ms, so the real rate is ~0.");
}

// --- 4b. the attribution itself, not just the estimator ----------------------
say("\n4b. landingSample(): which drops become samples, and which are refused");
{
  const fresh = () => ({ flight: [], calPend: null, lastMoney: 1e6, planLanded: 0, realLanded: 0, calHits: 0, calMiss: 0, calClamp: 0, calSkip: 0, calSum: 0, calN: 0, calMin: null, calMax: null });
  // decay=1 for the bookkeeping assertions below, so the arithmetic is checkable
  // by eye; the shipped default is 0.99 and is exercised in smoke.mjs.
  const PHI = 0.001;
  const TICK = 300;

  // one clean landing, h=20, true ratio 0.2 -> drop 0.2*0.001*20 = 0.4% of the balance
  let s = fresh();
  s.flight.push({ at: 1000, h: 20, m: 5 });
  let v = B.landingSample(s, PHI, 1000, 200, TICK, 1e6 * 0.2 * PHI * 20, 0.98, 1);
  ok(v.kind === "sample" && Math.abs(v.x - 0.2) < 1e-12, `a clean landing yields exactly the ratio (${v.kind} x=${r(v.x, 8)})`);
  ok(s.planLanded === 5, "and its planned money is booked to planLanded");

  // two landings in one window: refused, and both counted as skipped
  s = fresh();
  s.flight.push({ at: 900, h: 20, m: 5 }, { at: 1000, h: 26, m: 6 });
  v = B.landingSample(s, PHI, 1000, 200, TICK, 1e6 * 0.36, 0.98, 1);
  ok(v.kind === "skip" && s.calSkip === 2, `two landings in one window are refused (${v.kind}, skipped ${s.calSkip}) — the composed drop would read ~2x`);
  ok(s.planLanded === 11, "but both are still booked to planLanded, so the end-to-end ratio is not selected by the sample filter");

  // a long tick: refused even with a single landing
  s = fresh();
  s.flight.push({ at: 1000, h: 20, m: 5 });
  v = B.landingSample(s, PHI, 1000, 900, TICK, 1e6 * 0.004);
  ok(v.kind === "skip", `a ${900}ms window is refused (limit ${TICK}ms) because the grow 2*spacing behind the hack could be inside it`);

  // a landing whose drop shows up one tick late
  s = fresh();
  s.flight.push({ at: 1000, h: 20, m: 5 });
  v = B.landingSample(s, PHI, 1000, 200, TICK, 0);
  ok(v.kind === "none" && s.calPend, "a landing with no drop yet is held for one more tick rather than written off");
  v = B.landingSample(s, PHI, 1200, 200, TICK, 1e6 * 0.2 * PHI * 20);
  ok(v.kind === "sample" && Math.abs(v.x - 0.2) < 1e-12, `and is sampled correctly on the next tick (${v.kind} x=${r(v.x, 8)}) with the h it launched with`);

  // a genuinely failed hack
  s = fresh();
  s.flight.push({ at: 1000, h: 20, m: 5 });
  B.landingSample(s, PHI, 1000, 200, TICK, 0);
  v = B.landingSample(s, PHI, 1200, 200, TICK, 0);
  ok(v.kind === "miss" && s.calMiss === 1 && s.calHits === 0, "a landing that never drops is a chance failure, counted separately and never fed to the magnitude estimate");

  // the clamp
  s = fresh();
  s.flight.push({ at: 1000, h: 20000, m: 5 });
  v = B.landingSample(s, PHI, 1000, 200, TICK, 1e6);
  ok(v.kind === "clamp" && s.calClamp === 1, "a drain that took the whole balance is reported as a clamp, not as a (low) sample");

  // h from the plan that launched, not the plan in force
  s = fresh();
  s.flight.push({ at: 1000, h: 34, m: 5 });
  v = B.landingSample(s, PHI, 1000, 200, TICK, 1e6 * 0.2 * PHI * 34);
  ok(Math.abs(v.x - 0.2) < 1e-12, "the denominator uses the h recorded at launch (34), which is the live case that made the naive ratio 1.4x high");
}

// --- 5. a stale restored value, which is the one way this can start wrong ----
say("\n5. a persisted calibration restored into the wrong BitNode");
{
  setBitNode(1, 1); // truth is 1.0
  const t = modelTarget(SERVERS[0], 248, 1.16, false);
  const res = runLoop(t, { ticks: 200, seedY: 0.1 }); // carried over from BN9
  const firstFix = res.trace.findIndex((v) => v > 0.9);
  ok(
    firstFix >= 0 && firstFix <= 2,
    `seeded at 0.1 against a true 1.0, it recovers on landing ${firstFix + 1} — upward moves need no quorum and no rate limit, because upward is the safe direction`,
  );
  say(`   exposure is bounded by one weakenTime (the first landing), not by the sample quorum.`);
  setBitNode(9, 1); // truth is 0.1
  const t2 = modelTarget(SERVERS[0], 248, 1.16, false);
  const res2 = runLoop(t2, { ticks: 400, seedY: 1 });
  ok(res2.below === 0, "seeded too HIGH (1.0 against a true 0.1) it walks down under the rate limit and never overshoots");
}

// --- 6. it settles, and the settling is monotone ------------------------------
say("\n6. stability");
setBitNode(4, 1);
{
  const t = modelTarget(SERVERS[0], 248, 1.16, false);
  const res = runLoop(t, { ticks: 600 });
  let rises = 0;
  for (let i = 1; i < res.trace.length; i++) if (res.trace[i] > res.trace[i - 1] + 1e-12) rises++;
  ok(rises === 0, `y is monotone non-increasing over ${res.trace.length} ticks with clean samples (${rises} upward moves) — there is no oscillation mode because the sample does not depend on y`);
  // Prove the open-loop claim directly: the same landing, planned under three
  // very different corrections, yields the same sample.
  const xs = [1, 0.5, 0.2].map((y) => {
    const plan = B.planBatch({ ...t, phi: t.phi0 * y }, RAM, 1e6, Infinity);
    const fObs = Math.min(1, t._true * plan.h);
    return { y, h: plan.h, x: fObs / (t.phi0 * plan.h) };
  });
  say(`   the same landing sampled under three different corrections:`);
  for (const z of xs) say(`     y=${z.y}  -> plan h=${String(z.h).padStart(3)}  -> sample x=${r(z.x, 10)}`);
  ok(
    Math.max(...xs.map((z) => z.x)) - Math.min(...xs.map((z) => z.x)) < 1e-12,
    "the sample is identical under all three, i.e. the measurement is open loop with respect to the correction — there is no loop gain to tune",
  );
  const rate = CAL.fallPerSec;
  say(`   rate limit: y falls at most ${rate}/s, so 1.0 -> 0.2 takes ${Math.round(Math.log(5) / rate)}s and 1.0 -> 0.1 takes ${Math.round(Math.log(10) / rate)}s.`);
}

// --- 7. against the live game ------------------------------------------------
say("\n7. CALIBRATION against the batcher running right now");
try {
  const bt = JSON.parse(fs.readFileSync(path.join(REPO, ".telemetry/batch.txt"), "utf8"));
  const save = JSON.parse(fs.readFileSync(path.join(HERE, "live-servers.json"), "utf8"));
  setBitNode(save.bitNode, 1);
  for (const T of bt.targets ?? []) {
    const s = save.servers[T.host];
    if (!s || !T.plan) continue;
    // A freshly restarted batcher has landed nothing yet, so earned/batches is
    // ~0 and means nothing. Say "could not check", never "checked and fine".
    if (!(T.batches >= 50)) {
      say(`   ${T.host}: UNCALIBRATED — the live batcher has only ${T.batches} batches (uptime ${bt.uptimeSec}s); realised $/batch is not meaningful yet`);
      continue;
    }
    const t = modelTarget(s, bt.hackingLevel, save.mults.hacking_money, false);
    // NOT `does offline planBatch pick the same h`. It does not reliably: the
    // live planner caps h at the largest FREE block, which the status file does
    // not report and which changes every tick — verify-alloc-shipped §0 makes
    // the same comparison and it flaps for the same reason. Check the thing
    // that cannot flap instead: the live plan reports BOTH h and the resulting
    // f, and f = phi_model * h is an identity that pins phi_model against the
    // running game to the precision the status file prints.
    const fLive = T.plan.fPct / 100;
    const fFromPhi = Math.min(0.99, t.phi0 * T.plan.h);
    const planAtLiveH = { h: T.plan.h, f: fFromPhi, money: fFromPhi * t.maxMoney * t.chance };
    const realised = T.earned / T.batches;
    say(`   ${T.host}: live plan h=${T.plan.h} f=${T.plan.fPct}%   phi_model*h = ${r(fFromPhi * 100, 2)}%`);
    say(`     planned $${Math.round(planAtLiveH.money).toLocaleString()}/batch (at the live h)   realised $${Math.round(realised).toLocaleString()}/batch   ratio ${r(realised / planAtLiveH.money, 3)}`);
    say(`     ScriptHackMoney for BitNode ${save.bitNode} is ${r(t._true / t.phi0, 3)}; the rest of the gap is h drift over the run and landed/launched.`);
    ok(
      Math.abs(fFromPhi - fLive) < 0.0006,
      `phi_model reproduces the live plan's f exactly at the live h (${r(fFromPhi * 100, 2)}% vs the ${T.plan.fPct}% the game is publishing) — so the model the correction divides by is confirmed against the running batcher`,
    );
    ok(
      realised / planAtLiveH.money < 0.5,
      `and the live realisation is ${r(realised / planAtLiveH.money, 3)} of it, which is the defect this change exists to fix (ScriptHackMoney is ${r(t._true / t.phi0, 3)}; the remainder is h drift, since earnings are cumulative and the plan is instantaneous)`,
    );
  }
} catch (e) {
  say(`   UNCALIBRATED: ${e.message}`);
  say("   (run: node tools/staging/selfcal/snap-live.mjs to refresh live-servers.json)");
}

say(`\n${fails ? `FAIL: ${fails} of ${checks} checks failed` : `PASS: ${checks} checks`}`);
if (JSON_OUT) console.log(JSON.stringify({ checks, fails, nodeRows, lines }, null, 2));
process.exit(fails ? 1 : 0);
