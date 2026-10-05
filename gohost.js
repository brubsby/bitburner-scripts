// ONE PURCHASE, then exit: a cloud server for go.js in a Go-first node.
//
//   run gohost.js <ram>        exec'd by seed.js (placeGo) when no rooted host
//                              can ever hold go.js and cash covers the server
//
// WHY A ONE-SHOT. ns.cloud.purchaseServer is 2.25GB and getServerCost 0.25GB;
// in seed.js they would be billed on every pass of a daemon that runs on a
// 16GB host from the 8GB opening. Here they are paid for the second it takes.
//
// Live BN14.1 (2026-10-03) and BN14.2 (2026-10-05): go.js idled ~2h at each
// node's start because no rooted host had its 20.75GB; in BN14.1 the lead
// bought the 32GB 'go-host' by hand at 20:50Z. seed.js's next pass places
// go.js on it (raiseplace.goPlacementOf: the tightest fleet fit).
//
// Re-checks everything itself — the name, the limit, the price, the cash — and
// reports what it did or why not to /tel/gohost.txt (on home).
/** @param {NS} ns */
export async function main(ns) {
  const NAME = 'go-host' // raiseplace.GO_HOST ([GF11] holds them equal)
  const FILE = '/tel/gohost.txt'
  const ram = Number(ns.args[0]) || 32
  const res = { at: new Date().toISOString(), ram, ok: false, host: null, cost: null, cash: null, why: null }
  try {
    res.cost = ns.cloud.getServerCost(ram)
    res.cash = ns.getServerMoneyAvailable('home')
    if (ns.serverExists(NAME)) res.why = `${NAME} already exists`
    else if (!(res.cost <= res.cash)) res.why = `$${Math.round(res.cost)} for ${ram}GB, $${Math.round(res.cash)} in hand`
    else {
      // '' at the cloud server limit, or with the money short
      // (Server/ServerPurchases.ts purchaseServer): read back, not trusted.
      const host = ns.cloud.purchaseServer(NAME, ram)
      res.ok = !!host && ns.serverExists(host) && ns.getServerMaxRam(host) === ram
      res.host = host || null
      res.why = res.ok ? `bought ${host} (${ram}GB) for go.js` : `purchaseServer returned '${host}' (cloud server limit reached?)`
    }
  } catch (e) {
    res.why = `threw: ${String(e?.message ?? e).slice(0, 160)}`
  }
  ns.write(FILE, JSON.stringify(res), 'w')
  if (ns.getHostname() !== 'home') ns.scp(FILE, 'home', ns.getHostname())
  ns.tprint(`gohost: ${res.why}`)
}
