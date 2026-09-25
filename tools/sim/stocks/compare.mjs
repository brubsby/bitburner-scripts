// Strategy comparison on the game's own market code.
//
//   node tools/sim/stocks/compare.mjs [--hours 6] [--seeds 12] [--burn 3000]
//        [--caps 1e6,1e8,1e10,1e12,1e13] [--only name,name] [--json]
//
// For each capital and seed: a fresh market (seeded), `burn` ticks of
// untouched evolution (0 = the market as initStockMarket leaves it, which is
// what BitNode 8's first minutes and every post-install market look like),
// then each strategy trades the SAME market realisation (same seed) for
// `hours`. Reported: median over seeds of $/h = (W_end - W_0)/hours and of
// the log growth rate ln(W_end/W_0)/hours, plus the 25th percentile so a
// strategy that wins on median by gambling shows it.
//
// CALIBRATION: NOT CALIBRATED against the live game — no stock trade had been
// recorded when this was written. calibrationLine() prints the state on every
// run: it reads the live /tel/stock.txt mirror (../../../.telemetry, or the
// main checkout's) and says what it found. Every mechanic is the game's own
// code, so what is uncalibrated is the INPUTS: the market's current state (a
// live market may sit anywhere in its distribution) and our tick cadence.

import { Market } from "./market.mjs";
import { runNew, runLegacy, runCash } from "./strategies.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const HOURS = Number(arg("hours", 6));
const SEEDS = Number(arg("seeds", 12));
const BURN = Number(arg("burn", 3000));
const CAPS = arg("caps", "1e6,1e7,1e8,1e9,1e10,1e11,1e12,1e13").split(",").map(Number);
const ONLY = arg("only", null)?.split(",");
const JSON_OUT = process.argv.includes("--json");
const TICKS = Math.round(HOURS * 600);

const WINDOW = { estimator: "beta", phaseMargin: Infinity, preWindow: 51, flipExit: false };
export const STRATEGIES = {
  cash: (m) => runCash(m, TICKS),
  "legacy-4S": (m) => runLegacy(m, TICKS),
  "new-4S-long": (m) => runNew(m, TICKS, { use4S: true }),
  "new-4S-ls": (m) => runNew(m, TICKS, { use4S: true, canShort: true }),
  // Prior art's pre-4S estimator (stockmaster.js-style): up-fraction over a
  // 51-tick window, no phase model — through the same decision rule.
  "window-pre-long": (m) => runNew(m, TICKS, { opt: WINDOW }),
  "window-pre-ls": (m) => runNew(m, TICKS, { canShort: true, opt: WINDOW }),
  // The Beta-mixture + windowed phase score (first version of this rewrite).
  "beta-pre-ls": (m) => runNew(m, TICKS, { canShort: true, opt: { estimator: "beta" } }),
  "new-pre-long": (m) => runNew(m, TICKS),
  "new-pre-ls": (m) => runNew(m, TICKS, { canShort: true }),
  "new-pre-ls+manip2": (m) => runNew(m, TICKS, { canShort: true, manip: 2 }),
  "new-pre-ls+manip10": (m) => runNew(m, TICKS, { canShort: true, manip: 10 }),
  "new-4S-ls+manip10": (m) => runNew(m, TICKS, { use4S: true, canShort: true, manip: 10 }),
};

const q = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
};
const fmt = (x) => {
  const a = Math.abs(x);
  const u = [[1e15, "q"], [1e12, "t"], [1e9, "b"], [1e6, "m"], [1e3, "k"]].find(([v]) => a >= v);
  return u ? `${(x / u[0]).toFixed(2)}${u[1]}` : x.toFixed(0);
};

