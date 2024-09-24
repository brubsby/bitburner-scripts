import { killOtherInstances, getItem, setItem } from 'common.js'
import { travel_cost } from 'constants.js'
import { factions, companies_with_factions } from 'factions.js'

export const sleeve_keys = {
	SLEEVE_TASKS: "BB_SLEEVE_TASKS",
};

const city_gym_map = {
	"Sector-12": "Powerhouse Gym",
	"Volhaven": "Millenium Fitness Gym",
	"Aevum": "Snap Fitness Gym",
}

const city_uni_map = {
	"Sector-12": "Rothman University",
	"Volhaven": "ZB Institute Of Technology",
	"Aevum": "Summit University",
}

const skill_course_map = {
	"hacking": "Algorithms",
	"charisma": "Leadership",
}

const skill_crime_map = {
	"hacking": "RobStore",
	"charisma": "DealDrugs",
}

const lowestPlayerCombatSkill = (player) => [
	["strength", player.strength],
	["defense", player.defense],
	["dexterity", player.dexterity],
	["agility", player.agility],
].reduce((result, next) => next[1] < result[1] ? next : result)[0];

const lowestPlayerUniSkill = (player) => [
	["hacking", player.hacking_skill],
	["charisma", player.charisma],
].reduce((result, next) => next[1] < result[1] ? next : result)[0];

const getSleeves = (ns) =>
	[...Array(ns.sleeve.getNumSleeves()).keys()].map(index => ({
		...js.sleeve.getSleeveStats(index),
		...js.sleeve.getInformation(index),
		...{task: ns.sleeve.getTask()},
		...{index: index},
	}));

let print_tasks = false;
let sleeveTasks = getItem(sleeve_keys.SLEEVE_TASKS) || [];

export async function main(ns) {
	let flags = ns.flags([]);

	if (ns.ps(ns.getHostname()).filter(server =>
      server.filename == ns.getScriptName()).length > 1) {
    print_tasks = true;
    if (!flags._ || !flags._.length) {
      ns.exit();
      return;
    }
  }

  killOtherInstances(ns);

	if (flags._ && flags._.length) {
		sleeveTasks = flags._;
		setItem(sleeve_keys.SLEEVE_TASKS, sleeveTasks);
	}

	while (true) {
		let sleeves = getSleeves(ns);
		sleeves.sort((a, b) => b.sync - a.sync || a.shock - b.shock);

		//allow other scripts to control this one for no ram cost
		let localStorageSleeveTasks = getItem(sleeve_keys.SLEEVE_TASKS);
		if (localStorageSleeveTasks && localStorageSleeveTasks.length) {
			sleeveTasks = localStorageSleeveTasks;
		}

		sleeves.forEach((sleeve, index) => {
			let sleeveTask = sleeveTasks[index] ?
				sleeveTasks[index].toLowerCase() : undefined;
			if (sleeveTask) {
				switch (sleeveTask) {
					case 'strength':
					case 'str':
					case 'defense':
					case 'def':
					case 'dexterity':
					case 'dex':
					case 'agility':
					case 'agi':
					case 'combat':
					case 'gym': {
						let player = ns.getPlayer();
						let skill = sleeveTask;
						if (skill == 'combat') {
							skill = lowestPlayerCombatSkill(player);
						}
						if (sleeve.city == "Sector-12") {
							ns.sleeve.setToGymWorkout(sleeve.index, "Powerhouse Gym", skill);
						} else {
							if (player.money > travel_cost) {
								ns.sleeve.travel(sleeve.index, "Sector-12");
								ns.sleeve.setToGymWorkout(sleeve.index, "Powerhouse Gym", skill);
							} else {
								// workout at current city if possible and poor
								if (Object.keys(city_gym_map).includes(sleeve.city)) {
									ns.sleeve.setToGymWorkout(sleeve.index, city_gym_map[sleeve.city], skill);
								} else {
									//no gym in this city and too poor to move, mug until next time (best combat xp)
									if (!sleeve.task.crime || !sleeve.task.crime == skill_crime_map[skill])
										ns.sleeve.setToCommitCrime(sleeve.index, "Mug");
								}
							}
						}
					} break;

					case 'hacking':
					case 'hack':
					case 'charisma':
					case 'cha':
					case 'university':
					case 'uni': {
						let player = ns.getPlayer();
						let skill = sleeveTask;
						if (skill == 'uni' || skill == 'university') {
							skill = lowestPlayerUniSkill(player);
						}
						let course = skill_course_map[skill];
						if (sleeve.city == "Volhaven") {
							ns.sleeve.setToUniversityCourse(sleeve.index, "ZB Institute Of Technology", course);
						} else {
							if (player.money > travel_cost) {
								ns.sleeve.travel(sleeve.index, "Volhaven");
								ns.sleeve.setToUniversityCourse(sleeve.index, "ZB Institute Of Technology", course);
							} else {
								// study at current city if possible and poor
								if (Object.keys(city_gym_map).includes(sleeve.city)) {
									ns.sleeve.setToUniversityCourse(sleeve.index, city_uni_map[sleeve.city], course);
								} else {
									//no uni in this city and too poor to move, crime until next time
									if (!sleeve.task.crime || !sleeve.task.crime == skill_crime_map[skill])
										ns.sleeve.setToCommitCrime(sleeve.index, skill_crime_map[skill]);
								}
							}
						}
					} break;

					default:
						if (companies_with_factions.includes()) {

						} else {
							ns.tprint(`unknown task: ${sleeveTask}`);
							if (sleeve.sync < 100) {
								ns.sleeve.setToSynchronize(sleeve.index);
							} else if (sleeve.shock > 0) {
								ns.sleeve.setToShockRecovery(sleeve.index);
							} else {
								if (!sleeve.task.crime || !sleeve.task.crime == "Homicide")
									ns.sleeve.setToCommitCrime(sleeve.index, "Homicide");
							}
						}
				}
			}
		});
		await ns.sleep(30000);
	}
}
