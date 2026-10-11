// [UW] AN UNPRICED INSTALL COMPARISON FAILS CLOSED (live BN13.1 2026-10-11).
//
// 19:28:02Z the gate installed ONE augmentation (NutriGen Implant, M = 1 on
// every rate channel) and reset the life at 0.91h: "install: 1 aug(s) — the
// simulated exit installing now is 426.8h, the best wait unpriced, never
// installing 2.1963511156357773e+39h". fixture-bn13-nutrigen-1927.json is
// that pass (/tel/installgate.txt + /tel/plan.txt decisions.install).
//
// The waits WERE priced on the point (w0.25 430.72h ... w5.09 435.56h). What
// was not priced was the plan's comparison: every option's mean, q10 and q90
// were 0h in every one of its 24 draws. The exit calibration had recorded a
// 7.2e24h 'exit sensitivity base' at 13:56Z; the drift posterior read it as
// a relative forecast error s = 1.06e9, and each draw's structural noise
// exp(s z - s^2/2) underflowed to 0. From 14:11Z every plan decision priced
// 0h everywhere; the install decision was a tie that 'now' won by listing
// order (plan.summarize: the first strict minimum), and the gate installed on
// it. "the best wait unpriced" was the gate's line for any plan-decided
// install (it nulls the exact comparison's best wait) — not the cause.
//
//   UW1 THE CAUSE   the live samples poison the drift (s ~ 1e9); an
//                   unpriced exit (0h, or past exitplan.DEGENERATE_H) is no
//                   forecast: excluded, s is ~25%. The three constants agree.
//   UW2 THE DRAWS   a draw whose structural noise is not a positive finite
//                   factor is unpriced (null), never 0h; on the live points
//                   and the poisoned posterior the install decision returns
//                   `unpriced` (no key), on the healed one it prices.
//   UW3 THE GATE    on the 19:27Z gate inputs the plan's unpriced decision
//                   (and the old 0h 'now') HOLDS — UNPRICED INSTALL
//                   COMPARISON — and the NutriGen batch is not installed;
//                   at the committed 6h life length the priced softlock
//                   escape installs, loudly.
//   UW4 PRICED      a genuinely priced install still installs, naming the
//                   plan's best priced wait; a priced wait that beats now
//                   holds.
//   UW5 NO PLAN     waits that buy a bigger batch with no priced exit hold;
//                   priced waits decide on the point as before.
//   UW6 WIRING      progress.js records no unpriced calibration sample,
//                   returns an unpriced plan decision as `unpriced` (never
//                   null), and passes the committed life length to the gate.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Check } from "./harness.mjs";
import "./gameresolve.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
const FX = JSON.parse(fs.readFileSync(path.join(REPO, "tools/test/fixture-bn13-nutrigen-1927.json"), "utf8"));
const B = await import("../../bayes.js");
const P = await import("../../plan.js");
const G = await import("../../installgate.js");
const X = await import("../../exitplan.js");
const H = 3600000;

// The live points by plan key: 'now', 'w<waitH>', 'never' (2.2e39h: degenerate).
const pointOf = (spec) => (spec?.kind === "never" ? null : spec?.waitH === 0 ? FX.points.now : FX.points[`w${spec.waitH}`] ?? null);
// A trajectory that returns the live point for its spec (the policy search's
// inputs are not published; the decision under test is the comparison, and
// the draws' structural noise is what zeroed it).
const trajOf = (spec) => {
  const h = pointOf(spec);
  return { f: () => h, fg: function* () { return h; }, noiseKey: spec?.kind === "never" ? "never" : `w${spec?.waitH ?? 0}` };
};
const pointArg = {
  now: { hours: FX.points.now },
  waits: FX.exitCompare.waits.map((w) => ({ waitH: w.waitMs / H, hours: w.H })),
  never: { hours: FX.exitCompare.neverH },
};
const decideOn = (samples) => {
  const post = P.posteriorsOf({ exitSamples: samples });
  const draws = P.makeDraws(post, 24, 12345);
  const g = P.decideInstallGen({ inputs: {}, point: pointArg, draws, redecide: true, budgetMs: 1e9, now: Date.parse("2026-10-11T19:27:43Z"), sameLife: false, trajOf });
  let r = g.next();
  while (!r.done) r = g.next();
  return { d: r.value, post };
};
// The gate's arguments at 19:27:45Z.
const gateArgs = (bayes, extra = {}) => ({
  ageMs: FX.gate.ageMs,
  M: FX.gate.M,
  queued: FX.gate.queued,
  exp: FX.gate.exp,
  target: FX.gate.target,
  futures: FX.gate.futures,
  countShort: FX.gate.countShort,
  countGain: FX.gate.countGain,
  binding: FX.gate.binding,
  homeSave: FX.gate.homeSave,
  rho: FX.gate.rho,
  favorGain: FX.gate.favorGain,
  goBonusPct: FX.gate.goBonusPct,
  lifeTargetH: FX.lifeTargetH,
  prev: { ageMs: FX.gate.ageMs - 300000, M: FX.gate.M },
  exitCompare: { ...FX.exitCompare, bayes },
  ...extra,
});

