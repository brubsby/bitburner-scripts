// Keeps the player at full HP by hospitalising whenever health drops.
//
// STAGED REWRITE — the only change from the shipped healer.js is HOW ITS RAM IS
// DECLARED. The hospitalise logic is byte-identical and its existing defect is
// left alone (see "Known defect" below), because fixing that is a separate job.
//
// ---------------------------------------------------------------------------
// RAMOVERRIDE 2.6GB — excludes: ns.singularity.hospitalize (0.5GB at base price,
// 8GB at the 16x SF4.1 rate) and ns.getPlayer (0.5GB), neither of which is
// called until the Source-File 4 gate below has passed and the allocation has
// been raised to cover them.
//
// The shipped file costs 2.60GB inside BitNode 4 and 10.10GB anywhere else,
// because `ns.singularity.*` is billed statically whether or not it is reachable
// (RamCalculations.ts:407 prices identifiers, not reachability) and outside BN4
// every Singularity call costs 16x at SF4 level 1 (RamCostGenerator.ts:82-96).
// Referencing the API is free of consequence — only CALLING it throws — so the
// script may carry the reference, declare 2.6GB, refuse to act when the gate
// says it cannot, and be correct.
//
// 2.6 = RamCostConstants.Base (1.6) + ns.getResetInfo (1.0). That is everything
// this script calls before it decides whether it may proceed: sfgate.js is pure,
// status.js touches only ns.write (0GB), ns.atExit and ns.tprint are 0GB.
//
// Registered in tools/sim/bncheck.mjs STRUCTURAL; asserted by
// tools/test/ramoverride.test.mjs [R1..R5], which prices this file with the
// game's own calculator in four regimes and fails if the override is ignored.
// ---------------------------------------------------------------------------
//
// Known defect, deliberately NOT fixed here: `ns.getPlayer().hp` is an object
// ({current, max}), so `hp < max_hp` compares an object with undefined and is
// always false — the loop runs forever and never heals after the opening call
// (docs/game-knowledge.md §1). This rewrite changes RAM declaration only.

import { canUseSingularity, singularityRamMultiplier } from 'sfgate.js'
import { reporter } from 'status.js'
import { raiseRam } from 'ramgrow.js'

const STATUS = '/tel/healer.txt'

/** What this file costs once every branch is live, per Singularity RAM multiplier.
 *  3.1 = base 1.6 + ns.getPlayer 0.5 + ns.getResetInfo 1.0 (none SF4-scaled);
 *  0.5 = ns.singularity.hospitalize at base price. Checked by [R5]. */
const RAISE_CEILING = (mult) => 3.1 + 0.5 * mult

export async function main(ns) {
  ns.ramOverride(2.6)

  const errors = []
  const note = reporter(ns, STATUS, () => ({ errors: errors.slice(-5) }))
  ns.atExit(() => note.exit('stopped', { detail: 'healer.js exited' }))

  // The gate asks the GAME, through the shared rules, rather than inferring
  // capability from a try/catch — RAM is billed before a line runs, so a
  // try/catch around `ns.singularity` is decoration (CLAUDE.md, "a guard that
  // can never fire"). invariant SF3: never open-code the rule.
  const info = ns.getResetInfo()
  if (!canUseSingularity(info)) {
    note('waiting', {
      result: 'no-singularity',
      detail:
        'ns.singularity.hospitalize needs Source-File 4 or BitNode 4. Nothing to do; ' +
        'heal by hand at the hospital (City tab). Staying at the 2.6GB floor.',
      bitNode: info.currentNode,
    })
    return
  }

  const want = RAISE_CEILING(singularityRamMultiplier(info))
  if (!raiseRam(ns, want, STATUS, 'healer.js needs its Singularity allocation')) return

  try {
    ns.singularity.hospitalize()
    note('ok', { result: 'healing', detail: `allocation raised to ${want}GB` })
    while (true) {
      if (ns.getPlayer().hp < ns.getPlayer().max_hp) {
        ns.singularity.hospitalize()
      }
      await ns.sleep(1000)
    }
  } catch (err) {
    errors.push(`${new Date().toISOString()} ${err}`)
    note('error', { result: 'error', detail: String(err) })
  }
}
