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
// Pure: the trader's placement priced as trajectories (nodeecon), the home tier's price (homecost).
import { traderPlacement } from 'nodeecon.js'
import { canAccessFeature, sfLevel, singularityRamMultiplier, canUseGrafting, canJoinBladeburner } from 'sfgate.js'
import { ramUpgradeCost } from 'homecost.js'
// Pure: the exp-mode gate and the exp-per-thread rule, and the node table.
import { expMode, expPerThread } from 'expfarm.js'
import { bitNodeMults } from 'bitNodeMultipliers.js'
// Pure: whether a hacknet SERVER's RAM may be used (hacknet.js's ramPolicy).
import { hacknetHostAllowed, isHacknetServerHost } from 'hacknetplan.js'
// Pure (0GB): the full Bladeburner daemon's reserved block, kept free of workers.
import { reservesOf, RAISED, EVICTABLE, RELOCATABLE, GO_OUTRANKS, JOB_RUNNER_TIER, goPlacementOf, actionSlotOf, stockHeldOf, goHostBuyOf, GO_HOST, BB_HOST, goHomeRepairOf, reserveRecordOf, cloudCostOf } from 'raiseplace.js'
// Pure (0GB): go.js's priced placement verdict (with vs without, to the 128GB home tier).
import { goPlaceStreamsOf, goPlaceValueOf, goMilestoneOf } from 'goplace.js'
// Pure (0GB): bb-lite.js's reservation (seed's workers leave it free, as batch.js's do) and its server.
import { LITE_FILE, BB_FILE, liteReserveOf, liteHostBuyOf } from 'bbliteplan.js'
// ns.read only (0GB): the work-slot claim, the Bladeburner route's commitment.
import { slotClaim, SLOT_FILES } from 'bbslot.js'

const EARLY = 'early.js'
const CHEAP = 'hgw.js'
/** One complete HGW batch. Below this, the tuned worker is not worth its extra RAM. */
const MIN_OPS = 4
const TELEMETRY = '/tel/seed.txt'
/** Exp mode's money floor: hack until the balance is a millionth of max (any positive balance pays full exp). */
const EXP_FLOOR = 1e-6

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
        result: last.why ? 'retired-for-batch' : 'ok',
        go: lastGo,
        bbHost: lastLiteHost,
        detail:
          (last.why ? `${last.why}; ` : '') +
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

