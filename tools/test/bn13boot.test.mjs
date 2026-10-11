// [BB] THE BITNODE 13 BOOTSTRAP (live BN13.1 2026-10-11 03:54Z, 4.2h in:
// hacking 42, home 128GB/1 core, $2.6m, income ~0).
//
//   BB1  one install point: with nothing queued and no gate wait, every
//        "until the install" pricing takes the committed trajectory's own
//        first install (the plan's life length), not the ledger's window
//        minus this life's age — live the plan priced 8h lives while home,
//        hacknet and the slot priced an install 0.31-0.39h away.
//   BB2  the three call sites go through installPointOf on the inputs they
//        price (source).
//   BB3  a persisting purchase not affordable by the install is priced as
//        "save for it" vs not (home's $100.68m was "unpriced: not affordable
//        by the install" every pass); a purchase saved for inside the life
//        is bought at tb, its income from tb.
//   BB4  the published exit gets its draws (PLAN.exitFloorMs): live the exit
//        stopped at 8 of 24 draws, a 61.7h median beside 212.6h on all 24.
//   BB5  home's RAM verdict carries the exp its RAM adds in every node.
//   BB6  prep's grow tick launches a grow and its weaken cover only when both
//        fit, in a chunk: live sigma-cosmetics prepped with 89 weaken threads
//        beside 154 grow at minimum security (0.58 per grow, 0.08 needed).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Check } from "./harness.mjs";
import "./gameresolve.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
const hp = await import("../../hacknetplan.js");
const xp = await import("../../exitplan.js");
const P = await import("../../plan.js");
const EF = await import("../../expfarm.js");

