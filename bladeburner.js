import { killOtherInstances } from "common.js"
import { getBitNodeMultipliers } from "bitNodeMultipliers.js";

const actionTimeWithBonus = (ns, action) => {
  let bonusTime = ns.bladeburner.getBonusTime();
  let baseTime = ns.bladeburner.getActionTime(action.type, action.name);
  return bonusTime > baseTime ? Math.ceil(baseTime / 5) : baseTime;
}

const bladeburner_city_names =
  ["Aevum", "Chongqing", "Sector-12", "New Tokyo", "Ishima", "Volhaven"];

const estimate_accuracy_actions = [
  "Field Analysis",
  "Tracking",
  "Investigation",
  "Undercover Operation",
];

const stamina_free_actions = [
  "Field Analysis",
  "Recruitment",
  "Diplomacy",
];

const s_skills = [
  "Reaper",
  "Evasive System",
  "Overclock",
];

const a_skills = [
  "Blade's Intuition",
  "Short-Circuit",
  "Digital Observer",
  "Datamancer",
];

const b_skills = [
  "Cyber's Edge",
  "Cloak",
];

const c_skills = [
  "Tracer",
  "Hands of Midas",
  "Hyperdrive",
];

const actionConstants = {
  //contracts
  "Tracking": {
    baseDifficulty: 125,
    difficultyFac: 1.02,
    rewardFac: 1.041,
    hpLoss: 0.5,
  },
  "Bounty Hunter": {
    baseDifficulty: 250,
    difficultyFac: 1.04,
    rewardFac: 1.085,
    hpLoss: 1,
  },
  "Retirement": {
    baseDifficulty: 200,
    difficultyFac: 1.03,
    rewardFac: 1.065,
    hpLoss: 1,
  },
  //ops
  "Investigation": {
    baseDifficulty: 400,
    difficultyFac: 1.03,
    rewardFac: 1.07,
    hpLoss: 0,
  },
  "Undercover Operation": {
    baseDifficulty: 500,
    difficultyFac: 1.04,
    rewardFac: 1.09,
    hpLoss: 2,
  },
  "Sting Operation": {
    baseDifficulty: 650,
    difficultyFac: 1.04,
    rewardFac: 1.095,
    hpLoss: 2.5,
  },
  "Raid": {
    baseDifficulty: 800,
    difficultyFac: 1.045,
    rewardFac: 1.1,
    hpLoss: 50,
  },
  "Stealth Retirement Operation": {
    baseDifficulty: 1000,
    difficultyFac: 1.05,
    rewardFac: 1.11,
    hpLoss: 10,
  },
  "Stealth Retirement Operation": {
    baseDifficulty: 1500,
    difficultyFac: 1.06,
    rewardFac: 1.14,
    hpLoss: 5,
  },
  "Assassination": {
    baseDifficulty: 1500,
    difficultyFac: 1.06,
    rewardFac: 1.14,
    hpLoss: 5,
  },
  // blackops
  "Operation Typhoon": {
    baseDifficulty: 2000,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 100,
  },
  "Operation Zero": {
    baseDifficulty: 2500,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 50,
  },
  "Operation X": {
    baseDifficulty: 3000,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 100,
  },
  "Operation Titan": {
    baseDifficulty: 4000,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 100,
  },
  "Operation Ares": {
    baseDifficulty: 5000,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 200,
  },
  "Operation Archangel": {
    baseDifficulty: 7500,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 25,
  },
  "Operation Juggernaut": {
    baseDifficulty: 10e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 300,
  },
  "Operation Red Dragon": {
    baseDifficulty: 12.5e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 500,
  },
  "Operation K": {
    baseDifficulty: 15e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 1000,
  },
  "Operation Deckard": {
    baseDifficulty: 20e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 200,
  },
  "Operation Tyrell": {
    baseDifficulty: 25e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 500,
  },
  "Operation Wallace": {
    baseDifficulty: 30e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 1500,
  },
  "Operation Shoulder of Orion": {
    baseDifficulty: 35e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 1500,
  },
  "Operation Hyron": {
    baseDifficulty: 40e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 500,
  },
  "Operation Morpheus": {
    baseDifficulty: 45e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 100,
  },
  "Operation Ion Storm": {
    baseDifficulty: 50e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 5000,
  },
  "Operation Annihilus": {
    baseDifficulty: 55e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 10e3,
  },
  "Operation Ultron": {
    baseDifficulty: 60e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 10e3,
  },
  "Operation Centurion": {
    baseDifficulty: 70e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 10e3,
  },
  "Operation Vindictus": {
    baseDifficulty: 75e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 20e3,
  },
  "Operation Daedalus": {
    baseDifficulty: 80e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 100e3,
  },
}

