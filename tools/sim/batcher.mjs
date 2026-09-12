// HWGW batching, as a simulator strategy.
//
// The threshold loop in strategies.mjs picks ONE operation for the whole fleet
// per tick, so the fleet serialises on the slowest phase and most thread-
// seconds go to grow (3.2T) and weaken (4T), which earn no money. A batcher
// keeps the target permanently at minimum security and maximum money and lands
// a repeating quartet
//
//     H  .. takes f of the money
//     W1 .. undoes H's security fortification
//     G  .. puts the money back
//     W2 .. undoes G's security fortification
//
// separated by `spacing` ms, so that between one H landing and the next the
// server is back in exactly the state H assumes. Everything above the money a
// single H takes comes from running many such quartets concurrently: the
// pipeline depth is weakenTime / period, and period shrinks until RAM runs out.
//
// This file deliberately imports only game.mjs and engine.mjs. strategies.mjs
// imports *this*, so importing it back would be a cycle.

import {
  calculateGrowTime,
  calculateHackingChance,
  calculateHackingTime,
  calculatePercentMoneyHacked,
  calculateServerGrowthLog,
  calculateGrowMoney,
  calculateWeakenTime,
  getWeakenEffect,
  numCycleForGrowthCorrected,
  ServerConstants,
} from "./game.mjs";

const FORTIFY = ServerConstants.ServerFortifyAmount; // 0.002 per hack thread
const WEAKEN_1 = getWeakenEffect(1, 1); // 0.05 per weaken thread, one core

/** A server as it will be when the batch's ops land: minimum security, full money. */
function preppedView(t) {
  return { ...t, hackDifficulty: t.minDifficulty, moneyAvailable: t.moneyMax };
}

/**
 * Money per RAM-second of a full batch, as f -> 0 — the same index auto.js
 * ships. Duplicated rather than imported to keep this module cycle-free.
 */
export function batchIndex(t, sim) {
  const p = preppedView(t);
  const phi = calculatePercentMoneyHacked(p, sim.player);
  const k = calculateServerGrowthLog(p, 1, sim.player, 1);
  if (!(phi > 0) || !(k > 0)) return 0;
  const chance = calculateHackingChance(p, sim.player);
  return (chance * t.moneyMax) / (calculateHackingTime(p, sim.player) * (1.98 / phi + 6.16 / k));
}

/**
 * Size one batch.
 *
 * `h` hack threads take f = h*phi of the money; `g` grow threads put it back;
 * w1 and w2 cancel the security each adds. Everything except h follows from h,
 * so the only real decision is how big a bite to take. Larger h amortises the
 * integral weaken threads (one weaken thread covers 25 hack threads) but costs
 * disproportionately more grow, because regrowth is logarithmic in f.
 *
 * `margin` over-provisions grow and weaken. It is not waste: hacking level
 * rises while a batch is in flight, so phi at landing is larger than phi at
 * dispatch and the real drain is deeper than planned. Under-growing compounds;
 * over-growing costs a thread.
 */
