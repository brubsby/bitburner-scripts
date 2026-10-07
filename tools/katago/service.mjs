// KataGo as a long-lived move service: warm engines, a remote GPU with a local
// CPU fallback, and PONDERING (speculative answers for the opponent's likely
// replies, computed while the game's AI is still thinking).
//
//   const svc = new KataGoService({ remote: "bubtop", log })
//   const r = await svc.choose({ size, board, valid, komi, visits })
//        -> { x, y } | { pass: true }, plus { where, ms, pondered }   (null: no engine at all)
//   svc.ponder([{ board, valid, komi, visits, p }, ...])   // most likely first; replaces earlier ponders
//   svc.status()  // for telemetry: engines, why the GPU is down, ponder hits
//   svc.close()
//
// ENGINES. One remote engine on the GPU host serves every board size (the
// card is time-sliced with other jobs, so a 5x5 eval costs what a 19x19 one
// does there — latency is the number of batches, not their size; README). The
// local CPU engines are one per board size, with the net's buffer pinned to it
// (katago.sizeOverride: a 5x5 eval is ~4x cheaper than on the default 19x19
// buffer). Every engine is started on first use and KEPT — the net load is
// seconds (CPU ~1s, GPU ~3s over ssh) and its NN cache is what makes a
// repeated or pondered position cheap — until it has been idle `idleMs`
// (default 30 min: Go not being played), then closed.
//
// FALLBACK, in order: the remote GPU engine; if it cannot start or dies (host
// unreachable, ssh drop, CUDA error) it is marked down for `remoteRetryMs` and
// the request is answered by the local CPU engine for that size; if KataGo is
// not installed locally either, choose() returns null and the CALLER falls back
// (go-solver: the model solver, then uct) and says so in its reply. Every
// downgrade is counted and the last reason kept in status().
//
// PONDERING. KataGo's analysis engine keeps no tree between queries, so the
// reuse is explicit: after we move, the caller predicts the AI's replies (the
// AI is the game's own getMove, sampled from tools/goai — ponderPositions()
// below) and asks for OUR answer to each, most likely first, while the AI's
// reply is still crawling through its timer hops. When the real position
// arrives it is looked up: a finished ponder is answered at once, a running
// one is awaited (it started early), and a miss terminates every ponder so the
// real query gets the engine to itself. Ponder results also leave their NN
// evaluations in the engine's cache, which a near-miss reuses.

import { startKataGo, pickMove, fromVertex } from "./katago.mjs";
import { parseBoard, makeGeometry, makeScratch, play as playStone, US, THEM } from "../../golib.js";

/** The board after a stone of `who` ('X' us / 'O' the AI) at (x, y), captures resolved; null if illegal. */
export function applyStone(board, x, y, who) {
  const N = board.length;
  const b = parseBoard(board);
  if (playStone(b, makeGeometry(N), x * N + y, who === "O" ? THEM : US, makeScratch(N)) < 0) return null;
  const ch = [".", "X", "O", "#"];
  const out = [];
  for (let i = 0; i < N; i++) {
    let row = "";
    for (let j = 0; j < N; j++) row += ch[b[i * N + j]];
    out.push(row);
  }
  return out;
}

export const SERVICE_DEFAULTS = { idleMs: 30 * 60e3, remoteRetryMs: 5 * 60e3, maxPonder: 4, localMax: 2 };

/** The cache key of a position query: board, komi, visits (the valid list follows from the board and history). */
/** Visits for a query on this engine: a number, or { gpu, cpu } (the GPU affords more). */
export function visitsOn(engine, visits) {
  if (visits && typeof visits === "object") return engine.where.startsWith("gpu") ? visits.gpu ?? visits.cpu : visits.cpu ?? visits.gpu;
  return visits;
}

export function positionKey(board, komi, visits) {
  return `${board.join("/")}|${komi}|${JSON.stringify(visits)}`;
}

