// NOT CALIBRATED: a corpus builder (one deterministic replay per check, not a win-rate estimate; see go-regress.mjs).
// Append a lost Go game to the regression corpus (tools/test/fixture-go-losses.json,
// replayed by tools/test/golosses.test.mjs — `node tools/test/run.mjs golosses`).
//
//   node tools/sim/go-fixture.mjs                         the most recent live loss
//   node tools/sim/go-fixture.mjs --at 2026-10-06T02:45   the live loss whose `at` starts so
//   node tools/sim/go-fixture.mjs --loss 3                the 3rd most recent live loss
//   node tools/sim/go-fixture.mjs --all                   every live loss in the log
//   node tools/sim/go-fixture.mjs --harness f.jsonl [--i 17]   a go-w0.mjs --trace loss (every loss, or game i)
//   options: --file .telemetry/go-games.txt  --out <fixture json>  --work 1600
//            --from P (the check's ply; default: the critical ply, below)  --note "..."  --dry
//
// For each game it resolves the AI's seed lag at every reply the record has a
// playtime for (go-regress.mjs caseFromRecord), finds the CRITICAL PLY — the
// last of our moves where the current solver, on the logged line, still finds
// a line winning >= 50% — and replays the game from there with the current
// solver. The case is stored with status:
//   open   the current solver still loses it: a known failure (WARN in CI)
//   fixed  it wins now: CI FAILS if it ever loses again
// Re-running on a game already in the corpus replaces its entry (by id).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { caseFromRecord, criticalPly, playCheck, probeAt } from "./go-regress.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..");
const argv = process.argv.slice(2);
const str = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const FILE = str("file", path.join(REPO, ".telemetry", "go-games.txt"));
const OUT = str("out", path.join(REPO, "tools", "test", "fixture-go-losses.json"));
const WORK = Number(str("work", 1600));
const DRY = argv.includes("--dry");
const NOTE = str("note", "");

/** Records to turn into cases: [{rec, id, source}]. */
function pick() {
  const H = str("harness", null);
  if (H) {
    const lines = fs.readFileSync(H, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    const start = lines.find((l) => l.kind === "start") ?? {};
    const games = lines.filter((l) => l.kind === "game" && (argv.includes("--i") ? l.i === Number(str("i", -1)) : l.won === false));
    return games.map((g) => {
      if (!g.trace) throw new Error(`${H} game ${g.i}: no trace (run go-w0.mjs with --trace)`);
      return { rec: harnessRecord(g, start), id: `harness-${path.basename(H, ".jsonl")}-${g.i}`, source: "harness" };
    });
  }
  const games = fs.readFileSync(FILE, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const losses = games.filter((g) => g.won === false);
  if (!losses.length) throw new Error(`no lost game in ${FILE} (${games.length} games)`);
  let sel;
  if (argv.includes("--all")) sel = losses;
  else if (str("at", null)) sel = losses.filter((g) => String(g.at).startsWith(str("at", "")));
  else sel = [losses[losses.length - Number(str("loss", 1))]];
  if (!sel.length || !sel[0]) throw new Error(`no matching loss in ${FILE}`);
  return sel.map((rec) => ({ rec, id: `live-${rec.at}-${rec.opponent}`, source: "live" }));
}

/** A go-w0.mjs --trace game -> the go-games.txt record shape (moves with the AI's exact seed). */
function harnessRecord(g, start) {
  const tr = g.trace;
  const startBoard = tr[0].board.join("");
  const moves = [];
  for (let i = 1; i < tr.length; i++) {
    const e = tr[i];
    const mv = (x) => (x === "pass" ? "P" : `${x[0]},${x[1]}`);
    if (e.who === "B") moves.push({ m: mv(e.mv), r: "G", ...(e.T ? { T: e.T } : {}) });
    else if (e.who === "W" && moves.length) {
      moves[moves.length - 1].r = mv(e.mv);
      if (e.seed) moves[moves.length - 1].seed = e.seed;
    }
  }
  const opp = { "The Black Hand": "TheBlackHand", "Slum Snakes": "SlumSnakes" }[start.opponent] ?? start.opponent;
  return { at: null, opponent: opp, size: g.size, komi: g.komi, start: startBoard, moves, black: g.black, white: g.white, won: false, streakBefore: 8 };
}

const fixture = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { v: 1, cases: [] };
for (const { rec, id, source } of pick()) {
  const fx = await caseFromRecord(rec, { id, source, note: NOTE });
  // A harness trace carries the AI's exact seed: k relative to our T is exact.
  for (let i = 0; i < rec.moves.length; i++) if (rec.moves[i].seed && rec.moves[i].T) fx.moves[i].ks = [Math.round((rec.moves[i].seed - rec.moves[i].T) / 200)];
  const from = str("from", null) !== null ? Number(str("from", 0)) : await criticalPly(fx, { work: WORK });
  const probe = await probeAt(fx, from, { work: WORK });
  const res = await playCheck(fx, { from, work: WORK });
  fx.checks = [{ from, work: WORK, why: `critical ply: the last on the logged line where the solver found a line winning >= 50% (live played ${fx.moves[from]?.m}; replay picks ${probe?.mv} at win rate ${probe?.wr})` }];
  fx.status = res.won ? "fixed" : "open";
  const ks = fx.moves.map((m) => (m.ks ? `[${m.ks.join(",")}]` : "-")).join(" ");
  console.log(`${fx.id}: ${fx.moves.length} plies, seed k per reply ${ks}`);
  console.log(`  check from ply ${from}: replay ${res.won ? "WON" : "LOST"} ${res.black}-${res.white}  line ${res.line.map((l) => `${l.m}/${l.r}`).join(" ")}  -> status ${fx.status}`);
  if (!DRY) {
    const i = fixture.cases.findIndex((c) => c.id === fx.id);
    if (i >= 0) fixture.cases[i] = fx;
    else fixture.cases.push(fx);
  }
}
if (!DRY) {
  fs.writeFileSync(OUT, JSON.stringify(fixture, null, 1) + "\n");
  console.log(`wrote ${OUT} (${fixture.cases.length} cases)`);
}
process.exit(0);
