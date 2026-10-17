// THE MARKET'S CAPACITY: can ANY trader reach a target wealth, and when?
//
//   node tools/sim/stocks/capacity.mjs [--seeds 8] [--hours 120] [--target 1e17]
//
// The question it answers (2026-10-16, the 5th Covenant sleeve's $1e17 in
// BN10.3): what is the most money the stock market can pay out over a node,
// whatever the strategy and whatever the capital. Every mechanic is the game's
// own code (./market.mjs drives processStockPrices from ~/Repos/bitburner):
//
//   - maxShares = 20% of outstanding (Stock.ts:152), long + short combined:
//     a stock can never carry more than maxShares_i x price_i of book;
//   - transactions do NOT move the price (StockMarketHelpers.ts
//     processTransactionForecastMovement touches otlkMag only), so a trader
//     cannot push prices up to grow its own capacity;
//   - one tick per 6s (Constants.ts msPerStockUpdate), price x (1+av) or
//     / (1+av), av = v x mv/100 (StockMarket.ts processStockPrices);
//   - no BitNode multiplier touches stock returns: the only stock mults are
//     FourSigmaMarketDataCost / FourSigmaMarketDataApiCost (BitNodeMultipliers.ts
//     :84-88), both 1 in BN10 (BitNode.tsx case 10);
//   - DarkNet stock promotions raise mv by at most x4
//     (DarkNet/effects/effects.ts:218-222: 1 + 1 + 2 at infinite charges).
//
// THE BOUND (an upper bound on every trader, generous on purpose):
//   perfect foresight — every tick the book holds maxShares of every stock on
//   the side it is about to move (long+short; shorts need BN8/SF8.2), from
//   tick 0 (no capital ramp), no spread, no commission, no forecast damage:
//       income(t) = sum_i maxShares_i x price_i(t) x |price_i(t+1)/price_i(t) - 1|
//   Long-only perfect foresight takes the up-moves only. x4 is the DarkNet
//   ceiling applied on top (linear in av for small av).
// And the REALISTIC rate: the shipped trader's saturated income r0 x W*
// (traderw.js RW_PRIOR, the sim fit; 4S-long the larger).
//
// CALIBRATION (printed every run, pass or fail):
//   - the capacity: stock.js's capitalCap (stock.txt, the same sum) against the
//     sim's distribution at the live market's age (2026-10-16 BN7.3: $1.41e13
//     at 9.6h, the sim's 92nd percentile, median -42%);
//   - the trader's income: the ledger (/tel/stock-rw.txt) at books >= $1e12
//     against the shipped trader at the same market age and book (2026-10-16,
//     114 4S bins / 74h: the sim -62% per bin hours-weighted geometric, -85% in
//     dollars; the traderw rw-curve -75% / -92%). The sim runs no {stock:true}
//     manipulation and one market draw per seed; the live BN9.3 life that
//     dominates the dollars earned above even the 4S-oracle median. So the
//     shipped column is a LOW estimate (x6.7 to the live dollars); the perfect-
//     foresight column bounds every trader regardless.
// Usage: --seeds 12 --hours 200 --shipped-hours 100 --calib-seeds 8 --calib-hours 40
// (~10 min); --no-live skips the ledger calibration.

import "./env.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Market } from "./market.mjs";
import { RW_PRIOR, rwShape } from "../../../traderw.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? Number(process.argv[i + 1]) : d;
};
const SEEDS = arg("seeds", 8);
const HOURS = arg("hours", 120);
const TARGET = arg("target", 1e17);
const TPH = 600; // ticks per hour (6s)

