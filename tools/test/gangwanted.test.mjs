// THE WANTED PENALTY INCIDENT (live BN9 2026-09-29 19:45Z).
//
// /tel/gang.txt: Slum Snakes, 11 members, respect 2.15, wanted 336, penalty
// 0.00636, respect and money per cycle 0, mode 'respect'. ash/bex/cid on
// Territory Warfare, the other 8 on Train Combat, every `why` reading
// "train: stat weight N below 4.22 x 144 on Terrorism". The healthcheck said
// "gang respect is not growing, nobody is training". The fixture is that
// gang.txt verbatim plus the members from the save two minutes later.
//
// The history, from .telemetry/history.jsonl (Slum Snakes reputation, which
// integrates gross respect) and the fixture's own `ascended` list:
//   18:12-18:45  reputation +~920/min: the gang was earning
//   18:45        eli/jax/kit ascend; reputation flat from here on — the
//                search had chosen k=4.22, valuing $23b of equipment the
//                spend then refused (compete.permitted 0), so every member
//                trained for a Terrorism threshold only the gear could reach
//   19:10        nine ascensions in one pass, each checked against the SAME
//                respect snapshot (871,679): ash/bex/cid each "respect
//                ~580,000 keeps every member", together ~872k of earned
//                respect -> gang respect 2, wanted still 336
//   after        nobody on a task that moves wanted, so it is frozen
//                (Gang.ts:157-166: no gain, no justice, no decay)
//
//   GV1  ascension: the guard sees every ascension before it in the pass,
//        and refuses one that would crash the wanted penalty
//   GV2  wanted is priced into the policy: on the fixture trainees clear
//        wanted before training, and the trajectory's penalty is back above
//        the floor inside a quarter hour where the live plan left it frozen
//   GV3  a policy priced on equipment the spend refuses is rejected: the
//        live k/w earn nothing without the gear; gang.js re-searches
//        without equipment and never adopts the refused decision
//   GV4  the warfare squad's `why` says warfare; warfare at power 46 /
//        territory 14% is priced by the search, which drops it (w = 0)
//   GV5  healthcheck: nobody-earning is recognised (8 training + 3 warfare
//        is not "nobody is training"), WANTED PENALTY BINDS fails on the
//        fixture and notes a recovery, contradictory `why` fails
import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const GP = await import("../../gangplan.js");
const FX = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-gangwanted-1945.json"), "utf8"));
const GANG_JS = fs.readFileSync(path.join(REPO_ROOT, "gang.js"), "utf8");
const HC = fs.readFileSync(path.join(REPO_ROOT, "tools/healthcheck.mjs"), "utf8");
const P = FX.tel.policy;
const base = { softcap: FX.softcap, mode: "respect", horizonH: 6.24, stepSec: 180, rivals: FX.rivals };
const sim = (o) => GP.simulateGang(FX.gang, FX.members, { ...base, ...o });
const at = (f, h) => f.samples.find((s) => s.h >= h - 1e-9) ?? f.samples.at(-1);
const pen = (s) => s.respect / (s.respect + s.wantedLevel);

