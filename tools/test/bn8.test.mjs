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
    const v1 = GW.gangVerdict({ node: 8, mults: bitNodeMults(8), grindHours: 20, gangExit: GW.gangExit(X.bestExitPolicy, BN8, s1, 20, null) });
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

  return checks;
}
