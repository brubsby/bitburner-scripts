// Converts surplus cash into RAM, autonomously.
//
// Split out of auto.js because ns.cloud.purchaseServer (2.25GB) and
// getServerNames (1.05GB) are expensive to carry in a fast loop.
//
//   run buyserv.js                  reserve enough for the next port opener
//   run buyserv.js --reserve 5e6    hoard more
//   run buyserv.js --reserve 0      spend everything
//   run buyserv.js --interval 60    check every minute
//
// ---------------------------------------------------------------------------
// Why this spends everything, every tick.
//
// getCloudServerCost is *linear* in BN1 — a flat $55,000/GB at every size, the
// softcap exponent max(0, log2(ram) - 6) being raised to CloudServerSoftcap = 1
// — and getCloudServerUpgradeCost is exactly the difference between two sizes.
// So buying 16GB now and doubling it to 32GB later costs precisely what buying
// 32GB later costs. There is no volume discount to wait for and no
// optimal-stopping problem: **waiting to afford a bigger server is never
// cheaper, it only delays the income.**
//
// The previous policy bought at most one server per 120s tick, the largest
// power of two the surplus afforded, above a standing $2m reserve. That left
// change stranded — with $3m in hand it bought 32GB for $1.76m and idled
// $1.24m — and left each purchase's income unearned for up to two minutes,
// compounding. Simulated over 60 minutes from a fresh BN1, spending the whole
// surplus promptly instead was worth 3.4x on its own: $150m of lifetime
// earnings became $516m, with no extra money spent, only spent sooner.
// See docs/optimizer-log.md section 3.
//
// The reserve survives in a narrower role. Without Source-File 4 there is no
// singularity API, so the TOR router, port-opening programs and home RAM are
// purchases only the player can make in the UI — and port openers are the best
// conversion of money into progress in the game, worth ~5.7x over the same
// hour, because each one unlocks whole servers at once. The reserve keeps the
// next one affordable and retires itself once that program is owned, instead
// of idling forever. Measured cost of holding it: 1-2% of earnings.
// ---------------------------------------------------------------------------

// Free to import: status.js references only ns.write (0GB). See its header.
import { reporter, describe, record } from 'status.js'
// Pure modules, no ns surface, so importing them costs this script nothing.
// aliased: this file already has a local reserveFor(ns) for per-host reserves.
import { reserveFor as budgetHold, augClaim, joinClaim } from 'budget.js'
import { nextHomeUpgrade } from 'homecost.js'
// The node's multiplier table (pure lookup; its main() is not imported code).
import { bitNodeMults } from 'bitNodeMultipliers.js'
import { fleetTarget } from 'fleetshape.js'
import { stockRecordFromText, raiseRequestFor, raiseFileOf, STOCK_FILE } from 'nodeecon.js'

// Where progress.js publishes the augmentation plan and its total cost.
const GATE_FILE = '/tel/installgate.txt'
const SCHEDULE_FILE = '/tel/factionplan.txt'
const BATCH_FILE = '/tel/batch.txt'

const SETTINGS = {
  // Port openers in price order (src/DarkWeb/DarkWebItems.ts). The reserve is
  // the price of the cheapest one not yet owned, so it shrinks to nothing as
  // they are bought.
  //
  // relaySMTP and beyond used to be omitted here on the grounds that the
  // servers behind them need hacking level 300+. That is true of *hacking*
  // them and false of *rooting* them — ns.nuke tests open ports alone
  // (src/NetscriptFunctions.ts:504-520) — and rooting is what buys RAM. The
  // servers are usable as worker capacity at any level, so a port opener is
  // the cheapest RAM in the game: relaySMTP unlocked 688GB for $5m on this
  // save, about $7.3k/GB against the cloud's flat $55k/GB.
  programs: [
    { file: 'BruteSSH.exe', price: 500000 },
    { file: 'FTPCrack.exe', price: 1500000 },
    { file: 'relaySMTP.exe', price: 5000000 },
    { file: 'HTTPWorm.exe', price: 30000000 },
    { file: 'SQLInject.exe', price: 250000000 },
  ],
  // Once every port program is owned there is nothing *cheap* left to save for,
  // but "hold nothing back" is wrong at that point rather than right: this loop
  // spends the entire surplus every 15s, so the balance sits near the reserve
  // almost all the time. That is fine while money only buys RAM. It is not fine
  // once augmentations are the goal — a purchase window that opens when rep
  // crosses a threshold finds an empty account, and augmentations are the only
  // thing that ends the BitNode.
  //
  // $2b covers a full 7-9 augmentation buy-out including the 1.9x-per-queued-aug
  // money multiplier (measured: ~$1.06b for the seven cheapest-by-rep on
  // 2026-09-12) with headroom. The cost of holding it is ~36TB of cloud RAM
  // foregone at $55k/GB, which is real but bounded, and income here is ~$3b per
  // ten minutes — the reserve refills far faster than reputation accrues, so it
  // is never the binding constraint.
  floorReserve: 2e9,
  interval: 15000,
  statusFile: '/tel/buyserv.txt',
  configFile: '/tel/buyserv-config.txt',
}

