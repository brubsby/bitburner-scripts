// THE IPvGO FARM IN THE WHOLE-GAME PLAN: what Go is worth to a clear, as a
// function of the node's GoPower and the Source-File 14 level.
//
// Pure (no game import): the formulas are the game's, transcribed with file and
// line, and tools/test/gameplan.test.mjs [GP4] runs each one against the game
// source itself (the tools/sim bundle: CalculateEffect, getMaxRep, endGoGame,
// favorToRep / repToFavor) — a transcription that drifts fails there.
//
// WHAT IS WHAT
//   SOURCE    effect(n) = 1 + ln(n+1) (n+1)^0.3 x 0.002 x bonusPower x GoPower
//               x (SF14 >= 1 ? 2 : 1)                    Go/effects/effect.ts:16-22
//             favor per even-streak win = getMaxRep()/200 rep-equivalent, while a
//               member, until getMaxRep() is given        Go/boardAnalysis/scoring.ts:66-78
//             getMaxRep() = 100k / 200k / 300k / 400k at SF14 0 / 1 / 2 / 3
//                                                       Go/effects/effect.ts:30-43
//             node power is zeroed by every install; the favor-rep is kept
//                                                       Go/Go.ts:25-47
//             rep -> favor: favor = ln(1 + r/25000)/ln 1.02 Faction/formulas/favor.ts
//             donations at favor >= 150 x FavorToDonateToFaction  donation.ts:16-18
//             faction work rep = (hacking + int/3)/975 x faction_rep x
//               (1 + favor/100) x FactionWorkRepGain per cycle   reputation.ts:8-24
//             w0r1d_d43m0n (bonusPower 2, hacking LEVEL) playable once The Red
//               Pill is installed, any node                netscriptGoImplementation.ts:359
//             BN14: GoPower 4, FactionWorkRepGain 0.2, HackingLevelMultiplier
//               0.4, HackingSpeedMultiplier 0.3, AugmentationMoneyCost 1.5,
//               WorldDaemonDifficulty 5, combat levels 0.5, CrimeSuccessRate 0.4
//                                                       BitNode/BitNode.tsx:1040-1083
//   MEASURED  Daedalus node power 4391/h and win rate 0.85 at 5x5 with the
//             solver answering (goplan.js POWER_PER_HOUR / WIN_RATE, 60 games);
//             160 games/h (.telemetry/go.txt, BN9's last go.js process,
//             2026-10-02: 337 games 12:34Z -> 14:40Z; the user's figure ~167);
//             Daedalus faction-work rep per hacking level (telemetry
//             history.jsonl, every Daedalus-work segment below 150 favor in
//             BN1/4/5/8/9/10, FactionWorkRepGain and favor divided out:
//             p10 72, median 97, p90 150 rep/h per level); the hacking level
//             a favor life is ground at (same segments: 3,500-5,900 in nodes
//             of HackingLevelMultiplier 0.35-1 — no trend with it).
//   ASSUMED   (lo/mid/hi in effects.SF_PARAMS, drawn by params.mjs)
//             eps14  the elasticity of the hacking route's growth g to the Go
//                    rate bonus (mid 0.12 reproduces nextnode's d14 = 2% at
//                    SF14.1: the one number this file does not derive);
//             w0     w0r1d_d43m0n node power per hour in the final window
//                    (19x19 bitverse board, never played by this repo:
//                    UNMEASURED, lo 0 = cannot score at all);
//             the favor life's Go head start (1h of node power before the
//             grind) and the 1h of w0r1d_d43m0n play before the exit hack —
//             fixed, stated here, not drawn.
//   NOT PRICED  the go.cheat API (BN14.2 itself, or SF14 >= 2 elsewhere,
//             netscriptGoImplementation.ts:486-497; +25% success at 14.3,
//             :564): it raises win rate and so node power and the favor
//             stream modestly — flagged, priced at zero. The Tetrads combat
//             bonus on the Bladeburner route's gym. The hacknet bonus.

import { favorToRep, repToFavor, goFavorStreamOf } from '../../../favor.js'
import { POWER_PER_HOUR, WIN_RATE, effectAt, meanEffect } from '../../../goplan.js'

/** Go/Constants.ts bonusPower: Daedalus 1.1 (faction_rep, company_rep), w0r1d_d43m0n 2 (hacking level). */
export const BONUS_POWER = { Daedalus: 1.1, w0r1d_d43m0n: 2 }

export const GO_MEASURED = {
  gamesPerH: 160,
  pWin: WIN_RATE.Daedalus,
  powerPerH: POWER_PER_HOUR.Daedalus,
  repPerLevelH: { lo: 72, mid: 97, hi: 150 },
  grindLevel: { lo: 3500, mid: 4700, hi: 5900 },
}
/** The Daedalus hacking requirement (Faction/FactionInfo.tsx:141-145): a favor life is ground at no lower a level. */
export const DAEDALUS_LEVEL = 2500
/** Intelligence's term in the rep formula at the live intelligence (~134): + int/3. */
export const INT_TERM = 45
/** Hours of Go node power the favor life starts with (it joins Daedalus part-way into the life). FIXED, stated. */
export const FAVOR_HEAD_H = 1
/** Hours of w0r1d_d43m0n play in the final window before the exit hack. FIXED, stated. */
export const W0RLD_HOURS = 1

