// Produce the staged ns.ramOverride rewrites from the shipped originals.
//
//   node tools/staging/ramoverride/stage.mjs
//
// The transformation is deliberately MECHANICAL and identical for every file,
// because the interesting part is the RAM declaration and nothing else may
// change. Several of these scripts are already broken for unrelated reasons
// (invalid enum strings, ns.getPlayer() fields that no longer exist —
// docs/game-knowledge.md §1); none of that is touched here.
//
// For each candidate:
//
//   1. the original `export async function main(ns) {` becomes
//      `async function act(ns) {` — same body, byte for byte;
//   2. a new `export async function main(ns)` is prepended whose FIRST
//      STATEMENT is the literal `ns.ramOverride(FLOOR)` (the only shape
//      RamCalculations.ts:352-360/:484-487 honours), which then asks sfgate.js
//      whether the gated API is usable, publishes and returns if not, and
//      otherwise raises the allocation through ramgrow.js before calling act();
//   3. a header comment records what the floor excludes and why.
//
// `act`, not `run`: `run` is priced at 1GB by name (ns.run), and the checker
// prices every bare Identifier (RamCalculations.ts:407). Invariant B1.
//
// Output goes to tools/staging/ramoverride/ ONLY. Nothing here is deployed —
// the daemon's SKIP_DIRS contains `tools`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");

/** baseCost 1.6 (RamCostConstants.Base) + ns.getResetInfo 1.0 — everything a
 *  staged script calls before it knows whether it may proceed. sfgate.js is
 *  pure; status.js touches only ns.write (0GB); atExit/tprint/print/flags are 0. */
const FLOOR = 2.6;

/**
 * Per-file: the gate, the status file, and the header prose.
 *
 * `gate` names the sfgate.js predicate — never open-coded, invariant SF3.
 * `ceiling` is (nonSing, singBase) measured by `node stage.mjs --measure`
 * against the game's own calculator, then asserted by ramoverride.test.mjs [R5].
 */