/** Price of the cheapest port opener not yet owned, or the floor. */
function reserveFor(ns) {
  for (const p of SETTINGS.programs) {
    if (!ns.fileExists(p.file, 'home')) return p.price
  }
  return SETTINGS.floorReserve
}

/**
 * How much cash to hold back.
 *
 * This used to be an explicit figure remembered on disk, which was wrong in a
 * way that only showed up after an augmentation install: the file survives the
 * install, so a reserve set to park spending in a rich life came back in a
 * life that owned nothing and needed to rebuild, and quietly held everything
 * back. A watchdog restarting the script with the old hardcoded argument had
 * the same effect from the other direction.
 *
 * So nothing is remembered. The reserve is derived from the game state every
 * tick and is therefore always right for the life it is in: hold back exactly
 * enough for the cheapest port opener not yet owned, because those are
 * singularity-gated purchases only a human can make and each one unlocks a
 * whole tier of servers to root. Once they are all owned there is nothing left
 * to save for and it drops to zero.
 */
/**
 * What buyserv must leave alone.
 *
 * Two independent holds, and the second is new:
 *
 *  1. the next unbought port program, because rooting more servers is worth
 *     more than more RAM on the ones we have;
 *  2. everything budget.js says a HIGHER-PRIORITY spender has claimed —
 *     augmentations, which survive an install, and the next home upgrade,
 *     which also survives one. Purchased servers do not survive at all
 *     (ServerHelpers.ts:226-239), so they are last in line by construction.
 *
 * The second is the fix for a measured failure: this script spent every surplus
 * dollar every 15 seconds, which pinned the balance a thousandfold below
 * homeup.js's trigger for an entire life. Home was never upgraded while 77% of
 * gross income went into servers the next install deleted.
 *
 * ns.read is 0GB (RamCostGenerator.ts:634) and returns '' for a missing file,
 * so honouring the augmentation claim costs nothing and cannot throw. An
 * UNREADABLE claim holds everything back rather than reading as zero — that
 * direction is deliberate, and budget.js [BU2] asserts it.
 */
/**
 * Home's telemetry, copied here when this runs off home.
 *
 * boot.js places buyserv.js `where: 'anywhere'`, and `ns.read` is LOCAL to the
 * host: off home it returns '' for every file below, which is not an error and
 * does not throw. The claims then read as UNDETERMINED — and while that is the
 * safe direction (budget.js holds spending back rather than permitting it), it
 * is safe by accident, on a host that is simply the wrong place to be looking.
 * Every rival claim would be invisible and the reserve would sit at its floor
 * forever for a reason nothing reports.
 *
 * The same read-off-home defect in homeup.js stalled a BitNode 4 bootstrap for
 * 6.8 hours (see tools/test/structure.test.mjs C10, which is what caught this
 * one). ns.scp and ns.getHostname are already in this script's cost for the
 * status mirror, so pulling is free.
 */
function fetchFromHome(ns, file) {
  if (ns.getHostname() === 'home') return
  try {
    ns.scp(file, ns.getHostname(), 'home')
  } catch {
    /* previous copy stays — an old gate beats no gate */
  }
}

/** Why reserveNow is holding everything, when it is (published as `hold`). */
let holdWhy = null

