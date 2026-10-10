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
export function modelRootPasses({ passMean, passVisits, stoneMean, stoneVisits, passWin }) {
  if (stoneMean === null || stoneMean === undefined) return true
  // Under the power objective (release 3) the value is node power, not a win
  // probability, so "passing wins" is read from the PASS line's own win rate.
  const wins = passWin === undefined ? passMean > 0.5 : passWin > 0.5
  if (!wins || passMean < stoneMean) return false
  return passVisits >= stoneVisits || passMean > stoneMean + 0.02
}

// ---------------------------------------------------------------------------
// THE POWER OBJECTIVE (release 3). What a finished game is WORTH is the node
// power it banks (scoring.ts:85-88):
//
//   nodePower += black.sum x difficulty(komi, size) x winstreakMultiplier
//
// so black's AREA is paid directly and the win only moves the streak:
// effect.ts:119-130 pays 1 + 0.25 min(s, 8) on a win that extends streak s-1
// to s, 1 + 0.5 min(-old, 8) on the win that ends a dry streak, 0.5 on any
// loss — and a loss also RESETS the streak, so the next ~8 games earn the
// ramp back instead of the plateau. That future cost is priced here
// (lossFuture, in node power) by replaying the game's bookkeeping over the
// next `horizon` games assumed won, after a win now vs after a loss now.
//
// Time is the other price. The farm's output is power PER HOUR, and a longer
// game delays every later one: by the renewal-reward argument the right
// per-game objective is  E[power] - R x E[time],  R = the rate being earned
// (Dinkelbach). Each of our turns costs a turn of wall clock (our move + the
// AI's reply, ~1.2s live), so a line is charged turnCost = R x turnS per ply.
// ---------------------------------------------------------------------------

/** A stone instead of a game-ending winning PASS needs at least this win rate in its own line. */
export const SAFE_CONTINUE = 0.99
// A second-stone root's "no second stone" (bestOf, setRoot cheatSecond): chosen
// when its line's win share beats the most-visited stone's by more than this
// (the decline's margin, go.js SETTINGS.cheat.decline), on at least
// SECOND_PASS_MIN visits.
export const SECOND_PASS_MARGIN = 0.1
export const SECOND_PASS_MIN = 10

/** effect.ts:119-130 — the multiplier a game is paid at, from the streak after it and before it. */
export function streakMultiplier(s, old) {
  if (s < 0) return 0.5
  if (old < 0 && s > 0) return 1 + 0.5 * Math.min(-old, 8)
  return 1 + 0.25 * Math.min(s, 8)
}

/** The game's streak bookkeeping (scoring.ts:56-58, resetWinstreak): streak after a game. */
export function nextStreak(s, won) {
  if (won) return s < 0 ? 1 : s + 1
  return s >= 0 ? -1 : s - 1
}

/** effect.ts:132-135: (komi + 0.5) x 0.25, except 5x5 Illuminati (komi 7.5) which pays 8. */
export function difficultyMultiplier(komi, size) {
  return size === 5 && komi === 7.5 ? 8 : (komi + 0.5) * 0.25
}

/**
 * The objective a game at streak `streak` is played for, in node power.
 *   winMult    the multiplier THIS game pays if won
 *   lossMult   0.5
 *   lossFuture sum over the next `horizon` games (assumed won) of the
 *              multiplier they lose because this one was lost, x eBlack x diff
 *   turnCost   rate (power/s) x turnS: the price of one more turn
 * `lossScale` scales lossFuture (1 = priced; the knob the harness tunes).
 */
export function powerObjective({ streak = 0, komi, size, eBlack = 16, rate = 0, turnS = 1.2, horizon = 12, lossScale = 1, leafK = 0 } = {}) {
  const diff = difficultyMultiplier(komi, size)
  const sw = nextStreak(streak, true)
  const sl = nextStreak(streak, false)
  const winMult = streakMultiplier(sw, streak)
  let a = sw, b = sl, future = 0
  for (let i = 0; i < horizon; i++) {
    const a2 = nextStreak(a, true)
    const b2 = nextStreak(b, true)
    future += streakMultiplier(a2, a) - streakMultiplier(b2, b)
    a = a2
    b = b2
  }
  return { kind: 'power', diff, winMult, lossMult: 0.5, lossFuture: lossScale * future * eBlack * diff, turnCost: rate * turnS, leafK }
}

/**
 * THE AI'S RNG IS SEEDED BY THE CLOCK (goAI.ts:184): after one waitCycle
 * following our move, getMove builds new WHRNG(Player.totalPlaytime), and
 * totalPlaytime only moves in whole engine cycles of 200ms (engine.tsx:84-96).
 * So the seed of the AI's NEXT reply is one of a handful of values,
 * T + 200k, where T is the playtime when we moved and k the engine ticks in
 * between (calibrated online: seedCalib). Further ahead the turn timing blurs
 * the seed by several ticks: the first draw (isSmart) still moves only 0.017
 * per second, the second 0.6 per tick, the rest are chaotic — so deeper chance
 * nodes draw seeds jittered around the expected tick, which keeps isSmart
 * right and leaves the rest random.
 *
 *   clock = { T, kw: [[k, weight]...], turnTicks, jitter, eps, gaps? }
 * eps: the share of draws that ignore the clock (a free seed) — robustness
 * against a lag the calibration has not seen.
 *
 * gaps: [[ticks, weight]...], the MEASURED distribution of engine ticks
 * between two of our consecutive plays (gapCalib). With it a reply d of our
 * turns ahead is seeded d gap draws later; without it, round(d x turnTicks)
 * +- a uniform `jitter`. The two differ where it matters: live Netburners
 * 2026-10-09, 1729 pre-sent plays, gaps of 2 ticks 51%, 3 24%, 4 17%, 5-6 8%
 * — while turnS 0.70 s modelled 4 +- 5 ticks (-1..9, ~1/11 each). So the
 * ponder priced its answers (each one a reply of ours, d = 1) mostly at seeds
 * the AI would never be drawn at: a PASS — a pure bet on the AI's seeded
 * reply — looked winning across the blur and was pre-sent on an open board
 * (the 2026-10-09 17:24:13Z Netburners loss: plies 3 and 8).
 * MEASURED NEGATIVE as a default (go-w0 --clock-gaps vs the blur, live
 * configs + b4c32, --work-rate 1.7, bubtop, 2026-10-09): Netburners -0.5%
 * [-2.6, +1.8] (1200 paired), Daedalus -3.2% [-7.6, +1.0] (450, lost 4 vs 0),
 * Illuminati -4.7% [-13.4, +3.8] (200, lost 5 vs 3) — the sharper seeds
 * overfit the search to one predicted reply. Off (go-solver --clock-gaps).
 */
export function clockSeed(clock, d, rand) {
  if (!clock || !(clock.T > 0) || d < 0 || rand() < (clock.eps ?? 0.1)) return 1 + Math.floor(rand() * 3e7)
  let u = rand() * clock.kw.reduce((a, [, w]) => a + w, 0)
  let k = clock.kw[0][0]
  for (const [kk, w] of clock.kw) {
    if (u < w) { k = kk; break }
    u -= w
  }
  if (d > 0) {
    const G = clock.gaps
    if (Array.isArray(G) && G.length) {
      const tot = G.reduce((a, [, w]) => a + w, 0)
      for (let i = 0; i < d; i++) {
        let v = rand() * tot
        let g = G[G.length - 1][0]
        for (const [gg, w] of G) {
          if (v < w) { g = gg; break }
          v -= w
        }
        k += g
      }
    } else {
      const J = clock.jitter ?? 5
      k += Math.round(d * (clock.turnTicks ?? 6)) + Math.round((2 * rand() - 1) * J)
    }
  }
  return clock.T + 200 * k
}

/**
 * THE PLAY CADENCE (clockSeed's `gaps`): engine ticks between two of our
 * consecutive plays in one game, kept over the last `keep` and smoothed by
 * `smooth` pseudo-counts on each neighbouring tick. weights() is null until
 * `min` gaps are seen (clockSeed then blurs by turnTicks +- jitter as before).
 * observe(ticks) ignores gaps outside [1, maxTicks] (a stall, a new game).
 */
export function gapCalib({ keep = 400, min = 20, maxTicks = 15, smooth = 0.5 } = {}) {
  const obs = []
  let cached = null
  return {
    observe(ticks) {
      const g = Math.round(ticks)
      if (!(g >= 1 && g <= maxTicks)) return false
      obs.push(g)
      if (obs.length > keep) obs.shift()
      cached = null
      return true
    },
    weights() {
      if (obs.length < min) return null
      if (cached) return cached
      const c = new Map()
      for (const g of obs) {
        c.set(g, (c.get(g) ?? 0) + 1)
        for (const n of [g - 1, g + 1]) if (n >= 1) c.set(n, (c.get(n) ?? 0) + smooth / obs.length)
      }
      const tot = [...c.values()].reduce((a, b) => a + b, 0)
      cached = [...c.entries()].sort((a, b) => a[0] - b[0]).map(([g, n]) => [g, n / tot])
      return cached
    },
    get stats() {
      const w = this.weights()
      return { observed: obs.length, weights: w ? [...w].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([g, x]) => [g, Number(x.toFixed(3))]) : null }
    },
  }
}

/**
 * Online calibration of the seed lag. `observe(matches)` takes the set of k
 * whose seed reproduces the AI's actual reply (all k equally if the reply did
 * not depend on the seed — uninformative and skipped); `weights()` returns the
 * normalised [[k, w]...] with a prior so one odd observation cannot zero a k.
 *
 * MAXIMUM LIKELIHOOD, not a split count (opts.mode 'em', the default). The
 * split count gave every k in a match set an equal share, so a lag that is
 * right almost every time still read as a third of the mass: live 2026-10-06
 * k=1 reproduced 76 of 77 Tetrads replies (go-games.txt T), yet the solver's
 * weights were [[1, 0.32], [3, 0.13], [-1, 0.12], [6, 0.12]] — the search drew
 * the AI's reply from a wrong lag two times in three. EM over the last `keep`
 * match sets (P(k) maximising prod_obs sum_{k in M} P(k), the prior as
 * pseudo-counts) puts the mass where the evidence is. mode 'split': the old
 * estimator (A/B).
 */
