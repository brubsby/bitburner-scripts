// Brings up as much of the stack as this home is big enough to be worth.
//
//   run boot.js
//
// Set it as Options -> System -> Autoexec Script so it runs on every game load.
// That does NOT cover the post-install case, which is the one that matters
// most: the game only creates the autoexec entry for a server that has *saved
// running scripts* (`if (skipScriptLoad || !rsList) continue`,
// NetscriptWorker.ts:247), and an install kills every script, so the list is
// empty and the autoexec is skipped. Whoever performs an install must run this
// afterwards by hand.
//
// Idempotent, and idempotent in both directions: it starts what the plan wants
// and stops what the plan no longer wants, so it converges from whatever state
// the game is actually in rather than only from a clean one. Run it again after
// every home RAM upgrade — that is the entire upgrade procedure.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A PLAN AND NOT A LIST
// ---------------------------------------------------------------------------
//
// Home RAM at BitNode entry is 128GB with SF9.2, 32GB with SF1, and **8GB**
// otherwise (Prestige.ts:242-248). The previous version of this file declared
// one static list of ten home-pinned scripts totalling 82.60GB and itself cost
// 7.90GB, which on an 8GB entry left 0.10GB free — less than the cheapest thing
// in its own list. It booted nothing, reported ten "no host with NGB free"
// lines, and exited zero. On the 32GB save it managed four of ten.
//
// So: STACK below is DATA — script, where it belongs, the home size at which it
// starts being worth its RAM, and why. stack.js turns that into a plan against
// the home in front of it, using `ns.getScriptRam` for every price so that a
// script whose cost depends on the Source-File level (autobuy.js: 5.85GB inside
// BitNode 4, 65.85GB at SF4.1 elsewhere — RamCostGenerator.ts:82-96) is judged
// on what it will actually cost *here*.
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE IS NOT ALLOWED TO REFERENCE
// ---------------------------------------------------------------------------
//
// Netscript bills a script for every ns function named anywhere in its import
// graph, so the launcher's own size is subtracted from every tier it launches
// into. At 8GB each 2.00GB is a whole worker thread. Four things were moved out
// of this file for that reason and the RAM is written down so a future edit has
// to argue with the number:
//
//   ns.scriptKill       1.00GB  retiring a superseded script       -> retire.js
//   ns.getServer        2.00GB  cores, for the "cash is idle" nag  -> bootnag.js
//   ns.getPlayer        0.50GB  factions, for the same nag         -> bootnag.js
//   ns.hasTorRouter     0.05GB  the torbuy `when` gate             -> torbuy exits on its own
//   ns.getServerMoneyAvailable
//                       0.10GB  the idle-cash nag                  -> bootnag.js
//
// That is 3.65GB out. One thing came IN, deliberately:
//
//   ns.spawn            2.00GB  hand home to the worker and EXIT
//
// so the launcher is 6.20GB rather than 7.90GB. The spawn is not a convenience.
// ns.exec launches into a home that still contains this script; ns.spawn kills
// this script first (NetscriptFunctions.ts:644-650). On an 8GB home that is the
// difference between 3.80GB free (one worker thread) and 8.00GB free (four —
// one complete HGW batch). A more expensive launcher that leaves beats a
// cheaper one that stays.
//
// retire.js (2.85GB) is exec'd only when something the plan no longer wants is
// actually running, which on a virgin entry is never — nothing has ever been
// started there. bootnag.js (4.35GB) is admitted at 128GB, where it is noise.
// Below that the human reads /tel/boot.txt, which this still writes for free.
//
// NOT cleared here, deliberately: stale /tel/ui-lock.txt and /cmd/busy.txt from
// the previous life. Text files survive a prestige (prestigeHomeComputer,
// Server/ServerHelpers.ts:226-239, resets programs, serversOnNetwork and
// ramUsed but not files), so they really do carry over — but `ns.rm` costs
// 0.60GB, priced as Scp, which is a third of a worker thread on an 8GB home.
// Each file is cleared by its owner instead, for free, because both owners
// already reference ns.rm: lock.js rejects a record whose instance nonce is
// from a previous life, and cmd.js drops a stale busy file on startup.
//
// BEFORE THE NEXT INSTALL: run `homeup.js --reserve 0`. Home RAM and cores are
// the only purchases that survive a prestige; money is deleted by it.

import { planStack, MIN_OPS } from 'stack.js'
// status.js references only ns.write (0GB) and this file registers ns.atExit
// (0GB), so invariant C1 costs the launcher nothing.
import { reporter, describe } from 'status.js'

