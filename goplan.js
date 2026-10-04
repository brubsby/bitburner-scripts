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
// (The previous table, 60 games/arm with go-boardsize.mjs, was ~2x lower
// across the board: that harness never mirror-passed and dealt ONE offline-
// node layout for every game — tools/sim/go-board.mjs.)

/** Measured node power per hour at 5x5, model backend pondered, go.js's per-opponent budget. */
export const POWER_PER_HOUR = {
  Daedalus: 13643,
  Illuminati: 67897,
  TheBlackHand: 11122,
  SlumSnakes: 11824,
  Netburners: 6569,
  Tetrads: 11550,
}

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
 * (2026-10-03 tune, 2026-10-04 control and pondered: 60-130 games each,
 * 5x5; tools/sim/go-study-report.mjs).
 * Used ONLY to price the win-streak state an opponent resumes from — the
 * steady-state effect of the win rate is already inside POWER_PER_HOUR.
 */
export const WIN_RATE = {
  Daedalus: 0.989,
  Illuminati: 0.977,
  TheBlackHand: 1,
  SlumSnakes: 0.978,
  Netburners: 0.983,
  Tetrads: 0.967,
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
 * @returns {{opponent, why, refused, table}}
 */
export function chooseOpponent(o = {}) {
  const { weights, windowH, incumbent } = o
  const goPower = num(o.goPower) && o.goPower > 0 ? o.goPower : 1
  const sf14 = num(o.sf14) ? o.sf14 : 0
  const table = { [W0]: W0_PRIOR.powerPerHour, ...(o.powerPerHour ?? POWER_PER_HOUR) }
  const refs = { ...WIN_RATE, [W0]: W0_PRIOR.refP, ...(o.refWinRates ?? {}) }
  const drawn = o.winRates && typeof o.winRates === 'object' ? o.winRates : null
  const dwellH = num(o.dwellH) && o.dwellH > 0 ? o.dwellH : 0
  const boardSize = num(o.boardSize) ? o.boardSize : MEASURED_BOARD
  const keep = (why) => ({ opponent: incumbent ?? null, why, refused: true, table: null })

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
  if (boardSize !== MEASURED_BOARD) {
    return keep(`the power/hour table is measured at ${MEASURED_BOARD}x${MEASURED_BOARD} and this board is ${boardSize}x${boardSize} — no rate to price with`)
  }

  const dwellGames = num(o.dwellGames) && o.dwellGames >= 1 ? o.dwellGames : null
  const streaks = o.streaks && typeof o.streaks === 'object' ? o.streaks : null
  const skipped = []
  const scored = []
  for (const [name, meta] of Object.entries(OPPONENTS)) {
    if (name === W0 && o.redPill !== true) {
      skipped.push(`${name} (${meta.channel}: not discovered — needs The Red Pill INSTALLED, netscriptGoImplementation.ts:359)`)
      continue
    }
    const optional = OPTIONAL.includes(meta.channel) || name === W0
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
    const measured = table[name]
    if (name === W0 && !(num(measured) && measured > 0)) {
      skipped.push(`${name} (measured power/hour ${measured}: nothing to price)`)
      continue
    }
    if (!num(measured) || measured <= 0) return keep(`no measured power/hour for ${name}`)
    // The next dwell earns at this opponent's own paused streak, not the
    // steady state: the switching cost, priced (see streakFactor).
    // THE WIN RATE: the Thompson draw when one is given, else the point
    // estimate. The measured rate is rescaled from the win rate it was
    // measured at to this one (rateScale) — that is how a draw moves the price.
    const ref = refs[name]
    const p = drawn && num(drawn[name]) ? drawn[name] : ref
    if (!num(p) || p < 0 || p > 1) return keep(`no win rate for ${name}`)
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
    const marginal = w * (slope / e) * pph
    const eD = effectAt(n + pph * dwellH, meta.power, goPower, sf14)
    const block = w * (Math.log(eD) - Math.log(e))
    scored.push({ name, channel: meta.channel, weight: w, nodePower: n, effect: e, streak: s0, streakFactor: phi, winRate: p, powerPerHour: pph, marginal, block })
  }
  if (!scored.length) return keep('no priceable opponent')

  scored.sort((a, b) => b.marginal - a.marginal)
  const best = scored[0]
  const fmt = (s) => `${s.name} ${s.marginal.toExponential(2)}/h @n=${Math.round(s.nodePower)}`
  const runners =
    scored.slice(1).map(fmt).join(', ') +
    (skipped.length ? `; not priced: ${skipped.join(', ')}` : '') +
    (streaks && dwellGames ? '' : '; streak cost NOT priced (no streaks/dwellGames)')
  // Every weight zero means the basket says nothing; do not churn the board on it.
  if (!(best.marginal > 0)) {
    return keep(`every priceable channel weighs 0 (${scored.map((s) => `${s.channel}=${s.weight}`).join(', ')}) — nothing to choose between, so the incumbent stands`)
  }
  const head =
    `${best.name} (${best.channel}) marginal ${best.marginal.toExponential(3)}/h = weight ${best.weight.toPrecision(3)} x dlnE/dn ` +
    `${(best.marginal / best.weight / best.powerPerHour).toExponential(3)} @n=${Math.round(best.nodePower)} x ${Math.round(best.powerPerHour)}/h` +
    (best.streakFactor !== 1 ? ` (streak ${best.streak}: x${best.streakFactor.toFixed(3)} of the measured ${table[best.name]})` : '') +
    (drawn ? ` [Thompson: win rate drawn ${best.winRate.toFixed(3)}]` : '')
  const inc = scored.find((s) => s.name === incumbent)
  if (best.name !== incumbent && inc && dwellH > 0 && !(best.block > inc.block)) {
    return {
      opponent: incumbent,
      why:
        `${head}, but over the committed ${(dwellH * 60).toFixed(1)}-min dwell ${best.name} gains ${best.block.toExponential(3)} ` +
        `vs ${incumbent} ${inc.block.toExponential(3)} (concavity) — staying; runners-up ${runners}`,
      refused: false,
      table: scored,
    }
  }
  const why =
    head +
    (best.name !== incumbent && inc && dwellH > 0 ? `; dwell block ${best.block.toExponential(3)} > ${incumbent} ${inc.block.toExponential(3)}` : '') +
    `; runners-up ${runners}`
  return { opponent: best.name, why, refused: false, table: scored }
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
  if (gw?.weights) return { source: 'goWeights', weights: gw.weights, windowH: gw.windowH ?? gate?.objective?.windowH ?? null, why: gw.why ?? null }
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
export const THOMPSON = { priorN: 10, decay: 0.98, file: '/tel/go-posterior.txt' }

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
export const W0_PRIOR = { a: 1, b: 1, powerPerHour: 1570, refP: 0.051 }

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

/** Beta posterior of one arm: prior + decayed counts. n is the decayed evidence. */
export function posteriorOf(state, name, size) {
  const pr = priorOf(name)
  const arm = state?.arms?.[armKey(name, size)] ?? null
  const w = num(arm?.w) ? arm.w : 0
  const l = num(arm?.l) ? arm.l : 0
  const a = pr.a + w
  const b = pr.b + l
  const mean = a / (a + b)
  const sd = Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)))
  return { a, b, n: w + l, games: num(arm?.games) ? arm.games : 0, mean, sd }
}

/**
 * One finished game on an arm: decay the arm's counts, add the outcome.
 * Pure — returns a new state. `games` is the RAW count (never decayed): it is
 * what the measurement cap counts.
 */
export function updatePosterior(state, name, size, won, decay = THOMPSON.decay, at = new Date().toISOString()) {
  const key = armKey(name, size)
  const s = state && state.arms ? state : emptyPosterior()
  const arm = s.arms[key] ?? { w: 0, l: 0, games: 0 }
  const d = num(decay) && decay > 0 && decay <= 1 ? decay : 1
  const next = { w: arm.w * d + (won ? 1 : 0), l: arm.l * d + (won ? 0 : 1), games: (arm.games ?? 0) + 1, at }
  return { ...s, arms: { ...s.arms, [key]: next } }
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
export function drawWinRates(state, names, size, rng = Math.random) {
  const out = {}
  for (const name of names) {
    const { a, b } = posteriorOf(state, name, size)
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
