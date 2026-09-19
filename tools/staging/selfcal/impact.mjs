#!/usr/bin/env node
// What the correction actually does to the plan, the placement and the income,
// on the fleet that is running right now.
//
//   node tools/staging/selfcal/impact.mjs
//
// CALIBRATION: the fleet, the targets and the hacking level are read from the
// live save (snap-live.mjs / getSaveFile), and the uncorrected column is checked
// against the plan batch.js is publishing in /tel/batch.txt before anything
// below it is used. The correction's effect on INCOME is a model, not a
// measurement — only running it measures that — and the model's one input that
// cannot be checked offline is the realised period, which the live batcher
// reports at 7.8s against a planned 4.3s.

import "../../sim/env.mjs";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setBitNode, calculatePercentMoneyHacked, calculateHackingTime } from "../../sim/game.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const src = fs
  .readFileSync(path.join(HERE, "batch.js"), "utf8")
  .replace(/(^\s*import[^'"]*['"])([^'"]+)(['"])/gm, (all, head, spec, tail) => {
    const target = path.join(REPO, spec.replace(/^\.?\//, ""));
    return fs.existsSync(target) ? head + pathToFileURL(target).href + tail : all;
  });
const B = await import(`data:text/javascript;base64,${Buffer.from(src).toString("base64")}`);

const res = await fetch(`http://localhost:${process.env.CTL_PORT ?? 12526}/rpc`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ method: "getSaveFile" }),
  signal: AbortSignal.timeout(30000),
});
const raw = zlib.gunzipSync(Buffer.from((await res.json()).result.save, "latin1")).toString("utf8");
const save = JSON.parse(raw);
const P = JSON.parse(save.data.PlayerSave).data;
const ALL = JSON.parse(save.data.AllServersSave);
setBitNode(P.bitNodeN, 1);

const RAM = { hack: 1.7, grow: 1.75, weaken: 1.75 };
const SPACING = 200;
const hosts = [];
const money = [];
for (const k of Object.keys(ALL)) {
  const s = ALL[k].data;
  if (s.hasAdminRights && s.maxRam > 0) hosts.push({ host: s.hostname, ram: s.maxRam });
  if (s.hasAdminRights && s.moneyMax > 0 && s.requiredHackingSkill <= P.skills.hacking) money.push(s);
}
hosts.sort((a, b) => b.ram - a.ram);
const fleet = hosts.reduce((a, x) => a + x.ram, 0);
// place() cannot split the hack op, so the ceiling is ONE host. Reserves:
// selfReserve 6 on the controller's host (home) + homeReserve 4, and 3% of the
// fleet held for ns.share when a faction is joined (none are today).
const largestBlock = Math.max(hosts[0].ram, hosts[1].ram - 10);

const person = { skills: { hacking: P.skills.hacking, intelligence: P.skills.intelligence ?? 0 }, mults: P.mults };
const mults = { chance: P.mults.hacking_chance, speed: P.mults.hacking_speed, money: P.mults.hacking_money, growth: P.mults.hacking_grow };

function target(s) {
  const prepped = { ...s, hackDifficulty: s.minDifficulty, baseDifficulty: s.minDifficulty, moneyAvailable: s.moneyMax };
  const t = {
    host: s.hostname,
    level: P.skills.hacking,
    mults,
    required: s.requiredHackingSkill,
    minSec: s.minDifficulty,
    maxMoney: s.moneyMax,
    sec: s.minDifficulty,
    money: s.moneyMax,
    growth: s.serverGrowth,
    hackTime: calculateHackingTime(prepped, person) * 1000,
  };
  t.hackTimeNow = t.hackTime;
  t.phi0 = B.hackFraction(t.level, t.required, t.minSec, mults);
  t.chance = B.hackChance(t.level, t.required, t.minSec, mults);
  t.k = B.growthK(t.minSec, t.growth, mults);
  t.kNow = t.k;
  t.phi = t.phi0;
  t.trueY = calculatePercentMoneyHacked(prepped, person) / t.phi0;
  return t;
}

const ts = money.map(target).filter((t) => B.targetScore(t) > 0);
ts.sort((a, b) => B.targetScore(b) - B.targetScore(a));
const Y = ts[0].trueY;

console.log(`live fleet: ${hosts.length} rooted hosts, ${fleet}GB total, largest single block ~${largestBlock}GB`);
console.log(`BitNode ${P.bitNodeN}, hacking ${P.skills.hacking}, hacking_money ${P.mults.hacking_money}`);
console.log(`ScriptHackMoney (what the calibration will measure) = ${Y}\n`);

