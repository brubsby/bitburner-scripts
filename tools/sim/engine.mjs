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
  getCloudServerCost,
  getCloudServerLimit,
  getCloudServerMaxRam,
  CONSTANTS,
  DarkWebItems,
} from "./game.mjs";

/** RAM a single thread of each op costs, matching the repo's worker scripts. */
export const THREAD_RAM = { hack: 1.7, grow: 1.75, weaken: 1.75 };

/**
 * The darkweb port openers, cheapest first. A server needing N open ports
 * needs the first N of these. Prices and the TOR fee are the game's own.
 */
export const PORT_PROGRAMS = [
  { name: "BruteSSH.exe", price: DarkWebItems.BruteSSHProgram.price },
  { name: "FTPCrack.exe", price: DarkWebItems.FTPCrackProgram.price },
  { name: "relaySMTP.exe", price: DarkWebItems.RelaySMTPProgram.price },
  { name: "HTTPWorm.exe", price: DarkWebItems.HTTPWormProgram.price },
  { name: "SQLInject.exe", price: DarkWebItems.SQLInjectProgram.price },
];
export const TOR_COST = CONSTANTS.TorRouterCost;

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
  constructor(world, { seed = 1, scriptRam = THREAD_RAM, homeReserve = 0 } = {}) {
    this.t = 0; // ms
    this.rng = makeRng(seed);
    this.scriptRam = scriptRam;
    /** GB of home RAM held back for the controller script, as real play must. */
    this.homeReserve = homeReserve;
    this.events = [];
    this.stats = {
      hacks: 0,
      hackFails: 0,
      grows: 0,
      weakens: 0,
      moneyStolen: 0,
      threadSeconds: 0,
      ramUpgrades: 0,
      serversBought: 0,
      ramSpend: 0,
      programSpend: 0,
      /** Time-weighted RAM occupancy, so idle capacity is visible. */
      ramGbMs: 0,
      capacityGbMs: 0,
    };

    /** Darkweb state. Programs are bought, not written — writing costs wall time. */
    this.hasTor = world.player?.hasTor ?? false;
    this.programs = new Set(world.player?.programs ?? []);
    this.purchased = [];

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

  /** RAM a strategy may actually claim on a host, after the home reserve. */
  avail(server) {
    const s = typeof server === "string" ? this.servers.get(server) : server;
    if (!s) return 0;
    const reserve = s.hostname === "home" ? this.homeReserve : 0;
    return Math.max(0, s.maxRam - s.usedRam - reserve);
  }

  freeRam(hostname) {
    return this.avail(hostname);
  }

  totalFreeRam() {
    return this.hosts().reduce((a, s) => a + this.avail(s), 0);
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
    if (ram > this.avail(host) + 1e-9) return false;
    if (op === "hack" && target.requiredHackingSkill > this.hacking) return false;

    host.usedRam += ram;
    this.begin({ op, host: hostname, target: targetName, threads, ram });
    return true;
  }

  /**
   * Launch an op that sleeps `delayMs` before acting — exactly what the repo's
   * w.js/g.js/h.js do with their delay argument. RAM is claimed now, but the
   * duration is computed when the sleep ends, which is what makes batch
   * landing order predictable in the real game.
   */
  execAt(hostname, op, targetName, threads, delayMs) {
    if (!(delayMs > 0)) return this.exec(hostname, op, targetName, threads);
    threads = Math.floor(threads);
    if (threads < 1) return false;
    const host = this.servers.get(hostname);
    const target = this.servers.get(targetName);
    if (!host || !target || !host.hasAdminRights || !target.hasAdminRights) return false;

    const ram = this.scriptRam[op] * threads;
    if (ram > this.avail(host) + 1e-9) return false;
    host.usedRam += ram;
    this.push({ at: this.t + delayMs, kind: "start", op, host: hostname, target: targetName, threads, ram });
    return true;
  }

  /** Compute duration from the state at this instant and schedule the landing. */
  begin({ op, host, target, threads, ram }) {
    const t = this.servers.get(target);
    const seconds =
      op === "hack"
        ? calculateHackingTime(t, this.player)
        : op === "grow"
          ? calculateGrowTime(t, this.player)
          : calculateWeakenTime(t, this.player);
    this.push({ at: this.t + seconds * 1000, op, host, target, threads, ram });
    this.stats.threadSeconds += threads * seconds;
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
    // A delayed launch waking up: the RAM stays claimed, the clock starts now.
    if (ev.kind === "start") {
      this.begin(ev);
      return;
    }
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
    this.stats.ramSpend += cost;
    this.home.maxRam *= 2;
    this.stats.ramUpgrades++;
    return true;
  }

  /** How many ports the programs owned right now can open. */
  get portsOpenable() {
    let n = 0;
    for (const p of PORT_PROGRAMS) {
      if (!this.programs.has(p.name)) break;
      n++;
    }
    return n;
  }

  /**
   * Buy the TOR router and then port openers in price order, while they are
   * affordable and `keep` dollars would remain. Returns dollars spent.
   *
   * Programs can also be *written* in game (hacking 50 for BruteSSH and so on)
   * but writing consumes wall-clock time the player could spend hacking, and
   * money arrives fast enough here that buying always wins — so only the
   * purchase path is modelled.
   */
  buyPortPrograms({ keep = 0 } = {}) {
    let spent = 0;
    if (!this.hasTor) {
      if (this.player.money - TOR_COST < keep) return spent;
      this.player.money -= TOR_COST;
      spent += TOR_COST;
      this.hasTor = true;
    }
    for (const p of PORT_PROGRAMS) {
      if (this.programs.has(p.name)) continue;
      if (this.player.money - p.price < keep) break;
      this.player.money -= p.price;
      spent += p.price;
      this.programs.add(p.name);
    }
    this.stats.programSpend += spent;
    return spent;
  }

  /** Root everything now in reach given hacking level and owned port openers. */
  nuke() {
    const ports = this.portsOpenable;
    let rooted = 0;
    for (const s of this.servers.values()) {
      if (s.hasAdminRights || s.numOpenPortsRequired > ports) continue;
      if (s.requiredHackingSkill <= this.hacking) {
        s.hasAdminRights = true;
        rooted++;
      }
    }
    return rooted;
  }

  cloudServerCost(ram) {
    return getCloudServerCost(ram);
  }

  /** Largest power-of-two cloud server affordable while keeping `keep` dollars. */
  bestAffordableServer({ keep = 0, maxRam = Infinity } = {}) {
    const cap = Math.min(getCloudServerMaxRam(), maxRam);
    let best = 0;
    for (let ram = 2; ram <= cap; ram *= 2) {
      if (getCloudServerCost(ram) <= this.player.money - keep) best = ram;
      else break;
    }
    return best;
  }

  /** ns.purchaseServer. Adds a rooted host with the given RAM. */
  buyServer(ram) {
    if (this.purchased.length >= getCloudServerLimit()) return null;
    const cost = getCloudServerCost(ram);
    if (!isFinite(cost) || this.player.money < cost) return null;
    this.player.money -= cost;
    this.stats.ramSpend += cost;
    this.stats.serversBought++;
    const hostname = `pserv-${this.purchased.length}`;
    const s = {
      hostname,
      maxRam: ram,
      usedRam: 0,
      moneyAvailable: 0,
      moneyMax: 0,
      hackDifficulty: 1,
      minDifficulty: 1,
      baseDifficulty: 1,
      requiredHackingSkill: 1,
      serverGrowth: 0,
      numOpenPortsRequired: 0,
      hasAdminRights: true,
      purchasedByPlayer: true,
      cpuCores: 1,
    };
    this.servers.set(hostname, s);
    this.purchased.push(hostname);
    return hostname;
  }

  /**
   * ns.upgradePurchasedServer: pay the difference to double a cloud server.
   * In game the server must be emptied first; here the running ops are simply
   * left alone, which only matters for one batch.
   */
  upgradeServer(hostname, ram) {
    const s = this.servers.get(hostname);
    if (!s?.purchasedByPlayer || ram <= s.maxRam) return false;
    const cost = getCloudServerCost(ram) - getCloudServerCost(s.maxRam);
    if (!isFinite(cost) || this.player.money < cost) return false;
    this.player.money -= cost;
    this.stats.ramSpend += cost;
    s.maxRam = ram;
    return true;
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
        // Money *earned* so far, which unlike cash-in-hand is not reduced by
        // reinvestment — the only fair way to score a strategy that spends.
        earned: Math.round(this.stats.moneyStolen),
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
      const advance = (to) => {
        const dt = to - this.t;
        if (dt > 0) {
          let used = 0;
          let cap = 0;
          for (const s of this.hosts()) (used += s.usedRam), (cap += s.maxRam);
          this.stats.ramGbMs += used * dt;
          this.stats.capacityGbMs += cap * dt;
        }
        this.t = to;
      };
      if (!next || next.at > nextStop) {
        advance(nextStop);
        continue;
      }
      this.events.shift();
      advance(next.at);
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
      totalRam: this.totalRam(),
      util: this.stats.capacityGbMs ? this.stats.ramGbMs / this.stats.capacityGbMs : 0,
      ...this.stats,
      moneyStolen: Math.round(this.stats.moneyStolen),
      ramSpend: Math.round(this.stats.ramSpend),
      curve,
    };
  }
}
