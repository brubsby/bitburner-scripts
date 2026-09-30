// [SL] The work slot's levers on the final window.
//
// The hash audit (cca3ab9) found BN9's final window bound by the WORK SLOT
// (grafts + the Daedalus reputation leg), not money. Four levers were priced
// on the plan layer (tools/sim/slotlevers.mjs: the committed install's
// trajectory, the plan's posterior draws, common random numbers, the
// commitment rule) on the live 2026-09-30 00:00Z inputs:
//
//   1 bank Daedalus favor in an earlier life    +0.40h (a second install's life
//                                                 costs more than x2.5 saves): NOT taken
//   2 the final window joins Daedalus alone      -1.16h (k 8 -> 1): the join policy
//   3 sleeves on Daedalus / studying             -0.01h: nothing to take; the
//                                                 -0.81h the audit read was the
//                                                 player's exp mults double-dipping
//                                                 the sleeves' flat exp
//   4 graft the costliest in this life           -4.71h (the committed cheapest-8
//                                                 -> costliest-9): the schedule search
//   go the exit faction's favor from IPvGO      -1.77h: priced on the exit (it was
//                                                 happening unpriced)
//
//   SL1 THE GAME        favor: the curve, banked at install, x(1 + favor/100)
//                       on faction work (a sleeve's too), 150 x the node's
//                       multiplier to donate; Go: favor to a member's faction
//                       on every even win of a streak, getMaxRep()/200 each,
//                       100k a node, kept through installs; a sleeve's faction
//                       rep x shock (no sync); the player's exp mults do not
//                       apply to the sleeves' transfer
//   SL2 THE SIMULATOR   exitFavor scales the rep leg; favorLife lengthens the
//                       last earlier life and banks its favor; donate vs grind
//                       as whole trajectories; favorStream shortens the leg
//                       and caps; sleeveExp reaches the window; the flat exp
//                       escapes the player's multipliers exactly
//   SL3 THE SCHEDULE    on the 00:00Z inputs the costliest-first family with
//                       the integer refinement beats the committed schedule by
//                       > 2h (4.87h before the work-slot queue, 2.93h after); sameGraftSchedule tells lives apart
//   SL4 THE LEVERS      the commitment rule on the fixture's draws: 1 stays,
//                       2 switches to k=1, 3 stays, 4 switches, the Go stream
//                       prices shorter; the CHECK reproduces the plan's mean
//   SL5 WIRING          progress.js: a re-scheduled committed set is a
//                       challenger; the final window's joins and its k; the Go
//                       stream on the exit inputs; the sleeve objective's flat
//                       exp. go.js publishes favorRep. contractplan and favor
//                       helpers.
import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";
import { GAME } from "./build-ram.mjs";

const X = await import("../../exitplan.js");
const P = await import("../../plan.js");
const GP = await import("../../graftplan.js");
const CP = await import("../../contractplan.js");
const FV = await import("../../favor.js");

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-slot-0000.json"), "utf8"));
const game = (rel) => fs.readFileSync(path.join(GAME, rel), "utf8");
const repo = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const fin = (x) => typeof x === "number" && isFinite(x);

