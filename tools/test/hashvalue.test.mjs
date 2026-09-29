// [HV] WHAT A HASH IS WORTH, on the exit — the BitNode 9 audit of 2026-09-29.
//
// The audit's finding: at the live state money does not bind the exit (money
// at the install point $8.8t on a batch the ladder cannot grow; in the final
// window the work slot — grafts + the Daedalus leg — binds, and a fleet worth
// $1e12/s there does not shorten it). So a hash SOLD is worth ~nothing, and
// what hashes buy beyond money is where their value is: the exit faction's
// REPUTATION through generated coding contracts, and the fleet's study exp.
// Those were unpriced (contracts: "reputation not simulated"; the exit had no
// contract term at all). Pinned here, each so that removing it turns red:
//
//   HV1  THE GAME: contract reputation reaches exactly the joined factions
//        offering hacking work (FactionInfo.tsx offerHackingWork); the k-th
//        generated contract of a life costs 25k hashes (HashUpgrade.getCost),
//        which contractplan.contractsForHashes inverts exactly
//   HV2  THE SIMULATOR: exitplan contractRep banks the exit faction's share
//        of every contract bought from the join until the ground work ends;
//        nothing bought before the join counts; a live final window prices
//        from the upgrade's level now; lifeplan.freshHacknetStreams' gross
//        hashes agree with the fleet the flow is built from
//   HV3  THE DECISION: hashplan prices a final-window contract as
//        exit(its rep banked, the stream one level up) - exit(the same hashes
//        sold), and the fleet's study exp as a FLAT term where the exit's exp
//        rate is level-shaped
//   HV4  THE AUDIT on the live 22:57Z inputs, both trajectories each: the
//        final window's fleet money moves the exit < 0.01h; a $1e12/s fleet
//        does not shorten it; the contracts shorten it by > 0.1h
//   HV5  THE WIRING: progress.js publishes contractRep (ctauto fresh, factions
//        counted by the game's rule); hashspend.js prices the exit faction's
//        share only in the final window once it is joined, counts hacking-work
//        factions (not every faction) and publishes the upgrade's level
//
// CALIBRATION: every mechanic against game source or the bn9 bundle; the
// exit numbers are the simulator's (exitplan's own calibration, nothing more).

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const X = await import("../../exitplan.js");
const P = await import("../../plan.js");
const L = await import("../../lifeplan.js");
const CP = await import("../../contractplan.js");
const HS = await import("../../hashplan.js");
const HP = await import("../../hacknetplan.js");

const GAME = path.resolve(REPO_ROOT, "../bitburner");
const gsrc = (f) => fs.readFileSync(path.join(GAME, f), "utf8");
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
const close = (a, b, rel = 1e-9) => a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b)));
const FX = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-hashvalue-2257.json"), "utf8"));
const EI = FX.exitinputs;
const I = EI.inputs;
const leg = (r, name) => r?.legs?.find((l) => l.leg === name);
// A final window that is NOW, the exit faction joined: the rep leg binds (30 rep/s ground).
const LIVE = { money: 2e9, incomePerSec: 2e5, hacking: 3000, hackingExp: X.expForLevel(3000, 16), hackingMult: 16, expPerSec: 1e7, repPerSec: 30, exitRep: 0, exitFavor: 0, cycleHours: 6, multGainPerCycle: 1.2, exitLevel: 6000, joinMoney: 0, terminalRep: 2.5e6 };

