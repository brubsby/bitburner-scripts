// Buys one augmentation from a faction, by driving the game's own UI from
// inside the game.
//
//   run augbuy.js 'The Black Hand' 'DataJack'
//
// Augmentation purchase has no NS API without Source-File 4, so it is a UI
// job — but "UI job" does not have to mean "browser automation from outside".
// A Netscript process can reach the DOM the same way cmd.js and upkeep.js do
// (document via eval, so the RAM checker does not price it), which makes the
// purchase available to the fully headless loop: no extension, no external
// agent, just a script that any other script can exec.
//
// Protocol niceties learned the hard way elsewhere in this repo:
//   - The nav sidebar does not exist while faction work is focused; unfocus
//     first ("Do something else simultaneously"), refocus after.
//   - The confirm button is exactly 'Purchase'; matching loosely re-clicks the
//     row's own 'Buy' and silently queues a second modal instead of buying.
//   - Expect exactly one 'Purchase' on screen; more means stacked modals from
//     an earlier failure, and confirming blind buys the wrong thing (modals
//     are LIFO, so a stack confirms cheapest-first against the x1.9-per-aug
//     price multiplier).
//   - Takes the global lock (lock.js) for the whole sequence, so upkeep.js
//     stands down and no other UI script navigates underneath it.
//
// Writes the outcome to /tel/augbuy.txt.
//
// ---------------------------------------------------------------------------
// Two things this script got wrong until now, both invisible.
//
// 1. **It leaked the UI lock on any throw.** Everything between `acquire` and
//    the final `release` — the whole DOM walk, ~10s of navigation — ran with no
//    try/finally. A single throw in there (a MUI class change, an undefined
//    element, a bad edit) left /tel/ui-lock.txt in place for its full 300s TTL
//    with nothing holding it, and upkeep.js stood down for the duration. That
//    exact failure once cost ~3 hours of unfocused (80%) faction work.
//
// 2. **It wrote no telemetry on a throw.** Every *handled* failure called out()
//    and returned, but an unhandled one produced nothing at all: a script that
//    was exec'd, did something to the screen, and left no record of what. The
//    caller cannot distinguish that from "never launched".
//
// So: one try/catch/finally around the whole sequence, plus an ns.atExit that
// releases the lock and reports even when the process is killed outright. The
// scattered `release(ns)` calls on the handled paths are left exactly as they
// were — release() checks ownership before removing the file, so releasing
// twice is a no-op, and keeping them keeps this an observability change rather
// than a rewrite of control flow.
// ---------------------------------------------------------------------------

import { acquire, release } from 'lock.js'
// Free to import: status.js references only ns.write (0GB). See its header.
import { reporter, describe } from 'status.js'

const doc = eval('document')
const STATUS = '/tel/augbuy.txt'

const vis = (sel) => [...doc.querySelectorAll(sel)].filter((e) => e.offsetParent !== null)
const byText = (sel, text) => vis(sel).find((e) => e.textContent && e.textContent.trim() === text)

