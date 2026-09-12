// Bootstrap strategies to compare.
//
// A strategy is { name, init?, tick }. tick(sim) is called whenever an op
// lands and at least every pollMs, and may launch work with
// sim.exec(host, op, target, threads). Add new ones here and register them at
// the bottom; run.mjs picks them up by name.

import {
  calculateGrowTime,
  calculateHackingChance,
  calculateHackingTime,
  calculatePercentMoneyHacked,
  calculateWeakenTime,
  calculateServerGrowthLog,
  getWeakenEffect,
  numCycleForGrowthCorrected,
  ServerConstants,
} from "./game.mjs";
import { THREAD_RAM, PORT_PROGRAMS, TOR_COST } from "./engine.mjs";
import { getCloudServerLimit } from "./game.mjs";
import { hwgwBatcher } from "./batcher.mjs";

const CLOUD_LIMIT = getCloudServerLimit();

/** Spread an op across every host with free RAM, up to maxThreads in total. */
export function fill(sim, op, target, maxThreads = Infinity) {
  let launched = 0;
  for (const host of sim.hosts()) {
    if (launched >= maxThreads) break;
    const free = sim.avail(host);
    const want = Math.min(Math.floor(free / sim.scriptRam[op]), maxThreads - launched);
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

// ---------------------------------------------------------------------------
// Infrastructure: turning money back into RAM.
//
// Every strategy in the original registry tops out at 108GB — the eight
// zero-port servers plus an 8GB home — and then stays there for the rest of
// the run. That ceiling, not the hacking policy, is what the early numbers
// were really measuring. The buyers below give a strategy somewhere to put
// its money.
// ---------------------------------------------------------------------------

/** GB that buying this program would put in reach *right now*. */
function ramUnlockedBy(sim, portsAfter) {
  let gb = 0;
  for (const s of sim.servers.values()) {
    if (s.hasAdminRights || s.purchasedByPlayer) continue;
    if (s.numOpenPortsRequired <= portsAfter && s.requiredHackingSkill <= sim.hacking) gb += s.maxRam;
  }
  return gb;
}

/**
 * Spend spare money on whatever buys the most RAM per dollar.
 *
 * The three ways to get RAM price out very differently:
 *   cloud server      a flat $55,000/GB, always available
 *   home RAM upgrade  $32,000/GB at 8GB but the multiplier is 1.58^log2(ram),
 *                     so it passes cloud servers immediately and never returns
 *   port programs     a fixed fee that unlocks whole servers at once — TOR plus
 *                     BruteSSH is $700k for ~130GB, about $5k/GB
 *
 * So the policy is simply: rank by $/GB and buy the best affordable option.
 * That ordering falls out of the prices rather than being hand-written, and it
 * correctly refuses to buy a port opener whose servers are still above the
 * player's hacking level.
 */
export function buyRam(sim, { keep = 0, stopAfter = Infinity, channels = "all", minServer = 2 } = {}) {
  if (sim.t > stopAfter) return;
  const on = (c) => channels === "all" || channels.includes(c);

  for (let guard = 0; guard < 24; guard++) {
    const options = [];

    // Next port opener (with the TOR fee folded in if it is not bought yet).
    if (on("program")) {
      const ports = sim.portsOpenable;
      const next = PORT_PROGRAMS[ports];
      if (next) {
        const cost = next.price + (sim.hasTor ? 0 : TOR_COST);
        const gb = ramUnlockedBy(sim, ports + 1) - ramUnlockedBy(sim, ports);
        if (gb > 0) options.push({ kind: "program", cost, gb, per: cost / gb });
      }
    }

    // Biggest affordable cloud server, or an upgrade of the smallest one held.
    if (on("server")) {
      const perGb = sim.cloudServerCost(8) / 8;
      const ram = sim.bestAffordableServer({ keep });
      if (ram >= minServer && sim.purchased.length < CLOUD_LIMIT) {
        options.push({ kind: "server", ram, cost: sim.cloudServerCost(ram), gb: ram, per: perGb });
      } else if (sim.purchased.length >= CLOUD_LIMIT) {
        const weakest = sim.purchased
          .map((h) => sim.servers.get(h))
          .reduce((a, b) => (a.maxRam <= b.maxRam ? a : b));
        const to = weakest.maxRam * 2;
        const cost = sim.cloudServerCost(to) - sim.cloudServerCost(weakest.maxRam);
        if (isFinite(cost) && cost <= sim.money - keep) {
          options.push({ kind: "upgrade", host: weakest.hostname, ram: to, cost, gb: weakest.maxRam, per: perGb });
        }
      }
    }

    if (on("home")) {
      const cost = sim.homeRamUpgradeCost();
      options.push({ kind: "home", cost, gb: sim.home.maxRam, per: cost / sim.home.maxRam });
    }

    const affordable = options.filter((o) => o.cost <= sim.money - keep);
    if (!affordable.length) return;
    affordable.sort((a, b) => a.per - b.per);
    const pick = affordable[0];

    if (pick.kind === "program") sim.buyPortPrograms({ keep });
    else if (pick.kind === "server") sim.buyServer(pick.ram);
    else if (pick.kind === "upgrade") sim.upgradeServer(pick.host, pick.ram);
    else if (!sim.upgradeHomeRam()) return;
    keepRooting(sim);
  }
}

/**
 * What buyserv.js does live, modelled exactly: wake every `interval`, and if
 * money exceeds `reserve`, buy **one** server — the largest power of two the
 * surplus affords, floor 8GB — or, once the fleet is full, double the smallest.
 * Everything left over waits for the next wake-up.
 */
export function buyservJs(sim, { reserve = 2e6, interval = 120_000, minServer = 8 } = {}) {
  if (sim.t < (sim._buyservNext ?? 0)) return;
  sim._buyservNext = sim.t + interval;

  const surplus = sim.money - reserve;
  if (surplus <= 0) return;

  if (sim.purchased.length < CLOUD_LIMIT) {
    let ram = 0;
    for (let r = minServer; r <= 1048576; r *= 2) if (sim.cloudServerCost(r) <= surplus) ram = r;
    if (ram > 0) sim.buyServer(ram);
    return;
  }
  const weakest = sim.purchased.map((h) => sim.servers.get(h)).reduce((a, b) => (a.maxRam <= b.maxRam ? a : b));
  const to = weakest.maxRam * 2;
  if (sim.cloudServerCost(to) - sim.cloudServerCost(weakest.maxRam) <= surplus) sim.upgradeServer(weakest.hostname, to);
}

/** Wrap any strategy so it reinvests income in RAM. */
export function withRam(inner, opts = {}, label = null) {
  return {
    name: label ?? `${inner.name} + ram`,
    init: (sim) => inner.init?.(sim),
    tick(sim) {
      buyRam(sim, opts);
      inner.tick(sim);
    },
  };
}

/** Wrap any strategy with an arbitrary spending policy. */
export function withBuyer(inner, buy, label) {
  return {
    name: label,
    init: (sim) => inner.init?.(sim),
    tick(sim) {
      buy(sim);
      inner.tick(sim);
    },
  };
}

/**
 * Fix for the joesguns deadlock: a strategy pinned to a server it cannot yet
 * reach used to sit at $1k forever, because nothing bootstraps the hacking
 * level that would root it. Fall back to the best reachable target until the
 * real one is available, which is what a player would obviously do.
 */
export function withFallback(factory, target, fallbackFactory = null) {
  const fb = fallbackFactory ?? ((t) => earlyJs(t));
  return {
    name: `${factory(target).name} (bootstrapped)`,
    tick(sim) {
      keepRooting(sim);
      const t = sim.servers.get(target);
      const ready = t?.hasAdminRights && t.requiredHackingSkill <= sim.hacking;
      const want = ready ? target : bestTarget(sim) ?? "n00dles";
      if (this._for !== want) {
        this._inner = (ready ? factory : fb)(want);
        this._for = want;
      }
      this._inner.tick(sim);
    },
  };
}

/** Highest $/second a prepped server could yield at the current level. */
export function bestTarget(sim, { exclude = new Set() } = {}) {
  let best = null;
  let bestRate = -1;
  for (const t of sim.targets()) {
    if (t.moneyMax <= 0 || exclude.has(t.hostname)) continue;
    const prepped = { ...t, hackDifficulty: t.minDifficulty };
    const pct = calculatePercentMoneyHacked(prepped, sim.player);
    const chance = calculateHackingChance(prepped, sim.player);
    const rate = (t.moneyMax * pct * chance) / calculateHackingTime(prepped, sim.player);
    if (rate > bestRate) (bestRate = rate), (best = t.hostname);
  }
  return best;
}

/**
 * What early.js does today: threads decide weaken / grow / hack against one
 * fixed target by threshold — security within +5 of minimum, money above 75%.
 */
export function earlyJs(target = "n00dles", { securitySlack = 5, moneyFloor = 0.75 } = {}) {
  return {
    name: `early.js on ${target}`,
    tick(sim) {
      keepRooting(sim);
      const t = sim.servers.get(target);
      if (!t?.hasAdminRights) return;

      if (t.hackDifficulty > t.minDifficulty + securitySlack) fill(sim, "weaken", target);
      else if (t.moneyAvailable < t.moneyMax * moneyFloor) fill(sim, "grow", target);
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

// ---------------------------------------------------------------------------
// Target ranking indices.
//
// `auto.js` ranks live by M·φ/T: max money times the fraction one thread takes
// at minimum security, over hack time. That counts the hack threads and
// nothing else. The prior-art derivation says the figure of merit is money per
// RAM-second of a whole batch, which also pays for putting the money back:
//
//   score = M / ( T · [ 1.98/φ + 6.16/k ] )
//
// where k = calculateServerGrowthLog(server, 1, player) is the per-thread
// growth log constant, proportional to serverGrowth — which spans 1..99 across
// this network. The claim is that ignoring it over-ranks rich, slow-growing
// servers. These indices exist to settle that in simulation.
// ---------------------------------------------------------------------------

export const INDEX = {
  /** What auto.js computes today. */
  live: (t, sim) => {
    const p = { ...t, hackDifficulty: t.minDifficulty };
    return (t.moneyMax * calculatePercentMoneyHacked(p, sim.player)) / calculateHackingTime(p, sim.player);
  },
  /** auto.js's index times the chance the hack actually lands. */
  liveChance: (t, sim) => {
    const p = { ...t, hackDifficulty: t.minDifficulty };
    return (
      (t.moneyMax * calculatePercentMoneyHacked(p, sim.player) * calculateHackingChance(p, sim.player)) /
      calculateHackingTime(p, sim.player)
    );
  },
  /** Money per RAM-second of a full HWGW batch, as f -> 0. */
  batch: (t, sim) => {
    const p = { ...t, hackDifficulty: t.minDifficulty };
    const phi = calculatePercentMoneyHacked(p, sim.player);
    const k = calculateServerGrowthLog(p, 1, sim.player, 1);
    if (!(phi > 0) || !(k > 0)) return 0;
    return t.moneyMax / (calculateHackingTime(p, sim.player) * (1.98 / phi + 6.16 / k));
  },
  /** The same, weighted by hack chance. */
  batchChance: (t, sim) => INDEX.batch(t, sim) * calculateHackingChance({ ...t, hackDifficulty: t.minDifficulty }, sim.player),
};

/** Retarget by an arbitrary index, otherwise behaving exactly like auto.js. */
export function autoTargetBy(indexName, factory = (t) => earlyJs(t)) {
  const score = INDEX[indexName];
  return {
    name: `rank by ${indexName}`,
    tick(sim) {
      keepRooting(sim);
      let best = null;
      let bestRate = -1;
      for (const t of sim.targets()) {
        if (t.moneyMax <= 0) continue;
        const r = score(t, sim);
        if (r > bestRate) (bestRate = r), (best = t.hostname);
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

// ---------------------------------------------------------------------------
// One target or many.
//
// A target holds at most moneyMax and regrows at its own rate, so the threads
// it can absorb are bounded: enough to weaken it to minimum, enough to grow it
// back to full, enough to take the money once. Past that, threads land on a
// server that has already been emptied and return nothing — `complete()` caps
// the drain at moneyAvailable, exactly as the game does.
//
// The allocators below differ only in what they do with the surplus.
// ---------------------------------------------------------------------------

/** Every viable target, best $/s at minimum security first. */
export function rankTargets(sim) {
  const out = [];
  for (const t of sim.targets()) {
    if (t.moneyMax <= 0) continue;
    const prepped = { ...t, hackDifficulty: t.minDifficulty };
    const pct = calculatePercentMoneyHacked(prepped, sim.player);
    if (pct <= 0) continue;
    const chance = calculateHackingChance(prepped, sim.player);
    out.push({ t, rate: (t.moneyMax * pct * chance) / calculateHackingTime(prepped, sim.player) });
  }
  out.sort((a, b) => b.rate - a.rate);
  return out.map((x) => x.t);
}

/** Grow threads that would take this server from where it is back to full. */
export function growThreadsNeeded(sim, t, cores = 1) {
  if (t.moneyAvailable >= t.moneyMax) return 0;
  const n = numCycleForGrowthCorrected(t, t.moneyMax, Math.max(t.moneyAvailable, 1), cores, sim.player);
  return isFinite(n) ? Math.ceil(n) : 1e6;
}

/**
 * What a single target can usefully absorb *right now*, under the early.js
 * threshold policy: whichever of weaken / grow / hack it is due for, and only
 * as many threads as that step actually consumes.
 */
export function demand(sim, t, { hackFraction = 1, securitySlack = 5, moneyFloor = 0.75 } = {}) {
  if (t.hackDifficulty > t.minDifficulty + securitySlack)
    return { op: "weaken", threads: weakenThreadsNeeded(t) };
  if (t.moneyAvailable < t.moneyMax * moneyFloor)
    return { op: "grow", threads: growThreadsNeeded(sim, t) };
  const pct = calculatePercentMoneyHacked(t, sim.player);
  if (pct <= 0) return { op: "hack", threads: 0 };
  return { op: "hack", threads: Math.max(1, Math.ceil(hackFraction / pct)) };
}

/**
 * Rank targets, serve each one exactly its demand, and pass the surplus RAM
 * down the list. With little RAM this is identical to single-targeting; the
 * second target only ever gets threads the first one could not have used.
 */
export function flowTargets(k = Infinity, opts = {}, label = null) {
  return {
    name: label ?? `early.js flowing over ${k === Infinity ? "all" : k} targets`,
    tick(sim) {
      keepRooting(sim);
      let budget = Math.floor(sim.totalFreeRam() / sim.scriptRam.weaken);
      if (budget < 1) return;
      for (const t of rankTargets(sim).slice(0, k)) {
        if (budget < 1) break;
        const d = demand(sim, t, opts);
        if (d.threads < 1) continue;
        const want = Math.min(d.threads, budget);
        budget -= fill(sim, d.op, t.hostname, want);
      }
    },
  };
}

/** Round-robin: split the fleet evenly over the top k, need or no need. */
export function splitTargets(k, opts = {}) {
  return {
    name: `early.js split evenly over ${k} targets`,
    tick(sim) {
      keepRooting(sim);
      const ranked = rankTargets(sim).slice(0, k);
      if (!ranked.length) return;
      const share = Math.floor(sim.totalFreeRam() / sim.scriptRam.weaken / ranked.length);
      if (share < 1) return;
      for (const t of ranked) {
        const d = demand(sim, t, opts);
        if (d.threads < 1) continue;
        fill(sim, d.op, t.hostname, Math.min(d.threads, share));
      }
    },
  };
}

/**
 * Rank by an index from INDEX rather than the ad-hoc $/s in rankTargets.
 * `batchChance` is what auto.js ships.
 */
export function rankBy(sim, indexName = "batchChance") {
  const score = INDEX[indexName];
  return sim
    .targets()
    .filter((t) => t.moneyMax > 0)
    .map((t) => ({ t, s: score(t, sim) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.t);
}

/**
 * What a *minimal* multi-target auto.js can actually do.
 *
 * auto.js runs one early.js process per host, and early.js takes its target as
 * an argument — so the unit auto.js can hand out is a whole host, not a slice
 * of the fleet's free RAM. This partitions hosts across the top k targets
 * least-loaded-first (so a 1024GB purchased server and a 16GB rooted box end up
 * balanced by GB, not by count) and then runs the ordinary threshold policy on
 * each host against its assigned target.
 *
 * That distinction matters: splitTargets below divides the *global* free RAM
 * every tick, which no per-host worker script can implement without a central
 * dispatcher. This one is shippable as an argument change.
 */
export function partitionTargets(k, { moneyFloor = 0.5, securitySlack = 5, index = "batchChance" } = {}) {
  return {
    name: `partition over ${k} targets`,
    tick(sim) {
      keepRooting(sim);
      const ranked = rankBy(sim, index).slice(0, k);
      if (!ranked.length) return;

      const load = ranked.map((t) => ({ t, gb: 0, hosts: [] }));
      for (const h of [...sim.hosts()].sort((a, b) => b.maxRam - a.maxRam)) {
        const slot = load.reduce((a, b) => (a.gb <= b.gb ? a : b));
        slot.gb += h.maxRam;
        slot.hosts.push(h);
      }

      for (const { t, hosts } of load) {
        const op =
          t.hackDifficulty > t.minDifficulty + securitySlack
            ? "weaken"
            : t.moneyAvailable < t.moneyMax * moneyFloor
              ? "grow"
              : "hack";
        for (const h of hosts) {
          const threads = Math.floor(sim.avail(h) / sim.scriptRam[op]);
          if (threads >= 1) sim.exec(h.hostname, op, t.hostname, threads);
        }
      }
    },
  };
}

/** Single target, but capped at what it can actually absorb. Isolates the cap. */
export function cappedSingle(opts = {}) {
  return flowTargets(1, opts, "early.js on best target, demand-capped");
}

const GREEDY = { channels: ["program", "server"] };

/**
 * Hand a strategy a fixed fleet for free and forbid it from buying more, so
 * two policies can be compared at identical RAM. Without this every
 * comparison is contaminated: the arm that earns slightly more buys slightly
 * more RAM, earns more again, and the gap is compounding rather than policy.
 */
export function atFixedRam(inner, gb, { ports = 0 } = {}) {
  return {
    name: `${inner.name} @ ${gb}GB${ports ? ` +${ports}p` : ""}`,
    init(sim) {
      for (let i = 0; i < ports; i++) sim.programs.add(PORT_PROGRAMS[i].name);
      sim.hasTor = ports > 0;
      let left = gb;
      while (left >= 8 && sim.purchased.length < CLOUD_LIMIT) {
        const chunk = Math.min(left, 1 << Math.floor(Math.log2(left)));
        sim.player.money += sim.cloudServerCost(chunk);
        sim.buyServer(chunk);
        sim.stats.ramSpend -= sim.cloudServerCost(chunk);
        left -= chunk;
      }
      inner.init?.(sim);
    },
    tick: (sim) => inner.tick(sim),
  };
}

/**
 * Grant (or take away) cloud servers so the fleet starts at exactly `gb` in
 * total, then forbid buying. atFixedRam adds to whatever the world already has,
 * which is fine from a fresh start but not from --live, where the save already
 * carries purchased servers. This pins the axis instead.
 */
export function atTotalRam(inner, gb, { ports = 0 } = {}) {
  return {
    name: `${inner.name} @ ${gb}GB`,
    scriptRam: inner.scriptRam,
    init(sim) {
      for (let i = 0; i < ports; i++) sim.programs.add(PORT_PROGRAMS[i].name);
      if (ports > 0) sim.hasTor = true;
      sim.nuke();
      // Drop anything the save already bought, so `gb` means the same thing in
      // every arm. home is flagged purchasedByPlayer in the save and must stay.
      for (const s of [...sim.servers.values()])
        if (s.purchasedByPlayer && s.hostname !== "home") sim.servers.delete(s.hostname);
      sim.purchased = [];
      let left = gb - sim.totalRam();
      while (left >= 2 && sim.purchased.length < CLOUD_LIMIT) {
        const chunk = Math.min(left, 1 << Math.floor(Math.log2(left)));
        sim.player.money += sim.cloudServerCost(chunk);
        sim.buyServer(chunk);
        sim.stats.ramSpend -= sim.cloudServerCost(chunk);
        left -= chunk;
      }
      inner.init?.(sim);
    },
    tick: (sim) => inner.tick(sim),
  };
}

/** Tag a strategy as running early.js workers, which cost 2.4GB per thread. */
export function asEarlyJs(inner) {
  return { ...inner, scriptRam: { hack: 2.4, grow: 2.4, weaken: 2.4 }, tick: (sim) => inner.tick(sim) };
}

/** The threshold loop exactly as shipped: batchChance ranking, 50% money floor. */
export function shippedLoop() {
  return asEarlyJs({
    ...autoTargetBy("batchChance", (t) => earlyJs(t, { moneyFloor: 0.5 })),
    name: "threshold loop (shipped)",
  });
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

  // --- infrastructure policies, all on top of the same auto-early hacking ---
  "infra-live": () =>
    withBuyer(autoTarget((t) => earlyJs(t), "early.js"), (s) => buyservJs(s), "LIVE: buyserv.js ($2m reserve)"),
  "infra-live-nores": () =>
    withBuyer(autoTarget((t) => earlyJs(t), "early.js"), (s) => buyservJs(s, { reserve: 0 }), "buyserv.js, no reserve"),
  "infra-serv": () =>
    withRam(autoTarget((t) => earlyJs(t), "early.js"), { channels: ["server"] }, "greedy cloud servers only"),
  "infra-serv-home": () =>
    withRam(autoTarget((t) => earlyJs(t), "early.js"), { channels: ["server", "home"] }, "cloud + home, no programs"),
  "infra-prog": () =>
    withRam(autoTarget((t) => earlyJs(t), "early.js"), { channels: ["program"] }, "port programs only"),
  "infra-prog-serv": () =>
    withRam(autoTarget((t) => earlyJs(t), "early.js"), { channels: ["program", "server"] }, "programs + cloud servers"),
  "infra-all": () => withRam(autoTarget((t) => earlyJs(t), "early.js"), {}, "programs + cloud + home (ranked)"),

  // --- one target or many, all on the same greedy infrastructure policy ---
  "spread-1-uncapped": () => withRam(autoTarget((t) => earlyJs(t), "early.js"), GREEDY, "1 target, uncapped (live)"),
  "spread-1": () => withRam(cappedSingle(), GREEDY, "1 target, demand-capped"),
  "spread-2": () => withRam(flowTargets(2), GREEDY, "flow over 2 targets"),
  "spread-3": () => withRam(flowTargets(3), GREEDY, "flow over 3 targets"),
  "spread-5": () => withRam(flowTargets(5), GREEDY, "flow over 5 targets"),
  "spread-all": () => withRam(flowTargets(Infinity), GREEDY, "flow over all targets"),
  "split-2": () => withRam(splitTargets(2), GREEDY, "split evenly over 2"),
  "split-3": () => withRam(splitTargets(3), GREEDY, "split evenly over 3"),

  // --- the realistic forward path: no port programs (no SF4 = manual only),
  // --- cloud servers only, starting from a fresh BN1. What to actually ship.
  "ship-live": () =>
    withBuyer(autoTargetBy("live", (t) => earlyJs(t, { moneyFloor: 0.75 })), (s) => buyservJs(s), "LIVE auto+buyserv"),
  "ship-idx": () =>
    withBuyer(
      autoTargetBy("batchChance", (t) => earlyJs(t, { moneyFloor: 0.75 })),
      (s) => buyservJs(s),
      "v2 index only, live buyer",
    ),
  "ship-idx-buy": () =>
    withBuyer(
      autoTargetBy("batchChance", (t) => earlyJs(t, { moneyFloor: 0.75 })),
      (s) => buyRam(s, { channels: ["server"] }),
      "v2 index + greedy buyer",
    ),
  ...Object.fromEntries(
    [0.05, 0.1, 0.25, 0.5].map((f) => [
      `ship-v2-${Math.round(f * 100)}`,
      () =>
        withBuyer(
          autoTargetBy("batchChance", (t) => earlyJs(t, { moneyFloor: f })),
          (s) => buyRam(s, { channels: ["server"] }),
          `v2 all, floor ${Math.round(f * 100)}%`,
        ),
    ]),
  ),
  ...Object.fromEntries(
    [0, 1.5e6, 2e6, 5e6].map((keep) => [
      `ship-keep${keep / 1e6}`,
      () =>
        withBuyer(
          autoTargetBy("batchChance", (t) => earlyJs(t, { moneyFloor: 0.5 })),
          (s) => buyRam(s, { channels: ["server"], keep }),
          `v2, standing reserve $${keep / 1e6}m`,
        ),
    ]),
  ),
  "ship-v2-adaptive": () =>
    withBuyer(
      {
        tick(sim) {
          const f = sim.totalRam() >= 1024 ? 0.75 : 0.25;
          if (this._f !== f) {
            this._inner = autoTargetBy("batchChance", (t) => earlyJs(t, { moneyFloor: f }));
            this._f = f;
          }
          this._inner.tick(sim);
        },
      },
      (s) => buyRam(s, { channels: ["server"] }),
      "v2 all, floor adaptive",
    ),

  // --- the proposed auto.js / early.js patch, against what runs live ---
  ...Object.fromEntries(
    [0, 1024].flatMap((gb) =>
      [
        ["live", 0.75],
        ["batchChance", 0.75],
        ["batchChance", 0.5],
        ["batchChance", 0.25],
        ["batchChance", 0.1],
        ["batchChance", 0.05],
      ].map(([ix, f]) => [
        `patch${gb}-${ix}-${Math.round(f * 100)}`,
        () =>
          atFixedRam(
            {
              ...autoTargetBy(ix, (t) => earlyJs(t, { moneyFloor: f })),
              name: `${ix} + floor ${Math.round(f * 100)}%`,
            },
            gb,
            { ports: gb ? 2 : 0 },
          ),
      ]),
    ),
  ),

  // --- target ranking indices, RAM pinned so nothing compounds ---
  ...Object.fromEntries(
    [0, 1024, 8192].flatMap((gb) =>
      ["live", "liveChance", "batch", "batchChance"].map((ix) => [
        `ix${gb}-${ix}`,
        () => atFixedRam(autoTargetBy(ix), gb, { ports: gb ? 2 : 0 }),
      ]),
    ),
  ),

  // --- early.js's two thresholds, swept at the RAM the live game has ---
  ...Object.fromEntries(
    [0, 1, 2, 3, 5, 10, 20].map((sec) => [
      `th-sec${sec}`,
      () =>
        atFixedRam(
          autoTarget((t) => earlyJs(t, { securitySlack: sec }), `sec +${sec}`),
          0,
          { ports: 0 },
        ),
    ]),
  ),
  ...Object.fromEntries(
    [0, 1024, 8192].flatMap((gb) =>
      [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99].map((f) => [
        `th${gb}-money${Math.round(f * 100)}`,
        () =>
          atFixedRam(
            autoTarget((t) => earlyJs(t, { moneyFloor: f }), `money ${Math.round(f * 100)}%`),
            gb,
            { ports: gb ? 2 : 0 },
          ),
      ]),
    ),
  ),

  // --- multi-target for auto.js, at the real 2.4GB early.js worker cost,
  // --- from the live world, with the fleet pinned to an exact total.
  // mt<GB>-1u is exactly what runs live today.
  ...Object.fromEntries(
    [2048, 4096, 8192, 16384, 32768].flatMap((gb) => {
      const arms = [
        ["1u", () => autoTargetBy("batchChance", (t) => earlyJs(t, { moneyFloor: 0.5 }))],
        ["1c", () => cappedSingle({ moneyFloor: 0.5 })],
        ["p2", () => partitionTargets(2)],
        ["p3", () => partitionTargets(3)],
        ["p4", () => partitionTargets(4)],
        ["p5", () => partitionTargets(5)],
        ["p8", () => partitionTargets(8)],
        ["f2", () => flowTargets(2, { moneyFloor: 0.5 })],
        ["f3", () => flowTargets(3, { moneyFloor: 0.5 })],
        ["f5", () => flowTargets(5, { moneyFloor: 0.5 })],
        ["s2", () => splitTargets(2, { moneyFloor: 0.5 })],
        ["s3", () => splitTargets(3, { moneyFloor: 0.5 })],
        ["s5", () => splitTargets(5, { moneyFloor: 0.5 })],
      ];
      return arms.map(([tag, make]) => [`mt${gb}-${tag}`, () => atTotalRam(asEarlyJs(make()), gb)]);
    }),
  ),

  // --- HWGW batching vs the shipped threshold loop, RAM pinned to a total ---
  // bt<GB>-thr   the loop as it runs live (early.js workers, 2.4GB/thread)
  // bt<GB>-ba    batcher, target count chosen by the saturation arithmetic
  // bt<GB>-b1..5 batcher pinned to a fixed number of targets
  ...Object.fromEntries(
    [2048, 4096, 8192, 12288, 16384, 32768].flatMap((gb) => [
      [`bt${gb}-thr`, () => atTotalRam(shippedLoop(), gb)],
      [`bt${gb}-ba`, () => atTotalRam(hwgwBatcher({}), gb)],
      [`bt${gb}-b1`, () => atTotalRam(hwgwBatcher({ nTargets: 1 }), gb)],
      [`bt${gb}-b2`, () => atTotalRam(hwgwBatcher({ nTargets: 2 }), gb)],
      [`bt${gb}-b3`, () => atTotalRam(hwgwBatcher({ nTargets: 3 }), gb)],
      [`bt${gb}-b5`, () => atTotalRam(hwgwBatcher({ nTargets: 5 }), gb)],
      [`bt${gb}-b8`, () => atTotalRam(hwgwBatcher({ nTargets: 8 }), gb)],
      [`bt${gb}-bans`, () => atTotalRam(hwgwBatcher({ spill: "none" }), gb)],
      [`bt${gb}-banog`, () => atTotalRam(hwgwBatcher({ secGate: false }), gb)],
      [`bt${gb}-bah1`, () => atTotalRam(hwgwBatcher({ hackThreads: 1 }), gb)],
      [`bt${gb}-bae50`, () => atTotalRam(hwgwBatcher({ spacing: 50 }), gb)],
      [`bt${gb}-bae100`, () => atTotalRam(hwgwBatcher({ spacing: 100 }), gb)],
      [`bt${gb}-bae500`, () => atTotalRam(hwgwBatcher({ spacing: 500 }), gb)],
      [`bt${gb}-bam2`, () => atTotalRam(hwgwBatcher({ minInFlight: 2 }), gb)],
      [`bt${gb}-bam8`, () => atTotalRam(hwgwBatcher({ minInFlight: 8 }), gb)],
      [`bt${gb}-bam16`, () => atTotalRam(hwgwBatcher({ minInFlight: 16 }), gb)],
      [`bt${gb}-bam32`, () => atTotalRam(hwgwBatcher({ minInFlight: 32 }), gb)],
      // Deliberately under-provisioned grow, so the pipeline drifts into
      // desync. Exercises the drain path, which otherwise never fires.
      [`bt${gb}-badrain`, () => atTotalRam(hwgwBatcher({ margin: 0.85, label: "hwgw, grow under-provisioned 15%" }), gb)],
      [`bt${gb}-badrain2`, () => atTotalRam(hwgwBatcher({ margin: 0.6, label: "hwgw, grow under-provisioned 40%" }), gb)],
    ]),
  ),

  // --- the batcher on the live fleet, unpinned: how many targets? ---
  // The fleet is at the 25-server cloud cap and buyserv.js is parked, so RAM is
  // fixed; the only free variable left is how many targets to spread it over.
  ...Object.fromEntries(
    [1, 2, 3, 4, 6, 8, 10, 12, 16].map((k) => [
      `liveN${k}`,
      () => hwgwBatcher({ nTargets: k, maxTargets: 16, label: `hwgw ${k} target${k > 1 ? "s" : ""}` }),
    ]),
  ),
  "liveNauto": () => hwgwBatcher({ label: "hwgw auto (shipped rule)" }),
  "liveThr": () => shippedLoop(),
  // A second RAM anchor for the target-count rule, on the corrected world.
  ...Object.fromEntries(
    [32768, 98304].flatMap((gb) =>
      [1, 2, 3, 4, 6, 8, 12].map((k) => [
        `pin${gb}N${k}`,
        () => atTotalRam(hwgwBatcher({ nTargets: k, maxTargets: 16, label: `hwgw ${k}t @${gb}GB` }), gb),
      ]),
    ),
  ),

  // --- the same question with RAM pinned, so nothing compounds ---
  ...Object.fromEntries(
    [0, 1024, 2048, 4096, 8192, 16384, 65536].flatMap((gb) => [
      [`fx${gb}-1u`, () => atFixedRam(autoTarget((t) => earlyJs(t), "1 uncapped"), gb, { ports: 2 })],
      [`fx${gb}-1c`, () => atFixedRam(cappedSingle(), gb, { ports: 2 })],
      [`fx${gb}-2`, () => atFixedRam(flowTargets(2), gb, { ports: 2 })],
      [`fx${gb}-3`, () => atFixedRam(flowTargets(3), gb, { ports: 2 })],
      [`fx${gb}-s2`, () => atFixedRam(splitTargets(2), gb, { ports: 2 })],
      [`fx${gb}-s3`, () => atFixedRam(splitTargets(3), gb, { ports: 2 })],
    ]),
  ),
};
