// THE RED PILL EARLIER THAN THE TERMINAL INSTALL — does it pay, through the
// hidden IPvGO opponent's hacking bonus or otherwise? (BN10.3 and every
// hacking-route node.)
//
//   node tools/sim/redpill-early.mjs                 BN10.3 (the plan's next) + the fixtures
//   node tools/sim/redpill-early.mjs --node 10 --level 3 [--no-fixtures] [--legs]
//
// TWO TRAJECTORIES ON ONE SET OF INPUTS (CLAUDE.md "Decisions compare simulated
// trajectories"): exitplan.bestExitPolicy with o.redPillEarly = 0 (today: the
// final window joins Daedalus, buys The Red Pill, installs it, climbs from
// level 1 with w0r1d_d43m0n farmed from that install) against m = 1, 2, 3
// (The Red Pill bought and installed m lives before the final window: that
// life carries the join + the reputation, the lives after it may farm the
// hidden opponent, and the final window has no join, no reputation and no
// terminal install). Each with the hidden opponent's farm (o.go.w0) and
// without, so the gain splits into the Go bonus and the rest.
//
// MECHANICS, from ~/Repos/bitburner/src:
//   opponent   GoOpponent.w0r1d_d43m0n "????????????" (Go/Enums.ts:9), 19x19 bitverse
//              board (boardState.ts:26-30), 7 handicap routers (boardState.ts:100-112),
//              komi 9.5 (Constants.ts:62-68), the Illuminati AI (goAI.ts:225-241)
//   unlock     resetBoardState refuses it unless The Red Pill is INSTALLED
//              (netscriptGoImplementation.ts:359-361, hasAugmentation(.., true))
//   bonus      mults.hacking x CalculateEffect (effect.ts:95-96, :16-22):
//              1 + ln(n+1) (n+1)^0.3 x 0.002 x 2 (bonusPower) x GoPower x (SF14 ? 2 : 1)
//   node power endGoGame adds black's score x difficulty x streak multiplier on a win
//              OR a loss (scoring.ts:84-87); ZEROED AT EVERY INSTALL
//              (Go.prestigeAugmentation, Go.ts:34-47) — it does NOT persist through
//              installs, only the favor-rep record does
//   exit       w0r1d_d43m0n (the server) exists only with The Red Pill installed
//              (ServerHelpers.ts:342); hacking 3000 x WorldDaemonDifficulty
//   Red Pill   2.5m rep x AugmentationRepCost at Daedalus (Augmentations.ts:1953-1959),
//              moneyCost 0; Daedalus needs DaedalusAugsRequirement augs, $100b,
//              hacking 2500 (FactionInfo.tsx:141-145)
//
// CALIBRATION (printed every run, CHECK lines):
//   w0 rate     the live record /tel/go-w0.txt (go.js w0RecordAdd): node power per
//               wall hour over the measured games, and games per hour from the same
//               record — against the rate goplan.goExitInputsOf feeds the live exit
//   income cap  BN10.1's last two lives (history.jsonl): $/s and exp/s against the
//               level — the elasticity the final window's money legs would need for
//               the hidden opponent's level bonus to buy money there
//   BN10.3      NOT CALIBRATED as a node (never played at level 3): its inputs are
//               the gameplan's fresh-entry inputs (hackexit.freshInputs, the
//               fitted rates), the final window's income anchored on BN10.1's
//               measured $/s (as gameplan's Covenant leg is), and g swept around the
//               value that reproduces the plan's own BN10.3 hours. The DIFFERENCE
//               between the variants is what this reports; it is printed at every g.
// NOT SIMULATED (named, never folded in): Stanek's charge, which a terminal install
// clears and an early Red Pill keeps through the final window (favours early); the
// in-life lift of the hidden opponent on BN10.3's lives (its inputs carry no
// level-scaled income or rep response — the fixtures price it on live-shaped lives).

import '../test/gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { REPO_ROOT } from '../test/gameresolve.mjs'
import { checkWithin, report } from './calibrate.mjs'

