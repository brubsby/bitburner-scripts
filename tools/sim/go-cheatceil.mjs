import { fileURLToPath } from "node:url";
// THE CHEAT-AWARE STRUCTURAL CEILING per board size: the fewest AI replies a
// game can take to end with the AI's pass and every playable point ours, when
// a turn may be ns.go.cheat.playTwoMoves (two black stones, ONE AI reply).
//
// go-passmin.mjs's ceiling assumed one black stone per AI reply. With cheats a
// game needs R replies where R + (cheats played in those R turns) >= S_min,
// the fewest black stones at which the AI passes. This file measures S_min on
// the boards the game actually DEALS (offline-node layouts, Illuminati's
// handicap routers — which must be captured for full area), and then prices
// the cheat schedule against the real roll.
//
// NOT CALIBRATED as a whole: no live game has been played to a structural
// pass. Its parts are: the AI is the game's own getMove (every set verified on
// --verify seeds), the reply-time model is go-turntime.mjs's (0.7% vs live),
// the cheat chance and roll are the game's (go-cheatroll-check.mjs).
//
//   node tools/sim/go-cheatceil.mjs search --size 7 --opponent Tetrads --layouts 0-31 [--layoutseed 1]
//        [--empty] [--seeds 12] [--verify 64] [--restarts 3] [--start prev.jsonl]
//        [--anneal ITERS:RESTARTS] [--swap M] [--exhaustive K] > layouts.jsonl
//   node tools/sim/go-cheatceil.mjs report FILE.jsonl[,FILE2...] [--json]
//   (report keeps the smallest VERIFIED set per layout across all files given)
//
// MEASURED 2026-10-06 (bubtop; docs/go-board-size-ceiling-2026-10-06.txt): the
// best ceiling is 5x5's at every crime_success / SF14.3 setting and opponent
// measured; 7x7 at crime 10 + SF14.3 reaches 81% of it (S_min 9.2, needs 6).
//
// SEARCH (per layout; the game's own getMove, sleeps intercepted and counted):
//   black stones are played with the game's makeMove (captures resolve), the
//   AI to move. A set QUALIFIES if the AI passes on every seed and the black
//   score (scoring.ts getScore) is the whole playable area. Start: the
//   smallest qualifying lattice (walls every 3rd/4th line, offsets 0-3) plus
//   every point next to a white router (or --start: a previous run's set);
//   then greedy single-stone removal in random orders (--restarts).
//   GREEDY IS NOT ENOUGH: on 7x7-13x13 it sat 25-40% above the annealer
//   (--anneal, below), which models the pass condition read from source and
//   matches the exhaustive minimum (--exhaustive K) on every 5x5 layout tried.
//   --swap M (2-for-1 / 1-for-1 moves checked by getMove) is the slow way to
//   the same sets. Every reported set is verified on --verify seeds.
//   Also recorded: the AI's reply cost (200 x waitCycles + 10 x pattern rows,
//   go-turntime.mjs's model, validated live to 0.7%) on random PREFIXES of
//   the final structure — the positions a structural game passes through —
//   and the cost of its final pass.
//
// REPORT (the cheat schedule, exact for the clock):
//   chance(k) = min(1, 0.6 (0.7 - 0.02k)^k crime + 0.25[SF14.3])
//               (netscriptGoImplementation.ts:561-567)
//   The roll is WHRNG(totalPlaytime): a sawtooth rising RATE = 0.01693/s,
//   period 59.06s (golib.cheatRoll). go-cheat.js plays a cheat only inside
//   the window roll <= chance(k), waiting at most 0.5s (a wrap) — so every
//   cheat succeeds and availability is a function of the game's start phase:
//   one roll, drifting through the game, not an independent draw per turn.
//   Integrated over the start phase (uniform; 2000 points): each turn, if the
//   window for cheat k is open (or opens within 0.5s, waited), two stones and
//   k+1; else one stone. Greedy is optimal (chance falls with k and the roll
//   rises with time, so a cheat never gains by waiting). maxPerGame 12. The
//   phase advances by the AI's reply time + the wait (our time 0: a ceiling).
//   An independent-draw model (availability = chance(k) each turn) is
//   reported beside it as the user's back-of-envelope used.
//
// The other cheats are not searched (argued, not measured): each costs a whole
// reply AND a cheat count (lower playTwoMoves odds after).
//   destroyNode    an offline point walls without the surround constraint a
//                  stone carries, but scores nothing; playTwoMoves at the same
//                  cheat count places two walls that score.
//   repairOfflineNode  +1 playable point for one reply: raises points per
//                  reply only below 1 point a reply (every board here: 4-11),
//                  and the point must still be enclosed.
//   removeRouter   no white router in a structural game except Illuminati's
//                  handicap, which the structure captures with stones that
//                  also score.
//
// power/h = 3600 x 3 (streak cap) x difficulty x area / AI-seconds, with
// AI-seconds = (R - 1) x reply + pass, from the measured reply costs.