function reserveNow(ns) {
  holdWhy = null
  fetchFromHome(ns, GATE_FILE)
  fetchFromHome(ns, SCHEDULE_FILE)
  // THE EXIT VERDICT, when progress.js published a fresh one this life
  // (installgate spendExit.servers — the node's exit with this much fleet
  // spend against without, CLAUDE.md "Decisions compare simulated
  // trajectories"): spend at most its maxSpend, keep the join claim, and
  // nothing else. Stale or absent, the claims-and-payback rule below stands.
  try {
    const g = JSON.parse(ns.read(GATE_FILE) || 'null')
    const v = g?.spendExit
    const life = ns.getResetInfo().lastAugReset
    if (v && v.lastAugReset === life && Date.now() - Date.parse(v.at) < 15 * 60e3 && v.servers) {
      const money = ns.getServerMoneyAvailable('home')
      const join = joinClaim(ns.read(GATE_FILE), life)
      if (typeof join !== 'number') return Infinity
      const spend = v.servers.buy && v.servers.maxSpend > 0 ? v.servers.maxSpend : 0
      // THE APPROVED SPEND NEEDS CASH (nodeecon: wealth decides, cash pays).
      // The verdict priced it on cash + the trader's book; where the book
      // holds the money, ask act.js to raise it (a sized raise request).
      fetchFromHome(ns, STOCK_FILE)
      const stock = stockRecordFromText(ns.read(STOCK_FILE), life)
      const target = Math.max(join, SETTINGS.floorReserve) + spend
      const req = spend > 0 ? raiseRequestFor({ cash: money, equity: stock.ok ? stock.equity : 0, target, by: 'buyserv', why: `fleet spend the exit simulation approved ($${Math.round(spend)})`, lastAugReset: life }) : null
      ns.write(raiseFileOf('buyserv'), JSON.stringify(req ?? { at: new Date().toISOString(), by: 'buyserv', target: 0, why: 'no raise needed' }), 'w')
      if (ns.getHostname() !== 'home') ns.scp(raiseFileOf('buyserv'), 'home', ns.getHostname())
      return Math.max(join, money - spend, SETTINGS.floorReserve)
    }
  } catch {
    /* fall through to the claims rule */
  }
  // NO FALLBACK WHERE CLOUD RAM EARNS NOTHING. Every rule below prices a
  // server by the money its hacking brings in. In a node with
  // ScriptHackMoneyGain = 0 (BitNode 8, BitNode.tsx:773; NetscriptHelpers.tsx
  // :648) that is a measured zero: the RAM buys hacking exp only, the next
  // install deletes it, and the dollars it costs are the stock trader's
  // compounding capital. Live on entering BitNode 8 (2026-09-25 12:52) this
  // fallback spent ~$85m of the $250m opening on servers in the first
  // minutes. So only the exit verdict above may spend here — it prices the
  // spend against the trader's return as a trajectory — and until progress.js
  // publishes one, everything is held, and says why.
  const bn = bitNodeMults(ns.getResetInfo().currentNode)
  if (bn && bn.ScriptHackMoneyGain === 0) {
    holdWhy = 'scripted hacking pays nothing in this node (ScriptHackMoneyGain 0): cloud servers are bought only on a fresh exit verdict (installgate spendExit.servers), and none is published'
    return Infinity
  }
  let base = SETTINGS.floorReserve
  for (const p of SETTINGS.programs) {
    if (!ns.fileExists(p.file, 'home')) {
      base = p.price
      break
    }
  }
  const claims = {
    // THE JOIN GATE outranks every other spender, because it is the exit
    // rather than a means to it. Daedalus admits on $100b IN HAND, and this
    // file converts money into cloud servers — which do not even survive an
    // install. Live in BitNode 1 with the augmentation count already met and
    // income at $477b/h, the balance fell from $6.02b to $5.10b because
    // nothing in the budget knew the join existed. Same no-`?? 0` rule.
    join: joinClaim(ns.read(GATE_FILE), ns.getResetInfo().lastAugReset),
    // NO `?? 0` HERE. augClaim returns null only when the claim could not be
    // determined, and budget.js turns that into the `fallback` below — a
    // coercion to 0 would convert every failure into permission to spend.
    augmentations: augClaim(ns.read(GATE_FILE), ns.getResetInfo().lastAugReset),
    // `?? 0` IS correct here, and the reason is worth stating so the next
    // reader does not "fix" it into a block. nextHomeUpgrade is pure arithmetic
    // over values we already hold (homecost.js) — it cannot fail to be read. It
    // returns null for exactly one reason: home is at the 2^30 GB / 8 core cap,
    // which is a genuine claim of zero, not an unknown.
    //
    // Both upgrade kinds publish the OBJECT form {amount, deltaGB} so
    // budget.js can weigh the payback exception (its header has the
    // economics). A RAM upgrade doubles, so deltaGB is the current size. A
    // cores upgrade converts to a RAM-EQUIVALENT: +1 core adds 1/16 to the
    // grow/weaken core bonus (ServerHelpers.ts:316, `1 + (cores-1)/16`),
    // which at most behaves like homeRam/16 of extra capacity — an UPPER
    // bound on its worth, which errs toward holding. The first version left
    // cores as a numeric full-hold "to be conservative", and the very next
    // upgrade was a $56.25b core — recreating, through the other door, the
    // exact starvation this exception exists to end.
    home: (() => {
      const up = nextHomeUpgrade(ns.getServerMaxRam('home'), ns.getServer('home').cpuCores, bitNodeMults(ns.getResetInfo().currentNode)?.HomeComputerRamCost)
      if (!up) return 0
      const ram = ns.getServerMaxRam('home')
      return { amount: up.cost, deltaGB: up.kind === 'RAM' ? ram : ram / 16 }
    })(),
  }
  // The payback measurements, all live. fleetDollarPerGB is priced at 4TB —
  // a representative mid-fleet size that already carries several softcap
  // doublings, so the comparison errs toward holding. The horizon is half the
  // measured install window (the fleet's average remaining lifetime); income
  // falls back through the same two-element read the gate uses. Any of these
  // failing to read leaves payback undefined and budget.js fails closed.
  const payback = (() => {
    try {
      const inc0 = ns.getTotalScriptIncome()
      const incomePerSec = (isFinite(inc0?.[0]) && inc0[0] > 0 ? inc0[0] : 0) || (isFinite(inc0?.[1]) && inc0[1] > 0 ? inc0[1] : 0)
      const sched = JSON.parse(ns.read(SCHEDULE_FILE) || 'null')
      const windowH = sched?.windowH > 0 ? sched.windowH : 1.72 // 2026-09-15 measured median, self-replacing
      const fleetDollarPerGB = ns.cloud.getServerCost(4096) / 4096
      if (!(incomePerSec > 0) || !(fleetDollarPerGB > 0)) return undefined
      return { fleetDollarPerGB, incomePerSec, horizonSec: (windowH / 2) * 3600 }
    } catch {
      return undefined
    }
  })()
  const held = budgetHold('servers', claims, { fallback: base, payback })
  return base + (isFinite(held) ? held : 0)
}

