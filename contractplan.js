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
//        (PlayerObjectGeneralMethods.ts:501-566) pays at
//        adjustedScaling = rewardScaling / 3 (rewardScaling 1 for random and
//        hash-bought contracts, Contract.ts) — AND EVERY RE-ROUTE RECURSES WITH
//        adjustedScaling AS THE NEW rewardScaling, so it divides by 3 again:
//          money                         75e6 x d x CodingContractMoney / 3
//          faction rep (hacking faction) 2500 x d / 3, ONE joined hacking-work
//                                        faction at random
//          faction rep ALL               floor(2500 x d / 3 / k) to EACH of the k
//          either, no hacking faction    -> money at / 9
//          company rep (a job held)      4000 x d / 3
//          company rep, no job           -> faction rep single/all 50/50 at / 9,
//                                        and with no hacking faction either
//                                        -> money at / 27
//        The live sweep of 2026-09-18 (BN5, SF1.2+SF4.1, nothing joined, no
//        job: 49 rewards, all money) shows all three tiers — $2.778m is
//        75e6/27 at difficulty 1, $8.333m is 75e6/9 — and [CP4] fits it.
//        This file paid every route at / 3 until 2026-10-02.
//
// SOLVED, NOT SPAWNED: a contract pays only when ctauto.js solves it, and
// only the types ctsolvers.js has a solver for (SOLVER_TYPES, read from its
// table). While no solver runs the stream accrues as a BACKLOG on the
// network (contractStream: count and expected value), which pays when one
// next runs — or is lost at an install, which deletes every non-home server
// (prestigeAllServers) and the contracts on them.
//
// THE DISTRIBUTION: the reward is a mixture (route x difficulty) and the count
// is Poisson, so the money over T seconds is compound Poisson with mean
// rate x E[R] x T and variance rate x E[R^2] x T (moneyVarPerSec) — what
// plan.applyDraw carries as the stream's uncertainty.
//
// What comes out is an EXPECTATION per second: money, and faction reputation
// (spread thinly — it is reported, not scheduled). Both are small against a
// mid-run batcher and enormous against a fresh life's, which is exactly why a
// forecast and not a measurement is needed: the stream is the same size in
// both, and only the forecast knows that on the first pass of a new life.

// The solver table (ctsolvers.js: no ns call, 0GB to import). Read, not
// copied, so coverage cannot drift from what ctauto.js actually dispatches.
import { codingContractTypesMetadata } from 'ctsolvers.js'

const num = (x) => typeof x === 'number' && isFinite(x)

/** engine.tsx: three tries every 3000 cycles of 200ms. */
export const TRIES_PER_WINDOW = 3
export const WINDOW_SEC = 600

/** Constants.ts:91-93. Registered in tools/sim/bncheck.mjs (contract-money). */
export const BASE_MONEY_GAIN = 75e6
export const BASE_FACTION_REP_GAIN = 2500
export const BASE_COMPANY_REP_GAIN = 4000

/** Contract.ts rewardScaling = 1, PlayerObjectGeneralMethods.ts:511 / 3 — the FIRST step only; a re-route divides again. */
export const REWARD_SCALING = 1 / 3

/**
 * Every contract type and its difficulty (CodingContract/Enums.ts names,
 * CodingContract/contracts/*.ts difficulties), in the enum's order. [CP1]
 * re-parses the source and fails on drift.
 */
export const TYPE_DIFFICULTY = {
  'Find Largest Prime Factor': 1,
  'Subarray with Maximum Sum': 1,
  'Total Ways to Sum': 1,
  'Total Ways to Sum II': 2,
  'Spiralize Matrix': 2,
  'Array Jumping Game': 2,
  'Array Jumping Game II': 3,
  'Merge Overlapping Intervals': 3,
  'Generate IP Addresses': 3,
  'Algorithmic Stock Trader I': 1,
  'Algorithmic Stock Trader II': 2,
  'Algorithmic Stock Trader III': 4,
  'Algorithmic Stock Trader IV': 8,
  'Minimum Path Sum in a Triangle': 5,
  'Unique Paths in a Grid I': 3,
  'Unique Paths in a Grid II': 5,
  'Shortest Path in a Grid': 7,
  'Sanitize Parentheses in Expression': 10,
  'Find All Valid Math Expressions': 10,
  'HammingCodes: Integer to Encoded Binary': 6,
  'HammingCodes: Encoded Binary to Integer': 9,
  'Proper 2-Coloring of a Graph': 7,
  'Compression I: RLE Compression': 2,
  'Compression II: LZ Decompression': 4,
  'Compression III: LZ Compression': 10,
  'Encryption I: Caesar Cipher': 1,
  'Encryption II: Vigenère Cipher': 2,
  'Square Root': 5,
  'Total Number of Primes': 2,
  'Largest Rectangle in a Matrix': 6,
}

