// [LL] THE LATER LIVES' LENGTH IS A PLAN DECISION.
//
// Live BN9 2026-09-30 the purchase model's chooser (lifeplan.cadenceByPurchases,
// feeding every exit input's cycle) moved the exit with nothing re-deciding:
// 07:04Z 0.5h -> 3h (EXIT UNSTABLE 15.5h -> 26.2h), 07:14Z 0.5h (the
// committed install's point 109h), 08:24Z 0.5h right after the 08:19Z install
// (the full trajectory 54h), 08:30Z 8h, 08:35Z 6h (EXIT UNSTABLE 42.7h ->
// 27.5h), 09:00Z/09:05Z 6h -> 4h -> 6h, 09:20Z-10:25Z 3h/4h every pass or two.
// It priced each length on the DEFAULT policy (this life's install AT the
// length), without the committed install's batch, with no draws and no
// incumbent — so it could pick a length the committed trajectory rejects.
//
// Now plan.decideLifeLengthGen: each length is the committed trajectory
// (the committed install's spec; grafts, carried streams, the trader's r(W)
// belief and the next install's batch on the inputs — lifeplan.lifeInputsOf)
// on the plan's draws, the incumbent held unless another length is better
// with P >= theta net of a switch cost; a switch is an event; the length is on
// every noise key, and LIFE LENGTH OFF BASIS fails a decision priced on another.
//
// fixture-bn9-lifelength-0714: 16 captured passes (plan.txt with the
// exitinputs.txt each published; /tmp/fx/hist, the recorder /tmp/fx/poll.sh):
// 06:54-07:30Z, 08:19-08:40Z (the install at 08:19:55Z), 08:55-09:05Z.
// Replayed by tools/sim/exitjump/lifelength.mjs (its CHECK: the shipped
// trajectory re-priced against each pass's published point).
//
//   LL1 REPLAY      the chooser's flips against the committed length: the
//                   committed L holds on every pass that re-decided nothing
//                   (07:04, 08:24's near-tie, 09:00, 09:05), switches only
//                   through the rule; on the no-event pairs where the chooser
//                   flipped, the exit on the committed L is within EXIT
//                   UNSTABLE's tolerance; 07:14's 0.5h (point 109h) and
//                   08:24's 0.5h (54h) are not chosen
//   LL2 THE RULE    a genuinely better length wins (07:14 L2 -> L16, and an
//                   incumbent L24 on the 07:24 inputs), a near-tie does not
//                   (08:24 L8 vs L16, P < theta), a held decision never switches
//   LL3 ONE BELIEF  the posterior at any length from the one at the model's
//                   (lifeCadenceAt) is the direct posterior (bayes); the point
//                   is the draws' median, every length on the same z
//   LL4 OFF BASIS   lifeLengthBasisOf: passes one L, fails a decision on
//                   another (the 07:14 install decision priced on the
//                   chooser's 0.5h against a committed L16), skips carried
//                   decisions; planCheck fails LIFE LENGTH OFF BASIS
//   LL5 UNSTABLE    EXIT UNSTABLE reads the length on the basis: the shipped
//                   06:59 -> 07:04 pair fails naming it; a switch recorded as
//                   an event does not
//   LL6 COHERENCE   the install decision prices on the committed length: its
//                   committed option IS the life length decision's committed
//                   option (one noise key, one exit on the same draws); every
//                   option differs from it in the later lives only (this
//                   life's install is the install decision's)
//   LL7 WIRING      progress.js decides the length first (after the pass's
//                   first inputs, before grafts), builds every input on it,
//                   the install decision's life-target wait on it, publishes
//                   it with its options and pending re-decision, a switch is
//                   an event, the incumbent survives installs; the chooser is
//                   out of the pass
import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { preQueue } from "./prequeue.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const P = await import("../../plan.js");
const LP = await import("../../lifeplan.js");
const B = await import("../../bayes.js");
const R = await import("../sim/exitjump/lifelength.mjs");