/**
 * The largest server size still priced at the floor rate per GB.
 *
 * getCloudServerCost applies `CloudServerSoftcap^max(0, log2(ram) - 6)`
 * (Server/ServerPurchases.ts:33-41), so cost per GB is constant up to 64GB and
 * then multiplies by the softcap every doubling. That knee is where cheap RAM
 * stops, and it is exactly the size to level a fleet to.
 *
 * MEASURED through the game's own getServerCost rather than assuming the
 * exponent, so a BitNode with a different softcap — or none, where the answer
 * is simply the RAM limit — gets the right answer without this file knowing
 * which BitNode it is in. That is the same mistake the old policy made: it
 * hardcoded BitNode 1's flat pricing into a comment and acted on it in BN4.
 *
 * Ties go to the LARGER size (`<= best * 1.0001`), so a flat-priced node walks
 * all the way to the cap instead of stopping at the first size.
 */
function softcapKnee(ns, maxRam) {
  let best = Infinity
  let knee = 8
  for (let r = 8; r <= maxRam; r *= 2) {
    const cost = ns.cloud.getServerCost(r)
    if (!isFinite(cost) || cost <= 0) break
    const perGb = cost / r
    if (perGb <= best * 1.0001) {
      best = Math.min(best, perGb)
      knee = r
    } else break
  }
  return knee
}

