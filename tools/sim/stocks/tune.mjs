// One-at-a-time parameter sweep of stockstrat DEFAULTS on the game's own
// market, median ln-growth/h over seeds, per capital.
//
//   node tools/sim/stocks/tune.mjs [--hours 2] [--seeds 10] [--caps 2.6e7,1e9,1e11] [--use4S] [--short]
// CALIBRATION: NOT CALIBRATED against the live game (see compare.mjs); it
// ranks settings against each other on identical market realisations.

import { Market } from "./market.mjs";
import { runNew } from "./strategies.mjs";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const HOURS = Number(arg("hours", 2));
const SEEDS = Number(arg("seeds", 10));
const CAPS = arg("caps", "2.6e7,1e9,1e11").split(",").map(Number);
const use4S = process.argv.includes("--use4S");
const canShort = process.argv.includes("--short");
const SWEEP = JSON.parse(
  arg(
    "sweep",
    JSON.stringify({
      entryZ: [0, 0.5, 1, 1.5, 2],
      switchMargin: [0, 0.02, 0.05, 0.1],
      minEdge: [0, 0.02, 0.04],
      flipExit: [false, true],
      diffusion: [0.003, 0.01, 0.03],
      commissionCover: [1, 2, 4],
    }),
  ),
);

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
function score(opt) {
  return CAPS.map((cap) => {
    const g = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const m = new Market({ seed, money: cap, burnInTicks: 3000 });
      runNew(m, Math.round(HOURS * 600), { use4S, canShort, opt });
      g.push(Math.log(m.wealth() / cap) / HOURS);
    }
    return median(g);
  });
}
const base = score({});
console.log(`base: ${base.map((x) => (x * 100).toFixed(1)).join(" / ")} %/h at caps ${CAPS.join(", ")}`);
for (const [k, vals] of Object.entries(SWEEP)) {
  for (const v of vals) {
    const s = score({ [k]: v });
    console.log(`${k}=${JSON.stringify(v)}: ${s.map((x, i) => `${(x * 100).toFixed(1)}(${((x - base[i]) * 100).toFixed(1)})`).join(" / ")}`);
  }
}
process.exit(0);
