// bladeburner.js END TO END, offline: the daemon's own main() against the
// GAME's ns.bladeburner implementation (NetscriptFunctions/Bladeburner.ts,
// bundled by tools/sim/nodechoice) on the game's Bladeburner/Player classes,
// with a clock that runs Bladeburner.process()'s tick between the daemon's
// sleeps. Nothing here can run live until BN6, so this is where the daemon's
// calls meet the real API: argument types and enums, milliseconds, null
// current actions, the join rules, skill upgrades, team sizes.
//
//   BD1  joins the division at combat 100 (not below), and the faction at rank 25
//   BD2  without progress.js's slot claim it runs NOTHING and says so; with it, it acts
//   BD3  acting for game hours: rank rises, skills are bought, black ops fall, health never 'error',
//        the formula's action time equals the game's, observed success near the chance it expected
//   BD4  a division one black op from the end reaches exitReady, publishes it, and calls no destroy
//
// NOT a model of BN6's opening (the player is given stats); it checks the
// daemon's mechanics, the exit time is tools/sim/bb6.mjs's job.

import './gameresolve.mjs'
import { Check } from './harness.mjs'

class Stop extends Error {}

export async function run() {
  const checks = []
  const load = new Check('BD0', 'the game bundle with NetscriptBladeburner loads (the daemon runs against the real API, or not at all — which is NOT a pass)')
  checks.push(load)
  let g, setBitNode, bbjs, bp
  try {
    const m = await import('../sim/nodechoice/game.mjs')
    g = m.default
    setBitNode = m.setBitNode
    bbjs = await import('bladeburner.js')
    bp = await import('bbplan.js')
    if (typeof g.NetscriptBladeburner !== 'function') throw new Error('NetscriptBladeburner not exported by the bundle (tools/sim/nodechoice/build.mjs ENTRY)')
    load.examined(1)
  } catch (e) {
    load.fail('could not load the bundle / bladeburner.js', String(e?.stack ?? e).slice(0, 500))
    return checks
  }

  /** One world: a BN6 player, the game's API, a fake ns whose sleep advances the game. */
  function world({ combat = 120, mult = 1, owner = 'bladeburner', joined = false, setup = null, seed = 1 } = {}) {
    setBitNode(6, 1)
    g.initSourceFiles()
    const P = new g.PlayerObject()
    g.setPlayer(P)
    P.bitNodeN = 6
    P.sourceFiles = new Map([[1, 3]])
    P.resetMultipliers()
    P.reapplyAllSourceFiles()
    for (const s of ['strength', 'defense', 'dexterity', 'agility']) P.mults[s] *= mult
    for (const s of ['strength', 'defense', 'dexterity', 'agility']) P.exp[s] = g.calculateExp(combat, P.mults[s])
    P.exp.hacking = g.calculateExp(300, P.mults.hacking)
    P.exp.charisma = g.calculateExp(100, P.mults.charisma)
    P.updateSkillLevels()
    g.Factions['Bladeburners'].prestigeSourceFile()
    if (joined) P.startBladeburner()
    if (setup) setup(P)
    // The clock: game seconds, and Date.now() follows it (the daemon's freshness and cadence read it).
    let t = 0
    const T0 = Date.parse('2026-10-02T00:00:00Z')
    const files = new Map()
    const writeProgress = () => files.set('/tel/progress.txt', JSON.stringify({ at: new Date(T0 + t * 1000).toISOString(), slot: { owner } }))
    writeProgress()
    let a = seed >>> 0
    const rand = () => {
      a = (a + 0x6d2b79f5) >>> 0
      let x = a
      x = Math.imul(x ^ (x >>> 15), x | 1)
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296
    }
    const internal = g.NetscriptBladeburner()
    const logs = []
    const ws = { log: (fn, msg) => logs.push(`${fn}: ${msg()}`), scriptRef: { dependencies: new Map(), filename: 'bladeburner.js' }, name: 'bladeburner.js', hostname: 'home', pid: 1 }
    const calls = new Map()
    const bladeburner = new Proxy({}, {
      get(_, name) {
        if (!(name in internal)) throw new Error(`ns.bladeburner.${String(name)} does not exist in the game's API`)
        return (...args) => {
          calls.set(name, (calls.get(name) ?? 0) + 1)
          // APIWrapper.ts:84: field(ctx, ...args) — the context first, not curried.
          return internal[name]({ workerScript: ws, function: name, functionPath: `bladeburner.${String(name)}` }, ...args)
        }
      },
    })
    const C = g.BladeburnerConstants
    const tick = () => {
      const bb = P.bladeburner
      if (!bb) return
      if (bb.stamina <= 0) bb.resetAction()
      bb.calculateMaxStamina()
      bb.stamina = Math.min(bb.maxStamina, bb.stamina + bb.calculateStaminaGainPerSecond())
      for (const c of Object.values(bb.contracts)) c.count += c.growthFunction() / C.ActionCountGrowthPeriod
      for (const o of Object.values(bb.operations)) o.count += o.growthFunction() / C.ActionCountGrowthPeriod
      for (const city of Object.values(bb.cities)) city.chaos = Math.max(0, city.chaos - 0.0001)
      bb.randomEventCounter -= 1
      if (bb.randomEventCounter <= 0) {
        bb.randomEvent()
        bb.randomEventCounter += 240 + Math.floor(Math.random() * 361)
      }
      bb.processAction(1)
    }
    let maxT = Infinity
    const ns = {
      ramOverride: (x) => x,
      getResetInfo: () => ({ currentNode: 6, lastAugReset: T0 - 3600e3, ownedSF: new Map([[1, 3]]), ownedAugs: new Map(), bitNodeOptions: {} }),
      getHostname: () => 'home',
      scp: () => true,
      read: (f) => files.get(f) ?? '',
      write: (f, d, mode) => files.set(f, mode === 'a' ? (files.get(f) ?? '') + d : String(d)),
      atExit: () => {},
      print: () => {},
      tprint: () => {},
      getScriptName: () => 'bladeburner.js',
      flags: (spec) => Object.fromEntries(spec.map(([k, v]) => [k, v])),
      getPlayer: () => ({ skills: { ...P.skills }, mults: { ...P.mults }, exp: { ...P.exp } }),
      sleep: async (ms) => {
        const steps = Math.max(1, Math.round(ms / 1000))
        for (let i = 0; i < steps; i++) {
          tick()
          t += 1
        }
        writeProgress()
        if (t >= maxT) throw new Stop('__test_stop__')
      },
      bladeburner,
    }
    // The last record the daemon published on its own: the test's stop (a throw
    // out of ns.sleep) makes main() publish one more, 'error', naming it.
    let lastReal = null
    const status = () => lastReal
    const history = []
    const origWrite = ns.write
    ns.write = (f, d, m) => {
      origWrite(f, d, m)
      if (f === '/tel/bladeburner.txt') {
        try {
          const x = JSON.parse(d)
          if (String(x.detail ?? '').includes('__test_stop__') || (x.errors ?? []).some((e) => String(e).includes('__test_stop__'))) return
          lastReal = x
          history.push({ t, health: x.health, result: x.result, rank: x.rank, bo: x.blackOps?.done, running: x.running?.name ?? null })
          if (history.length > 2000) history.shift()
        } catch {
          /* */
        }
      }
    }
    return {
      P, ns, status, history, calls, logs,
      async runFor(hours) {
        maxT = t + hours * 3600
        const savedNow = Date.now
        const savedRand = Math.random
        Date.now = () => T0 + t * 1000
        Math.random = rand
        try {
          await bbjs.main(ns)
          return 'returned'
        } catch (e) {
          if (e instanceof Stop) return 'stopped'
          throw e
        } finally {
          Date.now = savedNow
          Math.random = savedRand
        }
      },
      setOwner(o) {
        owner = o
        writeProgress()
      },
    }
  }

  // ---- BD1 ----
  {
    const c = new Check('BD1', 'joins the division at combat 100 (not below), and the Bladeburners faction at rank 25')
    checks.push(c)
    const low = world({ combat: 60 })
    await low.runFor(0.05)
    c.examined(2)
    if (low.P.bladeburner) c.fail('joined the division with combat 60')
    if (low.status()?.result !== 'not-joined') c.fail(`below combat 100 the record should say not-joined, got ${low.status()?.result}`)
    const ok = world({ combat: 120 })
    const r = await ok.runFor(2)
    c.examined(2)
    if (!ok.P.bladeburner) c.fail('did not join with every combat stat >= 100', JSON.stringify(ok.status()).slice(0, 300))
    const rank = ok.P.bladeburner?.rank ?? 0
    c.note(`after 2 game hours: ${r}, rank ${rank.toFixed(1)}, faction member ${g.Factions['Bladeburners'].isMember}`)
    if (rank >= 25 && !g.Factions['Bladeburners'].isMember) c.fail(`rank ${rank.toFixed(1)} >= 25 and not in the Bladeburners faction`)
  }

  // ---- BD2 ----
  {
    const c = new Check('BD2', "without progress.js's claim nothing runs and the record says why; with it, it acts")
    checks.push(c)
    const w = world({ combat: 150, joined: true, owner: 'faction' })
    await w.runFor(0.3)
    const s = w.status()
    c.examined(2)
    if (w.P.bladeburner.action) c.fail(`slot owner 'faction', yet the game runs ${w.P.bladeburner.action.name}`)
    if (s?.result !== 'slot-not-ours') c.fail(`expected result slot-not-ours, got ${s?.result}`, JSON.stringify(s).slice(0, 200))
    w.setOwner('bladeburner')
    await w.runFor(0.3)
    c.examined(1)
    if (!w.history.some((h) => h.running)) c.fail('with the claim, no Bladeburner action ever ran', JSON.stringify(w.status()).slice(0, 300))
  }

  // ---- BD3 ----
  {
    const c = new Check('BD3', 'acting for game hours: rank rises, skills bought, black ops fall, never health error, formula time = game time, success near expectation')
    checks.push(c)
    const w = world({ combat: 250, mult: 1.5, joined: true, owner: 'bladeburner', seed: 7 })
    const r = await w.runFor(30)
    const s = w.status()
    const bb = w.P.bladeburner
    const skillsBought = Object.values(bb.skills).reduce((a, b) => a + b, 0)
    c.examined(6)
    c.note(`30 game hours: ${r}; rank ${bb.rank.toFixed(0)}, ${bb.numBlackOpsComplete}/21 black ops, ${skillsBought} skill levels, last action ${s?.action?.name} (${s?.action?.why}); outcomes ${JSON.stringify({ n: s?.outcomes?.n, observed: s?.outcomes?.observed, expected: s?.outcomes?.expected })}; api calls ${[...w.calls.values()].reduce((a, b) => a + b, 0)}`)
    if (!(bb.rank > 1000)) c.fail(`rank only ${bb.rank} after 30 game hours`)
    if (!(skillsBought > 0)) c.fail('no skill bought')
    if (!(bb.numBlackOpsComplete >= 1)) c.fail('no black op completed in 30 game hours')
    const errs = w.history.filter((h) => h.health === 'error')
    if (errs.length) c.fail(`${errs.length} records reported health error`, JSON.stringify(errs.slice(0, 3)) + ' ' + w.logs.slice(-5).join(' | '))
    const cal = s?.calibration
    if (cal && typeof cal.timeGameS === 'number' && cal.timeFormulaS !== cal.timeGameS) c.fail(`formula action time ${cal.timeFormulaS}s vs the game's ${cal.timeGameS}s`)
    if (s?.outcomes?.n >= 10 && s.outcomes.observed < 0.5 * s.outcomes.expected) c.fail(`observed success ${s.outcomes.observed} vs expected ${s.outcomes.expected}`)
  }

  // ---- BD4 ----
  {
    const c = new Check('BD4', 'one black op from the end: reaches exitReady, publishes it, and never calls a destroy')
    checks.push(c)
    const w = world({
      combat: 400, mult: 3, joined: true, owner: 'bladeburner', seed: 3,
      setup: (P) => {
        const bb = P.bladeburner
        bb.rank = 401000
        bb.maxRank = 401000
        bb.numBlackOpsComplete = 20
        for (const [k, v] of Object.entries({ "Blade's Intuition": 300, 'Digital Observer': 250, Reaper: 200, 'Evasive System': 200, Overclock: 90, "Cyber's Edge": 100 })) bb.setSkillLevel(k, v)
      },
    })
    await w.runFor(3)
    const s = w.status()
    c.examined(3)
    c.note(`black ops ${w.P.bladeburner.numBlackOpsComplete}/21, exitReady ${s?.exitReady}, result ${s?.result}`)
    if (w.P.bladeburner.numBlackOpsComplete < 21) c.fail(`Operation Daedalus not completed in 3 game hours from rank 401k (${s?.blackOps?.chance})`)
    if (!(s?.exitReady === true && s?.result === 'exit-ready')) c.fail(`after Daedalus the record should be exit-ready, got ${s?.result}`)
    if ([...w.calls.keys()].some((k) => /destroy/i.test(String(k)))) c.fail('the daemon called a destroy')
  }
  return checks
}
