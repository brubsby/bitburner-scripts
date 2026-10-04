// ACTION CHOICE WITH A VALUE ON COMBAT EXP (audit item 2): score = rank/s at
// the stamina duty + T x (d best-rank-rate / d exp) . (the action's exp/s),
// i.e. rank now plus the rank the exp's level gain buys over the next T
// seconds. T = 0 is the shipped myopic chooser. The gradient is numeric: the
// incumbent's best duty-weighted rank/s (skillScore 'max') with each combat
// stat's exp raised 10%.
const bp = await import('bbplan.js')
const COMBAT = ['strength', 'defense', 'dexterity', 'agility']


function rateOf(v, pol) {
  return bp.skillScore({ ...v, blackOp: null, __memo: null }, { ...pol, skillObjective: 'max' }).v
}

export function expValueChooser(T) {
  return (v, pol, { P, g }) => {
    const nodeMults = g.currentNodeMults
    const pick = bp.chooseAction(v, pol)
    if (!T || pick.type === bp.TYPE.general || pick.blackOp) return pick
    const base = rateOf(v, pol)
    const grad = {}
    for (const s of COMBAT) {
      const e0 = P.exp[s]
      const de = Math.max(100, 0.1 * e0)
      const cap = s[0].toUpperCase() + s.slice(1)
      const lv = bp.levelFromExp(e0 + de, P.mults[s] * nodeMults[`${cap}LevelMultiplier`])
      const person = { ...v.person, skills: { ...v.person.skills, [s]: lv }, mults: v.person.mults }
      grad[s] = (rateOf({ ...v, person }, pol) - base) / de
    }
    let best = null
    const ref = v.ref
    for (const a of v.actions) {
      for (const c of v.cities) {
        if (a.d.name === 'Raid' && ((c.comms ?? 0) < 1 || (c.chaos ?? 0) > pol.raidChaos)) continue
        if ((c.chaos ?? 0) > bp.BBC.ChaosThreshold) continue
        const b = bp.bestLevel(a, v, pol, bp.cityFactor(c, ref))
        if (!b) continue
        const duty = bp.dutyOf(bp.staminaCostOf(a.d, b.L), b.t, v.staminaGain ?? Infinity, v.maxStamina ?? 1)
        const x = bp.actionExpOf(a.d, b.L, v.person, v.sm, true)
        const share = b.p + (1 - b.p) * 0.5
        let gain = 0
        for (const s of COMBAT) gain += grad[s] * ((x[s] * share * (P.mults[`${s}_exp`] ?? 1)) / b.t)
        const score = duty * (b.ev + T * gain)
        if (!best || score > best.score) best = { a, b, c, score }
      }
    }
    if (!best) return pick
    return { type: bp.typeOf(best.a.d), name: best.a.d.name, level: best.b.L, city: best.c.name, p: best.b.p, ev: best.b.ev, why: `exp-valued T ${T}` }
  }
}

