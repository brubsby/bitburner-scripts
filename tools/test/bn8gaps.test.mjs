// BITNODE 8's MODEL GAPS (2026-10-24): what the BN8.2 entry dry-run's published exit (227h, count route
// Wired Reflexes) and the live/gameplan comparison (bn8live 39.2h vs bn8.mjs 31.7h) were made of.
//
//   NG1 THE COUNT ROUTE'S COMPOSITION IS SEARCHED (countexit.bestCountRoute): every route's count phase bought ONE
//       ticket an install (compositions [1]), so 28 short were 28 lives. At BN8.2's entry (fixture-bn8-entry.json)
//       a route prices at n > 1 and well under the n = 1 exit; the fixed policy (routeExitFixed, plan's route
//       spec, decideRoute's draws) prices the composition the point chose.
//   NG2 THE LADDER IS NOT FROZEN AT THE FACTIONS JOINED NOW (backlog 6): an unjoined faction's augmentation is a
//       later life's ticket (ticketLadder laterOnly: Infinity this life, its reputation bought whole later);
//       progress.js hands every count model the unjoined factions' catalogue (countLater).
//   NG3 HOME RAM BOUGHT AT THE INSTALLS MOVES BN8's TRADER (countexit.countPhase): what a batch leaves buys home
//       (homeup --reserve 0), kappa8(home) = RW_BN8 (home/256)^rho; later lives' budgets and the exit's trader
//       follow it. No homeGB on the inputs: nothing moves.
//   NG4 THE 4S TIX API IN THE COUNT LIVES (inputs.fourS): paid from the first budget, every later life on the 4S
//       curve; progress.js prices BN8's 4S on BN8's trader (the factor and the 4S age row, 65be811's finding).
//   NG5 THE COUNT-AWARE BASIS (backlog 0g's leftover, 3b): with no install committed, the life length, 4S and
//       graft decisions price the committed count route (countRouteBasisOf), not the default policy that
//       ignores the count (BN8.2's entry: L1 at 10.8h against the count route's 227h).
//   NG6 THE DAEDALUS FARM PRICES THE DONATION (exitplan.hoursToRep donationScaleAt): a point costs $1e6 /
//       faction_rep at the donation; the final window's Red Pill donation falls as the farm banks power.
//   NG7 THE FARM IN A STOCK NODE (goplan.stockGoWeights, STOCK_GO_WEIGHTS = bn8.mjs goWeightsTable — B85):
//       phase from the installed count; Daedalus in the final life, the hidden opponent / Illuminati in the
//       climb, nothing priced before; Netburners and The Black Hand 0; weightsFor takes it first; go.js wires it.

import './gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Check } from './harness.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '../..')
const CE = await import('../../countexit.js')
const X = await import('../../exitplan.js')
const PL = await import('../../plan.js')
const TW = await import('../../traderw.js')
const GP = await import('../../goplan.js')
const B = await import('../sim/gameplan/bn8live.mjs')
const code = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x))
const F = JSON.parse(fs.readFileSync(path.join(HERE, 'fixture-bn8-entry.json'), 'utf8'))
const count = B.countOf(F, F.joined)
const inp6 = { ...F.base, cycleHours: 6, multGainPerCycle: 1.5 }
// a route: the cheapest ticket of the ladder, its reputation ground over an hour's detour (countRoutes 'work')
const t0 = count.ladder[0]
const route = { ...t0, price: t0.base, don: 0, via: 'work', detourH: 1, joinH: 0, grindH: 1, exp: t0.exp ?? 1, rep: t0.rep ?? 1 }

