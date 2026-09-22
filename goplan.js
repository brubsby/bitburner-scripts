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
// THE DECISION COLLAPSES TO ONE RATIO. objective.deriveWeights gives
// hacking_money and hacking_speed the same weight N*eB, and faction_rep N*eR.
// So with the powers measured, Daedalus wins iff
//
//     eR/eB > ln(Ebar_other) / ln(Ebar_Daedalus)
//
// and everything else is arithmetic. This module does that arithmetic and
// REFUSES when the objective it needs has not been derived — a flat-weights
// pass cannot distinguish the channels at all, and switching on it would be a
// guess wearing a number's clothes.
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
 * Only these three are visible to the augmentation basket (RATE_CHANNELS).
 * crime_success, the combat levels and hacknet_node_money are priced nowhere
 * the weights can see, so an opponent feeding them cannot be compared here and
 * is refused BY NAME rather than scored zero — zero would read as "worthless",
 * which is a different claim from "not priceable".
 */
export const PRICEABLE = ['faction_rep', 'hacking_speed', 'hacking_money']

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

/**
 * The choice.
 *
 * @param {object} o
 * @param {object} o.weights   derived channel weights (objective.deriveWeights). REQUIRED.
 * @param {number} o.windowH   hours in one install window — the life of a Go bonus.
 * @param {string} o.incumbent the opponent currently being played.
 * @param {number} [o.goPower] currentNodeMults.GoPower (4 in BitNode 14).
 * @param {number} [o.sf14]    Source-File 14 level; >=1 doubles the effect.
 * @param {object} [o.powerPerHour] override the measured table (tests).
 * @returns {{opponent, why, refused, table}}
 */
export function chooseOpponent(o = {}) {
  const { weights, windowH, incumbent } = o
  const goPower = num(o.goPower) && o.goPower > 0 ? o.goPower : 1
  const sf14 = num(o.sf14) ? o.sf14 : 0
  const table = o.powerPerHour ?? POWER_PER_HOUR
  const keep = (why) => ({ opponent: incumbent ?? null, why, refused: true, table: null })

  // EVERY REFUSAL IS NAMED. An unreadable input must never read as a verdict:
  // the incumbent stands and the reason is published.
  if (!weights || typeof weights !== 'object') {
    return keep('no derived channel weights — a flat-weights pass cannot tell the channels apart, so the incumbent stands')
  }
  if (!num(windowH) || windowH <= 0) {
    return keep('no measured install window — the Go bonus is destroyed by every install, so its value cannot be priced without one')
  }

  const scored = []
  for (const [name, meta] of Object.entries(OPPONENTS)) {
    if (!PRICEABLE.includes(meta.channel)) continue
    const w = weights[meta.channel]
    if (!num(w) || w < 0) return keep(`weight for ${meta.channel} is unreadable — refusing rather than ranking on a partial basket`)
    const pph = table[name]
    if (!num(pph) || pph <= 0) return keep(`no measured power/hour for ${name}`)
    const ebar = meanEffect(pph, meta.power, windowH, goPower, sf14)
    if (ebar === null) return keep(`could not price ${name}`)
    scored.push({ name, channel: meta.channel, weight: w, ebar, value: w * Math.log(ebar) })
  }
  if (!scored.length) return keep('no priceable opponent')

  scored.sort((a, b) => b.value - a.value)
  const best = scored[0]
  // Every weight zero means the basket says nothing; do not churn the board on it.
  if (!(best.value > 0)) {
    return keep(`every priceable channel weighs 0 (${scored.map((s) => `${s.channel}=${s.weight}`).join(', ')}) — nothing to choose between, so the incumbent stands`)
  }
  const why =
    `${best.name} (${best.channel}) at ${best.value.toExponential(3)} = weight ${best.weight.toFixed(4)} x ln(${best.ebar.toFixed(4)})` +
    `; runners-up ${scored.slice(1).map((s) => `${s.name} ${s.value.toExponential(2)}`).join(', ')}`
  return { opponent: best.name, why, refused: false, table: scored }
}
