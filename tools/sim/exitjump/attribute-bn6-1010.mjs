// THE BLACK-OP EXIT ACROSS AN INSTALL — which input group moved it.
//
//   node tools/sim/exitjump/attribute-bn6-1010.mjs [--model path/to/bbplan.js] [fixture.json]
//
// Live BN6 2026-10-02: the 10:10:17Z install (20 augs, Bladeburner route)
// priced the next life at 18.65h (plan 'now' mean 18.69h); the new life's
// 10:18Z pass published 3.41h (EXIT JUMP AT INSTALL -15.1h), then 13.39h
// (10:28Z) and 14.35h (10:33Z, held, no event: EXIT UNSTABLE).
//
// Fixture tools/test/fixture-bn6-exitjump-1010.json (mkfix-bn6-1010.py).
// Each pass's start is rebuilt the way progress.js bladeRouteOf builds it
// (bbplan.bladeStartOf): the player at the pass (history.jsonl exp, the
// save's multipliers — divided by the batch's gains before the install),
// /tel/bladeburner.txt (10:35Z) with the pass's own rank, best city, stamina
// and skill levels, the fleet the pass priced (state.fleet), its install
// basis (the previous pass's decisions.install) and calibration. The CHECK
// lines reproduce each pass's published bladeH before anything is
// attributed.
//
// THE ATTRIBUTION: the install's own projection of the new life — the 10:10
// pass's 'now' option, the bladeExit state just after its install step
// (stats retrained to the bar, the batch's multipliers, the rest as before),
// so its exit is the pre point less the retrain — swapped group by group
// with the new life's actual inputs at a pass ("proj + group") and back
// ("post - group"): the two columns disagree where groups interact.
import '../../test/gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO_ROOT } from '../../test/gameresolve.mjs'

// The command line is ours only when a tools/sim script is the entry point (the tests import this module under their own argv).
const argv = /tools\/sim\//.test(process.argv[1] ?? "") ? process.argv.slice(2) : []
const mi = argv.indexOf('--model')
const modelPath = mi > -1 ? path.resolve(argv[mi + 1]) : path.join(REPO_ROOT, 'bbplan.js')
const rest = argv.filter((a, i) => a !== '--model' && argv[i - 1] !== '--model')
export const BB = await import(pathToFileURL(modelPath).href)
const BP = await import('bodyplan.js')
const SP = await import('sleeveplan.js')
const { drain } = await import('coop.js')

export const F = JSON.parse(fs.readFileSync(rest[0] ?? path.join(REPO_ROOT, 'tools/test/fixture-bn6-exitjump-1010.json'), 'utf8'))
const ms = (s) => Date.parse(s)
export const INSTALL_AT = ms(F.installLast.at)
const COMBAT = ['strength', 'defense', 'dexterity', 'agility', 'charisma']
const statsOf = (n) => F.augstats[n] ?? null
export const BATCH = BB.bladeContentOf(F.installLast.batch, statsOf)

/** The player's multipliers before the install: the save's (after) over the batch's gains. */
function multsAt(atMs) {
  const m = { ...F.save.player.mults }
  if (atMs < INSTALL_AT) for (const [k, g] of Object.entries(BATCH.gains)) m[k] = m[k] / g
  return m
}
/**
 * exp at a time, between the history rows of the same life (~5 min apart).
 * Linear, except across the retrain: there ONE stat trains at a time (a gym
 * class per leg, strength -> defense -> dexterity -> agility), so a row pair
 * spanning a leg change is split sequentially at the gym's per-stat rates
 * (the interval's time shared in proportion if the rates disagree) — a
 * linear blend put dexterity at 138 at 10:23:21Z when its leg had only
 * started (62), and the model then skipped its leg.
 */