export async function run() {
  const checks = [];

  // ---------------------------------------------------------------------
  {
    const c = new Check("HV1", "THE GAME: contract rep goes to joined hacking-work factions; the k-th generated contract costs 25k hashes, and contractsForHashes inverts it");
    // FactionInfo.tsx: every faction whose info offers hacking work, by its enum's display name.
    const enums = gsrc("src/Faction/Enums.ts");
    const nameOf = Object.fromEntries([...enums.matchAll(/^\s*(\w+) = "([^"]+)",/gm)].map((m) => [m[1], m[2]]));
    const info = gsrc("src/Faction/FactionInfo.tsx");
    const want = new Set();
    for (const part of info.split(/\n  \[FactionName\./).slice(1)) {
      const key = part.split("]")[0];
      if (/offerHackingWork: true/.test(part)) want.add(nameOf[key]);
    }
    c.examined(want.size);
    if (want.size < 20) c.fail(`parsed only ${want.size} hacking-work factions from FactionInfo.tsx — the parse is not looking`);
    for (const f of want) if (!CP.HACKING_WORK_FACTIONS.has(f)) c.fail(`${f} offers hacking work in the game but is missing from contractplan.HACKING_WORK_FACTIONS`);
    for (const f of CP.HACKING_WORK_FACTIONS) if (!want.has(f)) c.fail(`contractplan.HACKING_WORK_FACTIONS carries ${f}, which offers no hacking work`);
    // The reward rule itself: filtered on offerHackingWork, one at random or split.
    const pm = gsrc("src/PersonObjects/Player/PlayerObjectGeneralMethods.ts");
    if ((pm.match(/Player\.factions\.filter\(\(fac\) => Factions\[fac\]\.getInfo\(\)\.offerHackingWork\)/g) ?? []).length !== 2) c.fail("gainCodingContractReward no longer filters both faction rewards on offerHackingWork");
    if (CP.contractFactionCount(["NiteSec", "Slum Snakes", "Tetrads", "CyberSec", "Daedalus"]) !== 3) c.fail("the gang-only factions (Slum Snakes, Tetrads) take no contract reputation");
    // Costs: the game's HashUpgrade against the inverse.
    let G = null;
    try {
      G = (await import("../sim/bn9/game.mjs")).default;
    } catch (e) {
      c.fail("could not load tools/sim/bn9/game.mjs — the cost check cannot run, which is NOT a pass", String(e).slice(0, 200));
    }
    if (G) {
      const u = G.HashUpgrades["Generate Coding Contract"];
      for (const L0 of [0, 1, 7, 40]) for (const n of [1, 2, 13, 150]) {
        c.examined(1);
        let spent = 0;
        for (let k = 0; k < n; k++) spent += u.getCost(L0 + k, 1);
        const got = CP.contractsForHashes(spent, L0);
        if (!close(got, n, 1e-9)) c.fail(`from level ${L0}, the game's price of ${n} contracts (${spent} hashes) buys ${got} by contractsForHashes`);
        if (!(CP.contractsForHashes(spent - 1, L0) < n)) c.fail(`one hash short of ${n} contracts must buy fewer`);
      }
      c.note(`${want.size} hacking-work factions; 16 cost points from HashUpgrades; 1 hour of 9.1 hashes/s from level 0 buys ${CP.contractsForHashes(9.1 * 3600, 0).toFixed(1)} contracts`);
    }
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  const r = CP.expectedReward({ totalSourceFileLevels: 9, nodeContractMoney: 1, hasHackingFaction: true, hasJob: false });
  const streams = L.freshHacknetStreams(I, 48);
  {
    const c = new Check("HV2", "THE SIMULATOR: contractRep banks the exit faction's share of every contract from the join; none before it; a live window prices from the level now");
    c.examined(6);
    const flow = L.freshHacknetFlow(I, 48);
    if (JSON.stringify(flow) !== JSON.stringify(streams?.flow)) c.fail("freshHacknetStreams.flow must be freshHacknetFlow (one simulated rebuild)");
    const cum = streams?.hashCum ?? [];
    if (cum.length < 10 || cum.some((p, i) => i > 0 && !(p[0] > cum[i - 1][0] && p[1] >= cum[i - 1][1]))) c.fail(`the gross hash curve must be hourly and non-decreasing: ${JSON.stringify(cum.slice(0, 6))}`);
    {
      const rec = [];
      L.freshLifeMoney(I, 48, 1, rec, { steps: Math.ceil(48 / 0.125), decisions: Math.ceil(48 / 0.25) });
      const earned = rec.reduce((a, x) => a + (x.earn ?? 0), 0);
      if (!close(cum[cum.length - 1][1], earned / HP.DOLLARS_PER_HASH, 1e-6)) c.fail(`the curve's last point ${cum[cum.length - 1][1]} must be every hash the fleet earned (${earned / HP.DOLLARS_PER_HASH})`);
    }
    // After an install: the same policy with and without the contracts.
    const k = 8;
    const withC = { ...I, installsFirst: 1, contractRep: { perContract: r.factionRep, factions: k, hashCum: cum } };
    const x0 = X.exitHours({ ...I, installsFirst: 1 }, 1);
    const x1 = X.exitHours(withC, 1);
    const l0 = leg(x0, "exit reputation");
    const l1 = leg(x1, "exit reputation");
    if (!(x1.hours < x0.hours) || !(l1.hours < l0.hours)) c.fail(`the contracts must shorten the rep leg and the exit: ${l0?.hours} -> ${l1?.hours}h, ${x0.hours} -> ${x1.hours}h`);
    // Negligible share: the same exit.
    const xTiny = X.exitHours({ ...withC, contractRep: { ...withC.contractRep, factions: 1e9 } }, 1);
    if (!(Math.abs(xTiny.hours - x0.hours) < 1e-3)) c.fail(`a negligible share must price as no contracts: ${xTiny.hours} vs ${x0.hours}`);
    // Every hash made before the join (the curve flat from hour 0.01): nothing.
    const early = [[0, 0], [0.01, cum[cum.length - 1][1]], [48, cum[cum.length - 1][1]]];
    const xEarly = X.exitHours({ ...withC, contractRep: { ...withC.contractRep, hashCum: early } }, 1);
    if (!close(xEarly.hours, x0.hours, 1e-9)) c.fail(`hashes made before the join buy the exit faction nothing: ${xEarly.hours} vs ${x0.hours}`);
    // Unreadable: absent, never a guess.
    if (X.exitHours({ ...withC, contractRep: { ...withC.contractRep, factions: 0 } }, 1).hours !== x0.hours) c.fail("0 factions must read as no contract term");
    // A final window that is now: the live rate from the level now; a higher level buys fewer.
    c.examined(2);
    const now = LIVE;
    const y0 = X.exitHours(now, 0);
    const yA = X.exitHours({ ...now, contractRep: { perContract: r.factionRep, factions: k, hashPerSec: 9.1, level0: 0 } }, 0);
    const yB = X.exitHours({ ...now, contractRep: { perContract: r.factionRep, factions: k, hashPerSec: 9.1, level0: 300 } }, 0);
    if (!(yA.hours < yB.hours && yB.hours < y0.hours)) c.fail(`live window: level 0 < level 300 < none must order the exits: ${yA.hours}, ${yB.hours}, ${y0.hours}`);
    c.note(`fixture (22:57Z) after one install, k=${k}: rep leg ${l0.hours.toFixed(2)} -> ${l1.hours.toFixed(2)}h (${Math.round(parseFloat((l1.detail.match(/\((\d+) of it/) ?? [])[1] ?? 0))} rep from contracts), exit ${x0.hours.toFixed(3)} -> ${x1.hours.toFixed(3)}h; live window now: ${y0.hours.toFixed(2)}h, ${yA.hours.toFixed(2)}h from level 0`);
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("HV3", "THE DECISION: a final-window contract is exit(rep banked, the stream a level up) - exit(the selling policy); the fleet's study exp is flat on a shaped exp rate");
    const now = Date.parse("2026-09-29T23:00:00Z");
    const k = 8;
    const inputs = { ...LIVE, contractRep: { perContract: r.factionRep, factions: k, hashPerSec: 9.1, level0: 4 } };
    const rec = { at: new Date(now - 60e3).toISOString(), lastAugReset: 7, inputs, finalWindow: true, W: null, eRep: EI.eRep, eBudget: EI.eBudget };
    const fns = { bestExitPolicy: X.bestExitPolicy, spendRuns: X.spendRuns };
    const share = r.factionRep / k;
    const opt = { name: "Generate Coding Contract", cost: 125, effect: { money: r.money, exitRep: share, contractLevels: 1 }, policy: "contracts" };
    const d = HS.decideHashSpend({ hashes: 200, capacity: 576, record: rec, lastAugReset: 7, now, fns, options: [opt] });
    const e = d.exits?.[0];
    const x = { eRep: EI.eRep, eBudget: EI.eBudget };
    const withH = X.bestExitPolicy({ ...inputs, ...x, money: inputs.money + r.money, exitRep: (inputs.exitRep ?? 0) + share, contractRep: { ...inputs.contractRep, level0: 5 } }, 0, 0).best.hours;
    // The alternative is the selling POLICY: this sale and every later hash sold (no contract stream).
    const sellH = X.bestExitPolicy({ ...inputs, ...x, money: inputs.money + (125 / 4) * 1e6, contractRep: undefined }, 0, 0).best.hours;
    c.examined(3);
    if (!e || !close(e.deltaH, withH - sellH, 1e-9)) c.fail(`deltaH must be exit(contract, the stream on) - exit(sold, every hash sold): ${e?.deltaH} vs ${withH - sellH}`);
    // One purchase against one sale on a trajectory that already buys them is a tie by construction —
    // the reason the option is priced as a policy. Put the one-purchase comparison back and it sells.
    const dOne = HS.decideHashSpend({ hashes: 200, capacity: 576, record: rec, lastAugReset: 7, now, fns, options: [{ ...opt, policy: undefined }] });
    if (dOne.action === "buy") c.fail(`one contract against one sale was expected to tie (the stream buys it seconds later): ${JSON.stringify(dOne.exits?.[0])}`);
    if (d.action !== "buy") c.fail(`a contract whose rep reaches the exit faction beats selling when money does not bind: got ${d.action} (${d.why})`);
    // Before the join the option carries money only: it must not win on money.
    const dPre = HS.decideHashSpend({ hashes: 200, capacity: 576, record: rec, lastAugReset: 7, now, fns, options: [{ ...opt, effect: { money: r.money }, policy: undefined }] });
    if (dPre.action === "buy") c.fail(`before the join a contract is money only (${r.money}), no better than the sale: got buy`);
    c.note(`the contract policy from level 4 (k=${k}): exit ${e?.withH?.toFixed(4)}h vs ${e?.sellH?.toFixed(4)}h selling every hash (${((e?.deltaH ?? 0) * 3600).toFixed(1)}s); at the margin ${((e?.marginalH ?? 0) * 3600).toFixed(2)}s`);
    // RANKED AT THE MARGIN: an upgrade worth more per hash than the NEXT
    // contract gets the hashes, though the contract policy's whole value
    // divided by one contract's price is larger.
    c.examined(1);
    const oneH = X.bestExitPolicy({ ...inputs, ...x, money: inputs.money + (125 / 4) * 1e6 }, 0, 0).best.hours;
    if (!close(e?.marginalH, withH - oneH, 1e-9) || !close(e?.perHash, Math.min(0, withH - oneH) / 125, 1e-9)) c.fail(`the contract's rank must be its marginal delta (one contract vs one sale, the stream on): ${e?.marginalH} vs ${withH - oneH}`);
    const study2 = { name: "Improve Studying", cost: 550, effect: { expPerSec: inputs.expPerSec * 1.5 } };
    const both = HS.decideHashSpend({ hashes: 600, capacity: 1024, record: rec, lastAugReset: 7, now, fns, options: [opt, study2] });
    const eSt = both.exits?.find((z) => z.name === "Improve Studying");
    if (eSt?.deltaH < 0 && eSt.perHash < e.perHash && both.name !== "Improve Studying") c.fail(`study beats the next contract per hash (${eSt.perHash} vs ${e.perHash}) and must be bought first: got ${both.action} ${both.name}`);
    if (!(eSt?.deltaH < 0)) c.fail(`fixture: the study option must win against selling here (${eSt?.deltaH})`);
    // Study on a shaped exp rate: the fleet's exp is flat.
    c.examined(1);
    const sh = { ...inputs, contractRep: undefined, expScalesWithLevel: true, expFlatPerSec: 0 };
    const recS = { ...rec, inputs: sh };
    const study = { name: "Improve Studying", cost: 50, effect: { expPerSec: 64 * 1.2 } };
    const dS = HS.decideHashSpend({ hashes: 200, capacity: 576, record: recS, lastAugReset: 7, now, fns, options: [study], baseEffect: { expPerSec: 64 } });
    const wS = X.bestExitPolicy({ ...sh, ...x, expPerSec: sh.expPerSec + 76.8, expFlatPerSec: 76.8 }, 0, 0).best.hours;
    const sS = X.bestExitPolicy({ ...sh, ...x, money: sh.money + 12.5e6, expPerSec: sh.expPerSec + 64, expFlatPerSec: 64 }, 0, 0).best.hours;
    if (!close(dS.exits?.[0]?.deltaH, wS - sS, 1e-9)) c.fail(`study on a shaped rate must ride expFlatPerSec: ${dS.exits?.[0]?.deltaH} vs ${wS - sS}`);
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("HV4", "THE AUDIT on the live 22:57Z inputs: final-window fleet money moves the exit < 0.01h, a $1e12/s fleet does not shorten it, the contracts shorten it by > 0.1h");
    const basis = P.basisOf(FX.plan.decisions.install, Date.parse(EI.at));
    const g = basis?.gains ?? null;
    const run = (inp) => X.bestExitPolicy({ ...inp, eRep: EI.eRep, eBudget: EI.eBudget, firstInstallH: Math.max(0, basis?.waitH ?? 0), ...(g ? { installGains: g, nextInstallGain: g.hacking } : {}) }, 400, 1).best.hours;
    const T0 = run(I);
    const noFleet = run({ ...I, freshHacknet: undefined });
    const rich = run({ ...I, freshHacknet: [{ atH: 0, perSec: 1e12 }] });
    const k = CP.contractFactionCount(["NiteSec", "Chongqing", "Ishima", "New Tokyo", "Tetrads", "Slum Snakes", "Netburners", "Tian Di Hui", "CyberSec"]) + 1;
    const withC = run({ ...I, contractRep: { perContract: r.factionRep, factions: k, hashCum: streams.hashCum } });
    c.examined(4);
    if (!(Math.abs(T0 - noFleet) < 0.01)) c.fail(`the final window's fleet money must not move this exit: ${T0} with vs ${noFleet} without`);
    if (!(rich >= T0 - 1e-6)) c.fail(`money does not bind the final window: a $1e12/s fleet cannot shorten it (${rich} vs ${T0})`);
    if (!(T0 - withC > 0.1)) c.fail(`the contracts must shorten the exit by > 0.1h: ${withC} vs ${T0}`);
    c.note(`exit ${T0.toFixed(3)}h; without the final window's fleet ${noFleet.toFixed(3)}h; with a $1e12/s one ${rich.toFixed(3)}h; with contracts (k=${k}) ${withC.toFixed(3)}h (${(withC - T0).toFixed(3)}h)`);
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("HV5", "THE WIRING: progress.js publishes contractRep; hashspend.js prices the exit share only in the final window once joined, counts hacking-work factions, publishes its level");
    const p = code("progress.js");
    const h = code("hashspend.js");
    c.examined(7);
    if (!/const cr = contractRepOf\(ns, info, player, out, fs9\)\s*\n\s*if \(cr\.rec\) out\.contractRep = cr\.rec/.test(p)) c.fail("progress.js exitInputsGen no longer attaches contractRep");
    if (!/function contractRepOf[\s\S]{0,400}\/tel\/ctauto\.txt[\s\S]{0,1400}contractFactionCount\(player\.factions\)/.test(p)) c.fail("contractRepOf must require ctauto.js reporting and count factions by contractFactionCount");
    if (!/const toExit = finalWindow && k > 0 && \(player\.factions \?\? \[\]\)\.includes\(EXIT_FACTION\)/.test(h)) c.fail("hashspend.js must price the exit faction's share only in the final window, once it is joined");
    if (!/exitRep: toExit, contractLevels: 1/.test(h)) c.fail("hashspend.js's contract option must carry its exit reputation and the level it uses");
    if (!/\.\.\.\(toExit > 0 \? \{ policy: 'contracts' \} : \{\}\)/.test(h)) c.fail("hashspend.js must price the exit-bound contract as the POLICY (one contract against one sale ties by construction and would always sell)");
    if (/hasHackingFaction: \(player\.factions\?\.length \?\? 0\) > 0/.test(h)) c.fail("hashspend.js counts every faction as a hacking faction again (Slum Snakes takes no contract rep)");
    if (!/contractLevel, decision, did/.test(h)) c.fail("hashspend.js must publish contractLevel (progress.js's live contract stream reads it)");
    checks.push(c);
  }

  return checks;
}
