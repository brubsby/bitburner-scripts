// [EF] The exp farm (expfarm.js + batch.js exp mode): where hacking pays
// nothing, the fleet is allocated for hacking exp per GB-second.
//
//   EF1  expPerThread is the game's calculateHackingExpGain (Hacking.ts:30-38)
//   EF2  an unpadded hack+weaken unit beats weaken-only and the padded HWGW
//        batch per GB-second — the reason the farm exists
//   EF3  waves stay underflow-safe and chunks never drain the balance to zero
//   EF4  manipVerdict is exit-with vs exit-without on the same inputs, and
//        refuses (serves nothing) without the trader's manipCurve
//   EF5  batch.js is gated on the node (expMode) and the farm runs only there;
//        spill is off in exp mode; h.js is launched unpadded by the farm
//   EF6  seed.js ranks by exp and drops the money floor only in exp mode

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";
import "../sim/env.mjs";

const g = await import("../sim/game.bundle.mjs");
const E = await import("../../expfarm.js");
const X = await import("../../exitplan.js");
const { bitNodeMults } = await import("../../bitNodeMultipliers.js");

const code = (f) =>
  fs
    .readFileSync(path.join(REPO_ROOT, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

export async function run() {
  const checks = [];

  const c1 = new Check("EF1", "exp per thread is the game's calculateHackingExpGain (Hacking.ts:30-38)");
  {
    const person = { mults: { hacking_exp: 1 }, skills: { hacking: 100 } };
    for (const base of [1, 5, 10, 33, 99]) {
      c1.examined(1);
      const game = g.calculateHackingExpGain({ baseDifficulty: base }, person);
      const ours = E.expPerThread(base);
      if (Math.abs(game - ours) > 1e-12) c1.fail(`base ${base}: game ${game} vs ours ${ours}`);
    }
    c1.note(`base 10 -> ${E.expPerThread(10)} exp/thread, matching the game`);
  }
  checks.push(c1);

  const c2 = new Check("EF2", "per GB-second, unpadded hack+weaken > weaken-only > nothing, and the padded HWGW earns no more than weaken");
  {
    c2.examined(3);
    const t = { baseDifficulty: 15, hackTime: 10000, chance: 0.9 };
    const farm = E.expScore(t);
    const w = E.weakenScore(t);
    const b = E.batchedScore(t);
    if (!(farm > 2.5 * w)) c2.fail(`farm ${farm} is not well above weaken-only ${w}`);
    if (!(b <= w * 1.02)) c2.fail(`padded HWGW ${b} should earn about the weaken rate ${w}`);
    c2.note(`exp/GB-ms: farm ${farm.toExponential(3)}, weaken ${w.toExponential(3)}, padded batch ${b.toExponential(3)} (x${(farm / b).toFixed(2)})`);
    if (E.expScore({ ...t, chance: null }) !== 0) c2.fail("an unreadable chance must score 0, not be guessed");
  }
  checks.push(c2);

  const c3 = new Check("EF3", "wave sizing: chunks keep phi x threads < 1, waves stay far above double underflow");
  {
    c3.examined(3);
    const phi = 0.00125; // BN8: (1/240) x ScriptHackMoney 0.3 at the easiest server
    for (const pool of [1e3, 1e5, 1e7]) {
      const p = E.wavePeriod({ poolGB: pool, T: 20000, phi });
      const w = E.waveSize({ poolGB: pool, T: 20000, periodMs: p, phi });
      if (!w) {
        c3.fail(`no wave for pool ${pool}`);
        continue;
      }
      if (!(w.chunkMax * phi < 1)) c3.fail(`chunk of ${w.chunkMax} threads drains the balance (phi x n = ${w.chunkMax * phi})`);
      if (!w.safe && p > 1000) c3.fail(`pool ${pool}: wave decay ${w.decay} is not underflow-safe at period ${p}`);
      c3.note(`pool ${pool}GB: period ${Math.round(p)}ms, ${w.hack} hack in ${w.chunks} chunk(s), ${w.weaken} weaken, decay ${w.decay.toFixed(1)}`);
    }
  }
  checks.push(c3);

  const c4 = new Check("EF4", "manipVerdict: two exits on one input set; no manipCurve -> not served");
  {
    c4.examined(3);
    const inputs = {
      money: 3e8, incomePerSec: 0, capitalReturnPerSec: 1e-5, hacking: 500, hackingExp: X.expForLevel(500, 8), hackingMult: 8,
      expPerSec: 5000, repPerSec: 50, exitLevel: 3000, joinMoney: 100e9, terminalRep: 2.5e6, donationCost: 2.5e12,
      favorToDonate: 0, installCash: 250e6, cycleHours: 5, multGainPerCycle: 1.3, workWhileDonating: true,
    };
    const base = { bestExitPolicy: X.bestExitPolicy, inputs, nu: 0.5, manipGB: 1e4, farmRate: 1, batchRate: 0.3, fleetGB: 1e5 };
    const none = E.manipVerdict({ ...base, curve: null });
    if (none.serve !== false || none.priced !== false) c4.fail("served manip without a curve", JSON.stringify(none));
    // A curve whose return triples with nudges: serving must win.
    const rich = E.manipVerdict({ ...base, curve: [{ nudgesPerSec: 0, returnPerSec: 1e-5 }, { nudgesPerSec: 1, returnPerSec: 3e-4 }] });
    if (!rich.priced || rich.serve !== true) c4.fail("a large return gain was not served", JSON.stringify(rich));
    // A flat curve: serving only costs exp, so it must lose.
    const flat = E.manipVerdict({ ...base, curve: [{ nudgesPerSec: 0, returnPerSec: 1e-5 }, { nudgesPerSec: 1, returnPerSec: 1e-5 }] });
    if (!flat.priced || flat.serve !== false) c4.fail("a manip that buys no return was served", JSON.stringify(flat));
    // The decision IS withH - withoutH on shared inputs.
    const a = X.bestExitPolicy({ ...inputs, capitalReturnPerSec: 1e-5 }).best.hours;
    if (Math.abs(rich.withoutH - a) > 1e-9) c4.fail("the without-run is not the published inputs at r(0)");
    c4.note(`rich: ${rich.why}`);
    c4.note(`flat: ${flat.why}`);
  }
  checks.push(c4);

  const c5 = new Check("EF5", "batch.js farms exp only in exp mode; spill off there; hacks launched unpadded");
  {
    c5.examined(4);
    const s = code("batch.js");
    if (!/farm\.on = !flags\.nofarm && expMode\(nodeMults\)/.test(s)) c5.fail("batch.js no longer gates the farm on expMode(the node's table)");
    if (!/if \(!farm\.on && anyBatching && targets\.length\)/.test(s)) c5.fail("the weaken spill still runs in exp mode (it would starve the farm)");
    if (!/spreadChunks\(ns, free, ram, 'hack', tgt\.host, wv\.hack, wv\.chunk, nextId\)/.test(s)) c5.fail("the farm's hacks are not launched through spreadChunks");
    if (!/exec\(SETTINGS\.workers\[op\], host, \{ threads: take, temporary: true \}, target, 0, nextId\(\)/.test(s)) c5.fail("spreadChunks pads its ops — a padded hack earns the weaken rate");
    if (E.expMode(bitNodeMults(8)) !== true || E.expMode(bitNodeMults(1)) !== false || E.expMode(bitNodeMults(4)) !== false || E.expMode(null) !== false) c5.fail("expMode is not exactly 'ScriptHackMoneyGain is 0'");
  }
  checks.push(c5);

  const c6 = new Check("EF6", "seed.js ranks by exp and drops the money floor only in exp mode");
  {
    c6.examined(2);
    const s = code("seed.js");
    if (!/const floor = exp \? EXP_FLOOR : flags\.floor/.test(s)) c6.fail("seed.js no longer drops the money floor in exp mode");
    if (!/exp \? expRank\(b\) - expRank\(a\) : prepScore\(b\) - prepScore\(a\)/.test(s)) c6.fail("seed.js no longer ranks by exp in exp mode");
  }
  checks.push(c6);

  // A mock world: batch.js's farmTick driven for 60s of 200ms ticks against one
  // target with a constant hack time, recording every exec. Pins the wave
  // mechanics: weaken + 1-thread grow launched per wave, hacks launched with NO
  // pad at L - hackTime so they land inside [L - gap/2, L + gap/2], chunked.
  const c7 = new Check("EF7", "farmTick (batch.js, mock ns): waves = padded weaken + 1-thread grow, then UNPADDED hack chunks landing on schedule");
  {
    const B = await import("../../batch.js");
    const T = 4000;
    const execs = [];
    const ns = {
      getServerSecurityLevel: () => 5,
      getHackTime: () => T,
      exec: (script, host, opts, target, pad, id, flag) => {
        execs.push({ script, host, threads: opts.threads, target, pad, flag, at: clock });
        return execs.length;
      },
    };
    let clock = 1e6;
    Object.assign(B.farm, { on: true, weakenRate: 1, target: { host: "joesguns", minSec: 5, hackTime: T, chance: 1, phi: 0.00125 }, waves: [], held: [], nextCreate: 0, launchedWaves: 0, skippedWaves: 0 });
    const ram = { hack: 1.7, grow: 1.75, weaken: 1.75 };
    let id = 0;
    for (let k = 0; k < 300; k++) {
      clock += 200;
      const free = new Map([["pserv-0", 2048], ["pserv-1", 2048]]);
      B.farmTick(ns, free, ram, clock, () => id++);
    }
    const hacks = execs.filter((e) => e.script === "h.js");
    const weakens = execs.filter((e) => e.script === "w.js");
    const grows = execs.filter((e) => e.script === "g.js");
    c7.examined(execs.length);
    if (!hacks.length || !weakens.length || !grows.length) c7.fail("the farm did not launch all three ops", `h ${hacks.length} w ${weakens.length} g ${grows.length}`);
    if (hacks.some((e) => e.pad !== 0)) c7.fail("a farm hack was padded — it would hold RAM for a weaken time");
    if (hacks.some((e) => e.flag !== 0)) c7.fail("a farm hack carries the stock flag");
    if (grows.some((e) => e.threads !== 1)) c7.fail("the per-wave grow is not 1 thread");
    if (hacks.some((e) => e.threads * 0.00125 >= 1)) c7.fail("a hack chunk would drain the balance to zero");
    const hThreads = hacks.reduce((a, e) => a + e.threads, 0);
    const wThreads = weakens.reduce((a, e) => a + e.threads, 0);
    if (!(wThreads * 0.05 >= hThreads * 0.002)) c7.fail(`weakens (${wThreads}) do not cover the hacks' fortify (${hThreads} threads)`);
    c7.note(`60s: ${B.farm.launchedWaves} waves launched, ${B.farm.skippedWaves} skipped; ${hThreads} hack / ${wThreads} weaken / ${grows.length} grow threads; hack share of RAM-time ${((hThreads * 1.7 * T) / (hThreads * 1.7 * T + wThreads * 1.75 * 4 * T)).toFixed(2)}`);
    if (!(B.farm.launchedWaves > B.farm.skippedWaves)) c7.fail("most waves were skipped on a perfectly steady target");
  }
  checks.push(c7);

  return checks;
}
