// The arms of the BN14.1 Bladeburner policy audit (tools/sim/bb14/arms.mjs).
// An arm: { sharedPolicy (bbplan.POLICY overrides), choose (wraps
// bbplan.chooseAction with the game's objects), planSkills, teamOps,
// extraHumans, fleet, gymFirst/gymTo, skillEveryS }.
const bp = await import('bbplan.js')
import { expValueChooser } from './expvalue.mjs'

const GEN = (name, why) => ({ type: bp.TYPE.general, name, why })
const humansOf = (bb) => bb.teamSize - bb.sleeveSize

/** Rest by `name` instead of the regeneration chamber (Recruitment and Field Analysis need no stamina). */
const restAs = (name) => (v, pol) => (v.resting ? GEN(name, `resting by ${name}`) : bp.chooseAction(v, pol))
/** Recruit while the human team is under n (instead of acting), else the shipped choice. */
const recruitTo = (n, { onlyResting = false } = {}) => (v, pol, { bb }) => {
  if (humansOf(bb) < n && (!onlyResting || v.resting)) return GEN(bp.GENERAL.recruitment, `team ${humansOf(bb)} < ${n}`)
  return bp.chooseAction(v, pol)
}

/** The skill greedy on rank/s alone: never switch to the next black op's chance. */
const noBlack = (v, sp, pol, cm, ch) => bp.planSkills({ ...v, blackOp: null }, sp, pol, cm, ch)

/** Rank-only until every remaining black op is rank-eligible (rank >= Daedalus's), then the shipped objective. */
const DAED = bp.BLACK_OPS[bp.BLACK_OPS.length - 1].reqdRank
const noBlackTillEnd = (v, sp, pol, cm, ch) => bp.planSkills(v.rank >= DAED ? v : { ...v, blackOp: null }, sp, pol, cm, ch)
const cad = (s) => ({ sharedPolicy: { skillEveryS: s }, skillEveryS: s })

/** The round-2 base: rank-only skills until Daedalus's rank, every 600s, chunks 2. */
const N = (sp = {}, extra = {}) => ({ planSkills: noBlackTillEnd, skillEveryS: 600, ...extra, sharedPolicy: { skillEveryS: 600, skillChunks: 2, ...sp } })

/** The policy shipped before 2026-10-04 (BN6-tuned): the black-op objective as soon as eligible, 'sum', hourly, chunks 8. */
export const OLD = { skillBlackFrom: 'eligible', skillObjective: 'sum', skillEveryS: 3600, skillChunks: 8 }
const O = (sp = {}, extra = {}) => ({ skillEveryS: sp.skillEveryS ?? 3600, ...extra, sharedPolicy: { ...OLD, ...sp } })

