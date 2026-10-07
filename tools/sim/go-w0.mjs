// NOT CALIBRATED against the live game: no game against the hidden opponent has
// been played, and the wall clock is modelled from timer hops (below). The
// opponent and the rules ARE the game's own code (the bundle).
// How well does the solver play the HIDDEN opponent (GoOpponent.w0r1d_d43m0n,
// "????????????") — the number the whole-game planner calls `w0`?
//
//   node tools/sim/go-w0.mjs --games 10 --maxms 800 [--score 0.5] [--out f.jsonl]
//
// The opponent is the game's own getMove (src/Go/boardAnalysis/goAI.ts), on the
// board the game itself deals: getNewBoardState(19, w0r1d_d43m0n, true) replaces
// the board with the rotated bitverseBoardShape and applies the 7 white
// handicap routers (boardState.ts:26-30, 60-63, 100-112). Komi 9.5, so
// difficultyMultiplier = (9.5+0.5)*0.25 = 2.5 (effect.ts:132-135). isSmart is
// true and the move set is getIlluminatiPriorityMove (goAI.ts:225-259).
//
// Fidelity notes carried over from go-boardsize.mjs: the AI's WHRNG is seeded
// with an explicit random per move (offline totalPlaytime never advances), and
// the AI's sleeps are short-circuited and COUNTED, so the live wall clock is
// rebuilt analytically: every 40/200ms delay is one waitCycle (200ms live once
// stored cycles are spent) and every 10ms delay is one pattern-matching row
// (patternMatching.ts:104, a real 10ms live — Chrome clamps nested timers to
// >=4ms, so 10ms is what it costs).
//
// Our side also replicates go.js's MIRROR PASS: when the AI passes and black
// is ahead on the live score, we pass and the game ends.
//
// One JSONL record per game: black/white sums, win, our think ms, the AI's
// compute ms and hop counts, and the node power the game would bank at the
// running win streak (scoring.ts:85-88).

import os from "node:os";
import fs from "node:fs";

try {
  os.setPriority(19);
} catch {
  /* not fatal */
}

import "./env.mjs";

const realSetTimeout = globalThis.setTimeout;
// Per-move overhead outside both searches (see liveS below). Exported in the
// start record as rtMs so the report can re-time records made at another value.
const ROUND_TRIP_MS = 85;
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

const g = await import("./game.bundle.mjs");
const { randomizeLayout, dealPaired } = await import("./go-board.mjs");
// --layoutseed S: game i gets the same board in every run with seed S (paired A/B).
const LAYOUT_SEED = process.argv.includes("--layoutseed") ? Number(process.argv[process.argv.indexOf("--layoutseed") + 1]) : null;
const golib = await import("../../golib.js");
const { GoColor, GoOpponent } = g;

const argv = process.argv.slice(2);
const str = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : dflt;
};
const num = (name, dflt) => Number(str(name, dflt));
const GAMES = num("games", 4);
const MAXMS = num("maxms", 800);
// --opening K:MS — the first K of our moves search for MS instead of MAXMS
// (the opening decides most 5x5 losses; it is a few moves of a ~25s game).
const OPENING = (() => {
  const v = str("opening", null);
  if (!v) return null;
  const [k, ms] = v.split(":").map(Number);
  return { k, ms };
})();
// --cheat-second-ms MS: the second stone of a cheat is searched MS instead of
// the move budget (go.js passes it as the request's maxms).
const CHEAT_SECOND_MS = Number(process.argv.includes("--cheat-second-ms") ? process.argv[process.argv.indexOf("--cheat-second-ms") + 1] : NaN);
let secondStone = false;
// --cheat-joint: a re-ask for a SINGLE move (the pair was declined): no pairs searched.
let noPairs = false;
const budgetFor = (turn) => (secondStone && Number.isFinite(CHEAT_SECOND_MS) ? CHEAT_SECOND_MS : OPENING && turn < OPENING.k ? OPENING.ms : MAXMS);
const OUT = str("out", null);
const OPP = GoOpponent[str("opponent", "w0r1d_d43m0n")];
const SIZE = num("size", 19);
const VERBOSE = argv.includes("--verbose");
// --trace: every game record carries its move list and the board after each
// ply (simple-board strings), for loss analysis.
const TRACE = argv.includes("--trace") || argv.includes("--trace-losses");
// --trace-losses: the trace is kept only on LOST games (thousands-of-games runs;
// tools/sim/go-fixture.mjs --harness turns each into a corpus case). Trace
// entries carry T (the modelled playtime at our play) and the AI's exact seed.
const TRACE_LOSSES = argv.includes("--trace-losses");
// Solver options passed straight through to chooseMoveUCT (golib.js).
const OPTS = JSON.parse(str("opts", "{}"));
// --model: search with golib.chooseMoveModel against the game's own AI policy
// (tools/goai — the opponent's getMove bundled from game source), as the
// external solver does when the model is available.
let MODEL = null, MODELRAW = null;
if (argv.includes("--model")) {
  const { loadModel } = await import("../goai/model.mjs");
  const m = await loadModel({ quiet: false });
  if (!m) throw new Error("--model: tools/goai could not build or load the opponent model");
  MODEL = { reply: (b, o) => m.reply(b, { ...o, opponent: OPP }) };
  MODELRAW = m;
}
// --session reuse|ponder (with --model): golib.modelSession — ONE tree kept
// across moves. reuse: the subtree under the AI's actual reply becomes the
// next root, and a root already holding the budget's worth of visits
// (measured iterations per ms of fresh searches) answers at once. ponder: the
// same, plus the search continues under the AI's reply for its whole LIVE
// reply time (waitCycles x 200ms + pattern rows x 10ms) — probability-
// weighted over its replies by the chance node. As go-solver does live.
// deep: ponder as above, but a reused root still searches the FULL budget —
// the time ponder saves spent on depth instead (release 2 item 4).
const SESSION = str("session", null);
let sessRate = null; // work (model-calling iterations) per ms of a fresh full-budget search

