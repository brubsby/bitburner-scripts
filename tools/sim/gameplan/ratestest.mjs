// The game-dependent half of tools/test/gameplan-rates.test.mjs (RT3-RT5), run in a child
// process so the suite's own process never loads the game bundle. Prints one JSON line:
// { rt3: {examined, notes, fails}|{skip}, rt4: ..., rt5: ... }.
//
// CALIBRATION: a test harness, not a model. RT3 is a REGRESSION (the old constants reproduce
// the numbers the planner printed before the fitted rates, captured 2026-10-03 from the code at
// b13e2c2); RT4 is the CALIBRATION of the fitted rates on the played nodes (each run's hours
// and final-window rates predicted without it, against what it measured, with the error printed
// pass or fail); RT5 checks the node in progress's own reading reaches its pricing and only its.
//
//   TELEMETRY=<.telemetry> node tools/sim/gameplan/ratestest.mjs

import '../../test/gameresolve.mjs'

const out = { rt3: { examined: 0, notes: [], fails: [] }, rt4: { examined: 0, notes: [], fails: [] }, rt5: { examined: 0, notes: [], fails: [] } }
const done = () => {
  console.log(JSON.stringify(out))
  process.exit(0)
}

let E, H, G, D, R
try {
  E = await import('./economy.mjs')
  H = await import('../nodechoice/hackexit.mjs')
  G = await import('./gmodel.mjs')
  D = await import('./discrepancy.mjs')
  R = await import('./rates.mjs')
} catch (err) {
  out.rt3 = out.rt4 = out.rt5 = { skip: `modules unavailable: ${String(err?.message ?? err).slice(0, 300)}` }
  done()
}
let ec, ef
try {
  ec = await E.measureEconomy({ rates: 'const' })
  ef = await E.measureEconomy({ rates: 'fit', inRun: [] })
} catch (err) {
  out.rt3 = out.rt4 = out.rt5 = { skip: `telemetry unavailable (set TELEMETRY): ${String(err?.message ?? err).slice(0, 300)}` }
  done()
}

// ---------------------------------------------------------------- RT3: the old constants reproduce the old numbers
{
  const c = out.rt3
  // posterior.json's base g (economy.MEASURED_RUNS backed out by the code before the fitted rates)
  const OLD_G = { 2: 0.13807218016769682, 4: 0.06744519758934872, 10: 0.0345691218475102, 8: 0.04054500408883542, 1: 0.05208666295775621, 9: 0.05019075260244759 }
  for (const r of ec.runs) {
    c.examined++
    const rel = Math.abs(r.g / OLD_G[r.bn] - 1)
    if (!(rel < 1e-6)) c.fails.push(`--rates const: ${r.name} g ${r.g} vs ${OLD_G[r.bn]} before the fit (rel ${rel.toExponential(2)})`)
  }
  c.notes.push(`--rates const: the 6 base runs' g reproduce posterior.json's base readings to < 1e-6 (${ec.runs.map((r) => `BN${r.bn} ${r.g.toFixed(4)}`).join(', ')})`)
  // the BN14 hacking exit at the old covariate g (probe at b13e2c2: 42.4597h)
  const h = H.hackExitHours({ node: 14, sf: ec.live.sfOnEntry, profile: ec.profile, g: 0.0885 }).hours
  c.examined++
  if (!(Math.abs(h - 42.45965854228459) < 1e-6)) c.fails.push(`--rates const: BN14 at g 0.0885 ${h}h vs 42.4597h before the fit`)
  c.notes.push(`--rates const: BN14 exit at g 0.0885 ${h.toFixed(4)}h (before the fit: 42.4597h)`)
  // the old inputs, formula for formula
  const prof = ec.profile
  for (const n of [1, 8, 9, 14]) {
    const inp = H.freshInputs({ node: n, sf: ec.live.sfOnEntry, profile: prof, g: 0.05 })
    const m = H.nodeMults(n)
    const s = H.sfMults(ec.live.sfOnEntry)
    const poor = m.ScriptHackMoneyGain === 0
    const wantE = (poor ? prof.expPoor : prof.expRich * m.HackExpGain) * s.hacking_exp * m.HackingSpeedMultiplier
    const wantI = poor ? 0 : prof.incomeL1 * m.ScriptHackMoney * m.ServerMaxMoney * m.ScriptHackMoneyGain * s.hacking_money * m.HackingSpeedMultiplier
    c.examined++
    if (inp.expPerSec !== wantE || inp.incomePerSec !== wantI || 'flatIncomePerSec' in inp) c.fails.push(`--rates const BN${n}: inputs exp ${inp.expPerSec} income ${inp.incomePerSec} flat ${inp.flatIncomePerSec} vs the old ${wantE} / ${wantI} / none`)
  }
  // the old g model's LOO on the old g (posterior.json gModel at b13e2c2: full -4.285, exch -6.465, amc -6.831, hand -10.29)
  const L = G.looCompare(ec.runs.map((r) => ({ bn: r.bn, g: r.g, sd: 0.15 })), H.nodeMults, { models: ['hand', 'exch', 'amc', 'full'] })
  const want = { full: -4.285, exch: -6.465, amc: -6.831, hand: -10.29 }
  for (const [k, v] of Object.entries(want)) {
    c.examined++
    if (!(Math.abs(L.models[k].elpd - v) < 0.01)) c.fails.push(`old g model LOO: ${k} elpd ${L.models[k].elpd.toFixed(3)} vs ${v} before`)
  }
  c.notes.push(`old models on the old g: elpd ${Object.keys(want).map((k) => `${k} ${L.models[k].elpd.toFixed(2)}`).join(', ')} (before: full -4.29, exch -6.47, amc -6.83, hand -10.29) -> ${L.best}`)
}

