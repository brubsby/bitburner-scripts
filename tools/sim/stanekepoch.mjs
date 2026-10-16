// STANEK'S GIFT L3: THE EPOCH DECISION OFFLINE — its live check and the closed loop replayed.
//
//   node tools/sim/stanekepoch.mjs --replay --node 7 --l7 2 [--seeds 1-40 --q 6 --screen 16 --short 2 --z 2 --min 0.01 --json FILE --verbose]
//   node tools/sim/stanekepoch.mjs --calib [--tel DIR]          bbsim from the LIVE start vs the live node
//
// THE TWO TRAJECTORIES of --replay (CLAUDE.md "Decisions compare simulated trajectories"), from the same
// node start, the same truth world and the same seeds:
//   L2  the fixed phase plan (stanekplan.BLADE_PHASE_PRICED for the cell; the incumbent held where none
//       is listed), stepped as stanek.js steps it (the late layout once its black-op count holds);
//   L3  the closed loop: at each epoch (stanekepoch.epochDueOf — the first, every black op, a landed
//       switch, hourly) the SAME decision function progress.js runs (stanekepoch.epochDecisionGen on
//       bbplan.bladeExit) from a snapshot of the truth world's state (snapshotStartOf: the rank, skills,
//       counts, cities, stamina, the player's levels and multipliers, the fleet, the Go farm, the
//       per-fragment charge), and the truth world re-laid one stanek.js pass (300s) later.
// The TRUTH WORLD is bbsim (the game's own Bladeburner, Player, Sleeve and StaneksGift classes) from the
// LIVE-START spec (liveSpecOf: the Go farm at its measured rate, the live SF set, intelligence and fleet
// — the start-state mismatch behind bbsim's 41% rank lag) and the MEASURED charger
// (stanekplan.BLADE_HOST.measured: 256GB x 9 cores = highestCharge 192). The decision model (bladeExit)
// is NOT the truth world, so the replay measures the controller with its model error in it.
// The result is d = L3 - L2 per seed (paired), mean and se, and split by the seeds where the run LEADS
// or LAGS the plan (its black-op clock against the seeds' median at L2's switch count).
//
// CALIBRATION: printed first on every run — --calib's bbsim-from-the-live-start vs the live node (rank,
// black ops, stats at the live node age), the charger (live vs ramp vs measured). The L3 decision
// itself is NOT CALIBRATED live until a node has run it (no switch has landed); its per-epoch
// forecasts (charge mass, rank) are checked live by progress.js at every epoch (EPOCH_FILE calibration).

import '../test/gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runBladeburner } from './nodechoice/bbsim.mjs'
import { specOf, gridOf } from './bbstanek.mjs'
import g from './nodechoice/game.mjs'

const sp = await import('../../stanekplan.js')
const se = await import('../../stanekepoch.js')
const bp = await import('bbplan.js')
const { drain } = await import('coop.js')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TEL = path.join(HERE, '../../.telemetry')
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length
const seOf = (xs) => (xs.length > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - mean(xs)) ** 2, 0) / (xs.length - 1) / xs.length) : Infinity)

/**
 * THE LIVE-START SPEC: bbstanek.specOf with what the live node measured in place of the grid's fixed
 * inputs — the Go farm's Tetrads rate (/tel plan bladeRoute.start.goCombat.perHour: 35054/h at BN7.2
 * against the grid's 21592), the SF set and intelligence of the save, and the fleet (1 infiltrate,
 * 3 support; the 2 contract sleeves omitted: bbsim has no contract sleeve — stated; as infiltrators the rank ran +74%).
 */
export const LIVE_START = {
  goPerHour: 35054,
  sf: [[1, 3], [4, 3], [5, 1], [2, 1], [10, 2], [8, 1], [9, 3], [6, 3], [14, 3], [12, 1], [13, 1], [11, 1]],
  intelligence: 149,
  sleeves: { infiltrate: 1, support: 3 },
  at: 'BN7.2 2026-10-16 (plan.txt bladeRoute.start.goCombat, state.json sourceFiles/skills, sleeve fleet i1s3c2)',
}
export function liveSpecOf({ node, l7, l13 = 1, seed }) {
  const s = specOf({ node, l6: 3, l7, l13, seed })
  const sf = [...LIVE_START.sf.filter(([n]) => n !== 7 && n !== 13), [7, l7], [13, l13]]
  return { ...s, sf, intelligence: LIVE_START.intelligence, go: { ...s.go, perHour: LIVE_START.goPerHour, sf14: 1 }, policy: { ...s.policy, sleeves: { ...LIVE_START.sleeves } } }
}

