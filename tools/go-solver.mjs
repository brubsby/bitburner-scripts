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
// PONDERING (off with --no-ponder). The model's default (--model-ponder
// session, release 2) keeps ONE search tree across moves — see MODEL_PONDER.
// The release-1 scheme (--model-ponder reply), and KataGo's: after answering, the solver predicts the
// AI's reply from the model (the AI's own code, sampled) and works on OUR
// answer to it while the AI's reply crawls through its timer hops in the game:
//   katago: the answers to the likely replies, on the engine (service.ponder);
//   model:  the full-budget search for the single most likely reply, run here
//           (it blocks this loop for one budget — shorter than the AI's reply).
// The next request is answered from the ponder when its board matches (and
// the move is still in its valid list): `pondered: "hit"` in the reply.

import os from "node:os";
import { spawn } from "node:child_process";
import { chooseMoveUCT, chooseMoveModel, modelSession, seedCalib, applyMove } from "../golib.js";
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
// How the MODEL ponders (release 2, tools/sim/go-w0.mjs --session):
//   session  one search tree kept across moves (golib.modelSession): the
//            subtree under the AI's actual reply is the next root, the search
//            continues under our move for the AI's whole reply time (weighted
//            over its replies by the chance node), and a root that already
//            holds the budget's worth of visits answers at once.
//   reply    release 1: search the single most likely reply for one budget.
const MODEL_PONDER = str("model-ponder", "session");
// A ponder never runs longer than this without a request (go.js gone quiet).
const PONDER_CAP_MS = flag("ponder-cap-ms", 15000);
// While a game is on (a request in the last minute) the request file is polled
// every FAST_POLL ms — between ponder slices of the same length — instead of
// --poll. Live before 2026-10-04 (150ms poll, go.js reading every 250ms) a
// pondered, instant answer still took ~200ms to be picked up and ~250ms to be
// read: a third of a 5x5 turn. One getFile over the RFA bridge costs ~4ms.
const FAST_POLL = flag("fast-poll", 25);
let lastReqAt = 0;
// RELEASE 3. Named in every reply (`release`): go.js keys its win-rate
// posterior on backend + mode + release (goplan.solverVersion), so evidence
// from an older solver stops counting the moment this one answers.
const RELEASE = "r3";
// PRE-SENT ANSWERS: while pondering, the session's answers to the AI's likely
// replies (golib ponderAnswers: a reply's node holding the budget's work) are
// published to /go/ponder.txt every PUBLISH_MS; go.js plays a matching one
// the moment the AI moves, with no request, and NOTIFIES us (`played` in
// /go/req.txt) so the session re-roots and ponders on. --no-presend: off.
const PRESEND = !argv.includes("--no-presend");
const PUBLISH_MS = flag("publish-ms", 100);
// THE AI'S SEED (golib clockSeed): requests carry the playtime `T`; the AI's
// next reply is drawn from T + 200k with k calibrated online from the replies
// it actually made (seedCalib), one calibrator per path (a request's T is read
// before our search; a pre-sent move's T at the move). --no-clock: off.
const CLOCK = !argv.includes("--no-clock");
const calib = { req: seedCalib(), pre: seedCalib() };
// What the AI's last reply was computed from (to calibrate the seed lag).
let seedCtx = null;

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
let notices = 0;
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
// The session (MODEL_PONDER 'session'): one per opponent x board x komi;
// sessRate = work (model-calling iterations) per ms of a fresh full-budget
// search: what a reused root must already hold to answer at once.
let sess = null;
let sessKey = null;
let sessRate = null;

/** The AI's reply contained in a new request's board, relative to seedCtx: "x,y", "pass", or null (cannot tell). */
function replyIn(req, ctx) {
  if (!Array.isArray(req.board) || req.board.length !== ctx.board.length) return null;
  let found = null;
  for (let x = 0; x < req.board.length; x++) {
    for (let y = 0; y < req.board.length; y++) {
      if (req.board[x][y] === "O" && ctx.board[x][y] === ".") {
        if (found) return null; // two new white stones: not one reply (a new game, a cheat)
        found = `${x},${y}`;
      }
    }
  }
  if (found) return found;
  return req.opponentPassed ? "pass" : null;
}

