// [UP] THE UCT PONDER (tools/go-uct-ponder.mjs + go-solver.mjs, 2026-11-13).
//
// Under the one-core budget the uct arms (7x7 Tetrads live) idled the core
// through every AI reply (~1.2s of a ~2s turn). The ponder searches our
// answer to the AI's predicted reply in a worker meanwhile; these pin what
// makes it safe under the cap and correct:
//   UP1 chooseMoveUCT stops on opts.abort (another thread's flag) — at once.
//   UP2 a finished ponder answers its own board ("hit"), a valid move.
//   UP3 a request on another board cancels a running ponder at once and
//       frees the worker (no second search shares the core).
//   UP4 a request on the board being pondered waits for that search ("partial").
//   UP5 retarget (the retime) keeps a running search the new prediction still
//       wants first, and drops one it does not.
//   UP6 end to end: a 7x7 uct request carrying the opponent gets
//       `uctPonder: true`; after the RETIME, a request on the board the AI's
//       own code plays at the retime's seed is answered from the ponder.
//   UP7 go.js's live A/B alternates its variants in blocks, on its arm only.
//   UP8 KataGo stays off (go.js SETTINGS.katago) and 9x9 is priced on uct.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO } from "./ram.mjs";
// go.js (UP7) imports with Netscript bare specifiers.
import "./gameresolve.mjs";

const N = 7;
const empty = () => Array.from({ length: N }, () => ".".repeat(N));
const allValid = (b) => {
  const v = [];
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if (b[x][y] === ".") v.push([x, y]);
  return v;
};
const grid = (b) => b.map((col) => [...col].map((c) => c === "."));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const put = (bd, x, y, c) => bd.map((col, i) => (i === x ? col.slice(0, y) + c + col.slice(y + 1) : col));

