// THE BN14.1 BLADEBURNER POLICY AUDIT, held (tools/sim/bb14.mjs, tools/sim/bb14/arms.mjs).
//
//   BA1 THE START IS THE LIVE ONE: the solved level multipliers reproduce every live level in the
//       game's classes (fixture-bn14-bbaudit.json, 14:13Z 2026-10-04, rank 1134).
//   BA2 THE SHIPPED SKILL POLICY BEATS THE BN6-TUNED ONE in the game's classes, CRN-paired: the
//       black-op objective only from Daedalus's rank, 600s, chunks 1, 'max' (audit: -10.5h of 28.1h).
//   BA3 THE MODEL PRICES THE POLICY IT PLAYS: bladeExit on the same start within 10% of the game's
//       mean under the shipped POLICY (audit: -3%), and a replay can price the policy that ran
//       (s0.policy = POLICY_V1 reproduces the old model's exit exactly).
//   BA4 THE SKILL OBJECTIVE: below Daedalus's rank a short, rank-eligible black op does not take the
//       objective; at it, it does; POLICY_V1's 'eligible' still switches as before.
//   BA6 THE RANK k DOES NOT DOUBLE-COUNT ITS INPUTS (bbplan.rankCalStep v3): from a state as read, the
//       model's next hour of rank is the game's (14:13Z and 20:01Z), so the residual k measures is ~1;
//       the live hour after 14:13Z ran +884 against both (+599 model, ~+608 game) — inputs that moved
//       (the fleet, the cities, the skills), which v2 read as k. On the 20:01Z state (Aevum anchored,
//       06cf3dc) the members' exit at k 1 is the game's within 5%; at the v2 k 1.196 it is >1h short.
import './gameresolve.mjs'
import { Check } from './harness.mjs'

const BB = await import('bbplan.js')
const A = await import('../sim/bb14.mjs')

