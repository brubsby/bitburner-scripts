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
// It cannot do the things that need Source-File 4 — joining factions and
// starting faction work. Those stay manual, so it writes what it could not do
// to /tel/todo.txt and prints it, rather than leaving the gap silent.
//
// BEFORE THE NEXT INSTALL: run `homeup.js --reserve 0`. Home RAM and cores are
// the only purchases that survive a prestige; money is deleted by it. See the
// install procedure in CLAUDE.md.

const STACK = [
  // script, threads, args. Host is resolved at run time — naming a purchased
  // server here would break on the first install that destroys it.
  { script: 'batch.js', where: 'home' },
  { script: 'cmd.js', where: 'home' },
  { script: 'ctauto.js', where: 'home' },
  { script: 'tel.js', where: 'home' },
  { script: 'watchdog.js', where: 'home' },
  // Reclaims the 25% focus bonus whenever something navigates away from the
  // work screen, and claims the 24h +1-favor export bonus. Both are pure
  // reputation, which is the only thing gating the exit from this BitNode.
  { script: 'upkeep.js', where: 'home' },
  // Re-roots and re-backdoors the story servers, which an install wipes. This
  // is the step that gates every faction, and the one most easily forgotten —
  // forgetting it means reputation earns zero until a human notices.
  { script: 'backdoor.js', where: 'home' },
  // Buys the TOR router by clicking Alpha Enterprises, then exits. TOR gates
  // the darkweb -> port programs -> rooting -> the whole fleet, and it is the
  // one purchase autobuy.js could never make without Source-File 4.
  { script: 'torbuy.js', where: 'home', when: (ns) => !ns.hasTorRouter() },
  // Idempotent: turns off the confirmation modals that otherwise interrupt
  // every UI-driving script. Safe to run on every boot; exits immediately when
  // everything is already correct.
  { script: 'settings.js', where: 'home' },
  // Farms IPvGO node power vs Daedalus -> faction_rep multiplier on every rep
  // stream. nodePower zeroes on install (Go.ts:34-47), so each life should
  // start the farm immediately. Thin client: real search happens in
  // tools/go-solver.mjs outside the game (see CLAUDE.md), with a weak local
  // fallback if that process is down.
  { script: 'go.js', where: 'home' },
  // Rebuilds the cloud fleet. No --reserve: an explicit figure here overrides
  // the reserve buyserv derives from game state, and a figure that was right
  // for one life is wrong for the next. Passing it cost $197.2m of
  // augmentation money once already. Let buyserv decide every tick.
  { script: 'buyserv.js', where: 'anywhere' },
  // Multiplies faction reputation gain by 1 + ln(threads)/25. Concave, so a
  // small slice is nearly all of the benefit; the rest is worth more hacking.
  //
  // 600 threads (2.4GB x 4 = 2.4TB) buys bonus 1.256; 2040 threads buys 1.305.
  // That last 3.9% costs 5.8TB of RAM that the batcher could be hacking with,
  // and hacking raises the hacking level, which reputation gain is *linear* in
  // (reputation.ts:18). The steeper channel wins — see share.js's own table.
  //
  // `when` matters more than the thread count. ns.share() only multiplies
  // *faction work* reputation, so with no faction joined it does exactly
  // nothing — share.js says so in its own header. Booting it unconditionally
  // burned 2040 threads x 4GB = 8.16TB, 16.6% of a 49TB fleet, on a no-op for
  // the entire post-install stretch when no faction had been rejoined yet.
  // That is precisely the window where rebuilding fast matters most.
  {
    script: 'share.js',
    where: 'anywhere',
    threads: (ns) => shareThreads(ns),
    when: (ns) => (ns.getPlayer().factions || []).length > 0,
  },
]

/**
 * How many share threads to run.
 *
 * Two constraints, and the second is the one that bites. The bonus is
 * 1 + ln(threads)/25, so more is better with sharply diminishing returns — but
 * a single share process must fit in ONE host's free RAM, and batch.js runs the
 * fleet at ~98% utilisation. Sizing from *total* fleet RAM therefore asks for a
 * block that does not exist, placement fails, and share silently never starts.
 *
 * So: take a fraction of the largest free block, not of the fleet. Self-limiting
 * by construction, and it grows on its own as home RAM does.
 *
 * The old hardcoded 600 was right for a 2.4TB fleet and badly wrong at 26.7PB —
 * 600 threads buys bonus 1.256, where 50,000 buys 1.433, i.e. 14% more
 * reputation on every stream for RAM the batcher does not miss.
 */
