// caps/buy.js — the arm compiled in when the Singularity API IS callable
//   sfgate.canUseSingularity(resetInfo) === true
//
// Like caps/go-cheat-on.js, this file does NOT contain the gated calls. It
// execs autobuy-sing.js, which is where ns.singularity.purchaseTor and
// ns.singularity.purchaseProgram live, for the same reason: 4GB base and 64GB
// at SF4.1 (RamCostGenerator.ts:82-96) is not something autobuy.js can carry,
// because autobuy.js is in boot.js's STACK and watchdog.js's WATCHED list and
// starts life at a home size of 8, 32 or 128GB (Prestige.ts:242-248).
//
// The terminal arm is imported, not replaced. `ns.exec` returning 0 for lack of
// RAM is routine when the batcher has the fleet near full, and the terminal
// route works at every Source-File level — so falling back cannot be worse than
// not having tried. That is also why bridgeBusy is re-exported rather than
// reimplemented: two copies of "is the bridge free" is how they stop agreeing.

import { bridgeBusy as terminalBusy, buy as terminalBuy, TOR_ADVICE as TERMINAL_TOR_ADVICE } from './buy-terminal.js'

const HELPER = 'autobuy-sing.js'

export const ROUTE = 'singularity'

/** ns.singularity.purchaseTor has no darkweb prerequisite, so yes. */
export const CAN_BUY_TOR = true

/** Unreachable in this arm, but kept so the two modules have one interface. */
export const TOR_ADVICE = TERMINAL_TOR_ADVICE

export const bridgeBusy = terminalBusy

/**
 * Buy `items` (program filenames, or 'tor') through the helper, falling back to
 * the terminal if there is no RAM for it.
 *
 * TOR has no terminal equivalent (see caps/buy-terminal.js CAN_BUY_TOR), so on
 * a fallback it is reported as deferred rather than quietly dropped — the
 * caller un-marks it and asks again next pass.
 */
export function buy(ns, items) {
  const pid = ns.exec(HELPER, 'home', 1, ...items)
  if (pid) return { route: ROUTE, requested: items, deferred: [] }

  ns.print(`autobuy: no RAM for ${HELPER}, falling back to the terminal`)
  const fell = terminalBuy(ns, items)
  return { route: `${ROUTE}->${fell.route}`, requested: fell.requested, deferred: fell.deferred }
}
