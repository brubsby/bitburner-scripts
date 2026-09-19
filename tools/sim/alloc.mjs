// The two candidate RAM policies, written once so that the simulator arms and
// the shipped-function verifier run the SAME code, and so the patch proposed
// for batch.js is a transcription rather than a re-implementation.
//
// Both take exactly what batch.js has at its call site (docs/target-count.md
// section 5 / batch.js:658-680): a ranked, quality-floored candidate list of
// `{t, s}`, the worker RAM costs, the fleet total, and SETTINGS. Neither reads
// anything else, so neither can be validated against something it invented.
//
//   evenArgmax  — what ships today. Chooses n, every target gets totalRam/n.
//   fillToSat   — the proposal. Fills ranked targets to their saturation RAM,
//                 best first; the count falls out of the allocation.
//
// They are alternatives, never to be mixed: see docs/allocator.md section 2.
//
// CALIBRATION: `node tools/sim/verify-alloc-shipped.mjs` section 0 runs
// batch.js's planBatch offline against the plan batch.js chose in the live game
// for the same targets, and prints the error. It currently reproduces the live
// plan exactly (14/14 targets, batch RAM +0.1%, $/batch -1.5%) — and fails the
// one check that matters for `saturationRam` below. Read that before trusting
// any absolute figure from this module.

/**
 * Saturation RAM: the most RAM one target can convert into money.
 *
 * A pipeline lands one batch per `period`, and the dispatcher floors the period
 * at `4 * spacing` (batch.js:843) because four landings separated by `spacing`
 * may not overlap the next batch's. So the deepest useful pipeline is
 * `ceil(weakenTime / (4*spacing))` batches in flight, each holding `plan.gb`
 * for one weakenTime. RAM beyond that earns nothing: the batches it would fund
 * cannot be launched without colliding.
 *
 * weakenTime = 4 * hackTime (src/Hacking.ts:90-94), so the depth is
 * ceil(4*hackTime / (4*spacing)) = ceil(hackTime / spacing).
 *
 * There is no passive regrowth in the game — the only callers of
 * processSingleServerGrowth are ns.grow (NetscriptFunctions.ts:288), the
 * terminal grow command and the offline catch-up — so this ceiling is a real
 * property of the target, not an artefact of the batcher.
 *
 * MEASURED, AND WRONG — use `achievedPeriod` / `saturationRamMeasured` below.
 * `4*spacing` is the period the dispatcher *floors* at, not one it achieves.
 * Keep this function only for reproducing the old numbers.
 *
 * The error and its DIRECTION (an earlier revision of this comment had the sign
 * backwards, and the consequence backwards with it):
 *
 *   depth = weakenTime / period. The real period is LONGER than 4*spacing, so
 *   there are FEWER batches in flight than this returns, so the real saturation
 *   RAM is SMALLER — this function OVERSTATES satRam, by the ratio
 *   achievedPeriod/(4*spacing), measured at 1.01x-1.26x.
 *
 *   An overstated satRam means the head of the ranked list is handed more RAM
 *   than it can use, so fillToSat runs out of fleet sooner and funds FEWER
 *   targets. Correcting it pushes toward MORE targets, not fewer.
 *
 * `cap = money/(4*spacing)` is overstated by the same ratio, which is where
 * the model's +38.5% income over-prediction against the live batcher comes
 * from.
 */
export function saturationRam(plan, hackTime, spacing) {
  return Math.max(1, Math.ceil(hackTime / spacing)) * plan.gb;
}

/**
 * The period a pipeline ACTUALLY achieves, as a law fitted to the live batcher.
 *
 *   achievedPeriod = ceil(4*spacing / loopMs) * loopMs        <- the real floor
 *                  + loopMs * (unsafeSkips + placeFails) / batches
 *
 * Two terms, both mechanical rather than modelled:
 *
 *  1. A launch can only happen on a controller loop tick (batch.js's `while`
 *     body runs every SETTINGS.loopMs), so the shortest realisable period is
 *     4*spacing rounded UP to a whole tick — 808ms, not 800ms, at the live
 *     202ms loop.
 *  2. Every blocked attempt — safe-window gate (`s.unsafeSkips`) or failed
 *     placement (`s.placeFails`) — costs exactly one further tick, because the
 *     dispatcher `continue`s without advancing `s.nextLaunch` and retries on
 *     the next loop.
 *
 * Fitted against the running game, differencing two telemetry samples 333s
 * apart so that time spent in prep cannot bias it (10 batching targets, skip
 * rates 0.7% to 100%): **mean absolute error 0.1%**, worst target 0.2%.
 *
 *   host            true p   this   4e*(1+skips/batches)
 *   joesguns        0.810   0.809   0.806
 *   n00dles         0.822   0.823   0.861
 *   harakiri-sushi  0.826   0.827   0.877
 *   neo-net         0.843   0.845   0.948
 *   zer0            0.865   0.865   1.029
 *   iron-gym        0.865   0.864   1.026
 *   hong-fang-tea   0.872   0.872   1.058
 *   nectar-net      0.893   0.893   1.139
 *   max-hardware    0.900   0.900   1.168
 *   foodnstuff      1.009   1.008   1.598
 *                                   mean |err| 19.8%
 *
 * The third column is the natural guess that a skip costs a whole period. It
 * does not: it costs one loop tick. Getting that wrong over-corrects satRam by
 * up to 58%.
 *
 * `stats` is batch.js's own per-target state (`s.batches`, `s.unsafeSkips`,
 * `s.placeFails`) or the simulator's (`batches`, `skipsUnsafe`, `placeFails`).
 * Below `minSamples` batches the ratio is noise, so fall back to the floor.
 */
