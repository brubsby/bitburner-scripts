// NOT CALIBRATED: an offline bound, not a policy. The opponent is the game's
// own getMove (tools/goai), made DETERMINISTIC (a fixed seed per position and a
// seeded Math.random) — Tetrads' reply barely depends on its seed (go-w0
// --steer: over 5-9 consecutive live seeds the reply differed on ~1.7 of ~12
// moves a game), so this is close to the opponent as it plays.
//
// THE POINTS-PER-AI-TURN ORACLE: a beam search over OUR move sequences against
// that deterministic AI, recording every way the game can end (the AI passes,
// we pass back — our pass costs no AI reply) with black winning, and the best
// black points per AI reply among them. It answers: how far above the
// policy's ~1.75 points per AI turn can ANY policy get on these layouts,
// given how this AI actually replies? (The structural ceiling, go-passmin.mjs,
// assumes the AI never places a stone; this one plays the AI.)
//
//   node tools/sim/go-oracle.mjs [--opponent Tetrads] [--size 5] [--layouts 0-9] [--beam 3000] [--depth 16]
//   (5x5 layouts from tools/goai/layouts-5.json, most common first; other sizes: the empty board)
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
          const v = scratch.us - LAMBDA * st.t;
          if (!bestV || v > bestV.v) bestV = { v, ratio: r, black: scratch.us, t: st.t, line: [...st.line, "P"] };
        }
      }
      for (const [x, y] of model.validMoves(simple, st.hist)) {
        const b2 = b.slice();
        if (golib.play(b2, nbrs, x * N + y, golib.US, scratch) < 0) continue;
        const s2 = toStr(b2);
        const hist2 = [st.s, ...st.hist];
        calls++;
        const r = await model.reply(toSimple(s2), { opponent: OPP, history: hist2, passCount: 0, rng: rngAt(st.t, s2) });
        let s3 = s2, hist3 = hist2;
        if (r) {
          const b3 = b2.slice();
          if (golib.play(b3, nbrs, r.x * N + r.y, golib.THEM, scratch) >= 0) { s3 = toStr(b3); hist3 = [s2, ...hist2]; }
        }
        const key = s3 + (r ? "m" : "p");
        if (next.has(key)) continue;
        const b3 = golib.parseBoard(toSimple(s3));
        golib.scoreBoard(b3, nbrs, N, komi, scratch);
        // Rank: black area minus white's, + a bonus for a position the AI has passed in.
        const h = scratch.us - scratch.them + (r ? 0 : 2) + (EYEB ? EYEB * safeEmpty(b3, points) : 0);
        next.set(key, { s: s3, hist: hist3, t: st.t + 1, passed: !r, line: [...st.line, `${x},${y}>${r ? `${r.x},${r.y}` : "P"}`], h });
      }
    }
    beam = [...next.values()].sort((a, z) => z.h - a.h).slice(0, BEAM);
  }
  const rec = { layout: L.key, p: L.p, ...(ROOTS || root ? { root: true, rootPassed } : {}), T0, tt: TT, lag: LAG, points, ends, best, bestV, lambda: LAMBDA, s: Math.round((Date.now() - t0) / 1000), calls };
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