export async function run() {
  const checks = []
  const fx = A.loadFx()
  const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x))

  const c1 = new Check('BA1', 'THE START IS THE LIVE ONE: the solved level multipliers reproduce every live level in the game\'s classes')
  checks.push(c1)
  const r0 = A.runFrom(fx, {}, { seed: 1, maxH: 0.01 })
  for (const [s, x] of Object.entries(r0.check)) {
    c1.examined(1)
    if (x.sim !== x.live) c1.fail(`${s}: sim level ${x.sim} vs live ${x.live}`)
  }
  c1.note(JSON.stringify(r0.check))

  const c2 = new Check('BA2', "THE SHIPPED SKILL POLICY BEATS THE BN6-TUNED ONE in the game's classes (CRN-paired seeds)")
  checks.push(c2)
  const SEEDS = 12
  const v1 = []
  const now = []
  for (let seed = 1; seed <= SEEDS; seed++) {
    v1.push(A.runFrom(fx, { sharedPolicy: BB.POLICY_V1, skillEveryS: BB.POLICY_V1.skillEveryS }, { seed, maxH: 90 }).hours ?? 135)
    now.push(A.runFrom(fx, {}, { seed, maxH: 90 }).hours ?? 135)
  }
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
  const d = now.map((h, i) => h - v1[i])
  c2.examined(SEEDS)
  c2.note(`game mean: POLICY_V1 ${f2(mean(v1))}h, shipped ${f2(mean(now))}h; paired diff ${f2(mean(d))}h, shipped faster on ${d.filter((x) => x < 0).length}/${SEEDS}`)
  if (!(mean(d) < -5)) c2.fail(`the shipped policy must be >5h faster than POLICY_V1 from the live start (got ${f2(mean(d))}h)`)

  const c3 = new Check('BA3', 'THE MODEL PRICES THE POLICY IT PLAYS: bladeExit within 10% of the game under the shipped POLICY; s0.policy prices a replay\'s')
  checks.push(c3)
  const s0 = A.modelStartOf(fx)
  const m = BB.bladeExit(s0).hours
  c3.examined(2)
  c3.note(`model ${f2(m)}h vs game mean ${f2(mean(now))}h (${f2((m / mean(now) - 1) * 100)}%)`)
  if (!(Math.abs(m / mean(now) - 1) < 0.1)) c3.fail(`the model must be within 10% of the game (${f2(m)} vs ${f2(mean(now))}h)`)
  const viaS0 = BB.bladeExit({ ...s0, policy: BB.POLICY_V1 }).hours
  const viaPol = BB.bladeExit(s0, { ...BB.POLICY, ...BB.POLICY_V1 }).hours
  if (viaS0 !== viaPol) c3.fail(`s0.policy must be the policy argument (${viaS0} vs ${viaPol})`)
  if (BB.bladeStartOf({ tel: fx.tel, person: s0.person, policy: BB.POLICY_V1 }).policy !== BB.POLICY_V1) c3.fail('bladeStartOf must carry policy onto the start')

  const c4 = new Check('BA4', "THE SKILL OBJECTIVE: a short black op takes it only from Daedalus's rank (POLICY_V1: as soon as eligible)")
  checks.push(c4)
  const sm = BB.skillMultsOf({})
  const person = { skills: { hacking: 100, strength: 200, defense: 200, dexterity: 200, agility: 200, charisma: 100, intelligence: 100 }, mults: {} }
  const view = (rank) => ({
    person, sm, levels: {}, bnRank: 1, rank, stamina: 100, maxStamina: 100, staminaGain: 1, ref: { pop: 1e9, chaos: 0 }, cities: [{ name: 'Aevum', pop: 1e9, chaos: 0, comms: 50 }], city: 'Aevum',
    actions: BB.LEVELED.map((dd) => ({ d: dd, count: 100, maxLevel: 5, K: 1, width: 0 })), blackOp: { d: BB.BLACK_OPS[0], K: 1, width: 0 },
  })
  const kind = (rank, pol) => BB.skillScore(view(rank), pol).kind
  c4.examined(3)
  if (kind(3000, BB.POLICY) !== 'rank') c4.fail('below Daedalus\'s rank the shipped objective must stay rank/s')
  if (kind(BB.BLACK_OPS[20].reqdRank, BB.POLICY) !== 'blackop') c4.fail('at Daedalus\'s rank a short black op must take the objective')
  if (kind(3000, { ...BB.POLICY, ...BB.POLICY_V1 }) !== 'blackop') c4.fail('POLICY_V1 must switch as soon as the black op is eligible')

  const c5 = new Check('BA5', 'A COLLAPSED ESTIMATE (20:00Z Aevum popEst 4) is priced from its anchor (communities consumed, our own attempts) or a typical city — never the estimate')
  checks.push(c5)
  c5.examined(4)
  const a = BB.unreadPopOf({ comms: 75 }, { pop: 2.025e9, comms: 104 }, [1e9])
  if (!(a?.from === 'anchor' && Math.abs(a.pop / (2.025e9 * Math.pow(0.99, 29)) - 1) < 1e-9)) c5.fail(`anchor: 29 communities consumed take 1% each (got ${JSON.stringify(a)})`)
  const med = BB.unreadPopOf({ comms: 75 }, null, [1.565e9, 0.97e9, 0.92e9, 1.39e9, 1.28e9])
  if (!(med?.from === "median" && med.pop === 1.28e9)) c5.fail(`no anchor: the median of the readable cities (got ${JSON.stringify(med)})`)
  if (BB.unreadPopOf({ comms: 1 }, null, []) !== null) c5.fail('nothing to go on must be null (the estimate stands, named)')
  const moved = BB.anchorAfter({ pop: 1e9, comms: 10 }, 'Stealth Retirement Operation', 10, 8)
  if (!(Math.abs(moved.pop - 1e9 * Math.pow(0.995, 8)) < 1)) c5.fail(`Stealth Retirement successes take 0.5% each (got ${moved.pop})`)
  c5.note(`anchor ${f2(a.pop / 1e9)}e9, median ${f2(med.pop / 1e9)}e9, after 8 SRO successes ${f2(moved.pop / 1e9)}e9`)

  const c6 = new Check('BA6', "THE RANK k DOES NOT DOUBLE-COUNT ITS INPUTS: from a state as read the model's next hour is the game's; on 20:01Z the members' exit at k 1 is the game's, at the v2 k 1.196 it is >1h short")
  checks.push(c6)
  const hourOf = (f, N) => {
    const r0 = f.tel.rank
    const m = BB.bladeExit({ ...A.modelStartOf(f), maxH: 1.1, pathEveryS: 300 })
    const g = []
    for (let seed = 1; seed <= N; seed++) {
      let at1 = null
      A.runFrom(f, { onStep: ({ t, bb }) => { if (at1 === null && t >= 3600) at1 = bb.rank - r0 } }, { seed, maxH: 1.05 })
      g.push(at1)
    }
    return { model: BB.rankOnPath(m.path, 1) - r0, game: mean(g) }
  }
  // 14:13Z (fixture-bn14-bbaudit.json): rank 1134.38; the plan records 15:11:22Z 1973.89, 15:16:21Z 2075.39 (/tmp/fx/hist).
  const live1413 = 1973.89 + ((2075.39 - 1973.89) * (Date.parse('2026-10-04T15:13:34.824Z') - Date.parse('2026-10-04T15:11:22Z'))) / (Date.parse('2026-10-04T15:16:21Z') - Date.parse('2026-10-04T15:11:22Z')) - 1134.38
  const h1 = hourOf(fx, 12)
  const fx20 = A.loadFx(A.FX_PATH.replace('fixture-bn14-bbaudit.json', 'fixture-bn14-bbaudit-2001.json'))
  const aev = fx20.tel.cities.find((c) => c.name === 'Aevum')
  aev.pop = BB.unreadPopOf(aev, { pop: 2.025e9, comms: 104 }).pop
  const h2 = hourOf(fx20, 12)
  c6.examined(2)
  c6.note(`14:13Z next hour: model +${h1.model.toFixed(0)}, game +${h1.game.toFixed(0)} (12 seeds), live +${live1413.toFixed(0)}; 20:01Z: model +${h2.model.toFixed(0)}, game +${h2.game.toFixed(0)}`)
  for (const [lab, h] of [['14:13Z', h1], ['20:01Z', h2]]) if (!(Math.abs(h.model / h.game - 1) < 0.1)) c6.fail(`${lab}: the model's hour from the state as read must be the game's within 10% (model ${h.model.toFixed(0)} vs game ${h.game.toFixed(0)})`)
  if (!(live1413 / h1.game > 1.3)) c6.fail(`the live hour after 14:13Z ran past the game's from that state (the inputs moved): ${live1413.toFixed(0)} vs ${h1.game.toFixed(0)}`)
  const sc = fx20.bladeRoute.calibration.success
  const exitAt = (k) => {
    const s0 = { ...A.modelStartOf(fx20), successScale: sc.k, successSdLn: sc.sdLn, rankScale: k, rankSdLn: fx20.bladeRoute.calibration.rank.sdLn }
    const Q = BB.BLADE_ENSEMBLE.Q
    return BB.bladeMeanOf(Array.from({ length: Q }, (_, m) => BB.bladeExit(BB.bladeMemberOf(s0, m, Q)).hours)).hours
  }
  const game = []
  for (let seed = 1; seed <= 16; seed++) game.push(A.runFrom(fx20, {}, { seed, maxH: 40 }).hours)
  const g20 = mean(game)
  const e1 = exitAt(1)
  const eV2 = exitAt(fx20.bladeRoute.calibration.rank.k)
  c6.examined(3)
  c6.note(`20:01Z exit: game ${f2(g20)}h (16 seeds); members at k 1 ${f2(e1)}h (${(100 * (e1 / g20 - 1)).toFixed(1)}%); at the v2 k ${fx20.bladeRoute.calibration.rank.k} ${f2(eV2)}h (${(100 * (eV2 / g20 - 1)).toFixed(1)}%)`)
  if (!(Math.abs(e1 / g20 - 1) < 0.05)) c6.fail(`at k 1 the members' exit must be the game's within 5% (${f2(e1)} vs ${f2(g20)}h)`)
  if (!(g20 - eV2 > 1)) c6.fail(`the v2 k must price the state > 1h short (the double count): ${f2(eV2)} vs ${f2(g20)}h`)
  return checks
}
