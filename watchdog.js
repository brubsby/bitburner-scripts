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
// Pure table (0GB): the node's HomeComputerRamCost, which the price carries.
import { bitNodeMults } from 'bitNodeMultipliers.js'
// Pure data, same deal: the five story servers, shared with backdoor.js so that
// gating on them needs no copy of the list and no read of backdoor's telemetry.
import { STORY_SERVERS } from 'storyservers.js'
// Free to import: status.js references only ns.write (0GB). See its header.
import { reporter, describe, record } from 'status.js'
// Pure, no ns surface: free to import.
import { reserveFor as budgetHold, augClaim, joinClaim, marginalLnPerDollar } from 'budget.js'
// Pure arithmetic over resetInfo, no ns surface: free to import.
import { singularityRamMultiplier, canAccessFeature, SF_FILE } from 'sfgate.js'
// Pure: the game's hacknet-server hostname marker. A GB used on one costs that
// share of its hashes (Hacknet/formulas/HacknetServers.ts:14).
import { isHacknetServerHost } from 'hacknetplan.js'

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
// nfg.js also carried its own $5e12 constant — a 10x disagreement with this
// one, with the supervisor silently winning. budget.js now owns the ordering;
// this remains only as the floor nfg.js keeps for its own donations.
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
  // The link everything else reports over. If this dies the run goes blind
  // without going wrong, which is the failure mode that is hardest to notice.
  { script: 'rfalink.js', host: 'home', args: [] },
  // Focus is worth 25% and is dropped by any navigation away from the work
  // screen — including cmd.js's own terminal trips — so this needs to be
  // running whenever faction work is. No predicate: it is a no-op when there is
  // no work and it self-guards the export claim on factions being joined, so
  // the trivially-true DAEMON default is exactly right.
  { script: 'upkeep.js', host: 'home', args: [] },
  // A no-op that says so where a gang is not allowed; the whole economy of
  // BitNode 2 where it is. Revived like the batcher: an install kills it and
  // the gang (which survives installs) would sit unmanaged.
  { script: 'gang.js', host: 'home', args: [] },
  // The early-game dispatcher; a no-op once progress.js acts, and the only
  // thing that joins, works or commits crimes before then.
  { script: 'act.js', host: 'home', args: [] },
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
  // backdoor.js itself uses for completion (backdoor.js:155) and what the
  // faction requirements read — and it cannot survive a prestige, because it
  // is not a file. The target list comes from storyservers.js, so the "do not
  // duplicate it" goal is still met.
  //
  // serverExists first: fulcrumassets is not on the network until enough of
  // the map is scanned, and ns.getServer throws on an unknown hostname, which
  // inside a predicate reads as `state: error` rather than as an answer.
  // getServer is already paid for by the homeup trigger below, so the only new
  // cost here is serverExists, which is 0.1GB (RamCostGenerator.ts, scriptRam
  // tier) — measured with the game's own calculator, watchdog.js 7.80 -> 7.90GB.
  // The staging note for this change said 0.05GB; it was wrong.
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
  // Not with Singularity: autobuy.js and the planner buy TOR with no screen,
  // and this is the DOM route (City -> Alpha Enterprises).
  { script: 'torbuy.js', host: 'home', args: [], invariant: (ns) => !ns.hasTorRouter() && !canAccessFeature(ns.getResetInfo(), 4) },
  { script: 'go.js', host: 'home', args: [] },
  // The stock trader, wherever it fits. DAEMON with the game as its guard: no
  // TIX API, no business existing (stock.js exits saying so). An install
  // kills it; its positions are sold first (act.js stocksell) because the
  // install re-initialises the market and every share is lost.
  { script: 'stock.js', host: 'anywhere', args: [], invariant: (ns) => ns.stock.hasTixApiAccess() },
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
  // The dashboard's fast lane. 2.6GB, writes /tel/fast.txt every 2s; tools/dash.mjs
  // is its only consumer and polls that file far more often than it pulls a save.
  //
  // It was in NEITHER this list nor boot.js's STACK, so when it stopped two
  // hours ago nothing restarted it. Its atExit published "fast.js is no longer
  // publishing — dashboard headline numbers are frozen", exactly as designed —
  // and there was no watcher, so the dashboard simply showed stale numbers with
  // a fresh-looking timestamp. A loud failure nobody listens for is a silent one.
  { script: 'fast.js', host: 'home', args: [] },
  // THE FACTION LOOP. Nothing in this list owned it until now, and the cost of
  // that gap was total: nine hours into BitNode 4 with zero factions joined,
  // zero augmentations installed, and three invitations sitting unaccepted,
  // while every other script reported perfect health. share.js sat at
  // "stopped: invariant false" the whole time because its gate is
  // `factions.length > 0` — the reputation MULTIPLIER was off for want of a
  // faction to multiply. This is the exact failure the file header warns
  // about: the game keeps progressing with nobody watching the one quantity
  // that cannot be bought.
  //
  // progress.js is a JOB, not a daemon: it accepts invitations, starts focused
  // faction work, buys augmentations most-expensive-first, and installs when
  // something is queued — then exits. Re-running it IS the mechanism, the same
  // shape as nfg.js and homeup.js.
  //
  // INSTALLS ARE REACHABLE FROM HERE and that is deliberate. progress.js:273
  // only installs when `queued > 0`, i.e. only after it has itself bought
  // augmentations, and it hands 'boot.js' to installAugmentations so the stack
  // comes back up on the other side. It cannot fire on an empty queue.
  {
    script: 'progress.js',
    host: 'home',
    // INSTALLS ARE ENABLED AGAIN, because the decision now has a model behind it.
    //
    // Wiring this entry in with installs unconditional cost $604m and a 3,724GB
    // fleet within ten minutes, for ONE NeuroFlux Governor (+1%). progress.js
    // installed whenever `queued > 0`; its comment about money being destroyed
    // by an install answers WHEN to spend cash, not WHETHER to reset. The stopgap
    // was `--no-install`, which is a refusal rather than a judgement — correct
    // while nothing could judge, and wrong to leave in place, since never
    // installing forfeits the multipliers that are the whole point of a run.
    //
    // installgate.js now decides, on one expression: an install must pay its
    // rebuild back within the expected remaining time in this BitNode, i.e.
    // H* = A/(M-1) < horizon. The +1% case is refused by arithmetic (M = 1.01
    // demands a horizon a hundred times the life's age) rather than by a rule
    // written specially for it, and a real haul of augmentations passes. Both
    // directions are asserted by tools/test/installgate.test.mjs [IG1, IG2],
    // with IG1 replaying the exact trade that went wrong.
    //
    // The decision is published to /tel/installgate.txt on every pass that has
    // a queue, whichever way it falls, so "holding" is visible as a choice with
    // numbers rather than as silence.
    // Installs RE-ENABLED on a forward-looking gate.
    //
    // Both rules that shipped a regression asked about the PAST — "has payback
    // been earned?", "has accumulation slowed?" — and neither could answer the
    // question that decides it: would waiting buy more? installgate.js now
    // compares installing now against what augplan.js says a projected budget
    // could actually buy:
    //
    //     install iff no reachable (M_future, wait) beats ln(M)/A
    //
    // The difference is not subtle. The three bad installs were M = 1.0303 at
    // 0.0037 ln(M)/h; the first decision under this rule is M = 1.2800 at
    // 0.1174/h, having checked and rejected a 0.5h wait worth 0.1063/h.
    //
    // [IG7] replays the live telemetry that caused the thrash and asserts it is
    // refused while anything better is reachable — at any cycle age, which is
    // what the stall timer could not express — and still installs once nothing
    // is left to buy, because a gate that never fires is the worse failure in a
    // node whose exit is multiplier-bound.
    args: [],
    // TRIGGER, not invariant: the job doing its work is not a reason to kill
    // it. And like nfg.js, there is NO cheap honest predicate available here.
    // The things worth gating on — pending invitations, whether faction work
    // is running, current reputation — are all readable only through
    // ns.singularity or ns.getResetInfo, and watchdog.js is in boot.js's STACK,
    // so referencing Singularity in this file would be billed in every BitNode
    // that cannot use it (invariant B4). ns.getPlayer() cannot substitute: its
    // payload is built by hand at NetscriptFunctions.ts:1371-1389 and carries
    // neither currentWork nor factionInvitations.
    //
    // So this is "always true", bounded by JOB_MIN_INTERVAL at one launch per
    // five minutes, and that bound is stated rather than pretended away. It is
    // affordable because progress.js declares 2.6GB via a RAM override and
    // raises only on the path it can actually use. (Spelling that API out in
    // full here would make R1 read this comment as watchdog.js declaring an
    // override of its own and report it as silently ignored — the check greps
    // for the token, so prose must not contain it.)
    trigger: () => true,
  },
  // faction.js is a REPORTER, not an actor — it computes which factions have
  // augmentations still for sale and what requirements are unmet, which is the
  // map progress.js is walking. Run daily-ish rather than every five minutes:
  // the answer changes only when reputation crosses a threshold or an
  // augmentation is bought, and its output is advisory.
  //
  // --print-factions is passed because WITHOUT A FLAG THIS FILE DOES NOTHING
  // AT ALL. Every branch of its `act()` is guarded by one of the print flags,
  // so wiring it in bare would launch a 2.6GB script every interval to produce
  // silence, and silence from a reporter is indistinguishable from a reporter
  // that is not running.
  {
    script: 'faction.js',
    host: 'home',
    args: ['--print-factions', '--no-companies'],
    minIntervalMs: 3600000,
    trigger: (ns) => (ns.getPlayer().factions || []).length > 0,
  },
  // LEAVING THE BITNODE — the step nothing owned until now.
  //
  // Without this the run is autonomous in every respect except finishing: it
  // earns, installs, grows and farms reputation indefinitely, and never takes
  // the last action. backdoor.js covers the five FACTION servers in
  // storyservers.js and was never meant to reach w0r1d_d43m0n.
  //
  // `--next 1` MAKES THIS AUTONOMOUS, and is a real choice worth stating
  // rather than burying. Change the number to pick a different destination;
  // remove the flag entirely and endgame.js stops at "ready" and waits for a
  // human instead.
  //
  // WHY 1, AND THE PLAN IT BELONGS TO. Source-File levels are `sum(base/2^i)`,
  // so each level buys half the previous one, and no Source-File helps the node
  // it is earned in. Priced as hours per percent, over BN1 at ~12h and BN5 at
  // ~25h:
  //
  //     SF1 1->2   +6.90% on EVERY multiplier      ~1.7 h/%   <- cheapest
  //     SF5 0->1   +8.00% on 6 hacking channels    ~3.1 h/%
  //     SF1 2->3   +3.23% on EVERY multiplier      ~3.7 h/%
  //     SF5 1->2   +3.70% on 6 hacking channels    ~6.8 h/%
  //     SF5 2->3   +1.79% on 6 hacking channels   ~14.0 h/%
  //
  // Taking the cheapest increment first shortens every run that follows, so the
  // order is BN1, BN1, then BN5 three times. SF1 is preferred over its raw
  // ratio because it lifts `faction_rep` and SF5 does not
  // (applySourceFile.ts:504-513 touches six hacking multipliers and nothing
  // else) — and the install ladder is rep-bound as much as money-bound.
  //
  // REVISED after the first BN1 run measured 25.7h rather than the 10-15h that
  // table assumed. Most of that was defects since fixed, so a clean BN1 is
  // shorter — but close enough that the percentages stop deciding it, and what
  // decides it instead is what SF5 level 1 UNLOCKS rather than what it adds:
  //
  //   getBitNodeMultipliers  retires the hardcoded BitNode table this repo
  //                          approximates from. Every constant that cost time
  //                          today came out of it — WorldDaemonDifficulty,
  //                          FavorToDonateToFaction, DaedalusAugsRequirement.
  //   Intelligence           the only reward in the game that never resets, so
  //                          earning it earlier compounds over every later node.
  //
  // Against SF1 2->3 at +3.23%, the second-smallest increment on the board.
  // Every hour lost this run went to unpriced or invisible information, not to
  // a missing 3% — so the capability is worth more than the percentage.
  //
  // So: 1 while SF1 was at level 1, 5 from here. Revisit after SF5.1 lands;
  // SF5 1->2 (+3.70%) and 2->3 (+1.79%) are poor trades at ~22h a node and
  // should not be taken by momentum.
  //
  // REVISED 2026-09-21, SF5.1 in hand and SF4.2 about to be: **10**, for
  // sleeves — and the argument is no longer about percentages.
  //
  // This BitNode spent ~20 HOURS on one Homicide karma grind to -54,000. That
  // leg is entirely work-slot-bound, it recurs in EVERY gang node because
  // karma dies at a node change (prestigeSourceFile zeroes it beside the gang
  // itself), and a sleeve is the only thing in the game that parallelises it:
  // each one is another actor committing crime. SF10 grants one per level, to
  // three. Sleeves also work factions, which is the other work-slot leg — the
  // Daedalus reputation this very block is waiting on.
  //
  // The alternative considered was 14, whose Source-File doubles the stat
  // multipliers from Go node power and unlocks go.cheat. Rejected: its exit is
  // 15,000 against BitNode 10's 6,000, with HackingLevelMultiplier 0.4 and
  // HackingSpeedMultiplier 0.3 to get there; its FactionWorkRepGain 0.2 makes
  // the reputation leg five times slower; and GangUniqueAugs 0.4 is the
  // stingiest in the game, so the gang-as-augmentation-ladder that carries
  // these runs is weakest exactly where Go is strongest. The Go bonus it
  // doubles is capped by the install window anyway — it resets on every
  // install (Go/Go.ts:34-47) and currently reads +31.8% over ~1.3h. A long
  // hostile node for a narrow, window-capped reward.
  //
  // NOT computed with nodeplan.rankNodes: that projects the CURRENT
  // multiplier into a fresh node, and prestigeSourceFile strips every
  // augmentation, so it credited a new node with this life's 16.18x and
  // returned ~0h for almost everything. The argument above is from the
  // multiplier tables and this node's own measured legs, and that is stated
  // rather than dressed as a trajectory run.
  //
  // This cannot fire early. It needs hacking 9000 AND root on a server that
  // does not exist on the network until The Red Pill has been installed
  // (Prestige.ts:174-181), which in turn needs 30 augmentations, $100b and
  // 2.5m Daedalus reputation. Every pass before that publishes the gap to
  // /tel/endgame.txt, so the distance to the exit is always visible.
  //
  // Hourly: nothing it waits on changes on a five-minute scale, and it costs
  // 35.2GB while it runs.
  // Sleeve augmentations: baseCost, no x1.9, kept for the whole node, and
  // nothing bought them. sleeveaug.js publishes the offers and buys what
  // progress.js's simulated-exit comparison chose, then exits. Every 10 minutes is ample: the
  // inputs move on the scale of the schedule, and it costs ~19GB while it runs.
  {
    script: 'sleeveaug.js',
    host: 'home',
    args: [],
    minIntervalMs: 600000,
    trigger: (ns) => canAccessFeature(ns.getResetInfo(), 10),
  },
  {
    script: 'endgame.js',
    host: 'home',
    args: ['--next', 8],
    minIntervalMs: 3600000,
    trigger: () => true,
  },
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
    //
    // NOT WITH SINGULARITY. nfg.js is the DOM route: every launch clicks "Do
    // something else simultaneously", navigates to Factions and holds the UI
    // lock — dropping focus, dragging a human's screen away, and standing
    // upkeep.js down while it runs. With Singularity the planner prices NFG
    // levels (augplan planPurchases, donation included) and act.js buys them
    // through donate/buyaug orders with no screen at all. Live 2026-09-24 it
    // was still relaunching in an SF4 node and failing every run ("no
    // NeuroFlux card on this faction", faction '?' — its name regex predates
    // the gang factions).
    trigger: (ns) => ns.getServerMoneyAvailable('home') > NFG_RESERVE && !canAccessFeature(ns.getResetInfo(), 4),
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
    // budget.js, not a magic number. Home outranks purchased servers because
    // home RAM and cores SURVIVE an install and servers do not, so the only
    // thing it yields to is the augmentation plan. The old $2e12 was a figure
    // nobody could reach: buyserv.js spent every surplus dollar every 15s, so
    // the balance never came within three orders of magnitude of it and home
    // was never upgraded for an entire life.
    args: ['--reserve', 0],
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
      const next = nextHomeUpgrade(ns.getServerMaxRam('home'), ns.getServer('home').cpuCores, bitNodeMults(ns.getResetInfo().currentNode)?.HomeComputerRamCost)
      // Published on the job record (jobs['homeup.js'].next) so the planner
      // prices the CURRENT upgrade: homeup.txt's `next` is only as fresh as
      // homeup's last run, and when the hold keeps homeup from running the
      // planner read a stale kind, priced home as unreadable, and the hold
      // stood on that — circular (2026-09-20 10:30, cores from 06:37 while
      // the next block was RAM).
      homeNext = next
      if (!next) return false
      // Hold back only what a HIGHER-priority spender has claimed. ns.read is
      // 0GB and an unreadable claim blocks rather than reading as zero
      // (budget.js [BU2]), so a missing plan file defers the upgrade instead of
      // spending money that is already promised to augmentations.
      const claimSrc = ns.read('/tel/installgate.txt')
      const claimLife = ns.getResetInfo().lastAugReset
      // THE EXIT VERDICT (installgate spendExit.home): the node's exit with this
      // upgrade against without, from progress.js, when it is this life's,
      // fresh and priced the same upgrade. It keeps only the join claim. The
      // ln-per-dollar competition below is the fallback when there is none.
      try {
        const x = JSON.parse(claimSrc || 'null')?.spendExit
        const v = x?.home
        if (x && x.lastAugReset === claimLife && Date.now() - Date.parse(x.at) < 15 * 60e3 && v?.cost > 0 && v.kind === next.kind && Math.abs(v.cost / next.cost - 1) < 0.01) {
          if (!v.buy) return false
          const join = joinClaim(claimSrc, claimLife)
          return isFinite(join) && ns.getServerMoneyAvailable('home') >= next.cost + join
        }
      } catch {
        /* fall back to the claims rule */
      }
      // THE ln(M) COMPETITION (budget.js lnCompete): home's own ln per
      // dollar is the planner's figure (objective.homeLn, published as
      // homeLnPerDollar — the plan channel through the measured elasticity
      // plus the join channel, income brought in before the exit faction's
      // requirement is met). It spends through the join or augmentation
      // hold only when strictly above that rival's figure; an unreadable
      // figure on either side keeps the hold, as it always did. Without
      // this, the $100b join claim sat ahead of a $1b home block for a
      // whole life regardless of which one the trajectory wanted first.
      const ln = marginalLnPerDollar(claimSrc, claimLife)
      const held = budgetHold(
        'home',
        {
          // NO `?? 0` on either: an unreadable claim must block the upgrade, not
          // license it. `join` is money that must be HELD to satisfy a faction's
          // money requirement — Daedalus wants $100b IN HAND, and home RAM is
          // bought with the same dollars.
          join: joinClaim(claimSrc, claimLife),
          augmentations: augClaim(claimSrc, claimLife),
        },
        { lnCompete: { lnPerDollar: ln.home, rivals: { join: ln.join, augmentations: ln.augmentations } } },
      )
      // NOT `return false`. A non-finite hold means the claim could not be
      // READ, which no amount of money will change — and reported as a plain
      // false it is indistinguishable from "saving up", which is what let it
      // sit for hours. The named reason is what the liveness check escalates.
      if (!isFinite(held)) {
        // Name the claimant that actually failed. This message used to say
        // "the augmentation claim ... augClaim refuses a stale lastAugReset"
        // unconditionally, and when joinClaim was the one returning null it
        // sent the reader to the wrong function with a wrong explanation —
        // augClaim was answering correctly the whole time. A diagnostic that
        // misnames its own cause is worse than a bare "blocked": it spends the
        // reader's time disproving it. Recomputed here rather than threaded out
        // of budgetHold so this stays a pure reporting path.
        const unreadable = []
        if (!isFinite(joinClaim(claimSrc, claimLife))) unreadable.push('joinClaim (join money)')
        if (!isFinite(augClaim(claimSrc, claimLife))) unreadable.push('augClaim (augmentation plan)')
        return {
          blocked:
            `/tel/installgate.txt does not yield a usable claim: ${unreadable.join(' and ') || 'budgetHold itself'} ` +
            'returned a non-finite value (absent field, malformed file, or a lastAugReset from a previous BitNode). ' +
            'progress.js is what rewrites it; if it cannot run, this upgrade and that file wait on each other forever. ' +
            'Note both readers must be satisfied — an explicit "nothing planned" has to carry EVERY claim field, not ' +
            'just the ones an older publisher knew about (see [C9]).',
        }
      }
      return ns.getServerMoneyAvailable('home') >= next.cost + held
    },
  },
]

