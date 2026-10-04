// Node power per hour, per (opponent, board size, solver), from go-w0.mjs runs.
//
//   node tools/sim/go-study-report.mjs /tmp/study/*.jsonl [--bootstrap 200000] [--json]
//
// CALIBRATION (printed FIRST, pass or fail): the arm matching what the live
// game is playing right now — opponent and board size from .telemetry/go.txt,
// solver = model if go.js reports model answers (modelAnswered), else uct —
// is compared with the live record: win rate (the game's own cumulative
// wins/losses for that opponent, tolerance 15 points, >= 20 decided games) and
// our turns per game (go.js session counters, tolerance 10%, >= 5 games). The
// arms that are NOT live are extrapolations of a harness checked on that one,
// and the block says so.
//
// Why a second report next to go-boardsize-report.mjs: go-w0.mjs is the harness
// that plays like go.js does today — mirror pass when the AI passes and black is
// ahead, the solver told when the AI passed, a fresh offline-node layout per
// game (go-board.mjs), optional opponent-model search (--model) — and it
// records the AI's waitCycles AND pattern-row sleeps, which is the live wall
// clock. go-boardsize.mjs has none of the first three.
//
// PER ARM (one jsonl = one arm: opponent x size x maxms x solver):
//   power per game = black.sum x getDifficultyMultiplier(komi, size) x
//                    getWinstreakMultiplier(streak, oldStreak)
//                    (scoring.ts:85-88, effect.ts:119-135, transcribed below)
//   The streak multiplier is path-dependent (breaking a dry streak pays up to
//   5x), so it is not derived from the win rate: the arm's (won, black) pairs
//   are bootstrap-resampled into one long consecutive sequence and the game's
//   own streak bookkeeping (scoring.ts:56-88, resetWinstreak) is replayed over
//   it — the steady state a farming loop converges to.
//   seconds per game = go-w0's liveS (our think + ~0.55s solver round trip +
//   go.js idle per move; 200ms per AI waitCycle; 10ms per pattern row) + the
//   AI's own compute (oppMs, measured under node) + 100ms reset (go.js).
//   power/h = steady power per game / seconds per game x 3600.

import fs from "node:fs";
import { checkWithin, uncheckable, report as calibrationReport, TELEMETRY } from "./calibrate.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(`--${n}`) ? Number(args[args.indexOf(`--${n}`) + 1]) : d);
const BOOT = flag("bootstrap", 200000);
// The per-move round trip outside both searches, calibrated against the live
// game (go-w0.mjs ROUND_TRIP_MS; the CHECK block re-tests it every run).
// --rt-ms N prices the same games under another pipeline (275: the release-1
// pipeline, 250ms/150ms polls and 100ms idle; 85: release 2's fast polls).
const ROUND_TRIP_MS = flag("rt-ms", 85);
// --telemetry DIR: where go.txt lives (a worktree has no .telemetry of its own).
const TEL_DIR = args.includes("--telemetry") ? args[args.indexOf("--telemetry") + 1] : TELEMETRY;
const FILES = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && args[i - 1] !== "--json"));

const KOMI = { Netburners: 1.5, "Slum Snakes": 3.5, "The Black Hand": 3.5, Tetrads: 5.5, Daedalus: 5.5, Illuminati: 7.5, "????????????": 9.5 };
function difficulty(komi, size) {
  return size === 5 && komi === 7.5 ? 8 : (komi + 0.5) * 0.25; // effect.ts:132-135
}
function streakMult(s, old) {
  if (s < 0) return 0.5; // effect.ts:119-130
  if (old < 0 && s > 0) return 1 + 0.5 * Math.min(-old, 8);
  return 1 + 0.25 * Math.min(s, 8);
}
function replay(seq, diff) {
  let s = 0, old = 0, power = 0, mult = 0;
  for (const { won, black } of seq) {
    old = s;
    if (!won) s = s >= 0 ? -1 : s - 1;
    else s = old < 0 ? 1 : s + 1;
    const m = streakMult(s, old);
    mult += m;
    power += black * diff * m;
  }
  return { power, meanMult: mult / seq.length };
}
let seed = 12345;
const rnd = () => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 4294967296;
};

