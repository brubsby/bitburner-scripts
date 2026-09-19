// Company work as a price: hours of employment to a reputation target. Pure, no ns.
//
// ---------------------------------------------------------------------------
// WHY
//
// The megacorp factions gate the top of the augmentation table — ECorp alone
// holds HVMind (x3.00) and two Embedded Netburner cores (x1.78, x1.68) — and
// every one of them is entered the same way: reputation with the COMPANY,
// earned by holding a job there. That is a fundamentally different cost from
// every other join requirement this stack prices. A hacking-level wait is
// PASSIVE: batching raises it whether or not we grind a faction. Company work
// is ACTIVE: the work slot is exclusive, so an hour at ECorp is an hour not
// spent earning faction reputation. joinplan.js keeps the two kinds separate
// and factionplan.js charges them differently; this module only answers "how
// many hours of employment reach reputation R at company C".
//
// ---------------------------------------------------------------------------
// THE FORMULA, from game source (all multiplications, cited):
//
//   Work/CompanyWork.tsx:49    company.playerReputation += gains.reputation * cycles
//   Constants.ts:19            MilliPerCycle = 200         => 5 cycles per second
//   Work/Formulas.ts:156       gains.reputation = jobPerformance
//                                * mults.company_rep * (1 + favor/100)
//                                * currentNodeMults.CompanyWorkRepGain
//   Company/CompanyPosition.ts:156-172
//     jobPerformance = repMultiplier
//                      * (hackEff*hacking + strEff*str + defEff*def
//                         + dexEff*dex + agiEff*agi + chaEff*cha) / 975 / 100
//                      + intelligence / 975            (MaxSkillLevel, Constants.ts:16)
//
// The software track uses only hacking and charisma effectiveness; the other
// four are zero for every position in it (CompanyPositionsMetadata.ts).
//
// ---------------------------------------------------------------------------
// THE LADDER, and the charisma wall
//
// Positions promote at reputation thresholds, and each promotion multiplies
// the rep rate (repMultiplier 0.9 -> 1.75 across the track). But promotion
// also requires STATS, and the stat requirements carry the company's
// jobStatReqOffset — with a subtlety that decides everything for this player:
// Company/CompanyPosition.ts:146 adds the offset ONLY to a nonzero base. So at
// a 224-offset company, Junior Software Engineer needs hacking 275 and
// charisma ZERO (base 0 stays 0), while Senior needs charisma 275 (base 51 +
// 224). A player who never trained charisma parks at Junior forever, and the
// forecast must model that wall rather than assume the ladder is climbable —
// pretending we reach CTO would understate the hours several-fold.
//
// The walk is piecewise: at each position the rate is constant; promote when
// BOTH the reputation threshold and the stats allow; otherwise ride the
// current position to the target. Charisma exp earned while working is
// ignored (conservative: it can only shorten the real time).
//
// ---------------------------------------------------------------------------
// VALID WITHIN ONE LIFE ONLY — and what an install actually does to this.
//
// Company reputation RESETS at every install (Company.ts:77-80), and so does
// charisma (PlayerObjectGeneralMethods.ts:93). What survives is company
// FAVOUR: the banked reputation converts through the same addRepToFavor curve
// factions use, and favour multiplies every later rep gain by (1 + favor/100)
// — 400k banked once is 143 favour, x2.43 forever. So a stint that spans an
// install is not lost, it is LADDERED: each life's partial rep permanently
// shortens the next life's walk. Callers pass `favor` (from getCompanyFavor)
// so the forecast shrinks as the ladder climbs; what this module does NOT do
// is model the install boundary itself — a forecast longer than the install
// cadence will complete across lives, not within one.
//
// ---------------------------------------------------------------------------
// NOT CALIBRATED — and what replaces the estimate.
//
// This save has never worked a company job, so no live measurement of company
// rep/sec exists to check the formula against. Every constant is cited to a
// source line, but per this repo's standing rule that is necessary and not
// sufficient. progress.js therefore measures the ACTUAL rate between passes
// the moment company work starts (same pattern as the faction rep rate), and
// the measured number replaces this estimate wherever both exist. Until then,
// every forecast built on this module is marked `estimated`.

