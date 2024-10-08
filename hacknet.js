import { parseLargeNumberString } from "common.js";

const upgrade_types = {
  "Sell for Money": {},
  "Sell for Corporation Funds": {},
  "Reduce Minimum Security": {},
  "Increase Maximum Money": {},
  "Improve Studying": {},
  "Improve Gym Training": {},
  "Exchange for Corporation Research": {},
  "Exchange for Bladeburner Rank": {},
  "Exchange for Bladeburner SP": {},
  "Generate Coding Contract": {},
}

const upgrade_names = Object.keys(upgrade_types);

const max_upgrade_cost = (ns) =>
  Math.max(...upgrade_names.map(upgradeName =>
    ns.hacknet.hashCost(upgradeName)));

const hypotheticalHashCapacity = (hypotheticalServers) =>
  hypotheticalServers.map(server => 32 * Math.pow(2, server.cache))
    .reduce((result, next) => result + next);

const getHacknetServers = (ns) =>
  [...Array(ns.hacknet.numNodes()).keys()]
    .map(index => ns.hacknet.getNodeStats(index));

const serverOptimalGainRate = (ns, server, player) =>
  ns.formulas.hacknetServers.hashGainRate(
    server.level,
    0,
    server.ram,
    server.cores,
    player.hacknet_node_money_mult);

const newServerGainRate = (ns, player) =>
  ns.formulas.hacknetServers.hashGainRate(
    1,
    0,
    1,
    1,
    player.hacknet_node_money_mult);

const lowestServerGainRate = (ns, player) =>
  Math.min(...getHacknetServers(ns).map(server => server.production))

const serverHashCapacity = (ns, server, player) => 32 * Math.pow(2, server.cache);

const serverOptimalGainRateLevelUpgrade = (ns, server, player) =>
  server.level < ns.formulas.hacknetServers.constants().MaxLevel ?
  ns.formulas.hacknetServers.hashGainRate(
    server.level + 1,
    0,
    server.ram,
    server.cores,
    player.hacknet_node_money_mult) : 0;

const serverOptimalGainRateRamUpgrade = (ns, server, player) =>
  server.ram < ns.formulas.hacknetServers.constants().MaxRam ?
  ns.formulas.hacknetServers.hashGainRate(
    server.level,
    0,
    server.ram * 2,
    server.cores,
    player.hacknet_node_money_mult) : 0;

const serverOptimalGainRateCoreUpgrade = (ns, server, player) =>
  server.cores < ns.formulas.hacknetServers.constants().MaxCores ?
  ns.formulas.hacknetServers.hashGainRate(
    server.level,
    0,
    server.ram,
    server.cores + 1,
    player.hacknet_node_money_mult) : 0;

const hashesToMoneyConversion = (hashes) => 1e6 * hashes / 4;

const moneyToHashesConversion = (money) => 4 * money / 1e6;

const isLevelUpgradeWorth = (ns, server, player, payoffTime) =>
  hashesToMoneyConversion(
    serverOptimalGainRateLevelUpgradeDelta(ns, server, player)) *
    payoffTime >= serverLevelUpgradeCost(ns, server, player);

const isRamUpgradeWorth = (ns, server, player, payoffTime) =>
  hashesToMoneyConversion(
    serverOptimalGainRateRamUpgradeDelta(ns, server, player)) *
    payoffTime >= serverRamUpgradeCost(ns, server, player);

const isCoreUpgradeWorth = (ns, server, player, payoffTime) =>
  hashesToMoneyConversion(
    serverOptimalGainRateCoreUpgradeDelta(ns, server, player)) *
    payoffTime >= serverCoreUpgradeCost(ns, server, player);

const serverHashCapacityAfterUpgrade = (ns, server, player) =>
  server.cache < ns.formulas.hacknetServers.constants().MaxCache ?
  serverHashCapacity(ns, {...server, ...{cache: server.cache + 1}}, player) : 0;

