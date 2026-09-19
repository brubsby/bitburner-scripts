// The IPvGO solver: board representation, rules, evaluation and search.
//
// Pure computation — there is not a single ns call in this file, deliberately.
// Two consequences, both the point of it existing:
//
//   1. **One source of truth.** go.js plays games with it and anything else
//      that needs to reason about a board (a tuning harness, an offline
//      experiment under tools/sim, a future cheat that has to choose its own
//      points) imports the same code. Re-deriving liberty counting or scoring
//      in a second place is how two solvers quietly stop agreeing.
//   2. **Free to import.** Netscript bills a script for the ns functions in its
//      import graph; this module contributes none, so importing it costs
//      nothing. It is also directly runnable under plain node, so the search
//      can be tuned headlessly without spending game time — which matters when
//      the thing being tuned is a CPU/strength trade-off.
//
// Board convention throughout: `idx = x*N + y`, matching the game's
// column-major board strings, where board[x] is the x-th column.

export const EMPTY = 0, US = 1, THEM = 2, DEAD = 3

/** Flat board helpers. idx = x*N + y, matching board[x][y] column-major strings. */
export function makeGeometry(N) {
  const nbrs = new Array(N * N)
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) {
      const list = []
      if (x > 0) list.push((x - 1) * N + y)
      if (x < N - 1) list.push((x + 1) * N + y)
      if (y > 0) list.push(x * N + y - 1)
      if (y < N - 1) list.push(x * N + y + 1)
      nbrs[x * N + y] = list
    }
  }
  return nbrs
}

export function parseBoard(strings) {
  const N = strings.length
  const b = new Uint8Array(N * N)
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) {
      const c = strings[x][y]
      b[x * N + y] = c === 'X' ? US : c === 'O' ? THEM : c === '#' ? DEAD : EMPTY
    }
  }
  return b
}

/** Group at idx plus its liberty count. Scratch arrays are reused to avoid GC. */
export function group(b, nbrs, idx, out, seen, mark) {
  const colour = b[idx]
  let n = 0
  let libs = 0
  out[n++] = idx
  seen[idx] = mark
  for (let i = 0; i < n; i++) {
    const cur = out[i]
    const ns = nbrs[cur]
    for (let j = 0; j < ns.length; j++) {
      const p = ns[j]
      if (seen[p] === mark) continue
      const v = b[p]
      if (v === EMPTY) {
        seen[p] = mark
        libs++
      } else if (v === colour) {
        seen[p] = mark
        out[n++] = p
      }
    }
  }
  return { size: n, libs }
}

/**
 * Play a stone, removing any captured enemy groups. Returns stones captured, or
 * -1 if the move is suicide (and leaves the board untouched).
 *
 * Superko is deliberately not checked inside playouts — tracking full board
 * history per simulation is far more expensive than the mistake is worth, and
 * at the root every candidate is filtered through ns.go.analysis.getValidMoves,
 * which enforces it properly where it actually matters.
 */
export function play(b, nbrs, idx, colour, scratch) {
  const { out, seen } = scratch
  const enemy = colour === US ? THEM : US
  b[idx] = colour
  let captured = 0
  const ns = nbrs[idx]
  for (let j = 0; j < ns.length; j++) {
    const p = ns[j]
    if (b[p] !== enemy) continue
    const g = group(b, nbrs, p, out, seen, ++scratch.mark)
    if (g.libs === 0) {
      for (let i = 0; i < g.size; i++) b[out[i]] = EMPTY
      captured += g.size
    }
  }
  const mine = group(b, nbrs, idx, out, seen, ++scratch.mark)
  if (mine.libs === 0 && captured === 0) {
    b[idx] = EMPTY
    return -1
  }
  return captured
}

