import { getBitNodeMultipliers } from "bitNodeMultipliers.js"
import { getDetailedPlayerData } from "common.js"

export const factions = {
  "Illuminati": {
    short_name: "Illuminati",
    requirements: {
      augmentations: 30,
      money: 150000000000,
      hacking: 1500,
      strength: 1200,
      defense: 1200,
      dexterity: 1200,
      agility: 1200,
    },
  },
  "Daedalus": {
    short_name: "Daedalus",
    requirements: {
      augmentations: 30 * getBitNodeMultipliers().DaedalusAugsRequirement,
      money: 100000000000,
      hacking: 2500,
      strength: 1500,
      defense: 1500,
      dexterity: 1500,
      agility: 1500,
      hacking_combat_or: true,
    },
  },
  "The Covenant": {
    short_name: "Covenant",
    requirements: {
      augmentations: 20,
      money: 75000000000,
      hacking: 850,
      strength: 850,
      defense: 850,
      dexterity: 850,
      agility: 850,
    },
  },
  // also needs to be employed in the corps
  "ECorp": {
    short_name: "ECorp",
    requirements: {
      company_name: "ECorp",
      company_rep: 200e3,
    },
  },
  "MegaCorp": {
    short_name: "MegaCorp",
    requirements: {
      company_name: "MegaCorp",
      company_rep: 200e3,
    },
  },
  "Bachman & Associates": {
    short_name: "B&A",
    requirements: {
      company_name: "Bachman & Associates",
      company_rep: 200e3,
    },
  },
  "Blade Industries": {
    short_name: "Blade",
    requirements: {
      company_name: "Blade Industries",
      company_rep: 200e3,
    },
  },
  "NWO": {
    short_name: "NWO",
    requirements: {
      company_name: "NWO",
      company_rep: 200e3,
    },
  },
  "Clarke Incorporated": {
    short_name: "Clarke",
    requirements: {
      company_name: "Clarke Incorporated",
      company_rep: 200e3,
    },
  },
  "OmniTek Incorporated": {
    short_name: "OmniTek",
    requirements: {
      company_name: "OmniTek Incorporated",
      company_rep: 200e3,
    },
  },
  "Four Sigma": {
    short_name: "4Sigma",
    requirements: {
      company_name: "Four Sigma",
      company_rep: 200e3,
    },
  },
  "KuaiGong International": {
    short_name: "KuaiGong",
    requirements: {
      company_name: "KuaiGong International",
      company_rep: 200e3,
    },
  },
  "Fulcrum Secret Technologies": {
    short_name: "Fulcrum",
    requirements: {
      company_name: "Fulcrum Technologies",
      company_rep: 250e3,
      hack_target: "fulcrumassets",
    },
  },
  "BitRunners": {
    short_name: "BitRunners",
    requirements: {
      hack_target: "run4theh111z",
      home_ram: 128,
    },
  },
  "The Black Hand": {
    short_name: "BlackHand",
    requirements: {
      hack_target: "I.I.I.I",
      home_ram: 64,
    },
  },
  "NiteSec": {
    short_name: "NiteSec",
    requirements: {
      hack_target: "avmnite-02h",
      home_ram: 32,
    },
  },
  "Aevum": {
    short_name: "Aevum",
    requirements: {
      money: 40000000,
      cities: ["Aevum"],
      banned_factions: ["Chongqing", "New Tokyo", "Ishima", "Volhaven",],
    },
  },
  "Chongqing": {
    short_name: "Chongqing",
    requirements: {
      money: 20000000,
      cities: ["Chongqing"],
      banned_factions: ["Sector-12", "Aevum", "Volhaven",],
    },
  },
  "Ishima": {
    short_name: "Ishima",
    requirements: {
      money: 30000000,
      cities: ["Ishima"],
      banned_factions: ["Sector-12", "Aevum", "Volhaven",],
    },
  },
  "New Tokyo": {
    short_name: "Tokyo",
    requirements: {
      money: 20000000,
      cities: ["New Tokyo"],
      banned_factions: ["Sector-12", "Aevum", "Volhaven",],
    },
  },
  "Sector-12": {
    short_name: "Sector12",
    requirements: {
      money: 15000000,
      cities: ["Sector-12"],
      banned_factions: ["Chongqing", "New Tokyo", "Ishima", "Volhaven",],
    },
  },
  "Volhaven": {
    short_name: "Volhaven",
    requirements: {
      money: 50000000,
      cities: ["Volhaven"],
      banned_factions: ["Chongqing", "Sector-12", "New Tokyo", "Aevum", "Ishima",],
    },
  },
  "Speakers for the Dead": {
    short_name: "Speakers4Dead",
    requirements: {
      hacking: 100,
      strength: 300,
      defense: 300,
      dexterity: 300,
      agility: 300,
      kills: 30,
      karma: 45,
      banned_companies: ["Central Intelligence Agency", "National Security Agency",],
    },
  },
  "The Dark Army": {
    short_name: "DarkArmy",
    requirements: {
      hacking: 300,
      strength: 300,
      defense: 300,
      dexterity: 300,
      agility: 300,
      kills: 5,
      karma: 45,
      banned_companies: ["Central Intelligence Agency", "National Security Agency",],
      cities: ["Chongqing"],
    },
  },
  "The Syndicate": {
    short_name: "Syndicate",
    requirements: {
      money: 10000000,
      hacking: 200,
      strength: 200,
      defense: 200,
      dexterity: 200,
      agility: 200,
      karma: 90,
      banned_companies: ["Central Intelligence Agency", "National Security Agency",],
      cities: ["Aevum", "Sector-12"],
    },
  },
  "Silhouette": {
    short_name: "Silhouette",
    requirements: {
      money: 15000000,
      karma: 22,
      jobs: ["Chief Technology Officer", "Chief Financial Officer", "Chief Executive Officer",],
    },
  },
  "Tetrads": {
    short_name: "Tetrads",
    requirements: {
      strength: 75,
      defense: 75,
      dexterity: 75,
      agility: 75,
      karma: 18,
      cities: ["Chongqing", "New Tokyo", "Ishima",],
    },
  },
  "Slum Snakes": {
    short_name: "Snakes",
    requirements: {
      money: 1000000,
      strength: 30,
      defense: 30,
      dexterity: 30,
      agility: 30,
      karma: 9,
    },
  },
  "Netburners": {
    short_name: "Netburners",
    requirements: {
      hacking: 80,
      hacknet_ram: 8,
      hacknet_cores: 4,
      hacknet_levels: 100,
    },
  },
  "Tian Di Hui": {
    short_name: "TianDiHui",
    requirements: {
      money: 1000000,
      hacking: 50,
      cities: ["Chongqing", "New Tokyo", "Ishima",],
    },
  },
  "CyberSec": {
    short_name: "CSEC",
    requirements: {
      hack_target: "CSEC",
    },
  },
  //"Bladeburners"
};

