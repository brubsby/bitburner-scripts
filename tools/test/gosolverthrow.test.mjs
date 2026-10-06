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
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO } from "./ram.mjs";

async function solverOnce(faults) {
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
  const child = spawn(process.execPath, [path.join(REPO, "tools/go-solver.mjs"), "--maxms", "150", "--poll", "40", "--rpc", `http://127.0.0.1:${port}/rpc`, "--katago-remote", "none", "--ponder-cap-ms", "500", "--no-book", "--fault-session", String(faults)], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, KATAGO_DIR: "/nonexistent-katago" } });
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
    return { reply: pushed[0] ?? null, stderr };
  } finally {
    child.kill();
    server.close();
  }
}

export async function run() {
  const c1 = new Check("GT1", "a model session that throws once: stack + request logged, the request re-searched on a fresh session (backend model)");
  const c2 = new Check("GT2", "a session that throws on the retry too: uct answers and the reply names the throw");
  {
    const { reply, stderr } = await solverOnce(1);
    c1.examined(4);
    if (!reply) c1.fail("no reply", stderr.slice(-300));
    else {
      if (reply.backend !== "model") c1.fail(`one throw must not cost the model search: backend ${reply.backend}`, JSON.stringify(reply));
      if (!/model session threw/.test(reply.retried ?? "")) c1.fail("the reply must name the retried throw", JSON.stringify(reply));
    }
    if (!/model session threw \(#1\):[\s\S]*\n\s+at /.test(stderr)) c1.fail("the throw's STACK must be on stderr", stderr.slice(0, 400));
    const m = stderr.match(/the request is in (\S+)/);
    if (!m || !fs.existsSync(m[1]) || JSON.parse(fs.readFileSync(m[1], "utf8")).req?.seq !== 1) c1.fail("the request that threw must be dumped to a file", m?.[1]);
  }
  {
    const { reply, stderr } = await solverOnce(2);
    c2.examined(2);
    if (!reply) c2.fail("no reply", stderr.slice(-300));
    else {
      if (reply.backend !== "uct") c2.fail(`two throws: uct must answer, got ${reply.backend}`);
      if (!/model session threw/.test(reply.fallback ?? "")) c2.fail("the reply must name the throw as its fallback", JSON.stringify(reply));
    }
  }
  return [c1, c2];
}
