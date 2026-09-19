// READ-ONLY. Runs batch.js's OWN shipped target-count argmax (batch.js:1265-1286)
// against the LIVE world, at the LIVE fleet size, with the LIVE calibration y.
//
// Why this exists rather than `node tools/sim/target-count.mjs`: that tool calls
// loadSnapshot() with no argument (target-count.mjs:39), which is
// tools/sim/snapshot.json — a BitNode-1 world captured 2026-09-11 with a 448TB
// fleet and hacking level 295. Its default --fleets are the same three dead
// numbers. Nothing about it describes the world we are in.
//
// CALIBRATION: prints the modelled $/s at the live n and the live target set
// against batch.txt's measured earnedPerSec, with the error, before any table.

import "../../../sim/env.mjs";
import { calculateHackingTime, calculateHackingChance, calculatePercentMoneyHacked, calculateServerGrowthLog, configuredBitNode, currentNodeMults } from "../../../sim/game.mjs";
import { fetchSnapshot } from "../../../sim/world.mjs";
import { measuredBatch } from "../../../sim/calibrate.mjs";

// NOT `await import("../../../../batch.js")` — batch.js:71 imports the bare
// specifier 'status.js', which node cannot resolve. That is exactly why
// rootimport.mjs exists, and exactly why tools/sim/verify-argmax.mjs:21 and
// tools/sim/verify-alloc.mjs:48 are both dead right now.
import { importRootScript } from "../../../sim/rootimport.mjs";
const b = await importRootScript("batch.js");

console.log(`physics: BitNode ${configuredBitNode}  ScriptHackMoney=${currentNodeMults.ScriptHackMoney} HackingSpeedMultiplier=${currentNodeMults.HackingSpeedMultiplier} ServerMaxMoney=${currentNodeMults.ServerMaxMoney}`);

const w = await fetchSnapshot();
const bt = measuredBatch();
const level = w.player.hacking;
const pm = w.player.mults;
const person = { skills: { hacking: level, intelligence: w.player.intelligence ?? 0 }, mults: pm };
const mults = { chance: pm.hacking_chance, speed: pm.hacking_speed, money: pm.hacking_money, growth: pm.hacking_grow };

// y: the live measured hack-yield correction batch.js is applying right now.
const y = bt.calibration?.enabled ? bt.calibration.y : 1;

const RAM = { hack: 1.7, grow: 1.75, weaken: 1.75 };
const SPACING = 200;

// The fleet the batcher actually sees, straight out of its own telemetry.
const totalRam = bt.ram.total;

function mkTarget(s) {
  const t = {
    host: s.hostname,
    level,
    mults,
    required: s.requiredHackingSkill,
    minSec: s.minDifficulty,
    maxMoney: s.moneyMax,
    sec: Math.max(s.hackDifficulty, s.minDifficulty),
    money: s.moneyAvailable,
    growth: s.serverGrowth,
  };
  // hackTime at MIN security, in ms — the same quantity readTarget() computes
  // (batch.js:655-662). calculateHackingTime returns seconds (src/Hacking.ts:60).
  t.hackTime = calculateHackingTime({ hackDifficulty: t.minSec, requiredHackingSkill: t.required }, person) * 1000;
  t.phi0 = b.hackFraction(t.level, t.required, t.minSec, mults);
  t.chance = b.hackChance(t.level, t.required, t.minSec, mults);
  t.k = b.growthK(t.minSec, t.growth, mults);
  t.kNow = t.k;
  t.phi = t.phi0 * (y > 0 ? y : 1);
  return t;
}

// --- cross-check the hand-ported formulas against the game's own -------------
{
  const s = w.servers.find((x) => x.hostname === bt.targets[0].host);
  const t = mkTarget(s);
  const srv = { hostname: s.hostname, requiredHackingSkill: t.required, minDifficulty: t.minSec, hackDifficulty: t.minSec, moneyMax: t.maxMoney, moneyAvailable: t.maxMoney, serverGrowth: t.growth, hasAdminRights: true };
  const gamePhi = calculatePercentMoneyHacked(srv, person);
  const gameChance = calculateHackingChance(srv, person);
  const gameK = calculateServerGrowthLog(srv, 1, person, 1);
  const e = (m, l) => `${((m / l - 1) * 100).toFixed(2)}%`;
  console.log(`formula cross-check on ${s.hostname} (batch.js port vs game source, with BN${configuredBitNode} physics):`);
  console.log(`  phi   port*y ${t.phi.toExponential(4)}  game ${gamePhi.toExponential(4)}   err ${e(t.phi, gamePhi)}   (port*y should MATCH game: y is meant to stand in for ScriptHackMoney)`);
  console.log(`  chance port  ${t.chance.toFixed(5)}  game ${gameChance.toFixed(5)}   err ${e(t.chance, gameChance)}`);
  console.log(`  k      port  ${t.k.toExponential(4)}  game ${gameK.toExponential(4)}   err ${e(t.k, gameK)}`);
}

