// Mirrors the game's own error log to /tel/errors.txt, so an agent driving
// over the Remote File API can see the error modals the player sees.
//
// WHY THIS EXISTS
//
// An agent's whole view of the game is files that scripts chose to write. A
// script that dies from an uncaught exception writes nothing, so a crash and a
// clean run that found nothing look IDENTICAL from outside. That is not
// hypothetical: ctscan.js failed to launch for want of RAM, wrote no output,
// and the silence was read as "there are no contracts on the network". There
// were 49, worth ~$1.9b, and the wrong conclusion was reported with numbers
// built on top of it. The player saw a modal the whole time.
//
// WHAT IT READS
//
// ErrorState (src/ErrorHandling/ErrorState.tsx) is the game's own ring buffer
// of the last 100 errors, filled by DisplayError, which every error path
// funnels through -- handleUnknownError for script throws, uncaught promise
// rejections, and exceptionAlert from the engine. Records carry server,
// errorType, scriptName, message, pid, occurrences and time.
//
// Reading THAT rather than scraping the modal is deliberate. DisplayError's
// updateActiveError only promotes an error to a modal `if (!ActiveError)`, so
// while one modal is up every later error is recorded but never displayed. A
// DOM scraper would miss exactly the errors that arrive in a storm -- the case
// where the information is worth the most.
//
// HOW IT REACHES IT
//
// ErrorState is a module singleton: not on window, not in the save file, and
// not rendered unless the Recent Errors page is open. It is reached through
// the webpack module cache -- pushing a chunk whose runtime callback receives
// __webpack_require__. The modules map is empty and the chunk id is unique, so
// nothing in the app is redefined. window/document come via eval so the static
// RAM checker never prices them, the same trick cmd.js uses.
//
// This is the one part that could rot: it depends on a webpack dev build and
// on the module path. So it fails LOUD -- health names the failure and the
// error list is null, never [], because an empty list means "no errors" and
// that is the single most dangerous thing this file could ever lie about.

const OUT = '/tel/errors.txt'
const MODULE_ID = './src/ErrorHandling/ErrorState.tsx'
const MAX_MESSAGE = 2000
const POLL_MS = 5000

/** Pull ErrorState out of the webpack module cache. Returns {state} or {error}. */
function resolveErrorState() {
  const win = eval('window')

  const hook = win.webpackChunkbitburner
  if (!hook || typeof hook.push !== 'function') {
    return { error: 'window.webpackChunkbitburner missing — not a webpack dev build?' }
  }

  let req = null
  try {
    hook.push([[`errlog_${Date.now()}`], {}, (r) => (req = r)])
  } catch (err) {
    return { error: `chunk push threw: ${err}` }
  }
  if (!req) return { error: 'chunk push did not invoke the runtime callback' }

  const cache = req.c
  if (!cache) return { error: `__webpack_require__ has no module cache (keys: ${Object.keys(req)})` }

  // Prefer the known path, but fall back to a shape scan so a file rename
  // degrades to "slower" rather than "blind".
  const byPath = cache[MODULE_ID]?.exports?.ErrorState
  if (isErrorState(byPath)) return { state: byPath, via: MODULE_ID }

  for (const id of Object.keys(cache)) {
    const exp = cache[id]?.exports
    if (!exp || typeof exp !== 'object') continue
    for (const name of Object.keys(exp)) {
      if (isErrorState(exp[name])) return { state: exp[name], via: `${id}#${name} (path changed)` }
    }
  }

  return { error: `ErrorState not found among ${Object.keys(cache).length} cached modules` }
}

const isErrorState = (v) => !!v && typeof v === 'object' && Array.isArray(v.Errors) && !!v.ErrorUpdate

function snapshot(record) {
  const message = String(record.message ?? '')
  return {
    id: record.id,
    type: record.errorType,
    script: record.scriptName,
    server: record.server,
    pid: record.pid,
    occurrences: record.occurrences,
    unread: record.unread,
    at: record.time instanceof Date ? record.time.toISOString() : String(record.time),
    message: message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE)}…[truncated]` : message,
  }
}

export async function main(ns) {
  ns.disableLog('ALL')

  let published = { at: null, health: 'starting', errors: null, reason: null }
  // Runs off home (where: 'anywhere') so it costs the home budget nothing at
  // the low tiers -- which is exactly where RAM scarcity causes the failures
  // this file exists to report. So it ships the report home, like hacknet.js.
  const here = ns.getHostname()
  const publish = () => {
    published.at = new Date().toISOString()
    ns.write(OUT, JSON.stringify(published, null, 2), 'w')
    if (here !== 'home') ns.scp(OUT, 'home', here)
  }
  // C1: say something on every exit path, including being killed.
  ns.atExit(() => {
    if (published.health === 'ok') published.health = 'stopped'
    publish()
  })

  const resolved = resolveErrorState()
  if (!resolved.state) {
    // errors stays null: "could not look" must never encode as "nothing found".
    published = { at: null, health: 'unresolved', errors: null, reason: resolved.error }
    publish()
    ns.tprint(`ERROR errlog: cannot reach ErrorState — ${resolved.error}`)
    return
  }

  const state = resolved.state
  let lastSerialised = null
  let lastWrite = 0

  while (true) {
    const errors = state.Errors.map(snapshot)
    published = {
      at: null,
      health: 'ok',
      via: resolved.via,
      unread: state.UnreadErrors,
      modalsSuppressed: state.PreventModalsUntil instanceof Date && state.PreventModalsUntil > new Date(),
      count: errors.length,
      errors,
      reason: null,
    }

    // Write on change, and at least once a minute so a stale file is visible
    // as stale rather than being mistaken for a quiet game.
    const fingerprint = JSON.stringify(errors)
    const stale = lastSerialised === null || Date.now() - lastWrite > 60000
    if (fingerprint !== lastSerialised || stale) {
      publish()
      lastSerialised = fingerprint
      lastWrite = Date.now()
    }

    await ns.sleep(POLL_MS)
  }
}