/** CompanyPositionsMetadata.ts — the software track, base values.
 *  reqRep is the reputation at which the position can be APPLIED for;
 *  reqHacking/reqCharisma are bases, offset per company (see requiredSkills). */
export const SOFTWARE_TRACK = [
  { name: 'Software Engineering Intern', repMult: 0.9, hackEff: 85, chaEff: 15, chaExpGain: 0.02, reqHacking: 1, reqCharisma: 0, reqRep: 0 },
  { name: 'Junior Software Engineer', repMult: 1.1, hackEff: 85, chaEff: 15, chaExpGain: 0.05, reqHacking: 51, reqCharisma: 0, reqRep: 8e3 },
  { name: 'Senior Software Engineer', repMult: 1.3, hackEff: 80, chaEff: 20, chaExpGain: 0.08, reqHacking: 251, reqCharisma: 51, reqRep: 40e3 },
  { name: 'Lead Software Developer', repMult: 1.5, hackEff: 75, chaEff: 25, chaExpGain: 0.1, reqHacking: 401, reqCharisma: 151, reqRep: 200e3 },
  { name: 'Head of Software', repMult: 1.6, hackEff: 75, chaEff: 25, chaExpGain: 0.5, reqHacking: 501, reqCharisma: 251, reqRep: 400e3 },
  { name: 'Head of Engineering', repMult: 1.6, hackEff: 75, chaEff: 25, chaExpGain: 0.5, reqHacking: 501, reqCharisma: 251, reqRep: 800e3 },
  { name: 'Vice President of Technology', repMult: 1.75, hackEff: 70, chaEff: 30, chaExpGain: 0.6, reqHacking: 601, reqCharisma: 401, reqRep: 1.6e6 },
  { name: 'Chief Technology Officer', repMult: 2, hackEff: 65, chaEff: 35, chaExpGain: 1, reqHacking: 751, reqCharisma: 501, reqRep: 3.2e6 },
]

/** CompaniesMetadata.ts — the megacorps whose factions sell augmentations,
 *  with each company's jobStatReqOffset. The faction and the company are the
 *  SAME organisation under two names, and Fulcrum is the one that differs. */
export const MEGACORPS = [
  { faction: 'ECorp', company: 'ECorp', offset: 249, expMult: 3 },
  { faction: 'MegaCorp', company: 'MegaCorp', offset: 249, expMult: 3 },
  { faction: 'NWO', company: 'NWO', offset: 249, expMult: 2.75 },
  { faction: 'Bachman & Associates', company: 'Bachman & Associates', offset: 224, expMult: 2.6 },
  { faction: 'Blade Industries', company: 'Blade Industries', offset: 224, expMult: 2.75 },
  { faction: 'Clarke Incorporated', company: 'Clarke Incorporated', offset: 224, expMult: 2.25 },
  { faction: 'OmniTek Incorporated', company: 'OmniTek Incorporated', offset: 224, expMult: 2.25 },
  { faction: 'Four Sigma', company: 'Four Sigma', offset: 224, expMult: 2.5 },
  { faction: 'KuaiGong International', company: 'KuaiGong International', offset: 224, expMult: 2.2 },
  { faction: 'Fulcrum Secret Technologies', company: 'Fulcrum Technologies', offset: 224, expMult: 2 },
]

export const megacorpOf = (company) => MEGACORPS.find((m) => m.company === company) ?? null

import { expForSkill, skillFromExp } from 'installgate.js'

export const offsetOf = (company) => MEGACORPS.find((m) => m.company === company)?.offset ?? null

const MAX_SKILL = 975 // Constants.ts:16
const CYCLES_PER_SEC = 5 // Constants.ts:19, MilliPerCycle = 200

/**
 * Company reputation per second at one position — the formula above, ×5
 * cycles. `favor` defaults to 0 because a company we have never worked has
 * none, and favour only enters at a reset anyway.
 */
