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
    runs.push(new Sim(world, { seed }).run(make(), minutes * 60_000));
  }
  results.push({
    name,
    label: runs[0].strategy,
    money: median(runs.map((r) => r.money)),
    moneyMin: Math.min(...runs.map((r) => r.money)),
    moneyMax: Math.max(...runs.map((r) => r.money)),
    hacking: median(runs.map((r) => r.hacking)),
    exp: median(runs.map((r) => r.exp)),
    hacks: median(runs.map((r) => r.hacks)),
    hackFails: median(runs.map((r) => r.hackFails)),
    grows: median(runs.map((r) => r.grows)),
    weakens: median(runs.map((r) => r.weakens)),
    rooted: median(runs.map((r) => r.rooted)),
    curve: runs[0].curve,
  });
}

results.sort((a, b) => b.money - a.money);

if (has("json")) {
  console.log(JSON.stringify({ minutes, seeds, results }, null, 2));
  process.exit(0);
}

console.log(`\n${minutes} minutes from a fresh BN1 start, median of ${seeds} seeds\n`);
console.log("  " + "strategy".padEnd(34) + "money".padStart(10) + "hack".padStart(6) + "exp".padStart(9) + "  hacks   range");
console.log("  " + "-".repeat(86));
for (const r of results) {
  console.log(
    "  " +
      r.label.slice(0, 33).padEnd(34) +
      fmtMoney(r.money).padStart(10) +
      String(r.hacking).padStart(6) +
      String(r.exp).padStart(9) +
      `   ${r.hacks}/${r.hacks + r.hackFails}`.padEnd(9) +
      `${fmtMoney(r.moneyMin)}–${fmtMoney(r.moneyMax)}`,
  );
}
console.log();

const best = results[0];
console.log(`best: ${best.label} — ${fmtMoney(best.money)}, hacking ${best.hacking}`);
console.log(`curve: ${best.curve.map((p) => `${p.minute}m ${fmtMoney(p.money)}/lvl${p.hacking}`).join("  ")}`);
process.exit(0);
