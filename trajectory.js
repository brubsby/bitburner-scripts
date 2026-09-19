// Reputation as a TRAJECTORY: the rate grows while you earn. Pure, no ns.
//
// ---------------------------------------------------------------------------
// WHY EVERY SNAPSHOT MODEL HERE WAS WRONG IN THE SAME DIRECTION
//
// Faction reputation gain is LINEAR in hacking level (reputation.ts:17 —
// `(hacking + int/3)/MaxSkillLevel * faction_rep * intBonus * favorMult *
// shareBonus`), and hacking level is `mult * (32*ln(exp + 534.6) - 200)`
// (skill.ts:13) with exp growing linearly at the batcher's measured rate. So
// over any horizon the rep rate RISES, and "measured rate x hours" — the
// arithmetic every schedule and forecast in this stack used — systematically
// overstates long grinds and understates the value of time. The same shape
// already bit the company model, where ignoring the desk's own charisma
// growth overstated university training's value ~3x.
//
// ---------------------------------------------------------------------------
// THE CLOSED FORM
//
// With a = exp0 + 534.6 and r = exp/sec, integrate the level over [0, T]:
//
//     ∫₀ᵀ ln(a + rt) dt = ((a+rT)ln(a+rT) - (a+rT) - (a·ln a - a)) / r
//     ∫₀ᵀ level dt      = mult * (32 * the above - 200T)
//     rep(T)            = C * favorMult * ∫ level
//
// C is CALIBRATED, not derived: it is measuredBaseRepPerSec / hacking_now,
// which folds faction_rep, the share bonus, the BitNode term and the /975
// into one measured scale factor. The measurement anchors the trajectory's
// height; the formula supplies only its SHAPE. (The displayed level floors;
// integrating the unfloored curve is at most one level of error, far below
// the measurement noise the scale factor carries.)
//
// Inversion (hours for a target rep) is bisection: rep(T) is strictly
// increasing, and the constant-rate estimate is a guaranteed UPPER bound —
// a rising rate can only finish sooner — so the bracket is [0, constant].
//
// AN UNBUILDABLE MODEL RETURNS null, and callers fall back to constant-rate
// arithmetic. Degrading to the old behaviour beats guessing a growth curve
// from unreadable inputs — the standing rule about unknowns applies to
// trajectories too.

/** ∫₀ᵀ ln(exp0 + r·t + 534.6) dt, the exact primitive above. */
const intLog = (exp0, r, T) => {
  const a = exp0 + 534.6
  const b = a + r * T
  return (b * Math.log(b) - b - (a * Math.log(a) - a)) / r
}

/**
 * Build a reputation trajectory from live measurements.
 *
 * `baseRepPerSec` is the favour-divided-out rate planFactionWork measures;
 * `hacking`/`hackingExp`/`hackingMult` the live skill state; `expPerSec` the
 * measured exp flow. Returns null unless every input is readable and positive
 * — except `expPerSec`, whose absence degrades to a constant-rate model
 * (shape flat, height still calibrated) rather than refusing outright, so a
 * first pass with no exp delta yet still prices *something*.
 */
export function repModel(o = {}) {
  const num = (x) => typeof x === 'number' && isFinite(x) && x > 0
  const { baseRepPerSec, hacking, hackingExp, hackingMult, expPerSec } = o
  if (!num(baseRepPerSec) || !num(hacking) || !num(hackingMult)) return null
  const C = baseRepPerSec / Math.max(1, hacking)
  const grows = num(expPerSec) && typeof hackingExp === 'number' && isFinite(hackingExp) && hackingExp >= 0

  /** Reputation earned between startH and startH+h at a favour multiplier. */
  const repBetween = (startH, h, favorMult = 1) => {
    if (!(h > 0)) return 0
    const t0 = startH * 3600
    const T = (startH + h) * 3600
    if (!grows) return C * hacking * favorMult * (T - t0)
    const lvlInt =
      hackingMult * (32 * (intLog(hackingExp, expPerSec, T) - intLog(hackingExp, expPerSec, t0)) - 200 * (T - t0))
    // Early-game guard: the unfloored curve can dip below level 1, where the
    // game clamps. Never price BELOW the constant-rate floor of level 1.
    return C * favorMult * Math.max(lvlInt, T - t0)
  }

  /** Hours after startH to earn `rep` at a favour multiplier. */
  const hoursFor = (rep, favorMult = 1, startH = 0) => {
    if (!(rep > 0)) return 0
    // Constant-rate hours at the CURRENT level: an upper bound, because the
    // level only rises. (At startH the level is even higher, so it still
    // bounds.) Bisect down from it.
    let hi = rep / (C * Math.max(1, hacking) * favorMult) / 3600
    if (!isFinite(hi)) return null
    if (!grows) return hi
    // The bound must actually cover the target before bisection means anything.
    while (repBetween(startH, hi, favorMult) < rep) hi *= 2
    let lo = 0
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2
      if (repBetween(startH, mid, favorMult) < rep) lo = mid
      else hi = mid
    }
    return hi
  }

  return { repBetween, hoursFor, grows }
}

