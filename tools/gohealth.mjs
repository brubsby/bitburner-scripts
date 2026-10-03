// GO NOT PLAYING IN A GO NODE — the outcome check for tools/healthcheck.mjs.
//
// Pure (no I/O), like tools/raisehealth.mjs. Live BN14.1 (2026-10-03): the
// node entered for IPvGO (GoPower x4) ran from ~18:45Z to 19:02Z with go.js
// not running at all. boot.js admitted it only at the 128GB home tier and home
// was 32GB, so nothing placed it, and every component reported healthy. The
// existing Go checks all read /tel/go.txt (solver warn, "no new solver
// moves"), so a go.js that never started tripped none of them: the file was
// the previous node's, which the healthcheck correctly set aside as history.
//
// The check: in a Go-first node (raiseplace.goFirstOf: effective Go power >= 4,
// i.e. BitNode 14), once the life is older than ABSENT_MIN, FAIL when go.js is
//   absent  /tel/go.txt missing, from before this life, older than FRESH_MIN
//           (it heartbeats every minute), or 'stopped'; or
//   idle    its move counters (remoteMoves + localMoves) have not moved over a
//           sample at least ABSENT_MIN old.
// The clock is the earliest of: the life's start (absent since the node
// began), go.txt's last stamp, and this check's own previous "not playing"
// sighting. Not a Go-first node, or a young life: nothing.

// No root module is imported here ([TL1]: operator tools import game modules
// only dynamically, after the resolver): the caller passes `verdict`,
// raiseplace.goFirstOf({goPower: bitNodeMults(node).GoPower, sf14}).

export const ABSENT_MIN = 10
export const FRESH_MIN = 5

const num = (x) => typeof x === 'number' && isFinite(x)
/** Source-File level n from the save digest's JSONMap. */
export const sfOfState = (state, n) => {
  const data = Array.isArray(state?.sourceFiles) ? state.sourceFiles : state?.sourceFiles?.data ?? []
  return new Map(data.map(([k, l]) => [Number(k), Number(l)])).get(n) ?? 0
}

/**
 * @param {object} o
 * @param {object} o.state   the save digest (/poll): bitNode, sourceFiles, playtimeSinceLastAug
 * @param {object} o.go      /tel/go.txt
 * @param {object} o.prev    this function's snap from the previous run
 * @param {object} o.verdict raiseplace.goFirstOf for this node: {goFirst, effective, why}
 * @returns {{fail: {what, detail}|null, note: string|null, snap}}
 */
export function goNodeHealth({ state = {}, go = null, prev = null, verdict = null, nowMs = Date.now() } = {}) {
  const node = state?.bitNode ?? null
  if (!verdict) return { fail: null, note: `Go-node check skipped: no goFirst verdict (BitNode ${node})`, snap: { bitNode: node, at: nowMs, moves: null, since: null } }
  const snap = { bitNode: node, at: nowMs, moves: null, since: null, proc: null }
  // Unknown is said, never read as "not a Go node, nothing to check".
  if (verdict.effective === null) return { fail: null, note: `Go-node check skipped: ${verdict.why} (BitNode ${node})`, snap }
  if (!verdict.goFirst) return { fail: null, note: null, snap }
  const lifeMs = num(state?.playtimeSinceLastAug) ? state.playtimeSinceLastAug : null
  const lifeStart = lifeMs !== null ? nowMs - lifeMs : null
  const at = Date.parse(go?.at ?? '')
  const born = Number.isFinite(at) && (lifeStart === null || at >= lifeStart)
  const ageMin = Number.isFinite(at) ? (nowMs - at) / 60000 : null
  const moves = num(go?.remoteMoves) || num(go?.localMoves) ? (go.remoteMoves ?? 0) + (go.localMoves ?? 0) : null
  snap.moves = born ? moves : null
  // The counters are per PROCESS (go.js restarts at 0): compare one process only.
  snap.proc = go?.processStartedAt ?? null
  const samePrev = prev && prev.bitNode === node && (lifeStart === null || (num(prev.at) && prev.at >= lifeStart))
  let why = null
  if (!go) why = '/tel/go.txt missing'
  else if (!born) why = `/tel/go.txt is from before this life (${go.at})`
  else if (ageMin > FRESH_MIN) why = `/tel/go.txt is ${ageMin.toFixed(0)} min old (it heartbeats every minute)`
  else if (go.health === 'stopped' || go.exited === true) why = `go.js stopped: ${String(go.detail ?? '').slice(0, 120)}`
  else if (samePrev && prev.proc && prev.proc === snap.proc && num(prev.moves) && moves !== null && moves <= prev.moves && (nowMs - prev.at) / 60000 >= ABSENT_MIN) {
    why = `go.js is idle: ${moves} move requests, the same as ${((nowMs - prev.at) / 60000).toFixed(0)} min ago (phase ${go.phase ?? '?'})`
  }
  if (!why) return { fail: null, note: null, snap }
  // When did it stop playing? The earliest evidence this life.
  const cands = [nowMs]
  if (samePrev && num(prev.since)) cands.push(prev.since)
  if (!go || !born) {
    if (lifeStart !== null) cands.push(lifeStart)
  } else if (why.startsWith('go.js is idle') && samePrev) cands.push(prev.at)
  else if (born && Number.isFinite(at)) cands.push(at)
  const since = Math.min(...cands)
  snap.since = since
  const mins = (nowMs - since) / 60000
  const lifeMin = lifeMs !== null ? lifeMs / 60000 : null
  const detail = `${verdict.why}; ${go ? `go.txt: opponent ${go.opponent ?? '?'}, host ${go.host ?? '?'}, ${go.health}` : 'no go.txt'} — seed.js (to 128GB) and watchdog.js (from 64GB) place it (raiseplace goPlacementOf); see /tel/seed.txt go and /tel/watchdog.txt daemons['go.js']`
  if (mins > ABSENT_MIN && (lifeMin === null || lifeMin > ABSENT_MIN)) {
    return { fail: { what: `GO NOT PLAYING IN A GO NODE: BitNode ${node}, ${why}, for ${mins.toFixed(0)} min`, detail }, note: null, snap }
  }
  return { fail: null, note: `go.js not playing yet in a Go node (${mins.toFixed(0)} of ${ABSENT_MIN} min): ${why}`, snap }
}
