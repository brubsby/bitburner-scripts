// Throughput benchmark for golib.js. Reports raw playouts/sec and UCT iters/sec
// on a set of representative positions, so an optimisation can be attributed.
//
//   node tools/staging/go/bench.mjs [--lib ./golib-deployed.js] [--ms 3000]
import os from "node:os";
try { os.setPriority(19); } catch { /* not fatal */ }

const argv = process.argv.slice(2);
const str = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : d; };
const num = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 ? Number(argv[i + 1]) : d; };
const LIB = str("lib", "./golib-deployed.js");
const MS = num("ms", 3000);
const lib = await import(new URL(LIB, import.meta.url).pathname);

// Representative 5x5 positions: empty, early, midgame, crowded endgame.
const POSITIONS = {
  empty:   [".....", ".....", ".....", ".....", "....#"],
  early:   ["..X..", ".....", "..O..", ".....", "....#"],
  mid:     ["XX.O.", ".XOO.", "X.XO.", ".XX.O", "..O.#"],
  crowded: ["XXXOO", "XXOOO", "XXXOO", "OXXOO", "OOX.#"],
};

const mkRand = (seed0) => { let s = seed0 >>> 0; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };

console.log(`lib: ${LIB}\n`);
let totPo = 0, totPoMs = 0;
for (const [name, board] of Object.entries(POSITIONS)) {
  const N = board.length;
  const nbrs = lib.makeGeometry(N);
  const root = lib.parseBoard(board);
  const scratch = lib.makeScratch(N);
  const work = root.slice();
  const rand = mkRand(0xc0ffee);
  // raw playouts
  let n = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < MS) {
    for (let k = 0; k < 64; k++) { work.set(root); lib.playout(work, nbrs, N, 5.5, lib.US, scratch, rand); n++; }
  }
  const dt = Date.now() - t0;
  totPo += n; totPoMs += dt;
  console.log(`  ${name.padEnd(8)} playouts/sec ${((1000 * n) / dt).toFixed(0).padStart(8)}   (${n} in ${dt}ms)`);
}
console.log(`  ${"ALL".padEnd(8)} playouts/sec ${((1000 * totPo) / totPoMs).toFixed(0).padStart(8)}\n`);

// UCT throughput at the live budget
const valid = (N) => Array.from({ length: N }, () => new Array(N).fill(true));
for (const [name, board] of Object.entries(POSITIONS)) {
  const N = board.length;
  const v = valid(N);
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if (board[x][y] !== ".") v[x][y] = false;
  const t0 = Date.now();
  const r = lib.chooseMoveUCT(board, v, N, 5.5, 1500);
  const dt = Date.now() - t0;
  const iters = r?.[0]?.iters ?? 0;
  console.log(`  ${name.padEnd(8)} UCT iters/sec ${((1000 * iters) / dt).toFixed(0).padStart(8)}   (${iters} in ${dt}ms)`);
}