// ---------------------------------------------------------------- RT4: the fitted rates on the played nodes
{
  const c = out.rt4
  // (a) in-sample: each run's backed-out g reproduces its hours (the calibration the g IS)
  for (const r of ef.runs) {
    const h = H.hackExitHours({ node: r.bn, sf: r.sfOnEntry, profile: ef.profile, g: r.g }).hours
    c.examined++
    if (!(Math.abs(h - r.T) < 0.1)) c.fails.push(`fitted rates: ${r.name} replays ${h?.toFixed(2)}h vs measured ${r.T.toFixed(2)}h at its own g`)
  }
  c.notes.push(`(a) every played run replays its measured hours at its backed-out g under the fitted rates (< 0.1h): ${ef.runs.map((r) => `BN${r.bn} g ${r.g.toFixed(4)}`).join(', ')}`)
  // (b) the hours of each played run predicted WITHOUT it: the kept g model's leave-one-out g, through the
  // fitted-rates simulation, against the measured hours (z on the predictive's own sd + the discrepancy prior)
  const runs = ef.runs.map((r) => ({ bn: r.bn, g: r.g, sd: 0.15 }))
  const L = G.looCompare(runs, H.nodeMults)
  const kept = L.best
  const rows = []
  let worst = 0
  ef.runs.forEach((r, i) => {
    const p = L.models[kept].per[i]
    const mom = D.lnHoursMoments((g) => H.hackExitHours({ node: r.bn, sf: r.sfOnEntry, profile: ef.profile, g }).hours ?? Infinity, p.mean, p.sd)
    const sd = Math.sqrt(mom.var + D.PRIOR_SD ** 2)
    const z = (Math.log(r.T) - mom.mean) / sd
    worst = Math.max(worst, Math.abs(z))
    c.examined++
    rows.push(`BN${r.bn} ${r.T.toFixed(1)}h vs ${Math.exp(mom.mean).toFixed(1)}h (z ${z.toFixed(2)})`)
    if (!(Math.abs(z) <= 2.5)) c.fails.push(`leave-one-out hours: ${r.name} measured ${r.T.toFixed(1)}h, predicted ${Math.exp(mom.mean).toFixed(1)}h, z ${z.toFixed(2)} outside 2.5 sd`)
  })
  c.notes.push(`(b) leave-one-out hours (${kept} model, fitted rates): ${rows.join('; ')}; worst |z| ${worst.toFixed(2)} (tolerance 2.5: six runs, the stated error is the predictive sd)`)
  // (c) the rates' own leave-one-out: each run's final-window rate predicted without its node
  for (const [ch, cc] of Object.entries(ef.rates.channels)) {
    for (const l of cc.loo) {
      c.examined++
      if (!(Math.abs(l.z) <= 2.5)) c.fails.push(`rates LOO ${ch} BN${l.bn}: measured ${l.measured.toExponential(2)} predicted ${l.predicted.toExponential(2)} z ${l.z.toFixed(2)} outside 2.5 sd`)
    }
    c.notes.push(`(c) ${ch} rate LOO: ${cc.loo.map((l) => `BN${l.bn} ln err ${l.err.toFixed(2)} (z ${l.z.toFixed(2)})`).join(', ')}; predictive sd ~${(cc.loo.reduce((a, l) => a + l.sd, 0) / cc.loo.length).toFixed(1)} in ln`)
  }
}

