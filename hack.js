const settings = {
  homeRamReserved: 32,
  homeRamReservedBase: 32,
  homeRamExtraRamReserved: 256,
  homeRamBigMode: 64,
  minSecurityLevelOffset: 1,
  maxMoneyMultiplayer: 0.9,
  minSecurityWeight: 100,
  mapRefreshInterval: 5 * 60 * 1000,
  maxWeakenTime: 25 * 60 * 1000,
  trainHackingFor: 1000 * 60 * 10,
  pureTraining: false,
  silent: false,
  ignoreHacknet: true,
  targetOverride: "",
  keys: {
    serverMap: 'BB_SERVER_MAP',
  },
  changes: {
    hack: 0.002,
    grow: 0.004,
    weaken: 0.05,
  },
  heuristics: {
    TRAINING: 'training',
    MONEY: 'money',
  },
};

function getItem(key) {
  let item = localStorage.getItem(key);

  return item ? JSON.parse(item) : undefined;
}

function setItem(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

const hackPrograms = ['BruteSSH.exe', 'FTPCrack.exe', 'relaySMTP.exe', 'HTTPWorm.exe', 'SQLInject.exe'];
const hackScripts = ['h.js', 'g.js', 'w.js'];

function getPlayerDetails(ns) {
  let portHacks = 0;

  hackPrograms.forEach((hackProgram) => {
    if (ns.fileExists(hackProgram, 'home')) {
      portHacks += 1;
    }
  });

  return {
    hackingLevel: ns.getHackingLevel(),
    hackingMultipliers: ns.getHackingMultipliers(),
    portHacks,
  };
}

function convertMSToHHMMSS(ms = 0) {
  if (ms <= 0) {
    return '00:00:00';
  }

  if (!ms) {
    ms = new Date().getTime();
  }

  return new Date(ms).toISOString().substr(11, 8);
}

function localeHHMMSS(ms = 0) {
  if (!ms) {
    ms = new Date().getTime();
  }

  return new Date(ms).toLocaleTimeString();
}

function numberWithCommas(x) {
  return x.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, ',');
}

