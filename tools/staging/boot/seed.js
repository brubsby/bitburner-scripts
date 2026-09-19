// Fills every rooted host with a self-threaded worker, one instance per host.
//
//   run seed.js                    spread over the best hackable targets
//   run seed.js --target n00dles   everything on one target
//   run seed.js --kill             stop every worker first
//
// Why this exists as well as batch.js.
//
// batch.js sizes a batch against the WHOLE fleet (`share = totalRam /
// targets.length`) but each op has to be placed on a SINGLE host, because
// threads of one ns.exec cannot span machines. On a large fleet those two facts
// never collide. On the opening fleet they always do: at 8 rooted hosts of
// <=16GB, a plan wanting 11 hack threads needs 18.7GB contiguous, no host has
// it, and the batcher reports `placeFails` forever while earning nothing — 7,274
// failures and $0 over 27 minutes is how this was found. CLAUDE.md already
// records the same lesson for share.js ("take a fraction of the largest free
// block, not of the fleet"); batch.js has it too.
//
// early.js has no such problem: it is a self-contained loop, so one instance per
// host uses whatever that host has. It is strictly worse than a real batcher per
// unit of RAM — but infinitely better than a batcher that cannot place.
//
// Targets are assigned round-robin over what is actually hackable, rather than
// all-on-one, because every instance on a target drains it and then waits for
// grow. Spreading keeps more of them in their hack phase.
//
// ---------------------------------------------------------------------------
// TWO WORKERS, CHOSEN PER HOST
// ---------------------------------------------------------------------------
//
// early.js costs 2.40GB and reads server state to decide what to do. hgw.js
// costs 2.00GB and decides from the return values of hack/grow/weaken instead —
// worse per thread, and the only self-threaded loop that fits four concurrent
// operations into an 8GB host (4 x 2.40 = 9.60GB does not).
//
// A host with room for four early.js threads gets early.js; a host without gets
// hgw.js. That rule matters most on a virgin BitNode entry, where home is 8GB
// (Prestige.ts:242-248) and n00dles is 4GB, while foodnstuff/joesguns/
// sigma-cosmetics are 16GB and take early.js happily. Nothing is one-size here:
// the fleet at that moment spans 4GB to 16GB hosts.

// Free: status.js references only ns.write (0GB) and ns.atExit is 0GB.
import { reporter, describe } from 'status.js'

const EARLY = 'early.js'
const CHEAP = 'hgw.js'
/** One complete HGW batch. Below this, the tuned worker is not worth its extra RAM. */
const MIN_OPS = 4
const TELEMETRY = '/tel/seed.txt'

export async function main(ns) {
  const flags = ns.flags([
    ['target', ''],
    ['kill', false],
    ['floor', 0.05],
    // Keep rooting and re-seeding. Without this the opening silently plateaus:
    // hacking level rises, servers become rootable and better targets become
    // hackable, and nothing notices. watchdog.js would normally cover it but it
    // costs 7.8GB, which on a 32GB home is three worker threads — too expensive
    // in the one phase where threads are the whole game.
    ['watch', false],
    ['every', 60000],
  ])
  ns.disableLog('ALL')

  // Publishes on return, on a handled error, and — via ns.atExit — on a kill,
  // a killall or an augmentation install, which is the path no try/finally can
  // reach. In --watch mode this is the only evidence the loop is still alive;
  // a status file that stops updating is indistinguishable from a game that
  // stopped changing (invariant C1).
  let last = {}
  const note = reporter(ns, TELEMETRY, () => last)
  ns.atExit(() => note.exit('stopped', { detail: 'seed.js exited' }))

  do {
    try {
      last = await pass(ns, flags)
      note('ok', { result: 'ok', detail: `${last.placed.length} placed, ${last.newlyRooted.length} newly rooted` })
    } catch (err) {
      note('error', { result: 'error', detail: describe(err) })
      ns.tprint(`seed: FAILED ${describe(err)}`)
    }
    if (flags.watch) await ns.sleep(flags.every)
  } while (flags.watch)
}

/**
 * Open every port we have a program for, then nuke. Cheap: 0.05GB per opener.
 *
 * NOTE: no hacking-level test. ns.nuke checks the open port count and NOTHING
 * else (NetscriptFunctions.ts:504-521) — the hacking level gates *hacking* a
 * server, not rooting it. This file used to refuse to root anything above the
 * current level, which on a virgin 8GB entry left joesguns (16GB, level 10) and
 * nectar-net (16GB, level 20) unrooted and unusable as WORKER hosts for the
 * whole early climb, for no reason: a host is RAM whether or not it is a target.
 */
