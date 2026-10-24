// THE ENTRY DRY-RUN'S VERDICTS — pure: what the stack published at a synthesized node start, read the way
// its own consumers read it (stanekplan's gift gate as stanek.js and act.js call it, bbslot's claim as
// bladeburner.js / bb-lite call it), turned into findings. Every finding names the decision and the cause
// the publisher gave; a decision this file cannot read is itself a finding ("could not tell" is never "fine").
//
//   evaluate({ read, info, canCotMG, now, phase }) -> [{ level: 'fail'|'note', kind, decision, what, cause }]
//
// kinds: INCONSISTENT (one trajectory priced by two builders that disagree across an act), UNPRICED (a decision with an arm / leg / input it could not price), HELD (an option held open or a
// route held on an unpriced arm), BLOCKED (an act the stack would refuse or cannot take), ABSURD (hours >
// ABSURD_H or non-finite where a number is published), NOT RUN (the publisher did not produce this life's
// record). tools/test/entrydryrun.test.mjs seeds each and watches it go red.
import '../../test/gameresolve.mjs'

const SP = await import('stanekplan.js')
const BS = await import('bbslot.js')

/** An exit or leg priced past this many hours is absurd at a node start (BN10.3 read 1.4e16h). */
export const ABSURD_H = 1000
/** A probe order for the act.js gate: a real non-NeuroFlux augmentation, and an install. */
export const GATE_PROBES = [
  { kind: 'buyaug', args: ['CyberSec', 'BitWire'] },
  { kind: 'install', args: [] },
]

const fin = (x) => typeof x === 'number' && Number.isFinite(x)
const short = (s, n = 260) => (s == null ? null : String(s).slice(0, n))

/** Every numeric field whose name reads as hours, with its path, in a published record. */
// A RATE is not a duration: moneyPerH ($/h), rankPerH (rank/h) end in H and are not hours (BN5.2 dry-run 2026-10-24:
// simulacrum.moneyPerH 7.9e7 read as an absurd 7.9e7h).
export const RATE_KEY = /Per[A-Za-z]*H$|PerHour$/
export function hourFieldsOf(obj, base = '', out = [], depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return out
  for (const [k, v] of Object.entries(obj)) {
    const p = base ? `${base}.${k}` : k
    if (RATE_KEY.test(k)) continue
    if (typeof v === 'number' && /(^|[a-z0-9_])H$|hours$|Hours$|^meanH$|^q\d0$/.test(k)) out.push({ path: p, v })
    else if (typeof v === 'string' && /(^|[a-z0-9_])H$|hours$|Hours$/.test(k) && /^(NaN|Infinity|-Infinity)$/.test(v)) out.push({ path: p, v: Number(v) })
    else if (v && typeof v === 'object') hourFieldsOf(v, p, out, depth + 1)
  }
  return out
}

/**
 * THE ACCEPT, RE-PRICED ONE PASS LATER: the chained route decision accepted the gift on arm r at withH
 * (vs withoutH declining); the next pass prices arm r with the gift accepted from the live state. One
 * trajectory priced twice from (almost) the same state must agree: the accepted price above withoutH means
 * the stack's own model, after the act, says the accept lost — a flip the chain cannot see.
 * entry/accepted: plan.txt decisions.bladeRoute of the two passes. Returns findings.
 */
export const ACCEPT_REPRICE_TOL = 0.25
export function acceptConsistencyOf({ entry, accepted, phase = 'accepted' }) {
  const F = []
  const g = entry?.gift
  if (!g?.chain || g.accept !== true || !accepted) return F
  const r = entry.key
  const arm = r === 'hack' ? g.hack : r === 'blade' ? g.blade : null
  const opts = Array.isArray(arm?.options) ? arm.options : []
  const withH = Math.min(...opts.filter((o) => o.withGift && fin(o.hours)).map((o) => o.hours))
  const withoutH = Math.min(...opts.filter((o) => !o.withGift && fin(o.hours)).map((o) => o.hours))
  const nowH = r === 'hack' ? accepted.hackH : accepted.bladeH
  if (!fin(withH) || !fin(nowH)) return F
  const what = `the chain accepted the gift on '${r}' at ${withH}h (declining: ${fin(withoutH) ? `${withoutH}h` : 'unpriced'}); one pass after the accept '${r}' prices at ${nowH}h`
  // the two builders of the one trajectory, by name: the chain's chosen option vs the accepted arm's
  const chainSrc = opts.find((o) => o.withGift && o.hours === withH)?.src ?? arm?.chosen ?? '?'
  const nowSrc = (r === 'hack' ? accepted.gift?.hack : accepted.gift?.blade)?.chosen ?? '?'
  const cause = short(`before the accept: ${chainSrc} | after: ${nowSrc}`, 400)
  if (fin(withoutH) && nowH > withoutH) F.push({ level: 'fail', kind: 'INCONSISTENT', decision: 'route+gift', what: `${what} — worse than declining: the accept flips on the stack's own re-pricing`, cause, phase })
  else if (nowH > withH * (1 + ACCEPT_REPRICE_TOL)) F.push({ level: 'note', kind: 'INCONSISTENT', decision: 'route+gift', what: `${what} (+${Math.round((nowH / withH - 1) * 100)}%)`, cause, phase })
  return F
}

