// THE UCT PONDER'S HIT RATE, replayed from the live game record.
//
//   nice -n 19 node tools/sim/go-uctponder-replay.mjs [--file .telemetry/go-games.txt] [--arm Tetrads@7] [--positions 2]
//
// Every requested move in /tel/go-games.txt carries T (the playtime when go.js
// played it — exactly the RETIME the uct ponder re-predicts from) and r (the
// AI's actual reply). For each, the AI's own code (tools/goai model) is asked
// at T + 200k over an ONLINE seedCalib (as go-solver's uctCal: predict with the
// weights so far, then observe), and the move counts as a ponder HIT when the
// actual reply is among the top `positions` predicted replies. Cheat turns are
// skipped (no retime is sent after a pair; the ponder runs from the second
// stone's answer on the request-time estimate, not replayed here).
//
// CALIBRATED: the replies are the live AI's, the seeds the live playtimes. NOT
// SIMULATED: the search itself (a hit's answer is the same search at the same
// budget on the same board, so it changes time, not strength), and whether the
// worker finishes before the reply lands (live: AI reply ~1.2s vs 0.8s search).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadModel } from "../goai/model.mjs";
import { seedCalib } from "../../golib.js";
import { applyStone } from "../katago/service.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const FILE = opt("file", path.join(HERE, "../../.telemetry/go-games.txt"));
const ARM = opt("arm", "Tetrads@7");
const POS = Number(opt("positions", 2));
const [OPP, SIZE] = [ARM.slice(0, ARM.lastIndexOf("@")), Number(ARM.slice(ARM.lastIndexOf("@") + 1))];

const model = await loadModel({ quiet: false });
if (!model) {
  console.error("no opponent model (tools/goai/build.mjs)");
  process.exit(2);
}
const games = fs.readFileSync(FILE, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((g) => g.opponent === OPP && g.size === SIZE && typeof g.start === "string" && !g.resumed);
const N = SIZE;
const boardOf = (s) => Array.from({ length: N }, (_, i) => s.slice(i * N, i * N + N));
const cal = seedCalib();
let asked = 0;
let hits = 0;
let top1 = 0;
let unreplayable = 0;
const perGame = [];
for (const g of games) {
  let b = boardOf(g.start);
  const hist = [];
  let gh = 0;
  let ga = 0;
  for (const mv of g.moves) {
    const stones = mv.m === "P" ? [] : mv.m.split("+").map((p) => p.split(",").map(Number));
    let after = b;
    for (const [x, y] of stones) after = applyStone(after, x, y, "X") ?? after;
    const histAfter = stones.length ? [b.join(""), ...hist] : hist.slice();
    if (mv.s === "req" && stones.length === 1 && mv.T > 0 && mv.r && mv.r !== "G") {
      const actual = mv.r === "P" ? "pass" : mv.r;
      // Predict: weight per reply over the calibrated k.
      const w = new Map();
      for (const [k, wk] of cal.weights()) {
        const m = await model.reply(after, { opponent: OPP, history: histAfter.slice(0, 8), rng: mv.T + 200 * k });
        const key = m ? `${m.x},${m.y}` : "pass";
        w.set(key, (w.get(key) ?? 0) + wk);
      }
      const ranked = [...w.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).filter((k) => k !== "pass").slice(0, POS);
      asked++;
      ga++;
      if (ranked.includes(actual)) {
        hits++;
        gh++;
      }
      if (ranked[0] === actual) top1++;
      // Observe (as calibrateUctSeed).
      const matches = [];
      for (let k = cal.range[0]; k <= cal.range[1]; k++) {
        const m = await model.reply(after, { opponent: OPP, history: histAfter.slice(0, 8), rng: mv.T + 200 * k });
        if ((m ? `${m.x},${m.y}` : "pass") === actual) matches.push(k);
      }
      if (!matches.length) unreplayable++;
      cal.observe(matches, cal.weights()[0]?.[0] ?? null);
    }
    // The AI's reply onto the board.
    b = after;
    let next = b;
    if (mv.r && mv.r !== "P" && mv.r !== "G") {
      const [x, y] = mv.r.split(",").map(Number);
      next = applyStone(b, x, y, "O") ?? b;
    }
    hist.splice(0, hist.length, ...(next !== b ? [b.join(""), ...histAfter] : histAfter));
    b = next;
  }
  if (ga) perGame.push(gh / ga);
}
const p = hits / asked;
const se = Math.sqrt((p * (1 - p)) / asked);
console.log(`${ARM}: ${games.length} games, ${asked} requested single-stone turns with T`);
console.log(`ponder hit (actual reply in the top ${POS} predicted): ${(100 * p).toFixed(1)}% +- ${(100 * se).toFixed(1)}%  (top-1 ${((100 * top1) / asked).toFixed(1)}%)`);
console.log(`replies no k in [${cal.range}] reproduces (history/board drift): ${unreplayable} (${((100 * unreplayable) / asked).toFixed(1)}%)`);
console.log(`calibrated k weights: ${JSON.stringify(cal.weights().slice(0, 4).map(([k, w]) => [k, +w.toFixed(3)]))}`);
