// Performs a single IPvGO cheat. Exists as a separate script purely to isolate
// its RAM cost.
//
//   run go-cheat.js twoMoves 3 4 5 6
//   run go-cheat.js removeRouter 3 4
//   run go-cheat.js repairNode 3 4
//   run go-cheat.js destroyNode 3 4
//
// Netscript charges a script for every ns function anywhere in its import
// graph, whether or not the call is ever reached — so a reference to
// ns.go.cheat.* inside go.js would cost that RAM in every BitNode, including
// the ones where the API throws "requires Source-File 14.2" on contact. Scripts
// are billed independently, so putting the gated calls behind their own file
// means the cost is paid only when a life can actually use them.
//
// That is the general shape for optional, Source-File-gated capability: probe
// cheaply in the caller (ns.getResetInfo().ownedSF, 1GB), and keep the
// expensive gated surface in a helper that is only ever exec'd when the probe
// says it will work.
//
// The caller does not need a return value: every cheat's effect is on the
// board, which the caller re-reads on its next turn anyway. The result is
// written to /tel/go-cheat.txt for diagnosis only.

const STATUS = '/tel/go-cheat.txt'

export async function main(ns) {
  ns.disableLog('ALL')
  const [kind, a, b, c, d] = ns.args
  let result = { at: new Date().toISOString(), kind, ok: false, error: null }

  try {
    switch (kind) {
      case 'twoMoves':
        await ns.go.cheat.playTwoMoves(a, b, c, d)
        break
      case 'removeRouter':
        await ns.go.cheat.removeRouter(a, b)
        break
      case 'repairNode':
        await ns.go.cheat.repairOfflineNode(a, b)
        break
      case 'destroyNode':
        await ns.go.cheat.destroyNode(a, b)
        break
      default:
        throw new Error(`unknown cheat: ${kind}`)
    }
    result.ok = true
  } catch (err) {
    result.error = String(err).slice(0, 300)
  }

  ns.write(STATUS, JSON.stringify(result, null, 2), 'w')
}
