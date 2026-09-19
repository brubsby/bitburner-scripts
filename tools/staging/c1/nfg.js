// Converts money into NeuroFlux Governor levels, via faction donations.
//
//   run nfg.js                 buy as many levels as money allows
//   run nfg.js --reserve 5e12  keep this much back
//   run nfg.js --max 5         stop after N levels
//
// ---------------------------------------------------------------------------
// Why this is the endgame engine.
//
// Leaving BitNode 1 needs Daedalus: 30 distinct augmentations (done), $100b
// (trivial), and **hacking level 2500**. Hacking level is
// `mult * (32*ln(exp+534.6) - 200)` — logarithmic in experience and *linear* in
// the multiplier — so grinding experience cannot get there (it would take ~1e18
// exp at our multiplier) while raising the multiplier can. We need hacking mult
// ~4.095 and have ~3.2.
//
// NeuroFlux Governor is +1% to *every* multiplier per level, stacks
// multiplicatively, is sold by every faction, and has no level cap
// (Augmentations.ts:1159-1186). So the whole endgame reduces to "buy ~26 more
// NFG levels", and each level costs 1.14x the reputation of the last.
//
// Reputation is the scarce side — except that above 150 favor it can simply be
// bought: `repFromDonation = amount / 1e6 * faction_rep * FactionWorkRepGain`
// (Faction/formulas/donation.ts:8-10). At ~$100b/s of income that turns the
// remaining multiplier into a purchase rather than a grind.
//
// Deliberately over-donates. The amount needed is computed assuming
// faction_rep = 1, so a higher multiplier (ours is ~1.33 from the Go bonus)
// yields more reputation than asked for. That is not waste: surplus reputation
// goes straight into the next level's requirement, which is 14% higher.
//
// No Source-File needed — ns.singularity.donateToFaction is SF4-gated, but the
// donation box is an ordinary MUI input, so this drives it the same way the
// rest of the repo drives the game (see CLAUDE.md).

import { acquire, release } from 'lock.js'
// Free to import: status.js references only ns.write (0GB). See its header.
import { reporter, describe, record } from 'status.js'

const doc = eval('document')
const win = eval('window')
const STATUS = '/tel/nfg.txt'
const MIN_FAVOR = 150

const vis = (sel) => [...doc.querySelectorAll(sel)].filter((e) => e.offsetParent !== null)
const byText = (sel, text) => vis(sel).find((e) => e.textContent && e.textContent.trim() === text)
const clickNav = (name) => {
  const el = vis('p,span,div').find((e) => e.textContent.trim() === name)
  if (!el) return false
  ;(el.closest('.MuiListItemButton-root,[role=button],li,button') || el).click()
  return true
}

/** Parse "399.133k" / "$1.234b" style figures the UI renders. */
function parseNum(s) {
  const m = String(s).match(/([\d.]+)\s*([kmbtq])?/i)
  if (!m) return NaN
  const mult = { k: 1e3, m: 1e6, b: 1e9, t: 1e12, q: 1e15 }[(m[2] || '').toLowerCase()] ?? 1
  return parseFloat(m[1]) * mult
}

/** Type into a React controlled input the way a human would. */
function setInput(el, value) {
  const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set
  setter.call(el, String(value))
  el.dispatchEvent(new win.Event('input', { bubbles: true }))
}

const nfgCard = () =>
  vis('button')
    .filter((b) => b.textContent.trim() === 'Buy')
    .map((b) => ({ btn: b, paper: b.closest('.MuiPaper-root') }))
    .find((c) => c.paper && c.paper.textContent.includes('NeuroFlux Governor'))

