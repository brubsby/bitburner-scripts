// GANG EQUIPMENT COMPETES WITH EVERY OTHER SPENDER ON THE EXIT (live BN9
// 2026-09-29).
//
// The equipment spend (gang.js compete.permitted) priced equipment only
// against GANG money and then let budget.js hold it behind every claim:
//   18:45Z  respect mode (the gang earns $0/s): k=4.22 needed $23b of gear,
//           the exit comparison saw $0 on both sides (deltaH 0), permitted 0
//   20:56Z  money mode: a $44b policy won the exit 44.82h vs 45.92h, and the
//           $100b Daedalus join claim (hacking 298 of 2500, four installs
//           ahead) held every dollar: permitted 0
//   21:36Z  the same shape again, the fixture here: $58.7b of gear priced
//           34.13h vs 38.30h, permitted $362m of $99.9b
// Every refusal re-searched without equipment. The fix, pinned here:
//
//   GE1  budget.js joinAfterInstall: an exit-approved spend passes the join
//        claim ONLY where the committed trajectory installs before the join
//        (not the final window, W ahead, join level not reached) — every
//        field read, or the full hold stands
//   GE2  gangworth.gangEquipExit prices the price out of the book to W (the
//        trader's compounding), the money difference reinvested, and the
//        gang faction's reputation through the planner's gainsByGangRep
//        ladder; no ladder -> the respect channel is UNPRICED and named
//   GE3  live 21:38Z: the refused policy, re-priced — the plan's rule
//        (plan.decideSpend, si from plan.txt) approves it and the budget now
//        permits it on the player's wealth; the old rule reproduces the
//        live $362m refusal
//   GE4  the 19:45Z respect-mode incident: money-only, the $23b of gear is
//        a tie (both gangs $0); with the reputation ladder the with-run's
//        gang reputation at W is priced
//   GE5  wiring: gang.js decides with decideSpend on planSi, carries
//        joinAfterInstall into spendable/reserveFor/the raise, spends the
//        decision's cost once; progress.js publishes gainsByGangRep
import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const GP = await import("../../gangplan.js");
const GW = await import("../../gangworth.js");
const X = await import("../../exitplan.js");
const B = await import("../../budget.js");
const PL = await import("../../plan.js");
const NE = await import("../../nodeecon.js");
const FX = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-gangequip-2138.json"), "utf8"));
const WANTED = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-gangwanted-1945.json"), "utf8"));
const AUGS = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-augs.json"), "utf8")).augmentations;
const GANG_JS = fs.readFileSync(path.join(REPO_ROOT, "gang.js"), "utf8");
const PJ = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");

const REC = FX.exitinputs;
const LIFE = REC.lastAugReset;
const NOW = Date.parse(REC.at) + 60e3;
const G = FX.gangSection;
const REP = { repNow: G.repNow, facRepMult: G.facRepMult, favor: G.favor };
// A synthetic install point 1.5h ahead (the live one is 6.2h, past every
// unlock either gang reaches), where the two gangs sit on different levels.
const SHORT = { ...REC, W: 1.5 };

/**
 * A TEST-BUILT reputation ladder (the planner's re-plan runs only live): at
 * each of the gang faction's valued unlock levels, the money ladder's batch
 * at moneyAtW times every valued unlock reached so far (fixture-augs mults,
 * the channels progress.js installGainsOf reads). Every valued unlock is
 * assumed bought — an upper bound on the respect channel, stated.
 */
function testRepLadder(rec, section) {
  const byName = new Map(AUGS.map((a) => [a.name, a]));
  const base = X.spendRuns(rec, 0).without.installGains ?? { hacking: 1, rep: 1, income: 1, exp: 1 };
  const valued = (section.unlocks ?? []).filter((u) => u.value > 0 && byName.has(u.name)).sort((a, b) => a.repReq - b.repReq);
  // The levels progress.js re-plans at: gangworth.gangRepLevels over every unlock.
  const levels = GW.gangRepLevels((section.unlocks ?? []).map((u) => u.repReq), section.repNow, 10);
  const gainsAt = (rep) => {
    const g = { ...base };
    for (const u of valued.filter((x) => x.repReq <= rep)) {
      const m = byName.get(u.name).mults;
      g.hacking *= m.hacking ?? 1;
      g.rep *= m.faction_rep ?? 1;
      g.income *= (m.hacking_money ?? 1) * (m.hacking_chance ?? 1) * (m.hacking_speed ?? 1);
      g.exp *= m.hacking_exp ?? 1;
    }
    return g;
  };
  return { faction: section.faction, repNow: section.repNow, money: rec.moneyAtW, rows: [section.repNow, ...levels].map((rep) => ({ rep, gains: gainsAt(rep) })), built: "test" };
}

