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
  const none = (why) => ({ ok: false, equity: 0, returnPerSec: null, capitalCap: null, incomePerSec: null, manip: null, manipCurve: null, why })
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
    manip,
    manipCurve: Array.isArray(rec.manipCurve) ? rec.manipCurve.filter((x) => fin(x?.nudgesPerSec) && x.nudgesPerSec >= 0 && fin(x?.returnPerSec)) : null,
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

export function incomeOf({ scriptIncome, mults, stock, hacknet } = {}) {
  const now = fin(scriptIncome?.[0]) && scriptIncome[0] > 0 ? scriptIncome[0] : 0
  const avg = fin(scriptIncome?.[1]) && scriptIncome[1] > 0 ? scriptIncome[1] : 0
  const levelPerSec = now || avg
  const s = stock?.ok ? stock : null
  const r = s && fin(s.returnPerSec) && s.returnPerSec > 0 ? s.returnPerSec : 0
  const flatPerSec = s && !(r > 0) && fin(s.incomePerSec) && s.incomePerSec > 0 ? s.incomePerSec : 0
  const hackPays = mults?.ScriptHackMoneyGain
  const sources = []
  if (levelPerSec > 0) sources.push(now ? 'running-scripts' : 'since-last-aug')
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
    hackPays: fin(hackPays) ? hackPays > 0 : null,
    why,
  }
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
export function programSpendAllowed(mults, gateRecord, item, lastAugReset, now = Date.now()) {
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
export function joinReadyButCash(reqs, player) {
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
    if (t === 'numPeopleKilled') {
      if (!(fin(player?.numPeopleKilled) && player.numPeopleKilled >= r.numPeopleKilled)) return { ready: false, why: `kills ${player?.numPeopleKilled ?? '?'} of ${r.numPeopleKilled}` }
      continue
    }
    return { ready: false, why: `requirement '${t ?? '?'}' is not read here` }
  }
  return { ready: true, why: 'every requirement but the cash and the city is met' }
}

export function withCashRaise(orders, cash, equity, margin = 0.02) {
  if (!Array.isArray(orders)) return orders
  const costOf = (o) => (fin(o?.cost) && o.cost > 0 ? o.cost : o?.kind === 'travel' ? TRAVEL_FARE : 0)
  const first = orders.findIndex((o) => costOf(o) > 0)
  if (first < 0 || !(equity > 0) || orders.some((o) => o.kind === 'liquidate')) return orders
  const total = orders.reduce((a, o) => a + costOf(o), 0)
  if (fin(cash) && cash >= total) return orders
  const target = Math.ceil(total * (1 + margin))
  return [...orders.slice(0, first), { id: 0, kind: 'liquidate', args: ['raise', target], why: `raise $${target} cash from the stock book for this batch ($${Math.round(total)} of orders, $${Math.round(cash ?? 0)} in hand)` }, ...orders.slice(first)]
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
 * sum ln(1 + dPnl / wealth) over intervals with NO external flow — so a
 * purchase, a raise or the pre-install liquidation (which the trader books as
 * a flow) neither counts as a loss nor inflates the base. Pooled over every
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
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1]
      const b = s[i]
      if (!(a.wealth > 0) || b.externalFlows !== a.externalFlows) continue
      const g = 1 + (b.lifePnl - a.lifePnl) / a.wealth
      if (!(g > 0)) continue
      y += Math.log(g)
      pts.push({ T: b.t * STOCK_TICK_S, y })
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
//   1 'stop'   cash < 0: fee-charging work stops — the player's class or gym
//              (act-stop.js); sleeves refuse fees on their own cash floor
//              (sleeveplan feeFundable on cash) — until cash is back above the
//              floor. Every node.
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
 * Returns {level, actions: [{kind: 'stop'|'raise'|'install'|'softreset', why,
 *   target?}], samples (carry to the next pass), why}.
 */
export function softlockStep({ cash, stock, work = null, queued = null, hackPays = null, hold = '', samples = [], lastRaiseAt = 0, now = Date.now() }) {
  if (!fin(cash)) return { level: null, actions: [], samples: [], why: 'cash unreadable — nothing decided' }
  if (cash >= 0) return { level: 0, actions: [], samples: [], why: null }
  const equity = stock?.ok && fin(stock.equity) ? stock.equity : 0
  const wealth = cash + equity
  const actions = []
  const why = [`cash $${Math.round(cash)} < 0`]
  if (work && String(work.type ?? '').toUpperCase() === 'CLASS') actions.push({ kind: 'stop', why: `cash $${Math.round(cash)} < 0 and the player is in a paid class (${work.classType ?? '?'}): its fee is charged with no balance check` })
  if (equity > 0) {
    if (now - lastRaiseAt >= NEG_RAISE_COOLDOWN_MS) actions.push({ kind: 'raise', target: NEG_CASH_TARGET, why: `cash $${Math.round(cash)} < 0 with $${Math.round(equity)} of equity: raise to $${NEG_CASH_TARGET}` })
    else why.push(`a negative-cash raise was served ${Math.round((now - lastRaiseAt) / 1000)}s ago (cooldown ${NEG_RAISE_COOLDOWN_MS / 1000}s)`)
    return { level: 2, actions, samples: [], why: why.join('; ') }
  }
  // Level 3 needs POSITIVE evidence of no book: a stale or absent record is
  // unknown, and unknown never licenses an irreversible act.
  if (!(stock?.ok && equity === 0)) return { level: 1, actions, samples: [], why: `${why.join('; ')}; no fresh trader record (${stock?.why ?? 'none'}) — a reset needs positive evidence that no book exists` }
  if (!(wealth <= 0)) return { level: 1, actions, samples: [], why: why.join('; ') }
  const prev = (samples ?? []).filter((s) => fin(s?.cash) && fin(Date.parse(s?.at)))
  if (prev.length && cash > prev[0].cash) return { level: 1, actions, samples: [], why: `${why.join('; ')}; cash rising ($${Math.round(prev[0].cash)} -> $${Math.round(cash)}) — something earns, no reset` }
  const last = prev[prev.length - 1]
  const kept = (last && now - Date.parse(last.at) < SOFTLOCK_GAP_MS ? prev : [...prev, { at: new Date(now).toISOString(), cash, wealth }]).slice(-4)
  const base = `${why.join('; ')}; wealth $${Math.round(wealth)} <= 0, no book, cash not rising`
  if (hackPays !== 0) return { level: 1, actions, samples: kept, why: `${base} — but money is not capital here (ScriptHackMoneyGain ${hackPays}): no reset` }
  if (hold) return { level: 3, actions, samples: kept, why: `${base} — SOFTLOCK, held by ${SOFTLOCK_HOLD_FILE}: ${String(hold).slice(0, 120)}` }
  if (kept.length < SOFTLOCK_MIN_SAMPLES) return { level: 3, actions, samples: kept, why: `${base} — sample ${kept.length} of ${SOFTLOCK_MIN_SAMPLES} (>= ${SOFTLOCK_GAP_MS / 1000}s apart) before acting` }
  if (!fin(queued)) return { level: 3, actions, samples: kept, why: `${base} — SOFTLOCK, but the queued-augmentation count is unreadable: not choosing install vs reset blind` }
  actions.push(queued > 0 ? { kind: 'install', why: `softlock over ${kept.length} samples: ${base}; ${queued} augmentation(s) queued — install` } : { kind: 'softreset', why: `softlock over ${kept.length} samples: ${base}; nothing queued — soft reset` })
  return { level: 3, actions, samples: kept, why: base }
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