export async function main(ns) {
  ns.disableLog('ALL')
  const [faction, augName] = ns.args

  // Same file, same fields (at / faction / augName / result / detail), now with
  // the uniform `health` word alongside. `out` keeps its old signature so every
  // call site below is untouched.
  const note = reporter(ns, STATUS, () => ({ faction, augName }))
  const out = (result, detail) => note(result === 'ok' ? 'ok' : 'error', { result, detail })

  if (!faction || !augName) {
    out('error', 'usage: run augbuy.js <faction> <aug name substring>')
    return
  }

  if (!(await acquire(ns, 'augbuy'))) {
    out('error', 'could not take the UI lock; another script is driving')
    return
  }

  // From here we hold the lock, so every path out has to give it back.
  // `finished` guards the atExit so a completed run does not have its verdict
  // overwritten; ns.atExit costs 0GB and runs before the worker is torn down
  // (Netscript/killWorkerScript.ts:56-84), so release() still works there.
  let finished = false
  ns.atExit(() => {
    release(ns)
    if (!finished) {
      note.exit('error', {
        result: 'error',
        detail: 'augbuy.js exited without reporting — killed mid-sequence, or threw past every handler',
      })
    }
  })

  try {
    // If cmd.js launched us from its terminal batch, it is still mid-batch and
    // will click Focus as its last act — which hides the sidebar and replaces
    // whatever page we just navigated to with the work screen. Racing it lost a
    // purchase to exactly that: nav clicked, 1.3s later zero faction rows on
    // screen. Wait for the bridge to finish (busy file gone) before touching
    // anything.
    for (let waited = 0; ns.fileExists('/cmd/busy.txt', 'home') && waited < 30000; waited += 300) {
      await ns.sleep(300)
    }
    await ns.sleep(800)

    // Reach the sidebar, which focused work hides.
    //
    // `tries`, not `attempt`. The RAM checker prices every bare Identifier by
    // name (Script/RamCalculations.ts:407) and MemberExpression walks the
    // property too, so a LOCAL VARIABLE called `attempt` is billed as
    // ns.codingcontract.attempt — 10GB (RamCostGenerator.ts:388), on a script
    // that otherwise costs 2.4. It cost us 10GB here for a loop counter.
    for (let tries = 0; tries < 3; tries++) {
      const aside = byText('button', 'Do something else simultaneously')
      if (aside) {
        aside.click()
        await ns.sleep(900)
      }
      const nav = vis('div,span,p').find((e) => e.textContent.trim() === 'Factions')
      if (nav) {
        nav.click()
        await ns.sleep(1300)
      }
      if (vis('button').some((b) => b.textContent.trim() === 'Details')) break
    }

    // Find this faction's row.
    //
    // A fixed-depth ancestor walk was tried twice and failed twice. The second
    // attempt walked exactly 4 levels from each Details button "shallow enough
    // never to reach a shared ancestor" — and then Daedalus joined, the list grew
    // a row, and 4 levels from row 0 reached a container holding EVERY faction
    // name. Asking for BitRunners matched Daedalus's row, and the script cheerfully
    // opened the wrong faction's catalogue and reported the aug "not listed".
    // Any constant depth is a guess about a layout that changes.
    //
    // So do not guess a depth: walk up until the ancestor is unambiguous. The
    // correct row is the nearest ancestor that mentions our faction and mentions
    // no OTHER joined faction — which is exactly what "this row" means, and is
    // independent of how deep the DOM happens to be. This is the same rule the
    // aug-card binding below already follows (CLAUDE.md: bind a button to its own
    // card, never by walking a fixed number of ancestors).
    const dets = vis('button').filter((b) => b.textContent.trim() === 'Details')
    const augs = vis('button').filter((b) => b.textContent.trim() === 'Augments')

    // Every faction name on the page, so "contains another faction" is decidable.
    const names = dets.map((b) => b.parentElement?.parentElement?.innerText || '').join('\n')
    const known = [
      'Daedalus', 'BitRunners', 'The Black Hand', 'NiteSec', 'CyberSec', 'Sector-12',
      'Netburners', 'Tian Di Hui', 'NWO', 'ECorp', 'MegaCorp', 'Fulcrum Secret Technologies',
      'Blade Industries', 'OmniTek Incorporated', 'KuaiGong International', 'Four Sigma',
      'Slum Snakes', 'Tetrads', 'Illuminati', 'The Covenant', 'Chongqing', 'New Tokyo',
      'Ishima', 'Aevum', 'Volhaven', 'Speakers for the Dead', 'The Dark Army', 'The Syndicate',
    ].filter((n) => n !== faction && names.includes(n))

    let rowIdx = -1
    for (let i = 0; i < augs.length && rowIdx < 0; i++) {
      let n = augs[i]
      for (let d = 0; d < 12 && n; d++) {
        n = n.parentElement
        const t = (n && n.innerText) || ''
        if (!t.includes(faction)) continue
        // Ambiguous: this ancestor spans other rows too. Going up only ever adds
        // more, so stop and reject this button rather than climbing further.
        if (known.some((other) => t.includes(other))) break
        rowIdx = i
        break
      }
    }
    if (rowIdx < 0 || !augs[rowIdx]) {
      release(ns)
      out('error', `no unambiguous row for ${faction} — joined? (rows: ${dets.length}, others: ${known.length})`)
      return
    }
    augs[rowIdx].click()
    await ns.sleep(1500)

    // Bind each Buy button to its OWN aug card.
    //
    // Every aug renders as a MUI <Paper> containing exactly one Buy/Owned button
    // (PurchasableAugmentations.tsx:181-205), so `closest('.MuiPaper-root')` is
    // an exact match. The previous version walked up to 4 ancestors from each
    // button looking for the aug name, which silently matched *other* buttons
    // once the walk reached a container spanning several rows — so it clicked
    // whichever Buy came first, often a **disabled** one (rep or money short),
    // and a disabled MUI button swallows .click() with no error and no modal.
    // That is the entire reason this script appeared to "click Buy and nothing
    // happens".
    const cards = vis('button')
      .filter((b) => b.textContent.trim() === 'Buy')
      .map((b) => ({ btn: b, paper: b.closest('.MuiPaper-root') }))
      .filter((c) => c.paper && c.paper.textContent.includes(augName))

    if (!cards.length) {
      const listed = vis('button')
        .filter((b) => /^(Buy|Owned)$/.test(b.textContent.trim()))
        .map((b) => (b.closest('.MuiPaper-root')?.textContent || '').replace(/\s+/g, ' ').slice(0, 40))
      release(ns)
      out('error', `"${augName}" not listed by ${faction}; saw ${JSON.stringify(listed.slice(0, 12))}`)
      return
    }
    const { btn: row } = cards[0]

    // Disabled means canPurchase() is false: reputation or money short, or a
    // prerequisite missing. Report that distinctly instead of clicking into the
    // void — it is the single most common real cause and it is knowable here.
    if (row.disabled) {
      release(ns)
      out('error', `Buy for "${augName}" is disabled — rep or money short, or prereq missing`)
      return
    }

    // Snapshot so we can tell a silent success from a silent failure. With
    // Settings.SuppressBuyAugmentationConfirmation the click purchases
    // immediately and NO modal appears (AugmentationsPage.tsx:251-257), so
    // "no Purchase dialog" is ambiguous on its own.
    //
    // The signal is the page's own "Price multiplier: x N", which multiplies by
    // 1.9 for every queued augmentation. ns.getPlayer() cannot be used for this:
    // its Player interface exposes money/factions/jobs/karma and NOT
    // queuedAugmentations, so a queue-length check reads undefined both sides of
    // the click and reports failure on every success.
    const multNow = () => (doc.body.innerText.match(/Price multiplier:\s*x\s*([\d.,]+)/) || [])[1] || '?'
    const multBefore = multNow()
    row.click()

    // The confirm dialog is a MUI portal that can render positioned outside the
    // viewport, so do NOT filter by offsetParent here. Poll: it mounts on a
    // later React render tick.
    let confirms = []
    for (let waited = 0; waited < 4000; waited += 200) {
      await ns.sleep(200)
      confirms = [...doc.querySelectorAll('button')].filter((b) => b.textContent && b.textContent.trim() === 'Purchase')
      if (confirms.length) break
    }

    if (confirms.length === 1) {
      confirms[0].click()
      await ns.sleep(1200)
    } else if (confirms.length > 1) {
      release(ns)
      out('error', `${confirms.length} stacked Purchase modals — aborting rather than confirming blind`)
      return
    } else {
      // No modal: either confirmation is suppressed (already bought) or the
      // click did nothing. The queue says which.
      await ns.sleep(800)
      if (multNow() === multBefore) {
        release(ns)
        out('error', `clicked Buy for "${augName}" but the price multiplier did not move (x${multBefore}) — nothing was purchased`)
        return
      }
    }

    // Back to work, focused.
    const back = byText('button', 'Back')
    if (back) back.click()
    await ns.sleep(700)
    const focus = byText('button', 'Focus')
    if (focus) focus.click()

    release(ns)
    out('ok', 'purchased')
    ns.tprint(`augbuy: purchased ${augName} from ${faction}`)
  } catch (err) {
    // The unhandled path. Previously this produced nothing whatsoever: no
    // status file entry, no terminal line, and a lock left on the floor.
    out('error', describe(err))
    ns.tprint(`augbuy: failed buying ${augName} from ${faction} — ${describe(err)}`)
  } finally {
    finished = true
    // Idempotent: release() only removes the file if we still own it, so the
    // handled paths above having already released is fine. What matters is that
    // no path can leave here still holding it.
    release(ns)
  }
}
