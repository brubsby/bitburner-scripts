// [CP] when to install a count batch — countplan.js.
//
// The failure this exists to prevent is a policy that installs at the wrong
// batch size. installgate's COUNT_MIN_BATCH = 3 installed at three in a mature
// life, where money flows fast enough that adding tickets up to the point the
// 1.9^n escalation outruns income is far cheaper than paying another fresh
// ramp. And the first attempt to price it — a renewal rule — concluded
// "install after every single ticket" because it re-used the cheapest ticket
// forever, when each is consumed.
//
// So what is pinned: optimal batch cost, a depleting-pool DP, a curve that
// REFUSES until measured, and the mature-life decision that the floor got wrong.

import { Check } from "./harness.mjs";
const cp = await import("../../countplan.js");

/** A completed life shaped like the measured ramp: near-zero, then ~$12m/s. */
function life(scale, node = 10, complete = true) {
  const samples = [];
  let e = 0;
  let a = 0;
  for (let i = 0; i < 200; i++) {
    const dt = 0.05;
    a += dt;
    e += (5e3 + 12e6 * scale * (1 - Math.exp(-a / 1.5))) * dt * 3600;
    samples.push([a, e]);
  }
  return { node, complete, samples };
}
const LEDGER = { lives: { a: life(1.0), b: life(0.9), c: life(1.1) } };
const PRICES = [40, 55, 80, 120, 150, 200, 285, 400, 550, 800, 1200].map((c) => c * 1e6);

