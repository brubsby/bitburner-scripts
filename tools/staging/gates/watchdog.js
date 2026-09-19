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
// should it be, and where".
//
// ---------------------------------------------------------------------------
// THE LIFECYCLE MODEL — read this before adding an entry.
// ---------------------------------------------------------------------------
//
// "Not running" is ambiguous, and the ambiguity is the source of every bug this
// file has ever had. It means *crashed* for a supervisor that loops forever,
// and *finished* for a script that exits when its job is done. The watchdog
// cannot tell those apart by looking, so every entry declares which it is.
//
// There are exactly two kinds, and an entry says which by the NAME of its
// predicate. There is no `when` any more, because `when` meant both:
//
//   DAEMON — should always be running. Its predicate is an `invariant`:
//            a statement that must hold for the process to be *legitimate*.
//            If it goes false the running process is now WRONG, so it is
//            killed, and it is not launched.
//
//              invariant: (ns) => ...      // false => kill + do not launch
//
//            share.js is the canonical case. ns.share() multiplies *faction
//            work* reputation, so with no faction joined it does nothing at
//            all — 2040 threads x 4GB = 8.16TB of no-op, which it held for
//            hours after an install dropped every faction. Declining to
//            restart it is not enough; the existing instance has to die.
//
//   JOB    — a one-shot that does work and exits. Its predicate is a
//            `trigger`: "is there work worth starting right now?". Doing the
//            work FALSIFIES the trigger, and that is SUCCESS, not a fault.
//            So a false trigger must never kill anything.
//
//              trigger: (ns) => ...        // false => do not launch, never kill
//
//            nfg.js is the canonical case. It spends money, money drops below
//            the threshold, the old code read that as "precondition no longer
//            holds" and killed it MID-PURCHASE. It never reached its final
//            write, so it looked idle for hours while it was in fact buying
//            nine NeuroFlux levels and 19.4M reputation.
//
// An entry with NO predicate is a DAEMON with a trivially-true invariant, which
// is the terse common case and most of this list. That default is safe by
// construction: kind only changes behaviour when there IS a predicate, and you
// cannot write a predicate without naming it `invariant` or `trigger`. There is
// no field to forget, so the 2026-09-12 bug class — "got the lifecycle wrong by
// omission" — is not expressible.
//
// WHAT THE BUG ACTUALLY WAS, because the fix is subtler than it looks. The old
// guard was one test doing two jobs:
//
//     if (when && !when(ns) && stopWhenFalse !== false) { ...kill...; continue }
//
// so setting `stopWhenFalse: false` to stop the killing ALSO suppressed the
// launch gate — the `continue` was the only thing preventing a launch — and
// nfg.js and homeup.js were then started every 30 seconds regardless of their
// trigger. 23 restarts each, every one taking the global UI lock and dragging
// the screen to Alpha Enterprises to rediscover it could not afford anything.
//
// THE INVARIANT TO HOLD ONTO: "do not launch" and "kill what is running" are
// two independent decisions.
//
//     predicate false  ->  NEVER launch, for both kinds.
//     predicate false  ->  kill for DAEMON, never kill for JOB.
//
// The launch gate is unconditional on kind. Only the kill is conditional. If a
// future edit ever makes the launch gate depend on the kind again, it is
// reintroducing this bug.
//
// Legacy keys (`when`, `stopWhenFalse`) are rejected loudly at validation
// rather than ignored — see checkEntry(). Silently ignoring a copied-in `when`
// would turn a guarded entry into an unguarded one, which is the relaunch storm
// above with no warning at all.

// script, the host it belongs on, and the args to restart it with.
//
// Those args matter more than they look. A restart here is not a resume — it is
// a fresh launch, and anything the operator passed on the command line is gone
// unless it is written down. `buyserv.js --reserve 700e6` was restarted from
// this list with no arguments, reverted to its default of spending everything,
// and converted $197.2m of augmentation money into RAM that had already passed
// the point of negative return. buyserv now also persists its own reserve, so
// the two mechanisms cover each other; keep this list correct anyway.

// Pure arithmetic, no ns surface, so importing it costs this script nothing.
import { nextHomeUpgrade } from 'homecost.js'
// Pure data, same deal: the five story servers, shared with backdoor.js so that
// gating on them needs no copy of the list and no read of backdoor's telemetry.
import { STORY_SERVERS } from 'storyservers.js'