export async function main(ns) {
  const flags = ns.flags([
    ['reserve', -1],
    ['interval', SETTINGS.interval / 1000],
  ])
  const interval = flags.interval * 1000

  ns.disableLog('ALL')

  ns.print(`buyserv.js running — reserve ${flags.reserve >= 0 ? '$' + flags.reserve : 'auto'}`)

  // The daemon only mirrors /tel/* off home, so ship the status there when this
  // runs anywhere else — otherwise it is invisible outside the game. This was
  // already inline below; hoisting it lets the error and exit paths use it too.
  // ns.scp (0.6GB) and ns.getHostname (0.05GB) were already referenced, so no
  // RAM changes.
  const self = ns.getHostname()
  const mirror = () => {
    if (self === 'home') return
    try {
      ns.scp(SETTINGS.statusFile, 'home', self)
    } catch {
      /* home unreachable; the local copy still stands */
    }
  }

  const errors = []
  const note = reporter(ns, SETTINGS.statusFile, () => ({ errors: errors.slice(-5) }))

  // The path no try/finally can reach: killed by the watchdog, caught in a
  // killall, or thrown past every handler. ns.atExit costs 0GB and runs before
  // the worker is torn down, so this is the only way "buyserv stopped buying"
  // ever becomes visible instead of just looking like a rich, idle account.
  ns.atExit(() => {
    note.exit('stopped', { detail: 'buyserv.js is no longer running — surplus cash is not being spent' })
    mirror()
  })

  while (true) {
    const log = []
    // Hoisted so the catch can report what the tick was working with. A status
    // that says only "it threw" costs another run to reproduce.
    let reserve = null

    try {
      const owned = ns.cloud.getServerNames()
      const limit = ns.cloud.getServerLimit()
      const maxRam = ns.cloud.getRamLimit()
      // NO CLOUD SERVERS IN THIS NODE. getCloudServerLimit() is
      // round(25 x CloudServerLimit) (ServerPurchases.ts:92-94), and BitNode 9
      // sets CloudServerLimit 0. The loop below would simply find no slot
      // every pass — but it still published `fleetDollarPerGB` from
      // getServerCost, a price for servers that cannot be bought, and
      // progress.js's spend verdict (installgate spendExit.servers) priced a
      // fleet spend on it. Refuse by name instead, with no price to read.
      if (limit <= 0 && owned.length === 0) {
        note('waiting', { result: 'no-cloud-servers', limit, fleetDollarPerGB: null, owned: 0, detail: `ns.cloud.getServerLimit() is ${limit} in this BitNode (CloudServerLimit): there is nothing to buy. RAM here is home, rooted servers, and — with hacknet servers — whatever hacknet.js's ramPolicy lends.` })
        mirror()
        await ns.sleep(10 * 60e3)
        continue
      }
      reserve = flags.reserve >= 0 ? flags.reserve : reserveNow(ns)

      // ----------------------------------------------------------------
      // LEVEL TO THE SOFTCAP KNEE, then stop. (Was: "concentrate, do not level".)
      //
      // The old policy rested on a claim that is FALSE outside BitNode 1:
      // "cloud RAM costs a flat $55k/GB at every size". The real formula is
      // (Server/ServerPurchases.ts:33-41)
      //
      //   cost = ram * 55000 * CloudServerCost * CloudServerSoftcap^max(0, log2(ram)-6)
      //
      // and BitNode 4 sets CloudServerSoftcap = 1.2 (BitNode.tsx:632). So price
      // per GB is flat up to 64GB and then rises 20% per doubling:
      //
      //   <=64GB  $55,000/GB      256GB  $79,200/GB  (+44%)
      //    128GB  $66,000/GB      512GB  $95,040/GB  (+73%)
      //
      // Concentrating was therefore buying the most expensive RAM in the game.
      // Measured on the live fleet: the same $46.3M spent evenly buys 832GB
      // against the 704GB it actually bought, and the gap widens with budget.
      // It also froze 22 of 25 slots at 8-16GB, because only the largest server
      // was ever upgraded.
      //
      // THE TARGET IS $/PLACEABLE-BATCH, NOT $/GB. The knee reasoning above
      // held only while the hack op fit a knee-sized host: it floored at
      // SETTINGS.hackFloor threads (~34GB), and 64GB hosted it. But the hack
      // op grows with the hacking multiplier, and by hacking 958 it was 59
      // threads ~ 100GB against a 226GB full batch — so a 64GB host held ZERO
      // batches (floor(64/226)=0), the whole fleet contributed nothing, and
      // every hack op contended on home: 1,083 placement failures in one life.
      //
      // fleetshape.js picks the size that minimises serverCost / batches-held,
      // reading the largest live batch from the batcher's OWN telemetry — so
      // the target tracks the multiplier instead of freezing at a stale knee.
      // It costs a softcap premium (256GB is $79k/GB vs $55k at the knee), and
      // that premium is the whole point: a placeable block earns while a
      // fragmented one does not. Below-knee batches still land at or under the
      // knee, so nothing changes early; the install-destroys-cloud caution
      // above still holds and is the reason the payback exception in budget.js
      // gates this spend against home.
      //
      // batchGB unreadable -> the knee, exactly the old behaviour, degraded
      // loudly via the status `fleetTarget` field. Never a guessed size: a
      // fleet reshaped on a guess is real money spent on unplaceable RAM.
      // ----------------------------------------------------------------
      const knee = softcapKnee(ns, maxRam)
      let target = knee
      let fleetTgt = null
      try {
        fetchFromHome(ns, BATCH_FILE)
        const bt = JSON.parse(ns.read(BATCH_FILE) || 'null')
        const batchGB = Math.max(0, ...((bt?.targets ?? []).map((t) => t?.plan?.gb).filter((g) => typeof g === 'number' && isFinite(g) && g > 0)))
        if (batchGB > 0) {
          fleetTgt = fleetTarget(batchGB, (r) => ns.cloud.getServerCost(r), { maxRam })
          if (fleetTgt && fleetTgt.slots > 0) target = Math.max(knee, fleetTgt.targetRam)
        }
      } catch {
        /* keep the knee — the status field records which target is in use */
      }
      for (let pass = 0; pass < 12; pass++) {
        const surplus = ns.getServerMoneyAvailable('home') - reserve
        if (surplus <= 0) break

        // SMALLEST server still below the knee. Levelling is what buys the most
        // RAM per dollar once price per GB is flat below the knee and rising
        // above it, and it is what unfreezes the 8-16GB slots the old
        // largest-first rule left behind.
        let pick = null
        for (const host of owned) {
          const ram = ns.getServerMaxRam(host)
          if (ram >= target) continue
          if (!pick || ram < pick.ram) pick = { host, ram }
        }

        if (pick) {
          // Largest affordable doubling, not just one step — fewer, bigger
          // jumps beat many small ones for the same money.
          let next = 0
          for (let r = pick.ram * 2; r <= target; r *= 2) {
            if (ns.cloud.getServerUpgradeCost(pick.host, r) <= surplus) next = r
          }
          if (next) {
            if (!ns.cloud.upgradeServer(pick.host, next)) break
            log.push(`upgraded ${pick.host} ${pick.ram} -> ${next}GB`)
            continue
          }
        }

        // Nothing upgradable within budget: add a server if there is a slot.
        if (owned.length < limit) {
          let ram = 0
          for (let r = 8; r <= target; r *= 2) {
            if (ns.cloud.getServerCost(r) <= surplus) ram = r
          }
          if (!ram) break
          const name = ns.cloud.purchaseServer(`pserv-${Date.now() % 100000}-${pass}`, ram)
          if (!name) break
          owned.push(name)
          log.push(`bought ${name} (${ram}GB)`)
          continue
        }
        break
      }

      const fleet = owned.map((h) => ({ host: h, ram: ns.getServerMaxRam(h) }))
      note('ok', {
        // What a GB of fleet costs at the size this pass buys — progress.js
        // prices the fleet spend's exit comparison with it.
        fleetDollarPerGB: target > 0 ? ns.cloud.getServerCost(target) / target : null,
        money: Math.round(ns.getServerMoneyAvailable('home')),
        reserve,
        hold: holdWhy,
        owned: fleet.length,
        limit,
        fleetRam: fleet.reduce((a, s) => a + s.ram, 0),
        // The block-aware target and why: 'measured' with the batch size and
        // slots each host holds, or 'knee' when the batcher's size was
        // unreadable. A fleet stuck at 0 slots is now a telemetry line.
        target,
        fleetTarget: fleetTgt ? { targetRam: fleetTgt.targetRam, slots: fleetTgt.slots, source: 'measured' } : { targetRam: knee, source: 'knee' },
        fleet,
        log,
      })
      mirror()

      if (log.length) ns.print(log.join('; '))
    } catch (err) {
      // ALWAYS surface the failure. The status write used to be the last
      // statement of this try, so a throw anywhere above it — a v3 arity
      // change in ns.cloud.*, a server upgraded out from under the loop, a bad
      // edit — skipped the only record of what happened. The process stayed
      // alive on its 15s sleep and the status file simply froze, which reads as
      // "nothing worth buying" rather than "not buying".
      //
      // Nested try because the reporting must not be able to become the
      // failure: nothing in here reads the game, and publish() swallows write
      // errors, but the belt is cheap (batch.js does the same).
      try {
        const detail = record(errors, err)
        ns.print(`error: ${detail}`)
        note('error', { reserve, log, detail: describe(err) })
        mirror()
      } catch {
        /* nothing left to try */
      }
    }

    await ns.sleep(interval)
  }
}
