// TOR, the port-opening programs, and home RAM/cores — through the Singularity
// API, with no human, no browser and no UI lock.
//
//   run sing-shop.js                  buy what is affordable, spend home down
//                                     to the default reserve, exit
//   run sing-shop.js --reserve 0      spend every dollar on home (pre-install)
//   run sing-shop.js --dry            say what it would do, buy nothing
//   run sing-shop.js --no-home        TOR and programs only
//   run sing-shop.js --no-programs    home only
//
// One-shot by design: it acts once and exits, so the director (or watchdog)
// decides the cadence and nothing sits resident holding 13.8GB of a 32GB home.
//
// ---------------------------------------------------------------------------
// This replaces torbuy.js + autobuy.js + homeup.js, which between them drove
// the City map, the Alpha Enterprises buttons and the terminal `buy` command.
// Everything those learned is carried over; what is dropped is only the DOM:
//
//   - **No UI lock, no eval('document'), no navigation.** The lock existed so
//     upkeep.js would not click Focus mid-sequence and drag the screen away,
//     and so two UI scripts would not fight over the page. None of that can
//     happen here — there is no page. `eval('document')` would also cost 25GB
//     (RamCostConstants.Dom), which alone is most of a 32GB home.
//   - **No "did the click apply?" verification.** homeup.js had to re-read
//     maxRam/cpuCores after every click because a disabled MUI button swallows
//     .click() with no error, and it logged two purchases that never happened
//     before that was added. `upgradeHomeRam()` and `upgradeHomeCores()` return
//     a boolean (Singularity.ts:568-627), so success is stated rather than
//     inferred.
//   - **No `connect darkweb` / terminal fallback.** That path existed only
//     because purchaseProgram needs SF4. We are in BitNode 4.
//
// What is carried over, because it is still true:
//
//   - **`ns.serverExists('darkweb')` is NOT a TOR test.** The darkweb server is
//     in the server list from the first second of a BitNode; buying TOR merely
//     *connects* it to home (getTorRouter() -> connectServers, ServerHelpers.ts
//     :354-356). autobuy.js believed TOR was owned for half an hour and queued
//     `buy FTPCrack.exe` every 60s into a terminal answering "You need to be
//     able to connect to the Dark Web". The predicate is `ns.hasTorRouter()`
//     (0.05GB, no Source-File — RamCostGenerator.ts:591), which is literally
//     `home.serversOnNetwork.includes('darkweb')`.
//   - **Port openers are the best conversion of money into progress there is.**
//     Rooting is gated on open ports alone, never on hacking level, so each one
//     unlocks a whole tier of servers at once — relaySMTP unlocked 688GB for
//     $5m, about $7.3k/GB against the cloud's flat $55k/GB. They are bought
//     ahead of home RAM and ignore --reserve for that reason.
//   - **Home RAM and cores are the only purchases that survive an install.**
//     prestigeHomeComputer (Server/ServerHelpers.ts:226-239) clears programs,
//     serversOnNetwork and ramUsed and touches NEITHER maxRam NOR cpuCores,
//     while money resets to $1262 plus each owned aug's startingMoney. We once installed holding $2.07 QUADRILLION.
//     `--reserve 0` is the pre-install spend-down; sing-install.js does it
//     itself rather than calling this, so that spending and installing cannot
//     be separated by anything.
//   - **Expect TOR to be gone after every install.** serversOnNetwork = []
//     breaks the darkweb link, so hasTorRouter() goes false and it has to be
//     re-bought. This script is idempotent and safe to run on every boot.
//
// One thing that is now easier and used to be a trap: homeup.js could not read
// the price of an upgrade it could not afford, because RamButton.tsx:49 renders
// `disabled={!Player.canAfford(cost) || reachMaxRam}` — so "too expensive" and
// "maxed out" look identical, and it published `nextCost: null` ("everything
// maxed") while sitting at 7 cores. Prices here are computed, never read off a
// control, so that ambiguity cannot come back.
// ---------------------------------------------------------------------------

