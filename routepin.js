// THE ROUTE PIN. Pure, no ns calls (imported by progress.js; free).
//
// WHY THIS EXISTS. The route decision (progress.js bladeRouteOf,
// plan.decideBladeRouteGen) compares two exits — the 21 black ops ('blade')
// and the World Daemon ('hack') — and commits the faster. In BN9.2 it chose
// 'blade' and exited without The Red Pill ever being bought: on that route the
// install decision prices the black-op exit, the work slot is the division's,
// Daedalus is never targeted. The user (2026-10-09) wants the next node played
// on the HACKING exit regardless — Daedalus, The Red Pill installed, the
// hidden 19x19 Go opponent (w0r1d_d43m0n, netscriptGoImplementation.ts:359:
// playable only with The Red Pill INSTALLED) played on the way, and the exit
// by hacking w0r1d_d43m0n — even where the black ops price faster.
//
// THE FILE: /route-pin.txt on home. A text file on home survives installs.
//   hack            pin the hacking route in whatever node this is
//   hack 12         pin it only in BitNode 12 (anything after is the reason)
//   hack node=12    the same
// The first word is the route; only 'hack' is accepted. Anything else, or a
// node that is not this one, is reported (`warn`) and NOT acted on.
//
// WHAT IT DOES. The route decision is priced exactly as before; the pin only
// changes the key the stack ACTS on to 'hack' (pinnedRouteOf), naming what was
// priced and the hours forgone (hackH - bladeH on the same pass). The
// decision's commitment rule keeps running on the UNPINNED record
// (unpinnedOf), so deleting the file restores the priced route next pass.
//
// STANEK'S GIFT NEVER PINS (L4, 2026-10-16). Accepting the gift changes the INPUTS to the route
// decision, not the decision: progress.js prices both routes conditioned on it (plan.decideBladeRouteGen
// `gift`) and acts on the priced one. The gift's automatic pin (giftPinOf: 'blade' outside BN13, 'hack'
// in BN13) is gone — on 2026-10-15 it was misapplied and cost BN11.1 ~1.2h of the wrong route and a
// charge wipe. Only this file pins; the gift is reported beside the route (routeReportOf `gift`).
//
// WHAT IT NEVER DOES. The exit itself stays endgame.js's (the only
// destroyW0r1dD43m0n caller, after its /endgame-hold.txt read); act.js refuses
// a w0r1d_d43m0n backdoor. Nothing here acts on the world daemon.

export const ROUTE_PIN = '/route-pin.txt'

/**
 * Parse the pin for this node. Published whether or not it acts (absence is
 * never a signal: an absent pin reads `pinned: false` WITH the reason).
 * Returns { pinned, route, node, file, text, warn, why }.
 */
export function routePinOf(text, currentNode) {
  const raw = String(text ?? '').trim()
  const base = { file: ROUTE_PIN, text: raw ? raw.slice(0, 200) : null, route: null, node: null }
  if (!raw) return { ...base, pinned: false, warn: null, why: `no ${ROUTE_PIN}: the route is the priced one` }
  const words = raw.split(/\s+/)
  const route = words[0].toLowerCase()
  const m = String(words[1] ?? '').match(/^(?:node=)?(\d+)$/i)
  const node = m ? Number(m[1]) : null
  const out = { ...base, route, node }
  if (route !== 'hack') return { ...out, pinned: false, warn: `${ROUTE_PIN} names route '${words[0]}' — only 'hack' can be pinned; NOT acting on it`, why: 'pin unreadable' }
  if (node !== null && node !== currentNode) return { ...out, pinned: false, warn: `${ROUTE_PIN} pins BitNode ${node}, this is BitNode ${currentNode} — NOT acting on it (delete or rewrite the file)`, why: `pin for another node (${node})` }
  return { ...out, pinned: true, warn: null, why: `${ROUTE_PIN} pins the hacking route${node !== null ? ` in BitNode ${node}` : ''}: Daedalus, The Red Pill installed, the World Daemon by hacking (endgame.js) — even where the black ops price faster` }
}

/**
 * The route decision the stack ACTS on. `d` is the priced record. Pinned:
 * key 'hack', `pin` naming the priced key and the hours forgone. Otherwise
 * `d` unchanged. An unpriced record (key null) keeps key null — nothing reads
 * 'blade' then, which is already the hacking route — and carries the pin.
 */
