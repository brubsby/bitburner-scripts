// [HS] BitNode 9 / hacknet SERVERS — the hash economy against the game's own
// source, and the BN9 breakages the audit found, each pinned so that putting
// the defect back turns this red.
//
//   HS1  hacknet-server formulas == Hacknet/formulas/HacknetServers.ts (bundle)
//   HS2  the hash-upgrade catalogue and costs == HashUpgrades (bundle)
//   HS3  the hacking/growth formulas the min-security response uses == Hacking.ts,
//        grow.ts; Server.changeMinimumSecurity / changeMaximumMoney; homecost
//        == getUpgradeHomeRamCost in every node
//   HS4  the spend decision IS exit(with X) - exit(same hashes sold), on one
//        record; the floor when the record is unusable; save / capacity-bound
//   HS5  a hacknet server's RAM is not free: the placers honour the policy
//   HS6  CloudServerLimit 0: buyserv refuses by name, no $/GB published
//   HS7  hacknet money reaches the exit simulation (lifeIncome, moneyAtW)
//   HS8  every nextHomeUpgrade call carries the node's HomeComputerRamCost
//   HS9  hacknet.js prices servers (no refusal), Netburners by the server model
//
// The game bundle is tools/sim/bn9/ (its own entry; the shared build.mjs is
// not touched).

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const hp = await import("../../hacknetplan.js");
const hs = await import("../../hashplan.js");
const xp = await import("../../exitplan.js");
const hc = await import("../../homecost.js");
const bnm = await import("../../bitNodeMultipliers.js");

const src = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8");
/** Source with comments stripped, so a check cannot be satisfied by prose. */
const code = (f) => src(f).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
const close = (a, b, rel = 1e-9) => (a === b) || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b)));

const MULTS1 = { hacknet_node_money: 1, hacknet_node_purchase_cost: 1, hacknet_node_level_cost: 1, hacknet_node_ram_cost: 1, hacknet_node_core_cost: 1 };

