// The stationary distribution of the forecast f across stocks, measured on the
// game's own market code — the prior the pre-4S HMM starts from
// (stockstrat.js F_PRIOR). Sampled every 50 ticks from tick 3000 to 30000
// over 20 seeds, symmetrised (f and 1-f are equally likely by the flip), in
// 5-point bins of |f-0.5|*100.
//
//   node tools/sim/stocks/fprior.mjs
// CALIBRATION: not a model — a measurement of the game's own market code. The
// live game cannot show forecasts without 4S, so it is NOT CALIBRATED against
// a live distribution.

import { Market } from "./market.mjs";

export function measurePrior({ seeds = 20, from = 3000, to = 30000, every = 50 } = {}) {
  const bins = new Array(10).fill(0);
  let n = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const m = new Market({ seed: 1000 + seed, money: 0 });
    for (let t = 0; t < to; t++) {
      m.tick();
      if (t >= from && t % every === 0) {
        for (const s of m.symbols) {
          const d = Math.abs(m.forecast(s) - 0.5) * 100;
          bins[Math.min(9, Math.floor(d / 5))]++;
          n++;
        }
      }
    }
  }
  return bins.map((b) => b / n);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const p = measurePrior();
  console.log("|f-0.5|*100 bins of 5:", p.map((x) => x.toFixed(4)).join(", "));
  process.exit(0);
}