export const faction_names = Object.keys(factions);

export const companies_with_factions = Object.entries(factions)
  .filter(factionEntry => factionEntry.requirements
    && factionEntry.requirements.company_name)
  .map(factionEntry => factionEntry.requirements.company_name);

const toShortName = (factionName) => factions[factionName].short_name || factionName;

const getAllAugmentationNames = (ns) => [
  ...new Set(faction_names.map(faction_name =>
    ns.getAugmentationsFromFaction(faction_name)).flat())
  ];

const getNonBannedFactionNames = (ns, player) => Object.entries(factions).filter(factionEntry =>
  !(factionEntry[1].requirements.banned_companies && factionEntry[1].requirements.banned_companies.find(company => Object.keys(player.jobs).includes(company))) &&
  !(factionEntry[1].requirements.banned_factions && factionEntry[1].requirements.banned_factions.find(faction => player.factions.includes(faction))))
  .map(factionEntry => factionEntry[0]);

const getNonBannedFactionsWithAugmentsForSale = (ns, player, excludedFactions) => {
  let allOwnedAugmentations = ns.getOwnedAugmentations(true);
  return getNonBannedFactionNames(ns, player)
    .filter(factionName => !excludedFactions.includes(factionName))
    .filter(factionName => ns.getAugmentationsFromFaction(factionName)
      .filter(augmentation => !allOwnedAugmentations.includes(augmentation))
      .filter(augmentation => augmentation != "NeuroFlux Governor").length);
};

