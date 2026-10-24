// REPUTATION IS A PURCHASE IN THE LIFE MODEL (backlog 0g, 2026-10-24).
//
// The live exit's life-length model (lifeplan.lifeBatch) ground every reputation point, where a faction at
// floor(150 x FavorToDonateToFaction) favour sells it for money (donation.ts:12-18, Singularity.ts:921) — and
// BitNode 8's FavorToDonateToFaction is 0 (BitNode.tsx:776): every faction from the first join. The count
// exit (countexit, the plan's BN8 trajectory while Daedalus' count is short) paid a faction's reputation once
// per ticket, escalated by 1.9^j, charged its ticket lives the purchase sequence's depletion, and priced every
// life's budget on today's market instead of a fresh one. At BN8.2's entry (the dry-run's inputs) the live
// count-aware exit read 80.7h on 9 installs; the gameplan (bn8.mjs) 31.7h.
//
//   LD1 THE MECHANISM (lifeBatch): an open faction's requirement costs money, not hours — the life's work at
//       the open factions first, the rest donated at 1e6 / (faction_rep x FactionWorkRepGain) a point, unescalated;
//       closed (favour below the threshold, a gang's, a workless faction) or absent: exactly the grind.
//   LD2 BN8.2's ENTRY (fixture-bn8-entry.json, the entry dry-run's inputs): a 12h life buys >= 10 augmentations
//       with donations (<= 3 ground); the count-aware live exit within 25% (or 5h) of the gameplan's
//       never-accepting arm (stanekplan.STOCK_GIFT_PRICED['8|3'], bn8.mjs's own — B84), on <= 4 installs.
//   LD3 THE COUNT EXIT (countexit): a faction's donation paid once and unescalated (bankBatch / batchMoney);
//       rows without donation parts: the n cheapest, most expensive first, as before; the ticket lives free of
//       the purchase sequence's shape.
//   LD4 A FRESH MARKET: lifeplan.freshLifeMoney and countexit.moneyAfter move the knee with the life's own
//       market age (traderw.ageKneeQ) where the inputs carry capitalAge; absent, nothing moves.
//   LD5 THE WIRING AND THE NODES WHERE NOTHING IS OPEN: progress.js builds repDonate (donateOf on the node's
//       threshold, faction_rep, FactionWorkRepGain, the factions that never take one) and hands it to the life
//       table; with no faction at the threshold the first life is unchanged at every length, and an unreachable
//       threshold leaves the whole table identical (BN12 fixture).

import './gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Check } from './harness.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '../..')
const LP = await import('../../lifeplan.js')
const CE = await import('../../countexit.js')
const TW = await import('../../traderw.js')
const SP = await import('../../stanekplan.js')
const BM = await import('../../bitNodeMultipliers.js')
const code = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x))

// One faction, one augmentation: 100k reputation, $1b. Work earns 10k/h.
const item = (name, repReq, price, f = 'F', hack = 1.1) => ({ name, price, repReq, hackMult: hack, prereq: [], factions: [f] })
const lifeOf = (o) => LP.lifeBatch({ items: [item('A', 1e5, 1e9)], nfg: null, state: { owned: new Set(), favor: { F: 0 }, nfgLevel: 0 }, L: 2, money: 2e11, repPerHour0: 1e4, ...o })

