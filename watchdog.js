// Restarts the supervisors if they stop.
//
// auto.js was once observed to vanish silently — no crash message, no log,
// after several healthy cycles. Its main loop is a guarded `while (true)`, so
// nothing in the script explains it, and it has not recurred. Rather than keep
// hunting an unreproducible event, this makes it not matter: two independent
// processes both dying is far less likely than one, and the whole point of the
// supervisors is that the game keeps progressing with nobody watching.
//
//   run watchdog.js
//
// Deliberately tiny, so it fits anywhere and is cheap to keep resident. It
// knows nothing about strategy — it only answers "is this running, and if not,
// start it".

// script, the host it belongs on, and the args to restart it with.
//
// Those args matter more than they look. A restart here is not a resume — it is
// a fresh launch, and anything the operator passed on the command line is gone
// unless it is written down. `buyserv.js --reserve 700e6` was restarted from
// this list with no arguments, reverted to its default of spending everything,
// and converted $197.2m of augmentation money into RAM that had already passed
// the point of negative return. buyserv now also persists its own reserve, so
// the two mechanisms cover each other; keep this list correct anyway.
const WATCHED = [
  // batch.js replaced auto.js + early.js as the hacking controller. Do not add
  // auto.js back alongside it — both want the whole fleet's RAM, and auto.js
  // would fill every host with early.js workers that the batcher then cannot
  // place batches into.
  { script: 'batch.js', host: 'home', args: [] },
  { script: 'cmd.js', host: 'home', args: [] },
  // Contracts pay ~$25m and, more importantly once money is not the
  // constraint, faction reputation — which cannot be bought at any price
  // without 150 favor. Running unattended it is the only thing besides the
  // batcher that still makes progress on the critical path.
  { script: 'ctauto.js', host: 'home', args: [] },
  { script: 'tel.js', host: 'home', args: [] },
  // Multiplies faction reputation gain by 1 + ln(threads)/25. Sized small on
  // purpose: the curve is steeply concave and the rest of the fleet is worth
  // more hacking. Restarted here because batch.js will reclaim the RAM if the
  // share ever dies.
  { script: 'share.js', host: 'pserv-67930', args: [], threads: 2040 },
  // Parked deliberately, not disabled. The fleet is at the 25-server cap and
  // the batcher is running ~3 targets on 432TB with placement failures to
  // spare, so marginal cloud RAM buys nothing — and it is destroyed by an
  // augmentation install, while home RAM survives. Everything goes into home
  // RAM until the install. Lower this afterwards, when the fleet has to be
  // rebuilt from nothing and cloud RAM is the only RAM there is.
  { script: 'buyserv.js', host: 'joesguns', args: ['--reserve', 1e15] },
]

const INTERVAL = 30000

export async function main(ns) {
  ns.disableLog('ALL')
  ns.print('watchdog running')

  const restarts = {}

  while (true) {
    for (const { script, host, args, threads } of WATCHED) {
      try {
        if (ns.ps(host).some((p) => p.filename === script)) continue

        // Always copy from home before relaunching, not just when the file is
        // missing. A copy on another server does not track the original, so a
        // script fixed on home can be restarted here from a stale copy and come
        // back running the old code — silently, and looking like success. That
        // is how a corrected watchdog kept resurrecting a retired auto.js.
        if (host !== 'home') ns.scp(script, host, 'home')

        // Threads matter for share.js, whose whole effect scales with them.
        const pid = ns.exec(script, host, threads ?? 1, ...args)
        if (pid) {
          restarts[script] = (restarts[script] ?? 0) + 1
          ns.tprint(`watchdog: restarted ${script} on ${host} (pid ${pid}, restart #${restarts[script]})`)
        } else {
          // Almost always means no free RAM, which is normal right after the
          // supervisor filled the host with workers. Say so once per cycle and
          // try again next time rather than forcing anything.
          ns.print(`watchdog: ${script} not running on ${host}, exec failed (no RAM?)`)
        }
      } catch (err) {
        ns.print(`watchdog: ${script} check failed: ${err}`)
      }
    }

    ns.write(
      '/tel/watchdog.txt',
      JSON.stringify({ at: new Date().toISOString(), restarts }, null, 2),
      'w',
    )

    await ns.sleep(INTERVAL)
  }
}
