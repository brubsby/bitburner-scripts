// Checks batch.js's inlined formulas against the game's own, across the whole
// space of conditions a run passes through.
//
//   node tools/sim/verify-batch.mjs
//
// batch.js carries hand-ported copies of calculatePercentMoneyHacked,
// calculateHackingChance, calculateServerGrowthLog and
// numCycleForGrowthCorrected, because the ns equivalents cost RAM and answer
// about the server's *current* state rather than the prepped state a batch will
// land on. Those ports are a standing fidelity risk — the repo's most expensive
// bugs have all been "a plausible simplification, never checked against source"
// — and they multiply every decision the batcher makes.
//
// This does not test one configuration. The multipliers, core count and
// Source-File availability all change during a run, and a port can agree at
// mults=1/cores=1 while drifting badly at mults=3/cores=7. So it sweeps:
//
//   * hacking multipliers from a fresh BitNode (1.0) through heavily augmented
//   * home cores 1..8
//   * server difficulty, growth and required-level across the real BN1 range
//   * hacking level from 1 to well past what any target requires
//
// and reports the worst relative error found anywhere in that space.
//
// CALIBRATION: this is a source-vs-source check and needs no live measurement —
// both sides are formulas, one hand-ported and one out of ~/Repos/bitburner, and
// agreement between them is the entire claim. That also bounds what it proves:
// it says batch.js computes the right phi, chance, k and grow-threads, and says
// NOTHING about whether the batcher built on them earns what a model predicts.
// For that, verify-alloc-shipped.mjs section 0 asserts batch.js's planner and
// throughput against the running game.

import "./env.mjs";

// IMPORT game.mjs, NOT game.bundle.mjs DIRECTLY.
//
// This file used to reach straight for the bundle, which meant `setBitNode()`
// never ran and `currentNodeMults` stayed at the module default — every field
// 1, i.e. BitNode 1 physics — no matter which BitNode the save was actually in.
//
// The result was the worst possible output: `"phi": 0` error across 1,080
// checks and a confident PASS, while the shipped phi was 5x high in the BitNode
// 4 we are really in. A verifier that configures its own world to match the
// code under test does not check the code, it checks itself, and it reports
// that as success. game.mjs auto-configures from the live save on import and
// prints the physics it chose (or says loudly that it could not).
import { configuredBitNode } from "./game.mjs";

const g = await import("./game.bundle.mjs");
import { importRootScript } from "./rootimport.mjs";
// NOT a bare `await import("../../batch.js")` — that throws
// ERR_MODULE_NOT_FOUND on batch.js's `from 'status.js'` and killed this
// file at module load, so it checked nothing and said nothing.
const b = await importRootScript("batch.js");

const rel = (a, c) => (a === c ? 0 : Math.abs(a - c) / Math.max(Math.abs(a), Math.abs(c), 1e-12));

function mockPerson(mults, hacking) {
  const p = g.mockPerson ? g.mockPerson() : {};
  return {
    ...p,
    skills: { ...(p.skills ?? {}), hacking, intelligence: 0 },
    mults: {
      ...(p.mults ?? {}),
      hacking_money: mults.money,
      hacking_chance: mults.chance,
      hacking_grow: mults.growth,
      hacking_speed: mults.speed,
      hacking: 1,
    },
    hp: p.hp ?? { current: 10, max: 10 },
  };
}

function mockServer(required, minSec, growth, moneyMax) {
  return {
    hostname: "t",
    hasAdminRights: true,
    requiredHackingSkill: required,
    hackDifficulty: minSec,
    minDifficulty: minSec,
    baseDifficulty: minSec,
    moneyAvailable: moneyMax,
    moneyMax,
    serverGrowth: growth,
  };
}

const MULTS = [
  { name: "fresh BN1", chance: 1, speed: 1, money: 1, growth: 1 },
  { name: "mid-run", chance: 1.6, speed: 1.6, money: 1.68, growth: 1.46 },
  { name: "heavy augs", chance: 3.2, speed: 3.1, money: 4.4, growth: 2.9 },
];
const CORES = [1, 2, 4, 7, 8];
const LEVELS = [1, 50, 200, 800, 1800, 5000];
const SERVERS = [
  { required: 1, minSec: 1, growth: 5, moneyMax: 1e6 },
  { required: 50, minSec: 10, growth: 25, moneyMax: 5e7 },
  { required: 500, minSec: 40, growth: 60, moneyMax: 1e10 },
  { required: 1200, minSec: 85, growth: 100, moneyMax: 4e11 },
];

let worst = { phi: 0, chance: 0, k: 0, grow: 0, weaken: 0 };
let worstWhere = {};
let checks = 0;

