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
  if (ns.getServerRequiredHackingLevel(host) > ns.getHackingLevel()) return false

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
function hackFractionAtMinSecurity(ns, host) {
  const minSecurity = ns.getServerMinSecurityLevel(host)
  if (minSecurity >= 100) return 0

  const hacking = ns.getHackingLevel()
  const required = ns.getServerRequiredHackingLevel(host)

  const difficultyMult = (100 - minSecurity) / 100
  const skillMult = (hacking - (required - 1)) / hacking
  return Math.min(1, Math.max(0, (difficultyMult * skillMult) / 240))
}

/** Rank targets by money per second once prepped to minimum security. */
function bestTarget(ns, hosts) {
  let best = null
  let bestRate = -1

  for (const host of hosts) {
    const maxMoney = ns.getServerMaxMoney(host)
    if (maxMoney <= 0) continue
    if (ns.getServerRequiredHackingLevel(host) > ns.getHackingLevel()) continue

    const fraction = hackFractionAtMinSecurity(ns, host)
    const time = ns.getHackTime(host)
    if (fraction <= 0 || !isFinite(time) || time <= 0) continue

    const rate = (maxMoney * fraction) / (time / 1000)
    if (rate > bestRate) {
      bestRate = rate
      best = host
    }
  }

  return { host: best, rate: bestRate }
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
  ns.print(`auto.js supervising — reserve $${SETTINGS.reserve}, buy servers: ${SETTINGS.buyServers}`)

  const workerRam = ns.getScriptRam(SETTINGS.worker, 'home')
  if (!workerRam) {
    ns.tprint(`ERROR: cannot read RAM of ${SETTINGS.worker} — is it on home?`)
    return
  }

  let cycle = 0

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

      // 2. Choose what to attack.
      const { host: target, rate } = bestTarget(ns, rooted)
      if (!target) {
        ns.print('no viable target yet')
        await ns.sleep(SETTINGS.interval)
        continue
      }

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
