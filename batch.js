// HWGW batch controller.
//
//   run batch.js                        whole fleet, targets chosen automatically
//   run batch.js --hosts pserv-1,pserv-2   only those hosts (rollback / A-B)
//   run batch.js --targets 1            pin the target count instead of deriving it
//
// Replaces the threshold loop (auto.js + early.js), which picks ONE operation
// for the whole fleet at a time and so serialises everything on the slowest
// phase: with 4,400 threads pointed at one server the fleet spends minutes
// growing, takes the money in a single frame, and starts again. That is not a
// bug — it is what a loop of independent workers converges to, because they all
// read the same server and all reach the same conclusion. It caps income at
// roughly one target's max money per cycle however much RAM you add, which is
// why marginal RAM had stopped paying.
//
// A batcher instead keeps the target permanently at minimum security and
// maximum money and lands a repeating quartet:
//
//     H  .. takes f of the money
//     W1 .. undoes H's security fortification
//     G  .. puts the money back
//     W2 .. undoes G's security fortification
//
// separated by SPACING ms, so the server between one H and the next is in
// exactly the state H assumed. Income then scales with how many such quartets
// are in flight, which is `weakenTime / period`, and the period shrinks until
// RAM runs out. Measured in tools/sim against the shipped threshold loop at the
// same pinned RAM (docs/optimizer-log.md section 13): 2.3x at 3TB and 6x at
// 8TB on total earnings, and 14-50x on the end-of-run rate.
//
// Two design choices carry the robustness, both from docs/prior-art.md section 9:
//
//   * Every operation is launched with `additionalMsec` (h.js/g.js/w.js), never
//     by sleeping first, and all four of a batch are launched in one burst with
//     no `await` between them. They therefore read the same hacking level and
//     the same security, and their relative landing offsets are exact for the
//     whole flight no matter what happens afterwards.
//
//   * A batch is only launched when the target is *measured* at minimum
//     security. A correct batch deliberately raises security twice per cycle,
//     and an operation launched during those windows runs 10-60x the separation
//     constant longer than planned. This is the closed-loop form of "phase-lock
//     to 3.5 epsilon" and it needs no assumption that the schedule is running
//     as planned.
//
// And the failure path is the point, not an afterthought: if a target's
// security climbs or its money falls past tolerance, the controller stops
// launching, lets everything in flight land, and re-preps. Nothing tries to
// rescue a desynced pipeline in place. That always terminates, and it is why
// this can be left running unattended.

const SETTINGS = {
  workers: { hack: 'h.js', grow: 'g.js', weaken: 'w.js' },
  // Landing separation. 200ms is conservative; the game's timers resolve to
  // 1ms, but the controller loop is the real floor and it runs at LOOP_MS.
  spacing: 200,
  loopMs: 200,
  slowCycleMs: 10000,
  retargetMs: 30000,
  statusMs: 5000,
  statusFile: '/tel/batch.txt',
  // GB left free on whichever host this script runs on, so the controller and
  // anything else resident there is never squeezed out by its own workers.
  selfReserve: 6,
  homeReserve: 4,
  // Grow and weaken are over-provisioned by this factor. It is nearly free:
  // excess grow threads add no security at all and excess weaken is clamped at
  // the floor, while under-growing accumulates without bound because servers
  // have no passive regrowth. Only hack can damage state.
  margin: 1.1,
  // Desync tolerances. Past these the pipeline is abandoned and re-prepped.
  secTol: 1.0,
  moneyTol: 0.6,
  maxTargets: 8,
}

// src/Server/data/Constants.ts
const FORTIFY = 0.002
const WEAKEN_PER_THREAD = 0.05
const MAX_GROWTH_LOG = 0.00349388925425578
const BASE_GROWTH_INCR = 0.03

const PORT_PROGRAMS = [
  { file: 'BruteSSH.exe', fn: 'brutessh' },
  { file: 'FTPCrack.exe', fn: 'ftpcrack' },
  { file: 'relaySMTP.exe', fn: 'relaysmtp' },
  { file: 'HTTPWorm.exe', fn: 'httpworm' },
  { file: 'SQLInject.exe', fn: 'sqlinject' },
]

