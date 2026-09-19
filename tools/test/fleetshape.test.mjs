// [FS] fleet shape — size hosts by $/placeable-batch, not $/GB.
//
// The live failure: 25 fleet hosts at the 64GB $/GB knee, a 226GB batch, so
// floor(64/226) = 0 batches per host — the whole fleet held nothing and every
// hack op contended on home (1,083 placement failures in one life). FS1 uses
// that exact cost curve and batch size.

import { Check } from "./harness.mjs";
import "./gameresolve.mjs";

const { fleetTarget } = await import("../../fleetshape.js");

// The live BN4 curve, measured 2026-09-15: flat $55k/GB to 64GB, then the
// softcap raises it (perGB ~ $114k by 1024GB). Reproduced from the game's
// formula shape: cost = ram * 55000 * softcap^max(0, log2(ram)-6), softcap 1.2.
const liveCost = (ram) => ram * 55000 * Math.pow(1.2, Math.max(0, Math.log2(ram) - 6)); // 55000 = CloudServerCost base (ServerPurchases.ts:38)

export function run() {
  const checks = [];

  /* ---------------------------------------------------------------- FS1 --- */
  const c1 = new Check("FS1", "THE LIVE BUG: the $/GB knee holds ZERO batches; the right target holds at least one");
  {
    const knee = fleetTarget(226, liveCost, { maxRam: 1048576 });
    c1.examined(1);
    if (!knee) { c1.fail("the live shape must derive a target"); checks.push(c1); return checks; }
    // The $/GB knee is 64GB and holds floor(64/226)=0 — it must NOT be chosen.
    if (knee.targetRam <= 64) c1.fail(`a target of ${knee.targetRam}GB holds ${Math.floor(knee.targetRam / 226)} batches — the exact zero-slot bug`);
    if (knee.slots < 1) c1.fail("the chosen target must hold at least one full batch");
    // 256GB is the smallest power of two holding a batch (floor(256/226)=1);
    // check it beats both the fragmenting 128 and the softcap-taxed 1024.
    const row = (r) => knee.table.find((t) => t.ram === r);
    c1.examined(1);
    if (row(128).slots !== 0) c1.fail("128GB still holds no 226GB batch");
    if (!(row(256).costPerSlot < row(1024).costPerSlot)) c1.fail("256 must beat 1024 on $/slot — the softcap tax outweighs the extra slot here");
    c1.note(`226GB batch: target ${knee.targetRam}GB (${knee.slots} slot(s), $${(knee.costPerSlot / 1e6).toFixed(1)}M/slot) — the old rule bought 64GB, 0 slots`);
  }
  checks.push(c1);

  /* ---------------------------------------------------------------- FS2 --- */
  const c2 = new Check("FS2", "the target tracks batch size, and picks the smallest size at an economics tie");
  {
    c2.examined(1);
    // A tiny batch fits the cheap flat region — the target should be small.
    const small = fleetTarget(30, liveCost, { maxRam: 1048576 });
    if (!(small.targetRam <= 64)) c2.fail(`a 30GB batch should target the flat region, got ${small.targetRam}`);
    c2.examined(1);
    // A bigger batch forces a bigger host — monotone, the property that makes
    // the fleet track the multiplier as batches grow.
    const big = fleetTarget(500, liveCost, { maxRam: 1048576 });
    if (!(big.targetRam >= 512)) c2.fail(`a 500GB batch needs >=512GB, got ${big.targetRam}`);
    if (!(big.targetRam >= small.targetRam)) c2.fail("target must be monotone in batch size");
    c2.examined(1);
    // Smallest-at-tie: if two sizes score identically, prefer the smaller
    // (more hosts, less softcap capital). Construct a flat cost curve where
    // 128 and 256 both hold whole batches at equal $/slot.
    const flat = (r) => r * 1000; // perfectly linear: $/slot equal once slots match
    const t = fleetTarget(64, flat, { maxRam: 1024 });
    // batch 64: 64->1 slot @ $64k, 128->2 @ $64k, 256->4 @ $64k... all tie;
    // the smallest that holds a batch (64) must win.
    if (t.targetRam !== 64) c2.fail(`a linear curve must pick the smallest whole-batch size, got ${t.targetRam}`);
  }
  checks.push(c2);

  /* ---------------------------------------------------------------- FS3 --- */
  const c3 = new Check("FS3", "refusal, and the over-cap case named rather than guessed");
  {
    c3.examined(1);
    for (const bad of [
      [NaN, liveCost, {}],
      [226, null, {}],
      [-5, liveCost, {}],
      [226, "notafn", {}],
    ]) {
      if (fleetTarget(...bad) !== null) c3.fail(`unreadable inputs must refuse: ${JSON.stringify(bad[0])}`);
    }
    c3.examined(1);
    // A batch bigger than the RAM cap: no size holds it. Report the cap with
    // slots 0 so the caller SEES the batcher wants more than the node allows,
    // rather than a silent "target = cap" that looks like a normal answer.
    const over = fleetTarget(2e6, liveCost, { maxRam: 1024 });
    if (!over || over.slots !== 0) c3.fail("an over-cap batch must report slots 0, not a normal target");
    if (over.targetRam !== 1024) c3.fail("the over-cap fallback targets the RAM cap");
    c3.examined(1);
    // A broken cost at one size (game throws) skips that row, never the whole answer.
    const holey = (r) => (r === 256 ? NaN : liveCost(r));
    const h = fleetTarget(226, holey, { maxRam: 1024 });
    if (!h || h.slots < 1) c3.fail("one unreadable size must not sink the derivation");
    if (h.table.some((t) => t.ram === 256)) c3.fail("the unreadable size must be skipped, not carried as garbage");
  }
  checks.push(c3);

  return checks;
}
