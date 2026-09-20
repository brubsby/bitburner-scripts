// [NP] the cross-node model — nodeplan.js against the game's own constants.
//
// The choice of BitNode is the largest commitment the run makes. Before this
// module it was argued in chat from a multiplier table; these checks are what
// make the arithmetic reviewable instead of persuasive.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import "./gameresolve.mjs";
import { GAME } from "./build-ram.mjs";

const np = await import("../../nodeplan.js");
const { exitLevelFor, karmaHours, compoundGain, projectIncome, projectExp, nodeHours, rankNodes, EXIT_BASE_LEVEL, GANG_KARMA, HOMICIDE, UNFOCUSED } = np;
const { bitNodeMults } = await import("../../bitNodeMultipliers.js");

export async function run() {
  const checks = [];

  const c1 = new Check("NP1", "the gates are the game's: exit level = 3000 x WorldDaemonDifficulty, gang karma -54,000, homicide 3s/3 karma paid on failure at a quarter");
  {
    /* -- the exit level, and the scaling site -------------------------- */
    c1.examined(1);
    const helpers = fs.readFileSync(path.join(GAME, "src/Server/ServerHelpers.ts"), "utf8");
    if (!/requiredHackingSkill \*= currentNodeMults\.WorldDaemonDifficulty/.test(helpers)) {
      c1.fail("ServerHelpers no longer scales w0r1d_d43m0n by WorldDaemonDifficulty — the exit level model is stale");
    }
    const servers = fs.readFileSync(path.join(GAME, "src/Server/data/servers.ts"), "utf8");
    const wd = servers.match(/hostname:\s*SpecialServers\.WorldDaemon[\s\S]{0,400}?requiredHackingSkill:\s*(\d+)/);
    const base = wd ? Number(wd[1]) : null;
    if (base !== null && base !== EXIT_BASE_LEVEL) c1.fail(`w0r1d_d43m0n's base requiredHackingSkill is ${base}, the model says ${EXIT_BASE_LEVEL}`);

    // Against the two nodes we have actually stood in.
    c1.examined(2);
    if (exitLevelFor(2) !== 15000) c1.fail(`BitNode 2 exit level should be 15000 (difficulty 5), got ${exitLevelFor(2)}`);
    if (exitLevelFor(4) !== 9000) c1.fail(`BitNode 4 exit level should be 9000 (difficulty 3), got ${exitLevelFor(4)}`);
    // Every node in the table agrees with its own multiplier.
    let agreed = 0;
    for (let n = 1; n <= 14; n++) {
      const m = bitNodeMults(n);
      if (!m) continue;
      agreed++;
      const want = EXIT_BASE_LEVEL * m.WorldDaemonDifficulty;
      if (exitLevelFor(n) !== want) c1.fail(`BitNode ${n}: exit level ${exitLevelFor(n)} != ${want}`);
    }
    c1.examined(agreed);
    // A node with no table refuses rather than assuming difficulty 1.
    if (exitLevelFor(12) !== null) c1.fail("BitNode 12's multipliers scale with the SF12 level; with no table it must refuse, not default");

    /* -- the karma gate ------------------------------------------------- */
    c1.examined(1);
    const gc = fs.readFileSync(path.join(GAME, "src/Gang/data/Constants.ts"), "utf8");
    const req = Number(gc.match(/GangKarmaRequirement:\s*(-?\d+)/)?.[1]);
    if (req !== GANG_KARMA) c1.fail(`GangKarmaRequirement is ${req}, the model says ${GANG_KARMA}`);
    const crimes = fs.readFileSync(path.join(GAME, "src/Crime/Crimes.ts"), "utf8");
    const hom = crimes.match(/\[CrimeType\.homicide\]: new Crime\(\s*"[^"]*",\s*"[^"]*",\s*CrimeType\.\w+,\s*([0-9.e+]+),\s*([0-9.e+]+),\s*[0-9./ ]+,\s*([0-9.]+),/);
    if (!hom) c1.fail("could not read homicide's time and karma out of Crimes.ts");
    else {
      if (Number(hom[1]) / 1000 !== HOMICIDE.seconds) c1.fail(`homicide takes ${Number(hom[1]) / 1000}s, the model says ${HOMICIDE.seconds}`);
      if (Number(hom[3]) !== HOMICIDE.karma) c1.fail(`homicide pays ${hom[3]} karma, the model says ${HOMICIDE.karma}`);
    }
    // Karma on FAILURE at a quarter, and the focus scaling, both from source.
    const cw = fs.readFileSync(path.join(GAME, "src/Work/CrimeWork.ts"), "utf8");
    if (!/karma \/= 4/.test(cw)) c1.fail("CrimeWork no longer pays a quarter karma on failure — karmaHours' rate is wrong");
    if (!/Player\.karma -= karma \* focusBonus/.test(cw)) c1.fail("CrimeWork no longer scales karma by focusBonus");
    const consts = fs.readFileSync(path.join(GAME, "src/Constants.ts"), "utf8");
    const bfb = Number(consts.match(/BaseFocusBonus:\s*([0-9.]+)/)?.[1]);
    if (bfb !== UNFOCUSED) c1.fail(`BaseFocusBonus is ${bfb}, the model says ${UNFOCUSED}`);

    /* -- the karma arithmetic, by hand ---------------------------------- */
    c1.examined(4);
    // Perfect success from zero: 54,000 karma at 3 per 3s = exactly 15h.
    const perfect = karmaHours({ chance: 1, karma: 0 });
    if (Math.abs(perfect.hours - 15) > 1e-9) c1.fail(`100% homicide from karma 0 should be 15.0h, got ${perfect.hours}`);
    // Failure still pays: at chance 0 the rate is a quarter, so 4x as long.
    const never = karmaHours({ chance: 0, karma: 0 });
    if (Math.abs(never.hours - 60) > 1e-9) c1.fail(`0% success still pays quarter karma: expected 60h, got ${never.hours}`);
    // Unfocused costs exactly 1/0.8.
    const unfocused = karmaHours({ chance: 1, karma: 0, focused: false });
    if (Math.abs(unfocused.hours - 15 / UNFOCUSED) > 1e-9) c1.fail(`unfocused should be ${15 / UNFOCUSED}h, got ${unfocused.hours}`);
    // Already past the gate is zero, not negative.
    if (karmaHours({ chance: 1, karma: GANG_KARMA - 1 }).hours !== 0) c1.fail("past the karma gate must be 0 hours");
    // Refusals, named.
    for (const [o, what] of [[{ chance: null, karma: 0 }, "unreadable success rate"], [{ chance: 0.5, karma: null }, "unreadable karma"], [{ chance: 2, karma: 0 }, "an impossible success rate"]]) {
      const r = karmaHours(o);
      if (r.hours !== null || !r.why) c1.fail(`${what} must refuse with a reason, got ${JSON.stringify(r)}`);
    }
    c1.note(`exit levels — BN2 ${exitLevelFor(2)}, BN4 ${exitLevelFor(4)}, BN5 ${exitLevelFor(5)}, BN11 ${exitLevelFor(11)}; homicide ${HOMICIDE.karma}/${HOMICIDE.seconds}s -> ${perfect.hours.toFixed(1)}h focused at 100%, ${never.hours.toFixed(0)}h at 0%`);
  }
  checks.push(c1);

  const c2 = new Check("NP2", "projections are RATIOS of the node we measured in, and an unreadable multiplier refuses instead of becoming 1");
  {
    c2.examined(3);
    // Same node in and out is the identity — the measured node cancels.
    const same = projectIncome(1e6, 4, 4);
    if (Math.abs(same.incomePerSec - 1e6) > 1e-6 || Math.abs(same.ratio - 1) > 1e-12) c2.fail(`projecting into the same node must be the identity, got ${JSON.stringify(same)}`);
    // BN4 -> BN1: undo BN4's ScriptHackMoney 0.2 and ServerMaxMoney 0.1125.
    const m4 = bitNodeMults(4);
    const want = 1 / (m4.ScriptHackMoney * m4.ServerMaxMoney);
    const up = projectIncome(1e6, 4, 1);
    if (Math.abs(up.ratio - want) > 1e-9) c2.fail(`BN4 -> BN1 income ratio should be ${want}, got ${up.ratio}`);
    // Experience rides HackExpGain alone.
    const e = projectExp(100, 4, 1);
    if (Math.abs(e.ratio - 1 / m4.HackExpGain) > 1e-9) c2.fail(`BN4 -> BN1 exp ratio should be ${1 / m4.HackExpGain}, got ${e.ratio}`);

    c2.examined(3);
    for (const [r, what] of [
      [projectIncome(0, 4, 1), "no measured income"],
      [projectIncome(1e6, 4, 12), "a node with no multiplier table"],
      [projectExp(null, 4, 1), "no measured experience"],
    ]) {
      if (r.why == null) c2.fail(`${what} must refuse with a reason, got ${JSON.stringify(r)}`);
    }
    c2.note(`BN4 -> BN1 income x${up.ratio.toFixed(1)} (ScriptHackMoney ${m4.ScriptHackMoney} x ServerMaxMoney ${m4.ServerMaxMoney}), experience x${e.ratio.toFixed(1)}`);
  }
  checks.push(c2);

  const c3 = new Check("NP3", "nodeHours adds the gang leg only where it is really owed, and rankNodes orders by hours while leaving rewards un-summed");
  {
    const measured = { incomePerSec: 1e6, expPerSec: 5e3, hacking: 500, hackingExp: 1e6, hackingMult: 2, money: 1e9, cycleHours: 1, multGainPerCycle: 1.1 };
    const gang = { wanted: true, haveSF2: true, chance: 1, karma: 0, focused: true };

    c3.examined(3);
    // BitNode 2 grants access outright — no karma at all, and it says so.
    const bn2 = nodeHours({ node: 2, from: 4, measured, gang });
    if (bn2.gangGrindHours !== 0 || !/grants gang access outright/.test(bn2.gangWhy ?? "")) c3.fail(`BitNode 2 must owe no karma: ${JSON.stringify(bn2.gangWhy)}`);
    // Elsewhere the grind is real but CONCURRENT: karma survives installs
    // (only prestigeSourceFile zeroes it), so it runs on the work slot
    // alongside the climb and adds wall-clock only if it outlasts the node.
    const bn4 = nodeHours({ node: 4, from: 4, measured, gang });
    if (Math.abs(bn4.gangGrindHours - 15) > 1e-9) c3.fail(`BitNode 4's grind is 15h, got ${bn4.gangGrindHours}`);
    if (!(bn4.exitHours > bn4.gangGrindHours)) c3.fail("fixture: the exit must outlast the grind for the concurrency check to mean anything");
    if (bn4.gangAdds !== 0) c3.fail(`a grind shorter than the node adds no wall-clock, got ${bn4.gangAdds}`);
    if (Math.abs(bn4.hours - bn4.exitHours) > 1e-9) c3.fail("total must equal the exit when the grind fits inside it");
    if (bn4.workSlotHours !== bn4.gangGrindHours) c3.fail("the work-slot cost must still be reported, not summed away");
    // A grind that OUTLASTS the node does add its overhang.
    const slow = nodeHours({ node: 4, from: 4, measured, gang: { ...gang, chance: 0 } });
    if (!(slow.gangAdds > 0)) c3.fail("a grind longer than the node must add its overhang");
    if (Math.abs(slow.hours - (slow.exitHours + slow.gangAdds)) > 1e-9) c3.fail("overhang must be added exactly once");
    if (Math.abs(slow.gangAdds - (slow.gangGrindHours - slow.exitHours)) > 1e-9) c3.fail("the overhang is grind minus exit, nothing else");
    // Without SF2 there is no gang to pay for at all.
    const noSf = nodeHours({ node: 4, from: 4, measured, gang: { ...gang, haveSF2: false } });
    if (noSf.gangGrindHours !== 0 || !/no SF2/.test(noSf.gangWhy ?? "")) c3.fail(`without SF2 the grind must be dropped and named: ${JSON.stringify(noSf.gangWhy)}`);
    const noGang = nodeHours({ node: 4, from: 4, measured, gang: null });
    if (noGang.gangGrindHours !== 0) c3.fail("no gang wanted, no grind");

    c3.examined(2);
    const ranked = rankNodes({ candidates: [4, 5, 11, 12], from: 4, owned: { 4: 1, 5: 1 }, measured, gang, rewards: { 4: "Singularity 16x -> 4x" } });
    // Ascending by hours, refusals last and still carrying their reason.
    const readable = ranked.filter((r) => r.hours !== null);
    for (let i = 1; i < readable.length; i++) if (readable[i].hours < readable[i - 1].hours) c3.fail("rankNodes must order by hours ascending");
    const bn12 = ranked.find((r) => r.node === 12);
    if (bn12.hours !== null || !bn12.why) c3.fail(`BitNode 12 must refuse with a reason, got ${JSON.stringify(bn12)}`);
    if (ranked[ranked.length - 1].node !== 12) c3.fail("a refusal must sort last, not first");
    // The step, not the total: holding SF4.1 means clearing BN4 yields 4.2.
    const r4 = ranked.find((r) => r.node === 4);
    if (r4.sfFrom !== 1 || r4.sfTo !== 2) c3.fail(`BN4 with SF4.1 held must report 1 -> 2, got ${r4.sfFrom} -> ${r4.sfTo}`);
    if (r4.reward !== "Singularity 16x -> 4x") c3.fail("the reward must be carried through as text, not folded into a score");
    // Nothing anywhere is a single utility number.
    if (Object.keys(ranked[0]).some((k) => /score|utility|value$/i.test(k))) c3.fail("rankNodes must not invent a utility score");
    // The install count is SEARCHED: a zero-install answer to a 9000 exit is
    // astronomical, and a plausible fixture must not produce one.
    c3.examined(1);
    for (const r of readable) {
      if (!Number.isInteger(r.installs) || r.installs < 0) c3.fail(`BN${r.node} reports no install count: ${r.installs}`);
      if (r.atSearchEdge) c3.fail(`BN${r.node}'s best policy sits at the edge of the install search (${r.installs}) — a pinned answer is not an answer`);
      if (!(r.hours > 0 && r.hours < 1e6)) c3.fail(`BN${r.node} priced at ${r.hours} hours — implausible for a searched policy`);
      // A harder exit must cost more: BN4's 9000 against BN5/BN11's 4500.
    }
    const h4 = readable.find((r) => r.node === 4)?.hours;
    const h5 = readable.find((r) => r.node === 5)?.hours;
    if (h4 != null && h5 != null && !(h4 > h5)) c3.fail(`BN4 (exit 9000) must cost more than BN5 (exit 4500): ${h4} vs ${h5}`);
    c3.note(`ranked: ${readable.map((r) => `BN${r.node} ${r.hours.toFixed(1)}h (${r.installs} installs)`).join(", ")}; BN12 refused — ${bn12.why}`);
  }
  checks.push(c3);

  const c4 = new Check("NP4", "compoundGain reproduces the endpoint it summarises, where a median of ratios does not");
  {
    // A ledger whose multiplier growth is carried by a few large cycles — the
    // real shape, because augmentations arrive in lumps. Median says ~1.00,
    // compound says the truth.
    const mults = [1, 1.01, 1.02, 4, 4.04, 4.08, 16];
    const ledger = mults.map((hackMult, i) => ({ bitNode: 7, lifeH: 2, hackMult }));
    c4.examined(1);
    const cg = compoundGain(ledger, 7);
    if (cg.gain === null) c4.fail(`compoundGain refused a usable ledger: ${cg.why}`);
    else {
      const reproduced = cg.from * Math.pow(cg.gain, cg.cycles);
      if (Math.abs(reproduced - cg.to) > 1e-9) c4.fail(`compound gain must reproduce the endpoint: ${reproduced} vs ${cg.to}`);
      // The median of successive ratios is near 1 and would say the multiplier barely moved.
      const ratios = [];
      for (let i = 1; i < mults.length; i++) ratios.push(mults[i] / mults[i - 1]);
      const sorted = [...ratios].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      if (!(cg.gain > median)) c4.fail(`the whole point: compound ${cg.gain} must exceed the median ${median} on lumpy growth`);
      const medianSays = cg.from * Math.pow(median, cg.cycles);
      if (!(medianSays < cg.to / 2)) c4.fail("fixture is not lumpy enough to show the difference");
      c4.note(`lumpy ledger ${cg.from} -> ${cg.to} over ${cg.cycles} cycles: compound ${cg.gain.toFixed(4)} reproduces it; the median ratio ${median.toFixed(4)} would predict ${medianSays.toFixed(2)}`);
    }
    c4.examined(2);
    for (const [l, what] of [[[], "an empty ledger"], [[{ bitNode: 7, lifeH: 1, hackMult: 1 }], "a single life"]]) {
      const r = compoundGain(l, 7);
      if (r.gain !== null || !r.why) c4.fail(`${what} must refuse with a reason`);
    }
  }
  checks.push(c4);

  return checks;
}
