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
import { chooseMoveUCT, chooseMoveModel, modelSession, seedCalib, gapCalib, applyMove, bookMove, oracleCandidates, oracleLineHolds, cheatRoll, cheatChance } from "../golib.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
// Retimes taken (a played request's ponder re-anchored at the play's T), and
// the budget the last ponder ran under (a retime resumes it).
let retimes = 0;
let lastPonderMs = MAXMS;
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
  seedCtx = { path, T: req.T, opponent: req.opponent, size: req.size, board: after, history: moved ? [req.board.join(""), ...history] : history, passCount: moved ? 0 : req.opponentPassed ? 2 : 1, histLen: history.length };
}

// THE PLAY CADENCE (golib gapCalib -> clockSeed `gaps`), per opponent: engine
// ticks between two of our consecutive plays in one game, from the playtime
// of every play we learn of (a notice's T; a retime's T). The ponder seeds the
// AI's reply to our NEXT move (d = 1) a measured gap after this play, not
// round(turnS / 0.2) +- 5 ticks: live Netburners plays 2-4 ticks apart (92%),
// which that blur spread over -1..9 — and a pre-sent PASS, a bet on the AI's
// seeded reply, looked winning across ticks the AI is never drawn at (the
// 2026-10-09 17:24:13Z loss). Learned always (published in `seed.gaps`), USED
// only with --clock-gaps: MEASURED NEGATIVE (see golib clockSeed).
const CLOCK_GAPS = argv.includes("--clock-gaps");
const gapCals = new Map();
let lastPlay = null;
/** A play of ours at playtime T, the position's history `histLen` boards long. */
function notePlay(opponent, T, histLen) {
  if (!(T > 0) || !Number.isFinite(histLen)) return;
  if (lastPlay && lastPlay.opponent === opponent && histLen > lastPlay.histLen && histLen <= lastPlay.histLen + 2) {
    if (!gapCals.has(opponent)) gapCals.set(opponent, gapCalib());
    gapCals.get(opponent).observe((T - lastPlay.T) / 200);
  }
  lastPlay = { opponent, T, histLen };
}
const gapsFor = (opponent) => (CLOCK_GAPS ? gapCals.get(opponent)?.weights() ?? null : null);

const seedStats = () => ({ req: calib.req.stats, pre: calib.pre.stats, retimes, gaps: Object.fromEntries([...gapCals].map(([o, c]) => [o, c.stats])) });
const clockFor = (req, path) => {
  if (!(CLOCK && req.T > 0)) return undefined;
  const gaps = gapsFor(req.opponent);
  return { T: req.T, kw: calib[path].weights(), turnTicks: ((Number.isFinite(req.turnS) ? req.turnS : 1.2) * 1000) / 200, jitter: 5, eps: 0.1, ...(gaps ? { gaps } : {}) };
};

// THE OPENING BOOK (tools/sim/go-book.mjs; --no-book: off): tools/goai/book-<Opponent>.json,
// deep offline searches of the first moves, keyed by position up to symmetry
// (golib.bookMove). A request on a book position is answered at once, and the
// book's answers to the AI's sampled replies are published with the ponder's
// pre-sent answers — no live search time. Re-read when the file changes.
const BOOK_ON = !argv.includes("--no-book");
const BOOK_DIR = str("book-dir", path.join(path.dirname(fileURLToPath(import.meta.url)), "goai"));
const books = new Map(); // opponent -> { book, mtime, checked }
const bookStats = { hits: 0, published: 0, oracle: 0, oracleMiss: 0, withheld: 0 };