for (const m of MULTS) {
  for (const lvl of LEVELS) {
    const person = mockPerson(m, lvl);
    for (const s of SERVERS) {
      const srv = mockServer(s.required, s.minSec, s.growth, s.moneyMax);
      const mults = { chance: m.chance, speed: m.speed, money: m.money, growth: m.growth };

      // --- hack fraction per thread -------------------------------------
      //
      // ASSERT THE DECOMPOSITION, not raw equality. batch.js's `hackFraction`
      // is deliberately the port of Hacking.ts WITHOUT the node term: the game
      // multiplies by currentNodeMults.ScriptHackMoney (Hacking.ts:44-56) and
      // the port does not. Every other factor is identical term for term, so
      //
      //     game phi  ===  hackFraction(...) * ScriptHackMoney
      //
      // is an exact identity, and it is the honest thing to check here. Naive
      // equality was only ever "true" because the old direct-bundle import left
      // the node multipliers at all-1s, where the missing term is invisible;
      // under real BitNode 4 physics (ScriptHackMoney 0.2) it would now fail
      // permanently and correctly against a port that is not supposed to carry
      // it. verify-selfcal.mjs §1 proves the same identity across BN1/4/5/6/9/12.
      const phiGame = g.calculatePercentMoneyHacked(srv, person);
      const phiOurs = b.hackFraction(lvl, s.required, s.minSec, mults) * g.currentNodeMults.ScriptHackMoney;
      // --- hack chance ---------------------------------------------------
      const chGame = g.calculateHackingChance(srv, person);
      const chOurs = b.hackChance(lvl, s.required, s.minSec, mults);

      if (rel(phiGame, phiOurs) > worst.phi) {
        worst.phi = rel(phiGame, phiOurs)
        worstWhere.phi = `${m.name} lvl${lvl} req${s.required}: game ${phiGame.toExponential(4)} ours ${phiOurs.toExponential(4)}`
      }
      if (rel(chGame, chOurs) > worst.chance) {
        worst.chance = rel(chGame, chOurs)
        worstWhere.chance = `${m.name} lvl${lvl} req${s.required}: game ${chGame.toFixed(6)} ours ${chOurs.toFixed(6)}`
      }

      for (const cores of CORES) {
        // --- growth constant k, and the core bonus applied on top ---------
        // batch.js keeps k single-core and scales THREADS by the executing
        // host's core bonus, so the equivalent game value is the 1-core log
        // multiplied by that bonus.
        const kGame = Math.log(g.calculateServerGrowth(srv, 1, person, cores));
        const kOurs = b.growthK(s.minSec, s.growth, mults) * b.coreBonus(cores);
        if (rel(kGame, kOurs) > worst.k) {
          worst.k = rel(kGame, kOurs)
          worstWhere.k = `${m.name} lvl${lvl} req${s.required} cores${cores}: game ${kGame.toExponential(4)} ours ${kOurs.toExponential(4)}`
        }

        // --- weaken effect per thread -------------------------------------
        const wGame = g.getWeakenEffect(1, cores);
        const wOurs = b.WEAKEN_PER_THREAD * b.coreBonus(cores);
        if (rel(wGame, wOurs) > worst.weaken) {
          worst.weaken = rel(wGame, wOurs)
          worstWhere.weaken = `cores${cores}: game ${wGame} ours ${wOurs}`
        }

        // --- grow threads to restore money --------------------------------
        for (const frac of [0.1, 0.5, 0.9]) {
          const start = s.moneyMax * (1 - frac);
          const gGame = g.numCycleForGrowthCorrected(srv, s.moneyMax, start, cores, person);
          const gOurs = b.growThreads(s.moneyMax, start, b.growthK(s.minSec, s.growth, mults) * b.coreBonus(cores), s.moneyMax);
          if (Number.isFinite(gGame) && Number.isFinite(gOurs) && rel(gGame, gOurs) > worst.grow) {
            worst.grow = rel(gGame, gOurs)
            worstWhere.grow = `${m.name} lvl${lvl} req${s.required} cores${cores} frac${frac}: game ${gGame.toFixed(3)} ours ${gOurs.toFixed(3)}`
          }
          checks++;
        }
      }
    }
  }
}

console.log(JSON.stringify({ checks, worstRelativeError: worst, worstCase: worstWhere }, null, 2));
const bad = Object.entries(worst).filter(([, v]) => v > 0.01);
console.log(bad.length ? `FAIL: ${bad.map(([k, v]) => `${k} off by ${(v * 100).toFixed(2)}%`).join(", ")}` : "PASS: every formula within 1% of the game across the sweep");

// EXPLICIT EXIT, with a non-zero status when the check fails.
//
// Importing game.mjs for its physics auto-configuration also leaves the event
// loop non-empty, so without this the process prints its verdict and then hangs
// forever. A checker that never exits is worse than one that fails: anything
// running it in a pipeline blocks until a timeout, and a timeout kill produces
// exit 124 whether the formulas agreed or not — the verdict becomes unreadable
// by exactly the automation that should be reading it.
//
// The status code also starts carrying the answer, which it did not before:
// this file always exited 0, so a caller had to scrape stdout for the word
// PASS to learn anything.
process.exit(bad.length ? 1 : 0);