export async function run() {
  const checks = [];
  const stockRec = NE.stockRecordFromText(JSON.stringify(FX.stock), LIFE, Date.parse(FX.stock.at));
  const wealth = NE.wealthOf(FX.player.money, stockRec);
  // The join claim AT THE REFUSAL: $100b (gang.txt budget.claims 21:27Z, and
  // $100.36b wealth less it is the $362m the 21:36 refusal names); the gate
  // published 0 at 21:37.
  const claims = { join: 100e9, augmentations: FX.gate.budgetClaim, home: FX.tel.budget.claims.home };
  const jai = { finalWindow: REC.finalWindow, W: REC.W, hacking: FX.player.hacking, joinLevel: REC.inputs.joinLevel };

  const c1 = new Check("GE1", "budget.js: an exit-approved spend passes the join claim only where the committed trajectory installs before the join — every field read, or the full hold stands");
  {
    c1.examined(1);
    if (!(wealth > 9e10)) c1.fail(`fixture wealth (cash + book) should be ~$99.9b: ${wealth}`);
    const old = B.spendable("gang", wealth, claims, { exitApproved: true });
    const neu = B.spendable("gang", wealth, claims, { exitApproved: true, joinAfterInstall: jai });
    if (!(old < 1e9)) c1.fail(`exitApproved alone must still hold the $100b join claim (the live refusal): $${old}`);
    if (!(Math.abs(neu - wealth) < 1)) c1.fail(`non-final window, W ${REC.W.toFixed(2)}h, hacking ${jai.hacking} of ${jai.joinLevel}: the whole wealth, got $${neu}`);
    const shapes = [
      ["final window", { ...jai, finalWindow: true }],
      ["finalWindow unread", { ...jai, finalWindow: undefined }],
      ["no install point", { ...jai, W: null }],
      ["W 0", { ...jai, W: 0 }],
      ["hacking unread", { ...jai, hacking: undefined }],
      ["join level reached", { ...jai, hacking: 2500 }],
      ["join level unread", { ...jai, joinLevel: null }],
      ["join claim unreadable", jai, { ...claims, join: null }],
    ];
    for (const [what, j, cl] of shapes) {
      c1.examined(1);
      const v = B.spendable("gang", wealth, cl ?? claims, { exitApproved: true, joinAfterInstall: j });
      if (!(v < 1e9)) c1.fail(`${what}: the join claim must hold, spendable $${v}`);
    }
    c1.examined(1);
    if (B.spendable("gang", wealth, claims, { joinAfterInstall: jai }) !== 0) c1.fail("without exitApproved nothing is waived (augmentations and home still hold)");
    c1.note(`wealth $${(wealth / 1e9).toFixed(2)}b (cash $${(FX.player.money / 1e6).toFixed(0)}m + book): exitApproved alone $${(old / 1e9).toFixed(3)}b, with joinAfterInstall $${(neu / 1e9).toFixed(2)}b; ${shapes.length} fail-closed shapes hold`);
  }
  checks.push(c1);

  const c2 = new Check("GE2", "gangEquipExit: the price compounds to W out of the book, the money difference is reinvested, reputation rides the planner's ladder; no ladder -> the respect channel is UNPRICED and named");
  {
    const members = FX.members;
    const base = { softcap: FX.softcap, mode: "respect", horizonH: 4, tailH: 8, stepSec: 300, rivals: FX.rivals };
    const pol = { assignFn: GP.trainRatio(1, false, 0), ascend: { minGain: 1.5 } };
    const withS = GP.simulateGang(FX.gang, members, { ...base, ...pol, equipment: { budget: 2e10, fraction: 1 } });
    const bare = GP.simulateGang(FX.gang, members, { ...base, ...pol });
    c2.examined(4);
    if (!(withS.equipSpent > 0)) c2.fail(`the with-run must buy equipment: ${withS.equipSpent}`);
    const repW = GP.gangRepAt(withS, SHORT.W - 1 / 60, REP.repNow, REP);
    const repB = GP.gangRepAt(bare, SHORT.W - 1 / 60, REP.repNow, REP);
    if (!(repW > repB)) c2.fail(`equipment must raise the gang faction's reputation at W: ${repW} vs ${repB}`);
    const noLadder = GW.gangEquipExit(SHORT, LIFE, X.bestExitPolicy, withS, bare, withS.equipSpent, NOW, X.spendRuns, { rep: REP, gangRepAt: GP.gangRepAt });
    if (typeof noLadder.deltaH !== "number") c2.fail(`the live record must price: ${noLadder.why}`);
    if (!(noLadder.unpriced?.some((u) => /gainsByGangRep/.test(u)) && /UNPRICED/.test(noLadder.why))) c2.fail(`without a ladder the respect channel must be named unpriced: ${noLadder.why}`);
    if (!(noLadder.moneyAtW?.lump > 1)) c2.fail(`the trader compounds a dollar held to W (r ${REC.inputs.capitalReturnPerSec}/s): lump ${noLadder.moneyAtW?.lump}`);
    if (!(noLadder.deltaH >= 0)) c2.fail(`respect mode, money only: the equipment's price is all the exit sees, deltaH ${noLadder.deltaH}`);
    const rec = { ...SHORT, gainsByGangRep: testRepLadder(REC, G) };
    const priced = GW.gangEquipExit(rec, LIFE, X.bestExitPolicy, withS, bare, withS.equipSpent, NOW, X.spendRuns, { rep: REP, gangRepAt: GP.gangRepAt });
    if (priced.unpriced) c2.fail(`with a ladder nothing is unpriced: ${priced.unpriced}`);
    if (!(priced.repAtW && priced.repAtW.with > priced.repAtW.without)) c2.fail(`the reputation at W must be carried: ${JSON.stringify(priced.repAtW)}`);
    if (!(priced.deltaH <= noLadder.deltaH)) c2.fail(`reputation can only add to what the equipment is worth: ${priced.deltaH} vs ${noLadder.deltaH}`);
    // Refusals: another life, stale, unreadable, and a free spend of nothing ties.
    c2.examined(4);
    if (GW.gangEquipExit({ ...REC, lastAugReset: 1 }, LIFE, X.bestExitPolicy, withS, bare, 1e9, NOW, X.spendRuns).deltaH !== null) c2.fail("another life's inputs refuse");
    if (GW.gangEquipExit(REC, LIFE, X.bestExitPolicy, withS, bare, 1e9, NOW + 20 * 60e3, X.spendRuns).deltaH !== null) c2.fail("stale inputs refuse");
    if (GW.gangEquipExit(REC, LIFE, X.bestExitPolicy, null, bare, 1e9, NOW, X.spendRuns).deltaH !== null) c2.fail("an unreadable trajectory refuses");
    const same = GW.gangEquipExit(REC, LIFE, X.bestExitPolicy, bare, bare, 0, NOW, X.spendRuns, { rep: REP, gangRepAt: GP.gangRepAt });
    if (!(Math.abs(same.deltaH) < 1e-9)) c2.fail(`the same gang for $0 must tie exactly: ${same.deltaH}`);
    // The price compounds: the same spend in a node without a trader costs less at W.
    c2.examined(1);
    const flat = GW.gangEquipExit({ ...REC, inputs: { ...REC.inputs, capitalReturnPerSec: 0 } }, LIFE, X.bestExitPolicy, bare, bare, 5e10, NOW, X.spendRuns);
    const book = GW.gangEquipExit(REC, LIFE, X.bestExitPolicy, bare, bare, 5e10, NOW, X.spendRuns);
    if (!(flat.moneyAtW.without - flat.moneyAtW.with < book.moneyAtW.without - book.moneyAtW.with)) c2.fail(`$50b out of a compounding book must cost more at W than $50b of idle cash: ${book.moneyAtW.without - book.moneyAtW.with} vs ${flat.moneyAtW.without - flat.moneyAtW.with}`);
    c2.note(`$${(withS.equipSpent / 1e9).toFixed(1)}b of gear at k=1: gang rep at W ${Math.round(repW).toLocaleString()} vs ${Math.round(repB).toLocaleString()}; money only ${noLadder.deltaH.toFixed(3)}h (${noLadder.why}); with the test ladder ${priced.deltaH.toFixed(3)}h; $50b at W costs $${((book.moneyAtW.without - book.moneyAtW.with) / 1e9).toFixed(1)}b from the book (x${book.moneyAtW.lump.toFixed(2)}) vs $${((flat.moneyAtW.without - flat.moneyAtW.with) / 1e9).toFixed(1)}b idle`);
  }
  checks.push(c2);

  const c3 = new Check("GE3", "live 21:38Z: the refused policy re-priced on the committed trajectory — its money is worth nothing there (the old -6h was the gang stream taken as an eBudget lift), not buying is the incumbent, and what the gear buys is the gang faction's reputation at W; approved, it draws on wealth through a raise");
  {
    const R = FX.tel.policy.equipRefused.rejected;
    const ob = FX.tel.policy.objective;
    const base = { softcap: FX.softcap, mode: FX.tel.mode, horizonH: ob.horizonH, tailH: ob.tailH, stepSec: 180, rivals: FX.rivals };
    const pol = { assignFn: GP.trainRatio(R.k, false, R.m), ascend: { minGain: R.x }, warfare: { fraction: R.w, engageRatio: R.e } };
    // The contested budget gang.js searched with: wealth, every claim contested.
    const contested = B.spendable("gang", wealth, claims, { lnCompete: { lnPerDollar: Infinity, rivals: { join: 0, augmentations: 0, home: 0 } } });
    const withS = GP.simulateGang(FX.gang, FX.members, { ...base, ...pol, equipment: { budget: contested, fraction: R.y } });
    const bare = GP.simulateGang(FX.gang, FX.members, { ...base, ...pol });
    // Not buying = the incumbent then running (respect mode, no gear), as gang.js simulates it.
    const I = FX.tel.policy;
    const incumbent = GP.simulateGang(FX.gang, FX.members, { ...base, assignFn: GP.trainRatio(I.k, false, I.m), ascend: { minGain: I.x }, warfare: { fraction: I.w, engageRatio: I.e } });
    c3.examined(3);
    // The OLD comparison, verbatim: both gangs as extraIncome, which exitplan
    // lifts every later life's batch by ((income + extra)/income)^eBudget —
    // a gang's $m/s over the scripts' $64k/s — the lift exitplan refuses for
    // a carried stream ("never as a lift on the measured cadence").
    const runs = X.spendRuns(REC, withS.equipSpent);
    const oldW = X.bestExitPolicy({ ...runs.with, extraIncome: GW.gangIncomeSchedule(withS), eBudget: REC.eBudget }, runs.max, runs.min)?.best?.hours;
    const oldB = X.bestExitPolicy({ ...runs.without, extraIncome: GW.gangIncomeSchedule(bare), eBudget: REC.eBudget }, runs.max, runs.min)?.best?.hours;
    const rec = { ...REC, gainsByGangRep: testRepLadder(REC, G) };
    const sameOnly = GW.gangEquipExit(rec, LIFE, X.bestExitPolicy, withS, bare, withS.equipSpent, NOW, X.spendRuns, { rep: REP, gangRepAt: GP.gangRepAt });
    const cmp = GW.gangEquipExit(rec, LIFE, X.bestExitPolicy, withS, bare, withS.equipSpent, NOW, X.spendRuns, { rep: REP, gangRepAt: GP.gangRepAt, alternatives: [{ sim: incumbent, label: "the incumbent policy" }] });
    if (!(cmp.without === "the incumbent policy" && cmp.withoutH < sameOnly.withoutH)) c3.fail(`not buying is the incumbent, which exits sooner than the chosen policy bare: ${cmp.why} / ${sameOnly.why}`);
    if (typeof cmp.deltaH !== "number" || cmp.unpriced) c3.fail(`the refused policy must price on the live record, every channel: ${cmp.why}`);
    if (!(oldW - oldB < -1)) c3.fail(`the old comparison must reproduce the live verdict's shape (hours saved by the lift): ${oldW} vs ${oldB}`);
    // Money only (no reputation ladder): the gear's money is worth nothing on
    // the committed basis — money at W sits past the ladder's knee — so the
    // price is all the exit sees and the plan's rule holds.
    const si = FX.planSi.optionErr.si;
    const moneyOnly = GW.gangEquipExit(REC, LIFE, X.bestExitPolicy, withS, bare, withS.equipSpent, NOW, X.spendRuns, { rep: REP, gangRepAt: GP.gangRepAt, alternatives: [{ sim: incumbent, label: "the incumbent policy" }] });
    const pdMoney = PL.decideSpend({ deltaH: moneyOnly.deltaH, withoutH: moneyOnly.withoutH, si });
    if (!(moneyOnly.deltaH >= 0 && pdMoney?.buy === false)) c3.fail(`money only the gear must not pay: ${moneyOnly.why}`);
    // With the reputation ladder: the incumbent stops short of ENM Core V3
    // (1.75M) at W, the gear carries the gang past it.
    const V3 = G.unlocks.find((u) => u.name === "Embedded Netburner Module Core V3 Upgrade")?.repReq;
    if (!(cmp.repAtW.without < V3 && cmp.repAtW.with >= V3)) c3.fail(`the gear must be what crosses ENM Core V3 (${V3}) by W: ${JSON.stringify(cmp.repAtW)}`);
    const pd = PL.decideSpend({ deltaH: cmp.deltaH, withoutH: cmp.withoutH, si });
    if (!(cmp.deltaH < 0 && pd?.buy === true)) c3.fail(`on the test ladder the plan's rule must buy: ${pd?.why ?? cmp.why}`);
    // Approved: permitted on wealth (the join claim waived before the
    // install), paid through a raise from the book.
    c3.examined(1);
    const opts = { exitApproved: true, joinAfterInstall: jai };
    const permitted = B.spendable("gang", wealth, claims, opts);
    if (!(permitted >= withS.equipSpent)) c3.fail(`an approved $${withS.equipSpent} must be permitted on $${wealth} of wealth: $${permitted}`);
    if (!(B.spendable("gang", wealth, claims, { exitApproved: true }) < 0.5 * withS.equipSpent)) c3.fail("the old rule (join claim held) must reproduce the refusal");
    const cashBudget = B.spendable("gang", FX.player.money, claims, opts);
    const req = NE.raiseRequestFor({ cash: FX.player.money, equity: stockRec.equity, target: B.reserveFor("gang", claims, opts) + withS.equipSpent, by: "gang", why: "test", lastAugReset: LIFE });
    if (!(cashBudget < withS.equipSpent && req && req.target > FX.player.money)) c3.fail(`cash $${FX.player.money} cannot pay; a raise must be requested: ${JSON.stringify(req)}`);
    c3.note(`policy k=${R.k} x=${R.x.toFixed(3)} y=${R.y.toFixed(3)} w=${R.w.toFixed(3)} m=${R.m.toFixed(3)}: $${(withS.equipSpent / 1e9).toFixed(1)}b of gear`);
    c3.note(`old (extraIncome, lifted): ${oldW.toFixed(2)}h vs ${oldB.toFixed(2)}h (${(oldW - oldB).toFixed(2)}h); live refusal: ${FX.tel.policy.equipRefused.why}`);
    c3.note(`against the same policy bare: ${sameOnly.why}`);
    c3.note(`money only: ${moneyOnly.why}; plan: ${pdMoney?.why}`);
    c3.note(`with the TEST ladder (every valued unlock bought — an upper bound; the live verdict needs progress.js's gainsByGangRep): ${cmp.why}; plan: ${pd?.why}`);
    c3.note(`approved: permitted $${(permitted / 1e9).toFixed(1)}b of $${(wealth / 1e9).toFixed(1)}b wealth, raise to $${(req?.target / 1e9).toFixed(1)}b cash`);
  }
  checks.push(c3);

  const c4 = new Check("GE4", "the 19:45Z respect-mode incident: priced on gang money the $23b of gear is a pure cost (both gangs earn $0); the reputation ladder carries what it buys");
  {
    const P = WANTED.tel.policy;
    const base = { softcap: WANTED.softcap, mode: "respect", horizonH: 6.24, stepSec: 180, rivals: WANTED.rivals };
    const pol = { assignFn: GP.trainRatio(P.k, false, 0), ascend: { minGain: P.x }, warfare: { fraction: P.w, engageRatio: P.e } };
    const withS = GP.simulateGang(WANTED.gang, WANTED.members, { ...base, ...pol, equipment: { budget: P.compete.cost, fraction: 1 } });
    const bare = GP.simulateGang(WANTED.gang, WANTED.members, { ...base, ...pol });
    c4.examined(2);
    if (!(withS.money === 0 && bare.money === 0)) c4.fail(`respect mode: neither gang earns money (${withS.money}, ${bare.money})`);
    // The committed trajectory is the 21:38 record (the 19:45 exit was
    // unpriceable: 5.7e16h both sides); the gang faction's reputation then was ~0.
    const rep0 = { ...REP, repNow: 0 };
    const sec = { ...G, repNow: 0 };
    const money = GW.gangEquipExit(REC, LIFE, X.bestExitPolicy, withS, bare, withS.equipSpent, NOW, X.spendRuns, { rep: rep0, gangRepAt: GP.gangRepAt });
    const ladder = GW.gangEquipExit({ ...REC, gainsByGangRep: testRepLadder(REC, sec) }, LIFE, X.bestExitPolicy, withS, bare, withS.equipSpent, NOW, X.spendRuns, { rep: rep0, gangRepAt: GP.gangRepAt });
    if (!(money.deltaH >= 0)) c4.fail(`money only, the gear is its price: ${money.deltaH}`);
    if (!(ladder.repAtW?.with > ladder.repAtW?.without)) c4.fail(`the with-run reaches more reputation by W: ${JSON.stringify(ladder.repAtW)}`);
    if (!(ladder.deltaH < money.deltaH)) c4.fail(`the ladder must credit the unlocks the gear reaches: ${ladder.deltaH} vs ${money.deltaH}`);
    c4.note(`$${(withS.equipSpent / 1e9).toFixed(1)}b at k=${P.k.toFixed(2)}: money only ${money.deltaH.toFixed(3)}h; with the test ladder ${ladder.deltaH.toFixed(3)}h (rep at W ${Math.round(ladder.repAtW?.with ?? 0).toLocaleString()} vs ${Math.round(ladder.repAtW?.without ?? 0).toLocaleString()})`);
  }
  checks.push(c4);

  const c5 = new Check("GE5", "wiring: gang.js decides with plan.decideSpend on the plan's si, carries joinAfterInstall into the spend and the raise, spends the decision's cost once; progress.js publishes gainsByGangRep");
  {
    c5.examined(7);
    if (!/exitCmp\.plan = decideSpend\(\{ deltaH: exitCmp\.deltaH, withoutH: exitCmp\.withoutH, si: planSi\(ns, info\.lastAugReset\) \}\)/.test(GANG_JS)) c5.fail("gang.js must decide the spend with plan.decideSpend on planSi");
    if (!/const approved = exitPriced && exitCmp\.plan\?\.buy === true/.test(GANG_JS)) c5.fail("approval must be the plan's buy, not deltaH < 0");
    if (!/gangEquipExit\(rec, info\.lastAugReset, bestExitPolicy, d\.forecast, bare, d\.forecast\.equipSpent, Date\.now\(\), spendRuns, \{ rep, gangRepAt, alternatives: incumbent \? \[\{ sim: incumbent, label: 'the incumbent policy' \}\] : \[\] \}\)/.test(GANG_JS)) c5.fail("gang.js must hand gangEquipExit the reputation conversion and the incumbent as the not-buying alternative");
    if (!/spendable\('gang', wealthOf\(cashNow, stockRec\) \?\? 0, claims, opts\)/.test(GANG_JS) || !/spendable\('gang', cashNow, claims, opts\)/.test(GANG_JS) || !/reserveFor\('gang', claims, opts\) \+ budget/.test(GANG_JS)) c5.fail("the wealth check, the cash check and the raise target must all use the same opts (joinAfterInstall)");
    if (!/compete\.cost - \(compete\.spent \?\? 0\)/.test(GANG_JS) || !/compete\.spent = \(compete\.spent \?\? 0\) \+ best\.cost/.test(GANG_JS)) c5.fail("the decision's cost must be spent once, not once per tick");
    if (!/gainsByGangRep: gangTable/.test(PJ) || !/at\.replanAt\(at\.moneyAtW, lifted\)/.test(PJ)) c5.fail("progress.js must publish the gang-reputation batch ladder, re-planned by replanAt");
    if (!/if \(key === 'join' && o\.exitApproved === true && o\.joinAfterInstall\)/.test(fs.readFileSync(path.join(REPO_ROOT, "budget.js"), "utf8"))) c5.fail("budget.js must waive the join claim only under exitApproved + joinAfterInstall");
  }
  checks.push(c5);

  return checks;
}
