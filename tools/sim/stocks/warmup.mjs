// The trader's first hour after a market (re)start — the post-install warm-up.
// Fresh market = initStockMarket's state (every install and node entry,
// Prestige.ts), the trader starting `k` ticks later (k uniform 0..30: boot,
// watchdog). Reports percentiles of P&L (fraction of starting capital) at
// 0.5h and 1h for each variant, on the SAME market realisations.
//
//   node tools/sim/stocks/warmup.mjs [--seeds 40] [--cap 2.5e8] [--restart]
//   --restart: a mid-market restart (a deploy) instead of a fresh market.
//
// CALIBRATION: live /tel/stock-hist.txt (2026-09-26, BN8, $250-430m): first
// 30 min lifePnl over 6 lives -85.9, -85.3, -63.2(15 min), -51.3, -38.1, -38.0m
// and one +23.7m (8 min) — tools/sim/stocks/warmup-live.mjs prints them.
import { Market } from "./market.mjs";
import { runNew } from "./strategies.mjs";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const q = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
};

export function warmup(variant, { seeds = 40, cap = 2.5e8, restart = false, seed0 = 900 } = {}) {
  const rows = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const k = (seed * 7) % 31;
    const m = new Market({ seed: seed0 + seed, money: cap, burnInTicks: restart ? 3000 + k : k });
    const opt = typeof variant === "function" ? variant(k, restart) : variant;
    const r = runNew(m, 600, { opt });
    // path holds wealth every 60 ticks: index 2 = 0.5h (tick 180? no: 60-tick steps) -> 0.5h = 300 ticks = index 4
    rows.push({ h05: r.path[4] / cap - 1, h1: r.path[9] / cap - 1 });
  }
  const pct = (key) => ({ p10: q(rows.map((r) => r[key]), 0.1), p25: q(rows.map((r) => r[key]), 0.25), p50: q(rows.map((r) => r[key]), 0.5) });
  return { rows, h05: pct("h05"), h1: pct("h1") };
}

export const VARIANTS = {
  "before (no prior, trades pre-phase)": () => ({}),
  "wait for phase": () => ({ waitForPhase: true }),
  "init-forecast prior": (k, restart) => (restart ? {} : { freshTicks: k }),
  "init prior + wait for phase": (k, restart) => (restart ? { waitForPhase: true } : { freshTicks: k, waitForPhase: true }),
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const o = { seeds: Number(arg("seeds", 40)), cap: Number(arg("cap", 2.5e8)), restart: process.argv.includes("--restart") };
  console.log(`${o.restart ? "mid-market restart" : "fresh market (install/node entry)"}, $${o.cap.toExponential(1)}, ${o.seeds} seeds, trader starts 0-30 ticks after; P&L as % of capital`);
  console.log("variant".padEnd(34) + "  0.5h p10/p25/p50        1h p10/p25/p50");
  const f = (x) => (x * 100).toFixed(1).padStart(6);
  for (const [name, v] of Object.entries(VARIANTS)) {
    const r = warmup(v, o);
    console.log(name.padEnd(34) + `  ${f(r.h05.p10)}${f(r.h05.p25)}${f(r.h05.p50)}   ${f(r.h1.p10)}${f(r.h1.p25)}${f(r.h1.p50)}`);
  }
  process.exit(0);
}
