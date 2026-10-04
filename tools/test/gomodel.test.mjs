// [GM] The opponent-model Go search: the model is the game's opponent, the
// search uses it correctly, and a run without it SAYS so.
//
// WHY. golib.chooseMoveModel searches against the game's own getMove (bundled
// from source by tools/goai) instead of a minimax phantom; on 5x5 Illuminati
// that took the headless win rate from 28% to ~90% (tools/sim/go-w0.mjs). Three
// things can quietly undo it, and each has a check here:
//
//   GM1 modelHealth() fires when model requests are answered by the uct
//       fallback (no bundle, no game source, a throw) — and each branch is
//       SEEN to differ from the healthy answer.
//   GM2 chooseMoveModel's contract: the model is asked about the board AFTER
//       black's candidate (column-major strings, black 'X'), with the root
//       board at the head of `history`; it does not pass while behind when a
//       pass ends the game; it does pass to end a won game.
//   GM3 The bundled model reproduces the game's getMove reply for reply (same
//       position, history, WHRNG seed and Math.random stream). Skipped with a
//       WARN, never a pass, if the game source/bundle is unavailable.
//   GM4 Wiring: go.js asks for the model with opponent + history on small
//       boards and counts what answered; go-solver.mjs serves `backend:
//       'model'` and names its fallback.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO } from "./ram.mjs";
import "./gameresolve.mjs";

const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

