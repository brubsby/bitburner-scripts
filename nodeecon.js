// WHERE THE MONEY COMES FROM IN THIS BITNODE, AND WHAT AN INSTALL LEAVES.
//
// Pure: no ns surface, so importing it is free and it runs under plain node.
//
// Every planner in this repo was written where scripted hacking IS the income:
// progress.js reads ns.getTotalScriptIncome(), exitplan scales it with the
// hacking level, and an install leaves $1262. BitNode 8 ("Ghost of Wall
// Street", BitNode.tsx:764-793) breaks all three at once:
//
//   ScriptHackMoneyGain 0   hacks still DRAIN servers (ScriptHackMoney 0.3)
//                           but the player receives nothing
//                           (NetscriptHelpers.tsx:648) — getTotalScriptIncome
//                           reads 0 all node long, and it is not a fault
//   CrimeMoney, CompanyWorkMoney, HacknetNodeMoney, InfiltrationMoney,
//   CodingContractMoney 0   every other faucet is off too (contracts stop
//                           offering money at all: ContractGenerator.ts:186)
//   GangSoftcap 0           gang respect AND money become x^0 = 1 per member
//                           per cycle (Gang/formulas/formulas.ts:27,71)
//   FavorToDonateToFaction 0  donations open at favor 0 (donation.ts:17), so
//                           reputation is a PRICE from the first join
//   starting money 250e6    Prestige.ts:38,158-160,293-295 — REPLACES the
//                           balance at every install (after the augmentations'
//                           startingMoney is paid in, Prestige.ts:85-88, so
//                           CashRoot's $1m is overwritten, not added)
//   stock market            re-initialised at every install (Prestige.ts:166-
//                           170): an open position is DESTROYED, not refunded
//
// So the money is the stock trader's, and a planner that reads only script
// income sees $0/s, prices every exit as unreadable, and (installgate's own
// comment) installs "precisely when it knows least". This module is the one
// place that knows which instrument measures income in which node.

/** money = 1000 + CONSTANTS.Donations (PlayerObjectGeneralMethods.ts:102). */
export const INSTALL_MONEY = 1262
/** Prestige.ts:38 `BitNode8StartingMoney`, applied when `Player.bitNodeN === 8`. */
export const BN8_STARTING_MONEY = 250e6

/**
 * The balance a fresh life opens with, before augmentation grants.
 *
 * A node NUMBER, not a multiplier, and deliberately so: the game itself gates
 * this on `Player.bitNodeN === 8` (Prestige.ts:158, :293) — there is no
 * multiplier to read. Fidelity to source means copying that test.
 */
export const postInstallMoney = (bitNode) => (bitNode === 8 ? BN8_STARTING_MONEY : INSTALL_MONEY)

/** Whether augmentation `startingMoney` survives into the life (BN8 overwrites it). */
export const startingMoneySurvives = (bitNode) => bitNode !== 8

/**
 * The favor a faction needs before it accepts donations:
 * floor(150 * FavorToDonateToFaction) (donation.ts:16-17). ZERO IS A REAL
 * ANSWER — BitNode 8 — and means "donate from the first day"; null means the
 * multiplier could not be read. Callers must keep those apart: the old
 * `f > 0 ? 150 * f : null` turned BN8's 0 into "donations never open".
 */
export function favorToDonateOf(mults) {
  const f = mults?.FavorToDonateToFaction
  return typeof f === 'number' && isFinite(f) && f >= 0 ? Math.floor(150 * f) : null
}

/**
 * Factions that never accept a donation whatever the favor
 * (Singularity.ts:894-929): the gang you manage, and any faction whose
 * FactionInfo offers no work — Bladeburners (FactionInfo.tsx:698), Church of
 * the Machine God (:725), Shadows of Anarchy (:789). With the threshold at 150
 * these were unreachable in practice; at BN8's 0 they would be "donatable"
 * and every donate order to them would fail and break its purchase chain.
 */
export const NO_DONATION_FACTIONS = ['Bladeburners', 'Church of the Machine God', 'Shadows of Anarchy']

export function canDonateTo(faction, favor, need, gangFaction = null) {
  if (typeof faction !== 'string' || !faction) return false
  if (NO_DONATION_FACTIONS.includes(faction)) return false
  if (gangFaction && faction === gangFaction) return false
  return typeof need === 'number' && isFinite(need) && typeof favor === 'number' && isFinite(favor) && favor >= need
}

// ---------------------------------------------------------------------------
// THE STOCK TRADER'S RECORD — the interface this repo EXPECTS from stock.js.
//
// stock.js/stockplan.js are owned by another agent. What the rest of the stack
// needs from them is written down here, in the one module that reads it, so
// the two sides cannot drift apart silently. /tel/stock.txt (JSON, on home):
//
//   at            ISO time of the sample                      REQUIRED
//   lastAugReset  ns.getResetInfo().lastAugReset              REQUIRED (this life)
//   equity        liquidation value of every open position NOW, long and
//                 short, after commissions — what act-liquidate.js would
//                 raise; EXCLUDES home cash                   REQUIRED, >= 0
//   returnPerSec  measured net return on the capital the trader manages
//                 (cash it may use + equity), as a FRACTION per second:
//                 d ln(capital)/dt with deposits and withdrawals netted out.
//                 This is what makes stock income a COMPOUNDING term — see
//                 exitplan.hoursToMoney. null / absent = not measured yet.
//   capitalCap    capital beyond which returns stop scaling (liquidity,
//                 max shares, price impact), $. null = unknown (no cap used)
//   incomePerSec  realised $/s this life, net — the fallback when
//                 returnPerSec is not measured; used as a FLAT rate
//   manip         { hostname: 'hack' | 'grow' } — servers where batch.js
//                 should pass {stock: true} on ONE side of the batch:
//                 'hack' flags the hacks (NetscriptHelpers.tsx:668-669 ->
//                 PlayerInfluencing.ts:24, second-order forecast -0.1 with
//                 chance drained/moneyMax) when the trader wants that
//                 company's price DOWN; 'grow' flags the grows
//                 (NetscriptFunctions.ts:301-302 -> PlayerInfluencing.ts:47,
//                 +0.1) when UP. Never both: a batch's grow puts back what its
//                 hack took, so flagging both cancels in expectation. Optional.
//   manipCurve    [{nudgesPerSec, returnPerSec}] — the trader's returnPerSec
//                 at a total nudge rate (fraction of moneyMax moved per
//                 second on its manip hosts, summed; each moved fraction is a
//                 forecast nudge with that chance). REQUIRED for manip to be
//                 served where hacking pays nothing: batch.js prices serving
//                 against farming exp with that RAM as two exits
//                 (expfarm.manipVerdict) and serves nothing without it.
//
// And it must HONOUR /tel/stock-hold.txt ({at, lastAugReset, by, why}): while
// that is fresh (STOCK_HOLD_MS) and of this life, open NO new position — the
// liquidation before an install has sold everything and the install is
// imminent; a position opened now is destroyed by it.
// ---------------------------------------------------------------------------

export const STOCK_FILE = '/tel/stock.txt'
// THE MANUAL INSTALL HOLD (any content, the reason): progress.js's gate and
// act.js's install order both refuse while it exists on home.
export const INSTALL_HOLD_FILE = '/install-hold.txt'
export const STOCK_HOLD_FILE = '/tel/stock-hold.txt'
export const STOCK_FRESH_MS = 10 * 60e3
export const STOCK_HOLD_MS = 10 * 60e3

const fin = (x) => typeof x === 'number' && isFinite(x)

/**
 * Validate the trader's record for THIS life. `{ ok, equity, returnPerSec,
 * capitalCap, incomePerSec, manip, why }`. `ok: false` carries `why` and
 * zeros — the caller decides whether an absent trader is fatal (it is only in
 * a node with no other income, see incomeOf).
 */
