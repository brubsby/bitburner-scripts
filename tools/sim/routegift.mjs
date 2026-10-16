// STANEK'S GIFT L4: THE ROUTE PRICED WITH THE GIFT ACCEPTED — offline, on the decision progress.js runs.
//
//   node tools/sim/routegift.mjs [--tel DIR] [--player FILE] [--case live|bn7.3|bn13|all] [--json]
//
// THE TWO TRAJECTORIES (CLAUDE.md "Decisions compare simulated trajectories"), from one state, both
// conditioned on the accepted gift: 'hack' (the World Daemon exit, exitplan on the exit inputs moved by
// stanekplan.hackGiftInputsOf: the hacking layout's life-average at the hacking charger, every install
// clearing the charge) vs 'blade' (the black ops, bbplan.bladeExit with s0.gift = stanekepoch
// bladeGiftMakerOf: the placed layout's live charge kept, or re-laid to the Bladeburner layout) — through
// plan.decideBladeRouteGen `gift` itself, the function progress.js bladeRouteOf calls (the POINT: the
// posterior draws are the plan's, not replayed here). Genesis's x0.9 is in both starts.
//
// CASES
//   live   the live node from /tel (plan.txt decisions.bladeRoute's start, sleeves and calibrations,
//          exitinputs.txt's inputs, bladeburner.txt, stanek.txt, stanekepoch.txt's duty) and the
//          player's multipliers from the save (--player: {skills, exp, mults, city, money, sourceFiles},
//          read once from getSaveFile, which does not consume the export bonus)
//   bn7.3  the NEXT node's entry: hacking arm = nodechoice freshInputs(7, level 3) at the measured
//          economy latents lo/hi (bb6.mjs: g 0.0405 / 0.1381) with Genesis applied; Bladeburner arm = a
//          fresh division (no division, combat from 0: the gym leg priced) on the save's Source-Files
//          with Genesis, BLADE_LAYOUTS placed at zero charge, the measured charger (BLADE_HOST.measured)
//   bn13   a BN13.2-LIKE case: the hacking arm = the live BN13.1 exit inputs of 2026-10-11 21:03Z
//          (tools/test/fixture-bn13-lifelength-2103.json: the hacking route with the gift, the hacking
//          layout 6x5|2 placed, as measured), the Bladeburner arm = a fresh BN13 division with the
//          HACKING layout placed (what BN13 places at the accept) — so its re-lay to the Bladeburner
//          layout is priced — at the measured charger
//
// CALIBRATION, stated: bladeExit is NOT CALIBRATED live as a whole (rank k and success k are: the live
// case applies decisions.bladeRoute.calibration; the fresh cases apply the same k); exitplan's hacking
// exit is calibrated per node by the plan's posteriors (not replayed here: the point). The fresh cases'
// charger fleet is the live BN7.2 fleet (stated), and their starts are a fresh-entry person, not a save.
import '../test/gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from '../test/gameresolve.mjs'

const P = await import('plan.js')
const BB = await import('bbplan.js')
const sp = await import('stanekplan.js')
const se = await import('stanekepoch.js')
const { drain } = await import('coop.js')
const { bitNodeMults } = await import('bitNodeMultipliers.js')

const args = process.argv.slice(2)
const opt = (k, d = null) => {
  const i = args.indexOf(`--${k}`)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : d
}
const TEL = opt('tel', fs.existsSync(path.join(REPO_ROOT, '.telemetry/plan.txt')) ? path.join(REPO_ROOT, '.telemetry') : path.join(process.env.HOME, 'Repos/bitburner-scripts/.telemetry'))
const readTel = (n) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(TEL, n), 'utf8'))
  } catch {
    return null
  }
}
const fin = (x) => typeof x === 'number' && isFinite(x)
const r3 = (x) => (fin(x) ? +x.toFixed(3) : null)
const lvMults = (m, nm) => ({ ...m, strength: m.strength * nm.StrengthLevelMultiplier, defense: m.defense * nm.DefenseLevelMultiplier, dexterity: m.dexterity * nm.DexterityLevelMultiplier, agility: m.agility * nm.AgilityLevelMultiplier, charisma: m.charisma * nm.CharismaLevelMultiplier })
const GENESIS_KEYS = ['strength', 'defense', 'dexterity', 'agility', 'charisma', 'strength_exp', 'defense_exp', 'dexterity_exp', 'agility_exp', 'charisma_exp', 'hacking', 'hacking_exp', 'hacking_chance', 'hacking_speed', 'hacking_money', 'hacking_grow', 'faction_rep', 'company_rep', 'crime_money', 'crime_success', 'work_money', 'hacknet_node_money'] // Augmentations.ts:1593-1627