/** SEED CALIBRATION: which k make the AI's own code (the model) give the reply it actually made from T + 200k. */
async function calibrateSeed(req) {
  const c = seedCtx;
  seedCtx = null;
  if (!c || !model || c.opponent !== req.opponent || c.size !== req.size) return;
  const actual = replyIn(req, c);
  if (!actual) return;
  const cal = calib[c.path];
  const matches = [];
  for (let k = cal.range[0]; k <= cal.range[1]; k++) {
    const m = await model.reply(c.board, { opponent: c.opponent, history: c.history, passCount: c.passCount, rng: c.T + 200 * k });
    if ((m ? `${m.x},${m.y}` : "pass") === actual) matches.push(k);
  }
  cal.observe(matches, cal.weights()[0]?.[0] ?? null);
}

/** What the AI's next reply will be computed from, after our move (x, y) or pass on `req`'s board. */
function rememberSeedCtx(req, path, x, y) {
  if (!(req.T > 0)) return;
  const moved = x !== null && x !== undefined;
  const after = moved ? applyMove(req.board, x, y) : req.board;
  if (!after) return;
  const history = Array.isArray(req.history) ? req.history : [];
  seedCtx = { path, T: req.T, opponent: req.opponent, size: req.size, board: after, history: moved ? [req.board.join(""), ...history] : history, passCount: moved ? 0 : req.opponentPassed ? 2 : 1 };
}

const seedStats = () => ({ req: calib.req.stats, pre: calib.pre.stats });
const clockFor = (req, path) => (CLOCK && req.T > 0 ? { T: req.T, kw: calib[path].weights(), turnTicks: ((Number.isFinite(req.turnS) ? req.turnS : 1.2) * 1000) / 200, jitter: 5, eps: 0.1 } : undefined);

let lastAnswers = null;
let lastAdaptive = null;
/** Publish the session's pre-sent answers (only when they changed). */
async function publishAnswers(minWork) {
  let answers = sess && sess.pondering ? sess.ponderAnswers({ minWork, max: 4 }) : [];
  // A position going badly is never pre-sent: it comes back as a request,
  // where the adaptive budget extends the search.
  if (lastAdaptive) answers = answers.filter((a) => !(typeof a.wr === "number" && a.wr < lastAdaptive.thr));
  const text = JSON.stringify(answers);
  if (text === lastAnswers) return;
  lastAnswers = text;
  try {
    await rpc("pushFile", { filename: "/go/ponder.txt", server: "home", content: JSON.stringify({ at: new Date().toISOString(), seq: lastSeq, release: RELEASE, answers }) });
  } catch {
    /* the bridge is down: go.js falls back to asking */
  }
}

/**
 * THE PONDER: search under our move for the AI's whole reply time, in FAST_POLL
 * slices, publishing the pre-sent answers every PUBLISH_MS, until the next
 * request (or notice) arrives or PONDER_CAP_MS passes. Returns true when a new
 * request is waiting.
 */
async function ponderUntilNext(maxms) {
  const minWork = sessRate ? Math.round(sessRate * maxms) : Infinity;
  if (PRESEND) await publishAnswers(minWork);
  if (!PONDER || !sess?.pondering) return false;
  const until = Date.now() + PONDER_CAP_MS;
  let lastPub = Date.now();
  while (Date.now() < until) {
    await sess.ponder(FAST_POLL);
    if (PRESEND && Date.now() - lastPub >= PUBLISH_MS) {
      lastPub = Date.now();
      await publishAnswers(minWork);
    }
    const r2 = await rpc("getFile", { filename: "/go/req.txt", server: "home" });
    let next = null;
    try {
      next = r2.result ? JSON.parse(r2.result).seq : null;
    } catch {
      /* half-written: poll again */
    }
    if (next !== null && next !== lastSeq) return true;
  }
  return false;
}

await publishKatagoStatus(true);
let lastStatusTick = Date.now();

