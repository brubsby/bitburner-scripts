// [SB] WHAT THIS LIFE BUYS AND WHAT THE NEXT LIVES BUY: ONE TRAJECTORY OF ln.
//
// Live BN13.1 2026-10-11, after 0443351 (unpriced comparisons fail closed):
// on the 19:27Z points the plan still preferred installing a tiny batch —
// 'now' 426.77h against w0.25 430.72h for NeuroFlux + NutriGen (ln 0.014),
// and every wait 3.70h + its own length behind 'now'. The same pass ordered
// Mug over faction work ("crime: exit 436.48h vs 485.80h"), so the waits
// projected no reputation and bought nothing more.
//
// The cause (exitplan.cadenceShapeOf): the later lives are the purchase
// model's sequence SCALED by the cadence posterior (scale = ln g / model
// mean: 3.31 on these inputs — the first life after an install priced at
// ln 0.586 for the model's 0.177). A batch bought in THIS life is priced at
// its real ln, and skipped the sequence's front by that much of the MODEL's
// ln — which the lives are priced at 3.31x. Every ln this life bought cost
// 3.31 of the next lives': a bigger batch at the same install time priced a
// LATER exit, so any wait that bought more lost to 'now', and faction work
// (the bigger batch) lost the work slot to crime (which then left the waits
// with no reputation projection). Fixed: the skip is in the priced ln
// (skipLn / scale) — the batch is taken off the later lives once.
//
// fixture-bn13-samebuilder-1927.json: the 19:27:44Z exit inputs (published
// with the player alone — see its `source`); the waits' batches are the
// gate's futures in fixture-bn13-nutrigen-1927.json. Policies are optimised
// exhaustively (k = 1..400) so the comparison is the model's, not the
// policy search's plateau handling.
//
//   SB1 THE CAUSE     the shape takes a batch's ln off the later lives once
//                     (scale 3.31 on the inputs; HEAD took 3.31x)
//   SB2 MONOTONE      at one install time a bigger batch never prices a
//                     later exit — so faction work's batch beats crime's
//                     (the work slot), and a wait that buys more can win
//   SB3 THE DECISION  the 19:27Z waits replayed: the NeuroFlux wait no
//                     longer loses to 'now' by the batch penalty; a wait
//                     that buys nothing more costs exactly its hours
//   SB4 GOOD INSTALL  a 10-augmentation batch (hacking x1.6) installs now
//                     against waiting with the same batch
//   SB5 WIRING        a wait's money follows the slot policy (crime money
//                     when the slot is crime's)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Check } from "./harness.mjs";
import "./gameresolve.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const X = await import("../../exitplan.js");
const FX = JSON.parse(fs.readFileSync(path.join(REPO, "tools/test/fixture-bn13-samebuilder-1927.json"), "utf8"));
const NG = JSON.parse(fs.readFileSync(path.join(REPO, "tools/test/fixture-bn13-nutrigen-1927.json"), "utf8"));
const src = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
const I = FX.inputs;
const gOf = (M, o = {}) => ({ hacking: M, rep: M, income: M, exp: M, ...o });
const optOf = (x) => {
  let best = null;
  for (let k = 1; k <= 400; k++) {
    const h = X.exitHours(x, k, true).hours;
    if (typeof h === "number" && isFinite(h) && (!best || h < best.h)) best = { h, k };
  }
  return best;
};
const at = (w, g = null) => optOf({ ...I, firstInstallH: w, ...(g ? { installGains: g, nextInstallGain: g.hacking } : {}) });

