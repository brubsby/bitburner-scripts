// THE DARKNET CRAWLER (BitNode 15 / SF15). Runs ON a darknet server (darkweb first, placed by
// dnet-seed.js from home), never on home: it roots its neighbours, copies itself onto each, and
// so spreads one hop at a time — the only way through a network where most calls need a DIRECT
// connection (offlineServerHandling.ts checkDarknetServer requireDirectConnection).
//
//   run dnet.js              crawl: probe, solve, authenticate, spread, open local caches, report; loop
//   run dnet.js --cache      open this server's .cache files, report, exit (the lab's reward)
//
// Per neighbour, each pass: the details (getServerDetails); a session from a password it knows
// (DNET_REG, carried to every child; leaked in logs or .data.txt clues) or one solved here
// (dnetplan.solverOf: the guess, authenticate, the feedback from heartbleed's logs); then
// scp + exec of itself onto it (preventDuplicates), freeing the owner's RAM first when it does not fit
// (memoryReallocation).
//
// THE AIR GAPS (rows 8/16/24 hold no server; connections join adjacent rows only): a crawler on the row
// above a gap starts dnet-ride.js on its own host against the rooted, crawler-carrying neighbour most likely
// to land past the gap when induced to migrate (dnetplan.riderTargetOf; a moved server keeps its scripts,
// so that neighbour's crawler carries on from the far side). Random mutations ride servers across too.
// THE LABYRINTH: a neighbour whose model is the labyrinth (the crawler is on its row, depth - 1) gets this
// host's block freed (memoryReallocation), the host pinned if a stasis link is free (dnet-stasis.js: a move
// or restart would end the walk), then dnet-lab.js with every thread left (the walk is one script — the
// position is per pid). At its end the lab is rooted and holds the reward cache; this crawler opens it with
// a copy of itself run there with --cache (cacheFiles.ts getLabReward QUEUES the lab's augmentation — The
// Red Pill at BN15's 5th lab; it counts only once INSTALLED: installgate's lab install, dnetplan.labInstallOf).
//
// FAILURE IS LOUD: every give-up names the model and why on DNET_PORT (dnet-seed.js aggregates the
// reports into /tel/dnet.txt): `unsolved` (no solver), `gave-up` (the solver ran out; retried with a new
// seed), `cha-short` (heartbleed/lab need more charisma), `no-room` (a child or the walker did not fit),
// `ride` no-carrier, `threw`. A crawler, walker or rider that dies says so (atExit).
//
// RAM: every ns.dnet call this file makes is paid by every copy (one thread each); measured by
// tools/test/dnet.test.mjs [DN7] with the game's own calculator. Nothing here runs on home.
import { DNET_PORT, DNET_FILES, DNET_REG, LAB_MODEL, LAB_WALKER, RIDER, STASIS, solverOf, feedbackOf, leakedOf, cluesOf, gapBelowOf, riderTargetOf } from 'dnetplan.js'

const ATTEMPTS_PER_PASS = 24
const PASS_SLEEP_MS = 5000

export async function main(ns) {
  ns.disableLog('ALL')
  const me = ns.getHostname()
  const say = (o) => ns.writePort(DNET_PORT, JSON.stringify({ at: Date.now(), from: me, ...o }))
  let said = false
  ns.atExit(() => {
    if (!said) say({ t: 'exit', why: 'killed or threw (restart, offline, or an error)' })
  }, 'dnet')
  const flags = ns.flags([['cache', false]])
  try {
    openCaches(ns, me, say)
    if (flags.cache) {
      said = true
      say({ t: 'exit', why: '--cache done' })
      return
    }
    await crawl(ns, me, say)
  } catch (e) {
    said = true
    say({ t: 'threw', why: String(e?.stack ?? e).slice(0, 300) })
    throw e
  }
}

function loadReg(ns) {
  try {
    return JSON.parse(ns.read(DNET_REG) || '{}') ?? {}
  } catch {
    return {}
  }
}

function openCaches(ns, me, say) {
  for (const f of ns.ls(me, '.cache')) {
    try {
      const r = ns.dnet.openCache(f, true)
      say({ t: 'cache', file: f, msg: String(r?.message ?? '').slice(0, 160), aug: r?.augmentationName ?? null })
    } catch (e) {
      say({ t: 'cache-fail', file: f, why: String(e).slice(0, 160) })
    }
  }
}