// ---------------------------------------------------------------------------
// THE MANIFEST. Plain data — no functions, no ns, nothing that has to be
// evaluated to be read. The test suite parses it and runs the real planner over
// it, so a tier added here is a tier the suite checks.
//
//   script   what to run
//   where    'home' (charged against the home budget) or 'anywhere'
//   role     'worker' entries are self-threaded and take whatever is left over
//   tier     smallest home RAM at which this is worth its RAM. A VALUE
//            judgement, with the reason in `why`. Fitting is a separate test.
//   until    home RAM at which it is retired (exclusive). Absent = never.
//   rank     value order. Lower is admitted first when the budget is tight.
//   kind     'job' = watchdog-triggered one-shot. Budgeted here so its RAM is
//            not handed to a daemon, but NOT launched from here.
//   advances the gating resource this script can RAISE. Every other field
//            describes what an entry costs or how much it is worth; this one
//            describes what it PRODUCES, and it exists because the difference
//            turned out to be load-bearing.
//
//            A tier is a fixed point unless something admitted at it can raise
//            home RAM toward the next one. Live, tier 32 was exactly that: the
//            only script in the repo that buys home RAM is homeup.js, which was
//            tier 64 AND `kind: 'job'`, and the job runner — watchdog.js — was
//            tier 64 too. So a 32GB home earned money it could never convert
//            into capability, and the node could not advance without a human.
//            BitNode 4 and BitNode 5 were both bridged by hand without anyone
//            noticing the ladder had no bottom rung.
//
//            [B7.10] reads this field and fails any tier that cannot advance
//            itself, from the manifest alone. Nothing else in the suite could
//            have caught it: every entry priced, fitted, earned and was
//            admitted somewhere — the plan was correct in every respect except
//            that it could not reach the next plan.
// ---------------------------------------------------------------------------
const STACK = [
  // -- tier 8: a virgin BitNode entry. -------------------------------------
  //
  // Home is 8GB and nothing else is rooted yet. But the 0-port servers are
  // free the moment NUKE.exe runs — n00dles 4GB, foodnstuff 16GB,
  // sigma-cosmetics 16GB, joesguns 16GB, hong-fang-tea 16GB, harakiri-sushi
  // 16GB, nectar-net 16GB — about 100GB, twelve times the home this life
  // started with. (ns.nuke checks open ports ONLY, not hacking level:
  // NetscriptFunctions.ts:504-521. The level gate is on *hacking*, not on
  // rooting, which is why rooting can run ahead of the level.)
  //
  // So at 8GB the entire job is: root, get workers onto that 100GB, and put
  // the one or two threads home has left to work as well. Everything else in
  // this file is deferred, not because it is broken but because on an 8GB home
  // every 2.00GB is a worker thread and nothing else in the game can start
  // before money and hacking experience exist.
  {
    script: 'hgw.js',
    where: 'home',
    role: 'worker',
    tier: 8,
    until: 32,
    rank: 0,
    why: 'the only self-threaded HGW loop that fits four concurrent ops in an 8GB home (2.00GB x 4 = 8.00GB); early.js is 2.40GB and needs 9.60GB',
    retire: 'early.js is better tuned per thread and fits from 32GB up',
  },
  {
    script: 'early.js',
    where: 'home',
    role: 'worker',
    tier: 32,
    until: 128,
    rank: 1,
    why: 'the tuned threshold loop — floor 0.5 and +5 security slack were swept (early.js header); worth its extra 0.40GB once four threads of it fit',
    retire: 'batch.js owns home RAM from 128GB and places its own h/g/w',
  },
  // seed.js costs home nothing: it is placed on the first rooted host with room
  // for it. It roots whatever has become reachable and keeps every host full of
  // workers as the hacking level rises, which is the single highest-leverage
  // thing running in the opening — and the thing the watchdog would otherwise
  // do for 7.80GB that this tier cannot pay.
  {
    script: 'seed.js',
    where: 'anywhere',
    tier: 8,
    until: 128,
    rank: 2,
    args: ['--watch'],
    why: 'spreads the worker over every rooted host and keeps rooting; costs the home budget nothing because it is placed off home',
    retire: 'batch.js and seed.js both want the whole fleet — seed fills every host with self-threaded workers that the batcher then cannot place batches into (watchdog.js makes the same argument about auto.js)',
  },

  // -- tier 32: SF1, the smallest entry that can hold a controller. ---------
  {
    script: 'homeup.js',
    where: 'anywhere',
    tier: 8,
    // 64 -> 128. `until` says "retire once watchdog.js takes over as a job",
    // and 64 was watchdog.js's tier — but the handover is not guaranteed at
    // that size, and when it fails the result is a DEADLOCK rather than a
    // slowdown: nothing else admitted below the watchdog can raise home RAM,
    // so home never reaches the size at which the watchdog fits.
    //
    // Live on 2026-09-22 in BitNode 10. Leaving BitNode 4 tripled the action
    // slot — Singularity is free inside BN4 and costs 4x at SF4.2 — from
    // 8.25GB to 26.25GB. At 64GB home that leaves 2.4GB after the launcher,
    // the worker slots and the action slot, so watchdog.js (8.9GB) deferred
    // and the homeup JOB (6.6GB) deferred with it. homeup --watch had already
    // retired at 64. Home sat at 64GB for four and a half hours holding
    // $66m against a $47.8m upgrade, with sleeve.js unplaceable the whole
    // time — in the BitNode entered specifically for sleeves.
    //
    // 128 is where the watchdog fits with the action slot at its SF4.2 size.
    // The resident copy is rank 3, so it is admitted long before the entries
    // that squeeze the watchdog out.
    until: 128,
    rank: 3,
    args: ['--watch', '--reserve', 0],
    advances: 'homeRam',
    why:
      'THE BOTTOM RUNG. Nothing else admitted below 64GB can raise home RAM, so without this the tier is a fixed ' +
      'point: it earns money it can never spend on the only resource the tiering is keyed to. Live in BitNode 1 that ' +
      'cost nine hours at $8.6m/h while one $10m purchase stood between the run and $22b/h. Resident rather than a ' +
      'job because the job runner (watchdog.js) is itself tier 64, which is the circularity. --reserve 0 because at ' +
      'this tier there is no augmentation plan to hold money for: progress.js is not admitted either',
    retire:
      'watchdog.js arrives at 64GB and runs the same script as a job with the same arithmetic, so a resident copy ' +
      'past that point is a second buyer holding 4.45GB to duplicate work. homeup.js --watch also stands itself down ' +
      'the moment it sees watchdog.js running, so the retirement holds mid-life and not only at the next boot',
  },
  {
    // THE LINK ITSELF, admitted below everything that reports over it. The
    // machine suspends 1-4 times a day (KDE idle suspend, unchanged for a
    // fortnight); the game survives it and the websocket does not, so the
    // whole /tel surface freezes at the moment of sleep while the run carries
    // on. On 2026-09-23 that hid 393 minutes — six hourly checks reading a
    // snapshot from 03:35, unable to tell a frozen view from a quiet game.
    //
    // The reconnect CANNOT come from the daemon: the Remote File API is the
    // game connecting to us, so the initiative has to be on the page. 1.60GB —
    // `window` goes through eval, so nothing here is priced.
    script: 'rfalink.js',
    where: 'anywhere',
    tier: 8,
    rank: 4,
    why:
      'reconnects the Remote File API from inside the game when the websocket dies, which is what a machine suspend '
      + 'does to it every time. Without it every /tel file silently freezes at the moment of sleep and stays frozen '
      + 'until a human opens the browser — the run continues underneath, so nothing looks wrong, which is the exact '
      + 'shape this repo keeps paying for. Ranked just above errlog.js because a crash report that cannot leave the '
      + 'game is not a report. Only calls newRemoteFileApiConnection when the game itself says the link is not live, '
      + 'and at most once a minute, so a dead daemon costs one attempt per minute rather than a storm.',
  },
  {
    script: 'errlog.js',
    where: 'anywhere',
    tier: 8,
    rank: 5,
    why:
      'mirrors the game\'s own error ring buffer (ErrorState, last 100) to /tel/errors.txt, so a crash is visible ' +
      'over the RFA instead of only as a modal on the player\'s screen. Admitted at the LOWEST tier on purpose: an ' +
      'agent is blindest exactly when RAM is scarcest, and the failure that motivated it — ctscan.js dying twice, ' +
      'once out of RAM and once on a BigInt, writing nothing either time — was read as "no contracts exist" and ' +
      'cost a wrong report plus ~$1.9b left sitting on the network. Runs off home so it costs the home budget nothing.',
  },
  {
    script: 'torbuy.js',
    where: 'home',
    tier: 32,
    rank: 6,
    why: 'TOR gates the darkweb, which gates the port programs, which gate every remaining server — and it is the one purchase autobuy.js could never make without SF4. Exits as soon as TOR is owned. Deferred from 8GB because it polls for $200k an 8GB opening does not have, holding a worker thread for the whole wait',
  },
  {
    script: 'cmd.js',
    where: 'home',
    tier: 32,
    rank: 7,
    why: 'the terminal bridge — backdoor.js drives it, and it is what makes headless play possible at all. 8.15GB is three worker threads, which is why it waits for 32GB',
  },
  {
    script: 'backdoor.js',
    where: 'home',
    tier: 32,
    rank: 9,
    why:
      'backdoors gate the faction invites that gate every augmentation; an install wipes them and forgetting it means ' +
      'reputation earns zero until a human notices. Needs cmd.js, so it is ranked directly after it. ' +
      'Restored to tier 32: the 4.60GB it was moved to free is no longer needed, because the bottom-rung advancer runs OFF home (where: anywhere) and costs the home budget nothing.'
  },
  {
    script: 'settings.js',
    where: 'home',
    kind: 'oneshot',
    tier: 32,
    rank: 10,
    why: 'turns off the confirmation modals that otherwise interrupt every UI-driving script, then exits — its steady-state footprint is zero, so it is budgeted transiently rather than given a permanent 2.30GB slot',
  },
  {
    script: 'tel.js',
    where: 'anywhere',
    tier: 32,
    rank: 11,
    why: 'the save file excludes running scripts, so this is the only source of "what is actually running". Placed off home — 4.00GB of home is two worker threads and this needs none of them',
  },

  // -- tier 64: the first purchased doubling. ------------------------------
  {
    script: 'gang.js',
    where: 'anywhere',
    tier: 64,
    rank: 27,
    why:
      'in a gang-capable node the gang faction becomes the augmentation ladder and the money. gang.js waits (refusing, ' +
      'in its telemetry) until a gang faction is joined, then creates, recruits, assigns, ascends and ' +
      'equips by gangplan.js. ~28GB of gang API, off home on a rooted 64GB host — hours before home could hold it.',
  },
  {
    script: 'watchdog.js',
    where: 'home',
    tier: 64,
    rank: 12,
    why: 'resilience is worth 7.80GB only once there is a stack worth reviving. seed.js makes this argument itself: at 32GB it is three worker threads, "too expensive in the one phase where threads are the whole game"',
  },
  {
    script: 'act.js',
    where: 'anywhere',
    tier: 32,
    rank: 28,
    why:
      'the early-game Singularity strategy. progress.js cannot act until home spares 9.55 + 81 x mult GB in one ' +
      'block (1,305GB at SF4.1, hour 9 of the BN5 run); act.js is ~6GB, decides with actplan.js, and runs ONE ' +
      'single-call actor at a time (act-join/work/crime/gym/travel.js, 32-80GB) on whichever rooted host has the ' +
      'room. It idles the moment progress.js reports a live acting pass.',
  },
  {
    // MOVED OUT OF tools/test/stage.test.mjs's HAND_RUN LIST on 2026-09-22,
    // on entering BitNode 10 — the deliberate step that list exists to force.
    // It was exempt because "a standing job would be a guaranteed no-op"
    // without Source-File 10, which was true until this node and is the reason
    // sleeve.js sat fully written, RAM-overridden and covered by [R1..R5]
    // while nothing ever launched it.
    //
    // Sleeves are why this node was chosen. The previous BitNode spent ~20
    // hours on one Homicide karma grind to -54,000 — work-slot-bound, and it
    // recurs in every gang node because prestigeSourceFile zeroes karma. A
    // sleeve is another actor committing crime, so the grind divides.
    //
    // 2.60GB declared, raised to 41.15GB at runtime once sfgate says the API
    // is usable (the ns.sleeve.* surface is 4GB a call and is NOT scaled by
    // Source-File 4). It refuses in telemetry rather than throwing when the
    // capability is absent, so it is safe in the manifest in every node.
    script: 'sleeve.js',
    where: 'anywhere',
    tier: 64,
    rank: 29,
    // Declares 2.60GB, raises to this once sfgate confirms the API. Placement
    // must use the RAISED figure or the raise is denied on arrival.
    // 41.75 -> 45.75: ns.sleeve.setToFactionWork, so the fleet can work the
    // faction whose reputation gates the exit. Still well inside tier 64.
    raisesTo: 45.75,
    why:
      'sleeves are parallel actors: each one commits crime, trains or works a faction alongside the player, and the ' +
      'karma grind that gates a gang is the single longest work-slot leg of a gang node. Refuses by name in ' +
      '/tel/sleeve.txt without Source-File 10, so it costs 2.60GB and says why in nodes that cannot use it.',
  },
  {
    script: 'hacknet.js',
    where: 'anywhere',
    tier: 32,
    rank: 15,
    why:
      'buys the cheapest hacknet upgrade that moves a Netburners requirement and STOPS — 100 levels, 8 RAM, 4 cores. ' +
      'Netburners is five distinct augmentations, and distinct augmentations are the Daedalus gate. The hacknet API ' +
      'needs no Source-File at all (RamCostConstants.Hacknet is a flat 0.5GB, not SF4-scaled), so this is the cheapest ' +
      'faction in the game to unlock. Off home because it drives no DOM. It was written for exactly this, documented ' +
      'it in its own header — "it is not trying to build a hacknet, it is buying an invitation" — and was in NEITHER ' +
      'this manifest nor watchdog.js, so it had never once run while the count gate sat nine augmentations short. ' +
      'NO `until`: hacknet nodes are wiped by every install (prestigeAugmentation empties them), so the requirement ' +
      'comes back each life and this has to be admitted at every home size. An earlier `until: 128` retired it on a ' +
      '2PB home and it never ran at all',
  },
  {
    script: 'buyserv.js',
    where: 'anywhere',
    tier: 64,
    rank: 13,
    why: 'the cloud fleet is the growth engine, but it needs money the 8/32 tiers do not have yet. Off home, so it costs the home budget nothing',
  },
  {
    script: 'upkeep.js',
    where: 'home',
    tier: 64,
    rank: 14,
    why: 'reclaims the 25% focus bonus and the 24h export favour. Worth nothing before faction work exists, and faction work needs a backdoor first',
  },
  {
    script: 'autobuy.js',
    where: 'home',
    tier: 32,
    rank: 8,
    why:
      'buys the port programs, and port programs gate ROOTING, which gates the whole fleet. ' +
      'MOVED 64 -> 32 because its price was wrong by 16x in the manifest that justified the tier: the note said ' +
      '"5.85GB inside BitNode 4, 65.85GB at SF4.1 elsewhere", but the Source-File half was extracted into ' +
      'autobuy-sing.js and this file now measures 4.15GB in EVERY regime — it references no ns.singularity at all. ' +
      'The stale figure kept the only program-buyer above a tier it fits inside three times over. ' +
      'Cost, measured in BitNode 5: nine hours at 9 rooted hosts of 70 reachable, TOR bought and ZERO port programs, ' +
      'income $22/s against a $10.08m home upgrade — 124 hours to the first doubling. It needs no Source-File: it ' +
      'queues `buy X.exe` through /cmd/in.txt for cmd.js, which is admitted at this same tier. ' +
      'RANKED AHEAD OF backdoor.js deliberately: port programs gate ROOTING and rooting gates the entire fleet, while ' +
      'backdooring story servers buys faction invitations that matter later. At 32GB only one of the two fits, and ' +
      'getting 61 more hosts rooted is upstream of everything a faction could give us'
  },
  {
    script: 'homeup.js',
    where: 'home',
    kind: 'job',
    tier: 64,
    rank: 24,
    // The only script in the collection that raises home RAM, which makes it
    // the only thing that can move a tier to the next one. See `advances` in
    // the manifest header and [B7.10].
    advances: 'homeRam',
    why: 'watchdog-triggered one-shot. Home RAM and cores are the only purchases that survive an install, so its 4.45GB is budgeted here rather than handed to a daemon that would leave it nowhere to run',
  },

  // -- tier 128: SF9.2 entry, and where the real batcher becomes safe. -----
  {
    script: 'batch.js',
    where: 'home',
    tier: 128,
    rank: 16,
    why: 'the real batcher, and strictly better per GB than early.js on a fleet with contiguous free blocks. Held back below 128GB by invariant B5: it sizes a plan against the fleet TOTAL and then has to place each op on a SINGLE host, so on an opening fleet it reports placeFails forever and earns nothing — 7,274 failures and $0 over 27 minutes, observed. Until batch.js plans against the largest free BLOCK this tier is the guard',
  },
  {
    // Progression itself. Joins factions, works for reputation, buys and
    // installs augmentations — the one loop nothing else in this manifest
    // owns, and the one whose absence is invisible: a run with no faction
    // joined reports perfect health from every other script while the only
    // quantity that cannot be bought earns nothing. That happened for nine
    // hours in BitNode 4 (zero factions, zero augmentations, three unaccepted
    // invitations) precisely because it was in neither this manifest nor
    // watchdog.js's WATCHED list.
    //
    // Cheap to admit at 2.60GB thanks to its declared override, and a `job`
    // rather than a daemon: it acts once and exits, so the watchdog relaunching
    // it on an interval IS the loop. Tier 32 rather than 8 — at a virgin 8GB
    // home every 2GB is a worker thread, and there is no faction to join
    // before anything has been rooted or backdoored.
    script: 'progress.js',
    where: 'home',
    kind: 'job',
    tier: 32,
    rank: 18,
    why: 'the only owner of reputation and augmentations; 2.60GB via its declared override, and a no-op until a faction invitation exists',
  },
  {
    script: 'fast.js',
    where: 'home',
    tier: 64,
    rank: 17,
    why: 'dashboard fast lane at 2.6GB; cheap, and its absence is invisible except as stale numbers',
  },
  {
    // The only script that can end the BitNode. Admitted late and cheaply: it
    // does nothing until The Red Pill is installed, and the watchdog must not
    // watch anything this manifest does not declare (B7.9).
    script: 'endgame.js',
    where: 'home',
    kind: 'job',
    tier: 128,
    rank: 26,
    why: 'roots and destroys w0r1d_d43m0n — the last step, and the only one that leaves the node; a no-op until The Red Pill has been installed',
  },
  {
    // Advisory only: which factions still have augmentations for sale and what
    // requirements are unmet. It is the map progress.js walks, but nothing
    // depends on it to act, so it is admitted last and runs hourly.
    script: 'faction.js',
    where: 'home',
    kind: 'job',
    tier: 128,
    rank: 25,
    why: 'reports unmet faction requirements so the plan is visible; pure analysis, so it yields to anything that earns',
  },
  {
    script: 'nfg.js',
    where: 'home',
    kind: 'job',
    tier: 128,
    rank: 22,
    why: 'watchdog-triggered. Converts money into NeuroFlux levels through donations, which need favour past the donation threshold, which needs an install — so there is nothing for it to do in the first life at any home size',
  },
  {
    script: 'share.js',
    where: 'anywhere',
    tier: 128,
    rank: 19,
    why: 'multiplies faction-work reputation by 1 + ln(threads)/25, and does exactly nothing with no faction joined. watchdog.js carries the invariant that kills it when the last faction is dropped by an install',
  },
  {
    script: 'go.js',
    where: 'home',
    tier: 128,
    rank: 20,
    why: 'IPvGO node power feeds the faction_rep multiplier on every reputation stream, but 20.30GB is eight early.js threads and it needs the external solver running to beat a Daedalus-grade opponent',
  },
  {
    script: 'bootnag.js',
    where: 'home',
    tier: 128,
    rank: 21,
    why: 'the human-TODO report this launcher used to inline. It is 2.60GB of ns.getServer/ns.getPlayer that an 8GB home cannot pay; /tel/boot.txt carries the machine-readable half for free at every tier',
  },

  // -- tier 256. -----------------------------------------------------------
  {
    script: 'ctauto.js',
    where: 'home',
    tier: 256,
    rank: 23,
    why: 'contracts pay ~$25m and, once money stops being the constraint, faction reputation that cannot be bought at any price below 150 favour. But 22.00GB is nine early.js threads and contracts are sparse; it is the last thing in, not the first',
  },
]