const goals = {
  RANK: {
    name: "RANK",
    valueToMaxFunction: action => action.low_expected_rank_gain_per_second,
    debugStringFunction: (ns, action) =>
      `-:${ns.nFormat(action.rank_loss, "0.000").padStart(6)
      } +:${ns.nFormat(action.rank_gain,"0.000").padStart(7)
      } r/s:${[
        action.low_expected_rank_gain_per_second,
        action.avg_expected_rank_gain_per_second,
        action.high_expected_rank_gain_per_second,
      ].map(rps => ns.nFormat(rps, "0.000")).join('/')}`,
  },
  MONEY: {
    name: "MONEY",
    valueToMaxFunction: action => action.low_expected_rank_gain_per_second,
    filter: action => action.type == "contract",
    debugStringFunction: () => "",
  },
  CHAOS: {
    name: "CHAOS",
    valueToMaxFunction: action => 1 / action.chaos_mult,
    filter: (action, city) => action.city == city,
    debugStringFunction: (ns, action) =>
      `*chaos:${ns.nFormat(action.chaos_mult, "0.000").padStart(6)}`,
  },
  STAMINALOW: {
    name: "STAMINALOW",
    // often you net regain stamina for actions, 0 stamina actions or
    // regeneration chamber not always necessary, so max something else
    valueToMaxFunction: (action, secondaryGoal) =>
      action.net_stamina_per_second > 0 ?
      secondaryGoal.valueToMaxFunction(action) :
      action.net_stamina_per_second,
      debugStringFunction: (ns, action, secondaryGoal) =>
        `+stam:${ns.nFormat(action.net_stamina, "0.000").padStart(6)
        } +stam/s:${ns.nFormat(action.net_stamina_per_second, "0.000").padStart(6)
        } ${secondaryGoal.debugStringFunction(ns, action)}`,
  },
  STAMINA: {
    name: "STAMINA",
    // max other goal per stamina, we have medium stamina but not low
    valueToMaxFunction: (action, secondaryGoal) =>
      secondaryGoal.valueToMaxFunction(action) +
      action.net_stamina_per_second,
      debugStringFunction: (ns, action, secondaryGoal) =>
        `+stam:${ns.nFormat(action.net_stamina, "0.000").padStart(6)
        } +stam/s:${ns.nFormat(action.net_stamina_per_second, "0.000").padStart(6)
        } ${secondaryGoal.name.toLowerCase().substring(0,3)
        }/s+stam/s:${ns.nFormat(secondaryGoal.valueToMaxFunction(action) +
          action.net_stamina_per_second, "0.000").padStart(7)
        }`,
  },
  ESTIMATE: {
    name: "ESTIMATE",
    valueToMaxFunction: action => action.low_expected_pop_est_percent_per_second,
    filter: (action, city) => action.city == city,
    debugStringFunction: (ns, action) =>
      `+:${ns.nFormat(action.expected_comm_est, "0.000").padStart(5)
      } pepps:${[
        action.low_expected_pop_est_percent_per_second,
        action.avg_expected_pop_est_percent_per_second,
        action.high_expected_pop_est_percent_per_second,
      ].map(rps => ns.nFormat(rps, ".00000")).join('/')}`,
  },
  RECRUITMENT: {
    name: "RECRUITMENT",
    valueToMaxFunction: action => action.low_expected_team_gain_per_second,
    debugStringFunction: () => "",
  },
  BLACKOPS: {
    name: "BLACKOPS",
    valueToMaxFunction: action => action.type == "black operation" ?
      action.avg_expected_rank_gain_per_second : 0,
    debugStringFunction: () => "",
  }
}

