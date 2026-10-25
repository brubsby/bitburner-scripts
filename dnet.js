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
// (memoryReallocation). THE LABYRINTH (dnetplan.labStep): a neighbour whose model is the labyrinth is
// walked depth-first with labreport + authenticate('north'...); at its end the lab holds the reward
// cache, opened by a copy of this script run there with --cache (cacheFiles.ts getLabReward QUEUES the
// lab's augmentation — The Red Pill at BN15's 5th lab; it counts only once INSTALLED).
//
// FAILURE IS LOUD: every give-up names the model and why on DNET_PORT (dnet-seed.js aggregates the
// reports into /tel/dnet.txt): `unsolved` (no solver), `gave-up` (the solver ran out), `cha-short`
// (heartbleed/lab need more charisma), `no-room` (the child did not fit), `threw`. A crawler that
// dies says so (atExit).
//
// RAM: every ns.dnet call this file makes is paid by every copy (one thread each); measured by
// tools/test/dnet.test.mjs [DN5] with the game's own calculator. Nothing here runs on home.
import { DNET_PORT, DNET_FILES, DNET_REG, LAB_MODEL, solverOf, feedbackOf, leakedOf, cluesOf, labStep } from 'dnetplan.js'

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
    for (const h of near) {
      const d = dn.getServerDetails(h)
      if (!d?.isOnline || !d.isConnectedToCurrentServer) continue
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
    say({ t: 'alive', depth, near: near.length, rooted, known: Object.keys(reg).length })
    await ns.sleep(PASS_SLEEP_MS)
  }
}

async function solveHost(ns, h, d, hist, reg, done, say) {
  const dn = ns.dnet
  const s = solverOf(d, h)
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
  // cleared already (by this copy or another): only the reward cache is left to open, on the lab itself
  if (ns.hasRootAccess(lab)) {
    if (ns.ls(lab, '.cache').length) {
      const s = await dn.authenticate(lab, 'north') // a cleared lab answers Success, and the session lets scp/exec in
      if (s?.success) {
        ns.scp(DNET_FILES, lab)
        ns.exec(DNET_FILES[0], lab, { threads: 1, preventDuplicates: true }, '--cache')
      }
    }
    return
  }
  if (st.retryAt > Date.now()) return // charisma short a minute ago: the walk waits instead of re-asking every pass
  for (let steps = 0; steps < 4000; steps++) {
    const rep = await dn.labreport()
    if (!rep?.success) {
      say({ t: 'lab', host: lab, state: 'no-report', msg: String(rep?.message ?? '').slice(0, 120) })
      return
    }
    const dir = labStep(st, rep)
    if (dir === null) {
      say({ t: 'lab', host: lab, state: 'exhausted', at: rep.coords })
      return
    }
    const a = await dn.authenticate(lab, dir)
    if (a?.success) {
      say({ t: 'lab', host: lab, state: 'cleared', need: d.requiredCharismaSkill, steps })
      // the reward cache sits on the lab: open it there (a copy of this script, --cache)
      ns.scp(DNET_FILES, lab)
      ns.exec(DNET_FILES[0], lab, { threads: 1, preventDuplicates: true }, '--cache')
      return
    }
    if (/charism|moxie|charm/i.test(String(a?.message ?? ''))) {
      // reported once a minute, not every pass (the port holds 50)
      if (!(st.shortAt > Date.now() - 60000)) say({ t: 'lab', host: lab, state: 'cha-short', need: d.requiredCharismaSkill })
      st.shortAt = Date.now()
      st.retryAt = Date.now() + 60000
      return
    }
  }
  say({ t: 'lab', host: lab, state: 'step-cap' })
}
