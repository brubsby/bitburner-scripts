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

// Free to import: status.js references only ns.write (0GB). See its header.
import { reporter, describe, record } from 'status.js'

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
  // Fraction of total fleet RAM left unclaimed so ns.share() has somewhere to
  // live. Not a courtesy: share multiplies *faction reputation*, and reputation
  // — not money — is what gates leaving the BitNode. The bonus is
  // 1 + ln(threads)/25, so this modest slice buys a large share of the maximum.
  //
  // Without it the batcher runs at ~98% utilisation and the largest free block
  // on a 26.7PB fleet is under 3TB, so share falls back to its 600-thread floor
  // (bonus 1.256) while 200,000 threads — 3% of the fleet — would give 1.488.
  // That is ~18% more reputation on every stream for RAM whose marginal income
  // we do not need.
  //
  // Applied only while faction work is actually running; with no faction joined
  // share does nothing and the batcher should have everything.
  shareFrac: 0.03,
  // Grow and weaken are over-provisioned by this factor. It is nearly free:
  // excess grow threads add no security at all and excess weaken is clamped at
  // the floor, while under-growing accumulates without bound because servers
  // have no passive regrowth. Only hack can damage state.
  margin: 1.1,
  // Desync tolerances. Past these the pipeline is abandoned and re-prepped.
  secTol: 1.0,
  moneyTol: 0.6,
  // Upper bound on how many targets the income argmax in main() considers.
  // Not a RAM knob — the count itself is derived per tick.
  maxTargets: 8,
  // Ignore any target scoring below this fraction of the best one. Scale-free,
  // Scale-free, so unlike an absolute RAM figure it cannot go stale.
  minScoreFrac: 0.02,
  // Also require a target to be worth something in absolute terms, as a
  // fraction of the richest server available.
  //
  // targetScore is money per RAM-second, and small fast servers score well on
  // it because they cycle quickly — n00dles ($1.75m max) ranked inside the top
  // eight alongside ecorp ($1.5t) and took 34% of all batches. Two problems
  // with that, and the second is the one that bites:
  //
  //   * the money is a rounding error either way;
  //   * hacking EXPERIENCE scales with a server's difficulty, not its money
  //     (calculateHackingExpGain, src/Hacking.ts:29-38 — baseDifficulty*0.3),
  //     so farming trivial servers yields almost no exp. Measured: 10.3 exp/sec
  //     with 95% of batches on n00dles/foodnstuff/omega-net, while six
  //     megacorps sat starved in prep. Hacking level is the last Daedalus gate,
  //     so that is the wrong thing to be optimising.
  //
  // A ratio against the best server keeps this scale-free: it excludes the same
  // junk on a 10PB fleet as on a 100GB one.
  minMoneyFrac: 0.01,
}

// src/Server/data/Constants.ts
export const FORTIFY = 0.002
export const WEAKEN_PER_THREAD = 0.05

/**
 * Effectiveness multiplier for grow and weaken on a host with `cores` cores:
 * 1 + (cores - 1)/16 (src/Server/ServerHelpers.ts:315-318). It scales
 * getWeakenEffect (:320-323) and the grow log (src/Server/formulas/grow.ts:21)
 * linearly, so a thread on a 6-core home does 1.3125x the work of one on a
 * single-core purchased server.
 *
 * Only the *executing* host's cores count — the target's are irrelevant — which
 * is why this is applied at placement time rather than in planBatch: the plan
 * is built before anyone knows which host will run it.
 */
export const coreBonus = (cores) => 1 + (Math.max(1, cores) - 1) / 16
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
// right now rather than as the batch will find it.
//
// Player multipliers are NOT constant and are folded in from
// ns.getHackingMultipliers() (0.25GB), which the game derives from installed
// augmentations. The original version hardcoded them to 1 with a "revisit
// after the first install" note that nobody revisited — by the 29th installed
// augmentation the real hacking_money multiplier had every batch draining
// *more* than the fraction its grow threads were sized to put back, which is a
// desync the tolerance machinery then has to absorb. hacking_grow ran the
// other way, oversending grow threads. hackTime needs no term here because it
// is read live from ns.getHackTime, which already includes the speed
// multiplier. Intelligence is locked in BN1, so its bonus term is exactly 1.

