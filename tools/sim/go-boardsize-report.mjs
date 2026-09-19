// Turns the JSONL from the go-boardsize harness into a node-power-per-hour
// table, and prints the board-size recommendation.
//
//   node tools/sim/go-boardsize-report.mjs [--idle N] [--solverpoll N] res/*.jsonl
//
// ---------------------------------------------------------------------------
// CALIBRATION
//
// This file's output is a decision — "play NxN instead of 9x9" — so under
// CLAUDE.md it must reproduce a quantity the live game already displays and
// print the error, pass or fail, on every run. It does: a CHECK block runs
// after the table, against `.telemetry/go.txt`, which go.js writes from
// `ns.go.analysis.getStats()` after every game.
//
// Two live quantities are compared, and the second is the one that matters:
//
//   1. WIN RATE (live `wins`/(`wins`+`losses`), the game's own cumulative
//      record for the opponent). tol 0.15 relative. This is a judgement, not a
//      measurement: the decision being protected is a ~1.9x ratio between board
//      sizes, the win rate enters only through the streak multiplier, and that
//      multiplier is bounded in [0.5, 3] — so a 15% relative error cannot
//      reverse a 90% gap while a 40% one plainly could.
//
//   2. OUR TURNS PER GAME (live `moves`/`games`, both go.js session counters,
//      so they are consistent with each other). tol 0.10. This one earns its
//      tolerance arithmetically: seconds-per-game below is
//      `ourTurns * (maxms + TURN_OVERHEAD) + oppCycles * CYCLE_MS + ...`, and
//      seconds-per-game is the denominator of the answer. A 10% error in turns
//      is very nearly a 10% error in the recommendation, which is one ninth of
//      the gap being decided. It is also the only live test of the wall-clock
//      model, which the harness cannot check itself because it short-circuits
//      the opponent's sleeps.
//
// The check only runs when the live save is in the SAME REGIME as a measured
// configuration — same board size and same go.js `--maxms`, with enough live
// games to mean anything. Otherwise it prints NOT CALIBRATED and says which of
// those it was, because comparing 9x9-at-1500ms against a live 9x9-at-20ms
// would produce a large error that says nothing about this model.
//
// WHAT CANNOT BE CHECKED HERE, and it is the important one:
//
//   * **The recommended arm has never been played live.** The conclusion this
//     file produced was 5x5 over 9x9 at ~1.9x. go.js has only ever played 9x9,
//     so the live checks below can only ever validate the BASELINE. The 5x5
//     numbers — win rate, score, game length — have no live counterpart at all,
//     and the 1.9x is an extrapolation of a harness tested on the other arm.
//     Playing 5x5 live for an hour and re-running this is what would close it.
//
//   * Two live cross-checks were made when this model was written, at 9x9 /
//     1500ms: harness win rate 81.3% [72-88] vs 78% observed live, and node
//     power 98.1/game backed out of a live 22.9% faction_rep bonus vs 114.6
//     steady state here (+17%). They are recorded as provenance and are **not
//     reproducible from this repo**: the JSONL is gone and .telemetry/go.txt
//     was reset by the 2026-09-11 prestige. Do not quote them as a current
//     calibration; quote what the CHECK block prints.
//
// Three things happen here that the per-game records cannot do on their own.
//
// 1. STREAKS ARE REPLAYED OVER ONE LONG SEQUENCE. The measurement runs on
//    several worker processes, so each worker holds only a fragment of a
//    consecutive run and its streaks never get long enough to reach the x3 cap
//    (effect.ts:129). Game outcomes against a fresh board are independent, so
//    the fragments concatenate into one valid consecutive sequence; the streak
//    bookkeeping from endGoGame (scoring.ts:56-88) is replayed over it here.
//    A bootstrap resample of the same (won, blackScore) pairs then extends the
//    sequence to 200k games to read off the steady state a farming loop
//    actually converges to — which is the number that decides the question.
//    Nothing is derived from the win rate analytically; every multiplier comes
//    from getWinstreakMultiplier applied to a played-out sequence.
//
// 2. THE LIVE WALL CLOCK IS REBUILT. The harness short-circuits the opponent's
//    `waitCycle` sleeps, so its own elapsed time is not the game's. Per our
//    turn (go.js:157-201 + tools/go-solver.mjs): go.js writes /go/req.txt and
//    polls /go/move.txt every 250ms; go-solver polls the request every --poll
//    (400ms default, mean 200ms detection), searches for --maxms, pushes back
//    over 2 RPC hops, and go.js notices at the next 250ms tick (mean +125ms);
//    then go.js sleeps --idle (400ms). Per opponent turn: the counted
//    waitCycles at 200ms each (goAI.ts:877-883), plus its measured compute.
//
// 3. RATE = STEADY-STATE POWER PER GAME / SECONDS PER GAME.
//    nodePower per game = blackScore.sum * 1.5 * streakMultiplier, where 1.5 is
//    getDifficultyMultiplier(5.5, anySize) — verified per game from the game's
//    own function, identical at 5/7/9/13 (effect.ts:132-135).

