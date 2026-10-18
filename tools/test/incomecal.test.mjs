// [IC] THE EXIT'S INCOME FROM THE STATE, CALIBRATED (exitplan.incomeModelOf over
// freshlife.steadyIncomeOf; tools/sim/incomecal.mjs).
//
// Live BN10.3 2026-10-18: the exit model priced the mandated 5th Covenant
// sleeve's $1e17 money leg at ~374h (exit 424-480h, EXIT NOT APPROACHING,
// INSTALL DEFERRED REPEATEDLY) against ~10-22h on BN10.1's measured late
// income. Its money legs read income = incomeAtLevel1 x (level + 50) / 51 from
// today's measured income: today's fleet and today's money multipliers held
// for the rest of the node (only the next batch's income gain was applied),
// and the batcher's split held too. BN10.1 grew its home RAM 4TB -> 16-32PB
// and its hacking_money x10 across the node; the late income was ~1e4x the
// level-scaled extrapolation.
//
//   IC1 THE CALIBRATION (fixture-incomecal.json, from history.jsonl): from an
//       EARLY life's measured income, the late life's income through the model
//       (q x the formula at the late state; q clipped to Q_BAND) is within
//       x/÷2.5 of the measured late income on BN10.1, BN13.1 and BN9.1; the old
//       level-scaled extrapolation is >= 100x low on each (the regression this
//       replaced, printed). BN8.1: scripts earn nothing, the model returns null.
//   IC2 EXITPLAN CARRIES IT: incomeModelOf + incomeTableAt on a grid built at
//       BN10.1's early multipliers, anchored at its early life, read at the
//       late life's level and RAM with the late multipliers on the k axis, land
//       within x/÷2.5 of BN10.1's measured late income ($2.47e12/s)
//   IC3 THE LIVE BN10.3 INPUTS (fixture-bn10-covenant.json, 16:50Z): the
//       Covenant leg with the model is under 150h and the exit with the mandate
//       under 200h; without the model (the old income) it is over 300h; the
//       exit without the mandate is unchanged within 1h; the leg buys home RAM
//   IC4 hoursToMoney with incomeAt: a home doubling is bought only when it
//       repays inside the leg, never below a zero balance; without
//       o.incomeAt the leg is the level-scaled one exactly
import "./gameresolve.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Check } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const X = await import(path.join(REPO, "exitplan.js"));
const FL = await import(path.join(REPO, "freshlife.js"));
const { bitNodeMults } = await import(path.join(REPO, "bitNodeMultipliers.js"));
const { COVENANT } = await import(path.join(REPO, "sleeveplan.js"));

