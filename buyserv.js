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
  // they are bought.
  //
  // relaySMTP and beyond used to be omitted here on the grounds that the
  // servers behind them need hacking level 300+. That is true of *hacking*
  // them and false of *rooting* them — ns.nuke tests open ports alone
  // (src/NetscriptFunctions.ts:504-520) — and rooting is what buys RAM. The
  // servers are usable as worker capacity at any level, so a port opener is
  // the cheapest RAM in the game: relaySMTP unlocked 688GB for $5m on this
  // save, about $7.3k/GB against the cloud's flat $55k/GB.
  programs: [
    { file: 'BruteSSH.exe', price: 500000 },
    { file: 'FTPCrack.exe', price: 1500000 },
    { file: 'relaySMTP.exe', price: 5000000 },
    { file: 'HTTPWorm.exe', price: 30000000 },
    { file: 'SQLInject.exe', price: 250000000 },
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
 * How much cash to hold back.
 *
 * This used to be an explicit figure remembered on disk, which was wrong in a
 * way that only showed up after an augmentation install: the file survives the
 * install, so a reserve set to park spending in a rich life came back in a
 * life that owned nothing and needed to rebuild, and quietly held everything
 * back. A watchdog restarting the script with the old hardcoded argument had
 * the same effect from the other direction.
 *
 * So nothing is remembered. The reserve is derived from the game state every
 * tick and is therefore always right for the life it is in: hold back exactly
 * enough for the cheapest port opener not yet owned, because those are
 * singularity-gated purchases only a human can make and each one unlocks a
 * whole tier of servers to root. Once they are all owned there is nothing left
 * to save for and it drops to zero.
 */
function reserveNow(ns) {
  for (const p of SETTINGS.programs) {
    if (!ns.fileExists(p.file, 'home')) return p.price
  }
  return 0
}

export async function main(ns) {
  const flags = ns.flags([
    ['reserve', -1],
    ['interval', SETTINGS.interval / 1000],
  ])
  const interval = flags.interval * 1000

  ns.disableLog('ALL')

  ns.print(`buyserv.js running — reserve ${flags.reserve >= 0 ? '$' + flags.reserve : 'auto'}`)

  while (true) {
    const log = []

    try {
      const owned = ns.cloud.getServerNames()
      const limit = ns.cloud.getServerLimit()
      const maxRam = ns.cloud.getRamLimit()
      const reserve = flags.reserve >= 0 ? flags.reserve : reserveNow(ns)

      // ----------------------------------------------------------------
      // Concentrate, do not level.
      //
      // Cloud RAM costs a flat $55k/GB at every size in BN1 and an upgrade
      // costs exactly the difference, so *total* RAM for a given spend is the
      // same however it is distributed. Placement is not: a batch has to fit
      // on one host, so 25 small servers and one big server holding the same
      // total RAM are not interchangeable — the small fleet fragments and the
      // batcher reports placement failures while RAM sits free.
      //
      // The old policy upgraded the *smallest* server each tick, which keeps
      // the fleet level and is exactly the wrong shape. This upgrades the
      // largest one that is not yet at the cap, so RAM piles into the biggest
      // contiguous blocks the game allows, and only buys a new server when
      // every existing one is maxed.
      // ----------------------------------------------------------------
      for (let pass = 0; pass < 12; pass++) {
        const surplus = ns.getServerMoneyAvailable('home') - reserve
        if (surplus <= 0) break

        // Biggest server we own that still has room to grow.
        let grow = null
        for (const host of owned) {
          const ram = ns.getServerMaxRam(host)
          if (ram >= maxRam) continue
          if (!grow || ram > grow.ram) grow = { host, ram }
        }

        if (grow) {
          // Largest affordable doubling, not just one step — fewer, bigger
          // jumps beat many small ones for the same money.
          let next = 0
          for (let r = grow.ram * 2; r <= maxRam; r *= 2) {
            if (ns.cloud.getServerUpgradeCost(grow.host, r) <= surplus) next = r
          }
          if (next) {
            if (!ns.cloud.upgradeServer(grow.host, next)) break
            log.push(`upgraded ${grow.host} ${grow.ram} -> ${next}GB`)
            continue
          }
        }

        // Nothing upgradable within budget: add a server if there is a slot.
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
        break
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