import fs from "node:fs";
import { checkWithin, uncheckable, report as calibrationReport, TELEMETRY } from "./calibrate.mjs";

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
  console.error("usage: node tools/sim/go-boardsize-report.mjs [--idle N --solverpoll N] <results.jsonl>...");
  process.exit(1);
}

const GO_JS_IDLE = num("idle", 400); // go.js SETTINGS.idle
const GO_JS_POLL = num("gojspoll", 250); // go.js poll step while waiting for the solver
const SOLVER_POLL = num("solverpoll", 400); // tools/go-solver.mjs --poll default
const RPC_MS = 20; // getFile + pushFile round trips
const RESET_MS = 100; // go.js ns.sleep(100) after resetBoardState
const CYCLE_MS = num("cyclems", 200); // goAI.ts waitCycle; 40 only while offline cycles are banked
const BOOTSTRAP = num("bootstrap", 200000);

const TURN_OVERHEAD = GO_JS_IDLE + SOLVER_POLL / 2 + GO_JS_POLL / 2 + RPC_MS;

// --- effect.ts:119-130, transcribed ----------------------------------------
function winstreakMultiplier(winStreak, previousWinStreak) {
  if (winStreak < 0) return 0.5;
  if (previousWinStreak < 0 && winStreak > 0) return 1 + 0.5 * Math.min(-previousWinStreak, 8);
  return 1 + 0.25 * Math.min(winStreak, 8);
}

// --- scoring.ts:56-88 + resetWinstreak, transcribed ------------------------
function replay(seq) {
  let winStreak = 0;
  let oldWinStreak = 0;
  let power = 0;
  let multSum = 0;
  let maxStreak = 0;
  let evenStreakHits = 0; // favor payouts, scoring.ts:66-77
  for (const { won, black } of seq) {
    if (!won) {
      oldWinStreak = winStreak;
      winStreak = winStreak >= 0 ? -1 : winStreak - 1;
    } else {
      oldWinStreak = winStreak;
      winStreak = oldWinStreak < 0 ? 1 : winStreak + 1;
      if (winStreak > maxStreak) maxStreak = winStreak;
      if (winStreak % 2 === 0) evenStreakHits++;
    }
    const m = winstreakMultiplier(winStreak, oldWinStreak);
    multSum += m;
    power += black * 1.5 * m;
  }
  return { power, meanMult: multSum / seq.length, maxStreak, evenStreakHits };
}

const games = [];
for (const f of FILES) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    if (o.kind === "game") games.push(o);
  }
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const byConfig = new Map();
for (const g of games) {
  if (!byConfig.has(g.config)) byConfig.set(g.config, []);
  byConfig.get(g.config).push(g);
}

let seed = 12345;
const rnd = () => {
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed / 4294967296;
};