export function batchPlan(sim, t, { hackThreads = "auto", maxRam = Infinity, margin = 1.1 } = {}) {
  const p = preppedView(t);
  const phi = calculatePercentMoneyHacked(p, sim.player);
  if (!(phi > 0)) return null;
  const chance = calculateHackingChance(p, sim.player);
  const hackTime = calculateHackingTime(p, sim.player) * 1000;
  const growTime = calculateGrowTime(p, sim.player) * 1000;
  const weakenTime = calculateWeakenTime(p, sim.player) * 1000;

  const build = (h) => {
    const f = Math.min(0.99, phi * h);
    const after = Math.max(t.moneyMax * (1 - f), 1);
    const cycles = numCycleForGrowthCorrected(p, t.moneyMax, after, 1, sim.player);
    if (!isFinite(cycles)) return null;
    const g = Math.max(1, Math.ceil(cycles * margin));
    const w1 = Math.ceil((FORTIFY * h * margin) / WEAKEN_1) + 1;
    const w2 = Math.ceil((2 * FORTIFY * g * margin) / WEAKEN_1) + 1;
    const ram = sim.scriptRam.hack * h + sim.scriptRam.grow * g + sim.scriptRam.weaken * (w1 + w2);
    const money = f * t.moneyMax * chance;
    // Every op in a dispatched-together batch holds its RAM for weakenTime,
    // so RAM-seconds per batch is simply ram * weakenTime and the constant
    // drops out of the comparison between candidate h.
    return { h, g, w1, w2, f, phi, ram, money, chance, hackTime, growTime, weakenTime, score: money / ram };
  };

  if (hackThreads !== "auto") {
    const plan = build(Math.max(1, Math.floor(hackThreads)));
    return plan && plan.ram <= maxRam ? plan : plan && hackThreads === 1 ? plan : null;
  }

  // Geometric ladder over h. The score is unimodal in practice, but the ladder
  // is cheap enough to evaluate exhaustively rather than rely on that.
  let best = null;
  const hMax = Math.max(1, Math.ceil(0.99 / phi));
  for (let h = 1; h <= hMax; h = h < 8 ? h + 1 : Math.ceil(h * 1.3)) {
    const plan = build(h);
    if (!plan) continue;
    if (plan.ram > maxRam) break;
    if (!best || plan.score > best.score) best = plan;
  }
  // If even one hack thread does not fit the per-batch budget, run it anyway —
  // a batch that is too big for the fleet is the fleet's problem, and the
  // caller's RAM check will simply refuse to place it.
  return best ?? build(1);
}

/**
 * Assign hosts to a batch's four operations.
 *
 * `hack` must land as one thread group: two hack groups landing together drain
 * sequentially, so the second takes its cut of an already-reduced balance and
 * the batch takes less than planned. grow and weaken have no such problem —
 * launched in the same burst with the same pad they read the same duration and
 * land together, and splitting them only ever over-delivers, which section 9f of
 * the prior art shows is free (excess grow adds no security, excess weaken is
 * clamped at the floor). Letting them split is what makes a batch placeable on a
 * fragmented fleet at all.
 *
 * All four or none: a hack whose grow could not be placed strips the target.
 */
function placeAll(sim, ops) {
  const free = [];
  for (const h of sim.hosts()) {
    const gb = sim.avail(h);
    if (gb > 0) free.push({ host: h.hostname, gb });
  }
  free.sort((a, b) => a.gb - b.gb);
  const out = [];
  // Largest first, and whole-group ops before splittable ones.
  const order = [...ops].sort(
    (a, b) =>
      (a.op === "hack" ? 0 : 1) - (b.op === "hack" ? 0 : 1) ||
      b.threads * sim.scriptRam[b.op] - a.threads * sim.scriptRam[a.op],
  );
  for (const o of order) {
    const per = sim.scriptRam[o.op];
    if (o.op === "hack") {
      const need = o.threads * per;
      const pick = free.find((f) => f.gb >= need - 1e-9); // best fit: list is sorted
      if (!pick) return null;
      pick.gb -= need;
      out.push({ ...o, host: pick.host });
      continue;
    }
    let left = o.threads;
    // Fill from the largest blocks down, so a group is split as few ways as
    // possible and small hosts stay free for the next batch's hack.
    for (let i = free.length - 1; i >= 0 && left > 0; i--) {
      const take = Math.min(left, Math.floor(free[i].gb / per));
      if (take < 1) continue;
      free[i].gb -= take * per;
      out.push({ ...o, threads: take, host: free[i].host });
      left -= take;
    }
    if (left > 0) return null;
  }
  return out;
}

/** Spread an op over every host with room, up to maxThreads. Prep only. */
function spread(sim, op, target, maxThreads) {
  let launched = 0;
  for (const host of sim.hosts()) {
    if (launched >= maxThreads) break;
    const want = Math.min(Math.floor(sim.avail(host) / sim.scriptRam[op]), maxThreads - launched);
    if (want >= 1 && sim.exec(host.hostname, op, target, want)) launched += want;
  }
  return launched;
}

