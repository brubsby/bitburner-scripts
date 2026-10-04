// NOT CALIBRATED against the live game: no game against the hidden opponent has
// been played, and the wall clock is modelled from timer hops (below). The
// opponent and the rules ARE the game's own code (the bundle).
// How well does the solver play the HIDDEN opponent (GoOpponent.w0r1d_d43m0n,
// "????????????") — the number the whole-game planner calls `w0`?
//
//   node tools/sim/go-w0.mjs --games 10 --maxms 800 [--score 0.5] [--out f.jsonl]
//
// The opponent is the game's own getMove (src/Go/boardAnalysis/goAI.ts), on the
// board the game itself deals: getNewBoardState(19, w0r1d_d43m0n, true) replaces
// the board with the rotated bitverseBoardShape and applies the 7 white
// handicap routers (boardState.ts:26-30, 60-63, 100-112). Komi 9.5, so
// difficultyMultiplier = (9.5+0.5)*0.25 = 2.5 (effect.ts:132-135). isSmart is
// true and the move set is getIlluminatiPriorityMove (goAI.ts:225-259).
//
// Fidelity notes carried over from go-boardsize.mjs: the AI's WHRNG is seeded
// with an explicit random per move (offline totalPlaytime never advances), and
// the AI's sleeps are short-circuited and COUNTED, so the live wall clock is
// rebuilt analytically: every 40/200ms delay is one waitCycle (200ms live once
// stored cycles are spent) and every 10ms delay is one pattern-matching row
// (patternMatching.ts:104, a real 10ms live — Chrome clamps nested timers to
// >=4ms, so 10ms is what it costs).
//
// Our side also replicates go.js's MIRROR PASS: when the AI passes and black
// is ahead on the live score, we pass and the game ends.
//
// One JSONL record per game: black/white sums, win, our think ms, the AI's
// compute ms and hop counts, and the node power the game would bank at the
// running win streak (scoring.ts:85-88).

import os from "node:os";
import fs from "node:fs";

try {
  os.setPriority(19);
} catch {
  /* not fatal */
}

import "./env.mjs";

const realSetTimeout = globalThis.setTimeout;
let cycles = 0;
let rows = 0;
globalThis.setTimeout = function (fn, ms, ...rest) {
  if (ms === 40 || ms === 200) {
    cycles++;
    return realSetTimeout(fn, 0, ...rest);
  }
  if (ms === 10) {
    rows++;
    return realSetTimeout(fn, 0, ...rest);
  }
  return realSetTimeout(fn, ms, ...rest);
};

const g = await import("./game.bundle.mjs");
const { randomizeLayout, dealPaired } = await import("./go-board.mjs");
// --layoutseed S: game i gets the same board in every run with seed S (paired A/B).
const LAYOUT_SEED = process.argv.includes("--layoutseed") ? Number(process.argv[process.argv.indexOf("--layoutseed") + 1]) : null;
const golib = await import("../../golib.js");
const { GoColor, GoOpponent } = g;

const argv = process.argv.slice(2);
const str = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : dflt;
};
const num = (name, dflt) => Number(str(name, dflt));
const GAMES = num("games", 4);
const MAXMS = num("maxms", 800);
// --opening K:MS — the first K of our moves search for MS instead of MAXMS
// (the opening decides most 5x5 losses; it is a few moves of a ~25s game).
const OPENING = (() => {
  const v = str("opening", null);
  if (!v) return null;
  const [k, ms] = v.split(":").map(Number);
  return { k, ms };
})();
const budgetFor = (turn) => (OPENING && turn < OPENING.k ? OPENING.ms : MAXMS);
const OUT = str("out", null);
const OPP = GoOpponent[str("opponent", "w0r1d_d43m0n")];
const SIZE = num("size", 19);
const VERBOSE = argv.includes("--verbose");
// --trace: every game record carries its move list and the board after each
// ply (simple-board strings), for loss analysis.
const TRACE = argv.includes("--trace");
// Solver options passed straight through to chooseMoveUCT (golib.js).
const OPTS = JSON.parse(str("opts", "{}"));
// --model: search with golib.chooseMoveModel against the game's own AI policy
// (tools/goai — the opponent's getMove bundled from game source), as the
// external solver does when the model is available.
let MODEL = null;
if (argv.includes("--model")) {
  const { loadModel } = await import("../goai/model.mjs");
  const m = await loadModel({ quiet: false });
  if (!m) throw new Error("--model: tools/goai could not build or load the opponent model");
  MODEL = { reply: (b, o) => m.reply(b, { ...o, opponent: OPP }) };
}

