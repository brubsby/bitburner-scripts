// Replay of the BN4.3 install loop (2026-10-03 14:38Z / 15:18Z): the black-op
// exit of each install option on a captured state (history.jsonl person,
// bladeburner.txt division). Usage: node replay-bn4-1518.mjs <at-prefix> [expMult] [bbSuccess]
// CALIBRATION: with PLAYER=<the save's PlayerSave.data> PLAYER_STATE=1 on the
// 15:25Z state it gives never 4.26h against the live pass's 4.28h (15:23Z,
// plan.txt decisions.bladeRoute.bladeH) — the new life reproduced to 0.02h.
// The pre-install 15:18Z 'now' (live 3.47h) is NOT reproduced (3.99h here):
// that pass's division record was overwritten by the install.
import '../../test/gameresolve.mjs'
import fs from 'node:fs'
const BB = await import('bbplan.js')
const TEL = process.env.TEL ?? '/home/tbusby/Repos/bitburner-scripts/.telemetry'
const tel = JSON.parse(fs.readFileSync(`${TEL}/bladeburner.txt`, 'utf8'))
const lines = fs.readFileSync(`${TEL}/history.jsonl`, 'utf8').trim().split('\n').slice(-120).map((l) => JSON.parse(l))
const at = process.argv[2] ?? '2026-10-03T15:15'
const h = lines.find((r) => r.at.startsWith(at))
const lvl = (st) => h.skills[st] / (32 * Math.log(h.exp[st] + 534.6) - 200)
const em = +(process.argv[3] ?? 1.7)
const mults = { charisma: 1.5, charisma_exp: em, bladeburner_success_chance: +(process.argv[4] ?? 1), bladeburner_max_stamina: 1, bladeburner_stamina_gain: 1 }
for (const c of ['strength', 'defense', 'dexterity', 'agility']) {
  mults[c] = lvl(c)
  mults[c + '_exp'] = em
}
// The owned augmentations' product (snap-augstats x SF1.3 x NFG), scaled to the level mults the exp/level pairs show.
if (process.env.AUGM) Object.assign(mults, JSON.parse(process.env.AUGM))
// PLAYER=<save-decoded PlayerSave.data json>: the exact multipliers (BN4 has no combat level multiplier).
const PJ = process.env.PLAYER ? JSON.parse(fs.readFileSync(process.env.PLAYER, 'utf8')) : null
if (PJ && !process.env.KEEP_LEVEL) Object.assign(mults, PJ.mults)
const person = PJ && process.env.PLAYER_STATE ? { skills: PJ.skills, exp: PJ.exp, mults } : { skills: h.skills, exp: process.env.NOEXP ? {} : h.exp, mults }
console.log(at, JSON.stringify(h.skills), JSON.stringify(Object.fromEntries(Object.entries(mults).map(([k, v]) => [k, +v.toFixed(3)]))))
const g = 1.030309
const gains = Object.fromEntries(['strength', 'defense', 'dexterity', 'agility', 'charisma', 'strength_exp', 'defense_exp', 'dexterity_exp', 'agility_exp', 'charisma_exp'].map((k) => [k, g]))
const startFor = (spec) => BB.bladeStartOf({ tel, person, sleeves: JSON.parse(process.env.SLV ?? "{\"infiltrate\":0,\"support\":5,\"fa\":0}"), gymExpPerSec: 17.637649706829134, bnRank: 1, skillCostMult: 1, install: BB.bladeInstallOfSpec(spec), simulacrum: false, rankScale: 1.1838, successScale: 1.2061 })
const specs = [{ kind: 'never' }, { kind: 'wait', waitH: 0, blade: { gains } }, { kind: 'wait', waitH: 0, blade: { gains: {} } }, { kind: 'wait', waitH: 1, blade: { gains } }]
for (const spec of specs) {
  const s0 = startFor(spec)
  if (process.env.SKS) s0.skillSinceS = +process.env.SKS
  if (process.env.DUMP) console.log(JSON.stringify({ ...s0, cities: undefined, counts: undefined }).slice(0, 1500))
  s0.actTrace = []
  const r = BB.bladeExit(s0)
  console.log(JSON.stringify(spec).slice(0, 70), 'hours', r.hours?.toFixed(3), 'joinH', r.joinH, 'installs', r.installs)
  const tr = s0.actTrace
  console.log('  first', tr.slice(0, 3).map((x) => `${x.h}h ${x.name} L${x.level} p${x.p?.toFixed?.(2)} r${x.rank}`).join(' | '))
  console.log('  last ', tr.slice(-2).map((x) => `${x.h}h ${x.name} p${x.p?.toFixed?.(2)} r${x.rank}`).join(' | '))
}
