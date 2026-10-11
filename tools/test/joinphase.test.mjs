// [JP] THE JOIN HOARD IS TIME-PHASED ON THE EXIT SCHEDULE; HOME IS PRICED AS
// WHAT IT UNLOCKS.
//
// Live BN13.1 2026-10-11 (hacking route pinned, Stanek's Gift; ~15.5h into the
// node, home 128GB/1 core, 0 servers, cash ~$19m): /tel/buyserv.txt reserve
// 1e11, owned 0, fleetRam 0 — the Daedalus $100b join claim held from the
// node's start while the join needs hacking 2500 + 30 augs, many lives away
// (the exit simulator's best policy installs first; every install resets
// money). homeup's verdict path needed cash >= cost + $100b. And installgate
// spendExit.home read buy false, deltaH -0.07h on 3031 $/s — every new GB a
// batcher GB, while at 128GB home is where sleeve.js (49.75GB, not running),
// the gift's charger and progress.js's block wait for room.
//
//   JP1 THE LIVE SHAPE, RED/GREEN: on the 12:46Z exit inputs (hacking 95,
//       128GB, $38.7m) the schedule installs first -> the claim is 0 (old: the
//       full 1e11); budget leaves the servers the money (old: 0 spendable),
//       homeup's verdict rule affords the $100.68m block (old: needs $100.1b)
//   JP2 THE FINAL WINDOW: hold = need - stream x tJoin on the schedule's join
//       legs; a hoard-bound schedule holds (nearly) all; unread schedule,
//       legs or income -> the full requirement (fail closed)
//   JP3 THE SIMULACRUM, same shape: reputation-bound -> cost - moneyPerH x
//       repH; no moneyPerH -> the full price (bbplan publishes moneyPerH)
//   JP4 WIRING: both claim-carrying gate writes phase the claim on the pass's
//       exit schedule and publish joinPhase; buyserv's $2b floor is gone
//   JP5 HOME AS WHAT IT UNLOCKS, RED/GREEN on the live shape: sleeve.js
//       waiting + the fleet's measured transfer + the gift's charger on the
//       grown fleet -> the exit with the block beats the $/s-only pricing,
//       on the same without-arm (withH - withoutH, shared inputs)
//   JP6 THE MONEY-ONLY ARM: the unlock arm gives 49.75GB to sleeves, so its
//       money at W no longer repays the block; the block's money-only use is
//       money-dominant at W = 12h -> bought (progress wires the fallback)
//   JP7 readers: waiting residents from watchdog.txt (absent and
//       blocked/reserving, the raised GB from boot.txt), the fleet from THIS
//       node's sleeve.txt only
//   JP8 SERVERS on the live shape: with the join phased, the full fleet spend
//       is money-dominant (bought), ties go to the most money at W, and
//       buyserv's verdict reserve is max(join, money - spend)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Check } from "./harness.mjs";
import "./gameresolve.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
const FX = JSON.parse(fs.readFileSync(path.join(REPO, "tools/test/fixture-bn13-installloop-1246.json"), "utf8"));
const S = await import("../../splitctl.js");
const B = await import("../../budget.js");
const X = await import("../../exitplan.js");
const H = await import("../../homeplan.js");
const P = await import("../../plan.js");

const NEED = 1e11;
const inputs = FX.inputs;
const HOME = FX.home; // $100.68m 128 -> 256GB, W 12h, moneyAtW
// /tel/sleeve.txt 2026-10-11T15:25:18Z (BN13, 5 sleeves): byObjective.
const FLEET = { exp: 41.834707783649584, rep: 0.08515658686368939, at: "2026-10-11T15:25:18.774Z" };
const PER_GB = 3031 / 128; // the live verdict's gainPerSec over the 128GB block
const EXP_PER_GB = HOME.expGainPerSec / 128;
const moneyAt = (t) => inputs.money + ((HOME.moneyAtW - inputs.money) * t) / HOME.W;
const gainsAt = (m) => ({ hacking: m > 1e9 ? 1.0201 : 1.01, rep: 1, income: 1, exp: 1 });

