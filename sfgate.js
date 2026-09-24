// Source-File and BitNode capability rules — pure, no ns calls, free to import.
//
// Every one of these is a rule the game implements in exactly one place, and
// every one of them has an "or you are currently INSIDE that BitNode" clause
// that is easy to forget. Forgetting it does not crash: the script simply never
// uses a capability it actually has, silently, in the one BitNode built around
// that capability. go.js did exactly this — `ownedSF.get(14) >= 2` misses
// `sf14 === 1 && bitNodeN === 14`, so the Go cheat would have stayed off for
// the whole of BitNode 14.
//
// Pass `ns.getResetInfo()` in. It costs the caller 1GB once and carries
// `ownedSF`, `currentNode`, `ownedAugs` and `bitNodeOptions`, which is what
// makes these rules answerable without a second, more expensive call.
//
// THREE SHAPES OF GATE LIVE HERE, and mixing them up is how the wrong rule gets
// written from memory:
//
//   1. canAccessBitNodeFeature(n) — "SF n at any level, OR inside BitNode n".
//      Most families. Note bladeburner takes TWO numbers, not one.
//   2. A LEVEL comparison — the stock API compares activeSourceFileLvl(8)
//      against 2 or 3 per function, so ">0" is not the rule there.
//   3. Not a Source-File at all — Stanek's API is gated on OWNING an
//      augmentation, and several families additionally honour a BitNode
//      option the player set on entry (disableGang / disableCorporation /
//      disableBladeburner / disableHacknetServer / disable4SData).
//
// Cited against game source so the next reader can check rather than trust:
//   canAccessBitNodeFeature   BitNode/BitNodeUtils.ts:17
//   singularity RAM ladder    Netscript/RamCostGenerator.ts:82-96
//   Go cheat access           Go/effects/netscriptGoImplementation.ts:487-496
//   home RAM on node entry    Prestige.ts:242-248
//   bladeburner API           NetscriptFunctions/Bladeburner.ts:35
//   sleeve API                NetscriptFunctions/Sleeve.ts:52
//   corporation               PersonObjects/Player/PlayerObjectCorporationMethods.ts:9
//   grafting                  PersonObjects/Player/PlayerObjectGeneralMethods.ts:577
//   stock Source-File levels   NetscriptFunctions/StockMarket.ts:46
//   hacknet servers           Hacknet/HacknetHelpers.tsx:35
//   Stanek's Gift API         NetscriptFunctions/Stanek.ts:18

// Whether Singularity is callable, published every 30s by watchdog.js (which
// already pays ns.getResetInfo's 1GB) so home residents that only need the
// yes/no — backdoor.js, torbuy.js — read it for 0GB instead of paying 1GB each
// at a 32GB home where the budget has no gigabyte to spare (B2.4b).
export const SF_FILE = '/tel/sf.txt'
const SF_FRESH_MS = 3 * 60 * 1000

/**
 * true only on a FRESH record saying so. Missing, stale or unreadable reads as
 * false — the caller then takes its no-Singularity route (the DOM/bridge one),
 * which is what it did before this existed. Freshness matters in one direction:
 * leaving BitNode 4 without SF4 turns a true into a false.
 */
export function singularityKnown(ns, now = Date.now()) {
  try {
    const r = JSON.parse(ns.read(SF_FILE) || 'null')
    return r?.singularity === true && now - Date.parse(r.at) < SF_FRESH_MS
  } catch {
    return false
  }
}

/** Level of Source-File `n`, 0 if not owned. */
export const sfLevel = (resetInfo, n) => resetInfo?.ownedSF?.get(n) ?? 0

/** Sum of every owned Source-File's level — the game's own `totalSFs`
 *  (CodingContract/ContractGenerator.ts:80), which caps contract difficulty. */
export const totalSfLevels = (resetInfo) => {
  const vals = resetInfo?.ownedSF?.values ? [...resetInfo.ownedSF.values()] : null
  if (!vals) return null
  return vals.reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0)
}

/**
 * The game's general capability rule (BitNodeUtils.ts:17):
 *   Player.bitNodeN === n || activeSourceFileLvl(n) > 0
 * Being inside BitNode n grants n's feature without the Source-File. This is
 * what makes BitNode 4 the place to build Singularity automation.
 */
