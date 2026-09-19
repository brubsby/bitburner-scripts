// Converts money into home RAM and cores — the only permanent purchases there
// are — by clicking the Alpha Enterprises buttons. No Source-File needed.
//
//   run homeup.js                  spend down to the default reserve
//   run homeup.js --reserve 0      spend everything (pre-install)
//   run homeup.js --dry            report what it would buy
//
// ---------------------------------------------------------------------------
// Why this is the most important purchase in the game, and why we kept missing it.
//
// `prestigeHomeComputer` (src/Server/ServerHelpers.ts:226-239) clears programs,
// serversOnNetwork and ramUsed on install — and touches **neither maxRam nor
// cpuCores**. Home RAM and cores are therefore permanent across every install,
// for the rest of the BitNode.
//
// Money is the opposite: an install resets it to $1m. So **every dollar still
// in the bank when Install is clicked is destroyed.** We installed holding
// $2.07 QUADRILLION with home at 16.38TB and 1 core, which converted a fortune
// into nothing. buyserv.js spends surplus on *cloud* servers, but those are
// destroyed by an install too — it was optimising the wrong sink.
//
// The correct policy follows directly:
//   - during a life, keep enough for augmentations (they are rep-gated, and
//     rep arrives unpredictably), spend the rest on home;
//   - immediately before installing, spend everything, because the alternative
//     is setting it on fire.
//
// Cores are bought before RAM up to the cap: they are far cheaper per step and
// multiply grow/weaken effectiveness on home, whereas RAM doublings escalate
// steeply. Both are strictly better than any cloud purchase, which does not
// survive the next install.
// ---------------------------------------------------------------------------

import { acquire, release } from 'lock.js'
import { nextHomeUpgrade } from 'homecost.js'

const doc = eval('document')
const STATUS = '/tel/homeup.txt'

const vis = (sel) => [...doc.querySelectorAll(sel)].filter((e) => e.offsetParent !== null)
const byText = (sel, text) => vis(sel).find((e) => e.textContent && e.textContent.trim() === text)

/** Buttons are labelled "Upgrade 'home' RAM (16.38TB -> 32.77TB) - $316.788b". */
const upgradeButton = (kind) =>
  [...doc.querySelectorAll('button')].find((b) => (b.textContent || '').trim().startsWith(`Upgrade 'home' ${kind}`))

/** Navigate to Alpha Enterprises in Sector-12, where both buttons live. */
async function goToAlpha(ns) {
  if (upgradeButton('RAM')) return true
  const city = vis('div,span,p').find((e) => e.textContent.trim() === 'City')
  if (city) {
    city.click()
    await ns.sleep(1400)
  }
  // City map is ASCII art: each location is a one-glyph <span class=...location>
  // whose human label follows as sibling text. Alpha Enterprises is the "T"
  // before "[alpha ent.]".
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
    await ns.sleep(1500)
  }
  return !!upgradeButton('RAM')
}