const estimate_threshold = .2;

let wake_timestamp;

const skillWeight = (skillName) => {
  if (s_skills.includes(skillName)) return 1;
  if (a_skills.includes(skillName)) return 2;
  if (b_skills.includes(skillName)) return 3;
  if (c_skills.includes(skillName)) return 4;
  return 5;
}

const upgradeSkills = async (ns) => {
  let skillNames = ns.bladeburner.getSkillNames();
  while (true) {
    let skillStats = skillNames.map(skillName => ({
      name: skillName,
      level: ns.bladeburner.getSkillLevel(skillName),
      cost: ns.bladeburner.getSkillUpgradeCost(skillName),
      weighted_cost: skillWeight(skillName) *
        ns.bladeburner.getSkillUpgradeCost(skillName),
    }));
    skillStats = skillStats.filter(skill =>
      !(skill.name == "Overclock" && skill.level >= 90));

    let lowestSkill = skillStats.reduce((result, next) => result.weighted_cost < next.weighted_cost ? result : next);
    if (ns.bladeburner.getSkillPoints() >= lowestSkill.cost) {
      if (!ns.bladeburner.upgradeSkill(lowestSkill.name)) {
        break;
      }
    } else {
      break;
    }
    await ns.sleep(25);
  }

};

//todo calculate from upgrades
const getSkillMultipliers = (ns) => {
  return {
    effective_agility: 1,
    stamina: 1,
  }
}

const getStaminaGainPerSecond = (ns) => {
  let player = ns.getPlayer();
  let skillMultipliers = getSkillMultipliers(ns);
  let effAgility = player.agility * skillMultipliers.effective_agility;
  let maxStaminaBonus = ns.bladeburner.getStamina()[1] / 70000;
  let gain = (0.0085 + maxStaminaBonus) * Math.pow(effAgility, 0.17);
  return gain * skillMultipliers.stamina * player.bladeburner_stamina_gain_mult;
};

const staminaLoss = (ns, action) => {
  if (action.name == "Training") {
    return 0.285 * 0.5;
  } else if (stamina_free_actions.includes(action.name)) {
    return 0;
  } else if (action.name == "Hyperbolic Regeneration Chamber") {
    return ns.bladeburner.getStamina()[1] * 1 / 100;
  } else {
    let difficulty = actionConstants[action.name].baseDifficulty *
      Math.pow(actionConstants[action.name].difficultyFac, (action.level || 1) - 1);
    let difficultyMultiplier = Math.pow(difficulty, 0.28) + difficulty / 650;
    return 0.285 * difficultyMultiplier;
  }
}

const setAllAutolevel = (ns, autolevel) =>
  getLeveledActions(ns).filter(action =>
    ns.bladeburner.getActionAutolevel(action.type, action.name) != autolevel)
      .forEach(action =>
        ns.bladeburner.setActionAutolevel(action.type, action.name, autolevel));

const getLeveledActions = (ns) =>
  ns.bladeburner.getContractNames().map(contractName =>
    ({type: "contract", name: contractName})).concat(
      ns.bladeburner.getOperationNames().map(operationName =>
      ({type: "operation", name: operationName})));

const getAllLevelsOfLeveledActions = (ns) =>
  getLeveledActions(ns).map(action =>
    [...Array(ns.bladeburner.getActionMaxLevel(action.type, action.name))
      .keys()].map(i=>i+1).map(level => ({...action, ...{level: level}})).flat()).flat();

const addCitiesToActions = (ns, actions) =>
  bladeburner_city_names.map(city =>
    actions.map(action =>
      ({...action, ...{city: city}}))).flat();

