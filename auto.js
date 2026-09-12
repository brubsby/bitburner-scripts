// Autonomous supervisor. Runs the hacking loop with nobody watching: roots
// what it can reach, picks the best target as the hacking level rises, and
// keeps every rooted server's RAM busy.
//
// This exists so the game keeps making progress when no agent is driving the
// UI. It is expected to run unattended for hours, so every game call that can
// fail is guarded and the loop never throws.
//
//   run auto.js
//   run auto.js --interval 60
//
// Buying servers lives in buyserv.js instead — purchaseServer and
// getServerNames alone cost 3.3GB, which is a lot to carry in a loop that
// wants to run on a small box. Run both.
//
// Singularity is unavailable without Source-File 4, so this cannot buy the TOR
// router, port-opening programs, or home RAM. Those stay manual; the
// supervisor picks up the new capability once they exist.

const SETTINGS = {
  worker: 'early.js',
  interval: 20000,
  // Leave home a little headroom for manual commands and one-off scripts.
  homeReserveRam: 2,
  statusFile: '/tel/auto.txt',
  // A new target must beat the current one by this much to be worth switching
  // to. See the comment on shouldSwitch below — without a margin the fleet
  // never earns anything at all.
  switchMargin: 1.5,
}

const PORT_PROGRAMS = [
  { file: 'BruteSSH.exe', fn: 'brutessh' },
  { file: 'FTPCrack.exe', fn: 'ftpcrack' },
  { file: 'relaySMTP.exe', fn: 'relaysmtp' },
  { file: 'HTTPWorm.exe', fn: 'httpworm' },
  { file: 'SQLInject.exe', fn: 'sqlinject' },
]

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

/** Open what ports we have programs for, then nuke. Returns true if we now have root. */
function tryRoot(ns, host) {
  if (ns.hasRootAccess(host)) return true
  // No hacking-level check: rooting is gated on open ports alone (ns.nuke,
  // src/NetscriptFunctions.ts:504-520). Only *hacking* a server is level-gated,
  // and that test belongs in rateOf, where it already is. Testing it here
  // refused RAM we were entitled to.

  let opened = 0
  for (const { file, fn } of PORT_PROGRAMS) {
    if (!ns.fileExists(file, 'home')) continue
    try {
      ns[fn](host)
      opened++
    } catch {
      // Already open, or the program cannot apply here.
    }
  }

  if (opened < ns.getServerNumPortsRequired(host)) return false

  try {
    ns.nuke(host)
    return ns.hasRootAccess(host)
  } catch {
    return false
  }
}

/**
 * Fraction of a server's money one hack thread takes, at minimum security.
 *
 * This is calculatePercentMoneyHacked from src/Hacking.ts, inlined. ns.hack-
 * Analyze would give the same shape but costs 1GB and evaluates at *current*
 * security — we want the rate the server sustains once prepped, since that is
 * the state we intend to keep it in.
 */
function hackFractionAtMinSecurity(ns, host, minSecurity) {
  if (minSecurity >= 100) return 0

  const hacking = ns.getHackingLevel()
  const required = ns.getServerRequiredHackingLevel(host)

  const difficultyMult = (100 - minSecurity) / 100
  const skillMult = (hacking - (required - 1)) / hacking
  return Math.min(1, Math.max(0, (difficultyMult * skillMult) / 240))
}

/**
 * Chance a hack lands, at minimum security. calculateHackingChance from
 * src/Hacking.ts, inlined — a failed hack returns nothing, and for a server
 * freshly in reach the chance is well under half. Those are exactly the
 * servers a level-driven retarget keeps picking.
 */
function hackChanceAtMinSecurity(ns, host, minSecurity) {
  if (minSecurity >= 100) return 0
  const skillMult = Math.max(1.75 * ns.getHackingLevel(), 1)
  const skillChance = (skillMult - ns.getServerRequiredHackingLevel(host)) / skillMult
  return Math.min(1, Math.max(0, skillChance * ((100 - minSecurity) / 100)))
}