export const ARMS = {
  base: {},
  old: O(),
  'near0.05': { sharedPolicy: { skillBlackNear: 0.05 } },
  'near0.1': { sharedPolicy: { skillBlackNear: 0.1 } },
  'near0.2': { sharedPolicy: { skillBlackNear: 0.2 } },
  'near0.3': { sharedPolicy: { skillBlackNear: 0.3 } },
  'from20k': { sharedPolicy: { skillBlackFrom: 20000 } },
  'from50k': { sharedPolicy: { skillBlackFrom: 50000 } },
  'from100k': { sharedPolicy: { skillBlackFrom: 100000 } },
  'from200k': { sharedPolicy: { skillBlackFrom: 200000 } },
  'near0.1-bt0.7': { sharedPolicy: { skillBlackNear: 0.1, blackThr: 0.7 } },
  'bt0.7': { sharedPolicy: { blackThr: 0.7 } },
  'bt0.6': { sharedPolicy: { blackThr: 0.6 } },

  'exp-T1h': { choose: expValueChooser(3600) },
  'exp-T3h': { choose: expValueChooser(3 * 3600) },
  'exp-T10h': { choose: expValueChooser(10 * 3600) },
  'exp-T0': { choose: expValueChooser(1e-9) },
  // ---- 3. thresholds ----
  'minP0.3': { sharedPolicy: { minP: 0.3 } },
  'minP0.2': { sharedPolicy: { minP: 0.2 } },
  'minP0.05': { sharedPolicy: { minP: 0.05 } },
  'blackThr0.5': { sharedPolicy: { blackThr: 0.5 } },
  'blackThr0.65': { sharedPolicy: { blackThr: 0.65 } },
  'blackThr0.9': { sharedPolicy: { blackThr: 0.9 } },
  'blackThr0.2': { sharedPolicy: { blackThr: 0.2 } },
  'blackThr0.3': { sharedPolicy: { blackThr: 0.3 } },
  'blackThr0.4': { sharedPolicy: { blackThr: 0.4 } },
  'blackThr0.6': { sharedPolicy: { blackThr: 0.6 } },
  'blackThr0.7': { sharedPolicy: { blackThr: 0.7 } },
  'bt0.5-rest0.5-0.6': { sharedPolicy: { blackThr: 0.5, restLow: 0.5, restHigh: 0.6 } },
  'bt0.5-rest0.75-0.95': { sharedPolicy: { blackThr: 0.5, restLow: 0.75, restHigh: 0.95 } },
  'rest0.6-0.8': { sharedPolicy: { restLow: 0.6, restHigh: 0.8 } },
  'rest0.85-0.95': { sharedPolicy: { restLow: 0.85, restHigh: 0.95 } },
  'rest0.5-0.6': { sharedPolicy: { restLow: 0.5, restHigh: 0.6 } },
  'rest0.5-0.95': { sharedPolicy: { restLow: 0.5, restHigh: 0.95 } },
  'rest0.75-0.95': { sharedPolicy: { restLow: 0.75, restHigh: 0.95 } },
  'raidChaos25': { sharedPolicy: { raidChaos: 25 } },
  'raidChaos100': { sharedPolicy: { raidChaos: 100 } },
  'raidChaosInf': { sharedPolicy: { raidChaos: 1e9 } },
  // ---- 1. team ----
  'teamOps0': { teamOps: false },
  'free20humans': { extraHumans: 20 },
  'free20humans-teamOps0': { extraHumans: 20, teamOps: false },
  'free100humans-teamOps0': { extraHumans: 100, teamOps: false },
  'restRecruit': { choose: restAs('Recruitment') },
  'restRecruit-teamOps0': { choose: restAs('Recruitment'), teamOps: false },
  'recruitTo10-teamOps0': { choose: recruitTo(10), teamOps: false },
  'restFA': { choose: restAs(bp.GENERAL.fieldAnalysis) },
  // ---- 4. skills ----
  'skill600s': { sharedPolicy: { skillEveryS: 600 }, skillEveryS: 600 },
  'skill1800s': { sharedPolicy: { skillEveryS: 1800 }, skillEveryS: 1800 },
  'skill7200s': { sharedPolicy: { skillEveryS: 7200 }, skillEveryS: 7200 },
  'skill3000s': { sharedPolicy: { skillEveryS: 3000 }, skillEveryS: 3000 },
  'skillChunks4': { sharedPolicy: { skillChunks: 4 } },
  'skillNoBlack': { planSkills: noBlack },
  'skillNoBlack-600s': { planSkills: noBlack, sharedPolicy: { skillEveryS: 600 }, skillEveryS: 600 },
  'skillNoBlack-7200s': { planSkills: noBlack, sharedPolicy: { skillEveryS: 7200 }, skillEveryS: 7200 },
  'skillNoBlack-bt0.6': { planSkills: noBlack, sharedPolicy: { blackThr: 0.6 } },
  'nb-60s': { planSkills: noBlack, ...cad(60) },
  'nb-300s': { planSkills: noBlack, ...cad(300) },
  'nb-1200s': { planSkills: noBlack, ...cad(1200) },
  'nbEnd-300s': { planSkills: noBlackTillEnd, ...cad(300) },
  'nbEnd-600s': { planSkills: noBlackTillEnd, ...cad(600) },
  'nb-300s-ch20': { planSkills: noBlack, ...cad(300), sharedPolicy: { skillEveryS: 300, skillChunks: 20 } },
  'nb-300s-ch2': { planSkills: noBlack, ...cad(300), sharedPolicy: { skillEveryS: 300, skillChunks: 2 } },
  'nbEnd-300s-ch1': { planSkills: noBlackTillEnd, skillEveryS: 300, sharedPolicy: { skillEveryS: 300, skillChunks: 1 } },
  'nbEnd-300s-ch2': { planSkills: noBlackTillEnd, skillEveryS: 300, sharedPolicy: { skillEveryS: 300, skillChunks: 2 } },
  'nbEnd-300s-ch4': { planSkills: noBlackTillEnd, skillEveryS: 300, sharedPolicy: { skillEveryS: 300, skillChunks: 4 } },
  'nbEnd-300s-ch8': { planSkills: noBlackTillEnd, skillEveryS: 300, sharedPolicy: { skillEveryS: 300, skillChunks: 8 } },
  'nbEnd-600s-ch1': { planSkills: noBlackTillEnd, skillEveryS: 600, sharedPolicy: { skillEveryS: 600, skillChunks: 1 } },
  'nbEnd-600s-ch2': { planSkills: noBlackTillEnd, skillEveryS: 600, sharedPolicy: { skillEveryS: 600, skillChunks: 2 } },
  'nbEnd-600s-ch4': { planSkills: noBlackTillEnd, skillEveryS: 600, sharedPolicy: { skillEveryS: 600, skillChunks: 4 } },
  'nbEnd-600s-ch8': { planSkills: noBlackTillEnd, skillEveryS: 600, sharedPolicy: { skillEveryS: 600, skillChunks: 8 } },
  'nbEnd-1200s-ch1': { planSkills: noBlackTillEnd, skillEveryS: 1200, sharedPolicy: { skillEveryS: 1200, skillChunks: 1 } },
  'nbEnd-1200s-ch2': { planSkills: noBlackTillEnd, skillEveryS: 1200, sharedPolicy: { skillEveryS: 1200, skillChunks: 2 } },
  'nbEnd-1200s-ch4': { planSkills: noBlackTillEnd, skillEveryS: 1200, sharedPolicy: { skillEveryS: 1200, skillChunks: 4 } },
  'nbEnd-1200s-ch8': { planSkills: noBlackTillEnd, skillEveryS: 1200, sharedPolicy: { skillEveryS: 1200, skillChunks: 8 } },
  'nbEnd-1800s-ch1': { planSkills: noBlackTillEnd, skillEveryS: 1800, sharedPolicy: { skillEveryS: 1800, skillChunks: 1 } },
  'nbEnd-1800s-ch2': { planSkills: noBlackTillEnd, skillEveryS: 1800, sharedPolicy: { skillEveryS: 1800, skillChunks: 2 } },
  'nbEnd-1800s-ch4': { planSkills: noBlackTillEnd, skillEveryS: 1800, sharedPolicy: { skillEveryS: 1800, skillChunks: 4 } },
  'nbEnd-1800s-ch8': { planSkills: noBlackTillEnd, skillEveryS: 1800, sharedPolicy: { skillEveryS: 1800, skillChunks: 8 } },
  'nbEnd-3600s-ch1': { planSkills: noBlackTillEnd, skillEveryS: 3600, sharedPolicy: { skillEveryS: 3600, skillChunks: 1 } },
  'nbEnd-3600s-ch2': { planSkills: noBlackTillEnd, skillEveryS: 3600, sharedPolicy: { skillEveryS: 3600, skillChunks: 2 } },
  'nbEnd-3600s-ch4': { planSkills: noBlackTillEnd, skillEveryS: 3600, sharedPolicy: { skillEveryS: 3600, skillChunks: 4 } },
  'nbEnd-3600s-ch8': { planSkills: noBlackTillEnd, skillEveryS: 3600, sharedPolicy: { skillEveryS: 3600, skillChunks: 8 } },
  N: N(),
  'N-ch1': N({ skillChunks: 1 }),
  'N-bt0.4': N({ blackThr: 0.4 }),
  'N-bt0.5': N({ blackThr: 0.5 }),
  'N-bt0.6': N({ blackThr: 0.6 }),
  'N-bt0.7': N({ blackThr: 0.7 }),
  'N-bt0.9': N({ blackThr: 0.9 }),
  'N-minP0.3': N({ minP: 0.3 }),
  'N-minP0.5': N({ minP: 0.5 }),
  'N-rest0.5-0.6': N({ restLow: 0.5, restHigh: 0.6 }),
  'N-rest0.75-0.95': N({ restLow: 0.75, restHigh: 0.95 }),
  'N-rest0.6-0.8': N({ restLow: 0.6, restHigh: 0.8 }),
  'N-raid25': N({ raidChaos: 25 }),
  'N-raid70': N({ raidChaos: 70 }),
  'N-teamOps0': N({}, { teamOps: false }),
  'N-free20-teamOps0': N({}, { teamOps: false, extraHumans: 20 }),
  'N-free20': N({}, { extraHumans: 20 }),
  'N-restRecruit': N({}, { choose: restAs('Recruitment') }),
  'N-restFA': N({}, { choose: restAs(bp.GENERAL.fieldAnalysis) }),
  'N-gym300': N({}, { gymFirst: true, gymTo: 300 }),
  'N-gym400': N({}, { gymFirst: true, gymTo: 400 }),
  'N-fleet-i2s0f3': N({}, { fleet: { infiltrate: 2, support: 0, fa: 3 } }),
  'N-fleet-i0s5': N({}, { fleet: { infiltrate: 0, support: 5, fa: 0 } }),
  'N-fleet-i5': N({}, { fleet: { infiltrate: 5, support: 0, fa: 0 } }),
  'N-skillMax': N({ skillObjective: 'max' }),
  'N-ch1-max': N({ skillChunks: 1, skillObjective: 'max' }),
  'N-ch2-max': N({ skillObjective: 'max' }),
  'N-ch4-max': N({ skillChunks: 4, skillObjective: 'max' }),
  'N-ch1-max-1200': N({ skillChunks: 1, skillObjective: 'max', skillEveryS: 1200 }, { skillEveryS: 1200 }),
  'N-ch2-max-300': N({ skillObjective: 'max', skillEveryS: 300 }, { skillEveryS: 300 }),
  'N-max-3600': N({ skillObjective: 'max', skillEveryS: 3600 }, { skillEveryS: 3600 }),
  'N-sum-ch8-3600': N({ skillChunks: 8, skillEveryS: 3600 }, { skillEveryS: 3600 }),
  'skillChunks20': { sharedPolicy: { skillChunks: 20 } },
  'skillMax': { sharedPolicy: { skillObjective: 'max' } },
  // ---- 5. gym ----
  'gym200': { gymFirst: true, gymTo: 200 },
  'gym300': { gymFirst: true, gymTo: 300 },
  'gym400': { gymFirst: true, gymTo: 400 },
  // ---- fleet (sleeve.js's choice; for scale) ----
  'fleet-i2s0f3': { fleet: { infiltrate: 2, support: 0, fa: 3 } },
  'fleet-i1s0f4': { fleet: { infiltrate: 1, support: 0, fa: 4 } },
  'fleet-i5': { fleet: { infiltrate: 5, support: 0, fa: 0 } },
}
ARMS['bt0.95'] = { sharedPolicy: { blackThr: 0.95 } }
ARMS['bt0.99'] = { sharedPolicy: { blackThr: 0.99 } }
ARMS['bt1'] = { sharedPolicy: { blackThr: 1 } }
ARMS.priced = { sharedPolicy: { blackRule: 'priced' } }
ARMS['priced-noEnd'] = { sharedPolicy: { blackRule: 'priced', blackEndgame: false } }
{
  const P = (sp = {}, extra = {}) => ({ ...extra, sharedPolicy: { blackRule: 'priced', ...sp } })
  Object.assign(ARMS, {
    'P-minP0.3': P({ minP: 0.3 }), 'P-minP0.2': P({ minP: 0.2 }), 'P-minP0.5': P({ minP: 0.5 }), 'P-minP0.6': P({ minP: 0.6 }),
    'P-rest0.5-0.6': P({ restLow: 0.5, restHigh: 0.6 }), 'P-rest0.75-0.95': P({ restLow: 0.75, restHigh: 0.95 }), 'P-rest0.5-0.8': P({ restLow: 0.5, restHigh: 0.8 }), 'P-rest0.3-0.95': P({ restLow: 0.3, restHigh: 0.95 }),
    'P-raid25': P({ raidChaos: 25 }), 'P-raid50': P({ raidChaos: 50 }), 'P-raid35': P({ raidChaos: 35 }),
    'P-sbt1': P({ skillBlackThr: 1 }),
    'P-raid55': P({ raidChaos: 55 }), 'P-raid60': P({ raidChaos: 60 }), 'P-raid70': P({ raidChaos: 70 }), 'P-raid100': P({ raidChaos: 100 }),
    'P-raid50-sbt1': P({ raidChaos: 50, skillBlackThr: 1 }),
    'P-raid47.6': P({ raidChaos: 50 / 1.05 }), 'P-raid48.5': P({ raidChaos: 50 / 1.03 }), 'P-raid49': P({ raidChaos: 49 }), 'P-raid51': P({ raidChaos: 51 }), 'P-raid52': P({ raidChaos: 52 }),
  })
}
// The policy shipped before 2026-10-05: the fixed black-op bar, Raid guarded at chaos 45.
ARMS.prev = { sharedPolicy: { blackRule: 'threshold', raidChaos: 45 } }
ARMS['prev-raid50'] = { sharedPolicy: { blackRule: 'threshold', raidChaos: 50 } }
ARMS['priced-raid45'] = { sharedPolicy: { blackRule: 'priced', raidChaos: 45 } }
// The daemon's all-clamped low-end ENV as it ran live at 00:26Z (operations K 0.185 vs the formula's
// 1.785, contracts 0.028 vs 1.632): every chance it decides on scaled down by that ratio.
{
  const lowK = (v) => ({ ...v, __memo: null, actions: v.actions.map((a) => ({ ...a, K: a.K * (a.d.kind === 'contract' ? 0.028 / 1.632 : 0.185 / 1.785) })) })
  ARMS.lowK = { choose: (v, pol) => bp.chooseAction(lowK(v), pol), planSkills: (v, sp, pol, cm, ch) => bp.planSkills(lowK(v), sp, pol, cm, ch) }
  ARMS['lowK-V2'] = { ...ARMS.lowK, sharedPolicy: bp.POLICY_V2 }
}
