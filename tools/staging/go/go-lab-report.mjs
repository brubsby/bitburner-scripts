// Turns tools/staging/go/go-lab.mjs's JSONL into the numbers that decide the
// question: win rate, MARGIN DISTRIBUTION, and node power per hour.
//
//   node tools/staging/go/go-lab-report.mjs --idle 100 --solverpoll 150 res/A-*.jsonl
//
// ---------------------------------------------------------------------------
// CALIBRATION
//
// The live check runs on every invocation and prints whether it passes or
// fails, per CLAUDE.md ("A model states its calibration, or states that it has
// none"). It compares this harness's our-turns-per-game and win rate against
// .telemetry/go.txt — but ONLY against an arm at the same search budget. The
// live game runs tools/go-solver.mjs at its 1500ms default (go.js's own
// --maxms 20 is the local fallback and go.txt reports localMoves: 0), so the
// comparable arm is `base1500`. If no such arm is present the check says so
// rather than comparing across budgets, which would print an error that says
// nothing about this model.
//
// WHAT DECIDES THE ANSWER (scoring.ts:85-89), on EVERY game, win or lose:
//     nodePower += blackScore.sum
//                  * getDifficultyMultiplier(komi, size)      // 1.5 at komi 5.5
//                  * getWinstreakMultiplier(winStreak, oldWinStreak)
// so the objective is (score/game) x (games/hour) x (mean streak multiplier),
// and an arm that wins more but scores less per game can still lose. Nothing
// below is derived from the win rate analytically: every multiplier comes from
// getWinstreakMultiplier replayed over a played-out sequence, exactly as
// tools/sim/go-boardsize-report.mjs does it.
//
// WALL CLOCK. The harness short-circuits the opponent's waitCycle sleeps, so
// its own elapsed time is not the game's. Per our turn (go.js:234-281 +
// tools/go-solver.mjs): go.js writes /go/req.txt and polls /go/move.txt every
// 250ms; go-solver polls the request every --solverpoll (mean half that),
// searches, pushes back over 2 RPC hops, go.js notices at the next 250ms tick
// (mean +125ms), then sleeps --idle. Per opponent turn: counted waitCycles at
// 200ms each (goAI.ts:877-883) plus its measured compute.
//
// ONE MODEL CHANGE over go-boardsize-report.mjs, and it matters here: our turn
// costs the MEASURED search time, not `maxms`. Two of the arms under test
// (mirror-pass, adaptive time) exist precisely to spend less than maxms, so
// charging them maxms would hide the entire effect. A turn that spent 0ms
// (a mirror pass, decided before the solver is consulted) is charged only
// go.js's own --idle, since no solver round trip happens on it.

import fs from "node:fs";

const args = process.argv.slice(2);
const num = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? Number(args[i + 1]) : dflt;
};
const FILES = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) i++;
  else FILES.push(args[i]);
}
if (!FILES.length) {
  console.error("usage: node tools/staging/go/go-lab-report.mjs [--idle N --solverpoll N] <*.jsonl>...");
  process.exit(1);
}

// go.js SETTINGS (go.js:119-129) and tools/go-solver.mjs --poll, as deployed.
const GO_JS_IDLE = num("idle", 100);
const GO_JS_POLL = num("gojspoll", 250);
const SOLVER_POLL = num("solverpoll", 400);
const RPC_MS = 20;
const RESET_MS = 100;
const CYCLE_MS = num("cyclems", 200);
const BOOTSTRAP = num("bootstrap", 200000);
const TELEMETRY = num("telemetry", 1) ? "/home/tbusby/Repos/bitburner-scripts/.telemetry/go.txt" : null;

const SOLVER_OVERHEAD = SOLVER_POLL / 2 + GO_JS_POLL / 2 + RPC_MS;

// --- effect.ts:119-130, transcribed ----------------------------------------
function winstreakMultiplier(winStreak, previousWinStreak) {
  if (winStreak < 0) return 0.5;
  if (previousWinStreak < 0 && winStreak > 0) return 1 + 0.5 * Math.min(-previousWinStreak, 8);
  return 1 + 0.25 * Math.min(winStreak, 8);
}

