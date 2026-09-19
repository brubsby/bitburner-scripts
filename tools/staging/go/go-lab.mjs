// IPvGO lab: measure pass behaviour, score trajectory, adaptive time and resign,
// against the game's REAL opponent.
//
//   node tools/staging/go/go-lab.mjs --arms base,pass,adapt --games 24 \
//        --size 5 --maxms 800 --worker 0 --out res.jsonl
//
// ---------------------------------------------------------------------------
// FIDELITY — everything load-bearing is the game's own code.
//
// This is tools/sim/go-boardsize.mjs's harness with per-ply instrumentation
// added. The two fidelity fixes documented there are carried over verbatim and
// are the reason its numbers were believed:
//
//   1. RNG. goAI.ts:184 seeds the opponent `new WHRNG(rngOverride ||
//      Player.totalPlaytime)`. Offline, totalPlaytime never advances, so every
//      getMove call re-seeds identically and pins getDaedalusPriorityMove's
//      `rng < 0.9` branch (goAI.ts:369-375) to one side for a whole run. We
//      pass an explicit random rngOverride per move. tools/sim/go-tune.mjs does
//      NOT, which is why its results are marked suspect; do not inherit it.
//
//   2. Wall clock. The opponent's cost is `waitCycle` (goAI.ts:877-883):
//      sleep(40) while Go.storedCycles > 0 else sleep(200). Those are real
//      seconds live and dead time here, so they are short-circuited and
//      COUNTED, and the live clock is rebuilt analytically in the report.
//
// The opponent is g.getMove — the real one. A hand-written opponent has twice
// reported a fake ~100% win rate for this solver in this project (CLAUDE.md,
// "Calibrate against the live game"). Do not make it a third time.
//
// WHAT IS INSTRUMENTED, and why each field exists
//
//   traj[]   black.sum - white.sum after EVERY ply, from the game's own
//            getScore (scoring.ts:20-40). This is the only way to answer
//            "did we have it won and give it back" as a measurement rather
//            than a story.
//   passes   how many of OUR turns were passes, and at which ply.
//   oppPass  how many of the OPPONENT's turns were passes. Decides whether
//            passing can end the game at all: passTurn only ends it at
//            passCount >= 2 (boardState.ts:146-157) and makeMove resets
//            passCount to 0 (boardState.ts:136), so our pass ends nothing
//            unless the opponent passes too.
//   msPerMove / iters   for the adaptive-time arm.
//
// NOT CALIBRATED, stated per CLAUDE.md rather than left silent: the live game
// has played 5x5 at maxms=20 with the external solver at 1500ms, so the live
// win rate (91W/14L) is a *different search budget* from any arm measured
// here. Win rates below are comparable to EACH OTHER under an identical
// opponent; they are not a reproduction of a live number. The one live
// quantity these runs can be checked against is our-turns-per-game
// (.telemetry/go.txt: moves/games), and the report prints that error.

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
const ARMS = {
  base: { lib: base, opts: null, maxms: MAXMS },
  // candidate 1: PASS competes honestly at the root
  pass: { lib: cand, opts: { allowPass: true, adaptive: false }, maxms: MAXMS },
  // control on the candidate file with the new code paths switched off, to
  // prove the rewrite itself changed nothing
  candbase: { lib: cand, opts: { allowPass: false, adaptive: false }, maxms: MAXMS },
  // DIAGNOSTIC arm: behaviourally identical to `base` (pass and adaptive both
  // off) but records, per move, what the search would have answered as a
  // function of think time, plus PASS's own root statistics. One run of this
  // answers the pass question, the adaptive-time question and the resign
  // question at once, instead of one live run per candidate threshold.
  diag: { lib: cand, opts: { allowPass: false, adaptive: false, trace: 50 }, maxms: MAXMS },
  // THE FIX under test: mirror the opponent's pass when we are ahead.
  // Not a solver change at all — a go.js-level rule, so it is modelled here as
  // a property of the arm rather than an option on chooseMoveUCT.
  mirror: { lib: base, opts: null, maxms: MAXMS, mirrorPass: true },
  mirrordiag: { lib: cand, opts: { allowPass: false, adaptive: false, trace: 50 }, maxms: MAXMS, mirrorPass: true },
  // adaptive time: same strength target, less clock
  adapt: { lib: cand, opts: { allowPass: false, adaptive: true }, maxms: MAXMS },
  adaptpass: { lib: cand, opts: { allowPass: true, adaptive: true }, maxms: MAXMS },
  // --- life-and-death candidates, one change each ---------------------------
  // Every one of these keeps the mirror-pass rule ON, so they are measured
  // against the behaviour that is actually deployed.
  selfatari: { lib: vSelfAtari, opts: null, maxms: MAXMS, mirrorPass: true },
  size: { lib: vSize, opts: null, maxms: MAXMS, mirrorPass: true },
  eye: { lib: vEye, opts: null, maxms: MAXMS, mirrorPass: true },
  atari: { lib: vAtari, opts: null, maxms: MAXMS, mirrorPass: true },
  both: { lib: vBoth, opts: null, maxms: MAXMS, mirrorPass: true },
  deployed: { lib: vDeployed, opts: null, maxms: MAXMS, mirrorPass: true },
  depsize: { lib: vDeployedSize, opts: null, maxms: MAXMS, mirrorPass: true },
  // fixed-budget controls for the time/strength curve
  base200: { lib: base, opts: null, maxms: 200 },
  base400: { lib: base, opts: null, maxms: 400 },
  base1500: { lib: base, opts: null, maxms: 1500 },
};

const ARM_NAMES = str("arms", "base,pass").split(",");
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
emit({ kind: "start", worker: WORKER, arms: ARM_NAMES, games: GAMES, size: SIZE, maxms: MAXMS, pid: process.pid });

// Round-robin so every arm sees the same machine load over the life of the run.
for (let round = 0; round < GAMES; round++) {
  // One layout per round, shared by every arm in it.
  const boardSeed = Math.floor(Math.random() * 30000) * 1000 + 1;
  for (const name of ARM_NAMES) {
    const wall0 = Date.now();
    const r = await playGame(ARMS[name], SIZE, null, boardSeed);
    emit({
      kind: "game",
      worker: WORKER,
      arm: name,
      size: SIZE,
      maxms: ARMS[name].maxms,
      round,
      won: r.black >= r.white,
      ...r,
      simWallMs: Date.now() - wall0,
    });
  }
}

emit({ kind: "end", worker: WORKER });
