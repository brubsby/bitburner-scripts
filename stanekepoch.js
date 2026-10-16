// STANEK'S GIFT, L3: THE LAYOUT AS A CLOSED-LOOP CONTROL DECISION (pure: no ns, 0GB).
//
// At each DECISION EPOCH the stack compares, from the CURRENT live state, keeping the placed layout
// against switching to each candidate, every option simulated to the node's exit, and acts on the
// fastest — so the plan adapts when the run leads or lags the one L2's phase table was priced on.
//
//   EPOCHS (epochDueOf): the first pass with a placed gift in a node; an install (a new life); a black
//     op completed (L2's phase boundaries are black-op counts); the placed layout changed (a switch
//     landed); and a periodic check every EPOCH.periodMin. Between epochs the last decision is carried.
//   STATE: the Bladeburner route's own live start (progress.js pc.bladeCtx.startFor — bbplan.bladeStartOf
//     on /tel/bladeburner.txt, the player's multipliers, the fleet, the Go farm, the rank and success
//     calibrations: ONE builder, the route decision's) plus the gift as /tel/stanek.txt reads it: the
//     placed fragments, each one's charge (highestCharge x numCharge), the live charger's power
//     (threads x coreBonus of its host: the measured 192, not the ramp's 256) and its duty measured
//     from the charge mass between epochs.
//   OPTIONS (epochCandidatesOf + a local search): the incumbent (placed), the tabled layout
//     (stanekplan.BLADE_LAYOUTS) and every layout L2's phase table holds on this grid
//     (BLADE_PHASE_PRICED early/late), then fragment REMOVES, MOVES and SWAPS around the best of them
//     — ordered by the linear screen (layoutValue on BLADE_WEIGHTS: an ORDER only, never the price),
//     the first EPOCH.screenSims priced on one member, the best EPOCH.shortlist re-priced on all Q.
//   PRICE: bbplan.bladeExitGen from that start with s0.gift = giftPathOf(option): the gift's
//     multipliers over the exit relative to the ones the player holds now — an unchanged fragment
//     keeps its charge, a removed / moved / new one loses it and regrows (stanekplan.chargeTrackOf,
//     seeded with the live masses; the re-lay lands EPOCH.lagS later: stanek.js's pass). Every option
//     on the same Q members (bbplan.bladeMemberOf: the skill clock and the calibration posteriors),
//     so the decision is the PAIRED difference d = option - keep, per member.
//   HYSTERESIS (epochChoiceOf): switch only where -d >= EPOCH.minGainH AND d + EPOCH.z x se < 0 (two
//     standard errors over the members); otherwise keep.
//   ACT: progress.js publishes the record to EPOCH_FILE (every pass: the carried decision, its options,
//     hours, the chosen option and why); stanek.js re-lays to a 'switch' only from the layout it was
//     priced from (epochTargetOf), by diff (unchanged fragments keep their charge).
//   HEALTH (epochHealthOf): STANEK EPOCH STALE (no decision for more than EPOCH.staleEpochs periods, or
//     the decision threw) and STANEK EPOCH SWITCH NOT LANDED (a decided switch not placed after
//     EPOCH.landMin).
//   CALIBRATION, on every epoch (calibrationOf): the charger model vs live (highestCharge, duty), the
//     last epoch's forecast of the charge mass and of the rank at this epoch vs what the game did.
//
// ARCHITECTURE — in-game, on the route's own exit model, no daemon-side process: the decision runs
// inside progress.js on bbplan.bladeExitGen, the Bladeburner exit model the route decision already
// prices on the ONE live builder and calibrates live every pass (rank k, success k: decisions.bladeRoute
// .calibration). It is pure (0GB) and 10-40ms per exit, so an epoch (~50 exits: 5-6 table options x Q
// members + the screen + the shortlist) is 1-2s of work sliced through the plan's pacer, hourly and at
// the ~21 black ops. bbsim (the game's own classes) cannot run in-game (it is the bundled game source
// under node) and from the live state it would need a second state builder (it has no contract
// sleeves; its grid start lagged the live rank 41-52%) — so it is the replay's TRUTH WORLD instead
// (tools/sim/stanekepoch.mjs: the closed loop with this same function as the controller), where the
// controller's model error is part of what is measured.
//
// L4 HOOK: epochChoiceOf is generic over priced options ({kind, key, members}); a route option (the
// exit with the gift's route changed) joins the same comparison with kind 'route' — the decision and
// the record already carry `kind`.
//
// NOT SIMULATED, named: the charger's host growing within the node (the live power held), an install's
// clear of the charge inside the exit (the Bladeburner route never installs), and the hacking route
// (its exit model is life-averaged — L1 decides per life at the install epoch, L2 prices the in-life
// switch: none wins).
import { layoutMults, chargeTrackOf, relayDiffOf, fragKeyOf, sameLayout, layoutKeyOf, layoutFits, fragmentById, canPlace, orientations, layoutValue, chargeFactor, coreBonus, threadsOf, bladeHostGbAt, TYPE, FRAGMENTS, BLADE_LAYOUTS, BLADE_PHASE_PRICED, BLADE_HOST, BLADE_WEIGHTS, LAYOUT_MULT_KEYS } from 'stanekplan.js'
import { bladeExitGen, bladeMemberOf, BLADE_ENSEMBLE } from 'bbplan.js'

