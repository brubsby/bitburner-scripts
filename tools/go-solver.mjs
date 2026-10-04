// External IPvGO solver: real search on a real core, outside the game.
//
//   node tools/go-solver.mjs [--maxms 1500] [--poll 400] [--katago-remote bubtop|none]
//                            [--katago-idle-min 30] [--no-ponder]
//   (started nice-19 by `npm run gosolver`)
//
// Why outside. Netscript runs on the browser's main thread, so every
// millisecond of in-game search is a millisecond the game's own loop (and the
// batcher, and the UI) does not run — which capped the in-game bot at ~20ms a
// move, and flat search at 20ms lost 90 straight games to the Daedalus AI.
// This process does the thinking instead: one OS process, niced to the lowest
// priority so it only consumes idle CPU, using seconds per move. The game
// thread does no computation at all.
//
// Protocol, via the RFA daemon's /rpc bridge (files on home):
//   /go/req.txt   written by go.js each turn:
//                 { seq, size, komi, board: [...], valid: [[x,y]...],
//                   maxms?, opts? }  — the optional pair only on 19x19 (the
//                 hidden opponent): a per-request budget and chooseMoveUCT
//                 options (node-power objective, widening, pass). A 5x5 request
//                 omits both and is searched at --maxms exactly as measured.
//                 golib.js changes need THIS process restarted to take effect
//                 (it imported golib once); the daemon's supervisor restarts it
//                 on exit, so killing it is the restart.
//   /go/move.txt  written back by this: { seq, x, y } or { seq, pass: true },
//                 plus backend / fallback / where / pondered (below).
//   /go/katago.txt  written by this (every 5 min and on change): whether a
//                 KataGo engine can answer — { at, gpu, cpu, remote: {...},
//                 service: {...} }. go.js reads it at every game boundary to
//                 choose each opponent's board and backend (SETTINGS.katago).
//
// go.js matches on `seq` and falls back to its own cheap local search if no
// reply arrives in time — so killing this process degrades the bot instead of
// stopping it, per the graceful-degradation rule in CLAUDE.md.
//
// The search itself is golib.js — the same module the in-game fallback uses,
// imported from the same file. One solver, two callers.
//
// BACKENDS (per request, `backend` in /go/req.txt; the reply says which ran):
//   uct    golib.chooseMoveUCT — minimax-style UCT, opponent unknown. The
//          default, and the fallback whenever `model` cannot run.
//   model  golib.chooseMoveModel — expectimax search against the opponent's
//          ACTUAL policy: the game's own getMove, bundled from game source by
//          tools/goai (build.mjs; verified reply-for-reply by check.mjs).
//          Needs `opponent` (and, for the AI's superko filter, `history`) in
//          the request. 5x5 Illuminati: 28% -> 90% won (tools/sim/go-w0.mjs).
//   katago tools/katago/service.mjs: the GPU engine on --katago-remote (one
//          persistent ssh session, tools/katago/gpu), else the local CPU
//          engine for that board size, kept warm until idle --katago-idle-min.
//          A request may name `fallback: "model"`: when no KataGo engine can
//          answer, the model search answers instead (then uct) — the reply's
//          `backend` and `fallback` say so, and go.js counts it.
// The model bundle is built on first use from ~/Repos/bitburner (esbuild); if
// that fails the solver says so on stderr ONCE and every model request is
// answered by uct with `backend: "uct", fallback: <why>` in the reply, which
// go.js counts — degraded, never silent.
//
// PONDERING (off with --no-ponder). After answering, the solver predicts the
// AI's reply from the model (the AI's own code, sampled) and works on OUR
// answer to it while the AI's reply crawls through its timer hops in the game:
//   katago: the answers to the likely replies, on the engine (service.ponder);
//   model:  the full-budget search for the single most likely reply, run here
//           (it blocks this loop for one budget — shorter than the AI's reply).
// The next request is answered from the ponder when its board matches (and
// the move is still in its valid list): `pondered: "hit"` in the reply.