export function seedCalib(prior = [[0, 0.1], [1, 0.6], [2, 0.25], [3, 0.05]], range = [-1, 6], { mode = 'em', keep = 400, iters = 30 } = {}) {
  const counts = new Map()
  for (let k = range[0]; k <= range[1]; k++) counts.set(k, 0)
  for (const [k, w] of prior) counts.set(k, (counts.get(k) ?? 0) + 2 * w)
  const pseudo = new Map(counts)
  const obs = []
  let cached = null
  let informative = 0
  let predicted = 0
  let observed = 0
  const norm = (m) => {
    const tot = [...m.values()].reduce((a, b) => a + b, 0)
    return [...m.entries()].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).map(([k, c]) => [k, c / tot])
  }
  return {
    range,
    observe(matches, predictedK = null) {
      observed++
      const all = range[1] - range[0] + 1
      if (!matches.length || matches.length >= all) return false
      informative++
      if (predictedK !== null && matches.includes(predictedK)) predicted++
      for (const k of matches) counts.set(k, (counts.get(k) ?? 0) + 1 / matches.length)
      obs.push(matches.slice())
      if (obs.length > keep) obs.shift()
      cached = null
      return true
    },
    weights() {
      if (mode !== 'em' || !obs.length) return norm(counts)
      if (cached) return cached
      let w = new Map(counts)
      for (let it = 0; it < iters; it++) {
        const next = new Map(pseudo)
        for (const M of obs) {
          let z = 0
          for (const k of M) z += w.get(k) ?? 0
          for (const k of M) next.set(k, (next.get(k) ?? 0) + (z > 0 ? (w.get(k) ?? 0) / z : 1 / M.length))
        }
        w = next
      }
      cached = norm(w)
      return cached
    },
    get stats() {
      return { observed, informative, predicted, weights: this.weights().slice(0, 4).map(([k, w]) => [k, Number(w.toFixed(3))]) }
    },
  }
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
  const s = modelSession(N, komi, model, opts)
  if (!s.setRoot(boardStrings, valid, { history: opts.history, opponentPassed: opts.opponentPassed })) return null // PASS only
  await s.search({ maxms })
  return s.best()
}

/**
 * THE MODEL SEARCH AS A SESSION: one tree kept across moves (release 2).
 *
 *   const s = modelSession(N, komi, model, opts)
 *   s.setRoot(board, valid, { history, opponentPassed, nnDepth? }) -> { reused, visits } | null (PASS only)
 *   await s.search({ maxms, untilVisits })   // grow the tree at the root
 *   s.best()                                 // as chooseMoveModel
 *   s.commit(x, y)                           // we played (x, y): its W node becomes the PONDER root
 *   await s.ponder(ms)                       // grow the tree under the AI's reply, while it thinks
 *
 * TREE REUSE. After commit, the W node (white to move, after our stone) is
 * kept with every reply the model has drawn there and their subtrees. When the
 * next position arrives, setRoot finds the reply that produced it among that
 * node's samples (same board string, same pass count) and makes that B node
 * the root: everything searched under it — before our move, and while
 * pondering — counts. A position not in the tree is searched fresh.
 *
 * PONDERING IS THE SAME SEARCH, FROM THE W NODE: each iteration draws the
 * AI's reply from the model (a chance node), so the effort spreads over the
 * replies in proportion to how likely the AI is to play them — the
 * probability-weighted ponder over every likely reply, for as long as the AI
 * takes, with no separate bookkeeping.
 *
 * The reused root is re-filtered to the game's valid list (the AI's superko
 * history for black lives there, not in the tree), and its stale PASS
 * decision is recomputed by best() exactly as for a fresh root.
 */
