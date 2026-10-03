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
  // NOT raise-sized: go.js's static price, placed by goPlacementOf only in a
  // Go-first node (see GO FIRST below), at any home size. In RAISED so that
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
  const cap = (h) => capNoReloc(h) + (num(h.relocGb) ? h.relocGb : 0)
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
  const pick = cands.find((h) => h.host === prev?.host) ?? cands.find((h) => h.host === 'home') ?? cands.sort((a, b) => cap(a) - cap(b) || (a.host < b.host ? -1 : 1))[0]
  const evict = num(pick.evictGb) && pick.evictGb > 0
  // Moved off only when the block needs them: workers and evictions first.
  const relocate = num(pick.relocGb) && pick.relocGb > 0 && capNoReloc(pick) < need
  return { action: 'reserve', admitted: true, host: pick.host, gb: need, evict, relocate, why: `no host has ${need}GB free; ${pick.host} has ${f(free(pick))}GB free and ${f(cap(pick))}GB once its workers go${evict ? ` (seed.js's ${f(pick.evictGb)}GB evicted now)` : ''}${relocate ? ` (and ${f(pick.relocGb)}GB of daemons moved off it)` : ''} — batch.js and seed.js leave ${need}GB there and the watchdog places ${name} as soon as it is free` }
}

// ---------------------------------------------------------------------------
// GO FIRST: go.js in a node where Go is strong.
//
// boot.js admits go.js on home at the 128GB tier (rank 20): elsewhere 20.75GB
// is eight worker threads for a bonus measured in percent. In BitNode 14 the
// node's GoPower is 4 (BitNode.tsx:1042), so the same games are worth four
// times as much, and the node is entered for Go. Live BN14.1 (2026-10-03,
// entered ~18:45Z) home was 32GB and go.js was not running at all until the
// lead killed early.js on home at 19:02Z and ran it by hand.
//
// The rule: effective Go power = GoPower x (Source-File 14 >= 1 ? 2 : 1)
// (effect.ts:16-22, the sourceFileBonus). Go-first when that is >= 4, which is
// BitNode 14 with or without SF14 (4 / 8). SF14 alone (x2 in every node) is
// not: there Go is half what made BitNode 14 worth the home, and the tier-128
// placement stands. SF14 enters the PRICING everywhere (goplan effectAt).
//
// Placement in a Go-first node, by RANK and not by squeezing the plan:
// boot.js's manifest and its tier checks are unchanged (no Go-node branch in
// the planner: boot.js would need getResetInfo, 1GB of launcher, which at the
// 64GB tier is the watchdog's slot). Instead the two placers that already pay
// for the reads do it, from any home size:
//   - seed.js (tier 8 until 128), every pass, and watchdog.js (64 up), every
//     cycle, through goPlacementOf -> raisedPlacementOf, script 'go.js';
//   - home only with act.js's WHOLE action slot kept beside it
//     (goHomeKeepOf: the largest act-*.js, 19.4GB in BN14) and progress.js's
//     block where the watchdog runs it. It outranks the home worker
//     (early.js/hgw.js are EVICTABLE) and, from seed.js, the RELOCATABLE
//     daemons, never the slot: at 32GB and 64GB home cannot hold it, so the
//     fleet is the main path (a rooted 32GB host, or a purchased server such
//     as the 'go-host' bought live at 20:50Z);
//   - else the tightest fleet host with the room, else a host RESERVED and its
//     seed workers evicted (seed.js and batch.js honour the reservation),
//     else blocked by name (an 8GB opening with no 32GB host rooted).
// go.js talks to the solver through home's /go files from wherever it runs.

/** Effective Go power at or above which go.js is placed first (BitNode 14). */
export const GO_FIRST_EFFECT = 4

/** Is this a Go-first node? goPower = the node's GoPower multiplier, sf14 = the Source-File 14 level. */
export function goFirstOf({ goPower, sf14 = 0 } = {}) {
  if (!num(goPower) || goPower <= 0) return { goFirst: false, effective: null, why: 'GoPower unknown (no BitNode table entry): not Go-first' }
  const effective = goPower * (num(sf14) && sf14 >= 1 ? 2 : 1)
  const goFirst = effective >= GO_FIRST_EFFECT
  return {
    goFirst,
    effective,
    why: `effective Go power ${effective} (GoPower ${goPower}${num(sf14) && sf14 >= 1 ? ' x2 for SF14' : ''}) ${goFirst ? '>=' : '<'} ${GO_FIRST_EFFECT}: ${goFirst ? 'go.js placed first, at any home size' : 'go.js at its 128GB home tier'}`,
  }
}

/**
 * act.js's actors (act-*.js). go.js on home keeps the WHOLE action slot free
 * beside it: the largest actor, the same figure boot.js reserves (stack.js's
 * action slot). An earlier version kept only the largest routine actor
 * (8.25GB in BN14) and ran go.js on a 32GB home; live BN14.1 from 18:59Z to
 * 20:49Z act.js then placed nothing (no gym, no home-RAM purchase) and
 * BOOTSTRAP STALLED fired. go.js outranks the home WORKER (early.js), never
 * act.js's slot, so at the 32GB and 64GB tiers it goes off home. [GF] fails
 * when a new act-*.js is in neither list.
 */
export const ROUTINE_ACTORS = ['act-backdoor.js', 'act-buyaug.js', 'act-buyprogram.js', 'act-company.js', 'act-course.js', 'act-crime.js', 'act-donate.js', 'act-focus.js', 'act-gym.js', 'act-homeram.js', 'act-install.js', 'act-join.js', 'act-softreset.js', 'act-stop.js', 'act-travel.js', 'act-work.js']
export const RARE_ACTORS = ['act-liquidate.js', 'act-graft.js']

/** The action slot go.js keeps on home: the largest act-*.js, priced by `ramOf` (ns.getScriptRam). */
export function goHomeKeepOf(ramOf) {
  let max = 0
  for (const a of [...ROUTINE_ACTORS, ...RARE_ACTORS]) {
    const r = Number(ramOf(a))
    if (num(r) && r > max) max = r
  }
  return max
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
 * Where go.js goes this pass in a Go-first node; {action: 'wait'} elsewhere.
 * Same inputs as raisedPlacementOf, plus `go` (goFirstOf's verdict) and
 * `homeKeep` (goHomeKeepOf). A host's `relocGb` (home only, from seed.js) is
 * the RELOCATABLE daemons on it.
 */
export function goPlacementOf({ go, ...rest }) {
  if (!go?.goFirst) return { action: 'wait', admitted: false, why: go?.why ?? 'not a Go-first node' }
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
 * threads, then RELOCATABLE daemons (largest first, to move the fewest), only
 * until `keep` GB is free. procs: [{script, gb}] on home (gb = RAM x threads).
 * Returns {stop: [script], freeAfter, ok}. ok false: even all of them would
 * not free `keep`, and nothing is stopped.
 */
export function goHomeRepairOf({ max, used, keep, procs = [] }) {
  if (!num(max) || !num(used) || !num(keep)) return { stop: [], freeAfter: null, ok: false }
  let free = max - used
  if (free >= keep) return { stop: [], freeAfter: free, ok: true }
  const ev = procs.filter((p) => EVICTABLE.includes(p.script))
  const rl = procs.filter((p) => RELOCATABLE.includes(p.script)).sort((a, b) => b.gb - a.gb)
  const stop = []
  for (const p of [...ev, ...rl]) {
    if (free >= keep) break
    stop.push(p.script)
    free += p.gb
  }
  if (free < keep) return { stop: [], freeAfter: max - used, ok: false }
  return { stop: [...new Set(stop)], freeAfter: free, ok: true }
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
