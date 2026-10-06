// WHICH IPvGO OPPONENT SHOULD go.js FARM? Priced, not chosen once.
//
// Each opponent feeds a DIFFERENT player multiplier (Go/effects/effect.ts:68-101):
//
//   Netburners   -> hacknet_node_money        bonusPower 1.3  komi 1.5
//   SlumSnakes   -> crime_success             bonusPower 1.2  komi 3.5
//   TheBlackHand -> hacking_money             bonusPower 0.9  komi 3.5
//   Tetrads      -> str/def/dex/agi           bonusPower 0.7  komi 5.5
//   Daedalus     -> company_rep + faction_rep bonusPower 1.1  komi 5.5
//   Illuminati   -> hacking_speed             bonusPower 0.7  komi 7.5
//   ????????????  -> hacking (the skill level) bonusPower 2    komi 9.5   (the hidden
//                   opponent GoOpponent.w0r1d_d43m0n — see THE HIDDEN OPPONENT below)
//
// go.js carried `opponent: 'Daedalus'` as a CONSTANT from the BitNode 2 run,
// where the whole trajectory was reputation-bound and the gang sold The Red
// Pill. That is not this node, and a constant cannot notice.
//
// THE RESET IS HALF THE PROBLEM. Go.prestigeAugmentation (Go/Go.ts:34-47)
// zeroes nodePower for every opponent on EVERY INSTALL — the opposite of gang
// territory, which survives. So the quantity worth anything is not the effect
// at the end of a window but its TIME AVERAGE over one:
//
//     Ebar = (1/H) * integral_0^H effect(P*t) dt
//     effect(n) = 1 + ln(n+1)*(n+1)^0.3*0.002*bonusPower*GoPower*sfBonus
//
// Scoring the end-of-window value would overstate every opponent by roughly
// the same factor — the kind of error that survives a comparison and then
// misprices the channel against augmentations.
//
// THAT WINDOW MEAN IS A PRICE, NOT THE DECISION. It says what a whole window
// on one opponent is worth (meanEffect). WHICH board to play next is a
// marginal question: switching loses nothing banked (every opponent's
// nodePower keeps paying, effect.ts:59-101; only an install zeroes it), so the
// next game goes where d(sum w ln E)/dt is largest at the CURRENT per-opponent
// node power. chooseOpponent below does that, with the switch hysteresis
// priced as a committed dwell rather than a veto on banked power. A flat-
// weights pass still cannot distinguish the channels, and it still REFUSES.
//
// CALIBRATION: the power table below is MEASURED, 30-70 games per arm at 5x5
// against the game's own getMove, with the solver's OPPONENT-MODEL backend
// (tools/go-solver.mjs backend 'model', golib.chooseMoveModel; 2026-10-03,
// tools/sim/go-study.mjs + go-study-report.mjs: go-w0.mjs games with a fresh
// paired offline-node layout per game, mirror pass, the AI's waitCycles and
// pattern rows on the live clock). The report's live CHECK passed on the arm
// the live game was playing (Tetrads 5x5 uct: win 93.3% vs live 92.7%, turns
// 9.7 vs 9.0). It is valid only while the solver answers WITH THE MODEL —
// go.js reports health 'warn' (modelHealth) when model requests fall back to
// uct, and the uct figures are the old ones below.
//   arm            model @ go.js budget        | model 800ms     | uct 800ms
//   Daedalus       400ms 100% 12978/h          | 100%   9656     |  90%  8767
//   Illuminati     800ms  99% 51885/h (n=70)   |  as left        |  30% 11631
//   TheBlackHand   400ms 100%  9535/h          | 100%   7396     |  93%  6420
//   SlumSnakes     400ms  97% 10485/h          |  97%   8218     |  97%  8569
//   Netburners     200ms 100%  6553/h          | 100%   5395     | 100%  4437
//   Tetrads        400ms  97% 10360/h          | 100%   9628     |  93%  8725
// The budget per opponent is go.js SETTINGS.model.maxmsBy.
//
// PONDERED (2026-10-04, the table below): tools/go-solver.mjs now searches
// the AI's most likely reply (sampled from the model) at the full budget
// while the AI's reply crawls through its timer hops, and answers a matching
// position at once. Same harness, 30 games per arm, paired layouts (seed 2),
// ponder overrun past the AI's live reply time charged:
//   arm            model+ponder        | same-day model control
//   Daedalus       97% 13643/h         | 100% 13707  (no gain: 400ms hides behind the reply anyway)
//   Illuminati     97% 67897/h         |  97% 54298  (+25%: 800ms is longer than the reply)
//   TheBlackHand  100% 11122/h         | (10-03: 9535)
//   SlumSnakes    100% 11824/h         |  97% 10997
//   Netburners     97%  6569/h         | (10-03: 6553)
//   Tetrads        97% 11550/h         | (10-03: 10360)
// Win rates are unchanged within one game in 30 (paired black per game
// -0.03..-0.27). KataGo (tools/katago, GPU or CPU) loses to the model on
// EVERY small board and never beats the 5x5 rate on 7x7/9x9/13x13 (the AI's
// own reply time per turn is the floor, and 5x5 earns the most area per
// turn): tools/katago/README.md has the full opponent x board table.
//
// SESSION SEARCH (2026-10-04, release 2, the table below): go-solver keeps
// ONE model search tree across moves (golib.modelSession) — the subtree under
// the AI's actual reply becomes the next root, the search continues under our
// move for the AI's whole reply time (the chance node weights it by the AI's
// reply distribution), and a root already holding a budget's worth of work
// answers at once (58% of moves; 82% of roots reused). Paired against the
// pondered arms above, 30 games each: black +0.4..+1.1 per game on every
// opponent, wins unchanged within noise:
//   Daedalus 15436 (100%), Illuminati 73318 (97%), TheBlackHand 10706 (100%,
//   -4%: slower games, noise), SlumSnakes 13328 (100%), Netburners 7636
//   (100%), Tetrads 11665 (93%).
// THE TABLE BELOW IS RE-TIMED (go-study-report ROUND_TRIP_MS 275ms per move,
// was 550): calibrated on 53 live Tetrads games, 16.4 s/game live vs 19.4 in
// the harness. Every opponent's rate rises ~20% together; the ranking is
// unchanged. Session arms re-timed: Daedalus 18806, Illuminati 87865,
// TheBlackHand 12927, SlumSnakes 16243, Netburners 9820, Tetrads 13937.
// THE FAST PIPELINE (release 2): go.js reads the answer every 25ms (was
// 250) and idles 10ms (was 100); go-solver polls every 25ms during a game
// (was 150). Observed live before it, over the RFA bridge: request -> answer
// 196ms, read at 250, idle 100 — ~0.35s of a ~1.55s turn. Priced at 85ms a
// turn (go-w0 ROUND_TRIP_MS), the table below is the session arms at the
// fast pipeline. NOT YET CHECKED LIVE: go.js publishes turnTiming and
// go-study-report's s/stone CHECK tests it once 30 games have run.
// Measured and NOT shipped: tree reuse without pondering (Illuminati 58053),
// reuse + ponder spending the full budget anyway ("deep", Illuminati 52663,
// Tetrads 10945, Slum Snakes 11705: depth bought no wins, only time).
// (The previous table, 60 games/arm with go-boardsize.mjs, was ~2x lower
// across the board: that harness never mirror-passed and dealt ONE offline-
// node layout for every game — tools/sim/go-board.mjs.)

// RELEASE 3c (2026-10-04, tools/sim/go-w0.mjs, 30 paired layouts per arm,
// pre-send on): Tetrads, Illuminati (loss-scale 2), Daedalus and Slum Snakes
// now PLAY ON after the AI's pass with the power objective (go.js
// SETTINGS.mirror). Their rows below are those arms: Tetrads 20425 -> 23991,
// Illuminati 104215 -> 125180, Daedalus 22892 -> 27608, Slum Snakes 20180 ->
// 22813 (same-day controls). The Black Hand and Netburners: release 2.
// ARM_PRIOR's 5x5 rows for the four carry the same arms' black and seconds.
/** Node power per hour at 5x5, model session search, fast pipeline (release 2; go-study-report at 85ms/turn), go.js's per-opponent budget. */
export const POWER_PER_HOUR = {
  Daedalus: 27608,
  Illuminati: 125180,
  TheBlackHand: 15083,
  SlumSnakes: 22813,
  Netburners: 12230,
  Tetrads: 23991,
}

// ---------------------------------------------------------------------------
// THE BOARD SIZE IS AN ARM TOO (release 3a). Thompson sampling runs over
// opponent x board size: each `name@size` arm (size 5, 7, 9, 13; the hidden
// opponent only ever 19) carries its own posterior, and the draw is the arm's
// POWER PER SECOND, not only its win rate (the larger boards' score and game
// length are as uncertain as their win rate):
//
//   p   ~ Beta                      the win rate
//   bw  ~ Normal (known variance)   mean black.sum of a WON game
//   bl  ~ Normal                    mean black.sum of a LOST game
//   s   ~ Normal                    mean seconds a game takes
//   power/game = difficulty x (bw x (M(p) - 0.5(1-p)) + bl x 0.5(1-p))
//   power/s    = power/game / s
// M(p) = steadyStreakMult(p), the mean streak multiplier at win rate p (a lost
// game pays 0.5, so the won games' share of M is M - 0.5(1-p)). The SELECTION
// is unchanged: drawn power x the channel's exit weight x dlnE/dn at the
// opponent's current node power (chooseOpponent), so opponents are compared
// on value, not raw power.
//
// PRIORS: tools/sim/go-study-report.mjs runs (2026-10-03/04, paired layouts,
// re-timed to the fast pipeline's 85ms a turn), per backend the solver routes
// the size to — 5x5 the model session; 7x7/9x9/13x13 uct, or KataGo on the
// GPU host through the solver's service (200 visits, pondered). Pseudo-counts:
// THOMPSON.priorN on 5x5 (30-game arms, checked live), THOMPSON.armPriorN on
// the larger boards (3-20 games, never played live): WIDE.
// [games, winRate, [meanBlackWon, sd], [meanBlackLost, sd] | null, [secondsPerGame, sd]]
// The 5x5 win rate is WIN_RATE (pooled over every model arm, 90-130 games).
// An arm with no measurement is not offered. NOT CALIBRATED live but 5x5.

