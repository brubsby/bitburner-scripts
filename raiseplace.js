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
export function raisedPlacementOf({ script = null, homeMax, plan = null, node = null, hosts = [], homeBlock = 0, progressRunning = false, prev = null, need = RAISED[script]?.gb, tier = RAISED[script]?.tier, route = RAISED[script]?.route ?? null }) {
  const name = script ?? 'the daemon'
  if (!num(need) || !num(tier)) return { action: 'blocked', admitted: false, why: `${name}: no raised price or tier (not in RAISED)` }
  if (!(num(homeMax) && homeMax >= tier)) return { action: 'wait', admitted: false, why: `home ${homeMax}GB is under the ${tier}GB tier boot.js admits ${name} at` }
  const rw = route === 'blade' ? routeWantsOf(plan, node) : { wants: true, why: 'not route-gated' }
  if (!rw.wants) return { action: 'wait', admitted: false, why: rw.why }
  const ok = hosts.filter((h) => h && h.host && !h.hacknet && num(h.max) && num(h.used))
  const keep = (h) => (h.host === 'home' && !progressRunning ? homeBlock : 0)
  const free = (h) => h.max - h.used - keep(h)
  const cap = (h) => free(h) + (num(h.workerGb) ? h.workerGb : 0) + (num(h.evictGb) ? h.evictGb : 0)
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
  return { action: 'reserve', admitted: true, host: pick.host, gb: need, evict, why: `no host has ${need}GB free; ${pick.host} has ${f(free(pick))}GB free and ${f(cap(pick))}GB once its workers go${evict ? ` (seed.js's ${f(pick.evictGb)}GB evicted now)` : ''} — batch.js and seed.js leave ${need}GB there and the watchdog places ${name} as soon as it is free` }
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
