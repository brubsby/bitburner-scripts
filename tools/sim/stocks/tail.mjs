// Tail risk, not just the median: ln-growth/h percentiles (p10, p25, p50),
// per-run max drawdown (median, p90, worst) and the mean share of wealth in
// the single largest position, for sizing variants of the shipped strategy.
// Started mid-market (random burn-in), pre-4S, long-only — the live BN8 regime.
//
//   node tools/sim/stocks/tail.mjs [--seeds 30] [--hours 2] [--cap 2e8] [--variants '{"name":{opt}}']
// CALIBRATION: NOT CALIBRATED — live 2026-09-25 15:15-15:20: -47% in 5 min
// holding NTLK alone; compare the drawdown columns with that.
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
export function tail(opt, { seeds = 30, hours = 2, cap = 2e8, canShort = false, seed0 = 500, burn = null } = {}) {
  const rows = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const m = new Market({ seed: seed0 + seed, money: cap, burnInTicks: burn ?? 3000 + ((seed * 7919) % 5000) });
    const r = runNew(m, Math.round(hours * 600), { opt, trackDD: true, canShort });
    rows.push({ lg: Math.log(Math.max(1, m.wealth()) / cap) / hours, dd: r.maxDD, conc: r.conc ?? 0 });
  }
  return {
    rows,
    p10: q(rows.map((r) => r.lg), 0.1),
    p25: q(rows.map((r) => r.lg), 0.25),
    p50: q(rows.map((r) => r.lg), 0.5),
    ddMed: q(rows.map((r) => r.dd), 0.5),
    ddP90: q(rows.map((r) => r.dd), 0.9),
    ddMax: Math.max(...rows.map((r) => r.dd)),
    conc: q(rows.map((r) => r.conc), 0.5),
  };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const variants = JSON.parse(arg("variants", '{"shipped":{}}'));
  const o = { seeds: Number(arg("seeds", 30)), hours: Number(arg("hours", 2)), cap: Number(arg("cap", 2e8)), burn: arg("burn", null) === null ? null : Number(arg("burn")) };
  console.log(`${o.seeds} seeds x ${o.hours}h at $${o.cap.toExponential(1)}, pre-4S long, mid-market start; ln-growth %/h and drawdown`);
  console.log("variant".padEnd(28) + "p10".padStart(8) + "p25".padStart(8) + "p50".padStart(8) + "  DDmed  DDp90  DDmax  top-share");
  for (const [name, opt] of Object.entries(variants)) {
    const r = tail(opt, o);
    const f = (x) => (x * 100).toFixed(0).padStart(8);
    console.log(name.padEnd(28) + f(r.p10) + f(r.p25) + f(r.p50) + `  ${(r.ddMed * 100).toFixed(0).padStart(4)}%  ${(r.ddP90 * 100).toFixed(0).padStart(4)}%  ${(r.ddMax * 100).toFixed(0).padStart(4)}%  ${(r.conc * 100).toFixed(0)}%`);
  }
  process.exit(0);
}
