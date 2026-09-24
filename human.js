// IS A HUMAN AT THE GAME WINDOW RIGHT NOW?
//
// Focused work earns 25% more than unfocused (BaseFocusBonus 0.8), so the
// scripts keep work focused: upkeep.js clicks Focus within 15s, progress.js
// orders setFocus(true), and every work actor starts work with focus=true. All
// three are right when nobody is looking and hostile when somebody is: focused
// work fills the screen and hides the sidebar, so a human who clicks "Do
// something else simultaneously" to look around was dragged back to the work
// screen before they could click anything else.
//
// So focus is taken only when the human is IDLE. upkeep.js (the one script that
// already holds the DOM) listens for real input and publishes HUMAN; everything
// that would grab focus reads it through humanAtScreen().
//
// Real input only: `event.isTrusted` is false for el.click() and every other
// synthetic event, so the scripts' own DOM driving (upkeep, cmd.js) can never
// mark the human present. A hidden tab (visibilityState 'hidden') is nobody
// looking, whatever the last input was.
//
// Unknown is NOT "at the screen". A missing or stale record — upkeep not
// running, or not yet rewritten — answers null, and every caller treats null as
// the old behaviour (focus). The cost of wrongly focusing is an annoyance; the
// cost of wrongly never focusing is 20% of all reputation, silently, forever.
//
// 0GB of its own: ns.read, ns.scp (0.6GB, and every caller already pays for it)
// and plain objects. No document/window reference — watchInput takes them.

export const HUMAN = '/tel/human.txt'
// No real input for this long = idle, and focus may be taken back.
export const IDLE_MS = 3 * 60 * 1000
// upkeep.js rewrites HUMAN every 15s; older than this and upkeep is not
// watching, so the record says nothing about now.
export const STALE_MS = 60 * 1000
const EVENTS = ['mousedown', 'mousemove', 'keydown', 'wheel', 'touchstart']

/**
 * Install the input listeners once per page. The state lives on the window, not
 * in the script, so a restarted upkeep.js keeps the last input time instead of
 * starting from "never" and refocusing on its first tick.
 */
export function watchInput(win, doc) {
  if (!win.__bbHuman) {
    const state = { lastInputAt: 0 }
    const mark = (e) => {
      if (e.isTrusted) state.lastInputAt = Date.now()
    }
    for (const t of EVENTS) doc.addEventListener(t, mark, { capture: true, passive: true })
    win.__bbHuman = state
  }
  return win.__bbHuman
}

/** The record upkeep.js publishes. */
export function humanRecord(state, doc, work = null, now = Date.now()) {
  return {
    at: new Date(now).toISOString(),
    // What the screen shows ('focused' | 'unfocused' | 'idle' | 'locked'), so a
    // work start while the human looks can leave it exactly as it is.
    work,
    lastInputAt: state.lastInputAt || null,
    visible: doc.visibilityState !== 'hidden',
    idleMs: IDLE_MS,
  }
}

/**
 * Pure: { atScreen: true | false | null, why, work }.
 * true  — real input within IDLE_MS on a visible page: leave focus alone.
 * false — idle, or the tab is hidden: take focus.
 * null  — no fresh record: unknown, and callers behave as before (focus).
 */
export function humanVerdict(rec, now = Date.now()) {
  const at = rec ? Date.parse(rec.at) : NaN
  const work = rec?.work ?? null
  const v = judge(rec, at, now)
  return { ...v, work }
}

function judge(rec, at, now) {
  if (!Number.isFinite(at)) return { atScreen: null, why: 'no human.txt — upkeep.js is not watching input' }
  if (now - at > STALE_MS) return { atScreen: null, why: `human.txt is ${Math.round((now - at) / 1000)}s old` }
  if (rec.visible === false) return { atScreen: false, why: 'game tab hidden' }
  const last = typeof rec.lastInputAt === 'number' && rec.lastInputAt > 0 ? rec.lastInputAt : null
  if (last === null) return { atScreen: false, why: 'no real input seen' }
  const ago = now - last
  if (ago < IDLE_MS) return { atScreen: true, why: `real input ${Math.round(ago / 1000)}s ago` }
  return { atScreen: false, why: `idle ${Math.round(ago / 1000)}s` }
}

/**
 * Read HUMAN on this host and judge it. 0GB — for scripts that live on home
 * (progress.js, upkeep.js), where the pull below would be 0.65GB for nothing.
 */
export function humanOnHome(ns, now = Date.now()) {
  let rec = null
  try {
    rec = JSON.parse(ns.read(HUMAN) || 'null')
  } catch {
    rec = null
  }
  return humanVerdict(rec, now)
}

/** The same, pulled from home first when running elsewhere (the act-* actors). */
export function humanAtScreen(ns, now = Date.now()) {
  if (ns.getHostname() !== 'home') ns.scp(HUMAN, ns.getHostname(), 'home')
  return humanOnHome(ns, now)
}

/**
 * Pure: the focus flag for a work START. Idle or unknown: focused, the 25%.
 * Human at the window: whatever the screen already is — focused work stays
 * focused (an unfocused start would jump them to the Terminal), anything else
 * stays unfocused (a focused start would take the screen over).
 */
export function startFocused(verdict) {
  if (verdict?.atScreen !== true) return true
  return verdict.work === 'focused'
}
