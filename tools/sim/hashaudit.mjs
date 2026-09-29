// WHAT A HASH IS WORTH ON THE EXIT — the BitNode 9 hash audit, every answer a
// with-vs-without exit simulation on the published inputs (read-only).
//
//   node tools/sim/hashaudit.mjs [--inputs exitinputs.json --plan plan.json] [--snap DIR] [--factions a,b,c]
//
// Inputs default to the live /tel/exitinputs.txt and /tel/plan.txt over the
// control port. --snap DIR (snap-*.json + state.json saved from /tel) adds the
// pre-install section: the planner's own batch at W re-planned with more
// reputation at the hacking-work factions (augplan.planPurchases, the channel
// weights the gate published). --factions lists the joined factions (default:
// the live save's).
//
// CALIBRATION: the CHECK line reproduces the plan's committed point from the
// unmodified inputs (as liveexit.mjs does); every other number is the exit
// simulator's, with its calibration and nothing more. The hash mechanics are
// the game's (tools/test/hashvalue.test.mjs [HV1]).
import "../test/gameresolve.mjs";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../test/gameresolve.mjs";

const X = await import(path.join(REPO_ROOT, "exitplan.js"));
const P = await import(path.join(REPO_ROOT, "plan.js"));
const L = await import(path.join(REPO_ROOT, "lifeplan.js"));
const CP = await import(path.join(REPO_ROOT, "contractplan.js"));
const HP = await import(path.join(REPO_ROOT, "hacknetplan.js"));
const HS = await import(path.join(REPO_ROOT, "hashplan.js"));

const argv = process.argv.slice(2);
const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
async function rpc(method, params) {
  const r = await fetch("http://localhost:12526/rpc", { method: "POST", body: JSON.stringify({ method, params }) });
  return (await r.json()).result;
}
const tel = async (f) => JSON.parse(await rpc("getFile", { server: "home", filename: f }));
const ei = arg("--inputs") ? JSON.parse(fs.readFileSync(arg("--inputs"), "utf8")) : await tel("/tel/exitinputs.txt");
const plan = arg("--plan") ? JSON.parse(fs.readFileSync(arg("--plan"), "utf8")) : await tel("/tel/plan.txt");
const snapDir = arg("--snap");
const factions = arg("--factions")
  ? arg("--factions").split(",")
  : snapDir && fs.existsSync(path.join(snapDir, "state.json"))
    ? JSON.parse(fs.readFileSync(path.join(snapDir, "state.json"), "utf8")).factions
    : (await (await fetch("http://localhost:12526/state")).json()).factions;
const I = ei.inputs;
const basis = P.basisOf(plan.decisions?.install ?? null, Date.parse(ei.at));
const w = Math.max(0, basis?.waitH ?? 0);
const g = basis?.gains ?? null;
const run = (inp, gains = g) => X.bestExitPolicy({ ...inp, eRep: ei.eRep, eBudget: ei.eBudget, firstInstallH: w, ...(gains ? { installGains: gains, nextInstallGain: gains.hacking ?? null } : {}) }, 400, 1).best;
const H = (x) => `${x.toFixed(3)}h`;
const D = (x, y) => `${y - x >= 0 ? "+" : ""}${(y - x).toFixed(3)}h`;

const base = run(I);
const pt = plan.decisions?.install?.pointH;
console.log(`exit inputs ${ei.at}; W ${ei.W?.toFixed?.(2)}h, money at W $${((ei.moneyAtW ?? 0) / 1e12).toFixed(2)}t; committed wait ${w.toFixed(2)}h`);
console.log(`CHECK the plan's committed point ${pt}h vs this replay ${H(base.hours)} (${typeof pt === "number" ? ((base.hours / pt - 1) * 100).toFixed(2) : "?"}%)`);
for (const l of base.legs) console.log(`   ${l.leg.padEnd(26)} ${l.hours.toFixed(2).padStart(6)}h  ${(l.detail ?? "").slice(0, 100)}`);

// THE CONTRACT STREAM as progress.js now publishes it (contractRepOf): the final
// life's hacking-work factions = this life's + Daedalus when not joined.
const streams = L.freshHacknetStreams(I, 48);
const rw = CP.expectedReward({ totalSourceFileLevels: 9, nodeContractMoney: 1, hasHackingFaction: true, hasJob: false });
const k = CP.contractFactionCount(factions) + (factions.includes("Daedalus") ? 0 : 1);
const contractRep = { perContract: rw.factionRep, factions: k, hashCum: streams.hashCum };
const after = run({ ...I, contractRep });
console.log(`\nEXIT BEFORE (published inputs, hashes sold): ${H(base.hours)}   AFTER (final window's hashes -> contracts, k=${k}): ${H(after.hours)} (${D(base.hours, after.hours)})`);
console.log(`   ${after.legs.find((l) => l.leg === "exit reputation")?.detail}`);

