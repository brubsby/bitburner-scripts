// The dashboard's FAST LANE: headline numbers every couple of seconds.
//
//   run fast.js                 2s cadence
//   run fast.js --every 1000    faster
//
// Why this exists alongside the daemon's save poll.
//
// tools/dash.mjs gets its deep state by pulling the whole save through the RFA
// and decoding it. That save is ~1.1MB, so polling it every second would burn
// real CPU on the machine the GAME is running on, competing with the thing it
// is meant to be watching. But most of a dashboard's felt liveness comes from a
// handful of scalars — money, level, income — and those are cheap.
//
// So the split is: the daemon keeps its 30s full-save poll for everything
// deep and structural, and this writes a few hundred bytes of headline numbers
// on a 2s tick. dash.mjs reads this file far more often than it reads the save.
//
// RAM is the binding constraint on home, so this stays deliberately tiny: no
// ns.singularity, no formulas, no getServer on every host. Every call here is
// one of the cheap ones, and the file is small enough that reading it through
// the RFA costs nothing measurable.
//
// INCOME IS MEASURED, NOT MODELLED. `ns.getTotalScriptIncome()[0]` is the
// game's own running average of script money per second, and
// `getTotalScriptExpGain()` the same for experience. Both already exist; a
// dashboard that re-derived them from balance deltas would disagree with the
// game's own overview panel and be wrong more often.

import { reporter } from 'status.js'

const STATUS = '/tel/fast.txt'

export async function main(ns) {
  const flags = ns.flags([['every', 2000]])
  ns.disableLog('ALL')

  // Published even on the paths that would otherwise be silent, so a dead fast
  // lane is visible on the dashboard as staleness rather than as a frozen
  // number that looks alive.
  const note = reporter(ns, STATUS, {})
  ns.atExit(() => {
    note.exit('stopped', { detail: 'fast.js is no longer publishing — dashboard headline numbers are frozen' })
  }, 'status')

  for (;;) {
    const p = ns.getPlayer()
    const [scriptIncome] = ns.getTotalScriptIncome()

    note('ok', {
      // Wall clock, so the dashboard can show its own staleness rather than
      // trusting that a file on disk is current.
      now: Date.now(),
      money: p.money,
      hacking: p.skills.hacking,
      hackingExp: p.exp.hacking,
      // The game's own averages, not ours.
      scriptIncome,
      scriptExp: ns.getTotalScriptExpGain(),
      karma: p.karma,
      city: p.city,
      homeUsed: ns.getServerUsedRam('home'),
      homeMax: ns.getServerMaxRam('home'),
      // ps() on home only — enough to say "the stack is up" without walking
      // the whole network every two seconds.
      procs: ns.ps('home').length,
    })

    await ns.sleep(flags.every)
  }
}
