// Phase 3: spend every last dollar on home, then install — and come back up.
//
//   run sing-install.js --confirm                 spend home to zero, install,
//                                                 relaunch /boot.js afterwards
//   run sing-install.js --dry                     do the spend-down only, report
//   run sing-install.js --confirm --boot /x.js    a different startup script
//
// `--confirm` is mandatory. This is the only irreversible action in normal
// play; cmd.js refuses `softreset`/`b1tflum3`/`wd` for the same reason, and for
// the same reason this is not a security boundary — it is a guard against a
// typo in a queued batch costing hours.
//
// ---------------------------------------------------------------------------
// The install procedure, in order, from CLAUDE.md — this file IS steps 2, 4
// and 5.
//
// 2. **Spend every remaining dollar on home RAM and cores. Not optional.**
//    prestigeHomeComputer (Server/ServerHelpers.ts:226-239) sets programs to
//    empty, serversOnNetwork to [] and ramUsed to 0, and touches **neither
//    maxRam nor cpuCores** — so home RAM and cores are permanent for the whole
//    BitNode, while money resets to $1262 plus each owned aug's startingMoney. Every dollar held at install is
//    destroyed. We once installed holding **$2.07 QUADRILLION** with home at
//    16.38TB and one core. buyserv.js had been diligently spending the surplus
//    on *cloud* servers, which the install also destroys — the right sink was
//    home the whole time.
//
//    This does the spend-down ITSELF rather than exec'ing sing-shop.js with
//    --reserve 0. Two reasons, and the first is the important one: spending and
//    installing must not be separable. An exec'd child can fail to start for
//    want of RAM, be killed by the watchdog, or simply still be running when
//    the parent decides it has waited long enough — and every one of those ends
//    with the install firing on a full bank account. Second, 14.45GB here beats
//    8.6GB + 14.3GB of two scripts resident at once on a 32GB home.
//
// 4. **Install, and pass a startup script.** The autoexec does NOT fire after a
//    prestige: NetscriptWorker.ts:246-251 skips any server whose `savedScripts`
//    is absent, and an install kills every script, so home has none and the
//    autoexec entry is never created. It fires on an ordinary page reload and
//    not on the one case that matters. `singularity.installAugmentations
//    (cbScript)` closes that: Singularity.ts:196-211 schedules
//    `setTimeout(() => runAfterReset(cbScript), 500)` — on the browser event
//    loop, OUTSIDE the script, so it survives the prestige that kills us — and
//    runAfterReset (Singularity.ts:59-76) starts it on home with no arguments
//    and one thread. This is the step that makes the loop closed instead of
//    needing a human to type `run boot.js`.
//
// 5. **Expect TOR to be gone.** serversOnNetwork = [] breaks the darkweb link,
//    so hasTorRouter() goes false and sing-shop.js must re-buy it. boot.js is
//    what launches it.
//
// ---------------------------------------------------------------------------
// Two ways the restart silently does not happen, both guarded before we spend.
//
// runAfterReset returns quietly if `home.scripts.get(cbScript)` misses, and
// prints a Terminal error (which no script reads) if the script does not fit in
// `home.maxRam - home.ramUsed`. Both leave a game with no scripts running and
// no record of why. So: check the file exists on home, and check its RAM
// against home's maxRam, BEFORE the point of no return. ramUsed is 0 by then —
// prestigeHomeComputer sets it (ServerHelpers.ts:231) and runs synchronously
// inside installAugmentations, 500ms before the callback — so maxRam alone is
// the right comparison.
// ---------------------------------------------------------------------------

import { reporter, describe, record } from 'status.js'
import { MAX_HOME_RAM, MAX_HOME_CORES, ramUpgradeCost, coreUpgradeCost } from 'homecost.js'

const STATUS = '/tel/sing-install.txt'

/** See sing-shop.js: 1e9 * 7.5^cores, PlayerObjectServerMethods.ts:42. */
const coresFromCost = (cost) => Math.round(Math.log(cost / 1e9) / Math.log(7.5))

