// Seeded equivalence test: golib-fast.js must be BIT-IDENTICAL to
// golib-deployed.js, not merely similar. A faster solver that plays differently
// is a new solver and has to be measured as one.
//
//   node tools/staging/go/equiv.mjs [--cases 200000]
//
// Three layers, cheapest first:
//   1. play()    — same return value AND same resulting board, over random
//                  boards x random points x both colours.
//   2. tryPlay() — same boolean AND same board (including the undo path).
//   3. playout() — same return value AND same final board, given the same
//                  seeded RNG. This is the strong one: playout drives every
//                  UCT iteration, so if it is identical for the same seed then
//                  the search above it is identical too.
//   4. chooseMoveUCT() — run under a FAKE MONOTONIC CLOCK so both libraries get
//                  the same RNG seed and the same deadline, hence the same
//                  iteration count. Must return the same move, visits and iters.
import os from "node:os";
try { os.setPriority(19); } catch { /* not fatal */ }

const argv = process.argv.slice(2);
const num = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 ? Number(argv[i + 1]) : d; };
const CASES = num("cases", 200000);

const A = await import(new URL("./golib-deployed.js", import.meta.url).pathname);
const B = await import(new URL("./golib-fast.js", import.meta.url).pathname);

let seed = 0x12345678;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const mkRand = (s0) => { let s = s0 >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };

/** Random legal-ish board: each point empty/us/them/dead with realistic weights. */
function randomBoard(N, fill) {
  const b = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const r = rnd();
    b[i] = r < fill * 0.45 ? A.US : r < fill * 0.9 ? A.THEM : r < fill * 0.9 + 0.04 ? A.DEAD : A.EMPTY;
  }
  return b;
}
const same = (x, y) => { if (x.length !== y.length) return false; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; };

let fails = 0;
const fail = (what, info) => { if (fails++ < 5) console.log(`MISMATCH ${what}: ${info}`); };

// ---- 1 & 2: play() and tryPlay() -------------------------------------------
let nPlay = 0, nTry = 0;
for (let c = 0; c < CASES; c++) {
  const N = 5 + 2 * ((rnd() * 3) | 0);           // 5, 7 or 9
  const nbrs = A.makeGeometry(N);
  const base = randomBoard(N, 0.25 + 0.6 * rnd());
  const idx = (rnd() * N * N) | 0;
  if (base[idx] !== A.EMPTY) continue;
  const colour = rnd() < 0.5 ? A.US : A.THEM;

  const sa = A.makeScratch(N), sb = B.makeScratch(N);
  const ba = base.slice(), bb = base.slice();
  const ra = A.play(ba, nbrs, idx, colour, sa);
  const rb = B.play(bb, nbrs, idx, colour, sb);
  nPlay++;
  if (ra !== rb) fail("play return", `N=${N} idx=${idx} ${ra} vs ${rb}`);
  else if (!same(ba, bb)) fail("play board", `N=${N} idx=${idx}`);

  const ca = base.slice(), cb = base.slice();
  const ta = A.tryPlay(ca, nbrs, idx, colour, sa);
  const tb = B.tryPlay(cb, nbrs, idx, colour, sb);
  nTry++;
  if (ta !== tb) fail("tryPlay return", `N=${N} idx=${idx} ${ta} vs ${tb}`);
  else if (!same(ca, cb)) fail("tryPlay board", `N=${N} idx=${idx}`);
}
console.log(`play():    ${nPlay} random cases, ${fails === 0 ? "IDENTICAL" : "MISMATCHES"}`);
const afterPlay = fails;

// ---- 3: playout() under a shared seed --------------------------------------
let nPo = 0;
for (let c = 0; c < Math.min(CASES, 40000); c++) {
  const N = 5 + 2 * ((rnd() * 3) | 0);
  const nbrs = A.makeGeometry(N);
  const base = randomBoard(N, 0.15 + 0.5 * rnd());
  const colour = rnd() < 0.5 ? A.US : A.THEM;
  const s0 = (rnd() * 0xffffffff) >>> 0;
  const ba = base.slice(), bb = base.slice();
  const va = A.playout(ba, nbrs, N, 5.5, colour, A.makeScratch(N), mkRand(s0));
  const vb = B.playout(bb, nbrs, N, 5.5, colour, B.makeScratch(N), mkRand(s0));
  nPo++;
  if (va !== vb) fail("playout return", `N=${N} seed=${s0} ${va} vs ${vb}`);
  else if (!same(ba, bb)) fail("playout board", `N=${N} seed=${s0}`);
}
console.log(`playout(): ${nPo} seeded cases, ${fails === afterPlay ? "IDENTICAL" : "MISMATCHES"}`);
const afterPo = fails;

// ---- 4: chooseMoveUCT() under a fake monotonic clock ------------------------
// Both libraries seed from Date.now() and break on Date.now() >= deadline, so a
// clock that advances one unit per call makes the seed, the deadline and the
// iteration count all deterministic and identical between them.
const realNow = Date.now;
const POSITIONS = [
  [".....", ".....", ".....", ".....", "....#"],
  ["..X..", ".....", "..O..", ".....", "....#"],
  ["XX.O.", ".XOO.", "X.XO.", ".XX.O", "..O.#"],
  ["XXXOO", "XXOOO", "XXXOO", "OXXOO", "OOX.#"],
  [".......", "..X....", ".......", "...O...", ".......", ".......", "......#"],
  // Only PASS is legal here (every empty point is one of our own eyes). This
  // covers the pass fast-path: both libraries must return the same null, the
  // fast one just gets there without burning the budget.
  ["XXXXX", "X.X.X", "XXXXX", "X.X.X", "XXXXX"],
];
let nU = 0;
for (let p = 0; p < POSITIONS.length; p++) {
  for (const budget of [40, 120]) {
    const board = POSITIONS[p];
    const N = board.length;
    const v = Array.from({ length: N }, () => new Array(N).fill(true));
    for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if (board[x][y] !== ".") v[x][y] = false;
    const run = (lib) => { let t = 1000000; Date.now = () => ++t; try { return lib.chooseMoveUCT(board, v, N, 5.5, budget); } finally { Date.now = realNow; } };
    const ra = run(A), rb = run(B);
    nU++;
    const ja = JSON.stringify(ra), jb = JSON.stringify(rb);
    if (ja !== jb) fail("chooseMoveUCT", `pos ${p} budget ${budget}\n    A=${ja}\n    B=${jb}`);
  }
}
console.log(`chooseMoveUCT(): ${nU} fixed-clock cases, ${fails === afterPo ? "IDENTICAL" : "MISMATCHES"}`);
console.log(fails === 0 ? "\nEQUIVALENCE: PASS — golib-fast.js is behaviourally identical to golib-deployed.js."
                        : `\nEQUIVALENCE: FAIL — ${fails} mismatches.`);
process.exit(fails === 0 ? 0 : 1);