async function solverRun(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gouct-"));
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
  const child = spawn(process.execPath, [path.join(REPO, "tools/go-solver.mjs"), "--maxms", "300", "--poll", "40", "--rpc", `http://127.0.0.1:${port}/rpc`, "--no-katago", "--no-book"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, KATAGO_DIR: "/nonexistent-katago", TMPDIR: tmp } });
  let stderr = "";
  let stdout = "";
  child.stderr.on("data", (d) => (stderr += d));
  child.stdout.on("data", (d) => (stdout += d));
  const waitSeq = async (seq, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const m = pushed.find((p) => p.seq === seq);
      if (m) return m;
      await sleep(10);
    }
    return null;
  };
  try {
    return await fn({ files, pushed, waitSeq, logs: () => ({ stderr, stdout }) });
  } finally {
    child.kill();
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export async function run() {
  const { chooseMoveUCT } = await import(path.join(REPO, "golib.js"));
  const { UctPonder } = await import(path.join(REPO, "tools/go-uct-ponder.mjs"));
  const checks = [];

  const c1 = new Check("UP1", "chooseMoveUCT stops at once on opts.abort");
  {
    const abort = new Int32Array(new SharedArrayBuffer(4));
    Atomics.store(abort, 0, 1);
    const b = empty();
    const t0 = Date.now();
    const r = chooseMoveUCT(b, grid(b), N, 5.5, 3000, { abort });
    const ms = Date.now() - t0;
    c1.examined(2);
    if (ms > 200) c1.fail(`an aborted 3000ms search took ${ms}ms`);
    if (!r || !r.length) c1.fail("an aborted search must still return its best move so far", JSON.stringify(r));
  }
  checks.push(c1);

  const job = (key, maxms) => {
    const b = key === "A" ? put(empty(), 3, 3, "O") : key === "B" ? put(empty(), 2, 2, "O") : put(empty(), 4, 4, "O");
    return { key, board: b, valid: grid(b), N, komi: 5.5, maxms };
  };

  const c2 = new Check("UP2", "a finished ponder answers its own board (hit) with a valid move");
  {
    const p = new UctPonder();
    try {
      p.start([job("A", 150)]);
      await sleep(600);
      const got = await p.take("A");
      c2.examined(3);
      if (!got || got.how !== "hit") c2.fail(`expected a hit, got ${JSON.stringify(got && got.how)}`);
      const top = got?.ranked?.[0];
      if (!top || job("A").board[top.x][top.y] !== ".") c2.fail("the pondered answer must be a legal stone", JSON.stringify(top));
      if (p.stats.hit !== 1) c2.fail(`stats.hit ${p.stats.hit}`);
    } finally {
      p.close();
    }
  }
  checks.push(c2);

  const c3 = new Check("UP3", "a request on another board cancels a running ponder at once and frees the worker");
  {
    const p = new UctPonder();
    try {
      p.start([job("A", 5000)]);
      await sleep(150);
      const t0 = Date.now();
      const got = await p.take("B");
      c3.examined(4);
      if (got !== null) c3.fail("a miss must return null", JSON.stringify(got));
      if (Date.now() - t0 > 50) c3.fail(`take on a miss must not wait for the search (${Date.now() - t0}ms)`);
      if (p.stats.miss !== 1 || p.stats.aborted !== 1) c3.fail(`stats ${JSON.stringify(p.stats)}`);
      const t1 = Date.now();
      p.start([job("C", 100)]);
      await sleep(50);
      const got2 = await p.take("C");
      if (!got2 || Date.now() - t1 > 1500) c3.fail(`the worker must be free within ~16 playouts of the abort (C answered after ${Date.now() - t1}ms: ${JSON.stringify(got2?.how)})`);
    } finally {
      p.close();
    }
  }
  checks.push(c3);

  const c4 = new Check("UP4", "a request on the board being pondered waits for that search (partial)");
  {
    const p = new UctPonder();
    try {
      p.start([job("A", 400)]);
      await sleep(50);
      const t0 = Date.now();
      const got = await p.take("A");
      const ms = Date.now() - t0;
      c4.examined(2);
      if (!got || got.how !== "partial") c4.fail(`expected partial, got ${JSON.stringify(got?.how)}`);
      if (ms < 200 || ms > 1500) c4.fail(`the partial answer must arrive when the search ends (~350ms), took ${ms}ms`);
    } finally {
      p.close();
    }
  }
  checks.push(c4);

  const c5 = new Check("UP5", "retarget keeps a running search still wanted first, drops one not wanted");
  {
    const p = new UctPonder();
    try {
      p.start([job("A", 400), job("B", 100)]);
      await sleep(50);
      p.retarget([job("A", 400), job("C", 100)]);
      c5.examined(3);
      if (p.stats.aborted !== 0) c5.fail("A is still wanted first: it must not be aborted", JSON.stringify(p.stats));
      await sleep(900);
      if (!p.results.has("A") || !p.results.has("C") || p.results.has("B")) c5.fail(`results ${JSON.stringify([...p.results.keys()])}`);
      p.retarget([job("B", 3000)]);
      await sleep(20);
      if (p.results.has("A")) c5.fail("a retarget drops finished results no longer wanted");
      const t0 = Date.now();
      p.retarget([job("C", 100)]);
      if (p.stats.aborted !== 1) c5.fail(`a running search no longer wanted must be aborted: ${JSON.stringify(p.stats)}`);
      await sleep(400);
      if (!p.results.has("C") || Date.now() - t0 > 2000) c5.fail("C must be searched after B's abort");
    } finally {
      p.close();
    }
  }
  checks.push(c5);

  const c6 = new Check("UP6", "end to end: a uct request gets uctPonder; after the retime, the AI's own reply at the retime's seed is answered from the ponder");
  {
    const { loadModel } = await import(path.join(REPO, "tools/goai/model.mjs"));
    const model = await loadModel();
    if (!model) c6.fail("the opponent model bundle is not available here (tools/goai/build.mjs) — the uct ponder needs it");
    else
      await solverRun(async ({ files, waitSeq, logs }) => {
        const board = empty();
        const T = 5434679400;
        files.set("/go/req.txt", JSON.stringify({ seq: 1, size: N, komi: 5.5, board, valid: allValid(board), opponent: "Tetrads", history: [], T }));
        const r1 = await waitSeq(1);
        c6.examined(4);
        if (!r1 || r1.pass) return c6.fail("no first answer", logs().stderr.slice(-400));
        if (r1.backend !== "uct" || r1.uctPonder !== true) c6.fail("a 7x7 uct answer with the opponent must ask for a retime (uctPonder)", JSON.stringify(r1));
        const after = put(board, r1.x, r1.y, "X");
        // The retime: our move was played at Tp. The solver predicts the reply at
        // Tp + 200k over golib seedCalib's prior (k=1 heaviest); so does this test.
        const Tp = T + 1000;
        files.set("/go/req.txt", JSON.stringify({ seq: 2, retime: true, T: Tp, turnS: 1.2, opponent: "Tetrads", size: N }));
        const weight = new Map();
        for (const [k, w] of [[0, 0.1], [1, 0.6], [2, 0.25], [3, 0.05]]) {
          const m = await model.reply(after, { opponent: "Tetrads", history: [board.join("")], rng: Tp + 200 * k });
          const key = m ? `${m.x},${m.y}` : "pass";
          weight.set(key, (weight.get(key) ?? 0) + w);
        }
        const [top] = [...weight.entries()].sort((a, b) => b[1] - a[1])[0];
        if (top === "pass") return c6.fail("the AI passes on this board: pick a board where it plays");
        const [ax, ay] = top.split(",").map(Number);
        const b2 = put(after, ax, ay, "O");
        await sleep(1000);
        files.set("/go/req.txt", JSON.stringify({ seq: 3, size: N, komi: 5.5, board: b2, valid: allValid(b2), opponent: "Tetrads", history: [after.join(""), board.join("")], T: Tp + 1400 }));
        const t0 = Date.now();
        const r3 = await waitSeq(3);
        if (!r3) return c6.fail("no third answer", logs().stderr.slice(-400));
        if (r3.pondered !== "hit" && r3.pondered !== "partial") c6.fail(`the predicted reply's board must be answered from the ponder, got pondered=${r3.pondered}`, JSON.stringify(r3) + logs().stderr.slice(-300));
        if (r3.pondered === "hit" && Date.now() - t0 > 250) c6.fail(`a hit must answer at once (took ${Date.now() - t0}ms)`);
        if (b2[r3.x]?.[r3.y] !== ".") c6.fail("the pondered answer must be legal", JSON.stringify(r3));
      });
  }
  checks.push(c6);

  const c7 = new Check("UP7", "go.js's live A/B: variants alternate in blocks, on the tested arm only");
  {
    const { abVariantOf } = await import(path.join(REPO, "go.js"));
    const ab = { arm: "Tetrads@7", block: 3, variants: [{ name: "a" }, { name: "b", maxms: 400 }] }
    const seq = Array.from({ length: 8 }, (_, n) => abVariantOf(ab, "Tetrads@7", n)?.name).join("");
    c7.examined(3);
    if (seq !== "aaabbbaa") c7.fail(`blocks of 3: ${seq}`);
    if (abVariantOf(ab, "Tetrads@5", 0) !== null) c7.fail("another arm must play no variant");
    if (abVariantOf(null, "Tetrads@7", 0) !== null) c7.fail("no A/B: null");
  }
  checks.push(c7);

  const c8 = new Check("UP8", "the one-core budget: go.js never asks for KataGo (katagoUsable), and goplan then prices 9x9 on uct (capped)");
  {
    const { katagoUsable, SETTINGS } = await import(path.join(REPO, "go.js"));
    const { armPrior } = await import(path.join(REPO, "goplan.js"));
    const live = JSON.stringify({ at: new Date().toISOString(), gpu: false, cpu: true });
    c8.examined(4);
    if (SETTINGS.katago !== false) c8.fail("SETTINGS.katago must stay false under the user's one-core budget");
    if (katagoUsable(live).ok) c8.fail("a solver offering its CPU engine must not be used while SETTINGS.katago is false");
    if (!katagoUsable(live, Date.now(), true).ok) c8.fail("with KataGo allowed, an installed CPU engine is usable");
    if (armPrior("Tetrads", 9, katagoUsable(live).ok)?.backend !== "uct") c8.fail("Tetrads@9 must be priced on uct when KataGo is off");
  }
  checks.push(c8);
  return checks;
}
