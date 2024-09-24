import { local_storage_keys, getItem, setItem, getDetailedPlayerData } from "common.js";

let CRIME_NAMES = [
  "shoplift",
  "rob store",
  "mug",
  "larceny",
  "deal drugs",
  "bond forgery",
  "traffick arms",
  "homicide",
  "grand theft auto",
  "kidnap",
  "assassinate",
  "heist",
]

let BOOLEAN_FLAG_NAMES = [
  'money',
  'kills',
  'karma',
  'hacking',
  'strength',
  'defense',
  'dexterity',
  'charisma',
  'intelligence',
  'training',
]

let FLAG_STAT_MAP = {
  money: 'money_per_millisecond',
  kills: 'kills_per_millisecond',
  karma: 'karma_per_millisecond',
  hacking: 'hacking_exp_per_millisecond',
  strength: 'strength_exp_per_millisecond',
  defense: 'defense_exp_per_millisecond',
  dexterity: 'dexterity_exp_per_millisecond',
  charisma: 'charisma_exp_per_millisecond',
  intelligence: 'intelligence_exp_per_millisecond',
}

let EPSILON_SLEEP = 100

function getExpectedCrimeReturns(ns) {
  //let ns.bitnode
  return CRIME_NAMES.reduce((result, crimeName) => {
    let crimeChance = ns.getCrimeChance(crimeName)
    let crimeStats = ns.getCrimeStats(crimeName)
    let failXpFactor = (3 * crimeChance + 1) / 4
    let expectedReturns = {
      money: crimeStats.money * crimeChance,
      hacking_exp: crimeStats.hacking_exp * failXpFactor,
      strength_exp: crimeStats.strength_exp * failXpFactor,
      defense_exp: crimeStats.defense_exp * failXpFactor,
      dexterity_exp: crimeStats.dexterity_exp * failXpFactor,
      agility_exp: crimeStats.agility_exp * failXpFactor,
      charisma_exp: crimeStats.charisma_exp * failXpFactor,
      intelligence_exp: crimeStats.intelligence_exp * crimeChance,
      kills: crimeStats.kills * crimeChance,
      karma: crimeStats.karma * crimeChance,
      time: crimeStats.time,
      money_per_millisecond: crimeStats.money * crimeChance / crimeStats.time,
      hacking_exp_per_millisecond: crimeStats.hacking_exp * failXpFactor / crimeStats.time,
      strength_exp_per_millisecond: crimeStats.strength_exp * failXpFactor / crimeStats.time,
      defense_exp_per_millisecond: crimeStats.defense_exp * failXpFactor / crimeStats.time,
      dexterity_exp_per_millisecond: crimeStats.dexterity_exp * failXpFactor / crimeStats.time,
      agility_exp_per_millisecond: crimeStats.agility_exp * failXpFactor / crimeStats.time,
      charisma_exp_per_millisecond: crimeStats.charisma_exp * failXpFactor / crimeStats.time,
      intelligence_exp_per_millisecond: crimeStats.intelligence_exp * crimeChance / crimeStats.time,
      kills_per_millisecond: crimeStats.kills * crimeChance / crimeStats.time,
      karma_per_millisecond: crimeStats.karma * crimeChance / crimeStats.time
    }
    result[crimeName] = expectedReturns
    return result
  }, {})
}

function getBestReturnCrimeFor(ns, stat) {
  let expectedCrimeReturns = getExpectedCrimeReturns(ns)
  let reducer = (result, currentValue) => {
    return currentValue[1][stat] > result[1][stat] ? currentValue : result
  }
  let bestEntry = Object.entries(expectedCrimeReturns).reduce(reducer)
  return bestEntry
}

function booleanFlagsToStat(ns, flags) {
  let trueBooleanFlags = Object.entries(flags)
    .filter(flagEntry => BOOLEAN_FLAG_NAMES.includes(flagEntry[0]))
    .filter(flagEntry => flagEntry[1])
    .map(flagEntry => flagEntry[0]);
  if (trueBooleanFlags.length != 1) usage(ns);
  let trueFlag = trueBooleanFlags.pop();
  if (Object.keys(FLAG_STAT_MAP).includes(trueFlag)) return trueFlag;
  if (trueFlag == "training") {
    let player = getDetailedPlayerData(ns);
    let skills = ['hacking', 'strength', 'defense', 'dexterity', 'agility', 'charisma']
      .filter(skill => player[skill] < flags.target);
    if (!skills.length) return undefined;
    let lowestSkill = skills.reduce((resultSkill, skill) =>
      player[skill] > player[resultSkill] ? resultSkill : skill
    );
    ns.print(`lowestSkill: ${lowestSkill}`);
    return lowestSkill;
  }
  return undefined;
}

function usage(ns) {
  ns.tprint(`Usage: run crime.js --[${BOOLEAN_FLAG_NAMES.join('|')}]`)
  ns.exit()
}

export async function main(ns) {
  let flags = ns.flags(
    BOOLEAN_FLAG_NAMES.map((flag) => [flag, false]).concat([
      ["tail", false],
      ["target", 0],
    ])
  )

  if (flags.tail) {
    ns.tail();
  }

  let augTimestampEpsilon = 10000;
  let killsDict = getItem(local_storage_keys.kills);
  let lastAugTimestamp = Date.now() - ns.getTimeSinceLastAug();
  // can't find kills or last augmentation didn't occur when we expected it
  if (!killsDict || Math.abs(killsDict.lastAugTimestamp - lastAugTimestamp) >
      augTimestampEpsilon) {
    setItem(local_storage_keys.kills, {
      kills: 0,
      lastAugTimestamp: lastAugTimestamp,
    });
  }

  while(true) {
    let statToMax = booleanFlagsToStat(ns, flags);
    let player = getDetailedPlayerData(ns);
    ns.print(`${statToMax}: ${player[statToMax]}`);
    if (!statToMax || (flags.target && flags.target <= player[statToMax])) {
      ns.print(`Done committing crimes, ${statToMax} has reached ${flags.target}.`)
      ns.exit();
      return;
    }
    let statRateToMax = FLAG_STAT_MAP[statToMax];
    ns.print(`statRateToMax: ${statRateToMax}`);
    let [bestCrime, crimeReturns] = getBestReturnCrimeFor(ns, statRateToMax)
    ns.print(`${bestCrime} is the best crime for ${statRateToMax} with ${JSON.stringify(crimeReturns,null,2)}`)
    let karmaBefore = ns.heart.break();
    ns.commitCrime(bestCrime);
    await ns.sleep(crimeReturns.time);
    while(ns.isBusy()) {
      await ns.sleep(EPSILON_SLEEP);
    }
    if (ns.heart.break() != karmaBefore && crimeReturns.kills) {
      let killsDict = getItem(local_storage_keys.kills);
      killsDict.kills += 1;
      setItem(local_storage_keys.kills, killsDict);
    }
  }

}
