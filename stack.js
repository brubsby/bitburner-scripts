// The stack planner: which scripts are worth running at this home RAM, and
// which ones have to wait. Pure arithmetic, no ns surface, so importing it
// costs boot.js nothing (CLAUDE.md, "Separate pure logic from ns I/O").
//
// WHY THIS EXISTS
//
// Home RAM at BitNode entry is not one number (Prestige.ts:242-248):
//
//     SF9 level 2+ -> 128GB      SF1 level 1+ -> 32GB      otherwise -> 8GB
//
// and script RAM is not one number either (RamCostGenerator.ts:82-96): ten root
// scripts change price with the Source-File 4 level, autobuy.js by 11x
// (5.85GB inside BN4, 65.85GB at SF4.1 elsewhere). A single static list of
// "things to start" therefore cannot be right. The old boot.js declared one —
// 82.60GB of home-pinned scripts — and on a virgin 8GB entry it launched
// exactly nothing, logging "no host with 22.00GB free" ten times and calling
// that a successful boot.
//
// The fix is not to shorten the list. It is to make the list ORDERED and
// BUDGETED:
//
//   1. ORDER BY VALUE. At 8GB the only thing worth home RAM is something that
//      earns money and hacking experience, because nothing else in the game can
//      start until those exist. Every entry below carries the tier at which it
//      starts being worth its RAM, and the reason.
//
//   2. BUDGET ON ACTUAL COST. `costOf` is `ns.getScriptRam` in the game, which
//      returns the price *in the current regime* — so autobuy.js is admitted at
//      5.85GB inside BitNode 4 and correctly refused at 65.85GB on an SF4.1
//      save, with no Source-File arithmetic anywhere in the planner. (The
//      offline predictor for the same number is
//      sfgate.js's `singularityRamMultiplier`; the test suite uses it to check
//      every regime without a running game.)
//
//   3. NEVER STARVE THE WORKERS. A launcher that fills home with daemons and
//      leaves no room to hack is a process watching an idle machine. `minOps`
//      thread-slots are reserved off the top, before any daemon is considered.
//      One HGW batch is four concurrent operations (batch.js:365-366), so four
//      is the floor below which the pipeline the collection is built around
//      does not exist at all.
//
// THE LAUNCHER'S OWN RAM IS COUNTED TWICE, DIFFERENTLY
//
// boot.js is resident while it exec's the daemons, so its 6.20GB is part of the
// budget every daemon is admitted against. It is NOT resident when the worker
// runs, because its last act is `ns.spawn`, which kills the calling script
// before starting the new one (NetscriptFunctions.ts:622-650 — killWorkerScript
// then spawnCb, immediately when spawnDelay is 0). So the worker's thread count
// is computed WITHOUT the launcher.
//
// That distinction is the whole 8GB tier. A 4.20GB exec-only launcher leaves
// 3.80GB free on an 8GB home, which is ONE 2.00GB worker thread — a quarter of
// a batch. Paying 2.00GB for ns.spawn takes the launcher to 6.20GB and hands
// the worker the entire 8GB, which is four. The launcher is more expensive and
// the machine does four times the work.
//
// The plan is recomputed on every boot, so it also grows *within* a life: home
// RAM is bought and is permanent across installs (prestigeHomeComputer touches
// neither maxRam nor cpuCores, Server/ServerHelpers.ts:226-239), and each
// doubling admits the next band. Running boot.js again after a home upgrade is
// the whole upgrade procedure.

/**
 * Reserve, in worker thread-slots, held back from every daemon.
 * Four = one complete hack/weaken/grow/weaken batch.
 */
export const MIN_OPS = 4

/**
 * Home sizes worth talking about. The first three are the only sizes a BitNode
 * can START at (Prestige.ts:242-248); the rest are purchased doublings, which
 * arrive within a life and must admit more of the stack when they do.
 */
export const TIERS = [8, 32, 64, 128, 256, 1024]

/**
 * Decide what to run.
 *
 * @param {Array}    manifest  boot.js's STACK, plain data (see boot.js).
 * @param {object}   opt
 * @param {number}   opt.homeRam   ns.getServerMaxRam('home')
 * @param {Function} opt.costOf    (script) => GB in the CURRENT regime, or 0/NaN if unpriceable
 * @param {number}   opt.bootRam   RAM the launcher itself holds while it runs
 * @param {number}   opt.minOps    worker slots to keep free on home
 * @returns {{tier, worker, opRam, reserve, homeUsed, admit, defer}}
 *
 * `admit` entries carry a resolved `cost` and, for the worker, `threads`.
 * `defer` entries ALWAYS carry a `why` — a deferral with no reason is
 * indistinguishable from a script someone quietly deleted, which is exactly the
 * failure this planner exists to stop.
 */
