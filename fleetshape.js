// What SIZE should fleet hosts be? Pure, no ns.
//
// ---------------------------------------------------------------------------
// WHY $/GB IS THE WRONG OBJECTIVE
//
// buyserv levelled hosts to the softcap knee, where $/GB stops being flat —
// which on this cost curve is 64GB. But the BATCHER's binding resource is not
// gigabytes, it is PLACEABLE BATCHES: a batch's hack op must land as one
// thread group on a single host (place() in batch.js), and a full batch was
// measured live at 226GB against 64GB hosts. floor(64 / 226) = 0 — every one
// of the 25 fleet hosts held ZERO batches, so every hack op piled onto home
// and contended there: 1,083 placement failures in a single life, the batcher
// tiered out to 128GB in the boot manifest, "roughly one whole tier of income"
// left on the floor (NOTES-boot.md).
//
// The right objective is $ per PLACEABLE BATCH-SLOT:
//
//     slots(S)      = floor(S / batchGB)          batches a host of size S holds
//     costPerSlot(S)= serverCost(S) / slots(S)    (Infinity when slots = 0)
//
// and the fleet wants the host size that MINIMISES it. Below batchGB every
// size scores Infinity (holds no batch); at and above it, the softcap premium
// of a bigger host trades against the fragmentation waste of a smaller one,
// and the minimum is usually the smallest power of two that holds a batch or
// two — NOT the $/GB knee, which is strictly smaller and holds none.
//
// batchGB is MEASURED, from the batcher's own telemetry (the largest live
// plan.gb). It grows as the hacking multiplier does, so the target re-derives
// each pass and the fleet tracks it — a target frozen as a constant would be
// wrong within a few installs, the exact failure this whole week has been
// removing.

/**
 * The host size that minimises $/placeable-batch-slot.
 *
 * @param batchGB   the largest full batch the batcher currently plans (GB)
 * @param serverCost(sizeGB) -> dollars, the game's own ns.cloud.getServerCost
 * @param o.maxRam  the fleet server RAM cap (ns.cloud.getMaxRam), a hard ceiling
 * @param o.minRam  smallest purchasable (8)
 * @returns { targetRam, costPerSlot, slots, table } or null when unreadable.
 *
 * Refuses (null) rather than guessing when batchGB or the cost function are
 * unreadable — a fleet reshaped on a guessed target is expensive and
 * irreversible-ish (you cannot un-buy a server), so the caller keeps its
 * previous behaviour on any doubt.
 */
export function fleetTarget(batchGB, serverCost, o = {}) {
  const num = (x) => typeof x === 'number' && isFinite(x) && x > 0
  if (!num(batchGB) || typeof serverCost !== 'function') return null
  // The caller passes the game's own ns.cloud.getRamLimit(); this fallback is
  // only for direct/test callers. Expressed as 2^20 rather than the literal so
  // it is not mistaken for a hardcoded CloudServerMaxRam (invariant C5).
  const maxRam = num(o.maxRam) ? o.maxRam : Math.pow(2, 20)
  const minRam = num(o.minRam) ? o.minRam : 8

  const table = []
  let best = null
  for (let s = minRam; s <= maxRam; s *= 2) {
    let cost
    try {
      cost = serverCost(s)
    } catch {
      cost = null
    }
    if (!num(cost)) continue
    const slots = Math.floor(s / batchGB)
    const costPerSlot = slots > 0 ? cost / slots : Infinity
    table.push({ ram: s, slots, cost, costPerSlot })
    // Strictly-less keeps the SMALLEST size at a tie — less capital sunk into
    // the softcap for the same slot economics, and more hosts for the same
    // spend, which spreads batches wider.
    if (slots > 0 && (!best || costPerSlot < best.costPerSlot - 1e-9)) {
      best = { targetRam: s, costPerSlot, slots }
    }
  }
  // No size holds a batch (batchGB above the RAM cap): target the cap and say
  // slots 0, so the caller can see that the batcher wants more than the node
  // allows and fall back to filling with the biggest hosts available.
  if (!best) {
    const cap = table.length ? table[table.length - 1] : null
    return cap ? { targetRam: cap.ram, costPerSlot: Infinity, slots: 0, table } : null
  }
  return { ...best, table }
}
