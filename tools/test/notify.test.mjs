// tools/notify.mjs — the session-free stall alert (backlog 22).
//
//   NT1  the class filter: every stall class the healthcheck emits passes (numbers, the comma in
//        "EXIT READY, NOT TAKEN"), non-stall classes do not, and a dead healthcheck is itself a stall
//   NT2  dedup + rate limit: one alert per class per RATE_H while it lasts, a "still" after RATE_H,
//        one "resolved" after an alerted episode, a flicker inside the window is not re-sent
//   NT3  GAME DISCONNECTED waits DISCONNECT_MIN before it alerts
//   NT4  a failed send is retried (nothing is recorded as sent until markSent)
//   NT5  a run without the healthcheck carries its last classes forward (no false "resolved")

import { Check } from './harness.mjs'
import { classOf, isStall, healthClasses, decide, markSent, observedOf, render, RATE_H, DISCONNECT_MIN } from '../notify.mjs'

const T0 = Date.parse('2026-10-24T12:00:00Z')
const min = (m) => T0 + m * 60e3
const o = (cls) => ({ cls, what: `${cls}: detail 12.3h`, detail: null })
// one run: decide, then pretend the send worked
const step = (state, observed, t) => { const m = decide(state, observed, t); markSent(state, m, t); return m.map((x) => `${x.kind}:${x.cls}`) }

