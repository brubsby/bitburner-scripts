import { getBitNodeMultipliers } from "bitNodeMultipliers.js";
import { parseLargeNumberString } from "common.js";

export const infiltration_locations = {
  "AevumAeroCorp" : {
    city: "Aevum",
    max_clearance_level: 12,
    starting_security_level: 8.18,
  },
  "AevumBachmanAndAssociates" : {
    city: "Aevum",
    max_clearance_level: 15,
    starting_security_level: 8.19,
  },
  "AevumClarkeIncorporated" : {
    city: "Aevum",
    max_clearance_level: 18,
    starting_security_level: 9.55,
  },
  "AevumECorp" : {
    city: "Aevum",
    max_clearance_level: 37,
    starting_security_level: 17.02,
  },
  "AevumFulcrumTechnologies" : {
    city: "Aevum",
    max_clearance_level: 25,
    starting_security_level: 15.54,
  },
  "AevumGalacticCybersystems" : {
    city: "Aevum",
    max_clearance_level: 12,
    starting_security_level: 7.89,
  },
  "AevumNetLinkTechnologies" : {
    city: "Aevum",
    max_clearance_level: 6,
    starting_security_level: 3.29,
  },
  "AevumPolice" : {
    city: "Aevum",
    max_clearance_level: 6,
    starting_security_level: 5.35,
  },
  "AevumRhoConstruction" : {
    city: "Aevum",
    max_clearance_level: 5,
    starting_security_level: 5.02,
  },
  "AevumWatchdogSecurity" : {
    city: "Aevum",
    max_clearance_level: 7,
    starting_security_level: 5.85,
  },
  "ChongqingKuaiGongInternational" : {
    city: "Chongqing",
    max_clearance_level: 25,
    starting_security_level: 16.25,
  },
  "ChongqingSolarisSpaceSystems" : {
    city: "Chongqing",
    max_clearance_level: 18,
    starting_security_level: 12.59,
  },
  "IshimaNovaMedical" : {
    city: "Ishima",
    max_clearance_level: 12,
    starting_security_level: 5.02,
  },
  "IshimaOmegaSoftware" : {
    city: "Ishima",
    max_clearance_level: 10,
    starting_security_level: 3.2,
  },
  "IshimaStormTechnologies" : {
    city: "Ishima",
    max_clearance_level: 25,
    starting_security_level: 5.38,
  },
  "NewTokyoDefComm" : {
    city: "New Tokyo",
    max_clearance_level: 17,
    starting_security_level: 7.18,
  },
  "NewTokyoGlobalPharmaceuticals" : {
    city: "New Tokyo",
    max_clearance_level: 20,
    starting_security_level: 5.9,
  },
  "NewTokyoNoodleBar" : {
    city: "New Tokyo",
    max_clearance_level: 5,
    starting_security_level: 2.5,
  },
  "NewTokyoVitaLife" : {
    city: "New Tokyo",
    max_clearance_level: 25,
    starting_security_level: 5.52,
  },
  "Sector12AlphaEnterprises" : {
    city: "Sector-12",
    max_clearance_level: 10,
    starting_security_level: 3.62,
  },
  "Sector12BladeIndustries" : {
    city: "Sector-12",
    max_clearance_level: 25,
    starting_security_level: 10.59,
  },
  "Sector12CarmichaelSecurity" : {
    city: "Sector-12",
    max_clearance_level: 15,
    starting_security_level: 4.66,
  },
  "Sector12DeltaOne" : {
    city: "Sector-12",
    max_clearance_level: 12,
    starting_security_level: 5.9,
  },
  "Sector12FourSigma" : {
    city: "Sector-12",
    max_clearance_level: 25,
    starting_security_level: 8.18,
  },
  "Sector12IcarusMicrosystems" : {
    city: "Sector-12",
    max_clearance_level: 17,
    starting_security_level: 6.02,
  },
  "Sector12JoesGuns" : {
    city: "Sector-12",
    max_clearance_level: 5,
    starting_security_level: 3.13,
  },
  "Sector12MegaCorp" : {
    city: "Sector-12",
    max_clearance_level: 31,
    starting_security_level: 16.36,
  },
  "Sector12UniversalEnergy" : {
    city: "Sector-12",
    max_clearance_level: 12,
    starting_security_level: 5.9,
  },
  "VolhavenCompuTek" : {
    city: "Volhaven",
    max_clearance_level: 15,
    starting_security_level: 3.59,
  },
  "VolhavenHeliosLabs" : {
    city: "Volhaven",
    max_clearance_level: 18,
    starting_security_level: 7.28,
  },
  "VolhavenLexoCorp" : {
    city: "Volhaven",
    max_clearance_level: 15,
    starting_security_level: 4.35,
  },
  "VolhavenNWO" : {
    city: "Volhaven",
    max_clearance_level: 50,
    starting_security_level: 8.53,
  },
  "VolhavenOmniTekIncorporated" : {
    city: "Volhaven",
    max_clearance_level: 25,
    starting_security_level: 7.74,
  },
  "VolhavenOmniaCybersystems" : {
    city: "Volhaven",
    max_clearance_level: 22,
    starting_security_level: 6,
  },
  "VolhavenSysCoreSecurities" : {
    city: "Volhaven",
    max_clearance_level: 18,
    starting_security_level: 4.77,
  },
};