export const canAccessFeature = (resetInfo, n) => resetInfo?.currentNode === n || sfLevel(resetInfo, n) > 0

/**
 * A BitNode option the player chose on entry, e.g. `disableGang`.
 *
 * These are NOT Source-File state and they are not visible anywhere else:
 * `bitNodeOptions` rides along on getResetInfo (NetscriptFunctions.ts:1444,
 * ResetInfo in ScriptEditor/NetscriptDefinitions.d.ts). A missing object is treated
 * as "nothing disabled", which matches the game's own defaults
 * (BitNodeUtils.ts:35-37).
 */
const optionOff = (resetInfo, key) => !resetInfo?.bitNodeOptions?.[key]

/** ns.singularity.* is callable at all. */
export const canUseSingularity = (resetInfo) => canAccessFeature(resetInfo, 4)

/**
 * What a Singularity call actually costs, as a multiple of its base price
 * (RamCostGenerator.ts:82-96). Inside BitNode 4 it is full price with no
 * Source-File at all; elsewhere SF4 level 1 is 16x, level 2 is 4x, level 3 is
 * 1x. A script that budgets RAM without this is wrong by up to 16x.
 */
export function singularityRamMultiplier(resetInfo) {
  if (resetInfo?.currentNode === 4) return 1
  const sf4 = sfLevel(resetInfo, 4)
  if (sf4 <= 1) return 16
  if (sf4 === 2) return 4
  return 1
}

/**
 * go.cheat.* access. NOT `sf14 >= 2` — the real rule
 * (netscriptGoImplementation.ts:488-489) is level > 1, OR level exactly 1 while
 * inside BitNode 14.
 */
export function canUseGoCheat(resetInfo) {
  const sf14 = sfLevel(resetInfo, 14)
  return sf14 > 1 || (sf14 === 1 && resetInfo?.currentNode === 14)
}

/**
 * Home RAM at the start of a BitNode (Prestige.ts:242-248). This is the floor
 * every bootstrap script has to fit inside, and it is NOT always 8:
 *   SF9 level 2+ -> 128GB,  SF1 any level -> 32GB,  otherwise -> 8GB.
 * A stack that only ever ran with SF1 has never been tested at 8GB.
 */
export function homeStartRam(resetInfo) {
  if (sfLevel(resetInfo, 9) >= 2) return 128
  if (sfLevel(resetInfo, 1) > 0) return 32
  return 8
}

/**
 * Hacknet nodes become hacknet SERVERS, with a different API and RAM.
 * Hacknet/HacknetHelpers.tsx:35 is `canAccessBitNodeFeature(9) &&
 * !Player.bitNodeOptions.disableHacknetServer` — the option arm was missing
 * here and would have had hash.js call ns.hacknet.hashCost in a node where the
 * player switched servers off.
 */
export const hasHacknetServers = (resetInfo) =>
  canAccessFeature(resetInfo, 9) && optionOff(resetInfo, 'disableHacknetServer')

/** Gang API (PersonObjects/Player/PlayerObjectGangMethods.ts:33 — the option arm is part of the rule). */
export const canUseGang = (resetInfo) => canAccessFeature(resetInfo, 2) && optionOff(resetInfo, 'disableGang')

/**
 * Bladeburner API — SF6 **OR SF7**, not SF6 alone.
 *
 * NetscriptFunctions/Bladeburner.ts:35 is
 *   const apiAccess = canAccessBitNodeFeature(7) || canAccessBitNodeFeature(6)
 * This file said `canAccessFeature(resetInfo, 6)` and was therefore wrong in
 * exactly the silent direction the header warns about: with SF7 and no SF6 —
 * the normal way to own the Bladeburner API, since BN7 is the Bladeburner
 * node — bladeburner.js would have been told it had no access while the game
 * would have answered every call.
 *
 * Note the option arm is NOT on the API gate: the API is readable in a node
 * with `disableBladeburner`, you simply cannot join the division
 * (NetscriptFunctions/Bladeburner.ts:331-335). `canJoinBladeburner` is the predicate for that.
 */
