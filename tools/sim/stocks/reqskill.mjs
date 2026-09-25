// Company servers' required hacking level (midpoint of the randomized range in
// Server/data/servers.ts), per stock symbol — which companies a fleet at a
// given hacking level can serve with {stock:true} batches. Used by
// servable.mjs; printed when run.
// CALIBRATION: not a model — game-source data (the live value is drawn in the range).
import { G } from "./market.mjs";
import { SYMBOL_META } from "../../../stockstrat.js";
export function reqSkill() {
  const out = {};
  for (const [sym, m] of Object.entries(SYMBOL_META)) {
    const lv = m.servers.map((h) => {
      const r = G.serverMetadata.find((s) => s.hostname === h)?.requiredHackingSkill;
      return typeof r === "number" ? r : r ? (r.min + r.max) / 2 : Infinity;
    });
    out[sym] = lv.length ? Math.min(...lv) : Infinity;
  }
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(Object.entries(reqSkill()).sort((a, b) => a[1] - b[1]).map(([s, l]) => `${s}:${l}`).join(" "));
  process.exit(0);
}