export function modelSession(N, komi, model, opts = {}) {
  const nbrs = makeGeometry(N)
  const scratch = makeScratch(N)
  const areaW = Number.isFinite(opts.areaWeight) ? opts.areaWeight : 0.1
  const C = Number.isFinite(opts.c) ? opts.c : 0.6
  const SAMPLES = Number.isFinite(opts.samples) ? opts.samples : 6
  const PASS_FIRST = !!opts.passFirst
  // THE OPEN PASS (opts.openPass): a PASS while the AI has not passed — the
  // game goes on and the AI moves again, so the pass is a bet on the AI's
  // seeded reply. 'allow' (as before): modelRootPasses decides, including its
  // "clearly better" escape on a handful of visits. 'visits': such a pass must
  // also be the most-visited child (the escape stays for the exact,
  // game-ending pass). 'request': never PRE-SENT (ponderAnswers withholds it;
  // go.js asks). 'fresh': as request, and the reused root drops the PASS's
  // ponder stats so the request re-prices it. 'never': no decision passes
  // while a stone other than an own-eye fill is on offer.
  // MEASURED (go-w0, Netburners live config + b4c32 depth 1, --work-rate 1.7,
  // bubtop, 1200 paired each, 2026-10-09; 1200/1200 won in every arm):
  //   visits +2.6% [+0.4, +5.0]   fresh +1.4% [-0.8, +3.7]
  //   never  +0.9% [-1.3, +3.1]   request -0.1% [-2.4, +2.2]
  // 'never' is also WRONG in principle: in the 17:24:13Z case from ply 9 the
  // only stone (3,0) loses every line and the pass wins 19-3.5 (forced stones
  // wiped 0-22.5) — a pass on an open board is right when every stone hurts.
  // Live: 'visits' where go-solver --open-pass-visits names the opponent.
  const OPEN_PASS = ['never', 'request', 'visits', 'fresh'].includes(opts.openPass) ? opts.openPass : 'allow'
  // THE NET (opts.nn, tools/katago/evaluator.mjs): an injected async
  // evaluator — eval(simpleBoard, komi) -> { policy (by idx), pass, winB,
  // areaB } for black to move. With it every new B node is scored by the
  // net (mixed with the playout by nn.mix: 1 = net only) and its stones are
  // chosen by PUCT on the net's policy instead of expand-all-then-UCB1;
  // nn.parallel iterations run at once (virtual loss), so the evaluator's
  // queries batch. Without opts.nn nothing below changes.
  const NN = opts.nn && typeof opts.nn.eval === 'function' ? opts.nn : null
  const NN_MIX = NN && Number.isFinite(NN.mix) ? NN.mix : 1
  const CPUCT = NN && Number.isFinite(NN.cpuct) ? NN.cpuct : 1.5
  const NN_PAR = NN && Number.isFinite(NN.parallel) ? Math.max(1, NN.parallel | 0) : 1
  const FPU = NN && Number.isFinite(NN.fpu) ? NN.fpu : 0.1
  // nn.maxDepth: the net only at B nodes within this many of OUR turns of the
  // search's start (deeper: heuristic order, UCB1 and the playout, as without
  // a net) — an in-process net costs ~a model call per eval, so it is spent
  // where the tree is wide and shallow.
  const NN_DEPTH = NN && Number.isFinite(NN.maxDepth) ? NN.maxDepth : Infinity
  // setRoot({ nnDepth }) overrides it for the searches from that root until
  // the next setRoot or commit: -1 = no net at all (playouts only). A cheat's
  // SECOND-STONE root (go-solver req.secondNet false) is searched without the
  // net: there the net's depth-1 values misread positions the single's reused
  // tree had valued by playout (go.js SETTINGS.cheat.secondNet).
  let nnDepth = NN_DEPTH
  // nn.lateCap K (see nnEvalNode, THE LATE PRIOR): -1 / absent = off.
  const LATE_CAP = NN && Number.isFinite(NN.lateCap) && NN.lateCap >= 0 ? NN.lateCap : -1
  let lateCaps = 0
  // A node's statistics scaled by f (means kept): visits and work rounded down.
  const scaleStats = (n, f) => {
    const v = n.visits
    n.visits = Math.floor(v * f)
    const g = v > 0 ? n.visits / v : 0
    n.sum *= g
    n.wins *= g
    n.work = Math.floor(n.work * f)
  }
  // A B node searched without the net that the net will now reach: capped
  // to LATE_CAP visits over its children (see nnEvalNode).
  const capStale = (n) => {
    if (LATE_CAP < 0 || !n || n.kind !== 0 || n.prior || n.terminal || !n.children.size) return
    let tot = 0
    for (const c of n.children.values()) tot += c.visits
    if (tot <= LATE_CAP) return
    const f = LATE_CAP / tot
    for (const c of n.children.values()) scaleStats(c, f)
    scaleStats(n, f)
    lateCaps++
  }
  // nn.priorFloor (see priorOf): 0 = the net's prior as it is.
  const PRIOR_FLOOR = NN && Number.isFinite(NN.priorFloor) ? Math.min(1, Math.max(0, NN.priorFloor)) : 0
  // nn.priorFloorRoot: the floor only at DECISION nodes — the search's root,
  // and under a ponder the AI's replies (their answers are pre-sent).
  const PRIOR_FLOOR_ROOT = !!(NN && NN.priorFloorRoot)
  // nn.priorFloorBelow W: the floor only at a node whose lines win under W
  // so far (wins / visits) — a position the net's search already calls lost.
  const PRIOR_FLOOR_BELOW = NN && Number.isFinite(NN.priorFloorBelow) ? NN.priorFloorBelow : Infinity
  // nn.steer: a playout leaf below a node the net valued with an outcome head
  // (turnsLeft) is charged the time the net predicted is left there, less the
  // turns already played since — so the power objective's time cost reaches
  // every leaf, not only the net's own nodes (whose values already carry it).
  const NN_STEER = !!(NN && NN.steer)
  const turnsLeftFrom = (node) => {
    for (let a = node.parent; a; a = a.parent) if (a.kind === 0 && a.nn && Number.isFinite(a.nn.turnsLeft)) return Math.max(0, a.nn.turnsLeft - (node.ply - a.ply))
    return null
  }
  // THE CHEAT AS A JOINT ACTION (opts.pairs, setCheat): where a playTwoMoves
  // cheat will be available (the caller knows from the roll's clock), a B node
  // also offers PAIRS of stones — the first among the top `pairs[0]` singles
  // by the heuristic, the second among the top `pairs[1]` after it — searched
  // like any action, so the first stone is chosen knowing a second follows.
  // A pair is charged `cheatCostPly` turns of time (go-cheat.js's exec and a
  // round trip, in turns). Pair action ids are >= N*N.
  const PAIRS = Array.isArray(opts.pairs) ? opts.pairs : null
  // opts.pairsOnly: where a cheat is available, offer ONLY pairs (and PASS) —
  // the search picks the best pair instead of weighing pairs against singles
  // on thin subtrees (a cheat is worth playing whenever its window is open).
  const PAIRS_ONLY = !!opts.pairsOnly
  // opts.pairSecond 'game': the game's second-stone rule (secondOk: empty
  // before, no suicide after the first). Default (anything else): the
  // valid-list rule — legal alone on the board before, in the game's valid
  // list there, no superko repeat. MEASURED 2026-10-09 (go-w0
  // --cheat-pair-second / --cheat-second-rule, Illuminati live config, crime
  // 3.3332): the game's rule does not pay (see go.js SETTINGS.cheat.secondRule).
  const PAIR_SECOND_VALID = opts.pairSecond !== 'game'
  // No legal pair (e.g. one stone left that is not an eye fill): the singles
  // STAY — pairsOnly with no pairs left PASS alone, and setRoot's 'PASS only'
  // answered a pass in 50ms on a won board (the 2026-10-07 07:39Z loss).
  const mergePairs = (untried, pairs) => (!pairs.length ? untried : PAIRS_ONLY ? [...pairs, ...untried.filter((a) => a.idx === PASS)] : [...untried.slice(0, 3), ...pairs, ...untried.slice(3)])
  const CHEAT_COST_PLY = Number.isFinite(opts.cheatCostPly) ? opts.cheatCostPly : 0.22
  const NSQ = N * N
  const isPair = (idx) => idx >= NSQ
  const pairOf = (idx) => [((idx - NSQ) / NSQ) | 0, (idx - NSQ) % NSQ]
  const pairId = (i1, i2) => NSQ + i1 * NSQ + i2
  // cheatAt: [fn(cheatsSoFar) -> bool] indexed by B-node depth below the anchor ply.
  let cheatFns = null
  let cheatAnchor = 0
  let rootValid = null
  let rootCheats = 0
  const cheatOk = (node) => {
    if (!PAIRS || !cheatFns || node.passCount !== 0) return false
    const f = cheatFns[node.ply - cheatAnchor]
    return typeof f === 'function' && !!f(node.cheats ?? 0)
  }
  // THE GAME'S PAIR RULE (NetscriptFunctions/Go.ts:163-182 playTwoMoves):
  // each point is validated on the board BEFORE either stone with
  // { repeat: false, suicide: false } — ONLY that it is empty and online.
  // Neither suicide nor superko is checked for a cheat's stones; both are set
  // at once and then captures resolve (netscriptGoImplementation.ts:599-629,
  // determineCheatSuccess -> updateCaptures: the enemy's zero-liberty chains,
  // else our own). So a SECOND stone that is a suicide on the board before
  // the cheat is legal whenever it is not one after the first stone: 2,1+1,0
  // takes a two-liberty group whose last point is a suicide alone (the
  // 2026-10-09 22:10:40Z Illuminati loss, ply 6: go.js offered only the
  // game's valid list, so the cheat had no second stone and the race was
  // lost by a tempo). The first stone stays a legal single (legalAlone):
  // sequential play from a legal first stone is the game's simultaneous
  // placement (a capture by the first stone frees no point for the second —
  // that point was not empty BEFORE — and gives no other enemy chain a
  // liberty). A point emptied only by the first stone's capture is NOT a
  // legal second stone (not empty before): `secondOk` takes the pre-board.
  // The 2026-10-07 05:25Z wipe (1,4+0,1, 0,1 a suicide until 1,4 captured)
  // was go.js dropping the pair on its own valid list, not the game.
  const secondOk = (b0, b1, i, valid = null) => {
    if (b0[i] !== EMPTY || b1[i] !== EMPTY) return false
    if (PAIR_SECOND_VALID && (!legalAlone(b0, i) || !inValid(valid, i))) return false
    const t = b1.slice()
    return play(t, nbrs, i, US, scratch) >= 0
  }
  const legalAlone = (b, i) => {
    if (b[i] !== EMPTY) return false
    const t = b.slice()
    return play(t, nbrs, i, US, scratch) >= 0
  }
  // valid: the game's own valid list where we have it (the root: superko
  // against the real history lives there) — BOTH stones must be in it.
  const inValid = (valid, i) => !valid || !!(valid[(i / N) | 0] && valid[(i / N) | 0][i % N])
  const pairActions = (b, singles, valid = null) => {
    const out = []
    const firsts = singles.filter((a) => a.idx !== PASS && legalAlone(b, a.idx) && inValid(valid, a.idx)).slice(0, PAIRS[0])
    for (const { idx: i1, h: h1 } of firsts) {
      const b1 = b.slice()
      if (play(b1, nbrs, i1, US, scratch) < 0) continue
      const sec = []
      for (let i = 0; i < NSQ; i++) {
        if (i === i1 || !secondOk(b, b1, i, valid) || isFill(b1, i)) continue
        const h = heuristic(b1, nbrs, i, scratch, US)
        if (h > -1e9) sec.push({ i, h })
      }
      sec.sort((a, z) => z.h - a.h)
      for (const { i: i2, h: h2 } of sec.slice(0, PAIRS[1])) out.push({ idx: pairId(i1, i2), h: h1 + h2 })
    }
    return out.sort((a, z) => z.h - a.h)
  }
  // Give a B node its pairs (or take them away) to match cheatOk now.
  const syncPairs = (node) => {
    if (!PAIRS || !node || node.kind !== 0 || node.terminal) return
    const want = cheatOk(node)
    const has = (node.untried ?? []).some((a) => isPair(a.idx)) || [...node.children.keys()].some(isPair)
    if (want && !has) {
      const singles = (node.untried ?? []).filter((a) => !isPair(a.idx) && a.idx !== PASS)
      const known = [...node.children.keys()].filter((k) => !isPair(k) && k !== PASS).map((k) => ({ idx: k, h: heuristic(node.b, nbrs, k, scratch, US) }))
      const pool = [...singles, ...known].sort((a, z) => z.h - a.h)
      const pairs = pairActions(node.b, pool, node === rootNode ? rootValid : null)
      node.untried = mergePairs(node.untried ?? [], pairs)
      if (PAIRS_ONLY && pairs.length) for (const k of [...node.children.keys()]) if (k !== PASS && !isPair(k)) {
        const c = node.children.get(k)
        node.visits -= c.visits
        node.work -= c.work
        node.sum -= c.sum
        node.wins -= c.wins
        node.children.delete(k)
      }
    } else if (!want && has) {
      node.untried = (node.untried ?? []).filter((a) => !isPair(a.idx))
      // pairsOnly took the singles away: give them back (not already expanded).
      if (PAIRS_ONLY && !node.untried.some((a) => a.idx !== PASS) && ![...node.children.keys()].some((k) => k !== PASS && !isPair(k))) {
        const done = new Set(node.children.keys())
        node.untried = actions(node.b, node === rootNode ? rootValid : null, node.passCount).filter((a) => !done.has(a.idx))
      }
      for (const k of [...node.children.keys()]) if (isPair(k)) {
        const c = node.children.get(k)
        node.visits -= c.visits
        node.work -= c.work
        node.sum -= c.sum
        node.wins -= c.wins
        node.children.delete(k)
      }
    }
    guardSingles(node, 'syncPairs')
  }
  // THE PASS-ONLY GUARD (an invariant, not a heuristic): a pair filter must
  // never leave a B node with PASS as its only action while the plain search
  // has stones there. Any path that empties a node of stones (pairsOnly with
  // no legal pair, the reused root's valid filter dropping every pair) gets
  // the singles back here, and it is COUNTED (jointGuard) — a nonzero count
  // is a bug to find, published by go-solver, never a silent repair.
  const jointGuard = { hits: 0, last: null }
  const guardSingles = (node, why) => {
    if (!PAIRS || !node || node.kind !== 0 || node.terminal) return
    const has = (node.untried ?? []).some((a) => a.idx !== PASS) || [...node.children.keys()].some((k) => k !== PASS)
    if (has) return
    const done = new Set(node.children.keys())
    const singles = actions(node.b, node === rootNode ? rootValid : null, node.passCount).filter((a) => a.idx !== PASS && !done.has(a.idx))
    if (!singles.length) return
    node.untried = [...singles, ...(node.untried ?? []).filter((a) => !singles.some((x) => x.idx === a.idx))]
    jointGuard.hits++
    jointGuard.last = { why, s: node.s, root: node === rootNode }
  }
  let rootHistory = []
  let points = 0
  // opts.seed: a fixed search stream (the regression corpus replays decisions deterministically).
  let seed = (Number.isFinite(opts.seed) ? opts.seed || 1 : Date.now() ^ 0x5bd1e995) >>> 0
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
  // THE OBJECTIVE. Default (release 2): 0.9 won + 0.1 area share. With
  // opts.objective / setRoot({objective}) = powerObjective(...): the node
  // power the game banks, minus the time it takes (turnCost per ply from the
  // game's start — a uniform shift across siblings, so tree reuse stays
  // consistent), scaled to ~[0, 1] for the UCB constant.
  let obj = opts.objective && opts.objective.kind === 'power' ? opts.objective : null
  // `lastWon`: the won/lost flag of the value just computed (pass decisions
  // under the power objective read the PASS line's win rate, not its value).
  let lastWon = 0
  const val = (won, us, ply) => {
    lastWon = won
    if (!obj) return (1 - areaW) * won + areaW * (us / points)
    const P = us * obj.diff * (won ? obj.winMult : obj.lossMult) - (won ? 0 : obj.lossFuture) - obj.turnCost * ply
    return (P + obj.lossFuture) / (obj.diff * obj.winMult * points + obj.lossFuture)
  }
  // A playout leaf is charged its tree ply plus leafK turns per empty point
  // left (the game's remaining length, crudely); terminals are exact.
  const leafPly = (b, ply) => {
    if (!obj || !obj.leafK) return ply
    let e = 0
    for (let i = 0; i < N * N; i++) if (b[i] === EMPTY) e++
    return ply + obj.leafK * e
  }
  // The net's value of a B node, on the objective's scale: the expected
  // value over its win probability (won is fractional; lastWon carries it).
  const nnVal = (e, b, ply) => {
    const W = Math.min(1, Math.max(0, e.winB))
    // An outcome-trained net (smallnet's vo/area/turns heads: real games
    // against the game's AIs under OUR policy) names black's final area and
    // the game's remaining length directly; KataGo's ownership and the leafK
    // guess are the fallback.
    const us = Number.isFinite(e.areaOut) ? e.areaOut : e.areaB
    lastWon = W
    if (!obj) return (1 - areaW) * W + areaW * (us / points)
    const lp = Number.isFinite(e.turnsLeft) ? ply + e.turnsLeft : leafPly(b, ply)
    const P = W * (us * obj.diff * obj.winMult) + (1 - W) * (us * obj.diff * obj.lossMult - obj.lossFuture) - obj.turnCost * lp
    return (P + obj.lossFuture) / (obj.diff * obj.winMult * points + obj.lossFuture)
  }
  // Evaluate a B node with the net once (concurrent askers share the promise):
  // its prior over its actions (normalised over them) and its value.
  const nnEvalNode = (node) => {
    if (!node.nnP) {
      // ctx: where the node sits — our turns below the search's root, and its
      // cheats so far (the provider maps them to a cheat outlook for nets that take one).
      const anchor = rootNode ?? ponderNode
      node.nnP = Promise.resolve(NN.eval(toSimple(node.s), komi, { depth: anchor ? node.ply - anchor.ply : 0, cheats: node.cheats ?? 0 })).then((e) => {
        node.nn = e
        // The prior is read off the net per action (priorOf) — actions the
        // cheat's pairs add or take away later (setCheat) get theirs then —
        // normalised over the actions the node had when the net answered (as
        // measured: b4c32 depth 1, +7.6% on Tetrads).
        node.priorZ = 1
        node.priorN = 0
        let z = 0
        if (node.untried) for (const a of node.untried) z += priorOf(node, a.idx)
        // THE LATE PRIOR (nn.lateCap K): a node that was SEARCHED before the
        // net reached it — grown beyond nn.maxDepth under an earlier root or
        // ponder, and now within it (a reply of a later ponder, a reused
        // root) — keeps its children's subtrees, but their visit counts are
        // scaled so they total at most K (means kept; K 0 drops them), and its
        // prior is normalised over every action as on a fresh node. Without
        // it the playout-only statistics outvote the net: the 2026-10-09
        // 20:52:10Z Daedalus loss pre-sent 4,3 at ply 2 (from ply 3 every line
        // loses), which a fresh search with the net never picks (0/96 replays)
        // — the node had ~1000 work of playout-only visits from the ponder a
        // move earlier, and the answer was published at once.
        // MEASURED NEUTRAL as a default (go-solver --late-cap-on, 2160 paired
        // Daedalus games: K 0 -0.5%, K 16 +0.2%, more losses in both): off.
        const late = LATE_CAP >= 0 && node.children.size > 0
        if (late) {
          for (const idx of node.children.keys()) z += priorOf(node, idx)
          capStale(node)
        }
        node.priorZ = z > 0 ? z : 1
        node.priorN = (node.untried ? node.untried.length : 0) + (late ? node.children.size : 0)
        node.prior = true
        return e
      })
    }
    return node.nnP
  }
  // A net's prior for one action: a stone its policy, PASS its pass share, a
  // cheat PAIR (i1, i2) the policy of i1 times i2's share of the rest (the
  // net never saw pairs; without this a pair's prior was 0 and PUCT never
  // tried one — the joint cheat off whenever the net was on, GC5).
  const priorOf = (node, idx) => {
    const e = node.nn
    if (!e) return 0
    const z = node.priorZ || 1
    let p
    if (idx === PASS) p = e.pass / z
    else if (isPair(idx)) {
      const [i1, i2] = pairOf(idx)
      const p1 = e.policy[i1] || 0
      p = (p1 * (e.policy[i2] || 0)) / Math.max(1e-6, 1 - p1) / z
    } else p = (e.policy[idx] || 0) / z
    // nn.priorFloor eps: a share eps of the prior spread evenly over the
    // node's actions, so a stone the policy all but rules out is still tried
    // within the budget. The 2026-10-09 14:56:31Z Daedalus loss: b4c32 gave
    // the only winning stones 4,2 / 0,1 a prior < 0.003 and the losing 2,1
    // 0.64 (valued 0.95 a ply later); PUCT never tried 4,2 at 800 work.
    // MEASURED NEGATIVE as a default (go-solver --prior-floor-on): off.
    if (PRIOR_FLOOR > 0 && node.priorN > 0 && !isPair(idx) && (!PRIOR_FLOOR_ROOT || node === rootNode || (!!ponderNode && node.parent === ponderNode)) && (PRIOR_FLOOR_BELOW === Infinity || (node.visits > 0 && node.wins / node.visits < PRIOR_FLOOR_BELOW))) p = (1 - PRIOR_FLOOR) * p + PRIOR_FLOOR / node.priorN
    return p
  }
  const valueNow = (b, ply = 0) => {
    const m = scoreBoard(b, nbrs, N, komi, scratch)
    return val(m > 0 ? 1 : 0, scratch.us, ply)
  }
  // THE AI'S SEED (clockSeed): null = free seeds, as release 2.
  let clock = null
  const rngFor = (w) => (clock ? clockSeed(clock, w.ply - clock.ply, rand) : 1 + Math.floor(rand() * 3e7))

  // Black's candidate actions at a node: stones (not own-eye fills, not
  // self-atari unless capturing — the same gate tryPlay applies) best-first by
  // the static heuristic, then PASS. The root uses the game's own valid list.
  //
  // OWN-EYE FILLS ARE THE LAST RESORT, NOT NOTHING. When every other point is
  // an own eye (or suicide), the fills are offered: one is a free move that
  // keeps the game going — a KO THREAT. Live 2026-10-06 02:45 Tetrads: white
  // had just taken a ko (black's recapture barred by superko) and black's only
  // non-fill points were suicides, so the search saw PASS alone, passed, the
  // AI passed back and a won game ended 9-14.5 — one eye fill, then the
  // recapture, would have put white's whole group in atari. (`fill` marks
  // them: a fill is never played into a line that cannot win, bestOf.)
  const isFill = (b, i) => {
    const ns = nbrs[i]
    if (!ns.length) return false
    for (let j = 0; j < ns.length; j++) if (b[ns[j]] !== US && b[ns[j]] !== DEAD) return false
    return true
  }
  const actions = (b, valid, passCount = 0) => {
    const out = []
    const fills = []
    for (let i = 0; i < N * N; i++) {
      if (b[i] !== EMPTY) continue
      if (valid) {
        const x = (i / N) | 0
        if (!valid[x] || !valid[x][i % N]) continue
      }
      if (isFill(b, i)) {
        fills.push(i)
        continue
      }
      const h = heuristic(b, nbrs, i, scratch, US)
      if (h <= -1e9) continue
      out.push({ idx: i, h })
    }
    // Only while black is BEHIND on the board as it stands: ahead, a pass is
    // already right (it wins if the AI passes back) and costs no search — a
    // won game's last turns are all fills, and they stay instant.
    if (!out.length && fills.length && scoreBoard(b, nbrs, N, komi, scratch) <= 0) {
      for (const i of fills) {
        const h = heuristic(b, nbrs, i, scratch, US)
        if (h > -1e9) out.push({ idx: i, h })
      }
    }
    out.sort((a, z) => z.h - a.h)
    // opts.passFirst: after the AI's pass our PASS ends the game — an exact
    // terminal; expand it first so the tree sees every early end it can reach
    // (last, it waits behind every stone: deep nodes rarely get there).
    // MEASURED NEUTRAL 2026-10-06 (go-w0, Tetrads 5x5 live config, 60 paired
    // games: power/h -0.7% [-6.4, +6.2], points per AI turn +0.1%): off.
    if (PASS_FIRST && passCount >= 1) out.unshift({ idx: PASS, h: -1e6 })
    else out.push({ idx: PASS, h: -1e6 })
    return out
  }

  // ply: our turns since the game's start (B nodes: before our move; W nodes:
  // the B parent's). The objective's time charge and the clock's tick
  // distance both read it.
  const mkB = (b, parent, passCount, valid, ply) => {
    const node = { kind: 0, b, s: toStr(b), parent, passCount, ply, cost: parent?.cost ?? 0, cheats: parent?.cheats ?? rootCheats, visits: 0, vl: 0, work: 0, sum: 0, wins: 0, children: new Map(), untried: null, terminal: passCount >= 2, tv: 0, tw: 0, prior: null, nn: null, nnP: null }
    if (node.terminal) {
      node.tv = valueNow(b, ply + node.cost)
      node.tw = lastWon
    } else {
      node.untried = actions(b, valid, passCount)
      if (cheatOk(node)) {
        node.untried = mergePairs(node.untried, pairActions(b, node.untried, valid))
        guardSingles(node, 'mkB')
      }
    }
    return node
  }
  // hist: the board before this move enters the AI's previousBoards. Not for
  // a CHEAT: playTwoMoves records no board (netscriptGoImplementation.ts:
  // 504-542 sets the stones and resolves captures; only makeMove unshifts
  // previousBoards, boardState.ts:131) — neither a pair's board before it nor
  // a second-stone root's board after the first stone (setRoot cheatSecond),
  // which is never a game state. Recording it barred the AI, in the model,
  // from a ko retake the game allows (the 02:32:31Z case under the game's
  // second-stone rule: 4,4+0,0 retakes the ko and read 0.993; the AI retook).
  // A pair's board stays out only under opts.pairSecond 'game' (the live
  // search is unchanged: that rule measured not paid).
  const mkW = (b, parent, passCount, moved, pair = false) => {
    const node = { kind: 1, b, s: moved ? toStr(b) : parent.s, parent, passCount, moved, hist: moved && (PAIR_SECOND_VALID || !pair) && !parent.cheatRoot, ply: parent.ply, cost: (parent.cost ?? 0) + (pair ? CHEAT_COST_PLY : 0), cheats: (parent.cheats ?? 0) + (pair ? 1 : 0), visits: 0, vl: 0, work: 0, sum: 0, wins: 0, samples: new Map(), draws: 0, terminal: passCount >= 2, tv: 0, tw: 0 }
    if (node.terminal) {
      node.tv = valueNow(b, node.ply + 1 + node.cost)
      node.tw = lastWon
    }
    return node
  }
  // previousBoards for the AI at W node w: the board before every STONE move
  // on the path (passes add none, boardState.ts:146-158), most recent first,
  // then the game's own history at the root.
  const historyOf = (w) => {
    const h = []
    let n = w
    while (n.parent) {
      if (n.hist) h.push(n.parent.s)
      n = n.parent
    }
    return h.concat(rootHistory)
  }

  // Has board string `s` occurred on the path to `node` or before the root?
  const repeats = (s, node) => {
    for (let n = node; n; n = n.parent) if (n.s === s) return true
    return rootHistory.includes(s)
  }

  let rootNode = null
  let ponderNode = null
  let modelCalls = 0
  let lastIters = 0

  // opts.leaf === 'model': leaves are scored by playing the game out with
  // WHITE ON THE MODEL (the opponent as it will actually play) and black on
  // the light policy (lightMove), up to opts.leafDepth white moves, then the
  // ordinary light playout to the end. Costs one model call per white move.
  const LEAF_MODEL = opts.leaf === 'model'
  const LEAF_DEPTH = Number.isFinite(opts.leafDepth) ? opts.leafDepth : Infinity
  const work = new Uint8Array(N * N)
  const modelPlayout = async (node, lastWhite) => {
    work.set(node.b)
    const hist = historyOf(node.parent)
    hist.unshift(node.parent.s) // the board before white's reply
    if (lastWhite === PASS) hist.shift()
    let passes = node.passCount
    let last = lastWhite
    let whiteMoves = 0
    for (let turn = 0; turn < N * N * 2 && passes < 2; turn++) {
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
        return val(won, scratch.us, leafPly(work, node.ply + node.cost + whiteMoves))
      }
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
    return valueNow(work, node.ply + node.cost + whiteMoves)
  }

  // The AI model, with its inputs named on a throw (go-solver logs and dumps
  // it): a live TypeError "reading 'length'" inside the session could not be
  // reproduced offline, and the board and history decide which it is.
  const callModel = async (s, history, passCount, rng) => {
    try {
      return await model.reply(toSimple(s), { history, passCount, rng })
    } catch (err) {
      const bad = history.map((h, i) => (typeof h === 'string' && h.length === N * N ? null : `${i}:${h === undefined ? 'undefined' : typeof h === 'string' ? `len ${h.length}` : typeof h}`)).filter(Boolean)
      err.message = `${err.message} [model.reply board=${s} passCount=${passCount} rng=${rng} history ${history.length}${bad.length ? ` BAD ${bad.slice(0, 5).join(' ')}` : ' all ok'}]`
      throw err
    }
  }

  /** One iteration from `start` (a B or W node); returns false if nothing could be grown. */
  const iterate = async (start) => {
    let node = start
    const nnOk = (n) => n.ply - start.ply <= nnDepth
    const path = []
    // Virtual loss: every node on the path counts as in flight until the
    // backup (only read by the net's PUCT; vl is 0 between iterations).
    const push = (n) => {
      n.vl++
      path.push(n)
    }
    push(start)
    let v = null
    // WORK: an iteration that called the model. Iterations that only walk to
    // an already-scored terminal (a pass-pass line) are nearly free and can
    // run millions of times while pondering, so visits overstate how much a
    // reused subtree was searched; work does not.
    let worked = false
    let won = 0
    while (v === null) {
      if (node.terminal) {
        v = node.tv
        won = node.tw
        break
      }
      if (node.kind === 0) {
        if (NN && !node.prior && !node.terminal && nnOk(node)) await nnEvalNode(node)
        // PUCT on the net's prior: an untried stone competes with the
        // searched ones at the first-play urgency (the node's mean - FPU);
        // virtual loss (vl: iterations in flight below a child) spreads the
        // parallel iterations.
        let pick = -1
        if (node.prior) {
          const sq = Math.sqrt(node.visits + node.vl + 1)
          const fpu = (node.visits ? node.sum / node.visits : 0.5) - FPU
          // A PASS that ENDS THE GAME LOST (the AI passed; ours is the second)
          // is a known loss: every untried stone that is not an own-eye fill
          // is expanded before it is revisited. Else a net prior of ~0 on every stone left the losing
          // PASS absorbing a root's whole search — the 10:56:22Z case, ply 8:
          // 32000 visits on PASS, the winning capture 2,1 never expanded.
          const pn = node.children.get(PASS)
          const passLost = !!pn && pn.terminal && pn.tw === 0
          let bestU = -Infinity
          let bestChild = null
          for (const [idx, child] of node.children) {
            const n = child.visits + child.vl
            const q = n ? child.sum / n : fpu
            const u = q + CPUCT * priorOf(node, idx) * sq / (1 + n)
            if (u > bestU) { bestU = u; bestChild = child; pick = -1 }
          }
          // The untried action the net likes best (heuristic order breaks ties).
          let bestA = -1, bestP = -1, lostA = -1, lostP = -1
          for (let j = 0; j < node.untried.length; j++) {
            const ix = node.untried[j].idx
            const pj = priorOf(node, ix)
            if (pj > bestP) { bestP = pj; bestA = j }
            // Not an own-eye fill: a fill after the AI's pass only bleeds a
            // lost game's area (bestOf plays one only into a line that wins).
            if (passLost && pj > lostP && (isPair(ix) || !isFill(node.b, ix))) { lostP = pj; lostA = j }
          }
          if (lostA >= 0) { bestU = Infinity; pick = lostA }
          else if (bestA >= 0) {
            const u = fpu + CPUCT * bestP * sq
            if (u > bestU) { bestU = u; pick = bestA }
          }
          if (pick < 0) {
            if (!bestChild) { v = valueNow(node.b, node.ply); won = lastWon; break }
            node = bestChild
            push(node)
            continue
          }
        }
        if (node.untried.length) {
          const { idx } = pick > 0 ? node.untried.splice(pick, 1)[0] : node.untried.shift()
          const b = node.b.slice()
          let moved = false
          if (isPair(idx)) {
            const [i1, i2] = pairOf(idx)
            // The game checks neither suicide (on the board before) nor
            // superko for a cheat's stones: the second need only be empty
            // before and legal after the first (secondOk).
            if (node.b[i2] !== EMPTY) continue
            if (PAIR_SECOND_VALID && (!legalAlone(node.b, i2) || (node === rootNode && !inValid(rootValid, i2)))) continue
            if (b[i1] !== EMPTY || play(b, nbrs, i1, US, scratch) < 0) continue
            if (b[i2] !== EMPTY || play(b, nbrs, i2, US, scratch) < 0) continue
            if (PAIR_SECOND_VALID && repeats(toStr(b), node)) continue
            const w = mkW(b, node, 0, true, true)
            node.children.set(idx, w)
            node = w
            push(w)
            continue
          }
          if (idx !== PASS) {
            const cap = play(b, nbrs, idx, US, scratch)
            if (cap < 0) continue // suicide after all: drop it
            // SUPERKO IN THE TREE (the game's rule, evaluateIfMoveIsValid:
            // no board may repeat): a one-stone capture can be a ko
            // recapture. Unchecked, the tree believed black could retake a
            // ko at once and called the 02:45 loss won a move before it.
            if (cap === 1 && node.parent && repeats(toStr(b), node)) continue
            moved = true
          }
          // A second-stone root's PASS is NO SECOND STONE — the single, with
          // the AI to move — not a pass by black: the AI's pass after it is
          // the first of two, never the game's end (cheatPass).
          const w = mkW(b, node, moved ? 0 : node.cheatRoot ? node.passCount : node.passCount + 1, moved)
          node.children.set(idx, w)
          node = w
          push(w)
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
        if (!best) { v = valueNow(node.b, node.ply + node.cost); won = lastWon; break }
        node = best
        push(node)
        continue
      }
      // W node: draw a fresh reply while under the sample cap, else replay one.
      const cap = Math.min(SAMPLES, 1 + Math.floor(Math.log2(1 + node.visits)))
      // (A parallel search can find every draw still in flight: draw again.)
      if (node.draws < cap || !node.samples.size) {
        node.draws++
        modelCalls++
        worked = true
        const r = await callModel(node.s, historyOf(node), node.passCount, rngFor(node))
        const key = r ? r.x * N + r.y : PASS
        let e = node.samples.get(key)
        if (!e) {
          const b = node.b.slice()
          let ok = true
          if (key !== PASS) ok = play(b, nbrs, key, THEM, scratch) >= 0
          e = { n: 0, child: mkB(ok ? b : node.b.slice(), node, key !== PASS && ok ? 0 : node.passCount + 1, null, node.ply + 1) }
          node.samples.set(key, e)
          e.n++
          node = e.child
          push(node)
          if (node.terminal) {
            v = node.tv
            won = node.tw
          } else if (NN && nnOk(node)) {
            const e = await nnEvalNode(node)
            v = nnVal(e, node.b, node.ply + (node.cost ?? 0))
            won = lastWon
            if (NN_MIX < 1) {
              work.set(node.b)
              const w2 = playout(work, nbrs, N, komi, US, scratch, rand)
              v = NN_MIX * v + (1 - NN_MIX) * val(w2, scratch.us, leafPly(node.b, node.ply))
              won = NN_MIX * won + (1 - NN_MIX) * w2
            }
          } else if (LEAF_MODEL) {
            v = await modelPlayout(node, key)
            won = lastWon
          } else {
            work.set(node.b)
            won = playout(work, nbrs, N, komi, US, scratch, rand)
            const tl = NN_STEER ? turnsLeftFrom(node) : null
            v = val(won, scratch.us, tl !== null ? node.ply + node.cost + tl : leafPly(node.b, node.ply + node.cost))
          }
          break
        }
        e.n++
        node = e.child
        push(node)
        continue
      }
      let tot = 0
      for (const e of node.samples.values()) tot += e.n
      let pick = (rand() * tot) | 0
      let chosen = null
      for (const e of node.samples.values()) {
        if (pick < e.n) { chosen = e; break }
        pick -= e.n
      }
      if (!chosen) chosen = node.samples.values().next().value
      node = chosen.child
      push(node)
    }
    for (const n of path) {
      n.vl--
      n.visits++
      n.sum += v
      n.wins += won
      if (worked) n.work++
    }
    return true
  }

  const setClockFn = (clk) => {
    const anchor = rootNode ?? ponderNode
    clock = clk && clk.T > 0 && anchor ? { ...clk, ply: anchor.ply } : null
    if (!clock) return
    const ws = rootNode ? [...rootNode.children.values()] : [ponderNode]
    for (const w of ws) {
      if (!w || w.kind !== 1 || w.terminal) continue
      w.draws = 0
      for (const e of w.samples.values()) e.n = 0
    }
  }

  /**
   * The decision at a B node: the most-visited stone, or [] for PASS when
   * modelRootPasses says so; null when the node has no stone at all. The
   * first entry carries `top`: up to 3 candidates [x, y, value, visits, winRate]
   * (PASS as x = y = -1) for the per-game log.
   */
  const bestOf = (node, iters) => {
    let bestIdx = null
    let bestVisits = -1
    for (const [idx, child] of node.children) {
      if (idx === PASS) continue
      if (child.visits > bestVisits) { bestVisits = child.visits; bestIdx = idx }
    }
    const passNode = node.children.get(PASS)
    const meanOf = (c) => (c && c.visits ? c.sum / c.visits : null)
    const stone = bestIdx === null ? null : node.children.get(bestIdx)
    const passWin = obj && passNode && passNode.visits ? passNode.wins / passNode.visits : undefined
    const openNever = OPEN_PASS === 'never' && !!passNode && !passNode.terminal && !!stone && (isPair(bestIdx) || !isFill(node.b, bestIdx))
    // 'visits': an open PASS must also be the most-visited child (no "clearly
    // better" escape on a handful of visits).
    const openFew = OPEN_PASS === 'visits' && !!passNode && !passNode.terminal && !!stone && passNode.visits < bestVisits
    // A SECOND-STONE root (setRoot cheatSecond): PASS is "no second stone" —
    // the single alone, the cheat kept. It was a real pass here (the AI passed
    // back and the game ended lost on the board), so every second stone, a
    // fatal one included, outranked it: the 02:32:31Z own-eye fill, and under
    // the game's second-stone rule the 4,4+0,0 ko retake (0.001 against the
    // single's 0.998). Now it is THE DECLINE inside one search (go.js
    // SETTINGS.cheat.decline compared two searches' win rates, biased against
    // the 100ms one): no second stone when its line wins more than the
    // most-visited stone's by SECOND_PASS_MARGIN. A margin, not "the most
    // visited": an unused cheat is unpriced here, and on near-equal lines the
    // stone is the policy (the 10:56:22Z case: 4,4 at 0.98 against the single's
    // 1.00 — the single's line then passed into a net blind spot and lost).
    if (node.cheatRoot) {
      const passW = passNode?.visits ? passNode.wins / passNode.visits : null
      const stoneW = stone?.visits ? stone.wins / stone.visits : null
      if (passNode && (!stone || (passW !== null && passNode.visits >= SECOND_PASS_MIN && passW - (stoneW ?? 0) > SECOND_PASS_MARGIN))) return []
    } else if (passNode && !openNever && !openFew && modelRootPasses({ passMean: meanOf(passNode), passVisits: passNode.visits, stoneMean: stone ? meanOf(stone) : null, stoneVisits: bestVisits, passWin })) return []
    // NEVER RISK A WON GAME FOR AREA (release 3, the end-of-game rule): when
    // PASS ends the game WON (the AI passed; our pass is the second), a stone
    // is played only if its line also wins essentially always — the power
    // objective already prices a loss at the streak it resets, this makes the
    // floor explicit against a search that has not seen the losing reply.
    if (passNode && passNode.terminal && passNode.tw === 1 && stone && stone.visits && stone.wins / stone.visits < SAFE_CONTINUE) return []
    // An own-eye fill (offered only when nothing else is, see actions) is
    // played only into a line that wins more often than passing: as a ko
    // threat, never to bleed a lost game's eyes away.
    if (stone && !isPair(bestIdx) && isFill(node.b, bestIdx) && passNode && passNode.visits) {
      const fillWin = stone.visits ? stone.wins / stone.visits : 0
      if (!(fillWin > passNode.wins / passNode.visits)) return []
    }
    if (bestIdx === null) return null
    const ch = node.children.get(bestIdx)
    const r3 = (v) => (v === null ? null : Math.round(v * 1000) / 1000)
    const top = [...node.children.entries()]
      .filter(([, c]) => c.visits > 0)
      .sort((a, z) => z[1].visits - a[1].visits)
      .slice(0, 3)
      .map(([i, c]) => { const j = isPair(i) ? pairOf(i)[0] : i; return [j === PASS ? -1 : (j / N) | 0, j === PASS ? -1 : j % N, r3(meanOf(c)), c.visits, r3(c.wins / c.visits), ...(isPair(i) ? [pairOf(i)[1]] : [])] })
    if (isPair(bestIdx)) {
      const [i1, i2] = pairOf(bestIdx)
      return [{ x: (i1 / N) | 0, y: i1 % N, second: { x: (i2 / N) | 0, y: i2 % N }, idx: bestIdx, visits: bestVisits, iters, rootVisits: node.visits, modelCalls, value: ch.visits ? ch.sum / ch.visits : null, top }]
    }
    return [{ x: (bestIdx / N) | 0, y: bestIdx % N, idx: bestIdx, visits: bestVisits, iters, rootVisits: node.visits, modelCalls, value: ch.visits ? ch.sum / ch.visits : null, top }]
  }

  return {
    /**
     * The position to decide. Reuses the ponder tree when this board is one of
     * the replies drawn there. Returns null when PASS is black's only action.
     */
    setRoot(boardStrings, valid, { history = [], opponentPassed = false, ply = null, clock: clk = undefined, objective = undefined, cheat = undefined, nnDepth: nd = undefined, cheatSecond = false } = {}) {
      nnDepth = Number.isFinite(nd) ? nd : NN_DEPTH
      const b = parseBoard(boardStrings)
      rootValid = valid ?? null
      // A fresh root may be a new game (a new offline-node layout): recount.
      const countPoints = () => { points = 0; for (let i = 0; i < N * N; i++) if (b[i] !== DEAD) points++ }
      if (!points) countPoints()
      rootHistory = Array.isArray(history) ? history : []
      if (objective !== undefined) obj = objective && objective.kind === 'power' ? objective : null
      const s = toStr(b)
      const passCount = opponentPassed ? 1 : 0
      let reused = null
      if (ponderNode && !opts.noReuse) {
        for (const e of ponderNode.samples.values()) {
          if (e.child.s === s && e.child.passCount === passCount && !e.child.terminal) { reused = e.child; break }
        }
      }
      ponderNode = null
      if (reused) {
        reused.parent = null
        // Re-filter to the game's valid list (superko against the real history).
        const okOne = (idx) => valid && valid[(idx / N) | 0] && valid[(idx / N) | 0][idx % N]
        // A pair's second stone needs only to be empty (the game's pair rule, secondOk).
        const ok = (idx) => idx === PASS || (isPair(idx) ? okOne(pairOf(idx)[0]) && (PAIR_SECOND_VALID ? okOne(pairOf(idx)[1]) : reused.b[pairOf(idx)[1]] === EMPTY) : okOne(idx))
        for (const idx of [...reused.children.keys()]) if (!ok(idx)) {
          const c = reused.children.get(idx)
          reused.visits -= c.visits
          reused.work -= c.work
          reused.sum -= c.sum
          reused.wins -= c.wins
          reused.children.delete(idx)
        }
        reused.untried = reused.untried.filter((a) => ok(a.idx))
        // 'fresh': an open PASS is re-evaluated at the request (its stats were
        // gathered under the ponder's vaguer clock): dropped back to untried.
        const pn = OPEN_PASS === 'fresh' && reused.passCount === 0 ? reused.children.get(PASS) : null
        if (pn) {
          reused.visits -= pn.visits
          reused.work -= pn.work
          reused.sum -= pn.sum
          reused.wins -= pn.wins
          reused.children.delete(PASS)
          reused.untried.push({ idx: PASS, h: -1e6 })
        }
        rootNode = reused
        // THE LATE PRIOR: a reused root searched before the net reached it
        // answers nothing at once (a request answers a root already holding
        // the budget's work without searching).
        if (nnDepth >= 0) capStale(reused)
      } else {
        countPoints()
        rootNode = mkB(b, null, passCount, valid, Number.isFinite(ply) ? ply : Math.floor(rootHistory.length / 2))
      }
      // cheatSecond: this root is a cheat's board after its FIRST stone (a
      // second-stone request): no game state, so its board never enters the
      // AI's history (mkW hist); `history` is the game's, without it.
      rootNode.cheatRoot = !!cheatSecond
      if (clk !== undefined) setClockFn(clk)
      // cheat: { fns: [fn(k) -> bool, ...] by depth below this root, cheats: so far this game }
      if (cheat !== undefined) {
        cheatFns = cheat?.fns ?? null
        cheatAnchor = rootNode.ply
        rootCheats = cheat?.cheats ?? 0
        rootNode.cheats = rootCheats
        syncPairs(rootNode)
      }
      guardSingles(rootNode, 'setRoot')
      const stones = [...rootNode.children.keys()].filter((k) => k !== PASS).length + rootNode.untried.filter((a) => a.idx !== PASS).length
      if (!stones) return null
      return { reused: !!reused, visits: rootNode.visits, work: rootNode.work }
    },
    /**
     * The AI's seed distribution for its NEXT reply (clockSeed), anchored at
     * the current root (or, after commit, the ponder node). The chance nodes
     * that reply comes from were sampled under a vaguer clock (a ply further
     * off, or none): their draw counts are cleared so new draws, under this
     * clock, decide the weights — the subtrees found so far are kept.
     */
    setClock(clk) {
      setClockFn(clk)
    },
    /**
     * Where cheats will be available while pondering: fns by depth below the
     * ponder node's ply (fns[1] = the B nodes after the AI's reply). Existing
     * reply nodes are given (or lose) their pairs to match.
     */
    setCheat({ fns = null, cheats = 0 } = {}) {
      const anchor = ponderNode ?? rootNode
      if (!anchor) return
      cheatFns = fns
      cheatAnchor = anchor.ply
      rootCheats = cheats
      if (ponderNode) for (const e of ponderNode.samples.values()) syncPairs(e.child)
    },
    /** Grow the root's tree for maxms, stopping early once it holds untilVisits. */
    async search({ maxms, untilVisits = Infinity, untilWork = Infinity } = {}) {
      const deadline = Date.now() + maxms
      let iters = 0
      const go = () => (Date.now() < deadline && rootNode.visits < untilVisits && rootNode.work < untilWork) || iters < 1
      if (NN_PAR > 1) {
        // nn.parallel workers: their net queries are in flight together and
        // batch in the evaluator. The root is fixed for the whole search.
        const root = rootNode
        const worker = async () => {
          while (go()) {
            iters++
            await iterate(root)
          }
        }
        await Promise.all(Array.from({ length: NN_PAR }, worker))
      } else
        while (go()) {
          await iterate(rootNode)
          iters++
        }
      lastIters = iters
      return iters
    },
    best() {
      return bestOf(rootNode, lastIters)
    },
    /**
     * PRE-SENT ANSWERS (release 3): while pondering, our answer to each of the
     * AI's likely replies — the reply's B node, if it already holds `minWork`
     * model-calling iterations (what a reused root needs to answer at once),
     * most likely reply first. go.js plays one the moment the AI's reply
     * matches its board, with no request.
     *   [{ b: board string, pc: pass count, x, y | pass: true, n: draws, work, v }]
     */
    ponderAnswers({ minWork = 0, max = 4 } = {}) {
      if (!ponderNode) return []
      const out = []
      const es = [...ponderNode.samples.values()].sort((a, z) => z.n - a.n || z.child.visits - a.child.visits)
      for (const e of es) {
        const c = e.child
        if (c.terminal || c.work < minWork) continue
        const r = bestOf(c, 0)
        if (r === null) continue
        const top = r[0]
        // A PASS chosen among pairs is never pre-sent: the request decides it
        // (go-solver's pass guard checks it against the single search).
        if (!top && [...c.children.keys()].some(isPair)) continue
        if (!top && (OPEN_PASS === 'request' || OPEN_PASS === 'fresh') && c.passCount === 0) continue
        out.push({ b: c.s, pc: c.passCount, ...(top ? { x: top.x, y: top.y, ...(top.second ? { second: top.second } : {}) } : { pass: true }), n: e.n, work: c.work, v: top?.value ?? null, wr: top?.top?.[0]?.[4] ?? null, gap: top?.top?.[1] ? top.top[0][4] - top.top[1][4] : null })
        if (out.length >= max) break
      }
      return out
    },
    /** We played (x, y) (or passed: x null): keep its W node to ponder and reuse. */
    commit(x, y, second = null) {
      // The ponder under our move uses the session's own net depth again.
      nnDepth = NN_DEPTH
      const idx = x === null || x === undefined ? PASS : second ? pairId(x * N + y, second.x * N + second.y) : x * N + y
      let w = rootNode?.children.get(idx) ?? null
      // A move the root never expanded (a pre-sent answer played on a root
      // the solver only just set): expand it, so the ponder can start.
      if (!w && rootNode && !rootNode.terminal) {
        const b = rootNode.b.slice()
        const moved = idx !== PASS
        const placed = !moved || (isPair(idx) ? play(b, nbrs, pairOf(idx)[0], US, scratch) >= 0 && play(b, nbrs, pairOf(idx)[1], US, scratch) >= 0 : play(b, nbrs, idx, US, scratch) >= 0)
        if (placed) {
          w = mkW(b, rootNode, moved ? 0 : rootNode.cheatRoot ? rootNode.passCount : rootNode.passCount + 1, moved, isPair(idx))
          rootNode.children.set(idx, w)
          rootNode.untried = (rootNode.untried ?? []).filter((a) => a.idx !== idx)
        }
      }
      ponderNode = w && !w.terminal ? w : null
      if (ponderNode) {
        // THE LATE PRIOR: the AI's replies already drawn under this move are
        // decision nodes now (their answers are pre-sent): a reply searched
        // before the net reached it is capped before it can be published.
        if (nnDepth >= 1) for (const e of ponderNode.samples.values()) capStale(e.child)
        // The history at the W node is the root's plus the root board.
        if (ponderNode.hist) rootHistory = [rootNode.s, ...rootHistory]
        ponderNode.parent = null
        ponderNode.moved = false
        ponderNode.hist = false
      }
      rootNode = null
      return !!ponderNode
    },
    /** Search under the AI's reply for up to ms (a time slice; call again to continue). */
    /**
     * SEED STEERING (experimental, MEASURED WORSE — go-w0 --steer): the value, to us, of each of the AI's
     * candidate replies at the ponder node — each searched `ms` more from its
     * own B node (created if the ponder has not drawn it). replies: [{x, y} |
     * null (pass)]. Returns [{ key, mean, visits, wins }] in the same order, or
     * null with no ponder node. `scale` is the objective's normaliser (node
     * power per unit of value) — 0 without the power objective.
     */
    async steer(replies, ms) {
      if (!ponderNode) return null
      const out = []
      for (const r of replies) {
        const key = r ? r.x * N + r.y : PASS
        let e = ponderNode.samples.get(key)
        if (!e) {
          const b = ponderNode.b.slice()
          let ok = true
          if (key !== PASS) ok = play(b, nbrs, key, THEM, scratch) >= 0
          e = { n: 0, child: mkB(ok ? b : ponderNode.b.slice(), ponderNode, key !== PASS && ok ? 0 : ponderNode.passCount + 1, null, ponderNode.ply + 1) }
          ponderNode.samples.set(key, e)
        }
        const c = e.child
        if (!c.terminal) {
          const deadline = Date.now() + ms
          let it = 0
          while (Date.now() < deadline || it < 1) { await iterate(c); it++ }
        }
        out.push({ key, mean: c.terminal ? c.tv : c.visits ? c.sum / c.visits : null, visits: c.visits, wins: c.terminal ? c.tw : c.visits ? c.wins / c.visits : null })
      }
      return out
    },
    /**
     * THE ORACLE GUARD's view of the search: what the tree knows about our stone
     * (x, y) at a position — the root (setRoot done), or, before setRoot, the
     * ponder child the AI's reply produced (board strings + whether the AI
     * passed). { visits, wins, bestWins } (wins = the share of its lines won;
     * bestWins = the best such share over the node's stones searched at least
     * minVisits times), or null when the tree has no such node.
     */
    childStats(x, y, board = null, passed = false, minVisits = 20) {
      let node = rootNode
      if (board) {
        node = null
        const s = Array.isArray(board) ? board.join('') : board
        if (ponderNode) for (const e of ponderNode.samples.values()) if (e.child.s === s && e.child.passCount === (passed ? 1 : 0)) { node = e.child; break }
      }
      const c = node?.children?.get(x * N + y)
      if (!c) return null
      let bestWins = null
      for (const [idx, k] of node.children) if (idx !== PASS && k.visits >= minVisits && (bestWins === null || k.wins / k.visits > bestWins)) bestWins = k.wins / k.visits
      return { visits: c.visits, wins: c.visits ? c.wins / c.visits : null, bestWins }
    },
    /** Every searched child of the root: [{ x, y (-1 for PASS), visits, wins (share of lines won), mean }]. */
    rootStats() {
      if (!rootNode) return []
      return [...rootNode.children.entries()].map(([idx, c]) => ({ x: idx === PASS ? -1 : (idx / N) | 0, y: idx === PASS ? -1 : idx % N, visits: c.visits, wins: c.visits ? c.wins / c.visits : null, mean: c.visits ? c.sum / c.visits : null }))
    },
    get scale() {
      return obj ? obj.diff * obj.winMult * points + obj.lossFuture : 0
    },
    async ponder(ms, { work = null, until = null } = {}) {
      if (!ponderNode) return 0
      let iters = 0
      // work: grow by that many model-calling iterations instead of for ms
      // (the harness's machine-independent clock, go-w0 --work-rate).
      // until(workDone): an extra stop for the caller (the harness's NN-time budget).
      const node = ponderNode
      const w0 = node.work
      const deadline = Date.now() + ms
      const go = work !== null ? () => node.work < w0 + work && iters < 50 * work + 100 && !(until && until(node.work - w0)) : () => Date.now() < deadline && !(until && until(node.work - w0))
      const worker = async () => {
        while (go()) {
          iters++
          await iterate(node)
        }
      }
      await Promise.all(Array.from({ length: NN_PAR }, worker))
      return iters
    },
    /** The AI's replies drawn so far under our committed move: [{ b: board string, pc, n }] (the opening book publishes its answers for them). */
    ponderChildren() {
      if (!ponderNode) return []
      return [...ponderNode.samples.values()].filter((e) => !e.child.terminal).map((e) => ({ b: e.child.s, pc: e.child.passCount, n: e.n }))
    },
    get pondering() {
      return !!ponderNode
    },
    get rootVisits() {
      return rootNode ? rootNode.visits : 0
    },
    /** Nodes whose net prior came after they were searched (nn.lateCap on). */
    get lateCaps() {
      return lateCaps
    },
    /** THE PASS-ONLY GUARD's count and last hit (0 = the pair filters never emptied a node). */
    get jointGuard() {
      return { ...jointGuard }
    },
    get rootWork() {
      return rootNode ? rootNode.work : 0
    },
    /** The root's stone candidates, searched or not, as [x, y] (tests). */
    get rootMoves() {
      if (!rootNode) return []
      const idxs = [...rootNode.children.keys(), ...(rootNode.untried ?? []).map((a) => a.idx)].filter((i) => i !== PASS)
      return idxs.map((i) => [(i / N) | 0, i % N])
    },
  }
}

/**
 * The board strings after OUR stone at (x, y), captures resolved — or null if
 * the move is suicide. For choosing the second stone of a two-move cheat on the
 * position the first one leaves (go.js). ns.go.cheat.playTwoMoves checks only
 * that each point is EMPTY on the board before either is placed (Go.ts
 * playTwoMoves: validateMove with { repeat: false, suicide: false }), so the
 * caller keeps the second among the points empty before (go.js
 * pairSecondPoints), not the original valid set.
 */
// ---------------------------------------------------------------------------
// THE OPENING BOOK (tools/sim/go-book.mjs builds it, go-solver.mjs serves it).
// Positions are keyed up to the board's 8 symmetries: T_t(s)[x][y] =
// s[f_t(x, y)], and the key is the least T_t(s) as one string (column-major,
// as the game's simple board). An entry stores the move in the KEY's frame;
// on a board s with T_t(s) = key the move is f_t(x, y).
// ---------------------------------------------------------------------------

/** The 8 symmetries of an N x N board as maps (x, y) -> [a, b]. */
export function boardSymmetries(N) {
  const out = []
  for (let t = 0; t < 8; t++) {
    out.push((x, y) => {
      let a = x, b = y
      if (t & 1) { const z = a; a = b; b = z }
      if (t & 2) a = N - 1 - a
      if (t & 4) b = N - 1 - b
      return [a, b]
    })
  }
  return out
}

/** { key, t }: the canonical string of a board (strings, or one joined string) and the symmetry taking it there. */
export function canonicalBoard(board, N = Array.isArray(board) ? board.length : Math.round(Math.sqrt(board.length))) {
  const s = Array.isArray(board) ? board.join('') : board
  const syms = boardSymmetries(N)
  let key = null, best = 0
  for (let t = 0; t < 8; t++) {
    const f = syms[t]
    let r = ''
    for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) {
      const [a, b] = f(x, y)
      r += s[a * N + b]
    }
    if (key === null || r < key) { key = r; best = t }
  }
  return { key, t: best }
}