/**
 * Income as a trajectory — the same treatment, with a weaker claim, stated.
 *
 * WHAT THE GAME LICENSES: a batch cycle is clocked by weaken time, and
 * calculateHackingTime (Hacking.ts:59-74) divides by `hacking + 50`. So at a
 * fixed steal fraction on a fixed fleet, throughput — and with it income —
 * scales as (level + 50). The other level terms (percent stolen, success
 * chance) saturate and only help.
 *
 * WHAT IT DOES NOT LICENSE: the fleet also GROWS (buyserv reinvests) and the
 * batcher RETARGETS to richer servers as the level unlocks them. Both add
 * income growth this shape cannot see. So this is a deliberate LOWER BOUND:
 * it can under-project waiting's value, never over-project it — and the
 * under-projection direction degrades toward the old flat model, while
 * over-projection would argue for holding installs forever, the direction
 * that already cost six hours once.
 *
 * CALIBRATION IS PROSPECTIVE, because it has to be: history records money
 * (spending-corrupted) and no income series, so the shape cannot be checked
 * backward. Instead the caller records each pass's prediction for the next
 * pass and publishes the realized error every pass — the doctrine's "checked,
 * in the file, on every run" done forward. `factorAt` exists for exactly that.
 */
export function incomeModel(o = {}) {
  const num = (x) => typeof x === 'number' && isFinite(x) && x > 0
  const { incomePerSec, hacking, hackingExp, hackingMult, expPerSec } = o
  if (!num(incomePerSec) || !num(hacking) || !num(hackingMult)) return null
  const grows = num(expPerSec) && typeof hackingExp === 'number' && isFinite(hackingExp) && hackingExp >= 0
  const base = Math.max(1, hacking) + 50

  /** The income multiple at h hours out: (level(h)+50)/(level_now+50). */
  const factorAt = (h) => {
    if (!grows || !(h > 0)) return 1
    const lvl = hackingMult * (32 * Math.log(hackingExp + expPerSec * h * 3600 + 534.6) - 200)
    return (Math.max(1, lvl) + 50) / base
  }

  /** Money earned over the next h hours: incomeNow x ∫(level+50)dt / (level_now+50). */
  const moneyBy = (h) => {
    if (!(h > 0)) return 0
    const T = h * 3600
    if (!grows) return incomePerSec * T
    const lvlInt = hackingMult * (32 * intLog(hackingExp, expPerSec, T) - 200 * T)
    // The same level-1 clamp as the rep model, and the flat figure as a hard
    // floor: a growth model must never project LESS than no growth.
    return (incomePerSec * (Math.max(lvlInt, T) + 50 * T)) / base
  }

  return { moneyBy, factorAt, grows }
}

/**
 * The faction rep rate when NO measurement exists yet — from the game's own
 * formula, not a placeholder.
 *
 * THE BUG THIS REPLACES: planFactionWork fell back to `1 rep/s` for factions
 * while megacorp candidates priced from their real formulas (~2.7 rep/s for
 * an intern). On the first passes of every life — before anything measured —
 * factions therefore looked 3-4x slower than they were, a desk stint
 * spuriously topped the schedule, and one measuring interval later the truth
 * reasserted and the job was abandoned. Live evidence: a Four Sigma intern
 * job at 4,830 of 400,000 rep, charisma 10, walked away from.
 *
 * The formula (reputation.ts:16-21, applied per 200ms cycle, x5 for /sec):
 *
 *   (hacking + int/3) / 975 * faction_rep * intBonus * favorMult * shareBonus
 *     * FactionWorkRepGain
 *
 * favorMult is EXCLUDED here — the callers apply favour per faction, and this
 * must stay a BASE rate exactly like the measured one it stands in for. The
 * intelligence bonus (intelligence.ts: 1 + int^0.8/600) is included — it is
 * identity at this save's int 0, but TJ6 checks nonzero shapes against the
 * game and a 2.5% silent omission is how drift starts. Share power comes from
 * ns.getSharePower, the same quantity the game multiplies by.
 *
 * A measured rate still outranks this everywhere: this is the ESTIMATE arm,
 * flagged `estimated` in telemetry, and it exists so the two candidate kinds
 * are priced from the same family of arithmetic rather than one from formula
 * and one from thin air.
 */
export function estimateBaseRepPerSec(o = {}) {
  const num = (x) => typeof x === 'number' && isFinite(x) && x > 0
  const { hacking, intelligence = 0, factionRepMult, nodeWorkRepMult, sharePower = 1 } = o
  if (!num(hacking) || !num(factionRepMult) || !num(nodeWorkRepMult)) return null
  // Named shareMult, NOT `share`: the RAM checker prices any identifier that
  // matches an ns function name, and a local called `share` bills every
  // importer 2.40GB for ns.share (invariant B1 caught it).
  const shareMult = num(sharePower) && sharePower >= 1 ? sharePower : 1
  const intBonus = 1 + Math.pow(Math.max(0, intelligence), 0.8) / 600
  return ((hacking + Math.max(0, intelligence) / 3) / 975) * factionRepMult * intBonus * nodeWorkRepMult * shareMult * 5
}
