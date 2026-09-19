// [SP] the stock market entry as a priced decision — stockplan.js.
//
// The failure this prevents: stocks were reachable and never mentioned by the
// economic model (docs/pricing-gaps.md §6). What is pinned: the constants
// against game source, the one-tick return against processStockPrices, and
// that the decision REFUSES until a 4S forecast has actually been read.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import "./gameresolve.mjs";
import { GAME } from "./build-ram.mjs";

const sp = await import("../../stockplan.js");
const { STOCK, TICKS_PER_HOUR, hourlyReturn, bestEdge, entryCost, verdict } = sp;

export async function run() {
  const checks = [];

  // ---------------------------------------------------------------------
  const c1 = new Check("SP1", "constants match StockMarket/data/Constants.ts; the tick model matches processStockPrices");
  {
    const src = fs.readFileSync(path.join(GAME, "src/StockMarket/data/Constants.ts"), "utf8");
    for (const [k, v] of Object.entries(STOCK)) {
      c1.examined(1);
      const m = src.match(new RegExp(`${k}:\\s*([\\d.e]+)`));
      if (!m) c1.fail(`${k} not in Constants.ts`);
      else if (Number(m[1]) !== v) c1.fail(`${k}: module ${v} vs source ${m[1]}`);
    }
    c1.examined(1);
    const sm = fs.readFileSync(path.join(GAME, "src/StockMarket/StockMarket.ts"), "utf8");
    // The shape the return is derived from: av = v*volatility/100, up with chc = (50 +/- otlkMag)/100.
    if (!/let av = \(v \* volatility\) \/ 100;/.test(sm)) c1.fail("the per-tick move av = v*volatility/100 has changed");
    if (!/chc = \(chc \+ stock\.otlkMag\) \/ 100;/.test(sm)) c1.fail("the up-probability (50+otlkMag)/100 has changed");
    if (!/stock\.changePrice\(stock\.price \* \(1 \+ av\)\)/.test(sm)) c1.fail("the up move price*(1+av) has changed");
    if (TICKS_PER_HOUR !== 600) c1.fail(`600 ticks per hour at 6s, got ${TICKS_PER_HOUR}`);
    // E[log return] per tick = (2f-1) * mv/200; per hour x600.
    c1.examined(1);
    if (Math.abs(hourlyReturn(0.7, 2) - 600 * (0.4 * 2) / 200) > 1e-12) c1.fail("hourlyReturn diverges from the one-tick expectation");
    if (hourlyReturn(0.5, 2) !== 0) c1.fail("a coin-flip forecast earns nothing");
    if (!(hourlyReturn(0.3, 2) < 0)) c1.fail("a bearish forecast is negative for a long");
    if (hourlyReturn(1.2, 2) !== null || hourlyReturn(0.7, undefined) !== null) c1.fail("out-of-range or missing inputs refuse");
    c1.note(`forecast 0.7 at mv 2%: ${(hourlyReturn(0.7, 2) * 100).toFixed(1)}%/h expected on a long`);
  }
  checks.push(c1);

  // ---------------------------------------------------------------------
  const c2 = new Check("SP2", "entry cost sums only what is unowned, scaled by the node; the verdict refuses until an edge is READ");
  {
    const node = { FourSigmaMarketDataCost: 1, FourSigmaMarketDataApiCost: 2 };
    c2.examined(1);
    const none = entryCost({ wse: false, tix: false, data4s: false, api4s: false }, node);
    if (none.total !== 200e6 + 5e9 + 1e9 + 50e9) c2.fail(`full entry with API cost x2 must be $56.2b, got ${none.total}`);
    const half = entryCost({ wse: true, tix: true, data4s: false, api4s: false }, node);
    if (half.total !== 1e9 + 50e9 || half.items.length !== 2) c2.fail("owned items must drop out of the entry");
    if (entryCost({ wse: true, tix: true, data4s: true, api4s: true }, node).total !== 0) c2.fail("everything owned costs 0");
    if (entryCost({ wse: true, tix: "yes", data4s: true, api4s: true }, node) !== null) c2.fail("a non-boolean ownership flag must refuse");
    if (entryCost({ wse: true, tix: true, data4s: true, api4s: true }, {}) !== null) c2.fail("missing node multipliers must refuse");

    c2.examined(1);
    const edge = bestEdge([{ symbol: "A", forecast: 0.6, mv: 1 }, { symbol: "B", forecast: 0.35, mv: 3 }], false);
    if (edge.symbol !== "A") c2.fail("without shorting the bearish stock cannot be the edge");
    const edgeS = bestEdge([{ symbol: "A", forecast: 0.6, mv: 1 }, { symbol: "B", forecast: 0.35, mv: 3 }], true);
    if (edgeS.symbol !== "B" || edgeS.side !== "short") c2.fail("with shorting the larger |return| wins as a short");
    if (bestEdge([], true) !== null || bestEdge(null) !== null) c2.fail("no readable stocks is null");

    c2.examined(1);
    const entry = none;
    const unread = verdict({ entry, capital: 1e12, edgePerHour: null, remainingH: 1 });
    if (unread.buy || !unread.unpriced) c2.fail("with no forecast read the verdict must refuse AND flag itself unpriced");
    const yes = verdict({ entry, capital: 1e12, edgePerHour: 0.06, remainingH: 1 });
    if (!yes.buy) c2.fail("$1t at 6%/h for 1h returns $60b against a $56.2b entry: buy");
    const no = verdict({ entry, capital: 1e11, edgePerHour: 0.06, remainingH: 1 });
    if (no.buy) c2.fail("$100b at 6%/h for 1h returns $6b against a $56.2b entry: do not buy");
    for (const [label, o] of [
      ["no capital", { entry, capital: 0, edgePerHour: 0.06, remainingH: 1 }],
      ["no life", { entry, capital: 1e12, edgePerHour: 0.06, remainingH: null }],
      ["no entry", { entry: null, capital: 1e12, edgePerHour: 0.06, remainingH: 1 }],
    ]) {
      c2.examined(1);
      const v = verdict(o);
      if (v.buy || !v.why) c2.fail(`${label}: must refuse with a reason`);
    }
    c2.note(`live BN5 shape: entry $${(none.total / 1e9).toFixed(1)}b; verdict without a read forecast: "${unread.why}"`);
  }
  checks.push(c2);

  return checks;
}