// RELEASE 3 (with --session):
// --objective power   the search values a finished game as the node power it
//                     banks (golib.powerObjective: black x difficulty x the
//                     streak multiplier this game would earn, a loss priced at
//                     0.5 AND the streak ramp it costs the next games) minus
//                     the time it takes (--rate power/h x --turns s per ply).
//                     Built per game from the running streak, as go.js does.
//   --loss-scale K    scales the priced streak-reset cost (1 = priced)
//   --leafk K         turns charged per empty point at a playout leaf
//                     (MEASURED WORSE 2026-10-06, Tetrads 5x5, 42 paired:
//                     K=0.5 -16.9% power/h; with --rate x2 -15.5%; --rate x2
//                     alone -7.9%: time pressure shortens games by giving up
//                     area, not by making the AI pass — see go-oracle.mjs)
// --mirror search     when the AI passes and black is ahead, ASK the search
//                     (it may play on to take more area) instead of passing.
// --presend           a move whose position the ponder had already answered
//                     (golib ponderAnswers: the reply's node holds the budget's
//                     work) is played with no solver round trip: charged
//                     PRESEND_MS instead of ROUND_TRIP_MS + the search.
// --seeded            THE AI'S SEED IS THE CLOCK, as live (goAI.ts:184): the
//                     harness keeps a playtime that moves in 200ms engine ticks
//                     on the modelled live wall clock, and the AI's reply is
//                     seeded with it one waitCycle after our move. Without
//                     --clock the search still draws free seeds (release 2).
// --clock             the search is told the playtime of each request (and of
//                     each pre-sent move) and draws the AI's NEXT reply from
//                     T + 200k, k calibrated online (golib.seedCalib) from the
//                     replies seen — as go-solver does live.
// --local: go.js's in-game fallback (golib.chooseMove, 20ms, top 8) plays every
// move — what a game costs when the solver is absent (SETTINGS.solverWait).
const LOCAL = argv.includes("--local");
// --adaptive THR:MULT  ADAPTIVE BUDGET: when the chosen move's own win rate
//                     (the search's top[0] winRate) is below THR, search on for
//                     (MULT-1) x the budget more (the hard layouts: a broken
//                     streak costs ~8 games of multiplier ramp).
// --adaptive-steps: extend one budget at a time, stopping once the chosen line wins >= THR.
const ADAPTIVE_STEPS = argv.includes("--adaptive-steps");
// --book FILE: the opening book (tools/sim/go-book.mjs --merge) played where it has the position.
// --book-pass: also play the book's after-the-AI's-pass entries (passEntries).
const BOOK_PASS = argv.includes("--book-pass");
let BOOK = str("book", null) ? JSON.parse(fs.readFileSync(str("book", null), "utf8")) : null;
// --book-b FILE|none --out-b F: A/B IN ONE PROCESS. Every game is played twice,
// back to back on the same deal: arm A with --book (or none), arm B with
// --book-b, each with its own streak, seed calibration and search-rate
// estimate; arm B's records go to --out-b. On bubtop (WSL2 over a hybrid
// 12700K: P- and E-cores the guest cannot see) a process's speed depends on
// where Windows places it, so separate processes per arm carry a placement
// bias that a per-game bootstrap does not see — measured 2026-10-06 as a
// "-3.0% [-4.8, -1.1]" between two books that differ only on rare layouts,
// with the slower arm's searches taking 2x as long on the SAME games.
const BOOK_B = str("book-b", null) ? (str("book-b", null) === "none" ? null : JSON.parse(fs.readFileSync(str("book-b", null), "utf8"))) : undefined;
const OUT_B = str("out-b", null);
// --oracle-file F: the pass-forcing candidates (go-oracle-book.mjs output,
// tools/goai/oracle-<Opponent>.json) beside the book.
if (str("oracle-file", null)) {
  const o = JSON.parse(fs.readFileSync(str("oracle-file", null), "utf8"));
  if (!BOOK) throw new Error("--oracle-file needs --book");
  BOOK.oracle = o.oracle;
  BOOK.oraclePass = o.oraclePass;
}
const EXTEND = (() => {
  const v = str("extend", null);
  if (!v) return null;
  const [from, to, gap, mult] = v.split(":").map(Number);
  return { from, to, gap, mult };
})();
const ADAPTIVE = (() => {
  const v = str("adaptive", null);
  if (!v) return null;
  const [thr, mult] = v.split(":").map(Number);
  return { thr, mult };
})();
// --layouts I,J,...   play only these paired layout indices (with --layoutseed).
const LAYOUTS = str("layouts", null) ? str("layouts", "").split(",").map(Number) : null;
// --scan              per layout: the first move's fresh search only; emit
//                     {kind: "scan", i, v0} (v0 = the chosen move's win rate).
const SCAN = argv.includes("--scan");
const OBJECTIVE = str("objective", null);
const LOSS_SCALE = num("loss-scale", 1);
const LEAF_K = num("leafk", 0);
const TURN_S = num("turns", 1.2);
const MIRROR = str("mirror", "always");
const PRESEND = argv.includes("--presend");
const PRESEND_MS = 10;
const SEEDED = argv.includes("--seeded");
// --cpu-scale F: every session search and ponder runs F x its live duration,
// and the live clock is charged the time / F — a faster host (bubtop's
// 12700K does ~1.8x the model-calling iterations per ms of this laptop's
// 8565U, the live solver's machine) plays at the live search STRENGTH.
// Calibrate F = (work/ms here, live box) / (work/ms on the host under its load).
const CPU_SCALE = num("cpu-scale", 1);
// --work-rate R: THE MACHINE-INDEPENDENT CLOCK. Every search and ponder runs
// for a number of model-calling iterations (R x its live milliseconds), and
// the live clock is charged work / R ms. Wall-clock budgets made the measured
// power/s depend on each process's CPU share: on bubtop (WSL2, a hybrid CPU
// the guest cannot see, other jobs) two harness processes running the SAME
// configuration differed 2-10x in search ms a game, more than any effect
// measured. R = the live solver's work per ms (1.6-1.9 on puter, rate.mjs).
const WORK_RATE = str("work-rate", null) === null ? null : num("work-rate", 1.7);
const CLOCK = argv.includes("--clock");
if (CLOCK && !SEEDED) throw new Error("--clock needs --seeded (an AI seeded by the clock to predict)");
// --retime (with --clock): after a REQUESTED move is played, go.js sends the
// playtime read at the play (as a pre-sent move's notice does) and the solver
// re-anchors the ponder's clock there (session.setClock): the AI's next reply
// is then drawn from the exact play-time seed instead of the request's T plus
// the search's uncertain length.
const RETIME = argv.includes("--retime");
const ORACLE_MISSES = str("oracle-misses", null);
const ORACLE_FULL = argv.includes("--oracle-full");
// --oracle-override-book (with --oracle-full): a candidate whose whole line holds may replace the book's move.
const ORACLE_OVERRIDE = argv.includes("--oracle-override-book");
const ORACLE_GUARD = str("oracle-guard", null) ? (([v, w]) => ({ v, w }))(str("oracle-guard", null).split(":").map(Number)) : null;
const ORACLE = argv.includes("--oracle-book") ? { noise: (() => { const v = Number(argv[argv.indexOf("--oracle-book") + 1]); return Number.isFinite(v) ? v : 0; })() } : null;
const STEER_BOOK = (() => {
  const v = str("steer-book", null);
  if (!v) return null;
  const [k, noise] = v.split(":").map(Number);
  return { k, noise: Number.isFinite(noise) ? noise : 0 };
})();
const STEER = (() => {
  const v = str("steer", null);
  if (!v) return null;
  const [k, ms] = v.split(":").map(Number);
  return { k, ms: Number.isFinite(ms) ? ms : 40 };
})();
if (RETIME && !CLOCK) throw new Error("--retime needs --clock");
// The rate each ply is charged at: the opponent's measured power/h (goplan).
const RATE_PH = str("rate", null) === null ? null : num("rate", 0);
const { POWER_PER_HOUR } = await import("../../goplan.js");
const rateFor = (opp) => RATE_PH ?? POWER_PER_HOUR[{ "The Black Hand": "TheBlackHand", "Slum Snakes": "SlumSnakes" }[opp] ?? opp] ?? 0;
// One calibrator per path (request: T is read when go.js writes the request;
// pre-sent: when it plays), shared across the run's games, as the live solver.
let calib = { req: golib.seedCalib(), pre: golib.seedCalib() };
const seedStats = { informative: 0, predicted: 0, observed: 0 };

// --katago V: moves from KataGo (tools/katago/service.mjs — the service
// go-solver runs, V visits a move) instead of golib. Think time is measured.
//   --katago-remote HOST   the GPU engine on HOST over ssh (tools/katago/gpu),
//                          the local CPU engine only if it fails (as live)
//   --katago-no-local      no CPU fallback (a GPU arm must be all-GPU)
//   --katago-override K=V,...  engine config overrides (threads, batch)
//   --ponder               after each of our moves, answer the AI's likely
//                          replies (sampled from tools/goai, the AI's own code)
//                          while its reply is "thinking": the harness waits
//                          the AI's LIVE reply time (its waitCycles and pattern
//                          rows), or less if the ponders finish, before asking
//                          — so a hit is charged what it costs live.
let KATAGO = null, KVISITS = 0, KMODEL = null;
const PONDER = argv.includes("--ponder");
// --ponder also applies to --model: after our move, the AI's most likely
// reply (sampled from the model) is searched at the full budget while the AI
// "thinks"; a hit is answered at once, charged only the ponder's overrun past
// the AI's live reply time. As go-solver does live.
const { ponderPositions, ponderSeeds, SEED_OFFSETS } = await import("../katago/service.mjs");
const PONDER_SPREAD = argv.includes("--ponder-spread");
let spreadTicks = 0;
if (argv.includes("--katago")) {
  if (argv.includes("--kcal")) throw new Error("--kcal was measured worse and is not wired to the service (katago.mjs startKataGo still has it)");
  const svc = await import("../katago/service.mjs");
  KVISITS = Number(str("katago", 200));
  KATAGO = new svc.KataGoService({ remote: str("katago-remote", null), local: !argv.includes("--katago-no-local"), remoteOverride: str("katago-override", ""), remoteNet: str("katago-remote-net", null), walls: !argv.includes("--katago-stock"), settings: JSON.parse(str("katago-settings", "null")), queryOpts: { ...(argv.includes("--katago-old-pass") ? { allowUnsettledPass: true } : {}), ...(str("katago-holes", null) ? { holes: str("katago-holes", null) } : {}) }, log: (m) => process.stderr.write(m + "\n") });
  // Warm before game 0: live, the engine is kept warm across games.
  if (!(await KATAGO.engineFor(SIZE))) throw new Error("--katago: no KataGo engine could start (tools/katago/install.sh, tools/katago/gpu)");
  if (PONDER) {
    const { loadModel } = await import("../goai/model.mjs");
    KMODEL = await loadModel({ quiet: false });
    if (!KMODEL) throw new Error("--ponder: tools/goai model could not load");
  }
}