/**
 * Rank targets by money per RAM-second of a full prep-and-hack cycle, at
 * minimum security and in the limit of a small hack fraction:
 *
 *   score = chance * M / ( T * (1.98/phi + 6.16/k) )
 *
 *   phi   fraction one hack thread takes        (inlined above)
 *   k     per-thread growth log constant        (calculateServerGrowthLog)
 *   1.98  1.7GB per hack thread held 1*T, plus the weaken threads it forces
 *   6.16  1.75GB per grow thread held 3.2*T, plus the weaken threads it forces
 *
 * This used to be M*phi/T, which prices the hack threads and ignores the cost
 * of putting the money back. That parked the fleet on foodnstuff
 * (serverGrowth 5) and sigma-cosmetics (10) — the two slowest-regrowing money
 * servers on the network — for the whole early game. Simulated over 60 minutes
 * at the RAM this save has, the correction is worth ~3.8x on its own; see
 * docs/optimizer-log.md section 6 and docs/prior-art.md section 5.
 *
 * The uniform factors in k (player hacking_grow multiplier, the BitNode
 * ServerGrowthRate) are both exactly 1 in BN1 with no augmentations. They do
 * not cancel out of the ranking, so revisit this after the first install.
 */
function rateOf(ns, host) {
  const maxMoney = ns.getServerMaxMoney(host)
  if (maxMoney <= 0) return 0
  if (ns.getServerRequiredHackingLevel(host) > ns.getHackingLevel()) return 0

  const minSecurity = ns.getServerMinSecurityLevel(host)
  const phi = hackFractionAtMinSecurity(ns, host, minSecurity)
  const time = ns.getHackTime(host)
  if (phi <= 0 || !isFinite(time) || time <= 0) return 0

  // calculateServerGrowthLog(server, 1, player) from src/Server/formulas/grow.ts.
  const growth = ns.getServerGrowth(host)
  const adjGrowthLog = Math.min(Math.log1p(0.03 / minSecurity), 0.00349388925425578)
  const k = adjGrowthLog * (growth / 100)
  if (!(k > 0)) return 0

  const chance = hackChanceAtMinSecurity(ns, host, minSecurity)
  const ramSeconds = (time / 1000) * (1.98 / phi + 6.16 / k)
  return (chance * maxMoney) / ramSeconds
}

function bestTarget(ns, hosts) {
  let best = null
  let bestRate = -1

  for (const host of hosts) {
    const rate = rateOf(ns, host)
    if (rate > bestRate) {
      bestRate = rate
      best = host
    }
  }

  return { host: best, rate: bestRate }
}

/**
 * Whether to abandon the current target for a better-scoring one.
 *
 * Switching is not free: deploy() kills every worker pointed at the old target,
 * and an operation killed in flight is wasted entirely — no money, no
 * experience, nothing. Grow is 3.2x hack time and weaken 4x, which on a
 * mid-level server is minutes.
 *
 * The ranking depends on hacking level, and under a large fleet the level
 * rises every 20-30 seconds. So a supervisor that simply takes the best target
 * every cycle re-preps forever: money never reaches the floor where the worker
 * starts hacking, and the fleet earns exactly nothing while still gaining
 * experience. That is not hypothetical — it is what this script did for over
 * two hours, with 2.3TB fully utilised and player money frozen to the dollar.
 *
 * Two guards. A candidate must beat the incumbent by a clear margin, not merely
 * tie; and having switched, we hold for one weaken time — the longest operation
 * in flight — so whatever is already running can land.
 */
function shouldSwitch(ns, current, candidate, candidateRate, currentRate, heldForMs) {
  if (!current) return true
  if (candidate === current) return false

  // The incumbent stopped being usable at all.
  if (!ns.hasRootAccess(current) || ns.getServerRequiredHackingLevel(current) > ns.getHackingLevel()) return true

  if (heldForMs < 4 * ns.getHackTime(current)) return false
  return candidateRate > currentRate * SETTINGS.switchMargin
}

function usableRam(ns, host) {
  const max = ns.getServerMaxRam(host)
  const used = ns.getServerUsedRam(host)
  const reserve = host === 'home' ? SETTINGS.homeReserveRam : 0
  return Math.max(0, max - used - reserve)
}

