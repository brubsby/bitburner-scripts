// [IL] THE BITNODE 13 INSTALL LOOP (live BN13.1 2026-10-11): installs at 02:33Z
// and 11:06Z for ln(hacking) 0.02 and 0.01 (1-2 NeuroFlux), each resetting
// hacking ~60-114 -> 1; the 11:06Z install priced the exit 27.67h and the new
// life priced itself 41-52h (EXIT JUMP AT INSTALL). Home ($100.68m) unpriced
// for hours.
//
//   IL1  the cadence measures what a gift node's lives BOUGHT: a ledger entry
//        without the gift's factor (BN13 lives 1-2, recorded before the field)
//        is read by its batch's hacking stats, never as the raw ratio — the
//        raw pair credited life 1 with 0.070/h of gift charge and drove the
//        node to 0.054/h (x1.9 a 12h life; its batches bought ~0.003/h).
//   IL2  the install decision on the live inputs: with the old cadence install
//        now beats every wait whose batch grows at the purchase model's own
//        rate; with the measured cadence every such wait beats it.
//   IL3  a multiplier cycle that bought < 1% hacking (lnM >= 0.01) is a slow
//        cycle, not a stall (life 2: 8.53h, one NeuroFlux).
//   IL4  home's spend verdict is priced where the trader's marginal charge
//        exceeds the book (live: lump x3152 over 12h, m1 = $1.53b - $317b ->
//        "not affordable by the install" though the stream reaches $100.68m
//        at ~1h); without a trader the verdict is unchanged.
//   IL5  a winning save-for-home verdict at an install now holds the install
//        (installgate homeSave), and progress.js prices it at W = 0.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Check } from "./harness.mjs";
import "./gameresolve.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
const FX = JSON.parse(fs.readFileSync(path.join(REPO, "tools/test/fixture-bn13-installloop-1246.json"), "utf8"));
const B = await import("../../bayes.js");
const X = await import("../../exitplan.js");
const G = await import("../../installgate.js");

const posteriorOf = (withBatch) =>
  B.cadencePosterior(FX.ledger, 13, {
    hackMultNow: FX.hackMultNow,
    giftHackNow: FX.giftHackNow,
    ...(withBatch ? { batchHackOf: B.batchHackOfStats?.(FX.stats) } : {}),
    modelPrior: { lnPerHour: FX.cadenceModel.lnPerHour, cycleHours: FX.cadenceModel.cycleHours },
  });