export function pinnedRouteOf(d, pin) {
  if (!pin?.pinned || !d || typeof d !== 'object') return d
  const pricedKey = d.key ?? null
  const fin = (x) => typeof x === 'number' && isFinite(x)
  // Only /route-pin.txt pins, and only 'hack' (routePinOf): a pin of anything else is not acted on.
  if (pin.route !== 'hack' || pin.file !== ROUTE_PIN) return { ...d, pin: { file: pin.file ?? null, text: pin.text ?? null, pricedKey, forgoneH: 0, ignored: `not ${ROUTE_PIN}'s 'hack' pin: the priced route is acted on` } }
  const forgoneH = pricedKey === 'blade' && fin(d.hackH) && fin(d.bladeH) ? +(d.hackH - d.bladeH).toFixed(3) : pricedKey === 'hack' ? 0 : null
  const note = { file: pin.file ?? ROUTE_PIN, text: pin.text ?? null, pricedKey, forgoneH }
  if (pricedKey !== 'blade') return { ...d, pin: note }
  return {
    ...d,
    key: 'hack',
    pin: note,
    why: `PINNED to 'hack' by ${note.file}: the priced route is 'blade' (${fin(d.bladeH) ? d.bladeH.toFixed(1) : '?'}h by the black ops vs ${fin(d.hackH) ? d.hackH.toFixed(1) : '?'}h by the World Daemon; ${fin(forgoneH) ? forgoneH.toFixed(1) + 'h forgone' : 'forgone hours unpriced'}) — ${String(d.why ?? '').slice(0, 200)}`,
  }
}

/**
 * THE NODE ROUTE RULES (2026-10-25): a route the GAME makes impossible in a node, whatever the route
 * decision prices it at. Not a pin and not a preference: the priced record is kept (nodeRule.pricedKey),
 * the commitment rule keeps running on it (unpinnedOf), and /route-pin.txt still wins (the user's word).
 *
 *   BitNode 15  The Red Pill is NOT sold by Daedalus there (FactionHelpers.tsx:205); it is the 5th darknet
 *               labyrinth's reward (labyrinth.ts:419-427: EternalLab, depth 29, charisma 3000, after the
 *               first four labs' augmentations are INSTALLED). exitplan prices the hacking exit through
 *               Daedalus — an exit that does not exist here: the BN15.1 entry dry-run (2026-10-25) priced
 *               'hack' at 20h vs 'blade' at 139h, and acting on it would grind Daedalus for a Red Pill
 *               that never appears (endgame.js: 'need-the-red-pill' forever).
 *               2026-10-25 (second slice): the labyrinth route's MECHANICS are built and played headlessly
 *               in the game's own darknet — crawl, air gaps, KingOfTheHill, the maze, the reward cache, the
 *               install per lab, five labs to The Red Pill in ~86 game-minutes (tools/sim/entry/dnetlab.mjs,
 *               charisma injected). labReady STAYS false: (1) charisma 2500/3000 rests on charisma
 *               augmentations no BN15 life has bought (tools/sim/lab15.mjs: +8h at the mid trajectory, labs
 *               4-5 out of reach at the low one); (2) with labReady the stack acts on the PRICED key, and the
 *               in-game exit has no lab arm — it prices a Daedalus Red Pill — and no fallback to the black
 *               ops if the climb stalls. Lift it when both exist (the user's /route-pin.txt still wins).
 *               2026-10-26 (third slice): labReady TRUE — both conditions closed. (1) The charisma climb is
 *               priced end to end on MEASURED trajectories (labtraj.js, tools/sim/chatraj.mjs: every
 *               hacking-route clear's installed charisma product per life — the stack's buyer, not valuing
 *               charisma, a floor): 11 of 13 reach labs 4-5 before the final window (the 2 that do not are
 *               early nodes whose NeuroFlux levels the history cannot read), the leg +1.0h median; at the BN15.1
 *               entry the lab arm prices ~61h with its failures as the fallback against the black ops' ~157h.
 *               (2) The route decision has a LAB ARM (plan.decideBladeRouteGen `lab`, labroute.js): the 'hack'
 *               option IS the labyrinth route, every measured trajectory priced from the live charisma state,
 *               a trajectory that cannot reach a remaining lab priced as the black ops from the stall; LAB CLIMB
 *               STALLED (labroute.labStallOf, healthcheck from the save) re-prices a stalled climb with no
 *               further growth and the decision moves to the black ops on its own pricing (tools/test/
 *               labroute.test.mjs LR4). With labReady false (a mutant, or a rollback) the rule binds again.
 *               What labReady switches on: the lab arm, dnet-seed.js's charisma farm (off again once the acted
 *               route is 'blade'), the lab install (dnetplan.labInstallOf), charisma-aware buying
 *               (chaplan.chaLabsCtxOf, off on the black ops).
 */
