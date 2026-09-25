// Which manipulation policy, when the batcher can only serve SOME companies
// (root + hacking level; live on 2026-09-25: hacking 300, so FNS/SGC/JGN/OMGA).
// Same seeds, same markets; median ln-growth/h:
//   largest       request manip on the largest position (stock.js before this);
//                 an unservable request delivers nothing
//   servable      request it on the largest SERVABLE position
//   servable+kX   ...and credit servable companies manipBoostPerNudge = X
//                 otlkMag points per nudge/s when choosing positions
//
//   node tools/sim/stocks/servable.mjs [--level 300] [--nudges 1] [--seeds 10] [--hours 2] [--caps 3e7,2.5e8,2e9] [--ks 5,15,40]
// CALIBRATION: NOT CALIBRATED against the live game — no live manipulation has
// been measured; the servable set uses the midpoint required hacking level.
import { Market } from "./market.mjs";
import { runNew } from "./strategies.mjs";
import { reqSkill } from "./reqskill.mjs";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const LEVEL = Number(arg("level", 300));
const NUDGES = Number(arg("nudges", 1)); // per tick
const SEEDS = Number(arg("seeds", 10));
const HOURS = Number(arg("hours", 2));
const CAPS = arg("caps", "3e7,2.5e8,2e9").split(",").map(Number);
const KS = arg("ks", "5,15,40").split(",").map(Number);

export function servableAt(level) {
  const req = reqSkill();
  return new Set(Object.entries(req).filter(([, l]) => l <= level).map(([s]) => s));
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
export function growth(cap, o, { seeds = SEEDS, hours = HOURS, nudges = NUDGES, servable } = {}) {
  const g = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const m = new Market({ seed, money: cap, burnInTicks: 3000 });
    runNew(m, Math.round(hours * 600), { manip: nudges, servable, ...o });
    g.push(Math.log(m.wealth() / cap) / hours);
  }
  return median(g);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const servable = servableAt(LEVEL);
  console.log(`hacking ${LEVEL}: servable ${[...servable].join(",")}; ${NUDGES} nudges/tick (${(NUDGES / 6).toFixed(3)}/s); ${SEEDS} seeds x ${HOURS}h`);
  const rows = [["no manip", { manip: 0 }], ["largest k0", { pick: "largest", opt: { manipBoostPerNudge: 0 } }], ["servable k0", { pick: "servable", opt: { manipBoostPerNudge: 0 } }], ...KS.map((k) => [`servable+k${k}`, { pick: "servable", opt: { manipBoostPerNudge: k } }])];
  for (const [name, o] of rows) console.log(name.padEnd(16), CAPS.map((c) => `$${c.toExponential(1)}: ${(growth(c, o, { servable }) * 100).toFixed(1)}%/h`).join("  "));
  process.exit(0);
}