/**
 * Play only if the result is not a self-atari, undoing if it is.
 *
 * Playouts previously accepted any legal non-eye point, which meant they
 * cheerfully played stones that were captured on the opponent's reply. A
 * playout full of those is not a sample of how the position plays out, it is
 * noise, and no amount of search budget fixes a biased estimator. The undo is a
 * board memcpy — 81 bytes on 9x9 — which is far cheaper than the alternative of
 * computing resulting liberties analytically.
 */
export function tryPlay(b, nbrs, idx, colour, scratch) {
  scratch.undo.set(b)
  const cap = play(b, nbrs, idx, colour, scratch)
  if (cap < 0) return false
  // The self-atari test used to be gated on `cap === 0`, so a move that
  // CAPTURED was never checked — which is precisely the snapback shape:
  // take one stone, and the capture leaves your own chain on a single
  // liberty at the point you just cleared, so the opponent takes the whole
  // chain straight back. Observed on a real board (tools/staging/go/dissect):
  // we captured at 4,4, our chain became 3 stones with 1 liberty, and white
  // recaptured all three on the next move.
  //
  // The gate was never needed. `play` has already removed the captured stones
  // by this point, so the liberty count below already includes the points the
  // capture freed. Checking unconditionally is both simpler and correct.
  const g = group(b, nbrs, idx, scratch.out, scratch.seen, ++scratch.mark)
  if (g.libs === 1) {
    b.set(scratch.undo)
    return false
  }
  return true
}

/** Is this point an eye for `colour`? Cheap test: all orthogonal neighbours ours. */
function isOwnEye(b, nbrs, idx, colour) {
  const ns = nbrs[idx]
  if (!ns.length) return false
  for (let j = 0; j < ns.length; j++) if (b[ns[j]] !== colour) return false
  return true
}

/** Area score from our side: our stones+territory minus theirs, minus komi. */
export function scoreBoard(b, nbrs, N, komi, scratch) {
  let us = 0, them = 0
  const { out, seen } = scratch
  for (let i = 0; i < N * N; i++) {
    const v = b[i]
    if (v === US) us++
    else if (v === THEM) them++
  }
  // Empty regions: owned if every adjacent stone is one colour.
  const visited = scratch.visited
  visited.fill(0)
  for (let i = 0; i < N * N; i++) {
    if (b[i] !== EMPTY || visited[i]) continue
    let n = 0
    out[n++] = i
    visited[i] = 1
    let touchUs = false, touchThem = false
    for (let k = 0; k < n; k++) {
      const cur = out[k]
      const ns = nbrs[cur]
      for (let j = 0; j < ns.length; j++) {
        const p = ns[j]
        const v = b[p]
        if (v === EMPTY && !visited[p]) {
          visited[p] = 1
          out[n++] = p
        } else if (v === US) touchUs = true
        else if (v === THEM) touchThem = true
      }
    }
    if (touchUs && !touchThem) us += n
    else if (touchThem && !touchUs) them += n
  }
  return us - them - komi
}

/**
 * One random playout with a light policy: prefer captures and escapes, else a
 * uniformly random legal point that is not a self-atari or an own eye.
 * Returns +1 if we end ahead.
 */