const infiltrationDifficulty = (ns, infiltrationLocationEntry, player) =>
  Math.max(0,
    Math.min(3,
      infiltrationLocationEntry[1].starting_security_level -
      (Math.pow(player.strength + player.defense + player.dexterity + player.agility + player.charisma, 0.9) / 250) -
      player.intelligence / 1600
    )
  );

const infiltrationRepGain = (ns, infiltrationLocationEntry, player) =>
  Math.pow(infiltrationDifficulty(ns, infiltrationLocationEntry, player)+1, 1.1) *
  Math.pow(infiltrationLocationEntry[1].starting_security_level, 1.2) * 30 *
  (infiltrationLocationEntry[1].max_clearance_level *
    Math.pow(1.01, infiltrationLocationEntry[1].max_clearance_level))
  * getBitNodeMultipliers().InfiltrationRep;

const infiltrationMoneyGain = (ns, infiltrationLocationEntry, player) =>
  Math.pow(infiltrationDifficulty(ns, infiltrationLocationEntry, player)+1, 2) *
  Math.pow(infiltrationLocationEntry[1].starting_security_level, 3) * 3e3 *
  (infiltrationLocationEntry[1].max_clearance_level *
    Math.pow(1.01, infiltrationLocationEntry[1].max_clearance_level))
  * getBitNodeMultipliers().InfiltrationMoney;

const infiltrationDamage = (infiltrationLocationEntry) => infiltrationLocationEntry[1].starting_security_level * 3;

const defenseToHP = (defense) => Math.floor(10 + defense / 10);

const minDefenseToSurviveDamage = (damage) => Math.max(0, Math.ceil(damage + 0.01 - 10)*10)

const locationEntriesToString = (ns, locationEntries) =>
  `[\n${locationEntries.map(locationEntry => ` [def:${
        ns.nFormat(locationEntry[1].defense_required,'0').padStart(4)}, rep/f:${
          ns.nFormat(locationEntry[1].rep_gain_per_floor,'0').padStart(5)}, rep:${
            ns.nFormat(locationEntry[1].rep_gain,'0.00a').padStart(7)}, $/f:${
              ns.nFormat(locationEntry[1].money_gain_per_floor,'0.00a').padStart(7)}, ${
                ns.nFormat(locationEntry[1].money_gain,'$0.00a').padStart(8)}, flrs:${
              ns.nFormat(locationEntry[1].max_clearance_level,'0').padStart(3)}, d:${
                ns.nFormat(locationEntry[1].difficulty, "0.0")}, ${
              locationEntry[0]
            }]`).join(',\n')}\n]`

