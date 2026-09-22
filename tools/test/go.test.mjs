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
// go.js imports golib.js/sfgate.js/status.js/bitNodeMultipliers.js with
// Netscript bare specifiers, and those import further bare specifiers in turn.
// rootimport.mjs rewrites only the file handed to it, so a TRANSITIVE bare
// import throws at load — which is what happened the moment go.js gained
// bitNodeMultipliers.js. gameresolve.mjs installs a resolver instead and
// handles the whole graph.
import "./gameresolve.mjs";

const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

export async function run() {
  const checks = [];
  const { solverHealth } = await import("../../go.js");

  /* ------------------------------------------------------------------ GO1 */
  const c1 = new Check("GO1", "solverHealth() fires on an absent solver, on a degraded one, and refuses to judge on thin evidence");
  {
    // Every case below is asserted to produce the OPPOSITE of the healthy
    // answer somewhere. A table where every row could pass by returning
    // {health:'ok'} unconditionally is not a test of anything.
    const cases = [
      { o: { remoteMoves: 0, localMoves: 0 }, health: "ok", share: null, why: "no requests yet — nothing to judge" },
      { o: { remoteMoves: 0, localMoves: 9 }, health: "ok", share: null, why: "under the 10-request threshold, a just-restarted solver" },
      { o: { remoteMoves: 0, localMoves: 10 }, health: "warn", share: 0, why: "solver absent, at the threshold" },
      { o: { remoteMoves: 0, localMoves: 47 }, health: "warn", share: 0, why: "the live 2026-09-20 reading" },
      { o: { remoteMoves: 10, localMoves: 30 }, health: "warn", share: 0.25, why: "solver answering a quarter of requests" },
      { o: { remoteMoves: 30, localMoves: 10 }, health: "ok", share: 0.75, why: "solver healthy" },
      { o: { remoteMoves: 40, localMoves: 0 }, health: "ok", share: 1, why: "solver answering everything" },
      // THE DENOMINATOR. The live reading that caught this was remote 20 /
      // local 4 while go.js's `moves` counter said 21 — dividing by `moves`
      // gives 0.95 and can exceed 1, because `moves` only counts turns where a
      // ranked move was played. The share must be 20/24.
      { o: { remoteMoves: 20, localMoves: 4 }, health: "ok", share: 20 / 24, why: "the live 2026-09-20 22:18 reading" },
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
    const absent = solverHealth({ remoteMoves: 0, localMoves: 47 });
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
    const degraded = solverHealth({ remoteMoves: 10, localMoves: 30 });
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
    for (const o of [{}, { remoteMoves: null, localMoves: null }, { remoteMoves: NaN, localMoves: NaN }]) {
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
    if (!/const solver = solverHealth\(\{ remoteMoves, localMoves \}\)/.test(src)) {
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

  /* ------------------------------------------------------------------ GO5 */
  const c5 = new Check("GO5", "the opponent is PRICED against the live objective, and every refusal is named");
  {
    const gp = await import("../../goplan.js");
    const W = (over = {}) => ({ faction_rep: 0.5, hacking_speed: 0.5, hacking_money: 0.5, ...over });

    // REFUSALS FIRST. Each must keep the incumbent and say why — a Go farm
    // that churns its board on an unreadable objective is worse than one that
    // never moves, because nodePower is per opponent and a switch discards it.
    for (const [o, what] of [
      [{ weights: null, windowH: 1.3, incumbent: "Daedalus" }, "no derived weights (a flat-weights pass)"],
      [{ weights: W(), windowH: null, incumbent: "Daedalus" }, "no measured install window"],
      [{ weights: W({ hacking_speed: null }), windowH: 1.3, incumbent: "Daedalus" }, "a partial basket"],
      [{ weights: W({ faction_rep: 0, hacking_speed: 0, hacking_money: 0 }), windowH: 1.3, incumbent: "Daedalus" }, "every weight zero"],
    ]) {
      c5.examined(1);
      const r = gp.chooseOpponent(o);
      if (!r.refused) c5.fail(`${what} must REFUSE, got ${JSON.stringify(r)}`);
      if (r.opponent !== "Daedalus") c5.fail(`${what} must keep the incumbent, got ${r.opponent}`);
      if (!r.why) c5.fail(`${what} must name the refusal`);
    }

    // THE CROSSOVER. faction_rep is Daedalus; hacking_speed is Illuminati.
    // With reputation weighted far above the budget channels, Daedalus wins;
    // reverse it and it must not.
    c5.examined(1);
    const repHeavy = gp.chooseOpponent({ weights: W({ faction_rep: 5, hacking_speed: 0.1, hacking_money: 0.1 }), windowH: 1.3, incumbent: "Illuminati" });
    if (repHeavy.opponent !== "Daedalus") c5.fail(`a reputation-dominated objective must choose Daedalus, got ${repHeavy.opponent} (${repHeavy.why})`);
    c5.examined(1);
    const budgetHeavy = gp.chooseOpponent({ weights: W({ faction_rep: 0.01, hacking_speed: 5, hacking_money: 0.1 }), windowH: 1.3, incumbent: "Daedalus" });
    if (budgetHeavy.opponent !== "Illuminati") c5.fail(`a speed-dominated objective must choose Illuminati, got ${budgetHeavy.opponent} (${budgetHeavy.why})`);
    if (budgetHeavy.refused) c5.fail("a decidable objective must not refuse");

    // THE LIVE SHAPE: eRep 0 against eBudget 0.147 measured 2026-09-21. With
    // reputation weighing nothing, Daedalus — the opponent this repo shipped
    // as a CONSTANT — is the wrong board.
    c5.examined(1);
    const live = gp.chooseOpponent({ weights: { faction_rep: 0, hacking_speed: 0.147, hacking_money: 0.147 }, windowH: 1.31, incumbent: "Daedalus" });
    if (live.opponent === "Daedalus") c5.fail("with faction_rep weighing 0 the constant is not defensible", live.why);

    // Unpriceable channels are refused BY NAME, never scored zero: "not
    // priceable" and "worthless" are different claims.
    c5.examined(1);
    for (const n of ["SlumSnakes", "Netburners", "Tetrads"]) {
      if (gp.PRICEABLE.includes(gp.OPPONENTS[n].channel)) c5.fail(`${n}'s channel ${gp.OPPONENTS[n].channel} is not in RATE_CHANNELS and must not be priceable`);
    }

    // The window is load-bearing: a Go bonus dies at every install, so a
    // SHORTER window mustprice  every opponent lower. If it does not, the reset is
    // not being modelled and the whole comparison is end-of-window value.
    c5.examined(1);
    const short = gp.meanEffect(gp.POWER_PER_HOUR.Daedalus, 1.1, 0.5);
    const long = gp.meanEffect(gp.POWER_PER_HOUR.Daedalus, 1.1, 4);
    if (!(short < long)) c5.fail(`a shorter install window must price lower (0.5h ${short} vs 4h ${long})`);
    // AND IT MUST BE THE AVERAGE, NOT THE ENDPOINT. Both rise with the window,
    // so monotonicity alone passes over a version that scores effect(P*H) —
    // which is what this check did when first mutation-tested, and it is the
    // error that would overstate every opponent and mislead the comparison
    // against augmentations. effect() is concave and increasing from 1, so the
    // mean over [0,H] is strictly BELOW the value at H.
    for (const h of [0.5, 1.3, 4]) {
      c5.examined(1);
      const mean = gp.meanEffect(gp.POWER_PER_HOUR.Daedalus, 1.1, h);
      const end = gp.effectAt(gp.POWER_PER_HOUR.Daedalus * h, 1.1);
      if (!(mean < end * 0.995)) {
        c5.fail(`at ${h}h the window mean (${mean}) must be materially below the end-of-window value (${end}) — otherwise the install reset is not modelled`);
      }
    }
    c5.note(`Daedalus mean multiplier over a window: 0.5h ${short.toFixed(4)}, 1.3h ${gp.meanEffect(gp.POWER_PER_HOUR.Daedalus, 1.1, 1.3).toFixed(4)}, 4h ${long.toFixed(4)}`);

    // go.js must actually consult it, and must not switch mid-life for free.
    const src = read("go.js");
    c5.examined(1);
    if (!/chooseOpponent\(/.test(src)) c5.fail("go.js does not call chooseOpponent — the opponent is a constant again");
    if (/resetBoardState\(flags\.opponent/.test(src)) c5.fail("go.js still resets the board against the startup FLAG rather than the priced opponent");
    if (!/banked \+\$\{bonusPct/.test(src) && !/bonusPct > 1/.test(src)) {
      c5.fail("go.js does not guard against switching while the incumbent has banked power — nodePower is per opponent and a switch discards it");
    }
  }
  checks.push(c5);

  return checks;
}
