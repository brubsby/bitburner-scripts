// Converts surplus cash into RAM, autonomously.
//
// Split out of auto.js because ns.cloud.purchaseServer (2.25GB) and
// getServerNames (1.05GB) are expensive to carry in a fast loop.
//
//   run buyserv.js                  reserve enough for the next port opener
//   run buyserv.js --reserve 5e6    hoard more
//   run buyserv.js --reserve 0      spend everything
//   run buyserv.js --interval 60    check every minute
//
// ---------------------------------------------------------------------------
// Why this spends everything, every tick.
//
// getCloudServerCost is *linear* in BN1 — a flat $55,000/GB at every size, the
// softcap exponent max(0, log2(ram) - 6) being raised to CloudServerSoftcap = 1
// — and getCloudServerUpgradeCost is exactly the difference between two sizes.
// So buying 16GB now and doubling it to 32GB later costs precisely what buying
// 32GB later costs. There is no volume discount to wait for and no
// optimal-stopping problem: **waiting to afford a bigger server is never
// cheaper, it only delays the income.**
//
// The previous policy bought at most one server per 120s tick, the largest
// power of two the surplus afforded, above a standing $2m reserve. That left
// change stranded — with $3m in hand it bought 32GB for $1.76m and idled
// $1.24m — and left each purchase's income unearned for up to two minutes,
// compounding. Simulated over 60 minutes from a fresh BN1, spending the whole
// surplus promptly instead was worth 3.4x on its own: $150m of lifetime
// earnings became $516m, with no extra money spent, only spent sooner.
// See docs/optimizer-log.md section 3.
//
// The reserve survives in a narrower role. Without Source-File 4 there is no
// singularity API, so the TOR router, port-opening programs and home RAM are
// purchases only the player can make in the UI — and port openers are the best
// conversion of money into progress in the game, worth ~5.7x over the same
// hour, because each one unlocks whole servers at once. The reserve keeps the
// next one affordable and retires itself once that program is owned, instead
// of idling forever. Measured cost of holding it: 1-2% of earnings.
// ---------------------------------------------------------------------------

const SETTINGS = {
  // Port openers in price order (src/DarkWeb/DarkWebItems.ts). The reserve is
  // the price of the cheapest one not yet owned, so it shrinks to nothing as
  // the player buys them. relaySMTP ($5m) and beyond are deliberately absent:
  // the servers behind them need hacking level 300+, so reserving for one this
  // early would idle cash for an hour to buy RAM that cannot be rooted.
  programs: [
    { file: 'BruteSSH.exe', price: 500000 },
    { file: 'FTPCrack.exe', price: 1500000 },
  ],
  // Once every program above is owned, hold nothing back. Home RAM is a manual
  // purchase too, but at $126k/GB and rising against the cloud's flat $55k/GB
  // it is not worth hoarding for — buy it for what it enables (hack.js needs
  // 11.2GB resident, home cores multiply grow and weaken), not for threads.
  floorReserve: 0,
  interval: 15000,
  statusFile: '/tel/buyserv.txt',
  configFile: '/tel/buyserv-config.txt',
}

/** Price of the cheapest port opener not yet owned, or the floor. */
function reserveFor(ns) {
  for (const p of SETTINGS.programs) {
    if (!ns.fileExists(p.file, 'home')) return p.price
  }
  return SETTINGS.floorReserve
}

/**
 * An explicit --reserve is remembered on disk and reused if this restarts
 * without one.
 *
 * watchdog.js restarts a dead script with no arguments, so before this existed
 * a watchdog restart silently reverted the reserve to the default and the next
 * tick spent everything. That is not hypothetical: it cost $197.2m of
 * augmentation money in one tick, on a fleet where marginal RAM had already
 * turned negative. A supervisor whose policy evaporates when it is restarted is
 * worse than one that does not restart.
 */
