// ONE Singularity identifier, then exit: ns.singularity.workForFaction.
// A faction offers some of hacking / field / security work (FactionInfo.tsx
// offerHackingWork etc.) — Slum Snakes has no hacking contracts — so the
// requested type is tried first and the others follow until one starts.
import { humanAtScreen, startFocused } from 'human.js'
/** @param {NS} ns */
export async function main(ns) {
  // While a human is at the window (human.js), keep the screen as it is: a
  // focused start takes it over, and an unfocused one while focused jumps to
  // the Terminal. upkeep.js focuses it once they go idle.
  const focus = startFocused(humanAtScreen(ns))
  const [name, type = 'hacking'] = ns.args
  const order = [String(type), ...['hacking', 'field', 'security'].filter((t) => t !== String(type))]
  let ok = false
  let used = null
  let error = null
  try {
    for (const t of order) {
      if (ns.singularity.workForFaction(String(name), t, focus)) {
        ok = true
        used = t
        break
      }
    }
  } catch (e) {
    error = String(e).slice(0, 120)
  }
  ns.write('/tel/act-result.txt', JSON.stringify({ at: new Date().toISOString(), actor: 'work', args: ns.args, ok, type: used, error }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/act-result.txt', 'home', ns.getHostname())
}
