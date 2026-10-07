// THE CHEAT GAIN, MECHANISTIC (goplan CHEAT_MODEL / cheatGain). Fits it from
// paired harness games and CHECKS it against the measured crime_success sweep,
// printing the error (CLAUDE.md: a model states its calibration).
//
//   node tools/sim/go-cheat-model.mjs --live .telemetry/go-games.txt --before 2026-10-06T22:05 \
//        --pair BASE.jsonl:ARM.jsonl:CRIME[:SECOND_MS] ... [--json]
//
// THE MODEL. go.js plays playTwoMoves on an eligible turn (from our 2nd move,
// never after the AI's pass) when the cheat roll — WHRNG of the playtime, a
// sawtooth rising RATE = 0.01693/s (golib.cheatRoll) — is inside the window
// for the cheats so far, chance(k) = min(1, 0.6 (0.7-0.02k)^k crime [+0.25
// SF14.3]), or opens within maxWaitMs. Within one game the roll moves only
// RATE x turnS per turn, so a game's cheats are set by its starting phase r0
// (uniform): availability P(N >= k | crime) follows from chance(k), the turns
// before the AI's first pass and the drift. Simulated over r0 and the
// empirical pre-pass length W (stones the game needs before the AI passes,
// from live games with no cheats: our moves before the AI's first pass; a
// cheat lays two stones, so it removes a turn).
//
// THE VALUE OF A CHEAT is measured, not assumed: within paired games (same
// deal), the number of cheats N is set by the clock phase — independent of the
// position — so regressing the paired deltas (AI seconds, black) on
// [N >= k] gives each k-th cheat's effect. All crime levels pool (crime only
// moves how many cheats a game gets). Our own time is charged per cheat as
// secondMs + a round trip + go-cheat.js's exec (CHEAT_COST_MS) — the harness's
// wall-clock search on bubtop is not used (go-w0 --work-rate note).
//
//   gain(crime) = [E black / E seconds](with cheats) / [black / seconds](without)
//
// The CHECK: each --pair arm's measured power/h ratio (blacks over AI seconds
// + charged cost, wins only — every arm here won all its games) against
// gain(its crime), error printed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const all = (n) => argv.flatMap((a, i) => (a === `--${n}` ? [argv[i + 1]] : []));
const str = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const goplan = await import(pathToFileURL(path.join(REPO, "goplan.js")).href);
const { cheatAvailability, cheatGain, CHEAT_RATE_PER_S } = goplan;

