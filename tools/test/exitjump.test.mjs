// [EJ] EXIT JUMP AT INSTALL: the install's simulation of the next life and the
// next life's own pricing are one trajectory.
//
// Live BN9 2026-09-29: act.js installed at 16:17:15Z on "the simulated exit
// installing now is 50.3h" (plan 'now' mean 50.06h, its commitment 51.14h,
// 80% 45.8-54.4h — TWO EXITS AT INSTALL passed). The next life priced "the
// committed trajectory (nothing queued)" at mean 94.1h (80% 79.3-112.1h) at
// 16:32Z; the gate's exitH read 44.9h at 16:29Z and 92.6h at 16:44Z. Same
// state, two models, ~43h apart. This morning had the same shape (104h at the
// install, 272h at life age 0.08h).
//
// THE PROVING RECORD (fixture-bn9-exitjump-1645, tools/sim/exitjump/): the
// pre-install side reconstructed (its one free parameter, the live trader
// return, calibrated to the actor's 50.26h), the post side as captured; input
// groups swapped one at a time. The trader's return is the whole jump:
//   point   pre: this life's live return (stock.js, ~1.2/h) — the realised fit
//           (nodeecon.realisedCapital: runs seen from their start) was NULL
//           before 16:17 (< 8 flow-free points on the young run)
//           post: the realised fit, 1.75/h (8+ points by 16:30)
//   draws   pre: none — posteriorsOf got the stock rows only when the fit
//           existed, so every draw kept the point
//           post: bayes.traderPosterior pooled over all runs, 0.39/h
// The exit's money legs (QLink's $75t graft first) compound the book at that
// return: draws at 0.39/h against a 1.75/h point put the mean 42h above the
// point. Nothing in the game changed at 16:32; the fit crossed 8 points.
//
//   EJ1 THE JUMP REPRODUCED  pre 'now' ~50h (mean ~ point: no draws) and post
//                            mean ~94h (point 52.8h) on the old estimators;
//                            the fit is null before the install and not after;
//                            the attribution: trader draws alone > +30h, every
//                            other group < 8h
//   EJ2 THE FIX              plan.traderBeliefOf: the posterior is the point
//                            and the draws, on both sides — the post mean is
//                            the pre mean less the elapsed hours within 3%,
//                            post point and mean within 10%; install cash
//                            carries CashRoot's $1m (a floor on the money leg)
//   EJ3 THE CHECK            plan.exitJumpOf on the live record fails "EXIT JUMP
//                            AT INSTALL" (planCheck, installRecordCheck after
//                            the plan moved on); consistent numbers pass; a
//                            record from another life, an exit past the window
//                            and a missing exit are not verdicts
//   EJ4 WIRING               progress.js: the exit inputs' point and the plan's
//                            draws from one traderBeliefNow; install cash from
//                            installCashOf; the plan record carries exitJump;
//                            the farm verdict is priced with nothing planned

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const P = await import("../../plan.js");
const E = await import("../../exitplan.js");
const B = await import("../../bayes.js");
const N = await import("../../nodeecon.js");
const O = await import("../../objective.js");

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-exitjump-1645.json"), "utf8"));
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

const POST = F.exitinputs;
const ROWS = F.stockHist;
const INSTALL_AT = Date.parse(F.installLast.at);
const PRE_CUT = "2026-09-29T16:12:09"; // the pass that committed w0.083
const rowsBefore = (iso) => ROWS.filter((r) => r.at < iso);
const ELAPSED_H = (Date.parse(F.exitinputsAt) - INSTALL_AT) / 3.6e6;

