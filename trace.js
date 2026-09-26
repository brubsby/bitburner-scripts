// A black-box recorder for page hangs. 0GB: localStorage through eval, which
// the RAM checker never prices.
//
// The game froze at screen locks/unlocks on 2026-09-24/25 and mid-life on
// 2026-09-25 23:16 and 2026-09-26 09:59 (renderer at 100% CPU, never
// recovering), and nothing could say what was running: a hung page publishes
// nothing, and a reload wipes the page's memory. localStorage survives the
// reload. So:
//   - scripts bracket their long-running sections with enter()/leave();
//   - tel.js runs a heartbeat (last-alive time + visibility changes);
//   - after a reload tel.js reads the PREVIOUS page's record (readLast) and
//     publishes it: a section entered but never left is what was running when
//     the page stopped, and the heartbeat says when.
//
// ONE RECORD PER PAGE, keyed by performance.timeOrigin. The first version kept
// a single shared record, and on 2026-09-26 the reloaded page's scripts wrote
// their sections into it before tel.js had read it, so the frozen page's
// evidence was overwritten by the new page's ("act still running at 10:06" —
// the NEW page's act). A page now only ever writes its own key.
//
// Each section also keeps `maxMs`, its longest completed run on this page, so
// a loop that is merely slow (not yet frozen) shows up too.
// Writes are tiny and synchronous; a failing localStorage is ignored (the
// recorder must never be the thing that breaks a script).

const PREFIX = 'bbTrace:'
const store = () => {
  try {
    return eval('localStorage')
  } catch {
    return null
  }
}
const pageId = () => {
  try {
    return Math.round(eval('performance').timeOrigin)
  } catch {
    return 0
  }
}
const keyOf = (id) => `${PREFIX}${id}`
const read = (id = pageId()) => {
  try {
    return JSON.parse(store()?.getItem(keyOf(id)) || '{}')
  } catch {
    return {}
  }
}
const write = (o, id = pageId()) => {
  try {
    store()?.setItem(keyOf(id), JSON.stringify(o))
  } catch {
    /* never break the caller */
  }
}

/** Mark `section` entered. */
export function enter(section) {
  const o = read()
  o.page = o.page || pageId()
  o.sections = o.sections || {}
  const prev = o.sections[section] || {}
  o.sections[section] = { ...prev, in: Date.now() }
  write(o)
}

/** Mark `section` left, keeping its longest run on this page. */
export function leave(section) {
  const o = read()
  o.sections = o.sections || {}
  const prev = o.sections[section] || {}
  const now = Date.now()
  const ran = typeof prev.in === 'number' ? now - prev.in : null
  o.sections[section] = { ...prev, out: now, maxMs: Math.max(prev.maxMs ?? 0, ran ?? 0), lastMs: ran }
  write(o)
}

/** Heartbeat for tel.js: last-alive time, visibility, and its transitions. */
export function beat(visible) {
  const o = read()
  const now = Date.now()
  if (o.visible !== undefined && o.visible !== visible) {
    o.transitions = [...(o.transitions || []).slice(-9), { at: now, visible }]
  }
  o.alive = now
  o.visible = visible
  o.page = o.page || pageId()
  write(o)
}

/**
 * The most recent record of an EARLIER page (not this one), or null; records
 * older than that one are deleted so localStorage does not grow. The legacy
 * single-record key ('bbTrace') is read once as a fallback and then removed.
 */
export function readLastAndReset(pageStart = pageId()) {
  const s = store()
  if (!s) return null
  let best = null
  let bestId = -Infinity
  const ids = []
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i)
    if (!k || !k.startsWith(PREFIX)) continue
    const id = Number(k.slice(PREFIX.length))
    if (!Number.isFinite(id)) continue
    ids.push(id)
    if (id < pageStart && id > bestId) bestId = id
  }
  if (bestId > -Infinity) best = read(bestId)
  for (const id of ids) if (id < bestId) s.removeItem(keyOf(id))
  if (!best) {
    try {
      const legacy = JSON.parse(s.getItem('bbTrace') || 'null')
      s.removeItem('bbTrace')
      if (legacy?.page && legacy.page < pageStart) best = legacy
    } catch {
      /* ignore */
    }
  }
  return best
}
