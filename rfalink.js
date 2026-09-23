// KEEPS THE REMOTE FILE API CONNECTED, from inside the game.
//
// THE FAILURE THIS EXISTS TO PREVENT. The machine suspends (KDE idle suspend,
// 1-4 times a day for the last fortnight). The game survives it — on 2026-09-23
// a 393-minute suspend passed with karma moving -38,943 -> -57,231 and an
// install landing — but the websocket does not. The game shows "Reconnecting"
// and stays there, so every /tel file freezes at the moment of sleep while the
// run carries on underneath. Six consecutive hourly checks read a snapshot from
// 03:35 and could not tell a frozen view from a quiet game.
//
// THE RECONNECT CANNOT COME FROM OUTSIDE. The Remote File API is the game
// connecting to US (tools/rfa-daemon.mjs is the server), so no amount of
// daemon-side supervision can re-establish it — the initiative has to be on
// the page. `npm run daemon` now also holds a systemd sleep inhibitor, which
// stops the suspend happening at all while it runs; this script is the other
// half, for the suspends that happen anyway (lid close, a manual suspend, or
// the daemon not running at the time).
//
// It is the same lesson as the Go solver: a run with no human in it cannot
// depend on a human noticing. Reconnecting was documented in CLAUDE.md as
// something an agent with browser access could do — which is true, and still
// leaves the run blind for however long it takes someone to look.
//
// HOW. `window.webpackChunkbitburner` hands out __webpack_require__ and with it
// the live module cache, exactly as errlog.js reaches ErrorState. `window` is
// reached through eval so the RAM checker never prices it (the trick cmd.js and
// infilhelper.js use). RemoteFileAPI.ts exports the three functions needed:
// getRemoteFileApiConnectionStatus, isRemoteFileApiConnectionLive and
// newRemoteFileApiConnection.
//
// WHY IT IS SAFE TO RUN CONSTANTLY. It only ever calls newRemoteFileApiConnection
// when the game itself reports the link is NOT live, and then not again for
// RETRY_MS — so a genuinely dead daemon produces one attempt a minute, not a
// reconnect storm. A live connection is left completely alone.
import { reporter, describe, record } from 'status.js'

const STATUS = '/tel/rfalink.txt'
const MODULE_ID = './src/RemoteFileAPI/RemoteFileAPI.ts'
/** Checked this often; the cost is one module-cache lookup. */
const TICK_MS = 5000
/** Never reconnect more than once per this — a dead daemon must not be spammed. */
const RETRY_MS = 60000

/** Pull the RemoteFileAPI module out of the webpack cache. {api} or {error}. */
function reachApi() {
  const win = eval('window')
  const hook = win.webpackChunkbitburner
  if (!hook || typeof hook.push !== 'function') {
    return { error: 'window.webpackChunkbitburner missing — not a webpack dev build?' }
  }
  let req = null
  try {
    hook.push([[`rfalink_${Date.now()}`], {}, (r) => (req = r)])
  } catch (err) {
    return { error: `chunk push threw: ${err}` }
  }
  if (!req) return { error: 'chunk push did not invoke the runtime callback' }
  const cache = req.c
  if (!cache) return { error: '__webpack_require__ has no module cache' }
  const ok = (e) =>
    e &&
    typeof e.isRemoteFileApiConnectionLive === 'function' &&
    typeof e.newRemoteFileApiConnection === 'function' &&
    typeof e.getRemoteFileApiConnectionStatus === 'function'
  // The known path first, then a shape scan, so a file rename degrades to
  // "slower" rather than "blind" — errlog.js's pattern.
  if (ok(cache[MODULE_ID]?.exports)) return { api: cache[MODULE_ID].exports, via: MODULE_ID }
  for (const id of Object.keys(cache)) {
    if (ok(cache[id]?.exports)) return { api: cache[id].exports, via: id }
  }
  return { error: 'RemoteFileAPI not found in the module cache' }
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog('ALL')
  const errors = []
  const publish = reporter(ns, STATUS, () => ({ errors: errors.slice(-5) }))
  // THE DAEMON ONLY MIRRORS /tel/* FROM HOME, and boot.js places this script
  // `where: 'anywhere'`. Without this push its telemetry is written to
  // whichever rooted host it landed on and is never seen again — which is
  // exactly how its own absence went unnoticed: it exited on home, was later
  // re-placed on n00dles by a boot re-entry, and published into the void while
  // the last record anyone could read still said "stopped" from hours earlier.
  // sleeve.js was fixed for this same reason; the fix simply was not carried
  // to the script written afterwards. Invariant C12 now enforces it.
  const mirror = () => {
    try {
      if (ns.getHostname() !== 'home') ns.scp(STATUS, 'home', ns.getHostname())
    } catch {
      /* home unreachable; the local copy still stands */
    }
  }
  const note = (health, fields) => {
    publish(health, fields)
    mirror()
  }
  ns.atExit(() => {
    publish.exit('stopped', { detail: 'rfalink.js exited' })
    mirror()
  })

  let reconnects = 0
  let lastTry = 0
  let lastStatus = null
  while (true) {
    try {
      const { api, error, via } = reachApi()
      if (error) {
        // REACHING THE MODULE CACHE IS THE ONE THING A GAME UPGRADE COULD
        // BREAK, so it fails loud and by name rather than looking idle.
        note('warn', { result: 'unreachable', detail: error, reconnects })
      } else {
        const live = api.isRemoteFileApiConnectionLive()
        const status = api.getRemoteFileApiConnectionStatus()
        const now = Date.now()
        if (!live && now - lastTry >= RETRY_MS) {
          lastTry = now
          reconnects++
          api.newRemoteFileApiConnection()
          ns.print(`rfalink: status ${status}, not live — reconnecting (#${reconnects})`)
          note('warn', { result: 'reconnecting', status, reconnects, via, detail: `link was '${status}' and not live; called newRemoteFileApiConnection` })
        } else if (status !== lastStatus) {
          note(live ? 'ok' : 'warn', { result: live ? 'live' : 'down', status, reconnects, via, detail: `link ${status}` })
        }
        lastStatus = status
      }
    } catch (err) {
      ns.print(record(errors, err))
      note('error', { result: 'error', detail: describe(err), reconnects })
    }
    await ns.sleep(TICK_MS)
  }
}
