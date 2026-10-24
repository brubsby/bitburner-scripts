// Stanek's Gift IN THE GAME — stanek.js (accept, place, charger), charge.js, act.js's
// purchase gate, progress.js's allocation, batch.js's hold, the health check.
//
//   SG1 THE GATE'S TRUTH TABLE (stanekplan.giftStateOf / giftOrderGate): in BN13 before the
//       accept a non-NFG buyaug, a graft and an install are refused and NFG is not; accepted,
//       or not a gift node (BN7; SF13 outside BN13), nothing is refused; FORFEITED (a non-NFG
//       aug installed) is not blocked but flagged with a reason naming it.
//   SG2 THE SHIPPED LAYOUTS are the gameplan's (tools/sim/gameplan/stanek.mjs layoutFor at
//       BN13's extra size 1 / power 2, SF13 0..3), keyed by the grid the game computes
//       (giftSize), and every placement is legal in order (canPlace — ST1 checks canPlace
//       against the game's own StaneksGift).
//   SG3 A MOCK BN13 START: the game's accept rule (Helper.tsx canAcceptStaneksGift: nothing but
//       NFG installed OR queued), a planner batch [NFG, BitWire, a graft, install] dispatched
//       through the gate BEFORE stanek.js has run, then stanek.js's real main() against a
//       mock ns, then the batch again. Asserts: the accept precedes the first non-NFG
//       purchase; no state ever has a non-NFG aug queued/installed without Genesis; the layout
//       is placed and the charger launched at the default fraction; a second run is a no-op.
//       RED: the same scenario with an all-allowing gate is caught by the same detector.
//   SG4 THE BAN PATH IS NEVER SILENT: a hand-installed non-NFG aug (forfeited) -> stanek.js
//       health 'fail' and GIFT NOT ACCEPTED from stanekHealthOf; a hand-QUEUED one ->
//       acceptGift refused, health 'fail', GIFT NOT ACCEPTED (refused), and the gate refuses
//       the install that would make it permanent. A running charger whose gift charge mass
//       stays flat pass to pass, or a gathered charge.js error -> FRAGMENTS NOT CHARGING.
//   SG9 THE BLADEBURNER ROUTE'S GIFT IS PRICED (giftWantOf / BLADE_GIFT_PRICED): wanted iff withH < withoutH;
//       BN11.1 accepts; held on an unknown route; pins 'blade'; stanek.js places BLADE_LAYOUTS (mock BN11).
//   SG10 THE LIFE'S LAYOUT IN THE GAME: an install with the plan's decision -> stanek.js re-lays and
//       charges it (index, key, why recorded); kept with no decision; a late decision not followed;
//       STANEK LAYOUT STALE on a mismatch 15 min in or no decision 60 min in. SG11 the life's
//       layout is the fastest simulated exit, weights = the exit's marginal hours (exitplan).
//       SG12 the node model's per-life policy: never slower than fixed, the final life its own.
//   SG5 THE CHOKE POINTS (static): act.js's runActor gates buyaug/graft/install before its
//       exec, the order loop gates before the install branch; no root script but the three
//       actors calls purchaseAugmentation / installAugmentations / graftAugmentation;
//       progressBlockGb equals batch.js SETTINGS.homeReserve; batch.js holds stanekHoldsOf on
//       every host; progress.js prices fractions of stanek.js's measured fleet (basis 'fleet'); the watchdog JOB and the boot manifest declare stanek.js; progress.js prices
//       every option through chargeInputsOf and the trajectory.
//   SG6 THE ALLOCATION IS A COMPARISON OF EXITS: at f = the measured fraction the inputs are
//       the measured ones (same exit hours); chooseAlloc returns the min of the priced exits
//       (and keeps an incumbent within tolerance); the RAM side is priced (the same GB costs
//       more of a smaller fleet); the placement concentrates (highestCharge = one script). exitplan.bestExitPolicy on a fixture.
//       NOT CALIBRATED: no node of this playthrough has run the gift (stanekplan header).
//   SG8 THE LIVE SHAPE: a full 1-core home, rooted hosts free or full of h/g/w, no decision ->
//       the charger runs on the fleet at DEFAULT_F (UNPRICED), batch.js holds the rest per
//       host, heartbeats gathered home, the fragments charge. RED: home only -> named cause.
//   SG7 THE GIFT NEVER PINS (L4, 2026-10-16): accepted and no /route-pin.txt -> the PRICED route is
//       acted on (BN13 and elsewhere, either key); the manual pin still wins; the accepted gift's basis
//       follows the acted route (the layout decision moves with a route switch); the route decision prices
//       both arms WITH the gift (plan.decideBladeRouteGen `gift`: the hacking arm is the best gift option's
//       inputs, the Bladeburner arm the best gift path's members) and a switch pays ROUTE_GIFT's floor;
//       routeHealthOf fails an acted != priced route with no file pin, a non-file pin, and a gift-accepted
//       route not priced with it. RED: giftPinOf back; the gift options dropped; the file pin ignored.
//   SG24 ONE CHARGER BEFORE AND AFTER THE ACCEPT (entry dry-run 2026-10-24, BN5.2: the chain priced hack +
//       gift on the ramp, the accepted arm on the fleet measured at entry held fixed -> 13.0h at the accept,
//       20.4h one pass later, 15.4h declining). On one charger (hackChargerPathOf), the accepted builder
//       (hackGiftInputsOf, Genesis in the live multipliers, nothing charged yet) reproduces the chain's
//       inputs (hackChainGiftInputsOf) on every channel; progress.js hands both the one chainHackChargerOf,
//       and the ramp's length carries past the accept (decisions.bladeRoute.charger). RED: either builder
//       off the shared path, or the accepted pass without the charger.
//   SG25 THE BLADEBURNER ARM TOO (BN5.2 dry-run 2026-10-24: blade + gift 13.3h at the accept on the BLADE_HOST
//       ramp, 19.7h one pass later on the live charger's H held — 0 at the accept — vs 17.9h declining): the
//       chain's blade + gift option and the accepted arm's 'keep' option, from the same zero charge on one
//       charger (bladeChargerThrOf: the ramp at the node's age, floored at the live H), give the same factors
//       over the exit; progress.js hands the accepted arm that charger. And the Simulacrum's money leg: SF7.3
//       not joined -> it arrives at the join, no money leg; a money leg past the exit at today's income is
//       published unpriced (null + cause), never an hours figure (moneyH 3805h at the entry).
//   SG26 THE ALLOCATION f ON THE SAME CHARGER (backlog 0i; BN5.2 dry-run: the chain accepted at f 0.3 on the ramp,
//       the accepted pass's decisions.stanek chose 0.1 on the fleet held at entry, ~0.6h). On one state the
//       allocation's options (hackGiftInputsOf on the chain's charger) reproduce the chain's hack + gift inputs at
//       every f of ONE grid (CHAIN_HACK_F = ALLOC_GRID's f > 0), so both argmins agree; progress.js stanekDecisionOf
//       prices on chainHackChargerOf + hackGiftInputsOf (never chargeInputsOf on the held fleet), its incumbent
//       before a decision of the life is the chain's f (plan.js gift.hackF), and routeGiftOf's fH falls back to it.
//       RED: the decision back on chargeInputsOf, the charger dropped, the grids split, the chain's f unpublished.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Check } from './harness.mjs'
import './gameresolve.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../..')
const sp = await import('../../stanekplan.js')
const { canAccessCotMG } = await import('../../sfgate.js')
const stateOf = (ri, route = null) => sp.giftStateOf(ri, canAccessCotMG(ri), route)
const NFG = sp.NFG
const GEN = sp.GENESIS

const info = (node, installed = [], sf13 = 0) => ({ currentNode: node, lastAugReset: 1000, lastNodeReset: 0, ownedSF: new Map(sf13 ? [[13, sf13]] : []), ownedAugs: new Map(installed.map((n) => [n, 1])) })

function sg1() {
  const c = new Check('SG1', "the purchase gate's truth table (giftStateOf / giftOrderGate)")
  const cases = [
    // [label, info, order, allow, forfeited]
    ['BN13 fresh: non-NFG buyaug', info(13), { kind: 'buyaug', args: ['CyberSec', 'BitWire'] }, false, false],
    ['BN13 fresh: NFG buyaug', info(13), { kind: 'buyaug', args: ['CyberSec', NFG] }, true, false],
    ['BN13 fresh: graft', info(13), { kind: 'graft', args: ['BitWire'] }, false, false],
    ['BN13 fresh: install', info(13), { kind: 'install', args: ['boot.js'] }, false, false],
    ['BN13 fresh, NFG installed: install', info(13, [NFG]), { kind: 'install', args: [] }, false, false],
    ['BN13 fresh: work', info(13), { kind: 'work', args: [] }, true, false],
    ['BN13 accepted: non-NFG buyaug', info(13, [GEN, NFG, 'BitWire']), { kind: 'buyaug', args: ['x', 'BitWire'] }, true, false],
    ['BN13 accepted: install', info(13, [GEN]), { kind: 'install', args: [] }, true, false],
    ['BN13 forfeited: buyaug', info(13, ['BitWire']), { kind: 'buyaug', args: ['x', 'NeuroTrainer I'] }, true, true],
    ['BN7: non-NFG buyaug', info(7), { kind: 'buyaug', args: ['x', 'BitWire'] }, true, false],
    ['BN7 with SF13, hacking route: install', info(7, [], 1), { kind: 'install', args: [] }, true, false, 'hack'],
    // route unknown where the Bladeburner gift is priced to win: HELD (never accepted on an unknown route)
    ['BN7 with SF13, route unknown: install', info(7, [], 1), { kind: 'install', args: [] }, false, false, null],
    ['BN7 with SF13, Bladeburner route: non-NFG buyaug', info(7, [], 1), { kind: 'buyaug', args: ['x', 'BitWire'] }, false, false, 'blade'],
    // THE PRICING HOLD (GIFT_HOLD_NODES): the option is kept open, the gift NOT accepted
    ...[...sp.GIFT_HOLD_NODES].flatMap((n) => [
      [`BN${n} hold, SF13: non-NFG buyaug`, info(n, [], 1), { kind: 'buyaug', args: ['x', 'BitWire'] }, false, false],
      [`BN${n} hold, SF13: graft`, info(n, [], 1), { kind: 'graft', args: ['BitWire'] }, false, false],
      [`BN${n} hold, SF13: NFG buyaug`, info(n, [], 1), { kind: 'buyaug', args: ['x', NFG] }, true, false],
      [`BN${n} hold, SF13 accepted: non-NFG buyaug`, info(n, [GEN], 1), { kind: 'buyaug', args: ['x', 'BitWire'] }, true, false],
    ]),
  ]
  c.examined(cases.length)
  for (const [label, ri, o, allow, forfeited, route = null] of cases) {
    const st = stateOf(ri, route)
    const g = sp.giftOrderGate(st, o)
    if (g.allow !== allow) c.fail(`${label}: allow ${g.allow}, expected ${allow}`, g.why ?? st.why)
    if (!!g.forfeited !== forfeited) c.fail(`${label}: forfeited ${g.forfeited}, expected ${forfeited}`)
    if (!allow && !/STANEK GATE/.test(g.why ?? '')) c.fail(`${label}: a refusal must say why (STANEK GATE ...)`, g.why)
    if (forfeited && !/FORFEITED/.test(g.why ?? '')) c.fail(`${label}: a forfeit must be named`, g.why)
  }
  for (const n of sp.GIFT_HOLD_NODES) {
    const sh = stateOf(info(n, [], 1))
    if (sh.want || !sh.hold) c.fail(`BN${n} is a pricing hold: hold true, want false (stanek.js must not accept on a hold)`, JSON.stringify(sh))
  }
  const s7 = stateOf(info(7, [], 1), 'hack')
  if (s7.want !== false || !s7.available || s7.hold) c.fail('SF13 outside BN13 on the hacking route: available, not wanted, not held', JSON.stringify(s7))
  return c
}

// SG9 THE BLADEBURNER ROUTE'S GIFT IS A PRICED DECISION (stanekplan.giftWantOf / BLADE_GIFT_PRICED):
//   on the Bladeburner route the gift is wanted iff the simulated exit WITH it beats the exit WITHOUT
//   it (withH - withoutH < 0, the table tools/sim/bbstanek.mjs builds) — flipping an entry flips the
//   decision; BN11.1 (SF13.1, SF7.1) accepts; the shipped table equals the gameplan's cached one (when
//   built); the accepted gift pins 'blade' and stanek.js places BLADE_LAYOUTS (a mock BN11 pass: the
//   route read from progress.txt, the accept, the combat layout, the charger on the biggest host);
//   on an unknown route nothing is accepted and the option is held; progress.js publishes the
//   priced decision (static). RED: a GIFT_NODES-only gate (the old rule) accepts nothing in BN11.
async function sg9() {
  const c = new Check('SG9', "the Bladeburner route's gift: accepted iff its priced exit wins (withH < withoutH)")
  const ri11 = { currentNode: 11, lastAugReset: 1000, lastNodeReset: 1000, ownedSF: new Map([[13, 1], [7, 1], [6, 3]]), ownedAugs: new Map([[NFG, 1]]) }
  const e = sp.BLADE_GIFT_PRICED['11|1|1']
  c.examined(1)
  if (!e) return c.fail('BLADE_GIFT_PRICED has no BN11 SF13.1 SF7.1 entry'), c
  const w = sp.giftWantOf({ node: 11, l13: 1, l7: 1, route: 'blade' })
  if (w.want !== e[1] < e[0] || w.priced?.d !== +(e[1] - e[0]).toFixed(4)) c.fail('the decision must be withH - withoutH < 0 on the table entry', JSON.stringify({ w, e }))
  if (!w.want) c.fail(`BN11.1 (SF13.1 SF7.1) must accept on the Bladeburner route (priced ${e[0]}h -> ${e[1]}h)`)
  // flip the entry: the decision follows the comparison, not the node
  const keep = sp.BLADE_GIFT_PRICED['11|1|1']
  sp.BLADE_GIFT_PRICED['11|1|1'] = [keep[1], keep[0]]
  const flipped = sp.giftWantOf({ node: 11, l13: 1, l7: 1, route: 'blade' })
  sp.BLADE_GIFT_PRICED['11|1|1'] = keep
  c.examined(1)
  if (flipped.want) c.fail('an entry where the gift LOSES (withH > withoutH) must not be accepted', JSON.stringify(flipped))
  // every shipped entry: wanted on the blade route exactly when it wins; never on the hacking route; held on an unknown route iff it wins
  for (const [k, [wo, wi]] of Object.entries(sp.BLADE_GIFT_PRICED)) {
    const [n, l13, l7] = k.split('|').map(Number)
    if (sp.GIFT_NODES.has(n)) continue
    c.examined(1)
    const b = sp.giftWantOf({ node: n, l13, l7, route: 'blade' })
    const h = sp.giftWantOf({ node: n, l13, l7, route: 'hack' })
    const u = sp.giftWantOf({ node: n, l13, l7, route: null })
    if (b.want !== wi < wo || h.want || h.pending || u.want || u.pending !== wi < wo) c.fail(`${k}: blade ${b.want}, hack ${h.want}/${h.pending}, unknown ${u.want}/${u.pending} for ${wo}h -> ${wi}h`)
  }
  // the shipped table is the gameplan's (when the cache is built here)
  try {
    const bs = await import('../sim/gameplan/bladestanek.mjs')
    const tab = bs.readTable()
    let n = 0
    for (const [k, v] of Object.entries(tab)) {
      const [code, node, l13, l6, l7] = k.split('|')
      if (code !== bs.TABLE_CODE || l6 !== '3') continue
      const s = sp.BLADE_GIFT_PRICED[`${node}|${l13}|${l7}`]
      n++
      if (!s || Math.abs(s[0] - v.withoutH) > 1e-3 || Math.abs(s[1] - v.withH) > 1e-3) c.fail(`BLADE_GIFT_PRICED ${node}|${l13}|${l7} ${JSON.stringify(s)} != the gameplan's table ${v.withoutH}/${v.withH} (re-ship from tools/sim/bbstanek.mjs --table)`)
    }
    c.examined(n)
    c.note(n ? `BLADE_GIFT_PRICED == the gameplan's table on ${n} entries (code ${bs.TABLE_CODE})` : 'the gameplan table is not built for this code here (tools/sim/bbstanek.mjs --table): the shipped table not compared')
  } catch (err) {
    c.note(`the gameplan table unreadable here: ${String(err).slice(0, 120)}`)
  }
  // the gift's state: wanted on the blade route, basis blade; accepted, the basis is the acted route's
  // (L4: no pin — the route decision prices both routes with the gift, SG7)
  const st = sp.giftStateOf(ri11, true, 'blade')
  const stU = sp.giftStateOf(ri11, true, null)
  const acc = sp.giftStateOf({ ...ri11, ownedAugs: new Map([[NFG, 1], [GEN, 1]]) }, true, null)
  const rp = await import('../../routepin.js')
  c.examined(3)
  if (!st.want || st.basis !== 'blade') c.fail('BN11 on the Bladeburner route: wanted, basis blade', JSON.stringify(st))
  if (stU.want || !stU.hold) c.fail('BN11, route unknown: not wanted (never accept on an unknown route) but held', JSON.stringify(stU))
  if (!acc.accepted || acc.basis !== 'blade') c.fail("the gift accepted outside BN13, no route read yet: basis 'blade'", JSON.stringify({ acc: acc.basis }))
  if (sp.giftOrderGate(st, { kind: 'buyaug', args: ['x', 'BitWire'] }).allow) c.fail('BN11 on the Bladeburner route before the accept: a non-NFG buyaug must be refused')
  // the stack ACTS on the priced route (2026-10-15 BN11.1: a pin forced the wrong route at 136h forgone
  // and installed over the charge): no file pin -> pinnedRouteOf returns the priced record as it is
  const none11 = rp.routePinOf('', 11)
  c.examined(2)
  if (rp.pinnedRouteOf({ key: 'blade', hackH: 150, bladeH: 14 }, none11).key !== 'blade') c.fail("no file pin: the priced 'blade' must be acted on")
  if (rp.pinnedRouteOf({ key: 'hack', hackH: 10, bladeH: 14 }, none11).key !== 'hack') c.fail("no file pin, the gift accepted: a priced 'hack' must be acted on (no gift pin to 'blade')")
  // routeOfProgress: only this node and life, only fresh
  const prog = (route, node = 11, lar = 1000, at = new Date().toISOString()) => JSON.stringify({ at, route: { route, node, lastAugReset: lar } })
  c.examined(4)
  if (sp.routeOfProgress(prog('blade'), ri11) !== 'blade') c.fail('routeOfProgress: a fresh blade route of this node and life')
  if (sp.routeOfProgress(prog('blade', 10), ri11) !== null) c.fail('routeOfProgress: another node must read null')
  if (sp.routeOfProgress(prog('blade', 11, 999), ri11) !== null) c.fail('routeOfProgress: another life must read null')
  if (sp.routeOfProgress(prog('blade', 11, 1000, new Date(Date.now() - 3600e3).toISOString()), ri11) !== null) c.fail('routeOfProgress: a stale record must read null')
  // stanek.js against a mock BN11: route read from progress.txt -> accept -> combat layout -> charger on the biggest host
  const g11 = mockGame({ node: 11, sf13: 1, extraSf: [[7, 1], [6, 3]], progressRoute: 'blade' })
  if (g11) {
    const r1 = await g11.run()
    c.examined(3)
    if (!g11.accepted()) c.fail('stanek.js in BN11 on the Bladeburner route did not accept', JSON.stringify(r1?.why))
    if (r1?.layout?.key !== '6x5|1' || !sp.sameLayout(g11.active(), sp.BLADE_LAYOUTS['6x5|1'])) c.fail('stanek.js must place BLADE_LAYOUTS 6x5|1 in BN11 SF13.1', JSON.stringify(r1?.layout))
    if (!(r1?.charger?.threads > 0)) c.fail('stanek.js must launch the charger on the fleet', JSON.stringify(r1?.charger))
    const gU = mockGame({ node: 11, sf13: 1, extraSf: [[7, 1], [6, 3]], progressRoute: null })
    await gU.run()
    c.examined(1)
    if (gU.accepted()) c.fail('stanek.js must NOT accept on an unknown route')
  } else c.note('mockGame unavailable: the stanek.js pass not run')
  // RED: the old GIFT_NODES-only rule (want = GIFT_NODES.has(node)) never accepts in BN11
  c.examined(1)
  if (sp.GIFT_NODES.has(11) || !(st.want && !sp.GIFT_NODES.has(st.node))) c.fail('the BN11 accept must come from the priced decision, not GIFT_NODES')
  // progress.js publishes the priced decision (static)
  const prog_ = fs.readFileSync(path.join(REPO, 'progress.js'), 'utf8')
  c.examined(2)
  if (!/if \(gift\.basis === 'blade'\) \{[\s\S]{0,4000}withH: p\?\.withH[\s\S]{0,80}withoutH: p\?\.withoutH/.test(prog_)) c.fail("progress.js stanekDecisionOf must publish the Bladeburner route's priced decision (withH / withoutH)")
  if (!/giftNow\.accepted \|\| giftNow\.basis === 'blade'\) await stanekDecisionOf/.test(prog_)) c.fail('progress.js must price the decision on the Bladeburner basis before the accept too')
  return c
}

