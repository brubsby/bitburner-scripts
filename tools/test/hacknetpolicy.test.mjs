// [HP] The hacknet policy, trajectory against trajectory, on two live BN9
// states: 2026-09-28 21:49 (fixture-bn9-2149.json, 2 servers, install 20.7h
// out) and 2026-09-29 00:09 (fixture-bn9-0009.json, 4 servers, 6.5h out).
//
// CALIBRATION: the fleet model is the game's (hacknetplan.hashRate/costs,
// pinned by [HS1] against formulas/HacknetServers.ts); each fixture's
// reconstructed fleet must reproduce the live hash rate to 1% (checked
// below). The trader's return and cap are the planner's own exit inputs
// (stock.txt calibration: 11% error over the last hour). The EXIT hours use
// the published money->batch ladder (exitplan.spendRuns) — the planner's own
// re-plan at money levels around its money at W; beyond the ladder's top the
// batch saturates (a floor on the gain, stated where it binds). Script
// income is held flat over the window (a floor). NOT calibrated: the
// hours-scale outcome itself (no life in BN9 has ended yet to compare).
//
//   HP1 PACE    one batch per pass on one raise vs one purchase per cycle
//   HP2 ORDER   value per dollar (money at the install) vs payback order
//   HP3 BOUND   the batch planner runs in slices: no page block past the slice
//   HP4 INSTALL the fleet's destruction: later lives rebuild (lifeplan)
//   HP5 HASHES  Max Money / Min Security / contracts / study vs selling

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const hp = await import("../../hacknetplan.js");
const xp = await import("../../exitplan.js");
const lp = await import("../../lifeplan.js");
const hs = await import("../../hashplan.js");
const coop = await import("../../coop.js");
const tj = await import("../../trajectory.js");

const load = (f) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test", f), "utf8"));
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
const M = { hacknet_node_money: 1.28, hacknet_node_purchase_cost: 1 / 1.28, hacknet_node_level_cost: 1 / 1.28, hacknet_node_ram_cost: 1 / 1.28, hacknet_node_core_cost: 1 / 1.28 };
const rateOf = (fl) => fl.reduce((a, x) => a + hp.hashRate(x.level, 0, x.ram, x.cores, M.hacknet_node_money, 1), 0);

function stateOf(F, servers) {
  const T0 = Date.parse(F.hacknet.at);
  const LAR = F.hacknet.lastAugReset;
  const W = hp.committedInstallH(F.planInstall, { lastAugReset: LAR, planLastAugReset: F.planLastAugReset, at: F.planAt, now: T0 });
  const rec = { ...F.exitinputs, W, at: F.hacknet.at };
  const I = rec.inputs;
  return { F, W, rec, I, servers };
}

/** Wealth at W under a policy: `pass(fleet, leftH, wealth)` -> purchases; the book compounds, script income flat, hashes sold. */
function simulate(S, policy, { stepS = 60, cycleS = 30, cashOnly = null } = {}) {
  const { I, W } = S;
  const r = I.capitalReturnPerSec > 0 ? I.capitalReturnPerSec : 0;
  const cap = I.capitalCap > 0 ? I.capitalCap : Infinity;
  let fl = S.servers.map((x) => ({ ...x }));
  // Wealth the policy may spend: the book (cash + equity) — or, cashOnly, a
  // separate cash pot fed only by income (the pre-raise world).
  let w = I.money;
  let cash = cashOnly;
  let t = 0;
  let nextPass = 0;
  const got = { node: 0, level: 0, ram: 0, core: 0 };
  let spent = 0;
  let first = [];
  while (t < W * 3600) {
    if (policy && t >= nextPass) {
      nextPass += cycleS;
      const left = W - t / 3600;
      const budget = cash === null ? w : cash;
      const items = policy(fl, left, budget, w);
      for (const it of items) {
        if (it.cost > (cash === null ? w : cash)) break;
        if (cash !== null) cash -= it.cost;
        w -= it.cost;
        spent += it.cost;
        got[it.kind]++;
        if (first.length < 10) first.push(`${it.kind}#${it.index}`);
        fl = hp.applyServerPurchase(fl, it);
      }
    }
    const inc = I.incomePerSec + rateOf(fl) * hp.DOLLARS_PER_HASH;
    w += (r * Math.min(Math.max(0, w), cap) + inc) * stepS;
    if (cash !== null) cash += inc * stepS;
    t += stepS;
  }
  return { w, got, n: Object.values(got).reduce((a, b) => a + b, 0), spent, rate: rateOf(fl), first };
}

