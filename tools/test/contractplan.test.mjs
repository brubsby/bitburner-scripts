// [CP] coding contracts as a forecast — contractplan.js against game source.
//
// The failure this prevents: the largest realised early income had no
// forecast, and it is not even in the measured script income the money legs
// divide by (docs/pricing-gaps.md §5). Pinned here: the spawn rate, the
// difficulty pool, the reward routing, and refusals.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import "./gameresolve.mjs";
import { GAME } from "./build-ram.mjs";

const cp = await import("../../contractplan.js");
const { DIFFICULTIES, spawnChance, spawnPerSec, expectedDifficulty, expectedReward, contractIncome, BASE_MONEY_GAIN, BASE_FACTION_REP_GAIN, BASE_COMPANY_REP_GAIN, TRIES_PER_WINDOW, WINDOW_SEC } = cp;

export async function run() {
  const checks = [];

  // ---------------------------------------------------------------------
  const c1 = new Check("CP1", "constants, spawn cadence and the difficulty pool match game source");
  {
    const consts = fs.readFileSync(path.join(GAME, "src/Constants.ts"), "utf8");
    for (const [name, v] of [["CodingContractBaseMoneyGain", BASE_MONEY_GAIN], ["CodingContractBaseFactionRepGain", BASE_FACTION_REP_GAIN], ["CodingContractBaseCompanyRepGain", BASE_COMPANY_REP_GAIN]]) {
      c1.examined(1);
      const m = consts.match(new RegExp(`${name}:\\s*([\\d.e]+)`));
      if (!m || Number(m[1]) !== v) c1.fail(`${name}: module ${v} vs source ${m?.[1]}`);
    }
    c1.examined(1);
    const engine = fs.readFileSync(path.join(GAME, "src/engine.tsx"), "utf8");
    const tries = engine.match(/tryGeneratingRandomContract\((\d+)\);\s*\n\s*Engine\.Counters\.contractGeneration = (\d+);/);
    if (!tries) c1.fail("could not find the contract generation cadence in engine.tsx");
    else {
      if (Number(tries[1]) !== TRIES_PER_WINDOW) c1.fail(`tries per window: module ${TRIES_PER_WINDOW} vs engine ${tries[1]}`);
      if (Number(tries[2]) * 0.2 !== WINDOW_SEC) c1.fail(`window: module ${WINDOW_SEC}s vs engine ${tries[2]} cycles`);
    }
    c1.examined(1);
    const gen = fs.readFileSync(path.join(GAME, "src/CodingContract/ContractGenerator.ts"), "utf8");
    const p = gen.match(/random > (\d+) \/ \((\d+) \+ Math\.exp\(([\d.]+) \* currentNumberOfContracts\)\)/);
    if (!p) c1.fail("could not find the spawn probability in ContractGenerator.ts");
    else if (Math.abs(spawnChance(0) - Number(p[1]) / (Number(p[2]) + 1)) > 1e-12 || Math.abs(spawnChance(5000) - Number(p[1]) / (Number(p[2]) + Math.exp(Number(p[3]) * 5000))) > 1e-12) {
      c1.fail("spawnChance diverges from the source expression");
    }
    if (!gen.includes("const maxDif = 2 * totalSFs + 1")) c1.fail("the difficulty cap expression has changed in ContractGenerator.ts");

    c1.examined(1);
    const dir = path.join(GAME, "src/CodingContract/contracts");
    const found = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".ts")) continue;
      for (const m of fs.readFileSync(path.join(dir, f), "utf8").matchAll(/difficulty:\s*(\d+)/g)) found.push(Number(m[1]));
    }
    found.sort((a, b) => a - b);
    if (JSON.stringify(found) !== JSON.stringify([...DIFFICULTIES].sort((a, b) => a - b))) {
      c1.fail(`difficulty pool drifted: source ${JSON.stringify(found)} vs module ${JSON.stringify(DIFFICULTIES)}`);
    }
    c1.note(`${found.length} contract types in source; spawn ${spawnPerSec(0) * 3600} per hour at zero pending`);
  }
  checks.push(c1);

  // ---------------------------------------------------------------------
  const c2 = new Check("CP2", "reward routing follows gainCodingContractReward, per Source-File cap");
  {
    c2.examined(1);
    // Cap 7 at three Source-File levels (SF1.2 + SF4.1): the 25 types at difficulty <= 7.
    const pool = DIFFICULTIES.filter((d) => d <= 7);
    const d = pool.reduce((a, b) => a + b, 0) / pool.length;
    if (Math.abs(expectedDifficulty(3) - d) > 1e-12) c2.fail("expectedDifficulty must average the types under the cap");
    if (expectedDifficulty(0) === null) c2.fail("cap 1 still leaves the difficulty-1 types");

    // Everything on, job held: money 1/4, faction 2/4, company 1/4.
    c2.examined(1);
    const r = expectedReward({ totalSourceFileLevels: 3, nodeContractMoney: 1, hasHackingFaction: true, hasJob: true });
    if (Math.abs(r.money - 0.25 * 75e6 * d * (1 / 3)) > 1e-6) c2.fail("money share with a job held must be 1/4");
    if (Math.abs(r.factionRep - 0.5 * 2500 * d * (1 / 3)) > 1e-9) c2.fail("faction share with a job held must be 2/4");
    if (r.companyRepShare !== 0.25) c2.fail("company share with a job held must be 1/4");
    // No job: the company draw re-rolls as faction rep.
    c2.examined(1);
    const nj = expectedReward({ totalSourceFileLevels: 3, nodeContractMoney: 1, hasHackingFaction: true, hasJob: false });
    if (Math.abs(nj.factionRep - 0.75 * 2500 * d * (1 / 3)) > 1e-9) c2.fail("with no job the faction share must be 3/4");
    if (nj.companyRepShare !== 0) c2.fail("with no job the company share must be 0");
    // No hacking faction: faction draws pay money.
    c2.examined(1);
    const nf = expectedReward({ totalSourceFileLevels: 3, nodeContractMoney: 1, hasHackingFaction: false, hasJob: false });
    if (Math.abs(nf.money - 1.0 * 75e6 * d * (1 / 3)) > 1e-6) c2.fail("with no hacking faction and no job every draw pays money");
    // BN8-shaped: money multiplier 0 removes the money type entirely.
    c2.examined(1);
    const bn8 = expectedReward({ totalSourceFileLevels: 3, nodeContractMoney: 0, hasHackingFaction: true, hasJob: true });
    if (bn8.money !== 0) c2.fail("CodingContractMoney 0 must pay no money");
    if (Math.abs(bn8.factionRep - (2 / 3) * 2500 * d * (1 / 3)) > 1e-9) c2.fail("with three types the faction share is 2/3");
    // Refusals.
    c2.examined(1);
    if (expectedReward({ totalSourceFileLevels: 3, nodeContractMoney: undefined, hasHackingFaction: true, hasJob: true }) !== null) c2.fail("unreadable CodingContractMoney must refuse");
    if (expectedReward({ totalSourceFileLevels: 3, nodeContractMoney: 1, hasHackingFaction: "yes", hasJob: true }) !== null) c2.fail("non-boolean faction flag must refuse");
    if (contractIncome({}) !== null) c2.fail("contractIncome with no inputs must refuse");
    const inc = contractIncome({ totalSourceFileLevels: 3, nodeContractMoney: 1, hasHackingFaction: true, hasJob: true, pending: 0 });
    c2.note(`BN1 shape, SF total 3: ${(inc.perHour).toFixed(2)}/h, $${(inc.moneyPerSec / 1e3).toFixed(1)}k/s expected money, ${inc.factionRepPerSec.toFixed(2)} rep/s`);
  }
  checks.push(c2);

  return checks;
}
