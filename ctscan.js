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

export async function main(ns) {
  ns.disableLog('ALL')

  const found = []

  for (const host of scanAll(ns)) {
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

  ns.write(OUTPUT, JSON.stringify(found), 'w')

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