export const ARM_PRIOR = {
  // (the 5x5 row's 30 is games measured, not an augmentation count)
  Daedalus: {
    5: { model: [30, 1, [19.03, 4.29], null, [11.17, 3.25]] }, 7: { katago: [20, 0.85, [26.82, 3.26], [12, 10.82], [22.05, 4.41]], uct: [8, 0.75, [26, 2.68], [20.5, 2.12], [36.51, 9.47]] }, 9: { katago: [20, 0.8, [41.44, 3.42], [15.25, 17.73], [41.71, 8.39]], uct: [6, 1, [41.67, 2.73], null, [61.14, 10.08]] }, 13: { katago: [3, 1, [86.33, 7.09], null, [88.09, 5.72]], uct: [3, 0.667, [79, 1.41], [65, null], [133.69, 16.55]] } },
  Illuminati: { 5: { model: [30, 1, [19.3, 4.62], [7, null], [13.33, 4.39]] }, 7: { katago: [10, 0.1, [27, null], [9.11, 9.13], [25.21, 5.49]], uct: [8, 0.25, [26.5, 0.71], [6.17, 8.08], [43.24, 9.01]] }, 9: { katago: [10, 0.2, [43, 1.41], [19.75, 16.69], [48.93, 19.42]], uct: [6, 0.333, [41.5, 0.71], [15.75, 12.69], [73.23, 13.34]] }, 13: { uct: [3, 0.333, [88, null], [43.5, 0.71], [149.67, 25.63]] } },
  Netburners: { 5: { model: [30, 1, [15.73, 4.23], null, [6.94, 1.47]] }, 7: { katago: [10, 0.9, [27.78, 4.79], [0, null], [16.67, 3.63]], uct: [8, 1, [27.75, 4.71], null, [27.39, 3.69]] }, 9: { katago: [10, 1, [44.5, 4.55], null, [30.38, 4.33]], uct: [6, 1, [43.67, 6.25], null, [50.54, 4.94]] }, 13: { uct: [3, 1, [82.33, 4.51], null, [108.8, 2.69]] } },
  SlumSnakes: { 5: { model: [30, 1, [19.7, 4.1], null, [9.33, 2.52]] }, 7: { katago: [20, 0.85, [27.82, 4.97], [12.67, 11.02], [22.2, 5.83]], uct: [8, 1, [27.75, 2.38], null, [27.59, 5.73]] }, 9: { katago: [10, 0.9, [41.44, 6.95], [31, null], [34.71, 6.15]], uct: [6, 1, [40.5, 3.73], null, [58.34, 6.11]] } },
  Tetrads: { 5: { model: [30, 1, [20.4, 3.84], [12, 2.83], [13.78, 3.95]] }, 7: { katago: [20, 0.8, [28.44, 3.05], [15.5, 5.57], [26.91, 4.83]], uct: [8, 1, [26.13, 1.96], null, [34.13, 4.26]] }, 9: { katago: [20, 0.9, [42.83, 4.58], [15.5, 21.92], [45.15, 5.71]], uct: [6, 0.833, [41.6, 4.93], [0, null], [72.46, 20.31]] }, 13: { katago: [3, 1, [85, 3.46], null, [95.81, 8.48]] } },
  TheBlackHand: { 5: { model: [30, 1, [17.5, 4.21], null, [12.52, 3.44]] }, 7: { katago: [10, 0.8, [26.5, 2.62], [6.5, 9.19], [23.17, 5.09]], uct: [8, 0.875, [26, 3.11], [0, null], [38.14, 17.16]] }, 9: { katago: [10, 1, [43.4, 8], null, [38.49, 7.11]], uct: [6, 0.667, [42.5, 2.38], [14.5, 6.36], [67.83, 5.76]] } },
}

/** The board sizes an opponent is offered at (the hidden opponent: its fixed 19x19). */
export const ARM_SIZES = [5, 7, 9, 13]

/** 'name@size' -> [name, size]. */
export function splitArm(key) {
  const i = String(key).lastIndexOf('@')
  return [String(key).slice(0, i), Number(String(key).slice(i + 1))]
}

/**
 * An arm's prior as the solver can play it NOW (`katagoOk`: a KataGo engine
 * answers — go.js katagoAvailable): the best-paying measured backend at the
 * prior means. { backend, k, p, bw: [m, sd], bl: [m, sd], s: [m, sd], pph }
 * or null (not measured: not offered).
 */
export function armPrior(name, size, katagoOk = true) {
  const by = ARM_PRIOR[name]?.[size]
  if (!by) return null
  const diff = difficultyMultiplier(OPPONENTS[name]?.komi ?? KOMI_OF[name], size)
  let best = null
  for (const [backend, [games, p0, bw0, bl0, s0]] of Object.entries(by)) {
    if (backend === 'katago' && !katagoOk) continue
    const p = size === MEASURED_BOARD && num(WIN_RATE[name]) ? WIN_RATE[name] : p0
    const bw = [bw0[0], num(bw0[1]) ? bw0[1] : 0.15 * bw0[0] + 1]
    const bl = bl0 ? [bl0[0], num(bl0[1]) ? bl0[1] : 0.3 * bw0[0] + 1] : [0.5 * bw0[0], 0.3 * bw0[0] + 1]
    const s = [s0[0], num(s0[1]) ? s0[1] : 0.25 * s0[0]]
    const k = size === MEASURED_BOARD ? THOMPSON.priorN : THOMPSON.armPriorN
    const pph = 3600 * armPowerPerSecond(p, bw[0], bl[0], s[0], diff)
    if (!best || pph > best.pph) best = { backend, k, games, p, bw, bl, s, diff, pph }
  }
  return best
}

/** Power per second at win rate p, mean black won/lost, seconds per game (the header's formula). */
export function armPowerPerSecond(p, bw, bl, secs, diff) {
  if (!num(p) || !num(bw) || !num(bl) || !num(secs) || secs <= 0) return null
  const m = steadyStreakMult(p)
  return (diff * (bw * (m - 0.5 * (1 - p)) + bl * 0.5 * (1 - p))) / secs
}

/**
 * Finished games an hour on an arm at its prior (ARM_PRIOR's best-paying backend: seconds a
 * game), for the favor an arm banks when no drawn rate is given. null when not measured.
 */
export function gamesPerHourOf(name, size) {
  const pr = armPrior(name, size)
  return pr && num(pr.s?.[0]) && pr.s[0] > 0 ? 3600 / pr.s[0] : null
}

/** getMaxRep() (Go/effects/effect.ts:30-43): the node's Go favor cap per opponent, rep-equivalent, by the SF14 level held. */
export function goMaxRepOf(sf14) {
  return sf14 >= 3 ? 400e3 : sf14 === 2 ? 300e3 : sf14 === 1 ? 200e3 : 100e3
}

/** The komi each opponent plays at (Go/Constants.ts opponentDetails), for the difficulty multiplier. */
export const KOMI_OF = { Netburners: 1.5, SlumSnakes: 3.5, TheBlackHand: 3.5, Tetrads: 5.5, Daedalus: 5.5, Illuminati: 7.5, w0r1d_d43m0n: 9.5 }

/** The version an arm's evidence must carry to count (goplan.solverVersion of the backend that plays it). */
export function armVersion(backend, release = SOLVER_RELEASE) {
  return `${backend}${backend === 'model' ? '-session' : ''}-${release}`
}

/** The solver release go.js expects (the solver names its own in every reply). */
export const SOLVER_RELEASE = 'r3'

/**
 * effect.ts:16-22 bonusPower, the channel each opponent feeds, and `game`:
 * the GoOpponent ENUM VALUE (Go/Enums.ts:1-10) — what ns.go.resetBoardState
 * accepts and what getStats() is keyed by. The keys here are identifiers;
 * two of them differ from the game's value ("The Black Hand", "Slum Snakes"),
 * and passing the key threw "goOpponent should be a GoOpponent enum member"
 * the first time the pricing chose TheBlackHand (2026-09-29, the farm down).
 * Always cross the boundary through gameName / keyOfGame.
 */
export const OPPONENTS = {
  Daedalus: { power: 1.1, channel: 'faction_rep', game: 'Daedalus' },
  Illuminati: { power: 0.7, channel: 'hacking_speed', game: 'Illuminati' },
  TheBlackHand: { power: 0.9, channel: 'hacking_money', game: 'The Black Hand' },
  SlumSnakes: { power: 1.2, channel: 'crime_success', game: 'Slum Snakes' },
  Netburners: { power: 1.3, channel: 'hacknet_node_money', game: 'Netburners' },
  Tetrads: { power: 0.7, channel: 'combat', game: 'Tetrads' },
  // THE HIDDEN OPPONENT. Not the w0r1d_d43m0n SERVER: this is a Go board, and
  // nothing here paths to, roots or backdoors that server (endgame.js alone
  // may). See THE HIDDEN OPPONENT below for every fact and its source line.
  w0r1d_d43m0n: { power: 2, channel: 'hacking', game: '????????????', board: 19, komi: 9.5, needs: 'The Red Pill' },
}

/** Our key for the hidden opponent (GoOpponent.w0r1d_d43m0n, Go/Enums.ts:9). */
export const W0 = 'w0r1d_d43m0n'

/** Our key -> the game's GoOpponent value (resetBoardState, getStats keys). Null for an unknown key. */
export function gameName(key) {
  return OPPONENTS[key]?.game ?? null
}

/** The game's GoOpponent value (or one of our keys) -> our key. Null when neither. */
export function keyOfGame(name) {
  if (typeof name !== 'string') return null
  if (OPPONENTS[name]) return name
  for (const [k, m] of Object.entries(OPPONENTS)) if (m.game === name) return k
  return null
}

/**
 * Measured win rate per opponent: every model arm at go.js's budget pooled
 * (2026-10-03 tune, 2026-10-04 control, pondered and session: 90-130 games each,
 * 5x5; tools/sim/go-study-report.mjs).
 * Used ONLY to price the win-streak state an opponent resumes from — the
 * steady-state effect of the win rate is already inside POWER_PER_HOUR.
 */
export const WIN_RATE = {
  Daedalus: 0.992,
  Illuminati: 0.977,
  TheBlackHand: 1,
  SlumSnakes: 0.983,
  Netburners: 0.989,
  Tetrads: 0.956,
}

/**
 * Only these three are visible to the augmentation basket (RATE_CHANNELS).
 * crime_success, the combat levels and hacknet_node_money are priced nowhere
 * the weights can see, so an opponent feeding them cannot be compared here and
 * is refused BY NAME rather than scored zero — zero would read as "worthless",
 * which is a different claim from "not priceable".
 */
export const PRICEABLE = ['faction_rep', 'hacking_speed', 'hacking_money']

/**
 * Priced when the weights carry it, skipped BY NAME when they do not.
 * goweights.js prices hacknet_node_money as the exit's sensitivity to hacknet
 * production until the next install (the life of a Go bonus), 0 with no
 * hacknet stream. combat (Tetrads) is priced on the Bladeburner route only —
 * goweights.bladeGoWeightsGen, the black-op exit's sensitivity to the combat
 * level multipliers; the hacking exit has no combat term, so there it is
 * absent and skipped by name.
 */
export const OPTIONAL = ['hacknet_node_money', 'combat']

const num = (v) => typeof v === 'number' && isFinite(v)

/** effect.ts:16-22, transcribed. */
export function effectAt(nodes, bonusPower, goPower = 1, sf14 = 0) {
  if (!num(nodes) || nodes < 0 || !num(bonusPower)) return null
  return 1 + Math.log(nodes + 1) * Math.pow(nodes + 1, 0.3) * 0.002 * bonusPower * goPower * (sf14 ? 2 : 1)
}

/** Time-average of effect() over one install window, by Simpson's rule. */
export function meanEffect(powerPerHour, bonusPower, hours, goPower = 1, sf14 = 0) {
  if (!num(powerPerHour) || powerPerHour < 0 || !num(hours) || hours <= 0) return null
  const STEPS = 400
  let acc = 0
  for (let i = 0; i <= STEPS; i++) {
    const t = (hours * i) / STEPS
    const w = i === 0 || i === STEPS ? 1 : i % 2 ? 4 : 2
    const e = effectAt(powerPerHour * t, bonusPower, goPower, sf14)
    if (e === null) return null
    acc += w * e
  }
  return (acc * (hours / STEPS)) / 3 / hours
}

/** effect.ts:132-135, transcribed: the 5x5-vs-Illuminati case is 8, not 2. */
export function difficultyMultiplier(komi, boardSize) {
  if (!num(komi) || !num(boardSize)) return null
  return boardSize === 5 && komi === 7.5 ? 8 : (komi + 0.5) * 0.25
}

