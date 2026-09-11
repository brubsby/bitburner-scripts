// Converts surplus cash into RAM, autonomously.
//
// Split out of auto.js because ns.cloud.purchaseServer (2.25GB) and
// getServerNames (1.05GB) are expensive to carry in a fast loop, and buying
// decisions only need revisiting every few minutes anyway.
//
//   run buyserv.js                  keep the default reserve
//   run buyserv.js --reserve 5e6    hoard more
//   run buyserv.js --interval 300   check every 5 minutes
//
// Buys the largest server the surplus affords, and once the fleet is full,
// upgrades the smallest server when that is affordable. Home RAM is a
// singularity call and cannot be bought here — it stays a manual purchase,
// which is why the reserve exists.

const SETTINGS = {
  // The home 8->16GB upgrade costs ~$1.01m and must be bought by hand. Don't
  // spend the player out of being able to make that jump.
  reserve: 2e6,
  interval: 120000,
  statusFile: '/tel/buyserv.txt',
}

export async function main(ns) {
  const flags = ns.flags([
    ['reserve', SETTINGS.reserve],
    ['interval', SETTINGS.interval / 1000],
  ])
  const reserve = flags.reserve
  const interval = flags.interval * 1000

  ns.disableLog('ALL')
  ns.print(`buyserv.js running — reserve $${reserve}`)

  while (true) {
    const log = []

    try {
      const owned = ns.cloud.getServerNames()
      const limit = ns.cloud.getServerLimit()
      const maxRam = ns.cloud.getRamLimit()
      const surplus = ns.getServerMoneyAvailable('home') - reserve

      if (surplus > 0) {
        if (owned.length < limit) {
          // Largest power of two we can afford.
          let ram = 0
          for (let r = 8; r <= maxRam; r *= 2) {
            if (ns.cloud.getServerCost(r) <= surplus) ram = r
          }
          if (ram > 0) {
            const name = ns.cloud.purchaseServer(`pserv-${Date.now() % 100000}`, ram)
            if (name) log.push(`bought ${name} (${ram}GB)`)
          }
        } else {
          // Fleet is full: raise the floor by upgrading the smallest server.
          let smallest = null
          for (const host of owned) {
            const ram = ns.getServerMaxRam(host)
            if (!smallest || ram < smallest.ram) smallest = { host, ram }
          }
          if (smallest && smallest.ram < maxRam) {
            const next = smallest.ram * 2
            const cost = ns.cloud.getServerUpgradeCost(smallest.host, next)
            if (cost > 0 && cost <= surplus && ns.cloud.upgradeServer(smallest.host, next)) {
              log.push(`upgraded ${smallest.host} to ${next}GB`)
            }
          }
        }
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
      // The daemon only mirrors /tel/* off home, so ship it there when this
      // is running anywhere else.
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