/** The key-frame coordinates of the board-frame move (x, y) under symmetry t (the inverse of f_t). */
export function toKeyFrame(N, t, x, y) {
  const f = boardSymmetries(N)[t]
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
    const [u, v] = f(a, b)
    if (u === x && v === y) return [a, b]
  }
  return null
}

/**
 * The book's move for this board, or null: book = { entries: { key: [x, y, wr, ...] } }.
 * Returned in the board's own frame; the caller still checks it against the game's valid list.
 */
export function bookMove(book, board, { passed = false } = {}) {
  // passed: the AI's last reply was a pass — those positions live in
  // book.passEntries (the pass-forcing book's play-on stones, go-oracle-book).
  const table = passed ? book?.passEntries : book?.entries
  if (!table) return null
  const N = Array.isArray(board) ? board.length : Math.round(Math.sqrt(board.length))
  const { key, t } = canonicalBoard(board, N)
  const e = table[key]
  if (!e) return null
  const f = boardSymmetries(N)[t]
  const [x, y] = f(e[0], e[1])
  // e[5]: the AI reply the entry's line expects ([x, y] key frame, or -1 for a
  // pass) — the pass-forcing book's, for seed steering (go-w0 --steer-book).
  const r = e[5] === undefined ? undefined : e[5] === -1 ? null : f(e[5][0], e[5][1])
  return { x, y, wr: e[2] ?? null, ...(r !== undefined ? { reply: r ? { x: r[0], y: r[1] } : null } : {}) }
}