function scanAll(ns) {
  const seen = new Set(['home'])
  const queue = ['home']
  while (queue.length) {
    for (const host of ns.scan(queue.shift())) {
      if (!seen.has(host)) {
        seen.add(host)
        queue.push(host)
      }
    }
  }
  return [...seen]
}

function tryRoot(ns, host) {
  if (ns.hasRootAccess(host)) return true
  // Deliberately no hacking-level check. Rooting is gated on open ports alone
  // (ns.nuke, src/NetscriptFunctions.ts:504-520, and NUKE.exe itself at
  // src/Programs/Programs.ts:68); only *hacking* a server is level-gated
  // (netscriptCanHack.ts). A server far above our level is therefore still
  // rootable, and its RAM is still ours to run workers on — which is all we
  // want from most of the network.
  //
  // auto.js, spider.js and an earlier version of this function all tested the
  // level here and so refused RAM they were entitled to: 384GB of 404GB
  // withheld at level 1, and 688GB withheld on the live save.
  let opened = 0
  for (const { file, fn } of PORT_PROGRAMS) {
    if (!ns.fileExists(file, 'home')) continue
    try {
      ns[fn](host)
      opened++
    } catch {
      // already open, or not applicable here
    }
  }
  if (opened < ns.getServerNumPortsRequired(host)) return false
  try {
    ns.nuke(host)
    return ns.hasRootAccess(host)
  } catch {
    return false
  }
}

// --- game formulas, inlined -------------------------------------------------
//
// These are ports of src/Hacking.ts and src/Server/formulas/grow.ts evaluated
// at *minimum* security, which is the state a batched target is held in. The
// ns equivalents would cost RAM and, worse, would report the server as it is
// right now rather than as the batch will find it. Every player multiplier is
// 1 in BN1 with no augmentations installed; revisit after the first install.

/** calculatePercentMoneyHacked: fraction one hack thread takes. */
function hackFraction(level, required, minSec) {
  if (minSec >= 100) return 0
  const difficultyMult = (100 - minSec) / 100
  const skillMult = (level - (required - 1)) / level
  return Math.min(1, Math.max(0, (difficultyMult * skillMult) / 240))
}

/** calculateHackingChance. */
function hackChance(level, required, minSec) {
  if (minSec >= 100) return 0
  const skillMult = Math.max(1.75 * level, 1)
  return Math.min(1, Math.max(0, ((skillMult - required) / skillMult) * ((100 - minSec) / 100)))
}

/** calculateServerGrowthLog(server, 1, player, 1) — the per-thread growth constant. */
function growthK(minSec, serverGrowth) {
  if (!serverGrowth) return 0
  return Math.min(Math.log1p(BASE_GROWTH_INCR / minSec), MAX_GROWTH_LOG) * (serverGrowth / 100)
}

/**
 * numCycleForGrowthCorrected, ported from src/Server/ServerHelpers.ts.
 *
 * Newton-Raphson on log(n) = log(o+x) + k*x. ns.growthAnalyze would answer a
 * near-enough question for 1GB, but it uses the uncorrected form, which ignores
 * the additive `+threads` term and so overestimates — and it evaluates at the
 * server's current security rather than the minimum the batch will land at.
 */
function growThreads(targetMoney, startMoney, k, moneyMax) {
  if (!(k > 0)) return Infinity
  if (startMoney < 0) startMoney = 0
  if (targetMoney > moneyMax) targetMoney = moneyMax
  if (targetMoney <= startMoney) return 0

  let x = (targetMoney - startMoney) / (1 + (targetMoney / 16 + (startMoney * 15) / 16) * k)
  let diff
  let guard = 0
  do {
    const ox = startMoney + x
    const nx = (x - ox * Math.log(ox / targetMoney)) / (1 + ox * k)
    diff = nx - x
    x = nx
  } while ((diff < -1 || diff > 1) && guard++ < 64)
  if (!isFinite(x) || x < 0) return Infinity
  return Math.ceil(x)
}

