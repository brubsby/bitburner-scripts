// The Singularity half of autobuy.js. Nothing else belongs in this file.
//
//   run autobuy-sing.js tor
//   run autobuy-sing.js BruteSSH.exe FTPCrack.exe
//   run autobuy-sing.js tor BruteSSH.exe
//
// WHY THIS IS A SEPARATE SCRIPT, since a two-line helper looks like overkill.
//
// Netscript bills a script for every ns function anywhere in its import graph,
// reachable or not (Script/RamCalculations.ts:407). `ns.singularity.*` is
// billed at x16 outside BitNode 4 with Source-File 4 level 1
// (RamCostGenerator.ts:82-96), so keeping these two calls inline in autobuy.js
// priced that script at 5.85GB inside BN4 and **65.85GB** at SF4.1 anywhere
// else — and autobuy.js is in boot.js's STACK and watchdog.js's WATCHED list,
// so it is launched every life, at a home size that starts at 8/32/128GB. A
// 65.85GB permanent resident does not fit anywhere early, and the watchdog
// would have logged "no host with NGB free" forever.
//
// Scripts are billed independently, so the fix is the go.js / go-cheat.js split
// that CLAUDE.md prescribes: probe cheaply in the caller, put the expensive
// surface in its own file, and pay for it only for the few seconds it runs, and
// only on a save that can actually call it.
//
// The caller is autobuy.js, which gates on `canUseSingularity` before exec'ing
// this. The gate is re-asserted here, through the SAME helper — not a second
// copy of the rule, which is how `>= 2` survived for go.cheat, but a second
// call to the one place the rule lives. It costs 1GB on a script that is
// already paying for Singularity, and it turns "someone ran this by hand in
// BitNode 1" from a raw API exception into a sentence naming the cause.

import { canUseSingularity } from 'sfgate.js'

const STATUS = '/tel/autobuy-sing.txt'
const TOR = 'tor'

export async function main(ns) {
  ns.disableLog('ALL')
  const items = ns.args.map(String)
  const done = []
  const failed = []

  if (!canUseSingularity(ns.getResetInfo())) {
    const why = 'no Source-File 4 and not inside BitNode 4 — autobuy.js should have used the terminal bridge instead'
    ns.write(STATUS, JSON.stringify({ at: new Date().toISOString(), asked: items, done, failed: [why] }, null, 2), 'w')
    ns.tprint(`autobuy-sing: refusing, ${why}`)
    return
  }

  // ns.singularity is read through a local so the RAM calculator prices exactly
  // the two members used, the same way autobuy.js used to. The call sites are
  // unconditional: reaching this file at all is the caller's assertion that
  // Source-File 4 is present.
  const sing = ns.singularity

  for (const item of items) {
    try {
      // TOR first if it was asked for: every `purchaseProgram` needs the
      // darkweb, and the darkweb is what TOR connects (ServerHelpers.ts:354).
      const ok = item === TOR ? sing.purchaseTor() : sing.purchaseProgram(item)
      if (ok) done.push(item)
      else failed.push(item)
    } catch (err) {
      failed.push(`${item}: ${String(err).slice(0, 120)}`)
    }
  }

  ns.write(STATUS, JSON.stringify({ at: new Date().toISOString(), asked: items, done, failed }, null, 2), 'w')
  if (done.length) ns.tprint(`autobuy-sing: bought ${done.join(', ')}`)
}