import os from "node:os";
import { spawn } from "node:child_process";
import { chooseMoveUCT, chooseMoveModel } from "../golib.js";
import { loadModel } from "./goai/model.mjs";

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? Number(argv[i + 1]) : dflt;
};
const str = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : dflt;
};
const MAXMS = flag("maxms", 1500);
const POLL = flag("poll", 400);
// --rpc: another bridge (tests run the solver against a stub, never the live daemon).
const RPC = argv.includes("--rpc") ? argv[argv.indexOf("--rpc") + 1] : "http://127.0.0.1:12526/rpc";
// The GPU host for KataGo ("none": local CPU only). Env KATAGO_REMOTE overrides the default.
const REMOTE_RAW = str("katago-remote", process.env.KATAGO_REMOTE ?? "bubtop");
const REMOTE = REMOTE_RAW && REMOTE_RAW !== "none" ? REMOTE_RAW : null;
const IDLE_MS = flag("katago-idle-min", 30) * 60e3;
const PONDER = !argv.includes("--no-ponder");

// Lowest scheduling priority: only ever runs on CPU the rest of the machine
// is not using. This is the entire heat budget enforcement.
try {
  os.setPriority(19);
} catch {
  /* not fatal */
}

async function rpc(method, params) {
  const res = await fetch(RPC, { method: "POST", body: JSON.stringify({ method, params }) });
  return res.json();
}

let lastSeq = null;
let solved = 0;
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => process.exit(0));

// ---------------------------------------------------------------- KataGo
// The service is created on the FIRST katago request (an engine is ~150MB
// resident locally, ~0.5GB of GPU memory remotely, and only boards set to
// KataGo ask for it), then kept; its engines close themselves after IDLE_MS.
let kgMod = null;
let kgService = null;
async function katagoService() {
  if (kgService) return kgService;
  kgMod = kgMod ?? (await import("./katago/service.mjs"));
  const { installed } = await import("./katago/katago.mjs");
  kgService = new kgMod.KataGoService({ remote: REMOTE, local: installed(), idleMs: IDLE_MS, log: (m) => console.log(`go-solver: ${m}`) });
  return kgService;
}
process.on("exit", () => kgService?.close());

/** Why no KataGo engine answered, in one line. */
function katagoWhyNot() {
  const s = kgService?.status();
  const parts = [];
  if (REMOTE) parts.push(`GPU ${REMOTE}: ${s?.remote?.why ?? "not reachable"}`);
  parts.push(`CPU: ${s?.local?.why ?? "not installed (tools/katago/install.sh)"}`);
  return `katago unavailable — ${parts.join("; ")}`;
}