export async function main(ns) {
  const flags = ns.flags([
    ['reserve', 1e12],
    ['dry', false],
    ['max', 40],
  ])
  ns.disableLog('ALL')

  const bought = []
  const notes = []

  // Work out what the next upgrade costs BEFORE going anywhere near the UI.
  // This used to be read off the Alpha Enterprises buttons at the end of the
  // run, which meant the only way to learn "we still cannot afford it" was to
  // take the global UI lock, walk to Sector-12 and yank the screen away from
  // whatever the player was doing — every 30 seconds, forever. It is a closed
  // form of (maxRam, cpuCores); see homecost.js.
  const next = nextHomeUpgrade(ns.getServerMaxRam('home'), ns.getServer('home').cpuCores)
  let nextCost = next ? next.cost : Infinity

  // Nothing affordable, so there is nothing the UI could tell us. Report and
  // leave without touching the screen or the lock.
  if (!next || ns.getServerMoneyAvailable('home') - next.cost < flags.reserve) {
    notes.push(
      next
        ? `waiting: next is ${next.kind} at $${ns.format.number(next.cost)}, have $${ns.format.number(ns.getServerMoneyAvailable('home'))} (reserve $${ns.format.number(flags.reserve)})`
        : 'home is fully upgraded (1PB / 8 cores)',
    )
    report(ns, flags, nextCost, bought, notes)
    return
  }

  if (!flags.dry && !(await acquire(ns, 'homeup'))) {
    ns.tprint('homeup: could not take the UI lock; another script is driving. Try later.')
    return
  }

  try {

    const aside = byText('button', 'Do something else simultaneously')
    if (aside) {
      aside.click()
      await ns.sleep(900)
    }

    if (!(await goToAlpha(ns))) {
      notes.push('could not reach Alpha Enterprises (in Sector-12?)')
    } else {
      const before = { ram: ns.getServerMaxRam('home'), cores: ns.getServer('home').cpuCores }
      const state = () => `${ns.getServerMaxRam('home')}GB/${ns.getServer('home').cpuCores}c`

      for (let i = 0; i < flags.max; i++) {
        const money = ns.getServerMoneyAvailable('home')
        // Cores first while they are cheap; the button disables itself at the
        // cap, which is the game telling us to stop rather than a guess here.
        const core = upgradeButton('cores')
        const ram = upgradeButton('RAM')

        const pick =
          core && !core.disabled && money - priceOf(core) >= flags.reserve
            ? { btn: core, kind: 'cores' }
            : ram && !ram.disabled && money - priceOf(ram) >= flags.reserve
              ? { btn: ram, kind: 'RAM' }
              : null

        if (!pick) break
        if (flags.dry) {
          bought.push(`would buy ${pick.kind}: ${(pick.btn.textContent || '').trim()}`)
          break
        }
        // Verify, do not assume. Clicking an upgrade button whose price the
        // game treats as unaffordable is a silent no-op, and logging on the click
        // alone reported purchases that never happened — including a "6 -> 7
        // cores" and a "131 -> 262TB" that both failed mid-spend while the log
        // claimed success.
        const label = (pick.btn.textContent || '').trim()
        const was = state()
        pick.btn.click()
        await ns.sleep(700)
        if (state() === was) {
          notes.push(`stopped: "${label}" did not apply (insufficient funds at click time)`)
          break
        }
        bought.push(`${pick.kind}: ${label}`)
      }

      const after = { ram: ns.getServerMaxRam('home'), cores: ns.getServer('home').cpuCores }
      notes.push(`home ${before.ram}GB/${before.cores}c -> ${after.ram}GB/${after.cores}c`)

      // Republish the price now that we have spent: whatever we bought moved
      // the next rung up. Computed, not read off the page — the buttons carry
      // `disabled={!canAfford || reachMax}` (RamButton.tsx:49), so the price of
      // the thing we cannot yet afford is exactly the one they refuse to show.
      // Filtering those out published `nextCost: null` = "fully maxed", which
      // is how this ended up gated on a number that meant the opposite.
      const remaining = nextHomeUpgrade(ns.getServerMaxRam('home'), ns.getServer('home').cpuCores)
      nextCost = remaining ? remaining.cost : Infinity
    }
  } catch (err) {
    notes.push(String(err).slice(0, 200))
  }

  report(ns, flags, nextCost, bought, notes)

  if (!flags.dry) {
    release(ns)
    const focus = byText('button', 'Focus')
    if (focus) focus.click()
  }
  if (bought.length) ns.tprint(`homeup: ${bought.length} upgrade(s) — ${notes.join('; ')}`)
  else ns.tprint(`homeup: nothing bought — ${notes.join('; ')}`)
}

/**
 * Publish state. Called on every exit path, including the early one — the
 * watchdog gates on `nextCost`, so a run that returns without writing leaves it
 * reading a stale figure and deciding on it.
 */
function report(ns, flags, nextCost, bought, notes) {
  ns.write(
    STATUS,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        dry: flags.dry,
        reserve: flags.reserve,
        money: Math.round(ns.getServerMoneyAvailable('home')),
        // Cost of the cheapest remaining upgrade. null means genuinely maxed
        // out (1PB RAM and 8 cores) — never "we could not read the page".
        nextCost: Number.isFinite(nextCost) ? Math.round(nextCost) : null,
        bought,
        notes,
      },
      null,
      2,
    ),
    'w',
  )
}

/** Parse the trailing "- $316.788b" off an upgrade button's label. */
function priceOf(btn) {
  const m = (btn.textContent || '').match(/\$([\d.]+)([kmbtqQ]?)/)
  if (!m) return Infinity
  const mult = { '': 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12, q: 1e15, Q: 1e18 }[m[2]] ?? 1
  return parseFloat(m[1]) * mult
}
