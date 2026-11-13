// The uct PONDER's search thread (tools/go-solver.mjs, UctPonder).
//
// One persistent worker: the solver posts { id, board, valid, N, komi, maxms,
// opts, abort } and gets { id, ranked, ms } back. `abort` is a SharedArrayBuffer
// the solver sets to cancel the search (golib chooseMoveUCT opts.abort), so a
// ponder on the wrong position stops within ~16 playouts instead of holding
// the core while the real request is searched — the solver's one-core budget
// (systemd CPUQuota=100%) is never split between two searches for long.
import { parentPort } from "node:worker_threads";
import { chooseMoveUCT } from "../golib.js";

parentPort.on("message", (m) => {
  const t0 = Date.now();
  let ranked = null;
  let error = null;
  try {
    ranked = chooseMoveUCT(m.board, m.valid, m.N, m.komi, m.maxms, { ...(m.opts ?? {}), ...(m.abort ? { abort: new Int32Array(m.abort) } : {}) });
  } catch (err) {
    error = String(err).slice(0, 200);
  }
  parentPort.postMessage({ id: m.id, ranked, error, ms: Date.now() - t0 });
});
