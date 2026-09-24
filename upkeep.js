// Claims the two free reputation multipliers that the research found and that
// nothing ever implemented.
//
//   run upkeep.js
//
// Both were sitting in docs/roadmap.md §16d with numbers attached and zero
// lines of code anywhere in the repo. Reputation is the only thing gating the
// exit from this BitNode — Daedalus wants 30 *distinct* augmentations and a
// faction is the only place to buy one — so leaving free reputation on the
// floor is the most expensive kind of idle there is.
//
// ---------------------------------------------------------------------------
// 1. The focus bonus. Worth 25%, continuously.
//
// `focus = this.focus ? 1 : CONSTANTS.BaseFocusBonus` with BaseFocusBonus 0.8
// (src/Constants.ts:87, src/PersonObjects/Player/PlayerObjectGeneralMethods.ts:625).
// Unfocused work therefore earns 80% of the rate, and going from unfocused back
// to focused is a 25% raise.
//
// Focus is dropped by *navigating away from the work screen*, which is exactly
// what every automation in this repo does: cmd.js opens the Terminal, the
// export-bonus claim below opens the Augmentations page, and a human checking
// the City drops it too. cmd.js already restores focus after its own DOM work;
// nothing was watching the rest of the time, so an accidental click could quietly
// cost 20% of all reputation until someone happened to notice.
//
// 2. The export bonus. +1 favor to every joined faction, once per 24 real hours.
//
// `giveExportBonus()` (src/ExportBonus.tsx:12-20) loops `Player.factions` and
// calls `setFavor(favor + 1)` on each, gated on 24h since the last claim
// (`canGetBonus()`, ExportBonus.tsx:6-10). It is reached only from
// `exportGame()` (src/SaveObject.ts:238-240), whose button lives on the
// Augmentations page labelled "Backup Save (+1 favor to all factions)"
// (src/Augmentation/ui/AugmentationsRoot.tsx:179-181).
//
// Favor multiplies reputation gain by (1 + favor/100) and, unlike reputation,
// **survives installing augmentations** — so this is permanent, compounding, and
// scales with the number of factions joined. It was worth +1 favor when the
// analysis was written with no factions joined; with six joined it is +6.
//
// Two things worth knowing:
//   - The RFA `getSaveFile` path used for telemetry calls `getSaveData()`
//     directly (src/RemoteFileAPI/MessageHandlers.ts) and does NOT go through
//     exportGame(), so polling telemetry never consumes the bonus. It is safe to
//     read the save as often as we like.
//   - Claiming it downloads a save file, because that is what the button does.
//     One file per 24h, into the browser's download directory.
//
// The button's own label is the eligibility signal: `exportBonusStr()` returns
// "" when the 24h has not elapsed (AugmentationsRoot.tsx:95-98). So this checks
// the label and only clicks when the bonus is really there, rather than
// tracking a timer of its own and downloading a file for nothing. Closing the
// loop on the game's own state beats keeping a parallel clock.
// ---------------------------------------------------------------------------
//
// Works at any Source-File level. ns.singularity.setFocus and isFocused need
// SF4 (NetscriptDefinitions.d.ts:2858-2874) and ns.getPlayer() exposes neither
// currentWork nor focus, so the DOM is the only route and is the one that keeps
// working when SF4 eventually arrives.

// Free to import: status.js references only ns.write (0GB). See its header.
import { reporter, describe, record } from 'status.js'
import { HUMAN, watchInput, humanRecord, humanVerdict } from 'human.js'

const STATUS = '/tel/upkeep.txt'
// While this file exists, stand down and touch nothing on screen.
//
// This script clicks Focus within 15s of noticing unfocused work, which is
// correct almost always and actively hostile during the one activity that
// matters most: buying augmentations. That is a multi-step UI sequence on the
// Factions screen, and being dragged back to the work view halfway through it
// loses the purchase. Anything driving the UI — an agent in the browser, a
// human, a future install script — takes this lock first and releases it after.
const LOCK = '/tel/ui-lock.txt'
const POLL = 15000
// Re-check the Augmentations page this often. The bonus is a 24h cycle, so
// there is no reason to navigate more than about once an hour — every visit
// costs a moment of focus, which this script then has to buy back.
const EXPORT_CHECK = 3600000