/** One route decision with the gift, as bladeRouteOf builds it (the point). */
function decide({ base, basis = null, s0, gift }) {
  const t0 = Date.now()
  const d = drain(P.decideBladeRouteGen({ base, traj: P.trajectoryOf(basis, {}), trajGen: P.trajectoryGenOf(basis, {}), basis, bladeStart: s0, draws: [], post: false, gift }))
  const d0 = drain(P.decideBladeRouteGen({ base, traj: P.trajectoryOf(basis, {}), trajGen: P.trajectoryGenOf(basis, {}), basis, bladeStart: s0, draws: [], post: false }))
  return { key: d.key, hackH: d.hackH, bladeH: d.bladeH, without: { key: d0.key, hackH: d0.hackH, bladeH: d0.bladeH, note: 'the same state, the gift options not applied (the multipliers as they are, no charge growth, no re-lay)' }, gift: d.gift, ms: Date.now() - t0 }
}
function giftArg({ base, st, live, s0, duty = sp.BLADE_HOST.duty, sameLife = true, fH = sp.DEFAULT_F }) {
  const w = st.layout.width
  const h = st.layout.height
  const np = st.layout.nodePower ?? 1
  const tab = sp.layoutForGrid(w, h, np, 'hack')
  const layouts = [['the placed layout', st.layout.placed]]
  if (!sp.sameLayout(st.layout.placed, tab.placed)) layouts.push([`the hacking layout (${tab.source.slice(0, 40)})`, tab.placed])
  const hackOptions = layouts.map(([src, L]) => ({ src: `${src} at f ${fH}`, key: sp.layoutKeyOf(L), inputs: sp.hackGiftInputsOf(base, st, { node: st.node, layout: L, f: fH, sameLife }).inputs })).filter((o) => o.inputs)
  const bladeOptions = se.bladeGiftOptionsOf({ live, width: w, height: h, nodePower: np }).map((o) => ({ src: o.src, key: o.key, make: se.bladeGiftMakerOf({ live, target: o.target, duty, nodePower: np, install: s0?.install ?? null }) }))
  return { hackOptions, bladeOptions, switchCostH: se.ROUTE_GIFT.switchCostH, boundInputsOf: sp.awakeningBoundInputsOf }
}
const zeroLive = (placed, H, w, h, np) => ({ placed: placed.map((p) => ({ id: p.id, x: p.x, y: p.y, rot: p.rot })), charges: placed.map(() => ({ highestCharge: 0, numCharge: 0 })), masses: placed.map(() => 0), mass: 0, H, k: placed.filter((p) => sp.fragmentById(p.id)?.type !== sp.TYPE.Booster).length, at: null, nodePower: np, width: w, height: h })
const freshPerson = (node, sf, intelligence) => {
  const { sfMults } = HE
  const nm = bitNodeMults(node, 1)
  const m = { ...sfMults(sf) }
  for (const k of GENESIS_KEYS) if (fin(m[k])) m[k] *= sp.PENALTY[1]
  return { skills: { hacking: 1, strength: 1, defense: 1, dexterity: 1, agility: 1, charisma: 1, intelligence }, exp: {}, mults: lvMults(m, nm), city: 'Sector-12', money: 1262 }
}
let HE = null