export function companyRepPerSec(pos, o = {}) {
  const num = (x) => typeof x === 'number' && isFinite(x) && x >= 0
  if (!pos || !num(pos.repMult)) return null
  const { hacking, charisma, intelligence = 0, companyRepMult, nodeCompanyRepMult, favor = 0 } = o
  if (!num(hacking) || !num(charisma) || !num(companyRepMult) || !num(nodeCompanyRepMult)) return null
  const perf =
    (pos.repMult * ((pos.hackEff * hacking) / MAX_SKILL + (pos.chaEff * charisma) / MAX_SKILL)) / 100 +
    Math.max(0, intelligence) / MAX_SKILL
  // nodeCompanyRepMult IS currentNodeMults.CompanyWorkRepGain (Work/Formulas.ts:156)
  // — the company formula's BitNode term, sibling of the FactionWorkRepGain the
  // faction formula carries, and just as silently droppable.
  const perCycle = perf * companyRepMult * (1 + favor / 100) * nodeCompanyRepMult
  return perCycle * CYCLES_PER_SEC
}

/** Does the player's stat sheet qualify for a position at a given company?
 *  The offset applies only to NONZERO bases (CompanyPosition.ts:146). */
export const qualifies = (pos, offset, o = {}) =>
  (pos.reqHacking > 0 ? (o.hacking ?? 0) >= pos.reqHacking + offset : true) &&
  (pos.reqCharisma > 0 ? (o.charisma ?? 0) >= pos.reqCharisma + offset : true)

/**
 * Hours of employment to reach `targetRep` at a company — a TRAJECTORY, not a
 * table lookup, because THE DESK ITSELF TRAINS CHARISMA. Each position pays
 * chaExpGain per cycle (CompanyPositionsMetadata.ts), scaled by the company's
 * expMultiplier, the BitNode's CompanyWorkExpGain and the player's
 * charisma_exp — at ECorp that is 0.66 exp/s for a Junior with our augs, which
 * banks ~51k exp over a full stint and lifts charisma from 1 to ~234 with no
 * university at all. A static-stats model calls that player "parked at Junior
 * forever"; the simulation watches charisma grow and promotes the moment BOTH
 * the reputation threshold and the (rising) stats allow.
 *
 * TRAINING IS A CANDIDATE, NOT A RULE. For each rung the stats cannot yet
 * reach, one candidate plan front-loads exactly enough Leadership study
 * (`uniChaExpPerSec`, the caller's best-university rate) to cross that rung's
 * charisma bar, then simulates the stint from there. The cheapest total time
 * wins — so "should we train first?" is answered by arithmetic on every
 * forecast, and the answer changes as favour banks, augs land and the stint
 * shrinks. No threshold constant to go stale.
 *
 * Charisma inputs are EXP + multipliers, not a level: growth happens in exp
 * space and the level is derived (skill.ts:13). A caller with only the level
 * may pass `charisma` and it is inverted through `chaMult` — exact, because
 * the curve is.
 *
 * Simulation step is 300 game-seconds: rep rates move only through charisma,
 * whose effectiveness share is 15-35%, so the error per step is far below the
 * measurement noise the estimate carries anyway.
 *
 * Returns `{ hours, trainH, trainToCha, path, cappedAt, estimated }` or null.
 */
export function hoursToCompanyRep(targetRep, o = {}) {
  const num = (x) => typeof x === 'number' && isFinite(x) && x >= 0
  if (!num(targetRep)) return null
  const offset = num(o.offset) ? o.offset : offsetOf(o.company)
  if (offset === null) return null
  const corp = megacorpOf(o.company)
  const startRep = num(o.currentRep) ? o.currentRep : 0
  if (startRep >= targetRep) return { hours: 0, trainH: 0, trainToCha: null, path: [], cappedAt: null, estimated: false }

  const chaMult = num(o.chaMult) && o.chaMult > 0 ? o.chaMult : 1
  const chaExp0 = num(o.chaExp) ? o.chaExp : num(o.charisma) ? Math.max(0, expForSkill(o.charisma, chaMult)) : null
  if (chaExp0 === null) return null

  // One candidate per charisma bar the stats cannot yet reach (hacking must
  // already qualify — we do not model hacking training, batching does it).
  // Candidate 0 is "no training". Bars above what the university could cross
  // in a month are not worth enumerating.
  const bars = [0]
  if (num(o.uniChaExpPerSec) && o.uniChaExpPerSec > 0) {
    for (const p of SOFTWARE_TRACK) {
      if (p.reqCharisma <= 0) continue
      if (!((o.hacking ?? 0) >= (p.reqHacking > 0 ? p.reqHacking + offset : 0))) continue
      const bar = p.reqCharisma + offset
      const needExp = Math.max(0, expForSkill(bar, chaMult) * 1.000000001 - chaExp0)
      if (needExp > 0 && needExp / o.uniChaExpPerSec < 30 * 24 * 3600 && !bars.includes(bar)) bars.push(bar)
    }
  }

  let best = null
  for (const bar of bars) {
    const trainExp = bar > 0 ? Math.max(0, expForSkill(bar, chaMult) * 1.000000001 - chaExp0) : 0
    const trainH = trainExp > 0 ? trainExp / o.uniChaExpPerSec / 3600 : 0
    const sim = simulate(targetRep, { ...o, offset, corp, startRep, chaMult, chaExp: chaExp0 + trainExp })
    if (!sim) continue
    const total = trainH + sim.hours
    if (!best || total < best.hours) {
      best = {
        hours: total,
        trainH,
        trainToCha: bar > 0 ? bar : null,
        path: sim.path,
        cappedAt: sim.cappedAt,
        estimated: sim.estimated,
      }
    }
  }
  return best
}

