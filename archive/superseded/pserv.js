import { getBitNodeMultipliers } from "bitNodeMultipliers.js"

const settings = {
  maxPlayerServers: 25,
  gbRamCost: 55000,
  maxGbRam: 1048576,
  minGbRam: 64,
  totalMoneyAllocation: 0.75,
  actions: {
    BUY: 'buy',
    UPGRADE: 'upgrade',
  },
  keys: {
    serverMap: 'BB_SERVER_MAP',
  },
};

function getItem(key) {
  let item = localStorage.getItem(key)

  return item ? JSON.parse(item) : undefined
}

function setItem(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

function localeHHMMSS(ms = 0) {
  if (!ms) {
    ms = new Date().getTime()
  }

  return new Date(ms).toLocaleTimeString()
}

function createUUID() {
  var dt = new Date().getTime()
  var uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (dt + Math.random() * 16) % 16 | 0
    dt = Math.floor(dt / 16)
    return (c == 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
  return uuid
}

function updateServer(ns, serverMap, host) {
  serverMap.servers[host] = {
    host,
    ports: ns.getServerNumPortsRequired(host),
    hackingLevel: ns.getServerRequiredHackingLevel(host),
    maxMoney: ns.getServerMaxMoney(host),
    growth: ns.getServerGrowth(host),
    minSecurityLevel: ns.getServerMinSecurityLevel(host),
    baseSecurityLevel: ns.getServerBaseSecurityLevel(host),
    ram: ns.getServerMaxRam(host),
    connections: ['home'],
    parent: 'home',
    children: [],
  };

  Object.keys(serverMap.servers).map((hostname) => {
    if (!ns.serverExists(hostname)) {
      delete serverMap.servers[hostname];
    }
  });

  setItem(settings.keys.serverMap, serverMap);
}

function getPurchasedServers(ns) {
  let purchasedServers = ns.cloud.getServerNames();
  if (purchasedServers.length) {
    purchasedServers.sort((a, b) => {
      const totalRamA = ns.getServerMaxRam(a);
      const totalRamB = ns.getServerMaxRam(b);

      if (totalRamA === totalRamB) {
        return ns.getServerMaxRam(a) - ns.getServerMaxRam(b);
      } else {
        return totalRamA - totalRamB;
      }
    })
  }

  return purchasedServers;
}

export async function main(ns) {

  let flags = ns.flags([
    ["debug", false],
  ]);

  ns.tprint(`[${localeHHMMSS()}] Starting ${ns.getScriptName()}}`);

  settings.maxGbRam = ns.cloud.getRamLimit();
  settings.maxPlayerServers = ns.cloud.getServerLimit();
  settings.gbRamCost *= getBitNodeMultipliers().PurchasedServerCost;
  let hostname = ns.getHostname();

  if (settings.maxPlayerServers == 0) {
    ns.tprint(`[${localeHHMMSS()}] Player server limit is 0, exiting...`);
    ns.exit();
    return;
  }

  if (hostname !== 'home') {
    throw new Error('Run the script from home');
  }

  while (true) {
    let didChange = false;

    const serverMap = getItem(settings.keys.serverMap);
    let purchasedServers = getPurchasedServers(ns);

    let action = purchasedServers.length < settings.maxPlayerServers ? settings.actions.BUY : settings.actions.UPGRADE

    if (action == settings.actions.BUY) {
      let smallestCurrentServer = purchasedServers.length ? ns.getServerMaxRam(purchasedServers[0]) : 0;
      let targetRam = Math.max(settings.minGbRam, smallestCurrentServer, ns.getServerMaxRam('home')/8);

      if (targetRam === settings.minGbRam) {
        while (ns.getServerMoneyAvailable('home') * settings.totalMoneyAllocation >= targetRam * settings.gbRamCost * settings.maxPlayerServers) {
          targetRam *= 2;
        }

        targetRam /= 2;
      }

      targetRam = Math.max(settings.minGbRam, targetRam);
      targetRam = Math.min(targetRam, settings.maxGbRam);

      ns.print(`targetRam: ${targetRam}, targetPrice: ${targetRam * settings.gbRamCost}`);

      if (ns.getServerMoneyAvailable('home') * settings.totalMoneyAllocation >= targetRam * settings.gbRamCost) {
        let tempTargetRam = targetRam;
        while (ns.getServerMoneyAvailable('home') * settings.totalMoneyAllocation >= tempTargetRam * settings.gbRamCost && tempTargetRam <= settings.maxGbRam) {
          tempTargetRam *= 2;
        }
        tempTargetRam /= 2;
        let hostname = `pserv-${tempTargetRam}-${createUUID()}`;
        hostname = ns.cloud.purchaseServer(hostname, tempTargetRam);

        if (hostname) {
          ns.tprint(`[${localeHHMMSS()}] Bought new server: ${hostname} (${tempTargetRam} GB)`);

          updateServer(ns, serverMap, hostname);
          didChange = true;
        }
      }
    } else {
      let smallestCurrentServer = Math.max(ns.getServerMaxRam(purchasedServers[0]), settings.minGbRam);
      let biggestCurrentServer = ns.getServerMaxRam(purchasedServers[purchasedServers.length - 1]);
      let targetRam = biggestCurrentServer;

      if (smallestCurrentServer === settings.maxGbRam) {
        ns.tprint(`[${localeHHMMSS()}] All servers maxxed. Exiting.`);
        ns.exit();
        return;
      }

      if (smallestCurrentServer === biggestCurrentServer || (ns.getServerMoneyAvailable('home') * settings.totalMoneyAllocation >= targetRam * settings.gbRamCost * settings.maxPlayerServers / 2)) {
        while (ns.getServerMoneyAvailable('home') * settings.totalMoneyAllocation >= targetRam * settings.gbRamCost) {
          targetRam *= 4;
        }

        targetRam /= 4;
      }

      targetRam = Math.min(targetRam, settings.maxGbRam);

      purchasedServers = getPurchasedServers(ns);
      if (targetRam > ns.getServerMaxRam(purchasedServers[0])) {
        didChange = true;
        while (didChange) {
          didChange = false;
          purchasedServers = getPurchasedServers(ns);

          if (targetRam > ns.getServerMaxRam(purchasedServers[0])) {
            if (ns.getServerMoneyAvailable('home') * settings.totalMoneyAllocation >= targetRam * settings.gbRamCost) {
              let tempTargetRam = targetRam;
              while (ns.getServerMoneyAvailable('home') * settings.totalMoneyAllocation >= tempTargetRam * settings.gbRamCost && tempTargetRam <= settings.maxGbRam) {
                tempTargetRam *= 2;
              }
              tempTargetRam /= 2;
              let hostname = `pserv-${tempTargetRam}-${createUUID()}`;

              await ns.killall(purchasedServers[0]);
              await ns.sleep(10);
              const serverDeleted = await ns.cloud.deleteServer(purchasedServers[0]);
              if (serverDeleted) {
                hostname = await ns.cloud.purchaseServer(hostname, tempTargetRam);

                if (hostname) {
                  ns.tprint(`[${localeHHMMSS()}] Upgraded: ${purchasedServers[0]} into server: ${hostname} (${tempTargetRam} GB)`);

                  updateServer(ns, serverMap, hostname);
                  didChange = true;
                }
              }
            }
          }
        }
      }
    }

    if (!didChange) {
      await ns.sleep(30000);
    }
  }
}
