// HWGW batch controller.
//
//   run batch.js                        whole fleet, targets chosen automatically
//   run batch.js --hosts pserv-1,pserv-2   only those hosts (rollback / A-B)
//   run batch.js --targets 1            pin the target count instead of deriving it
//   run batch.js --nocal                plan with the raw model, no yield correction
//   run batch.js --nocalrestore         ignore any persisted calibration
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
// A third choice was added later, and it is the one that makes this file
// correct in a BitNode it is not allowed to read:
//
//   * The hack fraction is MEASURED, not only computed. The game's own
//     calculatePercentMoneyHacked carries `currentNodeMults.ScriptHackMoney`,
//     which needs Source-File 5 to read and is 0.2 in BitNode 4. So the
//     controller compares the money each of its hacks actually removed against
//     what its model said that same hack would remove, and corrects by the
//     ratio. `h` and the pre-hack balance both cancel out of that ratio, so it
//     measures exactly the missing multiplier and nothing else — see
//     yieldRatio() for the derivation and for why the loop settles. The check
//     on the whole idea is that the same number must read 1.0 once
//     Formulas.exe is owned, because attachMath then takes phi from the game's
//     own formula with every multiplier already in it. /tel/batch.txt publishes
//     which of the two it is seeing.
//
// And the failure path is the point, not an afterthought: if a target's
// security climbs or its money falls past tolerance, the controller stops
// launching, lets everything in flight land, and re-preps. Nothing tries to
// rescue a desynced pipeline in place. That always terminates, and it is why
// this can be left running unattended.

// Free to import: status.js references only ns.write (0GB). See its header.
import { enter as traceEnter, leave as traceLeave } from 'trace.js'
import { reporter, describe, record } from 'status.js'
// Pure arithmetic over getResetInfo's output; no ns surface of its own.
import { singularityRamMultiplier } from 'sfgate.js'
// Pure: whether a hacknet SERVER's RAM may be used (hacknet.js's ramPolicy).
import { hacknetHostAllowed, isHacknetServerHost } from 'hacknetplan.js'
// Pure: the stock trader's record and which side of a batch it wants to move
// its stock (nodeecon.js documents the /tel/stock.txt `manip` interface).
import { stockRecordOf, stockFlagFor, STOCK_FILE } from 'nodeecon.js'
// Pure: exp-per-GB-second scoring, wave sizing and the manip verdict
// (expfarm.js), the node table, and the exit simulator the verdict runs.
import { portTiers, expMode, expScore, batchedScore, expPerThread, waveSize, wavePeriod, manipVerdict, manipBlocker, manipUnservableWhy, FORTIFY as EXP_FORTIFY, WEAKEN_AMOUNT as EXP_WEAKEN } from 'expfarm.js'
import { bitNodeMults } from 'bitNodeMultipliers.js'
import { bestExitPolicy } from 'exitplan.js'

/**
 * STOCK MANIPULATION, as a service to the trader. hack/grow take {stock: true}
 * (NetscriptHelpers.tsx:668-669, NetscriptFunctions.ts:301-302), which nudges
 * the server's company forecast down (hack) or up (grow) with chance equal to
 * the fraction of moneyMax moved. The trader publishes `manip: {host: 'hack'
 * |'grow'}`; batches against those hosts carry the flag on that ONE side
 * (h.js/g.js 4th argument). Refreshed with the targets; a stale or other-life
 * record flags nothing. Hosts the trader wants that this batcher does not
 * target are published as `unserved`, not silently dropped — the batcher
 * still chooses targets by its own objective.
 */
let stockManip = null
let stockCurve = null
function refreshStockManip(ns) {
  try {
    const rec = stockRecordOf(JSON.parse(ns.read(STOCK_FILE) || 'null'), ns.getResetInfo().lastAugReset)
    stockManip = rec.ok && rec.manip && Object.keys(rec.manip).length ? rec.manip : null
    stockCurve = rec.ok ? rec.manipCurve : null
  } catch {
    stockManip = null
    stockCurve = null
  }
}

// ---------------------------------------------------------------------------
// THE EXP FARM (expfarm.js has the game's rules and the derivation). Active
// only where scripted hacking pays nothing (expMode: ScriptHackMoneyGain 0,
// BitNode 8); every other node never enters it and batches for money exactly
// as before. The fleet then runs WAVES on the best exp target — a padded
// weaken and a 1-thread grow launched early, and hack chunks launched by this
// loop at L - hackTimeNow with NO pad, so a hack holds RAM for one hack time
// instead of a weaken time — and the ordinary HWGW batcher runs only on the
// trader's manip hosts, and only when expfarm.manipVerdict prices serving
// them as a shorter exit than farming exp with that RAM.
// ---------------------------------------------------------------------------
const FARM_GAP_MS = 400 // landing gap between G | H | W of one wave
export const farm = {
  on: false,
  weakenRate: 1,
  target: null,
  score: 0,
  waves: [], // { L, hack, launched, skipped }
  nextCreate: 0,
  nextPrep: 0,
  held: [], // { gb, until }
  hackThreads: 0,
  hackThreadsWindowStart: Date.now(),
  launchedWaves: 0,
  lastLaunch: 0,
  skippedWaves: 0,
  prepping: false,
  ranked: [],
  manip: null,
  why: null,
}

/** Launch `want` threads of `op` in processes of at most `chunk` threads; returns threads launched. */
function spreadChunks(ns, free, ram, op, target, want, chunk, nextId, stockFlag = 0) {
  let launched = 0
  const per = ram[op]
  for (const [host, gb] of [...free.entries()].sort((a, b) => b[1] - a[1])) {
    let room = gb
    while (launched < want) {
      const take = Math.min(want - launched, chunk, Math.floor(room / per))
      if (take < 1) break
      const pid = ns.exec(SETTINGS.workers[op], host, { threads: take, temporary: true }, target, 0, nextId(), stockFlag)
      if (!pid) break
      room -= take * per
      launched += take
    }
    free.set(host, room)
    if (launched >= want) break
  }
  return launched
}

/** Rank exp targets (expScore at min security), excluding the trader's manip hosts. */
function rankExpTargets(ns, readT, level) {
  const out = []
  // Every other server too, scored as if rooted, for the port-opener verdict
  // (expfarm.portTiers -> progress.js spendExit.programs).
  const all = []
  for (const h of scanAll(ns)) {
    if (h === 'home') continue
    const srv = ns.getServer(h)
    if (srv.purchasedByPlayer) continue
    const rooted = ns.hasRootAccess(h)
    let s = 0
    if (ns.getServerMaxMoney(h) > 0 && ns.getServerRequiredHackingLevel(h) <= level && !(stockManip && stockManip[h])) {
      const t = readT(h)
      t.baseDifficulty = srv.baseDifficulty
      s = expScore(t, farm.weakenRate)
      if (rooted && s > 0) out.push({ t, s })
    }
    all.push({ host: h, ports: srv.numOpenPortsRequired, ramGB: srv.maxRam, rooted, score: s })
  }
  farm.servers = all
  return out.sort((a, b) => b.s - a.s)
}

/**
 * The manip hosts' cost and delivery at saturation (planBatch, the batcher's
 * own sizing): the nudge rate (fraction of moneyMax moved per second — the
 * chance per op is moneyMoved/moneyMax, PlayerInfluencing.ts:24-58), the RAM
 * their pipelines hold, and the exp per GB-ms that RAM earns batched.
 */
function manipCost(ns, readT, ram, level, capacity) {
  let nu = 0
  let gb = 0
  let expGbms = 0
  const hosts = []
  const blocked = []
  const known = new Set(scanAll(ns)) // scan is already billed; serverExists would add 0.1GB
  for (const h of Object.keys(stockManip ?? {})) {
    // Each skip is NAMED (expfarm.manipBlocker): a silent skip published as
    // "no manip requested" while stock.txt plainly requested vitalife.
    const exists = known.has(h)
    const why = manipBlocker(h, exists ? { root: ns.hasRootAccess(h), maxMoney: ns.getServerMaxMoney(h), required: ns.getServerRequiredHackingLevel(h), level } : { exists: false })
    if (why) {
      blocked.push(why)
      continue
    }
    const t = readT(h)
    t.baseDifficulty = ns.getServer(h).baseDifficulty
    const p = planBatch(t, ram, capacity / 4, capacity)
    if (!p) {
      blocked.push(`${h}: no batch fits the fleet (planBatch)`)
      continue
    }
    const perSec = 1000 / (4 * SETTINGS.spacing)
    const held = (p.gb * (t.hackTime * 4)) / (4 * SETTINGS.spacing)
    nu += p.f * t.chance * perSec
    gb += held
    expGbms += batchedScore(t) * held
    hosts.push(h)
  }
  return { hosts, blocked, nu, gb, batchRate: gb > 0 ? expGbms / gb : 0 }
}

