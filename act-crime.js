// ONE Singularity call, then exit: ns.singularity.commitCrime(type, focus).
// The game repeats the crime on its own until other work replaces it
// (Work/CrimeWork.ts:process loops), so a single call is a crime LOOP.
/** @param {NS} ns */
export async function main(ns) {
  const [type] = ns.args
  let ms = 0
  let error = null
  try {
    ms = ns.singularity.commitCrime(String(type), true)
  } catch (e) {
    error = String(e).slice(0, 120)
  }
  ns.write('/tel/act-result.txt', JSON.stringify({ at: new Date().toISOString(), actor: 'crime', args: ns.args, ok: ms > 0, ms, error }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/act-result.txt', 'home', ns.getHostname())
}
