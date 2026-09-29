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
// CALIBRATION: the power table below is MEASURED, 60 games per arm at 5x5
// against the game's own getMove (tools/sim/go-boardsize.mjs, priced by
// tools/sim/go-opponent.mjs). It is valid only while tools/go-solver.mjs is
// answering — every arm was played by a real search, and go.js's 20ms local
// fallback is a regime none of these numbers describe. go.js reports
// health 'warn' when the solver is silent; treat that as invalidating this.

/** Measured node power per hour at 5x5, maxms 800, solver answering. */
export const POWER_PER_HOUR = {
  Daedalus: 4391,
  Illuminati: 10331,
  TheBlackHand: 3733,
  SlumSnakes: 4107,
  Netburners: 2566,
  Tetrads: 3295,
}

/** effect.ts:16-22 bonusPower, and the channel each opponent feeds. */
export const OPPONENTS = {
  Daedalus: { power: 1.1, channel: 'faction_rep' },
  Illuminati: { power: 0.7, channel: 'hacking_speed' },
  TheBlackHand: { power: 0.9, channel: 'hacking_money' },
  SlumSnakes: { power: 1.2, channel: 'crime_success' },
  Netburners: { power: 1.3, channel: 'hacknet_node_money' },
  Tetrads: { power: 0.7, channel: 'combat' },
}

/**
 * Measured win rate per opponent, same study as POWER_PER_HOUR (60 games per
 * arm, 5x5 @800ms; tools/sim/go-opponent.mjs over the go-boardsize JSONL).
 * Used ONLY to price the win-streak state an opponent resumes from — the
 * steady-state effect of the win rate is already inside POWER_PER_HOUR.
 */
export const WIN_RATE = {
  Daedalus: 0.85,
  Illuminati: 0.25,
  TheBlackHand: 0.933,
  SlumSnakes: 0.933,
  Netburners: 0.983,
  Tetrads: 0.75,
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
 * Priced when the objective carries a weight for it, skipped BY NAME when it
 * does not. objective.exitWeights prices hacknet_node_money as the exit's
 * sensitivity to hacknet production until the next install (the life of a
 * Go bonus); deriveWeights, the fallback, has no such channel.
 */
export const OPTIONAL = ['hacknet_node_money']

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
 * most objective. The objective is sum_c w_c * ln(mult_c) (the same derived
 * weights the window-mean pricing used), so per opponent o:
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
 * @param {object} o.weights    derived channel weights (objective.deriveWeights). REQUIRED.
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
 * @param {object} [o.powerPerHour] override the measured table (tests).
 * @returns {{opponent, why, refused, table}}
 */
export function chooseOpponent(o = {}) {
  const { weights, windowH, incumbent } = o
  const goPower = num(o.goPower) && o.goPower > 0 ? o.goPower : 1
  const sf14 = num(o.sf14) ? o.sf14 : 0
  const table = o.powerPerHour ?? POWER_PER_HOUR
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
    const optional = OPTIONAL.includes(meta.channel)
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
    if (!num(measured) || measured <= 0) return keep(`no measured power/hour for ${name}`)
    // The next dwell earns at this opponent's own paused streak, not the
    // steady state: the switching cost, priced (see streakFactor).
    const s0 = streaks ? streaks[name] ?? 0 : null
    const phi = streaks && dwellGames && num(s0) ? streakFactor(WIN_RATE[name], s0, dwellGames) : 1
    if (!num(phi)) return keep(`could not price ${name}'s streak (winStreak ${s0})`)
    const pph = measured * phi
    const n = o.nodePower[name] ?? 0
    if (!num(n) || n < 0) return keep(`nodePower for ${name} is unreadable (${o.nodePower[name]})`)
    const e = effectAt(n, meta.power, goPower, sf14)
    const slope = effectSlope(n, meta.power, goPower, sf14)
    if (e === null || slope === null) return keep(`could not price ${name}`)
    const marginal = w * (slope / e) * pph
    const eD = effectAt(n + pph * dwellH, meta.power, goPower, sf14)
    const block = w * (Math.log(eD) - Math.log(e))
    scored.push({ name, channel: meta.channel, weight: w, nodePower: n, effect: e, streak: s0, streakFactor: phi, powerPerHour: pph, marginal, block })
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
    `${best.name} (${best.channel}) marginal ${best.marginal.toExponential(3)}/h = weight ${best.weight.toFixed(4)} x dlnE/dn ` +
    `${(best.marginal / best.weight / best.powerPerHour).toExponential(3)} @n=${Math.round(best.nodePower)} x ${Math.round(best.powerPerHour)}/h` +
    (best.streakFactor !== 1 ? ` (streak ${best.streak}: x${best.streakFactor.toFixed(3)} of the measured ${table[best.name]})` : '')
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