/** One tick of the farm: prep, create waves, launch due hacks. */
export function farmTick(ns, free, ram, now, nextId) {
  const tgt = farm.target
  if (!tgt) return
  const sec = ns.getServerSecurityLevel(tgt.host)
  const minSec = tgt.minSec
  const hT = ns.getHackTime(tgt.host) // at CURRENT security: the real duration of a launch now
  farm.held = farm.held.filter((x) => x.until > now)
  const heldGB = farm.held.reduce((a, x) => a + x.gb, 0)
  const freeGB = [...free.values()].reduce((a, b) => a + b, 0)
  const pool = heldGB + freeGB
  const tol = 0.05

  // PREP: security to the floor first (weaken pays full exp while it does).
  if (sec > minSec + tol && !farm.waves.length) {
    farm.prepping = true
    if (now < farm.nextPrep) return
    farm.nextPrep = now + hT * 4 + 200
    const need = Math.ceil(((sec - minSec) / (EXP_WEAKEN * farm.weakenRate)) * 1.1)
    const all = Math.floor(freeGB / ram.weaken)
    const n = spreadChunks(ns, free, ram, 'weaken', tgt.host, Math.max(need, all), 1e9, nextId)
    if (n > 0) farm.held.push({ gb: n * ram.weaken, until: now + hT * 4 })
    return
  }
  farm.prepping = false

  const T = tgt.hackTime
  const wr = farm.weakenRate
  const period = wavePeriod({ poolGB: pool, T, phi: tgt.phi, chance: tgt.chance, weakenRate: wr }) ?? 1000
  const plan = waveSize({ poolGB: pool, T, periodMs: Math.max(period, 3 * FARM_GAP_MS + 300), phi: tgt.phi, chance: tgt.chance, weakenRate: wr })
  if (!plan) {
    farm.why = 'pool too small for one hack thread per wave'
    return
  }
  farm.why = null

  // CREATE a wave: its weaken (pad 0, lands at L + gap) and its 1-thread grow
  // (lands at L - gap), both timed from the CURRENT security's durations, and
  // only while security is at the floor so those durations are the real ones.
  if (now >= farm.nextCreate && sec <= minSec + tol) {
    const wT = hT * 4
    const L = now + wT - FARM_GAP_MS
    const last = farm.waves.length ? farm.waves[farm.waves.length - 1].L : -Infinity
    if (L >= last + plan.periodMs * 0.9) {
      const w = spreadChunks(ns, free, ram, 'weaken', tgt.host, plan.weaken, 1e9, nextId)
      if (w > 0) {
        farm.held.push({ gb: w * ram.weaken, until: now + wT })
        const gPad = Math.max(0, Math.round(L - FARM_GAP_MS - now - hT * 3.2))
        for (const [host, gb] of free) {
          if (gb < ram.grow) continue
          if (ns.exec(SETTINGS.workers.grow, host, { threads: 1, temporary: true }, tgt.host, gPad, nextId(), 0)) {
            free.set(host, gb - ram.grow)
            break
          }
        }
        // The hacks this wave's weaken can cover (0.002 x chance per thread, margined).
        const cover = Math.floor((w * EXP_WEAKEN * farm.weakenRate) / (EXP_FORTIFY * 1.1))
        farm.waves.push({ L, hack: Math.min(plan.hack, cover), chunk: plan.chunkMax, launched: 0, skipped: false })
      }
      farm.nextCreate = now + plan.periodMs
    }
  }

  // LAUNCH due hacks: when now + hackTimeNow reaches L. A wave whose hack would
  // land outside [L - gap/2, L + gap/2] — security moved, or the loop was late —
  // is skipped: its weaken and grow still land and still pay.
  const keep = []
  for (const wv of farm.waves) {
    const land = now + hT
    if (!wv.launched && !wv.skipped) {
      if (land > wv.L + FARM_GAP_MS / 2) {
        wv.skipped = true
        farm.skippedWaves++
      } else if (land >= wv.L - FARM_GAP_MS / 2) {
        const n = spreadChunks(ns, free, ram, 'hack', tgt.host, wv.hack, wv.chunk, nextId)
        wv.launched = n
        if (n > 0) {
          farm.held.push({ gb: n * ram.hack, until: land })
          farm.hackThreads += n
          farm.launchedWaves++
          farm.lastLaunch = now
        } else {
          wv.skipped = true
          farm.skippedWaves++
        }
      }
    }
    if (wv.L + FARM_GAP_MS > now) keep.push(wv)
  }
  farm.waves = keep
}

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
  // Minimum hack threads to plan for. Below this the fixed w1/w2 overhead
  // dominates and income collapses; above ~15 the $/GB curve is flat within 7%.
  // See the limit-cycle note at the planBatch call site.
  hackFloor: 20,
  selfReserve: 6,
  // 4 -> 56. Home is where every SINGULARITY job has to run, and those are the
  // most expensive scripts in the stack precisely because Singularity calls are
  // priced per function: progress.js raises to 43.05GB on its acting path, and
  // at a 4GB reserve the batcher had taken home down to 11.4GB free with the
  // fleet's largest block at 32GB, so the raise was denied everywhere.
  //
  // A denied raise is the worst shape of failure available here: ns.ramOverride
  // returns the OLD allocation rather than throwing (NetscriptFunctions.ts:
  // 1210-1214), so without ramgrow.js's explicit check the script would have
  // carried on at 2.6GB and died at the first Singularity call with no
  // diagnosis. The batcher quietly eating the reputation loop is exactly the
  // failure that left this run nine hours into BitNode 4 with zero factions.
  //
  // 56 = progress.js's 43.05GB ceiling plus headroom for the rest of the
  // resident stack to keep its own margins. The cost is ~1.4% of a 512GB home
  // and it buys the only channel that converts money into permanent progress.
  //
  // THAT CONSTANT WAS MEASURED INSIDE BITNODE 4, and Singularity RAM is priced
  // per Source-File level: 1x inside BN4, but 16x at SF4.1, 4x at SF4.2
  // (RamCostGenerator.ts:82-96, sfgate.js:71-77). progress.js's ceiling is
  // therefore 43.05GB there and 1188.85GB here — 27x this reserve — so the
  // number was silently wrong the moment the run left the node it was measured
  // in, and the batcher took home to 62GB free of 2,097,152GB. progress.js
  // then failed to raise for eight straight cycles.
  //
  // The comment above already predicted this exact outcome ("the batcher
  // quietly eating the reputation loop is exactly the failure that left this
  // run nine hours into BitNode 4 with zero factions") and it happened again
  // one regime later, because the diagnosis was right and the FIX was a
  // constant. A constant cannot be right in a quantity that moves by 16x.
  //
  // So it is a function of the multiplier now. The coefficients mirror
  // progress.js's own RAISE_CEILING and [R6] asserts they still cover it in
  // every regime — checked duplication rather than an import, because pulling
  // progress.js in here would drag its entire Singularity import graph into
  // the batcher's own price.
  // 13 + the largest single actor (snap-static.js: 3.25 + 6 x mult, 99GB at
  // SF4.1) so a snapshot or an install always has somewhere to run on home.
  homeReserve: (mult) => 13 + 6.25 * mult,
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
  // --- self-calibration of the hack yield ----------------------------------
  //
  // See yieldRatio() below for the derivation. These are the knobs; every one
  // of them is a measurement knob, not a control gain, because the estimator is
  // open loop (the quantity it measures does not depend on the correction it
  // produces).
  cal: {
    on: true,
    // Samples retained. Each is an exact reading of the ratio, so this is a
    // contamination window, not an averaging window.
    keep: 128,
    // Below this the estimate is not used at all and the plan is the
    // uncorrected one, which is exactly today's behaviour.
    minN: 12,
    // Point estimate is an UPPER quantile, never the mean. Every way a sample
    // can be corrupted biases it high, and high is the safe side (see below).
    q: 0.75,
    // Max fractional decrease per second. Upward moves are instant because
    // upward is always safe. 0.01/s takes 161s to go 1.0 -> 0.2.
    fallPerSec: 0.01,
    // ScriptHackMoney is <= 1 in every BitNode in the table, and with
    // Formulas.exe the true ratio is 1 by construction, so 1 is a hard ceiling
    // and hitting it is itself a reportable event.
    lo: 1e-4,
    hi: 1,
    // A landing that drained essentially the whole balance hit the game's
    // `moneyDrained > moneyAvailable` clamp, so it reads LOW and must not be
    // used as a sample. It also means the correction is too low; that is the
    // one unsafe direction, so it forces an immediate step up.
    fMax: 0.98,
    // (p90-p10)/p50 past which the estimate is called unstable and published as
    // such. A clean sample stream has spread 0 — see yieldRatio().
    spreadWarn: 0.1,
    // Disagreement with Formulas.exe past this fraction is an outright error:
    // with Formulas present the measured ratio must be 1.
    formulasTol: 0.05,
    // Carry the learned value across a restart. Fenced by a server fingerprint
    // that survives a restart and breaks across an install or a BitNode change
    // (Prestige.ts:98 re-randomises every foreign server on both).
    file: '/tel/batch-cal.txt',
    restore: true,
  },
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
//
// ONE TERM IS STILL MISSING, DELIBERATELY, AND IS MEASURED INSTEAD.
// The game's own calculatePercentMoneyHacked also multiplies by
// `currentNodeMults.ScriptHackMoney` (Hacking.ts:54), which is 0.2 in BitNode
// 4 and ranges 0.1..1 across the table. Reading it needs
// ns.getBitNodeMultipliers(), which throws without Source-File 5, so this file
// cannot ask for it. Left uncorrected it made every plan take five times what
// it could actually take and over-grow to replace money that was never
// removed: $869k realised against $2.7m planned, for hours.
//
// It is not readable but it IS observable — the controller watches the target's
// balance fall by exactly the amount its own hack removed. yieldRatio() below
// turns that into a measurement of the missing factor. hackFraction therefore
// stays the pure port of the formula this file CAN evaluate, and the node term
// is applied on top of it in attachMath. Keeping them separate is what makes
// the measurement meaningful: the sampler divides by this uncorrected value.
//
// The second node multiplier on the hack path, `ScriptHackMoneyGain`
// (NetscriptHelpers.tsx:648), scales what the PLAYER receives from a drain
// rather than what leaves the server. It is 1 in every BitNode except 8, where
// it is 0. So `earned` below — which is accumulated from balance drops — is
// server drain, and equals player income everywhere except BitNode 8, where
// scripted hacking pays literally nothing and this whole controller is the
// wrong tool. Not modelled; named here so it is not rediscovered.

