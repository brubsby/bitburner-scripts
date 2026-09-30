// THE GANG FARMED RESPECT WITH NOTHING LEFT TO BUY (live BN9 2026-09-30 15:56Z,
// fixture-bn9-gangrespect-1556.json: gang.txt, exitinputs, the gate's
// objective, factionplan's gang section, install-last's carry, the members
// out of the save).
//
// Slum Snakes: respect 1.1e9, territory 100%, 12 members, wanted penalty 1.000,
// mode 'respect', $0/s, every member on Terrorism. The gang faction's rep is
// 1.9e8 with every unlock taken (factionplan unlocks [], gainsByGangRep one
// row, gains null) and favor 426 — past 150 its reputation is bought with
// money anyway. The install at 15:20Z carried $171-204m/s; the new life's
// forecast carried $0 and the plan's exit jumped +5h.
//
//   GR1  the state: nothing to unlock, the batch cannot use money (eBudget 0)
//   GR2  ROOT CAUSE: the gang's money was priced only as lifts on the next
//        batches ((B+haul)/B)^eBudget — at eBudget 0 every dollar is 0, the
//        search tied, reputation broke the tie, respect won
//   GR3  the fix: the candidate's stream priced where the exit prices the
//        committed gang (carriedIncome.gang: later lives' and the final
//        window's money legs), replacing it — money beats respect
//   GR4  more money is never a later exit: the exit itself is monotone in the
//        stream (exitplan's work-slot queue, [XM]) and the value with it, with
//        no capped ladder; ties at the exit's resolution go to money
//   GR5  the search on the live members picks money, forecasting a stream on
//        the scale the install carried ($171m/s at 15:20Z)
//   GR6  a missing search falls back to the last ADOPTED policy (restored
//        across the install, same node), never a respect default
//   GR7  wiring: a refusal no longer zeroes policy.at; the forecast is the
//        policy in force from the first tick; gang.txt carries bitNode
//   GR8  the plan's carry of the new forecast (gangCarriedSchedule) matches
//        the install's carried stream, so the next install carries the same
import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const GP = await import("../../gangplan.js");
const GW = await import("../../gangworth.js");
const X = await import("../../exitplan.js");
const OB = await import("../../objective.js");
const { bitNodeMults } = await import("../../bitNodeMultipliers.js");
const FX = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-gangrespect-1556.json"), "utf8"));
const GANG_JS = fs.readFileSync(path.join(REPO_ROOT, "gang.js"), "utf8");

// The record as if fresh (exitLnOfInstallLifts refuses one older than 15 min).
const REC = { ...FX.exitinputs, at: new Date().toISOString() };
const OBJ = FX.gate.objective;
const GS = FX.gangSection;
const SOFTCAP = bitNodeMults(9).GangSoftcap;
const HPL = OBJ.exitSensitivity.hoursPerLn.hacking;
// gang.js's objective, built as it builds it from the same files.
function objectiveOf(rec = REC) {
  const horizonH = Math.min(12, Math.max(2, GS.remainingWindowH ?? 8));
  const o = { unlocks: GS.unlocks, repNow: GS.repNow, facRepMult: GS.facRepMult, favor: GS.favor, horizonH, remainingWindowH: GS.remainingWindowH, why: null };
  o.money = { eBudget: OBJ.eBudget, remainingWindows: OBJ.remainingWindows, budget: OBJ.probeMoney, windowH: OBJ.windowH, firstWindowH: GS.remainingWindowH, exit: { record: rec, hoursPerLn: HPL, bestExitPolicy: X.bestExitPolicy, lastAugReset: rec.lastAugReset } };
  o.tailH = Math.max(horizonH, Math.min(32, OBJ.remainingWindows * OBJ.windowH));
  return o;
}
const simOf = (k, x, m, o) => GP.simulateGang(FX.gang, FX.members, { softcap: SOFTCAP, mode: "respect", horizonH: o.horizonH, tailH: o.tailH, stepSec: 180, assignFn: GP.trainRatio(k, false, m), ascend: { minGain: x }, rivals: FX.rivals, warfare: { fraction: 0, engageRatio: 1.2 } });
// A flat-money forecast (cumulative money linear in h) for the envelope checks.
const flat = (perSec, H = 8) => ({ samples: Array.from({ length: 9 }, (_, i) => ({ h: (i * H) / 8, gross: 0, respect: 1, money: perSec * 3600 * ((i * H) / 8), members: 12, wantedLevel: 1 })), horizonH: H });