const getFactionsWithAugmentsForSale = (ns) => {
  let allOwnedAugmentations = ns.getOwnedAugmentations(true);
  return faction_names
    .filter(factionName => ns.getAugmentationsFromFaction(factionName)
      .filter(augmentation => !allOwnedAugmentations.includes(augmentation))
      .filter(augmentation => augmentation != "NeuroFlux Governor").length);
};

//returns undefined if faction doesn't exist or no requirements
const getFactionRequirements = (ns, faction_names) =>
  faction_names.map(faction_name => [
    faction_name,
    (factions[faction_name] || {}).requirements
  ]
);

const areFactionRequirementsMet = (ns, factionEntry) => {
  let factionName = factionEntry[0];
  let requirements = factionEntry[1];
  let player = getDetailedPlayerData(ns);
  if (
    (requirements.hack_target && !ns.hasRootAccess(requirements.hack_target)) ||
    (requirements.cities && !requirements.cities.includes(player.city)) ||
    (requirements.jobs && requirements.jobs.every(job => !Object.keys(player.jobs).includes(job))) ||
    (requirements.money && requirements.money > player.money) ||
    (requirements.banned_companies && requirements.banned_companies.find(company => Object.keys(player.jobs).includes(company))) ||
    (requirements.banned_factions && requirements.banned_factions.find(faction => player.factions.includes(faction))) ||
    (requirements.home_ram && requirements.home_ram > ns.getServerMaxRam("home")) ||
    (requirements.augmentations && requirements.augmentations > ns.getOwnedAugmentations().length) ||
    (requirements.company_rep && requirements.company_rep > ns.getCompanyRep(requirements.company_name)) ||
    (requirements.karma && requirements.karma > player.karma) ||
    (requirements.kills && requirements.kills > player.kills) ||
    (requirements.hacknet_levels && requirements.hacknet_levels > player.hacknet_levels) ||
    (requirements.hacknet_ram && requirements.hacknet_ram > player.hacknet_ram) ||
    (requirements.hacknet_cores && requirements.hacknet_cores > player.hacknet_cores)) {
    return false;
  }
  if (requirements.hacking_combat_or) {
    if ((requirements.hacking && requirements.hacking > player.hacking_skill) &&
    ((requirements.strength && requirements.strength > player.strength) ||
    (requirements.defense && requirements.defense > player.defense) ||
    (requirements.dexterity && requirements.dexterity > player.dexterity) ||
    (requirements.agility && requirements.agility > player.agility))) {
      return false;
    }
  } else {
    if ((requirements.hacking && requirements.hacking > player.hacking_skill) ||
    (requirements.strength && requirements.strength > player.strength) ||
    (requirements.defense && requirements.defense > player.defense) ||
    (requirements.dexterity && requirements.dexterity > player.dexterity) ||
    (requirements.agility && requirements.agility > player.agility)) {
      return false;
    }
  }
  return true;
};

const getFactionsWithMetRequirements = (ns) => Object.entries(factions)
  .filter((factionEntry) => areFactionRequirementsMet(ns, factionEntry));

