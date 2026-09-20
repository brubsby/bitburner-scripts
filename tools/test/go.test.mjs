// [GO] The IPvGO stack still says out loud when it has been crippled.
//
// THE BUG CLASS THIS EXISTS FOR. go.js degrades gracefully when the external
// solver (tools/go-solver.mjs) is absent: it falls back to a 20ms local search
// and keeps playing. That is the right behaviour and it is documented in
// CLAUDE.md. What it did NOT do, until 2026-09-20, is SAY so — and the solver
// turned out to have been absent for a 67-hour daemon session spanning three
// BitNodes, with `remoteMoves: 0` sitting unread in /tel/go.txt and `health`
// reporting 'ok' throughout. Every node-power measurement in this project is
// taken at 800ms against the real solver, so that run was not a weaker version
// of the measured configuration; it was a regime nothing had measured.
//
//   GO1 solverHealth() actually fires. Each branch is SEEN TO FAIL, including
//       the refusal to judge on thin evidence, because a check nobody has
//       watched fail is not known to work.
//   GO2 go.js routes its per-game status through it, rather than publishing a
//       hardcoded 'ok' — the exact defect that hid the outage.
//   GO3 The daemon supervises the solver, so nothing depends on a human
//       starting it, and it kills the child on the way out.
//   GO4 The measurement tools carry the solver as a STATED precondition. A
//       power-per-hour table taken at 800ms is not evidence about a run
//       playing at 20ms, and the file that prints it has to say so.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO } from "./ram.mjs";
// go.js imports golib.js/sfgate.js/status.js with Netscript bare specifiers,
// which node cannot resolve — see tools/sim/rootimport.mjs for why importing
// the real shipped file (rather than a copy) is worth the shim.
import { importRootScript } from "../sim/rootimport.mjs";

const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