function root(ns, host) {
  if (ns.hasRootAccess(host)) return false
  const openers = [
    ['BruteSSH.exe', ns.brutessh],
    ['FTPCrack.exe', ns.ftpcrack],
    ['relaySMTP.exe', ns.relaysmtp],
    ['HTTPWorm.exe', ns.httpworm],
    ['SQLInject.exe', ns.sqlinject],
  ]
  let open = 0
  for (const [file, fn] of openers) {
    if (ns.fileExists(file, 'home')) {
      try {
        fn(host)
        open++
      } catch {
        /* already open */
      }
    }
  }
  if (open < ns.getServerNumPortsRequired(host)) return false
  try {
    ns.nuke(host)
    return true
  } catch {
    return false
  }
}

async function pass(ns, flags) {

  // BFS the network; ns.scan only sees neighbours.
  const seen = new Set(['home'])
  const queue = ['home']
  while (queue.length) {
    for (const h of ns.scan(queue.shift())) {
      if (!seen.has(h)) {
        seen.add(h)
        queue.push(h)
      }
    }
  }
  const all = [...seen]
  const level = ns.getHackingLevel()

  // Root anything that has become reachable since the last pass.
  const newlyRooted = all.filter((h) => h !== 'home' && root(ns, h))

  if (flags.kill) {
    for (const h of all) {
      if (!ns.hasRootAccess(h)) continue
      ns.scriptKill(EARLY, h)
      ns.scriptKill(CHEAP, h)
    }
    ns.tprint('seed: killed every worker')
    return { level, targets: [], placed: [], newlyRooted }
  }

  // Hackable = rooted, has money, and within our level. moneyMax of 0 means a
  // pure compute box (and home), which is a host but never a target.
  const targets = all
    .filter((h) => ns.hasRootAccess(h) && ns.getServerMaxMoney(h) > 0 && ns.getServerRequiredHackingLevel(h) <= level)
    .sort((a, b) => ns.getServerMaxMoney(b) - ns.getServerMaxMoney(a))
  if (!targets.length) {
    ns.tprint('seed: nothing hackable at this level yet')
    return { level, targets, placed: [], newlyRooted }
  }

  const earlyCost = ns.getScriptRam(EARLY, 'home')
  const cheapCost = ns.getScriptRam(CHEAP, 'home')
  const placed = []

  // Assignment is by the host's INDEX in the rooted list, not by a counter that
  // advances only when we place. A counter shifts every host's target whenever
  // one of them is skipped, so a single full host would re-target the entire
  // fleet on the next pass and throw away all of their prepped state.
  const hosts = all.filter((h) => ns.hasRootAccess(h))
  for (let i = 0; i < hosts.length; i++) {
    const h = hosts[i]
    const target = flags.target || targets[i % targets.length]

    // Check what is running BEFORE looking at free RAM. A host already running
    // a worker has ~0 free, so testing RAM first would `continue` past it
    // forever — and a host pointed at the WRONG target could never be
    // corrected, which is the whole job of a re-seed.
    const cur = ns.ps(h).find((p) => p.filename === EARLY || p.filename === CHEAP)
    if (cur && cur.args[0] === target) continue
    if (cur) {
      ns.kill(cur.pid)
      await ns.sleep(0) // let the kill settle before reading free RAM
    }

    const free = ns.getServerMaxRam(h) - ns.getServerUsedRam(h)
    // The tuned worker where a whole batch of it fits; the 2.00GB one where it
    // does not. On an 8GB home that is the difference between three ops and
    // four, and on a 4GB n00dles it is the difference between one and zero.
    const script = free >= earlyCost * MIN_OPS ? EARLY : CHEAP
    const cost = script === EARLY ? earlyCost : cheapCost
    const threads = Math.floor(free / cost)
    if (threads < 1) continue
    if (h !== 'home') ns.scp(script, h, 'home')
    const pid = ns.exec(script, h, threads, target, flags.floor)
    if (pid) placed.push(`${h}:${threads}x${script} -> ${target}`)
  }

  if (placed.length || newlyRooted.length) {
    ns.tprint(`seed: rooted ${newlyRooted.length}, (re)placed ${placed.length} — ${placed.join(', ') || 'no change'}`)
  }
  // The telemetry write is main()'s job now, through status.js, so that the
  // kill path and the nothing-hackable path publish too — both used to return
  // before reaching the write here and leave the file frozen at the last good
  // pass.
  return { level, targets, placed, newlyRooted }
}