// THE STATUS go.js READS (/go/katago.txt). gpu: the remote host answers and
// has the engine installed (a 2-second ssh probe, no engine started — the GPU
// is only used while Go is played) and the service has not marked it down.
// cpu: the local engine is installed.
const katagoProbe = { gpu: null, checkedAt: 0, why: null };
async function probeRemote() {
  if (!REMOTE) return { ok: false, why: "no remote configured (--katago-remote none)" };
  return new Promise((resolve) => {
    const { SSH_OPTS, REMOTE_CMD } = { SSH_OPTS: ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8"], REMOTE_CMD: "katago/run-analysis.sh" };
    const p = spawn("ssh", [...SSH_OPTS, REMOTE, `test -x ${REMOTE_CMD} && echo KATAGO_OK`], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    const t = setTimeout(() => p.kill(), 15000);
    p.on("error", (e) => (err += String(e)));
    p.on("close", (code) => {
      clearTimeout(t);
      resolve(/KATAGO_OK/.test(out) ? { ok: true, why: null } : { ok: false, why: `ssh ${REMOTE}: exit ${code} ${err.trim().slice(0, 160) || "(engine not installed: tools/katago/gpu/install-gpu.sh)"}` });
    });
  });
}
let lastStatusText = null;
let lastStatusAt = 0;
async function publishKatagoStatus(force = false) {
  const now = Date.now();
  if (REMOTE && now - katagoProbe.checkedAt > 5 * 60e3) {
    const r = await probeRemote();
    katagoProbe.gpu = r.ok;
    katagoProbe.why = r.why;
    katagoProbe.checkedAt = Date.now();
  }
  const { installed } = await import("./katago/katago.mjs");
  const svc = kgService?.status() ?? null;
  const gpuDown = !!svc?.remote && svc.remote.downFor > 0;
  const status = {
    gpu: !!REMOTE && katagoProbe.gpu === true && !gpuDown,
    cpu: installed(),
    remote: REMOTE ? { host: REMOTE, reachable: katagoProbe.gpu, checkedAt: new Date(katagoProbe.checkedAt).toISOString(), why: gpuDown ? svc.remote.why : katagoProbe.why } : null,
    service: svc,
  };
  const text = JSON.stringify({ ...status, service: null });
  if (!force && text === lastStatusText && now - lastStatusAt < 5 * 60e3) return;
  lastStatusText = text;
  lastStatusAt = now;
  try {
    await rpc("pushFile", { filename: "/go/katago.txt", server: "home", content: JSON.stringify({ at: new Date().toISOString(), ...status }) });
  } catch {
    /* the bridge is down: the next publish retries */
  }
}

// ---------------------------------------------------------------- the model
// The opponent model: loaded once (and built if missing/stale). null = no model.
const model = await loadModel({ quiet: false });
const modelWhy = model ? null : "tools/goai opponent model could not be built or loaded (see stderr above)";
if (!model) console.error(`go-solver: ${modelWhy} — model requests will be answered by uct`);
console.log(`go-solver: ${MAXMS}ms/move, polling every ${POLL}ms, priority ${os.getPriority()}, model ${model ? "loaded" : "UNAVAILABLE"}, katago GPU ${REMOTE ?? "off"}, ponder ${PONDER ? "on" : "off"}`);

const validGrid = (N, list) => {
  const valid = Array.from({ length: N }, () => new Array(N).fill(false));
  for (const [x, y] of list || []) valid[x][y] = true;
  return valid;
};

/** The model search for one request: ranked moves, or throws. */
async function runModel(req, board, validList, maxms, opts, history, opponentPassed) {
  const N = req.size;
  const reply = (b, o) => model.reply(b, { ...o, opponent: req.opponent });
  return chooseMoveModel(board, validGrid(N, validList), N, req.komi ?? 5.5, maxms, { ...opts, history, opponentPassed }, { reply });
}

// The model's ponder: { key, ranked } for the most likely next position.
let modelPonder = null;
const ponderStats = { modelHit: 0, modelMiss: 0 };

await publishKatagoStatus(true);
let lastStatusTick = Date.now();

while (true) {
  try {
    if (Date.now() - lastStatusTick > 60e3) {
      lastStatusTick = Date.now();
      await publishKatagoStatus();
    }
    const r = await rpc("getFile", { filename: "/go/req.txt", server: "home" });
    if (r.result) {
      const req = JSON.parse(r.result);
      if (req.seq !== lastSeq && Array.isArray(req.board)) {
        lastSeq = req.seq;
        const N = req.size;

        // A request may carry its own budget and search options (go.js sends
        // them for the 19x19 hidden-opponent board, SETTINGS.bigBoard); a 5x5
        // request carries neither and searches exactly as measured. The budget
        // is clamped so a malformed request cannot pin a core for minutes.
        const maxms = Number.isFinite(req.maxms) ? Math.min(Math.max(req.maxms, 50), 20000) : MAXMS;
        const opts = req.opts && typeof req.opts === "object" ? req.opts : {};
        const history = Array.isArray(req.history) ? req.history : [];
        const opponentPassed = !!(req.opponentPassed ?? opts.opponentPassed);
        const t0 = Date.now();
        let backend = "uct";
        let fallback = null;
        let ranked;
        let extra = {};
        // The model path, for `model` requests and for `katago` requests that
        // name it as their fallback.
        const tryModel = async () => {
          if (!model) return modelWhy;
          if (!req.opponent) return "request carries no opponent";
          // A pondered answer for exactly this position (see PONDERING).
          const key = req.board.join("/");
          const p = modelPonder;
          modelPonder = null;
          const top = p?.ranked?.[0];
          if (p && p.key === key && !opponentPassed && top && (req.valid || []).some(([x, y]) => x === top.x && y === top.y)) {
            ranked = p.ranked;
            backend = "model";
            extra.pondered = "hit";
            ponderStats.modelHit++;
            return null;
          }
          if (p) ponderStats.modelMiss++;
          try {
            ranked = await runModel(req, req.board, req.valid, maxms, opts, history, opponentPassed);
            backend = "model";
            return null;
          } catch (err) {
            return `model search threw: ${String(err).slice(0, 160)}`;
          }
        };
        if (req.backend === "model") {
          fallback = await tryModel();
          if (fallback) console.error(`go-solver: seq=${req.seq} model -> uct: ${fallback}`);
        } else if (req.backend === "katago") {
          const svc = await katagoService();
          let k = null;
          try {
            k = await svc.choose({ size: N, board: req.board, valid: req.valid || [], komi: req.komi ?? 5.5, visits: Number.isFinite(req.visits) ? req.visits : 200, settings: req.settings && typeof req.settings === "object" ? req.settings : undefined });
          } catch (err) {
            k = null;
            console.error(`go-solver: katago threw: ${String(err).slice(0, 160)}`);
          }
          if (k) {
            ranked = k.pass ? [] : [{ x: k.x, y: k.y, iters: k.visits }];
            backend = "katago";
            extra = { where: k.where, ms: Math.round(k.ms), ...(k.pondered ? { pondered: k.pondered } : {}) };
          } else {
            fallback = katagoWhyNot();
            if (req.fallback === "model") {
              const why = await tryModel();
              if (why) fallback = `${fallback}; model: ${why}`;
            }
            console.error(`go-solver: seq=${req.seq} katago -> ${backend}: ${fallback}`);
            publishKatagoStatus(true);
          }
        }
        if (backend === "uct") ranked = chooseMoveUCT(req.board, validGrid(N, req.valid), N, req.komi ?? 5.5, maxms, opts);
        const move = ranked && ranked.length ? { seq: req.seq, x: ranked[0].x, y: ranked[0].y } : { seq: req.seq, pass: true };
        move.backend = backend;
        if (fallback) move.fallback = fallback;
        Object.assign(move, extra);

        await rpc("pushFile", { filename: "/go/move.txt", server: "home", content: JSON.stringify(move) });
        solved++;
        if (solved % 20 === 1) {
          console.log(
            `#${solved} seq=${req.seq} -> ${move.pass ? "pass" : move.x + "," + move.y} ` +
              `(${backend}${extra.where ? "@" + extra.where : ""}${extra.pondered ? " " + extra.pondered : ""}, ${Date.now() - t0}ms, ${ranked?.[0]?.iters ?? 0} iters${backend === "model" ? `, ${ranked?.[0]?.modelCalls ?? 0} model calls` : ""})` +
              (kgService ? ` katago ${JSON.stringify(kgService.status().stats)}` : "") +
              ` model ponder ${ponderStats.modelHit}/${ponderStats.modelHit + ponderStats.modelMiss}`,
          );
        }

        // PONDER (see the header): only with the model (it predicts the AI),
        // only after a stone (after a pass the next request is a mirror or the
        // same board), never on a malformed history.
        // Not KataGo on the big board: the hidden AI's reply is hard to
        // predict (8% hits, 6% partial over 4 games, go-w0 --ponder) and each
        // ponder is a full GPU search — it roughly doubled KataGo's share of
        // the card the cipher jobs run on, for nothing.
        const ponderThis = backend === "model" || (backend === "katago" && N < 13);
        if (PONDER && model && req.opponent && !move.pass && ponderThis) {
          try {
            kgMod = kgMod ?? (await import("./katago/service.mjs"));
            const after = kgMod.applyStone(req.board, move.x, move.y, "X");
            if (after) {
              const big = N >= 13;
              const positions = await kgMod.ponderPositions({ model, board: after, history: [req.board.join(""), ...history], opponent: req.opponent, komi: req.komi ?? 5.5, visits: Number.isFinite(req.visits) ? req.visits : 200, size: N, samples: big ? 4 : 8, maxPositions: backend === "model" ? 1 : big ? 2 : 3 });
              if (backend === "katago") {
                const settings = req.settings && typeof req.settings === "object" ? req.settings : undefined;
                await kgService.ponder(positions.map((p) => ({ ...p, settings })));
              } else if (positions[0] && positions[0].reply !== "pass") {
                const p = positions[0];
                const ranked2 = await runModel(req, p.board, p.valid, maxms, opts, p.history, false);
                modelPonder = { key: p.board.join("/"), ranked: ranked2 };
              }
            }
          } catch (err) {
            console.error(`go-solver: ponder failed: ${String(err).slice(0, 160)}`);
          }
        }
      }
    }
  } catch (err) {
    // Daemon restart, malformed request, game closed — all transient here.
    console.error(`go-solver: ${String(err).slice(0, 120)}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  await new Promise((r) => setTimeout(r, POLL));
}