function ld1() {
  const c = new Check('LD1', 'lifeBatch: an open faction sells its reputation (work first, the rest donated at 1e6/(faction_rep x FactionWorkRepGain), unescalated); closed or absent: the grind exactly')
  const m8 = BM.bitNodeMults(8)
  const d = LP.donateOf(Math.floor(150 * m8.FavorToDonateToFaction), 1.25, m8.FactionWorkRepGain, ['Bladeburners'])
  c.examined(6)
  c.note(`BN8: FavorToDonateToFaction ${m8.FavorToDonateToFaction}, FactionWorkRepGain ${m8.FactionWorkRepGain} -> donateOf ${JSON.stringify(d)}`)
  if (m8.FavorToDonateToFaction !== 0) c.fail("BN8's FavorToDonateToFaction is not 0 in the game's multipliers")
  if (!d || d.need !== 0 || Math.abs(d.perRep - 1e6 / 1.25 / m8.FactionWorkRepGain) > 1e-6) c.fail('donateOf is not floor(150 x FavorToDonateToFaction) at 1e6/(faction_rep x FactionWorkRepGain) a point')
  const grind = lifeOf({})
  const open = lifeOf({ donate: d })
  c.note(`2h life, 100k rep at 10k/h: ground ${grind.chosen.length} aug(s); donated ${open.chosen.length} aug(s) for $${open.donation.toExponential(3)} (cost $${open.cost.toExponential(3)})`)
  if (grind.chosen.length !== 0) c.fail('the grind bought an augmentation whose reputation takes 10h in a 2h life')
  const owe = (1e5 - 2 * 1e4) * d.perRep
  if (open.chosen.length !== 1 || Math.abs(open.donation - owe) > 1) c.fail(`the open faction's requirement is not the life's work plus a donation of the rest ($${owe.toExponential(3)})`, `donation $${open.donation}`)
  if (Math.abs(open.cost - (1e9 + owe)) > 1) c.fail('the donation is escalated or the price is not added once')
  if (!(open.rep.F >= 1e5)) c.fail('the donated reputation is not banked at the faction (favour for later lives)')
  // the choice prices the donation unescalated too: money for the price + 1.2x the donation buys it
  const tight = lifeOf({ donate: d, money: 1e9 + 1.2 * owe })
  if (tight.chosen.length !== 1) c.fail('with the money for the price and the donation, the life did not buy (the choice escalates or double-counts the donation)')
  // closed: favour below the threshold, a faction that never takes one, no terms -> the grind, field for field
  const same = (a, b) => JSON.stringify({ ...a, donation: 0 }) === JSON.stringify({ ...b, donation: 0 })
  for (const [why, o] of [['threshold 150, favour 0', { donate: { ...d, need: 150 } }], ['a faction that never takes one', { donate: { ...d, no: ['F'] } }], ['no terms', { donate: null }]]) {
    const r = lifeOf(o)
    if (!same(r, grind) || r.donation !== 0) c.fail(`closed (${why}) is not the grind exactly`)
  }
  return c
}

function ld2() {
  const c = new Check('LD2', "BN8.2's entry (the dry-run's inputs): donations buy a 12h life >= 10 augmentations (ground <= 3); the count-aware live exit within 25% or 5h of the gameplan's never-accepting arm, on <= 4 installs")
  const F = JSON.parse(fs.readFileSync(path.join(HERE, 'fixture-bn8-entry.json'), 'utf8'))
  return import('../sim/gameplan/bn8live.mjs').then((B) => {
    const live = B.liveExit(F, { joined: F.joined, grid: [6, 8, 12] })
    const grind = B.liveExit(F, { joined: F.joined, grid: [12], donate: null })
    const r12 = live.rows.find((r) => r.L === 12)
    const g12 = grind.rows.find((r) => r.L === 12)
    const ref = SP.STOCK_GIFT_PRICED['8|3']?.[0]
    const lc = live.bestCount
    c.examined(live.rows.length + 1)
    c.note(`12h life: donated ${r12?.first} augs + ${r12?.firstNfg} NFG (model x${r12?.modelGain}); ground ${g12?.first} + ${g12?.firstNfg} (x${g12?.modelGain})`)
    c.note(`count-aware live ${lc?.countH}h: first install at ${lc?.countWaitH}h, ${lc?.countInstalls} installs (${lc?.countPhase} to the count) of ${lc?.L}h | gameplan never-accepting ${ref}h`)
    if (!(r12?.first >= 10) || !(g12?.first <= 3)) c.fail('the life model does not buy a 12h life with donations at BN8.2 (or the grind does)')
    if (!Number.isFinite(ref)) c.fail("no STOCK_GIFT_PRICED['8|3'] reference")
    else if (!lc || Math.abs(lc.countH - ref) > Math.max(5, 0.25 * ref)) c.fail(`the live BN8.2 exit is not within 25% / 5h of the gameplan's (${lc?.countH}h vs ${ref}h)`)
    if (!(lc?.countInstalls <= 4)) c.fail(`the live BN8.2 exit installs ${lc?.countInstalls} times (the gameplan: 4 lives then the final)`)
    return c
  })
}