/** calculatePercentMoneyHacked (Hacking.ts:44-56): fraction one hack thread takes. */
export function hackFraction(level, required, minSec, mults) {
  if (minSec >= 100) return 0
  const difficultyMult = (100 - minSec) / 100
  const skillMult = (level - (required - 1)) / level
  return Math.min(1, Math.max(0, (difficultyMult * skillMult * mults.money) / 240))
}

/** calculateHackingChance (Hacking.ts:9-24). */
export function hackChance(level, required, minSec, mults) {
  if (minSec >= 100) return 0
  const skillMult = Math.max(1.75 * level, 1)
  return Math.min(1, Math.max(0, ((skillMult - required) / skillMult) * ((100 - minSec) / 100) * mults.chance))
}

/** calculateServerGrowthLog(server, 1, player, 1) — the per-thread growth constant. */
export function growthK(minSec, serverGrowth, mults) {
  if (!serverGrowth) return 0
  return Math.min(Math.log1p(BASE_GROWTH_INCR / minSec), MAX_GROWTH_LOG) * (serverGrowth / 100) * mults.growth
}

/**
 * numCycleForGrowthCorrected, ported from src/Server/ServerHelpers.ts.
 *
 * Newton-Raphson on log(n) = log(o+x) + k*x. ns.growthAnalyze would answer a
 * near-enough question for 1GB, but it uses the uncorrected form, which ignores
 * the additive `+threads` term and so overestimates — and it evaluates at the
 * server's current security rather than the minimum the batch will land at.
 */
export function growThreads(targetMoney, startMoney, k, moneyMax) {
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
  // {chance, speed, money, growth}, derived by the game from installed augs.
  // Read fresh each tick: an install mid-run changes all four.
  const mults = ns.getHackingMultipliers()
  const required = ns.getServerRequiredHackingLevel(host)
  const minSec = ns.getServerMinSecurityLevel(host)
  const maxMoney = ns.getServerMaxMoney(host)
  return attachMath(ns, {
    host,
    level,
    mults,
    required,
    minSec,
    maxMoney,
    sec: ns.getServerSecurityLevel(host),
    money: ns.getServerMoneyAvailable(host),
    growth: ns.getServerGrowth(host),
    // getHackTime reports the *current* security. The batch cares about the
    // prepped server, so scale back to minimum: duration is linear in
    // (2.5*required*difficulty + 500). Both are needed and they are NOT
    // interchangeable — prep runs on a server that is by definition not at
    // minimum, and using the prepped figure there under-estimates every
    // duration by the security ratio, which on a degraded target is 3-6x.
    hackTime:
      (ns.getHackTime(host) * (2.5 * required * minSec + 500)) /
      (2.5 * required * Math.max(ns.getServerSecurityLevel(host), minSec) + 500),
    hackTimeNow: ns.getHackTime(host),
  })
}

/**
 * Attach phi (hack fraction/thread), chance, and the growth constants to a
 * target, asking the game itself when it can.
 *
 * With Formulas.exe present (a $5b darkweb item — money, not a Source-File),
 * ns.formulas.hacking evaluates the game's OWN current formulas against a mock
 * server pinned at the security we care about, every multiplier included, at
 * 0 GB per call (RamCostGenerator.ts:695-706). That cannot drift, ever.
 *
 * Without it, the inlined ports above are used. They are checked against
 * src/Hacking.ts and carry ns.getHackingMultipliers(), but they are still a
 * port — which is why they are the fallback and not the primary. The one
 * piece that stays local either way is the Newton grow-thread solver: it runs
 * inside planBatch's sizing sweep, and its only formula input is k, which
 * comes from the game here.
 */