const DAEMON = 'daemon'
const JOB = 'job'

/**
 * Minimum time between two launches of the same JOB, independent of its
 * trigger.
 *
 * This exists because of a failure mode the trigger cannot fix by itself:
 * **trigger true, work impossible, retry in 30s forever.** Every JOB here drives
 * the UI, and every one of them can fail for a reason that leaves the trigger
 * still true:
 *
 *   - nfg.js is blocked by faction REPUTATION far more often than by money, and
 *     reputation is not readable without ns.singularity, which this file cannot
 *     afford to reference (invariant B4). Its trigger therefore tests the one
 *     thing that IS answerable — money above the reserve — and is "always true"
 *     above that. It used to gate on `nextCost` out of /tel/nfg.txt, telemetry
 *     nfg itself writes, which is a circular gate (C4): a job that cannot
 *     finish cannot teach its own trigger anything, and the flat `money > 1e12`
 *     fallback produced 82 relaunches in half an hour, each taking the global
 *     lock to rediscover the same shortfall. Only a clock breaks that loop, and
 *     the clock is the honest mechanism rather than the backstop.
 *   - homeup.js gates on exact arithmetic, so its trigger cannot go stale —
 *     but "could not reach Alpha Enterprises (in Sector-12?)" is a real exit
 *     path in that script, and it does not spend money, so the trigger stays
 *     true and the next tick tries again 30s later. Same loop, different cause.
 *
 * The number is 300000ms, taken from lock.js:40 (`STALE_MS`) rather than
 * chosen. That is this repo's existing answer to "how long may a legitimate UI
 * sequence hold the screen", and it makes the retry cadence say something
 * precise: **a JOB may not be relaunched until the previous attempt would
 * already have been declared dead and had its lock stolen.** At most one retry
 * can ever be in flight, and the observed 82-runs-per-30-minutes storm becomes
 * at most 6.
 *
 * It costs nothing when the work is real. nfg buys as many levels as it can
 * afford in a single run (nine, in the run that was being killed), and homeup's
 * next upgrade costs 1.58x the last one — at no point in a run does a home
 * upgrade become affordable and then un-affordable inside five minutes.
 *
 * It is a delay, never a suppression: it does not touch the trigger, it does
 * not kill, and it does not apply to DAEMONs. A crashed daemon must come back
 * on the very next tick — that is the entire reason this script exists.
 *
 * An entry may override it with `minIntervalMs`. Nothing does today; if
 * something ever needs to, say why in a comment next to the number the way this
 * one does, because an unexplained interval is indistinguishable from a guess.
 */
const JOB_MIN_INTERVAL = 300000

/**
 * Money nfg.js is told to keep back, named once.
 *
 * It is both an argument to the job and the quantity its trigger tests, and
 * those two must not drift: a trigger that fires below the reserve launches a
 * script whose first decision is to stop. It used to be a literal in the args
 * and an unrelated `money > 1e12` in the predicate.
 */
