// Play games against the real getMove until one is LOST, then print the whole
// board sequence so the failure can be read rather than guessed at.
//
//   node tools/staging/go/dissect.mjs --maxms 800 --size 5 --tries 60
//
// Why this exists: tools/staging/go/go-lab.mjs established that every loss in
// 179 games was `black 0, white 29.5` — not a narrow loss, a total wipeout —
// and that the score trajectory sits flat around -5 for the whole game and then
// falls ~20 points on a single opponent move. That is a life-and-death failure,
// and you cannot fix a life-and-death failure from aggregate statistics. This
// prints the position.
//
// Same fidelity rules as go-lab.mjs: real g.getMove, explicit per-move
// rngOverride (goAI.ts:184 + Casino/RNG.ts:45-50), waitCycle short-circuited.

import os from "node:os";
import fs from "node:fs";
try {
  os.setPriority(19);
} catch {
  /* not fatal */
}
import "../../sim/env.mjs";

const realSetTimeout = globalThis.setTimeout;
const CYCLE_DELAYS = new Set([40, 200]);
globalThis.setTimeout = function (fn, ms, ...rest) {
  return realSetTimeout(fn, CYCLE_DELAYS.has(ms) ? 0 : ms, ...rest);
};

const g = await import("../../sim/game.bundle.mjs");
const { GoColor, GoOpponent } = g;
const lib = await import("./golib-baseline.js");

const argv = process.argv.slice(2);
const num = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i > -1 ? Number(argv[i + 1]) : d;
};
const N = num("size", 5);
const MAXMS = num("maxms", 800);
const TRIES = num("tries", 60);
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : null;
const OPPONENT = GoOpponent.Daedalus;

function validGrid(state) {
  const moves = g.getAllValidMoves(state, GoColor.black);
  const grid = Array.from({ length: N }, () => new Array(N).fill(false));
  for (const p of moves) grid[p.x][p.y] = true;
  return grid;
}
const rngSeed = () => Math.floor(Math.random() * 30000 * 1000);

/** Liberty count of every black chain, from OUR OWN solver's view of the board. */
function blackChains(simple) {
  const nbrs = lib.makeGeometry(N);
  const b = lib.parseBoard(simple);
  const scratch = lib.makeScratch(N);
  const seenChain = new Set();
  const out = [];
  for (let i = 0; i < N * N; i++) {
    if (b[i] !== lib.US || seenChain.has(i)) continue;
    const gr = lib.group(b, nbrs, i, scratch.out, scratch.seen, ++scratch.mark);
    const members = [];
    for (let k = 0; k < gr.size; k++) {
      members.push(scratch.out[k]);
      seenChain.add(scratch.out[k]);
    }
    out.push({ size: gr.size, libs: gr.libs, members });
  }
  return out;
}

async function playOne() {
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
  const prevPlaytime = g.Player.totalPlaytime;
  g.Player.totalPlaytime = Math.floor(Math.random() * 30000) * 1000 + 1;
  const state = g.getNewBoardState(N, OPPONENT, true);
  g.Player.totalPlaytime = prevPlaytime;
  g.Go.currentGame = state;
  g.Go.storedCycles = 1e9;
  const komi = g.opponentDetails[OPPONENT].komi;
  const log = [];
  const start = g.simpleBoardFromBoard(state.board);
  let guard = 0;
  while (state.passCount < 2 && guard++ < N * N * 4) {
    const before = g.simpleBoardFromBoard(state.board);
    const ranked = lib.chooseMoveUCT(before, validGrid(state), N, komi, MAXMS);
    let ours = "pass";
    if (ranked && ranked.length && g.makeMove(state, ranked[0].x, ranked[0].y, GoColor.black)) {
      ours = `${ranked[0].x},${ranked[0].y}`;
    } else {
      g.passTurn(state, GoColor.black, false);
    }
    const afterUs = g.simpleBoardFromBoard(state.board);
    const sc1 = g.getScore(state);
    log.push({
      side: "B",
      move: ours,
      board: afterUs,
      black: sc1[GoColor.black].sum,
      white: sc1[GoColor.white].sum,
      pieces: sc1[GoColor.black].pieces,
      chains: blackChains(afterUs),
      winRate: ranked?.[0]?.winRate ?? null,
    });
    if (state.passCount >= 2) break;

    const bBefore = g.getScore(state)[GoColor.black].pieces;
    const reply = await g.getMove(state, GoColor.white, OPPONENT, true, rngSeed());
    if (reply.type === "move") g.makeMove(state, reply.x, reply.y, GoColor.white);
    else g.passTurn(state, GoColor.white, false);
    const afterThem = g.simpleBoardFromBoard(state.board);
    const sc2 = g.getScore(state);
    log.push({
      side: "W",
      move: reply.type === "move" ? `${reply.x},${reply.y}` : "pass",
      board: afterThem,
      black: sc2[GoColor.black].sum,
      white: sc2[GoColor.white].sum,
      pieces: sc2[GoColor.black].pieces,
      captured: bBefore - sc2[GoColor.black].pieces,
      chains: blackChains(afterThem),
    });
  }
  const sc = g.getScore(state);
  return { start, log, black: sc[GoColor.black].sum, white: sc[GoColor.white].sum, won: sc[GoColor.black].sum >= sc[GoColor.white].sum };
}

function show(entry) {
  const rows = [];
  for (let y = N - 1; y >= 0; y--) {
    let r = `${y} `;
    for (let x = 0; x < N; x++) r += entry.board[x][y] + " ";
    rows.push(r);
  }
  return rows.join("\n");
}

for (let t = 0; t < TRIES; t++) {
  const r = await playOne();
  process.stderr.write(`try ${t}: ${r.won ? "W" : "L"} b${r.black} w${r.white}\n`);
  if (r.won) continue;
  const lines = [];
  lines.push(`LOST GAME: black ${r.black}, white ${r.white}`);
  lines.push(`start board (# = offline node, applyObstacles=true):\n${show({ board: r.start })}`);
  for (let i = 0; i < r.log.length; i++) {
    const e = r.log[i];
    lines.push(
      `\n--- ply ${i} ${e.side} ${e.move}   score b${e.black} w${e.white}  blackStones ${e.pieces}` +
        (e.captured ? `  CAPTURED ${e.captured} BLACK STONES` : "") +
        (e.winRate !== null && e.winRate !== undefined ? `  ourUCTwinRate ${e.winRate.toFixed(3)}` : ""),
    );
    lines.push(show(e));
    lines.push(`    black chains (size/liberties): ${e.chains.map((c) => `${c.size}/${c.libs}`).join("  ") || "none"}`);
  }
  const text = lines.join("\n");
  if (OUT) fs.writeFileSync(OUT, text);
  else console.log(text);
  process.exit(0);
}
process.stderr.write("no loss in the allotted tries\n");