export async function main(ns) {
  let flags = ns.flags([
    ["money", ""],
    ["rep", ""],
  ])

  let rep = parseLargeNumberString(flags.rep);
  let money = parseLargeNumberString(flags.money);

  let metricToOptimize = "rep_gain_per_floor";
  let optimizationDirection = 1;
  if (rep || money) {
    ns.tprint(`rep: ${rep}, money: ${money}`)
    metricToOptimize = "max_clearance_level";
    optimizationDirection = -1;
  }
  let player = ns.getPlayer();
  let sortedInfiltrationsByRep = Object.entries(infiltration_locations)
    .map(infiltrationLocationEntry =>
      [
        infiltrationLocationEntry[0],
        {
          ...infiltrationLocationEntry[1],
          ...{difficulty: infiltrationDifficulty(ns, infiltrationLocationEntry, player)},
          ...{rep_gain: infiltrationRepGain(ns, infiltrationLocationEntry, player)},
          ...{rep_gain_per_floor: infiltrationRepGain(ns, infiltrationLocationEntry, player) / infiltrationLocationEntry[1].max_clearance_level},
          ...{money_gain: infiltrationMoneyGain(ns, infiltrationLocationEntry, player)},
          ...{money_gain_per_floor: infiltrationMoneyGain(ns, infiltrationLocationEntry, player) / infiltrationLocationEntry[1].max_clearance_level},
          ...{damage: infiltrationDamage(infiltrationLocationEntry)},
          ...{defense_required: minDefenseToSurviveDamage(infiltrationDamage(infiltrationLocationEntry))}
        },
      ]
    ).sort((a,b) => optimizationDirection *
      (b[1][metricToOptimize]-a[1][metricToOptimize]));
  let sortedSurvivableInfiltrationsByRep = sortedInfiltrationsByRep
    .filter(infiltrationLocationEntry =>
      infiltrationLocationEntry[1].damage < ns.getPlayer().max_hp);

  if (money) {
    sortedSurvivableInfiltrationsByRep = sortedSurvivableInfiltrationsByRep
      .filter(infiltrationLocationEntry =>
        infiltrationLocationEntry[1].money_gain >= money)
    if (!sortedSurvivableInfiltrationsByRep.length) {
      ns.tprint(`No survivable infiltrations found that give over ${ns.nFormat(money, "$0.000a")}. Exiting...`);
      ns.exit();
      return;
    }
  }
  if (rep) {
    sortedSurvivableInfiltrationsByRep = sortedSurvivableInfiltrationsByRep
      .filter(infiltrationLocationEntry =>
        infiltrationLocationEntry[1].rep_gain >= rep)
    if (!sortedSurvivableInfiltrationsByRep.length) {
      ns.tprint(`No survivable infiltrations found that give over ${ns.nFormat(rep, "0.000a")} rep. Exiting...`);
      ns.exit();
      return;
    }
  }


  let bestCurrentLocationEntry = sortedSurvivableInfiltrationsByRep[0];


  let sortedUnsurvivableInfiltrationsByRep = sortedInfiltrationsByRep
    .filter(infiltrationLocationEntry =>
      infiltrationLocationEntry[1].damage >= ns.getPlayer().max_hp)
    //create hypothetical players for these defense levels
    .map(infiltrationLocationEntry => {
      let defenseRequired = minDefenseToSurviveDamage(infiltrationDamage(infiltrationLocationEntry));
      let hypotheticalPlayer = {
        ...player,
        ...{defense: defenseRequired}
      };
      let difficulty = infiltrationDifficulty(ns, infiltrationLocationEntry, hypotheticalPlayer);
      let repGain = infiltrationRepGain(ns, infiltrationLocationEntry, hypotheticalPlayer);
      let moneyGain = infiltrationMoneyGain(ns, infiltrationLocationEntry, hypotheticalPlayer)
      return [infiltrationLocationEntry[0],
      {
        ...infiltrationLocationEntry[1],
        ...{difficulty: difficulty},
        ...{rep_gain: repGain},
        ...{rep_gain_per_floor: repGain / infiltrationLocationEntry[1].max_clearance_level},
        ...{money_gain: moneyGain},
        ...{money_gain_per_floor: moneyGain / infiltrationLocationEntry[1].max_clearance_level},
        ...{damage: infiltrationDamage(infiltrationLocationEntry)},
        ...{defense_required: defenseRequired}
      },
    ]});

  let locationMilestonesForDefenseLevels = [...sortedUnsurvivableInfiltrationsByRep]
    .sort((a,b) => a[1].defense_required-b[1].defense_required)
    .reduce((result, next) => {
      if ((!result.length && bestCurrentLocationEntry[1][metricToOptimize] < next[1][metricToOptimize]) ||
        (result.length && result[result.length-1][1][metricToOptimize] < next[1][metricToOptimize])) {
        result.push(next);
      }
      return result;
    }, []);
  ns.tprint(`Top Locations where you can survive a failure: ${locationEntriesToString(ns, sortedSurvivableInfiltrationsByRep)}`);
  ns.tprint(`Best location to infiltrate: ${bestCurrentLocationEntry[0]} for ${
    ns.nFormat(bestCurrentLocationEntry[1].rep_gain, "0.000a")} total rep, ${
      ns.nFormat(bestCurrentLocationEntry[1].rep_gain_per_floor, "0.000a")} rep per floor, ${
        ns.nFormat(bestCurrentLocationEntry[1].money_gain, "$0.000a")}, ${
          ns.nFormat(bestCurrentLocationEntry[1].money_gain_per_floor, "$0.000a")} per floor, and ${
        bestCurrentLocationEntry[1].damage} damage per hit.`)
  ns.tprint(`Better locations and their defense levels: ${locationEntriesToString(ns, locationMilestonesForDefenseLevels)}`)


}