const rows = [];
for (const [config, all] of byConfig) {
  // One consecutive sequence: worker fragments laid end to end in round order.
  const gs = [...all].sort((a, b) => a.worker - b.worker || a.round - b.round);
  const { size, maxms } = gs[0];
  const pairs = gs.map((g) => ({ won: g.won, black: g.black }));

  const observed = replay(pairs);
  const boot = [];
  for (let i = 0; i < BOOTSTRAP; i++) boot.push(pairs[(rnd() * pairs.length) | 0]);
  const steady = replay(boot);

  const wins = pairs.filter((p) => p.won).length;
  const n = pairs.length;
  // Wilson 95% interval on the win rate.
  const p = wins / n;
  const z = 1.96;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;

  const secs = gs.map(
    (g) => (g.ourTurns * (maxms + TURN_OVERHEAD) + g.oppCycles * CYCLE_MS + g.oppComputeMs + RESET_MS) / 1000,
  );
  const secPerGame = mean(secs);
  const steadyPowerPerGame = steady.power / boot.length;

  rows.push({
    config,
    size,
    maxms,
    games: n,
    truncated: gs.filter((g) => g.truncated).length,
    winRate: p,
    winRateLo: Math.max(0, centre - half),
    winRateHi: Math.min(1, centre + half),
    meanBlack: mean(pairs.map((x) => x.black)),
    medianBlack: median(pairs.map((x) => x.black)),
    observedMeanMult: observed.meanMult,
    observedMaxStreak: observed.maxStreak,
    steadyMeanMult: steady.meanMult,
    steadyMaxStreak: steady.maxStreak,
    favorPayoutsPerGame: steady.evenStreakHits / boot.length,
    ourTurns: mean(gs.map((g) => g.ourTurns)),
    itersPerMove: mean(gs.map((g) => g.ourIters / g.ourTurns)),
    oppCycles: mean(gs.map((g) => g.oppCycles)),
    oppComputeMs: mean(gs.map((g) => g.oppComputeMs)),
    secPerGame,
    gamesPerHour: 3600 / secPerGame,
    powerPerGame: steadyPowerPerGame,
    powerPerHour: (steadyPowerPerGame / secPerGame) * 3600,
    observedPowerPerHour: (observed.power / secs.reduce((a, b) => a + b, 0)) * 3600,
  });
}

rows.sort((a, b) => b.powerPerHour - a.powerPerHour);

/* ---------------------------------------------------------------------------
 * CHECK — live cross-check, printed BEFORE the table, pass or fail.
 *
 * It goes first deliberately. A calibration line under a recommendation is a
 * footnote; above it, it is a precondition. See the header for the tolerances
 * and for what this can and cannot establish.
 * ------------------------------------------------------------------------ */