const X = await import(path.join(REPO_ROOT, 'exitplan.js'))
const GP = await import(path.join(REPO_ROOT, 'goplan.js'))
const argv = process.argv.slice(2)
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`)
  return i > -1 ? argv[i + 1] : d
}
const has = (n) => argv.includes(`--${n}`)
const TEL = process.env.TELEMETRY ?? path.join(REPO_ROOT, '.telemetry')
const NODE = Number(flag('node', 10))
const LEVEL = Number(flag('level', 3))
const MS = [0, 1, 2, 3]

// ---------------------------------------------------------------------------
// CHECK 1: the hidden opponent's live rate.
// ---------------------------------------------------------------------------
const w0rec = JSON.parse(fs.readFileSync(path.join(TEL, 'go-w0.txt'), 'utf8'))
const games = w0rec.games ?? []
const est = GP.rateEstimate(games)
const gph = games.length / games.reduce((a, g) => a + g.hours, 0)
const perGame = games.reduce((a, g) => a + g.power, 0) / games.length
// Wall time between game ends inside the one contiguous session (2026-10-13 00:27-01:02).
const ends = games.map((g) => Date.parse(g.at)).sort((a, b) => a - b)
const gaps = ends.slice(1).map((t, i) => (t - ends[i]) / 3.6e6).filter((h) => h < 0.2)
const wallGph = gaps.length / gaps.reduce((a, b) => a + b, 0)
console.log('CALIBRATION')
console.log(`  w0 live record: ${games.length} games ${games.filter((g) => g.won).length} won, ${est.value.toFixed(0)} +- ${est.sd.toFixed(0)} node power/h (ratio estimator), ${perGame.toFixed(0)} a game, ${gph.toFixed(1)} games/h by the record's hours, ${wallGph.toFixed(1)}/h by wall time between game ends`)
// What the live exit is fed NOW (goplan.goExitInputsOf on today's go.txt): the record's own
// games/h once go.js publishes it (w0RateOf gph, 2026-10-17), the prior's 11.4 before.
let goTel = null
try {
  goTel = JSON.parse(fs.readFileSync(path.join(TEL, 'go.txt'), 'utf8'))
} catch {}
const fed = GP.goExitInputsOf({ goPower: 1, sf14: 3, goTel }).go.w0
checkWithin('w0 games/h: what goExitInputsOf feeds the live exit (go.txt now) vs the record', fed.gamesPerH, wallGph, 0.15, (x) => x.toFixed(1))
checkWithin('w0 power/h: what goExitInputsOf feeds the live exit vs the record', fed.powerPerH, est.value, 0.15, (x) => x.toFixed(0))
console.log(`  (the prior games/h W0_GAMES_PER_H ${GP.W0_GAMES_PER_H} is ${((GP.W0_GAMES_PER_H / wallGph - 1) * 100).toFixed(0)}% off the record; the harness rate W0_HARNESS ${GP.W0_HARNESS.powerPerHour}/h, what the exit used before 14 games, ${((GP.W0_HARNESS.powerPerHour / est.value - 1) * 100).toFixed(0)}%)`)

