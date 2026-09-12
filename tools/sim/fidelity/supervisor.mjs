// A faithful replica of what the live game is actually running:
// `auto.js` polling every 20s, deploying one `early.js` instance per host.
//
// The point of this file is that it is *not* an idealised strategy. It copies
// auto.js line for line, including the parts that are wrong, so the backtest
// can ask "does the simulator reproduce what really happened" rather than
// "does the simulator like this idea". Where it departs from auto.js the
// comment says so and why.
//
// Four things it models that tools/sim/strategies.mjs does not:
//
//   1. Retarget kills the workers. deploy() calls ns.kill on every worker whose
//      args[0] is not the new target; the in-flight op is destroyed and yields
//      nothing.
//   2. One worker per host, all that host's threads. Not a thread pool — a
//      1024GB server is 426 threads that all weaken, or all grow, together.
//   3. The supervisor only acts every `interval` ms. Between polls nothing is
//      redeployed, so RAM freed by a kill sits idle until the next cycle and a
//      worker that finishes an op picks its own next op with no supervision.
//   4. ns.exec returns 0 when RAM is short, silently.

import {
  calculateHackingTime,
  calculateServerGrowthLog,
  ServerConstants,
} from "../game.mjs";

export const AUTO_DEFAULTS = {
  worker: "early.js",
  /** ns.getScriptRam('early.js'): 1.6 base + getServerSecurityLevel/MaxMoney/
   *  MinSecurityLevel/MoneyAvailable at 0.1 each + hack 0.1 + grow/weaken 0.15
   *  each. The live daemon reports 2.4GB. */
  workerRam: 2.4,
  intervalMs: 20_000,
  homeReserveRam: 2,
  /**
   * RAM the supervisor and telemetry occupy before any worker runs. In the
   * live game auto.js sits on home and tel.js on foodnstuff (4GB), and
   * auto.js's own usableRam() holds back another 2GB of home.
   */
  overhead: { home: 5.9, foodnstuff: 4 },
  /**
   * false reproduces the *old* simulator: a retarget redirects each worker's
   * next op but its in-flight op still lands and still pays. That is the
   * assumption that made the live configuration score in the billions.
   */
  modelKills: true,
  switchMargin: 1.5,
  /** auto.js: heldForMs < 4 * getHackTime(current) blocks a switch. */
  holdHackTimes: 4,
  moneyFloor: 0.5,
  securitySlack: 5,
  /** "live" = M*phi/T (pre-23:17 UTC), "batch" = the shipped ratio. */
  index: "batch",
};

// ---------------------------------------------------------------------------
// auto.js's ranking, transcribed. Note two details that matter and that a
// cleaned-up version would quietly fix:
//
//  * `phi` and `chance` are evaluated at MINIMUM security (the state we intend
//    to keep the server in), but `time` comes from ns.getHackTime, which uses
//    CURRENT security. So a server that is currently fortified scores lower
//    than the same server prepped — the index is not a pure function of the
//    server, it drifts as the fleet works.
//  * every term depends on ns.getHackingLevel(), which under this fleet rises
//    every 20-90 seconds. The ranking is therefore a moving object, and that
//    is the engine of the retarget churn.
// ---------------------------------------------------------------------------

export function hackFractionAtMinSecurity(server, player) {
  const minSecurity = server.minDifficulty;
  if (minSecurity >= 100) return 0;
  const hacking = player.skills.hacking;
  const required = server.requiredHackingSkill;
  const difficultyMult = (100 - minSecurity) / 100;
  const skillMult = (hacking - (required - 1)) / hacking;
  return Math.min(1, Math.max(0, (difficultyMult * skillMult) / 240));
}

export function hackChanceAtMinSecurity(server, player) {
  const minSecurity = server.minDifficulty;
  if (minSecurity >= 100) return 0;
  const skillMult = Math.max(1.75 * player.skills.hacking, 1);
  const skillChance = (skillMult - server.requiredHackingSkill) / skillMult;
  return Math.min(1, Math.max(0, skillChance * ((100 - minSecurity) / 100)));
}

