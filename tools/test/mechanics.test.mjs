// [MX] mechanics the exit must see — docs/mechanics.md.
//
// MX1: THE RED PILL'S REPUTATION LEG. exitInputsOf read `rp?.baseRep`, a
// field no offer carries (offers have `repReq`), so the 2.5M-rep leg priced
// at 0 in every node — and before Daedalus is joined there is no offer at
// all. With the leg missing, every choice that produces faction reputation
// (a sleeve on faction work, share(), a contract's reward, Go's faction_rep)
// was worth exactly nothing to the exit. Asserted as the simulated
// comparison it changes, on the live BN8 fixture.

import "./gameresolve.mjs";
import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

export async function run() {
  const X = await import("../../exitplan.js");
  const F = await import("./fixture-bn8-graft.mjs");
  const c = new Check("MX1", "the Red Pill's rep leg is in the exit before and after Daedalus is joined, so reputation choices are priced by the exit");
  c.examined(4);
  const src = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
  const ei = src.slice(src.indexOf("function exitInputsOf("), src.indexOf("function exitExpPerSec("));
  if (/rp\?\.baseRep/.test(ei)) c.fail("exitInputsOf reads rp.baseRep — offers carry repReq, so the leg prices at 0");
  if (!/terminalRep: rp \? rp\.repReq \?\? 0 : redPillRepReq \?\? 0/.test(ei)) c.fail("terminalRep must be the offer's repReq once joined, else the catalogue's requirement");
  if (!/redPillRepReq = allCount\.has\(TERMINAL_AUG\) \? 0 : sing\.augRepReq\(TERMINAL_AUG\)/.test(src)) c.fail("the catalogue's Red Pill requirement must be read from the snapshot each pass");
  // The comparison it changes: a sleeve's faction reputation, with vs without,
  // on the same inputs — zero without the leg, positive with it.
  const I = F.INPUTS;
  const leg = { terminalRep: 2.5e6, donationCost: (2.5e6 * 1e6) / 1.58 };
  const h = (x) => X.bestExitPolicy(x).best?.hours;
  const noLeg = h({ ...I, sleeveRep: { perSec: 1.4, delayH: 0 } }) - h(I);
  const withLeg = h({ ...I, ...leg, sleeveRep: { perSec: 1.4, delayH: 0 } }) - h({ ...I, ...leg });
  if (Math.abs(noLeg) > 1e-9) c.fail(`without the leg a sleeve's rep must be worth 0h (the defect's shape): ${noLeg}`);
  if (!(withLeg < 0)) c.fail(`with the leg a sleeve's reputation must shorten the exit: ${withLeg}h`);
  c.note(`BN8 fixture: exit ${h(I).toFixed(2)}h without the leg, ${h({ ...I, ...leg }).toFixed(2)}h with it; a 1.4 rep/s sleeve is worth ${noLeg.toFixed(3)}h -> ${withLeg.toFixed(3)}h`);
  return c;
}
