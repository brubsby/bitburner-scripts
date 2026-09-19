// ONE Singularity call, then (the game reloads): ns.singularity.installAugmentations(callback).
// The result file is written BEFORE the call, because nothing runs after a prestige.
/** @param {NS} ns */
export async function main(ns) {
  const [callback = 'boot.js'] = ns.args
  ns.write('/tel/act-result.txt', JSON.stringify({ at: new Date().toISOString(), actor: 'install', args: ns.args, ok: true, note: 'written before the call; a reload follows' }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/act-result.txt', 'home', ns.getHostname())
  try { ns.singularity.installAugmentations(String(callback)) } catch (e) {
    ns.write('/tel/act-result.txt', JSON.stringify({ at: new Date().toISOString(), actor: 'install', args: ns.args, ok: false, error: String(e).slice(0, 120) }), 'w')
    if (ns.getHostname() !== 'home') ns.scp('/tel/act-result.txt', 'home', ns.getHostname())
  }
}