/**
 * auto.js's target index. **Which one was running is a function of the clock**,
 * and that turns out to matter more than anything else in this file.
 *
 *   "live"  — `M * phi / T`. What auto.js computed for the whole early game,
 *             up to the rewrite whose mtime is 23:17 UTC. It prices the hack
 *             threads and nothing else, so it picks the richest server it can
 *             reach and ignores how long putting the money back will take. On
 *             this network at level ~89 that is neo-net (moneyMax $125m,
 *             serverGrowth 25, starting at 4% of max and 3x min security).
 *   "batch" — `chance * M / (T * (1.98/phi + 6.16/k))`. The shipped version,
 *             which charges for the grow threads and the weakens both ops
 *             force.
 *
 * Running the flat window under each is the cleanest measurement in this log:
 * same fleet, same worker, same everything, one term in a ratio.
 */
export function rateOf(sim, hostname, index = "batch") {
  const s = sim.servers.get(hostname);
  if (!s || s.moneyMax <= 0) return 0;
  if (s.requiredHackingSkill > sim.hacking) return 0;

  const phi = hackFractionAtMinSecurity(s, sim.player);
  // ns.getHackTime — current security, in ms in the real API, seconds here.
  const time = calculateHackingTime(s, sim.player) * 1000;
  if (phi <= 0 || !isFinite(time) || time <= 0) return 0;

  if (index === "live") return (s.moneyMax * phi) / time;

  const minSecurity = s.minDifficulty;
  const growth = s.serverGrowth;
  const adjGrowthLog = Math.min(Math.log1p(0.03 / minSecurity), 0.00349388925425578);
  const k = adjGrowthLog * (growth / 100);
  if (!(k > 0)) return 0;

  const chance = hackChanceAtMinSecurity(s, sim.player);
  const ramSeconds = (time / 1000) * (1.98 / phi + 6.16 / k);
  return (chance * s.moneyMax) / ramSeconds;
}

/** The version of auto.js from *before* the shouldSwitch guard was added. */
export function shouldSwitchNaive(sim, current, candidate, candidateRate, currentRate) {
  if (!current) return true;
  if (candidate === current) return false;
  const s = sim.servers.get(current);
  if (!s.hasAdminRights || s.requiredHackingSkill > sim.hacking) return true;
  return candidateRate > currentRate;
}

/** The version shipped after the incident: margin + hold. */
export function shouldSwitchGuarded(sim, current, candidate, candidateRate, currentRate, heldForMs, opts) {
  if (!current) return true;
  if (candidate === current) return false;
  const s = sim.servers.get(current);
  if (!s.hasAdminRights || s.requiredHackingSkill > sim.hacking) return true;
  if (heldForMs < opts.holdHackTimes * calculateHackingTime(s, sim.player) * 1000) return false;
  return candidateRate > currentRate * opts.switchMargin;
}

// ---------------------------------------------------------------------------
// early.js, as a worker process.
// ---------------------------------------------------------------------------

/**
 * One step of early.js's loop. The thresholds are read at *this instant*,
 * which is what the real script does — it re-reads getServerSecurityLevel and
 * getServerMoneyAvailable on every iteration, so a worker that wakes up to
 * find another host has already drained the target will grow instead of hack.
 */
export function earlyStep(sim, proc) {
  const target = proc.args[0];
  const t = sim.servers.get(target);
  if (!t || !t.hasAdminRights) {
    proc.state.idleSince = sim.t;
    return false;
  }
  const { moneyFloor, securitySlack } = proc.state;
  const securityThresh = t.minDifficulty + securitySlack;
  const moneyThresh = t.moneyMax * moneyFloor;

  let op;
  if (t.hackDifficulty > securityThresh) op = "weaken";
  else if (t.moneyAvailable < moneyThresh) op = "grow";
  else op = "hack";

  // ns.hack throws if the level is too low; early.js would die. In practice
  // auto.js never points it at an unreachable server, but guard anyway.
  if (op === "hack" && t.requiredHackingSkill > sim.hacking) op = "grow";

  proc.state.ops = (proc.state.ops ?? 0) + 1;
  proc.state[op] = (proc.state[op] ?? 0) + 1;
  return sim.procOp(proc.pid, op, target);
}

