// Phase 2 of contract harvesting: solve what ctscan.js recorded and submit it.
//
//   run ctscan.js      first
//   run ctsolve.js     then this
//   run ctsolve.js --dry   solve and report, submit nothing
//
// Kept apart from ctscan.js because attempt (10GB) plus getContractType and
// getData (5GB each) exceeds any RAM we own. Solvers live in ctsolvers.js,
// which contains no ns calls and therefore costs nothing to import.
//
// Contracts allow a limited number of wrong answers before they self-destruct,
// so anything without a known solver is skipped rather than guessed at.

import { findAnswer } from 'ctsolvers.js'
import { bigintReviver } from 'ctbigint.js'

const INPUT = '/tmp/contracts.json'


export async function main(ns) {
  const flags = ns.flags([['dry', false]])
  ns.disableLog('ALL')

  if (!ns.fileExists(INPUT, 'home')) {
    ns.tprint(`ctsolve: ${INPUT} not found — run ctscan.js first`)
    return
  }

  let contracts
  try {
    contracts = JSON.parse(ns.read(INPUT), bigintReviver)
  } catch (err) {
    ns.tprint(`ctsolve: cannot parse ${INPUT}: ${err}`)
    return
  }

  if (!contracts.length) {
    ns.tprint('ctsolve: nothing to do')
    return
  }

  let solved = 0
  let failed = 0
  let skipped = 0
  const rewards = []

  for (const contract of contracts) {
    let answer
    try {
      answer = findAnswer(contract)
    } catch (err) {
      ns.tprint(`ERROR solver threw on ${contract.type} (${contract.contract} @ ${contract.hostname}): ${err}`)
      skipped++
      continue
    }

    if (answer === undefined || answer === null) {
      // No solver for this type. Guessing burns one of the contract's limited
      // attempts, so leave it for a future version instead.
      ns.tprint(`SKIP no solver for "${contract.type}" (${contract.contract} @ ${contract.hostname})`)
      skipped++
      continue
    }

    if (flags.dry) {
      ns.tprint(`DRY ${contract.type} @ ${contract.hostname} -> ${JSON.stringify(answer).slice(0, 120)}`)
      solved++
      continue
    }

    const reward = ns.codingcontract.attempt(answer, contract.contract, contract.hostname, { returnReward: true })

    if (reward) {
      solved++
      rewards.push(reward)
      ns.tprint(`SOLVED ${contract.contract} @ ${contract.hostname} — ${reward}`)
    } else {
      failed++
      ns.tprint(`WRONG ${contract.type} (${contract.contract} @ ${contract.hostname})`)
    }

    await ns.sleep(10)
  }

  ns.tprint(`ctsolve: ${solved} solved, ${failed} wrong, ${skipped} skipped, of ${contracts.length}`)

  ns.write(
    '/tel/contracts.txt',
    JSON.stringify({ at: new Date().toISOString(), solved, failed, skipped, total: contracts.length, rewards }, null, 2),
    'w',
  )

  if (!flags.dry) ns.rm(INPUT)
}