const NFG_RESERVE = 5e11

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
  // Focus is worth 25% and is dropped by any navigation away from the work
  // screen — including cmd.js's own terminal trips — so this needs to be
  // running whenever faction work is. No predicate: it is a no-op when there is
  // no work and it self-guards the export claim on factions being joined, so
  // the trivially-true DAEMON default is exactly right.
  { script: 'upkeep.js', host: 'home', args: [] },
  // Exits by itself once every reachable story server is backdoored — which is
  // exactly the case this list cannot see on its own. "Not running" means
  // "crashed" to a watchdog, so without a predicate it restarted a *completed*
  // script every 30s forever; the counter reached 17 before anyone looked.
  //
  // DAEMON, not JOB, and the distinction is real rather than bookkeeping.
  // backdoor.js is a `while (true)` poller that waits for the hacking level to
  // rise; it is meant to be resident for hours. "There is still a story server
  // left to backdoor" is a statement about whether this process has any reason
  // to exist, so killing on false is correct — and harmless, because it also
  // returns on its own the moment `done.length === TARGETS.length`. It drives
  // the cmd.js bridge rather than the UI directly and takes no lock, so a kill
  // cannot strand the screen.
  //
  // THE GUARD ASKS THE GAME, NOT backdoor.js. This used to read
  // /tel/backdoor.txt — the telemetry backdoor.js itself writes and nothing
  // else does — on the reasoning that it avoided duplicating the target list
  // here. It avoided the duplication and bought a much worse bug (invariants
  // C4, "no circular gate").
  //
  // Why it was dangerous rather than merely stale. This is an INVARIANT, so a
  // false predicate KILLS. prestigeHomeComputer (Server/ServerHelpers.ts:
  // 226-239) resets programs, serversOnNetwork and ramUsed and does NOT clear
  // text files, so /tel/backdoor.txt survives an install. The previous life
  // ends with `remaining: []` — every story server backdoored, which is
  // success — and the install then wipes every backdoor. In the new life the
  // watchdog reads last life's file, concludes there is nothing to do, kills
  // backdoor.js and never relaunches it. Silently, permanently, with every
  // faction invitation gated behind the backdoors it is no longer installing.
  //
  // ns.getServer(host).backdoorInstalled is the ground truth — it is what
  // backdoor.js itself uses for completion (backdoor.js:113) and what the
  // faction requirements read — and it cannot survive a prestige, because it
  // is not a file. The target list comes from storyservers.js, so the "do not
  // duplicate it" goal is still met.
  //
  // serverExists first: fulcrumassets is not on the network until enough of
  // the map is scanned, and ns.getServer throws on an unknown hostname, which
  // inside a predicate reads as `state: error` rather than as an answer.
  // getServer is already paid for by the homeup trigger below, so the only new
  // cost here is serverExists at 0.05GB.
  {
    script: 'backdoor.js',
    host: 'home',
    args: [],
    invariant: (ns) => STORY_SERVERS.some(([h]) => !ns.serverExists(h) || !ns.getServer(h).backdoorInstalled),
  },
  // Exits once TOR is owned, so the invariant stops it being restarted forever.
  //
  // DAEMON for the same reason as backdoor.js: a `while (true)` poller that
  // sits waiting for money for as long as it takes, whose predicate describes
  // whether it has any business existing. Not owning TOR is not a "there is
  // work to start" trigger — it is the condition under which this process is
  // legitimate, and once TOR is bought a surviving torbuy has nothing to do but
  // hold the screen.
  { script: 'torbuy.js', host: 'home', args: [], invariant: (ns) => !ns.hasTorRouter() },
  { script: 'go.js', host: 'home', args: [] },
  // Multiplies faction reputation gain by 1 + ln(threads)/25. Sized small on
  // purpose: the curve is steeply concave and the rest of the fleet is worth
  // more hacking. Restarted here because batch.js will reclaim the RAM if the
  // share ever dies.
  //
  // The invariant is not optional here, and it is the reason the DAEMON kind
  // exists at all. ns.share() multiplies *faction work* rep, so with no faction
  // joined it does nothing, and an install drops every faction. Without it this
  // entry restarts 2040 threads x 4GB = 8.16TB of no-op every 30s for the whole
  // post-install rebuild — and it would also undo boot.js's matching guard
  // within half a minute, which is exactly how a corrected list here kept
  // resurrecting retired auto.js. Declining to restart would not have been
  // enough: the 8.16TB was already running, and had to be killed.
  //
  // 600 rather than 2040: bonus 1.256 vs 1.305. The extra 3.9% costs 5.8TB the
  // batcher could hack with, and rep gain is linear in hacking level
  // (reputation.ts:18), so the level channel outruns the share channel.
  {
    script: 'share.js',
    host: 'anywhere',
    args: [],
    threads: (ns, hosts) => shareThreads(ns, hosts),
    invariant: (ns) => (ns.getPlayer().factions || []).length > 0,
  },
  // Lowered from the pre-install park of 1e15 back to a small reserve: the
  // 2026-09-11 prestige destroyed the purchased-server fleet and money along
  // with it, so cloud RAM is the only RAM there is again and needs rebuilding
  // from nothing. Home RAM (16,384GB) survived and is not what this guards.
  // No args, and home rather than a purchased server. buyserv derives its own
  // reserve from game state every tick, so there is nothing here to go stale
  // across an install — a hardcoded figure here once spent $197.2m of
  // augmentation money, and a later one held back everything in a life that
  // owned nothing. Purchased servers are destroyed by an install, so naming one
  // as a host guarantees a dead entry on the next life.
  { script: 'buyserv.js', host: 'home', args: [] },
  { script: 'autobuy.js', host: 'home', args: [] },
  // Converts money into NeuroFlux levels via donations. NFG is +1% to every
  // multiplier per level and the hacking multiplier is the only remaining gate
  // on Daedalus (level is logarithmic in exp but linear in the multiplier), so
  // this is the endgame's main loop. It exits when it runs out of money, so the
  // watchdog re-running it IS the mechanism — which is precisely what makes it
  // a JOB and not a DAEMON.
  //
  // Guarded on having a faction that can actually take donations; without 150
  // favor there is nothing it can do but burn a lock every 30s.
  {
    script: 'nfg.js',
    host: 'home',
    args: ['--reserve', NFG_RESERVE, '--max', 6],
    // TRIGGER, not invariant: spending the money is the job, so the guard going
    // false means it is working, not that it should die. This entry is the one
    // that was killed mid-purchase.
    //
    // THIS USED TO READ /tel/nfg.txt, and that was a circular gate (invariants
    // C4): the only writer of that file is the script the predicate gates, so
    // nfg.js had to run before the watchdog could learn anything about whether
    // it should have run, and a run that could not take the UI lock — or died
    // before its final write — left the gate stale or absent. The fallback was
    // a flat `money > 1e12`, permanently true once income is large, which
    // produced 82 relaunches in half an hour, each taking the global UI lock to
    // rediscover the same shortfall.
    //
    // What replaces it is exact, free, and answerable from game state: nfg.js
    // stops buying when `money - cost < reserve` (nfg.js:169), so `money above
    // the reserve it is launched with` is a true necessary condition for the
    // job having anything to do. Sharing NFG_RESERVE with the args above means
    // the gate and the job cannot disagree — the old 1e12 was an unrelated
    // number that had to be kept in step by hand and was not.
    //
    // WHAT THIS DELIBERATELY DOES NOT PREDICT, because pretending otherwise is
    // how a gate gets trusted past what it knows. The binding constraint on
    // nfg.js is almost never money, it is faction REPUTATION: the next level
    // costs 1.14x the last (AugmentationHelpers.ts:127-135) and the donation
    // needed is the shortfall against reputation we already hold. Current
    // reputation and favor are readable only through ns.singularity.
    // getFactionRep / getFactionFavor, and this file is in boot.js's STACK —
    // referencing Singularity here would be billed in every BitNode, which is
    // exactly the mistake SF3/invariant B4 is about. So above the reserve this
    // trigger is "always true", and the thing that bounds the retry rate is
    // JOB_MIN_INTERVAL, not the predicate. That is a stated, bounded staleness
    // (at most 6 launches per 30 minutes) rather than a silent one, and unlike
    // the telemetry gate it is correct on the first tick of a fresh life.
    trigger: (ns) => ns.getServerMoneyAvailable('home') > NFG_RESERVE,
  },
  // Convert surplus cash into home RAM/cores, which are the ONLY purchases that
  // survive an install (prestigeHomeComputer touches neither maxRam nor
  // cpuCores; money resets to $1262 — 1000 + CONSTANTS.Donations — plus any
  // owned aug's startingMoney). homeup.js exits when it is done, so the
  // watchdog re-running it is the mechanism: whenever the balance climbs back
  // over the threshold, it spends it again. Same shape as nfg.js, same kind.
  //
  // This matters most exactly when buyserv has nothing left to do — the cloud
  // fleet caps at 25 servers of 1PB, after which money simply accumulates and
  // is then deleted by the next install. That is how $2.07 quadrillion was
  // once thrown away.
  //
  // The reserve keeps enough for an augmentation buy-out, since those are
  // rep-gated and the window opens unpredictably.
  {
    script: 'homeup.js',
    host: 'home',
    args: ['--reserve', 2e12],
    // TRIGGER: only wake it when the next upgrade is actually affordable. Home
    // prices grow 1.58^log2(ram) per doubling, so "we have money" and "we can
    // afford the next one" diverge by orders of magnitude.
    //
    // Computed here rather than read from /tel/homeup.txt. Gating on a figure
    // homeup publishes is circular — the script has to run, take the UI lock
    // and walk to Alpha Enterprises before the watchdog can learn it should not
    // have run — and it is wrong on a fresh life, where no telemetry exists
    // yet and the fallback threshold is just a guess. nextHomeUpgrade is pure
    // arithmetic over state we already hold, so the answer is exact and free.
    trigger: (ns) => {
      const next = nextHomeUpgrade(ns.getServerMaxRam('home'), ns.getServer('home').cpuCores)
      return !!next && ns.getServerMoneyAvailable('home') >= next.cost + 2e12
    },
  },
]

