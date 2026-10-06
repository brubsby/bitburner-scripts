// [GO] The pass-forcing book (tools/sim/go-oracle.mjs plans winning lines that
// make the AI pass early, at one game clock each; go-oracle-book.mjs turns them
// into per-position CANDIDATES, tools/goai/oracle-<Opponent>.json; go-solver
// plays a candidate only when the AI's reply predicted from the request's
// clock is the one the candidate's line expects).
//
//   GO1 golib.oracleCandidates: a candidate (move AND expected reply) stored on
//       one orientation comes back right on all 8; after-pass candidates live
//       in their own table; best value first; unknown position -> [].
//   GO2 go-solver end to end (stub RPC, --book-dir): a request whose clock
//       predicts candidate A's expected reply is answered with A (book: true,
//       no search) even though higher-valued candidates are listed: B, whose
//       expected reply is not the predicted one, and C, whose FIRST reply is
//       predicted but whose line's SECOND reply this clock does not give (the
//       live 2026-10-06 21:07Z wipe: a candidate stitched from another
//       clock's plan). Neither B nor C may be played (golib.oracleLineHolds).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO } from "./ram.mjs";

export async function run() {
  const golib = await import("../../golib.js");
  const N = 5;
  const c1 = new Check("GO1", "pass-forcing candidates round-trip every orientation (move and expected reply); the after-pass table is separate");
  {
    const base = ["#.#..", ".X...", "..O..", ".....", "....#"];
    const { key, t } = golib.canonicalBoard(base);
    const m = golib.toKeyFrame(N, t, 3, 1);
    const r = golib.toKeyFrame(N, t, 2, 3);
    const m2 = golib.toKeyFrame(N, t, 4, 2);
    const book = { oracle: { [key]: [[m2[0], m2[1], -1, -1, 1], [m[0], m[1], r[0], r[1], 5]] }, oraclePass: {} };
    const syms = golib.boardSymmetries(N);
    const s = base.join("");
    for (let u = 0; u < 8; u++) {
      const rows = [];
      let want, wantR;
      for (let x = 0; x < N; x++) {
        let row = "";
        for (let y = 0; y < N; y++) {
          const [a, b] = syms[u](x, y);
          row += s[a * N + b];
          if (a === 3 && b === 1) want = [x, y];
          if (a === 2 && b === 3) wantR = [x, y];
        }
        rows.push(row);
      }
      c1.examined(1);
      const cs = golib.oracleCandidates(book, rows);
      const c = cs[0];
      if (cs.length !== 2 || !c || c.x !== want[0] || c.y !== want[1] || !c.reply || c.reply.x !== wantR[0] || c.reply.y !== wantR[1] || c.v !== 5) c1.fail(`orientation ${u}: ${JSON.stringify(cs)}, want move ${want} reply ${wantR} first`);
      if (cs[1] && cs[1].reply !== null) c1.fail(`orientation ${u}: a pass reply must come back as null`, JSON.stringify(cs[1]));
      if (golib.oracleCandidates(book, rows, { passed: true }).length) c1.fail(`orientation ${u}: after-pass lookup must use oraclePass`);
    }
    c1.examined(1);
    if (golib.oracleCandidates(book, [".....", ".....", ".....", ".....", "....."]).length) c1.fail("an unknown position must have no candidates");
    if (golib.oracleCandidates(null, base).length) c1.fail("no book: no candidates");
  }

  const c2 = new Check("GO2", "go-solver plays a pass-forcing candidate only when the request's clock predicts its expected reply");
  {
    const http = await import("node:http");
    const { spawn } = await import("node:child_process");
    const { loadModel } = await import(path.join(REPO, "tools/goai/model.mjs"));
    const model = await loadModel();
    if (!model) {
      c2.warn("the opponent model could not load — GO2 did NOT run");
      return [c1, c2];
    }
    const board = [".....", ".....", ".....", ".....", "....."];
    const T = 200 * 5123457;
    // The solver's lag for an instant answer: the pre-sent path's prior
    // (golib seedCalib), each k at T and one tick later.
    const prior = [[0, 0.1], [1, 0.6], [2, 0.25], [3, 0.05]];
    const kw = prior.flatMap(([k, w]) => [[k, w / 2], [k + 1, w / 2]]);
    const valid = model.validMoves(board, []);
    let A = null, B = null, C = null;
    for (const [x, y] of valid) {
      const after = golib.applyMove(board, x, y);
      const mass = new Map();
      for (const [k, w] of kw) {
        const r = await model.reply(after, { opponent: "Tetrads", history: [board.join("")], passCount: 0, rng: T + 200 * k });
        const key = r ? `${r.x},${r.y}` : "P";
        mass.set(key, (mass.get(key) ?? 0) + w);
      }
      const [top, w] = [...mass.entries()].sort((a, z) => z[1] - a[1])[0];
      if (!A && w >= 0.8 && top !== "P") A = { x, y, reply: top.split(",").map(Number) };
      else if (!C && B && w >= 0.8 && top !== "P") {
        // C: its first reply is the predicted one; its line's next step (our
        // stone m2) expects a reply the clock does NOT give there.
        const rp = top.split(",").map(Number);
        const b1 = after; // our stone placed
        const b2 = b1.map((col, i) => (i === rp[0] ? col.slice(0, rp[1]) + "O" + col.slice(rp[1] + 1) : col));
        const empt = [];
        for (let u = 0; u < 5; u++) for (let v = 0; v < 5; v++) if (b2[u][v] === ".") empt.push([u, v]);
        const m2 = empt[0];
        const after2 = golib.applyMove(b2, m2[0], m2[1]);
        const seen = new Set();
        for (const [k] of kw) for (const d of [-2, 0, 2]) {
          const r2 = await model.reply(after2, { opponent: "Tetrads", history: [b2.join(""), after.join(""), board.join("")], passCount: 0, rng: T + 200 * (k + 5 + d) });
          seen.add(r2 ? `${r2.x},${r2.y}` : "P");
        }
        const wrong2 = empt.slice(1).find(([u, v]) => !seen.has(`${u},${v}`) && !(u === m2[0] && v === m2[1]));
        if (wrong2) C = { x, y, reply: rp, m2, wrong2 };
      } else if (!B && w >= 0.8 && top !== "P") {
        // B expects a reply the clock does NOT predict: any other empty point.
        const wrong = valid.find(([u, v]) => `${u},${v}` !== top && !(u === x && v === y));
        B = { x, y, reply: wrong };
      }
      if (A && B && C) break;
    }
    if (!A || !B || !C) {
      c2.fail("could not construct the two candidates (no move with a confidently predicted reply)");
      return [c1, c2];
    }
    const { key, t } = golib.canonicalBoard(board);
    const kf = (p) => golib.toKeyFrame(N, t, p[0], p[1]);
    const ka = kf([A.x, A.y]), kra = kf(A.reply), kb = kf([B.x, B.y]), krb = kf(B.reply);
    const kc = kf([C.x, C.y]), krc = kf(C.reply), km2 = kf(C.m2), kw2 = kf(C.wrong2);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gooracle-"));
    fs.writeFileSync(path.join(dir, "book-Tetrads.json"), JSON.stringify({ opponent: "Tetrads", entries: {} }));
    fs.writeFileSync(path.join(dir, "oracle-Tetrads.json"), JSON.stringify({ opponent: "Tetrads", oracle: { [key]: [[kb[0], kb[1], krb[0], krb[1], 20, null, -1, -1, []], [kc[0], kc[1], krc[0], krc[1], 15, null, -1, -1, [[km2[0], km2[1], -1, -1, kw2[0], kw2[1]]]], [ka[0], ka[1], kra[0], kra[1], 10, null, -1, -1, []]] }, oraclePass: {} }));
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
    const child = spawn(process.execPath, [path.join(REPO, "tools/go-solver.mjs"), "--maxms", "300", "--poll", "40", "--rpc", `http://127.0.0.1:${port}/rpc`, "--katago-remote", "none", "--ponder-cap-ms", "1500", "--book-dir", dir], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, KATAGO_DIR: "/nonexistent-katago" } });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    const wait = async (pred, ms = 20000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const v = pred();
        if (v) return v;
        await new Promise((r) => setTimeout(r, 30));
      }
      return null;
    };
    try {
      files.set("/go/req.txt", JSON.stringify({ seq: 1, size: 5, komi: 5.5, backend: "model", opponent: "Tetrads", board, valid, history: [], turnS: 1.2, T }));
      const a = await wait(() => pushed.find((m) => m.seq === 1));
      c2.examined(3);
      if (!a) throw new Error(`no reply: ${stderr.slice(-300)}`);
      if (a.x === B.x && a.y === B.y) c2.fail("the higher-valued candidate whose expected reply the clock does not predict must not be played", JSON.stringify(a));
      if (a.x === C.x && a.y === C.y) c2.fail("a candidate whose line's SECOND reply this clock does not give must not be played (the full-line check)", JSON.stringify(a));
      if (!(a.x === A.x && a.y === A.y && a.book === true)) c2.fail(`the candidate the clock confirms (${A.x},${A.y}) must be answered at once, book: true`, JSON.stringify(a));
      if (a.rootWork) c2.fail("a candidate answer must not search", JSON.stringify(a));
      c2.note(`A (${A.x},${A.y}) expects ${A.reply}; B (${B.x},${B.y}) expects ${B.reply} (not predicted); C (${C.x},${C.y}) then ${C.m2} expects ${C.wrong2} (not predicted); answered ${a.x},${a.y}`);
    } catch (e) {
      c2.fail(String(e?.message ?? e).slice(0, 300));
    } finally {
      child.kill();
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  return [c1, c2];
}
