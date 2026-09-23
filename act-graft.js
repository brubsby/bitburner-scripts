// ONE Grafting call, then exit: ns.grafting.graftAugmentation(name, focus).
//
// THE RETURN VALUE IS THE WHOLE POINT. graftAugmentation RETURNS FALSE — it
// does not throw — when the money is short or the prerequisites are not met
// (NetscriptFunctions/Grafting.ts:66-77), and `getGraftingAvailableAugs()` does
// NOT filter on prerequisites, so an augmentation can be offered by the game's
// own list and still refuse. Discarding the boolean would report a graft that
// was started and never was: money unspent, work slot idle, telemetry green.
// That is invariant C8's shape, in an API that has no exception to catch.
//
// Grafting also requires being in New Tokyo and THROWS otherwise (Grafting.ts:58),
// which is a separate failure from a refusal and is recorded as one.
/** @param {NS} ns */
export async function main(ns) {
  const [name, focusArg] = ns.args
  const focus = focusArg === undefined ? true : String(focusArg) !== 'false'
  let ok = false
  let error = null
  let refused = null
  try {
    ok = ns.grafting.graftAugmentation(String(name), focus) === true
    if (!ok) {
      // Say WHICH of the two refusals it was, rather than "it returned false".
      // A diagnostic that misnames its cause costs the reader more than none.
      const price = (() => {
        try {
          return ns.grafting.getAugmentationGraftPrice(String(name))
        } catch {
          return null
        }
      })()
      const money = ns.getPlayer().money
      refused =
        typeof price === 'number' && money < price
          ? `money short: $${Math.round(money)} of $${Math.round(price)}`
          : 'prerequisites not met, or the augmentation is not graftable — the availability list does not filter prerequisites'
    }
  } catch (e) {
    error = String(e).slice(0, 160)
  }
  ns.write(
    '/tel/act-result.txt',
    JSON.stringify({ at: new Date().toISOString(), actor: 'graft', args: ns.args, ok, refused, error }),
    'w',
  )
  if (ns.getHostname() !== 'home') ns.scp('/tel/act-result.txt', 'home', ns.getHostname())
}