import fs from "node:fs";
import path from "node:path";
const SIM = process.env.GO_SIM ?? path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const MODE = argv[0];
const str = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const num = (n, d) => Number(str(n, d));
const DIFF = { Tetrads: 1.5, Daedalus: 1.5, Netburners: 0.5, Illuminati: 2, TheBlackHand: 1, SlumSnakes: 1 };
const diffOf = (opp, n) => (opp === "Illuminati" && n === 5 ? 8 : DIFF[opp]);
const RATE = 171 / 30269 + 172 / 30307 + 170 / 30323;

if (MODE === "search") await search();
else if (MODE === "report") report();
else {
  console.error("usage: go-cheatceil.mjs search|report ...");
  process.exit(2);
}

async function search() {
  await import(path.join(SIM, "env.mjs"));
  const realSetTimeout = globalThis.setTimeout;
  let cycles = 0, rows = 0;
  globalThis.setTimeout = (fn, ms, ...r) => {
    if (ms === 40 || ms === 200) cycles++;
    if (ms === 10) rows++;
    return realSetTimeout(fn, 0, ...r);
  };
  const g = await import(path.join(SIM, "game.bundle.mjs"));
  const { dealPaired } = await import(path.join(SIM, "go-board.mjs"));
  const { GoColor, GoOpponent } = g;
  const N = num("size", 5);
  const OPPN = str("opponent", "Tetrads");
  const OPP = GoOpponent[OPPN];
  const SEEDS = num("seeds", 12);
  const VERIFY = num("verify", 64);
  const RESTARTS = num("restarts", 3);
  const LSEED = num("layoutseed", 1);
  const [a, b] = str("layouts", "0-7").split("-").map(Number);
  const EMPTY = argv.includes("--empty");
  const EXH = num("exhaustive", 0);
  // --start FILE: begin each layout from the set a previous run found (its grid).
  const START_SETS = new Map();
  if (str("start", null)) for (const l of fs.readFileSync(str("start", null), "utf8").trim().split("\n").filter(Boolean).map((x) => JSON.parse(x))) {
    if (l.size !== N || !l.grid) continue;
    const rowsG = l.grid.split("/");
    const set = new Set();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (rowsG[y][x] === "X") set.add(x * N + y);
    START_SETS.set(l.layout === "empty" ? 0 : l.layout, set);
  }
  let rnd = 7;
  const rand = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  // The base board: offline nodes + handicap routers as dealt, as a template.
  function baseOf(i) {
    if (EMPTY) {
      const st = g.getNewBoardState(N, OPP, false);
      return st.board.map((col) => col.map(() => ({ color: GoColor.empty })));
    }
    const st = dealPaired(g, N, OPP, LSEED, i);
    return st.board.map((col) => col.map((p) => (p ? { color: p.color } : null)));
  }
  // A position: the base, our stones played by makeMove (captures resolve),
  // the AI to move. order: the play order (enclosing stones before captures
  // is not needed: makeMove resolves each capture as it happens).
  function stateOf(base, black, order = null) {
    const copy = base.map((col) => col.map((p) => (p ? { color: p.color } : null)));
    const st = g.getNewBoardState(N, OPP, false, copy);
    st.previousPlayer = GoColor.white;
    for (const p of order ?? black) {
      if (!g.makeMove(st, Math.floor(p / N), p % N, GoColor.black)) return null;
      g.passTurn(st, GoColor.white, false);
    }
    // The last call left white to have passed: undo that bookkeeping so the
    // AI is to move after our last stone with no pass on record.
    st.previousPlayer = GoColor.black;
    st.passCount = 0;
    g.Go.currentGame = st;
    return st;
  }
  const areaOf = (base) => base.flat().filter((p) => p).length;
  async function qualifies(base, black, seeds, full) {
    let pc = 0;
    for (let s = 0; s < seeds; s++) {
      const st = stateOf(base, black);
      if (!st) return { ok: false };
      if (s === 0 && g.getScore(st)[GoColor.black].sum < full) return { ok: false, why: "area" };
      cycles = 0; rows = 0;
      const r = await g.getMove(st, GoColor.white, OPP, false, 1 + s * 104729);
      if (r.type === "move") return { ok: false };
      pc += cycles * 200 + rows * 10;
    }
    return { ok: true, passMs: pc / seeds };
  }

  for (let i = a; i <= b; i++) {
    const t0 = Date.now();
    const base = baseOf(i);
    const full = areaOf(base);
    const open = (p) => base[Math.floor(p / N)][p % N]?.color === GoColor.empty;
    const whiteAdj = new Set();
    for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) {
      if (base[x][y]?.color !== GoColor.white) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const u = x + dx, v = y + dy;
        if (u >= 0 && v >= 0 && u < N && v < N && base[u][v]?.color === GoColor.empty) whiteAdj.add(u * N + v);
      }
    }
    // Start lattices.
    let start = null;
    for (const per of [4, 3]) for (let o = 0; o < per; o++) {
      const s = new Set(whiteAdj);
      for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if ((x % per === o || y % per === o) && open(x * N + y)) s.add(x * N + y);
      if ((!start || s.size < start.size) && (await qualifies(base, [...s], SEEDS, full)).ok) start = s;
    }
    if (!start) {
      // Fallback: every open point but a checkerboard of holes.
      const s = new Set();
      for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if (open(x * N + y) && (x + y) % 2 === 0) s.add(x * N + y);
      for (const p of whiteAdj) s.add(p);
      if ((await qualifies(base, [...s], SEEDS, full)).ok) start = s;
    }
    if (!start) {
      console.log(JSON.stringify({ size: N, opponent: OPPN, layout: EMPTY ? "empty" : i, layoutSeed: LSEED, area: full, sMin: null, why: "no qualifying start" }));
      continue;
    }
    const sizes = [];
    let best = null;
    const prune = async (cur) => {
      let improved = true;
      while (improved) {
        improved = false;
        for (const p of [...cur].sort(() => rand() - 0.5)) {
          const t = new Set(cur);
          t.delete(p);
          if (t.size < 1) continue;
          if ((await qualifies(base, [...t], SEEDS, full)).ok) {
            cur = t;
            improved = true;
          }
        }
      }
      return cur;
    };
    for (let r = 0; r < RESTARTS; r++) {
      const cur = await prune(new Set(START_SETS.get(i) ?? start));
      sizes.push(cur.size);
      if (!best || cur.size < best.size) best = cur;
    }
    // --swap M: iterated local search from the best greedy set — M random
    // moves, each 2-for-1 (two stones out, one in next to them) or a 1-for-1
    // plateau move, kept when the set still qualifies, then pruned again.
    // Escapes the greedy's local minima (where no single stone can go).
    let swapsKept = 0;
    const SWAP = num("swap", 0);
    if (SWAP) {
      let cur = new Set(best);
      const nbr = (p) => [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].map(([dx, dy]) => [Math.floor(p / N) + dx, (p % N) + dy]).filter(([u, v]) => u >= 0 && v >= 0 && u < N && v < N).map(([u, v]) => u * N + v);
      for (let m = 0; m < SWAP; m++) {
        const arr = [...cur];
        const a = arr[Math.floor(rand() * arr.length)];
        const two = rand() < 0.5 && arr.length > 2;
        let b = two ? arr[Math.floor(rand() * arr.length)] : null;
        if (b === a) continue;
        const cand = [...nbr(a), ...(b !== null ? nbr(b) : [])].filter((q) => open(q) && !cur.has(q));
        if (!cand.length) continue;
        const c = cand[Math.floor(rand() * cand.length)];
        const t = new Set(cur);
        t.delete(a);
        if (b !== null) t.delete(b);
        t.add(c);
        if ((await qualifies(base, [...t], SEEDS, full)).ok) {
          cur = await prune(t);
          swapsKept++;
          if (cur.size < best.size) best = cur;
        }
      }
    }
    // --anneal ITERS[:RESTARTS]: THE PASS CONDITION, MODELLED. With no white
    // stone on the board, getMove (goAI.ts:176-218) passes iff every move
    // generator it consults comes back empty. Read from source:
    //   - available points = white's valid moves minus every point inside a
    //     black "potential eye": an empty 4-connected region of at most
    //     min(0.4 x playable nodes, 11) points touching black and no white
    //     (findDisputedTerritory, controlledTerritory.ts:24-82;
    //     getAllPotentialEyes, boardAnalysis.ts:282-314);
    //   - expansion: an available interior point whose 4 neighbours are all
    //     empty (getExpansionMoveArray, goAI.ts:512-536; the disputed fallback
    //     needs a white neighbour);
    //   - surround/atari/capture: an available liberty p of a black chain
    //     with L liberties (the weakest adjacent), white's new liberties e
    //     (empty neighbours of p): skipped iff e <= 2 and L > 2; else offered
    //     if L <= 1, or L == 2 and (e >= 2 or one liberty group and length
    //     > 3), or e >= 2 (getSurroundMove, goAI.ts:628-711);
    //   - corner: a 3x3 corner box with >= 7 live nodes and no stone
    //     (goAI.ts:443-481), via the Illuminati path every opponent can take;
    //   - growth/defend/eyeMove need white chains; every 3x3 pattern needs a
    //     white stone (patternMatching.ts:8-71): all empty here.
    //   - eyeBlock (black eye-creation moves, goAI.ts:769-783) is NOT
    //     modelled: the getMove verification below catches it.
    // Violation = offending points + uncovered corners; a set with none is
    // annealed down in size (microseconds per test), then VERIFIED with the
    // game's own getMove on --verify seeds like every other set here.
    let annealed = null;
    const ANNEAL = str("anneal", null);
    if (ANNEAL && !whiteAdj.size) {
      const [ITERS, AR] = ANNEAL.split(":").map(Number);
      const cells = [];
      for (let p = 0; p < N * N; p++) if (open(p)) cells.push(p);
      const nodes = base.flat().filter((p) => p).length;
      const maxSize = Math.min(nodes * 0.4, 11);
      const isOpen = new Uint8Array(N * N);
      for (const p of cells) isOpen[p] = 1;
      const nb = Array.from({ length: N * N }, (_, q) => {
        const x = Math.floor(q / N), y = q % N;
        return [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].filter(([u, w]) => u >= 0 && w >= 0 && u < N && w < N).map(([u, w]) => u * N + w);
      });
      // interior: all 4 neighbours on the board and live (an offline or
      // off-board neighbour can never be "empty").
      const interior = new Uint8Array(N * N);
      for (const p of cells) interior[p] = nb[p].length === 4 && nb[p].every((r) => isOpen[r]) ? 1 : 0;
      const stone = new Uint8Array(N * N);
      const E = N - 1, C = E - 2;
      const corners = [[C, C, E, E], [0, C, 2, E], [0, 0, 2, 2], [C, 0, E, 2]]
        .map(([x1, y1, x2, y2]) => {
          const live = [];
          for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) if (base[x][y]) live.push(x * N + y);
          return live;
        })
        .filter((live) => live.length >= 7);
      const reg = new Int32Array(N * N); // empty region id
      const regSize = new Int32Array(N * N + 1), regBlack = new Uint8Array(N * N + 1);
      const ch = new Int32Array(N * N); // black chain id
      const chLib = new Int32Array(N * N + 1), chLen = new Int32Array(N * N + 1), chGroups = new Int32Array(N * N + 1);
      const mark = new Int32Array(N * N);
      const stack = new Int32Array(N * N);
      let stamp = 0;
      const violation = () => {
        reg.fill(0);
        let nr = 0;
        for (const p of cells) {
          if (stone[p] || reg[p]) continue;
          nr++;
          let sz = 0, black = 0, sp = 0;
          stack[sp++] = p;
          reg[p] = nr;
          while (sp) {
            const q = stack[--sp];
            sz++;
            for (const r of nb[q]) {
              if (!isOpen[r]) continue;
              if (stone[r]) { black = 1; continue; }
              if (!reg[r]) { reg[r] = nr; stack[sp++] = r; }
            }
          }
          regSize[nr] = sz;
          regBlack[nr] = black;
        }
        ch.fill(0);
        let nc = 0;
        for (const p of cells) {
          if (!stone[p] || ch[p]) continue;
          nc++;
          stamp++;
          let len = 0, lib = 0, sp = 0;
          const groups = new Set();
          stack[sp++] = p;
          ch[p] = nc;
          while (sp) {
            const q = stack[--sp];
            len++;
            for (const r of nb[q]) {
              if (!isOpen[r]) continue;
              if (stone[r]) { if (!ch[r]) { ch[r] = nc; stack[sp++] = r; } }
              else if (mark[r] !== stamp) { mark[r] = stamp; lib++; groups.add(reg[r]); }
            }
          }
          chLen[nc] = len; chLib[nc] = lib; chGroups[nc] = groups.size;
        }
        let v = 0;
        for (const p of cells) {
          if (stone[p]) continue;
          const rid = reg[p];
          if (regSize[rid] <= maxSize && regBlack[rid]) continue; // inside a black potential eye
          let e = 0, wL = 99, wC = 0;
          for (const r of nb[p]) {
            if (!isOpen[r]) continue;
            if (stone[r]) { const c = ch[r]; if (chLib[c] < wL) { wL = chLib[c]; wC = c; } }
            else e++;
          }
          if (e === 0 && wL !== 1) continue; // suicide: not a valid move for white
          if (interior[p] && e === 4) { v++; continue; } // expansion
          if (wC) {
            if (e <= 2 && wL > 2) continue;
            if (wL <= 1 || (wL === 2 && (e >= 2 || (chGroups[wC] === 1 && chLen[wC] > 3))) || e >= 2) v++;
          }
        }
        for (const box of corners) if (!box.some((q) => stone[q])) v += 2;
        return v;
      };
      let bestA = null;
      for (let rr = 0; rr < (AR || 4); rr++) {
        stone.fill(0);
        for (const p of best) stone[p] = 1; // from the greedy set (feasible)
        let count = best.size, viol = violation();
        let cost = count + 3 * viol;
        for (let it = 0; it < ITERS; it++) {
          const T = 2 * Math.pow(0.02 / 2, it / ITERS);
          const p = cells[Math.floor(rand() * cells.length)];
          stone[p] ^= 1;
          const c2 = count + (stone[p] ? 1 : -1);
          const v2 = violation();
          const cost2 = c2 + 3 * v2;
          if (cost2 <= cost || rand() < Math.exp((cost - cost2) / T)) {
            count = c2; viol = v2; cost = cost2;
            if (!viol && (!bestA || count < bestA.size)) bestA = new Set(cells.filter((q) => stone[q]));
          } else stone[p] ^= 1;
        }
      }
      if (bestA && bestA.size < best.size) {
        const ok = await qualifies(base, [...bestA], VERIFY, full);
        annealed = { size: bestA.size, verified: ok.ok };
        if (!ok.ok) {
          // Say WHY the partition model was wrong here: the AI's reply and the score.
          const st = stateOf(base, [...bestA]);
          annealed.why = !st ? "illegal order" : { score: g.getScore(st)[GoColor.black].sum, full, reply: await g.getMove(st, GoColor.white, OPP, false, 1).then((r) => (r.type === "move" ? `${r.x},${r.y}` : r.type)) };
          annealed.grid = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (bestA.has(x * N + y) ? "X" : base[x][y] === null ? "#" : ".")).join("")).join("/");
        }
        if (ok.ok) best = bestA;
      } else annealed = { size: bestA ? bestA.size : null, verified: null };
    }
    // --exhaustive K: every set of up to K open points, smallest first — the
    // TRUE S_min whenever it is <= K (greedy can sit a stone or three above it).
    let exact = null;
    if (EXH) {
      const pts = [];
      for (let p = 0; p < N * N; p++) if (open(p)) pts.push(p);
      const combos = function* (k, from = 0, acc = []) {
        if (acc.length === k) { yield acc.slice(); return; }
        for (let j = from; j < pts.length; j++) { acc.push(pts[j]); yield* combos(k, j + 1, acc); acc.pop(); }
      };
      for (let k = 1; k <= Math.min(EXH, best.size - 1) && !exact; k++) {
        for (const c of combos(k)) {
          if ((await qualifies(base, c, SEEDS, full)).ok && (await qualifies(base, c, VERIFY, full)).ok) { exact = new Set(c); break; }
        }
      }
      if (exact) best = exact;
    }
    const v = await qualifies(base, [...best], VERIFY, full);
    // The AI's reply cost on the way: random prefixes of the final structure
    // (a random play order), 2 seeds each; +1 cycle when it answers with a
    // stone (handleNextTurn, goAI.ts:98), as go-turntime.mjs.
    const replyMs = [];
    const arr = [...best];
    for (let k = 0; k < 12; k++) {
      const ord = arr.slice().sort(() => rand() - 0.5);
      const m = 1 + Math.floor(rand() * Math.max(1, arr.length - 1));
      const st = stateOf(base, ord.slice(0, m));
      if (!st) continue;
      for (let s = 0; s < 2; s++) {
        const st2 = stateOf(base, ord.slice(0, m));
        cycles = 0; rows = 0;
        const r = await g.getMove(st2, GoColor.white, OPP, false, 7 + k * 7919 + s * 104729);
        replyMs.push(200 * (cycles + (r.type === "move" ? 1 : 0)) + 10 * rows);
      }
    }
    const grid = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (best.has(x * N + y) ? "X" : base[x][y] === null ? "#" : base[x][y].color === GoColor.white ? "O" : ".")).join("")).join("/");
    console.log(JSON.stringify({ size: N, opponent: OPPN, layout: EMPTY ? "empty" : i, layoutSeed: LSEED, area: full, handicap: whiteAdj.size ? base.flat().filter((p) => p?.color === GoColor.white).length : 0, sMin: best.size, sMinSpread: sizes, anneal: annealed, swap: SWAP ? { tries: SWAP, kept: swapsKept } : null, exhaustive: EXH ? { upTo: Math.min(EXH, Math.min(...sizes) - 1), found: !!exact } : null, verified: v.ok, verifySeeds: VERIFY, passMs: v.passMs ?? null, replyMs: replyMs.reduce((s, x) => s + x, 0) / Math.max(1, replyMs.length), replyN: replyMs.length, grid, sec: Math.round((Date.now() - t0) / 1000) }));
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
function chance(k, crime, sf) {
  return Math.max(0, Math.min(1, 0.6 * (0.7 - 0.02 * k) ** k * crime + (sf ? 0.25 : 0)));
}
// Replies to place S stones (the AI passes on the last), cheating greedily.
// Phase model: start phase phi0, each turn advances by the reply time (and any
// wait). Returns {R, cheats, waitS}.
function schedule(S, phi0, crime, sf, replyS, { maxPer = 12, waitCap = 0.5, indep = null } = {}) {
  let placed = 0, R = 0, k = 0, t = 0, waitS = 0;
  while (placed < S) {
    R++;
    let cheat = false;
    if (S - placed >= 2 && k < maxPer) {
      if (indep) cheat = indep() <= chance(k, crime, sf);
      else {
        const phi = (phi0 + RATE * t) % 1;
        const p = chance(k, crime, sf);
        if (phi <= p) cheat = true;
        else if ((1 - phi) / RATE <= waitCap) {
          cheat = true;
          waitS += (1 - phi) / RATE;
          t += (1 - phi) / RATE;
        }
      }
    }
    if (cheat) {
      placed += 2;
      k++;
    } else placed += 1;
    t += replyS;
  }
  return { R, cheats: k, waitS };
}

