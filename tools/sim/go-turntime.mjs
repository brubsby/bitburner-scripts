import { fileURLToPath } from "node:url";
// The IPvGO AI's reply time, per turn, from the game's own getMove — and the
// check of that model against the live game's logged reply times.
//
//   node tools/sim/go-turntime.mjs [--file .telemetry/go-games.txt] [--games 200] [--json]
//
// THE MODEL (src/Go/boardAnalysis/goAI.ts, patternMatching.ts):
//   reply ms = 200 x waitCycles + 10 x patternRows + compute
// waitCycle (goAI.ts:877-883) sleeps 200ms (40ms only while Go.storedCycles > 0,
// a one-off bank of offline time — excluded: live 5x5 replies bottom out at
// 801ms = 4 x 200, so the bank is empty in steady state). It is awaited once in
// getMove (:183), once per retrieveMoveOption call (:849-850 — EVERY call, cached
// or not: capture() and defendCapture() each go through it), once more before a
// non-priority move (:211), and once in handleNextTurn before a stone is placed
// (:98). findAnyMatchedPatterns sleeps 10ms per board row (patternMatching.ts:104)
// each time moves.pattern() is called outside the endgame (it is not cached:
// Tetrads calls it twice when a pattern is found, goAI.ts:347-349).
//
// So the floor of ANY reply is 4 cycles = 800ms, independent of board size
// (capture: getMove + surround + capture-again + handleNextTurn; a pass:
// getMove + surround + defend + the final cycle), and every non-capture
// reply outside the endgame adds >= 1 row scan of n x 10ms.
//
// THE CHECK. Every live game go.js logs (/tel/go-games.txt, mirrored to
// .telemetry/go-games.txt) carries, per our move, the AI's reply r and the
// time our play call took, p (ms: our makeMove until the AI's stone is down).
// This file replays each logged position through the game's own getMove
// (tools/sim game bundle, the sleeps intercepted and COUNTED), seeded as live
// from the playtime (goAI.ts:184: WHRNG(Player.totalPlaytime) read one
// waitCycle after the play, i.e. T + 200k for a small k), keeps the seeds
// whose reply equals the logged reply, and compares 200c + 10r with p. The
// residual is the compute plus the timer slop of the live browser; it is
// printed whether or not it passes.

import fs from "node:fs";
import path from "node:path";
const SIM = process.env.GO_SIM ?? path.dirname(fileURLToPath(import.meta.url));
await import(path.join(SIM, "env.mjs"));

const realSetTimeout = globalThis.setTimeout;
let cycles = 0;
let rows = 0;
globalThis.setTimeout = function (fn, ms, ...rest) {
  if (ms === 40 || ms === 200) {
    cycles++;
    return realSetTimeout(fn, 0, ...rest);
  }
  if (ms === 10) {
    rows++;
    return realSetTimeout(fn, 0, ...rest);
  }
  return realSetTimeout(fn, ms, ...rest);
};

const g = await import(path.join(SIM, "game.bundle.mjs"));
const { GoColor, GoOpponent } = g;
const argv = process.argv.slice(2);
const str = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const FILE = str("file", path.join(SIM, "../../.telemetry/go-games.txt"));
const MAXG = Number(str("games", 200));
const JSON_OUT = argv.includes("--json");

const OPP = { TheBlackHand: "The Black Hand", SlumSnakes: "Slum Snakes" };
const games = fs.readFileSync(FILE, "utf8").trim().split("\n").map((l) => JSON.parse(l)).slice(-MAXG);

/** A board state from the logged start string (columns concatenated, '#' offline). */
function stateFrom(rec) {
  const N = rec.size;
  const copy = Array.from({ length: N }, (_, x) => Array.from({ length: N }, (_, y) => (rec.start[x * N + y] === "#" ? null : { color: GoColor.empty })));
  const ai = GoOpponent[rec.opponent] ?? OPP[rec.opponent] ?? rec.opponent;
  const st = g.getNewBoardState(N, ai, false, copy);
  g.Go.currentGame = st;
  g.Go.storedCycles = 0;
  return { st, ai };
}

async function timed(st, ai, seed) {
  cycles = 0;
  rows = 0;
  const reply = await g.getMove(st, GoColor.white, ai, true, seed);
  const c = cycles + (reply.type === "move" ? 1 : 0); // + handleNextTurn's cycle (goAI.ts:98)
  return { key: reply.type === "move" ? `${reply.x},${reply.y}` : "P", c, r: rows };
}

