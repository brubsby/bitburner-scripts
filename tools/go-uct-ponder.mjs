// THE UCT PONDER (tools/go-solver.mjs, 7x7-13x13 uct requests).
//
// The uct backend searched only on request: on 7x7 Tetrads (live 2026-11-13,
// 243 games) a game was ~15 of our turns at ~845ms of search each plus the
// AI's ~1.2s reply, and the core sat idle through every reply — 40% of the
// game was our search, none of it overlapped. Under the one-core budget
// (systemd CPUQuota=100%) the idle reply time is the only free CPU there is.
//
// So after answering, the solver predicts the AI's reply (the model: the
// game's own getMove, seeded from the playtime as the KataGo ponder is) and
// searches OUR answer to it in a worker while the reply crawls through the
// game's timers. The next request on that board is answered at once ("hit"),
// or — when it lands while that very search runs — when the search ends
// ("partial"); a request on any other board cancels the worker (golib
// chooseMoveUCT opts.abort) and is searched fresh, as before ("miss"). The
// pondered search is the same chooseMoveUCT at the same budget on the same
// position, so a hit plays at the request's strength in ~0ms.
//
// Pure apart from the worker it is given (tests pass a fake).
import { Worker } from "node:worker_threads";

export const defaultSpawn = () => new Worker(new URL("./go-uct-worker.mjs", import.meta.url));

export class UctPonder {
  constructor({ spawn = defaultSpawn, log = () => {} } = {}) {
    this.spawn = spawn;
    this.log = log;
    this.worker = null;
    this.broken = null; // why the worker cannot be used (then pondering is off)
    this.nextId = 1;
    this.cur = null; // { id, key, abort: Int32Array, promise, resolve }
    this.queue = [];
    this.results = new Map(); // key -> ranked
    this.stats = { started: 0, done: 0, aborted: 0, hit: 0, partial: 0, miss: 0, errors: 0 };
  }

  ensureWorker() {
    if (this.worker || this.broken) return this.worker;
    try {
      this.worker = this.spawn();
      this.worker.on("message", (m) => this.onMessage(m));
      this.worker.on("error", (e) => this.fail(`worker error: ${String(e).slice(0, 160)}`));
      this.worker.on("exit", (code) => {
        if (this.worker) this.fail(`worker exited (${code})`);
      });
    } catch (e) {
      this.fail(`worker did not start: ${String(e).slice(0, 160)}`);
    }
    return this.worker;
  }

  fail(why) {
    this.broken = why;
    this.worker = null;
    this.log(`uct ponder OFF: ${why}`);
    const c = this.cur;
    this.cur = null;
    this.queue = [];
    c?.resolve(null);
  }

  onMessage(m) {
    const c = this.cur;
    if (!c || m.id !== c.id) return; // a cancelled job's late answer
    this.cur = null;
    const aborted = Atomics.load(c.abort, 0) !== 0;
    if (m.error) {
      this.stats.errors++;
      this.log(`uct ponder: search threw: ${m.error}`);
    } else if (!aborted) {
      this.stats.done++;
      this.results.set(c.key, m.ranked);
    }
    c.resolve(aborted || m.error ? null : m.ranked);
    this.runNext();
  }

  runNext() {
    if (this.cur || !this.queue.length || !this.ensureWorker()) return;
    const job = this.queue.shift();
    const abort = new Int32Array(new SharedArrayBuffer(4));
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    this.cur = { id: this.nextId++, key: job.key, abort, promise, resolve };
    this.stats.started++;
    this.worker.postMessage({ id: this.cur.id, board: job.board, valid: job.valid, N: job.N, komi: job.komi, maxms: job.maxms, opts: job.opts ?? {}, abort: abort.buffer });
  }

  /** Drop every queued and finished ponder and stop the running one. */
  cancel() {
    this.queue = [];
    this.results.clear();
    if (this.cur) {
      Atomics.store(this.cur.abort, 0, 1);
      this.stats.aborted++;
    }
  }

  /**
   * Ponder these positions in order: [{ key, board, valid (grid), N, komi, maxms, opts }].
   * Replaces whatever was pondering.
   */
  start(jobs) {
    this.cancel();
    if (this.broken) return false;
    this.queue = jobs.filter((j) => j && j.key);
    this.runNext();
    return true;
  }

  /**
   * A better prediction of the same turn (the RETIME: the playtime read when
   * our move was played): keep what is done or running for positions still
   * wanted, stop a search on one no longer wanted — or on any but the first
   * when the first is not done — and queue the rest in the new order.
   */
  retarget(jobs) {
    if (this.broken) return false;
    const want = jobs.filter((j) => j && j.key);
    const keys = new Set(want.map((j) => j.key));
    for (const k of [...this.results.keys()]) if (!keys.has(k)) this.results.delete(k);
    const first = want[0]?.key ?? null;
    if (this.cur && Atomics.load(this.cur.abort, 0) === 0) {
      const keep = this.cur.key === first || (keys.has(this.cur.key) && (first === null || this.results.has(first)));
      if (!keep) {
        Atomics.store(this.cur.abort, 0, 1);
        this.stats.aborted++;
      }
    }
    const running = this.cur && Atomics.load(this.cur.abort, 0) === 0 ? this.cur.key : null;
    this.queue = want.filter((j) => !this.results.has(j.key) && j.key !== running);
    this.stats.retargets = (this.stats.retargets ?? 0) + 1;
    this.runNext();
    return true;
  }

  get busy() {
    return !!this.cur;
  }

  /**
   * The pondered answer for `key`, if any: { ranked, how: 'hit' | 'partial' },
   * or null (a miss: everything is cancelled, search fresh). A search running
   * on exactly this key is awaited (its budget was the request's). count:
   * false keeps a request no ponder could serve (a cheat's second stone) out
   * of the miss count.
   */
  async take(key, { count = true } = {}) {
    const hadAny = this.results.size > 0 || !!this.cur || this.queue.length > 0;
    if (this.results.has(key)) {
      const ranked = this.results.get(key);
      this.cancel();
      this.stats.hit++;
      return { ranked, how: "hit" };
    }
    if (this.cur && this.cur.key === key) {
      const c = this.cur;
      this.queue = [];
      const ranked = await c.promise;
      this.results.clear();
      if (ranked) {
        this.stats.partial++;
        return { ranked, how: "partial" };
      }
    }
    this.cancel();
    if (hadAny && count) this.stats.miss++;
    return null;
  }

  close() {
    this.cancel();
    const w = this.worker;
    this.worker = null;
    w?.terminate?.();
  }
}
