// Phase 1 of the augmentation cycle: who sells what, and what we already have.
//
//   run sing-augsurvey.js --cycle <id>
//
// Writes /tel/sing-augsurvey.txt and exits. Launched by sing-aug.js; there is
// no reason to run it by hand except to look at the answer.
//
// ---------------------------------------------------------------------------
// Why this is its own script.
//
// Netscript charges RAM statically for every ns function named anywhere in a
// script's import graph, whether or not the call is reachable, so a single
// "buy augmentations" script that surveyed, priced, purchased and installed
// would reference getOwnedAugmentations (5) + getAugmentationsFromFaction (5) +
// getAugmentationPrice (2.5) + getAugmentationRepReq (2.5) + getFactionRep (1) +
// purchaseAugmentation (5) + installAugmentations (5) + getPlayer (0.5) + the
// 1.6 base = **28.1GB**, on a 32GB home that must keep batch.js (11.2GB)
// running. It would not start, ever.
//
// The split is by *which calls have to be atomic with each other*:
//
//   sing-augsurvey.js   12.1GB   the catalogue: what is on offer, what is owned
//   sing-augbuy.js      12.7GB   price it, plan it, buy it — one script, because
//                                a price read in one process and spent in
//                                another is a price that can move in between
//   sing-install.js     14.45GB  spend the last dollar on home, then install
//   sing-aug.js          3.1GB   the director that runs those in order
//
// Nothing here is atomic with anything: a catalogue is a slow-moving fact.
// Factions do not stop selling an augmentation, and the one thing that DOES
// change under us — reputation, prices — is read in the buy phase where it is
// spent. See NOTES-shop.md for the full RAM table.
// ---------------------------------------------------------------------------

// Free to import: neither references an ns function beyond the script base.
import { reporter, describe, record } from 'status.js'
import { NFG, isSoa } from 'augplan.js'

const STATUS = '/tel/sing-augsurvey.txt'

export async function main(ns) {
  const flags = ns.flags([
    // Stamped into the output so the buy phase cannot act on a survey from a
    // previous cycle. The cmd.js bridge taught this one the hard way: between
    // writing a request and its pickup there is a window in which the previous
    // run's complete, well-formed output is sitting there with nothing to
    // distinguish it from yours.
    ['cycle', ''],
  ])
  ns.disableLog('ALL')

  const errors = []
  const note = reporter(ns, STATUS, () => ({ cycle: flags.cycle, errors: errors.slice(-5) }))
  let settled = false
  ns.atExit(() => {
    if (!settled) note.exit('stopped', { detail: 'sing-augsurvey.js exited without reporting' })
  })

  try {
    const sing = ns.singularity

    // Joined factions only. getAugmentationsFromFaction answers for any faction
    // (Singularity.ts:128-134), but checkIfPlayerCanPurchaseAugmentation rejects
    // anything from a faction we are not a member of (FactionHelpers.tsx:61-66),
    // so a wider survey would only produce a plan that cannot be executed.
    //
    // ns.getPlayer() is 0.5GB (SingularityFn1/4). Note it does NOT expose
    // queuedAugmentations — augbuy.js once checked queue length across a
    // purchase and read `undefined` on both sides, reporting failure on every
    // success. The queue is derived below from getOwnedAugmentations instead.
    const factions = ns.getPlayer().factions || []

    // Two calls, and the difference between them IS the queue.
    //   getOwnedAugmentations(false) -> installed only
    //   getOwnedAugmentations(true)  -> installed + queued  (Singularity.ts:79-92)
    // NeuroFlux appears ONCE in the installed list with its level baked into the
    // player object, and ONCE PER QUEUED LEVEL in the queued part — which is
    // exactly what makes it the repeatable one, so the difference has to be
    // taken as a multiset, not a set.
    const installed = sing.getOwnedAugmentations(false)
    const withQueued = sing.getOwnedAugmentations(true)

    const tally = (list) => {
      const counts = {}
      for (const name of list) counts[name] = (counts[name] || 0) + 1
      return counts
    }
    const installedCounts = tally(installed)
    const allCounts = tally(withQueued)
    const queued = {}
    for (const name of Object.keys(allCounts)) {
      const n = allCounts[name] - (installedCounts[name] || 0)
      if (n > 0) queued[name] = n
    }

    // The 1.9 exponent every money price already carries.
    //
    // getGenericAugmentationPriceMultiplier (AugmentationHelpers.ts:32-37)
    // counts queued augmentations EXCLUDING the nine SoA ones. Recorded for the
    // status file and for sanity-checking the plan; the buy phase does not need
    // it, because ns.singularity.getAugmentationPrice has already applied it.
    let queuedNonSoa = 0
    for (const name of Object.keys(queued)) {
      if (!isSoa(name)) queuedNonSoa += queued[name]
    }

    // What each faction sells. getFactionAugmentationsFiltered
    // (FactionHelpers.tsx:169+) is what this returns, so a gang faction's
    // expanded list is already handled by the game.
    const offers = {}
    const sellers = {}
    for (const faction of factions) {
      const list = sing.getAugmentationsFromFaction(faction)
      offers[faction] = list
      for (const name of list) {
        if (!sellers[name]) sellers[name] = []
        sellers[name].push(faction)
      }
      await ns.sleep(0)
    }

    // Candidates: anything we could still buy this cycle.
    //
    // Installed or already queued means checkIfPlayerCanPurchaseAugmentation
    // will refuse (FactionHelpers.tsx:75-86) — EXCEPT for NeuroFlux, which is
    // the one augmentation exempted from that check by name and is therefore
    // always a candidate however many levels are already queued.
    const candidates = []
    for (const name of Object.keys(sellers)) {
      if (name === NFG) continue
      if (installedCounts[name]) continue
      if (queued[name]) continue
      candidates.push({ name, sellers: sellers[name] })
    }
    // Deterministic output, so a diff between two surveys means something moved
    // in the game rather than in an object key order.
    candidates.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

    settled = true
    note('ok', {
      result: 'ok',
      factions,
      offers,
      installed: installed.slice().sort(),
      queued,
      queuedNonSoa,
      nfgSellers: sellers[NFG] || [],
      candidates,
      detail: `${factions.length} faction(s), ${candidates.length} candidate(s), ${queuedNonSoa} non-SoA already queued`,
    })
  } catch (err) {
    settled = true
    try {
      ns.print(`sing-augsurvey error: ${record(errors, err)}`)
      note('error', { result: 'error', detail: describe(err) })
    } catch {
      /* nothing left to try */
    }
  }
}