export class KataGoService {
  // walls: the remote engine is the PATCHED one (offline nodes as walls,
  // katago.mjs header) — if it will not start (not installed on the host) the
  // stock engine is tried before the GPU is marked down. Every answer says
  // which it came from (`walls`), so go-solver can version the evidence.
  constructor({ remote = null, local = true, idleMs = SERVICE_DEFAULTS.idleMs, remoteRetryMs = SERVICE_DEFAULTS.remoteRetryMs, remoteOverride = "", remoteNet = null, localOverride = "", settings = null, queryOpts = {}, walls = true, log = () => {}, start = startKataGo } = {}) {
    this.walls = walls;
    this.settings = settings; // KataGo overrideSettings for every query (search utility)
    this.queryOpts = queryOpts; // extra toQuery options (experiments: allowUnsettledPass)
    this.remote = remote;
    this.local = local;
    this.idleMs = idleMs;
    this.remoteRetryMs = remoteRetryMs;
    this.remoteOverride = remoteOverride;
    this.remoteNet = remoteNet; // a net file in ~/katago on the host (default: the b18 in run-analysis.sh)
    this.localOverride = localOverride;
    this.log = log;
    this.start = start;
    this.remoteEngine = null;
    this.remoteStarting = null;
    this.remoteDownUntil = 0;
    this.remoteWhy = null;
    this.localEngines = new Map(); // size -> { engine, lastUse }
    this.localStarting = new Map();
    this.localWhy = null;
    this.lastUse = 0;
    this.ponders = new Map(); // key -> { id, engine, promise, done, result, terminated }
    this.stats = { asked: 0, gpu: 0, cpu: 0, none: 0, gpuFallbacks: 0, ponderHit: 0, ponderPartial: 0, ponderMiss: 0, ponderQueries: 0, cold: 0 };
    this.timer = setInterval(() => this.reapIdle(), 60e3);
    this.timer.unref?.();
  }

  /** Close engines nobody has used for idleMs. */
  reapIdle(now = Date.now()) {
    if (this.remoteEngine && now - this.lastUse > this.idleMs) {
      this.log(`katago: GPU engine idle ${Math.round((now - this.lastUse) / 60e3)} min — closed`);
      this.remoteEngine.close();
      this.remoteEngine = null;
    }
    for (const [size, e] of this.localEngines) {
      if (now - e.lastUse > this.idleMs) {
        e.engine.close();
        this.localEngines.delete(size);
      }
    }
  }

  async remoteUp() {
    if (!this.remote || Date.now() < this.remoteDownUntil) return null;
    if (this.remoteEngine?.alive()) return this.remoteEngine;
    if (this.remoteEngine) this.markRemoteDown(`engine ${this.remoteEngine.why() ?? "died"}`);
    if (Date.now() < this.remoteDownUntil) return null;
    if (!this.remoteStarting) {
      this.remoteStarting = (async () => {
        let why = null;
        let e = null;
        if (this.walls) {
          e = await this.start({ remote: this.remote, remoteNet: this.remoteNet, override: this.remoteOverride, walls: true, startTimeoutMs: 60000, log: (m) => (why = m) });
          if (!e) {
            this.wallsWhy = `${new Date().toISOString()} walls engine did not start: ${String(why ?? "").slice(0, 160)} — stock engine (holes as white stones)`;
            this.log(`katago: ${this.wallsWhy}`);
          }
        }
        if (!e) e = await this.start({ remote: this.remote, remoteNet: this.remoteNet, override: this.remoteOverride, startTimeoutMs: 60000, log: (m) => (why = m) });
        if (!e) this.markRemoteDown(why ?? "did not start");
        else {
          this.stats.cold++;
          this.log(`katago: GPU engine up on ${this.remote} in ${e.startMs}ms${e.walls ? " (walls)" : ""}`);
        }
        this.remoteEngine = e;
        this.remoteStarting = null;
        return e;
      })();
    }
    return this.remoteStarting;
  }

  markRemoteDown(why) {
    this.remoteWhy = `${new Date().toISOString()} ${String(why).slice(0, 200)}`;
    this.remoteDownUntil = Date.now() + this.remoteRetryMs;
    try {
      this.remoteEngine?.close();
    } catch {
      /* already gone */
    }
    this.remoteEngine = null;
    this.log(`katago: GPU engine on ${this.remote} DOWN (${String(why).slice(0, 160)}) — local CPU for ${Math.round(this.remoteRetryMs / 1000)}s`);
  }