export async function pass(ns, flags) {

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
  // Exp mode where hacking pays nothing (expfarm.expMode); the floor drops so
  // early.js / hgw.js hack whenever the balance is positive.
  const exp = expMode(bitNodeMults(ns.getResetInfo().currentNode))
  const floor = exp ? EXP_FLOOR : flags.floor

  // Root anything that has become reachable since the last pass.
  const newlyRooted = all.filter((h) => h !== 'home' && root(ns, h))

  // GO FIRST (raiseplace.js, priced by goplace.js): where the farm beats the
  // RAM it displaces, go.js is placed before any worker is, at any home size.
  // Its own try: a placement fault
  // must not cost the pass that keeps the fleet working.
  try {
    await placeGo(ns, all)
  } catch (err) {
    lastGo = { ...(lastGo ?? {}), error: describe(err) }
  }
  // A SERVER FOR bb-lite.js's ACTORS when they starve on the Bladeburner slot
  // (bbliteplan.liteHostBuyOf). Its own try, like placeGo's.
  try {
    await placeLiteHost(ns, all)
  } catch (err) {
    lastLiteHost = { ...(lastLiteHost ?? {}), error: describe(err) }
  }

  // RETIRED WHILE THE BATCHER RUNS. batch.js places its own h/g/w on every
  // host; early.js/hgw.js loop forever and hold their RAM. Live 2026-10-02
  // 18:10Z (BN4, 64GB home): early.js held ~31GB on seven 32/64GB hosts long
  // after the watchdog had batch.js running, so nothing else could be placed
  // (bb-lite.js, its actors). Rooting carries on above; the workers go.
  const batching = all.some((h) => ns.hasRootAccess(h) && ns.ps(h).some((p) => p.filename === 'batch.js'))
  if (batching || flags.kill) {
    const retired = []
    for (const h of all) {
      if (!ns.hasRootAccess(h)) continue
      if (ns.ps(h).some((p) => p.filename === EARLY || p.filename === CHEAP)) retired.push(h)
      ns.scriptKill(EARLY, h)
      ns.scriptKill(CHEAP, h)
    }
    if (batching && !flags.kill) return { level, targets: [], placed: [], refused: [], newlyRooted, retired, why: `batch.js is running: early.js/hgw.js retired on ${retired.length} host(s); seed.js only roots` }
  }
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
  // EXP MODE (expfarm.js): where scripted hacking pays nothing (BitNode 8) the
  // workers' only product is hacking exp, so targets rank by exp per second of
  // op time — (3 + 0.3 x baseDifficulty) / hack time (Hacking.ts:30-38,
  // :59-74), with the same security-excess penalty — and the money floor
  // drops to ~0: a hack pays full exp while ANY money is left
  // (NetscriptHelpers.tsx:636-641), and a hack holds its RAM a quarter as
  // long as a weaken, so early.js should hack nearly always. baseDifficulty is
  // approximated as 3 x minDifficulty (Server.ts: min = max(1, round(base/3)))
  // to avoid pricing another getter into a worker-sized script.
  const expRank = (h) => {
    const excess = Math.max(0, ns.getServerSecurityLevel(h) - ns.getServerMinSecurityLevel(h))
    const wt = Math.max(1, ns.getWeakenTime(h) / 1000)
    return expPerThread(3 * ns.getServerMinSecurityLevel(h)) / ((1 + excess) * wt)
  }
  const targets = all
    .filter((h) => !isHacknetServerHost(h) && ns.hasRootAccess(h) && ns.getServerMaxMoney(h) > 0 && ns.getServerRequiredHackingLevel(h) <= level)
    .sort((a, b) => (exp ? expRank(b) - expRank(a) : prepScore(b) - prepScore(a)))
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
  // THE TRADER'S BLOCK (nodeecon.traderPlacement): where TIX is owned and
  // the trader is not running anywhere, place it on the smallest rooted
  // host that holds it — evicting that host's workers — when the priced
  // trajectory to the next home tier says it wins.
  // bb-lite.js's reservation (bbliteplan.liteReserveOf, the one batch.js
  // honours): its actor headroom stays free of OUR workers and the trader too.
  // Live BN14.2 (2026-10-05) seed.js was the only worker placer at a 32GB home
  // and did not read it, so any host big enough for the reservation was
  // filled; at 23:02Z the trader then took the reserved go-host (3.4GB left).
  const liteHold = liteHoldOf(ns, all)
  const traderHost = await placeTrader(ns, all, hosts, liteHold)
  // The raise-sized daemons' reservations (raiseplace.js) live on home
  // ([bitburner-offhome-reads]); one copy each, so a missing file costs only itself.
  const fullHeld = (() => {
    try {
      if (here !== 'home') {
        for (const r of Object.values(RAISED)) {
          try {
            ns.scp(r.file, here, 'home')
          } catch {
            /* none published: nothing reserved */
          }
        }
      }
      return new Set(reservesOf((f) => ns.read(f), ns.getResetInfo(), all).map((r) => r.host))
    } catch {
      return null
    }
  })()
  for (let i = 0; i < hosts.length; i++) {
    const h = hosts[i]
    if (h === traderHost) continue
    const target = flags.target || targets[i % targets.length]

    // Check what is running BEFORE looking at free RAM. A host already running
    // a worker has ~0 free, so testing RAM first would `continue` past it
    // forever — and a host pointed at the WRONG target could never be
    // corrected, which is the whole job of a re-seed.
    const cur = ns.ps(h).find((p) => p.filename === EARLY || p.filename === CHEAP)
    // A raise-sized daemon's reserved block (raiseplace.reservesOf, the
    // watchdog's: bladeburner.js, sleeve.js, hashspend.js): no worker of ours on that host — they loop forever, so
    // one left there holds the block for good (live BN4 2026-10-03 02:10Z:
    // 53 early.js threads on each 128GB host at the tier that admits it).
    if (fullHeld && fullHeld.has(h)) {
      if (cur) ns.kill(cur.pid)
      continue
    }
    // The headroom kept here for bb-lite: its reservation, less what its own
    // scripts already hold of it (a running actor or the coordinator).
    const keep = liteHold?.host === h ? Math.max(0, liteHold.gb - ns.ps(h).filter((q) => /^bb-lite/.test(q.filename)).reduce((a, q) => a + ns.getScriptRam(q.filename, h) * q.threads, 0)) : 0
    if (cur && cur.args[0] === target && Number(cur.args[1]) === floor && (keep === 0 || ns.getServerMaxRam(h) - ns.getServerUsedRam(h) >= keep - 1e-9)) continue
    if (cur) {
      ns.kill(cur.pid)
      await ns.sleep(0) // let the kill settle before reading free RAM
    }

    const free = ns.getServerMaxRam(h) - ns.getServerUsedRam(h) - keep
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
    const pid = ns.exec(script, h, threads, target, floor)
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
  return { level, targets, placed, refused, newlyRooted, expMode: exp, floor, trader: lastTrader }
}

let lastTrader = null
const TRADER = 'stock.js'

// ---------------------------------------------------------------------------
// GO FIRST (raiseplace.js GO FIRST). Below 64GB nothing else places go.js:
// boot.js plans once (and admits it at 128GB), the watchdog is tier 64. This
// pass is the placer from the 8GB opening to 128GB, where seed.js retires.
let lastGo = null
const GO = 'go.js'
const GOHOST = 'gohost.js'

/**
 * Place go.js where its PRICED verdict says (goplace.goPlaceValueOf: the money
 * to the 128GB home tier with go.js placed now vs waiting for that tier, the
 * placement's displaced workers charged). Home only with act.js's whole
 * action slot kept beside it; otherwise (the usual case below 128GB) a fleet
 * host. A go.js already on home that is eating the slot (live BN14.1
 * 18:59-20:49Z) is moved to a fleet host once one can hold it, with its args
 * (a pin) kept. A go.js the verdict does not place is left running (boot.js
 * keepIfRunning), never killed.
 */
export async function placeGo(ns, all) {
  const reset = ns.getResetInfo()
  const mults = bitNodeMults(reset.currentNode)
  const goPower = mults?.GoPower
  const sf14 = sfLevel(reset, 14)
  const here = ns.getHostname()
  const file = RAISED[GO].file
  const writeRec = (d) => {
    ns.write(file, JSON.stringify(reserveRecordOf(d, reset, Date.now(), GO)), 'w')
    if (here !== 'home') ns.scp(file, 'home', here)
  }
  const rooted = all.filter((h) => ns.hasRootAccess(h))
  const homeMax = ns.getServerMaxRam('home')
  // act.js's action slot SIZED TO THIS NODE (raiseplace.actionSlotOf): the
  // largest actor it will launch at this home size, SF4 level and book.
  if (here !== 'home') {
    try {
      ns.scp('/tel/stock.txt', here, 'home')
    } catch {
      /* no record: no book */
    }
  }
  const slot = actionSlotOf({ ramOf: (a) => ns.getScriptRam(a, 'home'), homeMax, grafting: canUseGrafting(reset), stockHeld: stockHeldOf(ns.read('/tel/stock.txt'), reset.lastAugReset) })
  const homeKeep = slot.gb
  // A raise-sized daemon (hashspend.js) holds its RAISED block, not the floor
  // ns.getScriptRam reads (raiseplace.js header): count what it frees.
  const ramOf = (s, h) => Math.max(ns.getScriptRam(s, h), s !== GO ? RAISED[s]?.gb ?? 0 : 0)
  const gbOn = (h, names) => ns.ps(h).filter((p) => names.includes(p.filename)).reduce((a, p) => a + ramOf(p.filename, h) * p.threads, 0)
  const homeProcs = () => ns.ps('home').map((p) => ({ script: p.filename, gb: ramOf(p.filename, 'home') * p.threads, args: p.args }))
  let prev = null
  try {
    if (here !== 'home') ns.scp(file, here, 'home')
    prev = JSON.parse(ns.read(file) || 'null')
  } catch {
    prev = null
  }
  // Another daemon's live reservation is not room for go.js.
  const others = reservesOf((f) => ns.read(f), reset, rooted).filter((r) => r.script !== GO)
  const held = (h) => others.reduce((a, r) => a + (r.host === h ? r.gb : 0), 0)
  const progressRunning = ns.ps('home').some((p) => p.filename === 'progress.js')
  const need = ns.getScriptRam(GO, 'home')
  const hostsOf = (offHome = false) =>
    rooted
      .filter((h) => !(offHome && h === 'home'))
      .map((h) => ({
        host: h,
        max: ns.getServerMaxRam(h),
        used: ns.getServerUsedRam(h) + held(h),
        workerGb: gbOn(h, ['h.js', 'g.js', 'w.js']),
        evictGb: gbOn(h, EVICTABLE),
        relocGb: h === 'home' ? gbOn(h, RELOCATABLE) : 0,
        yieldGb: h === 'home' ? gbOn(h, GO_OUTRANKS) : 0,
        hacknet: isHacknetServerHost(h),
      }))
  const decideAs = (go, offHome = false) =>
    goPlacementOf({
      go,
      homeMax,
      need,
      homeKeep,
      // progress.js's block only where something runs it (the watchdog tier).
      homeBlock: homeMax >= JOB_RUNNER_TIER ? 13 + 6.25 * singularityRamMultiplier(reset) : 0,
      progressRunning,
      prev,
      hosts: hostsOf(offHome),
    })

  // THE PRICED VERDICT (goplace.js). Shared inputs: the streams from home's
  // telemetry (ns.read is local: [bitburner-offhome-reads]), the endpoint, and
  // what the placement it would take costs — its displaced hacking workers
  // over every worker in the fleet, or a server's price up front.
  const streams = goPlaceStreamsOf({
    status: homeJson(ns, '/tel/status.txt'),
    hacknet: homeJson(ns, '/tel/hacknet.txt'),
    stock: homeJson(ns, '/tel/stock.txt'),
    goTel: homeJson(ns, '/tel/go.txt'),
    posterior: homeJson(ns, '/tel/go-posterior.txt'),
    lastAugReset: reset.lastAugReset,
    goPower,
    sf14,
  })
  const milestone = goMilestoneOf({ homeMax, ramCostMult: mults?.HomeComputerRamCost })
  const workerGb = hostsOf(false)
    .filter((h) => !h.hacknet)
    .reduce((a, h) => a + h.workerGb + h.evictGb, 0)
  const hostRam = 2 ** Math.ceil(Math.log2(Math.max(8, need)))
  const priceOf = (d, keep = false) =>
    goPlaceValueOf({
      streams,
      goPower,
      sf14,
      target: milestone.target,
      // Keeping a running go.js holds its block from the workers; a reserve takes raisedPlacementOf's workersGb.
      displacedGb: keep ? Math.min(need, workerGb) : d.action === 'reserve' ? d.workersGb ?? 0 : 0,
      workerGb,
      upfront: d.action === 'blocked' ? cloudCostOf(hostRam, mults) : 0,
      executable: d.action !== 'blocked' || !(mults && Number.isFinite(mults.CloudServerLimit) && mults.CloudServerLimit <= 0),
    })
  const verdictOf = (v, extra = {}) => ({ goFirst: v.goFirst, priced: v.priced, effective: v.effective, withH: v.withH, withoutH: v.withoutH, gainH: v.gainH, arm: v.arm, displacedGb: v.displacedGb ?? null, workerGb: v.workerGb ?? null, target: milestone.target, toRam: milestone.toRam, lastAugReset: reset.lastAugReset, streams: streams.src, ...(v.notSimulated ? { notSimulated: v.notSimulated } : {}), ...extra, why: v.why })

  const running = rooted.find((h) => ns.ps(h).some((p) => p.filename === GO)) ?? null
  // Not running: the verdict prices the placement the rule would take now.
  const go = running ? priceOf({ action: 'running' }, true) : priceOf(decideAs({ goFirst: true, why: 'the placement the verdict prices' }))
  const decide = (offHome = false) => decideAs(go, offHome)
  if (!go.goFirst) {
    // Released at once rather than left to age out (RESERVE_FRESH_MS).
    if (!running) writeRec({ action: 'wait', why: go.why })
    lastGo = verdictOf(go, { action: running ? 'running' : 'wait', host: running })
    return running
  }
  if (running && running !== 'home') {
    writeRec({ action: 'running', why: `${GO} is running on ${running}: nothing reserved` })
    lastGo = verdictOf(go, { action: 'running', host: running })
    return running
  }
  if (running === 'home') {
    // On home it must leave act.js's whole action slot (goHomeRepairOf):
    // first by moving the worker and the relocatable daemons, else by moving
    // go.js itself to the fleet.
    const procs = homeProcs()
    const r = goHomeRepairOf({ max: homeMax, used: ns.getServerUsedRam('home'), keep: homeKeep, procs })
    if (r.ok) {
      const repaired = r.stop.length ? await moveOffHome(ns, rooted, r.stop, procs.filter((p) => r.stop.includes(p.script))) : []
      writeRec({ action: 'running', why: `${GO} is running on home with the action slot kept` })
      lastGo = verdictOf(go, { action: 'running', host: 'home', homeKeep, slotActor: slot.largest, repaired })
      return 'home'
    }
    const goArgs = ns.ps('home').find((p) => p.filename === GO)?.args ?? []
    let off = decide(true)
    if (off.action === 'reserve' && off.evict) {
      for (const w of EVICTABLE) ns.scriptKill(w, off.host)
      await ns.sleep(0)
      const again = decide(true)
      if (again.action === 'place' || again.action === 'reserve') off = again
    }
    if (off.action === 'place') {
      ns.scp(importClosure(ns, GO), off.host, 'home')
      const pid = ns.exec(GO, off.host, 1, ...goArgs)
      if (pid) {
        ns.scriptKill(GO, 'home')
        ns.tprint(`seed: moved ${GO} off home to ${off.host}: home could not keep the ${homeKeep}GB action slot beside it`)
      }
      writeRec(pid ? { action: 'running', why: `${GO} moved off home to ${off.host}` } : off)
      lastGo = verdictOf(go, { action: pid ? 'moved-off-home' : 'blocked', host: off.host, pid, homeKeep, placement: off.why })
      return pid ? off.host : 'home'
    }
    writeRec(off.action === 'reserve' ? off : { action: 'running', why: `${GO} on home, no fleet host for it yet: ${off.why}` })
    lastGo = verdictOf(go, { action: 'running', host: 'home', homeKeep, slotEaten: true, pending: off.action, placement: off.why })
    return 'home'
  }

  let d = decide(false)
  let moved = []
  let yielded = []
  if (d.action === 'reserve' && (d.evict || d.relocate || d.yieldGb > 0)) {
    const procs = d.relocate ? homeProcs() : []
    for (const w of EVICTABLE) ns.scriptKill(w, d.host)
    if (d.relocate) for (const r of RELOCATABLE) ns.scriptKill(r, 'home')
    // GO_OUTRANKS on home, largest first, only until go.js's block is free.
    if (d.yieldGb > 0) {
      let freed = 0
      for (const p of homeProcs().filter((q) => GO_OUTRANKS.includes(q.script)).sort((a, b) => b.gb - a.gb)) {
        if (freed >= d.yieldGb - 1e-9) break
        ns.scriptKill(p.script, 'home')
        yielded.push(p.script)
        freed += p.gb
      }
      if (yielded.length) ns.tprint(`seed: stopped ${yielded.join(', ')} on home: ${GO} outranks them (its priced verdict places it)`)
    }
    await ns.sleep(0)
    const again = decide(false)
    if (again.action === 'place' || again.action === 'reserve') d = { ...again, why: `${again.why} (after clearing ${d.host})` }
    moved = procs.filter((p) => RELOCATABLE.includes(p.script))
  }
  let pid = 0
  if (d.action === 'place') {
    if (d.host !== 'home') ns.scp(importClosure(ns, GO), d.host, 'home')
    pid = ns.exec(GO, d.host, 1)
    if (pid) ns.tprint(`seed: placed ${GO} on ${d.host} (priced: ${go.why.slice(0, 160)})`)
  }
  // NO HOST CAN EVER HOLD IT: buy one the moment cash covers it (gohost.js,
  // a one-shot, so seed.js is not billed for ns.cloud). The next pass places
  // go.js there.
  let buy = null
  if (d.action === 'blocked') {
    buy = goHostBuyOf({ d, cash: ns.getServerMoneyAvailable('home'), need: ns.getScriptRam(GO, 'home'), mults: bitNodeMults(reset.currentNode), exists: all.includes(GO_HOST), home: homeClaimOf(ns) })
    if (buy.buy) await launchHostBuy(ns, rooted, buy)
  }
  writeRec(pid ? { action: 'running', why: `${GO} placed on ${d.host}` } : d)
  // The daemons moved off home start again on a fleet host, after go.js has its block.
  const relocated = moved.length ? await moveOffHome(ns, rooted, [], moved) : []
  lastGo = verdictOf(go, { action: pid ? 'placed' : d.action, host: d.host ?? null, pid, homeKeep, slotActor: slot.largest, relocated, yielded, ...(buy ? { buy } : {}), placement: d.why })
  return pid ? d.host : null
}

/**
 * gohost.js for `buy` (a cloudHostBuyOf verdict with buy: true): on this host
 * or any rooted non-hacknet host with its few GB, else on this host after
 * evicting our own workers here (refilled next pass). Sets buy.pid/host, and
 * buy.why says when it could not start.
 */
async function launchHostBuy(ns, rooted, buy) {
  const here = ns.getHostname()
  const price = ns.getScriptRam(GOHOST, 'home')
  const roomOn = (h) => ns.getServerMaxRam(h) - ns.getServerUsedRam(h) >= price
  let spot = [here, ...rooted.filter((h) => h !== here && !isHacknetServerHost(h))].find(roomOn)
  if (!spot && here !== 'home') {
    // The fleet is full of this script's own workers: make room here (refilled next pass).
    for (const w of EVICTABLE) ns.scriptKill(w, here)
    await ns.sleep(0)
    if (roomOn(here)) spot = here
  }
  if (spot && spot !== 'home' && spot !== here) ns.scp(GOHOST, spot, 'home')
  buy.pid = spot ? ns.exec(GOHOST, spot, 1, buy.ram, buy.name) : 0
  buy.host = spot ?? null
  if (!buy.pid) buy.why = `${buy.why} — but ${GOHOST} (${price}GB) could not start${spot ? ` on ${spot}` : ': no rooted host has the room'}`
  return buy
}

/** A file from home's copy (ns.read is local; [bitburner-offhome-reads]), parsed; null when absent or unreadable. */
function homeJson(ns, f) {
  const here = ns.getHostname()
  try {
    if (here !== 'home') ns.scp(f, here, 'home')
  } catch {
    /* none on home: the old copy, if any, is judged by its stamp */
  }
  try {
    return JSON.parse(ns.read(f) || 'null')
  } catch {
    return null
  }
}

/** /tel/homeup.txt younger than this: homeup.js is alive (--watch publishes every pass). */
export const HOMEUP_FRESH_MS = 3 * 60e3
/**
 * The home claim a cloud purchase must not race (raiseplace.cloudHostBuyOf
 * `home`): what homeup.js spends next ({cost: the next upgrade + its
 * --reserve}) and whether it is alive to spend it (/tel/homeup.txt fresh,
 * not stopped). null when it has published nothing usable: nothing is held,
 * because nothing would take the money.
 */
function homeClaimOf(ns, now = Date.now()) {
  const h = homeJson(ns, '/tel/homeup.txt')
  const at = Date.parse(h?.at ?? '')
  const cost = Number(h?.next?.cost)
  if (!h || !Number.isFinite(cost)) return null
  return { cost: cost + (Number(h.reserve) > 0 ? Number(h.reserve) : 0), live: Number.isFinite(at) && now - at <= HOMEUP_FRESH_MS && h.health !== 'stopped' && h.exited !== true }
}

/** bb-lite.js's reservation this pass (bbliteplan.liteReserveOf, as batch.js reads it), or null. */
function liteHoldOf(ns, all) {
  try {
    const info = ns.getResetInfo()
    return liteReserveOf({
      lite: homeJson(ns, LITE_FILE),
      full: homeJson(ns, BB_FILE),
      info,
      canJoin: canJoinBladeburner(info),
      hosts: all.filter((h) => ns.hasRootAccess(h)).map((h) => ({ host: h, max: ns.getServerMaxRam(h), hacknet: isHacknetServerHost(h) })),
    })
  } catch {
    return null
  }
}

let lastLiteHost = null
/**
 * BUY THE bb-host when bb-lite.js's actors starve on the Bladeburner slot and
 * no rooted host can be made to hold them (bbliteplan.liteHostBuyOf) — the
 * same one-shot gohost.js as go.js's server. Live BN14.2 (2026-10-05):
 * Bladeburner idle ~9h, "no rooted host has 13.6GB free", go.js on the 32GB
 * home, $3.8m in hand; the lead's 32GB server at ~22:30Z ended it.
 * Returns the name bought (gohost.js launched) or null; the verdict is on
 * /tel/seed.txt `bbHost`.
 */
export async function placeLiteHost(ns, all) {
  const info = ns.getResetInfo()
  if (!canJoinBladeburner(info)) {
    lastLiteHost = { buy: false, why: 'no Bladeburner in this node' }
    return null
  }
  const lite = homeJson(ns, LITE_FILE)
  const here = ns.getHostname()
  if (here !== 'home') {
    try {
      ns.scp(SLOT_FILES, here, 'home')
    } catch {
      /* slotClaim judges what is here by its stamps */
    }
  }
  const claim = slotClaim(ns, here, info)
  const rooted = all.filter((h) => ns.hasRootAccess(h))
  const evictOn = (h) => ns.ps(h).filter((p) => EVICTABLE.includes(p.filename)).reduce((a, p) => a + ns.getScriptRam(p.filename, h) * p.threads, 0)
  const v = liteHostBuyOf({
    lite,
    info,
    claim,
    hosts: rooted.map((h) => ({ host: h, max: ns.getServerMaxRam(h), used: ns.getServerUsedRam(h), evictGb: evictOn(h), hacknet: isHacknetServerHost(h) })),
    cash: ns.getServerMoneyAvailable('home'),
    mults: bitNodeMults(info.currentNode),
    exists: all.includes(BB_HOST),
    home: homeClaimOf(ns),
  })
  if (v.buy) {
    await launchHostBuy(ns, rooted, v)
    if (v.pid) ns.tprint(`seed: buying ${v.name} (${v.ram}GB): ${v.why}`)
  }
  lastLiteHost = v
  return v.buy && v.pid ? v.name : null
}

/**
 * Start `procs` (stopping the named scripts on home first) on fleet hosts:
 * the tightest host with the room, else the one whose seed workers, once
 * evicted, leave it. Returns ['script@host' | 'script: no host'].
 */
export async function moveOffHome(ns, rooted, stopNames, procs) {
  for (const s of stopNames) ns.scriptKill(s, 'home')
  if (stopNames.length) await ns.sleep(0)
  const out = []
  for (const p of procs) {
    if (!RELOCATABLE.includes(p.script)) continue
    // A raise-sized daemon needs its raised block, not its declared floor.
    const need = Math.max(ns.getScriptRam(p.script, 'home'), RAISED[p.script]?.gb ?? 0)
    const hosts = rooted.filter((h) => h !== 'home' && !isHacknetServerHost(h) && !ns.ps(h).some((q) => q.filename === GO))
    const free = (h) => ns.getServerMaxRam(h) - ns.getServerUsedRam(h)
    const evictable = (h) => ns.ps(h).filter((q) => EVICTABLE.includes(q.filename)).reduce((a, q) => a + ns.getScriptRam(q.filename, h) * q.threads, 0)
    let host = hosts.filter((h) => free(h) >= need).sort((a, b) => free(a) - free(b))[0] ?? null
    if (!host) {
      host = hosts.filter((h) => free(h) + evictable(h) >= need).sort((a, b) => free(a) + evictable(a) - (free(b) + evictable(b)))[0] ?? null
      if (host) {
        for (const w of EVICTABLE) ns.scriptKill(w, host)
        await ns.sleep(0)
      }
    }
    if (!host) {
      out.push(`${p.script}: no host`)
      continue
    }
    ns.scp(importClosure(ns, p.script), host, 'home')
    const pid = ns.exec(p.script, host, 1, ...(p.args ?? []))
    out.push(pid ? `${p.script}@${host}` : `${p.script}: exec refused on ${host}`)
  }
  return out
}

/** Every file a script imports, transitively (import lines read free, ns.read). */
function importClosure(ns, root) {
  const here = ns.getHostname()
  const out = new Set([root])
  const queue = [root]
  while (queue.length) {
    const f = queue.shift()
    let src = ns.read(f)
    if (!src && here !== 'home') {
      try {
        ns.scp(f, here, 'home')
      } catch {
        /* reported by the exec */
      }
      src = ns.read(f)
    }
    for (const m of String(src || '').matchAll(/from\s+['"]([^'"]+\.js)['"]/g)) {
      if (!out.has(m[1])) {
        out.add(m[1])
        queue.push(m[1])
      }
    }
  }
  return [...out]
}

/** Place stock.js on its own block when the trader verdict says so; returns the host (skip it for workers) or null. */
async function placeTrader(ns, all, hosts, liteHold = null) {
  const reset = ns.getResetInfo()
  // TIX from minute one where BitNode 8's feature is accessible (Prestige.ts:161-164).
  const tix = canAccessFeature(reset, 8)
  if (!tix) {
    lastTrader = { place: false, why: 'no TIX API access' }
    return null
  }
  for (const h of all) {
    if (ns.hasRootAccess(h) && ns.ps(h).some((p) => p.filename === TRADER)) {
      lastTrader = { place: true, host: h, running: true, why: 'running' }
      return h
    }
  }
  const traderGB = ns.getScriptRam(TRADER, 'home')
  const fleetGB = hosts.reduce((a, h) => a + ns.getServerMaxRam(h), 0)
  const here = ns.getHostname()
  if (here !== 'home') {
    try {
      ns.scp('/tel/status.txt', here, 'home')
    } catch {
      /* stale copy stays; its stamp decides */
    }
  }
  let income = null
  try {
    const st = JSON.parse(ns.read('/tel/status.txt') || 'null')
    if (st && Date.now() - Date.parse(st.at) < 5 * 60e3 && typeof st.incomePerSec === 'number') income = st.incomePerSec
  } catch {
    income = null
  }
  // No book yet: the trader is not running, so cash is the whole wealth.
  const wealth = ns.getServerMoneyAvailable('home')
  const target = ramUpgradeCost(ns.getServerMaxRam('home'), bitNodeMults(reset.currentNode)?.HomeComputerRamCost)
  const v = traderPlacement({ wealth, tix, incomePerSec: income, fleetGB, traderGB, target })
  lastTrader = { ...v, traderGB, fleetGB, incomePerSec: income, wealth: Math.round(wealth), target: Math.round(target) }
  if (!v.place) return null
  // The smallest rooted host that holds it (least farming displaced).
  const fits = hosts.filter((h) => ns.getServerMaxRam(h) - (liteHold?.host === h ? liteHold.gb : 0) >= traderGB).sort((a, b) => ns.getServerMaxRam(a) - ns.getServerMaxRam(b))
  const host = fits[0] ?? null
  if (!host) {
    lastTrader = { ...lastTrader, place: false, why: `${v.why} — but no rooted host has ${traderGB}GB` }
    return null
  }
  for (const p of ns.ps(host)) if (p.filename === EARLY || p.filename === CHEAP) ns.kill(p.pid)
  await ns.sleep(0)
  if (host !== 'home') ns.scp(importClosure(ns, TRADER), host, 'home')
  const pid = ns.exec(TRADER, host, 1)
  lastTrader = { ...lastTrader, host, pid, why: pid ? `placed on ${host}: ${v.why}` : `exec of ${TRADER} refused on ${host}` }
  return pid ? host : null
}
