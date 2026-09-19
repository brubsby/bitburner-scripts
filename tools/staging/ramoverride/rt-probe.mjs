// Probe: does the game's REAL Netscript runtime honour a mid-script
// ns.ramOverride(higher) so that a subsequent expensive call succeeds?
//
// Stands the game up under jsdom (tools/sim/env.mjs's recipe) and drives the
// actual `ramOverride` implementation (NetscriptFunctions.ts:1202) and the
// actual dynamic-RAM accounting (NetscriptHelpers.tsx:485 updateDynamicRam,
// called from APIWrapper.ts:80 BEFORE the wrapped function body runs).
//
// Nothing here re-implements either. That is the whole point: the design in
// tools/staging/ramoverride/ lives or dies on whether the raise works, and a
// hand-reasoned "it should" is exactly the fabricated validation CLAUDE.md
// warns about.

// MEASURED OUTPUT, 2026-09-13 (live save: BN4, home 32GB, no Source-Files):
//
//   game source: ns.singularity.getCurrentWork costs 0.5GB in BN4 (getRamCost, live)
//   game source: ns.singularity.purchaseTor costs 2GB in BN4
//   game source: RamCostConstants.Base = 1.6
//
//   [1] declared 1.6GB, call getCurrentWork with NO raise:
//       KILLED
//       dynamicRamUsage now 2.1, allocation 1.6
//
//   [2] declared 1.6GB, ns.ramOverride(2.1) returned 2.1
//       server.ramUsed now 2.1 of 64
//       call getCurrentWork after raise: SURVIVED
//       dynamicRamUsage now 2.1, allocation 2.1
//
//   [3] full 8GB home, ns.ramOverride(2.1) returned 1.6 (asked 2.1)
//       -> raise SILENTLY DENIED — no throw, no log
//       call getCurrentWork after denied raise: KILLED
//
//   [4] after getCurrentWork (dynamicRamUsage 2.1), ns.ramOverride(1.6) returned 2.1
//       -> REFUSED, allocation unchanged (dynamicRamUsage only rises)
//
//   [5] 4 threads, declared 1.6 -> ramOverride(2.1) returned 2.1; server.ramUsed 8.4
//       (the raise costs (new-old)*threads = 2GB of the host)
//
// [2] IS THE CRUX AND IT WORKS. A runtime raise before the expensive call lets
// the call through: updateDynamicRam compares against ws.scriptRef.ramUsage,
// which ramOverride (NetscriptFunctions.ts:1222) has just moved.
//
// [3] IS A TWELFTH SILENT FAILURE MODE that tools/compile/NOTES-compile.md does
// not list, and it is the dangerous one for this design. NetscriptFunctions.ts:1210-1214:
//
//     const newServerRamUsed = roundToTwo(server.ramUsed + (newRam - rs.ramUsage) * rs.threads);
//     if (newServerRamUsed > server.maxRam) {
//       // Can't allocate more RAM.
//       return rs.ramUsage;          <- the OLD value. No throw. No log.
//     }
//
// A raise the host cannot afford returns the previous allocation and the script
// carries on believing it grew; the next gated call kills it, two statements
// away from the cause. => EVERY RUNTIME RAISE MUST CHECK ITS RETURN VALUE.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import "../../sim/env.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The runtime bundle is ~11MB and entirely derived; build it on demand rather
// than leaving it lying around. execFileSync, not await: a top-level await makes
// this module async, and ES modules do not guarantee an async module finishes
// before its siblings evaluate (the trap tools/sim/env.mjs documents).
if (!fs.existsSync(path.join(HERE, "rt.bundle.mjs"))) {
  execFileSync(process.execPath, [path.join(HERE, "rt-build.mjs")], { stdio: "inherit" });
}

const G = await import("./rt.bundle.mjs");

const out = [];
const say = (s) => {
  out.push(s);
  console.log(s);
};

// ------------------------------------------------------- a real, tiny world
// Real Server, real Script, real RunningScript, real WorkerScript. Nothing
// below is a stand-in for a game class; only the *world* is small.
const { Server, WorkerScript, NetscriptFunctions, setPlayer, Player, getRamCost, RamCostConstants, AddToAllServers, Script, RunningScript, GetServer } =
  G;

let hostSeq = 0;

/** A fresh host with one script file on it, and a WorkerScript running it. */
function world(maxRam, declared, threads = 1) {
  const hostname = `probe${hostSeq++}`;
  const server = new Server({ hostname, maxRam });
  AddToAllServers(server);
  const script = new Script("probe.js", "export async function main(ns){}", hostname);
  server.scripts.set("probe.js", script);
  const rs = new RunningScript(script, declared, []);
  rs.threads = threads;
  const ws = new WorkerScript(rs, 1 + hostSeq, NetscriptFunctions);
  return { server, ws, ns: ws.vars };
}

