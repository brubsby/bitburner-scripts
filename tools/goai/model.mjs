// The game's own IPvGO opponent as a callable model (see build.mjs for what the
// bundle is and what is stubbed).
//
//   const model = await loadModel()            // builds the bundle if needed
//   const mv = await model.reply(board, { opponent: "Illuminati", history, passCount, rng })
//     -> { x, y } | null (null = the AI passes)
//
// `board` is the game's simple board (string per column, 'X' black/us,
// 'O' white/the AI, '.' empty, '#' offline). `history` is previous board
// strings, most recent first, exactly as BoardState.previousBoards holds them
// (they drive the superko check inside the AI's own move filter). `rng` is the
// WHRNG seed getMove would take from Player.totalPlaytime (goAI.ts:184); any
// positive number. getDefendMove alone draws Math.random (goAI.ts:579), as in
// the game.
//
// Returns null from loadModel() — never throws — when the bundle cannot be
// built or loaded (no game source, no esbuild); the caller must treat that as
// "no model" and say so.

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { OUT, stale, build } from "./build.mjs";

let cached = null;

export async function loadModel({ quiet = true, rebuild = true } = {}) {
  if (cached) return cached;
  try {
    if (rebuild && stale()) await build({ quiet });
    if (!fs.existsSync(OUT)) return null;
    const m = await import(pathToFileURL(OUT).href);
    cached = wrap(m);
    return cached;
  } catch (err) {
    if (!quiet) console.error(`goai model unavailable: ${String(err).slice(0, 200)}`);
    return null;
  }
}

function wrap(m) {
  const { GoColor, GoOpponent } = m;
  const byKey = new Map();
  for (const [k, v] of Object.entries(GoOpponent)) {
    byKey.set(k, v);
    byKey.set(v, v);
  }
  const opponentOf = (o) => {
    const v = byKey.get(o);
    if (!v) throw new Error(`goai model: unknown opponent ${o}`);
    return v;
  };
  return {
    GoOpponent,
    komiOf: (o) => m.opponentDetails[opponentOf(o)].komi,
    opponentOf,
    /** The AI's reply as white to `board`. */
    async reply(board, { opponent, history = [], passCount = 0, rng }) {
      const ai = opponentOf(opponent);
      const state = m.getNewBoardStateFromSimpleBoard(board, undefined, ai, GoColor.black);
      state.previousBoards = history.slice();
      state.passCount = passCount;
      const play = await m.getMove(state, GoColor.white, ai, false, rng);
      return play.type === "move" ? { x: play.x, y: play.y } : null;
    },
    /** Black's legal moves under the game's rules (superko against `history`). */
    validMoves(board, history = []) {
      const state = m.getNewBoardStateFromSimpleBoard(board, undefined, GoOpponent.none, GoColor.white);
      state.previousBoards = history.slice();
      return m.getAllValidMoves(state, GoColor.black).map((p) => [p.x, p.y]);
    },
  };
}