/** Every type's difficulty — the draw is uniform over the types under the cap. */
export const DIFFICULTIES = Object.values(TYPE_DIFFICULTY)

/** The types ctauto.js can answer: ctsolvers.js's table, by exact name (findAnswer dispatches on it). */
export const SOLVER_TYPES = new Set((codingContractTypesMetadata ?? []).filter((m) => typeof m?.solver === 'function').map((m) => m.name))

/** ContractGenerator.ts: the per-try success probability at `pending` contracts outstanding. */
export const spawnChance = (pending = 0) => 100 / (399 + Math.exp(0.0012 * Math.max(0, pending)))

/** Expected contracts per second. */
export const spawnPerSec = (pending = 0) => (TRIES_PER_WINDOW * spawnChance(pending)) / WINDOW_SEC

/** ContractGenerator.ts — the difficulty cap from Source-File levels. */
export const maxDifficulty = (totalSourceFileLevels) => 2 * totalSourceFileLevels + 1

/** The types a contract can be drawn from under the cap: [{ name, d }]; null on unreadable input. */
export function typePool(totalSourceFileLevels) {
  if (!num(totalSourceFileLevels) || totalSourceFileLevels < 0) return null
  const cap = maxDifficulty(totalSourceFileLevels)
  return Object.entries(TYPE_DIFFICULTY)
    .filter(([, d]) => d <= cap)
    .map(([name, d]) => ({ name, d }))
}

/** Mean difficulty of a uniform draw over the types under the cap; null if none qualify. */
export function expectedDifficulty(totalSourceFileLevels) {
  const pool = typePool(totalSourceFileLevels)
  if (!pool?.length) return null
  return pool.reduce((a, t) => a + t.d, 0) / pool.length
}

/**
 * The fraction of drawn contracts ctauto.js can solve under the cap:
 * `{ coverage, unsolved: [names] }`. A type with no solver is skipped (a
 * wrong answer burns an attempt) and stays pending on the network.
 */
export function solverCoverage(totalSourceFileLevels, solvable = SOLVER_TYPES) {
  const pool = typePool(totalSourceFileLevels)
  if (!pool?.length) return null
  const unsolved = pool.filter((t) => !solvable.has(t.name)).map((t) => t.name)
  return { coverage: (pool.length - unsolved.length) / pool.length, unsolved }
}

// gainCodingContractReward's reward types (Contract.ts CodingContractRewardType).
const FACTION = 'faction'
const FACTION_ALL = 'factionAll'
const COMPANY = 'company'
const MONEY = 'money'

/**
 * EVERY TERMINAL PATH of gainCodingContractReward for one solved contract,
 * transliterated from source: `[{ route, kind, p, scale }]`, p summing to 1.
 * `route` names the path ('company>faction>money'), `kind` what is paid,
 * `scale` the factor on the base gain (1/3, 1/9 or 1/27). Each re-route
 * recurses with the ADJUSTED scaling as its rewardScaling, dividing by 3 again.
 */
export function rewardRoutes({ moneyOffered = true, hasHackingFaction, hasJob } = {}) {
  const out = []
  const pay = (kind, rewardScaling, p, path) => {
    const adj = rewardScaling / 3
    const route = path ? `${path}>${kind}` : kind
    if (kind === FACTION || kind === FACTION_ALL) {
      if (!hasHackingFaction) return pay(MONEY, adj, p, route)
      out.push({ route, kind, p, scale: adj })
    } else if (kind === COMPANY) {
      if (!hasJob) {
        pay(FACTION, adj, p / 2, route)
        pay(FACTION_ALL, adj, p / 2, route)
        return
      }
      out.push({ route, kind: COMPANY, p, scale: adj })
    } else out.push({ route, kind: MONEY, p, scale: adj })
  }
  const kinds = [FACTION, FACTION_ALL, COMPANY, ...(moneyOffered ? [MONEY] : [])]
  for (const t of kinds) pay(t, 1, 1 / kinds.length, '')
  return out
}