const INTERVAL = 30000

/**
 * script -> consecutive cycles its trigger has returned `{ blocked }`.
 *
 * Module scope, so it survives the cycle loop and NOT a restart: a watchdog
 * that just came up has no business claiming it has watched anything stall.
 */
const blockedFor = {}
/** The home upgrade the homeup trigger last priced, for jobs['homeup.js'].next. */
let homeNext = null

/** script -> consecutive cycles its OWN telemetry has reported health:error. */
const failingFor = {}
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
/**
 * Threads to run share.js with — CAPPED BY WHAT FITS, never floored above it.
 *
 * This used to return `Math.max(600, ...)`, an unconditional floor of 600
 * threads. At 4GB per thread that is 2,400GB **on a single host**, because
 * ns.exec cannot split threads across machines. It was survivable while the
 * BitNode-1 fleet was enormous; after an install the fleet is ~1.5TB with a
 * 512GB largest host, so the request could never be satisfied and the watchdog
 * reported `blocked: no host with room` forever — while faction work was
 * running and share.js exists precisely to multiply its reputation.
 *
 * A floor that exceeds capacity is not conservative, it is an outage. The
 * bonus is `1 + ln(threads)/25`, so it is logarithmic and generous at small
 * counts: 128 threads is already +19.4%, against +25.6% for the 600 that could
 * not be placed. Refusing 19.4% because 25.6% will not fit is the whole bug.
 *
 * The floor becomes a USEFULNESS test instead: below MIN_USEFUL the bonus is
 * too small to be worth the RAM, and we decline rather than ask for something
 * that cannot be placed. Returning 0 means "do not launch" to the caller.
 */