function expAt(atMs) {
  const life = F.history.filter((r) => (ms(r.at) < INSTALL_AT) === (atMs < INSTALL_AT))
  let a = life[0]
  for (const b of life) {
    if (ms(b.at) >= atMs) {
      if (ms(b.at) === ms(a.at)) return { ...b.exp }
      const T = (ms(b.at) - ms(a.at)) / 1000
      const e = Math.max(0, Math.min(T, (atMs - ms(a.at)) / 1000))
      const out = {}
      for (const k of Object.keys(b.exp)) out[k] = a.exp[k] + (e / T) * (b.exp[k] - a.exp[k])
      if (a.work === 'ClassWork' || b.work === 'ClassWork') {
        const m = multsAt(atMs)
        const p = { mults: m, city: F.save.player.city, money: 1e9 }
        const r0 = BP.gymRate(BP.bestGym(p), 'strength', p, 1)
        const need = ['strength', 'defense', 'dexterity', 'agility'].map((k) => ({ k, s: Math.max(0, b.exp[k] - a.exp[k]) / (r0 * (m[`${k}_exp`] / m.strength_exp)) }))
        const tot = need.reduce((x, n) => x + n.s, 0)
        let left = tot > 0 ? (e * tot) / T : 0 // the interval's elapsed share, in leg-seconds
        for (const n of need) {
          const take = Math.min(left, n.s)
          out[n.k] = a.exp[n.k] + (n.s > 0 ? (take / n.s) * (b.exp[n.k] - a.exp[n.k]) : 0)
          left -= take
        }
      }
      return out
    }
    a = b
  }
  return { ...a.exp }
}
export function personAt(atMs) {
  const mults = multsAt(atMs)
  const exp = expAt(atMs)
  const skills = { ...F.save.player.skills }
  for (const st of COMBAT) skills[st] = BB.levelFromExp(exp[st], mults[st])
  return { skills, exp, mults, city: F.save.player.city, money: 1e9 }
}
/** Stamina at a time (the daemon's minute samples since the install); null before them. */
function staminaAt(atMs) {
  const S = F.bladeburner.samples
  if (atMs < ms(S[0].at)) return null
  let a = S[0]
  for (const b of S) {
    if (ms(b.at) >= atMs) return a.stamina + ((b.stamina - a.stamina) * (atMs - ms(a.at))) / (ms(b.at) - ms(a.at) || 1)
    a = b
  }
  return a.stamina
}
// The 10:10:21Z purchases (after the 10:10:17 install): the levels before them.
const PURCHASES = F.bladeburner.purchases.filter((p) => ms(p.at) >= INSTALL_AT)
export function telAt(pass, atMs) {
  const t = structuredClone(F.bladeburner)
  t.rank = pass.bladeRoute.rank
  t.blackOps = { ...t.blackOps, done: pass.bladeRoute.blackOps }
  if (atMs < INSTALL_AT) {
    for (const p of PURCHASES) {
      t.levels[p.name] -= p.got
      t.skillPoints += p.cost
    }
  }
  // The best city the pass read (state.best): its true population then. A
  // city read that pass as another's runner-up is left at what it read later
  // only where the pass shows it was not the best (else at its estimate).
  const best = pass.bladeRoute.state?.best
  for (const c of t.cities) {
    if (best && c.name === best.name) c.pop = best.pop
    else if (best && Number.isFinite(c.pop) && c.pop > best.pop) c.pop = null
  }
  // The daemon's skill clock: after the install its first spend was 10:10:21Z (the purchases); before it, unknown (spends at once).
  t.skillsAt = atMs >= INSTALL_AT && PURCHASES.length ? PURCHASES[0].at : null
  const s = staminaAt(atMs)
  if (s === null) {
    delete t.stamina
    delete t.maxStamina
  } else {
    t.stamina = s
    t.maxStamina = null // from the formula at the pass's agility (calibration: formula = game)
  }
  return t
}
export const FLEETS = { i0s0f0: { infiltrate: 0, support: 0, fa: 0 } }
export const fleetOf = (key) => {
  const m = /^i(\d+)s(\d+)f(\d+)$/.exec(key ?? 'i0s0f0')
  return { infiltrate: +m[1], support: +m[2], fa: +m[3] }
}
/** The install basis a pass priced its blade arm on (plan.basisOf of the previous pass's decision). */
export function basisAt(i) {
  const pass = F.passes[i]
  const b = pass.bladeRoute.installBasis
  if (!b || b.kind !== 'wait') return null
  const prev = F.passes[i - 1]?.install
  const blade = prev?.spec?.blade ?? null
  return { kind: 'wait', waitH: Math.max(0, (b.installAt - ms(pass.at)) / 3.6e6), installAt: b.installAt, blade }
}
/** The pass's inputs as groups (each a piece of bladeStartOf's arguments). */
export function inputsAt(i, { atMs = null, basis = undefined } = {}) {
  const pass = F.passes[i]
  const at = atMs ?? ms(pass.at)
  const person = personAt(at)
  const cal = pass.bladeRoute.calibration
  return {
    at,
    person,
    tel: telAt(pass, at),
    sleeves: fleetOf(pass.bladeRoute.state?.fleet),
    install: basis === undefined ? basisAt(i) : basis,
    rankScale: cal.rank.applied,
    successScale: cal.success.applied,
  }
}
export function startOf(x, extra = {}) {
  const gym = BP.bestGym(x.person)
  const tel = { ...x.tel }
  if (tel.stamina !== undefined && tel.maxStamina === null) tel.maxStamina = BB.maxStaminaOf(x.person, BB.skillMultsOf(tel.levels), tel.staminaBonus ?? 0)
  return BB.bladeStartOf({ tel, person: x.person, sleeves: x.sleeves, gymExpPerSec: BP.gymRate(gym, 'strength', x.person, 1), bnRank: 1, skillCostMult: 1, install: BB.bladeInstallOfSpec(x.install), simulacrum: false, rankScale: x.rankScale, successScale: x.successScale, now: x.at, ...extra })
}
export const hoursOf = (x, extra = {}) => BB.bladeExit({ ...startOf(x, extra), ...extra }).hours

