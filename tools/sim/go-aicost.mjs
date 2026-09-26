// What does ONE IPvGO AI reply cost — in timer hops and in main-thread time?
//
//   node tools/sim/go-aicost.mjs [--games 20] [--size 5] [--opponents Illuminati,Daedalus]
//
// Two questions, both asked by the 2026-09-26 "go.js stalled" incident:
//
// 1. HOPS. The opponent's reply (handleNextTurn -> getMove, goAI.ts:60-128)
//    is a chain of setTimeouts: waitCycle (goAI.ts:877) in getMove, one per
//    retrieveMoveOption (goAI.ts:849), one per board row in
//    findAnyMatchedPatterns (patternMatching.ts:104), and one more in
//    handleNextTurn before the stone is placed. In a VISIBLE tab each hop is
//    ~200ms. In a hidden tab Chrome's intensive throttling fires chained
//    timers once per MINUTE, so the reply takes `hops` minutes. go.js's
//    per-move watchdog (movewatch in go.js) counts scheduler turns, not
//    milliseconds, for exactly this reason, and its threshold is set from the
//    maximum measured here.
//
// 2. MAIN THREAD. Everything between hops is synchronous game code on the
//    browser's only thread. `maxSliceMs` is the longest such block — the
//    number that matters for page freezes — and `computeMs` their sum.
//
// CALIBRATION: hop counts are exact by construction — this is the game's own
// getMove, and a hop is a setTimeout it schedules. The hidden-tab minutes per
// reply were checked against the live game once, 2026-09-26: /go/req.txt
// writes at 14:42:54 and 14:59:54 (17 min per move cycle = up to 15 AI hops +
// our 2 sleeps, all on minute boundaries). The millisecond figures are NOT
// CALIBRATED against a browser: node/jsdom, not Chrome, ran the synchronous
// code, so read maxSliceMs as an order of magnitude and nothing finer.
//
// Timers are short-circuited to 0ms (the sleeps are dead time here) and
// COUNTED. Our side plays golib's UCT at --ourms so positions look like live
// ones; its time is not part of any number reported.

import "./env.mjs";

const realSetTimeout = globalThis.setTimeout;
let hops = 0;
let sliceStart = null;
let maxSlice = 0;
globalThis.setTimeout = function (fn, ms, ...rest) {
  // A hop is scheduled at the END of a synchronous segment: close the slice.
  if (sliceStart !== null) {
    const d = performance.now() - sliceStart;
    if (d > maxSlice) maxSlice = d;
    sliceStart = null;
  }
  hops++;
  return realSetTimeout(
    (...a) => {
      sliceStart = performance.now();
      fn(...a);
    },
    0,
    ...rest,
  );
};

const g = await import("./game.bundle.mjs");
const { chooseMoveUCT } = await import("../../golib.js");
const { GoColor, GoOpponent } = g;

const argv = process.argv.slice(2);
const arg = (n, d) => (argv.indexOf(`--${n}`) > -1 ? argv[argv.indexOf(`--${n}`) + 1] : d);
const GAMES = Number(arg("games", 20));
const N = Number(arg("size", 5));
const OURMS = Number(arg("ourms", 50));
const OPPS = String(arg("opponents", "Illuminati,Daedalus")).split(",");

const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];

for (const name of OPPS) {
  const opp = GoOpponent[name];
  if (!opp) throw new Error(`unknown opponent ${name}`);
  const hopList = [];
  const cpuList = [];
  const sliceList = [];
  for (let game = 0; game < GAMES; game++) {
    const state = g.getNewBoardState(N, opp, true);
    g.Go.currentGame = state;
    g.Go.storedCycles = 0; // live farming runs out of stored cycles; 200ms branch
    const komi = g.opponentDetails[opp].komi;
    let guard = 0;
    while (state.passCount < 2 && guard++ < N * N * 4) {
      const valid = Array.from({ length: N }, () => new Array(N).fill(false));
      for (const p of g.getAllValidMoves(state, GoColor.black)) valid[p.x][p.y] = true;
      const ranked = chooseMoveUCT(g.simpleBoardFromBoard(state.board), valid, N, komi, OURMS);
      if (!(ranked && ranked.length && g.makeMove(state, ranked[0].x, ranked[0].y, GoColor.black))) {
        g.passTurn(state, GoColor.black, false);
      }
      if (state.passCount >= 2) break;

      hops = 0;
      maxSlice = 0;
      sliceStart = performance.now();
      const t0 = performance.now();
      const reply = await g.getMove(state, GoColor.white, opp, true, Math.floor(Math.random() * 3e7));
      if (sliceStart !== null) maxSlice = Math.max(maxSlice, performance.now() - sliceStart);
      sliceStart = null;
      const cpu = performance.now() - t0;
      // +1: handleNextTurn waits one more waitCycle before placing a stone.
      hopList.push(hops + (reply.type === "move" ? 1 : 0));
      cpuList.push(cpu);
      sliceList.push(maxSlice);
      if (reply.type === "move") g.makeMove(state, reply.x, reply.y, GoColor.white);
      else g.passTurn(state, GoColor.white, false);
    }
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  console.log(
    JSON.stringify({
      opponent: name,
      size: N,
      aiMoves: hopList.length,
      hops: { mean: +mean(hopList).toFixed(1), p50: pct(hopList, 0.5), p99: pct(hopList, 0.99), max: Math.max(...hopList) },
      computeMs: { mean: +mean(cpuList).toFixed(2), p99: +pct(cpuList, 0.99).toFixed(2), max: +Math.max(...cpuList).toFixed(2) },
      maxSliceMs: { mean: +mean(sliceList).toFixed(2), p99: +pct(sliceList, 0.99).toFixed(2), max: +Math.max(...sliceList).toFixed(2) },
      visibleTabReplyS: +((mean(hopList) * 200) / 1000).toFixed(1),
      hiddenTabReplyMin: +mean(hopList).toFixed(1),
    }),
  );
}
process.exit(0);