const capOf = (I, w) => ({ capitalReturnPerSec: I.capitalReturnPerSec, capitalCap: I.capitalCap, capitalWarmupH: I.capitalWarmupH, money: w });
const batchPolicy = (S, order = "value") => (fl, left, budget, w) => hp.planHacknetBatch({ servers: fl, mults: M, nodeMoney: 1, W: left, capital: capOf(S.I, w), budget, maxItems: 400, order }).items;
/** 655e736's pace: the single best-by-payback offer when it is money-dominant, one per cycle. */
const onePerCycle = (S) => (fl, left, budget, w) => {
  const b = hp.bestServerUpgrade(fl, M, 1, hp.DOLLARS_PER_HASH).best;
  if (!b || b.cost > budget) return [];
  const fv = hp.capitalFV(capOf(S.I, w), left);
  return b.gainPerSec * fv.stream > b.cost * fv.lump ? [b] : [];
};
/** Exit hours after money-at-W delta `d` (the planner's ladder at its own W). */
function exitAt(S, d) {
  const runs = xp.spendRuns(S.rec, -d, { allowGain: true });
  return xp.bestExitPolicy({ ...runs.with, eRep: S.rec.eRep, eBudget: S.rec.eBudget }, runs.max, runs.min)?.best?.hours ?? null;
}

const F1 = load("fixture-bn9-2149.json");
const F2 = load("fixture-bn9-0009.json");
const S1 = stateOf(F1, [{ level: 100, ram: 4, cores: 10 }, { level: 1, ram: 4, cores: 1 }]);
const S2 = stateOf(F2, F2.servers);