// ---------------------------------------------------------------------------
// CHECK 2: does the end-game income move with the level? (BN10.1, 2026-09-25)
// ---------------------------------------------------------------------------
async function seriesOf(from, to) {
  const out = []
  // The stream is destroyed on the way out: a `break` out of the loop leaves it open,
  // and an open stream kept the process alive after its last line.
  const input = fs.createReadStream(path.join(TEL, 'history.jsonl'))
  const rl = readline.createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      const at = line.slice(7, 31)
      if (at < from) continue
      if (at > to) break
      const d = JSON.parse(line)
      out.push({ t: d.totalPlaytime / 3.6e6, money: d.money, lvl: d.skills?.hacking, exp: d.exp?.hacking, since: d.playtimeSinceLastAug / 3.6e6 })
    }
  } finally {
    rl.close()
    input.destroy()
  }
  return out
}
// The two lives either side of BN10.1's last install: the money and exp slopes over windows
// with no spend (money rising monotonically), against the mean level in each.
const ser = await seriesOf('2026-09-25T06:20', '2026-09-25T12:55')
const slope = (a, b) => {
  const xs = ser.filter((s) => s.t >= a && s.t <= b)
  const x0 = xs[0]
  const x1 = xs[xs.length - 1]
  return { lvl: (x0.lvl + x1.lvl) / 2, money: (x1.money - x0.money) / ((x1.t - x0.t) * 3600), exp: (x1.exp - x0.exp) / ((x1.t - x0.t) * 3600) }
}
if (ser.length > 10) {
  const t0 = ser[0].t
  // life A: 06:25-10:25 (no install, monotone money); life B after the 10:30 install: 11:00-11:55.
  const A = slope(t0, t0 + 4.0)
  const tB = ser.find((s) => s.since < 0.05 && s.t > t0 + 4)?.t
  const B = tB ? slope(tB + 0.5, tB + 1.4) : null
  if (B) {
    const eM = Math.log(B.money / A.money) / Math.log((B.lvl + 50) / (A.lvl + 50))
    const lifeB = ser.filter((s) => s.t >= tB + 0.5 && s.t <= tB + 2.3)
    const mid = tB + 1.4
    const B1 = slope(tB + 0.5, mid)
    const B2 = slope(mid, tB + 2.3)
    const eIn = Math.log(B2.exp / B1.exp) / Math.log((B2.lvl + 50) / (B1.lvl + 50))
    console.log(`  BN10.1 end-game income: life before the last install $${A.money.toExponential(3)}/s at level ${A.lvl.toFixed(0)}, after it $${B.money.toExponential(3)}/s at ${B.lvl.toFixed(0)}; inside the last life exp/s ${B1.exp.toExponential(3)} at ${B1.lvl.toFixed(0)} -> ${B2.exp.toExponential(3)} at ${B2.lvl.toFixed(0)} (${lifeB.length} rows)`)
    console.log(`  elasticity of exp/s to (level + 50) inside the last life: ${eIn.toFixed(2)} (the exit's affine law says 1; a landing-capped batcher 0) — across the two lives' $/s: ${eM.toFixed(2)}`)
    console.log(`  => the final window's money legs read the level WITHOUT the hidden opponent's bonus (exitplan: the 4 x spacing cap, batch.js:2267)`)
  }
} else console.log('  BN10.1 end-game series not in history.jsonl: the income-cap check did not run')
report('w0 rate')

// ---------------------------------------------------------------------------
// THE TRAJECTORIES.
// ---------------------------------------------------------------------------
const goW0 = (pph, gamesPerH, goPower, sf14) => ({ powerPerH: pph, gamesPerH, bonusPower: GP.OPPONENTS.w0r1d_d43m0n.power, goPower, sf14 })
function variants(base, label, { legs = has('legs') } = {}) {
  const rows = []
  for (const withW0 of [true, false]) {
    for (const m of MS) {
      const inp = { ...base, redPillEarly: m, go: withW0 ? base.go : base.go ? { ...base.go, w0: null } : null }
      const p = X.bestExitPolicy(inp)
      rows.push({ m, withW0, hours: p.best?.hours ?? null, k: p.best?.installsFirst ?? null, best: p.best, why: p.why })
    }
  }
  const at = (m, w) => rows.find((r) => r.m === m && r.withW0 === w)
  const f = (x) => (typeof x === 'number' && isFinite(x) ? x.toFixed(2).padStart(7) : '      -')
  console.log(`  ${label}`)
  console.log(`    Red Pill      with w0   installs  without w0  | early - terminal: with w0   without   (Go part = the difference)`)
  for (const m of MS) {
    const a = at(m, true)
    const b = at(m, false)
    const d1 = a.hours - at(0, true).hours
    const d0 = b.hours - at(0, false).hours
    console.log(`    ${m === 0 ? 'terminal     ' : `${m} life early `} ${f(a.hours)}h ${String(a.k ?? '-').padStart(5)}     ${f(b.hours)}h     |   ${m ? `${f(d1)}h   ${f(d0)}h   Go ${f(d1 - d0)}h` : `w0 on the climb worth ${f(b.hours - a.hours)}h`}`)
    if (legs && a.best) for (const l of a.best.legs ?? []) console.log(`        ${l.leg.padEnd(26)} ${f(l.hours)}h  ${(l.detail ?? '').slice(0, 230)}`)
  }
  const best = rows.filter((r) => r.withW0 && typeof r.hours === 'number').sort((x, y) => x.hours - y.hours)[0]
  console.log(`    -> best: ${best.m === 0 ? 'the terminal install (today)' : `${best.m} life(s) early`} at ${best.hours.toFixed(2)}h`)
  return rows
}