const arms = new Map();
for (const f of FILES) {
  if (!fs.existsSync(f)) continue;
  let start = null;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    if (o.kind === "start") start = o;
    if (o.kind !== "game" || !start) continue;
    const opts = start.opts && Object.keys(start.opts).length ? JSON.stringify(start.opts) : "";
    const solver = (start.katago ? `katago${start.katago}v` : start.model ? "model" : "uct") + (start.ponder && !start.katago ? "+ponder" : "") + (start.session ? `+session:${start.session}` : "") + (start.katagoSettings ? ` ${JSON.stringify(start.katagoSettings)}` : "") + (start.katagoOldPass ? " oldpass" : "") + (start.katagoHoles ? ` holes=${start.katagoHoles}` : "") + (start.katagoRemoteNet ? ` net=${start.katagoRemoteNet.slice(0, 13)}` : "") + (start.katagoOverride ? ` ${start.katagoOverride}` : "") + (start.cheat ? "+cheat" : "") + (start.opening ? ` open${start.opening.k}:${start.opening.ms}` : "") + (opts ? " " + opts : "") + (start.objective ? ` obj=${start.objective}${start.lossScale !== 1 ? `:L${start.lossScale}` : ""}${start.leafK ? `:K${start.leafK}` : ""}` : "") + (start.mirrorMode === "search" ? " mirror=search" : "") + (start.presend ? " presend" : "") + (start.seeded ? (start.clock ? " seeded+clock" : " seeded") : "");
    const key = `${start.opponent}|${o.size}|${start.maxms}|${solver}`;
    if (!arms.has(key)) arms.set(key, { opponent: start.opponent, size: o.size, maxms: start.maxms, solver, rtMs: start.rtMs ?? 550, games: [] });
    arms.get(key).games.push(o);
  }
}

const rows = [];
for (const arm of arms.values()) {
  const gs = arm.games;
  const n = gs.length;
  const komi = gs[0].komi ?? KOMI[arm.opponent];
  const diff = difficulty(komi, arm.size);
  const pairs = gs.map((g) => ({ won: !!g.won, black: g.black }));
  const boot = Array.from({ length: BOOT }, () => pairs[(rnd() * n) | 0]);
  const st = replay(boot, diff);
  // Re-timed to the calibrated per-move round trip (go-w0 ROUND_TRIP_MS): a
  // record made at another value (550ms before 2026-10-04) is shifted per turn.
  // Pre-sent moves (release 3) never took the round trip: only the others are re-timed.
  const secs = gs.map((g) => g.liveS + ((g.ourTurns - (g.preMoves ?? 0)) * (ROUND_TRIP_MS - (arm.rtMs ?? 550))) / 1000 + (g.oppMs ?? 0) / 1000 + 0.1);
  const secPerGame = secs.reduce((a, b) => a + b, 0) / n;
  const wins = pairs.filter((p) => p.won).length;
  const p = wins / n;
  const z = 1.96, den = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  rows.push({
    opponent: arm.opponent,
    size: arm.size,
    solver: arm.solver,
    maxms: arm.maxms,
    games: n,
    winRate: +p.toFixed(3),
    winLo: +Math.max(0, centre - half).toFixed(3),
    winHi: +Math.min(1, centre + half).toFixed(3),
    meanBlack: +(pairs.reduce((a, b) => a + b.black, 0) / n).toFixed(1),
    difficulty: diff,
    meanStreakMult: +st.meanMult.toFixed(2),
    powerPerGame: +(st.power / BOOT).toFixed(1),
    secPerGame: +secPerGame.toFixed(1),
    powerPerHour: Math.round(((st.power / BOOT) / secPerGame) * 3600),
  });
}
rows.sort((a, b) => a.opponent.localeCompare(b.opponent) || a.size - b.size || a.solver.localeCompare(b.solver) || a.maxms - b.maxms);

// Turns per game, per arm (for the live check).
for (const r of rows) {
  const arm = [...arms.values()].find((a) => a.opponent === r.opponent && a.size === r.size && a.solver === r.solver && a.maxms === r.maxms);
  r.ourTurns = +(arm.games.reduce((t, g) => t + g.ourTurns, 0) / arm.games.length).toFixed(1);
  // go.js counts STONES (moves++ only after a stone, go.js main loop); our
  // turns include passes. The live check compares like with like.
  r.ourStones = +(arm.games.reduce((t, g) => t + g.ourTurns - (g.ourPasses ?? 0), 0) / arm.games.length).toFixed(2);
  const sd = Math.sqrt(arm.games.reduce((t, g) => t + (g.ourTurns - (g.ourPasses ?? 0) - r.ourStones) ** 2, 0) / Math.max(1, arm.games.length - 1));
  r.stonesSd = +sd.toFixed(2);
}

