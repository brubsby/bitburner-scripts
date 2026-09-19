// Phase 1 of contract harvesting: find every contract on the network and
// record its type and data to /tmp/contracts.json. Run ctsolve.js afterwards.
//
//   run ctscan.js
//   run ctsolve.js
//
// Why this is split from solving: ns.codingcontract.getContractType (5GB),
// getData (5GB) and attempt (10GB) together put any single script over 21.8GB,
// and nothing we own has that much RAM. Reading and answering are independent,
// so they run in sequence on one 16GB home instead.
//
// This also drops the old contract.js dependency on a BB_SERVER_MAP blob in
// localStorage left behind by spider.js — it scans the network itself.

import { bigintReplacer } from 'ctbigint.js'

const OUTPUT = '/tmp/contracts.json'


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

const STATUS = '/tel/ctscan.txt'

export async function main(ns) {
  ns.disableLog('ALL')

  // C1: publish on every exit path. This script previously died with no trace
  // at all -- no output file, no status, nothing but a modal on the player's
  // screen that an agent driving over the RFA cannot see. An empty result and
  // a crash looked identical from outside, and one was read as the other.
  let state = { phase: 'start', scanned: 0, found: 0, error: null }
  const publish = () => ns.write(STATUS, JSON.stringify(state), 'w')
  ns.atExit(publish)

  try {
    await scan(ns, state)
  } catch (err) {
    state.phase = 'threw'
    state.error = `${err?.stack ?? err}`
    publish()
    ns.tprint(`ERROR ctscan died in ${state.phase}: ${err}`)
    throw err
  }
}

async function scan(ns, state) {
  const found = []

  state.phase = 'scanAll'
  const hosts = scanAll(ns)
  state.scanned = hosts.length

  for (const host of hosts) {
    state.phase = `ls ${host}`
    for (const file of ns.ls(host).filter((f) => f.endsWith('.cct'))) {
      try {
        found.push({
          contract: file,
          hostname: host,
          type: ns.codingcontract.getContractType(file, host),
          data: ns.codingcontract.getData(file, host),
        })
      } catch (err) {
        ns.tprint(`WARN could not read ${file} on ${host}: ${err}`)
      }
    }
  }

  state.phase = 'write'
  state.found = found.length
  // Some contract types (Find Largest Prime Factor and friends) hand back
  // BigInt data, which JSON.stringify throws on rather than coercing. Tag it
  // so ctsolve.js can revive a real BigInt -- a solver handed the string
  // "123" instead of 123n would fail every arithmetic step silently.
  ns.write(OUTPUT, JSON.stringify(found, bigintReplacer), 'w')
  state.phase = 'done'

  if (!found.length) {
    ns.tprint('ctscan: no contracts on the network right now')
    return
  }

  const byType = {}
  for (const c of found) byType[c.type] = (byType[c.type] ?? 0) + 1

  ns.tprint(`ctscan: ${found.length} contract(s) -> ${OUTPUT}`)
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    ns.tprint(`  ${count}x ${type}`)
  }
  ns.tprint('now run: run ctsolve.js')
}