const PLAN = {
  "createProgram.js": {
    status: "/tel/createProgram.txt",
    gate: "canUseSingularity",
    gateImport: "canUseSingularity, singularityRamMultiplier",
    excludes:
      "ns.singularity.createProgram (5GB base / 80GB at SF4.1) and ns.singularity.isBusy (0.5/8GB), " +
      "plus the ns.spawn/kill/ps/hacknet reads common.js's runCallbackExit and killOtherInstances pull in — " +
      "none reachable until the SF4 gate below passes",
    advice:
      "Create programs by hand: Terminal tab -> Create Program, pick the highest one your hacking level allows. " +
      "It needs a trusted click (ProgramsRoot.tsx:96,108), so no script can do it without Source-File 4.",
    ceiling: null,
  },
  "training.js": {
    status: "/tel/training.txt",
    gate: "canUseSingularity",
    gateImport: "canUseSingularity, singularityRamMultiplier",
    excludes:
      "ns.singularity.travelToCity / universityCourse / gymWorkout (2GB each at base, 32GB each at SF4.1), " +
      "stopAction (1/16GB) and isBusy (0.5/8GB), plus common.js's spawn/kill/ps/hacknet reads",
    advice:
      "Train by hand: City tab -> a university or gym -> pick a course. Rothman University (Sector-12) " +
      "and Powerhouse Gym (Sector-12) are the usual choices.",
    ceiling: null,
  },
  "crime.js": {
    status: "/tel/crime.txt",
    gate: "canUseSingularity",
    gateImport: "canUseSingularity, singularityRamMultiplier",
    excludes:
      "ns.singularity.getCrimeChance / getCrimeStats / commitCrime (5GB each at base, 80GB each at SF4.1) " +
      "and isBusy (0.5/8GB), plus common.js's spawn/kill/ps/hacknet reads",
    advice:
      "Commit crimes by hand: City tab -> The Slums. SlumsLocation.tsx:25 checks event.isTrusted, " +
      "so a click is required whatever the Source-File.",
    ceiling: null,
  },
  "faction.js": {
    status: "/tel/faction.txt",
    gate: "canUseSingularity",
    gateImport: "canUseSingularity, singularityRamMultiplier",
    excludes:
      "ns.singularity.getAugmentationsFromFaction / getOwnedAugmentations / getAugmentationStats (5GB each " +
      "at base, 80GB each at SF4.1), getAugmentationRepReq / getAugmentationPrice (2.5/40GB) and " +
      "getCompanyRep (1/16GB)",
    advice:
      "This script only PRINTS (--print-factions / --print-augs / --print-json). Without Source-File 4 the " +
      "same information is in the Factions and Augmentations tabs.",
    ceiling: null,
  },
  "bladeburner.js": {
    status: "/tel/bladeburner.txt",
    gate: "canUseBladeburner",
    gateImport: "canUseBladeburner, canUseSingularity, singularityRamMultiplier",
    excludes:
      "the whole ns.bladeburner.* surface (~20 calls at 4GB each, NOT scaled by Source-File 4 — " +
      "RamCostGenerator.ts applies SF4Cost only to the singularity namespace) and ns.singularity.isBusy " +
      "(0.5GB at base, 8GB at SF4.1), plus common.js's kill/ps/hacknet reads",
    advice:
      "Bladeburner needs Source-File 6 or 7, or BitNode 6/7 (NetscriptFunctions/Bladeburner.ts:35). " +
      "There is nothing to do by hand without the division.",
    ceiling: null,
    extraGate:
      "  // bladeburner.js also calls ns.singularity.isBusy, which is SF4-gated. The\n" +
      "  // Bladeburner API alone is not enough to run this file end to end.\n" +
      "  if (!canUseSingularity(info)) {\n" +
      "    note('waiting', {\n" +
      "      result: 'no-singularity',\n" +
      "      detail:\n" +
      "        'the Bladeburner API is available but ns.singularity.isBusy is not (needs Source-File 4 or ' +\n" +
      "        'BitNode 4), and this script calls it every loop. Staying at the " + FLOOR + "GB floor.',\n" +
      "      bitNode: info.currentNode,\n" +
      "    })\n" +
      "    return\n" +
      "  }\n",
  },
  "sleeve.js": {
    status: "/tel/sleeve.txt",
    gate: "canUseSleeve",
    gateImport: "canUseSleeve, canUseSingularity, singularityRamMultiplier",
    excludes:
      "the ns.sleeve.* surface (8 calls at 4GB each, not SF4-scaled) and the ns.singularity.* augmentation " +
      "reads faction.js contributes (5GB each at base, 80GB each at SF4.1)",
    advice:
      "Sleeves need Source-File 10 or BitNode 10 (NetscriptFunctions/Sleeve.ts:52). Without it there are no " +
      "sleeves to task.",
    ceiling: null,
    extraGate:
      "  // sleeve.js imports faction.js, whose augmentation helpers are ns.singularity.*.\n" +
      "  // Sleeve access alone does not make this file runnable end to end.\n" +
      "  if (!canUseSingularity(info)) {\n" +
      "    note('waiting', {\n" +
      "      result: 'no-singularity',\n" +
      "      detail:\n" +
      "        'sleeves are available but the augmentation helpers this file imports from faction.js are ' +\n" +
      "        'ns.singularity.* and need Source-File 4 or BitNode 4. Staying at the " + FLOOR + "GB floor.',\n" +
      "      bitNode: info.currentNode,\n" +
      "    })\n" +
      "    return\n" +
      "  }\n",
  },
};

const HEADER = (name, p, ceiling) => `// STAGED ns.ramOverride REWRITE of ${name}.
//
// Generated by tools/staging/ramoverride/stage.mjs from the shipped ${name}.
// The original \`main\` body is preserved BYTE FOR BYTE as \`act(ns)\`; the only
// change is how this file declares its RAM. Pre-existing defects in the logic
// (docs/game-knowledge.md §1) are deliberately NOT fixed here.
//
// ---------------------------------------------------------------------------
// RAMOVERRIDE ${FLOOR}GB — excludes: ${p.excludes}.
//
// Why this is sound: Netscript bills a script for every ns identifier in its
// import graph whether or not the call is reachable (RamCalculations.ts:407
// prices Identifier nodes, findFunc at :225-243 matches bare names), but only
// CALLING a Source-File-gated function throws. So this file may carry the
// references, declare ${FLOOR}GB, refuse to act when sfgate.js says it cannot, and be
// correct — instead of being unloadable in every BitNode that cannot use it.
//
// ${FLOOR} = RamCostConstants.Base (1.6) + ns.getResetInfo (1.0). That is everything
// called before the capability decision: sfgate.js is pure, status.js touches
// only ns.write (0GB), and atExit / tprint / print / flags are all 0GB.
//
// When the capability IS present the allocation is raised to the file's FULL
// static price before anything expensive runs, because \`dynamicRamUsage\` only
// rises and crossing the allocation kills the script
// (NetscriptHelpers.tsx:498-520). A raise the host cannot afford is SILENTLY
// DENIED (NetscriptFunctions.ts:1210-1214 returns the old value), which is why
// it goes through ramgrow.js and why this file returns rather than continuing.
//
// Registered in tools/sim/bncheck.mjs STRUCTURAL. Asserted by
// tools/test/ramoverride.test.mjs [R1..R5]: the game's own calculator prices
// this file in four regimes and the suite fails if the override is ignored or
// if RAISE_CEILING does not reach the full static price.
// ---------------------------------------------------------------------------
`;

