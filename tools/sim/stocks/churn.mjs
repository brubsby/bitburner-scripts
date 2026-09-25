// Order rate and growth of the SHIPPED stock.js under live-like conditions:
// started mid-market (a restart: no phase, no posterior), small capital,
// pre-4S, and an outside drain on cash like the one live BN8 has — crime
// hospitalisation calls Player.loseMoney with no balance check
// (PlayerObjectGeneralMethods.ts:281-283), so home cash goes NEGATIVE
// between trader ticks (seen live 2026-09-25 14:01-14:20: -$17k..-$47k).
//
//   node tools/sim/stocks/churn.mjs [--seeds 6] [--hours 1] [--caps 1e7,3e7] [--drain 150000] [--every 20]
//
// CALIBRATION: live order rate on 2026-09-25 (a4fc5ef stock.js, $39m -> $9.7m):
// 195 orders in ~25 min = ~470 orders/h. This prints the harness figure for
// the same conditions beside it; see calibrationLine() in compare.mjs for the
// return side. The drain size/frequency is NOT CALIBRATED (hospital bills
// depend on the crime and max HP).
import "../../test/gameresolve.mjs";
import { Market } from "./market.mjs";
import { runShipped } from "./shipped.mjs";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};
export const LIVE_ORDERS_PER_H = 470;

export async function churn({ cap, seed, hours = 1, drain = 150e3, every = 20, files = {}, homeRam = 1024 }) {
  const m = new Market({ seed, money: cap, burnInTicks: 3000 + seed * 137 });
  let minCash = Infinity;
  let ourNegative = 0;
  const ticks = Math.round(hours * 600);
  const f = await runShipped(m, ticks, {
    files,
    homeRam,
    onTick: (n) => {
      if (drain > 0 && n % every === 0) m.player.money -= drain;
      minCash = Math.min(minCash, m.money);
    },
  });
  const tel = JSON.parse(f.files["/tel/stock.txt"]);
  return { orders: tel.counters.orders, perH: tel.counters.orders / hours, lg: Math.log(Math.max(1, m.wealth()) / cap) / hours, minCash, refused: tel.counters.refused };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const seeds = Number(arg("seeds", 6));
  const hours = Number(arg("hours", 1));
  const caps = arg("caps", "1e7,3e7").split(",").map(Number);
  const drain = Number(arg("drain", 150e3));
  const every = Number(arg("every", 20));
  console.log(`live (a4fc5ef): ~${LIVE_ORDERS_PER_H} orders/h, wealth $39.4m -> $9.7m in 25 min`);
  for (const cap of caps) {
    const rows = [];
    for (let s = 1; s <= seeds; s++) rows.push(await churn({ cap, seed: s, hours, drain, every }));
    const med = (k) => rows.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
    console.log(`$${cap.toExponential(0)} drain $${drain}/${every} ticks: median ${med("perH").toFixed(0)} orders/h (max ${Math.max(...rows.map((r) => r.perH)).toFixed(0)}), ln-growth ${(med("lg") * 100).toFixed(1)}%/h, min cash $${Math.min(...rows.map((r) => r.minCash)).toFixed(0)}`);
  }
  process.exit(0);
}
