// The opponent model vs the game's own getMove, reply for reply. Used by
// tools/goai/check.mjs (the CLI) and tools/test/gomodel.test.mjs (GM3).
//
// Imports the full game bundle (tools/sim/game.bundle.mjs under jsdom) — the
// reference — and the model bundle (tools/goai/goai.bundle.mjs). For each
// position: same board, same previousBoards, same passCount, same WHRNG seed,
// and the same Math.random stream (getDefendMove draws it, goAI.ts:579).

import { loadModel } from "./model.mjs";

/** A seeded Math.random, so getDefendMove draws the same stream in both calls. */
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * @returns {Promise<null | {calls, mismatches, examples, modelMsPerCall, gameMsPerCall, opponents, games, size}>}
 *          null when the model cannot be built or loaded.
 */
export async function fidelity({ games = 5, size = 5, opponents = ["Illuminati"], seed = 7, log = () => {} } = {}) {
  await import("../sim/env.mjs");
  const g = await import("../sim/game.bundle.mjs");
  const { dealPaired } = await import("../sim/go-board.mjs");
  const model = await loadModel({ quiet: false });
  if (!model) return null;

  // waitCycle / patternMatching sleeps are pacing only (build.mjs); run the
  // reference at compute speed too.
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, [10, 40, 200].includes(ms) ? 0 : ms, ...rest);
  const realRandom = Math.random;
  const pick = seeded(seed * 977 + 13);
  let calls = 0, mismatches = 0, modelMs = 0, gameMs = 0;
  const examples = [];
  try {
    for (const oppKey of opponents) {
      const OPP = g.GoOpponent[oppKey];
      if (!OPP) throw new Error(`fidelity: unknown opponent ${oppKey}`);
      for (let i = 0; i < games; i++) {
        const state = dealPaired(g, size, OPP, seed, i);
        g.Go.currentGame = state;
        g.Go.storedCycles = 0;
        const N = state.board.length;
        for (let turn = 0; turn < N * N * 2 && state.passCount < 2; turn++) {
          // black: a random legal move, or (5%) a pass
          const valid = g.getAllValidMoves(state, g.GoColor.black);
          if (!valid.length || pick() < 0.05) g.passTurn(state, g.GoColor.black, false);
          else {
            const p = valid[(pick() * valid.length) | 0];
            g.makeMove(state, p.x, p.y, g.GoColor.black);
          }
          if (state.passCount >= 2) break;
          const board = g.simpleBoardFromBoard(state.board);
          const history = state.previousBoards.slice();
          const rng = Math.floor(pick() * 30000 * 1000) + 1;
          const mseed = (pick() * 2 ** 32) >>> 0;
          Math.random = seeded(mseed);
          let t = performance.now();
          const want = await g.getMove(state, g.GoColor.white, OPP, false, rng);
          gameMs += performance.now() - t;
          Math.random = seeded(mseed);
          t = performance.now();
          const got = await model.reply(board, { opponent: oppKey, history, passCount: state.passCount, rng });
          modelMs += performance.now() - t;
          Math.random = realRandom;
          calls++;
          const wantS = want.type === "move" ? `${want.x},${want.y}` : "pass";
          const gotS = got ? `${got.x},${got.y}` : "pass";
          if (wantS !== gotS) {
            mismatches++;
            if (examples.length < 5) {
              examples.push(`${oppKey} game ${i} turn ${turn}: game ${wantS} model ${gotS} on ${board.join("/")}`);
              log(`MISMATCH ${examples[examples.length - 1]}`);
            }
          }
          if (want.type === "move") g.makeMove(state, want.x, want.y, g.GoColor.white);
          else g.passTurn(state, g.GoColor.white, false);
        }
      }
    }
  } finally {
    Math.random = realRandom;
    globalThis.setTimeout = realSetTimeout;
  }
  return {
    calls,
    mismatches,
    examples,
    modelMsPerCall: modelMs / Math.max(1, calls),
    gameMsPerCall: gameMs / Math.max(1, calls),
    opponents: opponents.length,
    games,
    size,
  };
}
