#!/usr/bin/env node
// Backtest: replay a window of the recorded past and see whether the simulator
// reproduces it.
//
//   node tools/sim/fidelity/backtest.mjs                 both windows, all variants
//   node tools/sim/fidelity/backtest.mjs --window flat   just the 2h15m plateau
//   node tools/sim/fidelity/backtest.mjs --seeds 9 --json
//
// A simulator that cannot reproduce the recorded past should not be trusted
// about the future. The windows are chosen because their outcome is
// unambiguous: in the first, real money moved by exactly $0 over 135 minutes;
// in the second it moved by $450m in 55 seconds after 18 minutes of nothing.
//
// What the harness can and cannot pin down, stated up front:
//
//  * `.telemetry/history.jsonl` is derived from the save, and the save does
//    **not** record per-server money or security. So the world at a window's
//    start is reconstructed, not restored. The reconstruction fixes everything
//    the save *does* hold — player money, exp, level, home RAM, purchased
//    servers, rooted count, owned programs — and puts the network at a stated
//    starting condition. Sensitivity to that condition is reported.
//  * The *money* observable is therefore the strong one: $0 earned is $0
//    earned whatever the servers started at. The level curve is the second
//    observable and is nearly independent of it, since exp is paid per thread
//    per op regardless of outcome.

import { Sim } from "../engine.mjs";
import { loadSnapshot } from "../world.mjs";
import { autoJs, autoJsEv } from "./supervisor.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const HISTORY = path.join(ROOT, ".telemetry/history.jsonl");

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i > -1 ? (argv[i + 1]?.startsWith("--") ? true : argv[i + 1]) : d;
};
const has = (n) => argv.includes(`--${n}`);

// ---------------------------------------------------------------------------
// The windows, read straight out of telemetry.
// ---------------------------------------------------------------------------

