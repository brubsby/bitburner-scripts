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
//   - Offline nodes ('#') are, in the game, points that do not exist: the
//     board holds null there (boardState.ts, offlineNodes.ts), so a hole is no
//     liberty, no stone, no territory, and an empty region bordered by one
//     colour and holes is that colour's (scoring.ts findNeighbors skips them)
//     — EXACTLY a board edge. Stock KataGo has no such point, so:
//       holes "wall" (THE DEFAULT on an engine that supports it, 2026-10-06):
//         the query carries `walls`, read by OUR PATCHED KataGo
//         (tools/katago/walls: the board's own C_WALL padding value placed
//         inside the rectangle, and the net's on-board mask cleared there).
//         Rules, liberties, territory and the net's input are then the game's.
//       holes "white" (stock engines: the local CPU build): every hole
//         cluster a WHITE stone. Exact for our groups' liberties, wrong for
//         white's (a white group touching a hole cluster borrows its
//         liberties), and KataGo reads the clusters as dead white stones to
//         capture and as white walls owning the territory around them. Hole
//         groups with no liberty are dropped; komi is reduced by the hole
//         stones sent. This is what lost the live SlumSnakes@9 games
//         (2026-10-06) and the 7x7/9x9 ceiling arms.
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

/**
 * Black's territory by the game's own rule (scoring.ts getTerritoryScores /
 * checkTerritoryOwnership): an empty region whose neighbours, offline nodes
 * excluded (findNeighbors skips them), are all black — and not a region of
 * more than N*N-3 points. A Set of x*N+y.
 */
export function ourTerritory(board) {
  const N = board.length;
  const out = new Set();
  const seen = new Set();
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) {
    if (board[x][y] !== "." || seen.has(x * N + y)) continue;
    const region = [];
    let black = false, white = false;
    const stack = [[x, y]];
    seen.add(x * N + y);
    while (stack.length) {
      const [a, b] = stack.pop();
      region.push(a * N + b);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const u = a + dx, v = b + dy;
        if (u < 0 || v < 0 || u >= N || v >= N) continue;
        const c = board[u][v];
        if (c === "X") black = true;
        else if (c === "O") white = true;
        else if (c === "." && !seen.has(u * N + v)) {
          seen.add(u * N + v);
          stack.push([u, v]);
        }
      }
    }
    if (black && !white && region.length <= N * N - 3) for (const i of region) out.add(i);
  }
  return out;
}

/** The KataGo query for one position (pure; tested). */
export function toQuery(board, validList, komi, { id = "q", visits = 200, holes = "white", komiAdjust = 0, ownership = false, allowUnsettledPass = false, settings = null } = {}) {
  const N = board.length;
  const stones = [];
  // holes "wall": every offline node is a wall (patched engine, see the header).
  const walls = [];
  if (holes === "wall") for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if (board[x][y] === "#") walls.push(COLS[x] + (y + 1));
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) {
    const c = board[x][y];
    if (c === "X") stones.push(["B", COLS[x] + (y + 1)]);
    else if (c === "O") stones.push(["W", COLS[x] + (y + 1)]);
  }
  // Hole components with at least one empty neighbour.
  // holes: "white" (every cluster a white stone) or "owner" (release 2
  // experiment): a cluster that touches black stones and no white stone is
  // sent BLACK — inside our area it is then part of our wall, not a dead white
  // group to "capture" — and komi rises by its size instead of falling.
  let holeStones = 0;
  if (holes === "white" || holes === "owner") {
    const seen = new Set();
    for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) {
      if (board[x][y] !== "#" || seen.has(x * N + y)) continue;
      const comp = [];
      let libs = 0;
      let nearB = false, nearW = false;
      const stack = [[x, y]];
      seen.add(x * N + y);
      while (stack.length) {
        const [a, b] = stack.pop();
        comp.push([a, b]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const u = a + dx, v = b + dy;
          if (u < 0 || v < 0 || u >= N || v >= N) continue;
          const c = board[u][v];
          if (c === ".") libs++;
          else if (c === "X") nearB = true;
          else if (c === "O") nearW = true;
          else if (c === "#" && !seen.has(u * N + v)) {
            seen.add(u * N + v);
            stack.push([u, v]);
          }
        }
      }
      if (libs === 0) continue;
      const asBlack = holes === "owner" && nearB && !nearW;
      for (const [a, b] of comp) stones.push([asBlack ? "B" : "W", COLS[a] + (b + 1)]);
      holeStones += asBlack ? -comp.length : comp.length;
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
  // With walls KataGo knows a hole is no stone and plays its eyes correctly.
  let rootList = holes === "wall" ? validList.slice() : validList.filter(([x, y]) => !eyeByHole(x, y));
  const ours = ourTerritory(board);
  // Nothing else left: PASS, never the eye. (Falling back to the full list
  // here is how a 128-stone group filled its own last eyes and died,
  // go-w0.mjs 400 visits game 1, move 321.)
  const moves = rootList.map(([x, y]) => COLS[x] + (y + 1));
  // NO PASS WHILE A POINT IS STILL OPEN. Under this mapping KataGo's score is
  // biased by the holes (it reads hole clusters as dead white stones it will
  // capture, on top of the komi credit for them), so it can believe it is far
  // ahead on a board the game scores as level — and pass. On 7x7 it passed
  // its first FOUR moves on an empty board and lost 8-32.5 (go-w0.mjs, 100
  // visits, Slum Snakes deal 2). Passing only ever hands the AI a free move:
  // the game ends on OUR pass only after the AI passed, and go.js's mirror
  // pass already ends a game we lead by the game's own count. So pass is
  // offered only when every legal point is already OUR territory by the
  // game's own rule (scoring.ts checkTerritoryOwnership: an empty region whose
  // non-hole neighbours are all black) — filling it is worth nothing and
  // may fill an eye. `allowUnsettledPass` restores the old root.
  if (allowUnsettledPass || rootList.every(([x, y]) => ours.has(x * N + y))) moves.push("pass");
  // KataGo accepts integer or half-integer komi in [-150, 150].
  const k = Math.max(-150, Math.min(150, Math.round((komi - holeStones + komiAdjust) * 2) / 2));
  return {
    id,
    initialStones: stones,
    ...(walls.length ? { walls } : {}),
    moves: [],
    initialPlayer: "B",
    rules: RULES,
    komi: k,
    boardXSize: N,
    boardYSize: N,
    maxVisits: visits,
    allowMoves: [{ player: "B", moves, untilDepth: 1 }],
    ...(ownership ? { includeOwnership: true } : {}),
    ...(settings ? { overrideSettings: settings } : {}),
  };
}