/** getMaxRep() (effect.ts:30-43). */
export const goMaxRep = (sf14) => (sf14 >= 3 ? 400e3 : sf14 === 2 ? 300e3 : sf14 === 1 ? 200e3 : 100e3)
/** Every Go bonus scales with GoPower x (SF14 >= 1 ? 2 : 1) (effect.ts:18-21): the scale relative to the measured nodes (GoPower 1, no SF14). */
export const goScale = (goPower, sf14) => goPower * (sf14 >= 1 ? 2 : 1)

/** The measured runs' time-averaged Daedalus bonus over one install window (effect - 1, GoPower 1, no SF14). */
export function baseBonus(cycleHours, powerScale = 1) {
  return meanEffect(GO_MEASURED.powerPerH * powerScale, BONUS_POWER.Daedalus, cycleHours, 1, 0) - 1
}

/**
 * The hacking route's growth factor from Go at scale s: ((1 + s abar)/(1 + abar))^eps,
 * abar the measured-run mean bonus. s = 1 (every measured node) gives exactly 1.
 */
export const goGFactor = (s, abar, eps) => Math.pow((1 + s * abar) / (1 + abar), eps)

/** The w0r1d_d43m0n hacking-level multiplier at the exit: effect(w0 x hours) at scale s. 1 when w0 = 0. */
export const w0rldDiv = (s, w0, hours = W0RLD_HOURS) => (w0 > 0 ? effectAt(w0 * hours, BONUS_POWER.w0r1d_d43m0n, s, 0) : 1)

/**
 * The hacking route with an exit-level divisor W: H(g, E/W) ~= H(g, E) - ln(W)/g,
 * floored at 0.5h (GP4 checks it against the simulation at E/W directly).
 */
export const exitShift = (h, g, W) => (W > 1 ? Math.max(Math.min(h, 0.5), h - Math.log(W) / g) : h)

/**
 * THE FAVOR LIFE: hours of Daedalus faction work to bank favor 150 x FavorToDonate
 * (so The Red Pill is DONATED in the final window, as hackexit prices it), with
 * the Go farm on Daedalus meanwhile:
 *   need     favorToRep(floor(150 x ftd))   (0 in BN8: donations from favor 0)
 *   Go       favor stream goFavorStreamOf (games/h x p^2/(1+p) x getMaxRep/200, to getMaxRep)
 *            applied to the faction's favor at once (scoring.ts:74-77)
 *   ground   repPerLevelH/(1+abar) x level x fwrg x (1 + favor/100) x effect(P(t0+t)) at scale s
 * Done when Go rep + ground rep >= need (the install converts it, Faction.ts:79).
 * o: { ftd, fwrg, sf14, scale, level, repPerLevelH, abar, powerScale, gamesPerH, pWin, headH, dt, maxH }
 * Returns { hours, need, goRep, groundRep } (hours Infinity past maxH).
 */
export function favorLife(o) {
  const need = favorToRep(Math.floor(150 * o.ftd))
  if (!(need > 0)) return { hours: 0, need: 0, goRep: 0, groundRep: 0 }
  const st = goFavorStreamOf({ gamesPerHour: o.gamesPerH ?? GO_MEASURED.gamesPerH, pWin: o.pWin ?? GO_MEASURED.pWin, sf14: o.sf14, banked: 0 })
  const P = GO_MEASURED.powerPerH * (o.powerScale ?? 1)
  const head = o.headH ?? FAVOR_HEAD_H
  const base = (o.repPerLevelH / (1 + o.abar)) * o.level * o.fwrg
  const dt = o.dt ?? 0.01
  const maxH = o.maxH ?? 500
  let t = 0
  let ground = 0
  const goAt = (tt) => Math.min(st.capRep, st.repPerH * tt)
  while (goAt(t) + ground < need) {
    if (t >= maxH) return { hours: Infinity, need, goRep: goAt(t), groundRep: ground }
    // midpoint rule on the step: favor and the Go bonus both rise through it
    const tm = t + dt / 2
    const rate = base * (1 + repToFavor(goAt(tm)) / 100) * effectAt(P * (head + tm), BONUS_POWER.Daedalus, o.scale, 0)
    const left = need - goAt(t) - ground
    if (rate * dt + (goAt(t + dt) - goAt(t)) >= left) {
      // land the step exactly (linear inside it)
      const per = rate + (goAt(t + dt) - goAt(t)) / dt
      t += left / per
      ground += rate * (left / per)
      break
    }
    ground += rate * dt
    t += dt
  }
  return { hours: t, need, goRep: goAt(t), groundRep: ground }
}

/** The favor-life parameters of node `m` (its multipliers) at SF14 level `sf14`, in world p (effects.SF_PARAMS values). */
export function favorLifeOf(m, sf14, p, abar) {
  return favorLife({
    ftd: m.FavorToDonateToFaction,
    fwrg: m.FactionWorkRepGain,
    sf14,
    scale: goScale(m.GoPower, sf14),
    level: Math.max(DAEDALUS_LEVEL, p.lvl14) + INT_TERM,
    repPerLevelH: p.rep14,
    abar,
    powerScale: p.goP,
  })
}
