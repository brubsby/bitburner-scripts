// Fit traderw.js's curve to the r(W) simulation (tools/sim/stocks/rw.mjs).
//
//   node tools/sim/stocks/rwfit.mjs [--regime pre-long|4S-long]
//
// Reads rw-data/<regime>.json (the half-decade grid, 5h runs) and
// rw-data/<regime>-low.json (the low books, 0.1-decade bins), weights each
// bin by its information (n intervals of 0.1h at the bin's own noise), and
// fits r0, W*, the ramp (hLo, Wr, k) and the knee's sharpness n by
// Nelder-Mead on the weighted squared error of ln-growth/h. Wmin is not
// fitted: it is the last bin where the trader traded at all (commission).
// Prints the constants for traderw.js RW_PRIOR, the fit's residual per bin,
// the noise profile sigma(W), and the between-life spread net of noise.
//
// CALIBRATION (printed every run): the live ledger's intervals, binned by
// book, against the fitted curve — /tel/stock-hist.txt mirrored in
// .telemetry (the last ~6h only; stock.js keeps 360 rows).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rwShape, RW_PRIOR } from "../../../traderw.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const REGIME = arg("regime", "pre-long");

export function binsOf(regime) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(HERE, "rw-data", f), "utf8"));
  const hi = read(`${regime}.json`).rows;
  const lo = read(`${regime}-low.json`).rows;
  // The low run covers up to ~3e7 finely; the grid run above that.
  const rows = [...lo.filter((r) => r.W < 3e7), ...hi.filter((r) => r.W >= 3e7)];
  return rows;
}

export function wminOf(rows) {
  // Books at which the trader never trades (r = 0 over >= 100 intervals): the last such bin's upper edge.
  const idle = rows.filter((r) => r.W < 1e8 && r.n >= 100 && Math.abs(r.r) < 0.02).map((r) => r.W);
  const act = rows.filter((r) => r.n >= 5 && r.r > 0.1).map((r) => r.W);
  const lastIdle = Math.max(...idle);
  const firstAct = Math.min(...act.filter((w) => w > lastIdle));
  return Math.sqrt(lastIdle * firstAct);
}

function nelderMead(f, x0, step, iters = 4000) {
  const n = x0.length;
  let S = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step[j] : v)))].map((x) => ({ x, f: f(x) }));
  for (let it = 0; it < iters; it++) {
    S.sort((a, b) => a.f - b.f);
    const c = Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += S[i].x[j] / n;
    const w = S[n];
    const at = (t) => c.map((v, j) => v + t * (w.x[j] - v));
    const r = at(-1);
    const fr = f(r);
    if (fr < S[0].f) {
      const e = at(-2);
      const fe = f(e);
      S[n] = fe < fr ? { x: e, f: fe } : { x: r, f: fr };
    } else if (fr < S[n - 1].f) S[n] = { x: r, f: fr };
    else {
      const k = at(0.5);
      const fk = f(k);
      if (fk < w.f) S[n] = { x: k, f: fk };
      else S = S.map((s, i) => (i === 0 ? s : { x: s.x.map((v, j) => S[0].x[j] + 0.5 * (v - S[0].x[j])), f: f(s.x.map((v, j) => S[0].x[j] + 0.5 * (v - S[0].x[j]))) }));
    }
  }
  S.sort((a, b) => a.f - b.f);
  return S[0];
}

export function fit(regime) {
  const rows = binsOf(regime);
  const Wmin = wminOf(rows);
  const use = rows.filter((r) => r.W >= Wmin && r.n >= 20 && r.sigmaPerSqrtH > 0);
  // Information per bin: n intervals of 0.1h, each with variance sigma^2/0.1.
  const wt = (r) => (r.n * 0.1) / Math.max(r.sigmaPerSqrtH, 0.02) ** 2;
  const unpack = (x) => ({ r0: Math.exp(x[0]), Wstar: Math.exp(x[1]), shape: { Wmin, hLo: 1 / (1 + Math.exp(-x[2])), Wr: Math.exp(x[3]), k: Math.exp(x[4]), n: Math.exp(x[5]) } });
  const sse = (x) => {
    const p = unpack(x);
    let s = 0;
    for (const r of use) s += wt(r) * (r.r - p.r0 * rwShape(r.W, p.Wstar, p.shape)) ** 2;
    return s;
  };
  const best = nelderMead(sse, [Math.log(0.8), Math.log(3e11), 0.3, Math.log(3e7), Math.log(1.5), Math.log(1.5)], [0.2, 1, 0.5, 1, 0.3, 0.3]);
  const p = unpack(best.x);
  // Noise profile: sigma0 (1 + (W/sW)^n)^(-1/n) on the sigma column.
  const su = rows.filter((r) => r.W >= Wmin && r.n >= 50 && r.sigmaPerSqrtH > 0);
  const sb = nelderMead((x) => su.reduce((s, r) => s + r.n * (Math.log(r.sigmaPerSqrtH) - Math.log(Math.exp(x[0]) * Math.pow(1 + Math.pow(r.W / Math.exp(x[1]), Math.exp(x[2])), -1 / Math.exp(x[2])))) ** 2, 0), [Math.log(0.22), Math.log(1e12), 0.3], [0.2, 1, 0.3]);
  const sigma = { sigma0: Math.exp(sb.x[0]), sWstar: Math.exp(sb.x[1]), n: Math.exp(sb.x[2]) };
  // Between-life spread net of noise: per bin, betweenSd^2 - sigma^2 / (hours a run spends in it), relative.
  const tau = [];
  for (const r of rows.filter((r) => r.W >= Wmin && r.runs >= 8 && r.betweenSd !== null && r.r > 0.1)) {
    const hPerRun = (r.n * 0.1) / Math.max(1, r.runs);
    const v = r.betweenSd ** 2 - r.sigmaPerSqrtH ** 2 / hPerRun;
    tau.push({ W: r.W, rel: v > 0 ? Math.sqrt(v) / r.r : 0 });
  }
  const tauRel = tau.length ? tau.reduce((s, t) => s + t.rel, 0) / tau.length : null;
  return { regime, ...p, sigma, tauRel, tau, rows, use, sse: best.f };
}