// ---------------------------------------------------------------- RT5: the node in progress's own reading
{
  const c = out.rt5
  const bn = ef.rates.liveRun.bn
  const base = ef.rates.channels.exp.nodes[bn]
  const y = base.prior.mean + 2 // a reading two units of ln above the prior
  const reading = { param: `xr${bn}`, value: Math.exp(y), sd: 0.5, key: `xr${bn}|${ef.rates.liveRun.start}|test` }
  const e2 = await E.measureEconomy({ rates: 'fit', inRun: [reading] })
  const post = e2.rates.channels.exp.nodes[bn]
  const want = (base.prior.mean / base.prior.sd ** 2 + y / 0.5 ** 2) / (1 / base.prior.sd ** 2 + 1 / 0.5 ** 2)
  c.examined++
  if (!(Math.abs(post.mean - want) < 1e-9)) c.fails.push(`BN${bn} exp level with a reading: ${post.mean} vs the precision-weighted ${want}`)
  let others = 0
  for (let n = 1; n <= 14; n++) {
    if (n === bn) continue
    c.examined++
    if (JSON.stringify(H.profileFor(e2.profile, n)) !== JSON.stringify(H.profileFor(ef.profile, n))) others++
  }
  if (others) c.fails.push(`a reading of BN${bn} changed ${others} other node(s)' profile slice (their surrogate curves would be rebuilt)`)
  // the reading reaches the node's exit inputs (BN14.2/14.3 share it: the slice is per node)
  const a = H.freshInputs({ node: bn, sf: ef.live.sfOnEntry, profile: ef.profile, g: 0.05 }).expPerSec
  const b = H.freshInputs({ node: bn, sf: ef.live.sfOnEntry, profile: e2.profile, g: 0.05 }).expPerSec
  c.examined++
  if (!(Math.abs(Math.log(b / a) - (want - base.mean)) < 1e-6)) c.fails.push(`BN${bn} final-window exp/s moved by ln ${Math.log(b / a)} vs the level's ${want - base.mean}`)
  // a reading from another run of the node (a finished BN14.1 later) is not applied twice
  const stale = { ...reading, key: `xr${bn}|2000-01-01T00:00:00Z|old` }
  const e3 = await E.measureEconomy({ rates: 'fit', inRun: [stale] })
  c.examined++
  if (e3.rates.channels.exp.nodes[bn].readings.some((r) => r.inRun)) c.fails.push(`a reading keyed to another run of BN${bn} was applied to the run in progress`)
  c.notes.push(`BN${bn} in progress: a reading ln ${y.toFixed(2)} (sd 0.5) moves its exp level ${base.prior.mean.toFixed(2)} +- ${base.prior.sd.toFixed(2)} -> ${post.mean.toFixed(2)} +- ${post.sd.toFixed(2)} (precision-weighted), the final-window exp/s x${(b / a).toFixed(2)}; no other node's slice moves; another run's reading is not applied`)
}
done()
