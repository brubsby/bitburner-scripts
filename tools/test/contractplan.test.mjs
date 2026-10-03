// [CP] coding contracts as a forecast — contractplan.js against game source.
//
// The failure this prevents: the largest realised early income had no
// forecast, and it is not even in the measured script income the money legs
// divide by (docs/pricing-gaps.md §5). Pinned here: the spawn rate, the
// difficulty pool, the reward routing (the CASCADE: every re-route divides
// by 3 again — this module paid every route at /3 until 2026-10-02), the fit
// to a live sweep, the faction share, the solver coverage, the backlog while
// no solver runs, ctauto.js's reward log, and the variance the plan draws.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import "./gameresolve.mjs";
import { GAME } from "./build-ram.mjs";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const cp = await import("../../contractplan.js");
const { DIFFICULTIES, TYPE_DIFFICULTY, SOLVER_TYPES, spawnChance, spawnPerSec, expectedDifficulty, expectedReward, rewardRoutes, contractIncome, contractStream, solverStateOf, solverCoverage, parseRewardText, BASE_MONEY_GAIN, BASE_FACTION_REP_GAIN, BASE_COMPANY_REP_GAIN, TRIES_PER_WINDOW, WINDOW_SEC } = cp;
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

// The live sweep of 2026-09-18T01:41Z (ctsolve.js, /tel/contracts.txt): 49
// rewards, every one money. history.jsonl at that minute: BitNode 5
// (CodingContractMoney 1), Source-Files SF1.2 + SF4.1 (total 3: cap 7), no
// faction joined, no job — so every faction and company draw re-routed.
const SWEEP_2026_09_18 = [
  25, 50, 41.667, 25, 50, 8.333, 25, 16.667, 13.889, 100, 25, 50, 41.667, 5.556, 50, 25, 175, 16.667, 11.111, 16.667, 5.556, 25, 150, 25, 8.333, 8.333, 75, 100, 2.778, 50, 50, 11.111, 5.556, 16.667, 33.333, 16.667, 50, 50, 58.333, 16.667, 25, 2.778, 8.333, 33.333, 175, 5.556, 5.556, 8.333, 58.333,
].map((m) => `Gained $${m.toFixed(3)}m`);

/** Seeded uniform (mulberry32), for the Monte Carlo p-value. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * gainCodingContractReward, lifted from the game's source and evaluated with
 * stubs — so the routes are checked against the code, not a reading of it.
 */
function gameRewardFn() {
  const src = fs.readFileSync(path.join(GAME, "src/PersonObjects/Player/PlayerObjectGeneralMethods.ts"), "utf8");
  const a = src.indexOf("export function gainCodingContractReward(");
  if (a < 0) return null;
  const open = src.indexOf("): string {", a);
  const end = src.indexOf("\n}\n", open);
  if (open < 0 || end < 0) return null;
  let body = src.slice(open + "): string {".length, end);
  body = body.replace(/const __a: never = reward;/, "");
  if (/:\s*(never|string|number|ICodingContractReward)\b/.test(body)) return null;
  return new Function(
    "CodingContractRewardType", "Player", "Factions", "Companies", "CONSTANTS", "getRandomIntInclusive", "getRecordKeys", "currentNodeMults", "formatMoney", "Math",
    `return function gainCodingContractReward(reward, difficulty, rewardScaling) {${body}\n}`,
  );
}

