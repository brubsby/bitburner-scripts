// THE CHARISMA FARM WORKER (BitNode 15): one thread, ns.dnet.heartbleed on the cheapest target in reach,
// forever. 1.6 + 0.6 = 2.2GB (RamCostGenerator.ts dnet.heartbleed).
//
//   run dnet-cha.js [target=darkweb] [--once-min M]     (dnet-seed.js runs N copies from home)
//
// Each call gives 50 x charisma_exp x (500 + charisma) / 500 exp whatever the threads (Darknet.ts:276) and
// takes 1.5 x the target's authentication time (threads only shorten it by 1 + 0.2(t-1)), so the farm is
// many ONE-thread copies (chaplan.js: exp per GB is 5x a 5-thread copy's). darkweb is the target from home:
// required charisma 1, difficulty 0, never underleveled — the fastest heartbleed there is.
// peek: true, so the farm does not consume the server's logs (a crawler may be reading them for feedback).
//
// Reports: none per call (thousands a minute); dnet-seed.js counts its copies and reads the charisma it
// moves (/tel/dnet-cha.txt). A copy that cannot reach its target exits and says so on DNET_PORT.
import { DNET_PORT } from 'dnetplan.js'

export async function main(ns) {
  ns.disableLog('ALL')
  const flags = ns.flags([['once-min', 0]])
  const target = String(flags._[0] ?? 'darkweb')
  const until = flags['once-min'] > 0 ? Date.now() + flags['once-min'] * 60e3 : Infinity
  let fails = 0
  while (Date.now() < until) {
    const r = await ns.dnet.heartbleed(target, { peek: true, logsToCapture: 1 })
    if (r?.success) {
      fails = 0
      continue
    }
    if (++fails >= 5) {
      ns.writePort(DNET_PORT, JSON.stringify({ at: Date.now(), from: ns.getHostname(), t: 'farm-stop', host: target, why: `heartbleed ${target}: code ${r?.code} ${String(r?.message ?? '').slice(0, 80)}` }))
      return
    }
    await ns.sleep(1000)
  }
}