/**
 * KOMI CALIBRATION (opts.calibrate) — MEASURED WORSE, OFF: 0/2 at 400 visits
 * (black 120 and 76, 5-8 passes a game: told the truth about the score, it
 * thinks it leads and stops fighting) vs 2/2 uncalibrated on the same build.
 * Kept for the record and the test. The hole-as-white mapping biases
 * KataGo's score: hole clusters read as live white walls own the territory
 * around them, so early on it believes black is ~70 points behind on a board
 * the game scores as level. A winrate-maximiser that thinks it is far behind
 * plays desperate, high-variance Go. From KataGo's own ownership map the
 * IPvGO outcome is estimated directly — non-hole points only, area by owner,
 * komi as the game's — and the difference to KataGo's scoreLead is the bias;
 * the next query's komi is shifted by it (exponentially smoothed), so KataGo's
 * lead tracks the game's. Pure; tested by GM6.
 *
 * ownership: KataGo analysis order, row-major from the TOP row (GTP row N),
 * black-positive (reportAnalysisWinratesAs = BLACK).
 */
export function ipvgoLead(board, ownership, komi) {
  const N = board.length;
  let lead = -komi;
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) {
    if (board[x][y] === "#") continue;
    const o = ownership[(N - 1 - y) * N + x];
    if (Number.isFinite(o)) lead += o; // expected (black - white) for this point
  }
  return lead;
}

/**
 * The hole mapping a query gets on an engine: walls on the patched engine
 * unless the caller names another; NEVER walls on a stock engine — it does not
 * read the field and would play the holes as empty points.
 */
