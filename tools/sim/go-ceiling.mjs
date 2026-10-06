import { fileURLToPath } from "node:url";
// Go node power per hour of the AI's OWN time, per board size: what a policy
// ACHIEVED against the game's AI, and an optimistic CEILING no policy of the
// kind observed can pass. Our think time is taken as zero throughout (the
// question is whether a bigger board can beat 5x5 at all, not with today's
// solver latency).
//
// CALIBRATION (2026-10-06): the AI-time model is checked live by
// go-turntime.mjs (522 live 5x5 Tetrads games: 0.72% error with browser
// stalls set aside; stalls are 2.7% of replies and 11% of AI time). Policy
// STRENGTH is checked only at 5x5: the harness running the live policy
// (model session, power objective, 800ms) earned 1.537 points per AI-second
// against 1.661 live (-7.5%: live has the opening book, pre-sent ponders and
// the adaptive budget). Bigger boards have no live games — their rows are
// harness-only, NOT CALIBRATED against the live game.
//
//   node tools/sim/go-ceiling.mjs --live .telemetry/go-games.txt [--live-timer per-game.jsonl] \
//        --arm NAME=FILE.jsonl[:SEED][,FILE2.jsonl[:SEED2]] ... [--json]
//
// --live-timer: go-turntime.mjs --per-game output (live games re-timed with
// browser stalls removed). :SEED = the run's --layoutseed (playable area).
//
// node power per game = black.sum x difficulty x streak (scoring.ts:86-88,
// effect.ts:119-135); at a 100% win rate the streak multiplier is its cap, 3,
// and Tetrads/Daedalus difficulty is (5.5+0.5)/4 = 1.5 (Netburners 0.5,
// Illuminati 2 — or 8 on 5x5 only). So power/h = 3600 x 3 x difficulty x
// (sum black) / (sum AI seconds), a ratio of sums over the games.
//
// AI SECONDS per game = sum over its replies of 200 x waitCycles + 10 x rows
// (+ compute). The timer part is exact (go-turntime.mjs checks it against the
// live log: per reply case within ~7ms, 0.7% overall with page stalls set
// aside). `timer` columns use the timers alone; `+cpu` adds the AI's compute
// as measured in node (the harness's oppMs) — on 5x5 that is ~7ms a reply live
// and in node alike; on 13x13 it is NOT CALIBRATED (no live 13x13 game), so
// read `timer` as the defensible number and `+cpu` as the likely one.
//
// CEILINGS (stated assumptions, all optimistic for the board in question):
//   ceilA = mean playable area / (min AI replies seen in any game x floor)
//           — every point ours, as few AI replies as the shortest game seen,
//           each at the absolute floor of a reply (FLOOR below: Tetrads 4
//           waitCycles = 0.8s, no row scan, no compute).
//   ceilB = mean playable area / (min AI timer-seconds of any game seen)
//           — every point ours, in the fastest game seen.
// Neither is a theorem about every conceivable policy: the number of AI
// replies a game needs is bounded below only by the stones we place
// (each of our stones is answered), and that is not bounded usefully by
// the rules alone. They bound what the policies measured here could reach
// if they took the whole board in their shortest game.

import fs from "node:fs";
import path from "node:path";
const SIM = process.env.GO_SIM ?? path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const all = (n) => argv.flatMap((a, i) => (a === `--${n}` ? [argv[i + 1]] : []));
const str = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const JSON_OUT = argv.includes("--json");
const DIFF = { Tetrads: 1.5, Daedalus: 1.5, Netburners: 0.5, Illuminati: 2, TheBlackHand: 1, SlumSnakes: 1 };
const STREAK = 3;
// The floor of one AI reply, in waitCycles x 200ms, by opponent (goAI.ts):
// Tetrads always opens with capture() and defendCapture()/a second capture()
// (2 retrieveMoveOption cycles) after getMove's, plus handleNextTurn's (or
// the pass path's final cycle): 4. Daedalus takes the Illuminati path 90% of
// the time (4) but on rng >= 0.9 falls straight to the move list: getMove +
// final + handleNextTurn = 3. Netburners' expansion/growth/random replies are
// synchronous: getMove + handleNextTurn = 2.
const FLOOR = { Tetrads: 0.8, Daedalus: 0.6, Netburners: 0.4, Illuminati: 0.8 };

