// THE ROUTE PIN. Pure, no ns calls (imported by progress.js; free).
//
// WHY THIS EXISTS. The route decision (progress.js bladeRouteOf,
// plan.decideBladeRouteGen) compares two exits — the 21 black ops ('blade')
// and the World Daemon ('hack') — and commits the faster. In BN9.2 it chose
// 'blade' and exited without The Red Pill ever being bought: on that route the
// install decision prices the black-op exit, the work slot is the division's,
// Daedalus is never targeted. The user (2026-10-09) wants the next node played
// on the HACKING exit regardless — Daedalus, The Red Pill installed, the
// hidden 19x19 Go opponent (w0r1d_d43m0n, netscriptGoImplementation.ts:359:
// playable only with The Red Pill INSTALLED) played on the way, and the exit
// by hacking w0r1d_d43m0n — even where the black ops price faster.
//
// THE FILE: /route-pin.txt on home. A text file on home survives installs.
//   hack            pin the hacking route in whatever node this is
//   hack 12         pin it only in BitNode 12 (anything after is the reason)
//   hack node=12    the same
// The first word is the route; only 'hack' is accepted. Anything else, or a
// node that is not this one, is reported (`warn`) and NOT acted on.
//
// WHAT IT DOES. The route decision is priced exactly as before; the pin only
// changes the key the stack ACTS on to 'hack' (pinnedRouteOf), naming what was
// priced and the hours forgone (hackH - bladeH on the same pass). The
// decision's commitment rule keeps running on the UNPINNED record
// (unpinnedOf), so deleting the file restores the priced route next pass.
//
// STANEK'S GIFT NEVER PINS (L4, 2026-10-16). Accepting the gift changes the INPUTS to the route
// decision, not the decision: progress.js prices both routes conditioned on it (plan.decideBladeRouteGen
// `gift`) and acts on the priced one. The gift's automatic pin (giftPinOf: 'blade' outside BN13, 'hack'
// in BN13) is gone — on 2026-10-15 it was misapplied and cost BN11.1 ~1.2h of the wrong route and a
// charge wipe. Only this file pins; the gift is reported beside the route (routeReportOf `gift`).
//
// WHAT IT NEVER DOES. The exit itself stays endgame.js's (the only
// destroyW0r1dD43m0n caller, after its /endgame-hold.txt read); act.js refuses
// a w0r1d_d43m0n backdoor. Nothing here acts on the world daemon.

export const ROUTE_PIN = '/route-pin.txt'

/**
 * Parse the pin for this node. Published whether or not it acts (absence is
 * never a signal: an absent pin reads `pinned: false` WITH the reason).
 * Returns { pinned, route, node, file, text, warn, why }.
 */
export function routePinOf(text, currentNode) {
  const raw = String(text ?? '').trim()
  const base = { file: ROUTE_PIN, text: raw ? raw.slice(0, 200) : null, route: null, node: null }
  if (!raw) return { ...base, pinned: false, warn: null, why: `no ${ROUTE_PIN}: the route is the priced one` }
  const words = raw.split(/\s+/)
  const route = words[0].toLowerCase()
  const m = String(words[1] ?? '').match(/^(?:node=)?(\d+)$/i)
  const node = m ? Number(m[1]) : null
  const out = { ...base, route, node }
  if (route !== 'hack') return { ...out, pinned: false, warn: `${ROUTE_PIN} names route '${words[0]}' — only 'hack' can be pinned; NOT acting on it`, why: 'pin unreadable' }
  if (node !== null && node !== currentNode) return { ...out, pinned: false, warn: `${ROUTE_PIN} pins BitNode ${node}, this is BitNode ${currentNode} — NOT acting on it (delete or rewrite the file)`, why: `pin for another node (${node})` }
  return { ...out, pinned: true, warn: null, why: `${ROUTE_PIN} pins the hacking route${node !== null ? ` in BitNode ${node}` : ''}: Daedalus, The Red Pill installed, the World Daemon by hacking (endgame.js) — even where the black ops price faster` }
}

