// Buys the TOR router with no human and no Source-File 4.
//
//   run torbuy.js          exits as soon as TOR is owned
//
// TOR gates the darkweb, which gates every port-opening program, which gates
// rooting, which gates the whole fleet — so a life that does not buy it stalls
// early and stays stalled. autobuy.js could never do it: `ns.singularity
// .purchaseTor` needs SF4, and the terminal's `buy` command needs the darkweb,
// which needs TOR. Its own comment concluded "leave it to a human", and that
// was the last hard stop in the post-install loop.
//
// It is not actually a hard stop: purchase is a plain MUI <Button> at Alpha
// Enterprises (src/Locations/ui/TorButton.tsx:45-48), and a Netscript process
// can click it through `eval('document')` exactly as augbuy.js clicks Buy. No
// Source-File, no browser extension, no agent.
//
// Details that matter:
//   - The button is `disabled` until Player.canAfford(200k), and a disabled MUI
//     button swallows .click() silently — so check `.disabled` and wait for
//     money rather than clicking into the void.
//   - Its label is "Purchase TOR router -" followed by a <Money> element, so
//     match on a prefix, never on exact text.
//   - Alpha Enterprises is in Sector-12, which is where every install drops
//     you, so no travel is needed on a fresh life.
//   - On the City map the clickable element is the location *glyph*, not the
//     text label; clicking the label's own element misses.
//   - Holds /tel/ui-lock.txt while navigating so upkeep.js does not pull the
//     screen back to faction work mid-sequence.

import { acquire, release } from 'lock.js'
// Free to import: status.js references only ns.write (0GB). See its header.
import { reporter, describe, record } from 'status.js'

const doc = eval('document')
const STATUS = '/tel/torbuy.txt'
const TOR_COST = 200e3

// Whether TOR is owned. Use the game's own predicate: ns.hasTorRouter(), which
// costs 0.05GB and needs no Source-File (RamCostGenerator.ts:591). It is
// literally `home.serversOnNetwork.includes('darkweb')`
// (PlayerObjectServerMethods.ts:14-16).
//
// NOT ns.serverExists('darkweb'): the darkweb server is always present in the
// server list, and buying TOR merely *connects* it to home (`getTorRouter()`
// -> connectServers(home, darkweb), ServerHelpers.ts:354-356). serverExists is
// therefore true from the first second of a BitNode, which made autobuy believe
// TOR was owned, never buy it, and queue `buy FTPCrack.exe` every 60s into a
// terminal that answered "You need to be able to connect to the Dark Web".
const hasTor = (ns) => ns.hasTorRouter()

const vis = (sel) => [...doc.querySelectorAll(sel)].filter((e) => e.offsetParent !== null)
const byText = (sel, text) => vis(sel).find((e) => e.textContent && e.textContent.trim() === text)

/** The "Purchase TOR router - $200k" button, wherever it is on the page. */
function torButton() {
  return [...doc.querySelectorAll('button')].find((b) => (b.textContent || '').trim().startsWith('Purchase TOR router'))
}

