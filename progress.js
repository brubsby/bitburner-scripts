// Drives progression: joins factions, works for reputation, buys programs and
// augmentations, and installs — automatically where the game allows it, and by
// telling a human exactly what to click where it does not.
//
//   run progress.js              act where possible, report the rest
//   run progress.js --dry        decide and report, change nothing
//   run progress.js --no-install never install, even when the trigger is met
//
// ---------------------------------------------------------------------------
// Why it is written this way
//
// Almost everything a player does outside a terminal — joining a faction,
// working for reputation, buying a program, upgrading home RAM, purchasing an
// augmentation, installing — lives behind `ns.singularity.*`, which requires
// Source-File 4. In a BitNode where SF4 is absent those actions cannot be
// scripted at all, and the progression stalls silently: the fleet keeps
// earning, the level keeps climbing, and reputation sits at zero because
// nobody clicked anything.
//
// So this script does not assume either world. It probes for each capability
// once, uses what is available, and writes what it could not do to
// /tel/todo.txt so the gap is visible instead of silent. The same file works
// unchanged on a fresh BitNode 1 with nothing and on a late run with every
// Source-File — it simply does more of the work itself as more becomes
// available.
// ---------------------------------------------------------------------------

const STATUS = '/tel/progress.txt'
const TODO = '/tel/todo.txt'

/**
 * Probe a namespace call once and cache the answer.
 *
 * There is no "do I have Source-File 4" API that does not itself cost RAM, and
 * the SF may be present at level 1 with some calls gated higher, so the honest
 * test is to call the thing and see whether it throws.
 */
function capable(ns, fn) {
  try {
    fn()
    return true
  } catch {
    return false
  }
}

/** Factions that sell hacking augmentations, best first for our purposes. */
const HACK_FACTIONS = [
  'Daedalus',
  'BitRunners',
  'The Black Hand',
  'NiteSec',
  'CyberSec',
  'Netburners',
]

/** Never join these without a reason: they conflict with other city factions. */
const CITY_FACTIONS = ['Sector-12', 'Aevum', 'Volhaven', 'Chongqing', 'New Tokyo', 'Ishima']

