// [B8] BitNode 8 ("Ghost of Wall Street"): the money is the stock trader's.
//
// BitNode.tsx:764-793 sets ScriptHackMoneyGain, CrimeMoney, CompanyWorkMoney,
// HacknetNodeMoney, InfiltrationMoney, CodingContractMoney, GangSoftcap and
// FavorToDonateToFaction to 0, and Prestige.ts:158 REPLACES the balance with
// $250m at every install. Each check below pins one place the stack read that
// wrong, and each was watched failing against the code it replaced:
//
//   B8a  income: script income alone reads $0 and every exit refuses; the
//        trader's compounding return must price it (nodeecon + exitplan)
//   B8b  favorToDonate 0 is a THRESHOLD: the rep leg is donated, not ground
//   B8c  installCash: a post-install leg starts at $250m, not $1262
//   B8d  the gang with GangSoftcap 0 is NOT worth its karma gate (gangworth)
//   B8e  buyserv holds its fallback where hacking pays nothing (source guard)
//   B8f  progress.js offers donations from the node's threshold (source guard)
//   B8g  the stock-manipulation flag goes on ONE side of the batch only
//   B8h  every other node prices exactly as before (defaults unchanged)

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const econ = await import("../../nodeecon.js");
const X = await import("../../exitplan.js");
const GW = await import("../../gangworth.js");
const GP = await import("../../gangplan.js");
const { bitNodeMults } = await import("../../bitNodeMultipliers.js");
const F = await import("../../favor.js");

const src = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8");
const code = (f) => src(f).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

/** A BN8 exit state: the trader returning 0.01%/s (36%/h) on $300m, no script income. */
const BN8 = {
  money: 3e8,
  incomePerSec: 0,
  capitalReturnPerSec: 1e-4,
  hacking: 500,
  hackingExp: X.expForLevel(500, 8),
  hackingMult: 8,
  expPerSec: 2000,
  repPerSec: 50,
  exitRep: 0,
  exitFavor: 0,
  exitLevel: 3000,
  joinMoney: 100e9,
  terminalRep: 2.5e6,
  donationCost: 2.5e12,
  favorToDonate: 0,
  installCash: 250e6,
  cycleHours: 5,
  multGainPerCycle: 1.3,
  workWhileDonating: true,
};