// --katago V: moves from KataGo (tools/katago, analysis engine, V visits/move)
// instead of golib — the external-engine evaluation. Think time is measured.
let KATAGO = null;
if (argv.includes("--katago")) {
  const { startKataGo } = await import("../katago/katago.mjs");
  KATAGO = await startKataGo({ visits: Number(str("katago", 200)), log: (m) => process.stderr.write(m + "\n") });
  if (!KATAGO) throw new Error("--katago: KataGo could not start (tools/katago/install.sh)");
}

// ---------------------------------------------------------------------------
// CHEATS (netscriptGoImplementation.ts:500-567). Only playTwoMoves is modelled.
//
//   chance(k) = min(1, 0.6 * (0.7 - 0.02k)^k * crime_success + (SF14.3 ? 0.25 : 0))
//   success  -> both stones placed, captures resolved, the AI replies
//   failure  -> k == 0: our turn is passed;  k >= 1: 10% ejected
//               (forceEndGoGame: no node power, streak reset), else passed
//
// --cheat blind      roll Math.random() like a script that cannot see the RNG
// --cheat predicted  the roll is WHRNG(Player.totalPlaytime) (:512), a pure
//                    sawtooth in playtime: r = frac(T/1000 * RATE) with
//                    RATE = 171/30269 + 172/30307 + 170/30323 per second, period
//                    59.06s (Casino/RNG.ts:40-63). A script reading
//                    getPlayer().totalPlaytime in the same tick as the call
//                    knows the outcome; it cheats only inside the window
//                    r <= chance(k), waiting at most --cheatwait seconds.
//                    The phase here advances with the modelled live clock.
const CHEAT = str("cheat", null);
const CHEAT_MAX = num("cheatmax", 99);
const CHEAT_FROM = num("cheatfrom", 2); // first of our turns a cheat may be used on
const CHEAT_WAIT = num("cheatwait", 10);
const CRIME = num("crime", 1);
const SF143 = argv.includes("--sf143");
const RATE = 171 / 30269 + 172 / 30307 + 170 / 30323;
const pCheat = (k) => Math.max(0, Math.min(1, 0.6 * (0.7 - 0.02 * k) ** k * CRIME + (SF143 ? 0.25 : 0)));
const MIN_P = 0.2 * RATE; // one 200ms engine tick of window: narrower can be stepped over

const emit = (obj) => {
  const line = JSON.stringify(obj) + "\n";
  if (OUT) fs.appendFileSync(OUT, line);
  else process.stdout.write(line);
};

function validGrid(state, N) {
  const grid = Array.from({ length: N }, () => new Array(N).fill(false));
  for (const p of g.getAllValidMoves(state, GoColor.black)) grid[p.x][p.y] = true;
  return grid;
}
const rngSeed = () => Math.floor(Math.random() * 30000 * 1000) + 1;

// The streak multipliers this game would be credited at (effect.ts:119-130),
// from the running streak — what go.js sends the solver as `objective`.
function objectiveFor(stats) {
  const win = g.getWinstreakMultiplier(stats.winStreak < 0 ? 1 : stats.winStreak + 1, stats.winStreak);
  return { win, loss: 0.5 };
}