/** One market life: capacity and the perfect-foresight incomes, per hour. */
export function capacityLife(seed, hours) {
  const m = new Market({ seed });
  const st = m.stocks;
  const rows = [];
  let cumLS = 0;
  let cumL = 0;
  let cum4L = 0;
  for (let h = 0; h < hours; h++) {
    let incLS = 0;
    let incL = 0;
    let inc4LS = 0;
    let inc4L = 0;
    let cap = 0;
    for (let k = 0; k < TPH; k++) {
      const p0 = st.map((s) => s.price);
      // The 4S oracle: the side the forecast (getForecast, read BEFORE the
      // tick) points to, maxShares of it — the most a 4S trader can expect.
      const up = st.map((s) => s.b && s.otlkMag > 0);
      m.tick();
      for (let i = 0; i < st.length; i++) {
        const v = st[i].maxShares * p0[i];
        const r = st[i].price / p0[i] - 1;
        incLS += v * Math.abs(r);
        if (r > 0) incL += v * r;
        inc4LS += v * (up[i] ? r : -r);
        if (up[i]) inc4L += v * r;
      }
    }
    for (const s of st) cap += s.maxShares * s.price;
    cumLS += incLS;
    cumL += incL;
    cum4L += inc4L;
    rows.push({ h: h + 1, cap, incLS, incL, inc4LS, inc4L, cumLS, cumL, cum4L });
  }
  return rows;
}

/**
 * The SHIPPED trader (stockstrat.js via strategies.runNew, 4S, long-only) on
 * an unlimited book: what it actually pays per hour of market age once the
 * capital never binds (BN10.3's hacking fills the ~$6e12 capacity in
 * seconds). Wealth is liquidation value (bid, net of the sale).
 */
export async function shippedSaturated(seed, hours, W0 = 1e16, use4S = true) {
  const { runNew } = await import("./strategies.mjs");
  const m = new Market({ seed, money: W0 });
  const r = runNew(m, hours * TPH, { use4S });
  const p = [W0, ...r.path]; // every 0.1h
  const inc = [];
  for (let h = 0; h < hours; h++) inc.push(p[(h + 1) * 10] - p[h * 10]);
  inc.W = Array.from({ length: hours }, (_, h) => p[h * 10]);
  return inc;
}

/**
 * THE LIVE CALIBRATION of the trader's income against market AGE (hours since
 * the install that re-initialised the market, Prestige.ts:166-170) and book.
 * The ledger (/tel/stock-rw.txt, bayes.rwLedgerOf: per run, per 0.1-decade
 * book bin, P/X/XX/LW/n/h) carries no age, so each run's start age is read
 * from history.jsonl (playtimeSinceLastAug at the run's firstAt) and a bin's
 * age is start + the ledger's skipped first hour + the hours of the run's
 * smaller-book bins (the book grows within a run). The sim side: the shipped
 * trader from W0 in {1e12..1e15} on fresh markets, every hour's (age, book,
 * $/h); a live bin is compared with the median over seeds at its hour and the
 * W0 path nearest its book in ln W.
 */
async function ageAtOf(histPath, times) {
  const readline = await import("node:readline");
  const want = [...new Set(times)].sort();
  const out = new Map();
  if (!want.length || !fs.existsSync(histPath)) return out;
  const rl = readline.createInterface({ input: fs.createReadStream(histPath) });
  let i = 0;
  for await (const line of rl) {
    if (i >= want.length) break;
    const at = line.slice(7, 31);
    if (at < want[i]) continue;
    const j = JSON.parse(line);
    while (i < want.length && want[i] <= at) out.set(want[i++], { bn: j.bitNode, ageH: j.playtimeSinceLastAug / 3.6e6 });
  }
  rl.close();
  return out;
}

