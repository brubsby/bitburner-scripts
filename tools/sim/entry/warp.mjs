// A TIME WARP for the entry harnesses: every timer, Date and performance.now run K times faster, so a
// game loop ticked by setInterval(200) and every ns.sleep / netscriptDelay (bgTimers -> global setTimeout)
// keep their relative timing while K game-minutes pass per real minute.
//
//   import './warp.mjs'   FIRST (before env.mjs / world.mjs), with DNET_WARP=K in the environment
//
// What it is NOT: a faster CPU. When the event loop cannot keep up, timers fire late and the warp
// degrades toward real time; the harness measures game time by the ENGINE'S OWN CYCLES (200ms each), never
// by this clock, and prints the achieved warp so a saturated run is visible.
export const WARP = Math.max(1, Number(process.env.DNET_WARP ?? 1) || 1)

if (WARP !== 1 && !globalThis.__WARP_INSTALLED) {
  globalThis.__WARP_INSTALLED = true
  const rST = globalThis.setTimeout
  const rSI = globalThis.setInterval
  const RealDate = Date
  const rNow = RealDate.now.bind(RealDate)
  const T0 = rNow()
  const vnow = () => Math.floor(T0 + (rNow() - T0) * WARP)
  globalThis.setTimeout = (fn, ms = 0, ...a) => rST(fn, Math.max(0, Number(ms) || 0) / WARP, ...a)
  globalThis.setInterval = (fn, ms = 0, ...a) => rSI(fn, Math.max(1, (Number(ms) || 0) / WARP), ...a)
  class WarpDate extends RealDate {
    constructor(...a) {
      if (a.length === 0) super(vnow())
      else super(...a)
    }
    static now() {
      return vnow()
    }
  }
  globalThis.Date = WarpDate
  if (globalThis.performance?.now) {
    const rp = globalThis.performance.now.bind(globalThis.performance)
    const P0 = rp()
    try {
      globalThis.performance.now = () => P0 + (rp() - P0) * WARP
    } catch {
      /* read-only in this node: Date.now is what the scripts read */
    }
  }
}

/** Real milliseconds (the harness's own pacing, unaffected by the warp). */
export const realSleep = (ms) => new Promise((r) => setTimeout(r, ms * WARP)) // the patched setTimeout divides by WARP
