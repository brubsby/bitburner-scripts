// Buys hacknet capacity until the Netburners invitation requirements are met,
// then stops.
//
//   run hacknet.js
//
// Netburners wants hacking 80, 100 total hacknet levels, 8 total RAM and 4
// total cores (`src/Faction/FactionInfo.tsx`, inviteReqs). That is one more
// faction, and factions are the binding constraint on leaving this BitNode:
// Daedalus needs 30 *distinct* augmentations and a faction is the only place
// to buy them.
//
// Worth knowing why this is a script and TOR is not: the hacknet API needs no
// Source-File, so unlocking Netburners is free to automate, while buying the
// TOR router is gated behind ns.singularity and stays manual. Prefer unlocks
// that a script can reach on its own.
//
// Hacknet nodes are a poor *income* investment in BN1 — a fully upgraded node
// yields a rounding error against the batcher — so this buys the cheapest
// upgrade that moves a requirement and stops the moment all three are met.
// It is not trying to build a hacknet, it is buying an invitation.

const NEED = { levels: 100, ram: 8, cores: 4 }
const STATUS = '/tel/hacknet.txt'

function totals(ns) {
  const n = ns.hacknet.numNodes()
  let levels = 0, ram = 0, cores = 0
  for (let i = 0; i < n; i++) {
    const s = ns.hacknet.getNodeStats(i)
    levels += s.level
    ram += s.ram
    cores += s.cores
  }
  return { nodes: n, levels, ram, cores }
}

export async function main(ns) {
  ns.disableLog('ALL')

  while (true) {
    try {
      const t = totals(ns)
      const done = t.levels >= NEED.levels && t.ram >= NEED.ram && t.cores >= NEED.cores

      ns.write(STATUS, JSON.stringify({ at: new Date().toISOString(), ...t, need: NEED, done }, null, 2), 'w')

      if (done) {
        ns.tprint(`hacknet: Netburners requirements met (${t.levels} levels, ${t.ram} RAM, ${t.cores} cores) — accept the invite when it arrives`)
        return
      }

      const money = ns.getServerMoneyAvailable('home')

      // A new node contributes 1 level, 1 RAM and 1 core at once, so while any
      // requirement is far off it is usually the cheapest way to move all three.
      if (t.nodes < 8 && ns.hacknet.getPurchaseNodeCost() < money / 10) {
        ns.hacknet.purchaseNode()
        await ns.sleep(100)
        continue
      }

      // Otherwise buy whichever single upgrade is still short, cheapest first.
      let bought = false
      for (let i = 0; i < t.nodes; i++) {
        if (t.levels < NEED.levels && ns.hacknet.getLevelUpgradeCost(i, 10) < money / 10) {
          ns.hacknet.upgradeLevel(i, 10)
          bought = true
          break
        }
        if (t.ram < NEED.ram && ns.hacknet.getRamUpgradeCost(i, 1) < money / 10) {
          ns.hacknet.upgradeRam(i, 1)
          bought = true
          break
        }
        if (t.cores < NEED.cores && ns.hacknet.getCoreUpgradeCost(i, 1) < money / 10) {
          ns.hacknet.upgradeCore(i, 1)
          bought = true
          break
        }
      }

      await ns.sleep(bought ? 100 : 10000)
    } catch (err) {
      ns.print(`hacknet error: ${err}`)
      await ns.sleep(10000)
    }
  }
}