const per = [];
const perGame = []; // { at, black, area, pS (logged), timerS (model; stalls removed) }
let unmatched = 0, ambiguous = 0, turns = 0;
for (const rec of games) {
  const { st, ai } = stateFrom(rec);
  let pS = 0, timerS = 0;
  for (const mv0 of rec.moves) {
    // "G": the game ended on this move. After our pass the AI still replies —
    // and its pass (p ~ 1.3s) ends the game; after the AI's own pass our pass
    // ends it at once (p ~ 0), no AI time.
    if (mv0.r === "G" && !(mv0.m === "P" && mv0.p > 50)) break;
    const mv = mv0.r === "G" ? { ...mv0, r: "P" } : mv0;
    if (mv.m === "P") g.passTurn(st, GoColor.black, false);
    else {
      const [x, y] = mv.m.split(",").map(Number);
      if (!g.makeMove(st, x, y, GoColor.black)) throw new Error(`replay: our logged move ${mv.m} is illegal (${rec.at})`);
    }
    turns++;
    const hits = [];
    for (let k = 0; k <= 3; k++) {
      const t = await timed(st, ai, mv.T + 200 * k);
      if (t.key === mv.r) hits.push(t);
    }
    pS += mv.p / 1000;
    if (!hits.length) {
      unmatched++;
      timerS += mv.p / 1000;
    } else {
      const preds = new Set(hits.map((h) => 200 * h.c + 10 * h.r));
      // The reply's time with any page stall removed: the model's own time
      // (+ the median 7ms compute); ambiguous seeds: the largest candidate.
      timerS += Math.min(mv.p, Math.max(...preds) + 7) / 1000;
      if (preds.size > 1) ambiguous++;
      else per.push({ size: rec.size, p: mv.p, pred: [...preds][0], c: hits[0].c, r: hits[0].r, pass: mv.r === "P" });
    }
    if (mv.r === "P") g.passTurn(st, GoColor.white, false);
    else {
      const [x, y] = mv.r.split(",").map(Number);
      if (!g.makeMove(st, x, y, GoColor.white)) throw new Error(`replay: the AI's logged reply ${mv.r} is illegal (${rec.at})`);
    }
  }
  perGame.push({ at: rec.at, opponent: rec.opponent, size: rec.size, black: rec.black, won: rec.won, area: (rec.start.match(/\./g) || []).length, aiTurns: rec.moves.filter((m) => m.r !== "G" || (m.m === "P" && m.p > 50)).length, pS: +pS.toFixed(3), timerS: +timerS.toFixed(3) });
}
if (str("per-game", null)) fs.writeFileSync(str("per-game", null), perGame.map((x) => JSON.stringify(x)).join("\n") + "\n");

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const q = (a, f) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))];
const resid = per.map((x) => x.p - x.pred);
const out = {
  file: FILE,
  games: games.length,
  aiTurns: turns,
  matched: per.length,
  unmatched,
  ambiguous,
  predictedMeanMs: +mean(per.map((x) => x.pred)).toFixed(1),
  liveMeanMs: +mean(per.map((x) => x.p)).toFixed(1),
  residualMs: { mean: +mean(resid).toFixed(2), p05: q(resid, 0.05), p50: q(resid, 0.5), p95: q(resid, 0.95), min: Math.min(...resid), max: Math.max(...resid) },
  exact: +(per.filter((x) => Math.abs(x.p - x.pred) <= 15).length / per.length).toFixed(3),
  meanCycles: +mean(per.map((x) => x.c)).toFixed(3),
  meanRows: +mean(per.map((x) => x.r)).toFixed(2),
  passes: { n: per.filter((x) => x.pass).length, meanPred: +mean(per.filter((x) => x.pass).map((x) => x.pred)).toFixed(1), meanLive: +mean(per.filter((x) => x.pass).map((x) => x.p)).toFixed(1) },
  // Stalls: replies the live browser took >= 100ms longer than the timers —
  // not AI work (the AI's compute is ~ms here), the page/engine pausing.
  stalls: { n: resid.filter((r) => r >= 100).length, ms: resid.filter((r) => r >= 100).reduce((s, v) => s + v, 0) },
  residualNoStallMs: +mean(resid.filter((r) => r < 100)).toFixed(2),
  byCase: Object.fromEntries(
    [...new Set(per.map((x) => `${x.c}c${x.r}r`))].map((k) => {
      const xs = per.filter((x) => `${x.c}c${x.r}r` === k);
      return [k, { n: xs.length, model: xs[0].pred, liveP50: q(xs.map((x) => x.p), 0.5) }];
    }).sort((a, b) => b[1].n - a[1].n).slice(0, 12),
  ),
};
const err = (out.liveMeanMs - out.predictedMeanMs) / out.liveMeanMs;
out.relErrMean = +err.toFixed(4);
if (JSON_OUT) console.log(JSON.stringify(out));
else {
  console.log(`replayed ${out.games} live games, ${out.aiTurns} AI replies: ${out.matched} matched a clock seed uniquely, ${unmatched} no seed in T+0..600ms, ${ambiguous} seeds disagree on time`);
  console.log(`  model 200c+10r: mean ${out.predictedMeanMs}ms   live p: mean ${out.liveMeanMs}ms   error ${(100 * err).toFixed(2)}% (tolerance 3%: ${Math.abs(err) <= 0.03 ? "PASS" : "FAIL"})`);
  console.log(`  residual p - model (compute + slop): mean ${out.residualMs.mean}ms  p05 ${out.residualMs.p05}  p50 ${out.residualMs.p50}  p95 ${out.residualMs.p95}  [${out.residualMs.min}, ${out.residualMs.max}]`);
  console.log(`  within 15ms of the model: ${(100 * out.exact).toFixed(1)}% of replies;  mean cycles ${out.meanCycles}, rows ${out.meanRows} per reply`);
  console.log(`  AI passes: ${out.passes.n}, model ${out.passes.meanPred}ms vs live ${out.passes.meanLive}ms`);
  console.log(`  stalls (live >= model + 100ms): ${out.stalls.n} replies, ${(out.stalls.ms / 1000).toFixed(1)}s in all; residual without them ${out.residualNoStallMs}ms/reply`);
  const e2 = (mean(per.filter((x) => x.p - x.pred < 100).map((x) => x.p)) - mean(per.filter((x) => x.p - x.pred < 100).map((x) => x.pred))) / mean(per.filter((x) => x.p - x.pred < 100).map((x) => x.p));
  console.log(`  model vs live with stalls excluded: error ${(100 * e2).toFixed(2)}%`);
  for (const [k, v] of Object.entries(out.byCase)) console.log(`    ${k.padEnd(8)} n=${String(v.n).padStart(5)}  model ${v.model}ms  live p50 ${v.liveP50}ms`);
}
process.exit(Math.abs(err) <= 0.03 ? 0 : 1);