export async function run() {
  const checks = [];

  const c1 = new Check("GV1", "ascension: each guard sees the ascensions before it in the pass, and an ascension that would crash the wanted penalty is refused");
  {
    // The 19:10 pass: respect 871,679, wanted 336, 11 members (5^8 = 390,625
    // keeps them), ash/bex/cid each ~290k earned, all at gain >= the floor.
    const g = { respect: 871679, wantedLevel: 336, isHacking: false };
    const res = (respect) => ({ respect, str: 1.5, def: 1.5, dex: 1.5, agi: 1.5 });
    const pass = [
      ["ash", res(291961)],
      ["bex", res(289859)],
      ["cid", res(289859)],
    ];
    c1.examined(pass.length);
    const stale = pass.filter(([, r]) => GP.shouldAscend({}, r, g, { members: 11, minGain: 1.4 }).ascend).length;
    if (stale !== 3) c1.fail(`against one snapshot all three must pass the per-member guard (that is the bug being pinned): ${stale}`);
    // As gang.js does it now: the respect after each ascension feeds the next.
    const live = { ...g };
    const passed = [];
    for (const [name, r] of pass) {
      const v = GP.shouldAscend({}, r, live, { members: 11, minGain: 1.4 });
      if (v.ascend) {
        passed.push(name);
        live.respect = Math.max(1, live.respect - r.respect);
      }
    }
    if (passed.length !== 1) c1.fail(`cumulatively only the first may ascend (871,679 - 291,961 = 579,718; the next leaves 289,859 < 390,625): ${passed.join(",")}`);
    if (!(live.respect > 5e5)) c1.fail(`respect after the pass must stay ~580k, not ${live.respect}`);
    if (!/ascendMember\(m\.name\)\)\s*\{[\s\S]{0,900}?gang\.respect = Math\.max\(1, gang\.respect - /.test(GANG_JS)) c1.fail("gang.js must lower gang.respect by each ascension's cost before the next shouldAscend");
    // The penalty guard, on its own (members guard satisfied): a small gang
    // whose one big earner would leave respect under wanted.
    c1.examined(1);
    const v = GP.shouldAscend({}, res(9000), { respect: 10000, wantedLevel: 500, isHacking: false }, { members: 3, minGain: 1.2 });
    if (v.ascend || !/wanted penalty/.test(v.why)) c1.fail(`respect 10,000 -> 1,000 against wanted 500 (penalty 0.95 -> 0.67) must be refused on the penalty: ${v.why}`);
    const ok = GP.shouldAscend({}, res(9000), { respect: 10000, wantedLevel: 5, isHacking: false }, { members: 3, minGain: 1.2 });
    if (!ok.ascend) c1.fail(`against wanted 5 the same ascension keeps penalty 0.995 and must pass: ${ok.why}`);
    c1.note(`19:10 pass: per-snapshot guard admits ${stale}/3, cumulative admits ${passed.length} (respect left ${Math.round(live.respect).toLocaleString()}); penalty guard: ${v.why}`);
  }
  checks.push(c1);

  const c2 = new Check("GV2", "wanted is priced into the policy: on the live fixture the trainees clear wanted first, and the trajectory's penalty recovers where the live plan left it frozen at 0.006");
  {
    c2.examined(FX.members.length);
    const g = FX.gang;
    if (!(Math.abs(GP.wantedPenalty(g) - 0.00636) < 1e-4)) c2.fail(`fixture penalty ${GP.wantedPenalty(g)} is not the live 0.00636`);
    const plan = GP.trainRatio(P.k, false, 0)(g, FX.members, { softcap: FX.softcap, mode: "respect" });
    const onJustice = Object.values(plan.assignments).filter((t) => t === "Vigilante Justice").length;
    if (onJustice !== FX.members.length) c2.fail(`at k=${P.k.toFixed(2)} every member is a trainee and wanted binds: all ${FX.members.length} must hold justice, got ${onJustice} (${JSON.stringify(plan.assignments)})`);
    if (!plan.wantedBinds) c2.fail("the plan must say the penalty binds");
    for (const [n, w] of Object.entries(plan.why)) if (!/^wanted: /.test(w)) c2.fail(`${n}'s why must name the wanted penalty: ${w}`);
    // The trajectory, with no equipment (what the live gang actually had) and
    // no warfare: wanted down to its floor inside a quarter hour.
    const f = sim({ assignFn: GP.trainRatio(P.k, false, 0), ascend: { minGain: P.x } });
    const floorAt = f.samples.find((s) => s.wantedLevel <= 1.01)?.h ?? null;
    if (!(floorAt !== null && floorAt <= 0.15)) c2.fail(`wanted must reach its floor of 1 within 0.15h, reached it at ${floorAt}`);
    const s15 = at(f, 0.25);
    if (!(pen(s15) >= GP.MIN_PENALTY)) c2.fail(`the penalty at 0.25h must be back above ${GP.MIN_PENALTY} (earners on Terrorism by then), is ${pen(s15).toFixed(3)}`);
    // Earning at k=1: the penalty is back above the floor inside 0.1h, and
    // the old sign rule (every earner to justice) is beaten by earning through.
    const k1 = sim({ assignFn: GP.trainRatio(1, false, 0), ascend: { minGain: P.x } });
    if (!(pen(at(k1, 0.1)) >= GP.MIN_PENALTY)) c2.fail(`k=1: penalty at 0.1h must be >= ${GP.MIN_PENALTY}, is ${pen(at(k1, 0.1)).toFixed(3)}`);
    if (!(at(k1, 1).gross > 1e6)) c2.fail(`k=1 must earn > 1e6 gross respect in the first hour, earned ${at(k1, 1).gross.toExponential(2)}`);
    // The projection itself: at respect 2 / wanted 336 earning straight
    // through beats parking the earners on justice.
    const earners = FX.members.filter((m) => GP.statWeight(GP.TASK.Terrorism, m) > 144).map((m) => ({ m, task: GP.TASK.Terrorism }));
    const jp = GP.justicePlan(g, earners, GP.TASK["Vigilante Justice"], FX.softcap, "respect");
    if (jp.n !== 0) c2.fail(`at respect 2 the projection must earn through (respect outgrows wanted), put ${jp.n} of ${earners.length} on justice`);
    c2.note(`k=${P.k.toFixed(2)}: ${onJustice}/${FX.members.length} on justice, wanted ${FX.gang.wantedLevel.toFixed(0)} -> 1 by ${floorAt}h, penalty ${pen(s15).toFixed(3)} at 0.25h (earning, wanted ${s15.wantedLevel.toFixed(0)}); k=1: penalty ${pen(at(k1, 0.1)).toFixed(3)} at 0.1h, gross ${at(k1, 1).gross.toExponential(2)} by 1h; ${earners.length} Terrorism-ready earners, projection puts ${jp.n} on justice`);
  }
  checks.push(c2);

  const c3 = new Check("GV3", "a policy priced on equipment the spend refuses is rejected: without the gear the live k/w earn nothing, and gang.js re-searches without equipment");
  {
    c3.examined(2);
    const war = { fraction: P.w, engageRatio: P.e };
    const withEq = sim({ assignFn: GP.trainRatio(P.k, false, 0), ascend: { minGain: P.x }, equipment: { budget: P.compete.cost, fraction: 1 }, warfare: war });
    const bare = sim({ assignFn: GP.trainRatio(P.k, false, 0), ascend: { minGain: P.x }, warfare: war });
    if (!(at(withEq, 1).gross > 1e6)) c3.fail(`with $${P.compete.cost.toExponential(2)} of equipment the live policy earns by 1h (that is why the search chose it): ${at(withEq, 1).gross}`);
    if (!(bare.samples.at(-1).gross === 0)) c3.fail(`without it the live policy must earn nothing in ${base.horizonH}h (the incident): ${bare.samples.at(-1).gross}`);
    if (!(P.compete.permitted === 0)) c3.fail("the fixture's spend must have been refused (compete.permitted 0)");
    // gang.js: the refusal is decided with the same function the purchase
    // uses, rejects the decision, and the next search leaves equipment out.
    c3.examined(1);
    if (!/const spendVerdict = \(cmp, claims\)/.test(GANG_JS)) c3.fail("gang.js must decide the spend in one spendVerdict for both the decision and the purchase");
    if (!/verdict\.permitted >= 0\.5 \* compete\.cost[\s\S]{0,700}?policy\.at = 0[\s\S]{0,200}?policy = candidate/.test(GANG_JS)) c3.fail("a refused spend must reject the decision (policy.at = 0 re-searches) and only an allowed one adopts the candidate");
    if (!/const budgetForSearch = equipRefused \? 0 : contested/.test(GANG_JS)) c3.fail("the search after a refusal must run without equipment");
    if (!/const sim = policy === candidate \? d\.forecast : undefined/.test(GANG_JS)) c3.fail("a rejected decision's forecast must not be published (progress.js prices unlocks off it)");
    c3.note(`live k=${P.k.toFixed(2)} w=${P.w.toFixed(3)}: with $${(P.compete.cost / 1e9).toFixed(1)}b gear ${at(withEq, 1).gross.toExponential(2)} by 1h; without ${bare.samples.at(-1).gross} in ${base.horizonH}h`);
  }
  checks.push(c3);

  const c4 = new Check("GV4", "warfare: the squad's why says warfare and never takes a member off justice; at power 46 / territory 14% the no-equipment search prices warfare at w = 0");
  {
    c4.examined(1);
    const bad = GP.whyContradictions(FX.tel);
    if (bad.length !== 3 || !["ash", "bex", "cid"].every((n) => bad.some((b) => b.startsWith(n)))) c4.fail(`the fixture has exactly ash/bex/cid contradicting their why: ${bad.join("; ")}`);
    const plan = GP.trainRatio(1, false, 0)(FX.gang, FX.members, { softcap: FX.softcap, mode: "respect" });
    const before = { ...plan.assignments };
    const squad = GP.warfareSquad(plan, FX.members, P.w, { power: FX.gang.power, territory: FX.gang.territory });
    for (const m of squad) {
      if (plan.assignments[m.name] !== "Territory Warfare" || !/^warfare: /.test(plan.why[m.name])) c4.fail(`${m.name}: task ${plan.assignments[m.name]}, why ${plan.why[m.name]}`);
      if (before[m.name] === "Vigilante Justice") c4.fail(`${m.name} was taken off justice for warfare`);
    }
    if (GP.whyContradictions({ assignments: plan.assignments, why: plan.why }).length) c4.fail("after warfareSquad no member may contradict its why");
    c4.examined(1);
    const d = GP.runSearch(FX.gang, FX.members, { softcap: FX.softcap, mode: "respect", horizonH: 2, stepSec: 180, objective: { unlocks: [], horizonH: 2 }, rivals: FX.rivals, equipment: null, incumbent: { k: 1, x: 1.25, y: 1, w: P.w, e: P.e, m: 0 }, rollout: false });
    if (!(d.w === 0)) c4.fail(`with untrained members at power 46 against 279, warfare must price out: w=${d.w}`);
    if (!(at(d.forecast, 1).gross > 1e6)) c4.fail(`the no-equipment search must earn in the first hour: ${at(d.forecast, 1).gross}`);
    c4.note(`squad of ${squad.length} at w=${P.w.toFixed(3)} re-labelled; no-equipment search: k=${d.k.toFixed(2)} x=${d.x.toFixed(2)} w=${d.w} -> ${at(d.forecast, 1).gross.toExponential(2)} gross by 1h, penalty ${pen(at(d.forecast, 0.25)).toFixed(3)} at 0.25h`);
  }
  checks.push(c4);

  const c5 = new Check("GV5", "healthcheck: nobody-earning is recognised, WANTED PENALTY BINDS fails on the fixture and notes a recovery, a contradictory why fails");
  {
    c5.examined(1);
    const act = GP.gangActivity(FX.tel.assignments);
    if (!(act.training === 8 && act.warfare === 3 && act.earning === 0)) c5.fail(`fixture activity: ${JSON.stringify(act)}`);
    const oldTraining = Object.values(FX.tel.assignments).every((t) => /^Train /.test(t));
    if (oldTraining) c5.fail("the old detection must be shown false on the fixture (that was the bug)");
    const w = GP.wantedBindsCheck(FX.tel, null);
    if (!w?.fail || !/^WANTED PENALTY BINDS/.test(w.what)) c5.fail(`the fixture must FAIL wanted-binds: ${JSON.stringify(w)}`);
    const flat = GP.wantedBindsCheck(FX.tel, FX.tel.wantedPenalty);
    if (!flat?.fail) c5.fail("a penalty that has not moved since the last sample is not a recovery");
    const rec = GP.wantedBindsCheck({ ...FX.tel, wantedPenalty: 0.5 }, 0.2);
    if (rec?.fail || !/recovering/.test(rec?.note ?? "")) c5.fail(`0.2 -> 0.5 is a recovery: ${JSON.stringify(rec)}`);
    const fine = GP.wantedBindsCheck({ ...FX.tel, wantedPenalty: 0.97 }, null);
    if (fine?.fail) c5.fail("0.97 must pass");
    if (GP.wantedBindsCheck({ ...FX.tel, wantedPenalty: undefined, respect: undefined }, null)?.fail !== true) c5.fail("an unreadable penalty must FAIL, not pass");
    c5.examined(1);
    if (!/const act = gangActivity\(tel\["gang\.txt"\]\?\.assignments\);/.test(HC) || !/act\.earning === 0/.test(HC)) c5.fail("healthcheck must decide 'not earning' with gangActivity");
    if (!/wantedBindsCheck\(tel\["gang\.txt"\], prev\?\.gangPenalty \?\? null\)/.test(HC)) c5.fail("healthcheck must run wantedBindsCheck against the previous sample's penalty");
    if (!/gangPenalty: tel\["gang\.txt"\]\?\.wantedPenalty/.test(HC)) c5.fail("healthcheck must keep the penalty in its sample");
    if (!/whyContradictions\(tel\["gang\.txt"\]\)/.test(HC)) c5.fail("healthcheck must fail a why that contradicts its task");
    c5.note(`fixture: ${JSON.stringify(act)}; ${w.what}`);
  }
  checks.push(c5);

  const c6 = new Check("GV6", "a recruit arriving inside a coarse tail step trains until the next re-plan (it used to throw and kill every search once respect crossed the next recruit threshold mid-step, live 2026-09-29 20:21-20:40)");
  {
    // The fixture's members earning, wanted at its floor, respect some way
    // under the 12th recruit (5^9 = 1,953,125): a short fine window, then a
    // tail whose 900s steps recruit on their 300s sub-steps. Several starting
    // points so the crossing lands mid-step in some of them.
    let recruited = 0;
    for (let r0 = 1.0e6; r0 <= 1.9e6; r0 += 1e5) {
      c6.examined(1);
      const g = { ...FX.gang, respect: r0, wantedLevel: 1 };
      try {
        const f = GP.simulateGang(g, FX.members, { ...base, horizonH: 0.05, tailH: 3, assignFn: GP.trainRatio(1, false, 0), ascend: { minGain: P.x } });
        if (f.samples.at(-1).members === 12) recruited++;
      } catch (e) {
        c6.fail(`respect ${r0}: simulateGang threw on a mid-tail recruit: ${String(e).slice(0, 120)}`);
      }
    }
    if (!recruited) c6.fail("no start recruited the 12th member inside 3h; the check exercises nothing");
    c6.note(`${recruited} starting points recruited the 12th member inside the tail without throwing`);
  }
  checks.push(c6);

  return checks;
}