function ld3() {
  const c = new Check('LD3', "the count exit pays a faction's donation once, unescalated; rows without donation parts as before; the ticket lives free of the purchase sequence's shape")
  const row = (name, base, don, faction) => ({ name, price: base + don, laterPrice: base + don, hacking: 1, base, faction, don, laterDon: don })
  const two = [row('a', 1e8, 5e9, 'F'), row('b', 2e8, 5e9, 'F')]
  const m = CE.batchMoney(two)
  const want = 2e8 + 1e8 * 1.9 + 5e9
  c.examined(4)
  c.note(`two tickets at one faction, $5e9 of reputation each: $${m.toExponential(4)} (the game: $${want.toExponential(4)}; per ticket escalated: $${(5.2e9 + 5.1e9 * 1.9).toExponential(4)})`)
  if (Math.abs(m - want) > 1) c.fail("a faction's reputation is not paid once, unescalated")
  const b = CE.bankBatch({ budget: want * 1.0001, ladder: two, n: 2 })
  if (b.count !== 2 || Math.abs(b.cost - want) > 1) c.fail(`bankBatch does not buy both at the game's price (count ${b.count}, $${b.cost})`)
  // legacy rows (no parts): the n cheapest, most expensive first
  const legacy = [1, 2, 3, 4].map((k) => ({ name: `t${k}`, price: k * 1e8, laterPrice: k * 1e8, hacking: 1 }))
  const l = CE.bankBatch({ budget: 3e8 + 2e8 * 1.9 + 1e8 * 3.61, ladder: legacy, n: 4 })
  if (l.count !== 3 || l.chosen.slice().sort().join() !== 't1,t2,t3') c.fail(`rows without donation parts: not the 3 cheapest (${l.chosen})`)
  // the ticket lives price their own gains: the inputs' cadenceShape must not move the count exit
  const F = JSON.parse(fs.readFileSync(path.join(HERE, 'fixture-bn8-entry.json'), 'utf8'))
  return import('../sim/gameplan/bn8live.mjs').then(async (B) => {
    const X = await import('../../exitplan.js')
    const count = B.countOf(F, F.joined)
    const inp = { ...F.base, cycleHours: 12, multGainPerCycle: 1.5 }
    const shaped = { ...inp, cadenceShape: { L: 12, ln: [0.4, 0.01, 0.01, 0.01, 0.01] } }
    const h0 = CE.countExitFixed(X.bestExitPolicy, inp, count, { n: 28, lifeH: 12, firstInstallH: 6 })
    const h1 = CE.countExitFixed(X.bestExitPolicy, shaped, count, { n: 28, lifeH: 12, firstInstallH: 6 })
    c.note(`count exit at 12h lives: ${f2(h0)}h flat, ${f2(h1)}h with a front-loaded purchase shape on the inputs`)
    if (!Number.isFinite(h0) || Math.abs(h1 - h0) > 1e-9) c.fail('the purchase sequence shape moves the count phase (its ticket lives are its own)')
    return c
  })
}

