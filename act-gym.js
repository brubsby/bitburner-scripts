// ONE Singularity call, then exit: ns.singularity.gymWorkout(gym, stat, focus).
// `stat` is the GymType short code (str/def/dex/agi); the player must be in the gym's city.
/** @param {NS} ns */
export async function main(ns) {
  const [gym, stat] = ns.args
  let ok = false
  let error = null
  try {
    ok = ns.singularity.gymWorkout(String(gym), String(stat), true)
  } catch (e) {
    error = String(e).slice(0, 120)
  }
  ns.write('/tel/act-result.txt', JSON.stringify({ at: new Date().toISOString(), actor: 'gym', args: ns.args, ok, error }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/act-result.txt', 'home', ns.getHostname())
}
