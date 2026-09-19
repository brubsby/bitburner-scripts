// The planner's view of the Singularity READS, from snapshot files. Pure
// apart from ns.read (0GB); no priced identifier appears here.
//
// ---------------------------------------------------------------------------
// WHY
//
// The game prices a script by every Singularity NAME in its import graph, at
// 16x outside BitNode 4 with Source-File 4.1. After the acts moved to act.js
// the planner still carried fourteen reads — getOwnedAugmentations,
// getAugmentationsFromFaction, getAugmentationStats, getAugmentationPrereq at
// 80GB each, three at 48, two at 40, four at 16, getCurrentWork at 8 — 626GB
// in one block, so a 1TB home before the plan could run. None of those reads
// needs to be live to the second: the planner runs every five minutes and
// measures deltas between passes.
//
// So the reads are taken by snapshot actors (snap-*.js), one call family per
// script, 48-100GB each, one resident at a time, and written to /tel/snap-*.txt.
// This module turns those files into the object progress.js calls, under names
// the calculator does not price. The planner's own price falls to its
// non-Singularity surface, ~10GB, and the floor becomes the largest snapshot.
//
// ---------------------------------------------------------------------------
// FRESHNESS IS THE CONTRACT
//
// A snapshot from another life (owned augmentations, reputation, invitations,
// the catalogue) is refused by its lastAugReset stamp; one from another
// BitNode (stats, prerequisites, enemies, requirements — static within a
// node) by lastNodeReset. Dynamic files older than DYNAMIC_FRESH_MS are
// refused too. A refusal lists what is missing in `view.missing`, and
// progress.js publishes that and skips the pass — the same shape as the RAM
// denial it replaces, and never a plan built on a stale catalogue. A read of a
// key the snapshot does not hold THROWS rather than returning the game's
// "unknown" value, because an invented 0 is the bug class this repo exists
// to avoid.

export const DYNAMIC_FRESH_MS = 4 * 60 * 1000

/** File per family; `dynamic` files carry lastAugReset, the rest lastNodeReset. */
export const SNAPSHOTS = {
  owned: { file: '/tel/snap-owned.txt', actor: 'snap-owned.js', dynamic: true },
  catalog: { file: '/tel/snap-catalog.txt', actor: 'snap-catalog.js', dynamic: true },
  augprice: { file: '/tel/snap-augprice.txt', actor: 'snap-augprice.js', dynamic: true },
  rep: { file: '/tel/snap-rep.txt', actor: 'snap-rep.js', dynamic: true },
  invites: { file: '/tel/snap-invites.txt', actor: 'snap-invites.js', dynamic: true },
  augstats: { file: '/tel/snap-augstats.txt', actor: 'snap-augstats.js', dynamic: false },
  prereq: { file: '/tel/snap-prereq.txt', actor: 'snap-prereq.js', dynamic: false },
  static: { file: '/tel/snap-static.txt', actor: 'snap-static.js', dynamic: false },
}
/** Actors that must run after another's file exists (they enumerate from it). */
export const SNAPSHOT_ORDER = ['owned', 'catalog', 'augprice', 'augstats', 'prereq', 'rep', 'invites', 'static']

export class SnapshotError extends Error {
  constructor(msg) {
    super(msg)
    this.name = 'SnapshotError'
  }
}

/** Read one family; null with a reason when absent or stale. */
export function readSnapshot(ns, key, info, now = Date.now()) {
  const spec = SNAPSHOTS[key]
  if (!spec) return { data: null, why: `unknown snapshot ${key}` }
  let d
  try {
    d = JSON.parse(ns.read(spec.file) || 'null')
  } catch {
    return { data: null, why: `${spec.file} unreadable` }
  }
  if (!d || typeof d !== 'object' || !d.data) return { data: null, why: `${spec.file} missing` }
  if (spec.dynamic) {
    if (d.lastAugReset !== info?.lastAugReset) return { data: null, why: `${spec.file} is from another life` }
    const age = now - Date.parse(d.at)
    if (!(age < DYNAMIC_FRESH_MS)) return { data: null, why: `${spec.file} is ${Math.round(age / 60000)} min old` }
  } else if (d.lastNodeReset !== info?.lastNodeReset) {
    return { data: null, why: `${spec.file} is from another BitNode` }
  }
  return { data: d.data, at: d.at, why: null }
}

/**
 * The view. Every method mirrors one Singularity read, under a name the RAM
 * calculator does not price. `view.missing` lists the families that could not
 * be read; a caller must refuse the pass when it is non-empty.
 */
export function snapshotView(ns, info, now = Date.now()) {
  const got = {}
  const missing = []
  for (const key of Object.keys(SNAPSHOTS)) {
    const r = readSnapshot(ns, key, info, now)
    if (r.data) got[key] = r.data
    else missing.push(`${key}: ${r.why}`)
  }
  const need = (key) => {
    if (!got[key]) throw new SnapshotError(`snapshot ${key} unavailable`)
    return got[key]
  }
  const pick = (key, table, name) => {
    const t = need(key)[table]
    if (!t || !(name in t)) throw new SnapshotError(`snapshot ${key}.${table} has no entry for ${name}`)
    return t[name]
  }
  return {
    missing,
    ownedAugs: (purchased = false) => (purchased ? need('owned').purchased : need('owned').owned),
    factionAugs: (faction) => pick('catalog', 'augs', faction),
    augPrice: (name) => pick('augprice', 'price', name),
    augRepReq: (name) => pick('augprice', 'repReq', name),
    augStats: (name) => pick('augstats', 'stats', name),
    augPrereq: (name) => pick('prereq', 'prereq', name),
    invitations: () => need('invites').invitations,
    factionEnemies: (faction) => pick('static', 'enemies', faction),
    inviteReqs: (faction) => pick('static', 'reqs', faction),
    factionRep: (faction) => pick('rep', 'rep', faction),
    factionFavor: (faction) => pick('rep', 'favor', faction),
    companyRep: (company) => pick('rep', 'companyRep', company),
    companyFavor: (company) => pick('rep', 'companyFavor', company),
    currentWork: () => need('rep').work,
    focused: () => need('rep').focused === true,
    at: Object.fromEntries(Object.keys(got).map((k) => [k, readSnapshot(ns, k, info, now).at])),
  }
}
