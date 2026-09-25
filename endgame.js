// Leaves the BitNode. Roots w0r1d_d43m0n, and destroys it when the level allows.
//
//   run endgame.js               act when possible, report the gap otherwise
//   run endgame.js --dry         decide and report, destroy nothing
//   run endgame.js --next 5      which BitNode to enter afterwards
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// Nothing in the stack owned the last step. backdoor.js works from
// storyservers.js, which is exactly five entries ending at fulcrumassets —
// those are the FACTION servers, and they are all it was ever meant to cover.
// `w0r1d_d43m0n` appeared in no WATCHED script at all, and nothing called
// ns.singularity.destroyW0r1dD43m0n. The run could earn money forever, buy
// augmentations, install them, grow the fleet and farm reputation, and would
// still never leave BitNode 4. Every part of the economy was autonomous and the
// one irreversible step at the end was not.
//
// ---------------------------------------------------------------------------
// WHAT THE GAME ACTUALLY REQUIRES
//
// destroyW0r1dD43m0n itself (Singularity.ts:1124-1172) asks for only:
//
//   Player.skills.hacking >= wd.requiredHackingSkill   AND   wd.hasAdminRights
//
// A backdoor is NOT among them — the call sets wd.backdoorInstalled itself. What
// it needs is ROOT, i.e. NUKE.exe and all five port openers.
//
// THE RED PILL IS STILL REQUIRED, though not by that check, and this is the part
// that is easy to get wrong — I did, and the live run corrected me. The world
// daemon starts with an EMPTY serversOnNetwork, and
// NetscriptHelpers.tsx:557-569 rejects any host with no network links:
//
//     Invalid host: 'w0r1d_d43m0n'
//
// so ns cannot even name the server, let alone nuke it. The link is created in
// Prestige.ts:174-181, on a PRESTIGE, and only when The Red Pill is already
// INSTALLED (`hasAugmentation(TheRedPill, true)` — installed, not merely
// queued). So the true order is:
//
//   1. join Daedalus            30 augs installed, $100b, hacking 2500
//   2. 2.5m Daedalus reputation
//   3. buy The Red Pill         costs $0; progress.js buys it without special-casing
//   4. INSTALL it               the prestige is what links the daemon into the network
//   5. reach hacking 9000       3000 x WorldDaemonDifficulty in this node
//   6. nuke it, then destroy it
//
// Step 4 is the subtle one: buying The Red Pill changes nothing on its own, and
// the server stays invisible until the next install. Until then, "not
// addressable" is the NORMAL state here and is reported as waiting, not as an
// error.
//
// `requiredHackingSkill` for w0r1d_d43m0n is 3000 in the server data, scaled at
// BitNode entry by currentNodeMults.WorldDaemonDifficulty (ServerHelpers.ts:423)
// — 3 in BitNode 4, so 9000 here. It is read from the live server rather than
// assumed, because that multiplier differs per node and hardcoding 9000 would be
// wrong in every other one.
//
// ---------------------------------------------------------------------------
// RAMOVERRIDE 3.2GB — excludes: ns.singularity.destroyW0r1dD43m0n (32GB at base
// price, 512GB at the 16x SF4.1 rate), which is the only Singularity call in
// this file.
//
// Why this is sound: Netscript bills a script for every ns identifier in its
// import graph whether or not the call is reachable (RamCalculations.ts:407),
// but only CALLING a Source-File-gated function throws. So this file may carry
// the reference, declare 3.2GB, do the whole rooting-and-reporting path at that
// allocation, and raise to the full price only on the one branch that destroys
// the daemon.
//
// 3.2 = RamCostConstants.Base (1.6) + getResetInfo (1.0) + the cheap server and
// program calls. Measured, not derived: tools/test/ram.mjs prices this file
// with every ns.singularity reference removed at exactly 3.20GB in every
// regime, and the full file at 35.20GB in BN4 / 515.20GB at SF4.1.
//
// A raise the host cannot afford is SILENTLY DENIED (NetscriptFunctions.ts:
// 1210-1214 returns the old allocation), which is why it goes through
// ramgrow.js and why this file returns rather than continuing.
//
// Registered in tools/sim/bncheck.mjs STRUCTURAL. Asserted by
// tools/test/ramoverride.test.mjs [R1..R5].
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT A DAEMON, AND WHY IT NEVER FIRES BY ACCIDENT
//
// Destroying the world daemon is the single most irreversible action available:
// it ends the BitNode and starts another. It runs as a JOB on a long interval,
// it publishes the gap on every pass, and it requires --next to be given before
// it will actually act. Without --next it does the safe, useful half — rooting
// the server — and reports the level gap. That asymmetry is deliberate: rooting
// early is free and must not wait for a human, while leaving the node should be
// a decision someone made on purpose.

import { canUseSingularity, singularityRamMultiplier, sfLevel } from 'sfgate.js'
import { COVENANT_MANDATE, covenantMandated, sleevesFromCovenant } from 'sleeveplan.js'
import { reporter } from 'status.js'
import { raiseRam } from 'ramgrow.js'

