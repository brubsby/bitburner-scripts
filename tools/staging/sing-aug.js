// The augmentation cycle: survey, price, plan, buy, and — when told to —
// spend home to zero and install.
//
//   run sing-aug.js                          survey + buy, no install
//   run sing-aug.js --dry                    publish the plan, buy nothing
//   run sing-aug.js --reserve 1e12           keep $1t back
//   run sing-aug.js --install --confirm      ...then install and relaunch boot.js
//
// 3.1GB. Everything expensive happens in a child process, so this can sit in
// the 32GB home next to batch.js without competing with it.
//
// ---------------------------------------------------------------------------
// Why a director at all.
//
// Netscript prices every ns function named anywhere in a script's import graph,
// reachable or not, so the obvious single script would reference
// getOwnedAugmentations (5) + getAugmentationsFromFaction (5) +
// getAugmentationPrice (2.5) + getAugmentationRepReq (2.5) + getFactionRep (1) +
// purchaseAugmentation (5) + installAugmentations (5) + upgradeHomeRam (3) +
// upgradeHomeCores (3) + getUpgradeHomeCoresCost (1.5) + getPlayer (0.5) +
// small reads + the 1.6 base = **over 35GB**, on a 32GB home that must keep
// batch.js (11.2GB) running. So the job is split along the lines of which calls
// have to be atomic with each other, and this runs the pieces in order:
//
//   sing-augsurvey.js  12.1GB   who sells what, what we own, what is queued
//   sing-augbuy.js     12.7GB   price + plan + purchase, one process
//   sing-install.js    14.45GB  spend home to zero, install, relaunch
//
// Peak resident is this (3.1) plus the largest child (14.45) = 17.55GB.
//
// ---------------------------------------------------------------------------
// Why it loops.
//
// A few augmentations have prerequisites (Augmentations.ts: the Bladeburner,
// combat-rib, cranial-processor and Stanek chains). sing-augbuy.js deliberately
// does not pay 5GB for getAugmentationPrereq; it lets purchaseAugmentation
// refuse, which is free and authoritative. `Player.hasAugmentation` counts
// QUEUED augmentations as well as installed ones (Person.ts:232-240), so once a
// prerequisite has been queued in one round its dependent becomes purchasable —
// and re-running the survey is how it gets noticed. One round per link in a
// chain, and a round that buys nothing ends the loop.
//
// Re-surveying also re-prices, which is not merely tidy: every purchase moves
// the 1.9^queued multiplier, so a second round is looking at a genuinely
// different game.
// ---------------------------------------------------------------------------

import { reporter, describe, record } from 'status.js'

const STATUS = '/tel/sing-aug.txt'
const SURVEY_STATUS = '/tel/sing-augsurvey.txt'
const BUY_STATUS = '/tel/sing-augbuy.txt'