export async function main(ns) {
  const flags = ns.flags([
    ['confirm', false],
    ['dry', false],
    // Absolute, so it resolves the same wherever this file happens to live:
    // resolveScriptFilePath strips a leading '/' and treats the rest as a path
    // from the root (FilePath.ts:61-66), while a bare name is resolved against
    // the CALLING script's directory (Singularity.ts:198-200).
    ['boot', '/boot.js'],
    ['max', 80],
  ])
  ns.disableLog('ALL')

  const errors = []
  const bought = []
  const notes = []
  const note = reporter(ns, STATUS, () => ({ bought, notes: notes.slice(-16), errors: errors.slice(-5) }))

  // This one is not decoration. On a successful install every script on every
  // server is killed by prestigeWorkerScripts (AugmentationHelpers.ts:107),
  // which runs atExit callbacks before tearing the worker down
  // (killWorkerScript.ts:56-84) — so this is the ONLY thing that can record
  // that the install actually fired. ns.write is 0GB and still works there, and
  // prestigeHomeComputer clears programs, messages and the network, not text
  // files, so /tel/sing-install.txt survives into the next life.
  let settled = false
  ns.atExit(() => {
    if (!settled) note.exit('stopped', { detail: 'sing-install.js exited without reporting' })
  })

  try {
    const sing = ns.singularity
    const money = () => ns.getServerMoneyAvailable('home')

    if (!flags.confirm && !flags.dry) {
      settled = true
      note('waiting', { result: 'refused', detail: 'sing-install.js needs --confirm (or --dry). Installing is irreversible.' })
      return
    }

    // ---- guard the restart BEFORE the point of no return -------------------
    const boot = flags.boot
    if (!ns.fileExists(boot, 'home')) {
      settled = true
      note('error', {
        result: 'error',
        detail: `${boot} is not on home — installing now would leave the game with nothing running and no way to notice. Refusing.`,
      })
      return
    }
    // getScriptRam returns the single-thread cost, which is what runAfterReset
    // launches with (Singularity.ts:73-75: no args, 1 thread).
    const bootRam = ns.getScriptRam(boot, 'home')
    const homeRam = ns.getServerMaxRam('home')
    if (!(bootRam > 0)) {
      settled = true
      note('error', { result: 'error', detail: `could not compute RAM for ${boot} (does it compile?) — refusing to install` })
      return
    }
    if (bootRam > homeRam) {
      settled = true
      note('error', {
        result: 'error',
        detail: `${boot} needs ${bootRam}GB and home has ${homeRam}GB — runAfterReset would print a Terminal error nothing reads. Refusing.`,
      })
      return
    }
    notes.push(`restart guard ok: ${boot} is ${bootRam}GB, home has ${homeRam}GB`)

    // ---- spend it all on home ---------------------------------------------
    //
    // Cheapest-of-the-two each step (homecost.js), which is what makes the
    // dollars go furthest: cores are far cheaper per step early and cap at 8,
    // RAM doublings escalate by 1.58x forever.
    const startMoney = money()
    for (let step = 0; step < flags.max; step++) {
      const ram = ns.getServerMaxRam('home')
      const coreCost = sing.getUpgradeHomeCoresCost()
      const cores = coresFromCost(coreCost)

      // Same free calibration as sing-shop.js, and it matters more here: this
      // is the run that must leave $0 behind, so a cost model that is wrong
      // leaves money on the table permanently.
      const drift = coreCost > 0 ? Math.abs(coreUpgradeCost(cores) - coreCost) / coreCost : 0
      if (step === 0) notes.push(`homecost.coreUpgradeCost drift vs game: ${(drift * 100).toFixed(4)}%`)

      const options = []
      if (cores < MAX_HOME_CORES) options.push({ kind: 'cores', cost: coreCost })
      if (ram < MAX_HOME_RAM) options.push({ kind: 'RAM', cost: ramUpgradeCost(ram) })
      if (!options.length) {
        notes.push(`home is fully upgraded (${ram}GB / ${cores} cores)`)
        break
      }
      const pick = options.reduce((a, b) => (b.cost < a.cost ? b : a))
      if (money() < pick.cost) {
        notes.push(`cannot afford the next ${pick.kind} at $${Math.round(pick.cost)} (have $${Math.round(money())})`)
        break
      }
      if (flags.dry) {
        notes.push(`would buy ${pick.kind} for $${Math.round(pick.cost)} (now ${ram}GB / ${cores} cores)`)
        break
      }
      if (!(pick.kind === 'cores' ? sing.upgradeHomeCores() : sing.upgradeHomeRam())) {
        notes.push(`${pick.kind} upgrade refused at $${Math.round(pick.cost)}`)
        break
      }
      bought.push(`${pick.kind} $${Math.round(pick.cost)}`)
      await ns.sleep(0)
    }

    // The drain. The loop above trusts homecost.js's arithmetic; this one
    // trusts nothing and simply asks the game to sell us something until it
    // refuses both. If the cost model is ever wrong in the cheap direction,
    // this is what stops a dollar surviving to be destroyed — and if it is
    // right, this costs two calls that both return false.
    if (!flags.dry) {
      for (let step = 0; step < flags.max; step++) {
        if (sing.upgradeHomeCores()) {
          bought.push('cores (drain)')
          continue
        }
        if (sing.upgradeHomeRam()) {
          bought.push('RAM (drain)')
          continue
        }
        break
      }
    }

    const endMoney = money()
    const endRam = ns.getServerMaxRam('home')
    const endCores = coresFromCost(sing.getUpgradeHomeCoresCost())
    notes.push(`spend-down: $${Math.round(startMoney)} -> $${Math.round(endMoney)}, home now ${endRam}GB / ${endCores} cores`)

    if (flags.dry) {
      settled = true
      note('ok', { result: 'dry', money: Math.round(endMoney), homeRam: endRam, homeCores: endCores, detail: 'dry run: spent nothing, installed nothing' })
      return
    }

    // ---- the point of no return -------------------------------------------
    //
    // Published BEFORE the call, because the call kills this script: whatever
    // is written here is the last thing anyone can read if the atExit path is
    // also disrupted. Health stays 'ok' rather than becoming 'installing' only
    // because readers gate on that word; the detail says what is happening.
    settled = true
    note('ok', {
      result: 'installing',
      money: Math.round(endMoney),
      homeRam: endRam,
      homeCores: endCores,
      boot,
      bootRam,
      detail: `installing now; ${boot} (${bootRam}GB) is scheduled to start 500ms after the prestige`,
    })
    ns.tprint(`sing-install: installing, then ${boot}. Home is ${endRam}GB / ${endCores} cores, $${Math.round(endMoney)} left.`)

    // installAugmentations returns false and does nothing when the queue is
    // empty (Singularity.ts:203-206). On success it never returns to us — the
    // prestige kills this worker — so the code after it runs only in the
    // nothing-queued case.
    const fired = sing.installAugmentations(boot)
    if (fired === false) {
      note('waiting', {
        result: 'waiting',
        money: Math.round(endMoney),
        homeRam: endRam,
        homeCores: endCores,
        detail: 'nothing was queued, so nothing was installed — the spend-down still happened and is permanent',
      })
    }
  } catch (err) {
    settled = true
    try {
      ns.print(`sing-install error: ${record(errors, err)}`)
      note('error', { result: 'error', detail: describe(err) })
    } catch {
      /* nothing left to try */
    }
  }
}
