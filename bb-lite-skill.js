// bb-lite-skill.js — one shot, on the model's cadence (POLICY.skillEveryS,
// hourly): read the skill points and levels, plan with bbplan.planSkills on
// the lean view (LITE_POLICY — the same objective the lean pick serves), and
// buy. Stops at the first purchase the game disagrees with.
//
//   args[0]  JSON {person, reads, stamina, maxStamina, rank, bnRank, costMult}
//
// RAM: base 1.6 + getSkillPoints 4 + getSkillLevel 4 + upgradeSkill 4 = 13.6GB.
import { LITE_PORT, LITE_POLICY, leanViewOf } from 'bbliteplan.js'
import { SKILLS, planSkills } from 'bbplan.js'

export async function main(ns) {
  const out = { actor: 'skill', ok: false, purchases: [] }
  try {
    const want = JSON.parse(String(ns.args[0] ?? '{}'))
    const bb = ns.bladeburner
    const levels = {}
    for (const name of Object.keys(SKILLS)) levels[name] = bb.getSkillLevel(name)
    let sp = bb.getSkillPoints()
    out.before = sp
    if (sp >= 1) {
      const view = leanViewOf({ person: want.person, reads: want.reads, levels, stamina: want.stamina, maxStamina: want.maxStamina, rank: want.rank, bnRank: want.bnRank ?? 1 })
      for (const b of planSkills(view, sp, LITE_POLICY, want.costMult ?? 1, LITE_POLICY.skillChunks)) {
        const before = bb.getSkillLevel(b.name)
        bb.upgradeSkill(b.name, b.count)
        const after = bb.getSkillLevel(b.name)
        out.purchases.push({ name: b.name, count: b.count, cost: b.cost, got: after - before, why: b.why })
        if (after !== before + b.count) break
        levels[b.name] = after
      }
      sp = bb.getSkillPoints()
    }
    out.levels = levels
    out.skillPoints = sp
    out.ok = true
  } catch (e) {
    out.error = String(e?.message ?? e).slice(0, 300)
  }
  ns.writePort(LITE_PORT, JSON.stringify(out))
}
