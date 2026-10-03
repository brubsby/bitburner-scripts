// The game-dependent half of tools/test/gameplan-sleeves.test.mjs, in child processes.
// Prints one JSON line { examined, notes, fails } | { skip }.
//
//   node tools/sim/gameplan/sleevetest.mjs count      SL1 (the tools/sim bundle): sleeves.mjs's count
//        rule and the Covenant's price against the game's recalculateNumberOfOwnedSleeves /
//        getSleeveCost, and sleeveplan.js's copies of them
//   node tools/sim/gameplan/sleevetest.mjs surrogate  SL2 + SL3 (the nodechoice bundle, the
//        surrogate cache, the telemetry): 5 sleeves reproduce the old surrogate and the old plan;
//        the value is monotone in sleeves on both routes
//
// CALIBRATION: a test harness, not a model. SL1 checks a transcription against the game's
// code; SL2 is a regression (the fleet axis must not move a 5-sleeve clear); SL3 a property.

const MODE = process.argv[2]
const out = { examined: 0, notes: [], fails: [] }
const done = () => {
  console.log(JSON.stringify(out))
  process.exit(0)
}
const skip = (why) => {
  console.log(JSON.stringify({ skip: String(why).slice(0, 400) }))
  process.exit(0)
}
const check = (ok, what) => {
  out.examined++
  if (!ok) out.fails.push(what)
}

if (MODE === 'count') {
  await import('../env.mjs') // the DOM shim, synchronous, before the bundle
  let g
  try {
    g = await import('../game.bundle.mjs')
  } catch (err) {
    skip(`tools/sim bundle unavailable: ${err?.message ?? err}`)
  }
  if (!g.recalculateNumberOfOwnedSleeves || !g.getSleeveCost) skip('the tools/sim bundle predates the sleeve exports (build.mjs ENTRY): rebuild with node tools/sim/build.mjs --game ~/Repos/bitburner')
  const { sleeveCount, extraSleeves, COVENANT_MAX, covenantCost, BASE_SLEEVES } = await import('./sleeves.mjs')
  await import('../../test/gameresolve.mjs')
  const sp = await import('sleeveplan.js')
  g.initSourceFiles?.()
  let n = 0
  const bad = []
  for (const bn of [1, 6, 10, 11])
    for (let sf10 = 0; sf10 <= 3; sf10++)
      for (let cov = 0; cov <= g.MaxSleevesFromCovenant; cov++) {
        const P = new g.PlayerObject()
        g.setPlayer(P)
        P.bitNodeN = bn
        P.sourceFiles = new Map(sf10 ? [[10, sf10]] : [])
        P.sleevesFromCovenant = cov
        P.sleeves = []
        g.recalculateNumberOfOwnedSleeves()
        const game = P.sleeves.length
        const ours = sleeveCount(sf10, bn, cov)
        n++
        if (game !== ours) bad.push(`BN${bn} SF10.${sf10} covenant ${cov}: game ${game}, sleeves.mjs ${ours}`)
        // sleeveplan.sleevesFromCovenant inverts the same rule (the live fleet's Covenant count)
        if (sf10 > 0 && sp.sleevesFromCovenant(game, sf10, bn) !== cov) bad.push(`sleeveplan.sleevesFromCovenant(${game}, ${sf10}, ${bn}) = ${sp.sleevesFromCovenant(game, sf10, bn)}, not ${cov}`)
      }
  check(!bad.length, `the sleeve count differs from the game's recalculateNumberOfOwnedSleeves: ${bad.slice(0, 4).join('; ')}`)
  out.examined += n - 1
  out.notes.push(`count rule: ${n} (BN, SF10, Covenant) cases vs the game's recalculateNumberOfOwnedSleeves: ${bad.length ? bad.length + ' differ' : 'all equal'}; today's 5 = SF10.1 + 4; SF10.2 ${sleeveCount(2, 1)}, SF10.3 ${sleeveCount(3, 1)}, BN10 at SF10.1 ${sleeveCount(1, 10)}, at SF10.2 ${sleeveCount(2, 10)}`)
  check(extraSleeves(1, 1) === 0 && extraSleeves(2, 1) === 1 && extraSleeves(3, 1) === 2 && extraSleeves(1, 10) === 1 && extraSleeves(2, 10) === 2 && BASE_SLEEVES === 5, 'extraSleeves: SF10.1/.2/.3 outside BN10 must be 0/1/2 and inside BN10 at SF10.1/.2 1/2')
  check(g.MaxSleevesFromCovenant === COVENANT_MAX && sp.COVENANT.maxSleeves === COVENANT_MAX, `the Covenant cap: game ${g.MaxSleevesFromCovenant}, sleeves.mjs ${COVENANT_MAX}, sleeveplan ${sp.COVENANT.maxSleeves}`)
  for (let k = 0; k < COVENANT_MAX; k++) check(g.getSleeveCost(k) === covenantCost(k) && sp.covenantSleeveCost(k) === covenantCost(k), `getSleeveCost(${k}): game ${g.getSleeveCost(k)}, sleeves.mjs ${covenantCost(k)}, sleeveplan ${sp.covenantSleeveCost(k)}`)
  out.notes.push(`the 5th Covenant sleeve: game getSleeveCost(4) = $${g.getSleeveCost(4).toExponential(1)}`)
  done()
}

