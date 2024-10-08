import { runCallbackExit } from "common.js"
import { exp_types, travel_cost, city_names } from "constants.js"

const game_cycles_per_second = 5;

let skill_options = {
  all: ["hacking", "strength", "defense", "dexterity", "agility", "charisma"],
  combat: ["strength", "defense", "dexterity", "agility"],
  uni: ["hacking", "charisma"],
  hackdef: ["hacking", "defense"],
  hacking: ["hacking"],
  strength: ["strength"],
  defense: ["defense"],
  dexterity: ["dexterity"],
  agility: ["agility"],
  charisma: ["charisma"],
};

let player_skill_name_lambda = (skill) => skill == "hacking" ? "hacking_skill" : skill;

let uni_classes = {
  "Study Computer Science":{
    base_cost: 0,
    base_hacking_exp: 0.5,
  },
  "Data Strucures":{
    base_cost: 40,
    base_hacking_exp: 1,
  },
  "Networks":{
    base_cost: 80,
    base_hacking_exp: 2,
  },
  "Algorithms":{
    base_cost: 320,
    base_hacking_exp: 4,
  },
  "Management":{
    base_cost: 160,
    base_charisma_exp: 2,
  },
  "Leadership":{
    base_cost: 320,
    base_charisma_exp: 4,
  },
};

let gym_classes = {
  "strength": {
    base_cost: 320,
    base_strength_exp: 4,
  },
  "defense": {
    base_cost: 320,
    base_defense_exp: 4,
  },
  "dexterity": {
    base_cost: 320,
    base_dexterity_exp: 4,
  },
  "agility": {
    base_cost: 320,
    base_agility_exp: 4,
  },
};

let uni_locations = {
  "Summit University": {
    city: "Aevum",
    cost_mult: 4,
    exp_mult: 3,
  },
  "Rothman University": {
    city: "Sector-12",
    cost_mult: 3,
    exp_mult: 2,
  },
  "ZB Institute Of Technology": {
    city: "Volhaven",
    cost_mult: 5,
    exp_mult: 4,
  },
};

let gym_locations = {
  "Crush Fitness Gym": {
    city: "Aevum",
    cost_mult: 3,
    exp_mult: 2,
  },
  "Snap Fitness Gym": {
    city: "Aevum",
    cost_mult: 10,
    exp_mult: 5,
  },
  "Iron Gym": {
    city: "Sector-12",
    cost_mult: 1,
    exp_mult: 1,
  },
  "Powerhouse Gym": {
    city: "Sector-12",
    cost_mult: 20,
    exp_mult: 10,
  },
  "Millenium Fitness Gym": {
    city: "Volhaven",
    cost_mult: 7,
    exp_mult: 4,
  },
};

let EPSILON_SLEEP = 5000;

function buildClassEntry(ns, classInfoEntry, locationInfoEntry, classType) {
  let returnClass = {};
  let className = classInfoEntry[0];
  let locationName = locationInfoEntry[0];
  let classInfo = classInfoEntry[1];
  let locationInfo = locationInfoEntry[1];
  exp_types.forEach(expType => {
    let expBase = classInfo["base_" + expType] || 0;
    returnClass[expType] = expBase * locationInfo.exp_mult / game_cycles_per_second; // * hash mult
    returnClass[expType + '_per_millisecond'] = returnClass[expType] / 200;
    returnClass.cost = classInfo.base_cost * locationInfo.cost_mult / game_cycles_per_second;
    returnClass.time = -1; // continuous
    returnClass.city = locationInfo.city;
    returnClass.class_name = className;
    returnClass.location_name = locationName;
    returnClass.travel_cost = returnClass.city != ns.getPlayer().city ? travel_cost : 0;
    returnClass.class_type = classType;
  });
  let combinedName = [locationName, className].join(" ");
  return [combinedName, returnClass];
}

function getTrainingClasses(ns, noTravel, city) {
  let trainingClasses = [];

  Object.entries(uni_classes).forEach(uniClassEntry => {
    Object.entries(uni_locations).forEach(uniLocationEntry => {
      let trainingClassEntry = buildClassEntry(ns, uniClassEntry, uniLocationEntry, "uni");
      trainingClasses.push(trainingClassEntry);
    })
  });
  Object.entries(gym_classes).forEach(gymClassEntry => {
    Object.entries(gym_locations).forEach(gymLocationEntry => {
      let trainingClassEntry = buildClassEntry(ns, gymClassEntry, gymLocationEntry, "gym");
      trainingClasses.push(trainingClassEntry);
    })
  });

  if (noTravel) {
    trainingClasses = trainingClasses.filter(classEntry => classEntry[1].travel_cost == 0);
  }

  if (city) {
    trainingClasses = trainingClasses.filter(classEntry => classEntry[1].city == city);
  }

  let possibleClasses = Object.fromEntries(trainingClasses);
  //ns.tprint("possible classes" + JSON.stringify(possibleClasses, null, 2));
  return possibleClasses;
}

