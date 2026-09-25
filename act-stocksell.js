// Liquidate every stock position — run by act.js BEFORE an order batch that
// spends (buyaug / donate / install), because
//   - an install re-initialises the market and every share is lost without
//     refund (Prestige.ts: initStockMarket() builds new Stock objects with
//     playerShares 0), and
//   - an augmentation purchase needs the money in cash, not in positions.
// stock.js also stands down while such a batch is pending (it reads the same
// orders file), so the trader does not buy back in underneath.
// ~10.6GB: getSymbols/getPosition 2 each, sellStock/sellShort 2.5 each.
/** @param {NS} ns */
export async function main(ns) {
  const sold = []
  let ok = true
  let error = null
  try {
    if (ns.stock.hasTixApiAccess()) {
      for (const s of ns.stock.getSymbols()) {
        const [L, , Sh] = ns.stock.getPosition(s)
        if (L > 0) {
          const px = ns.stock.sellStock(s, L)
          if (px > 0) sold.push(`${s} L ${L}`)
          else ok = false
        }
        if (Sh > 0) {
          // sellShort throws outside BN8/SF8.2 — but a short can only exist where it is allowed.
          const px = ns.stock.sellShort(s, Sh)
          if (px > 0) sold.push(`${s} S ${Sh}`)
          else ok = false
        }
      }
    }
  } catch (e) {
    ok = false
    error = String(e).slice(0, 160)
  }
  ns.write('/tel/act-result.txt', JSON.stringify({ at: new Date().toISOString(), actor: 'stocksell', args: ns.args, ok, sold, error }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/act-result.txt', 'home', ns.getHostname())
}
