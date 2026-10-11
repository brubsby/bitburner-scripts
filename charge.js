// THE CHARGER: Stanek's Gift's charging worker, launched by stanek.js on any
// rooted host(s) with the thread counts the plan priced (stanekplan.chargerPlanOf,
// the fleet allocation decided by the exit in progress.js stanekDecisionOf).
// chargeFragment charges from whatever server this runs on (the gift is global)
// at this script's threads x that server's core bonus.
//
// RAM: 1.6 (script base) + 0.4 (stanek.chargeFragment) = 2.0GB per thread
// (Netscript/RamCostGenerator.ts:11,65) — stanekplan.STANEK.ramPerThread. Keep it
// at exactly that: every extra ns call here is multiplied by the thread count.
// ns.read/write/atExit/sleep and ns.pid are free.
//
// What one call does (NetscriptFunctions/Stanek.ts chargeFragment): waits 1000ms
// (200ms in bonus time), then StaneksGift.charge(fragment, threads x coreBonus):
// highestCharge = the threads, numCharge += 1 per call at the same threads — so
// round robin over the roots gives every fragment the same charge state
// (stanekplan.nodeModel's policy). Charges clear at every install (the layout
// stays: StaneksGift.prestigeAugmentation); stanek.js relaunches this.
//
// args: [0] JSON [[x, y], ...] the non-booster roots; [1] lastAugReset (the life);
// [2] the host it runs on (ns.getHostname would cost RAM per thread).
// Publishes /tel/charge-<host>.txt on ITS host every 30s and on exit (ns.write is
// local); stanek.js copies each home into /tel/charge.txt. The health check's
// FRAGMENTS NOT CHARGING reads the gift's own charge, never this script's claim.
/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog('ALL')
  let roots = []
  let error = null
  try {
    roots = JSON.parse(String(ns.args[0] ?? '[]'))
  } catch (e) {
    error = `bad roots argument: ${String(e).slice(0, 120)}`
  }
  const life = ns.args[1] ?? null
  const host = String(ns.args[2] ?? 'home')
  let charges = 0
  let fails = 0
  let lastPut = 0
  const put = (extra = {}) => ns.write(`/tel/charge-${host}.txt`, JSON.stringify({ at: new Date().toISOString(), lastAugReset: life, host, pid: ns.pid, roots, charges, fails, error, ...extra }), 'w')
  ns.atExit(() => put({ stopped: true }))
  if (!Array.isArray(roots) || !roots.length) {
    error = error ?? 'no fragment roots to charge'
    put()
    return
  }
  put()
  while (true) {
    for (const [x, y] of roots) {
      try {
        await ns.stanek.chargeFragment(x, y)
        charges++
        error = null
      } catch (e) {
        fails++
        error = `chargeFragment(${x}, ${y}) threw: ${String(e).slice(0, 160)}`
        put()
        await ns.sleep(5000)
      }
      if (Date.now() - lastPut > 30e3) {
        put()
        lastPut = Date.now()
      }
    }
  }
}
