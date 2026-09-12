// Telemetry reporter. Walks the network, snapshots what is running and how
// every rooted server is doing, and drops the result at /tel/status.txt on
// home where the external daemon mirrors it out to disk.
//
// Runs anywhere with ~4GB free — put it on a rooted server so it doesn't eat
// home RAM that could be hacking.
//
//   run tel.js            (5s interval, default)
//   run tel.js 15         (15s interval)

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
  const interval = (ns.args[0] || 5) * 1000

  ns.disableLog('ALL')

  while (true) {
    const hosts = scanAll(ns)
    const servers = []
    const processes = []

    for (const host of hosts) {
      const rooted = ns.hasRootAccess(host)
      const maxRam = ns.getServerMaxRam(host)

      for (const p of ns.ps(host)) {
        processes.push({ host, script: p.filename, threads: p.threads, args: p.args, pid: p.pid })
      }

      if (!rooted && !host.startsWith('pserv-')) continue

      const maxMoney = ns.getServerMaxMoney(host)
      servers.push({
        host,
        maxRam,
        usedRam: Math.round(ns.getServerUsedRam(host) * 100) / 100,
        money: Math.round(ns.getServerMoneyAvailable(host)),
        maxMoney,
        moneyPct: maxMoney ? Math.round((ns.getServerMoneyAvailable(host) / maxMoney) * 1000) / 10 : 0,
        security: Math.round(ns.getServerSecurityLevel(host) * 100) / 100,
        minSecurity: ns.getServerMinSecurityLevel(host),
        hackLevel: ns.getServerRequiredHackingLevel(host),
      })
    }

    const player = ns.getPlayer()
    const report = {
      at: new Date().toISOString(),
      hackingLevel: player.skills.hacking,
      money: Math.round(player.money),
      // [1] is money earned per second since the last augmentation install.
      // [0] sums the rate over *live* scripts, which reads exactly zero under a
      // batcher however much it earns: its h/g/w workers are one-shot and
      // credit themselves only in the instant before they exit. Confirmed live
      // at hacking 246 with 41,763 threads dispatched and [0] reporting 0.
      // This is the first number anyone looks at, so it being structurally
      // dead was worse than it being absent.
      incomePerSec: Math.round(ns.getTotalScriptIncome()[1] * 100) / 100,
      expPerSec: Math.round(ns.getTotalScriptExpGain() * 100) / 100,
      reachable: hosts.length,
      rooted: servers.length,
      processes,
      servers: servers.sort((a, b) => b.maxMoney - a.maxMoney),
    }

    ns.write('/tel/status.txt', JSON.stringify(report, null, 2), 'w')

    if (ns.getHostname() !== 'home') {
      ns.scp('/tel/status.txt', 'home', ns.getHostname())
    }

    await ns.sleep(interval)
  }
}