/**
 * THE PASS-FORCING BOOK's candidates for this board (tools/sim/go-oracle-book.mjs):
 * [{ x, y, reply: {x, y} | null (the AI passes), v }] in the board's frame,
 * best value first, or []. Each was the move of a winning line found against
 * the AI at one game clock; it is playable only where the AI's reply predicted
 * from THIS game's clock is `reply` — the caller checks that.
 */
export function oracleCandidates(book, board, { passed = false } = {}) {
  const table = passed ? book?.oraclePass : book?.oracle
  if (!table) return []
  const N = Array.isArray(board) ? board.length : Math.round(Math.sqrt(board.length))
  const { key, t } = canonicalBoard(board, N)
  const list = table[key]
  if (!list) return []
  const f = boardSymmetries(N)[t]
  return list
    .map(([x, y, rx, ry, v, , x2, y2, rest]) => {
      const [bx, by] = f(x, y)
      const r = rx < 0 ? null : f(rx, ry)
      // [5]: the safety filter's win share (unused here); [6, 7]: a SECOND
      // stone — the line plays this step as a playTwoMoves cheat; [8]: the
      // rest of the line (oracleLineHolds).
      const s2 = Number.isInteger(x2) && x2 >= 0 ? f(x2, y2) : null
      const pt = (a, b) => (a < 0 ? null : (([u, w]) => ({ x: u, y: w }))(f(a, b)))
      const steps = Array.isArray(rest) ? rest.map(([mx, my, sx, sy, qx, qy]) => ({ ...pt(mx, my), second: pt(sx, sy), reply: pt(qx, qy) })) : null
      return { x: bx, y: by, reply: r ? { x: r[0], y: r[1] } : null, v, ...(s2 ? { second: { x: s2[0], y: s2[1] } } : {}), rest: steps }
    })
    .sort((a, z) => z.v - a.v)
}

