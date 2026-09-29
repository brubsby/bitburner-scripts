// PER-LIFE GAIN against the money each life WALKS (exitplan
// lifeStreamMultiples), not the carried schedule's peak.
//
// Live BN9 2026-09-29 ~21:00Z the plan read "a life's $3.45e+10 (x125.54
// with every stream) buys": kAll was the MAX over every step of the carried
// schedule — a fresh gang's last simulated hour, $7.76m/s at hour ~100, over
// ~$62k/s of scripts — applied to every later life. With a bound that large
// PER-LIFE GAIN UNBOUGHT could not fire while a gang was carried.
//
//   PS1  lifeStreamMultiples integrates the streams over each life's own
//        hours at its place on the schedule (hand-checked), run-length encoded
//   PS2  on the live 20:22Z exit inputs, a gang whose rate arrives only after
//        every later life has ended would have lifted the peak bound past an
//        over-priced x1.153/life; the per-life bound does not, and the check
//        FAILS. The same stream arriving at hour 0 raises the bound (it is
//        walked, so it is bought).
import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const E = await import("../../exitplan.js");
const P = await import("../../plan.js");

export async function run() {
  const checks = [];

  const c1 = new Check("PS1", "lifeStreamMultiples: each later life's money multiple is the carried streams integrated over its own hours, over base x its length");
  {
    c1.examined(4);
    const steps = [{ atH: 0, perSec: 0 }, { atH: 10, perSec: 1e6 }];
    // Lives of 2h from hour 1: [1,3) [3,5) [5,7) [7,9) [9,11) [11,13) ...
    const r = E.lifeStreamMultiples(steps, 1e4, 1, 2, 8);
    const ks = r.runs.flatMap((x) => Array(x.n).fill(x.k));
    const want = [1, 1, 1, 1, 1 + (1e6 * 1) / (1e4 * 2), 101, 101, 101];
    if (ks.length !== 8 || ks.some((k, i) => Math.abs(k - want[i]) > 1e-9)) c1.fail(`per-life k ${ks.join(",")} vs ${want.join(",")}`);
    if (!(Math.abs(r.mean - want.reduce((a, b) => a + b) / 8) < 1e-9)) c1.fail(`mean ${r.mean}`);
    if (r.peak !== 101 || r.first !== 1 || r.last !== 101) c1.fail(`peak/first/last ${r.peak}/${r.first}/${r.last}`);
    if (r.runs.length !== 3) c1.fail(`run-length: ${JSON.stringify(r.runs)}`);
    if (E.lifeStreamMultiples([], 1e4, 0, 1, 5).mean !== 1 || E.lifeStreamMultiples(steps, 0, 0, 1, 5).mean !== 1) c1.fail("no steps or no base: every k is 1");
    // Before the first step the rate is 0; negative rates never subtract.
    const late = E.lifeStreamMultiples([{ atH: 5, perSec: -3e4 }, { atH: 6, perSec: 2e4 }], 1e4, 0, 2, 4);
    const lk = late.runs.flatMap((x) => Array(x.n).fill(x.k));
    if (Math.abs(lk[0] - 1) > 1e-12 || Math.abs(lk[2] - 1) > 1e-12 || Math.abs(lk[3] - (1 + (2e4 * 2) / (1e4 * 2))) > 1e-9) c1.fail(`late/negative steps: ${lk.join(",")}`);
    c1.note(`2h lives from hour 1 over a $1m/s step at hour 10 on $10k/s: k ${ks.map((k) => k.toFixed(0)).join(",")} (mean ${r.mean.toFixed(1)}, peak ${r.peak})`);
  }
  checks.push(c1);

  const c2 = new Check("PS2", "a carried gang's PEAK no longer masks an over-priced life: its rate arriving after the later lives leaves the bound where the lives' own money puts it, and PER-LIFE GAIN UNBOUGHT fires");
  {
    const G = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-perlife-2022.json"), "utf8"));
    const I = G.exitinputs.inputs;
    const spec = P.basisOf(G.install, Date.parse(G.at));
    const lives = 42;
    const cyc = 0.5;
    // The live 20:22Z inputs at the purchase model's own 0.5h row, with a
    // gang whose $7.76m/s (the peak live at ~21:00Z) starts at hour 1000 —
    // after every later life has ended.
    const buyer = E.purchaseGainOf(I.cadence, cyc, I.cadenceFrom);
    const base = { ...I, firstInstallH: spec.waitH, installGains: spec.gains, nextInstallGain: spec.gains.hacking, cycleHours: cyc, multGainPerCycle: buyer.gL };
    const gangAt = (h) => ({ ...base, carriedIncome: { gang: [{ atH: 0, perSec: 0 }, { atH: h, perSec: 7.76e6 }] } });
    c2.examined(3);
    const late = E.exitHours(gangAt(1000), lives + 1, true);
    const pl = late?.perLife;
    if (!pl) c2.fail(`no perLife on the exit: ${late?.why}`);
    else {
      if (!(pl.kPeak === 1 && pl.kAll === 1)) c2.fail(`the lives end before hour 1000: no life walks the gang, k mean ${pl.kAll} peak ${pl.kPeak}`);
      const ok = P.perLifeGainCheckOf({ perLife: pl });
      if (ok.ok !== true) c2.fail(`the exit as priced must pass: ${ok.why}`);
      // AN OVER-PRICED LIFE: the same exit with each later life priced 3%
      // above what it is (the shape of the 20:22Z fault, x1.153 against
      // x1.0626: a lift the lives cannot buy).
      const over = { ...pl, pricedLn: pl.pricedLn + Math.log(1.03) };
      const chk = P.perLifeGainCheckOf({ perLife: over });
      if (chk.ok !== false || !/^PER-LIFE GAIN UNBOUGHT/.test(chk.why)) c2.fail(`3% over the lives' own money must be UNBOUGHT: ${chk.why}`);
      // What the peak rule would have said: the same bound with its money
      // term at k = the schedule's peak over the scripts' stream.
      const kOldPeak = (I.incomePerSec + 7.76e6) / I.incomePerSec;
      const peakBound = pl.boughtLn - buyer.lnGainAt(buyer.mL * pl.kAll) + buyer.lnGainAt(buyer.mL * kOldPeak);
      const masked = P.perLifeGainCheckOf({ perLife: { ...over, boughtLn: peakBound, kAll: kOldPeak } });
      if (masked.ok !== true) c2.fail(`the fixture must show the masking: the peak bound x${Math.exp(peakBound).toFixed(4)} should have passed x${Math.exp(over.pricedLn).toFixed(4)}`);
      c2.note(`${lives} lives of 0.5h: x${Math.exp(pl.pricedLn).toFixed(4)} priced, per-life bound x${Math.exp(pl.boughtLn).toFixed(4)} (k 1: no life walks the gang); over-priced x${Math.exp(over.pricedLn).toFixed(4)} -> ${chk.ok === false ? "UNBOUGHT" : "passes"}; the peak rule (k ${kOldPeak.toFixed(0)}) bounded it at x${Math.exp(peakBound).toFixed(4)} -> ${masked.ok ? "passed (masked)" : "caught"}`);
    }
    // Walked from hour 0, the same stream is bought: the bound rises.
    const early = E.exitHours(gangAt(0), lives + 1, true)?.perLife;
    if (!(early && pl && early.boughtLn > pl.boughtLn && early.kAll > 50)) c2.fail(`a stream the lives walk must raise the bound: ${early?.boughtLn} vs ${pl?.boughtLn} (k ${early?.kAll})`);
    else c2.note(`the same $7.76m/s from hour 0: k mean ${early.kAll.toFixed(1)}, bound x${Math.exp(early.boughtLn).toFixed(4)}`);
  }
  checks.push(c2);

  return checks;
}
