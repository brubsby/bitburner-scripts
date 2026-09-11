// Discrete-event simulator for the Bitburner early game.
//
// Every number that matters comes from the game's own source via game.mjs —
// this file only supplies the parts the game couples to its React/worker
// runtime: a clock, a RAM allocator, and an event queue.
//
// Operation *duration* is computed when the op starts and its *effect* when it
// lands, which is what the game does. That gap is the entire reason batching
// is hard, so the sim has to reproduce it faithfully.

import {
  ServerConstants,
  calculateGrowMoney,
  calculateGrowTime,
  calculateHackingChance,
  calculateHackingExpGain,
  calculateHackingTime,
  calculatePercentMoneyHacked,
  calculateSkill,
  calculateWeakenTime,
  currentNodeMults,
  getUpgradeHomeRamCost,
  getWeakenEffect,
  numCycleForGrowthCorrected,
} from "./game.mjs";

/** RAM a single thread of each op costs, matching the repo's worker scripts. */
export const THREAD_RAM = { hack: 1.7, grow: 1.75, weaken: 1.75 };

/** Deterministic PRNG so strategy comparisons are reproducible. */
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** No augmentations installed, so every multiplier is 1. */
const BASE_MULTS = {
  hacking: 1,
  hacking_chance: 1,
  hacking_speed: 1,
  hacking_money: 1,
  hacking_grow: 1,
  hacking_exp: 1,
};

/** src/Server/Server.ts capDifficulty — a method on a class the sim does not instantiate. */
function capDifficulty(server) {
  if (server.hackDifficulty < server.minDifficulty) server.hackDifficulty = server.minDifficulty;
  if (server.hackDifficulty < 1) server.hackDifficulty = 1;
  if (server.hackDifficulty > 100) server.hackDifficulty = 100;
}

export class Sim {
  constructor(world, { seed = 1, scriptRam = THREAD_RAM } = {}) {
    this.t = 0; // ms
    this.rng = makeRng(seed);
    this.scriptRam = scriptRam;
    this.events = [];
    this.stats = { hacks: 0, hackFails: 0, grows: 0, weakens: 0, moneyStolen: 0, threadSeconds: 0, ramUpgrades: 0 };

    // Shaped like the game's Person so the real formulas accept it directly.
    this.player = {
      money: world.player.money,
      hackExp: world.player.hackExp,
      skills: { hacking: calculateSkill(world.player.hackExp), intelligence: 0 },
      mults: { ...BASE_MULTS },
    };

    this.servers = new Map();
    for (const s of world.servers) {
      this.servers.set(s.hostname, {
        ...s,
        usedRam: 0,
        cpuCores: s.hostname === "home" ? (world.player.homeCores ?? 1) : 1,
      });
    }
  }

  get hacking() {
    return this.player.skills.hacking;
  }

  get money() {
    return this.player.money;
  }

  get home() {
    return this.servers.get("home");
  }

  /** Rooted servers with usable RAM, including home. */
  hosts() {
    return [...this.servers.values()].filter((s) => s.hasAdminRights && s.maxRam > 0);
  }

  freeRam(hostname) {
    const s = this.servers.get(hostname);
    return s ? s.maxRam - s.usedRam : 0;
  }

  totalFreeRam() {
    return this.hosts().reduce((a, s) => a + (s.maxRam - s.usedRam), 0);
  }

  totalRam() {
    return this.hosts().reduce((a, s) => a + s.maxRam, 0);
  }

  /** Servers that can be hacked right now. */
  targets() {
    return [...this.servers.values()].filter(
      (s) => s.hasAdminRights && s.moneyMax > 0 && s.requiredHackingSkill <= this.hacking,
    );
  }

  /** Launch an op. Returns false if it does not fit, exactly as the game would refuse. */
  exec(hostname, op, targetName, threads) {
    threads = Math.floor(threads);
    if (threads < 1) return false;
    const host = this.servers.get(hostname);
    const target = this.servers.get(targetName);
    if (!host || !target || !host.hasAdminRights || !target.hasAdminRights) return false;

    const ram = this.scriptRam[op] * threads;
    if (ram > host.maxRam - host.usedRam + 1e-9) return false;
    if (op === "hack" && target.requiredHackingSkill > this.hacking) return false;

    host.usedRam += ram;

    const seconds =
      op === "hack"
        ? calculateHackingTime(target, this.player)
        : op === "grow"
          ? calculateGrowTime(target, this.player)
          : calculateWeakenTime(target, this.player);

    this.push({ at: this.t + seconds * 1000, op, host: hostname, target: targetName, threads, ram });
    this.stats.threadSeconds += threads * seconds;
    return true;
  }

