// caps/go-cheat.js — the arm compiled in when this save CANNOT call ns.go.cheat.*
//   sfgate.canUseGoCheat(resetInfo) === false
//   (netscriptGoImplementation.ts:488-489: sf14 > 1, OR sf14 === 1 inside BN14)
//
// There is no `if` anywhere in go.js deciding between this and go-cheat-on.js.
// The decision is which file the import resolves to, and it is made once, in
// tools/compile/build.mjs, from a profile read out of the live save.
//
// What this buys, precisely: go.js's cheat path references ns.exec (1.3GB),
// ns.isRunning (0.1GB) and ns.fileExists (0.1GB), and the probe that decided
// whether to use it referenced ns.getResetInfo (1GB). None of those names is in
// this file, so none of them is in the bundle, so none of them is on the bill.
// Netscript prices identifiers, not reachability (Script/RamCalculations.ts:407)
// — which is exactly why a runtime gate could never have done this.
//
// This module must contain NO ns calls at all. That is checkable and it is
// checked: build.mjs prices every output and fails on any increase.

/** Is the cheat API usable in this life? Compiled answer: no. */
export const cheatAvailable = () => false

/**
 * Ask for a cheat. Returns false — "I did not play a move" — which is the same
 * answer the real implementation gives when the helper could not be launched,
 * so go.js has one code path and not two.
 */
export async function requestCheat() {
  return false
}