export async function run() {
  const checks = [];

  const c1 = new Check("IL1", "a gift node's cadence is what its lives' batches bought, never the raw multiplier ratio");
  let fixed = null;
  {
    c1.examined(3);
    if (typeof B.batchHackOfStats !== "function") c1.fail("bayes.batchHackOfStats is missing");
    fixed = posteriorOf(true);
    const lives = B.ledgerLives(FX.ledger, { node: 13, hackMultNow: FX.hackMultNow, giftHackNow: FX.giftHackNow, batchHackOf: B.batchHackOfStats?.(FX.stats) }).filter((l) => l.node === 13);
    const want = [Math.log(1.0201052924068645), Math.log(1.01000262)];
    lives.forEach((l, i) => {
      if (!(Math.abs(l.g - want[i]) < 1e-6)) c1.fail(`BN13 life ${i + 1}: its batch bought ln ${want[i].toFixed(4)}, read ${l.g} (${l.gBy})`);
    });
    // Without a batch to read, the raw ratio is not a measurement: unmeasured.
    const bare = B.ledgerLives(FX.ledger.map((e) => (e.bitNode === 13 ? { ...e, installBatch: undefined } : e)), { node: 13, hackMultNow: FX.hackMultNow, giftHackNow: FX.giftHackNow }).filter((l) => l.node === 13);
    if (bare.some((l) => l.g !== null)) c1.fail(`a gift node's entry with neither factor nor batch is unmeasured: ${bare.map((l) => l.g).join(", ")}`);
    if (!(fixed?.lnPerHour < 0.012)) c1.fail(`the node's cadence on its measured lives must be < 0.012/h (the batches: 0.0026/h over 11.4h; the purchase model 0.011/h): ${fixed?.lnPerHour} — ${fixed?.why}`);
    c1.note(`cadence ${fixed?.lnPerHour?.toFixed(4)}/h (x${Math.exp(fixed?.lnPerHour * 12).toFixed(3)} a 12h life) — live 0.0537/h (x1.905)`);
  }
  checks.push(c1);

  const c2 = new Check("IL2", "the install decision on the live inputs: a wait growing the batch at the purchase model's rate beats installing now at the measured cadence, not at the gift-inflated one");
  {
    c2.examined(2);
    const base = FX.inputs;
    const g = (h) => ({ hacking: h, rep: 1, income: 1, exp: 1 });
    const r = FX.cadenceModel.lnPerHour;
    const decide = (lnPerHour) => {
      const inp = { ...base, multGainPerCycle: Math.exp(lnPerHour * base.cycleHours) };
      const now = X.bestExitPolicy({ ...inp, firstInstallH: 0, installGains: g(1.01), nextInstallGain: 1.01 }, 400, 1).best?.hours;
      const gw = 1.01 * Math.exp(r * 4);
      const w4 = X.bestExitPolicy({ ...inp, firstInstallH: 4, installGains: g(gw), nextInstallGain: gw }, 400, 1).best?.hours;
      return { now, w4 };
    };
    const old = decide(0.0537);
    const neu = decide(fixed?.lnPerHour ?? 0.0537);
    c2.note(`live cadence 0.0537/h: now ${old.now?.toFixed(1)}h vs wait 4h ${old.w4?.toFixed(1)}h; measured ${fixed?.lnPerHour?.toFixed(4)}/h: now ${neu.now?.toPrecision(4)}h vs wait 4h ${neu.w4?.toPrecision(4)}h`);
    if (!(old.now < old.w4)) c2.fail(`the replay must reproduce the live install (now < wait at 0.0537/h): ${JSON.stringify(old)}`);
    if (!(neu.w4 < neu.now)) c2.fail(`at the measured cadence the wait must beat installing now: ${JSON.stringify(neu)}`);
  }
  checks.push(c2);

  const c3 = new Check("IL3", "a multiplier cycle that bought < 1% hacking is a slow cycle, not a stall");
  {
    c3.examined(2);
    if (!(fixed?.own?.gained === 2 && fixed?.own?.stalls === 0)) c3.fail(`BN13 lives 1-2 both count (life 2: lnM 0.095, one NeuroFlux): ${JSON.stringify(fixed?.own)}`);
    // A favour-banking / ticket life (no M) still stalls.
    const led = [
      { at: "2026-10-11T02:00:00Z", lifeH: 2, hackMult: 2, bitNode: 77 },
      { at: "2026-10-11T05:00:00Z", lifeH: 2, hackMult: 2.002, bitNode: 77, lnM: 0.001 },
      { at: "2026-10-11T08:00:00Z", lifeH: 2, hackMult: 2.004, bitNode: 77 },
    ];
    const p = B.cadencePosterior(led, 77, { hackMultNow: 2.004, modelPrior: { lnPerHour: 0.01, cycleHours: 2 } });
    if (!(p?.own?.stalls >= 2)) c3.fail(`lives with no M gain stay stalls: ${JSON.stringify(p?.own)}`);
  }
  checks.push(c3);

  const c4 = new Check("IL4", "home's verdict is priced where the trader's marginal charge exceeds the book");
  {
    c4.examined(3);
    const inputs = FX.inputs;
    const h = FX.home;
    const moneyAt = (t) => inputs.money + ((h.moneyAtW - inputs.money) * t) / h.W;
    const gainsAt = (m) => ({ hacking: m > 1e9 ? 1.0201 : 1.01, rep: 1, income: 1, exp: 1 });
    const r = X.spendExit({ inputs, cost: h.cost, gainPerSec: 0, W: h.W, moneyAt, gainsAt, persists: true, expGainPerSec: h.expGainPerSec });
    c4.note(`home: ${r.deltaH === null ? r.why : `deltaH ${r.deltaH.toFixed(2)}h, m1 $${(r.moneyAtW?.m1 / 1e6).toFixed(0)}m (linear $${((r.moneyAtW?.m1Linear ?? r.moneyAtW?.m1) / 1e6).toFixed(0)}m)${r.moneyAtW?.floored ? " floored" : ""}`}`);
    if (!(typeof r.deltaH === "number" && isFinite(r.deltaH))) c4.fail(`home must be priced: ${r.why}`);
    else if (!r.moneyAtW?.floored || !(r.moneyAtW.m1 >= 0)) c4.fail(`the live shape is the floored case: ${JSON.stringify(r.moneyAtW)}`);
    // No trader: exactly as before (lump 1).
    const plain = { ...inputs, capitalReturnPerSec: 0, capitalShape: null, capitalScaleW: null };
    const q = X.spendExit({ inputs: plain, cost: 1e6, gainPerSec: 500, W: 12, moneyAt: (t) => 1e6 + 3e3 * t * 3600, gainsAt, persists: false });
    const tb = 0;
    const want = 1e6 + 3e3 * 12 * 3600 - 1e6 + 500 * (12 - tb) * 3600;
    if (!q.moneyAtW || Math.abs(q.moneyAtW.m1 - want) > 1 || q.moneyAtW.floored) c4.fail(`no trader: m1 unchanged (${want}), got ${JSON.stringify(q.moneyAtW)}`);
  }
  checks.push(c4);

  const c5 = new Check("IL5", "a winning save-for-home verdict at an install now holds the install");
  {
    c5.examined(3);
    const pj = src("progress.js");
    if (!/const homeSaveNow = \(\(\) => \{[\s\S]{0,600}spendVerdictsOf\(ns, info, gateExitInputs, 0, false/.test(pj)) c5.fail("progress.js prices home at W = 0 on the install decision's inputs (homeSaveNow)");
    if (!/shouldInstall\(\{\s*homeSave: homeSaveNow,/.test(pj)) c5.fail("progress.js passes homeSave to the gate");
    const ig = src("installgate.js");
    if (!/const homeSaveHold = !blade && !terminal && !mandateHold && o\.homeSave\?\.wins === true/.test(ig) || !/!mandateHold && !homeSaveHold && \(terminal \|\|/.test(ig)) c5.fail("installgate holds the install on a winning home save (homeSaveHold)");
  }
  checks.push(c5);
  return checks;
}
