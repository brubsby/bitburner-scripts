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
 * Does the group at `idx` have AT LEAST `want` liberties?
 *
 * Same traversal as `group` above, stopped the moment the answer is known.
 * This exists because `group` walks the entire chain and counts every liberty,
 * while every caller in the hot path only compares against a threshold:
 * `play` asks "libs === 0", `tryPlay` asks "libs === 1", the playout's atari
 * scan asks "libs !== 1". On an open board most groups reach two liberties
 * within a step or two of the stone just played, so the walk returns almost
 * immediately instead of traversing the whole chain.
 *
 * A CPU profile of 102k playouts on an empty 5x5 put 50.6% of runtime in `play`
 * (with `group` inlined into it) and 0.5% in the garbage collector — so the
 * cost here is the traversal, not allocation, and shortening the traversal is
 * the whole optimisation.
 *
 * Behaviour-preserving by construction: it answers a predicate the callers
 * already computed from `group(...).libs`, and it answers it identically. It
 * does NOT replace the calls that need `size` or the true liberty count —
 * `heuristic` still uses `group`.
 */
export function libsAtLeast(b, nbrs, idx, want, out, seen, mark) {
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
        if (++libs >= want) return true
      } else if (v === colour) {
        seen[p] = mark
        out[n++] = p
      }
    }
  }
  return libs >= want
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
    // Cheap test first: the overwhelmingly common case is that the enemy group
    // still has a liberty, and then we never walk it. Only when it is actually
    // captured do we pay for the full walk, which we need anyway for the member
    // list to erase.
    if (libsAtLeast(b, nbrs, p, 1, out, seen, ++scratch.mark)) continue
    const g = group(b, nbrs, p, out, seen, ++scratch.mark)
    for (let i = 0; i < g.size; i++) b[out[i]] = EMPTY
    captured += g.size
  }
  // Only "is it suicide", i.e. libs === 0, so one liberty is enough to stop —
  // and an empty neighbour of the stone just played IS one, with no walk.
  if (!libsAtLeast(b, nbrs, idx, 1, out, seen, ++scratch.mark) && captured === 0) {
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
 * noise, and no amount of search budget fixes a biased estimator. The undo is
 * a single point (see below), far cheaper than computing the resulting
 * liberties analytically.
 */
export function tryPlay(b, nbrs, idx, colour, scratch) {
  const cap = play(b, nbrs, idx, colour, scratch)
  if (cap < 0) return false
  if (cap === 0) {
    // `play` succeeded and captured nothing, so the chain has at least one
    // liberty; reaching two is therefore exactly "not a self-atari" and the
    // walk can stop there. The `cap === 0` gate is preserved deliberately —
    // removing it was measured HARMFUL (it deletes legitimate captures and ko
    // recaptures from the tree, since tryPlay gates expansion).
    //
    // The undo is ONE point. This used to snapshot the whole board before
    // every play and restore it here — but on this branch nothing was
    // captured, so the only change `play` made is the stone itself. Clearing
    // it is the exact inverse. At 19x19 the snapshot was a 361-byte copy per
    // playout move and tryPlay was 22.5% of the solver's profile; on 5x5 it
    // was 25 bytes and nobody noticed. Output-identical (same rand stream).
    if (!libsAtLeast(b, nbrs, idx, 2, scratch.out, scratch.seen, ++scratch.mark)) {
      b[idx] = EMPTY
      return false
    }
  }
  return true
}

/**
 * Is this point a REAL eye for `colour`?
 *
 * The old test was "all orthogonal neighbours ours", which cannot tell a real
 * eye from a FALSE eye, and that error is fatal in exactly the way the bot was
 * losing games. A point ringed orthogonally by our stones but with enemy
 * stones on the diagonals is false: the opponent captures the diagonal-linked
 * chains, the "eye" becomes fillable, and the whole group dies at once. The
 * playout policy refuses to fill anything this returns true for, so a
 * false-eyed group looked alive for the entire search, its win estimate stayed
 * optimistic, the bot never defended it — and then it lost every stone. A
 * finalScore of black 0 / white 22.5 on a 5x5 is what that looks like from
 * outside.
 *
 * The fix is the standard diagonal rule. An interior point tolerates one
 * hostile diagonal (two independent cutting points are needed to break it); a
 * point on the edge or in a corner tolerates none, because it has fewer
 * diagonals to spare. 5x5 boards are nearly all edge, which is why this
 * mattered so much here.
 *
 * DEAD points (`#` obstacles) count as FRIENDLY in both tests, orthogonal and
 * diagonal. The opponent can never occupy an obstacle, so a point enclosed by
 * our stones and obstacles is a genuine eye. The old code returned false for
 * those — an error in the opposite direction with the same symptom, since a
 * playout that happily fills a real eye also kills its own group. Both
 * directions are wrong and both are fixed here.
 */
function isOwnEye(b, nbrs, idx, colour, N) {
  const ns = nbrs[idx]
  if (!ns.length) return false
  for (let j = 0; j < ns.length; j++) {
    const v = b[ns[j]]
    if (v !== colour && v !== DEAD) return false
  }
  const x = (idx / N) | 0
  const y = idx % N
  let hostile = 0
  let offBoard = 0
  for (let dx = -1; dx <= 1; dx += 2) {
    for (let dy = -1; dy <= 1; dy += 2) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) {
        offBoard++
        continue
      }
      const v = b[nx * N + ny]
      if (v !== colour && v !== DEAD) hostile++
    }
  }
  return hostile <= (offBoard ? 0 : 1)
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
  // The area split rides out on the scratch for score-aware objectives
  // (chooseMoveUCT's opts.objective), which need black's AREA, not only the
  // sign of the margin. Two stores; free to callers that ignore them.
  scratch.us = us
  scratch.them = them
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
        // Two liberties rules the group out of the atari scan, and that is the
        // common case; only a group actually in atari pays for the full walk,
        // which the liberty search below needs anyway.
        if (libsAtLeast(b, nbrs, p, 2, scratch.out, scratch.seen, ++scratch.mark)) continue
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
        if (b[idx] !== EMPTY || isOwnEye(b, nbrs, idx, colour, N)) continue
        if (tryPlay(b, nbrs, idx, colour, scratch)) { if (amaf) amaf.record(idx, colour); last = idx; played = true }
      }
    }

    // --- 3. Anywhere else --------------------------------------------------
    for (let k = 0; k < n && !played; k++) {
      const idx = e[k]
      if (b[idx] !== EMPTY || isOwnEye(b, nbrs, idx, colour, N)) continue
      if (tryPlay(b, nbrs, idx, colour, scratch)) { if (amaf) amaf.record(idx, colour); last = idx; played = true }
    }

    if (played) passes = 0
    else passes++
    colour = enemy
  }

  return scoreBoard(b, nbrs, N, komi, scratch) > 0 ? 1 : 0
}