export async function main(ns) {
  const flags = ns.flags([
    ['dry', false],
    ['no-install', false],
  ])
  ns.disableLog('ALL')

  const todo = []
  const did = []

  const player = ns.getPlayer()
  const sing = ns.singularity

  // --- capability probes, each cheap and done once ---------------------------
  const canJoin = sing && capable(ns, () => sing.getOwnedAugmentations(false))
  const canWork = canJoin && typeof sing.workForFaction === 'function'
  const canBuyAug = canJoin && typeof sing.purchaseAugmentation === 'function'
  const canInstall = canJoin && typeof sing.installAugmentations === 'function'

  // --- 1. accept invitations -------------------------------------------------
  const invites = canJoin ? sing.checkFactionInvitations() : (player.factionInvitations ?? [])
  const wanted = invites.filter((f) => !CITY_FACTIONS.includes(f))
  for (const f of wanted) {
    if (canJoin && !flags.dry) {
      if (sing.joinFaction(f)) did.push(`joined ${f}`)
    } else {
      todo.push(`Accept the ${f} invitation (Factions tab).`)
    }
  }
  for (const f of invites.filter((f) => CITY_FACTIONS.includes(f))) {
    todo.push(`${f} invite pending — a city faction. Joining splits contract reputation and conflicts with the other cities. Left alone deliberately.`)
  }

  // --- 2. make sure reputation is actually being earned ----------------------
  // This is the failure that matters most: with no faction work running, the
  // one quantity that cannot be bought earns nothing, and everything else in
  // the game looks perfectly healthy while it happens.
  const factions = canJoin ? sing.getOwnedAugmentations && player.factions : player.factions
  const work = player.currentWork

  if (!factions || factions.length === 0) {
    todo.push('NO FACTION JOINED — reputation is earning ZERO. Backdoor a story server (run findpath.js <server>) and accept the invite.')
  } else if (!work || work.type !== 'FACTION') {
    const target = HACK_FACTIONS.find((f) => factions.includes(f)) ?? factions[0]
    if (canWork && !flags.dry) {
      if (sing.workForFaction(target, 'hacking', true)) did.push(`working for ${target}, focused`)
      else todo.push(`Could not start faction work for ${target} — start it manually.`)
    } else {
      todo.push(`NO FACTION WORK RUNNING — reputation is earning ZERO. Start hacking contracts for ${target} and FOCUS it (unfocused costs 20%).`)
    }
  } else if (player.focus === false) {
    if (canWork && !flags.dry) {
      sing.setFocus(true)
      did.push('refocused faction work')
    } else {
      todo.push('Faction work is UNFOCUSED — costs 20% of the rate. Click Focus, then verify a few seconds later; it has been seen reverting.')
    }
  }

  // --- 3. port programs ------------------------------------------------------
  // Each one unlocks a tier of servers to root, and rooting is gated on open
  // ports alone, never on hacking level — so they are worth buying the moment
  // they are affordable, at any level.
  const PROGRAMS = [
    ['BruteSSH.exe', 500e3],
    ['FTPCrack.exe', 1.5e6],
    ['relaySMTP.exe', 5e6],
    ['HTTPWorm.exe', 30e6],
    ['SQLInject.exe', 250e6],
  ]
  const hasTor = canJoin ? sing.purchaseTor && ns.serverExists('darkweb') : ns.serverExists('darkweb')
  if (!hasTor) {
    if (canJoin && !flags.dry && ns.getServerMoneyAvailable('home') > 200e3) {
      if (sing.purchaseTor()) did.push('bought TOR')
    } else todo.push('Buy the TOR router ($200k) — gates every port program.')
  }
  for (const [file, price] of PROGRAMS) {
    if (ns.fileExists(file, 'home')) continue
    if (canJoin && !flags.dry && ns.getServerMoneyAvailable('home') > price * 2) {
      if (sing.purchaseProgram(file)) did.push(`bought ${file}`)
    } else if (ns.getServerMoneyAvailable('home') > price) {
      todo.push(`Buy ${file} ($${(price / 1e6).toFixed(1)}m) — unlocks a tier of servers to root.`)
    }
  }

  // --- 4. augmentations ------------------------------------------------------
  // Reputation is not consumed by a purchase, only money is, and the money cost
  // multiplies by 1.9^(already queued) — so buy the most expensive first. Every
  // NeuroFlux level counts toward the 30 augmentations Daedalus requires, which
  // makes short install cycles the fast route rather than a compromise.
  let queued = 0
  if (canBuyAug && !flags.dry) {
    const owned = new Set(sing.getOwnedAugmentations(true))
    const offers = []
    for (const f of player.factions) {
      for (const aug of sing.getAugmentationsFromFaction(f)) {
        if (owned.has(aug) && aug !== 'NeuroFlux Governor') continue
        const rep = sing.getAugmentationRepReq(aug)
        if (sing.getFactionRep(f) < rep) continue
        offers.push({ faction: f, aug, price: sing.getAugmentationPrice(aug) })
      }
    }
    offers.sort((a, b) => b.price - a.price)
    for (const o of offers) {
      if (ns.getServerMoneyAvailable('home') < o.price) continue
      if (sing.purchaseAugmentation(o.faction, o.aug)) {
        queued++
        did.push(`queued ${o.aug} ($${(o.price / 1e6).toFixed(0)}m)`)
      }
    }
  } else if (!canBuyAug) {
    todo.push('Augmentation purchases need Source-File 4 — buy them in the Factions UI, MOST EXPENSIVE FIRST (money cost multiplies 1.9x per already-queued aug; reputation cost does not).')
  }

  // --- 5. install ------------------------------------------------------------
  // Money and purchased servers are destroyed by an install; home RAM and
  // augmentations survive. So there is never a reason to hold cash through one.
  if (queued > 0) {
    if (canInstall && !flags['no-install'] && !flags.dry) {
      ns.write(STATUS, JSON.stringify({ at: new Date().toISOString(), did, installing: queued }, null, 2), 'w')
      did.push(`installing ${queued} augmentation(s)`)
      sing.installAugmentations('boot.js')
      return // the game reloads; boot.js brings the stack back up
    }
    todo.push(`${queued} augmentation(s) queued — install them (Augmentations tab). Money is wiped by an install, so spend it all first.`)
  }

  const report = { at: new Date().toISOString(), capabilities: { canJoin, canWork, canBuyAug, canInstall }, did, todo }
  ns.write(STATUS, JSON.stringify(report, null, 2), 'w')
  ns.write(TODO, JSON.stringify({ at: report.at, todo }, null, 2), 'w')

  for (const d of did) ns.tprint(`progress: ${d}`)
  for (const t of todo) ns.tprint(`progress: TODO ${t}`)
  if (!did.length && !todo.length) ns.tprint('progress: nothing to do')
}
