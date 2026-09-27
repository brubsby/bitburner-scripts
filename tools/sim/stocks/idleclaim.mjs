// Idle claim vs raise-on-demand, as wealth trajectories on the game's own
// market. A claim C is covered (wealth W0 = C x cover); the purchase happens
// after a wait d. Policy IDLE sells C into cash at once and holds it; policy
// RAISE keeps the whole book invested and sells C at purchase time (the raise:
// spread + commissions, the game's own sale functions). Reported per d:
//   RAISE wealth after the purchase / IDLE wealth after the purchase (median, p10)
//   P(RAISE cannot cover C at purchase time) — the purchase would slip.
//
//   node tools/sim/stocks/idleclaim.mjs [--seeds 30] [--cap 1.1e11] [--cover 1.05]
// CALIBRATION: NOT CALIBRATED — pre-4S long, mid-market, no manipulation; live
// return at the time was measured ~93%/h (lead, 2026-09-27) vs harness ~80%/h.
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

export function idleVsRaise({ seeds = 30, cap = 1.1e11, cover = 1.05, waitsH = [0.1, 0.25, 1, 3] } = {}) {
  const C = cap / cover;
  const out = [];
  for (const d of waitsH) {
    const ratio = [];
    const diff = [];
    let short = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      // IDLE: only W0 - C is invested for d; C sits in cash.
      const a = new Market({ seed: 700 + seed, money: cap - C, burnInTicks: 3000 + seed * 11 });
      runNew(a, Math.round(d * 600));
      const idle = a.wealth() + C - C; // + C cash, - C purchase
      // RAISE: everything invested for d, then C is sold for the purchase.
      const b = new Market({ seed: 700 + seed, money: cap, burnInTicks: 3000 + seed * 11 });
      runNew(b, Math.round(d * 600));
      const w = b.wealth(); // liquidation value (bid, commission) — what a raise realises
      if (w < C) short++;
      ratio.push((w - C) / Math.max(1, idle));
      diff.push(w - C - idle);
    }
    out.push({ waitH: d, medRatio: q(ratio, 0.5), p10Ratio: q(ratio, 0.1), medDiff: q(diff, 0.5), p10Diff: q(diff, 0.1), pShort: short / seeds });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const o = { seeds: Number(arg("seeds", 30)), cap: Number(arg("cap", 1.1e11)), cover: Number(arg("cover", 1.05)) };
  console.log(`claim $${(o.cap / o.cover / 1e9).toFixed(0)}b covered ${o.cover}x ($${(o.cap / 1e9).toFixed(0)}b), ${o.seeds} seeds; after-purchase wealth RAISE / IDLE`);
  for (const r of idleVsRaise(o)) console.log(`wait ${String(r.waitH).padStart(4)}h: RAISE-IDLE median $${(r.medDiff / 1e9).toFixed(1)}b (p10 $${(r.p10Diff / 1e9).toFixed(1)}b), ratio median ${r.medRatio.toFixed(2)}x p10 ${r.p10Ratio.toFixed(2)}x, P(raise short of the claim) ${(r.pShort * 100).toFixed(0)}%`);
  process.exit(0);
}
