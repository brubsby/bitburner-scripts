// Which IPvGO board size maximises *faction reputation node power per hour*?
//
//   node tools/sim/go-boardsize.mjs --configs 5x1500,7x1500,9x1500,13x1500 \
//        --games 40 --worker 0 --out /path/results.jsonl
//
// ---------------------------------------------------------------------------
// CALIBRATION — read this before acting on anything downstream of this file.
//
// PRECONDITION — THE EXTERNAL SOLVER. Every number below is produced by
// golib.js's chooseMoveUCT at a real search budget, which in the live game
// means tools/go-solver.mjs is running: Netscript shares the browser's main
// thread, so go.js in-game searches at `maxms 20` and treats its own local
// search as a fallback ("local fallback only; the external solver does the
// real search", go.js:138). A run without the solver is NOT a slightly worse
// version of the configuration measured here — it is a regime none of these
// measurements describe, and go.js's own header records flat 20ms search
// losing 90 straight games to the Daedalus AI.
//
// This is stated because it silently failed: on 2026-09-20 the solver was
// found never to have been started across a 67-hour daemon session spanning
// BN5, BN2 and BN4, with `remoteMoves: 0` unread in /tel/go.txt. The daemon
// now supervises the solver and go.js reports `health: 'warn'` when it is not
// answering, so the precondition is checked at runtime as well as asserted
// here — but a reader reaching these numbers from outside that machinery still
// needs to know they do not apply to a solver-less run.
//
//
// This file MEASURES; it decides nothing on its own. It emits one JSONL record
// per game and tools/sim/go-boardsize-report.mjs turns those into the
// power-per-hour table and the board-size recommendation. **The live check
// therefore lives in the report, and it runs on every report run** — see the
// CALIBRATION block there for what is compared, against what, and to what
// tolerance. If that block says NOT CALIBRATED, this harness's output is not
// evidence for anything.
//
// What is NOT calibrated, and is the thing to be careful about:
//
//   * **The winning arm has never been observed.** The recommendation this
//     harness produced was to move Go from 9x9 to 5x5 (~1.9x node power per
//     hour). Every live cross-check that has ever been made of it was taken at
//     **9x9**, because 9x9 is what go.js has actually played. Nothing live has
//     ever confirmed the 5x5 win rate, the 5x5 score distribution or the 5x5
//     game length, and those three are the entire numerator and denominator of
//     the claim. The 1.9x is an extrapolation from a harness validated only on
//     the arm it recommends moving away from.
//
//   * Two live cross-checks WERE made when this file was written, at 9x9 with
//     maxms 1500: a harness win rate of 81.3% [72-88] against 78% observed
//     live, and a node power of 98.1/game backed out of a live 22.9%
//     faction_rep bonus against 114.6/game steady state here. Both are recorded
//     because they are the reason anyone believed this harness, and both are
//     **not reproducible from anything in this repo**: the JSONL they were
//     computed from is gone, and .telemetry/go.txt was reset by the 2026-09-11
//     prestige (it now reads 2-3 games at 9x9 maxms 20, a different regime). So
//     treat the two figures as provenance, not as a current check. The check
//     that is current is the one the report prints.
//
//   * The opponent is the game's own `getMove`, so the 100%-win-rate strawman
//     failure mode (go-tune.mjs's header) does not apply here. That fixes
//     fidelity of the RULES; it says nothing about whether the wall-clock model
//     in the report matches the live loop, which is what the turns-per-game
//     check in the report exists to test.
//
// Everything load-bearing comes from the game's own source. The opponent is
// `getMove` from src/Go/boardAnalysis/goAI.ts — the real one. A hand-written
// opponent has twice reported a fake ~100% win rate for this solver in this
// project; see the header of tools/sim/go-tune.mjs. Do not repeat it.
//
// WHAT DECIDES THE ANSWER (src/Go/boardAnalysis/scoring.ts:85-88):
//     statusToUpdate.nodePower +=
//       score[black].sum
//       * getDifficultyMultiplier(score[white].komi, boardState.board[0].length)
//       * getWinstreakMultiplier(winStreak, oldWinStreak);
// This runs on EVERY completed game, win or lose.
//
//   * getDifficultyMultiplier (src/Go/effects/effect.ts:132-135) is
//       (komi + 0.5) * 0.25
//     — a function of komi ONLY. The board-size argument is used for exactly
//     one special case, 5x5 vs Illuminati (komi 7.5) => 8. Against Daedalus
//     (komi 5.5, src/Go/Constants.ts:46-53) it is 1.5 at every board size.
//     So a point scored on 5x5 is worth exactly as much as a point on 13x13.
//
//   * getWinstreakMultiplier (effect.ts:119-130) is
//       winStreak < 0                      -> 0.5
//       oldWinStreak < 0 && winStreak > 0   -> 1 + 0.5*min(-oldWinStreak, 8)   (up to 5x)
//       otherwise                           -> 1 + 0.25*min(winStreak, 8)      (caps at 3x)
//     Note the middle branch: breaking a *losing* streak pays more than
//     extending a winning one. It is path-dependent, so the mean multiplier
//     cannot be derived from a win rate — this harness plays a long
//     consecutive sequence per configuration and lets streaks build and break.
//
// TWO FIDELITY FIXES OVER tools/sim/go-tune.mjs
//
// 1. RNG. goAI.ts:184 seeds the opponent with `new WHRNG(rngOverride ||
//    Player.totalPlaytime)`, and WHRNG's seed is `(seed/1000) % 30000`
//    (src/Casino/RNG.ts:45-50). Offline, Player.totalPlaytime never advances,
//    so every getMove call re-seeds identically and draws the SAME random
//    numbers — which pins `getDaedalusPriorityMove`'s `rng < 0.9` branch
//    (goAI.ts:369-375) to one side for the entire run. In the real game
//    playtime advances between moves. We therefore pass an explicit random
//    rngOverride per move, which is what a live, advancing playtime gives.
//
// 2. Wall clock. The opponent's cost is not CPU, it is `waitCycle`
//    (goAI.ts:877-883): sleep(40) while Go.storedCycles > 0, else sleep(200).
//    Those sleeps are real seconds in the live game but pure dead time here,
//    so we short-circuit them and COUNT them instead, then rebuild the live
//    wall clock analytically. Go.storedCycles only ever accrues from *offline*
//    time (Go.ts:61-65, engine.tsx:339), so a long live farming session runs
//    out and lands on the 200ms branch; both regimes are reported.

