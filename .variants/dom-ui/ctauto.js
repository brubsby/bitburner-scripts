// Finds and solves coding contracts, forever, unattended.
//
//   run ctauto.js            check every 5 minutes
//   run ctauto.js --every 2  check every 2 minutes
//
// ctscan.js and ctsolve.js exist as a pair because reading a contract
// (getContractType 5GB + getData 5GB) and answering it (attempt 10GB) together
// exceed 21.8GB, which did not fit when home was 16GB. Home is far past that
// now, so this does both in one resident script and needs nobody to start it.
//
// Contracts are worth running unattended for two reasons. They pay ~$25m each,
// and — more importantly once money stops being the constraint — they pay
// faction reputation, which is the one thing that cannot be bought and is
// usually the binding constraint on progress.
//
// Solvers come from ctsolvers.js, which contains no ns call and so costs
// nothing to import. Unknown contract types are skipped rather than guessed at:
// a wrong answer burns one of a contract's limited attempts and can destroy it.

import { findAnswer } from 'ctsolvers.js'

const STATUS = '/tel/ctauto.txt'

function scanAll(ns) {
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
  return [...seen]
}

export async function main(ns) {
  const flags = ns.flags([['every', 5]])
  const interval = Math.max(30, flags.every * 60) * 1000

  ns.disableLog('ALL')
  ns.tprint(`ctauto.js: solving contracts every ${flags.every} min`)

  const totals = { solved: 0, wrong: 0, skipped: 0, rewards: [] }

  while (true) {
    const found = []

    try {
      for (const host of scanAll(ns)) {
        for (const file of ns.ls(host).filter((f) => f.endsWith('.cct'))) {
          try {
            found.push({
              contract: file,
              hostname: host,
              type: ns.codingcontract.getContractType(file, host),
              data: ns.codingcontract.getData(file, host),
            })
          } catch {
            // Contract vanished between listing and reading, or is unreadable.
          }
        }
      }

      for (const c of found) {
        let answer
        try {
          answer = findAnswer(c)
        } catch (err) {
          totals.skipped++
          ns.print(`solver threw on ${c.type}: ${err}`)
          continue
        }
        if (answer === undefined || answer === null) {
          totals.skipped++
          ns.print(`no solver for ${c.type}`)
          continue
        }

        const reward = ns.codingcontract.attempt(answer, c.contract, c.hostname, { returnReward: true })
        if (reward) {
          totals.solved++
          totals.rewards.push(reward)
          if (totals.rewards.length > 30) totals.rewards.shift()
          ns.tprint(`ctauto: solved ${c.contract} @ ${c.hostname} — ${reward}`)
        } else {
          totals.wrong++
          ns.tprint(`ctauto: WRONG on ${c.type} (${c.contract} @ ${c.hostname})`)
        }
        await ns.sleep(50)
      }

      ns.write(
        STATUS,
        JSON.stringify({ at: new Date().toISOString(), lastScanFound: found.length, ...totals }, null, 2),
        'w',
      )
    } catch (err) {
      // Never die: this is meant to run for hours with nobody watching.
      ns.print(`cycle error: ${err}`)
    }

    await ns.sleep(interval)
  }
}
