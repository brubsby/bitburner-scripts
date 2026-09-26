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
    // The per-game write goes through goHealth (which also folds in the move
    // watchdog and timer throttling), and goHealth must take the solver's
    // verdict as an input — checked behaviourally in GO6, textually here.
    c2.examined(1);
    if (!/const h = goHealth\(\{ solver, /.test(src) || !/publishAt\(h\.health, \{ \.\.\.gameFields/.test(src)) {
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

  /* ------------------------------------------------------------------ GO6 */
  // THE MOVE WATCHDOG. 2026-09-26: /tel/go.txt froze for 30+ minutes and
  // go.js looked stuck awaiting ns.go.makeMove. It was a hidden tab (Chrome
  // fires chained timers once a minute; the opponent's reply is 7-15 timer
  // hops), but the game source does have reply paths that never resolve the
  // waiter (goAI.ts handleNextTurn's stale-board returns), and a promise that
  // never settles must not stop the farm — or its status file — forever.
  const c6 = new Check("GO6", "a move whose reply never comes is abandoned, reported, and recovered — and slow is not stuck");
  {
    const go = await import("../../go.js");
    const never = new Promise(() => {});

    // Pure helper: a never-settling promise times out after maxTicks slices.
    c6.examined(1);
    let ticked = 0;
    const r = await go.awaitMove(never, { sliceMs: 1, maxTicks: 3, minMs: 0, onTick: () => ticked++ });
    if (r.ok !== false || r.ticks !== 3) c6.fail(`awaitMove on a never-resolving promise must give up after 3 ticks, got ${JSON.stringify(r)}`);
    if (ticked !== 3) c6.fail(`onTick (the heartbeat hook) must run on every slice while waiting, ran ${ticked} times`);

    // Resolution wins, and the value comes through.
    c6.examined(1);
    const ok = await go.awaitMove(new Promise((res) => setTimeout(() => res({ type: "move", x: 1, y: 2 }), 5)), { sliceMs: 1, maxTicks: 1000, minMs: 0 });
    if (!ok.ok || ok.value?.type !== "move") c6.fail(`a reply must be returned, got ${JSON.stringify(ok)}`);

    // An invalid move is the caller's error, not a stall.
    c6.examined(1);
    let threw = null;
    try {
      await go.awaitMove(Promise.reject(new Error("Invalid move")), { sliceMs: 1, maxTicks: 3, minMs: 0 });
    } catch (e) {
      threw = e;
    }
    if (!threw || !/Invalid move/.test(String(threw))) c6.fail("a rejected move promise must be rethrown, not reported as a stall");

    // BOTH conditions: enough ticks is not enough while the wall-clock floor
    // has not passed. This is what stops a burst of fast ticks (a briefly
    // hidden tab aligns timers to 1s, not 60s) from abandoning a live move.
    c6.examined(1);
    // A clock that advances 100ms per reading: one reading at the start, one
    // per tick, so tick t sees t*100ms.
    let fakeNow = 0;
    const floor = await go.awaitMove(never, { sliceMs: 1, maxTicks: 2, minMs: 1000, now: () => (fakeNow += 100) });
    if (floor.ok !== false || floor.ticks !== 10) c6.fail(`with 100ms per tick and a 1000ms floor the watchdog must fire at tick 10, not before; got ${JSON.stringify(floor)}`);

    // The shipped threshold must sit well above the measured reply length in
    // BOTH units: 15 timer hops max (tools/sim/go-aicost.mjs) and ~3s visible.
    c6.examined(1);
    if (!(go.MOVE_WATCH.maxTicks >= 4 * 15)) c6.fail(`MOVE_WATCH.maxTicks ${go.MOVE_WATCH.maxTicks} is under 4x the measured 15-hop worst case — a hidden tab would forfeit games`);
    if (!(go.MOVE_WATCH.minMs >= 20 * 3000)) c6.fail(`MOVE_WATCH.minMs ${go.MOVE_WATCH.minMs} is under 20x a visible-tab reply`);

    // Throttle detection and the combined health word.
    c6.examined(1);
    if (go.throttleHealth(105, 100).throttled) c6.fail("a 105ms sleep for 100ms is not throttling");
    if (go.throttleHealth(1000, 100).throttled) c6.fail("1s alignment (briefly hidden tab) must not be called throttled");
    const thr = go.throttleHealth(60000, 100);
    if (!thr.throttled || !/hidden/.test(thr.detail ?? "")) c6.fail("a 60s sleep for 100ms must be reported as a hidden, throttled tab", JSON.stringify(thr));
    const okSolver = { health: "ok", detail: null };
    const badSolver = { health: "warn", detail: "solver X" };
    if (go.goHealth({ solver: okSolver }).health !== "ok") c6.fail("nothing wrong must be 'ok'");
    if (go.goHealth({ solver: badSolver }).detail !== "solver X") c6.fail("the solver's warning must survive goHealth");
    if (go.goHealth({ solver: okSolver, throttle: thr }).health !== "warn") c6.fail("throttled timers must be a warn");
    const stall = go.goHealth({ solver: okSolver, moveStalls: 1, lastStallAt: 1000, now: 2000 });
    if (stall.health !== "warn" || !/reset/.test(stall.detail ?? "")) c6.fail("a recent stall must be a warn that says the board was reset", JSON.stringify(stall));
    if (go.goHealth({ solver: okSolver, moveStalls: 1, lastStallAt: 0, now: 2 * 3600e3 }).health !== "ok") c6.fail("a stall two hours ago must not fail every check for the rest of the life");
  }
  checks.push(c6);

  /* ------------------------------------------------------------------ GO7 */
  // The same, end to end through main() against a mock ns: the first
  // makeMove never resolves. go.js must NOT wait forever — it must log, put
  // the stall in /tel/go.txt as health 'warn' with a count, reset the board,
  // and go on to finish a game.
  const c7 = new Check("GO7", "go.js main(): a never-resolving makeMove triggers the watchdog, is published, and the farm recovers");
  {
    const go = await import("../../go.js");
    const saved = { ...go.MOVE_WATCH };
    Object.assign(go.MOVE_WATCH, { sliceMs: 1, maxTicks: 5, minMs: 0 });
    const writes = [];
    const prints = [];
    const calls = { reset: 0, makeMove: 0 };
    const empty = [".....", ".....", ".....", ".....", "....."];
    const ns = {
      flags: () => ({ size: 5, maxms: 5, idle: 1, topk: 8, remotems: 0, games: 1, opponent: "Daedalus" }),
      disableLog() {},
      tprint: (m) => prints.push(String(m)),
      print: (m) => prints.push(String(m)),
      getResetInfo: () => ({ lastAugReset: 1, currentNode: 1, ownedSF: new Map() }),
      getHostname: () => "home",
      scp() {},
      read: () => "",
      fileExists: () => false,
      atExit() {},
      write: (file, data) => writes.push({ file, data }),
      sleep: () => new Promise((r) => setTimeout(r, 0)),
      exec: () => 0,
      isRunning: () => false,
      go: {
        analysis: {
          getStats: () => ({ Daedalus: { wins: 1, losses: 0, winStreak: 1, highestWinStreak: 1, bonusPercent: 0.5 } }),
          getValidMoves: () => Array.from({ length: 5 }, () => new Array(5).fill(true)),
        },
        resetBoardState: () => {
          calls.reset++;
        },
        getGameState: () => ({ komi: 5.5, blackScore: 10, whiteScore: 5.5 }),
        getBoardState: () => empty,
        // First move: the reply never comes. Afterwards: the game ends.
        makeMove: () => (calls.makeMove++ === 0 ? new Promise(() => {}) : Promise.resolve({ type: "gameOver", x: null, y: null })),
        passTurn: () => Promise.resolve({ type: "gameOver", x: null, y: null }),
      },
    };
    let finished = false;
    try {
      await Promise.race([
        go.main(ns).then(() => (finished = true)),
        new Promise((_, rej) => setTimeout(() => rej(new Error("main() did not return within 10s — the watchdog did not fire")), 10000)),
      ]);
    } catch (e) {
      c7.fail(String(e.message ?? e));
    } finally {
      Object.assign(go.MOVE_WATCH, saved);
    }
    const tel = writes.filter((w) => w.file === "/tel/go.txt").map((w) => JSON.parse(w.data));
    const stalledWrite = tel.find((t) => t.moveStalls === 1 && t.health === "warn");
    c7.examined(tel.length);
    if (!finished) c7.fail("main() never finished its one game — the stranded move blocked the farm");
    if (!stalledWrite) c7.fail("/tel/go.txt never carried moveStalls: 1 with health 'warn'", JSON.stringify(tel.map((t) => [t.health, t.moveStalls])));
    if (!/MOVE STALL/.test(stalledWrite?.detail ?? "") && !(stalledWrite?.errors ?? []).some((e) => /MOVE STALL/.test(e))) {
      c7.fail("the stall record must name itself (MOVE STALL) in errors");
    }
    if (!prints.some((p) => /MOVE STALL/.test(p))) c7.fail("the stall was not logged");
    if (calls.reset < 2) c7.fail(`the board must be reset to recover (then again for the next game); resetBoardState ran ${calls.reset} time(s)`);
    const last = tel[tel.length - 1];
    if (last?.games !== 1) c7.fail(`after recovering, the next game must complete and publish; last write says games=${last?.games}`);
    c7.note(`${tel.length} status writes; resets ${calls.reset}; makeMove calls ${calls.makeMove}; final health '${last?.health}' moveStalls ${last?.moveStalls}`);
  }
  checks.push(c7);

  /* ------------------------------------------------------------------ GO8 */
  // A status write that fails twice must not be silent (status.js publish).
  const c8 = new Check("GO8", "status.publish logs when both its writes fail, instead of returning false into the void");
  {
    const { publish } = await import("../../status.js");
    const printed = [];
    const origErr = console.error;
    const consoled = [];
    console.error = (m) => consoled.push(String(m));
    let r;
    try {
      r = publish({ write: () => { throw new Error("disk says no"); }, print: (m) => printed.push(String(m)) }, "/tel/x.txt", { health: "ok" });
    } finally {
      console.error = origErr;
    }
    c8.examined(1);
    if (r !== false) c8.fail(`publish must still return false on failure, got ${r}`);
    if (!printed.some((p) => /FAILED TWICE.*\/tel\/x\.txt.*disk says no/.test(p))) c8.fail("the double failure did not reach the script log", JSON.stringify(printed));
    if (!consoled.some((p) => /FAILED TWICE/.test(p))) c8.fail("the double failure did not reach the console");
    c8.examined(1);
    let threw = false;
    console.error = () => {};
    try {
      publish({ write: () => { throw new Error("no"); }, print: () => { throw new Error("no log either"); } }, "/tel/x.txt", {});
    } catch {
      threw = true;
    } finally {
      console.error = origErr;
    }
    if (threw) c8.fail("publish must never throw, even when the log is gone too");
  }
  checks.push(c8);

  return checks;
}
