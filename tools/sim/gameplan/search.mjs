// THE ORDER SEARCH: exact shortest path over the Source-File lattice.
//
// CALIBRATION: not applicable — this is an optimiser, not a model. Its claim is
// optimality GIVEN the clear-time table, and that claim is tested: [GP1] in
// tools/test/gameplan.test.mjs checks it against brute force over every order
// on small synthetic lattices, and plan.mjs prints a CHECK that its total is
// <= nodechoice/nextnode.mjs's local search on the same table.
//
// Order matters only through the SF state, so with C(n, s) the hours of a clear
// of n from state s, the best remaining total from s is
//     V(s) = min over owed n of  C(n, s) + V(s + n),   V(target) = 0
// — a shortest path on a DAG. The lattice from the current state is
// prod(owed_n + 1) states (2,985,984 with 29 clears owed), every one visited
// once in reverse index order (state.mjs: a clear always raises the index), 13
// edges each: exact, no heuristic, ~40M edge relaxations. A* would visit
// fewer states but needs an admissible bound and buys nothing at this size;
// it becomes worth having only if a dimension is added (intelligence on the
// lattice, SF12 past level 1).
//
// C is a TABLE: C depends on the state only through the levels of the
// Source-Files some effect reads (effects.LIVE_SFS); INERT dimensions (SF2,
// SF3, SF13 in phase 1) are pure cost and do not multiply the table.

/**
 * The clear-time table over the lattice's live feature space.
 * clearFn(n, lv) -> hours; liveOf(n) -> whether SF n's level reaches C.
 * Returns { F, fstride Int32Array(nd), C Float64Array(nd x F) } with
 * C[d * F + f] the hours of clearing dims[d] at feature combo f.
 */
export function buildTable(L, clearFn, liveOf) {
  const nd = L.dims.length
  const fstride = new Int32Array(nd)
  const live = []
  let F = 1
  L.dims.forEach((d, i) => {
    if (liveOf(d.n)) {
      fstride[i] = F
      live.push(i)
      F *= d.size
    }
  })
  const C = new Float64Array(nd * F).fill(NaN)
  const levels = new Map(L.start.sf)
  const lv = (n) => levels.get(n) ?? 0
  for (let f = 0; f < F; f++) {
    for (const i of live) levels.set(L.dims[i].n, L.dims[i].lo + (Math.floor(f / fstride[i]) % L.dims[i].size))
    for (let d = 0; d < nd; d++) {
      const dim = L.dims[d]
      if (fstride[d] && lv(dim.n) >= dim.hi) continue // already at target in this combo
      C[d * F + f] = clearFn(dim.n, lv)
    }
  }
  return { F, fstride, C }
}

/** Average of several tables (the open-loop robust plan: E[sum C] = sum E[C]). */
export function meanTable(tables) {
  const out = { F: tables[0].F, fstride: tables[0].fstride, C: new Float64Array(tables[0].C.length) }
  for (const t of tables) for (let i = 0; i < t.C.length; i++) out.C[i] += t.C[i] / tables.length
  return out
}

/** V(s) for every state of the lattice: Float64Array(L.size). Exact. */
export function solveDP(L, T) {
  const nd = L.dims.length
  const sizes = Int32Array.from(L.dims.map((d) => d.size))
  const strides = Int32Array.from(L.dims.map((d) => d.stride))
  const { F, fstride, C } = T
  const V = new Float64Array(L.size)
  const dig = Int32Array.from(sizes, (s) => s - 1)
  for (let idx = L.size - 1; idx >= 0; idx--) {
    if (idx < L.size - 1) {
      // odometer: decrement the mixed-radix digits to match idx
      let k = 0
      while (dig[k] === 0) {
        dig[k] = sizes[k] - 1
        k++
      }
      dig[k]--
      let f = 0
      for (let d = 0; d < nd; d++) f += dig[d] * fstride[d]
      let best = Infinity
      for (let d = 0; d < nd; d++) {
        if (dig[d] === sizes[d] - 1) continue
        const v = C[d * F + f] + V[idx + strides[d]]
        if (v < best) best = v
      }
      V[idx] = best
    } else V[idx] = 0
  }
  return V
}

const featOf = (L, T, digits) => digits.reduce((a, x, d) => a + x * T.fstride[d], 0)
const digitsOf = (L, idx) => L.dims.map((d) => Math.floor(idx / d.stride) % d.size)

/** The cost of clearing dims[d] from the state with these digits. */
export const edgeCost = (L, T, digits, d) => T.C[d * T.F + featOf(L, T, digits)]

