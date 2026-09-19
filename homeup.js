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
// Money is the opposite: an install resets it to **$1,262** — not $1m.
// `Player.prestigeAugmentation` sets `money = 1000 + CONSTANTS.Donations`
// (PlayerObjectGeneralMethods.ts:102, Constants.ts:107), and only then does
// Prestige.ts:85-88 add each owned augmentation's `startingMoney`. The familiar
// $1m is CashRoot Starter Kit alone. So **every dollar still
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

import { acquire, release, setLockTransport, LOCK_FILE } from 'lock.js'
import { nextHomeUpgrade } from 'homecost.js'
// Free to import: status.js references only ns.write (0GB). See its header.
import { reporter, describe, record } from 'status.js'

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

/**
 * The bootstrap ratchet: one home-RAM buyer that also RE-ENTERS the launcher.
 *
 * `--watch` exists because the tier ladder had no bottom rung. boot.js admits
 * scripts by home RAM, and the only script that RAISES home RAM was this one —
 * at tier 64 and `kind: 'job'`, with its job runner (watchdog.js) also at tier
 * 64. A 32GB home could therefore earn money forever and never convert it into
 * the next tier. Live in BitNode 1 that cost nine hours: $86m accumulated at
 * $8.6m/h while the configuration that earns $22b/h sat one purchase away.
 *
 * Two things are needed to break that, and only doing one leaves it stuck:
 *
 *   1. BUY at the bottom tier. Hence a resident daemon rather than a job — at
 *      32GB there is no watchdog to trigger a job, which is the whole problem.
 *   2. RE-ENTER boot.js when the tier changes. Buying RAM nobody re-plans for
 *      just means a bigger home running the small home's script set. Before
 *      this, the ladder only stepped at install and BitNode boundaries, and at
 *      tier 32 progress.js is not admitted either — so there were no installs
 *      to step it. Both halves, or neither works.
 *
 * It then RETIRES itself: once watchdog.js is running, the job entry takes over
 * and a resident copy would be a second buyer holding 4.45GB for nothing. The
 * manifest says the same thing with `until: 64`; this is the running half of
 * that claim, for the case where home grows past the tier mid-life.
 */
