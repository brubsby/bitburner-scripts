// THE DARKNET SEED (home): keeps a crawler (dnet.js) on darkweb — the one darknet server home is
// connected to, stationary, never restarted (NetworkGenerator.ts initDarkwebServer) — and turns the
// crawlers' reports (DNET_PORT) into /tel/dnet.txt. A DAEMON: the port holds 50 entries
// (Netscript ports drop the oldest), so it must be drained continuously.
//
// Gated by the watchdog on DarkscapeNavigator.exe on home (BitNode 15, where Prestige.ts gives it at
// every start, or SF15, or bought). Without it this publishes `access: false` and exits.
//
// /tel/dnet.txt (every 10s): the seed's state, the crawl (servers rooted by model, the deepest row any
// crawler stands on, the give-ups by model and cause), the labyrinth (seen, cleared, charisma short) and
// the caches opened (a lab's reward names its augmentation). A crawl that stops growing is visible as
// `lastRootAt` ageing; a model the solvers do not cover is visible as `unsolved` counts.
import { DNET_PORT, DNET_FILES, DNET_TEL } from 'dnetplan.js'

const DARKWEB = 'darkweb'
const TICK_MS = 10000

export async function main(ns) {
  ns.disableLog('ALL')
  const st = { at: null, access: null, seedPid: 0, seedStarts: 0, rooted: {}, byModel: {}, gaveUp: {}, maxDepth: -1, alive: {}, lab: null, caches: [], events: [], lastRootAt: null }
  let published = false
  ns.atExit(() => {
    if (!published) write(ns, { ...st, at: new Date().toISOString(), health: 'stopped', why: 'dnet-seed.js exited (killed or threw)' })
  }, 'dnet-seed')
  for (;;) {
    st.access = ns.fileExists('DarkscapeNavigator.exe', 'home')
    if (!st.access) {
      published = true
      write(ns, { ...st, at: new Date().toISOString(), health: 'ok', why: 'no DarkscapeNavigator.exe on home: no darknet access (BitNode 15, SF15, or the program bought)' })
      return
    }
    if (!ns.isRunning(DNET_FILES[0], DARKWEB)) {
      ns.scp(DNET_FILES, DARKWEB, 'home')
      st.seedPid = ns.exec(DNET_FILES[0], DARKWEB, { threads: 1, preventDuplicates: true })
      st.seedStarts++
    }
    drain(ns, st)
    const now = Date.now()
    const crawlers = Object.values(st.alive).filter((a) => now - a.at < 60000)
    const health = !ns.isRunning(DNET_FILES[0], DARKWEB) ? 'warn' : 'ok'
    write(ns, {
      at: new Date().toISOString(),
      health,
      why: health === 'ok' ? null : `the crawler on ${DARKWEB} is not running (exec returned ${st.seedPid}: darkweb's 16GB too small, or the files did not copy)`,
      access: true,
      seed: { host: DARKWEB, pid: st.seedPid, starts: st.seedStarts },
      crawlers: crawlers.length,
      maxDepth: Math.max(-1, ...crawlers.map((a) => a.depth ?? -1)),
      everDepth: st.maxDepth,
      rooted: Object.keys(st.rooted).length,
      lastRootAt: st.lastRootAt,
      byModel: st.byModel,
      gaveUp: st.gaveUp,
      lab: st.lab,
      caches: st.caches.slice(-10),
      events: st.events.slice(-12),
    })
    published = true
    await ns.sleep(TICK_MS)
  }
}

function write(ns, o) {
  ns.write(DNET_TEL, JSON.stringify(o), 'w')
}

function drain(ns, st) {
  for (let i = 0; i < 500; i++) {
    const raw = ns.readPort(DNET_PORT)
    if (raw === 'NULL PORT DATA' || raw === null || raw === undefined) return
    let e
    try {
      e = JSON.parse(raw)
    } catch {
      continue
    }
    const key = (m) => String(m ?? '?')
    if (e.t === 'alive') {
      st.alive[e.from] = { at: e.at, depth: e.depth }
      if (Number.isFinite(e.depth)) st.maxDepth = Math.max(st.maxDepth, e.depth)
    } else if (e.t === 'root') {
      st.rooted[e.host] = { model: e.model, depth: e.depth, at: e.at }
      const b = (st.byModel[key(e.model)] ??= { rooted: 0, tries: 0 })
      b.rooted++
      b.tries += e.tries ?? 0
      st.lastRootAt = new Date(e.at).toISOString()
    } else if (e.t === 'unsolved' || e.t === 'gave-up' || e.t === 'cha-short') {
      const k = `${e.t}:${key(e.model)}`
      st.gaveUp[k] = (st.gaveUp[k] ?? 0) + 1
    } else if (e.t === 'lab') {
      st.lab = { host: e.host, state: e.state, need: e.need ?? null, steps: e.steps ?? null, at: new Date(e.at).toISOString() }
    } else if (e.t === 'cache' || e.t === 'cache-fail') {
      st.caches.push({ at: new Date(e.at).toISOString(), from: e.from, file: e.file, aug: e.aug ?? null, msg: e.msg ?? e.why })
    }
    if (e.t !== 'alive') st.events.push({ at: new Date(e.at).toISOString(), t: e.t, from: e.from, host: e.host ?? null, why: e.why ?? e.state ?? null })
    if (st.events.length > 50) st.events.splice(0, st.events.length - 50)
    if (st.caches.length > 50) st.caches.splice(0, st.caches.length - 50)
  }
}