const INTERVAL = 30000
const TELEMETRY = '/tel/watchdog.txt'

/**
 * The lifecycle kind of an entry, named rather than inferred from a flag.
 *
 * The predicate's field name *is* the declaration, so there is no second field
 * to keep in sync and nothing to omit. An entry with neither predicate is a
 * DAEMON with a trivially-true invariant. `kind: JOB` is accepted as an
 * explicit override for the (currently hypothetical) one-shot with no trigger
 * at all, purely so its restart accounting reads as "runs" rather than "faults".
 */
function kindOf(e) {
  if (e.kind) return e.kind
  return e.trigger ? JOB : DAEMON
}

/** The entry's predicate, whichever kind it is, or null. */
function predicateOf(e) {
  return e.invariant ?? e.trigger ?? null
}

/**
 * Reject a malformed entry loudly instead of guessing at it.
 *
 * This is the real defence, and it is aimed at one specific accident: someone
 * pastes an entry out of git history (or off an old branch) carrying `when:`
 * and `stopWhenFalse:`. Those keys mean nothing now, so the entry would arrive
 * here **unguarded** — and an unguarded nfg.js is the 30-second relaunch storm
 * that this whole rewrite is about, with no warning anywhere. Failing the entry
 * is noisy; silently dropping its guard is expensive.
 *
 * Returns null if the entry is fine, or a string describing the fault.
 */
