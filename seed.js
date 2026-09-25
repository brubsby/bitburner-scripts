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
// Pure: whether a hacknet SERVER's RAM may be used (hacknet.js's ramPolicy).
import { hacknetHostAllowed, isHacknetServerHost } from 'hacknetplan.js'

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
  const publish = reporter(ns, TELEMETRY, () => last)
  // THE DAEMON MIRRORS /tel/* FROM HOME ONLY, and boot.js places this script
  // `where: 'anywhere'`. Off home every record above — including the atExit
  // one that says why it stopped — is written where nothing will ever read it,
  // which defeats the point the comment above makes about --watch mode.
  // ns.scp is already in this file's price for pushing the seeded scripts out.
  // Invariant C12.
  const mirror = () => {
    try {
      if (ns.getHostname() !== 'home') ns.scp(TELEMETRY, 'home', ns.getHostname())
    } catch {
      /* home unreachable; the local copy still stands */
    }
  }
  const note = (health, fields) => {
    publish(health, fields)
    mirror()
  }
  ns.atExit(() => {
    publish.exit('stopped', { detail: 'seed.js exited' })
    mirror()
  })

  do {
    try {
      last = await pass(ns, flags)
      note(last.refused?.length ? 'degraded' : 'ok', {
        result: 'ok',
        detail:
          `${last.placed.length} placed, ${last.newlyRooted.length} newly rooted` +
          (last.refused?.length ? `, ${last.refused.length} REFUSED: ${last.refused.join('; ')}` : ''),
      })
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
  // RANKED BY YIELD PER UNIT OF PREPARATION, not by how rich the server is.
  //
  // This sorted on maxMoney alone — richest hackable target first — which is a
  // proxy for yield that silently assumes preparing a target is cheap. In
  // BitNode 1 it is. BitNode 5 sets ServerStartingSecurity: 2, so every server
  // starts at twice the security, the weaken time at the top of our level range
  // balloons, and a handful of opening threads cannot move it.
  //
  // Measured live on entering BitNode 5: seven early.js threads pointed at
  // harakiri-sushi (requires hacking 80) sat in the weaken phase for FIVE HOURS
  // and twelve minutes, money frozen at exactly $1262 — the post-install
  // starting balance — while hacking crawled 98 -> 99. Not slow: it would never
  // have reached the hack phase at all. And because the watchdog is tier 64,
  // nothing at tier 32 was supervising well enough to say so.
  //
  // The fix is to stop ranking on the numerator alone. Dividing by the security
  // excess and the weaken time makes the ranking self-correcting across the
  // whole climb: a small, already-calm server wins the opening, and the rich
  // ones take over as the level rises and weaken times fall — which is the
  // behaviour the old sort was assuming it already had.
  const prepScore = (h) => {
    const money = ns.getServerMaxMoney(h)
    const excess = Math.max(0, ns.getServerSecurityLevel(h) - ns.getServerMinSecurityLevel(h))
    const wt = Math.max(1, ns.getWeakenTime(h) / 1000)
    return money / ((1 + excess) * wt)
  }
  const targets = all
    .filter((h) => ns.hasRootAccess(h) && ns.getServerMaxMoney(h) > 0 && ns.getServerRequiredHackingLevel(h) <= level)
    .sort((a, b) => prepScore(b) - prepScore(a))
  if (!targets.length) {
    ns.tprint('seed: nothing hackable at this level yet')
    return { level, targets, placed: [], newlyRooted }
  }

  const earlyCost = ns.getScriptRam(EARLY, 'home')
  const cheapCost = ns.getScriptRam(CHEAP, 'home')
  const placed = []
  const refused = []

  // Assignment is by the host's INDEX in the rooted list, not by a counter that
  // advances only when we place. A counter shifts every host's target whenever
  // one of them is skipped, so a single full host would re-target the entire
  // fleet on the next pass and throw away all of their prepped state.
  // HOME IS NOT SEED'S TO FILL. boot.js owns home's budget: it prices the
  // resident controllers, reserves exactly MIN_OPS worker slots for the worker
  // it SPAWNS itself, and plans the tier around what is left. seed placing
  // workers here too both duplicates that worker and overruns the reserve,
  // and boot has no way to defend itself — it plans once and exits.
  //
  // Measured live in BitNode 5 on a 32GB home: seed had placed NINE early.js
  // threads (21.6GB) next to cmd.js (8.15GB), leaving 2.25GB. boot's own plan
  // reserves four slots (9.6GB). So progress.js (2.6GB) and autobuy.js (4.15GB)
  // were both deferred for want of RAM that seed had taken — and autobuy is the
  // only thing that buys port programs, which gate rooting, which gates the
  // fleet. The node sat at 13 rooted hosts of 70 and $21/s.
  //
  // It also produced the visible symptom: a terminal repeating "Cannot run
  // progress.js (t=1) on home. This script requires 2.60GB of RAM."
  //
  // Every other rooted host is fair game — they have no controllers on them and
  // free RAM there is worth exactly one thing.
  //
  // NOR IS A HACKNET SERVER, unless hacknet.js's ramPolicy says the RAM earns
  // more running workers than the hashes it costs: its hash rate carries
  // (1 - ramUsed/maxRam) (Hacknet/formulas/HacknetServers.ts:14), so filling
  // one with early.js turns its production off. Missing or stale policy:
  // excluded (hacknetplan.hacknetHostAllowed fails closed).
  const here = ns.getHostname()
  if (here !== 'home') {
    try {
      ns.scp('/tel/hacknet.txt', here, 'home')
    } catch {
      /* the previous copy stays; its stamp decides freshness */
    }
  }
  const hnPolicy = ns.read('/tel/hacknet.txt')
  const hosts = all.filter((h) => h !== 'home' && ns.hasRootAccess(h) && hacknetHostAllowed(h, hnPolicy))
  // early.js/hgw.js loop forever, so a worker placed on a hacknet server
  // before the policy said no would hold its RAM (and the hashes it costs)
  // indefinitely. Withdraw them.
  for (const h of all) {
    if (!isHacknetServerHost(h) || hacknetHostAllowed(h, hnPolicy) || !ns.hasRootAccess(h)) continue
    for (const p of ns.ps(h)) if (p.filename === EARLY || p.filename === CHEAP) ns.kill(p.pid)
  }
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
    // THE IMPORT GRAPH TRAVELS WITH THE WORKER. Both workers import status.js
    // (their reporter), and a host holding early.js alone cannot price it:
    // createRunningScriptInstance (NetscriptWorker.ts:288-292) fails the RAM
    // calculation on the missing import and exec returns 0. Seen live in
    // BitNode 2 on 2026-09-19: three freshly rooted 16GB hosts refused
    // "6xearly.js (14.40GB of 16.00GB free)" every pass, while hosts that had
    // received the whole collection from boot.js ran the same launch fine.
    if (h !== 'home') ns.scp([script, 'status.js'], h, 'home')
    const pid = ns.exec(script, h, threads, target, flags.floor)
    if (pid) placed.push(`${h}:${threads}x${script} -> ${target}`)
    // exec returns 0 on refusal instead of throwing. This branch did not exist,
    // so a host that refused every placement was indistinguishable from a host
    // that needed none: `placed` simply stayed short and the tprint below
    // reported the smaller number as though it were the whole plan.
    else refused.push(`${h}: exec refused ${threads}x${script} (${(threads * cost).toFixed(2)}GB of ${free.toFixed(2)}GB free)`)
  }

  if (placed.length || newlyRooted.length || refused.length) {
    ns.tprint(
      `seed: rooted ${newlyRooted.length}, (re)placed ${placed.length} — ${placed.join(', ') || 'no change'}` +
        (refused.length ? ` | REFUSED ${refused.length}: ${refused.join('; ')}` : ''),
    )
  }
  // The telemetry write is main()'s job now, through status.js, so that the
  // kill path and the nothing-hackable path publish too — both used to return
  // before reaching the write here and leave the file frozen at the last good
  // pass.
  return { level, targets, placed, refused, newlyRooted }
}
