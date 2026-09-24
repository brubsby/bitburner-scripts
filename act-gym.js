// ONE Singularity call, then exit: ns.singularity.gymWorkout(gym, stat, focus).
// `stat` is the GymType short code (str/def/dex/agi); the player must be in the gym's city.
import { humanAtScreen, startFocused } from 'human.js'
/** @param {NS} ns */
export async function main(ns) {
  // While a human is at the window (human.js), keep the screen as it is: a
  // focused start takes it over, and an unfocused one while focused jumps to
  // the Terminal. upkeep.js focuses it once they go idle.
  const focus = startFocused(humanAtScreen(ns))
  const [gym, stat] = ns.args
  let ok = false
  let error = null
  try {
    ok = ns.singularity.gymWorkout(String(gym), String(stat), focus)
  } catch (e) {
    error = String(e).slice(0, 120)
  }
  ns.write('/tel/act-result.txt', JSON.stringify({ at: new Date().toISOString(), actor: 'gym', args: ns.args, ok, error }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/act-result.txt', 'home', ns.getHostname())
}