export const EPOCH_FILE = '/tel/stanekepoch.txt'
/**
 * FIXED, stated: periodMin the periodic epoch; z and minGainH the hysteresis (two standard errors and
 * 0.01h — L1/L2's tolerance); lagS a decided re-lay's landing (one stanek.js pass); screenSims /
 * shortlist the local search's CPU bound (one-member sims, then full-Q); staleEpochs / graceMin /
 * landMin the health thresholds; keep the epoch history kept in the record.
 */
export const EPOCH = { periodMin: 60, z: 2, minGainH: 0.01, lagS: 300, screenSims: 16, shortlist: 2, staleEpochs: 2, graceMin: 15, landMin: 15, keep: 12, maxH: 400 }

/** The fragment ids a Bladeburner layout searches over: the combat types, Bladeburner, Charisma, Hacking, and every booster. */
export const BLADE_SEARCH_IDS = FRAGMENTS.filter((f) => [TYPE.Strength, TYPE.Defense, TYPE.Dexterity, TYPE.Agility, TYPE.Bladeburner, TYPE.Charisma, TYPE.Hacking, TYPE.Booster].includes(f.type)).map((f) => f.id)

const fin = (x) => typeof x === 'number' && isFinite(x)
const canon = (placed) => placed.map((p) => fragKeyOf(p)).sort().join(';')
const plain = (placed) => (placed ?? []).map((p) => ({ id: p.id, x: p.x, y: p.y, rot: p.rot ?? p.rotation }))

/**
 * The gift as /tel/stanek.txt reads it: placed fragments (boosters included), each one's charge mass
 * (highestCharge x numCharge — StaneksGift.charge's invariant), the live charger's power H (the
 * biggest host's threads x coreBonus: charger.H) and the charged count k. null: nothing placed.
 */
export function liveGiftOf(st) {
  const fr = Array.isArray(st?.fragments) ? st.fragments : []
  if (!fr.length) return null
  const placed = plain(fr)
  const charges = fr.map((f) => ({ highestCharge: f.highestCharge ?? 0, numCharge: f.numCharge ?? 0 }))
  const masses = charges.map((c) => c.highestCharge * c.numCharge)
  const k = placed.filter((p) => fragmentById(p.id)?.type !== TYPE.Booster).length
  // the charger's power: the live charger's (threads x coreBonus), never below a fragment's highestCharge
  // (StaneksGift.charge keeps the highest; a charger that shrank still reads at the old highest)
  const H = Math.max(fin(st?.charger?.H) ? st.charger.H : 0, ...charges.map((c) => c.highestCharge))
  return { placed, charges, masses, mass: masses.reduce((s, m) => s + m, 0), H, k, at: st.at ?? null, nodePower: st?.layout?.nodePower ?? null, width: st?.layout?.width ?? null, height: st?.layout?.height ?? null }
}