/**
 * The batcher — prior-art's "Design A, periodic": one padded burst per period.
 *
 * Per target it runs a three-state machine:
 *
 *   prep   bring the server to minimum security and maximum money, in waves;
 *          wait for each wave to land before sizing the next, so in-flight
 *          effects are never double-counted.
 *   batch  launch one quartet per period, all four ops in a single burst with
 *          additionalMsec pads, only at instants when the target is measured at
 *          minimum security.
 *   drain  something is wrong (security climbed, money fell): stop launching,
 *          let everything in flight land, then re-prep.
 *
 * Two design choices carry all the robustness, both from docs/prior-art.md §9:
 *
 * 1. **Pads, not sleeps.** An op's duration is fixed at the instant
 *    ns.hack/grow/weaken is called and is immutable thereafter. Launching all
 *    four in one burst means all four read the same hacking level and the same
 *    security, so their relative landing offsets are exact however much the
 *    world moves afterwards. A worker that sleeps first reads the world at wake
 *    time instead, which is a different duration per op and the classic desync.
 *
 * 2. **Launch only at minimum security.** A correct batch deliberately raises
 *    security twice per period — from the hack landing until W1, and from the
 *    grow landing until W2 — and an op *launched* during those windows runs
 *    longer than planned, by 10-60x the separation constant. prior-art §9b′
 *    calls this the dominant desync mechanism. Gating the launch on a measured
 *    `hackDifficulty <= minDifficulty` is the closed-loop form of its
 *    "phase-lock to 3.5 epsilon" and needs no assumption that the schedule is
 *    running as planned.
 *
 * The drain state is the last-resort path. Nothing tries to rescue a desynced
 * pipeline in place; it is allowed to empty out and start again, which costs one
 * weakenTime and always terminates.
 */