export function evaluate({ read, info, canCotMG, now = Date.now(), phase = 'entry' }) {
  const F = []
  const add = (level, kind, decision, what, cause = null) => F.push({ level, kind, decision, what, cause: short(cause, 400), phase })
  const life = (r) => r && r.lastAugReset === info.lastAugReset
  const prog = read('/tel/progress.txt')
  const plan = read('/tel/plan.txt')

  // ---- the planner's pass
  const progFresh = prog && Date.parse(prog.at ?? '') >= info.lastAugReset
  if (!progFresh) add('fail', 'NOT RUN', 'progress.js', 'no progress.js pass of this life', prog ? `progress.txt is from ${prog.at}` : '/tel/progress.txt absent')
  else if (['snapshots-missing', 'ram-raise-denied', 'error', 'stopped'].includes(prog.result)) add('fail', 'BLOCKED', 'progress.js', `the planner's pass ended '${prog.result}'`, prog.detail ?? prog.reason ?? prog.why ?? prog.missing)
  const planFresh = plan && plan.lastAugReset === info.lastAugReset && plan.node === info.currentNode
  if (progFresh && !planFresh) add('fail', 'NOT RUN', 'plan', 'no plan record of this life and node', plan ? `plan.txt is node ${plan.node}, life ${plan.lastAugReset}` : '/tel/plan.txt absent')
  const D = planFresh ? plan.decisions ?? {} : {}
  if (planFresh && plan.error) add('fail', 'BLOCKED', 'plan', 'the plan pass recorded an error', plan.error)

  // ---- the exit
  if (planFresh) {
    const ex = plan.exit
    if (!ex || !fin(ex.meanH)) add('fail', 'UNPRICED', 'exit', 'the node exit is unpriced', ex?.why ?? ex?.source ?? `plan health '${plan.health}'`)
    else if (ex.meanH > ABSURD_H) add('fail', 'ABSURD', 'exit', `the node exit reads ${ex.meanH}h`, ex.source)
  }

  // ---- the route (+ the gift chained into it, + the Covenant mandate)
  const br = D.bladeRoute
  const route = progFresh ? prog.route : null
  if (planFresh && br) {
    if (Array.isArray(br.unpriced) && br.unpriced.length) add('fail', 'UNPRICED', 'route', `route arm(s) unpriced: ${br.unpriced.join(', ')} (hack ${br.hackH ?? 'null'}h, blade ${br.bladeH ?? 'null'}h)`, br.why)
    // held by the commitment rule on a priced comparison is a decision; held because an arm is unpriced is not
    if (br.held && (br.unpriced?.length || /unpriced/i.test(br.why ?? ''))) add('fail', 'HELD', 'route', `the route is held on '${br.key}' over an unpriced arm`, br.why)
    if (br.error) add('fail', 'BLOCKED', 'route', 'the route decision threw', br.why)
    if (br.mandate?.unpriced === true) add('fail', 'UNPRICED', 'mandate', 'the Covenant mandate binds but is unpriced', br.mandate.why)
    const g = br.gift
    if (g?.chain && g.priced === false) add('fail', 'UNPRICED', 'route+gift', 'the chained route/gift decision could not price the gift', g.why)
  } else if (planFresh && route && route.unpriced?.length) add('fail', 'UNPRICED', 'route', `route arm(s) unpriced: ${route.unpriced.join(', ')}`, route.why)

  // ---- the gift: what stanek.js accepts on and act.js gates on, read through their own functions
  if (canCotMG) {
    const txt = JSON.stringify(prog ?? null)
    const verdict = SP.giftVerdictOfProgress(txt, info, now)
    const st = SP.giftStateOf(info, canCotMG, SP.routeOfProgress(txt, info, now), verdict)
    if (!st.accepted && st.hold) add('fail', 'HELD', 'gift', 'Stanek\'s Gift is held open (a pricing hold): stanek.js does not accept, act.js refuses every non-NeuroFlux order', st.why)
    // declined with no price: no hold either, so the first non-NeuroFlux purchase forfeits it for the node unpriced
    else if (!st.accepted && !st.forfeited && !st.want && !(verdict?.chain === true && verdict.accept === false)) add('fail', 'UNPRICED', 'gift', 'Stanek\'s Gift is declined without being priced (no chained route decision priced it): the first non-NeuroFlux purchase forfeits it for the node', st.why)
    for (const o of GATE_PROBES) {
      const gate = SP.giftOrderGate(st, o)
      if (!gate.allow) add(st.want ? 'note' : 'fail', 'BLOCKED', `act.js gate (${o.kind})`, `act.js would refuse a${o.kind === 'install' ? 'n install' : ` ${o.kind} '${o.args[1]}'`}`, gate.why)
    }
    const sk = read('/tel/stanek.txt')
    if (sk && sk.node === info.currentNode && sk.lastNodeReset === info.lastNodeReset && /hold|held|unpriced/i.test(`${sk.result ?? ''} ${sk.decision ?? ''}`) && !st.accepted) add('note', 'HELD', 'stanek.js', `stanek.js: ${short(sk.result)}`, sk.why ?? sk.detail)
  }

  // ---- the work slot and the Bladeburner claims
  if (progFresh) {
    const sl = prog.slot
    if (!sl) add('fail', 'UNPRICED', 'slot', 'progress.txt publishes no work slot', null)
    else {
      if (!sl.owner && /could not be priced|unpriced/i.test(sl.why ?? '')) add('fail', 'UNPRICED', 'slot', 'the work slot is unowned because an exit could not be priced', sl.why)
      if (sl.bladeStall?.stalled) add('fail', 'BLOCKED', 'slot', 'the Bladeburner claim cannot be exercised (bladeSlotStallOf)', sl.bladeStall.why)
    }
  }
  if (typeof read.ns === 'object' && read.ns) {
    const c = BS.slotClaim(read.ns, 'home', info, now)
    if (c.owner === null && !c.simulacrum && br?.key === 'blade') add('fail', 'BLOCKED', 'bladeburner slot', 'the route is blade but no actor holds the slot', c.why)
    if (BS.simulacrumOf(info) && !c.ours) add('fail', 'BLOCKED', 'bladeburner slot', 'The Blade\'s Simulacrum is installed but the Bladeburner actor would wait on the slot', c.why)
  }

  // ---- the install gate (budget.js's claimants read these; a null blocks every spender)
  const gate = read('/tel/installgate.txt')
  if (progFresh) {
    if (!life(gate)) add('fail', 'NOT RUN', 'install gate', 'no install gate record of this life', gate ? `installgate.txt is from life ${gate.lastAugReset}` : 'absent')
    else {
      for (const k of ['budgetClaim', 'joinClaim']) if (!fin(gate[k])) add('fail', 'BLOCKED', 'install gate', `installgate ${k} is ${JSON.stringify(gate[k])}: budget.js blocks every spender on it`, gate.why ?? gate.detail)
      if (gate.gangWorth === null && (D.gang || prog.gangFaction)) add('note', 'UNPRICED', 'install gate', 'the gang verdict is unpriced (gangWorth null)', gate.gangWhy ?? null)
    }
  }
  if (planFresh && D.install && (D.install.unpriced?.length || D.install.key === null)) add('fail', 'UNPRICED', 'install', 'the install decision is unpriced', D.install.why)

  // ---- every published hour: unpriced (non-finite) or absurd
  if (planFresh) {
    for (const { path, v } of hourFieldsOf(D, 'decisions')) {
      if (!Number.isFinite(v)) add('fail', 'ABSURD', path.split('.').slice(0, 2).join('.'), `${path} = ${v}`, null)
      else if (v > ABSURD_H) add('fail', 'ABSURD', path.split('.').slice(0, 2).join('.'), `${path} = ${v}h (> ${ABSURD_H}h)`, null)
    }
  }

  // ---- act.js: its last decision and the planner's orders it ran
  const act = read('/tel/act.txt')
  if (life(act)) {
    const why = `${act.decision?.why ?? ''} ${JSON.stringify(act.orders?.results ?? [])}`
    if (/STANEK GATE|PRICING HOLD/.test(why)) add('fail', 'BLOCKED', 'act.js', 'act.js refused an order at the Stanek gate', why)
  }

  // ---- the stack at the entry: a daemon boot.js could not seat is a component not running (a note: its
  // decisions are priced without it — e.g. no sleeve.js means the sleeves sit idle until home grows)
  const boot = read('/tel/boot.txt')
  if (boot && Date.parse(boot.at ?? '') >= info.lastNodeReset && Array.isArray(boot.failed)) for (const f of boot.failed) add('note', 'BLOCKED', 'boot', String(f).slice(0, 200), `home ${boot.homeRam}GB at the entry`)

  // ---- endgame's guards: at an entry the expected answer is 'waiting'
  const eg = read('/tel/endgame.txt')
  if (eg && eg.bitNode === info.currentNode && Date.parse(eg.at ?? '') >= info.lastNodeReset && ['blocked', 'held', 'stopped'].includes(eg.result)) add('fail', 'BLOCKED', 'endgame', `endgame.js reports '${eg.result}'`, eg.detail)
  const hold = read('/endgame-hold.txt', true)
  if (hold) add('fail', 'HELD', 'endgame', '/endgame-hold.txt survived the entry: the exit is held', hold)
  return F
}