/**
 * The route decision the stack ACTS on. `d` is the priced record. Pinned:
 * key 'hack', `pin` naming the priced key and the hours forgone. Otherwise
 * `d` unchanged. An unpriced record (key null) keeps key null — nothing reads
 * 'blade' then, which is already the hacking route — and carries the pin.
 */
export function pinnedRouteOf(d, pin) {
  if (!pin?.pinned || !d || typeof d !== 'object') return d
  const pricedKey = d.key ?? null
  const fin = (x) => typeof x === 'number' && isFinite(x)
  // Only /route-pin.txt pins, and only 'hack' (routePinOf): a pin of anything else is not acted on.
  if (pin.route !== 'hack' || pin.file !== ROUTE_PIN) return { ...d, pin: { file: pin.file ?? null, text: pin.text ?? null, pricedKey, forgoneH: 0, ignored: `not ${ROUTE_PIN}'s 'hack' pin: the priced route is acted on` } }
  const forgoneH = pricedKey === 'blade' && fin(d.hackH) && fin(d.bladeH) ? +(d.hackH - d.bladeH).toFixed(3) : pricedKey === 'hack' ? 0 : null
  const note = { file: pin.file ?? ROUTE_PIN, text: pin.text ?? null, pricedKey, forgoneH }
  if (pricedKey !== 'blade') return { ...d, pin: note }
  return {
    ...d,
    key: 'hack',
    pin: note,
    why: `PINNED to 'hack' by ${note.file}: the priced route is 'blade' (${fin(d.bladeH) ? d.bladeH.toFixed(1) : '?'}h by the black ops vs ${fin(d.hackH) ? d.hackH.toFixed(1) : '?'}h by the World Daemon; ${fin(forgoneH) ? forgoneH.toFixed(1) + 'h forgone' : 'forgone hours unpriced'}) — ${String(d.why ?? '').slice(0, 200)}`,
  }
}

/** The record the commitment rule compares against: the PRICED key, never the pin's. */
export function unpinnedOf(prev) {
  if (!prev || typeof prev !== 'object' || !prev.pin || typeof prev.pin !== 'object') return prev
  const { pin, ...rest } = prev
  return { ...rest, key: pin.pricedKey ?? null }
}

/**
 * What /tel/progress.txt publishes as `route`: acted, priced, pinned (the FILE pin only), forgone, and
 * `gift` — a record, never a pin: whether the gift is accepted and whether the route was priced with it
 * (d.gift from plan.decideBladeRouteGen).
 */
export function routeReportOf(pin, d, giftState = null) {
  const acted = d ? d.key ?? null : 'hack'
  const priced = d ? (d.pin ? d.pin.pricedKey ?? null : d.key ?? null) : null
  return {
    route: acted ?? 'hack',
    priced,
    pinned: pin?.pinned === true && pin?.file === ROUTE_PIN,
    forgoneH: d?.pin ? d.pin.forgoneH ?? null : pin?.pinned ? (d ? 0 : null) : null,
    pin: { file: pin?.file ?? ROUTE_PIN, text: pin?.text ?? null, node: pin?.node ?? null, warn: pin?.warn ?? null, why: pin?.why ?? null },
    gift: giftRecordOf(giftState, d),
    // an arm that could not be priced (plan.unpricedHoldOf): published, never a silent loss for it
    unpriced: Array.isArray(d?.unpriced) && d.unpriced.length ? d.unpriced : null,
    held: d?.held === true,
    why: d ? null : 'no Bladeburner route in this node (no division): the hacking route is the only one',
  }
}

