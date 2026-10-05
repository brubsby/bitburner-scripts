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
//   MEASURED  THE FARM NOW (release 3c/3d, 2026-10-04/05: goplan.POWER_PER_HOUR,
//             ARM_PRIOR, WIN_RATE — tools/sim/go-w0.mjs harness, 30 paired
//             layouts per arm, model session search + ponder + pre-send +
//             play-on, re-timed to the fast pipeline): 5x5 node power per hour
//             Illuminati 125180, Daedalus 27608, Tetrads 23991, Slum Snakes
//             22813, The Black Hand 15083, Netburners 12230; win rates
//             0.96-1.0; Daedalus ~11.2 s a game (ARM_PRIOR) -> ~320 games/h.
//             Live check (9cf8c90, go-games.txt Tetrads@5): 21950/h against
//             the harness's 23991 (x0.915) — goP's mid.
//             THE FARM THE MEASURED RUNS HAD (GO_REF): Daedalus 4391/h, win
//             0.85, 160 games/h (goplan.js 5e1c2c0, 60 games; BN9's last
//             go.js, .telemetry/go.txt 2026-10-02: 337 games 12:34Z -> 14:40Z).
//             Every played node's g and the favor-life rep below were measured
//             with at most this farm, so it is the reference the g factor and
//             the favor life's 'already inside g' are normalised by — the
//             current farm's bonus over it is NEW, and is what goG credits.
//             (Before 2026-10-03 the gameplan read goplan's live table for
//             both, so every solver release since d8335ad cancelled out of
//             goG: the ~6x faster farm was worth nothing.)
//             Daedalus faction-work rep per hacking level (telemetry
//             history.jsonl, every Daedalus-work segment below 150 favor in
//             BN1/4/5/8/9/10, FactionWorkRepGain and favor divided out:
//             p10 72, median 97, p90 150 rep/h per level); the hacking level
//             a favor life is ground at (same segments: 3,500-5,900 in nodes
//             of HackingLevelMultiplier 0.35-1 — no trend with it).
//             CHEATS (go.cheat, SF14.2+ / BN14.2+): release 3 already wins ~all
//             5x5 games and fills the board, so measured (7cd9ffe, 30 paired
//             layouts per arm, go-w0 --cheat) they LOSE on every 5x5 opponent:
//             Illuminati -13%, Daedalus -5%, Slum Snakes -15%, Tetrads +0.7%
//             (noise); go.js keeps them off. PRICED AT 0 on 5x5 (measured);
//             on bigger boards (the 19x19 hidden opponent) NOT PRICED (unmeasured).
//   ASSUMED   (lo/mid/hi in effects.SF_PARAMS, drawn by params.mjs)
//             eps14  the elasticity of the hacking route's growth g to the Go
//                    rate bonus (mid 0.12 reproduces nextnode's d14 = 2% at
//                    SF14.1: the one number this file does not derive);
//             the favor life's Go head start (1h of node power before the
//             grind) — fixed, stated here, not drawn.
//   DERIVED   w0     w0r1d_d43m0n node power per hour (19x19 bitverse board,
//                    never played live): the game's payout rules (endGoGame,
//                    below — TRANSCRIBED and played through the game in GP4)
//                    composed with four uncertain inputs, W0_PRIOR_INPUTS
//                    (win rate, black's score on a win and on a loss, games
//                    per hour), by Monte Carlo (w0PriorMC). Its p10/p50/p90
//                    are effects.SF_PARAMS.w0; go.js's measured rate still
//                    updates it (posterior.mjs, the gameplan-obs channel).
//             the w0r1d_d43m0n WINDOW: the farm plays the hidden opponent from
//                    The Red Pill install to the exit hack — the post-TRP
//                    climb of the hacking route's own simulation (surrogate
//                    climb table, phase-averaged over the install sawtooth),
//                    shortened by the bonus it banks (goWindow: the fixed
//                    point L = climb to exitLevel / W(w0 L)). Only the hidden
//                    opponent is played in it: on the hacking route after the
//                    terminal install goplan.hackLevelWeight prices the climb
//                    and goweights' channels are ~0 there (no install left for
//                    money or rep to reach, no pre-install exp), so
//                    chooseOpponent does not share the slot.
//   PRICED ON THE BLADEBURNER ROUTE (bladeGoOf, surrogate bb grid -> bbsim o.go):
//             the farm on Tetrads (its combat channel: str/def/dex/agi level
//             multipliers) from the node's start, at POWER_PER_HOUR.Tetrads x
//             goP mid, scale GoPower x (SF14 >= 1 ? 2 : 1) — x2 everywhere at
//             SF14.1, x8 in BN14. The leg has no install (the route never
//             installs), so the wipe never lands there; bbsim zeroes it at an
//             install when a spec asks for installs (Go/Go.ts:34-47).
//   NOT PRICED  the go.cheat API on boards bigger than 5x5 (BN14.2 itself, or
//             SF14 >= 2 elsewhere, netscriptGoImplementation.ts:486-497; +25%
//             success at 14.3, :564): unmeasured on 19x19. goP's spread is not
//             drawn on the Bladeburner leg (mid only). The hacknet bonus.

