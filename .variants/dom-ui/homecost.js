// What the next home upgrade costs — pure arithmetic, no ns calls, no DOM.
//
// Home RAM and cores are the only purchases that survive an install, so
// "can we afford the next one yet?" is a question both homeup.js and
// watchdog.js need to answer constantly. Answering it by *walking to Alpha
// Enterprises and reading the buttons* is what made homeup take over the
// screen every 30 seconds: the trip is the expensive part, and it was being
// made to discover a number that is a closed-form function of state we
// already have.
//
// Worse, the button-reading answer is wrong in the one case that matters.
// `RamButton.tsx:49` renders `disabled={!Player.canAfford(cost) || reachMaxRam}`
// and `CoresButton.tsx:18` does the same, so a button we cannot afford is
// indistinguishable from one that is capped — and homeup, which skipped
// disabled buttons when collecting prices, published `nextCost: null`
// ("everything maxed") while sitting at 7 cores with an affordable-in-an-hour
// upgrade in front of it.
//
// Formulas are the game's own:
//   getUpgradeHomeRamCost   PersonObjects/Player/PlayerObjectServerMethods.ts:30
//     ram * 32000 * 1.58^log2(ram) * HomeComputerRamCost
//   getUpgradeHomeCoresCost PersonObjects/Player/PlayerObjectServerMethods.ts:42
//     1e9 * 7.5^cores
// Caps: ServerConstants.HomeComputerMaxRam = 2^30 (Server/data/Constants.ts:6),
// cores at 8 (CoresButton.tsx:18).
//
// The RAM cost carries BitNodeMultipliers.HomeComputerRamCost, which is 1 in
// BN1 and is NOT read here — reading it in-game costs RAM in every script that
// imports this. Registered in tools/sim/bncheck.mjs as `home-ram-cost`.

export const MAX_HOME_RAM = 1073741824 // 2^30
export const MAX_HOME_CORES = 8

export const ramUpgradeCost = (ram) => ram * 32000 * Math.pow(1.58, Math.log2(ram))
export const coreUpgradeCost = (cores) => 1e9 * Math.pow(7.5, cores)

/**
 * The cheapest upgrade still available, or null when home is fully maxed.
 *
 * Cores first while they are cheap: they multiply grow/weaken effectiveness on
 * every op home executes (1 + (cores-1)/16, ServerHelpers.ts:315) and cap at 8,
 * whereas RAM doublings escalate by 1.58x forever. This returns the cheapest
 * rather than a fixed preference so the caller's "can I afford anything?" test
 * is exact.
 */
export function nextHomeUpgrade(ram, cores) {
  const options = []
  if (cores < MAX_HOME_CORES) options.push({ kind: 'cores', cost: coreUpgradeCost(cores) })
  if (ram < MAX_HOME_RAM) options.push({ kind: 'RAM', cost: ramUpgradeCost(ram) })
  if (!options.length) return null
  return options.reduce((a, b) => (b.cost < a.cost ? b : a))
}