  async localUp(size) {
    if (!this.local) return null;
    const have = this.localEngines.get(size);
    if (have?.engine.alive()) {
      have.lastUse = Date.now();
      return have.engine;
    }
    if (!this.localStarting.has(size)) {
      this.localStarting.set(size, (async () => {
        // At most localMax CPU engines (~150MB each): drop the least recently used.
        while (this.localEngines.size >= SERVICE_DEFAULTS.localMax) {
          const [oldest] = [...this.localEngines.entries()].sort((a, b) => a[1].lastUse - b[1].lastUse);
          oldest[1].engine.close();
          this.localEngines.delete(oldest[0]);
        }
        let why = null;
        const e = await this.start({ size, override: this.localOverride, log: (m) => (why = m) });
        if (e) {
          this.stats.cold++;
          this.localEngines.set(size, { engine: e, lastUse: Date.now() });
        } else this.localWhy = why ?? "did not start";
        this.localStarting.delete(size);
        return e;
      })());
    }
    return this.localStarting.get(size);
  }

  /** The engine that would answer a `size` request now (GPU first). */
  async engineFor(size) {
    return (await this.remoteUp()) ?? (await this.localUp(size));
  }

  /** One analysis on `engine`; the picked move, or null when the query produced no search (terminated early). */
  async run(engine, q) {
    const id = engine.nextId();
    const settings = q.settings ?? this.settings;
    const promise = engine.analyze(q.board, q.valid, q.komi, { ...this.queryOpts, visits: visitsOn(engine, q.visits), id, ...(settings ? { settings } : {}) });
    return { id, promise: promise.then((r) => (r?.moveInfos?.length ? pickMove(r.moveInfos) : null)) };
  }

  /** Our move for a position. Null only when no engine exists at all. */
  async choose(q) {
    this.stats.asked++;
    this.lastUse = Date.now();
    const t0 = performance.now();
    const key = positionKey(q.board, q.komi, q.visits);
    const hit = this.ponders.get(key);
    let pondered = false;
    let pick = null;
    let where = null;
    let walls = false;
    const legal = (m) => !m || m.move.toLowerCase() === "pass" || (() => {
      const v = fromVertex(m.move);
      return (q.valid ?? []).some(([x, y]) => x === v.x && y === v.y);
    })();
    if (hit && !hit.terminated) {
      if (hit.done) this.stats.ponderHit++;
      else this.stats.ponderPartial++;
      pondered = hit.done ? "hit" : "partial";
      try {
        pick = await hit.promise;
        where = hit.engine.where;
        walls = !!hit.engine.walls;
        // A pondered answer is checked against the game's own valid list
        // (superko) before it is trusted.
        if (pick && !legal(pick)) {
          pick = null;
          where = null;
        }
      } catch {
        pick = null;
      }
    } else if (this.ponders.size) this.stats.ponderMiss++;
    this.cancelPonders(key);
    if (!pick) {
      pondered = false;
      for (let attempt = 0; attempt < 2 && !pick; attempt++) {
        const engine = await this.engineFor(q.size);
        if (!engine) break;
        try {
          pick = await (await this.run(engine, q)).promise;
          where = engine.where;
          walls = !!engine.walls;
        } catch (err) {
          if (engine.alive()) {
            // KataGo refused THIS query (an "error" line) — the engine is fine;
            // the caller's fallback answers, and the reason is kept.
            this.queryWhy = String(err.message ?? err).slice(0, 200);
            break;
          }
          if (engine.where.startsWith("gpu")) {
            this.stats.gpuFallbacks++;
            this.markRemoteDown(err.message ?? err);
          } else {
            this.localWhy = String(err.message ?? err).slice(0, 200);
            this.localEngines.delete(q.size);
          }
        }
      }
    }
    if (!where) {
      this.stats.none++;
      return null;
    }
    this.stats[where.startsWith("gpu") ? "gpu" : "cpu"]++;
    const ms = performance.now() - t0;
    if (!pick) return { pass: true, where, ms, pondered, walls };
    return { ...fromVertex(pick.move), winrate: pick.winrate, scoreLead: pick.scoreLead, visits: pick.visits, where, ms, pondered, walls };
  }

