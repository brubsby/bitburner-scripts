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
//
// And it must HONOUR /tel/stock-hold.txt ({at, lastAugReset, by, why}): while
// that is fresh (STOCK_HOLD_MS) and of this life, open NO new position — the
// liquidation before an install has sold everything and the install is
// imminent; a position opened now is destroyed by it.
// ---------------------------------------------------------------------------

export const STOCK_FILE = '/tel/stock.txt'
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
  const none = (why) => ({ ok: false, equity: 0, returnPerSec: null, capitalCap: null, incomePerSec: null, manip: null, why })
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