export async function run() {
  const checks = [];
  const fmt = (x) => (x >= 1e12 ? `$${(x / 1e12).toFixed(3)}t` : `$${(x / 1e9).toFixed(2)}b`);

  // -------------------------------------------------------------------
  {
    const c = new Check("HP1", "PACE: every dominating purchase in one pass on one raise beats one purchase per cycle, on both live states");
    for (const [name, S] of [["21:49", S1], ["00:09", S2]]) {
      c.examined(1);
      const live = rateOf(S.servers);
      if (Math.abs(live / S.F.hacknet.hashesPerSec - 1) > 0.01) c.fail(`${name}: the reconstructed fleet hashes ${live} vs live ${S.F.hacknet.hashesPerSec}`);
      const none = simulate(S, null);
      const old = simulate(S, onePerCycle(S), { cycleS: 300 }); // live: 2 upgrades in 10 minutes
      const now = simulate(S, batchPolicy(S), { cycleS: 30 });
      if (!(now.w > old.w)) c.fail(`${name}: the batch must reach the install with more wealth than one-per-cycle (${fmt(now.w)} vs ${fmt(old.w)})`);
      if (!(old.w >= none.w)) c.fail(`${name}: even one-per-cycle must not lose to buying nothing`);
      const eNone = exitAt(S, 0);
      const eOld = exitAt(S, old.w - none.w);
      const eNow = exitAt(S, now.w - none.w);
      c.note(`${name} (W ${S.W.toFixed(2)}h): none ${fmt(none.w)} | one-per-5min ${old.n} buys, ${old.rate.toFixed(2)} h/s, ${fmt(old.w)} | batch ${now.n} buys, ${now.rate.toFixed(2)} h/s, ${fmt(now.w)}`);
      c.note(`   exit: none ${eNone?.toFixed(2)}h, one-per-cycle ${eOld?.toFixed(2)}h, batch ${eNow?.toFixed(2)}h${S === S1 ? " (the 21:49 ladder tops out at $9.2b: saturated, see HL4)" : ""}`);
      if (typeof eNow === "number" && typeof eOld === "number" && eNow > eOld + 1e-9) c.fail(`${name}: more money at W must not lengthen the exit (${eNow} vs ${eOld})`);
    }
    // The shipped code: one raise per pass (outside the purchase loop), the
    // batch planned by the generator, the verdict read as a batch.
    const h = code("hacknet.js");
    const fnBody = h.slice(h.indexOf("async function serverBatchPass"), h.indexOf("export async function main"));
    c.examined(3);
    if ((fnBody.match(/raiseRequestFor\(/g) ?? []).length !== 1 || fnBody.indexOf("raiseRequestFor(") > fnBody.indexOf("for (const it of prefix)")) c.fail("hacknet.js must file ONE raise per pass, before the purchase loop");
    if (!/planHacknetBatchGen\(/.test(fnBody) || !/pacer\.slices\(/.test(fnBody)) c.fail("hacknet.js must plan the batch with planHacknetBatchGen through the pacer");
    if (!/h\.batch !== true/.test(fnBody) || !/kind: 'batch', n: hn\.batch\.n, batch: true/.test(code("progress.js"))) c.fail("the exit verdict must be priced on, and read as, the whole batch");
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("HP2", "ORDER: value per dollar (money added at the install) vs payback order — same when money is no object, better when it is");
    for (const [name, S] of [["21:49", S1], ["00:09", S2]]) {
      c.examined(2);
      // Unconstrained (the book funds the batch): both orders buy every
      // dominating item; the orders differ, the money at W barely does.
      const v = simulate(S, batchPolicy(S, "value"));
      const pb = simulate(S, batchPolicy(S, "payback"));
      // Constrained: cash only (no raise), the world before 655e736's raise path.
      const cash0 = S === S1 ? F1.cash : 5e6;
      const vc = simulate(S, batchPolicy(S, "value"), { cashOnly: cash0 });
      const pc = simulate(S, batchPolicy(S, "payback"), { cashOnly: cash0 });
      c.note(`${name} book-funded: value ${v.n} buys ${fmt(v.w)} vs payback ${pb.n} buys ${fmt(pb.w)}; first buys value [${v.first.slice(0, 6).join(" ")}] payback [${pb.first.slice(0, 6).join(" ")}]`);
      c.note(`${name} cash-only ($${(cash0 / 1e6).toFixed(2)}m + income): value ${vc.n} buys, ${vc.rate.toFixed(2)} h/s, ${fmt(vc.w)} vs payback ${pc.n} buys, ${pc.rate.toFixed(2)} h/s, ${fmt(pc.w)}; exit ${exitAt(S, vc.w - simulate(S, null).w)?.toFixed(2)}h vs ${exitAt(S, pc.w - simulate(S, null).w)?.toFixed(2)}h`);
      if (vc.w < pc.w * (1 - 1e-6)) c.fail(`${name}: under a budget, value-per-dollar order must not end with less than payback order (${fmt(vc.w)} vs ${fmt(pc.w)})`);
    }
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("HP3", "BOUND: a maximal batch runs in slices — no page block past the slice, identical to the synchronous plan");
    c.examined(3);
    const big = Array.from({ length: 12 }, () => ({ level: 1, ram: 1, cores: 1 }));
    const args = { servers: big, mults: M, nodeMoney: 1, W: 30, capital: null, budget: 1e15, maxItems: 400 };
    const t0 = performance.now();
    const sync = hp.planHacknetBatch(args);
    const syncMs = performance.now() - t0;
    // A DETERMINISTIC clock: every reading advances 0.5ms, so the batch is
    // ~400ms of "work" wherever this runs (the real one is ~13ms warm on
    // this machine and would fit one slice — a planner that never yields
    // would pass). The pacer must cut it into slices of <= 20ms.
    let fake = 0;
    const pacer = coop.makePacer({ sliceMs: 20, yieldFn: async () => {}, now: () => (fake += 0.5), memory: new Map() });
    const sliced = await pacer.slices(hp.planHacknetBatchGen(args), "hp3");
    const st = pacer.stats;
    const maxStep = st.sections.hp3?.maxStepMs ?? 0;
    if (sliced.items.length !== sync.items.length || Math.abs(sliced.cost - sync.cost) > 1e-6) c.fail("the sliced plan must equal the synchronous one");
    if (sync.items.length !== 400) c.fail(`the batch must stop at maxItems (400), planned ${sync.items.length}`);
    if (!(st.maxBlockMs <= 20 + 2 * maxStep + 1)) c.fail(`a page block of ${st.maxBlockMs.toFixed(1)}ms past the 20ms slice (largest step ${maxStep.toFixed(2)}ms)`);
    if (!(maxStep <= 2)) c.fail(`one planning step took ${maxStep.toFixed(1)} clock readings' worth — the planner is not yielding per purchase`);
    if (!(st.yields >= 10)) c.fail(`a ~400ms batch must be cut into many slices, got ${st.yields} yields`);
    c.note(`400-item batch on a 12-server fleet: ${syncMs.toFixed(0)}ms of work; sliced max block ${st.maxBlockMs.toFixed(1)}ms, largest step ${maxStep.toFixed(2)}ms, ${st.yields} yields`);
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("HP4", "INSTALL COUPLING: every later life rebuilds its fleet from zero, and the life length is chosen with it");
    const cat = F2.catalogue;
    const catalogue = lp.catalogueOf(cat);
    const rph = F2.exitinputs.inputs.repPerSec * 3600;
    c.examined(4);
    for (const [name, S] of [["21:49", S1], ["00:09", S2]]) {
      const base = { ...S.I };
      const withH = { ...S.I, hacknet: { mults: M, nodeMoney: 1 } };
      const L8 = [2, 8, 16].map((L) => `${L}h ${fmt(lp.freshLifeMoney(base, L) - 1262)} -> ${fmt(lp.freshLifeMoney(withH, L) - 1262)}`).join(", ");
      const t0 = performance.now();
      const a = lp.cadenceByPurchases({ inputs: base, catalogue, favor: cat.favor, owned: cat.owned, repPerHour0: rph, bestExitPolicy: xp.bestExitPolicy });
      const b = lp.cadenceByPurchases({ inputs: withH, catalogue, favor: cat.favor, owned: cat.owned, repPerHour0: rph, bestExitPolicy: xp.bestExitPolicy });
      const ms = performance.now() - t0;
      if (!a || !b) {
        c.fail(`${name}: the cadence could not be priced (${!a ? "without" : "with"} hacknet)`);
        continue;
      }
      if (!(lp.freshLifeMoney(withH, 8) > lp.freshLifeMoney(base, 8))) c.fail(`${name}: an 8h life must be richer with the rebuilt fleet (it buys only what adds money, and at this state something does)`);
      c.note(`${name} fresh-life money without -> with the rebuild: ${L8}`);
      c.note(`${name} life length: ${a.cycleHours}h (x${a.multGainPerCycle.toFixed(3)}, exit ${a.exitH.toFixed(1)}h) without -> ${b.cycleHours}h (x${b.multGainPerCycle.toFixed(3)}, exit ${b.exitH.toFixed(1)}h) with the rebuild [${ms.toFixed(0)}ms for both]`);
      if (b.exitH > a.exitH + 1e-9) c.fail(`${name}: with more money in every life the chosen exit cannot be later (${b.exitH} vs ${a.exitH})`);
    }
    const p = code("progress.js");
    if (!/h\?\.mode === 'servers' && h\.lastAugReset === info\?\.lastAugReset && h\.model\?\.mults/.test(p)) c.fail("progress.js no longer carries hacknet.js's purchase model into the exit inputs");
    if (!/model: \{ mults: \{ hacknet_node_money/.test(code("hacknet.js"))) c.fail("hacknet.js no longer publishes its purchase model");
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("HP5", "HASH UPGRADES on the live state: each against selling the same hashes, with the trader's book on both sides");
    const S = S2;
    const fns = { bestExitPolicy: xp.bestExitPolicy, spendRuns: xp.spendRuns, incomeModel: tj.incomeModel };
    const exits = F2.hashspend?.decision?.exits ?? [];
    c.examined(exits.length);
    // The live target's income and the game's responses (hashplan, pinned by [HS3]).
    const opts = exits
      .filter((x) => x.name === "Increase Maximum Money" || x.name === "Reduce Minimum Security" || x.name === "Generate Coding Contract")
      .map((x) => {
        const m = /on \$(\d+)\/s/.exec(x.note ?? "");
        const r = /x([\d.]+) on/.exec(x.note ?? "");
        const money = /expected \$([\d.e+]+)/.exec(x.note ?? "");
        if (x.name === "Generate Coding Contract") return { name: x.name, cost: x.cost, effect: { money: Number(money?.[1] ?? 0) }, why: x.note };
        return { name: x.name, target: x.target, cost: x.cost, effect: { incomePerSec: Number(m?.[1] ?? 0) * (Number(r?.[1] ?? 1) - 1) }, why: x.note };
      });
    const d = hs.decideHashSpend({ hashes: 200, capacity: 5000, record: S.rec, lastAugReset: S.F.hacknet.lastAugReset, now: Date.parse(S.F.hacknet.at), fns, options: opts });
    for (const x of d.exits ?? []) {
      const fv = hp.capitalFV(capOf(S.I, S.I.money), S.W);
      const o = opts.find((y) => y.name === x.name);
      const moneyWith = (o.effect.incomePerSec ?? 0) * fv.stream + (o.effect.money ?? 0) * fv.lump;
      const moneySell = (x.cost / 4) * 1e6 * fv.lump;
      c.note(`${x.name}${x.target ? ` on ${x.target}` : ""} (${x.cost} hashes, ${o.why}): money at W ${fmt(moneyWith)} vs selling ${fmt(moneySell)}; exit ${x.withH?.toFixed(3)}h vs ${x.sellH?.toFixed(3)}h`);
      if (moneyWith > moneySell && d.action === "sell") c.fail(`${x.name} adds more money at W than selling but the spender sells`);
    }
    c.note(`decision: ${d.action}${d.name ? ` ${d.name}` : ""} — ${d.why}`);
    // The sale compounds in the book to W: exitAfter must price $X now as
    // $X x lump at W (the same capitalFV the verdicts and the batch use).
    {
      c.examined(1);
      const X = 1e9;
      const fv = hp.capitalFV(S.I, S.W);
      const got = hs.exitAfter(S.rec, { money: X }, fns);
      const want = exitAt(S, X * fv.lump);
      const flat = exitAt(S, X);
      if (!(Math.abs(got - want) < 1e-9)) c.fail(`a $1b sale must reach W as $${(X * fv.lump / 1e9).toFixed(1)}b (x${fv.lump.toFixed(0)} in the book): exit ${got} vs ${want} (uncompounded ${flat})`);
    }
    c.note("source: Increase Maximum Money is moneyMax x1.02 (Server.ts changeMaximumMoney) on a server whose moneyMax already carries ServerMaxMoney 0.01, and the batch's take is linear in it (hashplan.batchIncomeRatio, [HS3]) — so +2% of a $4.7k/s target is ~$93/s; Reduce Minimum Security x0.98 moves hack time/chance/percent by ~0.4% at these levels");
    checks.push(c);
  }

  return checks;
}