// Free to import: both reference no ns function beyond the 1.6GB script base.
// Checked, not assumed — `calculateRam` on the live game returns exactly 1.6
// for each.
import { reporter, describe, record } from 'status.js'
import { MAX_HOME_RAM, MAX_HOME_CORES, ramUpgradeCost, coreUpgradeCost } from 'homecost.js'

const STATUS = '/tel/sing-shop.txt'

/** CONSTANTS.TorRouterCost, Constants.ts:44. */
const TOR_COST = 200e3

// Names must match CompletedProgramName exactly (Programs/Enums.ts:1-17):
// getDarkwebProgramCost THROWS on an unrecognised name (Singularity.ts:1092-1099)
// rather than returning -1, so a typo here kills the script instead of skipping
// a purchase. purchaseProgram itself is case-insensitive; this is not.
//
// Prices are NOT hardcoded. autobuy.js carried its own table, which was correct
// in BitNode 1 and is exactly the kind of constant CLAUDE.md warns about —
// getDarkwebProgramCost costs 0.5GB (SingularityFn1/4) and returns the game's
// number, including 0 for a program already owned, which also saves the 0.1GB
// ns.fileExists check autobuy needed.
const PROGRAMS = [
  // Port openers, cheapest first: each unlocks a tier of servers, and buying
  // them in this order maximises how many land per tick when money is tight.
  'BruteSSH.exe',
  'FTPCrack.exe',
  'relaySMTP.exe',
  'HTTPWorm.exe',
  'SQLInject.exe',
  // Not a port opener. It unlocks ns.formulas, which costs 0GB per call
  // (RamCostGenerator 695-706) and lets batch.js ask the game for exact numbers
  // instead of using its inlined ports of the game's math. Last, and held to a
  // stricter headroom, because at $5b it is the only entry here that can
  // meaningfully compete with an augmentation for the same dollar.
  'Formulas.exe',
]

// Never spend the last dollar out from under something else mid-purchase. The
// port openers are cheap enough that 1.5x is free insurance; Formulas at $5b
// gets 3x so it cannot eat a NeuroFlux level.
const HEADROOM = 1.5
const FORMULAS_HEADROOM = 3

/**
 * How many cores home has, recovered from what the next one costs.
 *
 * `ns.getServer('home').cpuCores` is the obvious way and costs 2GB
 * (RamCostGenerator.ts:617). `ns.singularity.getUpgradeHomeCoresCost()` is
 * 1.5GB (SingularityFn2/2, line 179) and returns the game's own
 * `Player.getUpgradeHomeCoresCost()` = 1e9 * 7.5^cores
 * (PlayerObjectServerMethods.ts:42) — so it is both cheaper AND the
 * authoritative price rather than our re-derivation of it. The core count is
 * exactly recoverable from it: 7.5^c for c in 0..8 are far enough apart that
 * rounding the logarithm is not a judgement call.
 *
 * homecost.js's coreUpgradeCost is still used, as a check on that claim rather
 * than as the source — see `drift` in the status file.
 */
const coresFromCost = (cost) => Math.round(Math.log(cost / 1e9) / Math.log(7.5))

