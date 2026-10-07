import { fileURLToPath } from "node:url";
// The fewest black stones on an empty n x n board (no white stones, no
// offline nodes) at which the game's AI PASSES — the cheapest position that
// ends a game with the whole board ours. Greedy removal from a pass-forcing
// lattice, every candidate checked against the game's own getMove over many
// seeds. Gives a structural, optimistic ceiling: a game the AI ends with every
// point ours needs at least S_min of our stones, hence >= S_min AI replies
// (each of our stones is answered), each >= the reply floor.
//
// SUPERSEDED for the ceiling (2026-10-06): this greedy sits 25-40% above the
// true minimum on 7x7-13x13 (empty boards 5/16/26/57 here vs 4/12/21/48 from
// go-cheatceil.mjs --anneal, which also handles dealt layouts and cheats).
//
//   node go-passmin.mjs SIZE [OPPONENT] [SEEDS]
import path from "node:path";
const SIM = process.env.GO_SIM ?? path.dirname(fileURLToPath(import.meta.url));
await import(path.join(SIM, "env.mjs"));
const realSetTimeout = globalThis.setTimeout;
let cycles = 0, rows = 0;
globalThis.setTimeout = (fn, ms, ...r) => {
  if (ms === 40 || ms === 200) cycles++;
  if (ms === 10) rows++;
  return realSetTimeout(fn, 0, ...r);
};
const g = await import(path.join(SIM, "game.bundle.mjs"));
const { GoColor, GoOpponent } = g;
const N = Number(process.argv[2] ?? 7);
const OPP = GoOpponent[process.argv[3] ?? "Tetrads"];
const SEEDS = Number(process.argv[4] ?? 16);

// A position from a set of black points, chains computed by the game's makeMove
// (the last stone is played as a move).
function stateOf(black) {
  const pts = [...black];
  const last = pts.pop();
  const copy = Array.from({ length: N }, (_, x) => Array.from({ length: N }, (_, y) => ({ color: black.has(x * N + y) && x * N + y !== last ? GoColor.black : GoColor.empty })));
  const st = g.getNewBoardState(N, OPP, false, copy);
  st.previousPlayer = GoColor.white;
  if (!g.makeMove(st, Math.floor(last / N), last % N, GoColor.black)) return null;
  g.Go.currentGame = st;
  return st;
}
async function passes(black, seeds = SEEDS) {
  let pc = 0;
  for (let s = 0; s < seeds; s++) {
    const st = stateOf(black);
    if (!st) return { all: false };
    cycles = 0; rows = 0;
    const r = await g.getMove(st, GoColor.white, OPP, false, 1 + s * 104729);
    if (r.type === "move") return { all: false };
    pc += cycles * 200 + rows * 10;
  }
  return { all: true, passMs: pc / seeds };
}
// Start: walls every 4th line (3x3 cells), offset chosen to use the edges.
let best = null;
for (let o = 0; o < 4; o++) {
  const b = new Set();
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if (x % 4 === o || y % 4 === o) b.add(x * N + y);
  if ((await passes(b)).all && (!best || b.size < best.size)) best = b;
}
if (!best) {
  const b = new Set();
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if (x % 3 === 1 || y % 3 === 1) b.add(x * N + y);
  best = b;
}
console.log(`${N}x${N}: start lattice ${best.size} stones`);
// Greedy removal in random orders, keep the smallest.
let improved = true;
let rnd = 7;
const rand = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
while (improved) {
  improved = false;
  const order = [...best].sort(() => rand() - 0.5);
  for (const p of order) {
    const t = new Set(best);
    t.delete(p);
    if (t.size < 1) continue;
    if ((await passes(t)).all) {
      best = t;
      improved = true;
    }
  }
}
const check = await passes(best, 128);
const grid = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (best.has(x * N + y) ? "X" : ".")).join("")).join("\n");
console.log(`${N}x${N} ${process.argv[3] ?? "Tetrads"}: S_min <= ${best.size} stones (AI passes on 128/128 seeds: ${check.all}; its pass costs ${check.passMs}ms)\n${grid}`);
console.log(JSON.stringify({ size: N, sMin: best.size, verified: check.all, passMs: check.passMs, points: N * N }));
process.exit(0);