function ng1() {
  const c = new Check('NG1', "the count route's composition is searched (not 1 ticket an install), and the fixed policy prices the composition the point chose")
  const free = CE.bestCountRoute(X.bestExitPolicy, inp6, count, [route])
  const one = CE.bestCountRoute(X.bestExitPolicy, inp6, count, [route], { compositions: [1] })
  const t = free.tried[0]
  c.examined(4)
  c.note(`BN8.2 entry, ${route.name} at ${route.faction}: searched n ${t?.n} at ${t?.lifeH}h lives ${f2(t?.hours)}h (${free.composition?.why}) | one a life ${f2(one.tried[0]?.hours)}h`)
  if (!(t?.n > 1)) c.fail('the route was priced one ticket an install')
  if (!(t?.hours < 0.6 * one.tried[0]?.hours)) c.fail(`the searched composition does not beat one ticket an install (${t?.hours}h vs ${one.tried[0]?.hours}h)`)
  const fx = CE.routeExitFixed(X.bestExitPolicy, inp6, count, route, { lifeH: t?.lifeH, n: t?.n })
  const fx1 = CE.routeExitFixed(X.bestExitPolicy, inp6, count, route, { lifeH: t?.lifeH })
  c.note(`routeExitFixed at the chosen (n ${t?.n}, ${t?.lifeH}h) ${f2(fx)}h; without n (1) ${f2(fx1)}h`)
  if (!(Math.abs(fx - t?.hours) < 0.01)) c.fail(`routeExitFixed at the point's n does not reproduce its hours (${fx} vs ${t?.hours})`)
  const tr = PL.trajectoryOf({ kind: 'route', route, extra: 0, lifeH: t?.lifeH, n: t?.n }, { count })(inp6)
  if (!(Math.abs(tr - fx) < 1e-6)) c.fail(`plan.trajectoryOf's route spec does not carry n (${tr} vs ${fx})`)
  const pl = code('plan.js')
  if (!/n: nOf\.get\(routeKey\(route\)\) \?\? 1/.test(pl) || !/n: w\.n \?\? 1 \}/.test(pl) || !/n: spec\.n \?\? 1, detourH: det/.test(pl)) c.fail("plan.js: decideRoute's draws, the install decision's route option or trajectoryGenOf drop the composition")
  return c
}

function ng2() {
  const c = new Check('NG2', "an unjoined faction's augmentation is a later life's ticket (never this life's); progress.js gives every count model the unjoined catalogue")
  const offers = [
    { name: 'J', faction: 'Joined', baseCost: 1e8, repReq: 1e3, factionRep: 0, donationCost: 1e9, mults: { hacking: 1.05 } },
    { name: 'U', faction: 'Unjoined', baseCost: 2e8, repReq: 1e4, factionRep: 0, mults: { hacking: 1.1 }, laterOnly: true },
    { name: 'V', faction: 'NoDonate', baseCost: 2e8, repReq: 1e4, factionRep: 0, mults: {}, laterOnly: true },
  ]
  const lad = CE.ticketLadder(offers, new Set(), { laterDonation: (o) => (o.faction === 'NoDonate' ? null : o.repReq * 1e6) })
  const u = lad.find((t) => t.name === 'U')
  c.examined(4)
  c.note(`ladder ${lad.map((t) => `${t.name} now ${t.price === Infinity ? 'never' : '$' + t.price.toExponential(2)} later $${t.laterPrice.toExponential(2)}`).join(', ')}`)
  if (!u || u.price !== Infinity || Math.abs(u.laterPrice - (2e8 + 1e10)) > 1) c.fail('an unjoined ticket is not Infinity now and its base + whole reputation later')
  if (lad.some((t) => t.name === 'V')) c.fail('an unjoined ticket whose reputation cannot be bought entered the ladder')
  const now = CE.bankBatch({ budget: 1e13, ladder: lad, n: 5 })
  const later = CE.bankBatch({ budget: 1e13, ladder: lad, n: 5, later: true })
  if (now.chosen.includes('U') || !later.chosen.includes('U')) c.fail(`this life bought the unjoined ticket, or a later one could not (${now.chosen} / ${later.chosen})`)
  const pr = code('progress.js')
  const calls = pr.match(/countModelOf\([^()]*(\([^()]*\)[^()]*)*\)/g) ?? []
  const bad = calls.filter((x) => !/^countModelOf\(mults, offers, allCount, player, later = null\)$/.test(x) && !/countLater\)$/.test(x))
  c.note(`progress.js countModelOf call sites: ${calls.length}`)
  if (calls.length < 7 || bad.length) c.fail(`a count model built without the unjoined catalogue: ${bad.join(' | ')}`)
  if (!/laterOnly: true/.test(pr) || !/\[\.\.\.\(offers \?\? \[\]\), \.\.\.\(later \?\? \[\]\)\]/.test(pr)) c.fail('progress.js does not build the later-life tickets into the ladder')
  return c
}