let skipSleep = false;
while (true) {
  skipSleep = false;
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
        lastReqAt = Date.now();
        const N = req.size;
        lastAdaptive = req.adaptive && typeof req.adaptive === "object" ? req.adaptive : null;
        await calibrateSeed(req);

        // A NOTICE (release 3): go.js already played a pre-sent answer on this
        // board — re-root the session there (a reuse), commit the move, ponder.
        if (req.played && typeof req.played === "object" && model && req.opponent && MODEL_PONDER === "session") {
          try {
            const key = `${req.opponent}|${N}|${req.komi ?? 5.5}`;
            if (!sess || sessKey !== key) {
              const reply = (b, o) => model.reply(b, { ...o, opponent: req.opponent });
              sess = modelSession(N, req.komi ?? 5.5, { reply }, {});
              sessKey = key;
            }
            const history = Array.isArray(req.history) ? req.history : [];
            sess.setRoot(req.board, validGrid(N, req.valid), { history, opponentPassed: !!req.opponentPassed, objective: req.objective ?? null, clock: clockFor(req, "pre") });
            const pl = req.played;
            sess.commit(pl.pass ? null : pl.x, pl.pass ? null : pl.y);
            rememberSeedCtx(req, "pre", pl.pass ? null : pl.x, pl.pass ? null : pl.y);
            notices++;
            const maxms = Number.isFinite(req.maxms) ? Math.min(Math.max(req.maxms, 50), 20000) : MAXMS;
            skipSleep = await ponderUntilNext(maxms);
          } catch (err) {
            sess = null;
            console.error(`go-solver: notice seq=${req.seq} failed: ${String(err).slice(0, 160)}`);
          }
          continue;
        }

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
          if (MODEL_PONDER === "session") {
            try {
              const key = `${req.opponent}|${N}|${req.komi ?? 5.5}`;
              if (!sess || sessKey !== key) {
                const reply = (b, o) => model.reply(b, { ...o, opponent: req.opponent });
                sess = modelSession(N, req.komi ?? 5.5, { reply }, opts);
                sessKey = key;
              }
              const r = sess.setRoot(req.board, validGrid(N, req.valid), { history, opponentPassed, objective: req.objective ?? null, clock: clockFor(req, "req") });
              backend = "model";
              extra.mode = "session";
              if (!r) {
                ranked = null; // PASS is all there is
                return null;
              }
              const target = sessRate ? Math.round(sessRate * maxms) : Infinity;
              // Early stop on WORK (model-calling iterations), never visits:
              // pass-pass terminal lines inflate visits for free (golib iterate).
              const its = await sess.search({ maxms, untilWork: r.reused ? target : Infinity });
              if (!r.reused) sessRate = sessRate ? 0.8 * sessRate + 0.2 * (sess.rootWork / maxms) : sess.rootWork / maxms;
              ranked = sess.best();
              // ADAPTIVE BUDGET (req.adaptive {thr, mult}, go.js SETTINGS.adaptive):
              // the chosen move's own line wins under thr -> search on for
              // (mult - 1) x the budget (a hard layout; the streak is at stake).
              const wr = ranked?.[0]?.top?.[0]?.[4];
              const ad = req.adaptive && typeof req.adaptive === "object" ? req.adaptive : null;
              if (ad && ranked && ranked.length && typeof wr === "number" && wr < ad.thr && ad.mult > 1) {
                await sess.search({ maxms: Math.min(20000, (ad.mult - 1) * maxms) });
                ranked = sess.best();
                extra.adaptive = true;
              }
              extra.rootWork = r.work;
              if (r.reused) {
                extra.pondered = its <= 1 ? "hit" : "partial";
                ponderStats.modelHit += its <= 1 ? 1 : 0;
              } else ponderStats.modelMiss++;
              return null;
            } catch (err) {
              sess = null;
              return `model session threw: ${String(err).slice(0, 160)}`;
            }
          }
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
        move.release = RELEASE;
        if (fallback) move.fallback = fallback;
        Object.assign(move, extra);
        // The search's top 3 [x, y, value, visits, winRate] for go.js's per-game log.
        if (ranked?.[0]?.top) move.top = ranked[0].top;
        if (backend === "model") move.seed = seedStats();

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
        // The session ponders itself: commit our move, then search under it
        // in slices until the next request arrives (or PONDER_CAP_MS).
        if (backend === "model" && extra.mode === "session" && sess) {
          sess.commit(move.pass ? null : move.x, move.pass ? null : move.y);
          rememberSeedCtx(req, "req", move.pass ? null : move.x, move.pass ? null : move.y);
          skipSleep = await ponderUntilNext(maxms);
        }
        const ponderThis = (backend === "model" && extra.mode !== "session") || (backend === "katago" && N < 13);
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
  if (!skipSleep) await new Promise((r) => setTimeout(r, Date.now() - lastReqAt < 60e3 ? FAST_POLL : POLL));
}
