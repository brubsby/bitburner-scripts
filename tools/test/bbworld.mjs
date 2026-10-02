// The bb-lite harness: the game's own Player, Bladeburner and ns.bladeburner
// (tools/sim/nodechoice bundle), a fake ns whose sleep advances the game one
// second per tick, ports, an exec that runs bb-lite's actors in-process, and
// the game clock for Date.now() and a bare new Date(). Used by
// tools/test/bblite.test.mjs and tools/sim/bblite-savings.mjs.
class Stop extends Error {}
export { Stop }

export function makeWorld({ g, setBitNode, actors, coord }, { combat = 120, mult = 1, owner = 'bladeburner', ownerFile = 'progress', joined = false, seed = 1, setup = null, node = 4 } = {}) {
  setBitNode(node, 1)
  g.initSourceFiles()
  const P = new g.PlayerObject()
  g.setPlayer(P)
  P.bitNodeN = node
  P.sourceFiles = new Map([[1, 3], [6, 1]])
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
  let t = 0
  const T0 = Date.parse('2026-10-02T00:00:00Z')
  const LAR = T0 - 3600e3
  const files = new Map()
  const stamp = () => new Date(T0 + t * 1000).toISOString()
  let own = owner
  const writeClaim = () => {
    files.delete('/tel/progress.txt')
    files.delete('/tel/act.txt')
    if (ownerFile === 'progress') files.set('/tel/progress.txt', JSON.stringify({ at: stamp(), slot: { owner: own } }))
    else if (ownerFile === 'act') files.set('/tel/act.txt', JSON.stringify({ at: stamp(), lastAugReset: LAR, slot: own ? { owner: own, at: stamp(), lastAugReset: LAR, why: 'test bootstrap' } : null }))
  }
  writeClaim()
  let a = seed >>> 0
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = a
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
  const internal = g.NetscriptBladeburner()
  const calls = new Map()
  const callLog = []
  const bbFor = (who) =>
    new Proxy({}, {
      get(_, name) {
        if (!(name in internal)) throw new Error(`ns.bladeburner.${String(name)} does not exist in the game's API`)
        return (...args) => {
          const k = `${who}:${String(name)}`
          calls.set(k, (calls.get(k) ?? 0) + 1)
          if (name === 'startAction' || name === 'stopBladeburnerAction' || name === 'upgradeSkill') callLog.push({ t, who, name, args })
          const ws = { log: () => {}, scriptRef: { dependencies: new Map(), filename: who }, name: who, hostname: 'home', pid: 1 }
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
  const ports = new Map()
  const portOf = (n) => (ports.has(n) ? ports.get(n) : (ports.set(n, []), ports.get(n)))
  const running = new Set()
  let nextPid = 100
  const sleep = async (ms) => {
    const steps = Math.max(1, Math.round(ms / 1000))
    for (let i = 0; i < steps; i++) {
      tick()
      t += 1
    }
    writeClaim()
    if (t >= maxT) throw new Stop('__test_stop__')
  }
  const execLog = []
  const baseNs = (who, args = []) => ({
    args,
    ramOverride: (x) => x,
    disableLog: () => {},
    getResetInfo: () => ({ currentNode: node, lastAugReset: LAR, ownedSF: new Map([[1, 3], [6, 1]]), ownedAugs: new Map(), bitNodeOptions: {} }),
    getHostname: () => 'home',
    scp: () => true,
    read: (f) => files.get(f) ?? '',
    // The test's stop is a throw out of ns.sleep; the record a script writes about it is not the game's.
    write: (f, d, mode) => (String(d).includes('__test_stop__') ? undefined : files.set(f, mode === 'a' ? (files.get(f) ?? '') + d : String(d))),
    atExit: () => {},
    print: () => {},
    tprint: () => {},
    flags: (spec) => Object.fromEntries(spec.map(([k, v]) => [k, v])),
    getPlayer: () => ({ skills: { ...P.skills }, mults: { ...P.mults }, exp: { ...P.exp }, factions: [...P.factions] }),
    writePort: (n, d) => portOf(n).push(d),
    readPort: (n) => (portOf(n).length ? portOf(n).shift() : 'NULL PORT DATA'),
    clearPort: (n) => (portOf(n).length = 0),
    sleep,
    bladeburner: bbFor(who),
  })
  const ns = {
    ...baseNs('bb-lite.js'),
    scan: (h) => (h === 'home' ? [] : ['home']),
    hasRootAccess: () => true,
    getServerMaxRam: () => 64,
    getServerUsedRam: () => 20,
    getScriptRam: (s) => (s in actors ? 14 : 0),
    isRunning: (pid) => running.has(pid),
    exec: (script, host, threads, ...args) => {
      const mod = actors[script]
      if (!mod) return 0
      const pid = nextPid++
      running.add(pid)
      execLog.push({ t, script })
      Promise.resolve(mod.main(baseNs(script, args))).finally(() => running.delete(pid))
      return pid
    },
  }
  return {
    P, ns, files, calls, callLog, execLog, baseNs, LAR, stamp,
    get t() {
      return t
    },
    setOwner(o, f = ownerFile) {
      own = o
      ownerFile = f
      writeClaim()
    },
    async runFor(hours, main = coord.main, theNs = ns) {
      maxT = t + hours * 3600
      const RealDate = globalThis.Date
      const savedRand = Math.random
      // The game clock for EVERY reading of the time: Date.now() and a bare
      // new Date() (status.js stamps records with the latter) — freshness
      // checks on real time would pass vacuously.
      const clock = () => T0 + t * 1000
      globalThis.Date = class extends RealDate {
        constructor(...a) {
          if (a.length) super(...a)
          else super(clock())
        }
        static now() {
          return clock()
        }
      }
      Math.random = rand
      try {
        await main(theNs)
        return 'returned'
      } catch (e) {
        if (e instanceof Stop) return 'stopped'
        throw e
      } finally {
        globalThis.Date = RealDate
        Math.random = savedRand
      }
    },
    tel: (f) => {
      try {
        return JSON.parse(files.get(f) ?? 'null')
      } catch {
        return null
      }
    },
  }
}

