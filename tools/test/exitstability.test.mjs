// [ES] The plan's exit is one trajectory's price, stable between events.
//
// Live BN9 2026-09-29 after 198f8a2 (the trader's r(W) curve), consecutive
// plan passes of ONE life (fixture-bn9-exitswing-1922: 19:22, 19:27, 19:32Z):
//   19:22Z  held  w3.166  70.98h  (install priced 9 grafts, graft decision 6;
//                                  options from 18:52Z at 241-373h beside it;
//                                  "63.73h sooner" against a 71h exit)
//   19:27Z  event w3.32   45.72h  SWITCH ARTEFACT: "the incumbent, 71.0h when
//                                  last priced, is unpriceable now (0.333 of
//                                  draws)"
//   19:32Z  held  w3.237  12.88h  (nothing re-decided)
// What moved, measured on the fixture (the replays below):
//   - NOT the r(W) posterior: the ledger folds exactly the rows the clock
//     added (5 intervals per 5-minute pass, no bin re-folded), the posterior
//     replays the published r0 / W* exactly, and it moves ~0.1 sd a pass;
//   - duplicate option keys (two waits of one length): 48 or 72 samples under
//     one key, every single-key option "feasible" in 24/48 or 24/72 of the
//     draws — the 19:27 incumbent read 0.333 and was switched away from;
//   - the graft set: a budget-stopped search re-ran every pass and replaced
//     the committed set under the held key 'grafts' (9, 7, 1 grafts), the
//     rebase then committed yet another (6) — install and graft decisions on
//     two sets, g9 vs g6;
//   - point inputs read off a single noisy sample: the exp farm's share
//     (0.05 or 0.10 by the 30s batch.txt sample; the fresh-life exp formula
//     x3), the purchase model's life length (12h -> 0.5h, whose lives then
//     compounded the batch lift x1.26 every half hour: 70.8h -> 14.1h), the
//     budget elasticity eBudget (0, 0.120, 0.147, 0.027 on consecutive passes).
//
//   ES1 NO DUPLICATE KEYS   evaluateGen refuses a repeated key; decideInstall
//                           prices a repeated wait once; the 19:27 replay
//                           keeps its incumbent feasible, with no artefact
//   ES2 THE POSTERIOR       replayed from each pass's ledger it is the
//                           published one; the ledger grows by the elapsed
//                           rows only; a pass moves it < 0.3 sd
//   ES3 THE INPUTS          on the 19:32 inputs 0.5h lives no longer compound
//                           the lift (exitplan liftShare): the 12h exit stands
//                           and 0.5h is far slower; the 19:27 -> 19:32 swing
//                           attributed to the cadence
//   ES4 EXIT UNSTABLE       fails on the live 19:27 -> 19:32 pair, passes a
//                           re-priced held decision, skips event passes;
//                           planCheck fails loudly and keeps it for an hour
//   ES5 OPTIONS OFF BASIS   fails on the live 19:22 and 19:32 records (held
//                           options from another pass; grafts g6 vs install
//                           g9); passes a held decision priced this pass
//   ES6 WIRING              progress.js: the committed graft set is option
//                           'grafts', the search and memory are challengers,
//                           the rebase prices the carried set only; the farm
//                           share and eBudget are smoothed; publishPlan
//                           records exitStability

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const P = await import("../../plan.js");
const B = await import("../../bayes.js");
const T = await import("../../traderw.js");
const E = await import("../../exitplan.js");

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-exitswing-1922.json"), "utf8"));
const [A, Bp, C] = F.passes; // 19:22, 19:27, 19:32
const fin = (x) => typeof x === "number" && isFinite(x);
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8");
const noGrafts = (x) => {
  const b = { ...x };
  delete b.finalGrafts;
  delete b.lifeGrafts;
  delete b.graftStartMoney;
  return b;
};
const PRIOR = T.RW_PRIOR["pre-long"];
const traderOf = (led) => B.traderRwPosterior(null, { prior: PRIOR, regime: "pre-long", ledger: led, shape: (w, ws) => T.rwShape(w, ws, PRIOR.shape) });
/** A pass's posteriors, the trader's replayed from its own ledger. */
function postOf(pass) {
  const ps = pass.plan.posteriors;
  const c = ps.cadence;
  return {
    trader: traderOf(pass.stockRw),
    drift: { s: ps.s, nu: ps.driftNu ?? 4, a: 2, b: 2 * ps.s * ps.s },
    jitter: B.PRIORS.jitter,
    gymSdLn: 0.1,
    cadence: c ? { rate: { mean: Math.log(c.lnPerHour), sd: c.rateSdLn }, life: { mean: Math.log(c.cycleHours), sd: c.lifeSdLn }, own: { weight: c.ownWeight } } : null,
    expPost: ps.exp ? { perSec: ps.exp.perSec, sd: ps.exp.sdLn } : null,
    income: ps.income ? { perSec: ps.income.perSec, mean: Math.log(ps.income.perSec), sd: ps.income.sdLn } : null,
  };
}