const annotateActions = (ns, actions) => {
  let player = ns.getPlayer(ns);
  let bitNodeMultipliers = getBitNodeMultipliers();
  let staminaGainPerSecond = getStaminaGainPerSecond(ns);
  return actions.map(action => {
    switchCityAndLevelToAction(ns, action);
    let estimatedSuccessChance = action.type == 'general' && action.name != "Recruitment" ?
      [1, 1] :
      ns.bladeburner.getActionEstimatedSuccessChance(action.type, action.name);
    let time = ns.bladeburner.getActionTime(action.type, action.name);
    let rankGain = action.name == "Field Analysis" ? 0.1 :
      ns.bladeburner.getActionRepGain(action.type, action.name);
    let rankLoss = action.name == "Raid" ? rankGain / 22 /
      bitNodeMultipliers.BladeburnerRank :
      (action.type == "operation" ? rankGain / 11 : 0);
    let popEstPercent;
    let expectedCommEst;
    switch (action.name) {
      case "Investigation":
        popEstPercent = 0.4; // times successChanceEstimate
        expectedCommEst = 0.02; // times successChanceEstimate
        break;
      case "Undercover Operation":
        popEstPercent = 0.8; // times successChanceEstimate
        expectedCommEst = 0.02; // times successChanceEstimate
        break;
      case "Field Analysis":
        popEstPercent =
          (0.04 * Math.pow(player.hacking_skill, 0.3) +
          0.04 * Math.pow(player.intelligence, 0.9) +
          0.02 * Math.pow(player.charisma, 0.3)) *
          (player.bladeburner_analysis_mult || 1.08); // times successChanceEstimate
          // opened a pull request to add bladeburner_analysis_mult to the player object
        expectedCommEst = 0;
        break;
      default:
        popEstPercent = 0;
        expectedCommEst = 0;
    }
    let teamGain = action.name == "Recruitment" ? 1 : 0;
    let chaosMult = action.name == "Diplomacy" ?
      (100 - Math.pow(player.charisma, 0.045) + player.charisma / 1000) / 100 : 1
    let lowSuccessChance = estimatedSuccessChance[0];
    let highSuccessChance = estimatedSuccessChance[1];
    let avgSuccessChance = (lowSuccessChance + highSuccessChance) / 2;
    let count = action.type == "general" ? Infinity :
      ns.bladeburner.getActionCountRemaining(action.type, action.name);
    let staminaCost = staminaLoss(ns, action);
    let netStamina = staminaGainPerSecond * time - staminaCost;
    let requiredRank = action.type == "black operation" ?
      ns.bladeburner.getBlackOpRank(action.name) : 0;
    return {...action, ...{
      count: count,
      time: time,
      stamina_cost: staminaCost,
      net_stamina: netStamina,
      net_stamina_per_second: netStamina / time,
      required_rank: requiredRank,
      low_success_chance: lowSuccessChance,
      high_success_chance: highSuccessChance,
      avg_success_chance: avgSuccessChance,
      success_chance_range: highSuccessChance - lowSuccessChance,

      rank_gain: rankGain,
      rank_loss: rankLoss,
      low_expected_rank_gain_per_second: (rankGain * lowSuccessChance - (1 - lowSuccessChance) * rankLoss) / time,
      avg_expected_rank_gain_per_second: (rankGain * avgSuccessChance - (1 - avgSuccessChance) * rankLoss) / time,
      high_expected_rank_gain_per_second: (rankGain * highSuccessChance - (1 - highSuccessChance) * rankLoss) / time,

      pop_est_percent: popEstPercent,
      low_expected_pop_est_percent_per_second: popEstPercent * lowSuccessChance / time,
      avg_expected_pop_est_percent_per_second: popEstPercent * avgSuccessChance / time,
      high_expected_pop_est_percent_per_second: popEstPercent * highSuccessChance / time,

      expected_comm_est: expectedCommEst,
      low_expected_comm_est_per_second: expectedCommEst * lowSuccessChance / time,
      avg_expected_comm_est_per_second: expectedCommEst * avgSuccessChance / time,
      high_expected_comm_est_per_second: expectedCommEst * highSuccessChance / time,

      team_gain: teamGain,
      low_expected_team_gain_per_second: teamGain * lowSuccessChance / time,
      avg_expected_team_gain_per_second: teamGain * avgSuccessChance / time,
      high_expected_team_gain_per_second: teamGain * highSuccessChance / time,

      chaos_mult: chaosMult,
    }};
  });
};