export const WINDOWS = {
  /**
   * 20:19:32 -> 22:35:10. Money frozen at $487,820 for 2h15m while the hacking
   * level went 89 -> 172 and RAM ran flat out. The $500k that disappeared at
   * 20:19 was BruteSSH.exe, which took the rooted count 9 -> 13 and put four
   * new, higher-requirement servers into the ranking — which is the event that
   * started the churn.
   */
  flat: {
    label: "20:19 -> 22:35, money flat at $487,820",
    from: "2026-09-11T20:20:30Z",
    to: "2026-09-11T22:35:10Z",
    netState: "fresh",
    // BruteSSH had just been bought ($500k, which is the money that vanished);
    // FTPCrack came later. history.jsonl does not carry the program list, so
    // this is inferred from the rooted count jumping 9 -> 13 at 20:20 and from
    // the $500k debit matching DarkWebItems.BruteSSHProgram.price exactly.
    programs: ["NUKE.exe", "BruteSSH.exe"],
    expectRooted: 13,
    // What was actually deployed during this window. File mtimes are local and
    // the telemetry clock is UTC; .telemetry/auto.txt is stamped 19:31 local /
    // 23:31:55Z, so local = UTC-4 and every mtime converts that way.
    //   auto.js  mtime 19:17 local = 23:17Z -> throughout this window auto.js
    //            was still ranking by M*phi/T and had no switch guard at all.
    //   early.js mtime 16:30 local = 20:30Z -> MONEY_FLOOR became 0.5 ten
    //            minutes into the window; it was 0.75 before.
    asRun: { index: "live", naive: true, moneyFloor: 0.5 },
  },
  /**
   * The same window extended by 20 seconds, so that the burst which *ended*
   * the plateau falls inside it. At 22:34:40 money was still $487,820; at
   * 22:35:10 it was $4,792,415 — one payout of $4,304,595 after 135 minutes of
   * nothing, then $4.09m more at 22:40, $2.25m at 22:45, $4.44m at 22:47.
   * Once prep completes, this fleet harvests roughly $4m every five minutes.
   *
   * Reporting both boundaries is the honest way to score a step function: the
   * strict plateau says "the sim must earn ~nothing", the extended window says
   * "and then it must earn about $4m", and a sim that gets one right by being
   * dead gets the other wrong.
   */
  burst: {
    label: "20:19 -> 22:35:20, the plateau plus the burst that ended it",
    from: "2026-09-11T20:20:30Z",
    to: "2026-09-11T22:35:20Z",
    netState: "fresh",
    programs: ["NUKE.exe", "BruteSSH.exe"],
    expectRooted: 13,
    asRun: { index: "live", naive: true, moneyFloor: 0.5 },
  },
  /**
   * 23:03:11 -> 23:22:36. Same freeze at 20x the RAM: $2,305,577 held for 18
   * minutes across 2032GB of purchased servers, then $450m in 55 seconds when
   * the prep finally completed and every thread hacked at once.
   */
  payout: {
    label: "23:03 -> 23:22, $2.3m held then $450m in 55s",
    from: "2026-09-11T23:03:30Z",
    to: "2026-09-11T23:22:36Z",
    // snapshot.json was captured 22:58:08, five minutes before this window
    // opens, so its per-server money and security are very nearly the truth
    // here. This is the one window with a real, not reconstructed, world.
    netState: "snapshot",
    programs: ["NUKE.exe", "BruteSSH.exe", "FTPCrack.exe"],
    expectRooted: 23,
    // This window straddles the auto.js rewrite at 23:17Z: the first 14
    // minutes ran the old index with no guard, the last 5 the new one. Neither
    // variant is exactly right, so both are reported.
    asRun: { index: "live", naive: true, moneyFloor: 0.5 },
  },
  /**
   * The control. 18:47 -> 20:18, before BruteSSH: one reachable target worth
   * having (harakiri-sushi), no retargets available, and money climbed
   * smoothly from $1,262 to $2,197,564. If the sim's new kill mechanism is
   * over-applied it will break this window too, so it has to be run.
   */
  earning: {
    label: "18:47 -> 20:18, money climbing steadily (control)",
    from: "2026-09-11T18:47:30Z",
    to: "2026-09-11T20:18:04Z",
    netState: "fresh",
    programs: ["NUKE.exe"],
    expectRooted: 7,
    // Before the 20:30Z early.js edit, so MONEY_FLOOR was 0.75.
    asRun: { index: "live", naive: true, moneyFloor: 0.75 },
  },
};

export function loadHistory(file = HISTORY) {
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .map((r) => ({ ...r, ts: Date.parse(r.at) }));
}

/** The recorded sample at or just before `iso`. */
export function sampleAt(history, iso) {
  const t = Date.parse(iso);
  let best = null;
  for (const r of history) {
    if (r.ts <= t) best = r;
    else break;
  }
  return best ?? history[0];
}

/** What really happened across the window: the thing to be reproduced. */
export function actual(history, win) {
  const a = sampleAt(history, win.from);
  const b = sampleAt(history, win.to);
  // Money spent inside the window (RAM, programs) is invisible in `money`, so
  // "earned" is bounded below by the delta. For the flat window the delta is
  // exactly zero and no purchases happened, so it is exact there.
  const spend = purchasesBetween(history, a, b);
  return {
    from: a.at,
    to: b.at,
    minutes: (b.ts - a.ts) / 60000,
    moneyStart: a.money,
    moneyEnd: b.money,
    moneyDelta: b.money - a.money,
    earnedLowerBound: b.money - a.money + spend.total,
    spend,
    levelStart: a.skills.hacking,
    levelEnd: b.skills.hacking,
    levelGain: b.skills.hacking - a.skills.hacking,
    ramStart: fleetRamOf(a),
    ramEnd: fleetRamOf(b),
  };
}

function fleetRamOf(sample) {
  return sample.home.ram + (sample.purchasedServers ?? []).reduce((s, p) => s + p.ram, 0);
}