/**
 * A SNAPSHOT OF THE TRUTH WORLD as the decision's start (what bladeStartOf builds from the live
 * telemetry): the division (rank, skill points and levels, stamina, the cities' TRUE populations, the
 * action counts, max levels and successes, black ops), the player (levels, exp, multipliers — the
 * gift's and the Go farm's included, as the live ns.getPlayer() has them), the fleet and the Go farm
 * (its effect now, its nodes and rate). Calibration posteriors at the live node's sds.
 */
export function snapshotStartOf({ P, bb, nodeMults, fleet, go, goEff = null, goNodes, gymExpPerSec = 16.8 }) {
  const tel = {
    joined: true,
    rank: bb.rank,
    skillPoints: bb.skillPoints,
    levels: { ...bb.skills },
    blackOps: { done: bb.numBlackOpsComplete },
    counts: Object.fromEntries([...Object.values(bb.contracts), ...Object.values(bb.operations)].map((a) => [a.name, a.count])),
    maxLevels: Object.fromEntries([...Object.values(bb.contracts), ...Object.values(bb.operations)].map((a) => [a.name, a.maxLevel])),
    successes: Object.fromEntries([...Object.values(bb.contracts), ...Object.values(bb.operations)].map((a) => [a.name, a.successes])),
    cities: Object.entries(bb.cities).map(([name, c]) => ({ name, pop: c.pop, popEst: c.popEst, chaos: c.chaos, comms: c.comms })),
    stamina: bb.stamina,
    maxStamina: bb.maxStamina,
    staminaBonus: bb.staminaBonus,
    joinedAt: null,
  }
  const person = { skills: { ...P.skills }, exp: { ...P.exp }, mults: { ...P.mults } }
  const goCombat = go && go.perHour > 0 && goEff >= 1 ? { effect: goEff, nodes: goNodes, perHour: go.perHour, power: go.power, goPower: go.goPower ?? 1, sf14: go.sf14 ?? 0 } : null
  return bp.bladeStartOf({ tel, person, sleeves: fleet, gymExpPerSec, bnRank: nodeMults.BladeburnerRank, skillCostMult: nodeMults.BladeburnerSkillCost, rankScale: 1, successScale: 1, rankSdLn: 0.1, successSdLn: 0.04, goCombat, maxH: 200 })
}

/**
 * One run of the truth world. ctl null: the L2 plan (phases). ctl {Q, budget}: the L3 closed loop — at
 * each 60s gift step epochDueOf on the controller's own record; when due, the decision from the
 * snapshot; a switch is handed to bbsim (o.stanek.decide) and lands lagS later.
 */
export function runArm({ cell, seed, phases, ctl = null, gbMax = sp.BLADE_HOST.measured.gb, cores = sp.BLADE_HOST.measured.cores, maxH = 60, log = null }) {
  const spec = liveSpecOf({ ...cell, seed })
  const gr = gridOf(cell.node, cell.l13 ?? 1)
  const nodeMults = g.getBitNodeMultipliers(cell.node, 1)
  let rec = null
  const epochs = []
  const thrAt = sp.bladeThrAt({ gbMax, cores })
  const decide = ctl
    ? ({ t, P, bb, placed, charges, goEff, goNodes }) => {
        if (!bb) return null
        const placedKey = sp.layoutKeyOf(placed)
        const lnr = 0
        const due = se.epochDueOf({ prev: rec, now: t * 1000, lastAugReset: 0, lastNodeReset: lnr, blackOps: bb.numBlackOpsComplete, placedKey, periodMin: se.EPOCH.periodMin })
        if (!due.due) return null
        const live = se.liveGiftOf({ at: new Date(t * 1000).toISOString(), fragments: placed.map((p, i) => ({ ...p, highestCharge: charges[i].highestCharge, numCharge: charges[i].numCharge })), charger: { H: thrAt(t) }, layout: { width: gr.width, height: gr.height, nodePower: gr.nodePower } })
        const s0 = snapshotStartOf({ P, bb, nodeMults, fleet: { ...LIVE_START.sleeves }, go: spec.go, goEff, goNodes })
        const d = drain(se.epochDecisionGen({ s0, live, width: gr.width, height: gr.height, nodePower: gr.nodePower, duty: sp.BLADE_HOST.duty, Q: ctl.Q, budget: ctl.budget, now: t * 1000, ...(ctl.hysteresis ? { hysteresis: ctl.hysteresis } : {}) }))
        const decision = { ...d, decidedAt: new Date(t * 1000).toISOString(), epochKind: due.kind, blackOps: bb.numBlackOpsComplete, lastAugReset: 0 }
        rec = { lastAugReset: 0, lastNodeReset: lnr, decision }
        epochs.push({ h: +(t / 3600).toFixed(2), kind: due.kind, bo: bb.numBlackOpsComplete, choice: d.kind, to: d.targetKey, d: d.d, ms: d.cpu.ms, sims: d.cpu.sims })
        if (log) log(`    seed ${seed} ${(t / 3600).toFixed(2)}h ${due.kind} bo ${bb.numBlackOpsComplete}: ${d.kind}${d.kind === 'switch' ? ` -> ${d.targetKey} d ${d.d} +- ${d.se}` : ''} (${d.cpu.sims} sims ${d.cpu.ms}ms)`)
        return d.kind === 'switch' ? d.target : null
      }
    : null
  const r = runBladeburner({ ...spec, maxH, stanek: { phases, thrAt, duty: sp.BLADE_HOST.duty, lagS: se.EPOCH.lagS, ...(decide ? { decide } : {}) } })
  let bo6 = null
  return { hours: r.hours ?? Infinity, switches: r.stanekSwitches ?? [], epochs, blackOpsAt: r.blackOpsAt ?? null, bo6 }
}