export const NODE_ROUTE_RULES = {
  15: {
    route: 'blade',
    labReady: true,
    why: "BitNode 15: The Red Pill is not sold by Daedalus (FactionHelpers.tsx:205) but by the 5th darknet labyrinth (labyrinth.ts:419-427) — with labReady the route decision prices the labyrinth route as its 'hack' arm (labroute.js, measured charisma trajectories, the black ops as the fallback); this rule binds only while labReady is false: the black ops are the exit",
  },
}

/**
 * THE RULE AS AN INPUT TO THE DECISION (2026-10-25): where a node's rule binds — a rule, the route not built
 * (labReady false) and no /route-pin.txt pin (the user's word wins, and it pins 'hack') — the route decision
 * decides among the routes the node leaves (plan.decideBladeRouteGen `rule`): its distribution, its gift
 * accept and every sub-decision gated on its key (the Simulacrum, the grafts, the lend, the hash exchange)
 * are the ACTED route's. Wrapping a decision priced on the other route afterwards (nodeRouteOf alone) left
 * all of those on the hacking arm: the BN15.1 entry dry-run published the hacking distribution (q50 29.9h,
 * mean 55.3h) as "the Bladeburner route" and the chain accepted the gift on hack + gift (26.2h vs 27.0h)
 * while the black-op arm it acted on priced the gift WORSE (150.3h vs 147.9h declining).
 * Returns {route, why} or null.
 */
export function nodeRuleOf(node, pin = null, rules = NODE_ROUTE_RULES) {
  const rule = rules[node]
  if (!rule || rule.labReady) return null
  if (pin?.pinned === true && pin.file === ROUTE_PIN) return null
  return { route: rule.route, why: rule.why }
}

/** The route the stack ACTS on after the node's rule (NODE_ROUTE_RULES). `d` is the (pinned) record. */
export function nodeRouteOf(d, node, pin = null, rules = NODE_ROUTE_RULES) {
  const rule = rules[node]
  if (!rule || rule.labReady || !d || typeof d !== 'object') return d
  // decided under the rule (nodeRuleOf -> plan.decideBladeRouteGen): the record is already the acted route's
  if (d.nodeRule?.inDecision === true && d.key === rule.route) return d
  if (pin?.pinned === true && pin.file === ROUTE_PIN) return { ...d, nodeRule: { route: rule.route, forced: false, pricedKey: d.pin?.pricedKey ?? d.key ?? null, overriddenBy: ROUTE_PIN, why: rule.why } }
  if (d.key === rule.route) return { ...d, nodeRule: { route: rule.route, forced: false, pricedKey: d.key, why: rule.why } }
  return {
    ...d,
    key: rule.route,
    nodeRule: { route: rule.route, forced: true, pricedKey: d.key ?? null, why: rule.why },
    why: `NODE RULE (BitNode ${node}) acts on '${rule.route}' (priced '${d.key ?? 'none'}'${typeof d.hackH === 'number' && typeof d.bladeH === 'number' ? `: hack ${d.hackH.toFixed(1)}h vs blade ${d.bladeH.toFixed(1)}h` : ''}): ${rule.why} — ${String(d.why ?? '').slice(0, 160)}`,
  }
}

/** The record the commitment rule compares against: the PRICED key, never the pin's or the node rule's. */
export function unpinnedOf(prev) {
  if (!prev || typeof prev !== 'object') return prev
  if (prev.pin && typeof prev.pin === 'object') {
    const { pin, nodeRule, ...rest } = prev
    return { ...rest, key: pin.pricedKey ?? null }
  }
  // decided under the rule (inDecision): its key IS the decision's, the comparison is only published
  if (prev.nodeRule && typeof prev.nodeRule === 'object' && prev.nodeRule.inDecision !== true) {
    const { nodeRule, ...rest } = prev
    return { ...rest, key: nodeRule.pricedKey ?? null }
  }
  return prev
}