/**
 * THE FULL-LINE CHECK for a pass-forcing candidate (live 2026-10-06 21:07Z: a
 * candidate whose NEXT step this game's clock does not give was played — the
 * candidates come from plans at other clocks — and the game left the line in
 * a position only good against the reply the line expected; a 0-28.5 wipe).
 * A candidate is playable only if its WHOLE line, to the AI's pass, is the one
 * this game's clock produces: the reply to our step j is predicted at seeds
 * T + 200 x (k + round(j x tt) + d) for every lag k in `lags` (weight >= 0.05)
 * and every d in -w..+w step w (w = 0 for j = 0, else 1 + j: the timing drift
 * a few turns out), and must be the line's reply every time. A cheat step
 * after the first needs `cheat(j, count)` to say its roll will succeed.
 *   reply(board, { history, passCount: 0, rng }) -> {x, y} | null
 * Returns { ok, mass (the j = 0 agreement over the lag weights), failAt }.
 */
export async function oracleLineHolds(cand, board, history, T, lags, reply, { tt = 5, cheat = null, cheats0 = 0 } = {}) {
  const N = board.length
  const steps = [{ x: cand.x, y: cand.y, second: cand.second ?? null, reply: cand.reply }, ...(cand.rest ?? [])]
  if (!Array.isArray(cand.rest)) return { ok: false, mass: 0, failAt: 'no line' }
  let b = board, hist = history, mass = 0, cheats = cheats0
  for (let j = 0; j < steps.length; j++) {
    const st = steps[j]
    if (j > 0 && st.second && !(cheat && cheat(j, cheats))) return { ok: false, mass, failAt: j }
    let after = applyMove(b, st.x, st.y)
    if (after && st.second) after = after[st.second.x][st.second.y] === '.' ? applyMove(after, st.second.x, st.second.y) : null
    if (!after) return { ok: false, mass, failAt: j }
    if (st.second) cheats++
    const want = st.reply ? `${st.reply.x},${st.reply.y}` : 'P'
    const h2 = [b.join(''), ...hist]
    const base = Math.round(j * tt)
    const w = j === 0 ? 0 : 1 + j
    let tot = 0, good = 0
    for (const [k, wt] of lags) {
      if (wt < 0.05) continue
      tot += wt
      let all = true
      for (const d of w ? [-w, 0, w] : [0]) {
        const r = await reply(after, { history: h2, passCount: 0, rng: T + 200 * (k + base + d) })
        if ((r ? `${r.x},${r.y}` : 'P') !== want) { all = false; break }
      }
      if (all) good += wt
    }
    const agree = tot > 0 ? good / tot : 0
    if (j === 0) mass = agree
    if (agree < (j === 0 ? 0 : 0.999)) return { ok: false, mass, failAt: j }
    if (!st.reply) return { ok: true, mass, failAt: null } // the AI passes: the line is home
    const nb = parseBoard(after)
    const ns = makeGeometry(N)
    play(nb, ns, st.reply.x * N + st.reply.y, THEM, makeScratch(N))
    hist = [after.join(''), ...h2]
    b = Array.from({ length: N }, (_, x) => Array.from({ length: N }, (_, y) => '.XO#'[nb[x * N + y]]).join(''))
  }
  return { ok: true, mass, failAt: null }
}