export async function run() {
  const checks = [];

  // -------------------------------------------------------------------
  const a = new Check("B8a", "BN8 income: the trader's compounding return prices the exit; script income alone refuses");
  {
    const m8 = bitNodeMults(8);
    a.examined(5);
    if (m8?.ScriptHackMoneyGain !== 0) a.fail("the override table no longer says BN8 pays nothing for hacking", JSON.stringify(m8?.ScriptHackMoneyGain));
    const noTrader = econ.incomeOf({ scriptIncome: [0, 0], mults: m8, stock: econ.stockRecordOf(null, 1) });
    if (noTrader.priced || !/UNMEASURED/.test(noTrader.why ?? "")) a.fail("no trader in BN8 must read UNMEASURED, not a $0 finding", JSON.stringify(noTrader));
    const rec = { at: new Date().toISOString(), lastAugReset: 7, equity: 5e8, returnPerSec: 1e-4, capitalCap: 1e12 };
    const withTrader = econ.incomeOf({ scriptIncome: [0, 0], mults: m8, stock: econ.stockRecordOf(rec, 7) });
    if (!withTrader.priced || withTrader.capitalReturnPerSec !== 1e-4 || withTrader.equity !== 5e8) a.fail("a fresh trader record must price BN8 income", JSON.stringify(withTrader));
    const stale = econ.stockRecordOf({ ...rec, lastAugReset: 6 }, 7);
    if (stale.ok) a.fail("a record from another life must be refused");
    const r = X.bestExitPolicy(BN8, 0, 0);
    if (!r.best) a.fail("exitplan refuses a node whose only income is the capital return", r.why);
    else a.note(`BN8 final-window exit ${r.best.hours.toFixed(1)}h on r = 1e-4/s`);
    // The compounding leg against its closed form: $250m -> $25b at r is ln(100)/r.
    const h = X.hoursToMoney(25e9, { money0: 250e6, incomeAtLevel1: 0, mult: 1, capitalReturnPerSec: 1e-4 });
    const exact = Math.log(100) / 1e-4 / 3600;
    if (!(Math.abs(h / exact - 1) < 0.02)) a.fail(`compounding leg ${h}h vs closed form ${exact.toFixed(3)}h`);
    a.note(`compounding leg ${h?.toFixed(3)}h vs ln(100)/r ${exact.toFixed(3)}h`);
  }
  checks.push(a);

  // -------------------------------------------------------------------
  const b = new Check("B8b", "FavorToDonateToFaction 0 is a threshold of zero: the exit's reputation is donated from favor 0");
  {
    b.examined(4);
    if (econ.favorToDonateOf(bitNodeMults(8)) !== 0) b.fail("favorToDonateOf(BN8) must be 0");
    if (econ.favorToDonateOf(bitNodeMults(1)) !== 150) b.fail("favorToDonateOf(BN1) must be 150");
    if (econ.favorToDonateOf(null) !== null) b.fail("an unreadable table must be null, not a number");
    const r = X.hoursToRep(2.5e6, { rep0: 0, repPerSec: 50, donationCost: 1e9, favor: 0, favorToDonate: 0, moneyLeg: () => 1 });
    if (!/donated/.test(r.how)) b.fail("hoursToRep ground the rep at favor 0 in a node that sells it", JSON.stringify(r));
    const ex = X.exitHours({ ...BN8, installsFirst: 0 });
    const leg = ex.legs?.find((l) => l.leg === "exit reputation");
    if (!leg || !/donated/.test(leg.detail)) b.fail("the BN8 exit's reputation leg is not a donation", JSON.stringify(leg ?? ex.why));
    else b.note(`rep leg: ${leg.detail} in ${leg.hours.toFixed(2)}h`);
    for (const f of econ.NO_DONATION_FACTIONS) if (econ.canDonateTo(f, 1000, 0)) b.fail(`${f} never accepts donations (Singularity.ts:907)`);
    if (econ.canDonateTo("Slum Snakes", 0, 0, "Slum Snakes")) b.fail("the managed gang's faction refuses donations (Singularity.ts:903)");
    if (!econ.canDonateTo("CyberSec", 0, 0)) b.fail("a working faction at favor 0 must be donatable at threshold 0");
    // favor.js repLadder (the schedule's donation terminal) must arm at 0 too.
    const L = F.repLadder(1e6, { windowH: 5, baseRepPerSec: 1, favor: 0, donateAt: 0, repMult: 1, nodeWorkRepMult: 1, incomePerSec: 1e9, money: 0 })
    if (L?.via !== "donation") b.fail("repLadder grinds at favor 0 where donations are open", JSON.stringify(L));
  }
  checks.push(b);

  // -------------------------------------------------------------------
  const c = new Check("B8c", "an install leaves $250m in BN8 and $1262 elsewhere (Prestige.ts:158, PlayerObjectGeneralMethods.ts:102)");
  {
    c.examined(3);
    if (econ.postInstallMoney(8) !== 250e6 || econ.postInstallMoney(4) !== 1262) c.fail("postInstallMoney is wrong", `${econ.postInstallMoney(8)} / ${econ.postInstallMoney(4)}`);
    // With installs, the post-install money leg must start from installCash.
    const one = { ...BN8, joinMoney: 1e9, installsFirst: 1 };
    const rich = X.exitHours({ ...one, installCash: 250e6 });
    const poor = X.exitHours({ ...one, installCash: 1262 });
    const hoard = (r) => r.legs?.find((l) => l.leg === "hoard join money")?.hours ?? 0;
    if (!(hoard(rich) < hoard(poor))) c.fail("installCash does not reach the post-install money leg", `${hoard(rich)} vs ${hoard(poor)}`);
    c.note(`post-install $1b hoard: ${hoard(rich).toFixed(2)}h from $250m vs ${hoard(poor).toFixed(2)}h from $1262`);
    if (/cash = 1262 \/\//.test(code("exitplan.js"))) c.fail("exitplan still resets cash to a literal 1262");
  }
  checks.push(c);

  // -------------------------------------------------------------------
  const d = new Check("B8d", "GangSoftcap 0: the gang is priced NOT worth its karma gate, by trajectory");
  {
    d.examined(2);
    const G = { faction: "Slum Snakes", isHacking: false, respect: 1, wantedLevel: 1, territory: 1 / 7, power: 1, territoryClashChance: 0, territoryWarfareEngaged: false };
    const rivals = Object.fromEntries(["Tetrads", "The Syndicate", "The Dark Army", "Speakers for the Dead", "NiteSec", "The Black Hand"].map((n) => [n, { power: 1, territory: 1 / 7 }]));
    const sim = (softcap) => GP.simulateGang(G, [], { softcap, horizonH: 100, stepSec: 300, mode: "money", assignFn: GP.trainRatio(4.2, false, 1), ascend: { minGain: 1.09 }, rivals, warfare: { fraction: 0, engageRatio: 1 } });
    const s8 = GW.gangIncomeSchedule(sim(bitNodeMults(8).GangSoftcap));
    const ex8 = GW.gangExit(X.bestExitPolicy, BN8, s8, 20, null);
    const v8 = GW.gangVerdict({ node: 8, mults: bitNodeMults(8), grindHours: 20, gangExit: ex8 });
    if (v8.worth !== false) d.fail("BN8's gang reads as worth a 20h karma grind", v8.why);
    d.note(v8.why);
    // The negative control: the same machinery still says yes where the gang earns.
    const s1 = GW.gangIncomeSchedule(sim(1));
    const v1 = GW.gangVerdict({ node: 8, mults: { ...bitNodeMults(8), GangSoftcap: 1 }, grindHours: 20, gangExit: GW.gangExit(X.bestExitPolicy, BN8, s1, 20, null) });
    if (v1.worth !== true) d.fail("with GangSoftcap 1 the same comparison should favour the gang — the check is not discriminating", v1.why);
  }
  checks.push(d);

  // -------------------------------------------------------------------
  const e = new Check("B8e", "buyserv.js has no claims fallback where scripted hacking pays nothing");
  {
    e.examined(1);
    const s = code("buyserv.js");
    if (!/ScriptHackMoneyGain\s*===\s*0[\s\S]{0,400}return Infinity/.test(s)) e.fail("buyserv.js no longer holds every dollar when ScriptHackMoneyGain is 0", "it spent ~$85m of BN8's $250m opening on servers that earn nothing");
  }
  checks.push(e);

  // -------------------------------------------------------------------
  const f = new Check("B8f", "progress.js reads the donation threshold and the income from the node, not from BN1 constants");
  {
    f.examined(4);
    const s = code("progress.js");
    if (/favorNeededToDonate\(1\)/.test(s)) f.fail("progress.js offers donations at a hardcoded 150 (favorNeededToDonate(1))");
    if (/f > 0 \? 150 \* f : null/.test(s)) f.fail("exitInputsOf turns FavorToDonateToFaction 0 into 'never'");
    if (!/incomeOf\(\{ scriptIncome:/.test(s)) f.fail("progress.js no longer measures income through nodeecon.incomeOf");
    if (!/installCash: postInstallMoney\(/.test(s)) f.fail("exitInputsOf no longer passes the node's post-install money");
    if (/freshStart: 1262/.test(s)) f.fail("count timing still assumes a $1262 opening");
  }
  checks.push(f);

  // -------------------------------------------------------------------
  const g = new Check("B8g", "stock manipulation flags ONE side of a batch (a grow undoes its hack's forecast push)");
  {
    g.examined(5);
    const m = { alpha: "hack", beta: "grow" };
    const want = [["alpha", "hack", 1], ["alpha", "grow", 0], ["beta", "grow", 1], ["beta", "hack", 0], ["gamma", "hack", 0]];
    for (const [h, op, v] of want) if (econ.stockFlagFor(m, h, op) !== v) g.fail(`stockFlagFor(${h}, ${op}) should be ${v}`);
    if (econ.stockFlagFor(null, "alpha", "hack") !== 0) g.fail("no record must flag nothing");
    for (const w of ["h.js", "g.js"]) if (!/stock:\s*ns\.args\[3\]\s*===\s*1/.test(code(w))) g.fail(`${w} does not pass {stock} from its 4th argument`);
    if (!/stockFlagFor\(stockManip, host, o\.op\)/.test(code("batch.js"))) g.fail("batch.js does not pass the manipulation flag to its batch workers");
  }
  checks.push(g);

  // -------------------------------------------------------------------
  const h = new Check("B8h", "outside BitNode 8 the new terms are absent and the exit prices exactly as before");
  {
    h.examined(2);
    const base = { ...BN8, incomePerSec: 5e6, capitalReturnPerSec: undefined, installCash: undefined, favorToDonate: 150, workWhileDonating: undefined };
    delete base.capitalReturnPerSec;
    delete base.installCash;
    delete base.workWhileDonating;
    const x = X.bestExitPolicy(base, 30, 0);
    const y = X.bestExitPolicy({ ...base, flatIncomePerSec: 0, capitalReturnPerSec: 0, installCash: 1262 }, 30, 0);
    if (!x.best || !y.best || x.best.hours !== y.best.hours || x.best.installsFirst !== y.best.installsFirst) h.fail("explicit BN1 defaults change the exit", `${x.best?.hours} vs ${y.best?.hours}`);
    const hm0 = X.hoursToMoney(1e10, { money0: 0, incomeAtLevel1: 1e5, mult: 2, exp0: 1e6, expPerSec: 1000 });
    const hm1 = X.hoursToMoney(1e10, { money0: 0, incomeAtLevel1: 1e5, mult: 2, exp0: 1e6, expPerSec: 1000, flatPerSec: 0, capitalReturnPerSec: 0 });
    if (hm0 !== hm1) h.fail("hoursToMoney moved with zero BN8 terms", `${hm0} vs ${hm1}`);
    h.note(`BN1-shaped exit ${x.best?.hours?.toFixed(2)}h either way`);
  }
  checks.push(h);

  // -------------------------------------------------------------------
  const i = new Check("B8i", "GangSoftcap 0: the gang is NOT worth it by structure — no income reading needed, no karma grind, no yielded slot");
  {
    i.examined(6);
    const m8 = bitNodeMults(8);
    // No exit comparison, no grind hours: exactly the live state (income unmeasured).
    const v = GW.gangVerdict({ node: 8, mults: m8, grindHours: null, gangExit: null });
    if (v.worth !== false) i.fail("an unpriced BN8 gang verdict is not 'not worth it'", v.why);
    else i.note(v.why);
    const pend = GW.gangIsPending({ canUse: true, node: 8, inGang: false, verdict: null, mults: m8 });
    if (pend.pending !== false) i.fail("BN8's gang is still pending on an unknown verdict", pend.why);
    // Other nodes: structure says nothing, the old behaviour stands.
    if (GW.gangChannelsDead(bitNodeMults(4)) !== null || GW.gangChannelsDead(bitNodeMults(2)) !== null) i.fail("gangChannelsDead fires outside GangSoftcap 0");
    if (GW.gangIsPending({ canUse: true, node: 4, inGang: false, verdict: null, mults: bitNodeMults(4) }).pending !== true) i.fail("an unpriced BN4 gang stopped being pending");
    // actplan: the live failure — gangWorth absent, karma -1358, no gang faction.
    const P = await import("../../actplan.js");
    const pl = { skills: { hacking: 200, strength: 100, defense: 100, dexterity: 100, agility: 100, charisma: 10, intelligence: 0 }, exp: {}, mults: { crime_success: 1, crime_money: 1 }, karma: -1358, numPeopleKilled: 10, city: "Sector-12", money: 3e8 };
    for (const k of ["hacking", "strength", "defense", "dexterity", "agility", "charisma"]) { pl.exp[k] = 1e5; pl.mults[k] = 1; pl.mults[`${k}_exp`] = 1; }
    const s = { now: Date.now(), gangNode: true, gangKarma: -54000, factions: ["CyberSec", "Slum Snakes"], player: pl, progress: null, schedule: null, work: { kind: "crime", type: "Homicide" }, tried: {} };
    const d8 = P.decide({ ...s, node: { CrimeSuccessRate: 1, CrimeMoney: 0, CrimeExpGain: 1, GangSoftcap: 0, GangUniqueAugs: 0 } });
    if (/karma|gang/i.test(d8.why ?? "") && (d8.kind === "crime" || /crime loop/.test(d8.why))) i.fail("actplan still runs the karma grind in BN8", JSON.stringify(d8));
    const d4 = P.decide({ ...s, node: { CrimeSuccessRate: 1, CrimeMoney: 0.2, CrimeExpGain: 1, GangSoftcap: 0.9 } });
    if (!/karma/.test(d4.why ?? "")) i.fail("the negative control: with GangSoftcap 0.9 and no verdict the karma grind should still run", JSON.stringify(d4));
    i.note(`BN8 act decision: ${d8.kind} — ${d8.why}`);
    const src = code("progress.js");
    if (!/const gangBootstrapPending = canUseGang\(info\) && !ns\.gang\.inGang\(\) && !gangChannelsDead\(/.test(src)) i.fail("progress.js yields the work slot to a structurally worthless gang");
  }
  checks.push(i);

  // -------------------------------------------------------------------
  // Live 2026-09-25: every sleeve choice priced at ~1.53e26h (tied), the
  // sleeves studied at $8k/s, cash went to -$2.4m.
  const j = new Check("B8j", "a fresh node's exit discriminates (stated cadence prior), degenerate exits refuse, fees are a money outflow, paid classes pass a cash floor");
  {
    j.examined(9);
    const SP = await import("../../sleeveplan.js");
    const ledger = Array.from({ length: 6 }, (_, k) => ({ bitNode: 10, lifeH: 3, hackMult: 1.4 * Math.pow(1.2, k), augs: 10 + k }));
    const live = { money: 2.5e8, incomePerSec: 0, hacking: 409, hackingExp: 7.3e6, hackingMult: 1.34, expPerSec: 2349, repPerSec: 4.6, exitRep: 0, exitFavor: 0, exitLevel: 3000, joinMoney: 100e9, terminalRep: 0, favorToDonate: 0, capitalReturnPerSec: 1.26e-4, capitalCap: 5.5e12, installCash: 250e6, workWhileDonating: true };
    // Without a cadence: only "never install" prices, and it is degenerate.
    const bare = X.bestExitPolicy(live);
    if (bare.degenerate !== true) j.fail("the no-cadence exit (~1e26h) is not flagged degenerate", String(bare.best?.hours));
    // With the prior: finite, and it moves with exp.
    const cad = X.installCadence(ledger, 8);
    if (cad?.source !== "prior" || cad.node !== 10) j.fail("no stated prior from another node", JSON.stringify(cad));
    const withC = { ...live, cycleHours: cad.stats.cycleHours, multGainPerCycle: cad.stats.multGainPerCycle };
    const a = X.bestExitPolicy(withC);
    const b = X.bestExitPolicy({ ...withC, expPerSec: live.expPerSec + 500 });
    if (a.degenerate || !(a.best?.hours < X.DEGENERATE_H)) j.fail("the exit with a cadence prior is still degenerate", String(a.best?.hours));
    else if (!(b.best.hours < a.best.hours - 1 / 60)) j.fail("more exp does not shorten the exit — it still does not discriminate", `${a.best.hours} vs ${b.best.hours}`);
    else j.note(`${cad.why}; exit ${a.best.hours.toFixed(2)}h, +500 exp/s ${b.best.hours.toFixed(2)}h`);
    if (X.installCadence(ledger.map((e) => ({ ...e, bitNode: 8 })), 8)?.source !== "measured") j.fail("three lives in this node must replace the prior");
    // A fee slows a money leg; a fee larger than income never finishes it.
    const h0 = X.hoursToMoney(1e9, { money0: 1e8, incomeAtLevel1: 0, mult: 1, flatPerSec: 1e5 });
    const h1 = X.hoursToMoney(1e9, { money0: 1e8, incomeAtLevel1: 0, mult: 1, flatPerSec: 1e5, spendPerSec: 5e4 });
    const h2 = X.hoursToMoney(1e9, { money0: 1e5, incomeAtLevel1: 0, mult: 1, flatPerSec: 1e3, spendPerSec: 8e3 });
    if (!(h1 > h0 * 1.9)) j.fail(`spendPerSec does not slow the money leg (${h0} vs ${h1})`);
    if (h2 !== Infinity) j.fail(`a spend above income must never finish a money leg, got ${h2}`);
    // sleeveExitOf refuses a degenerate record.
    const rec = { at: new Date().toISOString(), lastAugReset: 1, inputs: live };
    if (SP.sleeveExitOf(rec, 1, X.bestExitPolicy)?.("exp", { perSec: 10, delayH: 0 }) !== null) j.fail("sleeveExitOf priced a degenerate exit");
    // The floor: with cash below 120s of the fleet's fees, no sleeve studies.
    const sl = { index: 0, sync: 100, shock: 0, skills: { hacking: 50, intelligence: 0 }, exp: { hacking: 0 }, mults: { hacking_exp: 1 }, city: "Volhaven", memory: 1 };
    const fleet = [0, 1, 2, 3, 4].map((k) => ({ ...sl, index: k }));
    // An exit that FAVOURS studying, so only the floor can refuse it.
    const poor = SP.sleeveAssignments(fleet, null, { objective: "exp", horizonHours: 100, money: 5e5, exitOf: (k, t) => (t.perSec > 0 ? 30 : 40), playerIntelligence: 0 });
    if (poor.tasks.some((t) => t === "hacking")) j.fail("sleeves study on cash that cannot fund 120s of the fleet's fees", poor.why[0]);
    // Priced: the fee makes the exit longer -> recover; shorter -> study.
    const exitWorse = (k, t) => (t.spendPerSec ? 50 : 40);
    const exitBetter = (k, t) => (t.perSec > 0 ? 30 : 40);
    const w = SP.sleeveAssignments([sl], null, { objective: "exp", horizonHours: 100, money: 1e12, exitOf: exitWorse, playerIntelligence: 0 });
    const bt = SP.sleeveAssignments([sl], null, { objective: "exp", horizonHours: 100, money: 1e12, exitOf: exitBetter, playerIntelligence: 0 });
    if (w.tasks[0] !== "shock") j.fail("a fee the exit cannot afford still sends the sleeve to study", w.why[0]);
    if (bt.tasks[0] !== "hacking") j.fail("a study that shortens the exit is refused", bt.why[0]);
    // actplan: no gym on cash that cannot fund it.
    const P = await import("../../actplan.js");
    if (!(P.GYM_FEE_PER_SEC === 2400)) j.fail("Powerhouse fee is not 120 x 20");
    const src = code("progress.js");
    if (!/!already && !feeFundable\(/.test(src) || !/!studying && !feeFundable\(/.test(src)) j.fail("progress.js starts a gym or course without the fee floor");
  }
  checks.push(j);

  // -------------------------------------------------------------------
  // Live 2026-09-25: $287.2m of TOR + all five openers (SQLInject $250m) in the
  // first ~30 minutes, out of the trader's compounding capital.
  const k = new Check("B8k", "where money is capital, port openers and TOR are bought only on a priced exit verdict; elsewhere unchanged");
  {
    k.examined(8);
    const EF = await import("../../expfarm.js");
    const servers = [
      { host: "n00dles", ports: 0, ramGB: 4, rooted: true, score: 1 },
      { host: "joesguns", ports: 0, ramGB: 16, rooted: true, score: 2 },
      { host: "iron-gym", ports: 1, ramGB: 32, rooted: false, score: 3 },
      { host: "phantasy", ports: 2, ramGB: 32, rooted: false, score: 2.5 },
    ];
    const pt = EF.portTiers(servers, 100, 0);
    if (!(pt?.tiers?.[0]?.ramGB === 132 && pt.tiers[0].bestScore === 3 && Math.abs(pt.tiers[0].expMultiple - (132 * 3) / (100 * 2)) < 1e-9)) k.fail("portTiers tier 1 wrong", JSON.stringify(pt?.tiers?.[0]));
    const L = Array.from({ length: 6 }, (_, q) => ({ bitNode: 10, lifeH: 3, hackMult: 1.4 * Math.pow(1.2, q), augs: 10 + q }));
    const cad = X.installCadence(L, 8);
    const inp = { money: 2.5e8, incomePerSec: 0, hacking: 409, hackingExp: 7.3e6, hackingMult: 1.34, expPerSec: 2349, repPerSec: 4.6, exitRep: 0, exitFavor: 0, exitLevel: 3000, joinMoney: 100e9, terminalRep: 0, favorToDonate: 0, capitalReturnPerSec: 1.26e-4, capitalCap: 5.5e12, installCash: 250e6, workWhileDonating: true, cycleHours: cad.stats.cycleHours, multGainPerCycle: cad.stats.multGainPerCycle };
    const cheap = X.programExit(inp, 700e3, 2349 * 0.5); // BruteSSH + TOR, +50% exp
    const dear = X.programExit(inp, 250e6, 2349 * 0.001); // SQLInject for a sliver of exp
    if (!(cheap.deltaH < 0)) k.fail("a cheap opener that adds half the exp does not pay", JSON.stringify(cheap));
    if (!(dear.deltaH > 0)) k.fail("$250m every life for 0.1% more exp pays", JSON.stringify(dear));
    k.note(`cheap opener ${cheap.deltaH?.toFixed(2)}h, SQLInject for a sliver +${dear.deltaH?.toFixed(2)}h`);
    const life = 7;
    const now = Date.now();
    const gate = (programs) => ({ spendExit: { at: new Date(now).toISOString(), lastAugReset: life, programs } });
    if (!econ.programSpendAllowed(bitNodeMults(4), null, "SQLInject.exe", life, now).allowed) k.fail("outside a capital node a program needs no verdict");
    if (econ.programSpendAllowed(bitNodeMults(8), null, "BruteSSH.exe", life, now).allowed) k.fail("BN8 bought a program with no verdict");
    if (!econ.programSpendAllowed(bitNodeMults(8), gate({ "BruteSSH.exe": { buy: true } }), "BruteSSH.exe", life, now).allowed) k.fail("a buy verdict was not honoured");
    if (econ.programSpendAllowed(bitNodeMults(8), gate({ "BruteSSH.exe": { buy: true } }), "BruteSSH.exe", life - 1, now).allowed) k.fail("another life's verdict was honoured");
    if (!/mayBuy\(TOR_ITEM\)/.test(code("autobuy.js")) || !/if \(!mayBuy\(file\)\) continue/.test(code("autobuy.js"))) k.fail("autobuy.js buys TOR or openers without the verdict");
    if (!/programSpendAllowed\(bitNodeMults\(info\?\.currentNode\), readJson\(ns, GATE\), file,/.test(code("progress.js"))) k.fail("progress.js orders openers without the verdict");
    if (!/ScriptHackMoneyGain === 0\) return false/.test(code("watchdog.js"))) k.fail("watchdog's homeup claims fallback still spends capital");
  }
  checks.push(k);

  // -------------------------------------------------------------------
  // REPLAY of the 2026-09-25 20:37 stall: stock.txt ok (equity $61.5b), cash
  // $79,597; progress planned nothing (cash-only budget), income read null,
  // three city joins "need 20m in hand" for 5.8h.
  const l = new Check("B8l", "a fully-invested book funds purchases: plans count equity, batches raise just their cost, never sell the whole book");
  {
    l.examined(7);
    const rec = { at: new Date().toISOString(), lastAugReset: 1790347700639, equity: 61489192040.85, returnPerSec: 3.71e-4, capitalCap: 6.0e12, incomePerSec: 4125870, wealth: 61489271638.57, cash: 79597.71 };
    const st = econ.stockRecordOf(rec, 1790347700639);
    if (!st.ok || !(st.equity > 6e10)) l.fail("the live record is not accepted", JSON.stringify(st));
    const inc = econ.incomeOf({ scriptIncome: [0, 0], mults: bitNodeMults(8), stock: st });
    if (!inc.priced) l.fail("the live record prices no income", JSON.stringify(inc));
    // The city join: travel + join($20m) with $79,597 in hand.
    const orders = [{ id: 1, kind: "travel", args: ["Chongqing"] }, { id: 2, kind: "join", args: ["Chongqing"], cost: 20e6 }];
    const out = econ.withCashRaise(orders, rec.cash, st.equity);
    const raise = out[0];
    if (raise?.kind !== "liquidate" || raise.args[0] !== "raise") l.fail("no raise before the travel", JSON.stringify(out[0]));
    else if (!(raise.args[1] >= 20.2e6 && raise.args[1] < 21e6)) l.fail(`the raise is not sized to the batch: ${raise.args[1]}`);
    else l.note(raise.why);
    if (out.some((o) => o.kind === "liquidate" && o.args[0] === "all")) l.fail("a purchase batch sells the whole book");
    if (econ.withCashRaise(orders, 50e6, st.equity).some((o) => o.kind === "liquidate")) l.fail("raised cash that is already in hand");
    if (econ.withCashRaise(orders, 0, 0).some((o) => o.kind === "liquidate")) l.fail("raised from an empty book");
    const src = code("progress.js");
    if (!/const liveMoney = ns\.getServerMoneyAvailable\('home'\) \+ stockEquity/.test(src)) l.fail("the aug plan budgets on cash alone");
    if (!/\(player\.money \?\? 0\) \+ stockEquity >= moneyReq \+ 200e3/.test(src)) l.fail("city joins wait on cash alone");
    if (/args: \['all'\], why: `\$\$\{Math\.round\(stockEquity\)\}/.test(src)) l.fail("the whole-book liquidation prefix is back");
    if (!/String\(ns\.args\[0\] \?\? ''\) === 'raise'/.test(code("act-liquidate.js"))) l.fail("act-liquidate cannot raise a sized amount");
  }
  checks.push(l);

  // -------------------------------------------------------------------
  // 2026-09-25 20:57: a ~$61b book installed on the COUNT FLOOR ("the timing
  // is not yet priced"), no trajectory consulted. REPLAY of that pass's state
  // (tools/test/fixture-bn8-2056.mjs) through the count-aware exit.
  const m = new Check("B8m", "BN8 install timing and batch composition come from the count-aware exit; never-install is not a candidate while the count is short");
  {
    m.examined(8);
    const C = await import("../../countexit.js");
    const F = await import("./fixture-bn8-2056.mjs");
    const IG = await import("../../installgate.js");
    const inputs = { ...F.INPUTS, hackingExp: X.expForLevel(485, 1.3392) };
    const count = { short: F.COUNT_SHORT, ladder: F.LADDER, nfg: F.NFG };
    const now = C.bestCountExit(X.bestExitPolicy, inputs, count, { firstInstallH: 0 });
    const waits = [0.5, 1, 2, 4].map((w) => ({ w, r: C.bestCountExit(X.bestExitPolicy, inputs, count, { firstInstallH: w }) }));
    if (!now.best) m.fail("the replay's count-aware exit is unpriced", now.why);
    else {
      m.note(`replay 20:56: install now ${now.best.hours.toFixed(2)}h (n=${now.best.n}: ${now.best.firstBatch.count} tickets + ${now.best.firstBatch.nfgLevels} NeuroFlux, ${now.best.countInstalls} count installs, ${now.best.installsFirst} total; ${now.best.padded} tickets priced by extrapolation)`);
      for (const { w, r } of waits) m.note(`  wait ${w}h: ${r.best?.hours?.toFixed(2)}h (n=${r.best?.n}, ${r.best?.firstBatch?.count} tickets + ${r.best?.firstBatch?.nfgLevels} NeuroFlux)`);
      const bestWait = waits.filter((x) => x.r.best).sort((a, b) => a.r.best.hours - b.r.best.hours)[0];
      if (!(bestWait && bestWait.r.best.hours < now.best.hours)) m.fail("on the replay a wait should beat installing at once (a bigger batch from a compounding book)");
      else m.note(`=> the simulation waits ${bestWait.w}h (${bestWait.r.best.hours.toFixed(2)}h vs ${now.best.hours.toFixed(2)}h now)`);
    }
    // NEVER is not a policy while the count is short and reachable.
    if (now.never !== null) m.fail("the count-aware exit offered 'never install' while 30 augmentations are short");
    if (now.tried.some((t) => typeof t.installs === "number" && t.installs < t.countInstalls)) m.fail("a policy installed fewer times than the count needs");
    // The gate obeys it (capital node), and falls back to the floor unpriced.
    const H = 3600e3;
    const base = { ageMs: 6 * H, M: 1.0215, queued: 15, exp: 1e9, prev: null, futures: [], countShort: 16, countGain: 14, countTiming: { installNow: null, why: "only 1 completed life" } };
    const waitEx = { countAware: true, nowH: 71.24, neverH: null, waits: [{ waitMs: 1 * H, H: 67.56 }] };
    const goEx = { countAware: true, nowH: 60, neverH: null, waits: [{ waitMs: 1 * H, H: 67.56 }] };
    const hold = IG.shouldInstall({ ...base, exitCompare: waitEx, capitalNode: true });
    const go = IG.shouldInstall({ ...base, exitCompare: goEx, capitalNode: true });
    const other = IG.shouldInstall({ ...base, exitCompare: waitEx, capitalNode: false });
    const unpriced = IG.shouldInstall({ ...base, exitCompare: { nowH: null, why: "x" }, capitalNode: true });
    if (hold.install !== false || hold.countDecidedBy !== "exit-sim") m.fail("the gate installed a count batch the count-aware exit says to wait for", hold.why);
    else m.note(hold.why);
    if (go.install !== true || go.countDecidedBy !== "exit-sim") m.fail("the gate held a count batch the count-aware exit says to install now", go.why);
    if (other.install !== true || other.countDecidedBy !== "floor") m.fail("another node's count floor changed", other.why);
    if (unpriced.install !== true || unpriced.countDecidedBy !== "floor") m.fail("an unpriced exit must fall back to the floor", unpriced.why);
  }
  checks.push(m);

  return checks;
}