// The batcher runs 1 target today, so the argmax picked n=1; keep that.
const N = 1;
const slice = fleet / N;
console.log("target        y      h     g   w1  w2    gb   hackOp   fits?    f%     $/batch    period   $/sec");
for (const t of ts.slice(0, 4)) {
  for (const y of [1, Y]) {
    const tt = { ...t, phi: t.phi0 * y };
    const plan = B.planBatch(tt, RAM, slice / 4, largestBlock);
    if (!plan) {
      console.log(`${t.host.padEnd(14)} ${String(y).padEnd(6)} (no placeable plan)`);
      continue;
    }
    // realised money per batch: the game takes phi_true*h, not the planned f
    const realF = Math.min(1, t.phi0 * t.trueY * plan.h);
    const real = realF * t.maxMoney * t.chance;
    const wt = 4 * t.hackTime;
    const period = Math.max(4 * SPACING, wt / Math.max(1, Math.floor(slice / plan.gb)));
    const hackOp = plan.h * RAM.hack;
    console.log(
      `${t.host.padEnd(14)} ${String(Number(y.toFixed(3))).padEnd(6)} ${String(plan.h).padStart(4)} ${String(plan.g).padStart(5)} ${String(plan.w1).padStart(4)} ${String(plan.w2).padStart(3)} ${plan.gb.toFixed(0).padStart(6)} ${hackOp.toFixed(0).padStart(7)}GB ${(hackOp <= largestBlock ? "yes" : "NO").padStart(5)} ${(plan.f * 100).toFixed(1).padStart(6)}  ${("$" + Math.round(real).toLocaleString()).padStart(12)} ${(period / 1000).toFixed(2).padStart(7)}s ${("$" + Math.round(real / (period / 1000)).toLocaleString()).padStart(10)}`,
    );
  }
  console.log("");
}
console.log("`$/batch` is the money the GAME will actually remove (phi_true * h), not the plan's claim.");
console.log("`fits?` is the B5 invariant: the hack op cannot be split across hosts, so it must fit one block.");

// --- the risk the correction creates ----------------------------------------
// h rises roughly 1/Y, so the hack op rises with it and the single-block
// ceiling starts to bite. planBatch is handed the largest FREE block every
// tick, so it degrades by planning smaller rather than by failing to place —
// but how much it degrades is worth knowing before deploying.
console.log("\nsensitivity to the largest FREE block (it shrinks as batches launch):");
console.log("  block    h    hackOp    gb   $/batch      period    $/sec");
const t0 = ts[0];
for (const blk of [1024, 512, 256, 128, 64, 32]) {
  const plan = B.planBatch({ ...t0, phi: t0.phi0 * Y }, RAM, slice / 4, blk);
  if (!plan) {
    console.log(`  ${String(blk).padStart(5)}GB  (no placeable plan)`);
    continue;
  }
  const realF = Math.min(1, t0.phi0 * Y * plan.h);
  const real = realF * t0.maxMoney * t0.chance;
  const period = Math.max(4 * SPACING, (4 * t0.hackTime) / Math.max(1, Math.floor(slice / plan.gb)));
  console.log(
    `  ${String(blk).padStart(5)}GB ${String(plan.h).padStart(4)} ${(plan.h * RAM.hack).toFixed(0).padStart(7)}GB ${plan.gb.toFixed(0).padStart(5)} ${("$" + Math.round(real).toLocaleString()).padStart(11)} ${(period / 1000).toFixed(2).padStart(8)}s ${("$" + Math.round(real / (period / 1000)).toLocaleString()).padStart(9)}`,
  );
}

// --- does the target-count argmax move? --------------------------------------
console.log("\ntarget-count argmax (the same arithmetic main() runs each retarget):");
for (const y of [1, Y]) {
  let bestN = 1;
  let bestInc = -1;
  const incs = [];
  for (let n = 1; n <= Math.min(8, ts.length); n++) {
    const sl = fleet / n;
    let inc = 0;
    for (let i = 0; i < n; i++) {
      const p = B.planBatch({ ...ts[i], phi: ts[i].phi0 * y }, RAM, sl / 4, largestBlock);
      if (!p) continue;
      inc += Math.min(p.money / (4 * SPACING), (sl * p.money) / (p.gb * ts[i].hackTime * 4));
    }
    incs.push(Math.round(inc * 1000));
    if (inc > bestInc) {
      bestInc = inc;
      bestN = n;
    }
  }
  console.log(`  y=${Number(y.toFixed(3))}: argmax n=${bestN}   modelled $/s by n: ${incs.map((v) => "$" + v.toLocaleString()).join("  ")}`);
}