export async function run() {
  const checks = [];
  const { modelHealth } = await import("../../go.js");
  const golib = await import("../../golib.js");

  /* ------------------------------------------------------------------ GM1 */
  const c1 = new Check("GM1", "modelHealth() warns when the model backend is not what answered");
  {
    const cases = [
      { o: { modelAsked: 0, modelAnswered: 0 }, health: "ok", why: "nothing asked" },
      { o: { modelAsked: 9, modelAnswered: 0 }, health: "ok", why: "under the 10-request threshold" },
      { o: { modelAsked: 10, modelAnswered: 0, modelFallbackWhy: "no bundle" }, health: "warn", why: "every request fell back" },
      { o: { modelAsked: 40, modelAnswered: 10 }, health: "warn", why: "a quarter answered by the model" },
      { o: { modelAsked: 40, modelAnswered: 30 }, health: "ok", why: "model answering" },
    ];
    for (const { o, health, why } of cases) {
      c1.examined(1);
      const r = modelHealth(o);
      if (r.health !== health) c1.fail(`modelHealth(${JSON.stringify(o)}) should be '${health}' (${why}), got '${r.health}'`);
      if (health === "warn" && !r.detail) c1.fail(`a warn must name the problem; ${JSON.stringify(o)} gave no detail`);
    }
    c1.examined(1);
    const w = modelHealth({ modelAsked: 12, modelAnswered: 1, modelFallbackWhy: "tools/goai opponent model could not be built" });
    if (!/could not be built/.test(w.detail ?? "")) c1.fail("the warn must quote the solver's stated fallback reason", w.detail);
    if (!/goai/.test(w.detail ?? "")) c1.fail("the warn must point at tools/goai", w.detail);
  }
  checks.push(c1);

  /* ------------------------------------------------------------------ GM2 */
  const c2 = new Check("GM2", "chooseMoveModel asks the model about the right board and passes only when that wins");
  {
    const N = 5;
    const validAll = (b) => b.map((col) => [...col].map((c) => c === "."));
    // (a) What the model is shown. Root: one white stone, black to play.
    const root = [".....", ".....", "..O..", ".....", "....."];
    const calls = [];
    const fake = {
      reply: async (board, o) => {
        calls.push({ board, ...o });
        return null; // white passes
      },
    };
    await golib.chooseMoveModel(root, validAll(root), N, 7.5, 60, {}, fake);
    c2.examined(calls.length);
    if (!calls.length) c2.fail("the model was never consulted");
    const first = calls.find((c) => c.history?.length === 1);
    if (!first) c2.fail("no first-level model call carried a one-board history (the root board)", JSON.stringify(calls[0]).slice(0, 200));
    else {
      if (first.history[0] !== root.join("")) c2.fail("history[0] must be the ROOT board as the game stores it (simple board joined, column-major)", first.history[0]);
      const blacks = first.board.join("").split("X").length - 1;
      const whites = first.board.join("").split("O").length - 1;
      if (blacks !== 1 || whites !== 1) c2.fail(`the model must see the board AFTER black's candidate (1 X, 1 O); saw ${blacks} X, ${whites} O`, first.board.join("/"));
      if (!Array.isArray(first.board) || first.board.length !== N || first.board[0].length !== N) c2.fail("the model's board must be N column strings of length N");
      if (first.passCount !== 0) c2.fail(`after a black stone passCount must be 0, got ${first.passCount}`);
    }

    // (b) Behind, and the opponent just passed: our pass ENDS the game and
    // loses, so the search must play a stone. White owns the left, black a
    // sliver; komi 7.5.
    const behind = ["OOOOO", ".....", "XXXXX", ".....", "....."];
    const passer = { reply: async () => null };
    const rb = await golib.chooseMoveModel(behind, validAll(behind), N, 7.5, 150, { opponentPassed: true }, passer);
    c2.examined(1);
    if (!rb || !rb.length) c2.fail("behind with the opponent passed, the search passed — that ends the game lost", JSON.stringify(rb));

    // (b2) The root rule itself, each branch seen to differ.
    const rule = [
      [{ passMean: 0.3, passVisits: 900, stoneMean: 0.1, stoneVisits: 50 }, false, "lost either way: a 'least bad' pass hands white free moves"],
      [{ passMean: 0.95, passVisits: 900, stoneMean: 0.97, stoneVisits: 50 }, false, "a stone is valued higher"],
      [{ passMean: 0.97, passVisits: 900, stoneMean: 0.95, stoneVisits: 50 }, true, "passing wins and is the most visited"],
      [{ passMean: 0.99, passVisits: 10, stoneMean: 0.9, stoneVisits: 900 }, true, "passing wins and is clearly better"],
      [{ passMean: 0.91, passVisits: 10, stoneMean: 0.905, stoneVisits: 900 }, false, "marginally better on few visits"],
      [{ passMean: 0.2, passVisits: 1, stoneMean: null, stoneVisits: -1 }, true, "no stone at all"],
    ];
    for (const [o, want, why] of rule) {
      c2.examined(1);
      if (golib.modelRootPasses(o) !== want) c2.fail(`modelRootPasses(${JSON.stringify(o)}) should be ${want}: ${why}`);
    }

    // (c) Ahead, the opponent passed, and a white pair still capturable. Passing
    // ends the game won at 20/25 area; against an opponent that keeps passing,
    // playing on captures the pair and banks more area (node power credits
    // black's area, scoring.ts:85-88). The search must see the difference:
    // its value for the stone exceeds the pass's exact 0.9 + 0.1 * 20/25.
    // (go.js mirror-passes BEFORE asking when ahead, so this is the search's
    // own valuation under test, not the live pass policy.)
    const ahead = ["XXXX.", "X..XX", "X...X", "XXXXX", "..OO."];
    const ra = await golib.chooseMoveModel(ahead, validAll(ahead), N, 7.5, 150, { opponentPassed: true }, passer);
    c2.examined(1);
    if (!ra || !ra.length || !(ra[0].value > 0.98)) c2.fail("ahead with a capturable pair, the search should play on at a value above passing (0.98)", JSON.stringify(ra));
  }
  checks.push(c2);

  /* ------------------------------------------------------------------ GM3 */
  const c3 = new Check("GM3", "the bundled opponent model reproduces the game's getMove reply for reply");
  {
    let r = null;
    let why = null;
    try {
      const { fidelity } = await import("../goai/fidelity.mjs");
      r = await fidelity({ games: 2, size: 5, opponents: ["Illuminati", "Daedalus", "Tetrads", "TheBlackHand", "Netburners", "SlumSnakes"], seed: 11 });
      if (!r) why = "tools/goai could not build or load the model bundle";
    } catch (e) {
      why = `fidelity run threw: ${String(e?.message ?? e).slice(0, 200)}`;
    }
    if (why) c3.warn(`model fidelity NOT CHECKED: ${why}`, "the solver will fall back to uct for model requests; go.js modelHealth will warn");
    else {
      c3.examined(r.calls);
      if (r.calls < 50) c3.fail(`only ${r.calls} replies compared — too few to mean anything`);
      if (r.mismatches) c3.fail(`${r.mismatches} of ${r.calls} replies differ from the game's getMove`, r.examples.join("\n"));
      c3.note(`${r.calls} replies, ${r.mismatches} mismatches; model ${r.modelMsPerCall.toFixed(2)}ms/call vs game bundle ${r.gameMsPerCall.toFixed(2)}ms/call`);
    }
  }
  checks.push(c3);

  /* ------------------------------------------------------------------ GM4 */
  const c4 = new Check("GM4", "go.js requests the model with opponent and history; the solver serves and names it");
  {
    const go = read("go.js");
    const solver = read("tools/go-solver.mjs");
    const needles = [
      [go, /backend: 'model', opponent: gameName\(opponent\), history/, "go.js must send backend 'model' with the game's opponent name and the move history"],
      [go, /ns\.go\.getMoveHistory\(\)/, "go.js must read the history from ns.go.getMoveHistory (0GB)"],
      [go, /reply\.backend === wantBackend\) modelAnswered\+\+/, "go.js must count which backend answered"],
      [go, /modelReq = \{ backend: 'katago', visits: SETTINGS\.bigBoard\.visits \}/, "go.js must ask for katago on the big board when SETTINGS.bigBoard.backend says so"],
      [solver, /req\.backend === "katago"/, "go-solver.mjs must serve backend 'katago'"],
      [go, /model: modelHealth\(\{ modelAsked, modelAnswered, modelFallbackWhy \}\)/, "go.js must fold modelHealth into its published health"],
      [solver, /req\.backend === "model"/, "go-solver.mjs must serve backend 'model'"],
      [solver, /move\.backend = backend/, "go-solver.mjs must say which backend answered"],
      [solver, /move\.fallback = fallback/, "go-solver.mjs must name why a model request fell back"],
    ];
    for (const [src, re, msg] of needles) {
      c4.examined(1);
      if (!re.test(src)) c4.fail(msg);
    }
  }
  checks.push(c4);

  /* ------------------------------------------------------------------ GM5 */
  // End to end: the real solver process against a stub bridge (never the live
  // daemon — two solvers would race on /go/req.txt). A model request is
  // answered by the model; a model request it cannot serve is answered by uct
  // WITH the reason; a legacy request (no backend) is answered by uct.
  const c5 = new Check("GM5", "go-solver.mjs end to end: backend 'model' served, its fallback named");
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
    const child = spawn(process.execPath, [path.join(REPO, "tools/go-solver.mjs"), "--maxms", "150", "--poll", "40", "--rpc", `http://127.0.0.1:${port}/rpc`], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    const board = ["....#", ".....", "..O..", ".....", "....."];
    const valid = [];
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) if (board[x][y] === ".") valid.push([x, y]);
    const ask = async (seq, extra) => {
      files.set("/go/req.txt", JSON.stringify({ seq, size: 5, komi: 7.5, board, valid, ...extra }));
      const t0 = Date.now();
      while (Date.now() - t0 < 30000) {
        const got = pushed.find((m) => m.seq === seq);
        if (got) return got;
        await new Promise((r) => setTimeout(r, 50));
      }
      return null;
    };
    try {
      const a = await ask(1, { backend: "model", opponent: "Illuminati", history: [] });
      const b = await ask(2, { backend: "model" });
      const l = await ask(3, {});
      c5.examined(3);
      if (!a) c5.fail("no reply to a model request within 30s", stderr.slice(-400));
      else {
        if (a.backend !== "model") c5.fail(`a model request was answered by '${a.backend}' (fallback: ${a.fallback})`, stderr.slice(-400));
        if (!a.pass && !valid.some(([x, y]) => x === a.x && y === a.y)) c5.fail(`the model backend replied with an illegal point ${a.x},${a.y}`);
      }
      if (!b) c5.fail("no reply to an unservable model request");
      else if (b.backend !== "uct" || !/no opponent/.test(b.fallback ?? "")) c5.fail("a model request without an opponent must be answered by uct and SAY why", JSON.stringify(b));
      if (!l) c5.fail("no reply to a legacy (backend-less) request");
      else if (l.backend !== "uct" || l.fallback) c5.fail("a legacy request must be answered by uct with no fallback note", JSON.stringify(l));
      c5.note(`replies: ${JSON.stringify(a)} | ${JSON.stringify(b)} | ${JSON.stringify(l)}`);
    } finally {
      child.kill();
      server.close();
    }
  }
  checks.push(c5);

  /* ------------------------------------------------------------------ GM6 */
  // The KataGo mapping (tools/katago/katago.mjs toQuery) is pure and decides
  // what KataGo thinks the board is. Holes become WHITE stones (never ours —
  // that would hand our groups fake liberties), komi drops by the hole stones
  // sent, a hole group with no liberty is dropped, the root is restricted to
  // the game's valid list (+ pass), coordinates are board[x][y] -> COLS[x], y+1.
  const c6 = new Check("GM6", "the KataGo position mapping: holes white, komi offset, root restricted to the game's valid list");
  {
    const { toQuery, fromVertex } = await import("../katago/katago.mjs");
    // x=0 column "X.#.." : black A1, hole A3; x=1 ".##O." : holes B2,B3, white B4;
    // x=4 "####." : a 4-hole group with liberty E5? no — E5 is '.', so it has one.
    // x=2 "#X..." with C1 hole bordered by B1('.') -> has liberty.
    const board = ["X.#..", ".##O.", "#X...", ".....", "####."];
    const valid = [[0, 1], [3, 3]];
    const q = toQuery(board, valid, 7.5, { visits: 50 });
    const st = new Map(q.initialStones.map(([c, v]) => [v, c]));
    c6.examined(q.initialStones.length);
    if (st.get("A1") !== "B") c6.fail("black stone at board[0][0] must be B A1", JSON.stringify(q.initialStones));
    if (st.get("B4") !== "W") c6.fail("white stone at board[1][3] must be W B4");
    for (const h of ["A3", "B2", "B3", "C1", "E1", "E2", "E3", "E4"]) if (st.get(h) !== "W") c6.fail(`hole ${h} must be sent as a WHITE stone`);
    if ([...st.values()].filter((c) => c === "B").length !== 2) c6.fail("only real black stones may be black");
    if (q.komi !== 7.5 - 8) c6.fail(`komi must drop by the 8 hole stones sent: want -0.5, got ${q.komi}`);
    const allowed = q.allowMoves?.[0];
    if (!allowed || allowed.player !== "B" || allowed.untilDepth !== 1 || allowed.moves.join() !== "D4,pass") c6.fail("root must be the game's valid list plus pass, less A2 (our point walled by A1 and holes A3/B2)", JSON.stringify(allowed));
    if (q.rules.scoring !== "AREA" || q.rules.ko !== "POSITIONAL" || q.rules.suicide !== false || q.rules.friendlyPassOk !== false) c6.fail("rules must be area/positional/no-suicide/no friendly pass", JSON.stringify(q.rules));
    // A hole group with no liberty is dropped and does not move komi.
    const sealed = ["#X...", "X....", ".....", ".....", "....."];
    const q2 = toQuery(sealed, [], 5.5);
    c6.examined(1);
    if (q2.initialStones.some(([, v]) => v === "A1")) c6.fail("a hole with no liberty must not be sent (KataGo would read it as captured)");
    if (q2.komi !== 5.5) c6.fail(`no hole sent, komi must be unchanged: got ${q2.komi}`);
    c6.examined(2);
    const v = fromVertex("D4");
    if (v.x !== 3 || v.y !== 3) c6.fail(`fromVertex('D4') must be {x:3,y:3}, got ${JSON.stringify(v)}`);
    if (!fromVertex("pass").pass) c6.fail("fromVertex('pass') must be a pass");
    // An eye of ours that borders a hole is withheld from the root.
    const eyeB = ["X#...", "X.X..", "XXX..", ".....", "....."];
    const q3 = toQuery(eyeB, [[1, 1], [3, 3]], 7.5);
    c6.examined(1);
    if (q3.allowMoves[0].moves.includes("B2")) c6.fail("B2 (our eye, bordered by a hole) must not be offered to KataGo — it fills it to 'capture' the hole");
    if (!q3.allowMoves[0].moves.includes("D4")) c6.fail("ordinary moves must stay allowed");
    const { pickMove } = await import("../katago/katago.mjs");
    const P = (move, order, scoreLead, visits = 10) => ({ move, order, scoreLead, visits });
    c6.examined(3);
    if (pickMove([P("pass", 0, 5), P("D4", 1, 4.5)]).move !== "D4") c6.fail("a free stone (within the margin) must be played over KataGo's pass");
    if (pickMove([P("pass", 0, 5), P("D4", 1, 2)]).move !== "pass") c6.fail("a costly stone must not overrule a real pass");
    if (pickMove([P("C3", 0, 1), P("pass", 1, 9)]).move !== "C3") c6.fail("KataGo's own stone choice stands");
    const j = fromVertex("J1");
    if (j.x !== 8) c6.fail(`GTP skips 'I': J is column 8, got ${j.x}`);
  }
  checks.push(c6);

  return checks;
}