const getUnmetRequirements = (ns, factionName) => {
  let requirements = {...factions[factionName].requirements};
  let player = getDetailedPlayerData(ns);
  if (requirements.hack_target && ns.hasRootAccess(requirements.hack_target))
    delete requirements.hack_target;
  if (requirements.cities && requirements.cities.includes(player.city))
    delete requirements.cities;
  if (requirements.jobs && requirements.jobs.some(job => Object.keys(player.jobs).includes(job)))
    delete requirements.jobs;
  if (requirements.money && requirements.money <= player.money)
    delete requirements.money;
  if (requirements.banned_companies && requirements.banned_companies.every(company => !Object.keys(player.jobs).includes(company)))
    delete requirements.banned_companies;
  if (requirements.banned_factions && requirements.banned_factions.every(faction => !player.factions.includes(faction)))
    delete requirements.banned_factions;
  if (requirements.home_ram && requirements.home_ram <= ns.getServerMaxRam("home"))
    delete requirements.home_ram;
  if (requirements.augmentations && requirements.augmentations <= ns.getOwnedAugmentations().length)
    delete requirements.augmentations;
  if (requirements.company_rep && requirements.company_rep <= ns.getCompanyRep(requirements.company_name)) {
    delete requirements.company_name;
    delete requirements.company_rep;
  }
  if (requirements.karma && requirements.karma <= player.karma)
    delete requirements.karma;
  if (requirements.kills && requirements.kills <= player.kills)
    delete requirements.kills;
  if (requirements.hacknet_levels && requirements.hacknet_levels <= player.hacknet_levels)
    delete requirements.hacknet_levels;
  if (requirements.hacknet_ram && requirements.hacknet_ram <= player.hacknet_ram)
    delete requirements.hacknet_ram;
  if (requirements.hacknet_cores && requirements.hacknet_cores <= player.hacknet_cores)
    delete requirements.hacknet_cores;
  if (requirements.hacking_combat_or) {
    if ((requirements.hacking && requirements.hacking <= player.hacking_skill) ||
    ((requirements.strength && requirements.strength <= player.strength) &&
    (requirements.defense && requirements.defense <= player.defense) &&
    (requirements.dexterity && requirements.dexterity <= player.dexterity) &&
    (requirements.agility && requirements.agility <= player.agility))) {
      delete requirements.hacking_combat_or;
      delete requirements.hacking;
      delete requirements.strength;
      delete requirements.defense;
      delete requirements.dexterity;
      delete requirements.agility;
    }
  }
  if (requirements.hacking && requirements.hacking <= player.hacking_skill)
    delete requirements.hacking;
  if (requirements.strength && requirements.strength <= player.strength)
    delete requirements.strength;
  if (requirements.defense && requirements.defense <= player.defense)
    delete requirements.defense;
  if (requirements.dexterity && requirements.dexterity <= player.dexterity)
    delete requirements.dexterity;
  if (requirements.agility && requirements.agility <= player.agility)
    delete requirements.agility;
  return requirements;
};

const getUnownedAugmentationsFromFaction = (ns, factionName) =>
  ns.getAugmentationsFromFaction(factionName)
    .filter(augmentation => !ns.getOwnedAugmentations(true).includes(augmentation));

const getUnownedFactionAugmentationsDictFromNonBannedFactions = (ns, player, excludedFactions) =>
  getNonBannedFactionsWithAugmentsForSale(ns, player, excludedFactions)
    .map(factionName => {
      return { [factionName]:
        {
          unmet_requirements: getUnmetRequirements(ns, factionName),
          augmentations: getUnownedAugmentationsFromFaction(ns, factionName)
            .map(augmentationName => {
              let augCost = ns.getAugmentationCost(augmentationName);
              return { [augmentationName]:
                {
                  reputation_cost: augCost[0],
                  money_cost: augCost[1],
                  stats: ns.getAugmentationStats(augmentationName),
                }};
            }),
        }
      };
    });