import { favorToRep, repToFavor, goFavorStreamOf } from '../../../favor.js'
import { POWER_PER_HOUR, WIN_RATE, ARM_PRIOR, OPPONENTS, effectAt, meanEffect } from '../../../goplan.js'

/** Go/Constants.ts bonusPower: Daedalus 1.1 (faction_rep, company_rep), w0r1d_d43m0n 2 (hacking level). */
export const BONUS_POWER = { Daedalus: 1.1, w0r1d_d43m0n: 2 }

/** Daedalus 5x5 seconds a game, the model arm at go.js's budget (goplan ARM_PRIOR [games, p, bw, bl, [s, sd]]). */
const DAEDALUS_S = ARM_PRIOR.Daedalus[5].model[4][0]
/** THE FARM NOW (release 3c, see the header): what every clear from here plays with. */
export const GO_MEASURED = {
  gamesPerH: Math.round(3600 / DAEDALUS_S),
  pWin: WIN_RATE.Daedalus,
  powerPerH: POWER_PER_HOUR.Daedalus,
  tetradsPerH: POWER_PER_HOUR.Tetrads,
  repPerLevelH: { lo: 72, mid: 97, hi: 150 },
  grindLevel: { lo: 3500, mid: 4700, hi: 5900 },
}
/** THE FARM THE MEASURED RUNS HAD (the reference g and the favor-life rep were measured against). */
export const GO_REF = { powerPerH: 4391, pWin: 0.85, gamesPerH: 160, what: 'goplan 5e1c2c0 Daedalus 4391/h, win 0.85 (60 games); 160 games/h (BN9 go.txt 2026-10-02)' }
/** The Daedalus hacking requirement (Faction/FactionInfo.tsx:141-145): a favor life is ground at no lower a level. */
export const DAEDALUS_LEVEL = 2500
/** Intelligence's term in the rep formula at the live intelligence (~134): + int/3. */
export const INT_TERM = 45
/** Hours of Go node power the favor life starts with (it joins Daedalus part-way into the life). FIXED, stated. */
export const FAVOR_HEAD_H = 1
/** The OLD fixed window (hours of w0r1d_d43m0n play before the exit hack): the regression mode only (worldOf w0Window: 1). */
export const W0RLD_HOURS = 1

/** getMaxRep() (effect.ts:30-43). */
export const goMaxRep = (sf14) => (sf14 >= 3 ? 400e3 : sf14 === 2 ? 300e3 : sf14 === 1 ? 200e3 : 100e3)
/** Every Go bonus scales with GoPower x (SF14 >= 1 ? 2 : 1) (effect.ts:18-21): the scale relative to the measured nodes (GoPower 1, no SF14). */
export const goScale = (goPower, sf14) => goPower * (sf14 >= 1 ? 2 : 1)

/**
 * The farm NOW: its time-averaged Daedalus bonus over one install window (effect - 1,
 * GoPower 1, no SF14) at goP x the harness rate. The install wipe (Go/Go.ts:34-47) is
 * what the time average prices: the bonus restarts from 0 every window.
 */
export function baseBonus(cycleHours, powerScale = 1) {
  return meanEffect(GO_MEASURED.powerPerH * powerScale, BONUS_POWER.Daedalus, cycleHours, 1, 0) - 1
}
/** The reference farm's (GO_REF) bonus over the same window: what the measured runs' g already holds. */
export function refBonus(cycleHours) {
  return meanEffect(GO_REF.powerPerH, BONUS_POWER.Daedalus, cycleHours, 1, 0) - 1
}

