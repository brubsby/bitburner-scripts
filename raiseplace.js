// raiseplace.js — THE PLACEMENT GUARANTEE FOR EVERY RAISE-SIZED DAEMON
// (watchdog.js places, batch.js and seed.js honour). PURE, imports nothing.
//
// A raise-sized daemon declares a small floor with ns.ramOverride (which the
// game's static calculator honours — RamCalculations.ts:354-384 — so
// ns.getScriptRam reads the floor too) and raises to its full price ON ITS
// OWN HOST before its first expensive call (ramgrow.js; a denied raise
// exits). So the binding block is the RAISED figure free on one host at
// launch: placed by the floor it lands on a small host and exits seconds
// later.
//
// Until 2026-10-03 only boot.js placed these, once per boot, and nothing
// retried. Live BN4: bladeburner.js never placed at the 128GB tier (both
// 128GB hosts full of early.js, 02:10Z); sleeve.js absent from the 03:08Z
// install to 09:20Z — boot.js placed it on millenium-fitness at 09:18Z, which
// batch.js had filled, and the raise was denied ("ns.ramOverride(49.75)
// returned 3.25"). Six hours with no sleeve driver on the node chosen partly
// for sleeves.
//
// The rules, one per daemon in RAISED (raisedPlacementOf):
//   - a copy already running anywhere is satisfied (the watchdog checks
//     before it places: no double placement);
//   - nothing below the home tier boot.js admits it at, nor on a route that
//     does not want it (bladeburner.js on a committed 'hack' route);
//   - home first (progress.js's block kept), else the tightest rooted host
//     with the raised block free;
//   - else RESERVE the tightest host whose workers, once gone, leave it:
//     batch.js's h/g/w drain within a batch cycle (batch.js stops refilling
//     the reserved block), seed.js's early.js/hgw.js never exit and are
//     evicted on that host (seed.js stops refilling it); the watchdog places
//     the daemon as soon as the block is free;
//   - blocked by name when no host could ever hold it;
//   - a launch whose raise is denied is simply retried the next cycle.
// Each daemon's reservation is its own file (RAISED[s].file), on home.

/** What a batch cycle frees by itself: batch.js's workers (SETTINGS.workers). */
export const FREEABLE = ['h.js', 'g.js', 'w.js']
/**
 * What never frees itself: seed.js's workers loop forever (early.js, hgw.js).
 * Live BN4 2026-10-03 02:10Z: 53 early.js threads on each 128GB host at the
 * tier that admits bladeburner.js. The watchdog kills them on the reserved host.
 */
export const EVICTABLE = ['early.js', 'hgw.js']
/** A reservation older than this is ignored (the watchdog rewrites it every 30s cycle). */
export const RESERVE_FRESH_MS = 2 * 60e3

/**
 * Every raise-sized daemon boot.js places 'anywhere': its raised price (the
 * script's RAISE_CEILING, boot.js raisesTo), the tier boot.js admits it at,
 * its reservation file, and whether a committed route gates it. [RP1] holds
 * these equal to the scripts and the manifest.
 */
export const RAISED = {
  'bladeburner.js': { gb: 92.75, tier: 128, file: '/tel/bb-full-reserve.txt', route: 'blade' },
  'sleeve.js': { gb: 49.75, tier: 64, file: '/tel/reserve-sleeve.txt', route: null },
  'hashspend.js': { gb: 7.25, tier: 32, file: '/tel/reserve-hashspend.txt', route: null },
  // NOT raise-sized: go.js's static price, placed by goPlacementOf only where
  // the priced verdict says so (see GO FIRST below), at any home size. In RAISED so that
  // its reservation is honoured exactly like the others (batch.js and seed.js
  // read reservesOf). Callers size it by ns.getScriptRam; [GF] holds this
  // figure to the priced script.
  'go.js': { gb: 20.75, tier: 8, file: '/tel/reserve-go.txt', route: null },
}

const num = (x) => typeof x === 'number' && isFinite(x)

/** Does the route want a route-gated daemon? Only a committed HACKING route in this node says no. */
export function routeWantsOf(plan, node) {
  if (plan && typeof plan === 'object' && plan.node === node) {
    const key = plan.decisions?.bladeRoute?.key
    if (key === 'hack') return { wants: false, why: `the route is 'hack' in BitNode ${node} (plan.txt decisions.bladeRoute): no 92.75GB taken from the batcher for a division the plan is not playing` }
    if (key === 'blade') return { wants: true, why: 'the committed Bladeburner route' }
  }
  return { wants: true, why: 'the route is undecided this node: the division exists, placed as boot.js places it' }
}