async function playGame(stats, gameIndex) {
  // A fresh offline-node layout per game (go-board.mjs: without this the
  // harness deals ONE layout forever). --fixed-layout restores the old deal.
  if (!argv.includes("--fixed-layout")) randomizeLayout(g);
  const state = LAYOUT_SEED !== null ? dealPaired(g, SIZE, OPP, LAYOUT_SEED, gameIndex) : g.getNewBoardState(SIZE, OPP, true);
  g.Go.currentGame = state;
  g.Go.storedCycles = 1e9;
  const N = state.board.length;
  const komi = g.opponentDetails[OPP].komi;
  let modelCalls = 0;
  let ourTurns = 0, ourMs = 0, iters = 0, oppTurns = 0, oppMs = 0, oppCycles = 0, oppRows = 0, mirror = 0, ourPasses = 0;
  let guard = 0;
  let oppPassed = false;
  let cheats = 0, cheatOk = 0, cheatWaitS = 0, ejected = false;
  let phase = Math.random();
  let turnLiveS = 0;
  const trace = TRACE ? [{ who: "start", board: g.simpleBoardFromBoard(state.board) }] : null;
  const note = (who, mv) => trace && trace.push({ who, mv, board: g.simpleBoardFromBoard(state.board) });
  const solve = async () => {
    const simple = g.simpleBoardFromBoard(state.board);
    const valid = validGrid(state, N);
    const t0 = performance.now();
    const opts = { ...OPTS, opponentPassed: oppPassed };
    if (OPTS.objective === "auto") opts.objective = objectiveFor(stats);
    const ranked = KATAGO
      ? await (async () => {
          const vl = [];
          for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if (valid[x][y]) vl.push([x, y]);
          const r = await KATAGO.choose(simple, vl, komi);
          return r.pass ? [] : [{ x: r.x, y: r.y, iters: r.visits }];
        })()
      : MODEL
      ? await golib.chooseMoveModel(simple, valid, N, komi, budgetFor(ourTurns), { ...opts, history: state.previousBoards.slice() }, MODEL)
      : golib.chooseMoveUCT(simple, valid, N, komi, budgetFor(ourTurns), opts);
    modelCalls += ranked?.[0]?.modelCalls ?? 0;
    ourMs += performance.now() - t0;
    iters += ranked?.[0]?.iters ?? 0;
    return ranked;
  };
  while (state.passCount < 2 && guard++ < N * N * 4) {
    phase = (phase + turnLiveS * RATE) % 1;
    turnLiveS = (budgetFor(ourTurns) + 550) / 1000;
    const ranked = await solve();
    ourTurns++;
    const hasMove = ranked && ranked.length;
    let cheatNow = false;
    let cheatSucceeds = false;
    if (CHEAT && hasMove && cheats < CHEAT_MAX && ourTurns >= CHEAT_FROM) {
      const p = pCheat(cheats);
      if (CHEAT === "blind") {
        cheatNow = true;
        cheatSucceeds = Math.random() <= p;
      } else if (p >= MIN_P) {
        const wait = phase <= p ? 0 : (1 - phase) / RATE;
        if (wait <= CHEAT_WAIT) {
          cheatNow = cheatSucceeds = true;
          cheatWaitS += wait;
          turnLiveS += wait;
          if (wait > 0) phase = 0; // waited to the window's start
        }
      }
    }
    if (cheatNow) {
      cheats++;
      if (cheatSucceeds) {
        cheatOk++;
        g.makeMove(state, ranked[0].x, ranked[0].y, GoColor.black);
        // The second stone, chosen on the board after the first. The game
        // validates both against the board BEFORE either (Go.ts cheat
        // playTwoMoves -> validateMove x2); the difference is a capture by the
        // first stone freeing the second point, which this ignores.
        state.previousPlayer = GoColor.white;
        const second = await solve();
        turnLiveS += (MAXMS + 550) / 1000;
        if (second && second.length) g.makeMove(state, second[0].x, second[0].y, GoColor.black);
        state.previousPlayer = GoColor.black;
      } else if (cheats > 1 && Math.random() < 0.1) {
        ejected = true;
        break;
      } else {
        g.passTurn(state, GoColor.black, false);
      }
    } else if (!(hasMove && g.makeMove(state, ranked[0].x, ranked[0].y, GoColor.black))) {
      g.passTurn(state, GoColor.black, false);
      ourPasses++;
      note("B", "pass");
    } else note("B", [ranked[0].x, ranked[0].y]);
    if (state.passCount >= 2) break;

    cycles = 0;
    rows = 0;
    const t1 = performance.now();
    const reply = await g.getMove(state, GoColor.white, OPP, true, rngSeed());
    oppMs += performance.now() - t1;
    oppCycles += cycles + (reply.type === "move" ? 1 : 0);
    oppRows += rows;
    turnLiveS += ((cycles + (reply.type === "move" ? 1 : 0)) * 200 + rows * 10) / 1000;
    oppTurns++;
    oppPassed = reply.type !== "move";
    if (reply.type === "move") {
      g.makeMove(state, reply.x, reply.y, GoColor.white);
      note("W", [reply.x, reply.y]);
    } else {
      note("W", "pass");
      g.passTurn(state, GoColor.white, false);
      const s = g.getScore(state);
      if (s[GoColor.black].sum > s[GoColor.white].sum) {
        mirror++;
        g.passTurn(state, GoColor.black, false);
        break;
      }
    }
    if (VERBOSE && ourTurns % 20 === 0) {
      const s = g.getScore(state);
      process.stderr.write(`turn ${ourTurns}: B ${s[GoColor.black].sum} W ${s[GoColor.white].sum} us ${(ourMs / ourTurns).toFixed(0)}ms/mv ${Math.round(iters / ourTurns)} it/mv\n`);
    }
  }
  const s = g.getScore(state);
  return {
    black: s[GoColor.black].sum,
    white: s[GoColor.white].sum,
    komi,
    ourTurns,
    ourPasses,
    ourMsPerMove: +(ourMs / ourTurns).toFixed(1),
    ourMsTotal: Math.round(ourMs),
    itersPerMove: Math.round(iters / ourTurns),
    ...(MODEL ? { modelCallsPerMove: Math.round(modelCalls / ourTurns) } : {}),
    oppTurns,
    oppMs: Math.round(oppMs),
    oppCycles,
    oppRows,
    mirror,
    size: N,
    ...(CHEAT ? { cheats, cheatOk, cheatWaitS: Math.round(cheatWaitS), ejected } : {}),
    ...(trace ? { trace } : {}),
  };
}