export const canUseBladeburner = (resetInfo) => canAccessFeature(resetInfo, 6) || canAccessFeature(resetInfo, 7)

/** Joining the division, which is the API gate PLUS the BitNode option (PersonObjects/Player/PlayerObjectBladeburnerMethods.ts:7). */
export const canJoinBladeburner = (resetInfo) => canUseBladeburner(resetInfo) && optionOff(resetInfo, 'disableBladeburner')

/** ns.sleeve.* (NetscriptFunctions/Sleeve.ts:52). */
export const canUseSleeve = (resetInfo) => canAccessFeature(resetInfo, 10)

/**
 * ns.corporation.* (PersonObjects/Player/PlayerObjectCorporationMethods.ts:9). Source-File 3, and
 * the BitNode option can take it away inside BN3 itself.
 */
export const canUseCorporation = (resetInfo) =>
  canAccessFeature(resetInfo, 3) && optionOff(resetInfo, 'disableCorporation')

/**
 * Grafting (ns.grafting.*) — Source-File **10**, the same one as sleeves, not a
 * gate of its own (PersonObjects/Player/PlayerObjectGeneralMethods.ts:577-579 is a bare
 * `canAccessBitNodeFeature(10)`).
 */
export const canUseGrafting = (resetInfo) => canAccessFeature(resetInfo, 10)

/**
 * The stock API's Source-File gate is a LEVEL comparison, not the usual
 * "owned at all" test (NetscriptFunctions/StockMarket.ts:46-53):
 *   Player.bitNodeN !== 8 && Player.activeSourceFileLvl(8) < level  ->  throw
 * so access is `inside BN8, OR SF8 at >= level`. Level 2 covers shorts
 * (buyShort/sellShort, :160,:170); level 3 covers orders (placeOrder,
 * cancelOrder, getOrders, :183,:195,:205).
 */
export const canUseStockSF = (resetInfo, level) => resetInfo?.currentNode === 8 || sfLevel(resetInfo, 8) >= level

/** Shorting stocks — SF8.2 (NetscriptFunctions/StockMarket.ts:160,170). */
export const canShortStock = (resetInfo) => canUseStockSF(resetInfo, 2)

/** Limit/stop orders and getOrders — SF8.3 (NetscriptFunctions/StockMarket.ts:183,195,205). */
export const canUseStockOrders = (resetInfo) => canUseStockSF(resetInfo, 3)

/**
 * 4S Market Data is a PURCHASE, not a Source-File: purchase4SMarketData and
 * purchase4SMarketDataTixApi check only `bitNodeOptions.disable4SData`
 * (NetscriptFunctions/StockMarket.ts:249,275). The reason to gate the call at all is that a node
 * with 4S disabled makes it a permanent no-op that still costs RAM.
 */
export const canBuy4SData = (resetInfo) => optionOff(resetInfo, 'disable4SData')

/**
 * ns.stanek.* is gated on OWNING the augmentation, not on Source-File 13
 * (NetscriptFunctions/Stanek.ts:18 —
 * `Player.hasAugmentation(AugmentationName.StaneksGift1, true)`).
 * canAccessBitNodeFeature(13) only controls whether the gift can be ACQUIRED,
 * so a phantom SF13 gate here would refuse the API in exactly the save that has
 * the gift installed and is outside BN13. `ownedAugs` on getResetInfo is the
 * installed set (NetscriptFunctions.ts:1444, `Player.augmentations`), which is
 * the same `true` ("installed only") sense the game's own check uses.
 */
export const STANEKS_GIFT = "Stanek's Gift - Genesis" // Augmentation/Enums.ts:126
export const hasStaneksGift = (resetInfo) => !!resetInfo?.ownedAugs?.has(STANEKS_GIFT)

/** ns.getBitNodeMultipliers() — lets a script read what it otherwise hardcodes. */
export const canReadBitNodeMultipliers = (resetInfo) => canAccessFeature(resetInfo, 5)

/** Intelligence exists as a stat and enters several formulas. */
export const hasIntelligence = (resetInfo) => canAccessFeature(resetInfo, 5)
