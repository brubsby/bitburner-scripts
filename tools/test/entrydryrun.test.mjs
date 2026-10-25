// [ED] NO NODE STARTS ON A HOLD OR BROKEN PRICING — the entry dry-run's detector (tools/sim/entry/).
//
// BN11.1 lost ~0.8h to a start-of-node gift pricing hold; BN10.3 ~5.5h to an absurd Covenant combat leg
// (1.4e16h), hack + gift unpriced outside BN13 and a 35x-low income model — each found live. The dry-run
// enters the next node from the live save by the game's own prestigeSourceFile and runs the stack's
// first minute and one planner pass against it (dryrun.mjs; minutes per node, so not in this suite);
// evaluate.mjs turns what was published into findings. These checks seed each defect into the records
// the BN5.2 dry-run published (fixture-entry-dryrun-bn5.json) and watch the detector go red.
//
//   ED1  the clean BN5.2 entry: no failure (the gift's gate refusing before the accept is a note)
//   ED2  each seeded defect is named, with its decision and cause: a route arm unpriced (BN10.3's hack
//        arm), the gift held open on an unpriced chain (BN11.1) and act.js's gate refusing on it, an
//        absurd leg (1.4e16h), the Covenant mandate unpriced, a non-finite hour, the install gate's
//        joinClaim null, the planner refusing its pass (snapshots-missing), a route held over an
//        unpriced arm, the slot unowned on an unpriced exit, endgame blocked / an /endgame-hold.txt
//        surviving the entry, no planner pass of this life
//   ED3  the healthcheck reading (health.mjs): NEXT NODE ENTRY UNPRICED on a failing dry-run of the
//        planned next node; NOT DRY-RUN when absent / another node's / from another node past the
//        grace; a note (no failure) inside the grace and on a clean dry-run
//   ED4  chain extras: each entry carries the earlier entries' Source-Files and SF N at L-1
//   ED5  the accept re-priced one pass after it (evaluate.acceptConsistencyOf): worse than declining
//        fails (BN2.2 measured), a +30% re-price notes, an agreeing one is silent
//   ED7  the published exit is the acted route's (evaluate.exitOffRouteOf): BN15.1's hacking distribution
//        published as "the Bladeburner route" beside a 147.9h black-op point fails OFF ROUTE
import './gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { Check } from './harness.mjs'
import { REPO_ROOT } from './gameresolve.mjs'

const { evaluate, ABSURD_H, acceptConsistencyOf, hourFieldsOf, exitOffRouteOf } = await import('../sim/entry/evaluate.mjs')
const { entryHealthOf, DRYRUN_GRACE_MIN } = await import('../sim/entry/health.mjs')
const { chainExtras, parseChain } = await import('../sim/entry/dryrun.mjs')

const FX = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-entry-dryrun-bn5.json'), 'utf8'))
const clone = (x) => JSON.parse(JSON.stringify(x))
const infoOf = (i) => ({ ...i, ownedAugs: new Map(i.ownedAugs), ownedSF: new Map(i.ownedSF) })
const now = Date.parse(FX.now)

function evalOf(mut = null, { canCotMG = true, info = null, extraFiles = {} } = {}) {
  const files = { ...clone(FX.files), ...extraFiles }
  if (mut) mut(files)
  const read = (f, raw = false) => {
    const v = files[f]
    if (v === undefined || v === null) return null
    return raw ? (typeof v === 'string' ? v : JSON.stringify(v)) : typeof v === 'string' ? null : v
  }
  return evaluate({ read, info: infoOf(info ?? FX.info), canCotMG, now })
}
const fails = (F) => F.filter((f) => f.level === 'fail')
const has = (F, kind, decision, re = null) => fails(F).some((f) => f.kind === kind && f.decision === decision && (!re || re.test(`${f.what} ${f.cause ?? ''}`)))