async function main() {
  const args = process.argv.slice(2)
  const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d)
  console.log('CALIBRATION: the L3 decision is NOT CALIBRATED live (no node has run it yet); its forecasts are checked by progress.js at every epoch; --calib prints bbsim from the live start vs the live node.')
  if (args.includes('--calib')) calibFromLive(opt('tel', TEL))
  if (args.includes('--replay')) {
    const node = +opt('node', 7)
    const l7 = +opt('l7', 2)
    const l13 = +opt('l13', 1)
    const cell = { node, l7, l13 }
    const [a, b] = String(opt('seeds', '1-12')).split('-').map(Number)
    const seeds = Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i)
    // the in-game settings unless overridden (stanekepoch.EPOCH, bbplan.BLADE_ENSEMBLE)
    const Q = +opt('q', bp.BLADE_ENSEMBLE.Q)
    const budget = { screenSims: +opt('screen', se.EPOCH.screenSims), shortlist: +opt('short', se.EPOCH.shortlist) }
    const gr = gridOf(node, l13)
    const inc = sp.BLADE_LAYOUTS[`${gr.width}x${gr.height}|${gr.nodePower}`]
    const plan = sp.bladePhasePlanOf({ node, l13, l7, width: gr.width, height: gr.height })
    const l2 = plan ? [{ placed: plan.early, when: null }, { placed: plan.late, when: plan.when }] : [{ placed: inc, when: null }]
    console.log(`REPLAY BN${node} SF7.${l7 - 0} (cell ${node}|${l13}|${l7}) grid ${gr.width}x${gr.height}|${gr.nodePower}: L2 = ${plan ? `${plan.earlyKey} -> ${plan.lateKey} at ${plan.whenText} (table d ${plan.d} +- ${plan.se}h)` : `the incumbent held (${sp.layoutKeyOf(inc)}): no phase plan listed`}; L3 Q ${Q}, screen ${budget.screenSims}, shortlist ${budget.shortlist}, hysteresis z ${opt('z', se.EPOCH.z)} min ${opt('min', se.EPOCH.minGainH)}h; truth = bbsim live-start spec, measured charger`)
    const rows = []
    for (const seed of seeds) {
      const t0 = Date.now()
      const L2 = runArm({ cell, seed, phases: l2 })
      const L3 = runArm({ cell, seed, phases: [{ placed: l2[0].placed, when: null }], ctl: { Q, budget, hysteresis: { z: +opt('z', se.EPOCH.z), minGainH: +opt('min', se.EPOCH.minGainH) } }, log: args.includes('--verbose') ? console.log : null })
      rows.push({ seed, l2: L2.hours, l3: L3.hours, d: L3.hours - L2.hours, l2Switch: L2.switches[0] ?? null, l3Switches: L3.switches, epochs: L3.epochs.length, l3SwitchN: L3.switches.length, ms: Date.now() - t0 })
      const x = rows[rows.length - 1]
      console.log(`  seed ${seed}: L2 ${L2.hours.toFixed(3)}h (switch ${x.l2Switch ? `${x.l2Switch.h}h` : 'none'}) | L3 ${L3.hours.toFixed(3)}h (${L3.epochs.length} epochs, ${L3.switches.length} switches${L3.switches.length ? ` first ${L3.switches[0].h}h at bo ${L3.switches[0].blackOps}` : ''}) d ${x.d.toFixed(3)}h  ${(x.ms / 1000).toFixed(0)}s`)
    }
    const fin = rows.filter((r) => Number.isFinite(r.d))
    const ds = fin.map((r) => r.d)
    console.log(`RESULT BN${node}|${l13}|${l7}: L3 - L2 = ${mean(ds).toFixed(3)} +- ${seOf(ds).toFixed(3)}h over ${ds.length} seeds (L2 ${mean(fin.map((r) => r.l2)).toFixed(3)}h, L3 ${mean(fin.map((r) => r.l3)).toFixed(3)}h)`)
    // LEAD / LAG: the run's clock at L2's switch against the seeds' median (no switch: the L2 exit vs the median)
    const clock = fin.map((r) => (r.l2Switch ? r.l2Switch.h : r.l2))
    const med = [...clock].sort((p, q) => p - q)[Math.floor(clock.length / 2)]
    const lead = fin.filter((r, i) => clock[i] < med).map((r) => r.d)
    const lag = fin.filter((r, i) => clock[i] > med).map((r) => r.d)
    console.log(`  LEADS the plan (${plan ? `${plan.whenText} before` : 'exit before'} the median ${med.toFixed(2)}h): d ${lead.length ? `${mean(lead).toFixed(3)} +- ${seOf(lead).toFixed(3)}h (n ${lead.length})` : '-'}; LAGS: d ${lag.length ? `${mean(lag).toFixed(3)} +- ${seOf(lag).toFixed(3)}h (n ${lag.length})` : '-'}`)
    if (opt('json', null)) fs.writeFileSync(opt('json'), JSON.stringify({ cell, seeds, Q, budget, rows }))
  }
}

