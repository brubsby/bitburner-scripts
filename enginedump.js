// Dump the engine monitor's records (bbEngine:*) and trace.js's (bbTrace:*)
// from this page's localStorage into /tel/engine-dump.txt, for
// tools/lasthang-engine.mjs. 0GB: localStorage and performance through eval,
// which the RAM checker never prices.
//
//   run enginedump.js
//
// The game's EngineMonitor (src/Diagnostics/EngineMonitor.ts in the fork)
// writes one record per page, keyed by performance.timeOrigin, so after a
// reload the dead page's record is still here next to the live one's.

export async function main(ns) {
  const ls = eval('localStorage')
  const out = {}
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i)
    if (k && (k.startsWith('bbEngine:') || k.startsWith('bbTrace:'))) out[k] = ls.getItem(k)
  }
  out._dumpedAt = Date.now()
  out._thisPage = Math.round(eval('performance').timeOrigin)
  ns.write('/tel/engine-dump.txt', JSON.stringify(out), 'w')
  ns.tprint(`engine-dump: ${Object.keys(out).length - 2} keys -> /tel/engine-dump.txt`)
}
