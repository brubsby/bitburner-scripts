// [CP] company work as a price — the megacorp join cost.
//
// Two tables and one formula, and all three are transcriptions from game
// source — which is exactly the bug class (a lookup that silently defaults, a
// hand-copy that goes stale) this repo keeps paying for. So CP1 diffs both
// tables against ~/Repos/bitburner on every run, the same treatment
// BITNODE_OVERRIDES gets from BN1, and CP2 pins the formula's arithmetic to
// hand-computed values so a "simplification" cannot slip in silently.
//
// THROUGHPUT IS NOT CALIBRATED and the module says so in its header: this save
// has never held a job, so no live rep/sec exists to check against. What CAN
// be checked statically is checked here; the live measurement loop in
// progress.js takes over the moment company work actually starts.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import "./gameresolve.mjs";

const cp = await import("../../companyplan.js");
const { expForSkill } = await import("../../installgate.js");
const { SOFTWARE_TRACK, MEGACORPS, companyRepPerSec, qualifies, hoursToCompanyRep } = cp;

const REPO = path.resolve(import.meta.dirname, "../..");
const GAME = path.resolve(REPO, "../bitburner/src/Company/data");

export async function run() {
  const checks = [];

  /* ---------------------------------------------------------------- CP1 --- */
  const c1 = new Check("CP1", "both tables match game source, key for key");
  {
    let posSrc, coSrc;
    try {
      posSrc = fs.readFileSync(path.join(GAME, "CompanyPositionsMetadata.ts"), "utf8");
      coSrc = fs.readFileSync(path.join(GAME, "CompaniesMetadata.ts"), "utf8");
    } catch (e) {
      c1.warn(`could not read game source: ${e.message}`, "without it both tables are unverified hand-copies");
    }
    if (posSrc) {
      // The software track is JobName.software0..7, in order.
      const blocks = [...posSrc.matchAll(/\[JobName\.software(\d)\]: \{([\s\S]*?)\n    \}/g)];
      c1.examined(1);
      if (blocks.length !== 8) c1.fail(`parsed ${blocks.length} software positions from source, expected 8 — the shape changed`);
      for (const [, idx, body] of blocks) {
        const i = Number(idx);
        const mine = SOFTWARE_TRACK[i];
        const grab = (key) => {
          const m = body.match(new RegExp(`${key}:\\s*([\\d.e]+)`));
          return m ? Number(m[1]) : 0; // absent numeric field means 0 in the game's ctor
        };
        c1.examined(1);
        if (!mine) {
          c1.fail(`software${i} missing from SOFTWARE_TRACK`);
          continue;
        }
        for (const [ours, theirs] of [
          [mine.repMult, grab("repMultiplier")],
          [mine.hackEff, grab("hackingEffectiveness")],
          [mine.chaEff, grab("charismaEffectiveness")],
          [mine.reqHacking, grab("reqdHacking")],
          [mine.reqCharisma, grab("reqdCharisma")],
          [mine.reqRep, grab("reqdReputation")],
          [mine.chaExpGain, grab("charismaExpGain")],
        ]) {
          c1.examined(1);
          if (ours !== theirs) c1.fail(`software${i} (${mine.name}): table ${ours} vs source ${theirs}`);
        }
      }
      c1.note(`software track verified against CompanyPositionsMetadata.ts, ${blocks.length} positions`);
    }
    if (coSrc) {
      for (const m of MEGACORPS) {
        c1.examined(1);
        // Find this company's block and its offset.
        const key = Object.entries({
          ECorp: "ECorp", MegaCorp: "MegaCorp", NWO: "NWO",
          "Bachman & Associates": "BachmanAndAssociates", "Blade Industries": "BladeIndustries",
          "Clarke Incorporated": "ClarkeIncorporated", "OmniTek Incorporated": "OmniTekIncorporated",
          "Four Sigma": "FourSigma", "KuaiGong International": "KuaiGongInternational",
          "Fulcrum Technologies": "FulcrumTechnologies",
        }).find(([name]) => name === m.company)?.[1];
        const block = coSrc.split(`CompanyName.${key},`)[1]?.slice(0, 400) ?? "";
        const off = block.match(/jobStatReqOffset:\s*(\d+)/);
        if (!off) c1.fail(`${m.company}: no jobStatReqOffset found in source`);
        else if (Number(off[1]) !== m.offset) c1.fail(`${m.company}: offset ${m.offset} vs source ${off[1]}`);
        c1.examined(1);
        // expMultiplier drives the desk's charisma growth — a stale copy here
        // silently bends every trajectory.
        const em = block.match(/expMultiplier:\s*([\d.]+)/);
        if (!em) c1.fail(`${m.company}: no expMultiplier found in source`);
        else if (Number(em[1]) !== m.expMult) c1.fail(`${m.company}: expMult ${m.expMult} vs source ${em[1]}`);
      }
      c1.note(`${MEGACORPS.length} megacorp offsets verified against CompaniesMetadata.ts`);
    }
  }
  checks.push(c1);

  /* ---------------------------------------------------------------- CP2 --- */
  const c2 = new Check("CP2", "the rep-rate formula is the game's, x5 cycles, refusing unreadable inputs");
  {
    // Hand-computed from the cited lines, at round numbers:
    // junior (repMult 1.1, 85/15) at hacking 500, charisma 30, int 0, mults 1:
    //   perf = 1.1 * (85*500/975 + 15*30/975)/100 = 1.1 * (43.5897 + 0.4615)/100
    //        = 0.4845641...  -> x5 cycles = 2.4228205...
    const junior = SOFTWARE_TRACK[1];
    c2.examined(1);
    const r = companyRepPerSec(junior, { hacking: 500, charisma: 30, companyRepMult: 1, nodeCompanyRepMult: 1 });
    const expect = ((1.1 * ((85 * 500) / 975 + (15 * 30) / 975)) / 100) * 5;
    if (Math.abs(r - expect) > 1e-12) c2.fail(`junior rate ${r}, hand-computed ${expect}`);
    c2.note(`junior dev at hacking 500: ${r.toFixed(3)} rep/sec`);

    c2.examined(1);
    // Intelligence enters ADDITIVELY, outside the repMultiplier (CompanyPosition.ts:170).
    const ri = companyRepPerSec(junior, { hacking: 500, charisma: 30, intelligence: 100, companyRepMult: 1, nodeCompanyRepMult: 1 });
    if (Math.abs(ri - (expect + (100 / 975) * 5)) > 1e-12) c2.fail("intelligence must add outside the position multiplier");

    c2.examined(1);
    // Every multiplier multiplies: player company_rep, favour, BitNode.
    const rm = companyRepPerSec(junior, { hacking: 500, charisma: 30, companyRepMult: 1.5, nodeCompanyRepMult: 0.5, favor: 100 });
    if (Math.abs(rm - expect * 1.5 * 0.5 * 2) > 1e-12) c2.fail("company_rep x favorMult x BN multiplier must compose");

    c2.examined(1);
    for (const bad of [
      {},
      { hacking: 500 },
      { hacking: 500, charisma: 30 },
      { hacking: NaN, charisma: 30, companyRepMult: 1, nodeCompanyRepMult: 1 },
    ]) {
      if (companyRepPerSec(junior, bad) !== null) c2.fail(`unreadable inputs ${JSON.stringify(bad)} must refuse, not default`);
    }

    c2.examined(1);
    // The offset applies only to NONZERO bases — the rule that decides whether
    // an untrained-charisma player can work at all. Junior: cha base 0 stays 0.
    if (!qualifies(junior, 249, { hacking: 300, charisma: 0 })) c2.fail("junior needs NO charisma — zero base takes no offset");
    if (qualifies(SOFTWARE_TRACK[2], 224, { hacking: 999, charisma: 274 })) c2.fail("senior at a 224-offset company needs charisma 275");
    if (qualifies(junior, 249, { hacking: 299, charisma: 0 })) c2.fail("junior at a 249-offset company needs hacking 300");
  }
  checks.push(c2);

  /* ---------------------------------------------------------------- CP3 --- */
  const c3 = new Check("CP3", "the trajectory: the desk trains charisma, and training is a computed candidate");
  {
    const base = {
      company: "ECorp", hacking: 515, chaExp: 0, chaMult: 1.595, chaExpMult: 1.754,
      companyRepMult: 2.086, nodeCompanyRepMult: 1, nodeCompanyExpMult: 0.5,
      uniChaExpPerSec: 4 * 4 * 1.754,
    };

    c3.examined(1);
    // THE USER'S POINT, verified: with no university at all, charisma still
    // grows AT THE DESK (chaExpGain x expMultiplier x CompanyWorkExpGain x
    // charisma_exp), so the stint must beat the static-charisma estimate.
    const noUni = hoursToCompanyRep(400e3, { ...base, uniChaExpPerSec: null });
    if (!noUni) c3.fail("the plain stint must forecast");
    else {
      if (noUni.trainH !== 0) c3.fail("no university means no training candidate");
      const staticH = 400e3 / (companyRepPerSec(SOFTWARE_TRACK[1], { ...base, charisma: 1 }) ) / 3600;
      if (!(noUni.hours < staticH)) c3.fail(`desk charisma growth must shorten the stint: ${noUni.hours.toFixed(1)}h vs static ${staticH.toFixed(1)}h`);
      c3.note(`plain 400k ECorp stint: ${noUni.hours.toFixed(1)}h (static-charisma model says ${staticH.toFixed(1)}h — the desk itself closes the gap)`);
    }

    c3.examined(1);
    // TRAINING AS ARITHMETIC, not a rule: at favour 0 the stint is long and
    // front-loading study to the Senior bar wins; at high favour the stint is
    // short and training must drop OUT of the plan. Same code, no threshold.
    const cold = hoursToCompanyRep(400e3, base);
    const laddered = hoursToCompanyRep(400e3, { ...base, favor: 143 });
    if (!cold || !(cold.trainH > 0) || cold.trainToCha !== 300) {
      c3.fail(`at favour 0 the plan should study to the 300 bar first, got ${JSON.stringify({ trainH: cold?.trainH, toCha: cold?.trainToCha })}`);
    }
    if (!laddered || laddered.trainH !== 0) {
      c3.fail(`at favour 143 the 8-9h stint cannot amortise study — training must leave the plan, got trainH=${laddered?.trainH}`);
    }
    if (cold && noUni && !(cold.hours < noUni.hours)) c3.fail("a training plan is only chosen when it beats the plain stint");
    c3.note(`favour 0: ${cold.hours.toFixed(1)}h WITH ${cold.trainH.toFixed(1)}h study; favour 143: ${laddered.hours.toFixed(1)}h, no study`);

    c3.examined(1);
    // The path promotes as charisma crosses bars mid-stint, and names when.
    if (cold) {
      const names = cold.path.map((p) => p.position);
      if (!(names.includes("Senior Software Engineer"))) c3.fail(`the trained plan must reach Senior, path: ${names.join(" > ")}`);
      for (let k = 1; k < cold.path.length; k++) {
        if (!(cold.path[k].atHour >= cold.path[k - 1].atHour)) c3.fail("path hours must be monotone");
      }
    }

    c3.examined(1);
    // A measured live rate applies to the HELD position and outranks the
    // formula there (the calibration loop) — and clears the estimated flag
    // only if the whole walk ran on measurement.
    const meas = hoursToCompanyRep(400e3, {
      ...base, currentRep: 50e3, charisma: 300, chaExp: undefined,
      heldPosition: "Senior Software Engineer", measuredRepPerSec: 100,
    });
    if (!meas) c3.fail("the measured walk must forecast");
    else {
      if (!(meas.hours < 1.5)) c3.fail(`350k at a measured 100/s should be ~1h, got ${meas.hours.toFixed(2)}h`);
      if (meas.estimated) c3.fail("a walk that ran entirely on the measured rung must not claim to be an estimate");
    }

    c3.examined(1);
    // HACKING GROWS DURING THE STINT TOO — from batching, not the desk — and
    // the bars past Senior gate on it. At ECorp (offset 249) Lead needs
    // hacking 650 and charisma 400: give the walk a charisma high enough that
    // only hacking blocks Lead, a hacking level just below the bar, and a
    // measured exp flow that crosses it mid-stint. The static model can
    // never promote; the trajectory must.
    const hackExp600 = expForSkill(600, 1.9); // exp CONSISTENT with the level, or the comparison is rigged
    const growing = hoursToCompanyRep(400e3, {
      ...base, charisma: 800, chaExp: undefined, uniChaExpPerSec: null,
      hacking: 600, hackExp: hackExp600, hackExpRate: 490, hackMult: 1.9,
    });
    const frozen = hoursToCompanyRep(400e3, {
      ...base, charisma: 800, chaExp: undefined, uniChaExpPerSec: null, hacking: 600,
    });
    if (!growing || !frozen) c3.fail("both hacking-growth scenarios must forecast");
    else {
      const names = growing.path.map((p) => p.position);
      if (!names.includes("Lead Software Developer")) c3.fail(`rising hacking must cross Lead's 650 bar mid-stint, path: ${names.join(" > ")}`);
      if (frozen.path.map((p) => p.position).includes("Lead Software Developer")) {
        c3.fail("static hacking 600 must NOT reach Lead — otherwise this scenario proves nothing");
      }
      if (!(growing.hours < frozen.hours)) c3.fail("promoting mid-stint must shorten it");
    }

    c3.examined(1);
    // Refusals: below every rung's bar; unknown company; unreadable target;
    // rep already held costs zero.
    if (hoursToCompanyRep(400e3, { ...base, hacking: 100 }) !== null) c3.fail("hacking 100 < intern's 250 must refuse");
    if (hoursToCompanyRep(400e3, { ...base, company: "Not A Company" }) !== null) c3.fail("an unknown company must refuse");
    if (hoursToCompanyRep(NaN, base) !== null) c3.fail("an unreadable target must refuse");
    if (hoursToCompanyRep(1000, { ...base, currentRep: 2000 })?.hours !== 0) c3.fail("rep already held must cost 0 hours");
  }
  checks.push(c3);

  return checks;
}