// `eval` so the RAM checker does not see document/window, the same trick cmd.js
// and infilhelper.js use. Referencing them directly would price this script out
// of running permanently.
const doc = eval('document')
const win = eval('window')

/** First visible element whose trimmed text is exactly `text`. */
function byText(tag, text) {
  for (const el of doc.querySelectorAll(tag)) {
    if (el.textContent && el.textContent.trim() === text && el.offsetParent !== null) return el
  }
  return null
}

/** A sidebar navigation entry. Only present when work is not focused. */
function navItem(name) {
  for (const el of doc.querySelectorAll('div,span,p,button')) {
    if (el.textContent && el.textContent.trim() === name && el.offsetParent !== null) return el
  }
  return null
}

/** Is work running right now, focused or not? */
function workState() {
  // The work screen itself while focused.
  if (byText('button', 'Stop Faction work') || byText('button', 'Stop working')) return 'focused'
  // Unfocused work is summarised in the overview panel with a Focus button.
  if (byText('button', 'Focus')) return 'unfocused'
  return 'idle'
}

export async function main(ns) {
  ns.disableLog('ALL')
  ns.tprint('upkeep.js: watching focus and the 24h export favor bonus')

  let refocused = 0
  let deferred = 0
  const input = watchInput(win, doc)
  let claimed = 0
  let lastExportCheck = 0
  let idleTicks = 0
  let note = ''
  // Hoisted out of the try so the error path can report the last work state it
  // knew about, rather than overwriting `work` with something no reader of this
  // file expects. Readers switch on 'focused' | 'unfocused' | 'idle' | 'locked';
  // failures belong in `health` and `note`, not in `work`.
  let state = 'unknown'
  const errors = []

  const say = reporter(ns, STATUS, () => ({
    refocused,
    deferredForHuman: deferred,
    exportClaims: claimed,
    idleTicks,
    idleSeconds: Math.round((idleTicks * POLL) / 1000),
    errors: errors.slice(-5),
  }))

  // The path no try/finally reaches: killed, killall'd, or thrown past. 0GB
  // (ns.atExit). Without it, upkeep dying looks exactly like upkeep having
  // nothing to do — and the cost of that is 20% of all faction reputation,
  // continuously, until somebody notices.
  ns.atExit(() =>
    say.exit('stopped', {
      work: state,
      note: 'upkeep.js is no longer running — focus and the 24h export bonus are unattended',
    }),
  )

  while (true) {
    try {
      if (ns.fileExists(LOCK, 'home')) {
        // Still publish who is looking: the lock stands THIS script down, not
        // the other focus-takers that read HUMAN.
        ns.write(HUMAN, JSON.stringify(humanRecord(input, doc, 'locked')), 'w')
        state = 'locked'
        say('locked', { work: 'locked', note: 'standing down: ' + LOCK })
        await ns.sleep(POLL)
        continue
      }

      state = workState()

      // Who is looking. Published every tick so the other focus-takers
      // (progress.js's setFocus order, the work actors' focus flag) judge the
      // same record; written before anything else so a throw below cannot
      // leave it to go stale and silently hand focus back mid-look.
      const human = humanRecord(input, doc, state)
      ns.write(HUMAN, JSON.stringify(human), 'w')
      const seen = humanVerdict(human)

      // --- 1. Focus -----------------------------------------------------
      // Not while a human is at the window: they unfocused to look at
      // something, and clicking Focus drags them back to the work screen
      // before they can. Refocused once they have been idle IDLE_MS.
      if (state === 'unfocused' && seen.atScreen === true) {
        deferred++
        note = `left work unfocused: ${seen.why}`
      } else if (state === 'unfocused') {
        const btn = byText('button', 'Focus')
        if (btn) {
          btn.click()
          refocused++
          note = 'refocused faction work (was earning 80%)'
          ns.print(note)
        }
      } else if (state === 'idle') {
        idleTicks++
      }

      // --- 2. Export bonus ----------------------------------------------
      // Deliberately NOT gated on being idle. The first version of this waited
      // for an idle window so the navigation could not cost focus — which is
      // self-defeating, because part 1 of this same script exists to make sure
      // there is never an idle window. It would have claimed nothing, ever.
      //
      // Claiming costs the ~2s of unfocused work it takes to open the
      // Augmentations page and come back, once per 24h: 2s at 80% instead of
      // 100% is 0.4s of reputation, against +1 permanent favor on every joined
      // faction. Not a close call.
      //
      // Guarded on having joined a faction, which is not incidental:
      //
      //   for (const facName of Player.factions) { ...setFavor(favor + 1) }
      //   LastExportBonus = new Date().getTime();     // ExportBonus.tsx:16-19
      //
      // The timestamp is set *after* the loop and unconditionally, so claiming
      // with no factions joined awards nothing and still burns the 24h window.
      // That is precisely the state right after an augmentation install — when
      // this script is most likely to be restarted by boot.js and would
      // otherwise fire its first check immediately, throwing the day's favor
      // away before a single faction had been rejoined.
      const now = Date.now()
      const joined = (ns.getPlayer().factions || []).length
      // Also not while a human is looking: the claim navigates the page out
      // from under them. lastExportCheck is left alone, so it runs on the
      // first idle tick instead of an hour later.
      if (joined > 0 && now - lastExportCheck > EXPORT_CHECK && seen.atScreen !== true) {
        lastExportCheck = now

        // Focused work hides the whole navigation sidebar — the only visible
        // buttons are "Stop Faction work" and "Do something else
        // simultaneously". So there is no way to reach the Augmentations page
        // without dropping focus first, and the first version of this silently
        // found no nav element and did nothing at all. Unfocus deliberately,
        // claim, then focus again; the work itself keeps running throughout, it
        // just earns 80% for the couple of seconds this takes.
        if (state === 'focused') {
          const aside = byText('button', 'Do something else simultaneously')
          if (aside) {
            aside.click()
            await ns.sleep(800)
          }
        }

        const aug = navItem('Augmentations')
        if (aug) {
          aug.click()
          await ns.sleep(1200)
          let btn = null
          for (const el of doc.querySelectorAll('button')) {
            if (el.textContent && el.textContent.trim().startsWith('Backup Save') && el.offsetParent !== null) {
              btn = el
              break
            }
          }
          if (btn && btn.textContent.includes('+1 favor')) {
            btn.click()
            claimed++
            note = 'claimed export bonus: +1 favor to every joined faction'
            ns.tprint(`upkeep: ${note}`)
            await ns.sleep(1200)
          } else {
            note = btn ? 'export bonus not available yet (24h cycle)' : 'Backup Save button not found'
          }
          // Put the screen back. Clicking Focus both returns to the work screen
          // and restores the 25%, so prefer it; only fall back to navigating if
          // there was no work running to go back to.
          await ns.sleep(400)
          const f = byText('button', 'Focus')
          if (f) f.click()
          else {
            const fac = navItem('Factions')
            if (fac) fac.click()
          }
        } else {
          note = 'could not reach the Augmentations page'
        }
      }

      say('ok', { work: state, note })
    } catch (err) {
      // ALWAYS surface the failure. The status write above is the last statement
      // of this try, so a throw anywhere earlier — a DOM shape change, a missing
      // button, a bad edit — skipped it entirely and left the file frozen at the
      // last good tick while the loop kept spinning. `note` is this script's only
      // record of what it did, so losing it loses everything.
      try {
        const detail = record(errors, err)
        ns.print(`upkeep error: ${detail}`)
        say('error', { work: state, note: `error: ${describe(err)}` })
      } catch {
        /* nothing left to try */
      }
    }

    await ns.sleep(POLL)
  }
}
