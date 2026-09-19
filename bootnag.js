// The half of the old boot.js report that only a human can act on.
//
//   run bootnag.js
//
// It runs once and exits. boot.js launches it from the manifest at the 128GB
// tier and nowhere below, for one reason: the three things it needs to say
// anything at all are expensive, and on an 8GB home they are a worker thread and
// a half.
//
//     base script                1.60GB
//     ns.getServer               2.00GB   cpuCores
//     ns.getPlayer               0.50GB   factions
//     ns.getServerMoneyAvailable 0.10GB   idle cash
//     ns.fileExists              0.10GB   which port programs are owned
//     ns.getServerMaxRam         0.05GB
//                                -------
//                                4.35GB   = two early.js threads, or a whole
//                                           8GB home's worth of worker and a bit
//
// This is the go.js / go-cheat.js split applied to a nag: the capability is not
// deleted, it is moved into a script that is only paid for on a save that can
// afford it. Below 128GB boot.js still writes /tel/boot.txt with the full plan
// and every deferral reason — the machine-readable half is free at every tier.
//
// Everything here is something no Source-File can automate, or something only a
// human's judgement should trigger. Accepting a faction invitation in
// particular is guarded by `event.isTrusted` before it even checks the invite
// exists (Faction/ui/FactionsRoot.tsx:89), so there is no scripted path at all.

import { reporter, describe } from 'status.js'

const TELEMETRY = '/tel/nag.txt'

const PORT_PROGRAMS = ['BruteSSH.exe', 'FTPCrack.exe', 'relaySMTP.exe', 'HTTPWorm.exe', 'SQLInject.exe']

export async function main(ns) {
  ns.disableLog('ALL')
  const todo = []
  const note = reporter(ns, TELEMETRY, () => ({ todo }))
  ns.atExit(() => note.exit('stopped', { detail: 'bootnag.js exited' }))

  try {
    const player = ns.getPlayer()
    if (!player.factions || player.factions.length === 0) {
      todo.push(
        'No faction joined — backdoor a story server and accept the invite by hand. ' +
          'acceptInvitation tests event.isTrusted before it checks the invite exists ' +
          '(FactionsRoot.tsx:89), so nothing in-game can do it. Reputation is earning ZERO until then.',
      )
    } else {
      todo.push(
        `Joined: ${player.factions.join(', ')} — check faction work is running AND focused; ` +
          'unfocused costs 20%, and upkeep.js only reclaims it if it is running.',
      )
    }

    for (const program of PORT_PROGRAMS) {
      if (!ns.fileExists(program, 'home')) {
        todo.push(`${program} not owned — each port program unlocks a tier of servers to root.`)
      }
    }

    // Money is destroyed by an install; home RAM and cores are not. Anything
    // large sitting in the bank is a standing loss waiting to happen — this
    // repo once installed holding $2.07 quadrillion.
    const cash = ns.getServerMoneyAvailable('home')
    const cores = ns.getServer('home').cpuCores
    const homeRam = ns.getServerMaxRam('home')
    if (cash > 1e12) {
      todo.push(
        `$${ns.format.number(cash)} idle — home is ${homeRam}GB / ${cores} cores. ` +
          'Run homeup.js. Cash does NOT survive an install; home RAM and cores do.',
      )
    }
    note('ok', { result: 'ok', detail: `${todo.length} thing(s) need a human` })
  } catch (err) {
    todo.push(`bootnag could not finish: ${describe(err)}`)
    note('error', { result: 'error', detail: describe(err) })
  }

  for (const line of todo) ns.tprint(`nag: ${line}`)
  if (!todo.length) ns.tprint('nag: nothing needs a human')
}