// --- live pre-pass lengths -------------------------------------------------
const LIVE = str("live", null);
const BEFORE = str("before", "2026-10-06T22:05");
let W = null;
if (LIVE) {
  const L = fs.readFileSync(LIVE, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((g) => g.opponent === "Tetrads" && g.size === 5 && g.at < BEFORE && !g.moves.some((m) => m.s === "cheat"));
  W = L.map((g) => { const i = g.moves.findIndex((m) => m.r === "P"); return i < 0 ? g.moves.length : i + 1; });
}

// --- pairs ---------------------------------------------------------------
const load = (f) => {
  const m = new Map();
  for (const l of fs.readFileSync(f, "utf8").split("\n")) {
    if (!l.includes('"kind":"game"')) continue;
    const r = JSON.parse(l);
    m.set(r.i, { black: r.black, won: r.won, aiS: (r.oppCycles * 200 + r.oppRows * 10) / 1000, N: r.cheatOk ?? 0, turns: r.oppTurns, wait: r.cheatWaitS ?? 0 });
  }
  return m;
};
const pairs = all("pair").map((s) => {
  const [b, a, crime, sec] = s.split(":");
  return { base: load(b), arm: load(a), crime: Number(crime), secondMs: sec ? Number(sec) : 400, name: path.basename(a, ".jsonl") };
});
const rows = [];
for (const p of pairs) for (const [i, a] of p.arm) { const b = p.base.get(i); if (b) rows.push({ dAI: a.aiS - b.aiS, dB: a.black - b.black, N: a.N, crime: p.crime }); }

// Least squares on [N >= k], k = 1..K (K pools >= K), no intercept.
const K = 4;
// [N >= 1], [N >= 2], [N >= 3], and max(0, N - 3): each cheat past the third alike.
const feats = (N) => Array.from({ length: K }, (_, j) => (j < K - 1 ? (N >= j + 1 ? 1 : 0) : Math.max(0, N - (K - 1))));
function ols(ys, X) {
  const p = X[0].length;
  const A = Array.from({ length: p }, () => new Array(p).fill(0));
  const v = new Array(p).fill(0);
  for (let r = 0; r < X.length; r++) for (let i = 0; i < p; i++) { v[i] += X[r][i] * ys[r]; for (let j = 0; j < p; j++) A[i][j] += X[r][i] * X[r][j]; }
  // Gaussian elimination
  for (let i = 0; i < p; i++) {
    let m = i; for (let r = i + 1; r < p; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r;
    [A[i], A[m]] = [A[m], A[i]]; [v[i], v[m]] = [v[m], v[i]];
    for (let r = 0; r < p; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c < p; c++) A[r][c] -= f * A[i][c]; v[r] -= f * v[i]; }
  }
  return v.map((x, i) => x / A[i][i]);
}
const X = rows.map((r) => feats(r.N));
const fit = (ys) => ols(ys, X);
const bAI = fit(rows.map((r) => r.dAI));
const bB = fit(rows.map((r) => r.dB));
// bootstrap CIs
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const bs = { ai: [], b: [] };
for (let t = 0; t < 400; t++) {
  const ii = rows.map(() => Math.floor(rnd() * rows.length));
  const Xs = ii.map((j) => X[j]);
  bs.ai.push(ols(ii.map((j) => rows[j].dAI), Xs));
  bs.b.push(ols(ii.map((j) => rows[j].dB), Xs));
}
const ci = (arr, k) => { const s = arr.map((v) => v[k]).sort((a, b) => a - b); return `[${s[10].toFixed(2)}, ${s[389].toFixed(2)}]`; };
console.log(`PER-CHEAT EFFECTS (${rows.length} paired games over ${pairs.length} arms; regress paired deltas on [N >= k]):`);
for (let k = 0; k < K; k++) console.log(`  cheat ${k + 1}${k === K - 1 ? "+ (each)" : "       "}: AI seconds ${bAI[k].toFixed(3)} ${ci(bs.ai, k)}   black ${bB[k].toFixed(3)} ${ci(bs.b, k)}   (games with N >= ${k + 1}: ${rows.filter((r) => r.N >= k + 1).length})`);

// Baseline game (the base arms): mean black and AI seconds.
const baseGames = pairs.flatMap((p) => [...p.base.values()]);
const uniqBase = new Map(); for (const p of pairs) for (const [i, g] of p.base) uniqBase.set(`${p.base.size}:${i}:${g.black}:${g.aiS}`, g);
const b0 = [...uniqBase.values()].reduce((s, g) => s + g.black, 0) / uniqBase.size;
const t0 = [...uniqBase.values()].reduce((s, g) => s + g.aiS, 0) / uniqBase.size;
console.log(`BASE GAME: black ${b0.toFixed(2)}, AI seconds ${t0.toFixed(2)} (${uniqBase.size} games)`);

const model = { dAI: bAI, dB: bB, black0: b0, ai0: t0, W: W ? W.slice(0, 2000) : null };
// --- the availability check: mean N per arm, model vs harness ---------------
console.log(`\nAVAILABILITY CHECK (mean cheats a game; pre-pass length W from ${W ? W.length : 0} live games, mean ${W ? (W.reduce((a, b) => a + b, 0) / W.length).toFixed(2) : "-"}):`);
for (const p of pairs) {
  const obs = [...p.arm.values()];
  const meanN = obs.reduce((s, g) => s + g.N, 0) / obs.length;
  const av = cheatAvailability(p.crime, { W: model.W });
  const pred = av.reduce((s, x) => s + x, 0);
  console.log(`  ${p.name.padEnd(16)} crime ${p.crime.toFixed(3)}: observed ${meanN.toFixed(2)}  model ${pred.toFixed(2)}  error ${(100 * (pred / meanN - 1)).toFixed(1)}%`);
}
// --- the gain check ----------------------------------------------------------
console.log(`\nGAIN CHECK (power/h with cheats / without; AI seconds + charged cheat cost, our search otherwise equal):`);
for (const p of pairs) {
  let sb = 0, st = 0, sb0 = 0, st0 = 0, n = 0;
  for (const [i, a] of p.arm) { const b = p.base.get(i); if (!b) continue; n++; sb += a.black; st += a.aiS + a.N * (p.secondMs + 235) / 1000 + a.wait; sb0 += b.black; st0 += b.aiS; }
  const meas = (sb / st) / (sb0 / st0);
  const pred = cheatGain(p.crime, { ...model, secondMs: p.secondMs });
  console.log(`  ${p.name.padEnd(16)} crime ${p.crime.toFixed(3)} second ${p.secondMs}ms: measured x${meas.toFixed(3)}  model x${pred.toFixed(3)}  error ${(100 * (pred / meas - 1)).toFixed(1)}%  (n ${n})`);
}
console.log(`\nCURVE (second stone 100ms): ` + [1, 1.25, 1.5872, 2, 2.5, 3, 4, 5, 6.4, 8, 10, 15, 25].map((c) => `${c}:x${cheatGain(c, { ...model, secondMs: 100 }).toFixed(3)}`).join(" "));
console.log(`MODEL (goplan CHEAT_MODEL): ${JSON.stringify({ dAI: bAI.map((x) => +x.toFixed(3)), dB: bB.map((x) => +x.toFixed(3)), black0: +b0.toFixed(2), ai0: +t0.toFixed(2), Wmean: W ? +(W.reduce((a, b) => a + b, 0) / W.length).toFixed(2) : null })}`);
if (argv.includes("--json")) console.log(JSON.stringify({ ...model, W: W ? histogram(W) : null }));
function histogram(ws) { const h = {}; for (const w of ws) h[w] = (h[w] ?? 0) + 1; return h; }
process.exit(0);