export async function main(ns) {
  const flags = ns.flags([
    // Dollars to hold back from HOME upgrades only. TOR and the port openers
    // ignore it: they are strictly higher value per dollar than anything else
    // in the game and they gate the fleet.
    ['reserve', 0],
    ['dry', false],
    ['no-home', false],
    ['no-programs', false],
    // A stuck upgrade loop would otherwise spin forever on a game that keeps
    // saying yes. 60 doublings is more than the RAM cap allows.
    ['max', 60],
  ])
  ns.disableLog('ALL')

  const errors = []
  const bought = []
  const notes = []
  // `nextCost` is what the watchdog/director gates the next run on. null means
  // genuinely nothing left to buy — never "we could not find out".
  let nextCost = null

  const note = reporter(ns, STATUS, () => ({
    bought,
    notes: notes.slice(-12),
    nextCost,
    errors: errors.slice(-5),
  }))

  // The path no try/finally can reach: a kill, a killall, an install, or a
  // throw past every handler. ns.atExit is 0GB (RamCostGenerator.ts:605) and
  // runs before the worker is torn down, so ns.write still works there. Five
  // scripts wrote nothing on error for most of BitNode 1 and it cost hours.
  let settled = false
  ns.atExit(() => {
    if (!settled) {
      note.exit('stopped', { detail: 'sing-shop.js exited without reporting — killed mid-run, or threw past every handler' })
    }
  })

  try {
    const sing = ns.singularity
    const money = () => ns.getServerMoneyAvailable('home')

    // ---- TOR -------------------------------------------------------------
    //
    // Idempotent: purchaseTor returns true and charges nothing when it is
    // already owned (Singularity.ts:399-402). The hasTorRouter check is here
    // only so the status file can say which of those two happened.
    let tor = ns.hasTorRouter()
    if (!tor) {
      if (money() < TOR_COST * HEADROOM) {
        notes.push(`TOR: need $${Math.round(TOR_COST * HEADROOM)}, have $${Math.round(money())}`)
        nextCost = TOR_COST * HEADROOM
      } else if (flags.dry) {
        notes.push(`TOR: would buy for $${TOR_COST}`)
      } else if (sing.purchaseTor()) {
        tor = true
        bought.push('TOR router')
      } else {
        notes.push('TOR: purchaseTor() refused — money moved between the check and the call?')
      }
    }

    // ---- port programs ----------------------------------------------------
    //
    // Everything affordable, in one pass, against a running budget. autobuy.js
    // bought one per tick and re-read the balance between purchases, which made
    // sense when one program was a real fraction of net worth and meant six
    // programs took six minutes once it was not. Checking the CUMULATIVE cost
    // is what that was really protecting against, and it stays correct when
    // money is tight.
    if (tor && !flags['no-programs']) {
      let budget = money()
      for (const file of PROGRAMS) {
        // 0 means "already owned" (Singularity.ts:1100-1103); -1 means no TOR,
        // which cannot happen inside this branch.
        const cost = sing.getDarkwebProgramCost(file)
        if (cost === 0) continue
        if (cost < 0) {
          notes.push(`${file}: no TOR router (getDarkwebProgramCost returned -1)`)
          break
        }
        const need = cost * (file === 'Formulas.exe' ? FORMULAS_HEADROOM : HEADROOM)
        if (budget < need) {
          notes.push(`${file}: need $${Math.round(need)}, budget $${Math.round(budget)}`)
          if (nextCost === null || need < nextCost) nextCost = need
          continue
        }
        if (flags.dry) {
          notes.push(`${file}: would buy for $${Math.round(cost)}`)
          budget -= cost
          continue
        }
        if (sing.purchaseProgram(file)) {
          bought.push(`${file} ($${Math.round(cost)})`)
          budget -= cost
        } else {
          notes.push(`${file}: purchaseProgram() refused`)
        }
      }
    } else if (!tor) {
      notes.push('programs: skipped, no TOR router')
    }

    // ---- home RAM and cores ----------------------------------------------
    //
    // Cheapest-of-the-two each step, which is what homecost.nextHomeUpgrade
    // encodes: cores multiply grow/weaken effectiveness on every op home runs
    // (1 + (cores-1)/16, ServerHelpers.ts:315) and cap at 8, while RAM
    // doublings escalate by 1.58x forever — so cores win while they are cheap
    // and RAM wins after. Taking the cheaper of the two makes "can I afford
    // anything?" exact instead of a preference.
    if (!flags['no-home']) {
      for (let step = 0; step < flags.max; step++) {
        const ram = ns.getServerMaxRam('home')
        const coreCost = sing.getUpgradeHomeCoresCost()
        const cores = coresFromCost(coreCost)

        // Free calibration. homecost.js re-derives the game's formulas rather
        // than calling them, and carries BitNodeMultipliers.HomeComputerRamCost
        // as a documented un-read assumption (it is 1 in BitNode 4 — BitNode.tsx
        // :627-655 does not set it, so BitNodeMultipliers.ts:115 applies). This
        // is the one place a live number is available for free, so check it and
        // publish the error rather than hoping. CLAUDE.md: an offline model
        // whose output drives a decision must reproduce a live quantity and
        // print the error, whether it passes or fails.
        const modelled = coreUpgradeCost(cores)
        const drift = coreCost > 0 ? Math.abs(modelled - coreCost) / coreCost : 0
        if (step === 0) notes.push(`homecost.coreUpgradeCost drift vs game: ${(drift * 100).toFixed(4)}%`)
        if (drift > 0.001) {
          notes.push(`STOP: homecost.js disagrees with the game on core price ($${Math.round(modelled)} vs $${Math.round(coreCost)}) — not spending on a model that is wrong`)
          break
        }

        const options = []
        if (cores < MAX_HOME_CORES) options.push({ kind: 'cores', cost: coreCost })
        if (ram < MAX_HOME_RAM) options.push({ kind: 'RAM', cost: ramUpgradeCost(ram) })
        if (!options.length) {
          // Leave nextCost alone: a pending TOR or program price is still the
          // cheapest thing left to wait for, and clearing it here would publish
          // "nothing left to buy" while a port opener is still unaffordable —
          // the same ambiguity homeup.js used to have in the other direction.
          notes.push(`home is fully upgraded (${ram}GB / ${cores} cores)`)
          break
        }
        const pick = options.reduce((a, b) => (b.cost < a.cost ? b : a))

        if (money() - pick.cost < flags.reserve) {
          notes.push(`home: next is ${pick.kind} at $${Math.round(pick.cost)}, have $${Math.round(money())} (reserve $${flags.reserve})`)
          if (nextCost === null || pick.cost + flags.reserve < nextCost) nextCost = pick.cost + flags.reserve
          break
        }
        if (flags.dry) {
          notes.push(`home: would buy ${pick.kind} for $${Math.round(pick.cost)} (now ${ram}GB / ${cores} cores)`)
          break
        }

        // The return value is the game's own verdict, so there is nothing to
        // verify afterwards. False here means money moved underneath us or we
        // hit a cap the check above did not model — either way, stop.
        const done = pick.kind === 'cores' ? sing.upgradeHomeCores() : sing.upgradeHomeRam()
        if (!done) {
          notes.push(`home: ${pick.kind} upgrade refused at $${Math.round(pick.cost)} — stopping`)
          break
        }
        bought.push(`home ${pick.kind} ($${Math.round(pick.cost)})`)
      }
    }

    settled = true
    note(bought.length ? 'ok' : 'waiting', {
      result: bought.length ? 'ok' : 'waiting',
      tor: ns.hasTorRouter(),
      homeRam: ns.getServerMaxRam('home'),
      homeCores: coresFromCost(ns.singularity.getUpgradeHomeCoresCost()),
      money: Math.round(ns.getServerMoneyAvailable('home')),
      detail: bought.length ? `bought ${bought.length}: ${bought.join(', ')}` : (notes[notes.length - 1] || 'nothing to do'),
    })
    if (bought.length) ns.tprint(`sing-shop: ${bought.join(', ')}`)
  } catch (err) {
    // ALWAYS surface it. A throw that leaves the status file frozen on the last
    // good tick is indistinguishable from a game that stopped changing.
    settled = true
    try {
      ns.print(`sing-shop error: ${record(errors, err)}`)
      note('error', { result: 'error', detail: describe(err) })
    } catch {
      /* nothing left to try */
    }
  }
}
