// ONE Singularity call, then exit: ns.singularity.universityCourse(uni, course, focus).
/** @param {NS} ns */
export async function main(ns) {
  const [uni, course] = ns.args
  let ok = false, error = null
  try { ok = ns.singularity.universityCourse(String(uni), String(course), true) } catch (e) { error = String(e).slice(0, 120) }
  ns.write('/tel/act-result.txt', JSON.stringify({ at: new Date().toISOString(), actor: 'course', args: ns.args, ok, error }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/act-result.txt', 'home', ns.getHostname())
}