// BN10.3 from the gameplan's fresh-entry inputs.
if (!has('no-node')) {
  const { measureEconomy } = await import('./gameplan/economy.mjs')
  const H = await import('./nodechoice/hackexit.mjs')
  // measureEconomy backs every measured run's g out by bisection (minutes): cached on
  // history.jsonl's mtime in the gameplan's (gitignored) cache directory.
  const cacheFile = path.join(REPO_ROOT, 'tools/sim/gameplan/.cache/redpill-econ.json')
  const stamp = fs.statSync(path.join(TEL, 'history.jsonl')).mtimeMs
  let econ = null
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
    if (c.stamp === stamp) econ = c.econ
  } catch {}
  if (!econ) {
    econ = await measureEconomy()
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
    fs.writeFileSync(cacheFile, JSON.stringify({ stamp, econ: { profile: econ.profile, runs: econ.runs } }))
  }
  // The Source-Files on entry: today's, with the node in progress cleared (+1).
  const st = JSON.parse(fs.readFileSync(path.join(TEL, 'state.json'), 'utf8'))
  const sf = new Map(st.sourceFiles.data)
  sf.set(st.bitNode, Math.min(3, (sf.get(st.bitNode) ?? 0) + 1))
  const sfPairs = [...sf.entries()].sort((a, b) => a[0] - b[0])
  const m = H.nodeMults(NODE, LEVEL)
  const sf14 = sf.get(14) ?? 0
  const profile = H.profileFor(econ.profile, NODE)
  const run10 = econ.runs.find((r) => r.bn === 10)
  // The final window's income: BN10.1's measured end-game $/s (the gameplan Covenant leg's anchor).
  const INC = Number(flag('income', 2.48e12))
  const inputsAt = (g) => {
    const fi = H.freshInputs({ node: NODE, level: LEVEL, sf: sfPairs, profile, g })
    return {
      ...fi,
      incomePerSec: INC,
      flatIncomePerSec: INC,
      // Daedalus's invitation (FactionInfo.tsx:141-145): hacking 2500 and $100b in hand,
      // in whichever life joins it — freshInputs leaves the level out (0), which lets a
      // policy join at any multiplier; progress.js's live inputs carry it (joinLevel /
      // rejoinLevel), and so does this.
      joinLevel: 2500,
      rejoinLevel: 2500,
      rejoinMoney: 100e9,
      go: { w0: goW0(est.value, wallGph, m.GoPower, sf14) },
      // The 5th Covenant sleeve (BN10 only; sleeves.mjs covenantCost(4)): the final window's mandate.
      ...(NODE === 10 ? { covenant: { cost: 1e17, joinMoney: 75e9, combatH: 2.4, member: false, sleeveExpPerSec: 0 } } : {}),
    }
  }
  // (freshInputs banks the donation favor already: exitFavor 150 x FavorToDonate, the gameplan's favor life.)
  console.log(`\nBN${NODE}.${LEVEL} (SFs on entry ${sfPairs.map(([n, l]) => `${n}.${l}`).join(' ')}): exit level ${3000 * m.WorldDaemonDifficulty}, Red Pill ${(2.5e6 * m.AugmentationRepCost).toExponential(2)} rep, GoPower ${m.GoPower}, SF14.${sf14}; final-window income $${INC.toExponential(2)}/s (measured BN10.1)`)
  console.log(`  w0 farm: ${est.value.toFixed(0)}/h at ${wallGph.toFixed(1)} games/h (the live record) -> W after 1/3/10 games ${[1, 3, 10].map((k) => GP.effectAt(perGame * k, 2, m.GoPower, sf14).toFixed(3)).join(' / ')}, after 1h/3h ${[1, 3].map((h) => GP.effectAt(est.value * h, 2, m.GoPower, sf14).toFixed(3)).join(' / ')}`)
  // g: the plan's own BN10.3 hours (stanek+cov5 61-67h over the gameplan's runs) — find the g that
  // reproduces ~62h on the terminal variant, then sweep around it.
  const target = Number(flag('target', 62))
  let lo = Math.log(0.01)
  let hi = Math.log(0.5)
  const hAt = (lg) => X.bestExitPolicy({ ...inputsAt(Math.exp(lg)), redPillEarly: 0 }).best?.hours ?? Infinity
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    if (hAt(mid) > target) lo = mid
    else hi = mid
  }
  const g0 = Math.exp((lo + hi) / 2)
  console.log(`  g reproducing the plan's ${target}h (terminal Red Pill, with w0 and the Covenant): ${g0.toFixed(4)}/h (BN10.1 measured ${run10 ? run10.g.toFixed(4) : '?'})`)
  for (const k of [0.8, 1, 1.25]) variants(inputsAt(g0 * k), `g ${(g0 * k).toFixed(4)} (x${k})`)
  // The prior rate goplan carried before the record (11.4 games/h, the harness's power).
  variants({ ...inputsAt(g0), go: { w0: goW0(GP.W0_HARNESS.powerPerHour, GP.W0_GAMES_PER_H, m.GoPower, sf14) } }, `g ${g0.toFixed(4)}, w0 at the harness rate ${GP.W0_HARNESS.powerPerHour}/h, ${GP.W0_GAMES_PER_H} games/h`)
  // The join level left out (the gameplan's freshInputs as they are): every policy joins
  // Daedalus at any multiplier, so the hidden opponent's shortcut runs to a ~1.6 multiplier.
  variants({ ...inputsAt(g0), joinLevel: 0, rejoinLevel: 0 }, `g ${g0.toFixed(4)}, the join level UNPRICED (freshInputs as the gameplan has them)`)
  // Without the Covenant: what every other hacking node's final window looks like.
  variants({ ...inputsAt(g0), covenant: null }, `g ${g0.toFixed(4)}, NO Covenant mandate (every other hacking node's window shape)`)
}

