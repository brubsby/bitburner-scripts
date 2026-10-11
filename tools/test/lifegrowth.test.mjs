// [LG] EVERY LATER LIFE BUYS AT THE INCOME IT HAS REACHED, AND THE CADENCE
// PRIOR IS NOT THE PURCHASE MODEL ALONE.
//
// Live BN13.1 2026-10-11 (fixture-bn13-lifegrowth.json, two passes, mkfix in
// tools/sim/exitjump/mkfix-bn13-lifegrowth.mjs): the exit simulator priced
// every later life's batch from the purchase model at TODAY's money (a 0.5h
// life's $17.7m, x1.0013 a life) and held it for all 399 lives to the exit;
// with no BN13 life measured, the cadence posterior was that model alone
// (0.0027 ln(M)/h x/÷ 21 — its error only a variance, though the 12 lives
// other nodes recorded against it sit at +2..+4 in ln). The plan read
// exits of 250-5500h (01:28Z: mean 390.9h, the L0.5 point unpriceable) where
// the cross-node cadence is ~0.06/h, switched L24 -> L0.5 on "333h sooner
// (sd 1127h)" and later L0.5 -> L3 on a 5257.6h SWITCH ARTEFACT.
//
//   LG1 GROWTH (red on HEAD)   lifeplan.lifeGrowthOf: a life's money and
//                              reputation rise with the multiplier reached;
//                              lifeSequence buys each life with them, so the
//                              later lives' gains rise with the simulated
//                              income; lifeTable rows carry the grown
//                              sequence past the mean's horizon
//   LG2 THE BLEND              bayes.cadencePosterior with a model prior and
//                              no own life: the prior is the model and the
//                              cross-node prior by precision, the driver
//                              named; lifeCadenceAt's L-slope is the model's
//                              share
//   LG3 THE LIVE PASSES        both passes through the shipped chain
//                              (lifeTable -> installCadence -> lifeInputsOf ->
//                              bestExitPolicy / decideLifeLength): every
//                              length prices in a sane band, no SWITCH
//                              ARTEFACT; the old belief on the same table
//                              reproduces the unpriceable L0.5
//   LG4 WIRING                 progress.js builds the table with the growth
//                              on (defaults), the shape carries n and mean

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const P = await import("../../plan.js");
const E = await import("../../exitplan.js");
const LP = await import("../../lifeplan.js");
const B = await import("../../bayes.js");
const BM = await import("../../bitNodeMultipliers.js");

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn13-lifegrowth.json"), "utf8"));
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x));
const covOf = (n) => {
  const m = n === 12 ? BM.bitNodeMults(12, 1) : BM.bitNodeMults(n);
  return m ? Math.log(m.AugmentationMoneyCost * m.AugmentationRepCost) : 0;
};
// The postOf of tools/sim/exitjump/lifelength.mjs: the draws' posterior from a plan record's summary.
const drawsPostOf = (ps) => {
  const c = ps?.cadence;
  const t = ps?.trader;
  return {
    drift: { s: ps.s, nu: ps.driftNu ?? 4, a: 2, b: 2 * ps.s * ps.s },
    gymSdLn: 0.1,
    cadence: c ? { rate: { mean: Math.log(c.lnPerHour), sd: c.rateSdLn }, life: { mean: Math.log(c.cycleHours), sd: c.lifeSdLn }, own: { weight: c.ownWeight } } : null,
    expPost: ps.exp ? { perSec: ps.exp.perSec, sd: ps.exp.sdLn } : null,
    income: ps.income ? { perSec: ps.income.perSec, mean: Math.log(ps.income.perSec), sd: ps.income.sdLn } : null,
    trader: t && Number.isFinite(t.mean) ? { perSec: { mean: t.mean, sd: t.sd }, ...(Number.isFinite(t.Wstar) ? { lnWstar: { mean: Math.log(t.Wstar), sd: t.lnWstarSd ?? 0.3 } } : {}), rho: t.rho ?? 0 } : null,
  };
};

