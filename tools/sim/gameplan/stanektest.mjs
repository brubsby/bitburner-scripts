// ST1 (the game-source half): stanekplan.js's transcriptions against the game's own
// Stanek classes, run on the tools/sim bundle in a child process. Prints one JSON
// line { examined, notes, fails } | { skip }.
//
// CALIBRATION: a test harness, not a model. It checks that what the Stanek model
// rests on IS the game's — the fragment catalogue, the shapes' geometry, the grid
// size per node and SF13 level, CalculateEffect, StaneksGift.charge and its Church
// rep, the boost, calculateMults, and that the optimiser's layouts are placeable in
// a real gift. It says nothing about the MEASURED or ASSUMED inputs (stanekplan.js
// header).
//
//   node tools/sim/gameplan/stanektest.mjs

import '../env.mjs' // the DOM shim, synchronous, before the bundle
import * as sp from '../../../stanekplan.js'

const out = { examined: 0, notes: [], fails: [] }
const done = () => {
  console.log(JSON.stringify(out))
  process.exit(0)
}
let g
try {
  g = await import('../game.bundle.mjs')
  g.FormatsNeedToChange?.emit?.()
} catch (err) {
  console.log(JSON.stringify({ skip: `tools/sim bundle unavailable: ${String(err?.message ?? err).slice(0, 300)}` }))
  process.exit(0)
}
if (!g.StaneksGift || !g.Fragments || !g.StanekCalculateEffect) {
  console.log(JSON.stringify({ skip: 'the tools/sim bundle predates the Stanek exports (build.mjs ENTRY): rebuild with node tools/sim/build.mjs --game ~/Repos/bitburner' }))
  process.exit(0)
}
const near = (a, b, rel = 1e-12) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b))
const check = (ok, what) => {
  out.examined++
  if (!ok) out.fails.push(what)
}

