#!/usr/bin/env node
// Debug harness for the batcher: runs one configuration and dumps the internal
// state machine counters, which the summary table cannot show.
//
//   node tools/sim/probe-batch.mjs --gb 3072 --minutes 20 --opts '{"spill":"none"}'
//
// NOT CALIBRATED. This is a debugger, not a model: it exists to show which
// internal counter is moving, and nothing it prints has been checked against
// the live game. Counters (placement failures, drains, unsafe skips) are worth
// reading; the dollar and rate columns are not evidence for anything. If you
// want a number to act on, use target-count.mjs or verify-alloc-shipped.mjs,
// both of which assert against .telemetry/batch.txt first.

import { Sim } from "./engine.mjs";
import { atTotalRam, shippedLoop } from "./strategies.mjs";
import { hwgwBatcher, batchPlan } from "./batcher.mjs";
import { freshStart, loadSnapshot } from "./world.mjs";
import { calculateHackingTime, calculateWeakenTime } from "./game.mjs";

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i > -1 ? argv[i + 1] : d;
};
const gb = Number(flag("gb", 3072));
const minutes = Number(flag("minutes", 20));
const seed = Number(flag("seed", 1));
const opts = JSON.parse(flag("opts", "{}"));
const world = argv.includes("--fresh") ? freshStart(loadSnapshot()) : loadSnapshot();

const fmt = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}b` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}m` : `$${(n / 1e3).toFixed(1)}k`);

if (argv.includes("--loop")) {
  const s = new Sim(world, { seed, scriptRam: { hack: 2.4, grow: 2.4, weaken: 2.4 } });
  const r = s.run(atTotalRam(shippedLoop(), gb), minutes * 60_000);
  console.log(`threshold loop @${r.totalRam}GB  earned ${fmt(r.moneyStolen)}  hacks ${r.hacks}/${r.hacks + r.hackFails}  util ${(r.util * 100).toFixed(0)}%`);
  process.exit(0);
}

const strat = hwgwBatcher(opts);
const sim = new Sim(world, { seed });
const res = sim.run(atTotalRam(strat, gb), minutes * 60_000);

console.log(`${strat.name} @ ${res.totalRam}GB, ${minutes}min, seed ${seed}`);
console.log(`  earned ${fmt(res.moneyStolen)}  hacks ${res.hacks} ok / ${res.hackFails} failed  grows ${res.grows}  weakens ${res.weakens}`);
console.log(`  util ${(res.util * 100).toFixed(1)}%  hacking ${res.hacking}`);
for (const [name, s] of strat._state) {
  const t = sim.servers.get(name);
  console.log(
    `  ${name.padEnd(18)} phase=${s.phase.padEnd(5)} batches=${String(s.batches).padStart(6)} unsafe=${String(s.skipsUnsafe).padStart(6)} drains=${String(s.drains).padStart(4)} placeFails=${String(s.placeFails).padStart(6)} prepWaves=${String(s.prepWaves).padStart(3)} batchingFrom=${((s.batchingSince ?? 0) / 60000).toFixed(1)}m` +
      `  money=${((t.moneyAvailable / t.moneyMax) * 100).toFixed(1)}%  sec=${t.hackDifficulty.toFixed(2)}/${t.minDifficulty}`,
  );
}
console.log(`  targets: ${strat._targets.join(", ")}`);
for (const name of strat._targets) {
  const t = sim.servers.get(name);
  const p = batchPlan(sim, t, { hackThreads: opts.hackThreads ?? "auto", maxRam: sim.totalRam() / ((opts.nTargets ?? 1) * (opts.minInFlight ?? 4)) });
  if (!p) continue;
  const inFlight = Math.floor(sim.totalRam() / (opts.nTargets ?? 1) / p.ram);
  console.log(
    `    plan h=${p.h} g=${p.g} w1=${p.w1} w2=${p.w2}  f=${(p.f * 100).toFixed(2)}%  ram=${p.ram.toFixed(1)}GB  ` +
      `T=${(p.hackTime / 1000).toFixed(1)}s wT=${(p.weakenTime / 1000).toFixed(1)}s  per-batch ${fmt(p.money)}  inflight<=${inFlight}  ` +
      `period=${(Math.max(4 * (opts.spacing ?? 200), p.weakenTime / Math.max(1, inFlight)) / 1000).toFixed(2)}s  ` +
      `ceiling=${fmt((p.money * Math.max(1, inFlight)) / (p.weakenTime / 1000))}/s`,
  );
}