// ONE PASS AS progress.js BUILDS IT (purchaseCadenceGen -> exitInputsGen ->
// lifeLengthDecisionOf): the catalogue after the next batch (its NeuroFlux
// levels: afterBatch), the money calibration the pass published, the cadence
// posterior at the committed L, each length's inputs. `old`: HEAD's model —
// the table at today's money over the 48h horizon and the posterior on the
// purchase model alone.
function build(pass, { old = false } = {}) {
  const I = pass.inputs;
  const L0 = I.cycleHours;
  const nfgLevel0 = I.cadence?.afterBatch?.nfgLevels ?? 0;
  const C = LP.catalogueFromOffers(pass.offers, pass.owned);
  const rph = I.repPerSec * 3600;
  const pub = I.cadence.table.find((r) => r.L === L0);
  const raw = LP.lifeTable({ inputs: I, catalogue: C, favor: C.favor, owned: pass.owned, repPerHour0: rph, grid: [L0], nfgLevel0, withGrowth: false, shapeH: 0 })[0];
  const moneyScale = pub.money / raw.money;
  const table = LP.lifeTable({ inputs: I, catalogue: C, favor: C.favor, owned: pass.owned, repPerHour0: rph, moneyScale, nfgLevel0, ...(old ? { withGrowth: false, shapeH: 0 } : {}) });
  const rec = { table, moneyScale, afterBatch: I.cadence.afterBatch };
  const row = table.find((r) => r.L === L0);
  let post = E.installCadence(pass.ledger, pass.node, { covOf, modelPrior: { lnPerHour: row.lnMean / L0, cycleHours: L0 } }).posterior;
  if (old) {
    // HEAD's oneModel: the rate's prior is the model alone (no own BN13 life to update it).
    const m = post.rate.prior.model;
    post = { ...post, rate: { mean: m.mean, sd: m.sd, prior: { mean: m.mean, sd: m.sd, source: "purchase model" }, weight: 0 } };
  }
  const opts = [];
  for (const r of table) {
    const x = LP.lifeInputsOf(I, rec, r.L, post);
    if (x) opts.push({ L: r.L, inputs: x, cad: LP.lifeCadenceAt(r, post) });
  }
  return { table, post, opts };
}
const decideOn = (pass, opts) =>
  P.decideLifeLength({ options: opts, basis: null, prev: pass.plan.decisions.lifeLength, draws: P.makeDraws(drawsPostOf(pass.plan.posteriors), P.PLAN.N, P.seedOf(pass.lastAugReset, pass.node)), redecide: true, now: Date.parse(pass.plan.at), budgetMs: 1e9, reachSd: pass.plan.posteriors?.s ?? null });

