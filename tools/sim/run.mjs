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
//
// CALIBRATION — what this harness's numbers are and are not worth.
//
// The simulator's only check against recorded reality is
// `tools/sim/fidelity/backtest.mjs`, which replays two windows from
// `.telemetry/history.jsonl`. Those windows are at 220GB and 2.4TB, hacking
// level 89-188, and the sim over-predicts earnings on them substantially (the
// flat window earned $0 in the real game and $6.01m in the sim). The live fleet
// is now 30PB at level 2900+, three orders of magnitude outside anything ever
// backtested.
//
// So: the RANKING this harness produces is the product, and the dollar totals
// are not. Do not quote an absolute $/s from here, and do not compare one to a
// live figure — for a live-calibrated income number use target-count.mjs, whose
// CHECK block asserts against .telemetry/batch.txt and prints the error.

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
  // Rate over the SECOND HALF of the run.
  //
  // This was the closing *tenth*, and that is not a rate — it is a measurement
  // of where the window edge happens to fall relative to one prep-and-drain
  // cycle. Income from a threshold loop is a step function with a cycle of tens
  // of minutes at TB scale, so a short tail window reports $0 for a strategy
  // that banked billions, which it did for three arms in section 14. Half the
  // run is longer than any cycle observed and averages over the steps.
  const tailRate = (r) => {
    const c = r.curve;
    if (c.length < 4) return 0;
    const from = c[Math.floor(c.length / 2)];
    const to = c[c.length - 1];
    const dt = (to.minute - from.minute) * 60;
    return dt > 0 ? (to.earned - from.earned) / dt : 0;
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

console.log(`\n${minutes} minutes from ${has("live") ? "the live save" : "a fresh BN1 start"}, median of ${seeds} seeds\n`);
// A window shorter than one prep-and-drain cycle measures window alignment, not
// rate, and at TB scale that cycle is tens of minutes. See docs/fidelity-log.md
// section 10: at 1TB a 60-minute window ranked two arms one way and 180 minutes
// ranked them the other.
if (minutes < 180) console.log(`  WARNING: ${minutes}-minute window. Use >=180 minutes above ~1TB — shorter windows measure window alignment, not rate.\n`);
console.log(
  "  " +
    "strategy".padEnd(34) +
    "earned".padStart(10) +
    "cash".padStart(10) +
    "$/s 2nd half".padStart(13) +
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
      fmtMoney(r.rate).padStart(13) +
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