/**
 * THE GIFT'S PATH OVER THE EXIT for an option: the live layout and charge from now, re-laid to
 * `target` (null: kept) lagS seconds in. factorAt(tS) -> {key: the gift's multiplier at tS / the one
 * at the live charge} (bbplan.bladeExitGen s0.gift). The charger at H threads (the live power, held),
 * duty, round robin over the charged fragments placed (stanekplan.chargeTrackOf).
 */
export function giftPathOf({ placed, charges, masses, target = null, H, duty = BLADE_HOST.duty, nodePower = 1, lagS = EPOCH.lagS, step = 60 }) {
  const track = chargeTrackOf({ thrAt: () => H, duty, step }).relay(placed, 0).seed(masses)
  const base = layoutMults(placed, charges, nodePower)
  const relay = Array.isArray(target) && !sameLayout(placed, target) ? target : null
  let relaid = false
  let now = placed
  const keys = LAYOUT_MULT_KEYS.filter((k) => k.startsWith('bladeburner_') || ['strength', 'strength_exp', 'defense', 'defense_exp', 'dexterity', 'dexterity_exp', 'agility', 'agility_exp', 'charisma', 'charisma_exp'].includes(k))
  return {
    target: relay,
    diff: relay ? relayDiffOf(placed, relay) : null,
    factorAt(tS) {
      if (relay && !relaid && tS >= lagS) {
        track.relay(relay, lagS)
        now = relay
        relaid = true
      }
      const m = layoutMults(now, track.at(tS), nodePower)
      const out = {}
      for (const k of keys) out[k] = (m[k] ?? 1) / (base[k] ?? 1)
      return out
    },
    masses: () => track.masses(),
    placed: () => now,
  }
}

/**
 * IS AN EPOCH DUE? prev: the last record (EPOCH_FILE / the plan's decisions.stanek.epoch). Returns
 * {due, kind, why}: 'first' (no decision this node), 'install' (a new life), 'blackop' (one completed
 * since), 'landed' (the placed layout is not the one the decision saw), 'periodic' (periodMin since).
 */
export function epochDueOf({ prev, now = Date.now(), lastAugReset, lastNodeReset, blackOps, placedKey, periodMin = EPOCH.periodMin }) {
  const d = prev?.decision ?? null
  if (!d || prev.lastNodeReset !== lastNodeReset || !fin(Date.parse(d.decidedAt ?? ''))) return { due: true, kind: 'first', why: 'no epoch decision in this node' }
  if (prev.lastAugReset !== lastAugReset) return { due: true, kind: 'install', why: 'an install: a new life (the charge cleared)' }
  if (fin(blackOps) && fin(d.blackOps) && blackOps !== d.blackOps) return { due: true, kind: 'blackop', why: `black ops ${d.blackOps} -> ${blackOps}` }
  if (placedKey && d.incumbentKey && placedKey !== d.incumbentKey && placedKey !== d.targetKey) return { due: true, kind: 'landed', why: `the placed layout ${placedKey} is neither the incumbent ${d.incumbentKey} nor the target the last epoch saw` }
  if (placedKey && d.kind === 'switch' && placedKey === d.targetKey && !d.landedAt) return { due: true, kind: 'landed', why: `the switch to ${d.targetKey} landed` }
  const ageMin = (now - Date.parse(d.decidedAt)) / 60e3
  if (ageMin >= periodMin) return { due: true, kind: 'periodic', why: `${ageMin.toFixed(0)} min since the last epoch (period ${periodMin})` }
  return { due: false, kind: null, why: `carried: the ${d.epochKind ?? '?'} epoch of ${d.decidedAt} (${ageMin.toFixed(0)} min ago)` }
}

