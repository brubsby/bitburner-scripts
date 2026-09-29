// THE TRADER'S RETURN AS A FUNCTION OF ITS BOOK, r(W), on the game's own market.
//
//   node tools/sim/stocks/rw.mjs [--regime pre-long|4S-long] [--seeds 12]
//        [--hours 5] [--skip 1] [--w0 1e6,...] [--jobs 8] [--json out.json]
//
// Every life starts from a reset book and a re-initialised market
// (Prestige.ts initStockMarket), and the final life starts from ~$1m, so
// what the exit needs is the instantaneous return at book W over the whole
// range $1m -> $100t, not one number. For each starting book W0 (half-decade
// grid) and seed: a fresh market (burn-in 0, stockstrat's freshTicks as
// stock.js passes it after an install), the SHIPPED strategy (stockstrat.js
// through strategies.runNew) trading it for `hours`; the wealth every 60 ticks
// (0.1h). The first `skip` hours (the trader's warm-up: phase lock, the
// post-install losses — priced separately as capitalWarmupH) are dropped;
// each remaining 0.1h interval is one observation x = ln(W1/W0)/0.1h at the
// book it started from — exactly what the ledger fit sees in
// /tel/stock-hist.txt (bayes.traderPosterior). Observations are binned by
// book (half-decade bins); per bin: the mean x (the log-growth), and the
// between-seed sd of each seed's bin mean (a life's spread around the curve).
//
// What moves r with W, structurally (game source, v3):
//   - commission $100k per order (Constants.ts): a drag of ~n_orders x $100k
//     per hour on a small book — the trader stays out when the edge cannot
//     pay it (stockstrat commissionCover), so a $1m book is mostly idle;
//   - maxShares (20% of outstanding, Stock.ts:152): the best-edge stocks fill
//     and the book spills into worse ones;
//   - forecast damage: every shareTxForMovement shares traded cut otlkMag by
//     0.006 (StockMarketHelpers.ts processTransactionForecastMovement) — a
//     large book erodes the edge it trades on, and pays it again on exit;
//   - no price impact in v3 (the price never moves on our orders).
// So E(W) = r(W) W saturates in $/h: the market's absorbable edge.
//
// CALIBRATION: this file measures the simulated market only. rwfit.mjs fits
// traderw.js's curve to its output and prints, on every run, the live ledger
// (/tel/stock-hist.txt, flow-free intervals binned by book) against the curve
// with the error per bin; bayes.traderRwPosterior is what the plan uses, the
// sim being its prior. Live BN9 2026-09-28/29 ($3e9-$1e11 books): 0.63-0.82/h
// against the curve's 0.74-0.80/h.

import { spawn } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const REGIME = arg("regime", "pre-long");
const SEEDS = Number(arg("seeds", 12));
const HOURS = Number(arg("hours", 5));
const SKIP = Number(arg("skip", 1));
const W0S = arg("w0", Array.from({ length: 17 }, (_, k) => 10 ** (6 + k / 2)).join(",")).split(",").map(Number);
const JOBS = Number(arg("jobs", 8));
const BIN = Number(arg("bin", 0.5)); // decades

/** One (regime, W0): every seed's per-interval observations {lw, x}. */
async function runOne(w0) {
  const { Market } = await import("./market.mjs");
  const { runNew } = await import("./strategies.mjs");
  const use4S = REGIME.startsWith("4S");
  const out = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const m = new Market({ seed: 7000 + seed, money: w0, burnInTicks: 0 });
    const r = runNew(m, Math.round(HOURS * 600), { use4S, opt: { freshTicks: 0 } });
    const p = [w0, ...r.path];
    for (let i = Math.round(SKIP * 10); i + 1 < p.length; i++) {
      if (!(p[i] > 0 && p[i + 1] > 0)) continue;
      out.push({ seed, lw: Math.log10(p[i]), x: Math.log(p[i + 1] / p[i]) / 0.1 });
    }
  }
  return out;
}

if (process.argv.includes("--child")) {
  const obs = await runOne(Number(arg("child-w0")));
  process.stdout.write(JSON.stringify(obs));
  process.exit(0);
}

function child(w0) {
  return new Promise((res, rej) => {
    const args = [fileURLToPath(import.meta.url), "--child", "--child-w0", String(w0), "--regime", REGIME, "--seeds", String(SEEDS), "--hours", String(HOURS), "--skip", String(SKIP)];
    const p = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "inherit"] });
    let s = "";
    p.stdout.on("data", (d) => (s += d));
    p.on("close", (code) => (code === 0 ? res(JSON.parse(s).map((o) => ({ ...o, w0 }))) : rej(new Error(`w0 ${w0}: exit ${code}`))));
  });
}

const t0 = Date.now();
const all = [];
const queue = [...W0S];
await Promise.all(
  Array.from({ length: JOBS }, async () => {
    while (queue.length) {
      const w0 = queue.shift();
      all.push(...(await child(w0)));
    }
  }),
);
// Bin by book: half-decade bins centred on the grid.
const bins = new Map();
for (const o of all) {
  const b = Math.round(o.lw / BIN) * BIN;
  if (!bins.has(b)) bins.set(b, []);
  bins.get(b).push(o);
}
const rows = [];
for (const [b, os] of [...bins].sort((a, c) => a[0] - c[0])) {
  const mean = os.reduce((s, o) => s + o.x, 0) / os.length;
  // A life's spread: per (w0, seed) run's bin mean, their sd.
  const runs = new Map();
  for (const o of os) {
    const k = `${o.w0}:${o.seed}`;
    if (!runs.has(k)) runs.set(k, []);
    runs.get(k).push(o.x);
  }
  const rm = [...runs.values()].filter((xs) => xs.length >= 5).map((xs) => xs.reduce((s, x) => s + x, 0) / xs.length);
  const rmMean = rm.length ? rm.reduce((s, x) => s + x, 0) / rm.length : null;
  const between = rm.length > 1 ? Math.sqrt(rm.reduce((s, x) => s + (x - rmMean) ** 2, 0) / (rm.length - 1)) : null;
  // Interval noise per unit hour: var(x) x dt.
  const within = Math.sqrt((os.reduce((s, o) => s + (o.x - mean) ** 2, 0) / Math.max(1, os.length - 1)) * 0.1);
  rows.push({ log10W: b, W: 10 ** b, n: os.length, runs: rm.length, r: +mean.toFixed(4), betweenSd: between === null ? null : +between.toFixed(4), sigmaPerSqrtH: +within.toFixed(4) });
}
const res = { regime: REGIME, seeds: SEEDS, hours: HOURS, skipH: SKIP, burnIn: 0, at: new Date().toISOString(), secs: Math.round((Date.now() - t0) / 1000), rows };
if (arg("json", null)) fs.writeFileSync(arg("json"), JSON.stringify(res, null, 1));
console.log(`r(W), ${REGIME}: ${SEEDS} seeds x ${HOURS}h from each W0 (skip ${SKIP}h), fresh market; ln-growth/h by book`);
for (const r of rows) console.log(`  $${r.W.toExponential(1).padStart(8)}  r ${(r.r * 100).toFixed(1).padStart(6)}%/h  n ${String(r.n).padStart(5)}  runs ${String(r.runs).padStart(3)}  between-life sd ${r.betweenSd === null ? "-" : (r.betweenSd * 100).toFixed(1) + "%/h"}  sigma ${r.sigmaPerSqrtH}`);
console.log(`(${res.secs}s)`);