/**
 * Money that left the wallet inside the window for things the save records:
 * home RAM doublings and purchased servers. Program purchases are not
 * recoverable from history.jsonl (the program list lives on the home server
 * record, which history does not carry) so they are reported as unknown.
 */
function purchasesBetween(history, a, b) {
  const inWindow = history.filter((r) => r.ts >= a.ts && r.ts <= b.ts);
  let pserv = 0;
  const seen = new Map();
  for (const r of inWindow) for (const p of r.purchasedServers ?? []) {
    const prev = seen.get(p.hostname) ?? 0;
    if (p.ram > prev) {
      pserv += cloudCost(p.ram) - (prev ? cloudCost(prev) : 0);
      seen.set(p.hostname, p.ram);
    }
  }
  let homeRam = 0;
  for (let i = 1; i < inWindow.length; i++) {
    if (inWindow[i].home.ram > inWindow[i - 1].home.ram) homeRam += homeUpgradeCost(inWindow[i - 1].home.ram);
  }
  return { pserv, homeRam, total: pserv + homeRam };
}

// src/Server/ServerPurchases.ts: 55000 * ram * BaseCostFor1GBOfRamServer mult (1 in BN1)
const cloudCost = (ram) => 55000 * ram;
// src/Server/ServerPurchases.ts getUpgradeHomeRamCost, BN1 multiplier 1.
const homeUpgradeCost = (currentRam) => {
  const numUpgrades = Math.round(Math.log2(currentRam / 8));
  return 3.2e3 * Math.pow(1.58, Math.log2(currentRam)) * Math.pow(1.1, numUpgrades) * currentRam;
};

// ---------------------------------------------------------------------------
// World reconstruction.
// ---------------------------------------------------------------------------

/**
 * Build a sim world for the state recorded at `sample`.
 *
 * `netState` picks the unrecoverable part — where the network's money and
 * security were when the window opened:
 *
 *   "fresh"    the game's own untouched state: moneyAvailable = moneyMax/25 and
 *              hackDifficulty = baseDifficulty ~ 3 * minDifficulty. **[src]**
 *              src/Server/Server.ts:75-83 —
 *                  moneyAvailable = baseMoney
 *                  moneyMax       = 25 * baseMoney
 *                  minDifficulty  = round(baseDifficulty / 3)
 *              and 58 of the 63 money servers in tools/sim/snapshot.json sit at
 *              exactly 4.00% of moneyMax, confirming it empirically. **[tel]**
 *              This is the right default for any server the fleet has not yet
 *              touched, which after a retarget is every new target.
 *   "snapshot" whatever tools/sim/snapshot.json captured (captured 22:58, so
 *              it is the *real* state for the payout window and useless for the
 *              earlier ones)
 *   "max"      every server full and at base difficulty
 *   "prepped"  money full, security at minimum — the best a prep could reach
 *   "min"      every server empty and at base difficulty
 */
