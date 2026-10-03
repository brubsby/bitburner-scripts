// GP4 (the game-source half): go.mjs's transcriptions against the game's own
// functions, run on the tools/sim bundle (bitburner-src, esbuild) in a child
// process. Prints one JSON line { examined, notes, fails } | { skip }.
//
// CALIBRATION: a test harness, not a model. It checks that the formulas the
// IPvGO model rests on ARE the game's (effect, getMaxRep, the favor award per
// even-streak win and its cap, favor <-> rep, BN14's multipliers); it says
// nothing about the MEASURED inputs (go.mjs header) or the ASSUMED ones.
//
//   node tools/sim/gameplan/gotest.mjs

import '../env.mjs' // the DOM shim, synchronous, before the bundle (CLAUDE.md load-order traps)
import { effectAt } from '../../../goplan.js'
import { favorToRep, repToFavor, goFavorStreamOf } from '../../../favor.js'
import { goMaxRep, goScale, w0rldDiv, favorLife, BONUS_POWER } from './go.mjs'

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
const near = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b))
const check = (ok, what) => {
  out.examined++
  if (!ok) out.fails.push(what)
}

try {
  const P = new g.PlayerObject()
  g.setPlayer(P)
  g.initSourceFiles?.()
  const setNode = (n) => g.replaceCurrentNodeMults(g.getBitNodeMultipliers(n, 1))
  const setSf14 = (l) => {
    P.sourceFiles = new Map(l ? [[14, l]] : [])
  }

  // (1) BN14's multipliers, the ones the model reads (BitNode.tsx:1040-1083)
  const m14 = g.getBitNodeMultipliers(14, 1)
  const WANT = { GoPower: 4, FactionWorkRepGain: 0.2, HackingLevelMultiplier: 0.4, HackingSpeedMultiplier: 0.3, AugmentationMoneyCost: 1.5, WorldDaemonDifficulty: 5, StrengthLevelMultiplier: 0.5, CrimeSuccessRate: 0.4, FavorToDonateToFaction: 1, BladeburnerRank: 0.6 }
  for (const [k, v] of Object.entries(WANT)) check(m14[k] === v, `BN14 ${k} ${m14[k]} (model reads ${v})`)
  const other = [...Array(13)].map((_, i) => g.getBitNodeMultipliers(i + 1, 1).GoPower)
  check(other.every((x) => x === 1), `GoPower outside BN14 is ${other.join(',')} (the model's scale assumes 1)`)
  out.notes.push(`(1) BN14 multipliers as the model reads them: ${Object.entries(WANT).map(([k, v]) => `${k} ${v}`).join(', ')}; GoPower 1 in BN1-13`)

  // (2) CalculateEffect == effectAt at GoPower x the SF14 doubling (Daedalus, w0r1d_d43m0n)
  let worst = 0
  for (const node of [1, 14])
    for (const l of [0, 1, 2, 3])
      for (const n of [0, 10, 500, 4391, 9465, 70000])
        for (const [opp, bp] of [[g.GoOpponent.Daedalus, BONUS_POWER.Daedalus], [g.GoOpponent.w0r1d_d43m0n, BONUS_POWER.w0r1d_d43m0n]]) {
          setNode(node)
          setSf14(l)
          const game = g.CalculateEffect(n, opp)
          const mine = effectAt(n, bp, goScale(g.currentNodeMults.GoPower, l), 0)
          worst = Math.max(worst, Math.abs(game - mine))
          check(near(game, mine, 1e-12), `effect BN${node} SF14.${l} ${opp} n=${n}: game ${game} vs model ${mine}`)
        }
  out.notes.push(`(2) Go/effects/effect.ts CalculateEffect vs goplan.effectAt at scale GoPower x (SF14?2:1): BN1/BN14 x SF14 0-3 x 6 node powers x Daedalus/w0r1d_d43m0n, worst |diff| ${worst.toExponential(1)} — the SF14 doubling is exactly x2 on (effect - 1), BN14 x4`)
  setNode(14)
  setSf14(0)
  const w = w0rldDiv(4, 200)
  check(near(w, g.CalculateEffect(200, g.GoOpponent.w0r1d_d43m0n)), `w0rldDiv(4, 200) ${w} vs the game's ${g.CalculateEffect(200, g.GoOpponent.w0r1d_d43m0n)}`)

  // (3) getMaxRep by SF14 level
  for (const l of [0, 1, 2, 3]) {
    setSf14(l)
    check(g.getMaxRep() === goMaxRep(l), `getMaxRep at SF14.${l}: game ${g.getMaxRep()} vs model ${goMaxRep(l)}`)
  }
  out.notes.push(`(3) getMaxRep (effect.ts:30-43) at SF14 0/1/2/3: ${[0, 1, 2, 3].map((l) => goMaxRep(l) / 1e3 + 'k').join(' / ')} rep-equivalent — favor cap ${[0, 1, 2, 3].map((l) => repToFavor(goMaxRep(l)).toFixed(1)).join(' / ')} (donations need 150)`)

  // (4) favor <-> rep: favor.js vs Faction/formulas/favor.ts
  let wf = 0
  for (const f of [0, 1, 50, 81.3, 111, 150, 300]) {
    wf = Math.max(wf, Math.abs(favorToRep(f) - g.favorToRep(f)) / Math.max(1, g.favorToRep(f)))
    check(near(favorToRep(f), g.favorToRep(f), 1e-12), `favorToRep(${f})`)
    check(near(repToFavor(favorToRep(f)), g.repToFavor(g.favorToRep(f)), 1e-12), `repToFavor at favor ${f}`)
  }
  out.notes.push(`(4) favorToRep / repToFavor (Faction/formulas/favor.ts) vs favor.js: worst relative ${wf.toExponential(1)}; favorToRep(150) = ${Math.round(g.favorToRep(150))}`)

  // (5) the favor award, PLAYED through the game's endGoGame: every second win of
  // a streak gives getMaxRep()/200 to the faction's favor, a loss resets the
  // streak, nothing past getMaxRep() — and the stream model's per-game rate p^2/(1+p).
  const board = (color) => {
    const b = g.getNewBoardState(5, 'Daedalus', false)
    for (const row of b.board) for (const pt of row) if (pt) pt.color = color === 'black' ? g.GoColor.black : g.GoColor.white
    return b
  }
  const playSeq = (l, seq, startRep = 0) => {
    setSf14(l)
    g.Go.stats = {}
    const st = g.getOpponentStats('Daedalus')
    st.rep = startRep
    P.factions = ['Daedalus']
    const F = g.Factions['Daedalus']
    F.setFavor(0)
    for (const won of seq) g.endGoGame(board(won ? 'black' : 'white'))
    return { favor: F.favor, rep: st.rep }
  }
  const SEQ = [1, 1, 1, 1, 0, 1, 1, 1, 0, 1].map(Boolean) // even-streak wins: after games 2, 4, 7 (streak 2) -> 3 awards
  for (const l of [0, 1, 2, 3]) {
    const r = playSeq(l, SEQ)
    const want = 3 * (goMaxRep(l) / 200)
    check(near(r.rep, want, 1e-12), `SF14.${l}: endGoGame banked ${r.rep} Go rep for 3 even-streak wins, model ${want}`)
    check(near(r.favor, repToFavor(want), 1e-9), `SF14.${l}: faction favor ${r.favor} vs repToFavor(${want}) ${repToFavor(want)}`)
  }
  const capped = playSeq(0, [true, true, true, true], goMaxRep(0) - 1)
  check(capped.rep === goMaxRep(0) - 1 + goMaxRep(0) / 200, `cap: one award at rep cap-1 then none: ${capped.rep}`)
  out.notes.push(`(5) endGoGame (scoring.ts:46-89) played on whole-board wins/losses, SF14 0-3: 3 awards of getMaxRep/200 for the sequence WWWW L WWW L W, favor = repToFavor(awarded); at the cap one award lands and the next is refused`)
  // the stream model's rate against a long played Bernoulli sequence
  {
    let s = 7
    const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
    const p = 0.85
    const N = 4000
    const seq = Array.from({ length: N }, () => rnd() < p)
    const r = playSeq(3, seq, -1e12) // the cap far away: count every award
    const awards = (r.rep + 1e12) / (goMaxRep(3) / 200)
    const model = goFavorStreamOf({ gamesPerHour: N, pWin: p, sf14: 3, banked: 0 }).repPerH / (goMaxRep(3) / 200)
    check(Math.abs(awards - model) / model < 0.05, `favor awards over ${N} played games at p ${p}: ${awards} vs the stream model's ${model.toFixed(0)}`)
    out.notes.push(`(5b) ${N} games at p=${p} through endGoGame: ${awards} awards vs the stream model p^2/(1+p) x N = ${model.toFixed(0)} (${((100 * (awards - model)) / model).toFixed(1)}%)`)
  }

  // (6) the favor life: Go's share, the SF14 ordering, BN8 at favor 0
  const p = { lvl14: 4700, rep14: 97, goP: 1 }
  const L = (n, l) => favorLife({ ftd: g.getBitNodeMultipliers(n, 1).FavorToDonateToFaction, fwrg: g.getBitNodeMultipliers(n, 1).FactionWorkRepGain, sf14: l, scale: goScale(g.getBitNodeMultipliers(n, 1).GoPower, l), level: p.lvl14 + 45, repPerLevelH: p.rep14, abar: 0.2, powerScale: 1 })
  const l14 = [0, 1, 2, 3].map((l) => L(14, l))
  check(l14.every((x, i) => i === 0 || x.hours < l14[i - 1].hours), `BN14 favor life not shortened by every SF14 level: ${l14.map((x) => x.hours.toFixed(2)).join(', ')}`)
  check(L(8, 0).hours === 0, 'BN8 (FavorToDonateToFaction 0) needs no favor life')
  check(near(l14[0].need, g.favorToRep(150), 1e-12), `the favor life's target ${l14[0].need} vs favorToRep(150)`)
  out.notes.push(`(6) favor life at level 4700, 97 rep/h/level: BN14 SF14 0/1/2/3 ${l14.map((x) => x.hours.toFixed(2) + 'h').join(' / ')} (Go rep ${l14.map((x) => Math.round(x.goRep / 1e3) + 'k').join('/')}); BN1 ${L(1, 0).hours.toFixed(2)}h; BN8 0h`)
} catch (err) {
  out.fails.push(`threw: ${String(err?.stack ?? err).slice(0, 600)}`)
}
done()