function liveCheck() {
  const MIN_LIVE_GAMES = 20;
  console.log("CHECK  harness vs live game (.telemetry/go.txt, written by go.js from ns.go.analysis.getStats())");

  let live;
  try {
    live = JSON.parse(fs.readFileSync(`${TELEMETRY}/go.txt`, "utf8"));
  } catch (e) {
    uncheckable("go-boardsize", `no .telemetry/go.txt — ${e.message}. Is the daemon connected and go.js running?`);
    return;
  }

  const arm = rows.find((r) => r.size === live.boardSize && r.maxms === live.maxms);
  if (!arm) {
    uncheckable(
      "go-boardsize",
      `live game is playing ${live.boardSize}x${live.boardSize} at maxms=${live.maxms}; measured configurations are ` +
        `${rows.map((r) => r.config).join(", ")}. Different search budget or board size is a different regime — ` +
        `comparing across it would print an error that says nothing about this model.`,
    );
    return;
  }

  // 1. Win rate. `wins`/`losses` are the GAME's cumulative record for this
  //    opponent, not go.js's session counters, so they survive a go.js restart.
  const decided = (live.wins ?? 0) + (live.losses ?? 0);
  if (decided < MIN_LIVE_GAMES) {
    uncheckable(
      "go-boardsize win rate",
      `live record is ${live.wins ?? 0}W/${live.losses ?? 0}L — under ${MIN_LIVE_GAMES} decided games the live ` +
        `figure has a wider interval than the gap being decided, so agreement would not be evidence.`,
    );
  } else {
    checkWithin("go-boardsize win rate", arm.winRate, live.wins / decided, 0.15, (x) => `${(100 * x).toFixed(1)}%`);
  }

  // 2. Our turns per game. `moves` and `games` are both go.js session counters
  //    (go.js:236,270), so they are consistent with each other even though
  //    wins/losses above are not on the same clock.
  if (!(live.games > 0) || !(live.moves > 0)) {
    uncheckable(
      "go-boardsize turns/game",
      `live go.txt has games=${live.games} moves=${live.moves} — go.js has not completed a game this session, ` +
        `so there is no length to compare the wall-clock model against.`,
    );
  } else if (live.games < 5) {
    uncheckable(
      "go-boardsize turns/game",
      `only ${live.games} live game(s) this go.js session; game length varies enough that a mean over fewer ` +
        `than 5 is not a measurement.`,
    );
  } else {
    checkWithin("go-boardsize turns/game", arm.ourTurns, live.moves / live.games, 0.1, (x) => x.toFixed(1));
  }

  // Always said out loud, pass or fail: the arm that wins the comparison is not
  // the arm any of this validates.
  const best = rows[0];
  if (best && best.size !== live.boardSize) {
    uncheckable(
      `go-boardsize ${best.config} (the recommended arm)`,
      `the live game plays ${live.boardSize}x${live.boardSize}, so nothing above tests ${best.size}x${best.size} — ` +
        `its win rate, score and game length have no live counterpart. The ${(best.powerPerHour / (rows.find((r) => r.size === live.boardSize)?.powerPerHour ?? NaN)).toFixed(2)}x ` +
        `is an extrapolation of a harness checked only on the baseline.`,
    );
  }
  calibrationReport("go-boardsize calibration");
  console.log("");
}

liveCheck();

const f = (n, d = 2) => n.toFixed(d);
const H = [
  ["config", 7],
  ["n", 4],
  ["win%", 6],
  ["95%ci", 13],
  ["black", 6],
  ["mult", 5],
  ["iters", 7],
  ["turns", 6],
  ["s/game", 7],
  ["g/hr", 6],
  ["pwr/g", 7],
  ["PWR/HR", 8],
];
console.log(H.map(([h, w]) => (h === "config" ? h.padEnd(w) : h.padStart(w))).join(" "));
for (const r of rows) {
  console.log(
    [
      r.config.padEnd(7),
      String(r.games).padStart(4),
      f(100 * r.winRate, 1).padStart(6),
      `${f(100 * r.winRateLo, 0)}-${f(100 * r.winRateHi, 0)}`.padStart(13),
      f(r.meanBlack, 1).padStart(6),
      f(r.steadyMeanMult, 2).padStart(5),
      f(r.itersPerMove, 0).padStart(7),
      f(r.ourTurns, 1).padStart(6),
      f(r.secPerGame, 1).padStart(7),
      f(r.gamesPerHour, 1).padStart(6),
      f(r.powerPerGame, 1).padStart(7),
      f(r.powerPerHour, 0).padStart(8),
    ].join(" "),
  );
}
const base = rows.find((r) => r.config === "9x1500");
if (base) {
  console.log("\nvs 9x1500 baseline:");
  for (const r of rows) console.log(`  ${r.config.padEnd(8)} ${f(r.powerPerHour / base.powerPerHour, 2)}x`);
}
console.log(
  `\nmodel: our turn = maxms + ${TURN_OVERHEAD}ms (idle ${GO_JS_IDLE} + solverpoll ${SOLVER_POLL}/2 ` +
    `+ gojspoll ${GO_JS_POLL}/2 + rpc ${RPC_MS}); opponent waitCycle = ${CYCLE_MS}ms; ` +
    `steady-state multiplier from ${BOOTSTRAP} bootstrap games`,
);
console.log("\nfull:", JSON.stringify(rows, null, 1));
