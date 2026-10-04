// KataGo as an IPvGO move source (EXPERIMENTAL — see tools/katago/README.md for
// what was measured and the recommendation).
//
//   const kg = await startKataGo({ visits: 200 })     // null if not installed
//   const r = await kg.choose(board, validList, komi)  // {x,y} | {pass:true}
//   kg.close()
//
// KataGo runs as its analysis engine (JSON lines over stdin/stdout), one
// niced process, 2 search threads, small NN cache (tools/katago/analysis.cfg).
//
// THE MAPPING, and where it is not exact:
//   - Rules: area scoring, positional superko, no suicide, no friendly pass
//     (dead stones must be captured — IPvGO never removes dead stones,
//     scoring.ts getScore counts what is on the board), komi as the game's.
//   - Offline nodes ('#') do not exist in Go. They are sent as WHITE stones:
//     for OUR groups that is exact (a hole is not a liberty, and neither is a
//     white stone). For WHITE's groups it is not: a white group touching a
//     hole cluster merges with it in KataGo's eyes and borrows its liberties,
//     so white looks stronger than it is (pessimistic for us, never
//     optimistic). Hole groups with no liberty at all are dropped (KataGo
//     would treat them as captured). Komi is reduced by the hole stones sent,
//     so KataGo's area count is not inflated by them.
//   - Superko history is not sent; the root is restricted to the game's own
//     valid list (allowMoves), which enforces it where it matters.
//   - Coordinates: board[x][y] (column-major strings) -> GTP column letter
//     COLS[x], row y+1. Any consistent symmetry is fine.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VENDOR = process.env.KATAGO_DIR ?? path.resolve(HERE, "../vendor/katago");
// The release is an AppImage; install.sh extracts it. Its AppRun is a
// #!/bin/bash script (absent on NixOS), so the binary is run directly with the
// AppImage's bundled libs on LD_LIBRARY_PATH — what AppRun itself does.
export const APPDIR = path.join(VENDOR, "bin/squashfs-root");
export const BIN = path.join(APPDIR, "usr/bin/katago");
export const NET = path.join(VENDOR, "kata1-b10c128-s1141046784-d204142634.txt.gz");
const COLS = "ABCDEFGHJKLMNOPQRSTUVWXYZ";

export const RULES = {
  ko: "POSITIONAL",
  scoring: "AREA",
  tax: "NONE",
  suicide: false,
  hasButton: false,
  whiteHandicapBonus: "0",
  friendlyPassOk: false,
};

/** The KataGo query for one position (pure; tested). */
export function toQuery(board, validList, komi, { id = "q", visits = 200, holes = "white" } = {}) {
  const N = board.length;
  const stones = [];
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) {
    const c = board[x][y];
    if (c === "X") stones.push(["B", COLS[x] + (y + 1)]);
    else if (c === "O") stones.push(["W", COLS[x] + (y + 1)]);
  }
  // Hole components with at least one empty neighbour.
  let holeStones = 0;
  if (holes === "white") {
    const seen = new Set();
    for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) {
      if (board[x][y] !== "#" || seen.has(x * N + y)) continue;
      const comp = [];
      let libs = 0;
      const stack = [[x, y]];
      seen.add(x * N + y);
      while (stack.length) {
        const [a, b] = stack.pop();
        comp.push([a, b]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const u = a + dx, v = b + dy;
          if (u < 0 || v < 0 || u >= N || v >= N) continue;
          const c = board[u][v];
          if (c === "." ) libs++;
          else if (c === "#" && !seen.has(u * N + v)) {
            seen.add(u * N + v);
            stack.push([u, v]);
          }
        }
      }
      if (libs === 0) continue;
      for (const [a, b] of comp) stones.push(["W", COLS[a] + (b + 1)]);
      holeStones += comp.length;
    }
  }
  // NEVER FILL OUR OWN EYE TO "CAPTURE" A HOLE. A hole cluster inside our
  // territory is, to KataGo, a dead white group — and with friendlyPassOk off
  // it plays to capture it, filling the cluster's liberties, which are OUR eye
  // points. In IPvGO the hole is never captured, so each fill only destroys an
  // eye (go-w0.mjs, 200 visits: a 90-stone black group died this way, final
  // black 0). An empty point whose every neighbour is ours or a hole, with at
  // least one hole, is withheld from the root (if anything else is legal).
  const eyeByHole = (x, y) => {
    let hole = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const u = x + dx, v = y + dy;
      if (u < 0 || v < 0 || u >= N || v >= N) continue;
      const c = board[u][v];
      if (c === "#") hole = true;
      else if (c !== "X") return false;
    }
    return hole;
  };
  let rootList = validList.filter(([x, y]) => !eyeByHole(x, y));
  if (!rootList.length) rootList = validList;
  const moves = rootList.map(([x, y]) => COLS[x] + (y + 1));
  moves.push("pass");
  // KataGo accepts integer or half-integer komi in [-150, 150].
  const k = Math.max(-150, Math.min(150, Math.round((komi - holeStones) * 2) / 2));
  return {
    id,
    initialStones: stones,
    moves: [],
    initialPlayer: "B",
    rules: RULES,
    komi: k,
    boardXSize: N,
    boardYSize: N,
    maxVisits: visits,
    allowMoves: [{ player: "B", moves, untilDepth: 1 }],
  };
}