/** The gift beside the route (L4): accepted?, priced with it?, the arms' chosen options. Never a pin. */
export function giftRecordOf(gift, d) {
  if (!gift?.accepted) return { accepted: false, pinned: false, why: gift?.why ?? 'not accepted' }
  const g = d?.gift ?? null
  return {
    accepted: true,
    node: gift.node ?? null,
    pinned: false,
    pricedWithGift: g?.priced === true,
    hackArm: g?.['hack']?.chosen ?? null, // never `.hack` / `hack:` here: the RAM calculator bills the name (ns.hack, 0.1GB)
    bladeArm: g?.blade?.chosen ?? null,
    awakeningBound: g?.awakeningBound ?? null,
    why: g?.priced === true ? "Stanek's Gift accepted: both routes priced with it (Genesis's x0.9 in the live multipliers, the placed layout's charge, the re-lay each route needs, its installs) — an input, not a pin" : `Stanek's Gift accepted but the route was NOT priced with it: ${g?.why ?? (d ? 'the decision carries no gift record' : 'no route decision')}`,
  }
}

/**
 * ROUTE HEALTH (tools/healthcheck.mjs): /tel/progress.txt `route` of this node. Fails —
 *   ROUTE NOT THE PRICED ONE   the route acted on differs from the priced one with no /route-pin.txt pin
 *                              (an automatic pin came back), or a pin from anything but /route-pin.txt
 *   ROUTE NOT PRICED WITH THE GIFT  the gift is accepted and the priced route did not carry it
 *   STANEK LAYOUT OFF ROUTE    the gift is accepted and /tel/stanek.txt's basis is not the acted route
 *                              (stanekplan.giftStateOf: the layout decision follows the route)
 * Returns [{key, problem, detail}].
 */
export function routeHealthOf({ route, stanek = null, node = null }) {
  if (!route || (node !== null && route.node !== node)) return []
  const out = []
  const R = 'ROUTE NOT THE PRICED ONE'
  const filePin = route.pinned === true && (route.pin?.file ?? ROUTE_PIN) === ROUTE_PIN
  if (route.pinned === true && !filePin) out.push({ key: R, problem: R, detail: `the route is pinned by ${route.pin?.file} — only ${ROUTE_PIN} may pin (the gift's pin is gone: L4)` })
  else if (!filePin && route.priced != null && route.route !== route.priced) out.push({ key: R, problem: R, detail: `the stack acts on '${route.route}' while the priced route is '${route.priced}', and no ${ROUTE_PIN} pins it` })
  if (Array.isArray(route.unpriced) && route.unpriced.length) {
    const U = 'ROUTE ARM UNPRICED'
    out.push({ key: U, problem: U, detail: `the ${route.unpriced.join(' and ')} arm of the route decision is unpriced — ${route.held ? `held on '${route.route}'` : 'no route decided (the stack defaults to the hacking route)'}; it never loses by default (plan.unpricedHoldOf)` })
  }
  if (route.gift?.accepted === true && route.priced != null && route.gift.pricedWithGift !== true) {
    const G = 'ROUTE NOT PRICED WITH THE GIFT'
    out.push({ key: G, problem: G, detail: String(route.gift.why ?? 'the gift is accepted and the route decision did not price it').slice(0, 300) })
  }
  const sb = stanek?.gift?.accepted === true && stanek.node === route.node && stanek.lastAugReset === route.lastAugReset ? stanek.gift.basis : null
  // only where stanek.js read THIS route (gift.route: what it read from /tel/progress.txt) — a switch it has
  // not read yet is one stanek.js pass away (STANEK STALE covers a stanek.js that stopped reading)
  if (sb && (route.route === 'hack' || route.route === 'blade') && sb !== route.route && stanek.gift.route === route.route) {
    const S = 'STANEK LAYOUT OFF ROUTE'
    out.push({ key: S, problem: S, detail: `the route is '${route.route}' and stanek.js lays the gift for '${sb}' (${STANEK_NOTE})` })
  }
  return out
}
const STANEK_NOTE = 'stanekplan.giftStateOf: an accepted gift serves the acted route; stanek.js reads it from /tel/progress.txt'
