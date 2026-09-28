// [HL] BitNode 9, live 2026-09-28 21:49: within-life income reaches the exit
// trajectory, and the install point is the COMMITTED plan's.
//
// The failure (tools/test/fixture-bn9-2149.json is that pass): 2 hacknet
// servers hashing $103k/s; best upgrade RAM $1.225m for +$7.18k/s, payback 3
// minutes; verdict "exit 156.54h with vs 156.54h without (+0.000h) —
// P(better) 50%", remainingLifeH 0.07 — while plan.txt held w20.8 (install
// ~21h out). Three causes, each pinned here so reverting it turns this red:
//
//   HL1  the install point: spend verdicts and the published exit inputs used
//        the gate's bestWait, 0 when absent — so income until the install was
//        priced over ZERO hours. Now hacknetplan.installPointH: the plan first.
//   HL2  hacknet.js's remaining life read the ledger median (0.07h), not the
//        plan (20.8h).
//   HL3  this life's hacknet money was absent from every money-by-W model
//        (trajectory.incomeModel), so wait options and money at W left it out;
//        spendVerdictsOf now takes it from the caller's trajectory ONCE.
//   HL4  plan.decideSpend's 4.43h option error refused a purchase whose with/
//        without pair differs only by more money at W (ordered in every draw).
//   HL5  budget.js: the $100b Daedalus join claim held all cash against a
//        spend repaid in minutes, 21 hours before the install.
//   HL6  REPLAY: the 21:49 purchase is bought, and what the corrected policy
//        buys before the install.
//   HL7  hashspend: study is priced before the install (money at W), not
//        skipped because "an install is coming".

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const hp = await import("../../hacknetplan.js");
const xp = await import("../../exitplan.js");
const tj = await import("../../trajectory.js");
const pl = await import("../../plan.js");
const bu = await import("../../budget.js");
const hs = await import("../../hashplan.js");

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-2149.json"), "utf8"));
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
const T0 = Date.parse(F.hacknet.at);
const LAR = F.hacknet.lastAugReset;
const REC = F.exitinputs;
const INP = REC.inputs;
/** The published ladder as the planner's money -> batch response (spendRuns's interpolation). */
const gainsAt = (m) => xp.spendRuns({ ...REC, moneyAtW: m }, 0)?.without?.installGains ?? null;
const SI = null; // the live verdict's error bar came from the prior: sd 4.43h on 156.5h