export async function main(ns) {
  ns.disableLog('ALL')

  const errors = []
  // `result` is kept as its own field because things read it; `health` is the
  // uniform one-glance word every status file in the repo now carries. The two
  // happen to agree here — 'ok' | 'waiting' | 'error' are all valid healths.
  const note = reporter(ns, STATUS, () => ({ errors: errors.slice(-5) }))
  // True once we have published a terminal 'ok', so the atExit below does not
  // overwrite a successful purchase with 'stopped' when the script returns.
  let settled = false
  const say = (result, detail) => {
    if (result === 'ok') settled = true
    return note(result, { result, detail })
  }

  // The path no try/catch can reach: killed by the watchdog, caught in a
  // killall, or thrown past the loop. ns.atExit costs 0GB and runs before the
  // worker is torn down, so synchronous ns calls still work — which makes it
  // the only place that can guarantee the UI lock is not left behind. A lock
  // leaked by a dying UI script cost ~3 hours of unfocused (80%) faction work
  // once already, and this script holds it across ~4s of navigation.
  ns.atExit(() => {
    release(ns)
    if (!settled) {
      note.exit('stopped', {
        result: 'stopped',
        detail: 'torbuy.js exited before owning TOR — the darkweb is still closed',
      })
    }
  })

  while (true) {
    try {
      if (hasTor(ns)) {
        say('ok', 'TOR already owned')
        return
      }
      if (ns.getServerMoneyAvailable('home') < TOR_COST * 1.2) {
        say('waiting', `need $${TOR_COST} (+headroom), have $${Math.round(ns.getServerMoneyAvailable('home'))}`)
        await ns.sleep(20000)
        continue
      }

      if (!(await acquire(ns, 'torbuy', 60000))) {
        await ns.sleep(15000)
        continue
      }

      // Focused work hides the sidebar entirely.
      const aside = byText('button', 'Do something else simultaneously')
      if (aside) {
        aside.click()
        await ns.sleep(900)
      }

      if (!torButton()) {
        const city = vis('div,span,p').find((e) => e.textContent.trim() === 'City')
        if (city) {
          city.click()
          await ns.sleep(1400)
        }
        // The City map is ASCII art: each line is a <p>, and every location is
        // a <span class="...-location"> holding ONE glyph, with its human
        // label sitting in the plain text that follows. Alpha Enterprises is
        // the "T" before "[alpha ent.]".
        //
        // So neither "click the element containing the label" nor "click its
        // first child span" is right — the label is a sibling text node, not a
        // child, and a line can hold several locations. Match a location span
        // by the text that FOLLOWS it, which is exactly one span here.
        const loc = [...doc.querySelectorAll('span')]
          .filter((sp) => /-location/.test((sp.className || '').toString()))
          .find((sp) => {
            let after = ''
            let n = sp.nextSibling
            while (n && after.length < 60) {
              after += n.textContent || ''
              n = n.nextSibling
            }
            return after.includes('alpha ent.')
          })
        if (loc) {
          loc.click()
          await ns.sleep(1400)
        }
      }

      const btn = torButton()
      if (!btn) {
        say('error', 'Purchase TOR router button not found — are we in Sector-12?')
      } else if (btn.disabled) {
        // Disabled has two causes (TorButton.tsx:45): cannot afford, or already
        // purchased. Reporting "cannot afford" for both is how a *successful*
        // purchase looked like a failure — the click worked, the next loop saw
        // the button read "Purchased", and the script blamed money.
        const already = (btn.textContent || '').includes('Purchased')
        say(already ? 'ok' : 'waiting', already ? 'already purchased' : 'TOR button disabled — cannot afford yet')
        if (already) {
          const f2 = byText('button', 'Focus')
          if (f2) f2.click()
          release(ns)
          return
        }
      } else {
        btn.click()
        await ns.sleep(1200)
        say(hasTor(ns) ? 'ok' : 'error', hasTor(ns) ? 'purchased' : 'clicked but darkweb still missing')
        if (hasTor(ns)) ns.tprint('torbuy: TOR router purchased — darkweb is open')
      }

      // Hand the screen back before releasing the lock.
      const focus = byText('button', 'Focus')
      if (focus) focus.click()
      release(ns)

      if (hasTor(ns)) return
    } catch (err) {
      // ALWAYS surface the failure. This used to print to the script's own log
      // and nothing else, so a throw mid-navigation left /tel/torbuy.txt frozen
      // on whatever it last said — usually "waiting: need $200000" — while the
      // real problem was a DOM shape change. The lock was released but the
      // reason was not written down anywhere a reader could find it.
      try {
        const detail = record(errors, err)
        ns.print(`torbuy error: ${detail}`)
        note('error', { result: 'error', detail: describe(err) })
      } catch {
        /* nothing left to try */
      }
      release(ns)
    }
    await ns.sleep(20000)
  }
}