export async function liveCalibration({ tel, seeds = 8, hours = 40, log = console.log } = {}) {
  const fmt = (x) => x.toExponential(2);
  let led;
  try {
    led = JSON.parse(fs.readFileSync(path.join(tel, "stock-rw.txt"), "utf8"));
  } catch {
    log(`LIVE CALIBRATION: NOT RUN — no ${path.join(tel, "stock-rw.txt")}`);
    return null;
  }
  const ages = await ageAtOf(path.join(tel, "history.jsonl"), led.runs.map((r) => r.firstAt).filter(Boolean));
  const W0S = [1e12, 1e13, 1e14, 1e15];
  const res = {};
  for (const reg of ["4S-long", "pre-long"]) {
    const use4S = reg === "4S-long";
    // sim: per W0, per seed, per hour: { W, inc }
    const sim = {};
    for (const w0 of W0S) {
      sim[w0] = [];
      for (let s = 1; s <= seeds; s++) sim[w0].push(await shippedSaturated(100 + s, hours, w0, use4S));
    }
    const simAt = (ageH, W) => {
      const h = Math.min(hours - 1, Math.max(0, Math.floor(ageH)));
      let best = null;
      for (const w0 of W0S) {
        const Wm = med(sim[w0].map((x) => x.W[h]));
        const d = Math.abs(Math.log(Wm / W));
        if (!best || d < best.d) best = { d, w0, Wm };
      }
      return { inc: med(sim[best.w0].map((x) => x[h])), Wm: best.Wm };
    };
    const prior = RW_PRIOR[reg];
    const rows = [];
    for (const r of led.runs.filter((r) => r.regime === reg)) {
      const a0 = ages.get(r.firstAt);
      if (!a0) continue;
      const bins = Object.values(r.bins)
        .filter((c) => c[0] > 0)
        .map((c) => ({ W: 10 ** (c[3] / c[0]), x: c[1] / c[0], h: c[5], n: c[4] }))
        .sort((a, b) => a.W - b.W);
      let cum = 0;
      for (const b of bins) {
        const age = a0.ageH + (prior.skipH ?? 1) + cum + b.h / 2;
        cum += b.h;
        if (b.W < 1e12 || age >= hours) continue; // the question is the saturated book
        const s = simAt(age, b.W);
        const rw = prior.r0PerHour * rwShape(b.W, prior.Wstar, prior.shape) * b.W;
        rows.push({ run: r.id, bn: r.node, age, W: b.W, h: b.h, meas: b.x * b.W, sim: s.inc, rw });
      }
    }
    // hours-weighted mean of ln(model / measured) over bins where both are positive
    const err = (k) => {
      let sw = 0;
      let s = 0;
      for (const x of rows) if (x.meas > 0 && x[k] > 0) (sw += x.h), (s += x.h * Math.log(x[k] / x.meas));
      return sw > 0 ? Math.exp(s / sw) - 1 : null;
    };
    const tot = (k) => rows.reduce((a, x) => a + x.h * x[k], 0);
    log(`\nLIVE CALIBRATION ${reg}: ${rows.length} ledger bins at book >= $1e12 and age < ${hours}h (${rows.reduce((a, x) => a + x.h, 0).toFixed(1)}h of trading)`);
    log(`  run BN   age h   book      hours  measured $/h  sim(age,W) $/h  rw-curve $/h`);
    for (const x of rows) log(`  ${String(x.run).padStart(3)} ${String(x.bn).padStart(3)} ${x.age.toFixed(1).padStart(6)}  ${fmt(x.W)}  ${x.h.toFixed(2).padStart(5)}  ${fmt(x.meas).padStart(11)}  ${fmt(x.sim).padStart(13)}  ${fmt(x.rw).padStart(11)}`);
    const eS = err("sim");
    const eR = err("rw");
    log(`  money earned over these bins: measured ${fmt(tot("meas"))}, sim at (age, book) ${fmt(tot("sim"))} (${((tot("sim") / tot("meas") - 1) * 100).toFixed(0)}%), traderw rw-curve ${fmt(tot("rw"))} (${((tot("rw") / tot("meas") - 1) * 100).toFixed(0)}%)`);
    log(`  geometric-mean error per bin (hours-weighted, model/measured - 1): sim at (age, book) ${eS === null ? "n/a" : (100 * eS).toFixed(0) + "%"}, rw-curve (fresh 5h markets, no age) ${eR === null ? "n/a" : (100 * eR).toFixed(0) + "%"}`);
    res[reg] = { rows, errSim: eS, errRw: eR, earned: { meas: tot("meas"), sim: tot("sim"), rw: tot("rw") } };
  }
  return res;
}