export function holesFor(engineWalls, requested) {
  if (requested === "wall" && !engineWalls) return "white";
  return requested ?? (engineWalls ? "wall" : "white");
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

/**
 * THE NET'S BUFFER IS 19x19 UNLESS TOLD OTHERWISE. KataGo runs every network
 * evaluation on a maxBoardSize buffer (default 19) and masks the off-board
 * points, so a 5x5 eval costs what a 19x19 one does (~15ms on two Eigen
 * threads: 100 visits ~1.5s on 5x5 and 9x9 alike). Pinning the buffer to the
 * board (requireMaxBoardSize) makes the eval scale with the points. One engine
 * then serves ONE board size; the caller starts one per size.
 */
// WALLS NEED THE MASK: with requireMaxBoardSize the CUDA backend drops the
// on-board mask (cudaandrocmbackend.inc: "Don't do any masking if we know the
// board is exactly the desired size"), so a walls engine pins the buffer but
// never requires it (`exact` false).
export function sizeOverride(size, extra = "", exact = true) {
  const kv = [];
  if (Number.isInteger(size) && size >= 2 && size < 19) kv.push(`maxBoardXSizeForNNBuffer=${size}`, `maxBoardYSizeForNNBuffer=${size}`, ...(exact ? ["requireMaxBoardSize=true"] : []));
  if (extra) kv.push(...String(extra).split(",").filter((s) => /^[A-Za-z0-9]+=[A-Za-z0-9.]+$/.test(s)));
  return kv.length ? ["-override-config", kv.join(",")] : [];
}

export function installed() {
  return fs.existsSync(BIN) && fs.existsSync(NET);
}

/**
 * THE REMOTE GPU ENGINE (tools/katago/gpu/README.md). `remote: "bubtop"` runs
 * the engine on that host's GPU through ONE ssh session: the JSON lines go
 * over the session's stdin/stdout, so there is no per-move connection cost,
 * and closing stdin (close(), or this process dying) ends the engine there.
 * BatchMode: never prompt; ConnectTimeout: an unreachable host fails in
 * seconds, not minutes; ServerAlive: a dead link is noticed in ~30s.
 */
export const SSH_OPTS = ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=3"];
export const REMOTE_CMD = "katago/run-analysis.sh";
// The patched engine (tools/katago/walls): offline nodes as walls. Installed
// next to the stock one by tools/katago/walls/build-walls.sh.
export const REMOTE_CMD_WALLS = "katago/run-analysis-walls.sh";

/**
 * Start the engine; null (never a throw) when it is not installed or will not start.
 * `walls`: start the patched engine (REMOTE_CMD_WALLS; remote only — the local
 * CPU build is stock) and send offline nodes as walls. `remote: "self"` runs
 * the remote command on THIS host without ssh (the harness on the GPU host).
 */
export async function startKataGo({ visits = 200, size = null, remote = null, remoteNet = null, override = "", walls = false, log = () => {}, startTimeoutMs = 120000 } = {}) {
  if (!remote && !installed()) {
    log(`katago not installed (${BIN} / ${NET}) — run tools/katago/install.sh`);
    return null;
  }
  walls = !!(walls && remote);
  const netEnv = remoteNet && /^[A-Za-z0-9._-]+$/.test(remoteNet) ? [`KATAGO_NET=$HOME/katago/${remoteNet}`] : [];
  const remoteArgs = [...netEnv, walls ? REMOTE_CMD_WALLS : REMOTE_CMD, ...sizeOverride(size, override, !walls)];
  const child = remote === "self"
    ? spawn("bash", ["-c", `cd "$HOME" && exec env ${remoteArgs.join(" ")}`], { stdio: ["pipe", "pipe", "pipe"] })
    : remote
    ? spawn("ssh", [...SSH_OPTS, remote, ...remoteArgs], { stdio: ["pipe", "pipe", "pipe"] })
    : spawn("nice", ["-n", "19", BIN, "analysis", "-config", path.join(HERE, "analysis.cfg"), "-model", NET, ...sizeOverride(size, override)], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, LD_LIBRARY_PATH: [path.join(APPDIR, "usr/lib"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") },
      });
  child.on("error", () => {}); // reported through "exit" / the start timeout
  child.stdin.on("error", () => {});
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
  while (!ready && !exited && Date.now() - t0 < startTimeoutMs) await new Promise((r) => setTimeout(r, 50));
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
    where: remote ? `gpu@${remote}` : "cpu",
    walls,
    size,
    startMs: Date.now() - t0,
    bias: 0,
    alive: () => !exited,
    why: () => exited,
    /** A prepared query, as is (tools/katago/evaluator.mjs). */
    raw(q) {
      return query(q);
    },
    async analyze(board, validList, komi, opts = {}) {
      const holes = holesFor(walls, opts.holes);
      return query(toQuery(board, validList, komi, { id: opts.id ?? `q${++seq}`, visits, ...opts, holes }));
    },
    /** Stop a running query early; its promise resolves with what it has (KataGo "terminate"). */
    terminate(id) {
      if (exited || !pending.has(id)) return;
      child.stdin.write(JSON.stringify({ id: `t-${id}`, action: "terminate", terminateId: id }) + "\n");
    },
    nextId: () => `q${++seq}`,
    async choose(board, validList, komi, opts = {}) {
      const cal = opts.calibrate ? { komiAdjust: this.bias, ownership: true } : {};
      const r = await this.analyze(board, validList, komi, { ...opts, ...cal });
      if (opts.calibrate && Array.isArray(r.ownership) && Number.isFinite(r.rootInfo?.scoreLead)) {
        // scoreLead already includes this query's komi shift: undo it to get
        // the unshifted KataGo lead, then re-estimate the bias.
        const kataLead = r.rootInfo.scoreLead + this.bias;
        const real = ipvgoLead(board, r.ownership, komi);
        this.bias = 0.5 * this.bias + 0.5 * (kataLead - real);
      }
      const pick = pickMove(r.moveInfos ?? []);
      if (!pick) return { pass: true, info: r.rootInfo };
      return { ...fromVertex(pick.move), winrate: pick.winrate, scoreLead: pick.scoreLead, visits: pick.visits };
    },
    close() {
      child.kill();
    },
  };
}
