import { killOtherInstances, getServerNames, getItem, setItem } from 'common.js'

const max_buffer = 100;
const travel_cost = 200e3;

const handleSecondaryMoney = (ns) => {
  while ((ns.hacknet.numHashes() > ns.hacknet.hashCapacity() - max_buffer) ||
    (ns.hacknet.numHashes() > ns.hacknet.hashCost("Sell for Money") &&
      ns.getPlayer().money < travel_cost)) {
    if(!ns.hacknet.spendHashes("Sell for Money")) {
      break;
    }
  }
}

const hash_goal_types = {
  MONEY: "money",
  POOL: "pool",
  MAXUNI: "maxuni",
  MAXGYM: "maxgym",
  MAXTRAINING: "maxtraining",
  SERVER: "server",
  CONTRACTS: "contracts",
  BLADEBURNER: "bladeburner",
  SKILLPOINTS: "skillpoints",
  RANK: "rank",
};

let hash_goals = [];
let target;
let print_goals;

export async function main(ns) {
  let flags = ns.flags([
    ["debug", false],
    ["print", false],
  ]);

  if (flags._ && flags._.length) {
    hash_goals = [];
    let serverNames = getServerNames(ns);
    flags._.forEach(arg => {
      if (serverNames.includes(arg)) {
        target = arg;
      } else if (Object.keys(hash_goal_types).includes(arg.toUpperCase())) {
        hash_goals.push(arg);
      } else {
        ns.tprint(`invalid argument: ${arg}`);
      }
    });
  }

  if (flags.print) {
    print_goals = true;
  }

  if (ns.ps(ns.getHostname()).filter(server =>
      server.filename == ns.getScriptName()).length > 1) {
    print_goals = true;
    if (!flags._ || !flags._.length) {
      ns.exit();
      return;
    }
  }

  killOtherInstances(ns);

  if (!hash_goals || !hash_goals.length) hash_goals = [hash_goal_types.MONEY];

  while (true) {

    if (print_goals) {
      ns.tprint(`hash goals: ${JSON.stringify(hash_goals)}, hash target: ${target}`);
      print_goals = false;
    }

    handleSecondaryMoney(ns);
    hash_goals.forEach( hash_goal => {
      switch (hash_goal) {
        case hash_goal_types.POOL:
          break;
        case hash_goal_types.MAXUNI:
        case hash_goal_types.MAXGYM:
        case hash_goal_types.MAXTRAINING:
          while ([hash_goal_types.MAXUNI, hash_goal_types.MAXTRAINING].includes(hash_goal)
            && ns.hacknet.spendHashes("Improve Studying"));
          while ([hash_goal_types.MAXGYM, hash_goal_types.MAXTRAINING].includes(hash_goal)
            && ns.hacknet.spendHashes("Improve Gym Training"));
          break;
        case hash_goal_types.BLADEBURNER:
        case hash_goal_types.SKILLPOINTS:
        case hash_goal_types.RANK:
          while ([hash_goal_types.BLADEBURNER, hash_goal_types.SKILLPOINTS].includes(hash_goal)
            && ns.hacknet.spendHashes("Exchange for Bladeburner SP"));
          while ([hash_goal_types.BLADEBURNER, hash_goal_types.RANK].includes(hash_goal)
            && ns.hacknet.spendHashes("Exchange for Bladeburner Rank"));
          break;
        case hash_goal_types.MONEY:
          while (ns.hacknet.spendHashes("Sell for Money"));
          break;
        case hash_goal_types.SERVER:
          while (hash_goal_types.SERVER == hash_goal &&
            ns.serverExists(target) &&
            ns.getServerSecurityLevel(target) > 1 &&
            ns.hacknet.spendHashes("Reduce Minimum Security", target));
          while (hash_goal_types.SERVER == hash_goal &&
            ns.serverExists(target) &&
            ns.hacknet.spendHashes("Increase Maximum Money", target));
          break;
        case hash_goal_types.CONTRACTS:
          while (hash_goal_types.CONTRACTS == hash_goal
            && ns.hacknet.spendHashes("Generate Coding Contract"));
          break;
      }
    });

    await ns.sleep(1000);
  }
}