/**
 * Point a host's workers at `target`. Existing workers already on the right
 * target are left alone — restarting them would throw away in-flight
 * operations, which on a slow server is minutes of progress.
 */
function deploy(ns, host, target, workerRam) {
  const running = ns.ps(host).filter((p) => p.filename === SETTINGS.worker)
  const onTarget = running.filter((p) => p.args[0] === target)
  const offTarget = running.filter((p) => p.args[0] !== target)

  for (const p of offTarget) ns.kill(p.pid)

  // Only top up if there is room for a meaningful number of new threads.
  const threads = Math.floor(usableRam(ns, host) / workerRam)
  if (threads < 1) return 0

  if (host !== 'home' && !ns.fileExists(SETTINGS.worker, host)) {
    if (!ns.scp(SETTINGS.worker, host, 'home')) return 0
  }

  const pid = ns.exec(SETTINGS.worker, host, threads, target)
  return pid ? threads : 0
}

export async function main(ns) {
  const flags = ns.flags([['interval', SETTINGS.interval / 1000]])
  SETTINGS.interval = flags.interval * 1000

  ns.disableLog('ALL')
  ns.print(`auto.js supervising — worker ${SETTINGS.worker}, every ${SETTINGS.interval / 1000}s`)

  const workerRam = ns.getScriptRam(SETTINGS.worker, 'home')
  if (!workerRam) {
    ns.tprint(`ERROR: cannot read RAM of ${SETTINGS.worker} — is it on home?`)
    return
  }

  let cycle = 0
  let target = null
  let targetSince = 0

  while (true) {
    cycle++
    const log = []

    try {
      const all = scanAll(ns)

      // 1. Root everything now in reach.
      let newlyRooted = 0
      for (const host of all) {
        if (ns.hasRootAccess(host)) continue
        if (tryRoot(ns, host)) {
          newlyRooted++
          log.push(`rooted ${host}`)
        }
      }

      const rooted = all.filter((h) => ns.hasRootAccess(h))

      // 2. Choose what to attack, but stay put unless the change earns its
      //    cost — see shouldSwitch.
      const { host: candidate, rate: candidateRate } = bestTarget(ns, rooted)
      if (!candidate) {
        ns.print('no viable target yet')
        await ns.sleep(SETTINGS.interval)
        continue
      }

      const currentRate = target ? rateOf(ns, target) : 0
      if (shouldSwitch(ns, target, candidate, candidateRate, currentRate, Date.now() - targetSince)) {
        if (target) log.push(`retarget ${target} -> ${candidate}`)
        target = candidate
        targetSince = Date.now()
      }
      const rate = target === candidate ? candidateRate : currentRate

      // 3. Keep every scrap of rooted RAM working on it.
      let threadsStarted = 0
      const hosts = rooted.filter((h) => ns.getServerMaxRam(h) > 0)
      for (const host of hosts) {
        threadsStarted += deploy(ns, host, target, workerRam)
      }

      const totalRam = hosts.reduce((a, h) => a + ns.getServerMaxRam(h), 0)
      const usedRam = hosts.reduce((a, h) => a + ns.getServerUsedRam(h), 0)

      const status = {
        at: new Date().toISOString(),
        cycle,
        hackingLevel: ns.getHackingLevel(),
        money: Math.round(ns.getServerMoneyAvailable('home')),
        incomePerSec: Math.round(ns.getTotalScriptIncome()[0] * 100) / 100,
        target,
        targetRatePerSec: Math.round(rate),
        rooted: rooted.length,
        reachable: all.length,
        newlyRooted,
        threadsStarted,
        ramUsed: Math.round(usedRam),
        ramTotal: totalRam,
        log,
      }

      ns.write(SETTINGS.statusFile, JSON.stringify(status, null, 2), 'w')
      if (log.length) ns.print(log.join('; '))
      ns.print(`target ${target} | ${rooted.length} rooted | ${Math.round(usedRam)}/${totalRam}GB`)
    } catch (err) {
      // Never die. A bad cycle is recoverable; a dead supervisor is not.
      ns.print(`cycle ${cycle} error: ${err}`)
    }

    await ns.sleep(SETTINGS.interval)
  }
}