const stats = { wins: 0, losses: 0, winStreak: 0, oldWinStreak: 0, nodePower: 0 };
emit({ kind: "start", games: GAMES, katago: KATAGO ? Number(str("katago", 200)) : null, maxms: MAXMS, opening: OPENING, opts: OPTS, model: !!MODEL, opponent: OPP, size: SIZE, cheat: CHEAT, cheatMax: CHEAT_MAX, crime: CRIME, pid: process.pid });
for (let i = 0; i < GAMES; i++) {
  const w0 = Date.now();
  const r = await playGame(stats, i);
  const won = !r.ejected && r.black >= r.white;
  stats.oldWinStreak = stats.winStreak;
  if (r.ejected) {
    // resetWinstreak(ai, false) (scoring.ts:113-122): no dry-streak step.
    stats.losses++;
    if (stats.winStreak >= 0) stats.winStreak = -1;
  } else if (!won) {
    stats.losses++;
    stats.winStreak = stats.winStreak >= 0 ? -1 : stats.winStreak - 1;
  } else {
    stats.wins++;
    stats.winStreak = stats.oldWinStreak < 0 ? 1 : stats.winStreak + 1;
  }
  const difficulty = g.getDifficultyMultiplier(r.komi, r.size);
  const streak = g.getWinstreakMultiplier(stats.winStreak, stats.oldWinStreak);
  // forceEndGoGame never runs the nodePower accrual (scoring.ts:101-108).
  const power = r.ejected ? 0 : r.black * difficulty * streak;
  stats.nodePower += power;
  // Live wall clock: our think + the solver round trip (go.js polls every
  // 250ms, the solver every 150ms: ~0.45s) per move, 200ms per AI waitCycle,
  // 10ms per pattern row, plus go.js's own idle (100ms) per move.
  // Our think time as MEASURED (ourMsTotal: budgets vary with --opening, and a
  // search returns early when only a pass is legal), plus the round trip.
  const liveS = ((r.ourMsTotal ?? r.ourTurns * MAXMS) + r.ourTurns * (450 + 100) + (r.cheatOk ?? 0) * (MAXMS + 550) + r.oppCycles * 200 + r.oppRows * 10) / 1000 + (r.cheatWaitS ?? 0);
  emit({ kind: "game", i, ...r, won, streak, power: +power.toFixed(1), liveS: Math.round(liveS), simS: Math.round((Date.now() - w0) / 1000) });
}
emit({ kind: "end", ...stats });
KATAGO?.close();
process.exit(0); // jsdom keeps the event loop alive