const getGeneralActions = (ns) => {
  return [
    {type: "general", name: "Training"},
    {type: "general", name: "Recruitment"},
    {type: "general", name: "Hyperbolic Regeneration Chamber"},
  ].concat(addCitiesToActions(ns, [
    {type: "general", name: "Field Analysis"},
    {type: "general", name: "Diplomacy"},
  ]))
};


const getNextBlackOperation = (ns) => {
  let nextOpName = ns.bladeburner.getBlackOpNames().find(blackOpName =>
    ns.bladeburner.getActionCountRemaining("black operation", blackOpName));
  if (nextOpName) {
    return {
      type: "black operation",
      name: nextOpName,
    };
  }
};

const getBlackOps = (ns) =>
  ns.bladeburner.getBlackOpNames().map(blackOpName => ({
    type: "black operation",
    name: blackOpName,
  }));

const getAllAnnotatedActions = (ns) => {
  setAllAutolevel(ns, false);
  return annotateActions(ns, addCitiesToActions(ns,
      getAllLevelsOfLeveledActions(ns).concat(getNextBlackOperation(ns)))
    .concat(getGeneralActions(ns)));
};

const switchCityAndLevelToAction = (ns, action) => {
  if (action.city && ns.bladeburner.getCity() != action.city)
    ns.bladeburner.switchCity(action.city);
  if (action.level && ns.bladeburner.getActionCurrentLevel(action.type, action.name) != action.level)
    ns.bladeburner.setActionLevel(action.type, action.name, action.level);
};

const getCityMaxEstimateRangeMap = (ns, actions) => {
  let rangeMap = Object.fromEntries(bladeburner_city_names.map(city => [city, 0]));
  actions.forEach(action => {
    if (action.city && rangeMap[action.city] < action.success_chance_range) {
      rangeMap[action.city] = action.success_chance_range;
    }
  });
  return rangeMap;
};

const printActions = (ns, actions, attributeFn, secondaryGoal) => {
  let maxCityNameLength =
    Math.max(...bladeburner_city_names.map(cityName => cityName.length));
  let maxNameLength =
    Math.max(...actions.map(action => (action.name || "").length))
  ns.tprint(actions.map(action =>
    `\n${(action.city ? action.city : "").padStart(maxCityNameLength)
    } l:${(action.level ? action.level.toString() : "1").padStart(2)
    } ${action.name.substring(0,15).padStart(maxNameLength)
    } time: ${action.time.toString().padStart(2)
    } %:${[
      action.low_success_chance,
      action.avg_success_chance,
      action.high_success_chance,
      ].map(chance => ns.nFormat(chance, ".000")).join('/')
    } ${attributeFn(ns, action, secondaryGoal)}`).join(''));
};

const minRankGainedByGettingToDaedalus = (ns) =>
  ns.bladeburner.getBlackOpNames()
    .filter(name => ns.bladeburner.getActionCountRemaining("black operation", name))
    .filter(name => name != "Operation Daedalus")
    .map(name => ns.bladeburner.getActionRepGain("black operation", name))
    .reduce((result, next) => result + next, 0) * 1.1;