  push(ev) {
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].at > ev.at) i--;
    this.events.splice(i, 0, ev);
  }

  gainExp(amount) {
    this.player.hackExp += amount;
    this.player.skills.hacking = calculateSkill(this.player.hackExp);
  }

  /** Apply a completed operation, as the game does on landing. */
  complete(ev) {
    const host = this.servers.get(ev.host);
    const target = this.servers.get(ev.target);
    host.usedRam -= ev.ram;
    if (host.usedRam < 1e-9) host.usedRam = 0;

    const expPerThread = calculateHackingExpGain(target, this.player);

    if (ev.op === "weaken") {
      target.hackDifficulty -= getWeakenEffect(ev.threads, host.cpuCores);
      capDifficulty(target);
      this.gainExp(expPerThread * ev.threads);
      this.stats.weakens++;
      return;
    }

    if (ev.op === "grow") {
      const before = target.moneyAvailable;
      target.moneyAvailable = calculateGrowMoney(target, ev.threads, this.player, host.cpuCores);
      if (before !== target.moneyAvailable) {
        const used = Math.min(
          Math.max(
            0,
            Math.ceil(numCycleForGrowthCorrected(target, target.moneyAvailable, before, host.cpuCores, this.player)),
          ),
          ev.threads,
        );
        target.hackDifficulty += 2 * ServerConstants.ServerFortifyAmount * used;
        capDifficulty(target);
      }
      this.gainExp(expPerThread * ev.threads);
      this.stats.grows++;
      return;
    }

    // hack — src/Netscript/NetscriptHelpers.tsx
    const chance = calculateHackingChance(target, this.player);
    let exp = expPerThread * ev.threads;
    if (this.rng() < chance) {
      const pct = calculatePercentMoneyHacked(target, this.player);
      const maxThreadNeeded = pct > 0 ? Math.ceil(1 / pct) : 1e6;
      const drained = Math.min(target.moneyAvailable, Math.max(0, target.moneyAvailable * pct * ev.threads));
      if (drained === 0) exp /= 4;
      target.moneyAvailable -= drained;
      const gained = drained * currentNodeMults.ScriptHackMoneyGain;
      this.player.money += gained;
      this.stats.moneyStolen += gained;
      this.stats.hacks++;
      target.hackDifficulty += ServerConstants.ServerFortifyAmount * Math.min(ev.threads, maxThreadNeeded);
      capDifficulty(target);
    } else {
      exp /= 4;
      this.stats.hackFails++;
    }
    this.gainExp(exp);
  }

  homeRamUpgradeCost() {
    return getUpgradeHomeRamCost.call({ getHomeComputer: () => this.home });
  }

  /** Buy the next home RAM doubling if affordable. */
  upgradeHomeRam() {
    const cost = this.homeRamUpgradeCost();
    if (this.player.money < cost) return false;
    this.player.money -= cost;
    this.home.maxRam *= 2;
    this.stats.ramUpgrades++;
    return true;
  }

  /**
   * Root everything now in reach. Port-opening programs are not modelled, so
   * only the zero-port servers open up — which is exactly the situation for
   * the first stretch of a fresh run.
   */
  nuke() {
    let rooted = 0;
    for (const s of this.servers.values()) {
      if (s.hasAdminRights || s.numOpenPortsRequired > 0) continue;
      if (s.requiredHackingSkill <= this.hacking) {
        s.hasAdminRights = true;
        rooted++;
      }
    }
    return rooted;
  }

  /**
   * Run until durationMs. strategy.tick(sim) is called whenever an op lands
   * and at least every pollMs.
   */
  run(strategy, durationMs, { pollMs = 200, sampleMs = 60_000 } = {}) {
    const curve = [];
    let nextPoll = 0;
    let nextSample = 0;

    strategy.init?.(this);

    const sample = () => {
      curve.push({
        minute: Math.round(this.t / 60000),
        money: Math.round(this.player.money),
        hacking: this.hacking,
        exp: Math.round(this.player.hackExp),
        ram: this.totalRam(),
      });
    };

    while (this.t <= durationMs) {
      if (this.t >= nextSample) {
        sample();
        nextSample += sampleMs;
      }
      if (this.t >= nextPoll) {
        strategy.tick(this);
        nextPoll = this.t + pollMs;
      }

      const next = this.events[0];
      const nextStop = Math.min(nextPoll, nextSample, durationMs + 1);
      if (!next || next.at > nextStop) {
        this.t = nextStop;
        continue;
      }
      this.events.shift();
      this.t = next.at;
      this.complete(next);
      strategy.tick(this);
      nextPoll = this.t + pollMs;
    }

    return {
      strategy: strategy.name,
      minutes: Math.round(durationMs / 60000),
      money: Math.round(this.player.money),
      hacking: this.hacking,
      exp: Math.round(this.player.hackExp),
      homeRam: this.home.maxRam,
      rooted: this.hosts().length,
      ...this.stats,
      moneyStolen: Math.round(this.stats.moneyStolen),
      curve,
    };
  }
}
