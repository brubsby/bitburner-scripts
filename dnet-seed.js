// THE DARKNET SEED (home): keeps a crawler (dnet.js) on darkweb — the one darknet server home is
// connected to, stationary, never restarted (NetworkGenerator.ts initDarkwebServer) — runs the CHARISMA
// FARM on home's free RAM when the labyrinth route needs it, and turns the crawlers' reports (DNET_PORT)
// into /tel/dnet.txt. A DAEMON: the port holds 50 entries (Netscript ports drop the oldest) and ~40
// crawlers report every 5s, so it is drained every second; the record is published every 10s.
//
// Gated by the watchdog on DarkscapeNavigator.exe on home (BitNode 15, where Prestige.ts gives it at
// every start, or SF15, or bought). Without it this publishes `access: false` and exits.
//
// THE FARM (chaplan.js; dnet-cha.js workers, one thread each, heartbleed on darkweb): on only where the
// stack acts on the labyrinth route (routepin NODE_ROUTE_RULES[15].labReady, BitNode 15) and charisma is
// below the current lab's requirement (+2%: at or below it every step pays the underleveled factor,
// effects.ts calculateAuthenticationTime). It takes home's FREE RAM above progress.js's block and the
// home stack (freshlife.homeReserveGb, the one copy of that formula [R6]) — never RAM another script
// holds — capped at FARM_MAX workers (each is a script the game loop schedules). It stops itself (kills
// its workers) the moment charisma reaches the lab, or the route rule is off. NOT PRICED: the money the
// batcher would have made on that RAM; the farm only runs where charisma is the lab route's gate.
//
// /tel/dnet.txt: the seed's state, the crawl (servers rooted by model, the deepest row any crawler stands
// on, the give-ups by model and cause), the air-gap rides, the labyrinth (walking, cleared, charisma
// short, threads), the farm (on, workers, charisma vs need, why) and the caches opened (a lab's reward
// names its augmentation). A crawl that stops growing is visible as `lastRootAt` ageing.
import { DNET_PORT, DNET_FILES, DNET_TEL, labOf } from 'dnetplan.js'
import { WORKER_GB, LAB_CHA_MARGIN } from 'chaplan.js'
import { NODE_ROUTE_RULES } from 'routepin.js'
import { singularityRamMultiplier } from 'sfgate.js'
import { homeReserveGb } from 'freshlife.js'

const DARKWEB = 'darkweb'
const FARM = 'dnet-cha.js'
const FARM_MAX = 400
const DRAIN_MS = 1000
const PUBLISH_EVERY = 10

export async function main(ns) {
  ns.disableLog('ALL')
  const st = { at: null, access: null, seedPid: 0, seedStarts: 0, rooted: {}, byModel: {}, gaveUp: {}, maxDepth: -1, alive: {}, lab: null, caches: [], events: [], lastRootAt: null, farm: null, farmSeq: 0 }
  let published = false
  ns.atExit(() => {
    if (!published) publish(ns, { ...st, at: new Date().toISOString(), health: 'stopped', why: 'dnet-seed.js exited (killed or threw)' })
  }, 'dnet-seed')
  for (let tick = 0; ; tick++) {
    st.access = ns.fileExists('DarkscapeNavigator.exe', 'home')
    if (!st.access) {
      published = true
      publish(ns, { ...st, at: new Date().toISOString(), health: 'ok', why: 'no DarkscapeNavigator.exe on home: no darknet access (BitNode 15, SF15, or the program bought)' })
      return
    }
    drain(ns, st)
    if (tick % PUBLISH_EVERY === 0) {
      if (!ns.isRunning(DNET_FILES[0], DARKWEB)) {
        ns.scp(DNET_FILES, DARKWEB, 'home')
        st.seedPid = ns.exec(DNET_FILES[0], DARKWEB, { threads: 1, preventDuplicates: true })
        st.seedStarts++
      }
      st.farm = farmStep(ns, st)
      const now = Date.now()
      const crawlers = Object.values(st.alive).filter((a) => now - a.at < 60000)
      const health = !ns.isRunning(DNET_FILES[0], DARKWEB) ? 'warn' : 'ok'
      publish(ns, {
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
        ride: st.ride ?? null,
        farm: st.farm,
        caches: st.caches.slice(-10),
        events: st.events.slice(-12),
      })
      published = true
    }
    await ns.sleep(DRAIN_MS)
  }
}