/** T(first = n) for every owed n at the lattice start: C(n, start) + V(start + n). */
export function firstMoves(L, T, V) {
  const digits = L.dims.map(() => 0)
  return L.dims.map((dim, d) => {
    const c = edgeCost(L, T, digits, d)
    return { n: dim.n, own: c, T: c + V[dim.stride] }
  })
}

/** The optimal order from lattice index `idx` (default the start), following V. */
export function bestPath(L, T, V, idx = 0) {
  const steps = []
  while (idx < L.size - 1) {
    const digits = digitsOf(L, idx)
    let best = null
    for (let d = 0; d < L.dims.length; d++) {
      if (digits[d] === L.dims[d].size - 1) continue
      const c = edgeCost(L, T, digits, d)
      const v = c + V[idx + L.dims[d].stride]
      if (!best || v < best.v - 1e-9) best = { d, c, v }
    }
    const dim = L.dims[best.d]
    steps.push({ n: dim.n, level: dim.lo + digits[best.d] + 1, h: best.c })
    idx += dim.stride
  }
  return steps
}

/** Total hours of a given order (array of node numbers) from the lattice start. */
export function evalOrder(L, T, seq) {
  const digits = L.dims.map(() => 0)
  const di = new Map(L.dims.map((d, i) => [d.n, i]))
  let tot = 0
  const steps = []
  for (const n of seq) {
    const d = di.get(n)
    if (d === undefined || digits[d] >= L.dims[d].size - 1) throw new Error(`evalOrder: BN${n} is not owed here`)
    const c = edgeCost(L, T, digits, d)
    tot += c
    steps.push({ n, level: L.dims[d].lo + digits[d] + 1, h: c })
    digits[d]++
  }
  return { T: tot, steps }
}

/** Every owed clear, as a multiset (array). */
export const owedSeq = (L) => L.dims.flatMap((d) => Array(d.size - 1).fill(d.n))

/** Brute force over every distinct order (small lattices only — the test's reference). */
export function bruteForce(L, T) {
  const items = owedSeq(L)
  let best = { T: Infinity, seq: null }
  const counts = new Map()
  for (const n of items) counts.set(n, (counts.get(n) ?? 0) + 1)
  const seq = []
  const rec = () => {
    if (seq.length === items.length) {
      const t = evalOrder(L, T, seq).T
      if (t < best.T) best = { T: t, seq: [...seq] }
      return
    }
    for (const [n, c] of counts) {
      if (!c) continue
      counts.set(n, c - 1)
      seq.push(n)
      rec()
      seq.pop()
      counts.set(n, c)
    }
  }
  rec()
  return best
}

/**
 * nodechoice/nextnode.mjs's search, ported line for line onto the table: with
 * `first` fixed, a greedy start (own hours minus what the SF saves on every
 * clear still owed), then single-clear insertion moves until none improves.
 */
export function localSearch(L, T, first) {
  const all = owedSeq(L)
  const rest = [...all]
  rest.splice(rest.indexOf(first), 1)
  const cost = (seq) => evalOrder(L, T, [first, ...seq]).T
  const di = new Map(L.dims.map((d, i) => [d.n, i]))
  const digits = L.dims.map(() => 0)
  digits[di.get(first)]++
  const left = [...rest]
  const seq = []
  while (left.length) {
    let best = null
    for (const n of new Set(left)) {
      const own = edgeCost(L, T, digits, di.get(n))
      const d2 = [...digits]
      d2[di.get(n)]++
      const others = [...left]
      others.splice(others.indexOf(n), 1)
      let save = 0
      for (const m of new Set(others)) {
        const cnt = others.filter((x) => x === m).length
        const dm = di.get(m)
        const a = edgeCost(L, T, digits, dm)
        const b = d2[dm] < L.dims[dm].size - 1 ? edgeCost(L, T, d2, dm) : a
        save += (a - b) * cnt
      }
      const score = own - save
      if (!best || score < best.score) best = { n, score }
    }
    seq.push(best.n)
    digits[di.get(best.n)]++
    left.splice(left.indexOf(best.n), 1)
  }
  let cur = seq
  let curT = cost(cur)
  for (let pass = 0; pass < 50; pass++) {
    let improved = false
    for (let i = 0; i < cur.length; i++)
      for (let j = 0; j < cur.length; j++) {
        if (i === j || cur[i] === cur[j]) continue
        const c = [...cur]
        const [x] = c.splice(i, 1)
        c.splice(j, 0, x)
        const t = cost(c)
        if (t < curT - 1e-9) {
          cur = c
          curT = t
          improved = true
        }
      }
    if (!improved) break
  }
  return { seq: [first, ...cur], T: curT }
}