function liveCase() {
  const plan = readTel('plan.txt')
  const br = plan?.decisions?.bladeRoute
  const tel = readTel('bladeburner.txt')
  const ei = readTel('exitinputs.txt')
  const st = readTel('stanek.txt')
  const ep = readTel('stanekepoch.txt')
  const pl = JSON.parse(fs.readFileSync(opt('player'), 'utf8'))
  const node = st.node
  const nm = bitNodeMults(node, 2)
  if (ei.lastAugReset !== st.lastAugReset || plan.lastAugReset !== st.lastAugReset) throw new Error('the /tel records are of different lives')
  const person = { skills: pl.skills, exp: pl.exp, mults: lvMults(pl.mults, nm), city: pl.city, money: pl.money }
  const now = Date.parse(plan.at)
  const s0 = BB.bladeStartOf({ tel, person, sleeves: br.sleeves, gymExpPerSec: br.start.gymExpPerSec, bnRank: nm.BladeburnerRank, skillCostMult: nm.BladeburnerSkillCost, install: BB.bladeInstallOfSpec(plan.decisions.install?.spec ?? null), rankScale: br.calibration.rank.applied, successScale: br.calibration.success.applied, rankSdLn: br.calibration.rank.sdLn ?? 0, successSdLn: br.calibration.success.sdLn ?? 0, goCombat: br.start.goCombat?.effect ? { ...br.start.goCombat } : null, now })
  const live = se.liveGiftOf(st)
  const duty = ep?.decision?.track?.duty ?? sp.BLADE_HOST.duty
  const r = decide({ base: ei.inputs, s0, gift: giftArg({ base: ei.inputs, st, live, s0, duty }) })
  return { case: `live BN${node} (${plan.at}; the published decision: hack ${br.hackH}h, blade ${br.bladeH}h, acted '${br.key}')`, ...r, charge: { mass: Math.round(live.mass), H: live.H, duty } }
}

function freshCase({ node, level, l13, inputsLo, inputsHi, placedBasis, label }) {
  const pl = JSON.parse(fs.readFileSync(opt('player'), 'utf8'))
  const sf = pl.sourceFiles?.data ?? pl.sourceFiles
  const plan = readTel('plan.txt')
  const br = plan?.decisions?.bladeRoute
  const stLive = readTel('stanek.txt')
  const nm = bitNodeMults(node, level)
  const gs = sp.giftSize(nm.StaneksGiftExtraSize, l13)
  const np = nm.StaneksGiftPowerMultiplier
  const placed = sp.layoutForGrid(gs.width, gs.height, np, placedBasis).placed
  const st = { node, lastAugReset: 0, layout: { placed, width: gs.width, height: gs.height, nodePower: np }, fleet: stLive.fleet, charger: { gb: 0 } }
  const live = zeroLive(placed, sp.BLADE_HOST.measured.H, gs.width, gs.height, np)
  const person = freshPerson(node, sf, pl.skills.intelligence)
  const s0 = BB.bladeStartOf({ tel: null, person, sleeves: br.sleeves, gymExpPerSec: br.start.gymExpPerSec, bnRank: nm.BladeburnerRank, skillCostMult: nm.BladeburnerSkillCost, install: null, rankScale: br.calibration.rank.applied, successScale: br.calibration.success.applied, goCombat: null })
  const out = []
  for (const [g, base] of [['lo', inputsLo], ['hi', inputsHi]].filter(([, b]) => b)) {
    const r = decide({ base, s0, gift: giftArg({ base, st, live, s0, sameLife: false }) })
    out.push({ case: `${label} (economy ${g})`, ...r })
  }
  return out
}

/**
 * THE CHAIN AT A NODE START (L4 fix, live BN7.3 2026-10-16 16:17Z): the gift unaccepted and acceptable,
 * combat 1, no division, n sleeves — the blade arm priced (a) with the hack route's assignments (0/0/0,
 * the bug) and (b) with the chooser's fleet, each with the chain (blade+gift / blade / hack) as progress.js
 * builds it (stanekepoch.routeGiftChainOptionsOf). Hours at the point.
 */