export async function run() {
  const checks = [];

  {
    const c = new Check("ES1", "NO DUPLICATE KEYS: evaluateGen refuses a repeated key, decideInstall prices a repeated wait once, and the 19:27 replay keeps the incumbent feasible with no SWITCH ARTEFACT");
    c.examined(4);
    // The mechanism, as it read live: one key holding 72 samples beside 24.
    const s = P.summarize({ committed: Array(24).fill(70), "w0.5": Array(72).fill(75) });
    c.note(`the live mechanism: an option with 24 samples beside a key holding 72 reads pFeasible ${s.stats.committed.pFeasible}`);
    let threw = null;
    try {
      P.evaluate([{ key: "a", sim: () => 1 }, { key: "a", sim: () => 2 }], [{ i: 0 }]);
    } catch (e) {
      threw = String(e);
    }
    if (!threw || !/appears twice/.test(threw)) c.fail(`evaluateGen must refuse a repeated option key: ${threw}`);
    // The 19:27 decision replayed: the waits as published (their duplicates
    // included), the incumbent the 19:22 commitment on its remaining wait.
    const inputs = Bp.exitinputs.inputs;
    const now = Date.parse(Bp.plan.at);
    const prev = A.plan.decisions.install;
    const draws = P.makeDraws(postOf(Bp), P.PLAN.N, P.seedOf(Bp.plan.lastAugReset, 9));
    const rows = Bp.plan.decisions.install.options.filter((o) => /^w[\d.]+$/.test(o.key));
    const waits = rows.map((o) => ({ waitH: +o.key.slice(1), hours: o.pointH }));
    c.note(`19:27 published ${rows.length} wait rows, ${new Set(rows.map((o) => o.key)).size} distinct keys; incumbent read ${Bp.plan.decisions.install.options.find((o) => o.key === "committed")?.pFeasible} feasible live`);
    const d = P.decideInstall({ inputs, point: { waits, committedGains: prev.gains }, prev, draws, redecide: true, now, sameLife: true });
    const keys = d.options.map((o) => o.key);
    const inc = d.options.find((o) => o.key === "committed");
    c.note(`replayed: ${d.key} ${d.meanH}h — ${d.why}; incumbent ${inc?.meanH}h feasible ${inc?.pFeasible}; ${keys.length} options`);
    if (new Set(keys).size !== keys.length) c.fail(`option keys must be unique: ${keys.join(",")}`);
    if (!inc || inc.pFeasible !== 1) c.fail(`the incumbent is feasible in every draw: ${JSON.stringify(inc)}`);
    if (d.switchSanity) c.fail(`no SWITCH ARTEFACT on the replay: ${d.switchSanity.why}`);
    if (d.options.some((o) => fin(o.pFeasible) && Math.abs(o.pFeasible * 24 - Math.round(o.pFeasible * 24)) > 0.02)) c.fail("every pFeasible is a count of the 24 draws");
    checks.push(c);
  }

  {
    const c = new Check("ES2", "THE POSTERIOR: replayed from each pass's persistent ledger it is the published r(W) point; the ledger grows by the elapsed intervals only; one pass moves it < 0.3 sd");
    c.examined(F.passes.length);
    const posts = F.passes.map((p) => traderOf(p.stockRw));
    F.passes.forEach((p, i) => {
      const pub = p.plan.posteriors.trader;
      const r = posts[i];
      c.note(`${p.plan.at}: replay r0 ${(r.perHour.mean * 100).toFixed(2)}%/h W* ${r.Wstar.toExponential(3)} (sd ln ${r.lnWstar.sd.toFixed(3)}); published ${(pub.perHour * 100).toFixed(2)}%/h ${pub.Wstar.toExponential(3)}`);
      if (Math.abs(r.perHour.mean - pub.perHour) > 5e-4 || Math.abs(r.Wstar / pub.Wstar - 1) > 1e-3) c.fail(`${p.plan.at}: the replayed posterior is not the published one`);
    });
    const count = (L) => L.runs.reduce((a, r) => a + Object.values(r.bins).reduce((q, b) => q + b[4], 0), 0);
    for (let i = 1; i < F.passes.length; i++) {
      const a = F.passes[i - 1].stockRw;
      const b = F.passes[i].stockRw;
      const ticks = b.lastRow.t - a.lastRow.t;
      const added = count(b) - count(a);
      const rowsElapsed = Math.round((ticks * 6) / 60); // stock-hist: one row a minute, 6s ticks
      c.note(`${a.at} -> ${b.at}: +${added} interval(s) over ${ticks} ticks (${rowsElapsed} rows)`);
      if (added < 0 || added > rowsElapsed + 1) c.fail(`the ledger must add at most the rows the clock added: +${added} vs ${rowsElapsed}`);
      // Old runs untouched: only the current run's bins change.
      for (const r of a.runs.filter((r) => r.id !== a.lastRow.seg)) {
        const rb = b.runs.find((x) => x.id === r.id);
        if (rb && JSON.stringify(rb.bins) !== JSON.stringify(r.bins)) c.fail(`run ${r.id}: a finished run's bins were re-folded`);
      }
      const zr = Math.abs(posts[i].perHour.mean - posts[i - 1].perHour.mean) / posts[i - 1].perHour.sd;
      const zw = Math.abs(posts[i].lnWstar.mean - posts[i - 1].lnWstar.mean) / posts[i - 1].lnWstar.sd;
      c.note(`   posterior move: r0 ${zr.toFixed(3)} sd, ln W* ${zw.toFixed(3)} sd`);
      if (!(zr < 0.3 && zw < 0.3)) c.fail(`one pass's rows must move the posterior by little: r0 ${zr.toFixed(2)} sd, W* ${zw.toFixed(2)} sd`);
    }
    checks.push(c);
  }

  {
    const c = new Check("ES3", "THE INPUTS: the 19:27 -> 19:32 swing is the purchase model's life length; 0.5h lives no longer compound the batch lift (exitplan liftShare)");
    c.examined(3);
    const spec = P.basisOf(C.plan.decisions.install, Date.parse(C.plan.at));
    const I32 = noGrafts(C.exitinputs.inputs);
    const I27 = noGrafts(Bp.exitinputs.inputs);
    const t = P.trajectoryOf(spec);
    const on32 = t(I32);
    const cad27 = t({ ...I32, cycleHours: I27.cycleHours, multGainPerCycle: I27.multGainPerCycle });
    c.note(`19:32 inputs (0.5h lives x${I32.multGainPerCycle.toFixed(4)}): ${on32?.toFixed?.(2)}h; with 19:27's 12h lives x${I27.multGainPerCycle.toFixed(3)}: ${cad27?.toFixed?.(2)}h (live 12.88h, point 13.23h)`);
    const x = { ...I32, firstInstallH: spec.waitH, installGains: spec.gains, nextInstallGain: spec.gains.hacking };
    const r05 = E.bestExitPolicy({ ...x, cycleHours: 0.5, multGainPerCycle: 1.0027 }, 400, 1).best;
    const r12 = E.bestExitPolicy({ ...x, cycleHours: 12, multGainPerCycle: 1.266 }, 400, 1).best;
    c.note(`one trajectory, two life lengths: 0.5h ${r05?.hours?.toFixed(1)}h (${r05?.installsFirst} installs, mult -> ${r05?.mult?.toFixed(1)}); 12h ${r12?.hours?.toFixed(1)}h (mult -> ${r12?.mult?.toFixed(1)})`);
    if (!(fin(r12?.hours) && Math.abs(r12.hours - 70.8) < 3)) c.fail(`12h lives keep their exit (~70.8h): ${r12?.hours}`);
    if (fin(r05?.hours) && r05.hours < r12.hours) c.fail(`x1.0027 half-hour lives must not beat x1.27 12h lives by compounding a lift measured on a x1.13 batch: ${r05.hours}h (mult ${r05.mult})`);
    if (!(fin(cad27) && cad27 > 60)) c.fail(`the 12h cadence prices the 19:32 trajectory near 71h: ${cad27}`);
    checks.push(c);
  }

  {
    const c = new Check("ES4", "EXIT UNSTABLE: fails on the live 19:27 -> 19:32 pair (no event), passes a held decision re-priced on its own draws, skips event passes; planCheck fails and keeps it for the hour");
    c.examined(5);
    const live = P.exitStabilityOf(Bp.plan, C.plan);
    const ev = P.exitStabilityOf(A.plan, Bp.plan);
    c.note(`19:27 -> 19:32: ${live.why}`);
    c.note(`19:22 -> 19:27: ${ev.why}`);
    if (live.ok !== false || !/^EXIT UNSTABLE/.test(live.why)) c.fail(`the live pair must fail: ${JSON.stringify(live)}`);
    if (ev.ok !== null) c.fail("an event pass may move the exit");
    const deploy = P.exitStabilityOf({ ...Bp.plan, ver: "a.1" }, { ...C.plan, ver: "b.1" });
    if (deploy.ok !== null) c.fail(`a deploy (another model version) re-prices the exit, it is not drift: ${deploy.why}`);
    // A held decision re-priced on the same draws five minutes later.
    const inputs = C.exitinputs.inputs;
    const draws = P.makeDraws(postOf(C), P.PLAN.N, P.seedOf(C.plan.lastAugReset, 9));
    const prevInst = C.plan.decisions.install;
    const now1 = Date.parse(C.plan.at);
    const d1 = P.decideInstall({ inputs, point: { committedGains: prevInst.gains }, prev: prevInst, draws, redecide: false, now: now1, sameLife: true });
    const d2 = P.decideInstall({ inputs: { ...inputs, money: inputs.money * 1.02 }, point: { committedGains: prevInst.gains }, prev: d1, draws, redecide: false, now: now1 + 5 * 60e3, sameLife: true });
    const rec = (d, at) => ({ at: new Date(at).toISOString(), node: 9, lastAugReset: C.plan.lastAugReset, events: [], exit: { meanH: d.meanH, q10: d.q10, q90: d.q90, source: `install decision (${d.key})` }, decisions: { install: d } });
    const r1 = rec(d1, now1);
    const r2 = rec(d2, now1 + 5 * 60e3);
    const held = P.exitStabilityOf(r1, r2);
    c.note(`held re-price: ${held.why}`);
    if (held.ok !== true) c.fail(`a held decision re-priced on its own draws is stable: ${held.why}`);
    const chk = P.planCheck({ ...C.plan, exitStability: live, at: new Date().toISOString() }, { now: Date.now() });
    if (!chk.fails.some((f) => /^EXIT UNSTABLE/.test(f.what))) c.fail("planCheck must fail EXIT UNSTABLE");
    const later = P.exitStabilityOf({ ...C.plan, exitStability: live }, { ...C.plan, at: new Date(Date.parse(C.plan.at) + 5 * 60e3).toISOString(), exit: { ...C.plan.exit, meanH: C.plan.exit.meanH - 5 / 60 } });
    if (!later.lastFail) c.fail(`the failure must stay on the next record for the hour: ${JSON.stringify(later).slice(0, 200)}`);
    checks.push(c);
  }

  {
    const c = new Check("ES5", "OPTIONS OFF BASIS: fails on the live 19:22 and 19:32 records; passes a held decision priced on this pass");
    c.examined(3);
    for (const p of [A, C]) {
      const r = P.optionsBasisOf(p.plan);
      c.note(`${p.plan.at}: ${r.why}`);
      if (r.ok !== false) c.fail(`${p.plan.at}: the live record must be off basis`);
    }
    if (!P.optionsBasisOf(A.plan).fails.some((f) => /g6.*g9|two graft sets/.test(f))) c.fail("19:22: the graft decision on g6 beside the install on g9 must be named");
    const inputs = C.exitinputs.inputs;
    const draws = P.makeDraws(postOf(C), P.PLAN.N, P.seedOf(C.plan.lastAugReset, 9));
    const d = P.decideInstall({ inputs, point: { committedGains: C.plan.decisions.install.gains }, prev: C.plan.decisions.install, draws, redecide: false, now: Date.parse(C.plan.at), sameLife: true });
    const ok = P.optionsBasisOf({ decisions: { install: d } });
    c.note(`held, re-priced: ${ok.why}; why: ${d.why.slice(0, 120)}`);
    if (ok.ok !== true) c.fail(`a held decision's own options are on its basis: ${ok.why}`);
    if (d.options.length !== 1 || d.options[0].pricedAt !== d.pricedAt) c.fail("a held decision publishes this pass's pricing only");
    checks.push(c);
  }

  {
    const c = new Check("ES6", "WIRING: the committed graft set holds against challengers; the rebase prices the carried set; the farm share and eBudget are smoothed; exitStability is published");
    const prog = code("progress.js");
    const need = [
      [/setsIn\.push\(\{ key: 'grafts:search'/, "this pass's search is a challenger to the committed set"],
      [/key: 'grafts:memory'/, "the node's memory is a challenger"],
      [/redecide: pc\.redecide \|\| !prev \|\| challengers\.length > 0/, "a challenger is decided by the commitment rule"],
      [/const wi = pc\.graftChosen\?\.specs\?\.length \? inputsOfSet\(wo, pc\.graftChosen\)/, "the rebase prices the set the install carried"],
      [/const challengers = allChallengers\.filter\(\(a\) => inReach\(pointCh\[a\.key\]\)\)/, "a challenger enters the draws only if its point could win (live 20:02Z the 287h memory set left the install 3 draws)"],
      [/simGen: \(d\) => trajGen\(applyDraw\(x, d\), d\)/, "graft options price as generators (a 189ms step blocked the page live)"],
      [/const shareObs = /, "the exp farm's share is averaged over the life"],
      [/const eBudgetObs = /, "eBudget is averaged over the life"],
      [/rec\.exitStability = exitStabilityOf\(pc\.prevAny/, "publishPlan records exitStability"],
    ];
    for (const [re, what] of need) {
      c.examined(1);
      if (!re.test(prog)) c.fail(`missing: ${what}`, String(re));
    }
    if (/rp\.pick|graftSetOn\(/.test(prog)) c.fail("the rebase must not choose among sets by point");
    checks.push(c);
  }
  {
    const c = new Check("ES7", "PER-LIFE GAIN: the later lives buy what the purchase model buys — 20:22Z's 42 lives of x1.153 at 0.5h are gone, the exit's best life length is a long one, and PER-LIFE GAIN UNBOUGHT fails on the live figure");
    const G = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-perlife-2022.json"), "utf8"));
    const I = G.exitinputs.inputs;
    const spec = P.basisOf(G.install, Date.parse(G.at));
    const base = { ...I, firstInstallH: spec.waitH, installGains: spec.gains, nextInstallGain: spec.gains.hacking };
    c.examined(5);
    // The purchase model's own answer for a 0.5h life: its table row.
    const row = I.cadence.table.find((r) => r.L === 0.5);
    const buyer = E.purchaseGainOf(I.cadence, 0.5, I.cadenceFrom);
    c.note(`the purchase model: a 0.5h life earns $${row.money.toExponential(2)} (calibrated) and buys x${row.gain} (${row.first} augmentations, ${row.firstNfg} NeuroFlux levels in its first life, the catalogue depleting over ${row.lives} lives); purchaseGainOf reads $${buyer.mL.toExponential(2)} -> x${buyer.gL.toFixed(4)}`);
    if (!(Math.abs(buyer.gL / row.gain - 1) < 1e-6 && Math.abs(buyer.mL / row.money - 1) < 1e-6)) c.fail("purchaseGainOf must read the table's own row at its length");
    const byL = I.cadence.table.map((r) => ({ L: r.L, g: r.gain, b: E.bestExitPolicy({ ...base, cycleHours: r.L, multGainPerCycle: r.gain }, 400, 1).best }));
    c.note(byL.map((x) => `${x.L}h ${Number.isFinite(x.b?.hours) && x.b.hours < 1e4 ? x.b.hours.toFixed(1) : "unreached"} (x${x.b?.perLife ? Math.exp(x.b.perLife.pricedLn).toFixed(4) : "-"}/life)`).join("; "));
    const live = E.bestExitPolicy(base, 400, 1).best;
    c.note(`the live inputs (0.5h x${I.multGainPerCycle.toFixed(4)}): ${live.hours.toExponential(3)}h, ${live.installsFirst} installs, x${Math.exp(live.perLife.pricedLn).toFixed(4)} a life (live 20:22Z: 33.2h, x1.153)`);
    if (!(live.perLife.pricedLn < Math.log(1.01))) c.fail(`a 0.5h life must not be priced at more than x1.01: x${Math.exp(live.perLife.pricedLn)}`);
    const best = byL.filter((x) => Number.isFinite(x.b?.hours)).sort((a, b) => a.b.hours - b.b.hours)[0];
    if (!(best && best.L >= 6)) c.fail(`the exit's best life length must be a long one: ${best?.L}h`);
    for (const x of byL) {
      const k = P.perLifeGainCheckOf(x.b);
      if (k.ok === false) c.fail(`${x.L}h: ${k.why}`);
    }
    const bad = P.perLifeGainCheckOf({ perLife: { lives: 42, cycleHours: 0.5, pricedLn: Math.log(1.153), boughtLn: Math.log(1.0626), moneyL: row.money, kAll: 128 } });
    c.note(`the live 20:22Z figure: ${bad.why}`);
    if (bad.ok !== false || !/^PER-LIFE GAIN UNBOUGHT/.test(bad.why)) c.fail("PER-LIFE GAIN UNBOUGHT must fail on the live figure");
    const chk = P.planCheck({ at: new Date().toISOString(), perLifeGain: bad }, { now: Date.now() });
    if (!chk.fails.some((f) => /^PER-LIFE GAIN UNBOUGHT/.test(f.what))) c.fail("planCheck must fail PER-LIFE GAIN UNBOUGHT");
    checks.push(c);
  }
  return checks;
}