export function stockRecordOf(rec, lastAugReset, now = Date.now()) {
  const none = (why) => ({ ok: false, equity: 0, returnPerSec: null, capitalCap: null, incomePerSec: null, scriptPerSec: null, scriptMade: null, manip: null, manipCurve: null, why })
  if (!rec || typeof rec !== 'object') return none('no stock trader record')
  const age = now - Date.parse(rec.at ?? '')
  if (!(age >= 0 && age < STOCK_FRESH_MS)) return none(`stock record stale or undated (${fin(age) ? Math.round(age / 60e3) + ' min' : 'no at'})`)
  if (rec.lastAugReset !== lastAugReset) return none('stock record is from another life')
  if (!fin(rec.equity) || rec.equity < 0) return none('stock record has no readable equity')
  const manip = rec.manip && typeof rec.manip === 'object' ? Object.fromEntries(Object.entries(rec.manip).filter(([, v]) => v === 'hack' || v === 'grow')) : null
  return {
    ok: true,
    equity: rec.equity,
    returnPerSec: fin(rec.returnPerSec) ? rec.returnPerSec : null,
    capitalCap: fin(rec.capitalCap) && rec.capitalCap > 0 ? rec.capitalCap : null,
    incomePerSec: fin(rec.incomePerSec) && rec.incomePerSec >= 0 ? rec.incomePerSec : null,
    // THE TRADER'S SHARE OF getTotalScriptIncome (stock.js scriptIncome): the
    // game books every sale's realised profit as the selling script's income
    // (StockMarket/BuyingAndSelling.tsx:175/364 -> onlineMoneyMade and
    // scriptProdSinceLastAug). Signed — a losing run lowers the total.
    scriptPerSec: fin(rec.scriptIncome?.perSec) ? rec.scriptIncome.perSec : null,
    scriptMade: fin(rec.scriptIncome?.made) ? rec.scriptIncome.made : null,
    manip,
    manipCurve: Array.isArray(rec.manipCurve) ? rec.manipCurve.filter((x) => fin(x?.nudgesPerSec) && x.nudgesPerSec >= 0 && fin(x?.returnPerSec)) : null,
    // The trader's mode ('4S' | 'pre-4S ...'): which r(W) curve it trades on (traderw.rwRegimeOf).
    mode: typeof rec.mode === 'string' ? rec.mode : null,
    why: null,
  }
}

/**
 * The worker flag for one batch operation on `host`: 1 when the trader asked
 * for this side of this server to move its stock, else 0. batch.js passes it
 * as h.js/g.js's 4th argument. Pure so the direction rule is tested once.
 */
export function stockFlagFor(manip, host, op) {
  const want = manip && typeof manip === 'object' ? manip[host] : null
  return (want === 'hack' && op === 'hack') || (want === 'grow' && op === 'grow') ? 1 : 0
}

/**
 * THE INCOME, split by how it evolves — which is what a trajectory needs.
 *
 *   levelPerSec   scripted hacking: getTotalScriptIncome ([0] running, [1]
 *                 since-install average, as progress.js reads it). Scales
 *                 with (hacking + 50) — exitplan / trajectory.incomeModel.
 *   flatPerSec    income that does not move with the level or the balance
 *                 (a trader that only reports a realised $/s).
 *   capitalReturnPerSec, capitalCap
 *                 the trader's measured return: income = r x min(money, cap).
 *                 It COMPOUNDS, and it restarts from the post-install balance
 *                 after every install — the shape a flat rate cannot carry.
 *
 * `incomePerSec` = levelPerSec + flatPerSec: the non-compounding part, the
 * figure exitplan's `incomePerSec` input has always meant (callers that bump
 * it — spendExit, gangGainHours — are adding hacking-shaped income).
 * `priced` is false when nothing positive was measured; `why` then says
 * whether that is a real zero or an absent instrument.
 *
 * EACH STREAM ONCE. getTotalScriptIncome is NOT the hacking stream: the game
 * adds every stock sale's realised profit to the selling script's income
 * (StockMarket/BuyingAndSelling.tsx:175 and :364 -> onlineMoneyMade,
 * scriptProdSinceLastAug). Until 2026-09-29 that whole figure was
 * levelPerSec, so the trader was counted TWICE — as its compounding
 * r x money AND as "hacking" income — and the second copy was scaled with the
 * hacking level and every hacking_money augmentation, neither of which drives
 * it. Live BN9 03:21: script income $13.36m/s, of which the batcher (exp
 * farm) earned $0/s and stock.js ~$13.1m/s. So the trader's share
 * (stock.js's own getScriptIncome, published as scriptIncome; its lifePnl
 * rate as the stand-in for a record that predates it) is taken OUT of the
 * script income here, and the trader is priced only through its own terms
 * (capitalReturnPerSec, or flatPerSec when no return is measured).
 * `lifeSec` (optional): seconds since the install, for the since-install
 * fallback ([1]) — the trader's realised $ over the life is removed from it.
 * `streams` names every stream and its growth driver, for the record.
 */
/**
 * HACKNET PRODUCTION AS MONEY, from hacknet.js's report (/tel/hacknet.txt
 * `moneyPerSec`: a node's $/s, or a server's hashes at the $250k/hash sell
 * floor — hacknetplan.DOLLARS_PER_HASH). NOT script income: getTotalScriptIncome
 * never sees it, and in BitNode 9 it is most of the money there is. The next
 * install deletes every node and server (PlayerObjectGeneralMethods.ts:130), so
 * it is income for THIS life only — exitplan's `lifeIncome`, never part of
 * `incomePerSec` or `flatPerSec` (which persist across installs).
 * { ok, perSec, why }: stale, other-life or absent -> perSec 0 with the reason.
 */
export const HACKNET_FILE = '/tel/hacknet.txt'
export function hacknetRecordOf(rec, lastAugReset, now = Date.now()) {
  if (!rec) return { ok: false, perSec: 0, why: 'no /tel/hacknet.txt' }
  if (rec.lastAugReset !== lastAugReset) return { ok: false, perSec: 0, why: 'hacknet report is from another life' }
  if (!(now - Date.parse(rec.at) < 15 * 60e3)) return { ok: false, perSec: 0, why: 'hacknet report is stale' }
  const v = rec.moneyPerSec
  return fin(v) && v >= 0 ? { ok: true, perSec: v, why: null } : { ok: false, perSec: 0, why: 'hacknet report carries no moneyPerSec' }
}

export function incomeOf({ scriptIncome, mults, stock, hacknet, lifeSec = null } = {}) {
  const s = stock?.ok ? stock : null
  const split = hackScriptIncome(scriptIncome, s, lifeSec)
  const now = split.nowPerSec
  const levelPerSec = split.perSec
  const r = s && fin(s.returnPerSec) && s.returnPerSec > 0 ? s.returnPerSec : 0
  const flatPerSec = s && !(r > 0) && fin(s.incomePerSec) && s.incomePerSec > 0 ? s.incomePerSec : 0
  const hackPays = mults?.ScriptHackMoneyGain
  const sources = []
  if (levelPerSec > 0) sources.push(now > 0 ? 'running-scripts' : 'since-last-aug')
  if (r > 0) sources.push('stock-return')
  else if (flatPerSec > 0) sources.push('stock-realised')
  // Hacknet (hacknetRecordOf): priced, reported, and kept OUT of incomePerSec.
  const lifePerSec = hacknet?.ok && fin(hacknet.perSec) && hacknet.perSec > 0 ? hacknet.perSec : 0
  if (lifePerSec > 0) sources.push('hacknet')
  const priced = levelPerSec > 0 || flatPerSec > 0 || r > 0 || lifePerSec > 0
  let why = null
  if (!priced) {
    why =
      hackPays === 0
        ? `scripted hacking pays nothing in this node (ScriptHackMoneyGain 0) and the stock trader published no measured return${stock?.why ? ` (${stock.why})` : ''} — income is UNMEASURED, not zero`
        : 'no income measured from any source'
  }
  return {
    incomePerSec: levelPerSec + flatPerSec,
    levelPerSec,
    flatPerSec,
    lifePerSec,
    capitalReturnPerSec: r,
    capitalCap: s?.capitalCap ?? null,
    equity: s ? s.equity : 0,
    source: sources.join('+') || 'none',
    priced,
    // RAM's income response is the SCRIPT part only. In BN8 it is a measured
    // zero; everywhere else it is what batch.txt's RAM earns.
    scriptPerSec: levelPerSec,
    // The trader's share taken out of the script income, and how it was known.
    stockScriptPerSec: split.stockPerSec,
    stockScriptSource: split.stockSource,
    hackPays: fin(hackPays) ? hackPays > 0 : null,
    // EVERY STREAM ONCE, with what makes it grow (exitplan's terms).
    streams: {
      hack: { perSec: levelPerSec, grows: 'hacking level (+50) and hacking_money multipliers', term: 'incomePerSec - flatIncomePerSec' },
      stock: r > 0
        ? { perSec: r * (s?.equity ?? 0), returnPerSec: r, equity: s?.equity ?? 0, realisedPerSec: split.stockPerSec, grows: 'compounds on the balance (r x min(money, cap)); no hacking scaling', term: 'capitalReturnPerSec' }
        : { perSec: flatPerSec, grows: 'flat (no measured return)', term: 'flatIncomePerSec' },
      hacknet: { perSec: lifePerSec, grows: 'this life only (destroyed at install)', term: 'lifeIncome' },
    },
    why,
  }
}

/**
 * THE HACKING STREAM OF getTotalScriptIncome: the script income less the
 * trader's realised profit, which the game books into the same counters
 * (StockMarket/BuyingAndSelling.tsx:175/364). Pure.
 *   scriptIncome  [running $/s, since-install $/s] (ns.getTotalScriptIncome)
 *   stock         a stockRecordOf record (ok), or null for no trader
 *   lifeSec       seconds since the install (the [1] fallback), optional
 * { perSec, nowPerSec, stockPerSec, stockSource }. [0] is used when the
 * hacking part of it is positive; else [1] less the trader's realised
 * dollars over the life (its published `made`, else its rate).
 */