import os from "node:os";
import fs from "node:fs";

try {
  os.setPriority(19); // hard constraint: idle CPU only
} catch {
  /* not fatal */
}

import "./env.mjs";

// ---------------------------------------------------------------------------
// waitCycle instrumentation. Installed before the bundle is used, and narrowed
// to the two delays waitCycle can request so jsdom's own timers are untouched.
const realSetTimeout = globalThis.setTimeout;
const CYCLE_DELAYS = new Set([40, 200]);
let cycleCount = 0;
globalThis.setTimeout = function (fn, ms, ...rest) {
  if (CYCLE_DELAYS.has(ms)) {
    cycleCount++;
    return realSetTimeout(fn, 0, ...rest);
  }
  return realSetTimeout(fn, ms, ...rest);
};

const g = await import("./game.bundle.mjs");
const { chooseMoveUCT } = await import("../../golib.js");
const { GoColor, GoOpponent } = g;

// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const str = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : dflt;
};
const num = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? Number(argv[i + 1]) : dflt;
};

// Config syntax: SIZExMAXMS[@Opponent], e.g. "5x800" or "5x800@Illuminati".
// The opponent was a hardcoded constant until 2026-09-20; it is a per-config
// dimension because the CHANNEL a config farms (effect.ts:68-101 maps each
// opponent to a different multiplier) and the rate it farms at are decided by
// the same choice, and only the rate is measurable here. The report prices the
// channel; this file only ever reports node power per hour PER OPPONENT, which
// is not comparable across opponents without that pricing step.
const CONFIGS = str("configs", "5x1500,7x1500,9x1500,13x1500")
  .split(",")
  .map((s) => {
    const [spec, opp] = s.split("@");
    const [size, maxms] = spec.split("x").map(Number);
    const opponent = opp ? GoOpponent[opp] : GoOpponent.Daedalus;
    if (!opponent) throw new Error(`unknown opponent in config "${s}": ${opp}`);
    return { size, maxms, opponent, key: s };
  });
const GAMES = num("games", 40);
const WORKER = num("worker", 0);
const OUT = str("out", null);
const VERBOSE = argv.includes("--verbose");

// appendFileSync, not a write stream: a stream buffers, and a run this long is
// only steerable if each game lands on disk the moment it finishes.
const emit = (obj) => {
  const line = JSON.stringify(obj) + "\n";
  if (OUT) fs.appendFileSync(OUT, line);
  else process.stdout.write(line);
};

/** getAllValidMoves returns points; golib wants a [x][y] boolean grid. */
function validGrid(state, N) {
  const moves = g.getAllValidMoves(state, GoColor.black);
  const grid = Array.from({ length: N }, () => new Array(N).fill(false));
  for (const p of moves) grid[p.x][p.y] = true;
  return grid;
}

/**
 * A playtime-like millisecond value for the opponent's RNG seed. WHRNG folds
 * this to (v/1000) % 30000, so any spread over a few hours of "playtime" gives
 * the same distribution the live game does. See fidelity note 1 above.
 */
const rngSeed = () => Math.floor(Math.random() * 30000 * 1000);