// --nn [HOST]: THE NET IN THE MODEL SEARCH (with --model --session): the
// walls-KataGo net (tools/katago/evaluator.mjs on HOST, default "self" — the
// harness on the GPU host) scores the session's new B nodes and gives its
// stones a PUCT prior (golib.modelSession opts.nn). --nn-mix W (net share of a
// leaf's value, 1), --nn-cpuct C (1.5), --nn-par K (iterations in flight, 16),
// --nn-fpu F (0.1), --nn-conc Q (the engine's batch, 64).
// CHARGING: our time is work / WORK_RATE (the CPU side, --work-rate) PLUS the
// wall time the evaluator had a query in flight (the GPU side, as live waits
// for it on the same card) — summed, not overlapped: pessimistic for the net.
// A ponder stops when work / WORK_RATE + the net's busy time reaches the AI's
// live reply time.
let NNEV = null;
if (argv.includes("--nn")) {
  const { startEvaluator } = await import("../katago/evaluator.mjs");
  const host = str("nn", "self");
  NNEV = await startEvaluator({ remote: host && !host.startsWith("--") ? host : "self", concurrency: num("nn-conc", 64), log: (m) => process.stderr.write(m + "\n") });
  if (!NNEV) throw new Error("--nn: the walls evaluator could not start (tools/katago/walls)");
  if (!WORK_RATE) throw new Error("--nn needs --work-rate (the CPU side is charged as work)");
}
// --nn-free: the net's time is NOT charged (and does not cap a ponder) — the
// search as if its evaluator were instant: the ceiling a fast net (a small
// distilled one in the solver's own process) could reach.
const NN_FREE = argv.includes("--nn-free");
// --smallnet FILE: the DISTILLED net in this process (tools/katago/smallnet.mjs)
// as the search's net — its CPU time is measured and charged like the GPU's
// busy time (no batching: nn.parallel 1).
if (str("smallnet", null)) {
  const { loadSmallNet } = await import("../katago/smallnet.mjs");
  const sn = loadSmallNet(str("smallnet", null));
  let ms = 0;
  NNEV = { stats: { queries: 0, cacheHits: 0 }, get busyMs() { return ms; }, close() {}, eval: async (b, k) => { const t = performance.now(); const e = sn.eval(b, k); ms += performance.now() - t; NNEV.stats.queries++; return e; } };
  if (!WORK_RATE) throw new Error("--smallnet needs --work-rate");
}
const NN_OPTS = NNEV ? { eval: (b, k) => NNEV.eval(b, k), mix: num("nn-mix", 1), cpuct: num("nn-cpuct", 1.5), parallel: str("smallnet", null) ? 1 : num("nn-par", 16), fpu: num("nn-fpu", 0.1) } : null;

// ---------------------------------------------------------------------------
// CHEATS (netscriptGoImplementation.ts:500-567). Only playTwoMoves is modelled.
//
//   chance(k) = min(1, 0.6 * (0.7 - 0.02k)^k * crime_success + (SF14.3 ? 0.25 : 0))
//   success  -> both stones placed, captures resolved, the AI replies
//   failure  -> k == 0: our turn is passed;  k >= 1: 10% ejected
//               (forceEndGoGame: no node power, streak reset), else passed
//
// --cheat blind      roll Math.random() like a script that cannot see the RNG
// --cheat predicted  the roll is WHRNG(Player.totalPlaytime) (:512), a pure
//                    sawtooth in playtime: r = frac(T/1000 * RATE) with
//                    RATE = 171/30269 + 172/30307 + 170/30323 per second, period
//                    59.06s (Casino/RNG.ts:40-63). A script reading
//                    getPlayer().totalPlaytime in the same tick as the call
//                    knows the outcome; it cheats only inside the window
//                    r <= chance(k), waiting at most --cheatwait seconds.
//                    The phase here advances with the modelled live clock.
const CHEAT = str("cheat", null);
const CHEAT_MAX = num("cheatmax", 99);
const CHEAT_FROM = num("cheatfrom", 2); // first of our turns a cheat may be used on
const CHEAT_WAIT = num("cheatwait", 10);
// --cheat-keep-lines: no greedy cheat on a turn the pass-forcing book is
// steering (its line assumes one stone there).
const CHEAT_KEEP_LINES = argv.includes("--cheat-keep-lines");
// --cheat-joint K1:K2 (with --cheat predicted and a session): THE CHEAT AS A
// JOINT ACTION. The session searches pairs of stones (golib modelSession
// opts.pairs) wherever the roll's clock says a cheat will be available — at
// the root (the play's playtime) and, while pondering, after the AI's reply
// (its expected playtime, a wider margin) — so stone 1 is chosen knowing stone
// 2 follows, and a pondered pair is pre-sent whole (no second-stone request).
// The greedy cheat (best single, then a fresh second-stone search) is off.
const CHEAT_JOINT = (() => {
  const v = str("cheat-joint", null);
  if (!v) return null;
  const [a, b, only] = v.split(":");
  return [Number(a), Number(b), only === "only"];
})();
if (CHEAT_JOINT) {
  OPTS.pairs = CHEAT_JOINT.slice(0, 2);
  if (CHEAT_JOINT[2]) OPTS.pairsOnly = true;
}
// --cheat-hybrid THR: the GREEDY cheat, except on a HARD move — the chosen
// single's own win rate under THR with a cheat window open: there the pair is
// searched jointly (pairsOnly, a full budget and a round trip charged) and
// played whole; if the pair search finds no pair, the greedy cheat as before.
const CHEAT_HYBRID = num("cheat-hybrid", 0);
if (CHEAT_HYBRID && !CHEAT_JOINT) {
  OPTS.pairs = [6, 5];
  OPTS.pairsOnly = true;
}
let pairsNow = false;
// --cheat-skip-below THR: no greedy cheat on a move whose chosen single wins
// under THR (its own win rate): the single stone instead.
const CHEAT_SKIP = num("cheat-skip-below", 0);
const CRIME = num("crime", 1);
// go.js execs go-cheat.js, polls isRunning every 50ms and reads its result
// (/tel/go-cheat.txt): ~150ms a played cheat beyond the window wait. Assumed.
const CHEAT_EXEC_MS = 150;
const SF143 = argv.includes("--sf143");
const RATE = 171 / 30269 + 172 / 30307 + 170 / 30323;
const pCheat = (k) => Math.max(0, Math.min(1, 0.6 * (0.7 - 0.02 * k) ** k * CRIME + (SF143 ? 0.25 : 0)));
const MIN_P = 0.2 * RATE; // one 200ms engine tick of window: narrower can be stepped over

let emitTo = null; // arm B's file while arm B plays (--book-b)
const emit = (obj) => {
  const line = JSON.stringify(obj) + "\n";
  const out = emitTo ?? OUT;
  if (out) fs.appendFileSync(out, line);
  else process.stdout.write(line);
};

function validGrid(state, N) {
  const grid = Array.from({ length: N }, () => new Array(N).fill(false));
  for (const p of g.getAllValidMoves(state, GoColor.black)) grid[p.x][p.y] = true;
  return grid;
}
const rngSeed = () => Math.floor(Math.random() * 30000 * 1000) + 1;

// The streak multipliers this game would be credited at (effect.ts:119-130),
// from the running streak — what go.js sends the solver as `objective`.
function objectiveFor(stats) {
  const win = g.getWinstreakMultiplier(stats.winStreak < 0 ? 1 : stats.winStreak + 1, stats.winStreak);
  return { win, loss: 0.5 };
}

