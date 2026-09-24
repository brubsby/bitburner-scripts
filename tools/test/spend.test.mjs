// [SE] spenders follow the simulated-exit verdict (CLAUDE.md "Decisions
// compare simulated trajectories"), falling back to their old rules — named —
// only when no fresh verdict exists.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Check } from "./harness.mjs";
import "./gameresolve.mjs";
const b = await import("../../budget.js");
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

export async function run() {
  const checks = [];

  const c1 = new Check("SE1", "an exit-approved spend passes the augmentation and home claims, never the join claim");
  {
    c1.examined(3);
    const claims = { join: 5e9, augmentations: 7e9, home: 11e9 };
    if (b.reserveFor("hacknet", claims) !== 23e9) c1.fail(`without approval every higher claim holds: ${b.reserveFor("hacknet", claims)}`);
    if (b.reserveFor("hacknet", claims, { exitApproved: true }) !== 5e9) c1.fail(`approved: only the join claim holds, got ${b.reserveFor("hacknet", claims, { exitApproved: true })}`);
    if (b.reserveFor("servers", { ...claims, join: null }, { exitApproved: true }) !== Infinity) c1.fail("an unreadable join claim still blocks an approved spend");
  }
  checks.push(c1);

  const c2 = new Check("SE2", "every spender reads its spendExit verdict before its fallback rule, and progress prices it at the gate's own install point");
  {
    c2.examined(5);
    const hn = src("hacknet.js");
    if (!(/const exitV = /.test(hn) && hn.indexOf("const exitV = ") < hn.indexOf("const v = exitV ??"))) c2.fail("hacknet.js must take the exit verdict first");
    if (!/decidedBy: 'payback-fallback'/.test(hn)) c2.fail("hacknet.js must name its fallback");
    const bs = src("buyserv.js");
    const rn = bs.slice(bs.indexOf("function reserveNow"), bs.indexOf("function reserveNow") + 2500);
    if (!(rn.indexOf("v.servers") > 0 && rn.indexOf("v.servers") < rn.indexOf("let base = SETTINGS.floorReserve"))) c2.fail("buyserv.js reserveNow must follow the verdict before the claims rule");
    const wd = src("watchdog.js");
    const hu = wd.slice(wd.indexOf("script: 'homeup.js'"), wd.indexOf("script: 'homeup.js'") + 3000);
    if (!(hu.indexOf("spendExit") > 0 && hu.indexOf("spendExit") < hu.indexOf("marginalLnPerDollar(claimSrc"))) c2.fail("the homeup trigger must follow the verdict before the ln competition");
    const pr = src("progress.js");
    if (!/gate\.install \? 0 : gate\.holdForever \? null : gate\.bestWait\?\.waitMs > 0 \? gate\.bestWait\.waitMs \/ 3600000 : 0,\s*gate\.holdForever === true,/.test(pr)) c2.fail("progress.js must price spends at the gate's own install point");
  }
  checks.push(c2);

  const c3 = new Check("SE3", "crime vs faction work is two simulated exits at the gate's install point, not moneyLn against a schedule rate");
  {
    const pr = src("progress.js");
    const fn = pr.slice(pr.indexOf("const crimeAlt = (() => {"), pr.indexOf("const alreadyAtDesk"));
    c3.examined(4);
    if (/moneyLn\(/.test(fn)) c3.fail("the moneyLn rate shortcut must not decide the slot");
    if (!/const fH = exitAt\(replanAt\(m, repGain > 0 \? offers\.map\(\(o\) => \(o\.faction === faction \? \{ \.\.\.o, factionRep: o\.factionRep \+ repGain \} : o\)\) : null\)\)/.test(fn)) c3.fail("faction work: the batch re-planned with the rep it earns by W");
    if (!/const cH = exitAt\(replanAt\(m \+ perHour \* W\)\)/.test(fn)) c3.fail("crime: the batch re-planned with the money it earns by W");
    if (!/const wins = cH < fH/.test(fn)) c3.fail("crime takes the slot only when its exit is sooner");
  }
  checks.push(c3);

  const c4 = new Check("SE4", "gang.js spends on equipment by the simulated-exit comparison, ln-per-dollar only as the named fallback");
  {
    const gs = src("gang.js");
    c4.examined(2);
    if (!/const permitted = exitPriced\s*\? exitCmp\.deltaH < 0 \? spendable\('gang', ns\.getServerMoneyAvailable\('home'\), claims, \{ exitApproved: true \}\) : 0\s*: spendable\('gang', ns\.getServerMoneyAvailable\('home'\), claims, lnCompete \? \{ lnCompete \} : \{\}\)/.test(gs)) c4.fail("gang.js must follow the exit comparison before the ln competition");
    if (!/gangEquipExit\(JSON\.parse\(ns\.read\(EXIT_INPUTS\)/.test(gs) || !/fetchFromHome\(ns, EXIT_INPUTS\)/.test(gs)) c4.fail("gang.js must price equipment from progress.js's exit inputs, pulled from home");
  }
  checks.push(c4);

  const c5 = new Check("SE5", "the NFG donation-threshold crossing is valued by two simulated exits; one window's levels only as the named fallback");
  {
    const pr = src("progress.js");
    const blk = pr.slice(pr.indexOf("const lnByExit = (() => {"), pr.indexOf("const lnCross = "));
    c5.examined(2);
    if (!/const withX = bestExitPolicy\(\{ \.\.\.inputsX, perCycleExtra: extra \}\)\.best\?\.hours/.test(blk) || !/Math\.max\(0, without - withX\) \/ hpl/.test(blk)) c5.fail("the crossing's value must be hours saved by the recurring levels, in hacking-ln units");
    if (!/const lnCross = lnByExit \?\? k \* lnPerLevel/.test(pr)) c5.fail("the one-window formula survives only as the fallback");
  }
  checks.push(c5);

  return checks;
}