function attachMath(ns, t) {
  if (ns.fileExists('Formulas.exe', 'home')) {
    const p = ns.getPlayer()
    const f = ns.formulas.hacking
    const srv = ns.formulas.mockServer()
    srv.hostname = t.host
    srv.hasAdminRights = true
    srv.requiredHackingSkill = t.required
    srv.baseDifficulty = t.minSec
    srv.minDifficulty = t.minSec
    srv.hackDifficulty = t.minSec
    srv.moneyMax = t.maxMoney
    srv.moneyAvailable = t.maxMoney
    srv.serverGrowth = t.growth
    t.phi = f.hackPercent(srv, p)
    t.chance = f.hackChance(srv, p)
    // cores = 1 deliberately: this k is the single-core per-thread constant,
    // and place() scales thread counts by the executing host's core bonus.
    // Baking a host's cores in here would be wrong for every other host.
    t.k = Math.log(f.growPercent(srv, 1, p, 1))
    srv.hackDifficulty = Math.max(t.sec, t.minSec)
    t.kNow = Math.log(f.growPercent(srv, 1, p, 1))
  } else {
    t.phi = hackFraction(t.level, t.required, t.minSec, t.mults)
    t.chance = hackChance(t.level, t.required, t.minSec, t.mults)
    t.k = growthK(t.minSec, t.growth, t.mults)
    t.kNow = growthK(Math.max(t.sec, t.minSec), t.growth, t.mults)
  }
  return t
}

/**
 * Money per RAM-second of a whole batch as f -> 0, times the chance the hack
 * lands. The same index auto.js ranks with; see docs/optimizer-log.md section 6.
 */