// --- the projection: the 10:10 'now' option's state just after its install --
export const PRE = F.passes.findIndex((p) => p.install?.key === 'now' && ms(p.at) < INSTALL_AT && ms(p.at) > INSTALL_AT - 6 * 60e3)
/**
 * The new life as the install priced it: the pre pass's inputs with the
 * install applied the way bladeExitGen applies it (multipliers x the batch,
 * every exp 0, the retrain to the policy's bar at the gym) and no install
 * left in it. `retrainH` is what the model charged for the retrain.
 */
export function projection() {
  const x = inputsAt(PRE, { basis: null })
  const mults = { ...x.person.mults }
  for (const [k, g] of Object.entries(BATCH.gains)) mults[k] = (mults[k] ?? 1) * g
  const gym = BP.bestGym({ ...x.person, mults })
  const rate0 = BP.gymRate(BP.bestGym(x.person), 'strength', x.person, 1)
  const zero = { ...x.person.exp }
  for (const st of COMBAT) zero[st] = 0
  const target = Math.max(BB.JOIN_COMBAT, BB.POLICY.gymTo)
  let exp
  let secs
  if (typeof BB.retrainOf === 'function') {
    // The model's own retrain (legs at the policy's pass cadence), at the rate the start was priced with.
    const r = BB.retrainOf({ ...x.person, exp: zero, mults }, rate0, x.person.mults.strength_exp, target)
    exp = r.exp
    secs = r.secs
  } else {
    // The model as shipped before 2026-10-02: exp to the bar at the start's gym rate.
    exp = { ...zero }
    let need = 0
    for (const st of ['strength', 'defense', 'dexterity', 'agility']) {
      exp[st] = BB.expForLevel(target, mults[st])
      need += exp[st]
    }
    secs = need / rate0
  }
  void gym
  const skills = { ...x.person.skills }
  for (const st of COMBAT) skills[st] = BB.levelFromExp(exp[st], mults[st])
  // The daemon restarts at the install: it spends at once (no skill clock).
  return { ...x, tel: { ...x.tel, skillsAt: null }, person: { ...x.person, skills, exp, mults }, retrainH: secs / 3600 }
}

