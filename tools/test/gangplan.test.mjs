// [GP] the gang model — gangplan.js against Gang/formulas, tasks.ts and upgrades.ts.
//
// Pinned: the transcribed tables against source, the gain formulas by hand,
// the recruit threshold inversion, and the shape of the three decisions
// (assign, ascend, equip) including their refusals.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import "./gameresolve.mjs";
import { GAME } from "./build-ram.mjs";

const gp = await import("../../gangplan.js");
const { TASKS, TASK, UPGRADES, respectGain, moneyGain, wantedGain, expGain, ascMult, skillOf, respectForMembers, recruitsAllowed, discount, assign, shouldAscend, bestEquipment, gangAllowed, KARMA_FOR_GANG } = gp;

function tasksFromSource() {
  const src = fs.readFileSync(path.join(GAME, "src/Gang/data/tasks.ts"), "utf8");
  const enums = fs.readFileSync(path.join(GAME, "src/Gang/Enums.ts"), "utf8");
  const names = Object.fromEntries([...enums.matchAll(/^\s*(\w+): "([^"]+)"/gm)].map((m) => [m[1], m[2]]));
  const out = {};
  // One entry per two-space-indented object literal in the metadata array.
  for (const block of src.split(/\n  \{\n/).slice(1)) {
    const nm = block.match(/name: GangTaskNameEnum\.(\w+)/);
    if (!nm) continue;
    const body = block.replace(/\/\/[^\n]*/g, "").replace(/desc: "[^"]*",/g, "");
    const n = (re, d = 0) => {
      const m = body.match(re);
      return m ? Number(m[1]) : d;
    };
    out[names[nm[1]] ?? nm[1]] = {
      baseRespect: n(/baseRespect: ([\d.e-]+)/), baseWanted: n(/baseWanted: ([-\d.e]+)/), baseMoney: n(/baseMoney: ([\d.e]+)/), difficulty: n(/difficulty: ([\d.]+)/, 1),
      hackWeight: n(/hackWeight: (\d+)/), strWeight: n(/strWeight: (\d+)/), defWeight: n(/defWeight: (\d+)/), dexWeight: n(/dexWeight: (\d+)/), agiWeight: n(/agiWeight: (\d+)/), chaWeight: n(/chaWeight: (\d+)/),
      territory: { money: n(/money: ([\d.]+)/, 1), respect: n(/respect: ([\d.]+)/, 1), wanted: n(/wanted: ([\d.]+)/, 1) },
      isCombat: !/isCombat: false/.test(body), isHacking: !/isHacking: false/.test(body),
    };
  }
  return out;
}

function upgradesFromSource() {
  const src = fs.readFileSync(path.join(GAME, "src/Gang/data/upgrades.ts"), "utf8");
  const out = {};
  for (const m of src.matchAll(/cost: ([\d.e]+),\s*mults: \{([^}]*)\},\s*name: "([^"]+)"/g)) {
    const mults = Object.fromEntries([...m[2].matchAll(/(\w+): ([\d.]+)/g)].map((x) => [x[1], Number(x[2])]));
    out[m[3]] = { cost: Number(m[1]), mults };
  }
  return out;
}

const member = (o = {}) => ({ name: "m", task: "Unassigned", hack: 1, str: 1, def: 1, dex: 1, agi: 1, cha: 1, hack_mult: 1, str_mult: 1, def_mult: 1, dex_mult: 1, agi_mult: 1, cha_mult: 1, hack_asc_points: 0, str_asc_points: 0, def_asc_points: 0, dex_asc_points: 0, agi_asc_points: 0, cha_asc_points: 0, upgrades: [], augmentations: [], earnedRespect: 0, ...o });

