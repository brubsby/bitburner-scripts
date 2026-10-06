// [GR] Go release 3: the solver-versioned posterior, Thompson over opponent x
// board size (power per second), resume-never-forfeit, the per-game log, and
// the pieces the solver and go.js trade (pre-sent answers, the power
// objective, the AI's clock-seeded RNG).
//
//   GR1 the posterior keeps evidence PER SOLVER VERSION: the live 2026-10-04
//       state (Illuminati@5 5.3W/22.4L from the old uct solver) reads as the
//       prior at the current version; a uct fallback never overwrites the
//       model's evidence; age halves evidence every halfLifeH.
//   GR2 the arm posterior: priors reproduce the study's power/h; live black
//       and seconds move the means; the draw's mean is the posterior's
//       power; an arm with no measurement is not offered.
//   GR3 chooseOpponent over arms: value-based (weight x dlnE/dn x drawn
//       power), returns the arm and its size, dwell hysteresis per arm.
//   GR4 go.js main() on a mock game: plays the chosen arm's SIZE, publishes
//       arm / arms / armHistory, folds the game into the arm's posterior at
//       the solver's version with its black and seconds, writes the per-game
//       log; a game in progress is RESUMED, not reset.
//   GR5 the pure helpers: presentAnswer, trimGameLog, solverWaitBudgetMs;
//       golib powerObjective / streakMultiplier against the game's rules;
//       seedCalib; the never-risk-the-win guard.
//   GR6 go-solver end to end: release and top 3 in replies, /go/ponder.txt
//       published while pondering, a notice taken without a reply, the seed
//       lag calibrated from the replies the next requests reveal.
//   GR7 play-on after the AI's pass is per opponent (SETTINGS.mirror); so is
//       the AI's seed clock (SETTINGS.clock: requests carry the playtime T).

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO } from "./ram.mjs";
import "./gameresolve.mjs";

