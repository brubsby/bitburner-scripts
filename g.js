// Dumb grow worker. Does exactly one grow and exits.
//
//   run g.js <target> <additionalMsec> [id]
//
// See h.js for why the delay is passed as `additionalMsec` rather than slept
// off first, and why this file has no guards in it.

export async function main(ns) {
  // args[3] === 1: move the server's stock (batch.js, nodeecon.stockFlagFor)
  await ns.grow(ns.args[0], { additionalMsec: ns.args[1] || 0, stock: ns.args[3] === 1 })
}