/** The table candidates on this grid: the incumbent, the tabled Bladeburner layout, every L2 phase-table layout that fits. */
export function epochCandidatesOf({ incumbent, width, height, nodePower = 1 }) {
  const out = []
  const seen = new Set()
  const add = (src, placed) => {
    if (!Array.isArray(placed) || !placed.length || !layoutFits(placed, width, height)) return
    const c = canon(placed)
    if (seen.has(c)) return
    seen.add(c)
    out.push({ src, placed: plain(placed), key: layoutKeyOf(placed) })
  }
  add('incumbent', incumbent)
  add('tabled', BLADE_LAYOUTS[`${width}x${height}|${nodePower}`])
  for (const [cell, e] of Object.entries(BLADE_PHASE_PRICED)) {
    add(`L2 ${cell} early`, e.early)
    add(`L2 ${cell} late`, e.late)
  }
  return out
}

/**
 * THE LOCAL SEARCH'S NEIGHBOURS of a layout: every single-fragment REMOVE, MOVE (same id, another
 * root/rotation) and SWAP (another id in its place, anywhere legal), and every ADD of a fragment that
 * fits. Legal by stanekplan.canPlace (the game's StaneksGift.canPlace transcribed); deduplicated.
 */
export function neighboursOf(placed, width, height, ids = BLADE_SEARCH_IDS) {
  const out = []
  const seen = new Set([canon(placed)])
  const push = (src, pl) => {
    const c = canon(pl)
    if (seen.has(c)) return
    seen.add(c)
    out.push({ src, placed: pl, key: layoutKeyOf(pl) })
  }
  const placeAll = (base, src) => {
    for (const id of ids) {
      const f = fragmentById(id)
      for (const o of orientations(f))
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) if (canPlace(base, width, height, x, y, o.rot, f)) push(src(id), [...base, { id, x, y, rot: o.rot }])
    }
  }
  placed.forEach((p, i) => {
    const base = placed.filter((_, j) => j !== i)
    push(`remove ${p.id}@${p.x},${p.y}`, base)
    placeAll(base, (id) => (id === p.id ? `move ${p.id}` : `swap ${p.id}->${id}`))
  })
  placeAll(placed, (id) => `add ${id}`)
  return out
}

/** The linear screen's value (ORDER only): layoutValue on BLADE_WEIGHTS at the live charge factor. */
export const screenValueOf = (placed, c, nodePower) => layoutValue(placed, BLADE_WEIGHTS, c, nodePower)

/**
 * THE CHOICE WITH HYSTERESIS over priced options, incumbent first: each {kind, key, src, members:
 * [hours|null]} on the same members. d per member = option - incumbent (both finite); switch to the
 * best mean d only where -d >= minGainH and d + z x se < 0; else keep. Generic over `kind` (L4: routes).
 */
export function epochChoiceOf(priced, { z = EPOCH.z, minGainH = EPOCH.minGainH } = {}) {
  const inc = priced[0]
  const rows = priced.map((o, i) => {
    const pairs = (o.members ?? []).map((h, m) => [h, inc.members?.[m]]).filter(([a, b]) => fin(a) && fin(b))
    const n = pairs.length
    const ds = pairs.map(([a, b]) => a - b)
    const mean = n ? ds.reduce((s, x) => s + x, 0) / n : null
    const se = n > 1 ? Math.sqrt(ds.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) / n) : n === 1 ? Infinity : null
    const fh = (o.members ?? []).filter(fin)
    const hours = fh.length * 2 >= (o.members ?? []).length && fh.length ? fh.reduce((s, x) => s + x, 0) / fh.length : null
    const wins = i > 0 && n > 0 && n * 2 >= (inc.members ?? []).length && -mean >= minGainH && mean + z * se < 0
    return { kind: o.kind ?? 'layout', src: o.src, key: o.key, hours, d: i === 0 ? 0 : mean, se: i === 0 ? 0 : se, n, wins }
  })
  const best = rows.filter((r) => r.wins).reduce((b, r) => (!b || r.d < b.d ? r : b), null)
  const bestAny = rows.slice(1).filter((r) => fin(r.d)).reduce((b, r) => (!b || r.d < b.d ? r : b), null)
  const txt = (r) => `${r.src} ${r.key}: d ${r.d.toFixed(3)} +- ${fin(r.se) ? r.se.toFixed(3) : 'inf'}h`
  if (!rows[0] || !fin(rows[0].hours)) return { kind: 'keep', rows, best: null, why: 'the incumbent exit is unpriced: kept (no comparison)' }
  if (best) return { kind: 'switch', rows, best, why: `${txt(best)} vs keeping (gain >= ${minGainH}h and d + ${z}se < 0)` }
  return { kind: 'keep', rows, best: null, why: bestAny ? `no option clears the hysteresis (-d >= ${minGainH}h and d + ${z}se < 0); the best ${txt(bestAny)}` : 'no other option priced' }
}