function ld4() {
  const c = new Check('LD4', "a fresh market: freshLifeMoney and moneyAfter move the trader's knee with the life's own age where capitalAge is given; absent, nothing moves")
  const age = TW.capitalAgeInputsOf({ regime: 'pre-long', ageNowH: 0.03, homeGB: 256 })
  const base = { installCash: 2.5e8, incomePerSec: 0, hacking: 1, hackingMult: 1, expPerSec: 0, ...age }
  const noAge = { ...base, capitalAge: null }
  const m1 = LP.freshLifeMoney(base, 8)
  const m0 = LP.freshLifeMoney(noAge, 8)
  const a1 = CE.moneyAfter(2.5e8, 8, base, 0)
  const a0 = CE.moneyAfter(2.5e8, 8, noAge, 0)
  // an independent fine integration of dW/dt = r(W, age) W on the same curve
  let W = 2.5e8
  const dt = 0.001
  for (let t = 0; t < 8 - 1e-9; t += dt) W *= Math.exp(age.capitalAge.kappa * TW.rwAgeRate(W, t + dt / 2, 'pre-long') * dt)
  c.examined(4)
  c.note(`8h from $250m (pre-4S, 256GB): fresh market freshLifeMoney $${m1.toExponential(3)}, moneyAfter $${a1.toExponential(3)}, fine integration $${W.toExponential(3)}; one knee (age 0.03h) $${m0.toExponential(3)} / $${a0.toExponential(3)}`)
  if (Math.abs(Math.log(m1 / W)) > 0.015 || Math.abs(Math.log(a1 / W)) > 0.015) c.fail('the fresh life is not the fresh market (1.5% of the fine integration)')
  if (!(m1 > 1.5 * m0)) c.fail("the fresh life's knee does not move with its age")
  // the count phase's later lives budget on a fresh market (countexit.countPhase -> moneyAfter at age 0)
  const ph = CE.countPhase({ short: 2, ladder: [{ name: 'x', price: 1e8, laterPrice: 1e8, hacking: 1 }, { name: 'y', price: 1e8, laterPrice: 1e8, hacking: 1 }], n: 1, inputs: { ...base, money: 2.5e8, cycleHours: 8, capitalAge: { ...age.capitalAge, ageNowH: 30 } }, firstInstallH: 0 })
  const b1 = ph.perInstall?.[1]?.budget
  c.note(`count phase, a later 8h life's budget with today's market 30h old: $${Number(b1).toExponential(3)}`)
  if (!(Math.abs(Math.log(b1 / W)) <= 0.015)) c.fail("the count phase's later lives do not budget on a fresh market")
  const plain = { installCash: 2.5e8, incomePerSec: 0, hacking: 1, hackingMult: 1, expPerSec: 0, capitalReturnPerSec: age.capitalReturnPerSec, capitalScaleW: age.capitalScaleW, capitalShape: age.capitalShape }
  if (LP.freshLifeMoney(plain, 8) !== m0 || CE.moneyAfter(2.5e8, 8, plain, 0) !== a0) c.fail('without capitalAge the money models moved')
  return c
}

function ld5() {
  const c = new Check('LD5', "the wiring (progress.js repDonate -> the life table) and the nodes where nothing is open: the first life unchanged at every length; an unreachable threshold leaves the table identical (BN12 fixture)")
  const p = code('progress.js')
  c.examined(3)
  if (!/repDonate:\s*donateOf\(favorToDonateOf\(bitNodeMults\(info\)\),\s*player\?\.mults\?\.faction_rep[^,]*,\s*bitNodeMults\(info\)\?\.FactionWorkRepGain,\s*\[\.\.\.NO_DONATION_FACTIONS/.test(p)) c.fail("progress.js's exit inputs do not build repDonate from the node's threshold, faction_rep, FactionWorkRepGain and the factions that never take one")
  if (!/lifeTableGen\(\{[^}]*donate:\s*base\.repDonate/.test(p)) c.fail("progress.js's purchase table is not handed the donation terms (purchaseCadenceGen -> lifeTableGen)")
  const F = JSON.parse(fs.readFileSync(path.join(HERE, 'fixture-bn12-exitjump-1401.json'), 'utf8'))
  const POST = F.post.inputs
  const C = LP.catalogueFromOffers(F.offers, F.owned)
  const m = BM.bitNodeMults(12, 1)
  const need = Math.floor(150 * m.FavorToDonateToFaction)
  const d = LP.donateOf(need, 1.5, m.FactionWorkRepGain)
  const closed = Object.fromEntries(Object.entries(C.favor).map(([f, v]) => [f, Math.min(v, need - 50)]))
  const grid = [1, 6, 12]
  const t = (favor, donate) => LP.lifeTable({ inputs: POST, catalogue: C, favor, owned: F.owned, repPerHour0: POST.repPerSec * 3600, grid, donate })
  const g = t(closed, null)
  const o = t(closed, d)
  const u = t(closed, { ...d, need: 1e9 })
  const firstSame = g.every((r, i) => r.seq[0] === o[i].seq[0])
  c.note(`BN12 (threshold ${need}), every faction below it: the first life ${firstSame ? 'unchanged' : 'CHANGED'} at ${grid.join('/')}h; means ${g.map((r) => r.lnMean.toFixed(4)).join('/')} -> ${o.map((r) => r.lnMean.toFixed(4)).join('/')} (later lives whose banked favour crosses ${need} donate)`)
  if (!firstSame) c.fail('a node with no faction at the threshold changed its first life')
  if (JSON.stringify(g) !== JSON.stringify(u)) c.fail('an unreachable threshold changed the life table')
  return c
}

export async function run() {
  return [ld1(), await ld2(), await ld3(), ld4(), ld5()]
}
