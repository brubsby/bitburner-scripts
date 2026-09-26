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

  // -----------------------------------------------------------------------
  const n = new Check("B8n", "replay 21:46: the exit runs on the trader's REALISED return (fitted across lives, warm-up per install), and the install cadence it picks is not every 35 minutes");
  {
    n.examined(6);
    const C = await import("../../countexit.js");
    const F = await import("./fixture-bn8-2146.mjs");
    const G = await import("./fixture-bn8-2056.mjs");
    const fit = econ.fitCapital(F.CAPITAL_LIVES, F.STEADY_PER_SEC);
    if (!fit) n.fail("no capital fit from three recorded lives");
    else {
      n.note(`fit: r ${fit.r.toExponential(3)}/s, warm-up ${fit.warmupH.toFixed(3)}h per install (${fit.why})`);
      // Realised, not the model's steady 2.23e-4 and not the young life's 0.
      if (!(fit.r > 2e-4 && fit.r < 3.7e-4)) n.fail(`the fitted return ${fit.r} is outside the lives' own range`);
      if (!(fit.warmupH > 0.1 && fit.warmupH < 1)) n.fail(`the two short lives grew nothing: the warm-up must be positive and under an hour, got ${fit.warmupH}`);
    }
    // One life only: the trader's modelled rate, warm-up solved from it.
    const one = econ.fitCapital([F.CAPITAL_LIVES[0]], F.STEADY_PER_SEC);
    if (!(one && one.r === F.STEADY_PER_SEC && one.warmupH >= 0)) n.fail("a single life falls back to the trader's steady rate with a solved warm-up");
    if (econ.fitCapital([], null) !== null) n.fail("nothing to fit must be null (unknown), not a zero return");

    // The count-aware exit (short 12: a proxy ladder from the 20:56 fixture —
    // 21:46's own ladder is not recorded) on the LIVE inputs was unpriced
    // (capital 0: no batch is ever affordable) — that is the regression. On
    // the fitted return it prices, and its life length is hours, not minutes.
    const count = { short: 12, ladder: G.LADDER.slice(0, 12), nfg: G.NFG };
    const live = C.bestCountExit(X.bestExitPolicy, F.INPUTS, count, { firstInstallH: 0 });
    const inputs = { ...F.INPUTS, capitalReturnPerSec: fit?.r ?? 0, capitalWarmupH: fit?.warmupH ?? 0 };
    const fitted = C.bestCountExit(X.bestExitPolicy, inputs, count, { firstInstallH: 0 });
    if (live.best) n.note(`(live inputs priced at ${live.best.hours.toFixed(1)}h)`);
    else n.note(`live inputs (capital return 0): unpriced — ${String(live.why).slice(0, 90)}…`);
    if (!fitted.best) n.fail("on the realised return the count-aware exit must price", fitted.why);
    else {
      n.note(`fitted: exit ${fitted.best.hours.toFixed(1)}h, lives of ${fitted.best.lifeH}h, ${fitted.best.n} ticket(s) per install, ${fitted.best.installsFirst} installs (live pass said 1309.1h, installing every ~35 min)`);
      if (!(fitted.best.lifeH >= 2)) n.fail(`the simulated cadence installs every ${fitted.best.lifeH}h — a life must outlast the trader's warm-up several times over`);
      if (!(fitted.best.hours < 0.6 * 1309.1)) n.fail(`the exit on the realised return (${fitted.best.hours.toFixed(1)}h) should be far below the live 1309.1h`);
    }
    // Without the warm-up the same exit is no longer (a warm-up only costs).
    const noWarm = C.bestCountExit(X.bestExitPolicy, { ...inputs, capitalWarmupH: 0 }, count, { firstInstallH: 0 });
    if (fitted.best && noWarm.best && !(noWarm.best.hours <= fitted.best.hours + 1e-6)) n.fail("the warm-up must cost hours, never save them");
    // progress.js builds the exit inputs from the fit, and records the capital per life.
    const src = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    if (!/capitalReturnPerSec: capitalFitOf\(ns, info\)\?\.r \?\?/.test(src)) n.fail("exitInputsOf must take the capital return from the realised fit first");
    if (!/capitalWarmupH: capitalFitOf\(ns, info\)\?\.warmupH/.test(src)) n.fail("exitInputsOf must pass the per-install warm-up");
    if (!/capStart:[^\n]*capEnd:/.test(src)) n.fail("the lifetimes ledger must record the capital at each life's start and install");
  }
  checks.push(n);

  // -----------------------------------------------------------------------
  const o = new Check("B8o", "raises do not starve the book (join-ready only, hold released after the batch), income on every status write, the manual install hold");
  {
    o.examined(9);
    const tdh = [{ type: "money", money: 1e6 }, { type: "skills", skills: { hacking: 50 } }, { type: "city", city: "Chongqing" }];
    if (econ.joinReadyButCash(tdh, { skills: { hacking: 49 } }).ready !== false) o.fail("a join whose skill is short must not raise cash");
    if (econ.joinReadyButCash(tdh, { skills: { hacking: 50 } }).ready !== true) o.fail("a join short only of cash and city is ready");
    if (econ.joinReadyButCash([{ type: "backdoorInstalled", server: "CSEC" }], {}).ready !== false) o.fail("an unread requirement never licenses a sale");
    if (econ.joinReadyButCash([{ type: "karma", karma: -90 }], { karma: -10 }).ready !== false) o.fail("karma short is not ready");
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    const act = fs.readFileSync(path.join(REPO_ROOT, "act.js"), "utf8");
    const chase = prog.slice(prog.indexOf("for (const f of pick.chosen)"), prog.indexOf("order('join', [f], `chosen city set"));
    if (!/joinReadyButCash\(reqs, player\)/.test(chase) || !/if \(!ready\.ready\)[\s\S]{0,200}continue/.test(chase)) o.fail("the city-faction chase must refuse to order (and so raise for) a join that is not otherwise ready");
    // The hold is released as soon as the batch that raised has run.
    const loopEnd = act.indexOf("ordersReport = { at: batch.at");
    const release = act.lastIndexOf("releaseStockHold(ns, info", loopEnd);
    if (!(release > 0 && loopEnd - release < 400)) o.fail("act.js must release the stock hold right after a batch with a raise executes");
    if (!/at: new Date\(0\)\.toISOString\(\)/.test(act)) o.fail("the release must be an expired stamp (stock.js reads a hold as live only while fresh)");
    if (!/o\.kind === 'join' && results\.some[\s\S]{0,120}await ns\.sleep\(INVITE_WAIT_MS\)/.test(act)) o.fail("a join after its raise/travel must wait for the invitation check");
    // Income on every status write (healthcheck F4 read null on the install path).
    const writes = prog.match(/ns\.write\(STATUS, JSON\.stringify\(\{[^\n]*/g) ?? [];
    const report = /const report = \{[^\n]*income: econNow/.test(prog);
    const bare = writes.filter((w) => !/income: econNow/.test(w) && !/JSON\.stringify\(report/.test(w));
    if (!report || bare.length) o.fail(`every progress status write must carry income (${bare.length} without)`, bare.join("\n"));
    // The manual install hold, in both places, from one file name.
    if (econ.INSTALL_HOLD_FILE !== "/install-hold.txt") o.fail("the install hold is /install-hold.txt");
    if (!/const INSTALL_HOLD_FILE = '\/install-hold\.txt'/.test(act) || !/const STOCK_HOLD_FILE = '\/tel\/stock-hold\.txt'/.test(act) || econ.STOCK_HOLD_FILE !== "/tel/stock-hold.txt") o.fail("act.js's copies of the hold file names must equal nodeecon's");
    const inst = act.slice(act.indexOf("if (o.kind === 'install') {"), act.indexOf("runActor(ns, 'liquidate', ['install'])"));
    if (!/const hold = readHomeFile\(ns, INSTALL_HOLD_FILE\)\s*\n\s*if \(hold\) \{\s*\n\s*results\.push\(\{[^\n]*skipped: `held by[^\n]*\n\s*break/.test(inst)) o.fail("act.js must refuse an install order while /install-hold.txt exists, before selling the book");
    if (!/if \(installHold && gate\.install\)[\s\S]{0,200}gate\.install = false/.test(prog) || !/forcedInstall = !installHold/.test(prog)) o.fail("progress.js's gate (and --install-now) must honour /install-hold.txt");
    if (!/ns\.write\(file, '', 'w'\)\s*\n\s*fetchFromHome\(ns, file\)/.test(act)) o.fail("off home, a hold deleted on home must not survive as a stale local copy");
  }
  checks.push(o);

  // -----------------------------------------------------------------------
  const pch = new Check("B8p", "EXIT NOT APPROACHING: the capital leg is the trader's realised history (flows excluded), one exit is published, waits beat the measured forecast error, and the drift is calibrated");
  {
    pch.examined(10);
    const IG = await import("../../installgate.js");
    // (1) THE LEG THAT DIVERGED: capital. The live history (04:11-10:14 UTC,
    // 2026-09-26) against what the exit was fed (1.12e-4/s, the lifetimes
    // ledger fit, whose capEnd is taken after the install batch spent).
    const rows = fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn8-stockhist.txt"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const real = econ.realisedCapital(rows);
    if (!real) pch.fail("the trader's history yields no realised return");
    else {
      pch.note(`realised ${real.r.toExponential(3)}/s (${(real.r * 3600 * 100).toFixed(0)}%/h), warm-up ${real.warmupH.toFixed(2)}h — ${real.why}; the exit was fed 1.121e-4/s (ledger fit) and before that 2.23e-4/s (the trader's model)`);
      if (!(real.r > 1.3e-4 && real.r < 2.3e-4)) pch.fail(`realised return ${real.r} outside the history's own range`);
      if (!(real.warmupH >= 0 && real.warmupH < 0.5)) pch.fail(`warm-up ${real.warmupH}h`);
    }
    // A purchase (external flow) is not a trading loss.
    const synth = [];
    let w = 250e6, pnl = 0, flows = 0;
    for (let t = 9; t <= 1209; t += 10) {
      if (t === 609) { w -= 200e6; flows -= 200e6; } // the batch spends $200m
      // The trader books a sale to cash as a flow and takes it out of lifePnl
      // (live 20:56 it moved 63.5b between them, wealth unchanged; either sign).
      if (t === 909) { pnl += 300e6; flows -= 300e6; }
      const g = w * 1e-4 * 60; w += g; pnl += g;
      synth.push({ t, wealth: w, lifePnl: pnl, externalFlows: flows });
    }
    const rs = econ.realisedCapital(synth);
    if (!(rs && Math.abs(rs.r - 1e-4) / 1e-4 < 0.05)) pch.fail(`a $200m spend mid-run must not bend the realised return (got ${rs?.r})`);
    // (4) CALIBRATION: predicted -1h/h vs realised, pairs within one life only.
    const H = 3600e3, t0 = Date.parse("2026-09-26T00:00:00Z");
    const samp = (h, exitH, life) => ({ at: new Date(t0 + h * H).toISOString(), exitH, life });
    const cal = econ.exitDrift([samp(0, 100, 1), samp(0.5, 99.5, 1), samp(1, 99, 1), samp(1.5, 98.5, 1), samp(2, 300, 2)]);
    if (!(cal.realisedPerH === -1 && cal.errPerH === 0 && cal.pairs === 3)) pch.fail(`a forecast falling 1h/h is calibrated (error 0) and an install's jump is not a pair, got ${JSON.stringify(cal)}`);
    const noisy = econ.exitDrift([samp(0, 150.9, 1), samp(1, 144.8, 1), samp(2, 145.2, 1), samp(3, 130.4, 1), samp(4, 158.9, 1)]);
    if (!(noisy.errPerH > 3)) pch.fail("a forecast that moves 5-28h per hour must read a large error");
    else pch.note(`calibration on the live-shaped series: ${noisy.why}, error ${noisy.errPerH}h/h`);
    if (econ.exitDrift([samp(0, 100, 1)]).errPerH !== null) pch.fail("one sample is unmeasured (null), not zero error");
    // (3) TOLERANCE: the 0.14h / 4h near-tie installs; a 10h saving still waits.
    const base = { ageMs: 2 * H, M: 1.01, queued: 1, exp: 1e9, prev: null, futures: [], countShort: 1, countGain: 1, countTiming: { installNow: true, why: "the 1 ticket(s) in hand finish the gate" }, capitalNode: true };
    const tie = { countAware: true, nowH: 114.54, neverH: null, waits: [{ waitMs: 4 * H, H: 114.4 }] };
    const tieGate = IG.shouldInstall({ ...base, exitCompare: { ...tie, waitTolPerH: econ.EXIT_TOL_PRIOR_PER_H, waitTolWhy: "prior" } });
    if (tieGate.install !== true) pch.fail("a 0.14h saving on a 4h wait is inside the forecast error: install", tieGate.why);
    else pch.note(tieGate.why);
    const clear = IG.shouldInstall({ ...base, exitCompare: { countAware: true, nowH: 75.17, neverH: null, waits: [{ waitMs: 4 * H, H: 64.78 }], waitTolPerH: 0.5 } });
    if (clear.install !== false) pch.fail("a 10.4h saving beats 0.5h/h x 4h: hold", clear.why);
    const measured = IG.shouldInstall({ ...base, exitCompare: { countAware: true, nowH: 75.17, neverH: null, waits: [{ waitMs: 4 * H, H: 64.78 }], waitTolPerH: noisy.errPerH } });
    if (measured.install !== true) pch.fail(`at the measured ${noisy.errPerH}h/h error a 10.4h saving over 4h is not clear: install`, measured.why);
    const exact = IG.shouldInstall({ ...base, exitCompare: tie });
    if (exact.install !== false) pch.fail("without a tolerance (every other node) the comparison stays exact");
    // (2) ONE EXIT: every gate write carries exitH + exitCalibration from the
    // deciding model, and the healthcheck watches that figure.
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    const hc = fs.readFileSync(path.join(REPO_ROOT, "tools/healthcheck.mjs"), "utf8");
    if ((prog.match(/objective: unifyObjectiveExit\(weightsMeta, decided/g) ?? []).length !== 2 || /objective: weightsMeta,/.test(prog)) pch.fail("both gate writes must publish the unified exit into the objective record");
    if ((prog.match(/exitCalibration: withExitSample\(/g) ?? []).length !== 2) pch.fail("both gate writes must carry the exit calibration");
    if (!/return decidedExitOf\(exitCompare, gate\)/.test(prog)) pch.fail("the planned write's exit must be the deciding comparison's");
    if (!/waitTolPerH: exitCal0\.tolPerH/.test(prog)) pch.fail("the count-aware comparison must carry the measured tolerance");
    if (!/const exitH = num\(gate\?\.exitH\) \? gate\.exitH/.test(hc)) pch.fail("healthcheck F must watch the one published exit");
    if (!/realisedCapital\(rows\)/.test(prog)) pch.fail("capitalFitOf must fit the trader's history, not the ledger");
  }
  checks.push(pch);

  // -----------------------------------------------------------------------
  const q = new Check("B8q", "replay 11:28: one distinct augmentation short, the schedule goes for the cheapest ticket (Slum Snakes, LuminCloaking-V1) instead of grinding BitRunners");
  {
    q.examined(8);
    const FP = await import("../../factionplan.js");
    const BP = await import("../../bodyplan.js");
    const Fx = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn8-1128.json"), "utf8"));
    const owned = new Set(Fx.owned);
    const NFG = "NeuroFlux Governor";
    const short = 30 - owned.size;
    if (short !== 1) q.fail(`the fixture should be 1 short, reads ${short}`);
    const augsOf = (f) => Fx.factions[f].augs.filter((a) => a.name === NFG || !owned.has(a.name)).map((a) => ({ name: a.name, repReq: a.repReq, mults: a.mults }));
    // The combat legs, priced as joinplan does (mults 1: the save digest has
    // none; a lower bound on the rate, so an upper bound on the hours).
    const SK = ["strength", "defense", "dexterity", "agility"];
    const person = {
      skills: { ...Fx.skills }, exp: { ...Fx.exp }, city: Fx.city, money: 1e9,
      mults: Object.fromEntries([...SK, "charisma", "hacking"].flatMap((s) => [[s, 1], [`${s}_exp`, 1]])),
    };
    const gym = (to) => BP.gymLegs(Object.fromEntries(SK.map((s) => [s, to])), person, 1);
    const g30 = gym(30), g75 = gym(75);
    if (!g30 || !isFinite(g30.hours)) q.fail("the Slum Snakes combat leg must price (it was unpriceable on a cash-only money figure)");
    const poor = BP.gymLegs(Object.fromEntries(SK.map((s) => [s, 30])), { ...person, city: "Chongqing", money: 51534 }, 1);
    q.note(`gym to 30: ${g30?.hours?.toFixed(2)}h at ${g30?.gym}; to 75: ${g75?.hours?.toFixed(2)}h; on BN8's $51k cash alone from Chongqing: ${poor ? poor.hours.toFixed(2) + "h" : "unpriceable (no gym in reach of the fare)"}`);
    const facs = Fx.joined.filter((f) => Fx.factions[f]).map((f) => ({ name: f, rep: Fx.factions[f].rep, favor: Fx.factions[f].favor, augs: augsOf(f) }));
    facs.push({ name: "Slum Snakes", rep: 0, favor: Fx.factions["Slum Snakes"].favor, augs: augsOf("Slum Snakes"), joinWaitHours: 0, joinWorkHours: g30?.hours ?? 0 });
    facs.push({ name: "Tetrads", rep: 0, favor: Fx.factions["Tetrads"].favor, augs: augsOf("Tetrads"), joinWaitHours: 0, joinWorkHours: g75?.hours ?? 0 });
    const base = 4 / 1.5; // ~4 rep/s live at the worked faction's favour
    const names = new Set();
    for (const f of facs) for (const a of f.augs) if (a.name !== NFG && !owned.has(a.name)) names.add(a.name);
    const withT = FP.planSchedule(facs.map((f) => ({ ...f })), base, { tickets: { names, left: short } });
    const without = FP.planSchedule(facs.map((f) => ({ ...f })), base, {});
    const first = withT?.segments?.[0];
    q.note(`with the count gate's tickets: ${first?.faction} for ${first?.hours?.toFixed(2)}h unlocking ${JSON.stringify(first?.unlocks)}; without: ${without?.segments?.[0]?.faction} (${without?.segments?.[0]?.hours?.toFixed(1)}h)`);
    if (!(first?.faction === "Slum Snakes" && first.unlocks?.includes("LuminCloaking-V1 Skin Implant"))) q.fail("the schedule must take Slum Snakes' LuminCloaking-V1 first when one ticket finishes the gate");
    if (without?.segments?.[0]?.faction === "Slum Snakes") q.fail("control: without tickets the multiplier walk should not have chosen Slum Snakes (the check would prove nothing)");
    // Other nodes: no tickets passed, schedule unchanged.
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    if (!/if \(m\?\.ScriptHackMoneyGain !== 0 \|\| !\(m\?\.DaedalusAugsRequirement > 0\)\) return null/.test(prog) || !/gangRepIn, countTickets, countRoute: countRoute\?\.best \?\? null \}/.test(prog)) q.fail("the schedule must receive the count gate's tickets where money is capital, and only there");
    if (!/money: ns\.getServerMoneyAvailable\('home'\) \+ stockEquity,\s*\n\s*augCount/.test(prog) || !/city: player\.city,\s*\n\s*money: ns\.getServerMoneyAvailable\('home'\) \+ stockEquity/.test(prog)) q.fail("the join forecasts must count the trader's book as money (the fare, the money legs)");
    if (!/feeFundable\(ns\.getServerMoneyAvailable\('home'\) \+ stockEquity, gymFee\)/.test(prog) || !/order\('gym', \[bodyStep\.gym, cls\], [^\n]*, gymCost\)/.test(prog)) q.fail("the gym step must fund its fees from the book (fee floor on cash+equity, the order carrying its cost)");
    if (!/joinReadyButCash\(reqs, player, \{ companyRep: [^\n]*\)\s*\n\s*if \(!ready\.ready\) todo\.push\(`\$\{scheduleTarget\}/.test(prog)) q.fail("an unjoined schedule target ready but for cash must be chased (raise, travel, join)");
    if (/readJson\(ns, '\/tel\/gang\.txt'\)\?\.faction \?\? null(?! :)/.test(prog.replace(/ns\.gang\.inGang\(\) \? readJson\(ns, '\/tel\/gang\.txt'\)\?\.faction \?\? null : null/g, ""))) q.fail("a gang faction is the gang's only when a gang exists (ns.gang.inGang())");
  }
  checks.push(q);

  // -----------------------------------------------------------------------
  const r8 = new Check("B8r", "a join's combat legs hold the work slot until ALL four stats reach the target, str -> def -> dex -> agi (live 11:47: strength done, slot released, defense 1 of 30)");
  {
    r8.examined(6);
    const BP = await import("../../bodyplan.js");
    const SK = ["strength", "defense", "dexterity", "agility"];
    // joinplan's shape: ONE blocker per skills requirement, each with its own gym leg.
    const blockers = [
      ...SK.map((s) => ({ type: "skills", hours: 0.02, gym: { hours: 0.02, gym: "Powerhouse Gym", city: "Sector-12", legs: [{ stat: s, to: 30, hours: 0.02 }] } })),
      { type: "money", hours: 0 },
      { type: "karma", hours: 0 },
    ];
    const skills = { strength: 1, defense: 1, dexterity: 1, agility: 1 };
    const seen = [];
    for (let pass = 0; pass < 12; pass++) {
      const leg = BP.nextGymLeg(blockers, skills);
      if (!leg) break;
      seen.push(leg.stat);
      skills[leg.stat] = Math.min(30, skills[leg.stat] + 15); // a pass trains 15 levels
    }
    const order = [...new Set(seen)];
    r8.note(`passes: ${seen.join(" ")}`);
    if (order.join(",") !== SK.join(",")) r8.fail(`the legs must run strength, defense, dexterity, agility; ran ${order.join(",")}`);
    if (SK.some((s) => skills[s] < 30)) r8.fail("the claim released before every stat reached 30", JSON.stringify(skills));
    if (BP.nextGymLeg(blockers, skills) !== null) r8.fail("with every stat at 30 there is no leg (the slot is released)");
    // The old rule (first gym blocker only) released after strength — the regression.
    const old = blockers.find((b) => b.gym)?.gym?.legs?.find((l) => ({ strength: 30, defense: 1 })[l.stat] < l.to);
    if (old) r8.fail("fixture: the old first-blocker rule should have found nothing after strength");
    if (BP.nextGymLeg([{ gym: { why: "does not fit", legs: [{ stat: "strength", to: 30 }] } }], { strength: 1 }) !== null) r8.fail("a gym leg that does not fit the window disqualifies the step");
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    if (!/const leg = nextGymLeg\(f\?\.blockers, player\.skills\)/.test(prog)) r8.fail("the body step must take its gym leg from every blocker");
    if (!/if \(bodyStep && canWork && !flags\.dry\) \{[\s\S]{0,700}slotOwner = 'body'/.test(prog)) r8.fail("the body step must claim the work slot");
  }
  checks.push(r8);

  // -----------------------------------------------------------------------
  const s8 = new Check("B8s", "replay 11:28: the 30th distinct augmentation is the one whose route minimises the simulated node exit, not the cheapest ticket");
  {
    s8.examined(8);
    const C = await import("../../countexit.js");
    const BP = await import("../../bodyplan.js");
    const FP = await import("../../factionplan.js");
    const FV = await import("../../favor.js");
    const Fx = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn8-1128.json"), "utf8"));
    const owned = new Set(Fx.owned);
    const SK = ["strength", "defense", "dexterity", "agility"];
    const person = { skills: { ...Fx.skills }, exp: { ...Fx.exp }, city: Fx.city, money: 1e9, mults: Object.fromEntries([...SK, "charisma", "hacking"].flatMap((s) => [[s, 1], [`${s}_exp`, 1]])) };
    const gymH = (to) => BP.gymLegs(Object.fromEntries(SK.map((s) => [s, to])), person, 1).hours;
    const fwrg = bitNodeMults(8).FactionWorkRepGain;
    const toAug = (a) => ({ name: a.name, baseCost: a.price, repReq: a.repReq, mults: a.mults, prereqs: a.prereqs ?? [] });
    const offers = Fx.joined.filter((f) => Fx.factions[f]).flatMap((f) => Fx.factions[f].augs.map((a) => ({ ...toAug(a), faction: f, factionRep: Fx.factions[f].rep, favor: Fx.factions[f].favor })));
    const candidates = ["Slum Snakes", "Tetrads"].map((f, i) => ({ name: f, joinH: gymH(i ? 75 : 30), rep: 0, favor: Fx.factions[f].favor, augs: Fx.factions[f].augs.map(toAug) }));
    // Base reputation rate ~4/s at the worked faction (live), favour ~0.5 there.
    const routes = C.countRoutes({ offers, candidates, owned, repPerSec: 4 / 1.5, donation: (f, rep) => FV.donationForRep(rep, 1, fwrg) });
    const nfgA = Fx.factions["Slum Snakes"].augs.find((a) => a.name === "NeuroFlux Governor");
    const count = { short: 30 - owned.size, ladder: [], nfg: { price: nfgA.price, level: 0 } };
    const r = C.bestCountRoute(X.bestExitPolicy, Fx.exitInputs.inputs, count, routes);
    const lumin = r.tried.find((t) => t.name === "LuminCloaking-V1 Skin Implant" && t.faction === "Slum Snakes" && t.hours !== null);
    if (!r.best) s8.fail("the route choice is unpriced on the replay", r.why);
    else if (!lumin) s8.fail("the LuminCloaking-V1 route must price (it is a candidate)");
    else {
      const bestMult = r.tried.find((t) => t.hours !== null && t.hacking > 1);
      s8.note(`${routes.length} routes; LuminCloaking-V1 (Slum Snakes, ${lumin.via}, $${(lumin.price / 1e6).toFixed(0)}m, detour ${lumin.detourH}h): exit ${lumin.hours}h`);
      s8.note(`best multiplier-bearing: ${bestMult.name} (${bestMult.faction}, ${bestMult.via}, x${bestMult.hacking} hacking, x${bestMult.exp} exp, $${(bestMult.price / 1e6).toFixed(0)}m, detour ${bestMult.detourH}h): exit ${bestMult.hours}h`);
      s8.note(`chosen: ${r.best.name} at ${r.best.route.faction} via ${r.best.route.via}, exit ${r.best.hours.toFixed(2)}h (${(lumin.hours - r.best.hours).toFixed(2)}h sooner than the cheapest ticket)`);
      if (r.tried.some((t) => t.hours !== null && t.hours < r.best.hours - 1e-3)) s8.fail("the chosen route must be the soonest exit priced");
      if (!(r.best.hours <= lumin.hours)) s8.fail("the chosen route cannot exit later than the cheapest ticket's");
      if (r.best.name === "LuminCloaking-V1 Skin Implant") s8.note("(on this replay the cheapest ticket is also the exit's choice)");
      // Gains are the augmentation's real multipliers; a zero-gain ticket stays 1.
      if (!(lumin.hacking === 1 && bestMult.hacking > 1)) s8.fail("routes must carry each augmentation's real gains");
      // The schedule then works the chosen route's faction.
      const facs = Fx.joined.filter((f) => Fx.factions[f]).map((f) => ({ name: f, rep: Fx.factions[f].rep, favor: Fx.factions[f].favor, augs: Fx.factions[f].augs.filter((a) => a.name === "NeuroFlux Governor" || !owned.has(a.name)).map((a) => ({ name: a.name, repReq: a.repReq, mults: a.mults })) }));
      for (const c of candidates) facs.push({ name: c.name, rep: 0, favor: c.favor, augs: Fx.factions[c.name].augs.filter((a) => !owned.has(a.name)).map((a) => ({ name: a.name, repReq: a.repReq, mults: a.mults })), joinWaitHours: 0, joinWorkHours: c.joinH });
      const sched = FP.planSchedule(facs, 4 / 1.5, { tickets: { names: new Set([r.best.name]), left: 1 } });
      const seg = sched?.segments?.find((sg) => sg.unlocks?.includes(r.best.name));
      if (r.best.route.via === "work" && !seg) s8.fail(`the schedule must grind to the chosen route (${r.best.name})`);
      else if (seg) s8.note(`schedule: ${seg.faction} ${seg.hours.toFixed(2)}h unlocking ${r.best.name}`);
    }
    // The priced route is the one bought: forced into the first batch even
    // when the ordinary ladder holds a cheaper ticket.
    const forced = C.bestCountRoute(X.bestExitPolicy, Fx.exitInputs.inputs, { ...count, ladder: [{ name: "Cheap", price: 1e6, laterPrice: 1e6, hacking: 1 }] }, [{ name: "Dear", faction: "F", via: "ready", price: 5e7, laterPrice: 5e7, detourH: 0, hacking: 1.1, exp: 1, rep: 1 }]);
    if (!forced.best?.result?.firstBatch?.chosen?.includes("Dear")) s8.fail("the route being priced must be in the first batch, not swapped for the cheapest ticket");
    // A forced route the first batch cannot afford is not priced as if bought.
    const tooDear = C.bestCountRoute(X.bestExitPolicy, { ...Fx.exitInputs.inputs, money: 1e6, capitalReturnPerSec: 0 }, count, [{ name: "X", faction: "F", via: "ready", price: 1e15, laterPrice: 1e15, detourH: 0, hacking: 2, exp: 1, rep: 1 }]);
    if (tooDear.best) s8.fail("an unaffordable route must not price");
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    if (!/if \(joinCtx\.countRoute\?\.name\) hooks\.tickets = \{ names: new Set\(\[joinCtx\.countRoute\.name\]\), left: 1 \}/.test(prog)) s8.fail("the schedule's ticket must be the exit-chosen route's augmentation (flat value only as the fallback)");
    if ((prog.match(/countRoute: countRouteNow/g) ?? []).length !== 2) s8.fail("both gate writes must publish the route choice");
  }
  checks.push(s8);

  // -----------------------------------------------------------------------
  const t8 = new Check("B8t", "one exit: the chosen count route re-enters the gate's comparison on the gate's inputs (live 12:12: exitH 68.7h beside a route 'exit 27.3h'); the gym legs match the live gym rate");
  {
    t8.examined(7);
    const C = await import("../../countexit.js");
    const BP = await import("../../bodyplan.js");
    const Fx = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn8-1128.json"), "utf8"));
    const inputs = Fx.exitInputs.inputs;
    const nfgA = Fx.factions["Slum Snakes"].augs.find((a) => a.name === "NeuroFlux Governor");
    const count = { short: 1, ladder: [], nfg: { price: nfgA.price, level: 0 } };
    const route = { name: "R", faction: "F", via: "work", price: 4e8, laterPrice: 4e8, detourH: 1.48, hacking: 1, exp: 1, rep: 1.15 };
    // Same inputs, same forced batch, same install time: the ranking's hours
    // and the gate's route wait are one number.
    const ranked = C.bestCountRoute(X.bestExitPolicy, inputs, count, [route]);
    const gateWait = C.bestCountExit(X.bestExitPolicy, inputs, { ...count, ladder: [{ ...route, must: true }] }, { firstInstallH: route.detourH });
    if (!(ranked.best && gateWait.best && Math.abs(ranked.best.hours - gateWait.best.hours) < 1e-9)) t8.fail("the route's ranked exit and the gate's route wait must be the same computation on the same inputs", `${ranked.best?.hours} vs ${gateWait.best?.hours}`);
    else t8.note(`route exit ${ranked.best.hours.toFixed(2)}h both ways`);
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    if (!/waitsC\.push\(\{ waitMs: Math\.round\(w \* 3600000\), H: took \? r\.best\.hours : null[^\n]*route: route\.name/.test(prog)) t8.fail("the chosen route must enter the count-aware comparison as a wait");
    if (!/countExitNowOf\(gangInputs0\(\), cc, countRoute\?\.best\?\.route \?\? null\)/.test(prog)) t8.fail("the unplanned path's exit must include the chosen route too");
    if (!/if \(!exitCompare\?\.countAware && countTickets\) \{[\s\S]{0,400}countExitNowOf\(exitInputsOf\([^\n]*countRoute\?\.best\?\.route \?\? null\)/.test(prog)) t8.fail("with the count short, a non-count-aware comparison must not publish the ordinary model's exit (the live 68.7h)");
    if (/chosen: countRoute\.best \? \{[^\n]* exitH:/.test(prog) || !/rankExitH: [^\n]*rankBasis:/.test(prog)) t8.fail("the route record must not publish a second 'exitH': its ranking figure is rankExitH with its basis named");
    const hc = fs.readFileSync(path.join(REPO_ROOT, "tools/healthcheck.mjs"), "utf8");
    if (!/TWO EXITS: installgate exitH/.test(hc)) t8.fail("healthcheck must fail when the published exit is later than the chosen route's gate exit");
    // THE GYM LEGS, against the live game (history.jsonl, 2026-09-26): at
    // Powerhouse Gym strength exp went 8413.62 -> 8941.38 over 20.8s of play
    // (25.37/s), and strength read 165 at exp 8058.40 and 171 at 8941.38.
    // bodyplan's formula (Work/Formulas.ts:108-121: classInfo.strExp 1 x
    // location.expMult 10 x person.strength_exp per second; skill.ts:13) with
    // those mults reproduces the published leg: 0.0757h from 8058 to 200.
    const measured = (8941.376 - 8413.622) / 20.8;
    const levelMult = 171 / (32 * Math.log(8941.376 + 534.6) - 200);
    const person = { skills: { strength: 165, defense: 1, dexterity: 2, agility: 1, charisma: 2, hacking: 782, intelligence: 112 }, exp: { strength: 8058.4, defense: 0, dexterity: 0, agility: 0, charisma: 0, hacking: 0 }, city: "Sector-12", money: 1e12, mults: { strength: levelMult, strength_exp: measured / 10, defense: 1, defense_exp: 1, dexterity: 1, dexterity_exp: 1, agility: 1, agility_exp: 1, charisma: 1, charisma_exp: 1, hacking: 1, hacking_exp: 1 } };
    const rate = BP.gymRate(BP.GYMS.find((g) => g.name === "Powerhouse Gym"), "strength", person, 1);
    const h = BP.hoursToStat("strength", 200, person, rate);
    const err = Math.abs(h - 0.0757) / 0.0757;
    t8.note(`gym: measured ${measured.toFixed(2)} str exp/s (x${(measured / 10).toFixed(3)} strength_exp at Powerhouse's x10), level mult ${levelMult.toFixed(3)}; strength 165 -> 200: ${h.toFixed(4)}h vs the published 0.0757h (${(err * 100).toFixed(1)}% apart); from level 1 with mults 1 it would be ${BP.hoursToStat("strength", 200, { ...person, exp: { ...person.exp, strength: 0 }, mults: { ...person.mults, strength: 1, strength_exp: 1 } }, 10).toFixed(2)}h`);
    if (!(err < 0.1)) t8.fail(`the gym leg must reproduce the live game within 10% (${(err * 100).toFixed(1)}%)`);
  }
  checks.push(t8);

  // -----------------------------------------------------------------------
  const u8 = new Check("B8u", "replay 12:12->12:17: a committed count route is kept unless beaten by more than the forecast error over its remaining detour; a route that stops pricing is dropped with its reason");
  {
    u8.examined(7);
    const C = await import("../../countexit.js");
    const Fx = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn8-1128.json"), "utf8"));
    const inputs = Fx.exitInputs.inputs;
    const nfgA = Fx.factions["Slum Snakes"].augs.find((a) => a.name === "NeuroFlux Governor");
    const count = { short: 1, ladder: [], nfg: { price: nfgA.price, level: 0 } };
    // 12:12: The Syndicate's route, its detour largely spent after an hour of
    // strength training (def/dex/agi legs and the rep grind left); 12:17: the
    // ranking's new best, SmartJaw at Bachman by donation behind a company-rep
    // join held continuously (5.9h).
    const syndicate = { name: "The Shadow's Simulacrum", faction: "The Syndicate", via: "work", price: 4e8, laterPrice: 4e8, detourH: 0.95, hacking: 1, exp: 1, rep: 1.15 };
    const smartjaw = { name: "SmartJaw", faction: "Bachman & Associates", via: "donation", price: 1.8e11, laterPrice: 1.8e11, detourH: 5.86, hacking: 1, exp: 1, rep: 1.25 };
    const routes = [syndicate, smartjaw];
    const ranked = C.bestCountRoute(X.bestExitPolicy, inputs, count, routes);
    const hS = ranked.tried.find((t) => t.name === syndicate.name)?.hours, hJ = ranked.tried.find((t) => t.name === smartjaw.name)?.hours;
    u8.note(`ranked: ${syndicate.name} ${hS}h, SmartJaw ${hJ}h — best ${ranked.best?.name}`);
    const committed = { name: syndicate.name, faction: syndicate.faction, via: syndicate.via };
    // Force the case the lead saw: an alternative ranked first by a margin smaller than the error.
    const flip = { ...ranked, best: { name: smartjaw.name, hours: hS - 3, route: smartjaw } };
    const kept = C.commitRoute(flip, routes, committed, { tolPerH: 8.9 });
    if (!(kept.stayed && kept.best?.name === syndicate.name)) u8.fail("a 3h gain inside 8.9h/h x 0.95h of remaining detour must keep the committed route", kept.why);
    else u8.note(`kept: ${kept.why}`);
    const clear = C.commitRoute({ ...ranked, best: { name: smartjaw.name, hours: hS - 20, route: smartjaw } }, routes, committed, { tolPerH: 8.9 });
    if (!(clear.switched && clear.best?.name === smartjaw.name)) u8.fail("a 20h gain beyond the tolerance must switch", clear.why);
    const gone = C.commitRoute({ ...ranked, best: { name: smartjaw.name, hours: hS + 5, route: smartjaw }, tried: ranked.tried.map((t) => (t.name === syndicate.name ? { ...t, hours: null, why: "join unpriceable" } : t)) }, routes, committed, { tolPerH: 8.9 });
    if (!(gone.switched && /no longer prices: join unpriceable/.test(gone.why))) u8.fail("a committed route that no longer prices is dropped, naming why", gone.why);
    const none = C.commitRoute(ranked, routes, null, { tolPerH: 8.9 });
    if (!(none.switched && none.best?.name === ranked.best.name)) u8.fail("with nothing committed the best is taken");
    // The committed route's exit is priced from the CURRENT state: a shorter
    // remaining detour prices a sooner exit (progress credited).
    const fresh = C.bestCountRoute(X.bestExitPolicy, inputs, count, [{ ...syndicate, detourH: 2.0 }]).best?.hours;
    if (!(typeof fresh === "number" && fresh > hS)) u8.fail("the same route with more detour left must exit later (the remaining detour, not the full one, is what is priced)");
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    if (!/commitRoute\(ranked, routes, committed, \{ tolPerH: exitCalibrationOf\(ns, info\)\.tolPerH \}\)/.test(prog) || !/ns\.write\(COUNT_ROUTE_FILE/.test(prog)) u8.fail("progress.js must commit the route through commitRoute with the measured tolerance and persist it this life");
    if (!/b\?\.spansInstalls && typeof b\.holdH === 'number'[^\n]*b\.holdH - b\.hours/.test(prog)) u8.fail("a join leg that ladders across installs must be priced as its continuous hold on a route (one install after the detour)");
  }
  checks.push(u8);

  // -----------------------------------------------------------------------
  const v8 = new Check("B8v", "live 12:40: the committed route's current leg drives the work slot (company desk for Bachman's 400k company rep, slot 'company'), measured progress is published, and the healthcheck fails a route not executed");
  {
    v8.examined(9);
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    const hc = fs.readFileSync(path.join(REPO_ROOT, "tools/healthcheck.mjs"), "utf8");
    // The state the lead saw: ADR-V2 Pheromone Gene at Bachman & Associates via
    // work committed, jobs {}, the player on The Black Hand's faction work.
    const bachman = [{ type: "employedBy", company: "Bachman & Associates" }, { type: "companyReputation", company: "Bachman & Associates", reputation: 400000 }];
    const noJob = econ.joinReadyButCash(bachman, { jobs: {} }, { companyRep: { "Bachman & Associates": 0 } });
    if (noJob.ready !== false || !/not employed/.test(noJob.why)) v8.fail("no job at Bachman: the join is not ready and says why", JSON.stringify(noJob));
    const short = econ.joinReadyButCash(bachman, { jobs: { "Bachman & Associates": "Software Engineer" } }, { companyRep: { "Bachman & Associates": 120000 } });
    if (short.ready !== false || !/120000 of 400000/.test(short.why)) v8.fail("company rep short: measured have-of-need in the reason", JSON.stringify(short));
    if (econ.joinReadyButCash(bachman, { jobs: { "Bachman & Associates": "x" } }, { companyRep: { "Bachman & Associates": 400000 } }).ready !== true) v8.fail("the company legs met: ready to join");
    // Wiring: the route leg decides the work, not the general schedule.
    if (!/const wantCompany = routeLead\s*\n\s*\? routeLead\.company/.test(prog)) v8.fail("the route's company leg must set the desk (wantCompany)");
    if (!/if \(routeLead\) \{\s*\n\s*scheduleTarget = routeLead\.faction/.test(prog)) v8.fail("the route's faction must become the target (body step, join chase, faction work)");
    if (!/!\(schedule\?\.current\?\.workH > 0 \|\| routeLead\)/.test(prog)) v8.fail("the body step must run the route's gym/crime legs");
    if (!/const deskGuarded = !routeLead && /.test(prog)) v8.fail("a committed route's desk is not deferred by the schedule's estimated-ranking guard");
    if (!/slotOwner = 'company'/.test(prog)) v8.fail("the desk must claim the work slot as 'company'");
    if (!/have = joinState\?\.companyCtx\?\.repByCompany\?\.\[company\]/.test(prog) || !/routeLeg: routeLead \? \{ kind: routeLead\.kind, target: routeLead\.target/.test(prog)) v8.fail("progress must publish the route leg with measured company progress (have, need, hours at the measured rate)");
    if (!/PLAN NOT EXECUTED: \$\{mismatch\}/.test(hc) || !/mismatch && prev\?\.planMismatch/.test(hc)) v8.fail("healthcheck F must fail PLAN NOT EXECUTED on two samples of a route leg the save does not show");
  }
  checks.push(v8);

  return checks;
}