export async function run() {
  const out = []

  const c1 = new Check('ED1', 'the clean BN5.2 entry (the dry-run as published): no failure')
  {
    const F = evalOf()
    c1.examined(1)
    if (fails(F).length) c1.fail('the clean entry reports failures', JSON.stringify(fails(F)).slice(0, 600))
    c1.note(`notes: ${F.filter((f) => f.level === 'note').map((f) => `${f.kind} ${f.decision}`).join('; ') || 'none'}`)
  }
  out.push(c1)

  const c2 = new Check('ED2', 'every seeded unpriced / held / absurd / blocked decision is named with its cause')
  const cases = [
    ['route arm unpriced (BN10.3 hack arm)', (f) => {
      const br = f['/tel/plan.txt'].decisions.bladeRoute
      br.unpriced = ['hack']
      br.hackH = null
      br.key = null
      br.why = 'UNPRICED hack arm (point hack null): no route decided'
    }, (F) => has(F, 'UNPRICED', 'route', /hack/)],
    ['gift held open on an unpriced chain (BN11.1)', (f) => {
      f['/tel/progress.txt'].route.gift.accept = null
      f['/tel/progress.txt'].route.gift.why = 'the gift is acceptable but the hacking arm could not be priced with it'
    }, (F) => has(F, 'HELD', 'gift', /pricing hold|held open/i) && has(F, 'BLOCKED', 'act.js gate (buyaug)', /PRICING HOLD/) && has(F, 'BLOCKED', 'act.js gate (install)')],
    ['gift declined with no price (BN8.2: no route decision to chain it to)', (f) => {
      f['/tel/progress.txt'].route.gift = { accepted: false, chain: false, accept: null, why: 'BitNode 8: not wanted: the Bladeburner route with the gift is not priced for this node/SF13/SF7' }
      f['/tel/progress.txt'].route.route = 'hack'
    }, (F) => has(F, 'UNPRICED', 'gift', /declined without being priced/)],
    ['chain gift unpriced in the route decision', (f) => {
      f['/tel/plan.txt'].decisions.bladeRoute.gift = { priced: false, chain: true, why: 'the gift is acceptable but the hacking arm could not be priced with it' }
    }, (F) => has(F, 'UNPRICED', 'route+gift')],
    ['an absurd leg (1.4e16h, BN10.3 Covenant combat)', (f) => {
      f['/tel/plan.txt'].decisions.bladeRoute.mandate = { priced: true, combat: { hours: 13674747338185746 }, why: 'MANDATED' }
    }, (F) => has(F, 'ABSURD', 'decisions.bladeRoute', /13674747338185746/)],
    ['the exit absurd', (f) => {
      f['/tel/plan.txt'].exit.meanH = ABSURD_H * 3
    }, (F) => has(F, 'ABSURD', 'exit')],
    ['the exit unpriced', (f) => {
      f['/tel/plan.txt'].exit = { meanH: null, source: 'no trajectory' }
    }, (F) => has(F, 'UNPRICED', 'exit')],
    ['the Covenant mandate unpriced', (f) => {
      f['/tel/plan.txt'].decisions.bladeRoute.mandate = { priced: false, unpriced: true, why: "the Covenant mandate binds (sleeve #6 of 8) but its combat legs are unpriced: ABSURD" }
    }, (F) => has(F, 'UNPRICED', 'mandate', /combat legs/)],
    ['a non-finite hour', (f) => {
      f['/tel/plan.txt'].decisions.stanek.withH = 'NaN'
    }, (F) => has(F, 'ABSURD', 'decisions.stanek', /NaN/)],
    ['the install gate joinClaim null', (f) => {
      f['/tel/installgate.txt'].joinClaim = null
    }, (F) => has(F, 'BLOCKED', 'install gate', /joinClaim/)],
    ['the planner refused its pass', (f) => {
      f['/tel/progress.txt'].result = 'snapshots-missing'
      f['/tel/progress.txt'].detail = 'owned: /tel/snap-owned.txt missing'
    }, (F) => has(F, 'BLOCKED', 'progress.js', /snapshots-missing/)],
    ['the route held over an unpriced arm', (f) => {
      const br = f['/tel/plan.txt'].decisions.bladeRoute
      br.held = true
      br.unpriced = ['blade']
      br.why = 'UNPRICED blade arm: held on hack'
    }, (F) => has(F, 'HELD', 'route')],
    ['the slot unowned on an unpriced exit', (f) => {
      f['/tel/progress.txt'].slot = { owner: null, why: 'an exit could not be priced — faction work keeps the slot' }
    }, (F) => has(F, 'UNPRICED', 'slot')],
    ['endgame blocked', (f) => {
      f['/tel/endgame.txt'].result = 'blocked'
      f['/tel/endgame.txt'].detail = '--next 5 would replay BitNode 5'
    }, (F) => has(F, 'BLOCKED', 'endgame')],
    ['an /endgame-hold.txt surviving the entry', (f) => {
      f['/endgame-hold.txt'] = 'user: choosing the next node'
    }, (F) => has(F, 'HELD', 'endgame', /choosing/)],
    ['no planner pass of this life', (f) => {
      f['/tel/progress.txt'].at = '2026-10-20T00:00:00.000Z'
    }, (F) => has(F, 'NOT RUN', 'progress.js')],
  ]
  for (const [what, mut, ok] of cases) {
    c2.examined(1)
    const F = evalOf(mut)
    if (!ok(F)) c2.fail(`not detected: ${what}`, JSON.stringify(fails(F).map((f) => `${f.kind} ${f.decision}: ${f.what}`)).slice(0, 400))
  }
  // a hold where the Church is not here is no hold; a held route priced on both arms is the commitment rule, not a hold
  {
    c2.examined(2)
    const F = evalOf((f) => { f['/tel/progress.txt'].route.gift.accept = null }, { canCotMG: false })
    if (has(F, 'HELD', 'gift')) c2.fail('a gift hold reported where the gift is not accessible')
    const G = evalOf((f) => { f['/tel/plan.txt'].decisions.bladeRoute.held = true; f['/tel/plan.txt'].decisions.bladeRoute.why = 'held (no event since ...)' })
    if (has(G, 'HELD', 'route')) c2.fail('the commitment rule holding a priced route reported as a hold')
    c2.examined(1)
    const H = evalOf((f) => { f['/tel/progress.txt'].route.gift = { accepted: false, chain: true, accept: false, why: 'priced: NOT accepted (the chosen arm is faster without it)' } })
    if (has(H, 'UNPRICED', 'gift')) c2.fail('a PRICED decline (the chain, accept false) reported as unpriced')
  }
  out.push(c2)

  const c5 = new Check('ED5', 'the accept re-priced one pass later: a flip below declining fails (BN2.2: 16.2h -> 23.3h vs 20.9h declining)')
  {
    // the BN2.2 dry-run's two passes (tools/sim/entry/dryrun.mjs phases entry / accepted), trimmed
    const entry = { key: 'hack', hackH: 16.227, bladeH: 11.613, gift: { chain: true, accept: true, why: null, hack: { options: [{ withGift: false, hours: 20.919 }, { withGift: true, hours: 17.31 }, { withGift: true, hours: 16.227 }] }, blade: { options: [{ withGift: false, hours: 17.848 }, { withGift: true, hours: 11.613 }] } } }
    const rows = [
      ['BN2.2 as measured', { key: 'hack', hackH: 23.264, bladeH: 15.738 }, 'fail'],
      ['re-priced +26%, still below declining (20.9h)', { key: 'hack', hackH: 20.5, bladeH: 15 }, 'note'],
      ['re-priced the same', { key: 'hack', hackH: 16.3, bladeH: 11.7 }, null],
    ]
    for (const [what, accepted, want] of rows) {
      c5.examined(1)
      const F = acceptConsistencyOf({ entry, accepted })
      const got = F.length ? F[0].level : null
      if (got !== want) c5.fail(`${what}: expected ${want ?? 'nothing'}, got ${got ?? 'nothing'}`, JSON.stringify(F))
    }
    c5.examined(1)
    if (acceptConsistencyOf({ entry: { ...entry, gift: { ...entry.gift, accept: null } }, accepted: rows[0][1] }).length) c5.fail('no accept, nothing to re-price — a finding was made')
  }
  out.push(c5)

  const c3 = new Check('ED3', 'healthcheck: NEXT NODE ENTRY UNPRICED / NOT DRY-RUN, never silent')
  {
    const next = { next: 5, level: 2, label: 'BN5.2', from: 13, at: new Date(now - 3 * 3600e3).toISOString() }
    const dry = (ok, extra = {}) => ({ at: new Date(now).toISOString(), ok, from: 13, next: { label: 'BN5.2' }, nodes: [{ label: 'BN5.2', ok, problems: ok ? [] : ['HELD gift: Stanek\'s Gift is held open (a pricing hold)'] }], ...extra })
    const rows = [
      ['failing dry-run', entryHealthOf({ dry: dry(false), next, node: 13, now }), /NEXT NODE ENTRY UNPRICED: BN5.2/],
      ['absent past the grace', entryHealthOf({ dry: null, next, node: 13, now }), /NOT DRY-RUN/],
      ['another next node', entryHealthOf({ dry: dry(true, { next: { label: 'BN8.2' } }), next, node: 13, now }), /NOT DRY-RUN/],
      ['from another node', entryHealthOf({ dry: dry(true, { from: 11 }), next, node: 13, now }), /NOT DRY-RUN/],
    ]
    for (const [what, r, re] of rows) {
      c3.examined(1)
      if (!r.fail || !re.test(r.fail.what)) c3.fail(`${what}: expected ${re}`, JSON.stringify(r))
    }
    c3.examined(2)
    const inGrace = entryHealthOf({ dry: null, next: { ...next, at: new Date(now - (DRYRUN_GRACE_MIN / 2) * 60e3).toISOString() }, node: 13, now })
    if (inGrace.fail || !inGrace.note) c3.fail('inside the grace a missing dry-run must be a note, not a failure', JSON.stringify(inGrace))
    const clean = entryHealthOf({ dry: dry(true), next, node: 13, now })
    if (clean.fail) c3.fail('a clean dry-run of the planned node fails', JSON.stringify(clean))
  }
  out.push(c3)

  const c4 = new Check('ED4', 'chain extras: earlier entries cleared, SF N at L-1')
  {
    c4.examined(1)
    const x = chainExtras(parseChain('5.2,5.3,8.2'))
    const want = [[[5, 1]], [[5, 2]], [[5, 3], [8, 1]]]
    if (JSON.stringify(x) !== JSON.stringify(want)) c4.fail('chain extras wrong', `${JSON.stringify(x)} vs ${JSON.stringify(want)}`)
  }
  out.push(c4)

  const c6 = new Check('ED6', 'a rate is not a duration: moneyPerH / rankPerH are never read as hours; moneyH and bladeH are')
  {
    const paths = hourFieldsOf({ bladeRoute: { bladeH: 13.3, simulacrum: { moneyPerH: 7.9e7, rankPerH: 120, moneyH: 3805.16, reachH: 2 } } }).map((x) => x.path)
    c6.examined(4)
    if (paths.some((p) => /PerH$/.test(p))) c6.fail('a per-hour rate was read as hours (BN5.2 dry-run: simulacrum.moneyPerH 7.9e7h)', paths.join(', '))
    if (!paths.includes('bladeRoute.simulacrum.moneyH') || !paths.includes('bladeRoute.bladeH')) c6.fail('the real hours fields must still be read', paths.join(', '))
  }
  out.push(c6)

  const c7 = new Check('ED7', "the published exit is the acted route's: the hacking distribution under the black ops fails OFF ROUTE (BN15.1 entry dry-run)")
  {
    const SRC = 'the Bladeburner route (21 black ops, bbplan.bladeExit)'
    // BN15.1 2026-10-25 as published: the node rule wrapped a decision priced on 'hack' (q50 29.862h)
    const bad = { exit: { meanH: 55.338, q10: 0, q50: 29.862, q90: 218.059, source: SRC }, decisions: { bladeRoute: { key: 'blade', q50: 29.862, hackH: 26.232, bladeH: 147.889, nodeRule: { route: 'blade', forced: true, pricedKey: 'hack' } } } }
    const good = { exit: { meanH: 146.267, q10: 17.993, q50: 135.049, q90: 303.241, source: SRC }, decisions: { bladeRoute: { key: 'blade', q50: 135.049, hackH: 26.339, bladeH: 137.775, nodeRule: { route: 'blade', inDecision: true, forced: true, pricedKey: 'hack' } } } }
    const hackSrc = { exit: { meanH: 30, q10: 10, q50: 28, q90: 60, source: 'install decision (w1.2)' }, decisions: { bladeRoute: { key: 'blade', bladeH: 140, hackH: 26 } } }
    const onHack = { exit: { meanH: 30, q10: 10, q50: 28, q90: 60, source: 'install decision (w1.2)' }, decisions: { bladeRoute: { key: 'hack', bladeH: 140, hackH: 26 } } }
    c7.examined(4)
    if (!exitOffRouteOf(bad)) c7.fail('the hacking distribution published under the black ops must fail OFF ROUTE')
    if (exitOffRouteOf(good)) c7.fail('the black-op distribution under the black ops is on route', JSON.stringify(exitOffRouteOf(good)))
    if (!exitOffRouteOf(hackSrc)) c7.fail("a hacking decision's exit published while the stack acts on the black ops must fail OFF ROUTE")
    if (exitOffRouteOf(onHack)) c7.fail('on the hacking route the check is silent')
  }
  out.push(c7)
  return out
}