export function hackScriptIncome(scriptIncome, stock, lifeSec = null) {
  const raw0 = fin(scriptIncome?.[0]) ? scriptIncome[0] : 0
  const raw1 = fin(scriptIncome?.[1]) ? scriptIncome[1] : 0
  const s = stock?.ok ? stock : null
  let stockPerSec = 0
  let stockSource = s ? null : 'no trader record'
  if (s && fin(s.scriptPerSec)) {
    stockPerSec = s.scriptPerSec
    stockSource = "stock.js's own script income (getScriptIncome)"
  } else if (s && fin(s.incomePerSec)) {
    stockPerSec = s.incomePerSec
    stockSource = "stock.js lifePnl rate (record carries no scriptIncome)"
  } else if (s) stockSource = 'trader record without an income figure: nothing removed'
  const nowPerSec = Math.max(0, raw0 - stockPerSec)
  if (nowPerSec > 0) return { perSec: nowPerSec, nowPerSec, stockPerSec, stockSource }
  const stockAvg = !s ? 0 : fin(s.scriptMade) && fin(lifeSec) && lifeSec > 0 ? s.scriptMade / lifeSec : stockPerSec
  return { perSec: Math.max(0, raw1 - stockAvg), nowPerSec: 0, stockPerSec, stockSource }
}

// ---------------------------------------------------------------------------
// MONEY THAT LEAVES EVERY SECOND, UNCHECKED.
//
// Every one-off purchase the stack makes is balance-checked by the game
// (canAfford / money >= cost: augmentations, donations, servers, home, TOR,
// programs, travel Person.ts:242, sleeve augs Sleeve.ts:373, stock orders).
// Two sinks are not: CLASS and GYM fees, player and sleeve alike —
// calculateClassEarnings sets money = -cost x costMult per second
// (Work/Formulas.ts:101-120, ClassWork.tsx:32-72) and applyWorkStats charges
// it through loseMoney with no check, so they drive cash negative (BitNode 8,
// 2026-09-25: five sleeves at ZB, $8k/s, cash to -$2.4m). Hospitalisation is
// bounded — min(10% of cash, damage x HospitalCostPerHp) and 0 when cash is
// already negative (Hospital/Hospital.ts:4-10) — so it churns but cannot
// cross zero. Gang equipment and corporation spend are not reachable here.
//
// So every paid class or gym session the stack starts must pass
// feeFundable: cash on hand covers the fee for FEE_FLOOR_S seconds. That is a
// FLOOR against our own spending, not a pricing: whether the class is worth it
// is decided by the exit simulation (exitplan spendPerSec) where one exists.
// ---------------------------------------------------------------------------

/** Seconds of a fee cash must cover before a paid class/gym session starts. */
export const FEE_FLOOR_S = 120
/** ClassWork.tsx:42 (Algorithms, -320/s) and :57-72 (gym, -120/s), before location costMult. */
export const CLASS_BASE_FEE = { algorithms: 320, leadership: 320, gym: 120 }

/** True when cash covers `feePerSec` for `seconds`; false when it cannot OR cash is unreadable (fail closed). */
export function feeFundable(cash, feePerSec, seconds = FEE_FLOOR_S) {
  if (!fin(cash) || !fin(feePerSec) || feePerSec < 0) return false
  return cash >= feePerSec * seconds
}

/**
 * Where money is CAPITAL — scripted hacking pays nothing (ScriptHackMoneyGain
 * 0, BitNode 8) and cash is the trader's compounding book — a spender outside
 * budget.js's claims (port programs, TOR) may spend only on a fresh priced
 * verdict from progress.js (installgate spendExit.programs[item]). Elsewhere
 * nothing changes: allowed, with no verdict needed.
 * { allowed, why }
 */
export function programSpendAllowed(mults, gateRecord, item, lastAugReset, now = Date.now(), { exitRoot = false } = {}) {
  // THE EXIT NEEDS THEM. Once The Red Pill is installed, w0r1d_d43m0n needs
  // root — five open ports (servers.ts numOpenPortsRequired 5) — and the
  // install took every program and TOR with it. They are REQUIRED purchases
  // then, in every node, not investments priced against exp (live BN8
  // 2026-09-27: the exit stalled 1h46m on "not rooted — missing BruteSSH.exe,
  // HTTPWorm.exe, SQLInject.exe" while the exp-priced gate held them).
  if (exitRoot) return { allowed: true, why: 'required: w0r1d_d43m0n needs five open ports and The Red Pill is installed' }
  if (mults?.ScriptHackMoneyGain !== 0) return { allowed: true, why: null }
  const v = gateRecord?.spendExit
  if (!v || v.lastAugReset !== lastAugReset || !(now - Date.parse(v.at ?? '') < 15 * 60e3)) return { allowed: false, why: `money is capital here and no fresh priced verdict exists for ${item}` }
  const p = v.programs?.[item]
  if (!p) return { allowed: false, why: `no priced verdict for ${item} (spendExit.programs)` }
  return { allowed: p.buy === true, why: p.why ?? null }
}

/**
 * CASH FOR A BATCH OF ORDERS, raised from the trader's book only as needed.
 *
 * The trader keeps its capital invested (cash ~$80k on a $60b book, live
 * 2026-09-25), so every money-in-hand action — a city faction's "$20m in
 * hand", travel, a donation, an augmentation — would wait forever on cash
 * that never arrives. And selling the WHOLE book for a $20m purchase (the old
 * `liquidate all` prefix) throws away the only compounding income there is.
 *
 * So each costed order carries `cost` (dollars it needs in cash), and this
 * inserts ONE `liquidate ['raise', X]` before the first of them, X = the
 * batch's total cost x (1 + margin) — cash on hand is what act-liquidate
 * measures against, so the raise is a target balance, not a sale size.
 * Nothing is inserted when cash already covers it or no equity exists.
 * Pure; returns a new array.
 */
export const TRAVEL_FARE = 200e3 // CONSTANTS.TravelCost
/**
 * IS THIS FACTION JOIN READY BUT FOR THE CASH? A raise sells part of the
 * trader's book and holds the trader; ordering one for an invitation that
 * cannot arrive (a skill, karma or anything else still short) sells capital
 * for nothing, and the next pass does it again. Live BN8 2026-09-25: a join
 * or travel raised nearly every pass and the book sat as ~$220m cash.
 * `reqs`: the game's requirement list (FactionJoinCondition.ts toJSON); the
 * money and city legs are what the batch itself supplies. Anything this does
 * not read is NOT ready (unknown never licenses a sale).
 * Returns {ready, why}.
 */
export function joinReadyButCash(reqs, player, { companyRep = null } = {}) {
  if (!Array.isArray(reqs)) return { ready: false, why: 'requirements unreadable' }
  for (const r of reqs) {
    const t = r?.type
    if (t === 'money' || t === 'city') continue
    if (t === 'skills') {
      for (const [k, v] of Object.entries(r.skills ?? {})) {
        const have = player?.skills?.[k]
        if (!(fin(have) && fin(v) && have >= v)) return { ready: false, why: `${k} ${fin(have) ? Math.floor(have) : '?'} of ${v}` }
      }
      continue
    }
    if (t === 'karma') {
      if (!(fin(player?.karma) && player.karma <= r.karma)) return { ready: false, why: `karma ${fin(player?.karma) ? Math.round(player.karma) : '?'} of ${r.karma}` }
      continue
    }
    // A company faction's legs (FactionJoinCondition employedBy /
    // companyReputation): the job held, and the company's reputation now.
    if (t === 'employedBy') {
      if (!(player?.jobs && typeof player.jobs === 'object' && r.company in player.jobs)) return { ready: false, why: `not employed at ${r.company}` }
      continue
    }
    if (t === 'companyReputation') {
      const have = companyRep?.[r.company]
      if (!(fin(have) && fin(r.reputation) && have >= r.reputation)) return { ready: false, why: `${r.company} reputation ${fin(have) ? Math.round(have) : '?'} of ${r.reputation}` }
      continue
    }
    if (t === 'numPeopleKilled') {
      if (!(fin(player?.numPeopleKilled) && player.numPeopleKilled >= r.numPeopleKilled)) return { ready: false, why: `kills ${player?.numPeopleKilled ?? '?'} of ${r.numPeopleKilled}` }
      continue
    }
    return { ready: false, why: `requirement '${t ?? '?'}' is not read here` }
  }
  return { ready: true, why: 'every requirement but the cash and the city is met' }
}

/**
 * WHAT A RAISE CAN ACTUALLY REACH. Selling a book returns less than the mid
 * price it is valued at: live 2026-09-27 13:37 a raise for $451.46b sold the
 * whole book and reached $442.50b (98.0%) — every purchase after it was
 * skipped and the book had to be re-bought. A batch is ordered only when
 * cash + equity x RAISE_SALE_HAIRCUT covers its total with the raise margin.
 */
