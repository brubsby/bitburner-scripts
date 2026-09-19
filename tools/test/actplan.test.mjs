// [AC] the early-game Singularity strategy — actplan.js and the actors.
//
// Pinned: the Slum Snakes requirements against FactionInfo.tsx, the actor
// scripts' prices (each must be a single call, far below the planner's block),
// and the decision order including hand-over to progress.js.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import "./gameresolve.mjs";
import { GAME } from "./build-ram.mjs";
import { load, asSave, ramOf } from "./ram.mjs";

const ap = await import("../../actplan.js");
const { decide, SLUM_SNAKES, HACK_LINE, RETRY_MS } = ap;

const NODE = { CrimeSuccessRate: 1, CrimeMoney: 3, CrimeExpGain: 1 };
function player(o = {}) {
  const skills = { hacking: 20, strength: 1, defense: 1, dexterity: 1, agility: 1, charisma: 1, intelligence: 0 };
  const exp = { hacking: 0, strength: 0, defense: 0, dexterity: 0, agility: 0, charisma: 0 };
  const mults = {};
  for (const s of Object.keys(exp)) { mults[s] = 1; mults[`${s}_exp`] = 1; }
  mults.crime_success = 1; mults.crime_money = 1;
  return { skills, exp, mults, karma: 0, numPeopleKilled: 0, city: "Sector-12", money: 5000, ...o };
}
const NOW = Date.parse("2026-09-19T17:00:00Z");
const base = (o = {}) => ({ now: NOW, gangNode: true, factions: [], player: player(), node: NODE, progress: null, schedule: null, work: null, tried: {}, ...o });

