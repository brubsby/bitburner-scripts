// ONE Singularity call, then (the game reloads): ns.singularity.softReset(callback).
// Run ONLY by act.js's negative-cash escape (nodeecon.softlockStep level 3):
// wealth <= 0, no stock book, nothing earning, over two checks minutes apart,
// with nothing queued to install, where money is capital — a life that can
// never pay for anything again. /tel/softlock.txt holds the evidence and was
// written before this ran; /softlock-hold.txt on home disables the step.
// The result file is written BEFORE the call: nothing runs after a reset.
/** @param {NS} ns */
export async function main(ns) {
  const [callback = 'boot.js'] = ns.args
  const put = (o) => {
    ns.write('/tel/act-result.txt', JSON.stringify({ at: new Date().toISOString(), actor: 'softreset', args: ns.args, ...o }), 'w')
    if (ns.getHostname() !== 'home') ns.scp('/tel/act-result.txt', 'home', ns.getHostname())
  }
  // The hold is checked here too: it may have appeared since act.js decided.
  if (ns.fileExists('/softlock-hold.txt', 'home')) return put({ ok: false, error: 'held by /softlock-hold.txt' })
  put({ ok: true, note: 'written before the call; a reload follows' })
  try {
    ns.singularity.softReset(String(callback))
  } catch (e) {
    put({ ok: false, error: String(e).slice(0, 120) })
  }
}
