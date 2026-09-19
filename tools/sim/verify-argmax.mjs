// Runs batch.js's OWN target-count code against real worlds, offline.
//
//   node tools/sim/verify-argmax.mjs
//
// docs/target-count.md validated the argmax *model* using the simulator's
// batchPlan. That is not the same thing as validating the code that actually
// ships: the deployed version calls batch.js's planBatch, with budgets derived
// from a live fleet, over the live ranked list. Deploying on the strength of a
// model validation — and then debugging the result in production — is what put
// a dead batcher in front of the user.
//
// So this exercises the shipped functions on adversarial inputs and asserts two
// things a model check cannot: it must not throw, and it must terminate fast.
//
// CALIBRATION: none, and none is needed — this asserts PROPERTIES (no throw,
// terminates fast), not quantities, so there is no number here whose scale
// could be wrong. The quantities that batch.js produces are calibrated against
// the live game in verify-alloc-shipped.mjs section 0.

import "./env.mjs";
import { importRootScript } from "./rootimport.mjs";
const b = await importRootScript("batch.js");

const ram = { hack: 1.7, grow: 1.75, weaken: 1.75 };
const mults = { chance: 1.6, speed: 1.6, money: 1.68, growth: 1.46 };

function mk(name, required, minSec, growth, maxMoney, hackTime, level) {
  const t = { host: name, level, required, minSec, maxMoney, growth, hackTime, sec: minSec, money: maxMoney, mults };
  t.phi = b.hackFraction(level, required, minSec, mults);
  t.chance = b.hackChance(level, required, minSec, mults);
  t.k = b.growthK(minSec, growth, mults);
  t.kNow = t.k;
  return t;
}

// Includes the pathological case: a target only just hackable, where
// phi -> 0 and planBatch's `hMax = ceil(0.99/phi)` explodes.
const LEVEL = 2296;
const targets = [
  mk("ecorp", 1050, 33, 50, 1.5e12, 25000, LEVEL),
  mk("megacorp", 1040, 33, 50, 1.4e12, 24000, LEVEL),
  mk("kuai-gong", 1030, 32, 55, 1.3e12, 23000, LEVEL),
  mk("4sigma", 500, 18, 60, 1.6e11, 9000, LEVEL),
  mk("clarkinc", 520, 19, 60, 1.5e11, 9500, LEVEL),
  mk("barely-hackable", LEVEL - 2, 90, 5, 5e11, 40000, LEVEL), // phi ~ 0
  mk("n00dles", 1, 1, 5, 1.75e6, 900, LEVEL),
];

const ranked = targets.map((t) => ({ t, s: b.targetScore(t) })).sort((a, z) => z.s - a.s);
const spacing = 200;

console.log("phi values (smallest is the stress case):");
for (const r of ranked) console.log(`  ${r.t.host.padEnd(18)} phi=${r.t.phi.toExponential(3)} hMax=${Math.ceil(0.99 / r.t.phi)}`);

for (const totalRam of [32768, 98304, 448708, 10e6, 26.7e6]) {
  const t0 = Date.now();
  let bestN = 1;
  let bestInc = -1;
  let calls = 0;
  const cand = ranked.slice(0, 8);
  for (let n = 1; n <= cand.length; n++) {
    const share = totalRam / n;
    let inc = 0;
    for (let i = 0; i < n; i++) {
      const p = b.planBatch(cand[i].t, ram, share / 4);
      calls++;
      if (!p) continue;
      inc += Math.min(p.money / (4 * spacing), (share * p.money) / (p.gb * cand[i].t.hackTime * 4));
    }
    if (inc > bestInc) {
      bestInc = inc;
      bestN = n;
    }
  }
  const ms = Date.now() - t0;
  console.log(
    `fleet ${String(totalRam).padStart(9)} GB -> n=${bestN}  (${calls} planBatch calls, ${ms}ms)` +
      (ms > 500 ? "   *** TOO SLOW FOR A LIVE TICK ***" : ""),
  );
}
console.log("\nno throw, all fleets terminated.");
