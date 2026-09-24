// The Singularity half of backdoor.js, run by act.js. Nothing else belongs here.
//
//   run act-backdoor.js <hop> <hop> ... <target>
//
// Walks the route with ns.singularity.connect, installs the backdoor on the last
// hop, and connects back home. The bridge route (cmd.js typing `connect` and
// `backdoor`) opens the Terminal page, drops focus, and waits for an idle human;
// this touches no screen at all (connect -> Terminal.connectToServer, which
// changes the terminal's server, not the page; Singularity.ts connect /
// installBackdoor).
//
// A separate script for the reason autobuy-sing.js is one: connect and
// installBackdoor are SingularityFn1 x16 at SF4.1 (RamCostGenerator.ts:168,170),
// ~64GB that backdoor.js — a permanent resident from a 32GB home — must never
// carry. Paid only while this runs: one backdoor, calculateHackingTime / 4.
// backdoor.js does not even exec it (1.3GB it cannot spare at 32GB): it posts
// /tel/backdoor-req.txt and act.js, which already places Singularity actors
// off home, launches this.
//
// Refuses w0r1d_d43m0n anywhere in its arguments. That backdoor ends the
// BitNode and endgame.js is the only actor permitted to install it.

import { canUseSingularity } from 'sfgate.js'

const STATUS = '/tel/act-backdoor.txt'
const FORBIDDEN = 'w0r1d_d43m0n'

export async function main(ns) {
  ns.disableLog('ALL')
  const route = ns.args.map(String)
  const target = route[route.length - 1] ?? null
  // Mirrored home: act.js may place this anywhere, and readers look on home (C12).
  const say = (ok, detail) => {
    ns.write(STATUS, JSON.stringify({ at: new Date().toISOString(), target, route, ok, detail }), 'w')
    if (ns.getHostname() !== 'home') ns.scp(STATUS, 'home', ns.getHostname())
  }

  if (!route.length) return say(false, 'no route given')
  if (route.some((h) => h.toLowerCase() === FORBIDDEN)) return say(false, `refused: ${FORBIDDEN} is endgame.js's alone`)
  if (!canUseSingularity(ns.getResetInfo())) return say(false, 'no Singularity (needs SF4 or BitNode 4) — backdoor.js falls back to the cmd.js bridge')

  try {
    ns.singularity.connect('home')
    for (const hop of route) {
      if (!ns.singularity.connect(hop)) {
        say(false, `could not connect to ${hop}`)
        return
      }
    }
    await ns.singularity.installBackdoor()
    say(true, `backdoored ${target}`)
  } catch (e) {
    say(false, String(e).slice(0, 160))
  } finally {
    try {
      ns.singularity.connect('home')
    } catch {
      /* the terminal stays where it was; nothing depends on it */
    }
  }
}