const TELEMETRY = '/tel/boot.txt'

/** Every hostname reachable from home. ns.scan only sees neighbours. */
function reach(ns) {
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

/** Free RAM on a host. */
function spare(ns, host) {
  return ns.getServerMaxRam(host) - ns.getServerUsedRam(host)
}

/**
 * Tightest-fitting rooted host other than home, so a big host is left whole for
 * the batcher. Falls back to home only if nothing else has room — an
 * 'anywhere' entry that lands on home is a budget miss, and it is reported.
 */
function placeOff(ns, hosts, need) {
  let best = null
  for (const host of hosts) {
    if (host === 'home' || !ns.hasRootAccess(host)) continue
    const room = spare(ns, host)
    if (room >= need && (!best || room < best.room)) best = { host, room }
  }
  if (best) return best.host
  return spare(ns, 'home') >= need ? 'home' : null
}

export async function main(ns) {
  ns.disableLog('ALL')

  // `run boot.js --dry` plans and reports and starts, stops and roots nothing.
  //
  // This exists for one specific moment: the first boot after this file
  // changes, on a save that is already running a stack the new plan would
  // retire. Idempotence converges on the plan from whatever state the game is
  // in, and "whatever state" includes a machine happily earning under the old
  // list. Read /tel/boot.txt first, then run it for real.
  //
  // ns.args is free; ns.flags would be too, but a single boolean does not need
  // a parser.
  const dry = ns.args.includes('--dry')

  // Root everything NUKE.exe alone can reach, before planning. At a virgin
  // entry home is the only rooted host in the world, so without this there is
  // nowhere to put seed.js and the 100GB of 0-port servers stays invisible.
  // Port-program rooting is seed.js's job; this is only the bootstrap case.
  const hosts = reach(ns)
  let rooted = 0
  for (const host of hosts) {
    if (dry || host === 'home' || ns.hasRootAccess(host)) continue
    try {
      if (ns.nuke(host)) rooted++
    } catch {
      /* needs ports we do not have yet — seed.js will get it later */
    }
  }

  const homeRam = ns.getServerMaxRam('home')
  const costOf = (script) => {
    try {
      return ns.getScriptRam(script, 'home')
    } catch {
      return 0
    }
  }
  // The largest one-shot actor act.js might have to place. Read off the
  // deployed files rather than a constant, so a new act-*.js cannot silently
  // outgrow the slot reserved for it.
  const actionRam = (() => {
    if (!STACK.some((e) => e.script === 'act.js')) return 0
    let max = 0
    for (const f of ns.ls('home', 'act-')) if (f.endsWith('.js')) max = Math.max(max, costOf(f))
    return max
  })()
  const plan = planStack(STACK, { homeRam, costOf, bootRam: costOf('boot.js'), minOps: MIN_OPS, actionRam })

  const started = []
  const stopped = []
  const failed = []
  const wanted = new Set(plan.admit.map((e) => e.script))

  // Publish the plan on every path out of this script, including the ns.spawn
  // at the bottom — which terminates it, so `ns.atExit` is the ONLY hook that
  // fires there. A launcher whose telemetry is written as its last statement
  // would never write anything on the tier where it spawns (invariant C1).
  const note = reporter(ns, TELEMETRY, () => ({
    homeRam,
    tier: plan.tier,
    bootRam: costOf('boot.js'),
    worker: plan.worker,
    reservedForWorkers: plan.reserve,
    actionSlot: plan.action,
    homePlanned: plan.homeUsed,
    dry,
    rooted,
    started,
    stopped,
    failed,
    admit: plan.admit.map((e) => ({ script: e.script, where: e.where, cost: e.cost, threads: e.threads })),
    defer: plan.defer.map((e) => ({ script: e.script, why: e.why })),
  }))
  ns.atExit(() => note.exit('stopped', { detail: 'boot.js exited (spawned its worker, or finished)' }))

  // Retire first, so the RAM a deferred entry is holding is available to the
  // entries that replaced it. seed.js -> batch.js at 128GB is exactly this:
  // both want the whole fleet, and starting the batcher while seed keeps
  // refilling every host with self-threaded workers is the failure watchdog.js
  // records about auto.js.
  //
  // The killing itself is retire.js, because ns.scriptKill is 1.00GB — half a
  // worker thread on an 8GB home, spent on a case that cannot arise there
  // (nothing has ever been started on a virgin entry, so nothing can be stale).
  // It is exec'd only when a deferred entry is genuinely running.
  const stale = []
  for (const entry of plan.defer) {
    if (wanted.has(entry.script) || stale.includes(entry.script)) continue
    for (const host of hosts) {
      if (!ns.hasRootAccess(host)) continue
      if (ns.ps(host).some((proc) => proc.filename === entry.script)) {
        stale.push(entry.script)
        break
      }
    }
  }
  if (stale.length && !dry) {
    const pid = ns.exec('retire.js', 'home', 1, ...stale)
    if (pid) stopped.push(...stale)
    else failed.push(`retire.js: could not start to stop ${stale.join(', ')}`)
  } else if (stale.length) {
    stopped.push(...stale.map((s) => `${s} (DRY RUN — not stopped)`))
  }

  // The home worker is not exec'd — it is SPAWNED, last, after this loop. See
  // the block at the bottom of main() for why that is worth 2.00GB.
  const worker = plan.admit.find((e) => e.role === 'worker')

  // Lazily filled on the first off-home placement and reused for the rest, so a
  // plan that places nothing off home never pays the ns.ls call at all. See the
  // scp below for why the whole collection ships rather than one file.
  let ship = null

  for (const entry of plan.admit) {
    // A job is budgeted, never launched: the watchdog starts it on its trigger,
    // and starting it here would be the relaunch storm that trigger exists to
    // prevent.
    if (entry.kind === 'job') continue
    if (entry.role === 'worker') continue
    try {
      const running = hosts.filter(
        (host) => ns.hasRootAccess(host) && ns.ps(host).some((proc) => proc.filename === entry.script),
      )
      if (running.length) continue

      const threads = entry.threads || 1
      // PLACE AGAINST THE RAISED COST, not the declared one.
      //
      // A script with ns.ramOverride declares a floor and raises to its full
      // price at runtime once a capability check passes. `entry.cost` is that
      // FLOOR, so placing by it puts the script on a host that cannot afford
      // what it is about to ask for — and a denied raise returns the old
      // allocation silently (NetscriptFunctions.ts:1210-1214), so the script
      // returns and the failure is invisible.
      //
      // Live on 2026-09-22: sleeve.js declares 2.60GB and raises to 41.75GB.
      // placeOff picked foodnstuff, the tightest 16GB fit for 2.60GB. The
      // raise failed, sleeve.js exited four seconds after boot started it, and
      // the run sat in BitNode 10 — entered specifically FOR sleeves — with no
      // sleeve driver at all. Nothing noticed, because the only record of the
      // exit was written to foodnstuff.
      const need = Math.max(entry.cost, entry.raisesTo ?? 0) * threads
      const host = entry.where === 'home' ? (spare(ns, 'home') >= need ? 'home' : null) : placeOff(ns, hosts, need)
      if (!host) {
        failed.push(`${entry.script}: planned ${need}GB but no host had it free`)
        continue
      }
      if (dry) {
        started.push(`${entry.script} on ${host}${threads > 1 ? ` x${threads}` : ''} (DRY RUN — not started)`)
        continue
      }
      // SHIP THE IMPORT GRAPH, not just the entry file.
      //
      // Netscript compiles a script on the host it runs on, so every module it
      // imports has to be THERE. Copying `entry.script` alone therefore places
      // scripts that cannot start, and ns.exec answers that with a bare false —
      // which this loop reports as "exec refused", a message that reads like
      // "no RAM" and is not.
      //
      // Live, on the BitNode 1 entry: `seed.js: exec refused on foodnstuff`
      // (6.40GB onto a 16GB server — RAM was never the problem; it imports
      // status.js) and the same for tel.js, share.js and buyserv.js. Every
      // off-home entry in the manifest has been failing this way, silently,
      // for as long as it has had imports.
      //
      // It matters far more now than it did: the bottom rung of the tier ladder
      // is an off-home placement (homeup.js, which imports lock.js, homecost.js
      // and status.js), so a virgin 8GB entry would have had a manifest and a
      // green [B7.10] both promising an advancer that could never start.
      //
      // `ns.ls` is 0.20GB and the whole collection is a few hundred KB; files
      // cost the target nothing until they RUN. A hand-maintained per-entry
      // dependency list would be cheaper and would go stale, which this repo
      // has already paid for once — a transcribed list is a fork.
      if (host !== 'home') ns.scp(ship ?? (ship = ns.ls('home', '.js')), host, 'home')
      const pid = ns.exec(entry.script, host, threads, ...(entry.args || []))
      if (pid) started.push(`${entry.script} on ${host}${threads > 1 ? ` x${threads}` : ''}`)
      else failed.push(`${entry.script}: exec refused on ${host}`)
    } catch (err) {
      failed.push(`${entry.script}: ${describe(err)}`)
    }
  }

  note(failed.length ? 'degraded' : 'ok', {
    result: failed.length ? 'partial' : 'ok',
    detail: `tier ${plan.tier}: started ${started.length}, retired ${stopped.length}, deferred ${plan.defer.length}`,
  })

  ns.tprint(`boot: home ${homeRam}GB, tier ${plan.tier}, worker ${plan.worker || 'batch.js places its own'}`)
  if (rooted) ns.tprint(`boot: rooted ${rooted} host(s) with NUKE.exe`)
  if (started.length) ns.tprint(`boot: started ${started.join(', ')}`)
  if (stopped.length) ns.tprint(`boot: retired ${stopped.join(', ')}`)
  if (failed.length) ns.tprint(`boot: FAILED ${failed.join(' | ')}`)
  if (plan.defer.length) {
    ns.tprint(`boot: ${plan.defer.length} entries deferred — see ${TELEMETRY} for each reason`)
  }
  // The human-facing half of the old report lives in bootnag.js now, because it
  // costs 4.35GB of ns.getServer/ns.getPlayer. It is in the manifest at 128GB
  // and is launched like anything else, so it needs no special case here.

  // ---------------------------------------------------------------------
  // LAST ACT: hand home's remaining RAM to the worker, and get out of the way.
  //
  // ns.spawn kills the calling script and THEN starts the new one
  // (NetscriptFunctions.ts:644-650: killWorkerScript, then spawnCb immediately
  // when spawnDelay is 0), so the worker is launched into a home that no longer
  // contains this launcher. That is worth the 2.00GB ns.spawn costs, and the
  // 8GB tier is the whole argument:
  //
  //   ns.exec  launcher 4.20GB resident -> 3.80GB free -> 1 worker thread
  //   ns.spawn launcher 6.20GB, then gone -> 8.00GB free -> 4 worker threads
  //
  // Four is one complete HGW batch. One is a quarter of one. A more expensive
  // launcher that leaves is strictly better than a cheaper one that stays.
  //
  // Nothing may follow this line: the script is dead the moment it runs.
  // The thread count is MEASURED, not taken from the plan. The plan is an upper
  // bound computed from steady-state costs; at this instant a one-shot
  // (settings.js) may still be finishing, and anything already running takes
  // its share too. `spare + this script's own RAM` is what home will have the
  // moment the spawn kills us. Over-asking makes runScriptFromScript fail and
  // the worker never starts at all, which is the one outcome worse than
  // starting too few threads — seed.js's next pass tops home up either way.
  if (worker && worker.threads > 0) {
    const already = hosts.some(
      (host) => ns.hasRootAccess(host) && ns.ps(host).some((proc) => proc.filename === worker.script),
    )
    const room = spare(ns, 'home') + costOf('boot.js')
    const threads = Math.min(worker.threads, Math.floor(room / worker.cost))
    if (dry) {
      ns.tprint(`boot: DRY RUN — would spawn ${worker.script} x${threads} on home (plan said x${worker.threads})`)
      return
    }
    if (!already && threads > 0) {
      ns.tprint(`boot: spawning ${worker.script} x${threads} on home and exiting`)
      ns.spawn(worker.script, { threads, spawnDelay: 0 }, ...(worker.args || []))
    }
  }
}