/** The charisma farm on home: grow to the free RAM while charisma is short of the lab, stop at it. */
export function farmStep(ns, st, rules = NODE_ROUTE_RULES) {
  const info = ns.getResetInfo()
  const workers = ns.ps('home').filter((p) => p.filename === FARM)
  const lab = labOf(new Set(info.ownedAugs?.keys?.() ?? []), info.currentNode)
  const cha = ns.getPlayer().skills.charisma
  const need = Math.ceil((lab.lab?.cha ?? 0) * LAB_CHA_MARGIN)
  const ruleOn = info.currentNode === 15 && rules[15]?.labReady === true
  const stop = (why) => {
    for (const p of workers) ns.kill(p.pid)
    return { on: false, workers: 0, stopped: workers.length, cha, need, lab: lab.index + 1, why }
  }
  if (!ruleOn) return stop(info.currentNode === 15 ? 'the labyrinth route is not the acted route (routepin labReady false)' : 'not BitNode 15')
  if (cha >= need) return stop(`charisma ${cha} >= ${need} (lab ${lab.index + 1}'s ${lab.lab.cha} +${Math.round((LAB_CHA_MARGIN - 1) * 100)}%)`)
  const reserve = homeReserveGb(singularityRamMultiplier(info))
  const free = ns.getServerMaxRam('home') - ns.getServerUsedRam('home') - reserve
  const add = Math.max(0, Math.min(FARM_MAX - workers.length, Math.floor(free / WORKER_GB)))
  let started = 0
  for (let i = 0; i < add; i++) if (ns.exec(FARM, 'home', 1, DARKWEB, `#${++st.farmSeq}`) > 0) started++
  return {
    on: true,
    workers: workers.length + started,
    started,
    cha,
    need,
    lab: lab.index + 1,
    freeGb: Math.round(free),
    reserveGb: reserve,
    why: started < add ? `${add - started} worker(s) did not start` : workers.length + started === 0 ? `no free home RAM above the ${reserve}GB reserve` : null,
  }
}

/** A report's stamp as ISO; a malformed one reads as such (never a throw that stops the drain). */
function iso(ms) {
  const d = new Date(Number(ms))
  return Number.isFinite(d.getTime()) ? d.toISOString() : `bad stamp ${String(ms).slice(0, 40)}`
}

function publish(ns, o) {
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
      st.lastRootAt = iso(e.at)
    } else if (e.t === 'unsolved' || e.t === 'gave-up' || e.t === 'cha-short') {
      const k = `${e.t}:${key(e.model)}`
      st.gaveUp[k] = (st.gaveUp[k] ?? 0) + 1
    } else if (e.t === 'lab') {
      st.lab = { host: e.host, state: e.state, need: e.need ?? null, steps: e.steps ?? null, threads: e.threads ?? null, sec: e.sec ?? null, why: e.why ?? null, from: e.from, at: iso(e.at) }
    } else if (e.t === 'ride') {
      const r = (st.ride ??= { moved: 0, past: 0, last: null })
      if (e.state === 'moved') {
        r.moved++
        if (Number.isFinite(e.to) && Number.isFinite(e.from) && Math.floor(e.to / 8) > Math.floor(e.from / 8)) r.past++
      }
      r.last = { state: e.state, host: e.host, from: e.from ?? null, to: e.to ?? null, threads: e.threads ?? null, why: e.why ?? null, at: iso(e.at) }
    } else if (e.t === 'cache' || e.t === 'cache-fail') {
      st.caches.push({ at: iso(e.at), from: e.from, file: e.file, aug: e.aug ?? null, msg: e.msg ?? e.why })
    }
    if (e.t !== 'alive') st.events.push({ at: iso(e.at), t: e.t, from: e.from, host: e.host ?? null, why: e.why ?? e.state ?? null })
    if (st.events.length > 50) st.events.splice(0, st.events.length - 50)
    if (st.caches.length > 50) st.caches.splice(0, st.caches.length - 50)
  }
}