/**
 * THE ACTED ROUTE'S EXIT DISTRIBUTION in a route record: {meanH, q10, q50, q90, n, of} or null. The record's
 * own fields are the distribution of the option the DECISION chose — after a pin (pin.pricedKey) or a node
 * rule applied outside the decision (nodeRule.pricedKey, not inDecision) that is another route's, so the
 * acted route's row in `options` is read instead (null when that route has no row: unpriced, never the
 * other route's numbers under its name). progress.js publishPlan's exit reads it.
 */
export function routeDistOf(d, route = d?.key) {
  if (!d || typeof d !== 'object' || (route !== 'hack' && route !== 'blade')) return null
  const fin = (x) => typeof x === 'number' && isFinite(x)
  const decided = d.pin && typeof d.pin === 'object' ? d.pin.pricedKey ?? null : d.nodeRule && d.nodeRule.inDecision !== true && d.nodeRule.forced === true ? d.nodeRule.pricedKey ?? null : d.key ?? null
  const pick = (x, of) => (x && fin(x.q50) ? { meanH: x.meanH, q10: x.q10, q50: x.q50, q90: x.q90, n: x.n, of } : null)
  if (decided === route) return pick(d, 'decision')
  return pick(Array.isArray(d.options) ? d.options.find((o) => o?.key === route) : null, 'option row')
}

/**
 * What /tel/progress.txt publishes as `route`: acted, priced, pinned (the FILE pin only), forgone, and
 * `gift` — a record, never a pin: whether the gift is accepted and whether the route was priced with it
 * (d.gift from plan.decideBladeRouteGen).
 */
export function routeReportOf(pin, d, giftState = null) {
  const acted = d ? d.key ?? null : 'hack'
  const priced = d ? (d.pin ? d.pin.pricedKey ?? null : d.nodeRule?.forced ? d.nodeRule.pricedKey ?? null : d.key ?? null) : null
  return {
    route: acted ?? 'hack',
    priced,
    pinned: pin?.pinned === true && pin?.file === ROUTE_PIN,
    forgoneH: d?.pin ? d.pin.forgoneH ?? null : pin?.pinned ? (d ? 0 : null) : null,
    pin: { file: pin?.file ?? ROUTE_PIN, text: pin?.text ?? null, node: pin?.node ?? null, warn: pin?.warn ?? null, why: pin?.why ?? null },
    gift: giftRecordOf(giftState, d),
    // an arm that could not be priced (plan.unpricedHoldOf): published, never a silent loss for it
    unpriced: Array.isArray(d?.unpriced) && d.unpriced.length ? d.unpriced : null,
    held: d?.held === true,
    // the node's structural rule (NODE_ROUTE_RULES): forced = the acted route is the rule's, not the priced one
    nodeRule: d?.nodeRule ? { route: d.nodeRule.route, forced: d.nodeRule.forced === true, pricedKey: d.nodeRule.pricedKey ?? null, overriddenBy: d.nodeRule.overriddenBy ?? null, why: d.nodeRule.why } : null,
    // BitNode 15's lab arm (labroute.js via plan.decideBladeRouteGen `lab`): what LAB CLIMB STALLED cross-checks against the save
    lab: d?.lab ? { priced: d.lab.priced === true, hackExitH: d.lab.hackExitH ?? null, totalH: d.lab.totalH ?? null, nodeH: d.lab.nodeH ?? null, labIndex: d.lab.labIndex ?? null, legMeanH: d.lab.legMeanH ?? null, pFail: d.lab.pFail ?? null, stalled: d.lab.stalled === true, stallWhy: d.lab.stallWhy ?? null, fallback: d.lab.fallback === true, insurance: d.lab.insurance ?? null, why: d.lab.why ?? null } : null,
    why: d ? null : 'no Bladeburner route in this node (no division): the hacking route is the only one',
  }
}