/** GTP vertex -> {x, y} or {pass: true}. */
export function fromVertex(v) {
  if (!v || v.toLowerCase() === "pass") return { pass: true };
  return { x: COLS.indexOf(v[0].toUpperCase()), y: Number(v.slice(1)) - 1 };
}

/**
 * KataGo's choice, with its passes overruled.
 *
 * KataGo passes when it thinks the game is settled UNDER ITS OWN MAPPING —
 * hole stones it reads as dead white groups, territory it would count after
 * dead-stone removal. IPvGO counts the board as it stands, and a pass hands the
 * AI a free move (go-w0.mjs, 100 visits: 13 and 20 passes in two lost games,
 * black 126 and 93; at 400 visits, 0 passes and two wins). So a pass is taken
 * only when no stone is within PASS_MARGIN points of it on KataGo's own score
 * estimate (a stone that costs nothing is free insurance: under area scoring a
 * stone in our own territory is score-neutral). go.js's mirror pass still ends
 * a game we lead when the AI passes. Pure; tested by GM6.
 */
export const PASS_MARGIN = 1.0;
export function pickMove(moveInfos) {
  const sorted = [...moveInfos].sort((a, b) => a.order - b.order);
  const best = sorted[0];
  if (!best) return null;
  if (best.move.toLowerCase() !== "pass") return best;
  const stone = sorted.find((m) => m.move.toLowerCase() !== "pass" && m.visits > 0);
  if (stone && stone.scoreLead >= best.scoreLead - PASS_MARGIN) return stone;
  return best;
}

export function installed() {
  return fs.existsSync(BIN) && fs.existsSync(NET);
}

/** Start the engine; null (never a throw) when it is not installed or will not start. */
export async function startKataGo({ visits = 200, log = () => {} } = {}) {
  if (!installed()) {
    log(`katago not installed (${BIN} / ${NET}) — run tools/katago/install.sh`);
    return null;
  }
  const child = spawn("nice", ["-n", "19", BIN, "analysis", "-config", path.join(HERE, "analysis.cfg"), "-model", NET], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, LD_LIBRARY_PATH: [path.join(APPDIR, "usr/lib"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") },
  });
  const pending = new Map();
  let stderr = "";
  let ready = false;
  child.stderr.on("data", (d) => {
    stderr = (stderr + d).slice(-4000);
    if (/Started, ready to begin handling requests/.test(stderr)) ready = true;
  });
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      return;
    }
    const p = pending.get(o.id);
    if (!p) return;
    pending.delete(o.id);
    if (o.error) p.reject(new Error(`katago: ${o.error}${o.field ? ` (${o.field})` : ""}`));
    else p.resolve(o);
  });
  let exited = null;
  child.on("exit", (code, sig) => {
    exited = `exited code=${code} signal=${sig}`;
    for (const p of pending.values()) p.reject(new Error(`katago ${exited}: ${stderr.slice(-300)}`));
    pending.clear();
  });
  const t0 = Date.now();
  while (!ready && !exited && Date.now() - t0 < 120000) await new Promise((r) => setTimeout(r, 100));
  if (!ready) {
    log(`katago did not start: ${exited ?? "timeout"} ${stderr.slice(-400)}`);
    child.kill();
    return null;
  }
  let seq = 0;
  const query = (q) =>
    new Promise((resolve, reject) => {
      if (exited) return reject(new Error(`katago ${exited}`));
      pending.set(q.id, { resolve, reject });
      child.stdin.write(JSON.stringify(q) + "\n");
    });
  return {
    pid: child.pid,
    async analyze(board, validList, komi, opts = {}) {
      return query(toQuery(board, validList, komi, { id: `q${++seq}`, visits, ...opts }));
    },
    async choose(board, validList, komi, opts = {}) {
      const r = await this.analyze(board, validList, komi, opts);
      const pick = pickMove(r.moveInfos ?? []);
      if (!pick) return { pass: true, info: r.rootInfo };
      return { ...fromVertex(pick.move), winrate: pick.winrate, scoreLead: pick.scoreLead, visits: pick.visits };
    },
    close() {
      child.kill();
    },
  };
}