export const RAISE_SALE_HAIRCUT = 0.97
export const RAISE_MARGIN = 0.02
export function raisable(cash, equity) {
  return (fin(cash) ? cash : 0) + (fin(equity) && equity > 0 ? equity * RAISE_SALE_HAIRCUT : 0)
}
export function batchFits(cash, equity, total) {
  return fin(total) && raisable(cash, equity) >= total * (1 + RAISE_MARGIN)
}
/**
 * THE MOST A BATCH CAN SPEND: the largest total batchFits accepts. The
 * purchase planner budgets on this, not on cash + equity at face value — the
 * purchase step executes on batchFits, so a plan built on the face value is a
 * plan the step trims. Live BN9 2026-09-30 08:19Z: planned 12 augmentations
 * ($557.3b before NeuroFlux) on $577.9b of cash + book; a raise reached
 * ~$559b after the sale haircut, $557.3b x 1.02 did not fit, and the install
 * ran on 8 while the gate had priced 12.
 */
export function batchReach(cash, equity) {
  return raisable(cash, equity) / (1 + RAISE_MARGIN)
}

/**
 * The previous order batch's OUTCOME, from act.js's record (/tel/act.txt
 * `orders`): one line for the planner's report, so an order is never left
 * reading as done. Null when there is no record of this life.
 */
export function batchOutcomeLine(act, lastAugReset) {
  const o = act?.orders
  if (!o || !Array.isArray(o.results) || act.lastAugReset !== lastAugReset) return null
  const r = o.results
  const failed = r.find((x) => x && x.ok === false && x.kind !== 'release-hold')
  const skipped = r.filter((x) => x && x.skipped).length
  const ok = r.filter((x) => x && x.ok === true)
  const buys = ok.filter((x) => x.kind === 'buyaug').length
  const donations = ok.filter((x) => x.kind === 'donate').length
  const head = `last batch (${o.at}): ${ok.length} of ${r.length} order(s) done (${buys} bought, ${donations} donated)`
  if (failed) return `${head} — ${failed.kind} FAILED (${String(failed.result?.error ?? failed.why ?? failed.error ?? 'no reason').slice(0, 120)})${skipped ? `, ${skipped} skipped after it` : ''}`
  return skipped ? `${head}, ${skipped} skipped` : head
}

/** The exit needs root on w0r1d_d43m0n: The Red Pill is INSTALLED (getResetInfo().ownedAugs). */
export function exitRootRequired(ownedAugs) {
  if (!ownedAugs) return false
  return typeof ownedAugs.has === 'function' ? ownedAugs.has('The Red Pill') : Array.isArray(ownedAugs) ? ownedAugs.includes('The Red Pill') : false
}

/**
 * PLACE THE STOCK TRADER EARLY, OR KEEP THE RAM FOR EARLY.JS — priced as
 * trajectories to the next milestone (the next home RAM tier), not by a
 * fixed manifest. Live BN1 2026-09-27 with SF8.1 (TIX from minute one): the
 * fleet was full of early.js/hgw.js threads and stock.js "planned 28.5GB but
 * no host had it free" for the whole opening.
 *   without: money(t) = W + I t                         (every GB farming)
 *   with:    money(t) = W e^{r t} + I' (e^{r t} - 1) / r  (the trader holds
 *            the balance and every dollar the fleet earns; the fleet earns
 *            I' = I (1 - traderGB / fleetGB))
 * r is the trader's return at THIS capital: r x (1 - floor / W), floor =
 * TRADER_FLOOR_WEALTH — below ~$5m commissions eat the edge (min order 20 x
 * the $100k commission, stockstrat minOrderCommissions; the harness's small-
 * capital runs). NOT CALIBRATED at small capital: r defaults to BN8's
 * realised 1.8e-4/s (the only measured return) unless the caller has this
 * node's. Place iff the milestone comes sooner by more than a minute.
 * Returns {place, withH, withoutH, rEff, why}.
 */
export const TRADER_FLOOR_WEALTH = 5e6
export const TRADER_PRIOR_R = 1.8e-4
export function traderPlacement({ wealth, tix = false, r = TRADER_PRIOR_R, floor = TRADER_FLOOR_WEALTH, incomePerSec, fleetGB, traderGB, target } = {}) {
  if (!tix) return { place: false, withH: null, withoutH: null, rEff: null, why: 'no TIX API access (Source-File 8 or BitNode 8, or bought)' }
  if (!fin(wealth) || !fin(incomePerSec) || incomePerSec < 0 || !fin(fleetGB) || !(fleetGB > 0) || !fin(traderGB) || !(traderGB > 0) || !fin(target)) return { place: false, withH: null, withoutH: null, rEff: null, why: 'unpriced: wealth, fleet income, fleet size, trader RAM or milestone unreadable' }
  const rEff = fin(r) && r > 0 && wealth > floor ? r * (1 - floor / wealth) : 0
  const I0 = incomePerSec
  const I1 = incomePerSec * Math.max(0, 1 - traderGB / fleetGB)
  const need = Math.max(0, target - wealth)
  const withoutH = need === 0 ? 0 : I0 > 0 ? need / I0 / 3600 : Infinity
  const at = (tS) => (rEff > 0 ? wealth * Math.exp(rEff * tS) + (I1 * (Math.exp(rEff * tS) - 1)) / rEff : wealth + I1 * tS)
  let withH
  if (need === 0) withH = 0
  else if (at(48 * 3600) < target) withH = Infinity
  else {
    let lo = 0, hi = 48 * 3600
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2
      if (at(mid) >= target) hi = mid
      else lo = mid
    }
    withH = hi / 3600
  }
  const place = withH < withoutH - 1 / 60
  const f = (h) => (isFinite(h) ? `${h.toFixed(2)}h` : 'never (48h)')
  return { place, withH, withoutH, rEff, why: `next milestone $${Math.round(target)}: ${f(withH)} with the trader (r ${(rEff * 3600 * 100).toFixed(0)}%/h at $${Math.round(wealth)}, the fleet ${(100 * (1 - I1 / (I0 || 1))).toFixed(0)}% smaller) vs ${f(withoutH)} with every GB farming` }
}

/**
 * THE STACK'S HOME TIER, read from boot.js's own deferrals: the home size at
 * which the entries that SUPERVISE and PLAN (watchdog, progress, homeup) fit
 * next to what boot already placed. Each deferral says "needs XGB, only YGB
 * of home is left"; the tier is the next power of two >= home - Y + sum(X).
 * Live BN1 2026-09-27: 64GB home, 0.2GB left, watchdog 8.95 + progress 2.6 +
 * homeup 7.6 -> 128GB. Null when boot defers none of them.
 */
export const BOOTSTRAP_STACK = ['watchdog.js', 'progress.js', 'homeup.js']
export function stackTierFromBoot(boot, homeRam) {
  if (!boot || !Array.isArray(boot.defer) || !fin(homeRam)) return null
  let need = 0
  let left = null
  for (const d of boot.defer) {
    if (!BOOTSTRAP_STACK.includes(d?.script)) continue
    const m = String(d.why ?? '').match(/needs ([\d.]+)GB, only ([\d.]+)GB of home is left/)
    if (!m) continue
    need += Number(m[1])
    left = left === null ? Number(m[2]) : Math.min(left, Number(m[2]))
  }
  if (!(need > 0) || left === null) return null
  // The defers were measured against boot's OWN home size: a record from a
  // smaller home (boot has not re-run since a purchase) still names the tier
  // it needed, and a bigger current home satisfies it.
  const at = fin(boot.homeRam) && boot.homeRam > 0 ? boot.homeRam : homeRam
  const want = at - left + need
  let tier = at
  while (tier < want) tier *= 2
  return tier
}

/**
 * BOOTSTRAP-REQUIRED HOME RAM. With no planner verdict this life (progress.js
 * deferred, spendExit absent or stale) and home below the stack's tier,
 * nothing can approve a home purchase — and nothing else buys it: live BN1
 * 2026-09-27 home sat at 64GB for 2.6h while the trader grew $20m -> $456m.
 * Then the next RAM tier is a REQUIRED purchase, independent of the exit;
 * once the planner publishes, its verdict governs.
 * Returns {required, step: 'buy' | 'raise-buy' | 'wait' | null, cost, why}.
 */