export function ledgerBins(file, W0 = 0) {
  let t;
  try {
    t = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const rows = t.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const bins = new Map();
  let prev = null;
  for (const b of rows) {
    const a = prev;
    prev = b;
    if (!a || b.t < a.t || !(a.wealth > W0)) continue;
    if (Math.abs(b.externalFlows - a.externalFlows) > 0.02 * a.wealth) continue;
    const dtH = ((b.t - a.t) * 6) / 3600;
    const g = 1 + (b.lifePnl - a.lifePnl) / a.wealth;
    if (!(dtH > 0 && g > 0)) continue;
    const k = Math.round(Math.log10(a.wealth) * 2) / 2;
    if (!bins.has(k)) bins.set(k, { x: 0, h: 0 });
    bins.get(k).x += Math.log(g);
    bins.get(k).h += dtH;
  }
  return [...bins].sort((a, b) => a[0] - b[0]).map(([k, v]) => ({ W: 10 ** k, r: v.x / v.h, h: v.h }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const f = fit(REGIME);
  const fmt = (x) => x.toExponential(2);
  console.log(`r(W) fit, ${REGIME} (weighted SSE ${f.sse.toFixed(1)} over ${f.use.length} bins)`);
  console.log(`  r0 ${f.r0.toFixed(4)}/h  W* ${fmt(f.Wstar)}  shape { Wmin: ${fmt(f.shape.Wmin)}, hLo: ${f.shape.hLo.toFixed(3)}, Wr: ${fmt(f.shape.Wr)}, k: ${f.shape.k.toFixed(2)}, n: ${f.shape.n.toFixed(2)} }`);
  console.log(`  sigma { sigma0: ${f.sigma.sigma0.toFixed(3)}, sWstar: ${fmt(f.sigma.sWstar)}, n: ${f.sigma.n.toFixed(2)} }  tauRel ${f.tauRel?.toFixed(3)} (per bin: ${f.tau.map((t) => `${fmt(t.W)}:${t.rel.toFixed(2)}`).join(" ")})`);
  const cur = RW_PRIOR[REGIME];
  console.log(`  bin        sim r/h   fit    traderw.js RW_PRIOR`);
  for (const r of f.rows) {
    const m = f.r0 * rwShape(r.W, f.Wstar, f.shape);
    const c = cur ? cur.r0PerHour * rwShape(r.W, cur.Wstar, cur.shape) : null;
    console.log(`  $${fmt(r.W).padStart(9)} ${(r.r * 100).toFixed(1).padStart(7)}% ${(m * 100).toFixed(1).padStart(6)}% ${c === null ? "" : (c * 100).toFixed(1).padStart(6) + "%"}  n ${r.n}`);
  }
  const live = [path.join(HERE, "../../../.telemetry/stock-hist.txt")];
  for (const file of live) {
    const b = ledgerBins(file);
    if (!b) {
      console.log(`CALIBRATION: NOT CALIBRATED — no ledger at ${file}`);
      continue;
    }
    console.log(`CALIBRATION (live ${file}, flow-free intervals by book; one life's level scatters ~${((f.tauRel ?? 0) * 100).toFixed(0)}% and each hour ~${(f.sigma.sigma0 * 100).toFixed(0)}%/h):`);
    for (const x of b) {
      const m = (cur ?? f).r0PerHour ? cur.r0PerHour * rwShape(x.W, cur.Wstar, cur.shape) : f.r0 * rwShape(x.W, f.Wstar, f.shape);
      console.log(`  $${fmt(x.W).padStart(9)}  live ${(x.r * 100).toFixed(1).padStart(7)}%/h over ${x.h.toFixed(2)}h  curve ${(m * 100).toFixed(1)}%/h  error ${m > 0 ? (((x.r - m) / m) * 100).toFixed(0) + "%" : "n/a"}`);
    }
  }
}