export function playout(b, nbrs, N, komi, colour, scratch, rand, amaf) {
  // Shuffle the empty points once and sweep, rather than re-scanning the whole
  // board and sampling 8 random points per turn. The old way both rescanned
  // O(N^2) every turn *and* frequently failed to find a legal point on a
  // crowded board, so playouts ended early with half-empty boards and returned
  // near-noise — which is why a "search" that never actually searched still
  // looked like it was running.
  const e = scratch.empties
  let n = 0
  for (let i = 0; i < N * N; i++) if (b[i] === EMPTY) e[n++] = i
  for (let i = n - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0
    const t = e[i]
    e[i] = e[j]
    e[j] = t
  }

  let passes = 0
  let last = -1
  const limit = N * N * 2

  for (let turn = 0; turn < limit && passes < 2; turn++) {
    let played = false
    const enemy = colour === US ? THEM : US

    // --- 1. Tactical: answer atari created by the last move ----------------
    //
    // Only groups adjacent to the last stone can have changed liberty count, so
    // this checks that neighbourhood rather than rescanning the board. Saving
    // is tried before capturing, and both go through tryPlay, so a "save" that
    // merely walks into another atari is rejected rather than played.
    if (last >= 0) {
      let save = -1
      let take = -1
      const ln = nbrs[last]
      for (let j = 0; j < ln.length; j++) {
        const p = ln[j]
        const v = b[p]
        if (v !== colour && v !== enemy) continue
        const gr = group(b, nbrs, p, scratch.out, scratch.seen, ++scratch.mark)
        if (gr.libs !== 1) continue
        let lib = -1
        for (let sIdx = 0; sIdx < gr.size && lib < 0; sIdx++) {
          const sn = nbrs[scratch.out[sIdx]]
          for (let q = 0; q < sn.length; q++) if (b[sn[q]] === EMPTY) { lib = sn[q]; break }
        }
        if (lib < 0) continue
        if (v === colour) { if (save < 0) save = lib } else if (take < 0) take = lib
      }
      for (const urgent of [take, save]) {
        if (urgent < 0 || b[urgent] !== EMPTY) continue
        if (tryPlay(b, nbrs, urgent, colour, scratch)) { if (amaf) amaf.record(urgent, colour); last = urgent; played = true; break }
      }
    }

    // --- 2. Local reply ----------------------------------------------------
    //
    // The single biggest improvement available to a simple playout, and the one
    // Mogo is known for: real Go moves are overwhelmingly local answers to the
    // opponent's last move, while a uniformly random playout scatters across the
    // board and dissolves whatever shape the root move was trying to build. The
    // estimate it returns is then about a position nobody would ever reach.
    if (!played && last >= 0 && rand() < 0.75) {
      const lx = (last / N) | 0
      const ly = last % N
      const start = (rand() * 8) | 0
      for (let k = 0; k < 8 && !played; k++) {
        const d = (start + k) % 8
        const dx = [1, -1, 0, 0, 1, 1, -1, -1][d]
        const dy = [0, 0, 1, -1, 1, -1, 1, -1][d]
        const nx = lx + dx
        const ny = ly + dy
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue
        const idx = nx * N + ny
        if (b[idx] !== EMPTY || isOwnEye(b, nbrs, idx, colour)) continue
        if (tryPlay(b, nbrs, idx, colour, scratch)) { if (amaf) amaf.record(idx, colour); last = idx; played = true }
      }
    }

    // --- 3. Anywhere else --------------------------------------------------
    for (let k = 0; k < n && !played; k++) {
      const idx = e[k]
      if (b[idx] !== EMPTY || isOwnEye(b, nbrs, idx, colour)) continue
      if (tryPlay(b, nbrs, idx, colour, scratch)) { if (amaf) amaf.record(idx, colour); last = idx; played = true }
    }

    if (played) passes = 0
    else passes++
    colour = enemy
  }

  return scoreBoard(b, nbrs, N, komi, scratch) > 0 ? 1 : 0
}

/**
 * Cheap static score, used only to shortlist root moves before sampling.
 *
 * Spreading the playout budget across every legal point is what broke the first
 * search: on a 9x9 opening there are ~80 legal moves, so a 500-playout budget
 * became 6 per move, floored to 8 — far below the noise threshold, and the bot
 * played at random and was wiped off the board. Shortlisting to a handful of
 * plausible moves and sampling each properly is what turns the same budget into
 * an actual decision.
 */