// THE PASS-FORCING BOOK (tools/sim/go-oracle.mjs + go-oracle-book.mjs): the
// book file's `oracle` / `oraclePass` tables hold CANDIDATES per position —
// moves of winning lines found against the AI at one game clock, each with the
// reply its line expects. A candidate is played only when the AI's reply
// predicted from THIS request's clock (T + 200k, k over the calibrated lag
// weights) is the expected one with weight >= ORACLE_MIN; the best-valued such
// candidate is answered at once. Positions holding candidates are never
// pre-sent (the check needs the request's T), so they always come back as a
// request. MEASURED (tools/sim/go-w0.mjs --oracle-book, see the commit).
// --no-oracle: off.
const ORACLE_ON = !argv.includes("--no-oracle");
const ORACLE_MIN = flag("oracle-min", 0.6);
// THE JOINT CHEAT (go.js SETTINGS.cheat.joint; --no-joint: off). A request
// carrying `cheat` {crime, sf14, cheats, max, turn, fromTurn, minChance} (and
// T) lets the session search PAIRS of stones wherever the roll's clock says a
// playTwoMoves cheat is available — at the request (its T plus the search and
// a round trip) and, while pondering, after the AI's reply (one turn later, a
// wider margin) — and ONLY pairs there (the search picks the best pair rather
// than weighing pairs against singles on thin subtrees). Answers and pre-sent
// answers then carry `second`; go.js plays the pair as one cheat with no
// second-stone request. MEASURED: tools/sim/go-w0.mjs --cheat-joint 6:5:only
// (see the commit).
const JOINT = !argv.includes("--no-joint");
const JOINT_OPTS = JOINT ? { pairs: [6, 5], pairsOnly: true } : {};
// THE SMALL NET (--smallnet FILE [--smallnet-depth D]): a distilled walls-KataGo
// net (tools/katago/distill_train.py -> smallnet.mjs, plain JS in this process)
// as the model search's move prior and leaf value at the B nodes within D of
// our turns of the root (golib modelSession opts.nn, mix 0). ON by default (below).
// MEASURED (go-w0, 5x5 Tetrads live config: book + pass-forcing book + greedy
// cheats at crime 3.459, --work-rate 1.7, the net's time charged at this
// laptop's speed): b4c32 depth 1 vs the live solver, paired deals,
// +10.0% [+2.7, +17.8] (layouts 100-199) and +5.1% [-1.0, +11.7] (0-99).
// Only a net of the request's board size is used.
// DEFAULT ON (2026-10-08): the b4c32 net at depth 1 measured +7.6% [+3.5, +11.7]
// power/h over 300 paired 5x5 games at the live config (all won; 18c443d).
// The daemon passes fixed args, so the default lives here; --no-smallnet turns it off.
const SMALLNET_DEFAULT = path.join(path.dirname(fileURLToPath(import.meta.url)), "goai", "smallnet-5-b4c32.json");
const SMALLNET_FILE = argv.includes("--no-smallnet") ? null : str("smallnet", fs.existsSync(SMALLNET_DEFAULT) ? SMALLNET_DEFAULT : null);
const SMALLNET_DEPTH = flag("smallnet-depth", 1);
let SMALLNET = null;
if (SMALLNET_FILE) {
  try {
    const { loadSmallNet } = await import("./katago/smallnet.mjs");
    SMALLNET = loadSmallNet(SMALLNET_FILE);
  } catch (err) {
    console.error(`go-solver: --smallnet ${SMALLNET_FILE} did not load (${String(err).slice(0, 160)}) — the model search runs without a net`);
  }
}
// PER OPPONENT: only where it was measured positive at that opponent's live
// config (--smallnet-on A,B,... game names, or "all"). MEASURED, b4c32 depth 1
// vs the live solver, paired, each opponent's live config, --work-rate 1.7:
//   Tetrads     +7.6%  [+3.5, +11.7]  300 games, 300/300 vs 300/300 won
//   Daedalus    +7.9%  [+3.3, +12.7]  200 games, 200/200 vs 200/200 (29,613 -> 31,960 power/h)
//   Illuminati  +10.5% [+5.5, +15.5]  200 games, 199/200 vs 200/200; +9.2% power/h at the
//               stationary streak with the loss priced (185,156 -> 202,242)
//   SlumSnakes  +6.9%  [+1.2, +13.1]  200 games, 200/200 vs 199/200 (20,638 -> 22,307 power/h)
//   Netburners  +4.8%  [-2.1, +12.6]  200 games, 200/200 vs 198/200 (17,008 -> 18,237 power/h
//               with the losses priced) — on: no measured downside, fewer losses
// The Black Hand: not measured (off).
const SMALLNET_ON = new Set(str("smallnet-on", "Tetrads,Daedalus,Illuminati,SlumSnakes,Netburners").split(",").map((s) => s.trim().replace(/\s+/g, "")).filter(Boolean));
const smallnetFor = (N, opponent) => !!SMALLNET && SMALLNET.size === N && (SMALLNET_ON.has("all") || SMALLNET_ON.has(String(opponent ?? "").replace(/\s+/g, "")));
console.log(`go-solver: smallnet ${SMALLNET ? `${SMALLNET_FILE} (${SMALLNET.size}x${SMALLNET.size}, depth ${SMALLNET_DEPTH}) for ${[...SMALLNET_ON].join(",")}` : "off"}`);
// THE OUTCOME NET (--smallnet-outcome FILE, --smallnet-outcome-on A,B,...):
// b4c32 fine-tuned with turns-left / final-area heads on 1,639 deployed-config
// Tetrads games (tools/katago/distill_train.py --outcome), used with STEER
// (golib nn.steer: every playout leaf is charged the time the net predicts
// is left). MEASURED vs the b4c32 net, Tetrads live config, 400 paired:
// +3.5% [+0.4, +6.7] power/h (37,000 -> 38,280), 400/400 vs 400/400 won.
// Default for Tetrads only (the only opponent it was trained and measured on).
const OUTCOME_DEFAULT = path.join(path.dirname(fileURLToPath(import.meta.url)), "goai", "smallnet-5-o2.json");
const OUTCOME_FILE = argv.includes("--no-smallnet") || argv.includes("--no-smallnet-outcome") ? null : str("smallnet-outcome", fs.existsSync(OUTCOME_DEFAULT) ? OUTCOME_DEFAULT : null);
const OUTCOME_ON = new Set(str("smallnet-outcome-on", "Tetrads").split(",").map((s) => s.trim().replace(/\s+/g, "")).filter(Boolean));
let OUTCOME = null;
if (OUTCOME_FILE) {
  try {
    const { loadSmallNet } = await import("./katago/smallnet.mjs");
    OUTCOME = loadSmallNet(OUTCOME_FILE);
  } catch (err) {
    console.error(`go-solver: --smallnet-outcome ${OUTCOME_FILE} did not load (${String(err).slice(0, 160)}) — the b4c32 net plays those opponents`);
  }
}
const outcomeFor = (N, opponent) => !!OUTCOME && OUTCOME.size === N && OUTCOME_ON.has(String(opponent ?? "").replace(/\s+/g, ""));
console.log(`go-solver: outcome net ${OUTCOME ? `${OUTCOME_FILE} (steer) for ${[...OUTCOME_ON].join(",")}` : "off"}`);
// THE PRIOR FLOOR (golib nn.priorFloor, --prior-floor-on Opp:E,... ; "none"
// off): a share E of the net's prior spread evenly over a node's actions, so a
// stone the policy all but rules out is still tried within the budget.
// The 2026-10-09 14:56:31Z Daedalus loss: b4c32 gave the only winning stones
// (4,2 16-5.5, 0,1 13-7.5) priors < 0.003 and the losing 2,1 0.64; at 800
// work every seed played 2,1 (lost), floored at 0.1 every seed played 4,2.
// MEASURED NEGATIVE (go-w0, Daedalus live config, b4c32 depth 1, --work-rate
// 1.7, bubtop, layouts 1401-1408, paired vs the live solver):
//   floor 0.1 everywhere             -2.0% [-4.8, +1.0]  529 games, lost 0 vs 1
//   0.1 at decision nodes only       -3.6% [-7.2, +0.2]  524 games, lost 2 vs 1
//   0.1 where lines win < 0.3        -5.9% [-10.4, -1.4] 253 games, lost 1 vs 0
//   0.2 where lines win < 0.3        -6.2% [-10.9, -1.5] 248 games, lost 1 vs 0
// Every arm plays longer games (9.7-9.95 s vs 9.3 s) for no fewer losses, so
// it stays OFF (the corpus case stays open). Kept for the next net / budget.
const PRIOR_FLOOR_ON = new Map(
  str("prior-floor-on", "none")
    .split(",")
    .map((s) => s.trim().replace(/\s+/g, "").split(":"))
    .filter(([o, e]) => o && o !== "none" && Number.isFinite(Number(e)))
    .map(([o, e]) => [o, Number(e)]),
);
const priorFloorFor = (opponent) => PRIOR_FLOOR_ON.get(String(opponent ?? "").replace(/\s+/g, "")) ?? 0;
console.log(`go-solver: prior floor ${PRIOR_FLOOR_ON.size ? [...PRIOR_FLOOR_ON].map(([o, e]) => `${o} ${e}`).join(", ") : "off"}`);
// THE OPEN PASS RULE (golib opts.openPass 'visits', --open-pass-visits Opp,...;
// "none" off): a PASS while the AI has not passed (the game goes on) must be
// the most-visited child, not merely "clearly better" on a handful of visits
// (golib.modelRootPasses' escape, kept for the exact game-ending pass). The
// 2026-10-09 17:24:13Z Netburners loss (streak 88, 9-13.5) was two PRE-SENT
// passes on an open board (ply 3: the AI took the vital 3,2, which wins 16/16
// replays; ply 8: it took 0,3). A pass there is a bet on the AI's seeded
// reply; on few visits it is noise. MEASURED (go-w0, live config + b4c32
// depth 1, --work-rate 1.7, bubtop, paired vs the live solver):
//   Netburners layouts 1701-1704  1200 paired  +2.6% [+0.4, +5.0]  black 16.28 -> 16.48, 5.39 -> 5.32 s/game, 0 vs 0 lost
// (and, rejected: 'never' +0.9% [-1.3, +3.1] but wrong in principle — from
// ply 9 of that game the only stone loses every line and the pass wins;
// 'request' -0.1%; 'fresh' +1.4% [-0.8, +3.7]; clock gaps -0.5% / -3.2% / -4.7%).
const OPEN_PASS_VISITS = new Set(
  str("open-pass-visits", "Netburners")
    .split(",")
    .map((s) => s.trim().replace(/\s+/g, ""))
    .filter((s) => s && s !== "none"),
);
console.log(`go-solver: open pass needs the most visits for ${OPEN_PASS_VISITS.size ? [...OPEN_PASS_VISITS].join(",") : "nobody"}`);
// THE LATE PRIOR (golib nn.lateCap K, --late-cap-on Opp:K,... ; "none" off):
// a node the net reaches only after it was searched without it (grown beyond
// nn.maxDepth under an earlier root or ponder; now a ponder reply or a reused
// root — a decision node) has its children capped to K visits (means kept)
// and its prior normalised over every action, before it can answer. The
// 2026-10-09 20:52:10Z Daedalus loss (streak 179, 0-27.5): the ply-0 ponder
// grew the 1,3 reply node playout-only (~1000 work), and when the ponder
// under 3,2 made it a decision node its stale most-visited 4,3 was pre-sent
// at once (from ply 3 every line loses; no net search ever picks 4,3, 0/96).
// MEASURED NEUTRAL-TO-NEGATIVE (go-w0, Daedalus live config + b4c32 depth 1,
// --work-rate 1.7, bubtop, layouts 2101-2112, 2160 paired vs the live solver):
//   lateCap 0   -0.5% [-2.2, +1.1]  lost 8 vs 2   9.46 vs 9.65 s/game
//   lateCap 16  +0.2% [-1.3, +1.7]  lost 5 vs 2   9.52 vs 9.65 s/game
// The cap fires ~15-35 times a game (every ponder reply grown a move earlier)
// and the playout-only statistics it discards are as often right as the net
// (the 14:56:31Z case is the net's blind spot the other way), so it is OFF;
// the corpus case stays open. Kept for the next net / budget.
const LATE_CAP_ON = new Map(
  str("late-cap-on", "none")
    .split(",")
    .map((s) => s.trim().replace(/\s+/g, "").split(":"))
    .filter(([o, e]) => o && o !== "none" && Number.isFinite(Number(e)))
    .map(([o, e]) => [o, Number(e)]),
);
const lateCapFor = (opponent) => LATE_CAP_ON.get(String(opponent ?? "").replace(/\s+/g, ""));
console.log(`go-solver: late-prior cap ${LATE_CAP_ON.size ? [...LATE_CAP_ON].map(([o, e]) => `${o} ${e}`).join(", ") : "off"}`);
const sessOpts = (N, opponent, base = {}) => {
  const out = { ...base, ...JOINT_OPTS };
  if (OPEN_PASS_VISITS.has(String(opponent ?? "").replace(/\s+/g, ""))) out.openPass = "visits";
  const floor = priorFloorFor(opponent);
  const lc = lateCapFor(opponent);
  const extra = { ...(floor ? { priorFloor: floor } : {}), ...(Number.isFinite(lc) ? { lateCap: lc } : {}) };
  if (outcomeFor(N, opponent)) out.nn = { eval: async (b, k) => OUTCOME.eval(b, k), mix: 0, maxDepth: SMALLNET_DEPTH, parallel: 1, steer: true, ...extra };
  else if (smallnetFor(N, opponent)) out.nn = { eval: async (b, k) => SMALLNET.eval(b, k), mix: 0, maxDepth: SMALLNET_DEPTH, parallel: 1, ...extra };
  return out;
};
/** fn(cheatsSoFar) -> available, for a play `lagMs` after req.T, `depth` of our turns ahead. */
function cheatFnOf(req, lagMs, depth, margin) {
  const c = req?.cheat;
  if (!JOINT || !c || !(req.T > 0) || !(c.crime > 0)) return null;
  return (k) => c.turn + depth >= c.fromTurn && k < c.max && cheatChance(k, c.crime, c.sf14 ?? 0) >= (c.minChance ?? 0.0034) && cheatRoll(req.T + lagMs) <= cheatChance(k, c.crime, c.sf14 ?? 0) - margin;
}
const jointStats = { pairs: 0, requests: 0 };
const ORACLE_BOOK_FIRST = argv.includes("--oracle-book-first");
// THE GUARD: a candidate the (reused, pondered) tree has searched >= GUARD_V
// times and found winning in GUARD_D (share of lines) less than its best stone
// is skipped — a line is a plan against one predicted reply sequence; the
// tree prices the others.
const GUARD_V = flag("oracle-guard-visits", 20);
const GUARD_D = flag("oracle-guard-drop", 0.15);
// The candidates live in their own file, tools/goai/oracle-<Opponent>.json
// (go-oracle-book.mjs), so the opening-book builds (go-book --merge) never
// clobber them; re-read when it changes, like the book.
const oracles = new Map();
function oracleFor(opponent) {
  if (!ORACLE_ON || !opponent) return null;
  const file = path.join(BOOK_DIR, `oracle-${String(opponent).replace(/\s+/g, "")}.json`);
  let b = oracles.get(opponent);
  const now = Date.now();
  if (b && now - b.checked < 60e3) return b.book;
  try {
    const mtime = fs.statSync(file).mtimeMs;
    if (!b || b.mtime !== mtime) {
      b = { book: JSON.parse(fs.readFileSync(file, "utf8")), mtime, checked: now };
      console.log(`go-solver: pass-forcing candidates for ${opponent}: ${Object.keys(b.book.oracle ?? {}).length} positions + ${Object.keys(b.book.oraclePass ?? {}).length} after-pass (${file})`);
    } else b.checked = now;
  } catch {
    b = { book: null, mtime: null, checked: now };
  }
  oracles.set(opponent, b);
  return b.book;
}
async function oraclePick(req, history, opponentPassed) {
  if (!ORACLE_ON || !model || !(CLOCK && req.T > 0)) return null;
  const book = oracleFor(req.opponent);
  // --oracle-book-first: never where the opening book holds the position.
  // Off by default: the measured arm (go-w0 --oracle-full --oracle-override-book)
  // lets a candidate replace the book's move ONLY when its whole line holds
  // (below) — with the book first no candidate is ever reached, since the
  // plans start from the empty layout (go-w0 2026-10-06: 0 oracle moves/game).
  if (ORACLE_BOOK_FIRST && !opponentPassed && bookMove(bookFor(req.opponent), req.board)) return null;
  const cands = oracleCandidates(book, req.board, { passed: opponentPassed });
  if (!cands.length) return null;
  const valid = new Set((req.valid || []).map(([x, y]) => `${x},${y}`));
  // The lag: an instant answer is played ~one poll after the request's T, so
  // the pre-sent path's lag (calibrated at the play, the retime) applies from
  // T or one tick later — both weighed. (The request path's own calibration is
  // dominated by searched answers, a few ticks later.)
  const kw = calib.pre.weights().flatMap(([k, w]) => [[k, w / 2], [k + 1, w / 2]]);
  const hist = [req.board.join(""), ...history];
  for (const c of cands) {
    if (!valid.has(`${c.x},${c.y}`)) continue;
    const st = sess ? sess.childStats(c.x, c.y, null, false, GUARD_V) : null;
    if (st && st.visits >= GUARD_V && st.bestWins !== null && st.wins < st.bestWins - GUARD_D) {
      bookStats.oracleGuarded = (bookStats.oracleGuarded ?? 0) + 1;
      continue;
    }
    if (c.second) continue; // cheat steps: go.js plays cheats itself (SETTINGS.cheat), not from here
    // THE FULL-LINE CHECK (golib.oracleLineHolds): the WHOLE line to the AI's
    // pass must be the one this game's clock produces — not only the next
    // reply (live 21:07Z: a candidate from another clock's plan was played,
    // its next step did not come, and the game was wiped 0-28.5).
    const hold = await oracleLineHolds(c, req.board, history, req.T, kw, (b, o) => model.reply(b, { ...o, opponent: req.opponent }), { tt: 5 });
    if (!hold.ok) { if (hold.mass >= ORACLE_MIN) bookStats.oracleLineFail = (bookStats.oracleLineFail ?? 0) + 1; continue; }
    if (hold.mass >= ORACLE_MIN) return { x: c.x, y: c.y, v: c.v, mass: +hold.mass.toFixed(3) };
  }
  bookStats.oracleMiss++;
  return null;
}
/** A position the pass-forcing book holds candidates for (never pre-sent). */
function hasOracle(opponent, b, N, pc) {
  if (!ORACLE_ON) return false;
  const book = oracleFor(opponent);
  if (!book || !(book.oracle || book.oraclePass)) return false;
  return oracleCandidates(book, Array.from({ length: N }, (_, x) => b.slice(x * N, (x + 1) * N)), { passed: pc === 1 }).length > 0;
}
function bookFor(opponent) {
  if (!BOOK_ON || !opponent) return null;
  const file = path.join(BOOK_DIR, `book-${String(opponent).replace(/\s+/g, "")}.json`);
  let b = books.get(opponent);
  const now = Date.now();
  if (b && now - b.checked < 60e3) return b.book;
  try {
    const mtime = fs.statSync(file).mtimeMs;
    if (!b || b.mtime !== mtime) {
      b = { book: JSON.parse(fs.readFileSync(file, "utf8")), mtime, checked: now };
      console.log(`go-solver: opening book for ${opponent}: ${Object.keys(b.book.entries ?? {}).length} positions (${file})`);
    } else b.checked = now;
  } catch {
    b = { book: null, mtime: null, checked: now };
  }
  books.set(opponent, b);
  return b.book;
}
let bookOpp = null;