export function hwgwBatcher(opts = {}) {
  const {
    spacing = 200, // ms between the four landings of one batch
    hackThreads = "auto",
    nTargets = "auto", // how many targets to run; "auto" adds one per saturated pipeline
    maxTargets = 8,
    minInFlight = 4, // a batch may not cost more than 1/this of a target's share
    spill = "weaken", // dump otherwise-idle RAM into weaken: free exp, no risk
    retargetMs = 30_000,
    secTol = 1.0, // security drift that means the pipeline desynced
    moneyTol = 0.6, // money fraction below which the same is true
    margin = 1.1,
    secGate = true,
    label = null,
  } = opts;

  return {
    name: label ?? `hwgw x${nTargets} eps${spacing}${hackThreads === "auto" ? "" : ` h${hackThreads}`}`,
    _state: new Map(),
    _targets: [],
    _retargetAt: -1,

    st(name) {
      let s = this._state.get(name);
      if (!s) {
        s = {
          phase: "prep",
          nextLaunch: 0,
          quietUntil: 0,
          lastLanding: 0,
          batches: 0,
          skipsUnsafe: 0,
          drains: 0,
          placeFails: 0,
          prepWaves: 0,
          batchingSince: null,
          reserve: 0,
        };
        this._state.set(name, s);
      }
      return s;
    },

    /**
     * RAM one target needs to keep its pipeline full at the tightest permitted
     * period. Past that, extra RAM on the same target buys nothing — the batches
     * would have to land closer than `spacing` and would start colliding — so
     * this is exactly the per-target cap that decides how many targets to run.
     */
    saturationRam(sim, t, share) {
      const plan = batchPlan(sim, t, { hackThreads, maxRam: share / minInFlight, margin });
      if (!plan) return null;
      const depth = Math.ceil(plan.weakenTime / (4 * spacing));
      return { plan, satRam: depth * plan.ram };
    },

    /**
     * Pick targets. With nTargets "auto" the count falls out of the arithmetic:
     * take ranked targets until their saturation RAM covers the fleet. That is
     * the same crossover section 4 of the optimizer log measured empirically —
     * one target saturates near 3TB — but derived rather than tuned.
     */
    chooseTargets(sim) {
      const ranked = [...sim.targets()]
        .filter((t) => t.moneyMax > 0)
        .map((t) => ({ t, s: batchIndex(t, sim) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s);
      if (!ranked.length) return [];
      if (nTargets !== "auto") return ranked.slice(0, nTargets).map((x) => x.t.hostname);

      const total = sim.totalRam();
      const out = [];
      let covered = 0;
      for (const { t } of ranked) {
        if (out.length >= maxTargets) break;
        out.push(t.hostname);
        const sat = this.saturationRam(sim, t, total / Math.max(1, out.length));
        covered += sat ? sat.satRam : total;
        if (covered >= total) break;
      }
      return out;
    },

    tick(sim) {
      sim.nuke();

      if (sim.t >= this._retargetAt) {
        this._retargetAt = sim.t + retargetMs;
        const want = this.chooseTargets(sim);
        // Never abandon a pipeline mid-flight: adopt the new list only once the
        // targets being dropped have drained. Adding targets is always safe.
        const keep = this._targets.filter((n) => {
          const s = this._state.get(n);
          return !want.includes(n) && s && sim.t < s.lastLanding;
        });
        if (want.length) this._targets = [...new Set([...keep, ...want])];
      }

      let reserve = 0;
      let anyBatching = false;
      for (const name of this._targets) {
        const r = this.serve(sim, name);
        reserve += r.reserve;
        if (r.phase === "batch") anyBatching = true;
      }

      if (spill === "weaken" && anyBatching) {
        // Grow and weaken award full experience however far they overshoot, and
        // weaken below minimum security is clamped rather than harmful — so RAM
        // the pipelines cannot use is worth spending on weaken even when the
        // target is already at minimum. `reserve` is what the pipelines will
        // claim over the next weakenTime, which is how long a spill weaken holds
        // its RAM; without it the spill starves the batcher outright.
        const idle = sim.totalFreeRam() - reserve;
        const threads = Math.floor(idle / sim.scriptRam.weaken);
        if (threads >= 1) spread(sim, "weaken", this._targets[0], threads);
      }
    },

    serve(sim, name) {
      const t = sim.servers.get(name);
      if (!t?.hasAdminRights) return { reserve: 0, phase: "none" };
      const s = this.st(name);

      if (s.phase === "drain") {
        if (sim.t < s.quietUntil) return { reserve: 0, phase: "drain" };
        s.phase = "prep";
        s.quietUntil = 0;
      }

      if (s.phase === "prep") {
        const secOk = t.hackDifficulty <= t.minDifficulty + 0.01;
        const moneyOk = t.moneyAvailable >= t.moneyMax * 0.999;
        if (secOk && moneyOk) {
          s.phase = "batch";
          s.pending = [];
          s.nextLaunch = sim.t;
          s.lastLanding = sim.t;
          s.batchingSince ??= sim.t;
          return { reserve: 0, phase: "batch" };
        }
        this.prepWave(sim, t, s);
        return { reserve: 0, phase: "prep" };
      }

      // batch. The health check is the convergence guarantee: an open-loop
      // batcher's thread arithmetic has no restoring force (servers do not
      // regrow or decay on their own), so any systematic bias integrates
      // without bound unless something re-measures and intervenes.
      if (t.hackDifficulty > t.minDifficulty + secTol || t.moneyAvailable < t.moneyMax * moneyTol) {
        s.phase = "drain";
        s.drains++;
        s.quietUntil = Math.max(sim.t, s.lastLanding) + 4 * spacing;
        return { reserve: 0, phase: "drain" };
      }
      return { reserve: this.dispatch(sim, t, s), phase: "batch" };
    },

    /**
     * Prep, run continuously rather than in wait-for-the-wave rounds.
     *
     * The naive loop — size the need, launch it, sleep a weakenTime, re-measure
     * — costs one full 4T per round because it refuses to act on a server with
     * operations in flight. On a $600m target that measured **11 of 20 minutes
     * spent prepping**, which is most of the run and all of the pain of a
     * restart. Instead, keep a ledger of what is already in flight, project the
     * server forward to where those landings will leave it, and each tick launch
     * only the shortfall. Over-provisioning is free here (prior-art section 9f),
     * so an imperfect projection costs threads and never correctness.
     */
    prepWave(sim, t, s) {
      // Throttle. Prep fills the fleet in one go; re-evaluating every 200ms just
      // floods the host with processes it cannot use.
      if (sim.t < (s.nextPrep ?? 0)) return;
      s.nextPrep = sim.t + 1000;
      s.pending = (s.pending ?? []).filter((p) => p.at > sim.t);
      let pendW = 0;
      let pendG = 0;
      for (const p of s.pending) (pendW += p.weaken ?? 0), (pendG += p.grow ?? 0);

      // A grow only fortifies by the threads it actually *used*
      // (processSingleServerGrowth caps usedCycles at the threads needed), so
      // projecting the fortification from the raw in-flight thread count is an
      // unbounded overestimate — it makes prep believe security is about to
      // explode and launch weakens forever, which is exactly what it did.
      const kNow = calculateServerGrowthLog(t, 1, sim.player, 1);
      const needNow = t.moneyAvailable >= t.moneyMax
        ? 0
        : Math.ceil(numCycleForGrowthCorrected(t, t.moneyMax, Math.max(t.moneyAvailable, 1), 1, sim.player));
      const usedG = Math.min(pendG, needNow);

      const projSec = Math.max(t.minDifficulty, t.hackDifficulty - pendW + 2 * FORTIFY * usedG);
      const view = { ...t, hackDifficulty: projSec };
      const projMoney = pendG > 0 ? calculateGrowMoney(view, pendG, sim.player, 1) : t.moneyAvailable;

      const gNeed =
        projMoney >= t.moneyMax
          ? 0
          : Math.ceil(numCycleForGrowthCorrected(view, t.moneyMax, Math.max(projMoney, 1), 1, sim.player));
      const budget = sim.totalFreeRam();
      if (budget < sim.scriptRam.weaken) return;

      const g = Math.min(gNeed, Math.floor((budget * 0.75) / sim.scriptRam.grow));
      const launchedG = g >= 1 ? spread(sim, "grow", t.hostname, g) : 0;
      const wNeed =
        Math.ceil((projSec - t.minDifficulty) / WEAKEN_1) + Math.ceil((2 * FORTIFY * launchedG) / WEAKEN_1);
      const launchedW = wNeed >= 1 ? spread(sim, "weaken", t.hostname, wNeed) : 0;

      const wT = calculateWeakenTime(t, sim.player) * 1000;
      const gT = calculateGrowTime(t, sim.player) * 1000;
      if (launchedG) s.pending.push({ at: sim.t + gT, grow: launchedG });
      if (launchedW) s.pending.push({ at: sim.t + wT, weaken: launchedW * WEAKEN_1 });
      s.prepWaves++;
    },

    /** Launch at most one padded quartet, and report what the pipeline reserves. */
    dispatch(sim, t, s) {
      const share = sim.totalRam() / Math.max(1, this._targets.length);
      const sat = this.saturationRam(sim, t, share);
      if (!sat) return 0;
      const { plan } = sat;
      const { hackTime, growTime, weakenTime } = plan;

      const maxInFlight = Math.max(1, Math.floor(share / plan.ram));
      const period = Math.max(4 * spacing, weakenTime / maxInFlight);
      // What this pipeline will claim over the next weakenTime — the lifetime of
      // a spill weaken, so this is the right thing to hold back from spill.
      const reserve = Math.min(share, Math.ceil(weakenTime / period) * plan.ram);

      if (sim.t < s.nextLaunch) return reserve;
      // Safe-window gate: an op launched while security is above minimum runs
      // longer than planned. Skipping is free; launching anyway is not.
      if (secGate && t.hackDifficulty > t.minDifficulty + 1e-9) {
        s.skipsUnsafe++;
        return reserve;
      }

      const ops = [
        { op: "hack", threads: plan.h, pad: weakenTime - hackTime },
        { op: "weaken", threads: plan.w1, pad: spacing },
        { op: "grow", threads: plan.g, pad: weakenTime - growTime + 2 * spacing },
        { op: "weaken", threads: plan.w2, pad: 3 * spacing },
      ];
      if (ops.some((o) => o.pad < 0)) return reserve;

      // All four or none. A hack whose grow could not be placed strips the
      // target and desyncs it — prior-art §9d(1) calls the partial batch the
      // highest-probability real failure in the design.
      const placed = placeAll(sim, ops);
      if (!placed) {
        s.placeFails++;
        return reserve;
      }
      for (const o of placed) sim.execPad(o.host, o.op, t.hostname, o.threads, o.pad);
      s.batches++;
      s.lastLanding = sim.t + weakenTime + 3 * spacing;
      s.nextLaunch = sim.t + period;
      return reserve;
    },
  };
}