function shareThreads(ns, hosts, frac = 0.8) {
  const perThread = ns.getScriptRam('share.js', 'home') || 4
  const MIN_USEFUL = 32 // 1 + ln(32)/25 = +13.9%
  // HOME IS NOT FREE REAL ESTATE. progress.js raises itself to a Singularity
  // allocation via ns.ramOverride and needs it as ONE contiguous block on home;
  // at SF4.1 that is ~1197GB. This function used to measure home's raw free
  // space and claim 80% of it, which is how share.js came to hold 960GB (240
  // threads) of a 2048GB home while progress.js was denied 1192.85GB pass after
  // pass with `ram-raise-denied`.
  //
  // The trade is not close, and it is self-defeating in the obvious direction:
  // share multiplies faction-work reputation by 1 + ln(threads)/25, and
  // progress.js is what STARTS the faction work. Starving it bought a bonus on
  // an activity that was not running.
  //
  // The 13 + 6.25*mult formula is duplicated from batch.js's SETTINGS.homeReserve
  // ON PURPOSE — importing progress.js here would drag its whole Singularity
  // import graph into the watchdog's price. [R6] is the check that keeps the
  // copies honest; change one and it fails.
  const homeReserve = 13 + 6.25 * singularityRamMultiplier(ns.getResetInfo())
  let biggest = 0
  for (const h of hosts) {
    // Never a hacknet server: share's bonus is not priced against the hashes
    // its RAM would cost there.
    if (!ns.hasRootAccess(h) || isHacknetServerHost(h)) continue
    const free = ns.getServerMaxRam(h) - ns.getServerUsedRam(h) - (h === 'home' ? homeReserve : 0)
    if (free > biggest) biggest = free
  }
  const fits = Math.floor((biggest * frac) / perThread)
  if (fits < MIN_USEFUL) return 0
  return Math.min(250000, fits)
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

/**
 * A script's imported modules, so a relaunch onto another host copies them too.
 *
 * This is a prerequisite of the C1 change, not a nicety. `ns.scp(script, ...)`
 * copies the script alone, and Netscript's compile is static: a script whose
 * import is missing on the target server does not degrade, it FAILS TO LAUNCH.
 * share.js is placed 'anywhere' and now imports status.js, so without this it
 * would simply stop running the moment the watchdog put it on a rooted server —
 * and the symptom would be the one this whole change exists to remove, a
 * daemon that is silently not there. lock.js and homecost.js have had the same
 * latent gap all along; it has not bitten only because their importers all run
 * on home.
 *
 * Costs nothing: ns.read is 0GB (RamCostGenerator.ts:634) and ns.scp is already
 * referenced below. One level deep is enough and is asserted rather than
 * assumed — status.js, lock.js, homecost.js, sfgate.js, storyservers.js,
 * golib.js and ctsolvers.js all import nothing at all, which is what makes them
 * free to import in the first place. If a shared module ever gains an import of
 * its own, make this recurse.
 */
function modulesOf(ns, script) {
  try {
    const src = ns.read(script)
    return [...src.matchAll(/^\s*import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1].replace(/^\.?\//, ''))
  } catch {
    // Unreadable source is not a reason to refuse the relaunch; scp'ing the
    // script alone is exactly the old behaviour.
    return []
  }
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
    if (!ns.hasRootAccess(h) || h === 'home' || isHacknetServerHost(h)) continue
    const free = ns.getServerMaxRam(h) - ns.getServerUsedRam(h)
    if (free >= need && (!best || free < best.free)) best = { host: h, free }
  }
  if (best) return best.host
  if (ns.getServerMaxRam('home') - ns.getServerUsedRam('home') >= need) return 'home'
  // Last resort only: a hacknet server pays for the RAM in hashes.
  for (const h of hosts) if (isHacknetServerHost(h) && ns.hasRootAccess(h) && ns.getServerMaxRam(h) - ns.getServerUsedRam(h) >= need) return h
  return null
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
  const errors = []
  let cycles = 0

  // Everything the file already carried moves into the base thunk, so it rides
  // on EVERY write — the healthy one, the failed one and the last one. Field
  // names, contents and meanings are unchanged; `health`, `errors` and
  // `cycles` are additive.
  //
  // `restarts` stays derived here exactly as before. It is kept for anything
  // that already reads it (the gameplay log quotes `restarts: {}` as the
  // all-healthy signal); the per-kind sections remain the real answer.
  const note = reporter(ns, TELEMETRY, () => {
    const restarts = {}
    for (const g of [daemons, jobs]) for (const k of Object.keys(g)) restarts[k] = g[k].count
    return {
      since,
      cycles,
      jobMinIntervalMs: JOB_MIN_INTERVAL,
      // Nonzero counts here are a question to answer: what is killing it?
      daemons,
      // Nonzero counts here are work getting done. Compare against `state`
      // and `lastLaunch` rather than treating the number as a fault.
      jobs,
      restarts,
      errors: errors.slice(-5),
    }
  })

  // The path no try/catch can reach — and for this file it is the one that
  // matters most, because this is the process that notices everything else
  // dying. Nothing watches the watchdog. Until now a killed or crashed
  // watchdog left /tel/watchdog.txt frozen on a healthy-looking cycle, and
  // every script in WATCHED could then die one by one with the file still
  // reading `state: 'running'` for all of them. That is the C1 failure
  // compounded: one silent death makes thirteen more silent.
  //
  // ns.atExit costs 0GB and runs before the worker is torn down
  // (killWorkerScript.ts:56-84), so the synchronous write still lands. It fires
  // on `kill`, on a killall and on an augmentation install — and an install is
  // exactly when this is needed, since boot.js has to be run by hand afterwards
  // (the autoexec does not fire, NetscriptWorker.ts:247) and a life where
  // nobody did that looks, from the telemetry, like a life where nothing
  // happened. Explicit id 'status' so this can never replace the 'ui-lock'
  // callback lock.js registers, nor be replaced by it.
  //
  // restoreLaunchClock() reads this same file on the next start. note.exit
  // republishes the last body, so every `lastLaunch` stamp survives the exit
  // and the JOB rate limit is still restored correctly after a restart — which
  // is the whole point of that function (watchdog.js:416-425).
  ns.atExit(() => {
    note.exit('stopped', { detail: 'watchdog.js is no longer running — nothing is restarting anything' })
  }, 'status')

  while (true) {
    try {
      cycles++
      // For the 0GB readers of sfgate.singularityKnown (backdoor.js, torbuy.js).
      ns.write(SF_FILE, JSON.stringify({ at: new Date().toISOString(), singularity: canAccessFeature(ns.getResetInfo(), 4) }), 'w')
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
          // A trigger may answer three things, not two. `true` launches and
          // `false` means "not yet" — but a guard can also be unable to decide,
          // and THAT is a different state with a different remedy.
          //
          // Returning `{ blocked: reason }` says so. It is deliberately an
          // object rather than a string because a string is truthy and would
          // have launched the job, silently turning a refusal into a run.
          //
          // The distinction exists because "waiting" and "blocked" look
          // identical in telemetry and are opposites in meaning. Live: homeup.js
          // read `idle: trigger false` for hours with $2.75b in the bank, which
          // is what a job waiting on an unaffordable upgrade also looks like.
          // It was not waiting. augClaim refused the previous BitNode's stale
          // claim (budget.js:189), budgetHold returned non-finite, and the
          // trigger could not decide — forever, because the only script that
          // rewrites that claim was itself waiting on the RAM this upgrade
          // would have bought. Money cannot resolve a blocked trigger; only a
          // human or a fix can, so it has to be said out loud.
          const predicate = predicateOf(entry)
          const verdict = predicate ? predicate(ns) : true
          const blocked = verdict && typeof verdict === 'object' && typeof verdict.blocked === 'string' ? verdict.blocked : null
          // Counted here rather than inside the branch below, so that a trigger
          // going healthy CLEARS the count on the path that does not take it.
          if (blocked) blockedFor[script] = (blockedFor[script] ?? 0) + 1
          else delete blockedFor[script]
          if (predicate && (blocked || !verdict)) {
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
              //
              // A BLOCKED job is the opposite: it will never become true on its
              // own, so it is counted and escalated rather than left quiet.
              rec.state = blocked ? `BLOCKED: ${blocked}` : 'idle: trigger false'
            }
            if (blocked) rec.blockedFor = blockedFor[script]
            if (script === 'homeup.js') rec.next = homeNext
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
          // A thread function may return 0 to mean "not worth launching right
          // now" — shareThreads does, when too little RAM is free for the bonus
          // to be worth it. This must be checked BEFORE `threads ?? 1`, because
          // `0 ?? 1` is 0, not 1: nullish coalescing does not catch zero, and
          // ns.exec with 0 threads is an error rather than a no-op. The same
          // `0 ?? fallback` trap produced a fixed obstacle layout in the Go
          // harness for the whole of its board-size study.
          if (threads === 0) {
            rec.state = 'declined: too little free RAM to be worth launching'
            continue
          }
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
          //
          // The script AND its imports: a missing module is a hard compile
          // failure on the target, not a degradation. See modulesOf().
          if (target !== 'home') ns.scp([script, ...modulesOf(ns, script)], target, 'home')

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
      // it is now derived, and the per-kind sections are the real answer. All of
      // that now lives in the reporter's base thunk at the top of main(), so it
      // is written on the failed and final passes too rather than only this one.
      //
      // 'degraded' rather than 'ok' when any entry is in an error state: a
      // predicate that throws every cycle means that entry is not being managed
      // at all, and the per-entry catch below is the only thing that knows.
      const faulted = [...Object.values(daemons), ...Object.values(jobs)].filter((r) => r.state === 'error').length

      // OUTCOMES, NOT JUST LAUNCHES — the blind spot this watchdog was built
      // with.
      //
      // Everything above tracks whether a script STARTED. Nothing tracked
      // whether it then worked. A managed script that hits a fault, publishes
      // `health: 'error'` to its own telemetry and returns 0 is, to this loop,
      // indistinguishable from one that did its job: `progress.js | count 8 |
      // err None` while every one of those eight runs had failed to raise RAM
      // and done nothing at all.
      //
      // That is not specific to progress.js. Every script in the collection
      // reports through status.js and every one of them exits cleanly on a
      // handled failure — which is correct behaviour, and precisely what makes
      // it invisible from here. The supervisor was reading the wrong half of
      // the contract.
      //
      // FRESHNESS IS THE WHOLE TRICK. A record older than the script's last
      // launch describes a PREVIOUS run — often a previous BitNode — and
      // escalating it would resurrect fixed faults forever. So a record only
      // counts when it post-dates the launch it is supposed to describe, and a
      // script that has never been launched this session is skipped entirely.
      const failingNow = []
      for (const entry of WATCHED) {
        const script = entry.script
        const launched = lastLaunch[script]
        let rec = null
        try {
          rec = JSON.parse(ns.read(`/tel/${script.replace(/\.js$/, '')}.txt`) || 'null')
        } catch {
          /* unreadable telemetry is not itself a fault — the script may never
             have run, and a parse error must not become an alarm about work */
        }
        const at = rec?.at ? Date.parse(rec.at) : NaN
        // STRICTLY: launched this session, AND the record post-dates that
        // launch. `!launched` must NOT count as fresh — a script this watchdog
        // has never started has left us no evidence, only history, and history
        // here is usually a previous BitNode. The first version of this check
        // read `(!launched || at >= launched)` and escalated nfg.js on its
        // opening cycle over a 45-minute-old record from before the fix that
        // resolved it: a brand-new monitor's first act was to report a fault
        // that no longer existed. Missing a fault for one launch cycle is
        // cheap; a monitor that cries wolf on startup is not.
        const fresh = isFinite(at) && typeof launched === 'number' && at >= launched
        // A raise the host is simply TOO SMALL FOR is a wait, not a fault.
        //
        // At SF4 level 1 progress.js needs 1188.85GB and a BitNode opens on a
        // 32GB home, so "denied" is the normal state for the first hours of
        // every node, resolving itself as homeup.js buys RAM. Escalating it
        // would guarantee a red on the board during every bootstrap, which is
        // how a health signal stops being read.
        //
        // The judgement lives HERE and not in ramgrow.js for a reason worth
        // writing down: the script doing the raising is still at its 2.60GB
        // floor at that moment, so it cannot afford ns.getHostname (0.05GB) and
        // ns.getServerMaxRam (0.05GB) to ask how big its host is — the first
        // attempt to put this test there died with `Dynamic RAM Usage 2.65GB
        // per thread, RAM Allocation 2.60GB`. The supervisor already pays for
        // getServerMaxRam in placeFor, so it costs nothing to decide here. A
        // process too constrained to act is generally too constrained to
        // diagnose itself; that is what a supervisor is for.
        const capacityWait =
          rec?.result === 'ram-raise-denied' &&
          typeof rec.wanted === 'number' &&
          rec.wanted > ns.getServerMaxRam(entry.host === 'anywhere' ? 'home' : (entry.host ?? 'home'))

        if (rec?.health === 'error' && fresh && !capacityWait) {
          failingFor[script] = (failingFor[script] ?? 0) + 1
          if (failingFor[script] >= 2) failingNow.push([script, failingFor[script], String(rec.detail ?? rec.result ?? '').slice(0, 90)])
        } else {
          delete failingFor[script]
        }
      }

      // LIVENESS. A blocked trigger is not a slow one: it cannot become true by
      // waiting, so every cycle it survives is a cycle the run is not advancing.
      // Two cycles is the bar rather than one because a single cycle can catch a
      // file mid-write, which is a real and self-healing condition.
      //
      // This is the general form of a failure we have now hit four times in one
      // day, in four unrelated subsystems: a guard that is individually correct,
      // fail-closed, and composes into a cycle it cannot leave. The other three
      // were found by a human reading telemetry hours late. This one says so on
      // the second cycle, in the file the operator already watches.
      const stalled = Object.entries(blockedFor).filter(([, n]) => n >= 2)
      if (failingNow.length) {
        for (const [s2, n, why] of failingNow) ns.print(`watchdog: ${s2} has reported health:error for ${n} cycles — ${why}`)
        note('error', {
          faulted,
          failing: Object.fromEntries(failingNow.map(([s2, n, why]) => [s2, { cycles: n, detail: why }])),
          ...(stalled.length ? { stalled: Object.fromEntries(stalled) } : {}),
          detail:
            `${failingNow.map(([s2, n]) => `${s2} failing ${n} cycles`).join('; ')} — these scripts START fine and then ` +
            `fail at their work, which launch-tracking alone cannot see.`,
        })
      } else if (stalled.length) {
        for (const [s, n] of stalled) {
          ns.print(`watchdog: ${s} BLOCKED for ${n} cycles — ${jobs[s]?.state ?? daemons[s]?.state ?? ''}`)
        }
        note('error', {
          faulted,
          stalled: Object.fromEntries(stalled),
          detail:
            `${stalled.map(([s, n]) => `${s} blocked ${n} cycles`).join('; ')} — a blocked trigger cannot resolve itself. ` +
            `Its inputs are unreadable, not merely unaffordable, so waiting will not fix it.`,
        })
      } else {
        note(faulted ? 'degraded' : 'ok', faulted ? { faulted } : {})
      }
    } catch (err) {
      // The per-entry try above covers a predicate or a launch throwing. It does
      // NOT cover the cycle's own scaffolding: the network walk, the iteration
      // itself, or the telemetry write. A throw there escaped main() entirely and
      // took down the one process whose job is noticing that processes have gone
      // down — silently, leaving the file frozen mid-cycle with every entry still
      // reading `state: 'running'`.
      //
      // Never die, for the same reason batch.js does not: a bad tick is
      // recoverable, a dead watchdog is not. And publish from inside the catch,
      // because the write that would have reported it is the statement the throw
      // skipped.
      try {
        const detail = record(errors, err)
        ns.print(`watchdog cycle error: ${detail}`)
        note('error', { detail: describe(err) })
      } catch {
        /* nothing left to try */
      }
    }

    await ns.sleep(INTERVAL)
  }
}
