// A black-box recorder for page hangs. 0GB: localStorage through eval, which
// the RAM checker never prices.
//
// The game froze twice on 2026-09-24/25, each time at a screen lock/unlock,
// and nothing could say what was running: a hung page publishes nothing, and a
// reload wipes the page's memory. localStorage survives the reload. So:
//   - scripts bracket their long-running sections with enter()/leave();
//   - tel.js runs a heartbeat (last-alive time + visibility changes);
//   - after a reload tel.js reads the PREVIOUS page's record (readLast) and
//     publishes it: a section entered but never left is what was running when
//     the page stopped, and the heartbeat says when.
// Writes are tiny and synchronous; a failing localStorage is ignored (the
// recorder must never be the thing that breaks a script).

const KEY = 'bbTrace'
const store = () => {
  try {
    return eval('localStorage')
  } catch {
    return null
  }
}
const read = () => {
  try {
    return JSON.parse(store()?.getItem(KEY) || '{}')
  } catch {
    return {}
  }
}
const write = (o) => {
  try {
    store()?.setItem(KEY, JSON.stringify(o))
  } catch {
    /* never break the caller */
  }
}

/** Mark `section` entered (host/pid make concurrent instances distinct). */
export function enter(section) {
  const o = read()
  o.sections = o.sections || {}
  o.sections[section] = { in: Date.now(), out: o.sections[section]?.out ?? null }
  write(o)
}

/** Mark `section` left. */
export function leave(section) {
  const o = read()
  o.sections = o.sections || {}
  o.sections[section] = { in: o.sections[section]?.in ?? null, out: Date.now() }
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
  o.page = o.page || now
  write(o)
}

/** The previous page's record, then start a fresh one for this page. */
export function readLastAndReset(pageStart) {
  const o = read()
  if (o.page && o.page < pageStart) {
    write({ page: pageStart, sections: {} })
    return o
  }
  return null
}