/** calculatePercentMoneyHacked (Hacking.ts:44-56) WITHOUT the node term: see above. */
export function hackFraction(level, required, minSec, mults) {
  if (minSec >= 100) return 0
  const difficultyMult = (100 - minSec) / 100
  const skillMult = (level - (required - 1)) / level
  return Math.min(1, Math.max(0, (difficultyMult * skillMult * mults.money) / 240))
}

/** calculateHackingChance (Hacking.ts:9-24), intelligence term included:
 *  x (1 + int^0.8 / 600) (intelligence.ts:1, weight 1). Omitted until
 *  2026-09-19 — 4.5% at intelligence 61 — which only the Formulas-less
 *  fallback ever felt; with Source-File 5 Formulas.exe is permanent and the
 *  live branch above is the game's own function. */
export function hackChance(level, required, minSec, mults, intelligence = 0) {
  if (minSec >= 100) return 0
  const skillMult = Math.max(1.75 * level, 1)
  const intBonus = 1 + Math.pow(Math.max(0, intelligence), 0.8) / 600
  return Math.min(1, Math.max(0, ((skillMult - required) / skillMult) * ((100 - minSec) / 100) * mults.chance * intBonus))
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

/**
 * Robust estimator of the HACK YIELD RATIO, and the whole reason this file can
 * be right in a BitNode whose multipliers it is not allowed to read.
 *
 * ---------------------------------------------------------------------------
 * What is being measured, and why it is one number rather than a fudge factor.
 *
 * Let phi0 be what this file's model says one hack thread takes at minimum
 * security, and phi* what the game actually takes. Define
 *
 *     Y = phi* / phi0
 *
 * Those two expressions (src/Hacking.ts:44-56 vs hackFraction above) are
 * identical term for term — same difficultyMult, same skillMult, same
 * `person.mults.hacking_money`, same /240, same clamp — EXCEPT that the game
 * also multiplies by `currentNodeMults.ScriptHackMoney` and this file cannot.
 * Every other factor is read live from the game each tick, so it cancels. So
 *
 *     Y == currentNodeMults.ScriptHackMoney     exactly, when the fallback
 *                                               ports are in use, and
 *     Y == 1                                    exactly, when Formulas.exe is
 *                                               owned and attachMath takes phi
 *                                               from ns.formulas.hacking.
 *
 * That second identity is the self-check: the same mechanism, unchanged, must
 * read 1.0 the moment Formulas.exe is bought. If it does not, one of the
 * assumptions below is false and the estimate is not what it claims to be.
 *
 * ---------------------------------------------------------------------------
 * The sample, and what is deliberately NOT in it.
 *
 * When a hack lands the game does (NetscriptHelpers.tsx:628-645)
 *
 *     drain = moneyAvailable * phi* * threads      clamped to moneyAvailable
 *
 * — linear in threads, evaluated against the balance AT LANDING. So for a
 * single landing that did not hit the clamp,
 *
 *     x = drain / (moneyBefore * phi0 * h) = phi* / phi0 = Y
 *
 * `h` cancels. `moneyBefore` cancels. `moneyMax` never appears. Which means:
 *
 *   * hack CHANCE is not in x. A failed hack produces no drain at all, so
 *     conditioning on "money fell" conditions on success — the chance term
 *     divides out instead of being counted twice. planBatch already models it
 *     separately (`p.money = f * maxMoney * chance`) and still does. The
 *     observed success rate is published alongside as an INDEPENDENT check of
 *     that term, and is never folded into Y.
 *   * placeFails / execFails / partials / unsafeSkips are not in x. A flight
 *     record exists only for a batch every one of whose execs succeeded, so
 *     those change how many samples arrive and nothing else.
 *   * drains are not in x. Operations already in the air still land and are
 *     still sampled; a drain only interrupts new launches.
 *   * money below moneyMax is not in x. The denominator uses the measured
 *     pre-landing balance, not maxMoney.
 *   * a changing plan is not in x. The denominator uses the `h` THAT BATCH was
 *     launched with, recorded at launch, not the plan in force now. (On the
 *     live save the published plan said h=20 while a 34-thread hack from an
 *     earlier, lower-level tick was still in flight.)
 *
 * x is therefore DETERMINISTIC, not noisy: every clean sample equals Y to
 * floating-point. The statistic that matters is consequently the SPREAD — a
 * non-zero spread means an identification assumption broke, and is published.
 *
 * ---------------------------------------------------------------------------
 * Why it settles, and why there is no gain to tune.
 *
 * This looks like a feedback loop and is not one. The correction y sets the
 * plan, the plan sets h, and h then cancels out of the measurement. Nothing the
 * controller does changes the quantity being measured, so there is no loop gain
 * and no oscillation mode; it is an open-loop estimator of a constant driving a
 * rate-limited actuator.
 *
 * The one direction that matters is which side of Y you approach from:
 *
 *   y > Y  -> the plan under-hacks (realised fraction is (Y/y)*f), grow
 *             over-delivers, the target stays pinned at max money. This is
 *             exactly today's behaviour at y = 1, which has been running for
 *             hours.
 *   y < Y  -> the plan over-hacks, grow is under-sized, and the error
 *             integrates: servers have no passive regrowth.
 *
 * So the estimator is built to approach Y from ABOVE and stay there:
 *
 *   1. it starts at hi = 1, and ScriptHackMoney <= 1 in every BitNode, so the
 *      cold start is >= Y everywhere;
 *   2. the point estimate is an upper quantile of the window, and every way a
 *      sample can be corrupted (a read window that caught a grow as well as a
 *      hack, an understated moneyBefore) biases it UP;
 *   3. y may rise instantly and may fall only fallPerSec per second, so
 *      y(t) = max(target, y0*exp(-r*t)) — monotone, no overshoot, arriving in
 *      ln(y0/Y)/r seconds;
 *   4. the only nonlinearity, the game's `drain > moneyAvailable` clamp, cannot
 *      be reached from above: planBatch caps f = phi0*y*h <= 0.99 and the
 *      realised fraction is (Y/y)*f <= f whenever y >= Y. If a clamped landing
 *      is nonetheless seen, that is proof y < Y and `raise` steps it back up
 *      immediately, which is the safe direction and so needs no damping.
 *
 * Pure: no ns, no clock, no globals. Exported so tools/sim can drive it with
 * synthetic landings at a known multiplier.
 */
export function yieldRatio(cfg = {}) {
  const c = { keep: 128, minN: 12, q: 0.75, fallPerSec: 0.01, lo: 1e-4, hi: 1, ...cfg }
  const buf = []
  let y = c.hi
  let seen = 0
  let src = 'cold'
  const bound = (v) => Math.min(c.hi, Math.max(c.lo, v))
  const quant = (p) => {
    if (!buf.length) return null
    const ord = [...buf].sort((u, v) => u - v)
    return ord[Math.min(ord.length - 1, Math.max(0, Math.round(p * (ord.length - 1))))]
  }
  return {
    /** Record one clean landing. Returns false for anything unusable. */
    add(x) {
      if (!(x > 0) || !isFinite(x)) return false
      buf.push(x)
      while (buf.length > c.keep) buf.shift()
      seen++
      return true
    },
    /** Force the estimate up. Always safe, so no rate limit and no quorum. */
    raise(v) {
      if (v > y) {
        y = bound(v)
        src = 'raised'
      }
      return y
    },
    /**
     * Move y toward the current point estimate.
     *
     * Asymmetric on purpose, and the asymmetry is the safety argument rather
     * than a tuning choice. RISING means planning to take LESS than the model
     * says, which is what this controller has been doing all along and cannot
     * desync anything — so it is allowed immediately and on any number of
     * samples, which is what lets a restored-too-low value recover on its first
     * landing instead of after a quorum. FALLING means planning to take more,
     * which is the direction that integrates if it is wrong, so it needs both a
     * quorum and a rate limit.
     */
    step(dtSec) {
      if (!buf.length) return y
      const tgt = bound(quant(c.q))
      if (tgt >= y) {
        y = tgt
        src = 'measured'
        return y
      }
      if (buf.length < c.minN) return y
      y = Math.max(tgt, y * Math.exp(-c.fallPerSec * Math.max(0, dtSec)))
      src = 'measured'
      return y
    },
    /** Adopt a value from outside (a restored file). */
    seed(v, why) {
      y = bound(v)
      src = why
      return y
    },
    /** Throw the window away — the model underneath it changed. */
    forget(why) {
      buf.length = 0
      y = c.hi
      seen = 0
      src = why
      return y
    },
    val: () => y,
    /** Everything a reader needs to decide whether to believe y. */
    stat() {
      const p10 = quant(0.1)
      const p50 = quant(0.5)
      const p90 = quant(0.9)
      const r4 = (v) => (v === null ? null : Math.round(v * 1e4) / 1e4)
      return {
        y: r4(y),
        src,
        n: buf.length,
        seen,
        p10: r4(p10),
        p50: r4(p50),
        p90: r4(p90),
        spread: p50 ? Math.round(((p90 - p10) / p50) * 1e4) / 1e4 : null,
      }
    },
  }
}

/**
 * Turn one tick's balance change on one target into a verdict about the yield.
 *
 * This is the attribution, and it is deliberately separate from both the ns I/O
 * and the estimator so it can be driven offline with landings whose answer is
 * known. It mutates only the per-target counters on `s` and returns what it
 * decided; the caller applies that to the estimator.
 *
 * `s` carries:
 *   flight[]  {at, h, m} per launched batch, captured AT LAUNCH
 *   calPend   a landing given one extra tick to show its drop
 *   lastMoney the balance read on the PREVIOUS tick, i.e. before this change
 *
 * Verdicts:
 *   sample  x is a reading of phi_true/phi_model — see yieldRatio()
 *   miss    a landing resolved with no drop: the hack rolled a failure
 *   clamp   the drain hit the game's moneyAvailable ceiling, so the reading is
 *           biased LOW and the correction in force is provably too small
 *   skip    the window could not isolate one landing; nothing is inferred
 *   none    nothing came due and nothing is waiting
 */
export function landingSample(s, phi0, at, dt, maxTickMs, dropped, fMax = 0.98, decay = 0.99) {
  // End-to-end bookkeeping, kept separately from the sampling and deliberately
  // NOT filtered by it: everything the plan promised for batches that have
  // landed, against everything that actually fell. Selecting it with the same
  // gate that selects the samples would make it agree with itself by
  // construction. Both sides are forgotten geometrically, once per landing, so
  // the published ratio is a recent one — a lifetime ratio would carry the
  // uncorrected opening of the run forever and never reach 1.
  if (dropped > 0) s.realLanded += dropped
  let due = 0
  let dueH = 0
  let kept = 0
  for (let i = 0; i < s.flight.length; i++) {
    const r = s.flight[i]
    if (r.at <= at) {
      due++
      dueH = r.h
      s.planLanded = s.planLanded * decay + r.m
      s.realLanded *= decay
    } else s.flight[kept++] = r
  }
  s.flight.length = kept

  // `at` is the controller's PREDICTION of the landing; the game's own timer
  // resolves on its cycle, so the balance can move one tick after the record
  // comes due. A landing therefore gets exactly one extra tick to show itself
  // before it is written off as a failed hack. Without this the sampler can
  // starve completely while publishing a plausible-looking success rate far
  // below the model's — a silent zero, which is the failure shape this repo
  // keeps producing.
  const pend = s.calPend
  s.calPend = null
  const clean = dt > 0 && dt <= maxTickMs
  if (due > 1 || (due === 1 && pend) || !clean) {
    const lost = due + (pend ? 1 : 0)
    s.calSkip += lost
    return { kind: lost ? 'skip' : 'none' }
  }
  if (dropped > 0) {
    const h = due === 1 ? dueH : pend ? pend.h : 0
    if (h < 1 || !(s.lastMoney > 0) || !(phi0 > 0)) {
      s.calSkip++
      return { kind: 'skip' }
    }
    const fObs = dropped / s.lastMoney
    if (fObs >= fMax) {
      s.calClamp++
      return { kind: 'clamp' }
    }
    const x = fObs / (phi0 * h)
    if (!(x > 0) || !isFinite(x)) {
      s.calSkip++
      return { kind: 'skip' }
    }
    s.calHits++
    s.calSum += x
    s.calN++
    s.calMin = s.calMin === null ? x : Math.min(s.calMin, x)
    s.calMax = s.calMax === null ? x : Math.max(s.calMax, x)
    return { kind: 'sample', x, h }
  }
  if (pend) s.calMiss++
  if (due === 1) {
    s.calPend = { h: dueH }
    return { kind: 'none' }
  }
  return { kind: pend ? 'miss' : 'none' }
}

/** Everything about a target that the planner needs, read once per tick. */
function readTarget(ns, host, y = 1) {
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
  }, y)
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
 *
 * `y` is the measured yield correction from yieldRatio() above. It is applied
 * HERE, in the one place phi is defined, so targetScore, planBatch and the
 * argmax all see the corrected value with no second application anywhere. The
 * uncorrected model value is kept as `t.phi0` because that — not `t.phi` — is
 * the denominator the sampler divides by; dividing by the corrected phi would
 * make the estimator a fixed point at whatever it already believed.
 *
 * `t.formulas` says which branch produced phi0, because the expected value of
 * y differs between them (1 with Formulas.exe, ScriptHackMoney without) and a
 * reader cannot tell the two apart from the number alone.
 */