function liveCheck() {
  console.log("CHECK  harness vs live game (.telemetry/go.txt, written by go.js)");
  let live;
  try {
    live = JSON.parse(fs.readFileSync(`${TEL_DIR}/go.txt`, "utf8"));
  } catch (e) {
    uncheckable("go-study", `no .telemetry/go.txt — ${e.message}`);
    calibrationReport("go-study calibration");
    return;
  }
  const remote = live.remoteMoves ?? 0;
  const local = live.localMoves ?? 0;
  if (remote + local >= 10 && remote / (remote + local) < 0.5) {
    uncheckable("go-study SOLVER", `the live solver answered ${remote} of ${remote + local} moves — the live record is the local fallback's, a regime no arm here measures`);
    calibrationReport("go-study calibration");
    return;
  }
  const liveSolver = (live.modelAnswered ?? 0) > 0 && (live.modelAnswered ?? 0) >= 0.5 * (live.modelAsked ?? 0) ? "model" : "uct";
  const OPP = { TheBlackHand: "The Black Hand", SlumSnakes: "Slum Snakes" };
  const liveOpp = OPP[live.opponent] ?? live.opponent;
  // The live solver's variant: go.txt `solverMode` when go-solver reports it
  // (release 2), else pondering inferred from ponderHits. Longest match first.
  const variants = liveSolver === "model" ? [live.solverMode === "session" ? "model+session:ponder" : null, (live.ponderHits ?? 0) > 0 ? "model+ponder" : null, "model"].filter(Boolean) : [liveSolver];
  const arm = variants.map((v) => rows.find((r) => r.opponent === liveOpp && r.size === live.boardSize && r.solver === v)).find(Boolean);
  if (!arm) {
    uncheckable("go-study", `live is ${liveOpp} ${live.boardSize}x${live.boardSize} on ${liveSolver}; no measured arm matches`);
    calibrationReport("go-study calibration");
    return;
  }
  console.log(`  live arm: ${liveOpp} ${arm.size}x${arm.size} ${arm.solver} (${arm.games} harness games)`);
  const decided = (live.wins ?? 0) + (live.losses ?? 0);
  if (decided < 20) uncheckable("go-study win rate", `live record ${live.wins ?? 0}W/${live.losses ?? 0}L — under 20 decided games`);
  else checkWithin("go-study win rate", arm.winRate, live.wins / decided, 0.15, (x) => `${(100 * x).toFixed(1)}%`);
  const g = live.gamesThisProcess ?? 0;
  // Stones per game, harness vs live. The live mean over g games has a
  // standard error of ~sd/sqrt(g) (sd ~3 stones on 5x5): with 15 games that
  // alone is ~7% of the mean, so fewer than 30 live games cannot test a 10%
  // tolerance and the check says so rather than failing on noise (2026-10-04:
  // 12.2 live over 15 games vs 10.8, 1.7 standard errors; it had been 10.5).
  // Seconds per STONE (our move): the live process's wall clock over its
  // stones (go.txt processStartedAt .. at, moves). Per game drifts with how
  // long the opponent's games run (live 16.4 s/game over one 53-game window,
  // 12.9 over the next 70: shorter games, the same ~1.5s per turn), so the
  // turn is what is checked; games per hour then follow from stones/game.
  const liveSec = (Date.parse(live.at) - (typeof live.processStartedAt === "number" ? live.processStartedAt : Date.parse(live.processStartedAt))) / 1000 / live.moves;
  if (g < 30 || !(liveSec > 0)) uncheckable("go-study s/stone", `only ${g} live games this go.js session (need 30)`);
  else {
    // A go.js without turnTiming runs the release-1 pipeline (250ms reply
    // poll, 100ms idle): price the arm at that pipeline's 275ms for the check.
    const rt = live.turnTiming ? ROUND_TRIP_MS : 275;
    const sec = (arm.secPerGame + (arm.ourTurns * (rt - ROUND_TRIP_MS)) / 1000) / arm.ourStones;
    checkWithin(`go-study s/stone (pipeline ${rt}ms/turn)`, sec, liveSec, 0.1, (x) => x.toFixed(2));
    if (live.turnTiming) console.log(`  live turn: ask ${live.turnTiming.askMs}ms, AI ${live.turnTiming.playMs}ms, whole move ${live.turnTiming.loopMs}ms over ${live.turnTiming.moves} moves`);
  }
  if (g < 30 || !(live.moves > 0)) uncheckable("go-study stones/game", `only ${g} live games this go.js session (need 30: the live mean's standard error is ~${(100 * arm.stonesSd / Math.sqrt(Math.max(g, 1)) / arm.ourStones).toFixed(0)}% at ${g})`);
  else checkWithin("go-study stones/game", arm.ourStones, live.moves / g, 0.1, (x) => x.toFixed(1));
  uncheckable("go-study other arms", "every other row is the same harness on a configuration the live game is not playing — an extrapolation of the arm checked above");
  calibrationReport("go-study calibration");
}
if (args.includes("--json")) {
  console.log(JSON.stringify(rows, null, 1));
} else {
  liveCheck();
  console.log("");
  console.log("opponent         size maxms  n   win  [95% CI]      black  diff  mult  power/game  s/game  power/h  solver");
  for (const r of rows) {
    console.log(
      `${r.opponent.padEnd(16)} ${String(r.size).padStart(4)} ${String(r.maxms).padStart(5)} ${String(r.games).padStart(3)} ` +
        `${(100 * r.winRate).toFixed(0).padStart(4)}% [${(100 * r.winLo).toFixed(0)}-${(100 * r.winHi).toFixed(0)}]`.padEnd(20) +
        `${String(r.meanBlack).padStart(6)} ${String(r.difficulty).padStart(5)} ${String(r.meanStreakMult).padStart(5)} ` +
        `${String(r.powerPerGame).padStart(10)} ${String(r.secPerGame).padStart(7)} ${String(r.powerPerHour).padStart(8)}  ${r.solver}`,
    );
  }
}
