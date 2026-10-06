// [GT] A model session that THROWS is diagnosable and does not cost the move.
//
// Live (daemon log, 7 times before 2026-10-06 07:46Z): "go-solver: seq=…
// model -> uct: model session threw: TypeError: Cannot read properties of
// undefined (reading 'length')" — the move then fell to the minimax uct
// search, which can lose the game, and the log held only the message.
//
//   GT1 one throw: the stack and the request are logged (stderr + a dump
//       file), the session is rebuilt and the SAME request is searched again
//       by the model — the reply says backend "model" and names the retry.
//   GT2 a throw on the retry too: uct answers and the reply names why.
// The throw is injected (--fault-session K) at the session's first step.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO } from "./ram.mjs";

async function solverOnce(faults, { notice = 0 } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gothrow-"));
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
  const child = spawn(process.execPath, [path.join(REPO, "tools/go-solver.mjs"), "--maxms", "150", "--poll", "40", "--rpc", `http://127.0.0.1:${port}/rpc`, "--katago-remote", "none", "--ponder-cap-ms", "500", "--no-book", "--fault-session", String(faults), "--fault-notice", String(notice)], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, KATAGO_DIR: "/nonexistent-katago", TMPDIR: tmp } });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  try {
    const board = [".....", ".....", ".....", ".....", "....."];
    const valid = [];
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) valid.push([x, y]);
    files.set("/go/req.txt", JSON.stringify({ seq: 1, size: 5, komi: 5.5, backend: "model", opponent: "Tetrads", board, valid, history: [], turnS: 1.2 }));
    const t0 = Date.now();
    while (Date.now() - t0 < 20000 && !pushed.length) await new Promise((r) => setTimeout(r, 30));
    await new Promise((r) => setTimeout(r, 100));
    if (notice && pushed[0] && !pushed[0].pass) {
      // A NOTICE: go.js played a move on the board after the AI's reply; then a request.
      const put = (bd, x, y, c) => bd.map((col, i) => (i === x ? col.slice(0, y) + c + col.slice(y + 1) : col));
      const after = put(board, pushed[0].x, pushed[0].y, "X");
      const ai = valid.find(([x, y]) => after[x][y] === ".");
      const b2 = put(after, ai[0], ai[1], "O");
      const v2 = valid.filter(([x, y]) => b2[x][y] === ".");
      files.set("/go/req.txt", JSON.stringify({ seq: 2, size: 5, komi: 5.5, backend: "model", opponent: "Tetrads", board: b2, valid: v2, history: [after.join(""), board.join("")], turnS: 1.2, played: { x: v2[0][0], y: v2[0][1] } }));
      await new Promise((r) => setTimeout(r, 1200));
      const b3 = put(b2, v2[0][0], v2[0][1], "X");
      const v3 = v2.slice(1);
      files.set("/go/req.txt", JSON.stringify({ seq: 3, size: 5, komi: 5.5, backend: "model", opponent: "Tetrads", board: b3, valid: v3, history: [b2.join(""), after.join(""), board.join("")], turnS: 1.2 }));
      const t1 = Date.now();
      while (Date.now() - t1 < 20000 && !pushed.find((m) => m.seq === 3)) await new Promise((r) => setTimeout(r, 30));
    }
    return { reply: pushed[0] ?? null, third: pushed.find((m) => m.seq === 3) ?? null, stderr, tmp };
  } finally {
    child.kill();
    server.close();
  }
}
const cleanup = (t) => fs.rmSync(t, { recursive: true, force: true });

export async function run() {
  const c1 = new Check("GT1", "a model session that throws once: stack + request logged, the request re-searched on a fresh session (backend model)");
  const c2 = new Check("GT2", "a session that throws on the retry too: uct answers and the reply names the throw");
  {
    const { reply, stderr, tmp } = await solverOnce(1);
    c1.examined(4);
    if (!reply) c1.fail("no reply", stderr.slice(-300));
    else {
      if (reply.backend !== "model") c1.fail(`one throw must not cost the model search: backend ${reply.backend}`, JSON.stringify(reply));
      if (!/model session threw/.test(reply.retried ?? "")) c1.fail("the reply must name the retried throw", JSON.stringify(reply));
    }
    if (!/request seq=1 model session threw \(#1\):[\s\S]*\n\s+at /.test(stderr)) c1.fail("the throw's STACK must be on stderr", stderr.slice(0, 400));
    const m = stderr.match(/the request is in (\S+)/);
    if (!m || !fs.existsSync(m[1]) || JSON.parse(fs.readFileSync(m[1], "utf8")).req?.seq !== 1) c1.fail("the request that threw must be dumped to a file", m?.[1]);
    cleanup(tmp);
  }
  {
    const { reply, stderr, tmp } = await solverOnce(2);
    cleanup(tmp);
    c2.examined(2);
    if (!reply) c2.fail("no reply", stderr.slice(-300));
    else {
      if (reply.backend !== "uct") c2.fail(`two throws: uct must answer, got ${reply.backend}`);
      if (!/model session threw/.test(reply.fallback ?? "")) c2.fail("the reply must name the throw as its fallback", JSON.stringify(reply));
    }
  }
  const c3 = new Check("GT3", "a NOTICE whose session throws: stack + request logged, re-rooted on a fresh session, the next request answered by the model");
  {
    const { third, stderr, tmp } = await solverOnce(0, { notice: 1 });
    c3.examined(4);
    if (!/notice seq=2 model session threw \(#1\):[\s\S]*\n\s+at /.test(stderr)) c3.fail("the notice's throw must be logged with its stack", stderr.slice(0, 400));
    if (!fs.readdirSync(tmp).some((f) => f.startsWith("go-solver-throw-"))) c3.fail("the notice's request must be dumped");
    if (!/notice seq=2 re-rooted on a fresh session/.test(stderr)) c3.fail("the notice must be retried on a fresh session", stderr.slice(-300));
    if (!third || third.backend !== "model") c3.fail("the request after a failed notice must be answered by the model", JSON.stringify(third));
    cleanup(tmp);
  }
  return [c1, c2, c3];
}
