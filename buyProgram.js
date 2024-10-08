import { runCallbackExit, getServerNames } from "common.js"
import { programs } from "createProgram.js"

const tor_cost = 200e3

function getBuyablePrograms(ns) {
  return Object.fromEntries(Object.entries(programs).filter(programEntry => programEntry[1].price))
}

function getUnownedBuyablePrograms(ns) {
  return Object.fromEntries(Object.entries(getBuyablePrograms(ns)).filter(programEntry => !ns.fileExists(programEntry[0], "home")))
}

function getAffordableUnownedPrograms(ns) {
  return Object.fromEntries(Object.entries(getUnownedBuyablePrograms(ns)).filter(programEntry => ns.getPlayer().money > programEntry[1].price))
}

function getUnownedPortPrograms(ns) {
  return Object.fromEntries(Object.entries(getUnownedBuyablePrograms(ns)).filter(programEntry => programEntry[1].port_program))
}

function getAffordableUnownedPortPrograms(ns) {
  return Object.fromEntries(Object.entries(getUnownedPortPrograms(ns)).filter(programEntry => ns.getPlayer().money > programEntry[1].price))
}

function getMinHackingForNumPorts(ns) {
  let serverNames = getServerNames(ns)
  return [1,2,3,4,5].map((ports) =>
        serverNames.filter(serverName => ns.getServerNumPortsRequired(serverName) == ports)
        .filter(serverName => ns.getServerRequiredHackingLevel(serverName) > 1)
        .map(serverName => ns.getServerRequiredHackingLevel(serverName))
        .reduce((result, next) => next < result ? next : result)
  )
}

function getCurrentNumPortAbility(ns) {
  return Object.entries(programs)
    .filter(programEntry => programEntry[1].port_program)
    .map(programEntry => programEntry[0])
    .reduce((result, next) => result + (ns.fileExists(next, "home") ? 1 : 0), 0)
}

function usage(ns) {
  ns.tprint(`Usage: run ${ns.getScriptName()} [--program] &lt${Object.keys(programs).concat(["all"]).join('|')}&gt [[--callback] &ltscript&gt] [--wait]`)
}

export async function main(ns) {
  let flag_data = ns.flags([
        ["program", ""],
        ["callback", ""],
        ["all", false],
        ["help", false],
        ["tail", false],
        ["wait", false]
    ])

  let program = flag_data.program || flag_data._[0]
  let callback = flag_data.callback || flag_data._[1]
  let wait = flag_data.wait
  let player = ns.getPlayer()
  let all = flag_data.all || program == "all"

  if (!program || flag_data.help) {
      usage(ns)
      runCallbackExit(ns, callback)
  }

  if (!all) {
      if (!Object.keys(programs).includes(program)) {
          ns.tprint(`${program} is not a valid program name, exiting...`)
          runCallbackExit(ns, callback)
      }

      if (ns.fileExists(program, "home")) {
          ns.tprint(`${program} already exists on home computer! exiting...`)
          runCallbackExit(ns, callback)
      }

      if (player.hacking < programs[program].hacking_level_required) {
          ns.tprint(`${program} hacking level requirement (${programs[program].hacking_level_required}) not met (yours: ${player.hacking})`)
          runCallbackExit(ns, callback)
      }
  }

  if (flag_data.tail) {
    ns.tail()
  }

  while(!ns.scan("home").includes("darkweb")) {
    player = ns.getPlayer();
    if (player.money > tor_cost) {
      if(ns.purchaseTor()) {
        ns.tprint("Successfully purchased tor router.")
      } else {
        ns.tprint("Failed to purchase tor router for unknown reason.")
      }
    }
    if (!wait) {
      ns.tprint("Can't afford tor router and not instructed to wait, exiting...")
      runCallbackExit(ns, callback)
    }
    ns.print("Can't afford tor router, sleeping...")
    await ns.sleep(5000)
  }

  if (all) {
    let minHackingForPorts = getMinHackingForNumPorts(ns)
    while (true) {
      let programsToBuy = getUnownedBuyablePrograms(ns)
      let affordablePrograms = getUnownedBuyablePrograms(ns)
      let portProgramsToBuy = getAffordableUnownedPrograms(ns)
      let affordablePortPrograms = getAffordableUnownedPortPrograms(ns)

      if (!Object.keys(programsToBuy).length) {
        ns.tprint("Purchased all programs, exiting...")
        runCallbackExit(ns, callback)
        break;
      }

      // put program lists in priority order
      let programDict
      if (!wait) {
        programDict = [affordablePortPrograms, affordablePrograms, portProgramsToBuy, programsToBuy].find((dict, i) => Object.keys(dict).length)
      } else {
        programDict = [portProgramsToBuy, programsToBuy].find((dict, i) => Object.keys(dict).length)
      }
      let programEntries = Object.entries(programDict).sort((a,b)=>a[1].price-b[1].price)

      while (true) {
        let programToPurchase = Object.entries(programDict).shift()[0]
        let currentNumPortAbility = getCurrentNumPortAbility(ns)
        while (wait && currentNumPortAbility < 5) {
          player = ns.getPlayer()
          if (player.hacking_skill >= minHackingForPorts[currentNumPortAbility]) {
            break;
          }
          ns.print(`Hacking level has not met the required hack level of the minimum ${currentNumPortAbility+1} port server: ${minHackingForPorts[currentNumPortAbility]}, sleeping...`)
          await ns.sleep(5000)
        }
        let success = ns.purchaseProgram(programToPurchase)
        if (success) {
          ns.tprint(`Purchased ${programToPurchase} successfully, continuing...`)
          break;
        }
        ns.print(`Can't afford ${programToPurchase}, sleeping...`)
        await ns.sleep(5000)
      }
    }
  } else {
    if(ns.purchaseProgram(program)) {
      ns.tprint(`Purchased ${program} successfully, exiting...`)
    } else {
      ns.tprint(`Failed to buy ${program}, exiting...`)
    }
    runCallbackExit(ns, callback)
  }
}