/** Everything about a target that the planner needs, read once per tick. */
function readTarget(ns, host) {
  const level = ns.getHackingLevel()
  const required = ns.getServerRequiredHackingLevel(host)
  const minSec = ns.getServerMinSecurityLevel(host)
  const maxMoney = ns.getServerMaxMoney(host)
  return {
    host,
    level,
    required,
    minSec,
    maxMoney,
    sec: ns.getServerSecurityLevel(host),
    money: ns.getServerMoneyAvailable(host),
    growth: ns.getServerGrowth(host),
    // getHackTime reports the *current* security. The batch cares about the
    // prepped server, so scale back to minimum: duration is linear in
    // (2.5*required*difficulty + 500).
    hackTime:
      (ns.getHackTime(host) * (2.5 * required * minSec + 500)) /
      (2.5 * required * Math.max(ns.getServerSecurityLevel(host), minSec) + 500),
  }
}

/**
 * Money per RAM-second of a whole batch as f -> 0, times the chance the hack
 * lands. The same index auto.js ranks with; see docs/optimizer-log.md section 6.
 */
function targetScore(t) {
  const phi = hackFraction(t.level, t.required, t.minSec)
  const k = growthK(t.minSec, t.growth)
  if (!(phi > 0) || !(k > 0) || !(t.hackTime > 0)) return 0
  const chance = hackChance(t.level, t.required, t.minSec)
  return (chance * t.maxMoney) / ((t.hackTime / 1000) * (1.98 / phi + 6.16 / k))
}

/**
 * Size one batch: how big a bite to take, and what it costs to put back.
 *
 * h hack threads take f = h*phi of the money. Everything else follows from h,
 * so h is the only real decision. Larger h amortises the integral weaken
 * threads (one weaken cancels 25 hack threads) but costs disproportionately
 * more grow, because regrowth is logarithmic in f. Sweep and take the best
 * money per GB — the batch holds its RAM for one weakenTime whatever h is, so
 * that constant drops out of the comparison.
 */
function planBatch(t, ram, maxRam) {
  const phi = hackFraction(t.level, t.required, t.minSec)
  const k = growthK(t.minSec, t.growth)
  if (!(phi > 0) || !(k > 0)) return null
  const chance = hackChance(t.level, t.required, t.minSec)

  const build = (h) => {
    const f = Math.min(0.99, phi * h)
    const after = Math.max(t.maxMoney * (1 - f), 1)
    const g = Math.max(1, Math.ceil(growThreads(t.maxMoney, after, k, t.maxMoney) * SETTINGS.margin))
    if (!isFinite(g)) return null
    const w1 = Math.ceil((FORTIFY * h * SETTINGS.margin) / WEAKEN_PER_THREAD) + 1
    const w2 = Math.ceil((2 * FORTIFY * g * SETTINGS.margin) / WEAKEN_PER_THREAD) + 1
    const gb = ram.hack * h + ram.grow * g + ram.weaken * (w1 + w2)
    return { h, g, w1, w2, f, gb, money: f * t.maxMoney * chance, score: (f * t.maxMoney * chance) / gb }
  }

  let best = null
  const hMax = Math.max(1, Math.ceil(0.99 / phi))
  for (let h = 1; h <= hMax; h = h < 8 ? h + 1 : Math.ceil(h * 1.3)) {
    const p = build(h)
    if (!p) continue
    if (p.gb > maxRam) break
    if (!best || p.score > best.score) best = p
  }
  return best ?? build(1)
}

/**
 * Assign hosts to a batch's four operations.
 *
 * hack must land as ONE thread group: two hack groups landing together drain
 * sequentially, so the second takes its cut of an already-reduced balance and
 * the batch takes less than planned. grow and weaken have no such problem —
 * launched in the same burst with the same pad they land together, and
 * splitting them only ever over-delivers, which is free. Letting them split is
 * what makes a batch placeable at all on a fleet of mixed server sizes.
 *
 * Returns null rather than a partial placement. A hack whose grow could not be
 * placed strips the target; that is the highest-probability real failure in the
 * whole design (docs/prior-art.md section 9d).
 */