export const GROUPS = {
  'combat retrain (stats, exp)': (to, from) => ({ ...to, person: { ...to.person, skills: from.person.skills, exp: from.person.exp } }),
  'stamina (now, max)': (to, from) => ({ ...to, tel: { ...to.tel, stamina: from.tel.stamina, maxStamina: from.tel.maxStamina } }),
  'posteriors (success, rank)': (to, from) => ({ ...to, successScale: from.successScale, rankScale: from.rankScale }),
  'city populations': (to, from) => ({ ...to, tel: { ...to.tel, cities: from.tel.cities } }),
  'skill levels / points': (to, from) => ({ ...to, tel: { ...to.tel, levels: from.tel.levels, skillPoints: from.tel.skillPoints } }),
  'multipliers (combat, bladeburner_*)': (to, from) => ({ ...to, person: { ...to.person, mults: from.person.mults, skills: levelled(to.person.exp, from.person.mults, to.person.skills) } }),
  'rank / black ops / counts': (to, from) => ({ ...to, tel: { ...to.tel, rank: from.tel.rank, blackOps: from.tel.blackOps, counts: from.tel.counts, maxLevels: from.tel.maxLevels } }),
  'fleet (sleeves)': (to, from) => ({ ...to, sleeves: from.sleeves }),
  'install basis': (to, from) => ({ ...to, install: from.install }),
  'skill clock (daemon)': (to, from) => ({ ...to, tel: { ...to.tel, skillsAt: from.tel.skillsAt } }),
}
/** The fleet sleeve.js commits on a start (its search: sleeveplan.bladeFleetGen, 200h bound, the incumbent kept on a near tie), or the zero fleet. */
export function fleetPick(x, incumbent = null, n = F.save.sleeves.length) {
  const r = drain(SP.bladeFleetGen({ ...startOf(x), maxH: 200 }, n, incumbent))
  return { sleeves: r.config ?? { infiltrate: 0, support: 0, fa: 0 }, committed: !!r.config, hours: r.hours, why: r.why }
}
/** The 10:28Z pass's w1.46 option and the 10:33Z pass's held commitment: one install (same installAt and batch), two passes. */
export function heldPair() {
  const spec = F.passes[5].install.spec
  const b = (i) => ({ kind: 'wait', installAt: spec.installAt, waitH: (spec.installAt - ms(F.passes[i].at)) / 3.6e6, blade: spec.blade })
  return { a: inputsAt(5, { basis: b(5) }), b: inputsAt(6, { basis: b(6) }), publishedA: F.passes[5].install.pointH, publishedB: F.passes[6].install.pointH }
}
function levelled(exp, mults, skills) {
  const out = { ...skills }
  for (const st of COMBAT) out[st] = BB.levelFromExp(exp[st] ?? 0, mults[st])
  return out
}
/** proj + group / post - group, each against its own base. */
export function attribute(proj, post) {
  const h = (x) => hoursOf(x)
  const a = h(proj)
  const b = h(post)
  const rows = []
  for (const [name, swap] of Object.entries(GROUPS)) {
    const pg = h(swap(proj, post))
    const mg = h(swap(post, proj))
    rows.push({ group: name, plus: pg === null || a === null ? null : +(pg - a).toFixed(2), minus: mg === null || b === null ? null : +(b - mg).toFixed(2) })
  }
  return { projH: a, postH: b, rows }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isMain) {
  const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x))
  console.log(`model: ${path.relative(REPO_ROOT, modelPath)}; batch gains ${JSON.stringify(BATCH.gains)}`)
  console.log('CHECK — each pass\'s blade arm, replayed (published bladeH):')
  for (let i = 0; i < F.passes.length; i++) {
    const p = F.passes[i]
    const x = inputsAt(i)
    const r = hoursOf(x)
    const pub = p.bladeRoute.bladeH
    console.log(`  ${p.at.slice(11, 19)} fleet ${p.bladeRoute.state?.fleet} basis ${x.install ? 'w' + x.install.waitH.toFixed(2) : 'none'} str/agi ${x.person.skills.strength}/${x.person.skills.agility} stamina ${f2(x.tel.stamina)}: replay ${f2(r)}h vs published ${f2(pub)}h (${Number.isFinite(r) && Number.isFinite(pub) ? ((100 * (r - pub)) / pub).toFixed(1) + '%' : '-'})`)
  }
  const proj = projection()
  console.log(`\nPROJECTION (the 10:10 'now' option after its install): retrain ${proj.retrainH.toFixed(3)}h, then ${f2(hoursOf(proj))}h`)
  for (const k of [2, 3, 5, 6]) {
    const post = inputsAt(k, { basis: null })
    const el = (ms(F.passes[k].at) - INSTALL_AT) / 3.6e6
    const at = attribute(proj, post)
    console.log(`\nvs the ${F.passes[k].at.slice(11, 19)} pass (${el.toFixed(2)}h into the life, no install in either): proj ${f2(at.projH)}h  post ${f2(at.postH)}h  diff ${f2(at.postH - at.projH)}h`)
    for (const r of at.rows) console.log(`  ${r.group.padEnd(40)} proj+group ${String(r.plus).padStart(7)}  post-group ${String(r.minus).padStart(7)}`)
  }
  const hp = heldPair()
  const ha = attribute(hp.a, hp.b)
  console.log(`\nTHE HELD MOVE (one install w1.46, 10:28 -> 10:33Z, published ${hp.publishedA}h -> ${hp.publishedB}h): ${f2(ha.projH)}h -> ${f2(ha.postH)}h`)
  for (const r of ha.rows) console.log(`  ${r.group.padEnd(40)} 10:28+group ${String(r.plus).padStart(7)}  10:33-group ${String(r.minus).padStart(7)}`)
  // AFTER: every pass with the fleet sleeve.js commits on that pass's own start (the gym rate it now has).
  console.log('\nTHE FLEET sleeve.js COMMITS on each pass\'s start (its search, with a gym rate), and the route priced with it:')
  let inc = null
  for (let i = 1; i < F.passes.length; i++) {
    const x = inputsAt(i)
    const pick = fleetPick(x, inc)
    inc = pick.committed ? pick.sleeves : inc
    const el = (ms(F.passes[i].at) - INSTALL_AT) / 3.6e6
    console.log(`  ${F.passes[i].at.slice(11, 19)} (${el.toFixed(2)}h) fleet ${JSON.stringify(pick.sleeves)}: route ${f2(hoursOf({ ...x, sleeves: pick.sleeves }))}h, no install ${f2(hoursOf({ ...x, sleeves: pick.sleeves, install: null }))}h`)
  }
  const pre = inputsAt(PRE, { basis: null })
  const prePick = fleetPick(pre)
  const nowSpec = { kind: 'wait', waitH: 0, installAt: INSTALL_AT, blade: { gains: BATCH.gains, simulacrum: false } }
  console.log(`  the install's 'now' at 10:10 with that fleet ${JSON.stringify(prePick.sleeves)}: ${f2(hoursOf({ ...pre, sleeves: prePick.sleeves, install: nowSpec }))}h; the projection ${f2(hoursOf({ ...projection(), sleeves: prePick.sleeves }))}h after a ${projection().retrainH.toFixed(2)}h retrain`)
}