if (MODE === 'surrogate') {
  await import('../../test/gameresolve.mjs')
  const { makeState, lattice, lvl, owed } = await import('./state.mjs')
  const { worldOf } = await import('./params.mjs')
  const { clearTime } = await import('./routes.mjs')
  const { sleevesOf } = await import('./effects.mjs')
  let econ, S, sur, bp
  // the plan's entry state today (BN14.1 in progress -> its clear owed after; any state with SF10.1 does)
  const S0 = makeState([[1, 3], [2, 1], [4, 3], [5, 1], [6, 1], [8, 1], [9, 1], [10, 1], [14, 1]], 133)
  try {
    sur = await import('./surrogate.mjs')
    const { measureEconomy } = await import('./economy.mjs')
    const e = await measureEconomy()
    econ = { ...e, ownG: new Map(e.ownG) }
    S = await sur.loadSurrogate({ start: S0, profile: econ.profile, bbSeeds: 5 })
    bp = await import('bbplan.js')
  } catch (err) {
    skip(`inputs unavailable: ${err?.message ?? err}`)
  }
  // SL2 (a): bbLeg at 5 sleeves (and the default) IS the old grid: the 5-infiltrator median, recomputed
  // from the cache with the old key scheme (bbSpec without a fleet), cell by cell
  const fs = await import('node:fs')
  const path = await import('node:path')
  const bb = JSON.parse(fs.readFileSync(path.join(sur.CACHE_DIR, 'bb.json'), 'utf8'))
  const med = (xs) => {
    const v = [...xs].sort((a, b) => a - b)
    const m = Math.floor(v.length / 2)
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
  }
  let cells = 0
  const diff = []
  for (const n of sur.bbNodes())
    for (const l6 of sur.L6)
      for (const l7 of sur.L7) {
        const ls = Array.from({ length: 5 }, (_, i) => bb[sur.bbKeyOf(sur.bbSpec(n, l6, l7, i + 1, bp.POLICY))]).map((r) => (r?.hours ? r.hours - (r.joinH ?? 0) : null)).filter((x) => x !== null)
        const old = ls.length > 2.5 ? med(ls) : null
        const a = S.bbLeg(n, l6, l7)?.median ?? null
        const b = S.bbLeg(n, l6, l7, 5)?.median ?? null
        const r5 = S.bbFleetRatio(n, l6, l7, 5)?.ratio
        cells++
        if (a !== old || b !== old || r5 !== 1) diff.push(`BN${n} SF6.${l6} SF7.${l7}: old ${old}, bbLeg ${a}, bbLeg(5) ${b}, ratio(5) ${r5}`)
      }
  check(!diff.length, `5 sleeves does not reproduce the old Bladeburner grid: ${diff.slice(0, 4).join('; ')}`)
  out.examined += cells - 1
  out.notes.push(`(SL2) the 5-sleeve Bladeburner leg vs the old grid recomputed from the cache: ${cells} cells, ${diff.length ? diff.length + ' differ' : 'all identical'}`)
  // SL2 (b): the plan at 5 sleeves is the old plan — every clear of a state whose fleet is 5
  // (SF10.1, outside BN10) prices the same as with the fleet pinned at 5, and a world with the
  // fleet pinned prices every clear as if SF10 were 1 (the pre-fleet Bladeburner route)
  const mid = worldOf(econ, {}, { sigmaPlayed: 0 })
  const five = worldOf(econ, {}, { sigmaPlayed: 0, fleet: 'five' })
  const L = lattice(S0)
  const lv0 = (n) => lvl(S0, n)
  let same = 0
  const moved = []
  for (const n of [...new Set(owed(S0))]) {
    const a = clearTime(n, lv0, mid, S)
    const b = clearTime(n, lv0, five, S)
    out.examined++
    if (n !== 10) {
      if (Math.abs(a.h - b.h) > 1e-9) moved.push(`BN${n}: ${a.h.toFixed(3)}h live vs ${b.h.toFixed(3)}h five`)
      else same++
    }
  }
  check(!moved.length, `at SF10.1 (5 sleeves) a clear outside BN10 moved with the fleet axis: ${moved.join('; ')}`)
  out.notes.push(`(SL2) at SF10.1 every clear outside BN10 prices identically live and with the fleet pinned at 5 (${same} clears); BN10's own (6 sleeves) is the one that moves`)
  // SL3: monotone in sleeves — the leg at 5 >= 6 >= 7 in every cell; the raw ratio (before the
  // "an extra sleeve may idle" floor) printed; every clear's hours nonincreasing in SF10 level
  let floored = 0
  let worstRaw = 0
  let nonMono = []
  let mcells = 0
  for (const n of sur.bbNodes())
    for (const l6 of sur.L6)
      for (const l7 of sur.L7) {
        const legs = sur.BB_FLEET_N.map((k) => S.bbLeg(n, l6, l7, k)?.median ?? null)
        mcells++
        out.examined++
        for (let i = 1; i < legs.length; i++) if (legs[i - 1] !== null && legs[i] !== null && legs[i] > legs[i - 1] + 1e-9) nonMono.push(`BN${n} SF6.${l6} SF7.${l7}: ${legs.map((x) => x?.toFixed(2)).join(' > ')}`)
        for (const k of sur.BB_FLEET_N.slice(1)) {
          const r = S.bbFleetRatio(n, l6, l7, k)
          if (r && r.raw !== null && r.raw > r.ratio + 1e-12) {
            floored++
            worstRaw = Math.max(worstRaw, r.raw - r.ratio)
          }
        }
      }
  check(!nonMono.length, `the Bladeburner leg grows with a sleeve: ${nonMono.slice(0, 4).join('; ')}`)
  out.notes.push(`(SL3) Bladeburner leg 5 >= 6 >= 7 sleeves in all ${mcells} cells; the "extra sleeve may idle" floor bound ${floored} of ${mcells * 2} (cell, size) ratios (raw ratio up to +${(worstRaw * 100).toFixed(1)}% over the floor: seed noise on a sleeve the live pick could not use)`)
  const up = []
  for (const n of [...new Set(owed(S0))]) {
    const hs = [1, 2, 3].map((l) => clearTime(n, (m) => (m === 10 ? l : lvl(S0, m)), mid, S))
    out.examined++
    for (let i = 1; i < 3; i++) if (hs[i].h > hs[i - 1].h + 1e-9) up.push(`BN${n} SF10.${i} ${hs[i - 1].h.toFixed(3)}h -> SF10.${i + 1} ${hs[i].h.toFixed(3)}h`)
    if (n === 10) out.notes.push(`(SL3) BN10's own clear at SF10.1/.2/.3: ${hs.map((x) => `${x.h.toFixed(2)}h ${x.via} (${sleevesOf((m) => (m === 10 ? hs.indexOf(x) + 1 : lvl(S0, m)), 10)} sleeves)`).join(', ')}`)
  }
  check(!up.length, `a clear gets longer with more SF10 (more sleeves): ${up.join('; ')}`)
  out.notes.push(`(SL3) every owed clear's hours nonincreasing in SF10 level (mid world): ${up.length ? up.length + ' violations' : 'yes'}`)
  done()
}

skip(`usage: sleevetest.mjs count|surrogate (got ${MODE})`)
