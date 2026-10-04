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

/**
 * NO GENERATOR RUNS FOREVER. A generator that never finishes would spin the
 * page thread (drain) or yield forever (slices); past STEP_CAP steps both
 * throw LoopCapError, which the plan catches and publishes. The largest real
 * run (a live-size pass, 232 routes) is ~3,400 steps.
 */
export const STEP_CAP = 2e6
export class LoopCapError extends Error {
  constructor(msg) {
    super(msg)
    this.name = 'LoopCapError'
  }
}

const GEN_FN_PROTO = Object.getPrototypeOf(function* () {})
/** Whether `f` is a generator function (function*). */
export const isGenFn = (f) => typeof f === 'function' && Object.getPrototypeOf(f) === GEN_FN_PROTO
/**
 * ONE INJECTED SEARCH, EITHER FORM. The count, route and gang exits take the
 * policy search as a parameter (exitplan.bestExitPolicy or its generator
 * bestExitPolicyGen): called through this, a generator function is delegated
 * to — its yields pass through, so a pacer slices inside it — and a plain one
 * runs in one piece. The same numbers either way (bestExitPolicy drains the
 * generator); only where the page gets the thread back differs.
 */
export function* callGen(fn, ...args) {
  return isGenFn(fn) ? yield* fn(...args) : fn(...args)
}

/** Run a generator to completion synchronously; its yields are ignored. */
export function drain(gen, cap = STEP_CAP) {
  for (let steps = 0; ; steps++) {
    if (steps > cap) throw new LoopCapError(`drain: the generator did not finish in ${cap} steps`)
    const r = gen.next()
    if (r.done) return r.value
  }
}

/**
 * A pacer for one pass. {sliceMs, yieldFn, now}. Stats accumulate across
 * every slices() call: cpuMs (work), waitMs (yielded), maxBlockMs (the longest
 * stretch of work between yields), yields, runs — and per LABEL (the section
 * a slices() call names) the same plus maxStepMs, the longest single step
 * between two of the generator's own yields, and at which step it was: a step
 * longer than the slice is a piece of work that does not yield often enough,
 * and the label says where it is.
 */
/**
 * WHAT EACH STEP COST LAST TIME, per section label and step index, across
 * passes (the pacer is per pass; this is the process's). The look-ahead
 * predicted the next step from the one just run — live BN9 (main b95c33e) a
 * 32ms step 20 of 25 in 'plan-gang' followed cheap ones, and the block ran
 * to 59.1ms against 50. The prediction is now the larger of the step just
 * run and what this step index cost before (decayed x0.75 a run, so one slow
 * pass fades). Bounded: 64 labels, 20,000 indices each.
 */
export const STEP_MEMORY = new Map()
const MEM_LABELS = 64
const MEM_STEPS = 20000
function memoryOf(memory, label) {
  let m = memory.get(label)
  if (!m) {
    if (memory.size >= MEM_LABELS) memory.delete(memory.keys().next().value)
    m = []
    memory.set(label, m)
  }
  return m
}
/**
 * THE MEMORY OUTLIVES THE PROCESS. progress.js is a watchdog JOB — a fresh
 * process every pass — so an in-module memory is empty every pass and every
 * pass was a first pass (lead, after 2d19c15). A store {load(memory),
 * save(memory)} carries it across: stepMemoryStore over the page's
 * localStorage (0GB through eval, as trace.js), one key. Only the steps that
 * matter are kept (>= MEM_PERSIST_MS, at most MEM_PERSIST_PER_LABEL per
 * label), rounded to 0.1ms, so the record stays a few KB; the fade and the
 * caps are the in-memory ones (a loaded cost fades with the runs that follow).
 * A storage that is missing or throws is a no-op, never an error.
 */
