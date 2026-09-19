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

  return checks;
}