function createUUID() {
  var dt = new Date().getTime();
  var uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (dt + Math.random() * 16) % 16 | 0;
    dt = Math.floor(dt / 16);
    return (c == 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
  return uuid;
}

function getMoneyAfterGrowCycles(ns, hostName, growCycles) {
	let factorForMax = Math.max(1, ns.getServerMaxMoney(hostName) / (ns.getServerMoneyAvailable(hostName)+0.000001));
	let upperCycles = ns.growthAnalyze(hostName, factorForMax);
	let upperFactor = factorForMax;
	let lowerCycles = 0;
	let lowerFactor = 1;
	let nextFactor = 1;
	let nextCycles = 0;

	if (upperCycles <= growCycles) {
		return ns.getServerMaxMoney(hostName);
	}
	for (let i = 0; i < 10; i++) {
		nextFactor = (upperFactor + lowerFactor) / 2;
		nextCycles = ns.growthAnalyze(hostName, nextFactor);
		if (nextCycles == growCycles) {
			return ns.getServerMoneyAvailable(hostName) * nextFactor;
		} else if (nextCycles < growCycles) {
			upperCycles = nextCycles;
			upperFactor = nextFactor;
		} else if (nextCycles > growCycles) {
			lowerCycles = nextCycles;
			lowerFactor = Math.max(1,nextFactor);
		}
	}
	return ns.getServerMoneyAvailable(hostName) * nextFactor;
}

function getExpectedHackMoney(ns, hostName, hackCycles) {
// =============================== original line ===============================
/**
 *   let hackPercent = ns.hackAnalyzePercent(hostName);
 */
// =============================================================================
  let hackPercent = ((...a)=>ns.hackAnalyze(...a)*100)(hostName);
  let serverMoney = ns.getServerMoneyAvailable(hostName);
  return Math.min(serverMoney * hackCycles * hackPercent / 100, serverMoney);
}

function weakenCyclesForGrow(growCycles) {
  return Math.max(0, Math.ceil(growCycles * (settings.changes.grow / settings.changes.weaken)));
}

function weakenCyclesForHack(hackCycles) {
  return Math.max(0, Math.ceil(hackCycles * (settings.changes.hack / settings.changes.weaken)));
}

function getHackableServersWithRam(ns, servers) {
  return getHackableServers(ns, servers).filter((hostname) => servers[hostname].ram >= 2);
}

function getHackableServers(ns, servers) {
  const playerDetails = getPlayerDetails(ns);

  const hackableServers = Object.keys(servers)
    .filter((hostname) => ns.serverExists(hostname))
    .filter((hostname) => servers[hostname].ports <= playerDetails.portHacks || ns.hasRootAccess(hostname))
    .map((hostname) => {
      if (hostname !== 'home') {
        if (!ns.hasRootAccess(hostname)) {
          hackPrograms.forEach((hackProgram) => {
            if (ns.fileExists(hackProgram, 'home')) {
              ns[hackProgram.split('.').shift().toLocaleLowerCase()](hostname);
            }
          });
          ns.nuke(hostname);
        }
      }

      return hostname;
    });

  hackableServers.sort((a, b) => servers[a].ram - servers[b].ram);

  return hackableServers;
}

function findTargetServer(ns, serversList, servers, serverExtraData, heuristic) {
  const playerDetails = getPlayerDetails(ns);

  serversList = serversList
    .filter((hostname) => servers[hostname].hackingLevel <= playerDetails.hackingLevel)
    .filter((hostname) => servers[hostname].maxMoney)
    .filter((hostname) => hostname !== 'home');
// =============================== original line ===============================
/**
 *     //.filter((hostname) => (1000 * ns.getWeakenTime(hostname)) < settings.maxWeakenTime)
 */
// =============================================================================
    //.filter((hostname) => (1000 * ((...a)=>ns.getWeakenTime(...a)/1000)(hostname)) < settings.maxWeakenTime)

  let avgMoneyRateLambda = (hostname) => (Math.min(Math.max((((1.75 * playerDetails.hackingLevel) - servers[hostname].hackingLevel)/(1.75 * playerDetails.hackingLevel))*((100 - servers[hostname].minSecurityLevel)/100)*(playerDetails.hackingMultipliers.chance),0),1)) *
  (Math.max(servers[hostname].maxMoney * ((100 - servers[hostname].minSecurityLevel / 100)*((playerDetails.hackingLevel - (servers[hostname].hackingLevel - 1)) / playerDetails.hackingLevel) * (playerDetails.hackingMultipliers.money) / 24000))) /
  (((2.5 * servers[hostname].hackingLevel * servers[hostname].minSecurityLevel + 500) / (playerDetails.hackingLevel + 50)) / playerDetails.hackingMultipliers.speed);
  let avgMoneyRates = serversList.map(avgMoneyRateLambda);
  let growths = serversList.map((hostname) => servers[hostname].growth);
  let avgMoneyHacks = serversList.map((hostname) => Math.max(servers[hostname].maxMoney * ((100 - servers[hostname].minSecurityLevel / 100)*((playerDetails.hackingLevel - (servers[hostname].hackingLevel - 1)) / playerDetails.hackingLevel) * (playerDetails.hackingMultipliers.money) / 24000)));
  let levelRatios = serversList.map((hostname) => (playerDetails.hackingLevel - servers[hostname].hackingLevel) / playerDetails.hackingLevel);
  let baseTimes = serversList.map((hostname) => ((2.5 * servers[hostname].hackingLevel * servers[hostname].minSecurityLevel + 500) / (playerDetails.hackingLevel + 50)) / playerDetails.hackingMultipliers.speed);

  let avgMoneyRateMin = Math.min(...avgMoneyRates);
  let avgMoneyRateMax = Math.max(...avgMoneyRates);

  let growthMin = Math.min(...growths);
  let growthMax = Math.max(...growths);

  let avgMoneyHackMin = Math.min(...avgMoneyHacks);
  let avgMoneyHackMax = Math.max(...avgMoneyHacks);

  let levelRatioMin = Math.min(...levelRatios);
  let levelRatioMax = Math.max(...levelRatios);

  let baseTimeMin = Math.min(...baseTimes);
  let baseTimeMax = Math.max(...baseTimes);

  let weightedServers = serversList.map((hostname) => {
// =============================== original line ===============================
/**
 *     const fullHackCycles = Math.ceil(100 / Math.max(0.00000001, ns.hackAnalyzePercent(hostname)));
 */
// =============================================================================
    const fullHackCycles = Math.ceil(100 / Math.max(0.00000001, ((...a)=>ns.hackAnalyze(...a)*100)(hostname)));

    let normalizedAvgMoneyRate = (avgMoneyRateLambda(hostname) - avgMoneyRateMin) / (avgMoneyRateMax - avgMoneyRateMin);

    let normalizedGrowth = (servers[hostname].growth - growthMin) / (growthMax - growthMin);

    let avgMoneyHack = Math.max(servers[hostname].maxMoney * ((100 - servers[hostname].minSecurityLevel / 100)*((playerDetails.hackingLevel - (servers[hostname].hackingLevel - 1)) / playerDetails.hackingLevel) * (playerDetails.hackingMultipliers.money) / 24000));
    let normalizedAvgMoneyHack = (avgMoneyHack - avgMoneyHackMin) / (avgMoneyHackMax - avgMoneyHackMin);

    let levelRatio = (playerDetails.hackingLevel - servers[hostname].hackingLevel) / playerDetails.hackingLevel;
    let normalizedLevelRatio = (levelRatio - levelRatioMin) / (levelRatioMax - levelRatioMin);

    let baseTime = ((2.5 * servers[hostname].hackingLevel * servers[hostname].minSecurityLevel + 500) / (playerDetails.hackingLevel + 50)) / playerDetails.speed;
    let normalizedBaseTime = 1 - ((baseTime - baseTimeMin) / (baseTimeMax - baseTimeMin));

    serverExtraData[hostname] = {
      fullHackCycles,
    };

    ns.print(`hostname:${hostname}, normalizedGrowth: ${normalizedGrowth}, normalizedAvgMoneyHack: ${normalizedAvgMoneyHack}, normalizedlevelRatio ${normalizedLevelRatio}`);

  	var serverValue;
  	switch (heuristic) {
  		case settings.heuristics.TRAINING:
  			serverValue = normalizedLevelRatio;
  			break;
  		default:
  			serverValue = normalizedAvgMoneyRate;
  	}

      return {
        hostname,
        serverValue,
        minSecurityLevel: servers[hostname].minSecurityLevel,
        securityLevel: ns.getServerSecurityLevel(hostname),
        maxMoney: servers[hostname].maxMoney,
      };
    });

  weightedServers.sort((a, b) => b.serverValue - a.serverValue);
  ns.print(JSON.stringify(weightedServers, null, 2));

  return weightedServers.map((server) => server.hostname);
}

export async function main(ns) {
  if (!settings.silent) ns.tprint(`[${localeHHMMSS()}] Starting hack.js`);

  let hostname = ns.getHostname();

  if (hostname !== 'home') {
    throw new Error('Run the script from home');
  }

  var doneWithTraining = false;

  while (true) {
    const serverExtraData = {};
    const serverMap = getItem(settings.keys.serverMap);
    if (serverMap.servers.home.ram >= settings.homeRamBigMode) {
      settings.homeRamReserved = settings.homeRamReservedBase + settings.homeRamExtraRamReserved;
    }

    if (!serverMap || serverMap.lastUpdate < new Date().getTime() - settings.mapRefreshInterval) {
      ns.tprint(`[${localeHHMMSS()}] Spawning spider.js`);
      ns.spawn('spider.js', 1, 'hack.js');
      ns.exit();
      return;
    }
    serverMap.servers.home.ram = Math.max(0, serverMap.servers.home.ram - settings.homeRamReserved);

    let hackableServersWithRam = getHackableServersWithRam(ns, serverMap.servers);
    await hackableServersWithRam.reduce(async (prev, hostname) => {await prev; return ns.scp(hackScripts, hostname)});
    //remove hacknet servers to not dampen hash production
    if (settings.ignoreHacknet) {
      hackableServersWithRam = hackableServersWithRam.filter(serverName =>
        !serverName.includes("hacknet"));
    }
    const hackableServers = getHackableServers(ns, serverMap.servers);

  	if (!settings.pureTraining && !doneWithTraining && ns.getTimeSinceLastAug() > settings.trainHackingFor) {
      if(!doneWithTraining) {
    		ns.tprint("Done training after since it's been more than " + (settings.trainHackingFor/(1000 * 60)) + " min since aug.");
    		doneWithTraining = true;
      }
  		for (let i = 0; i < hackableServersWithRam.length; i++) {
  			const server = serverMap.servers[hackableServersWithRam[i]];
  			ns.scriptKill("w.js", server.host);
  		}
  	}

    let hackCycles = 0;
    let growCycles = 0;
    let weakenCycles = 0;

    for (let i = 0; i < hackableServersWithRam.length; i++) {
      const server = serverMap.servers[hackableServersWithRam[i]];
      hackCycles += Math.floor(server.ram / 1.7);
      growCycles += Math.floor(server.ram / 1.75);
    }
    weakenCycles = growCycles;

	  const heuristic = (!doneWithTraining || settings.pureTraining) ? settings.heuristics.TRAINING : settings.heuristics.MONEY;
    const targetServers = findTargetServer(ns, hackableServers, serverMap.servers, serverExtraData, heuristic);
    const bestTarget = settings.targetOverride || targetServers.shift();

// =============================== original line ===============================
/**
 *     const hackTime = ns.getHackTime(bestTarget) * 1000;
 */
// =============================================================================
    const hackTime = ((...a)=>ns.getHackTime(...a)/1000)(bestTarget) * 1000;
// =============================== original line ===============================
/**
 *     const growTime = ns.getGrowTime(bestTarget) * 1000;
 */
// =============================================================================
    const growTime = ((...a)=>ns.getGrowTime(...a)/1000)(bestTarget) * 1000;
// =============================== original line ===============================
/**
 *     const weakenTime = ns.getWeakenTime(bestTarget) * 1000;
 */
// =============================================================================
    const weakenTime = ((...a)=>ns.getWeakenTime(...a)/1000)(bestTarget) * 1000;

    const growDelay = Math.max(0, weakenTime - growTime - 15 * 1000);
    const hackDelay = Math.max(0, growTime + growDelay - hackTime - 15 * 1000);

    const securityLevel = ns.getServerSecurityLevel(bestTarget);
    const money = ns.getServerMoneyAvailable(bestTarget);

    let action = 'training';
    if (settings.pureTraining) {
      action = 'puretraining';
	  } else if (securityLevel > serverMap.servers[bestTarget].minSecurityLevel + settings.minSecurityLevelOffset) {
      action = 'weaken';
    } else if (money < serverMap.servers[bestTarget].maxMoney * settings.maxMoneyMultiplayer) {
      action = 'grow';
    } else {
      action = 'hack';
    }

    if (!settings.silent) {
      ns.tprint(
        `[${localeHHMMSS()}] Selected ${bestTarget} for a target. Planning to ${action} the server. Will wake up around ${localeHHMMSS(
          new Date().getTime() + weakenTime + 300
        )}`
      );
      ns.tprint(
        `[${localeHHMMSS()}] Stock values: baseSecurity: ${serverMap.servers[bestTarget].baseSecurityLevel}; minSecurity: ${
          serverMap.servers[bestTarget].minSecurityLevel
        }; maxMoney: $${numberWithCommas(parseInt(serverMap.servers[bestTarget].maxMoney, 10))}`
      );
      ns.tprint(`[${localeHHMMSS()}] Current values: security: ${Math.floor(securityLevel * 1000) / 1000}; money: $${numberWithCommas(parseInt(money, 10))}`);
      ns.tprint(
        `[${localeHHMMSS()}] Time to: hack: ${convertMSToHHMMSS(hackTime)}; grow: ${convertMSToHHMMSS(growTime)}; weaken: ${convertMSToHHMMSS(weakenTime)}`
      );
      ns.tprint(`[${localeHHMMSS()}] Delays: ${convertMSToHHMMSS(hackDelay)} for hacks, ${convertMSToHHMMSS(growDelay)} for grows`);
    }

  	if (action === 'puretraining') {
  		for (let i = 0; i < hackableServersWithRam.length; i++) {
  			const server = serverMap.servers[hackableServersWithRam[i]];
  			let cyclesFittable = Math.max(0, Math.floor(server.ram / 1.75));

  			if (cyclesFittable && ns.ps(server.host).every(ps => ps.filename != 'w.js')) {
  			  await ns.exec('w.js', server.host, cyclesFittable, bestTarget, cyclesFittable, 0, createUUID(), true);
  			  weakenCycles -= cyclesFittable;
  			}
  		}
    } else if (action === 'weaken') {
      if (settings.changes.weaken * weakenCycles > securityLevel - serverMap.servers[bestTarget].minSecurityLevel) {
        weakenCycles = Math.ceil((securityLevel - serverMap.servers[bestTarget].minSecurityLevel) / settings.changes.weaken);
        growCycles -= weakenCycles;
        growCycles = Math.max(0, growCycles);

        weakenCycles += weakenCyclesForGrow(growCycles);
        growCycles -= weakenCyclesForGrow(growCycles);
        growCycles = Math.max(0, growCycles);
      } else {
        growCycles = 0;
      }

      ns.tprint(
        `[${localeHHMMSS()}] Cycles ratio: ${growCycles} grow cycles; ${weakenCycles} weaken cycles; expected security reduction: ${
          Math.floor(settings.changes.weaken * weakenCycles * 1000) / 1000
        }`
      );
	    ns.tprint(
        `[${localeHHMMSS()}] Expected money after grow cycles: $${
          numberWithCommas(Math.floor(getMoneyAfterGrowCycles(ns, bestTarget, growCycles) * 1000) / 1000)
        }`
      );

      for (let i = 0; i < hackableServersWithRam.length; i++) {
        const server = serverMap.servers[hackableServersWithRam[i]];
        let cyclesFittable = Math.max(0, Math.floor(server.ram / 1.75));
        const cyclesToRun = Math.max(0, Math.min(cyclesFittable, growCycles));

        if (growCycles) {
          await ns.exec('g.js', server.host, cyclesToRun, bestTarget, cyclesToRun, growDelay, createUUID());
          growCycles -= cyclesToRun;
          cyclesFittable -= cyclesToRun;
        }

        if (cyclesFittable) {
          await ns.exec('w.js', server.host, cyclesFittable, bestTarget, cyclesFittable, 0, createUUID());
          weakenCycles -= cyclesFittable;
        }
      }
    } else if (action === 'grow') {
      weakenCycles = weakenCyclesForGrow(growCycles);
      growCycles -= weakenCycles;

      ns.tprint(`[${localeHHMMSS()}] Cycles ratio: ${growCycles} grow cycles; ${weakenCycles} weaken cycles`);
	    ns.tprint(
        `[${localeHHMMSS()}] Expected money after grow cycles: $${
          numberWithCommas(Math.floor(getMoneyAfterGrowCycles(ns, bestTarget, growCycles) * 1000) / 1000)
        }`
      );

      for (let i = 0; i < hackableServersWithRam.length; i++) {
        const server = serverMap.servers[hackableServersWithRam[i]];
        let cyclesFittable = Math.max(0, Math.floor(server.ram / 1.75));
        const cyclesToRun = Math.max(0, Math.min(cyclesFittable, growCycles));

        if (growCycles) {
          await ns.exec('g.js', server.host, cyclesToRun, bestTarget, cyclesToRun, growDelay, createUUID());
          growCycles -= cyclesToRun;
          cyclesFittable -= cyclesToRun;
        }

        if (cyclesFittable) {
          await ns.exec('w.js', server.host, cyclesFittable, bestTarget, cyclesFittable, 0, createUUID());
          weakenCycles -= cyclesFittable;
        }
      }
    } else {
      if (hackCycles > serverExtraData[bestTarget].fullHackCycles) {
        hackCycles = serverExtraData[bestTarget].fullHackCycles;

        if (hackCycles * 100 < growCycles) {
          hackCycles *= 10;
        }

        growCycles = Math.max(0, growCycles - Math.ceil((hackCycles * 1.7) / 1.75));

        weakenCycles = weakenCyclesForGrow(growCycles) + weakenCyclesForHack(hackCycles);
        growCycles -= weakenCycles;
        hackCycles -= Math.ceil((weakenCyclesForHack(hackCycles) * 1.75) / 1.7);

        growCycles = Math.max(0, growCycles);
      } else {
        growCycles = 0;
        weakenCycles = weakenCyclesForHack(hackCycles);
        hackCycles -= Math.ceil((weakenCycles * 1.75) / 1.7);
      }

      ns.tprint(`[${localeHHMMSS()}] Cycles ratio: ${hackCycles} hack cycles; ${growCycles} grow cycles; ${weakenCycles} weaken cycles`);
      ns.tprint(
          `[${localeHHMMSS()}] Expected hack money: $${
            numberWithCommas(Math.floor(getExpectedHackMoney(ns, bestTarget, hackCycles) * 1000) / 1000)
          }`
        );

      for (let i = 0; i < hackableServersWithRam.length; i++) {
        const server = serverMap.servers[hackableServersWithRam[i]];
        let cyclesFittable = Math.max(0, Math.floor(server.ram / 1.7));
        const cyclesToRun = Math.max(0, Math.min(cyclesFittable, hackCycles));

        if (hackCycles) {
          await ns.exec('h.js', server.host, cyclesToRun, bestTarget, cyclesToRun, hackDelay, createUUID());
          hackCycles -= cyclesToRun;
          cyclesFittable -= cyclesToRun;
        }

        const freeRam = server.ram - cyclesToRun * 1.7;
        cyclesFittable = Math.max(0, Math.floor(freeRam / 1.75));

        if (cyclesFittable && growCycles) {
          const growCyclesToRun = Math.min(growCycles, cyclesFittable);

          await ns.exec('g.js', server.host, growCyclesToRun, bestTarget, growCyclesToRun, growDelay, createUUID());
          growCycles -= growCyclesToRun;
          cyclesFittable -= growCyclesToRun;
        }

        if (cyclesFittable) {
          await ns.exec('w.js', server.host, cyclesFittable, bestTarget, cyclesFittable, 0, createUUID());
          weakenCycles -= cyclesFittable;
        }
      }
    }

    await ns.sleep(weakenTime + 300);
  }
}
