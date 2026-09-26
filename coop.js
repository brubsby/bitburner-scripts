// COOPERATIVE LONG COMPUTATION — run a generator in slices that give the page
// back between them. Pure: no ns surface.
//
// Netscript shares the browser's main thread. A planner pass that computes
// for 600ms without awaiting freezes the page for 600ms (live 2026-09-26:
// "PLAN OVER CPU BUDGET: 597ms"; the page has frozen outright before). So the
// heavy searches (the plan's Monte Carlo, the graft search, the count-route
// and count-exit scans) are GENERATORS that `yield` after each unit of work
// (one exit simulation, ~1-10ms), and a Pacer runs them:
//
//   - drain(gen)          synchronously, ignoring the yields — the sync API the
//                         tests and every existing caller keep;
//   - pacer.slices(gen)      awaiting pacer.yieldFn() whenever `sliceMs` of work
//                         has run since the last yield.
//
// The two produce IDENTICAL results: the same generator, the same order of
// work; only the pauses differ. Budgets inside a generator must be measured
// in WORK time, not wall time, or a pause would truncate a search — so the
// pacer exposes `cpuNow()`, a clock that stops while it is yielded, and the
// generators take it as their `now`.
//
// A hidden tab throttles setTimeout to about once a minute, so a yield built
// on ns.sleep(0) could stretch a pass with 20 slices to 20 minutes. The
// caller supplies the yield: progress.js uses a MessageChannel round trip
// (a macrotask the page's input and rendering can run between, and which
// timer throttling does not touch), falling back to ns.sleep(0). Wall time
// and work time are both published so a throttled pass is visible.

const clock = () => {
  try {
    return performance.now()
  } catch {
    return Date.now()
  }
}

/** Run a generator to completion synchronously; its yields are ignored. */
export function drain(gen) {
  for (;;) {
    const r = gen.next()
    if (r.done) return r.value
  }
}

/**
 * A pacer for one pass. {sliceMs, yieldFn, now}. Stats accumulate across
 * every slices() call: cpuMs (work), waitMs (yielded), maxBlockMs (the longest
 * stretch of work between yields), yields, runs.
 */
export function makePacer({ sliceMs = 40, yieldFn = null, now = clock } = {}) {
  const st = { cpuMs: 0, waitMs: 0, maxBlockMs: 0, yields: 0, runs: 0 }
  let running = false
  let sliceStart = 0
  const cpuNow = () => st.cpuMs + (running ? now() - sliceStart : 0)
  const endSlice = () => {
    const b = now() - sliceStart
    st.cpuMs += b
    if (b > st.maxBlockMs) st.maxBlockMs = b
    return b
  }
  return {
    stats: st,
    sliceMs,
    cpuNow,
    /** Run `gen` in slices; returns its value. A throw inside propagates. */
    async slices(gen) {
      if (running) return drain(gen) // nested: the outer run already paces
      st.runs++
      running = true
      sliceStart = now()
      try {
        let t = now()
        for (;;) {
          const r = gen.next()
          if (r.done) return r.value
          // LOOK AHEAD one step: yield when the next step, if it costs what
          // this one did, would carry the block past the slice — so a block
          // ends near sliceMs, not sliceMs + one (possibly slow) step.
          const t2 = now()
          const step = t2 - t
          t = t2
          if (yieldFn && t2 - sliceStart + step >= sliceMs) {
            endSlice()
            running = false
            const w0 = now()
            await yieldFn()
            st.waitMs += now() - w0
            st.yields++
            running = true
            sliceStart = now()
            t = sliceStart
          }
        }
      } finally {
        if (running) endSlice()
        running = false
      }
    },
    /** Account synchronous work done outside slices() (so maxBlockMs sees it). */
    measure(fn) {
      const t = now()
      try {
        return fn()
      } finally {
        const b = now() - t
        st.cpuMs += b
        if (b > st.maxBlockMs) st.maxBlockMs = b
      }
    },
  }
}
