// Brings the whole stack up. Set this as Options -> System -> Autoexec Script
// so it runs on every game load, including the reload after an augmentation
// install.
//
//   run boot.js
//
// Installing augmentations kills every running script and destroys every
// purchased server. Home files survive, so the scripts are all still there —
// but nothing restarts them, and after one install the fleet sat with no
// controller, no share, and no faction work for a long stretch. Reputation
// earned zero the whole time.
//
// IMPORTANT: setting this as Options -> System -> Autoexec Script does NOT
// cover the post-install case, which is the one that matters most. The game
// only creates the autoexec entry for a server that has *saved running
// scripts* (`if (skipScriptLoad || !rsList) continue` —
// src/NetscriptWorker.ts:247), and an install kills every script, so the list
// is empty and the autoexec is skipped. It fires on an ordinary page reload
// and not on a prestige. Whoever performs an install must run this afterwards
// by hand — the install procedure is not complete until `run boot.js` has been
// executed and its TODO lines have been read.
//
// Idempotent: safe to run at any time, and starting it twice does nothing.
//
// It cannot do the things that need Source-File 4 — joining factions, starting
// faction work, buying programs or home RAM. Those stay manual, so it writes
// what it could not do to /tel/todo.txt and prints it, rather than leaving the
// gap silent.

const STACK = [
  // script, threads, args. Host is resolved at run time — naming a purchased
  // server here would break on the first install that destroys it.
  { script: 'batch.js', where: 'home' },
  { script: 'cmd.js', where: 'home' },
  { script: 'ctauto.js', where: 'home' },
  { script: 'tel.js', where: 'home' },
  { script: 'watchdog.js', where: 'home' },
  // Rebuilds the cloud fleet. A small reserve on purpose: right after an
  // install there is nothing to hoard for and everything to rebuild.
  { script: 'buyserv.js', where: 'anywhere', args: ['--reserve', 1e6] },
  // Multiplies faction reputation gain by 1 + ln(threads)/25. Concave, so a
  // small slice is nearly all of the benefit; the rest is worth more hacking.
  { script: 'share.js', where: 'anywhere', threads: 2040 },
]

function scanAll(ns) {
  const seen = new Set(['home'])
  const queue = ['home']
  while (queue.length) {
    for (const host of ns.scan(queue.shift())) {
      if (!seen.has(host)) {
        seen.add(host)
        queue.push(host)
      }
    }
  }
  return [...seen]
}

/** Somewhere with room, preferring not to crowd home. */
function placeOn(ns, need, prefer) {
  if (prefer === 'home') return 'home'
  const hosts = scanAll(ns).filter((h) => ns.hasRootAccess(h) && h !== 'home')
  let best = null
  for (const h of hosts) {
    const free = ns.getServerMaxRam(h) - ns.getServerUsedRam(h)
    if (free >= need && (!best || free < best.free)) best = { host: h, free }
  }
  // Tightest fit that works, so a big host is left whole for the batcher.
  if (best) return best.host
  const homeFree = ns.getServerMaxRam('home') - ns.getServerUsedRam('home')
  return homeFree >= need ? 'home' : null
}

export async function main(ns) {
  ns.disableLog('ALL')
  ns.tprint('boot.js: bringing up the stack')

  const started = []
  const failed = []

  for (const { script, where, threads = 1, args = [] } of STACK) {
    try {
      if (!ns.fileExists(script, 'home')) {
        failed.push(`${script}: not on home`)
        continue
      }
      // Already running anywhere? Leave it alone.
      if (scanAll(ns).some((h) => ns.hasRootAccess(h) && ns.ps(h).some((p) => p.filename === script))) continue

      const need = ns.getScriptRam(script, 'home') * threads
      const host = placeOn(ns, need, where)
      if (!host) {
        failed.push(`${script}: no host with ${need}GB free`)
        continue
      }
      if (host !== 'home') ns.scp(script, host, 'home')
      const pid = ns.exec(script, host, threads, ...args)
      if (pid) started.push(`${script} on ${host}${threads > 1 ? ` x${threads}` : ''}`)
      else failed.push(`${script}: exec refused on ${host}`)
      await ns.sleep(200)
    } catch (err) {
      failed.push(`${script}: ${err}`)
    }
  }

  // What a script cannot do without Source-File 4, and so has to be said out
  // loud rather than quietly not happening.
  const todo = []
  const player = ns.getPlayer()
  if (!player.factions || player.factions.length === 0) {
    todo.push('No faction joined — backdoor a story server and accept the invite. Reputation is earning ZERO until then.')
  } else if (!ns.singularity) {
    // Cannot read currentWork without SF4 either; flag it for a human to check.
    todo.push(`Joined: ${player.factions.join(', ')} — check faction work is running AND focused (unfocused costs 20%).`)
  }
  for (const p of ['BruteSSH.exe', 'FTPCrack.exe', 'relaySMTP.exe', 'HTTPWorm.exe', 'SQLInject.exe']) {
    if (!ns.fileExists(p, 'home')) todo.push(`${p} not owned — each port program unlocks a tier of servers to root.`)
  }

  const report = { at: new Date().toISOString(), started, failed, todo }
  ns.write('/tel/todo.txt', JSON.stringify(report, null, 2), 'w')

  if (started.length) ns.tprint(`boot: started ${started.join(', ')}`)
  if (failed.length) ns.tprint(`boot: FAILED ${failed.join(' | ')}`)
  for (const t of todo) ns.tprint(`boot: TODO ${t}`)
  if (!todo.length && !failed.length) ns.tprint('boot: stack up, nothing needs a human')
}