/**
 * THE CHARGER'S CALIBRATION at this epoch: the ramp model (BLADE_HOST mid, 1 core, at the node's age)
 * and the measured host vs the live highestCharge; the duty from the charge mass grown since the last
 * epoch (sum of masses grows by duty x H per second: each call adds the threads to one fragment) vs
 * BLADE_HOST.duty; the last epoch's forecast of the mass and the rank at this epoch vs live.
 */
export function calibrationOf({ live, prev, nodeAgeH, rank = null, lastAugReset = null, now = Date.now() }) {
  const pct = (m, l) => (fin(m) && fin(l) && l !== 0 ? +((m / l - 1) * 100).toFixed(1) : null)
  const rampH = threadsOf(bladeHostGbAt(nodeAgeH, { gbMax: BLADE_HOST.gbMax.mid }), BLADE_HOST.cores)
  const out = { charger: { live: live.H, ramp: rampH, rampErrPct: pct(rampH, live.H), measured: BLADE_HOST.measured.H, measuredErrPct: pct(BLADE_HOST.measured.H, live.H), used: 'live' } }
  const pt = prev?.decision?.track
  if (pt && fin(pt.mass) && fin(Date.parse(pt.at ?? '')) && prev?.decision?.lastAugReset === lastAugReset) {
    const dtS = (Date.parse(live.at ?? new Date(now).toISOString()) - Date.parse(pt.at)) / 1000
    if (dtS > 60) {
      const dutyLive = (live.mass - pt.mass) / (pt.H * dtS)
      out.duty = { live: +dutyLive.toFixed(4), model: BLADE_HOST.duty, errPct: pct(BLADE_HOST.duty, dutyLive), overS: Math.round(dtS), note: pt.relaid ? 'a re-lay deleted charge in the window: the duty reads low' : null }
      // the mass forecast: the last epoch's chosen option's track advanced dtS
      const fc = pt.forecast
      if (fc && Array.isArray(fc.tS) && fc.tS.length) {
        let j = 0
        while (j + 1 < fc.tS.length && fc.tS[j + 1] <= dtS) j++
        const pred = fc.mass[j]
        out.mass = { predicted: Math.round(pred), live: Math.round(live.mass), errPct: pct(pred, live.mass), atS: fc.tS[j] }
      }
    }
  }
  const rp = prev?.decision?.rankPath
  if (Array.isArray(rp) && rp.length && fin(rank) && fin(Date.parse(prev.decision.decidedAt ?? ''))) {
    const h = (now - Date.parse(prev.decision.decidedAt)) / 3.6e6
    const ok = rp.filter((p) => p.h <= h)
    const p = ok.length ? ok[ok.length - 1] : null
    if (p && h <= rp[rp.length - 1].h + 0.25) out.rank = { predicted: Math.round(p.rank), live: Math.round(rank), errPct: pct(p.rank, rank), atH: p.h, overH: +h.toFixed(2) }
    else out.rank = { predicted: null, live: Math.round(rank), why: `the last epoch's path covers ${rp[rp.length - 1].h}h; ${h.toFixed(2)}h passed` }
  }
  return out
}