// Model-session throws seen (each logged with its stack; see tryModel), and
// --fault-session K: the first K session requests throw (tests the retry).
let sessThrows = 0;
/**
 * DIAGNOSABLE: the stack and the request that threw, on stderr and in a file
 * ($TMPDIR/go-solver-throw-<n>.json, the last 5 kept) — the daemon log held
 * only the message ("Cannot read properties of undefined (reading 'length')",
 * on the request path 7 times and then on the NOTICE path), with no way to
 * find the cause. golib annotates a throw inside the AI model with the board
 * and the history it was given (modelSession callModel).
 */
function reportThrow(where, err, req) {
  sessThrows++;
  const stack = String(err?.stack ?? err).split("\n").slice(0, 12).join("\n");
  console.error(`go-solver: ${where} seq=${req?.seq} model session threw (#${sessThrows}):\n${stack}`);
  try {
    const dump = path.join(os.tmpdir(), `go-solver-throw-${sessThrows % 5}.json`);
    fs.writeFileSync(dump, JSON.stringify({ at: new Date().toISOString(), where, stack, req, sessKey }, null, 1));
    console.error(`go-solver: the request is in ${dump}`);
  } catch {
    /* the dump is a convenience */
  }
}
const FAULT = argv.includes("--fault-session") ? { left: Number(argv[argv.indexOf("--fault-session") + 1]) } : null;
// --fault-joint-pass N: the first N searches with pairs on answer PASS (a pass
// among pairs, injected) — the pass guard's test (gocheat GC9).
const FAULT_JOINT_PASS = argv.includes("--fault-joint-pass") ? { left: Number(argv[argv.indexOf("--fault-joint-pass") + 1]) } : null;
const FAULT_NOTICE = argv.includes("--fault-notice") ? { left: Number(argv[argv.indexOf("--fault-notice") + 1]) } : null;