function onLand(sim, proc) {
  earlyStep(sim, proc);
}

// ---------------------------------------------------------------------------
// auto.js itself.
// ---------------------------------------------------------------------------

export function autoJs(overrides = {}) {
  const opts = { ...AUTO_DEFAULTS, ...overrides };
  const guard = opts.naive ? shouldSwitchNaive : shouldSwitchGuarded;

  return {
    name: `auto.js (${opts.naive ? "naive" : "guarded"}) + ${opts.worker}`,
    opts,
    init(sim) {
      this.nextPoll = 0;
      this.target = null;
      this.targetSince = 0;
      this.retargets = 0;
      this.cycles = 0;
      this.history = [];
      this.timeline = [];
      // auto.js and tel.js occupy RAM before anything else runs, and auto.js
      // holds back homeReserveRam of home on top of that.
      for (const [host, gb] of Object.entries(opts.overhead)) {
        const s = sim.servers.get(host);
        if (s) s.usedRam += Math.min(gb, s.maxRam);
      }
      const home = sim.servers.get("home");
      if (home) home.usedRam = Math.min(home.maxRam, home.usedRam + opts.homeReserveRam);
    },
    tick(sim) {
      if (sim.t < this.nextPoll) return;
      this.nextPoll = sim.t + opts.intervalMs;
      this.cycles++;

      // 1. root what is in reach
      sim.nuke();

      const rooted = [...sim.servers.values()].filter((s) => s.hasAdminRights);

      // 2. rank, then decide whether to move
      let candidate = null;
      let candidateRate = -1;
      for (const s of rooted) {
        const r = rateOf(sim, s.hostname, opts.index);
        if (r > candidateRate) (candidateRate = r), (candidate = s.hostname);
      }
      if (!candidate) return;

      const currentRate = this.target ? rateOf(sim, this.target, opts.index) : 0;
      if (guard(sim, this.target, candidate, candidateRate, currentRate, sim.t - this.targetSince, opts)) {
        if (this.target && this.target !== candidate) {
          this.retargets++;
          this.history.push({ at: sim.t, from: this.target, to: candidate, level: sim.hacking });
        }
        this.target = candidate;
        this.targetSince = sim.t;
      }

      // 3. deploy. This is the step that kills in-flight work.
      for (const s of rooted) {
        if (s.maxRam <= 0) continue;
        this.deploy(sim, s.hostname);
      }

      const t = sim.servers.get(this.target);
      this.timeline.push({
        t: sim.t,
        target: this.target,
        moneyFrac: t.moneyMax > 0 ? t.moneyAvailable / t.moneyMax : 0,
        sec: t.hackDifficulty,
        minSec: t.minDifficulty,
        level: sim.hacking,
        earned: sim.stats.moneyStolen,
        killed: sim.stats.killedOps,
      });
    },

    deploy(sim, hostname) {
      const target = this.target;
      const procs = sim.psOn(hostname).filter((p) => p.script === opts.worker);
      for (const p of procs) {
        if (p.args[0] === target) continue;
        if (opts.modelKills) sim.killProc(p.pid);
        // The old sim's assumption: redirect the worker but let the op it is
        // already flying land and pay out. Nothing in the game does this.
        else p.args = [target];
      }

      const threads = Math.floor(sim.avail(hostname) / opts.workerRam);
      if (threads < 1) return 0;

      const pid = sim.spawn(hostname, {
        script: opts.worker,
        threads,
        ramPerThread: opts.workerRam,
        args: [target],
        onLand,
        state: { moneyFloor: opts.moneyFloor, securitySlack: opts.securitySlack },
      });
      if (!pid) return 0; // ns.exec returned 0 — silently, as the game does
      earlyStep(sim, sim.procs.get(pid));
      return threads;
    },
  };
}