/** d effect / dn, the derivative of effectAt at `nodes`. */
export function effectSlope(nodes, bonusPower, goPower = 1, sf14 = 0) {
  if (!num(nodes) || nodes < 0 || !num(bonusPower)) return null
  const x = nodes + 1
  // d/dn [ln(x) * x^0.3] = x^-0.7 * (1 + 0.3 ln x)
  return Math.pow(x, -0.7) * (1 + 0.3 * Math.log(x)) * 0.002 * bonusPower * goPower * (sf14 ? 2 : 1)
}

/**
 * nodePower from the bonus getStats() publishes. getStats exposes only
 * bonusPercent = (CalculateEffect(nodePower) - 1) * 100
 * (netscriptGoImplementation.ts:378-396); effect() is strictly increasing,
 * so it inverts exactly by bisection. Returns null on an unreadable input,
 * never 0 — "unknown" and "nothing banked" are different values.
 */
export function nodePowerFromBonus(bonusPct, bonusPower, goPower = 1, sf14 = 0) {
  if (!num(bonusPct) || bonusPct < 0 || !num(bonusPower) || bonusPower <= 0) return null
  if (bonusPct === 0) return 0
  const target = 1 + bonusPct / 100
  let lo = 0
  let hi = 1
  while (effectAt(hi, bonusPower, goPower, sf14) < target) {
    hi *= 2
    if (hi > 1e30) return null
  }
  for (let i = 0; i < 200 && hi - lo > 1e-9 * Math.max(1, hi); i++) {
    const mid = (lo + hi) / 2
    if (effectAt(mid, bonusPower, goPower, sf14) < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

// ---------------------------------------------------------------------------
// THE WIN STREAK ACROSS A SWITCH — paused, never reset, and priced.
//
// Go.stats is per opponent. endGoGame (boardAnalysis/scoring.ts:46-89) and
// resetWinstreak (:118-128) only ever touch the stats of `boardState.ai`, the
// opponent the finished game was against. resetBoardState to a NEW opponent
// calls resetWinstreak only when the old game is still in progress
// (netscriptGoImplementation.ts:364-366), and go.js switches only at a game
// boundary. So a switch PAUSES both streaks: the incumbent's resumes where it
// was when play returns, and the challenger resumes from its own paused
// streak (0 if never played this life; prestigeAugmentation zeroes them).
//
// That is a real, bounded switching cost: the next games against the
// challenger earn at ITS streak multiplier (getWinstreakMultiplier,
// effect.ts:119-130: 0.5 while losing, 1+0.25*min(s,8) on a run, up to
// 1+0.5*min(dry,8) for breaking a dry streak), not at the steady state the
// measured rate averages over. streakFactor prices it: expected mean
// multiplier over the committed dwell from the opponent's current streak,
// over the steady-state mean at its measured win rate. The state is the
// current winStreak alone — oldWinStreak is overwritten by it before the next
// game's multiplier is taken (scoring.ts:60-61, :121).

const S_MAX = 8 // min(s, 8) and min(dry, 8): nothing beyond 8 changes the multiplier

/** One game from streak s: [nextStreak, multiplier] on a win and on a loss. */
export function streakStep(s, won) {
  if (won) {
    const next = s < 0 ? 1 : s + 1
    const mult = s < 0 ? 1 + 0.5 * Math.min(-s, S_MAX) : 1 + 0.25 * Math.min(next, S_MAX)
    return [Math.min(next, S_MAX), mult]
  }
  return [Math.max(s >= 0 ? -1 : s - 1, -S_MAX), 0.5]
}

/** Expected multiplier of each of the next K games from streak s0, at win rate p. */
function streakPath(p, s0, K) {
  let dist = new Map([[Math.max(-S_MAX, Math.min(S_MAX, s0)), 1]])
  const out = []
  for (let k = 0; k < K; k++) {
    const next = new Map()
    let em = 0
    for (const [s, pr] of dist) {
      for (const [won, q] of [[true, p], [false, 1 - p]]) {
        if (!(q > 0)) continue
        const [s2, m] = streakStep(s, won)
        em += pr * q * m
        next.set(s2, (next.get(s2) ?? 0) + pr * q)
      }
    }
    out.push(em)
    dist = next
  }
  return out
}

/** Steady-state mean multiplier at win rate p (the chain mixes well inside 400 games). */
export function steadyStreakMult(p) {
  if (!num(p) || p < 0 || p > 1) return null
  const path = streakPath(p, 0, 600)
  const tail = path.slice(200)
  return tail.reduce((a, b) => a + b, 0) / tail.length
}

/**
 * Expected power over the next K games from streak s0, relative to the
 * steady state the measured rate describes. 1 = no switching cost.
 */
export function streakFactor(p, s0, K) {
  if (!num(p) || p < 0 || p > 1 || !num(s0) || !num(K) || K < 1) return null
  const path = streakPath(p, s0, Math.round(K))
  const ss = steadyStreakMult(p)
  return path.reduce((a, b) => a + b, 0) / path.length / ss
}

/** The board size POWER_PER_HOUR was measured at. */
export const MEASURED_BOARD = 5

/**
 * The choice: MARGINAL pricing against each opponent's CURRENT node power.
 *
 * WHAT A SWITCH COSTS — NOTHING BANKED. This used to refuse any switch once
 * the incumbent's bonus passed 1%, on the model that "switching discards it".
 * That model was false, and it held a BN9 life on Daedalus at +67% faction_rep
 * with faction_rep weighing 0 in the objective. From game source:
 *
 *   - Go.stats is per opponent, and nodePower is zeroed ONLY by
 *     Go.prestigeAugmentation (Go/Go.ts:25-47) — an install, not a switch.
 *   - updateGoMults -> calculateMults (Go/effects/effect.ts:59-101) applies
 *     EVERY opponent's CalculateEffect(nodePower) at once. Daedalus's bonus
 *     keeps paying while we play Illuminati.
 *   - resetStats leaves nodePower alone; winStreak is per opponent and only
 *     pauses while another opponent is played.
 *
 * So the next game should go wherever the NEXT unit of node power buys the
 * most objective. The objective is sum_c w_c * ln(mult_c), w_c the exit hours
 * one ln of the Go bonus on channel c saves over the bonus's life
 * (goweights.js), so per opponent o:
 *
 *     marginal_o = w_o * (d ln E_o / dn)(n_o) * rate_o
 *                = w_o * E'_o(n_o) / E_o(n_o) * rate_o        [ln-objective / hour]
 *
 * with n_o the opponent's CURRENT nodePower (nodePowerFromBonus over
 * getStats) and rate_o its measured node power per hour, which already folds
 * in board size, the difficulty multiplier (8 for 5x5 Illuminati, effect.ts:
 * 132-135), the win-streak multiplier and the win rate — that is what the
 * 60-game arms measured. How long the gained power lasts (until the next
 * install) is the same for every opponent, so it cancels out of the argmax.
 * E is concave, so the argmax spreads play: every game against o lowers o's
 * own marginal until another opponent leads.
 *
 * HYSTERESIS IS PRICED, NOT A VETO. A switch commits to a minimum dwell
 * (go.js holds `dwellH` of play before re-pricing). The switch is made only
 * if that committed block is worth more on the challenger than the same block
 * on the incumbent, each from its own current power:
 *
 *     gain_o(D) = w_o * [ln E_o(n_o + rate_o*D) - ln E_o(n_o)]
 *
 * Staying when gain_best(D) <= gain_incumbent(D) has zero expected regret over
 * the block; switching when it is larger cannot be undone profitably inside
 * it. NOT PRICED: the win-streak ramp on an opponent whose paused streak is
 * short. The measured rates are steady-state averages; the ramp is a few
 * games and returns when play comes back (streaks pause, they do not reset).
 *
 * @param {object} o
 * @param {object} o.weights    the Go bonus's channel weights (goweights.js via progress.js
 *                              objective.goWeights: exit hours per ln, the multiplier on the
 *                              stream it moves, until the next install). REQUIRED. Not
 *                              objective.weights — those price an augmentation (whole income,
 *                              every later life). Any consistent unit ranks the same.
 * @param {number} o.windowH    hours in one install window. REQUIRED — a Go bonus is
 *                              destroyed by every install, so without a window it has no price.
 * @param {string} o.incumbent  the opponent currently being played.
 * @param {object} o.nodePower  { opponent: current nodePower }. REQUIRED; 0 for one never
 *                              played this life. Build it with nodePowerFromBonus.
 * @param {number} [o.dwellH]   the committed minimum dwell, hours. 0/absent = pure marginal.
 * @param {number} [o.dwellGames] the same dwell in games — the streak horizon.
 * @param {object} [o.streaks]  { opponent: current winStreak } from getStats. Absent =
 *                              streak cost not priced (said so in `why`).
 * @param {number} [o.boardSize] the board being played; the rate table is 5x5 only.
 * @param {number} [o.goPower]  currentNodeMults.GoPower (4 in BitNode 14).
 * @param {number} [o.sf14]     Source-File 14 level; >=1 doubles the effect.
 * @param {object} [o.powerPerHour] override the measured table (tests; go.js adds the
 *                              hidden opponent's measured-or-prior rate).
 * @param {object} [o.winRates]  { opponent: win rate } — a THOMPSON DRAW (drawWinRates).
 *                              Absent: the point estimates (WIN_RATE), as before.
 * @param {object} [o.refWinRates] { opponent: the win rate its powerPerHour was measured
 *                              at }. Absent: WIN_RATE, and W0_PRIOR.refP for the hidden one.
 * @param {boolean} [o.redPill] The Red Pill INSTALLED (w0Eligible): the hidden opponent
 *                              exists. Absent/false: it is skipped by name.
 * @param {object} [o.arms]     RELEASE 3a: { 'name@size': { pph, p } } — every opponent x
 *                              board-size arm on offer with its DRAWN power/hour and win rate
 *                              (go.js: armDraw). Replaces the table, the board-size check and
 *                              the win-rate rescaling; the choice is then an ARM, and
 *                              `size` / `arm` say which.
 * @param {string} [o.incumbentArm] the arm being played ('name@size'), with o.arms.
 * @param {object} [o.favor]    THE EXIT FACTION'S GO FAVOR (goweights favorWeightGen, in the
 *                              same exit hours as the weights): { opponent, hoursPerRep,
 *                              capLeft, maxRep }. An arm against that opponent also banks
 *                              favor — every even win of a streak, getMaxRep()/200
 *                              rep-equivalent, until the node's cap (scoring.ts:66-78) — at
 *                              games/h x p^2/(1+p) x maxRep/200 (favor.goFavorStreamOf;
 *                              games/h: the arm's drawn seconds a game, `gph`, else its
 *                              prior's). Added to that arm's marginal, and to its dwell block
 *                              up to the cap left. Absent: favor not priced (said in `why`).
 * @returns {{opponent, size, arm, why, refused, table}}
 */
// ---------------------------------------------------------------------------
// THE CHEAT CHANNEL. With go.cheat on (go.js SETTINGS.cheat.on), crime_success
// is not an unpriced channel: it multiplies the cheat success chance
// (netscriptGoImplementation.ts:557-566, min(1, 0.6 (0.7-0.02k)^k x
// crime_success [+0.25 at SF14.3])), so it raises the FARM's own power/h.
// Slum Snakes feeds crime_success (effect.ts: bonusPower 1.2), so a few of its
// games buy the farm a faster rate for the rest of the life.
//
// CHEAT_GAIN: the farm's live power/h with cheats, as a multiple of its rate
// without, by crime_success. MEASURED 2026-10-06 (tools/sim/go-w0.mjs --cheat
// predicted --cheatwait 0.5, Tetrads 5x5, the live config, seed 58, 100 games
// per arm paired against one no-cheat arm, 0 losses in any arm):
//   second stone 400ms: 1.5872 +8.0%  2.5 +12.6%  4 +10.8%  6.4 +15.5%  10 +16.8%
//   second stone 100ms (go.js SETTINGS.cheat.secondMs, live): 1.5872 +14.6%  2.5 +17.4%
// The table is the 100ms curve to 2.5 and the 400ms arms' shape beyond
// (x1.037 from 2.5 to 10: one fitted segment, the 4.0 dip is inside the noise).
// [1, 1] is NOT measured at today's config (release 3: ~+1% at crime 1).
// Interpolated linearly in ln(crime_success), flat beyond the ends; used ONLY
// as a slope — d ln(gain)/d ln(crime).
export const CHEAT_GAIN = [
  [1, 1],
  [1.5872, 1.146],
  [2.5, 1.174],
  [10, 1.217],
]

/** d ln(CHEAT_GAIN)/d ln(crime) at `crime` (0 outside the table or on a falling segment). */
export function cheatElasticity(crime, table = CHEAT_GAIN) {
  if (!num(crime) || crime <= 0 || !Array.isArray(table) || table.length < 2) return 0
  for (let i = 0; i + 1 < table.length; i++) {
    const [c0, g0] = table[i]
    const [c1, g1] = table[i + 1]
    if (crime >= c0 && crime < c1) {
      const e = (Math.log(g1) - Math.log(g0)) / (Math.log(c1) - Math.log(c0))
      return e > 0 ? e : 0
    }
  }
  return 0
}

export function chooseOpponent(o = {}) {
  const { weights, windowH, incumbent } = o
  const goPower = num(o.goPower) && o.goPower > 0 ? o.goPower : 1
  const sf14 = num(o.sf14) ? o.sf14 : 0
  const table = { [W0]: W0_PRIOR.powerPerHour, ...(o.powerPerHour ?? POWER_PER_HOUR) }
  const refs = { ...WIN_RATE, [W0]: W0_PRIOR.refP, ...(o.refWinRates ?? {}) }
  const drawn = o.winRates && typeof o.winRates === 'object' ? o.winRates : null
  const dwellH = num(o.dwellH) && o.dwellH > 0 ? o.dwellH : 0
  const boardSize = num(o.boardSize) ? o.boardSize : MEASURED_BOARD
  const arms = o.arms && typeof o.arms === 'object' ? o.arms : null
  const incArm = arms ? o.incumbentArm ?? null : null
  const keep = (why) => ({ opponent: incumbent ?? null, ...(arms ? { arm: incArm, size: incArm ? splitArm(incArm)[1] : null } : {}), why, refused: true, table: null })

  // EVERY REFUSAL IS NAMED. An unreadable input must never read as a verdict:
  // the incumbent stands and the reason is published.
  if (!weights || typeof weights !== 'object') {
    return keep('no derived channel weights — a flat-weights pass cannot tell the channels apart, so the incumbent stands')
  }
  if (!num(windowH) || windowH <= 0) {
    return keep('no measured install window — the Go bonus is destroyed by every install, so its value cannot be priced without one')
  }
  if (!o.nodePower || typeof o.nodePower !== 'object') {
    return keep('no current nodePower per opponent — the marginal value of a game depends on what is already banked')
  }
  if (!arms && boardSize !== MEASURED_BOARD) {
    return keep(`the power/hour table is measured at ${MEASURED_BOARD}x${MEASURED_BOARD} and this board is ${boardSize}x${boardSize} — no rate to price with`)
  }

  const dwellGames = num(o.dwellGames) && o.dwellGames >= 1 ? o.dwellGames : null
  // o.cheat: { on: [opponents with cheats on], crime: current crime_success,
  // lifeLeftH: hours to the next install, table?: CHEAT_GAIN override }.
  const cheatIn = o.cheat && typeof o.cheat === 'object' && Array.isArray(o.cheat.on) && num(o.cheat.crime) && o.cheat.crime > 0 && num(o.cheat.lifeLeftH) && o.cheat.lifeLeftH > 0 ? o.cheat : null
  const cheatCands = []
  const streaks = o.streaks && typeof o.streaks === 'object' ? o.streaks : null
  const fav = o.favor && typeof o.favor === 'object' && num(o.favor.hoursPerRep) && o.favor.hoursPerRep > 0 && num(o.favor.capLeft) && o.favor.capLeft > 0 && num(o.favor.maxRep) && o.favor.maxRep > 0 ? o.favor : null
  const skipped = []
  const scored = []
  // The candidates: one per opponent at this board, or (release 3a) one per
  // opponent x size arm with its drawn rate.
  const cands = arms
    ? Object.entries(arms).map(([key, a]) => {
        const [name, size] = splitArm(key)
        return { name, size, key, meta: OPPONENTS[name], arm: a }
      })
    : Object.entries(OPPONENTS).map(([name, meta]) => ({ name, size: name === W0 ? 19 : boardSize, key: name, meta, arm: null }))
  for (const { name, size, key, meta, arm } of cands) {
    if (!meta) {
      skipped.push(`${key} (unknown opponent)`)
      continue
    }
    if (name === W0 && o.redPill !== true) {
      skipped.push(`${name} (${meta.channel}: not discovered — needs The Red Pill INSTALLED, netscriptGoImplementation.ts:359)`)
      continue
    }
    const optional = OPTIONAL.includes(meta.channel) || name === W0
    // crime_success is priced only through the cheat channel (o.cheat), below.
    const cheatChannel = meta.channel === 'crime_success' && cheatIn !== null
    // ONLY THE MEASURED BOARD. The cheat channel is a MEASURED 5x5 effect
    // (CHEAT_GAIN), and the crime_success it pays for is bought fastest and
    // safest on 5x5 Slum Snakes. Live 2026-10-06 23:34Z it credited every
    // size and a thin Thompson draw picked SlumSnakes@9 on KataGo: four
    // straight losses (0-74.5 ...). Other sizes stay unpriced, as before.
    if (cheatChannel && size !== MEASURED_BOARD) {
      skipped.push(`${key} (crime_success: the cheat channel is priced on ${MEASURED_BOARD}x${MEASURED_BOARD} only)`)
      continue
    }
    if (cheatChannel) {
      const measured = arm ? arm.pph : table[name]
      if (!num(measured) || measured <= 0) {
        skipped.push(`${key} (power/hour ${measured}: nothing to price)`)
        continue
      }
      const n = o.nodePower[name] ?? 0
      const e = effectAt(n, meta.power, goPower, sf14)
      const slope = effectSlope(n, meta.power, goPower, sf14)
      const p = arm ? arm.p : drawn && num(drawn[name]) ? drawn[name] : refs[name]
      const pph = measured * (arm || p === refs[name] ? 1 : rateScale(p, refs[name]) ?? 1)
      const eD = effectAt(n + pph * dwellH, meta.power, goPower, sf14)
      cheatCands.push({ name, size, key, channel: meta.channel, weight: 0, nodePower: n, effect: e, slope, eD, streak: null, streakFactor: 1, winRate: p, powerPerHour: pph, favorPerH: 0, favorMarginal: 0 })
      continue
    }
    if (!PRICEABLE.includes(meta.channel) && !optional) {
      skipped.push(`${name} (${meta.channel}: no exit weight)`)
      continue
    }
    const w = weights[meta.channel]
    if (optional && (w === undefined || w === null)) {
      skipped.push(`${name} (${meta.channel}: objective carries no weight this pass)`)
      continue
    }
    if (!num(w) || w < 0) return keep(`weight for ${meta.channel} is unreadable — refusing rather than ranking on a partial basket`)
    const measured = arm ? arm.pph : table[name]
    if ((name === W0 || arm) && !(num(measured) && measured > 0)) {
      skipped.push(`${key} (power/hour ${measured}: nothing to price)`)
      continue
    }
    if (!num(measured) || measured <= 0) return keep(`no measured power/hour for ${name}`)
    // The next dwell earns at this opponent's own paused streak, not the
    // steady state: the switching cost, priced (see streakFactor).
    // THE WIN RATE: the Thompson draw when one is given, else the point
    // estimate. The measured rate is rescaled from the win rate it was
    // measured at to this one (rateScale) — that is how a draw moves the price.
    // An arm's draw is already power per hour at its drawn win rate (armDraw).
    const ref = arm ? arm.p : refs[name]
    const p = arm ? arm.p : drawn && num(drawn[name]) ? drawn[name] : ref
    if (!num(p) || p < 0 || p > 1) return keep(`no win rate for ${key}`)
    const scale = p === ref ? 1 : rateScale(p, ref)
    if (!num(scale)) return keep(`could not rescale ${name}'s rate to win rate ${p}`)
    const s0 = streaks ? streaks[name] ?? 0 : null
    const phi = streaks && dwellGames && num(s0) ? streakFactor(p, s0, dwellGames) : 1
    if (!num(phi)) return keep(`could not price ${name}'s streak (winStreak ${s0})`)
    const pph = measured * scale * phi
    const n = o.nodePower[name] ?? 0
    if (!num(n) || n < 0) return keep(`nodePower for ${name} is unreadable (${o.nodePower[name]})`)
    const e = effectAt(n, meta.power, goPower, sf14)
    const slope = effectSlope(n, meta.power, goPower, sf14)
    if (e === null || slope === null) return keep(`could not price ${name}`)
    const eD = effectAt(n + pph * dwellH, meta.power, goPower, sf14)
    // The favor this arm banks, when it is the exit faction's (o.favor).
    let favorPerH = 0
    if (fav && fav.opponent === name) {
      const gph = arm && num(arm.gph) && arm.gph > 0 ? arm.gph : gamesPerHourOf(name, size)
      if (num(gph)) favorPerH = gph * ((p * p) / (1 + p)) * (fav.maxRep / 200)
    }
    const favorMarginal = favorPerH > 0 ? fav.hoursPerRep * favorPerH : 0
    const marginal = w * (slope / e) * pph + favorMarginal
    const block = w * (Math.log(eD) - Math.log(e)) + (favorPerH > 0 ? fav.hoursPerRep * Math.min(fav.capLeft, favorPerH * dwellH) : 0)
    scored.push({ name, size, key, channel: meta.channel, weight: w, nodePower: n, effect: e, streak: s0, streakFactor: phi, winRate: p, powerPerHour: pph, favorPerH, favorMarginal, marginal, block })
  }
  // THE CHEAT CHANNEL'S PRICE (o.cheat). A unit of Slum Snakes node power
  // raises ln(crime_success) by E'/E; the farm f (the best arm with cheats on)
  // then earns d ln(rate) = elasticity x that, for the rest of the life, and
  // each unit of its power is worth f's own marginal/pph_f — so
  //   marginal_SS = marginal_f x elasticity(crime) x lifeLeftH x (E'_SS/E_SS) x pph_SS
  // (marginal_f x lifeLeftH x d ln rate: the extra farm power over the life,
  // priced at f's current marginal — an upper bound as f's own E is concave).
  if (cheatIn && cheatCands.length) {
    // The farm: the best cheat-on arm on the board CHEAT_GAIN was measured on.
    const farm = scored.filter((s) => cheatIn.on.includes(s.name) && s.size === MEASURED_BOARD).sort((a, b) => b.marginal - a.marginal)[0] ?? null
    const eps = cheatElasticity(cheatIn.crime, cheatIn.table ?? CHEAT_GAIN)
    for (const c of cheatCands) {
      const dlnPerPower = c.slope !== null && c.effect ? c.slope / c.effect : 0
      const perH = farm && farm.marginal > 0 ? farm.marginal * eps * cheatIn.lifeLeftH : 0
      const marginal = perH * dlnPerPower * c.powerPerHour
      const dlnBlock = c.eD && c.effect ? Math.log(c.eD) - Math.log(c.effect) : 0
      // The dwell block: the crime gained over the block, paying for the life left after it.
      const block = farm && farm.marginal > 0 ? farm.marginal * eps * Math.max(0, cheatIn.lifeLeftH - dwellH) * dlnBlock : 0
      scored.push({ ...c, marginal, block, cheat: { farm: farm?.key ?? null, elasticity: eps, crime: cheatIn.crime, lifeLeftH: cheatIn.lifeLeftH } })
    }
  } else if (cheatCands.length) skipped.push(...cheatCands.map((c) => `${c.key} (crime_success: priced only through cheats — none on)`))
  if (!scored.length) return keep('no priceable opponent')

  scored.sort((a, b) => b.marginal - a.marginal)
  const best = scored[0]
  const fmt = (s) => `${s.key} ${s.marginal.toExponential(2)}/h @n=${Math.round(s.nodePower)}`
  const runners =
    scored.slice(1).map(fmt).join(', ') +
    (skipped.length ? `; not priced: ${skipped.join(', ')}` : '') +
    (streaks && dwellGames ? '' : '; streak cost NOT priced (no streaks/dwellGames)') +
    (fav ? '' : `; exit-faction Go favor ${o.favor ? `not priced (${o.favor.why ?? `hoursPerRep ${o.favor.hoursPerRep}, cap left ${o.favor.capLeft}`})` : 'NOT PRICED (no favor weight)'}`)
  // Every weight zero means the basket says nothing; do not churn the board on it.
  if (!(best.marginal > 0)) {
    return keep(`every priceable channel weighs 0 (${scored.map((s) => `${s.channel}=${s.weight}`).join(', ')}) — nothing to choose between, so the incumbent stands`)
  }
  const head =
    `${best.key} (${best.channel}) marginal ${best.marginal.toExponential(3)}/h = weight ${best.weight.toPrecision(3)} x dlnE/dn ` +
    `${(best.weight > 0 ? (best.marginal - best.favorMarginal) / best.weight / best.powerPerHour : 0).toExponential(3)} @n=${Math.round(best.nodePower)} x ${Math.round(best.powerPerHour)}/h` +
    (best.favorMarginal > 0 ? ` + favor ${best.favorMarginal.toExponential(3)}/h (${Math.round(best.favorPerH)} rep-eq/h of ${fav.opponent}'s Go favor x ${fav.hoursPerRep.toExponential(3)} h/rep, ${Math.round(fav.capLeft)} left)` : '') +
    (best.streakFactor !== 1 ? ` (streak ${best.streak}: x${best.streakFactor.toFixed(3)} of ${arms ? 'the drawn' : 'the measured'} ${Math.round(arms ? arms[best.key].pph : table[best.name])})` : '') +
    (arms ? ` [Thompson: power/h and win rate ${best.winRate.toFixed(3)} drawn]` : drawn ? ` [Thompson: win rate drawn ${best.winRate.toFixed(3)}]` : '') +
    (best.cheat ? ` [cheat channel: crime_success ${best.cheat.crime.toFixed(3)} lifts ${best.cheat.farm}'s cheat rate, elasticity ${best.cheat.elasticity.toFixed(3)} over ${best.cheat.lifeLeftH.toFixed(2)}h left]` : '')
  const incKey = arms ? incArm : incumbent
  const inc = scored.find((s) => s.key === incKey)
  const out = (s) => (arms ? { opponent: s.name, size: s.size, arm: s.key } : { opponent: s.name })
  if (best.key !== incKey && inc && dwellH > 0 && !(best.block > inc.block)) {
    return {
      ...out(inc),
      why:
        `${head}, but over the committed ${(dwellH * 60).toFixed(1)}-min dwell ${best.key} gains ${best.block.toExponential(3)} ` +
        `vs ${incKey} ${inc.block.toExponential(3)} (concavity) — staying; runners-up ${runners}`,
      refused: false,
      table: scored,
    }
  }
  const why =
    head +
    (best.key !== incKey && inc && dwellH > 0 ? `; dwell block ${best.block.toExponential(3)} > ${incKey} ${inc.block.toExponential(3)}` : '') +
    `; runners-up ${runners}`
  return { ...out(best), why, refused: false, table: scored }
}

// ---------------------------------------------------------------------------
// THE EARLY-GAME WEIGHTS: what the current life can use, before progress.js.
//
// chooseOpponent needs channel weights, and until this existed the only
// source was progress.js's goWeights (installgate.txt objective.goWeights).
// progress.js needs a 13 + 6.25 x mult GB block on home and the watchdog's
// job runner (64GB), so a fresh node at 32GB has no planner. The gate on home
// is the PREVIOUS life's, rejected as "from another life", and chooseOpponent
// refused, so the incumbent stood. Live BN14.1 (2026-10-03 19:02Z): the Go node
// (GoPower x4) played Daedalus (faction_rep) by inertia, with no faction
// joined and $18/s of income.
//
// WHAT TO PRICE. A Go bonus is a STOCK: node power banked now pays from now
// until the next install (Go.ts:34-47), on the channel it feeds. Power on a
// channel the life is not using yet can be banked later at the same value,
// while power on the leg the life is on NOW starts paying now. So the price
// is the current bottleneck. Each weight is the elasticity of a LIVE leg's
// rate to the channel's multiplier (goweights.js's elasticities), read from
// cheap telemetry:
//
//   hacking_speed       x the hack share of measured income. Every H/G/W time scales as
//                       1/speed (Hacking.ts:75), so a RAM-bound worker loop (early.js,
//                       hgw.js, the batcher) cycles its RAM, and earns, that much faster
//   hacking_money       x the hack share x HACK_SIDE. Only the hack side of the loop gets
//                       richer; the grow and weaken sides are unchanged (goweights' hackShare)
//   hacknet_node_money  x the hacknet share of measured income (HacknetHelpers.tsx:414)
//   faction_rep         1 while the work slot is on faction or company work, the leg the first
//                       augmentation batch waits on (Daedalus also feeds company_rep)
//   combat              only on the Bladeburner route (the division exists and no plan in this
//                       node has decided 'hack': actplan 0b presumes it from the first minute).
//                       Before the join, the bar is the leg, and a level multiplier m cuts the
//                       exp to level L by d ln exp / d ln m = L / (32 m)
//                       (skill.ts: level = m (32 ln(exp + 534.6) - 200)), which is 6.25 at
//                       the 100 bar in BN14 (level multiplier 0.5). After the join it is 1:
//                       action success and rank scale with the stats (assumed elasticity 1)
//
// This is a RANKING. The unit is "ln of a live leg's rate per ln of the
// multiplier", not exit hours. NOT PRICED (floors, named): the hacking exp
// that hacking_speed also speeds (the level gates targets and joins), and
// crime_success (Slum Snakes), because crime money is not in the income
// readings. Once progress.js publishes goWeights for this life, they replace
// this entirely (go.js pickOpponent).

/**
 * Constants of the early pricing. hackSide: the hack side's share of a worker
 * loop's threads (ASSUMED, not measured; goweights takes batch.txt's measured
 * share once the batcher runs). combatBar: the division's join bar
 * (actplan's `bar`). windowH: chooseOpponent only checks this is positive, so
 * the value is inert. It is not a life estimate.
 */
export const EARLY = { hackSide: 0.25, combatBar: 100, windowH: 8 }

/**
 * Channel weights for chooseOpponent from what the current life is doing.
 *
 * @param {object} o
 * @param {number|null} o.hackIncome     $/s the hacking workers earn (batch.txt earnedPerSec, else
 *                                       status.txt incomePerSec), null if unmeasured
 * @param {number|null} o.hacknetIncome  $/s from hacknet (hacknet.txt moneyPerSec), null if unmeasured
 * @param {string|null} o.work           what the work slot is doing: 'faction' | 'company' | 'crime' |
 *                                       'gym' | 'bladeburner' | ... | null
 * @param {object} [o.blade]             { open, route: 'blade'|'hack'|null, joined }
 * @param {object} [o.nodeMults]         the BitNode table (bitNodeMults): the combat level multipliers
 * @returns {{weights, windowH, phase, why}}
 */
export function earlyGoWeights(o = {}) {
  const h = num(o.hackIncome) && o.hackIncome > 0 ? o.hackIncome : 0
  const n = num(o.hacknetIncome) && o.hacknetIncome > 0 ? o.hacknetIncome : 0
  const tot = h + n
  // No income measured yet: the first income a life has is the hacking worker.
  const sh = tot > 0 ? h / tot : 1
  const sn = tot > 0 ? n / tot : 0
  const legs = []
  const weights = {
    hacking_speed: sh,
    hacking_money: sh * EARLY.hackSide,
    hacknet_node_money: sn,
    faction_rep: 0,
  }
  legs.push(tot > 0 ? `income (hack ${Math.round(100 * sh)}% of $${tot.toFixed(1)}/s, hacknet ${Math.round(100 * sn)}%)` : 'income (unmeasured: the hacking worker)')
  const rep = o.work === 'faction' || o.work === 'company'
  if (rep) {
    weights.faction_rep = 1
    legs.push(`reputation (${o.work} work)`)
  }
  const b = o.blade
  if (b?.open === true && b.route !== 'hack') {
    if (b.joined === true) {
      weights.combat = 1
      legs.push('Bladeburner actions (combat, after the join)')
    } else {
      const m = o.nodeMults
      const lv = [m?.StrengthLevelMultiplier, m?.DefenseLevelMultiplier, m?.DexterityLevelMultiplier, m?.AgilityLevelMultiplier].filter((x) => num(x) && x > 0)
      const mult = lv.length ? lv.reduce((a, x) => a + x, 0) / lv.length : 1
      weights.combat = EARLY.combatBar / (32 * mult)
      legs.push(`the combat bar ${EARLY.combatBar} for the Bladeburner ${b.route === 'blade' ? 'route' : 'route (presumed)'}: d ln exp/d ln m = ${weights.combat.toFixed(2)}`)
    }
  }
  const fmt = Object.entries(weights).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(', ')
  return { weights, windowH: EARLY.windowH, phase: legs.join(' + '), why: `early-game weights, live legs: ${legs.join(' + ')} -> ${fmt}` }
}

/**
 * Which weights price the next choice. progress.js's goWeights when the gate
 * is THIS life's and carries them; otherwise the early-game weights, which
 * replace the old refusal ("the incumbent stands"). `earlyInputs` is a thunk
 * so the telemetry is read only when it is needed.
 *
 * @returns {{source: 'goWeights'|'early', weights, windowH, why, phase?}}
 */
export function weightsFor(gate, lastAugReset, earlyInputs) {
  const sameLife = !!gate && gate.lastAugReset === lastAugReset
  const gw = sameLife ? gate?.objective?.goWeights ?? null : null
  if (gw?.weights) return { source: 'goWeights', weights: gw.weights, favor: gw.favor ?? null, windowH: gw.windowH ?? gate?.objective?.windowH ?? null, why: gw.why ?? null }
  const gwWhy = !gate ? 'no gate' : !sameLife ? 'gate is from another life' : gw?.why ?? 'not published this pass'
  const e = earlyGoWeights(typeof earlyInputs === 'function' ? earlyInputs() : earlyInputs ?? {})
  return { source: 'early', weights: e.weights, windowH: e.windowH, phase: e.phase, why: `${e.why} (goWeights: ${gwWhy})`, gwWhy }
}

// ---------------------------------------------------------------------------
// THOMPSON SAMPLING OVER THE WIN RATES.
//
// WIN_RATE and POWER_PER_HOUR are one study's point estimates (60 games per
// arm, one solver build). The bot's strength moves with the solver, so the
// rate an opponent yields is a belief, and a point estimate never revisits a
// board it once priced low. Each opponent (per board size: the hidden one is
// always 19x19) carries a Beta posterior on its win rate:
//
//   prior     Beta(k p0, k (1-p0)), p0 = WIN_RATE (today's point), k =
//             THOMPSON.priorN — so with no evidence the draws centre where the
//             fixed estimates stood and behaviour starts where it was.
//             The hidden opponent: Beta(1, 1) — never played, so WIDE.
//   evidence  every finished game, decayed by THOMPSON.decay per game on that
//             arm (half-life ~34 games): the solver changes, old games fade.
//   choice    per GAME BOUNDARY (never per move): one draw per arm
//             (Beta = Ga(a)/(Ga(a)+Ga(b)), Marsaglia-Tsang — microseconds),
//             then the SAME marginal pricing as before on the drawn rates.
//
// HOW A DRAWN WIN RATE MOVES THE PRICE (rateScale). The measured power/hour
// was taken at the study's win rate; a game's power is score x difficulty x
// the win-streak multiplier (scoring.ts:86-89), and the streak multiplier is
// the term the win rate drives (0.5 while losing to 3x on a run, effect.ts:
// 119-130). So the rate is rescaled by steadyStreakMult(p)/steadyStreakMult(p0).
// NOT MODELLED (named): a lost game also scores fewer points than a won one,
// so the true sensitivity to p is steeper than this — a floor.

/** Pseudo-count of the prior, the per-game decay, and where the counts live (home). */
export const THOMPSON = { priorN: 10, armPriorN: 3, decay: 0.98, file: '/tel/go-posterior.txt', halfLifeH: 72 }

// THE SOLVER VERSION (release 3). The counts only decayed when their arm was
// PLAYED, so an arm nobody played kept whatever solver it was measured under:
// live 2026-10-04, Illuminati@5 held 5.3W/22.4L from 40 games of 2026-10-03
// under the OLD uct solver (posterior mean ~0.40) while the model solver wins
// 97-99% there — the chooser under-priced the best opponent. Evidence is now
// kept PER SOLVER VERSION (arm.byVer[version]; go.js: the backend + mode +
// release the solver's replies name — goplan.solverVersion — 'local' for the
// 20ms fallback, 'uct-r3' for a model request answered by uct: a fallback is
// its own evidence and never overwrites the real arm's). An arm is read at
// the version that would play it now (armVersion); any other version's
// evidence — and the pre-release-3 top-level counts — count for nothing, so
// the arm stands on its prior until it is played again. Evidence also fades
// with age (THOMPSON.halfLifeH) as well as per game played, so a long-unplayed
// arm drifts back to its prior rather than freezing.

/** The solver version a reply names: backend[-mode]-release; 'local' when no reply (the in-game fallback). */
export function solverVersion(reply) {
  if (!reply || typeof reply !== 'object') return 'local'
  return `${reply.backend ?? 'uct'}${reply.mode ? '-' + reply.mode : ''}-${reply.release ?? 'r2'}`
}

const NZ = [0, 0]
/** The evidence an arm holds for version `ver` (null: the legacy top-level counts) at time `now`, aged. */
function armCounts(arm, ver, now) {
  const rec = ver ? arm?.byVer?.[ver] ?? null : arm
  if (!rec) return { w: 0, l: 0, bw: NZ, bl: NZ, s: NZ }
  let f = 1
  const at = Date.parse(rec.at ?? arm?.at ?? '')
  if (num(now) && Number.isFinite(at) && now > at && THOMPSON.halfLifeH > 0) f = 0.5 ** ((now - at) / 3600e3 / THOMPSON.halfLifeH)
  const pair = (v) => (Array.isArray(v) && num(v[0]) && num(v[1]) ? [v[0] * f, v[1] * f] : NZ)
  return { w: (num(rec.w) ? rec.w : 0) * f, l: (num(rec.l) ? rec.l : 0) * f, bw: pair(rec.bw), bl: pair(rec.bl), s: pair(rec.s) }
}

/**
 * The hidden opponent's prior. Win rate for Thompson: uniform (never measured
 * live — the exploration batch's prior, kept wide). Power per hour: 1570 — the
 * median of tools/sim/gameplan's DERIVED w0 prior (go.mjs w0PriorMC: the
 * endGoGame payout x win rate, black's scores and games/h; p10/p50/p90
 * 1020/1570/2380, was an ASSUMED 0/200/1000), so the two planners start from
 * one number; refP is the win rate that figure stands at (the derivation's
 * mean, 1.4/27.5). Replaced by the measured rate once W0_MEASURED_MIN games
 * exist (go.js). tools/test/gameplan.test.mjs [GP8] fails if the two drift.
 */
export const W0_PRIOR = { a: 1, b: 1, powerPerHour: 3130, refP: 0.294 } // KataGo GPU on 19x19 (d711521 gameplan derivation)

/** Games against the hidden opponent before its measured rate replaces the prior. */
export const W0_MEASURED_MIN = 10

const ssmMemo = new Map()
function ssm(p) {
  const k = Math.round(p * 1e4)
  let v = ssmMemo.get(k)
  if (v === undefined) {
    v = steadyStreakMult(k / 1e4)
    ssmMemo.set(k, v)
  }
  return v
}

/** Power/hour at win rate p over power/hour at the measured rate `ref` (see the header). */
export function rateScale(p, ref) {
  if (!num(p) || !num(ref) || p < 0 || p > 1 || ref < 0 || ref > 1) return null
  return ssm(p) / ssm(ref)
}

/** Posterior key: opponent @ the board size it is played on. */
export function armKey(name, size) {
  return `${name}@${OPPONENTS[name]?.board ?? size}`
}

/** The prior Beta for an opponent: today's point estimate with priorN pseudo-games, or W0_PRIOR. */
export function priorOf(name) {
  if (name === W0) return { a: W0_PRIOR.a, b: W0_PRIOR.b }
  const p0 = WIN_RATE[name]
  if (!num(p0)) return { a: 1, b: 1 }
  const k = THOMPSON.priorN
  // Floors keep a 0.983 prior a proper Beta (b = 0.17 > 0).
  return { a: Math.max(0.05, k * p0), b: Math.max(0.05, k * (1 - p0)) }
}

/** A fresh, empty posterior state (what a missing or unreadable file becomes). */
export function emptyPosterior() {
  return { v: 1, arms: {} }
}

/** Parse the persisted state; anything unreadable is an empty state, and says so. */
export function parsePosterior(text) {
  try {
    const s = JSON.parse(text || 'null')
    if (s && s.v === 1 && s.arms && typeof s.arms === 'object') return { state: s, why: null }
    return { state: emptyPosterior(), why: text ? 'posterior file unreadable (wrong shape) — starting from the priors' : 'no posterior file yet — starting from the priors' }
  } catch (e) {
    return { state: emptyPosterior(), why: `posterior file unreadable (${String(e).slice(0, 60)}) — starting from the priors` }
  }
}

/**
 * Beta posterior of one arm: prior + decayed counts. n is the decayed evidence.
 * `ver`: read the evidence of that solver version only (arm.byVer); absent:
 * the pre-release-3 top-level counts. `now`: age the counts (halfLifeH).
 */
export function posteriorOf(state, name, size, { ver = null, now = null } = {}) {
  const pr = priorOf(name)
  const arm = state?.arms?.[armKey(name, size)] ?? null
  const { w, l } = armCounts(arm, ver, now)
  const a = pr.a + w
  const b = pr.b + l
  const mean = a / (a + b)
  const sd = Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)))
  return { a, b, n: w + l, games: num(arm?.games) ? arm.games : 0, mean, sd }
}