// Live-shaped lives (fixtures with the farm, level-scaled income and the planner's responses):
// the hidden opponent as a LIFE's arm after an early Red Pill.
if (!has('no-fixtures')) {
  console.log('\nLIVE-SHAPED FIXTURES (progress.js exitInputsOf records: the farm, level-scaled income, eRep/eBudget)')
  for (const name of ['fixture-bn13-lifelength-2103.json', 'fixture-bn12-farmsplit-1450.json', 'fixture-bn7-splitroute-0946.json', 'fixture-bn12-splitctl-1600.json']) {
    const f = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test', name), 'utf8'))
    const ei = f.exitinputs ?? f
    const base = { ...ei.inputs, eRep: ei.eRep ?? ei.inputs.eRep, eBudget: ei.eBudget ?? ei.inputs.eBudget }
    // The measured rate, not the fixture's harness one.
    if (base.go?.w0) base.go = { ...base.go, w0: { ...base.go.w0, powerPerH: est.value, gamesPerH: wallGph } }
    const rows = variants(base, `${name} (exit level ${base.exitLevel})`)
    const r2 = rows.find((r) => r.m === 2 && r.withW0)?.best
    const pr = r2?.go?.life?.postRedPill
    if (pr) console.log(`    a life after the Red Pill: ${pr.now.plan} (money x${pr.now.Km.toFixed(3)}, rep x${pr.now.Kr.toFixed(3)}) ln ${pr.ln.toFixed(4)} against the other arms' ${r2.go.life.ln.toFixed(4)}: g x${Math.exp(pr.ln - r2.go.life.ln).toFixed(4)} a life`)
  }
}