export async function run() {
  const checks = [];

  // ---------------------------------------------------------------------
  const c1 = new Check("CP1", "constants, spawn cadence and every type's difficulty (by name) match game source");
  {
    const consts = fs.readFileSync(path.join(GAME, "src/Constants.ts"), "utf8");
    for (const [name, v] of [["CodingContractBaseMoneyGain", BASE_MONEY_GAIN], ["CodingContractBaseFactionRepGain", BASE_FACTION_REP_GAIN], ["CodingContractBaseCompanyRepGain", BASE_COMPANY_REP_GAIN]]) {
      c1.examined(1);
      const m = consts.match(new RegExp(`${name}:\\s*([\\d.e]+)`));
      if (!m || Number(m[1]) !== v) c1.fail(`${name}: module ${v} vs source ${m?.[1]}`);
    }
    c1.examined(1);
    const engine = fs.readFileSync(path.join(GAME, "src/engine.tsx"), "utf8");
    const tries = engine.match(/tryGeneratingRandomContract\((\d+)\);[\s\S]{0,200}?Engine\.Counters\.contractGeneration = (\d+);/);
    if (!tries) c1.fail("could not find the contract generation cadence in engine.tsx");
    else {
      if (Number(tries[1]) !== TRIES_PER_WINDOW) c1.fail(`tries per window: module ${TRIES_PER_WINDOW} vs engine ${tries[1]}`);
      if (Number(tries[2]) * 0.2 !== WINDOW_SEC) c1.fail(`window: module ${WINDOW_SEC}s vs engine ${tries[2]} cycles`);
    }
    c1.examined(1);
    const gen = fs.readFileSync(path.join(GAME, "src/CodingContract/ContractGenerator.ts"), "utf8");
    const p = gen.match(/random > (\d+) \/ \((\d+) \+ Math\.exp\(([\d.]+) \* currentNumberOfContracts\)\)/);
    if (!p) c1.fail("could not find the spawn probability in ContractGenerator.ts");
    else if (Math.abs(spawnChance(0) - Number(p[1]) / (Number(p[2]) + 1)) > 1e-12 || Math.abs(spawnChance(5000) - Number(p[1]) / (Number(p[2]) + Math.exp(Number(p[3]) * 5000))) > 1e-12) {
      c1.fail("spawnChance diverges from the source expression");
    }
    if (!gen.includes("const maxDif = 2 * totalSFs + 1")) c1.fail("the difficulty cap expression has changed in ContractGenerator.ts");
    // Hash-bought contracts are the same draw (HacknetHelpers: generateRandomContract).
    const hh = fs.readFileSync(path.join(GAME, "src/Hacknet/HacknetHelpers.tsx"), "utf8");
    if (!/generateRandomContract\(\)/.test(hh)) c1.fail("a hash-bought contract is no longer generateRandomContract: its reward may differ");

    // Every type by NAME: Enums.ts maps the key to the name, contracts/*.ts the key to the difficulty.
    c1.examined(1);
    const enums = fs.readFileSync(path.join(GAME, "src/CodingContract/Enums.ts"), "utf8");
    const nameOf = Object.fromEntries([...enums.matchAll(/^\s*(\w+) = "([^"]+)",/gm)].map((m) => [m[1], m[2]]));
    const dir = path.join(GAME, "src/CodingContract/contracts");
    const found = {};
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".ts")) continue;
      const t = fs.readFileSync(path.join(dir, f), "utf8");
      for (const m of t.matchAll(/\[CodingContractName\.(\w+)\]:\s*\{/g)) {
        const d = t.slice(m.index).match(/difficulty:\s*(\d+)/);
        found[nameOf[m[1]] ?? m[1]] = d ? Number(d[1]) : null;
      }
    }
    for (const [n, d] of Object.entries(found)) if (TYPE_DIFFICULTY[n] !== d) c1.fail(`${n}: source difficulty ${d}, module ${TYPE_DIFFICULTY[n]}`);
    for (const n of Object.keys(TYPE_DIFFICULTY)) if (!(n in found)) c1.fail(`module type '${n}' is not in the game`);
    if (DIFFICULTIES.length !== Object.keys(found).length) c1.fail(`pool size ${DIFFICULTIES.length} vs source ${Object.keys(found).length}`);
    c1.note(`${Object.keys(found).length} contract types in source; spawn ${spawnPerSec(0) * 3600} per hour at zero pending`);
  }
  checks.push(c1);

  // ---------------------------------------------------------------------
  const c2 = new Check("CP2", "THE CASCADE: rewardRoutes matches gainCodingContractReward evaluated from source, every route, every state");
  {
    const fn = gameRewardFn();
    if (!fn) c2.fail("could not lift gainCodingContractReward out of PlayerObjectGeneralMethods.ts");
    else {
      const T = { FactionReputation: 0, FactionReputationAll: 1, CompanyReputation: 2, Money: 3 };
      const seen = new Set();
      for (const F of [true, false]) {
        for (const J of [true, false]) {
          for (const mult of [1, 0.25, 0]) {
            c2.examined(1);
            // The game's expectation per unit difficulty, by kind, with k = 1
            // faction (no floor at d = 9): enumerate the drawn type and the
            // 50/50 coin, weighting each as the game draws it.
            const d = 9;
            const game = { money: 0, faction: 0, company: 0 };
            const types = mult > 0 ? [0, 1, 2, 3] : [0, 1, 2];
            for (const type of types) {
              for (const coin of [0.25, 0.75]) {
                const paid = { money: 0, faction: 0, company: 0 };
                const facs = F ? ["CyberSec"] : [];
                const Factions = { CyberSec: { playerReputation: 0, getInfo: () => ({ offerHackingWork: true }) } };
                const Companies = { ECorp: { playerReputation: 0 } };
                const P = { factions: facs, jobs: J ? { ECorp: "Software" } : {}, gainMoney: (m) => (paid.money += m) };
                const g = fn(T, P, Factions, Companies, { CodingContractBaseFactionRepGain: BASE_FACTION_REP_GAIN, CodingContractBaseCompanyRepGain: BASE_COMPANY_REP_GAIN, CodingContractBaseMoneyGain: BASE_MONEY_GAIN }, (lo) => lo, (o) => Object.keys(o), { CodingContractMoney: mult }, (x) => String(x), { ...Math, random: () => coin, floor: Math.floor });
                P.gainCodingContractReward = g;
                P.gainCodingContractReward({ type }, d, 1);
                paid.faction = Factions.CyberSec.playerReputation;
                paid.company = Companies.ECorp.playerReputation;
                for (const k of Object.keys(game)) game[k] += paid[k] / types.length / 2;
              }
            }
            const routes = rewardRoutes({ moneyOffered: mult > 0, hasHackingFaction: F, hasJob: J });
            for (const r of routes) seen.add(r.route);
            const mine = { money: 0, faction: 0, company: 0 };
            for (const r of routes) {
              if (r.kind === "money") mine.money += r.p * BASE_MONEY_GAIN * d * mult * r.scale;
              else if (r.kind === "company") mine.company += r.p * BASE_COMPANY_REP_GAIN * d * r.scale;
              else mine.faction += r.p * BASE_FACTION_REP_GAIN * d * r.scale;
            }
            if (!close(routes.reduce((a, r) => a + r.p, 0), 1)) c2.fail(`F${F} J${J}: route probabilities sum to ${routes.reduce((a, r) => a + r.p, 0)}`);
            for (const k of Object.keys(game)) if (!close(game[k], mine[k], 1e-12)) c2.fail(`F${F} J${J} money x${mult}: ${k} game ${game[k]} vs module ${mine[k]}`);
          }
        }
      }
      // The terminal paths the game has: direct money/faction/factionAll/company,
      // faction(All) -> money, company -> faction(All), company -> faction(All) -> money.
      const want = ["money", "faction", "factionAll", "company", "faction>money", "factionAll>money", "company>faction", "company>factionAll", "company>faction>money", "company>factionAll>money"];
      for (const w of want) if (!seen.has(w)) c2.fail(`route ${w} never produced`);
      const tiers = new Set(["F,J", "F,!J", "!F,J", "!F,!J"].flatMap((s) => rewardRoutes({ hasHackingFaction: !s.startsWith("!F"), hasJob: !s.endsWith("!J") }).map((r) => Math.round(1 / r.scale))));
      if ([...tiers].sort((a, b) => a - b).join() !== "3,9,27") c2.fail(`scale tiers ${[...tiers]} — the cascade must produce /3, /9 and /27`);
      c2.note(`${seen.size} terminal routes; tiers /${[...tiers].sort((a, b) => a - b).join(", /")}`);
    }
    // expectedReward on the pool, one hand-checked case: SF total 3 (cap 7),
    // nothing joined, no job, money x1 — P(/3) 1/4, P(/9) 1/2, P(/27) 1/4.
    c2.examined(1);
    const dbar = expectedDifficulty(3);
    const r = expectedReward({ totalSourceFileLevels: 3, nodeContractMoney: 1, hasHackingFaction: false, hasJob: false });
    const want = BASE_MONEY_GAIN * dbar * (1 / 12 + 1 / 18 + 1 / 108);
    if (!close(r.money, want)) c2.fail(`nothing joined, no job: ${r.money} vs ${want} (old /3-everywhere: ${BASE_MONEY_GAIN * dbar / 3})`);
    if (r.factionRep !== 0 || r.companyRep !== 0) c2.fail("nothing joined, no job: every route pays money");
    // A hacking faction, no job: company -> faction at /9.
    const nj = expectedReward({ totalSourceFileLevels: 3, nodeContractMoney: 1, hasHackingFaction: true, hasJob: false });
    if (!close(nj.factionRep, BASE_FACTION_REP_GAIN * dbar * (0.5 / 3 + 0.25 / 9))) c2.fail("a hacking faction, no job: faction 1/2 at /3 + company 1/4 at /9");
    // BN8-shaped: money multiplier 0 removes the money type entirely.
    const bn8 = expectedReward({ totalSourceFileLevels: 3, nodeContractMoney: 0, hasHackingFaction: true, hasJob: true });
    if (bn8.money !== 0 || !close(bn8.factionRep, (2 / 3) * BASE_FACTION_REP_GAIN * dbar / 3)) c2.fail("CodingContractMoney 0: no money, faction 2/3 at /3");
    // Refusals.
    if (expectedReward({ totalSourceFileLevels: 3, nodeContractMoney: undefined, hasHackingFaction: true, hasJob: true }) !== null) c2.fail("unreadable CodingContractMoney must refuse");
    if (expectedReward({ totalSourceFileLevels: 3, nodeContractMoney: 1, hasHackingFaction: "yes", hasJob: true }) !== null) c2.fail("non-boolean faction flag must refuse");
    if (contractIncome({}) !== null) c2.fail("contractIncome with no inputs must refuse");
  }
  checks.push(c2);

  // ---------------------------------------------------------------------
  const c3 = new Check("CP3", "THE LIVE SWEEP: 49 money rewards (BN5, SF total 3, nothing joined) fit the cascade mixture and reject /3-everywhere");
  {
    const parsed = SWEEP_2026_09_18.map((s) => parseRewardText(s));
    c3.examined(parsed.length);
    const unit = BASE_MONEY_GAIN / 27;
    const u = parsed.map((p) => Math.round(p.amount / unit));
    if (parsed.some((p, i) => Math.abs(p.amount / unit - u[i]) > 0.01)) c3.fail("a reward is not a whole multiple of 75e6/27");
    // The model's distribution over units: tier (27 x scale) x difficulty, uniform over the 25 types under cap 7.
    const routes = rewardRoutes({ moneyOffered: true, hasHackingFaction: false, hasJob: false });
    const pool = DIFFICULTIES.filter((d) => d <= 7);
    const P = new Map();
    for (const r of routes) for (const d of pool) P.set(Math.round(d * 27 * r.scale), (P.get(Math.round(d * 27 * r.scale)) ?? 0) + r.p / pool.length);
    const off = u.filter((x) => !P.has(x));
    if (off.length) c3.fail(`rewards outside the cascade's support: ${off}`);
    // The old model (every route /3) puts mass only on 9 x d.
    const oldOff = u.filter((x) => !(x % 9 === 0 && pool.includes(x / 9)));
    if (oldOff.length < 10) c3.fail(`the /3-everywhere model should be rejected by many rewards; only ${oldOff.length} fall outside it`);
    // Goodness of fit: the sample's log-likelihood against 4000 seeded samples of 49.
    const keys = [...P.keys()];
    const cum = [];
    let acc = 0;
    for (const k of keys) cum.push((acc += P.get(k)));
    const ll = (xs) => xs.reduce((a, x) => a + Math.log(P.get(x)), 0);
    const obs = ll(u);
    const R = rng(20260918);
    let le = 0;
    for (let s = 0; s < 4000; s++) {
      const xs = [];
      for (let i = 0; i < u.length; i++) {
        const v = R() * acc;
        xs.push(keys[cum.findIndex((c) => v <= c)]);
      }
      if (ll(xs) <= obs) le++;
    }
    const pval = le / 4000;
    if (pval < 0.01) c3.fail(`the sweep is unlikely under the cascade: Monte Carlo p ${pval}`);
    // The tier multiset: each reward's posterior over /3, /9, /27, summed.
    const tierPost = { 9: 0, 3: 0, 1: 0 };
    for (const x of u) {
      const z = P.get(x);
      for (const r of routes) {
        const t = Math.round(27 * r.scale);
        tierPost[t] += pool.filter((d) => d * t === x).length * (r.p / pool.length) / z;
      }
    }
    const expect = { 9: 0, 3: 0, 1: 0 };
    for (const r of routes) expect[Math.round(27 * r.scale)] += r.p * u.length;
    for (const t of [9, 3, 1]) if (Math.abs(tierPost[t] - expect[t]) > 3 * Math.sqrt(expect[t])) c3.fail(`tier /${27 / t}: ${tierPost[t].toFixed(1)} rewards vs ${expect[t]} expected`);
    // The mean against the model's, in its own standard error.
    const r = expectedReward({ totalSourceFileLevels: 3, nodeContractMoney: 1, hasHackingFaction: false, hasJob: false });
    const mean = parsed.reduce((a, p) => a + p.amount, 0) / parsed.length;
    const z = (mean - r.money) / Math.sqrt((r.moneySq - r.money ** 2) / parsed.length);
    if (Math.abs(z) > 3) c3.fail(`sweep mean $${(mean / 1e6).toFixed(2)}m vs model $${(r.money / 1e6).toFixed(2)}m: z ${z.toFixed(2)}`);
    c3.note(`mean $${(mean / 1e6).toFixed(2)}m vs cascade $${(r.money / 1e6).toFixed(2)}m (z ${z.toFixed(2)}), /3-everywhere $${((BASE_MONEY_GAIN * expectedDifficulty(3)) / 3 / 1e6).toFixed(2)}m; ${oldOff.length}/49 impossible under /3-everywhere; p ${pval.toFixed(3)}; tiers /3 ${tierPost[9].toFixed(1)}, /9 ${tierPost[3].toFixed(1)}, /27 ${tierPost[1].toFixed(1)} vs ${expect[9]}, ${expect[3]}, ${expect[1]}`);
  }
  checks.push(c3);

  // ---------------------------------------------------------------------
  const c4 = new Check("CP4", "THE FACTION SHARE: one faction's expectation is total/k (single) or floor(total/k) (all), and every caller divides by k");
  {
    c4.examined(1);
    const one = (k) => expectedReward({ totalSourceFileLevels: 0, nodeContractMoney: 1, hasHackingFaction: true, hasJob: true, factions: k });
    // Cap 1: every type difficulty 1, total 2500/3 per faction draw.
    const tot = BASE_FACTION_REP_GAIN / 3;
    const r1 = one(1);
    if (!close(r1.factionRepEach, 0.25 * tot + 0.25 * Math.floor(tot))) c4.fail("k = 1: the one faction takes it all (the all route floored)");
    const r3 = one(3);
    const want = 0.25 * (tot / 3) + 0.25 * Math.floor(tot / 3);
    if (!close(r3.factionRepEach, want)) c4.fail(`k = 3: ${r3.factionRepEach} vs ${want}`);
    if (!(r3.factionRepEach <= r3.factionRep / 3 + 1e-9)) c4.fail("the floor never pays more than total/k");
    // The callers.
    c4.examined(3);
    const ex = fs.readFileSync(path.join(REPO, "exitplan.js"), "utf8");
    if (!/const perFaction = c\.perContract \/ c\.factions/.test(ex)) c4.fail("exitplan.contractRepFn must take the exit faction's 1/k share of perContract");
    const hs = fs.readFileSync(path.join(REPO, "hashspend.js"), "utf8");
    if (!/r\.factionRep \/ k/.test(hs)) c4.fail("hashspend.js must price the exit faction's 1/k share");
    const pr = fs.readFileSync(path.join(REPO, "progress.js"), "utf8");
    if (!/perContract: r\.factionRep,\s*factions: k,/.test(pr)) c4.fail("progress.contractRepOf must publish the total with its k (exitplan divides)");
    if (/hasHackingFaction: \(player\.factions\?\.length/.test(pr)) c4.fail("progress.js must count HACKING-WORK factions (contractFactionCount), not any faction");
    c4.note(`cap 1, k = 3: ${r3.factionRepEach.toFixed(2)} each of ${r3.factionRep.toFixed(2)} total`);
  }
  checks.push(c4);

  // ---------------------------------------------------------------------
  const c5 = new Check("CP5", "SOLVER COVERAGE: SOLVER_TYPES is ctsolvers.js's table, every name a game type; an unsolved type pays nothing");
  {
    const { codingContractTypesMetadata } = await import("../../ctsolvers.js");
    c5.examined(codingContractTypesMetadata.length);
    const names = new Set(codingContractTypesMetadata.map((m) => m.name));
    if (names.size !== SOLVER_TYPES.size || [...names].some((n) => !SOLVER_TYPES.has(n))) c5.fail("SOLVER_TYPES is not ctsolvers.js's table");
    for (const n of SOLVER_TYPES) if (!(n in TYPE_DIFFICULTY)) c5.fail(`solver '${n}' matches no game type: findAnswer never dispatches it`);
    const cov = solverCoverage(11);
    // A pool with one type unsolvable: money scales by its share of the pool's difficulty.
    const drop = "Find All Valid Math Expressions";
    const less = new Set([...SOLVER_TYPES].filter((n) => n !== drop));
    const a = expectedReward({ totalSourceFileLevels: 11, nodeContractMoney: 1, hasHackingFaction: true, hasJob: true });
    const b = expectedReward({ totalSourceFileLevels: 11, nodeContractMoney: 1, hasHackingFaction: true, hasJob: true, solvable: less });
    const sum = DIFFICULTIES.reduce((x, y) => x + y, 0);
    if (!close(b.money / a.money, (cov.coverage === 1 ? sum - 10 : NaN) / sum)) c5.fail(`dropping ${drop} (d 10) must scale money by ${(sum - 10) / sum}, got ${b.money / a.money}`);
    if (!close(b.coverage, 29 / 30)) c5.fail("coverage with one of 30 unsolved is 29/30");
    const h = expectedReward({ totalSourceFileLevels: 11, nodeContractMoney: 1, hasHackingFaction: true, hasJob: true, successRate: 0.5 });
    if (!close(h.money, a.money / 2)) c5.fail("a 50% success rate halves the expectation");
    c5.note(`${SOLVER_TYPES.size} solvers; coverage at every cap ${cov.coverage}${cov.unsolved.length ? ` (unsolved: ${cov.unsolved})` : ""}`);
  }
  checks.push(c5);

  // ---------------------------------------------------------------------
  const c6 = new Check("CP6", "STREAM ONLY WHEN SOLVED: a stopped or silent ctauto.js realises nothing and accrues a backlog; progress.js reads it");
  {
    c6.examined(1);
    const now = Date.parse("2026-10-03T01:30:00Z");
    const stopped = { at: "2026-10-02T19:38:43.323Z", health: "stopped", solved: 2, wrong: 0, exited: true, staleSince: "2026-10-02T19:36:33.828Z", lastScanFound: 1 };
    const s1 = solverStateOf(stopped, now);
    if (s1.solving || s1.lastRunMs !== Date.parse(stopped.staleSince) || s1.successRate !== 1) c6.fail(`the exit record: ${JSON.stringify(s1)}`);
    const live = { at: "2026-10-03T01:25:00Z", health: "ok", solved: 3, wrong: 1 };
    const s2 = solverStateOf(live, now);
    if (!s2.solving || s2.successRate !== 0.75) c6.fail(`a fresh ok record solves: ${JSON.stringify(s2)}`);
    if (solverStateOf({ ...live, at: "2026-10-03T01:00:00Z" }, now).solving) c6.fail("30 minutes silent is not solving");
    if (solverStateOf(null, now).solving) c6.fail("no record is not solving");
    // Backlog accrual and payout.
    c6.examined(1);
    const base = { totalSourceFileLevels: 11, nodeContractMoney: 1, hasHackingFaction: true, hasJob: false, factions: 2 };
    const on = contractStream({ ...base, solving: true, pending: 0 });
    const off = contractStream({ ...base, solving: false, backlogSec: 6 * 3600 });
    if (!(on.moneyPerSec > 0) || off.moneyPerSec !== 0 || off.factionRepPerSec !== 0 || off.moneyVarPerSec !== 0) c6.fail("realised rates: positive while solving, zero while not");
    if (!close(off.expected.moneyPerSec, on.moneyPerSec, 1e-3)) c6.fail("the expected rate does not depend on whether it is realised (beyond the pending count)");
    if (!close(off.backlog.count, 6 * 3600 * spawnPerSec(0))) c6.fail(`6h of backlog: ${off.backlog.count} contracts vs ${6 * 3600 * spawnPerSec(0)}`);
    if (!close(off.backlog.money, off.backlog.count * on.reward.money)) c6.fail("the backlog pays count x E[R] when solved");
    if (!(off.perSec < on.perSec)) c6.fail("the backlog is pending: it lowers the spawn chance");
    // Integrated: 6h off then a solver run pays the backlog as one lump; the
    // money over the 12h equals 12h of a running solver, to the spawn-chance term.
    const total = off.backlog.money + on.moneyPerSec * 6 * 3600;
    if (!close(total, on.moneyPerSec * 12 * 3600, 1e-3)) c6.fail(`6h off + 6h on pays ${total}, a solver throughout ${on.moneyPerSec * 12 * 3600}`);
    // progress.js wiring.
    c6.examined(1);
    const pr = fs.readFileSync(path.join(REPO, "progress.js"), "utf8");
    if (!/const solver = solverStateOf\(ct\)[\s\S]{0,900}contractStream\(\{[\s\S]{0,700}solving: solver\.solving,[\s\S]{0,200}backlogSec:/.test(pr)) c6.fail("progress.js's contract forecast must read solverStateOf(/tel/ctauto.txt) and pass solving + backlogSec");
    if (!/function contractRepOf[\s\S]{0,400}solverStateOf\(ct\)\.solving/.test(pr)) c6.fail("contractRepOf must require a solving ctauto.js");
    c6.note(`6h deferred at SF 11, k 2: backlog ${off.backlog.count.toFixed(1)} contracts, $${(off.backlog.money / 1e6).toFixed(0)}m; realised $${on.moneyPerSec.toFixed(0)}/s when solving`);
  }
  checks.push(c6);

  // ---------------------------------------------------------------------
  const c7 = new Check("CP7", "THE DISTRIBUTION: moneyVarPerSec = rate x E[R^2]; plan.applyDraw draws the stream's life mean from it");
  {
    c7.examined(1);
    // E[R^2] by brute force over the mixture.
    const o = { totalSourceFileLevels: 3, nodeContractMoney: 1, hasHackingFaction: false, hasJob: false };
    const r = expectedReward(o);
    const routes = rewardRoutes({ hasHackingFaction: false, hasJob: false });
    const pool = DIFFICULTIES.filter((d) => d <= 7);
    let m2 = 0;
    for (const rt of routes) for (const d of pool) m2 += (rt.p / pool.length) * (BASE_MONEY_GAIN * d * rt.scale) ** 2;
    if (!close(r.moneySq, m2)) c7.fail(`E[R^2] ${r.moneySq} vs ${m2}`);
    const s = contractStream({ ...o, solving: true });
    if (!close(s.moneyVarPerSec, s.perSec * m2)) c7.fail("moneyVarPerSec must be rate x E[R^2]");
    // plan.applyDraw.
    c7.examined(1);
    const plan = await import("../../plan.js");
    const inputs = { incomePerSec: 1000 + s.moneyPerSec, flatIncomePerSec: s.moneyPerSec, contractMoneyPerSec: s.moneyPerSec, contractMoneyVarPerSec: s.moneyVarPerSec, cycleHours: 24 };
    const sd = Math.sqrt(s.moneyVarPerSec / (24 * 3600));
    const up = plan.applyDraw(inputs, { zContract: 1 });
    if (!close(up.incomePerSec - inputs.incomePerSec, sd)) c7.fail(`z = 1 moves income by ${up.incomePerSec - inputs.incomePerSec}, want ${sd}`);
    if (!close(up.flatIncomePerSec - inputs.flatIncomePerSec, sd)) c7.fail("the flat income carries the same draw");
    const dn = plan.applyDraw(inputs, { zContract: -50 });
    if (!close(dn.incomePerSec, 1000)) c7.fail("a deep draw takes contract money to zero, not below");
    const none = plan.applyDraw({ incomePerSec: 1000, cycleHours: 24 }, { zContract: 1 });
    if (none.incomePerSec !== 1000) c7.fail("inputs without the stream are untouched");
    const draws = plan.makeDraws({ drift: { a: 3, b: 0.1 }, jitter: { a: 3, b: 0.01 }, gymSdLn: 0.1 }, 3, 7);
    if (!draws.every((d) => Number.isFinite(d.zContract))) c7.fail("makeDraws must carry zContract");
    const pr = fs.readFileSync(path.join(REPO, "progress.js"), "utf8");
    if (!/contractMoneyVarPerSec: contractNow\.moneyVarPerSec/.test(pr)) c7.fail("exitInputsBaseOf must publish the stream's variance");
    c7.note(`BN5 sweep state: $${s.moneyPerSec.toFixed(0)}/s, sd of a 24h life's mean $${sd.toFixed(0)}/s (cv ${(sd / s.moneyPerSec).toFixed(2)})`);
  }
  checks.push(c7);

  // ---------------------------------------------------------------------
  const c8 = new Check("CP8", "ctauto.js LOGS each reward (type, difficulty, route, amount) parsed from attempt()'s string, every message the game writes");
  {
    c8.examined(4);
    const src = fs.readFileSync(path.join(GAME, "src/PersonObjects/Player/PlayerObjectGeneralMethods.ts"), "utf8");
    // The four message shapes, still the game's.
    for (const [re, what] of [[/return `Gained \$\{repGain\} faction reputation for \$\{randomFaction\}`/, "faction"], [/`Gained \$\{gainPerFaction\} reputation for each of the following factions: \$\{factionsThatAllowHacking\.join\(\s*", ",?\s*\)\}`/, "factionAll"], [/return `Gained \$\{repGain\} company reputation for \$\{randomCompany\}`/, "company"], [/return `Gained \$\{formatMoney\(moneyGain\)\}`/, "money"]]) {
      if (!re.test(src)) c8.fail(`the game's ${what} message changed: parseRewardText may not read it`);
    }
    const cases = [
      ["Gained $2.778m", "Find Largest Prime Factor", "money", 2.778e6, 1 / 27],
      ["Gained 833.3333333333334 faction reputation for NiteSec", "Find Largest Prime Factor", "faction", 833.3333333333334, 1 / 3],
      ["Gained 92 reputation for each of the following factions: NiteSec, CyberSec", "Find Largest Prime Factor", "factionAll", 92, 184 / 2500],
      ["Gained 1333.3333333333333 company reputation for ECorp", "Find Largest Prime Factor", "company", 1333.3333333333333, 1 / 3],
      ["Gained $1.050b", "Square Root", "money", 1.05e9, 1.05e9 / (75e6 * 5)],
    ];
    for (const [s, t, route, amount, scale] of cases) {
      const p = parseRewardText(s, t);
      if (p.route !== route || !close(p.amount, amount, 1e-6) || !close(p.scale, scale, 1e-3)) c8.fail(`${s}: ${JSON.stringify(p)}`);
    }
    if (parseRewardText("No reward for this contract", "Square Root").route !== "unknown") c8.fail("an unrecognised string is 'unknown'");
    const ct = fs.readFileSync(path.join(REPO, "ctauto.js"), "utf8");
    if (!/totals\.log\.push\(\{ at: new Date\(\)\.toISOString\(\), \.\.\.parseRewardText\(reward, c\.type\) \}\)/.test(ct)) c8.fail("ctauto.js must log parseRewardText(reward, type) per reward");
  }
  checks.push(c8);

  return checks;
}
