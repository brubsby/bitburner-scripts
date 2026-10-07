// KataGo as a BATCHED NEURAL-NET EVALUATOR for the opponent-model search
// (golib.modelSession opts.nn): one position in, the net's policy, win
// probability and ownership out — no KataGo search (maxVisits 1).
//
//   const ev = await startEvaluator({ remote: "bubtop" })   // null if no engine
//   const e = await ev.eval(board, komi)   // { policy, pass, winB, areaB }
//   ev.busyMs                              // wall ms with >= 1 query outstanding
//   ev.close()
//
// WHY. The model search plays the game's own AI exactly in the tree, but
// scores its leaves with random playouts — on 7x7 and up those are noise, and
// the search is shallow (a model call costs 3-8ms there). The net is a far
// better leaf value and move prior. The analysis engine batches whatever
// queries are in flight (numAnalysisThreads of them, one NN eval each), so the
// search keeps many leaves outstanding (modelSession nn.parallel).
//
// MEASURED (bubtop 4090, shared with gpudecrypt at 100%, b18, walls engine):
// 1 in flight ~35ms; 32 ~110ms (~300 evals/s); 64 ~170ms (~380 evals/s),
// 9x9 and 13x13 alike — the card's time slices, not the net, set it.
//
// The board is black to move (every B node of the model search). Offline
// nodes are WALLS (the patched engine, katago.mjs) — never white stones: the
// search's leaf values must not carry the hole bias.

import { startKataGo, RULES } from "./katago.mjs";

const COLS = "ABCDEFGHJKLMNOPQRSTUVWXYZ";

/** The evaluation query for one position (pure; tested). */
export function evalQuery(board, komi, id) {
  const N = board.length;
  const stones = [];
  const walls = [];
  for (let x = 0; x < N; x++)
    for (let y = 0; y < N; y++) {
      const c = board[x][y];
      if (c === "X") stones.push(["B", COLS[x] + (y + 1)]);
      else if (c === "O") stones.push(["W", COLS[x] + (y + 1)]);
      else if (c === "#") walls.push(COLS[x] + (y + 1));
    }
  return {
    id,
    initialStones: stones,
    ...(walls.length ? { walls } : {}),
    moves: [],
    initialPlayer: "B",
    rules: RULES,
    komi: Math.max(-150, Math.min(150, Math.round(komi * 2) / 2)),
    boardXSize: N,
    boardYSize: N,
    maxVisits: 1,
    includePolicy: true,
    includeOwnership: true,
  };
}

/**
 * KataGo's answer -> { policy: Float64Array(N*N) by idx x*N+y (0 where illegal),
 * pass, winB, areaB }. KataGo's arrays are row-major from the TOP row (GTP row
 * N), black's perspective (reportAnalysisWinratesAs = BLACK). areaB: black's
 * expected area by the ownership map, holes excluded — the game counts stones
 * plus territory and never removes dead stones (scoring.ts), which is what
 * KataGo's area rules predict too.
 */
export function parseEval(board, r) {
  const N = board.length;
  const policy = new Float64Array(N * N);
  let areaB = 0;
  const pol = r.policy ?? [];
  const own = r.ownership ?? [];
  for (let x = 0; x < N; x++)
    for (let y = 0; y < N; y++) {
      const k = (N - 1 - y) * N + x;
      const p = pol[k];
      policy[x * N + y] = Number.isFinite(p) && p > 0 ? p : 0;
      if (board[x][y] !== "#") {
        const o = own[k];
        areaB += Number.isFinite(o) ? (1 + o) / 2 : 0.5;
      }
    }
  const pass = Number.isFinite(pol[N * N]) && pol[N * N] > 0 ? pol[N * N] : 0;
  const winB = Number.isFinite(r.rootInfo?.winrate) ? r.rootInfo.winrate : 0.5;
  return { policy, pass, winB, areaB, leadB: r.rootInfo?.scoreLead ?? null };
}

/**
 * An evaluator over a KataGo engine. `engine` (tests) is anything with
 * query(q) -> Promise<result>; else one is started: the remote walls engine
 * (remote: host, or "self" on the GPU host) with numAnalysisThreads =
 * concurrency, one search thread each, batch = concurrency.
 */
export async function startEvaluator({ remote = null, concurrency = 64, net = null, engine = null, cacheSize = 4096, log = () => {} } = {}) {
  let kg = engine;
  if (!kg) {
    const e = await startKataGo({ remote, walls: true, visits: 1, remoteNet: net, override: `numAnalysisThreads=${concurrency},numSearchThreadsPerAnalysisThread=1,nnMaxBatchSize=${concurrency}`, log });
    if (!e) return null;
    if (!e.walls) {
      log("evaluator: the engine is not the walls engine — refused (holes would read as empty points)");
      e.close();
      return null;
    }
    kg = e;
  }
  let seq = 0;
  let outstanding = 0;
  let busyFrom = 0;
  const cache = new Map();
  const stats = { queries: 0, cacheHits: 0, busyMs: 0, errors: 0 };
  const ev = {
    stats,
    get busyMs() {
      return stats.busyMs + (outstanding ? performance.now() - busyFrom : 0);
    },
    async eval(board, komi) {
      const key = `${board.join("")}|${komi}`;
      const hit = cache.get(key);
      if (hit) {
        stats.cacheHits++;
        return hit;
      }
      stats.queries++;
      if (!outstanding++) busyFrom = performance.now();
      try {
        const r = await (kg.query ? kg.query(evalQuery(board, komi, `e${++seq}`)) : kg.raw(evalQuery(board, komi, `e${++seq}`)));
        const out = parseEval(board, r);
        cache.set(key, out);
        if (cache.size > cacheSize) cache.delete(cache.keys().next().value);
        return out;
      } catch (err) {
        stats.errors++;
        throw err;
      } finally {
        if (!--outstanding) stats.busyMs += performance.now() - busyFrom;
      }
    },
    close() {
      kg.close?.();
    },
  };
  return ev;
}