/**
 * ONE move of the light playout policy (the same three tiers as `playout`:
 * answer an atari next to the last move — capture first, then save — then a
 * local reply 75% of the time, then any legal non-eye, non-self-atari point),
 * played on `b`. Returns the point played, or -1 for a pass. For playouts that
 * interleave this with a different policy for the other side
 * (chooseMoveModel's model leaves).
 */
export function lightMove(b, nbrs, N, colour, last, scratch, rand) {
  const enemy = colour === US ? THEM : US
  if (last >= 0) {
    let save = -1
    let take = -1
    const ln = nbrs[last]
    for (let j = 0; j < ln.length; j++) {
      const p = ln[j]
      const v = b[p]
      if (v !== colour && v !== enemy) continue
      if (libsAtLeast(b, nbrs, p, 2, scratch.out, scratch.seen, ++scratch.mark)) continue
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
      if (tryPlay(b, nbrs, urgent, colour, scratch)) return urgent
    }
    if (rand() < 0.75) {
      const lx = (last / N) | 0
      const ly = last % N
      const start = (rand() * 8) | 0
      for (let k = 0; k < 8; k++) {
        const d = (start + k) % 8
        const nx = lx + [1, -1, 0, 0, 1, 1, -1, -1][d]
        const ny = ly + [0, 0, 1, -1, 1, -1, 1, -1][d]
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue
        const idx = nx * N + ny
        if (b[idx] !== EMPTY || isOwnEye(b, nbrs, idx, colour, N)) continue
        if (tryPlay(b, nbrs, idx, colour, scratch)) return idx
      }
    }
  }
  const e = scratch.empties
  let n = 0
  for (let i = 0; i < N * N; i++) if (b[i] === EMPTY) e[n++] = i
  for (let i = n - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0
    const t = e[i]
    e[i] = e[j]
    e[j] = t
  }
  for (let k = 0; k < n; k++) {
    const idx = e[k]
    if (isOwnEye(b, nbrs, idx, colour, N)) continue
    if (tryPlay(b, nbrs, idx, colour, scratch)) return idx
  }
  return -1
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
export function heuristic(b, nbrs, idx, scratch, colour = US) {
  const { out, seen } = scratch
  // `scratch.scan2`, NOT `scratch.probe`. makeScratch has never created a
  // `probe` field — the name was changed there to dodge a phantom RAM
  // collision (a bare `probe` identifier is priced 0.2GB by
  // RamCalculations.ts:407) and this read was not changed with it, so
  // `heuristic` threw `Cannot read properties of undefined (reading 'set')` on
  // its first line, every time.
  //
  // It stayed invisible because nothing restarted. The remote solver process
  // had imported golib.js before the rename and kept running the old module in
  // memory, and go.js's local fallback never fired (`localMoves: 0`) because
  // that solver always answered first. The bug was shipped, latent, and
  // detonated the moment both processes were restarted — which is the argument
  // for restarting deliberately rather than discovering it later.
  const scan2 = scratch.scan2
  scan2.set(b)
  // `colour` is the side placing the stone (default US, the only caller there
  // was until the 19x19 widening needed opponent nodes ordered too).
  const enemy = colour === US ? THEM : US
  const captured = play(scan2, nbrs, idx, colour, scratch)
  if (captured < 0) return -1e9
  const mine = group(scan2, nbrs, idx, out, seen, ++scratch.mark)

  let rescued = 0
  let atari = 0
  const ns = nbrs[idx]
  for (let j = 0; j < ns.length; j++) {
    const p = ns[j]
    if (b[p] === colour) {
      const before = group(b, nbrs, p, out, seen, ++scratch.mark)
      if (before.libs === 1) rescued += before.size
    } else if (scan2[p] === enemy) {
      const g = group(scan2, nbrs, p, out, seen, ++scratch.mark)
      if (g.libs === 1) atari += g.size
    }
  }
  if (mine.libs === 1 && captured === 0) return -500
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

/**
 * opts (all optional; `{}` is exactly the search measured on 5x5):
 *
 *   objective {win, loss}  Score playouts by the NODE POWER they would bank
 *                rather than by win/loss. scoring.ts:85-88 credits every game,
 *                win or lose, with black's AREA x difficulty x streak, and the
 *                streak factor is 0.5 on a loss (effect.ts:119-130). So the
 *                value of a finished playout is proportional to
 *                    area/points x (won ? 1 : loss/win)
 *                where `win`/`loss` are the streak multipliers this game would
 *                be credited at. A binary win/loss signal is FLAT when every
 *                playout loses — which is the hidden opponent's 19x19 with 7
 *                handicap stones and komi 9.5 — and the search then has
 *                nothing to choose between moves by.
 *   widen {k0, k}  Progressive widening: a node may hold at most
 *                k0 + k*sqrt(visits) children. Without it, the root of an open
 *                19x19 has ~300 untried moves and a few hundred iterations
 *                per second expand each ONCE — the "tree" is one ply of single
 *                playouts. PASS is placed inside the first k0.
 *   themHeur     Order the opponent's expansions by the same static heuristic
 *                (from its side) instead of shuffling them — with widening,
 *                only the first few are ever searched.
 *   opponentPassed  The opponent's last action was a pass, so OUR pass ends
 *                the game: the root starts with one pass on the streak and the
 *                PASS child is scored exactly.
 *   allowPass    Return [] (pass) when PASS is the most-visited root child.
 *                Without it the search always plays its best stone, which in
 *                a lost endgame is the long tail of score-neutral moves the
 *                opponent answers at ~1s each.
 */
export function chooseMoveUCT(boardStrings, valid, N, komi, maxms, opts = {}) {
  const nbrs = makeGeometry(N)
  const root = parseBoard(boardStrings)
  const scratch = makeScratch(N)
  const objective = opts.objective && opts.objective.win > 0 ? opts.objective : null
  const widen = opts.widen && opts.widen.k0 >= 1 ? opts.widen : null
  let points = 0
  for (let i = 0; i < N * N; i++) if (root[i] !== DEAD) points++
  const lossRatio = objective ? Math.max(0, objective.loss / objective.win) : 0
  // A finished simulation's value for US. scoreBoard has just run (playout's
  // last act, or the double-pass branch), so scratch.us is that board's area.
  const simValue = (won) => (objective ? (scratch.us / points) * (won ? 1 : lossRatio) : won)
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
    const heurThem = colour === THEM && opts.themHeur
    const scored = moves.map((idx) => ({ idx, h: colour === US || heurThem ? heuristic(b, nbrs, idx, scratch, colour) : 0 }))
    if (colour === US || heurThem) scored.sort((a, z) => z.h - a.h)
    else {
      // Shuffle opponent moves so expansion order is not systematically biased.
      for (let i = scored.length - 1; i > 0; i--) {
        const j = (rand() * (i + 1)) | 0
        const t = scored[i]; scored[i] = scored[j]; scored[j] = t
      }
    }
    if (widen) scored.splice(Math.min(scored.length, widen.k0 - 1), 0, { idx: PASS, h: -1e6 })
    else scored.push({ idx: PASS, h: -1e6 })
    // raveV/raveW: AMAF statistics — for each point, how often it was played
    // (first, by this node's side-to-move) anywhere later in a simulation
    // through this node, and how those simulations ended for US.
    return { visits: 0, winsUS: 0, children: new Map(), untried: scored, colour, raveV: new Int32Array(N * N), raveW: new Float64Array(N * N) }
  }

  const rootNode = mkNode(root, US)

  // Nothing legal but PASS: there is no decision to make, so do not spend the
  // whole budget discovering that. mkNode appends PASS to `untried` after the
  // legal moves, so a length of 1 means `legal()` returned nothing — every
  // remaining point is one of our own eyes or is filtered out by the game's
  // getValidMoves.
  //
  // The old code ran the full UCT loop to the deadline and then returned null
  // anyway, because the root can only ever acquire a PASS child. The solver log
  // shows exactly that:
  //     #1481 seq=1106 -> pass (1501ms, 0 iters)
  // 1.5s of wall clock, zero playouts. This is not rare any more: the
  // mirror-pass rule in go.js made passes routine (most games now end on one),
  // so it was a wasted 1.5s in nearly every game.
  //
  // Output-preserving: the return value is the same `null` it always was.
  if (rootNode.untried.length === 1 && rootNode.untried[0].idx === PASS) return null

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
    let passStreak = opts.opponentPassed ? 1 : 0
    const path = [rootNode]
    stamp++
    playedN = 0

    // --- selection + expansion ---
    let result = null
    while (true) {
      if (passStreak >= 2) {
        result = simValue(scoreBoard(board, nbrs, N, komi, scratch) > 0 ? 1 : 0)
        break
      }
      if (node.untried.length && (!widen || node.children.size < widen.k0 + widen.k * Math.sqrt(node.visits))) {
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
        result = simValue(passStreak >= 2
          ? (scoreBoard(board, nbrs, N, komi, scratch) > 0 ? 1 : 0)
          : playout(board, nbrs, N, komi, colour === US ? THEM : US, scratch, rand, amaf))
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
      if (!best) { result = simValue(scoreBoard(board, nbrs, N, komi, scratch) > 0 ? 1 : 0); break }
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
  if (opts.allowPass) {
    const passNode = rootNode.children.get(PASS)
    if (passNode && passNode.visits > bestVisits) return []
  }
  if (bestIdx === null) return null
  return [{ x: (bestIdx / N) | 0, y: bestIdx % N, idx: bestIdx, visits: bestVisits, iters }]
}

/**
 * chooseMoveModel's root decision between PASS and its most-visited stone.
 *
 * PASS only when the search believes passing WINS (mean > 0.5 — the value is
 * 0.9 x won + 0.1 x area) and no stone is valued higher; then it must also be
 * the most-visited or clearly ahead. A pass that is merely "least bad" in a
 * lost position hands white free moves — observed before this rule: a
 * mid-game pass at 0 black area (tools/sim/go-w0.mjs --trace, 5x5 Illuminati),
 * chosen because every line lost and PASS collected the most visits.
 * With no stone at all, PASS is all there is.
 */
export function modelRootPasses({ passMean, passVisits, stoneMean, stoneVisits }) {
  if (stoneMean === null || stoneMean === undefined) return true
  if (!(passMean > 0.5) || passMean < stoneMean) return false
  return passVisits >= stoneVisits || passMean > stoneMean + 0.02
}

/**
 * OPPONENT-MODEL SEARCH: expectimax-UCT against the opponent's ACTUAL policy.
 *
 * chooseMoveUCT searches as if white were an adversary choosing among all its
 * moves; the opponent is not that. It is the game's own getMove
 * (Go/boardAnalysis/goAI.ts) — a fixed rule cascade (capture, defend, eye,
 * surround, eye-block, corner, pattern, jump, ...) whose only randomness is a
 * few WHRNG draws (goAI.ts:184-210) and getDefendMove's Math.random. Given that
 * policy, white's reply is a chance node with a handful of outcomes, and the
 * game becomes close to single-agent planning: find the black line that wins
 * against what white WILL play. That is a far smaller and far more accurate
 * search than minimax against a phantom opponent, and it is where the 5x5
 * Illuminati losses came from (tools/sim/go-w0.mjs --trace: the minimax
 * search spends its budget refuting replies white never plays).
 *
 * The policy is INJECTED (`model.reply`), never imported: golib stays pure and
 * free in-game, and the out-of-game solver supplies the game's own code
 * bundled by tools/goai (verified reply-for-reply against the full game,
 * tools/goai/check.mjs). In-game there is no model and this is never called.
 *
 *   model.reply(simpleBoard, { history, passCount, rng }) -> {x, y} | null (pass)
 *
 * Tree: B nodes (black to move) choose by UCB1 over black's actions (stones
 * ordered by the static heuristic, then PASS); W nodes (white to move) are
 * chance nodes that draw replies from the model, at most `samples` distinct
 * draws growing with log2(visits) — the AI is nearly deterministic, so a few
 * draws cover its distribution. Each iteration costs at most one model call.
 * Leaves are scored by the light playout from the B node white's reply left.
 * Two consecutive passes end the game and are scored exactly (the game's
 * getScore: stones + single-colour-bordered empty regions, komi to white).
 *
 * Value is black's: (1 - areaWeight) * won + areaWeight * blackArea/points —
 * the win decides (the streak multiplier is up to 6x, effect.ts:119-130), the
 * area term (node power credits black's area, scoring.ts:85-88) breaks ties
 * between lines that all win or all lose.
 *
 * opts: history (previous board strings, most recent first — the game's
 *       BoardState.previousBoards; feeds the AI's superko filter),
 *       opponentPassed, areaWeight (0.1), c (UCB, 0.6), samples (6).
 * Returns [{x, y, idx, visits, iters, modelCalls, value}] or [] for pass, or
 * null when black has no legal stone and passing is all there is.
 */
export async function chooseMoveModel(boardStrings, valid, N, komi, maxms, opts = {}, model) {
  const nbrs = makeGeometry(N)
  const root = parseBoard(boardStrings)
  const scratch = makeScratch(N)
  const areaW = Number.isFinite(opts.areaWeight) ? opts.areaWeight : 0.1
  const C = Number.isFinite(opts.c) ? opts.c : 0.6
  const SAMPLES = Number.isFinite(opts.samples) ? opts.samples : 6
  const rootHistory = Array.isArray(opts.history) ? opts.history : []
  let points = 0
  for (let i = 0; i < N * N; i++) if (root[i] !== DEAD) points++
  let seed = (Date.now() ^ 0x5bd1e995) >>> 0
  const rand = () => {
    seed ^= seed << 13; seed >>>= 0
    seed ^= seed >> 17
    seed ^= seed << 5; seed >>>= 0
    return seed / 4294967296
  }
  const PASS = -1
  const CH = ['.', 'X', 'O', '#']
  const toStr = (b) => {
    let s = ''
    for (let i = 0; i < N * N; i++) s += CH[b[i]]
    return s
  }
  const toSimple = (s) => {
    const out = []
    for (let x = 0; x < N; x++) out.push(s.slice(x * N, (x + 1) * N))
    return out
  }
  const valueNow = (b) => {
    const m = scoreBoard(b, nbrs, N, komi, scratch)
    return (1 - areaW) * (m > 0 ? 1 : 0) + areaW * (scratch.us / points)
  }

  // Black's candidate actions at a node: stones (not own-eye fills, not
  // self-atari unless capturing — the same gate tryPlay applies) best-first by
  // the static heuristic, then PASS. The root uses the game's own valid list.
  const actions = (b, isRoot) => {
    const out = []
    for (let i = 0; i < N * N; i++) {
      if (b[i] !== EMPTY) continue
      if (isRoot && valid) {
        const x = (i / N) | 0
        if (!valid[x] || !valid[x][i % N]) continue
      }
      const ns = nbrs[i]
      let own = ns.length > 0
      for (let j = 0; j < ns.length; j++) if (b[ns[j]] !== US && b[ns[j]] !== DEAD) { own = false; break }
      if (own) continue
      const h = heuristic(b, nbrs, i, scratch, US)
      if (h <= -1e9) continue
      out.push({ idx: i, h })
    }
    out.sort((a, z) => z.h - a.h)
    out.push({ idx: PASS, h: -1e6 })
    return out
  }

  const mkB = (b, parent, passCount, isRoot) => {
    const node = { kind: 0, b, s: toStr(b), parent, passCount, visits: 0, sum: 0, children: new Map(), untried: null, terminal: passCount >= 2, tv: 0 }
    if (node.terminal) node.tv = valueNow(b)
    else node.untried = actions(b, isRoot)
    return node
  }
  const mkW = (b, parent, passCount, moved) => {
    const node = { kind: 1, b, s: moved ? toStr(b) : parent.s, parent, passCount, moved, visits: 0, sum: 0, samples: new Map(), draws: 0, terminal: passCount >= 2, tv: 0 }
    if (node.terminal) node.tv = valueNow(b)
    return node
  }
  // previousBoards for the AI at W node w: the board before every STONE move
  // on the path (passes add none, boardState.ts:146-158), most recent first,
  // then the game's own history at the root.
  const historyOf = (w) => {
    const h = []
    let n = w
    while (n.parent) {
      if (n.moved) h.push(n.parent.s)
      n = n.parent
    }
    return h.concat(rootHistory)
  }

  const rootNode = mkB(root, null, opts.opponentPassed ? 1 : 0, true)
  if (rootNode.untried.length === 1) return null // PASS only

  const deadline = Date.now() + maxms
  let iters = 0
  let modelCalls = 0

  // opts.leaf === 'model': leaves are scored by playing the game out with
  // WHITE ON THE MODEL (the opponent as it will actually play) and black on
  // the light policy (lightMove), up to opts.leafDepth white moves, then the
  // ordinary light playout to the end. Costs one model call per white move.
  const LEAF_MODEL = opts.leaf === 'model'
  const LEAF_DEPTH = Number.isFinite(opts.leafDepth) ? opts.leafDepth : Infinity
  const modelPlayout = async (node, lastWhite) => {
    work.set(node.b)
    const hist = historyOf(node.parent)
    hist.unshift(node.parent.s) // the board before white's reply
    if (lastWhite === PASS) hist.shift()
    let passes = node.passCount
    let last = lastWhite
    let whiteMoves = 0
    for (let turn = 0; turn < N * N * 2 && passes < 2; turn++) {
      // black
      const before = toStr(work)
      const mv = lightMove(work, nbrs, N, US, last, scratch, rand)
      if (mv < 0) passes++
      else {
        passes = 0
        hist.unshift(before)
      }
      if (passes >= 2) break
      if (whiteMoves >= LEAF_DEPTH) {
        const won = playout(work, nbrs, N, komi, THEM, scratch, rand)
        return (1 - areaW) * won + areaW * (scratch.us / points)
      }
      // white, by the model
      const ws = toStr(work)
      modelCalls++
      whiteMoves++
      const r = await model.reply(toSimple(ws), { history: hist, passCount: passes, rng: 1 + Math.floor(rand() * 3e7) })
      if (r && play(work, nbrs, r.x * N + r.y, THEM, scratch) >= 0) {
        passes = 0
        hist.unshift(ws)
        last = r.x * N + r.y
      } else {
        passes++
        last = -1
      }
    }
    return valueNow(work)
  }
  const work = new Uint8Array(N * N)
  while (Date.now() < deadline || iters < 1) {
    let node = rootNode
    const path = [rootNode]
    let v = null
    while (v === null) {
      if (node.terminal) {
        v = node.tv
        break
      }
      if (node.kind === 0) {
        if (node.untried.length) {
          const { idx } = node.untried.shift()
          const b = node.b.slice()
          let moved = false
          if (idx !== PASS) {
            if (play(b, nbrs, idx, US, scratch) < 0) continue // suicide after all: drop it
            moved = true
          }
          const w = mkW(b, node, moved ? 0 : node.passCount + 1, moved)
          node.children.set(idx, w)
          node = w
          path.push(w)
          continue
        }
        let best = null
        let bestU = -Infinity
        const logv = Math.log(node.visits + 1)
        for (const child of node.children.values()) {
          const mean = child.visits ? child.sum / child.visits : 0.5
          const u = mean + C * Math.sqrt(logv / (child.visits + 1))
          if (u > bestU) { bestU = u; best = child }
        }
        if (!best) { v = valueNow(node.b); break }
        node = best
        path.push(node)
        continue
      }
      // W node: draw a fresh reply while under the sample cap, else replay one.
      const cap = Math.min(SAMPLES, 1 + Math.floor(Math.log2(1 + node.visits)))
      if (node.draws < cap) {
        node.draws++
        modelCalls++
        const r = await model.reply(toSimple(node.s), { history: historyOf(node), passCount: node.passCount, rng: 1 + Math.floor(rand() * 3e7) })
        const key = r ? r.x * N + r.y : PASS
        let e = node.samples.get(key)
        if (!e) {
          const b = node.b.slice()
          let ok = true
          if (key !== PASS) ok = play(b, nbrs, key, THEM, scratch) >= 0
          e = { n: 0, child: mkB(ok ? b : node.b.slice(), node, key !== PASS && ok ? 0 : node.passCount + 1, false) }
          node.samples.set(key, e)
          e.n++
          node = e.child
          path.push(node)
          // Leaf: score it by a playout from black's turn.
          if (node.terminal) v = node.tv
          else if (LEAF_MODEL) v = await modelPlayout(node, key)
          else {
            work.set(node.b)
            const won = playout(work, nbrs, N, komi, US, scratch, rand)
            v = (1 - areaW) * won + areaW * (scratch.us / points)
          }
          break
        }
        e.n++
        node = e.child
        path.push(node)
        continue
      }
      let pick = (rand() * node.draws) | 0
      let chosen = null
      for (const e of node.samples.values()) {
        if (pick < e.n) { chosen = e; break }
        pick -= e.n
      }
      if (!chosen) chosen = node.samples.values().next().value
      node = chosen.child
      path.push(node)
    }
    for (const n of path) {
      n.visits++
      n.sum += v
    }
    iters++
  }

  let bestIdx = null
  let bestVisits = -1
  for (const [idx, child] of rootNode.children) {
    if (idx === PASS) continue
    if (child.visits > bestVisits) { bestVisits = child.visits; bestIdx = idx }
  }
  const passNode = rootNode.children.get(PASS)
  const meanOf = (c) => (c && c.visits ? c.sum / c.visits : null)
  const stone = bestIdx === null ? null : rootNode.children.get(bestIdx)
  if (passNode && modelRootPasses({ passMean: meanOf(passNode), passVisits: passNode.visits, stoneMean: stone ? meanOf(stone) : null, stoneVisits: bestVisits })) return []
  if (bestIdx === null) return null
  const ch = rootNode.children.get(bestIdx)
  return [{ x: (bestIdx / N) | 0, y: bestIdx % N, idx: bestIdx, visits: bestVisits, iters, modelCalls, value: ch.visits ? ch.sum / ch.visits : null }]
}

/**
 * The board strings after OUR stone at (x, y), captures resolved — or null if
 * the move is suicide. For choosing the second stone of a two-move cheat on the
 * position the first one leaves (go.js). ns.go.cheat.playTwoMoves validates
 * BOTH points against the board before either is placed (NetscriptFunctions/
 * Go.ts playTwoMoves), so the caller also keeps the second inside the original
 * valid set.
 */
export function applyMove(boardStrings, x, y) {
  const N = boardStrings.length
  const b = parseBoard(boardStrings)
  if (play(b, makeGeometry(N), x * N + y, US, makeScratch(N)) < 0) return null
  const ch = ['.', 'X', 'O', '#']
  const out = []
  for (let i = 0; i < N; i++) {
    let row = ''
    for (let j = 0; j < N; j++) row += ch[b[i * N + j]]
    out.push(row)
  }
  return out
}

// ---------------------------------------------------------------------------
// THE CHEAT ROLL IS A CLOCK. ns.go.cheat.* rolls `new WHRNG(Player.totalPlaytime)
// .random()` (Go/effects/netscriptGoImplementation.ts:512,518) — a Wichmann-Hill
// generator seeded s1=s2=s3=(T/1000)%30000 and stepped ONCE (Casino/RNG.ts:40-63).
// One step multiplies the seed by 171/172/170 mod 30269/30307/30323, so the
// draw is frac(v*(171/30269 + 172/30307 + 170/30323)) up to the moduli: a
// SAWTOOTH in playtime, rising 0.016932 per second, period 59.06s. Success is
// `roll <= cheatSuccessChance(cheatCount)` (:518, :561-567), so a script that
// reads getPlayer().totalPlaytime and calls the cheat in the same synchronous
// tick (no await between) knows the outcome before it commits.
// ---------------------------------------------------------------------------

/** The game's WHRNG first draw for a playtime T (ms) — bit-for-bit Casino/RNG.ts:40-63. */
export function cheatRoll(T) {
  const v = (T / 1000) % 30000
  const s1 = (171 * v) % 30269
  const s2 = (172 * v) % 30307
  const s3 = (170 * v) % 30323
  return (s1 / 30269.0 + s2 / 30307.0 + s3 / 30323.0) % 1.0
}

/** Rise of the roll per second of playtime (between wraps). */
export const CHEAT_ROLL_RATE = 171 / 30269 + 172 / 30307 + 170 / 30323

/**
 * cheatSuccessChance (netscriptGoImplementation.ts:561-567):
 *   min(1, 0.6 * (0.7 - 0.02k)^k * crime_success + (SF14.3 ? 0.25 : 0)), floored at 0.
 */
export function cheatChance(k, crimeSuccess = 1, sf14 = 0) {
  const c = 0.6 * (0.7 - 0.02 * k) ** k * crimeSuccess + (sf14 === 3 ? 0.25 : 0)
  return Math.max(Math.min(c, 1), 0)
}

/**
 * Seconds of playtime until the roll is next <= p (0 if it is now). The roll
 * wraps from ~1 to ~0 and then rises, so the window opens at the wrap.
 */
export function cheatWaitS(T, p) {
  const r = cheatRoll(T)
  if (r <= p) return 0
  return (1 - r) / CHEAT_ROLL_RATE
}
