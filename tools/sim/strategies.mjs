// Bootstrap strategies to compare.
//
// A strategy is { name, init?, tick }. tick(sim) is called whenever an op
// lands and at least every pollMs, and may launch work with
// sim.exec(host, op, target, threads). Add new ones here and register them at
// the bottom; run.mjs picks them up by name.

import { calculateHackingTime, calculatePercentMoneyHacked, getWeakenEffect } from "./game.mjs";
import { THREAD_RAM } from "./engine.mjs";

/** Spread an op across every host with free RAM, up to maxThreads in total. */
export function fill(sim, op, target, maxThreads = Infinity) {
  let launched = 0;
  for (const host of sim.hosts()) {
    if (launched >= maxThreads) break;
    const free = host.maxRam - host.usedRam;
    const want = Math.min(Math.floor(free / THREAD_RAM[op]), maxThreads - launched);
    if (want >= 1 && sim.exec(host.hostname, op, target, want)) launched += want;
  }
  return launched;
}

/** Threads needed to bring a server back to minimum security. */
export function weakenThreadsNeeded(server, cores = 1) {
  return Math.ceil((server.hackDifficulty - server.minDifficulty) / getWeakenEffect(1, cores));
}

/** Every strategy wants free root access as levels rise. */
function keepRooting(sim) {
  sim.nuke();
}

/**
 * What early.js does today: threads decide weaken / grow / hack against one
 * fixed target by threshold — security within +5 of minimum, money above 75%.
 */
export function earlyJs(target = "n00dles") {
  return {
    name: `early.js on ${target}`,
    tick(sim) {
      keepRooting(sim);
      const t = sim.servers.get(target);
      if (!t?.hasAdminRights) return;

      if (t.hackDifficulty > t.minDifficulty + 5) fill(sim, "weaken", target);
      else if (t.moneyAvailable < t.moneyMax * 0.75) fill(sim, "grow", target);
      else fill(sim, "hack", target);
    },
  };
}

/**
 * Grow and weaken only, never hack. Tests whether at level 1 the hacking level
 * itself is the bottleneck and exp is worth more than what a hack returns.
 */
export function expFarm(target = "joesguns") {
  return {
    name: `exp farm on ${target}`,
    tick(sim) {
      keepRooting(sim);
      const t = sim.servers.get(target);
      if (!t?.hasAdminRights) return;
      if (t.hackDifficulty > t.minDifficulty + 3) fill(sim, "weaken", target);
      else fill(sim, "grow", target);
    },
  };
}

/**
 * Keep the target at minimum security and full money, then take a measured
 * bite. No interleaving — the honest "prep properly first" baseline.
 */
export function preppedHack(target = "n00dles", hackFraction = 0.5) {
  return {
    name: `prepped hack on ${target} (${Math.round(hackFraction * 100)}%)`,
    tick(sim) {
      keepRooting(sim);
      const t = sim.servers.get(target);
      if (!t?.hasAdminRights) return;

      if (t.hackDifficulty > t.minDifficulty + 0.01) {
        fill(sim, "weaken", target, weakenThreadsNeeded(t));
        return;
      }
      if (t.moneyAvailable < t.moneyMax * 0.99) {
        fill(sim, "grow", target);
        return;
      }
      const pct = calculatePercentMoneyHacked(t, sim.player);
      if (pct <= 0) return;
      fill(sim, "hack", target, Math.max(1, Math.floor(hackFraction / pct)));
    },
  };
}

/** Wrap any single-target strategy so it retargets as the hacking level rises. */
export function autoTarget(factory, label = "auto") {
  return {
    name: `${label} — retargeting`,
    tick(sim) {
      keepRooting(sim);
      let best = null;
      let bestRate = -1;
      for (const t of sim.targets()) {
        if (t.moneyMax <= 0) continue;
        const prepped = { ...t, hackDifficulty: t.minDifficulty };
        const pct = calculatePercentMoneyHacked(prepped, sim.player);
        const rate = (t.moneyMax * pct) / calculateHackingTime(prepped, sim.player);
        if (rate > bestRate) (bestRate = rate), (best = t.hostname);
      }
      if (!best) return;
      if (this._for !== best) {
        this._inner = factory(best);
        this._for = best;
      }
      this._inner.tick(sim);
    },
  };
}

export const REGISTRY = {
  "early-n00dles": () => earlyJs("n00dles"),
  "early-foodnstuff": () => earlyJs("foodnstuff"),
  "early-joesguns": () => earlyJs("joesguns"),
  "expfarm-joesguns": () => expFarm("joesguns"),
  "expfarm-n00dles": () => expFarm("n00dles"),
  "prepped-n00dles": () => preppedHack("n00dles", 0.5),
  "prepped-foodnstuff": () => preppedHack("foodnstuff", 0.5),
  "auto-prepped": () => autoTarget((t) => preppedHack(t, 0.5), "prepped hack"),
  "auto-early": () => autoTarget((t) => earlyJs(t), "early.js"),
};
