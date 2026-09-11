// Dumb weaken worker. Does exactly one weaken and exits.
//
//   run w.js <target> <additionalMsec> [id]
//
// See h.js for why the delay is passed as `additionalMsec` rather than slept
// off first, and why this file has no guards in it.
//
// The previous version looped forever when given a fifth argument. A batch
// controller sizes every operation itself and dispatches a fresh worker per
// landing, so a worker that decides to keep going on its own is precisely what
// it cannot use.

export async function main(ns) {
  await ns.weaken(ns.args[0], { additionalMsec: ns.args[1] || 0 })
}
