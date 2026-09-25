// Strategy runners for the harness: each takes a Market (the game's own code)
// and trades it for `ticks` ticks, returning the wealth path.
//
// A runner sees exactly what a script could read in that regime:
//   pre-4S   prices (getPrice / getAskPrice / getBidPrice), positions, maxShares
//   4S       the same plus getForecast
// and acts only through buyStock / sellStock / buyShort / sellShort.

import { Legacy } from "./legacy.mjs";
import * as S from "../../../stockstrat.js";

export function pricesOf(mkt) {
  const p = {};
  for (const s of mkt.symbols) p[s] = mkt.price(s);
  return p;
}
export function forecastsOf(mkt) {
  const f = {};
  for (const s of mkt.symbols) f[s] = mkt.forecast(s);
  return f;
}
export function bookOf(mkt, canShort) {
  const positions = {};
  const maxShares = {};
  const ask = {};
  const bid = {};
  for (const s of mkt.symbols) {
    positions[s] = mkt.position(s);
    maxShares[s] = mkt.maxShares(s);
    ask[s] = mkt.ask(s);
    bid[s] = mkt.bid(s);
  }
  return { cash: mkt.money, positions, maxShares, ask, bid, canShort };
}

/** Execute decide()'s orders the way stock.js does: sells, then buys, each checked. */
export function execute(mkt, orders) {
  let failed = 0;
  for (const o of orders) {
    let ok;
    if (o.kind === "sell") ok = mkt.sell(o.sym, o.shares);
    else if (o.kind === "cover") ok = mkt.cover(o.sym, o.shares);
    else if (o.kind === "buy" || o.kind === "short") {
      const px = o.kind === "buy" ? mkt.ask(o.sym) : mkt.bid(o.sym);
      const afford = Math.floor((mkt.money - 100e3) / px);
      const n = Math.min(o.shares, afford);
      ok = n > 0 && (o.kind === "buy" ? mkt.buy(o.sym, n) : mkt.short(o.sym, n));
    }
    if (!ok) failed++;
  }
  return failed;
}

/**
 * Manipulation (BitNode 8 play): `capacity` moneyMax-fractions moved per tick
 * by grow() (longs) / hack() (shorts) with {stock:true}, in ops of `frac`,
 * spent on the largest position whose company has a server — among
 * `servable` symbols when given (the batcher can only hit servers it has root
 * on and the hacking level for). `pick` = the target the TRADER requests:
 *   'largest'  its largest position with a server (stock.js before
 *              servability — an unservable request delivers nothing)
 *   'servable' its largest position among the servable companies
 */
export function manipTarget(mkt, servable = null, pick = "servable") {
  let best = null;
  for (const s of mkt.symbols) {
    if (!S.SYMBOL_META[s]?.servers?.length) continue;
    if (pick === "servable" && servable && !servable.has(s)) continue;
    const [L, , Sh] = mkt.position(s);
    const v = (L + Sh) * mkt.price(s);
    if (v > 0 && (!best || v > best.v)) best = { s, v, kind: L >= Sh ? "grow" : "hack" };
  }
  if (best && servable && !servable.has(best.s)) return null; // requested, cannot be served
  return best;
}
function manipulate(mkt, capacity, frac = 0.5, servable = null, pick = "servable") {
  if (!(capacity > 0)) return;
  const best = manipTarget(mkt, servable, pick);
  if (!best) return;
  const ops = Math.floor(capacity / frac);
  const rem = capacity - ops * frac;
  mkt.influence(best.s, best.kind, frac, ops);
  if (rem > 0) mkt.influence(best.s, best.kind, rem, 1);
}

/** The new trader. `use4S`, `canShort`, `opt` (stockstrat DEFAULTS overrides), `manip` capacity. */
export function runNew(mkt, ticks, { use4S = false, canShort = false, opt = {}, manip = 0, servable = null, pick = "servable" } = {}) {
  const st = S.newState(mkt.symbols, opt);
  S.observe(st, pricesOf(mkt), use4S ? forecastsOf(mkt) : null);
  const path = [];
  let failed = 0;
  let trades = 0;
  for (let t = 0; t < ticks; t++) {
    mkt.tick();
    S.observe(st, pricesOf(mkt), use4S ? forecastsOf(mkt) : null);
    const book = bookOf(mkt, canShort);
    // The boost stock.js passes: per servable company, manipBoostPerNudge x
    // the nudges/s being delivered (capacity per tick / 6).
    const k = st.opt.manipBoostPerNudge;
    if (k > 0 && manip > 0) book.boost = Object.fromEntries(mkt.symbols.filter((s) => S.SYMBOL_META[s]?.servers?.length && (!servable || servable.has(s))).map((s) => [s, (k * manip) / 6]));
    const { orders } = S.decide(st, book);
    trades += orders.length;
    failed += execute(mkt, orders);
    manipulate(mkt, manip, 0.5, servable, pick);
    if (t % 60 === 59) path.push(mkt.wealth());
  }
  return { path, failed, trades, phase: st.phase };
}

/** The pre-rewrite stock.js rule (4S), acting every 10.2s of game time. */
export function runLegacy(mkt, ticks) {
  const L = new Legacy(mkt);
  const path = [];
  let lastLoop = -1;
  L.step(mkt);
  for (let t = 0; t < ticks; t++) {
    mkt.tick();
    const loop = Math.floor(((t + 1) * 6) / 10.2);
    if (loop !== lastLoop) {
      lastLoop = loop;
      L.step(mkt);
    }
    if (t % 60 === 59) path.push(mkt.wealth());
  }
  return { path };
}

/** Buy-and-hold nothing: the capital as cash. The zero line. */
export function runCash(mkt, ticks) {
  const path = [];
  for (let t = 0; t < ticks; t++) {
    mkt.tick();
    if (t % 60 === 59) path.push(mkt.wealth());
  }
  return { path };
}
