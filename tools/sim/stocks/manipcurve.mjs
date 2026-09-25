// The trader's return as a function of the forecast-nudge rate the batcher
// delivers — the source of stockplan.MANIP_TABLE, which stock.js publishes as
// `manipCurve` (nodeecon.js contract; expfarm.manipVerdict consumes it).
//
// A "nudge" is one moneyMax-fraction moved by a {stock:true} grow (long) or
// hack (short) on the company's server: PlayerInfluencing.ts moves the
// second-order forecast by 0.1 with chance moved/moneyMax, so nudges/s is
// exactly what batch.js manipCost sums as `nu`. The harness applies them,
// through the game's own influenceStockThroughServerGrow/Hack, to the LARGEST
// position — the same single company stock.js publishes in `manip`.
//
//   node tools/sim/stocks/manipcurve.mjs [--seeds 8] [--hours 2] [--use4S]
//
// CALIBRATION: NOT CALIBRATED against the live game — no live manipulation
// has been measured. Every mechanic is the game's own code; what is not
// modelled is how evenly the batcher's nudges arrive (here: spread evenly
// over each 6s tick, in ops of 0.5 moneyMax).

import { Market } from "./market.mjs";
import { runNew } from "./strategies.mjs";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const SEEDS = Number(arg("seeds", 8));
const HOURS = Number(arg("hours", 2));
const use4S = process.argv.includes("--use4S");
export const CAPS = [1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13];
export const NUDGES_PER_TICK = [0, 0.25, 1, 3, 10];

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = {};
  for (const n of NUDGES_PER_TICK) {
    rows[n] = CAPS.map((cap) => {
      const g = [];
      for (let seed = 1; seed <= SEEDS; seed++) {
        const m = new Market({ seed, money: cap, burnInTicks: 3000 });
        runNew(m, Math.round(HOURS * 600), { use4S, manip: n });
        g.push(Math.log(m.wealth() / cap) / HOURS);
      }
      return +median(g).toFixed(3);
    });
    console.error(`nudges/tick ${n}: ${rows[n].join(", ")}`);
  }
  console.log(JSON.stringify({ mode: use4S ? "4S-long" : "pre-long", seeds: SEEDS, hours: HOURS, caps: CAPS, nudgesPerSec: NUDGES_PER_TICK.map((n) => n / 6), lnPerHour: NUDGES_PER_TICK.map((n) => rows[n]) }));
  process.exit(0);
}