const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const lives = [];
  for (let s = 1; s <= SEEDS; s++) lives.push(capacityLife(s, HOURS));
  const fmt = (x) => x.toExponential(2);
  console.log(`MARKET CAPACITY (game source, ${SEEDS} fresh markets x ${HOURS}h, medians over seeds)`);
  const SH = Math.min(HOURS, arg("shipped-hours", 24));
  const shipped = [];
  for (let s = 1; s <= SEEDS; s++) shipped.push(await shippedSaturated(s, SH));
  const cumShip = shipped.map((inc) => inc.reduce((a, x, i) => (a.push((a[i - 1] ?? 0) + x), a), []));
  console.log(`hour  capacity sum(maxShares x price)  PF long+short $/h   PF long $/h   4S-oracle L+S $/h  4S-oracle L $/h  shipped 4S $/h | cum PF L+S   cum PF L   cum 4S-oracle L  cum shipped`);
  for (const h of [1, 2, 6, 12, 24, 48, 61, 96, HOURS].filter((x) => x <= HOURS)) {
    const r = lives.map((l) => l[h - 1]);
    const sh = h <= SH ? fmt(med(shipped.map((x) => x[h - 1]))) : "-";
    const csh = h <= SH ? fmt(med(cumShip.map((x) => x[h - 1]))) : "-";
    console.log(
      `${String(h).padStart(4)}  ${fmt(med(r.map((x) => x.cap))).padStart(30)}  ${fmt(med(r.map((x) => x.incLS))).padStart(16)}  ${fmt(med(r.map((x) => x.incL))).padStart(12)}  ${fmt(med(r.map((x) => x.inc4LS))).padStart(16)}  ${fmt(med(r.map((x) => x.inc4L))).padStart(15)}  ${sh.padStart(14)} | ${fmt(med(r.map((x) => x.cumLS)))}  ${fmt(med(r.map((x) => x.cumL)))}  ${fmt(med(r.map((x) => x.cum4L))).padStart(15)}  ${csh}`,
    );
  }
  const last = lives.map((l) => l[HOURS - 1]);
  const maxCum = Math.max(...last.map((x) => x.cumLS));
  const rateLS = med(last.map((x) => x.cumLS / HOURS));
  console.log(`\nbest seed, perfect foresight long+short, ${HOURS}h: ${fmt(maxCum)}  (x4 DarkNet ceiling: ${fmt(4 * maxCum)})`);
  console.log(`hours to ${fmt(TARGET)} at the median PF long+short rate ${fmt(rateLS)}/h: ${fmt(TARGET / rateLS)} h (x4 DarkNet: ${fmt(TARGET / (4 * rateLS))} h)`);
  for (const [k, p] of Object.entries(RW_PRIOR)) {
    const sat = p.r0PerHour * p.Wstar;
    console.log(`shipped trader ${k}: saturated r0 x W* = ${fmt(sat)}/h = ${fmt(sat / 3600)}/s -> ${fmt(TARGET / sat)} h to ${fmt(TARGET)}`);
  }
  // THE CAPACITY'S CALIBRATION: stock.js's capitalCap (sum maxShares x price,
  // the same quantity) against the sim's distribution at the live market's age.
  const tel = [path.join(HERE, "../../../.telemetry"), "/home/tbusby/Repos/bitburner-scripts/.telemetry"].find((d) => fs.existsSync(path.join(d, "stock.txt")));
  if (!tel) console.log("CAPACITY CALIBRATION: NOT RUN — no .telemetry/stock.txt");
  else {
    const j = JSON.parse(fs.readFileSync(path.join(tel, "stock.txt"), "utf8"));
    const ageH = (Date.parse(j.at) - j.lastAugReset) / 3.6e6;
    const h = Math.min(HOURS, Math.max(1, Math.round(ageH)));
    const caps = lives.map((l) => l[h - 1].cap).sort((a, b) => a - b);
    const q = caps.filter((c) => c <= j.capitalCap).length / caps.length;
    console.log(`\nCAPACITY CALIBRATION: live capitalCap ${fmt(j.capitalCap)} at market age ${ageH.toFixed(1)}h (stock.txt ${j.at}); sim at ${h}h: median ${fmt(med(caps))}, range ${fmt(caps[0])}-${fmt(caps[caps.length - 1])}; live sits at the sim's ${(100 * q).toFixed(0)}th percentile (model median/live - 1 = ${((med(caps) / j.capitalCap - 1) * 100).toFixed(0)}%)`);
    if (!process.argv.includes("--no-live")) await liveCalibration({ tel, seeds: arg("calib-seeds", 8), hours: arg("calib-hours", 40) });
  }
  process.exit(0);
}