export async function main(ns) {
  let flags = ns.flags([
    ["debug", false],
    ["money", false],
    ["top-actions", 20],
  ]);

  killOtherInstances(ns);

  while (true) {
    let [stamina, maxStamina] = ns.bladeburner.getStamina();
    let actions = getAllAnnotatedActions(ns);
    let cityMaxEstimateRangeMap = getCityMaxEstimateRangeMap(ns, actions);
    let maxCityRangeEntry = Object.entries(cityMaxEstimateRangeMap)
      .reduce((result, next) => result[1] > next[1] ? result : next);
    let lowEstimateCity = maxCityRangeEntry[1] > estimate_threshold ?
      maxCityRangeEntry[0] : "";
    let chaosCity = bladeburner_city_names.find(city =>
        ns.bladeburner.getCityChaos(city) > 50 &&
        actions.filter(action => action.city == city)
          .filter(action => action.type != "black operation")
          .find(action => action.high_success_chance < 1
            && !action.low_success_chance == 0)
    );

    let goalName = goals.RANK.name;
    let secondaryGoalName;
    let goalCity;

    if (flags.money) {
      goalName = goals.MONEY.name;
    }
    if (chaosCity) {
      goalName = goals.CHAOS.name;
      goalCity = chaosCity;
    }
    if (lowEstimateCity) {
      goalName = goals.ESTIMATE.name;
      goalCity = lowEstimateCity;
    }
    if (chaosCity && lowEstimateCity) {
      if (Math.random() < .5) {
        goalName = goals.ESTIMATE.name;
        goalCity = lowEstimateCity;
      } else {
        goalName = goals.CHAOS.name;
        goalCity = chaosCity;
      }
    }
    if (flags.debug) {
      ns.tprint(`rankFromOps: ${minRankGainedByGettingToDaedalus(ns)
      }, rank: ${ns.bladeburner.getRank()
      }, totalExpected: ${minRankGainedByGettingToDaedalus(ns) + ns.bladeburner.getRank()
      }, daedalus req: ${ns.bladeburner.getBlackOpRank("Operation Daedalus")}`);
    }
    if (minRankGainedByGettingToDaedalus(ns) + ns.bladeburner.getRank() >
      ns.bladeburner.getBlackOpRank("Operation Daedalus")) {
        goalName = goals.BLACKOPS.name;
        goalCity = "";
    }
    if (stamina < maxStamina * .5) {
      secondaryGoalName = goalName;
      goalName = goals.STAMINALOW.name;
    } else if (stamina < maxStamina * .75) {
      secondaryGoalName = goalName;
      goalName = goals.STAMINA.name;
    }

    let nextAction = {};

    if (flags.debug) {
      ns.tprint(`primary goal: ${goalName
      }${secondaryGoalName ? `, secondary goal: ${secondaryGoalName}`: ``
      }${goalCity ? `, goal city: ${goalCity}`: ``}`);
    }

    let goalDict = goals[goalName];
    let secondGoalDict = goals[secondaryGoalName];

    let filteredActions = actions;
    if (goalDict.filter) {
      filteredActions = filteredActions.filter(action =>
        goalDict.filter(action, goalCity));
    }
    if (secondGoalDict && secondGoalDict.filter) {
      filteredActions = filteredActions.filter(action =>
        secondGoalDict.filter(action, goalCity));
    }
    filteredActions = filteredActions.filter(action => action.count > 0)
      .filter(action => !action.required_rank || action.required_rank <= ns.bladeburner.getRank());

    // remove raids for cities with no communities
    let noRaidCities = bladeburner_city_names.map(cityName => ({
        city: cityName,
        estimated_communities: ns.bladeburner.getCityEstimatedCommunities(cityName)
      })).filter(cityDict => cityDict.estimated_communities <= 0)
      .map(cityDict => cityDict.city);
    filteredActions = filteredActions.filter(action =>
      !(action.name == "Raid" && noRaidCities.includes(action.city)));

    ns.print(JSON.stringify(filteredActions, null, 2));
    if (!filteredActions.length) {
      // no possible actions due to count, waiting for more by training
      nextAction = {type: "general", name: "Training"};
    } else {
      if (flags.debug) {
        let topActions = filteredActions.sort((a, b) =>
          goalDict.valueToMaxFunction(b, secondGoalDict) -
          goalDict.valueToMaxFunction(a, secondGoalDict))
          .filter((action, index) => index < flags["top-actions"]);
        printActions(ns, topActions, goalDict.debugStringFunction, secondGoalDict);
      }
      nextAction = filteredActions.reduce((result, next) =>
        goalDict.valueToMaxFunction(result, secondGoalDict) >
        goalDict.valueToMaxFunction(next, secondGoalDict) ?
          result : next);
    }

    switchCityAndLevelToAction(ns, nextAction);
    let currentAction = ns.bladeburner.getCurrentAction();
    if (!ns.isBusy() && !(currentAction.type == nextAction.type
        && currantAction.name == nextAction.name)) {
      ns.bladeburner.startAction(nextAction.type, nextAction.name);
      let timeToSleep = actionTimeWithBonus(ns, nextAction) * 1000;
      await ns.sleep(Math.max(100, timeToSleep));
    } else {
      await ns.sleep(10 * 1000);
    }
    await upgradeSkills(ns);
  }
}