export const MEM_PERSIST_MS = 2
export const MEM_PERSIST_PER_LABEL = 500
export const STEP_MEMORY_KEY = 'bbStepMemory'
export function pageStorage() {
  try {
    return eval('localStorage')
  } catch {
    return null
  }
}
export function stepMemoryStore(storage, key = STEP_MEMORY_KEY) {
  return {
    load(memory) {
      let n = 0
      try {
        const raw = storage?.getItem?.(key)
        if (!raw) return 0
        const obj = JSON.parse(raw)
        for (const [label, pairs] of Object.entries(obj ?? {})) {
          if (!Array.isArray(pairs)) continue
          const m = memoryOf(memory, label)
          for (const pr of pairs.slice(0, MEM_PERSIST_PER_LABEL)) {
            const [i, ms] = Array.isArray(pr) ? pr : []
            if (Number.isInteger(i) && i >= 0 && i < MEM_STEPS && typeof ms === 'number' && isFinite(ms) && ms > 0) {
              m[i] = Math.max(m[i] ?? 0, ms)
              n++
            }
          }
        }
      } catch {
        return n
      }
      return n
    },
    save(memory) {
      try {
        const obj = {}
        for (const [label, arr] of memory) {
          const pairs = []
          for (let i = 0; i < arr.length && pairs.length < MEM_PERSIST_PER_LABEL; i++) if (arr[i] >= MEM_PERSIST_MS) pairs.push([i, Math.round(arr[i] * 10) / 10])
          if (pairs.length) obj[label] = pairs
        }
        storage?.setItem?.(key, JSON.stringify(obj))
        return true
      } catch {
        return false
      }
    },
  }
}
export function makePacer({ sliceMs = 40, yieldFn = null, now = clock, memory = STEP_MEMORY, store = null } = {}) {
  if (store) store.load(memory)
  const st = { cpuMs: 0, waitMs: 0, maxBlockMs: 0, yields: 0, runs: 0, sections: {} }
  let running = false
  let sliceStart = 0
  const cpuNow = () => st.cpuMs + (running ? now() - sliceStart : 0)
  let sec = null
  const endSlice = () => {
    const b = now() - sliceStart
    st.cpuMs += b
    if (b > st.maxBlockMs) st.maxBlockMs = b
    if (sec) {
      sec.cpuMs += b
      if (b > sec.maxBlockMs) sec.maxBlockMs = b
    }
    return b
  }
  const sectionOf = (label) => (st.sections[label] ??= { cpuMs: 0, maxBlockMs: 0, maxStepMs: 0, maxStepAt: null, steps: 0, runs: 0 })
  return {
    stats: st,
    sliceMs,
    cpuNow,
    /** Run `gen` in slices under `label`; returns its value. A throw inside propagates. */
    async slices(gen, label = 'unlabelled') {
      if (running) return drain(gen) // nested: the outer run already paces
      st.runs++
      running = true
      sec = sectionOf(label)
      sec.runs++
      sliceStart = now()
      const mem = memoryOf(memory, label)
      try {
        let t = now()
        for (let steps = 0; ; steps++) {
          if (steps > STEP_CAP) throw new LoopCapError(`slices(${label}): the generator did not finish in ${STEP_CAP} steps`)
          const r = gen.next()
          // LOOK AHEAD one step: yield when the next step, if it costs what
          // this one did, would carry the block past the slice — so a block
          // ends near sliceMs, not sliceMs + one (possibly slow) step.
          const t2 = now()
          const step = t2 - t
          t = t2
          sec.steps++
          if (step > sec.maxStepMs) {
            sec.maxStepMs = step
            sec.maxStepAt = sec.steps
          }
          if (steps < MEM_STEPS) mem[steps] = Math.max(step, 0.75 * (mem[steps] ?? 0))
          if (r.done) return r.value
          // The next step's predicted cost: the one just run, or what that
          // step index cost before, whichever is larger.
          const next = Math.max(step, steps + 1 < MEM_STEPS ? mem[steps + 1] ?? 0 : 0)
          if (yieldFn && t2 - sliceStart + next >= sliceMs) {
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
        sec = null
        if (store) store.save(memory)
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