function shareThreads(ns, frac = 0.8) {
  const perThread = ns.getScriptRam('share.js', 'home') || 4
  const seen = new Set(['home'])
  const queue = ['home']
  let biggest = 0
  while (queue.length) {
    const h = queue.shift()
    if (ns.hasRootAccess(h)) {
      const free = ns.getServerMaxRam(h) - ns.getServerUsedRam(h)
      if (free > biggest) biggest = free
    }
    for (const n of ns.scan(h)) if (!seen.has(n)) { seen.add(n); queue.push(n) }
  }
  return Math.max(600, Math.min(250000, Math.floor((biggest * frac) / perThread)))
}

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

  // NOTE: stale /tel/ui-lock.txt and /cmd/busy.txt from the previous life are
  // NOT cleared here, deliberately. Text files survive a prestige
  // (prestigeHomeComputer, Server/ServerHelpers.ts:226-239, resets programs,
  // serversOnNetwork and ramUsed but not files), so both really do carry over —
  // but clearing them here means referencing ns.rm, which costs 0.6GB (priced
  // as Scp) and pushes boot.js from 7.9GB to 8.5GB. A new BitNode starts home
  // at **8GB**, so that one convenience would make the bootstrap script unable
  // to run at all in the life it exists to start.
  //
  // Each file is cleared by its owner instead, for free, because both owners
  // already reference ns.rm: lock.js rejects a record whose instance nonce is
  // from a previous life (the nonce lives in a Netscript port, which
  // prestigeWorkerScripts clears — NetscriptWorker.ts:40-46), and cmd.js drops
  // a stale busy file on startup.

  const started = []
  const failed = []

  const stopped = []

  for (const { script, where, threads: threadSpec = 1, args = [], when } of STACK) {
    const threads = typeof threadSpec === 'function' ? threadSpec(ns) : threadSpec
    try {
      if (!ns.fileExists(script, 'home')) {
        failed.push(`${script}: not on home`)
        continue
      }

      const runningOn = scanAll(ns).filter(
        (h) => ns.hasRootAccess(h) && ns.ps(h).some((p) => p.filename === script),
      )

      // A `when` that is false is not just "skip the launch" — it has to stop
      // an instance a previous boot started under different conditions, or the
      // waste survives every subsequent boot. share.js after an install is the
      // case that matters: installing drops every faction, so the share threads
      // a pre-install boot started become dead weight and nothing reclaims
      // them. Being idempotent means converging on the right state from
      // whatever state the game is actually in, not only from a clean one.
      if (when && !when(ns)) {
        for (const h of runningOn) {
          ns.scriptKill(script, h)
          stopped.push(`${script} on ${h}`)
        }
        continue
      }

      // Already running anywhere? Leave it alone.
      if (runningOn.length) continue

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
  // Money is destroyed by an install; home RAM and cores are not. Anything
  // large sitting in the bank is a standing loss waiting to happen.
  const cash = ns.getServerMoneyAvailable('home')
  if (cash > 1e12) {
    todo.push(
      `$${ns.format.number(cash)} idle — home is ${ns.getServerMaxRam('home')}GB/` +
        `${ns.getServer('home').cpuCores} cores. Run homeup.js; cash does NOT survive an install.`,
    )
  }

  const report = { at: new Date().toISOString(), started, stopped, failed, todo }
  ns.write('/tel/todo.txt', JSON.stringify(report, null, 2), 'w')

  if (started.length) ns.tprint(`boot: started ${started.join(', ')}`)
  if (stopped.length) ns.tprint(`boot: stopped ${stopped.join(', ')} (precondition no longer holds)`)
  if (failed.length) ns.tprint(`boot: FAILED ${failed.join(' | ')}`)
  for (const t of todo) ns.tprint(`boot: TODO ${t}`)
  if (!todo.length && !failed.length) ns.tprint('boot: stack up, nothing needs a human')
}
