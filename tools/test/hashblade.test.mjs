// [HB] Hashes on the BLADEBURNER route — priced on the committed route's exit.
//
// Live BN7.1 2026-10-10 (fixture-bn7-hashblade-1315.json): the committed route
// was Bladeburner (black ops 10.6h vs the World Daemon 98h), yet
//   - hashspend.js priced every upgrade on the World Daemon exit
//     (withH = sellH = 2.87e65h for all four options) and refused both
//     Bladeburner exchanges as "no Bladeburner on the exit trajectory";
//   - hacknet.js valued hashes as money at the install and refused every
//     purchase ("no purchase adds money at the install"), while the 256-hash
//     cache could never bank the second rank exchange (500 hashes).
//
//   HB1  the exchanges are priced on the route: the live shape SAVES for an
//        exchange (was: refused), NOT_SIMULATED no longer names them
//   HB2  the exchange price is exit(with n purchases) - exit(without), from
//        ONE start (bbplan.bladeExitGen), and the game's changeRank SP rule
//   HB3  the joint trajectory: capacity bounds the escalating exchanges; a
//        cache step or a higher rate is worth exit hours
//   HB4  hacknet.js on the route: the live shape BUYS (cache), each item's
//        deltaH = trajectory(with) - trajectory(without)
//   HB5  the sale's alternative: a money leg makes it unpriced (sell, named);
//        a sale worth more than the exchange is sold
//   HB6  wiring: hashspend.js and hacknet.js take the committed route
//        (splitctl.committedRouteOf), progress.js publishes the prices

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const hs = await import("../../hashplan.js");
const hp = await import("../../hacknetplan.js");
const BB = await import("../../bbplan.js");
const sc = await import("../../splitctl.js");

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn7-hashblade-1315.json"), "utf8"));
const src = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8");
const code = (f) => src(f).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
const drain = (g) => {
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
};

// The start, as progress.js's startFor builds it, from the live records. The
// player's multipliers are not in the save digest: 1 (the exit is 10.87h here
// against the plan's 10.59h point — the comparison is paired on one start).
const MULTS = Object.fromEntries(["hacking", "strength", "defense", "dexterity", "agility", "charisma"].flatMap((k) => [[k, 1], [`${k}_exp`, 1]]));
const br = F.plan.decisions.bladeRoute;
const s0 = BB.bladeStartOf({ tel: F.tel, person: { ...F.person, mults: MULTS }, sleeves: br.sleeves, gymExpPerSec: br.start.gymExpPerSec, rankScale: F.rankScale, goCombat: br.start.goCombat, now: Date.parse(F.tel.at) });
const NOW = Date.parse(F.at);