let g = null;
async function bundle() {
  if (g) return g;
  await import(path.join(SIM, "env.mjs"));
  g = await import(path.join(SIM, "game.bundle.mjs"));
  return g;
}
const { dealPaired } = await import(path.join(SIM, "go-board.mjs"));

// Bootstrap CI of a ratio of sums (games resampled).
function ratioCI(xs, ys, B = 4000) {
  const n = xs.length;
  const est = xs.reduce((s, v) => s + v, 0) / ys.reduce((s, v) => s + v, 0);
  if (n < 2) return { est, lo: NaN, hi: NaN };
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const r = [];
  for (let b = 0; b < B; b++) {
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) {
      const j = Math.floor(rnd() * n);
      sx += xs[j];
      sy += ys[j];
    }
    r.push(sx / sy);
  }
  r.sort((a, b) => a - b);
  return { est, lo: r[Math.floor(0.025 * B)], hi: r[Math.floor(0.975 * B)] };
}

const rows = [];

// --- the live game (5x5 reference) -------------------------------------
const LIVE = str("live", null);
if (LIVE) {
  const L = fs.readFileSync(LIVE, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const bySize = new Map();
  for (const r of L) {
    const k = `${r.opponent}@${r.size}`;
    if (!bySize.has(k)) bySize.set(k, []);
    bySize.get(k).push(r);
  }
  for (const [k, games] of bySize) {
    const [opp, size] = k.split("@");
    // AI seconds = the logged play-call times p (pure AI time, incl. the
    // browser's stalls); `timer` = the same with stalls (>= 1.6s over the
    // reply's own floor) clipped is not knowable without the replay, so the
    // live row reports p as logged and the stall-free figure from
    // go-turntime.mjs separately.
    const ai = games.map((r) => r.moves.reduce((s, m) => s + m.p, 0) / 1000); // incl. the AI's game-ending pass after ours
    const black = games.map((r) => r.black);
    const area = games.map((r) => (r.start.match(/\./g) || []).length);
    const turns = games.map((r) => r.moves.filter((m) => m.r !== "G" || (m.m === "P" && m.p > 50)).length);
    const wall = [];
    for (let i = 1; i < games.length; i++) {
      const d = (Date.parse(games[i].at) - Date.parse(games[i - 1].at)) / 1000;
      if (d < 120) wall.push({ d, b: games[i].black });
    }
    rows.push({
      arm: `LIVE ${opp}`,
      size: +size,
      opp,
      games: games.length,
      won: games.filter((r) => r.won).length,
      black: black.reduce((s, v) => s + v, 0) / games.length,
      area: area.reduce((s, v) => s + v, 0) / games.length,
      turns: turns.reduce((s, v) => s + v, 0) / games.length,
      minTurns: Math.min(...turns),
      timerS: ai.reduce((s, v) => s + v, 0) / games.length,
      minTimerS: Math.min(...ai),
      rateTimer: ratioCI(black, ai),
      rateCpu: ratioCI(black, ai),
      wallRate: wall.length ? wall.reduce((s, x) => s + x.b, 0) / wall.reduce((s, x) => s + x.d, 0) : null,
    });
  }
}

// --- the live games re-timed by go-turntime.mjs --per-game (stalls removed) ---
const LT = str("live-timer", null);
if (LT) {
  const P = fs.readFileSync(LT, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const black = P.map((x) => x.black), t = P.map((x) => x.timerS), p = P.map((x) => x.pS);
  const turns = P.map((x) => x.aiTurns);
  rows.push({
    arm: `LIVE ${P[0].opponent} no-stall`,
    size: P[0].size,
    opp: P[0].opponent,
    games: P.length,
    won: P.filter((x) => x.won).length,
    black: black.reduce((s, v) => s + v, 0) / P.length,
    area: P.reduce((s, x) => s + x.area, 0) / P.length,
    turns: turns.reduce((s, v) => s + v, 0) / P.length,
    minTurns: Math.min(...turns),
    timerS: t.reduce((s, v) => s + v, 0) / P.length,
    minTimerS: Math.min(...t),
    rateTimer: ratioCI(black, t),
    rateCpu: ratioCI(black, t),
  });
}

// --- harness arms (tools/sim/go-w0.mjs JSONL) -----------------------------
for (const spec of all("arm")) {
  const [name, rest] = spec.split("=");
  // FILE[:SEED][,FILE[:SEED]...] — several runs pooled into one arm.
  let start = null;
  const games = [];
  const area = [];
  for (const part of rest.split(",")) {
    const [file, seedS] = part.split(":");
    const recs = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const st0 = recs.find((r) => r.kind === "start");
    if (start && (st0.size !== start.size || st0.opponent !== start.opponent)) throw new Error(`--arm ${name}: pooled runs differ in size/opponent`);
    start = start ?? st0;
    const gs = recs.filter((r) => r.kind === "game");
    games.push(...gs);
    if (seedS !== undefined) {
      const gb = await bundle();
      for (const r of gs) area.push(dealPaired(gb, st0.size, st0.opponent, Number(seedS), r.i).board.flat().filter((p) => p).length);
    }
  }
  if (!games.length) continue;
  const size = start.size, opp = start.opponent;
  if (area.length && area.length !== games.length) throw new Error(`--arm ${name}: give a seed for every pooled run or none`);
  const black = games.map((r) => r.black);
  const timer = games.map((r) => (r.oppCycles * 200 + r.oppRows * 10) / 1000);
  const cpu = games.map((r, j) => timer[j] + (r.oppMs ?? 0) / 1000);
  const turns = games.map((r) => r.oppTurns);
  rows.push({
    arm: name,
    size,
    opp,
    games: games.length,
    won: games.filter((r) => r.won).length,
    black: black.reduce((s, v) => s + v, 0) / games.length,
    area: area.length ? area.reduce((s, v) => s + v, 0) / area.length : null,
    turns: turns.reduce((s, v) => s + v, 0) / games.length,
    minTurns: Math.min(...turns),
    timerS: timer.reduce((s, v) => s + v, 0) / games.length,
    minTimerS: Math.min(...timer),
    cpuMsPerReply: games.reduce((s, r) => s + (r.oppMs ?? 0), 0) / turns.reduce((s, v) => s + v, 0),
    msPerReply: (1000 * timer.reduce((s, v) => s + v, 0)) / turns.reduce((s, v) => s + v, 0),
    rateTimer: ratioCI(black, timer),
    rateCpu: ratioCI(black, cpu),
  });
}

const ph = (r, x) => Math.round(x * 3600 * STREAK * (DIFF[r.opp] ?? NaN));
for (const r of rows) {
  r.powerH = { timer: ph(r, r.rateTimer.est), timerLo: ph(r, r.rateTimer.lo), timerHi: ph(r, r.rateTimer.hi), cpu: ph(r, r.rateCpu.est) };
  if (r.area) {
    r.ceilA = ph(r, r.area / (r.minTurns * (FLOOR[r.opp] ?? 0.4)));
    r.ceilB = ph(r, r.area / r.minTimerS);
    r.areaFrac = r.black / r.area;
  }
}
if (JSON_OUT) console.log(JSON.stringify(rows, null, 1));
else {
  console.log("power/h at streak x3, difficulty by opponent; AI time only (ours = 0). 95% CI: bootstrap over games.");
  console.log("arm                       n  won  black   area  frac  AIturns(min) pts/turn AIs/game(min) ms/reply  pts/AIs   power/h timer [95% CI]      +cpu   ceilA   ceilB");
  for (const r of rows) {
    console.log(
      `${r.arm.padEnd(24)} ${String(r.games).padStart(3)} ${String(r.won).padStart(4)} ${r.black.toFixed(1).padStart(6)} ${(r.area ?? NaN).toFixed(1).padStart(6)} ${(r.areaFrac ?? NaN).toFixed(2).padStart(5)} ${r.turns.toFixed(1).padStart(7)}(${r.minTurns}) ${(r.black / r.turns).toFixed(2).padStart(6)} ${r.timerS.toFixed(1).padStart(8)}(${r.minTimerS.toFixed(1)}) ${(r.msPerReply ?? (1000 * r.timerS) / r.turns).toFixed(0).padStart(8)} ${r.rateTimer.est.toFixed(3).padStart(8)} ${String(r.powerH.timer).padStart(9)} [${r.powerH.timerLo}-${r.powerH.timerHi}] ${String(r.powerH.cpu).padStart(8)} ${String(r.ceilA ?? "-").padStart(7)} ${String(r.ceilB ?? "-").padStart(7)}${r.wallRate ? `  (live wall clock ${ph(r, r.wallRate)}/h)` : ""}`,
    );
  }
}
process.exit(0);
