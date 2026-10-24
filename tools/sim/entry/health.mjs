// NEXT NODE ENTRY UNPRICED — the healthcheck's reading of .telemetry/entry-dryrun.json (written by
// tools/plan-on-node.sh after plan.mjs names the next node): pure, so tools/test/entrydryrun.test.mjs can
// watch every branch go red. CALIBRATION: none needed — a reader of a published record, no model.
//
//   entryHealthOf({ dry, next, node, now }) -> { fail: {what, detail} | null, note: string | null }
//
//   dry   the parsed entry-dryrun.json (null: absent or unreadable)
//   next  the parsed next-node.txt ({next, level, label, from, at}) — the node the exit will enter
//   node  the BitNode in progress
// A dry-run of ANOTHER next node, or from another node, is not this exit's: stale, never a pass. Absent
// or stale is a failure once the plan has had DRYRUN_GRACE_MIN to run it ("could not tell" is not "fine").

/** plan.mjs (~30 min) then the dry-run (~5 min per node) run on the node change; past this, no dry-run is a fault. */
export const DRYRUN_GRACE_MIN = 120

export function entryHealthOf({ dry, next, node, now = Date.now() }) {
  if (!next || !Number.isInteger(next.next)) return { fail: null, note: 'no next-node.txt: the next node is not planned, nothing to dry-run' }
  const label = next.label ?? `BN${next.next}.${next.level}`
  const nextAgeMin = (now - Date.parse(next.at ?? '')) / 60e3
  const graceOver = !(nextAgeMin < DRYRUN_GRACE_MIN)
  const mine = dry && dry.from === node && dry.next?.label === label
  if (!mine) {
    const why = !dry ? '.telemetry/entry-dryrun.json is absent or unreadable' : `the dry-run on file is of ${dry.next?.label ?? '?'} from BN${dry.from ?? '?'} (${dry.at ?? '?'}), not ${label} from BN${node}`
    return graceOver ? { fail: { what: `NEXT NODE ENTRY NOT DRY-RUN: ${label}`, detail: `${why} — tools/plan-on-node.sh runs tools/sim/entry/dryrun.mjs after the plan; run it by hand: node tools/sim/entry/dryrun.mjs --chain ${next.next}.${next.level} --summary .telemetry/entry-dryrun.json` }, note: null } : { fail: null, note: `${label}: entry dry-run pending (${why})` }
  }
  const n = (dry.nodes ?? []).find((x) => x.label === label)
  if (!n) return { fail: { what: `NEXT NODE ENTRY NOT DRY-RUN: ${label}`, detail: `entry-dryrun.json (${dry.at}) has no record of ${label}` }, note: null }
  if (!n.ok || n.problems?.length) return { fail: { what: `NEXT NODE ENTRY UNPRICED: ${label}`, detail: `${(n.problems ?? ['not ok, no problem named']).slice(0, 4).join(' | ').slice(0, 600)} (tools/sim/entry/dryrun.mjs, ${dry.at})` }, note: null }
  return { fail: null, note: `${label}: the entry dry-run (${dry.at}) priced every decision` }
}
