// Puts the game's Options into the state this automation needs. Idempotent.
//
//   run settings.js            apply, report what changed
//   run settings.js --dry      report what WOULD change, touch nothing
//
// A fresh BitNode — or a fresh save entirely — starts with every confirmation
// dialog on, and each one is a modal that has to be found and dismissed by
// whatever script is driving the UI. The modals are not merely annoying; they
// are a correctness hazard. `augbuy.js` has to handle both "a Purchase modal
// appeared" and "the purchase happened silently" precisely because this setting
// can go either way (AugmentationsPage.tsx:251-257), and stacked modals from a
// failed attempt are LIFO — confirming them blind buys augmentations in
// ascending price order against the x1.9-per-queued-aug multiplier, which is
// the most expensive possible order.
//
// So: turn the confirmations off once, deterministically, and record why.
//
// Idempotency comes from reading each switch's checkbox state and clicking only
// when it differs. Running this twice is a no-op; running it on a brand new
// save configures it. There is no NS API for Settings, so this drives the
// Options UI the same way the rest of the repo drives the game
// (see CLAUDE.md, "Driving the UI from inside the game").

import { acquire, release } from 'lock.js'

const doc = eval('document')
const STATUS = '/tel/settings.txt'

// label text -> desired checked state, with the page it lives on.
//
// Only confirmations and popups are touched. Deliberately NOT changed:
// "Disable hotkeys" (a human may still want them), the editor/bash toggles
// (taste), and anything under Interface (ASCII art is how findpath and the City
// map are read — disabling it would break the location clicking in torbuy.js).
const DESIRED = [
  // Gameplay — every one of these is a modal that interrupts automation.
  ['Suppress story messages', true, 'Gameplay'],
  // Popup only. Player.receiveInvite() still runs and invites still queue on
  // the Factions page (FactionHelpers.tsx:27-32), so nothing is missed — and
  // the popup otherwise steals clicks aimed at the Join! buttons underneath.
  ['Suppress faction invites', true, 'Gameplay'],
  ['Suppress travel confirmations', true, 'Gameplay'],
  ['Suppress augmentations confirmation', true, 'Gameplay'],
  ['Suppress TIX messages', true, 'Gameplay'],
  // Kept OFF on purpose: error modals are how a script failure becomes
  // visible at all. Suppressing them would hide exactly the failures worth
  // seeing, and nothing in this repo is blocked by them.
  ['Suppress error modals', false, 'Gameplay'],
  ['Suppress bladeburner popup', true, 'Gameplay'],
  // System — toasts are harmless but they overlay the bottom-right corner
  // where buttons sometimes sit.
  ['Suppress Auto-Save Game Toast', true, 'System'],
  ['Suppress Auto-Save Disabled Warning', true, 'System'],
]

const vis = (sel) => [...doc.querySelectorAll(sel)].filter((e) => e.offsetParent !== null)

/**
 * Navigate to Options, then to a named settings page.
 *
 * Click the ListItemButton, not the Typography inside it: sidebar entries are
 * <ListItemButton><Typography>{name}</Typography></ListItemButton>
 * (GameOptionsSidebar.tsx:48-53), and clicking the inner text is unreliable.
 *
 * "Am I already there?" is answered by looking for the page's own switches
 * rather than by tracking navigation state, so a partially-completed previous
 * run costs nothing.
 */
async function openPage(ns, page) {
  const go = (name) => {
    const el = vis('p,span,div').find((e) => e.textContent.trim() === name)
    if (!el) return false
    ;(el.closest('.MuiListItemButton-root,[role=button],li,button') || el).click()
    return true
  }

  if (!doc.body.innerText.includes('Gameplay')) {
    go('Options')
    await ns.sleep(1500)
  }
  // The sidebar name appears twice (nav entry and page body); the last match is
  // the tab itself.
  const hits = [...doc.querySelectorAll('*')].filter((e) => (e.textContent || '').trim() === page)
  if (!hits.length) return false
  const target = hits[hits.length - 1]
  ;(target.closest('.MuiListItemButton-root,[role=button],li,button') || target).click()
  await ns.sleep(1100)
  return true
}

/**
 * The checkbox belonging to a switch with this label.
 *
 * OptionSwitch renders a MUI FormControlLabel wrapping a Switch (an <input
 * type=checkbox>) and the label text, so the input is a descendant of the same
 * label element the text sits in (ui/React/OptionSwitch.tsx:18-45).
 */
function switchFor(text) {
  for (const label of doc.querySelectorAll('label')) {
    if (!label.textContent || label.textContent.trim() !== text) continue
    const input = label.querySelector('input[type=checkbox]')
    if (input) return input
  }
  return null
}

export async function main(ns) {
  const flags = ns.flags([['dry', false]])
  ns.disableLog('ALL')

  const changed = []
  const already = []
  const missing = []
  const notApplicable = []

  if (!flags.dry && !(await acquire(ns, 'settings'))) {
    ns.tprint('settings: could not take the UI lock; another script is driving.')
    return
  }

  try {

    // Focused work hides the sidebar entirely.
    const aside = vis('button').find((b) => b.textContent.trim() === 'Do something else simultaneously')
    if (aside) {
      aside.click()
      await ns.sleep(900)
    }

    for (const page of ['Gameplay', 'System']) {
      const wanted = DESIRED.filter(([, , p]) => p === page)
      if (!wanted.length) continue
      if (!(await openPage(ns, page))) {
        missing.push(`page ${page} not reachable`)
        continue
      }
      for (const [text, desired] of wanted) {
        const input = switchFor(text)
        if (!input) {
          // Some switches only render when the feature is unlocked (the
          // bladeburner popup toggle needs Bladeburner access). Not an error.
          notApplicable.push(text)
          continue
        }
        if (input.checked === desired) {
          already.push(`${text}=${desired}`)
          continue
        }
        // Capture before clicking: reading input.checked afterwards reports the
        // new value on both sides and logs a useless "true -> true".
        const was = input.checked
        if (!flags.dry) {
          input.click()
          await ns.sleep(350)
        }
        changed.push(`${text}: ${was} -> ${desired}`)
      }
    }
  } catch (err) {
    missing.push(String(err).slice(0, 160))
  }

  ns.write(
    STATUS,
    JSON.stringify({ at: new Date().toISOString(), dry: flags.dry, changed, already, notApplicable, missing }, null, 2),
    'w',
  )

  if (!flags.dry) {
    release(ns)
    // Give the screen back.
    const focus = vis('button').find((b) => b.textContent.trim() === 'Focus')
    if (focus) focus.click()
  }

  if (changed.length) ns.tprint(`settings: changed ${changed.length} — ${changed.join('; ')}`)
  else ns.tprint(`settings: already correct (${already.length} checked)`)
  if (missing.length) ns.tprint(`settings: NOT FOUND ${missing.join(', ')}`)
}
