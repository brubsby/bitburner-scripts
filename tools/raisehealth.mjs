// THE RAISE-SIZED DAEMONS' PRESENCE — outcome checks for tools/healthcheck.mjs.
//
// Pure (no I/O), like tools/bbhealth.mjs (which carries bladeburner.js's own
// check, BLADEBURNER FULL NOT PLACED). The watchdog places these by their
// raised block and reserves a host when none has it (raiseplace.js); an
// absence longer than ABSENT_MIN means that placement is not converging.
//
//   SLEEVES NOT RUNNING    sleeves exist (BitNode 10 or Source-File 10), home is at sleeve.js's tier, and
//                          /tel/sleeve.txt has not been fresh from this node for > 15 min. Live BN4
//                          2026-10-03: absent from the 03:08Z install to 09:20Z — boot.js placed it on a
//                          host batch.js had filled and the raise was denied; nothing retried.
//   HASHSPEND NOT RUNNING  hacknet servers exist (BitNode 9 or Source-File 9), home is at its tier, and
//                          /tel/hashspend.txt has not been fresh for > 15 min.
//
// The clock is the earlier of this check's own previous snapshot and the
// watchdog's absentSince for the script (fresh watchdog records only).
// rec = the script's telemetry, wd = /tel/watchdog.txt, state = the save digest.

export const ABSENT_MIN = 15
export const FRESH_MIN = 20

const num = (x) => typeof x === 'number' && isFinite(x)
const ageMinOf = (iso, nowMs) => {
  const t = Date.parse(iso ?? '')
  return Number.isFinite(t) ? (nowMs - t) / 60000 : null
}
const sfOf = (state) => {
  const data = Array.isArray(state?.sourceFiles) ? state.sourceFiles : state?.sourceFiles?.data ?? []
  return new Map(data.map(([n, l]) => [Number(n), Number(l)]))
}

/** The checked daemons: name, telemetry file, home tier (boot.js / raiseplace.RAISED), and where the capability exists. */
export const CHECKED = [
  { script: 'sleeve.js', file: 'sleeve.txt', tier: 64, label: 'SLEEVES NOT RUNNING', what: 'sleeves', node: 10 },
  { script: 'hashspend.js', file: 'hashspend.txt', tier: 32, label: 'HASHSPEND NOT RUNNING', what: 'hacknet servers', node: 9 },
]

/**
 * One daemon. {fail: {what, detail} | null, note: string | null, since: ms | null}.
 */
export function raisedPresence({ c, rec = null, wd = null, state = {}, prevSince = null, nowMs = Date.now() }) {
  const node = state?.bitNode ?? null
  const exists = node === c.node || (sfOf(state).get(c.node) ?? 0) > 0
  const tierOk = num(state?.home?.ram) && state.home.ram >= c.tier
  if (!exists || !tierOk) return { fail: null, note: null, since: null }
  const age = ageMinOf(rec?.at, nowMs)
  const up = !!rec && rec.bitNode === node && age !== null && age <= FRESH_MIN && rec.health !== 'stopped' && rec.result !== 'capability-absent'
  if (up) return { fail: null, note: null, since: null }
  const wdRec = wd?.daemons?.[c.script] ?? null
  const wdAge = ageMinOf(wd?.at, nowMs)
  const wdSince = wdAge !== null && wdAge < 5 ? Date.parse(wdRec?.absentSince ?? '') : NaN
  const since = Math.min(num(prevSince) ? prevSince : nowMs, Number.isFinite(wdSince) ? wdSince : nowMs)
  const mins = (nowMs - since) / 60000
  const where = wdRec ? `watchdog: ${String(wdRec.state ?? '?').slice(0, 200)}` : `watchdog.txt has no ${c.script} entry (a watchdog from before the placement guarantee: restart it)`
  const last = rec ? `/tel/${c.file} ${age === null ? 'unstamped' : `${age.toFixed(0)} min old`}${rec.bitNode !== node ? ` from BitNode ${rec.bitNode}` : ''} (${rec.health}/${rec.result})` : `/tel/${c.file} missing`
  if (mins > ABSENT_MIN) return { fail: { what: `${c.label}: ${c.what} exist, home is ${state.home.ram}GB (the ${c.tier}GB tier admits ${c.script}) and it has not run for ${mins.toFixed(0)} min — ${last}`, detail: where }, note: null, since }
  return { fail: null, note: `${c.script}: not running yet (${mins.toFixed(0)} of ${ABSENT_MIN} min) — ${where}`, since }
}

/** Every checked daemon: {fails, notes, snap: {script: absentSince}}; prev = this function's snap from the last run. */
export function raisedHealth({ tel = {}, wd = null, state = {}, prev = null, nowMs = Date.now() } = {}) {
  const fails = []
  const notes = []
  const snap = {}
  for (const c of CHECKED) {
    const p = prev && prev.bitNode === state?.bitNode ? prev[c.script] : null
    const r = raisedPresence({ c, rec: tel[c.file] ?? null, wd, state, prevSince: p, nowMs })
    if (r.fail) fails.push(r.fail)
    if (r.note) notes.push(r.note)
    snap[c.script] = r.since
  }
  snap.bitNode = state?.bitNode ?? null
  return { fails, notes, snap }
}