export async function run() {
  const checks = [];
  const best = X.bestExitPolicy(inputs).best;

  const c1 = new Check("JP1", "live BN13.1 shape: the $100b join claim is 0 in a life the exit schedule installs out of; servers and home get the money");
  {
    c1.examined(6);
    if (!best) c1.fail("the live inputs must price an exit");
    else if (!(best.installsFirst > 0)) c1.fail(`the live schedule must install first (hacking 95 of 2500): installsFirst ${best.installsFirst}`);
    const old = S.routeJoinClaimOf(null, { node: 13, hackClaim: NEED });
    const neu = S.routeJoinClaimOf(null, { node: 13, hackClaim: NEED, exitBest: best, incomePerSec: inputs.incomePerSec });
    if (old.claim !== NEED) c1.fail(`RED: a caller passing no schedule keeps the full claim (got ${old.claim})`);
    if (neu.claim !== 0) c1.fail(`GREEN: the claim on the live schedule must be 0, got ${neu.claim}: ${neu.why}`);
    if (!/installs \d+ more time/.test(neu.why ?? "")) c1.fail(`the why must name the schedule: ${neu.why}`);
    const money = inputs.money;
    const sOld = B.spendable("servers", money, { join: old.claim, augmentations: 0, home: 0 });
    const sNew = B.spendable("servers", money, { join: neu.claim, augmentations: 0, home: 0 });
    if (sOld !== 0) c1.fail(`RED: the full join claim leaves the servers nothing, got ${sOld}`);
    if (!(sNew === money)) c1.fail(`GREEN: the phased claim leaves the servers the balance ($${money}), got ${sNew}`);
    // homeup's verdict rule (watchdog.js): cash >= next.cost + join.
    const cash = 101e6;
    if (cash >= HOME.cost + old.claim) c1.fail("RED: the old rule must refuse the block at $101m");
    if (!(cash >= HOME.cost + neu.claim)) c1.fail("GREEN: the phased rule must afford the $100.68m block at $101m");
    c1.note(`schedule ${best?.hours?.toFixed(1)}h, ${best?.installsFirst} installs first (final window +${best?.finalStartH?.toFixed(1)}h); claim ${old.claim} -> ${neu.claim}; servers spendable $${sOld} -> $${Math.round(sNew)}`);
  }
  checks.push(c1);

  const c2 = new Check("JP2", "the final window holds what the stream cannot bring by the schedule's join; anything unread holds the full requirement");
  {
    c2.examined(6);
    const leg = (leg, hours) => ({ leg, hours });
    const inc = 1e6; // $3.6b/h
    // Level-bound: hoard 5h then the climb 20h more -> join at +25h (after 1h of grafts).
    const lvl = { hours: 40, installsFirst: 0, legs: [leg("graft money", 1), leg("hoard join money", 5), leg("climb to join level", 20), leg("exit reputation", 14)] };
    const r = S.joinHoardPhaseOf(NEED, { best: lvl, incomePerSec: inc });
    const want = NEED - inc * 3600 * 26;
    if (!(Math.abs(r.claim - want) < 1)) c2.fail(`level-bound: hold need - stream x 26h = ${want}, got ${r.claim}`);
    if (r.phase?.kind !== "final-window") c2.fail(`phase kind ${r.phase?.kind}`);
    // Hoard-bound at a slower true stream: the linear script stream brings less -> holds more than the exact.
    const hoard = { hours: 30, installsFirst: 0, legs: [leg("hoard join money", 20), leg("exit reputation", 10)] };
    const h2 = S.joinHoardPhaseOf(NEED, { best: hoard, incomePerSec: 1e5 });
    if (!(h2.claim === NEED - 1e5 * 3600 * 20)) c2.fail(`hoard-bound hold ${h2.claim}`);
    if (S.joinHoardPhaseOf(NEED, { best: null, incomePerSec: inc }).claim !== NEED) c2.fail("an unpriced schedule must hold the full requirement");
    if (S.joinHoardPhaseOf(NEED, { best: { hours: 3, installsFirst: 0 }, incomePerSec: inc }).claim !== NEED) c2.fail("unread legs must hold the full requirement");
    if (S.joinHoardPhaseOf(NEED, { best: lvl, incomePerSec: null }).claim !== NEED) c2.fail("an unread income must hold the full requirement");
    if (S.joinHoardPhaseOf(NEED, { best: { ...lvl, legs: [leg("hoard join money", NaN)] }, incomePerSec: inc }).claim !== NEED) c2.fail("an unpriced leg must hold the full requirement");
    if (S.joinHoardPhaseOf(NEED, { best: { hours: 3, installsFirst: 0, legs: [leg("exit reputation", 3)] }, incomePerSec: inc }).claim !== NEED) c2.fail("a schedule with no join leg holds the full requirement");
    if (S.routeJoinClaimOf(null, { node: 13, hackClaim: null, exitBest: lvl, incomePerSec: inc }).claim !== null) c2.fail("an unreadable requirement stays unknown (null)");
    c2.note(`level-bound hold $${(r.claim / 1e9).toFixed(2)}b: ${r.why}`);
  }
  checks.push(c2);

  const c3 = new Check("JP3", "the Simulacrum's hold is phased on its verdict's own schedule");
  {
    c3.examined(3);
    const plan = (sim) => ({ node: 7, lastAugReset: 1, decisions: { install: { key: "w4" }, bladeRoute: { key: "blade", bladeH: 40, hackH: 100, simulacrum: sim } } });
    const r = S.routeJoinClaimOf(plan({ buy: true, cost: 450e9, moneyPerH: 20e9, repH: 10, moneyH: 22, why: "buy" }), { node: 7, hackClaim: NEED });
    if (r.claim !== 250e9) c3.fail(`reputation-bound at 10h on $20b/h: hold $250b, got ${r.claim}`);
    const r2 = S.routeJoinClaimOf(plan({ buy: true, cost: 450e9, moneyPerH: 60e9, repH: 10, why: "buy" }), { node: 7, hackClaim: NEED });
    if (r2.claim !== 0) c3.fail(`the stream covers it by the reputation: hold 0, got ${r2.claim}`);
    const r3 = S.routeJoinClaimOf(plan({ buy: true, cost: 450e9, repH: 10, why: "buy" }), { node: 7, hackClaim: NEED });
    if (r3.claim !== 450e9) c3.fail(`no moneyPerH: the full price, got ${r3.claim}`);
    if (!/moneyPerH: Number\.isFinite\(moneyPerH\)/.test(src("bbplan.js"))) c3.fail("bbplan.simulacrumVerdictGen must publish moneyPerH");
  }
  checks.push(c3);

  const c4 = new Check("JP4", "wiring: both gate writes phase the join claim on the pass's exit schedule; buyserv's $2b floor is gone");
  {
    c4.examined(5);
    const pr = src("progress.js");
    if (!/const gateJoin0 = gateJoinOf\(ns, info, candidates, player, channelWeights, exitSchedOf\(/.test(pr)) c4.fail("the unplanned gate write must phase on the exit schedule (exitSchedOf)");
    if (!/const gateJoin1 = gateJoinOf\(ns, info, candidates, player, channelWeights, exitSchedOf\(exitPolicyInputs, exitPolicy\?\.best \?\? null\)\)/.test(pr)) c4.fail("the planned gate write must phase on the pass's exitPolicy");
    if (!/exitBest: exitSched\.best \?\? null, incomePerSec: exitSched\.incomePerSec/.test(pr)) c4.fail("gateJoinOf must pass the schedule to routeJoinClaimOf");
    for (const k of ["0", "1"]) if (!new RegExp(`joinPhase: gateJoin${k}\\.joinPhase`).test(pr)) c4.fail(`gate write ${k} must publish joinPhase`);
    const bs = src("buyserv.js");
    if (!/floorReserve: 0,/.test(bs)) c4.fail("buyserv's standing $2b floor must be gone (the augmentation claim prices that window)");
  }
  checks.push(c4);

  const c5 = new Check("JP5", "home priced as what it unlocks: the waiting fleet and the gift's charger make the with-arm shorter than $/s alone, on the same without-arm");
  let arm = null;
  {
    c5.examined(4);
    const old = X.spendExit({ inputs, cost: HOME.cost, gainPerSec: PER_GB * 128, W: HOME.W, moneyAt, gainsAt, persists: true, expGainPerSec: EXP_PER_GB * 128 });
    arm = H.hackHomeArmOf({ inputs, addGB: 128, waiting: [{ script: "sleeve.js", gb: 49.75 }], fleet: FLEET });
    const neu = X.spendExit({ inputs, cost: HOME.cost, gainPerSec: PER_GB * arm.moneyGB, W: HOME.W, moneyAt, gainsAt, persists: true, expGainPerSec: EXP_PER_GB * arm.moneyGB, withInputs: arm.inputs });
    if (!(typeof old.deltaH === "number" && typeof neu.deltaH === "number")) c5.fail(`both arms must price: ${old.why} / ${neu.why}`);
    else {
      if (Math.abs(old.withoutH - neu.withoutH) > 1e-9) c5.fail(`the without-arm must be the same trajectory: ${old.withoutH} vs ${neu.withoutH}`);
      if (!(neu.deltaH < old.deltaH - 0.1)) c5.fail(`the unlocks must shorten the with-arm beyond $/s alone: ${neu.deltaH} vs ${old.deltaH}`);
    }
    if (!arm.unlocked.includes("sleeve.js") || !arm.credited.some((x) => /sleeve\.js/.test(x)) || !arm.credited.some((x) => /charger/.test(x))) c5.fail(`credited: ${JSON.stringify(arm.credited)} / ${JSON.stringify(arm.notSimulated)}`);
    // Unmeasured fleet: named, never folded in.
    const blind = H.hackHomeArmOf({ inputs, addGB: 128, waiting: [{ script: "sleeve.js", gb: 49.75 }], fleet: null });
    if (!blind.notSimulated.some((x) => /sleeve\.js/.test(x)) || blind.credited.some((x) => /sleeve/.test(x))) c5.fail("an unmeasured fleet must be named not simulated, not credited");
    c5.note(`$/s only: deltaH ${old.deltaH?.toFixed(3)}h; unlocks (${arm.why}): deltaH ${neu.deltaH?.toFixed(3)}h (withoutH ${neu.withoutH?.toFixed(2)}h)`);
  }
  checks.push(c5);

  const c6 = new Check("JP6", "the block's money-only use is money-dominant at W = 12h, so it is bought though the unlock arm hands sleeves its RAM");
  {
    c6.examined(3);
    const mo = X.spendExit({ inputs, cost: HOME.cost, gainPerSec: PER_GB * 128, W: HOME.W, moneyAt, gainsAt, persists: true, expGainPerSec: EXP_PER_GB * 128 });
    const dom = (r, g) => (r.moneyAtW && r.moneyAtW.m1 > r.moneyAtW.m0 ? { paybackH: HOME.cost / g / 3600, W: HOME.W } : null);
    const dMo = P.decideSpend({ deltaH: mo.deltaH, withoutH: mo.withoutH, dominant: dom(mo, PER_GB * 128) });
    if (!dMo?.buy || !dMo.dominant) c6.fail(`the money-only arm must be money-dominant and bought: ${JSON.stringify(dMo)} ${JSON.stringify(mo.moneyAtW)}`);
    const pr = src("progress.js");
    if (!/const mo = verdict\(next\.cost, perGB \* homeRam, true/.test(pr) || !/bought on the block's money-only use/.test(pr)) c6.fail("progress.js must fall back to the block's money-only arm");
    if (!/withInputs \? \{ withInputs \} : \{\}/.test(pr) || !/hackHomeArmOf\(\{ inputs, addGB: next\.kind === 'RAM' \? homeRam : 0/.test(pr)) c6.fail("the home verdict must price the unlock arm (hackHomeArmOf -> spendExit withInputs)");
    c6.note(`money-only arm: ${dMo?.why}`);
  }
  checks.push(c6);

  const c7 = new Check("JP7", "readers: waiting residents from the watchdog, the fleet from this node's sleeve.txt");
  {
    c7.examined(4);
    const wd = {
      daemons: {
        "sleeve.js": { absentSince: "2026-10-11T05:00:00Z", placement: { action: "blocked", why: "no host holds 49.75GB" } },
        "go.js": { placement: { action: "running" } },
        "bladeburner.js": { absentSince: "x", placement: { action: "reserve", why: "reserving" } },
        "stock.js": { absentSince: "x", placement: { action: "place" } },
      },
    };
    const boot = { admit: [{ script: "sleeve.js", cost: 3.25, raisesTo: 49.75 }, { script: "bladeburner.js", cost: 3.25, raisesTo: 92.75 }, { script: "stock.js", cost: 28.6 }] };
    const w = H.waitingResidentsOf(wd, boot);
    if (JSON.stringify(w.map((x) => [x.script, x.gb])) !== JSON.stringify([["sleeve.js", 49.75], ["bladeburner.js", 92.75]])) c7.fail(`waiting: ${JSON.stringify(w)}`);
    if (H.waitingResidentsOf(null, boot).length !== 0) c7.fail("no watchdog record: nothing waits");
    if (H.fleetForUnlockOf({ bitNode: 12, byObjective: { exp: 5 } }, 13) !== null) c7.fail("another node's sleeve.txt is not this fleet");
    const f = H.fleetForUnlockOf({ bitNode: 13, at: "t", byObjective: { exp: 41.8, rep: 0.085 } }, 13);
    if (!(f?.exp === 41.8 && f?.rep === 0.085)) c7.fail(`this node's fleet: ${JSON.stringify(f)}`);
    // The block holds sleeve.js but not bladeburner.js too (128 < 49.75 + 92.75).
    const a = H.hackHomeArmOf({ inputs, addGB: 128, waiting: w, fleet: f });
    if (JSON.stringify(a.unlocked) !== JSON.stringify(["sleeve.js"])) c7.fail(`a 128GB block admits sleeve.js only: ${a.unlocked}`);
  }
  checks.push(c7);

  const c8 = new Check("JP8", "servers on the live shape: the fleet spend is money-dominant and bought; the most money at W wins a tie; buyserv spends it");
  {
    c8.examined(4);
    const perGBfleet = 140800; // buyserv.txt fleetDollarPerGB at 256GB, BN13
    const x = inputs.money;
    const r = X.spendExit({ inputs, cost: x, gainPerSec: (x / perGBfleet) * PER_GB, W: HOME.W, moneyAt, gainsAt, persists: false });
    const d = P.decideSpend({ deltaH: r.deltaH, withoutH: r.withoutH, dominant: r.moneyAtW?.m1 > r.moneyAtW?.m0 ? { paybackH: x / ((x / perGBfleet) * PER_GB) / 3600, W: HOME.W } : null });
    if (!d?.buy) c8.fail(`the full fleet spend must be bought on the live shape: ${JSON.stringify(d)} ${JSON.stringify(r.moneyAtW)}`);
    const pr = src("progress.js");
    if (!/tie && \(v\.moneyAtW \?\? -Infinity\) > \(best\.moneyAtW \?\? -Infinity\)/.test(pr)) c8.fail("the fleet fraction's tie must go to the most money at W");
    const bs = src("buyserv.js");
    if (!/return Math\.max\(join, money - spend, SETTINGS\.floorReserve\)/.test(bs)) c8.fail("buyserv's verdict reserve must be max(join, money - spend, floor 0)");
    c8.note(`fleet spend $${(x / 1e6).toFixed(1)}m: ${d?.why}`);
  }
  checks.push(c8);

  return checks;
}