/**
 * The hacking route's growth factor from Go at scale s: ((1 + s abar)/(1 + aref))^eps,
 * abar the farm now (baseBonus), aref the measured runs' (refBonus; default abar: the
 * old one-farm form, goplan.goExitInputsOf's). s = 1 with abar = aref gives exactly 1.
 */
export const goGFactor = (s, abar, eps, aref = abar) => Math.pow((1 + s * abar) / (1 + aref), eps)

/**
 * THE BLADEBURNER ROUTE'S GO FARM (bbsim o.go): Tetrads from the node's start at the
 * farm's rate x goP (mid), at GoPower x the SF14 doubling. sf14: the level the grid is
 * priced at (the plan's entry state; every state the lattice reaches from SF14.1 on
 * has the doubling). perHour rounded (it is part of the cache key).
 */
export const BLADE_GO_P = 0.9
export function bladeGoOf(goPower, sf14, perHour = GO_MEASURED.tetradsPerH * BLADE_GO_P) {
  return { perHour: Math.round(perHour), power: OPPONENTS.Tetrads.power, goPower, sf14: sf14 >= 1 ? 1 : 0 }
}

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
 * o: { ftd, fwrg, sf14, scale, level, repPerLevelH, abar, powerScale, powerPerH, gamesPerH, pWin, headH, dt, maxH }
 * (abar: the bonus the rep measurement was taken under — the reference farm's, refBonus)
 * Returns { hours, need, goRep, groundRep } (hours Infinity past maxH).
 */
export function favorLife(o) {
  const need = favorToRep(Math.floor(150 * o.ftd))
  if (!(need > 0)) return { hours: 0, need: 0, goRep: 0, groundRep: 0 }
  const st = goFavorStreamOf({ gamesPerHour: o.gamesPerH ?? GO_MEASURED.gamesPerH, pWin: o.pWin ?? GO_MEASURED.pWin, sf14: o.sf14, banked: 0 })
  const P = (o.powerPerH ?? GO_MEASURED.powerPerH) * (o.powerScale ?? 1)
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

/**
 * The favor-life parameters of node `m` (its multipliers) at SF14 level `sf14`, in world p
 * (effects.SF_PARAMS values). aref: the reference farm's bonus (refBonus), which the rep
 * measurement is divided by. era 'now' (default): the farm every clear from here plays
 * with (GO_MEASURED x goP); 'ref': the farm the measured runs had (GO_REF) — the favor life
 * already inside a played node's g (routes.mjs favorRef).
 */
export function favorLifeOf(m, sf14, p, aref, era = 'now') {
  const ref = era === 'ref'
  return favorLife({
    ftd: m.FavorToDonateToFaction,
    fwrg: m.FactionWorkRepGain,
    sf14,
    scale: goScale(m.GoPower, sf14),
    level: Math.max(DAEDALUS_LEVEL, p.lvl14) + INT_TERM,
    repPerLevelH: p.rep14,
    abar: aref,
    ...(ref ? { powerPerH: GO_REF.powerPerH, powerScale: 1, gamesPerH: GO_REF.gamesPerH, pWin: GO_REF.pWin } : { powerScale: p.goP }),
  })
}

// ---------------------------------------------------------------------------
// THE HIDDEN OPPONENT'S PAYOUT, transcribed (GP4 plays it through the game):
//   endGoGame              scoring.ts:46-99   nodePower += black.sum x
//                            getDifficultyMultiplier(komi, size) x
//                            getWinstreakMultiplier(winStreak, oldWinStreak)
//   win iff                black.sum >= white.sum (white.sum = pieces +
//                            territory + komi)                  scoring.ts:56
//   streak                 win: old < 0 ? 1 : old + 1; loss: old >= 0 ? -1 :
//                            old - 1 (resetWinstreak, game complete) :118-128
//   getWinstreakMultiplier loss 0.5; a win breaking a dry streak d: 1 + 0.5
//                            min(d, 8); else 1 + 0.25 min(streak, 8)
//                                                         effect.ts:119-130
//   getDifficultyMultiplier (komi + 0.5) x 0.25 = 2.5 at komi 9.5 (the x8 is
//                            5x5 Illuminati only)          effect.ts:132-135
//   the board              bitverseBoardShape, 267 playable points, 19x19,
//                            7 white routers to start     Constants.ts:88-108,
//                                                         boardState.ts:26,100
//   reset                  every install zeroes nodePower AND the streak
//                                                         Go.ts:34-47

/** komi of the hidden opponent (Constants.ts:63) and its difficulty multiplier. */
export const W0_KOMI = 9.5
export const W0_DIFFICULTY = (W0_KOMI + 0.5) * 0.25
/** Playable points on the bitverse board (Constants.ts:88-108, the '.' cells). */
export const BITVERSE_POINTS = 267
const STREAK_CAP = 8

/** getWinstreakMultiplier (effect.ts:119-130), transcribed. */
export function winstreakMult(winStreak, previous) {
  if (winStreak < 0) return 0.5
  if (previous < 0 && winStreak > 0) return 1 + 0.5 * Math.min(-previous, STREAK_CAP)
  return 1 + 0.25 * Math.min(winStreak, STREAK_CAP)
}

/** One finished game (endGoGame): { power, streak } from the streak before, the result and black's score. */
export function goGameStep(streak, won, blackScore, difficulty = W0_DIFFICULTY) {
  const next = won ? (streak < 0 ? 1 : streak + 1) : streak >= 0 ? -1 : streak - 1
  return { power: blackScore * difficulty * winstreakMult(next, streak), streak: next }
}

/**
 * Expected node power per game in the streak chain's stationary state: win rate
 * p, black scoring sW on a win and sL on a loss. Exact with the streak clipped
 * to [-8, 8] (the multiplier does not see past 8 either way).
 */
export function w0PerGame(p, sW, sL, difficulty = W0_DIFFICULTY) {
  const N = 2 * STREAK_CAP + 1
  const idx = (s) => s + STREAK_CAP
  const clip = (s) => Math.max(-STREAK_CAP, Math.min(STREAK_CAP, s))
  let pi = new Float64Array(N)
  pi[idx(0)] = 1
  for (let it = 0; it < 5000; it++) {
    const nx = new Float64Array(N)
    for (let s = -STREAK_CAP; s <= STREAK_CAP; s++) {
      const m = pi[idx(s)]
      if (!m) continue
      nx[idx(clip(s < 0 ? 1 : s + 1))] += m * p
      nx[idx(clip(s >= 0 ? -1 : s - 1))] += m * (1 - p)
    }
    let d = 0
    for (let i = 0; i < N; i++) d += Math.abs(nx[i] - pi[i])
    pi = nx
    if (d < 1e-13) break
  }
  let e = 0
  for (let s = -STREAK_CAP; s <= STREAK_CAP; s++) {
    const m = pi[idx(s)]
    if (m) e += m * (p * goGameStep(s, true, sW, difficulty).power + (1 - p) * goGameStep(s, false, sL, difficulty).power)
  }
  return e
}

/**
 * THE UNCERTAIN INPUTS of the w0 prior, each with its reason; w0PriorMC composes
 * them through the payout above. Drawn independently (stated: a stronger bot
 * raises p and both scores together — not modelled).
 *
 * RE-DERIVED 2026-10-05 for the solver go.js plays the hidden board with NOW:
 * SETTINGS.bigBoard.backend 'auto' = KataGo b18 on the bubtop GPU at 800
 * visits, holes sent white, no ponder on 19x19 (tools/katago/README.md), with
 * the CPU b10 at 400 visits only while the GPU is down. The uct node-power
 * search the old prior was built on (0 wins in 41, ~961/h) is no longer what
 * plays — it is the fallback's fallback.
 *
 *   pWin       Beta(2.5, 6), mean 0.29: the KataGo GPU harness games on the
 *              bitverse board (go-w0.mjs vs the game's own getMove, paired
 *              layouts --layoutseed 2): 1 win in 7 (800 visits: 0/4 pondered,
 *              1/3 not) and 2 in 6 (the holes-colour study's 'white' arm, the
 *              shipped mapping) = 3 in 13, at HALF weight on a uniform prior
 *              (harness, never live: the 5x5 harness read Illuminati 0.25-0.38
 *              where live read ~0.2 under the old solver). p10/p90 ~0.11/0.50.
 *   fWin       black's score on a win / 267. A win needs B >= W + 9.5, so
 *              B > ~135 of the ~260 decided points: 0.5 + 0.5 Beta(2, 5.5).
 *   fLoss      black's score on a loss / 267: 0.5 Beta(11, 3) — mean 0.39
 *              (105 points), p10/p90 ~86/122: KataGo's games score 87-132 a
 *              game (README: 132 over 4 pondered losses, 98 over 1 won + 2
 *              lost, 102 over 2 won + 4 lost, 87 at 1600 visits), against uct's
 *              84-87. THE FLOOR'S DRIVER: at a win rate near 0 nearly every
 *              game pays 0.5 x 2.5 x this score.
 *   gamesPerH  split log-normal p10/p50/p90 6.5/8.8/10.5: ~150 moves a side,
 *              each AI reply ~1.4s (4.4 waitCycles x 200ms, goAI.ts:877-883 +
 *              one sleep(10) per board row, patternMatching.ts:104 + its own
 *              0.3-0.5s), our move KataGo GPU ~0.8s + the fast pipeline's
 *              ~0.1s: ~2.3-2.7s a move pair, ~8.8 games/h (the old uct 800ms
 *              clock, go-w0.mjs: ~400s a game). The low tail is the GPU down:
 *              the CPU b10 at ~5.5s a move runs ~3.5 games/h.
 * Composed: p10/p50/p90 ~2.2k/3.2k/4.4k per hour (GP8 re-derives it), against
 * the harness's 1.6-4.1k/h (1653 pondered 0/4, 3554 1/3, 4112 2/6) and uct's 961.
 */
export const W0_PRIOR_INPUTS = {
  pWin: { beta: [2.5, 6], what: 'win rate vs ???????????? on the bitverse board: KataGo GPU 800 visits, 3 wins in 13 harness games (1/7 + 2/6) at half weight on Beta(1, 1)' },
  fWin: { lo: 0.5, span: 0.5, beta: [2, 5.5], what: "black's score on a win / 267: 0.5 + 0.5 Beta(2, 5.5)" },
  fLoss: { lo: 0, span: 0.5, beta: [11, 3], what: "black's score on a loss / 267: 0.5 Beta(11, 3), mean 105 (KataGo 87-132 a game in the harness)" },
  gamesPerH: { lo: 6.5, mid: 8.8, hi: 10.5, what: 'finished 19x19 games per hour (the AI\'s timers + KataGo GPU ~0.8s a move; the low tail the CPU fallback)' },
}

/**
 * THE HARNESSES ON THE BITVERSE BOARD, our solver against the game's own
 * getMove for the hidden opponent — harness, not live:
 *   2026-10-03, uct (the old prior's evidence, superseded as the solver):
 *     go-boardsize.mjs 19x1500 8 games 0 won (black 29-97 a loss, mean 68);
 *     go-w0.mjs (e241fd5) 33 games 0 won, the node-power search 84.3/86.7 a
 *     loss, ~400s a game -> 948-961 power/h.
 *   2026-10-04, KataGo GPU b18 800 visits (tools/katago/README.md, --layoutseed 2):
 *     pondered 4 games 0 won black 132 -> 1653/h; not pondered 3 games 1 won
 *     black 98 -> 3554/h; holes 'white' 6 games 2 won black 102 -> 4112/h
 *     ('owner' 0/6 black 118 -> 1736/h, not shipped); 1600 visits 0/3 black 87.
 */
export const W0_HARNESS = {
  games: 41,
  wins: 0,
  blackOnLoss: { boardsize1500: [97, 65, 80, 29, 70, 62, 75, 63], nodePowerSearch: [84.3, 86.7] },
  movesPerSide: { boardsize1500: 164, nodePowerSearch: 150 },
  waitCyclesPerReply: 4.4,
  aiComputeSPerReply: [0.27, 0.47],
  liveSPerGame: { boardsize1500: 540, nodePowerSearch: 403 },
  powerPerH: { nodePowerSearch: 961, oldSearch: 697 },
  katago: { games: 13, wins: 3, runs: [{ what: 'gpu800 pondered', games: 4, wins: 0, black: 132, powerPerH: 1653 }, { what: 'gpu800', games: 3, wins: 1, black: 98, powerPerH: 3554 }, { what: 'gpu800 holes white', games: 6, wins: 2, black: 102, powerPerH: 4112 }] },
}

// a small seeded generator (params.mjs's mulberry32; go.mjs cannot import params: params imports go)
function mulberry(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function gauss(r) {
  let u = 0
  while (u <= 1e-12) u = r()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r())
}
function gammaDraw(k, r) {
  if (k < 1) return gammaDraw(k + 1, r) * Math.pow(r(), 1 / k)
  const d = k - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x, v
    do {
      x = gauss(r)
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = r()
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}
const betaDraw = ([a, b], r) => {
  const x = gammaDraw(a, r)
  return x / (x + gammaDraw(b, r))
}
const splitLogQ = (q, z) => Math.exp(Math.log(q.mid) + (z / 1.2816) * (z < 0 ? Math.log(q.mid / q.lo) : Math.log(q.hi / q.mid)))
const quantile = (xs, q) => xs[Math.min(xs.length - 1, Math.floor(q * xs.length))]

/** One draw of the inputs -> { p, fWin, fLoss, gamesPerH, perGame, w0 }. */
export function w0Draw(r, I = W0_PRIOR_INPUTS) {
  const p = betaDraw(I.pWin.beta, r)
  const fWin = I.fWin.lo + I.fWin.span * betaDraw(I.fWin.beta, r)
  const fLoss = I.fLoss.lo + I.fLoss.span * betaDraw(I.fLoss.beta, r)
  const gamesPerH = splitLogQ(I.gamesPerH, gauss(r))
  const perGame = w0PerGame(p, fWin * BITVERSE_POINTS, fLoss * BITVERSE_POINTS)
  return { p, fWin, fLoss, gamesPerH, perGame, w0: gamesPerH * perGame }
}

/**
 * THE DERIVED w0 PRIOR: Monte Carlo over W0_PRIOR_INPUTS through the payout.
 * Returns { q10, q50, q90, mean, n, inputs: {name: [p10, p50, p90]}, rank: {name: Spearman rho with w0} }.
 */
export function w0PriorMC({ n = 20000, seed = 1419, inputs = W0_PRIOR_INPUTS } = {}) {
  const r = mulberry(seed)
  const rows = Array.from({ length: n }, () => w0Draw(r, inputs))
  const col = (k) => rows.map((x) => x[k]).sort((a, b) => a - b)
  const w = col('w0')
  const ranks = (k) => {
    const rk = new Float64Array(n)
    rows.map((x, i) => [x[k], i]).sort((a, b) => a[0] - b[0]).forEach(([, i], j) => (rk[i] = j))
    return rk
  }
  const rw = ranks('w0')
  const rank = {}
  for (const k of ['p', 'fWin', 'fLoss', 'gamesPerH']) {
    const rk = ranks(k)
    let s = 0
    for (let i = 0; i < n; i++) s += (rk[i] - rw[i]) ** 2
    rank[k] = 1 - (6 * s) / (n * (n * n - 1))
  }
  return {
    q10: quantile(w, 0.1),
    q50: quantile(w, 0.5),
    q90: quantile(w, 0.9),
    mean: w.reduce((a, b) => a + b, 0) / n,
    n,
    inputs: Object.fromEntries(['p', 'fWin', 'fLoss', 'gamesPerH', 'perGame'].map((k) => [k, [0.1, 0.5, 0.9].map((q) => quantile(col(k), q))])),
    rank,
  }
}

// ---------------------------------------------------------------------------
// THE WINDOW: the w0r1d_d43m0n bonus banked at the exit moment.
//
// The farm is on the hidden opponent from The Red Pill install (node power and
// streak start at 0, Go.ts:34-47) to the exit hack, and the exit is reached when
//     level = M x W(t) x u(exp(t)) >= E,   u(x) = 32 ln(x + 534.6) - 200
// (skill.ts:7-15 with the multiplier split: M the augmented hacking multiplier
// after the terminal install, W(t) = effect(w0 t) the Go bonus, re-applied to
// the skill multiplier at every game end, effect.ts:59-63). Without the bonus
// the climb takes L0 (the simulation's 'climb to exit level' leg) with
// u(R L0) = u0 = E/M, R the leg's constant exp rate (exitplan's fresh-life
// climb). With it the climb is the fixed point
//     L = T(u0 / W(w0 L)),   T(u) = (e^((u+200)/32) - 534.6) / R
// unique on (0, L0]: as L grows W grows and T(u0/W) falls (the continuous
// limit: bisection on L - T(u0/W(w0 L)), strictly increasing; goWindowIterate
// is the plain damped map, the test's independent route to the same root).
// Node power is banked per FINISHED game, though, so the plan prices the exact
// first passage with W a step per game (goWindow, tau = W0_GAME_H).
//
// WHAT IT SAYS. The climb's last hours are worth little level — u is
// logarithmic in exp, so the final doubling of time adds 32 ln 2 of u — and a
// few percent on the multiplier removes most of it: at u0 ~700 a W of 1.1
// cuts the remaining exp by e^(-700 x 0.09/32) ~ 7x. So the window is about
// ONE game (~0.11h): the climb ends right after the first game's power lands,
// and W is effect(one game's power) ~1.10 at GoPower 1 (~1.4 in BN14, ~1.8
// there with SF14.1) — whatever w0 is within its prior.
// NOT PRICED (flagged): a final life that ANTICIPATED the bonus. The exit
// shift prices the exit level divided by W with the installs re-planned
// (ln W/g); today's exitplan does not know the hidden opponent exists, so the
// live realisation is the climb's own shortening (L0 - L*, ~1h). And an
// anticipating policy would do more than either: at the climb's end the Go
// term w0 d ln W/dL beats g (the install route's ln-multiplier per hour), so
// it would install The Red Pill earlier and climb longer while farming —
// teaching exitplan about w0 is the lever, not this model.

/** The climb's u (level / multiplier) after exp x, and its inverse. */
const uOfExp = (x) => 32 * Math.log(x + 534.6) - 200
const expOfU = (u) => Math.max(0, Math.exp((u + 200) / 32) - 534.6)

/** Hours of one 19x19 game against the hidden opponent: node power is banked only at a game's end (endGoGame). */
export const W0_GAME_H = 1 / W0_PRIOR_INPUTS.gamesPerH.mid

/**
 * The window: { L0, u0, w0, s, tau } -> { hours, W, L0, games, iters }.
 * L0 the climb without the bonus (hours), u0 = exitLevel / M, s the Go scale
 * (GoPower x the SF14 doubling). w0 = 0 or no climb: the window is L0, W = 1.
 *
 * tau > 0 (the default, W0_GAME_H): node power arrives in whole games — endGoGame
 * banks it at a game's end and updateGoMults applies it then — so W is a step,
 * W_k = effect(w0 tau k) after k games, and the exit is the first passage: in
 * game k's span the climb ends at T(u0/W_k) if that falls inside it, or at the
 * moment game k ends if the jump to W_k already clears the level. Exact; a
 * window shorter than one game banks nothing.
 * tau = 0: the continuous limit, the fixed point L = T(u0/W(w0 L)) by bisection
 * (the discrete scan converges to it as tau -> 0 — GP8).
 */
export function goWindow({ L0, u0, w0, s, tau = W0_GAME_H }) {
  if (!(w0 > 0) || !(L0 > 0) || !(u0 > uOfExp(0))) return { hours: Math.max(0, L0 || 0), W: 1, L0, games: 0, iters: 0 }
  const R = expOfU(u0) / L0
  const Wof = (P) => effectAt(P, BONUS_POWER.w0r1d_d43m0n, s, 0)
  const T = (W) => expOfU(u0 / W) / R
  if (tau > 0) {
    for (let k = 0; k < 1e6; k++) {
      const Wk = k ? Wof(w0 * tau * k) : 1
      const t = T(Wk)
      if (t <= (k + 1) * tau) return { hours: Math.max(t, k * tau), W: Wk, L0, games: k, iters: k + 1 }
    }
  }
  const F = (L) => L - T(Wof(w0 * L))
  let lo = 0
  let hi = L0
  let iters = 0
  while (hi - lo > 1e-9 * Math.max(1, L0) && iters < 200) {
    const m = (lo + hi) / 2
    if (F(m) < 0) lo = m
    else hi = m
    iters++
  }
  const L = (lo + hi) / 2
  return { hours: L, W: Wof(w0 * L), L0, games: null, iters }
}

/** The damped fixed-point map L <- (1-a) L + a T(u0/W(w0 L)) from L0 (the convergence test's route). */
export function goWindowIterate({ L0, u0, w0, s, damp = 0.5, maxIt = 2000, tol = 1e-10 }) {
  if (!(w0 > 0) || !(L0 > 0) || !(u0 > uOfExp(0))) return { hours: L0, iters: 0, converged: true }
  const R = expOfU(u0) / L0
  let L = L0
  for (let i = 1; i <= maxIt; i++) {
    const next = (1 - damp) * L + (damp * expOfU(u0 / effectAt(w0 * L, BONUS_POWER.w0r1d_d43m0n, s, 0))) / R
    if (Math.abs(next - L) < tol) return { hours: next, iters: i, converged: true }
    L = next
  }
  return { hours: L, iters: maxIt, converged: false }
}
