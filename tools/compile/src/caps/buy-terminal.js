// caps/buy.js — the arm compiled in when the Singularity API is NOT callable
//   sfgate.canUseSingularity(resetInfo) === false
//   (BitNodeUtils.ts:17 — SF4 at any level, OR currently inside BitNode 4)
//
// The terminal's own `buy` command is not Source-File gated, so this route
// works in every BitNode. It costs ns.read + ns.write + ns.fileExists, all of
// which are 0.1GB or free.
//
// It is also the FALLBACK inside the singularity arm (caps/buy-sing.js imports
// it), because `ns.exec` returning 0 for lack of RAM is a real and frequent
// event when the batcher has the fleet at ~98%. So this file is in every build;
// what varies is whether ns.exec and the helper script exist alongside it.

const CMD_IN = '/cmd/in.txt'
const BUSY = '/cmd/busy.txt'

/** What the status file should call this route. */
export const ROUTE = 'terminal'

/**
 * Can a script buy the TOR router at all?
 *
 * No — and this is a capability, not a preference. The terminal's `buy`
 * requires the darkweb, and the darkweb is what TOR connects
 * (ServerHelpers.ts:354-356), so there is no bootstrap. Retrying floods the
 * terminal with the same error every tick; it did exactly that for half an
 * hour. autobuy.js says it once and leaves it to a human or to torbuy.js,
 * which drives the Alpha Enterprises button through the DOM.
 */
export const CAN_BUY_TOR = false

export const TOR_ADVICE =
  'autobuy: TOR router is needed and cannot be bought by a script without Source-File 4 — buy it at Alpha Enterprises (Sector-12) for $200k. Every port program after that is automatic.'

/**
 * Is the bridge still working through something?
 *
 * /cmd/in.txt exists while commands are queued but not yet consumed;
 * /cmd/busy.txt exists while a batch is executing. Either means a previous
 * request is still in flight, and queueing more is how the same purchase gets
 * requested a dozen times. Waiting on busy.txt ALONE is invariant C7's silent
 * failure: between the write to in.txt and its pickup there is a window in
 * which neither file exists.
 */
export const bridgeBusy = (ns) => ns.fileExists(CMD_IN, 'home') || ns.fileExists(BUSY, 'home')

/** Queue terminal commands for cmd.js. Appends if something is already pending. */
function queue(ns, lines) {
  const existing = ns.fileExists(CMD_IN, 'home') ? ns.read(CMD_IN) : ''
  ns.write(CMD_IN, (existing ? existing.trimEnd() + '\n' : '') + lines.join('\n'), 'w')
}

/**
 * Buy `items` (program filenames, or 'tor').
 *
 * Returns {route, requested, deferred} — never throws, and never reports
 * success it cannot see. A queued `buy` is a REQUEST: the purchase has not
 * happened when this returns, which is why autobuy.js keeps its own in-flight
 * map rather than believing this.
 */
export function buy(ns, items) {
  const requested = items.filter((i) => i !== 'tor')
  const deferred = items.filter((i) => i === 'tor')
  if (requested.length) queue(ns, requested.map((f) => `buy ${f}`))
  return { route: ROUTE, requested, deferred }
}
