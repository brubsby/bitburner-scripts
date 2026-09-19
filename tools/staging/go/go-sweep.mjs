// Which IPvGO (boardSize, thinkTime) maximises faction-reputation NODE POWER
// PER HOUR — re-run with the obstacle-layout seed fixed.
//
//   node tools/staging/go/go-sweep.mjs --games 20 --worker 0 --out res/S-0.jsonl
//   node tools/staging/go/go-lab-report.mjs --idle 100 --solverpoll 400 res/S-*.jsonl
//
// ---------------------------------------------------------------------------
// WHY THIS SUPERSEDES tools/sim/go-boardsize.mjs
//
// That file's 1,099 games, and the "move Go to 5x5 @800ms" recommendation built
// on them, were all played on a SINGLE OBSTACLE LAYOUT PER BOARD SIZE.
//
// addObstacles (src/Go/boardState/offlineNodes.ts:13) seeds its generator with
//     const rng = new WHRNG(Player.totalPlaytime ?? new Date().getTime());
// and offline `Player.totalPlaytime` is **0**. `0 ?? x` evaluates to 0 —
// nullish coalescing only catches null/undefined, not zero — so the fallback to
// the wall clock NEVER fires and the seed is literally 0 on every single call.
//
// Measured, not inferred: 30 consecutive getNewBoardState(5, Daedalus, true)
// calls produced exactly ONE distinct layout, '.....|.....|.....|.....|....#'.
// With totalPlaytime randomised per game, 200 boards produce 136 distinct
// layouts. Live, totalPlaytime is in the hundreds of millions of ms and
// advances every tick, so the real game varies the layout constantly.
//
// The consequence is not subtle. On the fixed layout the solver won 97.4% of
// 114 games; on randomised layouts the SAME solver won 85.4% of 41. The live
// game at the time read 83.7%. The harness had been measuring one unusually
// easy position and calling it a win rate.
//
// This is the same class of bug tools/sim/go-boardsize.mjs's own header
// diagnoses for getMove — goAI.ts:184 seeding from Player.totalPlaytime — and
// fixes by threading an explicit `rngOverride` per move. addObstacles simply
// has no override parameter to thread, so nothing was fixed there and nobody
// noticed. Both halves are fixed here: the per-move rngOverride is carried over
// verbatim, and the layout seed is randomised by setting Player.totalPlaytime
// around the getNewBoardState call (see playGame).
//
// ⇒ ANY BOARD-SIZE NUMBER PREDATING THIS FIX WAS MEASURED ON ONE LAYOUT.
//   Numbers from this file are measured on a fresh layout per game.
//
// ---------------------------------------------------------------------------
// WHAT IS BEING MEASURED, and against what
//
// The objective is node power per hour. scoring.ts:86-89, on EVERY completed
// game, win or lose:
//     statusToUpdate.nodePower +=
//       score[black].sum
//       * getDifficultyMultiplier(score[white].komi, boardSize)
//       * getWinstreakMultiplier(winStreak, oldWinStreak);
// Win rate, games/hour and moves/game are diagnostics that explain the ranking;
// they are not the ranking.
//
//   * getDifficultyMultiplier (effect.ts:132-135) is (komi + 0.5) * 0.25, a
//     function of komi ONLY — its boardSize argument is used for exactly one
//     special case, 5x5 vs Illuminati. Against Daedalus (komi 5.5,
//     Constants.ts:46-47) it is 1.5 at every board size, so a point on 5x5 is
//     worth exactly as much as a point on 13x13. This harness RECORDS it per
//     game from the game's own function rather than hardcoding 1.5, and the
//     report asserts it is constant across sizes instead of assuming it.
//
//   * getWinstreakMultiplier (effect.ts:119-130) is a 6x swing and is
//     PATH-DEPENDENT: 0.5 while the streak is negative, up to 5x for breaking a
//     losing streak, capping at 3x after 8 straight wins. A mean multiplier
//     cannot be derived from a win rate. The report therefore replays the
//     actual game sequence through the transcribed formula and bootstraps it to
//     a steady state; nothing is scored independently.
//
// The opponent is the game's own `getMove`. A hand-written opponent has twice
// reported a fake ~100% win rate for this solver in this project (CLAUDE.md,
// "Calibrate against the live game"). Do not make it a third time.
//
// The solver under test is golib-deployed.js — a byte-identical snapshot of the
// live root golib.js — with the deployed mirror-pass rule from go.js modelled on
// top, so the sweep ranks configurations for the bot we actually run.
//
// CALIBRATION: the live game plays 5x5 with the external solver at 1500ms, so
// the `5x1500` arm has a live counterpart and the report prints the error
// against .telemetry/go.txt on every run. At the time of writing the live
// figures were 90.9% win (80W/8L) and 8.87 stone-moves/game.