async function playGame(N, maxms, OPPONENT) {
  // netscriptGoImplementation.ts:368 — resetBoardState uses applyObstacles=true.
  // Daedalus gets no handicap stones (boardState.ts:100-107).
  const state = g.getNewBoardState(N, OPPONENT, true);
  g.Go.currentGame = state;
  g.Go.storedCycles = 1e9; // pin waitCycle to its 40ms branch so counts are unambiguous

  const komi = g.opponentDetails[OPPONENT].komi;

  let ourTurns = 0;
  let ourStones = 0;
  let ourSolverMs = 0;
  let ourIters = 0;
  let oppTurns = 0;
  let oppComputeMs = 0;
  let oppCycles = 0;

  const guardLimit = N * N * 4;
  let guard = 0;

  while (state.passCount < 2 && guard++ < guardLimit) {
    // ---- our turn -------------------------------------------------------
    const simple = g.simpleBoardFromBoard(state.board);
    const valid = validGrid(state, N);

    const t0 = process.hrtime.bigint();
    const ranked = chooseMoveUCT(simple, valid, N, komi, maxms);
    ourSolverMs += Number(process.hrtime.bigint() - t0) / 1e6;
    ourTurns++;
    ourIters += ranked?.[0]?.iters ?? 0;

    if (ranked && ranked.length && g.makeMove(state, ranked[0].x, ranked[0].y, GoColor.black)) {
      ourStones++;
    } else {
      // allowEndGame=false: we replicate endGoGame's bookkeeping ourselves
      // rather than letting it reach into Player/Factions.
      g.passTurn(state, GoColor.black, false);
    }
    if (VERBOSE) {
      process.stderr.write(
        `turn ${guard} us=${ourSolverMs.toFixed(0)}ms opp=${oppComputeMs.toFixed(0)}ms cyc=${oppCycles}\n`,
      );
    }
    if (state.passCount >= 2) break;

    // ---- opponent turn --------------------------------------------------
    cycleCount = 0;
    const t1 = process.hrtime.bigint();
    const reply = await g.getMove(state, GoColor.white, OPPONENT, true, rngSeed());
    oppComputeMs += Number(process.hrtime.bigint() - t1) / 1e6;
    // handleNextTurn (goAI.ts:98) spends one more waitCycle after getMove
    // resolves, before the AI's stone is placed.
    oppCycles += cycleCount + (reply.type === "move" ? 1 : 0);
    oppTurns++;

    if (reply.type === "move") {
      g.makeMove(state, reply.x, reply.y, GoColor.white);
    } else {
      g.passTurn(state, GoColor.white, false);
    }
  }

  const score = g.getScore(state);
  return {
    black: score[GoColor.black].sum,
    white: score[GoColor.white].sum,
    komi: score[GoColor.white].komi,
    truncated: guard >= guardLimit,
    ourTurns,
    ourStones,
    ourSolverMs,
    ourIters,
    oppTurns,
    oppComputeMs,
    oppCycles,
  };
}

// ---------------------------------------------------------------------------
// Per-configuration streak bookkeeping, transcribed from endGoGame
// (src/Go/boardAnalysis/scoring.ts:52-88) and resetWinstreak (:113-122).
function newStats() {
  return { wins: 0, losses: 0, winStreak: 0, oldWinStreak: 0, highestWinStreak: 0, nodePower: 0 };
}

function applyResult(stats, blackSum, whiteSum, boardSize, komi) {
  if (blackSum < whiteSum) {
    // resetWinstreak(ai, true)
    stats.losses++;
    stats.oldWinStreak = stats.winStreak;
    if (stats.winStreak >= 0) stats.winStreak = -1;
    else stats.winStreak--;
  } else {
    stats.wins++;
    stats.oldWinStreak = stats.winStreak;
    stats.winStreak = stats.oldWinStreak < 0 ? 1 : stats.winStreak + 1;
    if (stats.winStreak > stats.highestWinStreak) stats.highestWinStreak = stats.winStreak;
  }
  const difficulty = g.getDifficultyMultiplier(komi, boardSize);
  const streak = g.getWinstreakMultiplier(stats.winStreak, stats.oldWinStreak);
  const power = blackSum * difficulty * streak;
  stats.nodePower += power;
  return { won: blackSum >= whiteSum, difficulty, streak, power };
}

// ---------------------------------------------------------------------------
const stats = new Map(CONFIGS.map((c) => [c.key, newStats()]));

emit({ kind: "start", worker: WORKER, configs: CONFIGS.map((c) => c.key), games: GAMES, pid: process.pid });

// Round-robin across configurations so every configuration sees the same
// machine load over the life of the run. Streaks are per-configuration and
// stay in game order, which is all the winstreak formula depends on.
for (let round = 0; round < GAMES; round++) {
  for (const cfg of CONFIGS) {
    const wall0 = Date.now();
    const r = await playGame(cfg.size, cfg.maxms, cfg.opponent);
    const s = stats.get(cfg.key);
    const applied = applyResult(s, r.black, r.white, cfg.size, r.komi);
    emit({
      kind: "game",
      worker: WORKER,
      config: cfg.key,
      size: cfg.size,
      maxms: cfg.maxms,
      opponent: cfg.opponent,
      round,
      ...r,
      ...applied,
      winStreak: s.winStreak,
      simWallMs: Date.now() - wall0,
    });
  }
}

emit({
  kind: "end",
  worker: WORKER,
  stats: Object.fromEntries([...stats.entries()].map(([k, v]) => [k, v])),
});