try {
  const P = new g.PlayerObject()
  g.setPlayer(P)
  g.initSourceFiles?.()
  const setNode = (n, lvl = 1) => {
    const m = g.getBitNodeMultipliers(n, lvl)
    g.replaceCurrentNodeMults(m)
    P.bitNodeN = n
    return m
  }
  const setSf13 = (l) => {
    P.sourceFiles = new Map(l ? [[13, l]] : [])
  }

  // (1) the catalogue
  const game = g.Fragments
  check(game.length === sp.FRAGMENTS.length, `fragment count: game ${game.length}, model ${sp.FRAGMENTS.length}`)
  for (const f of game) {
    const m = sp.fragmentById(f.id)
    check(!!m, `fragment ${f.id} missing from the model`)
    if (!m) continue
    check(JSON.stringify(m.shape) === JSON.stringify(f.shape), `fragment ${f.id} shape`)
    check(m.type === f.type && m.power === f.power && m.limit === f.limit, `fragment ${f.id} type/power/limit: game ${f.type}/${f.power}/${f.limit}, model ${m.type}/${m.power}/${m.limit}`)
  }
  out.notes.push(`(1) the catalogue (CotMG/Fragment.ts): ${game.length} fragments, ids/shapes/types/power/limits identical — ${sp.FRAGMENTS.filter((f) => f.type !== sp.TYPE.Booster).map((f) => `${sp.TYPE_NAME[f.type]}#${f.id} p${f.power}`).join(', ')}; 8 boosters x1.1`)

  // (2) geometry: fullAt and neighbors at every rotation
  let cells = 0
  for (const f of game)
    for (let rot = 0; rot < 4; rot++) {
      const mine = new Set(sp.cellsOf(f.shape, rot).map(([x, y]) => `${x},${y}`))
      for (let y = -1; y <= 4; y++)
        for (let x = -1; x <= 4; x++) {
          cells++
          check(f.fullAt(x, y, rot) === mine.has(`${x},${y}`), `fragment ${f.id} rot ${rot} fullAt(${x},${y})`)
        }
      const gn = new Set(f.neighbors(rot).map(([x, y]) => `${x},${y}`))
      const mn = new Set(sp.neighborsOf(f.shape, rot).map(([x, y]) => `${x},${y}`))
      check(gn.size === mn.size && [...gn].every((k) => mn.has(k)), `fragment ${f.id} rot ${rot} neighbors: game ${[...gn].join(' ')} model ${[...mn].join(' ')}`)
    }
  out.notes.push(`(2) Fragment.fullAt / neighbors at rotations 0-3: ${cells} cells and every neighbour set identical`)

  // (3) the grid per node and SF13 level
  const rows = []
  for (let n = 1; n <= 15; n++) {
    const m = setNode(n)
    const sizes = []
    for (let l = 0; l <= 3; l++) {
      setSf13(l)
      const gift = new g.StaneksGift()
      const mine = sp.giftSize(m.StaneksGiftExtraSize, l)
      check(gift.width() === mine.width && gift.height() === mine.height, `BN${n} SF13.${l}: game ${gift.width()}x${gift.height()} model ${mine.width}x${mine.height}`)
      sizes.push(`${gift.width()}x${gift.height()}`)
    }
    rows.push(`BN${n} (x${+m.StaneksGiftPowerMultiplier.toFixed(3)}, ${m.StaneksGiftExtraSize >= 0 ? '+' : ''}${+m.StaneksGiftExtraSize.toFixed(2)}) ${sizes.join('/')}`)
  }
  setSf13(0)
  out.notes.push(`(3) StaneksGift.width/height (StaneksGift.ts:20-32) per node (power, extra size) at SF13 0/1/2/3: ${rows.join('; ')}`)

  // (4) CalculateEffect under each node's StaneksGiftPowerMultiplier
  let worst = 0
  for (const n of [1, 2, 8, 12, 13, 14])
    for (const [h, k, p, b] of [[0, 0, 1, 1], [1, 1, 1, 1], [2048, 37, 1.3, 1.21], [1e6, 1200, 2, 1.1], [3.7e5, 0.5, 0.4, 1.331]]) {
      const m = setNode(n)
      const a = g.StanekCalculateEffect(h, k, p, b)
      const mine = sp.calculateEffect(h, k, p, b, m.StaneksGiftPowerMultiplier)
      worst = Math.max(worst, Math.abs(a - mine))
      check(near(a, mine), `CalculateEffect BN${n} (${h}, ${k}, ${p}, ${b}): game ${a} model ${mine}`)
    }
  out.notes.push(`(4) CotMG/formulas/effect.ts CalculateEffect: BN1/2/8/12/13/14 x 5 charge states, worst |diff| ${worst.toExponential(1)}`)

  // (5) charge: highestCharge / numCharge and the Church's rep (StaneksGift.ts:34-46)
  setNode(13)
  const church = g.Factions["Church of the Machine God"]
  church.setFavor(37)
  P.mults.faction_rep = 1.7
  const gift = new g.StaneksGift()
  const af = new g.ActiveFragment({ x: 0, y: 0, rotation: 0, fragment: g.FragmentById(0) })
  const mine = { highestCharge: 0, numCharge: 0 }
  let sum = 0
  for (const t of [100, 100, 50, 400, 400, 10, 4000.5]) {
    const before = church.playerReputation
    gift.charge(af, t)
    sp.chargeOnce(mine, t)
    sum += t
    check(near(af.highestCharge, mine.highestCharge) && near(af.numCharge, mine.numCharge, 1e-12), `charge ${t}: game ${af.highestCharge}/${af.numCharge} model ${mine.highestCharge}/${mine.numCharge}`)
    check(near(church.playerReputation - before, sp.chargeRep(t, 1.7, 37), 1e-9), `Church rep of a ${t}-thread charge: game ${church.playerReputation - before} model ${sp.chargeRep(t, 1.7, 37)}`)
  }
  check(near(af.numCharge * af.highestCharge, sum, 1e-12), `the invariant numCharge x highestCharge = sum of threads: ${af.numCharge * af.highestCharge} vs ${sum}`)
  out.notes.push(`(5) StaneksGift.charge over threads 100,100,50,400,400,10,4000.5: highest/num ${af.highestCharge}/${af.numCharge.toFixed(4)} identical; numCharge x highestCharge = sum of threads (${sum}) — the round-robin model's numCharge; Church rep per charge = faction_rep x t^0.95 x (favor+100)/1000 identical`)

  // (6) the optimiser's layouts in a real gift: placeable, the boost, the effect, calculateMults
  const weights = sp.hackWeights({ Hg: 2.5, epsM: 0.09, epsR: 0.12 })
  const keys = ['hacking', 'hacking_exp', 'hacking_speed', 'hacking_money', 'hacking_grow', 'faction_rep']
  const placedNotes = []
  for (const [n, l] of [[2, 1], [10, 1], [1, 0], [13, 0], [5, 1]]) {
    const m = setNode(n)
    setSf13(l)
    const real = new g.StaneksGift()
    const lay = sp.optimiseLayout({ width: real.width(), height: real.height(), weights, c: 0.3, nodePower: m.StaneksGiftPowerMultiplier, budget: 2e5 })
    let ok = true
    for (const p of lay.placed) ok = real.place(p.x, p.y, p.rot, g.FragmentById(p.id)) && ok
    check(ok, `BN${n} SF13.${l}: the optimiser's layout is not placeable in the game's gift`)
    const charge = { highestCharge: 123456, numCharge: 789 }
    for (const a of real.fragments) Object.assign(a, charge)
    const b = sp.boostsOf(lay.placed)
    lay.placed.forEach((p, i) => {
      const f = sp.fragmentById(p.id)
      if (f.type === sp.TYPE.Booster) return
      const a = real.fragments[i]
      check(near(real.effect(a), sp.calculateEffect(charge.highestCharge, charge.numCharge, f.power, b[i], m.StaneksGiftPowerMultiplier)), `BN${n} layout fragment ${p.id}: game effect ${real.effect(a)} vs model (boost ${b[i]})`)
    })
    const gm = real.calculateMults()
    const mm = sp.layoutMults(lay.placed, charge, m.StaneksGiftPowerMultiplier)
    for (const k of keys) check(near(gm[k], mm[k]), `BN${n} calculateMults ${k}: game ${gm[k]} model ${mm[k]}`)
    const cl = sp.compileLayout(lay.placed)
    const fast = sp.multsAt(cl, sp.chargeFactor(charge.highestCharge, charge.numCharge), m.StaneksGiftPowerMultiplier)
    for (const k of keys) check(near(fast[k], gm[k], 1e-12), `BN${n} multsAt ${k}: game ${gm[k]} fast path ${fast[k]}`)
    placedNotes.push(`BN${n} SF13.${l} ${real.width()}x${real.height()}: ${lay.placed.length} placed, boosts ${b.filter((x, i) => sp.fragmentById(lay.placed[i].id).type !== sp.TYPE.Booster).map((x) => x.toFixed(2)).join('/')}, hacking x${gm.hacking.toFixed(3)}`)
  }
  out.notes.push(`(6) optimiser layouts placed with StaneksGift.place, every effect (boost included) and calculateMults (the six keys the model reads; multsAt's fast path too) identical: ${placedNotes.join('; ')}`)

  // (7) the penalty augmentations (Augmentations.ts:1593-1705)
  const aug = (name) => g.Augmentations[name]
  const a1 = aug("Stanek's Gift - Genesis")
  const a2 = aug("Stanek's Gift - Awakening")
  const a3 = aug("Stanek's Gift - Serenity")
  check(near(a1.mults.hacking, sp.PENALTY[1]) && near(a1.mults.faction_rep, sp.PENALTY[1]), `Genesis hacking/faction_rep ${a1.mults.hacking}/${a1.mults.faction_rep} vs ${sp.PENALTY[1]}`)
  check(near(a1.mults.hacking * a2.mults.hacking, sp.PENALTY[2]), `Genesis x Awakening ${a1.mults.hacking * a2.mults.hacking} vs ${sp.PENALTY[2]}`)
  check(near(a1.mults.hacking * a2.mults.hacking * a3.mults.hacking, sp.PENALTY[3]), `x Serenity ${a1.mults.hacking * a2.mults.hacking * a3.mults.hacking} vs 1`)
  check(a2.baseRepRequirement === sp.STANEK.repAwakening && a3.baseRepRequirement === sp.STANEK.repSerenity, `Awakening/Serenity rep ${a2.baseRepRequirement}/${a3.baseRepRequirement}`)
  check(a2.baseCost === 0 && a3.baseCost === 0, `Awakening/Serenity cost money: ${a2.baseCost}/${a3.baseCost}`)
  const pen = ['hacking_chance', 'hacking_speed', 'hacking_money', 'hacking_grow', 'hacking', 'hacking_exp', 'faction_rep'].filter((k) => !near(a1.mults[k], 0.9))
  check(pen.length === 0, `Genesis is not x0.9 on ${pen.join(', ')}`)
  out.notes.push(`(7) Genesis x${a1.mults.hacking} on hacking/chance/speed/money/grow/exp/faction_rep; Awakening -> x${(a1.mults.hacking * a2.mults.hacking).toFixed(3)} at ${a2.baseRepRequirement / 1e6}m rep; Serenity -> x${(a1.mults.hacking * a2.mults.hacking * a3.mults.hacking).toFixed(3)} at ${a3.baseRepRequirement / 1e6}m rep; both $0`)

  // (8) the charging script's RAM
  const ram = g.RamCostConstants
  check(near(ram.Base + ram.StanekCharge, sp.STANEK.ramPerThread), `charging thread RAM ${ram.Base} + ${ram.StanekCharge} vs ${sp.STANEK.ramPerThread}`)
  check(near(g.getCoreBonus(8), sp.coreBonus(8)), `getCoreBonus(8) ${g.getCoreBonus(8)} vs ${sp.coreBonus(8)}`)
  out.notes.push(`(8) a charging thread is ${ram.Base} + ${ram.StanekCharge} = ${sp.STANEK.ramPerThread}GB (RamCostGenerator.ts); getCoreBonus(8) = ${g.getCoreBonus(8)}`)
} catch (err) {
  out.fails.push(`threw: ${String(err?.stack ?? err).slice(0, 600)}`)
}
done()
