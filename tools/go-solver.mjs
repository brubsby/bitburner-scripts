// External IPvGO solver: real search on a real core, outside the game.
//
//   node tools/go-solver.mjs [--maxms 1500] [--poll 400]
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
//   /go/move.txt  written back by this: { seq, x, y } or { seq, pass: true }
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
// The model bundle is built on first use from ~/Repos/bitburner (esbuild); if
// that fails the solver says so on stderr ONCE and every model request is
// answered by uct with `backend: "uct", fallback: <why>` in the reply, which
// go.js counts — degraded, never silent.

import os from "node:os";
import { chooseMoveUCT, chooseMoveModel } from "../golib.js";
import { loadModel } from "./goai/model.mjs";

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? Number(argv[i + 1]) : dflt;
};
const MAXMS = flag("maxms", 1500);
const POLL = flag("poll", 400);
// --rpc: another bridge (tests run the solver against a stub, never the live daemon).
const RPC = argv.includes("--rpc") ? argv[argv.indexOf("--rpc") + 1] : "http://127.0.0.1:12526/rpc";

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
// KataGo (tools/katago): started on the FIRST katago request only (it is
// ~150MB resident and only the 19x19 hidden-opponent board asks for it), then
// kept. Not installed / will not start -> uct, with the reason in the reply.
let katagoEngine = null;
let katagoWhy = null;
async function katago(visits) {
  if (katagoEngine) return katagoEngine;
  if (katagoWhy) return null;
  const { startKataGo } = await import("./katago/katago.mjs");
  katagoEngine = await startKataGo({ visits, log: (m) => (katagoWhy = m) });
  if (!katagoEngine) {
    katagoWhy = katagoWhy ?? "katago did not start";
    console.error(`go-solver: ${katagoWhy} — katago requests will be answered by uct`);
  } else console.log(`go-solver: katago started (pid ${katagoEngine.pid}, ${visits} visits default)`);
  return katagoEngine;
}
process.on("exit", () => katagoEngine?.close());
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => process.exit(0));

// The opponent model: loaded once (and built if missing/stale). null = no model.
const model = await loadModel({ quiet: false });
const modelWhy = model ? null : "tools/goai opponent model could not be built or loaded (see stderr above)";
if (!model) console.error(`go-solver: ${modelWhy} — model requests will be answered by uct`);
console.log(`go-solver: ${MAXMS}ms/move, polling every ${POLL}ms, priority ${os.getPriority()}, model ${model ? "loaded" : "UNAVAILABLE"}`);

while (true) {
  try {
    const r = await rpc("getFile", { filename: "/go/req.txt", server: "home" });
    if (r.result) {
      const req = JSON.parse(r.result);
      if (req.seq !== lastSeq && Array.isArray(req.board)) {
        lastSeq = req.seq;
        const N = req.size;
        const valid = Array.from({ length: N }, () => new Array(N).fill(false));
        for (const [x, y] of req.valid || []) valid[x][y] = true;

        // A request may carry its own budget and search options (go.js sends
        // them for the 19x19 hidden-opponent board, SETTINGS.bigBoard); a 5x5
        // request carries neither and searches exactly as measured. The budget
        // is clamped so a malformed request cannot pin a core for minutes.
        const maxms = Number.isFinite(req.maxms) ? Math.min(Math.max(req.maxms, 50), 20000) : MAXMS;
        const opts = req.opts && typeof req.opts === "object" ? req.opts : {};
        const t0 = Date.now();
        let backend = "uct";
        let fallback = null;
        let ranked;
        if (req.backend === "model") {
          if (!model) fallback = modelWhy;
          else if (!req.opponent) fallback = "request carries no opponent";
          else {
            try {
              const reply = (b, o) => model.reply(b, { ...o, opponent: req.opponent });
              const history = Array.isArray(req.history) ? req.history : [];
              ranked = await chooseMoveModel(req.board, valid, N, req.komi ?? 5.5, maxms, { ...opts, history, opponentPassed: !!(req.opponentPassed ?? opts.opponentPassed) }, { reply });
              backend = "model";
            } catch (err) {
              fallback = `model search threw: ${String(err).slice(0, 160)}`;
            }
          }
          if (fallback) console.error(`go-solver: seq=${req.seq} model -> uct: ${fallback}`);
        } else if (req.backend === "katago") {
          const kg = await katago(Number.isFinite(req.visits) ? req.visits : 100);
          if (!kg) fallback = katagoWhy;
          else {
            try {
              const r = await kg.choose(req.board, req.valid || [], req.komi ?? 5.5, Number.isFinite(req.visits) ? { visits: req.visits } : {});
              ranked = r.pass ? [] : [{ x: r.x, y: r.y, iters: r.visits }];
              backend = "katago";
            } catch (err) {
              fallback = `katago threw: ${String(err).slice(0, 160)}`;
              katagoEngine = null; // restart it on the next request
            }
          }
          if (fallback) console.error(`go-solver: seq=${req.seq} katago -> uct: ${fallback}`);
        }
        if (backend === "uct") ranked = chooseMoveUCT(req.board, valid, N, req.komi ?? 5.5, maxms, opts);
        const move = ranked && ranked.length ? { seq: req.seq, x: ranked[0].x, y: ranked[0].y } : { seq: req.seq, pass: true };
        move.backend = backend;
        if (fallback) move.fallback = fallback;

        await rpc("pushFile", { filename: "/go/move.txt", server: "home", content: JSON.stringify(move) });
        solved++;
        if (solved % 20 === 1) {
          console.log(
            `#${solved} seq=${req.seq} -> ${move.pass ? "pass" : move.x + "," + move.y} ` +
              `(${backend}, ${Date.now() - t0}ms, ${ranked?.[0]?.iters ?? 0} iters${backend === "model" ? `, ${ranked?.[0]?.modelCalls ?? 0} model calls` : ""})`,
          );
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