let lastAnswers = null;
let lastAdaptive = null;
/** Publish the session's pre-sent answers (only when they changed). */
async function publishAnswers(minWork) {
  let answers = sess && sess.pondering ? sess.ponderAnswers({ minWork, max: 4 }) : [];
  // A position going badly is never pre-sent: it comes back as a request,
  // where the adaptive budget extends the search.
  if (lastAdaptive) answers = answers.filter((a) => !(typeof a.wr === "number" && a.wr < lastAdaptive.thr));
  // The book's answers first (go.js plays the first match): every AI reply
  // drawn so far whose position the book holds.
  const book = sess && sess.pondering ? bookFor(bookOpp) : null;
  if (book) {
    const N = sessKey ? Number(sessKey.split("|")[1]) : 5;
    const bookAnswers = [];
    for (const c of sess.ponderChildren()) {
      if (c.pc !== 0) continue;
      const bm = bookMove(book, Array.from({ length: N }, (_, x) => c.b.slice(x * N, (x + 1) * N)));
      if (bm) bookAnswers.push({ b: c.b, pc: 0, x: bm.x, y: bm.y, n: c.n, work: null, v: null, wr: bm.wr, book: true });
    }
    if (bookAnswers.length) {
      const seen = new Set(bookAnswers.map((a) => a.b));
      answers = [...bookAnswers, ...answers.filter((a) => !(seen.has(a.b) && a.pc === 0))];
    }
  }
  // Positions with pass-forcing candidates come back as requests (oraclePick).
  if (sess && sess.pondering && bookOpp) {
    const N = sessKey ? Number(sessKey.split("|")[1]) : 5;
    const before = answers.length;
    answers = answers.filter((a) => !hasOracle(bookOpp, a.b, N, a.pc));
    bookStats.withheld += before - answers.length;
  }
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
  lastPonderMs = maxms;
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
      // A RETIME (go.js, SETTINGS.clock): the requested move we answered was
      // just played, and `T` is the playtime read in that tick. The ponder's
      // seed for the AI's reply is re-anchored there (the pre path's lag,
      // exact) instead of at the request's T plus our search's length; the
      // seed calibration follows. Then pondering resumes. Measured
      // (tools/sim/go-w0.mjs --retime): see go.js SETTINGS.clock.
      if (req.seq !== lastSeq && req.retime) {
        lastSeq = req.seq;
        if (seedCtx?.path === "req" && seedCtx.opponent === req.opponent) notePlay(req.opponent, req.T, seedCtx.histLen);
        if (CLOCK && req.T > 0 && sess?.pondering && seedCtx?.path === "req" && seedCtx.opponent === req.opponent) {
          sess.setClock(clockFor(req, "pre"));
          seedCtx = { ...seedCtx, path: "pre", T: req.T };
          retimes++;
        }
        skipSleep = await ponderUntilNext(lastPonderMs);
        continue;
      }
      if (req.seq !== lastSeq && Array.isArray(req.board)) {
        lastSeq = req.seq;
        lastReqAt = Date.now();
        const N = req.size;
        // adaptivePairOnly (go.js SETTINGS.cheat.hardAdaptive): the budget is
        // this hard-move pair request's alone — the ponder's pre-send filter
        // keeps what the opponent's own requests set.
        if (!req.adaptivePairOnly) lastAdaptive = req.adaptive && typeof req.adaptive === "object" ? req.adaptive : null;
        await calibrateSeed(req);

        // A NOTICE (release 3): go.js already played a pre-sent answer on this
        // board — re-root the session there (a reuse), commit the move, ponder.
        if (req.played && typeof req.played === "object" && model && req.opponent && MODEL_PONDER === "session") {
          notePlay(req.opponent, req.T, Array.isArray(req.history) ? req.history.length : NaN);
          try {
            const key = `${req.opponent}|${N}|${req.komi ?? 5.5}`;
            if (!sess || sessKey !== key) {
              const reply = (b, o) => model.reply(b, { ...o, opponent: req.opponent });
              sess = modelSession(N, req.komi ?? 5.5, { reply }, sessOpts(N, req.opponent));
              sessKey = key;
            }
            const history = Array.isArray(req.history) ? req.history : [];
            if (FAULT_NOTICE && FAULT_NOTICE.left-- > 0) throw new TypeError("Cannot read properties of undefined (reading 'length') [injected: --fault-notice]");
            sess.setRoot(req.board, validGrid(N, req.valid), { history, opponentPassed: !!req.opponentPassed, objective: req.objective ?? null, clock: clockFor(req, "pre") });
            const pl = req.played;
            bookOpp = req.opponent;
            sess.commit(pl.pass ? null : pl.x, pl.pass ? null : pl.y, pl.second ?? null);
            const turnMs = (Number.isFinite(req.turnS) ? req.turnS : 1.06) * 1000;
            sess.setCheat({ fns: [null, cheatFnOf(req, turnMs, 1, 0.02)], cheats: (req.cheat?.cheats ?? 0) + (pl.second ? 1 : 0) });
            rememberSeedCtx(req, "pre", pl.pass ? null : pl.x, pl.pass ? null : pl.y);
            notices++;
            const maxms = Number.isFinite(req.maxms) ? Math.min(Math.max(req.maxms, 50), 20000) : MAXMS;
            skipSleep = await ponderUntilNext(maxms);
          } catch (err) {
            sess = null;
            reportThrow("notice", err, req);
            // THE RETRY, as on the request path: re-root on a FRESH session
            // and commit the played move, so the ponder (and the pre-sent
            // answers) carry on; a second throw leaves the next request to
            // search fresh.
            try {
              const reply = (b, o) => model.reply(b, { ...o, opponent: req.opponent });
              sess = modelSession(N, req.komi ?? 5.5, { reply }, sessOpts(N, req.opponent));
              sessKey = `${req.opponent}|${N}|${req.komi ?? 5.5}`;
              const history = Array.isArray(req.history) ? req.history : [];
              sess.setRoot(req.board, validGrid(N, req.valid), { history, opponentPassed: !!req.opponentPassed, objective: req.objective ?? null, clock: clockFor(req, "pre") });
              const pl = req.played;
              sess.commit(pl.pass ? null : pl.x, pl.pass ? null : pl.y);
              console.error(`go-solver: notice seq=${req.seq} re-rooted on a fresh session`);
              skipSleep = await ponderUntilNext(Number.isFinite(req.maxms) ? Math.min(Math.max(req.maxms, 50), 20000) : MAXMS);
            } catch (err2) {
              sess = null;
              reportThrow("notice-retry", err2, req);
            }
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
                sess = modelSession(N, req.komi ?? 5.5, { reply }, sessOpts(N, req.opponent, opts));
                sessKey = key;
              }
              if (FAULT && FAULT.left-- > 0) throw new TypeError("Cannot read properties of undefined (reading 'length') [injected: --fault-session]");
              const fn0 = cheatFnOf(req, maxms + 100, 0, 0.003);
              // A cheat's SECOND-STONE request (go.js SETTINGS.cheat.secondNet):
              // searched without the net (golib nnDepth -1) — its depth-1 nodes
              // would be net-valued where the single's reused tree had playouts.
              // secondStone (go.js tryCheat): the root is the board after the
              // cheat's first stone — never a game state, so it stays out of
              // the AI's history (golib setRoot cheatSecond).
              const nnRoot = { ...(req.secondNet === false ? { nnDepth: -1 } : {}), ...(req.secondStone ? { cheatSecond: true } : {}) };
              let r = sess.setRoot(req.board, validGrid(N, req.valid), { history, opponentPassed, objective: req.objective ?? null, clock: clockFor(req, "req"), cheat: { fns: fn0 ? [fn0] : null, cheats: req.cheat?.cheats ?? 0 }, ...nnRoot });
              if (fn0) jointStats.requests++;
              if (req.secondNet === false) jointStats.secondNoNet = (jointStats.secondNoNet ?? 0) + 1;
              backend = "model";
              extra.mode = "session";
              if (outcomeFor(N, req.opponent)) extra.nn = `o${SMALLNET_DEPTH}`;
              else if (smallnetFor(N, req.opponent)) extra.nn = SMALLNET_DEPTH;
              // THE PASS-ONLY GUARD, solver side: with pairs on, a root that
              // reads 'PASS only' is re-set with NO pairs; if the plain search
              // has stones there, the pair path was wrong — counted and logged.
              if (!r && fn0) {
                r = sess.setRoot(req.board, validGrid(N, req.valid), { history, opponentPassed, objective: req.objective ?? null, clock: clockFor(req, "req"), cheat: { fns: null, cheats: req.cheat?.cheats ?? 0 } });
                if (r) {
                  jointStats.passGuard = (jointStats.passGuard ?? 0) + 1;
                  extra.jointGuard = "pass-only root with pairs on: searched singles";
                  console.error(`go-solver: seq=${req.seq} JOINT GUARD: the pair root was PASS-only but singles exist — searched without pairs`);
                }
              }
              if (!r) {
                ranked = null; // PASS is all there is
                return null;
              }
              bookOpp = req.opponent;
              // THE PASS-FORCING BOOK first: a candidate whose expected reply
              // this request's clock predicts is answered at once.
              const op = await oraclePick(req, history, opponentPassed);
              if (op) {
                ranked = [{ x: op.x, y: op.y }];
                extra.book = true;
                extra.oracle = op.mass;
                bookStats.oracle++;
                return null;
              }
              // THE OPENING BOOK: a book position is answered at once.
              const bm = !opponentPassed ? bookMove(bookFor(req.opponent), req.board) : null;
              if (bm && (req.valid || []).some(([x, y]) => x === bm.x && y === bm.y)) {
                ranked = [{ x: bm.x, y: bm.y }];
                extra.book = true;
                bookStats.hits++;
                return null;
              }
              const target = sessRate ? Math.round(sessRate * maxms) : Infinity;
              // Early stop on WORK (model-calling iterations), never visits:
              // pass-pass terminal lines inflate visits for free (golib iterate).
              const its = await sess.search({ maxms, untilWork: r.reused ? target : Infinity });
              if (!r.reused) sessRate = sessRate ? 0.8 * sessRate + 0.2 * (sess.rootWork / maxms) : sess.rootWork / maxms;
              ranked = sess.best();
              if (fn0 && FAULT_JOINT_PASS && FAULT_JOINT_PASS.left-- > 0) ranked = [];
              // A PASS chosen among pairs (before the AI has passed) is checked
              // against the single search: pairs are an extra option, never a
              // reason to pass where a stone is better.
              if (fn0 && !opponentPassed && !(ranked && ranked.length)) {
                const r2 = sess.setRoot(req.board, validGrid(N, req.valid), { history, opponentPassed, objective: req.objective ?? null, clock: clockFor(req, "req"), cheat: { fns: null, cheats: req.cheat?.cheats ?? 0 } });
                if (r2) {
                  await sess.search({ maxms });
                  const single = sess.best();
                  if (single && single.length) {
                    ranked = single;
                    jointStats.passGuard = (jointStats.passGuard ?? 0) + 1;
                    extra.jointGuard = "pass among pairs: the single search plays a stone";
                    console.error(`go-solver: seq=${req.seq} JOINT GUARD: a pass among pairs — the single search plays ${single[0].x},${single[0].y}`);
                  }
                }
              }
              if (sess.jointGuard?.hits && sess.jointGuard.hits !== jointStats.libGuard) {
                jointStats.libGuard = sess.jointGuard.hits;
                console.error(`go-solver: JOINT GUARD (golib): a pair filter emptied a node of stones ${sess.jointGuard.hits}x; last ${JSON.stringify(sess.jointGuard.last)}`);
              }
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
              reportThrow("request", err, req);
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
          // THE RETRY: a session that threw is discarded (sess = null) and the
          // request searched once more on a FRESH session before uct plays it
          // — the one state a fresh session does not carry is the tree and
          // calibration kept across moves and games, which the harness (a
          // session per game) never exercises.
          if (fallback && fallback.startsWith("model session threw")) {
            const first = fallback;
            fallback = await tryModel();
            extra.retried = first.slice(0, 160);
            if (!fallback) console.error(`go-solver: seq=${req.seq} the retry on a fresh session answered`);
          }
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
            // mode 'walls': the patched engine (offline nodes as walls) answered
            // — its evidence is its own solver version ('katago-walls-r3',
            // goplan.armVersion); a stock-engine answer stays 'katago-r3'.
            extra = { where: k.where, ms: Math.round(k.ms), ...(k.walls ? { mode: "walls" } : {}), ...(k.pondered ? { pondered: k.pondered } : {}) };
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
        const move = ranked && ranked.length ? { seq: req.seq, x: ranked[0].x, y: ranked[0].y, ...(ranked[0].second ? { second: ranked[0].second } : {}) } : { seq: req.seq, pass: true };
        if (move.second) jointStats.pairs++;
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
              ` model ponder ${ponderStats.modelHit}/${ponderStats.modelHit + ponderStats.modelMiss}` +
              ` book ${JSON.stringify(bookStats)} joint ${JSON.stringify(jointStats)}`,
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
          sess.commit(move.pass ? null : move.x, move.pass ? null : move.y, move.second ?? null);
          // cheat.ponder false (go.js's hard-move pair, joint cheats off): pairs
          // for THIS answer only — the ponder searches singles, so no pair is
          // pre-sent to a go.js that plays pre-sent answers as singles.
          const ponderFn = req.cheat?.ponder === false ? null : cheatFnOf(req, maxms + 100 + (Number.isFinite(req.turnS) ? req.turnS : 1.06) * 1000, 1, 0.02);
          sess.setCheat({ fns: [null, ponderFn], cheats: (req.cheat?.cheats ?? 0) + (move.second ? 1 : 0) });
          rememberSeedCtx(req, "req", move.pass ? null : move.x, move.pass ? null : move.y);
          skipSleep = await ponderUntilNext(maxms);
        }
        // KataGo on 13x13/19x19 ponders only with the playtime (req.T, go.js
        // SETTINGS.clock): the AI's reply there turns on its seed, and 4 random
        // seeds hit nothing; the predicted seeds hit 99% of replies in the
        // harness (go-w0 --ponder --seeded, 2026-10-07). The lag to our play is
        // this answer's time + go.js's pickup and read + one waitCycle.
        const kgSeeds = backend === "katago" && Number.isFinite(req.T) && req.T > 0 ? (kgMod ?? (await import("./katago/service.mjs"))).ponderSeeds(req.T, Date.now() - t0 + 60 + 200) : null;
        const ponderThis = (backend === "model" && extra.mode !== "session") || (backend === "katago" && (N < 13 || kgSeeds));
        if (PONDER && model && req.opponent && !move.pass && ponderThis) {
          try {
            kgMod = kgMod ?? (await import("./katago/service.mjs"));
            const after = kgMod.applyStone(req.board, move.x, move.y, "X");
            if (after) {
              const big = N >= 13;
              const positions = await kgMod.ponderPositions({ model, board: after, history: [req.board.join(""), ...history], opponent: req.opponent, komi: req.komi ?? 5.5, visits: Number.isFinite(req.visits) ? req.visits : 200, size: N, samples: big ? 4 : 8, ...(kgSeeds ? { rngs: kgSeeds } : {}), maxPositions: backend === "model" ? 1 : big && !kgSeeds ? 2 : 3 });
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
