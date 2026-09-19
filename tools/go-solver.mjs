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
//                 { seq, size, komi, board: [...], valid: [[x,y]...] }
//   /go/move.txt  written back by this: { seq, x, y } or { seq, pass: true }
//
// go.js matches on `seq` and falls back to its own cheap local search if no
// reply arrives in time — so killing this process degrades the bot instead of
// stopping it, per the graceful-degradation rule in CLAUDE.md.
//
// The search itself is golib.js's chooseMoveUCT — the same module the in-game
// fallback uses, imported from the same file. One solver, two callers.

import os from "node:os";
import { chooseMoveUCT } from "../golib.js";

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? Number(argv[i + 1]) : dflt;
};
const MAXMS = flag("maxms", 1500);
const POLL = flag("poll", 400);
const RPC = "http://127.0.0.1:12526/rpc";

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
console.log(`go-solver: ${MAXMS}ms/move, polling every ${POLL}ms, priority ${os.getPriority()}`);

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

        const t0 = Date.now();
        const ranked = chooseMoveUCT(req.board, valid, N, req.komi ?? 5.5, MAXMS);
        const move = ranked && ranked.length ? { seq: req.seq, x: ranked[0].x, y: ranked[0].y } : { seq: req.seq, pass: true };

        await rpc("pushFile", { filename: "/go/move.txt", server: "home", content: JSON.stringify(move) });
        solved++;
        if (solved % 20 === 1) {
          console.log(
            `#${solved} seq=${req.seq} -> ${move.pass ? "pass" : move.x + "," + move.y} ` +
              `(${Date.now() - t0}ms, ${ranked?.[0]?.iters ?? 0} iters)`,
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