const I = F.exitinputs.inputs;
const at = Date.parse(F.exitinputs.at);
const basis = P.basisOf(F.plan.decisions.install, at);
const traj = P.trajectoryOf(basis);
const g = basis.gains;
const forced2 = (x) => X.bestExitPolicy({ ...x, firstInstallH: basis.waitH, installGains: g, nextInstallGain: g.hacking }, 400, 2).best?.hours ?? null;
const drawsOf = () => {
  const ps = F.plan.posteriors;
  const c = ps.cadence;
  const post = {
    drift: { s: ps.s, nu: ps.driftNu ?? 4, a: 2, b: 2 * ps.s * ps.s },
    gymSdLn: ps.gymSdLn ?? 0.1,
    cadence: c ? { rate: { mean: Math.log(c.lnPerHour), sd: c.rateSdLn }, life: { mean: Math.log(c.cycleHours), sd: c.lifeSdLn }, own: { weight: c.ownWeight } } : null,
    expPost: ps.exp ? { perSec: ps.exp.perSec, sd: ps.exp.sdLn } : null,
    income: ps.income ? { perSec: ps.income.perSec, mean: Math.log(ps.income.perSec), sd: ps.income.sdLn } : null,
    trader: ps.trader ? { perSec: { mean: ps.trader.mean, sd: ps.trader.sd }, lnWstar: { mean: Math.log(ps.trader.Wstar), sd: ps.trader.lnWstarSd }, rho: ps.trader.rho } : null,
  };
  return P.makeDraws(post, P.PLAN.N, P.seedOf(F.plan.lastAugReset, F.plan.node));
};
const decide = (draws, opts) => {
  const options = opts.map((o) => ({ key: o.key, noiseKey: P.noiseKeyOf(basis, o.inputs), sim: (d) => (o.f ?? traj)(P.applyDraw(o.inputs, d), d) }));
  return P.decideAmong({ options, prev: { key: opts[0].key }, draws, redecide: true, budgetMs: 1e9 });
};
const meanOf = (d, k) => d.options.find((o) => o.key === k)?.meanH;
const frm = I.repPerSec / ((I.hacking / 975) * 5);
const don = (2.5e6 * 1e6) / frm;
const goStream = () => {
  const s = FV.goFavorStreamOf({ gamesPerHour: F.go.gamesPerHour, pWin: F.go.wins / (F.go.wins + F.go.losses), sf14: F.go.sf14, banked: 0 });
  return { repPerH: s.repPerH, capRep: s.capRep };
};
const schedule = () => {
  const specs = [...(I.lifeGrafts ?? []), ...(I.finalGrafts ?? [])].map(({ life, ...s }) => s);
  const chosen = specs.map((s) => ({ name: s.name, prereqs: F.prereq[s.name] ?? [] }));
  const without = { ...I };
  delete without.lifeGrafts;
  delete without.finalGrafts;
  delete without.graftStartMoney;
  const finalOnly = { ...without, finalGrafts: specs, graftStartMoney: 0 };
  const gen = GP.scheduleGen({ chosen, specs, priceExit: (x) => traj(x), without, join: I.joinMoney, fraction: 0, finalH: traj(finalOnly) });
  let r = gen.next();
  while (!r.done) r = gen.next();
  const s = r.value;
  const life = new Map(s.lifeGrafts.map((x) => [x.name, x.life]));
  const pick = { ...without, lifeGrafts: specs.filter((x) => life.has(x.name)).map((x) => ({ ...x, life: life.get(x.name) })), finalGrafts: specs.filter((x) => !life.has(x.name)), graftStartMoney: s.startMoney ?? 0 };
  return { s, pick, finalOnly };
};