export function heuristic(b, nbrs, idx, scratch) {
  const { out, seen } = scratch
  const scan2 = scratch.scan2
  scan2.set(b)
  const captured = play(scan2, nbrs, idx, US, scratch)
  if (captured < 0) return -1e9
  const mine = group(scan2, nbrs, idx, out, seen, ++scratch.mark)

  let rescued = 0
  let atari = 0
  const ns = nbrs[idx]
  for (let j = 0; j < ns.length; j++) {
    const p = ns[j]
    if (b[p] === US) {
      const before = group(b, nbrs, p, out, seen, ++scratch.mark)
      if (before.libs === 1) rescued += before.size
    } else if (scan2[p] === THEM) {
      const g = group(scan2, nbrs, p, out, seen, ++scratch.mark)
      if (g.libs === 1) atari += g.size
    }
  }
  // Same hole as tryPlay's: gating on `captured === 0` priced a capture that
  // leaves us in atari as `12 * captured` with no penalty at all.
  if (mine.libs === 1) return -500
  return 14 * rescued + 12 * captured + 6 * atari + 4 * Math.min(mine.libs, 6)
}

export function makeScratch(N) {
  return {
    out: new Int32Array(N * N),
    seen: new Int32Array(N * N),
    empties: new Int32Array(N * N),
    scan2: new Uint8Array(N * N),
    undo: new Uint8Array(N * N),
    visited: new Uint8Array(N * N),
    mark: 0,
  }
}

/**
 * Flat Monte Carlo over the legal root moves, with the budget shared out.
 *
 * Full UCT tree search buys little here: the opponent is a randomised heuristic
 * rather than an adversary that punishes shallow reading, and the decision we
 * need is only "which of ~100 root moves", which flat sampling answers directly
 * with far less bookkeeping and far less main-thread time per move.
 */
export function chooseMove(boardStrings, valid, N, komi, maxms, topK) {
  const nbrs = makeGeometry(N)
  const root = parseBoard(boardStrings)
  const scratch = makeScratch(N)
  let seed = (Date.now() ^ 0x9e3779b9) >>> 0
  const rand = () => {
    seed ^= seed << 13; seed >>>= 0
    seed ^= seed >> 17
    seed ^= seed << 5; seed >>>= 0
    return seed / 4294967296
  }

  let all = []
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) {
      if (!valid[x] || !valid[x][y]) continue
      const idx = x * N + y
      const h = heuristic(root, nbrs, idx, scratch)
      if (h <= -500) continue
      all.push({ x, y, idx, h, wins: 0, visits: 0 })
    }
  }
  if (!all.length) return null

  // Shortlist, then sample each shortlisted move properly. TOP_K is chosen so
  // that a default 700-playout budget gives ~50 samples per move, which is
  // enough for the win-rate ordering to mean something.
  all.sort((a, b) => b.h - a.h)
  const candidates = all.slice(0, topK)
  const work = root.slice()

  // UCB1 rather than uniform round-robin.
  //
  // Round-robin spends the same budget on the worst candidate as the best,
  // which is wasteful at any budget and crippling at this one: at 20ms a move
  // there are only a few dozen playouts to spend across eight candidates, so
  // splitting them evenly leaves every estimate too noisy to order. UCB1 spends
  // them where the ordering is still in doubt, which is the entire point of
  // bandit allocation.
  //
  //     ucb = wins/visits + sqrt(2 * ln(total) / visits)
  //
  // Each candidate is seeded once first so no visits term is zero.
  const deadline = Date.now() + maxms
  let total = 0

  for (let c = 0; c < candidates.length; c++) {
    const cand = candidates[c]
    work.set(root)
    play(work, nbrs, cand.idx, US, scratch)
    cand.wins += playout(work, nbrs, N, komi, THEM, scratch, rand)
    cand.visits++
    total++
  }

  let rounds = total
  while (true) {
    let pick = null
    let bestU = -Infinity
    for (let c = 0; c < candidates.length; c++) {
      const cand = candidates[c]
      const u = cand.wins / cand.visits + Math.sqrt((2 * Math.log(total)) / cand.visits)
      if (u > bestU) {
        bestU = u
        pick = cand
      }
    }
    work.set(root)
    play(work, nbrs, pick.idx, US, scratch)
    pick.wins += playout(work, nbrs, N, komi, THEM, scratch, rand)
    pick.visits++
    total++
    rounds++
    // Checking the clock costs real time relative to one playout, so amortise.
    if ((rounds & 7) === 0 && Date.now() >= deadline) break
  }

  // Fall back to the static score if the clock was so tight nothing was sampled.
  if (!rounds) candidates.sort((a, b) => b.h - a.h)
  else candidates.sort((a, b) => b.wins / b.visits - a.wins / a.visits)
  return candidates
}