export function bootstrapHomeStep({ homeRam, boot, gate, lastAugReset, now = Date.now(), cash, equity = 0, ramCost } = {}) {
  const tier = stackTierFromBoot(boot, homeRam)
  const se = gate?.spendExit
  const plannerFresh = !!se && gate?.lastAugReset === lastAugReset && now - Date.parse(se.at ?? '') < 15 * 60e3
  if (plannerFresh) return { required: false, step: null, cost: null, why: 'the planner publishes a verdict this life: it governs home purchases' }
  if (tier === null || !(homeRam < tier)) return { required: false, step: null, cost: null, why: tier === null ? 'boot defers none of the stack' : `home ${homeRam}GB is at the stack's tier` }
  if (!fin(ramCost) || !(ramCost > 0)) return { required: true, step: null, cost: null, why: 'next home RAM price unreadable' }
  const base = `bootstrap: home ${homeRam}GB is below the ${tier}GB the stack needs (boot defers ${BOOTSTRAP_STACK.join('/')}) and no planner verdict exists this life`
  if (fin(cash) && cash >= ramCost) return { required: true, step: 'buy', cost: ramCost, tier, why: `${base} — buying the next RAM tier ($${Math.round(ramCost)})` }
  if (batchFits(cash, equity, ramCost)) return { required: true, step: 'raise-buy', cost: ramCost, tier, why: `${base} — raising $${Math.round(ramCost * (1 + RAISE_MARGIN))} from the book for the next RAM tier` }
  return { required: true, step: 'wait', cost: ramCost, tier, why: `${base} — $${Math.round(ramCost)} not yet covered by cash + book` }
}

/**
 * THE BATCH'S CASH, raised from the book in front of its first costed order:
 * a liquidate('raise', target) whose target is the absolute cash balance the
 * batch needs (its costs plus `margin` for the sale's spread).
 *
 * CASH IN HAND AT PLAN TIME IS NOT CASH AT ACT TIME. A pre-4S trader cycles
 * the WHOLE book between cash and positions within minutes (live BN9
 * 2026-09-29: $100.0b cash at 23:34:41, $0.8m at 23:32:54). The planner read
 * a cash phase at 23:28:59, ordered a $540m graft with no raise because cash
 * covered it, and 10s later the trader had re-invested: the graft was
 * refused "money short: $706837 of $540000000" with $98b in the book. So
 * while a trader holds or may hold a book (`trader`, default: equity > 0) a
 * costed batch ALWAYS carries the raise: when cash already covers it the
 * actor sells nothing, but the ordered raise is what makes stock.js hold that
 * cash (dueRaiseOf) from this write until act.js runs, and act-liquidate's
 * hold keeps it from re-opening until the batch has spent it.
 * Without a book (and no trader) there is nothing to sell or to race.
 */
export function withCashRaise(orders, cash, equity, { margin = 0.02, trader = equity > 0 } = {}) {
  if (!Array.isArray(orders)) return orders
  const costOf = (o) => (fin(o?.cost) && o.cost > 0 ? o.cost : o?.kind === 'travel' ? TRAVEL_FARE : 0)
  const first = orders.findIndex((o) => costOf(o) > 0)
  if (first < 0 || orders.some((o) => o.kind === 'liquidate')) return orders
  const total = orders.reduce((a, o) => a + costOf(o), 0)
  const covered = fin(cash) && cash >= total
  if (covered ? !trader : !(equity > 0)) return orders
  // Covered: never ask above the cash in hand for the margin alone — with no
  // book behind it act-liquidate would refuse an unreachable target.
  const target = covered ? Math.min(Math.ceil(total * (1 + margin)), Math.max(Math.ceil(total), Math.floor(cash))) : Math.ceil(total * (1 + margin))
  const why = covered
    ? `hold $${target} cash for this batch ($${Math.round(total)} of orders; $${Math.round(cash)} in hand now, but the trader re-invests cash between this pass and act.js — the raise sells only what it moved)`
    : `raise $${target} cash from the stock book for this batch ($${Math.round(total)} of orders, $${Math.round(cash ?? 0)} in hand)`
  return [...orders.slice(0, first), { id: 0, kind: 'liquidate', args: ['raise', target], why }, ...orders.slice(first)]
}

/**
 * THE TRADER'S RETURN ACROSS LIVES, as the exit simulation needs it: a
 * steady-state rate r and a warm-up w after every install during which the
 * book earns nothing net — the pre-4S estimator relearns from scratch when an
 * install re-initialises the market (Prestige.ts:166-170), and cash raises
 * and holds cost it more. Live 2026-09-25: a 6.14h life grew $250m -> $63.5b;
 * the next two (0.24h, 0.58h) grew nothing, so installing every 35 minutes
 * threw the capital away, and the simulation — fed the young life's own
 * instantaneous return (negative, clamped to 0) — agreed that money never
 * grows and kept installing.
 *
 * Model per life: ln(end/start) = r x (T - w). With two or more lives of
 * different length it is a least-squares line in T (slope r, intercept
 * -r w); with one it takes r from the trader's modelled steady rate
 * (`steadyPerSec`, stock.txt calibration.predictedPerSec) and solves w.
 * lives: [{lifeH, start, end}] (capital at life start and at its install).
 * Returns {r (per s), warmupH, n, why} or null.
 */
/**
 * THE TRADER'S REALISED RETURN, from its own history (/tel/stock-hist.txt,
 * one row per 10 ticks: {t, wealth, lifePnl, externalFlows}). Each run of
 * stock.js is a segment (t restarts); within it the growth index is
 * sum ln(1 + dPnl / wealth) over intervals with NO external flow (within
 * FLOW_TOL_FRAC), on a clock that runs only over those intervals — so a
 * purchase, a raise or the pre-install liquidation neither counts as a loss,
 * inflates the base, nor dilutes the rate with time it was not measured on. Pooled over every
 * segment seen from its start (t0 small), least squares of
 * index = r (T - w), T the trader's own clock (t x 6s per market update,
 * StockMarket/data/Constants.ts:4 msPerStockUpdate — a page freeze stops it).
 *
 * Why not the lifetimes ledger (fitCapital): its capEnd is cash + equity at
 * the install, AFTER the batch spent the raised cash. Live 2026-09-26 02:08 a
 * life that traded +$321m on $250m read as +$105m, the fit fell to 3.4e-5/s
 * and the published exit jumped 113h -> 159h. This history read 1.78e-4/s
 * with a 0.11h warm-up over the same lives.
 * Returns {r, warmupH, segments, points, hours, why} or null.
 */
export const STOCK_HIST_FILE = '/tel/stock-hist.txt'
export const STOCK_TICK_S = 6
/**
 * AN INTERVAL WITH A NEGLIGIBLE FLOW STILL MEASURES THE RETURN. lifePnl is
 * flow-free by construction (stock.js telescopes the market move on its own
 * book), so a flow only matters through the capital base, a.wealth. The rule
 * was "no flow at all", right for BitNode 8's lumpy purchases, but in
 * BitNode 9 hacknet and contract money land in cash every row (+$33m a
 * minute on a $95b book), so EVERY interval was refused and neither this fit
 * nor bayes.traderPosterior ever existed there (live 2026-09-29: both null
 * over 357 rows; the exit ran on the last hour's noisy point instead). A
 * flow within FLOW_TOL_FRAC of the base moves the return by at most that
 * fraction of itself; a purchase or raise larger than that is still refused.
 * bayes.js carries the same constant (it imports nothing): [SI4] pins them.
 */
export const FLOW_TOL_FRAC = 0.02
export function flowNegligible(a, b) {
  if (!(fin(a?.wealth) && a.wealth > 0)) return false
  if (a.externalFlows === b.externalFlows) return true
  return fin(a.externalFlows) && fin(b.externalFlows) && Math.abs(b.externalFlows - a.externalFlows) <= FLOW_TOL_FRAC * a.wealth
}
export function realisedCapital(rows, { maxStartTicks = 150, minPoints = 8 } = {}) {
  if (!Array.isArray(rows) || rows.length < 2) return null
  const segs = []
  let cur = null
  for (const r of rows) {
    if (!(fin(r?.t) && fin(r?.wealth) && fin(r?.lifePnl))) continue
    if (!cur || r.t < cur[cur.length - 1].t) {
      cur = []
      segs.push(cur)
    }
    cur.push(r)
  }
  const pts = []
  let used = 0
  let hours = 0
  for (const s of segs) {
    if (s.length < 2 || s[0].t > maxStartTicks) continue // not seen from its start: its index has no origin
    used++
    // The first row: growth since the run began (no flow yet, or the flow is
    // the raise the run opened with — then start from 0 at that row).
    const S = s[0].wealth - s[0].lifePnl
    let y = fin(s[0].externalFlows) && s[0].externalFlows === 0 && S > 0 && s[0].wealth > 0 ? Math.log(s[0].wealth / S) : 0
    pts.push({ T: s[0].t * STOCK_TICK_S, y })
    // THE INDEX AND ITS CLOCK MOVE TOGETHER. A flowed interval is skipped
    // from the index, and it used to stay on the clock: the fit then read
    // (growth over flow-free intervals) / (ALL elapsed time). In BitNode 9,
    // where hacknet cash lands every row and is large against a young book,
    // most intervals were skipped and the slope collapsed (live 2026-09-29
    // 08:50Z: 0.6%/h against 61-87%/h on the flow-free intervals of the same
    // hours; that read discarded the node's 29-graft set). A skipped interval
    // now leaves the clock too — the rate over the time it was measured on,
    // as bayes.traderPosterior has always taken it. (Not measured on a
    // flow-adjusted base instead: a sale the trader books as a flow moves
    // lifePnl with the flow, so a flowed interval's dPnl is not a return.)
    let skipS = 0
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1]
      const b = s[i]
      const g = flowNegligible(a, b) ? 1 + (b.lifePnl - a.lifePnl) / a.wealth : null
      if (!(g > 0)) {
        skipS += Math.max(0, (b.t - a.t) * STOCK_TICK_S)
        continue
      }
      y += Math.log(g)
      pts.push({ T: b.t * STOCK_TICK_S - skipS, y })
    }
    hours += (s[s.length - 1].t * STOCK_TICK_S) / 3600
  }
  if (pts.length < minPoints || used < 1) return null
  const n = pts.length
  const mT = pts.reduce((a, p) => a + p.T, 0) / n
  const mY = pts.reduce((a, p) => a + p.y, 0) / n
  const sxx = pts.reduce((a, p) => a + (p.T - mT) ** 2, 0)
  const sxy = pts.reduce((a, p) => a + (p.T - mT) * (p.y - mY), 0)
  if (!(sxx > 0)) return null
  const r = sxy / sxx
  if (!(r > 0)) return null
  const w = Math.max(0, (r * mT - mY) / r)
  return { r, warmupH: w / 3600, segments: used, points: n, hours: +hours.toFixed(2), why: `realised: ${used} trader run(s) from their start, ${n} points over ${hours.toFixed(1)}h of market ticks — growth index = r(T - w), flows excluded` }
}