/** bbsim from the LIVE-START spec vs the live node at its age (the rank lag's cause), and the charger. */
export function calibFromLive(tel) {
  const st = JSON.parse(fs.readFileSync(path.join(tel, 'stanek.txt'), 'utf8'))
  const bb = JSON.parse(fs.readFileSync(path.join(tel, 'bladeburner.txt'), 'utf8'))
  const state = JSON.parse(fs.readFileSync(path.join(tel, 'state.json'), 'utf8'))
  const node = st.node
  const ageH = (Date.parse(st.at) - st.lastNodeReset) / 3600e3
  const live = se.liveGiftOf(st)
  const cal = se.calibrationOf({ live, prev: null, nodeAgeH: ageH })
  console.log(`LIVE BN${node} ${ageH.toFixed(2)}h in: rank ${Math.round(bb.rank)}, black ops ${bb.blackOps?.done}, agility ${state.skills.agility}, strength ${state.skills.strength}; charger H ${live.H} (ramp model ${cal.charger.ramp}: ${cal.charger.rampErrPct}%; measured host ${cal.charger.measured}: ${cal.charger.measuredErrPct}%)`)
  const l7 = (new Map(state.sourceFiles?.data ?? []).get(7) ?? 0)
  const placed = live.placed
  for (const [name, mk] of [['grid spec (bbstanek.specOf)', (seed) => specOf({ node, l6: 3, l7: Math.max(1, l7), l13: 1, seed })], ['LIVE-START spec (liveSpecOf)', (seed) => liveSpecOf({ node, l7: Math.max(1, l7), l13: 1, seed })]]) {
    const rows = [1, 2, 3, 4, 5].map((seed) => {
      let at = null
      runBladeburner({ ...mk(seed), maxH: ageH + 0.05, stanek: { phases: [{ placed, when: null }], thrAt: sp.bladeThrAt({ gbMax: sp.BLADE_HOST.measured.gb, cores: sp.BLADE_HOST.measured.cores }), duty: sp.BLADE_HOST.duty }, onStep: ({ t, bb: b, P }) => { if (at === null && t >= ageH * 3600) at = { rank: b.rank, bo: b.numBlackOpsComplete, agi: P.skills.agility } } })
      return at ?? { rank: NaN, bo: NaN, agi: NaN }
    })
    const med = (k) => rows.map((r) => r[k]).sort((a, b) => a - b)[2]
    console.log(`  bbsim ${name} at ${ageH.toFixed(2)}h (median of 5 seeds): rank ${Math.round(med('rank'))} vs live ${Math.round(bb.rank)} (${((med('rank') / bb.rank - 1) * 100).toFixed(0)}%), black ops ${med('bo')} vs ${bb.blackOps?.done}, agility ${med('agi')} vs ${state.skills.agility} (${((med('agi') / state.skills.agility - 1) * 100).toFixed(1)}%); per seed rank ${rows.map((r) => Math.round(r.rank)).join(' ')}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
  process.exit(0)
}