const serverOptimalGainRateLevelUpgradeDelta = (ns, server, player) =>
  server.level < ns.formulas.hacknetServers.constants().MaxLevel ?
  serverOptimalGainRateLevelUpgrade(ns, server, player) -
    serverOptimalGainRate(ns, server, player) : 0;

const serverOptimalGainRateRamUpgradeDelta = (ns, server, player) =>
  server.ram < ns.formulas.hacknetServers.constants().MaxRam ?
  serverOptimalGainRateRamUpgrade(ns, server, player) -
    serverOptimalGainRate(ns, server, player) : 0;

const serverOptimalGainRateCoreUpgradeDelta = (ns, server, player) =>
  server.cores < ns.formulas.hacknetServers.constants().MaxCores ?
  serverOptimalGainRateCoreUpgrade(ns, server, player) -
    serverOptimalGainRate(ns, server, player) : 0;

const serverCacheUpgradeSizeDelta = (ns, server, player) =>
  server.cache < ns.formulas.hacknetServers.constants().MaxCache ?
  serverHashCapacityAfterUpgrade(ns, server, player) -
    serverHashCapacity(ns, server, player) : 0;

const serverLevelUpgradeCost = (ns, server, player, levels=1) =>
  ns.formulas.hacknetServers.levelUpgradeCost(
    server.level,
    levels,
    player.hacknet_node_level_cost_mult
  );

const serverRamUpgradeCost = (ns, server, player, levels=1) =>
  ns.formulas.hacknetServers.ramUpgradeCost(
    server.ram,
    levels,
    player.hacknet_node_ram_cost_mult
  );

const serverCoreUpgradeCost = (ns, server, player, levels=1) =>
  ns.formulas.hacknetServers.coreUpgradeCost(
    server.cores,
    levels,
    player.hacknet_node_core_cost_mult
  );

const serverCacheUpgradeCost = (ns, server, player, levels=1) =>
  ns.formulas.hacknetServers.cacheUpgradeCost(
    server.cache,
    levels,
    player.hacknet_node_cache_cost_mult
  );

const newServerCost = (ns, numNodes, player) =>
  numNodes < ns.formulas.hacknetServers.constants().MaxServers ?
  ns.formulas.hacknetServers.hacknetServerCost(numNodes + 1,
    player.hacknet_node_purchase_cost_mult) :
    Infinity;

function usage(ns) {
  ns.tprint(`Usage: run ${ns.getScriptName()} [--help] [--print] [--wait-time &ltmilliseconds&gt] [--payoff-time &lthours&gt] [--budget &ltdollars&gt] [--add-budget &ltdollars&gt]`);
}

//current unspent budget, can be greater than player money
let budget = 0;
let payoffTime;
let printStatus = true;

