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
      [go, /modelReq = \{ backend: 'katago', visits: size >= 19 \? SETTINGS\.bigBoard\.visits : SETTINGS\.arms\.katagoVisits, opponent: gameName\(opponent\), history, fallback: 'uct' \}/, "go.js must ask for katago on the big board and the KataGo arms (with the opponent and history the solver ponders with, and uct as the named fallback)"],
      [go, /useKatago = size >= 19 \? SETTINGS\.bigBoard\.backend === 'katago' \|\| \(SETTINGS\.bigBoard\.backend === 'auto' && !!katagoAvail\?\.ok\) : armBackend === 'katago'/, "go.js must use KataGo on the big board whenever the solver reports an engine (backend 'auto'), and on a 7-13 arm whose measured backend is KataGo"],
      [go, /bigBoard: \{[^\n]*backend: 'auto'/, "SETTINGS.bigBoard.backend must default to 'auto' (the hidden opponent's explore batch plays KataGo once The Red Pill is installed)"],
      [solver, /req\.backend === "katago"/, "go-solver.mjs must serve backend 'katago'"],
      [go, /model: modelHealth\(\{ modelAsked, modelAnswered, modelFallbackWhy \}\)/, "go.js must fold modelHealth into its published health"],
      [solver, /req\.backend === "model"/, "go-solver.mjs must serve backend 'model'"],
      [go, /waited \+= SETTINGS\.replyPollMs\) \{\s*await ns\.sleep\(SETTINGS\.replyPollMs\)/, "go.js must poll the solver's answer at SETTINGS.replyPollMs (the fast pipeline), not a fixed 250ms"],
      [go, /replyPollMs: 25,/, "SETTINGS.replyPollMs must stay 25ms (release 2: 250ms cost ~0.2s a turn)"],
      [solver, /Date\.now\(\) - lastReqAt < 60e3 \? FAST_POLL : POLL/, "go-solver.mjs must poll fast while a game is on"],
      [solver, /MODEL_PONDER = str\("model-ponder", "session"\)/, "go-solver.mjs must default to the session search (release 2)"],
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
    const child = spawn(process.execPath, [path.join(REPO, "tools/go-solver.mjs"), "--maxms", "150", "--poll", "40", "--rpc", `http://127.0.0.1:${port}/rpc`, "--katago-remote", "none", "--no-ponder"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, KATAGO_DIR: "/nonexistent-katago" } });
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
      const k = await ask(4, { backend: "katago", visits: 50, opponent: "Illuminati", history: [], fallback: "model" });
      c5.examined(4);
      if (!k) c5.fail("no reply to a katago request with no engine installed");
      else if (k.backend !== "model" || !/katago unavailable/.test(k.fallback ?? "")) c5.fail("a katago request with no engine must be answered by its named fallback (model) and SAY why", JSON.stringify(k));
      const st = files.get("/go/katago.txt");
      c5.examined(1);
      if (!st) c5.fail("the solver must publish /go/katago.txt (go.js reads it to choose the big board's backend)");
      else {
        const rec = JSON.parse(st);
        if (rec.gpu !== false || rec.cpu !== false || !rec.at) c5.fail("with no remote and no local engine, /go/katago.txt must say gpu:false cpu:false, dated", st);
      }
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
    if (!allowed || allowed.player !== "B" || allowed.untilDepth !== 1 || allowed.moves.join() !== "D4") c6.fail("root must be the game's valid list, less A2 (our point walled by A1 and holes A3/B2), and NO pass while D4 is open (not our territory)", JSON.stringify(allowed));
    // Pass is offered once every legal point is already our territory by the
    // game's rule (an empty region whose non-hole neighbours are all black).
    const settled = ["XX...", "X.X..", "XXX..", "OOOOO", "....."];
    const qs = toQuery(settled, [[1, 1]], 5.5);
    c6.examined(2);
    if (qs.allowMoves[0].moves.join() !== "B2,pass") c6.fail("with only our own territory left (B2), pass must be offered beside it", JSON.stringify(qs.allowMoves[0].moves));
    const { ourTerritory } = await import("../katago/katago.mjs");
    const t = ourTerritory(["X#.", "XX.", "..O"]);
    // board[x][y]: regions {(0,2),(1,2)} and {(2,0),(2,1)} both touch O at (2,2).
    if (t.size !== 0) c6.fail("a region touching a white stone is not our territory", JSON.stringify([...t]));
    const t2 = ourTerritory(["X#.", "XXX", "OOO"]);
    if (!t2.has(0 * 3 + 2) || t2.size !== 1) c6.fail("an empty point bordered only by black and a hole IS our territory (holes are transparent, scoring.ts)", JSON.stringify([...t2]));
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
    const q4 = toQuery(eyeB, [[1, 1]], 7.5);
    c6.examined(1);
    if (q4.allowMoves[0].moves.join() !== "pass") c6.fail("when only hole-bordered eyes are legal, the root must be PASS alone (filling the last eye killed a 128-stone group)", JSON.stringify(q4.allowMoves[0].moves));
    // ipvgoLead: ownership is row-major from the TOP row; holes are skipped.
    const { ipvgoLead } = await import("../katago/katago.mjs");
    // 3x3, board[x][y]; hole at x=0,y=2 (top-left in KataGo's order: index 0).
    const b3 = ["..#", "...", "..."];
    const own = [5, 1, 1, -1, -1, -1, 1, 1, 1]; // index 0 is the hole: must be ignored
    c6.examined(1);
    const lead = ipvgoLead(b3, own, 0.5);
    if (Math.abs(lead - (1 + 1 - 3 + 3 - 0.5)) > 1e-9) c6.fail(`ipvgoLead must sum non-hole ownership minus komi: want 1.5, got ${lead}`);
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

  /* ------------------------------------------------------------------ GM7 */
  // The KataGo service (tools/katago/service.mjs) with stub engines: the GPU
  // first, the CPU engine when the GPU will not start or dies, a ponder hit
  // answered without a new query, a miss terminating the ponders, idle engines
  // closed; and go.js's reading of the solver's /go/katago.txt.
  const c7 = new Check("GM7", "KataGo service: GPU first, CPU fallback, ponder hit/miss, idle close; go.js katagoAvailable");
  {
    const { KataGoService, visitsOn, applyStone } = await import("../katago/service.mjs");
    const queries = [];
    const terminated = [];
    let gpuStarts = 0;
    let gpuFails = false;
    const stub = (where) => {
      let seq = 0;
      let alive = true;
      const e = {
        where,
        startMs: 1,
        alive: () => alive,
        why: () => (alive ? null : "killed"),
        nextId: () => `${where}${++seq}`,
        terminate: (id) => terminated.push(id),
        close: () => (alive = false),
        kill: () => (alive = false),
        analyze: async (board, valid, komi, o) => {
          queries.push({ where, board: board.join("/"), visits: o.visits, id: o.id });
          if (!alive) throw new Error("katago exited");
          const [x, y] = valid[0];
          return { moveInfos: [{ move: "ABCDEFGHJ"[x] + (y + 1), order: 0, visits: o.visits, scoreLead: 1, winrate: 0.9 }] };
        },
      };
      return e;
    };
    let gpuEngine = null;
    const start = async ({ remote }) => {
      if (remote) {
        gpuStarts++;
        if (gpuFails) return null;
        gpuEngine = stub("gpu@stub");
        return gpuEngine;
      }
      return stub("cpu");
    };
    const svc = new KataGoService({ remote: "stub", start, idleMs: 1000, remoteRetryMs: 60e3 });
    const b = [".....", ".....", ".....", ".....", "....."];
    const v = [[2, 2], [1, 1]];
    const r1 = await svc.choose({ size: 5, board: b, valid: v, komi: 5.5, visits: { gpu: 300, cpu: 100 } });
    c7.examined(1);
    if (r1?.where !== "gpu@stub" || r1.x !== 2 || r1.y !== 2) c7.fail("the GPU engine must answer first", JSON.stringify(r1));
    if (queries.at(-1)?.visits !== 300) c7.fail("visits {gpu, cpu} must give the GPU its own count", JSON.stringify(queries.at(-1)));
    // Ponder two positions; a hit is served from the ponder without a new query.
    const b2 = applyStone(b, 2, 2, "X");
    const p1 = applyStone(b2, 1, 1, "O");
    const p2 = applyStone(b2, 3, 3, "O");
    await svc.ponder([{ size: 5, board: p1, valid: [[0, 0]], komi: 5.5, visits: 50 }, { size: 5, board: p2, valid: [[4, 4]], komi: 5.5, visits: 50 }]);
    await svc.pondersSettled();
    const before = queries.length;
    const hit = await svc.choose({ size: 5, board: p1, valid: [[0, 0]], komi: 5.5, visits: 50 });
    c7.examined(2);
    if (hit?.pondered !== "hit" || queries.length !== before) c7.fail("a pondered position must be answered from the ponder, with no new query", JSON.stringify({ hit, q: queries.length - before }));
    // A pondered move that is no longer legal is NOT trusted.
    await svc.ponder([{ size: 5, board: p2, valid: [[4, 4]], komi: 5.5, visits: 50 }]);
    await svc.pondersSettled();
    const stale = await svc.choose({ size: 5, board: p2, valid: [[0, 1]], komi: 5.5, visits: 50 });
    c7.examined(1);
    if (stale?.pondered || stale?.x !== 0 || stale?.y !== 1) c7.fail("a pondered move outside the request's valid list must be recomputed", JSON.stringify(stale));
    // The GPU engine dies: the request is answered by the CPU engine, and the GPU is marked down.
    gpuEngine.kill();
    gpuFails = true;
    const r2 = await svc.choose({ size: 5, board: b, valid: v, komi: 5.5, visits: { gpu: 300, cpu: 100 } });
    c7.examined(2);
    if (r2?.where !== "cpu") c7.fail("with the GPU engine dead, the CPU engine must answer", JSON.stringify(r2));
    if (!(svc.status().remote.downFor > 0) || !svc.status().remote.why) c7.fail("a dead GPU engine must be marked down with its reason", JSON.stringify(svc.status()));
    if (queries.at(-1)?.visits !== 100) c7.fail("the CPU engine must get the cpu visit count");
    // Idle engines close.
    svc.lastUse = Date.now() - 5000;
    for (const e of svc.localEngines.values()) e.lastUse = Date.now() - 5000;
    svc.reapIdle();
    c7.examined(1);
    if (svc.localEngines.size !== 0) c7.fail("an engine idle past idleMs must be closed");
    svc.close();
    c7.examined(1);
    if (visitsOn({ where: "cpu" }, 7) !== 7) c7.fail("a plain visit count applies to every engine");
    // go.js: which /go/katago.txt makes the big board play KataGo.
    const { katagoAvailable } = await import(path.join(REPO, "go.js")).catch(() => ({}));
    if (typeof katagoAvailable !== "function") c7.fail("go.js must export katagoAvailable");
    else {
      const now = Date.parse("2026-10-04T12:00:00Z");
      const at = (min) => new Date(now - min * 60e3).toISOString();
      const cases = [
        [JSON.stringify({ at: at(1), gpu: true, cpu: false }), true],
        [JSON.stringify({ at: at(1), gpu: false, cpu: true }), true],
        [JSON.stringify({ at: at(1), gpu: false, cpu: false }), false],
        [JSON.stringify({ at: at(30), gpu: true, cpu: true }), false],
        ["", false],
        ["{bad", false],
      ];
      for (const [text, ok] of cases) {
        c7.examined(1);
        const r = katagoAvailable(text, now);
        if (r.ok !== ok) c7.fail(`katagoAvailable(${text || "''"}) must be ok=${ok}`, JSON.stringify(r));
        if (!r.ok && !r.why) c7.fail("an unavailable KataGo must say why", text);
      }
    }
  }
  checks.push(c7);

  /* ------------------------------------------------------------------ GM8 */
  // golib.modelSession (release 2): the subtree under the AI's ACTUAL reply
  // becomes the next root (with the visits pondered into it), the AI is shown
  // the right history while we ponder, a position outside the tree is fresh,
  // and a reused root is re-filtered to the game's valid list.
  const c8 = new Check("GM8", "modelSession: tree reuse under the AI's reply, ponder history, valid re-filter");
  {
    const N = 5;
    const validAll = (b) => b.map((col) => [...col].map((c) => c === "."));
    const seen = [];
    // A deterministic AI: plays the first empty point in column-major order.
    const ai = {
      reply: async (board, o) => {
        seen.push(o.history);
        for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if (board[x][y] === ".") return { x, y };
        return null;
      },
    };
    const root = [".....", ".....", ".....", ".....", "....."];
    const s = golib.modelSession(N, 5.5, ai, {});
    const r0 = s.setRoot(root, validAll(root), { history: [] });
    await s.search({ maxms: 3 }); // short, so the reply's subtree keeps untried moves
    const [mv] = s.best();
    s.commit(mv.x, mv.y);
    seen.length = 0;
    await s.ponder(2); // short: the reused root keeps unexpanded (untried) moves
    const after = root.map((c, x) => (x === mv.x ? c.slice(0, mv.y) + "X" + c.slice(mv.y + 1) : c));
    c8.examined(2);
    if (r0?.reused !== false) c8.fail("the first root must be fresh", JSON.stringify(r0));
    // Every model call while pondering sees the board before OUR move as the
    // oldest entry (it moved from the root into the session's history).
    if (!seen.length || seen.some((h) => h.at(-1) !== root.join(""))) c8.fail("while pondering, the AI's history must end with the board before OUR move", JSON.stringify(seen.find((h) => h.at(-1) !== root.join(""))));
    // The AI's actual reply = what ai.reply gives on `after`.
    const rep = await ai.reply(after, { history: [] });
    const next = after.map((c, x) => (x === rep.x ? c.slice(0, rep.y) + "O" + c.slice(rep.y + 1) : c));
    const valid = validAll(next);
    // Forbid one point (as the game's superko would): it must vanish from the root.
    let banned = null;
    for (let x = 0; x < N && !banned; x++) for (let y = 0; y < N; y++) if (valid[x][y]) { banned = [x, y]; break; }
    valid[banned[0]][banned[1]] = false;
    // ...and every other point in the last column, searched or not.
    for (let y = 0; y < N; y++) valid[N - 1][y] = false;
    const r1 = s.setRoot(next, valid, { history: [after.join(""), root.join("")] });
    c8.examined(2);
    if (!r1?.reused || !(r1.visits > 0)) c8.fail("the position after the AI's pondered reply must reuse its subtree, with visits", JSON.stringify(r1));
    c8.examined(1)
    if (s.rootMoves.some(([x, y]) => !valid[x][y])) c8.fail("a reused root must drop every point the game's valid list forbids (searched or not)", JSON.stringify(s.rootMoves))
    await s.search({ maxms: 40 });
    const b1 = s.best();
    if (b1?.[0] && b1[0].x === banned[0] && b1[0].y === banned[1]) c8.fail("a reused root must not offer a point the game's valid list forbids");
    // A position not in the tree is searched fresh.
    s.commit(b1[0].x, b1[0].y);
    const other = ["O....", ".....", ".....", ".....", "....X"];
    const r2 = s.setRoot(other, validAll(other), { history: [] });
    c8.examined(1);
    if (r2?.reused !== false || r2.visits !== 0) c8.fail("a position outside the ponder tree must be fresh", JSON.stringify(r2));
  }
  checks.push(c8);

  return checks;
}