export function targetScore(t) {
  const phi = t.phi
  const k = t.k
  if (!(phi > 0) || !(k > 0) || !(t.hackTime > 0)) return 0
  const chance = t.chance
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
/**
 * @param maxRam      total RAM this batch may occupy across the whole fleet
 * @param maxHackRam  RAM of the LARGEST SINGLE free block, because the hack op
 *                    cannot be split (see place() below). Defaults to Infinity
 *                    so offline callers that only care about the RAM/score
 *                    tradeoff are unaffected.
 *
 * Without `maxHackRam` this function happily returns plans that `place()` can
 * never satisfy: it sized against the fleet while placement is per-host, so on
 * an 8-host fleet of <=16GB it chose h=11 (18.7GB of hack) and the batcher
 * logged 7,274 consecutive placement failures and earned $0 for 27 minutes,
 * reporting `health: stalled` with no error. A planner that emits unplaceable
 * plans and lets the caller discover it by failing is the bug; capping here is
 * the fix, and returning null when even h=1 cannot be placed is what lets the
 * caller fall back to something that can run.
 */
export function planBatch(t, ram, maxRam, maxHackRam = Infinity) {
  const phi = t.phi
  const k = t.k
  if (!(phi > 0) || !(k > 0)) return null
  const chance = t.chance

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
  // Two ceilings now: the economic one (past 0.99 of the balance, more hack
  // threads buy nothing) and the physical one (the hack op has to fit in one
  // block). The physical ceiling is the one that bites on a small fleet.
  const hFit = Math.floor(maxHackRam / ram.hack)
  const hMax = Math.max(1, Math.min(Math.ceil(0.99 / phi), hFit))
  for (let h = 1; h <= hMax; h = h < 8 ? h + 1 : Math.ceil(h * 1.3)) {
    const p = build(h)
    if (!p) continue
    if (p.gb > maxRam) break
    if (!best || p.score > best.score) best = p
  }
  if (best) return best
  // The old fallback was `build(1)` unconditionally, which re-introduced the
  // whole problem: it ignored both budgets, so an unplaceable single-thread
  // plan escaped and the caller spun on it. Decline instead, and say so by
  // returning null — the caller can then leave the target alone or hand the
  // fleet to something that fits.
  if (hFit < 1) return null
  const one = build(1)
  return one && one.gb <= maxRam ? one : null
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
function place(free, ops, ram, cores = {}) {
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
    // `left` counts single-core-equivalent threads. A multi-core host retires
    // more of them per thread actually launched, so without this the batch
    // oversends grow and weaken by the core bonus — on a 6-core home that is
    // 31% of those threads doing nothing, since both effects cap out (at
    // moneyMax and minSecurity).
    let left = o.threads
    for (let i = blocks.length - 1; i >= 0 && left > 0; i--) {
      const bonus = coreBonus(cores[blocks[i].host] ?? 1)
      const wanted = Math.ceil(left / bonus)
      const take = Math.min(wanted, Math.floor(blocks[i].gb / per))
      if (take < 1) continue
      blocks[i].gb -= take * per
      out.push({ ...o, threads: take, host: blocks[i].host })
      left -= Math.floor(take * bonus)
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

  // Hoisted above the first `return` below so every exit path can publish.
  // `errors` was declared further down with the rest of the loop state; only
  // its scope moved, and it is still the same array read by the same two
  // writes. No new ns surface: ns.write and ns.atExit are both 0GB
  // (RamCostGenerator.ts:632,605), and ns.scp/ns.getHostname were already here.
  const errors = []
  const note = reporter(ns, SETTINGS.statusFile, () => ({ controller: self, errors: errors.slice(-5) }))
  // The daemon only mirrors /tel/* off home, so a controller running anywhere
  // else has to ship its status there. This was already inline at both write
  // sites; hoisting it into a closure lets the exit path use it too, and
  // hoisting a call site does not change the identifier set the RAM checker
  // sees.
  const mirror = () => {
    if (self === 'home') return
    try {
      ns.scp(SETTINGS.statusFile, 'home', self)
    } catch {
      /* home unreachable; the local copy still stands */
    }
  }

  // The path no try/catch can reach, and the most valuable one in the repo to
  // have: this is the script that earns the money. It is killed routinely —
  // the watchdog restarts it, `kill batch.js` is the standard way to reload it
  // after an edit, and an augmentation install kills it along with everything
  // else. Until now every one of those left /tel/batch.txt frozen mid-cycle
  // showing `health: 'ok'`, which is indistinguishable from a running batcher
  // whose last tick simply has not landed yet.
  //
  // ns.atExit costs 0GB and its callbacks run inside stopAndCleanUpWorkerScript
  // BEFORE stopFlag is set and before the worker is removed
  // (killWorkerScript.ts:56-84), so the synchronous ns.write and ns.scp here
  // both still work. Explicit id 'status' so it can never collide with the
  // 'ui-lock' callback lock.js registers (atExit keys by id and a second
  // registration under the same id REPLACES the first,
  // NetscriptFunctions.ts:1395-1398). batch.js takes no lock today; the id
  // makes that independent of what it imports later.
  //
  // note.exit republishes the last body with `health: 'stopped'`, `exited:
  // true` and `staleSince` on top, so `targets`, `totals` and `ram` survive for
  // anything that reads them and no reader has to learn a new shape.
  ns.atExit(() => {
    note.exit('stopped', { detail: 'batch.js is no longer running — the fleet is idle and earning nothing' })
    mirror()
  }, 'status')

  const ram = {
    hack: ns.getScriptRam(SETTINGS.workers.hack, 'home'),
    grow: ns.getScriptRam(SETTINGS.workers.grow, 'home'),
    weaken: ns.getScriptRam(SETTINGS.workers.weaken, 'home'),
  }
  if (!ram.hack || !ram.grow || !ram.weaken) {
    ns.tprint(`ERROR: workers missing on home (${JSON.stringify(SETTINGS.workers)})`)
    // This return wrote nothing, so "the workers are not on home" — a real
    // post-install state, since an install clears every server but home — was
    // reported only to a terminal nobody is watching. The atExit above would
    // now cover it, but 'stopped' with no reason is the wrong answer when the
    // reason is known and is this specific.
    note('error', { detail: `workers missing on home (${JSON.stringify(SETTINGS.workers)})` })
    mirror()
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

      // Hold a share-sized block out of the largest host, so ns.share() has a
      // contiguous home. Sized from the fleet, taken from one host, and only
      // while a faction is joined.
      const sharing = (ns.getPlayer().factions || []).length > 0
      let shareHost = null
      let shareGb = 0
      if (sharing) {
        let total = 0
        let best = { host: null, ram: 0 }
        for (const h of hosts) {
          const max = ns.getServerMaxRam(h)
          total += max
          if (max > best.ram) best = { host: h, ram: max }
        }
        shareGb = Math.min(best.ram * 0.9, total * SETTINGS.shareFrac)
        shareHost = best.host
      }
      const reserveFor = (h) =>
        (h === self ? SETTINGS.selfReserve : 0) +
        (h === 'home' ? SETTINGS.homeReserve : 0) +
        (h === shareHost ? shareGb : 0)
      const free = new Map()
      // Cores per host, read once per tick. Only home ever has more than one in
      // BN1 (purchased servers are always single-core), but reading it rather
      // than special-casing 'home' keeps this correct in BitNodes and
      // Source-File levels where that is not true.
      const cores = {}
      let totalRam = 0
      let usedRam = 0
      for (const h of hosts) {
        const max = ns.getServerMaxRam(h)
        const used = ns.getServerUsedRam(h)
        totalRam += max
        usedRam += used
        cores[h] = ns.getServer(h).cpuCores
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
          // How many targets to run.
          //
          // Utilisation is a red herring here, and that is the whole finding.
          // Measured on the live 448TB fleet over 180 minutes, 3 seeds, as the
          // target count rises the fleet gets *less* busy and earns *more*:
          //
          //     targets    earned      fleet utilisation
          //           1   $1,151b            87%
          //           2   $1,218b            85%
          //           3   $1,957b            72%   <- what shipped
          //           4   $2,467b            67%
          //           6   $2,666b            61%
          //           8   $2,795b            63%   <- best, +43% over 3
          //          12   $2,569b            63%
          //          16   $2,386b            64%
          //
          // So a target is limited by its own money throughput, not by the RAM
          // pointed at it: one target will happily absorb 390TB and still earn
          // a third of what eight targets earn on the same fleet. Idle RAM is
          // Quality floors first, both scale-free ratios so neither goes stale
          // as the fleet or hacking level grows.
          const bestScore = ranked.length ? ranked[0].s : 0
          const bestMoney = ranked.reduce((m, r) => Math.max(m, r.t.maxMoney), 0)
          const worthwhile = ranked.filter(
            (r) => r.s >= bestScore * SETTINGS.minScoreFrac && r.t.maxMoney >= bestMoney * SETTINGS.minMoneyFrac,
          )

          // How many to run: argmax of a derived income model, not a constant.
          //
          // A target earns `plan.money / period`, and the dispatcher below sets
          // `period = max(4e, weakenTime / floor(share/plan.gb))` with
          // `share = totalRam/n` — an EVEN split. Substituting gives income per
          // target that is piecewise-linear in RAM:
          //
          //   income_i(share) = min( money_i/(4e),
          //                          share * money_i / (gb_i * 4*hackTime_i) )
          //
          // linear until the pipeline is full at the tightest legal period,
          // flat after. Two consequences, both measured in
          // docs/target-count.md, which reproduces the recorded sweep exactly:
          //
          //   * while nothing is saturated, income(n) = totalRam *
          //     mean(rate_1..rate_n), and that mean FALLS with each target
          //     added — so one target is optimal and splitting is a pure loss.
          //     At 32TB, eight targets earned half of one.
          //   * once the head saturates its marginal share earns nothing, and
          //     the next target — however much worse — beats it.
          //
          // A ratio cannot express that: saturation RAM spans 35x across the
          // real target list, and a constant is also blind to spacing (worth
          // ~10% at e=50), to hacking level, and to target quality.
          //
          // Cost is 28 planBatch calls and under 1ms per retarget, measured in
          // tools/sim/verify-argmax.mjs against this file's own planBatch —
          // including a target with phi ~ 1e-6 where hMax exceeds a million and
          // the exponential h-sweep still finishes in ~50 steps.
          const cand = (worthwhile.length ? worthwhile : ranked).slice(0, SETTINGS.maxTargets)
          let bestN = 1
          let bestInc = -1
          for (let n = 1; n <= cand.length; n++) {
            // `slice`, not `share`: a local named `share` is billed as
            // ns.share() — 2.40GB of batch.js's 11.20GB, for a variable.
            const slice = totalRam / n
            let inc = 0
            for (let i = 0; i < n; i++) {
              const p = planBatch(cand[i].t, ram, slice / 4)
              if (!p) continue
              inc += Math.min(
                p.money / (4 * SETTINGS.spacing),
                (slice * p.money) / (p.gb * cand[i].t.hackTime * 4),
              )
            }
            if (inc > bestInc) {
              bestInc = inc
              bestN = n
            }
          }
          want = cand.slice(0, Math.max(1, bestN)).map((r) => r.t.host)
        }
        // Never abandon a pipeline mid-flight: keep any dropped target that
        // still has operations in the air, and let it drain on its own.
        //
        // "Drain" has to be enforced, not assumed. A kept target is still in
        // `targets`, so the dispatcher below happily launches fresh batches for
        // it, which renews lastLanding and keeps it alive indefinitely — a
        // target can never actually be dropped. n00dles survived three
        // consecutive retargets that excluded it and took 34% of all batches
        // while six megacorps starved in prep. Marking the phase makes the
        // retention mean what it says.
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

          // Prep, in two strict phases: security to the floor first, money
          // second. Never both at once.
          //
          // Growing a server whose security is above minimum is a trap twice
          // over. The growth constant k falls as security rises, so the same
          // money costs 3-6x the threads; and a big grow fortifies by
          // 2*0.002 per used thread, so if the matching weaken does not fit in
          // what is left of the budget, security ratchets *up* and the next
          // round is more expensive still. Observed live: silver-helix reached
          // security 61.2 against a minimum of 10 and never recovered, while
          // the grow threads it demanded starved the one target that was
          // actually batching.
          //
          // The ledger of in-flight work is timed with the CURRENT-security
          // durations. Timing it with the prepped figures — as this did — expires
          // entries several times too early, so prep re-launches on top of work
          // still in the air and compounds the same ratchet.
          const weakenTimeNow = t.hackTimeNow * 4
          const growTimeNow = t.hackTimeNow * 3.2

          s.pending = s.pending.filter((p) => p.at > now)
          let pendW = 0
          let pendG = 0
          for (const p of s.pending) {
            pendW += p.weaken || 0
            pendG += p.grow || 0
          }
          // A grow fortifies only by the threads it actually *used*
          // (processSingleServerGrowth caps usedCycles at the threads needed),
          // so projecting from the raw in-flight thread count is an unbounded
          // overestimate that makes prep launch weakens forever.
          const kNow = t.kNow
          const needNow = t.money >= t.maxMoney ? 0 : growThreads(t.maxMoney, Math.max(t.money, 1), kNow, t.maxMoney)
          const usedG = Math.min(pendG, isFinite(needNow) ? needNow : pendG)
          const projSec = Math.max(t.minSec, t.sec - pendW + 2 * FORTIFY * usedG)

          // --- phase 1: security to the floor, and nothing else -------------
          if (projSec > t.minSec + 0.01) {
            const wShare = Math.floor(totalRam / Math.max(1, targets.length) / ram.weaken)
            const wNeed = Math.min(Math.ceil((projSec - t.minSec) / WEAKEN_PER_THREAD), wShare)
            const w = spread(ns, free, ram, 'weaken', host, wNeed, batchId++)
            if (w) {
              s.pending.push({ at: now + weakenTimeNow, weaken: w * WEAKEN_PER_THREAD })
              opsDispatched++
              threadsDispatched += w
            }
            continue
          }

          // --- phase 2: money, at minimum security --------------------------
          // Sized with k at the minimum, which is where these threads will
          // land. Weaken is launched BEFORE grow and sized to cover it, so the
          // cover always exists even if the grow only partly fits — the failure
          // direction is then over-weakening, which is free.
          const kMin = t.k
          const projMoney = pendG > 0 ? Math.min(t.maxMoney, (t.money + pendG) * Math.exp(kMin * pendG)) : t.money
          const gNeed = projMoney >= t.maxMoney ? 0 : growThreads(t.maxMoney, Math.max(projMoney, 1), kMin, t.maxMoney)
          // Cap each target's prep at its share of the fleet. Without this the
          // first target in the ranking takes every free byte and the rest prep
          // strictly after it — with eight targets that serialises the whole
          // startup into eight consecutive prep cycles.
          const budget = Math.min(
            [...free.values()].reduce((a, b) => a + b, 0),
            totalRam / Math.max(1, targets.length),
          )
          // One weaken thread cancels 0.05 of security; one grow thread adds
          // 2*0.002. So a grow needs 0.08 weaken threads alongside it.
          const perGrow = ram.grow + 0.08 * ram.weaken
          let gWant = Math.min(gNeed, Math.floor(budget / perGrow))
          if (!isFinite(gWant) || gWant < 0) gWant = 0

          const wCover = gWant >= 1 ? Math.ceil(0.08 * gWant) + 1 : 0
          const wLaunched = wCover >= 1 ? spread(ns, free, ram, 'weaken', host, wCover, batchId++) : 0
          const gLaunched = gWant >= 1 ? spread(ns, free, ram, 'grow', host, gWant, batchId++) : 0

          if (gLaunched) s.pending.push({ at: now + growTimeNow, grow: gLaunched })
          if (wLaunched) s.pending.push({ at: now + weakenTimeNow, weaken: wLaunched * WEAKEN_PER_THREAD })
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

        const slice = totalRam / Math.max(1, targets.length)
        // The largest single free block, which is the real ceiling on the hack
        // op — place() cannot split it. Recomputed every tick because blocks
        // shrink as batches launch.
        const largestBlock = free.size ? Math.max(...free.values()) : 0
        const plan = planBatch(t, ram, slice / 4, largestBlock)
        if (!plan) continue
        const maxInFlight = Math.max(1, Math.floor(slice / plan.gb))
        const period = Math.max(4 * SETTINGS.spacing, weakenTime / maxInFlight)
        s.plan = plan
        s.period = period
        // What this pipeline will claim over the next weakenTime, which is how
        // long a spill weaken holds its RAM — so it is the right thing to hold
        // back from spill.
        reserved += Math.min(slice, Math.ceil(weakenTime / period) * plan.gb)

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

        const placed = place(free, ops, ram, cores)
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
        // Same bytes as before: `status` already carries `at`, `health`,
        // `controller` and `errors`, and the reporter lets the caller's fields
        // win, so this publishes the identical body and merely routes it
        // through the one function the atExit above also uses.
        note(health, status)
        mirror()
        if (!flags.quiet) ns.print(`${health} | ${targets.join(',')} | ${batches} batches | ${Math.round(earned / 1e6)}m earned`)
      }
    } catch (err) {
      // Never die. A bad tick is recoverable; a dead controller is not.
      //
      // record() is the same bounded push this line always did (status.js:149,
      // keep = 20), with one addition: describe(err) carries the first few
      // stack frames, so the ReferenceError incident below would have named its
      // site instead of only its type.
      record(errors, err)
      // ALWAYS surface the failure. The status write lives at the end of the
      // try, so a throw anywhere earlier skipped it and the error log — the
      // only record of what went wrong — was never written. A ReferenceError
      // from a bad edit then looked exactly like a hang: process alive, no
      // error, telemetry frozen at the last good tick for 23 minutes. The
      // diagnostic must not share a failure path with the thing it diagnoses.
      try {
        note('error', { detail: describe(err) })
        mirror()
      } catch {
        /* nothing left to try */
      }
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
