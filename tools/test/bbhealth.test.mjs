// tools/bbhealth.mjs — every Bladeburner outcome check fires on its failure
// and stays quiet on a healthy record (CLAUDE.md "A check you have not seen
// fail is not evidence").
//
//   BH1  a healthy acting record: no failure
//   BH2  each failure fires on exactly its fixture: SILENT (missing, stale), ORDER NOT HELD (other work, nothing running),
//        NO RANK PROGRESS, STAMINA STUCK, ACTION FAILING, MODEL OFF, EXIT READY NOT TAKEN (and a hold is only a note)
//   BH3  the wiring: healthcheck.mjs calls bladeburnerHealth with the previous snapshot and saves this one

import { Check } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bladeburnerHealth } from '../bbhealth.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const T0 = Date.parse('2026-10-02T12:00:00Z')
const iso = (minAgo) => new Date(T0 - minAgo * 60e3).toISOString()

function healthy() {
  return {
    at: iso(1), health: 'ok', bitNode: 6, result: 'acting', joined: true, rank: 5000, rankPerHour: 900, resting: false,
    stamina: 150, maxStamina: 200, slot: { owner: 'bladeburner', ours: true }, running: { type: 'Operations', name: 'Raid' },
    action: { name: 'Raid', why: 'Raid L10' }, blackOps: { done: 1, next: 'Operation Zero', reqdRank: 5000, chance: [0.6, 0.7] },
    outcomes: { n: 20, observed: 0.8, expected: 0.85, last: [] }, calibration: { timeFormulaS: 42, timeGameS: 42, maxStaminaFormula: 200, maxStaminaGame: 200 },
    samples: Array.from({ length: 30 }, (_, i) => ({ at: iso(30 - i), rank: 4000 + i * 30, stamina: 150 })), exitReady: false,
  }
}
const pr = { at: iso(2), slot: { owner: 'bladeburner' } }
const state = { bitNode: 6, currentWork: null, home: { ram: 256 }, playtimeSinceLastAug: 5 * 3600e3 }
const prevOwned = { at: iso(20), bitNode: 6, rank: 4000, owned: true }

export async function run() {
  const checks = []
  const run1 = (o) => bladeburnerHealth({ bb: healthy(), pr, state, prev: prevOwned, nowMs: T0, ...o })

  const c1 = new Check('BH1', 'a healthy acting Bladeburner record raises no failure')
  checks.push(c1)
  const ok = run1({})
  c1.examined(1)
  if (ok.fails.length) c1.fail('healthy record failed', JSON.stringify(ok.fails))
  if (!ok.snap.owned || !ok.snap.acting) c1.fail(`snapshot should be owned and acting: ${JSON.stringify(ok.snap)}`)
  c1.note(ok.notes.join(' | ').slice(0, 300))

  const c2 = new Check('BH2', 'each Bladeburner failure fires on its own fixture, with the right name')
  checks.push(c2)
  const cases = [
    ['BLADEBURNER SILENT', { bb: null }],
    ['BLADEBURNER SILENT', { bb: { ...healthy(), at: iso(45) } }],
    ['ORDER NOT HELD', { state: { ...state, currentWork: { type: 'FactionWork' } } }],
    ['ORDER NOT HELD', { bb: { ...healthy(), running: null } }],
    ['NO RANK PROGRESS', { bb: { ...healthy(), rank: 4000 } }],
    ['STAMINA STUCK', { bb: { ...healthy(), resting: true, stamina: 20, samples: Array.from({ length: 30 }, (_, i) => ({ at: iso(30 - i), rank: 4000, stamina: 20 })) } }],
    ['ACTION FAILING', { bb: { ...healthy(), outcomes: { n: 15, observed: 0.2, expected: 0.8, last: [] } } }],
    ['MODEL OFF', { bb: { ...healthy(), calibration: { timeFormulaS: 42, timeGameS: 60 } } }],
    ['EXIT READY, NOT TAKEN', { bb: { ...healthy(), exitReady: true }, eg: { at: iso(1), result: 'ready', detail: 'no --next' } }],
    ['EXIT READY, NOT TAKEN', { bb: { ...healthy(), exitReady: true }, eg: null }],
    // Live 2026-10-02 10:33Z /tel/sleeve.txt: every fleet null (sleeve.js's gym rate was null).
    ['BLADE FLEET UNPRICED', { sl: { bitNode: 6, blade: { on: false, route: 'blade', joined: true, config: null, byConfig: [{ config: { infiltrate: 0, support: 0, fa: 0 }, hours: null }, { config: { infiltrate: 5, support: 0, fa: 0 }, hours: null }], why: 'no configuration reaches the 21st black op within 200h in the model' } } }],
  ]
  for (const [name, o] of cases) {
    const r = run1(o)
    c2.examined(1)
    const hit = r.fails.filter((f) => f.what.startsWith(name))
    if (!hit.length) c2.fail(`${name} did not fire on its fixture`, JSON.stringify(r.fails).slice(0, 300))
    const others = r.fails.filter((f) => !f.what.startsWith(name))
    if (others.length) c2.fail(`${name}'s fixture also raised: ${others.map((f) => f.what.slice(0, 60)).join('; ')}`)
  }
  // A hold is deliberate: a note, not a failure.
  const held = run1({ bb: { ...healthy(), exitReady: true }, eg: { at: iso(1), result: 'held', detail: 'user choosing' } })
  c2.examined(1)
  if (held.fails.length) c2.fail('a held exit failed', JSON.stringify(held.fails))
  if (!held.notes.some((n) => n.includes('EXIT READY'))) c2.fail('a held exit left no note')
  // A fleet priced (one configuration finishes): no failure, whether or not it commits.
  const priced = run1({ sl: { bitNode: 6, blade: { on: true, route: 'blade', joined: true, config: { infiltrate: 5, support: 0, fa: 0 }, byConfig: [{ infiltrate: 5, support: 0, fa: 0, hours: 3.4 }] } } })
  c2.examined(1)
  if (priced.fails.length) c2.fail('a priced fleet failed', JSON.stringify(priced.fails))
  // Outside a Bladeburner node with no record: silence.
  const bn9 = bladeburnerHealth({ bb: null, pr, state: { ...state, bitNode: 9 }, nowMs: T0 })
  c2.examined(1)
  if (bn9.fails.length) c2.fail('BitNode 9 with no record failed', JSON.stringify(bn9.fails))
  // Below the 128GB tier in BN6: a note.
  const small = bladeburnerHealth({ bb: null, pr, state: { ...state, home: { ram: 64 } }, nowMs: T0 })
  c2.examined(1)
  if (small.fails.length) c2.fail('BN6 below the 128GB tier failed', JSON.stringify(small.fails))

  const c3 = new Check('BH3', 'healthcheck.mjs runs bladeburnerHealth with the previous snapshot and saves this run\'s')
  checks.push(c3)
  const src = fs.readFileSync(path.join(HERE, '..', 'healthcheck.mjs'), 'utf8')
  c3.examined(3)
  if (!/bladeburnerHealth\(\{[^}]*prev:\s*prev\?\.bladeburner/.test(src)) c3.fail('healthcheck.mjs does not pass prev?.bladeburner to bladeburnerHealth')
  if (!/now\.bladeburner\s*=\s*r\.snap/.test(src)) c3.fail('healthcheck.mjs does not save the snapshot as now.bladeburner')
  if (!/for \(const f of r\.fails\) fail\(f\.what, f\.detail\)/.test(src)) c3.fail("healthcheck.mjs does not raise bladeburnerHealth's failures")
  return checks
}