const ranked = w.servers
  .filter((s) => s.moneyMax > 0 && s.hasAdminRights && s.requiredHackingSkill <= level)
  .map((s) => mkTarget(s))
  .map((t) => ({ t, s: b.targetScore(t) }))
  .filter((x) => x.s > 0)
  .sort((a, z) => z.s - a.s);

// The same worthwhile filter batch.js applies (batch.js:1230-1234).
const bestScore = ranked.length ? ranked[0].s : 0;
const bestMoney = ranked.reduce((m, r) => Math.max(m, r.t.maxMoney), 0);
const worthwhile = ranked.filter((r) => r.s >= bestScore * 0.02 && r.t.maxMoney >= bestMoney * 0.01);
const cand = (worthwhile.length ? worthwhile : ranked).slice(0, 8);

const fmt = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}b` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}m` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(0)}`);

console.log(`\nlive: BN${w.bitNode}, hacking ${level}, fleet ${totalRam}GB over ${bt.hostsUsed} hosts, y=${y}, spacing ${SPACING}ms`);
console.log(`      batch.js is running ${bt.targets.length} target(s): ${bt.targets.map((t) => t.host).join(", ")}`);
console.log(`      ranked ${ranked.length} rooted+hackable targets, ${worthwhile.length} pass the worthwhile filter, ${cand.length} candidates\n`);

console.log("candidate list (batch.js targetScore order):");
console.log("  " + "host".padEnd(18) + "score".padStart(12) + "maxMoney".padStart(11) + "req".padStart(5) + "minSec".padStart(8) + "growth".padStart(8) + "hackT(s)".padStart(10) + "phi".padStart(12));
for (const r of cand) {
  console.log("  " + r.t.host.padEnd(18) + r.s.toExponential(3).padStart(12) + fmt(r.t.maxMoney).padStart(11) + String(r.t.required).padStart(5) + r.t.minSec.toFixed(0).padStart(8) + String(r.t.growth).padStart(8) + (r.t.hackTime / 1000).toFixed(1).padStart(10) + r.t.phi.toExponential(3).padStart(12));
}

// --- the shipped criterion, verbatim from batch.js:1268-1285 ------------------
// `largestBlock` is the difference between the argmax (batch.js:1274, which
// omits it) and the dispatcher (batch.js:1462, which passes it).
function argmax(totalRam, maxHackRam) {
  const rows = [];
  for (let n = 1; n <= cand.length; n++) {
    const slice = totalRam / n;
    let inc = 0;
    const parts = [];
    for (let i = 0; i < n; i++) {
      const p = b.planBatch(cand[i].t, RAM, slice / 4, maxHackRam);
      if (!p) { parts.push({ host: cand[i].t.host, inc: 0, plan: null }); continue; }
      const capTerm = p.money / (4 * SPACING);
      const rateTerm = (slice * p.money) / (p.gb * cand[i].t.hackTime * 4);
      const one = Math.min(capTerm, rateTerm);
      inc += one;
      parts.push({ host: cand[i].t.host, inc: one, plan: p, sat: capTerm <= rateTerm });
    }
    rows.push({ n, inc, parts });
  }
  return rows;
}

function show(title, rows) {
  const best = rows.reduce((a, z) => (z.inc > a.inc ? z : a));
  console.log(`\n${title}\n  argmax -> n = ${best.n}`);
  console.log("   n    modelled $/s      %best  saturated  head plan (h/g/w1/w2, GB)");
  for (const r of rows) {
    const p0 = r.parts[0]?.plan;
    console.log(
      `  ${String(r.n).padStart(2)}  ${fmt(r.inc * 1000).padStart(14)}/s  ${((r.inc / best.inc) * 100).toFixed(0).padStart(5)}%  ` +
        `${String(r.parts.filter((x) => x.sat).length)}/${r.parts.length}`.padStart(10) +
        `   ${p0 ? `${p0.h}/${p0.g}/${p0.w1}/${p0.w2}, ${p0.gb.toFixed(0)}GB` : "-"}`,
    );
  }
  return best;
}

// --- CHECK: does the shipped criterion reproduce the live income? ------------
console.log("\n=== CHECK: shipped criterion vs the live batcher ===");
{
  const liveN = bt.targets.length;
  const largest = Number(process.env.LARGEST_BLOCK ?? 0);
  const rowsU = argmax(totalRam, Infinity);
  const rowsC = largest > 0 ? argmax(totalRam, largest) : null;
  const mU = rowsU[liveN - 1].inc * 1000;
  const liveRate = bt.totals.earnedPerSec;
  console.log(`  live measured (batch.txt totals.earnedPerSec, ${(bt.uptimeSec / 60).toFixed(0)} min uptime): ${fmt(liveRate)}/s`);
  console.log(`  shipped criterion at n=${liveN}, unconstrained hack block: ${fmt(mU)}/s   err ${((mU / liveRate - 1) * 100).toFixed(0)}%`);
  if (rowsC) {
    const mC = rowsC[liveN - 1].inc * 1000;
    console.log(`  shipped criterion at n=${liveN}, hack block <= ${largest}GB:      ${fmt(mC)}/s   err ${((mC / liveRate - 1) * 100).toFixed(0)}%`);
  }
  // Where the discrepancy lives: the criterion's period floor vs the real one.
  const T = bt.targets[0];
  const measuredPeriod = T.batchesPerMin > 0 ? 60 / T.batchesPerMin : Infinity;
  console.log(`  period assumed by the cap term: ${(4 * SPACING) / 1000}s   reported by batch.js: ${T.periodSec?.toFixed(2)}s   achieved (60/batchesPerMin): ${measuredPeriod.toFixed(1)}s`);
  console.log(`  live head plan: h=${T.plan?.h} g=${T.plan?.g} gb=${T.plan?.gb}  $/batch measured ${fmt(T.earned / Math.max(1, T.batches))}  placeFails=${T.placeFails} unsafeSkips=${T.unsafeSkips}`);
}

show("A. shipped argmax as batch.js:1274 computes it (maxHackRam = Infinity)", argmax(totalRam, Infinity));

// B. Sensitivity to the constraint the argmax omits and the dispatcher applies.
// The fleet is 50 hosts sized {4:1, 8:13, 16:20, 32:7, 64:5, 128:1, 256:2, 512:1},
// so the largest FREE block once batches are in flight is tens of GB, not 2124.
console.log("\nB. argmax vs the dispatcher's largest-free-block cap (batch.js:1462 passes this; batch.js:1274 does not)");
console.log("  maxHackRam   argmax n   $/s at that n   head plan GB   n=1 $/s   n=8 $/s");
for (const lb of [Infinity, 512, 256, 128, 64, 32, 20, 16, 8]) {
  const rows = argmax(totalRam, lb);
  const best = rows.reduce((a, z) => (z.inc > a.inc ? z : a));
  console.log(
    `  ${String(lb).padStart(10)}   ${String(best.n).padStart(8)}   ${fmt(best.inc * 1000).padStart(13)}   ` +
      `${(best.parts[0].plan?.gb ?? 0).toFixed(0).padStart(12)}   ${fmt(rows[0].inc * 1000).padStart(7)}   ${fmt(rows[7].inc * 1000).padStart(7)}`,
  );
}

// C. Where does n stop being 1? Fleet sweep at the live world, shipped criterion.
console.log("\nC. fleet sweep, shipped criterion (maxHackRam = Infinity, as batch.js:1274 has it)");
console.log("  fleetGB    argmax n   saturated targets at that n");
for (const f of [1024, 2124, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288, 1048576]) {
  const rows = argmax(f, Infinity);
  const best = rows.reduce((a, z) => (z.inc > a.inc ? z : a));
  console.log(`  ${String(f).padStart(8)}   ${String(best.n).padStart(8)}   ${best.parts.filter((x) => x.sat).length}/${best.n}`);
}

process.exit(0);
