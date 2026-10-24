// B81/B82's game half (tools/test/bn8cal.test.mjs): bn8.mjs on the game's catalogue (tools/sim nodechoice
// bundle), run in a child process. Prints one JSON line { examined, notes, fails } | { skip }.
//
//   node tools/sim/gameplan/bn8test.mjs
//
// B81 THE BN8.1 REPLAY on the frozen lives (tools/test/fixture-bn8-lives.json): every milestone (30 installed,
//     hacking 2500, Daedalus, The Red Pill, the exit) within bn8.MS_TOL of the measured; the exp model and the
//     trader factor re-fitted on the fixture reproduce the committed BN8_CAL / traderw.RW_BN8.
// B82 THE FORECAST from the plan's BN8.2 state: finite, inside a sane band, monotone in the trader's factor,
//     the gift priced both ways; the route's memo returns the same answer.

const out = { examined: 0, notes: [], fails: [] }
const fail = (m) => out.fails.push(m)
const note = (m) => out.notes.push(m)
let B
try {
  B = await import('./bn8.mjs')
} catch (err) {
  console.log(JSON.stringify({ skip: `bn8.mjs did not load (game bundle?): ${String(err?.message ?? err).slice(0, 300)}` }))
  process.exit(0)
}
try {
  const b81 = await B.loadBn81({ fixture: true })
  // B81
  const ex = B.calibrateExp(b81)
  out.examined += ex.n
  note(`exp model refit: K0 ${ex.EXP_K0.toFixed(3)} (committed ${B.BN8_CAL.EXP_K0}), B ${ex.EXP_B.toFixed(3)} (committed ${B.BN8_CAL.EXP_B}), ${ex.n} segments, sd ${ex.sdLn.toFixed(2)} in ln`)
  if (Math.abs(ex.EXP_K0 / B.BN8_CAL.EXP_K0 - 1) > 0.05 || Math.abs(ex.EXP_B - B.BN8_CAL.EXP_B) > 0.02) fail(`BN8_CAL's exp model is not the fit on BN8.1: K0 ${ex.EXP_K0.toFixed(3)} vs ${B.BN8_CAL.EXP_K0}, B ${ex.EXP_B.toFixed(3)} vs ${B.BN8_CAL.EXP_B}`)
  const tr = B.calibrateTrader(b81)
  if (!tr) fail('the trader endpoints are not in the fixture')
  else {
    out.examined += 2
    note(`trader factor refit: kappa ${tr.KAPPA8.toFixed(3)} (committed ${B.BN8_CAL.KAPPA8}), rho ${tr.RHO8.toFixed(3)} (committed ${B.BN8_CAL.RHO8}); E1 $${tr.e1.cash.toExponential(2)} in ${tr.e1.len}h on ${tr.e1.home}GB, E2 $${tr.e2.cash.toExponential(2)} in ${tr.e2.len}h on ${tr.e2.home}GB`)
    if (Math.abs(tr.KAPPA8 / B.BN8_CAL.KAPPA8 - 1) > 0.03 || Math.abs(tr.RHO8 - B.BN8_CAL.RHO8) > 0.01) fail(`traderw.RW_BN8 is not the fit on BN8.1's endpoints: kappa ${tr.KAPPA8.toFixed(3)} vs ${B.BN8_CAL.KAPPA8}, rho ${tr.RHO8.toFixed(3)} vs ${B.BN8_CAL.RHO8}`)
    // the endpoints reproduce through the committed curve
    for (const [e, reg] of [[tr.e1, 'pre-long'], [tr.e2, '4S-long']]) {
      const k = B.BN8_CAL.KAPPA8 * Math.pow(Math.min(B.KAPPA_HOME.max, e.home) / 256, B.BN8_CAL.RHO8)
      const W = B.bookAfter(B.START_MONEY, e.len, k, reg)
      if (Math.abs(Math.log(W / e.cash)) > 0.05) fail(`endpoint $${e.cash.toExponential(2)} (${e.home}GB) reads $${W.toExponential(2)} through the committed factor`)
    }
  }
  const rp = B.replay(b81, B.BN8_CAL)
  for (const k of ['thirty', 'hack2500', 'join', 'redPill', 'exit']) {
    out.examined++
    const ok = B.msWithin(rp.ms[k], rp.meas[k])
    note(`replay ${k}: measured ${rp.meas[k]?.toFixed(2)}h, model ${rp.ms[k]?.toFixed(2)}h ${ok ? 'PASS' : 'FAIL'}`)
    if (!ok) fail(`the BN8.1 replay's ${k} is outside tolerance: model ${rp.ms[k]?.toFixed(2)}h vs measured ${rp.meas[k]?.toFixed(2)}h (${100 * B.MS_TOL.rel}%, at least ${B.MS_TOL.absH}h)`)
  }
  // B82
  const sf = B.PLAN_STATES['BN8.2'].split(',').map((t) => t.split('.').map(Number))
  const b = B.bestPolicy({ sf, int: 156, level: 2 }, B.BN8_CAL)
  out.examined += 2
  const h = b.best?.hours
  note(`BN8.2 (${B.PLAN_STATES['BN8.2']}, int 156): ${h?.toFixed(1)}h (${b.best ? `${b.best.policy.lives} lives of ${b.best.policy.lifeH}h, gift ${b.best.gift ? 'accepted' : 'never'}` : '-'}); never ${b.byGift.never?.hours?.toFixed(1)}h, accept ${b.byGift.accept?.hours?.toFixed(1)}h`)
  if (!(h > 20 && h < 45)) fail(`BN8.2 priced ${h}h, outside the sane band 20-45h`)
  if (!b.byGift.never || !b.byGift.accept) fail('the gift is not priced both ways at SF13.3')
  const lo = B.bestPolicy({ sf, int: 156, level: 2 }, { ...B.BN8_CAL, KAPPA8: B.BN8_CAL.KAPPA8 * 0.8 }).best?.hours
  const hi = B.bestPolicy({ sf, int: 156, level: 2 }, { ...B.BN8_CAL, KAPPA8: B.BN8_CAL.KAPPA8 * 1.25 }).best?.hours
  out.examined += 2
  note(`trader factor x0.8 ${lo?.toFixed(1)}h, x1.25 ${hi?.toFixed(1)}h`)
  if (!(lo > h && h > hi)) fail(`BN8's hours are not monotone in the trader's factor: x0.8 ${lo}, x1 ${h}, x1.25 ${hi}`)
  const lvMap = new Map(sf)
  const r1 = B.bn8RouteHours((n) => lvMap.get(n) ?? 0, { int: 156 })
  const r2 = B.bn8RouteHours((n) => lvMap.get(n) ?? 0, { int: 156 })
  out.examined++
  if (r1 !== r2 || Math.abs(r1.hours - h) > 1e-9) fail(`bn8RouteHours is not the memoised bestPolicy: ${r1.hours} vs ${h}`)
  // B84's model half: the live accept table is bn8.mjs's own pricing
  const SP = await import('../../../stanekplan.js')
  const tab = B.giftTable()
  for (const [k, v] of Object.entries(tab)) {
    out.examined++
    const c = SP.STOCK_GIFT_PRICED[k]
    note(`gift table ${k}: bn8.mjs never ${v[0]}h / accept ${v[1]}h | stanekplan.STOCK_GIFT_PRICED ${c ? `${c[0]}h / ${c[1]}h` : 'none'}`)
    if (!c || Math.abs(c[0] - v[0]) > 0.5 || Math.abs(c[1] - v[1]) > 0.5 || Math.sign(c[1] - c[0]) !== Math.sign(v[1] - v[0])) fail(`stanekplan.STOCK_GIFT_PRICED['${k}'] is not bn8.mjs's pricing (${JSON.stringify(v)}): rerun bn8.mjs --gift-table`)
  }
} catch (err) {
  fail(`bn8test threw: ${String(err?.stack ?? err).slice(0, 500)}`)
}
console.log(JSON.stringify(out))
process.exit(0)