export async function run() {
  const checks = [];
  const { solverHealth } = await importRootScript("go.js");

  /* ------------------------------------------------------------------ GO1 */
  const c1 = new Check("GO1", "solverHealth() fires on an absent solver, on a degraded one, and refuses to judge on thin evidence");
  {
    // Every case below is asserted to produce the OPPOSITE of the healthy
    // answer somewhere. A table where every row could pass by returning
    // {health:'ok'} unconditionally is not a test of anything.
    const cases = [
      { o: { moves: 0, remoteMoves: 0 }, health: "ok", share: null, why: "no moves yet — nothing to judge" },
      { o: { moves: 9, remoteMoves: 0 }, health: "ok", share: null, why: "under the 10-move threshold, a just-restarted solver" },
      { o: { moves: 10, remoteMoves: 0 }, health: "warn", share: 0, why: "solver absent, at the threshold" },
      { o: { moves: 47, remoteMoves: 0 }, health: "warn", share: 0, why: "the live 2026-09-20 reading" },
      { o: { moves: 40, remoteMoves: 10 }, health: "warn", share: 0.25, why: "solver answering a quarter of moves" },
      { o: { moves: 40, remoteMoves: 30 }, health: "ok", share: 0.75, why: "solver healthy" },
      { o: { moves: 40, remoteMoves: 40 }, health: "ok", share: 1, why: "solver answering everything" },
    ];
    for (const { o, health, share, why } of cases) {
      c1.examined(1);
      const r = solverHealth(o);
      if (r.health !== health) c1.fail(`solverHealth(${JSON.stringify(o)}) should be '${health}' (${why}), got '${r.health}'`);
      if (r.solverShare !== share) c1.fail(`solverHealth(${JSON.stringify(o)}) share should be ${share}, got ${r.solverShare}`);
      if (health === "warn" && !r.detail) c1.fail(`a warn must NAME the problem; ${JSON.stringify(o)} produced no detail`);
      if (health === "ok" && r.detail) c1.fail(`a healthy solver must not produce a detail, got ${JSON.stringify(r.detail)}`);
    }
    // The warn has to be actionable, not just present: it must name the thing
    // to go and look at, or it is an alarm that leaves the reader where the
    // 67-hour outage left them.
    c1.examined(1);
    const absent = solverHealth({ moves: 47, remoteMoves: 0 });
    if (!/go-solver|12526/.test(absent.detail ?? "")) {
      c1.fail("the absent-solver warn must point at tools/go-solver.mjs or the daemon status port", absent.detail);
    }
    // THE TWO WARN BRANCHES MUST BE PINNED SEPARATELY. Deleting the
    // solver-absent branch entirely leaves the degraded-share branch to catch
    // the same case and still return {health:'warn', solverShare:0} — so an
    // assertion on health alone passes over the deletion. That is not
    // hypothetical: it is what this check did when it was first mutation-
    // tested, and it is the reason the two messages are distinguished here.
    // "Nobody is answering" and "answering too slowly" send a reader to
    // different places.
    c1.examined(1);
    const degraded = solverHealth({ moves: 40, remoteMoves: 10 });
    if (!/not answering/.test(absent.detail ?? "")) {
      c1.fail("the absent-solver warn must say the solver is NOT ANSWERING, distinctly from a slow one", absent.detail);
    }
    if (!/only 10 of 40/.test(degraded.detail ?? "")) {
      c1.fail("the degraded warn must quote the answered/total split, distinctly from an absent solver", degraded.detail);
    }
    if (absent.detail === degraded.detail) {
      c1.fail("absent and degraded solvers produce the same message — one branch is dead and nothing would notice");
    }
    // Garbage in must not silently read as healthy.
    for (const o of [{}, { moves: null, remoteMoves: null }, { moves: NaN, remoteMoves: 5 }]) {
      c1.examined(1);
      const r = solverHealth(o);
      if (r.health !== "ok" || r.solverShare !== null) c1.fail(`unreadable counters must refuse to judge, ${JSON.stringify(o)} gave ${JSON.stringify(r)}`);
    }
    c1.note(`thresholds: warn under 50% solver share, no judgement under 10 moves; live 2026-09-20 reading (47 moves, 0 remote) -> '${absent.health}'`);
  }
  checks.push(c1);

  /* ------------------------------------------------------------------ GO2 */
  const c2 = new Check("GO2", "go.js publishes the solver's health rather than a hardcoded 'ok'");
  {
    const src = read("go.js");
    c2.examined(1);
    if (!/const solver = solverHealth\(\{ moves, remoteMoves \}\)/.test(src)) {
      c2.fail("go.js no longer computes solverHealth() from its own move counters");
    }
    c2.examined(1);
    if (!/note\(solver\.health, \{/.test(src)) {
      c2.fail("go.js's per-game status write does not carry the solver health — a hardcoded note('ok', ...) is how the outage stayed invisible");
    }
    // The counters the alarm is made of must still exist and still be published.
    for (const field of ["remoteMoves", "localMoves", "solverShare"]) {
      c2.examined(1);
      if (!new RegExp(`\\b${field}\\b`).test(src)) c2.fail(`go.js no longer tracks ${field}`);
    }
  }
  checks.push(c2);

  /* ------------------------------------------------------------------ GO3 */
  const c3 = new Check("GO3", "the daemon owns the solver's lifetime — no human in the loop, no orphans on the way out");
  {
    const src = read("tools/rfa-daemon.mjs");
    c3.examined(1);
    if (!/spawn\(process\.execPath, args/.test(src)) c3.fail("rfa-daemon.mjs no longer spawns the solver itself");
    c3.examined(1);
    if (!/child\.on\("exit"/.test(src) || !/setTimeout\(startSolver/.test(src)) {
      c3.fail("rfa-daemon.mjs spawns the solver but does not RESTART it — a one-shot spawn reproduces the outage the moment the child dies");
    }
    c3.examined(1);
    if (!/SIGINT/.test(src) || !/stopSolver/.test(src)) {
      c3.fail("rfa-daemon.mjs does not kill the solver on shutdown — restarting the daemon would leave an orphan racing the new one on /go/req.txt");
    }
    c3.examined(1);
    if (!/goSolver/.test(src)) c3.fail("the daemon does not publish solver state on /status, so 'is it alive?' still needs ps");
    c3.examined(1);
    if (!/GO_SOLVER/.test(src)) c3.fail("no way to disable the supervised solver when running one by hand");
  }
  checks.push(c3);

  /* ------------------------------------------------------------------ GO4 */
  const c4 = new Check("GO4", "the Go measurements state the solver as a precondition of their own validity");
  {
    for (const rel of ["tools/sim/go-boardsize.mjs", "tools/sim/go-boardsize-report.mjs", "tools/sim/go-opponent.mjs"]) {
      c4.examined(1);
      const src = read(rel);
      if (!/PRECONDITION/.test(src)) {
        c4.fail(`${rel} does not state the external solver as a precondition — its numbers are measured against a real search and do not describe a run without one`);
      }
    }
    // The report's difficulty multiplier must be per-configuration. It was the
    // literal 1.5 (Daedalus's) until the opponent became a dimension, which
    // understated Illuminati's 5x5 special case by 5.33x.
    c4.examined(1);
    const rep = read("tools/sim/go-boardsize-report.mjs");
    if (/black \* 1\.5 \* m/.test(rep)) {
      c4.fail("go-boardsize-report.mjs has gone back to hardcoding Daedalus's difficulty multiplier — every cross-opponent comparison it prints would be wrong");
    }
    if (!/power \+= black \* difficulty \* m/.test(rep)) {
      c4.fail("go-boardsize-report.mjs no longer takes the difficulty multiplier from the game records");
    }
  }
  checks.push(c4);

  return checks;
}