export async function run() {
  const checks = [];
  const o = objectiveOf();

  const c1 = new Check("GR1", "the live state: every gang-faction unlock taken, the batch cannot use money (eBudget 0), favor past 150");
  {
    c1.examined(4);
    if ((GS.unlocks ?? []).length !== 0) c1.fail(`factionplan's gang section should list no unlocks left: ${GS.unlocks.length}`);
    const rows = FX.exitinputs.gainsByGangRep?.rows ?? [];
    if (!(rows.length === 1 && rows[0].gains === null)) c1.fail("gainsByGangRep should be one row at the reputation now, gains null (nothing above it)");
    if (OBJ.eBudget !== 0) c1.fail(`the gate's eBudget should be 0 on these inputs: ${OBJ.eBudget}`);
    if (!(GS.favor >= 150)) c1.fail(`favor ${GS.favor}: past 150 the faction's reputation is bought with money`);
    c1.note(`respect ${FX.gang.respect.toExponential(2)}, rep ${GS.repNow.toExponential(2)}, favor ${GS.favor.toFixed(0)}, unlocks 0, eBudget ${OBJ.eBudget}; the gang earned $${FX.tel.rates.gameMoneyPerCycle}/cycle`);
  }
  checks.push(c1);

  const money = simOf(0, 3, 1, o);
  const respect = simOf(0, 3, 0, o);
  const c2 = new Check("GR2", "root cause: priced only as lifts on the next batches, $190m/s is worth exactly 0 at eBudget 0 — the tie went to reputation");
  {
    c2.examined(3);
    if (!money || !respect) c2.fail("the fixture's gang must simulate under both policies");
    else {
      const perS = money.samples.at(-1).money / (money.samples.at(-1).h * 3600);
      const liftsOnly = OB.exitLnOfInstallLifts(Array(400).fill(1), o.money.exit);
      if (!(liftsOnly === 0)) c2.fail(`lifts of 1 (eBudget 0) must price 0: ${liftsOnly}`);
      if (!(perS > 1e8)) c2.fail(`the money policy must earn on the scale the install carried: $${(perS / 1e6).toFixed(1)}m/s`);
      // The respect policy wins a zero-value tie on reputation (the old rule).
      const a = { value: 0, repAtHorizon: GP.gangRepAt(respect, o.horizonH, GS.repNow, GS), grossAtHorizon: 0 };
      const b = { value: 0, repAtHorizon: GP.gangRepAt(money, o.horizonH, GS.repNow, GS), grossAtHorizon: 0 };
      if (!GP.betterScore(a, b)) c2.fail("with money unpriced the tie goes to reputation (what ran live)");
      c2.note(`money policy $${(perS / 1e6).toFixed(0)}m/s over ${money.samples.at(-1).h.toFixed(1)}h; lifts-only value ${liftsOnly}; rep at horizon ${a.repAtHorizon.toExponential(2)} (respect) vs ${b.repAtHorizon.toExponential(2)} (money)`);
    }
  }
  checks.push(c2);

  const c3 = new Check("GR3", "the fix: the candidate's stream priced as carriedIncome.gang in the exit — the money policy beats the respect policy by hours");
  {
    c3.examined(3);
    const sm = GP.scoreTrajectory(money, o);
    const sr = GP.scoreTrajectory(respect, o);
    if (sm.moneyMode !== "exit") c3.fail(`the money policy must be exit-priced: ${sm.moneyMode} (${sm.moneyWhy})`);
    if (!(sm.value > sr.value + 1)) c3.fail(`money must beat respect by > 1 ln (${HPL.toFixed(2)}h): ${sm.value} vs ${sr.value}`);
    if (!GP.betterScore(sm, sr)) c3.fail("betterScore must prefer the money policy");
    // Directly: the exit with the stream vs none.
    const steps = GW.gangIncomeSchedule(money);
    const base = { ...REC.inputs, eRep: REC.eRep, eBudget: REC.eBudget };
    const { gang: _g, ...others } = base.carriedIncome;
    const h0 = X.bestExitPolicy({ ...base, carriedIncome: others }).best.hours;
    const h1 = X.bestExitPolicy({ ...base, carriedIncome: { ...others, gang: steps } }).best.hours;
    if (!(h0 - h1 > 2)) c3.fail(`the exit with the money gang must be hours sooner than with none: ${h1} vs ${h0}`);
    c3.note(`value money ${sm.value.toFixed(3)} ln vs respect ${sr.value.toFixed(3)} ln; exit ${h1.toFixed(2)}h with the stream vs ${h0.toFixed(2)}h without (${(h0 - h1).toFixed(2)}h)`);
  }
  checks.push(c3);

  const c4 = new Check("GR4", "more money is never a later exit: the raw exit and the priced value are monotone in the stream (no capped ladder), and exit-resolution ties go to money");
  {
    const rates = [1e7, 5e7, 2e8, 4e8];
    const vals = rates.map((r) => GP.scoreTrajectory(flat(r), o));
    c4.examined(rates.length);
    for (let i = 1; i < rates.length; i++) if (vals[i].value < vals[i - 1].value - 1e-9) c4.fail(`$${rates[i] / 1e6}m/s priced below $${rates[i - 1] / 1e6}m/s: ${vals[i].value} < ${vals[i - 1].value}`);
    // The exit itself (it was not: $10m/s 9.627h, $400m/s 9.698h at 0209b85,
    // the ground leg priced from the join's level while the slot grafted).
    const base = { ...REC.inputs, eRep: REC.eRep, eBudget: REC.eBudget };
    const hAt = (r) => X.bestExitPolicy({ ...base, carriedIncome: { ...base.carriedIncome, gang: [{ atH: 0, perSec: r }] } }).best.hours;
    const hs = rates.map(hAt);
    for (let i = 1; i < rates.length; i++) if (!(hs[i] <= hs[i - 1] + 1e-6)) c4.fail(`the raw exit rises with the stream: $${rates[i - 1] / 1e6}m/s ${hs[i - 1]}h -> $${rates[i] / 1e6}m/s ${hs[i]}h`);
    if ("moneyCapped" in vals[0]) c4.fail("the capped ladder is gone: no moneyCapped on a score");
    c4.note(`raw exit ${rates.map((r, i) => `$${r / 1e6}m/s ${hs[i].toFixed(3)}h`).join(", ")}; priced ${vals.map((v, i) => `$${rates[i] / 1e6}m/s ${v.value.toFixed(4)}`).join(", ")}`);
    c4.examined(rates.length);
    if (!(vals[3].tieLn > 0)) c4.fail("an exit-priced score carries its tie tolerance");
    if (!GP.betterScore(vals[3], vals[0])) c4.fail("$400m/s must win over $10m/s (equal exits: the money)");
    if (GP.betterScore({ ...vals[0], value: vals[3].value }, vals[3])) c4.fail("at equal value the smaller stream must lose");
    // Outside the money objective the old rule stands: reputation breaks the tie.
    if (!GP.betterScore({ value: 0.4, repAtHorizon: 2, moneyAtHorizon: 0 }, { value: 0.4, repAtHorizon: 1, moneyAtHorizon: 1e12 })) c4.fail("without tieLn, equal value is decided by reputation");
  }
  checks.push(c4);

  const c5 = new Check("GR5", "the search on the live members picks money: a stream on the scale the install carried");
  let chosen = null;
  {
    c5.examined(1);
    const t0 = Date.now();
    chosen = GP.runSearch(FX.gang, FX.members, { softcap: SOFTCAP, mode: "respect", horizonH: o.horizonH, tailH: o.tailH, stepSec: 180, objective: o, rivals: FX.rivals, equipment: null, incumbent: { k: 1, x: 1.25, y: 1, w: 0, e: 1.2, m: 0 }, rollout: false });
    const ms = Date.now() - t0;
    const carried = FX.installLast.carry.gang.steps[0].perSec;
    const perS = chosen?.forecast?.moneyPerSec;
    if (!chosen) c5.fail("the search must complete");
    else {
      if (!(chosen.m >= 0.5)) c5.fail(`the money split must be most of the gang: m=${chosen.m}`);
      if (!(chosen.score.moneyValue > 1)) c5.fail(`the chosen policy's money must be priced: ${chosen.score.moneyValue}`);
      const hourly = GW.gangIncomeSchedule(chosen.forecast);
      if (!(hourly && hourly[0].perSec > 0.5 * carried)) c5.fail(`the first hour must earn on the carried scale: $${((hourly?.[0]?.perSec ?? 0) / 1e6).toFixed(1)}m/s vs $${(carried / 1e6).toFixed(1)}m/s carried`);
      c5.note(`k=${chosen.k.toFixed(2)} x=${isFinite(chosen.x) ? chosen.x.toFixed(2) : "never"} m=${chosen.m.toFixed(2)} w=${chosen.w?.toFixed(2)}; value ${chosen.score.value.toFixed(3)} ln; forecast $${(perS / 1e6).toFixed(1)}m/s initial, first hour $${(hourly[0].perSec / 1e6).toFixed(1)}m/s, horizon $${(chosen.forecast.money / 1e12).toFixed(2)}t (install carried $${(carried / 1e6).toFixed(0)}m/s); ${chosen.sims} sims ${ms}ms`);
    }
  }
  checks.push(c5);

  const c6 = new Check("GR6", "no search yet: the last ADOPTED policy is restored (same node, across the install), never a respect default");
  {
    const live = FX.tel;
    c6.examined(5);
    const rp = GP.restoredPolicyOf({ ...live, bitNode: 9 }, 9);
    if (!rp || rp.k !== live.policy.k || rp.x !== live.policy.x || rp.m !== live.policy.m) c6.fail(`the live adopted policy must restore: ${JSON.stringify(rp)}`);
    if (GP.restoredPolicyOf(live, 9) !== null) c6.fail("a record without bitNode is not assumed this node's (gang.txt carried none before this)");
    if (GP.restoredPolicyOf({ ...live, bitNode: 2 }, 9) !== null) c6.fail("another node's gang is another gang");
    if (GP.restoredPolicyOf({ ...live, bitNode: 9, policy: { ...live.policy, at: null } }, 9) !== null) c6.fail("no adoption time: nothing adopted to restore");
    const nev = GP.restoredPolicyOf({ ...live, bitNode: 9, policy: { ...live.policy, x: null, ascendNever: true } }, 9);
    if (!(nev && nev.x === Infinity)) c6.fail("ascendNever restores as x = Infinity");
    // Restored from a money decision (GR5), the policy in force re-simulated
    // on the live gang earns money from the first tick.
    if (chosen) {
      c6.examined(1);
      const rec = GP.restoredPolicyOf({ bitNode: 9, policy: { k: chosen.k, x: isFinite(chosen.x) ? chosen.x : null, ascendNever: !isFinite(chosen.x), m: chosen.m, y: 0, w: chosen.w, e: chosen.e, at: new Date().toISOString() } }, 9);
      const sim = GP.simulateGang(FX.gang, FX.members, { softcap: SOFTCAP, mode: "respect", horizonH: o.horizonH, tailH: o.tailH, stepSec: 180, assignFn: GP.trainRatio(rec.k, false, rec.m), ascend: { minGain: rec.x }, rivals: FX.rivals, warfare: { fraction: rec.w, engageRatio: rec.e } });
      if (!(sim?.moneyPerSec > 1e8)) c6.fail(`the restored money policy must forecast money: $${sim?.moneyPerSec}`);
      else c6.note(`${rec.why.slice(0, 100)}…: $${(sim.moneyPerSec / 1e6).toFixed(0)}m/s`);
    }
  }
  checks.push(c6);

  const c7 = new Check("GR7", "gang.js wiring: refusal keeps policy.at, the forecast is the policy in force, bitNode published, the restore used");
  {
    c7.examined(6);
    if (/policy\.at\s*=\s*0/.test(GANG_JS)) c7.fail("a refusal must not zero policy.at (it published at: null over an adopted policy)");
    if (!/nextSearchAt\s*=\s*0/.test(GANG_JS)) c7.fail("a refusal must re-search at once through nextSearchAt");
    if (!/restoredPolicyOf\(last, info\.currentNode\)/.test(GANG_JS)) c7.fail("gang.js must restore the last adopted policy at start");
    if (!/if \(!forecast && objective\)/.test(GANG_JS) || !/forecastOf\(sim, q,/.test(GANG_JS)) c7.fail("with no search landed the forecast is the policy in force, simulated");
    if (!/bitNode: info\.currentNode/.test(GANG_JS)) c7.fail("gang.txt must carry bitNode (the restore checks it)");
    if (!/source: policy\.source/.test(GANG_JS)) c7.fail("the published policy names its source (search / restored / default)");
  }
  checks.push(c7);

  const c8 = new Check("GR8", "the plan carries the new forecast on the install's scale (gangCarriedSchedule), so the next install carries the same stream");
  {
    c8.examined(1);
    if (!chosen?.forecast) c8.fail("GR5's forecast is needed");
    else {
      const now = Date.now();
      const fc = { at: new Date(now).toISOString(), policy: "k=0 m=1", samples: chosen.forecast.samples.map((s) => ({ h: s.h, gross: s.gross, respect: s.respect, money: s.money, members: s.members, wantedLevel: s.wantedLevel })) };
      const carried = GW.gangCarriedSchedule({ forecast: fc }, null, null, now + 60e3);
      const inst = FX.installLast.carry.gang.steps;
      if (!carried) c8.fail("the plan must carry the forecast");
      else {
        const r = carried.steps[0].perSec / inst[0].perSec;
        if (!(r > 0.5 && r < 2)) c8.fail(`hour 0: $${(carried.steps[0].perSec / 1e6).toFixed(1)}m/s carried vs the install's $${(inst[0].perSec / 1e6).toFixed(1)}m/s`);
        c8.note(`carried ${carried.steps.slice(0, 4).map((s) => `$${(s.perSec / 1e6).toFixed(0)}m`).join(" ")}… vs the install's ${inst.slice(0, 4).map((s) => `$${(s.perSec / 1e6).toFixed(0)}m`).join(" ")}…`);
      }
    }
  }
  checks.push(c8);
  return checks;
}
