// THE STATE of the whole-game plan: the Source-File level vector.
//
// CALIBRATION: not applicable — nothing here models a game quantity. This is
// bookkeeping (what is held, what is owed, how a state is indexed), and the
// game's own rules are the ground truth for it:
//   - a clear of BitNode n raises Source-File n by one level, to a maximum of 3
//     (BitNode/BitNode.tsx:42), except SF12 which has no maximum (BitNode.tsx:439);
//   - the target ("the entire game") is every SF to level 3 except SF15 (ruled
//     out by the user) and SF12 once — the set nodechoice/run.mjs and
//     nextnode.mjs used.
//
// Pure: no game import, so the search and its tests run without the bundle.
//
// INTELLIGENCE is carried beside the vector (state.int) but is NOT a lattice
// dimension: it moves every clear and its measured effect on the Bladeburner
// leg (the only route that reads it) is inside the seed noise (133 vs 134 on
// one seed: 24.7h vs 29.2h, the seed stream diverging — the sims are stochastic).
// The Bladeburner grid is built at a pinned intelligence (surrogate.mjs).

export const NODES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
export const EXCLUDED = new Set([15])
/** The level each SF must reach for the game to be "finished". */
export const targetOf = (n) => (EXCLUDED.has(n) ? 0 : n === 12 ? 1 : 3)

/** A state is a plain object {sf: Map<n, level>, int?: number}. */
export function makeState(pairs, int = null) {
  const sf = new Map()
  for (const n of NODES) sf.set(n, 0)
  for (const [n, l] of pairs) sf.set(n, l)
  return { sf, int }
}
export const lvl = (s, n) => s.sf.get(n) ?? 0
export const plus = (s, n) => {
  const sf = new Map(s.sf)
  sf.set(n, (sf.get(n) ?? 0) + 1)
  return { sf, int: s.int }
}
export const pairsOf = (s) => [...s.sf.entries()].filter(([, l]) => l > 0).sort((a, b) => a[0] - b[0])
export const sig = (s) => pairsOf(s).map(([n, l]) => `${n}.${l}`).join(',')

/** Every clear still owed from state s, as a multiset (array, ascending). */
export function owed(s) {
  const out = []
  for (const n of NODES) for (let l = lvl(s, n); l < targetOf(n); l++) out.push(n)
  return out
}

/** "1.3,2.1,4.2" -> state */
export function parseState(str, int = null) {
  const pairs = str.split(',').filter(Boolean).map((t) => {
    const [n, l] = t.trim().split('.').map(Number)
    if (!(n >= 1 && n <= 15) || !(l >= 0)) throw new Error(`bad Source-File token "${t}" (want n.level)`)
    return [n, l]
  })
  return makeState(pairs, int)
}

/** Label of the clear of node n from state s: "BN4.3", "BN12". */
export const clearLabel = (n, s) => (n === 12 ? 'BN12' : `BN${n}.${lvl(s, n) + 1}`)

/**
 * THE LATTICE: every state reachable from `start` by owed clears, indexed in
 * mixed radix over the owed dimensions. A clear of n adds stride[n] to the
 * index, so every successor has a larger index: iterating indices downward is
 * a reverse topological order (search.mjs relies on it).
 */
export function lattice(start) {
  const dims = []
  for (const n of NODES) {
    const lo = lvl(start, n)
    const hi = Math.max(lo, targetOf(n))
    if (hi > lo) dims.push({ n, lo, hi, size: hi - lo + 1 })
  }
  let size = 1
  const stride = new Map()
  for (const d of dims) {
    d.stride = size
    stride.set(d.n, size)
    size *= d.size
  }
  const index = (s) => dims.reduce((a, d) => a + (lvl(s, d.n) - d.lo) * d.stride, 0)
  const decode = (idx) => {
    const sf = new Map(start.sf)
    for (const d of dims) sf.set(d.n, d.lo + (Math.floor(idx / d.stride) % d.size))
    return { sf, int: start.int }
  }
  return { start, dims, size, stride, index, decode }
}
