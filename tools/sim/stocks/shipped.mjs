// Run the SHIPPED stock.js main() against the game's own market code.
//
// compare.mjs measures the strategy (stockstrat.js); this measures the script
// that will actually run — its reads, its order execution, its budget and
// liquidation plumbing — through a fake `ns` whose stock surface is the
// Market in ./market.mjs (the real BuyingAndSelling / processStockPrices).
// `ns.stock.nextUpdate()` is one market tick. The run ends by throwing out of
// nextUpdate after `ticks` ticks.
//
//   node tools/sim/stocks/shipped.mjs [--seeds 4] [--hours 2] [--money 2.5e8]
// CALIBRATION: NOT CALIBRATED against a live game — the fake ns is checked only
// against the game's API semantics read from NetscriptFunctions/StockMarket.ts
// (returns 0 on refusal, short gates on BN8/SF8.2, 4S reads throw without it).

import "../../test/gameresolve.mjs";
import { Market } from "./market.mjs";
import { runNew } from "./strategies.mjs";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};

class Stop extends Error {}

export function fakeNs(mkt, { ticks, node = 8, files = {}, onTick = null, sfs = new Map(), has4S = false, homeRam = 1024, lastAugReset = 1 } = {}) {
  const fs = { ...files };
  let n = 0;
  let exitFn = null;
  const player = { has4S };
  const ns = {
    args: [],
    disableLog() {},
    print() {},
    flags: (spec) => Object.fromEntries(spec.map(([k, v]) => [k, v])),
    atExit: (fn) => (exitFn = fn),
    getHostname: () => "home",
    scp: () => true,
    read: (f) => fs[f] ?? "",
    write: (f, d, mode) => (fs[f] = mode === "a" ? (fs[f] ?? "") + d : d),
    getResetInfo: () => ({ currentNode: node, lastAugReset, ownedSF: sfs }),
    getServerMaxRam: () => homeRam,
    getServerMoneyAvailable: () => mkt.money,
    sleep: async () => {},
    stock: {
      getConstants: () => ({ StockMarketCommission: 100e3, MarketDataTixApi4SCost: 25e9 }),
      hasTixApiAccess: () => true,
      has4SDataTixApi: () => player.has4S,
      getSymbols: () => [...mkt.symbols],
      getMaxShares: (s) => mkt.maxShares(s),
      getPrice: (s) => mkt.price(s),
      getAskPrice: (s) => mkt.ask(s),
      getForecast: (s) => {
        if (!player.has4S) throw new Error("You don't have 4S Market Data TIX API Access!");
        return mkt.forecast(s);
      },
      getPosition: (s) => mkt.position(s),
      buyStock: (s, k) => (mkt.buy(s, k) ? mkt.ask(s) : 0),
      sellStock: (s, k) => (mkt.sell(s, k) ? mkt.bid(s) : 0),
      buyShort: (s, k) => {
        if (node !== 8 && !((sfs.get(8) ?? 0) >= 2)) throw new Error("You must either be in BitNode-8 or have Source-File 8.2.");
        return mkt.short(s, k) ? mkt.bid(s) : 0;
      },
      sellShort: (s, k) => {
        if (node !== 8 && !((sfs.get(8) ?? 0) >= 2)) throw new Error("You must either be in BitNode-8 or have Source-File 8.2.");
        return mkt.cover(s, k) ? mkt.ask(s) : 0;
      },
      purchase4SMarketDataTixApi: () => {
        if (player.has4S) return true;
        if (mkt.money < 25e9) return false;
        mkt.player.money -= 25e9;
        player.has4S = true;
        return true;
      },
      nextUpdate: async () => {
        if (n >= ticks) throw new Stop("done");
        mkt.tick();
        n++;
        onTick?.(n, fs);
        return 6000;
      },
    },
  };
  return { ns, files: fs, player, exit: () => exitFn?.(), ticks: () => n };
}

export async function runShipped(mkt, ticks, opts = {}) {
  const { main } = await import("../../../stock.js");
  const f = fakeNs(mkt, { ticks, ...opts });
  try {
    await main(f.ns);
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
  }
  f.exit();
  return f;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const seeds = Number(arg("seeds", 4));
  const hours = Number(arg("hours", 2));
  const money = Number(arg("money", 2.5e8));
  const ticks = Math.round(hours * 600);
  const rows = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const a = new Market({ seed, money, burnInTicks: 3000 });
    const f = await runShipped(a, ticks, { files: {} });
    const tel = JSON.parse(f.files["/tel/stock.txt"]);
    const b = new Market({ seed, money, burnInTicks: 3000 });
    runNew(b, ticks, { canShort: true });
    rows.push({ seed, shipped: a.wealth(), strategy: b.wealth(), health: tel.health, refused: tel.counters.refused, orders: tel.counters.orders, buy4S: tel.buy4S?.why, has4S: f.player.has4S });
    console.log(`seed ${seed}: shipped stock.js $${(a.wealth() / 1e9).toFixed(2)}b vs stockstrat runner $${(b.wealth() / 1e9).toFixed(2)}b | health ${tel.health}, ${tel.counters.orders} orders, ${tel.counters.refused} refused | 4S: ${tel.buy4S?.why}`);
  }
  process.exit(0);
}
