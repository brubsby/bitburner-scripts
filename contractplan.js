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
