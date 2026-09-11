// Dumb hack worker. Does exactly one hack and exits.
//
//   run h.js <target> <additionalMsec> [id]
//
// The delay is passed to the game as `additionalMsec` rather than slept off
// first. That difference is the whole reason this file was rewritten.
//
// Sleeping and then calling ns.hack means the operation reads the world at
// *wake* time: it samples security then, and its duration is computed from
// that. A correct batch deliberately elevates security for half of every
// cycle — for one separation after the hack lands and one after the grow
// lands — so half of all wake instants are unsafe, and an operation that wakes
// in one runs 10-60x the separation longer than planned. That is enough to
// reorder the batch, and it is the dominant desync mechanism (docs/prior-art.md
// section 9).
//
// additionalMsec instead decouples launch from landing: every operation in a
// batch is launched in one burst, reads the same level and the same security,
// and simply waits longer inside the game's own timer. Relative landing offsets
// are then exact by construction.
//
// `id` is unused by the script and exists only so the controller can launch
// several otherwise-identical workers on one host — Bitburner treats scripts
// with identical args as the same process.
//
// Keep this file minimal. RAM is charged per NS function referenced anywhere in
// a script's import graph and then multiplied by the thread count, so one
// stray guard call here costs hundreds of GB across a large batch.

export async function main(ns) {
  await ns.hack(ns.args[0], { additionalMsec: ns.args[1] || 0 })
}