export function achievedPeriod(stats, spacing, loopMs = 200, minSamples = 20) {
  const floor = Math.ceil((4 * spacing) / loopMs) * loopMs;
  const b = stats?.batches ?? 0;
  if (b < minSamples) return floor;
  const blocked = (stats.unsafeSkips ?? stats.skipsUnsafe ?? 0) + (stats.placeFails ?? 0);
  return floor + (loopMs * blocked) / b;
}

/** saturationRam with the measured period instead of the 4*spacing floor. */
export function saturationRamMeasured(plan, hackTime, spacing, stats, loopMs = 200) {
  const p = achievedPeriod(stats, spacing, loopMs);
  return Math.max(1, Math.ceil((4 * hackTime) / p)) * plan.gb;
}

/**
 * Fill-to-saturation allocation.
 *
 * Walk the ranked list best-first and give each target the lesser of its
 * saturation RAM and everything still unallocated. Stop when the fleet is
 * spent, when the list runs out, or when `maxTargets` is reached. The count is
 * not a separate decision — it is however many targets were funded.
 *
 * Two passes per target because the problem is mildly circular: the batch a
 * target runs is `planBatch(t, ram, share/minInFlight)` and `share` is what we
 * are computing. Pass 1 prices the target against everything left, pass 2
 * re-prices it against what it is actually getting. The sequence is monotone
 * decreasing, so two passes is enough to be self-consistent in practice and
 * cannot loop.
 *
 * @returns Map host -> GB. Sums to at most `totalRam`.
 */
export function fillToSat(cand, totalRam, ram, planBatch, { spacing, maxTargets, minInFlight = 4, loopMs = null, stats = null, redistribute = false }) {
  const shares = new Map();
  let left = totalRam;
  for (const c of cand) {
    if (shares.size >= maxTargets) break;
    if (left < ram.hack) break;
    let give = left;
    let plan = null;
    for (let pass = 0; pass < 2; pass++) {
      plan = planBatch(c.t, ram, give / minInFlight);
      if (!plan) break;
      // `loopMs` selects the measured-period form. Passing it is what turns the
      // 4*spacing assumption into the period the pipeline actually achieves.
      give = Math.min(
        left,
        loopMs
          ? saturationRamMeasured(plan, c.t.hackTime, spacing, stats?.(c.t.host), loopMs)
          : saturationRam(plan, c.t.hackTime, spacing),
      );
    }
    // A target that cannot be given room for even one whole batch is not a
    // target, it is a prep bill — it would still be prepped, and prep draws on
    // the fleet. Everything after it in the ranking is worse and would be
    // funded even less, so stop.
    if (!plan || give < plan.gb) break;
    shares.set(c.t.host, give);
    left -= give;
  }
  // Never return nothing while there is a fleet: on a fleet too small for one
  // saturated batch the right answer is still "run the best target on all of
  // it", which is what the even split degenerates to.
  if (!shares.size && cand.length && totalRam > 0) shares.set(cand[0].t.host, totalRam);
  // Strand nothing. `min(satRam, left)` is a CAP, and a cap that is too tight —
  // which the measured-period form deliberately is, and which maxTargets makes
  // it anyway — leaves RAM that no other target is allowed to claim. It then
  // goes to spill-weaken, which holds it for a whole weakenTime and is worth far
  // less than a deeper pipeline. RAM above satRam cannot hurt a target: the
  // dispatcher's `reserved` is min(share, ceil(weakenTime/period)*gb), so the
  // surplus is not withheld from spill either, and planBatch's budget only ever
  // improves. Measured: without this, the measured-period form loses 4% to the
  // 4*spacing form at 98TB and 7% to the EVEN split on the live world.
  if (redistribute && left > 0 && shares.size) {
    const total = [...shares.values()].reduce((a, b) => a + b, 0);
    for (const [h, g] of shares) shares.set(h, g + (left * g) / total);
  }
  return shares;
}

/**
 * The shipped rule, for reference and for the control arm: choose n to maximise
 *
 *   income(n) = sum_i min( money_i/(4e), (totalRam/n) * money_i/(gb_i*weakenTime_i) )
 *
 * then hand every chosen target totalRam/n. Derived in docs/target-count.md.
 */
export function evenArgmax(cand, totalRam, ram, planBatch, { spacing }) {
  let bestN = 1;
  let bestInc = -1;
  for (let n = 1; n <= cand.length; n++) {
    const share = totalRam / n;
    let inc = 0;
    for (let i = 0; i < n; i++) {
      const p = planBatch(cand[i].t, ram, share / 4);
      if (!p) continue;
      inc += Math.min(p.money / (4 * spacing), (share * p.money) / (p.gb * cand[i].t.hackTime * 4));
    }
    if (inc > bestInc) {
      bestInc = inc;
      bestN = n;
    }
  }
  return Math.max(1, bestN);
}