/**
 * THE EPOCH DECISION (a generator: yields between simulations for the caller's pacer). s0: the
 * Bladeburner route's live start (bbplan.bladeStartOf); live: liveGiftOf(/tel/stanek.txt); duty: the
 * measured duty (else BLADE_HOST.duty). Returns the decision record (see the header).
 */
export function* epochDecisionGen({ s0, live, width, height, nodePower, duty = BLADE_HOST.duty, Q = BLADE_ENSEMBLE.Q, budget = {}, now = Date.now(), lagS = EPOCH.lagS, pol = undefined, hysteresis = { z: EPOCH.z, minGainH: EPOCH.minGainH } }) {
  const t0 = Date.now()
  const B = { screenSims: budget.screenSims ?? EPOCH.screenSims, shortlist: budget.shortlist ?? EPOCH.shortlist, rounds: budget.rounds ?? 1 }
  let sims = 0
  const memo = new Map()
  function* memberH(placed, m) {
    const c = `${canon(placed)}|${m}`
    if (!memo.has(c)) {
      const gift = giftPathOf({ ...live, target: placed, H: live.H, duty, nodePower, lagS })
      const r = yield* bladeExitGen(bladeMemberOf({ ...s0, gift, maxH: s0.maxH ?? EPOCH.maxH }, m, Q), pol)
      sims++
      memo.set(c, fin(r?.hours) ? r.hours : null)
    }
    return memo.get(c)
  }
  function* allMembers(placed) {
    const out = []
    for (let m = 0; m < Q; m++) out.push(yield* memberH(placed, m))
    return out
  }
  const incumbent = live.placed
  const table = epochCandidatesOf({ incumbent, width, height, nodePower })
  const priced = []
  for (const o of table) priced.push({ kind: 'layout', ...o, members: yield* allMembers(o.placed) })
  // THE LOCAL SEARCH around the best priced so far (by the members' mean)
  const meanOf = (xs) => {
    const f = xs.filter(fin)
    return f.length * 2 >= xs.length && f.length ? f.reduce((s, x) => s + x, 0) / f.length : Infinity
  }
  const c = chargeFactor(live.H, (live.masses.find((m) => m > 0) ?? 0) / Math.max(1, live.H))
  const search = { rounds: [], screened: 0 }
  for (let r = 0; r < B.rounds; r++) {
    const centre = priced.reduce((b, o) => (meanOf(o.members) < meanOf(b.members) ? o : b), priced[0])
    const nb = neighboursOf(centre.placed, width, height).filter((o) => !priced.some((p) => p.key === o.key))
    nb.sort((a, b) => screenValueOf(b.placed, c, nodePower) - screenValueOf(a.placed, c, nodePower))
    const screened = []
    for (const o of nb.slice(0, B.screenSims)) {
      screened.push({ ...o, h0: yield* memberH(o.placed, 0) })
      yield
    }
    search.screened += screened.length
    const inc0 = priced[0].members[0]
    const top = screened.filter((o) => fin(o.h0) && (!fin(inc0) || o.h0 < inc0)).sort((a, b) => a.h0 - b.h0).slice(0, B.shortlist)
    for (const o of top) priced.push({ kind: 'layout', src: `search: ${o.src} (from ${centre.src})`, placed: o.placed, key: o.key, members: yield* allMembers(o.placed) })
    search.rounds.push({ centre: centre.key, neighbours: nb.length, screened: screened.length, shortlisted: top.map((o) => o.key) })
  }
  const choice = epochChoiceOf(priced, hysteresis)
  const chosen = choice.kind === 'switch' ? priced.find((o) => o.key === choice.best.key) : priced[0]
  // the chosen option's forecasts for the next epoch's calibration: the charge mass (its track) and the rank (member 0's path)
  const gift = giftPathOf({ ...live, target: chosen.placed, H: live.H, duty, nodePower, lagS })
  const tS = [0, 900, 1800, 3600, 5400, 7200, 10800]
  const fmass = tS.map((t) => {
    gift.factorAt(t)
    return gift.masses().reduce((s, m) => s + m, 0)
  })
  let rankPath = null
  try {
    const pr = yield* bladeExitGen({ ...bladeMemberOf({ ...s0, gift: giftPathOf({ ...live, target: chosen.placed, H: live.H, duty, nodePower, lagS }) }, 0, Q), maxH: 3, pathEveryS: 900 }, pol)
    rankPath = (pr?.path ?? []).map((p) => ({ h: p.h, rank: p.rank }))
  } catch {
    rankPath = null
  }
  return {
    kind: choice.kind,
    why: choice.why,
    incumbentKey: priced[0].key,
    targetKey: choice.kind === 'switch' ? chosen.key : priced[0].key,
    target: choice.kind === 'switch' ? chosen.placed : null,
    from: plain(incumbent),
    relay: choice.kind === 'switch' ? (({ keep, remove, place }) => ({ kept: keep.length, removed: remove.length, placed: place.length }))(relayDiffOf(incumbent, chosen.placed)) : null,
    d: choice.kind === 'switch' ? +choice.best.d.toFixed(4) : null,
    se: choice.kind === 'switch' ? +choice.best.se.toFixed(4) : null,
    options: choice.rows.map((r) => ({ kind: r.kind, src: r.src, key: r.key, hours: fin(r.hours) ? +r.hours.toFixed(3) : null, d: fin(r.d) ? +r.d.toFixed(4) : null, se: fin(r.se) ? +r.se.toFixed(4) : null, n: r.n, wins: r.wins })),
    members: Q,
    hysteresis,
    search,
    track: { at: live.at, mass: live.mass, H: live.H, duty, relaid: false, forecast: { tS, mass: fmass } },
    rankPath,
    cpu: { sims, ms: Date.now() - t0 },
  }
}