export async function run() {
  const checks = [];

  const c1 = new Check("SB1", "the cadence shape takes a batch's ln off the later lives once, not scale x over");
  {
    const opts = { cycleHours: I.cycleHours, multGainPerCycle: I.multGainPerCycle };
    const s0 = X.cadenceShapeOf(I.cadenceShape, opts);
    const lnSum = (s) => Array.from({ length: 40 }, (_, j) => Math.log(I.multGainPerCycle * s.at(j + 1))).reduce((a, b) => a + b, 0);
    c1.examined(3);
    c1.note(`scale ${s0.scale.toFixed(3)} (the first later life priced at ln ${Math.log(I.multGainPerCycle * s0.at(1)).toFixed(3)} for the model's ${I.cadenceShape.ln[0]})`);
    if (!(s0.scale > 3 && s0.scale < 3.6)) c1.fail(`the 19:27Z inputs' shape scale is ~3.31: ${s0.scale}`);
    for (const b of [0.0141, 0.1, 0.3]) {
      const s = X.cadenceShapeOf(I.cadenceShape, { ...opts, skipLn: b });
      const lost = lnSum(s0) - lnSum(s);
      c1.note(`batch ln ${b}: the later lives lose ln ${lost.toFixed(4)}`);
      if (Math.abs(lost - b) > 0.02 * b + 1e-4) c1.fail(`a batch of ln ${b} must take ln ${b} off the later lives (took ${lost.toFixed(4)}; HEAD took ${(b * s0.scale).toFixed(4)})`);
    }
  }
  checks.push(c1);

  const c2 = new Check("SB2", "at one install time a bigger batch never prices a later exit (faction work's batch beats crime's)");
  {
    const W = 5.09;
    const rows = [1.0141, 1.1, 1.3, 1.6].map((M) => ({ M, ...at(W, gOf(M)) }));
    c2.examined(rows.length);
    c2.note(rows.map((r) => `M ${r.M}: ${r.h.toFixed(2)}h (${r.k})`).join("; "));
    for (let i = 1; i < rows.length; i++) if (rows[i].h > rows[i - 1].h + 1e-6) c2.fail(`M ${rows[i].M} priced later than M ${rows[i - 1].M} at ${W}h: ${rows[i].h.toFixed(2)} > ${rows[i - 1].h.toFixed(2)} (HEAD: M 1.6 +1524h)`);
  }
  checks.push(c2);

  const c3 = new Check("SB3", "the 19:27Z waits replayed: no batch penalty on the NeuroFlux wait; a wait buying nothing more costs exactly its hours");
  {
    const now = at(0);
    const rows = NG.gate.futures.map((f) => ({ w: f.waitMs / 3600000, M: f.M, ...at(f.waitMs / 3600000, gOf(f.M)) }));
    c3.examined(rows.length + 2);
    c3.note(`now ${now.h.toFixed(2)}h (${now.k}); ${rows.map((r) => `w${r.w.toFixed(2)} ${(r.h - now.h).toFixed(2)}h`).join(", ")}`);
    const w25 = rows.find((r) => Math.abs(r.w - 0.25) < 1e-9);
    if (!(w25 && w25.h <= now.h)) c3.fail(`the w0.25 NeuroFlux level (ln 0.014) is worth more than 15 minutes; priced ${(w25?.h - now.h).toFixed(2)}h vs now (HEAD +56.8h: the batch penalty)`);
    const same = at(0.25);
    if (Math.abs(same.h - now.h - 0.25) > 1e-6) c3.fail(`a 0.25h wait with the same batch as now must cost 0.25h: ${(same.h - now.h).toFixed(4)}h`);
    // The NeuroFlux waits differ only by their length.
    const nfg = rows.filter((r) => Math.abs(r.M - 1.0140868626307427) < 1e-12).sort((a, b) => a.w - b.w);
    for (let i = 1; i < nfg.length; i++) if (Math.abs(nfg[i].h - nfg[i - 1].h - (nfg[i].w - nfg[i - 1].w)) > 1e-6) c3.fail(`waits buying the same batch differ by their length only: w${nfg[i].w} vs w${nfg[i - 1].w}`);
  }
  checks.push(c3);

  const c4 = new Check("SB4", "a genuinely good install (10 augmentations, hacking x1.6) installs now against waiting with the same batch");
  {
    const g = gOf(1.6, { rep: 1.35, income: 1.4, exp: 1.25 });
    const now = at(0, g);
    const waits = [0.25, 1, 5.09].map((w) => ({ w, ...at(w, g) }));
    const tiny = at(0, gOf(1.0141));
    c4.examined(5);
    c4.note(`now ${now.h.toFixed(2)}h; ${waits.map((r) => `w${r.w} ${r.h.toFixed(2)}h`).join(", ")}; the tiny batch now ${tiny.h.toFixed(2)}h`);
    if (!waits.every((r) => r.h > now.h)) c4.fail("waiting with the same big batch must lose to installing it now");
    if (!(now.h < tiny.h)) c4.fail("the big batch now must beat the tiny batch now");
  }
  checks.push(c4);

  const c5 = new Check("SB5", "wiring: a wait's money follows the slot policy; the shape's skip is in the priced ln");
  {
    c5.examined(2);
    const pj = src("progress.js");
    if (!/const crimeGain = slotOwner === 'crime' && crimeAlt\?\.perHour > 0 \? crimeAlt\.perHour \* waitH : 0/.test(pj) || !/\+ crimeGain/.test(pj)) c5.fail("futureBatchAt credits the crime's money when the slot is crime's");
    if (!/const skip = \(num\(skipLn\) && skipLn > 0 \? skipLn : 0\) \/ scale/.test(src("exitplan.js"))) c5.fail("cadenceShapeOf skips skipLn / scale of the model's ln");
  }
  checks.push(c5);
  return checks;
}