/**
 * THE ARM'S FULL POSTERIOR (release 3a): win rate, mean black won / lost and
 * seconds per game, each prior (armPrior, k pseudo-games) + this version's
 * decayed live evidence. Normal means with the prior's sd as the known
 * per-game sd: posterior mean (k m0 + sum) / (k + n), sd sd0 / sqrt(k + n).
 * null when the arm is not offered (no prior). The hidden opponent: see armDraw.
 */
export function armPosterior(state, name, size, { ver = null, now = null, katagoOk = true } = {}) {
  const pr = armPrior(name, size, katagoOk)
  if (!pr) return null
  const v = ver ?? armVersion(pr.backend)
  const arm = state?.arms?.[armKey(name, size)] ?? null
  const c = armCounts(arm, v, now)
  const a = Math.max(0.05, pr.k * pr.p) + c.w
  const b = Math.max(0.05, pr.k * (1 - pr.p)) + c.l
  const norm = ([m0, sd0], [n, sum]) => ({ m: (pr.k * m0 + sum) / (pr.k + n), sd: sd0 / Math.sqrt(pr.k + n) })
  const bw = norm(pr.bw, c.bw)
  const bl = norm(pr.bl, c.bl)
  const s = norm(pr.s, c.s)
  const mean = a / (a + b)
  const sd = Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)))
  const pps = armPowerPerSecond(mean, bw.m, bl.m, s.m, pr.diff)
  return { backend: pr.backend, version: v, a, b, mean, sd, n: c.w + c.l, games: num(arm?.games) ? arm.games : 0, bw, bl, s, diff: pr.diff, powerPerHour: num(pps) ? 3600 * pps : null }
}