// Published before the work-slot queue: replayed on the accounting that priced it (prequeue.mjs).
const F = preQueue(JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-lifelength-0714.json"), "utf8")));
const PASSES = F.passes;
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8");
const byStamp = (rows, s) => rows.find((r) => r.stamp === s);
// THE RULE THESE REPLAYS ENCODE is the P >= theta commitment rule (the
// passes were recorded under it, 2026-09-30, and LL1/LL2 assert its
// anti-churn property): pinned to it. Since 2026-10-02 the default is the
// expected-loss rule (plan.COMMIT, docs/bayes.md "Decision rule"); its
// verdicts on the same passes are replayed beside (ROWS_EL) and reported in
// LL2 — a behaviour change, stated, not hidden.
const ruleWas = P.setCommitCalibration({ rule: "p-better" });
const ROWS = R.replay(PASSES);
const PAIRS = R.lengthPairs(PASSES, ROWS);
P.setCommitCalibration({ rule: "expected-loss" });
const ROWS_EL = R.replay(PASSES);
P.setCommitCalibration(ruleWas);
const THETA = P.PLAN.theta;

export async function run() {
  const out = [];

  // ---------------------------------------------------------------------
  {
    const c = new Check("LL1", "REPLAY: the committed length holds on every pass that re-decided nothing and switches only through the rule; where the chooser flipped with no event, the exit on the committed L stays within EXIT UNSTABLE's tolerance; 07:14's 0.5h (109h) and 08:24's 0.5h (54h) are not chosen");
    c.examined(ROWS.length);
    let oldFlips = 0;
    let newSwitches = 0;
    for (let k = 0; k < ROWS.length; k++) {
      const r = ROWS[k];
      const p = ROWS[k - 1];
      if (p && r.oldL !== p.oldL) oldFlips++;
      if (r.switched) newSwitches++;
      c.note(`${r.stamp} ${r.events ? "event" : "  -  "} chooser L${r.oldL} (published exit ${r.oldExit}h${r.oldStable?.ok === false ? ", EXIT UNSTABLE" : ""}) | committed ${r.newKey}${r.held ? " held" : r.switched ? ` SWITCH from ${r.decision.from} (P ${r.pWin}, ${r.gainH}h)` : " stays"}, exit ${r.newExit}h${r.newStable?.ok === false ? " (UNSTABLE)" : r.newStable?.ok === true ? " (stable)" : ""}; CHECK shipped point ${r.checkH?.toFixed(2) ?? "?"}h vs published ${r.pubPoint ?? "-"}h`);
      // Every switch through the rule, on a pass that re-decided.
      if (r.switched && !(r.pWin >= THETA && r.gainH > 0)) c.fail(`${r.stamp}: a switch without the rule`, JSON.stringify({ pWin: r.pWin, gainH: r.gainH }));
      if (r.switched && !(r.events || (p && ROWS[k - 1].eventList.some((e) => /graft/.test(e))))) c.fail(`${r.stamp}: a switch on a pass that re-decided nothing`);
      // The CHECK: the replay's trajectory machinery reproduces the shipped plan's own point.
      if (Number.isFinite(r.pubPoint) && !(Math.abs(r.checkH / r.pubPoint - 1) <= 0.03)) c.fail(`${r.stamp}: CHECK the shipped trajectory re-priced ${r.checkH}h vs the published point ${r.pubPoint}h (> 3%)`);
      // A pass with no event keeps the committed length.
      if (p && !r.events && !r.switched && r.newKey !== p.newKey) c.fail(`${r.stamp}: the committed length moved with no event (${p.newKey} -> ${r.newKey})`);
    }
    c.note(`the chooser changed L ${oldFlips} times over ${ROWS.length} passes; the committed length switched ${newSwitches} times, each through the rule`);
    if (!(oldFlips >= 6)) c.fail(`fixture: the chooser's flips must be in the replay (${oldFlips})`);
    if (!(newSwitches < oldFlips / 2)) c.fail(`the committed length must switch far less than the chooser flipped (${newSwitches} vs ${oldFlips})`);
    // 07:04: the chooser 0.5h -> 3h with no event; the committed length holds.
    const r0704 = byStamp(ROWS, "070450");
    if (!(r0704 && r0704.newKey === byStamp(ROWS, "065948").newKey && byStamp(ROWS, "065948").oldL !== r0704.oldL)) c.fail("07:04: the chooser flipped and the committed length must hold", JSON.stringify({ old: [byStamp(ROWS, "065948")?.oldL, r0704?.oldL], now: r0704?.newKey }));
    // 07:14: the chooser's 0.5h, its committed trajectory 109h.
    const r0714 = byStamp(ROWS, "071454");
    c.note(`07:14: the chooser's L${r0714.oldL} priced the committed install at ${r0714.checkH?.toFixed(1)}h (published point ${r0714.pubPoint}h); the committed ${r0714.newKey} at ${r0714.newPoint}h, the 0.5h option ${r0714.table.find((t) => t.L === 0.5)?.pointH}h`);
    if (!(r0714.oldL === 0.5 && r0714.checkH > 100 && r0714.newL !== 0.5 && r0714.newExit < r0714.oldExit)) c.fail("07:14: the committed length must not be the chooser's 0.5h, and the exit must be below the published one", JSON.stringify({ oldL: r0714.oldL, newL: r0714.newL, newExit: r0714.newExit, oldExit: r0714.oldExit }));
    // 08:24 (the new life's first pass): the chooser's 0.5h priced at ~54h; the committed length stays.
    const r0824 = byStamp(ROWS, "082459");
    const pre = byStamp(ROWS, "081957");
    c.note(`08:24 (new life): the chooser's L${r0824.oldL}, its trajectory ${r0824.checkH?.toFixed(1)}h; the committed ${r0824.newKey} (${r0824.held ? "held" : r0824.switched ? "switched" : "stays"}), 0.5h option ${r0824.table.find((t) => t.L === 0.5)?.pointH}h`);
    if (!(r0824.oldL === 0.5 && r0824.checkH > 50 && r0824.newKey === pre.newKey && !r0824.switched)) c.fail("08:24: the incumbent length must survive the install (not the chooser's 0.5h)", JSON.stringify({ oldL: r0824.oldL, check: r0824.checkH, newKey: r0824.newKey, pre: pre.newKey }));
    const r0830 = byStamp(ROWS, "083001");
    if (!(r0830.newKey === r0824.newKey)) c.fail("08:30: the chooser flipped 0.5h -> 8h; the committed length must be the same as at 08:24");
    // The no-event pairs: the length's share of each move, both passes on the earlier pass's committed install.
    const flipPairs = PAIRS.filter((p) => p.oldL[0] !== p.oldL[1]);
    for (const p of PAIRS) {
      const s = (x) => `${x.prevH}h -> ${x.curH}h ${x.ok ? "ok" : "UNSTABLE"} (${x.diffH > 0 ? "+" : ""}${x.diffH}h, tol ${x.tolH}h)`;
      c.note(`pair ${p.from}->${p.to}: chooser L${p.oldL[0]}->L${p.oldL[1]} ${s(p.old)} | committed L${p.newL[0]}->L${p.newL[1]} ${s(p.new)}`);
      if (p.newL[0] !== p.newL[1]) c.fail(`${p.to}: the committed length moved on a no-event pair`);
      if (p.new.ok !== true) c.fail(`${p.to}: the exit on the committed length must stay within the draws' noise on a pass that re-decided nothing`, p.new.why);
    }
    if (!(flipPairs.length >= 3)) c.fail(`fixture: the replay must hold no-event pairs where the chooser flipped (${flipPairs.length})`);
    out.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("LL2", "THE RULE: a genuinely better length wins (07:14 L2 -> L16 on the replay; an incumbent L24 on the 07:24 inputs), a near-tie does not (08:24 L8 vs L16, P < theta), a held decision never switches");
    c.examined(4);
    const r0714 = byStamp(ROWS, "071454");
    if (!(r0714.switched && r0714.decision.from === "L2" && r0714.newKey === "L16" && r0714.pWin >= THETA && r0714.gainH > 5)) c.fail("07:14: the committed L2 (58.8h) must lose to a length hours sooner", JSON.stringify({ switched: r0714.switched, from: r0714.decision.from, to: r0714.newKey, pWin: r0714.pWin, gainH: r0714.gainH }));
    c.note(`07:14: ${r0714.why.slice(0, 200)}`);
    const r0824 = byStamp(ROWS, "082459");
    c.note(`08:24: ${r0824.why.slice(0, 200)}`);
    if (!(r0824.decision.stays === true && r0824.gainH > 0 && r0824.pWin < THETA)) c.fail("08:24: a challenger better on average but short of theta must not win", JSON.stringify({ stays: r0824.decision.stays, gainH: r0824.gainH, pWin: r0824.pWin }));
    // The expected-loss rule on the same passes (uncalibrated: width x1, rho
    // 0.9 stated): it takes 08:24's 0.42h at P 0.67 (the value of waiting is
    // smaller), and every one of its switches carries the P >= theta verdict
    // beside it.
    const el = ROWS_EL.filter((r) => r.switched);
    const e0824 = byStamp(ROWS_EL, "082459");
    c.note(`expected-loss rule on the same ${ROWS_EL.length} passes: ${el.length} switch(es) (P >= theta: ${ROWS.filter((r) => r.switched).length}); 08:24: ${String(e0824?.why ?? "").slice(0, 240)}`);
    if (!el.every((r) => r.decision?.commit && typeof r.decision.commit.old?.switch === "boolean")) c.fail("every expected-loss switch must log the P >= theta verdict beside it");
    // A synthetic incumbent the evidence rejects: L24 on the 07:24 pass.
    const ps = PASSES.find((x) => x.stamp === "072459");
    const prevPlan = PASSES.find((x) => x.stamp === "071957").plan;
    const now = Date.parse(ps.at);
    const basis = P.basisOf(prevPlan.decisions.install, now);
    const draws = P.makeDraws(R.postOf(ps.plan.posteriors), P.PLAN.N, P.seedOf(ps.lastAugReset, ps.node));
    const { opts } = R.optionsOf(ps);
    const args = { options: opts, basis, draws, now, budgetMs: 1e9, reachSd: ps.plan.posteriors.s };
    const bad = P.decideLifeLength({ ...args, prev: { key: "L24", lifeH: 24, meanH: 31, decidedAt: prevPlan.at, why: "fixture: an incumbent the evidence rejects" }, redecide: true });
    c.note(`07:24, incumbent L24: ${bad.key} (${bad.why.slice(0, 160)}); points ${bad.table.map((t) => `${t.L}:${t.pointH}`).join(" ")}`);
    if (!(bad.switched && bad.key !== "L24" && bad.pWin >= THETA && bad.gainH > 0 && bad.options.some((o) => o.key === "L24"))) c.fail("an incumbent L24 hours behind must lose through the rule (the incumbent in the draws)", JSON.stringify({ key: bad.key, pWin: bad.pWin, gainH: bad.gainH }));
    const held = P.decideLifeLength({ ...args, prev: { key: "L24", lifeH: 24, meanH: 31, decidedAt: prevPlan.at, why: "fixture" }, redecide: false });
    if (!(held.key === "L24" && held.held === true && held.options.length === 1)) c.fail("a held decision prices its incumbent alone and never switches", JSON.stringify({ key: held.key, held: held.held, n: held.options?.length }));
    const win = P.decideLifeLength({ ...args, prev: { key: bad.key, lifeH: bad.lifeH, meanH: bad.meanH, decidedAt: prevPlan.at, why: "fixture" }, redecide: true });
    if (!(win.key === bad.key && win.stays === true)) c.fail("the winner, as the incumbent, stays", JSON.stringify({ key: win.key, why: win.why }));
    // The switch cost is the rule's: a gain below it never switches.
    const costly = P.decideLifeLength({ ...args, prev: { key: "L24", lifeH: 24, meanH: 31, decidedAt: prevPlan.at, why: "fixture" }, redecide: true, switchCostH: 1e3 });
    if (!(costly.key === "L24" && costly.stays === true)) c.fail("a switch must pay its cost", JSON.stringify({ key: costly.key }));
    out.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("LL3", "ONE BELIEF: the posterior at any length derived from the model's (lifeCadenceAt) is the direct posterior with the model at that length (bayes.cadencePosterior); the point is the draws' median; every length is drawn on the same z");
    // A node with gaining lives of its own (BN9-like), the model at 6h.
    const ledger = [
      { bitNode: 9, lifeH: 5, hackMult: 1.0, at: "2026-09-29T00:00:00Z" },
      { bitNode: 9, lifeH: 7, hackMult: 1.2, at: "2026-09-29T08:00:00Z" },
      { bitNode: 9, lifeH: 6, hackMult: 1.5, at: "2026-09-29T15:00:00Z" },
      { bitNode: 9, lifeH: 4, hackMult: 1.7, at: "2026-09-29T20:00:00Z" },
      { bitNode: 8, lifeH: 9, hackMult: 1.0, at: "2026-09-27T00:00:00Z" },
      { bitNode: 8, lifeH: 11, hackMult: 1.4, at: "2026-09-27T12:00:00Z" },
    ];
    const rows = [0.5, 2, 6, 12, 24].map((L, i) => ({ L, lnMean: [0.002, 0.012, 0.06, 0.13, 0.2][i] }));
    const at6 = B.cadencePosterior(ledger, 9, { hackMultNow: 1.9, modelPrior: { lnPerHour: 0.06 / 6, cycleHours: 6 } });
    c.examined(rows.length);
    for (const row of rows) {
      const derived = LP.lifeCadenceAt(row, at6);
      const direct = B.cadencePosterior(ledger, 9, { hackMultNow: 1.9, modelPrior: { lnPerHour: row.lnMean / row.L, cycleHours: row.L } });
      c.note(`L${row.L}: model ${(row.lnMean / row.L).toFixed(5)}/h -> derived median ${derived.r.toFixed(6)}/h (sd ${derived.sd.toFixed(4)}), direct ${direct.lnPerHour.toFixed(6)}/h (sd ${direct.rate.sd.toFixed(4)}), own weight ${direct.rate.weight.toFixed(3)}`);
      if (!(Math.abs(derived.mean - direct.rate.mean) < 1e-9 && Math.abs(derived.sd - direct.rate.sd) < 1e-12)) c.fail(`L${row.L}: the derived posterior must be the direct one`, JSON.stringify({ derived: derived.mean, direct: direct.rate.mean }));
    }
    if (!(at6.rate.weight > 0.05)) c.fail(`fixture: the node's own lives must carry weight (${at6.rate.weight})`);
    // The point is the median; the draws share one z per draw across lengths.
    const base = { ...PASSES[0].inputs };
    const x6 = LP.lifeInputsOf(base, { table: rows }, 6, at6);
    const x24 = LP.lifeInputsOf(base, { table: rows }, 24, at6);
    const m = P.applyDraw(x6, { zCad: 0 });
    if (!(Math.abs(m.multGainPerCycle - x6.multGainPerCycle) < 1e-12)) c.fail("the point must be the draws' median (z = 0)");
    const post = { cadence: { rate: at6.rate, life: at6.life, own: at6.own }, drift: { s: 0.1, nu: 4, a: 2, b: 0.02 }, gymSdLn: 0.1 };
    const draws = P.makeDraws(post, 8, 12345);
    for (const d of draws) {
      if (!(Math.abs(Math.log(d.lnPerHour) - (at6.rate.mean + at6.rate.sd * d.zCad)) < 1e-12)) c.fail("makeDraws: the cadence draw must be its z");
      const g6 = Math.log(P.applyDraw(x6, d).multGainPerCycle) / 6;
      const g24 = Math.log(P.applyDraw(x24, d).multGainPerCycle) / 24;
      const z6 = (Math.log(g6) - x6.cadence.post.mean) / x6.cadence.post.sd;
      const z24 = (Math.log(g24) - x24.cadence.post.mean) / x24.cadence.post.sd;
      if (!(Math.abs(z6 - d.zCad) < 1e-9 && Math.abs(z24 - d.zCad) < 1e-9)) c.fail("every length must be drawn on the draw's own z (paired)", JSON.stringify({ z6, z24, z: d.zCad }));
    }
    // Inputs without a cadence belief draw as before (the measured path).
    const legacy = { ...base, cadence: { source: "purchase model" }, cadenceFrom: "purchase model", cycleHours: 6 };
    if (!(Math.abs(Math.log(P.applyDraw(legacy, draws[0]).multGainPerCycle) - draws[0].lnPerHour * 6) < 1e-12)) c.fail("inputs without cadence.post keep the posterior draw");
    out.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("LL4", "LIFE LENGTH OFF BASIS: one length passes; a decision priced on another fails (the 07:14 install decision on the chooser's 0.5h against a committed L16); carried decisions are skipped; planCheck fails on it");
    const T = "2026-09-30T07:14:35.000Z";
    const Tm = (min) => new Date(Date.parse(T) + min * 60e3).toISOString();
    const rec = (L = 6, over = {}) => ({
      at: Tm(1),
      decisions: {
        lifeLength: { key: `L${L}`, lifeH: L, noiseKey: `at:1|L${L}|g2`, pricedAt: T, options: [{ key: "L4", noiseKey: "at:1|L4|g2", pricedAt: T }] },
        install: { key: "w1", noiseKey: `at:1|L${L}|g2`, pricedAt: Tm(1), options: [{ key: "w1", noiseKey: `at:1|L${L}|g2`, pricedAt: Tm(1) }, { key: "now", noiseKey: `at:0|L${L}|g2`, pricedAt: Tm(1) }] },
        grafts: { key: "grafts", basisNoiseKey: `at:1|L${L}|g2`, pricedAt: T, options: [{ key: "none", noiseKey: `at:1|L${L}|g0` }] },
        gang: { key: "none", pricedL: L, pricedAt: Tm(1) },
        ...over,
      },
    });
    const ok = P.lifeLengthBasisOf(rec());
    const offInst = rec(6, { install: { key: "w1", noiseKey: "at:1|L6|g2", pricedAt: Tm(1), options: [{ key: "now", noiseKey: "at:0|L0.5|g2", pricedAt: Tm(1) }] } });
    const offGang = rec(6, { gang: { key: "none", pricedL: 3, pricedAt: Tm(1) } });
    const carried = rec(6, { sleeveObjective: { key: "exp", pricedL: 3, pricedAt: Tm(-60) } });
    c.examined(4);
    if (!(ok.ok === true && ok.checked === 3)) c.fail("one length must pass (install, grafts, gang checked)", JSON.stringify(ok));
    const bi = P.lifeLengthBasisOf(offInst);
    if (!(bi.ok === false && /^LIFE LENGTH OFF BASIS: install: priced on L0\.5/.test(bi.why))) c.fail("an install option on another length must fail", bi.why);
    const bg = P.lifeLengthBasisOf(offGang);
    if (!(bg.ok === false && /gang: priced on L3/.test(bg.why))) c.fail("a gang decision priced on another length must fail", bg.why);
    const bc = P.lifeLengthBasisOf(carried);
    if (!(bc.ok === true && bc.carried === 1)) c.fail("a decision carried from an earlier pass is skipped and counted", JSON.stringify(bc));
    // The live case: the 07:14 install decision's options priced on the chooser's L (the published inputs), against
    // the committed length the replay holds there.
    const ps = PASSES.find((x) => x.stamp === "071454");
    const r = byStamp(ROWS, "071454");
    const now = Date.parse(ps.at);
    const prevInst = PASSES.find((x) => x.stamp === "070952").plan.decisions.install;
    const draws = P.makeDraws(R.postOf(ps.plan.posteriors), 8, P.seedOf(ps.lastAugReset, ps.node));
    const H = (x, spec) => P.trajectoryOf(spec)(x);
    const instOn = (x) => {
      const w = [0.25, 1];
      const point = { now: { hours: H(x, { kind: "wait", waitH: 0 }) }, waits: w.map((waitH) => ({ waitH, hours: H(x, { kind: "wait", waitH, gains: prevInst.gains }), installGains: prevInst.gains })), committedGains: prevInst.gains };
      return P.decideInstall({ inputs: x, point, prev: prevInst, draws, redecide: true, now, budgetMs: 1e9 });
    };
    const inL = R.optionsOf(ps).opts.find((o) => o.L === r.newL).inputs;
    const plan = (inst) => ({ at: ps.at, node: ps.node, lastAugReset: ps.lastAugReset, decisions: { lifeLength: { ...r.decision, pricedAt: ps.at }, install: { ...inst, pricedAt: ps.at } } });
    const shipped = P.lifeLengthBasisOf(plan(instOn(ps.inputs)));
    const fixed = P.lifeLengthBasisOf(plan(instOn(inL)));
    c.note(`07:14 install decision on the chooser's L${ps.inputs.cycleHours}, the committed ${r.newKey}: ${shipped.why}`);
    c.note(`07:14 install decision on the committed length: ${fixed.why}`);
    if (!(shipped.ok === false && fixed.ok === true)) c.fail("the 07:14 install decision must fail on the chooser's length and pass on the committed one", JSON.stringify({ shipped: shipped.why, fixed: fixed.why }));
    const chk = P.planCheck({ ...plan(instOn(ps.inputs)), at: new Date().toISOString(), lastAugReset: ps.lastAugReset }, { now: Date.now() });
    if (!chk.fails.some((f) => /^LIFE LENGTH OFF BASIS/.test(f.what))) c.fail("planCheck must fail LIFE LENGTH OFF BASIS", JSON.stringify(chk.fails.map((f) => f.what)));
    out.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("LL5", "EXIT UNSTABLE reads the length on the basis: the shipped 06:59 -> 07:04 pair (the chooser 0.5h -> 3h, no event) fails naming it; the same move recorded as a switch event does not; every noise key carries L");
    const A = PASSES.find((x) => x.stamp === "065948");
    const Bp = PASSES.find((x) => x.stamp === "070450");
    // The shipped records with their install decisions' noise keys as this commit writes them (the length on the key).
    const withL = (ps) => ({ ...ps.plan, decisions: { install: { ...ps.plan.decisions.install, noiseKey: P.noiseKeyOf(P.basisOf(ps.plan.decisions.install, Date.parse(ps.at)), ps.inputs) } } });
    const ra = withL(A);
    const rb = withL(Bp);
    c.examined(3);
    const es = P.exitStabilityOf(ra, rb);
    c.note(`06:59 ${ra.decisions.install.noiseKey} -> 07:04 ${rb.decisions.install.noiseKey}: ${es.why}`);
    if (!(es.ok === false && /later lives' length moved L0\.5 -> L3 with no event/.test(es.why))) c.fail("the shipped pair must fail EXIT UNSTABLE on the length", es.why);
    const ev = P.exitStabilityOf(ra, { ...rb, events: ["the committed life length switched L0.5 -> L3"] });
    if (ev.ok !== null) c.fail("a switch recorded as an event is not instability", ev.why);
    const keys = [P.noiseKeyOf(null, A.inputs), P.noiseKeyOf({ kind: "never" }, A.inputs), P.noiseKeyOf({ kind: "wait", installAt: 6e7 }, A.inputs)];
    c.note(`noise keys at L${A.inputs.cycleHours}: ${keys.join(", ")}`);
    if (!keys.every((k) => P.lifeOfNoiseKey(k) === A.inputs.cycleHours)) c.fail("every noise key must carry the later lives' length", keys.join(", "));
    if (!(P.noiseKeyOf(null, { cycleHours: 5 }) === "default|g0")) c.fail("the measured cadence (no purchase model) carries no length on its key");
    out.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("LL6", "COHERENCE with the install decision: the install decision's committed option on the committed length IS the life length decision's committed option (one noise key, one exit on the same draws); every length option differs from it in the later lives only");
    // 07:30: held on L8, basis the 07:24 install.
    const ps = PASSES.find((x) => x.stamp === "073001");
    const prevInst = PASSES.find((x) => x.stamp === "072459").plan.decisions.install;
    const r = byStamp(ROWS, "073001");
    const now = Date.parse(ps.at);
    const draws = P.makeDraws(R.postOf(ps.plan.posteriors), P.PLAN.N, P.seedOf(ps.lastAugReset, ps.node));
    const { opts } = R.optionsOf(ps);
    const inL = opts.find((o) => o.L === r.newL).inputs;
    const inst = P.decideInstall({ inputs: inL, point: { committedGains: prevInst.gains }, prev: prevInst, draws, redecide: false, now, budgetMs: 1e9 });
    c.examined(opts.length + 1);
    c.note(`07:30 committed ${r.newKey}: life length ${r.decision.meanH}h on ${r.decision.noiseKey}; install ${inst.key} ${inst.meanH}h on ${inst.noiseKey}`);
    if (!(r.held && inst.noiseKey === r.decision.noiseKey && inst.meanH === r.decision.meanH && JSON.stringify(inst.samples) === JSON.stringify(r.decision.samples))) c.fail("the install decision's committed trajectory and the life length decision's committed option must be one trajectory", JSON.stringify({ inst: [inst.noiseKey, inst.meanH], ll: [r.decision.noiseKey, r.decision.meanH] }));
    if (!(Math.abs(r.decision.basis.waitH - P.basisOf(prevInst, now).waitH) < 1e-3)) c.fail("the life length's options must be priced on the committed install's remaining wait");
    const cadenceFields = new Set(["cycleHours", "multGainPerCycle", "cadenceRateMedian", "cadence", "cadenceFrom"]);
    for (const o of opts) {
      const diff = Object.keys({ ...o.inputs, ...inL }).filter((k) => JSON.stringify(o.inputs[k]) !== JSON.stringify(inL[k]) && !cadenceFields.has(k));
      if (diff.length) c.fail(`L${o.L}: its inputs differ from the committed length's outside the later lives' cadence`, diff.join(", "));
    }
    out.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("LL7", "WIRING: progress.js decides the length first (after the pass's first inputs, before grafts), builds every exit input on it, the install decision's life-target wait on it, publishes it with its pending re-decision; a switch is an event; the incumbent is the node's (installs do not reset it); the chooser is out of the pass");
    const pg = code("progress.js");
    const act = pg.slice(pg.indexOf("async function act("));
    const iInputs = act.indexOf("'plan-inputs')");
    const iLife = act.indexOf("await lifeLengthDecisionOf(ns, info,");
    const iGraft = act.indexOf("await graftDecisionOf(ns, info, sing");
    const guards = [
      ["the life length decided after the pass's first inputs and before the graft decision", iInputs > 0 && iLife > iInputs && iGraft > iLife],
      ["every exit input on the committed length", /const c = committedLifeL\(ns, info\)/.test(pg) && /const x = lifeInputsOf\(out, pc, Lc, post, \{ lifeLength: lifeWhy, catalogue \}\)/.test(pg)],
      ["the install decision's life-target wait on the committed length", /const lifeTargetH = committedLifeL\(ns, info\)\?\.L/.test(pg)],
      ["published with its pending re-decision", /lifeLength: pc\.decisions\.lifeLength \?\? pc\.prevAny\?\.decisions\?\.lifeLength \?\? null/.test(pg) && /\n      lifeLengthPending,\n/.test(pg) && /rec\.lifeLengthBasis = lifeLengthBasisOf\(rec\)/.test(pg)],
      ["a switch is an event", /the committed life length switched \$\{prev\.key\} -> \$\{d\.key\}/.test(pg) && /pc\.redecide = true\n    \}\n  \}\n  \/\/ Events raised after this point/.test(pg)],
      ["pending and events re-decide it; the incumbent is the node's", /const prev = pc\.prevAny\?\.decisions\?\.lifeLength\?\.key \? pc\.prevAny\.decisions\.lifeLength : null/.test(pg) && /const redecide = pc\.redecide \|\| !prev \|\| pending !== null/.test(pg)],
      ["stream events before the length", /async function lifeLengthDecisionOf[\s\S]{0,400}streamEventsNow\(pc, lb\.base\)/.test(pg)],
      ["gang and sleeve decisions stamp their length", /decision\.pricedL = lifeLOf\(b0\)/.test(pg) && /d\.pricedL = lifeLOf\(base\)/.test(pg)],
      ["the chooser is out of the pass", !/cadenceByPurchases/.test(pg.replace(/\/\/.*$/gm, "")) && /yield\* lifeTableGen\(/.test(pg)],
      ["planCheck fails LIFE LENGTH OFF BASIS", /const lb = lifeLengthBasisOf\(plan\)/.test(code("plan.js"))],
    ];
    c.examined(guards.length);
    for (const [what, ok] of guards) if (!ok) c.fail(`progress.js/plan.js: ${what}`);
    out.push(c);
  }
  return out;
}
