// THE ROUTE CALIBRATION BAND (routecal.js, 2026-10-23): a route is chosen on its EXPECTED hours under its
// family's measured model error, never on the model's point — in the gameplan (routes.mjs clearTime,
// params.mjs routeErrOf) and in the live route decision (plan.decideBladeRouteGen `node`).
//
// The case it exists for: BN2.2 priced by the gift + hacking at ~8.4h against a Bladeburner clear at ~8.5h,
// the hacking route's g on BN2 off by +163% leave-one-out, the Bladeburner route measured at 8.3-9.0h.
//
//   RC1  the gameplan's choice world takes the minimum EXPECTED hours: hack 8.4h (s 0.97) loses to blade 8.5h
//        (s 0.12); with the band off (the point rule) hack wins; with equal bands hack wins
//   RC2  a drawn world plays the route the choice world chose (committed before the world is known), even
//        where the draw's own cheapest is the other, at the draw's hours x the band's undrawn part
//   RC3  routeErrOf's undrawn part: a played node's hacking band less its own g sd, an unplayed node's none
//        (its draws carry the predictive), the Bladeburner band less k's posterior sd
//   RC4  routecal.routeSdOf: max(pooled, the node's own); the live table carries BN2's own hacking miss
//   RC5  the live decision: the hacking arm a hair under the Bladeburner arm on the points — 'hack' without a
//        node; 'blade' at BN2 (its band), both with and without a posterior; the record says the band flipped it
//   RC6  the wiring: progress.js passes the node to decideBladeRouteGen; plan.mjs plans on the band by default
//   RC7  no committed route: the expected points' route is the incumbent — a heavy-tailed Monte Carlo whose
//        hacking mean lands a hair under the blade's no longer picks 'hack' on noise (entry dry-run BN2.2)
//   RC8  the gift accepted after a chained route decision is an event: the route re-decides, never holds
//        the chain's 'hack' (BN2.2: held at 23.3h against blade 15.9h)
//   RC9  the expected points crossing against a held route is an event (BN2.3: hack held from the boot pass)

import './gameresolve.mjs'
import { Check } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './gameresolve.mjs'

const RC = await import('routecal.js')
const P = await import('plan.js')
const BB = await import('bbplan.js')
const { drain } = await import('coop.js')
const { clearTime } = await import('../sim/gameplan/routes.mjs')
const { routeErrOf } = await import('../sim/gameplan/params.mjs')

const ex = (s) => Math.exp((s * s) / 2)
const ROUTES = [
  { id: 'hack', applies: () => true, hours: (a) => a.world.H.hack },
  { id: 'blade', applies: () => true, hours: (a) => a.world.H.blade },
]
const S = { mults: () => ({}) }
const lv = () => 0
/** A world with fixed route hours; sd per family; choice = the choice world (or null: this is it). */
function worldOf(H, sd, choice = null, drawn = { hack: 0, blade: 0 }) {
  const fam = (id) => (id === 'blade' ? 'blade' : 'hack')
  const re = sd
    ? {
        isChoice: !choice,
        fullFactor: (id) => ex(sd[fam(id)]),
        extraFactor: (id) => ex(Math.sqrt(Math.max(0, sd[fam(id)] ** 2 - drawn[fam(id)] ** 2))),
        choiceWorld: () => choice,
      }
    : null
  return { H, routeErr: re }
}