function attachMath(ns, t, y = 1) {
  if ((t.formulas = ns.fileExists('Formulas.exe', 'home'))) {
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
    t.phi0 = f.hackPercent(srv, p)
    t.chance = f.hackChance(srv, p)
    // cores = 1 deliberately: this k is the single-core per-thread constant,
    // and place() scales thread counts by the executing host's core bonus.
    // Baking a host's cores in here would be wrong for every other host.
    t.k = Math.log(f.growPercent(srv, 1, p, 1))
    srv.hackDifficulty = Math.max(t.sec, t.minSec)
    t.kNow = Math.log(f.growPercent(srv, 1, p, 1))
  } else {
    t.phi0 = hackFraction(t.level, t.required, t.minSec, t.mults)
    t.chance = hackChance(t.level, t.required, t.minSec, t.mults, ns.getPlayer().skills?.intelligence ?? 0)
    t.k = growthK(t.minSec, t.growth, t.mults)
    t.kNow = growthK(Math.max(t.sec, t.minSec), t.growth, t.mults)
  }
  t.phi = t.phi0 * (y > 0 ? y : 1)
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
  // Computed ONCE per process: the Source-File level cannot change without a
  // BitNode change, and a BitNode change restarts everything anyway. ns.
  // getResetInfo is 1.00GB against this file's 8.80GB, which buys a reserve
  // that is right in every regime instead of one that was right in one.
  const homeReserveGb = SETTINGS.homeReserve(singularityRamMultiplier(ns.getResetInfo()))

  const flags = ns.flags([
    ['hosts', ''],
    ['targets', 0], // 0 = derive the count from the saturation arithmetic
    ['spacing', SETTINGS.spacing],
    ['adopt', false], // leave workers from a previous instance running
    ['quiet', false],
    // Turn the yield calibration off and plan with the raw model, which is what
    // this file did before it could measure. A rollback switch, not a tuning
    // knob: with it set the controller is 5x wrong on hack money in BitNode 4
    // and says so in /tel/batch.txt rather than going quiet.
    ['nocal', false],
    // Rollback switch for the exp farm (expfarm.js): batch for money even
    // where hacking pays nothing.
    ['nofarm', false],
    // Ignore any persisted calibration and re-learn from zero. Costs one
    // weakenTime of uncorrected planning; use it if the fingerprint fence is
    // ever suspected of letting a stale value through.
    ['nocalrestore', false],
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
        // --- calibration bookkeeping ------------------------------------
        // One record per LAUNCHED batch: when its hack is due to land, how
        // many threads it launched with, and what the plan expected it to
        // earn. All three are captured at launch because all three change
        // between launch and landing.
        flight: [],
        calHits: 0, // clean landings that dropped money -> one sample each
        calMiss: 0, // clean landings that dropped nothing -> the hack failed
        calClamp: 0, // landings that drained ~everything -> y is too low
        calSkip: 0, // landings the read window could not isolate
        calSum: 0, // per-target running mean of the samples, for the
        calN: 0, //   cross-target agreement check
        calMin: null,
        calMax: null,
        calPend: null, // a landing given one extra tick to show its drop
        planLanded: 0, // decayed sum of plan.money over landed batches
        realLanded: 0, //   ... and of what actually fell, same decay
      })
    }
    return S.get(host)
  }

  // --- the yield calibrator ------------------------------------------------
  const CAL = SETTINGS.cal
  const calOn = CAL.on && !flags.nocal
  const cal = yieldRatio(CAL)
  // A read window can only identify ONE landing if it is shorter than the
  // smallest gap between two money-changing landings on a target. Within a
  // batch the hack lands and the grow lands 2*spacing later; across batches the
  // gap is period - 2*spacing >= 2*spacing. So 2*spacing is the floor and this
  // sits comfortably under it. The controller sleeps loopMs, so if loopMs is
  // ever raised above this nothing can be sampled — which is published rather
  // than silently producing no data.
  const calTickMs = 1.5 * SETTINGS.spacing
  const calNotes = []
  if (calOn && SETTINGS.loopMs >= calTickMs) {
    calNotes.push(
      `loopMs ${SETTINGS.loopMs} >= 1.5*spacing ${calTickMs}: no read window can isolate a single landing, so no sample will ever be taken`,
    )
  }
  // Fingerprint of the world the calibration was learned in. moneyMax,
  // requiredHackingSkill and minDifficulty are re-randomised by
  // initForeignServers, which Prestige.ts:98 runs on every install and on every
  // BitNode entry — and NOT on a mere restart of this script. So "the
  // fingerprint still matches" is exactly "the same life, same node".
  const fingerprint = (t) => `${t.host}:${Math.round(t.maxMoney)}:${t.required}:${t.minSec}`
  let calRestore = null
  if (calOn && CAL.restore && !flags.nocalrestore) {
    try {
      // ns.read is 0GB (RamCostGenerator.ts:634) and returns '' for a missing
      // file, so this costs nothing and cannot throw on absence.
      const saved = JSON.parse(ns.read(CAL.file) || 'null')
      if (saved && saved.y > 0 && saved.fp) calRestore = saved
    } catch {
      calNotes.push(`${CAL.file} is present but unreadable; starting cold`)
    }
  }
  let calRestored = false
  let calWrote = 0
  let calFormulas = null
  let lastTickAt = 0
  /** The correction the planner should use right now. 1 means "no correction". */
  const yOf = () => (calOn ? cal.val() : 1)

  /**
   * Retire every hack landing now due on one target, and turn a clean one into
   * a sample.
   *
   * "Clean" is three conditions, all of which are cheap to check and none of
   * which is a guess:
   *
   *   * exactly one landing came due in this read window — otherwise the drop
   *     is the composition of two hacks and reads as ~2x the true ratio;
   *   * the window was shorter than 1.5*spacing, so the grow that lands
   *     2*spacing behind the hack cannot also be inside it — otherwise the drop
   *     is netted against a regrowth and reads LOW, which is the unsafe
   *     direction;
   *   * there is a previous balance to divide by.
   *
   * Declining a sample costs nothing: this is a constant being measured, and
   * one clean landing per target per period is already far more data than the
   * estimate needs. Guessing is how a measured correction turns into a fudge
   * factor.
   *
   * Every landing, clean or not, contributes its planned money to
   * `planLanded`, so the end-to-end `plan vs realised` ratio published in the
   * status is computed over ALL landings and is not selected by the same
   * filter that selects the samples.
   */
  const sample = (s, t, at, dt, dropped) => {
    const v = landingSample(s, t.phi0, at, dt, calTickMs, dropped, CAL.fMax)
    if (v.kind === 'sample') cal.add(v.x)
    // A clamped drain proves the correction in force is too small — the one
    // unsafe direction. Step up at once; upward moves are always safe and so
    // need neither a quorum nor a rate limit.
    else if (v.kind === 'clamp') cal.raise(Math.min(CAL.hi, cal.val() * 2))
  }

  const calNote = (text) => {
    calNotes.push(`${new Date().toISOString()} ${text}`)
    while (calNotes.length > 6) calNotes.shift()
  }

  let hosts = []
  // Hacknet servers left out this cycle: their RAM costs hashes, and
  // hacknet.js's ramPolicy did not (freshly) say the batch pays more.
  let hacknetExcluded = []
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
    // Black-box section (trace.js): open while this iteration runs, so a page
    // that freezes inside the batcher names it after the reload.
    traceEnter('batch')
    const now = Date.now()
    // How long this tick's read window is. The sampler refuses to attribute a
    // money drop when it is too wide to contain exactly one landing, so it is
    // measured rather than assumed to be loopMs — a stalled tab or a slow tick
    // must degrade into "no sample", never into a wrong one.
    const tickMs = lastTickAt ? now - lastTickAt : 0
    lastTickAt = now

    try {
      // --- slow cycle: root, refresh the host list, ship the workers --------
      if (now >= nextSlow) {
        nextSlow = now + SETTINGS.slowCycleMs
        const all = scanAll(ns)
        for (const h of all) if (!ns.hasRootAccess(h)) tryRoot(ns, h)
        // A HACKNET SERVER IS NOT FREE RAM. Its hash rate carries
        // (1 - ramUsed/maxRam) (Hacknet/formulas/HacknetServers.ts:14), so
        // every worker placed there takes that share of its hashes. It is
        // used only when hacknet.js's ramPolicy — the batch's $/GB against
        // the hashes a GB costs — says so, fresh; otherwise excluded (fail
        // closed). An explicit --hosts list is obeyed as given.
        if (self !== 'home') {
          try {
            ns.scp('/tel/hacknet.txt', self, 'home')
          } catch {
            /* the previous copy stays; its stamp decides freshness */
          }
        }
        const hnPolicy = ns.read('/tel/hacknet.txt')
        hacknetExcluded = []
        hosts = all.filter((h) => {
          if (!ns.hasRootAccess(h) || !(ns.getServerMaxRam(h) > 0)) return false
          if (only.length) return only.includes(h)
          if (hacknetHostAllowed(h, hnPolicy)) return true
          hacknetExcluded.push(h)
          return false
        })
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

        // THE TWO HOME RESERVES MUST BE JOINTLY SATISFIABLE.
        //
        // reserveFor() adds these together, and when home is also the largest
        // host in the fleet it was asking home to hold BOTH — homeReserveGb for
        // progress.js's Singularity ramOverride AND shareGb for ns.share().
        // Nothing checked the sum against home's actual size.
        //
        // Live in BitNode 5 at SF4.1: homeReserveGb = 13 + 74*16 = 1197GB and
        // shareGb = 960GB, a 2157GB demand on a 2048GB home. share.js won the
        // race, took 960GB as 240 threads, and progress.js — which needs
        // 1192.85GB in one block — was denied on pass after pass with
        // `ram-raise-denied`. Reputation earned nothing while the script whose
        // whole purpose is reputation could not start, and share.js's own
        // multiplier applies to faction work that was never running. The
        // batcher's accounting was self-consistent throughout; it simply never
        // asked whether home could honour both promises at once.
        //
        // progress.js outranks share: its bonus is 1 + ln(threads)/25, a modest
        // multiplier on reputation, while progress.js is what CAUSES reputation
        // to be earned at all. So share yields — to a non-home host if the
        // fleet has one, otherwise to whatever home has left over.
        if (shareHost === 'home') {
          const alt = hosts
            .filter((h) => h !== 'home')
            .reduce((b, h) => (ns.getServerMaxRam(h) > b.ram ? { host: h, ram: ns.getServerMaxRam(h) } : b), {
              host: null,
              ram: 0,
            })
          const spare = Math.max(0, ns.getServerMaxRam('home') - ns.getServerUsedRam('home') - homeReserveGb)
          if (alt.host && alt.ram * 0.9 >= Math.min(shareGb, spare)) {
            shareHost = alt.host
            shareGb = Math.min(shareGb, alt.ram * 0.9)
          } else {
            shareGb = Math.min(shareGb, spare)
            if (shareGb <= 0) shareHost = null
          }
        }
      }
      const reserveFor = (h) =>
        (h === self ? SETTINGS.selfReserve : 0) +
        (h === 'home' ? homeReserveGb : 0) +
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
      if (now >= nextRetarget || (!targets.length && !farm.on)) {
        nextRetarget = now + SETTINGS.retargetMs
        refreshStockManip(ns)
        const level = ns.getHackingLevel()
        const ranked = []
        for (const h of scanAll(ns)) {
          if (!ns.hasRootAccess(h)) continue
          if (ns.getServerMaxMoney(h) <= 0) continue
          if (ns.getServerRequiredHackingLevel(h) > level) continue
          const t = readTarget(ns, h, yOf())
          const s = targetScore(t)
          if (s > 0) ranked.push({ t, s })
        }
        ranked.sort((a, b) => b.s - a.s)

        // Decide once, here, whether a persisted calibration belongs to this
        // life. This is the only place every candidate server is read, so it is
        // the only place the fingerprint can be checked against the whole
        // world rather than against whichever target happens to be first.
        if (calOn && calRestore && !calRestored) {
          const here = new Set(ranked.map((r) => fingerprint(r.t)))
          if ((calRestore.fp || []).some((f) => here.has(f))) {
            cal.seed(calRestore.y, 'restored')
            calRestored = true
            calNote(
              `restored y=${calRestore.y} (n=${calRestore.n ?? '?'}) from ${CAL.file}; the server fingerprint it was learned against is still present, so this is the same life and the same BitNode`,
            )
          } else {
            calNote(
              `IGNORED the persisted y=${calRestore.y} in ${CAL.file}: none of its server fingerprints exist any more, which means an install or a BitNode entry re-randomised the world. Re-learning from a cold start.`,
            )
          }
          calRestore = null
        }

        let want
        // EXP MODE (expfarm.js): where hacking pays nothing, money targets
        // are pointless. The batcher serves only the trader's manip hosts, and
        // only on a priced verdict; the farm gets the rest of the fleet.
        const nodeMults = bitNodeMults(ns.getResetInfo().currentNode)
        farm.on = !flags.nofarm && expMode(nodeMults)
        farm.weakenRate = nodeMults?.ServerWeakenRate > 0 ? nodeMults.ServerWeakenRate : 1
        if (farm.on) {
          const readT = (h) => readTarget(ns, h, yOf())
          farm.ranked = rankExpTargets(ns, readT, level)
          const best = farm.ranked[0] ?? null
          if (!farm.target || !best || farm.target.host !== best.t.host) {
            farm.waves = []
            farm.nextCreate = 0
          }
          farm.target = best ? best.t : null
          farm.score = best ? best.s : 0
          const mc = stockManip ? manipCost(ns, readT, ram, level, totalRam) : null
          let v = { serve: false, priced: false, why: manipUnservableWhy(stockManip, mc?.blocked ?? []) }
          if (mc && mc.hosts.length) {
            let rec = null
            try {
              rec = JSON.parse(ns.read('/tel/exitinputs.txt') || 'null')
            } catch {
              rec = null
            }
            const fresh = rec && rec.lastAugReset === ns.getResetInfo().lastAugReset && now - Date.parse(rec.at) < 15 * 60e3
            v = manipVerdict({
              bestExitPolicy,
              inputs: fresh ? rec.inputs : null,
              curve: stockCurve,
              nu: mc.nu,
              manipGB: mc.gb,
              farmRate: farm.score,
              batchRate: mc.batchRate,
              fleetGB: totalRam,
            })
          }
          farm.manip = { ...v, hosts: mc?.hosts ?? [], blocked: mc?.blocked ?? [], nudgesPerSec: mc ? Math.round(mc.nu * 1e4) / 1e4 : null, gb: mc ? Math.round(mc.gb) : null }
          want = v.serve ? mc.hosts : []
        } else if (Number(flags.targets) > 0) {
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
          // Capacity-based, matching the dispatcher's floor: the argmax is a
          // question about steady state, not about this instant's free list.
          const scoreCapacity = Math.max(0, ...hosts.map((h) => ns.getServerMaxRam(h)))
          const scoreHackRam = Math.max(
            Math.min(SETTINGS.hackFloor * ram.hack, scoreCapacity),
            scoreCapacity,
          )
          let bestN = 1
          let bestInc = -1
          for (let n = 1; n <= cand.length; n++) {
            // `slice`, not `share`: a local named `share` is billed as
            // ns.share() — 2.40GB of batch.js's 11.20GB, for a variable.
            const slice = totalRam / n
            let inc = 0
            for (let i = 0; i < n; i++) {
              // SAME hack ceiling the dispatcher applies. Omitting it let
              // maxHackRam default to Infinity here, so the target-count argmax
              // scored batches far larger than place() could ever land — it was
              // choosing n against plans that do not exist. It does not change
              // the answer on this fleet (n=1 holds either way), but the two
              // call sites must agree or the choice is made on fiction.
              const p = planBatch(cand[i].t, ram, slice / 4, scoreHackRam)
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
        if (want.length || farm.on) targets = [...new Set([...keep, ...want])]
      }

      // --- serve each target ------------------------------------------------
      let reserved = 0
      let anyBatching = false
      let anyPrepping = false

      let calSaw = null
      for (const host of targets) {
        const s = state(host)
        const t = readTarget(ns, host, yOf())
        calSaw = t.formulas

        // Attribution: money on a target only ever falls when one of our hacks
        // lands, so the drops sum to what this controller earned from it.
        const dropped = s.lastMoney !== null && t.money < s.lastMoney ? s.lastMoney - t.money : 0
        if (dropped > 0) s.earned += dropped
        // Same drop, read as a measurement rather than as income. Must run
        // BEFORE lastMoney is overwritten: the denominator is the balance the
        // hack actually landed against.
        if (calOn) sample(s, t, now, tickMs, dropped)
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

        // FLOOR THE HACK BUDGET. Planning from the INSTANTANEOUS free block is a
        // positive feedback loop, and it was running as a limit cycle all session:
        //
        //   fleet fills -> largest free block shrinks -> hFit falls -> h falls
        //   -> plan.gb falls -> maxInFlight rises -> period falls -> launches
        //   accelerate -> fleet fills faster
        //
        // Measured live at 15s intervals, plan.h ran 132 -> 59 -> 45 -> 34 -> 26
        // -> 20 -> 15 -> 7 -> 4 -> 3 -> 2 -> 1, at which point placeFails hit 75
        // per 15s — every single 200ms tick — and NOTHING launched until the
        // in-flight work drained over a weakenTime. Cycle period ~2.5 minutes.
        //
        // The loop closes because planBatch's score ($/GB) is monotonically
        // increasing in h across the whole practical range — the +1 constants on
        // w1/w2 are fixed overhead a small batch cannot amortise — so hFit is
        // ALWAYS binding and the plan tracks fleet fill rather than fleet value.
        // Steady-state income by h on this fleet: h=1 $22k/s, h=15 $98k/s,
        // h=34 $107k/s, h=132 $113k/s. Collapsing to h<=4 costs about 5x, and
        // the curve is flat within ~7% from h=15 upward.
        //
        // So: never plan a smaller hack op than H_FLOOR, and let place() WAIT for
        // a block big enough. Waiting is cheap — a skipped launch costs one
        // period — while shrinking the plan poisons the next launch too.
        //
        // The floor is itself capped by what the fleet can ever host, so a small
        // or heavily-reserved fleet degrades to "as big as possible" instead of
        // demanding a block that cannot exist and never launching at all.
        const capacityBlock = Math.max(0, ...hosts.map((h) => ns.getServerMaxRam(h) - reserveFor(h)))
        const maxHackRam = Math.max(largestBlock, Math.min(SETTINGS.hackFloor * ram.hack, capacityBlock))
        const plan = planBatch(t, ram, slice / 4, maxHackRam)
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
        // Safe-window gate — with the pipeline's OWN transient tolerated.
        //
        // Requiring exact minimum security skipped ~25% of launch slots on the
        // flagship target (713 unsafeSkips against 2,106 batches, 40.6/min
        // achieved vs 53.8 theoretical), because the poll keeps catching the
        // ~200ms windows where a landed hack (+0.002/thread) or grow
        // (+0.004/thread, ServerHelpers.ts fortify constants) waits for its
        // weaken. That bump is the pipeline breathing, not drift: the pads
        // are computed from times ALREADY normalised to minimum security
        // (readTarget's ratio), the workers read their real durations at call
        // time after the pad, and the in-flight weakens restore minimum
        // before those calls happen. So tolerate exactly one batch's own
        // footprint — anything beyond it means a batch failed and security is
        // genuinely drifting, and THAT is what this gate exists to catch.
        const selfBump = 0.002 * plan.h + 0.004 * plan.g
        if (t.sec > t.minSec + selfBump + 1e-9) {
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
          const pid = ns.exec(SETTINGS.workers[o.op], o.host, { threads: o.threads, temporary: true }, host, o.pad, id, stockFlagFor(stockManip, host, o.op))
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
        // The hack's pad is weakenTime - hackTime and its own duration is
        // hackTime, so it lands at exactly now + weakenTime. h and plan.money
        // are captured HERE because both move before it lands: the plan is
        // rebuilt every tick and the hacking level climbs during the flight.
        if (calOn) {
          s.flight.push({ at: now + weakenTime, h: plan.h, m: plan.money })
          while (s.flight.length > 4096) s.flight.shift()
        }
        s.lastLaunch = now
        s.lastLanding = now + weakenTime + 3 * SETTINGS.spacing
        s.nextLaunch = now + period
      }

      // --- advance the calibration -----------------------------------------
      if (calOn) {
        // phi comes from a different source depending on whether Formulas.exe
        // is owned, and the true ratio differs between them (1 with it,
        // ScriptHackMoney without). A window collected against one model says
        // nothing about the other, so buying Formulas.exe throws the window
        // away rather than dragging a 0.2 into a place it would be a 5x error.
        if (calSaw !== null && calSaw !== calFormulas) {
          if (calFormulas !== null) {
            cal.forget('formulas-changed')
            for (const s2 of S.values()) {
              s2.calSum = 0
              s2.calN = 0
              s2.calMin = null
              s2.calMax = null
            }
            calNote(
              calSaw
                ? 'Formulas.exe appeared: phi now comes from ns.formulas.hacking, which already carries every multiplier. The measured ratio must now converge to 1.0 — if it does not, the decomposition is wrong. Window discarded.'
                : 'Formulas.exe is gone: phi has fallen back to the inlined ports, so the measured ratio must converge to ScriptHackMoney again. Window discarded.',
            )
          }
          calFormulas = calSaw
        }
        cal.step(tickMs / 1000)
      }

      // --- spill ------------------------------------------------------------
      // Grow and weaken award full experience however far they overshoot, and
      // weaken below minimum security is clamped rather than harmful. So RAM the
      // pipelines cannot use is worth spending on weaken: free experience, and
      // it holds the target at the floor, which makes the safe-window gate open
      // more often. Without the reservation above it starves the batcher
      // outright — a spill weaken holds its RAM for a full weakenTime.
      if (!farm.on && anyBatching && targets.length) {
        const idle = [...free.values()].reduce((a, b) => a + b, 0) - reserved
        const threads = Math.floor(idle / ram.weaken)
        if (threads >= 1) spread(ns, free, ram, 'weaken', targets[0], threads, batchId++)
      }

      // --- the exp farm (exp mode only) --------------------------------------
      // After the manip batches have taken what they need: the farm is the
      // fleet's spill in a node where the spill is the product.
      if (farm.on) farmTick(ns, free, ram, now, () => batchId++)

      // --- status -----------------------------------------------------------
      if (now >= nextStatus) {
        nextStatus = now + SETTINGS.statusMs
        const fps = []
        const perTarget = targets.map((h) => {
          const s = state(h)
          const t = readTarget(ns, h, yOf())
          fps.push(fingerprint(t))
          const landed = s.calHits + s.calMiss + s.calClamp
          const r4 = (v) => (v === null || v === undefined ? null : Math.round(v * 1e4) / 1e4)
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
            // --- calibration, per target ---------------------------------
            // ScriptHackMoney is global, so these exist to DISAGREE. If the
            // per-target means are not all the same number, the residual is
            // not the single global constant this design claims it is, and the
            // global estimate is measuring something else.
            cal: !calOn
              ? null
              : {
                  y: r4(s.calN ? s.calSum / s.calN : null),
                  n: s.calN,
                  min: r4(s.calMin),
                  max: r4(s.calMax),
                  // Hack chance, measured and modelled, side by side. This is
                  // the term planBatch already carries and the estimator
                  // deliberately does NOT absorb; publishing both is how a
                  // double-count would be caught.
                  landings: landed,
                  chanceObs: landed ? Math.round(((s.calHits + s.calClamp) / landed) * 1e4) / 1e4 : null,
                  chanceModel: r4(t.chance),
                  // End to end: everything the plan promised for the batches
                  // that have actually landed, against everything that was
                  // actually taken. Converges to 1 when every term above is
                  // attributed correctly; it is the raw number that started
                  // this investigation (measured at 0.32), computed with the
                  // right denominator.
                  planVsReal: s.planLanded > 0 ? Math.round((s.realLanded / s.planLanded) * 1e4) / 1e4 : null,
                  skipped: s.calSkip,
                  clamped: s.calClamp,
                  inFlight: s.flight.length,
                },
          }
        })
        const uptime = (now - started) / 1000
        const earned = perTarget.reduce((a, x) => a + x.earned, 0)
        const batches = perTarget.reduce((a, x) => a + x.batches, 0)

        // One-glance health. "stalled" is the state that has cost us hours
        // before, so it gets its own word rather than being inferred.
        const recentLaunch = perTarget.some((x) => x.sinceLaunchSec !== null && x.sinceLaunchSec < 60)
        // In exp mode the farm is the product: its health is whether waves land.
        const farmHealth = !farm.on ? null : !farm.target ? 'idle' : farm.prepping ? 'prepping' : now - farm.lastLaunch < 120e3 ? 'ok' : 'stalled'
        const batchHealth = recentLaunch ? 'ok' : anyBatching ? 'stalled' : anyPrepping ? 'prepping' : 'idle'
        const health = farmHealth === null ? batchHealth : batchHealth === 'stalled' ? 'stalled' : farmHealth

        // --- calibration report ---------------------------------------------
        // Everything a reader needs to decide whether to believe the number the
        // planner is using, through a path that does not depend on the
        // calibration being right: the raw quantiles, the sample count, the
        // spread, what the value is EXPECTED to be, and a verdict.
        const st = cal.stat()
        const yUsed = calOn ? st.y : 1
        const perT = perTarget.map((x) => x.cal && x.cal.y).filter((v) => v > 0)
        const agreeSpread = perT.length > 1 ? (Math.max(...perT) - Math.min(...perT)) / Math.max(...perT) : 0
        let verdict = 'off'
        let says = 'calibration disabled (--nocal): the planner is using the raw model, which is 5x high on hack money in any BitNode with ScriptHackMoney = 0.2'
        if (calOn) {
          if (st.n < CAL.minN) {
            verdict = 'cold'
            says = `${st.n}/${CAL.minN} samples — the planner is using y=1, which is exactly the uncorrected behaviour. No correction is applied until the evidence exists.`
          } else if (calFormulas && Math.abs(st.p50 - 1) > CAL.formulasTol) {
            // The self-check. With Formulas.exe the model phi IS the game's own
            // formula with every multiplier included, so the measured ratio is
            // 1 by construction. Anything else means this decomposition is
            // wrong, and that outranks any correction it might produce.
            verdict = 'DISAGREES-WITH-FORMULAS'
            says = `Formulas.exe is owned, so phi comes from ns.formulas.hacking and the measured ratio MUST be 1.0. It reads ${st.p50}. The decomposition is wrong — do not trust y, and do not trust the same mechanism's answer without Formulas either.`
          } else if (st.spread !== null && st.spread > CAL.spreadWarn) {
            verdict = 'unstable'
            says = `samples should be identical (the ratio is a constant and every term that varies is divided out), but p10..p90 spans ${st.p10}..${st.p90}. Something is contaminating the read window; y is pinned to the upper quantile, which is the safe side, but the number is not trustworthy.`
          } else if (agreeSpread > CAL.spreadWarn) {
            verdict = 'per-target-disagreement'
            says = `per-target means span ${Math.min(...perT)}..${Math.max(...perT)}. ScriptHackMoney is global, so they should be one number; a spread means the residual is not the single global constant this correction assumes.`
          } else {
            verdict = 'ok'
            says = calFormulas
              ? `agrees with Formulas.exe: measured ${st.p50} against the expected 1.0`
              : `measured ${st.p50}; Formulas.exe is not owned, so this is currentNodeMults.ScriptHackMoney and nothing live can confirm it independently. Buying Formulas.exe ($5e9) makes this same number read 1.0, which is the check.`
          }
        }
        const calibration = {
          verdict,
          says,
          enabled: calOn,
          y: yUsed,
          applied: `t.phi = phi_model * ${yUsed}`,
          source: st.src,
          samples: st.n,
          sampleTotal: st.seen,
          p10: st.p10,
          p50: st.p50,
          p90: st.p90,
          spread: st.spread,
          formulasExe: calFormulas,
          expect: calFormulas === null ? null : calFormulas ? 1 : 'currentNodeMults.ScriptHackMoney',
          perTargetSpread: Math.round(agreeSpread * 1e4) / 1e4,
          skipped: perTarget.reduce((a, x) => a + ((x.cal && x.cal.skipped) || 0), 0),
          clamped: perTarget.reduce((a, x) => a + ((x.cal && x.cal.clamped) || 0), 0),
          missed: targets.reduce((a, h) => a + state(h).calMiss, 0),
          tickMs,
          maxTickMs: calTickMs,
          notes: calNotes.slice(-4),
        }

        const status = {
          at: new Date(now).toISOString(),
          health,
          uptimeSec: Math.round(uptime),
          controller: self,
          hostsUsed: hosts.length,
          hacknetServers: { used: hosts.filter(isHacknetServerHost).length, excluded: hacknetExcluded.length, why: hacknetExcluded.length ? "hacknet.js's ramPolicy keeps their RAM for hashes (or is not fresh)" : null },
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
          calibration,
          // The trader's manipulation requests (nodeecon.js): which it asked for,
          // which this batcher's targets serve, which it does not target at all.
          // The exp farm (expfarm.js), when this node pays nothing for hacks.
          // `model.hackThreadsPerSec` x exp/thread is the prediction to hold
          // against tel.js's measured script exp rate — NOT CALIBRATED yet.
          expFarm: farm.on
            ? {
                target: farm.target?.host ?? null,
                prepping: farm.prepping,
                scorePerGBms: farm.score,
                expPerThread: farm.target ? expPerThread(ns.getServer(farm.target.host).baseDifficulty) : null,
                chance: farm.target ? Math.round(farm.target.chance * 1e4) / 1e4 : null,
                hackTimeSec: farm.target ? Math.round(farm.target.hackTime / 100) / 10 : null,
                wavesInFlight: farm.waves.length,
                launchedWaves: farm.launchedWaves,
                skippedWaves: farm.skippedWaves,
                heldGB: Math.round(farm.held.reduce((a, x) => a + x.gb, 0)),
                model: { hackThreadsPerSec: Math.round((farm.hackThreads / Math.max(1, (now - farm.hackThreadsWindowStart) / 1000)) * 10) / 10 },
                runnersUp: farm.ranked.slice(1, 4).map((r) => ({ host: r.t.host, score: r.s })),
                // What each further port opener would add (expfarm.portTiers):
                // progress.js prices program purchases from this.
                portTiers: portTiers(farm.servers ?? [], hosts.reduce((a, h) => a + ns.getServerMaxRam(h), 0), ['BruteSSH.exe', 'FTPCrack.exe', 'relaySMTP.exe', 'HTTPWorm.exe', 'SQLInject.exe'].filter((f) => ns.fileExists(f, 'home')).length),
                manip: farm.manip,
                why: farm.why,
              }
            : null,
          stockManip: stockManip ? { requested: stockManip, served: Object.keys(stockManip).filter((h) => targets.includes(h)), unserved: Object.keys(stockManip).filter((h) => !targets.includes(h)) } : null,
          targets: perTarget,
          errors: errors.slice(-5),
        }

        // Persist, so a restart does not pay another weakenTime of uncorrected
        // planning. ns.write is 0GB. Only written once the estimate is trusted,
        // so a cold value can never be handed to the next run, and stamped with
        // the server fingerprints that make it refuse itself after an install
        // or a BitNode entry.
        if (calOn && CAL.restore && st.n >= CAL.minN && now - calWrote > 30000) {
          calWrote = now
          try {
            ns.write(
              CAL.file,
              // The value actually IN FORCE, not the raw quantile: if the ramp
              // has not finished it is higher than the target, and higher is
              // the safe side to hand to the next run.
              JSON.stringify({ at: status.at, y: st.y, n: st.n, formulas: calFormulas, fp: fps }),
              'w',
            )
          } catch {
            /* the value is also in /tel/batch.txt; losing the cache is not a fault */
          }
        }
        // Same bytes as before: `status` already carries `at`, `health`,
        // `controller` and `errors`, and the reporter lets the caller's fields
        // win, so this publishes the identical body and merely routes it
        // through the one function the atExit above also uses.
        note(health, status)
        mirror()
        if (!flags.quiet)
          ns.print(
            `${health} | ${targets.join(',')} | ${batches} batches | ${Math.round(earned / 1e6)}m earned | yield x${yUsed} (${verdict}, n=${st.n})`,
          )
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

    traceLeave('batch')
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