async function playGame(stats, gameIndex) {
  // A fresh offline-node layout per game (go-board.mjs: without this the
  // harness deals ONE layout forever). --fixed-layout restores the old deal.
  if (!argv.includes("--fixed-layout")) randomizeLayout(g);
  const state = LAYOUT_SEED !== null ? dealPaired(g, SIZE, OPP, LAYOUT_SEED, gameIndex) : g.getNewBoardState(SIZE, OPP, true);
  g.Go.currentGame = state;
  g.Go.storedCycles = 1e9;
  const N = state.board.length;
  const komi = g.opponentDetails[OPP].komi;
  let modelCalls = 0;
  const steerStats = { evals: 0, steered: 0, delayTicks: 0, book: 0, miss: 0 };
  const jointStats = { pairs: 0, singles: 0, rollMiss: 0 };
  // Will cheat k be available if we play `lagMs` from now? (margin: the roll's own uncertainty)
  const cheatAvailIn = (lagMs, margin) => (k) => k < CHEAT_MAX && !oppPassed && ourTurns + 1 >= CHEAT_FROM && pCheat(k) >= MIN_P && golib.cheatRoll(playtimeAt(wall + lagMs)) <= pCheat(k) - margin;
  let steerTarget = undefined, seedSkew = 0, seedJit = 0, oracleHit = false, oracleMoves = 0, oracleMiss = 0, oracleLeft = false, oracleGuarded = 0, oracleCheats = 0, oracleLineFail = 0;
  let ourTurns = 0, ourMs = 0, iters = 0, oppTurns = 0, oppMs = 0, oppCycles = 0, oppRows = 0, mirror = 0, ourPasses = 0;
  let guard = 0;
  let oppPassed = false;
  let cheats = 0, cheatOk = 0, cheatWaitS = 0, ejected = false;
  let phase = Math.random();
  let turnLiveS = 0;
  const kWhere = { gpu: 0, cpu: 0, walls: 0 };
  const kPonder = { none: 0, hit: 0, partial: 0 };
  // The model's ponder (--model --ponder): the searched answer for the
  // predicted reply, and the ponder time not hidden behind the AI's reply.
  let mPonder = null;
  let ponderCarry = 0;
  const mStats = { hit: 0, miss: 0, none: 0, carryMs: 0 };
  const sess = MODEL && SESSION ? golib.modelSession(N, komi, MODEL, NN_OPTS ? { ...OPTS, nn: NN_OPTS } : OPTS) : null;
  let nnMs = 0;
  const sStats = { reused: 0, fresh: 0, early: 0, ponderIters: 0, rootVisits: 0 };
  // RELEASE 3 per-game state (see the flags above).
  const objective = OBJECTIVE === "power" ? golib.powerObjective({ streak: stats.winStreak, komi, size: N, eBlack: stats.meanBlack ?? 0.68 * N * N, rate: rateFor(OPP) / 3600, turnS: TURN_S, lossScale: LOSS_SCALE, leafK: LEAF_K }) : undefined;
  // The modelled live wall clock (ms) and the playtime on it: whole 200ms
  // engine cycles at a random phase (engine.tsx:84-96).
  let wall = 0;
  const T0 = 200 * Math.floor(5e6 + Math.random() * 5e6);
  const tickPhase = Math.random() * 200;
  const playtimeAt = (t) => T0 + 200 * Math.floor((t + tickPhase) / 200);
  let answers = [];
  let preMoves = 0, rtTotal = 0;
  const seedG = { informative: 0, predicted: 0, observed: 0 };
  let pendingSeed = null; // { path, Tref, board, history, passCount }
  // The first move's chosen win rate, the lowest seen, and the moves the
  // adaptive budget extended.
  let v0 = null, minWr = 1, adaptiveMoves = 0, extendMoves = 0, bookMoves = 0;
  const trace = TRACE ? [{ who: "start", board: g.simpleBoardFromBoard(state.board) }] : null;
  const note = (who, mv, extra) => trace && trace.push({ who, mv, board: g.simpleBoardFromBoard(state.board), ...(extra ?? {}) });
  const solve = async () => {
    const simple = g.simpleBoardFromBoard(state.board);
    const valid = validGrid(state, N);
    if (MODEL && PONDER) {
      const p = mPonder;
      mPonder = null;
      const top = p?.ranked?.[0];
      if (p && p.key === simple.join("/") && !oppPassed && top && valid[top.x]?.[top.y]) {
        mStats.hit++;
        ourMs += ponderCarry;
        mStats.carryMs += ponderCarry;
        ponderCarry = 0;
        modelCalls += top.modelCalls ?? 0;
        iters += top.iters ?? 0;
        return p.ranked;
      }
      mStats[p ? "miss" : "none"]++;
    }
    ourMs += ponderCarry;
    mStats.carryMs += ponderCarry;
    ponderCarry = 0;
    const t0 = performance.now();
    const nnBusy0 = NNEV ? NNEV.busyMs : 0;
    let solveWork = null;
    // An extension of `ms` more search: wall time, or (--work-rate) work.
    const moreSearch = (ms) =>
      WORK_RATE ? sess.search({ maxms: 1e9, untilWork: sess.rootWork + Math.round(WORK_RATE * ms), untilVisits: sess.rootVisits + 50 * WORK_RATE * ms + 100 }) : sess.search({ maxms: ms * CPU_SCALE });
    const opts = { ...OPTS, opponentPassed: oppPassed };
    if (OPTS.objective === "auto") opts.objective = objectiveFor(stats);
    const ranked = KATAGO
      ? await (async () => {
          const vl = [];
          for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if (valid[x][y]) vl.push([x, y]);
          const r = await KATAGO.choose({ size: N, board: simple, valid: vl, komi, visits: KVISITS });
          if (!r) throw new Error("katago: no engine answered");
          kWhere[r.where.startsWith("gpu") ? "gpu" : "cpu"]++;
          if (r.walls) kWhere.walls++;
          kPonder[r.pondered || "none"]++;
          return r.pass ? [] : [{ x: r.x, y: r.y, iters: r.visits }];
        })()
      : sess
      ? await (async () => {
          const clock = CLOCK ? { T: playtimeAt(wall), kw: calib.req.weights(), turnTicks: (TURN_S * 1000) / 200, jitter: 5, eps: 0.1 } : undefined;
          const r = sess.setRoot(simple, valid, { history: state.previousBoards.slice(), opponentPassed: oppPassed, objective, clock, ...(CHEAT_JOINT ? { cheat: { fns: noPairs ? null : [cheatAvailIn(ROUND_TRIP_MS + budgetFor(ourTurns), 0.003)], cheats } } : CHEAT_HYBRID ? { cheat: { fns: pairsNow ? [() => true] : null, cheats } } : {}) });
          if (!r) return null;
          const budget = budgetFor(ourTurns);
          const target = WORK_RATE ? Math.round(WORK_RATE * budget) : sessRate ? Math.round(sessRate * budget) : Infinity;
          const work0 = sess.rootWork;
          sStats[r.reused ? "reused" : "fresh"]++;
          sStats.rootVisits += r.visits;
          sStats.rootWork = (sStats.rootWork ?? 0) + r.work;
          // The early stop counts WORK (model calls), not visits: see golib iterate.
          const its = WORK_RATE
            ? await sess.search({ maxms: 1e9, untilWork: r.reused && SESSION !== "deep" ? target : work0 + target, untilVisits: sess.rootVisits + 50 * target + 100 })
            : await sess.search({ maxms: budget * CPU_SCALE, untilWork: r.reused && SESSION !== "deep" ? target : Infinity });
          if (WORK_RATE) sessRate = WORK_RATE;
          else if (!r.reused) sessRate = sessRate ? 0.8 * sessRate + 0.2 * (sess.rootWork / budget) : sess.rootWork / budget;
          else if (its <= 1) sStats.early++;
          let b = sess.best();
          const wr = b?.[0]?.top?.[0]?.[4];
          if (typeof wr === "number") {
            if (v0 === null) v0 = wr;
            minWr = Math.min(minWr, wr);
          }
          if (ADAPTIVE && b && b.length && typeof wr === "number" && wr < ADAPTIVE.thr) {
            if (ADAPTIVE_STEPS) {
              // PROGRESSIVE: one budget at a time while the chosen line still
              // wins under thr, up to mult budgets in all.
              let w2 = wr;
              for (let k = 1; k < ADAPTIVE.mult && b && b.length && w2 < ADAPTIVE.thr; k++) {
                await moreSearch(budget);
                b = sess.best();
                w2 = b?.[0]?.top?.[0]?.[4] ?? 1;
              }
            } else {
              await moreSearch((ADAPTIVE.mult - 1) * budget);
              b = sess.best();
            }
            adaptiveMoves++;
          }
          // --extend FROM:TO:GAP:MULT  TARGETED DEPTH: on our turns FROM..TO
          // (0-based), when the two most-visited candidates' win rates are
          // within GAP, search on for (MULT-1) budgets (the fragile early
          // middlegame where the harness losses were decided).
          if (EXTEND && ourTurns >= EXTEND.from && ourTurns <= EXTEND.to && b && b.length) {
            const t = b[0].top ?? [];
            if (t.length > 1 && Math.abs(t[0][4] - t[1][4]) < EXTEND.gap) {
              await moreSearch((EXTEND.mult - 1) * budget);
              b = sess.best();
              extendMoves++;
            }
          }
          solveWork = sess.rootWork - work0;
          return b;
        })()
      : MODEL
      ? await golib.chooseMoveModel(simple, valid, N, komi, budgetFor(ourTurns), { ...opts, history: state.previousBoards.slice() }, MODEL)
      : LOCAL
      ? golib.chooseMove(simple, valid, N, komi, 20, 8)
      : golib.chooseMoveUCT(simple, valid, N, komi, budgetFor(ourTurns), opts);
    modelCalls += ranked?.[0]?.modelCalls ?? 0;
    ourMs += WORK_RATE && solveWork !== null ? solveWork / WORK_RATE : (performance.now() - t0) / CPU_SCALE;
    if (NNEV) {
      const d = NNEV.busyMs - nnBusy0;
      if (!NN_FREE) ourMs += d;
      nnMs += d;
    }
    iters += ranked?.[0]?.iters ?? 0;
    return ranked;
  };
  while (state.passCount < 2 && guard++ < N * N * 4) {
    phase = (phase + turnLiveS * RATE) % 1;
    turnLiveS = (budgetFor(ourTurns) + 550) / 1000;
    // PRE-SENT (--presend): the ponder already answered this exact position
    // (board + pass state) and the move is legal: played with no request.
    let pre = null;
    if (PRESEND && sess && answers.length) {
      const key = g.simpleBoardFromBoard(state.board).join("");
      const a = answers.find((e) => e.b === key && e.pc === (oppPassed ? 1 : 0));
      if (a && (a.pass || validGrid(state, N)[a.x]?.[a.y])) pre = a;
    }
    answers = [];
    // --book: an opening-book position (golib.bookMove) is played like a
    // pre-sent answer — go-solver publishes the book's answers for the AI's
    // sampled replies with the ponder's — or, on our first move (nothing
    // pondered yet), answered at once by the request (a round trip).
    // (Ahead of the ponder's own answer, as go-solver publishes it first.)
    let bookHit = false;
    seedJit = 0.5 + Math.random() * 6;
    seedSkew = 0;
    oracleHit = false;
    // --oracle-book [NOISE]: the pass-forcing book's candidates for this
    // position (golib.oracleCandidates), best first; the first whose expected
    // AI reply is the one this game's clock predicts (the seed at a pre-sent
    // play) is played like a book move. NOISE: the share of such plays whose
    // real seed lag is a tick off the prediction (live calibration misses).
    if (ORACLE && BOOK && sess && MODEL) {
      const board = g.simpleBoardFromBoard(state.board);
      // --oracle-full: never where the opening book holds the position (the
      // book's deep, all-replies search outranks a one-clock plan there).
      const cands = ORACLE_FULL && !ORACLE_OVERRIDE && !oppPassed && golib.bookMove(BOOK, board) ? [] : golib.oracleCandidates(BOOK, board, { passed: oppPassed });
      const vg = cands.length ? validGrid(state, N) : null;
      for (const c of cands) {
        if (!vg[c.x]?.[c.y]) continue;
        // A cheat step (a second stone): only with --cheat, only where this
        // game's roll is inside the window for the cheats so far — certain
        // success, as go-cheat.js plays it — and never after the AI's pass.
        if (c.second) {
          if (!CHEAT || CHEAT === "blind" || oppPassed || cheats >= CHEAT_MAX) continue;
          // Both points legal on the board before either stone (playTwoMoves).
          if (!vg[c.second.x]?.[c.second.y] || (c.second.x === c.x && c.second.y === c.y)) continue;
          if (golib.cheatRoll(playtimeAt(wall + ROUND_TRIP_MS)) > pCheat(cheats)) continue;
        }
        // THE GUARD (--oracle-guard V:D): a candidate the pondered tree has
        // searched (>= V visits) and found winning in D (share of lines) less
        // than its best stone is not played — the line is a plan against ONE
        // predicted reply sequence; the tree prices the AI's other replies.
        if (ORACLE_GUARD) {
          const st = sess.childStats(c.x, c.y, board, oppPassed, ORACLE_GUARD.v);
          if (st && st.visits >= ORACLE_GUARD.v && st.bestWins !== null && st.wins < st.bestWins - ORACLE_GUARD.w) { oracleGuarded++; continue; }
        }
        let after = golib.applyMove(board, c.x, c.y);
        if (after && c.second) after = after[c.second.x][c.second.y] === "." ? golib.applyMove(after, c.second.x, c.second.y) : null;
        if (!after) continue;
        // A cheat's reply comes after go-cheat.js's exec and a second round trip.
        const lagMs = ROUND_TRIP_MS + (c.second ? ROUND_TRIP_MS + CHEAT_EXEC_MS : 0);
        if (ORACLE_FULL) {
          // THE FULL-LINE CHECK (golib.oracleLineHolds): the whole line must be
          // this game's, from the exact seed of this reply onward.
          const T1 = playtimeAt(wall + lagMs + 200 + seedJit);
          const cheatOk = (j, k) => !!CHEAT && CHEAT !== "blind" && k < CHEAT_MAX && golib.cheatRoll(T1 - 200 + 200 * Math.round(j * 5)) <= pCheat(k) - 0.01;
          // Lags spread over 3 ticks around the exact seed, as live's calibrated
          // weights spread (go-solver: the pre-path lags at k and k + 1).
          const hold = await golib.oracleLineHolds(c, board, state.previousBoards.slice(), T1, [[-1, 0.2], [0, 0.6], [1, 0.2]], (b, o) => MODEL.reply(b, o), { tt: 5, cheat: cheatOk, cheats0: cheats });
          if (!hold.ok || hold.mass < 0.6) { if (hold.mass >= 0.6) oracleLineFail++; continue; }
        } else {
          const r = await MODEL.reply(after, { history: [board.join(""), ...state.previousBoards], passCount: 0, rng: playtimeAt(wall + lagMs + 200 + seedJit) });
          const want = c.reply ? `${c.reply.x},${c.reply.y}` : "P";
          if ((r ? `${r.x},${r.y}` : "P") !== want) continue;
        }
        pre = { x: c.x, y: c.y, book: true, ...(c.second ? { second: c.second } : {}) };
        bookHit = oracleHit = true;
        if (c.second) oracleCheats++;
        oracleMoves++;
        if (Math.random() < ORACLE.noise) seedSkew = Math.random() < 0.5 ? -200 : 200;
        break;
      }
      // Live, a position with candidates is never pre-sent (the check needs the
      // request's T), so a miss is a request too: searched, round trip charged.
      if (cands.length && !oracleHit) { oracleMiss++; pre = null; }
      // --oracle-misses FILE: the first position of a game that has LEFT the
      // book's lines (an oracle move was played, none fits here), with its
      // clock — go-oracle.mjs --roots plans from it (the book grows where
      // games actually go).
      if (ORACLE_MISSES && !oracleHit && oracleMoves > 0 && !oracleLeft) {
        oracleLeft = true;
        const rec = { kind: "orcmiss", board: board.join(""), history: state.previousBoards.slice(), passed: oppPassed, T: playtimeAt(wall + ROUND_TRIP_MS + 200 + seedJit) - 200, ourTurns };
        fs.appendFileSync(ORACLE_MISSES, JSON.stringify(rec) + "\n");
      }
    }
    if (!oracleHit && BOOK && sess && (!oppPassed || BOOK_PASS)) {
      const bm = golib.bookMove(BOOK, g.simpleBoardFromBoard(state.board), { passed: oppPassed });
      if (bm && validGrid(state, N)[bm.x]?.[bm.y]) {
        pre = { x: bm.x, y: bm.y, book: true };
        if (bm.reply !== undefined) steerTarget = bm.reply;
        bookHit = true;
        bookMoves++;
      }
    }
    const tReq = wall;
    let ranked;
    if (!bookHit) steerTarget = undefined;
    if (pre) {
      // go.js plays at once and NOTIFIES the solver, which re-roots (a reuse)
      // at the move's playtime and commits.
      // An oracle move goes through a request (go-solver checks its expected reply
      // against the clock at the request's T), never a pre-sent answer.
      const lag = bookHit && (ourTurns === 0 || oracleHit) ? ROUND_TRIP_MS : PRESEND_MS;
      wall += lag;
      rtTotal += lag;
      if (!bookHit) preMoves++;
      const clock = CLOCK ? { T: playtimeAt(wall), kw: calib.pre.weights(), turnTicks: (TURN_S * 1000) / 200, jitter: 5, eps: 0.1 } : undefined;
      const rr = sess.setRoot(g.simpleBoardFromBoard(state.board), validGrid(state, N), { history: state.previousBoards.slice(), opponentPassed: oppPassed, objective, clock, ...(CHEAT_JOINT ? { cheat: { fns: [cheatAvailIn(0, 0.003)], cheats } } : {}) });
      sStats[rr?.reused ? "reused" : "fresh"]++;
      ranked = pre.pass ? [] : [{ x: pre.x, y: pre.y, ...(pre.second && !pre.book ? { second: pre.second } : {}) }];
    } else {
      const ms0 = ourMs;
      ranked = await solve();
      // go-solver's PASS GUARD: a pass chosen among pairs is checked against
      // the single search (same request, searched again without pairs).
      if (CHEAT_JOINT && sess && !oppPassed && !(ranked && ranked.length)) {
        noPairs = true;
        const single = await solve();
        noPairs = false;
        if (single && single.length) {
          ranked = single;
          jointStats.passGuard = (jointStats.passGuard ?? 0) + 1;
        }
      }
      wall += ourMs - ms0 + ROUND_TRIP_MS;
      rtTotal += ROUND_TRIP_MS;
    }
    // --retime: a requested move is re-anchored at its play (the pre path's calibrator).
    const retime = RETIME && !pre && !!sess;
    const seedPath = pre || retime ? "pre" : "req";
    let seedRef = playtimeAt(pre || retime ? wall : tReq);
    ourTurns++;
    if (SCAN) return { scan: true, v0, start: g.simpleBoardFromBoard(state.board).join("") };
    let hasMove = ranked && ranked.length;
    let cheatNow = false;
    let cheatSucceeds = false;
    // --cheat-joint: the search chose a pair; played as a cheat only if the
    // roll at the actual play allows it (else its first stone alone).
    let jointSecond = null;
    if (CHEAT_JOINT && hasMove && ranked[0].second) {
      // THE GAME'S PAIR RULE (Go.ts playTwoMoves -> validateMove x2): both
      // points legal on the board BEFORE either stone; go.js drops any other.
      const vg = validGrid(state, N);
      const legal = !!vg[ranked[0].x]?.[ranked[0].y] && !!vg[ranked[0].second.x]?.[ranked[0].second.y];
      if (!legal) jointStats.illegal = (jointStats.illegal ?? 0) + 1;
      else if (!oppPassed && cheats < CHEAT_MAX && golib.cheatRoll(playtimeAt(wall)) <= pCheat(cheats)) jointSecond = ranked[0].second;
      else jointStats.rollMiss++;
      // A declined pair's first stone is never played alone (go.js): a
      // request for a single, searched and round trip charged.
      if (!jointSecond) {
        noPairs = true;
        const ms0 = ourMs;
        ranked = await solve();
        noPairs = false;
        hasMove = ranked && ranked.length;
        wall += ourMs - ms0 + ROUND_TRIP_MS;
        rtTotal += ROUND_TRIP_MS;
        turnLiveS += (ourMs - ms0 + ROUND_TRIP_MS) / 1000;
        jointStats.reasked = (jointStats.reasked ?? 0) + 1;
        // go.js retimes a requested move at its play.
        seedRef = playtimeAt(wall);
      }
    }
    // --cheat-hybrid: a hard move with the window open -> the joint pair.
    if (CHEAT_HYBRID && sess && hasMove && !oppPassed && cheats < CHEAT_MAX && ourTurns >= CHEAT_FROM && !(oracleHit && CHEAT_KEEP_LINES) && pCheat(cheats) >= MIN_P) {
      const wr = pre ? pre.wr : ranked[0].top?.[0]?.[4];
      if (typeof wr === "number" && wr < CHEAT_HYBRID) {
        const ms0 = ourMs;
        pairsNow = true;
        const pr = await solve();
        pairsNow = false;
        wall += ourMs - ms0 + ROUND_TRIP_MS;
        rtTotal += ROUND_TRIP_MS;
        turnLiveS += (ourMs - ms0 + ROUND_TRIP_MS) / 1000;
        jointStats.hard = (jointStats.hard ?? 0) + 1;
        const vg = validGrid(state, N);
        if (pr?.[0]?.second && vg[pr[0].x]?.[pr[0].y] && vg[pr[0].second.x]?.[pr[0].second.y] && golib.cheatRoll(playtimeAt(wall)) <= pCheat(cheats)) {
          ranked = pr;
          jointSecond = pr[0].second;
          jointStats.pairs++;
        }
        // else: the greedy cheat below, on the original single
      }
    }
    if (CHEAT_JOINT && hasMove) jointStats[jointSecond ? "pairs" : "singles"]++;
    // Not after the AI's pass (go.js: play-on decides a single stone there).
    if (jointSecond) {
      cheatNow = cheatSucceeds = true;
    } else if (CHEAT_JOINT) {
      // no greedy cheat
    } else if (pre?.second) {
      // The oracle's cheat step: its roll was checked above (certain success).
      cheatNow = cheatSucceeds = true;
    } else if (CHEAT && hasMove && !oppPassed && cheats < CHEAT_MAX && ourTurns >= CHEAT_FROM && !(oracleHit && CHEAT_KEEP_LINES) && !(CHEAT_SKIP && (pre ? pre.wr : ranked[0].top?.[0]?.[4]) < CHEAT_SKIP)) {
      const p = pCheat(cheats);
      // --seeded: the roll IS the clock (golib.cheatRoll of the playtime), not
      // an independent phase — the AI's seed and the cheat roll share it.
      if (SEEDED) phase = golib.cheatRoll(playtimeAt(wall));
      if (CHEAT === "blind") {
        cheatNow = true;
        cheatSucceeds = Math.random() <= p;
      } else if (p >= MIN_P) {
        const wait = phase <= p ? 0 : (1 - phase) / RATE;
        if (wait <= CHEAT_WAIT) {
          cheatNow = cheatSucceeds = true;
          cheatWaitS += wait;
          turnLiveS += wait;
          if (SEEDED) wall += wait * 1000;
          if (wait > 0) phase = 0; // waited to the window's start
        }
      }
    }
    if (cheatNow) {
      cheats++;
      if (cheatSucceeds) {
        cheatOk++;
        g.makeMove(state, ranked[0].x, ranked[0].y, GoColor.black);
        // The second stone, chosen on the board after the first. The game
        // validates both against the board BEFORE either (Go.ts cheat
        // playTwoMoves -> validateMove x2); the difference is a capture by the
        // first stone freeing the second point, which this ignores.
        state.previousPlayer = GoColor.white;
        const ms0 = ourMs;
        secondStone = true;
        const second = jointSecond ? [jointSecond] : pre?.second ? [pre.second] : await solve();
        secondStone = false;
        // The second stone's request (its search is in ourMs) and the
        // go-cheat.js exec + result read (CHEAT_EXEC_MS), on the live clock.
        wall += ourMs - ms0 + ROUND_TRIP_MS + CHEAT_EXEC_MS;
        turnLiveS += (ourMs - ms0 + ROUND_TRIP_MS + CHEAT_EXEC_MS) / 1000;
        if (second && second.length) {
          g.makeMove(state, second[0].x, second[0].y, GoColor.black);
          note("B", [second[0].x, second[0].y]);
          // Live, the solver commits its answer to the second-stone request
          // and ponders under it — the actual post-cheat position.
          if (sess) {
            if (jointSecond) sess.commit(ranked[0].x, ranked[0].y, jointSecond);
            else sess.commit(second[0].x, second[0].y);
          }
        }
        state.previousPlayer = GoColor.black;
      } else if (cheats > 1 && Math.random() < 0.1) {
        ejected = true;
        break;
      } else {
        g.passTurn(state, GoColor.black, false);
      }
    } else if (!(hasMove && g.makeMove(state, ranked[0].x, ranked[0].y, GoColor.black))) {
      g.passTurn(state, GoColor.black, false);
      ourPasses++;
      note("B", "pass", SEEDED ? { T: playtimeAt(wall) } : undefined);
      if (sess) sess.commit(null);
    } else {
      note("B", [ranked[0].x, ranked[0].y], SEEDED ? { T: playtimeAt(wall) } : undefined);
      if (sess) sess.commit(ranked[0].x, ranked[0].y);
    }
    // --cheat-joint: where a cheat will be available on our next play (the AI's
    // reply ~1.1s away), the ponder searches pairs there too.
    if (CHEAT_JOINT && sess) sess.setCheat({ fns: [null, cheatAvailIn(1100, 0.02)], cheats });
    else if (CHEAT_HYBRID && sess) sess.setCheat({ fns: null, cheats });
    // --steer K[:MS] (with --seeded and a session; EXPERIMENTAL, the oracle
    // form): SEED STEERING. The AI's seed is the playtime one waitCycle after
    // our play, so delaying the play by k engine ticks (200ms each) chooses
    // among the replies seeds T+200k give. Each distinct reply over k = 0..K
    // is searched MS ms from its own node (golib session.steer); the delay
    // whose reply is worth most net of its 0.2k s (at the rate) is waited.
    // The seeds are EXACT here (live predicts them ~99% after the retime).
    // MEASURED WORSE 2026-10-06 (Tetrads 5x5, 31 paired, live config): K=4
    // -6.0% [-11.1, -0.4] power/h, K=8 -5.8%: the reply changes only every
    // ~10-20 ticks (go-seedseq.mjs), so a short wait rarely offers another
    // reply and the evaluations cost more than they find.
    if (!oracleHit) seedSkew = 0;
    // --steer-book K[:NOISE]: the pass-forcing book names the AI reply its line
    // expects; wait the fewest ticks k <= K whose seed gives it (none: play at
    // once and leave the line). NOISE: the share of plays whose real seed lag
    // is a tick off the predicted one (live: the clock calibration's miss).
    if (STEER_BOOK && steerTarget !== undefined && hasMove && state.passCount < 2) {
      const after = g.simpleBoardFromBoard(state.board);
      const hist = state.previousBoards.slice();
      const want = steerTarget ? `${steerTarget.x},${steerTarget.y}` : "P";
      let pick = -1;
      for (let k = 0; k <= STEER_BOOK.k && pick < 0; k++) {
        const r = await MODEL.reply(after, { history: hist, passCount: state.passCount, rng: playtimeAt(wall + 200 * k + 200 + seedJit) });
        if ((r ? `${r.x},${r.y}` : "P") === want) pick = k;
      }
      steerStats.book++;
      if (pick < 0) steerStats.miss++;
      else if (pick > 0) {
        wall += 200 * pick;
        turnLiveS += 0.2 * pick;
        rtTotal += 200 * pick;
        seedRef += 200 * pick;
        steerStats.delayTicks += pick;
        steerStats.steered++;
      }
      if (Math.random() < STEER_BOOK.noise) seedSkew = Math.random() < 0.5 ? -200 : 200;
    }
    if (STEER && sess && SEEDED && hasMove && state.passCount < 2) {
      const after = g.simpleBoardFromBoard(state.board);
      const hist = state.previousBoards.slice();
      const reps = [];
      for (let k = 0; k <= STEER.k; k++) reps.push(await MODEL.reply(after, { history: hist, passCount: state.passCount, rng: playtimeAt(wall + 200 * k + 200 + seedJit) }));
      const keyOf = (r) => (r ? `${r.x},${r.y}` : "P");
      const distinct = [...new Map(reps.map((r) => [keyOf(r), r])).values()];
      let best = 0;
      if (distinct.length > 1) {
        const t0 = performance.now();
        const vals = await sess.steer(distinct, STEER.ms * CPU_SCALE);
        const evalMs = (performance.now() - t0) / CPU_SCALE;
        ourMs += evalMs;
        wall += evalMs;
        const vOf = new Map(distinct.map((r, i) => [keyOf(r), vals?.[i]?.mean]));
        const tick = sess.scale > 0 ? ((rateFor(OPP) / 3600) * 0.2) / sess.scale : 0;
        let bs = -Infinity;
        for (let k = 0; k <= STEER.k; k++) {
          const v = vOf.get(keyOf(reps[k]));
          if (typeof v !== "number") continue;
          const sc = v - k * tick;
          if (sc > bs + 1e-9) { bs = sc; best = k; }
        }
        steerStats.evals++;
      }
      if (best > 0) {
        wall += 200 * best;
        turnLiveS += 0.2 * best;
        steerStats.delayTicks += best;
        steerStats.steered++;
        seedRef += 200 * best;
        rtTotal += 200 * best; // charged on the live clock with the round trips
      }
    }
    if (retime) sess.setClock({ T: seedRef, kw: calib.pre.weights(), turnTicks: (TURN_S * 1000) / 200, jitter: 5, eps: 0.1 });
    if (state.passCount >= 2) break;
    // What the AI's reply will be computed from, for the seed calibration.
    const seedCtx = SEEDED && MODEL ? { board: g.simpleBoardFromBoard(state.board), history: state.previousBoards.slice(), passCount: state.passCount } : null;

    // PONDER while the AI "thinks" (see --ponder above).
    let ponderT0 = null;
    if (PONDER && MODEL) {
      ponderT0 = performance.now();
      const after = g.simpleBoardFromBoard(state.board);
      const [pos] = await ponderPositions({ model: MODELRAW, board: after, history: state.previousBoards.slice(), opponent: OPP, komi, visits: 0, size: N, maxPositions: 1, samples: 8 });
      if (pos && pos.reply !== "pass") {
        const grid = Array.from({ length: N }, () => new Array(N).fill(false));
        for (const [x, y] of pos.valid) grid[x][y] = true;
        const ranked2 = await golib.chooseMoveModel(pos.board, grid, N, komi, budgetFor(ourTurns), { ...OPTS, opponentPassed: false, history: pos.history }, MODEL);
        mPonder = { key: pos.board.join("/"), ranked: ranked2 };
      }
    }
    if (PONDER && KATAGO) {
      const after = g.simpleBoardFromBoard(state.board);
      // --seeded: the AI's seed is the playtime one engine tick after our play
      // (aiSeed below: wall + 200 + a 0.5-6.5ms jitter) — the two ticks it can
      // land on, weighted by the jitter's chance of crossing the boundary.
      // --ponder-spread: as go-solver live — the seeds spread over the ticks
      // service.ponderSeeds names, and the AI's real seed drawn from that same
      // spread (the live lag is known only to a tick or two).
      const rngs = SEEDED ? (PONDER_SPREAD ? ponderSeeds(playtimeAt(wall), 200) : (() => {
        const a = playtimeAt(wall + 200.5), b = playtimeAt(wall + 206.5);
        return a === b ? [[a, 1]] : [[a, 0.5], [b, 0.5]];
      })()) : null;
      if (PONDER_SPREAD) {
        let u = Math.random();
        spreadTicks = SEED_OFFSETS.find(([, w]) => (u -= w) < 0)?.[0] ?? 0;
      }
      const positions = await ponderPositions({ model: KMODEL, board: after, history: state.previousBoards.slice(), opponent: OPP, komi, visits: KVISITS, size: N, samples: N >= 13 ? 4 : 8, rngs, maxPositions: N >= 13 ? 2 : 3 }); // as go-solver.mjs
      ponderT0 = performance.now();
      await KATAGO.ponder(positions);
    }
    cycles = 0;
    rows = 0;
    const t1 = performance.now();
    // THE SEED (--seeded): the playtime one waitCycle (200ms + timer slop)
    // after our move, in whole engine cycles.
    const aiSeed = SEEDED ? playtimeAt(wall + 200 + seedJit) + seedSkew + 200 * spreadTicks : rngSeed();
    spreadTicks = 0;
    const reply = await g.getMove(state, GoColor.white, OPP, true, aiSeed);
    oppMs += performance.now() - t1;
    if (sess && (SESSION === "ponder" || SESSION === "deep") && sess.pondering) {
      const liveMs = (cycles + (reply.type === "move" ? 1 : 0)) * 200 + rows * 10;
      if (NNEV) {
        // The net's time counts against the AI's reply too (see --nn).
        const b0 = NNEV.busyMs;
        sStats.ponderIters += await sess.ponder(0, { work: Math.round(WORK_RATE * liveMs), until: (wd) => wd / WORK_RATE + (NN_FREE ? 0 : NNEV.busyMs - b0) >= liveMs });
      } else sStats.ponderIters += WORK_RATE ? await sess.ponder(0, { work: Math.round(WORK_RATE * liveMs) }) : await sess.ponder(liveMs * CPU_SCALE);
      if (PRESEND) answers = sess.ponderAnswers({ minWork: sessRate ? Math.round(sessRate * budgetFor(ourTurns)) : Infinity, max: 4 });
      // ADAPTIVE: a position the search thinks is going badly is never
      // pre-sent — it goes through a request, where the budget is extended.
      if (ADAPTIVE) answers = answers.filter((a) => !(typeof a.wr === "number" && a.wr < ADAPTIVE.thr));
      // EXTEND: a close call in the targeted turns goes through a request (where it is extended).
      if (EXTEND && ourTurns >= EXTEND.from && ourTurns <= EXTEND.to) answers = answers.filter((a) => !(typeof a.gap === "number" && Math.abs(a.gap) < EXTEND.gap));
    }
    wall += (cycles + (reply.type === "move" ? 1 : 0)) * 200 + rows * 10;
    // THE SEED LAG, calibrated online from the reply just seen: which k make
    // the model (the AI's own code) give exactly this reply from T + 200k.
    if (seedCtx) {
      const c = calib[seedPath];
      const want = reply.type === "move" ? `${reply.x},${reply.y}` : "pass";
      const matches = [];
      for (let k = c.range[0]; k <= c.range[1]; k++) {
        const m = await MODEL.reply(seedCtx.board, { history: seedCtx.history, passCount: seedCtx.passCount, rng: seedRef + 200 * k });
        if ((m ? `${m.x},${m.y}` : "pass") === want) matches.push(k);
      }
      const top = c.weights()[0]?.[0] ?? null;
      seedG.observed++;
      if (c.observe(matches, top)) {
        seedG.informative++;
        if (matches.includes(top)) seedG.predicted++;
      }
    }
    if (ponderT0 !== null) {
      const liveMs = (cycles + (reply.type === "move" ? 1 : 0)) * 200 + rows * 10;
      if (KATAGO) {
        const left = liveMs - (performance.now() - ponderT0);
        if (left > 0) await Promise.race([new Promise((r) => realSetTimeout(r, left)), KATAGO.pondersSettled()]);
      } else {
        // The model ponder ran synchronously before the reply: charge what
        // the AI's live reply time did not cover (the solver is busy until
        // the ponder ends, hit or miss).
        ponderCarry = Math.max(0, t1 - ponderT0 - liveMs);
      }
    }
    oppCycles += cycles + (reply.type === "move" ? 1 : 0);
    oppRows += rows;
    turnLiveS += ((cycles + (reply.type === "move" ? 1 : 0)) * 200 + rows * 10) / 1000;
    oppTurns++;
    oppPassed = reply.type !== "move";
    if (reply.type === "move") {
      g.makeMove(state, reply.x, reply.y, GoColor.white);
      note("W", [reply.x, reply.y], { seed: aiSeed });
    } else {
      note("W", "pass", { seed: aiSeed });
      g.passTurn(state, GoColor.white, false);
      const s = g.getScore(state);
      // --mirror search: the search decides (PASS ends the game; a stone
      // plays on for more area); else pass at once, as go.js does.
      if (MIRROR !== "search" && s[GoColor.black].sum > s[GoColor.white].sum) {
        mirror++;
        g.passTurn(state, GoColor.black, false);
        break;
      }
    }
    if (VERBOSE && ourTurns % 20 === 0) {
      const s = g.getScore(state);
      process.stderr.write(`turn ${ourTurns}: B ${s[GoColor.black].sum} W ${s[GoColor.white].sum} us ${(ourMs / ourTurns).toFixed(0)}ms/mv ${Math.round(iters / ourTurns)} it/mv\n`);
    }
  }
  const s = g.getScore(state);
  return {
    black: s[GoColor.black].sum,
    white: s[GoColor.white].sum,
    komi,
    ourTurns,
    ourPasses,
    ourMsPerMove: +(ourMs / ourTurns).toFixed(1),
    ourMsTotal: Math.round(ourMs),
    itersPerMove: Math.round(iters / ourTurns),
    ...(MODEL ? { modelCallsPerMove: Math.round(modelCalls / ourTurns) } : {}),
    ...(KATAGO ? { kWhere, ...(PONDER ? { kPonder } : {}) } : {}),
    ...(NNEV ? { nnMs: Math.round(nnMs), nnQueries: NNEV.stats.queries, nnHits: NNEV.stats.cacheHits } : {}),
    ...(sess ? { session: sStats } : {}),
    ...(MODEL && PONDER ? { mPonder: { ...mStats, carryMs: Math.round(mStats.carryMs) } } : {}),
    oppTurns,
    preMoves,
    v0,
    minWr: +minWr.toFixed(3),
    adaptiveMoves,
    extendMoves,
    bookMoves,
    ...(STEER || STEER_BOOK ? { steer: steerStats } : {}),
    ...(CHEAT_JOINT || CHEAT_HYBRID ? { joint: jointStats } : {}),
    ...(ORACLE ? { oracle: { moves: oracleMoves, miss: oracleMiss, guarded: oracleGuarded, cheats: oracleCheats, lineFail: oracleLineFail } } : {}),
    rtTotalMs: rtTotal,
    ...(SEEDED ? { seed: seedG } : {}),
    oppMs: Math.round(oppMs),
    oppCycles,
    oppRows,
    mirror,
    size: N,
    ...(CHEAT ? { cheats, cheatOk, cheatWaitS: Math.round(cheatWaitS), ejected } : {}),
    ...(trace ? { trace } : {}),
  };
}

