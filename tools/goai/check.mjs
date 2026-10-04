// FIDELITY CHECK: the opponent model (tools/goai, a ~60KB bundle of goAI.ts and
// the board code beneath it) against the game's own getMove in the full game
// bundle (tools/sim/game.bundle.mjs) — same position, same history, same WHRNG
// seed, same Math.random stream. Every reply must be identical; any mismatch is
// printed with the position and the run exits 1. Also run (smaller) by the
// suite: tools/test/gomodel.test.mjs GM3.
//
//   node tools/goai/check.mjs [--games 20] [--size 5] [--opponent Illuminati,...]
//
// Positions come from real games: random black moves against the game's AI on
// boards dealt by the game's generator (a fresh offline-node layout per game).
// Also prints the model's cost per call, which bounds how much of it a search
// can afford.

import { fidelity } from "./fidelity.mjs";

const argv = process.argv.slice(2);
const arg = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const r = await fidelity({
  games: Number(arg("games", 20)),
  size: Number(arg("size", 5)),
  opponents: arg("opponent", "Illuminati,Daedalus,Tetrads,TheBlackHand,Netburners,SlumSnakes").split(","),
  log: console.log,
});
if (!r) {
  console.log("NO MODEL — tools/goai/build.mjs could not build or load the bundle");
  process.exit(2);
}
console.log(
  `goai fidelity: ${r.calls} replies across ${r.opponents} opponents x ${r.games} games at ${r.size}x${r.size}: ` +
    `${r.mismatches} mismatches. model ${r.modelMsPerCall.toFixed(2)}ms/call, game bundle ${r.gameMsPerCall.toFixed(2)}ms/call`,
);
process.exit(r.mismatches ? 1 : 0);
