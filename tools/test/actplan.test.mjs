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
const { decide, gangKarmaTarget, SLUM_SNAKES, HACK_LINE, RETRY_MS } = ap;

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
    // THE HAND-OVER IS A CLAIM, NOT A HEARTBEAT.
    //
    // This block used to assert that ANY progress.txt under 15 minutes old
    // made act.js idle. progress.js publishes on every pass, so that condition
    // is permanently true and act.js was permanently idle — which froze the
    // gang bootstrap mid-sequence in BitNode 4: gym strength ran to 137
    // against a target of 30 while defense/dexterity/agility stayed at 1,
    // because the line that would have moved to defense could never run.
    // The test asserted the bug, so it could never have caught it.
    c2.examined(1);
    const claim = (owner, ageMin = 5, health = "ok") => ({ at: new Date(NOW - ageMin * 60e3).toISOString(), health, slot: { owner } });
    const held = decide(base({ progress: claim("faction") }));
    if (held.kind !== "idle" || !/holds the work slot/.test(held.why)) c2.fail("a planner that CLAIMED the slot must make act.js idle", JSON.stringify(held));
    const heldCrime = decide(base({ progress: claim("crime") }));
    if (heldCrime.kind !== "idle") c2.fail("a crime claim also holds the slot");
    // The yield: the planner ran, and said the slot is not its.
    const yielded = decide(base({ progress: claim(null) }));
    if (yielded.kind === "idle") c2.fail("a planner that YIELDED the slot must not keep act.js idle — this is the frozen-bootstrap case", JSON.stringify(yielded));
    // An absent slot field is an OLD planner build: treat as no claim, because
    // deferring by inertia is the failure being removed.
    const legacy = decide(base({ progress: { at: new Date(NOW - 5 * 60e3).toISOString(), health: "ok" } }));
    if (legacy.kind === "idle") c2.fail("a progress.txt with no slot field asserts no claim — act.js must proceed");
    const denied = decide(base({ progress: claim("faction", 5, "error") }));
    if (denied.kind === "idle") c2.fail("a planner whose RAM raise was denied is not acting — act.js must proceed");
    const stale = decide(base({ progress: claim("faction", 60) }));
    if (stale.kind === "idle") c2.fail("an hour-old progress.txt is not an acting planner, claim or no claim");

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
    for (const d of [held, yielded, d0, t, g, j, w, h, h2]) if (!d.why) c2.fail(`${d.kind} carries no reason`);
    c2.note(`fresh BN2 life: ${d0.kind} ${d0.args} — ${d0.why}`);
  }
  checks.push(c2);

  // ---------------------------------------------------------------------
  const c4 = new Check("AC4", "the combat sequence ADVANCES — a stat at its target hands over to the next, and a yielded planner cannot freeze it");
  {
    // The live BitNode 4 shape that motivated this: strength far past the
    // gate, the other three untouched. The only correct answer is defense.
    const overshot = player({
      karma: -20,
      money: 2e6,
      city: "Sector-12",
      skills: { ...player().skills, strength: 137, defense: 1, dexterity: 1, agility: 1 },
    });
    c4.examined(1);
    const d = decide(base({ player: overshot, progress: { at: new Date(NOW - 60e3).toISOString(), health: "ok", slot: { owner: null } } }));
    if (d.kind !== "gym" || d.args[1] !== "def") {
      c4.fail(`strength 137/30 with defense at 1 must train DEFENSE next, got ${JSON.stringify(d)}`);
    }
    // ...and it must not matter that the planner ran a second ago, so long as
    // it yielded. This is the exact freeze: an owner of 'faction' here would
    // return idle and strength would keep climbing.
    c4.examined(1);
    const frozen = decide(base({ player: overshot, progress: { at: new Date(NOW - 1e3).toISOString(), health: "ok", slot: { owner: null } } }));
    if (frozen.kind === "idle") c4.fail("a yielded planner must never freeze the combat sequence", JSON.stringify(frozen));

    // Walk the whole gate: each stat completing hands over to the next, and
    // the last one completing reaches the join. A sequence that cannot finish
    // is the bug; asserting only the first step would not have caught it.
    c4.examined(1);
    const order = [];
    const skills = { ...player().skills, strength: 1, defense: 1, dexterity: 1, agility: 1 };
    for (let step = 0; step < 12; step++) {
      const st = { ...player({ karma: -20, money: 2e6, city: "Sector-12" }), skills: { ...skills } };
      const r = decide(base({ player: st, progress: { at: new Date(NOW - 1e3).toISOString(), health: "ok", slot: { owner: null } } }));
      if (r.kind === "join") {
        order.push("join");
        break;
      }
      if (r.kind !== "gym") {
        c4.fail(`step ${step}: expected gym or join, got ${r.kind} (${r.why})`);
        break;
      }
      order.push(r.args[1]);
      // Training completes that stat exactly to the gate.
      const full = { str: "strength", def: "defense", dex: "dexterity", agi: "agility" }[r.args[1]];
      skills[full] = 30;
    }
    const expected = ["str", "def", "dex", "agi", "join"].join(",");
    if (order.join(",") !== expected) c4.fail(`the gate must be walked ${expected}, got ${order.join(",")}`);
    c4.note(`combat gate walked: ${order.join(" -> ")}`);
  }
  checks.push(c4);

  // ---------------------------------------------------------------------
  const c5 = new Check("AC5", "an install mid-bootstrap drops the faction but NOT the karma — the join branch must still serve the GANG's gate");
  {
    // THE LIVE 2026-09-21 STATE. An install landed with karma at -50,311 of
    // the gang's -54,000. Karma survives an install; faction membership does
    // not. So act.js woke outside Slum Snakes, with karma far past the
    // FACTION's -9 and 3,689 short of the GANG's, and money/combat reset.
    //
    // The join branch read karma as satisfied, optimised for the $1m join
    // gate, and chose Shoplift — 0.0173 karma/s against Homicide's 0.2565.
    // Fifteen times slower on the only axis still gating the gang, and
    // Homicide pays the combat exp the join needs as well.
    const postInstall = player({
      karma: -50311,
      money: 1262,
      city: "Sector-12",
      skills: { ...player().skills, hacking: 1, strength: 1, defense: 1, dexterity: 2, agility: 2 },
    });
    const st = base({ player: postInstall, factions: [], gangKarma: -54000, progress: { at: new Date(NOW - 1e3).toISOString(), health: "ok", slot: { owner: null } } });

    c5.examined(1);
    const d = decide(st);
    if (d.kind !== "crime") c5.fail(`3,689 karma short of the gang gate must run a crime, got ${d.kind} (${d.why})`);
    if (d.args?.[0] === "Shoplift") c5.fail("Shoplift is the best MONEY crime and near-zero karma — the live regression, chosen because the gang's gate was invisible");
    const { bestCrimeFor } = await import("../../bodyplan.js");
    const byKarma = bestCrimeFor("karma", postInstall, NODE, { focus: 1 })?.crime;
    if (d.args?.[0] !== byKarma) c5.fail(`with the gang's gate open the crime must serve KARMA (${byKarma}), got ${d.args?.[0]}`);
    if (!/GANG/.test(d.why ?? "")) c5.fail("the reason must name WHICH gate is driving the choice", d.why);

    // The faction's own gate still governs once the gang's is met: with karma
    // past -54,000 and only money short, the best MONEY crime is correct
    // again. Without this the fix would just pin Homicide forever.
    c5.examined(1);
    const karmaDone = { ...postInstall, karma: -60000 };
    const m = decide(base({ player: karmaDone, factions: [], gangKarma: -54000, progress: { at: new Date(NOW - 1e3).toISOString(), health: "ok", slot: { owner: null } } }));
    const byMoney = bestCrimeFor("money", karmaDone, NODE, { focus: 1 })?.crime;
    if (m.kind !== "crime" || m.args?.[0] !== byMoney) c5.fail(`gang gate met, money short: the best MONEY crime (${byMoney}), got ${m.kind} ${m.args?.[0]}`);

    // In BitNode 2 the gang gate IS the faction gate, so nothing changes.
    c5.examined(1);
    const bn2 = decide(base({ player: { ...postInstall, karma: -20 }, factions: [], gangKarma: -9, progress: { at: new Date(NOW - 1e3).toISOString(), health: "ok", slot: { owner: null } } }));
    if (bn2.kind !== "crime" || bn2.args?.[0] !== bestCrimeFor("money", { ...postInstall, karma: -20 }, NODE, { focus: 1 })?.crime) {
      c5.fail(`BitNode 2: karma -20 clears the -9 gang gate, so money governs, got ${bn2.args?.[0]}`);
    }
    c5.note(`post-install karma -50,311/-54,000 -> ${d.args?.[0]}; gate met -> ${m.args?.[0]}`);
  }
  checks.push(c5);

  // ---------------------------------------------------------------------
  const c3 = new Check("AC3", "the gang's karma gate is the GANG's, not the faction's: outside BitNode 2 the crime loop continues past the join to -54,000");
  {
    const src = fs.readFileSync(path.join(GAME, "src/Gang/data/Constants.ts"), "utf8");
    const req = Number(src.match(/GangKarmaRequirement:\s*(-?\d+)/)?.[1]);
    const access = fs.readFileSync(path.join(GAME, "src/PersonObjects/Player/PlayerObjectGangMethods.ts"), "utf8");

    // The source rule: BN2 short-circuits to success; everywhere else karma binds.
    c3.examined(1);
    if (!Number.isFinite(req)) c3.fail("could not read GangKarmaRequirement from Gang/data/Constants.ts");
    if (req !== gangKarmaTarget(false)) c3.fail(`gangKarmaTarget(non-BN2) is ${gangKarmaTarget(false)}, source says ${req}`);
    if (gangKarmaTarget(true) !== SLUM_SNAKES.karma) c3.fail(`in BitNode 2 only the faction's karma binds, got ${gangKarmaTarget(true)}`);
    if (!/bitNodeN === 2/.test(access) || !/GangKarmaRequirement/.test(access)) {
      c3.fail("canAccessGang no longer reads as 'BN2 exempt, otherwise karma' — re-check the rule");
    }

    // A member of the gang faction who already meets its -9: BN2 is finished,
    // everywhere else the gang is still 6000x of karma away.
    const joinedP = (karma) => {
      const p = player({ karma, money: 2e6 });
      for (const st of ["strength", "defense", "dexterity", "agility"]) p.skills[st] = 40;
      return p;
    };
    const joined = (karma, gangKarma) => decide(base({ factions: ["Slum Snakes"], gangKarma, player: joinedP(karma) }));
    c3.examined(1);
    const inBN2 = joined(-9, gangKarmaTarget(true));
    if (inBN2.kind === "crime" && /gang needs karma/.test(inBN2.why ?? "")) c3.fail("in BitNode 2 the bootstrap must not keep grinding karma after the join");
    const outside = joined(-9, gangKarmaTarget(false));
    if (outside.kind !== "crime") c3.fail(`outside BitNode 2, karma -9 is not enough for a gang: expected crime, got ${outside.kind} — ${outside.why}`);
    if (!/karma/.test(outside.why ?? "")) c3.fail("the crime decision must say which karma gate it is chasing");

    // Met: the loop stops rather than grinding forever.
    c3.examined(1);
    const met = joined(req - 1, gangKarmaTarget(false));
    if (met.kind === "crime" && /gang needs karma/.test(met.why ?? "")) c3.fail("karma target met: the gang crime loop must stop");
    // Already committing the crime it would pick: idle, not a restart every tick.
    const running = decide(base({ factions: ["Slum Snakes"], gangKarma: gangKarmaTarget(false), work: { kind: "crime", type: outside.args?.[0] }, player: joinedP(-9) }));
    if (running.kind !== "idle") c3.fail(`already committing the chosen crime: expected idle, got ${running.kind}`);

    // An absent gangKarma leaves the old behaviour exactly as it was.
    c3.examined(1);
    const legacy = decide(base({ factions: ["Slum Snakes"], player: joinedP(-9) }));
    if (legacy.kind === "crime" && /gang needs karma/.test(legacy.why ?? "")) c3.fail("without a gangKarma input the new loop must not engage");
    c3.note(`GangKarmaRequirement ${req} read from source; outside BN2 at karma -9 the plan says: ${outside.kind} ${outside.args} — ${outside.why}`);
  }
  checks.push(c3);

  return checks;
}