let stats = { wins: 0, losses: 0, winStreak: 0, oldWinStreak: 0, nodePower: 0 };
// The two arms' state (--book-b): swapped in around each game.
const arms = BOOK_B === undefined ? null : [
  { book: BOOK, calib, sessRate: null, stats, out: OUT },
  { book: BOOK_B, calib: { req: golib.seedCalib(), pre: golib.seedCalib() }, sessRate: null, stats: { wins: 0, losses: 0, winStreak: 0, oldWinStreak: 0, nodePower: 0 }, out: OUT_B },
];
if (arms && !OUT_B) throw new Error("--book-b needs --out-b");
const useArm = (k) => {
  if (!arms) return;
  const cur = arms[k];
  BOOK = cur.book;
  calib = cur.calib;
  sessRate = cur.sessRate;
  stats = cur.stats;
  emitTo = k === 1 ? cur.out : null;
};
const saveArm = (k) => {
  if (arms) arms[k].sessRate = sessRate;
};
if (arms) {
  useArm(1);
  emit({ kind: "start", arm: "b", book: BOOK ? Object.keys(BOOK.entries).length : 0, opponent: OPP, size: SIZE, maxms: MAXMS, pid: process.pid });
  useArm(0);
}
emit({ kind: "start", cpuScale: CPU_SCALE, workRate: WORK_RATE, adaptiveSteps: ADAPTIVE_STEPS, extend: EXTEND, book: BOOK ? { file: str("book", null), positions: Object.keys(BOOK.entries).length } : null, games: GAMES, adaptive: ADAPTIVE, layouts: LAYOUTS, local: LOCAL, objective: OBJECTIVE, turnS: OBJECTIVE ? TURN_S : undefined, lossScale: OBJECTIVE ? LOSS_SCALE : undefined, leafK: OBJECTIVE ? LEAF_K : undefined, mirrorMode: MIRROR, presend: PRESEND, seeded: SEEDED, clock: CLOCK, retime: RETIME, steer: STEER, steerBook: STEER_BOOK, bookPass: BOOK_PASS, oracleBook: ORACLE, oracleGuard: ORACLE_GUARD, oracleFull: ORACLE_FULL, katago: KATAGO ? `${KVISITS}${str("katago-remote", null) ? "gpu" : ""}${PONDER ? "p" : ""}` : null, ponder: PONDER, session: SESSION, rtMs: ROUND_TRIP_MS, katagoOverride: str("katago-override", null), katagoSettings: JSON.parse(str("katago-settings", "null")), katagoOldPass: argv.includes("--katago-old-pass"), katagoRemoteNet: str("katago-remote-net", null), katagoHoles: str("katago-holes", null), katagoWalls: !argv.includes("--katago-stock"), maxms: MAXMS, opening: OPENING, opts: OPTS, model: !!MODEL, opponent: OPP, size: SIZE, cheat: CHEAT, cheatMax: CHEAT_MAX, crime: CRIME, nn: NN_OPTS ? { free: NN_FREE, mix: NN_OPTS.mix, cpuct: NN_OPTS.cpuct, parallel: NN_OPTS.parallel, fpu: NN_OPTS.fpu } : null, pid: process.pid });
// --start K: begin at game K (with --layoutseed, replays a given deal).
const START = num("start", 0);
for (let i = START; i < GAMES; i++) for (let arm = 0; arm < (arms ? 2 : 1); arm++) {
  if (LAYOUTS && !LAYOUTS.includes(i)) continue;
  useArm(arm);
  const w0 = Date.now();
  const r = await playGame(stats, i);
  saveArm(arm);
  if (r.scan) {
    emit({ kind: "scan", i, v0: r.v0, start: r.start });
    continue;
  }
  const won = !r.ejected && r.black >= r.white;
  stats.oldWinStreak = stats.winStreak;
  if (r.ejected) {
    // resetWinstreak(ai, false) (scoring.ts:113-122): no dry-streak step.
    stats.losses++;
    if (stats.winStreak >= 0) stats.winStreak = -1;
  } else if (!won) {
    stats.losses++;
    stats.winStreak = stats.winStreak >= 0 ? -1 : stats.winStreak - 1;
  } else {
    stats.wins++;
    stats.winStreak = stats.oldWinStreak < 0 ? 1 : stats.winStreak + 1;
  }
  const difficulty = g.getDifficultyMultiplier(r.komi, r.size);
  const streak = g.getWinstreakMultiplier(stats.winStreak, stats.oldWinStreak);
  // forceEndGoGame never runs the nodePower accrual (scoring.ts:101-108).
  const power = r.ejected ? 0 : r.black * difficulty * streak;
  stats.nodePower += power;
  stats.meanBlack = stats.meanBlack ? 0.9 * stats.meanBlack + 0.1 * r.black : r.black;
  // Live wall clock: our think + the solver round trip (go.js polls every
  // 250ms, the solver every 150ms: ~0.45s) per move, 200ms per AI waitCycle,
  // 10ms per pattern row, plus go.js's own idle (100ms) per move.
  // Our think time as MEASURED (ourMsTotal: budgets vary with --opening, and a
  // search returns early when only a pass is legal), plus the round trip.
  // ROUND_TRIP_MS: go.js writes the request, the solver (polling 150ms) reads
  // it, go.js (polling 250ms) reads the answer and plays, plus go.js's idle.
  // Was 450 + 100 = 550ms; CALIBRATED 2026-10-04 against 53 live Tetrads 5x5
  // games (go.txt: 16.4 s/game, harness 19.4 at 550ms, 11.0 turns a game ->
  // 275ms). Then the fast pipeline (release 2: go.js reads every 25ms, idle
  // 10ms; go-solver polls every 25ms in a game). Observed live over the RFA
  // bridge before it (40 turns): request -> answer 196ms (pickup ~76 + search),
  // read at go.js's 250ms poll (+54), idle 100. The cut saves ~190ms a turn
  // -> 85ms. NOT YET CHECKED LIVE: go.js now publishes turnTiming, and the
  // report's s/game CHECK re-tests this on every run.
  // go-study-report re-times older records to this constant.
  // A cheat's second search is already in ourMsTotal; add its round trip and exec.
  const liveS = ((r.ourMsTotal ?? r.ourTurns * MAXMS) + (r.rtTotalMs ?? r.ourTurns * ROUND_TRIP_MS) + (r.cheatOk ?? 0) * (ROUND_TRIP_MS + CHEAT_EXEC_MS) + r.oppCycles * 200 + r.oppRows * 10) / 1000 + (r.cheatWaitS ?? 0);
  if (TRACE_LOSSES && won) delete r.trace;
  emit({ kind: "game", i, ...r, won, streak, power: +power.toFixed(1), liveS: Math.round(liveS), simS: Math.round((Date.now() - w0) / 1000) });
}
if (arms) {
  useArm(1);
  emit({ kind: "end", ...stats });
  useArm(0);
}
emit({ kind: "end", ...stats, ...(SEEDED ? { calib: { req: calib.req.stats, pre: calib.pre.stats } } : {}) });
if (KATAGO) emit({ kind: "katago", ...KATAGO.status() });
KATAGO?.close();
if (NNEV) emit({ kind: "nn", ...NNEV.stats, busyMs: Math.round(NNEV.busyMs) });
NNEV?.close();
process.exit(0); // jsdom keeps the event loop alive
