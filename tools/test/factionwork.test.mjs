// [FW] the faction work the game offers — factionwork.js, shared by
// progress.js (the player's work order) and sleeveplan.js (sleeves).
//
// The failure: live BN13.1 2026-10-12 12:52Z progress.js ordered the player's
// faction work at the Church of the Machine God, which offers NO work (its
// reputation comes only from Stanek charging); act-work.js tried all three
// types and every one was refused, so the slot earned nothing.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";
import { GAME } from "./build-ram.mjs";

const fw = await import("../../factionwork.js");
const game = (rel) => fs.readFileSync(path.join(GAME, rel), "utf8");
const CHURCH = "Church of the Machine God";

export async function run() {
  const checks = [];

  // [FW1] Parity with FactionInfo.tsx, and no work target without an offer.
  const c1 = new Check("FW1", "work targets are only factions FactionInfo.tsx offers work at; the Church never, Netburners hacking only");
  {
    const info = game("src/Faction/FactionInfo.tsx");
    const names = game("src/Faction/Enums.ts");
    const sets = { offerHackingWork: fw.HACKING_WORK_FACTIONS, offerFieldWork: fw.FIELD_WORK_FACTIONS, offerSecurityWork: fw.SECURITY_WORK_FACTIONS };
    let n = 0;
    const none = [];
    for (const m of info.matchAll(/\[FactionName\.(\w+)\]: new FactionInfo\(\{([\s\S]*?)\n  \}\),/g)) {
      const display = names.match(new RegExp(`\\b${m[1]} = "([^"]+)"`))?.[1];
      if (!display) { c1.fail(`no display name for FactionName.${m[1]}`); continue; }
      let any = false;
      for (const [flag, set] of Object.entries(sets)) {
        const on = new RegExp(`${flag}:\\s*true`).test(m[2]);
        any ||= on;
        if (on !== set.has(display)) c1.fail(`${display} ${flag} is ${on} in FactionInfo.tsx but ${set.has(display)} in factionwork.js`);
      }
      if (any !== fw.offersFactionWork(display)) c1.fail(`${display}: offersFactionWork must be ${any}`);
      if (!any) none.push(display);
      n++;
    }
    if (n < 30) c1.fail(`parsed only ${n} factions out of FactionInfo.tsx`);
    if (!none.includes(CHURCH)) c1.fail(`FactionInfo.tsx should list the Church as offering no work; no-work set parsed: ${none.join(", ")}`);

    if (fw.offersFactionWork(CHURCH)) c1.fail("the Church offers no work");
    if (JSON.stringify(fw.workTypesOf("Netburners")) !== '["hacking"]') c1.fail(`Netburners offers hacking only, got ${JSON.stringify(fw.workTypesOf("Netburners"))}`);
    const w = fw.workableOf([CHURCH, "Netburners", "Slum Snakes", "Shadows of Anarchy"], "Slum Snakes");
    if (JSON.stringify(w) !== '["Netburners"]') c1.fail(`workable must drop the Church, SoA and the gang faction, got ${JSON.stringify(w)}`);
    if (fw.workTargetOf([CHURCH, "Netburners"]) !== "Netburners") c1.fail("a Church route/hold must fall through to the next workable target");
    if (fw.workTargetOf([CHURCH]) !== null) c1.fail("the Church alone is no work target");

    // progress.js wires it: workable, the schedule's ranking, and the
    // route/hold override all go through factionwork.js.
    const src = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    if (!/const workable = workableOf\(factions, gangFaction\)/.test(src)) c1.fail("progress.js `workable` must come from factionwork.workableOf");
    if (!/if \(offersFactionWork\(c\.name\)\) byFaction\.set\(c\.name/.test(src)) c1.fail("planFactionWork must not rank a no-work join candidate as a schedule segment");
    if (!/if \(scheduleTarget && workTargetOf\(\[scheduleTarget\]\) === null\)/.test(src)) c1.fail("progress.js must drop a route/hold target that offers no work");
    // sleeveplan and contractplan share the lists rather than copy them.
    for (const f of ["sleeveplan.js", "contractplan.js"]) {
      const s = fs.readFileSync(path.join(REPO_ROOT, f), "utf8");
      if (/new Set\(\[\s*'Illuminati'/.test(s)) c1.fail(`${f} carries its own copy of an offer list; import factionwork.js`);
    }
    c1.examined(n + 8);
  }
  checks.push(c1);

  return checks;
}