function checkEntry(e) {
  if ('when' in e) return "legacy key `when` — rename it to `invariant` (kill on false) or `trigger` (never kill)"
  if ('stopWhenFalse' in e) return 'legacy key `stopWhenFalse` — the kind is now carried by `invariant` vs `trigger`'
  if (e.invariant && e.trigger) return 'has both `invariant` and `trigger` — an entry is one kind or the other'
  if (e.kind && e.kind !== DAEMON && e.kind !== JOB) return `unknown kind ${e.kind}`
  if (e.kind === DAEMON && e.trigger) return '`kind: DAEMON` with a `trigger` — a daemon guard is an `invariant`'
  if (e.kind === JOB && e.invariant) return '`kind: JOB` with an `invariant` — a job guard is a `trigger`'
  return null
}

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
function shareThreads(ns, hosts, frac = 0.8) {
  const perThread = ns.getScriptRam('share.js', 'home') || 4
  let biggest = 0
  for (const h of hosts) {
    if (!ns.hasRootAccess(h)) continue
    const free = ns.getServerMaxRam(h) - ns.getServerUsedRam(h)
    if (free > biggest) biggest = free
  }
  return Math.max(600, Math.min(250000, Math.floor((biggest * frac) / perThread)))
}

function scanAll(ns) {
  const seen = new Set(['home'])
  const queue = ['home']
  while (queue.length) {
    for (const h of ns.scan(queue.shift())) {
      if (!seen.has(h)) {
        seen.add(h)
        queue.push(h)
      }
    }
  }
  return [...seen]
}

/** Is this script running anywhere at all? */
function running(ns, hosts, script) {
  return hosts.some((h) => ns.hasRootAccess(h) && ns.ps(h).some((p) => p.filename === script))
}

/** Tightest-fitting rooted host with room, so big hosts stay whole for the batcher. */
function placeFor(ns, hosts, script, threads) {
  const need = ns.getScriptRam(script, 'home') * threads
  let best = null
  for (const h of hosts) {
    if (!ns.hasRootAccess(h) || h === 'home') continue
    const free = ns.getServerMaxRam(h) - ns.getServerUsedRam(h)
    if (free >= need && (!best || free < best.free)) best = { host: h, free }
  }
  if (best) return best.host
  return ns.getServerMaxRam('home') - ns.getServerUsedRam('home') >= need ? 'home' : null
}