export async function run() {
  const out = [];

  {
    const c = new Check("SL1", "THE GAME: favor banked at install scales faction work (a sleeve's too) and opens donations at 150 x the node's multiplier; IPvGO wins give a member's faction favor; sleeve rep has no sync; the player's exp mults skip the sleeves' transfer");
    const need = [
      ["src/Faction/formulas/favor.ts", /return clampNumber\(25000 \* Math\.expm1\(log1point02 \* f\), 0\)/, "favorToRep = 25000 (1.02^f - 1)"],
      ["src/Faction/Faction.ts", /this\.setFavor\(addRepToFavor\(this\.favor, this\.playerReputation\)\)/, "prestigeAugmentation banks this life's reputation as favor"],
      ["src/PersonObjects/formulas/reputation.ts", /let favorMult = 1 \+ favor \/ 100;/, "faction work x(1 + favor/100)"],
      ["src/Faction/formulas/donation.ts", /Math\.floor\(CONSTANTS\.BaseFavorToDonate \* currentNodeMults\.FavorToDonateToFaction\)/, "donations at 150 x FavorToDonateToFaction"],
      ["src/BitNode/BitNodeMultipliers.ts", /FavorToDonateToFaction = 1;/, "FavorToDonateToFaction defaults to 1 (BitNode 9 does not set it)"],
      ["src/Go/boardAnalysis/scoring.ts", /statusToUpdate\.winStreak % 2 === 0 &&\s*Player\.factions\.includes\(factionName\) &&\s*statusToUpdate\.rep < getMaxRep\(\)/, "Go favor: every even win of a streak, members only, under the node's cap"],
      ["src/Go/boardAnalysis/scoring.ts", /const repToAdd = getMaxRep\(\) \/ 200;\s*const newFavor = addRepToFavor\(currentFavor, repToAdd\);/, "Go favor: getMaxRep()/200 rep-equivalent through the favor curve"],
      ["src/Go/effects/effect.ts", /return 100_000;/, "getMaxRep() 100k without Source-File 14"],
      ["src/Go/Go.ts", /Clear out stats except for reputation as favor from winstreaks on prestige/, "the Go favor total survives installs"],
      ["src/PersonObjects/Sleeve/Work/SleeveFactionWork.ts", /return calculateFactionRep\(sleeve, this\.factionWorkType, this\.getFaction\(\)\.favor\) \* sleeve\.shockBonus\(\);/, "a sleeve's faction rep: the favor, x shock, no sync"],
      ["src/PersonObjects/Sleeve/Work/Work.ts", /The receiving sleeves and the player do not apply their xp multipliers from augs/, "the sleeves' exp transfer skips the player's exp mults"],
      ["src/PersonObjects/Player/PlayerObjectGeneralMethods.ts", /this\.factions = \[\];/, "an install leaves no faction joined (the final window's k starts from 0)"],
    ];
    for (const [f, re, what] of need) if (!re.test(game(f))) c.fail(`${what}: not found in ${f}`);
    c.examined(need.length);
    c.note(`favorToRep(150) = ${Math.round(FV.favorToRep(150))}; Go alone reaches favor ${FV.repToFavor(100e3).toFixed(1)}`);
    out.push(c);
  }

  {
    const c = new Check("SL2", "THE SIMULATOR: exitFavor x(1 + f/100) on the rep leg; favorLife's life and favor; donate vs grind as whole trajectories; favorStream shortens and caps; sleeveExp reaches the window; the flat exp escapes the player's exp mults");
    // A hold-to-exit window on a ground leg: favor f divides the leg by (1 + f/100).
    const b = { money: 1e12, incomePerSec: 1e9, hacking: 3000, hackingExp: 1e12, hackingMult: 5, expPerSec: 1e7, repPerSec: 50, exitRep: 0, terminalRep: 2.5e6, exitLevel: 3000, joinMoney: 100e9, favorToDonate: 150 };
    const leg = (r) => r.legs.find((l) => l.leg === "exit reputation")?.hours;
    const l0 = leg(X.exitHours({ ...b, exitFavor: 0 }));
    const l80 = leg(X.exitHours({ ...b, exitFavor: 80 }));
    if (!(Math.abs(l0 / l80 - 1.8) < 1e-9)) c.fail(`favor 80 must divide the ground leg by 1.8: ${l0} / ${l80}`);
    // Donating is a trajectory beside grinding: at favor 200 a slow donation loses to the grind, a fast one wins, 'donate' forces it.
    const slow = X.exitHours({ ...b, exitFavor: 200, donationCost: 1e16 });
    const fast = X.exitHours({ ...b, exitFavor: 200, donationCost: 1e9 });
    const forcedD = X.exitHours({ ...b, exitFavor: 200, donationCost: 1e16, repRoute: "donate" });
    if (!/ground/.test(slow.legs.find((l) => l.leg === "exit reputation")?.detail ?? "")) c.fail("a $1e16 donation must lose to the grind at favor 200");
    if (!/donated/.test(fast.legs.find((l) => l.leg === "exit reputation")?.detail ?? "")) c.fail("a $1e9 donation must win at favor 200");
    if (!(forcedD.hours > slow.hours)) c.fail(`repRoute 'donate' must price the donation: ${forcedD.hours} vs ${slow.hours}`);
    // Favor 0 at a favor-0 threshold (BitNode 8) keeps donating, as before.
    const bn8 = X.exitHours({ ...b, favorToDonate: 0, exitFavor: 0, donationCost: 1e16 });
    if (!/donated/.test(bn8.legs.find((l) => l.leg === "exit reputation")?.detail ?? "")) c.fail("a favor-0 threshold with no favor must price as before (donated)");
    // The stream: shortens the leg, nothing with a spent cap, the cap's favor at most.
    const s0 = leg(X.exitHours({ ...b, exitFavor: 0 }));
    const s1 = leg(X.exitHours({ ...b, exitFavor: 0, favorStream: { repPerH: 4e4, capRep: 1e5 } }));
    const sNone = leg(X.exitHours({ ...b, exitFavor: 0, favorStream: { repPerH: 4e4, capRep: 0 } }));
    const sInf = leg(X.exitHours({ ...b, exitFavor: 0, favorStream: { repPerH: 1e12, capRep: 1e5 } }));
    const fCap = FV.repToFavor(1e5);
    if (!(s1 < s0)) c.fail(`the Go stream must shorten the leg: ${s1} vs ${s0}`);
    if (!(Math.abs(sNone - s0) < 1e-6)) c.fail(`a spent cap must change nothing: ${sNone} vs ${s0}`);
    if (!(Math.abs(sInf - s0 / (1 + fCap / 100)) / s0 < 0.01)) c.fail(`an instant stream must be the cap's favor (${fCap.toFixed(1)}): ${sInf} vs ${s0 / (1 + fCap / 100)}`);
    // favorLife on the fixture: a 'favor life' leg, favor = repToFavor(R) in the final window; absent under one install.
    const R = FV.favorToRep(150);
    const r2 = X.bestExitPolicy({ ...I, favorLife: { rep: R }, donationCost: don, firstInstallH: basis.waitH, installGains: g, nextInstallGain: g.hacking }, 400, 2).best;
    const fl = r2?.legs.find((l) => l.leg === "favor life");
    if (!fl || !/favor 150\.0/.test(fl.detail)) c.fail(`the forced route must bank favor 150 in its last earlier life: ${fl?.detail}`);
    const r1 = X.exitHours({ ...I, favorLife: { rep: R }, firstInstallH: basis.waitH, installGains: g }, 1);
    if (r1.legs?.some((l) => l.leg === "favor life")) c.fail("one install has no earlier life to bank favor in");
    // Its window's rep leg runs at x2.5: the fixture's ground leg against the same policy's without the favor life.
    const noFl = X.exitHours({ ...I, firstInstallH: basis.waitH, installGains: g }, 2);
    const withFl = X.exitHours({ ...I, favorLife: { rep: R }, firstInstallH: basis.waitH, installGains: g }, 2);
    if (!(leg(withFl) < leg(noFl) / 2)) c.fail(`150 favor must more than halve the final window's rep leg: ${leg(withFl)} vs ${leg(noFl)}`);
    // sleeveExp reaches the window: after an install a flat 60 exp/s shortens the rep leg (level-scaled), not only the climb.
    const w0 = X.exitHours({ ...I, firstInstallH: basis.waitH, installGains: g }, 1);
    const w1 = X.exitHours({ ...I, sleeveExp: { perSec: 60, delayH: 0 }, firstInstallH: basis.waitH, installGains: g }, 1);
    if (!(leg(w1) < leg(w0))) c.fail(`the sleeves' exp must reach the window's rep leg: ${leg(w1)} vs ${leg(w0)}`);
    // The flat exp escapes the player's exp mults EXACTLY: a batch's x2 exp on (R, F) is the unmultiplied (2(R - F) + F, F).
    const base = { ...I, expFlatPerSec: 40, firstInstallH: basis.waitH };
    const a = X.exitHours({ ...base, installGains: { ...g, exp: 2 } }, 1).hours;
    const bb = X.exitHours({ ...base, expPerSec: 2 * (I.expPerSec - 40) + 40, installGains: { ...g, exp: 1 } }, 1).hours;
    if (!(Math.abs(a - bb) < 1e-9)) c.fail(`a batch's exp must multiply the scripts' rate only: ${a} vs ${bb}`);
    c.examined(13);
    c.note(`ground leg ${l0.toFixed(2)}h at favor 0, ${l80.toFixed(2)}h at 80; the Go stream ${s0.toFixed(2)} -> ${s1.toFixed(2)}h; the fixture's rep leg ${leg(noFl).toFixed(2)} -> ${leg(withFl).toFixed(2)}h at 150 favor`);
    out.push(c);
  }

  {
    const c = new Check("SL3", "THE SCHEDULE on the 00:00Z inputs: costliest first with every size around the grid's best beats the committed cheapest-8 by hours; sameGraftSchedule tells lives apart");
    const { s, pick } = schedule();
    const hC = traj(I);
    const hS = traj(pick);
    if (s.summary.family !== "costliest first, current life") c.fail(`the dearest grafts belong in this life: picked ${s.summary.family}`);
    // 4.87h when this landed; 2.93h since the ground leg queues behind the
    // grafts on the work slot ([XM]: a graft now delays the grind).
    if (!(hS < hC - 2)) c.fail(`the search must beat the committed schedule by > 2h: ${hS} vs ${hC}`);
    const tried = s.summary.tried.filter((t) => t.family === s.summary.family).map((t) => t.c);
    if (!tried.some((k) => ![1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 15].includes(k))) c.fail(`the refinement must price sizes between the grid points: ${tried.join(",")}`);
    if (s.summary.truncated) c.fail("an unbudgeted search must not truncate");
    // The walk outward from the grid's best continues while it improves: on a
    // synthetic exit (c - 10)^2 over 20 grafts the grid's best is 8, the
    // optimum two sizes on.
    {
      const n = 20;
      const specs = Array.from({ length: n }, (_, i) => ({ name: `G${i}`, cost: 1e9 * (n - i), slotH: 1, hacking: 1.01, exp: 1, rep: 1 }));
      const chosen = specs.map((s) => ({ name: s.name, prereqs: [] }));
      const gen = GP.scheduleGen({ chosen, specs, priceExit: (x) => 100 + ((x.lifeGrafts?.length ?? 0) - 10) ** 2, without: {}, finalH: 1e9 });
      let r = gen.next();
      while (!r.done) r = gen.next();
      if (r.value.summary.early !== 10 || r.value.h !== 100) c.fail(`the walk must reach the optimum two sizes past the grid's best: ${r.value.summary.early} at ${r.value.h}`);
    }
    const a = [{ name: "A", life: 1 }, { name: "B" }];
    if (!GP.sameGraftSchedule(a, [{ name: "B" }, { name: "A", life: 1 }])) c.fail("the same names in the same lives are the same schedule");
    if (GP.sameGraftSchedule(a, [{ name: "A" }, { name: "B" }])) c.fail("a graft moved to the final window is another schedule");
    if (!GP.sameGraftSet(a, [{ name: "A" }, { name: "B" }])) c.fail("sameGraftSet still ignores lives");
    c.examined(7);
    c.note(`${s.summary.family} x${s.summary.early}: ${hS.toFixed(3)}h vs the committed ${hC.toFixed(3)}h; sizes priced ${tried.join(",")}`);
    out.push(c);
  }

  {
    const c = new Check("SL4", "THE LEVERS on the plan's draws: the CHECK reproduces the committed mean; the commitment rule keeps no favor life, takes k=1, keeps the sleeves, takes the searched schedule; the Go stream prices shorter");
    const draws = drawsOf();
    // The CHECK replays the plan on the accounting that priced it (before the
    // work-slot queue, prequeue.mjs); the levers are decided on today's model.
    const base = decide(draws, [{ key: "base", inputs: { ...I, slotQueue: false } }]);
    const m0 = meanOf(base, "base");
    const pm = F.plan.decisions.install.meanH;
    if (!(Math.abs(m0 / pm - 1) < 0.01)) c.fail(`CHECK: the replay's mean ${m0}h must be within 1% of the plan's ${pm}h`);
    const d1 = decide(draws, [{ key: "none", inputs: I }, { key: "favor150", inputs: { ...I, favorLife: { rep: FV.favorToRep(150) }, donationCost: don }, f: forced2 }]);
    if (d1.key !== "none") c.fail(`lever 1 must not switch: ${d1.why}`);
    const d2 = decide(draws, [{ key: "k8", inputs: I }, { key: "k1", inputs: { ...I, contractRep: { ...I.contractRep, factions: 1 } } }]);
    if (d2.key !== "k1") c.fail(`lever 2 must switch to Daedalus alone: ${d2.why}`);
    const by = F.sleeve.byObjective;
    const d3 = decide(draws, [{ key: "none", inputs: I }, { key: "rep", inputs: { ...I, sleeveRep: { perSec: by.rep, delayH: 0 } } }, { key: "study", inputs: { ...I, sleeveExp: { perSec: by.exp, delayH: 0 }, spendPerSec: 1600 * F.sleeve.sleeves } }]);
    if (d3.key !== "none") c.fail(`lever 3 must not switch: ${d3.why}`);
    for (const k of ["rep", "study"]) if (!(Math.abs(meanOf(d3, k) - meanOf(d3, "none")) < 0.1)) c.fail(`lever 3 ${k} must be within 0.1h: ${meanOf(d3, k)} vs ${meanOf(d3, "none")}`);
    const { pick } = schedule();
    const d4 = decide(draws, [{ key: "committed", inputs: I }, { key: "search", inputs: pick }]);
    if (d4.key !== "search") c.fail(`lever 4 must switch to the searched schedule: ${d4.why}`);
    const dg = decide(draws, [{ key: "none", inputs: I }, { key: "go", inputs: { ...I, favorStream: goStream() } }]);
    if (!(meanOf(dg, "go") < meanOf(dg, "none") - 1)) c.fail(`the Go stream must price > 1h shorter: ${meanOf(dg, "go")} vs ${meanOf(dg, "none")}`);
    c.examined(8);
    c.note(`means: base ${m0} (plan ${pm}); favor life 150 ${meanOf(d1, "favor150")}; k=1 ${meanOf(d2, "k1")}; sleeves rep ${meanOf(d3, "rep")} study ${meanOf(d3, "study")}; schedule ${meanOf(d4, "search")}; Go ${meanOf(dg, "go")}`);
    out.push(c);
  }

  {
    const c = new Check("SL5", "WIRING: a re-scheduled committed set is a challenger; the final window declines other hacking-work joins and prices k from them; the Go stream reaches the exit inputs; the sleeve objective's study exp is flat; go.js publishes favorRep");
    const p = repo("progress.js");
    const need = [
      [/if \(committedSet && !sameGraftSchedule\(committedSet\.specs, specs\)\)/, "the committed set's schedule is part of the set (sameGraftSchedule)"],
      [/finalWindowContractFactions\(player\.factions \?\? \[\], \{ finalWindowNow: fwNow/, "contractRepOf counts the final window's factions"],
      [/const wanted = invites\.filter\(\(f\) => !CITY_FACTIONS\.includes\(f\) && joinAllowed\(ns, info, f, todo\)\)/, "non-exclusive invitations pass the final window's join policy"],
      [/for \(const f of cityInvites\) \{\s*if \(!joinAllowed\(ns, info, f, todo\)\) continue/, "city invitations pass it"],
      [/cityInvites\.includes\(f\)\) continue\s*if \(!joinAllowed\(ns, info, f, todo\)\) continue/, "chosen city factions pass it"],
      [/!wantCompany && joinAllowed\(ns, info, scheduleTarget, todo\)\)/, "the schedule's target passes it"],
      [/\.\.\.goFavorStreamInputOf\(ns, info\),/, "exitInputsBaseOf carries the Go favor stream"],
      [/g\.opponent !== EXIT_FACTION[\s\S]{0,2400}goFavorStreamOf\(\{ gamesPerHour: g\.gamesThisProcess \/ hrs, pWin: wins \/ \(wins \+ losses\), sf14: g\.sf14 \?\? 0, banked: g\.favorRep\?\.\[EXIT_FACTION\] \?\? null \}\)/, "the stream only while go.js plays the exit faction (or carried at most 30 min through a switch, deferral DF7), from its measured games and wins"],
      [/expFlatPerSec: \(b\.expFlatPerSec \?\? 0\) \+ by\.exp/, "the sleeve objective's study exp is flat"],
    ];
    for (const [re, what] of need) if (!re.test(p)) c.fail(`progress.js: ${what}`);
    if (!/favorRep\[name\] = Math\.round\(st\.rep\)/.test(repo("go.js")) || !/bonuses,\s*favorRep,/.test(repo("go.js"))) c.fail("go.js must publish each opponent's Go favor (getStats rep) as favorRep");
    // contractplan's policy
    const on = { finalWindow: true, contractsOn: true };
    if (CP.finalWindowJoinOf("NiteSec", on).join !== false) c.fail("the final window declines NiteSec while contracts pay Daedalus");
    if (CP.finalWindowJoinOf("Daedalus", on).join !== true) c.fail("the exit faction is always joined");
    if (CP.finalWindowJoinOf("Slum Snakes", on).join !== true) c.fail("a faction with no hacking work takes no contract share");
    if (CP.finalWindowJoinOf("NiteSec", { finalWindow: false, contractsOn: true }).join !== true) c.fail("before the final window joins are as before");
    if (CP.finalWindowJoinOf("NiteSec", { finalWindow: true, contractsOn: false }).join !== true) c.fail("with no contracts on the exit a join costs nothing");
    if (CP.finalWindowContractFactions(["NiteSec", "CyberSec", "Slum Snakes"], { finalWindowNow: false }) !== 1) c.fail("a later final window counts Daedalus alone");
    if (CP.finalWindowContractFactions(["NiteSec", "CyberSec", "Slum Snakes"], { finalWindowNow: true }) !== 3) c.fail("a final window now counts those joined and Daedalus");
    // favor's Go stream
    const s = FV.goFavorStreamOf({ gamesPerHour: 100, pWin: 0.5, sf14: 0, banked: 25e3 });
    if (!(Math.abs(s.repPerH - 100 * (0.25 / 1.5) * 500) < 1e-9) || s.capRep !== 75e3) c.fail(`goFavorStreamOf: p^2/(1+p) steps of getMaxRep/200 each, the cap less the banked: ${JSON.stringify(s)}`);
    if (FV.goFavorStreamOf({ gamesPerHour: 100, pWin: 0.5, sf14: 3, banked: 0 }).capRep !== 400e3) c.fail("Source-File 14.3 raises the cap to 400k");
    if (FV.goFavorStreamOf({ gamesPerHour: 100, pWin: 0.5, sf14: 0, banked: null }).repPerH !== null) c.fail("an unread banked favor must refuse, not read as 0");
    c.examined(need.length + 11);
    out.push(c);
  }

  return out;
}