function ng3() {
  const c = new Check('NG3', "home bought at the installs moves BN8's trader in the count lives and the exit; absent homeGB nothing moves")
  const { homeGB: _h, homeRamCost: _c, ...ca } = F.base.capitalAge
  const withHome = { ...inp6, capitalAge: { ...ca, homeGB: 128, homeRamCost: 1, kappa: TW.rwBn8Kappa(128) } }
  const noHome = { ...inp6, capitalAge: { ...ca, kappa: TW.rwBn8Kappa(128) } }
  const { ladder } = CE.paddedLadder(count)
  const a = CE.countPhase({ short: count.short, ladder, n: 15, inputs: withHome, firstInstallH: 6, nfg: count.nfg })
  const b = CE.countPhase({ short: count.short, ladder, n: 15, inputs: noHome, firstInstallH: 6, nfg: count.nfg })
  c.examined(4)
  c.note(`with home: ${a.perInstall.map((p) => `$${p.budget.toExponential(2)} -> home ${p.home}GB`).join(', ')}, factor x${f2(a.capitalFactor)} | without: ${b.perInstall.map((p) => `$${p.budget.toExponential(2)}`).join(', ')}, x${f2(b.capitalFactor)}`)
  if (!(a.perInstall.at(-1)?.home > 128) || !(a.capitalFactor > 1)) c.fail('the leftover bought no home RAM, or the trader factor did not move')
  if (a.perInstall.length > 1 && !(a.perInstall[1].budget > b.perInstall[1].budget)) c.fail("a later life's budget does not follow the home bought before it")
  if (b.capitalFactor !== 1 || b.perInstall.some((p) => 'home' in p)) c.fail('without homeGB on the inputs the count phase moved')
  const hA = CE.countExitFixed(X.bestExitPolicy, withHome, count, { n: 15, lifeH: 6, firstInstallH: 6 })
  const hB = CE.countExitFixed(X.bestExitPolicy, noHome, count, { n: 15, lifeH: 6, firstInstallH: 6 })
  c.note(`count exit (n 15, 6h lives, first at 6h): ${f2(hA)}h with home, ${f2(hB)}h without`)
  if (!(hA < hB)) c.fail('the home bought does not shorten the exit')
  const ci = TW.capitalAgeInputsOf({ regime: 'pre-long', homeGB: 512, homeRamCost: 1 })
  if (ci.capitalAge.homeGB !== 512 || TW.capitalAgeInputsOf({ regime: 'pre-long', homeGB: 512, bn8: false }).capitalAge.homeGB !== undefined) c.fail('capitalAgeInputsOf does not carry the home its factor was read at (BN8 only)')
  if (!/homeRamCost: bitNodeMults\(info\)\?\.HomeComputerRamCost/.test(code('progress.js'))) c.fail("progress.js does not pass the node's home RAM cost to the trader inputs")
  return c
}