function chainCase({ node, level, l13, l7, inputs, n, label }) {
  const pl = JSON.parse(fs.readFileSync(opt('player'), 'utf8'))
  const sf = (pl.sourceFiles?.data ?? pl.sourceFiles).map(([k, l]) => (k === 7 ? [7, Math.max(l, l7)] : [k, l]))
  const br = readTel('plan.txt')?.decisions?.bladeRoute
  const nm = bitNodeMults(node, level)
  const person = freshPerson(node, sf, pl.skills.intelligence)
  // the person enters UNPENALISED (the gift is not accepted yet; the chain's blade+gift applies Genesis itself)
  person.mults = lvMults({ ...HE.sfMults(sf) }, nm)
  const startOf = (sleeves) => BB.bladeStartOf({ tel: null, person, sleeves, gymExpPerSec: br.start.gymExpPerSec, bnRank: nm.BladeburnerRank, skillCostMult: nm.BladeburnerSkillCost, install: null, rankScale: br.calibration.rank.applied, successScale: br.calibration.success.applied, goCombat: null })
  const zero = { infiltrate: 0, support: 0, fa: 0 }
  const pick = BB.chooseSleeveConfig(startOf(zero), n, undefined, { Q: 1 })
  const gift = { available: true, accepted: false, forfeited: false, l13 }
  const out = []
  for (const [tag, sleeves] of [['the hack route\'s assignments (0/0/0: the bug)', zero], [`the chooser's fleet ${BB.sleeveConfigKey(pick.config)}`, pick.config]]) {
    const s0 = startOf(sleeves)
    const t0 = Date.now()
    const g = se.routeGiftChainOptionsOf({ gift, nodeMults: nm, base: inputs, install: null })
    const d = drain(P.decideBladeRouteGen({ base: inputs, traj: P.trajectoryOf(null, {}), trajGen: P.trajectoryGenOf(null, {}), basis: null, bladeStart: s0, draws: [], post: false, gift: g }))
    out.push({ case: `${label}: blade arm on ${tag}`, key: d.key, hackH: d.hackH, bladeH: d.bladeH, accept: d.gift?.accept ?? null, without: { key: '-', hackH: d.hackH, bladeH: d.gift?.blade?.options?.find((o) => !o.withGift)?.hours ?? null }, gift: d.gift, ms: Date.now() - t0 })
  }
  return out
}

const which = opt('case', 'all')
const results = []
if (which === 'live' || which === 'all') results.push(liveCase())
if (which !== 'live') {
  HE = await import('./nodechoice/hackexit.mjs')
  const pl = JSON.parse(fs.readFileSync(opt('player'), 'utf8'))
  const sf = pl.sourceFiles?.data ?? pl.sourceFiles
  const sf73 = sf.map(([n, l]) => (n === 7 ? [7, Math.max(l, 2)] : [n, l])) // BN7.2's exit grants SF7.2
  const prof = HE.defaultProfile({ cycleHours: 2.63 })
  const fresh = (node, level, g, sfx) => sp.penaltyStepInputsOf(HE.freshInputs({ node, level, sf: sfx, g, profile: prof }), 1, sp.PENALTY[1])
  if (which === 'bn7.3' || which === 'all') results.push(...freshCase({ node: 7, level: 3, l13: 1, inputsLo: fresh(7, 3, 0.0405, sf73), inputsHi: fresh(7, 3, 0.1381, sf73), placedBasis: 'blade', label: 'BN7.3 entry (SF7.2), the Bladeburner layout placed' }))
  // THE FRESH BUILDER'S CALIBRATION: the same fresh-entry Bladeburner start for BN7.2 (SF7.1 held on entry)
  // against BN7.2 as the live node ran it (stanek.txt lastNodeReset to the plan's pass + the live blade arm)
  if (which === 'bn7.3' || which === 'all' || which === 'cal') {
    const stL = readTel('stanek.txt')
    const brL = readTel('plan.txt')?.decisions?.bladeRoute
    const at = Date.parse(readTel('plan.txt')?.at)
    const realised = fin(stL?.lastNodeReset) && fin(at) && fin(brL?.bladeH) ? (at - stL.lastNodeReset) / 3.6e6 + brL.bladeH : null
    const sf72 = sf.map(([n, l]) => (n === 7 ? [7, 1] : [n, l]))
    const [c72] = freshCase({ node: 7, level: 2, l13: 1, inputsLo: fresh(7, 2, 0.0405, sf72), inputsHi: null, placedBasis: 'blade', label: 'CALIBRATION: BN7.2 entry by the same fresh builder' })
    results.push({ ...c72, calibration: { freshBladeH: c72.bladeH, liveNodeH: realised ? +realised.toFixed(2) : null, errPct: realised ? +((c72.bladeH / realised - 1) * 100).toFixed(1) : null, why: 'the fresh-entry Bladeburner exit for BN7.2 vs BN7.2 as played (node age at the plan pass + the live blade arm left)' } })
  }
  if (which === 'chain' || which === 'all') {
    for (const [g, lab] of [[0.0405, 'lo'], [0.1381, 'hi']]) results.push(...chainCase({ node: 7, level: 3, l13: 1, l7: 2, inputs: HE.freshInputs({ node: 7, level: 3, sf: sf73, g, profile: prof }), n: 6, label: `BN7.3 entry, gift unaccepted (economy ${lab})` }))
  }
  if (which === 'bn13' || which === 'all') {
    const fx = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn13-lifelength-2103.json'), 'utf8'))
    const gl = fx.inputs.giftLife
    const nm = bitNodeMults(13, 2)
    const gs = sp.giftSize(nm.StaneksGiftExtraSize, 1)
    const np = nm.StaneksGiftPowerMultiplier
    const st = { node: 13, lastAugReset: 0, layout: { placed: gl.layout, width: gs.width, height: gs.height, nodePower: np }, fleet: { gb: gl.fleetGB, hosts: gl.hosts }, charger: { gb: gl.f * gl.fleetGB } }
    const placedHack = sp.layoutFits(gl.layout, gs.width, gs.height) ? gl.layout : sp.layoutForGrid(gs.width, gs.height, np, 'hack').placed
    st.layout.placed = placedHack
    const live = zeroLive(placedHack, sp.BLADE_HOST.measured.H, gs.width, gs.height, np)
    const person = freshPerson(13, sf.map(([n, l]) => (n === 13 ? [13, Math.max(l, 1)] : [n, l])), pl.skills.intelligence)
    const br = readTel('plan.txt')?.decisions?.bladeRoute
    const s0 = BB.bladeStartOf({ tel: null, person, sleeves: br.sleeves, gymExpPerSec: br.start.gymExpPerSec, bnRank: nm.BladeburnerRank, skillCostMult: nm.BladeburnerSkillCost, install: null, rankScale: br.calibration.rank.applied, successScale: br.calibration.success.applied, goCombat: null })
    const r = decide({ base: fx.inputs, s0, gift: giftArg({ base: fx.inputs, st, live, s0, sameLife: true, fH: gl.f }) })
    results.push({ case: `BN13.2-like: BN13.1's live hacking inputs (${fx.at}, the hacking layout placed, f ${gl.f}) vs a fresh BN13 division, SF13.1`, ...r })
  }
}