async function crawl(ns, me, say) {
  const dn = ns.dnet
  const reg = loadReg(ns)
  // clue files on this server name other servers' passwords (effects.ts addClue)
  for (const f of ns.ls(me, '.data.txt')) for (const c of cluesOf(ns.read(f))) reg[c.host] = c.pw
  const hist = new Map() // host -> [{guess, fb}] across passes
  const done = new Map() // host -> why it is not attempted again this life of the script
  const labState = { seen: null, stack: null }
  let depth = -2
  for (let pass = 0; ; pass++) {
    const self = dn.getServerDetails(me)
    depth = self?.depth ?? depth
    const near = dn.probe()
    let rooted = 0
    const carriers = [] // rooted neighbours with a crawler on them: the air-gap rider's candidates
    for (const h of near) {
      const d = dn.getServerDetails(h)
      if (!d?.isOnline || !d.isConnectedToCurrentServer) continue
      if (d.modelId !== LAB_MODEL && !d.isStationary && (d.hasSession || reg[h] !== undefined) && ns.isRunning(DNET_FILES[0], h)) carriers.push({ host: h, diff: d.difficulty, depth: d.depth })
      if (d.modelId === LAB_MODEL) {
        await walkLab(ns, h, d, labState, say)
        continue
      }
      if (done.has(h) && pass % 12 !== 0) continue // retried every ~minute, in case the cause moved (charisma)
      let session = d.hasSession
      if (!session && reg[h] !== undefined) {
        const c = dn.connectToSession(h, reg[h])
        session = !!c?.success
        if (!session) {
          const a = await dn.authenticate(h, reg[h])
          session = !!a?.success
          if (!session) delete reg[h]
        }
      }
      if (!session) session = await solveHost(ns, h, d, hist, reg, done, say)
      if (!session) continue
      rooted++
      await spread(ns, h, d, reg, say)
    }
    // AN AIR GAP BELOW (rows 8/16/24 are empty): ride a crawler-carrying neighbour across (dnet-ride.js)
    let ride = null
    if (gapBelowOf(depth) && !ns.isRunning(RIDER, me)) {
      ride = riderTargetOf(carriers, depth)
      if (ride) {
        const per = ns.getScriptRam(RIDER, me)
        const threads = per > 0 ? Math.floor((ns.getServerMaxRam(me) - ns.getServerUsedRam(me)) / per) : 0
        const pid = threads >= 1 ? ns.exec(RIDER, me, { threads }, ride.host) : 0
        if (!(pass % 12)) say({ t: 'ride', host: ride.host, state: pid ? 'inducing' : 'no-room', threads, p: ride.p })
      } else if (!(pass % 12)) say({ t: 'ride', host: null, state: 'no-carrier', why: `row ${depth}: no rooted neighbour with a crawler that can migrate past row ${depth + 1}` })
    }
    say({ t: 'alive', depth, near: near.length, rooted, known: Object.keys(reg).length, riding: ride?.host ?? null })
    await ns.sleep(PASS_SLEEP_MS)
  }
}

async function solveHost(ns, h, d, hist, reg, done, say) {
  const dn = ns.dnet
  // a retry after a give-up starts afresh (retry n: a search's own seed, dnetplan kingOfTheHillSolver)
  if (done.get(h) === 'gave up') {
    hist.set(h, [])
    hist.set(`#${h}`, (hist.get(`#${h}`) ?? 0) + 1)
  }
  const s = solverOf(d, h, hist.get(`#${h}`) ?? 0)
  if (!s.solvable) {
    if (!done.has(h)) say({ t: 'unsolved', host: h, model: d.modelId, depth: d.depth, why: s.why })
    done.set(h, s.why)
    return false
  }
  const hs = hist.get(h) ?? []
  hist.set(h, hs)
  for (let i = 0; i < ATTEMPTS_PER_PASS; i++) {
    const g = s.nextGuess(hs)
    if (g === null) {
      if (!done.has(h)) say({ t: 'gave-up', host: h, model: d.modelId, depth: d.depth, tries: hs.length, why: s.why })
      done.set(h, 'gave up')
      return false
    }
    const a = await dn.authenticate(h, g)
    if (a?.success) {
      reg[h] = g
      done.delete(h)
      say({ t: 'root', host: h, model: d.modelId, depth: d.depth, tries: hs.length + 1, pw: g })
      return true
    }
    if (a?.code === 408) continue // timed out on instability: the same guess again
    if (a?.code !== 401) return false // moved, offline, not connected: next pass
    let fb = null
    if (s.feedback) {
      const hb = await dn.heartbleed(h, { peek: true, logsToCapture: 8 })
      if (hb?.code === 451) {
        if (!done.has(h)) say({ t: 'cha-short', host: h, model: d.modelId, depth: d.depth, need: d.requiredCharismaSkill })
        done.set(h, 'charisma')
        return false
      }
      fb = feedbackOf(hb?.logs, g)
      for (const l of leakedOf(hb?.logs)) if (l.host) reg[l.host] = l.pw
    }
    hs.push({ guess: g, fb })
  }
  return false
}