/**
 * EXIT FORECAST CALIBRATION. A projected exit that is right falls by one hour
 * per hour of wall time while the plan is followed (predicted drift -1 h/h).
 * `samples` [{at, exitH, life}] oldest first; pairs within one life (an
 * install legitimately re-plans) at least `minGapH` apart give the realised
 * drift. errPerH is the median |realised - predicted|: the forecast error per
 * hour of waiting, which is the tolerance a simulated wait must beat.
 * Returns {predictedPerH, realisedPerH, errPerH, pairs, why}.
 */
export function exitDrift(samples, { minGapH = 0.2, minPairs = 3 } = {}) {
  const S = (samples ?? []).filter((x) => fin(x?.exitH) && fin(Date.parse(x?.at)))
  const pairs = []
  for (let i = 1; i < S.length; i++) {
    const a = S[i - 1]
    const b = S[i]
    if (a.life !== b.life) continue
    const dh = (Date.parse(b.at) - Date.parse(a.at)) / 3.6e6
    if (!(dh >= minGapH)) continue
    pairs.push({ dh, drift: (b.exitH - a.exitH) / dh })
  }
  if (pairs.length < minPairs) return { predictedPerH: -1, realisedPerH: null, errPerH: null, pairs: pairs.length, why: `${pairs.length} same-life pair(s) at least ${minGapH}h apart (need ${minPairs})` }
  const wsum = pairs.reduce((a, p) => a + p.dh, 0)
  const realised = pairs.reduce((a, p) => a + p.drift * p.dh, 0) / wsum
  // MEDIAN absolute error, not RMS: one re-fit of a model input (a single
  // pass moved the exit 48h) would otherwise set the tolerance for hours.
  const errs = pairs.map((p) => Math.abs(p.drift + 1)).sort((x, y) => x - y)
  const err = errs.length % 2 ? errs[(errs.length - 1) / 2] : (errs[errs.length / 2 - 1] + errs[errs.length / 2]) / 2
  return { predictedPerH: -1, realisedPerH: +realised.toFixed(3), errPerH: +err.toFixed(3), pairs: pairs.length, why: `over ${pairs.length} same-life pairs (${wsum.toFixed(1)}h): the exit moved ${realised.toFixed(2)}h per hour against -1 predicted` }
}

/** Unmeasured forecast error: a wait must beat installing now by half its own length. */
export const EXIT_TOL_PRIOR_PER_H = 0.5

export function fitCapital(lives, steadyPerSec = null) {
  const pts = (lives ?? []).filter((l) => fin(l?.lifeH) && l.lifeH > 0 && fin(l?.start) && l.start > 0 && fin(l?.end) && l.end > 0).map((l) => ({ T: l.lifeH * 3600, y: Math.log(l.end / l.start) }))
  if (!pts.length) return null
  const Ts = new Set(pts.map((p) => Math.round(p.T)))
  if (pts.length >= 2 && Ts.size >= 2) {
    const n = pts.length
    const mT = pts.reduce((a, p) => a + p.T, 0) / n
    const mY = pts.reduce((a, p) => a + p.y, 0) / n
    const sxx = pts.reduce((a, p) => a + (p.T - mT) ** 2, 0)
    const sxy = pts.reduce((a, p) => a + (p.T - mT) * (p.y - mY), 0)
    const r = sxy / sxx
    if (r > 0) {
      const w = Math.max(0, (r * mT - mY) / r)
      return { r, warmupH: w / 3600, n, why: `fitted over ${n} lives: ln(end/start) = r(T - w)` }
    }
  }
  if (fin(steadyPerSec) && steadyPerSec > 0) {
    const best = pts.reduce((a, p) => (p.T > a.T ? p : a))
    const w = Math.max(0, best.T - Math.max(0, best.y) / steadyPerSec)
    return { r: steadyPerSec, warmupH: w / 3600, n: pts.length, why: `steady rate from the trader's model, warm-up solved from the longest life (${(best.T / 3600).toFixed(2)}h)` }
  }
  return null
}

// ---------------------------------------------------------------------------
// WEALTH, NOT CASH. "What can we afford" is cash + the trader's equity.
//
// Where stock.js holds the book (BitNode 8, and any node with TIX access) it
// keeps every dollar no claim holds invested, so cash reads ~$0-$80k while
// the run is worth billions. A gate that asks "can we afford X?" of cash
// alone starves (2026-09-25: no plan, no install for 5.8h). So:
//
//   PRICING / AFFORDABILITY   wealthOf(cash, stock) — cash + equity. With no
//                             trader record (no TIX, stale, other life) the
//                             equity is 0 and wealth IS cash: behaviour in a
//                             node without a trader is unchanged.
//   THE PURCHASE ITSELF       still needs cash, so it is preceded by a sized
//                             raise: an order `cost` (withCashRaise, progress
//                             batches) or a RAISE REQUEST (below) that act.js
//                             serves with act-liquidate.js raise X.
//
// A raise is NOT free: every sale pays StockMarketCommission, sells at the
// bid, and the hold it writes stops the trader compounding until released.
// So requests are rate-limited (RAISE_COOLDOWN_MS) and only PRICED spends
// (an exit verdict, a plan) request one — an unpriced surplus rule never
// sells the book.
// ---------------------------------------------------------------------------

/**
 * cash + the trader's equity (stockRecordOf's `equity`, counted only when the
 * record is ok). null when cash itself is unreadable — never a silent 0.
 */
export function wealthOf(cash, stock) {
  if (!fin(cash)) return null
  return cash + (stock?.ok && fin(stock.equity) && stock.equity > 0 ? stock.equity : 0)
}

/** stockRecordOf from the raw /tel/stock.txt TEXT (ns.read is 0GB); malformed reads as no record. */
export function stockRecordFromText(text, lastAugReset, now = Date.now()) {
  let rec = null
  try {
    rec = JSON.parse(text || 'null')
  } catch {
    rec = null
  }
  return stockRecordOf(rec, lastAugReset, now)
}

/**
 * RAISE REQUESTS — how a spender that is not a progress.js order gets cash.
 * One file per requester (/tel/raise/<by>.txt on home) so two spenders never
 * overwrite each other: {at, lastAugReset, by, target, why}. `target` is the
 * CASH BALANCE the purchase needs (its cost plus whatever the spender must
 * leave untouched) — the absolute form act-liquidate.js `raise` takes.
 */
export const RAISE_DIR = '/tel/raise/'
export const RAISE_REQUESTERS = ['sleeve', 'sleeveaug', 'gang', 'buyserv', 'hacknet']
export const RAISE_FRESH_MS = 3 * 60e3
export const RAISE_COOLDOWN_MS = 5 * 60e3
/** How long act.js leaves a served raise's hold standing: the requester's next loop spends the cash. */
export const RAISE_HOLD_MS = 2 * 60e3
export const raiseFileOf = (by) => `${RAISE_DIR}${by}.txt`

/**
 * The request a spender publishes, or null when none is needed or possible:
 * cash already covers `target`; nothing is invested; or wealth does not cover
 * it either (selling the book cannot fund it — the purchase is simply not
 * affordable, which the caller reports).
 */