async function sg7() {
  const c = new Check('SG7', 'the gift never pins (L4): the priced route is acted on, priced WITH the gift; the manual pin wins')
  const rp = await import('../../routepin.js')
  const P = await import('../../plan.js')
  const se = await import('../../stanekepoch.js')
  const BB = await import('../../bbplan.js')
  const { drain } = await import('../../coop.js')
  const rd = (f) => fs.readFileSync(path.join(REPO, f), 'utf8')
  // 1. no gift pin anywhere: routepin exports none, progress.js reads only the file pin
  const pr = rd('progress.js')
  c.examined(3)
  if ('giftPinOf' in rp) c.fail('routepin.giftPinOf is back: the accepted gift must not pin a route (L4)')
  if (/giftPinOf/.test(strip(pr))) c.fail('progress.js calls giftPinOf: the accepted gift must not pin a route (L4)')
  if (!/const routePin = \(\(\) => \{\s*try \{\s*(?:\/\/[^\n]*\n\s*)*return routePinOf\(ns\.read\(ROUTE_PIN\), info\?\.currentNode \?\? null\)\s*\}/.test(pr)) c.fail('progress.js must take the route pin from /route-pin.txt alone (routePinOf(ns.read(ROUTE_PIN), ...))')
  // 2. accepted, no file pin: the priced key is acted on, in BN13 and elsewhere
  for (const node of [13, 11]) {
    const none = rp.routePinOf('', node)
    for (const key of ['hack', 'blade']) {
      const d = { key, hackH: key === 'hack' ? 20 : 30, bladeH: key === 'blade' ? 20 : 30, why: 'priced' }
      const a = rp.pinnedRouteOf(d, none)
      c.examined(1)
      if (a.key !== key) c.fail(`BN${node}, the gift accepted, no file pin: the priced '${key}' must be acted on, got '${a.key}'`)
    }
  }
  // 3. the manual pin still wins (BN13 and elsewhere, over a priced 'blade')
  for (const node of [13, 7]) {
    const file = rp.routePinOf(`hack ${node}`, node)
    const a = rp.pinnedRouteOf({ key: 'blade', hackH: 30, bladeH: 20, why: 'priced' }, file)
    const rep = rp.routeReportOf(file, a, stateOf(info(node, [GEN])))
    c.examined(1)
    if (a.key !== 'hack' || a.pin?.pricedKey !== 'blade' || a.pin?.forgoneH !== 10 || !rep.pinned || rep.route !== 'hack' || rep.priced !== 'blade') c.fail(`BN${node}: /route-pin.txt 'hack' must win over a priced 'blade' (hours forgone published)`, JSON.stringify({ a: a.key, pin: a.pin, rep }))
    if (rep.gift?.pinned !== false) c.fail('the gift is reported beside the route, never as a pin', JSON.stringify(rep.gift))
  }
  // a pin record that is not /route-pin.txt's (the gift's old shape) is never acted on
  c.examined(2)
  for (const [route, priced] of [['hack', 'blade'], ['blade', 'hack']]) {
    const fake = { pinned: true, route, file: '/tel/stanek.txt', text: "Stanek's Gift accepted" }
    if (rp.pinnedRouteOf({ key: priced, hackH: 10, bladeH: 20 }, fake).key !== priced) c.fail(`a '${route}' pin from anything but /route-pin.txt (the gift pin's shape) must not move the priced '${priced}'`)
  }
  // 4. the accepted gift's basis follows the acted route (a route switch moves the layout decision)
  const acc13 = info(13, [GEN])
  c.examined(4)
  if (sp.giftStateOf(acc13, true, 'blade').basis !== 'blade') c.fail("BN13, accepted, the acted route 'blade': the gift must be laid for the Bladeburner route (L3's epoch)")
  if (sp.giftStateOf(acc13, true, null).basis !== 'hack') c.fail('BN13, accepted, no route read: basis hack')
  const acc11 = { ...info(13, [GEN]), currentNode: 11 }
  if (sp.giftStateOf(acc11, true, 'hack').basis !== 'hack') c.fail("BN11, accepted, the acted route 'hack': the gift must be laid for the hacking route (L1)")
  if (sp.giftStateOf(acc11, true, 'blade').basis !== 'blade') c.fail("BN11, accepted, the acted route 'blade': basis blade")
  // 5. the route decision prices both arms WITH the gift (the same function bladeRouteOf calls)
  const mults = { strength: 1.12, defense: 1.12, dexterity: 1.12, agility: 1.12, charisma: 1.12, strength_exp: 1.15, defense_exp: 1.15, dexterity_exp: 1.15, agility_exp: 1.15, charisma_exp: 1.15, bladeburner_success_chance: 1, bladeburner_max_stamina: 1, bladeburner_stamina_gain: 1 }
  const person = { skills: { hacking: 900, strength: 300, defense: 300, dexterity: 300, agility: 300, charisma: 250, intelligence: 131 }, exp: Object.fromEntries(['strength', 'defense', 'dexterity', 'agility', 'charisma'].map((k) => [k, BB.expForLevel(300, 1.12)])), mults }
  const tel = { joined: true, rank: 399000, skillPoints: 0, blackOps: { done: 20 }, levels: { "Blade's Intuition": 260, 'Digital Observer': 230, 'Short-Circuit': 110, Cloak: 130, Reaper: 190, 'Evasive System': 190, Overclock: 90, "Cyber's Edge": 80, Tracer: 5 } }
  const s0 = BB.bladeStartOf({ tel, person, sleeves: { infiltrate: 5, support: 0, fa: 0 }, gymExpPerSec: 37.661, install: null })
  const trajGen = function* (x) {
    return x.fakeH
  }
  const flat = () => ({ factorAt: () => ({}) })
  const boost = () => ({ factorAt: () => ({ bladeburner_success_chance: 1.5, agility: 1.5, dexterity: 1.5 }) })
  const run = (gift) => drain(P.decideBladeRouteGen({ base: { fakeH: 50, cycleHours: 2 }, traj: (x) => x.fakeH, trajGen, bladeStart: s0, draws: [], post: false, gift }))
  const g = run({ hackOptions: [{ src: 'hackL', inputs: { fakeH: 40, cycleHours: 2 } }, { src: 'placed', inputs: { fakeH: 45, cycleHours: 2 } }], bladeOptions: [{ src: 'keep', make: flat }, { src: 'relay', make: boost }], switchCostH: se.ROUTE_GIFT.switchCostH })
  const g0 = run(null)
  c.examined(5)
  if (g.hackH !== 40 || g.gift?.hack?.chosen !== 'hackL') c.fail('the hacking arm must be the best gift option (40h), not the inputs as measured (50h)', JSON.stringify({ hackH: g.hackH, gift: g.gift?.hack }))
  if (!(g.bladeH < g0.bladeH) || g.gift?.blade?.chosen !== 'relay') c.fail('the Bladeburner arm must be the best gift path (the boosted one), priced on the members', JSON.stringify({ with: g.bladeH, without: g0.bladeH, gift: g.gift?.blade }))
  if (g.gift?.priced !== true || g0.gift?.priced !== false) c.fail('the record must say whether the route was priced with the gift', JSON.stringify({ g: g.gift?.priced, g0: g0.gift }))
  if (!(se.ROUTE_GIFT.switchCostH >= se.EPOCH.minGainH)) c.fail(`the route switch floor ${se.ROUTE_GIFT.switchCostH}h is below the layout switch's (${se.EPOCH.minGainH}h, the exit model's replayed error)`)
  // the floor reaches the commitment rule: a 0.1h gain switches at the default cost, not at the gift's floor
  const opts = [{ key: 'hack', noiseKey: 'a', sim: () => 10, simGen: function* () { return 10 } }, { key: 'blade', noiseKey: 'a', sim: () => 9.9, simGen: function* () { return 9.9 } }]
  const draws = P.makeDraws({ drift: { s: 0.01, nu: 4, a: 2, b: 0.0002 } }, 24, 7)
  const a0 = drain(P.decideAmongGen({ options: opts, prev: { key: 'hack', meanH: 10 }, draws, redecide: true, budgetMs: 1e9 }))
  const a1 = drain(P.decideAmongGen({ options: opts, prev: { key: 'hack', meanH: 10 }, draws, redecide: true, budgetMs: 1e9, switchCost: { hack: se.ROUTE_GIFT.switchCostH, blade: se.ROUTE_GIFT.switchCostH } }))
  if (a0.key !== 'blade' || a1.key !== 'hack') c.fail('decideAmongGen must charge the route switch floor: a 0.1h gain switches at the default 0.05h, not at 0.2h', JSON.stringify({ a0: a0.key, a1: a1.key }))
  // the route's installs clear the gift's charge in the Bladeburner arm (giftPathOf install)
  const placed = sp.BLADE_LAYOUTS['6x5|1']
  const liveG = { placed, charges: placed.map(() => ({ highestCharge: 192, numCharge: 500 })), masses: placed.map((p) => (sp.fragmentById(p.id).type === sp.TYPE.Booster ? 0 : 96000)), H: 192 }
  const kept = se.giftPathOf({ ...liveG, nodePower: 1 })
  const inst = se.giftPathOf({ ...liveG, nodePower: 1, install: { firstH: 1, everyH: 2 } })
  const fk = kept.factorAt(1.5 * 3600).agility
  const fi = inst.factorAt(1.5 * 3600).agility
  inst.factorAt(3.5 * 3600)
  c.examined(1)
  if (!(fi < fk) || !(fi < 1) || inst.clears() !== 2) c.fail("an install on the route must clear the gift's charge in the Bladeburner arm (the factor drops below the live one; one clear per install)", JSON.stringify({ fk, fi, clears: inst.clears() }))
  // the wiring: progress.js hands the gift to the route decision
  c.examined(2)
  if (!/decideBladeRouteGen\(\{[^\n]*\bgift, hold: routeHoldOf\(info, pc\), mandate \}\)/.test(pr) || !/gift = routeGiftOf\(ns, info, base, bladeS0\)/.test(pr)) c.fail('progress.js bladeRouteOf must price the route with the gift (routeGiftOf -> decideBladeRouteGen gift)')
  if (!/routeReportOf\(routePin, bladeRoute, giftStateOf\(info, canAccessCotMG\(info\)\)\)/.test(pr)) c.fail('progress.js must publish the gift beside the route (routeReportOf giftState)')
  // 6. health: acted != priced with no file pin; a non-file pin; accepted but not priced with the gift
  const base = { node: 7, lastAugReset: 1, route: 'blade', priced: 'blade', pinned: false, pin: { file: rp.ROUTE_PIN }, gift: { accepted: true, pricedWithGift: true } }
  const H = (r, st = null) => rp.routeHealthOf({ route: r, stanek: st, node: 7 }).map((x) => x.key)
  c.examined(6)
  if (H(base).length) c.fail('a healthy route must not fail', JSON.stringify(H(base)))
  if (!H({ ...base, route: 'hack' }).includes('ROUTE NOT THE PRICED ONE')) c.fail('acted != priced with no file pin must fail ROUTE NOT THE PRICED ONE')
  if (H({ ...base, route: 'hack', pinned: true }).length) c.fail('acted != priced under /route-pin.txt is the manual pin: no failure')
  if (!H({ ...base, pinned: true, pin: { file: '/tel/stanek.txt' } }).includes('ROUTE NOT THE PRICED ONE')) c.fail('a pin from /tel/stanek.txt (the gift pin) must fail')
  if (!H({ ...base, gift: { accepted: true, pricedWithGift: false, why: 'x' } }).includes('ROUTE NOT PRICED WITH THE GIFT')) c.fail('the gift accepted and the route not priced with it must fail')
  if (!H(base, { node: 7, lastAugReset: 1, gift: { accepted: true, basis: 'hack', route: 'blade' } }).includes('STANEK LAYOUT OFF ROUTE')) c.fail('stanek.js laying the gift for another route than the one it read must fail STANEK LAYOUT OFF ROUTE')
  return c
}

async function sg2() {
  const c = new Check('SG2', 'the shipped layouts = the gameplan optimiser at BN13, legal on the game grid')
  const { layoutFor } = await import('../sim/gameplan/stanek.mjs')
  const m = { StaneksGiftExtraSize: 1, StaneksGiftPowerMultiplier: 2 } // BitNode.tsx case 13
  for (const l13 of [0, 1, 2, 3]) {
    const { width, height } = sp.giftSize(1, l13)
    const key = `${width}x${height}|2`
    const tab = sp.LAYOUTS[key]
    c.examined(1)
    if (!tab) {
      c.fail(`no shipped layout for BN13 at SF13 ${l13} (${key})`)
      continue
    }
    const ref = layoutFor(m, l13)
    if (JSON.stringify(ref.placed) !== JSON.stringify(tab)) c.fail(`${key}: shipped layout differs from layoutFor (the optimiser changed: re-table stanekplan.LAYOUTS)`, JSON.stringify(ref.placed))
    for (let i = 0; i < tab.length; i++) {
      const p = tab[i]
      if (!sp.canPlace(tab.slice(0, i), width, height, p.x, p.y, p.rot, sp.fragmentById(p.id))) c.fail(`${key}: placement ${i} (${JSON.stringify(p)}) is illegal`)
    }
    const lf = sp.layoutForGrid(width, height, 2)
    if (lf.placed !== tab) c.fail(`${key}: layoutForGrid did not return the table`)
    c.note(`${key} (SF13 ${l13}): ${tab.length} fragments, ${sp.chargeRootsOf(tab).length} charged`)
  }
  const fb = sp.layoutForGrid(4, 3, 0.5)
  if (!/searched in-game/.test(fb.source)) c.fail('an untabled grid must say it was searched in-game', fb.source)
  return c
}

/** The game, as far as the gift is concerned: Helper.tsx canAcceptStaneksGift, Stanek.ts, the aug queue. */
function mockGame({ node = 13, sf13 = 0, installed = [], queued = [], homeMax = 1024, homeUsed = 100, homeCores = 4, others = [], extraSf = [], progressRoute = undefined, extraSize = node === 13 ? 1 : 0 } = {}) {
  const g = { installed: new Map(installed.map((n) => [n, 1])), queued: [...queued], frags: [], charge: new Map(), log: [], files: {}, remote: {}, procs: [], nextPid: 10, atExit: null }
  // The fleet: home + `others` [{ host, max, used (non-charger use), cores, workers: [{filename, threads}] }].
  g.hosts = new Map([['home', { max: homeMax, used: homeUsed, cores: homeCores, workers: [] }], ...others.map((o) => [o.host, { max: o.max, used: o.used, cores: o.cores ?? 1, workers: o.workers ?? [] }])])
  const usedOn = (h) => g.hosts.get(h).used + g.procs.filter((p) => p.host === h).reduce((s, p) => s + p.threads * 2, 0)
  // One second of every running charge.js (StaneksGift.charge at its threads x core bonus, round robin).
  g.tick = (rounds = 1) => {
    for (let r = 0; r < rounds; r++)
      for (const p of g.procs.filter((q) => q.filename === 'charge.js'))
        for (const [x, y] of JSON.parse(p.args[0])) {
          const key = `${x},${y}`
          if (!g.frags.some((f) => f.x === x && f.y === y)) continue // chargeFragment throws on an empty root
          const af = g.charge.get(key) ?? { highestCharge: 0, numCharge: 0 }
          g.charge.set(key, sp.chargeOnce(af, p.threads * sp.coreBonus(g.hosts.get(p.host).cores)))
        }
  }
  const grid = sp.giftSize(extraSize, sf13)
  // progress.js's route record of this node and life (stanekplan.routeOfProgress); undefined = none written
  if (progressRoute !== undefined) g.files[sp.PROGRESS_FILE] = JSON.stringify({ at: new Date().toISOString(), route: { route: progressRoute, node, lastAugReset: 1000 } })
  g.accepted = () => g.installed.has(GEN)
  g.active = () => g.frags.map((p) => ({ id: p.id, x: p.x, y: p.y, rotation: p.rot }))
  const canAccept = () => (node === 13 || sf13 > 0) && [...g.installed.keys(), ...g.queued].filter((a) => a !== NFG).length === 0
  const need = () => {
    if (!g.installed.has(GEN)) throw new Error("Stanek's Gift is not installed")
  }
  g.event = (ev, name = null) => g.log.push({ ev, name, gift: g.installed.has(GEN), queued: [...g.queued], installed: [...g.installed.keys()] })
  g.ns = {
    disableLog() {},
    atExit(f) {
      g.atExit = f
    },
    getResetInfo: () => ({ currentNode: node, lastAugReset: g.lastAugReset ?? 1000, lastNodeReset: 0, ownedSF: new Map([...(sf13 ? [[13, sf13]] : []), ...extraSf]), ownedAugs: new Map(g.installed) }),
    stanek: {
      acceptGift() {
        if (g.installed.has(GEN)) return true
        if (!canAccept()) return false
        g.installed.set(GEN, 1)
        g.event('accept')
        return true
      },
      giftWidth: () => (need(), grid.width),
      giftHeight: () => (need(), grid.height),
      activeFragments: () => (need(), g.frags.map((p) => ({ id: p.id, x: p.x, y: p.y, rotation: p.rot, type: sp.fragmentById(p.id).type, highestCharge: g.charge.get(`${p.x},${p.y}`)?.highestCharge ?? 0, numCharge: g.charge.get(`${p.x},${p.y}`)?.numCharge ?? 0, chargedEffect: 1 }))),
      // the game deletes a fragment WITH its charge (StaneksGift.delete / clear, StaneksGift.ts:112-124)
      clearGift() {
        need()
        g.frags = []
        g.charge = new Map()
        g.event('clear')
      },
      removeFragment(x, y) {
        need()
        const i = g.frags.findIndex((p) => p.x === x && p.y === y)
        if (i < 0) return false
        g.frags.splice(i, 1)
        g.charge.delete(`${x},${y}`)
        g.event('remove')
        return true
      },
      placeFragment(x, y, rot, id) {
        need()
        const f = sp.fragmentById(id)
        if (!sp.canPlace(g.frags, grid.width, grid.height, x, y, rot, f)) return false
        g.frags.push({ id, x, y, rot })
        g.charge.delete(`${x},${y}`)
        g.event('place')
        return true
      },
    },
    read: (f) => g.files[f] ?? '',
    write: (f, d) => {
      g.files[f] = d
    },
    scan: (h) => (h === 'home' ? [...g.hosts.keys()].filter((x) => x !== 'home') : ['home']),
    hasRootAccess: (h) => g.hosts.has(h),
    getServerMaxRam: (h) => g.hosts.get(h).max,
    getServerUsedRam: (h) => usedOn(h),
    getServer: (h) => ({ cpuCores: g.hosts.get(h).cores }),
    getScriptRam: () => 1.75,
    ps: (h) => [...g.hosts.get(h).workers.map((w, i) => ({ pid: 1000 + i, filename: w.filename, threads: w.threads, args: [] })), ...g.procs.filter((p) => p.host === h).map((p) => ({ ...p }))],
    scp: (file, dest, src) => {
      if (dest === 'home' && g.remote[`${src}:${file}`] !== undefined) g.files[file] = g.remote[`${src}:${file}`]
      return true
    },
    kill(pid) {
      g.procs = g.procs.filter((p) => p.pid !== pid)
      return true
    },
    exec(script, host, threads, ...args) {
      // The game refuses a launch that does not fit (no RAM is taken).
      if (usedOn(host) + threads * 2 > g.hosts.get(host).max + 1e-9) return 0
      const pid = g.nextPid++
      g.procs.push({ pid, host, filename: script, threads, args })
      g.event('exec', script)
      return pid
    },
  }
  // The planner's orders, through act.js's gate (or another gate, for the red run).
  g.dispatch = (o, gate = (st, ord) => sp.giftOrderGate(st, ord)) => {
    const v = gate(stateOf(g.ns.getResetInfo()), o)
    if (!v.allow) return { ok: false, why: v.why }
    if (o.kind === 'buyaug') {
      g.queued.push(o.args[1])
      g.event('queue', o.args[1])
    } else if (o.kind === 'graft') {
      g.installed.set(o.args[0], 1)
      g.event('graft', o.args[0])
    } else if (o.kind === 'install') {
      for (const q of g.queued) g.installed.set(q, (g.installed.get(q) ?? 0) + 1)
      g.queued = []
      g.event('install')
    }
    return { ok: true, forfeited: v.forfeited, why: v.why }
  }
  g.run = async () => {
    const mod = await import('../../stanek.js')
    g.atExit = null
    await mod.main(g.ns)
    if (g.atExit) g.atExit()
    return JSON.parse(g.files[sp.STANEK_FILE] ?? 'null')
  }
  return g
}

/** The invariant the gate exists for: no state with a non-NFG aug queued or installed while Genesis is absent. */
const violations = (log) => log.filter((e) => !e.gift && [...e.queued, ...e.installed].some((n) => n !== NFG && n !== GEN))

const BATCH = [
  { kind: 'buyaug', args: ['CyberSec', NFG] },
  { kind: 'buyaug', args: ['CyberSec', 'BitWire'] },
  { kind: 'graft', args: ['Neuralstimulator'] },
  { kind: 'install', args: ['boot.js'] },
]

async function sg3() {
  const c = new Check('SG3', 'a mock BN13 start: the accept precedes every non-NFG purchase; layout placed; charger launched')
  const g = mockGame()
  const first = BATCH.map((o) => ({ kind: o.kind, ...g.dispatch(o) }))
  c.examined(first.length)
  const want1 = [true, false, false, false]
  first.forEach((r, i) => {
    if (r.ok !== want1[i]) c.fail(`before the accept, ${BATCH[i].kind} ${BATCH[i].args.join(' ')}: ok ${r.ok}, expected ${want1[i]}`, r.why)
  })
  const rec = await g.run()
  if (!rec?.gift?.accepted) c.fail('stanek.js did not accept the gift on a clean BN13 start', JSON.stringify(rec)?.slice(0, 300))
  if (!rec?.layout?.ok) c.fail('the layout was not placed', JSON.stringify(rec?.layout)?.slice(0, 300))
  if (JSON.stringify(rec?.layout?.placed) !== JSON.stringify(sp.LAYOUTS['6x5|2'])) c.fail('BN13 at SF13 0 must place the 6x5|2 table')
  const wantThreads = Math.floor((sp.DEFAULT_F * 1024) / 2)
  if (rec?.charger?.threads !== wantThreads) c.fail(`charger threads ${rec?.charger?.threads}, expected ${wantThreads} (DEFAULT_F x the fleet (= home here) / 2.0GB)`, rec?.charger?.why)
  const ch = g.procs.find((p) => p.filename === 'charge.js')
  if (!ch || JSON.stringify(JSON.parse(ch.args[0])) !== JSON.stringify(sp.chargeRootsOf(sp.LAYOUTS['6x5|2']))) c.fail('charge.js not launched with the non-booster roots', JSON.stringify(ch))
  if (rec?.health !== 'ok') c.fail(`stanek.js health ${rec?.health}`, rec?.why)
  if (!/DEFAULT_F.*UNPRICED/.test(rec?.alloc?.source ?? '')) c.fail('with no plan decision the allocation must say it is the default, UNPRICED', rec?.alloc?.source)
  const second = BATCH.map((o) => g.dispatch(o))
  if (!second.every((r) => r.ok)) c.fail('after the accept every order must pass', JSON.stringify(second))
  const acceptAt = g.log.findIndex((e) => e.ev === 'accept')
  const firstNonNfg = g.log.findIndex((e) => (e.ev === 'queue' || e.ev === 'graft') && e.name !== NFG)
  if (!(acceptAt >= 0 && firstNonNfg > acceptAt)) c.fail(`the accept (event ${acceptAt}) must precede the first non-NFG purchase (event ${firstNonNfg})`)
  const v = violations(g.log)
  if (v.length) c.fail(`${v.length} state(s) with a non-NFG aug and no gift`, JSON.stringify(v[0]))
  // idempotent: a second run neither clears nor relaunches
  const nLog = g.log.length
  const rec2 = await g.run()
  if (g.log.slice(nLog).some((e) => e.ev === 'clear' || e.ev === 'exec')) c.fail('a second stanek.js run re-placed or relaunched with nothing changed')
  if (rec2?.health !== 'ok') c.fail(`second run health ${rec2?.health}`, rec2?.why)
  // with a priced plan decision of this life, the charger follows it
  g.files['/tel/plan.txt'] = JSON.stringify({ at: new Date().toISOString(), lastAugReset: 1000, decisions: { stanek: { f: 0.05, basis: 'fleet', why: 'test' } } })
  const rec3 = await g.run()
  if (rec3?.charger?.threads !== Math.floor((0.05 * 1024) / 2) || !/the plan/.test(rec3?.alloc?.source ?? '')) c.fail(`the plan's f=0.05 not followed: ${rec3?.charger?.threads} threads, ${rec3?.alloc?.source}`)
  // a decision of the OLD basis (a fraction of home, no basis field) is not followed
  g.files['/tel/plan.txt'] = JSON.stringify({ at: new Date().toISOString(), lastAugReset: 1000, decisions: { stanek: { f: 0.05, why: 'old home-fraction decision' } } })
  const rec4 = await g.run()
  if (!/UNPRICED/.test(rec4?.alloc?.source ?? '')) c.fail('a decision without basis "fleet" must not be followed (it priced a fraction of home)', rec4?.alloc?.source)
  // RED: the same scenario with no gate is caught by the detector
  const r = mockGame()
  for (const o of BATCH) r.dispatch(o, () => ({ allow: true }))
  await r.run()
  if (!violations(r.log).length) c.fail('RED RUN NOT CAUGHT: an all-allowing gate produced no violation — the detector cannot fail')
  else c.note(`red run: an all-allowing gate gives ${violations(r.log).length} violating state(s) and ${r.log.some((e) => e.ev === 'accept') ? 'an accept' : 'NO accept'} (caught)`)
  return c
}

async function sg4() {
  const c = new Check('SG4', 'the ban path is never silent: forfeited / refused / not charging all fail the health check')
  const now = Date.now()
  // forfeited: a non-NFG aug installed by hand
  const f = mockGame({ installed: ['BitWire'] })
  const rf = await f.run()
  c.examined(3)
  if (rf?.health !== 'fail' || !rf?.gift?.forfeited) c.fail(`forfeited: stanek.js health ${rf?.health}, forfeited ${rf?.gift?.forfeited}`, rf?.why)
  const hf = sp.stanekHealthOf({ stanek: rf, charge: null, now, nodeStartMs: now })
  if (!hf.some((p) => p.problem === 'GIFT NOT ACCEPTED')) c.fail('forfeited: no GIFT NOT ACCEPTED (even inside the grace)', JSON.stringify(hf))
  const gf = f.dispatch({ kind: 'buyaug', args: ['x', 'NeuroTrainer I'] })
  if (!gf.ok || !gf.forfeited) c.fail('forfeited: the gate must not block (nothing left to save) but must flag it', JSON.stringify(gf))
  // refused: a non-NFG aug QUEUED by hand
  const q = mockGame({ queued: ['BitWire'] })
  const rq = await q.run()
  if (rq?.health !== 'fail' || !/QUEUED/.test(rq?.refused ?? '')) c.fail(`queued: stanek.js must report the refusal and why`, JSON.stringify(rq)?.slice(0, 300))
  const hq = sp.stanekHealthOf({ stanek: rq, charge: null, now, nodeStartMs: now })
  if (!hq.some((p) => p.problem === 'GIFT NOT ACCEPTED')) c.fail('queued: no GIFT NOT ACCEPTED', JSON.stringify(hq))
  const iq = q.dispatch({ kind: 'install', args: [] })
  if (iq.ok) c.fail('queued: the gate let the install through — that makes the forfeit permanent')
  // not accepted past the grace, no refusal (stanek.js never ran the accept)
  const late = { at: new Date(now).toISOString(), node: 13, lastAugReset: 1000, gift: { want: true, accepted: false, forfeited: false, node: 13, why: 'not accepted yet' } }
  if (!sp.stanekHealthOf({ stanek: late, charge: null, now, nodeStartMs: now - 30 * 60e3 }).some((p) => p.problem === 'GIFT NOT ACCEPTED')) c.fail('30 min into BN13 and not accepted: no GIFT NOT ACCEPTED')
  if (sp.stanekHealthOf({ stanek: late, charge: null, now, nodeStartMs: now - 5 * 60e3 }).some((p) => p.problem === 'GIFT NOT ACCEPTED')) c.fail('5 min into BN13: inside the grace, must not fail yet')
  // not charging: judged by the gift's OWN charge (highestCharge x numCharge), pass to pass
  const ok = mockGame()
  ok.lastAugReset = Date.now() - 2 * 60e3 // a young life: no life-layout decision is due yet (STANEK LAYOUT STALE waits 60 min)
  const ro = await ok.run()
  if (sp.stanekHealthOf({ stanek: ro, charge: null, now: Date.now() }).length) c.fail('a charger just launched (no previous pass to compare) must be healthy', JSON.stringify(sp.stanekHealthOf({ stanek: ro, charge: null, now: Date.now() })))
  const back = (r, min) => ({ ...r, at: new Date(Date.now() - min * 60e3).toISOString() })
  ok.files[sp.STANEK_FILE] = JSON.stringify(back(ro, 5))
  const flat = await ok.run() // no tick: charge.js held threads and nothing charged
  const hFlat = sp.stanekHealthOf({ stanek: flat, charge: null, now: Date.now() })
  if (!hFlat.some((p) => p.problem === 'FRAGMENTS NOT CHARGING' && /did not grow/.test(p.detail))) c.fail('a running charger with a flat charge mass for 5 min: no FRAGMENTS NOT CHARGING naming it', JSON.stringify(hFlat))
  if (flat?.health !== 'fail') c.fail(`stanek.js must publish fail on a flat charge mass, got ${flat?.health}`, flat?.why)
  ok.files[sp.STANEK_FILE] = JSON.stringify(back(flat, 5))
  ok.tick(30)
  const grew = await ok.run()
  if (sp.stanekHealthOf({ stanek: grew, charge: null, now: Date.now() }).length) c.fail('a growing charge mass must be healthy', JSON.stringify(sp.stanekHealthOf({ stanek: grew, charge: null, now: Date.now() })))
  const errBeat = { at: new Date().toISOString(), lastAugReset: ok.lastAugReset, hosts: { home: { at: new Date().toISOString(), error: 'chargeFragment(0, 0) threw: x' } } }
  if (!sp.stanekHealthOf({ stanek: grew, charge: errBeat, now: Date.now() }).some((p) => /chargeFragment/.test(p.detail))) c.fail('a fresh charge.js error in the gathered heartbeats: not reported')
  if (sp.stanekHealthOf({ stanek: null }).length !== 1) c.fail('no stanek.txt must be reported (STANEK UNREPORTED)')
  return c
}

const strip = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

function sg5() {
  const c = new Check('SG5', 'the choke points and the wiring (static)')
  const rd = (f) => fs.readFileSync(path.join(REPO, f), 'utf8')
  const act = rd('act.js')
  const ra = act.indexOf('async function runActor(')
  const raBody = act.slice(ra, act.indexOf('\n}\n', ra))
  const gi = raBody.indexOf('const gate = giftOrderGate(giftStateOf(ri, canAccessCotMG(ri), routeOfProgress(readHomeFile(ns, PROGRESS_FILE), ri), giftVerdictOfProgress(readHomeFile(ns, PROGRESS_FILE), ri)), { kind, args })')
  const fresh = raBody.indexOf('const ri = ns.getResetInfo()')
  const gr = raBody.search(/if \(!gate\.allow\) return \{ ran: false, ok: false/)
  const ex = raBody.indexOf('ns.exec(actor')
  c.examined(1)
  if (!(fresh > 0 && gi > fresh && gr > gi && ex > gr)) c.fail("act.js runActor must gate buyaug/graft/install (giftOrderGate on a FRESH getResetInfo) and RETURN on a refusal before its exec", `gate at ${gi}, return at ${gr}, exec at ${ex}`)
  if (!/if \(kind === 'buyaug' \|\| kind === 'graft' \|\| kind === 'install'\)/.test(raBody)) c.fail('act.js runActor gate must cover buyaug, graft and install')
  const loopGate = act.indexOf("const ri = ns.getResetInfo()\n            const gate = giftOrderGate(giftStateOf(ri, canAccessCotMG(ri), routeOfProgress(readHomeFile(ns, PROGRESS_FILE), ri), giftVerdictOfProgress(readHomeFile(ns, PROGRESS_FILE), ri)), o)")
  const installBranch = act.indexOf("if (o.kind === 'install') {\n            // THE MANUAL HOLD")
  if (!(loopGate > 0 && installBranch > loopGate)) c.fail("act.js's order loop must gate before the install branch", `${loopGate} / ${installBranch}`)
  // ...and act on it there: runActor's own gate would refuse the install only AFTER the
  // liquidation and the home spend-down this branch runs first.
  const loopAct = act.slice(loopGate, loopGate + 600)
  if (!/\n\s*if \(!gate\.allow\) \{\n\s*results\.push\(\{[^\n]*skipped: gate\.why[^\n]*\n\s*if \(CHAIN\.has\(o\.kind\)\) chainFailed[^\n]*\n\s*if \(o\.kind === 'install'\) break\n\s*continue/.test(loopAct)) c.fail("act.js's order-loop gate must skip the order, break the chain and stop the batch at an install — before the liquidation and spend-down")
  const actors = new Set(['act-buyaug.js', 'act-install.js', 'act-graft.js'])
  const callers = []
  for (const f of fs.readdirSync(REPO).filter((f) => f.endsWith('.js'))) {
    c.examined(1)
    if (actors.has(f)) continue
    if (/\.(purchaseAugmentation|installAugmentations|graftAugmentation)\s*\(/.test(strip(rd(f)))) callers.push(f)
  }
  if (callers.length) c.fail(`augmentation purchases outside the gated actors: ${callers.join(', ')}`)
  const batch = rd('batch.js')
  const m = batch.match(/homeReserve: \(mult\) => ([^,\n]+),/)
  const ref = m ? Function('mult', `return ${m[1]}`) : null
  for (const k of [1, 4, 16]) if (!ref || ref(k) !== sp.progressBlockGb(k)) c.fail(`progressBlockGb(${k}) = ${sp.progressBlockGb(k)} vs batch.js SETTINGS.homeReserve ${ref?.(k)}`)
  if (!/\n\s*heldOn\(stanekRes, h\) \+/.test(batch) || !/stanekHoldsOf\(JSON\.parse\(ns\.read\(STANEK_FILE\)/.test(batch)) c.fail("batch.js must hold stanekHoldsOf on EVERY host in reserveFor (heldOn(stanekRes, h))")
  const wd = rd('watchdog.js')
  if (!/script: 'stanek\.js',\s*host: 'home',\s*args: \[\],\s*trigger: \(ns\) => canAccessFeature\(ns\.getResetInfo\(\), 13\)/.test(wd)) c.fail('watchdog.js must run stanek.js as a JOB on home triggered by canAccessFeature(13)')
  if (!/script: 'stanek\.js',\s*where: 'home',\s*kind: 'job'/.test(rd('boot.js'))) c.fail('boot.js must declare stanek.js (kind job) — the watchdog watches only what boot declares (B7.9)')
  const pr = rd('progress.js')
  if (!/const h = r\.inputs \? yield\* tg\(r\.inputs\) : null/.test(pr)) c.fail('progress.js stanekDecisionOf must price every option through the trajectory simulator (SG26: on the shared charger)')
  const sd = pr.slice(pr.indexOf('async function stanekDecisionOf('), pr.indexOf('\n}\n', pr.indexOf('async function stanekDecisionOf(')))
  if (!/allocOptionsOf\(fleetGB, hosts\)/.test(sd) || !/st\?\.fleet\?\.gb/.test(sd) || /batch\.txt/.test(sd)) c.fail("progress.js stanekDecisionOf must price fractions of stanek.js's measured FLEET (st.fleet), not home and not /tel/batch.txt")
  if (!/basis: ALLOC_BASIS/.test(sd)) c.fail('progress.js stanekDecisionOf must stamp basis "fleet" on the decision (stanek.js follows only that basis)')
  // (2026-10-11 BN13) the returned decision carried a SECOND `basis:` key (the install
  // basis {kind}) after `basis: ALLOC_BASIS`; the later key won, planAllocOf refused every
  // decision and stanek.js charged at DEFAULT_F 'UNPRICED' while plan.txt showed a priced f.
  const ret = sd.slice(sd.indexOf('return {\n      key: c.f'), sd.indexOf('\n    }\n', sd.indexOf('return {\n      key: c.f')))
  const basisKeys = ret.match(/\n\s+basis:/g)?.length ?? 0
  if (!ret || basisKeys !== 1) c.fail(`progress.js stanekDecisionOf's priced decision must carry exactly ONE basis key (basis: ALLOC_BASIS), has ${basisKeys} — a later duplicate overrides 'fleet' and stanek.js never follows the plan`)
  else {
    const lit = Function('ALLOC_BASIS', 'c', 'without', 'priced', 'fleetGB', 'hosts', 'fNow', 'cycleH', 'ctx', 'basis', 't0', 'layout', 'info', 'lifeMin', 'LIFE_LAYOUT_WINDOW_MIN', 'charger', 'chargerWhy', `${ret.replace('return {', 'return ({')}\n    })`)
    const lar = Date.now() - 3 * 60e3
    const alt = sp.LAYOUTS['6x5|2'] // legal on BN13.2's 6x6 grid
    const lay = { key: sp.layoutKeyOf(alt), placed: alt, lifeKey: lar, why: 'test', decidedAt: new Date().toISOString() }
    const d = lit(sp.ALLOC_BASIS, { f: 0.1, hours: 100, why: 'w' }, 110, [], 756, [{}], 0, 0.5, { nodePower: 2 }, null, Date.now(), lay, { lastAugReset: lar }, 3, sp.LIFE_LAYOUT_WINDOW_MIN, { ageH: 0.1, ramHours: 19, liveGB: 228 }, 'test')
    const plan = JSON.stringify({ at: new Date().toISOString(), lastAugReset: lar, decisions: { stanek: d } })
    const got = sp.planAllocOf(plan, lar)
    if (got?.f !== 0.1) c.fail(`stanek.js does not follow progress.js's own priced decision: planAllocOf -> ${JSON.stringify(got)} (decision basis ${JSON.stringify(d.basis)})`)
    // the life's layout round-trips: progress.js's decision -> plan.txt -> stanek.js's planLayoutOf (this life, legal on the grid)
    const gl = sp.planLayoutOf(plan, lar, 6, 6)
    if (gl?.key !== lay.key) c.fail(`stanek.js does not read progress.js's own life layout decision: planLayoutOf -> ${JSON.stringify(gl)}`)
    if (sp.planLayoutOf(plan, lar + 1, 6, 6) !== null) c.fail("planLayoutOf followed another life's layout")
    if (sp.planLayoutOf(plan, lar, 5, 5) !== null) c.fail('planLayoutOf followed a layout that does not fit the grid')
  }
  if (!/stanek: pc\.decisions\.stanek \?\? pc\.prev\?\.decisions\?\.stanek \?\? null/.test(pr)) c.fail('progress.js must publish decisions.stanek in /tel/plan.txt')
  if (/giftPinOf/.test(pr)) c.fail("progress.js must not pin a route for the gift (L4: priced, SG7)")
  // charge.js stays 2.0GB: only chargeFragment among the priced calls
  const ch = strip(rd('charge.js'))
  const nsCalls = [...new Set([...ch.matchAll(/\bns\.([a-zA-Z.]+)\(/g)].map((x) => x[1]))].filter((n) => !['read', 'write', 'atExit', 'sleep', 'disableLog'].includes(n))
  if (nsCalls.join() !== 'stanek.chargeFragment') c.fail(`charge.js calls more than chargeFragment (RAM per thread): ${nsCalls.join(', ')}`)
  return c
}

async function sg6() {
  const c = new Check('SG6', 'the charging allocation is a comparison of simulated exits (NOT CALIBRATED: no gift run measured)')
  const { bestExitPolicy, expForLevel } = await import('../../exitplan.js')
  const base = { money: 8.85e9, incomePerSec: 39e6, hacking: 4051, hackingExp: expForLevel(4051, 9.25), hackingMult: 9.25, expPerSec: 190000, repPerSec: 200, exitRep: 0, exitFavor: 78, cycleHours: 0.625, multGainPerCycle: 1.34, exitLevel: 4500, joinMoney: 100e9, terminalRep: 2.5e6, donationCost: 791e9 }
  const H = (inp) => bestExitPolicy(inp, 6).best?.hours ?? null
  const layout = sp.LAYOUTS['6x5|2']
  const fleetHosts = [{ host: 'home', cores: 4, capGb: 2 ** 14 - 100 }, ...Array.from({ length: 25 }, (_, i) => ({ host: `p${i}`, cores: 1, capGb: 2 ** 12 }))]
  const ctx = { layout, nodePower: 2, fleetGB: 2 ** 14 + 25 * 2 ** 12, hosts: fleetHosts, fNow: 0.1, cycleH: base.cycleHours }
  const same = sp.chargeInputsOf(base, ctx, 0.1)
  c.examined(1)
  for (const k of ['incomePerSec', 'expPerSec', 'repPerSec', 'hackingMult']) if (Math.abs(same[k] / base[k] - 1) > 1e-12) c.fail(`f = fNow must reproduce the measured ${k}`, `${same[k]} vs ${base[k]}`)
  const priced = sp.allocOptionsOf(ctx.fleetGB, ctx.hosts).map((f) => ({ f, hours: H(sp.chargeInputsOf(base, ctx, f)) }))
  c.examined(priced.length)
  const ch = sp.chooseAlloc(priced, null)
  const min = Math.min(...priced.map((p) => p.hours))
  if (ch.hours !== min) c.fail(`chooseAlloc did not pick the fastest exit: ${ch.hours} vs ${min}`)
  c.note(`exits by f (home 16TB 4 cores + 25 x 4TB, fNow 0.1): ${priced.map((p) => `${p.f}:${p.hours?.toFixed(2)}h`).join(' ')} -> ${ch.why}`)
  const inc = sp.chooseAlloc([{ f: 0.1, hours: 10.05 }, { f: 0.2, hours: 10.0 }], 0.1)
  if (inc.f !== 0.1) c.fail('an incumbent within 0.1h must be kept', inc.why)
  // The RAM side: the same GB costs the batcher more when the fleet is smaller.
  const small = { ...ctx, hosts: [{ host: 'home', cores: 4, capGb: 2 ** 14 }], fleetGB: 2 ** 14, fNow: 0 }
  const big = { ...ctx, hosts: [{ host: 'home', cores: 4, capGb: 2 ** 14 }, { host: 'x', cores: 1, capGb: 0, maxRam: 7 * 2 ** 14 }], fleetGB: 8 * 2 ** 14, fNow: 0 }
  const lnS = sp.chargeLnOf({ ...small, f: 0.5 })
  const lnB = sp.chargeLnOf({ ...big, f: 1 / 16 })
  if (!(lnS.gb === lnB.gb && lnS.lnIncome < lnB.lnIncome)) c.fail(`the RAM side is not priced: ${lnS.gb}GB of a ${small.fleetGB}GB fleet lnIncome ${lnS.lnIncome} vs of ${big.fleetGB}GB ${lnB.lnIncome}`)
  // highestCharge is ONE script's power: the same GB in one script beats it split (the placement concentrates)
  const one = sp.chargerPlaceOf(64, [{ host: 'a', cores: 1, capGb: 64 }, { host: 'b', cores: 1, capGb: 32 }, { host: 'c', cores: 1, capGb: 32 }])
  if (one.H !== 32 || one.hosts.length !== 1 || one.hosts[0].host !== 'a') c.fail('chargerPlaceOf must fill the largest host first (H = one script)', JSON.stringify(one))
  const cored = sp.chargerPlaceOf(32, [{ host: 'a', cores: 1, capGb: 32 }, { host: 'b', cores: 8, capGb: 32 }])
  if (cored.hosts[0].host !== 'b') c.fail('chargerPlaceOf must weigh the core bonus (same GB, more cores first)', JSON.stringify(cored))
  const split = sp.chargeLnOf({ layout, nodePower: 2, fleetGB: 128, hosts: [{ host: 'a', cores: 1, capGb: 32 }, { host: 'b', cores: 1, capGb: 32 }], f: 0.5, cycleH: 1 })
  const whole = sp.chargeLnOf({ layout, nodePower: 2, fleetGB: 128, hosts: [{ host: 'a', cores: 1, capGb: 64 }], f: 0.5, cycleH: 1 })
  if (!(whole.lnHack > split.lnHack)) c.fail(`one 32-thread script must out-charge two 16-thread ones: ${whole.lnHack} vs ${split.lnHack}`)
  const hold = { at: new Date().toISOString(), lastAugReset: 1, charger: { hosts: [{ host: 'a', target: 50, now: 20 }, { host: 'b', target: 8, now: 8 }] } }
  if (JSON.stringify(sp.stanekHoldsOf(hold, 1)) !== JSON.stringify([{ host: 'a', gb: 60 }])) c.fail('stanekHoldsOf must hold each host\'s target GB not yet held', JSON.stringify(sp.stanekHoldsOf(hold, 1)))
  if (sp.stanekHoldsOf({ ...hold, lastAugReset: 2 }, 1).length) c.fail('stanekHoldsOf must ignore another life')
  return c
}

/**
 * SG8 THE LIVE SHAPE (BN13.1 2026-10-11 00:14Z): a 128GB 1-core home with residents and
 * progress.js's 19.25GB block leaving no 2GB thread, rooted 32GB/16GB hosts — one with
 * free RAM, the rest full of batch h/g/w — and no plan decision yet. The charger must
 * run on the fleet at DEFAULT_F (labelled UNPRICED), batch.js must hold the rest on the
 * worker-filled targets, the heartbeats must be gathered home, and the fragments charge.
 * RED: the same shape with home the only rooted host -> no thread anywhere and
 * FRAGMENTS NOT CHARGING naming the binding cause (residents and reserves fill it).
 */
async function sg8() {
  const c = new Check('SG8', 'the live BN13.1 shape: home full, rooted hosts free or full of h/g/w, no decision -> the charger runs on the fleet')
  const w = (n) => [{ filename: 'w.js', threads: n }]
  const others = [
    { host: 'iron-gym', max: 32, used: 5.25, workers: w(3) },
    ...['max-hardware', 'zer0', 'neo-net'].map((host) => ({ host, max: 32, used: 31.5, workers: w(18) })),
    ...['harakiri-sushi', 'nectar-net', 'foodnstuff'].map((host) => ({ host, max: 16, used: 15.75, workers: w(9) })),
    { host: 'sigma-cosmetics', max: 16, used: 15.2, workers: [] }, // residents (buyserv, bb-lite)
    { host: 'n00dles', max: 4, used: 4, workers: [] },
  ]
  const g = mockGame({ homeMax: 128, homeUsed: 110, homeCores: 1, others })
  const rec = await g.run()
  c.examined(1)
  const ch = rec?.charger ?? {}
  const onFleet = g.procs.filter((p) => p.filename === 'charge.js')
  if (!(ch.threads > 0) || !onFleet.length) c.fail(`no charger thread anywhere: ${ch.why}`, JSON.stringify(ch).slice(0, 400))
  if (onFleet.some((p) => p.host === 'home')) c.fail('a charger on home, which has no 2GB thread beyond progress.js\'s block')
  if (!onFleet.every((p) => p.args[2] === p.host)) c.fail('charge.js must be told its host (args[2]) for its heartbeat file', JSON.stringify(onFleet.map((p) => p.args)))
  if (!/UNPRICED/.test(rec?.alloc?.source ?? '')) c.fail('no decision yet: the allocation must say DEFAULT_F, UNPRICED', rec?.alloc?.source)
  const fleetGB = 128 + 4 * 32 + 4 * 16 + 4
  if (ch.want !== Math.floor((sp.DEFAULT_F * fleetGB) / 2) || rec?.fleet?.gb !== fleetGB) c.fail(`want ${ch.want} / fleet ${rec?.fleet?.gb}: expected DEFAULT_F x ${fleetGB}GB fleet`)
  const holds = sp.stanekHoldsOf(rec, 1000)
  if (ch.threads < ch.want && !holds.length) c.fail('short of its target on worker-filled hosts and batch.js holds nothing there', JSON.stringify(ch.hosts))
  if (holds.some((h) => h.host === 'home')) c.fail('a hold on home, which the placement never targets here', JSON.stringify(holds))
  const ig = ch.hosts?.find((h) => h.host === 'iron-gym')
  if (!(ig?.now > 0)) c.fail('iron-gym (32GB, 26.75GB free) must charge at once', JSON.stringify(ch.hosts))
  if (rec?.health === 'fail') c.fail(`stanek.js health fail on the live shape: ${rec?.why}`)
  c.note(`live shape: ${ch.threads}/${ch.want} threads on ${onFleet.map((p) => `${p.host}:${p.threads}`).join(' ')}, H ${ch.H} (target ${ch.Htarget}); holds ${holds.map((h) => `${h.host}:${h.gb}GB`).join(' ') || 'none'}; ${rec?.why}`)
  // heartbeats: charge.js writes on its host; stanek.js gathers them home
  for (const p of onFleet) g.remote[`${p.host}:/tel/charge-${p.host}.txt`] = JSON.stringify({ at: new Date().toISOString(), lastAugReset: 1000, host: p.host, error: null })
  g.tick(20)
  g.files[sp.STANEK_FILE] = JSON.stringify({ ...rec, at: new Date(Date.now() - 5 * 60e3).toISOString() })
  const rec2 = await g.run()
  const beats = JSON.parse(g.files[sp.CHARGE_FILE] ?? 'null')
  if (!onFleet.every((p) => beats?.hosts?.[p.host]?.host === p.host)) c.fail('the fleet heartbeats were not gathered into /tel/charge.txt', JSON.stringify(beats).slice(0, 300))
  if (!(rec2?.progress?.gained > 0)) c.fail('the gift charged (20 rounds) and the record shows no gain', JSON.stringify(rec2?.progress))
  if (rec2?.fragments?.every((f) => !(f.highestCharge > 0))) c.fail('every fragment still at 0 charge after the charger ran')
  const h2 = sp.stanekHealthOf({ stanek: rec2, charge: beats, now: Date.now() })
  if (h2.some((p) => p.problem === 'FRAGMENTS NOT CHARGING')) c.fail('charging on the fleet must be healthy', JSON.stringify(h2))
  // the batcher yields: the held hosts' workers finish -> the next pass reaches the target
  for (const h of holds) {
    const o = g.hosts.get(h.host)
    const wGb = o.workers.reduce((s, x) => s + x.threads * 1.75, 0)
    o.used -= wGb
    o.workers = []
  }
  const rec3 = await g.run()
  if (holds.length && !(rec3?.charger?.threads > ch.threads)) c.fail(`the batcher yielded and the charger did not grow: ${ch.threads} -> ${rec3?.charger?.threads}`, rec3?.charger?.why)
  // RED: home the only rooted host (the old home-only charger's world)
  const r = mockGame({ homeMax: 128, homeUsed: 110, homeCores: 1 })
  const rr = await r.run()
  const hr = sp.stanekHealthOf({ stanek: rr, charge: null, now: Date.now() })
  const nc = hr.find((p) => p.problem === 'FRAGMENTS NOT CHARGING')
  if (!nc || !/no rooted host has a 2GB thread of room/.test(nc.detail) || !/GB room beyond a [\d.]+GB reserve/.test(nc.detail)) c.fail('RED RUN NOT CAUGHT: home-only and full must fail FRAGMENTS NOT CHARGING naming the binding cause (residents and the reserve)', JSON.stringify(hr))
  else c.note(`red run (home only, full): ${nc.detail}`)
  return c
}

// SG10 THE LAYOUT PER LIFE, IN THE GAME (stanek.js on the mock): life 1 on the tabled layout; an
//      install (new lastAugReset) with the plan's decision of this life -> stanek.js re-lays to it
//      and charges it, the record names the life (index 2), its key and why; a second pass does
//      not re-lay; no decision -> the incumbent is KEPT (no clear); a decision past the install
//      window is not followed; the Bladeburner route keeps BLADE_LAYOUTS. STANEK LAYOUT STALE
//      when the placed layout is not the decided one 15 min in, or no decision after 60 min.
async function sg10() {
  const c = new Check('SG10', "the life's layout: re-laid at an install to the plan's decision, kept otherwise, health on the match")
  const g = mockGame({ node: 13, sf13: 1, installed: [NFG, GEN] })
  const t0 = Date.now()
  g.lastAugReset = t0 - 90 * 60e3
  const r1 = await g.run()
  const tab = sp.layoutForGrid(6, 6, 2).placed
  c.examined(1)
  if (!sp.sameLayout(g.active(), tab)) c.fail('life 1 on an empty grid must place the tabled layout', JSON.stringify(g.active()))
  if (r1?.lifeLayout?.lifeIndex !== 1 || r1.lifeLayout.decided !== false) c.fail('life 1 record: index 1, not decided (no plan)', JSON.stringify(r1?.lifeLayout))
  // the install: the charge clears, the layout stays (StaneksGift.ts:226-228)
  g.charge = new Map()
  g.lastAugReset = t0 - 2 * 60e3
  const alt = sp.LAYOUTS['6x5|2']
  const decision = { key: sp.layoutKeyOf(alt), placed: alt, lifeKey: g.lastAugReset, why: 'the live exit model (test)', weights: { Hacking: 1 }, decidedAt: new Date().toISOString(), source: 'live weights' }
  g.files['/tel/plan.txt'] = JSON.stringify({ at: new Date().toISOString(), lastAugReset: g.lastAugReset, decisions: { stanek: { f: 0.1, basis: 'fleet', why: 't', layout: decision } } })
  const r2 = await g.run()
  const relays = () => g.log.filter((e) => e.ev === 'place' || e.ev === 'remove' || e.ev === 'clear').length
  const relays0 = relays()
  c.examined(1)
  if (!sp.sameLayout(g.active(), alt)) c.fail("an install with the plan's decision of this life: stanek.js did not re-lay to it", JSON.stringify(g.active()))
  if (r2?.lifeLayout?.key !== decision.key || r2.lifeLayout.lifeIndex !== 2 || !r2.lifeLayout.decided || !r2.lifeLayout.relaid) c.fail('the life 2 record must carry the decided key, index 2, decided, relaid', JSON.stringify(r2?.lifeLayout))
  if (r2?.layout?.placedKey !== decision.key) c.fail('rec.layout.placedKey must be the placed layout', JSON.stringify(r2?.layout))
  const roots = JSON.stringify(sp.chargeRootsOf(alt))
  if (!g.procs.some((p) => p.filename === 'charge.js' && p.args[0] === roots)) c.fail("the charger must charge the re-laid layout's fragments", JSON.stringify(g.procs.map((p) => p.args[0])))
  if (sp.stanekHealthOf({ stanek: r2, charge: null, now: Date.now() }).some((p) => p.problem === 'STANEK LAYOUT STALE')) c.fail('placed = decided: no STANEK LAYOUT STALE')
  await g.run()
  if (relays() !== relays0) c.fail('a second pass of the same life re-laid (it must place only when the layout differs)')
  // the next install, no decision of it yet: the incumbent stays (no clear)
  g.lastAugReset = t0 - 60e3
  const r3 = await g.run()
  c.examined(1)
  if (!sp.sameLayout(g.active(), alt) || relays() !== relays0) c.fail('no decision of this life: the incumbent must be kept (no re-lay)')
  if (r3?.lifeLayout?.decided !== false || r3.lifeLayout.lifeIndex !== 3) c.fail('life 3 record: index 3, not decided', JSON.stringify(r3?.lifeLayout))
  // a decision arriving past the install window is not followed (the re-lay would delete the charge: L2)
  g.lastAugReset = t0 - (sp.LIFE_LAYOUT_WINDOW_MIN + 5) * 60e3
  g.files['/tel/plan.txt'] = JSON.stringify({ at: new Date().toISOString(), lastAugReset: g.lastAugReset, decisions: { stanek: { f: 0.1, basis: 'fleet', why: 't', layout: { ...decision, key: sp.layoutKeyOf(tab), placed: tab, lifeKey: g.lastAugReset } } } })
  await g.run()
  if (!sp.sameLayout(g.active(), alt)) c.fail('a decision past the install window was followed (re-laid mid-life)')
  // health: placed != decided 20 min in -> STALE; a hack life with no decision 90 min in -> STALE
  const now = Date.now()
  const lar = now - 20 * 60e3
  const st = { at: new Date(now).toISOString(), lastAugReset: lar, gift: { accepted: true, basis: 'hack' }, layout: { placed: alt, placedKey: 'X' }, lifeLayout: { lastAugReset: lar, key: 'Y', decided: true, source: 'plan' } }
  c.examined(3)
  if (!sp.lifeLayoutHealthOf(st, now).some((p) => p.problem === 'STANEK LAYOUT STALE')) c.fail('placed != decided 20 min into the life: no STANEK LAYOUT STALE')
  if (sp.lifeLayoutHealthOf({ ...st, lastAugReset: now - 5 * 60e3, lifeLayout: { ...st.lifeLayout, lastAugReset: now - 5 * 60e3 } }, now).length) c.fail('placed != decided 5 min in: inside the grace, must not fail yet')
  const und = { ...st, lastAugReset: now - 90 * 60e3, layout: { placedKey: 'Y' }, lifeLayout: { lastAugReset: now - 90 * 60e3, key: 'Y', decided: false, why: 'no decision' } }
  if (!sp.lifeLayoutHealthOf(und, now).some((p) => /no decision/.test(p.detail))) c.fail('a hacking life 90 min in with no decision: no STANEK LAYOUT STALE')
  if (sp.lifeLayoutHealthOf({ ...und, gift: { accepted: true, basis: 'blade' } }, now).length) c.fail('the Bladeburner route (one tabled layout per node) must not need a life decision')
  // the Bladeburner route: BLADE_LAYOUTS whatever the plan says (SG9 places it; here the plan's layout is ignored)
  const bl = mockGame({ node: 11, sf13: 1, installed: [NFG, GEN], progressRoute: 'blade', extraSf: [[7, 1], [6, 3]] })
  bl.lastAugReset = 1000
  bl.files['/tel/plan.txt'] = JSON.stringify({ at: new Date().toISOString(), lastAugReset: 1000, decisions: { stanek: { layout: { ...decision, lifeKey: 1000 } } } })
  const rb = await bl.run()
  const gs = sp.giftSize(0, 1)
  c.examined(1)
  if (rb?.gift?.basis === 'blade' && !sp.sameLayout(bl.active(), sp.layoutForGrid(gs.width, gs.height, 1, 'blade').placed)) c.fail('the Bladeburner route must keep its tabled layout', JSON.stringify(rb?.lifeLayout))
  c.note(`life 1 tabled ${sp.layoutKeyOf(tab)} -> life 2 re-laid to the plan's ${decision.key} (charged), life 3 kept, a late decision not followed; blade basis ${rb?.gift?.basis}: ${rb?.lifeLayout?.key}`)
  return c
}

// SG11 THE LIFE'S LAYOUT IS A COMPARISON OF SIMULATED EXITS (liveWeightInputsOf / liveLayoutOptionsOf /
//      liveLayoutChoiceOf on exitplan.bestExitPolicy): the weights are (H0 - H(type x e^d)) / d on the
//      same inputs; every option is a trajectory from the same base; the choice is the fastest exit,
//      the incumbent kept within tolerance. progress.js prices it through the trajectory (static).
async function sg11() {
  const c = new Check('SG11', "the life's layout is the fastest of the simulated exits; weights = the exit's marginal hours")
  const { bestExitPolicy, expForLevel } = await import('../../exitplan.js')
  // SG6's measured BN5 shape (hacking 4051/4500, mult 9.25, 0.625h lives) with no gift charged
  const raw = { money: 8.85e9, incomePerSec: 39e6, hacking: 4051, hackingExp: expForLevel(4051, 9.25), hackingMult: 9.25, expPerSec: 190000, repPerSec: 200, exitRep: 0, exitFavor: 78, cycleHours: 0.625, multGainPerCycle: 1.34, exitLevel: 4500, joinMoney: 100e9, terminalRep: 2.5e6, donationCost: 791e9 }
  const hoursOf = (inp) => bestExitPolicy(inp, 6).best?.hours ?? null
  const hosts = [{ host: 'home', cores: 4, capGb: 2 ** 14 - 100 }, ...Array.from({ length: 25 }, (_, i) => ({ host: `p${i}`, cores: 1, capGb: 2 ** 12 }))]
  const tab = sp.layoutForGrid(6, 6, 2).placed
  const ctx0 = { layout: [], nodePower: 2, fleetGB: 2 ** 14 + 25 * 2 ** 12, hosts, fNow: 0, cycleH: raw.cycleHours }
  const f = 0.2
  const base = sp.layoutInputsOf(raw, ctx0, f, tab)
  const ctx = { ...ctx0, layout: tab, fNow: f }
  // the incumbent's option IS the measured trajectory (same inputs, same hours)
  const H0 = hoursOf(base)
  const same = hoursOf(sp.layoutInputsOf(base, ctx, f, tab))
  c.examined(1)
  if (!(Math.abs(same - H0) < 1e-9)) c.fail(`the incumbent at the measured f must be the measured trajectory: ${same} vs ${H0}`)
  const wIn = sp.liveWeightInputsOf(base)
  const wp = wIn.map((x) => ({ type: x.type, hours: hoursOf(x.inputs) }))
  const w = sp.liveWeightsOf(H0, wp)
  for (const p of wp) {
    c.examined(1)
    if (Math.abs(w[p.type] - Math.max(0, (H0 - p.hours) / sp.LIFE_DLN)) > 1e-12) c.fail(`weight ${sp.TYPE_NAME[p.type]} is not (H0 - H(bumped)) / d`)
  }
  if (!(w[sp.TYPE.Hacking] > 0)) c.fail('a larger hacking multiplier must shorten the exit (weight > 0)', JSON.stringify(w))
  const { options, c: cL } = sp.liveLayoutOptionsOf({ base, ctx, f, width: 6, height: 6, nodePower: 2, incumbent: tab }, w)
  const priced = options.map((o) => ({ ...o, hours: hoursOf(o.inputs) }))
  const ch = sp.liveLayoutChoiceOf(priced, { lifeKey: 7, weights: w, c: cL, f, H0 })
  const min = Math.min(...priced.map((p) => p.hours))
  const inc = priced.find((p) => p.src === 'incumbent')
  c.examined(2)
  if (!(ch.hours === +(inc.hours - min >= 0.01 ? min : inc.hours).toFixed(3))) c.fail(`the choice is not the fastest exit (or the incumbent within 0.01h): ${ch.hours} vs ${JSON.stringify(priced.map((p) => [p.src, p.hours]))}`)
  // a synthetic option faster by 1h is taken; one faster by 0.001h is not (the incumbent kept)
  const fast = sp.liveLayoutChoiceOf([{ src: 'incumbent', key: 'A', placed: tab, hours: 10 }, { src: 'live weights', key: 'B', placed: tab, hours: 9 }], { lifeKey: 7, weights: w, c: cL, f, H0 })
  const near = sp.liveLayoutChoiceOf([{ src: 'incumbent', key: 'A', placed: tab, hours: 10 }, { src: 'live weights', key: 'B', placed: tab, hours: 9.999 }], { lifeKey: 7, weights: w, c: cL, f, H0 })
  c.examined(2)
  if (fast.key !== 'B' || fast.dH !== -1) c.fail('an option 1h faster than the incumbent must be taken', JSON.stringify(fast))
  if (near.key !== 'A') c.fail('an option 0.001h faster must not displace the incumbent', JSON.stringify(near))
  if (ch.lifeKey !== 7 || !ch.weights || !/exit hours/.test(ch.weightsUnit)) c.fail('the record must carry its life, the weights it used and their unit', JSON.stringify(ch))
  // progress.js: the layout options are priced through the trajectory simulator, once per life
  const pr = fs.readFileSync(path.join(REPO, 'progress.js'), 'utf8')
  c.examined(1)
  if (!/liveWeightInputsOf\(baseF\)/.test(pr) || !/lp\.push\(\{ \.\.\.o, hours: yield\* tg\(o\.inputs\) \}\)/.test(pr) || !/liveLayoutChoiceOf\(lp,/.test(pr)) c.fail('progress.js stanekDecisionOf must price the life layout options through the trajectory simulator (tg)')
  if (!/prev\?\.layout\?\.lifeKey === info\.lastAugReset \? prev\.layout : null/.test(pr)) c.fail('progress.js must carry the life layout decision for the rest of the life')
  if (!/if \(!layout && lifeMin <= LIFE_LAYOUT_WINDOW_MIN && typeof st\.layout\.width === 'number'\) \{/.test(pr)) c.fail('progress.js must decide the life layout whenever the life is young and none is carried (the gate on the decision changed)')
  if (!/layout: layout \?\? \{ key: null, lifeKey: info\.lastAugReset/.test(pr)) c.fail('progress.js must publish decisions.stanek.layout (or why there is none) every priced decision')
  c.note(`SG6's BN5 shape, life ${raw.cycleHours}h, 6x6|2 at f ${f}: weights ${JSON.stringify(ch.weights)}; ${ch.why.slice(0, 260)}`)
  return c
}

// SG12 THE PER-LIFE POLICY IN THE NODE MODEL (stanekplan.lifePolicyOf, the gameplan's): never slower
//      than the fixed layout (J >= Jfixed), and on BN13.2's grid it re-lays at least one life — the
//      final life (the exit level) on a different layout from the build lives. Weights per life are
//      the finite difference of J with only that life's multipliers bumped.
async function sg12() {
  const c = new Check('SG12', 'the per-life policy in the node model: never worse than fixed, the final life its own layout')
  const st = await import('../sim/gameplan/stanek.mjs')
  const { SF_PARAMS } = await import('../sim/gameplan/effects.mjs')
  const world = { sf: Object.fromEntries(Object.entries(SF_PARAMS).map(([k, v]) => [k, v.mid])), cycleHours: 2.6, profile: null }
  const m = { StaneksGiftPowerMultiplier: 2, StaneksGiftExtraSize: 1, AugmentationRepCost: 1, HackExpGain: 1, HackingSpeedMultiplier: 1 }
  const { lay, base } = st.giftBaseOf(13, 1, world, m, { H0: 25, g: 0.1 })
  const o = { ...base, hours: 16.6, f: 0.3 }
  const pol = sp.lifePolicyOf(o, { width: lay.width, height: lay.height, budget: 2e4, g: 0.1 })
  c.examined(3)
  if (!(pol.J >= pol.Jfixed - 1e-12)) c.fail(`the per-life policy is slower than the fixed layout in the model: J ${pol.J} < ${pol.Jfixed}`)
  if (!(pol.dJ > 0) || !pol.lives.some((l) => l.changed)) c.fail('on BN13.2 no life was re-laid (the per-life choice is not running)', JSON.stringify(pol.lives.map((l) => l.key)))
  const fin = pol.lives[pol.lives.length - 1]
  if (fin.stage !== 'final' || !(fin.weights[sp.TYPE.Hacking] > 3 * pol.lives[0].weights[sp.TYPE.Hacking])) c.fail('the final life must carry the exit level (Hacking weight far above a build life)', JSON.stringify([pol.lives[0].weights, fin.weights]))
  const J0 = sp.nodeModel({ ...o, layouts: pol.layouts }).J
  const i = 0
  const wb = sp.nodeModel({ ...o, layouts: pol.layouts, bump: { life: i, type: sp.TYPE.Rep, d: sp.LIFE_DLN } }).J
  if (Math.abs(sp.lifeWeightsOf({ ...o, layouts: pol.layouts }, i, { g: 0.1 })[sp.TYPE.Rep] - Math.max(0, (wb - J0) / sp.LIFE_DLN / 0.1)) > 1e-9) c.fail('a life weight is not the finite difference of J in that life')
  c.note(`BN13.2 6x6|2, ${pol.lives.length} lives: dJ ${pol.dJ.toFixed(4)} (${(pol.dJ / 0.1).toFixed(3)}h at g 0.1); ${pol.lives.map((l) => `${l.life + 1}:${l.stage}${l.changed ? '*' : ''}`).join(' ')}`)
  return c
}

// SG13 THE RE-LAY'S CHARGE IN THE SIMULATORS (L2): stanekplan.chargeTrackOf with one layout IS
//      bladeChargeAt (every step, 30h); a re-lay keeps an unchanged fragment's charge and starts a new
//      one at 0 (highestCharge back on its first step, numCharge +duty/k per second); bbsim's phase
//      plan with one phase equals its chargeAt path, and a two-phase plan re-lays once, when its
//      condition holds, one pass later; the hacking exit model's chargeLnSwitchOf is chargeLnOf with
//      no switch, and a re-lay that keeps the Hacking fragment keeps its charge (lnHack not below
//      the layout held). RED: a tracker that restarts every fragment, a switch never priced.
async function sg13() {
  const c = new Check('SG13', "the re-lay's charge in the simulators: kept fragments keep it, the rest regrow; one phase = the old path")
  const pl = sp.BLADE_LAYOUTS['6x5|1']
  const k = sp.chargeRootsOf(pl).length
  const thrAt = sp.bladeThrAt({ gbMax: 512 })
  const old = sp.bladeChargeAt({ gbMax: 512, k })
  const tr = sp.chargeTrackOf({ thrAt, duty: sp.BLADE_HOST.duty }).relay(pl, 0)
  let md = 0
  for (let t = 0; t < 30 * 3600; t += 97) {
    const a = old(t)
    const b = tr.at(t)
    pl.forEach((p, i) => {
      if (sp.fragmentById(p.id).type !== sp.TYPE.Booster) md = Math.max(md, Math.abs(a.numCharge - b[i].numCharge) + Math.abs(a.highestCharge - b[i].highestCharge))
    })
  }
  c.examined(1)
  if (md !== 0) c.fail(`chargeTrackOf with one layout must be bladeChargeAt exactly: max diff ${md}`)
  // a re-lay at 5h: the Strength fragment (id 10) removed, one fragment re-rooted elsewhere is new
  const t5 = 5 * 3600
  const tr2 = sp.chargeTrackOf({ thrAt, duty: sp.BLADE_HOST.duty }).relay(pl, 0)
  const before = tr2.at(t5)
  const minus = pl.filter((p) => p.id !== 10)
  tr2.relay(minus, t5)
  const after = tr2.at(t5)
  const after1 = tr2.at(t5 + 60)
  c.examined(2)
  minus.forEach((p, i) => {
    const j = pl.findIndex((q) => sp.fragKeyOf(q) === sp.fragKeyOf(p))
    if (sp.fragmentById(p.id).type === sp.TYPE.Booster) return
    if (Math.abs(after[i].numCharge - before[j].numCharge) > 1e-9) c.fail(`an unchanged fragment (${p.id}) lost its charge at the re-lay`, JSON.stringify([before[j], after[i]]))
    const k2 = sp.chargeRootsOf(minus).length
    const want = before[j].numCharge * before[j].highestCharge + (sp.BLADE_HOST.duty * thrAt(t5) * 60) / k2
    if (Math.abs(after1[i].numCharge * after1[i].highestCharge - want) > 1e-6) c.fail(`after the re-lay the round robin runs over the new k (${k2}): fragment ${p.id} mass ${after1[i].numCharge * after1[i].highestCharge} vs ${want}`)
  })
  const fresh = sp.chargeTrackOf({ thrAt, duty: 1 }).relay(pl, 0)
  fresh.at(t5)
  fresh.relay([...minus, { id: 10, x: 1, y: 0, rot: 0 }].filter((p, i, a) => a.findIndex((q) => sp.fragKeyOf(q) === sp.fragKeyOf(p)) === i), t5) // the same Strength back: kept
  const back = fresh.at(t5)
  const bi = fresh.placed().findIndex((p) => p.id === 10)
  if (!(back[bi].numCharge > 1000)) c.fail('a fragment placed back with the same id, root and rotation must keep its charge (it is unchanged)', JSON.stringify(back[bi]))
  const moved = sp.chargeTrackOf({ thrAt, duty: 1 }).relay(pl, 0)
  moved.at(t5)
  const mv = [...minus]
  moved.relay(mv, t5)
  moved.relay([...mv, { id: 10, x: 1, y: 0, rot: 0 }], t5 + 1)
  const m1 = moved.at(t5 + 61)
  const mi = moved.placed().findIndex((p) => p.id === 10)
  c.examined(1)
  if (!(m1[mi].highestCharge === thrAt(t5 + 60) && Math.abs(m1[mi].numCharge - 60 / sp.chargeRootsOf(moved.placed()).length) < 1e-9)) c.fail('a removed then re-placed fragment must start from 0: highestCharge = the threads on its first step, numCharge = duty x 60 / k', JSON.stringify(m1[mi]))
  // bbsim: one phase == the chargeAt path; two phases re-lay once at the condition, a pass later
  const { runBladeburner } = await import('../sim/nodechoice/bbsim.mjs')
  const { specOf } = await import('../sim/bbstanek.mjs')
  const spec = specOf({ node: 11, l6: 3, l7: 1, l13: 1, seed: 1 })
  const a = runBladeburner({ ...spec, stanek: { placed: pl, chargeAt: sp.bladeChargeAt({ gbMax: 512, k }) } })
  const b = runBladeburner({ ...spec, stanek: { phases: [{ placed: pl, when: null }], thrAt, duty: sp.BLADE_HOST.duty } })
  // the late layout: only the Strength fragment and its boosters (agility/dexterity/Bladeburner removed: a real change)
  const strOnly = pl.filter((p) => [sp.TYPE.Strength, sp.TYPE.Booster].includes(sp.fragmentById(p.id).type))
  const two = runBladeburner({ ...spec, stanek: { phases: [{ placed: pl, when: null }, { placed: strOnly, when: { blackOps: 1 } }], thrAt, duty: sp.BLADE_HOST.duty, lagS: 300 } })
  c.examined(2)
  if (a.hours !== b.hours || JSON.stringify(a.stanek) !== JSON.stringify(b.stanek)) c.fail(`bbsim's one-phase plan must equal its chargeAt path: ${a.hours}h vs ${b.hours}h`)
  const sw = two.stanekSwitches ?? []
  if (sw.length !== 1 || !(sw[0].blackOps >= 1)) c.fail('a two-phase plan must re-lay exactly once, after its condition (1 black op)', JSON.stringify(sw))
  if (!(two.hours > b.hours)) c.fail(`dropping agility/dexterity/Bladeburner at the first black op must slow the exit (the switch is not simulated): ${two.hours}h vs ${b.hours}h`)
  // the hacking exit model
  const A = sp.LAYOUTS['6x6|2']
  const hosts = [{ host: 'home', cores: 4, capGb: 2 ** 14 }]
  const ctx = { layout: A, nodePower: 2, fleetGB: 2 ** 15, hosts, f: 0.2, cycleH: 6 }
  const held = sp.chargeLnOf(ctx)
  const none = sp.chargeLnSwitchOf({ ...ctx, layoutB: A, tsH: 6 })
  c.examined(3)
  if (JSON.stringify(none) !== JSON.stringify(held)) c.fail('chargeLnSwitchOf with tsH >= the life must be chargeLnOf')
  const self = sp.chargeLnSwitchOf({ ...ctx, layoutB: A, tsH: 3 })
  if (!(Math.abs(self.lnHack - held.lnHack) < 1e-12 && Math.abs(self.lnIncome - held.lnIncome) < 1e-12 && self.relay?.kept === A.length)) c.fail(`a re-lay to the same layout keeps every charge: lnHack ${self.lnHack} vs held ${held.lnHack}`, JSON.stringify(self.relay))
  const noGrow = A.filter((p) => sp.fragmentById(p.id).type !== sp.TYPE.HackingGrow)
  const sw2 = sp.chargeLnSwitchOf({ ...ctx, layoutB: noGrow, tsH: 3 })
  if (!(sw2.lnHack >= held.lnHack - 1e-9)) c.fail(`a re-lay that keeps the Hacking fragments (and drops HackingGrow: k smaller) must not lower lnHack: ${sw2.lnHack} < ${held.lnHack}`)
  const allNew = sp.chargeLnSwitchOf({ ...ctx, layoutB: noGrow.map((p) => ({ ...p })).reverse(), tsH: 3 })
  // a re-lay that drops the Hacking fragments must cost lnHack (the switch is priced, not ignored)
  const noHack = A.filter((p) => sp.fragmentById(p.id).type !== sp.TYPE.Hacking)
  const sw3 = sp.chargeLnSwitchOf({ ...ctx, layoutB: noHack, tsH: 3 })
  c.examined(1)
  if (!(sw3.lnHack < held.lnHack - 0.05)) c.fail(`dropping the Hacking fragments at mid-life must lower the life's lnHack: ${sw3.lnHack} vs held ${held.lnHack}`)
  c.note(`one layout = bladeChargeAt (max diff ${md}); bbsim BN11 one phase ${b.hours?.toFixed(3)}h, re-laid at ${sw[0]?.h}h (${sw[0]?.blackOps} black ops) -> ${two.hours?.toFixed(3)}h; hacking 6x6|2 life 6h: lnHack held ${held.lnHack.toFixed(4)}, self-switch ${self.lnHack.toFixed(4)}, drop HGrow at 3h ${sw2.lnHack.toFixed(4)} (kept ${sw2.relay?.kept}/${allNew.relay?.kept})`)
  return c
}

// SG14 THE PHASE PLAN IN THE GAME (stanek.js on the mock, the Bladeburner route): the plan's early
//      layout on an empty grid; below the condition it stays; once /tel/bladeburner.txt shows it, the
//      next pass re-lays to the late layout BY DIFF — unchanged fragments keep their charge, the
//      removed one is gone, no clearGift — and charges it; the record names the step (switching,
//      met, metAt); then 'late'. A condition read off a stale record is not met. A placed layout that
//      is not the early one is held (the switch was not priced from it). Health STANEK PHASE SWITCH
//      LATE when a priced switch came due 15+ min ago and has not landed.
async function sg14() {
  const c = new Check('SG14', 'the phase plan in the game: early, then re-laid by diff at the condition (charge kept), health on a late switch')
  const g = mockGame({ node: 11, sf13: 1, installed: [NFG, GEN], progressRoute: 'blade', extraSf: [[7, 1], [6, 3]] })
  const early = sp.BLADE_LAYOUTS['6x5|1']
  const late = early.filter((p) => p.id !== 10)
  const when = { blackOps: 6 }
  const planTxt = () => JSON.stringify({ at: new Date().toISOString(), lastAugReset: 1000, decisions: { stanek: { phase: { planned: true, early, late, when, d: -0.1 } } } })
  const bbTxt = (done, at = new Date().toISOString()) => JSON.stringify({ at, bitNode: 11, lastAugReset: 1000, rank: 50000, blackOps: { done } })
  g.files['/tel/plan.txt'] = planTxt()
  g.files['/tel/bladeburner.txt'] = bbTxt(2)
  const r1 = await g.run()
  c.examined(1)
  if (!sp.sameLayout(g.active(), early) || r1?.lifeLayout?.phase?.state !== 'early') c.fail('the phase plan must place its early layout on an empty grid', JSON.stringify(r1?.lifeLayout))
  g.tick(500)
  g.files['/tel/bladeburner.txt'] = bbTxt(5)
  await g.run()
  c.examined(1)
  if (!sp.sameLayout(g.active(), early)) c.fail('below the condition (5 < 6 black ops) the early layout must stay')
  g.tick(500)
  const charge0 = new Map(g.charge)
  g.files['/tel/bladeburner.txt'] = bbTxt(7, new Date(Date.now() - 60 * 60e3).toISOString()) // stale: unreadable
  const rs = await g.run()
  if (!sp.sameLayout(g.active(), early) || rs?.lifeLayout?.phase?.met) c.fail('a stale /tel/bladeburner.txt must not meet the condition')
  g.files['/tel/bladeburner.txt'] = bbTxt(6)
  const clears = g.log.filter((e) => e.ev === 'clear').length
  const r2 = await g.run()
  c.examined(3)
  if (!sp.sameLayout(g.active(), late)) c.fail('at the condition (6 black ops) stanek.js must re-lay to the late layout', JSON.stringify(g.active()))
  if (g.log.filter((e) => e.ev === 'clear').length !== clears) c.fail('the re-lay must be a diff, never clearGift (it deletes every charge)')
  for (const p of late) {
    if (sp.fragmentById(p.id).type === sp.TYPE.Booster) continue
    const k = `${p.x},${p.y}`
    if (!(g.charge.get(k)?.numCharge > 0) || g.charge.get(k)?.numCharge !== charge0.get(k)?.numCharge) c.fail(`an unchanged fragment (${p.id} at ${k}) lost its charge in the re-lay`, JSON.stringify([charge0.get(k), g.charge.get(k)]))
  }
  const st10 = early.find((p) => p.id === 10)
  if (g.charge.has(`${st10.x},${st10.y}`)) c.fail('the removed fragment must be gone with its charge')
  const ph = r2?.lifeLayout?.phase
  if (ph?.state !== 'switching' || !ph.met || !ph.metAt || !ph.switchPriced || r2?.lifeLayout?.relay?.removed !== 1) c.fail('the record must name the switch (switching, met, metAt, switchPriced; relay removed 1)', JSON.stringify(r2?.lifeLayout))
  if (r2?.charger?.roots !== sp.chargeRootsOf(late).length) c.fail("the charger must charge the late layout's fragments", JSON.stringify(r2?.charger))
  if (sp.stanekHealthOf({ stanek: r2, charge: null, now: Date.now() }).some((p) => p.problem === 'STANEK PHASE SWITCH LATE')) c.fail('landed: no STANEK PHASE SWITCH LATE')
  const r3 = await g.run()
  c.examined(1)
  if (r3?.lifeLayout?.phase?.state !== 'late' || !sp.sameLayout(g.active(), late)) c.fail("the next pass: 'late', nothing re-laid", JSON.stringify(r3?.lifeLayout?.phase))
  // a placed layout that is not the early one: held at the condition (the switch is not priced from it)
  const h = mockGame({ node: 11, sf13: 1, installed: [NFG, GEN], progressRoute: 'blade', extraSf: [[7, 1], [6, 3]] })
  const other = early.filter((p) => p.id !== 14)
  for (const p of other) h.ns.stanek.placeFragment(p.x, p.y, p.rot, p.id)
  h.files['/tel/plan.txt'] = planTxt()
  h.files['/tel/bladeburner.txt'] = bbTxt(9)
  const rh = await h.run()
  c.examined(1)
  if (!sp.sameLayout(h.active(), other) || rh?.lifeLayout?.phase?.state !== 'held' || rh.lifeLayout.phase.switchPriced) c.fail('a placed layout that is not the early one must be held (not switched, not priced)', JSON.stringify(rh?.lifeLayout))
  if (sp.stanekHealthOf({ stanek: rh, charge: null, now: Date.now() + 60 * 60e3 }).some((p) => p.problem === 'STANEK PHASE SWITCH LATE')) c.fail('a held (unpriced) switch must not fail the health check')
  // health: a priced switch due 20 min ago that has not landed
  const now = Date.now()
  const stale = { ...r2, at: new Date(now).toISOString(), layout: { ...r2.layout, placedKey: sp.layoutKeyOf(early) }, lifeLayout: { ...r2.lifeLayout, phase: { ...ph, metAt: new Date(now - 20 * 60e3).toISOString() } } }
  c.examined(2)
  if (!sp.phaseHealthOf(stale, now).some((p) => p.problem === 'STANEK PHASE SWITCH LATE')) c.fail('a priced switch due 20 min ago, not landed: no STANEK PHASE SWITCH LATE')
  if (!sp.stanekHealthOf({ stanek: stale, charge: null, now }).some((p) => p.problem === 'STANEK PHASE SWITCH LATE')) c.fail('the health check (stanekHealthOf, what tools/healthcheck.mjs runs) must carry STANEK PHASE SWITCH LATE')
  if (sp.phaseHealthOf({ ...stale, lifeLayout: { ...stale.lifeLayout, phase: { ...ph, metAt: new Date(now - 5 * 60e3).toISOString() } } }, now).length) c.fail('due 5 min ago: inside the grace, must not fail yet')
  c.note(`early ${sp.layoutKeyOf(early)} -> late ${sp.layoutKeyOf(late)} at ${sp.whenText(when)}: relay ${JSON.stringify(r2?.lifeLayout?.relay)}; held: ${rh?.lifeLayout?.phase?.why}`)
  return c
}

// SG15 THE PHASE PLAN IS A PRICED COMPARISON OF EXITS: bladePhasePlanOf lists a cell iff its paired
//      exit with the switch beats the incumbent held by more than two standard errors (d + 2se < 0;
//      flipping the sign removes it); every shipped entry is legal on its node's grid and its d is
//      withH - withoutH; progress.js publishes decisions.stanek.phase from it on the Bladeburner
//      route, and on the hacking route prices each in-life switch through the trajectory simulator
//      (switchInputsOf) and keeps it only where it wins by 0.01h (static).
async function sg15() {
  const c = new Check('SG15', 'the phase plan is priced: listed iff the switch exit wins (d + 2se < 0); progress.js publishes it')
  const { nodeMults } = await import('../sim/nodechoice/hackexit.mjs')
  for (const [key, e] of Object.entries(sp.BLADE_PHASE_PRICED)) {
    const [n, l13, l7] = key.split('|').map(Number)
    const m = nodeMults(n)
    const gr = sp.giftSize(m.StaneksGiftExtraSize ?? 0, l13)
    c.examined(1)
    if (!sp.layoutFits(e.early, gr.width, gr.height) || !sp.layoutFits(e.late, gr.width, gr.height)) c.fail(`${key}: a layout is not legal on BN${n}'s ${gr.width}x${gr.height} grid`)
    if (Math.abs(e.withH - e.withoutH - e.d) > 2e-3) c.fail(`${key}: d ${e.d} is not withH - withoutH (${e.withH} - ${e.withoutH})`)
    const p = sp.bladePhasePlanOf({ node: n, l13, l7, width: gr.width, height: gr.height })
    if (!!p !== e.d + 2 * e.se < 0) c.fail(`${key}: listed ${!!p} but d + 2se = ${(e.d + 2 * e.se).toFixed(4)}`)
    const keep = { ...e }
    sp.BLADE_PHASE_PRICED[key] = { ...e, d: -e.d, withH: e.withoutH, withoutH: e.withH }
    if (sp.bladePhasePlanOf({ node: n, l13, l7, width: gr.width, height: gr.height })) c.fail(`${key}: flipped to a losing switch it is still listed (the gate is not the comparison)`)
    sp.BLADE_PHASE_PRICED[key] = keep
  }
  sp.BLADE_PHASE_PRICED['99|1|1'] = { early: sp.BLADE_LAYOUTS['6x5|1'], late: sp.BLADE_LAYOUTS['6x5|1'].slice(1), when: { blackOps: 3 }, withoutH: 10, withH: 9.98, d: -0.02, se: 0.015, n: 40 }
  c.examined(1)
  if (sp.bladePhasePlanOf({ node: 99, l13: 1, l7: 1 })) c.fail('a switch within two standard errors of zero must not be listed')
  delete sp.BLADE_PHASE_PRICED['99|1|1']
  const pr = fs.readFileSync(path.join(REPO, 'progress.js'), 'utf8')
  c.examined(3)
  if (!/const plan = bladePhasePlanOf\(\{ node: gift\.node, l13: gift\.l13, l7: gift\.l7/.test(pr) || !/pc\.decisions\.stanek = \{\s*phase,/.test(pr)) c.fail('progress.js must publish decisions.stanek.phase from bladePhasePlanOf on the Bladeburner route')
  if (!/const h = yield\* tg\(switchInputsOf\(base, ctx, fL, o\.placed, tsH, chosen\.placed\)\)/.test(pr)) c.fail('progress.js must price each in-life switch through the trajectory simulator (switchInputsOf in tg)')
  if (!/bestP && layout\.hours - bestP\.hours >= 0\.01/.test(pr)) c.fail('progress.js must keep an in-life switch only where it beats the chosen layout held by 0.01h')
  const stk = fs.readFileSync(path.join(REPO, 'stanek.js'), 'utf8')
  if (!/relayDiffOf\(active, target\.placed\)/.test(stk) || !/planPhaseOf\(planText/.test(stk) || !/bladePhaseStateOf\(ns\.read\('\/tel\/bladeburner\.txt'\)/.test(stk)) c.fail('stanek.js must re-lay by diff and step the published phase plan on /tel/bladeburner.txt')
  c.note(`${Object.keys(sp.BLADE_PHASE_PRICED).length} cells: ${Object.entries(sp.BLADE_PHASE_PRICED).map(([k, e]) => `${k} ${e.d.toFixed(3)}+-${e.se.toFixed(3)}h at ${sp.whenText(e.when)}`).join('; ')}`)
  return c
}


// ===========================================================================
// L3: THE EPOCH DECISION (stanekepoch.js)
// ===========================================================================
const ep = await import('../../stanekepoch.js')
const bpl = await import('../../bbplan.js')
const { drain: drainGen } = await import('../../coop.js')
const BL5 = sp.BLADE_LAYOUTS['5x5|0.9']
const liveOf = (placed, n = 3000, H = 192) => ep.liveGiftOf({ at: new Date().toISOString(), fragments: placed.map((p) => ({ ...p, highestCharge: sp.fragmentById(p.id).type === sp.TYPE.Booster ? 0 : H, numCharge: sp.fragmentById(p.id).type === sp.TYPE.Booster ? 0 : n })), charger: { H }, layout: { width: 5, height: 5, nodePower: 0.9 } })
let S0 = null
async function s0Of() {
  if (!S0) {
    const { modelStartOf, loadFx } = await import('../sim/bb14.mjs')
    S0 = { ...modelStartOf(loadFx()), rankSdLn: 0.1, successSdLn: 0.04 }
  }
  return S0
}

// SG16 THE HYSTERESIS (epochChoiceOf): a switch wins only where it beats keeping by at least minGainH
//      AND by more than z standard errors of the paired difference over the members; a gain under
//      the minimum, a gain inside 2se, or an unpriced incumbent keeps. Generic over kind (L4: routes).
function sg16() {
  const c = new Check('SG16', 'the epoch choice: switch only past 2 s.e. and the minimum gain, else keep')
  const inc = { kind: 'layout', src: 'incumbent', key: 'A', members: [10, 10.2, 9.9, 10.1, 10, 10.05] }
  const opt = (key, ds, kind = 'layout') => ({ kind, src: key, key, members: inc.members.map((h, i) => h + ds[i]) })
  const cases = [
    ['a clear win (-0.25h, tight)', [inc, opt('B', [-0.25, -0.251, -0.249, -0.25, -0.252, -0.248])], 'switch', 'B'],
    ['the replay\'s phantom gain (-0.15h, tight: under the model-error floor)', [inc, opt('B', [-0.15, -0.151, -0.149, -0.15, -0.152, -0.148])], 'keep', null],
    ['under the minimum gain (-0.005h, tight)', [inc, opt('B', [-0.005, -0.005, -0.005, -0.005, -0.005, -0.005])], 'keep', null],
    ['inside 2 s.e. (-0.05h mean, +-0.2 spread)', [inc, opt('B', [-0.3, 0.2, -0.25, 0.15, -0.2, 0.1])], 'keep', null],
    ['a loss', [inc, opt('B', [0.1, 0.1, 0.1, 0.1, 0.1, 0.1])], 'keep', null],
    ['the best of two winners', [inc, opt('B', [-0.25, -0.25, -0.25, -0.25, -0.25, -0.251]), opt('C', [-0.29, -0.29, -0.291, -0.29, -0.29, -0.29])], 'switch', 'C'],
    ['a route option (L4 hook)', [inc, opt('R', [-0.5, -0.5, -0.5, -0.5, -0.5, -0.49], 'route')], 'switch', 'R'],
    ['the incumbent unpriced', [{ ...inc, members: [null, null, null, null, null, null] }, opt('B', [-1, -1, -1, -1, -1, -1])], 'keep', null],
  ]
  for (const [label, priced, kind, key] of cases) {
    c.examined(1)
    const r = ep.epochChoiceOf(priced)
    if (r.kind !== kind || (key && r.best?.key !== key)) c.fail(`${label}: expected ${kind}${key ? ` ${key}` : ''}, got ${r.kind} ${r.best?.key ?? ''} (${r.why})`)
  }
  c.note(`minGainH ${ep.EPOCH.minGainH}h, z ${ep.EPOCH.z}; ${cases.length} cases`)
  return c
}

// SG17 THE EPOCH IS PRICED BY SIMULATED EXITS FROM THE LIVE STATE: giftPathOf keeps the live charge
//      (factor 1 at t 0, rising as it grows), a re-lay deletes the changed fragments' charge (their
//      keys fall below 1 after lagS) and keeps the unchanged ones'; epochDecisionGen's options are the
//      incumbent, the tabled and L2's layouts and the local search, every option's hours the mean of
//      bladeExitGen over the SAME members with s0.gift = its path (recomputed here independently);
//      removing a charged combat fragment prices SLOWER than keeping (the gift reaches the exit:
//      bbplan's giftSync); the record carries the forecasts the next epoch calibrates against.
async function sg17() {
  const c = new Check('SG17', 'the epoch decision: every option a simulated exit from the live state, the charge lost and regrown per fragment')
  const live = liveOf(BL5)
  const keep = ep.giftPathOf({ ...live, target: null, nodePower: 0.9 })
  const f0 = keep.factorAt(0)
  const f1 = keep.factorAt(3 * 3600)
  c.examined(2)
  if (Object.values(f0).some((v) => Math.abs(v - 1) > 1e-9)) c.fail('keep: the factor at t 0 must be 1 (the live charge is what the player holds)', JSON.stringify(f0))
  if (!(f1.agility > 1)) c.fail('keep: the charge must keep growing (agility factor > 1 after 3h)', JSON.stringify(f1))
  const ag = BL5.find((p) => sp.fragmentById(p.id).type === sp.TYPE.Agility)
  const noAg = BL5.filter((p) => p !== ag)
  const rel = ep.giftPathOf({ ...live, target: noAg, nodePower: 0.9 })
  const r0 = rel.factorAt(0)
  const r1 = rel.factorAt(ep.EPOCH.lagS + 60)
  c.examined(2)
  if (Math.abs(r0.agility - 1) > 1e-9) c.fail("a re-lay lands lagS later: before it the factor is the incumbent's", JSON.stringify(r0))
  if (!(r1.agility < 0.9) || !(r1.dexterity >= 1 - 1e-9)) c.fail("after the re-lay the removed Agility fragment's keys fall, the unchanged Dexterity keeps its charge", JSON.stringify(r1))
  // the track itself re-laid: one mass per target fragment, the removed fragment's mass gone with it
  const ms0 = live.masses.reduce((a, b) => a + b, 0)
  const ms1 = rel.masses()
  const agMass = live.masses[BL5.indexOf(ag)]
  if (ms1.length !== noAg.length || !(ms1.reduce((a, b) => a + b, 0) < ms0 - 0.5 * agMass)) c.fail('the re-lay must re-key the charge track to the target (the removed fragment\'s mass deleted)', JSON.stringify({ ms1, ms0, agMass }))
  const s0 = await s0Of()
  const Q = 3
  const t0 = Date.now()
  const d = drainGen(ep.epochDecisionGen({ s0, live, width: 5, height: 5, nodePower: 0.9, Q, budget: { screenSims: 4, shortlist: 1 } }))
  const ms = Date.now() - t0
  const srcs = d.options.map((o) => o.src)
  c.examined(3)
  if (srcs[0] !== 'incumbent' || !srcs.some((x) => x === 'tabled' || /^L2 /.test(x))) c.fail('the options must start with the incumbent and include the table candidates', JSON.stringify(srcs))
  if (!(d.search.screened > 0)) c.fail('the local search must screen neighbours', JSON.stringify(d.search))
  // one option recomputed independently: the mean of bladeExit over the same members with its gift path
  const o = d.options[1]
  const placed = ep.epochCandidatesOf({ incumbent: BL5, width: 5, height: 5, nodePower: 0.9 }).find((x) => x.key === o.key)?.placed
  if (placed) {
    const hs = Array.from({ length: Q }, (_, m) => bpl.bladeExit(bpl.bladeMemberOf({ ...s0, gift: ep.giftPathOf({ ...live, target: placed, nodePower: 0.9 }), maxH: ep.EPOCH.maxH }, m, Q)).hours)
    const mean = hs.reduce((a, b) => a + b, 0) / Q
    if (Math.abs(mean - o.hours) > 2e-3) c.fail(`option ${o.src}: hours ${o.hours} is not the mean of bladeExit over the members with its gift path (${mean.toFixed(3)})`)
  } else c.fail(`option ${o.src} is not a table candidate`)
  // the gift reaches the exit: dropping the charged Agility fragment is slower than keeping
  const kH = Array.from({ length: Q }, (_, m) => bpl.bladeExit(bpl.bladeMemberOf({ ...s0, gift: ep.giftPathOf({ ...live, target: null, nodePower: 0.9 }) }, m, Q)).hours)
  const nH = Array.from({ length: Q }, (_, m) => bpl.bladeExit(bpl.bladeMemberOf({ ...s0, gift: ep.giftPathOf({ ...live, target: noAg, nodePower: 0.9 }) }, m, Q)).hours)
  const dd = nH.reduce((a, b, i) => a + b - kH[i], 0) / Q
  c.examined(2)
  if (!(dd > 0.01)) c.fail(`removing the charged Agility fragment must price slower than keeping (d ${dd.toFixed(4)}h): the gift path does not reach the exit`)
  if (!Array.isArray(d.track?.forecast?.mass) || !Array.isArray(d.rankPath) || !d.rankPath.length) c.fail('the record must carry the mass and rank forecasts', JSON.stringify({ track: d.track, rankPath: d.rankPath }))
  c.note(`${d.options.length} options (${d.cpu.sims} sims, ${ms}ms, Q ${Q}): ${d.kind} — ${d.why}; drop Agility +${dd.toFixed(3)}h`)
  return c
}

// SG18 THE EPOCHS (epochDueOf): the first decision of a node, an install, a black op completed, a landed
//      switch / a layout nobody decided, and the periodic check are due; otherwise the decision is carried.
function sg18() {
  const c = new Check('SG18', 'the epochs: first, install, black op, landed, periodic — else carried')
  const now = Date.now()
  const dec = (over = {}) => ({ lastAugReset: 1000, lastNodeReset: 0, decision: { decidedAt: new Date(now - 10 * 60e3).toISOString(), blackOps: 4, incumbentKey: 'A', targetKey: 'A', kind: 'keep', epochKind: 'first', ...over } })
  const base = { now, lastAugReset: 1000, lastNodeReset: 0, blackOps: 4, placedKey: 'A' }
  const cases = [
    ['no record', { ...base, prev: null }, 'first'],
    ['another node', { ...base, prev: { ...dec(), lastNodeReset: -5 } }, 'first'],
    ['an install', { ...base, prev: { ...dec(), lastAugReset: 900 } }, 'install'],
    ['a black op', { ...base, blackOps: 5, prev: dec() }, 'blackop'],
    ['a switch landed', { ...base, placedKey: 'B', prev: dec({ kind: 'switch', targetKey: 'B' }) }, 'landed'],
    ['an undecided layout', { ...base, placedKey: 'Z', prev: dec() }, 'landed'],
    ['the hour', { ...base, prev: dec({ decidedAt: new Date(now - 61 * 60e3).toISOString() }) }, 'periodic'],
    ['carried', { ...base, prev: dec() }, null],
  ]
  for (const [label, arg, kind] of cases) {
    c.examined(1)
    const r = ep.epochDueOf(arg)
    if (r.due !== (kind !== null) || r.kind !== kind) c.fail(`${label}: expected ${kind ?? 'carried'}, got ${r.due ? r.kind : 'carried'} (${r.why})`)
  }
  return c
}

// SG19 THE GAME ACTS ON THE DECISION (stanek.js, a mock BN11 Bladeburner node): a fresh 'switch' from the
//      placed layout re-lays BY DIFF (no clearGift; unchanged fragments keep their charge) and records
//      the epoch; a fresh 'keep' holds the placed layout even where L2's phase condition holds (L3
//      supersedes the table); a switch priced from another layout is held; a stale decision (past
//      2 epochs) falls back to L2's phase step.
async function sg19() {
  const c = new Check('SG19', 'stanek.js acts on the epoch decision: switch by diff from its incumbent, keep holds, stale falls back to L2')
  const mk = () => mockGame({ node: 11, sf13: 1, installed: [NFG, GEN], progressRoute: 'blade', extraSf: [[7, 1], [6, 3]] })
  const inc = sp.BLADE_LAYOUTS['6x5|1']
  const target = inc.filter((p) => p.id !== 10)
  const epochTxt = (kind, over = {}) => JSON.stringify({ at: new Date().toISOString(), lastAugReset: 1000, lastNodeReset: 0, decision: { kind, decidedAt: new Date().toISOString(), epochKind: 'blackop', incumbentKey: sp.layoutKeyOf(inc), targetKey: sp.layoutKeyOf(kind === 'switch' ? target : inc), target: kind === 'switch' ? target : null, from: inc, d: -0.05, se: 0.01, why: 'test', ...over } })
  const g = mk()
  await g.run()
  g.tick(400)
  c.examined(1)
  if (!sp.sameLayout(g.active(), inc)) c.fail('the node start must place the tabled layout', JSON.stringify(g.active()))
  const charge0 = new Map(g.charge)
  const clears = g.log.filter((e) => e.ev === 'clear').length
  g.files[ep.EPOCH_FILE] = epochTxt('switch')
  const r = await g.run()
  c.examined(3)
  if (!sp.sameLayout(g.active(), target)) c.fail("a fresh 'switch' from the placed layout must re-lay to its target", JSON.stringify(g.active()))
  if (g.log.filter((e) => e.ev === 'clear').length !== clears) c.fail('the switch must be a diff, never clearGift')
  for (const p of target) if (sp.fragmentById(p.id).type !== sp.TYPE.Booster && g.charge.get(`${p.x},${p.y}`)?.numCharge !== charge0.get(`${p.x},${p.y}`)?.numCharge) c.fail(`an unchanged fragment ${p.id} lost its charge`)
  if (r?.lifeLayout?.epoch?.state !== 'switching' || !/epoch decision/.test(r?.lifeLayout?.source ?? '')) c.fail('the record must name the epoch decision (state switching)', JSON.stringify(r?.lifeLayout))
  if (ep.epochHealthOf({ epoch: JSON.parse(g.files[ep.EPOCH_FILE]), stanek: r, now: Date.now() + 30 * 60e3 }).some((p) => p.problem === 'STANEK EPOCH SWITCH NOT LANDED')) c.fail('landed: no STANEK EPOCH SWITCH NOT LANDED')
  // keep vs L2's phase plan whose condition holds
  const k = mk()
  await k.run()
  const late = inc.filter((p) => p.id !== 14)
  k.files['/tel/plan.txt'] = JSON.stringify({ at: new Date().toISOString(), lastAugReset: 1000, decisions: { stanek: { phase: { planned: true, early: inc, late, when: { blackOps: 6 }, d: -0.1 } } } })
  k.files['/tel/bladeburner.txt'] = JSON.stringify({ at: new Date().toISOString(), bitNode: 11, lastAugReset: 1000, rank: 50000, blackOps: { done: 8 } })
  k.files[ep.EPOCH_FILE] = epochTxt('keep')
  const rk = await k.run()
  c.examined(1)
  if (!sp.sameLayout(k.active(), inc) || rk?.lifeLayout?.epoch?.kind !== 'keep') c.fail("a fresh 'keep' must hold the placed layout though L2's condition holds (L3 supersedes the table)", JSON.stringify(rk?.lifeLayout))
  // stale: L2 again
  k.files[ep.EPOCH_FILE] = epochTxt('keep', { decidedAt: new Date(Date.now() - 4 * 3600e3).toISOString() })
  await k.run()
  c.examined(1)
  if (!sp.sameLayout(k.active(), late)) c.fail("a stale epoch decision must fall back to L2's phase step", JSON.stringify(k.active()))
  // a switch priced from another layout: held
  const h = mk()
  const other = inc.filter((p) => p.id !== 12)
  for (const p of other) h.ns.stanek.placeFragment(p.x, p.y, p.rot, p.id)
  h.files[ep.EPOCH_FILE] = epochTxt('switch')
  const rh = await h.run()
  c.examined(1)
  if (!sp.sameLayout(h.active(), other) || rh?.lifeLayout?.epoch?.state !== 'held') c.fail('a switch priced from another layout must be held', JSON.stringify(rh?.lifeLayout))
  c.note(`switch ${r?.lifeLayout?.relay ? JSON.stringify(r.lifeLayout.relay) : '?'}; keep over L2: ${String(rk?.lifeLayout?.why ?? '').slice(0, 80)}; held: ${String(rh?.lifeLayout?.epoch?.why ?? '').slice(0, 80)}`)
  return c
}

// SG20 HEALTH (epochHealthOf, wired into tools/healthcheck.mjs) and the publisher (progress.js, static):
//      STANEK EPOCH STALE past 2 epochs, on a decision that threw, or none this node past the grace;
//      STANEK EPOCH SWITCH NOT LANDED 15+ min after a switch not placed; nothing off the Bladeburner
//      basis. progress.js decides in the blade branch on pc.bladeCtx.startFor (one builder) with
//      epochDecisionGen and writes EPOCH_FILE every pass.
function sg20() {
  const c = new Check('SG20', 'the epoch health (stale, switch not landed) and its publisher')
  const now = Date.now()
  const stanek = { lastNodeReset: 0, lastAugReset: 1000, gift: { accepted: true, basis: 'blade' }, fragments: [{ id: 16 }], layout: { placedKey: 'A' } }
  const rec = (over = {}, top = {}) => ({ lastNodeReset: 0, lastAugReset: 1000, decision: { kind: 'keep', decidedAt: new Date(now - 30 * 60e3).toISOString(), incumbentKey: 'A', targetKey: 'A', ...over }, ...top })
  const has = (r, p) => r.some((x) => x.problem === p)
  const S = 'STANEK EPOCH STALE'
  const N = 'STANEK EPOCH SWITCH NOT LANDED'
  const cases = [
    ['fresh keep', ep.epochHealthOf({ epoch: rec(), stanek, now }), []],
    ['3h old', ep.epochHealthOf({ epoch: rec({ decidedAt: new Date(now - 3 * 3600e3).toISOString() }), stanek, now }), [S]],
    ['threw', ep.epochHealthOf({ epoch: rec({}, { error: 'boom' }), stanek, now }), [S]],
    ['absent 1h into the node', ep.epochHealthOf({ epoch: null, stanek, now, nodeStartMs: now - 3600e3 }), [S]],
    ['absent 5 min into the node', ep.epochHealthOf({ epoch: null, stanek, now, nodeStartMs: now - 5 * 60e3 }), []],
    ['switch 20 min, not placed', ep.epochHealthOf({ epoch: rec({ kind: 'switch', targetKey: 'B', decidedAt: new Date(now - 20 * 60e3).toISOString() }), stanek, now }), [N]],
    ['switch 5 min, not placed', ep.epochHealthOf({ epoch: rec({ kind: 'switch', targetKey: 'B', decidedAt: new Date(now - 5 * 60e3).toISOString() }), stanek, now }), []],
    ['switch landed', ep.epochHealthOf({ epoch: rec({ kind: 'switch', targetKey: 'A', decidedAt: new Date(now - 20 * 60e3).toISOString() }), stanek, now }), []],
    ['hacking basis', ep.epochHealthOf({ epoch: null, stanek: { ...stanek, gift: { accepted: true, basis: 'hack' } }, now, nodeStartMs: now - 3600e3 }), []],
  ]
  for (const [label, got, want] of cases) {
    c.examined(1)
    if (want.length !== got.length || !want.every((p) => has(got, p))) c.fail(`${label}: expected [${want.join(', ')}], got [${got.map((x) => x.problem).join(', ')}]`)
  }
  const hc = fs.readFileSync(path.join(REPO, 'tools/healthcheck.mjs'), 'utf8')
  const pr = fs.readFileSync(path.join(REPO, 'progress.js'), 'utf8')
  c.examined(3)
  if (!/probs\.push\(\.\.\.epochHealthOf\(\{ epoch: readTel\("stanekepoch\.txt"\)/.test(hc)) c.fail('tools/healthcheck.mjs must run epochHealthOf on /tel/stanekepoch.txt')
  if (!/epoch = await stanekEpochOf\(ns, info, pc, gift, st\)/.test(pr)) c.fail("progress.js's blade branch must run the epoch decision (stanekEpochOf)")
  if (!/const s0 = bc\.startFor\(/.test(pr) || !/epochDecisionGen\(\{ s0, live,/.test(pr) || !/ns\.write\(EPOCH_FILE, JSON\.stringify\(rec\), 'w'\)/.test(pr)) c.fail("progress.js must price the epoch on the route's own start (bladeCtx.startFor) with epochDecisionGen and write EPOCH_FILE")
  return c
}

// SG21 THE EXIT READY NEVER DEGRADES TO 'hack' (live BN7.2 2026-10-16 15:55Z: all 21 black ops done,
// endgame.js blocked on home RAM, every blade draw read null at 0h -> the route flipped to 'hack', a graft
// started, a 13-aug install planned). 0h is a priced duration (plan simInto); an unpriced arm holds the
// committed route or the gift's (plan.unpricedHoldOf) and is published (ROUTE ARM UNPRICED); a thrown route
// decision holds too; endgame.js reserves its raise on home and batch.js keeps it free (ENDGAME_RESERVE).
async function sg21() {
  const c = new Check('SG21', "the exit ready stays 'blade' at 0h; an unpriced arm never loses by default; endgame's block is reserved")
  const P = await import('../../plan.js')
  const BB = await import('../../bbplan.js')
  const rp = await import('../../routepin.js')
  const rpl = await import('../../raiseplace.js')
  const { drain } = await import('../../coop.js')
  const rd = (f) => fs.readFileSync(path.join(REPO, f), 'utf8')
  const mults = { strength: 1.12, defense: 1.12, dexterity: 1.12, agility: 1.12, charisma: 1.12, strength_exp: 1.15, defense_exp: 1.15, dexterity_exp: 1.15, agility_exp: 1.15, charisma_exp: 1.15, bladeburner_success_chance: 1, bladeburner_max_stamina: 1, bladeburner_stamina_gain: 1 }
  const person = { skills: { hacking: 900, strength: 300, defense: 300, dexterity: 300, agility: 300, charisma: 250, intelligence: 131 }, exp: Object.fromEntries(['strength', 'defense', 'dexterity', 'agility', 'charisma'].map((k) => [k, BB.expForLevel(300, 1.12)])), mults }
  const s0 = BB.bladeStartOf({ tel: { joined: true, rank: 399000, skillPoints: 0, blackOps: { done: 21 }, levels: { "Blade's Intuition": 260 } }, person, sleeves: { infiltrate: 5, support: 0, fa: 0 }, gymExpPerSec: 37.661, install: null })
  const draws = P.makeDraws({ drift: { s: 0.01, nu: 4, a: 2, b: 0.0002 } }, 24, 7)
  const trajGen = function* (x) {
    return x.fakeH
  }
  // 1. all 21 black ops done: 'blade' at 0h, with and without a committed route, with the posterior draws
  for (const prev of [null, { key: 'blade', meanH: 0.5 }, { key: 'hack', meanH: 50 }]) {
    const d = drain(P.decideBladeRouteGen({ base: { fakeH: 50, cycleHours: 2 }, traj: (x) => x.fakeH, trajGen, bladeStart: s0, draws, post: true, budgetMs: 1e9, prev }))
    c.examined(1)
    if (d.key !== 'blade' || d.bladeH !== 0) c.fail(`the exit ready (21 black ops done, prev ${prev?.key ?? 'none'}): the route must be 'blade' at 0h, got '${d.key}' at ${d.bladeH}h`, String(d.why).slice(0, 200))
  }
  // 2. an unpriced arm never loses by default
  const H = (pointHack, pointBlade, prev, hold, options = null) => P.unpricedHoldOf({ key: fin(pointBlade) ? 'blade' : 'hack', options, why: 'x' }, { pointHack, pointBlade, prev, hold, post: !!options })
  const fin = (x) => typeof x === 'number' && isFinite(x)
  const cases = [
    [H(50, null, { key: 'blade' }, null), 'blade', 'the blade arm unpriced, the committed route blade'],
    [H(50, null, null, 'blade'), 'blade', "the blade arm unpriced, no committed route, the gift accepted for blade"],
    [H(50, null, null, null), null, 'the blade arm unpriced, nothing to hold: no route (published unpriced)'],
    [H(null, 20, { key: 'hack' }, null), 'hack', 'the hack arm unpriced, the committed route hack'],
    [H(50, 0.5, null, null, [{ key: 'hack', pFeasible: 1 }, { key: 'blade', pFeasible: 0 }]), null, "the blade arm's draws all unpriced: not a loss"],
  ]
  for (const [d, want, what] of cases) {
    c.examined(1)
    if (d.key !== want || !Array.isArray(d.unpriced) || !d.unpriced.length) c.fail(`${what}: key '${want}' with unpriced named, got '${d.key}' unpriced ${JSON.stringify(d.unpriced)}`)
  }
  const both = P.unpricedHoldOf({ key: 'blade', why: 'x' }, { pointHack: 50, pointBlade: 0, prev: null, post: false })
  c.examined(1)
  if (both.key !== 'blade' || both.unpriced) c.fail('both arms priced (blade at 0h): the decision unchanged, nothing unpriced', JSON.stringify(both))
  const pl = rd('plan.js')
  const pr = rd('progress.js')
  c.examined(3)
  if (!/const d = unpricedHoldOf\(d0, \{ pointHack: mUnp \? null : pointHack, pointBlade: mUnp \? null : pointBlade, prev: was, hold, post \}\)/.test(pl)) c.fail('decideBladeRouteGen must pass its decision through unpricedHoldOf')
  if (!/post: !!pc\.post, gift, hold: routeHoldOf\(info, pc\), mandate \}\)/.test(pr)) c.fail('progress.js must hand the route decision the route to hold (routeHoldOf)')
  if (!/pc\.decisions\.bladeRoute = \{ key: held, held: !!held, unpriced: \['hack', 'blade'\], error: true/.test(pr)) c.fail('a thrown route decision must hold the committed route, not read key null (acted as hack)')
  // 3. published and failed loud
  const rep = rp.routeReportOf(rp.routePinOf('', 7), H(50, null, { key: 'blade' }, null), null)
  const probs = rp.routeHealthOf({ route: { ...rep, node: 7 }, node: 7 }).map((x) => x.key)
  c.examined(2)
  if (rep.route !== 'blade' || !rep.unpriced?.includes('blade') || !rep.held) c.fail('the route record must publish the unpriced arm and the hold', JSON.stringify(rep))
  if (!probs.includes('ROUTE ARM UNPRICED')) c.fail('an unpriced arm must fail ROUTE ARM UNPRICED', JSON.stringify(probs))
  // 4. endgame's block: reserved when ready and refused, honoured by batch.js, fresh and this life only
  const info = { lastAugReset: 5 }
  const now = Date.now()
  const rec = { at: new Date(now - 4 * 60e3).toISOString(), lastAugReset: 5, script: 'endgame.js', action: 'reserve', host: 'home', gb: 37.2 }
  c.examined(4)
  if (rpl.endgameReserveOf(rec, info, ['home'], now)?.gb !== 37.2) c.fail('a 4-minute-old endgame reservation of this life must hold its 37.2GB on home (the endgame cadence is 2 min)')
  if (rpl.endgameReserveOf({ ...rec, at: new Date(now - 11 * 60e3).toISOString() }, info, ['home'], now) !== null) c.fail('a stale endgame reservation must lapse')
  if (rpl.endgameReserveOf({ ...rec, lastAugReset: 4 }, info, ['home'], now) !== null) c.fail("another life's endgame reservation must not hold")
  const bj = rd('batch.js')
  const eg = rd('endgame.js')
  if (!/\(endRes && h === endRes\.host \? endRes\.gb : 0\)/.test(bj) || !/endgameReserveOf\(JSON\.parse\(ns\.read\(ENDGAME_RESERVE\.file\)/.test(bj)) c.fail("batch.js must keep endgame's reserved block free of new workers (reserveFor)")
  c.examined(1)
  if (!/if \(!\(await raiseRam\(ns, want, STATUS, 'endgame\.js destroying the world daemon'\)\)\) \{[\s\S]{0,600}ns\.write\(ENDGAME_RESERVE\.file/.test(eg)) c.fail('endgame.js must reserve its block when the exit is ready and the raise is refused')
  // a stale --next must never replay a maxed node (2026-10-22: BN3 replayed after BN3.3, 9h lost)
  if (!/if \(maxedNext !== null\) \{[\s\S]{0,400}return true[\s\S]{0,80}report\.result = 'destroying'/.test(eg) || !/const after = sfLevel\(reset, n\) \+ \(n === reset\?\.currentNode \? 1 : 0\)/.test(eg)) c.fail('endgame.js must refuse a --next whose Source-File would already be at the cap')
  // RESIDENTS too (BN7.2, BN11.2: home full of stock/ctauto/go-cheat, both exits unblocked by hand): the
  // watchdog evicts the transient residents and relaunches nothing but endgame.js onto home while it stands.
  const wd = rd('watchdog.js')
  if (!/if \(endgameHold\) for \(const s of ENDGAME_EVICT\) ns\.scriptKill\(s, 'home'\)/.test(wd) || !/ENDGAME_EVICT = \['ctauto\.js', 'go-cheat\.js', 'go\.js'\]/.test(wd)) c.fail("watchdog.js must evict the transient home residents while endgame's reserve stands")
  if (!/if \(endgameHold && target === 'home' && script !== 'endgame\.js'\) \{[\s\S]{0,120}continue/.test(wd)) c.fail("watchdog.js must not relaunch anything but endgame.js onto home while endgame's reserve stands")
  return c
}

// SG22 THE ROUTE'S OWN FLEET AND THE GIFT CHAIN AT A NODE START (live BN7.3 2026-10-16 16:17Z: combat 1, no
// division, the sleeves on the hack route's CLASS/SYNCHRO -> the blade arm priced 0/0/0 at 51.1h vs hack
// 35.8h, the gift "not accepted: priced without it" and held — circular: sleeve.js picks a Bladeburner fleet
// only on the committed blade route). The blade arm is priced with the chooser's fleet; blade+gift, blade and
// hack are one chained decision and the accept follows the chosen arm (stanek.js / act.js read the verdict).
async function sg22() {
  const c = new Check('SG22', "a node start: the blade arm runs the chooser's fleet, never the hack route's; blade+gift / blade / hack chained, the accept follows")
  const P = await import('../../plan.js')
  const BB = await import('../../bbplan.js')
  const se = await import('../../stanekepoch.js')
  const { bitNodeMults } = await import('../../bitNodeMultipliers.js')
  const { drain } = await import('../../coop.js')
  const rd = (f) => fs.readFileSync(path.join(REPO, f), 'utf8')
  const nm = bitNodeMults(7, 3)
  const ones = { strength: 1, defense: 1, dexterity: 1, agility: 1, charisma: 1, hacking: 1, intelligence: 149 }
  const m = { strength: 1.3, defense: 1.3, dexterity: 1.3, agility: 1.3, charisma: 1.3, strength_exp: 1.3, defense_exp: 1.3, dexterity_exp: 1.3, agility_exp: 1.3, charisma_exp: 1.3, bladeburner_success_chance: 1.1, bladeburner_max_stamina: 1, bladeburner_stamina_gain: 1 }
  const person = { skills: ones, exp: {}, mults: m, city: 'Sector-12', money: 1262 }
  const startOf = (sleeves) => BB.bladeStartOf({ tel: null, person, sleeves, gymExpPerSec: 16.8, bnRank: nm.BladeburnerRank, skillCostMult: nm.BladeburnerSkillCost, install: null, rankScale: 1.3, successScale: 1, maxH: 200 })
  const zero = { infiltrate: 0, support: 0, fa: 0 }
  // 1. the premise and the fix: the chooser's fleet for 7 sleeves is not empty and prices blade sooner than 0/0/0
  const pick = BB.chooseSleeveConfig(startOf(zero), 7, undefined, { Q: 1 })
  const z = drain(BB.bladeExitGen(startOf(zero)))
  c.examined(2)
  if (!pick.config || (pick.config.infiltrate ?? 0) + (pick.config.support ?? 0) + (pick.config.fa ?? 0) + (pick.config.gym ?? 0) + (pick.config.contracts ?? 0) === 0) c.fail("the chooser's fleet for 7 sleeves at a node start must put sleeves on the route", JSON.stringify(pick.config))
  if (!(pick.hours < z.hours)) c.fail(`the chooser's fleet must price the blade arm sooner than the empty fleet (${pick.hours}h vs ${z.hours}h)`)
  const pr = rd('progress.js')
  c.examined(3)
  if (!/const startFor = \(spec\) => bladeStartOf\(\{ tel, person, sleeves: armSleeves\(\),/.test(pr)) c.fail("progress.js: every Bladeburner start must carry the arm's own fleet (armSleeves), not the sleeves as assigned")
  if (!/const armSleeves = \(\) => \(fl\.source === 'committed' \|\| !routeFleet\?\.config \? sleeves : routeFleet\.config\)/.test(pr)) c.fail('progress.js: with no committed Bladeburner fleet the arm must use the chooser pick')
  if (!/if \(fl\.source !== 'committed' && nSleeves > 0 && !routeFleet\) \{[\s\S]{0,200}chooseSleeveConfigGen\(startFor\(bladeBasis\), nSleeves/.test(pr)) c.fail('progress.js: the route decision must run the fleet chooser where sleeve.js has no committed Bladeburner fleet')
  // 2. the chain: the gift enters the blade arm, the accept follows the chosen arm
  const g = se.routeGiftChainOptionsOf({ gift: { available: true, accepted: false, forfeited: false, l13: 1 }, nodeMults: nm, base: { fakeH: 60, cycleHours: 2 }, install: null })
  c.examined(2)
  if (!g?.chain || !g.bladeOptions.some((o) => typeof o.make === 'function') || !g.bladeOptions.some((o) => o.make === null)) c.fail('the chain must price blade WITH the gift and blade WITHOUT it', JSON.stringify(g?.bladeOptions?.map((o) => o.src)))
  if (se.routeGiftChainOptionsOf({ gift: { available: true, accepted: false, forfeited: true, l13: 1 }, nodeMults: nm, base: {} }) !== null) c.fail('a forfeited gift has no chain')
  const trajGen = function* (x) {
    return x.fakeH
  }
  const dec = (hackH) => drain(P.decideBladeRouteGen({ base: { fakeH: hackH, cycleHours: 2 }, traj: (x) => x.fakeH, trajGen, bladeStart: startOf(pick.config), draws: [], post: false, gift: { ...g, hackOptions: [{ src: 'without the gift', inputs: { fakeH: hackH, cycleHours: 2 }, withGift: false }] } }))
  const slowHack = dec(500)
  const fastHack = dec(1)
  const wo = slowHack.gift?.blade?.options?.find((o) => !o.withGift)?.hours
  const wi = slowHack.gift?.blade?.options?.find((o) => o.withGift)?.hours
  c.examined(3)
  if (slowHack.key !== 'blade' || slowHack.gift?.chain !== true || slowHack.gift?.accept !== (wi < wo)) c.fail(`blade chosen: the accept must follow its faster option (with ${wi}h, without ${wo}h)`, JSON.stringify({ key: slowHack.key, accept: slowHack.gift?.accept }))
  if (!(wi < wo)) c.fail(`at a BN7.3 start the gift must shorten the blade arm (${wi}h with vs ${wo}h without; BLADE_GIFT_PRICED 7|1|2: -1.7h)`)
  if (fastHack.key !== 'hack' || fastHack.gift?.accept !== false) c.fail('hack chosen (outside BN13): the gift is not accepted', JSON.stringify({ key: fastHack.key, accept: fastHack.gift?.accept }))
  // Genesis applies at the accept, on the combat stats, not on the Bladeburner multipliers
  const f0 = g.bladeOptions.find((o) => o.make)?.make().factorAt(0)
  c.examined(1)
  if (!(Math.abs((f0?.agility ?? 0) - 0.9) < 1e-9) || Math.abs((f0?.bladeburner_success_chance ?? 1) - 1) > 1e-9) c.fail('the accepted gift applies Genesis x0.9 to the combat stats at once (and not to the Bladeburner multipliers)', JSON.stringify(f0))
  // 3. the verdict reaches the accept (stanek.js / act.js): blade+gift -> want, blade without -> never, no hold
  const ri = { currentNode: 7, lastAugReset: 1000, lastNodeReset: 0, ownedSF: new Map([[13, 1], [7, 2]]), ownedAugs: new Map() }
  const yes = sp.giftStateOf(ri, true, 'blade', { accept: true, why: 'x' })
  const no = sp.giftStateOf(ri, true, 'blade', { accept: false, why: 'x' })
  const hk = sp.giftStateOf(ri, true, 'hack', { accept: false, why: 'x' })
  const prog = (gift) => JSON.stringify({ at: new Date().toISOString(), route: { route: 'blade', node: 7, lastAugReset: 1000, gift } })
  c.examined(4)
  if (!yes.want || yes.basis !== 'blade') c.fail('the chain verdict accept on the blade route: wanted, basis blade', JSON.stringify(yes))
  if (no.want || no.hold) c.fail('the chain verdict no: not wanted and not held (the route decided without it)', JSON.stringify(no))
  if (hk.want || hk.hold) c.fail('the chain verdict on the hack route outside BN13: not wanted, not held', JSON.stringify(hk))
  if (sp.giftVerdictOfProgress(prog({ chain: true, accept: true }), ri)?.accept !== true || sp.giftVerdictOfProgress(prog({ chain: false, accept: null }), ri) !== null) c.fail('giftVerdictOfProgress must read the chain verdict of this node and life only')
  const sj = rd('stanek.js')
  const aj = rd('act.js')
  c.examined(2)
  if ((sj.match(/giftStateOf\(info, canAccessCotMG\(info\), route, verdict\)/g) ?? []).length !== 2) c.fail("stanek.js must accept on the route decision's gift verdict (both reads)")
  if (!/if \(!g0\.accepted\) return routeGiftChainOf\(ns, info, base, s0, g0\)/.test(pr)) c.fail('progress.js: an unaccepted, acceptable gift must enter the route decision as the chain (routeGiftChainOf)')
  if ((aj.match(/giftVerdictOfProgress\(readHomeFile\(ns, PROGRESS_FILE\), ri\)/g) ?? []).length !== 2) c.fail("act.js's purchase gate must read the same verdict (both call sites)")
  return c
}

// SG23 HACK + GIFT OUTSIDE BN13, IN THE CHAIN (live BN10.3 2026-10-18: "hack with the gift outside BN13 is not
// priced", so the chain declined the gift on the hacking route the gameplan plays as hacking + Stanek; held by
// hand in GIFT_HOLD_NODES). The chain prices hack + gift (the hacking layout from zero each life, Genesis at
// once, the charger on the gameplan's ramp floored at the measured fleet); the accept follows the faster
// option of the chosen arm; an UNPRICED decision publishes accept null and the option is HELD, never declined.
async function sg23() {
  const c = new Check('SG23', 'hack + gift priced in the chain outside BN13: the accept follows hack+gift / hack; an unpriced decision holds the gift open')
  const P = await import('../../plan.js')
  const BB = await import('../../bbplan.js')
  const se = await import('../../stanekepoch.js')
  const { bitNodeMults } = await import('../../bitNodeMultipliers.js')
  const { drain } = await import('../../coop.js')
  const nm = bitNodeMults(10, 3)
  // a BN10.3 entry (SF10.2 held), the builder covenantroute's MC checks use, at the lo economy
  const { freshInputs, defaultProfile } = await import('../sim/nodechoice/hackexit.mjs')
  const SF = [[1, 3], [2, 1], [4, 2], [5, 1], [6, 3], [7, 2], [8, 1], [9, 3], [10, 2], [11, 1], [12, 1], [13, 2], [14, 3]]
  const base = freshInputs({ node: 10, sf: SF, g: 0.0405, profile: defaultProfile({ cycleHours: 2.63 }) })
  const charger = { liveGB: 780, liveHome: { ram: 128, cores: 1 }, ageH: 0.2, ramHours: 61 }
  const gift = { available: true, accepted: false, forfeited: false, l13: 1 }
  const g = se.routeGiftChainOptionsOf({ gift, nodeMults: nm, base, install: null, hackCharger: charger })
  const withG = (g?.hackOptions ?? []).filter((o) => o.withGift)
  c.examined(3)
  if (withG.length !== se.CHAIN_HACK_F.length) c.fail(`the chain must price hack + gift at every CHAIN_HACK_F (${withG.length} of ${se.CHAIN_HACK_F.length})`, g?.why)
  if (!(g?.hackOptions ?? []).some((o) => o.withGift === false && o.inputs === base)) c.fail('the chain keeps hack WITHOUT the gift on the live inputs')
  // the inputs: Genesis x0.9 at the accept (hacking x0.9 before the charge) and the life-average charge on top
  const gen = sp.penaltyStepInputsOf(base, 1, sp.PENALTY[1])
  const o1 = withG.find((o) => o.f === 0.1)
  c.examined(2)
  if (!(Math.abs(gen.hackingMult / base.hackingMult - 0.9) < 1e-12)) c.fail('Genesis moves hacking x0.9 at the accept', gen.hackingMult)
  if (!(o1?.inputs?.hackingMult > gen.hackingMult && o1.inputs.incomePerSec > gen.incomePerSec)) c.fail('the charged hacking layout lifts hacking and income above Genesis alone', JSON.stringify(o1?.inputs))
  if (se.routeGiftChainOptionsOf({ gift, nodeMults: nm, base, install: null }).hackOptions.some((o) => o.withGift)) c.fail('no charger inputs: hack + gift unpriced (not invented)')
  const f0 = sp.hackChainGiftInputsOf(base, { ...charger, layout: sp.layoutForGrid(4, 4, nm.StaneksGiftPowerMultiplier, 'hack').placed, nodePower: nm.StaneksGiftPowerMultiplier, f: 0 })
  c.examined(1)
  if (!(f0.inputs && Math.abs(f0.inputs.hackingMult / gen.hackingMult - 1) < 1e-12 && Math.abs(f0.inputs.incomePerSec / gen.incomePerSec - 1) < 1e-12)) c.fail('hack + gift at f 0 is Genesis alone: the accept costs x0.9 before any charge', JSON.stringify(f0.inputs && { h: f0.inputs.hackingMult, g: gen.hackingMult }))
  // the decision on the hacking exit model itself (plan.trajectoryOf, the default policy)
  const traj = P.trajectoryOf(null, {})
  const trajGen = P.trajectoryGenOf(null, {})
  const ones = { strength: 1, defense: 1, dexterity: 1, agility: 1, charisma: 1, hacking: 1, intelligence: 149 }
  const m = { strength: 0.52, defense: 0.52, dexterity: 0.52, agility: 0.52, charisma: 0.52, strength_exp: 1.3, defense_exp: 1.3, dexterity_exp: 1.3, agility_exp: 1.3, charisma_exp: 1.3, bladeburner_success_chance: 1, bladeburner_max_stamina: 1, bladeburner_stamina_gain: 1 }
  const s0 = BB.bladeStartOf({ tel: null, person: { skills: ones, exp: {}, mults: m, city: 'Sector-12', money: 1262 }, sleeves: { infiltrate: 1, support: 4, fa: 0, contracts: 2, trainTo: 100 }, gymExpPerSec: 14.7, bnRank: nm.BladeburnerRank, skillCostMult: nm.BladeburnerSkillCost, install: null, rankScale: 1, successScale: 1, maxH: 400 })
  const dec = (gg, mandate = null) => drain(P.decideBladeRouteGen({ base, traj, trajGen, bladeStart: s0, draws: [], post: false, gift: gg, mandate }))
  const cov = { covenant: { cost: 1e17, joinMoney: 75e9, combatH: 2.4, member: false, sleeveExpPerSec: 0 }, why: 'test' }
  const d = dec(g, cov)
  const noG = d.gift?.hack?.options?.find((o) => !o.withGift)?.hours
  const best = Math.min(...(d.gift?.hack?.options ?? []).filter((o) => o.withGift).map((o) => o.hours))
  c.examined(3)
  c.note(`hack ${d.hackH}h (without the gift ${noG}h, best with ${best}h), blade ${d.bladeH}h -> '${d.key}', accept ${d.gift?.accept}, hackBareH ${d.gift?.hackBareH}`)
  if (d.key !== 'hack' || !(best < noG) || d.gift?.accept !== true || d.gift?.hackWithGift !== true) c.fail('hack + gift faster: the route is hack and the accept is true', JSON.stringify({ key: d.key, accept: d.gift?.accept, best, noG }))
  if (!(typeof d.gift?.hackBareH === 'number' && d.gift.hackBareH > 0)) c.fail('the chain publishes the bare no-gift hacking exit (the ramp length the next pass uses)')
  // hack + gift slower (an absurdly expensive Genesis): hack without, accept false
  const slow = { ...g, hackOptions: g.hackOptions.map((o) => (o.withGift ? { ...o, inputs: { ...o.inputs, incomePerSec: o.inputs.incomePerSec * 0.5 } } : o)) }
  const ds = dec(slow, cov)
  c.examined(1)
  if (ds.key !== 'hack' || ds.gift?.accept !== false) c.fail('hack chosen, hack + gift slower: the accept is false', JSON.stringify({ key: ds.key, accept: ds.gift?.accept }))
  // UNPRICED: a mandate that binds unpriced -> both arms unpriced, the route held, the accept NULL (never a decline)
  const du = drain(P.decideBladeRouteGen({ base, traj, trajGen, bladeStart: s0, draws: [], post: false, gift: g, mandate: { covenant: null, unpriced: true, why: 'test' }, prev: { key: 'hack', at: new Date().toISOString() } }))
  c.examined(1)
  if (!(du.unpriced?.length > 0) || du.gift?.accept !== null) c.fail('an unpriced route decision publishes accept null', JSON.stringify({ unpriced: du.unpriced, accept: du.gift?.accept }))
  // the verdict null HOLDS the option (stanek.js does not accept, act.js refuses non-NFG orders); a priced false does not
  const ri = { currentNode: 10, lastAugReset: 1000, lastNodeReset: 0, ownedSF: new Map([[13, 1], [7, 3], [10, 2]]), ownedAugs: new Map() }
  const prog = (gift2) => JSON.stringify({ at: new Date().toISOString(), route: { route: 'hack', node: 10, lastAugReset: 1000, gift: gift2 } })
  const vNull = sp.giftVerdictOfProgress(prog({ chain: true, accept: null }), ri)
  const held = sp.giftStateOf(ri, true, 'hack', vNull)
  const yes = sp.giftStateOf(ri, true, 'hack', sp.giftVerdictOfProgress(prog({ chain: true, accept: true }), ri))
  const no = sp.giftStateOf(ri, true, 'hack', sp.giftVerdictOfProgress(prog({ chain: true, accept: false }), ri))
  c.examined(4)
  if (!(vNull && vNull.accept === null) || held.want || !held.hold || sp.giftOrderGate(held, { kind: 'buyaug', args: ['CyberSec', 'BitRunners'] }).allow) c.fail('a chain verdict with accept null HOLDS the gift open (no accept, non-NFG orders refused)', JSON.stringify({ vNull, want: held.want, hold: held.hold }))
  if (!yes.want || yes.basis !== 'hack') c.fail('the chain verdict accept on the hack route: wanted, basis hack', JSON.stringify(yes))
  if (no.want || no.hold) c.fail('a priced decline on the hack route: not wanted, not held', JSON.stringify(no))
  if (sp.GIFT_HOLD_NODES.has(10)) c.fail('BN10 needs no hand hold once the chain prices hack + gift')
  return c
}

async function sg24() {
  const c = new Check('SG24', "one charger model before and after the accept: hackGiftInputsOf on the chain's charger reproduces hackChainGiftInputsOf")
  const rd = (f) => fs.readFileSync(path.join(REPO, f), 'utf8')
  const { bitNodeMults } = await import('../../bitNodeMultipliers.js')
  const nm = bitNodeMults(5, 2)
  const gs = sp.giftSize(nm.StaneksGiftExtraSize ?? 0, 3)
  const np = nm.StaneksGiftPowerMultiplier
  const L = sp.layoutForGrid(gs.width, gs.height, np, 'hack').placed.map((p) => ({ id: p.id, x: p.x, y: p.y, rot: p.rot ?? p.rotation }))
  // the BN5.2 entry as the dry-run measured it: a 228GB fleet, home 128GB / 1 core
  const base = { incomePerSec: 2.1e4, expPerSec: 310, repPerSec: 4.2, hackingMult: 1.7, cycleHours: 2.6 }
  const charger = { lastNodeReset: 1, liveGB: 228, liveHome: { ram: 128, cores: 1 }, ageH: 0.1, ramHours: 19.2 }
  const st = { node: 5, layout: { placed: L, nodePower: np }, fleet: { gb: 228, hosts: [{ host: 'home', cores: 1, maxRam: 128, capGb: 60 }, { host: 'n00dles', cores: 1, maxRam: 100, capGb: 100 }] }, charger: { gb: 0 } }
  const accepted = sp.penaltyStepInputsOf(base, 1, sp.PENALTY[1]) // Genesis now in the live multipliers
  const keys = ['incomePerSec', 'expPerSec', 'repPerSec', 'hackingMult']
  for (const f of [0.05, 0.2, 0.3]) {
    const pre = sp.hackChainGiftInputsOf(base, { ...charger, layout: L, nodePower: np, f })
    const post = sp.hackGiftInputsOf(accepted, st, { node: 5, layout: L, f, sameLife: true, charger })
    c.examined(1)
    const off = keys.filter((k) => !(pre.inputs && post.inputs && Math.abs(post.inputs[k] / pre.inputs[k] - 1) < 1e-9))
    if (off.length || pre.basis !== 'ramp' || post.basis !== 'ramp') c.fail(`f ${f}: the accepted builder must price the chain's trajectory (${off.join(', ') || 'basis'} differ)`, JSON.stringify({ pre: pre.inputs && keys.map((k) => pre.inputs[k]), post: post.inputs && keys.map((k) => post.inputs[k]), basis: [pre.basis, post.basis] }))
  }
  // the ramp is what moves it: the same accepted builder on the fleet held at entry prices lower
  const held = sp.hackGiftInputsOf(accepted, st, { node: 5, layout: L, f: 0.2, sameLife: true })
  const ramp = sp.hackGiftInputsOf(accepted, st, { node: 5, layout: L, f: 0.2, sameLife: true, charger })
  c.examined(1)
  if (!(held.basis === 'measured' && ramp.inputs?.hackingMult > held.inputs?.hackingMult)) c.fail('no charger: the measured fleet alone (a lower bound), below the ramp', JSON.stringify({ held: held.basis, h: held.inputs?.hackingMult, r: ramp.inputs?.hackingMult }))
  else c.note(`BN5.2 at f 0.2: hacking x${(ramp.inputs.hackingMult / accepted.hackingMult).toFixed(3)} on the ramp vs x${(held.inputs.hackingMult / accepted.hackingMult).toFixed(3)} on the fleet held at entry`)
  // the reference is the LIVE charge the inputs were measured under (never the life-average at fNow:
  // a charger just started is not a charged gift — BN2.2 dry-run 19.0h -> 22.4h at the same f)
  const frags = L.map((p) => ({ ...p, highestCharge: 40, numCharge: 30 }))
  const live = sp.liveGiftLnOf({ fragments: frags, layout: { nodePower: np } })
  const charged = sp.hackGiftInputsOf(accepted, { ...st, fragments: frags, charger: { gb: 44 } }, { node: 5, layout: L, f: 0.2, sameLife: true, charger })
  const fresh = sp.hackGiftInputsOf(accepted, { ...st, charger: { gb: 44 } }, { node: 5, layout: L, f: 0.2, sameLife: true, charger })
  c.examined(2)
  if (!(live?.lnHack > 0) || Math.abs((charged.inputs.hackingMult * Math.exp(live.lnHack)) / fresh.inputs.hackingMult - 1) > 1e-9) c.fail('the reference must be the live charge of the record (layoutMults of its fragments)', JSON.stringify({ live, c: charged.inputs?.hackingMult, f: fresh.inputs?.hackingMult }))
  if (Math.abs(fresh.inputs.hackingMult / ramp.inputs.hackingMult - 1) > 1e-9) c.fail('no charge on the record: a running charger (fNow > 0) moves no hacking channel — the gift is uncharged', JSON.stringify({ f: fresh.inputs.hackingMult, r: ramp.inputs.hackingMult }))
  // the wiring: one charger builder for both passes, its ramp length carried past the accept
  const pr = rd('progress.js')
  c.examined(4)
  if (!/const charger = chainHackChargerOf\(ns, info\)\n[^]*?hackGiftInputsOf\(base, st, \{ node: info\.currentNode, layout: L, f: fH, sameLife, charger \}\)/.test(pr)) c.fail("progress.js routeGiftOf must price the accepted arm on chainHackChargerOf (the chain's charger)")
  if (!/hackCharger: charger[^\n]*\}\)\n\s*return r \? \{ \.\.\.r, charger \} : r/.test(pr)) c.fail('progress.js routeGiftChainOf must publish the charger it priced on')
  if (!/charger: gift\?\.charger \?\? null,/.test(pr)) c.fail("decisions.bladeRoute must carry the charger (its ramp length is the next pass's)")
  if (!/prev\?\.charger\?\.lastNodeReset === info\?\.lastNodeReset && prev\.charger\.ramHours > 0[^\n]*\n[^\n]*: kept \?\? HACK_CHARGER_RAMP\.fallbackH/.test(pr)) c.fail("chainHackChargerOf must keep the chain's ramp length after the accept (prev.charger of this node)")
  return c
}

async function sg25() {
  const c = new Check('SG25', "the Bladeburner arm's charger is one model before and after the accept; the Simulacrum's money leg is never an absurd hours figure")
  const rd = (f) => fs.readFileSync(path.join(REPO, f), 'utf8')
  const se = await import('../../stanekepoch.js')
  const BB = await import('../../bbplan.js')
  const { bitNodeMults } = await import('../../bitNodeMultipliers.js')
  const nm = bitNodeMults(5, 2)
  const gift = { available: true, accepted: false, forfeited: false, l13: 3 }
  const base = { incomePerSec: 2.1e4, expPerSec: 310, repPerSec: 4.2, hackingMult: 1.7, cycleHours: 2.6 }
  const ageH = 0.05
  const g = se.routeGiftChainOptionsOf({ gift, nodeMults: nm, base, install: null, bladeCharger: { ageH, H: 0 } })
  const pre = g.bladeOptions.find((o) => o.make)
  // the accepted pass: the same layout placed at zero charge, the live charger not yet running (H 0)
  const placed = pre ? g.bladeOptions.length && sp.layoutForGrid(sp.giftSize(0, 3).width, sp.giftSize(0, 3).height, nm.StaneksGiftPowerMultiplier, 'blade').placed.map((p) => ({ id: p.id, x: p.x, y: p.y, rot: p.rot })) : []
  const live = { placed, charges: placed.map(() => ({ highestCharge: 0, numCharge: 0 })), masses: placed.map(() => 0), H: 0, nodePower: nm.StaneksGiftPowerMultiplier }
  const post = se.bladeGiftMakerOf({ live, target: null, nodePower: nm.StaneksGiftPowerMultiplier, thrAt: sp.bladeChargerThrOf({ ageH, H: live.H }) })
  const held = se.bladeGiftMakerOf({ live, target: null, nodePower: nm.StaneksGiftPowerMultiplier })
  c.examined(1)
  if (!pre || !placed.length) c.fail('no Bladeburner gift option in the chain for BN5.2', JSON.stringify(g?.why))
  else {
    const a = pre.make()
    const b = post()
    const h = held()
    let worst = 0
    let heldGap = 0
    for (const tS of [600, 3600, 4 * 3600, 12 * 3600]) {
      const fa = a.factorAt(tS)
      const fb = b.factorAt(tS)
      const fh = h.factorAt(tS)
      // the chain carries Genesis in its factors; the accepted pass has it in the live multipliers
      for (const k of ['agility', 'dexterity', 'bladeburner_success_chance']) {
        const pa = se.GENESIS_BLADE_KEYS.includes(k) ? fa[k] / sp.PENALTY[1] : fa[k]
        worst = Math.max(worst, Math.abs(Math.log(fb[k] / pa)))
        heldGap = Math.max(heldGap, Math.abs(Math.log(fh[k] / pa)))
      }
    }
    c.examined(2)
    if (worst > 1e-9) c.fail(`the accepted arm must price the chain's charger: the factors differ by ln ${worst.toExponential(2)}`)
    if (!(heldGap > 1e-3)) c.fail('RED baseline: the live H held (0 at the accept) must price differently — else this check cannot see the bug', heldGap)
    c.note(`blade factors: chain vs accepted ln gap ${worst.toExponential(1)}; vs the live H held ${heldGap.toFixed(3)}`)
  }
  // floored at the live charger: never below what it has now
  const thr = sp.bladeChargerThrOf({ ageH: 10, H: 5000 })
  c.examined(1)
  const ramp = sp.bladeThrAt({ gbMax: sp.BLADE_HOST.gbMax.mid })
  if (!(thr(0) === 5000 && sp.bladeChargerThrOf({ ageH: 0, H: 0 })(0) === ramp(0) && sp.bladeChargerThrOf({ ageH: 3, H: 0 })(0) === ramp(3 * 3600) && ramp(3 * 3600) > ramp(0))) c.fail('bladeChargerThrOf: the ramp at the node age, floored at the live H')
  const pr = rd('progress.js')
  c.examined(2)
  if (!/thrAt: bladeChargerThrOf\(\{ ageH: charger\.ageH, H: live\.H \}\)/.test(pr)) c.fail("progress.js routeGiftOf: the accepted Bladeburner arm must charge on bladeChargerThrOf (the chain's model)")
  if (!/bladeCharger: \{ ageH: charger\.ageH, H: 0 \}/.test(pr)) c.fail('progress.js routeGiftChainOf must place the chain on the node age (bladeCharger)')
  // the Simulacrum
  const s0 = { stub: true }
  let v1 = null
  try {
    v1 = BB.simulacrumVerdict({ s0, withoutH: 15, cost: 3e11, repReq: 1e4, wealth: 0, moneyPerH: 7.9e7, atJoin: true })
  } catch (e) {
    v1 = { threw: String(e).slice(0, 120) }
  }
  c.examined(1)
  if (!(v1?.buy === false && v1.atJoin === true && v1.moneyH === undefined)) c.fail('SF7.3 before the join: the Simulacrum arrives at the join, no money leg', JSON.stringify(v1))
  const pr2 = /atJoin: tel\?\.joined !== true && \(info\.ownedSF\?\.get\?\.\(7\) \?\? 0\) >= 3/.test(pr)
  c.examined(1)
  if (!pr2) c.fail('progress.js must pass atJoin from SF7.3 and the division not joined')
  const bp = rd('bbplan.js')
  c.examined(1)
  if (!/moneyH: moneyPast \? null : r2\(moneyH\)/.test(bp)) c.fail('bbplan.simulacrumVerdictGen must publish a money leg past the exit as unpriced (null + moneyUnpriced)')
  return c
}

async function sg26() {
  const c = new Check('SG26', "the charger's allocation f is priced on the chain's charger: the accepted pass and the chain pick the same f")
  const rd = (f) => fs.readFileSync(path.join(REPO, f), 'utf8')
  const se = await import('../../stanekepoch.js')
  const { bestExitPolicy, expForLevel } = await import('../../exitplan.js')
  const { bitNodeMults } = await import('../../bitNodeMultipliers.js')
  const nm = bitNodeMults(5, 2)
  const gs = sp.giftSize(nm.StaneksGiftExtraSize ?? 0, 3)
  const np = nm.StaneksGiftPowerMultiplier
  const L = sp.layoutForGrid(gs.width, gs.height, np, 'hack').placed.map((p) => ({ id: p.id, x: p.x, y: p.y, rot: p.rot ?? p.rotation }))
  // the BN5.2 entry shape (SG24): a 228GB fleet, home 128GB / 1 core, a young node ramping over ~19h
  const base = { money: 1e6, incomePerSec: 2.1e4, hacking: 50, hackingExp: expForLevel(50, 1.7), hackingMult: 1.7, expPerSec: 310, repPerSec: 4.2, exitRep: 0, exitFavor: 0, cycleHours: 2.6, multGainPerCycle: 1.3, exitLevel: 3000, joinMoney: 1e9, terminalRep: 2.5e6, donationCost: 1e12 }
  const H = (inp) => (inp ? bestExitPolicy(inp, 6).best?.hours ?? null : null)
  const charger = { lastNodeReset: 1, liveGB: 228, liveHome: { ram: 128, cores: 1 }, ageH: 0.1, ramHours: 19.2 }
  const hosts = [{ host: 'home', cores: 1, maxRam: 128, capGb: 60 }, { host: 'n00dles', cores: 1, maxRam: 100, capGb: 100 }]
  const st = { node: 5, layout: { placed: L, nodePower: np }, fleet: { gb: 228, hosts }, charger: { gb: 0 } }
  const accepted = sp.penaltyStepInputsOf(base, 1, sp.PENALTY[1])
  // one grid: the chain's fractions are the allocation's, f > 0
  c.examined(1)
  if (JSON.stringify([0, ...se.CHAIN_HACK_F]) !== JSON.stringify(sp.ALLOC_GRID)) c.fail('the chain and the allocation must price one f grid (CHAIN_HACK_F = ALLOC_GRID, f > 0)', JSON.stringify({ chain: se.CHAIN_HACK_F, alloc: sp.ALLOC_GRID }))
  const opts = sp.allocOptionsOf(st.fleet.gb, hosts)
  const alloc = []
  const chain = []
  for (const f of opts) {
    const a = sp.hackGiftInputsOf(accepted, st, { node: 5, layout: L, f, sameLife: true, charger })
    alloc.push({ f, hours: H(a.inputs) })
    if (f > 0) chain.push({ f, hours: H(sp.hackChainGiftInputsOf(base, { ...charger, layout: L, nodePower: np, f }).inputs) })
    c.examined(1)
  }
  const ca = sp.chooseAlloc(alloc, null)
  const cc = chain.filter((x) => typeof x.hours === 'number').reduce((b, x) => (!b || x.hours < b.hours ? x : b), null)
  if (!(ca.f > 0 && cc && ca.f === cc.f && Math.abs(ca.hours - cc.hours) < 1e-9)) c.fail(`the accepted pass's f must be the chain's on the same state: alloc f ${ca.f} (${ca.hours}h) vs chain f ${cc?.f} (${cc?.hours}h)`, ca.why)
  else c.note(`BN5.2 shape: f ${ca.f} on both (${ca.why})`)
  // the chain's f is the incumbent: within the 0.1h band it holds, so the first accepted pass keeps it
  const inc = sp.chooseAlloc(alloc, cc?.f ?? null)
  c.examined(1)
  if (inc.f !== cc?.f) c.fail("with the chain's f as the incumbent the accepted pass must keep it", inc.why)
  // the wiring
  const pr = rd('progress.js')
  const sd = pr.slice(pr.indexOf('async function stanekDecisionOf('), pr.indexOf("THE LIFE'S LAYOUT", pr.indexOf('async function stanekDecisionOf(')))
  c.examined(5)
  if (!/const charger = chainHackChargerOf\(ns, info\)/.test(sd)) c.fail("progress.js stanekDecisionOf must price on chainHackChargerOf (the route arms' charger)")
  if (!/hackGiftInputsOf\(base, st, \{ node: info\.currentNode, layout: st\.layout\.placed, f, sameLife: live, charger \}\)/.test(sd)) c.fail('progress.js stanekDecisionOf must build every option with hackGiftInputsOf on that charger (one builder)')
  if (/chargeInputsOf\(/.test(sd)) c.fail('progress.js stanekDecisionOf prices f on chargeInputsOf (the fleet held at entry) again')
  if (!/chooseAlloc\(priced, typeof prev\?\.f === 'number' \? prev\.f : chainHackFOf\(info\)\)/.test(sd)) c.fail("progress.js stanekDecisionOf's incumbent before a decision of the life must be the chain's f (chainHackFOf)")
  if (!/prevS\.f > 0 \? prevS\.f : chainHackFOf\(info\) \?\? DEFAULT_F/.test(pr)) c.fail("progress.js routeGiftOf's fH must fall back to the chain's f before DEFAULT_F")
  if (!/function chainHackFOf\(info\) \{\n[^\n]*prevAny\?\.decisions\?\.bladeRoute\n[^\n]*charger\?\.lastNodeReset === info\?\.lastNodeReset \? g\?\.gift\?\.hackF : null/.test(pr)) c.fail("chainHackFOf must read this node's decisions.bladeRoute.gift.hackF")
  // the chain publishes the f it chose (hack rows carry o.f; the chosen row's f is gift.hackF)
  const pl = rd('plan.js')
  c.examined(2)
  if (!/hackRows\.push\(\{ src: o\.src, key: o\.key \?\? null, f: typeof o\.f === 'number' \? o\.f : null,/.test(pl)) c.fail('plan.decideBladeRouteGen: the hack rows must carry the option\'s f')
  if (!/hackF: hb && hb\.withGift \? hb\.f : null,/.test(pl)) c.fail("plan.decideBladeRouteGen must publish the chosen hack + gift option's f (gift.hackF)")
  return c
}

export async function run() {
  return [sg1(), await sg2(), await sg3(), await sg4(), sg5(), await sg6(), await sg7(), await sg8(), await sg9(), await sg10(), await sg11(), await sg12(), await sg13(), await sg14(), await sg15(), sg16(), await sg17(), sg18(), await sg19(), sg20(), await sg21(), await sg22(), await sg23(), await sg24(), await sg25(), await sg26()]
}