export async function run() {
  const checks = [];

  const c1 = new Check("AC1", "Slum Snakes' requirements match FactionInfo.tsx; each actor prices as ONE call");
  {
    c1.examined(1);
    const src = fs.readFileSync(path.join(GAME, "src/Faction/FactionInfo.tsx"), "utf8");
    const m = src.match(/\[FactionName\.SlumSnakes\]: new FactionInfo\(\{[\s\S]*?inviteReqs: \[([^\]]*)\]/);
    if (!m) c1.fail("could not find Slum Snakes' inviteReqs");
    else {
      const reqs = m[1];
      if (!reqs.includes(`haveCombatSkills(${SLUM_SNAKES.combat})`)) c1.fail(`combat requirement drifted: ${reqs}`);
      if (!reqs.includes(`haveMoney(${SLUM_SNAKES.money.toExponential(0).replace("e+", "e")})`) && !reqs.includes("haveMoney(1e6)")) c1.fail(`money requirement drifted: ${reqs}`);
      if (!reqs.includes(`haveKarma(${SLUM_SNAKES.karma})`)) c1.fail(`karma requirement drifted: ${reqs}`);
    }
    // Prices at SF4.1 (16x): join/work 48+1.6+scp, crime 80+..., gym/travel 32+...; none anywhere near the planner's 1,305GB.
    await load();
    const save = asSave({ bitNode: 2, sf: { 1: 2, 4: 1, 5: 1 } });
    const expect = { "act-join.js": 48, "act-work.js": 48, "act-crime.js": 80, "act-gym.js": 32, "act-travel.js": 32 };
    for (const [f, sing] of Object.entries(expect)) {
      c1.examined(1);
      const r = ramOf(f, save);
      const price = typeof r === "number" ? r : r?.cost;
      if (!(typeof price === "number")) { c1.fail(`${f}: could not price`); continue; }
      // 1.6 base + 0.6 scp + the one call.
      if (Math.abs(price - (1.6 + 0.6 + sing)) > 0.5) c1.fail(`${f} prices at ${price}GB, expected ~${1.6 + 0.6 + sing} (one Singularity call)`);
    }
    const act = ramOf("act.js", save);
    const actPrice = typeof act === "number" ? act : act?.cost;
    if (!(actPrice < 10)) c1.fail(`act.js must carry no Singularity name: priced ${actPrice}GB`);
    c1.note(`actors 33.8-82.2GB each, act.js ${actPrice?.toFixed?.(2)}GB, planner block 1305GB`);
  }
  checks.push(c1);

  const c2 = new Check("AC2", "decision order: hand-over, then the gang bootstrap (crime -> gym/travel -> join), then work, then invitations");
  {
    c2.examined(1);
    const fresh = decide(base({ progress: { at: new Date(NOW - 5 * 60e3).toISOString(), health: "ok" } }));
    if (fresh.kind !== "idle" || !/progress\.js/.test(fresh.why)) c2.fail("a fresh acting planner must make act.js idle");
    const denied = decide(base({ progress: { at: new Date(NOW - 5 * 60e3).toISOString(), health: "error" } }));
    if (denied.kind === "idle") c2.fail("a planner whose RAM raise was denied is not acting — act.js must proceed");
    const stale = decide(base({ progress: { at: new Date(NOW - 60 * 60e3).toISOString(), health: "ok" } }));
    if (stale.kind === "idle") c2.fail("an hour-old progress.txt is not an acting planner");

    c2.examined(1);
    const d0 = decide(base());
    if (d0.kind !== "crime") c2.fail(`fresh life in a gang node: crime first, got ${d0.kind}`);
    if (d0.args[0] !== "Homicide") c2.fail(`from fresh stats the karma leg is Homicide, got ${d0.args[0]}`);
    const running = decide(base({ work: { kind: "crime", type: "Homicide" } }));
    if (running.kind !== "idle") c2.fail("with the crime loop already running, do not restart it");

    c2.examined(1);
    const rich = player({ karma: -20, money: 2e6, city: "Aevum" });
    const t = decide(base({ player: rich }));
    if (t.kind !== "travel" || t.args[0] !== "Sector-12") c2.fail(`karma and money met, combat short, in Aevum: travel, got ${t.kind}`);
    const g = decide(base({ player: { ...rich, city: "Sector-12" } }));
    if (g.kind !== "gym" || g.args[0] !== "Powerhouse Gym" || g.args[1] !== "str") c2.fail(`in Sector-12: gym strength first, got ${JSON.stringify(g)}`);
    const broke = decide(base({ player: player({ karma: -20, money: 1e6, city: "Aevum" }) }));
    if (broke.kind !== "travel") c2.fail("money exactly $1m still affords the $200k fare");
    const met = player({ karma: -20, money: 2e6, skills: { ...player().skills, strength: 30, defense: 30, dexterity: 30, agility: 30 } });
    const j = decide(base({ player: met }));
    if (j.kind !== "join" || j.args[0] !== "Slum Snakes") c2.fail(`all met: join Slum Snakes, got ${j.kind}`);
    const jj = decide(base({ player: met, tried: { "Slum Snakes": NOW - 10e3 } }));
    if (jj.kind !== "idle") c2.fail("a join tried 10s ago is not retried");

    c2.examined(1);
    // Karma met, money short: the best MONEY crime, not the karma crime.
    const ms = decide(base({ player: player({ karma: -20, money: 5000, skills: { ...player().skills, strength: 36, defense: 32, dexterity: 32, agility: 34 } }) }));
    const { bestCrimeFor } = await import("../../bodyplan.js");
    const bestMoney = bestCrimeFor("money", ms.player ?? player({ karma: -20, money: 5000, skills: { ...player().skills, strength: 36, defense: 32, dexterity: 32, agility: 34 } }), NODE).crime;
    if (ms.kind !== "crime" || ms.args[0] !== bestMoney || ms.args[0] === "Homicide") c2.fail(`money short: the best MONEY crime (${bestMoney}), not the karma crime, got ${ms.args}`);
    // Gang faction joined, no schedule yet: the slot earns money.
    const gq = decide(base({ factions: ["Slum Snakes"], player: player({ karma: -40, money: 3e6, skills: { ...player().skills, strength: 39, defense: 34, dexterity: 35, agility: 37 } }) }));
    if (gq.kind !== "crime" || gq.args[0] === "Homicide") c2.fail(`gang node, joined, no schedule: crime for money, got ${gq.kind} ${gq.args}`);
    const gf = decide(base({ gangNode: false, factions: ["Slum Snakes", "CyberSec"], gangFaction: "Slum Snakes", schedule: { current: { faction: "Slum Snakes" } } }));
    if (gf.kind !== "work" || gf.args[0] !== "CyberSec") c2.fail(`the gang faction cannot be worked; the next joined one is, got ${gf.kind} ${gf.args}`);
    const only = decide(base({ gangNode: false, factions: ["Slum Snakes"], gangFaction: "Slum Snakes" }));
    if (only.kind !== "idle") c2.fail("only the gang faction joined outside a gang node: idle with a reason");
    const w = decide(base({ factions: ["Slum Snakes"], schedule: { current: { faction: "Slum Snakes" } } }));
    if (w.kind !== "work" || w.args[0] !== "Slum Snakes") c2.fail("joined: work the schedule's faction");
    const w2 = decide(base({ gangNode: false, factions: ["CyberSec"], schedule: { current: { faction: "NiteSec" } } }));
    if (w2.kind !== "work" || w2.args[0] !== "CyberSec") c2.fail("a schedule naming an unjoined faction falls back to the first joined one");
    const w3 = decide(base({ gangNode: false, factions: ["CyberSec"], work: { kind: "work", faction: "CyberSec" } }));
    const gw = decide(base({ factions: ["CyberSec"] }));
    if (gw.kind !== "crime") c2.fail("in a gang node a joined non-gang faction does not stop the bootstrap");
    if (w3.kind !== "idle") c2.fail("already working the target: idle");

    c2.examined(1);
    const h = decide(base({ gangNode: false }));
    if (h.kind !== "join" || h.args[0] !== HACK_LINE[0]) c2.fail("no gang node, nothing joined: try the hack line");
    const h2 = decide(base({ gangNode: false, tried: Object.fromEntries(HACK_LINE.map((f) => [f, NOW - RETRY_MS / 2])) }));
    if (h2.kind !== "idle") c2.fail("every hack-line join tried recently: idle");
    if (decide({}).kind !== "idle") c2.fail("unreadable state: idle with a reason");
    for (const d of [fresh, d0, t, g, j, w, h, h2]) if (!d.why) c2.fail(`${d.kind} carries no reason`);
    c2.note(`fresh BN2 life: ${d0.kind} ${d0.args} — ${d0.why}`);
  }
  checks.push(c2);

  return checks;
}