export async function run() {
  const checks = [];
  let G = null;
  let setBitNode = null;
  try {
    const m = await import("../sim/bn9/game.mjs");
    G = m.default;
    setBitNode = m.setBitNode;
  } catch (e) {
    const c = new Check("HS0", "the tools/sim/bn9 game bundle loads");
    c.fail("could not load tools/sim/bn9/game.mjs — the formula checks cannot run, which is NOT a pass", String(e).slice(0, 400));
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  if (G) {
    const c = new Check("HS1", "hacknet-server rate and cost formulas == the game's (formulas/HacknetServers.ts), in BN1, BN8 and BN9");
    for (const [k, v] of Object.entries(hp.HS)) {
      c.examined(1);
      if (G.HacknetServerConstants[k] !== v) c.fail(`HS.${k} = ${v}, game ${G.HacknetServerConstants[k]}`);
    }
    for (const k of Object.keys(G.HacknetServerConstants)) if (!(k in hp.HS)) c.fail(`HacknetServerConstants.${k} is not mirrored in hacknetplan.HS`);
    let n = 0;
    for (const bn of [1, 8, 9]) {
      setBitNode(bn);
      const nodeMoney = bnm.bitNodeMults(bn).HacknetNodeMoney;
      for (const level of [1, 100, 300]) for (const maxRam of [1, 64, 8192]) for (const cores of [1, 10, 128]) for (const used of [0, 0.5]) {
        const want = G.HServerF.calculateHashGainRate(level, used * maxRam, maxRam, cores, 1.7);
        const got = hp.hashRate(level, used * maxRam, maxRam, cores, 1.7, nodeMoney);
        n++;
        if (!close(want, got)) c.fail(`BN${bn} hashRate(${level}, ${used * maxRam}/${maxRam}GB, ${cores} cores): game ${want}, ours ${got}`);
      }
    }
    setBitNode(9);
    for (const [ours, theirs, starts] of [
      [hp.serverLevelCost, G.HServerF.calculateLevelUpgradeCost, [1, 100, 299, 300]],
      [hp.serverRamCost, G.HServerF.calculateRamUpgradeCost, [1, 64, 4096, 8192]],
      [hp.serverCoreCost, G.HServerF.calculateCoreUpgradeCost, [1, 10, 127, 128]],
    ]) {
      for (const s of starts) for (const extra of [1, 3]) for (const mult of [1, 0.5]) {
        n++;
        const w = theirs(s, extra, mult);
        const g = ours(s, extra, mult);
        if (!close(w, g)) c.fail(`${ours.name}(${s}, ${extra}, ${mult}): game ${w}, ours ${g}`);
      }
    }
    for (const s of [1, 5, 14, 15]) for (const extra of [1, 2]) {
      n++;
      if (!close(G.HServerF.calculateCacheUpgradeCost(s, extra), hp.cacheCost(s, extra))) c.fail(`cacheCost(${s}, ${extra}) diverges`);
    }
    for (const k of [1, 2, 20, 21]) {
      n++;
      if (!close(G.HServerF.calculateServerCost(k, 0.8), hp.serverCost(k, 0.8))) c.fail(`serverCost(${k}) diverges: game ${G.HServerF.calculateServerCost(k, 0.8)}`);
    }
    c.examined(n);
    c.note(`${n} evaluations against the game's functions (hash rate in BN1/BN8/BN9 — BN8's HacknetNodeMoney 0 hashes nothing — and five cost curves)`);
    const entry = hp.hashRate(100, 0, 1, 10, 1, bnm.bitNodeMults(9).HacknetNodeMoney);
    c.note(`BN9 entry server (level 100, 1GB, 10 cores, Prestige.ts:329-338): ${entry.toFixed(3)} hashes/s = $${((entry / 4) * 1e6).toFixed(0)}/s at the sell floor`);
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  if (G) {
    const c = new Check("HS2", "the hash-upgrade catalogue and its costs == HashUpgrades (HashUpgradesMetadata.tsx / HashUpgrade.getCost)");
    const names = Object.keys(G.HashUpgrades);
    for (const name of names) {
      c.examined(1);
      const u = hs.UPGRADES[name];
      const g = G.HashUpgrades[name];
      if (!u) {
        c.fail(`${name} is in the game and missing from hashplan.UPGRADES — the spender cannot even say it skipped it`);
        continue;
      }
      if (u.value !== g.value) c.fail(`${name}: value ${u.value} vs game ${g.value}`);
      for (const lvl of [0, 1, 7, 40]) for (const cnt of [1, 3]) if (!close(hs.upgradeCost(name, lvl, cnt), g.getCost(lvl, cnt))) c.fail(`${name}: cost at level ${lvl} x${cnt} ${hs.upgradeCost(name, lvl, cnt)} vs game ${g.getCost(lvl, cnt)}`);
    }
    for (const name of Object.keys(hs.UPGRADES)) if (!names.includes(name)) c.fail(`hashplan.UPGRADES carries ${name}, which the game does not have`);
    // Sell for Money is the floor every other hash is priced against.
    if (hp.DOLLARS_PER_HASH !== G.HashUpgrades["Sell for Money"].value / G.HashUpgrades["Sell for Money"].cost) c.fail("DOLLARS_PER_HASH is not the game's value/cost of Sell for Money");
    // Every upgrade is either simulated by hashspend.js or named as not simulated.
    const spendSrc = code("hashspend.js");
    for (const name of names) {
      if (name === "Sell for Money" || hs.NOT_SIMULATED[name]) continue;
      if (!spendSrc.includes(`'${name}'`)) c.fail(`${name} is neither priced by hashspend.js nor listed in hashplan.NOT_SIMULATED — a silent gap in the search`);
    }
    // HashManager's multiplier: 1 + value x level / 100.
    const m = new G.HashManager();
    m.upgrades["Improve Gym Training"] = 3;
    if (!close(m.getTrainingMult(), hs.trainingMultAt(3))) c.fail(`trainingMultAt(3) ${hs.trainingMultAt(3)} vs HashManager ${m.getTrainingMult()}`);
    c.note(`${names.length} upgrades matched on name, value and eight cost points each; $${hp.DOLLARS_PER_HASH}/hash floor`);
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  if (G) {
    const c = new Check("HS3", "the min-security / max-money response and the home RAM price use the game's own formulas");
    setBitNode(1);
    let n = 0;
    const person = (hacking) => ({ skills: { hacking, intelligence: 0 }, mults: { hacking_money: 1.3, hacking_chance: 1.1, hacking_speed: 1.2, hacking_grow: 1.4 } });
    for (const [req, sec, hack, growth] of [[1, 1, 10, 10], [300, 7.5, 900, 40], [900, 25, 2500, 75], [1200, 99, 5000, 100]]) {
      const s = new G.Server({ hostname: `t${n}`, requiredHackingSkill: req, hackDifficulty: sec, serverGrowth: growth, adminRights: true });
      s.hasAdminRights = true;
      s.requiredHackingSkill = req;
      s.hackDifficulty = sec;
      s.serverGrowth = growth;
      const p = person(hack);
      n++;
      if (!close(G.calculateHackingTime(s, p), hs.hackTimeSec(req, sec, hack, 1.2))) c.fail(`hackTimeSec(${req}, ${sec}, ${hack}) ${hs.hackTimeSec(req, sec, hack, 1.2)} vs game ${G.calculateHackingTime(s, p)}`);
      if (!close(G.calculatePercentMoneyHacked(s, p), hs.hackPercent(req, sec, hack, 1.3))) c.fail(`hackPercent diverges at sec ${sec}`);
      if (!close(G.calculateHackingChance(s, p), hs.hackChanceAt(req, sec, hack, 1.1))) c.fail(`hackChanceAt diverges at sec ${sec}`);
      if (!close(G.calculateServerGrowthLog(s, 1, p, 1), hs.growLogAt(sec, growth, 1.4, 1))) c.fail(`growLogAt diverges at sec ${sec}: game ${G.calculateServerGrowthLog(s, 1, p, 1)}, ours ${hs.growLogAt(sec, growth, 1.4, 1)}`);
    }
    for (const [minSec, count] of [[30, 1], [3, 5], [1.01, 3], [1, 1]]) {
      const s = new G.Server({ hostname: "ms" });
      s.minDifficulty = minSec;
      s.changeMinimumSecurity(0.98 ** count, true);
      n++;
      if (!close(s.minDifficulty, hs.minSecAfter(minSec, count))) c.fail(`minSecAfter(${minSec}, ${count}) ${hs.minSecAfter(minSec, count)} vs game ${s.minDifficulty}`);
    }
    for (const [money, count] of [[1e9, 1], [2.5e6, 10], [9.99e12, 3], [5e13, 4]]) {
      const s = new G.Server({ hostname: "mm" });
      s.moneyMax = money;
      for (let i = 0; i < count; i++) s.changeMaximumMoney(1.02);
      n++;
      if (!close(s.moneyMax, hs.maxMoneyAfter(money, count))) c.fail(`maxMoneyAfter(${money}, ${count}) ${hs.maxMoneyAfter(money, count)} vs game ${s.moneyMax} (softcap above $10t)`);
    }
    // The batch response: +2% money is +2% income exactly (grow regrows a
    // fraction); lower security is strictly more income per RAM-second.
    const plan = { h: 60, g: 400, w1: 3, w2: 33 };
    const who = { hacking: 1500, mults: person(1500).mults };
    const before = { required: 800, minSec: 20, serverGrowth: 60, moneyMax: 2e9 };
    const rMM = hs.batchIncomeRatio(plan, before, { ...before, moneyMax: hs.maxMoneyAfter(2e9, 1) }, who);
    const rMS = hs.batchIncomeRatio(plan, before, { ...before, minSec: hs.minSecAfter(20, 1) }, who);
    const rMSt = hs.batchIncomeRatio(plan, before, { ...before, minSec: hs.minSecAfter(20, 1) }, who, { ramBound: false });
    n += 3;
    if (!close(rMM, 1.02)) c.fail(`+2% max money must be +2% batch income, got x${rMM}`);
    if (!(rMS > 1 && rMS > rMSt)) c.fail(`lower min security must raise RAM-bound income more than pipeline-bound income: ${rMS} vs ${rMSt}`);
    c.note(`one Reduce Minimum Security at sec 20: batch income x${rMS.toFixed(4)} RAM-bound, x${rMSt.toFixed(4)} pipeline-bound`);
    // Home RAM, in every node the multiplier table carries (not BN12: its
    // value is level-dependent and bitNodeMults(12) is null by design).
    for (const bn of [1, 2, 3, 4, 5, 9, 10, 13, 14]) for (const ram of [32, 1024, 2 ** 20]) {
      setBitNode(bn);
      const want = G.getUpgradeHomeRamCost.call({ getHomeComputer: () => ({ maxRam: ram }) });
      const got = hc.ramUpgradeCost(ram, bnm.bitNodeMults(bn).HomeComputerRamCost);
      n++;
      if (!close(want, got)) c.fail(`BN${bn} home RAM at ${ram}GB: game $${want}, homecost $${got}`);
    }
    const unread = hc.nextHomeUpgrade(8, 8, undefined);
    if (!unread?.assumed) c.fail("an unreadable HomeComputerRamCost must be flagged on the result, not silently x1");
    c.examined(n);
    c.note(`${n} evaluations; BN9 home RAM is x${bnm.bitNodeMults(9).HomeComputerRamCost}, which homecost.js used to leave out`);
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("HS4", "a hash spend is decided by exit(with X) - exit(same hashes sold), on one record — never by a rule");
    const now = Date.parse("2026-09-25T12:00:00Z");
    const inputs = {
      money: 2e9, incomePerSec: 2e5, lifeIncome: 7e4, hacking: 900, hackingExp: xp.expForLevel(900, 1.2), hackingMult: 1.2, expPerSec: 3000,
      repPerSec: 30, exitRep: 0, exitFavor: 0, cycleHours: 3, multGainPerCycle: 1.3, exitLevel: 6000, joinMoney: 100e9, terminalRep: 2.5e6,
    }
    const ladder = [0, 0.5, 1, 1.5, 2].map((f) => ({ money: 5e9 * f, gains: { hacking: 1 + 0.4 * f, rep: 1 + 0.1 * f, income: 1 + 0.2 * f } }));
    const rec = { at: new Date(now - 60e3).toISOString(), lastAugReset: 7, inputs, W: 2, finalWindow: false, moneyAtW: 5e9, gainsByMoney: ladder, eRep: 0.3, eBudget: 0.4 };
    const fns = { bestExitPolicy: xp.bestExitPolicy, spendRuns: xp.spendRuns };
    // Independent recomputation of one comparison, built from exitplan only.
    const indep = (money, inc) => {
      const runs = xp.spendRuns(rec, -(money + inc * rec.W * 3600), { allowGain: true });
      return xp.bestExitPolicy({ ...runs.with, eRep: rec.eRep, eBudget: rec.eBudget }, runs.max, runs.min).best.hours;
    };
    const big = { name: "Increase Maximum Money", target: "phantasy", cost: 50, effect: { incomePerSec: 5e5 } };
    const nothing = { name: "Improve Studying", target: null, cost: 50, effect: {} };
    const d = hs.decideHashSpend({ hashes: 120, capacity: 1024, record: rec, lastAugReset: 7, now, fns, options: [nothing, big] });
    c.examined(4);
    const eBig = d.exits?.find((x) => x.name === big.name);
    const eNo = d.exits?.find((x) => x.name === nothing.name);
    if (!eBig || !eNo) c.fail("every priced option must appear in exits", JSON.stringify(d).slice(0, 400));
    else {
      const want = indep(0, 5e5) - indep((50 / 4) * 1e6, 0);
      if (!close(eBig.deltaH, want, 1e-9)) c.fail(`deltaH must be exit(with) - exit(sell the same 50 hashes): ${eBig.deltaH} vs ${want}`);
      if (!(eNo.deltaH >= 0)) c.fail(`an upgrade with no simulated effect cannot beat selling: deltaH ${eNo.deltaH}`);
      c.note(`+$500k/s until W=2h: exit ${eBig.withH.toFixed(3)}h vs ${eBig.sellH.toFixed(3)}h selling 50 hashes (${(eBig.deltaH * 60).toFixed(1)} min)`);
    }
    if (d.action !== "buy" || d.name !== big.name) c.fail(`the income upgrade shortens the exit and is affordable: must buy it, got ${d.action} ${d.name ?? ""}`);
    // Only the no-effect option: sell everything.
    const d0 = hs.decideHashSpend({ hashes: 120, capacity: 1024, record: rec, lastAugReset: 7, now, fns, options: [nothing] });
    if (d0.action !== "sell" || d0.count !== 30) c.fail(`with nothing that beats selling, every hash is sold (30 x 4): got ${d0.action} ${d0.count}`);
    // Too few hashes but within capacity: save. Beyond capacity: sell, and say so.
    const dSave = hs.decideHashSpend({ hashes: 20, capacity: 1024, record: rec, lastAugReset: 7, now, fns, options: [big] });
    if (dSave.action !== "save") c.fail(`a winning upgrade the capacity can hold is saved for: got ${dSave.action}`);
    const dCap = hs.decideHashSpend({ hashes: 20, capacity: 40, record: rec, lastAugReset: 7, now, fns, options: [big] });
    if (dCap.action !== "sell" || !dCap.capacityBound) c.fail(`a winner above capacity must sell AND publish capacityBound (hacknet.js buys cache on it): got ${JSON.stringify(dCap).slice(0, 200)}`);
    // An unusable record: the floor, named.
    for (const [bad, why] of [[{ ...rec, lastAugReset: 8 }, "another life"], [{ ...rec, at: new Date(now - 3600e3).toISOString() }, "stale"], [null, "absent"]]) {
      const f = hs.decideHashSpend({ hashes: 120, capacity: 1024, record: bad, lastAugReset: 7, now, fns, options: [big] });
      c.examined(1);
      if (f.action !== "sell" || f.decidedBy !== "floor") c.fail(`a ${why} record must sell at the floor, never buy on a guess: got ${f.action}/${f.decidedBy}`);
    }
    // Final window: exp and gym effects act; money is money in hand.
    const fin = { ...rec, finalWindow: true, W: null };
    const study = { name: "Improve Studying", target: null, cost: 50, effect: { expPerSec: 5000 * 1.2 } };
    const dStudy = hs.decideHashSpend({ hashes: 120, capacity: 1024, record: fin, lastAugReset: 7, now, fns, options: [study], baseEffect: { expPerSec: 5000 } });
    const eS = dStudy.exits?.[0];
    const wS = xp.bestExitPolicy({ ...inputs, eRep: 0.3, eBudget: 0.4, expPerSec: inputs.expPerSec + 6000 }, 0, 0).best.hours;
    const sS = xp.bestExitPolicy({ ...inputs, eRep: 0.3, eBudget: 0.4, money: inputs.money + 12.5e6, expPerSec: inputs.expPerSec + 5000 }, 0, 0).best.hours;
    c.examined(1);
    if (!eS || !close(eS.deltaH, wS - sS, 1e-9)) c.fail(`final-window study: deltaH must be exit(fleet exp x1.2) - exit(fleet exp x1 + the sale), got ${eS?.deltaH} vs ${wS - sS}`);
    // spendRuns refuses a windfall unless asked: an old caller's sign error stays loud.
    if (xp.spendRuns(rec, -1) !== null) c.fail("spendRuns must refuse a negative spend without allowGain");
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("HS5", "a hacknet server's RAM costs hashes: batch/seed use it only on a fresh allowing policy; boot, watchdog and act place there last");
    const now = Date.now();
    const pol = (allow, ageMs = 0) => JSON.stringify({ at: new Date(now - ageMs).toISOString(), ramPolicy: { "hacknet-server-0": { allow } } });
    const cases = [
      ["n00dles", null, true],
      ["home", "garbage", true],
      ["hacknet-server-0", pol(true), true],
      ["hacknet-server-0", pol(false), false],
      ["hacknet-server-0", pol(true, 3600e3), false],
      ["hacknet-server-0", null, false],
      ["hacknet-server-0", "{not json", false],
      ["hacknet-server-1", pol(true), false],
    ];
    for (const [h, t, want] of cases) {
      c.examined(1);
      if (hp.hacknetHostAllowed(h, t, now) !== want) c.fail(`hacknetHostAllowed(${h}, ${t ? t.slice(0, 40) : t}) must be ${want}`);
    }
    // The policy itself: batch $/GB against the hashes a GB costs.
    const servers = [{ name: "hacknet-server-0", level: 100, ram: 64, cores: 10 }];
    const perGB = (hp.hashRate(100, 0, 64, 10, 1, 1) / 64) * hp.DOLLARS_PER_HASH;
    if (hp.ramPolicy(servers, MULTS1, 1, perGB * 1.01)["hacknet-server-0"].allow !== true) c.fail("a batch paying more per GB than the hashes must get the RAM");
    if (hp.ramPolicy(servers, MULTS1, 1, perGB * 0.99)["hacknet-server-0"].allow !== false) c.fail("a batch paying less per GB than the hashes must not");
    if (hp.ramPolicy(servers, MULTS1, 1, null)["hacknet-server-0"].allow !== false) c.fail("unreadable batch income must keep the hashes");
    // The placers. Each check fails if the guard is removed.
    const batch = code("batch.js");
    if (!/hosts = all\.filter\(\(h\) => \{[\s\S]{0,300}hacknetHostAllowed\(h, hnPolicy\)/.test(batch)) c.fail("batch.js's host list no longer consults hacknetHostAllowed — its workers would eat hacknet servers' hashes");
    if (!/const hosts = all\.filter\(\(h\) => h !== 'home' && ns\.hasRootAccess\(h\) && hacknetHostAllowed\(h, hnPolicy\)\)/.test(code("seed.js"))) c.fail("seed.js fills hacknet servers again: early.js loops forever and turns their hashes off");
    if (!/function placeOff[\s\S]{0,200}isHacknetServerHost\(host\)/.test(code("boot.js"))) c.fail("boot.js placeOff treats a hacknet server as a tight fit again");
    const wd = code("watchdog.js");
    if (!/function placeFor[\s\S]{0,300}isHacknetServerHost\(h\)/.test(wd) || !/function shareThreads[\s\S]{0,1500}isHacknetServerHost\(h\)/.test(wd)) c.fail("watchdog.js placeFor/shareThreads no longer skip hacknet servers");
    if ((code("act.js").match(/hacknetLast\(a\.h, b\.h\)/g) ?? []).length !== 3) c.fail("act.js's three actor placements must sort hacknet servers last");
    c.examined(5);
    c.note("eight host/policy shapes; five placers pinned");
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("HS6", "CloudServerLimit 0 (BitNode 9): buyserv.js refuses by name and publishes no $/GB for servers that cannot be bought");
    const b = code("buyserv.js");
    const guard = b.indexOf("if (limit <= 0 && owned.length === 0)");
    const price = b.indexOf("fleetDollarPerGB: target > 0");
    c.examined(1);
    if (guard < 0) c.fail("buyserv.js has no refusal for a node with no cloud servers");
    else if (!(guard < price)) c.fail("the refusal must come before the $/GB is computed and published");
    if (!/no-cloud-servers[\s\S]{0,80}fleetDollarPerGB: null/.test(b)) c.fail("the refusal must publish fleetDollarPerGB: null, so progress.js's spendExit.servers reads it as unpriced");
    // And progress.js must treat a null $/GB as unpriced, not as a price.
    if (!/bs\?\.fleetDollarPerGB > 0/.test(code("progress.js"))) c.fail("progress.js's fleet verdict no longer requires a positive $/GB");
    c.note(`the game: getCloudServerLimit() = round(25 x CloudServerLimit); BN9 sets ${bnm.bitNodeMults(9).CloudServerLimit}`);
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("HS7", "hacknet money reaches the exit: lifeIncome runs the hold-to-exit legs, ends at an install, and rides moneyAtW");
    const base = { money: 0, incomePerSec: 1e4, hacking: 500, hackingExp: xp.expForLevel(500, 1), hackingMult: 1, expPerSec: 1e6, exitLevel: 600, joinMoney: 1e10, cycleHours: 2, multGainPerCycle: 1.2 };
    const k0 = xp.exitHours({ ...base, installsFirst: 0 }).hours;
    const k0L = xp.exitHours({ ...base, installsFirst: 0, lifeIncome: 1e6 }).hours;
    const k1 = xp.exitHours({ ...base, installsFirst: 1 }).hours;
    const k1L = xp.exitHours({ ...base, installsFirst: 1, lifeIncome: 1e6 }).hours;
    c.examined(4);
    if (!(k0L < k0 * 0.2)) c.fail(`hold-to-exit must earn the hacknet money: ${k0L}h with vs ${k0}h without`);
    if (!close(k1L, k1)) c.fail(`after an install the hacknet stream is gone (servers and nodes are deleted): ${k1L}h vs ${k1}h`);
    c.note(`join $10b at $10k/s script income: ${k0.toFixed(1)}h alone, ${k0L.toFixed(2)}h with $1m/s of hacknet`);
    const p = code("progress.js");
    if (!/lifeIncome: hacknetLifeIncome\(ns, info\)\.perSec/.test(p)) c.fail("progress.js exitInputsOf no longer carries hacknet money");
    if ((p.match(/hacknetLifeIncome\(ns, info\)\.perSec \* Wg \* 3600|\(incNow \+ hacknetLifeIncome\(ns, info\)\.perSec\) \* W0 \* 3600/g) ?? []).length !== 2) c.fail("both published moneyAtW figures must include the hacknet money until the install");
    if (!/moneyPerSec/.test(code("hacknet.js"))) c.fail("hacknet.js no longer publishes moneyPerSec");
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("HS8", "every nextHomeUpgrade call passes the node's HomeComputerRamCost (BN9 = 5)");
    let calls = 0;
    for (const f of fs.readdirSync(REPO_ROOT).filter((x) => x.endsWith(".js") && x !== "homecost.js")) {
      const s = code(f);
      for (const m of s.matchAll(/nextHomeUpgrade\(([^\n]*)\)/g)) {
        calls++;
        if (!/HomeComputerRamCost/.test(m[1])) c.fail(`${f}: nextHomeUpgrade(${m[1].slice(0, 80)}) omits the node multiplier`);
      }
    }
    c.examined(calls);
    if (calls < 7) c.fail(`found only ${calls} call sites — the search is not looking where the callers are`);
    c.note(`${calls} call sites checked`);
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("HS9", "hacknet.js prices hacknet SERVERS (no refusal) and closes Netburners by the server model");
    const h = code("hacknet.js");
    c.examined(3);
    if (/hacknet servers \(hashes\) are not priced/.test(h)) c.fail("hacknet.js refuses phase 2 with hacknet servers again");
    if (!/servers \? bestServerUpgrade\(/.test(h)) c.fail("hacknet.js phase 2 must price servers with bestServerUpgrade");
    if (!/netburnersServerStep\(/.test(h)) c.fail("hacknet.js phase 1 must use the server model with servers");
    // The BN9 entry server needs only RAM (level 100, 10 cores): 1 -> 8GB.
    let fleet = [{ level: 100, ram: 1, cores: 10 }];
    let spent = 0;
    for (let i = 0; i < 10; i++) {
      const st = hp.netburnersServerStep(fleet, { levels: 100, ram: 8, cores: 4 }, MULTS1);
      if (!st?.best) break;
      spent += st.best.cost;
      fleet = st.best.kind === "node" ? [...fleet, { level: 1, ram: 1, cores: 1 }] : fleet.map((s, j) => (j === st.best.index ? { ...s, ram: st.best.kind === "ram" ? s.ram * 2 : s.ram } : s));
    }
    const ram = fleet.reduce((a, s) => a + s.ram, 0);
    if (ram < 8) c.fail(`the server step must close the RAM total from the BN9 entry server, reached ${ram}GB`);
    if (spent > 3e6) c.fail(`closing Netburners' RAM from the entry server must cost ~$2.3m at most, spent $${spent}`);
    c.note(`BN9 entry -> Netburners RAM: ${fleet.length} server(s), ${ram}GB, $${(spent / 1e6).toFixed(2)}m`);
    // Payback shape and refusals.
    const r = hp.bestServerUpgrade([{ level: 100, ram: 1, cores: 10, ramUsed: 0 }], MULTS1, 1, hp.DOLLARS_PER_HASH);
    if (!r.best || !(r.best.gainPerSec > 0) || !close(r.best.paybackH, r.best.cost / r.best.gainPerSec / 3600)) c.fail(`bestServerUpgrade must rank by payback in dollars: ${JSON.stringify(r).slice(0, 200)}`);
    if (hp.bestServerUpgrade([], MULTS1, 0, hp.DOLLARS_PER_HASH).best) c.fail("HacknetNodeMoney 0 (BN8) must refuse: servers hash nothing there");
    if (hp.bestServerUpgrade([], MULTS1, 1, null).best) c.fail("an unreadable $/hash must refuse");
    c.note(`entry server's best purchase: ${r.best.kind}#${r.best.index} $${r.best.cost.toExponential(2)}, payback ${r.best.paybackH.toFixed(2)}h`);
    checks.push(c);
  }

  return checks;
}