/** The post pass's non-trader posteriors, rebuilt from its published summary (as planperf does). */
function basePost() {
  const ps = F.plan.posteriors;
  const c = ps.cadence;
  return {
    drift: { s: ps.s, nu: ps.driftNu ?? 4, a: 2, b: 2 * ps.s * ps.s },
    gymSdLn: 0.1,
    cadence: { rate: { mean: Math.log(c.lnPerHour), sd: c.rateSdLn }, life: { mean: Math.log(c.cycleHours), sd: c.lifeSdLn }, own: { weight: c.ownWeight } },
    expPost: { perSec: ps.exp.perSec, sd: ps.exp.sdLn },
    income: { perSec: ps.income.perSec, mean: Math.log(ps.income.perSec), sd: ps.income.sdLn },
  };
}
/** The pre-install state as the 16:12 pass saw it (fixture `pre`), on the post inputs. */
function preInputs(over = {}) {
  const p = F.pre;
  return {
    ...POST,
    money: 0.448e9,
    hacking: p.hacking,
    hackingExp: p.hackingExp,
    hackingMult: POST.hackingMult * p.hackingMultOverPost,
    expPerSec: p.expPerSec,
    repPerSec: (POST.repPerSec * p.hacking) / POST.hacking * p.hackingMultOverPost,
    installGains: p.batchGains,
    persistBaseline: p.batchGains,
    nextInstallGain: p.batchGains.hacking,
    capitalReturnPerSec: p.liveReturnPerHour / 3600,
    capitalWarmupH: 0,
    cycleHours: p.cycleHours,
    multGainPerCycle: Math.exp(p.lnPerHour * p.cycleHours),
    ...over,
  };
}
/** Price one side: its point and its mean over 24 paired draws (trader: {mean, sd} per second, a whole posterior (the curve's, with lnWstar), or null = no trader draws). */
function price(inputs, { now, trader, seed }) {
  const draws = P.makeDraws({ ...basePost(), trader: trader ? (trader.perSec ? trader : { perSec: trader }) : null }, 24, seed);
  const f = (x) => {
    const r = now ? E.bestExitPolicy({ ...x, firstInstallH: 0 }, 400, 1) : E.bestExitPolicy(x);
    return r.degenerate ? null : r.best?.hours ?? null;
  };
  const hs = draws.map((d) => f(P.applyDraw(inputs, d))).filter((h) => Number.isFinite(h));
  return { point: f(inputs), mean: hs.reduce((a, b) => a + b, 0) / hs.length, n: hs.length };
}
const SEED_PRE = P.seedOf(F.installLast.lastAugReset, 9);
const SEED_POST = P.seedOf(F.lastAugReset, 9);