function place(free, ops, ram) {
  const blocks = [...free.entries()].map(([host, gb]) => ({ host, gb })).sort((a, b) => a.gb - b.gb)
  const out = []
  const order = [...ops].sort(
    (a, b) => (a.op === 'hack' ? 0 : 1) - (b.op === 'hack' ? 0 : 1) || b.threads * ram[b.op] - a.threads * ram[a.op],
  )
  for (const o of order) {
    const per = ram[o.op]
    if (o.op === 'hack') {
      const need = o.threads * per
      const pick = blocks.find((b) => b.gb >= need - 1e-9)
      if (!pick) return null
      pick.gb -= need
      out.push({ ...o, host: pick.host })
      continue
    }
    let left = o.threads
    for (let i = blocks.length - 1; i >= 0 && left > 0; i--) {
      const take = Math.min(left, Math.floor(blocks[i].gb / per))
      if (take < 1) continue
      blocks[i].gb -= take * per
      out.push({ ...o, threads: take, host: blocks[i].host })
      left -= take
    }
    if (left > 0) return null
  }
  return out
}

export async function main(ns) {
  const flags = ns.flags([
    ['hosts', ''],
    ['targets', 0], // 0 = derive the count from the saturation arithmetic
    ['spacing', SETTINGS.spacing],
    ['adopt', false], // leave workers from a previous instance running
    ['quiet', false],
  ])
  SETTINGS.spacing = Number(flags.spacing) || SETTINGS.spacing

  ns.disableLog('ALL')
  const self = ns.getHostname()
  const started = Date.now()
  const only = String(flags.hosts)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const ram = {
    hack: ns.getScriptRam(SETTINGS.workers.hack, 'home'),
    grow: ns.getScriptRam(SETTINGS.workers.grow, 'home'),
    weaken: ns.getScriptRam(SETTINGS.workers.weaken, 'home'),
  }
  if (!ram.hack || !ram.grow || !ram.weaken) {
    ns.tprint(`ERROR: workers missing on home (${JSON.stringify(SETTINGS.workers)})`)
    return
  }

  // Clear the fleet before starting.
  //
  // Two things get killed. `early.js` is the threshold loop this replaces: it
  // fills every host it is given and never exits, so leaving even one running
  // means the batcher cannot place a batch — observed live, 7.5 minutes up,
  // 99.9% RAM used, 248 placement failures and zero batches launched. And a
  // previous instance's own workers are killed rather than adopted, because
  // adopting them means starting with the fleet full of operations this
  // controller did not plan and cannot see the schedule of, which can stall prep
  // for a whole weakenTime. Killing costs at most one batch in flight and makes
  // a restart deterministic; a half-killed batch just looks like a desync, which
  // the prep path already handles.
  const MINE = [SETTINGS.workers.hack, SETTINGS.workers.grow, SETTINGS.workers.weaken]
  const CLEAR = flags.adopt ? ['early.js'] : [...MINE, 'early.js']
  let killed = 0
  for (const host of scanAll(ns)) {
    if (!ns.hasRootAccess(host)) continue
    if (only.length && !only.includes(host)) continue
    for (const p of ns.ps(host)) {
      if (CLEAR.includes(p.filename)) {
        ns.kill(p.pid)
        killed++
      }
    }
  }
  ns.tprint(`batch.js on ${self}: workers ${ram.hack}/${ram.grow}/${ram.weaken}GB, cleared ${killed} process(es)`)

  /** Per-target state. phase is one of prep | batch | drain. */
  const S = new Map()
  const state = (host) => {
    if (!S.has(host)) {
      S.set(host, {
        phase: 'prep',
        nextLaunch: 0,
        quietUntil: 0,
        lastLanding: 0,
        lastLaunch: 0,
        pending: [],
        batches: 0,
        drains: 0,
        placeFails: 0,
        unsafeSkips: 0,
        execFails: 0,
        partials: 0,
        earned: 0,
        lastMoney: null,
      })
    }
    return S.get(host)
  }

  let hosts = []
  let targets = []
  let nextSlow = 0
  let nextRetarget = 0
  let nextStatus = 0
  let opsDispatched = 0
  let threadsDispatched = 0
  let loops = 0
  let batchId = 0

  const errors = []

  while (true) {
    loops++
    const now = Date.now()

    try {
      // --- slow cycle: root, refresh the host list, ship the workers --------
      if (now >= nextSlow) {
        nextSlow = now + SETTINGS.slowCycleMs
        const all = scanAll(ns)
        for (const h of all) if (!ns.hasRootAccess(h)) tryRoot(ns, h)
        hosts = all.filter(
          (h) => ns.hasRootAccess(h) && ns.getServerMaxRam(h) > 0 && (!only.length || only.includes(h)),
        )
        for (const h of hosts) {
          if (h === 'home') continue
          if (!ns.fileExists(SETTINGS.workers.hack, h)) {
            ns.scp([SETTINGS.workers.hack, SETTINGS.workers.grow, SETTINGS.workers.weaken], h, 'home')
          }
        }
      }

      const reserveFor = (h) => (h === self ? SETTINGS.selfReserve : 0) + (h === 'home' ? SETTINGS.homeReserve : 0)
      const free = new Map()
      let totalRam = 0
      let usedRam = 0
      for (const h of hosts) {
        const max = ns.getServerMaxRam(h)
        const used = ns.getServerUsedRam(h)
        totalRam += max
        usedRam += used
        const avail = Math.max(0, max - used - reserveFor(h))
        if (avail >= ram.hack) free.set(h, avail)
      }

      // --- choose targets ---------------------------------------------------
      if (now >= nextRetarget || !targets.length) {
        nextRetarget = now + SETTINGS.retargetMs
        const level = ns.getHackingLevel()
        const ranked = []
        for (const h of scanAll(ns)) {
          if (!ns.hasRootAccess(h)) continue
          if (ns.getServerMaxMoney(h) <= 0) continue
          if (ns.getServerRequiredHackingLevel(h) > level) continue
          const t = readTarget(ns, h)
          const s = targetScore(t)
          if (s > 0) ranked.push({ t, s })
        }
        ranked.sort((a, b) => b.s - a.s)

        let want
        if (Number(flags.targets) > 0) {
          want = ranked.slice(0, Number(flags.targets)).map((r) => r.t.host)
        } else {
          // Measured, not derived. The analytic saturation point — a target
          // holds ceil(weakenTime / 4*spacing) batches in flight — is a bound
          // the launch loop never reaches in practice (placement fails, safe
          // windows close, the controller ticks at a finite rate), and trusting
          // it left 42% of a 12TB fleet idle in simulation. A closed-loop "add a
          // target while utilisation is low" rule was worse still: it ratchets,
          // and each addition halves the leading target's share and costs a
          // fresh prep.
          //
          // Simulated at 40 minutes, 3 seeds, from the live world with RAM
          // pinned, two targets measured best or within 0.3% of best at every
          // fleet size tested; three only catches up past ~24TB:
          //
          //       fleet    1 target   2 targets   3 targets   threshold loop
          //     4,096GB      $2.07b      $2.61b           -                -
          //     8,192GB      $5.55b      $6.75b           -           $1.08b
          //    12,288GB      $7.51b     $10.91b      $5.95b           $1.68b
          //    32,768GB     $19.75b     $24.67b     $24.59b         $973.0m
          want = ranked.slice(0, totalRam >= 24576 ? 3 : 2).map((r) => r.t.host)
        }
        // Never abandon a pipeline mid-flight: keep any dropped target that
        // still has operations in the air, and let it drain on its own.
        const keep = targets.filter((h) => !want.includes(h) && now < (S.get(h)?.lastLanding ?? 0))
        if (want.length) targets = [...new Set([...keep, ...want])]
      }

      // --- serve each target ------------------------------------------------
      let reserved = 0
      let anyBatching = false
      let anyPrepping = false

      for (const host of targets) {
        const s = state(host)
        const t = readTarget(ns, host)

        // Attribution: money on a target only ever falls when one of our hacks
        // lands, so the drops sum to what this controller earned from it.
        if (s.lastMoney !== null && t.money < s.lastMoney) s.earned += s.lastMoney - t.money
        s.lastMoney = t.money

        const weakenTime = t.hackTime * 4
        const growTime = t.hackTime * 3.2

        if (s.phase === 'drain') {
          if (now < s.quietUntil) continue
          s.phase = 'prep'
          s.pending = []
        }

        if (s.phase === 'prep') {
          anyPrepping = true
          // Throttle: prep fills the fleet in one go, so re-evaluating every
          // loop just floods hosts with processes they cannot use.
          if (now < (s.nextPrep || 0)) continue
          s.nextPrep = now + 1000
          if (t.sec <= t.minSec + 0.01 && t.money >= t.maxMoney * 0.999) {
            s.phase = 'batch'
            s.pending = []
            s.nextLaunch = now
            s.lastLanding = now
            continue
          }

          // Continuous prep: keep a ledger of what is already in flight, project
          // the server forward to where those landings leave it, and launch only
          // the shortfall. The obvious alternative — launch, sleep a whole
          // weakenTime, re-measure — costs a full 4T per round and measured at
          // 11 of 20 minutes on a large target. Over-provisioning is free here,
          // so an imperfect projection costs threads and never correctness.
          s.pending = s.pending.filter((p) => p.at > now)
          let pendW = 0
          let pendG = 0
          for (const p of s.pending) {
            pendW += p.weaken || 0
            pendG += p.grow || 0
          }
          // A grow fortifies only by the threads it actually *used*
          // (processSingleServerGrowth caps usedCycles at the threads needed),
          // so projecting the fortification from the raw in-flight thread count
          // is an unbounded overestimate. Left uncapped it makes prep believe
          // security is about to explode and launch weakens forever, filling the
          // fleet with work that does nothing. Cap it at the real need.
          const kNow = growthK(Math.max(t.sec, t.minSec), t.growth)
          const needNow = t.money >= t.maxMoney ? 0 : growThreads(t.maxMoney, Math.max(t.money, 1), kNow, t.maxMoney)
          const usedG = Math.min(pendG, isFinite(needNow) ? needNow : pendG)

          const projSec = Math.max(t.minSec, t.sec - pendW + 2 * FORTIFY * usedG)
          const k = growthK(projSec, t.growth)
          const projMoney = pendG > 0 ? Math.min(t.maxMoney, (t.money + pendG) * Math.exp(k * pendG)) : t.money

          const gNeed = projMoney >= t.maxMoney ? 0 : growThreads(t.maxMoney, Math.max(projMoney, 1), k, t.maxMoney)
          const budget = [...free.values()].reduce((a, b) => a + b, 0)
          let gWant = Math.min(gNeed, Math.floor((budget * 0.75) / ram.grow))
          if (!isFinite(gWant) || gWant < 0) gWant = 0

          const gLaunched = gWant >= 1 ? spread(ns, free, ram, 'grow', host, gWant, batchId++) : 0
          const wNeed =
            Math.ceil((projSec - t.minSec) / WEAKEN_PER_THREAD) +
            Math.ceil((2 * FORTIFY * gLaunched) / WEAKEN_PER_THREAD)
          const wLaunched = wNeed >= 1 ? spread(ns, free, ram, 'weaken', host, wNeed, batchId++) : 0

          if (gLaunched) s.pending.push({ at: now + growTime, grow: gLaunched })
          if (wLaunched) s.pending.push({ at: now + weakenTime, weaken: wLaunched * WEAKEN_PER_THREAD })
          opsDispatched += (gLaunched ? 1 : 0) + (wLaunched ? 1 : 0)
          threadsDispatched += gLaunched + wLaunched
          continue
        }

        // --- batch ----------------------------------------------------------
        // The health check is the convergence guarantee. Servers have no passive
        // regrowth and no security decay, so any systematic bias in the thread
        // arithmetic integrates without bound unless something re-measures and
        // intervenes.
        // The tolerances have to allow for the excursion this batcher itself
        // plans, or it declares desync on its own correct behaviour. A batch
        // deliberately takes `plan.f` of the money and fortifies security by
        // FORTIFY*plan.h before W1 lands, so a fixed 0.6 money floor aborts
        // every cycle on any target where the optimal bite exceeds 40% — on
        // n00dles the plan takes 54.4% — and a fixed 1.0 security ceiling trips
        // on H's own fortification once the hack is more than 500 threads. The
        // result is one batch per weakenTime forever, which looks like the
        // pipeline running rather than a fault.
        //
        // Derived from the plan in flight, so no new constant: allow the
        // planned excursion plus the existing tolerance as slack. Falls back to
        // the fixed values before a first plan exists.
        const planned = s.plan
        const secCeiling = t.minSec + (planned ? FORTIFY * planned.h : 0) + SETTINGS.secTol
        const moneyFloor = t.maxMoney * (planned ? Math.max(0, 1 - planned.f) * SETTINGS.moneyTol : SETTINGS.moneyTol)
        if (t.sec > secCeiling || t.money < moneyFloor) {
          s.phase = 'drain'
          s.drains++
          s.quietUntil = Math.max(now, s.lastLanding) + 4 * SETTINGS.spacing
          continue
        }
        anyBatching = true

        const share = totalRam / Math.max(1, targets.length)
        const plan = planBatch(t, ram, share / 4)
        if (!plan) continue
        const maxInFlight = Math.max(1, Math.floor(share / plan.gb))
        const period = Math.max(4 * SETTINGS.spacing, weakenTime / maxInFlight)
        s.plan = plan
        s.period = period
        // What this pipeline will claim over the next weakenTime, which is how
        // long a spill weaken holds its RAM — so it is the right thing to hold
        // back from spill.
        reserved += Math.min(share, Math.ceil(weakenTime / period) * plan.gb)

        if (now < s.nextLaunch) continue
        // Safe-window gate. Skipping a launch is free; launching into an
        // elevated-security window is not.
        if (t.sec > t.minSec + 1e-9) {
          s.unsafeSkips++
          continue
        }

        const ops = [
          { op: 'hack', threads: plan.h, pad: Math.round(weakenTime - t.hackTime) },
          { op: 'weaken', threads: plan.w1, pad: SETTINGS.spacing },
          { op: 'grow', threads: plan.g, pad: Math.round(weakenTime - growTime + 2 * SETTINGS.spacing) },
          { op: 'weaken', threads: plan.w2, pad: 3 * SETTINGS.spacing },
        ]
        if (ops.some((o) => o.pad < 0)) continue

        const placed = place(free, ops, ram)
        if (!placed) {
          s.placeFails++
          continue
        }

        // Launch the whole batch with no await between execs, so all four read
        // the same level and the same security. If any exec fails, kill the
        // ones that did launch — a partial batch is strictly worse than none.
        const id = batchId++
        const pids = []
        let ok = true
        for (const o of placed) {
          const pid = ns.exec(SETTINGS.workers[o.op], o.host, { threads: o.threads, temporary: true }, host, o.pad, id)
          if (!pid) {
            ok = false
            s.execFails++
            break
          }
          pids.push(pid)
          free.set(o.host, free.get(o.host) - o.threads * ram[o.op])
        }
        if (!ok) {
          for (const pid of pids) ns.kill(pid)
          s.partials++
          continue
        }

        opsDispatched += placed.length
        threadsDispatched += placed.reduce((a, o) => a + o.threads, 0)
        s.batches++
        s.lastLaunch = now
        s.lastLanding = now + weakenTime + 3 * SETTINGS.spacing
        s.nextLaunch = now + period
      }

      // --- spill ------------------------------------------------------------
      // Grow and weaken award full experience however far they overshoot, and
      // weaken below minimum security is clamped rather than harmful. So RAM the
      // pipelines cannot use is worth spending on weaken: free experience, and
      // it holds the target at the floor, which makes the safe-window gate open
      // more often. Without the reservation above it starves the batcher
      // outright — a spill weaken holds its RAM for a full weakenTime.
      if (anyBatching && targets.length) {
        const idle = [...free.values()].reduce((a, b) => a + b, 0) - reserved
        const threads = Math.floor(idle / ram.weaken)
        if (threads >= 1) spread(ns, free, ram, 'weaken', targets[0], threads, batchId++)
      }

      // --- status -----------------------------------------------------------
      if (now >= nextStatus) {
        nextStatus = now + SETTINGS.statusMs
        const perTarget = targets.map((h) => {
          const s = state(h)
          const t = readTarget(ns, h)
          return {
            host: h,
            phase: s.phase,
            moneyPct: Math.round((t.money / t.maxMoney) * 1000) / 10,
            sec: Math.round(t.sec * 100) / 100,
            minSec: t.minSec,
            hackTimeSec: Math.round(t.hackTime / 100) / 10,
            batches: s.batches,
            batchesPerMin: s.batches && s.lastLaunch ? Math.round((s.batches / ((now - started) / 60000)) * 10) / 10 : 0,
            sinceLaunchSec: s.lastLaunch ? Math.round((now - s.lastLaunch) / 100) / 10 : null,
            earned: Math.round(s.earned),
            plan: s.plan ? { h: s.plan.h, g: s.plan.g, w1: s.plan.w1, w2: s.plan.w2, gb: Math.round(s.plan.gb), fPct: Math.round(s.plan.f * 1000) / 10 } : null,
            periodSec: s.period ? Math.round(s.period) / 1000 : null,
            drains: s.drains,
            placeFails: s.placeFails,
            unsafeSkips: s.unsafeSkips,
            execFails: s.execFails,
            partials: s.partials,
          }
        })
        const uptime = (now - started) / 1000
        const earned = perTarget.reduce((a, x) => a + x.earned, 0)
        const batches = perTarget.reduce((a, x) => a + x.batches, 0)

        // One-glance health. "stalled" is the state that has cost us hours
        // before, so it gets its own word rather than being inferred.
        const recentLaunch = perTarget.some((x) => x.sinceLaunchSec !== null && x.sinceLaunchSec < 60)
        const health = recentLaunch ? 'ok' : anyBatching ? 'stalled' : anyPrepping ? 'prepping' : 'idle'

        const status = {
          at: new Date(now).toISOString(),
          health,
          uptimeSec: Math.round(uptime),
          controller: self,
          hostsUsed: hosts.length,
          hackingLevel: ns.getHackingLevel(),
          ram: { total: Math.round(totalRam), used: Math.round(usedRam), utilPct: totalRam ? Math.round((usedRam / totalRam) * 1000) / 10 : 0, reservedForPipelines: Math.round(reserved) },
          totals: {
            batches,
            opsDispatched,
            threadsDispatched,
            earned: Math.round(earned),
            earnedPerSec: uptime > 0 ? Math.round(earned / uptime) : 0,
            loops,
          },
          targets: perTarget,
          errors: errors.slice(-5),
        }
        ns.write(SETTINGS.statusFile, JSON.stringify(status, null, 2), 'w')
        // The daemon only mirrors /tel/* off home, so push a copy there when
        // this controller is running anywhere else.
        if (self !== 'home') ns.scp(SETTINGS.statusFile, 'home', self)
        if (!flags.quiet) ns.print(`${health} | ${targets.join(',')} | ${batches} batches | ${Math.round(earned / 1e6)}m earned`)
      }
    } catch (err) {
      // Never die. A bad tick is recoverable; a dead controller is not.
      errors.push(`${new Date().toISOString()} ${err}`)
      if (errors.length > 20) errors.shift()
    }

    await ns.sleep(SETTINGS.loopMs)
  }
}

/**
 * Launch an operation across as many hosts as it takes. Prep and spill only —
 * a batch's operations go through place() instead, because they must be all or
 * nothing. Returns the threads actually launched.
 */
function spread(ns, free, ram, op, target, want, id) {
  let launched = 0
  const per = ram[op]
  for (const [host, gb] of [...free.entries()].sort((a, b) => b[1] - a[1])) {
    if (launched >= want) break
    const take = Math.min(want - launched, Math.floor(gb / per))
    if (take < 1) continue
    const pid = ns.exec(SETTINGS.workers[op], host, { threads: take, temporary: true }, target, 0, id)
    if (!pid) continue
    free.set(host, gb - take * per)
    launched += take
  }
  return launched
}