export function raiseRequestFor({ cash, equity, target, by, why, lastAugReset, now = Date.now(), margin = 0.02 }) {
  if (!fin(cash) || !fin(target) || !(target > 0) || !(equity > 0)) return null
  if (cash >= target) return null
  const t = Math.ceil(target * (1 + margin))
  if (cash + equity < t) return null
  return { at: new Date(now).toISOString(), lastAugReset, by, target: t, why: String(why ?? '') }
}

/**
 * Which request act.js serves this pass: {serve: req|null, why}. Fresh, this
 * life, a known requester, still short of cash, fundable from equity, and no
 * raise served inside the cooldown. The largest target wins — the same sale
 * covers the smaller ones.
 */
export function raiseToServe(reqs, { cash, equity, lastAugReset, lastServedAt = 0, now = Date.now() }) {
  if (now - lastServedAt < RAISE_COOLDOWN_MS) return { serve: null, why: `a raise was served ${Math.round((now - lastServedAt) / 1000)}s ago (cooldown ${RAISE_COOLDOWN_MS / 1000}s — every sale pays commission and pauses the book)` }
  if (!fin(cash)) return { serve: null, why: 'cash unreadable' }
  const age = (r) => now - Date.parse(r?.at ?? '')
  const live = (reqs ?? []).filter((r) => r && RAISE_REQUESTERS.includes(r.by) && r.lastAugReset === lastAugReset && age(r) >= 0 && age(r) < RAISE_FRESH_MS && fin(r.target) && r.target > cash)
  if (!live.length) return { serve: null, why: 'no fresh request short of cash' }
  const best = live.sort((a, b) => b.target - a.target)[0]
  if (!(equity > 0) || cash + equity < best.target) return { serve: null, why: `${best.by} wants $${Math.round(best.target)} and cash + equity is $${Math.round(cash + (equity > 0 ? equity : 0))} — not fundable` }
  return { serve: best, why: `${best.by}: ${best.why}` }
}

// ---------------------------------------------------------------------------
// NEGATIVE CASH — THE SOFTLOCK ESCAPE (act.js runs it every pass).
//
// Class and gym fees are the only unchecked sinks (MONEY THAT LEAVES EVERY
// SECOND, above). Selling stock needs no balance (StockMarket/
// BuyingAndSelling.tsx sellStock: no money check before Player.gainMoney),
// so cash < 0 with equity > 0 is recoverable. cash + equity <= 0 with nothing
// earning is not: 2026-09-25, sleeves at ZB drained a liquidated book to
// -$2.4m and the life had to be soft-reset by hand. Escalating:
//
//   1 'stop'   cash < 0 AND the class's debt is not one the planner priced
//              and income repays: the player's class or gym stops
//              (act-stop.js) when (a) it runs past the floor progress.js
//              priced for it (`credit`, bodyplan.combatBarPlanOf's credit
//              trajectory) by more than FEE_FLOOR_S of its fee, (b) nothing
//              earns — the balance's slope plus the fee is <= 0 over
//              SOFTLOCK_GAP_MS — or (c) no priced credit and the debt grows
//              over SOFTLOCK_GAP_MS. A NEGATIVE BALANCE ALONE IS NOT A
//              SOFTLOCK: the game only refuses purchases and travel below
//              zero (Player.canAfford, PlayerObjectGeneralMethods.ts:236; no
//              interest), and stopping a priced gym on the sign left the body
//              slot idle (BN12 2026-10-09 01:45Z, BN13 2026-10-11 02:56Z).
//              Sleeves refuse fees on their own cash floor (sleeveplan
//              feeFundable on cash). Every node.
//   2 'raise'  cash < 0 and equity > 0: ONE raise to NEG_CASH_TARGET, at most
//              once per NEG_RAISE_COOLDOWN_MS (the trader deliberately does
//              not chase negative cash). Every node.
//   3 reset    wealth <= 0, a FRESH trader record showing NO book, cash not
//              rising, held across >= SOFTLOCK_MIN_SAMPLES checks at least
//              SOFTLOCK_GAP_MS apart: install if augmentations are queued,
//              else soft reset. IRREVERSIBLE, so only where money is capital
//              (ScriptHackMoneyGain 0), never while /softlock-hold.txt exists,
//              and the evidence is written (SOFTLOCK_FILE) before the act.
// ---------------------------------------------------------------------------
/** Cash the escape raises to: 120s (FEE_FLOOR_S) of the worst fleet drain seen (five sleeves at ZB, ~$8k/s). */
export const NEG_CASH_TARGET = 1e6
export const NEG_RAISE_COOLDOWN_MS = 10 * 60e3
export const SOFTLOCK_GAP_MS = 2 * 60e3
export const SOFTLOCK_MIN_SAMPLES = 2
export const SOFTLOCK_FILE = '/tel/softlock.txt'
export const SOFTLOCK_HOLD_FILE = '/softlock-hold.txt'

/**
 * One step of the escape. Pure.
 *   cash; stock (stockRecordOf); work ({type, classType}: snap-rep's
 *   getCurrentWork, or null); queued (augmentations bought and not installed,
 *   null = unknown); hackPays (ScriptHackMoneyGain); hold (the text of
 *   /softlock-hold.txt, '' when absent); samples ([{at, cash, wealth}] carried
 *   from earlier passes); lastRaiseAt; now.
 *   workAt (ms: when `work` was read) and startedAt (ms: when act.js last
 *   started work): a read OLDER than the last start describes the work that
 *   start replaced, so it stops nothing — the snapshot is up to a minute old,
 *   and a CLASS it still showed stopped the free crime act.js had just put in
 *   the class's place (the stalled-Bladeburner lend, actplan.bladeLend).
 * Returns {level, actions: [{kind: 'stop'|'raise'|'install'|'softreset', why,
 *   target?}], samples (carry to the next pass), why}.
 */
export function softlockStep({ cash, stock, work = null, workAt = null, startedAt = null, queued = null, hackPays = null, hold = '', samples = [], lastRaiseAt = 0, credit = null, trend = [], now = Date.now() }) {
  if (!fin(cash)) return { level: null, actions: [], samples: [], trend: [], why: 'cash unreadable — nothing decided' }
  if (cash >= 0) return { level: 0, actions: [], samples: [], trend: [], why: null }
  const equity = stock?.ok && fin(stock.equity) ? stock.equity : 0
  const wealth = cash + equity
  const actions = []
  const why = [`cash $${Math.round(cash)} < 0`]
  // THE DEBT'S TREND while cash is negative: the first sample since the
  // balance went below zero (or since act.js last started work) and now.
  const t0 = (trend ?? []).find((x) => fin(x?.cash) && fin(Date.parse(x?.at)) && !(fin(startedAt) && Date.parse(x.at) < startedAt)) ?? null
  const trendOut = t0 ? [t0, { at: new Date(now).toISOString(), cash }] : [{ at: new Date(now).toISOString(), cash }]
  const dt = t0 ? (now - Date.parse(t0.at)) / 1000 : 0
  const slope = t0 && dt * 1000 >= SOFTLOCK_GAP_MS ? (cash - t0.cash) / dt : null
  const res = (o) => ({ ...o, trend: trendOut })
  let classRuns = false
  if (work && String(work.type ?? '').toUpperCase() === 'CLASS') {
    const v = classDebtVerdict({ cash, credit, slope })
    if (fin(workAt) && fin(startedAt) && workAt < startedAt) why.push(`the paid class (${work.classType ?? '?'}) was read before act.js last started work (${new Date(startedAt).toISOString()}) — not stopping what replaced it`)
    else if (v.stop) actions.push({ kind: 'stop', why: `cash $${Math.round(cash)} < 0 in a paid class (${work.classType ?? '?'}): ${v.why}` })
    else {
      classRuns = true
      why.push(`the paid class (${work.classType ?? '?'}) runs on: ${v.why}`)
    }
  }
  if (equity > 0) {
    if (now - lastRaiseAt >= NEG_RAISE_COOLDOWN_MS) actions.push({ kind: 'raise', target: NEG_CASH_TARGET, why: `cash $${Math.round(cash)} < 0 with $${Math.round(equity)} of equity: raise to $${NEG_CASH_TARGET}` })
    else why.push(`a negative-cash raise was served ${Math.round((now - lastRaiseAt) / 1000)}s ago (cooldown ${NEG_RAISE_COOLDOWN_MS / 1000}s)`)
    return res({ level: 2, actions, samples: [], why: why.join('; ') })
  }
  // Level 3 needs POSITIVE evidence of no book: a stale or absent record is
  // unknown, and unknown never licenses an irreversible act.
  if (!(stock?.ok && equity === 0)) return res({ level: 1, actions, samples: [], why: `${why.join('; ')}; no fresh trader record (${stock?.why ?? 'none'}) — a reset needs positive evidence that no book exists` })
  if (!(wealth <= 0)) return res({ level: 1, actions, samples: [], why: why.join('; ') })
  // A debt the class runs on purpose (priced, or repaid) is not a softlock.
  if (classRuns) return res({ level: 1, actions, samples: [], why: `${why.join('; ')} — no reset while it runs` })
  const prev = (samples ?? []).filter((s) => fin(s?.cash) && fin(Date.parse(s?.at)))
  if (prev.length && cash > prev[0].cash) return res({ level: 1, actions, samples: [], why: `${why.join('; ')}; cash rising ($${Math.round(prev[0].cash)} -> $${Math.round(cash)}) — something earns, no reset` })
  const last = prev[prev.length - 1]
  const kept = (last && now - Date.parse(last.at) < SOFTLOCK_GAP_MS ? prev : [...prev, { at: new Date(now).toISOString(), cash, wealth }]).slice(-4)
  const base = `${why.join('; ')}; wealth $${Math.round(wealth)} <= 0, no book, cash not rising`
  if (hackPays !== 0) return res({ level: 1, actions, samples: kept, why: `${base} — but money is not capital here (ScriptHackMoneyGain ${hackPays}): no reset` })
  if (hold) return res({ level: 3, actions, samples: kept, why: `${base} — SOFTLOCK, held by ${SOFTLOCK_HOLD_FILE}: ${String(hold).slice(0, 120)}` })
  if (kept.length < SOFTLOCK_MIN_SAMPLES) return res({ level: 3, actions, samples: kept, why: `${base} — sample ${kept.length} of ${SOFTLOCK_MIN_SAMPLES} (>= ${SOFTLOCK_GAP_MS / 1000}s apart) before acting` })
  if (!fin(queued)) return res({ level: 3, actions, samples: kept, why: `${base} — SOFTLOCK, but the queued-augmentation count is unreadable: not choosing install vs reset blind` })
  actions.push(queued > 0 ? { kind: 'install', why: `softlock over ${kept.length} samples: ${base}; ${queued} augmentation(s) queued — install` } : { kind: 'softreset', why: `softlock over ${kept.length} samples: ${base}; nothing queued — soft reset` })
  return res({ level: 3, actions, samples: kept, why: base })
}