/**
 * Expected reward of ONE SPAWNED contract — solved by ctauto.js where a solver
 * exists, at its measured `successRate` — and its money's second moment.
 *
 * `o`: `{ totalSourceFileLevels, nodeContractMoney, hasHackingFaction, hasJob,
 *         factions?, solvable?, successRate? }`.
 *   factions     the joined hacking-work factions (k): adds `factionRepEach`,
 *                one faction's expected share — total/k for the single
 *                route (one at random), floor(total/k) for the all route
 *   solvable     the set of solvable type names (default SOLVER_TYPES)
 *   successRate  solved / attempted, measured (default 1)
 *
 * Returns `{ money, moneySq, factionRep, factionRepEach?, companyRep,
 * companyRepShare, meanDifficulty, coverage, successRate, routes }`:
 * `factionRep` is the TOTAL over every faction it reaches (a caller pricing
 * one faction divides by k, or reads factionRepEach), `moneySq` E[R^2] for
 * the compound-Poisson variance. Company reputation has no price here; it is
 * reported. Refuses (null) when any input is unreadable.
 */
export function expectedReward(o = {}) {
  const pool = typePool(o.totalSourceFileLevels)
  if (!pool?.length) return null
  if (!num(o.nodeContractMoney) || o.nodeContractMoney < 0) return null
  if (typeof o.hasHackingFaction !== 'boolean' || typeof o.hasJob !== 'boolean') return null
  const solvable = o.solvable instanceof Set ? o.solvable : SOLVER_TYPES
  const succ = num(o.successRate) ? Math.min(1, Math.max(0, o.successRate)) : 1
  const k = num(o.factions) && o.factions >= 1 ? Math.floor(o.factions) : null
  const routes = rewardRoutes({ moneyOffered: o.nodeContractMoney > 0, hasHackingFaction: o.hasHackingFaction, hasJob: o.hasJob })
  const solved = pool.filter((t) => solvable.has(t.name))
  const n = pool.length
  let money = 0
  let moneySq = 0
  let factionRep = 0
  let factionRepEach = 0
  let companyRep = 0
  for (const t of solved) {
    const q = succ / n
    for (const r of routes) {
      const w = q * r.p
      if (r.kind === MONEY) {
        const x = BASE_MONEY_GAIN * t.d * o.nodeContractMoney * r.scale
        money += w * x
        moneySq += w * x * x
      } else if (r.kind === COMPANY) companyRep += w * BASE_COMPANY_REP_GAIN * t.d * r.scale
      else {
        const total = BASE_FACTION_REP_GAIN * t.d * r.scale
        factionRep += w * total
        if (k !== null) factionRepEach += w * (r.kind === FACTION_ALL ? Math.floor(total / k) : total / k)
      }
    }
  }
  return {
    money,
    moneySq,
    factionRep,
    ...(k !== null ? { factions: k, factionRepEach } : {}),
    companyRep,
    companyRepShare: routes.filter((r) => r.kind === COMPANY).reduce((a, r) => a + r.p, 0),
    meanDifficulty: pool.reduce((a, t) => a + t.d, 0) / n,
    coverage: solved.length / n,
    successRate: succ,
    routes,
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
 * IS A SOLVER RUNNING, from ctauto.js's own record (/tel/ctauto.txt, written
 * every pass and on exit by status.js's reporter): `{ solving, lastRunMs,
 * successRate, why }`. Solving = a write within `freshMs` that is not the
 * exit record. `lastRunMs` is when it last looked (an exit record's
 * `staleSince`, else its `at`) — where the backlog starts — or null.
 * `successRate`: solved / (solved + wrong), null before any attempt.
 */
export function solverStateOf(rec, nowMs = Date.now(), freshMs = 15 * 60e3) {
  const at = Date.parse(rec?.at ?? '')
  if (!isFinite(at)) return { solving: false, lastRunMs: null, successRate: null, why: 'ctauto.js has no record' }
  const exited = rec.exited === true || rec.health === 'stopped'
  const lastRunMs = exited && isFinite(Date.parse(rec.staleSince ?? '')) ? Date.parse(rec.staleSince) : at
  const att = (num(rec.solved) ? rec.solved : 0) + (num(rec.wrong) ? rec.wrong : 0)
  const successRate = att > 0 ? rec.solved / att : null
  if (exited) return { solving: false, lastRunMs, successRate, why: `ctauto.js stopped (${rec.detail ?? rec.health})` }
  if (nowMs - at > freshMs) return { solving: false, lastRunMs, successRate, why: `ctauto.js silent for ${((nowMs - at) / 60e3).toFixed(0)} min` }
  return { solving: true, lastRunMs, successRate, why: 'ctauto.js is solving' }
}

/**
 * THE STREAM, per second, REALISED ONLY WHILE A SOLVER RUNS.
 *
 * `o`: expectedReward's inputs, plus
 *   pending     contracts outstanding (ctauto.js's lastScanFound) while solving
 *   solving     false when no solver runs (default true: the old contract)
 *   backlogSec  seconds the stream has accrued unsolved (since the solver
 *               last ran, or the life began — an install deletes them)
 *
 * Returns `{ perSec, perHour, moneyPerSec, moneyVarPerSec, factionRepPerSec,
 * solving, expected: {moneyPerSec, moneyVarPerSec, factionRepPerSec},
 * backlog: {count, solvable, money, factionRep} | null, reward }`.
 * The realised rates (moneyPerSec, ...) are the expected ones while solving
 * and 0 while not; `expected` is what a running solver would earn; the
 * backlog is what has piled up and pays as a lump when one next runs. The
 * backlog's count is the pending count, so it lowers the spawn chance.
 * moneyVarPerSec = rate x E[R^2]: over T seconds the stream's money is
 * compound Poisson, variance moneyVarPerSec x T.
 */
export function contractStream(o = {}) {
  const reward = expectedReward(o)
  if (!reward) return null
  const solving = o.solving !== false
  const backlogSec = !solving && num(o.backlogSec) && o.backlogSec > 0 ? o.backlogSec : 0
  // The backlog count at the base rate (it lowers the spawn chance only past
  // thousands, so the first-order count is exact enough), then the rate at it.
  const count = backlogSec * spawnPerSec(0)
  const pending = solving ? (num(o.pending) ? o.pending : 0) : count
  const perSec = spawnPerSec(pending)
  const expected = { moneyPerSec: perSec * reward.money, moneyVarPerSec: perSec * reward.moneySq, factionRepPerSec: perSec * reward.factionRep }
  return {
    perSec,
    perHour: perSec * 3600,
    moneyPerSec: solving ? expected.moneyPerSec : 0,
    moneyVarPerSec: solving ? expected.moneyVarPerSec : 0,
    factionRepPerSec: solving ? expected.factionRepPerSec : 0,
    solving,
    expected,
    backlog: solving ? null : { count, solvable: count * reward.coverage, money: count * reward.money, factionRep: count * reward.factionRep },
    reward,
  }
}

/** The old name: the stream with a solver assumed running unless `solving: false` says otherwise. */
export const contractIncome = contractStream

/**
 * ONE REWARD, PARSED from attempt()'s return string (gainCodingContractReward's
 * four messages) for ctauto.js's log: `{ type, d, route, amount, scale? }`.
 *   'Gained $8.333m'                                     money
 *   'Gained 833.3 faction reputation for NiteSec'        faction
 *   'Gained 277 reputation for each of the following factions: A, B'  factionAll (amount per faction, n)
 *   'Gained 1333.3 company reputation for ECorp'         company
 * `scale` = amount / (base x difficulty): 1/3 direct, 1/9 re-routed once,
 * 1/27 twice (money: before the node's CodingContractMoney). Unparsed -> route 'unknown'.
 */
const MONEY_SUFFIX = { '': 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12, q: 1e15, Q: 1e18, s: 1e21, S: 1e24, o: 1e27, n: 1e30 }
export function parseRewardText(text, type) {
  const d = TYPE_DIFFICULTY[type] ?? null
  const s = String(text ?? '')
  const out = { type: type ?? null, d, route: 'unknown', amount: null }
  let m
  if ((m = s.match(/^Gained \$([\d.,]+)([a-zA-Z]?)$/))) {
    out.route = MONEY
    out.amount = Number(m[1].replace(/,/g, '')) * (MONEY_SUFFIX[m[2]] ?? NaN)
  } else if ((m = s.match(/^Gained ([\d.e+]+) faction reputation for (.+)$/))) {
    out.route = FACTION
    out.amount = Number(m[1])
    out.faction = m[2]
  } else if ((m = s.match(/^Gained ([\d.e+]+) reputation for each of the following factions: (.+)$/))) {
    out.route = FACTION_ALL
    out.amount = Number(m[1])
    out.n = m[2].split(', ').length
  } else if ((m = s.match(/^Gained ([\d.e+]+) company reputation for (.+)$/))) {
    out.route = COMPANY
    out.amount = Number(m[1])
  }
  if (!num(out.amount)) out.amount = null
  const base = { [MONEY]: BASE_MONEY_GAIN, [FACTION]: BASE_FACTION_REP_GAIN, [FACTION_ALL]: BASE_FACTION_REP_GAIN, [COMPANY]: BASE_COMPANY_REP_GAIN }[out.route]
  if (base && d && out.amount !== null) out.scale = (out.amount * (out.route === FACTION_ALL ? out.n : 1)) / (base * d)
  return out
}
