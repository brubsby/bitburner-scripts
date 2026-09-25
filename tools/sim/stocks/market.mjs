// The REAL stock market, driven tick by tick under node.
//
// Every mechanic below is the game's own function, bundled from
// ~/Repos/bitburner/src by ./build.mjs — nothing is re-typed:
//
//   tick()           StockMarket.ts processStockPrices: the shared v, the up
//                    chance (50±otlkMag)/100, the soft cap, otlkMag drift toward
//                    otlkMagForecast, and every 75 ticks the 45% flip.
//   buy/sell/...     BuyingAndSelling.tsx: ask/bid spread, $100k commission,
//                    maxShares, and processTransactionForecastMovement (the
//                    forecast degradation — v3 has no per-share price impact).
//   influence*()     PlayerInfluencing.ts: hack()/grow() with {stock:true}.
//
// Determinism: the game draws from Math.random, so each Market replaces it
// with a seeded generator for the duration of its ticks. Two markets must not
// be stepped interleaved (they share the one global) — the harness runs them
// one after the other.
//
// What the harness supplies that the game does not: the clock. processStockPrices
// refuses to run until 4s of wall time have passed since the last update
// (msPerStockUpdateMin); `lastUpdate` is zeroed before each tick so a tick is
// one call. That is the only liberty taken, and it changes no market state.

import "./env.mjs";

export const G = await import("./stocks.bundle.mjs");

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CYCLES_PER_TICK = G.StockMarketConstants.msPerStockUpdate / G.CONSTANTS.MilliPerCycle;

/** The minimal Player the transaction functions touch (money, loseMoney, gainMoney). */
function playerStub(money) {
  return {
    money,
    bitNodeN: 8,
    loseMoney(m) {
      this.money -= m;
    },
    gainMoney(m) {
      this.money += m;
    },
  };
}

export class Market {
  constructor({ seed = 1, money = 0, burnInTicks = 0 } = {}) {
    this.rng = mulberry32(seed * 2654435761 + 12345);
    // hack()/grow() influence draws from its OWN stream, so a run with
    // manipulation sees the same market realisation as one without (paired
    // comparison). Statistically the same as the game's single Math.random.
    this.rngInfluence = mulberry32(seed * 40503 + 977);
    this.player = playerStub(money);
    this.withRng(() => {
      G.setPlayer(this.player);
      G.initStockMarket();
    });
    // initStockMarket draws the first cycle's length (1..75); keep it per market.
    this.ticksUntilCycle = G.StockMarket.ticksUntilCycle;
    // Symbol order is the game's own (StockSymbol).
    this.symbols = Object.keys(G.SymbolToStockMap);
    this.stocks = this.symbols.map((s) => G.SymbolToStockMap[s]);
    // SymbolToStockMap is module-level: capture the objects, then detach
    // from the module so a later Market cannot overwrite ours.
    this.bySym = Object.fromEntries(this.symbols.map((s, i) => [s, this.stocks[i]]));
    this.t = 0;
    for (let i = 0; i < burnInTicks; i++) this.tick();
  }

  withRng(fn) {
    const saved = Math.random;
    Math.random = this.rng;
    try {
      return fn();
    } finally {
      Math.random = saved;
    }
  }

  /** One processStockPrices call (6s of game time). */
  tick() {
    this.withRng(() => {
      // processStockPrices reads the module-level StockMarket; point it at ours.
      for (const k of Object.keys(G.StockMarket)) if (G.StockMarket[k] instanceof G.Stock) delete G.StockMarket[k];
      for (const s of this.stocks) G.StockMarket[s.name] = s;
      G.StockMarket.lastUpdate = 0;
      if (this.ticksUntilCycle !== undefined) G.StockMarket.ticksUntilCycle = this.ticksUntilCycle;
      G.StockMarket.storedCycles = 0;
      G.processStockPrices(CYCLES_PER_TICK);
      this.ticksUntilCycle = G.StockMarket.ticksUntilCycle;
    });
    this.t++;
  }

  // --- what a script can read (NetscriptFunctions/StockMarket.ts) ---------
  price(sym) {
    return this.bySym[sym].price;
  }
  ask(sym) {
    return this.bySym[sym].getAskPrice();
  }
  bid(sym) {
    return this.bySym[sym].getBidPrice();
  }
  /** getForecast: 4S only. */
  forecast(sym) {
    const s = this.bySym[sym];
    return (s.b ? 50 + s.otlkMag : 50 - s.otlkMag) / 100;
  }
  /** getVolatility: 4S only (no darknet promotions offline). */
  volatility(sym) {
    return this.bySym[sym].mv / 100;
  }
  position(sym) {
    const s = this.bySym[sym];
    return [s.playerShares, s.playerAvgPx, s.playerShortShares, s.playerAvgShortPx];
  }
  maxShares(sym) {
    return this.bySym[sym].maxShares;
  }
  get money() {
    return this.player.money;
  }

  // --- what a script can do ------------------------------------------------
  // Each binds the game's Player to ours for the call; the functions read the
  // module-level Player (BuyingAndSelling.tsx imports @player).
  txn(fn, sym, n) {
    return this.withRng(() => {
      G.setPlayer(this.player);
      return fn(this.bySym[sym], n, null, { suppressDialog: true });
    });
  }
  buy(sym, n) {
    return this.txn(G.buyStock, sym, n);
  }
  sell(sym, n) {
    return this.txn(G.sellStock, sym, n);
  }
  short(sym, n) {
    return this.txn(G.shortStock, sym, n);
  }
  cover(sym, n) {
    return this.txn(G.sellShort, sym, n);
  }

  /** Liquidation value of every position at the bid/ask the sale would get. */
  positionsValue() {
    let v = 0;
    for (const s of this.stocks) {
      if (s.playerShares > 0) v += G.getSellTransactionGain(s, s.playerShares, "L");
      if (s.playerShortShares > 0) v += G.getSellTransactionGain(s, s.playerShortShares, "S");
    }
    return v;
  }
  wealth() {
    return this.player.money + this.positionsValue();
  }

  /**
   * hack()/grow() with {stock:true} against the company's server: `fraction`
   * of moneyMax moved per op, `ops` ops. PlayerInfluencing.ts draws the
   * chance per op; the harness supplies a Server-shaped object with the two
   * fields those functions read.
   */
  influence(sym, kind, fraction, ops) {
    const s = this.bySym[sym];
    const server = { organizationName: s.name, moneyMax: 1 };
    const saved = this.rng;
    this.rng = this.rngInfluence;
    try {
      this.withRng(() => {
      for (const k of Object.keys(G.StockMarket)) if (G.StockMarket[k] instanceof G.Stock) delete G.StockMarket[k];
      for (const st of this.stocks) G.StockMarket[st.name] = st;
      for (let i = 0; i < ops; i++) {
        if (kind === "grow") G.influenceStockThroughServerGrow(server, fraction);
        else G.influenceStockThroughServerHack(server, fraction);
      }
      });
    } finally {
      this.rng = saved;
    }
  }
}