export async function run() {
  const checks = [];

  // ---------------------------------------------------------------------
  const c1 = new Check("CP1", "a batch is priced in the cheapest order, and money inverts to hours");
  {
    c1.examined(4);
    // Most expensive first: 10 at x1, then 1 at x1.9 = 11.9 — not 1 + 19 = 20.
    const two = cp.batchCost([1, 10], 1.9);
    if (Math.abs(two - 11.9) > 1e-9) c1.fail(`batchCost([1,10], 1.9) must be 10 + 1.9 = 11.9 (expensive first), got ${two}`);
    if (cp.batchCost([5], 1.9) !== 5) c1.fail("a single ticket costs its price");
    if (cp.batchCost([1, -1], 1.9) !== null || cp.batchCost(null, 1.9) !== null) c1.fail("unreadable prices must refuse");
    // hoursToAfford inverts a linear curve exactly.
    const lin = (h) => h * 1e6;
    if (Math.abs(cp.hoursToAfford(3e6, lin) - 3) > 1e-4) c1.fail("hoursToAfford must invert moneyBy");
    if (cp.hoursToAfford(0, lin) !== 0) c1.fail("nothing needed is zero hours");
    if (cp.hoursToAfford(1e20, lin, 10) !== Infinity) c1.fail("never reaching it is Infinity, not a number");
    c1.note("expensive-first: [1,10] costs 11.9 not 20; money inverts to hours by bisection");
  }
  checks.push(c1);

  // ---------------------------------------------------------------------
  const c2 = new Check("CP2", "the fresh-life curve is MEASURED or refused — never guessed");
  {
    c2.examined(6);
    // THE REASON: a 100x-optimistic guessed ramp made one-ticket installs look
    // optimal. Too few lives must refuse, and say how many it has.
    const two = cp.freshCurve({ lives: { a: life(1), b: life(1) } }, 10);
    if (two.moneyBy !== null) c2.fail(`${cp.MIN_LIVES} lives are required; two must refuse`);
    if (!/2 completed/.test(two.why)) c2.fail("the refusal must say how many lives it has");
    // Only COMPLETED lives in THIS node count.
    const mixed = cp.freshCurve({ lives: { a: life(1), b: life(1), c: life(1, 10, false), d: life(1, 4) } }, 10);
    if (mixed.moneyBy !== null) c2.fail("an in-progress life and another node's life must not count toward the minimum");
    const ok = cp.freshCurve(LEDGER, 10);
    if (typeof ok.moneyBy !== "function") c2.fail(`three completed lives must produce a curve: ${ok.why}`);
    else {
      // Monotone, zero at zero.
      if (ok.moneyBy(0) !== 0) c2.fail("earned by age 0 is 0");
      let prev = -1;
      for (const h of [0.1, 0.5, 1, 2, 5, 12]) {
        const v = ok.moneyBy(h);
        if (!(v >= prev)) c2.fail(`the curve must be monotone: ${h}h gave ${v} after ${prev}`);
        prev = v;
      }
      // MEDIAN, so one windfall life cannot bend the policy.
      const skew = cp.freshCurve({ lives: { a: life(1), b: life(1), c: life(50) } }, 10);
      if (!(Math.abs(skew.moneyBy(2) - ok.moneyBy(2)) / ok.moneyBy(2) < 0.2)) {
        c2.fail("one life earning 50x must not move a median of three much");
      }
    }
    c2.note(`${cp.MIN_LIVES} completed same-node lives required; median across them; ${ok.why}`);
  }
  checks.push(c2);

  // ---------------------------------------------------------------------
  const c3 = new Check("CP3", "the remaining count is PARTITIONED over a depleting pool");
  {
    c3.examined(3);
    const curve = cp.freshCurve(LEDGER, 10);
    const plan = cp.planBatches({ pool: PRICES, r: 1.9, remaining: 11, freshMoneyBy: curve.moneyBy, freshStart: 1262 });
    const sum = plan.batches.reduce((a, b) => a + b, 0);
    if (sum !== 11) c3.fail(`the partition must bank exactly the remaining 11, got ${JSON.stringify(plan.batches)} = ${sum}`);
    if (plan.DP[plan.DP.length - 1] !== 0) c3.fail("DP at the end is zero hours");
    // DEPLETION: the renewal rule re-used the cheapest ticket forever and chose
    // eleven single-ticket installs. With the pool consumed, the partition
    // must NOT be all ones.
    if (plan.batches.every((b) => b === 1)) c3.fail("eleven one-ticket installs is the renewal-rule pathology — the pool depletes");
    // Remaining caps it.
    const three = cp.planBatches({ pool: PRICES, r: 1.9, remaining: 3, freshMoneyBy: curve.moneyBy });
    if (three.batches.reduce((a, b) => a + b, 0) !== 3) c3.fail("only the remaining count is partitioned");
    c3.note(`11 remaining from fresh lives -> batches ${JSON.stringify(plan.batches)} in ${plan.hours.toFixed(2)}h`);
  }
  checks.push(c3);

  // ---------------------------------------------------------------------
  const c4 = new Check("CP4", "in a MATURE life it fills the batch the floor would have cut at three");
  {
    c4.examined(5);
    const curve = cp.freshCurve(LEDGER, 10);
    const at = (k, ageH = 3) =>
      cp.countTiming({ prices: PRICES, r: 1.9, kNow: k, remaining: 11, moneyNow: cp.batchCost(PRICES.slice(0, k), 1.9), ageH, curve, freshStart: 1262 });
    // THE FLOOR'S MISTAKE. At three tickets, deep in a life earning fast, a
    // bigger batch is faster — COUNT_MIN_BATCH = 3 installed right here.
    const three = at(3);
    if (three.installNow !== false) c4.fail(`at 3 tickets in a mature life a bigger batch is faster — the floor installed here: ${three.why}`);
    if (!(three.bestK > 3)) c4.fail("and it must name the larger batch it is waiting for");
    // But it does STOP: somewhere the escalation outruns income.
    const stops = [1, 3, 5, 7, 9].map((k) => at(k).installNow);
    if (!stops.includes(true)) c4.fail("the escalation must eventually outrun income — a rule that never installs is the stall");
    // Finishing the gate always installs.
    const fin = cp.countTiming({ prices: PRICES, r: 1.9, kNow: 4, remaining: 4, moneyNow: 1e12, ageH: 3, curve });
    if (fin.installNow !== true) c4.fail("the batch that finishes the gate installs");
    // No curve: REFUSE (null), never an answer.
    const blind = cp.countTiming({ prices: PRICES, r: 1.9, kNow: 3, remaining: 11, moneyNow: 1e9, ageH: 3, curve: { moneyBy: null, why: "unmeasured" } });
    if (blind.installNow !== null) c4.fail("without a measured curve the timing must be NULL so the caller falls back and says so");
    // THE REASON, not only the null. hoursToAfford's own check would refuse
    // downstream anyway, so the guard is shadowed on the OUTCOME — but then the
    // refusal reads "could not be partitioned", which misnames an unmeasured
    // curve as a failure of the math. The reader would go looking for a bug in
    // the DP when the answer is "record more lives".
    if (!/unmeasured/.test(blind.why ?? "")) {
      c4.fail(`an unmeasured curve must be refused AS unmeasured, carrying the curve's own reason: "${blind.why}"`);
    }
    c4.note(`mature life (3h): k=3 -> ${three.installNow ? "install" : "wait for " + three.bestK}; installs by k=${[1, 3, 5, 7, 9].find((k) => at(k).installNow)}`);
  }
  checks.push(c4);

  return checks;
}