  /** Terminate every running ponder except `keep`. */
  cancelPonders(keep = null) {
    for (const [key, p] of this.ponders) {
      if (key === keep) continue;
      if (!p.done) {
        p.terminated = true;
        p.engine.terminate(p.id);
      }
    }
    this.ponders.clear();
  }

  /**
   * Speculative answers for the positions we expect next (most likely first).
   * Replaces earlier ponders. Returns at once; the work runs on the engine.
   */
  async ponder(positions) {
    this.cancelPonders();
    if (!positions?.length) return;
    const engine = await this.engineFor(positions[0].size);
    if (!engine) return;
    for (const q of positions.slice(0, SERVICE_DEFAULTS.maxPonder)) {
      const key = positionKey(q.board, q.komi, q.visits);
      if (this.ponders.has(key)) continue;
      const { id, promise } = await this.run(engine, q);
      const entry = { id, engine, done: false, terminated: false, promise: null };
      entry.promise = promise.then(
        (pick) => {
          if (!entry.terminated) entry.done = true;
          return entry.terminated ? null : pick;
        },
        () => null,
      );
      this.ponders.set(key, entry);
      this.stats.ponderQueries++;
    }
  }

  /** Resolves when every running ponder has finished (or was terminated). */
  pondersSettled() {
    return Promise.allSettled([...this.ponders.values()].map((p) => p.promise));
  }

  status() {
    return {
      remote: this.remote ? { host: this.remote, up: !!this.remoteEngine?.alive(), downFor: Math.max(0, Math.round((this.remoteDownUntil - Date.now()) / 1000)), why: this.remoteWhy } : null,
      local: { sizes: [...this.localEngines.keys()], why: this.localWhy },
      walls: { want: this.walls, remote: !!this.remoteEngine?.walls, why: this.wallsWhy ?? null },
      queryWhy: this.queryWhy ?? null,
      stats: { ...this.stats },
    };
  }

  close() {
    clearInterval(this.timer);
    this.cancelPonders();
    this.remoteEngine?.close();
    for (const e of this.localEngines.values()) e.engine.close();
    this.localEngines.clear();
  }
}

/**
 * The positions to ponder after OUR move: the AI's likely replies, sampled
 * from the game's own getMove (tools/goai model — the same code the AI runs,
 * so these ARE its reply distribution, up to the sample count), each with
 * black's legal moves after it. A predicted pass ponders the board as it is
 * (the AI passed; we move again unless go.js mirror-passes).
 *
 *   model:   loadModel()'s object (reply, validMoves)
 *   board:   the board AFTER our move (simple board strings), white to move
 *   history: previous boards, most recent first (the AI's superko filter)
 *   play:    (board, x, y) -> board after a WHITE stone there (default applyStone)
 */
export async function ponderPositions({ model, board, history = [], opponent, komi, visits, size, samples = 12, play = (b, x, y) => applyStone(b, x, y, "O"), maxPositions = SERVICE_DEFAULTS.maxPonder }) {
  const counts = new Map();
  for (let i = 0; i < samples; i++) {
    let mv;
    try {
      mv = await model.reply(board, { opponent, history, rng: 1 + Math.floor(Math.random() * 3e7) });
    } catch {
      return [];
    }
    const k = mv ? `${mv.x},${mv.y}` : "pass";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const out = [];
  for (const [k, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxPositions)) {
    let after = board;
    if (k !== "pass") {
      const [x, y] = k.split(",").map(Number);
      after = play(board, x, y);
      if (!after) continue;
    }
    const hist = k === "pass" ? history : [board.join(""), ...history];
    out.push({ board: after, valid: model.validMoves(after, hist), history: hist, komi, visits, size, p: n / samples, reply: k });
  }
  return out;
}