export function planStack(manifest, { homeRam, costOf, bootRam = 0, minOps = MIN_OPS }) {
  const priced = (s) => {
    const n = Number(costOf(s))
    return Number.isFinite(n) && n > 0 ? n : null
  }

  // The self-threaded worker for this band, if there is one. Above the top band
  // the batcher owns home's RAM and places its own h/g/w, so there is no
  // fill-home worker and the reserve is sized against a single op instead.
  const worker = manifest.find(
    (e) => e.role === 'worker' && homeRam >= e.tier && (e.until == null || homeRam < e.until),
  )
  const opRam = (worker && priced(worker.script)) || priced('w.js') || 1.75
  const reserve = minOps * opRam

  const admit = []
  const defer = []
  let homeUsed = 0

  // Rank order IS the value order. Ties are impossible by construction: rank is
  // unique and asserted unique by the test suite.
  const ordered = [...manifest].sort((a, b) => a.rank - b.rank)

  for (const entry of ordered) {
    if (entry.role === 'worker') continue // sized last, out of whatever is left

    if (homeRam < entry.tier) {
      defer.push({ ...entry, why: `home ${homeRam}GB is below its tier of ${entry.tier}GB — ${entry.why}` })
      continue
    }
    if (entry.until != null && homeRam >= entry.until) {
      defer.push({ ...entry, why: `retired above ${entry.until}GB — ${entry.retire || 'superseded'}` })
      continue
    }

    const cost = priced(entry.script)
    if (cost == null) {
      defer.push({ ...entry, why: `${entry.script} does not price on home — missing, or it does not compile` })
      continue
    }

    if (entry.where !== 'home') {
      // Placed off home by the launcher. Costs the home budget nothing, which
      // is exactly why tel.js, seed.js, buyserv.js and share.js live there: at
      // 8GB, home is the scarcest RAM in the game and the 0-port fleet
      // (foodnstuff/joesguns/sigma-cosmetics/... , ~100GB) is free.
      admit.push({ ...entry, cost })
      continue
    }

    // A one-shot exits in seconds, so its RAM is transient: it runs while the
    // launcher is still resident and is gone long before the worker is spawned.
    // Charging it against the steady-state budget would cost a permanent slot
    // for a script that holds one for about a second. It still has to FIT at
    // the moment it is exec'd, which is what this tests.
    if (entry.kind === 'oneshot') {
      const now = homeRam - bootRam - homeUsed
      if (cost > now) {
        defer.push({
          ...entry,
          why: `needs ${cost}GB transiently, only ${Math.max(0, round(now))}GB free while the launcher runs — ${entry.why}`,
        })
      } else {
        admit.push({ ...entry, cost })
      }
      continue
    }

    const free = homeRam - bootRam - reserve - homeUsed
    if (cost > free) {
      defer.push({
        ...entry,
        why:
          `needs ${cost}GB, only ${Math.max(0, round(free))}GB of home is left after the launcher (${bootRam}GB) ` +
          `and ${minOps} worker slots (${round(reserve)}GB) — ${entry.why}`,
      })
      continue
    }
    homeUsed = round(homeUsed + cost)
    admit.push({ ...entry, cost })
  }

  // Workers take the remainder. They are the point of the machine, so they get
  // what is left rather than a fixed share — and never less than the reserve,
  // because nothing above was allowed to eat into it.
  //
  // `bootRam` is deliberately absent here: boot.js spawns the worker as its
  // last act, and ns.spawn kills the caller before it starts the new script, so
  // the launcher's RAM is already back in the pool when this runs.
  if (worker) {
    const cost = priced(worker.script)
    const threads = cost ? Math.floor((homeRam - homeUsed) / cost) : 0
    if (threads > 0) {
      homeUsed = round(homeUsed + cost * threads)
      admit.push({ ...worker, cost, threads })
    } else {
      defer.push({ ...worker, why: `no room on a ${homeRam}GB home for even one thread once ${round(homeUsed)}GB of daemons are resident` })
    }
  }

  return {
    tier: TIERS.filter((t) => t <= homeRam).pop() ?? homeRam,
    worker: worker ? worker.script : null,
    opRam,
    reserve: round(reserve),
    homeUsed: round(homeUsed),
    admit,
    defer,
  }
}

/** Two decimals, the way the game's own `free` and the RAM checker round. */
function round(n) {
  return Math.round(n * 100) / 100
}
