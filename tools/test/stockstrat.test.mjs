// [ST] the stock trader — stockstrat.js (pure), stock.js (ns I/O), the 4S
// verdict in stockplan.js — against the game's OWN market code
// (tools/sim/stocks/market.mjs bundles ~/Repos/bitburner/src/StockMarket).
//
// What is pinned, and the failure each prevents:
//   ST1  the constants and the per-symbol table match game source (a drifted
//        shareTxForMovement or server map silently mis-sizes / mis-targets).
//   ST2  THE DECISION: on the same market realisations the shipped rule beats
//        the pre-rewrite stock.js rule (tools/sim/stocks/legacy.mjs) with 4S,
//        and the phase-aware pre-4S estimator beats a plain sliding window.
//        Revert decide()/observe() to either old rule and this goes red.
//   ST3  the shipped stock.js, run through a fake ns on the real market:
//        trades, is never refused, publishes the fields readers need, obeys a
//        pending spend (liquidates, buys nothing) and honours a due claim.
//   ST4  the 4S purchase is a TRAJECTORY comparison (withW vs withoutW on the
//        same inputs), and refuses without a horizon.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import "./gameresolve.mjs";
import { GAME } from "./build-ram.mjs";

const S = await import("../../stockstrat.js");
const SP = await import("../../stockplan.js");
const { Market } = await import("../sim/stocks/market.mjs");
const { runNew, runLegacy } = await import("../sim/stocks/strategies.mjs");
const { symbolMeta } = await import("../sim/stocks/gen-meta.mjs");
const { runShipped } = await import("../sim/stocks/shipped.mjs");

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export async function run() {
  const checks = [];

  // -------------------------------------------------------------------
  const c1 = new Check("ST1", "stockstrat constants and SYMBOL_META match the game source");
  {
    const src = (f) => fs.readFileSync(path.join(GAME, "src", f), "utf8");
    const sm = src("StockMarket/StockMarket.ts");
    c1.examined(1);
    if (!/if \(roll < 0\.45\)/.test(sm) || S.FLIP_CHANCE !== 0.45) c1.fail("the cycle flip chance is no longer 0.45 (StockMarket.ts stockMarketCycle)");
    if (!/TicksPerCycle: 75,/.test(src("StockMarket/data/Constants.ts")) || S.TICKS_PER_CYCLE !== 75) c1.fail("TicksPerCycle is no longer 75");
    if (!/forecastChangePerPriceMovement = 0\.006;/.test(src("StockMarket/StockMarketHelpers.ts")) || S.IMPACT_PER_MOVE !== 0.006) c1.fail("forecastChangePerPriceMovement changed");
    if (!/StockForecastInfluenceLimit = 5;/.test(src("StockMarket/Stock.ts")) || S.IMPACT_FLOOR !== 5) c1.fail("StockForecastInfluenceLimit changed");
    if (!/StockMarketCommission: 100e3/.test(src("StockMarket/data/Constants.ts")) || S.COMMISSION !== 100e3) c1.fail("commission changed");
    if (!/const v = Math\.random\(\);\s*for \(const name of Object\.keys\(StockMarket\)\)/.test(sm)) c1.fail("v is no longer ONE draw shared by every stock per tick — the volatility estimator's premise");
    const truth = symbolMeta();
    for (const [sym, t] of Object.entries(truth)) {
      c1.examined(1);
      const m = S.SYMBOL_META[sym];
      if (!m) c1.fail(`${sym} missing from SYMBOL_META`);
      else if (m.S !== t.S || JSON.stringify(m.servers) !== JSON.stringify(t.servers) || JSON.stringify(m.req) !== JSON.stringify(t.req) || JSON.stringify(m.init) !== JSON.stringify(t.init)) c1.fail(`${sym}: shipped ${JSON.stringify(m)} vs source ${JSON.stringify(t)}`);
    }
    for (const sym of Object.keys(S.SYMBOL_META)) if (!truth[sym]) c1.fail(`${sym} in SYMBOL_META but not in InitStockMetadata`);
  }
  checks.push(c1);

  // -------------------------------------------------------------------
  const c2 = new Check("ST2", "the shipped decision beats the old rules on the game's own market (same seeds)");
  {
    const SEEDS = [1, 2, 3, 4, 5, 6, 7];
    const TICKS = 900; // 1.5h
    const grow = (fn, cap) =>
      SEEDS.map((seed) => {
        const m = new Market({ seed, money: cap, burnInTicks: 3000 });
        fn(m);
        return Math.log(m.wealth() / cap) / (TICKS / 600);
      });
    const legacy = grow((m) => runLegacy(m, TICKS), 1e10);
    const new4S = grow((m) => runNew(m, TICKS, { use4S: true }), 1e10);
    c2.examined(SEEDS.length * 2);
    const ml = median(legacy);
    const mn = median(new4S);
    c2.note(`4S long-only at $10b, ${SEEDS.length} seeds x 1.5h: shipped ${(mn * 100).toFixed(1)}%/h vs pre-rewrite stock.js ${(ml * 100).toFixed(1)}%/h (median ln-growth)`);
    if (!(mn > ml * 1.15)) c2.fail(`the shipped 4S rule does not beat the pre-rewrite stock.js rule by 15%: ${(mn * 100).toFixed(1)} vs ${(ml * 100).toFixed(1)} %/h`, "stockstrat.decide may have been reverted or broken");

    const pre = grow((m) => runNew(m, TICKS, { canShort: true }), 2.5e8);
    const win = grow((m) => runNew(m, TICKS, { canShort: true, opt: { estimator: "beta", phaseMargin: Infinity, preWindow: 51, flipExit: false } }), 2.5e8);
    c2.examined(SEEDS.length * 2);
    const mp = median(pre);
    const mw = median(win);
    c2.note(`pre-4S long+short at $250m (BitNode 8's start): phase-aware ${(mp * 100).toFixed(1)}%/h vs 51-tick window ${(mw * 100).toFixed(1)}%/h`);
    if (!(mp > 0)) c2.fail(`pre-4S median growth is not positive (${(mp * 100).toFixed(1)}%/h) — in BitNode 8 this is the whole income`);
    if (!(mp > mw)) c2.fail(`the phase-aware estimator no longer beats a sliding window (${(mp * 100).toFixed(1)} vs ${(mw * 100).toFixed(1)} %/h)`);
  }
  checks.push(c2);

  // -------------------------------------------------------------------
  const c3 = new Check("ST3", "stock.js (shipped, fake ns on the real market): trades, is never refused, publishes, opens nothing under a stock hold, publishes the nodeecon record, honours a due claim");
  {
    const m = new Market({ seed: 7, money: 2.5e8, burnInTicks: 3000 });
    const f = await runShipped(m, 400, {});
    c3.examined(1);
    const tel = JSON.parse(f.files["/tel/stock.txt"] || "null");
    if (!tel) c3.fail("no /tel/stock.txt written");
    else {
      for (const k of ["mode", "canShort", "phase", "wealth", "cash", "claims", "held", "last", "buy4S", "counters", "lastAugReset", "equity"]) if (!(k in tel)) c3.fail(`/tel/stock.txt lacks '${k}'`);
      if (tel.health !== "stopped" || !tel.exited) c3.fail(`the exit was not published (health ${tel.health})`);
      if (!(tel.counters.orders > 0)) c3.fail("400 ticks at $250m and no order was sent");
      if (tel.counters.refused > 0) c3.fail(`${tel.counters.refused} order(s) refused by the game`, JSON.stringify(tel.last?.refused?.slice(0, 2)));
      if (tel.phase === null) c3.warn("the cycle phase was not found in 400 ticks");
      c3.note(`400 ticks: ${tel.counters.orders} orders, wealth $${(m.wealth() / 1e6).toFixed(0)}m from $250m, phase ${tel.phase}, claims unreadable=${tel.claims?.unreadable}`);
    }

    // /tel/stock-hold.txt (act-liquidate.js, nodeecon.js contract): while it is
    // fresh nothing is OPENED. Simulate the liquidator: sell everything, write
    // the hold, and check no share is held again.
    c3.examined(1);
    const m2 = new Market({ seed: 8, money: 2.5e8, burnInTicks: 3000 });
    let heldBefore = 0;
    let reopened = 0;
    await runShipped(m2, 300, {
      onTick: (n, files) => {
        if (n === 200) {
          for (const s of m2.symbols) {
            const [L, , Sh] = m2.position(s);
            heldBefore += L + Sh;
            if (L > 0) m2.sell(s, L);
            if (Sh > 0) m2.cover(s, Sh);
          }
          files["/tel/stock-hold.txt"] = JSON.stringify({ at: new Date().toISOString(), lastAugReset: 1, by: "act-liquidate.js", why: "install" });
        } else if (n > 200) reopened += m2.symbols.reduce((a, s) => a + m2.position(s)[0] + m2.position(s)[2], 0);
      },
    });
    if (!(heldBefore > 0)) c3.warn("nothing was held when the hold was injected — the hold path was not exercised");
    if (reopened > 0) c3.fail("a position was opened while /tel/stock-hold.txt was fresh");

    // The record nodeecon.js reads.
    c3.examined(1);
    const { stockRecordOf } = await import("../../nodeecon.js");
    const rec = stockRecordOf(tel, 1, Date.parse(tel.at));
    if (!rec.ok) c3.fail(`nodeecon.stockRecordOf refuses /tel/stock.txt: ${rec.why}`);
    for (const k of ["equity", "returnPerSec", "capitalCap", "incomePerSec", "manip"]) if (!(k in tel)) c3.fail(`/tel/stock.txt lacks nodeecon's '${k}'`);
    if (tel.canShort !== false) c3.fail("shorts must be opt-in (--short) until measured live");
    c3.note(`nodeecon record: equity $${(rec.equity / 1e6).toFixed(0)}m, returnPerSec ${rec.returnPerSec?.toExponential(2)}, incomePerSec $${(rec.incomePerSec ?? 0).toFixed(0)}/s, capitalCap $${((rec.capitalCap ?? 0) / 1e12).toFixed(2)}t`);

    // A due claim: with wealth above an augmentation claim, the claim is held as cash.
    c3.examined(1);
    const m3 = new Market({ seed: 9, money: 2.5e8, burnInTicks: 3000 });
    const claim = 1e8;
    // Home at its maximum RAM, so the home claim is 0 and the reserve is the augmentation claim alone.
    const h = await runShipped(m3, 300, {
      homeRam: 2 ** 30,
      files: { "/tel/installgate.txt": JSON.stringify({ lastAugReset: 1, planned: true, plan: { totalCost: claim, buy: [] }, joinClaim: 0 }) },
    });
    const t3 = JSON.parse(h.files["/tel/stock.txt"]);
    // home claim: nextHomeUpgrade(1024GB) — read what the trader itself held.
    const R = t3.claims?.reserve;
    if (!(typeof R === "number" && R >= claim)) c3.fail(`the reserve ${R} does not include the $100m augmentation claim`);
    else if (m3.wealth() >= R && !(m3.money >= R * 0.999)) c3.fail(`wealth $${(m3.wealth() / 1e6).toFixed(0)}m covers the $${(R / 1e6).toFixed(0)}m claim but cash is $${(m3.money / 1e6).toFixed(0)}m`);
    else c3.note(`claim $${(R / 1e6).toFixed(0)}m: cash $${(m3.money / 1e6).toFixed(0)}m of wealth $${(m3.wealth() / 1e6).toFixed(0)}m`);
  }
  checks.push(c3);

  // -------------------------------------------------------------------
  const c4 = new Check("ST4", "the 4S TIX API purchase is a simulated-trajectory comparison");
  {
    c4.examined(1);
    const none = SP.buy4SVerdict({ wealth: 1e12, cost: 25e9, horizonH: null });
    if (none.buy || !/horizon/.test(none.why)) c4.fail("with no horizon the verdict must refuse and say why");
    for (const [W, H] of [[3e10, 1], [5e10, 3], [1e11, 8], [1e12, 1]]) {
      c4.examined(1);
      const v = SP.buy4SVerdict({ wealth: W, cost: 25e9, horizonH: H, canShort: true });
      const withW = SP.wealthAt("4S-ls", W - 25e9, H);
      const withoutW = SP.wealthAt("pre-ls", W, H);
      if (v.withW !== withW || v.withoutW !== withoutW || v.buy !== withW > withoutW) c4.fail(`W=${W} H=${H}: verdict is not withW > withoutW on the same inputs`);
    }
    const t = SP.RATE_TABLE;
    for (const k of ["pre-long", "pre-ls", "4S-long", "4S-ls"]) {
      c4.examined(1);
      if (t[k].length !== t.caps.length) c4.fail(`${k} row length`);
    }
    for (let i = 0; i < t.caps.length; i++) if (!(t["4S-ls"][i] > t["pre-ls"][i])) c4.fail(`at $${t.caps[i]} the 4S rate is not above the pre-4S rate — the table is not what compare.mjs measures`);
    c4.note(`$50b over 3h: ${SP.buy4SVerdict({ wealth: 5e10, cost: 25e9, horizonH: 3, canShort: true }).why}`);
  }
  checks.push(c4);

  // -------------------------------------------------------------------
  const c5 = new Check("ST5", "manipCurve: published, what batch.js/expfarm read, priced on the ONE company stock.js flags, and it earns");
  {
    const { stockRecordOf } = await import("../../nodeecon.js");
    const { rateAt } = await import("../../expfarm.js");
    const m = new Market({ seed: 11, money: 2.5e8, burnInTicks: 3000 });
    const f = await runShipped(m, 300, {});
    const tel = JSON.parse(f.files["/tel/stock.txt"]);
    c5.examined(1);
    const rec = stockRecordOf(tel, 1, Date.parse(tel.at));
    if (!rec.ok || !Array.isArray(rec.manipCurve) || rec.manipCurve.length < 2) c5.fail("nodeecon.stockRecordOf does not yield a manipCurve of >= 2 points", JSON.stringify(tel.manipCurve));
    else {
      const r0 = rateAt(rec.manipCurve, 0);
      const r1 = rateAt(rec.manipCurve, 1);
      if (!(r1 > r0)) c5.fail(`manipCurve does not rise with nudges (r(0)=${r0}, r(1)=${r1})`);
      for (let i = 1; i < rec.manipCurve.length; i++) if (rec.manipCurve[i].returnPerSec < rec.manipCurve[i - 1].returnPerSec) c5.fail("manipCurve decreases somewhere — expfarm would price extra nudges as a loss");
      // r(0) is the unmanipulated harness rate: must agree with RATE_TABLE's within seed noise.
      const g = SP.growthRate("pre-long", m.wealth()) / 3600;
      if (Math.abs(r0 / g - 1) > 0.35) c5.fail(`manipCurve r(0) ${r0.toExponential(2)} vs RATE_TABLE ${g.toExponential(2)} — the two tables disagree by >35%`);
      c5.note(`at $${(m.wealth() / 1e6).toFixed(0)}m: r(0) ${(r0 * 3600 * 100).toFixed(0)}%/h, r(1 nudge/s) ${(r1 * 3600 * 100).toFixed(0)}%/h`);
    }
    c5.examined(1);
    const hosts = Object.keys(tel.manip ?? {});
    const syms = new Set(hosts.map((h) => Object.entries(S.SYMBOL_META).find(([, v]) => v.servers.includes(h))?.[0]));
    if (syms.size > 1) c5.fail(`manip names ${syms.size} companies (${[...syms].join(",")}); the curve is priced on ONE (the largest position)`);
    if (hosts.length && !Object.values(tel.manip).every((v) => v === "grow")) c5.fail("long-only book but manip asks for a hack-side flag");
    // And on a book of three companies, directly: only the largest is named.
    c5.examined(1);
    const { manipOf } = await import("../../stock.js");
    const pos = { JGN: [1e6, 0, 0, 0], FNS: [1e5, 0, 0, 0], ECP: [0, 0, 5e4, 0] };
    const px = { JGN: 100, FNS: 100, ECP: 100 };
    const mo = manipOf(pos, px);
    if (JSON.stringify(mo) !== JSON.stringify({ joesguns: "grow" })) c5.fail(`manipOf on three companies names ${JSON.stringify(mo)}; must be only the largest ({joesguns: 'grow'})`);
    // The harness's claim, re-measured: nudges on the largest position raise the median.
    c5.examined(4);
    const grow = (manip) =>
      median([1, 2, 3, 4].map((seed) => {
        const mk = new Market({ seed, money: 2.5e8, burnInTicks: 3000 });
        runNew(mk, 900, { manip });
        return Math.log(mk.wealth() / 2.5e8);
      }));
    const a = grow(0);
    const b = grow(3);
    if (!(b > a)) c5.fail(`3 nudges/tick on the largest position did not raise median growth (${a.toFixed(2)} -> ${b.toFixed(2)} ln over 1.5h)`);
    c5.note(`harness, $250m, 1.5h: ln-growth ${a.toFixed(2)} unmanipulated vs ${b.toFixed(2)} at 3 nudges/tick; calibration field present: ${"calibration" in tel}`);
    if (!tel.calibration || !("predictedPerSec" in tel.calibration)) c5.fail("/tel/stock.txt lacks the live calibration field");
  }
  checks.push(c5);

  // -------------------------------------------------------------------
  const c6 = new Check("ST6", "manipulation is requested only where the batcher can serve it, and servable companies are priced with the nudges they will get");
  {
    const { servableOf, manipOf } = await import("../../stock.js");
    const now = Date.now();
    const batch = (o = {}) => ({ at: new Date(now).toISOString(), hackingLevel: 300, expFarm: { manip: { serve: true, nudgesPerSec: 0.5, blocked: ["joesguns: not rooted yet"], ...o } } });
    c6.examined(1);
    const sv = servableOf(batch(), now);
    const want = ["FNS", "SGC", "OMGA"];
    for (const x of want) if (!sv.syms.has(x)) c6.fail(`${x} should be servable at hacking 300`);
    for (const x of ["JGN", "VITA", "CTK", "ECP", "WDS"]) if (sv.syms.has(x)) c6.fail(`${x} must not be servable (blocked, level range above 300, or no server)`);
    if (sv.nu !== 0.5) c6.fail("delivered nudges/s not read from a serving batcher");
    if (servableOf(batch({ serve: false }), now).nu !== 0) c6.fail("nudges credited while the batcher is NOT serving");
    const stale = servableOf({ ...batch(), at: new Date(now - 20 * 60e3).toISOString() }, now);
    if (stale.syms.size || !stale.why) c6.fail("a stale batch.txt must leave nothing servable and say why");

    c6.examined(1);
    const pos = { VITA: [1e6, 0, 0, 0], FNS: [1e4, 0, 0, 0], SGC: [0, 0, 0, 0] };
    const mo = manipOf(pos, { VITA: 100, FNS: 100, SGC: 100 }, sv);
    if (JSON.stringify(mo) !== JSON.stringify({ foodnstuff: "grow" })) c6.fail(`largest position unservable (VITA): manip must name the largest SERVABLE one, got ${JSON.stringify(mo)}`);
    const mo2 = manipOf({ VITA: [1e6, 0, 0, 0], FNS: [0, 0, 0, 0], SGC: [0, 0, 0, 0] }, { VITA: 100, FNS: 100, SGC: 100 }, sv, (s) => ({ FNS: 0.55, SGC: 0.6 })[s] ?? 0.5);
    if (JSON.stringify(mo2) !== JSON.stringify({ "sigma-cosmetics": "grow" })) c6.fail(`no servable position held: manip must name the servable company with the best forecast, got ${JSON.stringify(mo2)}`);

    // The pricing, re-measured on paired markets: crediting servable companies
    // (DEFAULTS.manipBoostPerNudge) beats ignoring manipulability at the same nudges.
    c6.examined(10);
    const { servableAt } = await import("../sim/stocks/servable.mjs");
    const servable = servableAt(300);
    const g = (opt) =>
      median(Array.from({ length: 12 }, (_, i) => i + 1).map((seed) => {
        const mk = new Market({ seed, money: 3e7, burnInTicks: 3000 });
        runNew(mk, 1200, { manip: 1, servable, opt });
        return Math.log(mk.wealth() / 3e7) / 2;
      }));
    const off = g({ manipBoostPerNudge: 0 });
    const on = g({});
    c6.note(`$30m, hacking 300, 1 nudge/tick, 12 seeds x 2h (5 seeds x 1.5h was too noisy: it inverted the 24-seed result): ${(on * 100).toFixed(0)}%/h pricing manipulability (k=${S.DEFAULTS.manipBoostPerNudge}) vs ${(off * 100).toFixed(0)}%/h ignoring it`);
    if (!(S.DEFAULTS.manipBoostPerNudge > 0)) c6.fail("manipBoostPerNudge is 0 — manipulability is not priced");
    else if (!(on > off)) c6.fail("pricing manipulability no longer beats ignoring it on paired markets");

    // The shipped script, with a serving batcher: boost published, manip on a servable host.
    c6.examined(1);
    const m = new Market({ seed: 12, money: 3e7, burnInTicks: 3000 });
    const f = await runShipped(m, 200, {
      onTick: (n, files) => {
        files["/tel/batch.txt"] = JSON.stringify({ at: new Date().toISOString(), hackingLevel: 300, expFarm: { manip: { serve: true, nudgesPerSec: 0.17, blocked: [] } } });
      },
    });
    const tel = JSON.parse(f.files["/tel/stock.txt"]);
    if (!(tel.servable?.boostPoints > 0)) c6.fail("stock.js did not credit the served nudges", JSON.stringify(tel.servable));
    const hosts = Object.keys(tel.manip ?? {});
    if (!hosts.length) c6.fail("no manip requested although servable companies exist");
    for (const h of hosts) if (!["foodnstuff", "sigma-cosmetics", "joesguns", "omega-net"].includes(h)) c6.fail(`manip requested on ${h}, not servable at hacking 300`);
    c6.note(`shipped: servable ${tel.servable?.syms?.join(",")}, boost ${tel.servable?.boostPoints?.toFixed(1)} pts, manip ${JSON.stringify(tel.manip)}`);
  }
  checks.push(c6);

  // -------------------------------------------------------------------
  const c7 = new Check("ST7", "no churn: order rate bounded under a draining balance, no order pays more commission than it moves, a negative balance is not chased, and a restart's phase is a prior");
  {
    const { churn } = await import("../sim/stocks/churn.mjs");
    // Live 2026-09-25 (a4fc5ef): ~470 orders/h, $39.4m -> $9.7m in 25 min, the
    // balance pushed negative between ticks by unchecked spenders. A continuous
    // $40k/tick drain reproduced it offline (242 orders/h, 4 seeds).
    c7.examined(3);
    const rows = [];
    for (const seed of [1, 2, 3]) rows.push(await churn({ cap: 3e7, seed, hours: 0.5, drain: 40e3, every: 1 }));
    const worst = Math.max(...rows.map((r) => r.perH));
    c7.note(`$30m, pre-4S, restart mid-market, $40k/tick outside drain, 3 seeds x 30min: ${rows.map((r) => r.perH.toFixed(0)).join("/")} orders/h (live a4fc5ef: ~470)`);
    if (worst > 80) c7.fail(`order rate ${worst.toFixed(0)}/h under a draining balance — the churn is back`, "every order costs $100k (BuyingAndSelling.tsx)");

    // A claim that is DUE (wealth covers it) under the same drain: the cash is
    // raised in lots of at least minOrder, not a sliver per tick.
    c7.examined(2);
    const gate = { "/tel/installgate.txt": JSON.stringify({ lastAugReset: 1, planned: true, plan: { totalCost: 5e6, buy: [] }, joinClaim: 0 }) };
    const due = [];
    for (const seed of [1, 2]) due.push(await churn({ cap: 3e7, seed, hours: 0.5, drain: 40e3, every: 1, files: gate, homeRam: 2 ** 30 }));
    c7.note(`same drain with a $5m claim due: ${due.map((r) => r.perH.toFixed(0)).join("/")} orders/h`);
    if (Math.max(...due.map((r) => r.perH)) > 80) c7.fail(`order rate ${Math.max(...due.map((r) => r.perH)).toFixed(0)}/h raising a due claim under a drain — sliver sales`);

    // Without an outside drain the balance must never go below zero through our own orders.
    c7.examined(3);
    const clean = [];
    for (const seed of [4, 5, 6]) clean.push(await churn({ cap: 1e7, seed, hours: 0.5, drain: 0 }));
    const minCash = Math.min(...clean.map((r) => r.minCash));
    if (minCash < 0) c7.fail(`home cash went to $${minCash.toFixed(0)} with no other spender — an order was sized past cash or sold below its commission`);
    const perH = clean.map((r) => r.perH);
    if (Math.max(...perH) > 60) c7.fail(`order rate ${Math.max(...perH).toFixed(0)}/h at $10m with no drain`);
    c7.note(`$10m, no drain: ${perH.map((x) => x.toFixed(0)).join("/")} orders/h, min cash $${minCash.toFixed(0)}, ln-growth ${clean.map((r) => (r.lg * 100).toFixed(0)).join("/")} %/h`);

    // decide(): a negative balance with no claim sells nothing.
    c7.examined(1);
    const m = new Market({ seed: 3, money: 3e7, burnInTicks: 3000 });
    runNew(m, 300);
    const st = S.newState(m.symbols);
    S.observe(st, Object.fromEntries(m.symbols.map((x) => [x, m.price(x)])));
    for (let i = 0; i < 100; i++) {
      m.tick();
      S.observe(st, Object.fromEntries(m.symbols.map((x) => [x, m.price(x)])));
    }
    const { bookOf } = await import("../sim/stocks/strategies.mjs");
    const book = { ...bookOf(m, false), cash: -45e3 };
    const held = m.symbols.filter((x) => m.position(x)[0] > 0).length;
    const orders = S.decide(st, book).orders.filter((q) => !/^exit/.test(q.why));
    if (held && orders.length) c7.fail(`with cash -$45k and no claim decide() still orders: ${orders.map((q) => q.kind + " " + q.sym + " " + q.shares).join(", ")}`);
    const small = S.decide(st, { ...bookOf(m, false) }).orders.filter((q) => !/^exit/.test(q.why) && q.shares * m.price(q.sym) < S.DEFAULTS.minOrderCommissions * S.COMMISSION);
    if (small.length) c7.fail(`orders below the $${S.DEFAULTS.minOrderCommissions * 0.1}m minimum: ${small.map((q) => q.sym + " " + q.shares).join(", ")}`);

    // Restart: a remembered phase is used as a prior, and a wrong one is overturned.
    c7.examined(3);
    const found = (prior, seed) => {
      const mk = new Market({ seed, money: 0, burnInTicks: 3000 });
      const s2 = S.newState(mk.symbols, prior ? { phasePrior: prior } : {});
      S.observe(s2, Object.fromEntries(mk.symbols.map((x) => [x, mk.price(x)])));
      let truth = null;
      let at = null;
      for (let i = 0; i < 600; i++) {
        const before = mk.ticksUntilCycle;
        mk.tick();
        if (before === 1 && truth === null) truth = (s2.t + 1) % 75;
        S.observe(s2, Object.fromEntries(mk.symbols.map((x) => [x, mk.price(x)])));
        if (at === null && s2.phase !== null) at = s2.t;
      }
      return { truth, phase: s2.phase, at };
    };
    const base = found(null, 21);
    const good = found({ phase: base.truth, nats: S.PHASE_PRIOR_NATS }, 21);
    const bad = found({ phase: (base.truth + 30) % 75, nats: S.PHASE_PRIOR_NATS }, 21);
    if (good.phase !== base.truth || bad.phase !== base.truth) c7.fail(`phase with prior ${good.phase}, with a wrong prior ${bad.phase}, truth ${base.truth}`);
    if (!(good.at <= base.at)) c7.fail(`a correct remembered phase did not speed the lock (${good.at} vs ${base.at} ticks)`);
    c7.note(`phase lock: ${base.at} ticks cold, ${good.at} with the remembered phase, ${bad.at} with a wrong one (all end on the truth)`);
    // The wall-clock mapping: a boundary recorded at T maps to tick (T - T0)/6000 mod 75.
    const rec = { boundaryAtMs: 1e6, lastAugReset: 7 };
    const p = S.phasePriorFrom(rec, 1e6 + 6000 * 10, 7);
    if (p?.phase !== 65) c7.fail(`phasePriorFrom maps a boundary 10 ticks ago to phase ${p?.phase}, expected 65`);
    if (S.phasePriorFrom(rec, 1e6 + 6000 * 10, 8) !== null) c7.fail("a phase record from another life (the market re-initialises at install) must be ignored");
  }
  checks.push(c7);

  // -------------------------------------------------------------------
  const c8 = new Check("ST8", "concentration is the harness's choice on the TAIL too (p25), and the record separates trading P&L from other spenders' withdrawals");
  {
    // Kelly for these walks is ~20x capital per stock (per-tick edge/variance),
    // so with no leverage log-optimal is all-in on the best edge; the question
    // is whether estimation/flip risk makes a cap better on the bad seeds.
    // tools/sim/stocks/tail.mjs (40 seeds x 2h, $200m, mid-market) 2026-09-25:
    //   uncapped p10/p25/p50 65/77/90 %/h, DDmax 26% | maxFrac 0.5: 59/62/72, DDmax 20%
    //   | 0.34: 53/56/63 | 0.2: 38/44/49. A cap buys drawdown with growth at
    //   EVERY percentile. If that ever flips, this fails and asks for the cap.
    const { tail } = await import("../sim/stocks/tail.mjs");
    c8.examined(24);
    const un = tail({}, { seeds: 12, hours: 1.5, cap: 2e8 });
    const capped = tail({ maxFrac: 0.5 }, { seeds: 12, hours: 1.5, cap: 2e8 });
    c8.note(`12 seeds x 1.5h, $200m: uncapped p25 ${(un.p25 * 100).toFixed(0)}%/h (DDmax ${(un.ddMax * 100).toFixed(0)}%), maxFrac 0.5 p25 ${(capped.p25 * 100).toFixed(0)}%/h (DDmax ${(capped.ddMax * 100).toFixed(0)}%)`);
    if (capped.p25 > un.p25 && S.DEFAULTS.maxFrac >= 1) c8.fail("a 50% single-name cap now beats concentration on the 25th percentile — ship the cap (DEFAULTS.maxFrac)");
    if (un.ddMax > 0.45) c8.warn(`harness max drawdown ${(un.ddMax * 100).toFixed(0)}% — tail risk is growing`);

    // externalFlows: a withdrawal by another spender is not trading P&L.
    c8.examined(1);
    const m = new Market({ seed: 31, money: 2e8, burnInTicks: 3000 });
    const f = await runShipped(m, 300, {
      onTick: (n) => {
        if (n === 150) m.player.money -= 5e7; // someone else buys something
      },
    });
    const tel = JSON.parse(f.files["/tel/stock.txt"]);
    const hist = (f.files["/tel/stock-hist.txt"] || "").trim().split("\n").filter(Boolean);
    if (!(Math.abs(tel.externalFlows + 5e7) < 2e6)) c8.fail(`a $50m withdrawal reads as externalFlows ${tel.externalFlows?.toFixed(0)}`, "the record must say where the money went");
    if (!(hist.length >= 20)) c8.fail(`/tel/stock-hist.txt has ${hist.length} rows after 300 ticks`);
    c8.note(`$50m withdrawn mid-run: externalFlows $${(tel.externalFlows / 1e6).toFixed(1)}m, lifePnl $${(tel.lifePnl / 1e6).toFixed(1)}m, ${hist.length} history rows`);
  }
  checks.push(c8);

  // -------------------------------------------------------------------
  const c9 = new Check("ST9", "the warm-up: raises by other scripts are flows, not losses; a fresh market starts from its known forecasts");
  {
    // (1) Another script sells half the book mid-run (act-liquidate raise):
    // trading P&L must not jump, externalFlows must carry the spend.
    c9.examined(1);
    const m = new Market({ seed: 41, money: 2.5e8, burnInTicks: 3000 });
    let pnlBefore = null;
    let sold = 0;
    const f = await runShipped(m, 200, {
      onTick: (n, files) => {
        if (n === 150) {
          for (const x of m.symbols) {
            const [L] = m.position(x);
            if (L > 1) {
              const px = m.bid(x);
              if (m.sell(x, Math.floor(L / 2))) sold += Math.floor(L / 2) * px;
            }
          }
          m.player.money -= sold; // ...and the batch spends what was raised
          files["/tel/stock-hold.txt"] = JSON.stringify({ at: new Date().toISOString(), lastAugReset: 1, by: "act-liquidate.js", why: "raise" });
        }
        if (n === 149) pnlBefore = JSON.parse(files["/tel/stock.txt"]).lifePnl;
      },
    });
    const tel = JSON.parse(f.files["/tel/stock.txt"]);
    const jump = tel.lifePnl - pnlBefore;
    c9.note(`external raise of $${(sold / 1e6).toFixed(0)}m at tick 150: lifePnl moved $${(jump / 1e6).toFixed(1)}m over the next 50 ticks, externalFlows $${(tel.externalFlows / 1e6).toFixed(0)}m`);
    if (!(sold > 0)) c9.warn("nothing was held at tick 150 — the raise path was not exercised");
    else {
      if (Math.abs(jump) > 0.5 * sold) c9.fail(`a $${(sold / 1e6).toFixed(0)}m raise by another script moved trading P&L by $${(jump / 1e6).toFixed(0)}m — raises are being booked as losses`);
      if (!(tel.externalFlows < -0.8 * sold)) c9.fail(`externalFlows $${(tel.externalFlows / 1e6).toFixed(0)}m does not carry the $${(sold / 1e6).toFixed(0)}m spend`);
    }

    // (2) Fresh market: the init-forecast prior beats the stationary prior on
    // the first hour (same seeds), at p25 and p50.
    c9.examined(16);
    const { warmup, VARIANTS } = await import("../sim/stocks/warmup.mjs");
    const before = warmup(VARIANTS["before (no prior, trades pre-phase)"], { seeds: 16 });
    const after = warmup(VARIANTS["init-forecast prior"], { seeds: 16 });
    c9.note(`fresh market, 16 seeds, first hour P&L p10/p25/p50: stationary prior ${[before.h1.p10, before.h1.p25, before.h1.p50].map((x) => (x * 100).toFixed(0)).join("/")}%, init-forecast prior ${[after.h1.p10, after.h1.p25, after.h1.p50].map((x) => (x * 100).toFixed(0)).join("/")}%`);
    if (!(after.h1.p25 > before.h1.p25 && after.h1.p50 > before.h1.p50)) c9.fail("the init-forecast prior no longer beats the stationary prior on a fresh market");

    // (3) stock.js uses it when the life is minutes old, and says so.
    c9.examined(1);
    const m3 = new Market({ seed: 42, money: 2.5e8, burnInTicks: 5 });
    const g = await runShipped(m3, 30, { lastAugReset: Date.now() - 5 * 6000 });
    const t3 = JSON.parse(g.files["/tel/stock.txt"]);
    if (t3.warmup?.prior !== "init-forecast" || t3.warmup?.freshTicks !== 5) c9.fail(`a 5-tick-old market was not started from its init forecasts: ${JSON.stringify(t3.warmup)}`);
    const m4 = new Market({ seed: 43, money: 2.5e8, burnInTicks: 3000 });
    const h = await runShipped(m4, 10, {});
    if (JSON.parse(h.files["/tel/stock.txt"]).warmup?.prior === "init-forecast") c9.fail("an old market (life hours old) was treated as fresh");
  }
  checks.push(c9);

  return checks;
}
