// SELL EVERY STOCK POSITION, then exit. Run by act.js before a batch that
// spends the trader's equity (progress.js prefixes it) and, unconditionally,
// before every install.
//
// WHY: an install re-initialises the stock market (Prestige.ts:166-170), so
// an open position is DESTROYED, not refunded — and in BitNode 8, where the
// stock trader is the only income, that is the whole portfolio. The planner
// also counts equity as money (exitInputsOf), which is only true once sold.
//
// It first writes /tel/stock-hold.txt so the trader (stock.js, nodeecon.js
// has the interface) opens nothing new until the install lands, cancels any
// resting limit/stop order (one could re-buy after the sale), then sells long
// and short positions. `ok` is decided by READING THE POSITIONS BACK, not by
// the sale calls' return values: every position must read zero.
//
// No TIX API access means no scripted position can exist and none can be
// sold: that is `ok` with a note, not a failure — act.js runs this before
// every install in every node.
/** @param {NS} ns */
export async function main(ns) {
  const at = new Date().toISOString()
  const res = { at, actor: 'liquidate', args: ns.args, ok: false, sold: [], proceeds: 0, error: null }
  const home = ns.getHostname() === 'home'
  const put = (file, obj) => {
    ns.write(file, JSON.stringify(obj), 'w')
    if (!home) ns.scp(file, 'home', ns.getHostname())
  }
  try {
    put('/tel/stock-hold.txt', { at, lastAugReset: ns.getResetInfo().lastAugReset, by: 'act-liquidate.js', why: String(ns.args[0] ?? 'all') })
    if (!ns.stock.hasTixApiAccess()) {
      res.ok = true
      res.note = 'no TIX API access: no scripted position can be open, none can be sold'
    } else {
      const syms = ns.stock.getSymbols()
      // Resting orders exist only in BN8 or with SF8.3; getOrders throws otherwise.
      try {
        const orders = ns.stock.getOrders()
        for (const [sym, list] of Object.entries(orders ?? {}))
          for (const o of list ?? []) ns.stock.cancelOrder(sym, o.shares, o.price, o.type, o.position)
      } catch {
        /* no order access in this node: nothing can be resting */
      }
      for (const sym of syms) {
        const [long, , short] = ns.stock.getPosition(sym)
        if (long > 0) {
          const p = ns.stock.sellStock(sym, long)
          if (p > 0) res.proceeds += p * long
          res.sold.push({ sym, long, price: p })
        }
        if (short > 0) {
          const p = ns.stock.sellShort(sym, short)
          res.sold.push({ sym, short, price: p })
        }
      }
      const open = syms.filter((s) => {
        const [l, , sh] = ns.stock.getPosition(s)
        return l > 0 || sh > 0
      })
      res.ok = open.length === 0
      if (open.length) res.error = `still open after selling: ${open.join(', ')}`
    }
  } catch (e) {
    res.error = String(e).slice(0, 160)
  }
  put('/tel/act-result.txt', res)
}
