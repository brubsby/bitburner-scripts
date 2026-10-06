// Replays a live game (one /tel/go-games.txt line) against the pass-forcing
// candidates and the opening book: for each of our moves, whether the position
// holds candidates, which the move was, the reply each candidate expects, and
// the AI's reply predicted from the logged playtime T at lags k (T + 200k) —
// so a live oracle step can be attributed (hit, miss, which lag).
//
//   node tools/sim/go-oracle-replay.mjs GAMES.txt AT [--oracle tools/goai/oracle-Tetrads.json] [--book tools/goai/book-Tetrads.json] [--moves 6]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const str = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const golib = await import(pathToFileURL(path.join(REPO, "golib.js")).href);
const { loadModel } = await import(pathToFileURL(path.join(REPO, "tools/goai/model.mjs")).href);
const model = await loadModel({ quiet: false });
const [file, at] = argv;
const g = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.includes(at)).map((l) => JSON.parse(l))[0];
if (!g) throw new Error(`no game at ${at}`);
const oracle = JSON.parse(fs.readFileSync(str("oracle", path.join(REPO, "tools/goai/oracle-Tetrads.json")), "utf8"));
const book = JSON.parse(fs.readFileSync(str("book", path.join(REPO, `tools/goai/book-${g.opponent.replace(/\s+/g, "")}.json`)), "utf8"));
const N = g.size;
const toSimple = (s) => Array.from({ length: N }, (_, x) => s.slice(x * N, (x + 1) * N));
let board = toSimple(g.start);
let hist = [];
let passed = false;
for (const [i, mv] of g.moves.slice(0, Number(str("moves", 6))).entries()) {
  if (mv.m === "P") break;
  const [x, y] = mv.m.split(",").map(Number);
  const cands = golib.oracleCandidates(oracle, board, { passed });
  const bm = golib.bookMove(book, board);
  const after = golib.applyMove(board, x, y);
  const pred = [];
  for (let k = -2; k <= 6; k++) {
    const r = await model.reply(after, { opponent: g.opponent, history: [board.join(""), ...hist], passCount: 0, rng: mv.T + 200 * k });
    pred.push(`${k}:${r ? `${r.x},${r.y}` : "P"}`);
  }
  console.log(`move ${i + 1}: played ${mv.m} (${mv.s}, ${mv.a}ms) AI replied ${mv.r} at T ${mv.T}`);
  console.log(`  book: ${bm ? `${bm.x},${bm.y}` : "-"}   candidates: ${cands.map((c) => `${c.x},${c.y}${c.second ? "+" + c.second.x + "," + c.second.y : ""}>${c.reply ? c.reply.x + "," + c.reply.y : "P"} v${c.v}`).join("  ") || "-"}`);
  console.log(`  AI reply to ${mv.m} by lag k (seed T+200k): ${pred.join(" ")}`);
  // The full-line check as go-solver runs it (the pre-path prior lags, each at k and k+1).
  const kw = [[0, 0.1], [1, 0.6], [2, 0.25], [3, 0.05]].flatMap(([k, w]) => [[k, w / 2], [k + 1, w / 2]]);
  for (const c of cands) {
    const hold = await golib.oracleLineHolds(c, board, hist, mv.T, kw, (bb, o) => model.reply(bb, { ...o, opponent: g.opponent }), { tt: 5 });
    console.log(`    full-line ${c.x},${c.y}>${c.reply ? c.reply.x + "," + c.reply.y : "P"} (${(c.rest ?? []).length + 1} steps): ok ${hold.ok} mass ${hold.mass.toFixed(2)} failAt ${hold.failAt}`);
  }
  hist = [board.join(""), ...hist];
  board = after;
  if (mv.r && mv.r !== "P" && mv.r !== "G") {
    const [rx, ry] = mv.r.split(",").map(Number);
    const b2 = board.map((c) => c.split(""));
    hist = [board.join(""), ...hist];
    const nb = golib.parseBoard(board);
    golib.play(nb, golib.makeGeometry(N), rx * N + ry, golib.THEM, golib.makeScratch(N));
    board = Array.from({ length: N }, (_, xx) => Array.from({ length: N }, (_, yy) => ".XO#"[nb[xx * N + yy]]).join(""));
    void b2;
  }
  passed = mv.r === "P";
}
process.exit(0);