export async function run() {
  const checks = [];
  const W = hp.committedInstallH(F.planInstall, { lastAugReset: LAR, planLastAugReset: F.planLastAugReset, at: F.planAt, now: T0 });

  // -------------------------------------------------------------------
  {
    const c = new Check("HL1", "the install point is the committed plan's (w20.8 -> ~20.8h), not the gate's missing bestWait read as 0");
    c.examined(8);
    if (!(W > 20 && W < 21)) c.fail(`the live plan (installAt ${F.planInstall.installAt}) must put the install ~20.8h out, got ${W}`);
    const gate = { install: false, bestWait: null };
    const ip = hp.installPointH({ gate, planInstall: F.planInstall, planOpts: { lastAugReset: LAR, planLastAugReset: F.planLastAugReset, at: F.planAt, now: T0 } });
    if (ip.source !== "plan" || Math.abs(ip.W - W) > 1e-9) c.fail(`installPointH must take the plan's time: ${JSON.stringify(ip)}`);
    if (hp.installPointH({ gate: { install: true }, planInstall: F.planInstall, planOpts: { lastAugReset: LAR, now: T0 } }).W !== 0) c.fail("a gate that installs now is 0");
    if (hp.installPointH({ gate: { holdForever: true }, planInstall: F.planInstall, planOpts: { lastAugReset: LAR, now: T0 } }).W !== null) c.fail("hold-forever is the final window (null)");
    if (hp.committedInstallH(F.planInstall, { lastAugReset: LAR + 1, planLastAugReset: F.planLastAugReset, now: T0 }) !== null) c.fail("another life's plan must not set the install point");
    if (hp.committedInstallH(F.planInstall, { lastAugReset: LAR, planLastAugReset: F.planLastAugReset, at: F.planAt, now: T0 + 3600e3 }) !== null) c.fail("a stale plan must not set the install point");
    if (hp.committedInstallH({ install: true }, { lastAugReset: LAR, now: T0 }) !== 0) c.fail("a plan that installs now is 0");
    const fb = hp.installPointH({ gate: { install: false }, planInstall: null, planOpts: {} });
    if (fb.W !== 0 || fb.source !== "fallback") c.fail("no plan and no gate wait: the old 0, named as a fallback");
    const p = code("progress.js");
    const uses = (p.match(/installPointOf\(ns, info, gate\)\.W/g) ?? []).length;
    if (uses !== 2) c.fail(`progress.js must take BOTH the spend verdicts' W and the published exit inputs' W from installPointOf (found ${uses})`);
    if (/gate\.bestWait\?\.waitMs > 0 \? gate\.bestWait\.waitMs \/ 3600000 : 0/.test(p)) c.fail("the gate-only install point (bestWait or 0) is back in progress.js");
    c.note(`live: plan ${F.planInstall.key} -> W = ${W.toFixed(2)}h at ${F.hacknet.at} (the gate published W = ${F.gateSpendExit.W})`);
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("HL2", "hacknet.js's remaining life is the committed plan's, ahead of the ledger median");
    c.examined(3);
    const r = hp.remainingLife({ plan: { hours: W }, ledger: { windowH: 0.5, lifeAgeH: 0.43, ageMs: 0 }, gate: { install: false, waitMs: 0, ageMs: 0, passMs: 300000 } });
    if (r.source !== "plan" || r.hours !== W) c.fail(`the plan's 20.8h must win over the ledger's minutes: ${JSON.stringify(r)}`);
    if (hp.remainingLife({ plan: null, ledger: { windowH: 2, lifeAgeH: 0.5, ageMs: 0 } }).hours !== 1.5) c.fail("without a plan the old witnesses stand");
    if (!/plan: planH === null \? null : \{ hours: planH \}/.test(code("hacknet.js"))) c.fail("hacknet.js no longer passes the committed plan into remainingLife");
    c.note(`live: ${F.hacknet.remainingLifeH.toFixed(3)}h published -> ${r.hours.toFixed(2)}h`);
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("HL3", "this life's hacknet money is in every money-by-W model, counted once");
    c.examined(4);
    const base = { incomePerSec: INP.incomePerSec, hacking: INP.hacking, hackingExp: INP.hackingExp, hackingMult: INP.hackingMult, expPerSec: INP.expPerSec };
    const a = tj.incomeModel(base).moneyBy(W);
    const b = tj.incomeModel({ ...base, lifePerSec: INP.lifeIncome }).moneyBy(W);
    if (Math.abs(b - a - INP.lifeIncome * W * 3600) > 1) c.fail(`moneyBy(W) must add lifePerSec x W exactly: +${b - a} vs ${INP.lifeIncome * W * 3600}`);
    if (!tj.incomeModel({ ...base, incomePerSec: 0, lifePerSec: 1e5 })) c.fail("hacknet money alone must still price (BitNode 9's opening)");
    const p = code("progress.js");
    if (!/lifePerSec: econNow\.lifePerSec/.test(p)) c.fail("progress.js's incomeModel no longer carries lifePerSec");
    if (/moneyAt: \(h\) => liveMoney \+ moneyBy\(h\) \+ lifeInc/.test(p)) c.fail("spendVerdictsOf adds hacknet money on top of a trajectory that already carries it (double count)");
    c.note(`money by the install: $${(a / 1e9).toFixed(2)}b script-shaped, +$${((b - a) / 1e9).toFixed(2)}b hacknet`);
    checks.push(c);
  }

  // -------------------------------------------------------------------
  const best = F.hacknet.best;
  const verdictAt = (Wx) => {
    const m0 = (h) => INP.money + tj.incomeModel({ incomePerSec: INP.incomePerSec, hacking: INP.hacking, hackingExp: INP.hackingExp, hackingMult: INP.hackingMult, expPerSec: INP.expPerSec, lifePerSec: INP.lifeIncome }).moneyBy(h);
    const r = xp.spendExit({ inputs: INP, W: Wx, finalWindow: false, moneyAt: m0, gainsAt, eBudget: 0, cost: best.cost, gainPerSec: best.gainPerSec, persists: false });
    // progress.js's rule: spendExit's own money at W, with the trader's compounding on both sides.
    const mw = r.moneyAtW;
    const dominant = Wx > 0 && mw && mw.m1 > mw.m0 ? { paybackH: best.cost / best.gainPerSec / 3600, W: Wx } : null;
    return { r, pd: pl.decideSpend({ deltaH: r.deltaH, withoutH: r.withoutH, si: SI, dominant }) };
  };
  {
    const c = new Check("HL4", "a money-dominant spend (repaid before W, more money there) is bought; the 4.43h error bar applies only to different trajectories");
    c.examined(5);
    const old = verdictAt(0);
    const now = verdictAt(W);
    if (old.pd?.buy !== false) c.fail("at the old W=0 the purchase must price as nothing (this is the live bug, reproduced)");
    if (now.pd?.buy !== true || now.pd?.dominant !== true) c.fail(`at W=${W.toFixed(2)} the $1.225m / 3-minute upgrade must be bought: ${JSON.stringify(now.pd)}`);
    if (!(now.r.deltaH <= 0)) c.fail(`more money at W cannot lengthen the exit: deltaH ${now.r.deltaH}`);
    // Dominance is not a blanket pass.
    if (pl.decideSpend({ deltaH: 0.2, withoutH: 150, dominant: { paybackH: 0.05, W: 20 } }).buy) c.fail("a spend the simulator says LENGTHENS the exit is not bought, dominant or not");
    if (pl.decideSpend({ deltaH: -0.01, withoutH: 150, dominant: { paybackH: 30, W: 20 } }).buy) c.fail("a spend not repaid before the install is not dominant: the error bar applies");
    if (!/const pd = decideSpend\(\{ deltaH: r\.deltaH, withoutH: r\.withoutH, si: [^\n]*dominant \}\)/.test(code("progress.js"))) c.fail("progress.js's spend verdicts no longer pass the dominance test");
    c.note(`live replay: W=0 -> ${old.pd?.why}`);
    c.note(`W=${W.toFixed(2)}h -> ${now.r.deltaH === null ? `unpriced: ${now.r.why}` : `exit ${now.r.withH.toFixed(2)}h vs ${now.r.withoutH.toFixed(2)}h`}; ${now.pd?.why}`);
    c.note(`money at W with the trader compounding (r ${INP.capitalReturnPerSec.toExponential(2)}/s, cap $${(INP.capitalCap / 1e12).toFixed(1)}t): cost x${now.r.moneyAtW?.lumpFactor?.toFixed(0)}, income x${((now.r.moneyAtW?.streamSec ?? 0) / (W * 3600)).toFixed(0)} per second-dollar -> +$${(((now.r.moneyAtW?.m1 ?? 0) - (now.r.moneyAtW?.m0 ?? 0)) / 1e9).toFixed(2)}b at W`);
    const capOld = best.cost * Math.expm1(INP.capitalReturnPerSec * W * 3600);
    if (!(now.r.moneyAtW?.lumpFactor < 1e4)) c.fail(`the cost's compounding must stop at the book's cap, not run e^(rW) = ${capOld.toExponential(2)} dollars`);
    c.note("(the published ladder tops out at $9.2b — built for the old W=0 money — so deltaH saturates at 0 here; live, replanAt re-plans at the corrected money at W)");
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("HL5", "the join claim yields to a spend repaid before the horizon while the join money is not in hand");
    c.examined(4);
    const claims = { join: F.hacknet.claims.join, augmentations: F.hacknet.claims.augmentations, home: { amount: F.hacknet.claims.home, deltaGB: 64 } };
    const payback = { payback: { moneyReturn: { cost: best.cost, gainPerSec: best.gainPerSec, horizonSec: W * 3600 } } };
    const free = bu.spendable("hacknet", F.cash, claims, { exitApproved: true, ...payback });
    if (!(free >= best.cost)) c.fail(`with the exit approval and a 3-minute payback, the $${F.cash.toFixed(0)} cash must cover the $1.225m upgrade: spendable $${free}`);
    if (bu.spendable("hacknet", F.cash, claims, { exitApproved: true }) !== 0) c.fail("without a money return the join claim still holds everything");
    if (bu.spendable("hacknet", 2e11, claims, { exitApproved: true, ...payback }) > 2e11 - claims.join + 1) c.fail("with the join money IN HAND the claim holds (the invite could come during the payback)");
    if (bu.spendable("hacknet", F.cash, claims, { exitApproved: true, payback: { moneyReturn: { cost: best.cost, gainPerSec: best.gainPerSec, horizonSec: 60 } } }) !== 0) c.fail("a spend not repaid inside the horizon keeps the join hold");
    c.note(`live cash $${(F.cash / 1e6).toFixed(2)}m, join claim $${(claims.join / 1e9).toFixed(0)}b: spendable $${(free / 1e6).toFixed(2)}m`);
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("HL6", "REPLAY 21:49: the corrected policy's purchases up to the committed install");
    // The two live servers; the player's hacknet multipliers from the
    // observed rate and price (fixture `about`); BN9 HacknetNodeMoney 1.
    const M = { hacknet_node_money: 1.28, hacknet_node_purchase_cost: 1 / 1.28, hacknet_node_level_cost: 1 / 1.28, hacknet_node_ram_cost: 1 / 1.28, hacknet_node_core_cost: 1 / 1.28 };
    let fleet = [{ level: 100, ram: 4, cores: 10, ramUsed: 0 }, { level: 1, ram: 4, cores: 1, ramUsed: 0 }];
    const rate0 = fleet.reduce((a, s) => a + hp.hashRate(s.level, 0, s.ram, s.cores, M.hacknet_node_money, 1), 0);
    c.examined(2);
    if (Math.abs(rate0 - F.hacknet.hashesPerSec) / F.hacknet.hashesPerSec > 0.01) c.fail(`reconstructed fleet hashes ${rate0} vs live ${F.hacknet.hashesPerSec}`);
    const first = hp.bestServerUpgrade(fleet, M, 1, hp.DOLLARS_PER_HASH).best;
    if (first.kind !== best.kind || first.index !== best.index || Math.abs(first.cost - best.cost) > 1) c.fail(`the replay's first offer must be the live one (${best.kind}#${best.index} $${best.cost}), got ${JSON.stringify(first)}`);
    // Greedy, as hacknet.js does, on the rule progress.js now applies
    // (spendExit's money at W): buy the best offer when, with the trader's
    // book compounding at its measured return up to its cap, the money it
    // leaves at the install beats keeping its price in the book — and it is
    // repaid before the install. Funds are WEALTH (cash + the book): an
    // approved purchase is funded by act.js's sized raise (nodeecon). Script
    // income is held flat (a floor: the level climbs); hashes are sold.
    const r = INP.capitalReturnPerSec;
    const cap = INP.capitalCap;
    const scriptPerSec = INP.incomePerSec;
    const stepS = 60;
    const run = (buying) => {
      let fl = fleet.map((x) => ({ ...x }));
      let w = INP.money;
      let t = 0;
      const got = { node: 0, level: 0, ram: 0, core: 0 };
      let spent = 0;
      while (t < W * 3600) {
        const left = W - t / 3600;
        for (let k = 0; buying && k < 50; k++) {
          const b = hp.bestServerUpgrade(fl, M, 1, hp.DOLLARS_PER_HASH).best;
          if (!b || !(b.paybackH < left) || b.cost > w) break;
          const fv = xp.capitalFutureValue({ capitalReturnPerSec: r, capitalCap: cap, money: w }, left);
          if (!(b.gainPerSec * fv.stream > b.cost * fv.lump)) break;
          w -= b.cost;
          spent += b.cost;
          got[b.kind]++;
          if (b.kind === "node") fl = [...fl, { level: 1, ram: 1, cores: 1, ramUsed: 0 }];
          else fl = fl.map((x, i) => (i !== b.index ? x : { ...x, level: x.level + (b.kind === "level"), ram: b.kind === "ram" ? x.ram * 2 : x.ram, cores: x.cores + (b.kind === "core") }));
        }
        const h = fl.reduce((a, x) => a + hp.hashRate(x.level, 0, x.ram, x.cores, M.hacknet_node_money, 1), 0);
        w += (r * Math.min(Math.max(0, w), cap) + scriptPerSec + h * hp.DOLLARS_PER_HASH) * stepS;
        t += stepS;
      }
      return { got, spent, w, fl, rate: fl.reduce((a, x) => a + hp.hashRate(x.level, 0, x.ram, x.cores, M.hacknet_node_money, 1), 0) };
    };
    const withB = run(true);
    const noB = run(false);
    const n = Object.values(withB.got).reduce((a, b) => a + b, 0);
    c.examined(1);
    if (!(withB.got.ram >= 1)) c.fail("the $1.225m RAM upgrade must be among the purchases");
    if (!(withB.w > noB.w)) c.fail(`the corrected policy must reach the install with MORE wealth: $${withB.w} vs $${noB.w}`);
    c.note(`${n} purchases in ${W.toFixed(1)}h: ${withB.got.node} new server(s) (${withB.fl.length} total), ${withB.got.level} level, ${withB.got.ram} RAM, ${withB.got.core} core upgrades — $${(withB.spent / 1e9).toFixed(3)}b spent`);
    c.note(`hashes ${rate0.toFixed(3)}/s ($${((rate0 * hp.DOLLARS_PER_HASH) / 1e3).toFixed(0)}k/s) -> ${withB.rate.toFixed(2)}/s ($${((withB.rate * hp.DOLLARS_PER_HASH) / 1e3).toFixed(0)}k/s); wealth at the install $${(withB.w / 1e12).toFixed(3)}t vs $${(noB.w / 1e12).toFixed(3)}t without buying (book at r ${r.toExponential(2)}/s to its $${(cap / 1e12).toFixed(1)}t cap)`);
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("HL7", "hashspend prices Improve Studying before the install on the right horizon (money at W), not 'an install is coming'");
    c.examined(3);
    const s = code("hashspend.js");
    if (/if \(!finalWindow\) skipped\.push\(\{ name: 'Improve Studying'/.test(s)) c.fail("hashspend.js skips study whenever an install is coming again");
    if (!/fns: \{ bestExitPolicy, spendRuns, incomeModel \}/.test(s)) c.fail("hashspend.js must hand incomeModel to the decision (the exp -> money-at-W response)");
    const rec = { ...REC, W, at: F.hacknet.at };
    const fns = { bestExitPolicy: xp.bestExitPolicy, spendRuns: xp.spendRuns, incomeModel: tj.incomeModel };
    const base = hs.exitAfter(rec, {}, fns, null, { expPerSec: 50 });
    const more = hs.exitAfter(rec, { expPerSec: 60 }, fns, null, { expPerSec: 50 });
    const noModel = hs.exitAfter(rec, { expPerSec: 60 }, { ...fns, incomeModel: undefined }, null, { expPerSec: 50 });
    if (!(typeof more === "number" && more <= base)) c.fail(`more study exp before the install cannot lengthen the exit: ${more} vs ${base}`);
    if (noModel !== base) c.fail("without an income model the exp effect must be exactly nothing (named), not a guess");
    c.note(`study +10 exp/s for ${W.toFixed(1)}h: exit ${base?.toFixed?.(3)}h -> ${more?.toFixed?.(3)}h (income via level only; its reputation effect is a floor)`);
    checks.push(c);
  }

  return checks;
}
