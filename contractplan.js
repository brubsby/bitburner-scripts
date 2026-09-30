// Coding contracts as a FORECAST. Pure, no ns calls.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// ctauto.js solves contracts and they were the biggest single realised income
// early in this run — $1.9b in one sweep against a batcher earning thousands
// per second. But nothing forecast them: contract money enters the planner
// only as realised cash, and it is NOT script income (ns.getTotalScriptIncome
// counts scripts; contracts credit the "codingcontract" money source), so the
// measured income every money leg divides by has never included them at all.
// With one contract every ~13 minutes a 5-minute measurement cannot see the
// stream anyway (docs/pricing-gaps.md §5).
//
// ---------------------------------------------------------------------------
// THE MODEL, from game source
//
// SPAWN  engine.tsx:204-207 — every 3000 cycles (600s) the engine calls
//        tryGeneratingRandomContract(3); each try succeeds with probability
//        100 / (399 + e^(0.0012 x pending))   (ContractGenerator.ts:~60)
//        which is 0.25 while the pending count is small. So the stream is
//        Poisson at 3 x p / 600 per second — 4.5/h with nothing pending.
//
// TYPE   getRandomProblemType(maxDif) draws UNIFORMLY over the contract types
//        whose difficulty <= 2 x (total Source-File levels) + 1
//        (ContractGenerator.ts:80-82, :173-176). DIFFICULTIES is the list of
//        every type's difficulty, parsed from source by [CP1].
//
// REWARD getRandomReward draws uniformly over {faction rep, faction rep all,
//        company rep} plus {money} when CodingContractMoney > 0
//        (ContractGenerator.ts:179-190). gainCodingContractReward
//        (PlayerObjectGeneralMethods.ts:502-566) then pays, with
//        adjustedScaling = rewardScaling / 3 and rewardScaling 1 for random
//        contracts (Contract.ts:18):
//          money        75e6 x difficulty x CodingContractMoney / 3
//          faction rep  2500 x difficulty / 3 to ONE joined hacking faction
//                       (or spread over all; or converted to MONEY when no
//                       hacking faction is joined)
//          company rep  4000 x difficulty / 3 to a held job, or, with no job,
//                       re-rolled as faction rep (single or all, 50/50)
//
// What comes out is an EXPECTATION per second: money, and faction reputation
// (spread thinly — it is reported, not scheduled). Both are small against a
// mid-run batcher and enormous against a fresh life's, which is exactly why a
// forecast and not a measurement is needed: the stream is the same size in
// both, and only the forecast knows that on the first pass of a new life.

const num = (x) => typeof x === 'number' && isFinite(x)

/** engine.tsx:205-206: three tries every 3000 cycles of 200ms. */
export const TRIES_PER_WINDOW = 3
export const WINDOW_SEC = 600

/** Constants.ts:91-93. Registered in tools/sim/bncheck.mjs (contract-money). */
export const BASE_MONEY_GAIN = 75e6
export const BASE_FACTION_REP_GAIN = 2500
export const BASE_COMPANY_REP_GAIN = 4000

/** Contract.ts:18 rewardScaling = 1, PlayerObjectGeneralMethods.ts:511 / 3. */
export const REWARD_SCALING = 1 / 3

/**
 * Every contract type's difficulty (CodingContract/contracts/*.ts). Thirty
 * types; [CP1] re-parses the source and fails on drift. Only the multiset
 * matters — the draw is uniform over the types under the cap.
 */
export const DIFFICULTIES = [1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 5, 5, 5, 6, 6, 7, 7, 8, 9, 10, 10, 10]

/** ContractGenerator.ts: the per-try success probability at `pending` contracts outstanding. */
export const spawnChance = (pending = 0) => 100 / (399 + Math.exp(0.0012 * Math.max(0, pending)))

/** Expected contracts per second. */
export const spawnPerSec = (pending = 0) => (TRIES_PER_WINDOW * spawnChance(pending)) / WINDOW_SEC

/** ContractGenerator.ts:80-82 — the difficulty cap from Source-File levels. */
export const maxDifficulty = (totalSourceFileLevels) => 2 * totalSourceFileLevels + 1

/** Mean difficulty of a uniform draw over the types under the cap; null if none qualify. */
export function expectedDifficulty(totalSourceFileLevels) {
  if (!num(totalSourceFileLevels) || totalSourceFileLevels < 0) return null
  const cap = maxDifficulty(totalSourceFileLevels)
  const pool = DIFFICULTIES.filter((d) => d <= cap)
  if (!pool.length) return null
  return pool.reduce((a, b) => a + b, 0) / pool.length
}

/**
 * Expected reward of ONE contract: `{ money, factionRep }`.
 *
 * `o`: `{ totalSourceFileLevels, nodeContractMoney, hasHackingFaction, hasJob }`.
 * Company reputation is valued at 0 here — it is real, but this file has no
 * price for it; it is reported as `companyRepShare` so the omission is visible.
 * Refuses (null) when any input is unreadable.
 */
export function expectedReward(o = {}) {
  const d = expectedDifficulty(o.totalSourceFileLevels)
  if (d === null) return null
  if (!num(o.nodeContractMoney) || o.nodeContractMoney < 0) return null
  if (typeof o.hasHackingFaction !== 'boolean' || typeof o.hasJob !== 'boolean') return null
  const moneyOffered = o.nodeContractMoney > 0
  const types = moneyOffered ? 4 : 3
  const p = 1 / types
  const moneyEach = BASE_MONEY_GAIN * d * o.nodeContractMoney * REWARD_SCALING
  const repEach = BASE_FACTION_REP_GAIN * d * REWARD_SCALING
  // Faction-rep draws (single and all) pay money instead when no hacking
  // faction is joined; a company-rep draw with no job re-rolls as faction rep.
  let pMoney = moneyOffered ? p : 0
  let pFaction = 2 * p
  let pCompany = p
  if (!o.hasJob) {
    pFaction += pCompany
    pCompany = 0
  }
  if (!o.hasHackingFaction) {
    pMoney += pFaction
    pFaction = 0
  }
  return {
    money: pMoney * moneyEach,
    factionRep: pFaction * repEach,
    companyRepShare: pCompany,
    meanDifficulty: d,
  }
}