/**
 * THE EPOCH TARGET stanek.js acts on (EPOCH_FILE, this node and life, fresh): {kind, placed (null =
 * keep what is placed), why, key, decidedAt} or null (no fresh decision: L2's phase plan / the table).
 * A 'switch' re-lays only from the layout it was priced from (`from`); landed when the target is placed.
 */
export function epochTargetOf(text, resetInfo, active, width, height, now = Date.now(), maxAgeMin = EPOCH.periodMin * (EPOCH.staleEpochs + 1)) {
  let rec = null
  try {
    rec = JSON.parse(text || 'null')
  } catch {
    return null
  }
  const d = rec?.decision
  if (!rec || rec.lastAugReset !== resetInfo?.lastAugReset || rec.lastNodeReset !== (resetInfo?.lastNodeReset ?? null) || !d) return null
  if (!(now - Date.parse(d.decidedAt ?? '') < maxAgeMin * 60e3)) return null
  const act = active ?? []
  if (d.kind === 'switch' && Array.isArray(d.target) && layoutFits(d.target, width, height)) {
    if (sameLayout(act, d.target)) return { kind: 'switch', state: 'landed', placed: d.target, key: d.targetKey, decidedAt: d.decidedAt, why: `the epoch's switch to ${d.targetKey} is placed` }
    if (Array.isArray(d.from) && sameLayout(act, d.from)) return { kind: 'switch', state: 'switching', placed: d.target, key: d.targetKey, decidedAt: d.decidedAt, why: `epoch ${d.epochKind} ${d.decidedAt}: re-lay ${d.incumbentKey} -> ${d.targetKey} (d ${d.d}h +- ${d.se})`.slice(0, 300) }
    return { kind: 'switch', state: 'held', placed: null, key: d.targetKey, decidedAt: d.decidedAt, why: `the epoch's switch was priced from ${d.incumbentKey}; the placed layout is neither it nor the target: kept until the next epoch` }
  }
  return { kind: 'keep', state: 'keep', placed: null, key: d.incumbentKey, decidedAt: d.decidedAt, why: `epoch ${d.epochKind} ${d.decidedAt}: keep (${String(d.why ?? '').slice(0, 200)})` }
}

