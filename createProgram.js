import { runCallbackExit } from "common.js"

const intelligence_exp_divisor = 200
const milliseconds_per_twenty_hours = 72000000
const milliseconds_per_ten_hours = 36000000
const milliseconds_per_eight_hours = 28800000
const milliseconds_per_four_hours = 14400000
const milliseconds_per_two_hours = 7200000
const milliseconds_per_hour = 3600000
const milliseconds_per_half_hour = 1800000
const milliseconds_per_quarter_hour = 900000
const milliseconds_per_five_minutes = 300000

export const programs = {
    "NUKE.exe": {
        hacking_level_required: 1,
        intelligence_exp: 1 / intelligence_exp_divisor,
        time: milliseconds_per_five_minutes,
        intelligence_exp_per_millisecond: 1 / intelligence_exp_divisor / milliseconds_per_five_minutes
    },
    "BruteSSH.exe": {
        hacking_level_required: 50,
        intelligence_exp: 50 / intelligence_exp_divisor,
        time: milliseconds_per_five_minutes * 2,
        intelligence_exp_per_millisecond: 50 / intelligence_exp_divisor / (milliseconds_per_five_minutes * 2),
        price: 500e3,
        port_program: true
    },
    "FTPCrack.exe": {
        hacking_level_required: 100,
        intelligence_exp: 100 / intelligence_exp_divisor,
        time: milliseconds_per_half_hour,
        intelligence_exp_per_millisecond: 100 / intelligence_exp_divisor / milliseconds_per_half_hour,
        price: 1500e3,
        port_program: true
    },
    "relaySMTP.exe": {
        hacking_level_required: 250,
        intelligence_exp: 250 / intelligence_exp_divisor,
        time: milliseconds_per_two_hours,
        intelligence_exp_per_millisecond: 250 / intelligence_exp_divisor / milliseconds_per_two_hours,
        price: 5e6,
        port_program: true
    },
    "HTTPWorm.exe": {
        hacking_level_required: 500,
        intelligence_exp: 500 / intelligence_exp_divisor,
        time: milliseconds_per_four_hours,
        intelligence_exp_per_millisecond: 500 / intelligence_exp_divisor / milliseconds_per_four_hours,
        price: 30e6,
        port_program: true
    },
    "SQLInject.exe": {
        hacking_level_required: 750,
        intelligence_exp: 750 / intelligence_exp_divisor,
        time: milliseconds_per_eight_hours,
        intelligence_exp_per_millisecond: 750 / intelligence_exp_divisor / milliseconds_per_eight_hours,
        price: 250e6,
        port_program: true
    },
    "DeepscanV1.exe": {
        hacking_level_required: 75,
        intelligence_exp: 75 / intelligence_exp_divisor,
        time: milliseconds_per_quarter_hour,
        intelligence_exp_per_millisecond: 75 / intelligence_exp_divisor / milliseconds_per_quarter_hour,
        price: 500000
    },
    "DeepscanV2.exe": {
        hacking_level_required: 400,
        intelligence_exp: 400 / intelligence_exp_divisor,
        time: milliseconds_per_two_hours,
        intelligence_exp_per_millisecond: 400 / intelligence_exp_divisor / milliseconds_per_two_hours,
        price: 25e6
    },
    "ServerProfiler.exe": {
        hacking_level_required: 75,
        intelligence_exp: 75 / intelligence_exp_divisor,
        time: milliseconds_per_half_hour,
        intelligence_exp_per_millisecond: 75 / intelligence_exp_divisor / milliseconds_per_half_hour,
        price: 1e6
    },
    "AutoLink.exe": {
        hacking_level_required: 25,
        intelligence_exp: 25 / intelligence_exp_divisor,
        time: milliseconds_per_quarter_hour,
        intelligence_exp_per_millisecond: 25 / intelligence_exp_divisor / milliseconds_per_quarter_hour,
        price: 1e6
    },
    "b1t_flum3.exe": {
        hacking_level_required: 1,
        intelligence_exp: 1 / intelligence_exp_divisor,
        time: milliseconds_per_five_minutes / 20,
        intelligence_exp_per_millisecond: 1 / intelligence_exp_divisor / milliseconds_per_five_minutes / 20
    }
}

const EPSILON_WAIT_TIME = 1000

function usage(ns) {
    ns.tprint(`Usage: run createProgram.js [--program] &lt${Object.keys(programs).concat(["all"]).join('|')}&gt [[--callback] &ltscript&gt]`)
}

export function getCreateProgramTasks(ns) {
    return Object.keys(programs).filter(program => !ns.fileExists(program, "home"))
        .filter(program => ns.getPlayer().hacking_skill >= programs[program].hacking_level_required)
        .reduce((result, program) => {result[program] = programs[program]; return result}, {})
}

export async function main(ns) {
    let flag_data = ns.flags([
        ["program", ""],
        ["callback", ""],
        ["all", false],
        ["help", false]
    ])

    let program = flag_data.program || flag_data._[0]
    let callback = flag_data.callback || flag_data._[1]
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

    while(true) {
        if (all) program = Object.keys(getCreateProgramTasks(ns)).shift()
        let startSuccess = ns.createProgram(program)
        if (startSuccess) {
            //await ns.sleep(programs[program].time)
            while (ns.isBusy()) await ns.sleep(EPSILON_WAIT_TIME)
        } else {
            ns.tprint(`Failed to start creating ${program} for an unknown reason.`)
            runCallbackExit(ns, flag_data.callback)
        }
        if (!all) break;
    }
    runCallbackExit(ns, flag_data.callback)
}