/** The gift beside the route (L4): accepted?, priced with it?, the arms' chosen options. Never a pin. */
export function giftRecordOf(gift, d) {
  const g = d?.gift ?? null
  // not accepted: the CHAIN's verdict (L4 — the route priced blade+gift, blade and hack as one decision;
  // the accept follows the chosen arm, read by stanek.js / act.js through stanekplan.giftVerdictOfProgress)
  if (!gift?.accepted) return { accepted: false, pinned: false, chain: g?.chain === true, accept: g?.chain === true && typeof g.accept === 'boolean' ? g.accept : null, pricedWithGift: g?.priced === true, why: g?.chain === true ? `the gift is acceptable: the route decision priced it with each arm — ${g.accept ? 'ACCEPT (the chosen arm is faster with it)' : 'not accepted (the chosen arm is faster without it)'}${g.why ? `; ${g.why}` : ''}` : gift?.why ?? 'not accepted' }
  return {
    accepted: true,
    node: gift.node ?? null,
    pinned: false,
    pricedWithGift: g?.priced === true,
    hackArm: g?.['hack']?.chosen ?? null, // never `.hack` / `hack:` here: the RAM calculator bills the name (ns.hack, 0.1GB)
    bladeArm: g?.blade?.chosen ?? null,
    awakeningBound: g?.awakeningBound ?? null,
    why: g?.priced === true ? "Stanek's Gift accepted: both routes priced with it (Genesis's x0.9 in the live multipliers, the placed layout's charge, the re-lay each route needs, its installs) — an input, not a pin" : `Stanek's Gift accepted but the route was NOT priced with it: ${g?.why ?? (d ? 'the decision carries no gift record' : 'no route decision')}`,
  }
}

/**
 * ROUTE HEALTH (tools/healthcheck.mjs): /tel/progress.txt `route` of this node. Fails —
 *   ROUTE NOT THE PRICED ONE   the route acted on differs from the priced one with no /route-pin.txt pin
 *                              (an automatic pin came back), or a pin from anything but /route-pin.txt
 *   ROUTE NOT PRICED WITH THE GIFT  the gift is accepted and the priced route did not carry it
 *   STANEK LAYOUT OFF ROUTE    the gift is accepted and /tel/stanek.txt's basis is not the acted route
 *                              (stanekplan.giftStateOf: the layout decision follows the route)
 * Returns [{key, problem, detail}].
 */
export function routeHealthOf({ route, stanek = null, node = null }) {
  if (!route || (node !== null && route.node !== node)) return []
  const out = []
  const R = 'ROUTE NOT THE PRICED ONE'
  const filePin = route.pinned === true && (route.pin?.file ?? ROUTE_PIN) === ROUTE_PIN
  if (route.pinned === true && !filePin) out.push({ key: R, problem: R, detail: `the route is pinned by ${route.pin?.file} — only ${ROUTE_PIN} may pin (the gift's pin is gone: L4)` })
  else if (!filePin && route.priced != null && route.route !== route.priced && !(route.nodeRule?.forced === true && route.route === route.nodeRule.route)) out.push({ key: R, problem: R, detail: `the stack acts on '${route.route}' while the priced route is '${route.priced}', and no ${ROUTE_PIN} pins it` })
  if (Array.isArray(route.unpriced) && route.unpriced.length) {
    const U = 'ROUTE ARM UNPRICED'
    out.push({ key: U, problem: U, detail: `the ${route.unpriced.join(' and ')} arm of the route decision is unpriced — ${route.held ? `held on '${route.route}'` : 'no route decided (the stack defaults to the hacking route)'}; it never loses by default (plan.unpricedHoldOf)` })
  }
  if (route.gift?.accepted === true && route.priced != null && route.gift.pricedWithGift !== true) {
    const G = 'ROUTE NOT PRICED WITH THE GIFT'
    out.push({ key: G, problem: G, detail: String(route.gift.why ?? 'the gift is accepted and the route decision did not price it').slice(0, 300) })
  }
  const sb = stanek?.gift?.accepted === true && stanek.node === route.node && stanek.lastAugReset === route.lastAugReset ? stanek.gift.basis : null
  // only where stanek.js read THIS route (gift.route: what it read from /tel/progress.txt) — a switch it has
  // not read yet is one stanek.js pass away (STANEK STALE covers a stanek.js that stopped reading)
  if (sb && (route.route === 'hack' || route.route === 'blade') && sb !== route.route && stanek.gift.route === route.route) {
    const S = 'STANEK LAYOUT OFF ROUTE'
    out.push({ key: S, problem: S, detail: `the route is '${route.route}' and stanek.js lays the gift for '${sb}' (${STANEK_NOTE})` })
  }
  return out
}
const STANEK_NOTE = 'stanekplan.giftStateOf: an accepted gift serves the acted route; stanek.js reads it from /tel/progress.txt'
