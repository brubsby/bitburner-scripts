// Minimal single-target HGW loop for the opening of a run, when home RAM is
// too small to hold hack.js (10GB+). Prep to min security / max money, then
// hack. Grows into hack.js once home has the headroom.
//
//   run early.js n00dles -t 3

export async function main(ns) {
  const target = ns.args[0] || 'n00dles'
  const moneyThresh = ns.getServerMaxMoney(target) * 0.75
  const securityThresh = ns.getServerMinSecurityLevel(target) + 5

  ns.disableLog('ALL')

  while (true) {
    if (ns.getServerSecurityLevel(target) > securityThresh) {
      await ns.weaken(target)
    } else if (ns.getServerMoneyAvailable(target) < moneyThresh) {
      await ns.grow(target)
    } else {
      await ns.hack(target)
    }
  }
}