const PREAMBLE = (name, p, ceiling) => `
import { ${p.gateImport} } from 'sfgate.js'
import { reporter } from 'status.js'
import { raiseRam } from 'ramgrow.js'

const RAMOVERRIDE_STATUS = '${p.status}'

/** This file's FULL static price as a function of the Singularity RAM
 *  multiplier (sfgate.js:71-77 — 1 inside BN4, 16 at SF4.1, 4 at SF4.2, 1 at
 *  SF4.3). ${ceiling.nonSing} = everything not under ns.singularity; ${ceiling.singBase} = the
 *  ns.singularity surface at base price. Both measured with the game's own
 *  calculator and re-checked on every run by ramoverride.test.mjs [R5]. */
const RAISE_CEILING = (mult) => ${ceiling.nonSing} + ${ceiling.singBase} * mult

export async function main(ns) {
  ns.ramOverride(${FLOOR})

  const rerrors = []
  const note = reporter(ns, RAMOVERRIDE_STATUS, () => ({ errors: rerrors.slice(-5) }))
  ns.atExit(() => note.exit('stopped', { detail: '${name} exited' }))

  // Ask the GAME what this save can do, through the shared rules. Not a
  // try/catch around the namespace: RAM is billed before a line executes, so
  // such a guard can never fire (CLAUDE.md, "a guard that can never fire").
  const info = ns.getResetInfo()
  if (!${p.gate}(info)) {
    note('waiting', {
      result: 'capability-absent',
      gate: '${p.gate}',
      bitNode: info.currentNode,
      detail:
        '${p.gate}() is false for this save, so ${name} cannot act. Staying at the ${FLOOR}GB floor ' +
        'instead of reserving its full price. ${p.advice.replace(/'/g, "\\\\'")}',
    })
    return
  }
${p.extraGate ?? ""}
  const want = RAISE_CEILING(singularityRamMultiplier(info))
  if (!raiseRam(ns, want, RAMOVERRIDE_STATUS, '${name} needs its full allocation before the first gated call')) return

  try {
    note('ok', { result: 'running', allocation: want, detail: 'allocation raised; running the original body' })
    await act(ns)
    note('ok', { result: 'finished', detail: '${name} returned normally' })
  } catch (err) {
    rerrors.push(\`\${new Date().toISOString()} \${err}\`)
    note('error', { result: 'error', detail: String(err) })
    throw err
  }
}

`;

/** Split the original at its `export async function main(ns) {`. */
function transform(name, p, ceiling) {
  const src = fs.readFileSync(path.join(REPO, name), "utf8");
  const m = /export\s+async\s+function\s+main\s*\(\s*(\w+)\s*\)\s*\{/.exec(src);
  if (!m) throw new Error(`${name}: no \`export async function main(ns) {\` to transform`);
  if (m[1] !== "ns") throw new Error(`${name}: main's parameter is \`${m[1]}\`, not \`ns\` — transform by hand`);

  // Imports must stay at the top of the module; splice the new ones in after the
  // original import block so the file still reads like the original.
  const lastImport = [...src.matchAll(/^\s*import .*$/gm)].at(-1);
  const cut = lastImport ? lastImport.index + lastImport[0].length : 0;

  const body = src.slice(0, m.index) + "async function act(ns) {" + src.slice(m.index + m[0].length);
  const withImports = body.slice(0, cut) + "\n" + PREAMBLE(name, p, ceiling).trimStart() + body.slice(cut);
  return HEADER(name, p, ceiling) + (lastImport ? withImports : HEADER.length && PREAMBLE(name, p, ceiling) + body);
}

/* ------------------------------------------------------------------ measure */
// The two constants are not guessed. Price the transformed file with the game's
// own calculator at mult=1 and mult=16 with the override stripped:
//   full(1)  = nonSing + singBase
//   full(16) = nonSing + 16*singBase
// so singBase = (full16 - full1)/15 and nonSing = full1 - singBase.

const measured = JSON.parse(fs.readFileSync(path.join(HERE, "ceilings.json"), "utf8"));

for (const [name, p] of Object.entries(PLAN)) {
  const ceiling = measured[name] ?? { nonSing: 0, singBase: 0 };
  fs.writeFileSync(path.join(HERE, name), transform(name, p, ceiling));
  console.log(`wrote ${name}  (floor ${FLOOR}, ceiling ${ceiling.nonSing} + ${ceiling.singBase}*mult)`);
}