/**
 * The factions a contract's reputation can reach: gainCodingContractReward
 * pays faction rep only to joined factions whose FactionInfo offers HACKING
 * work (PlayerObjectGeneralMethods.ts:515, :525 — `offerHackingWork`), one at
 * random or split evenly. The gang-only factions (Slum Snakes, Tetrads) and
 * the special ones are not among them. [CP3] re-parses FactionInfo.tsx.
 */
export const HACKING_WORK_FACTIONS = new Set([
  'Illuminati', 'Daedalus', 'The Covenant', 'ECorp', 'MegaCorp', 'Bachman & Associates', 'Blade Industries', 'NWO',
  'Clarke Incorporated', 'OmniTek Incorporated', 'Four Sigma', 'KuaiGong International', 'Fulcrum Secret Technologies',
  'BitRunners', 'The Black Hand', 'NiteSec', 'CyberSec', 'Aevum', 'Chongqing', 'Ishima', 'New Tokyo', 'Sector-12',
  'Volhaven', 'Speakers for the Dead', 'The Dark Army', 'The Syndicate', 'Silhouette', 'Netburners', 'Tian Di Hui',
])

/** How many of `factions` (joined faction names) a contract's reputation is shared over. */
export const contractFactionCount = (factions) => (Array.isArray(factions) ? factions.filter((f) => HACKING_WORK_FACTIONS.has(f)).length : null)

/**
 * THE FINAL WINDOW'S JOINS, WHERE ITS HASHES BUY THE EXIT FACTION'S
 * REPUTATION. In the life that ends with The Red Pill every hash after the
 * exit faction's join buys a generated contract, and a contract's
 * reputation is split over EVERY joined hacking-work faction (one at random
 * or evenly, gainCodingContractReward) — so each other hacking-work faction
 * joined in that life takes its share of the contracts off the rep leg, the
 * leg the work slot waits behind. What such a join buys in the final window:
 * augmentations for the terminal install's batch (not simulated by the exit;
 * the best, Neuralstimulator's hacking_exp x1.12 as an upper bound from the
 * window's start, loses to Daedalus alone: tools/sim/slotlevers.mjs lever 2b),
 * Go favor only for a faction played (the exit faction), nothing else the
 * exit prices. So in the final window, while the contracts pay the exit
 * faction (`contractsOn`), a hacking-work faction other than the exit
 * faction is not joined. Anywhere else a join is decided as before.
 * Factions reset at every install (prestigeAugmentation), so the policy
 * holds k at the exit faction alone for a final window that starts fresh.
 * Returns {join: true} or {join: false, why}.
 */
export function finalWindowJoinOf(faction, { finalWindow = false, contractsOn = false, exitFaction = 'Daedalus' } = {}) {
  if (finalWindow !== true || contractsOn !== true) return { join: true }
  if (faction === exitFaction || !HACKING_WORK_FACTIONS.has(faction)) return { join: true }
  return { join: false, why: `${faction}: not joined in the final window — it would take a share of every generated contract's reputation from the ${exitFaction} leg (hacking-work factions split it), and nothing it sells reaches the exit` }
}

/**
 * The contract share count k the final window will have: when the final
 * window is now, the hacking-work factions joined (and the exit faction when
 * it is not yet); a final window after an install starts with no faction
 * joined and, under finalWindowJoinOf, joins the exit faction alone: 1.
 */
export function finalWindowContractFactions(joined, { finalWindowNow = false, exitFaction = 'Daedalus' } = {}) {
  if (finalWindowNow !== true) return 1
  const k = contractFactionCount(joined)
  if (k === null) return null
  return k + (joined.includes(exitFaction) ? 0 : 1)
}

/**
 * GENERATED CONTRACTS FROM HASHES (Hacknet "Generate Coding Contract",
 * HashUpgradesMetadata.tsx: costPerLevel 25; HashUpgrade.getCost: the k-th
 * purchase of a life costs 25 x k, the level resetting at every install,
 * HashManager.prestige). How many contracts `hashes` buys from upgrade level
 * `level0`, as a CONTINUOUS count (the expectation a smooth trajectory
 * integrates): the largest n with 25 x (n(n+1)/2 + level0 x n) <= hashes.
 */
export function contractsForHashes(hashes, level0 = 0, costPerLevel = 25) {
  if (!num(hashes) || hashes <= 0 || !num(level0) || level0 < 0 || !num(costPerLevel) || costPerLevel <= 0) return 0
  const b = 2 * level0 + 1
  return (-b + Math.sqrt(b * b + (8 * hashes) / costPerLevel)) / 2
}

/**
 * The stream, per second: `{ perSec, moneyPerSec, factionRepPerSec, reward }`.
 * `pending` is how many contracts are outstanding (unsolved on the network) —
 * with ctauto.js running it is ~0 and the spawn chance sits at its maximum.
 */
export function contractIncome(o = {}) {
  const reward = expectedReward(o)
  if (!reward) return null
  const perSec = spawnPerSec(num(o.pending) ? o.pending : 0)
  return {
    perSec,
    perHour: perSec * 3600,
    moneyPerSec: perSec * reward.money,
    factionRepPerSec: perSec * reward.factionRep,
    reward,
  }
}