/**
 * Full UCT tree search. The strong path — used by the external solver, where
 * seconds of think time are available; the flat chooseMove above stays as the
 * cheap in-game fallback.
 *
 * Flat Monte Carlo tops out fast because it evaluates only the root move and
 * plays both sides randomly afterwards: at 400ms it beat the game's Daedalus
 * AI one game in three, and more budget bought almost nothing (20x budget ->
 * 1.34x farming). A tree remembers the opponent's best replies and re-searches
 * them, so depth grows with budget instead of noise shrinking with it.
 *
 * Standard UCT: descend by UCB1 (value from the perspective of the side to
 * move), expand one untried child ordered by the static heuristic, play out
 * with the tactical policy, backpropagate. Pass is a legal child; two passes
 * end the game and score it exactly. Perspective note: every node stores wins
 * for US, and the selection value flips sign for THEM-to-move nodes.
 */
const RAVE_K = 300

export function chooseMoveUCT(boardStrings, valid, N, komi, maxms) {
  const nbrs = makeGeometry(N)
  const root = parseBoard(boardStrings)
  const scratch = makeScratch(N)
  let seed = (Date.now() ^ 0x2545f491) >>> 0
  const rand = () => {
    seed ^= seed << 13; seed >>>= 0
    seed ^= seed >> 17
    seed ^= seed << 5; seed >>>= 0
    return seed / 4294967296
  }

  const PASS = -1
  const legal = (b, colour) => {
    const out = []
    for (let i = 0; i < N * N; i++) {
      if (b[i] !== EMPTY) continue
      if (colour === US && valid && b === root) {
        const x = (i / N) | 0
        if (!valid[x] || !valid[x][i % N]) continue
      }
      const ns = nbrs[i]
      let own = ns.length > 0
      for (let j = 0; j < ns.length; j++) if (b[ns[j]] !== colour) { own = false; break }
      if (own) continue
      out.push(i)
    }
    return out
  }

  const mkNode = (b, colour) => {
    const moves = legal(b, colour)
    // Order expansion by the static heuristic so the plausible moves enter the
    // tree first; UCT then corrects the ordering with real samples.
    const scored = moves.map((idx) => ({ idx, h: colour === US ? heuristic(b, nbrs, idx, scratch) : 0 }))
    if (colour === US) scored.sort((a, z) => z.h - a.h)
    else {
      // Shuffle opponent moves so expansion order is not systematically biased.
      for (let i = scored.length - 1; i > 0; i--) {
        const j = (rand() * (i + 1)) | 0
        const t = scored[i]; scored[i] = scored[j]; scored[j] = t
      }
    }
    scored.push({ idx: PASS, h: -1e6 })
    // raveV/raveW: AMAF statistics — for each point, how often it was played
    // (first, by this node's side-to-move) anywhere later in a simulation
    // through this node, and how those simulations ended for US.
    return { visits: 0, winsUS: 0, children: new Map(), untried: scored, colour, raveV: new Int32Array(N * N), raveW: new Float64Array(N * N) }
  }

  const rootNode = mkNode(root, US)
  const board = root.slice()
  const deadline = Date.now() + maxms
  let iters = 0

  // First-play-per-colour recorder, reused across iterations via stamps.
  const stampUS = new Int32Array(N * N)
  const stampTHEM = new Int32Array(N * N)
  const playedIdx = new Int32Array(N * N * 2)
  const playedCol = new Uint8Array(N * N * 2)
  let playedN = 0
  let stamp = 0
  const amaf = {
    record(idx, colour) {
      const arr = colour === US ? stampUS : stampTHEM
      if (arr[idx] === stamp) return
      arr[idx] = stamp
      playedIdx[playedN] = idx
      playedCol[playedN] = colour
      playedN++
    },
  }

  while (true) {
    board.set(root)
    let node = rootNode
    let colour = US
    let passStreak = 0
    const path = [rootNode]
    stamp++
    playedN = 0

    // --- selection + expansion ---
    let result = null
    while (true) {
      if (passStreak >= 2) {
        result = scoreBoard(board, nbrs, N, komi, scratch) > 0 ? 1 : 0
        break
      }
      if (node.untried.length) {
        const { idx } = node.untried.shift()
        if (idx === PASS) passStreak++
        else if (tryPlay(board, nbrs, idx, colour, scratch)) {
          amaf.record(idx, colour)
          passStreak = 0
        } else {
          // Illegal by the time we reach it (board differs from when the list
          // was made). Skip it; if nothing is left this pass-through recurses.
          if (node.untried.length) continue
          passStreak++
        }
        const next = mkNode(board, colour === US ? THEM : US)
        node.children.set(idx, next)
        path.push(next)
        // --- playout from the new leaf ---
        result = passStreak >= 2
          ? (scoreBoard(board, nbrs, N, komi, scratch) > 0 ? 1 : 0)
          : playout(board, nbrs, N, komi, colour === US ? THEM : US, scratch, rand, amaf)
        break
      }
      // fully expanded: UCB1 descent
      let best = null
      let bestU = -Infinity
      const logv = Math.log(node.visits + 1)
      for (const [idx, child] of node.children) {
        const mean = child.visits ? child.winsUS / child.visits : 0.5
        // RAVE/AMAF blend (Gelly & Silver): at low child visit counts, lean on
        // the all-moves-as-first estimate — every simulation through this node
        // that played `idx` at any later point contributes — and hand over to
        // the true UCT mean as direct samples accumulate. beta's half-life is
        // set by RAVE_K visits. This is what makes a few thousand playouts
        // meaningful on a 9x9: raw visit counts alone are spread too thin.
        let blended = mean
        if (idx !== PASS && node.raveV[idx] > 0) {
          const raveMean = node.raveW[idx] / node.raveV[idx]
          const beta = Math.sqrt(RAVE_K / (3 * child.visits + RAVE_K))
          blended = (1 - beta) * mean + beta * raveMean
        }
        const value = node.colour === US ? blended : 1 - blended
        const u = value + Math.sqrt((1.2 * logv) / (child.visits + 1))
        if (u > bestU) { bestU = u; best = { idx, child } }
      }
      if (!best) { result = scoreBoard(board, nbrs, N, komi, scratch) > 0 ? 1 : 0; break }
      if (best.idx === PASS) passStreak++
      else if (tryPlay(board, nbrs, best.idx, colour, scratch)) {
        amaf.record(best.idx, colour)
        passStreak = 0
      } else passStreak++
      node = best.child
      path.push(node)
      colour = colour === US ? THEM : US
    }

    for (const n2 of path) {
      n2.visits++
      n2.winsUS += result
      // AMAF: credit every point this node's side-to-move played later in the
      // simulation, as if it had been chosen here first.
      for (let i = 0; i < playedN; i++) {
        if (playedCol[i] !== n2.colour) continue
        n2.raveV[playedIdx[i]]++
        n2.raveW[playedIdx[i]] += result
      }
    }

    iters++
    if ((iters & 15) === 0 && Date.now() >= deadline) break
  }

  // Most-visited root child is the classic robust choice.
  let bestIdx = null
  let bestVisits = -1
  for (const [idx, child] of rootNode.children) {
    if (idx === PASS) continue
    if (child.visits > bestVisits) { bestVisits = child.visits; bestIdx = idx }
  }
  if (bestIdx === null) return null
  return [{ x: (bestIdx / N) | 0, y: bestIdx % N, idx: bestIdx, visits: bestVisits, iters }]
}