export async function run() {
  const checks = [];

  const c1 = new Check("UW1", "an unpriced exit is not a forecast: the live calibration samples no longer poison the drift posterior");
  {
    c1.examined(FX.exitCalibrationSamples.length);
    if (!(B.EXIT_UNPRICED_H === X.DEGENERATE_H && G.UNPRICED_EXIT_H === X.DEGENERATE_H)) c1.fail(`bayes.EXIT_UNPRICED_H ${B.EXIT_UNPRICED_H}, installgate.UNPRICED_EXIT_H ${G.UNPRICED_EXIT_H} and exitplan.DEGENERATE_H ${X.DEGENERATE_H} must agree`);
    const d = B.driftPosterior(FX.exitCalibrationSamples);
    c1.note(`drift on the 19:27Z samples: s = ${d.s.toPrecision(4)} over ${d.pairs} pairs, excluded ${JSON.stringify(d.excluded)}`);
    if (!(Number.isFinite(d.s) && d.s < 1)) c1.fail(`the drift posterior must not read an unpriced exit as forecast error (s = ${d.s}, live 1.06e9)`);
    if (!((d.excluded?.unpriced ?? 0) >= 1)) c1.fail(`the unpriced samples are named as excluded: ${JSON.stringify(d.excluded)}`);
    const big = FX.exitCalibrationSamples.find((x) => x.exitH > 1e5);
    if (!big) c1.fail("the fixture carries the 7.2e24h sample");
    else if (typeof B.pricedExitH !== "function") c1.fail("bayes.pricedExitH is missing");
    else if (B.pricedExitH(big.exitH) || B.pricedExitH(0) || !B.pricedExitH(426.8)) c1.fail("pricedExitH: 7.2e24h and 0h unpriced, 426.8h priced");
  }
  checks.push(c1);

  const c2 = new Check("UW2", "a draw whose structural noise is not a duration is unpriced; the live decision is unpriced, not 'now' on a 0h tie");
  {
    c2.examined(3);
    // One option, a 426.77h point, on a draw whose drift variance is the live 1e18.
    const draw = { i: 0, seed: 1, s2: 1.06e9 ** 2, si2: 0.0004, zc: 0.3 };
    const ev = P.evaluate([{ key: "now", sim: () => 426.77 }], [draw, { ...draw, i: 1 }]);
    if (ev.samples.now.some((x) => x === 0)) c2.fail(`an underflowed structural factor priced the exit at 0h: ${JSON.stringify(ev.samples.now)}`);
    const live = decideOn(FX.exitCalibrationSamples.map((x) => ({ ...x })));
    // The posterior AS PUBLISHED at 19:27Z (before the exclusion): s = 1.06e9.
    const poisoned = { ...live.post, drift: { ...live.post.drift, a: 2 + 9, b: (1.0578624395177128e9 ** 2) * 10, s: 1.0578624395177128e9 } };
    const dp = (() => {
      const draws = P.makeDraws(poisoned, 24, 12345);
      const g = P.decideInstallGen({ inputs: {}, point: pointArg, draws, redecide: true, budgetMs: 1e9, now: Date.parse("2026-10-11T19:27:43Z"), sameLife: false, trajOf });
      let r = g.next();
      while (!r.done) r = g.next();
      return r.value;
    })();
    c2.note(`poisoned posterior: key ${dp.key}, unpriced ${dp.unpriced === true}, ${String(dp.why).slice(0, 140)}`);
    if (dp.key !== null || dp.unpriced !== true) c2.fail(`on the live (poisoned) draws the install decision must be UNPRICED, got key ${dp.key} meanH ${dp.meanH} (live: 'now', meanH 0)`);
    c2.note(`healed posterior (s ${live.post.drift.s.toFixed(3)}): key ${live.d.key}, meanH ${live.d.meanH}, best wait ${JSON.stringify(P.bestWaitOfOptions?.(live.d) ?? 'plan.bestWaitOfOptions missing')}`);
    if (!(typeof live.d.meanH === "number" && live.d.meanH > 100)) c2.fail(`on the healed posterior the decision prices a real exit, got ${live.d.key} ${live.d.meanH}`);
  }
  checks.push(c2);

  const c3 = new Check("UW3", "on the 19:27Z gate inputs the NutriGen batch is NOT installed on an unpriced comparison; the life-length escape installs loudly");
  {
    c3.examined(4);
    const unpriced = { unpriced: true, install: false, key: null, H: null, why: "UNPRICED DRAWS: no install option priced a positive exit in any of 24 draws" };
    for (const [name, bayes] of [["the plan's unpriced decision", unpriced], ["the live 0h 'now' record", FX.oldBayes]]) {
      const g = G.shouldInstall(gateArgs(bayes));
      c3.note(`${name}: install ${g.install} — ${g.why.slice(0, 180)}`);
      if (g.install !== false) c3.fail(`${name}: the gate installed the lone NutriGen batch (${g.why})`);
      else if (!/UNPRICED INSTALL COMPARISON/.test(g.why)) c3.fail(`${name}: the hold names the unpriced comparison: ${g.why}`);
    }
    const esc = G.shouldInstall(gateArgs(unpriced, { ageMs: 6.05 * H, prev: { ageMs: 6 * H, M: FX.gate.M } }));
    c3.note(`at 6.05h (committed L6): install ${esc.install} — ${esc.why.slice(0, 160)}`);
    if (esc.install !== true || !/SOFTLOCK ESCAPE/.test(esc.why)) c3.fail(`at the committed life length the priced softlock escape installs, loudly: ${esc.why}`);
    const noL = G.shouldInstall(gateArgs(unpriced, { ageMs: 9 * H, lifeTargetH: null, prev: { ageMs: 8.9 * H, M: FX.gate.M } }));
    if (noL.install !== false) c3.fail(`no committed life length: no escape (${noL.why})`);
    // Installing now past DEGENERATE_H on the point (the published 19:27Z
    // exit inputs price it 5.68e8h) is no exit to install on either.
    const degen = { install: true, key: "now", waitMs: 0, H: 5.68e8, q10: 5e8, q50: 5.6e8, q90: 6e8, pBest: 1, held: false, why: "now" };
    const dg = G.shouldInstall(gateArgs(degen, { exitCompare: { ...FX.exitCompare, nowH: 5.68e8, bayes: degen } }));
    c3.note(`degenerate now: install ${dg.install} — ${dg.why.slice(0, 140)}`);
    if (dg.install !== false || !/installing now is itself unpriced/.test(dg.why)) c3.fail(`a degenerate install-now exit holds: ${dg.why}`);
  }
  checks.push(c3);

  const c4 = new Check("UW4", "a priced install still installs and names the plan's best priced wait; a priced wait that wins holds");
  {
    c4.examined(2);
    const priced = { install: true, key: "now", waitMs: 0, H: 426.9, q10: 410, q50: 426, q90: 445, pBest: 0.9, held: false, why: "no committed option: the least expected exit", bestWait: { key: "w0.25", H: 430.8, pointH: 430.724, by: "draws" } };
    const g = G.shouldInstall(gateArgs(priced));
    c4.note(`priced now: install ${g.install} — ${g.why.slice(0, 200)}`);
    if (g.install !== true) c4.fail(`a priced install-now must install: ${g.why}`);
    if (!/best wait w0\.25 430\.8h/.test(g.why) || /best wait unpriced/.test(g.why)) c4.fail(`the line names the plan's best priced wait: ${g.why}`);
    if (!/never installing unpriced \(2\.20e\+39h/.test(g.why)) c4.fail(`a degenerate never is named unpriced: ${g.why}`);
    const wait = { install: false, key: "w0.25", waitMs: 0.25 * H, H: 425.1, q10: 410, q50: 425, q90: 444, pBest: 0.7, held: false, why: "switch now -> w0.25" };
    const h = G.shouldInstall(gateArgs(wait));
    if (h.install !== false) c4.fail(`the plan's priced wait holds: ${h.why}`);
  }
  checks.push(c4);

  const c5 = new Check("UW5", "no plan: waits that buy more with no priced exit hold; priced waits decide on the point");
  {
    c5.examined(2);
    const blind = G.shouldInstall(gateArgs(null, { exitCompare: { ...FX.exitCompare, waits: FX.exitCompare.waits.map((w) => ({ ...w, H: null })), bayes: null } }));
    c5.note(`unpriced waits: install ${blind.install} — ${blind.why.slice(0, 160)}`);
    if (blind.install !== false || !/UNPRICED INSTALL COMPARISON/.test(blind.why)) c5.fail(`waits that buy M>1 with no priced exit hold: ${blind.why}`);
    const pt = G.shouldInstall(gateArgs(null, { exitCompare: { ...FX.exitCompare, bayes: null } }));
    c5.note(`priced waits (point): install ${pt.install} — ${pt.why.slice(0, 160)}`);
    if (pt.install !== true || /UNPRICED/.test(pt.why)) c5.fail(`priced point waits decide as before: ${pt.why}`);
  }
  checks.push(c5);

  const c6 = new Check("UW6", "wiring: no unpriced calibration sample recorded; an unpriced plan decision reaches the gate as `unpriced`; the life length reaches the gate");
  {
    c6.examined(3);
    const pj = src("progress.js");
    if (!/const due = pricedExitH\(exitH\)/.test(pj)) c6.fail("withExitSample records only priced exits (pricedExitH)");
    if (!/return \{ unpriced: true, install: false, key: null/.test(pj)) c6.fail("planInstallOf returns an unpriced decision as { unpriced: true } (never null, never a 0h mean)");
    if (!/shouldInstall\(\{\s*homeSave: homeSaveNow,\s*exitCompare,\s*lifeTargetH:/.test(pj)) c6.fail("progress.js passes the committed life length (lifeTargetH) to the gate");
    const pl = src("plan.js");
    if (!/samples\[o\.key\]\.push\(fin\(x\) && x > 0 \? x : null\)/.test(pl)) c6.fail("plan.simInto: a non-positive or non-finite draw is unpriced");
  }
  checks.push(c6);

  const c7 = new Check("UW7", "the healthcheck's plan read fails on the 19:27Z record (0h draws, s = 1e9) and on an unpriced install decision");
  {
    c7.examined(3);
    const at = "2026-10-11T19:27:45.081Z";
    const now = Date.parse(at) + 60e3;
    const live = { at, lastAugReset: 1791743588042, health: "ok", decisions: { install: FX.planInstall }, posteriors: { s: 1.0578624395177128e9, driftWhy: "18 same-life pairs" } };
    const r = P.planCheck(live, { now });
    const has = (re) => r.fails.some((f) => re.test(f.what));
    if (!has(/PLAN DRAWS DEGENERATE/)) c7.fail(`PLAN DRAWS DEGENERATE on 'now' point 426.77h, mean 0h: ${JSON.stringify(r.fails.map((f) => f.what))}`);
    if (!has(/DRIFT POSTERIOR ABSURD/)) c7.fail(`DRIFT POSTERIOR ABSURD at s = 1.06e9: ${JSON.stringify(r.fails.map((f) => f.what))}`);
    const u = P.planCheck({ ...live, posteriors: { s: 0.25 }, decisions: { install: { key: null, unpriced: true, install: false, why: "UNPRICED DRAWS: ..." } } }, { now });
    if (!u.fails.some((f) => /INSTALL COMPARISON UNPRICED/.test(f.what))) c7.fail(`INSTALL COMPARISON UNPRICED: ${JSON.stringify(u.fails.map((f) => f.what))}`);
    const ok = P.planCheck({ ...live, posteriors: { s: 0.25 }, decisions: { install: { ...FX.planInstall, meanH: 426.9 } } }, { now });
    if (ok.fails.some((f) => /DEGENERATE|UNPRICED|ABSURD/.test(f.what))) c7.fail(`a priced plan raises none of them: ${JSON.stringify(ok.fails.map((f) => f.what))}`);
  }
  checks.push(c7);
  return checks;
}