export async function main(ns) {
  // This script is placed "anywhere" by boot.js, and the UI lock is a home
  // file: pull home's copy before every read and push ours after every
  // write. On home both are no-ops. (lock.js explains why the copy call
  // lives here and not there.)
  setLockTransport({
    pull: (ns) => {
      if (ns.getHostname() !== 'home') ns.scp(LOCK_FILE, ns.getHostname(), 'home')
    },
    push: (ns) => {
      if (ns.getHostname() !== 'home') ns.scp(LOCK_FILE, 'home', ns.getHostname())
    },
  })

  const flags = ns.flags([
    ['reserve', 1e12],
    ['dry', false],
    ['max', 40],
    ['watch', false],
    ['interval', 60000],
  ])
  ns.disableLog('ALL')

  if (!flags.watch) return await once(ns, flags)

  // The tier boot.js planned against. Read from its telemetry rather than
  // recomputed, because the question is "does the running plan still match the
  // home it was planned for", and boot.js's own record is the only answer that
  // cannot disagree with boot.js.
  const plannedTier = () => {
    try {
      const d = JSON.parse(ns.read('/tel/boot.txt') || 'null')
      return typeof d?.tier === 'number' ? d.tier : null
    } catch {
      return null
    }
  }

  let bootRefused = 0

  for (;;) {
    await once(ns, flags)

    // Hand off. The watchdog runs this as a job with the same arithmetic, so a
    // resident copy past this point is pure overhead.
    if (ns.ps('home').some((p) => p.filename === 'watchdog.js')) {
      ns.tprint('homeup --watch: watchdog.js is up and owns this job now; retiring')
      return
    }

    // The re-entry. A plan made for 32GB is wrong the moment home is 64GB, and
    // nothing else re-runs the launcher at this tier.
    const planned = plannedTier()
    const home = ns.getServerMaxRam('home')
    if (planned !== null && home > planned) {
      ns.tprint(`homeup --watch: home ${home}GB has outgrown the tier ${planned}GB plan — re-running boot.js`)
      // exec, targeted at home, NOT spawn. spawn runs on the host this script
      // is on, and this script is deliberately placed OFF home (`where:
      // 'anywhere'`) so that an 8GB entry keeps all four worker slots. exec is
      // also 1.30GB against spawn's 2.00GB, and the reason to prefer spawn —
      // freeing this script's RAM before boot.js plans against it — does not
      // apply when the RAM being freed is not home's.
      const pid = ns.exec('boot.js', 'home', 1)
      if (pid) return

      // exec returns 0 on refusal rather than throwing, and this return value
      // used to be discarded — which made the failure both silent AND fatal,
      // because the line below it was an unconditional `return`.
      //
      // That is the fixed-point bug the manifest's `advances` field exists to
      // prevent, rebuilt one level up: the comment above says "nothing else
      // re-runs the launcher at this tier", so if this exec is refused and we
      // leave, home has grown and NOTHING will ever re-plan for it. The node
      // then earns money it cannot convert into capability, which is precisely
      // how BitNode 4 and BitNode 5 both came to need a human.
      //
      // It is reachable, not theoretical: the planner deliberately packs home
      // to ~100% (B2.4b), so whether boot.js's 6.40GB is free at this instant
      // depends on whether batch.js or watchdog.js claimed the newly bought RAM
      // first. Losing that race must cost one interval, not the rest of the
      // BitNode. So: stay in the loop and retry. The tier test above is still
      // true next pass, so the retry needs no extra state.
      bootRefused++
      ns.tprint(
        `WARN homeup --watch: boot.js exec refused on home (attempt ${bootRefused}) — ` +
          `home is ${home}GB but still running the tier ${planned}GB plan. Retrying in ${Math.round(flags.interval / 1000)}s.`,
      )
    }

    await ns.sleep(flags.interval)
  }
}