export async function run() {
  const checks = [];

  const c1 = new Check("GP1", "task and upgrade tables match Gang/data/tasks.ts and upgrades.ts");
  {
    const src = tasksFromSource();
    for (const [name, t] of Object.entries(src)) {
      c1.examined(1);
      const a = TASK[name];
      if (!a) {
        c1.fail(`${name} is in the game and not in TASKS`);
        continue;
      }
      for (const k of ["baseRespect", "baseWanted", "baseMoney", "difficulty", "hackWeight", "strWeight", "defWeight", "dexWeight", "agiWeight", "chaWeight", "isCombat", "isHacking"]) {
        if (a[k] !== t[k]) c1.fail(`${name}.${k}: TASKS ${a[k]} vs source ${t[k]}`);
      }
      for (const k of ["money", "respect", "wanted"]) if (a.territory[k] !== t.territory[k]) c1.fail(`${name}.territory.${k}: ${a.territory[k]} vs ${t.territory[k]}`);
    }
    for (const t of TASKS) if (!src[t.name]) c1.fail(`${t.name} is in TASKS and not in the game`);
    const ups = upgradesFromSource();
    for (const [name, u] of Object.entries(ups)) {
      c1.examined(1);
      const a = UPGRADES.find((x) => x.name === name);
      if (!a) c1.fail(`${name} is in the game and not in UPGRADES`);
      else if (a.cost !== u.cost || JSON.stringify(a.mults) !== JSON.stringify(u.mults)) c1.fail(`${name} differs: ${JSON.stringify(a)} vs ${JSON.stringify(u)}`);
    }
    if (Object.keys(ups).length !== UPGRADES.length) c1.fail(`${UPGRADES.length} upgrades vs ${Object.keys(ups).length} in source`);
    const consts = fs.readFileSync(path.join(GAME, "src/Gang/data/Constants.ts"), "utf8");
    if (!consts.includes(`GangKarmaRequirement: ${KARMA_FOR_GANG}`)) c1.fail("GangKarmaRequirement drifted");
    c1.note(`${Object.keys(src).length} tasks and ${Object.keys(ups).length} upgrades compared`);
  }
  checks.push(c1);

  const c2 = new Check("GP2", "gain, exp, skill and recruit formulas follow formulas.ts, GangMember.ts and Gang.ts by hand");
  {
    const g = { respect: 1000, wantedLevel: 10, territory: 1 / 7 };
    const m = member({ str: 60, def: 60, dex: 60, agi: 30, cha: 20 });
    const t = TASK["Mug People"];
    c2.examined(1);
    const sw = 0.25 * 60 + 0.25 * 60 + 0.25 * 60 + 0.1 * 30 + 0.15 * 20;
    const terr = Math.max(0.005, Math.pow((1 / 7) * 100, 1) / 100);
    const pen = 1000 / 1010;
    const soft = (0.2 / 7 + 0.8) * 1;
    const wantR = Math.pow(11 * 0.00005 * (sw - 4) * terr * pen, soft);
    if (Math.abs(respectGain(g, m, t, 1) - wantR) > 1e-15) c2.fail("respectGain diverges from calculateRespectGain");
    const wantM = Math.pow(5 * 3.6 * (sw - 3.2) * terr * pen, soft);
    if (Math.abs(moneyGain(g, m, t, 1) - wantM) > 1e-12) c2.fail("moneyGain diverges from calculateMoneyGain");
    const wantW = Math.min(100, (7 * 0.00005) / Math.pow(3 * (sw - 3.5) * terr, 0.8));
    if (Math.abs(wantedGain(g, m, t) - wantW) > 1e-15) c2.fail("wantedGain diverges from calculateWantedLevelGain");
    const vj = wantedGain(g, m, TASK["Vigilante Justice"]);
    const swv = 0.2 * (1 + 60 + 60 + 60 + 30);
    if (Math.abs(vj - 0.4 * -0.001 * (swv - 3.5) * Math.max(0.005, Math.pow(100 / 7, 0.9) / 100)) > 1e-15) c2.fail("negative baseWanted branch is wrong");
    if (respectGain(g, member(), t, 1) !== 0) c2.fail("below the difficulty threshold respect is 0");
    // GangSoftcap 0.9 (BN3) lowers the exponent.
    if (!(respectGain(g, m, t, 0.9) > respectGain(g, m, t, 1) === wantR < 1)) c2.fail("GangSoftcap must enter as the exponent");

    c2.examined(1);
    const e = expGain(TASK["Train Combat"], member({ str_mult: 1.2, str_asc_points: 8000 }));
    if (Math.abs(e.str - (25 / 1500) * Math.pow(100, 0.9) * ((1.2 - 1) / 4 + 1) * 2) > 1e-12) c2.fail("expGain: weight/1500 x d^0.9 x ((mult-1)/4+1) x ascMult");
    if (e.hack !== 0) c2.fail("no hack weight, no hack exp");
    if (ascMult(1999) !== 1 || ascMult(8000) !== 2) c2.fail("ascMult is max(sqrt(points/2000),1)");
    if (skillOf(0, 1) !== 1 || skillOf(Math.exp((300 + 200) / 32) - 534.5, 1) !== 300) c2.fail("skillOf diverges from GangMember.calculateSkill");

    c2.examined(1);
    if (respectForMembers(3) !== 0 || respectForMembers(4) !== 5 || respectForMembers(12) !== Math.pow(5, 9)) c2.fail("respectForMembers must be 5^(n-3)");
    for (const r of [0, 1, 5, 24, 25, 1e6, 1e12]) if (respectForMembers(recruitsAllowed(r)) > r) c2.fail(`recruitsAllowed(${r}) is not the inverse of respectForMembers`);
    if (recruitsAllowed(1e12) !== 12) c2.fail("never more than 12 members");
    if (Math.abs(discount(1e6, 1e4) - Math.max(1, Math.pow(1e6, 0.01) + 1e6 / 5e6 + Math.pow(1e4, 0.01) + 1e4 / 1e6 - 1)) > 1e-12) c2.fail("discount diverges from Gang.getDiscount");
    c2.note("Mug People respect/money/wanted, Vigilante Justice, Train Combat exp, skill, recruit thresholds and discount hand-checked");
  }
  checks.push(c2);

  const c3 = new Check("GP3", "assign: respect until twelve, money only when told and full, justice when wanted bites, training when nothing clears");
  {
    const g = { respect: 1e6, wantedLevel: 1, territory: 1 / 7, isHacking: false };
    const strong = (n) => member({ name: n, hack: 50, str: 400, def: 400, dex: 400, agi: 400, cha: 200 });
    c3.examined(1);
    const few = assign(g, [strong("a"), strong("b")], { softcap: 1, mode: "money" });
    if (few.mode !== "respect") c3.fail("below twelve members the mode must be respect whatever the caller asks");
    const full = assign(g, Array.from({ length: 12 }, (_, i) => strong(`m${i}`)), { softcap: 1, mode: "money" });
    if (full.mode !== "money") c3.fail("at twelve members the caller's money mode applies");
    const byR = TASK[few.assignments.a];
    const byM = TASK[full.assignments.m0];
    if (respectGain(g, strong("x"), byR, 1) < respectGain(g, strong("x"), byM, 1)) c3.fail("the respect pick must beat the money pick on respect");
    if (moneyGain(g, strong("x"), byM, 1) < moneyGain(g, strong("x"), byR, 1)) c3.fail("the money pick must beat the respect pick on money");

    c3.examined(1);
    const weak = assign(g, [member({ name: "w" })], { softcap: 1 });
    if (weak.assignments.w !== "Train Combat") c3.fail("a member who clears nothing must train");
    const hg = assign({ ...g, isHacking: true }, [member({ name: "w" })], { softcap: 1 });
    if (hg.assignments.w !== "Train Hacking") c3.fail("a hacking gang trains hacking");
    if (Object.values(hg.assignments).some((t) => !TASK[t].isHacking)) c3.fail("a hacking gang never gets a combat-only task");

    c3.examined(1);
    const hot = assign({ ...g, respect: 100, wantedLevel: 100 }, [strong("a"), strong("b"), strong("c")], { softcap: 1, minPenalty: 0.9 });
    const justice = Object.values(hot.assignments).filter((t) => t === "Vigilante Justice").length;
    if (!(justice >= 1)) c3.fail("with the penalty at 0.5 someone must lower wanted");
    if (!(hot.rates.wanted <= 0)) c3.fail("enough members must be converted for wanted to fall");
    const cool = assign(g, [strong("a"), strong("b"), strong("c")], { softcap: 1, minPenalty: 0.9 });
    if (Object.values(cool.assignments).includes("Vigilante Justice")) c3.fail("with the penalty near 1 nobody wastes time on justice");

    c3.examined(1);
    if (assign(g, [strong("a")], {}) !== null) c3.fail("no GangSoftcap must refuse");
    if (assign({ ...g, territory: undefined }, [strong("a")], { softcap: 1 }) !== null) c3.fail("unreadable territory must refuse");
    for (const [n, w] of Object.entries(cool.why)) if (!w) c3.fail(`${n} has no reason`);
    c3.note(`2 strong members: ${few.assignments.a}; 12 in money mode: ${full.assignments.m0}; penalty 0.5: ${justice} on justice`);
  }
  checks.push(c3);

  const c4 = new Check("GP4", "ascension and equipment decisions: gain floor, recruit preservation, gain per dollar, refusals");
  {
    const g = { respect: 200000, wantedLevel: 1, territory: 1 / 7, isHacking: false };
    const good = { hack: 1, str: 1.4, def: 1.4, dex: 1.3, agi: 1.3, cha: 1, respect: 1000 };
    c4.examined(1);
    if (!shouldAscend(member(), good, g, { members: 8 }).ascend) c4.fail("x1.35 on combat with respect to spare must ascend");
    if (shouldAscend(member(), { ...good, str: 1.05, def: 1.05, dex: 1.05, agi: 1.05 }, g, { members: 8 }).ascend) c4.fail("x1.05 must not ascend");
    // 8 members need 5^5 = 3125 respect; paying 199000 would drop below it.
    if (shouldAscend(member(), { ...good, respect: 199000 }, g, { members: 8 }).ascend) c4.fail("an ascension that loses a recruit must be refused");
    if (shouldAscend(member(), null, g, { members: 8 }).ascend) c4.fail("no result must refuse");
    const hk = shouldAscend(member(), { ...good, str: 1, def: 1, dex: 1, agi: 1, hack: 1.5 }, { ...g, isHacking: true }, { members: 8 });
    if (!hk.ascend) c4.fail("a hacking gang judges the hack multiplier");

    c4.examined(1);
    const e = bestEquipment(member(), [], 3e6, 1, false);
    if (!e) c4.fail("with $3m something must be affordable");
    else {
      // Baseball Bat: ln(1.04)*2 / 1e6 = 7.8e-8 per $; Bulletproof Vest: ln(1.04)/2e6 = 2.0e-8; Herrera: 2*ln(1.04)/3e6 = 2.6e-8.
      if (e.name !== "Baseball Bat") c4.fail(`the bat is the best combat gain per dollar under $3m, got ${e.name}`);
    }
    if (bestEquipment(member(), ["Baseball Bat"], 1.5e6, 1, false)?.name === "Baseball Bat") c4.fail("owned gear is not re-bought");
    const hk2 = bestEquipment(member(), [], 3e6, 1, true);
    if (!hk2 || !UPGRADES.find((u) => u.name === hk2.name).mults.hack && !UPGRADES.find((u) => u.name === hk2.name).mults.cha) c4.fail("a hacking gang buys only hack or charisma gear");
    if (bestEquipment(member(), ["Herrera Outlaw GTS"], 6e6, 1, true)?.name !== "NUKE Rootkit") c4.fail("with the vehicle owned and $6m the rootkit is the hacking pick");
    if (bestEquipment(member(), [], 0, 1, false) !== null) c4.fail("no budget, nothing");
    if (bestEquipment(member(), [], 1e9, undefined, false) !== null) c4.fail("an unreadable discount must refuse");
    if (bestEquipment(member(), [], 1e6, 2, false)?.name !== "Baseball Bat" || bestEquipment(member(), [], 1e6, 2, false)?.cost !== 5e5) c4.fail("the discount halves the cost");

    c4.examined(1);
    if (!gangAllowed({ bitNode: 2 }).ok) c4.fail("BN2 allows a gang outright");
    if (gangAllowed({ bitNode: 5, sf2: 1, karma: -100 }).ok) c4.fail("outside BN2 karma must reach -54000");
    if (!gangAllowed({ bitNode: 5, sf2: 1, karma: -54000 }).ok) c4.fail("exactly -54000 qualifies");
    if (gangAllowed({ bitNode: 5, sf2: 0, karma: -1e6 }).ok) c4.fail("no SF2, no gang");
    if (gangAllowed({ bitNode: 2, disabled: true }).ok) c4.fail("the BitNode option disables it");
    c4.note("five ascension shapes, six equipment shapes, five access shapes");
  }
  checks.push(c4);

  // ---------------------------------------------------------------------
  const c5 = new Check("GP5", "simulateGang steps the game's own loop: gross respect, wanted with the per-process justice factor, exp -> skill, recruits at 5^(n-3)");
  {
    const { simulateGang, freshMember, respectGain, wantedGain, expGain, skillOf, ascMult, assign, TASK, CYCLES_PER_PROCESS, CYCLE_SEC } = gp;
    c5.examined(1);
    if (CYCLES_PER_PROCESS !== 10) c5.fail("GangConstants.minCyclesToProcess is 2000ms / 200ms = 10 cycles");
    // One 60-second step by hand, from a mid-strength gang under the same policy.
    const g = { respect: 1000, wantedLevel: 10, territory: 1 / 7, isHacking: false };
    const mk = (v) => { const m = freshMember("m" + v); for (const st of ["str", "def", "dex", "agi"]) { m[st + "_exp"] = Math.exp((v + 200) / 32) - 534.5; m[st] = v; } return m; };
    const members = [mk(60), mk(80), mk(100)];
    const sim = simulateGang(g, members, { softcap: 1, horizonH: 60 / 3600, stepSec: 60 });
    if (!sim || sim.samples.length !== 2) c5.fail("a one-step horizon yields exactly two samples");
    else {
      const plan = assign(g, members.map((m) => ({ ...m })), { softcap: 1 });
      const cycles = 300;
      let r = 0, w = 0, justice = 0;
      for (const m of members) { const t = TASK[plan.assignments[m.name]]; r += respectGain(g, m, t, 1); w += wantedGain(g, m, t); if (t.baseWanted < 0) justice++; }
      const s1 = sim.samples[1];
      if (Math.abs(s1.gross - r * cycles) > 1e-9) c5.fail(`gross respect after one step must be 300 x per-cycle gain: ${s1.gross} vs ${r * cycles}`);
      if (Math.abs(s1.respect - (1000 + r * cycles)) > 1e-9) c5.fail("respect balance advances by the gross gain");
      let wanted = 10;
      for (let p = 0; p < 30; p++) wanted = (wanted + w * 10) * (1 - justice * 0.001);
      if (Math.abs(s1.wantedLevel - wanted) > 1e-9) c5.fail(`wanted must follow 30 processes of (w + gain x 10) x (1 - justice/1000): ${s1.wantedLevel} vs ${wanted}`);
      if (Math.abs(sim.respectPerSec - r / CYCLE_SEC) > 1e-12) c5.fail("respectPerSec is the policy's rate at h=0");
    }
    // Recruiting: 1000 respect admits 7 members (5^4 = 625 <= 1000 < 3125).
    c5.examined(1);
    const sim7 = simulateGang(g, members, { softcap: 1, horizonH: 60 / 3600, stepSec: 60 });
    if (sim7 && sim7.samples[1].members !== 7) c5.fail(`1000 respect must recruit up to 7 members, got ${sim7?.samples[1].members}`);
    // Exp -> skill over many steps: a member's stat must rise, and by the game's curve.
    c5.examined(1);
    const one = [mk(60)];
    const long = simulateGang({ ...g, respect: 1 }, one, { softcap: 1, horizonH: 2, stepSec: 60 });
    if (!long || !(long.samples.at(-1).gross > long.samples[60].gross - long.samples[0].gross)) c5.fail("gains must not fall as exp accrues");
    const e = expGain(TASK["Mug People"], one[0]);
    const expAfter = one[0].str_exp + e.str * 300;
    if (!(skillOf(expAfter, 1) >= 60)) c5.fail("skill curve: exp only rises");
    // Refusals.
    c5.examined(1);
    if (simulateGang(null, members, { softcap: 1 }) !== null) c5.fail("no gang -> null");
    if (simulateGang(g, members, {}) !== null) c5.fail("no softcap -> null");
    if (simulateGang({ ...g, isHacking: "no" }, members, { softcap: 1 }) !== null) c5.fail("unreadable isHacking -> null");
    c5.note("one 60s step hand-stepped (gross, balance, wanted x30 processes, rate), recruit rule, 2h monotone gains, refusals");
  }
  checks.push(c5);

  // ---------------------------------------------------------------------
  const c6 = new Check("GP6", "gangRepAt / hoursToGangRep: rep = now + facRep x gross x (1+favor/100) / 75, interpolated; beyond the horizon is Infinity (known), unreadable is null");
  {
    const { gangRepAt, hoursToGangRep, RESPECT_TO_REP } = gp;
    c6.examined(1);
    if (RESPECT_TO_REP !== 75) c6.fail("GangRespectToReputationRatio is 75");
    const fc = { samples: [{ h: 0, gross: 0 }, { h: 1, gross: 750 }, { h: 2, gross: 3000 }], horizonH: 2 };
    const o = { facRepMult: 1.2, favor: 50 };
    // 1h: 750 gross x 1.2 x 1.5 / 75 = 18 rep on top of 10.
    if (Math.abs(gangRepAt(fc, 1, 10, o) - 28) > 1e-9) c6.fail(`rep at 1h must be 28, got ${gangRepAt(fc, 1, 10, o)}`);
    // 0.5h interpolates gross linearly: 375 -> 9 rep.
    if (Math.abs(gangRepAt(fc, 0.5, 10, o) - 19) > 1e-9) c6.fail("rep at 0.5h interpolates the gross");
    // Beyond the horizon holds flat, never extrapolates.
    if (Math.abs(gangRepAt(fc, 5, 10, o) - (10 + (3000 * 1.2 * 1.5) / 75)) > 1e-9) c6.fail("beyond the horizon the last gross is held");
    // hoursToGangRep: 28 is reached at exactly 1h; 10 is now (0); 1e6 is beyond (Infinity); NaN target null.
    if (Math.abs(hoursToGangRep(fc, 28, 10, o) - 1) > 1e-9) c6.fail("28 rep is reached at 1h");
    if (hoursToGangRep(fc, 10, 10, o) !== 0) c6.fail("a target already held is 0 hours");
    if (hoursToGangRep(fc, 1e6, 10, o) !== Infinity) c6.fail("beyond the horizon is Infinity, a known answer");
    if (hoursToGangRep(fc, NaN, 10, o) !== null) c6.fail("an unreadable target is null");
    if (gangRepAt(fc, 1, 10, { favor: 0 }) !== null) c6.fail("no faction_rep multiplier -> null, never 1");
    if (gangRepAt(null, 1, 10, o) !== null) c6.fail("no forecast -> null");
    // Favor unreadable -> 0 (never guessed upward).
    if (Math.abs(gangRepAt(fc, 1, 10, { facRepMult: 1 }) - 20) > 1e-9) c6.fail("missing favor is 0");
    c6.note("ratio 75, favor and faction_rep multipliers, interpolation, flat beyond horizon, Infinity vs null");
  }
  checks.push(c6);

  // ---------------------------------------------------------------------
  const c7 = new Check("GP7", "choosePolicy picks by trajectory: the live 2026-09-19 gang trains first (8x sooner to 5,000 rep); a gang that already clears Terrorism stays greedy; refusals");
  {
    const { choosePolicy, policies, trainUntil, freshMember, skillOf, ascMult, STATS, TASK, statWeight } = gp;
    c7.examined(1);
    const raw = [{"n":"steve","str":[1424.2,1.04,4700],"def":[1458,1.1681,4700],"dex":[1413.6,1,4700],"agi":[653.8,1.04,4694],"cha":[485.8,1.04,0]},{"n":"beve","str":[1427.4,1.04,4700],"def":[1438.4,1.0816,4700],"dex":[1416.8,1,4700],"agi":[647.3,1.04,4694],"cha":[491.8,1.04,0]},{"n":"sneve","str":[1433,1.04,4699],"def":[1444,1.0816,4699],"dex":[1422.4,1,4699],"agi":[636,1.04,4694],"cha":[502.3,1.04,0]},{"n":"ash","str":[910.3,1.04,0],"def":[917.3,1.0816,0],"dex":[903.6,1,0],"agi":[434,1.04,0],"cha":[476.3,1.04,0]},{"n":"bex","str":[866,1.04,0],"def":[873,1.0816,0],"dex":[859.3,1,0],"agi":[409.5,1.04,0],"cha":[456.5,1.04,0]},{"n":"cid","str":[745.9,1,0],"def":[745.9,1,0],"dex":[745.9,1,0],"agi":[361.4,1,0],"cha":[384.4,1,0]},{"n":"dov","str":[456.6,1,0],"def":[456.6,1,0],"dex":[456.6,1,0],"agi":[245.7,1,0],"cha":[210.8,1,0]}];
    const live = raw.map((r) => { const m = freshMember(r.n); for (const s of STATS) { if (!r[s]) continue; m[s + "_exp"] = r[s][0]; m[s + "_mult"] = r[s][1]; m[s + "_asc_points"] = r[s][2]; m[s] = skillOf(m[s + "_exp"], m[s + "_mult"] * ascMult(m[s + "_asc_points"])); } return m; });
    const G = { respect: 1588, wantedLevel: 23.5, territory: 1 / 7, isHacking: false };
    const targetGross = ((5000 - 2.7) * 75) / (1.3937 * 1.0005);
    const c = choosePolicy(G, live, { softcap: 1, horizonH: 12, stepSec: 120, targetGross });
    if (!c) c7.fail("choosePolicy must read the live gang");
    else {
      if (c.chosen.name !== "train until Terrorism") c7.fail(`the live gang must train until Terrorism, chose ${c.chosen.name}`);
      const greedy = c.table.find((r) => r.name === "greedy");
      const chosen = c.table.find((r) => r.name === c.chosen.name);
      if (!(greedy.hoursToTarget === Infinity || greedy.hoursToTarget > 8 * chosen.hoursToTarget)) c7.fail(`training must beat greedy by >8x, greedy ${greedy.hoursToTarget} vs ${chosen.hoursToTarget}`);
      if (!(chosen.hoursToTarget > 2 && chosen.hoursToTarget < 5)) c7.fail(`the measured 3.4h must reproduce, got ${chosen.hoursToTarget}`);
      if (c.chosen.forecast.samples.length < 100) c7.fail("the chosen policy's forecast comes back with it");
    }
    // A gang that already clears Terrorism: trainUntil assigns nobody to training, so greedy ties and stays.
    c7.examined(1);
    const strong = live.map((m) => { const s = { ...m }; for (const st of ["str", "def", "dex", "cha"]) { s[st + "_exp"] = 1e6; s[st] = skillOf(1e6, 1); } return s; });
    if (!(statWeight(TASK.Terrorism, strong[0]) - 4 * 36 > 0)) c7.fail("fixture: the strong member must clear Terrorism");
    const p = trainUntil("Terrorism")(G, strong, { softcap: 1 });
    if (Object.values(p.assignments).includes("Train Combat")) c7.fail("nobody trains once everyone clears the task");
    // Shapes.
    c7.examined(1);
    if (policies(false).length < 5 || policies(false)[0].name !== "greedy") c7.fail("combat policies: greedy first, then train-until for every hard respect task");
    if (trainUntil("No Such Task") !== null) c7.fail("an unknown task is null");
    if (choosePolicy(null, live, { softcap: 1 }) !== null) c7.fail("no gang -> null");
    c7.note("live fixture reproduces the 8x; strong gang stays greedy; policy list and refusals");
  }
  checks.push(c7);

  return checks;
}
