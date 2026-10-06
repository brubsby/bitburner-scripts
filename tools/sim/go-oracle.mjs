// NOT CALIBRATED as a bound; its PLANS are measured as a policy through
// go-oracle-book.mjs -> go-w0.mjs --oracle-file/--oracle-book (paired).
//
// THE POINTS-PER-AI-TURN ORACLE. Node power per hour is black points per
// AI-second, and an AI reply costs ~0.8-1.1s whatever it is, so the lever is
// points per AI reply. The game ends cheapest when the AI PASSES (no move
// option left) and we pass back — our pass costs no reply. This is a beam
// search over OUR move sequences against the game's own getMove (tools/goai),
// recording every winning way the game can end like that, and the best
// black points per AI reply (and black - LAMBDA x replies) among them.
//
// THE AI AS THE GAME CLOCK MAKES IT (--phases, --roots, --tree): its seed is
// the playtime one waitCycle after our play (goAI.ts:184) and its reply is
// piecewise constant over runs of ~10-20 engine ticks (go-seedseq.mjs), so in
// one game it is close to a deterministic function of the clock. Each plan
// fixes a start time T0 and seeds the reply to our i-th stone
// T0 + 200 x (LAG + round(i x TT)). A plan is then a line the AI really plays
// at that clock — live, go-solver plays a step only when the request's clock
// predicts the reply the line expects. Without a clock (--phases 0) the seed
// is a hash of the board: an idealised deterministic AI (a bound, not a plan).
//
// MEASURED 2026-10-06, Tetrads 5x5 (live search: 1.74 points per AI reply):
// clock plans over layouts 0-39 average 2.85 (21.3 points in 7.5 replies);
// hash-seeded ~3.0; 7x7 empty board (hash, beam 300) 2.04.
//
//   node tools/sim/go-oracle.mjs [--opponent Tetrads] [--size 5] [--layouts 0-9] [--beam 500] [--depth 14]
//        [--phases P | --roots misses.jsonl | --tree [--max-plans 40 --expand-depth 4 --samples 24 --pmin 0.1]]
//        [--lambda 2.5] [--seed S] [--eyebonus W]
//   (5x5 layouts from tools/goai/layouts-5.json, most common first, with
//   Illuminati's handicap stone placements as starts of their own; other
//   sizes: the empty board.) One JSON line per plan on stdout.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..");
const argv = process.argv.slice(2);
const str = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const num = (n, d) => Number(str(n, d));
// Deterministic Math.random (getDefendMove draws it).
let ms = (() => { const i = process.argv.indexOf("--seed"); return i > -1 ? Number(process.argv[i + 1]) : 12345; })();
Math.random = () => ((ms = (ms * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const golib = await import(pathToFileURL(path.join(REPO, "golib.js")).href);
const { loadModel } = await import(pathToFileURL(path.join(REPO, "tools/goai/model.mjs")).href);
const model = await loadModel({ quiet: false });
if (!model) throw new Error("tools/goai model unavailable");
const OPP = str("opponent", "Tetrads");
const N = num("size", 5);
const BEAM = num("beam", 3000);
const DEPTH = num("depth", 16);
// LAMBDA: the Dinkelbach price of one AI reply in points (power/h is a ratio
// of sums, so a game's worth is black - LAMBDA x replies at the rate earned).
const LAMBDA = num("lambda", 2.5);
// --phases P: THE CLOCK, as live. The AI's seed is the playtime one waitCycle
// after our play (goAI.ts:184), and its reply is piecewise constant over runs
// of ~10-20 engine ticks (go-seedseq.mjs) — so within one game the AI is close
// to a deterministic function of the game's start time T0. Each layout is
// searched P times, from P start times drawn over the WHRNG period (59.06 s),
// the reply to our i-th stone seeded T0 + 200 x (LAG + round(i x TT)) (TT:
// engine ticks per turn, ~5.5 live). P = 0: the seed is a hash of the board
// (an idealised deterministic AI — the bound, not a plan).
const PHASES = num("phases", 0);
const TT = num("tt", 5.5);
const LAG = num("lag", 1);
// --robust R: SEED-ROBUST LINES. A step is kept only if the AI gives the same
// reply at every seed within +-(R + i) ticks of the one assumed for our i-th
// stone (checked at 5 points across the window) — the timing of a live game
// drifts from the plan by a tick or two a turn, and a line that needs one
// particular seed leaves the game where the plan assumed a capture (go-w0
// 2026-10-06: 3 losses in 193 games on non-robust candidates). Lines found
// this way hold whatever the clock does, up to the window.
const ROBUST = num("robust", 0);
// --cheat CRIME [--sf143]: plans may use playTwoMoves where the clock says the
// cheat roll succeeds (see the step loop). CHEAT_COST: the cheat's extra live
// time (go-cheat.js exec + a round trip, ~0.24s) in AI replies (~1s each),
// charged in the value at LAMBDA; CHEAT_TICKS: the AI's seed after a cheat is
// that much later.
const CHEAT = argv.includes("--cheat");
const CHEAT_CRIME = num("cheat", 1);
const CHEAT_SF = argv.includes("--sf143") ? 3 : 0;
const CHEAT_MAX = num("cheat-max", 6);
const CHEAT_COST = num("cheat-cost", 0.25);
const CHEAT_TICKS = num("cheat-ticks", 1);
const CHEAT_MARGIN = num("cheat-margin", 0.01);
const PAIRS = num("pairs", 8), PAIRS2 = num("pairs2", 6);
const komi = model.komiOf(OPP);
const nbrs = golib.makeGeometry(N);
const scratch = golib.makeScratch(N);
const [L0, L1] = str("layouts", "0-9").split("-").map(Number);
const layouts = N === 5 ? JSON.parse(fs.readFileSync(path.join(REPO, "tools/goai/layouts-5.json"), "utf8")).layouts.slice(L0, L1 + 1) : [{ key: ".".repeat(N * N), p: 1 }];
const toSimple = (s) => Array.from({ length: N }, (_, x) => s.slice(x * N, (x + 1) * N));
const CH = [".", "X", "O", "#"];
const toStr = (b) => { let s = ""; for (let i = 0; i < N * N; i++) s += CH[b[i]]; return s; };
const seedOf = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return 1 + ((h >>> 0) % 29999999); };
// --eyebonus W: the beam also ranks by W x the empty points the AI already
// treats as ours — regions bordered only by black, no larger than the AI's
// eye-size cap min(0.4 x live points, 11) (boardAnalysis.ts:282-284), which
// it never plays into. That is what makes it pass; on big boards plain area
// never gets there.
const EYEB = num("eyebonus", 0);
function safeEmpty(b, points) {
  const cap = Math.min(points * 0.4, 11);
  const seen = new Uint8Array(N * N);
  let total = 0;
  const q = [];
  for (let i = 0; i < N * N; i++) {
    if (b[i] !== golib.EMPTY || seen[i]) continue;
    q.length = 0; q.push(i); seen[i] = 1;
    let white = false, black = false;
    for (let k = 0; k < q.length; k++) for (const j of nbrs[q[k]]) {
      if (b[j] === golib.EMPTY && !seen[j]) { seen[j] = 1; q.push(j); }
      else if (b[j] === golib.US) black = true;
      else if (b[j] === golib.THEM) white = true;
    }
    if (black && !white && q.length <= cap) total += q.length;
  }
  return total;
}
let calls = 0;
const out = [];
const runs = [];
// --roots FILE (go-w0 --oracle-misses): plan from each logged position at its
// own clock (T: the playtime at our play there) instead of from the layouts.
const ROOTS = str("roots", null);
if (ROOTS) {
  const seen = new Set();
  for (const l of fs.readFileSync(ROOTS, "utf8").split("\n")) {
    if (!l.trim()) continue;
    const r = JSON.parse(l);
    const k = `${r.board}|${r.passed}|${r.T}`;
    if (seen.has(k)) continue;
    seen.add(k);
    runs.push({ L: { key: r.board, p: 1 }, T0: r.T, hist: r.history ?? [], passed: !!r.passed });
  }
  const [a, z] = str("slice", `0-${runs.length - 1}`).split("-").map(Number);
  runs.splice(0, runs.length, ...runs.slice(a, z + 1));
} else {
  // HANDICAP STONES (Illuminati: one white stone on 5x5, boardState.ts:100-112,
  // 164-200, placed by Math.random): each placement is a start of its own,
  // weighted by its frequency over --handicap-samples deals; starts under
  // --pstart are skipped.
  const { OUT } = await import(pathToFileURL(path.join(REPO, "tools/goai/build.mjs")).href);
  const m = await import(pathToFileURL(OUT).href);
  const opp = model.opponentOf(OPP);
  const h = m.getHandicap(N, opp);
  const HS = num("handicap-samples", 400);
  for (const L of layouts) {
    const starts = new Map();
    if (h) {
      for (let i = 0; i < HS; i++) {
        const st = m.getNewBoardStateFromSimpleBoard(toSimple(L.key), undefined, opp, m.GoColor.white);
        m.applyHandicap(st.board, h);
        const k = m.simpleBoardFromBoard(st.board).join("");
        starts.set(k, (starts.get(k) ?? 0) + 1 / HS);
      }
    } else starts.set(L.key, 1);
    for (const [k, p] of [...starts.entries()].sort((a, z) => z[1] - a[1])) {
      if (p < num("pstart", 0.03)) continue;
      for (let ph = 0; ph < Math.max(1, PHASES); ph++) runs.push({ L: { key: k, p: L.p * p }, T0: PHASES ? 200 * Math.floor(5e6 + Math.random() * 5e6) : null });
    }
  }
}
async function plan({ L, T0, hist: rootHist = [], passed: rootPassed = false, root = false }) {
  const t0 = Date.now();
  const rngAt = (t, s2) => (T0 === null ? seedOf(s2) : T0 + 200 * (LAG + Math.round(t * TT)));
  const points = [...L.key].filter((c) => c !== "#").length;
  // state: { s, hist (board strings before each stone, most recent first), t (AI replies), passed, line }
  let beam = [{ s: L.key, hist: rootHist, t: 0, passed: rootPassed, line: [] }];
  let best = null; // best ratio
  let bestV = null; // best black - LAMBDA x replies
  let ends = 0;
  for (let d = 0; d < DEPTH && beam.length; d++) {
    const next = new Map();
    for (const st of beam) {
      const simple = toSimple(st.s);
      const b = golib.parseBoard(simple);
      if (st.passed) {
        // Our pass ends the game.
        const m = golib.scoreBoard(b, nbrs, N, komi, scratch);
        if (m > 0 && (st.t > 0 || rootPassed)) {
          ends++;
          const r = scratch.us / Math.max(1, st.t);
          if (!best || r > best.ratio) best = { ratio: r, black: scratch.us, t: st.t, line: [...st.line, "P"] };
          const v = scratch.us - LAMBDA * (st.t + (st.cost ?? 0));
          if (!bestV || v > bestV.v) bestV = { v, ratio: r, black: scratch.us, t: st.t, cheats: st.c ?? 0, cost: st.cost ?? 0, line: [...st.line, "P"] };
        }
      }
      // One child: our stone(s), the AI's reply at this step's clock (a cheat
      // is played ~one engine tick later: its exec), robust if asked.
      const child = async (stones) => {
        const b2 = b.slice();
        for (const i of stones) if (golib.play(b2, nbrs, i, golib.US, scratch) < 0) return;
        const s2 = toStr(b2);
        const hist2 = [st.s, ...st.hist];
        const cheat = stones.length > 1;
        const seed0 = rngAt(st.t, s2) + (cheat && T0 !== null ? 200 * CHEAT_TICKS : 0);
        calls++;
        const r = await model.reply(toSimple(s2), { opponent: OPP, history: hist2, passCount: 0, rng: seed0 });
        if (ROBUST && T0 !== null) {
          const w = ROBUST + st.t;
          for (const d of [-w, -Math.ceil(w / 2), Math.ceil(w / 2), w]) {
            calls++;
            const q = await model.reply(toSimple(s2), { opponent: OPP, history: hist2, passCount: 0, rng: seed0 + 200 * d });
            if ((q ? `${q.x},${q.y}` : "P") !== (r ? `${r.x},${r.y}` : "P")) return;
          }
        }
        let s3 = s2, hist3 = hist2;
        if (r) {
          const b3 = b2.slice();
          if (golib.play(b3, nbrs, r.x * N + r.y, golib.THEM, scratch) >= 0) { s3 = toStr(b3); hist3 = [s2, ...hist2]; }
        }
        const c = (st.c ?? 0) + (cheat ? 1 : 0);
        const key = s3 + (r ? "m" : "p") + c;
        if (next.has(key)) return;
        const b3 = golib.parseBoard(toSimple(s3));
        golib.scoreBoard(b3, nbrs, N, komi, scratch);
        // Rank: black area minus white's, + a bonus for a position the AI has passed in.
        const h = scratch.us - scratch.them + (r ? 0 : 2) + (EYEB ? EYEB * safeEmpty(b3, points) : 0) - (cheat ? LAMBDA * CHEAT_COST : 0);
        const mv = stones.map((i) => `${(i / N) | 0},${i % N}`).join("+");
        next.set(key, { s: s3, hist: hist3, t: st.t + 1, c, cost: (st.cost ?? 0) + (cheat ? CHEAT_COST : 0), passed: !r, line: [...st.line, `${mv}>${r ? `${r.x},${r.y}` : "P"}`], h });
      };
      const singles = model.validMoves(simple, st.hist).map(([x, y]) => x * N + y);
      for (const i of singles) await child([i]);
      // CHEATS (--cheat CRIME): playTwoMoves on a step whose cheat roll — the
      // WHRNG of the playtime at our play, golib.cheatRoll — is inside this
      // game's window for the cheat count so far (golib.cheatChance), so it
      // cannot fail. Pairs among the --pairs best first stones (golib
      // heuristic) x the --pairs2 best second stones after each.
      if (CHEAT && T0 !== null && !st.passed) {
        const c0 = st.c ?? 0;
        const Tplay = rngAt(st.t, "") - 200 * LAG;
        if (c0 < CHEAT_MAX && golib.cheatRoll(Tplay) <= golib.cheatChance(c0, CHEAT_CRIME, CHEAT_SF) - CHEAT_MARGIN) {
          const rank = (bb, list) => list.map((i) => ({ i, h: golib.heuristic(bb, nbrs, i, scratch, golib.US) })).filter((e) => e.h > -1e9).sort((a, z) => z.h - a.h).map((e) => e.i);
          const firsts = rank(b, singles).slice(0, PAIRS);
          for (const i1 of firsts) {
            const b1 = b.slice();
            if (golib.play(b1, nbrs, i1, golib.US, scratch) < 0) continue;
            const seconds = rank(b1, singles.filter((j) => j !== i1 && b1[j] === golib.EMPTY)).slice(0, PAIRS2);
            for (const i2 of seconds) await child([i1, i2]);
          }
        }
      }
    }
    beam = [...next.values()].sort((a, z) => z.h - a.h).slice(0, BEAM);
  }
  const rec = { layout: L.key, p: L.p, ...(ROOTS || root ? { root: true, rootPassed } : {}), T0, tt: TT, lag: LAG, ...(ROBUST ? { robust: ROBUST } : {}), ...(CHEAT ? { cheat: { crime: CHEAT_CRIME, sf: CHEAT_SF, roll0: golib.cheatRoll(T0 + 200 * LAG - 200 * LAG) } } : {}), points, ends, best, bestV, lambda: LAMBDA, s: Math.round((Date.now() - t0) / 1000), calls };
  out.push(rec);
  console.log(JSON.stringify(rec));
  return rec;
}
// --tree: THE BOOK AS A TREE. One plan per layout start at a random clock, then
// along each plan's first --expand-depth steps, the AI's reply distribution at
// that step over --samples random clocks; every OTHER reply with probability
// >= --pmin (path probability >= --pathmin) is planned from in turn, at a clock
// where the AI gives that reply (so the phase is consistent), most probable
// first, up to --max-plans per layout. Positions are planned once.
const TREE = argv.includes("--tree");
if (TREE) {
  const SAMPLES = num("samples", 24), PMIN = num("pmin", 0.1), PATHMIN = num("pathmin", 0.01), XD = num("expand-depth", 4), MAXP = num("max-plans", 40);
  const byLayout = new Map();
  for (const r of runs) if (!byLayout.has(r.L.key)) byLayout.set(r.L.key, r);
  for (const start of byLayout.values()) {
    const queue = [{ ...start, pathP: 1, depth: 0 }];
    const planned = new Set();
    let n = 0;
    while (queue.length && n < MAXP) {
      queue.sort((a, z) => z.pathP - a.pathP);
      const it = queue.shift();
      const ck = golib.canonicalBoard(it.L.key).key + (it.passed ? "p" : "");
      if (planned.has(ck)) continue;
      planned.add(ck);
      n++;
      const rec = await plan({ ...it, root: it.depth > 0 });
      if (!rec.bestV) continue;
      let s0 = it.L.key, hist = it.hist ?? [];
      const steps = rec.bestV.line.filter((m) => m !== "P");
      for (let i = 0; i < Math.min(XD, steps.length); i++) {
        const [mv, rp] = steps[i].split(">");
        const [x, y] = mv.split(",").map(Number);
        const b = golib.parseBoard(toSimple(s0));
        golib.play(b, nbrs, x * N + y, golib.US, scratch);
        const s2 = toStr(b);
        const hist2 = [s0, ...hist];
        const dist = new Map();
        for (let k = 0; k < SAMPLES; k++) {
          const T = 200 * Math.floor(5e6 + Math.random() * 5e6);
          const r = await model.reply(toSimple(s2), { opponent: OPP, history: hist2, passCount: 0, rng: T });
          const key = r ? `${r.x},${r.y}` : "P";
          const e = dist.get(key) ?? { n: 0, T, r };
          e.n++;
          dist.set(key, e);
        }
        const pLine = (dist.get(rp)?.n ?? 0) / SAMPLES;
        for (const [key, e] of dist) {
          const pr = e.n / SAMPLES;
          if (key === rp || pr < PMIN || it.pathP * pr < PATHMIN) continue;
          const b3 = b.slice();
          let s3 = s2, hist3 = hist2;
          if (e.r) { golib.play(b3, nbrs, e.r.x * N + e.r.y, golib.THEM, scratch); s3 = toStr(b3); hist3 = [s2, ...hist2]; }
          queue.push({ L: { key: s3, p: it.L.p }, T0: e.T + 200 * Math.round(TT) - 200 * LAG, hist: hist3, passed: !e.r, pathP: it.pathP * pr, depth: it.depth + i + 1 });
        }
        // Follow the line itself (its reply).
        const b4 = b.slice();
        let s4 = s2, hist4 = hist2;
        if (rp !== "P") { const [rx, ry] = rp.split(",").map(Number); golib.play(b4, nbrs, rx * N + ry, golib.THEM, scratch); s4 = toStr(b4); hist4 = [s2, ...hist2]; }
        s0 = s4; hist = hist4;
        it.pathP *= Math.max(pLine, 0.05);
        if (rp === "P") break;
      }
    }
  }
} else for (const r of runs) await plan(r);
const w = out.filter((r) => r.best);
const wv = out.filter((r) => r.bestV);
console.log(`Dinkelbach-best (lambda ${LAMBDA}): ratio of sums ${(wv.reduce((s, r) => s + r.p * r.bestV.black, 0) / wv.reduce((s, r) => s + r.p * r.bestV.t, 0)).toFixed(3)} (p-weighted)`);
console.log(`mean best ratio ${(w.reduce((s, r) => s + r.best.ratio, 0) / w.length).toFixed(3)} (black ${(w.reduce((s, r) => s + r.best.black, 0) / w.length).toFixed(1)} in ${(w.reduce((s, r) => s + r.best.t, 0) / w.length).toFixed(1)} AI turns) over ${w.length} layouts`);
process.exit(0);