async function once(ns, flags) {

  const bought = []
  const notes = []
  const errors = []
  // True once a verdict has been published. Every path out of this script ends
  // in a report(), so the atExit below exists for the paths that do NOT get
  // there: killed mid-sequence at Alpha Enterprises, caught in a killall, or
  // destroyed by an install.
  let settled = false

  // One reporter for the whole run. `bought`, `notes` and `errors` ride on
  // every write via the thunk; `nextCost` is passed per call because it is the
  // one field the watchdog would act on and it must always be the caller's
  // current value, never a stale closure. Every existing field keeps its name.
  // `next` and `blockedByCity` are for act.js: the UI route below needs the
  // player in Sector-12, and when it is not, act.js performs the same
  // purchase through the Singularity actor instead (act-homeram.js).
  let blockedByCity = false
  let nextWanted = null
  const note = reporter(ns, STATUS, () => ({
    dry: flags.dry,
    reserve: flags.reserve,
    bought,
    notes,
    errors: errors.slice(-5),
    next: nextWanted,
    blockedByCity,
  }))

  // The path no try/finally can reach. ns.atExit costs 0GB and runs before the
  // worker is torn down (killWorkerScript.ts:64-84), so the write still lands.
  // The UI lock is already covered from the other end — lock.js's acquire()
  // registers its own release under the id 'ui-lock' — so this uses the
  // distinct id 'status' and reports only; both callbacks run
  // (NetscriptFunctions.ts:1395-1398).
  //
  // note.exit republishes the LAST body rather than a fresh one, which is what
  // keeps `nextCost` intact here. That matters more than it looks: C4 is the
  // invariant about this exact field, and a `nextCost` that disappears or reads
  // null means "home is fully upgraded" to anything that parses it.
  ns.atExit(() => {
    if (settled) return
    note.exit('stopped', { detail: 'homeup.js was killed before it finished spending — home RAM is the only permanent purchase' })
  }, 'status')

  // Work out what the next upgrade costs BEFORE going anywhere near the UI.
  // This used to be read off the Alpha Enterprises buttons at the end of the
  // run, which meant the only way to learn "we still cannot afford it" was to
  // take the global UI lock, walk to Sector-12 and yank the screen away from
  // whatever the player was doing — every 30 seconds, forever. It is a closed
  // form of (maxRam, cpuCores); see homecost.js.
  const next = nextHomeUpgrade(ns.getServerMaxRam('home'), ns.getServer('home').cpuCores)
  let nextCost = next ? next.cost : Infinity
  nextWanted = next ? { kind: next.kind, cost: next.cost } : null

  // Nothing affordable, so there is nothing the UI could tell us. Report and
  // leave without touching the screen or the lock.
  if (!next || ns.getServerMoneyAvailable('home') - next.cost < flags.reserve) {
    notes.push(
      next
        ? `waiting: next is ${next.kind} at $${ns.format.number(next.cost)}, have $${ns.format.number(ns.getServerMoneyAvailable('home'))} (reserve $${ns.format.number(flags.reserve)})`
        : 'home is fully upgraded (1PB / 8 cores)',
    )
    settled = true
    report(note, ns, next ? 'waiting' : 'ok', nextCost)
    return
  }

  if (!flags.dry && !(await acquire(ns, 'homeup'))) {
    ns.tprint('homeup: could not take the UI lock; another script is driving. Try later.')
    // This return published nothing, so a run blocked by another UI script was
    // indistinguishable from a run that never happened — and the file kept an
    // older `nextCost` with an older timestamp, which is the shape C4 is about.
    // nextCost is still the exact arithmetic computed above, so republishing it
    // here is a true statement, not a guess.
    notes.push('could not take the UI lock; another script is driving')
    settled = true
    report(note, ns, 'locked', nextCost)
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
      blockedByCity = true
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
    // `notes` keeps the message it always carried, so nothing that reads it
    // changes. The throw is also published from inside the catch, with a stack:
    // the report() below sits after the try, and a throw in the release/refocus
    // path between them would skip it — which is the exact shape status.js
    // exists to break (status.js:19-25).
    notes.push(String(err).slice(0, 200))
    try {
      const detail = record(errors, err)
      ns.print(`homeup error: ${detail}`)
      report(note, ns, 'error', nextCost, describe(err))
    } catch {
      /* nothing left to try */
    }
  }

  settled = true
  report(note, ns, bought.length ? 'ok' : 'waiting', nextCost)

  if (!flags.dry) {
    release(ns)
    const focus = byText('button', 'Focus')
    if (focus) focus.click()
  }
  if (bought.length) ns.tprint(`homeup: ${bought.length} upgrade(s) — ${notes.join('; ')}`)
  else ns.tprint(`homeup: nothing bought — ${notes.join('; ')}`)
}

/**
 * Publish state. Called on every exit path, including the early ones and the
 * catch — anything that returns without writing leaves the file reading a
 * stale figure with a stale timestamp, which looks exactly like a fresh one.
 *
 * `dry`, `reserve`, `bought` and `notes` come from the reporter's base thunk so
 * they are on every write including the atExit one; `money` and `nextCost` are
 * passed here because they are read from live state at write time.
 * Field names and meanings are unchanged — `health` and `detail` are additive.
 */
function report(note, ns, health, nextCost, detail) {
  note(health, {
    money: Math.round(ns.getServerMoneyAvailable('home')),
    // Cost of the cheapest remaining upgrade. null means genuinely maxed
    // out (1PB RAM and 8 cores) — never "we could not read the page".
    nextCost: Number.isFinite(nextCost) ? Math.round(nextCost) : null,
    ...(detail === undefined ? {} : { detail }),
  })
}

/** Parse the trailing "- $316.788b" off an upgrade button's label. */
function priceOf(btn) {
  const m = (btn.textContent || '').match(/\$([\d.]+)([kmbtqQ]?)/)
  if (!m) return Infinity
  const mult = { '': 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12, q: 1e15, Q: 1e18 }[m[2]] ?? 1
  return parseFloat(m[1]) * mult
}