export async function run() {
  const checks = [];
  const route = sc.committedRouteOf(F.plan, { node: 7 });
  const ex = { at: F.at, ...drain(hs.bladeExchangeGen(s0, BB.bladeExitGen)) };
  const plan = { ...F.plan, decisions: { bladeRoute: { ...br, hashExchange: ex } } };

  // -------------------------------------------------------------------
  {
    const c = new Check("HB1", "on the committed Bladeburner route the live shape saves for an exchange — it no longer refuses rank/SP");
    c.examined(1);
    if (route?.key !== "blade") c.fail(`fixture: committedRouteOf reads '${route?.key}', not 'blade' — the replay no longer tests the route`);
    for (const x of Object.values(hs.BLADE_EXCHANGE)) if (hs.NOT_SIMULATED[x.name]) c.fail(`NOT_SIMULATED still names ${x.name}: '${hs.NOT_SIMULATED[x.name]}'`);
    for (const k of ["Sell for Corporation Funds", "Exchange for Corporation Research", "Company Favor"]) if (!hs.NOT_SIMULATED[k]) c.fail(`NOT_SIMULATED lost ${k}`);
    const x = hs.exchangeOf(plan, { node: 7, now: NOW });
    if (typeof x.baseH !== "number") c.fail(`exchangeOf refused the published prices: ${x.why}`);
    const d = hs.decideBladeHashSpend({ hashes: F.hashspend.hashes, capacity: F.hashspend.capacity, exchange: x, levels: { rank: 0, sp: 0 }, route, sale: { perDollarH: 0 } });
    if (d.action !== "save" || !/Bladeburner/.test(d.name ?? "")) c.fail(`live shape (${F.hashspend.hashes.toFixed(2)} of ${F.hashspend.capacity} hashes): action '${d.action}' ${d.name ?? ""} — want 'save' for an exchange`, d.why);
    if (d.decidedBy !== "route-exit-sim") c.fail(`decidedBy '${d.decidedBy}'`);
    // The live record: World Daemon hours, identical with and without — what this replaces.
    const old = F.hashspend.decision.exits ?? [];
    c.note(`live (before): ${old.length} options at withH = sellH = ${old[0]?.withH?.toExponential(2)}h; now: ${d.action} ${d.name} (${d.why.slice(0, 120)})`);
    const w = d.exits.find((e) => e.name === d.name);
    if (!(w && w.withH < w.sellH)) c.fail("the chosen exchange does not shorten the exit against selling", JSON.stringify(w));
    c.note(`exit ${ex.baseH.toFixed(3)}h; rank ${(ex.rank.perPurchaseH * 60).toFixed(2)} min / purchase, SP ${(ex.sp.perPurchaseH * 60).toFixed(2)} min / purchase`);
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("HB2", "the exchange price is exit(with n) - exit(without) on ONE start; rank pays the game's floor(maxRank/3) SP");
    c.examined(1);
    const base = BB.bladeExit(s0).hours;
    if (Math.abs(base - ex.baseH) > 1e-9) c.fail(`baseH ${ex.baseH} is not the start's own exit ${base}`);
    for (const k of ["rank", "sp"]) {
      const w = BB.bladeExit(hs.bladeExchangeStart(s0, k, ex.n)).hours;
      const want = (w - base) / ex.n;
      if (Math.abs(want - ex[k].perPurchaseH) > 1e-9) c.fail(`${k}: perPurchaseH ${ex[k].perPurchaseH} vs (with - without)/n ${want}`);
      if (!(ex[k].perPurchaseH < 0)) c.fail(`${k}: an exchange does not shorten the black-op exit (${ex[k].perPurchaseH}h)`);
    }
    // Bladeburner.changeRank: maxRank = max(rank, maxRank); SP += floor((maxRank - (total+1)*3)/3 + 1).
    const r1 = hs.bladeExchangeStart({ rank: 14293.37, maxRank: 14293.37, skillPoints: 85 }, "rank", 1);
    const total0 = Math.floor(14293.37 / 3);
    const need = (total0 + 1) * 3;
    const gain = r1.maxRank >= need ? Math.floor((r1.maxRank - need) / 3 + 1) : 0;
    if (r1.rank !== 14393.37 || r1.maxRank !== 14393.37 || r1.skillPoints !== 85 + gain) c.fail(`rank exchange start ${JSON.stringify(r1)} vs the game's (+${gain} SP)`);
    const r2 = hs.bladeExchangeStart({ rank: 100, maxRank: 500, skillPoints: 0 }, "rank", 1);
    if (r2.skillPoints !== 0 || r2.maxRank !== 500) c.fail(`rank below maxRank pays SP: ${JSON.stringify(r2)}`);
    const s1 = hs.bladeExchangeStart({ skillPoints: 5 }, "sp", 2);
    if (s1.skillPoints !== 25) c.fail(`SP exchange x2: ${s1.skillPoints}`);
    const nj = drain(hs.bladeExchangeGen({ ...s0, joined: false }, BB.bladeExitGen));
    if (typeof nj.baseH === "number") c.fail("priced the exchanges outside the division (the game refuses them)");
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("HB3", "the joint trajectory: capacity bounds the escalating exchanges; rate and cache are worth exit hours");
    c.examined(1);
    const gainH = { rank: ex.rank.perPurchaseH, sp: ex.sp.perPurchaseH };
    const T = (o) => hs.exchangeTrajectory({ hashes0: 0, capacity: 256, ratePerSec: F.hacknet.hashesPerSec, horizonH: br.bladeH, levels: { rank: 0, sp: 0 }, gainH, ...o });
    const t0 = T({});
    if (t0.buys.rank > 1 || t0.buys.sp > 1) c.fail(`capacity 256 bought ${JSON.stringify(t0.buys)} — level 1 costs 500 hashes, past the cache`);
    if (!(t0.buys.rank + t0.buys.sp >= 1)) c.fail(`no exchange in ${br.bladeH}h at ${F.hacknet.hashesPerSec} hashes/s`, JSON.stringify(t0));
    const big = T({ capacity: 4096 });
    if (!(big.gainH < t0.gainH)) c.fail(`a larger cache is worth nothing: ${big.gainH} vs ${t0.gainH}`);
    // Past the reachable exchanges a faster rate buys nothing (capacity 256: both level-1 prices are 500)...
    const fast = T({ ratePerSec: F.hacknet.hashesPerSec * 1.01 });
    if (fast.gainH !== t0.gainH) c.fail(`a faster rate moved a capacity-bound trajectory: ${fast.gainH} vs ${t0.gainH}`);
    // ...with room to bank, it is worth its share (the in-progress purchase is credited).
    const fastBig = T({ capacity: 4096, ratePerSec: F.hacknet.hashesPerSec * 1.01 });
    if (!(fastBig.gainH < big.gainH)) c.fail(`a 1% faster rate is worth nothing with a 4096 cache: ${fastBig.gainH} vs ${big.gainH}`);
    // Escalation: level n costs 250(n+1); with a large cache and a fast rate the buys follow it.
    const many = T({ capacity: 1e9, ratePerSec: 10 });
    const spent = [...Array(many.buys.rank).keys()].reduce((a, i) => a + 250 * (i + 1), 0) + [...Array(many.buys.sp).keys()].reduce((a, i) => a + 250 * (i + 1), 0);
    if (!(spent <= 10 * 3600 * many.endH + 1e-6)) c.fail(`spent ${spent} hashes in ${many.endH}h at 10/s`);
    c.note(`this node (capacity 256, ${(F.hacknet.hashesPerSec * 3600).toFixed(0)} hashes/h, ${br.bladeH}h): buys ${JSON.stringify(t0.buys)}, ${(t0.gainH * 60).toFixed(2)} min; cache 4096: ${(big.gainH * 60).toFixed(2)} min; 10 hashes/s uncapped: ${JSON.stringify(many.buys)}, ${(many.gainH * 60).toFixed(1)} min`);
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("HB4", "hacknet.js on the route: the live shape buys capacity, each item = trajectory(with) - trajectory(without)");
    c.examined(1);
    const n = F.hacknet.nodes;
    const servers = Array.from({ length: n }, () => ({ level: F.hacknet.levels / n, ram: F.hacknet.ram / n, cores: F.hacknet.cores / n, ramUsed: 0, cache: Math.log2(F.hacknet.hashCap / n / 32) }));
    const mults = F.hacknet.model.mults;
    const nodeMoney = F.hacknet.model.nodeMoney;
    const st = hs.fleetHashState(servers, mults, nodeMoney);
    const err = st.rate / F.hacknet.hashesPerSec - 1;
    c.note(`the fleet's model rate ${st.rate.toFixed(5)} vs the game's ${F.hacknet.hashesPerSec.toFixed(5)} hashes/s (${(err * 100).toFixed(2)}%), capacity ${st.capacity} vs ${F.hacknet.hashCap}`);
    if (Math.abs(err) > 0.01 || st.capacity !== F.hacknet.hashCap) c.fail("fixture: the reconstructed fleet does not reproduce the game's rate/capacity");
    // Before: the money-at-install batch refused everything (live verdict).
    if (!/no purchase adds money/.test(F.hacknet.verdict?.why ?? "")) c.fail(`fixture: the live verdict was '${F.hacknet.verdict?.why}'`);
    const x = hs.exchangeOf(plan, { node: 7, now: NOW });
    const b = hs.planRouteHacknetBatch({ servers, mults, nodeMoney, hashes: F.hashspend.hashes, exchange: x, levels: { rank: 0, sp: 0 }, horizonH: hs.bladeHashHorizonH(br, NOW), budget: 1e9 });
    if (!b.items.length) c.fail(`the route batch buys nothing on the live shape: ${b.stoppedBy}`);
    if (!b.items.some((i) => i.kind === "cache")) c.fail(`no cache bought though 256 hashes cannot bank the second exchange: ${JSON.stringify(b.items.slice(0, 5))}`);
    // The comparison, recomputed: each item against the fleet before it.
    let fleet = servers.map((s) => ({ ...s }));
    const gainH = { rank: x.rank.perPurchaseH, sp: x.sp.perPurchaseH };
    const traj = (f) => {
      const s = hs.fleetHashState(f, mults, nodeMoney);
      return hs.exchangeTrajectory({ hashes0: F.hashspend.hashes, capacity: s.capacity, ratePerSec: s.rate, horizonH: hs.bladeHashHorizonH(br, NOW), levels: { rank: 0, sp: 0 }, gainH }).gainH;
    };
    for (const it of b.items.slice(0, 20)) {
      let after = fleet;
      for (let i = 0; i < (it.count ?? 1); i++) after = hp.applyServerPurchase(after, it);
      const want = traj(after) - traj(fleet);
      if (Math.abs(want - it.deltaH) > 1e-9) c.fail(`${it.kind}#${it.index}: deltaH ${it.deltaH} vs with - without ${want}`);
      if (!(it.deltaH < 0)) c.fail(`${it.kind}#${it.index} bought with deltaH ${it.deltaH}`);
      fleet = after;
    }
    // A budget the claims leave at 0 buys nothing.
    const none = hs.planRouteHacknetBatch({ servers, mults, nodeMoney, hashes: 0, exchange: x, levels: { rank: 0, sp: 0 }, horizonH: br.bladeH, budget: 0 });
    if (none.items.length) c.fail("bought past a zero budget");
    c.note(`route batch: ${b.items.length} item(s), $${b.cost.toExponential(2)}, ${(b.deltaH * 60).toFixed(2)} min; first ${b.items.slice(0, 3).map((i) => `${i.kind}#${i.index} $${i.cost.toExponential(2)} ${(i.deltaH * 60).toFixed(2)}min`).join(", ")}`);
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("HB5", "the sale's alternative use on the route: a money leg leaves it unpriced (sell, named); a sale worth more is sold");
    c.examined(1);
    const x = hs.exchangeOf(plan, { node: 7, now: NOW });
    const legs = hs.decideBladeHashSpend({ hashes: 300, capacity: 512, exchange: x, levels: { rank: 0, sp: 0 }, route: { ...route, moneyLegs: ["the full daemon's home purchase"] } });
    if (legs.action !== "sell" || legs.decidedBy !== "route-unpriced") c.fail(`with a money leg: ${legs.action} / ${legs.decidedBy}`);
    const buy = hs.decideBladeHashSpend({ hashes: 300, capacity: 512, exchange: x, levels: { rank: 0, sp: 0 }, route });
    if (buy.action !== "buy") c.fail(`300 hashes, no leg, a sale worth nothing: ${buy.action} (${buy.why})`);
    // A sale whose money buys more exit than the exchange: sold.
    const rich = hs.decideBladeHashSpend({ hashes: 300, capacity: 512, exchange: x, levels: { rank: 0, sp: 0 }, route, sale: { perDollarH: (10 * Math.min(x.rank.perPurchaseH, x.sp.perPurchaseH)) / 62.5e6 } });
    if (rich.action !== "sell") c.fail(`a sale worth 10x the exchange was not sold: ${rich.action}`);
    const stale = hs.exchangeOf({ ...plan, decisions: { bladeRoute: { ...br, hashExchange: { ...ex, at: new Date(NOW - 3600e3).toISOString() } } } }, { node: 7, now: NOW });
    if (typeof stale.baseH === "number") c.fail("an hour-old exchange price was used");
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("HB6", "wiring: hashspend.js / hacknet.js take the committed route; progress.js publishes the prices on it");
    c.examined(1);
    const spend = code("hashspend.js");
    if (!/committedRouteOf\s*\(/.test(spend) || !/decideBladeHashSpend\s*\(/.test(spend) || !/route\?\.key === 'blade'/.test(spend)) c.fail("hashspend.js does not branch on the committed route");
    const hn = code("hacknet.js");
    if (!/committedRouteOf\s*\(/.test(hn) || !/planRouteHacknetBatch\s*\(/.test(hn)) c.fail("hacknet.js does not price capacity on the committed route");
    if (!/\bperDollarH[,:]/.test(hn)) c.fail("hacknet.js does not publish route.perDollarH (hashspend.js prices a sale with it)");
    if (!/perDollarH\s*=\s*best\s*&&\s*free\s*>\s*0/.test(hn)) c.fail("hacknet.js prices a sale's money past the claims (it must be 0 when the claims leave nothing)");
    const pr = code("progress.js");
    if (!/bladeExchangeGen\s*\(\s*startFor\(bladeBasis\)\s*,\s*bladeExitGen\s*\)/.test(pr) || !/\bhashExchange,/.test(pr)) c.fail("progress.js does not publish bladeRoute.hashExchange from the route's own start");
    if (/\bns\./.test(code("hashplan.js"))) c.fail("hashplan.js references ns (it must stay pure: it is in hashspend.js's and hacknet.js's RAM graph)");
    checks.push(c);
  }
  return checks;
}