const getAnnotatedBuyableAugmentationDict = (ns, player, excludedFactions) => {
  let augDict = {};
  getNonBannedFactionsWithAugmentsForSale(ns, player, excludedFactions).forEach(factionName => {
    getUnownedAugmentationsFromFaction(ns, factionName).forEach(augmentationName => {
      if (!augDict[augmentationName]) {
        let augCost = ns.getAugmentationCost(augmentationName);
        augDict[augmentationName] = {
          reputation_cost: augCost[0],
          money_cost: augCost[1],
          stats: ns.getAugmentationStats(augmentationName),
          factions: [factionName],
        };
      } else {
        if (!augDict[augmentationName].factions.includes(factionName)) {
          augDict[augmentationName].factions.push(factionName);
        }
      }
    });
  });
  return augDict;
};

const getAnnotatedAugsSortedByPrice = (ns, player, keyWord, excludedFactions) =>
  Object.entries(getAnnotatedBuyableAugmentationDict(ns, player, excludedFactions)).filter(augEntry =>
    Object.keys(augEntry[1].stats).some(key => key.includes(keyWord))
  ).sort((a,b) => b[1].money_cost - a[1].money_cost);

export async function main(ns) {
  let flag_data = ns.flags([
    ["print-factions", false],
    ["print-json", false],
    ["print-all-augs", false],
    ["print-augs", ""],
    ["no-companies", false]
  ]);

  let player = getDetailedPlayerData(ns);
  let excludedFactions = [];

  // exclude factions with no augs for sale
  excludedFactions = faction_names.filter(factionName =>
    !getFactionsWithAugmentsForSale(ns).includes(factionName))

  if (flag_data["no-companies"]) {
    excludedFactions = [...new Set(excludedFactions.concat(
      faction_names.filter(factionName =>
      factions[factionName].requirements.company_name ||
      factions[factionName].requirements.jobs)))];
  }

  if (flag_data["print-factions"]) {
    ns.tprint(`Factions with augs to buy: \n${
      getNonBannedFactionsWithAugmentsForSale(ns, player, excludedFactions)
        .map(factionName => `\n\n\n${factionName.padStart(15)}:\n${[...Array(75).keys()].map((index)=>'-').join("")}${
        Object.entries(getUnmetRequirements(ns, factionName)).map(requirementEntry =>
          `\n${requirementEntry[0].padStart(15)}: ${
            typeof(requirementEntry[1]) == "object" ?
              JSON.stringify(requirementEntry[1]) :
              typeof(requirementEntry[1]) == "string" ?
                requirementEntry[1] :
                ns.nFormat(requirementEntry[1], "0.000a").padStart(8)}`
        ).join("")
      }`).join("")
    }\n\n`);
  }
  if (flag_data["print-augs"] || flag_data["print-all-augs"]) {
    let annotatedAugsSortedByPrice = getAnnotatedAugsSortedByPrice(ns, player, flag_data["print-augs"], excludedFactions);
    let maxAugNameLength = Math.max(...annotatedAugsSortedByPrice.map(augEntry => augEntry[0].length));
    ns.tprint(`augname length: ${maxAugNameLength}`);
    ns.tprint(`Remaining ${flag_data["print-augs"]} augs by price:\n[\n${
      annotatedAugsSortedByPrice.map(augEntry =>
        `  [${augEntry[0].padStart(maxAugNameLength + 1)}, rep: ${
          ns.nFormat(augEntry[1].reputation_cost, "0.000a").padStart(8)}, price: ${
            ns.nFormat(augEntry[1].money_cost, "$0.000a").padStart(9)}, factions:\n    ${
              `[${augEntry[1].factions.map(toShortName).join(',')}]`.padStart(100)
            }],`).join('\n')
    }\n]`);
  }
  if (flag_data["print-json"]) {
    ns.tprint(JSON.stringify(
      getUnownedFactionAugmentationsDictFromNonBannedFactions(ns, player, excludedFactions), null, 2));
  }
}