// Q1 — hashes sold, and hacknet as an investment.
console.log("\nQ1  HASHES AS MONEY, HACKNET AS AN INVESTMENT");
const r0 = I.capitalReturnPerSec * 3600;
console.log(`  trader r0 ${(r0 * 100).toFixed(1)}%/h (1/r = ${(1 / r0).toFixed(2)}h payback bar on a long horizon)`);
const hn = await tel("/tel/hacknet.txt").catch(() => null);
if (hn?.nodes) {
  const n = hn.nodes;
  const fleet = Array.from({ length: n }, () => ({ level: hn.levels / n, ram: hn.ram / n, cores: hn.cores / n, ramUsed: 0 }));
  const cands = HP.serverCandidates(fleet, hn.model.mults, hn.model.nodeMoney, HP.DOLLARS_PER_HASH).sort((a, b) => a.paybackH - b.paybackH);
  const seen = new Set();
  for (const c of cands) if (!seen.has(c.kind)) {
    seen.add(c.kind);
    console.log(`  live fleet (${n} x level ${fleet[0].level}, ${fleet[0].ram}GB, ${fleet[0].cores} cores): next ${c.kind.padEnd(5)} $${(c.cost / 1e6).toFixed(1)}m, +${c.hashGainPerSec.toFixed(3)} hashes/s, payback ${c.paybackH.toFixed(2)}h at the sell floor`);
  }
  if (ei.W > 0) {
    const b = HP.planHacknetBatch({ servers: fleet, mults: hn.model.mults, nodeMoney: hn.model.nodeMoney, W: ei.W, capital: { capitalReturnPerSec: I.capitalReturnPerSec, capitalCap: I.capitalCap, capitalScaleW: I.capitalScaleW, capitalShape: I.capitalShape, capitalWarmupH: I.capitalWarmupH, money: I.money } });
    console.log(`  the batch planner at W=${ei.W.toFixed(2)}h against the trader's book: ${b.items.length} purchase(s), $${(b.cost / 1e6).toFixed(1)}m (${b.stoppedBy})`);
  }
}
const hps = hn?.hashesPerSec ?? 9.1;
const sellAll = HS.exitAfter({ ...ei, finalWindow: false }, { money: hps * 3600 * (ei.W ?? 0) * HP.DOLLARS_PER_HASH }, { bestExitPolicy: X.bestExitPolicy, spendRuns: X.spendRuns });
const keep = HS.exitAfter({ ...ei, finalWindow: false }, { money: 0 }, { bestExitPolicy: X.bestExitPolicy, spendRuns: X.spendRuns });
if (typeof sellAll === "number" && typeof keep === "number") console.log(`  every hash until W sold (${hps.toFixed(2)}/s, $${((hps * 3600 * (ei.W ?? 0) * HP.DOLLARS_PER_HASH) / 1e9).toFixed(1)}b now): exit ${H(sellAll)} vs none sold ${H(keep)} (${D(keep, sellAll)}) — hashspend's own pricing (the published money ladder at W)`);
console.log(`  final window: fleet as modelled ${H(base.hours)}; no fleet ${H(run({ ...I, freshHacknet: undefined }).hours)}; a $1e12/s fleet from the window's start ${H(run({ ...I, freshHacknet: [{ atH: 0, perSec: 1e12 }] }).hours)}`);
for (const Lh of [8, 16, 24, 48]) console.log(`  final window's rebuild planned over ${String(Lh).padStart(2)}h: exit ${H(run({ ...I, freshHacknet: L.freshHacknetFlow(I, Lh) }).hours)}`);
const cum2 = streams.hashCum.map(([h, x]) => [h, 2 * x]);
console.log(`  with contracts: the window's fleet doubled (hashes x2) ${H(run({ ...I, contractRep: { ...contractRep, hashCum: cum2 } }).hours)} vs ${H(after.hours)}`);

// Q2 — study.
console.log("\nQ2  IMPROVE STUDYING");
const sl = await tel("/tel/sleeve.txt").catch(() => null);
const s1 = sl?.expToPlayerHackingIfStudying ?? 63.57;
console.log(`  the exp farm: ${I.expPerSec.toFixed(0)} exp/s at level ${I.hacking} (rises with the level); the fleet studying: ${s1.toFixed(1)} exp/s at x1; the player at ZB Algorithms: 16 x hacking_exp x study mult (slot-bound — the slot binds the final window)`);
for (const n of [0, 10, 30, 50]) {
  const x = s1 * (1 + 0.2 * n);
  const r = run({ ...I, expPerSec: I.expPerSec + x, expFlatPerSec: (I.expFlatPerSec ?? 0) + x });
  console.log(`  sleeves study, Improve Studying ${String(n).padStart(2)} (${HS.upgradeCost("Improve Studying", 0, n) ?? 0} hashes, +${x.toFixed(0)} exp/s flat): exit ${H(r.hours)} (${D(base.hours, r.hours)})`);
}

