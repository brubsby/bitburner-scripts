const settings = {
  mapRefreshInterval: 24 * 60 * 60 * 1000,
  keys: {
    serverMap: 'BB_SERVER_MAP',
  },
}
const scriptsToKill = [
  'hack.js',
  'g.js',
  'h.js',
  'w.js',
]

function getItem(key) {
  let item = localStorage.getItem(key)

  return item ? JSON.parse(item) : undefined
}

function localeHHMMSS(ms = 0) {
  if (!ms) {
    ms = new Date().getTime()
  }

  return new Date(ms).toLocaleTimeString()
}

export async function main(ns) {
  ns.tprint(`[${localeHHMMSS()}] Starting killhack.js`)

  const scriptToRunAfter = ns.args[0]

  let hostname = ns.getHostname()

  for (let i = 0; i < scriptsToKill.length; i++) {
    await ns.scriptKill(scriptsToKill[i], 'home')
  }

  const serverMap = getItem(settings.keys.serverMap)

  if (!serverMap) {
    throw new Error("Couldn't find server map, exiting...");
    ns.exit();
    return;
  }

  const killAbleServers = Object.keys(serverMap.servers)
    .filter((hostname) => ns.serverExists(hostname))
    .filter((hostname) => hostname !== 'home')

  await killAbleServers.forEach(async server =>
    scriptsToKill.forEach(async script =>
      ns.scriptKill(script, server)));

  ns.tprint(`[${localeHHMMSS()}] All hack processes killed`)

  if (scriptToRunAfter) {
    ns.tprint(`[${localeHHMMSS()}] Spawning ${scriptToRunAfter}`)
    ns.spawn(scriptToRunAfter, 1)
  }
}
