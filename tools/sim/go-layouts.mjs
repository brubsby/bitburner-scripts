// NOT CALIBRATED: a diagnostic of the harness deal (layout counts), not a model
// of anything live — it drives no decision on its own.
// How many distinct boards does the harness actually deal?
//
//   node tools/sim/go-layouts.mjs [--size 5] [--n 200] [--randomize]
//
// offlineNodes.ts:13 seeds the obstacle layout from
// `new WHRNG(Player.totalPlaytime ?? new Date().getTime())`. Offline the
// harness's Player never advances its playtime, so every getNewBoardState call
// deals the SAME layout unless the harness moves Player.totalPlaytime itself
// (go-board.mjs randomizeLayout). This prints the distinct-layout count both
// ways, which is the check that a study covers the game's layout distribution.

import "./env.mjs";
const g = await import("./game.bundle.mjs");
import { randomizeLayout } from "./go-board.mjs";

const argv = process.argv.slice(2);
const num = (n, d) => (argv.includes(`--${n}`) ? Number(argv[argv.indexOf(`--${n}`) + 1]) : d);
const SIZE = num("size", 5);
const N = num("n", 200);
const seen = new Map();
for (let i = 0; i < N; i++) {
  if (argv.includes("--randomize")) randomizeLayout(g);
  const s = g.getNewBoardState(SIZE, g.GoOpponent.Illuminati, true);
  const key = g.simpleBoardFromBoard(s.board).join("/");
  seen.set(key, (seen.get(key) ?? 0) + 1);
}
const holes = [...seen.keys()].map((k) => (k.match(/#/g) ?? []).length);
console.log(
  JSON.stringify({ size: SIZE, n: N, distinct: seen.size, meanHoles: holes.reduce((a, b) => a + b, 0) / holes.length, playtime: g.Player?.totalPlaytime }),
);
process.exit(0);