/**
 * Same supervisor, but the retarget decision is made on expected value over a
 * finite horizon instead of on an instantaneous rate ratio. Kept here rather
 * than in strategies.mjs because it is a fidelity experiment, not a shipped
 * strategy — it exists to show what the missing mechanism costs.
 */
export function autoJsEv(overrides = {}) {
  const base = autoJs(overrides);
  const opts = base.opts;
  const horizon = overrides.horizonSeconds ?? 1800;
  return {
    ...base,
    name: `auto.js (EV retarget, H=${horizon}s) + ${opts.worker}`,
    tick(sim) {
      if (sim.t < this.nextPoll) return;
      this.nextPoll = sim.t + opts.intervalMs;
      this.cycles++;
      sim.nuke();

      const rooted = [...sim.servers.values()].filter((s) => s.hasAdminRights);
      let candidate = null;
      let candidateRate = -1;
      for (const s of rooted) {
        const r = rateOf(sim, s.hostname, opts.index);
        if (r > candidateRate) (candidateRate = r), (candidate = s.hostname);
      }
      if (!candidate) return;

      if (!this.target) {
        this.target = candidate;
        this.targetSince = sim.t;
      } else if (candidate !== this.target) {
        const cur = sim.servers.get(this.target);
        const unusable = !cur.hasAdminRights || cur.requiredHackingSkill > sim.hacking;
        if (unusable || this.evSwitch(sim, cur, sim.servers.get(candidate), horizon)) {
          this.retargets++;
          this.history.push({ at: sim.t, from: this.target, to: candidate, level: sim.hacking });
          this.target = candidate;
          this.targetSince = sim.t;
        }
      }

      for (const s of rooted) {
        if (s.maxRam <= 0) continue;
        this.deploy(sim, s.hostname);
      }
    },

    /**
     * The decision, in full: over the next `horizon` seconds the fleet can
     * either finish prepping the incumbent and harvest it, or throw that away
     * and prep the candidate. Both prep costs are real and both are charged.
     */
    evSwitch(sim, cur, cand, horizonSeconds) {
      const fleetRam = sim.hosts().reduce((a, s) => a + s.maxRam, 0);
      const value = (s) => {
        const rate = rateOf(sim, s.hostname, opts.index); // $ per RAM-second, prepped
        const prepSec = prepSeconds(sim, s, fleetRam);
        return rate * fleetRam * Math.max(0, horizonSeconds - prepSec);
      };
      // Work in flight against the incumbent that a kill would destroy.
      let inFlight = 0;
      for (const p of sim.procs.values()) {
        if (p.args[0] !== cur.hostname || !p.pending) continue;
        inFlight += p.threads * p.pending.seconds;
      }
      return value(cand) > value(cur) + inFlight * rateOf(sim, cur.hostname, opts.index);
    },
  };
}

/** Wall seconds to bring `s` to min security and max money with `fleetRam` GB. */
export function prepSeconds(sim, s, fleetRamGb) {
  const player = sim.player;
  const Th = calculateHackingTime(s, player);
  const Tg = 3.2 * Th;
  const Tw = 4 * Th;
  const w = 0.05; // getWeakenEffect(1, 1)
  const excess = Math.max(0, s.hackDifficulty - s.minDifficulty);
  let weakenThreads = Math.ceil(excess / w);

  let growThreads = 0;
  if (s.moneyAvailable < s.moneyMax) {
    const k = calculateServerGrowthLog({ ...s, hackDifficulty: s.minDifficulty }, 1, player, 1);
    growThreads = k > 0 ? Math.ceil(Math.log(s.moneyMax / Math.max(1, s.moneyAvailable)) / k) : 0;
    weakenThreads += Math.ceil((2 * ServerConstants.ServerFortifyAmount * growThreads) / w);
  }
  const ramSeconds = weakenThreads * 1.75 * Tw + growThreads * 1.75 * Tg;
  const serial = (excess > 0 ? Tw : 0) + (growThreads > 0 ? Tg + Tw : 0);
  return Math.max(serial, fleetRamGb > 0 ? ramSeconds / fleetRamGb : Infinity);
}