import os from "node:os";
import fs from "node:fs";

try {
  os.setPriority(19); // hard constraint: idle CPU only, the live game shares this machine
} catch {
  /* not fatal */
}

import "../../sim/env.mjs";

// waitCycle instrumentation, installed before the bundle is used and narrowed
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

const g = await import("../../sim/game.bundle.mjs");
const { GoColor, GoOpponent } = g;

const argv = process.argv.slice(2);
const str = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : dflt;
};
const num = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? Number(argv[i + 1]) : dflt;
};

const LIB = str("lib", new URL("./golib-experiment-pass-adaptive.js", import.meta.url).pathname);
const BASELIB = str("baselib", new URL("./golib-baseline.js", import.meta.url).pathname);
const SIZE = num("size", 5);
const MAXMS = num("maxms", 800);
const GAMES = num("games", 24);
const WORKER = num("worker", 0);
const OUT = str("out", null);
const OPPONENT = GoOpponent.Daedalus;

const cand = await import(LIB);
const base = await import(BASELIB);
const here = (f) => new URL(f, import.meta.url).pathname;
const vSelfAtari = await import(here("./golib-selfatari.js"));
const vSize = await import(here("./golib-size.js"));
const vEye = await import(here("./golib-eye.js"));
const vAtari = await import(here("./golib-atari.js"));
const vBoth = await import(here("./golib-both.js"));
// A snapshot of the LIVE root golib.js taken at 16:52 — the lead's false-eye
// fix, as actually deployed — and that same file with the size-aware heuristic
// added. This is the head-to-head the deploy decision actually rests on.
const vDeployed = await import(here("./golib-deployed.js"));
const vDeployedSize = await import(here("./golib-deployed-size.js"));

// ---------------------------------------------------------------------------
// ARMS. Each is a chooser: (boardStrings, valid, N, komi) -> ranked | [] | null
// `[]` and `null` both mean pass, matching go.js:271-274 and go-solver.mjs.
//
// `base` is tools/staging/go/golib-baseline.js: byte-identical to the shipped
// golib.js except for the `scratch.probe` -> `scratch.scan2` repair, without
// which NOTHING in this file can run (see NOTES).
// ---------------------------------------------------------------------------
// SWEEP ARMS: one per (boardSize, thinkTime) configuration, all against the
// CURRENT DEPLOYED solver (golib-deployed.js == live golib.js, eye fix included)
// and all with the deployed mirror-pass rule ON. Measuring board size against a
// solver we no longer run would answer a question nobody asked.
// A config key is `<size>x<maxms>` for the deployed solver, or `f<size>x<maxms>`
// for the early-exit-liberty build (golib-fast.js). The fast build is
// per-iteration IDENTICAL to the deployed one (tools/staging/go/equiv.mjs), so
// at the same TIME budget it is the same solver doing ~1.9x the search.
const vFast = await import(here("./golib-fast.js"));
const CONFIGS = str("configs", "5x400,5x800,5x1500,7x800,7x1500,9x800,9x1500")
  .split(",")
  .map((k) => {
    const fast = k.startsWith("f");
    const [size, maxms] = (fast ? k.slice(1) : k).split("x").map(Number);
    return [k, { lib: fast ? vFast : vDeployed, opts: null, size, maxms, mirrorPass: true }];
  });
const ARMS = Object.fromEntries(CONFIGS);

const ARM_NAMES = str("arms", CONFIGS.map(([k]) => k).join(",")).split(",");
for (const a of ARM_NAMES) if (!ARMS[a]) throw new Error(`unknown arm ${a}; have ${Object.keys(ARMS).join(",")}`);

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

/** WHRNG folds this to (v/1000) % 30000 (Casino/RNG.ts:45-50). */
const rngSeed = () => Math.floor(Math.random() * 30000 * 1000);

const margin = (state) => {
  const s = g.getScore(state);
  return s[GoColor.black].sum - s[GoColor.white].sum;
};