/**
 * WHAT A PLAYED CHEAT DID, read off the board the AI handed back. `before`:
 * the board before the cheat; `stones`: its two points; `reply`: the AI's
 * answer ({x, y}, or null for a pass); `after`: the board now.
 *   'played'  after = before + both stones (+ their captures) + the reply
 *             (+ ITS captures). The reply may capture one OR BOTH stones —
 *             a two-stone group in atari (2026-10-07 20:40Z / 22:34Z: 4,3+4,4
 *             taken by 4,2) is a played cheat, not a failed one.
 *   'failed'  after = before + the reply: determineCheatSuccess skipped our
 *             stones and passed our turn (netscriptGoImplementation.ts:518-531).
 *   'unknown' neither reconstruction matches (an unparsed reply, a board we
 *             cannot replay), or both do and `lastBefore` cannot tell them
 *             apart: never evidence either way.
 * When the reply captures BOTH stones (and they captured nothing), the two
 * readings give the SAME board. `lastBefore` — the game's move history head
 * (ns.go.getMoveHistory()[0], 0GB): the board just before the AI's stone,
 * pushed by its makeMove (boardState.ts:131) — holds our stones iff the cheat
 * placed them (a failed cheat's passTurn pushes no board, boardState.ts:146).
 * Pure.
 */
