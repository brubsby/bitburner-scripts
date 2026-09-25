// Estimator diagnostics against the market's hidden truth (offline only):
// phase found vs the real cycle boundary, and the pre-4S forecast estimate
// against the true forecast, by ticks since the last boundary.
//
//   node tools/sim/stocks/diag.mjs [--seeds 4] [--hours 3]
// CALIBRATION: not a model — it scores the estimator against the market's own
// hidden state (offline truth), which no live reading could replace.

import { Market } from "./market.mjs";
import { pricesOf } from "./strategies.mjs";
import * as S from "../../../stockstrat.js";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const SEEDS = Number(arg("seeds", 4));
const TICKS = Math.round(Number(arg("hours", 3)) * 600);
const opt = JSON.parse(arg("opt", "{}"));

export function diagnose(seed, opt = {}) {
  const m = new Market({ seed, money: 0, burnInTicks: Number(arg("burn", 3000)) });
  const st = S.newState(m.symbols, opt);
  S.observe(st, pricesOf(m));
  let truePhase = null;
  let foundAt = null;
  const errBySince = new Array(75).fill(0).map(() => ({ se: 0, n: 0, sign: 0 }));
  let sinceB = null;
  for (let t = 0; t < TICKS; t++) {
    const before = m.ticksUntilCycle;
    m.tick();
    // The cycle ran inside this tick iff the counter was 1 before it.
    if (before === 1) {
      truePhase = st.t + 1; // observe() is about to number this tick st.t+1
      sinceB = 0;
    } else if (sinceB !== null) sinceB++;
    S.observe(st, pricesOf(m));
    if (st.phase !== null && foundAt === null) foundAt = st.t;
    if (st.phase !== null && sinceB !== null) {
      for (const s of m.symbols) {
        const f = m.forecast(s);
        const fh = S.forecastOf(st, s);
        const e = errBySince[sinceB];
        e.se += (fh - f) ** 2;
        e.n++;
        if (Math.abs(f - 0.5) > 0.05) e.sign += (fh - 0.5) * (f - 0.5) > 0 ? 1 : 0, (e.signN = (e.signN ?? 0) + 1);
      }
    }
  }
  const phaseOk = st.phase !== null && truePhase !== null && ((st.phase - truePhase) % 75 + 75) % 75;
  let volErr = 0;
  for (const s of m.symbols) volErr += Math.abs(S.volOf(st, s) / (m.bySym[s].mv / 100) - 1);
  return { seed, phase: st.phase, truePhaseMod: truePhase === null ? null : ((truePhase % 75) + 75) % 75, phaseOffset: phaseOk, foundAt, volErrPct: (100 * volErr) / m.symbols.length, errBySince };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const agg = new Array(75).fill(0).map(() => ({ se: 0, n: 0, sign: 0, signN: 0 }));
  for (let seed = 1; seed <= SEEDS; seed++) {
    const d = diagnose(seed, opt);
    console.log(`seed ${seed}: phase ${d.phase} true ${d.truePhaseMod} offset ${d.phaseOffset} found at tick ${d.foundAt}; mean |vol err| ${d.volErrPct.toFixed(1)}%`);
    d.errBySince.forEach((e, i) => {
      agg[i].se += e.se;
      agg[i].n += e.n;
      agg[i].sign += e.sign;
      agg[i].signN += e.signN ?? 0;
    });
  }
  console.log("ticks since boundary: rmse(f_hat - f), sign agreement (|f-.5|>.05)");
  for (const i of [0, 1, 2, 3, 5, 8, 12, 20, 30, 50, 74]) console.log(`  ${String(i).padStart(2)}: ${Math.sqrt(agg[i].se / agg[i].n).toFixed(3)}  ${((100 * agg[i].sign) / agg[i].signN).toFixed(1)}%`);
  process.exit(0);
}