export function compare({ caps = CAPS, seeds = SEEDS, only = ONLY, burn = BURN } = {}) {
  const names = Object.keys(STRATEGIES).filter((n) => !only || only.includes(n));
  const res = {};
  for (const cap of caps) {
    res[cap] = {};
    for (const n of names) {
      const rows = [];
      for (let seed = 1; seed <= seeds; seed++) {
        const m = new Market({ seed, money: cap, burnInTicks: burn });
        const r = STRATEGIES[n](m);
        const w = m.wealth();
        rows.push({ dph: (w - cap) / HOURS, lg: Math.log(Math.max(w, 1) / cap) / HOURS, ...(r.phase !== undefined ? { phase: r.phase } : {}) });
      }
      res[cap][n] = {
        dph: q(rows.map((r) => r.dph), 0.5),
        dph25: q(rows.map((r) => r.dph), 0.25),
        lg: q(rows.map((r) => r.lg), 0.5),
        phaseFound: rows.filter((r) => r.phase !== undefined && r.phase !== null).length,
      };
    }
  }
  return { names, res };
}

export async function calibrationLine() {
  const { growthRate } = await import("../../../stockplan.js");
  const cands = [path.join(HERE, "../../../.telemetry/stock.txt"), path.join(process.env.HOME ?? "", "Repos/bitburner-scripts/.telemetry/stock.txt")];
  for (const f of cands) {
    let t;
    try {
      t = JSON.parse(fs.readFileSync(f, "utf8"));
    } catch {
      continue;
    }
    const W = (t.cash ?? 0) + (t.equity ?? t.positionsValue ?? 0);
    const regime = `${/4S/.test(t.mode ?? "") && !/pre/.test(t.mode ?? "") ? "4S" : "pre"}-${t.canShort ? "ls" : "long"}`;
    const pred = growthRate(regime, W);
    const meas = typeof t.returnPerSec === "number" ? t.returnPerSec * 3600 : null;
    const age = (Date.now() - Date.parse(t.at ?? "")) / 60e3;
    const err = pred && meas !== null ? ((100 * (meas - pred)) / pred).toFixed(1) + "%" : "n/a";
    const oph = t.counters?.ticks > 0 ? t.counters.orders / (t.counters.ticks / 600) : null;
    const orderLine = oph === null ? "order rate unmeasured" : `orders ${oph.toFixed(0)}/h live vs ~10-40/h in the harness (tools/sim/stocks/churn.mjs, $10-30m pre-4S) — error ${(oph / 25).toFixed(1)}x`;
    return `${orderLine}\nCALIBRATION (live ${f}, ${age.toFixed(0)} min old, ${t.calibration?.ticks ?? "?"} ticks in the window): measured ${meas === null ? "unmeasured" : (meas * 100).toFixed(1) + "%/h"} vs harness ${pred === null ? "n/a" : (pred * 100).toFixed(1) + "%/h"} (${regime} at $${fmt(W)}) — error ${err}. One hour of one market is noisy (seed p25..p75 spans roughly +-40%); a sustained error beyond that means the harness is wrong.`;
  }
  return "CALIBRATION: NOT CALIBRATED — no live /tel/stock.txt mirror found; every mechanic is the game's own code, the market state and cadence are not";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t0 = Date.now();
  console.log(await calibrationLine());
  const { names, res } = compare();
  if (JSON_OUT) console.log(JSON.stringify({ hours: HOURS, seeds: SEEDS, burn: BURN, res }, null, 1));
  else {
    console.log(`median over ${SEEDS} seeds, ${HOURS}h each, burn-in ${BURN} ticks; cells: $/h median (p25) | ln-growth %/h`);
    console.log(["strategy".padEnd(22), ...CAPS.map((c) => `$${fmt(c)}`.padStart(26))].join(""));
    for (const n of names) {
      console.log(
        [n.padEnd(22), ...CAPS.map((c) => {
          const r = res[c][n];
          return `${fmt(r.dph)} (${fmt(r.dph25)}) | ${(r.lg * 100).toFixed(1)}%`.padStart(26);
        })].join(""),
      );
    }
    console.log(`(${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  process.exit(0);
}