/** One Thompson draw of an arm's power per second: { p, bw, bl, s, pps }. */
export function armDraw(post, rng = Math.random) {
  const p = betaDraw(post.a, post.b, rng)
  const d = (x) => Math.max(0, x.m + x.sd * normalDraw(rng))
  const bw = d(post.bw)
  const bl = Math.min(d(post.bl), bw)
  const s = Math.max(0.2 * post.s.m, post.s.m + post.s.sd * normalDraw(rng))
  return { p, bw, bl, s, pps: armPowerPerSecond(p, bw, bl, s, post.diff) }
}

/**
 * One finished game on an arm: decay the arm's counts, add the outcome.
 * Pure — returns a new state. `games` is the RAW count (never decayed): it is
 * what the measurement cap counts. With `ver` (release 3) the evidence goes to
 * arm.byVer[ver], with the game's black score and seconds (`obs`) when given;
 * without it, the pre-release-3 top-level counts as before.
 */
export function updatePosterior(state, name, size, won, decay = THOMPSON.decay, at = new Date().toISOString(), ver = undefined, obs = {}) {
  const key = armKey(name, size)
  const s = state && state.arms ? state : emptyPosterior()
  const arm = s.arms[key] ?? { w: 0, l: 0, games: 0 }
  const d = num(decay) && decay > 0 && decay <= 1 ? decay : 1
  if (ver === undefined) {
    const next = { ...arm, w: (arm.w ?? 0) * d + (won ? 1 : 0), l: (arm.l ?? 0) * d + (won ? 0 : 1), games: (arm.games ?? 0) + 1, at }
    return { ...s, arms: { ...s.arms, [key]: next } }
  }
  const rec = arm.byVer?.[ver] ?? { w: 0, l: 0, bw: [0, 0], bl: [0, 0], s: [0, 0] }
  const dp = (v) => [(v?.[0] ?? 0) * d, (v?.[1] ?? 0) * d]
  const add = (v, x) => (num(x) ? [v[0] + 1, v[1] + x] : v)
  const bw = dp(rec.bw)
  const bl = dp(rec.bl)
  const next = {
    w: (rec.w ?? 0) * d + (won ? 1 : 0),
    l: (rec.l ?? 0) * d + (won ? 0 : 1),
    bw: won ? add(bw, obs.black) : bw,
    bl: won ? bl : add(bl, obs.black),
    s: add(dp(rec.s), obs.seconds),
    at,
  }
  const armNext = { ...arm, games: (arm.games ?? 0) + 1, at, ver, byVer: { ...(arm.byVer ?? {}), [ver]: next } }
  return { ...s, ver, arms: { ...s.arms, [key]: armNext } }
}

