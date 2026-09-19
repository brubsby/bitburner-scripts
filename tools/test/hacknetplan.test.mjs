// [HN] hacknet as a claimant — hacknetplan.js against the game's own formulas.
//
// The failure this prevents: hacknet production and spending were outside the
// economy entirely (docs/pricing-gaps.md §4). What is pinned is fidelity to
// Hacknet/formulas/HacknetNodes.ts and the SHAPE of the decision: a purchase
// is bought only if it pays back inside the measured remaining life, and an
// unmeasured life refuses rather than buys.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import "./gameresolve.mjs";
import { GAME } from "./build-ram.mjs";

const hp = await import("../../hacknetplan.js");
const { HN, moneyRate, levelCost, ramCost, coreCost, nodeCost, bestUpgrade, verdict, remainingLife } = hp;

const MULTS1 = { hacknet_node_money: 1, hacknet_node_purchase_cost: 1, hacknet_node_level_cost: 1, hacknet_node_ram_cost: 1, hacknet_node_core_cost: 1 };

export async function run() {
  const checks = [];

  // ---------------------------------------------------------------------
  const c1 = new Check("HN1", "constants and cost/production formulas match Hacknet/data/Constants.ts and formulas/HacknetNodes.ts");
  {
    const src = fs.readFileSync(path.join(GAME, "src/Hacknet/data/Constants.ts"), "utf8");
    for (const [k, v] of Object.entries(HN)) {
      c1.examined(1);
      const m = src.match(new RegExp(`${k}:\\s*([\\d.e]+)`));
      if (!m) c1.fail(`${k} not found in Constants.ts`);
      else if (Number(m[1]) !== v) c1.fail(`${k}: HN ${v} vs source ${m[1]}`);
    }
    // Production: level*1.5 * 1.035^(ram-1) * (cores+5)/6 * mult * nodeMoney (HacknetNodes.ts:4-11).
    c1.examined(1);
    const want = 50 * 1.5 * Math.pow(1.035, 7) * ((4 + 5) / 6) * 2 * 0.2;
    if (Math.abs(moneyRate(50, 8, 4, 2, 0.2) - want) > 1e-9) c1.fail("moneyRate diverges from calculateMoneyGainRate");
    // Costs: hand-summed from the same formulas.
    c1.examined(1);
    if (Math.abs(levelCost(1, 3, 2) - 500 * (1 + 1.04 + 1.04 ** 2) * 2) > 1e-9) c1.fail("levelCost sum is wrong");
    if (levelCost(199, 2) !== Infinity) c1.fail("levels past MaxLevel are Infinity");
    if (Math.abs(ramCost(1, 2, 1) - (1 * 30e3 * 1 + 2 * 30e3 * 1.28)) > 1e-9) c1.fail("ramCost sum is wrong");
    if (ramCost(32, 2) !== Infinity) c1.fail("ram past MaxRam is Infinity");
    if (Math.abs(coreCost(1, 2, 3) - (500e3 * 1 + 500e3 * 1.48) * 3) > 1e-9) c1.fail("coreCost sum is wrong");
    if (coreCost(16, 1) !== Infinity) c1.fail("cores past MaxCores are Infinity");
    if (Math.abs(nodeCost(9, 0.5) - 1000 * 1.85 ** 8 * 0.5) > 1e-9) c1.fail("nodeCost is wrong");
    c1.note("12 constants matched; production and four cost curves hand-checked");
  }
  checks.push(c1);

  // ---------------------------------------------------------------------
  const c2 = new Check("HN2", "the best purchase is the shortest payback across nodes and a new node; refusals name why");
  {
    c2.examined(1);
    const nodes = [{ level: 1, ram: 1, cores: 1 }];
    const r = bestUpgrade(nodes, MULTS1, 1);
    if (!r.best) c2.fail(`must find a purchase: ${r.why}`);
    // From a bare node the first level ($500 for +1.5/s) beats everything else.
    if (r.best.kind !== "level") c2.fail(`first purchase on a bare node should be a level, got ${r.best.kind}`);
    if (Math.abs(r.best.paybackH - 500 / 1.5 / 3600) > 1e-12) c2.fail("payback must be cost / gain / 3600");
    if (r.considered !== 4) c2.fail(`one node offers level, ram, core and a new node = 4 candidates, got ${r.considered}`);

    c2.examined(1);
    const maxed = [{ level: 200, ram: 64, cores: 16 }];
    const m = bestUpgrade(maxed, MULTS1, 1, { maxNodes: 1 });
    if (m.best) c2.fail("a maxed node with no room for another must have nothing to buy");
    if (!m.why) c2.fail("a refusal must say why");

    c2.examined(1);
    if (bestUpgrade(nodes, { ...MULTS1, hacknet_node_money: undefined }, 1).best) c2.fail("an unreadable multiplier must refuse");
    if (bestUpgrade(nodes, MULTS1, undefined).best) c2.fail("an unreadable HacknetNodeMoney must refuse");
    if (bestUpgrade(nodes, MULTS1, 0).best) c2.fail("HacknetNodeMoney 0 must refuse — nothing earns");
    if (bestUpgrade("no", MULTS1, 1).best) c2.fail("an unreadable node list must refuse");

    // The live BitNode 5 shape: money x7.5, costs x0.26-0.34, HacknetNodeMoney 0.2.
    c2.examined(1);
    const live = { hacknet_node_money: 7.5087, hacknet_node_purchase_cost: 0.257, hacknet_node_level_cost: 0.2855, hacknet_node_ram_cost: 0.3359, hacknet_node_core_cost: 0.3359 };
    const eight = Array.from({ length: 8 }, () => ({ level: 13, ram: 1, cores: 1 }));
    const l = bestUpgrade(eight, live, 0.2);
    if (!l.best) c2.fail(`the live fleet must price: ${l.why}`);
    c2.note(`live BN5 fleet: best is ${l.best.kind}#${l.best.index} $${l.best.cost.toFixed(0)} for +$${l.best.gainPerSec.toFixed(2)}/s, payback ${(l.best.paybackH * 60).toFixed(1)} min`);
  }
  checks.push(c2);

  // ---------------------------------------------------------------------
  const c3 = new Check("HN3", "buy only when payback fits the remaining life; an unmeasured life refuses");
  {
    const best = { kind: "level", index: 0, cost: 500, gainPerSec: 1.5, paybackH: 500 / 1.5 / 3600 };
    c3.examined(1);
    if (!verdict(best, 1).buy) c3.fail("a 5.6-minute payback inside a 1h life must buy");
    if (verdict(best, 0.05).buy) c3.fail("a 5.6-minute payback with 3 minutes left must NOT buy");
    if (verdict(best, null).buy) c3.fail("an unmeasured remaining life must refuse");
    if (verdict(null, 1).buy) c3.fail("nothing to buy must not buy");
    if (verdict({ ...best, paybackH: Infinity }, 1e9).buy) c3.fail("a zero-gain purchase never pays back");
    for (const v of [verdict(best, 0.05), verdict(best, null), verdict(null, 1)]) if (!v.why) c3.fail("every refusal must say why");
    c3.note("five verdict shapes checked; the rule is paybackH < remainingH, nothing else");
  }
  checks.push(c3);

  // ---------------------------------------------------------------------
  const c4 = new Check("HN4", "remaining life is the larger of the ledger window and the gate's hold; install means 0; nothing readable refuses");
  {
    c4.examined(1);
    const H = 3600000;
    // The 2026-09-19 stall: window 0.56h, life 1h old, gate holding 0.1h.
    const stall = remainingLife({ ledger: { windowH: 0.56, lifeAgeH: 1, ageMs: 60000 }, gate: { install: false, waitMs: 0.1 * H, ageMs: 60000 } });
    if (!(stall.hours > 0.05 && stall.hours < 0.11)) c4.fail(`a holding gate must floor the horizon at its wait, got ${stall.hours}`);
    if (stall.source !== "gate") c4.fail("the gate's hold must be named as the binding witness when the ledger has expired");
    if (verdict({ kind: "level", index: 0, cost: 1, gainPerSec: 1, paybackH: 0.05 }, stall.hours).buy !== true) c4.fail("a 3-minute payback must buy inside a 5-minute hold");
    // The ledger wins when it is the longer witness.
    const led = remainingLife({ ledger: { windowH: 2, lifeAgeH: 0.5, ageMs: 0 }, gate: { install: false, waitMs: 0.1 * H, ageMs: 0 } });
    if (Math.abs(led.hours - 1.5) > 1e-9 || led.source !== "ledger") c4.fail(`ledger 1.5h must beat a 0.1h hold, got ${JSON.stringify(led)}`);
    // Install decided: nothing is left, whatever the ledger says.
    const inst = remainingLife({ ledger: { windowH: 2, lifeAgeH: 0, ageMs: 0 }, gate: { install: true, waitMs: 0.1 * H, ageMs: 0 } });
    if (inst.hours !== 0) c4.fail("a gate that says install must leave 0 hours");
    // One witness missing: the other stands alone.
    if (remainingLife({ ledger: null, gate: { install: false, waitMs: 0.2 * H, ageMs: 0 } }).hours !== 0.2) c4.fail("gate alone must stand");
    if (remainingLife({ ledger: { windowH: 1, lifeAgeH: 0.25, ageMs: 0 }, gate: null }).hours !== 0.75) c4.fail("ledger alone must stand");
    // Nothing readable: null, and verdict refuses on null.
    const none = remainingLife({ ledger: null, gate: null });
    if (none.hours !== null || !none.why) c4.fail("nothing readable must be null with a reason");
    if (remainingLife({}).hours !== null) c4.fail("no arguments must be null");
    // The wait already elapsed: the gate contributes 0, not a negative number.
    const late = remainingLife({ ledger: null, gate: { install: false, waitMs: 60000, ageMs: 120000 } });
    if (late.hours !== 0) c4.fail(`an elapsed hold is 0 hours, got ${late.hours}`);
    // The pass floor: a 3-minute hold read 4 minutes later on a 5-minute cadence still has 1 minute left.
    const floor = remainingLife({ ledger: null, gate: { install: false, waitMs: 3 * 60000, ageMs: 4 * 60000, passMs: 5 * 60000 } });
    if (Math.abs(floor.hours - 1 / 60) > 1e-9) c4.fail(`the pass interval must floor the hold, got ${floor.hours}h`);
    // hacknet.js's copy of the cadence must be watchdog.js's JOB_MIN_INTERVAL.
    const wd = fs.readFileSync(path.resolve("watchdog.js"), "utf8").match(/const JOB_MIN_INTERVAL = (\d+)/);
    const hk = fs.readFileSync(path.resolve("hacknet.js"), "utf8").match(/const PLANNER_PASS_MS = (\d+)/);
    if (!wd || !hk) c4.fail("JOB_MIN_INTERVAL (watchdog.js) and PLANNER_PASS_MS (hacknet.js) must both be literal constants");
    else if (wd[1] !== hk[1]) c4.fail(`hacknet.js PLANNER_PASS_MS ${hk[1]} != watchdog.js JOB_MIN_INTERVAL ${wd[1]}`);
    c4.note("nine shapes; the rule is max(ledger, max(gate-hold, pass interval)), install => 0, unreadable => null; PLANNER_PASS_MS == JOB_MIN_INTERVAL");
  }
  checks.push(c4);

  return checks;
}