export async function main(ns) {
  const flags = ns.flags([
    ['dry', false],
    ['install', false],
    ['confirm', false],
    ['reserve', 0],
    ['max-nfg', 100],
    ['exclude', ''],
    ['order', 'best'],
    ['boot', '/boot.js'],
    // Enough for the longest prerequisite chain in the game plus a round that
    // finds nothing. Bounded because a child that keeps reporting purchases it
    // did not make would otherwise spin forever.
    ['rounds', 5],
    // Where to exec the children. They are Singularity calls, which work from
    // any server, so a rooted host with spare RAM is a legitimate place to put
    // 14GB — provided the files are there. Default home, which is the only host
    // guaranteed to have them.
    ['host', 'home'],
    // Ceiling on how long one child may take before we give up on it.
    ['timeout', 180000],
  ])
  ns.disableLog('ALL')

  const errors = []
  const log = []
  const cycleId = String(Date.now())
  let totalBought = 0

  const note = reporter(ns, STATUS, () => ({
    cycle: cycleId,
    log: log.slice(-20),
    bought: totalBought,
    errors: errors.slice(-5),
  }))
  let settled = false
  ns.atExit(() => {
    if (!settled) {
      note.exit('stopped', {
        result: 'stopped',
        detail: `sing-aug.js exited without reporting — ${totalBought} augmentation(s) queued so far`,
      })
    }
  })

  /**
   * Run a child to completion.
   *
   * ns.exec returns 0 when the script cannot start, and by far the most common
   * reason is RAM. Saying which script and how much it wanted turns "nothing
   * happened" into something actionable — five scripts wrote nothing on error
   * for most of BitNode 1 and it cost hours of debugging.
   */
  const launch = async (file, args) => {
    const pid = ns.exec(file, flags.host, 1, ...args)
    if (pid === 0) {
      const need = ns.getScriptRam(file, flags.host)
      log.push(`exec ${file} failed — needs ${need || '?'}GB on ${flags.host}`)
      return false
    }
    for (let waited = 0; waited < flags.timeout; waited += 200) {
      if (!ns.isRunning(pid)) return true
      await ns.sleep(200)
    }
    log.push(`${file} still running after ${flags.timeout}ms — giving up on this round`)
    return false
  }

  /** Read a child's status file; never throws, so a bad read is reportable. */
  const readStatus = (file) => {
    try {
      const raw = ns.read(file)
      return raw ? JSON.parse(raw) : null
    } catch (err) {
      log.push(`could not parse ${file}: ${describe(err)}`)
      return null
    }
  }

  try {
    for (let round = 1; round <= flags.rounds; round++) {
      if (!(await launch('sing-augsurvey.js', ['--cycle', cycleId]))) break

      const survey = readStatus(SURVEY_STATUS)
      if (!survey || survey.health !== 'ok' || survey.cycle !== cycleId) {
        log.push(`round ${round}: survey unusable (${survey ? survey.health : 'no file'})`)
        break
      }
      log.push(`round ${round}: ${survey.detail}`)

      const args = ['--cycle', cycleId, '--reserve', flags.reserve, '--max-nfg', flags['max-nfg'], '--order', flags.order]
      if (flags.exclude) args.push('--exclude', flags.exclude)
      if (flags.dry) args.push('--dry')
      if (!(await launch('sing-augbuy.js', args))) break

      const buy = readStatus(BUY_STATUS)
      if (!buy || buy.cycle !== cycleId) {
        log.push(`round ${round}: buy phase produced no usable report`)
        break
      }
      log.push(`round ${round}: ${buy.detail}`)
      if (buy.health === 'error') break

      const n = (buy.bought || []).length
      totalBought += n
      // Nothing bought means nothing changed, so another survey would return
      // the same answer. This is the normal exit.
      if (n === 0 || flags.dry) break
    }

    if (!flags.install) {
      settled = true
      note(totalBought ? 'ok' : 'waiting', {
        result: totalBought ? 'ok' : 'waiting',
        detail: `${totalBought} augmentation(s) queued${flags.dry ? ' (dry run)' : ''}; not installing (no --install)`,
      })
      return
    }

    // ---- install ----------------------------------------------------------
    //
    // Both flags, deliberately. --install says what to do and --confirm says a
    // human or a director meant it; sing-install.js enforces --confirm again on
    // its own side, because it is the file that actually does the irreversible
    // thing and it should not depend on its caller having been careful.
    //
    // From here the game is about to kill every script, including this one.
    // Everything worth saying is said BEFORE the call.
    if (!flags.confirm) {
      settled = true
      note('waiting', { result: 'refused', detail: '--install needs --confirm as well; installing is irreversible' })
      return
    }

    settled = true
    note('ok', {
      result: 'installing',
      detail: `handing over to sing-install.js: spend home to zero, install, relaunch ${flags.boot}`,
    })
    // Not awaited to completion in the usual sense — on success sing-install.js
    // never exits, because the prestige kills it and us. If it DOES return, it
    // refused, and the next line publishes that.
    await launch('sing-install.js', ['--confirm', '--boot', flags.boot])
    note('waiting', {
      result: 'waiting',
      detail: 'sing-install.js returned without installing — read /tel/sing-install.txt',
    })
  } catch (err) {
    settled = true
    try {
      ns.print(`sing-aug error: ${record(errors, err)}`)
      note('error', { result: 'error', detail: describe(err) })
    } catch {
      /* nothing left to try */
    }
  }
}