/**
 * Full static price as a function of the Singularity RAM multiplier, MEASURED
 * with the game's own calculator against this file with its override stripped:
 * 35.20GB in BN4 (mult 1) and 515.20GB at SF4.1 outside BN4 (mult 16), i.e.
 * 3.20 + 32.0*mult. Asserted every run by tools/test/ramoverride.test.mjs [R5].
 */
const RAISE_CEILING = (mult) => 3.2 + 32.0 * mult

const STATUS = '/tel/endgame.txt'
const WD = 'w0r1d_d43m0n'
const RED_PILL = 'The Red Pill' // Augmentation/Enums.ts

export async function main(ns) {
  // 3.2GB — every non-Singularity call in this file, which is the whole of the
  // rooting and reporting path. Declared rather than paid because the file's
  // FULL price is 515.20GB at SF4.1 outside BitNode 4, where ns.singularity is
  // billed at 16x: [B2.5] caught that such a script cannot start at a 128GB
  // BitNode entry at all, and the watchdog would then retry it every 30s
  // forever, logging "no host with room" as though the fleet were the problem.
  //
  // MUST be the first statement of `main`, as a numeric literal — every other
  // shape is silently ignored (RamCalculations.ts:352-395). See
  // tools/test/ramoverride.test.mjs for the thirteen ways this goes wrong.
  ns.ramOverride(3.2)

  const flags = ns.flags([
    ['next', 0],
    ['dry', false],
    // The Covenant mandate (below) is waived only by saying so.
    ['waive-covenant', false],
  ])
  ns.disableLog('ALL')

  const note = reporter(ns, STATUS, {})
  let published = false
  ns.atExit(() => {
    if (!published) note.exit('stopped', { detail: 'endgame.js exited before publishing — killed or threw' })
  }, 'status')

  const level = ns.getHackingLevel()

  // Resolving the hostname is itself the first gate — see the header. It throws
  // until The Red Pill has been installed and a prestige has linked the daemon
  // into the network.
  let need = null
  let rooted = false
  try {
    need = ns.getServerRequiredHackingLevel(WD)
    rooted = ns.hasRootAccess(WD)
  } catch (e) {
    // EXPECTED for most of a run: the daemon has no network links until The Red
    // Pill has been installed, and ns refuses to resolve a host with none
    // (NetscriptHelpers.tsx:557-569). That is a position on the path, not a
    // fault, so it publishes as `waiting` with the reason — while still
    // carrying the exception text, so a DIFFERENT failure here cannot hide
    // behind the expected one.
    const reset0 = ns.getResetInfo()
    const hasTRP = !!reset0?.ownedAugs?.has(RED_PILL)
    note('ok', {
      at: new Date().toISOString(),
      bitNode: reset0?.currentNode,
      server: WD,
      hackingLevel: level,
      redPillInstalled: hasTRP,
      result: 'waiting',
      stage: hasTRP ? 'red-pill-installed-but-daemon-still-unlinked' : 'need-the-red-pill',
      detail: hasTRP
        ? `${WD} is still unlinked despite The Red Pill being installed — unexpected, the link is made at prestige (Prestige.ts:174-181). Raw error: ${e}`
        : `${WD} is not on the network yet: The Red Pill must be bought from Daedalus AND installed before the link exists. Raw error: ${e}`,
    })
    published = true
    return
  }

  // --- 1. root it, always, whether or not we are near the level -------------
  //
  // Free and reversible, and it is a prerequisite that can be satisfied long
  // before the level is. Doing it early means the only remaining gap is a
  // number we can watch.
  const openers = [
    ['BruteSSH.exe', ns.brutessh],
    ['FTPCrack.exe', ns.ftpcrack],
    ['relaySMTP.exe', ns.relaysmtp],
    ['HTTPWorm.exe', ns.httpworm],
    ['SQLInject.exe', ns.sqlinject],
  ]
  const missing = openers.filter(([f]) => !ns.fileExists(f, 'home')).map(([f]) => f)
  if (!rooted) {
    for (const [file, fn] of openers) {
      if (!ns.fileExists(file, 'home')) continue
      try {
        fn(WD)
      } catch {
        /* already open */
      }
    }
    try {
      ns.nuke(WD)
      rooted = ns.hasRootAccess(WD)
      if (rooted) ns.tprint(`endgame: rooted ${WD}`)
    } catch {
      /* not enough ports open yet — reported below, not thrown */
    }
  }

  // --- 2. the gap ----------------------------------------------------------
  const ready = rooted && level >= need
  const reset = ns.getResetInfo()
  const canAct = canUseSingularity(reset)

  const report = {
    at: new Date().toISOString(),
    bitNode: reset?.currentNode,
    server: WD,
    hackingLevel: level,
    hackingNeeded: need,
    // The honest shape of the remaining work. Level is linear in the hacking
    // MULTIPLIER and logarithmic in experience (skill.ts:13), so this ratio is
    // roughly the multiplier still to be acquired — not a grind to be waited
    // out. See installgate.js for the derivation.
    multiplierShortfall: need > 0 && level > 0 ? +(need / level).toFixed(2) : null,
    rooted,
    missingPortOpeners: missing,
    ready,
    canAct,
    next: flags.next || null,
  }

  if (!ready) {
    report.result = 'waiting'
    report.detail = !rooted
      ? `not rooted — ${missing.length ? `missing ${missing.join(', ')}` : 'ports open but nuke failed'}`
      : `hacking ${level} of ${need} needed (about ${(need / level).toFixed(1)}x more multiplier)`
    note('ok', report)
    published = true
    return
  }

  // --- 3. leave ------------------------------------------------------------
  if (!canAct) {
    report.result = 'blocked'
    report.detail = 'requirements met but Singularity is unavailable — connect to w0r1d_d43m0n and backdoor it manually'
    note('ok', report)
    published = true
    ns.tprint(`endgame: READY — ${report.detail}`)
    return
  }

  // THE COVENANT MANDATE (sleeveplan.COVENANT_MANDATE, the user's decision
  // 2026-09-24): do not leave BitNode 10 until the mandated Covenant sleeves
  // are bought — this node is the only place they can be. A precondition
  // only: it refuses, it never acts. The count comes from sleeve.js's
  // telemetry (0GB); unreadable or stale refuses too, because leaving on an
  // unknown is irreversible. --waive-covenant overrides, explicitly.
  // THE DESTINATION HOLD: /endgame-hold.txt on home (any content, the reason)
  // stops the exit until it is deleted. Leaving is irreversible and the
  // watchdog's --next is fixed in code, so a pending choice of the next node
  // must be able to stop it without a watchdog restart (2026-09-25: the user
  // was choosing a node while --next 10 was minutes from firing).
  const hold = ns.read('/endgame-hold.txt')
  if (hold) {
    report.result = 'held'
    report.detail = `ready, but /endgame-hold.txt holds the exit: ${hold.slice(0, 200)}`
    note('ok', report)
    published = true
    ns.tprint(`endgame: ${report.detail}`)
    return
  }

  if (reset?.currentNode === COVENANT_MANDATE.node && !flags['waive-covenant']) {
    let fleet = null
    try {
      fleet = JSON.parse(ns.read('/tel/sleeve.txt') || 'null')
    } catch {
      fleet = null
    }
    const fresh = fleet && fleet.bitNode === reset.currentNode && Date.now() - Date.parse(fleet.at) < 15 * 60e3 && Number.isInteger(fleet.sleeves)
    const from = fresh ? sleevesFromCovenant(fleet.sleeves, sfLevel(reset, 10), reset.currentNode) : null
    if (from === null || covenantMandated(reset.currentNode, from)) {
      report.result = 'held'
      report.detail =
        from === null
          ? `ready, but the Covenant sleeve count is unreadable (sleeve.txt ${fleet ? 'stale or foreign' : 'missing'}) — not leaving BitNode ${reset.currentNode} on an unknown (mandate ${COVENANT_MANDATE.decided}; --waive-covenant to override)`
          : `ready, but only ${from} of the ${COVENANT_MANDATE.target} mandated Covenant sleeves are bought — BitNode ${reset.currentNode} is the only place to buy them (mandate ${COVENANT_MANDATE.decided}; --waive-covenant to override)`
      note('ok', report)
      published = true
      ns.tprint(`endgame: ${report.detail}`)
      return
    }
  }

  if (!flags.next || flags.dry) {
    // Deliberate stop. Everything is in place and the last step waits for an
    // explicit choice of destination, because it cannot be undone.
    report.result = 'ready'
    report.detail = `ready to leave BitNode ${reset?.currentNode}: rooted and at level ${level}/${need}. Re-run with --next <bitNode> to destroy the world daemon.`
    note('ok', report)
    published = true
    ns.tprint(`endgame: ${report.detail}`)
    return
  }

  // Raise to the full price before the only Singularity call in the file. A
  // denied raise returns the OLD allocation silently (NetscriptFunctions.ts:
  // 1210-1214), so this goes through ramgrow.js, which checks and reports —
  // and returns rather than calling into a budget we do not hold.
  const want = RAISE_CEILING(singularityRamMultiplier(reset))
  if (!(await raiseRam(ns, want, STATUS, 'endgame.js destroying the world daemon'))) {
    report.result = 'blocked'
    report.detail = `requirements met but could not raise to ${want.toFixed(2)}GB to call destroyW0r1dD43m0n`
    note('ok', report)
    published = true
    return
  }

  report.result = 'destroying'
  note('ok', report)
  published = true
  ns.tprint(`endgame: destroying ${WD}, entering BitNode ${flags.next}`)
  // boot.js is handed in as the callback so the next node comes up with the
  // stack running, the same contract progress.js uses for installs.
  ns.singularity.destroyW0r1dD43m0n(flags.next, 'boot.js')
}