export async function main(ns) {

  let flags = ns.flags([
    ["wait-time", 5000],
    ["payoff-time", 0],
    ["budget", ""], //sets budget
    ["add-budget", ""], //adds money to budget
    ["debug", false],
    ["help", false],
    ["print", false],
  ])

  let player = ns.getPlayer();

  if (flags['payoff-time']) {
    payoffTime = flags["payoff-time"] * 60 * 60;
  }

  if (flags["add-budget"]) {
    budget += parseLargeNumberString(flags["add-budget"]);
  }

  if (flags.budget) {
    budget = parseLargeNumberString(flags.budget);
  }

  if (flags.help) {
    usage(ns);
  }

  if (flags.print) {
    printStatus = true;
  }

  if (ns.ps(ns.getHostname()).filter(server =>
      server.filename == ns.getScriptName()).length > 1) {
    printStatus = true;
    ns.exit();
    return;
  }

  do {
    player = ns.getPlayer();
    let hypotheticalServers = [...Array(ns.hacknet.numNodes()).keys()]
      .map(index => ({...js.hacknet.getNodeStats(index)}));
    let upgradesToBuy = [];
    let moneyToSpend = Math.min(player.money, budget);
    let currentCost = 0;
    let oldTotalGainRate = hypotheticalServers.map(server =>
      serverOptimalGainRate(ns, server, player)).reduce((a,b)=>a+b,0);

    if (printStatus) {
      ns.tprint(`Current Spend: ${
        ns.nFormat(moneyToSpend, "$0.000a")}, Total Budget: ${
          ns.nFormat(budget, "$0.000a")}${payoffTime ? `, Payoff Time: ${payoffTime}` : ``}`);
      printStatus = false;
    }

    let hypotheticalUpgradeLambdas = {
      level_gains: (index) => hypotheticalServers[index].level += 1,
      ram_gains: (index) => hypotheticalServers[index].ram *= 2,
      core_gains: (index) => hypotheticalServers[index].cores += 1,
      cache_gains: (index) => hypotheticalServers[index].cache += 1,
      new_gains: (index) => hypotheticalServers[index] = {
        level: 1,
        ram: 1,
        cores: 1,
        cache: 1,
      }
    };

    let upgradeCostLambdas = {
      level_gains: (index) => serverLevelUpgradeCost(ns, hypotheticalServers[index], player),
      ram_gains: (index) => serverRamUpgradeCost(ns, hypotheticalServers[index], player),
      core_gains: (index) => serverCoreUpgradeCost(ns, hypotheticalServers[index], player),
      cache_gains: (index) => serverCacheUpgradeCost(ns, hypotheticalServers[index], player),
      new_gains: (index) => newServerCost(ns, index, player),
    };

    // greedy hash rate return optimization
    do {
      let hypotheticalGains = {
        level_gains: hypotheticalServers.map(server =>
          serverLevelUpgradeCost(ns, server, player) < moneyToSpend &&
          isLevelUpgradeWorth(ns, server, player, payoffTime ? payoffTime : Infinity) ?
          serverOptimalGainRateLevelUpgradeDelta(ns, server, player) /
          serverLevelUpgradeCost(ns, server, player) : 0),
        ram_gains: hypotheticalServers.map(server =>
          serverRamUpgradeCost(ns, server, player) < moneyToSpend &&
          isRamUpgradeWorth(ns, server, player, payoffTime ? payoffTime : Infinity)  ?
          serverOptimalGainRateRamUpgradeDelta(ns, server, player) /
          serverRamUpgradeCost(ns, server, player) : 0),
        core_gains: hypotheticalServers.map(server =>
          serverCoreUpgradeCost(ns, server, player) < moneyToSpend &&
          isCoreUpgradeWorth(ns, server, player, payoffTime ? payoffTime : Infinity)  ?
          serverOptimalGainRateCoreUpgradeDelta(ns, server, player) /
          serverCoreUpgradeCost(ns, server, player) : 0),
        cache_gains: hypotheticalServers.map(server =>
          serverCacheUpgradeCost(ns, server, player) < moneyToSpend &&
          max_upgrade_cost(ns) * 2 > hypotheticalHashCapacity(hypotheticalServers) ?
          Number.EPSILON * serverCacheUpgradeSizeDelta(ns, server, player) /
          serverCacheUpgradeCost(ns, server, player) : 0),
        new_gains: [
          ...[...Array(hypotheticalServers.length)].map(x=>0),
          newServerCost(ns, hypotheticalServers.length, player) < moneyToSpend ?
            lowestServerGainRate(ns) /
            newServerCost(ns, hypotheticalServers.length, player) : 0
          ],
      };
      if (flags.debug) ns.tprint(JSON.stringify(hypotheticalGains));
      let maxGain = Math.max(...Object.values(hypotheticalGains).flat());
      if (maxGain <= 0) break;
      let cost;
      if (!Object.entries(hypotheticalGains).some(hypotheticalGainsEntry =>
        hypotheticalGainsEntry[1].some((gain, nodeIndex) => {
          if (gain >= maxGain) {
            cost = upgradeCostLambdas[hypotheticalGainsEntry[0]](nodeIndex);
            hypotheticalUpgradeLambdas[hypotheticalGainsEntry[0]](nodeIndex);
            return true;
          }
        })
      )) {
        throw new Error('Failed to hypothetically upgrade a server when hypothetical max gain was > 0');
      }
      moneyToSpend -= cost;
      currentCost += cost;
      if (moneyToSpend <= 0) break;
    }
    while (true);

    budget -= currentCost;
    let newTotalGainRate = hypotheticalServers.map(server =>
      serverOptimalGainRate(ns, server, player)).reduce((a,b)=>a+b,0);

    let levelUpgrades = 0;
    let ramUpgrades = 0;
    let coreUpgrades = 0;
    let cacheUpgrades = 0;
    let nodePurchases = hypotheticalServers.length - ns.hacknet.numNodes();
    [...Array(nodePurchases).keys()]
      .forEach(index => ns.hacknet.purchaseNode());
    [...Array(ns.hacknet.numNodes()).keys()].map(index => ns.hacknet.getNodeStats(index))
      .map((server, index) => {
        if (hypotheticalServers[index].level > server.level) {
          let timesToUpgrade = hypotheticalServers[index].level - server.level;
          levelUpgrades += timesToUpgrade;
          ns.hacknet.upgradeLevel(index, timesToUpgrade);
          ns.print(`Upgraded hacknet server ${server.name}'s level ${
            timesToUpgrade} times, to ${hypotheticalServers[index].level}`);
        }
        if (hypotheticalServers[index].ram > server.ram) {
          let timesToUpgrade = Math.log2(hypotheticalServers[index].ram) -
            Math.log2(server.ram);
          ramUpgrades += timesToUpgrade;
          ns.hacknet.upgradeRam(index, timesToUpgrade);
          ns.print(`Upgraded hacknet server ${server.name}'s ram ${
            timesToUpgrade} times, to ${hypotheticalServers[index].ram}`);
        }
        if (hypotheticalServers[index].cores > server.cores) {
          let timesToUpgrade = hypotheticalServers[index].cores - server.cores;
          coreUpgrades += timesToUpgrade;
          ns.hacknet.upgradeCore(index, timesToUpgrade);
          ns.print(`Upgraded hacknet server ${server.name}'s cores ${
            timesToUpgrade} times, to ${hypotheticalServers[index].cores}`);
        }
        if (hypotheticalServers[index].cache > server.cache) {
          let timesToUpgrade = hypotheticalServers[index].cache - server.cache;
          cacheUpgrades += timesToUpgrade;
          ns.hacknet.upgradeCache(index, timesToUpgrade);
          ns.print(`Upgraded hacknet server ${server.name}'s cache ${
            timesToUpgrade} times, to ${hypotheticalServers[index].cache}`);
        }
      });
    if (levelUpgrades + ramUpgrades + coreUpgrades + cacheUpgrades + nodePurchases > 0) {
      let statusStrings = []
      if (levelUpgrades) statusStrings.push(`${levelUpgrades} level(s)`);
      if (ramUpgrades) statusStrings.push(`${ramUpgrades} ram upgrade(s)`);
      if (coreUpgrades) statusStrings.push(`${coreUpgrades} core(s)`);
      if (cacheUpgrades) statusStrings.push(`${cacheUpgrades} cache upgrade(s)`);
      if (nodePurchases) statusStrings.push(`${nodePurchases} new server(s)`);
      ns.tprint(`upgrades: ${statusStrings.join(`, `)}`);
      ns.tprint(`cost: ${ns.nFormat(currentCost, "$0.000a")
        }, Δhash/s: ${ns.nFormat(newTotalGainRate - oldTotalGainRate, "0.000")
        }, Δ%: ${ns.nFormat(((newTotalGainRate/oldTotalGainRate)-1)*100, "0.00")}%`);
    }

    await ns.sleep(flags['wait-time']);
  } while (true);
}