/**
 * WHETHER A PAID CLASS RUNNING ON A NEGATIVE BALANCE IS STOPPED (softlockStep
 * level 1). cash < 0; credit: progress.js's priced debt for the body leg
 * ({floor, feePerSec}, slot.credit, this life) or null; slope: $/s of the
 * balance over >= SOFTLOCK_GAP_MS, or null while unmeasured. {stop, why}.
 */
export function classDebtVerdict({ cash, credit = null, slope = null }) {
  const $ = (x) => `$${Math.round(x)}`
  const priced = credit && fin(credit.floor) && fin(credit.feePerSec)
  if (priced) {
    const limit = credit.floor - credit.feePerSec * FEE_FLOOR_S
    if (cash < limit) return { stop: true, why: `past the priced floor (${$(credit.floor)}, less ${FEE_FLOOR_S}s of the ${$(credit.feePerSec)}/s fee = ${$(limit)}) — the plan's income did not arrive` }
    if (fin(slope) && slope + credit.feePerSec <= 0) return { stop: true, why: `nothing earns: the balance moves ${$(slope)}/s against a ${$(credit.feePerSec)}/s fee — the debt is never repaid` }
    return { stop: false, why: `a debt progress.js priced (floor ${$(credit.floor)}${fin(credit.debtH) ? `, ${credit.debtH}h to repay` : ''})${fin(slope) ? `; balance ${$(slope)}/s` : ''}` }
  }
  if (!fin(slope)) return { stop: false, why: `no priced credit; measuring the debt's trend for ${SOFTLOCK_GAP_MS / 1000}s first (a negative balance only blocks purchases and travel)` }
  if (slope < 0) return { stop: true, why: `an unpriced debt growing ${$(-slope)}/s — no plan repays it` }
  return { stop: false, why: `no priced credit, but income repays the debt (${$(slope)}/s)` }
}

/**
 * WHY THE COMMITTED GRAFT IS NOT RUNNING, for the healthcheck's ORDER NOT
 * HELD detail: the graft's order, its raise, and what act.js did with them.
 * orders: /tel/orders.txt; act: /tel/act.txt; progress: /tel/progress.txt.
 * Returns one sentence (never null: "no graft order found" is itself a cause).
 */
export function graftHoldCauseOf({ orders, act, progress } = {}) {
  const $ = (x) => `$${fin(x) ? Math.round(x).toLocaleString('en-US') : '?'}`
  const list = Array.isArray(orders?.orders) ? orders.orders : []
  const graft = list.find((o) => o?.kind === 'graft')
  const raise = list.find((o) => o?.kind === 'liquidate' && o.args?.[0] === 'raise')
  const ran = act?.orders?.at ?? null
  // Ordered and not yet executed: act.js has not reached this batch.
  if (graft && orders?.at && !(ran && ran >= orders.at)) {
    return raise ? `graft ${graft.args?.[0]} waiting on a raise of ${$(raise.args[1])} (batch ${orders.at}, not yet run by act.js)` : `graft ${graft.args?.[0]} ordered ${orders.at} (${$(graft.cost)}), not yet run by act.js — and the batch carries NO raise`
  }
  const results = Array.isArray(act?.orders?.results) ? act.orders.results : []
  const g = results.find((r) => r?.kind === 'graft')
  const l = results.find((r) => r?.kind === 'liquidate')
  if (g) {
    const at = `batch ${act.orders.at}`
    if (l && l.ok !== true) return `raise refused because ${String(l.result?.error ?? l.why ?? 'the liquidate actor did not confirm the cash').slice(0, 200)} (${at}; graft ${g.args?.[0] ?? '?'} ${g.skipped ? 'skipped' : 'not started'})`
    if (g.skipped) return `graft ${g.args?.[0] ?? '?'} skipped: ${String(g.skipped).slice(0, 200)} (${at})`
    if (g.ok !== true) {
      const why = g.result?.refused ?? g.result?.error ?? g.why ?? 'not ok'
      const funding = l ? `after a raise to ${$(l.result?.target)} (cash then ${$(l.result?.cash)})` : 'the batch carried NO raise from the book'
      return `graft ${g.args?.[0] ?? '?'} refused by the game: ${String(why).slice(0, 160)} — ${funding} (${at})`
    }
  }
  const waits = (Array.isArray(progress?.did) ? progress.did : []).find((d) => /^graft .* waits for /.test(String(d)))
  if (waits) return String(waits).slice(0, 240)
  return g?.ok === true ? `graft ${g.args?.[0] ?? '?'} started (${act.orders.at}) but the game is not grafting now` : 'no graft order found in /tel/orders.txt or act.js results'
}

/**
 * Healthcheck section F 'WEALTH NEGATIVE': cash + equity < 0 now, or cash < 0
 * in this sample AND the previous one. {cash, equity} per sample. Returns the
 * failure lines (empty = pass; an unreadable cash is not a pass here — the
 * caller's own unreadable-state check owns that).
 */
export function wealthNegativeCheck(nowS, prevS) {
  const out = []
  if (!fin(nowS?.cash)) return out
  const eq = fin(nowS.equity) ? nowS.equity : 0
  const w = nowS.cash + eq
  if (w < 0) out.push(`WEALTH NEGATIVE: cash $${Math.round(nowS.cash)} + equity $${Math.round(eq)} = $${Math.round(w)} — a softlock unless something is earning`)
  if (nowS.cash < 0 && fin(prevS?.cash) && prevS.cash < 0) out.push(`WEALTH NEGATIVE: cash below zero in two samples ($${Math.round(prevS.cash)} -> $${Math.round(nowS.cash)}) — an unchecked fee is draining it and nothing raised it back`)
  return out
}

/**
 * THE TRADER'S FEE RESERVE (stock.js). Cash the trader keeps uninvested
 * against money that leaves between its ticks with no balance check — class
 * and gym fees. MEASURED, not declared: `flows` are the per-second external
 * cash changes it observed between ticks (cash at a tick's start minus cash
 * after the previous tick's own trades, over the interval). The MEDIAN is the
 * steady drain: a lumpy purchase (an aug, a raise spent) moves a tick or two
 * and cannot move the median; hacking income makes it positive, and then no
 * reserve is kept (income covers the fees). Reserve = drain x FEE_FLOOR_S.
 * Without it the trader reinvested every fee raise at the hold's release and
 * cash ran negative mid-leg.
 */
export function feeReserveOf(flows, seconds = FEE_FLOOR_S, minSamples = 5) {
  const xs = (flows ?? []).filter(fin)
  if (xs.length < minSamples) return { drainPerSec: 0, reserve: 0, n: xs.length }
  const s = [...xs].sort((a, b) => a - b)
  const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
  const drainPerSec = med < 0 ? -med : 0
  return { drainPerSec, reserve: Math.ceil(drainPerSec * seconds), n: xs.length }
}