export async function run() {
  const checks = []

  const c1 = new Check('NT1', 'class filter: stall classes pass, others do not, a dead healthcheck is a stall')
  checks.push(c1)
  const stalls = [
    'daemon control port unreachable',
    'PLAYER IDLE: no current work across two samples',
    'NO INSTALL: this life is 4.2h old, 3x the 1.4h window the plan assumes, and nothing is queued',
    'PLANNER IDLE: progress.js did nothing across 31 min, still waiting on: x',
    'EXIT READY, NOT TAKEN: all 21 black ops done and endgame.js is waiting for --next',
    'EXIT NOT APPROACHING: projected exit 9.1h -> 9.0h over 2.0h of wall time',
    'NO RANK PROGRESS: rank 4000 -> 4000 over 20 min with the slot on Bladeburner',
    'NEXT NODE ENTRY UNPRICED: BN5.2 dry-run failed',
  ]
  const others = ['PLAN BLOCKED THE PAGE: 812ms', 'the game is not connected to the daemon', 'EXIT UNPRICED: x', 'deploy verify failed to answer', 'INSTALL LOOP: y']
  for (const w of stalls) if (!isStall(classOf(w))) c1.fail(`stall class filtered out: ${w}`, classOf(w))
  for (const w of others) if (isStall(classOf(w))) c1.fail(`non-stall class let through: ${w}`)
  const hc = healthClasses({ problems: [...stalls, ...others].map((what) => ({ what, detail: null })) })
  if (hc.length !== stalls.length) c1.fail(`healthClasses kept ${hc.length}, expected ${stalls.length}`, hc.map((x) => x.cls).join(', '))
  for (const bad of [null, { __error: 'exit 1' }, { ok: true }]) {
    const d = healthClasses(bad)
    if (d.length !== 1 || d[0].cls !== 'HEALTHCHECK DID NOT ANSWER') c1.fail(`unparseable healthcheck ${JSON.stringify(bad)} did not read as HEALTHCHECK DID NOT ANSWER`)
  }
  if (healthClasses({ problems: [] }).length) c1.fail('a clean healthcheck produced a class')
  c1.examined(stalls.length + others.length + 4)

  const c2 = new Check('NT2', `dedup + rate limit: once per class per ${RATE_H}h, "still" after, one "resolved", flicker not re-sent`)
  checks.push(c2)
  {
    const s = {}
    const seq = [
      [0, ['PLAYER IDLE'], ['new:PLAYER IDLE']],
      [5, ['PLAYER IDLE'], []],
      [15, ['PLAYER IDLE', 'NO INSTALL'], ['new:NO INSTALL']],
      [RATE_H * 60 - 1, ['PLAYER IDLE', 'NO INSTALL'], []],
      [RATE_H * 60, ['PLAYER IDLE', 'NO INSTALL'], ['still:PLAYER IDLE']],
      [RATE_H * 60 + 5, ['NO INSTALL'], ['resolved:PLAYER IDLE']],
      [RATE_H * 60 + 10, ['NO INSTALL'], []],
      [RATE_H * 60 + 15, ['NO INSTALL', 'PLAYER IDLE'], ['still:NO INSTALL']], // PLAYER IDLE flickers back inside its window: no re-page
      [RATE_H * 60 + 20, ['NO INSTALL'], []], // ...and its clearing was never alerted: no resolved either
      [RATE_H * 60 + 25, [], ['resolved:NO INSTALL']],
      [RATE_H * 60 + 30, [], []],
      [2 * RATE_H * 60 + 1, ['PLAYER IDLE'], ['new:PLAYER IDLE']], // a new episode after the window pages again
    ]
    for (const [m, obs, want] of seq) {
      const got = step(s, obs.map(o), min(m))
      c2.examined(1)
      if (got.join('|') !== want.join('|')) c2.fail(`t+${m} min observed [${obs}] sent [${got}], expected [${want}]`)
    }
    const r = render([{ kind: 'new', cls: 'PLAYER IDLE', what: 'PLAYER IDLE: x', sinceMs: T0 }, { kind: 'resolved', cls: 'NO INSTALL' }], min(90))
    if (!/^Bitburner STALL: PLAYER IDLE/.test(r.title) || !/resolved: NO INSTALL/.test(r.body) || !r.urgent) c2.fail('render lost the alert or the resolved line', JSON.stringify(r))
  }

  const c3 = new Check('NT3', `GAME DISCONNECTED alerts only after ${DISCONNECT_MIN} min`)
  checks.push(c3)
  {
    const s = {}
    const seq = [[0, []], [5, []], [DISCONNECT_MIN, ['new:GAME DISCONNECTED']], [DISCONNECT_MIN + 5, []]]
    for (const [m, want] of seq) {
      const got = step(s, [o('GAME DISCONNECTED')], min(m))
      c3.examined(1)
      if (got.join('|') !== want.join('|')) c3.fail(`t+${m} min sent [${got}], expected [${want}]`)
    }
    const s2 = {}
    step(s2, [o('GAME DISCONNECTED')], min(0))
    if (step(s2, [], min(5)).length) c3.fail('a short disconnect that never alerted sent a "resolved"')
    if (step(s2, [o('GAME DISCONNECTED')], min(6)).length) c3.fail('a fresh disconnect alerted before its own 10 min')
  }

  const c4 = new Check('NT4', 'a failed send is retried on the next run')
  checks.push(c4)
  {
    const s = {}
    const a = decide(s, [o('PLAYER IDLE')], min(0)) // send failed: no markSent
    const b = decide(s, [o('PLAYER IDLE')], min(5))
    if (a.length !== 1 || b.length !== 1 || b[0].kind !== 'new') c4.fail(`unsent alert not retried: ${JSON.stringify([a, b])}`)
    markSent(s, b, min(5))
    const r1 = decide(s, [], min(10)) // resolved send fails
    const r2 = decide(s, [], min(15))
    if (r1.length !== 1 || r2.length !== 1 || r2[0].kind !== 'resolved') c4.fail(`unsent resolved not retried: ${JSON.stringify([r1, r2])}`)
    c4.examined(4)
  }

  const c5 = new Check('NT5', 'a cheap-only run carries the last healthcheck classes forward')
  checks.push(c5)
  {
    const s = { lastHealth: { at: min(0), classes: [o('NO INSTALL')] } }
    const obs = observedOf({ cheap: [o('DAEMON SERVICE DOWN')], health: null, state: s }).map((x) => x.cls).sort()
    if (obs.join() !== 'DAEMON SERVICE DOWN,NO INSTALL') c5.fail(`carried forward [${obs}]`)
    const fresh = observedOf({ cheap: [], health: [], state: s })
    if (fresh.length) c5.fail('a fresh clean healthcheck did not replace the carried classes')
    c5.examined(2)
  }
  return checks
}
