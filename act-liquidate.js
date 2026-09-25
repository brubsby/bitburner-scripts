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
// PARTIAL ('raise', dollars): sell just enough — largest positions first —
// for home cash to reach `dollars`, so a purchase batch (progress.js sizes it
// to the batch's costs) does not dump a compounding book (BitNode 8: the
// trader's capital is the only income). The hold it writes keeps the trader
// from re-investing the raised cash before the purchase runs. `ok` is again
// read back: cash >= dollars after the sales.
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
    put('/tel/stock-hold.txt', { at, lastAugReset: ns.getResetInfo().lastAugReset, by: 'act-liquidate.js', why: ns.args.map(String).join(' ') || 'all' })
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
      const raise = String(ns.args[0] ?? '') === 'raise' ? Number(ns.args[1]) : null
      if (raise !== null) {
        if (!(raise > 0) || !isFinite(raise)) throw new Error(`raise needs a positive amount, got ${ns.args[1]}`)
        res.target = raise
        // Up to three passes: selling at the bid returns a little less than
        // the mid the sizing used, so a pass can land just short.
        for (let pass = 0; pass < 3 && ns.getServerMoneyAvailable('home') < raise; pass++) {
        const book = syms
          .map((sym) => {
            const [long, , short] = ns.stock.getPosition(sym)
            return { sym, long, short, v: (long + short) * ns.stock.getPrice(sym) }
          })
          .filter((x) => x.v > 0)
          .sort((a, b) => b.v - a.v)
        for (const x of book) {
          const need = raise - ns.getServerMoneyAvailable('home')
          if (need <= 0) break
          // Commission is flat per trade (StockMarketConstants.StockMarketCommission).
          const want = need + 2 * ns.stock.getConstants().StockMarketCommission
          if (x.long > 0) {
            const bid = ns.stock.getPrice(x.sym) // the mid; the ceil + commission margin covers the spread
            const n = Math.min(x.long, Math.ceil(want / bid))
            const p = ns.stock.sellStock(x.sym, n)
            res.sold.push({ sym: x.sym, long: n, price: p })
          } else if (x.short > 0) {
            const ask = ns.stock.getPrice(x.sym)
            const n = Math.min(x.short, Math.ceil(want / ask))
            const p = ns.stock.sellShort(x.sym, n)
            res.sold.push({ sym: x.sym, short: n, price: p })
          }
        }
        }
        res.cash = ns.getServerMoneyAvailable('home')
        res.ok = res.cash >= raise
        if (!res.ok) res.error = `raised to $${Math.round(res.cash)} of $${Math.round(raise)} — the book cannot cover it`
        put('/tel/act-result.txt', res)
        return
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