export async function run() {
  const out = []
  {
    const c = new Check('RC1', "the gameplan's choice world takes the minimum expected hours, not the minimum point")
    const H = { hack: 8.4, blade: 8.5 }
    const band = worldOf(H, { hack: 0.97, blade: 0.12 })
    const point = worldOf(H, null)
    const equal = worldOf(H, { hack: 0.12, blade: 0.12 })
    const a = clearTime(2, lv, band, S, ROUTES)
    const b = clearTime(2, lv, point, S, ROUTES)
    const e = clearTime(2, lv, equal, S, ROUTES)
    c.examined(3)
    c.note(`band: ${a.via} ${a.h.toFixed(2)}h (hack E ${(8.4 * ex(0.97)).toFixed(2)}h, blade E ${(8.5 * ex(0.12)).toFixed(2)}h); point rule: ${b.via} ${b.h}h; equal bands: ${e.via}`)
    if (a.via !== 'blade' || Math.abs(a.h - 8.5 * ex(0.12)) > 1e-9) c.fail(`hack 8.4h at s 0.97 vs blade 8.5h at s 0.12: the choice must be blade at its expected ${(8.5 * ex(0.12)).toFixed(3)}h, got ${a.via} ${a.h}`)
    if (b.via !== 'hack' || b.h !== 8.4) c.fail(`without the band the old rule (min point) must stand: hack 8.4h, got ${b.via} ${b.h}`)
    if (e.via !== 'hack') c.fail(`equal bands leave the point order: hack, got ${e.via}`)
    out.push(c)
  }
  {
    const c = new Check('RC2', 'a drawn world plays the choice world\'s route, at its drawn hours x the undrawn part of the band')
    const choice = worldOf({ hack: 8.4, blade: 8.5 }, { hack: 0.97, blade: 0.12 })
    const draw = worldOf({ hack: 4.0, blade: 9.0 }, { hack: 0.97, blade: 0.12 }, choice, { hack: 0.15, blade: 0.05 })
    const d = clearTime(2, lv, draw, S, ROUTES)
    const want = 9.0 * ex(Math.sqrt(0.12 ** 2 - 0.05 ** 2))
    c.examined(1)
    c.note(`draw hack 4.0h / blade 9.0h (its own expected cheapest is hack: 4.0 x ${ex(0.97).toFixed(2)}): ${d.via} ${d.h.toFixed(3)}h`)
    if (d.via !== 'blade' || Math.abs(d.h - want) > 1e-9) c.fail(`the draw must play the committed route blade at ${want.toFixed(4)}h (never the draw's own cheapest), got ${d.via} ${d.h}`)
    out.push(c)
  }
  {
    const c = new Check('RC3', "routeErrOf: the band's part a drawn world does not carry")
    const econ = { routeErr: { sdOf: (id, n) => RC.routeSdOf(id, n, { hacking: { pooled: 0.4, nodes: { 2: 0.97 } }, blade: { pooled: 0.12, nodes: {} } }), kSd: 0.05 }, ownG: new Map([[2, 0.138]]), gSd: new Map() }
    const re = routeErrOf(econ, { g2: 0.3 }, { sigmaPlayed: 0.15 })
    const cases = [
      ['hack', 2, ex(Math.sqrt(0.97 ** 2 - 0.15 ** 2)), 'BN2 (played): 0.97 less its g sd 0.15'],
      ['stanek', 2, ex(Math.sqrt(0.97 ** 2 - 0.15 ** 2)), 'stanek is the hacking family'],
      ['hack', 5, 1, 'an unplayed node: its draws carry the predictive'],
      ['blade', 2, ex(Math.sqrt(0.12 ** 2 - 0.05 ** 2)), "blade: 0.12 less k's 0.05"],
    ]
    if (re.isChoice) c.fail('a world with a draw (z non-empty) is not the choice world')
    if (!routeErrOf(econ, {}, { sigmaPlayed: 0.15 }).isChoice) c.fail('the world with no draw is the choice world')
    for (const [id, n, want, what] of cases) {
      c.examined(1)
      const got = re.extraFactor(id, n)
      if (!(Math.abs(got - want) < 1e-9)) c.fail(`${what}: extraFactor ${got}, want ${want}`)
    }
    if (!(Math.abs(re.fullFactor('hack', 2) - ex(0.97)) < 1e-12)) c.fail(`fullFactor(hack, BN2) must be exp(0.97^2/2), got ${re.fullFactor('hack', 2)}`)
    out.push(c)
  }
  {
    const c = new Check('RC4', "routecal.routeSdOf: max(the family's pooled error, the node's own); BN2's hacking miss is in the live table")
    const cal = { hacking: { pooled: 0.4, nodes: { 2: -0.97, 9: 0.02 } }, blade: { pooled: 0.12, nodes: {} } }
    const cases = [
      [RC.routeSdOf('hack', 2, cal), 0.97, 'hack BN2: its own |r|'],
      [RC.routeSdOf('stanek', 2, cal), 0.97, 'stanek BN2: the hacking family'],
      [RC.routeSdOf('go', 9, cal), 0.4, 'go BN9: own 0.02 < pooled'],
      [RC.routeSdOf('blade', 2, cal), 0.12, 'blade BN2: pooled'],
      [RC.routeSdOf('bladeStanek', 2, cal), 0.12, 'bladeStanek: the blade family'],
      [RC.routeSdOf('hack', 2, null), 0, 'no table: no band'],
    ]
    for (const [got, want, what] of cases) {
      c.examined(1)
      if (!(Math.abs(got - want) < 1e-12)) c.fail(`${what}: ${got}, want ${want}`)
    }
    const live = RC.routeSdOf('hack', 2, RC.ROUTE_CAL)
    c.note(`live table ${RC.ROUTE_CAL.measuredAt}: hacking pooled ${RC.ROUTE_CAL.hacking?.pooled}, BN2 ${live}; blade pooled ${RC.ROUTE_CAL.blade?.pooled}`)
    if (!(live >= 0.9)) c.fail(`the live table must carry BN2's measured hacking miss (+163% leave-one-out: |ln 0.38| = 0.97), got s ${live}`)
    if (!(RC.routeSdOf('hack', 2, RC.ROUTE_CAL) > RC.routeSdOf('blade', 2, RC.ROUTE_CAL))) c.fail("BN2's hacking band must be wider than its Bladeburner band in the live table")
    out.push(c)
  }
  {
    const c = new Check('RC5', 'the live route decision decides on the expected arms: the band flips a hair-thin hacking lead to blade on BN2')
    const mults = { strength: 1.12, defense: 1.12, dexterity: 1.12, agility: 1.12, charisma: 1.12, strength_exp: 1.15, defense_exp: 1.15, dexterity_exp: 1.15, agility_exp: 1.15, charisma_exp: 1.15, bladeburner_success_chance: 1, bladeburner_max_stamina: 1, bladeburner_stamina_gain: 1 }
    const person = { skills: { hacking: 900, strength: 300, defense: 300, dexterity: 300, agility: 300, charisma: 250, intelligence: 131 }, exp: Object.fromEntries(['strength', 'defense', 'dexterity', 'agility', 'charisma'].map((k) => [k, BB.expForLevel(300, 1.12)])), mults }
    const tel = { joined: true, rank: 399000, skillPoints: 0, blackOps: { done: 20 }, levels: { "Blade's Intuition": 260, 'Digital Observer': 230, 'Short-Circuit': 110, Cloak: 130, Reaper: 190, 'Evasive System': 190, Overclock: 90, "Cyber's Edge": 80, Tracer: 5 } }
    const s0 = BB.bladeStartOf({ tel, person, sleeves: { infiltrate: 5, support: 0, fa: 0 }, gymExpPerSec: 37.661, install: null })
    const trajGen = function* (x) {
      return x.fakeH
    }
    const go = (hackH, extra) => drain(P.decideBladeRouteGen({ base: { fakeH: hackH, cycleHours: 2 }, traj: (x) => x.fakeH, trajGen, bladeStart: s0, ...extra }))
    const ref = go(50, { draws: [], post: false })
    const bladeH = ref.bladeH
    c.examined(1)
    if (!(bladeH > 0)) {
      c.fail(`the Bladeburner arm must price (got ${bladeH})`)
      out.push(c)
      return out
    }
    const hackH = bladeH * 0.97
    const draws = P.makeDraws({ drift: { s: 0.01, nu: 4, a: 2, b: 0.0002 } }, 48, 7)
    const noNode = go(hackH, { draws: [], post: false })
    const bn2 = go(hackH, { draws: [], post: false, node: 2 })
    const flat = go(hackH, { draws: [], post: false, node: 2, routeCal: { hacking: { pooled: 0.12, nodes: {} }, blade: { pooled: 0.12, nodes: {} } } })
    const postNo = go(hackH, { draws, post: true, budgetMs: 1e9 })
    const postBn2 = go(hackH, { draws, post: true, budgetMs: 1e9, node: 2 })
    c.examined(5)
    c.note(`points hack ${hackH.toFixed(3)}h blade ${bladeH.toFixed(3)}h; BN2 band: ${JSON.stringify(bn2.routeCal)}; with draws ${postNo.key} -> ${postBn2.key} (${(postBn2.options ?? []).map((o) => `${o.key} ${o.meanH}h`).join(', ')})`)
    if (noNode.key !== 'hack') c.fail(`no node (no band): the point comparison must stand at hack, got ${noNode.key}`)
    if (bn2.key !== 'blade') c.fail(`BN2 (hacking band ${RC.routeSdOf('hack', 2)}): the expected points must choose blade, got ${bn2.key}`, bn2.why)
    if (bn2.routeCal?.flips !== true || bn2.routeCal?.priced !== true) c.fail('the record must say the band flipped the point comparison', JSON.stringify(bn2.routeCal))
    if (flat.key !== 'hack') c.fail(`equal bands leave the points' order: hack, got ${flat.key}`)
    if (postNo.key !== 'hack') c.fail(`with draws and no node the decision must stay hack, got ${postNo.key}`)
    if (postBn2.key !== 'blade') c.fail(`with draws at BN2 the band must move the decision to blade, got ${postBn2.key}`, postBn2.why)
    const mh = (postBn2.options ?? []).find((o) => o.key === 'hack')?.meanH
    if (!(mh > hackH * 1.2)) c.fail(`the hacking arm's mean must carry its band (E ~ point x ${ex(RC.routeSdOf('hack', 2)).toFixed(2)}), got ${mh} vs point ${hackH.toFixed(3)}`)
    out.push(c)

    // RC7: NO COMMITTED ROUTE — the expected points are the incumbent; a noisy Monte Carlo cannot take it
    const c7 = new Check('RC7', "no committed route: the expected points' route holds unless the draws show the other wins by more than the value of waiting (entry dry-run BN2.2)")
    {
      // the hacking arm slower on its point, its draws heavy-tailed around a mean a hair under the blade's
      const hp = bladeH * 1.4
      const pat = [0.25, 1.55, 0.3, 1.5]
      const tgN = function* (x, d = null) {
        return d ? bladeH * pat[d.i % pat.length] * 0.94 : x.fakeH
      }
      const r = drain(P.decideBladeRouteGen({ base: { fakeH: hp, cycleHours: 2 }, traj: (x, d) => drain(tgN(x, d)), trajGen: tgN, bladeStart: s0, draws, post: true, budgetMs: 1e9 }))
      const hm = (r.options ?? []).find((o) => o.key === 'hack')?.meanH
      const bm = (r.options ?? []).find((o) => o.key === 'blade')?.meanH
      c7.examined(1)
      c7.note(`points hack ${hp.toFixed(3)}h blade ${bladeH.toFixed(3)}h; draw means hack ${hm}h blade ${bm}h -> ${r.key} (${r.incumbent ?? '-'}): ${String(r.why).slice(0, 200)}`)
      if (!(hm < bm)) c7.fail(`the fixture must have the hacking arm's draw mean under the blade's (the noise that picked 'hack'), got hack ${hm} blade ${bm}`)
      if (r.key !== 'blade') c7.fail(`the expected points choose blade and the draws do not resolve the other: the route must stay blade, got ${r.key}`, r.why)
      if (r.incumbent !== 'expected points') c7.fail('the record must say the expected points were the incumbent', JSON.stringify({ incumbent: r.incumbent }))
    }
    out.push(c7)

    // RC8: THE GIFT MOVED — a route decided on the chain is re-decided once the gift is accepted (never held)
    const c8 = new Check('RC8', 'the gift accepted after a chained route decision re-decides the route; held, it kept hack at 23.3h against blade 15.9h (entry dry-run BN2.2)')
    {
      const prevHack = { key: 'hack', meanH: bladeH + 2, decidedAt: new Date().toISOString(), gift: { priced: true, chain: true } }
      const giftAcc = { chain: false, hackOptions: [{ src: 'the placed layout', inputs: { fakeH: bladeH + 2, cycleHours: 2 }, withGift: true }], bladeOptions: [{ src: 'keep the placed layout', make: null }], switchCostH: 0.2 }
      const run = (prev) => drain(P.decideBladeRouteGen({ base: { fakeH: bladeH + 2, cycleHours: 2 }, traj: (x) => x.fakeH, trajGen, bladeStart: s0, draws, post: true, budgetMs: 1e9, prev, redecide: false, gift: giftAcc }))
      const r = run(prevHack)
      const same = run({ ...prevHack, gift: { priced: true, chain: false } })
      c8.examined(2)
      c8.note(`accepted after the chain: ${r.key} (held ${r.held === true}; ${String(r.why).slice(0, 160)}); the gift unchanged: ${same.key} held ${same.held === true}`)
      if (r.key !== 'blade' || r.held === true) c8.fail(`the gift moved (chain -> accepted): the route must re-decide to blade (2h under the hacking arm), got ${r.key} held ${r.held}`, r.why)
      if (same.held !== true || same.key !== 'hack') c8.fail(`with the gift unchanged and no event the decision holds (the hysteresis stands), got ${same.key} held ${same.held}`)
    }
    out.push(c8)

    // RC9: THE EXPECTED POINTS CROSSED — a held route whose expected order turned over since the last pass re-decides
    const c9 = new Check('RC9', "a held route re-decides once when both arms' expected points cross against it (entry dry-run BN2.3: hack held from the boot pass at blade 34.9h, blade 11.7h at the entry)")
    {
      const at = new Date().toISOString()
      const prevOf = (hackE, bladeE) => ({ key: 'hack', meanH: bladeH + 2, decidedAt: at, routeCal: { priced: true, hacking: { expectedH: hackE }, blade: { expectedH: bladeE } } })
      const run = (prev) => drain(P.decideBladeRouteGen({ base: { fakeH: bladeH + 2, cycleHours: 2 }, traj: (x) => x.fakeH, trajGen, bladeStart: s0, draws, post: true, budgetMs: 1e9, prev, redecide: false, node: 2 }))
      const crossed = run(prevOf(1, 5))
      const steady = run(prevOf(5, 1))
      c9.examined(2)
      c9.note(`crossed: ${crossed.key} held ${crossed.held === true} (${String(crossed.redecideWhy ?? crossed.why).slice(0, 160)}); not crossed: ${steady.key} held ${steady.held === true}`)
      if (crossed.key !== 'blade' || crossed.held === true) c9.fail(`the expected points crossed (hack -> blade) against the held hack: re-decide to blade, got ${crossed.key} held ${crossed.held}`, crossed.why)
      if (steady.held !== true || steady.key !== 'hack') c9.fail(`the expected order unchanged since the last pass: the decision holds, got ${steady.key} held ${steady.held}`)
    }
    out.push(c9)

    // RC10: THE NODE'S RULE IS AN INPUT TO THE DECISION (BN15.1 entry dry-run, 2026-10-25). Wrapped AFTER a
    // decision priced on the hacking route (routepin.nodeRouteOf alone), the record kept the hacking
    // distribution (published as "the Bladeburner route": q50 29.9h beside a 147.9h black-op point) and the
    // chain's accept followed hack + gift (26.2h vs 27.0h) while the black-op arm the stack acted on priced the
    // gift worse (150.3h vs 147.9h): the accept flipped one pass later.
    const c10 = new Check('RC10', "the node rule decides INSIDE the route decision: the acted route's distribution, its gift accept, the comparison only published (BN15.1 entry dry-run)")
    {
      const RP0 = await import('routepin.js')
      // the rule as it binds while the labyrinth route is not built (labReady false): labroute.test.mjs LR4/LR9 cover labReady true
      const OFF = { ...RP0.NODE_ROUTE_RULES, 15: { ...RP0.NODE_ROUTE_RULES[15], labReady: false } }
      const RP = { ...RP0, nodeRuleOf: (n, p) => RP0.nodeRuleOf(n, p, OFF), nodeRouteOf: (d, n, p) => RP0.nodeRouteOf(d, n, p, OFF) }
      const PL = await import('plan.js')
      const hp = bladeH * 0.2
      // the chain: hack + gift faster than hack; the black ops priced without the gift only (bladeWithGift false)
      const chain = { chain: true, hackOptions: [{ src: 'without the gift', inputs: { fakeH: hp, cycleHours: 2 }, withGift: false }, { src: 'accept now + the hacking layout', f: 0.2, inputs: { fakeH: hp * 0.95, cycleHours: 2 }, withGift: true }], bladeOptions: [{ src: 'without the gift', make: null }], switchCostH: 0.2 }
      const rule = RP.nodeRuleOf(15, null)
      const run = (extra) => drain(P.decideBladeRouteGen({ base: { fakeH: hp, cycleHours: 2 }, traj: (x) => x.fakeH, trajGen, bladeStart: s0, draws, post: true, budgetMs: 1e9, prev: null, gift: chain, ...extra }))
      const free = run({})
      const ruled = run({ rule })
      const wrapped = RP.nodeRouteOf(free, 15, null)
      const bladeRow = (free.options ?? []).find((o) => o.key === 'blade')
      const ruledRow = (ruled.options ?? []).find((o) => o.key === 'blade')
      c10.examined(8)
      c10.note(`free: ${free.key} q50 ${free.q50}h accept ${free.gift?.accept}; ruled: ${ruled.key} q50 ${ruled.q50}h accept ${ruled.gift?.accept} nodeRule ${JSON.stringify(ruled.nodeRule)}; wrapped dist ${JSON.stringify(RP.routeDistOf(wrapped, 'blade'))}`)
      if (!rule || rule.route !== 'blade') c10.fail('routepin.nodeRuleOf(15) must bind the black ops while the labyrinth route is not built', JSON.stringify(rule))
      if (RP.nodeRuleOf(15, { pinned: true, file: RP.ROUTE_PIN, route: 'hack' }) !== null) c10.fail('/route-pin.txt still wins over the node rule')
      if (RP.nodeRuleOf(6, null) !== null) c10.fail('no rule outside BN15')
      if (free.key !== 'hack' || free.gift?.accept !== true) c10.fail('the fixture: unruled, hack + gift wins and the chain accepts', JSON.stringify({ key: free.key, accept: free.gift?.accept }))
      if (ruled.key !== 'blade') c10.fail(`under the rule the decision is the black ops, got ${ruled.key}`, ruled.why)
      if (ruled.gift?.accept !== false) c10.fail("under the rule the chain's accept follows the black-op arm (priced without the gift only): false, never hack + gift's true", JSON.stringify(ruled.gift?.accept))
      if (!(ruledRow && Math.abs(ruled.q50 - ruledRow.q50) < 1e-9 && (ruled.options ?? []).every((o) => o.key === 'blade'))) c10.fail("the ruled record's distribution must be the black-op option's, and its only option", JSON.stringify({ q50: ruled.q50, row: ruledRow, keys: (ruled.options ?? []).map((o) => o.key) }))
      if (!(ruled.nodeRule?.inDecision === true && ruled.nodeRule.forced === true && ruled.nodeRule.pricedKey === 'hack' && Math.abs(ruled.hackH - hp * 0.95) < 1e-3)) c10.fail('the comparison is published, never decided on: nodeRule {inDecision, forced, pricedKey hack} and hackH (the hacking arm with its best gift option)', JSON.stringify({ nodeRule: ruled.nodeRule, hackH: ruled.hackH }))
      c10.examined(5)
      if (RP.nodeRouteOf(ruled, 15, null) !== ruled) c10.fail('nodeRouteOf leaves a record decided under the rule unchanged')
      if (RP.unpinnedOf(ruled)?.key !== 'blade') c10.fail("unpinnedOf keeps a ruled record's key (it is the decision's): the commitment rule runs on blade", JSON.stringify(RP.unpinnedOf(ruled)?.key))
      const rep = RP.routeReportOf({ pinned: false }, ruled, null)
      if (rep.route !== 'blade' || rep.priced !== 'hack' || RP.routeHealthOf({ route: { ...rep, node: 15 } }).length) c10.fail('the report: acted blade, the comparison hack, no ROUTE NOT THE PRICED ONE', JSON.stringify({ rep, h: RP.routeHealthOf({ route: { ...rep, node: 15 } }) }))
      // a record wrapped after the decision (an old record, or a pin): its fields are hack's; the exit reads blade's row
      const wd = RP.routeDistOf(wrapped, 'blade')
      if (wrapped.key !== 'blade' || !(wd && bladeRow && wd.q50 === bladeRow.q50 && wd.of === 'option row' && Math.abs(wrapped.q50 - free.q50) < 1e-12)) c10.fail("routeDistOf on a record wrapped after the decision reads the black-op option row, never the hacking fields", JSON.stringify({ wd, bladeRow: bladeRow?.q50, fields: wrapped.q50 }))
      if (RP.routeDistOf(ruled, 'blade')?.of !== 'decision') c10.fail('routeDistOf on a ruled record reads its own fields')
      if (PL.bladeMootOf({ bladeRoute: { key: 'blade' }, install: { key: null } }).on !== true) c10.fail("the hacking arm's decisions are moot on the acted black ops before the install decision prices them")
    }
    out.push(c10)
  }
  {
    const c = new Check('RC6', 'the wiring: progress.js names the node to the route decision; the gameplan plans on the band by default')
    const prog = fs.readFileSync(path.join(REPO_ROOT, 'progress.js'), 'utf8')
    const plan = fs.readFileSync(path.join(REPO_ROOT, 'tools/sim/gameplan/plan.mjs'), 'utf8')
    c.examined(2)
    if (!/yield\* decideBladeRouteGen\(\{[^\n]*\bnode: info\.currentNode\b[^\n]*\}\)/.test(prog)) c.fail('progress.js bladeRouteOf must pass node: info.currentNode to decideBladeRouteGen (no node = no band)')
    if (!/const ROUTE_RULE = arg\('--route-rule', has\('--phase1'\) \? 'point' : 'expected'\)/.test(plan) || !/if \(ROUTE_RULE === 'expected'\) econ\.routeErr = ROUTE_ERR/.test(plan)) c.fail('plan.mjs must plan on the band by default (--route-rule expected sets econ.routeErr)')
    out.push(c)
  }
  return out
}