/**
 * Restore the launch clock from the last telemetry write.
 *
 * Without this, restarting the watchdog resets every JOB's cooldown to zero, so
 * the cheapest possible operator action — `kill watchdog.js; run watchdog.js`,
 * which the gameplay log shows happening repeatedly around contract cycles —
 * silently disarms the rate limit. Counters deliberately are NOT restored: a
 * restart count is only meaningful relative to an uptime, and the telemetry
 * carries `since` so the two are read together.
 */
function restoreLaunchClock(ns) {
  const last = {}
  try {
    const prev = JSON.parse(ns.read(TELEMETRY))
    for (const group of [prev.daemons, prev.jobs]) {
      for (const k of Object.keys(group || {})) {
        const t = Date.parse(group[k].lastLaunch)
        if (Number.isFinite(t)) last[k] = t
      }
    }
  } catch {
    /* no telemetry yet, or written by an older watchdog — start cold */
  }
  return last
}

export async function main(ns) {
  ns.disableLog('ALL')
  ns.print('watchdog running')

  // Validate once at startup rather than per cycle: the list is a constant, so
  // a fault in it is a fault forever, and it should be visible immediately
  // rather than buried in a 30s log line.
  const broken = new Set()
  for (const e of WATCHED) {
    const fault = checkEntry(e)
    if (fault) {
      broken.add(e.script)
      ns.tprint(`watchdog: CONFIG ERROR, skipping ${e.script} — ${fault}`)
    }
  }

  const since = new Date().toISOString()
  // Per-script counters, kept separate by kind because they mean opposite
  // things. See the telemetry write at the bottom of the loop.
  const daemons = {}
  const jobs = {}
  const lastLaunch = restoreLaunchClock(ns)

  while (true) {
    // One network walk per cycle instead of one per entry. Topology only
    // changes when buyserv buys a server, and a 30s delay in noticing that is
    // invisible; thirteen redundant BFS walks every tick were not free.
    const hosts = scanAll(ns)

    for (const entry of WATCHED) {
      const { script, host, args, threads: threadSpec } = entry
      if (broken.has(script)) continue

      const kind = kindOf(entry)
      const stats = kind === JOB ? jobs : daemons
      // Written out rather than `??=`: no root-level script in this repo uses
      // logical assignment yet, and this is not the file to find out on.
      if (!stats[script]) stats[script] = { kind, count: 0, lastLaunch: null, state: 'unknown', lastError: null }
      const rec = stats[script]

      try {
        // ---- 1. The predicate. Two independent decisions, never one. -------
        //
        // Both kinds gate the launch. Only a DAEMON's false invariant kills.
        // Collapsing these back into a single test is the 2026-09-12 bug; see
        // the header. Note the structure: the `continue` that prevents the
        // launch is OUTSIDE the kill branch, so no change to the kill policy
        // can ever reach the launch gate again.
        const predicate = predicateOf(entry)
        if (predicate && !predicate(ns)) {
          if (kind === DAEMON) {
            for (const h of hosts) {
              if (ns.hasRootAccess(h) && ns.ps(h).some((p) => p.filename === script)) {
                ns.scriptKill(script, h)
                ns.tprint(`watchdog: stopped ${script} on ${h} — invariant no longer holds`)
              }
            }
            rec.state = 'stopped: invariant false'
          } else {
            // A JOB whose trigger is false has nothing to start and nothing to
            // answer for. If an instance is still running it is finishing the
            // work that made the trigger false — leave it completely alone.
            rec.state = 'idle: trigger false'
          }
          continue
        }

        // ---- 2. Already alive? ---------------------------------------------
        if (running(ns, hosts, script)) {
          rec.state = 'running'
          continue
        }

        // ---- 3. JOB rate limit. Never applies to a DAEMON. ------------------
        //
        // A crashed daemon comes back on the very next tick, unconditionally;
        // that is the entire reason this script exists. A job that just ran and
        // whose trigger is *still* true is the "work impossible, retry forever"
        // pattern, and the clock is the only thing that can bound it. See
        // JOB_MIN_INTERVAL for why the number is what it is.
        const floor = entry.minIntervalMs ?? JOB_MIN_INTERVAL
        if (kind === JOB && lastLaunch[script] && Date.now() - lastLaunch[script] < floor) {
          const waitS = Math.ceil((floor - (Date.now() - lastLaunch[script])) / 1000)
          rec.state = `cooling down: ${waitS}s`
          continue
        }

        // ---- 4. Placement. --------------------------------------------------
        //
        // Resolve 'anywhere' to a host with room. Naming a purchased server
        // here is a bug waiting for the next install to destroy it, which is
        // exactly how share.js stayed dead for hours after the last one.
        //
        // Thread count is computed here and not before the try block. It used
        // to be evaluated for every entry on every cycle, outside any error
        // handling — so a throw inside shareThreads would have taken down the
        // process that keeps the whole run alive. Now it is inside the guard,
        // and only for an entry that is actually about to launch.
        const threads = typeof threadSpec === 'function' ? threadSpec(ns, hosts) : threadSpec
        const target = host === 'anywhere' ? placeFor(ns, hosts, script, threads ?? 1) : host
        if (!target) {
          rec.state = 'blocked: no host with room'
          continue
        }

        // Always copy from home before relaunching, not just when the file is
        // missing. A copy on another server does not track the original, so a
        // script fixed on home can be restarted here from a stale copy and come
        // back running the old code — silently, and looking like success. That
        // is how a corrected watchdog kept resurrecting a retired auto.js.
        if (target !== 'home') ns.scp(script, target, 'home')

        // Threads matter for share.js, whose whole effect scales with them.
        const pid = ns.exec(script, target, threads ?? 1, ...args)
        if (pid) {
          rec.count += 1
          rec.lastLaunch = new Date().toISOString()
          rec.state = 'running'
          lastLaunch[script] = Date.now()
          // Say which kind it was, because the same number means opposite
          // things: "run #9" of a job is nine successful pieces of work,
          // "restart #9" of a daemon is nine crashes.
          const label = kind === JOB ? `run #${rec.count}` : `restart #${rec.count}`
          ns.tprint(`watchdog: started ${script} on ${target} (pid ${pid}, ${kind}, ${label})`)
        } else {
          // Almost always means no free RAM, which is normal right after the
          // supervisor filled the host with workers. Say so once per cycle and
          // try again next time rather than forcing anything.
          rec.state = 'blocked: exec refused (no RAM?)'
          ns.print(`watchdog: ${script} not running, no host with room`)
        }
      } catch (err) {
        // Surface errors in telemetry as well as the tail. A predicate that
        // throws every cycle used to be completely invisible from outside the
        // game, and it silently means "this entry is not being managed".
        rec.state = 'error'
        rec.lastError = String(err).slice(0, 200)
        ns.print(`watchdog: ${script} check failed: ${err}`)
      }
    }

    // Telemetry, split by kind, because the old flat `restarts` map could not
    // answer the only question anyone asks of it. 23 launches of a JOB is 23
    // successful pieces of work and probably the healthiest line in the file;
    // 23 restarts of a DAEMON means something is crashing every few minutes.
    // They were previously the same number in the same map, which made the file
    // unreadable exactly when it mattered.
    //
    // `since` is here so the counters are interpretable at all — a count with
    // no window is not a rate. `state` is new and is the other half: it
    // distinguishes "not running because its guard says no" from "not running
    // because there is no RAM" from "not running because it just ran", all of
    // which previously looked identical (i.e. like nothing).
    //
    // The flat `restarts` map is kept as-is for anything that already reads it
    // — the gameplay log quotes `restarts: {}` as the all-healthy signal — but
    // it is now derived, and the per-kind sections are the real answer.
    const restarts = {}
    for (const g of [daemons, jobs]) for (const k of Object.keys(g)) restarts[k] = g[k].count

    ns.write(
      TELEMETRY,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          since,
          jobMinIntervalMs: JOB_MIN_INTERVAL,
          // Nonzero counts here are a question to answer: what is killing it?
          daemons,
          // Nonzero counts here are work getting done. Compare against `state`
          // and `lastLaunch` rather than treating the number as a fault.
          jobs,
          restarts,
        },
        null,
        2,
      ),
      'w',
    )

    await ns.sleep(INTERVAL)
  }
}