/** The stint itself, charisma growing as it runs. Pure inner loop. */
function simulate(targetRep, o) {
  const num = (x) => typeof x === 'number' && isFinite(x) && x >= 0
  const DT = 300 // game-seconds per step
  const MAX_STEPS = (60 * 24 * 3600) / DT // refuse beyond 60 days — that is "cannot"
  const chaExpMult = num(o.chaExpMult) && o.chaExpMult > 0 ? o.chaExpMult : 1
  // The company-side exp scale (Work/Formulas.ts:151): company.expMultiplier x
  // the BitNode's CompanyWorkExpGain (0.5 in BN4 — present in the verified
  // override table, and a silent 2x error if dropped).
  const expScale = (o.corp?.expMult ?? 1) * (num(o.nodeCompanyExpMult) ? o.nodeCompanyExpMult : 1)

  // HACKING GROWS TOO — from batching, at the measured exp flow, whether or
  // not we are at the desk. The promotion bars past Senior are hacking-gated
  // (Lead 401+offset, VP 601+offset), so a stint long enough for the level to
  // cross one must promote mid-walk exactly as it does for charisma. Absent
  // measurements degrade to the static level — the pre-trajectory answer.
  const hackGrows =
    num(o.hackExp) && num(o.hackExpRate) && o.hackExpRate > 0 && num(o.hackMult) && o.hackMult > 0
  const hackingAt = (t) => (hackGrows ? skillFromExp(o.hackExp + o.hackExpRate * t, o.hackMult) : o.hacking)

  let rep = o.startRep
  let chaExp = o.chaExp
  let t = 0
  const path = []
  let estimated = false
  for (let step = 0; step < MAX_STEPS; step++) {
    const cha = skillFromExp(chaExp, o.chaMult)
    const hacking = hackingAt(t)
    // Best rung whose reputation threshold AND stats are met right now.
    let pos = null
    for (const p of SOFTWARE_TRACK) {
      if (p.reqRep <= rep && qualifies(p, o.offset, { hacking, charisma: cha })) pos = p
    }
    if (!pos) return null // cannot even hold the intern desk
    const held = o.heldPosition && o.heldPosition === pos.name
    const rate =
      held && num(o.measuredRepPerSec) && o.measuredRepPerSec > 0
        ? o.measuredRepPerSec
        : companyRepPerSec(pos, { ...o, charisma: cha, hacking })
    if (!(rate > 0)) return null
    if (!(held && num(o.measuredRepPerSec) && o.measuredRepPerSec > 0)) estimated = true

    if (!path.length || path[path.length - 1].position !== pos.name) {
      path.push({ position: pos.name, fromRep: rep, atHour: t / 3600, repPerSec: rate })
    }
    const span = Math.min(DT, (targetRep - rep) / rate)
    rep += rate * span
    chaExp += pos.chaExpGain * CYCLES_PER_SEC * expScale * chaExpMult * span
    t += span
    if (rep >= targetRep) {
      const last = path[path.length - 1]
      const top = SOFTWARE_TRACK[SOFTWARE_TRACK.length - 1]
      return { hours: t / 3600, path, cappedAt: last.position !== top.name ? last.position : null, estimated }
    }
  }
  return null
}