export async function run() {
  const checks = [];

  {
    const c = new Check("LG1", "GROWTH: a later life's money and reputation rise with the multiplier it has reached, so the purchase sequence's later lives buy more as the simulated income grows (lifeplan.lifeGrowthOf -> lifeSequence -> lifeTable)");
    try {
      if (typeof LP.lifeGrowthOf !== "function") {
        c.fail("lifeplan.lifeGrowthOf is not exported: every later life is bought with today's money");
      } else {
        // A money-bound NeuroFlux catalogue (reputation plentiful): the life buys what its money allows.
        const I = { incomePerSec: 2e5, hacking: 100, hackingMult: 1, hackingExp: 1e5, expPerSec: 50, expScalesWithLevel: true, installCash: 1262 };
        const L = 2;
        const m0 = LP.freshLifeMoney(I, L);
        const grow = LP.lifeGrowthOf(I, L, m0);
        const at = [0, 0.5, 1, 2].map((x) => grow(x));
        c.examined(at.length);
        c.note(`a ${L}h life at ln M +0/+0.5/+1/+2: money ${at.map((k) => `$${(k.money / 1e6).toFixed(1)}m`).join(" / ")}, reputation x${at.map((k) => k.repK.toFixed(3)).join(" / x")}`);
        if (Math.abs(at[0].money / m0 - 1) > 1e-9 || Math.abs(at[0].repK - 1) > 1e-9) c.fail(`at the money model's own multiplier the life is today's: $${at[0].money} vs $${m0}, rep x${at[0].repK}`);
        for (let k = 1; k < at.length; k++) if (!(at[k].money > at[k - 1].money) || !(at[k].repK > at[k - 1].repK)) c.fail(`money and reputation must rise with the multiplier reached (step ${k})`);
        const nfg = { name: LP.NFG, price: 1e6, repReq: 1, hackMult: 1.01, factions: ["F"] };
        const args = { items: [], nfg, favor: { F: 0 }, owned: [], L, lives: 12, moneyAt: () => m0, repPerHour0: 1e9 };
        const flat = LP.lifeSequence(args);
        const grown = LP.lifeSequence({ ...args, growth: grow });
        c.examined(grown.length);
        c.note(`12 lives of ${L}h, NeuroFlux levels: today's money ${flat.map((s) => s.nfgLevels).join(",")}; at the multiplier reached ${grown.map((s) => s.nfgLevels).join(",")} (money $${(grown[0].money / 1e6).toFixed(1)}m -> $${(grown[11].money / 1e6).toFixed(1)}m)`);
        if (!(grown[11].money > grown[0].money)) c.fail("the last life's money must exceed the first's: the sequence buys at the income it has reached");
        const tail = (s) => s.slice(6).reduce((a, x) => a + x.lnGain, 0);
        if (!(tail(grown) > tail(flat))) c.fail(`the later lives' gains must rise with the simulated income: ln ${tail(grown).toFixed(4)} vs ${tail(flat).toFixed(4)} at today's money`);
        const t = LP.lifeTable({ inputs: I, catalogue: { items: [], nfg, favor: { F: 0 } }, favor: { F: 0 }, owned: [], repPerHour0: 1e9, grid: [L] })[0];
        c.examined(1);
        if (!(t.seq.length > t.lives) || !t.grown) c.fail(`the table row must carry the sequence past its mean's ${t.lives} lives, grown (${t.seq.length} lives, grown ${JSON.stringify(t.grown)})`);
      }
    } catch (e) {
      c.fail(`threw: ${String(e?.stack ?? e).slice(0, 240)}`);
    }
    checks.push(c);
  }

  {
    const c = new Check("LG2", "THE BLEND: with no own life the cadence prior is the purchase model and the cross-node prior by precision, the driver named, and the life length's L-slope is the model's share");
    try {
      const pass = F.passes[0];
      const mp = { lnPerHour: 0.0027, cycleHours: 0.5 };
      const cp = B.cadencePosterior(pass.ledger, 13, { covOf, modelPrior: mp });
      const cross = B.cadencePosterior(pass.ledger, 13, { covOf });
      const s = cp.rate.modelShare;
      c.examined(3);
      c.note(cp.why.slice(0, 360));
      if (!(s > 0 && s < 1)) c.fail(`the model's share must be a fraction: ${s}`);
      const lo = Math.min(Math.log(mp.lnPerHour), cross.rate.mean);
      const hi = Math.max(Math.log(mp.lnPerHour), cross.rate.mean);
      if (!(cp.rate.mean > lo && cp.rate.mean < hi)) c.fail(`the blended rate (${Math.exp(cp.rate.mean)}) must lie between the model (${mp.lnPerHour}) and the cross-node prior (${Math.exp(cross.rate.mean)})`);
      if (cp.rate.weight !== 0 || !/DRIVEN BY the (cross-node prior|purchase model)/.test(cp.why) || !["cross-node prior", "purchase model"].includes(cp.drives)) c.fail(`no own life: the driver must be named the model or the cross-node prior (drives ${cp.drives})`);
      const a = LP.lifeCadenceAt({ L: 0.5, lnMean: 0.0027 * 0.5 }, cp);
      const b = LP.lifeCadenceAt({ L: 4, lnMean: 0.0027 * 4 * Math.E }, cp);
      const slope = b.mean - a.mean;
      c.note(`model share ${s.toFixed(3)}: a length whose model rate is e x higher moves the posterior by ${slope.toFixed(3)} in ln`);
      if (Math.abs(slope - s) > 1e-9) c.fail(`lifeCadenceAt's L-slope must be the model's share: ${slope} vs ${s}`);
    } catch (e) {
      c.fail(`threw: ${String(e?.stack ?? e).slice(0, 240)}`);
    }
    checks.push(c);
  }

  {
    const c = new Check("LG3", "THE LIVE PASSES: on both BN13 passes every length prices a finite exit in a sane band through the shipped chain, the life length decision makes no SWITCH ARTEFACT; the old belief on the same table reproduces the unpriceable L0.5");
    try {
      const band = [15, 250];
      for (const pass of F.passes) {
        const { post, opts } = build(pass);
        const pts = opts.map((o) => [o.L, E.bestExitPolicy(o.inputs).best?.hours ?? null]);
        c.examined(pts.length);
        c.note(`${pass.at} (committed ${pass.plan.decisions.lifeLength?.key}, published mean ${pass.plan.exit?.meanH}h): cadence ${post.lnPerHour.toFixed(4)}/h driven by ${post.drives}; points ${pts.map(([L, h]) => `L${L} ${f2(h)}h`).join(", ")}`);
        for (const [L, h] of pts) if (!(Number.isFinite(h) && h >= band[0] && h <= band[1])) c.fail(`${pass.at} L${L}: the exit ${h}h is outside ${band[0]}-${band[1]}h`);
        const d = decideOn(pass, opts);
        c.note(`   decision ${d.key}: ${String(d.why).slice(0, 220)}`);
        if (d.switchSanity?.ok === false) c.fail(`${pass.at}: ${d.switchSanity.why}`);
        for (const o of d.options ?? []) if (!(o.pFeasible === 1) || !(o.meanH <= band[1])) c.fail(`${pass.at} ${o.key}: mean ${o.meanH}h, feasible in ${o.pFeasible} of the draws`);
      }
      const p0 = F.passes[0];
      const old = build(p0, { old: true });
      const o05 = old.opts.find((o) => o.L === 0.5);
      const hOld = o05 ? E.bestExitPolicy(o05.inputs).best?.hours ?? null : null;
      c.examined(1);
      c.note(`the old belief on ${p0.at}: L0.5 ${f2(hOld)}h (cadence ${Math.exp(old.post.rate.mean).toFixed(4)}/h, the model alone)`);
      if (Number.isFinite(hOld) && hOld < 1000) c.fail(`the old model must reproduce the unpriceable L0.5 (> 1000h): ${hOld}h`);
    } catch (e) {
      c.fail(`threw: ${String(e?.stack ?? e).slice(0, 240)}`);
    }
    checks.push(c);
  }

  {
    const c = new Check("LG4", "WIRING: progress.js builds the purchase table with the growth on (lifeTableGen defaults), and lifeInputsOf's shape carries the mean's horizon and the model's mean");
    try {
      const lp = code("lifeplan.js");
      const pr = code("progress.js");
      const need = [
        [lp, /withGrowth = true \}\) \{/, "lifeplan.js: lifeTableGen grows by default"],
        [lp, /growth, lnM0 \}\)/, "lifeplan.js: lifeTableGen buys each life at the multiplier reached"],
        [lp, /\{ n: row\.lives \}/, "lifeplan.js: the shape carries the mean's horizon"],
        [lp, /\{ mean: row\.lnMean \}/, "lifeplan.js: the shape carries the model's mean"],
        [pr, /lifeTableGen\(\{ inputs: base, catalogue: catal, favor: catal\.favor, owned: \[\.\.\.owned\], repPerHour0: rph, moneyScale: ms\.scale, nfgLevel0 \}\)/, "progress.js: the table on the defaults"],
      ];
      c.examined(need.length);
      for (const [src, re, what] of need) if (!re.test(src)) c.fail(what);
    } catch (e) {
      c.fail(`threw: ${String(e?.stack ?? e).slice(0, 240)}`);
    }
    checks.push(c);
  }

  return checks;
}