export function worldAt(snapshot, sample, { netState = "fresh", programs = null } = {}) {
  const world = structuredClone(snapshot);

  world.player = {
    money: sample.money,
    // history.jsonl does not carry exp, only the level. Invert calculateSkill's
    // floor(32*ln(exp+534.6) - 200) to the *lowest* exp giving that level, which
    // is the right choice: it makes the sim's first level-up no earlier than
    // the real one could have been.
    hackExp: expForLevel(sample.skills.hacking),
    hacking: sample.skills.hacking,
    homeRam: sample.home.ram,
    homeCores: sample.home.cores,
    programs: programs ?? snapshot.player.programs,
    hasTor: true,
  };

  const byName = new Map(world.servers.map((s) => [s.hostname, s]));
  const home = byName.get("home");
  home.maxRam = sample.home.ram;
  home.cpuCores = sample.home.cores;
  home.hasAdminRights = true;

  // Drop the snapshot's purchased servers and re-create the ones this sample
  // actually had.
  world.servers = world.servers.filter((s) => !s.purchasedByPlayer || s.hostname === "home");
  for (const p of sample.purchasedServers ?? []) {
    world.servers.push({
      hostname: p.hostname,
      maxRam: p.ram,
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
    });
  }

  for (const s of world.servers) {
    if (s.hostname === "home" || s.purchasedByPlayer) continue;
    s.hasAdminRights = false; // sim.nuke() re-derives it from level + programs
    if (netState === "fresh") {
      s.moneyAvailable = s.moneyMax / 25;
      s.hackDifficulty = s.baseDifficulty ?? s.hackDifficulty;
    } else if (netState === "max") {
      s.moneyAvailable = s.moneyMax;
      s.hackDifficulty = s.baseDifficulty ?? s.hackDifficulty;
    } else if (netState === "min") {
      s.moneyAvailable = 0;
      s.hackDifficulty = s.baseDifficulty ?? s.hackDifficulty;
    } else if (netState === "prepped") {
      s.moneyAvailable = s.moneyMax;
      s.hackDifficulty = s.minDifficulty;
    }
    // "snapshot": leave the captured moneyAvailable / hackDifficulty alone.
  }
  return world;
}

/** Lowest exp that yields `level` under calculateSkill. */
export function expForLevel(level) {
  // calculateSkill = floor(32 * ln(exp + 534.6) - 200), clamped at >= 1.
  if (level <= 1) return 0;
  return Math.max(0, Math.exp((level + 200) / 32) - 534.6);
}

// ---------------------------------------------------------------------------
// Running a window.
// ---------------------------------------------------------------------------

export function runWindow(snapshot, history, win, makeStrategy, { seeds = 5, netState = null } = {}) {
  netState = netState ?? win.netState ?? "fresh";
  const a = sampleAt(history, win.from);
  const b = sampleAt(history, win.to);
  const ms = b.ts - a.ts;

  const runs = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const world = worldAt(snapshot, a, { netState, programs: win.programs });
    const sim = new Sim(world, { seed });
    // Root what the level and programs allow, so the reconstruction's rooted
    // count can be checked against the one the save recorded.
    sim.nuke();
    const rootedAtStart = [...sim.servers.values()].filter((s) => s.hasAdminRights).length;
    const fleetRamAtStart = sim.totalRam();
    const strategy = makeStrategy();
    const out = sim.run(strategy, ms, { pollMs: 1000, sampleMs: 300_000 });
    runs.push({
      rootedAtStart,
      fleetRamAtStart,
      earned: out.moneyStolen,
      money: out.money,
      level: out.hacking,
      levelGain: out.hacking - a.skills.hacking,
      retargets: strategy.retargets ?? 0,
      killedOps: out.killedOps,
      killedThreadSeconds: out.killedThreadSeconds,
      killedMoneyForgone: out.killedMoneyForgone,
      execFails: out.execFails,
      threadSeconds: out.threadSeconds,
      hacks: out.hacks,
      grows: out.grows,
      weakens: out.weakens,
      util: out.util,
      history: strategy.history ?? [],
      timeline: strategy.timeline ?? [],
      curve: out.curve,
    });
  }
  return runs;
}