async function spread(ns, h, d, reg, say) {
  const dn = ns.dnet
  try {
    ns.write(DNET_REG, JSON.stringify(reg), 'w')
    ns.scp([...DNET_FILES, DNET_REG], h)
    if (ns.exec(DNET_FILES[0], h, { threads: 1, preventDuplicates: true }) > 0) return
    if (ns.isRunning(DNET_FILES[0], h)) return
    // not running and it did not start: the owner's RAM is in the way (ramblock.ts) — free some per pass
    if (dn.getBlockedRam(h) > 0) {
      const r = await dn.memoryReallocation(h)
      say({ t: 'no-room', host: h, depth: d.depth, blocked: dn.getBlockedRam(h), freed: !!r?.success })
    } else say({ t: 'no-room', host: h, depth: d.depth, blocked: 0, why: 'no block left: the RAM is in use' })
  } catch (e) {
    say({ t: 'spread-fail', host: h, why: String(e).slice(0, 160) })
  }
}

async function walkLab(ns, lab, d, st, say) {
  const dn = ns.dnet
  const me = ns.getHostname()
  // cleared already (by a walker here or elsewhere): only the reward cache is left to open, on the lab itself
  if (ns.hasRootAccess(lab)) {
    if (ns.ls(lab, '.cache').length && !ns.isRunning(DNET_FILES[0], lab, '--cache')) {
      const s = await dn.authenticate(lab, 'north') // a cleared lab answers Success, and the session lets scp/exec in
      if (s?.success) {
        ns.scp(DNET_FILES, lab)
        const pid = ns.exec(DNET_FILES[0], lab, { threads: 1, preventDuplicates: true }, '--cache')
        if (!pid) say({ t: 'lab', host: lab, state: 'cache-exec-failed', why: `exec ${DNET_FILES[0]} --cache on ${lab} returned 0` })
      } else say({ t: 'lab', host: lab, state: 'cache-no-session', why: `the cleared lab refused a session: code ${s?.code} ${String(s?.message ?? '').slice(0, 60)}` })
    }
    return
  }
  // THE WALK is dnet-lab.js's, with every thread this host can spare (a step is one authentication at the
  // lab's charisma: threads divide it; the position is per pid, so one walker walks the whole maze)
  if (ns.isRunning(LAB_WALKER, me, lab) || ns.isRunning(STASIS, me)) return
  // the host's own block, freed while the lab is in reach (the walker's threads): each call frees
  // 0.04 x 0.92^(difficulty+1) x (1 + cha/100) GB in 8000 x 500/(500 + cha) ms (ramblock.ts, Darknet.ts:542) —
  // ~0.15GB a second at lab 4 — so up to 8 calls a pass, until the link and a 16-thread walker fit
  const per = ns.getScriptRam(LAB_WALKER, me)
  const linkGb = ns.getScriptRam(STASIS, me)
  for (let i = 0; i < 8 && dn.getBlockedRam(me) > 0 && ns.getServerMaxRam(me) - ns.getServerUsedRam(me) < linkGb + 16 * per; i++) {
    const r = await dn.memoryReallocation(me)
    if (!r?.success) break
  }
  if (st.retryAt > Date.now()) return // a walker ended (charisma short, lost) or found no room under a minute ago
  // PIN THIS HOST before walking (dnet-stasis.js): a move takes the walker off the lab's row, a restart kills
  // it, and either restarts the maze from the entrance. Only while a link is free (the limit is 1-4), and
  // only with room for the link AND a walker; otherwise walk unpinned (parallel walkers on other hosts).
  const linked = dn.getStasisLinkedServers()
  const room = ns.getServerMaxRam(me) - ns.getServerUsedRam(me)
  if (!linked.includes(me) && linked.length < dn.getStasisLinkLimit() && room >= linkGb + per && !st.linkTried) {
    st.linkTried = true // once per crawler life: a refused link is reported, not retried every pass
    const pid = ns.exec(STASIS, me, 1)
    say({ t: 'lab', host: lab, state: pid ? 'linking' : 'link-exec-failed', why: `${me}: ${linked.length} of ${dn.getStasisLinkLimit()} links in use` })
    if (pid) return // the link takes 30s x 1000/(cha + 1000); the walker starts on a later pass
  }
  const free = ns.getServerMaxRam(me) - ns.getServerUsedRam(me)
  const threads = per > 0 ? Math.floor(free / per) : 0
  if (threads < 1) {
    st.retryAt = Date.now() + 15000
    say({ t: 'lab', host: lab, state: 'no-room', why: `${me}: ${free.toFixed(1)}GB free, the walker needs ${per}GB a thread`, need: d.requiredCharismaSkill })
    return
  }
  st.retryAt = Date.now() + 60000
  const pid = ns.exec(LAB_WALKER, me, { threads }, lab)
  say({ t: 'lab', host: lab, state: pid ? 'walking' : 'walker-exec-failed', threads, need: d.requiredCharismaSkill })
}