// Q3 — reputation.
console.log("\nQ3  REPUTATION");
console.log(`  one generated contract: ${rw.factionRep.toFixed(0)} faction rep expected (difficulty ${rw.meanDifficulty.toFixed(2)}), shared over the joined hacking-work factions`);
for (const kk of [k, 4, 2, 1]) console.log(`  final window's hashes -> contracts, ${kk} faction(s) sharing: exit ${H(run({ ...I, contractRep: { ...contractRep, factions: kk } }).hours)}`);
console.log(`  Daedalus favor ${I.exitFavor} (donations need ${I.favorToDonate}): the leg is ground; a banked 150 (x2.5 rate, donations open) would be ${H(run({ ...I, repPerSec: I.repPerSec * 2.5 }).hours)} before the life it costs — not simulated`);

// Q4 — the batcher's upgrades.
console.log("\nQ4  INCREASE MAXIMUM MONEY / REDUCE MINIMUM SECURITY");
for (const m of [1.02, 1.1, 1.5]) console.log(`  script income x${m} all node: exit ${H(run({ ...I, incomePerSec: I.incomePerSec * m }).hours)}`);

// Q5 — capacity.
console.log("\nQ5  HASH CAPACITY");
for (const [name, lv] of [["Improve Studying", 10], ["Improve Studying", 30], ["Generate Coding Contract", 22], ["Generate Coding Contract", 100]]) console.log(`  ${name} level ${lv} -> ${lv + 1}: ${HS.upgradeCost(name, lv, 1)} hashes (capacity ${hn?.hashCap ?? "?"}; 32 x 2^cache per server, cache $${(HP.cacheCost(1, 1) / 1e6).toFixed(1)}m for level 2)`);

// Pre-install: the planner's batch at W with more rep at the hacking-work factions.
if (snapDir) {
  const A = await import(path.join(REPO_ROOT, "augplan.js"));
  const rd = (f) => JSON.parse(fs.readFileSync(path.join(snapDir, `${f}.json`), "utf8"));
  const gate = rd("installgate");
  const cat = rd("snap-catalog").data.augs, pr = rd("snap-augprice").data, rep = rd("snap-rep").data, stats = rd("snap-augstats").data.stats, pre = rd("snap-prereq").data.prereq, own = rd("snap-owned").data;
  const all = new Set(own.purchased ?? own.owned);
  const gangFac = ei.gainsByGangRep?.faction ?? null;
  const offers = [];
  for (const f of factions) for (const a of cat[f] ?? []) if (!all.has(a) || a === "NeuroFlux Governor") offers.push({ name: a, faction: f, baseCost: pr.price[a], repReq: pr.repReq[a], factionRep: rep.rep[f], mults: stats[a], prereqs: pre[a], favor: rep.favor[f], nfgLevel: 0 });
  const gangAtW = ei.gainsByGangRep?.rows?.at(-1)?.rep ?? 0;
  const gainsOf = (p) => {
    const by = new Map(offers.map((o) => [o.name, o]));
    const prod = (ks) => p.buy.reduce((acc, b) => ks.reduce((h, key) => h * (by.get(b.name)?.mults?.[key] > 0 ? by.get(b.name).mults[key] : 1), acc), 1);
    return { hacking: prod(["hacking"]), rep: prod(["faction_rep"]), income: prod(["hacking_money", "hacking_chance", "hacking_speed"]), exp: prod(["hacking_exp"]) };
  };
  const replan = (d) => A.planPurchases({ offers: offers.map((o) => (CP.HACKING_WORK_FACTIONS.has(o.faction) ? { ...o, factionRep: o.factionRep + d } : o.faction === gangFac ? { ...o, factionRep: Math.max(o.factionRep, gangAtW) } : o)), money: ei.moneyAtW, r: 1.9, nodeMoneyMult: 1, owned: own.owned, soaOwned: 0, ticketsWanted: Math.max(0, 30 - own.owned.length), channelWeights: gate.objective?.weights ?? null });
  console.log(`\nPRE-INSTALL: the batch at W (money $${(ei.moneyAtW / 1e12).toFixed(2)}t, ${gangFac} rep ${Math.round(gangAtW)} as the plan projects), re-planned with more rep at each hacking-work faction`);
  const p0 = replan(0);
  const T0 = run(I, gainsOf(p0)).hours;
  for (const d of [0, 5e3, 10e3, 20e3, 50e3, 200e3]) {
    const p = replan(d);
    const gg = gainsOf(p);
    console.log(`  +${String(d).padStart(6)} rep: hacking x${gg.hacking.toFixed(3)}, exit ${H(run(I, gg).hours)} (${D(T0, run(I, gg).hours)})${d ? `  adds ${p.buy.map((b) => b.name).filter((x) => !p0.buy.some((b) => b.name === x)).join(", ") || "nothing"}` : ""}`);
  }
  console.log(`  (the ladder holds today's reputation, not W's: the faction the player works reaches its next augmentation on its own)`);
}