async function playGame(arm, N, komiOverride, boardSeed) {
  // netscriptGoImplementation.ts:368 — resetBoardState uses applyObstacles=true.
  // Daedalus gets no handicap stones (boardState.ts:100-107).
  // --- OBSTACLE LAYOUT MUST BE RANDOMISED, and offline it is not -----------
  //
  // addObstacles (Go/boardState/offlineNodes.ts:13) seeds its generator with
  //     new WHRNG(Player.totalPlaytime ?? new Date().getTime())
  // and offline `Player.totalPlaytime` is **0**. `0 ?? x` is 0 — nullish
  // coalescing only catches null/undefined — so the fallback to the clock never
  // fires and the seed is literally 0 on every call. Measured: 30 fresh 5x5
  // boards produced exactly ONE distinct layout ('.....|.....|.....|.....|....#').
  //
  // That is the same defect tools/sim/go-boardsize.mjs's header describes for
  // getMove, fixed there with an explicit rngOverride — but addObstacles takes
  // no override, and nothing fixed it, so every offline Go measurement in this
  // repo so far (1,099 games of board-size tuning included) was made against a
  // SINGLE obstacle layout per board size. Live, totalPlaytime is in the
  // billions and advances every tick, so live boards vary; the harness's win
  // rate was therefore measured on one position and the live one on thousands.
  //
  // Fixed the way the live game supplies it: give totalPlaytime a random
  // playtime-like value per game. WHRNG folds it to (v/1000) % 30000
  // (Casino/RNG.ts:45-50), so the spread has to be over seconds, not ms.
  // boardSeed is supplied by the caller so every ARM in a round starts from the
  // IDENTICAL obstacle layout. The outcome turned out to be dominated by the
  // layout — with one fixed layout the base arm won 97.4% and the mirror arm
  // 92.9% purely from unpaired board luck — so pairing is the difference
  // between measuring the rule and measuring the dice.
  const prevPlaytime = g.Player.totalPlaytime;
  g.Player.totalPlaytime = boardSeed;
  const state = g.getNewBoardState(N, OPPONENT, true);
  g.Player.totalPlaytime = prevPlaytime;
  g.Go.currentGame = state;
  g.Go.storedCycles = 1e9; // pin waitCycle to its 40ms branch so counts are unambiguous

  const startBoard = g.simpleBoardFromBoard(state.board);
  const komi = komiOverride ?? g.opponentDetails[OPPONENT].komi;

  let ourTurns = 0;
  let ourStones = 0;
  let ourPasses = 0;
  let firstPassPly = -1;
  let ourSolverMs = 0;
  let ourIters = 0;
  let oppTurns = 0;
  let oppPasses = 0;
  let oppComputeMs = 0;
  let oppCycles = 0;
  const traj = [];
  const msEach = [];
  const diag = [];
  // Did the opponent pass on its immediately preceding turn? This is exactly
  // what ns.go.makeMove's resolved Play tells go.js: handleNextTurn
  // (goAI.ts:92-94) calls passTurn then recurses, and the promise resolves with
  // getPreviousMoveDetails(), which is `type: 'pass'` whenever the board did
  // not change (boardAnalysis.ts:717-732).
  let oppPassedLast = false;
  // --- mass-capture instrumentation --------------------------------------
  // The user's report is "we get all of our pieces captured at once". Counted
  // as an event, not inferred from the score: black piece count immediately
  // before the opponent's move minus immediately after. getScore's `pieces` is
  // getColoredPieceCount (scoring.ts:133-138), a straight count of stones on
  // the board, so the difference is exactly what their move captured.
  const caps = [];       // opponent captures of OUR stones, {ply, n, board}
  const ourCaps = [];    // our captures of THEIRS, for context
  let maxCap = 0;
  let mirrorPasses = 0;
  let movesAfterFirstOppPass = 0;
  let sawOppPass = false;

  const guardLimit = N * N * 4;
  let guard = 0;

  while (state.passCount < 2 && guard++ < guardLimit) {
    // ---- our turn -------------------------------------------------------
    const simple = g.simpleBoardFromBoard(state.board);
    const valid = validGrid(state, N);

    // --- the mirror-pass rule ---------------------------------------------
    // Exact, not estimated: getScore (scoring.ts:20-40) is the same function
    // that decides the final result, and our pass here makes passCount 2
    // (boardState.ts:153-157), so the game ends on these very numbers. komi is
    // 5.5 (Constants.ts:46-47) so white's sum is always a half-integer and
    // black's always an integer: an exact tie is impossible, and `>` and the
    // game's own `>=` test (scoring.ts:56) can never disagree.
    if (arm.mirrorPass && oppPassedLast) {
      const sc = g.getScore(state);
      if (sc[GoColor.black].sum > sc[GoColor.white].sum) {
        g.passTurn(state, GoColor.black, false);
        ourTurns++;
        ourPasses++;
        mirrorPasses++;
        if (firstPassPly < 0) firstPassPly = ourTurns;
        msEach.push(0);
        traj.push(margin(state));
        break; // passCount is now 2; the loop condition would stop here anyway
      }
    }
    if (sawOppPass) movesAfterFirstOppPass++;

    const blackBeforeUs = g.getScore(state)[GoColor.black].pieces;
    const whiteBeforeUs = g.getScore(state)[GoColor.white].pieces;

    const t0 = process.hrtime.bigint();
    const ranked = arm.opts
      ? arm.lib.chooseMoveUCT(simple, valid, N, komi, arm.maxms, arm.opts)
      : arm.lib.chooseMoveUCT(simple, valid, N, komi, arm.maxms);
    const dt = Number(process.hrtime.bigint() - t0) / 1e6;
    ourSolverMs += dt;
    msEach.push(Math.round(dt));
    ourTurns++;
    ourIters += ranked?.[0]?.iters ?? 0;
    if (ranked?.[0]?.trace) {
      diag.push({
        ply: ourTurns,
        margin: margin(state),
        winRate: ranked[0].winRate,
        passVisits: ranked[0].passVisits,
        passMean: ranked[0].passMean,
        // [t, idx, v1, v2, mean, passMean] — array form, not objects: this is
        // the bulk of the file and the field names repeat 30k times otherwise.
        tr: ranked[0].trace.map((p) => [p.t, p.idx, p.v1, p.v2, p.mean, p.pmean]),
      });
    }

    if (ranked && ranked.length && g.makeMove(state, ranked[0].x, ranked[0].y, GoColor.black)) {
      ourStones++;
    } else {
      // allowEndGame=false: endGoGame reaches into Player/Factions; the streak
      // and node-power bookkeeping is replayed in the report instead.
      g.passTurn(state, GoColor.black, false);
      ourPasses++;
      if (firstPassPly < 0) firstPassPly = ourTurns;
    }
    {
      const wAfter = g.getScore(state)[GoColor.white].pieces;
      const taken = whiteBeforeUs - wAfter + (ranked && ranked.length ? 0 : 0);
      if (taken > 0) ourCaps.push({ ply: ourTurns, n: taken });
    }
    traj.push(margin(state));
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

    const blackBeforeThem = g.getScore(state)[GoColor.black].pieces;
    const boardBeforeThem = g.simpleBoardFromBoard(state.board);
    if (reply.type === "move") {
      g.makeMove(state, reply.x, reply.y, GoColor.white);
      const lost = blackBeforeThem - g.getScore(state)[GoColor.black].pieces;
      if (lost > 0) {
        if (lost > maxCap) maxCap = lost;
        // Keep the board only for the events worth looking at by hand; storing
        // every 1-stone capture would bury them.
        caps.push(lost >= 3 ? { ply: oppTurns + 1, n: lost, at: [reply.x, reply.y], board: boardBeforeThem } : { ply: oppTurns + 1, n: lost });
      }
      oppPassedLast = false;
    } else {
      g.passTurn(state, GoColor.white, false);
      oppPasses++;
      oppPassedLast = true;
      sawOppPass = true;
    }
    traj.push(margin(state));
  }

  const score = g.getScore(state);
  return {
    // From the game's own function, per game, never hardcoded: the whole board-size
    // question turns on whether a point is worth the same on 5x5 as on 13x13.
    // getDifficultyMultiplier (effect.ts:132-135) is (komi + 0.5) * 0.25 and uses
    // its boardSize argument for exactly one special case, 5x5 vs Illuminati.
    // Against Daedalus (komi 5.5, Constants.ts:46-47) it should be 1.5 at every
    // size — recorded so the report can assert that rather than assume it.
    difficulty: g.getDifficultyMultiplier(score[GoColor.white].komi, N),
    boardSeed,
    startBoard,
    black: score[GoColor.black].sum,
    white: score[GoColor.white].sum,
    blackPieces: score[GoColor.black].pieces,
    blackTerritory: score[GoColor.black].territory,
    whitePieces: score[GoColor.white].pieces,
    whiteTerritory: score[GoColor.white].territory,
    komi: score[GoColor.white].komi,
    truncated: guard >= guardLimit,
    ourTurns,
    ourStones,
    ourPasses,
    firstPassPly,
    ourSolverMs,
    ourIters,
    oppTurns,
    oppPasses,
    oppComputeMs,
    oppCycles,
    traj,
    msEach,
    diag,
    mirrorPasses,
    movesAfterFirstOppPass,
    sawOppPass,
    caps,
    ourCaps,
    maxCap,
  };
}

// ---------------------------------------------------------------------------
emit({ kind: "start", worker: WORKER, arms: ARM_NAMES, games: GAMES, pid: process.pid });

// Round-robin so every arm sees the same machine load over the life of the run.
for (let round = 0; round < GAMES; round++) {
  // One layout per round, shared by every arm in it.
  const boardSeed = Math.floor(Math.random() * 30000) * 1000 + 1;
  for (const name of ARM_NAMES) {
    const wall0 = Date.now();
    const r = await playGame(ARMS[name], ARMS[name].size, null, boardSeed);
    emit({
      kind: "game",
      worker: WORKER,
      arm: name,
      size: ARMS[name].size,
      maxms: ARMS[name].maxms,
      round,
      won: r.black >= r.white,
      ...r,
      simWallMs: Date.now() - wall0,
    });
  }
}

emit({ kind: "end", worker: WORKER });