function normalDraw(rng) {
  let u = 0
  while (u <= 1e-300) u = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

/** Gamma(shape, 1) by Marsaglia-Tsang; shape < 1 by the boost Ga(a+1) U^(1/a). */
export function gammaDraw(shape, rng = Math.random) {
  if (!(shape > 0)) return null
  if (shape < 1) {
    let u = 0
    while (u <= 1e-300) u = rng()
    return gammaDraw(shape + 1, rng) * Math.pow(u, 1 / shape)
  }
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  // Capped (tools/test LP1): Marsaglia-Tsang accepts > 95% of proposals, so
  // a cap this far out is reached only by a broken rng — which then throws
  // instead of freezing the page (homeplan.js brought this into progress.js's
  // import graph).
  for (let tries = 0; ; tries++) {
    if (tries > 1e4) throw new Error(`gammaDraw(${shape}): no acceptance in ${tries} proposals — rng broken`)
    let x, v
    let k = 0
    do {
      if (++k > 1e4) throw new Error(`gammaDraw(${shape}): no positive proposal in ${k} draws — rng broken`)
      x = normalDraw(rng)
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = rng()
    if (u < 1 - 0.0331 * x ** 4) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

/** Beta(a, b) as Ga(a) / (Ga(a) + Ga(b)). */
export function betaDraw(a, b, rng = Math.random) {
  const x = gammaDraw(a, rng)
  const y = gammaDraw(b, rng)
  if (!num(x) || !num(y) || x + y <= 0) return null
  return x / (x + y)
}

/** One Thompson draw per opponent: { opponent: win rate }. */
export function drawWinRates(state, names, size, rng = Math.random, opts = {}) {
  const out = {}
  for (const name of names) {
    const { a, b } = posteriorOf(state, name, size, opts)
    const p = betaDraw(a, b, rng)
    if (num(p)) out[name] = p
  }
  return out
}

// ---------------------------------------------------------------------------
// THE HIDDEN OPPONENT "????????????" (GoOpponent.w0r1d_d43m0n). A Go board,
// NOT the w0r1d_d43m0n server — nothing here touches that server. From game
// source (~/Repos/bitburner/src/Go):
//
//   exists      Enums.ts:9 — the enum value is the twelve question marks.
//   available   netscriptGoImplementation.ts:359-361: resetBoardState throws
//               "this opponent has not yet been discovered" unless
//               Player.hasAugmentation(TheRedPill, true) — ignoreQueued, so The
//               Red Pill must be INSTALLED, not merely bought (Person.ts:232-
//               240). The UI also wants SF1 (goAI.ts:885-887 showWorldDemon);
//               the API does not. In BN14 an install with TRP pre-creates its
//               stats row (Go.ts:26-33).
//   bonus       effect.ts:95-96: mults.hacking — the hacking SKILL multiplier
//               (applied through updateSkillLevels, effect.ts:59-63), at
//               bonusPower 2 (Constants.ts:62-68), the largest of any opponent.
//   komi        9.5 (Constants.ts:63) -> difficultyMultiplier (9.5+0.5)*0.25 =
//               2.5 per point (effect.ts:132-135; the x8 is 5x5 Illuminati only).
//   board       ALWAYS 19x19 with a fixed shape: getNewBoardState replaces the
//               board with bitverseBoardShape, rotated, size 19, no random
//               obstacles (boardState.ts:26-30, Constants.ts:88-108) whatever
//               size is requested — the size check is waived for it
//               (netscriptGoImplementation.ts:355).
//   handicap    7 starting white routers on 19x19 (boardState.ts:100-112).
//   AI          isSmart true (goAI.ts:247-259) and the Illuminati priority move
//               set (getFactionMove's fall-through, goAI.ts:225-241).
//   reset       nodePower zeroed at every install like the rest (Go.ts:34-47).
//   favor       none: its name is no FactionName, so a win banks no faction
//               favor (scoring.ts:66-79).
//
// WHAT IT IS WORTH. mults.hacking multiplies the skill level, and the level is
// logarithmic in exp (skill.ts:7-15), so on a HACKING-route exit after The
// Red Pill — the climb to the World Daemon's required level — a few percent
// on the multiplier removes a large fraction of the climb (hackLevelWeight).
// On the BLADEBURNER route the exit is the black ops, no hacking level is on
// the path, and the weight is a known 0.

const RED_PILL = 'The Red Pill' // Augmentation/Enums.ts

/**
 * Can the hidden opponent be played? From ns.getResetInfo() (ownedAugs: the
 * INSTALLED augmentations, a Map) — the probe go.js already pays for.
 */
export function w0Eligible(reset) {
  const owned = reset?.ownedAugs
  let has = null
  if (owned instanceof Map) has = owned.has(RED_PILL)
  else if (Array.isArray(owned)) has = owned.includes(RED_PILL)
  else if (owned && typeof owned === 'object') has = RED_PILL in owned
  if (has === null) return { eligible: false, why: 'installed augmentations unreadable (getResetInfo().ownedAugs) — the hidden opponent is not offered' }
  return has
    ? { eligible: true, why: 'The Red Pill is installed — the hidden opponent is open (netscriptGoImplementation.ts:359)' }
    : { eligible: false, why: 'The Red Pill is not installed — resetBoardState refuses the hidden opponent until it is (netscriptGoImplementation.ts:359)' }
}

/** 'blade' | 'hack' | null from /tel/plan.txt (decisions.bladeRoute.key), this node only. */
export function routeOf(plan, node) {
  if (!plan || typeof plan !== 'object') return null
  if (num(node) && num(plan.node) && plan.node !== node) return null
  // No division (no bladeRoute decision at all) is the hack route too.
  return plan.decisions?.bladeRoute?.key === 'blade' ? 'blade' : 'hack'
}

/** Continuous hacking level at exp E and multiplier m (skill.ts:7-15 without the floor). */
export function levelAt(exp, mult) {
  return mult * (32 * Math.log(exp + 534.6) - 200)
}

/**
 * Hours from exp0 to `target` hacking level at multiplier `mult`, the exp rate
 * flat + k (level + 50) (exitplan's affine law: an op's time scales as
 * 1/(level+50)). In u = level/mult the exp to climb is e^((u+200)/32), so
 *   T = integral_{u0}^{ut} e^((u+200)/32)/32 / (flat + k (mult u + 50)) du
 * by Simpson's rule; u0 = 32 ln(exp0+534.6) - 200 does not depend on mult.
 * Same arithmetic as exitplan.hoursToLevelShaped (cross-checked in GO12).
 */
export function climbHours({ target, mult, exp0, flat = 0, k = 0 }) {
  if (!num(target) || !num(mult) || mult <= 0 || !num(exp0) || exp0 < 0 || !num(flat) || !num(k) || flat < 0 || k < 0) return null
  const u0 = 32 * Math.log(exp0 + 534.6) - 200
  const ut = target / mult
  if (ut <= u0) return 0
  if (!(flat + k > 0)) return Infinity
  const f = (u) => Math.exp((u + 200) / 32) / 32 / (flat + k * (Math.max(1, mult * u) + 50))
  const STEPS = 2000
  const h = (ut - u0) / STEPS
  let acc = f(u0) + f(ut)
  for (let i = 1; i < STEPS; i++) acc += (i % 2 ? 4 : 2) * f(u0 + i * h)
  return (acc * h) / 3 / 3600
}

/**
 * Exit hours per unit ln of mults.hacking — the hidden opponent's weight, in
 * goweights' unit. Two runs on the SAME inputs, the climb with and without the
 * multiplier raised by e^D (CLAUDE.md: decisions compare simulated
 * trajectories): the terminal sprint progress.js prices once The Red Pill is
 * installed (the exp to the exit level at the current multiplier over the
 * measured exp flow).
 *
 *   record  /tel/exitinputs.txt (progress.js): inputs.{hackingExp, hackingMult,
 *           expPerSec, expFlatPerSec, expScalesWithLevel, exitLevel}
 *   o.route 'blade' -> 0 (known: the exit does not run through a hacking level)
 *
 * ASSUMES the sprint: no further install (an install would zero the bonus).
 * Returns { weight, why, sprintH } — weight null when it cannot price (the
 * opponent is then skipped by name, never scored 0).
 */
export function hackLevelWeight(record, o = {}) {
  if (o.route === 'blade') return { weight: 0, why: 'Bladeburner route: the exit is the black ops, no hacking level on the path — a known 0', sprintH: null }
  if (!record?.inputs) return { weight: null, why: 'no exit inputs (/tel/exitinputs.txt) to price the climb' }
  if (o.lastAugReset !== undefined && record.lastAugReset !== o.lastAugReset) return { weight: null, why: 'exit inputs are from another life' }
  const now = num(o.now) ? o.now : Date.now()
  if (!(now - Date.parse(record.at) < 30 * 60e3)) return { weight: null, why: 'exit inputs are stale (>30 min)' }
  const i = record.inputs
  const target = i.exitLevel
  const mult = i.hackingMult
  const exp0 = i.hackingExp
  if (![target, mult, exp0, i.expPerSec].every(num) || mult <= 0 || exp0 < 0) return { weight: null, why: 'exit inputs lack exitLevel/hackingMult/hackingExp/expPerSec' }
  const flat = num(i.expFlatPerSec) && i.expFlatPerSec >= 0 ? i.expFlatPerSec : 0
  const scales = i.expScalesWithLevel === true
  const lvl = levelAt(exp0, mult)
  const k = scales ? Math.max(0, i.expPerSec - flat) / (Math.max(1, lvl) + 50) : 0
  const F = scales ? flat : Math.max(0, i.expPerSec)
  const D = num(o.D) && o.D > 0 ? o.D : 0.01
  const T0 = climbHours({ target, mult, exp0, flat: F, k })
  const T1 = climbHours({ target, mult: mult * Math.exp(D), exp0, flat: F, k })
  if (!num(T0) || !num(T1)) return { weight: null, why: `the climb to hacking ${target} does not price (exp rate ${i.expPerSec})` }
  return {
    weight: Math.max(0, (T0 - T1) / D),
    why: `hacking route: sprint to hacking ${target} ${T0.toFixed(2)}h at mult ${mult.toFixed(3)}, ${T1.toFixed(2)}h at x e^${D}`,
    sprintH: T0,
  }
}

// ---------------------------------------------------------------------------
// MEASURING THE HIDDEN OPPONENT — the explore value.
//
// Its power/hour is unmeasured (W0_PRIOR is an assumption). The node-order
// planner (tools/sim/gameplan) carries it as `w0`, and its value-of-
// information table puts a ~128h swing in the whole-game total on that one
// number. A reading is worth far more there than the few hours of play it
// costs here, so when the board is open and the posterior is still wide go.js
// spends a CAPPED batch on it regardless of the in-node price.

/**
 * The cap: at most this many games against the hidden opponent are played FOR
 * MEASUREMENT (raw games on its arm, never decayed). 30 games give a win-rate
 * sd <= ~0.09 and a power/hour to roughly +-20%; each is a 19x19 game (~10 min
 * at the solver's pace), so the batch costs ~5h of farm time once per save —
 * small beside the ~128h the gameplan's swing on `w0` is worth. Priced play
 * against it continues past the cap whenever its marginal leads.
 */
export const W0_EXPLORE_GAMES = 30
/** Exploration stops early once the win-rate posterior's sd is under this. */
export const W0_WIDE_SD = 0.05

/** Should the next game be a measurement game against the hidden opponent? */
export function exploreW0({ eligible, state, solverOk = true, cap = W0_EXPLORE_GAMES } = {}) {
  if (!eligible) return { explore: false, why: 'hidden opponent not open' }
  const post = posteriorOf(state, W0, 19)
  if (post.games >= cap) return { explore: false, why: `measurement batch done (${post.games}/${cap} games)`, post }
  if (post.sd < W0_WIDE_SD) return { explore: false, why: `posterior already narrow (sd ${post.sd.toFixed(3)} < ${W0_WIDE_SD})`, post }
  if (!solverOk) return { explore: false, why: 'the external solver is not answering — a measurement on the 20ms fallback would describe nothing', post }
  return {
    explore: true,
    why: `MEASURING the hidden opponent: game ${post.games + 1} of a ${cap}-game batch (win-rate posterior sd ${post.sd.toFixed(3)}; its power/hour is the gameplan's w0, worth more measured than the farm time it costs)`,
    post,
  }
}

/** Games kept in the measurement record (the estimate uses all of them). */
const W0_KEEP = 200
/** A rate estimate goes to the gameplan observation channel every this many games against it. */
export const OBS_EVERY = 20
/** The gameplan observation channel (tools/sim/gameplan/README.md). */
export const OBS_FILE = '/tel/gameplan-obs.txt'
/** The hidden opponent's own measurement record. */
export const W0_FILE = '/tel/go-w0.txt'

/**
 * Node power per hour from per-game {power, hours}: the ratio estimator
 * sum(power)/sum(hours), sd by the delta method. null below 2 games.
 */
export function rateEstimate(games) {
  const g = (games ?? []).filter((x) => num(x?.power) && num(x?.hours) && x.hours > 0)
  const n = g.length
  if (n < 2) return null
  const P = g.reduce((s, x) => s + x.power, 0)
  const H = g.reduce((s, x) => s + x.hours, 0)
  const R = P / H
  const v = g.reduce((s, x) => s + (x.power - R * x.hours) ** 2, 0) / (n - 1)
  return { value: R, sd: Math.sqrt(v / n) / (H / n), n, wins: g.filter((x) => x.won).length }
}

/** Fold one finished game into the measurement record (pure). */
export function w0RecordAdd(prev, game) {
  const r = prev && prev.v === 1 && Array.isArray(prev.games) ? prev : { v: 1, games: [], totals: { games: 0, wins: 0, power: 0, hours: 0 } }
  const games = [...r.games, game].slice(-W0_KEEP)
  const t = r.totals
  const totals = {
    games: t.games + 1,
    wins: t.wins + (game.won ? 1 : 0),
    power: t.power + (num(game.power) ? game.power : 0),
    hours: t.hours + (num(game.hours) ? game.hours : 0),
  }
  return { v: 1, at: game.at, unit: 'node power per hour (raw nodePower, before GoPower/SF14)', totals, rate: rateEstimate(games), games }
}

/**
 * The observation record for the gameplan channel: {param, value, sd, at,
 * source} — `w0` is node power per hour against w0r1d_d43m0n.
 */
export function w0Obs(rate, at, source = 'go.js') {
  if (!rate || !num(rate.value) || !num(rate.sd)) return null
  return { param: 'w0', value: +rate.value.toPrecision(5), sd: +rate.sd.toPrecision(4), at, source: `${source}: ${rate.n} games vs ????????????` }
}

/** Is this game count (raw, against the hidden opponent) a publishing point? */
export function obsDue(gamesOnW0) {
  return num(gamesOnW0) && gamesOnW0 > 0 && gamesOnW0 % OBS_EVERY === 0
}

/**
 * Finished 19x19 games an hour against the hidden opponent: the median of
 * tools/sim/gameplan/go.mjs W0_PRIOR_INPUTS.gamesPerH (7.5/8.8/10.5, the AI's
 * own timers plus the 800ms search). Node power lands once per game.
 */
export const W0_GAMES_PER_H = 8.8

/**
 * The elasticity of the hacking route's growth (ln M per hour) to the Go
 * rate bonus — ASSUMED, the mid of tools/sim/gameplan/effects.mjs eps14
 * (0 / 0.12 / 0.3): the one number of the Go model the source does not give.
 */
export const GO_EPS14 = 0.12

/** Finished 5x5 games an hour with the solver answering (BN9's last go.js, 2026-10-02; go.mjs GO_MEASURED.gamesPerH). */
export const GAMES_PER_H_5X5 = 160

/**
 * THE GO FARM IN THE LIVE HACKING EXIT (exitplan o.go and goCadenceMult) —
 * the offline whole-game plan's Go terms (tools/sim/gameplan/go.mjs,
 * routes.mjs hackParts) on the live simulator, one formula each:
 *
 *   w0      The Red Pill installed, the farm plays w0r1d_d43m0n through the
 *           climb (hacking skill x effect, bonusPower 2): exitplan prices the
 *           first passage per game (go.mjs goWindow). Rate: go.js's measured
 *           one (>= W0_MEASURED_MIN games, /tel/go.txt w0.rate) else W0_PRIOR.
 *   rep     The final window's farm on the exit faction (Daedalus, bonusPower
 *           1.1, faction_rep): its power from the window's install at the
 *           measured 5x5 rate (POWER_PER_HOUR.Daedalus) — the faction_rep
 *           factor on the ground reputation leg.
 *   favorStream  the same games' favor (favor.goFavorStreamOf: games/h x
 *           p^2/(1+p) x getMaxRep/200, to getMaxRep), from the join — passed
 *           so exitplan uses it where no MEASURED stream exists (go.js not on
 *           the exit faction today).
 *   cadenceMult  the Go rate bonus on g: ((1 + s abar)/(1 + abar))^eps14
 *           (go.mjs goGFactor), s = GoPower x (SF14 ? 2 : 1), abar the
 *           measured runs' mean Daedalus bonus over a life (meanEffect at
 *           GoPower 1) — the nodes the cadence was measured in played at
 *           s = 1. Applied to ln(M) only for the share of the cadence that is
 *           NOT this node's own lives ((1 - ownWeight)): its own lives
 *           already carry the node's GoPower.
 *
 * o: { goPower, sf14, goTel (/tel/go.txt, this life's), cycleHours, ownWeight,
 *      exitFaction, favorStreamOf (favor.goFavorStreamOf) }.
 * Returns { go: {w0, rep, favorStream|null, why}, goCadenceMult }.
 * NOT PRICED, named: the hacking_money / hacking_speed channels on the money
 * legs (goweights prices them for the opponent choice; here they reach the
 * exit only through cadenceMult), go.cheat (BN14.2 / SF14.2+), combat on the
 * gym (the Bladeburner arm's).
 */
export function goExitInputsOf(o = {}) {
  const goPower = num(o.goPower) && o.goPower > 0 ? o.goPower : 1
  const sf14 = num(o.sf14) ? o.sf14 : 0
  const s = goPower * (sf14 >= 1 ? 2 : 1)
  const tel = o.goTel && typeof o.goTel === 'object' ? o.goTel : null
  const r = tel?.w0?.rate
  const measured = r && typeof r.source === 'string' && r.source.startsWith('measured') && num(r.pph) && r.pph > 0
  const w0 = { powerPerH: measured ? r.pph : W0_PRIOR.powerPerHour, gamesPerH: W0_GAMES_PER_H, bonusPower: OPPONENTS.w0r1d_d43m0n.power, goPower, sf14, source: measured ? r.source : `prior ${W0_PRIOR.powerPerHour}/h (goplan.W0_PRIOR, unmeasured)` }
  const rep = { powerPerH: POWER_PER_HOUR.Daedalus, bonusPower: OPPONENTS.Daedalus.power, goPower, sf14 }
  let favorStream = null
  let favorWhy = 'no favor-stream builder passed'
  if (typeof o.favorStreamOf === 'function') {
    const hrs = tel && Date.parse(tel.at ?? '') > Date.parse(tel.processStartedAt ?? '') ? (Date.parse(tel.at) - Date.parse(tel.processStartedAt)) / 3.6e6 : 0
    const gph = hrs > 0 && num(tel?.gamesThisProcess) && tel.gamesThisProcess >= 10 ? tel.gamesThisProcess / hrs : GAMES_PER_H_5X5
    const banked = num(tel?.favorRep?.[o.exitFaction ?? 'Daedalus']) ? tel.favorRep[o.exitFaction ?? 'Daedalus'] : 0
    const st = o.favorStreamOf({ gamesPerHour: gph, pWin: WIN_RATE.Daedalus, sf14, banked })
    favorStream = num(st?.repPerH) && st.repPerH > 0 ? { repPerH: st.repPerH, capRep: st.capRep } : null
    favorWhy = st?.why ?? 'unpriced'
  }
  const cyc = num(o.cycleHours) && o.cycleHours > 0 ? o.cycleHours : null
  const abar = cyc ? meanEffect(POWER_PER_HOUR.Daedalus, OPPONENTS.Daedalus.power, cyc, 1, 0) - 1 : null
  const w = num(o.ownWeight) ? Math.min(1, Math.max(0, o.ownWeight)) : 0
  const gG = num(abar) ? Math.pow((1 + s * abar) / (1 + abar), GO_EPS14) : 1
  const goCadenceMult = Math.pow(gG, 1 - w)
  const why = `the farm on the hacking route at GoPower ${goPower}${sf14 >= 1 ? ' x2 (SF14)' : ''}: w0r1d_d43m0n on the climb at ${Math.round(w0.powerPerH)}/h (${w0.source}), ${W0_GAMES_PER_H} games/h; ${'Daedalus'} in the final window at ${POWER_PER_HOUR.Daedalus}/h (faction_rep), favor ${favorStream ? `${Math.round(favorStream.repPerH)} rep-eq/h (${favorWhy})` : `none (${favorWhy})`}; g x${goCadenceMult.toFixed(3)} (eps ${GO_EPS14} ASSUMED, abar ${num(abar) ? abar.toFixed(3) : '-'}, own lives' share ${w.toFixed(2)} excluded)`
  return { go: { w0, rep, favorStream, why }, goCadenceMult }
}