function ng4() {
  const c = new Check('NG4', "the 4S TIX API in the count lives: paid from the first budget, the later lives on the 4S curve; BN8's 4S priced on BN8's trader")
  const ca = F.base.capitalAge
  const a4 = TW.RW_AGE['4S-long']
  const four = { cost: 25e9, when: 'life1', r0PerSec: (ca.kappa * a4.r0PerHour) / 3600, Wstar: TW.rwAgeKnee(0, '4S-long'), shape: { ...TW.RW_PRIOR['4S-long'].shape, n: a4.n } }
  const { ladder } = CE.paddedLadder(count)
  const base = { ...inp6, money: 5e10 }
  const w = CE.countPhase({ short: count.short, ladder, n: 15, inputs: { ...base, fourS: four }, firstInstallH: 6, nfg: count.nfg })
  const o = CE.countPhase({ short: count.short, ladder, n: 15, inputs: base, firstInstallH: 6, nfg: count.nfg })
  c.examined(3)
  c.note(`budgets with 4S ${w.perInstall.map((p) => `$${p.budget.toExponential(2)}`).join(', ')} | without ${o.perInstall.map((p) => `$${p.budget.toExponential(2)}`).join(', ')}`)
  if (!(Math.abs(o.perInstall[0].budget - w.perInstall[0].budget - 25e9) < 1)) c.fail("the 4S price is not paid from the first life's budget")
  if (w.perInstall.length > 1 && o.perInstall.length > 1 && w.perInstall[1].budget === o.perInstall[1].budget) c.fail('the later lives do not trade on the 4S curve')
  const pr = code('progress.js')
  if (!/fourSSpecOf\(info, 'life1', base\.capitalAge \?\? null\)/.test(pr) || !/fourSCarriedOf\(planCtx, info, out\.capitalAge \?\? null\)/.test(pr) || !/capAge\.kappa \* a4\.r0PerHour/.test(pr)) c.fail("progress.js prices BN8's 4S off BN8's trader (the factor and RW_AGE's 4S row)")
  return c
}

function ng5() {
  const c = new Check('NG5', "with no install committed, the count-aware decisions price the committed count route (not the default policy that ignores the count)")
  const pr = code('progress.js')
  const n = (pr.match(/hackBasisOf\(pc\.prev\?\.decisions\?\.install \?\? null, Date\.now\(\)\) \?\? countRouteBasisOf\(ns, info, countCtx(, \{ ownLife: true \})?\)/g) ?? []).length
  c.examined(3)
  c.note(`decisions on the count-route basis: ${n} (life length, 4S, grafts)`)
  if (n < 3) c.fail('the life length, 4S and graft decisions do not fall back to the committed count route')
  if (!/route: cm\.best\.route, n: cmN/.test(pr)) c.fail('/tel/countroute.txt does not carry the route and its composition')
  // the two trajectories at the entry: the default policy (count ignored) vs the route, on the same inputs
  const t = CE.bestCountRoute(X.bestExitPolicy, inp6, count, [route]).tried[0]
  const def = PL.trajectoryOf(null, { count })(inp6)
  const viaRoute = PL.trajectoryOf({ kind: 'route', route, extra: 0, lifeH: null, n: t.n }, { count })(inp6)
  c.note(`BN8.2 entry inputs (6h lives): the default policy ${f2(def)}h | the count route ${f2(viaRoute)}h`)
  if (!(viaRoute > def + 3)) c.fail('the default policy is not the optimistic one here (the check lost its contrast)')
  return c
}

function ng6() {
  const c = new Check('NG6', 'the Daedalus farm prices the donation: the money owed falls with faction_rep at the hour it is given')
  const moneyLeg = (target, targetAt = null) => {
    // $1e9/h flat: the first hour the cash meets what is owed
    for (let t = 0; t < 1000; t += 0.001) if (t * 1e9 >= (targetAt ? targetAt(t) : target)) return t
    return null
  }
  const o = { rep0: 0, repPerSec: 0, donationCost: 1e10, favor: 0, favorToDonate: 0, moneyLeg }
  const flat = X.hoursToRep(1e6, o)
  const farm = X.hoursToRep(1e6, { ...o, donationScaleAt: (t) => 1 + t })
  c.examined(3)
  c.note(`$1e10 donation at $1e9/h: ${f2(flat.hours)}h flat; ${f2(farm.hours)}h with faction_rep x(1 + t) (${farm.how})`)
  if (!(Math.abs(flat.hours - 10) < 0.01)) c.fail('the flat donation moved')
  if (!(farm.hours < 3 && farm.hours > 2.5)) c.fail('the donation is not priced at faction_rep when it is given')
  // working while saving (BN8's workWhileDonating): the farm cuts what the work leaves owed too
  const w0 = X.hoursToRep(1e6, { ...o, repPerSec: 10, workWhileDonating: true })
  const w1 = X.hoursToRep(1e6, { ...o, repPerSec: 10, workWhileDonating: true, donationScaleAt: (t) => 1 + t })
  c.note(`working 36k rep/h while saving: ${f2(w0.hours)}h flat, ${f2(w1.hours)}h with the farm`)
  if (!(w1.hours < 0.5 * w0.hours)) c.fail('the work-while-saving donation ignores the farm')
  const ex = code('exitplan.js')
  if (!/goRepAt && installsFirst > 0 \? \{ donationScaleAt: \(tj\) => goRepAt\(tj\) \}/.test(ex)) c.fail("exitplan's final window does not hand the Daedalus farm to the donation")
  return c
}

