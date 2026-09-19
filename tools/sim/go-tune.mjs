// Tunes golib.js against the game's REAL IPvGO opponent.
//
// !!! RESULTS FROM THIS FILE ARE SUSPECT — DO NOT DECIDE ANYTHING ON THEM !!!
//
// `getMove` seeds its RNG with `new WHRNG(rngOverride || Player.totalPlaytime)`
// (Go/boardAnalysis/goAI.ts:184). Offline, `Player.totalPlaytime` never
// advances, so every call re-seeds IDENTICALLY — which pins the `rng < 0.9`
// branch of `getDaedalusPriorityMove` (goAI.ts:369-375) to one side for an
// entire run. The opponent is therefore not the opponent: it is one
// deterministic slice of it, and the win rates this file reports are measuring
// that slice.
//
// This is the same failure class as the hand-written Go opponent that reported
// a 100% win rate while the identical solver lost 10 straight games in the real
// game. Using the game's own source was not sufficient to avoid it, because the
// bug is in how the source is DRIVEN, not in the source.
//
// `tools/sim/go-boardsize.mjs` passes an explicit per-move `rngOverride` and is
// cross-checked against live (81.3% [72-88] modelled vs 78% observed on
// 9x9@1500ms). Use that harness, or fix this one the same way before trusting
// it again.
//
//   node tools/sim/go-tune.mjs --size 9 --maxms 20 --topk 8 --games 10
//   node tools/sim/go-tune.mjs --sweep
//
// Why this file exists, and why the obvious shortcut is a trap.
//
// The first offline harness for this used an opponent I wrote myself — a greedy
// liberty-counter — and reported a **100% win rate at every setting**, which
// made the search look solved. In the actual game the same code lost 10 games
// in a row, scoring 8 against 71.5. The harness had been measuring a strawman,
// and every conclusion drawn from it ("quality saturates at 30ms") was
// unsupported.
//
// CLAUDE.md's fidelity rule already said why: off-line tooling has no RAM
// budget and therefore no excuse for not using the game's own source. So this
// plays against `getMove` from src/Go/boardAnalysis/goAI.ts — the same function
// the real opponent uses — on a real `BoardState`, scored by the game's own
// `getScore`, with node power computed from the game's own `CalculateEffect`.
//
// golib.js is imported directly from the repo root — not copied, not
// symlinked. package.json was switched to "type": "module" to make that work,
// which simply makes node agree with reality: every root .js here is already an
// ES module, because that is what Bitburner scripts are. Only tools/*.mjs is
// node code and it is explicitly .mjs, so nothing else changes. A copy of the
// solver would be exactly the drift this structure exists to prevent.

import "./env.mjs";

const g = await import("./game.bundle.mjs");
const { chooseMove, chooseMoveUCT } = await import("../../golib.js");

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? Number(argv[i + 1]) : dflt;
};

const { GoColor, GoOpponent } = g;

/** getAllValidMoves returns points; golib wants a [x][y] boolean grid. */
function validGrid(state, N) {
  const moves = g.getAllValidMoves(state, GoColor.black);
  const grid = Array.from({ length: N }, () => new Array(N).fill(false));
  for (const p of moves) grid[p.x][p.y] = true;
  return grid;
}

async function playGame(N, maxms, topK, opponent) {
  const state = g.getNewBoardState(N, opponent, true);
  g.Go.currentGame = state;
  // The game's own fast-forward path: waitCycle sleeps 200ms normally but 40ms
  // when storedCycles are banked (goAI.ts:877-883). Using it is the game's
  // mechanism, not a bypass of one.
  g.Go.storedCycles = 1e9;

  const komi = g.opponentDetails[opponent].komi;
  let passes = 0;
  let ourMs = 0;
  let ourMoves = 0;

  for (let turn = 0; turn < N * N * 2 && passes < 2; turn++) {
    const simple = g.simpleBoardFromBoard(state.board);
    const valid = validGrid(state, N);

    const t0 = process.hrtime.bigint();
    const ranked = process.argv.includes("--uct")
      ? chooseMoveUCT(simple, valid, N, komi, maxms)
      : chooseMove(simple, valid, N, komi, maxms, topK);
    ourMs += Number(process.hrtime.bigint() - t0) / 1e6;
    ourMoves++;

    if (ranked && ranked.length) {
      g.makeMove(state, ranked[0].x, ranked[0].y, GoColor.black);
      passes = 0;
    } else {
      g.passTurn(state, GoColor.black, false);
      passes++;
    }

    const reply = await g.getMove(state, GoColor.white, opponent, true);
    if (reply.type === "move") {
      g.makeMove(state, reply.x, reply.y, GoColor.white);
      passes = 0;
    } else {
      g.passTurn(state, GoColor.white, false);
      passes++;
    }
  }

  if (process.argv.includes("--debug")) {
    console.log(g.simpleBoardFromBoard(state.board).join("\n"));
  }
  const score = g.getScore(state);
  const black = score[GoColor.black].sum;
  const white = score[GoColor.white].sum;
  return { black, white, won: black > white, msPerMove: ourMs / ourMoves };
}

async function run(N, maxms, topK, games, opponent) {
  let wins = 0, black = 0, ms = 0;
  for (let i = 0; i < games; i++) {
    const r = await playGame(N, maxms, topK, opponent);
    if (r.won) wins++;
    black += r.black;
    ms += r.msPerMove;
  }
  return {
    size: N,
    maxms,
    topK,
    games,
    winRate: +(wins / games).toFixed(2),
    avgBlackScore: +(black / games).toFixed(1),
    msPerMove: +(ms / games).toFixed(1),
    // What the farming actually earns: nodePower per game at this score, using
    // the game's own difficulty multiplier. Streak multiplier left at 1.0.
    nodePowerPerGame: +((black / games) * g.getDifficultyMultiplier(g.opponentDetails[opponent].komi, N)).toFixed(1),
  };
}

const opponent = GoOpponent.Daedalus;

if (argv.includes("--sweep")) {
  for (const size of [7, 9]) {
    for (const maxms of [10, 20, 50, 120]) {
      console.log(JSON.stringify(await run(size, maxms, flag("topk", 8), flag("games", 6), opponent)));
    }
  }
} else {
  console.log(
    JSON.stringify(await run(flag("size", 9), flag("maxms", 20), flag("topk", 8), flag("games", 10), opponent), null, 2),
  );
}