function report() {
  const files = argv[1].split(",");
  // Several searches of one layout (greedy, swap, anneal runs): keep the
  // smallest VERIFIED set per (opponent, size, layout, layout seed).
  const byLayout = new Map();
  for (const r of files.flatMap((f) => fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)))) {
    if (!r.sMin || !r.verified) continue;
    const k = `${r.opponent}@${r.size}:${r.layout}:${r.layoutSeed}`;
    if (!byLayout.has(k) || r.sMin < byLayout.get(k).sMin) byLayout.set(k, r);
  }
  const L = [...byLayout.values()];
  const groups = new Map();
  for (const r of L) {
    const k = `${r.opponent}@${r.size}${r.layout === "empty" ? " empty" : ""}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const SCEN = [
    { name: "no cheat", crime: 0, sf: false, off: true },
    { name: "crime 1.5872 (live)", crime: 1.5872, sf: false },
    { name: "crime 1.5872 +SF14.3", crime: 1.5872, sf: true },
    { name: "crime 2.5", crime: 2.5, sf: false },
    { name: "crime 2.5 +SF14.3", crime: 2.5, sf: true },
    { name: "crime 10", crime: 10, sf: false },
    { name: "crime 10 +SF14.3", crime: 10, sf: true },
  ];
  const PH = 2000;
  const out = [];
  for (const [key, rs] of groups) {
    const opp = rs[0].opponent, n = rs[0].size;
    const area = rs.reduce((s, r) => s + r.area, 0) / rs.length;
    const sMin = rs.reduce((s, r) => s + r.sMin, 0) / rs.length;
    const replyS = rs.reduce((s, r) => s + r.replyMs, 0) / rs.length / 1000;
    const passS = rs.reduce((s, r) => s + (r.passMs ?? 0), 0) / rs.length / 1000;
    for (const sc of SCEN) {
      // Ratio of sums over (layout, phase): sum area / sum replies, etc.
      let sA = 0, sR = 0, sT = 0, sTf = 0, sC = 0, sW = 0, sRi = 0, cnt = 0;
      let rnd = 99;
      const indep = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      for (const r of rs) {
        for (let j = 0; j < PH; j++) {
          const phi0 = (j + 0.5) / PH;
          const s = sc.off ? { R: r.sMin, cheats: 0, waitS: 0 } : schedule(r.sMin, phi0, sc.crime, sc.sf, r.replyMs / 1000);
          const si = sc.off ? s : schedule(r.sMin, 0, sc.crime, sc.sf, 0, { indep });
          sA += r.area;
          sR += s.R;
          sRi += si.R;
          sC += s.cheats;
          sW += s.waitS;
          sT += (s.R - 1) * (r.replyMs / 1000) + (r.passMs ?? 0) / 1000;
          sTf += (s.R - 1) * 0.8 + (r.passMs ?? 0) / 1000;
          cnt++;
        }
      }
      const d = diffOf(opp, n);
      const row = {
        key, opp, size: n, scenario: sc.name, layouts: rs.length, area: +(area).toFixed(2), sMin: +sMin.toFixed(2),
        replies: +(sR / cnt).toFixed(2), repliesIndep: +(sRi / cnt).toFixed(2), cheats: +(sC / cnt).toFixed(2), waitS: +(sW / cnt).toFixed(2),
        ptsPerReply: +(sA / sR).toFixed(2), ptsPerReplyIndep: +(sA / sRi).toFixed(2),
        replyMs: Math.round(replyS * 1000), passMs: Math.round(passS * 1000),
        powerH: Math.round((3600 * 3 * d * sA) / sT), powerHwait: Math.round((3600 * 3 * d * sA) / (sT + sW)), powerHfloor: Math.round((3600 * 3 * d * sA) / sTf),
      };
      out.push(row);
    }
  }
  // BREAK-EVEN: the largest S_min at which this board's ceiling (its mean
  // area, reply and pass costs) would still reach the 5x5 ceiling (same
  // opponent if measured, else Tetrads) under the same scenario — how far the greedy S_min would have to be wrong for
  // the verdict to flip.
  for (const r of out) {
    // Against the same opponent's 5x5 when measured, else Tetrads 5x5.
    const ref = out.find((x) => x.key === `${r.opp}@5` && x.scenario === r.scenario) ?? out.find((x) => x.key === "Tetrads@5" && x.scenario === r.scenario);
    if (!ref || r.size === 5) continue;
    r.ref = ref.key;
    const sc = SCEN.find((x) => x.name === r.scenario);
    const d = diffOf(r.opp, r.size);
    let sBe = 0;
    for (let S = 1; S <= r.area; S++) {
      let sR = 0, sT = 0;
      for (let j = 0; j < PH; j++) {
        const sch = sc.off ? { R: S } : schedule(S, (j + 0.5) / PH, sc.crime, sc.sf, r.replyMs / 1000);
        sR += sch.R;
        sT += (sch.R - 1) * (r.replyMs / 1000) + r.passMs / 1000;
      }
      if ((3600 * 3 * d * r.area * PH) / sT >= ref.powerH) sBe = S;
      else break;
    }
    r.sBreakEven = sBe;
  }
  if (argv.includes("--json")) console.log(JSON.stringify(out, null, 1));
  else {
    console.log("CHEAT-AWARE STRUCTURAL CEILING (every playable point ours, AI passes; greedy S_min on dealt layouts; AI time only, ours 0)");
    console.log("board              scenario                 lay  area  S_min  replies(indep)  cheats  wait_s  pts/reply(indep)  reply_ms pass_ms  power/h  +wait  @0.8s-floor  S_min to tie 5x5");
    for (const r of out) console.log(`${r.key.padEnd(18)} ${r.scenario.padEnd(24)} ${String(r.layouts).padStart(3)} ${r.area.toFixed(1).padStart(5)} ${r.sMin.toFixed(1).padStart(6)} ${r.replies.toFixed(2).padStart(7)}(${r.repliesIndep.toFixed(2)}) ${r.cheats.toFixed(2).padStart(7)} ${r.waitS.toFixed(2).padStart(7)} ${r.ptsPerReply.toFixed(2).padStart(8)}(${r.ptsPerReplyIndep.toFixed(2)}) ${String(r.replyMs).padStart(9)} ${String(r.passMs).padStart(7)} ${String(r.powerH).padStart(8)} ${String(r.powerHwait).padStart(7)} ${String(r.powerHfloor).padStart(8)}  ${r.sBreakEven ?? "-"}${r.ref && r.ref !== `${r.opp}@5` ? ` (vs ${r.ref})` : ""}`);
  }
}
