// Run go-regress playCheck replays on worker threads.
//
// Each replay is independent and deterministic (go-regress: a fixed search
// stream, a fixed work budget, the AI seeded from the case's clock), so the
// lost-game corpus (tools/test/golosses.test.mjs) is embarrassingly parallel:
// ~40 replays of 0.4-20s each, which ran one after another for ~3.5 minutes.
// Every worker loads its own regressEnv (its own Math.random, which
// withSeededRandom patches globally — two replays in ONE thread at once would
// corrupt each other's streams, so a worker runs one job at a time).
//
//   const pool = makePool({ jobs: 4 })
//   const res = await pool.run(fx, opts)   // playCheck(fx, opts) in a worker, + res.ms (the replay's own wall time)
//   await pool.close()
//
// A worker that dies rejects every job it held — the caller reports that as a
// replay that threw, never as a result. jobs <= 1 runs in this thread (no
// workers at all), the same code path the corpus used before.
//
// BB_TEST_JOBS=<n> overrides the default (min(4, cores - 1)).

import os from "node:os";
import path from "node:path";
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);

export const defaultJobs = () => {
  const env = Number(process.env.BB_TEST_JOBS);
  if (Number.isFinite(env) && env >= 1) return Math.floor(env);
  const cores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(4, cores - 1));
};

export function makePool({ jobs = defaultJobs() } = {}) {
  if (jobs <= 1) {
    // ONE AT A TIME, even when the caller queues them all at once: replays
    // overlapping in one thread share the global Math.random that
    // withSeededRandom patches, and corrupt each other's streams (seen
    // 2026-10-09: three fixed cases "regressed" on a run that overlapped them).
    let R = null;
    let tail = Promise.resolve();
    const one = async (fx, opts) => {
      R ??= await import(pathToFileURL(path.join(HERE, "go-regress.mjs")).href);
      const t0 = Date.now();
      const result = await R.playCheck(fx, opts);
      return { ...result, ms: Date.now() - t0 };
    };
    return {
      jobs: 1,
      run(fx, opts) {
        const p = tail.then(() => one(fx, opts));
        tail = p.catch(() => {});
        return p;
      },
      async close() {},
    };
  }
  const queue = [];
  const workers = [];
  let nextId = 0;
  const pending = new Map(); // id -> {resolve, reject, worker}
  const idle = [];
  const pump = () => {
    while (idle.length && queue.length) {
      const w = idle.pop();
      const job = queue.shift();
      pending.set(job.id, { ...job, worker: w });
      w.postMessage({ id: job.id, fx: job.fx, opts: job.opts });
    }
  };
  const spawn = () => {
    const w = new Worker(SELF);
    // An idle pool never keeps the process alive (a caller that threw before close()).
    w.unref();
    w.on("message", (m) => {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.error) p.reject(Object.assign(new Error(m.error), { stack: m.stack }));
      else p.resolve(m.result);
      idle.push(w);
      pump();
    });
    const die = (e) => {
      // Every job this worker held fails loudly; the rest go to the others.
      for (const [id, p] of pending) if (p.worker === w) {
        pending.delete(id);
        p.reject(e instanceof Error ? e : new Error(`go-regress worker exited (${e})`));
      }
      const i = workers.indexOf(w);
      if (i >= 0) workers.splice(i, 1);
      const j = idle.indexOf(w);
      if (j >= 0) idle.splice(j, 1);
      if (!workers.length) for (const job of queue.splice(0)) job.reject(new Error("every go-regress worker died"));
    };
    w.on("error", die);
    w.on("exit", (code) => {
      if (code !== 0 || pending.size) die(code);
    });
    workers.push(w);
    idle.push(w);
  };
  for (let i = 0; i < jobs; i++) spawn();
  return {
    jobs,
    run(fx, opts) {
      return new Promise((resolve, reject) => {
        queue.push({ id: nextId++, fx, opts, resolve, reject });
        pump();
      });
    },
    async close() {
      await Promise.all(workers.splice(0).map((w) => w.terminate()));
    },
  };
}

if (!isMainThread && parentPort) {
  const R = await import(pathToFileURL(path.join(HERE, "go-regress.mjs")).href);
  parentPort.on("message", async ({ id, fx, opts }) => {
    try {
      const t0 = Date.now();
      const result = await R.playCheck(fx, opts);
      parentPort.postMessage({ id, result: { ...result, ms: Date.now() - t0 } });
    } catch (e) {
      parentPort.postMessage({ id, error: String(e?.message ?? e), stack: String(e?.stack ?? "") });
    }
  });
}