// --- scoring.ts:56-89 + resetWinstreak (:118-128), transcribed -------------
function replay(seq) {
  let winStreak = 0;
  let oldWinStreak = 0;
  let power = 0;
  let multSum = 0;
  let maxStreak = 0;
  for (const { won, black, difficulty } of seq) {
    oldWinStreak = winStreak;
    if (!won) winStreak = winStreak >= 0 ? -1 : winStreak - 1;
    else {
      winStreak = oldWinStreak < 0 ? 1 : winStreak + 1;
      if (winStreak > maxStreak) maxStreak = winStreak;
    }
    const m = winstreakMultiplier(winStreak, oldWinStreak);
    multSum += m;
    // difficulty comes from the game's own getDifficultyMultiplier, recorded
    // per game by the harness. It must NOT be hardcoded to 1.5 here: the whole
    // board-size question is whether a point is worth the same at every size,
    // and baking in the answer would make the comparison circular.
    power += black * difficulty * m;
  }
  return { power, meanMult: multSum / seq.length, maxStreak };
}

const games = [];
for (const f of FILES) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // a worker still appending; the partial last line is not a game
    }
    if (o.kind === "game") games.push(o);
  }
}
if (!games.length) {
  console.error("no games in input");
  process.exit(1);
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

let seed = 12345;
const rnd = () => {
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed / 4294967296;
};

const byArm = new Map();
for (const g of games) {
  if (!byArm.has(g.arm)) byArm.set(g.arm, []);
  byArm.get(g.arm).push(g);
}

const rows = [];
for (const [arm, all] of byArm) {
  const gs = [...all].sort((a, b) => a.worker - b.worker || a.round - b.round);
  const pairs = gs.map((g) => ({ won: g.won, black: g.black, difficulty: g.difficulty ?? 1.5 }));
  const n = pairs.length;

  const observed = replay(pairs);
  const boot = [];
  for (let i = 0; i < BOOTSTRAP; i++) boot.push(pairs[(rnd() * pairs.length) | 0]);
  const steady = replay(boot);

  const wins = pairs.filter((p) => p.won).length;
  const p = wins / n;
  const z = 1.96;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;

  // Per-game wall clock, charging MEASURED search time (see header).
  const secs = gs.map((g) => {
    const turns = g.msEach ?? [];
    let ms = 0;
    for (const t of turns) ms += t > 0 ? t + SOLVER_OVERHEAD + GO_JS_IDLE : GO_JS_IDLE;
    if (!turns.length) ms = g.ourTurns * (g.maxms + SOLVER_OVERHEAD + GO_JS_IDLE);
    return (ms + g.oppCycles * CYCLE_MS + g.oppComputeMs + RESET_MS) / 1000;
  });
  const secPerGame = mean(secs);
  const steadyPowerPerGame = steady.power / boot.length;

  const margins = gs.map((g) => g.black - g.white);
  const lossMargins = margins.filter((m) => m < 0);
  const winMargins = margins.filter((m) => m > 0);

  rows.push({
    arm,
    games: n,
    truncated: gs.filter((g) => g.truncated).length,
    winRate: p,
    winRateLo: Math.max(0, centre - half),
    winRateHi: Math.min(1, centre + half),
    meanBlack: mean(pairs.map((x) => x.black)),
    medianMargin: median(margins),
    meanLossMargin: lossMargins.length ? mean(lossMargins) : null,
    medianLossMargin: lossMargins.length ? median(lossMargins) : null,
    narrowLosses: lossMargins.filter((m) => m >= -2.5).length,
    lossHist: histogram(lossMargins),
    winHist: histogram(winMargins),
    steadyMeanMult: steady.meanMult,
    observedMaxStreak: observed.maxStreak,
    ourTurns: mean(gs.map((g) => g.ourTurns)),
    ourPasses: mean(gs.map((g) => g.ourPasses ?? 0)),
    oppPasses: mean(gs.map((g) => g.oppPasses ?? 0)),
    movesAfterOppPass: mean(gs.map((g) => g.movesAfterFirstOppPass ?? 0)),
    msPerMove: mean(gs.map((g) => (g.msEach?.length ? mean(g.msEach) : g.maxms))),
    itersPerMove: mean(gs.map((g) => g.ourIters / g.ourTurns)),
    secPerGame,
    gamesPerHour: 3600 / secPerGame,
    powerPerGame: steadyPowerPerGame,
    powerPerHour: (steadyPowerPerGame / secPerGame) * 3600,
    maxms: gs[0].maxms,
    size: gs[0].size,
  });
}

function histogram(ms) {
  const h = new Map();
  for (const m of ms) {
    const k = Math.abs(m) <= 2.5 ? String(m) : Math.abs(m) <= 6.5 ? "3-6" : Math.abs(m) <= 12.5 ? "7-12" : "13+";
    h.set(k, (h.get(k) ?? 0) + 1);
  }
  return Object.fromEntries([...h.entries()].sort((a, b) => (Number(a[0]) || 99) - (Number(b[0]) || 99)));
}

// Assert, rather than assume, that a point is worth the same at every size.
{
  const ds = [...new Set(games.map((g) => g.difficulty).filter((d) => d !== undefined))];
  if (ds.length === 0) console.log("CHECK  difficulty multiplier: not recorded by this harness — assumed 1.5.");
  else if (ds.length === 1) console.log(`CHECK  difficulty multiplier: ${ds[0]} at every board size in this run, from the game's getDifficultyMultiplier — so score per point is size-independent, as effect.ts:132-135 implies. PASS`);
  else console.log(`CHECK  difficulty multiplier VARIES across this run: ${ds.join(", ")} — the power comparison below is still correct (it uses the per-game value) but the "a point is a point" reasoning does not hold here.`);
}

rows.sort((a, b) => b.powerPerHour - a.powerPerHour);

/* --------------------------------------------------------------------------
 * CHECK — live cross-check, printed BEFORE the table, pass or fail.
 * ----------------------------------------------------------------------- */
function liveCheck() {
  let live = null;
  try {
    live = JSON.parse(fs.readFileSync(TELEMETRY, "utf8"));
  } catch {
    console.log(`CHECK  NOT CALIBRATED: ${TELEMETRY} unreadable — nothing below has been compared to the live game.`);
    return;
  }
  // The live solver budget is tools/go-solver.mjs's --maxms (1500 default), NOT
  // go.js's --maxms, which is the local fallback. go.txt localMoves:0 confirms
  // the local path never ran, so 20 is not the live budget.
  // The live-comparable arm is the one at the LIVE board size and the LIVE
  // solver budget. That budget is tools/go-solver.mjs's --maxms (1500 by
  // default, and the running process passes exactly that), NOT go.js's own
  // --maxms, which is only the in-game fallback — go.txt's localMoves: 0
  // confirms the fallback never runs, so 20 is not the live think time.
  const arm =
    rows.find((r) => r.maxms === 1500 && r.size === live.boardSize) ??
    rows.find((r) => r.maxms === 1500 && r.arm.startsWith("base"));
  if (!arm) {
    console.log(
      `CHECK  NOT CALIBRATED for the live budget: the live game plays ${live.boardSize}x${live.boardSize} with the ` +
        `external solver at 1500ms; no 1500ms baseline arm is in this input. Arms present: ` +
        `${rows.map((r) => `${r.arm}@${r.maxms}`).join(", ")}. Comparing across search budgets would print an error ` +
        `that says nothing about this model. Arms below are comparable to EACH OTHER under an identical opponent.`,
    );
    return;
  }
  const decided = (live.wins ?? 0) + (live.losses ?? 0);
  // A check that CANNOT run must say so, not fail. go.js restarts reset its
  // session counters, and the game's cumulative wins/losses only reappear in
  // the status file once a game completes — so immediately after a restart the
  // live sample is 1-2 games and any comparison against it is noise reported as
  // a verdict. CLAUDE.md: never let "I could not tell" encode as anything else.
  const MIN_LIVE_GAMES = 20;
  if (decided < MIN_LIVE_GAMES || !(live.games > 0)) {
    console.log(
      `CHECK  NOT CHECKABLE RIGHT NOW: live record is ${live.wins ?? 0}W/${live.losses ?? 0}L over ${decided} ` +
        `decided games and ${live.games ?? 0} game(s) this go.js session — under ${MIN_LIVE_GAMES} decided games the ` +
        `live figure is wider than the gap being decided, so agreement would not be evidence and disagreement ` +
        `would not be a finding. This is "could not check", which is deliberately not "failed" and not "fine".`,
    );
    return;
  }
  const liveWin = decided ? live.wins / decided : NaN;
  const liveTurns = live.games > 0 ? live.moves / live.games : NaN;
  const line = (name, model, obs, tol, fmt) => {
    if (!isFinite(obs)) return console.log(`CHECK  ${name}: no live value — uncheckable.`);
    const err = Math.abs(model - obs) / Math.abs(obs);
    console.log(
      `CHECK  ${name}: model ${fmt(model)} vs live ${fmt(obs)} — error ${(100 * err).toFixed(1)}% ` +
        `(tolerance ${(100 * tol).toFixed(0)}%) ${err <= tol ? "PASS" : "FAIL"}`,
    );
  };
  line("win rate (base@1500)", arm.winRate, liveWin, 0.15, (x) => `${(100 * x).toFixed(1)}%`);
  // live `moves` counts only non-pass moves (go.js:275); ourTurns here counts
  // every turn including passes, so compare against turns minus passes.
  line("our stone-moves/game (base@1500)", arm.ourTurns - arm.ourPasses, liveTurns, 0.15, (x) => x.toFixed(1));
  console.log(
    `       live record: ${live.wins}W/${live.losses}L over ${decided} decided games, ` +
      `${live.games} games this go.js session, board ${live.boardSize}x${live.boardSize}.`,
  );
}
liveCheck();
console.log("");

const f = (n, d = 2) => (n === null || n === undefined ? "-" : n.toFixed(d));
const H = [
  ["arm", 11],
  ["ms", 5],
  ["n", 4],
  ["win%", 6],
  ["95%ci", 12],
  ["black", 6],
  ["mult", 5],
  ["turns", 6],
  ["ms/mv", 6],
  ["s/game", 7],
  ["g/hr", 6],
  ["pwr/g", 7],
  ["PWR/HR", 8],
];
console.log(H.map(([h, w]) => (h === "arm" ? h.padEnd(w) : h.padStart(w))).join(" "));
for (const r of rows) {
  console.log(
    [
      r.arm.padEnd(11),
      String(r.maxms).padStart(5),
      String(r.games).padStart(4),
      f(100 * r.winRate, 1).padStart(6),
      `${f(100 * r.winRateLo, 0)}-${f(100 * r.winRateHi, 0)}`.padStart(12),
      f(r.meanBlack, 1).padStart(6),
      f(r.steadyMeanMult, 2).padStart(5),
      f(r.ourTurns, 1).padStart(6),
      f(r.msPerMove, 0).padStart(6),
      f(r.secPerGame, 1).padStart(7),
      f(r.gamesPerHour, 1).padStart(6),
      f(r.powerPerGame, 1).padStart(7),
      f(r.powerPerHour, 0).padStart(8),
    ].join(" "),
  );
}

console.log("\nMARGIN (black.sum - white.sum; komi 5.5 so a tie is arithmetically impossible)");
console.log("arm          losses  meanLoss  medLoss  <=2.5pt  loss histogram          win histogram");
for (const r of rows) {
  const losses = r.games - Math.round(r.winRate * r.games);
  console.log(
    [
      r.arm.padEnd(11),
      String(losses).padStart(6),
      f(r.meanLossMargin, 1).padStart(9),
      f(r.medianLossMargin, 1).padStart(8),
      String(r.narrowLosses).padStart(8),
      ("  " + JSON.stringify(r.lossHist)).padEnd(24),
      JSON.stringify(r.winHist),
    ].join(" "),
  );
}

console.log("\nPASS BEHAVIOUR (per game)");
console.log("arm          ourPasses  oppPasses  ourMovesAfterFirstOppPass");
for (const r of rows) {
  console.log(
    [r.arm.padEnd(11), f(r.ourPasses, 2).padStart(9), f(r.oppPasses, 2).padStart(10), f(r.movesAfterOppPass, 2).padStart(26)].join(" "),
  );
}

const ctrl = rows.find((r) => r.arm === "base") ?? rows[rows.length - 1];
console.log(`\nvs ${ctrl.arm}:`);
for (const r of rows) {
  console.log(
    `  ${r.arm.padEnd(12)} power/hr ${f(r.powerPerHour / ctrl.powerPerHour, 3)}x   ` +
      `win ${f(100 * (r.winRate - ctrl.winRate), 1)}pp   g/hr ${f(r.gamesPerHour / ctrl.gamesPerHour, 2)}x   ` +
      `score/game ${f(r.meanBlack / ctrl.meanBlack, 2)}x`,
  );
}
console.log(
  `\nmodel: our turn = measured search ms + ${SOLVER_OVERHEAD}ms solver round trip + ${GO_JS_IDLE}ms idle ` +
    `(a 0ms turn is charged idle only, no round trip); opponent waitCycle = ${CYCLE_MS}ms; ` +
    `steady-state multiplier from ${BOOTSTRAP} bootstrap games`,
);
console.log("\nfull: " + JSON.stringify(rows, null, 1));
