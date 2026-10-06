// [GB] The Go opening book (tools/sim/go-book.mjs builds it, go-solver.mjs
// serves it): positions keyed up to the board's 8 symmetries, the move mapped
// back into the board's own frame, answered at once and pre-sent.
//
//   GB1 golib.canonicalBoard / toKeyFrame / bookMove: a move booked on one
//       orientation comes back correctly on all 8; a position not in the book
//       is null.
//   GB2 go-solver end to end (stub RPC, --book-dir): a request on a book
//       position is answered with the book's move (book: true) without a
//       search; after it, the book's answers to the AI's sampled replies are
//       published in /go/ponder.txt ahead of the search's.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO } from "./ram.mjs";

export async function run() {
  const golib = await import("../../golib.js");
  const c1 = new Check("GB1", "the opening book's symmetry keys round-trip every orientation; an unknown position is not in the book");
  {
    const N = 5;
    const base = ["#.#..", ".X...", "..O..", ".....", "....#"];
    const { key, t } = golib.canonicalBoard(base);
    const c = golib.toKeyFrame(N, t, 3, 1);
    const book = { entries: { [key]: [c[0], c[1], 0.9] } };
    const syms = golib.boardSymmetries(N);
    const s = base.join("");
    for (let u = 0; u < 8; u++) {
      const rows = [];
      let want;
      for (let x = 0; x < N; x++) {
        let r = "";
        for (let y = 0; y < N; y++) {
          const [a, b] = syms[u](x, y);
          r += s[a * N + b];
          if (a === 3 && b === 1) want = [x, y];
        }
        rows.push(r);
      }
      c1.examined(1);
      const m = golib.bookMove(book, rows);
      if (!m || m.x !== want[0] || m.y !== want[1]) c1.fail(`orientation ${u}: book move ${JSON.stringify(m)}, want ${want}`);
    }
    c1.examined(1);
    if (golib.bookMove(book, [".....", ".....", ".....", ".....", "....."]) !== null) c1.fail("a position not in the book must return null");
  }

  const c2 = new Check("GB2", "go-solver answers a book position at once (book: true) and pre-sends the book's answers to the AI's replies");
  {
    const http = await import("node:http");
    const { spawn } = await import("node:child_process");
    const { loadModel } = await import(path.join(REPO, "tools/goai/model.mjs"));
    const model = await loadModel();
    if (!model) {
      c2.warn("the opponent model could not load — GB2 did NOT run");
      return [c1, c2];
    }
    const N = 5;
    const board = [".....", ".....", ".....", ".....", "....."];
    const put = (x, y, ch, b) => b.map((col, i) => (i === x ? col.slice(0, y) + ch + col.slice(y + 1) : col));
    // The book: (0,0) on the empty board (no search would open in a corner),
    // and for each AI reply to it, the first valid point.
    const entries = {};
    const add = (b, x, y) => {
      const { key, t } = golib.canonicalBoard(b);
      const [kx, ky] = golib.toKeyFrame(N, t, x, y);
      entries[key] = [kx, ky, 0.5, 1];
    };
    add(board, 0, 0);
    const after = put(0, 0, "X", board);
    const children = new Map();
    for (let i = 0; i < 40; i++) {
      const r = await model.reply(after, { opponent: "Tetrads", history: [board.join("")], passCount: 0, rng: 200 * (1 + i * 7919) });
      if (r) children.set(`${r.x},${r.y}`, put(r.x, r.y, "O", after));
    }
    const childBook = new Map();
    for (const [k, b] of children) {
      const v = model.validMoves(b, [after.join(""), board.join("")])[0];
      add(b, v[0], v[1]);
      childBook.set(b.join(""), v);
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gobook-"));
    fs.writeFileSync(path.join(dir, "book-Tetrads.json"), JSON.stringify({ opponent: "Tetrads", entries }));
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
    const child = spawn(process.execPath, [path.join(REPO, "tools/go-solver.mjs"), "--maxms", "400", "--poll", "40", "--rpc", `http://127.0.0.1:${port}/rpc`, "--katago-remote", "none", "--ponder-cap-ms", "2000", "--book-dir", dir], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, KATAGO_DIR: "/nonexistent-katago" } });
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
      const valid = model.validMoves(board, []);
      files.set("/go/req.txt", JSON.stringify({ seq: 1, size: 5, komi: 5.5, backend: "model", opponent: "Tetrads", board, valid, history: [], turnS: 1.2 }));
      const a = await wait(() => pushed.find((m) => m.seq === 1));
      c2.examined(2);
      if (!a) throw new Error(`no reply: ${stderr.slice(-300)}`);
      if (!(a.x === 0 && a.y === 0 && a.book === true)) c2.fail("the book position must be answered with the book's move (0,0), book: true", JSON.stringify(a));
      if (a.rootWork) c2.fail("a book answer must not search", JSON.stringify(a));
      const pon = await wait(() => {
        try {
          const p = JSON.parse(files.get("/go/ponder.txt") ?? "null");
          return p?.answers?.some((e) => e.book) ? p : null;
        } catch {
          return null;
        }
      }, 8000);
      c2.examined(2);
      if (!pon) c2.fail("the book's answers to the AI's replies must be pre-sent in /go/ponder.txt");
      else {
        const bad = pon.answers.filter((e) => e.book).filter((e) => {
          const v = childBook.get(e.b);
          return !v || v[0] !== e.x || v[1] !== e.y;
        });
        if (bad.length) c2.fail("a pre-sent book answer must be the book's move for that position", JSON.stringify(bad));
        const firstBook = pon.answers.findIndex((e) => e.book);
        const firstSearch = pon.answers.findIndex((e) => !e.book && childBook.has(e.b));
        if (firstSearch >= 0 && firstSearch < firstBook) c2.fail("book answers must come before the search's for the same position");
      }
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
