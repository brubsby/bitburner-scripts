// Stops a named script everywhere it is running, then exits.
//
//   run retire.js batch.js seed.js
//
// This is one ns function's worth of script, and that is the point.
// `ns.scriptKill` costs 1.00GB — on an 8GB virgin BitNode entry that is half a
// worker thread — and boot.js needs it in exactly one situation: home has just
// grown past a tier boundary and something the plan used to want is still
// running. On a virgin entry that situation cannot occur, because nothing has
// ever been started there.
//
// So boot.js does not reference ns.scriptKill at all. It detects the case with
// the `ns.ps` it already pays for and exec's this, which means the 1.00GB is
// paid only on the boots that actually retire something, and never on the boot
// that has the least RAM to spare. Same lever as go.js / go-cheat.js.
//
// The case it exists for, concretely: seed.js and early.js are retired at 128GB
// when batch.js takes over. Both want the whole fleet, and a seeder that keeps
// refilling every host with self-threaded workers leaves the batcher with no
// contiguous block to place a batch into — the failure watchdog.js records
// about auto.js, and the one invariant B5 describes.
//
//   run retire.js --host home early.js hgw.js
//
// --host limits it to one host. boot.js evicts seed.js's workers from HOME
// this way when a planned home resident (watchdog.js) does not fit beside
// them (raiseplace.homeResidentRoomOf); the fleet's workers keep earning.

import { reporter, describe } from 'status.js'

const TELEMETRY = '/tel/retire.txt'

export async function main(ns) {
  ns.disableLog('ALL')

  const killed = []
  const args = ns.args.map(String)
  const at = args.indexOf('--host')
  const only = at >= 0 ? args[at + 1] ?? null : null
  const wanted = args.filter((s, i) => s.endsWith('.js') && !(at >= 0 && i === at + 1))
  const note = reporter(ns, TELEMETRY, () => ({ wanted, only, killed }))
  ns.atExit(() => note.exit('stopped', { detail: 'retire.js exited' }))

  if (!wanted.length) {
    note('ok', { result: 'noop', detail: 'nothing named. usage: run retire.js batch.js seed.js' })
    ns.tprint('retire: nothing named. usage: run retire.js batch.js seed.js')
    return
  }

  try {
    // BFS the network; ns.scan only sees neighbours.
    const seen = new Set(['home'])
    const queue = ['home']
    while (queue.length) {
      for (const host of ns.scan(queue.shift())) {
        if (!seen.has(host)) {
          seen.add(host)
          queue.push(host)
        }
      }
    }

    for (const host of seen) {
      if (only !== null && host !== only) continue
      if (!ns.hasRootAccess(host)) continue
      for (const script of wanted) {
        // scriptKill is a no-op when nothing matches, so there is nothing to
        // test first — and testing would mean referencing ns.ps for another
        // 0.20GB.
        if (ns.scriptKill(script, host)) killed.push(`${script} on ${host}`)
      }
    }
    note('ok', { result: 'ok', detail: killed.length ? `stopped ${killed.length}` : 'nothing was running' })
    ns.tprint(killed.length ? `retire: stopped ${killed.join(', ')}` : `retire: none of ${wanted.join(', ')} was running`)
  } catch (err) {
    note('error', { result: 'error', detail: describe(err) })
    ns.tprint(`retire: FAILED ${describe(err)}`)
  }
}