function ng7() {
  const c = new Check('NG7', 'the farm in a stock node: priced per phase on the node\'s exit (STOCK_GO_WEIGHTS); Daedalus in the final life; 0 on what multiplies 0; first in weightsFor; wired in go.js')
  const m8 = { ScriptHackMoneyGain: 0, FavorToDonateToFaction: 0, DaedalusAugsRequirement: 30 }
  const owned = (n, extra = []) => new Map([...Array.from({ length: n }, (_, i) => [`a${i}`, 1]), ...extra.map((x) => [x, 1])])
  const lives = GP.stockGoWeights({ currentNode: 8, ownedAugs: owned(5) }, m8)
  const fin = GP.stockGoWeights({ currentNode: 8, ownedAugs: owned(30) }, m8)
  const climb = GP.stockGoWeights({ currentNode: 8, ownedAugs: owned(31, ['The Red Pill']) }, m8)
  c.examined(6)
  c.note(`lives ${JSON.stringify(lives?.weights)} | final ${JSON.stringify(fin?.weights)} | climb ${JSON.stringify(climb?.weights)}`)
  if (lives?.phase !== 'lives' || fin?.phase !== 'final' || climb?.phase !== 'climb') c.fail('the phase is not read from the installed count / The Red Pill')
  if (!(fin.weights.faction_rep > 10 * fin.weights.hacking_speed)) c.fail("the final life's farm is not Daedalus' faction_rep")
  for (const w of [lives, fin, climb]) if (w.weights.hacknet_node_money !== 0 || w.weights.hacking_money !== 0) c.fail('Netburners / The Black Hand weigh more than the 0 they multiply in BN8')
  if (GP.stockGoWeights({ currentNode: 1, ownedAugs: owned(1) }, { ScriptHackMoneyGain: 1, FavorToDonateToFaction: 1 }) !== null) c.fail('a node that is not a stock node got stock weights')
  const wf = GP.weightsFor({ lastAugReset: 1, objective: { goWeights: { weights: { hacking_speed: 9 } } } }, 1, {}, fin)
  if (wf.source !== 'stock' || wf.weights.faction_rep !== fin.weights.faction_rep) c.fail("weightsFor does not take the stock node's weights first")
  const pick = (w, inc) => GP.chooseOpponent({ weights: w.weights, windowH: w.windowH, incumbent: inc, nodePower: {}, boardSize: 5 })
  const pf = pick(fin, 'Illuminati')
  const pl = pick(lives, 'Illuminati')
  c.note(`final life: ${pf.opponent} (${String(pf.why).slice(0, 120)}) | lives: ${pl.opponent} (${String(pl.why).slice(0, 100)})`)
  if (pf.opponent !== 'Daedalus') c.fail(`the final life does not farm Daedalus (${pf.opponent})`)
  if (pl.opponent !== 'Illuminati' || pl.refused !== true) c.fail('before the count the incumbent does not stand on zero weights')
  if (!/weightsFor\(gate, reset\?\.lastAugReset, earlyInputs, stockGoWeights\(reset, bitNodeMults\(reset\)\)\)/.test(code('go.js'))) c.fail('go.js does not hand the stock weights to weightsFor')
  return c
}

export async function run() {
  return [ng1(), ng2(), ng3(), ng4(), ng5(), ng6(), ng7()]
}