const TOL = Math.log(2.5);
const e = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)} (x${Math.exp(v).toPrecision(3)})`;

export async function run() {
  const checks = [];
  const fx = JSON.parse(fs.readFileSync(path.join(HERE, "fixture-incomecal.json"), "utf8"));

  {
    const c = new Check("IC1", "the income model from an early life reproduces each node's measured late income within x/÷2.5");
    for (const x of fx.nodes) {
      c.examined(1);
      if (!x.anchor) {
        const m = X.incomeModelOf(null, 1, 1);
        if (m !== null) c.fail(`${x.name}: a node without the model must price with the old income`);
        c.note(`${x.name}: not applicable — ${x.why}`);
        continue;
      }
      const bn = bitNodeMults(x.bn, 1);
      const g = (s) => FL.steadyIncomeOf({ bn, mults: s.mults, level: s.L, ramGB: s.R });
      const q = Math.min(X.Q_BAND, Math.max(1 / X.Q_BAND, x.anchor.I / g(x.anchor)));
      const pred = q * g(x.late);
      const old = x.anchor.I * ((x.late.L + 50) / (x.anchor.L + 50));
      const err = Math.log(pred / x.late.I);
      const errOld = Math.log(old / x.late.I);
      c.note(`${x.name} life ${x.anchor.life} (L${x.anchor.L}, $${x.anchor.I.toExponential(2)}/s) -> life ${x.late.life} (L${x.late.L}): measured $${x.late.I.toExponential(2)}/s, model $${pred.toExponential(2)} ${e(err)}, old level-scaled $${old.toExponential(2)} ${e(errOld)}`);
      if (!(Math.abs(err) <= TOL)) c.fail(`${x.name}: the model's late income is off ${e(err)} (tolerance x/÷2.5)`);
      if (!(errOld < -Math.log(100))) c.fail(`${x.name}: the old extrapolation was expected >= 100x low, read ${e(errOld)} — the fixture no longer shows the regression`);
    }
    checks.push(c);
  }

  {
    const c = new Check("IC2", "exitplan's grid + anchor + money axis carries BN10.1's early life to its late income");
    const x = fx.nodes.find((n) => n.name === "BN10.1");
    const bn = bitNodeMults(10, 1);
    const ks = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
    // the money axis's mix: the node's own (anchor -> late) ln shares, as progress.js reads the planned batch's
    const lr0 = (key) => Math.log(x.late.mults[key] / x.anchor.mults[key]);
    const tot = lr0("hacking_money") + lr0("hacking_speed") + lr0("hacking_chance");
    const shares = { money: lr0("hacking_money") / tot, speed: lr0("hacking_speed") / tot, chance: lr0("hacking_chance") / tot, hgrow: lr0("hacking_grow") / tot };
    const table = FL.incomeTableOf({ bn, mults: x.anchor.mults, shares, levels: [1, 50, 150, 300, 600, 1000, 1600, 2500, 4000, 6000, 10000, 20000], lr: [6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30], ks });
    // the anchor: the RAM the batcher owns then (home + purchased; the network counted, as batch.txt does)
    const net = FL.worldOf(bn).filter((s) => s.host !== "w0r1d_d43m0n").reduce((a, s) => a + s.ram, 0);
    const im = X.incomeModelOf({ table, homeGB: x.anchor.R + net, otherGB: 0 }, x.anchor.I, x.anchor.L);
    c.examined(1);
    if (!im) c.fail("incomeModelOf refused BN10.1's anchor");
    else {
      const prod = (m) => m.hacking_money * m.hacking_speed * m.hacking_chance;
      const k = prod(x.late.mults) / prod(x.anchor.mults);
      const pred = im.at(x.late.L, x.late.R + net, k);
      const err = Math.log(pred / x.late.I);
      c.note(`BN10.1: q ${im.q.toFixed(2)} (raw ${im.qRaw.toFixed(2)}), money multipliers x${k.toFixed(1)} (k^ money ${shares.money.toFixed(2)} speed ${shares.speed.toFixed(2)} chance ${shares.chance.toFixed(2)} grow ${shares.hgrow.toFixed(2)}), home ${x.anchor.R} -> ${x.late.R}GB, L${x.anchor.L} -> L${x.late.L}: $${pred.toExponential(2)}/s against $${x.late.I.toExponential(2)}/s measured ${e(err)}`);
      if (!(Math.abs(err) <= TOL)) c.fail(`BN10.1 late income through exitplan off ${e(err)}`);
    }
    checks.push(c);
  }

  {
    const c = new Check("IC3", "the live BN10.3 inputs: the Covenant leg priced on the state's income, not 374h");
    const F = JSON.parse(fs.readFileSync(path.join(HERE, "fixture-bn10-covenant.json"), "utf8"));
    const cov = { ...F.covenant, joinMoney: COVENANT.joinMoney };
    const I = F.inputs;
    const { incomeModel, ...I0 } = I;
    const best = (o) => X.bestExitPolicy(o)?.best;
    const withM = best({ ...I, covenant: cov });
    const withoutM = best(I);
    const oldWith = best({ ...I0, covenant: cov });
    const oldWithout = best(I0);
    c.examined(4);
    const leg = (b) => b?.legs?.find((l) => l.leg === "covenant money");
    c.note(`with the model: exit ${withM?.hours?.toFixed(1)}h (${withM?.installsFirst} installs), Covenant leg ${leg(withM)?.hours?.toFixed(1)}h — ${String(leg(withM)?.detail ?? "").slice(0, 220)}`);
    c.note(`old income: exit ${oldWith?.hours?.toFixed(1)}h (${oldWith?.installsFirst} installs), leg ${leg(oldWith)?.hours?.toFixed(1)}h; without the mandate ${withoutM?.hours?.toFixed(2)}h (old ${oldWithout?.hours?.toFixed(2)}h)`);
    if (!(withM?.hours < 200)) c.fail(`the exit with the mandate reads ${withM?.hours}h on the state's income (expected < 200h)`);
    if (!(leg(withM)?.hours < 150)) c.fail(`the Covenant leg reads ${leg(withM)?.hours}h (expected < 150h)`);
    if (!(oldWith?.hours > 300)) c.fail(`the old income was expected to read > 300h here (the regression), read ${oldWith?.hours}h`);
    if (!(Math.abs(withoutM?.hours - oldWithout?.hours) < 1)) c.fail(`the exit without the mandate moved ${withoutM?.hours}h vs ${oldWithout?.hours}h`);
    if (!/home \d+ -> \d+GB/.test(String(leg(withM)?.detail)) || /home (\d+) -> \1GB/.test(String(leg(withM)?.detail))) c.fail("the Covenant leg bought no home RAM");
    checks.push(c);
  }

  {
    const c = new Check("IC4", "hoursToMoney's home doubling: bought when it repays inside the leg, never into debt");
    const base = { money0: 0, incomeAtLevel1: 1e6, mult: 1, exp0: 1e30, expPerSec: 0 };
    const h0 = X.hoursToMoney(1e12, base);
    const lin = X.hoursToMoney(1e12, { ...base, incomeAt: (L) => (1e6 * (L + 50)) / 51 });
    c.examined(3);
    if (!(Math.abs(h0 - lin) / h0 < 1e-3)) c.fail(`incomeAt equal to the level-scaled income moved the leg: ${h0} vs ${lin}`);
    // income linear in home RAM: $1/s per GB; a doubling from 1TB costs 1TB x base x 1.58^10
    const st = { gb: 1024 };
    const cost = (gb) => gb * 48000 * Math.pow(1.58, Math.log2(gb));
    const hBuy = X.hoursToMoney(1e15, { ...base, incomeAt: (L, gb) => (gb ?? 1024) * 1e3, homeRam: st, homeCostAt: cost });
    const hNo = X.hoursToMoney(1e15, { ...base, incomeAt: (L, gb) => (gb ?? 1024) * 1e3 });
    c.note(`$1e15 at $1e3/s per GB from 1TB: ${hNo.toFixed(1)}h holding the home, ${hBuy.toFixed(1)}h buying (home -> ${st.gb}GB)`);
    if (!(st.gb > 1024 && hBuy < hNo)) c.fail("a doubling that repays many times inside the leg was not bought");
    const st2 = { gb: 1024 };
    const hShort = X.hoursToMoney(2e9, { ...base, incomeAt: (L, gb) => (gb ?? 1024) * 1e3, homeRam: st2, homeCostAt: cost });
    c.note(`a short leg ($2e9, ${hShort.toFixed(2)}h): home ${st2.gb}GB`);
    if (st2.gb !== 1024) c.fail("a short leg bought a doubling it cannot repay");
    checks.push(c);
  }
  return checks;
}