export async function main(ns) {
  const flags = ns.flags([
    ['reserve', 2e12],
    ['max', 50],
    ['faction', ''],
  ])
  ns.disableLog('ALL')
  const log = []
  // Cost of the next level in dollars of donation; the watchdog gates the next
  // run on it so this does not relaunch every 30s to rediscover it cannot
  // afford anything. NFG reputation cost rises 1.14x per level, so a flat
  // money threshold goes stale within a handful of purchases.
  let nextCost = null
  const errors = []
  // `nextCost` and `log` ride on every write, so the error and exit paths keep
  // the one field the watchdog acts on. Field names are unchanged — `result`,
  // `detail`, `nextCost` and `log` all keep their exact spellings; `health`
  // (the uniform one-glance word) and `errors` are additive.
  const note = reporter(ns, STATUS, () => ({ nextCost, log, errors: errors.slice(-5) }))
  // True once a terminal verdict is out. Every call below is terminal — this
  // script reports once and returns — so while the buy loop is running this is
  // false, which is exactly the window in which being killed must be recorded.
  let settled = false
  // Keeps the existing (result, detail) call signature, so no call site moved.
  const say = (r, d) => {
    settled = true
    return note(r, { result: r, detail: d })
  }

  // The path no try/finally can reach: the watchdog killing this mid-purchase
  // is not hypothetical — it is the entry the header calls out as "the one that
  // was killed mid-purchase", and a kill between `donate` and the augmentation
  // click spends the money and buys nothing. ns.atExit costs 0GB and runs
  // before the worker is torn down (killWorkerScript.ts:64-84).
  //
  // The UI lock is already covered from the other end: lock.js's acquire()
  // registers its own release under the id 'ui-lock'. This one uses the
  // distinct id 'status' and reports only, so both run
  // (NetscriptFunctions.ts:1395-1398) and neither replaces the other.
  //
  // Publishing `nextCost` matters here specifically. watchdog.js's trigger for
  // this entry reads it out of /tel/nfg.txt and falls back to a flat
  // `money > 1e12` when it is missing — a constant that is permanently true at
  // this income, which produced 82 relaunches in half an hour. note.exit
  // republishes the last body, so whatever nextCost was known survives the kill
  // instead of degrading the gate to that constant.
  ns.atExit(() => {
    if (settled) return
    note.exit('stopped', {
      result: 'stopped',
      detail: 'nfg.js was killed mid-run — a donation may have been made without the level being bought',
    })
  }, 'status')

  if (!(await acquire(ns, 'nfg'))) {
    say('error', 'could not take the UI lock')
    return
  }

  try {
    const aside = byText('button', 'Do something else simultaneously')
    if (aside) {
      aside.click()
      await ns.sleep(900)
    }
    clickNav('Factions')
    await ns.sleep(1500)

    // Pick the highest-favor faction that can accept donations. Favor is shown
    // on the faction list; any faction sells NeuroFlux, so the only thing that
    // matters is which one will take our money.
    const dets = vis('button').filter((b) => b.textContent.trim() === 'Details')
    let best = { idx: -1, favor: 0, name: '' }
    dets.forEach((b, i) => {
      const card = b.closest('.MuiPaper-root')
      const txt = (card?.textContent || '').replace(/\s+/g, ' ')
      const fav = parseNum((txt.match(/([\d.,]+)\s*favor/) || [])[1])
      const name = (txt.match(/BitRunners|The Black Hand|NiteSec|Sector-12|CyberSec|Netburners|Tian Di Hui/) || [])[0] || '?'
      if (flags.faction ? name === flags.faction : fav > best.favor) best = { idx: i, favor: fav, name }
    })
    if (best.idx < 0 || best.favor < MIN_FAVOR) {
      say('error', `no faction at ${MIN_FAVOR}+ favor (best: ${best.name} ${best.favor})`)
      return
    }
    log.push(`using ${best.name} (${best.favor} favor)`)

    // Open its augmentation page; the donation box lives on Details, so we
    // bounce between the two.
    for (let bought = 0; bought < flags.max; bought++) {
      // --- try to buy ---------------------------------------------------
      vis('button').filter((b) => b.textContent.trim() === 'Augments')[best.idx]?.click()
      await ns.sleep(1500)

      const card = nfgCard()
      if (!card) {
        log.push('no NeuroFlux card on this faction')
        break
      }
      const cardText = (card.paper.textContent || '').replace(/\s+/g, ' ')
      const level = (cardText.match(/Level (\d+)/) || [])[1]

      if (!card.btn.disabled) {
        card.btn.click()
        await ns.sleep(800)
        const c = [...doc.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Purchase')
        if (c.length === 1) {
          c[0].click()
          await ns.sleep(1000)
        }
        log.push(`bought L${level}`)
        continue
      }

      // --- disabled: work out whether it is reputation or money ----------
      const needRep = parseNum((cardText.match(/([\d.,]+[kmb]?)\s*rep/) || [])[1])
      const haveRep = parseNum((doc.body.innerText.match(/Reputation:\s*\n*\s*([\d.,kmb]+)/i) || [])[1])
      const money = ns.getServerMoneyAvailable('home')
      const shortfall = needRep - haveRep

      if (!(shortfall > 0)) {
        // Reputation is fine, so the block is the augmentation's own price —
        // which is separate from the donation and rises 1.9x per already-queued
        // aug on top of NFG's own 1.14x per level. Publish it so the watchdog
        // waits for that figure instead of relaunching on a flat threshold.
        const price = parseNum((cardText.match(/\$([\d.,]+[kmbtq]?)/) || [])[1])
        nextCost = Number.isFinite(price) ? Math.round(price + flags.reserve) : null
        log.push(
          `L${level}: rep OK (${Math.round(haveRep)}/${Math.round(needRep)}) but price $${Math.round(price / 1e9)}b > money $${Math.round(money / 1e9)}b`,
        )
        break
      }

      // faction_rep >= 1 always, so this is an upper bound on what is needed.
      const cost = shortfall * 1e6
      if (money - cost < flags.reserve) {
        nextCost = Math.round(cost + flags.reserve)
        log.push(`stop: L${level} needs ${Math.round(shortfall)} rep = $${Math.round(cost / 1e9)}b, have $${Math.round(money / 1e9)}b`)
        break
      }

      // --- donate --------------------------------------------------------
      // Back to the faction list FIRST. We are currently on the augmentation
      // page, which has no Details buttons at all — so clicking "Details" here
      // silently does nothing, and the donation box is then looked for on a
      // page that cannot contain it. That produced "donation input not found"
      // while sitting on 183 favor and $652t, which reads like a favor problem
      // and is really a navigation one.
      byText('button', 'Back')?.click()
      await ns.sleep(1100)
      vis('button').filter((b) => b.textContent.trim() === 'Details')[best.idx]?.click()
      await ns.sleep(1400)
      const input = vis('input').find((e) => (e.placeholder || '').toLowerCase().includes('donation'))
      if (!input) {
        log.push('donation input not found — is favor >= 150 on this faction?')
        break
      }
      setInput(input, Math.ceil(cost))
      await ns.sleep(500)
      const donateBtn = vis('button').find((b) => b.textContent.trim().toLowerCase() === 'donate')
      if (!donateBtn || donateBtn.disabled) {
        log.push('donate button unavailable')
        break
      }
      donateBtn.click()
      await ns.sleep(1200)
      // The game pops a dialog confirming the gain; dismiss it.
      for (let i = 0; i < 6; i++) {
        const close = vis('[aria-label*=close],[aria-label*=Close]')[0] || byText('button', 'OK')
        if (!close) break
        close.click()
        await ns.sleep(250)
      }
      log.push(`donated $${Math.round(cost / 1e9)}b for ~${Math.round(shortfall)} rep`)
      // Return to the faction list so the next pass can click Augments again.
      byText('button', 'Back')?.click()
      await ns.sleep(1000)
    }

    say('ok', log[log.length - 1] ?? 'nothing to do')
  } catch (err) {
    // Already published from the catch before this change, which is why C1
    // scored this file catch-publishes=y. What it gains is the stack (a bare
    // String(err) names the error and never its site) and the rolling tail, so
    // a throw that happens once an hour is not erased by the next healthy run.
    try {
      const detail = record(errors, err)
      ns.print(`nfg error: ${detail}`)
      say('error', describe(err))
    } catch {
      /* nothing left to try */
    }
  } finally {
    release(ns)
    const focus = byText('button', 'Focus')
    if (focus) focus.click()
  }

  ns.tprint(`nfg: ${log.join(' | ')}`)
}