console.log('CALIBRATION: bladeExit NOT CALIBRATED live as a whole (rank k / success k applied from decisions.bladeRoute.calibration); the hacking arm is exitplan at the point (the plan posteriors not replayed); the fresh cases are fresh-entry starts, not saves.')
for (const r of results) {
  if (args.includes('--json')) {
    console.log(JSON.stringify(r))
    continue
  }
  console.log(`\n${r.case}`)
  console.log(`  WITH THE GIFT  hack ${r.hackH}h  blade ${r.bladeH}h  -> '${r.key}'${r.accept != null ? `  accept ${r.accept}` : ''}   (${r.ms} ms)`)
  console.log(`  as-is (no gift options)  hack ${r.without.hackH}h  blade ${r.without.bladeH}h -> '${r.without.key}'`)
  for (const o of r.gift?.hack?.options ?? []) console.log(`    hack  ${o.src === r.gift.hack.chosen ? '*' : ' '} ${String(o.hours).padStart(9)}h  ${o.src}`)
  for (const o of r.gift?.blade?.options ?? []) console.log(`    blade ${o.src === r.gift.blade.chosen ? '*' : ' '} ${String(o.hours).padStart(9)}h  ${o.src}`)
  if (r.gift?.awakeningBound) console.log(`    Awakening bound: hack ${r.gift.awakeningBound.hackH}h (flips the point: ${r.gift.awakeningBound.flips})`)
  if (r.charge) console.log(`    live charge mass ${r.charge.mass}, charger H ${r.charge.H}, duty ${r.charge.duty}`)
  if (r.calibration) console.log(`    CALIBRATION: fresh-builder blade ${r.calibration.freshBladeH}h vs BN7.2 as played ${r.calibration.liveNodeH}h (${r.calibration.errPct}%)`)
}
process.exit(0) // the game bundle keeps timers alive