/**
 * HEALTH (healthcheck via stanekplan.stanekHealthOf): where the gift is accepted on the Bladeburner
 * basis with a layout placed —
 *   STANEK EPOCH STALE           no decision for more than staleEpochs x periodMin (+ graceMin), none in
 *                                this node graceMin after the layout was placed, or the last one threw
 *   STANEK EPOCH SWITCH NOT LANDED a decided switch not placed landMin after the decision
 */
export function epochHealthOf({ epoch, stanek, now = Date.now(), nodeStartMs = null }) {
  const g = stanek?.gift ?? {}
  if (!g.accepted || g.basis !== 'blade' || !(stanek?.fragments?.length > 0)) return []
  const S = 'STANEK EPOCH STALE'
  const d = epoch?.decision ?? null
  const thisNode = epoch && epoch.lastNodeReset === (stanek.lastNodeReset ?? null)
  if (epoch?.error && thisNode) return [{ key: S, problem: S, detail: `the epoch decision threw: ${String(epoch.error).slice(0, 200)}` }]
  if (!thisNode || !d) {
    const inMin = fin(nodeStartMs) ? (now - nodeStartMs) / 60e3 : null
    if (inMin === null || inMin >= EPOCH.graceMin + 15) return [{ key: S, problem: S, detail: `no epoch decision for this node in ${EPOCH_FILE} (${epoch ? `the record is node ${epoch.lastNodeReset}` : 'absent'})${inMin === null ? '' : `, ${inMin.toFixed(0)} min into the node`}` }]
    return []
  }
  const out = []
  const ageMin = (now - Date.parse(d.decidedAt ?? '')) / 60e3
  const lim = EPOCH.staleEpochs * EPOCH.periodMin + EPOCH.graceMin
  if (!(ageMin <= lim)) out.push({ key: S, problem: S, detail: `the last epoch decision is ${fin(ageMin) ? ageMin.toFixed(0) + ' min' : 'undated'} old (more than ${EPOCH.staleEpochs} epochs: ${lim} min) — progress.js is not deciding` })
  const placedKey = stanek.layout?.placedKey ?? null
  if (d.kind === 'switch' && placedKey !== d.targetKey && ageMin >= EPOCH.landMin && epoch.lastAugReset === stanek.lastAugReset) {
    const N = 'STANEK EPOCH SWITCH NOT LANDED'
    out.push({ key: N, problem: N, detail: `the epoch decided ${d.incumbentKey} -> ${d.targetKey} ${ageMin.toFixed(0)} min ago and the placed layout is ${placedKey ?? '(none)'}${stanek.lifeLayout?.epoch?.why ? ` (stanek.js: ${stanek.lifeLayout.epoch.why})` : ''}` })
  }
  return out
}

/** The record progress.js writes to EPOCH_FILE every pass: the carried decision, the epoch history, the calibration. */
export function epochRecordOf({ prev, decision, due, resetInfo, now = Date.now(), error = null, calibration = null, why = null }) {
  const hist = prev?.lastNodeReset === (resetInfo?.lastNodeReset ?? null) && Array.isArray(prev?.history) ? prev.history : []
  const fresh = decision && decision !== prev?.decision
  const history = fresh ? [{ at: decision.decidedAt, epoch: decision.epochKind, kind: decision.kind, from: decision.incumbentKey, to: decision.targetKey, d: decision.d, se: decision.se, ms: decision.cpu?.ms ?? null }, ...hist].slice(0, EPOCH.keep) : hist
  return { at: new Date(now).toISOString(), node: resetInfo?.currentNode ?? null, lastAugReset: resetInfo?.lastAugReset ?? null, lastNodeReset: resetInfo?.lastNodeReset ?? null, due: due ?? null, decision: decision ?? null, calibration: calibration ?? decision?.calibration ?? null, history, error, why }
}