export async function run() {
  const checks = [];

  {
    const c = new Check("EJ1", "THE JUMP REPRODUCED: on the old estimators the install priced 'now' at ~50h with no trader draws, and the next life priced the same trajectory at ~94h — the trader's return is the whole jump");
    // The gate the draws hung on: the realised fit, null until 8 flow-free points of a run seen from its start.
    const fitPre = N.realisedCapital(rowsBefore(F.installLast.at));
    const fitPost = N.realisedCapital(ROWS);
    const tpPost = B.traderPosterior(ROWS, { warmupH: fitPost?.warmupH ?? 0 });
    c.note(`realised fit before the install: ${fitPre ? `${(fitPre.r * 3600).toFixed(3)}/h` : "null"}; at 16:45Z ${fitPost ? `${(fitPost.r * 3600).toFixed(3)}/h (${fitPost.why})` : "null"}; trader posterior at 16:45Z ${(tpPost.perHour.mean).toFixed(3)}/h`);
    if (fitPre !== null) c.fail(`the realised fit must be null before the install (that is why the pre side had no draws): ${fitPre?.r}`);
    if (!fitPost || !(fitPost.r * 3600 > 1.5)) c.fail(`the post point must be the young runs' fit (~1.75/h): ${fitPost?.r}`);
    if (!(tpPost.perHour.mean < 0.5)) c.fail(`the post draws' posterior must be ~0.39/h: ${tpPost.perHour.mean}`);
    const pre = price(preInputs(), { now: true, trader: null, seed: SEED_PRE });
    const post = price({ ...POST }, { now: false, trader: tpPost.perSec, seed: SEED_POST });
    c.note(`old estimators: pre 'now' point ${pre.point.toFixed(2)}h mean ${pre.mean.toFixed(2)}h [recorded actor ${F.installLast.exits.actorH}h, plan mean ${F.installLast.exits.planH}h]; post point ${post.point.toFixed(2)}h mean ${post.mean.toFixed(2)}h [recorded mean ${F.plan.exit.meanH}h]`);
    if (Math.abs(pre.point - F.installLast.exits.actorH) > 1.5) c.fail(`the reconstruction must reproduce the actor's ${F.installLast.exits.actorH}h: ${pre.point}`);
    if (Math.abs(pre.mean - pre.point) > 1.5) c.fail(`with no trader draws the pre mean sits on its point: ${pre.mean} vs ${pre.point}`);
    if (Math.abs(post.mean - F.plan.exit.meanH) > 5) c.fail(`the post side must reproduce the recorded ${F.plan.exit.meanH}h: ${post.mean}`);
    if (!(post.mean - (pre.mean - ELAPSED_H) > 30)) c.fail(`the jump must reproduce (> 30h): ${post.mean} vs ${pre.mean}`);
    // One group at a time into the pre side.
    const groups = [
      ["trader point (fit 1.75/h for live 1.2/h)", { inputs: { capitalReturnPerSec: POST.capitalReturnPerSec, capitalWarmupH: POST.capitalWarmupH } }],
      ["trader draws (posterior 0.39/h for none)", { trader: tpPost.perSec }],
      ["exp posterior (non-farm 75/s @180 for farm 550/s @223)", { inputs: { expPerSec: (POST.expPerSec * (F.pre.hacking + 50)) / (POST.hacking + 50) } }],
      ["income posterior", { inputs: { incomePerSec: POST.incomePerSec, incomeFlatPerSec: POST.incomeFlatPerSec } }],
      ["cadence (4h lives for 0.5h)", { inputs: { cycleHours: POST.cycleHours, multGainPerCycle: POST.multGainPerCycle } }],
      ["graft carry (the 24, both sides)", { inputs: { finalGrafts: POST.finalGrafts, graftStartMoney: POST.graftStartMoney } }],
    ];
    c.examined(groups.length + 2);
    for (const [name, g] of groups) {
      const r = price(preInputs(g.inputs ?? {}), { now: true, trader: g.trader ?? null, seed: SEED_PRE });
      const dp = r.point - pre.point;
      const dm = r.mean - pre.mean;
      c.note(`  ${name.padEnd(56)} point ${dp >= 0 ? "+" : ""}${dp.toFixed(2)}h  mean ${dm >= 0 ? "+" : ""}${dm.toFixed(2)}h`);
      if (name.startsWith("trader draws") && !(dm > 30)) c.fail(`the trader draws must carry the jump (> +30h mean): ${dm}`);
      if (!name.startsWith("trader draws") && Math.abs(dm) > 8) c.fail(`${name} must not carry the jump (|mean| <= 8h): ${dm}`);
    }
    checks.push(c);
  }

  ej2: {
    const c = new Check("EJ2", "THE FIX: one trader belief (the posterior) is the point and the draws on both sides — the next life's exit is the install's less the hours since");
    const bPre = P.traderBeliefOf(rowsBefore(PRE_CUT));
    const bPost = P.traderBeliefOf(ROWS);
    c.note(`belief before the install: ${bPre?.source} ${(bPre?.r * 3600).toFixed(3)}/h; after: ${bPost?.source} ${(bPost?.r * 3600).toFixed(3)}/h, warm-up ${bPost?.warmupH?.toFixed(3)}h`);
    if (bPre?.source !== "posterior" || bPost?.source !== "posterior" || !bPre.post || !bPost.post) {
      c.fail(`both sides must price on the posterior: ${bPre?.source} / ${bPost?.source}`);
      checks.push(c);
      break ej2;
    }
    if (Math.abs(bPost.r - bPost.post.perSec.mean) > 1e-12) c.fail("the point must be the posterior's mean");
    // The plan's draws come from the same belief (posteriorsOf traderBelief).
    const pp = P.posteriorsOf({ traderBelief: bPost, stockRows: rowsBefore(PRE_CUT) });
    const rs = P.makeDraws({ ...basePost(), trader: pp.trader }, 400, 7).map((d) => d.r);
    const rMean = rs.reduce((a, b) => a + b, 0) / rs.length;
    c.note(`posteriorsOf(traderBelief): draws' mean return ${(rMean * 3600).toFixed(3)}/h against the point ${(bPost.r * 3600).toFixed(3)}/h`);
    if (pp.trader !== bPost.post || Math.abs(rMean - bPost.r) > 0.1 * bPost.r) c.fail("posteriorsOf must draw the trader's return from the belief the point was taken from");
    const cash = N.postInstallMoney(9) + O.ONEOFF_EFFECTS["CashRoot Starter Kit"].startingMoney;
    const pre = price(preInputs({ capitalReturnPerSec: bPre.r, capitalScaleW: bPre.Wstar, capitalShape: bPre.shape, capitalWarmupH: bPre.warmupH, installCash: cash }), { now: true, trader: bPre.post, seed: SEED_PRE });
    const post = price({ ...POST, capitalReturnPerSec: bPost.r, capitalScaleW: bPost.Wstar, capitalShape: bPost.shape, capitalWarmupH: bPost.warmupH, installCash: cash }, { now: false, trader: bPost.post, seed: SEED_POST });
    const gap = post.mean - (pre.mean - ELAPSED_H);
    // On common random numbers (one seed for both sides) the state is the
    // only difference left: the gap must be small. Across the two lives'
    // seeds the structural draws differ (~5% on a 24-draw mean), which is
    // what exitJumpOf's tolerance carries.
    // The exp group is the other half of the state: the pre side priced the
    // next life at the farm's exp (the batcher farmed from 16:04Z); the new
    // life batched money until something was planned (EJ4 wires the farm
    // verdict onto that path). With the farm's rate on the post side too the
    // two are one state.
    const preC = price(preInputs({ capitalReturnPerSec: bPre.r, capitalScaleW: bPre.Wstar, capitalShape: bPre.shape, capitalWarmupH: bPre.warmupH, installCash: cash }), { now: true, trader: bPre.post, seed: SEED_POST });
    const postFarm = price({ ...POST, expPerSec: (F.pre.expPerSec * (POST.hacking + 50)) / (F.pre.hacking + 50), capitalReturnPerSec: bPost.r, capitalScaleW: bPost.Wstar, capitalShape: bPost.shape, capitalWarmupH: bPost.warmupH, installCash: cash }, { now: false, trader: bPost.post, seed: SEED_POST });
    const gapC = post.mean - (preC.mean - ELAPSED_H);
    const gapF = postFarm.mean - (preC.mean - ELAPSED_H);
    c.note(`common draws: pre mean ${preC.mean.toFixed(2)}h; post (money mode) gap ${gapC >= 0 ? "+" : ""}${gapC.toFixed(2)}h (${((100 * gapC) / preC.mean).toFixed(1)}%), post at the farm's exp gap ${gapF >= 0 ? "+" : ""}${gapF.toFixed(2)}h (${((100 * gapF) / preC.mean).toFixed(1)}%)`);
    if (Math.abs(gapF) > 0.03 * preC.mean) c.fail(`on common draws, one state, the post mean must be the pre mean less the elapsed hours within 3%: gap ${gapF.toFixed(2)}h`);
    if (Math.abs(gapC) > P.EXIT_JUMP.rel * preC.mean) c.fail(`with the new life still in money mode the gap must stay inside the check's tolerance: ${gapC.toFixed(2)}h`);
    c.note(`fixed: pre 'now' point ${pre.point.toFixed(2)}h mean ${pre.mean.toFixed(2)}h; post point ${post.point.toFixed(2)}h mean ${post.mean.toFixed(2)}h; mean gap after ${ELAPSED_H.toFixed(2)}h ${gap >= 0 ? "+" : ""}${gap.toFixed(2)}h (${((100 * gap) / pre.mean).toFixed(1)}%); point gap ${(post.point - pre.point + ELAPSED_H).toFixed(2)}h (the exp farm, EJ4)`);
    if (Math.abs(post.point - post.mean) > 0.1 * post.mean) c.fail(`point and draws are one distribution: post point ${post.point} vs mean ${post.mean}`);
    const v = P.exitJumpOf(F.installLast, { meanH: post.mean, pointH: post.point, n: 24 }, { lastAugReset: F.lastAugReset, now: Date.parse(F.exitinputsAt) });
    // The recorded install exits are the old model's; re-priced on the fix, the check passes.
    const recFixed = { ...F.installLast, exits: { ...F.installLast.exits, actorH: pre.point, planH: pre.mean } };
    const vFixed = P.exitJumpOf(recFixed, { meanH: post.mean, pointH: post.point, n: 24 }, { lastAugReset: F.lastAugReset, now: Date.parse(F.exitinputsAt) });
    c.note(`exitJumpOf, the fixed post against the old install record: ${v.ok === false ? "fails" : "passes"}; both sides fixed: ${vFixed.why}`);
    if (vFixed.ok !== true) c.fail(`both sides on the fix must pass the check: ${vFixed.why}`);
    // Install cash: CashRoot's grant is paid in at every install outside BitNode 8.
    const src = code("progress.js");
    if (!/installCash:\s*installCashOf\(/.test(src) || !/ONEOFF_EFFECTS\[n\]\?\.startingMoney/.test(src)) c.fail("progress.js exit inputs must carry installCashOf (postInstallMoney + owned startingMoney)");
    if (cash !== 1001262) c.fail(`CashRoot's life opens at $1,001,262 (1000 + donations 262 + $1m): ${cash}`);
    c.examined(4);
    checks.push(c);
  }

  {
    const c = new Check("EJ3", "THE CHECK: exitJumpOf fails EXIT JUMP AT INSTALL on the live record, loudly in planCheck and in installRecordCheck after the plan moved on; consistent exits and non-comparisons pass");
    const rec = F.installLast;
    const at1632 = Date.parse(F.plan.decidedAt);
    const live = P.exitJumpOf(rec, { meanH: F.plan.exit.meanH, pointH: null, n: 24 }, { lastAugReset: F.lastAugReset, now: at1632 });
    c.note(`live 16:32Z: ${live.why}`);
    if (live.ok !== false || !String(live.why).startsWith("EXIT JUMP AT INSTALL")) c.fail(`the live 94.1h against 50.06h must fail: ${live.why}`);
    // The first pass looked fine (the gate's 44.9h at 16:29Z) — the record keeps the worst.
    const early = P.exitJumpOf(rec, { meanH: 48.5, pointH: 48.9, n: 24 }, { lastAugReset: F.lastAugReset, now: Date.parse("2026-09-29T16:20:00Z") });
    const later = P.exitJumpOf(rec, { meanH: F.plan.exit.meanH, pointH: 52.8, n: 24 }, { lastAugReset: F.lastAugReset, now: at1632, prev: early });
    // A consistent pass after the jump: the failure is carried, not healed.
    const at1640 = Date.parse("2026-09-29T16:40:00Z");
    const el1640 = (at1640 - INSTALL_AT) / 3.6e6;
    const after = P.exitJumpOf(rec, { meanH: 50.06 - el1640, pointH: 50.26 - el1640, n: 24 }, { lastAugReset: F.lastAugReset, now: at1640, prev: later });
    c.note(`first pass ${early.ok}, then 16:32Z ${later.ok} (worst at ${later.worst?.elapsedH}h), carried ${after.ok} n ${after.n}`);
    if (early.ok !== true) c.fail(`a consistent first pass must pass: ${early.why}`);
    if (later.ok !== false || later.first?.at !== early.first?.at) c.fail("a later jump inside the window must fail and keep the first sample");
    if (after.ok !== false || after.worst?.meanH !== F.plan.exit.meanH) c.fail("a failure must be carried through the life, with its worst sample");
    // Not verdicts: another life's record, past the window, no exit.
    const other = P.exitJumpOf({ ...rec, at: "2026-09-29T15:22:05Z" }, { meanH: 94 }, { lastAugReset: F.lastAugReset, now: at1632 });
    const late = P.exitJumpOf(rec, { meanH: 94 }, { lastAugReset: F.lastAugReset, now: INSTALL_AT + 2 * 3.6e6 });
    const none = P.exitJumpOf(rec, null, { lastAugReset: F.lastAugReset, now: at1632 });
    const noExits = P.exitJumpOf({ ...rec, exits: null }, { meanH: 94 }, { lastAugReset: F.lastAugReset, now: at1632 });
    for (const [n, v] of [["another life's install", other], ["past the window", late], ["no exit yet", none], ["an install with no exits", noExits]]) {
      c.note(`${n}: ok ${v.ok} — ${v.why}`);
      if (v.ok !== null) c.fail(`${n} is not a verdict: ${v.ok}`);
    }
    // planCheck fails on the carried record; installRecordCheck when plan.txt moved on.
    const now = at1632 + 60e3;
    const plan = { at: new Date(now).toISOString(), node: 9, lastAugReset: F.lastAugReset, health: "ok", exitJump: live, decisions: {} };
    const pc = P.planCheck(plan, { now });
    if (!pc.fails.some((f) => f.what.startsWith("EXIT JUMP AT INSTALL"))) c.fail(`planCheck must fail on it: ${JSON.stringify(pc.fails.map((f) => f.what))}`);
    const jump = { at: plan.at, lastAugReset: F.lastAugReset, ...live };
    const ri = P.installRecordCheck(rec, { now, jump, plan: { exitJump: null } });
    const riDup = P.installRecordCheck(rec, { now, jump, plan });
    if (!ri.fails.some((f) => f.what.startsWith("EXIT JUMP AT INSTALL"))) c.fail("installRecordCheck must fail on the kept record once plan.txt no longer carries it");
    if (riDup.fails.some((f) => f.what.startsWith("EXIT JUMP AT INSTALL"))) c.fail("installRecordCheck must not repeat a failure planCheck reports");
    const ok = P.exitJumpOf(rec, { meanH: 50.06 - 0.25, pointH: 50.26 - 0.25, n: 24 }, { lastAugReset: F.lastAugReset, now: INSTALL_AT + 0.25 * 3.6e6 });
    if (ok.ok !== true) c.fail(`the install's own exits less the elapsed hours must pass: ${ok.why}`);
    c.examined(12);
    checks.push(c);
  }

  {
    const c = new Check("EJ4", "WIRING: the exit inputs' trader point and the plan's draws come from one belief; the plan record carries exitJump; the farm verdict is priced with nothing planned");
    const src = code("progress.js");
    const want = [
      [/capitalReturnPerSec:\s*traderBeliefNow\(ns, info\)\?\.r/, "exit inputs: capitalReturnPerSec from traderBeliefNow"],
      [/posteriorsOf\(\{\s*traderBelief:\s*tb/, "planCtxOf: posteriorsOf from the same belief"],
      [/exitJump = exitJumpOf\(readJson\(ns, '\/tel\/install-last\.txt'\)/, "publishPlan: exitJump from install-last"],
      [/^\s*exitJump,\s*$/m, "the plan record carries exitJump"],
    ];
    for (const [re, what] of want) if (!re.test(src)) c.fail(`progress.js: ${what}`);
    if (/stockRows:\s*bitNodeMults\(info\?\.currentNode\)\?\.ScriptHackMoneyGain === 0 \|\| capitalFitOf/.test(src)) c.fail("the trader draws must not be gated on the realised fit");
    if (/capitalReturnPerSec:\s*capitalFitOf\(/.test(src)) c.fail("the exit's trader point must not be the realised fit");
    // The farm verdict on both paths: once with nothing planned, once planned.
    const unplanned = src.slice(src.indexOf("let unplannedExtras = null"), src.indexOf("if (total > 0) {"));
    if (!/\/tel\/expfarm\.txt', JSON\.stringify\(farmVerdictOf\(/.test(unplanned)) c.fail("the farm verdict must be priced on the unplanned path (every life opened in money mode until its first batch)");
    const h = fs.readFileSync(path.join(REPO_ROOT, "tools/healthcheck.mjs"), "utf8");
    if (!/installRecordCheck\(readTel\("install-last\.txt"\), \{[^}]*jump: readTel\("exitjump\.txt"\)/.test(h)) c.fail("healthcheck F must read /tel/exitjump.txt");
    c.examined(want.length + 4);
    checks.push(c);
  }
  return checks;
}