function getFastestClassForSkill(ns, skill, noTravel, city) {
  return Object.entries(getTrainingClasses(ns, noTravel, city))
    .filter(classEntry => classEntry[1][`${skill}_exp_per_millisecond`])
    .reduce((result, next) => result[1][`${skill}_exp_per_millisecond`] >
      next[1][`${skill}_exp_per_millisecond`] ? result : next);
}

function startClassFromClassEntry(ns, classEntry) {
  let classData = classEntry[1];
  let classType = classData.class_type;
  let player = ns.getPlayer();
  let correctLocation = true;
  if (classData.city != player.city) {
    correctLocation = ns.travelToCity(classData.city)
    if (!correctLocation) {
      throw new Error(`unable to get to ${classData.city}, currently in ${player.city}`);
    }
  }
  if (classType == "uni") {
    ns.universityCourse(classData.location_name, classData.class_name);
  } else if (classType == "gym") {
    ns.gymWorkout(classData.location_name, classData.class_name);
  } else {
    throw new Error("Internal error, class type not determined");
  }
}

function usage(ns) {
  ns.tprint(`Usage: run training.js [--skill] &lt${Object.keys(skill_options)}&gt [--city &ltcity&gt] [--no-travel] [--target-level &ltlevel&gt] [--time &ltmilliseconds&gt]`);
}

export async function main(ns) {
  let flag_data = ns.flags([
    ["skill", ""],
    ["callback", ""],
    ["no-travel", false],
    ["city", ""],
    ["target-level", 0],
    ["time", 0],
    ["help", false],
    ["switch-time", 30000],
    ["equal-time", false],
    ["tail", false],
  ]);

  let skillOption = flag_data.skill || flag_data._[0];
  let callback = flag_data.callback || flag_data._[1];
  let player = ns.getPlayer();
  let city = flag_data.city;
  let noTravel = flag_data["no-travel"];
  let time = flag_data.time;
  let switchTime = flag_data["switch-time"];
  let targetLevel = flag_data["target-level"];
  let equalTime = flag_data["equal-time"];

  if (!skillOption || flag_data.help) {
    usage(ns);
    runCallbackExit(ns, callback);
  }

  if (!Object.keys(skill_options).includes(skillOption)) {
    ns.tprint(`Skill: ${skillOption} is not a valid skill name for this script. accepted values are ${Object.keys(skill_options)}`);
    runCallbackExit(ns, callback);
  }

  if (city && !city_names.includes(city)) {
    ns.tprint(`City: ${city} is not a valid city. exiting...`);
    runCallbackExit(ns, callback);
  }

  if (targetLevel && targetLevel < 0) {
    ns.tprint(`target level (${targetLevel}) must be positive. exiting...`);
    runCallbackExit(ns, callback);
  }

  if (time && time < 0) {
    ns.tprint(`time (${time}) must be a positive amount of milliseconds. exiting...`);
    runCallbackExit(ns, callback);
  }

  if (switchTime <= 0) {
    ns.tprint(`switch time (${switchTime}) must be a positive amount of milliseconds. exiting...`);
    runCallbackExit(ns, callback);
  }

  if (flag_data.tail) {
    ns.tail();
  }

  let skills = skill_options[skillOption];
  let skill;
  let scriptStartTime = performance.now();
  let counter = 0;

  while (true) {
    player = ns.getPlayer();
    let pertinentPlayerSkillEntries = skills.map(skill => [skill, player[player_skill_name_lambda(skill)]]);
    // remove skills who have been sufficiently leveled
    if (targetLevel) {
      pertinentPlayerSkillEntries = pertinentPlayerSkillEntries.filter(skillEntry => skillEntry[1] < targetLevel);
      if (!pertinentPlayerSkillEntries.length) {
        ns.tprint(`Finished training ${skillOption}: [${skill_options[skillOption]}] to ${targetLevel}`);
        ns.stopAction();
        runCallbackExit(ns, callback);
        break;
      }
    }

    let skill;
    if (equalTime) {
      // round robin
      skill = pertinentPlayerSkillEntries[counter % pertinentPlayerSkillEntries.length][0];
    } else {
      // select lowest
      skill = pertinentPlayerSkillEntries.reduce((result, next) => next[1] < result[1] ? next : result)[0];
    }
    ns.print(`skill to train; ${skill}`);
    let startTime = performance.now();
    startClassFromClassEntry(ns, getFastestClassForSkill(ns, skill, noTravel, city));
    if (switchTime && pertinentPlayerSkillEntries.length > 1) {
      while (ns.isBusy()) {
        await ns.sleep(EPSILON_SLEEP);
        if (performance.now() - startTime > switchTime) {
          break;
        }
        if (time && performance.now() - scriptStartTime > time) {
          ns.stopAction();
          runCallbackExit(ns, callback);
        }
      }
    } else {
      while (ns.isBusy()) {
        await ns.sleep(EPSILON_SLEEP);
        if (performance.now() - startTime > switchTime) {
          break;
        }
        if (time && performance.now() - scriptStartTime > time) {
          ns.stopAction();
          runCallbackExit(ns, callback);
        }
      }
    }
    counter++;
  }
}
