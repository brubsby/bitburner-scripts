
export function getServerNames(ns) {
  let s=["home"];
  for(let i=0;i<s.length;i++)for(let j of ns.scan(s[i]))if(!s.includes(j))s.push(j);
  return s;
}

export function runCallbackExit(ns, callback) {
  if (callback) {
    if (ns.fileExists(callback, ns.getHostname())) {
      ns.spawn(callback)
    } else {
      ns.tprint(`callback script: ${callback} does not exist on this host (${ns.getHostname()})`)
    }
  }
  ns.exit()
}

const multipliers = {
    "k":1e3,
    "m":1e6,
    "M":1e6,
    "b":1e9,
    "G":1e9,
    "t":1e12,
    "T":1e12,
};

export function parseLargeNumberString(numString) {
  let toParse = numString.replaceAll(',','');
  let multiplierChar = (RegExp(`[${Object.keys(multipliers).join()}]`)
    .exec(toParse) || []).shift();
  let multiplier = multipliers[multiplierChar] || 1;
  return multiplier * parseFloat(toParse);
};

export function settings() {
  return {
    minSecurityLevelOffset: 2,
    maxMoneyMultiplayer: 0.9,
    minSecurityWeight: 100,
    mapRefreshInterval: 24 * 60 * 60 * 1000,
    keys: {
      serverMap: 'BB_SERVER_MAP',
      hackTarget: 'BB_HACK_TARGET',
      action: 'BB_ACTION',
    },
  }
}

export const local_storage_keys = {
  kills: "BB_KILLS", // {kills: Int, lastAugTimestamp: Int}
}

export function getItem(key) {
  let item = localStorage.getItem(key)

  return item ? JSON.parse(item) : undefined
}

export function setItem(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

export const getDetailedPlayerData = (ns) => {
  let player = ns.getPlayer();
  // change crimes.js to write calculated kills to a file to be read here
  player.karma = Math.abs(ns.heart.break());
  player.kills = getItem(local_storage_keys.kills).kills || 0;

  player.hacking = player.hacking_skill;

  let hacknetNodes = [...Array(ns.hacknet.numNodes()).keys()]
    .map(ns.hacknet.getNodeStats);
  player.hacknet_levels = hacknetNodes.reduce((result, next) => result + next.level, 0);
  player.hacknet_ram = hacknetNodes.reduce((result, next) => result + next.ram, 0);
  player.hacknet_cores = hacknetNodes.reduce((result, next) => result + next.cores, 0);

  return player;
};

export const killOtherInstances = (ns) =>
  ns.ps(ns.getRunningScript().server).filter(process =>
    process.filename == ns.getRunningScript().filename &&
    process.pid != ns.getRunningScript().pid)
    .forEach(process => ns.kill(process.pid));

export async function main(ns) {
  return {
    settings,
    getItem,
    setItem,
  }
}