export async function probe() {
  setPlayer(Player);
  // Inside BitNode 4: singularity at base price, no Source-File needed.
  Player.bitNodeN = 4;

  // getCurrentWork is a real Singularity call that needs no world around it
  // (it reads Player.currentWork), so a survival here is unambiguous: the only
  // thing that can kill it is the dynamic-RAM check.
  const singCost = getRamCost(["singularity", "getCurrentWork"]);
  say(`game source: ns.singularity.getCurrentWork costs ${singCost}GB in BN4 (getRamCost, live)`);
  say(`game source: ns.singularity.purchaseTor costs ${getRamCost(["singularity", "purchaseTor"])}GB in BN4`);
  say(`game source: RamCostConstants.Base = ${RamCostConstants.Base}`);

  const results = {};

  // --- scenario 1: declared floor, then the expensive call WITHOUT a raise ---
  {
    const declared = 1.6;
    const { server: home, ws, ns } = world(64, declared);
    home.updateRamUsed(declared);
    let died = null;
    try {
      // Do not actually buy anything — we only need the dynamic-RAM accounting,
      // which APIWrapper performs before the body runs. Reading the property
      // does not charge; calling does.
      ns.singularity.getCurrentWork();
    } catch (e) {
      died = String(e?.message ?? e);
    }
    results.noRaise = died;
    say(`\n[1] declared ${declared}GB, call getCurrentWork with NO raise:`);
    say(`    ${died ? "KILLED: " + died.split("\n")[0].trim() : "*** SURVIVED (unexpected) ***"}`);
    say(`    dynamicRamUsage now ${ws.dynamicRamUsage}, allocation ${ws.scriptRef.ramUsage}`);
  }

  // --- scenario 2: declared floor, RAISE, then the expensive call ------------
  {
    const declared = 1.6;
    const { server: home, ws, ns } = world(64, declared);
    home.updateRamUsed(declared);
    const target = 1.6 + singCost;
    const got = ns.ramOverride(target);
    say(`\n[2] declared ${declared}GB, ns.ramOverride(${target}) returned ${got}`);
    say(`    server.ramUsed now ${home.ramUsed} of ${home.maxRam}`);
    let died = null;
    try {
      ns.singularity.getCurrentWork();
    } catch (e) {
      died = String(e?.message ?? e);
    }
    results.raise = { got, target, died };
    say(`    call getCurrentWork after raise: ${died ? "KILLED: " + died.split("\n")[0].trim() : "SURVIVED"}`);
    say(`    dynamicRamUsage now ${ws.dynamicRamUsage}, allocation ${ws.scriptRef.ramUsage}`);
  }

  // --- scenario 3: the raise DENIED because the server has no free RAM ------
  // NetscriptFunctions.ts:1210-1214 returns the OLD ramUsage without raising
  // and without throwing. This is a silent failure mode of the design and the
  // reason a raise's RETURN VALUE has to be checked.
  {
    const declared = 1.6;
    const { server: home, ws, ns } = world(8, declared);
    home.updateRamUsed(8); // machine full
    const target = 1.6 + singCost;
    const got = ns.ramOverride(target);
    let died = null;
    try {
      ns.singularity.getCurrentWork();
    } catch (e) {
      died = String(e?.message ?? e);
    }
    results.denied = { got, target, died };
    say(`\n[3] full 8GB home, ns.ramOverride(${target}) returned ${got} (asked ${target})`);
    say(`    -> raise ${got === target ? "GRANTED" : "SILENTLY DENIED — no throw, no log"}`);
    say(`    call getCurrentWork after denied raise: ${died ? "KILLED" : "SURVIVED"}`);
  }

  // --- scenario 4: lowering below dynamicRamUsage is a silent no-op ---------
  {
    const declared = 1.6 + singCost;
    const { server: home, ws, ns } = world(64, declared);
    home.updateRamUsed(declared);
    try {
      ns.singularity.getCurrentWork();
    } catch {
      /* ignore */
    }
    const before = ws.scriptRef.ramUsage;
    const got = ns.ramOverride(1.6);
    results.lower = { before, got };
    say(`\n[4] after getCurrentWork (dynamicRamUsage ${ws.dynamicRamUsage}), ns.ramOverride(1.6) returned ${got}`);
    say(`    -> ${got === before ? "REFUSED, allocation unchanged (dynamicRamUsage only rises)" : "lowered"}`);
  }

  // --- scenario 6: the exact shape the staged scripts ship -----------------
  // declared 2.6 (base 1.6 + getResetInfo 1.0), read the reset info, raise to
  // the measured full price, then make the gated call. This is crime.js's
  // sequence with crime.js's numbers.
  {
    const declared = 2.6
    const { server: home, ws, ns } = world(64, declared);
    home.updateRamUsed(declared);
    ns.getResetInfo();                       // the 1.0GB capability probe
    const target = 20.6;                     // crime.js's measured BN4 full price
    const got = ns.ramOverride(target);
    let died = null;
    try {
      ns.singularity.getCrimeChance("Shoplift");
    } catch (e) {
      died = String(e?.message ?? e);
    }
    results.shipped = { got, target, died, dyn: ws.dynamicRamUsage };
    say(`\n[6] SHIPPED SHAPE: declared 2.6 -> getResetInfo -> ramOverride(${target}) = ${got}`);
    say(`    then ns.singularity.getCrimeChance: ${died ? "KILLED: " + died.split("\n")[0].trim() : "SURVIVED"}`);
    say(`    dynamicRamUsage ${ws.dynamicRamUsage} of allocation ${ws.scriptRef.ramUsage}`);
  }

  // --- scenario 5: threads multiply the server-side cost of a raise ---------
  {
    const declared = 1.6;
    const threads = 4;
    const { server: home, ws, ns } = world(64, declared, threads);
    home.updateRamUsed(declared * threads);
    const target = 1.6 + singCost;
    const got = ns.ramOverride(target);
    results.threads = { got, target, ramUsed: home.ramUsed };
    say(`\n[5] 4 threads, declared 1.6 -> ramOverride(${target}) returned ${got}; server.ramUsed ${home.ramUsed}`);
    say(`    (the raise costs (new-old)*threads = ${(target - declared) * threads}GB of the host)`);
  }

  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await probe();
  // jsdom's pretendToBeVisual keeps a timer alive, so node never exits on its
  // own. Exit explicitly (and flush) rather than leaving a hung process.
  process.stdout.write("", () => process.exit(0));
}
