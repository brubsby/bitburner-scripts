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

/** What /tel/progress.txt publishes as `route`: acted, priced, pinned, forgone. */
export function routeReportOf(pin, d) {
  const acted = d ? d.key ?? null : 'hack'
  const priced = d ? (d.pin ? d.pin.pricedKey ?? null : d.key ?? null) : null
  return {
    route: acted ?? 'hack',
    priced,
    pinned: pin?.pinned === true,
    forgoneH: d?.pin ? d.pin.forgoneH ?? null : pin?.pinned ? (d ? 0 : null) : null,
    pin: { file: pin?.file ?? ROUTE_PIN, text: pin?.text ?? null, node: pin?.node ?? null, warn: pin?.warn ?? null, why: pin?.why ?? null },
    why: d ? null : 'no Bladeburner route in this node (no division): the hacking route is the only one',
  }
}