export async function run() {
  const checks = [];

  const c1 = new Check("BB1", "nothing queued, no gate wait: the install point is the committed trajectory's own first install");
  {
    c1.examined(5);
    // Live 03:54Z: lifeLength L8 (inputs.cycleHours 8, cadence from the purchase model), no install decision, gate unplanned.
    const traj = { cycleHours: 8, cadenceFrom: "purchase model" };
    const ip = hp.installPointH({ gate: null, planInstall: null, planOpts: {}, trajectory: traj });
    if (ip.source !== "trajectory" || ip.W !== 8) c1.fail(`the committed trajectory's first install (8h), got ${JSON.stringify(ip)}`);
    const ipF = hp.installPointH({ gate: null, planInstall: null, planOpts: {}, trajectory: { ...traj, firstInstallH: 3 } });
    if (ipF.W !== 3) c1.fail(`an explicit firstInstallH is the trajectory's first install: ${ipF.W}`);
    // The committed plan and the gate still come first.
    const T0 = Date.parse("2026-10-11T03:54:05Z");
    const planned = hp.installPointH({ gate: null, planInstall: { key: "w2", installAt: T0 + 2 * 3600e3 }, planOpts: { lastAugReset: 1, now: T0 }, trajectory: traj });
    if (planned.source !== "plan" || Math.abs(planned.W - 2) > 1e-9) c1.fail(`a committed install decision wins: ${JSON.stringify(planned)}`);
    if (hp.installPointH({ gate: { bestWait: { waitMs: 3600e3 } }, planInstall: null, planOpts: {}, trajectory: traj }).W !== 1) c1.fail("the gate's own best wait wins over the trajectory");
    const none = hp.installPointH({ gate: null, planInstall: null, planOpts: {} });
    if (none.source !== "fallback") c1.fail(`no trajectory: the named fallback, got ${none.source}`);
  }
  checks.push(c1);

  const c2 = new Check("BB2", "the spend verdicts, the published exit inputs and the work slot all price W through installPointOf on their own inputs");
  {
    const pr = src("progress.js");
    c2.examined(4);
    // The second builder, gone: no W from the ledger's window minus this life's age.
    if (/const (winLeft|W0|W)\s*=\s*schedule\?\.windowH > 0 \? Math\.max\(0\.25, schedule\.windowH - \(schedule\.lifeAgeH/.test(pr)) c2.fail("an install point is still built from schedule.windowH - lifeAgeH");
    const crime = pr.slice(pr.indexOf("const crimeAlt = (() => {"), pr.indexOf("const alreadyAtDesk"));
    if (!/installPointOf\(ns, info, [^)]*, inputs\)/.test(crime)) c2.fail("the crime vs faction comparison must take W from installPointOf on its inputs");
    if (!/const ip = installPointOf\(ns, info, null, inp0\)/.test(pr)) c2.fail("the unplanned spend verdicts must take W from installPointOf on their inputs");
    if (!/const ip0 = installPointOf\(ns, info, null, pubInp\)/.test(pr)) c2.fail("the published exit inputs' W must come from installPointOf");
  }
  checks.push(c2);

  const c3 = new Check("BB3", "a persisting purchase the life cannot afford by W is priced as save-for-it vs not; one saved for within the life earns from tb");
  {
    c3.examined(6);
    // BN13-shaped: little income, a home block worth exp on the climb.
    const inputs = { money: 2.6e6, incomePerSec: 2e3, hacking: 42, hackingExp: 9e3, hackingMult: 0.44, expPerSec: 3.6, repPerSec: 1, exitRep: 0, exitFavor: 0, terminalRep: 0, exitLevel: 600, joinMoney: 0, cycleHours: 8, multGainPerCycle: 1.3 };
    const gainsAt = () => ({ hacking: 1, rep: 1, income: 1 });
    const moneyAt = (h) => 2.6e6 + 3e3 * h * 3600; // $10.8m/h
    const cost = 100.68e6;
    const base = { inputs, cost, gainPerSec: 0, W: 0.31, moneyAt, gainsAt, persists: true, expGainPerSec: 3 };
    const save = xp.spendExit(base);
    if (!(typeof save.deltaH === "number" && isFinite(save.deltaH))) c3.fail(`home not affordable by W must still be priced: ${save.why}`);
    else {
      const tb = (cost - 2.6e6) / (3e3 * 3600);
      if (!save.save || Math.abs(save.save.atH - tb) > 1e-3) c3.fail(`the save arm buys when the stream reaches the price (${tb.toFixed(3)}h): ${JSON.stringify(save.save)}`);
      // The comparison, both ways: a purchase returning nothing costs exactly the hold; one that
      // multiplies the climb's exp rate wins the hold back.
      const zero = xp.spendExit({ ...base, expGainPerSec: 0 });
      if (!(Math.abs(zero.deltaH - (tb - 0.31)) < 0.05)) c3.fail(`a no-return purchase saved for costs the hold (${(tb - 0.31).toFixed(2)}h): ${zero.deltaH}`);
      const big = xp.spendExit({ ...base, expGainPerSec: 36 });
      if (!(big.deltaH < 0)) c3.fail(`x10 the climb's exp rate must win the ${(tb - 0.31).toFixed(1)}h hold back: ${big.deltaH}`);
      c3.note(`save for home: ${save.save.why}; exit ${save.withH.toFixed(2)}h vs ${save.withoutH.toFixed(2)}h at +3 exp/s; ${big.deltaH.toFixed(2)}h at +36`);
    }
    // Destroyed at the install: no save arm.
    const hn = xp.spendExit({ ...base, persists: false });
    if (hn.deltaH !== null || !/not affordable by the install/.test(hn.why)) c3.fail(`a purchase the install destroys has no save arm: ${JSON.stringify(hn)}`);
    // Within the life: bought at tb, income over W - tb (no trader: exact).
    const W = 12;
    const inLife = xp.spendExit({ ...base, W, gainPerSec: 500, persists: false });
    const tb = (cost - 2.6e6) / (3e3 * 3600);
    const want = moneyAt(W) - cost + 500 * (W - tb) * 3600;
    if (!inLife.moneyAtW || Math.abs(inLife.moneyAtW.m1 - want) > 1) c3.fail(`saved for within the life: m1 = m(W) - cost + gain x (W - tb), want ${want.toFixed(0)}, got ${inLife.moneyAtW?.m1}`);
    // Affordable now: unchanged (tb = 0).
    const now = xp.spendExit({ ...base, cost: 1e6, W, gainPerSec: 500, persists: false });
    if (Math.abs(now.moneyAtW.m1 - (moneyAt(W) - 1e6 + 500 * W * 3600)) > 1) c3.fail("affordable now: income over the whole of W, as before");
  }
  checks.push(c3);

  const c4 = new Check("BB4", "the published exit gets its draws: the budget floor holds 24 of 24 where the leftover stopped at 8");
  {
    c4.examined(3);
    const pr = src("progress.js");
    if (!/key: 'plan', noiseKey: noiseKeyOf\(basis, inp\)[\s\S]{0,400}budgetMs: Math\.max\(planBudgetLeft\(pc\), PLAN\.exitFloorMs\)/.test(pr)) c4.fail("progress.js must floor the exit decision's budget at PLAN.exitFloorMs");
    if (!/UNDER-SAMPLED: \$\{d\.n\} of \$\{nOf\} draws/.test(pr)) c4.fail("a truncated exit must say so in its source");
    // The live mechanism: ~2.5ms of work per draw, 20ms left (planBudgetLeft's floor).
    let t = 0;
    const clock = () => t;
    const draws = Array.from({ length: P.PLAN.N }, (_, i) => ({ i }));
    const opt = [{ key: "plan", sim: (d) => { t += 2.5; return 100 + d.i; } }];
    const short = P.decideAmong({ options: opt, draws, budgetMs: 20, clock });
    t = 0;
    const full = P.decideAmong({ options: opt, draws, budgetMs: P.PLAN.exitFloorMs, clock });
    if (!(short.n < P.PLAN.N)) c4.fail(`fixture: 20ms must truncate (${short.n})`);
    if (full.n !== P.PLAN.N || full.overBudget) c4.fail(`at the floor every draw: ${full.n}/${P.PLAN.N}`);
    c4.note(`20ms: ${short.n}/${P.PLAN.N} draws; floor ${P.PLAN.exitFloorMs}ms: ${full.n}/${P.PLAN.N}`);
  }
  checks.push(c4);

  const c5 = new Check("BB5", "home's RAM verdict carries the exp its RAM adds wherever the script exp rate is readable, not only where hacking pays nothing");
  {
    c5.examined(2);
    const pr = src("progress.js");
    const sv = pr.slice(pr.indexOf("function spendVerdictsOf"), pr.indexOf("function ramIncomePerGB"));
    if (/hackPays !== false \|\| !\(ramTotal > 0\)/.test(sv)) c5.fail("expPerGB is still gated to nodes where hacking pays nothing");
    if (!/out\.home = verdict\(next\.cost, gain, true, \{[^\n]*\}, expGain\)/.test(sv)) c5.fail("the home RAM verdict must pass its exp gain to spendExit");
  }
  checks.push(c5);

  const c6 = new Check("BB6", "prep's grow tick: the grow and its cover launch together or not at all, in chunks; the cover stays near 0.08 per grow on a full pool");
  {
    c6.examined(5);
    const per = 1.75;
    // No room for the grow beside its cover: nothing (the old tick placed the cover alone).
    const tight = EF.prepGrowPlan({ gNeed: 500, budgetGB: 3.5, sliceGB: 222, freeGBs: [1.75, 1.75], perThreadGB: per });
    if (tight.g !== 0 || tight.w !== 0) c6.fail(`2 slots cannot hold a chunk and its cover: ${JSON.stringify(tight)}`);
    const roomy = EF.prepGrowPlan({ gNeed: 500, budgetGB: 222, sliceGB: 222, freeGBs: [64, 32, 32, 16, 16, 16], perThreadGB: per });
    const slots = [64, 32, 32, 16, 16, 16].reduce((a, f) => a + Math.floor(f / per), 0);
    if (!(roomy.g >= 13 && roomy.g + roomy.w <= slots && roomy.w === Math.ceil(0.08 * roomy.g) + 1)) c6.fail(`a roomy pool: g plus cover within ${slots} slots: ${JSON.stringify(roomy)}`);
    if (EF.prepGrowPlan({ gNeed: 4, budgetGB: 222, sliceGB: 222, freeGBs: [64], perThreadGB: per }).g !== 4) c6.fail("the last few threads of a prep launch (the chunk floor is min(gNeed, ...))");
    if (EF.prepGrowPlan({ gNeed: 500, budgetGB: 14, sliceGB: 14, freeGBs: [14], perThreadGB: per }).g < 1) c6.fail("a tiny slice must still prep (its floor is a quarter of itself)");
    // The live pool, second by second: ~150 slots for the target, every op holds its RAM until it lands
    // (grow 3.2T, weaken 4T, T = 15.8s), a tick each second. Old rule: cover first, grow into what is left.
    const T = 15.8, S = 150;
    const simulate = (tick) => {
      let held = [];
      let gs = 0, ws = 0;
      for (let t = 0; t < 1800; t++) {
        held = held.filter((h) => h.until > t);
        const used = held.reduce((a, h) => a + h.n, 0);
        const { g, w } = tick(S - used);
        if (w) held.push({ n: w, until: t + 4 * T, k: "w" });
        if (g) held.push({ n: g, until: t + 3.2 * T, k: "g" });
        if (t >= 600) for (const h of held) h.k === "g" ? (gs += h.n) : (ws += h.n);
      }
      return { gs, ws, ratio: ws / gs };
    };
    const oldTick = (free) => {
      const g0 = Math.floor((free * per) / (per * 1.08));
      const w = g0 >= 1 ? Math.min(free, Math.ceil(0.08 * g0) + 1) : 0;
      return { w, g: Math.max(0, Math.min(g0, free - w)) };
    };
    const newTick = (free) => EF.prepGrowPlan({ gNeed: 1e9, budgetGB: free * per, sliceGB: S * per, freeGBs: [free * per], perThreadGB: per });
    const o = simulate(oldTick), n = simulate(newTick);
    c6.note(`steady state, weaken per grow held: old ${o.ratio.toFixed(2)} (grow ${o.gs}), new ${n.ratio.toFixed(2)} (grow ${n.gs})`);
    if (!(o.ratio > 0.3)) c6.fail(`fixture: the old tick must reproduce the leak (${o.ratio.toFixed(2)})`);
    if (!(n.ratio < 0.2 && n.gs > o.gs)) c6.fail(`the new tick must hold near the 0.08 cover and grow more: ${n.ratio.toFixed(2)}, grow ${n.gs} vs ${o.gs}`);
  }
  checks.push(c6);

  return checks;
}