/**
 * Where `script` goes this cycle.
 *   script        a key of RAISED (or pass need/tier/route explicitly)
 *   homeMax       home's max RAM (the tier)
 *   plan, node    /tel/plan.txt and getResetInfo().currentNode (routeWantsOf; route-gated daemons only)
 *   hosts         [{host, max, used, workerGb, evictGb, hacknet?}] — ROOTED hosts; workerGb: batch.js's h/g/w
 *                 (a batch cycle frees it), evictGb: seed.js's (freed only by a kill, made on the reserved host)
 *   homeBlock     progress.js's home block (13 + 6.25 x mult), kept unless progress.js is running
 *   prev          the last reservation record: its host is kept while it qualifies
 * Returns {action: 'wait' | 'place' | 'reserve' | 'blocked', admitted, host?, gb?, evict?, why}.
 * `admitted`: the tier and the route want it — its absence is then a fault the
 * healthcheck times.
 */
export function raisedPlacementOf({ script = null, homeMax, plan = null, node = null, hosts = [], homeBlock = 0, progressRunning = false, prev = null, need = RAISED[script]?.gb, tier = RAISED[script]?.tier, route = RAISED[script]?.route ?? null, homeKeep = 0 }) {
  const name = script ?? 'the daemon'
  if (!num(need) || !num(tier)) return { action: 'blocked', admitted: false, why: `${name}: no raised price or tier (not in RAISED)` }
  if (!(num(homeMax) && homeMax >= tier)) return { action: 'wait', admitted: false, why: `home ${homeMax}GB is under the ${tier}GB tier boot.js admits ${name} at` }
  const rw = route === 'blade' ? routeWantsOf(plan, node) : { wants: true, why: 'not route-gated' }
  if (!rw.wants) return { action: 'wait', admitted: false, why: rw.why }
  const ok = hosts.filter((h) => h && h.host && !h.hacknet && num(h.max) && num(h.used))
  // homeKeep: room kept free on home BESIDES progress.js's block (go.js keeps
  // act.js's actor headroom there: GO FIRST below). 0 for every other caller.
  const keep = (h) => (h.host === 'home' ? (!progressRunning ? homeBlock : 0) + (num(homeKeep) && homeKeep > 0 ? homeKeep : 0) : 0)
  const free = (h) => h.max - h.used - keep(h)
  const capNoReloc = (h) => free(h) + (num(h.workerGb) ? h.workerGb : 0) + (num(h.evictGb) ? h.evictGb : 0)
  // relocGb: daemons that can be moved OFF this host (only seed.js's go
  // placement passes it, for home: RELOCATABLE below). 0 when absent.
  const capNoYield = (h) => capNoReloc(h) + (num(h.relocGb) ? h.relocGb : 0)
  // yieldGb: home residents go.js outranks (GO_OUTRANKS; seed.js's go
  // placement only), stopped last — after the worker and the relocations.
  const cap = (h) => capNoYield(h) + (num(h.yieldGb) ? h.yieldGb : 0)
  const f = (x) => x.toFixed(2)
  const home = ok.find((h) => h.host === 'home')
  if (home && free(home) >= need) return { action: 'place', admitted: true, host: 'home', gb: need, why: `home has ${f(free(home))}GB free beyond progress.js's block (${rw.why})` }
  const fits = ok.filter((h) => h.host !== 'home' && free(h) >= need).sort((a, b) => free(a) - free(b) || (a.host < b.host ? -1 : 1))
  if (fits.length) return { action: 'place', admitted: true, host: fits[0].host, gb: need, why: `${fits[0].host} has ${f(free(fits[0]))}GB free (tightest fit; home ${home ? f(free(home)) : '?'}GB) — ${rw.why}` }
  const cands = ok.filter((h) => cap(h) >= need)
  if (!cands.length) {
    const best = [...ok].sort((a, b) => cap(b) - cap(a))[0]
    return { action: 'blocked', admitted: true, why: `no rooted host can hold ${name}'s ${need}GB even with the batch and seed workers gone — largest ${best ? `${best.host} ${f(cap(best))}GB of ${best.max}GB` : 'none'}: root a bigger server or grow home` }
  }
  // A host that needs nothing outranked stopped beats one that does.
  const pool = cands.some((h) => capNoYield(h) >= need) ? cands.filter((h) => capNoYield(h) >= need) : cands
  const pick = pool.find((h) => h.host === prev?.host) ?? pool.find((h) => h.host === 'home') ?? pool.sort((a, b) => cap(a) - cap(b) || (a.host < b.host ? -1 : 1))[0]
  const evict = num(pick.evictGb) && pick.evictGb > 0
  // Moved off only when the block needs them: workers and evictions first.
  const relocate = num(pick.relocGb) && pick.relocGb > 0 && capNoReloc(pick) < need
  // How much of the outranked residents must stop (largest first is the caller's).
  const yieldNeed = num(pick.yieldGb) && pick.yieldGb > 0 && capNoYield(pick) < need ? need - capNoYield(pick) : 0
  // The hacking workers the block takes (what goplace's verdict charges): the
  // shortfall, at most the workers there — the rest is relocated/outranked
  // daemons. On HOME every evicted worker is lost, not just the shortfall:
  // seed.js never refills home (boot.js owns its worker), while a fleet
  // host's leftover is refilled next pass.
  const wk = (num(pick.workerGb) ? pick.workerGb : 0) + (num(pick.evictGb) ? pick.evictGb : 0)
  const short = Math.max(0, need - free(pick))
  const workersGb = Math.min(wk, pick.host === 'home' && evict ? Math.max(short, pick.evictGb) : short)
  return { action: 'reserve', admitted: true, host: pick.host, gb: need, evict, relocate, workersGb, ...(yieldNeed > 0 ? { yieldGb: yieldNeed } : {}), why: `no host has ${need}GB free; ${pick.host} has ${f(free(pick))}GB free and ${f(cap(pick))}GB once its workers go${evict ? ` (seed.js's ${f(pick.evictGb)}GB evicted now)` : ''}${relocate ? ` (and ${f(pick.relocGb)}GB of daemons moved off it)` : ''}${yieldNeed > 0 ? ` (and ${f(yieldNeed)}GB of ${GO_OUTRANKS.join('/')} stopped: go.js outranks them)` : ''} — batch.js and seed.js leave ${need}GB there and the watchdog places ${name} as soon as it is free` }
}

// ---------------------------------------------------------------------------
// GO FIRST: go.js wherever its farm is worth the RAM it takes.
//
// boot.js admits go.js on home at the 128GB tier (rank 20). Below it (and
// beyond home from it), whether go.js is placed is a PRICED decision —
// goplace.js goPlaceValueOf: the money to the 128GB home tier simulated WITH
// go.js placed now (its farm on the best money arm at the measured rate, the
// hacking workers it displaces gone, a bought server paid up front) and
// WITHOUT it (waiting for the tier), on one set of inputs. It replaced a fixed
// threshold here on 2026-10-07 (GO_FIRST_EFFECT: effective Go power >= 4, i.e.
// BitNode 14 only): live BN9.2, entered FOR the Go farm, read "effective Go
// power 2 < 4: go.js at its 128GB home tier" with $115k/s of hacknet
// production waiting on Netburners and four early.js threads (~$0.3/s) the
// only thing a 32GB home would have displaced. BitNode 14 (GoPower 4 x2) is a
// case of the priced rule: there the same comparison places go.js on the
// 32GB opening (live BN14.1 2026-10-03, entered ~18:45Z: go.js idle until the
// lead ran it by hand at 19:02Z).
//
// Placement once the verdict says place, by RANK and not by squeezing the
// plan: boot.js's manifest and its tier checks are unchanged (boot.js would
// need getResetInfo, 1GB of launcher, which at the 64GB tier is the watchdog's
// slot). Instead the two placers that already pay for the reads do it, from
// any home size:
//   - seed.js (tier 8 until 128), every pass, and watchdog.js (64 up), every
//     cycle, through goPlacementOf -> raisedPlacementOf, script 'go.js';
//   - home only with act.js's WHOLE action slot kept beside it
//     (goHomeKeepOf -> actionSlotOf: the largest actor act.js will launch in
//     this node, 9.25GB at SF4.3 below the watchdog tier — it was a flat
//     19.4GB, act-liquidate.js, which kept go.js off a 32GB home in BN14.2)
//     and progress.js's block where the watchdog runs it. It outranks the
//     home worker (early.js/hgw.js are EVICTABLE) and, from seed.js, the
//     RELOCATABLE daemons and the GO_OUTRANKS residents, never the slot: at
//     SF4.3 a 32GB home holds go.js (20.75 + 9.25 = 30GB);
//   - else the tightest fleet host with the room, else a host RESERVED and its
//     seed workers evicted (seed.js and batch.js honour the reservation),
//     else blocked by name (an 8GB opening with no 32GB host rooted) — and
//     then seed.js buys a server for it the moment cash covers one
//     (goHostBuyOf; live BN14.1 the lead bought 'go-host' by hand at 20:50Z),
//     its price paid up front in the priced comparison.
// The comparison is charged what the placement takes: raisedPlacementOf's
// `workersGb` on a reserve (the hacking workers evicted for the block).
// go.js talks to the solver through home's /go files from wherever it runs.

/**
 * act.js's actors (act-*.js). go.js on home keeps the WHOLE action slot free
 * beside it: the same figure boot.js reserves (stack.js's action slot),
 * actionSlotOf below. Live BN14.1 from 18:59Z to 20:49Z go.js ran on a 32GB
 * home and act.js placed nothing (no gym, no home-RAM purchase; BOOTSTRAP
 * STALLED) — not because the routine actors were the wrong size but because
 * the slot itself was eaten after go.js landed (hashspend.js, and boot.js's
 * spawned early.js: 4GB left). goHomeRepairOf and boot.js's measured spawn
 * keep it now. go.js outranks the home WORKER (early.js), never act.js's
 * slot. [GF] fails when a new act-*.js is in neither list.
 */
export const ROUTINE_ACTORS = ['act-backdoor.js', 'act-buyaug.js', 'act-buyprogram.js', 'act-company.js', 'act-course.js', 'act-crime.js', 'act-donate.js', 'act-focus.js', 'act-gym.js', 'act-homeram.js', 'act-install.js', 'act-join.js', 'act-softreset.js', 'act-stop.js', 'act-travel.js', 'act-work.js']
export const RARE_ACTORS = ['act-liquidate.js', 'act-graft.js']

/**
 * act.js's OTHER one-shots: the snapshot readers (snapshot.js SNAPSHOTS), run
 * by act.js's refreshSnapshots every loop (the static families once per node)
 * through the same "any rooted host with room" path as an actor. snap-static.js
 * is 9.25GB at SF4.3 — larger than every routine act-*.js there (8.25GB) — so
 * the slot that leaves them out is too small. [GF10] holds this to SNAPSHOTS.
 */
export const SNAP_ACTORS = ['snap-owned.js', 'snap-catalog.js', 'snap-augprice.js', 'snap-rep.js', 'snap-invites.js', 'snap-augstats.js', 'snap-prereq.js', 'snap-static.js']

// ---------------------------------------------------------------------------
// THE ACTION SLOT, SIZED TO WHAT act.js WILL ACTUALLY LAUNCH.
//
// It was the largest act-*.js on disk: act-liquidate.js, 19.4GB at every SF4
// level (a stock call, not a Singularity one). At SF4.3 every Singularity
// actor is <= 8.25GB, so on a 32GB home the 19.4GB slot kept go.js (20.75GB)
// off home with nowhere else to go. Live BN14.2 (2026-10-05) Go at x8 idled
// ~2h at node start; the lead ran go.js on home by hand, 11.3GB stayed free,
// and act.js placed its actors (crime: Mug) without a refusal.
//
// The two RARE actors launch only in a known shape, and both shapes are cheap
// to read:
//   - act-liquidate.js: before an install it always runs, but there act.js
//     goes ahead without it unless /tel/stock.txt reports equity
//     (act.js: `liq.ok !== true && equity > 0` is the only refusal); the
//     raises it serves sell the book, so without a book there is nothing to
//     raise. Counted while this life's trader record holds equity > 0.
//   - act-graft.js: the graft order comes only from progress.js (actplan's
//     bootstrap never grafts: paid up front), which runs from the watchdog
//     tier (JOB_RUNNER_TIER) — and only where grafting exists at all
//     (sfgate.canUseGrafting: BitNode 10 or SF10). Unknown access counts it.
// The routine actors and the snapshot readers always count. Every price is
// ns.getScriptRam on home, which already carries the SF4 multiplier.
// A deployed act-*.js / snap-*.js in neither list (`files`) counts too: a new
// actor never silently outgrows the slot (boot.js passes ns.ls).

/** Same constant as nodeecon.STOCK_FRESH_MS ([GF10] holds them equal; this module imports nothing). */
export const STOCK_HELD_FRESH_MS = 10 * 60e3

/**
 * Does the trader hold a book act-liquidate.js would have to sell? From the
 * raw /tel/stock.txt text (ns.read: 0GB): fresh, of this life when
 * `lastAugReset` is given (boot.js has no getResetInfo and passes null), and
 * equity > 0.
 */
export function stockHeldOf(text, lastAugReset = null, now = Date.now()) {
  let r = null
  try {
    r = JSON.parse(text || 'null')
  } catch {
    r = null
  }
  if (!r || typeof r !== 'object') return false
  const age = now - Date.parse(r.at ?? '')
  if (!(age >= 0 && age < STOCK_HELD_FRESH_MS)) return false
  if (lastAugReset != null && r.lastAugReset !== lastAugReset) return false
  return num(r.equity) && r.equity > 0
}

/**
 * The action slot: {gb, largest, sizes: {actor: GB}, excluded: {actor: why}}.
 *   ramOf      (script) -> GB, ns.getScriptRam(script, 'home')
 *   homeMax    home's max RAM (act-graft.js only from JOB_RUNNER_TIER)
 *   grafting   sfgate.canUseGrafting(reset); null = unknown (counted)
 *   stockHeld  stockHeldOf(...): the trader holds equity
 *   files      deployed file names (optional): unknown act-/snap-*.js count
 */
export function actionSlotOf({ ramOf, homeMax = null, grafting = null, stockHeld = false, files = null } = {}) {
  const sizes = {}
  const excluded = {}
  const known = new Set([...ROUTINE_ACTORS, ...RARE_ACTORS, ...SNAP_ACTORS])
  const extra = (files ?? []).map((f) => String(f).replace(/^\//, '')).filter((f) => /^(act|snap)-.*\.js$/.test(f) && !known.has(f))
  const price = (a) => {
    const r = Number(ramOf(a))
    return num(r) && r > 0 ? r : 0
  }
  for (const a of [...ROUTINE_ACTORS, ...SNAP_ACTORS, ...extra]) sizes[a] = price(a)
  const liq = price('act-liquidate.js')
  if (stockHeld) sizes['act-liquidate.js'] = liq
  else excluded['act-liquidate.js'] = `${liq}GB: no stock equity this life — the pre-install sale is skipped harmlessly without a book, and there is nothing to raise from`
  const graft = price('act-graft.js')
  if (grafting === false) excluded['act-graft.js'] = `${graft}GB: no grafting in this node (BitNode 10 / SF10)`
  else if (!(num(homeMax) && homeMax >= JOB_RUNNER_TIER)) excluded['act-graft.js'] = `${graft}GB: only progress.js orders a graft, and it runs from the ${JOB_RUNNER_TIER}GB tier (home ${homeMax}GB)`
  else sizes['act-graft.js'] = graft
  let gb = 0
  let largest = null
  for (const [a, r] of Object.entries(sizes)) if (r > gb) [gb, largest] = [r, a]
  return { gb, largest, sizes, excluded }
}

/**
 * The action slot go.js keeps on home (actionSlotOf's gb). Without `ctx` the
 * full worst case — every actor, both rare ones — which is what it was before
 * the slot was sized to the node.
 */
export function goHomeKeepOf(ramOf, ctx = null) {
  if (ctx) return actionSlotOf({ ramOf, ...ctx }).gb
  let max = 0
  for (const a of [...ROUTINE_ACTORS, ...RARE_ACTORS, ...SNAP_ACTORS]) {
    const r = Number(ramOf(a))
    if (num(r) && r > max) max = r
  }
  return max
}

/**
 * Home residents go.js OUTRANKS once its priced verdict places it (the GO
 * FIRST rule above, by rank): boot.js admits these at 32GB once the slot is
 * sized to the node, and with them resident a 32GB home cannot hold go.js
 * beside the slot. Both are one-time buyers (TOR, the port programs:
 * progress.js orders the same from 64GB) that wait on money which, at a
 * node's opening, is hours away (goplace names them NOT SIMULATED). seed.js stops them on home only when go.js needs the
 * room (after the worker and the relocatable daemons), and boot.js does not
 * restart them into act.js's slot.
 */
export const GO_OUTRANKS = ['autobuy.js', 'torbuy.js']

/**
 * CLOUD SERVERS FOR A COMMITTED CLAIMANT NO ROOTED HOST CAN HOLD. Each is
 * bought once, by name, by the one-shot gohost.js (seed.js execs it, so the
 * daemon is not billed for ns.cloud), the smallest power of two >= the
 * claimant's block, at the game's formula (Server/ServerPurchases.ts
 * getCloudServerCost: ram x 55000 x CloudServerCost x
 * CloudServerSoftcap^max(0, log2(ram) - 6)).
 *   'go-host'  go.js when its placement is 'blocked' (goHostBuyOf). Live
 *              BN14.1 the lead bought it by hand at 20:50Z, two hours in.
 *   'bb-host'  bb-lite.js's actors when the Bladeburner route holds the work
 *              slot and they starve (bbliteplan.liteHostBuyOf). Live BN14.2
 *              2026-10-05: ~9h of "no rooted host has 13.6GB free" with go.js
 *              on the 32GB home and a 16GB fleet, $3.8m in hand; one 32GB
 *              server ($1.76m) bought by hand at ~22:30Z and rank moved again.
 * gohost.js accepts only these names ([GF12] holds its list equal).
 */
export const GO_HOST = 'go-host'
export const BB_HOST = 'bb-host'
export const CLOUD_HOSTS = { [GO_HOST]: 'go.js', [BB_HOST]: "bb-lite.js's actors" }
export const CLOUD_GB_COST = 55000 // ServerConstants.BaseCostFor1GBOfRamServer

/** The game's price of a `ram`GB cloud server under `mults` (getCloudServerCost). */
export function cloudCostOf(ram, mults = null) {
  const soft = num(mults?.CloudServerSoftcap) ? mults.CloudServerSoftcap : 1
  return ram * CLOUD_GB_COST * (num(mults?.CloudServerCost) ? mults.CloudServerCost : 1) * soft ** Math.max(0, Math.log2(ram) - 6)
}

/**
 * Buy `name` (a CLOUD_HOSTS key) for a block of `need` GB? The caller has
 * already established that the claimant is committed and no rooted host can
 * hold it; this is the money side.
 *
 * NOT PRICED HERE: the claimant's trajectory already carries it. go.js:
 * goplace.goPlaceValueOf pays the server's price up front in the "with" run
 * (seed.js asks it before buying). Bladeburner: progress.js's slot claim, and
 * with no host the claimant runs at rate zero, so the server is what makes
 * the chosen trajectory executable at all; its cost ($1.76m for 32GB in BN14)
 * is held only behind the home claim below.
 *
 * NOT AGAINST HOME RAM. `home` = {cost, live}: the next home RAM upgrade's
 * price and whether homeup.js is publishing this life (it buys the moment
 * cash covers it, --reserve 0 below 128GB). When cash covers that upgrade
 * but not both, the server waits a pass: home survives an install and the
 * server does not (budget.js PRIORITY: home before servers), and the two
 * buyers must not race each other to the same dollars. Cash covering both,
 * or homeup.js not running (nothing would take the money): buy.
 * Returns {buy, name, ram, cost, why}.
 */
export function cloudHostBuyOf({ name, need, cash, mults = null, exists = false, home = null }) {
  const ram = 2 ** Math.ceil(Math.log2(Math.max(8, num(need) ? need : 32)))
  const cost = cloudCostOf(ram, mults)
  const what = CLOUD_HOSTS[name]
  const no = (why) => ({ buy: false, name, ram, cost, why })
  if (!what) return no(`'${name}' is not a cloud host anything buys (CLOUD_HOSTS)`)
  if (exists) return no(`${name} already exists`)
  if (num(mults?.CloudServerLimit) && mults.CloudServerLimit <= 0) return no('no cloud servers in this node (CloudServerLimit 0)')
  if (!(num(cash) && cash >= cost)) return no(`a ${ram}GB server for ${what} costs $${Math.round(cost)}; $${Math.round(num(cash) ? cash : 0)} in hand`)
  if (home?.live === true && num(home.cost) && cash >= home.cost && cash < home.cost + cost) return no(`home RAM first: homeup.js is buying the $${Math.round(home.cost)} upgrade with this cash ($${Math.round(cash)} covers one, not both); the ${ram}GB ${name} waits for the next pass`)
  return { buy: true, name, ram, cost, why: `a ${ram}GB server for ${what} costs $${Math.round(cost)} and $${Math.round(cash)} is in hand` }
}

/**
 * go.js's server: when goPlacementOf's verdict is 'blocked' (no rooted host
 * can ever hold it).
 *   d       goPlacementOf's verdict      cash   home money
 *   need    go.js's GB                   mults  bitNodeMults(node) (CloudServerCost/Softcap/Limit)
 *   exists  a server named GO_HOST already exists      home  {cost, live} (cloudHostBuyOf)
 * Returns {buy, name, ram, cost, why}.
 */
export function goHostBuyOf({ d, cash, need, mults = null, exists = false, home = null }) {
  if (d?.action !== 'blocked' || !d?.admitted) {
    const ram = 2 ** Math.ceil(Math.log2(Math.max(8, num(need) ? need : 32)))
    return { buy: false, name: GO_HOST, ram, cost: cloudCostOf(ram, mults), why: `go.js placement is '${d?.action}': nothing to buy` }
  }
  const b = cloudHostBuyOf({ name: GO_HOST, need, cash, mults, exists, home })
  return b.buy ? { ...b, why: `no rooted host can hold go.js (${d.why}); ${b.why}` } : b
}

/**
 * Daemons boot.js places 'anywhere' that can land on home only because the
 * fleet was full when it ran: stateless loops, safe to kill and start on a
 * fleet host. seed.js moves them off home when go.js needs the room there.
 */
export const RELOCATABLE = ['hashspend.js', 'tel.js', 'errlog.js', 'rfalink.js', 'hacknet.js']

/** The watchdog tier: below it nothing runs progress.js, so its home block is not kept. */
export const JOB_RUNNER_TIER = 64

/**
 * Where go.js goes this pass when the priced verdict places it; {action:
 * 'wait'} otherwise. Same inputs as raisedPlacementOf, plus `go`
 * (goplace.goPlaceValueOf's verdict — or {goFirst: true} to read the placement
 * that verdict is asked to price) and `homeKeep` (goHomeKeepOf). A host's
 * `relocGb` (home only, from seed.js) is the RELOCATABLE daemons on it.
 */
export function goPlacementOf({ go, ...rest }) {
  if (!go?.goFirst) return { action: 'wait', admitted: false, why: go?.why ?? 'no priced verdict places go.js' }
  const d = raisedPlacementOf({ script: 'go.js', tier: RAISED['go.js'].tier, route: null, ...rest })
  return { ...d, why: `${d.why} [${go.why}]` }
}

/**
 * go.js RUNNING ON HOME still keeps act.js's actor headroom. Something placed
 * after it (boot.js's worker spawn, a daemon boot.js dropped on home because
 * the fleet was full) can eat the room. Live BN14.1 19:08Z: go.js 20.75GB plus
 * hashspend.js 7.25GB on a 32GB home left 4GB, and act.js refused
 * "no rooted host has 4.25GB free for act-gym.js" every 5s while the gym
 * order waited.
 *
 * Which processes on home to stop, cheapest first: the EVICTABLE worker
 * threads, then RELOCATABLE daemons (largest first, to move the fewest), then
 * the GO_OUTRANKS residents, only until `keep` GB is free. procs: [{script, gb}] on home (gb = RAM x threads).
 * Returns {stop: [script], freeAfter, ok}. ok false: even all of them would
 * not free `keep`, and nothing is stopped.
 */
export function goHomeRepairOf({ max, used, keep, procs = [] }) {
  if (!num(max) || !num(used) || !num(keep)) return { stop: [], freeAfter: null, ok: false }
  let free = max - used
  if (free >= keep) return { stop: [], freeAfter: free, ok: true }
  const ev = procs.filter((p) => EVICTABLE.includes(p.script))
  const rl = procs.filter((p) => RELOCATABLE.includes(p.script)).sort((a, b) => b.gb - a.gb)
  // Last, the residents go.js outranks (GO_OUTRANKS): stopped, not moved.
  const yl = procs.filter((p) => GO_OUTRANKS.includes(p.script)).sort((a, b) => b.gb - a.gb)
  const stop = []
  for (const p of [...ev, ...rl, ...yl]) {
    if (free >= keep) break
    stop.push(p.script)
    free += p.gb
  }
  if (free < keep) return { stop: [], freeAfter: max - used, ok: false }
  return { stop: [...new Set(stop)], freeAfter: free, ok: true }
}

/**
 * boot.js: room on home for a PLANNED home resident that the measured room
 * refused. The plan fits the resident beside act.js's action slot against the
 * plan's own home budget (boot.js, the residents, the worker slots); the
 * measured room also carries what the plan does not: a one-shot still
 * finishing (settings.js, retire.js) and seed.js's self-threaded workers.
 *
 * Live BN9.2 entry 2026-10-07 13:21Z (and 01:30Z): home 64GB, slot 19.4GB,
 * settings.js (2.3GB, one-shot) still running and early.js x4 (9.6GB) on home
 * -> 6.95GB measured for watchdog.js's 8.95GB, "planned 8.95GB but no host had
 * it free", and NOTHING revived scripts or ran jobs. `run watchdog.js` by hand
 * worked at once.
 *
 * need: the resident's GB; free: home's free GB now; action: the slot kept
 * beside a resident; procs: [{script, gb}] on home (gb = RAM x threads);
 * transient: scripts that exit by themselves (waited for, never killed);
 * movable: 'anywhere' daemons that landed on home (placeOff's fallback) —
 * stopped only after every EVICTABLE worker, and only for a resident whose
 * absence stops the stack (boot.js passes them for watchdog.js alone, which
 * revives them). Live 2026-10-07 13:57Z: buyserv.js 9.6GB and homeup.js
 * 7.6GB on a 64GB home left watchdog.js -0.65GB beside the slot.
 * Stopped whole (retire.js kills by name), largest first, only as many as the
 * shortfall after the transients needs.
 * Returns {fits, ok, wait: [script], stop: [script], room, after, why}:
 * fits = room enough now; ok = enough once `wait` exit and `stop` are killed;
 * neither = not even all of them would make room, and nothing is to be done.
 */
export function homeResidentRoomOf({ need, free, action = 0, procs = [], transient = [], movable = [] }) {
  const room = free - action
  if (!num(need) || !num(room)) return { fits: false, ok: false, wait: [], stop: [], room: null, after: null, why: 'unpriced (need or free RAM unknown)' }
  if (room >= need) return { fits: true, ok: true, wait: [], stop: [], room, after: room, why: 'fits' }
  const by = (list) => {
    const m = new Map()
    for (const p of procs) if (list.includes(p.script) && num(p.gb)) m.set(p.script, (m.get(p.script) ?? 0) + p.gb)
    return [...m.entries()].map(([script, gb]) => ({ script, gb }))
  }
  const tr = by(transient)
  let after = room + tr.reduce((a, p) => a + p.gb, 0)
  const stop = []
  for (const p of [...by(EVICTABLE).sort((a, b) => b.gb - a.gb), ...by(movable.filter((s) => !EVICTABLE.includes(s))).sort((a, b) => b.gb - a.gb)]) {
    if (after >= need) break
    stop.push(p.script)
    after += p.gb
  }
  const r = (x) => Math.round(x * 100) / 100
  if (after < need) {
    return { fits: false, ok: false, wait: [], stop: [], room, after, why: `${r(room)}GB beside the ${r(action)}GB action slot; even with every one-shot finished and every evictable worker${movable.length ? ' and movable daemon' : ''} stopped it is ${r(after)}GB, short of ${r(need)}GB` }
  }
  return {
    fits: false,
    ok: true,
    wait: tr.map((p) => p.script),
    stop,
    room,
    after,
    why: `${r(room)}GB beside the ${r(action)}GB action slot, short of ${r(need)}GB: ${[tr.length ? `wait for ${tr.map((p) => p.script).join('/')}` : null, stop.length ? `evict ${stop.join('/')} on home` : null].filter(Boolean).join(', ')} -> ${r(after)}GB`,
  }
}

/** The reservation record: a host only while placing or reserving. */
export function reserveRecordOf(d, info, now = Date.now(), script = null) {
  const holds = d?.action === 'reserve' || d?.action === 'place'
  return { at: new Date(now).toISOString(), lastAugReset: info?.lastAugReset ?? null, script, action: d?.action ?? null, host: holds ? d.host : null, gb: holds ? d.gb ?? RAISED[script]?.gb ?? 0 : 0, why: d?.why ?? null }
}

/** One record honoured: {host, gb, why} from a fresh, this-life record on a known host, else null. */
export function reserveOf(rec, info, hostNames = [], now = Date.now()) {
  if (!rec?.host || !num(rec.gb) || rec.gb <= 0) return null
  if (rec.lastAugReset !== info?.lastAugReset) return null
  const at = Date.parse(rec.at ?? '')
  if (!(Number.isFinite(at) && now - at <= RESERVE_FRESH_MS)) return null
  if (!hostNames.includes(rec.host)) return null
  return { host: rec.host, gb: rec.gb, why: `${rec.script ?? 'a raise-sized daemon'} (${rec.action}): ${String(rec.why ?? '').slice(0, 120)}` }
}

/**
 * Every live reservation, read through `read(file)` (ns.read: 0GB):
 * [{script, host, gb, why}]. heldOn(list, host) sums a host's.
 */
export function reservesOf(read, info, hostNames = [], now = Date.now()) {
  const out = []
  for (const [script, r] of Object.entries(RAISED)) {
    let rec = null
    try {
      rec = JSON.parse(read(r.file) || 'null')
    } catch {
      rec = null
    }
    const h = reserveOf(rec, info, hostNames, now)
    if (h) out.push({ script, ...h })
  }
  return out
}
export const heldOn = (list, host) => (list ?? []).reduce((a, r) => a + (r.host === host ? r.gb : 0), 0)