function rememberedReserve(ns) {
  try {
    const raw = ns.read(SETTINGS.configFile)
    const value = Number(JSON.parse(raw || '{}').reserve)
    return Number.isFinite(value) && value >= 0 ? value : null
  } catch {
    return null
  }
}

function rememberReserve(ns, reserve) {
  ns.write(SETTINGS.configFile, JSON.stringify({ reserve, at: new Date().toISOString() }), 'w')
}

export async function main(ns) {
  const flags = ns.flags([
    ['reserve', -1],
    ['interval', SETTINGS.interval / 1000],
  ])
  const interval = flags.interval * 1000

  ns.disableLog('ALL')

  // An explicit flag wins and is remembered; otherwise reuse whatever was last
  // set explicitly, so a watchdog restart does not quietly drop the policy.
  let stickyReserve = null
  if (flags.reserve >= 0) {
    stickyReserve = flags.reserve
    rememberReserve(ns, stickyReserve)
  } else {
    stickyReserve = rememberedReserve(ns)
  }
  ns.print(`buyserv.js running — reserve ${stickyReserve === null ? 'auto' : '$' + stickyReserve}`)

  while (true) {
    const log = []

    try {
      const owned = ns.cloud.getServerNames()
      const limit = ns.cloud.getServerLimit()
      const maxRam = ns.cloud.getRamLimit()
      const reserve = stickyReserve !== null ? stickyReserve : reserveFor(ns)

      // Keep buying until the surplus can no longer afford the smallest useful
      // server. Each pass takes the largest affordable chunk, so the money goes
      // out in a few big pieces rather than a hundred tiny ones, but none of it
      // is left stranded until the next tick. The bound is a guard against a
      // pricing surprise turning this into an infinite loop, not a policy.
      for (let pass = 0; pass < 12; pass++) {
        const surplus = ns.getServerMoneyAvailable('home') - reserve
        if (surplus <= 0) break

        if (owned.length < limit) {
          let ram = 0
          for (let r = 8; r <= maxRam; r *= 2) {
            if (ns.cloud.getServerCost(r) <= surplus) ram = r
          }
          if (!ram) break
          const name = ns.cloud.purchaseServer(`pserv-${Date.now() % 100000}-${pass}`, ram)
          if (!name) break
          owned.push(name)
          log.push(`bought ${name} (${ram}GB)`)
          continue
        }

        // Fleet is full: raise the floor by doubling the smallest server. That
        // is the same $/GB as any other purchase, so it is not a compromise —
        // it is simply the only shape left once all 25 slots are taken.
        let smallest = null
        for (const host of owned) {
          const ram = ns.getServerMaxRam(host)
          if (!smallest || ram < smallest.ram) smallest = { host, ram }
        }
        if (!smallest || smallest.ram >= maxRam) break

        const next = smallest.ram * 2
        const cost = ns.cloud.getServerUpgradeCost(smallest.host, next)
        if (!(cost > 0) || cost > surplus) break
        if (!ns.cloud.upgradeServer(smallest.host, next)) break
        log.push(`upgraded ${smallest.host} to ${next}GB`)
      }

      const fleet = owned.map((h) => ({ host: h, ram: ns.getServerMaxRam(h) }))
      ns.write(
        SETTINGS.statusFile,
        JSON.stringify(
          {
            at: new Date().toISOString(),
            money: Math.round(ns.getServerMoneyAvailable('home')),
            reserve,
            owned: fleet.length,
            limit,
            fleetRam: fleet.reduce((a, s) => a + s.ram, 0),
            fleet,
            log,
          },
          null,
          2,
        ),
        'w',
      )
      // The daemon only mirrors /tel/* off home, so ship the status there when
      // this runs anywhere else — otherwise it is invisible outside the game.
      if (ns.getHostname() !== 'home') {
        ns.scp(SETTINGS.statusFile, 'home', ns.getHostname())
      }

      if (log.length) ns.print(log.join('; '))
    } catch (err) {
      ns.print(`error: ${err}`)
    }

    await ns.sleep(interval)
  }
}