export async function run() {
  const checks = [];
  const gp = await import(path.join(REPO, "goplan.js"));
  const golib = await import(path.join(REPO, "golib.js"));
  const go = await import(path.join(REPO, "go.js"));

  /* ------------------------------------------------------------------ GR1 */
  const c1 = new Check("GR1", "the win-rate posterior is kept per solver version; a stale version's evidence counts for nothing");
  {
    // The live file, 2026-10-04: legacy top-level counts from the uct solver.
    const live = { v: 1, arms: { "Illuminati@5": { w: 5.3, l: 22.4, games: 40, at: "2026-10-03T12:00:00Z" } } };
    const cur = gp.armVersion("model");
    const legacy = gp.posteriorOf(live, "Illuminati", 5);
    const now = gp.posteriorOf(live, "Illuminati", 5, { ver: cur });
    c1.examined(2);
    if (!(legacy.mean < 0.6)) c1.fail(`the legacy read must still see the stale counts (mean ${legacy.mean.toFixed(3)})`);
    if (Math.abs(now.mean - gp.WIN_RATE.Illuminati) > 0.005) c1.fail(`at the current version the stale arm must stand on its prior ${gp.WIN_RATE.Illuminati}, got ${now.mean.toFixed(3)}`);
    c1.note(`Illuminati@5: legacy mean ${legacy.mean.toFixed(3)} -> at ${cur} ${now.mean.toFixed(3)} (prior ${gp.WIN_RATE.Illuminati})`);
    // A game at the current version is evidence; a fallback's game is its own.
    let st = gp.updatePosterior(live, "Illuminati", 5, false, 1, "2026-10-04T12:00:00Z", cur, { black: 7, seconds: 14 });
    st = gp.updatePosterior(st, "Illuminati", 5, false, 1, "2026-10-04T12:01:00Z", "uct-r3", { black: 3, seconds: 20 });
    const p1 = gp.posteriorOf(st, "Illuminati", 5, { ver: cur });
    c1.examined(3);
    if (Math.abs(p1.n - 1) > 1e-9) c1.fail(`one game at ${cur} must be one unit of evidence (the uct fallback's is separate), got n=${p1.n}`);
    if (st.arms["Illuminati@5"].games !== 42) c1.fail(`the raw games count must count every game (42), got ${st.arms["Illuminati@5"].games}`);
    if (st.arms["Illuminati@5"].byVer["uct-r3"]?.l !== 1) c1.fail("the fallback's loss must be kept under its own version");
    // Age: one half-life halves the evidence.
    const t0 = Date.parse("2026-10-04T12:01:00Z");
    const aged = gp.posteriorOf(st, "Illuminati", 5, { ver: cur, now: t0 + gp.THOMPSON.halfLifeH * 3600e3 });
    c1.examined(1);
    if (Math.abs(aged.n - 0.5) > 0.02) c1.fail(`evidence one half-life old must count half, got n=${aged.n.toFixed(3)}`);
    // The version string the solver's reply names.
    c1.examined(3);
    if (gp.solverVersion({ backend: "model", mode: "session", release: "r3" }) !== cur) c1.fail(`solverVersion(model session r3) must equal armVersion('model') = ${cur}`);
    if (gp.solverVersion(null) !== "local") c1.fail("no reply (the local fallback) must be version 'local'");
    if (gp.solverVersion({ backend: "katago" , release: "r3" }) !== gp.armVersion("katago")) c1.fail("a KataGo reply must match armVersion('katago')");
    // Without a version the old behaviour is exact (GT1 relies on it).
    const old = gp.updatePosterior(gp.emptyPosterior(), "Tetrads", 5, true);
    c1.examined(1);
    if (old.arms["Tetrads@5"].w !== 1 || old.arms["Tetrads@5"].byVer) c1.fail("updatePosterior without a version must keep the pre-release-3 top-level counts");
  }
  checks.push(c1);

  /* ------------------------------------------------------------------ GR2 */
  const c2 = new Check("GR2", "the arm posterior: power per second from win rate, black won/lost and seconds; live games move it");
  {
    // Priors reproduce the study's power/h (go-study-report, 85ms pipeline) within 8%.
    const expect = [
      ["Tetrads", 5, 23991, "model"],
      ["Illuminati", 5, 125180, "model"],
      ["Daedalus", 7, 12767, "katago"],
      ["Tetrads", 9, 11347, "katago"],
      ["Netburners", 13, 4086, "uct"],
    ];
    for (const [name, size, pph, backend] of expect) {
      c2.examined(1);
      const pr = gp.armPrior(name, size, true);
      if (!pr) { c2.fail(`${name}@${size} must be offered`); continue; }
      if (pr.backend !== backend) c2.fail(`${name}@${size}: best measured backend is ${backend}, got ${pr.backend}`);
      // 5x5 priors use WIN_RATE (pooled over every model arm: Tetrads 0.956,
      // where the play-on arm won 30/30), which moves the figure up to ~13%.
      const tol = size === 5 ? 0.15 : 0.08;
      if (Math.abs(pr.pph / pph - 1) > tol) c2.fail(`${name}@${size}: prior power/h ${Math.round(pr.pph)} vs the study's ${pph}`);
    }
    c2.examined(2);
    if (gp.armPrior("SlumSnakes", 13, true) !== null) c2.fail("an unmeasured arm (Slum Snakes 13x13) must not be offered");
    if (gp.armPrior("Tetrads", 13, false) !== null) c2.fail("Tetrads 13x13 was measured on KataGo only: without an engine it must not be offered");
    // Live evidence moves the means: 20 games at 24 black, 10s each.
    const ver = gp.armVersion("model");
    let st = gp.emptyPosterior();
    for (let i = 0; i < 20; i++) st = gp.updatePosterior(st, "Tetrads", 5, true, 1, "2026-10-04T12:00:00Z", ver, { black: 24, seconds: 10 });
    const post = gp.armPosterior(st, "Tetrads", 5, { now: null });
    const prior = gp.armPosterior(gp.emptyPosterior(), "Tetrads", 5, { now: null });
    c2.examined(3);
    if (!(post.bw.m > 20 && post.bw.m < 24)) c2.fail(`20 won games at 24 black must pull the mean toward 24 (prior ${prior.bw.m.toFixed(1)}), got ${post.bw.m.toFixed(2)}`);
    if (!(post.s.m < prior.s.m)) c2.fail("shorter live games must lower the seconds-per-game mean");
    if (!(post.powerPerHour > prior.powerPerHour * 1.3)) c2.fail(`more area in less time must raise the arm's power/h (prior ${Math.round(prior.powerPerHour)}, now ${Math.round(post.powerPerHour)})`);
    // The draws centre on the posterior.
    let seed = 7;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let sum = 0;
    const K = 4000;
    for (let i = 0; i < K; i++) sum += gp.armDraw(post, rng).pps;
    const meanPph = (3600 * sum) / K;
    c2.examined(1);
    if (Math.abs(meanPph / post.powerPerHour - 1) > 0.08) c2.fail(`the draws' mean power/h ${Math.round(meanPph)} must sit on the posterior's ${Math.round(post.powerPerHour)}`);
    c2.note(`Tetrads@5 prior ${Math.round(prior.powerPerHour)}/h -> after 20 games at 24 black/10s ${Math.round(post.powerPerHour)}/h; draws mean ${Math.round(meanPph)}`);
  }
  checks.push(c2);

  /* ------------------------------------------------------------------ GR3 */
  const c3 = new Check("GR3", "chooseOpponent over arms: value-based, returns the arm and its size, dwell hysteresis per arm");
  {
    const W = { faction_rep: 1, hacking_speed: 1, hacking_money: 1, combat: 1, hacknet_node_money: 1 };
    const NP = { Daedalus: 100, Illuminati: 100, TheBlackHand: 100, SlumSnakes: 100, Netburners: 100, Tetrads: 100 };
    const arms = { "Tetrads@5": { pph: 16000, p: 0.95 }, "Tetrads@13": { pph: 30000, p: 1 }, "Daedalus@5": { pph: 100, p: 1 } };
    const r = gp.chooseOpponent({ weights: W, windowH: 2, incumbent: "Tetrads", incumbentArm: "Tetrads@5", nodePower: NP, arms });
    c3.examined(3);
    if (r.arm !== "Tetrads@13" || r.size !== 13 || r.opponent !== "Tetrads") c3.fail(`the higher-paying arm must win: got ${r.arm} (${r.why})`);
    // Value, not raw power: an opponent whose channel weighs 0 is never chosen.
    const r2 = gp.chooseOpponent({ weights: { ...W, combat: 0 }, windowH: 2, incumbent: "Daedalus", incumbentArm: "Daedalus@5", nodePower: NP, arms });
    if (r2.opponent === "Tetrads") c3.fail(`with combat weighing 0 Tetrads must not be chosen however much it pays (${r2.why})`);
    // Concavity: an opponent with huge banked power prices lower per unit.
    const r3 = gp.chooseOpponent({ weights: W, windowH: 2, incumbent: "Tetrads", incumbentArm: "Tetrads@5", nodePower: { ...NP, Tetrads: 1e9 }, arms: { "Tetrads@13": { pph: 30000, p: 1 }, "Daedalus@5": { pph: 20000, p: 1 } } });
    c3.examined(1);
    if (r3.arm !== "Daedalus@5") c3.fail(`marginal pricing: a saturated opponent must yield to a fresh one (${r3.arm})`);
    // Dwell: a marginally better arm does not displace the incumbent's block.
    const r4 = gp.chooseOpponent({ weights: W, windowH: 2, incumbent: "Tetrads", incumbentArm: "Tetrads@5", nodePower: NP, dwellH: 0.05, arms: { "Tetrads@5": { pph: 16000, p: 0.95 }, "Tetrads@9": { pph: 16000, p: 0.95 } } });
    c3.examined(1);
    if (r4.arm !== "Tetrads@5") c3.fail(`an equal arm must not displace the incumbent over the dwell (${r4.arm}: ${r4.why})`);
  }
  checks.push(c3);

  /* ------------------------------------------------------------------ GR4 */
  const c4 = new Check("GR4", "go.js main(): plays the arm's size, publishes the arm fields, logs each game, resumes a game in progress");
  {
    const runMain = async ({ inProgress = false, games = 2 } = {}) => {
      const files = new Map();
      const resets = [];
      const board = (n) => Array.from({ length: n }, () => ".".repeat(n));
      let B = board(5);
      let player = inProgress ? "Black" : "None";
      const stats = {};
      let cur = "Tetrads";
      const st = (who) => (stats[who] ??= { wins: 10, losses: 0, winStreak: 10, highestWinStreak: 10, bonusPercent: 1 });
      st("Tetrads");
      const ns = {
        flags: () => ({ size: 5, maxms: 5, idle: 1, topk: 8, remotems: 0, games, opponent: "Tetrads", pin: false }),
        disableLog() {},
        tprint() {},
        print() {},
        getResetInfo: () => ({ lastAugReset: 1, currentNode: 1, ownedSF: new Map(), ownedAugs: new Map() }),
        getHostname: () => "home",
        scp() {},
        read: (f) => files.get(f) ?? "",
        fileExists: () => false,
        atExit() {},
        write: (f, data, mode) => {
          files.set(f, mode === "a" ? (files.get(f) ?? "") + data : data);
          if (f === "/go/req.txt") {
            const q = JSON.parse(data);
            const [x, y] = q.valid?.[0] ?? [0, 0];
            files.set("/go/move.txt", JSON.stringify({ seq: q.seq, x, y, backend: q.backend ?? "uct", mode: q.backend === "model" ? "session" : undefined, release: "r3", top: [[x, y, 0.9, 10, 1]] }));
          }
        },
        sleep: () => new Promise((r) => setTimeout(r, 0)),
        exec: () => 0,
        isRunning: () => false,
        go: {
          analysis: {
            getStats: () => JSON.parse(JSON.stringify(stats)),
            getValidMoves: () => B.map((c) => [...c].map(() => true)),
          },
          resetBoardState: (who, size) => {
            resets.push([who, size]);
            cur = who;
            st(who);
            B = board(size);
            player = "Black";
          },
          getGameState: () => ({ komi: 5.5, blackScore: 20, whiteScore: 5.5, previousMove: [0, 0], currentPlayer: player }),
          getBoardState: () => B,
          getMoveHistory: () => (inProgress ? [board(5)] : []),
          getCurrentPlayer: () => player,
          getOpponent: () => "Tetrads",
          makeMove: () => {
            st(cur).wins++;
            st(cur).winStreak++;
            player = "None";
            inProgress = false;
            return Promise.resolve({ type: "gameOver", x: null, y: null });
          },
          passTurn: () => Promise.resolve({ type: "gameOver", x: null, y: null }),
          opponentNextTurn: () => Promise.resolve({ type: "move", x: 1, y: 1 }),
        },
      };
      await Promise.race([go.main(ns), new Promise((_, rej) => setTimeout(() => rej(new Error("main() did not finish in 30s")), 30000))]);
      return { files, resets };
    };
    try {
      const { files, resets } = await runMain({ games: 3 });
      const tel = JSON.parse(files.get("/tel/go.txt") ?? "null");
      c4.examined(4);
      if (!tel?.arm || !/^[A-Za-z0-9_]+@\d+$/.test(tel.arm)) c4.fail(`/tel/go.txt must carry the arm being played ('name@size'), got ${tel?.arm}`);
      if (!tel?.arms || !tel.arms["Tetrads@5"] || typeof tel.arms["Tetrads@5"].powerPerHour !== "number") c4.fail("/tel/go.txt must carry per-arm {mean, sd, games, powerPerHour, drawn}", JSON.stringify(tel?.arms?.["Tetrads@5"]));
      if (!Array.isArray(tel?.armHistory)) c4.fail("/tel/go.txt must carry armHistory");
      for (const [who, size] of resets) if (![5, 7, 9, 13].includes(size)) c4.fail(`resetBoardState must get an arm's size, got ${size} for ${who}`);
      const sizesPlayed = new Set(resets.map((r) => r[1]));
      c4.note(`arm ${tel?.arm}; sizes reset to ${[...sizesPlayed]}; Tetrads@5 ${JSON.stringify(tel?.arms?.["Tetrads@5"])}`);
      // The posterior: versioned, with black and seconds.
      const post = JSON.parse(files.get(gp.THOMPSON.file) ?? "null");
      const someArm = Object.values(post?.arms ?? {})[0];
      const recs = someArm?.byVer ? Object.entries(someArm.byVer) : [];
      c4.examined(1);
      if (!recs.length || !recs.some(([v]) => /-r3$/.test(v))) c4.fail("each game must be folded into the posterior under the solver's version (…-r3)", JSON.stringify(post));
      else if (!recs.some(([, r]) => r.bw?.[0] > 0 && r.s?.[0] > 0)) c4.fail("each game must carry its black and seconds into the arm's posterior", JSON.stringify(recs));
      // The per-game log.
      const lines = (files.get("/tel/go-games.txt") ?? "").split("\n").filter(Boolean);
      c4.examined(1);
      if (lines.length !== 3) c4.fail(`one /tel/go-games.txt line per game (3), got ${lines.length}`);
      else {
        const g = JSON.parse(lines[0]);
        for (const k of ["opponent", "size", "start", "moves", "black", "white", "won", "streakBefore", "streakAfter", "power", "seconds", "ver"]) if (!(k in g)) c4.fail(`the game record must carry '${k}'`, lines[0]);
        if (!g.moves?.[0]?.t) c4.fail("a solver-answered move must log the search's top 3", lines[0]);
      }
      // RESUME: a game in progress (moves on the board) is continued, not reset.
      const r2 = await runMain({ inProgress: true, games: 1 });
      const tel2 = JSON.parse(r2.files.get("/tel/go.txt") ?? "null");
      c4.examined(2);
      if (r2.resets.length) c4.fail(`a game in progress must be RESUMED, never reset (a reset forfeits it); resetBoardState ran ${r2.resets.length}x`);
      if (tel2?.resumed !== 1) c4.fail(`/tel/go.txt must count the resumed game, got resumed=${tel2?.resumed}`);
      const g2 = JSON.parse((r2.files.get("/tel/go-games.txt") ?? "").split("\n").filter(Boolean)[0] ?? "null");
      if (g2?.resumed !== true) c4.fail("the resumed game's record must say resumed: true");
    } catch (e) {
      c4.fail(String(e?.stack ?? e).slice(0, 400));
    }
  }
  checks.push(c4);

  /* ------------------------------------------------------------------ GR5 */
  const c5 = new Check("GR5", "pure helpers: pre-sent match, log trim, priced solver wait, the power objective, the seed calibration, never risk the win");
  {
    const B = ["X....", ".....", "..O..", ".....", "....."];
    const valid = B.map((c) => [...c].map((ch) => ch === "."));
    const text = JSON.stringify({ answers: [{ b: B.join(""), pc: 0, x: 1, y: 1 }, { b: B.join(""), pc: 1, pass: true }] });
    c5.examined(5);
    const a = go.presentAnswer(text, B, valid, false);
    if (a.answer?.x !== 1 || a.answer?.y !== 1) c5.fail("a pre-sent answer for this exact board and pass state must be played", JSON.stringify(a));
    if (go.presentAnswer(text, B, valid, true).answer?.pass !== true) c5.fail("the pass state is part of the key (after the AI's pass, its own entry)");
    const other = ["X....", ".....", "..O..", ".....", "....X"];
    const m = go.presentAnswer(text, other, valid, false);
    if (m.answer || !m.had) c5.fail("a different board must miss (had: true, answer: null)", JSON.stringify(m));
    const v2 = valid.map((c) => c.slice());
    v2[1][1] = false;
    if (go.presentAnswer(text, B, v2, false).answer) c5.fail("an answer the game's valid list forbids (superko) must not be played");
    if (go.presentAnswer("garbage", B, valid, false).answer) c5.fail("an unreadable file must not be played");
    c5.examined(1);
    const log = Array.from({ length: 7 }, (_, i) => `{"i":${i}}`).join("\n") + "\n";
    const t = go.trimGameLog(log, 3).split("\n").filter(Boolean);
    if (t.length !== 3 || t[0] !== '{"i":4}') c5.fail(`trimGameLog must keep the LAST keep lines, got ${JSON.stringify(t)}`);
    // The wait is priced: a streak at the plateau is worth waiting for; a dry streak is not.
    const objHi = golib.powerObjective({ streak: 50, komi: 5.5, size: 5, eBlack: 16, rate: 4.45 });
    const objLo = golib.powerObjective({ streak: -3, komi: 5.5, size: 5, eBlack: 16, rate: 4.45 });
    const hi = go.solverWaitBudgetMs({ objective: objHi, eBlack: 16, ratePerS: 4.45, localLoss: 0.5, capMs: 180000 });
    const lo = go.solverWaitBudgetMs({ objective: objLo, eBlack: 16, ratePerS: 4.45, localLoss: 0.5, capMs: 180000 });
    c5.examined(2);
    if (!(hi > lo && hi > 10000)) c5.fail(`a long streak must buy a longer wait than a dry one (${hi} vs ${lo} ms)`);
    if (go.solverWaitBudgetMs({ objective: objHi, eBlack: 16, ratePerS: 4.45, localLoss: 0.5, capMs: 180000, waitedMs: hi + 1 }) !== 0) c5.fail("a game that already waited its budget must not wait more");
    // The power objective against the game's streak rules (effect.ts:119-130).
    c5.examined(4);
    if (golib.streakMultiplier(8, 7) !== 3 || golib.streakMultiplier(1, -4) !== 3 || golib.streakMultiplier(-1, 5) !== 0.5) c5.fail("streakMultiplier must match effect.ts");
    // At the plateau a loss costs the ramp back: 1.5+1.5+1.25+1+0.75+0.5+0.25 = 6.75 multiplier-games.
    if (Math.abs(objHi.lossFuture - 6.75 * 16 * 1.5) > 1e-9) c5.fail(`lossFuture at the plateau must be 6.75 x eBlack x diff, got ${objHi.lossFuture}`);
    if (Math.abs(objHi.turnCost - 4.45 * 1.2) > 1e-9) c5.fail("turnCost must be rate x turnS");
    if (golib.difficultyMultiplier(7.5, 5) !== 8) c5.fail("5x5 Illuminati pays difficulty 8");
    // The seed calibration converges on the lag it is shown.
    const cal = golib.seedCalib();
    for (let i = 0; i < 30; i++) cal.observe([2, 5]);
    for (let i = 0; i < 30; i++) cal.observe([2]);
    c5.examined(2);
    if (cal.weights()[0][0] !== 2) c5.fail(`seedCalib must learn k=2, weights ${JSON.stringify(cal.weights().slice(0, 3))}`);
    if (cal.observe([-1, 0, 1, 2, 3, 4, 5, 6])) c5.fail("a reply every k reproduces says nothing and must be skipped");
    // NEVER RISK THE WIN: after the AI's pass, with PASS a certain win, a stone
    // whose line sometimes loses is refused even when its mean is higher.
    const N = 5;
    const won = ["XXXXX", "XXXXX", "XX...", "XX...", "XX.O."];
    const risky = {
      reply: async (b) => {
        // White captures nothing but always answers; a 50/50 the search sees as a coin.
        for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if (b[x][y] === ".") return Math.random() < 0.5 ? { x, y } : null;
        return null;
      },
    };
    const s = golib.modelSession(N, 5.5, risky, { objective: golib.powerObjective({ streak: 50, komi: 5.5, size: 5, eBlack: 16, rate: 4.45 }) });
    const vgrid = won.map((c) => [...c].map((ch) => ch === "."));
    s.setRoot(won, vgrid, { history: [], opponentPassed: true });
    await s.search({ maxms: 60 });
    const best = s.best();
    const top = best?.[0]?.top ?? [];
    c5.examined(1);
    const stoneTop = top.find(([x]) => x >= 0);
    if (best && best.length && stoneTop && stoneTop[4] < golib.SAFE_CONTINUE) c5.fail(`a stone whose line wins only ${stoneTop[4]} must not replace a winning PASS`, JSON.stringify(top));
    c5.examined(1);
    if (!/passNode\.terminal && passNode\.tw === 1 && stone && stone\.visits && stone\.wins \/ stone\.visits < SAFE_CONTINUE\) return \[\]/.test(fs.readFileSync(path.join(REPO, "golib.js"), "utf8"))) c5.fail("golib bestOf must refuse a stone below SAFE_CONTINUE when PASS ends the game won");
    c5.note(`after the AI's pass, winning PASS vs stones: chose ${best && best.length ? `${best[0].x},${best[0].y}` : "PASS"}; top ${JSON.stringify(top)}`);
  }
  checks.push(c5);

  /* ------------------------------------------------------------------ GR6 */
  // The solver end to end against a stub bridge (never the live daemon): a
  // model request names release r3 and its top 3; pondering publishes
  // /go/ponder.txt; a NOTICE (`played`) is taken without a reply and the
  // solver ponders on; with `T` in the requests the seed lag is calibrated
  // from the AI replies the next request reveals.
  const c6 = new Check("GR6", "go-solver end to end: release + top 3 in replies, /go/ponder.txt published, a notice re-roots without a reply, the seed calibrated");
  {
    const http = await import("node:http");
    const { spawn } = await import("node:child_process");
    const files = new Map();
    const pushed = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        const { method, params } = JSON.parse(body || "{}");
        if (method === "getFile") res.end(JSON.stringify({ result: files.get(params.filename) ?? null }));
        else if (method === "pushFile") {
          files.set(params.filename, params.content);
          if (params.filename === "/go/move.txt") pushed.push(JSON.parse(params.content));
          res.end(JSON.stringify({ result: "OK" }));
        } else res.end(JSON.stringify({ error: "unknown" }));
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    const child = spawn(process.execPath, [path.join(REPO, "tools/go-solver.mjs"), "--maxms", "150", "--poll", "40", "--rpc", `http://127.0.0.1:${port}/rpc`, "--katago-remote", "none", "--ponder-cap-ms", "1500"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, KATAGO_DIR: "/nonexistent-katago" } });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    const { loadModel } = await import(path.join(REPO, "tools/goai/model.mjs"));
    const model = await loadModel();
    const validOf = (b) => model.validMoves(b, []);
    const put = (x, y, ch, b) => b.map((c, i) => (i === x ? c.slice(0, y) + ch + c.slice(y + 1) : c));
    const wait = async (pred, ms = 30000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const v = pred();
        if (v) return v;
        await new Promise((r) => setTimeout(r, 30));
      }
      return null;
    };
    try {
      const T = 5e9;
      let board = [".....", ".....", ".....", ".....", "....."];
      const base = { size: 5, komi: 5.5, backend: "model", opponent: "Tetrads", turnS: 1.2 };
      files.set("/go/req.txt", JSON.stringify({ seq: 1, ...base, board, valid: validOf(board), history: [], T }));
      const a = await wait(() => pushed.find((m) => m.seq === 1));
      c6.examined(3);
      if (!a) throw new Error(`no reply to seq 1: ${stderr.slice(-300)}`);
      if (a.release !== "r3") c6.fail(`the reply must name release r3, got ${a.release}`);
      if (!Array.isArray(a.top) || !a.top.length) c6.fail("the reply must carry the search's top 3", JSON.stringify(a));
      // The AI replies (as the game would, seeded at T + 200), then a pondered answer must appear.
      const after = put(a.x, a.y, "X", board);
      const r = await model.reply(after, { opponent: "Tetrads", history: [board.join("")], passCount: 0, rng: T + 200 });
      const next = r ? put(r.x, r.y, "O", after) : after;
      const pon = await wait(() => {
        try {
          const p = JSON.parse(files.get("/go/ponder.txt") ?? "null");
          return p?.answers?.length ? p : null;
        } catch {
          return null;
        }
      }, 8000);
      c6.examined(1);
      if (!pon) c6.fail("while pondering, the solver must publish pre-sent answers to /go/ponder.txt");
      const hit = pon?.answers?.find((e) => e.b === next.join("") && e.pc === 0);
      // Play a NOTICE for the AI's actual reply position: either the pre-sent answer or any legal point.
      const vNext = validOf(next);
      const mv = hit && !hit.pass ? [hit.x, hit.y] : vNext[0];
      const movesBefore = pushed.length;
      files.set("/go/req.txt", JSON.stringify({ seq: 2, ...base, board: next, valid: vNext, history: [after.join(""), board.join("")], T: T + 1400, played: { x: mv[0], y: mv[1] } }));
      await new Promise((res) => setTimeout(res, 600));
      c6.examined(1);
      if (pushed.length !== movesBefore) c6.fail("a notice must NOT be answered (go.js already played)", JSON.stringify(pushed.slice(movesBefore)));
      // The next real request (after the AI's reply to the noticed move) is answered.
      const after2 = put(mv[0], mv[1], "X", next);
      const r2 = await model.reply(after2, { opponent: "Tetrads", history: [next.join(""), after.join(""), board.join("")], passCount: 0, rng: T + 1400 + 200 });
      const third = r2 ? put(r2.x, r2.y, "O", after2) : after2;
      files.set("/go/req.txt", JSON.stringify({ seq: 3, ...base, board: third, valid: validOf(third), history: [after2.join(""), next.join(""), after.join(""), board.join("")], T: T + 2800, opponentPassed: !r2 }));
      const c = await wait(() => pushed.find((m) => m.seq === 3));
      c6.examined(2);
      if (!c) c6.fail("the request after a notice must be answered", stderr.slice(-300));
      else {
        if (c.mode !== "session") c6.fail("the session search must answer", JSON.stringify(c));
        const obs = (c.seed?.req?.observed ?? 0) + (c.seed?.pre?.observed ?? 0);
        if (obs < 2) c6.fail(`with T in the requests the seed lag must be observed for both replies, got ${JSON.stringify(c.seed)}`);
        c6.note(`hit on the pre-sent answers: ${!!hit}; reply 3 ${JSON.stringify({ x: c.x, y: c.y, pondered: c.pondered, seed: c.seed })}`);
        // A RETIME (go.js, the clock on): reply 3 was played at T + 3000; the
        // solver re-anchors its ponder there, answers nothing, and the next
        // request's reply is calibrated on the pre path from that T.
        if (!c.pass) {
          const preObs = c.seed?.pre?.observed ?? 0;
          const before4 = pushed.length;
          files.set("/go/req.txt", JSON.stringify({ seq: 4, retime: true, T: T + 3000, turnS: 1.2, opponent: "Tetrads", size: 5 }));
          await new Promise((res) => setTimeout(res, 400));
          c6.examined(1);
          if (pushed.length !== before4) c6.fail("a retime must NOT be answered", JSON.stringify(pushed.slice(before4)));
          const after3 = put(c.x, c.y, "X", third);
          const hist3 = [third.join(""), after2.join(""), next.join(""), after.join(""), board.join("")];
          const r3 = await model.reply(after3, { opponent: "Tetrads", history: hist3, passCount: 0, rng: T + 3000 + 200 });
          const fourth = r3 ? put(r3.x, r3.y, "O", after3) : after3;
          files.set("/go/req.txt", JSON.stringify({ seq: 5, ...base, board: fourth, valid: model.validMoves(fourth, [after3.join(""), ...hist3]), history: [after3.join(""), ...hist3], T: T + 4400, opponentPassed: !r3 }));
          const e = await wait(() => pushed.find((m) => m.seq === 5));
          c6.examined(2);
          if (!e) c6.fail("the request after a retime must be answered", stderr.slice(-300));
          else {
            if (e.seed?.retimes !== 1) c6.fail(`the retime must be taken (seed.retimes 1), got ${JSON.stringify(e.seed)}`);
            if ((e.seed?.pre?.observed ?? 0) !== preObs + 1) c6.fail(`after a retime the AI's reply is calibrated on the PRE path (observed ${preObs} -> ${e.seed?.pre?.observed})`);
          }
        }
      }
    } catch (e) {
      c6.fail(String(e?.message ?? e).slice(0, 300));
    } finally {
      child.kill();
      server.close();
    }
  }
  checks.push(c6);

  /* ------------------------------------------------------------------ GR7 */
  // PLAY-ON per opponent (release 3b): after the AI's pass while ahead, an
  // opponent with SETTINGS.mirror 'search' asks the solver (opponentPassed,
  // with the power objective) and plays what it says; any other opponent
  // passes at once, as release 2 did.
  const c7 = new Check("GR7", "play-on after the AI's pass is per opponent: Tetrads asks the solver (with the power objective), the rest mirror-pass at once");
  {
    const runPinned = async (opponent, { oldSolver = false } = {}) => {
      const files = new Map();
      const reqs = [];
      const retimes = [];
      const calls = { pass: 0, move: 0 };
      const B = [".....", ".....", ".....", ".....", "....."];
      const stats = {};
      const ns = {
        flags: () => ({ size: 5, maxms: 5, idle: 1, topk: 8, remotems: 0, games: 1, opponent, pin: true }),
        disableLog() {},
        tprint() {},
        print() {},
        getResetInfo: () => ({ lastAugReset: 1, currentNode: 1, ownedSF: new Map(), ownedAugs: new Map() }),
        getHostname: () => "home",
        scp() {},
        read: (f) => files.get(f) ?? "",
        fileExists: () => false,
        atExit() {},
        write: (f, data, mode) => {
          files.set(f, mode === "a" ? (files.get(f) ?? "") + data : data);
          if (f === "/go/req.txt") {
            const q = JSON.parse(data);
            // A retime is fire-and-forget (the solver answers nothing).
            if (q.retime) retimes.push({ ...q, afterMoves: calls.move + calls.pass });
            else {
              reqs.push(q);
              files.set("/go/move.txt", JSON.stringify({ seq: q.seq, x: 1, y: 1, backend: "model", mode: "session", release: "r3", ...(oldSolver ? {} : { seed: { retimes: 0 } }) }));
            }
          }
        },
        sleep: () => new Promise((r) => setTimeout(r, 0)),
        exec: () => 0,
        isRunning: () => false,
        go: {
          analysis: { getStats: () => stats, getValidMoves: () => B.map((c) => [...c].map(() => true)) },
          resetBoardState: () => {},
          getGameState: () => ({ komi: 5.5, blackScore: 20, whiteScore: 5.5, previousMove: [0, 0] }),
          getBoardState: () => B,
          getMoveHistory: () => [],
          // First move: the AI passes. The next action ends the game.
          makeMove: () => Promise.resolve(calls.move++ === 0 ? { type: "pass", x: null, y: null } : { type: "gameOver", x: null, y: null }),
          passTurn: () => {
            calls.pass++;
            return Promise.resolve({ type: "gameOver", x: null, y: null });
          },
        },
      };
      await Promise.race([go.main(ns), new Promise((_, rej) => setTimeout(() => rej(new Error("main() did not finish in 30s")), 30000))]);
      return { reqs, retimes, calls, tel: JSON.parse(files.get("/tel/go.txt") ?? "null") };
    };
    // The playtime, as go.js reads it in game (playtimeReader: the webpack
    // module cache's ./src/Player.ts). Restored after: other tests may own window.
    // (Another module may have installed a getter-only window, e.g. jsdom's:
    // then the hook goes on that window object and comes off after.)
    const PLAYTIME = 123456000;
    const hook = { push: ([, , cb]) => cb({ c: { "./src/Player.ts": { exports: { Player: { totalPlaytime: PLAYTIME } } } } }) };
    const ownWindow = typeof globalThis.window !== "object" || globalThis.window === null;
    const oldHook = ownWindow ? undefined : globalThis.window.webpackChunkbitburner;
    if (ownWindow) globalThis.window = { webpackChunkbitburner: hook };
    else globalThis.window.webpackChunkbitburner = hook;
    try {
      const t = await runPinned("Tetrads");
      // SETTINGS.clock per opponent: Tetrads requests carry the AI's seed clock.
      c7.examined(2);
      if (!t.reqs.length || !t.reqs.every((q) => q.T === PLAYTIME)) c7.fail("Tetrads (SETTINGS.clock on): every request carries the playtime T", JSON.stringify(t.reqs.map((q) => q.T)));
      if (t.tel?.clock?.ok !== true) c7.fail("Tetrads: /tel/go.txt clock must read ok", JSON.stringify(t.tel?.clock));
      // ...and every REQUESTED move played is followed by a retime (the play's T).
      c7.examined(1);
      if (t.retimes.length !== t.calls.move || !t.retimes.every((q) => q.T === PLAYTIME && q.opponent === "Tetrads" && q.size === 5 && Number.isFinite(q.turnS))) c7.fail(`Tetrads: each requested move played must send a retime with T (moves ${t.calls.move}, retimes ${t.retimes.length})`, JSON.stringify(t.retimes));
      const afterPass = t.reqs.filter((q) => q.opponentPassed === true);
      c7.examined(4);
      if (afterPass.length !== 1) c7.fail(`Tetrads: after the AI's pass the solver must be asked once with opponentPassed (asked ${afterPass.length}x)`, JSON.stringify(t.reqs.map((q) => [q.seq, q.opponentPassed])));
      if (!t.reqs.every((q) => q.objective?.kind === "power")) c7.fail("Tetrads: play-on brings the power objective into every request");
      // The adaptive budget rides along, scaled by the streak at stake (0 here: no extra).
      if (!t.reqs.every((q) => q.adaptive?.thr === 0.3 && q.adaptive?.mult === 1)) c7.fail("Tetrads: requests carry the adaptive budget scaled by the streak (streak 0 -> mult 1)", JSON.stringify(t.reqs.map((q) => q.adaptive)));
      if (t.calls.move !== 2 || t.calls.pass !== 0) c7.fail(`Tetrads: the solver's stone must be played (moves ${t.calls.move}, passes ${t.calls.pass})`);
      if (t.tel?.playOn?.games !== 1 || t.tel?.playOn?.stones !== 1) c7.fail("Tetrads: /tel/go.txt playOn must count the game and the stone", JSON.stringify(t.tel?.playOn));
      // An older solver (no seed.retimes in its replies) gets no retimes: it
      // would read one as a request it cannot parse and stop pondering.
      const o = await runPinned("Tetrads", { oldSolver: true });
      c7.examined(2);
      if (o.retimes.length) c7.fail("Tetrads against a solver that does not count retimes: no retime may be sent", JSON.stringify(o.retimes));
      if (!o.reqs.length || !o.reqs.every((q) => q.T === PLAYTIME)) c7.fail("Tetrads against an older solver: requests still carry T");
      const d = await runPinned("TheBlackHand");
      c7.examined(3);
      if (d.reqs.some((q) => q.opponentPassed === true)) c7.fail("The Black Hand (mirror 'always'): no solver request after the AI's pass");
      if (d.calls.pass !== 1) c7.fail(`The Black Hand: the AI's pass must be mirrored at once (passTurn ${d.calls.pass}x)`);
      if (d.reqs.some((q) => q.objective)) c7.fail("The Black Hand: the power objective stays off (power.on false, mirror 'always')");
      c7.examined(2);
      const bhClock = go.clockFor("TheBlackHand");
      if (!bhClock && d.retimes.length) c7.fail("The Black Hand (clock off): no retimes", JSON.stringify(d.retimes));
      if (!d.reqs.every((q) => (q.T === PLAYTIME) === bhClock)) c7.fail(`The Black Hand: requests carry T exactly when SETTINGS.clock is on for it (${bhClock})`, JSON.stringify(d.reqs.map((q) => q.T)));
      if ((d.tel?.clock?.ok === true) !== bhClock) c7.fail("The Black Hand: /tel/go.txt clock follows SETTINGS.clock for the opponent being played", JSON.stringify(d.tel?.clock));
    } catch (e) {
      c7.fail(String(e?.stack ?? e).slice(0, 400));
    } finally {
      if (ownWindow) delete globalThis.window;
      else if (oldHook === undefined) delete globalThis.window.webpackChunkbitburner;
      else globalThis.window.webpackChunkbitburner = oldHook;
    }
  }
  checks.push(c7);

  /* ------------------------------------------------------------------ GR8 */
  // CHEATS WITH RELEASE 3 (BN14.2 opens ns.go.cheat): the two-move cheat
  // asks the solver for the second stone on the board after the first (the
  // session re-roots fresh there and ponders under the actual post-cheat
  // position); a pre-sent first stone played as a cheat sends no notice (the
  // second-stone request re-roots the solver instead); never after the AI's
  // pass (play-on prices one stone); per opponent (SETTINGS.cheat.on); and a
  // go-cheat.js left running by a killed go.js is waited out before the board
  // is touched.
  const c8 = new Check("GR8", "cheats with release 3: second-stone request on the board after the first, no notice for a cheated pre-sent move, none after the AI's pass, per opponent, a stray go-cheat.js waited out");
  {
    const place = (b, x, y, c) => b.map((col, i) => (i === x ? col.slice(0, y) + c + col.slice(y + 1) : col));
    const runCheat = async ({ on = true, pre = false, busy = 0 } = {}) => {
      const files = new Map();
      const reqs = [];
      const execs = [];
      const order = [];
      let B = [".....", ".....", ".....", ".....", "....."];
      let turn = 0;
      let left = busy;
      const saved = go.SETTINGS.cheat.on;
      go.SETTINGS.cheat.on = { default: false, Daedalus: on };
      const ns = {
        flags: () => ({ size: 5, maxms: 5, idle: 1, topk: 8, remotems: 0, games: 1, opponent: "Daedalus", pin: true }),
        disableLog() {},
        tprint() {},
        print() {},
        getResetInfo: () => ({ lastAugReset: 1, currentNode: 14, ownedSF: new Map([[14, 1]]), ownedAugs: new Map() }),
        getHostname: () => "home",
        scp() {},
        read: (f) => files.get(f) ?? "",
        fileExists: (f) => f === "go-cheat.js",
        atExit() {},
        write: (f, data, mode) => {
          files.set(f, mode === "a" ? (files.get(f) ?? "") + data : data);
          if (f === "/go/req.txt") {
            const q = JSON.parse(data);
            reqs.push({ ...q, turn });
            if (q.played) return;
            const [x, y] = q.valid?.[0] ?? [0, 0];
            files.set("/go/move.txt", JSON.stringify({ seq: q.seq, x, y, backend: "model", mode: "session", release: "r3" }));
          }
        },
        sleep: () => new Promise((r) => setTimeout(r, 0)),
        exec: (script, host, t, x1, y1, x2, y2) => {
          execs.push({ script, turn, first: [x1, y1], second: [x2, y2], board: B.slice() });
          B = place(place(B, x1, y1, "X"), x2, y2, "X");
          files.set("/tel/go-cheat.txt", JSON.stringify({ at: new Date().toISOString(), cheated: true, reply: "pass", waitedMs: 0, calib: { T: 0, at: Date.now(), p: 0.6 } }));
          return 7;
        },
        isRunning: (a) => {
          if (a === "go-cheat.js") {
            order.push("wait");
            return left-- > 0;
          }
          return false;
        },
        go: {
          analysis: { getStats: () => ({}), getValidMoves: () => B.map((c) => [...c].map((ch) => ch === ".")) },
          resetBoardState: () => order.push("reset"),
          getGameState: () => ({ komi: 5.5, blackScore: 20, whiteScore: 5.5, previousMove: [0, 0] }),
          getBoardState: () => B,
          getMoveHistory: () => [],
          makeMove: (x, y) => {
            turn++;
            B = place(B, x, y, "X");
            if (turn === 1) {
              B = place(B, 4, 4, "O");
              // The ponder's answer for the position the AI's reply makes.
              if (pre) files.set("/go/ponder.txt", JSON.stringify({ answers: [{ b: B.join(""), pc: 0, x: 2, y: 2 }] }));
              return Promise.resolve({ type: "move", x: 4, y: 4 });
            }
            return Promise.resolve({ type: "gameOver", x: null, y: null });
          },
          passTurn: () => Promise.resolve({ type: "gameOver", x: null, y: null }),
        },
      };
      try {
        await Promise.race([go.main(ns), new Promise((_, rej) => setTimeout(() => rej(new Error("main() did not finish in 30s")), 30000))]);
      } finally {
        go.SETTINGS.cheat.on = saved;
      }
      return { reqs, execs, order, tel: JSON.parse(files.get("/tel/go.txt") ?? "null") };
    };
    try {
      const r = await runCheat();
      c8.examined(5);
      if (r.execs.length !== 1) c8.fail(`one cheat expected (turn 2; none on turn 1, none after the AI's pass), ${r.execs.length} exec'd`, JSON.stringify(r.execs));
      else {
        const e = r.execs[0];
        // Turn 2's asks (the third, after the cheat, is the after-pass move).
        const asks = r.reqs.filter((q) => q.turn === 1 && !q.played && !q.opponentPassed);
        // The first request is the position; the second is that position plus the first stone, black to move.
        const want2 = place(e.board, e.first[0], e.first[1], "X").join("");
        if (asks.length !== 2 || asks[0].board.join("") !== e.board.join("") || asks[1].board.join("") !== want2) c8.fail("the second stone must be asked on the board after the first", JSON.stringify(asks.map((q) => q.board)));
        if (asks[1] && asks[1].valid.some(([x, y]) => x === e.first[0] && y === e.first[1])) c8.fail("the second-stone request offered the first stone's point");
        if (e.first.join() === e.second.join()) c8.fail("the cheat's two stones are the same point");
      }
      // After the cheat the AI passed: the next move is the solver's single stone.
      const afterPass = r.reqs.filter((q) => q.opponentPassed === true);
      if (afterPass.length !== 1) c8.fail(`after the AI's pass the solver is asked once with opponentPassed (asked ${afterPass.length}x)`);
      if (r.tel?.cheatsPlayed !== 1 || r.tel?.cheatThisOpponent !== true) c8.fail("/tel/go.txt: cheatsPlayed 1, cheatThisOpponent true", JSON.stringify({ played: r.tel?.cheatsPlayed, on: r.tel?.cheatThisOpponent, why: r.tel?.cheatOffWhy }));

      const p = await runCheat({ pre: true });
      c8.examined(2);
      if (p.execs.length !== 1 || p.execs[0].first.join() !== "2,2") c8.fail("a pre-sent first stone is the cheat's first stone", JSON.stringify(p.execs));
      if (p.reqs.some((q) => q.played)) c8.fail("a pre-sent move played as a cheat must send no notice (the second-stone request re-roots the solver)", JSON.stringify(p.reqs.filter((q) => q.played)));

      const off = await runCheat({ on: false });
      c8.examined(1);
      if (off.execs.length) c8.fail("SETTINGS.cheat.on false for this opponent: no cheat");

      const busy = await runCheat({ busy: 3 });
      c8.examined(1);
      const firstReset = busy.order.indexOf("reset");
      if (busy.order.slice(0, 4).join() !== "wait,wait,wait,wait" || firstReset < 4) c8.fail("a running go-cheat.js must be waited out before the board is reset", busy.order.slice(0, 8).join());
    } catch (e) {
      c8.fail(String(e?.stack ?? e).slice(0, 400));
    }
  }
  checks.push(c8);

  return checks;
}