export function cheatOutcome(before, stones, reply, after, lastBefore = null) {
  const swap = (b) => b.map((c) => c.replace(/[XO]/g, (ch) => (ch === 'X' ? 'O' : 'X')))
  const white = (b, r) => {
    if (!b) return null
    if (!r) return b
    const w = applyMove(swap(b), r.x, r.y)
    return w ? swap(w) : null
  }
  let played = before
  for (const [x, y] of stones) played = played ? applyMove(played, x, y) : null
  const key = after.join('')
  const ifPlayed = white(played, reply)
  const ifFailed = white(before, reply)
  const p = !!ifPlayed && ifPlayed.join('') === key
  const f = !!ifFailed && ifFailed.join('') === key
  if (p && !f) return 'played'
  if (f && !p) return 'failed'
  if (p && f && reply && Array.isArray(lastBefore)) {
    const n = stones.filter(([x, y]) => lastBefore[x]?.[y] === 'X').length
    if (n === stones.length) return 'played'
    if (n === 0) return 'failed'
  }
  return 'unknown'
}

/**
 * Whether OUR stone at (x, y) on this board (black to move) does itself harm:
 * 'eye' — it fills our own eye (isOwnEye: the playouts' own test), 'atari' —
 * its group is left one liberty and it captured nothing (self-atari), or null.
 * The decline's structural test (go.js SETTINGS.cheat.declineHarm): the
 * 02:32:31Z cheat's second stone 3,1 was both. Pure.
 */
export function stoneHarm(boardStrings, x, y) {
  const N = boardStrings.length
  const b = parseBoard(boardStrings)
  const nbrs = makeGeometry(N)
  const idx = x * N + y
  if (b[idx] !== EMPTY) return null
  if (isOwnEye(b, nbrs, idx, US, N)) return 'eye'
  const sc = makeScratch(N)
  const captured = play(b, nbrs, idx, US, sc)
  if (captured < 0) return 'atari' // suicide: worse than atari
  if (captured > 0) return null
  return libsAtLeast(b, nbrs, idx, 2, sc.out, sc.seen, ++sc.mark) ? null : 'atari'
}

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
