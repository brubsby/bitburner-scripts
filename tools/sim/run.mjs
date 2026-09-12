#!/usr/bin/env node
// Compare bootstrap strategies.
//
//   node tools/sim/run.mjs --snapshot            capture the live game's world
//   node tools/sim/run.mjs                       run every registered strategy
//   node tools/sim/run.mjs --only early-n00dles,prepped-n00dles
//   node tools/sim/run.mjs --minutes 120 --seeds 10
//   node tools/sim/run.mjs --json                machine-readable output
//
// Hacking succeeds probabilistically, so each strategy is run over several
// seeds and reported by median — a single run says very little.

import { Sim } from "./engine.mjs";
import { REGISTRY } from "./strategies.mjs";
import { fetchSnapshot, freshStart, loadSnapshot, saveSnapshot } from "./world.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? (argv[i + 1]?.startsWith("--") ? true : argv[i + 1]) : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const fmtMoney = (n) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(2)}b` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}m` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${Math.round(n)}`;

if (has("snapshot")) {
  const snap = await fetchSnapshot(Number(flag("port", 12526)));
  const file = saveSnapshot(snap);
  console.log(`captured ${snap.servers.length} servers from the live game (BN${snap.bitNode}) -> ${file}`);
  process.exit(0);
}

const minutes = Number(flag("minutes", 60));
const seeds = Number(flag("seeds", 5));
const only = flag("only");
const homeReserve = Number(flag("reserve", 0));
// The sim defaults to the dedicated workers h.js/g.js/w.js, which cost
// 1.7/1.75/1.75GB per thread. auto.js currently deploys early.js instead,
// which self-decides and so costs 2.4GB per thread for every op. --workerram
// prices that difference.
const workerRam = flag("workerram", null);
const scriptRam = workerRam
  ? { hack: Number(workerRam), grow: Number(workerRam), weaken: Number(workerRam) }
  : undefined;
const names = only ? String(only).split(",").map((s) => s.trim()) : Object.keys(REGISTRY);

const snapshot = loadSnapshot();
const world = has("live") ? snapshot : freshStart(snapshot);

const results = [];
for (const name of names) {
  const make = REGISTRY[name];
  if (!make) {
    console.error(`unknown strategy: ${name}\nknown: ${Object.keys(REGISTRY).join(", ")}`);
    process.exit(1);
  }
  const runs = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const strategy = make();
    // A strategy may declare what its workers cost, so a run can compare
    // early.js (2.4GB/thread, self-deciding) against dispatched h/g/w.js
    // (1.7/1.75GB) in one table. An explicit --workerram still wins.
    const ram = scriptRam ?? strategy.scriptRam ?? undefined;
    runs.push(new Sim(world, { seed, homeReserve, ...(ram ? { scriptRam: ram } : {}) }).run(strategy, minutes * 60_000));
  }
  // Income over the closing tenth of the run: where a strategy has *got to*,
  // as opposed to what it banked on the way. A strategy that spends everything
  // on RAM looks poor by cash-in-hand and rich by this.
  const tailRate = (r) => {
    const c = r.curve;
    const from = c[Math.max(0, c.length - 1 - Math.ceil(c.length / 10))];
    const to = c[c.length - 1];
    return (to.earned - from.earned) / ((to.minute - from.minute) * 60);
  };

  results.push({
    name,
    label: runs[0].strategy,
    money: median(runs.map((r) => r.money)),
    earned: median(runs.map((r) => r.moneyStolen)),
    netWorth: median(runs.map((r) => r.money + r.ramSpend + r.programSpend)),
    rate: median(runs.map(tailRate)),
    util: median(runs.map((r) => r.util)),
    moneyMin: Math.min(...runs.map((r) => r.money)),
    moneyMax: Math.max(...runs.map((r) => r.money)),
    hacking: median(runs.map((r) => r.hacking)),
    exp: median(runs.map((r) => r.exp)),
    hacks: median(runs.map((r) => r.hacks)),
    hackFails: median(runs.map((r) => r.hackFails)),
    grows: median(runs.map((r) => r.grows)),
    weakens: median(runs.map((r) => r.weakens)),
    rooted: median(runs.map((r) => r.rooted)),
    totalRam: median(runs.map((r) => r.totalRam)),
    homeRam: median(runs.map((r) => r.homeRam)),
    ramSpend: median(runs.map((r) => r.ramSpend)),
    curve: runs[0].curve,
  });
}

const sortKey = flag("sort", "earned");
results.sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));

if (has("json")) {
  console.log(JSON.stringify({ minutes, seeds, results }, null, 2));
  process.exit(0);
}

console.log(`\n${minutes} minutes from a fresh BN1 start, median of ${seeds} seeds\n`);
console.log(
  "  " +
    "strategy".padEnd(34) +
    "earned".padStart(10) +
    "cash".padStart(10) +
    "$/s end".padStart(10) +
    "hack".padStart(6) +
    "ram".padStart(8) +
    "util".padStart(7) +
    "  spent".padStart(10),
);
console.log("  " + "-".repeat(90));
for (const r of results) {
  console.log(
    "  " +
      r.label.slice(0, 33).padEnd(34) +
      fmtMoney(r.earned).padStart(10) +
      fmtMoney(r.money).padStart(10) +
      fmtMoney(r.rate).padStart(10) +
      String(r.hacking).padStart(6) +
      String(r.totalRam).padStart(8) +
      `${(r.util * 100).toFixed(0)}%`.padStart(7) +
      fmtMoney(r.ramSpend).padStart(10),
  );
}
console.log();

const best = results[0];
console.log(`best by ${sortKey}: ${best.label} — earned ${fmtMoney(best.earned)}, hacking ${best.hacking}`);
console.log(`curve: ${best.curve.map((p) => `${p.minute}m ${fmtMoney(p.earned)}/lvl${p.hacking}/${p.ram}GB`).join("  ")}`);
process.exit(0);
