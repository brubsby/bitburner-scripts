
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
  // TWO v1 LEFTOVERS, both fixed here after faction.js crashed the UI with
  // `TypeError: Cannot read properties of undefined (reading 'kills')`.
  //
  // 1. getItem returns undefined for a key that was never written (it is a
  //    localStorage read with no default), and nothing in the current stack
  //    writes `kills` — the comment above says crimes.js was supposed to, and
  //    crimes.js is not part of this run. So this threw on the FIRST call in a
  //    fresh save. The throw raised a modal error dialog, and that modal blocked
  //    the terminal, which wedged cmd.js mid-batch while it held the global UI
  //    lock — one unguarded property access took out the command bridge and
  //    everything downstream of it for fifteen minutes.
  //
  // 2. `player.hacking_skill` has not existed since v1; v3's getPlayer returns
  //    skills under `player.skills` (NetscriptFunctions.ts:1371-1389). This
  //    assigned `undefined` to `player.hacking`, which is the field faction.js
  //    compares against every faction's hacking requirement — so it was not
  //    merely crashing, it was silently mis-evaluating which factions are
  //    reachable. `undefined >= n` is false, so every hacking-gated faction
  //    looked permanently out of reach.
  player.kills = getItem(local_storage_keys.kills)?.kills ?? ns.getPlayer().numPeopleKilled ?? 0;

  player.hacking = player.skills?.hacking ?? 0;

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