const median = (xs) => {
  const s = [...xs].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const fmt = (n) =>
  Math.abs(n) >= 1e9
    ? `$${(n / 1e9).toFixed(2)}b`
    : Math.abs(n) >= 1e6
      ? `$${(n / 1e6).toFixed(2)}m`
      : Math.abs(n) >= 1e3
        ? `$${(n / 1e3).toFixed(1)}k`
        : `$${Math.round(n)}`;

// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const seeds = Number(flag("seeds", 5));
  const only = flag("window");
  const snapshot = loadSnapshot();
  const history = loadHistory();

  const variantsFor = (win) => {
    const asRun = win.asRun ?? {};
    return [
      {
        key: "old-sim",
        label: "as-run script, kills NOT modelled (old sim)",
        make: () => autoJs({ ...asRun, modelKills: false }),
      },
      { key: "as-run", label: "as-run script, kills modelled", make: () => autoJs({ ...asRun }) },
      { key: "shipped", label: "shipped auto.js (batch index + guard)", make: () => autoJs({}) },
      { key: "ev", label: "shipped auto.js, EV retarget (H=30m)", make: () => autoJsEv({}) },
    ];
  };

  const out = [];
  for (const [key, win] of Object.entries(WINDOWS)) {
    if (only && key !== only) continue;
    const act = actual(history, win);
    console.log(`\n=== ${key}: ${win.label} ===`);
    {
      const probe = runWindow(snapshot, history, { ...win, to: win.from }, () => autoJs({}), { seeds: 1 });
      console.log(
        `  reconstruction: rooted ${probe[0].rootedAtStart} (save recorded ${sampleAt(history, win.from).servers.rooted}` +
          `${win.expectRooted ? `, expected ${win.expectRooted}` : ""}), fleet ${probe[0].fleetRamAtStart}GB`,
      );
    }
    console.log(
      `  actual: ${act.minutes.toFixed(0)}m, money ${fmt(act.moneyStart)} -> ${fmt(act.moneyEnd)} ` +
        `(delta ${fmt(act.moneyDelta)}, spend ${fmt(act.spend.total)}, earned >= ${fmt(act.earnedLowerBound)}), ` +
        `level ${act.levelStart} -> ${act.levelEnd} (+${act.levelGain}), fleet ${act.ramStart}GB -> ${act.ramEnd}GB`,
    );
    console.log(
      "  " +
        "variant".padEnd(42) +
        "earned".padStart(10) +
        "err".padStart(10) +
        "lvl+".padStart(6) +
        "err".padStart(6) +
        "retgt".padStart(7) +
        "killed".padStart(8) +
        "util".padStart(7),
    );
    for (const v of variantsFor(win)) {
      const runs = runWindow(snapshot, history, win, v.make, { seeds, netState: flag("net", null) });
      const earned = median(runs.map((r) => r.earned));
      const lvl = median(runs.map((r) => r.levelGain));
      const row = {
        window: key,
        variant: v.key,
        earned,
        earnedError: earned - act.earnedLowerBound,
        levelGain: lvl,
        levelError: lvl - act.levelGain,
        retargets: median(runs.map((r) => r.retargets)),
        killedOps: median(runs.map((r) => r.killedOps)),
        killedThreadSeconds: median(runs.map((r) => r.killedThreadSeconds)),
        util: median(runs.map((r) => r.util)),
        actual: act,
        sampleHistory: runs[0].history.slice(0, 40),
        timeline: runs[0].timeline,
      };
      out.push(row);
      console.log(
        "  " +
          v.label.padEnd(42) +
          fmt(earned).padStart(10) +
          fmt(row.earnedError).padStart(10) +
          String(lvl).padStart(6) +
          String(row.levelError).padStart(6) +
          String(row.retargets).padStart(7) +
          String(row.killedOps).padStart(8) +
          `${(row.util * 100).toFixed(0)}%`.padStart(7),
      );
      if (has("trace")) {
        const step = Math.max(1, Math.floor(row.timeline.length / 30));
        for (let i = 0; i < row.timeline.length; i += step) {
          const p = row.timeline[i];
          console.log(
            `      ${(p.t / 60000).toFixed(1).padStart(6)}m  ${String(p.target).padEnd(18)}` +
              ` money ${(p.moneyFrac * 100).toFixed(1).padStart(6)}%  sec ${p.sec.toFixed(1).padStart(6)}/${p.minSec}` +
              `  lvl ${String(p.level).padStart(4)}  earned ${fmt(p.earned).padStart(9)}  killed ${p.killed}`,
          );
        }
      }
    }
  }

  if (has("json")) console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}
