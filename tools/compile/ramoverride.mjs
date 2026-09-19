// What ns.ramOverride actually does, measured against the game's own calculator.
//
//   node tools/compile/ramoverride.mjs
//
// This exists because ramOverride is the alternative to the whole compiler, and
// the recommendation in NOTES-compile.md turns on it. A claim that decides
// whether to adopt a build system must be measured in a file that re-runs, not
// asserted from a reading of the source (CLAUDE.md: "a model states its
// calibration, or states that it has none").
//
// Every row below is priced with `Script/RamCalculations.ts` itself, via
// tools/test/ram.mjs, which reproduces the LIVE game's calculateRam to 0.00%.
//
// ---------------------------------------------------------------------------
// The rule, read out of source:
//
//   RamCostGenerator.ts:657        ramOverride: 0        <- the call is free
//   RamCalculations.ts:484-487     checkRamOverride runs ONLY for a
//                                  FunctionDeclaration whose id.name === "main"
//   RamCalculations.ts:352-360     ...on the FIRST statement of its body, which
//                                  must be an ExpressionStatement wrapping a
//                                  CallExpression with exactly ONE argument
//   RamCalculations.ts:383-384     the callee identifier must be `ramOverride`
//   RamCalculations.ts:388-394     the argument must be a numeric Literal
//   RamCalculations.ts:395         and >= RamCostConstants.Base (1.6)
//   RamCalculations.ts:174-181     only the ENTRY module's override counts;
//                                  one in an imported module is discarded, and
//                                  a match ends the calculation immediately,
//                                  REPLACING the computed cost outright
//
// Runtime:
//   NetscriptFunctions.ts:1202-1222  raising or lowering at run time; refuses
//                                    to go below dynamicRamUsage, and refuses
//                                    to raise beyond the server's free RAM —
//                                    in BOTH cases by returning the unchanged
//                                    value, not by throwing
//   NetscriptHelpers.tsx:484-520     every ns call adds to dynamicRamUsage once
//                                    per function name; crossing the allocation
//                                    KILLS the script, with an error that names
//                                    ramOverride as a likely cause

import * as ram from "../test/ram.mjs";

const SF = { bitNode: 1, sf: { 4: 1 } }; // BN1 + SF4.1 -> singularity billed x16

const CASES = [
  ["no override at all", `export async function main(ns){ ns.singularity.purchaseTor() }`, "full price"],
  ["ramOverride(1.6) as first statement", `export async function main(ns){ ns.ramOverride(1.6); ns.singularity.purchaseTor() }`, "1.6"],
  ["ramOverride(2.6)", `export async function main(ns){ ns.ramOverride(2.6); ns.singularity.purchaseTor() }`, "2.6"],
  // --- every one of these is SILENTLY ignored: full price, no warning ---
  ["below Base: ramOverride(1.5)", `export async function main(ns){ ns.ramOverride(1.5); ns.singularity.purchaseTor() }`, "IGNORED"],
  ["ramOverride(0)", `export async function main(ns){ ns.ramOverride(0); ns.singularity.purchaseTor() }`, "IGNORED"],
  ["non-literal: ramOverride(v)", `export async function main(ns){ const v=1.6; ns.ramOverride(v); ns.singularity.purchaseTor() }`, "IGNORED"],
  ["expression: ramOverride(1.6+0)", `export async function main(ns){ ns.ramOverride(1.6+0); ns.singularity.purchaseTor() }`, "IGNORED"],
  ["not the first statement", `export async function main(ns){ ns.disableLog("ALL"); ns.ramOverride(1.6); ns.singularity.purchaseTor() }`, "IGNORED"],
  ["arrow: export const main = async () => {}", `export const main = async (ns) => { ns.ramOverride(1.6); ns.singularity.purchaseTor() }`, "IGNORED"],
  ["in a helper function, not main", `function h(ns){ ns.ramOverride(1.6) }\nexport async function main(ns){ h(ns); ns.singularity.purchaseTor() }`, "IGNORED"],
  ["renamed + re-exported: export {main2 as main}", `async function main2(ns){ ns.ramOverride(1.6); ns.singularity.purchaseTor() }\nexport { main2 as main }`, "IGNORED"],
  ["destructured: const {ramOverride}=ns", `export async function main(ns){ const {ramOverride}=ns; ramOverride(1.6); ns.singularity.purchaseTor() }`, "IGNORED"],
  ["inside if(false){}", `export async function main(ns){ if (false) { ns.ramOverride(1.6) } ns.singularity.purchaseTor() }`, "IGNORED"],
  // --- things that DO still work ---
  ["leading comment before it", `export async function main(ns){ /* c */ ns.ramOverride(1.6); ns.singularity.purchaseTor() }`, "1.6"],
  ["parameter renamed to ns2 (bundler)", `export async function main(ns2){ ns2.ramOverride(1.6); ns2.singularity.purchaseTor() }`, "1.6"],
  ["second call is not read at all", `export async function main(ns){ ns.ramOverride(2.6); ns.ramOverride(50); ns.singularity.purchaseTor() }`, "2.6"],
];

await ram.load();

// calibrate() re-points the pricer at the LIVE save, because comparing against
// the running game under any other regime would be meaningless. So the regime
// this file is about has to be re-applied AFTERWARDS. Getting that order wrong
// silently priced every row under BN4 (singularity x1) instead of SF4.1 (x16),
// produced a 3.60GB baseline instead of 33.60GB, and flagged eleven correct
// rows as disagreeing with the source. The disagreement counter is what caught
// it — which is the argument for printing a check that can fail loudly rather
// than trusting a number that looks plausible.
const cal = await ram.calibrate(["autobuy-sing.js"]);
ram.asSave(SF);
console.log(
  cal.calibrated
    ? `\n  calibration: offline ${cal.rows[0].mine}GB vs LIVE game ${cal.rows[0].live}GB — error ${(100 * cal.rows[0].err).toFixed(2)}%`
    : `\n  UNCALIBRATED: ${cal.reason} — numbers below are from game source but unchecked against the running game`,
);
const BASELINE = ram.priceCode(`export async function main(ns){ ns.singularity.purchaseTor() }`).cost;
console.log(`\n  ns.ramOverride, priced under BN1 + SF4.1 (singularity x16). Baseline with no override: ${BASELINE}GB.\n`);
console.log(`  ${"case".padEnd(46)} ${"cost".padStart(8)}   expected`);
console.log(`  ${"-".repeat(46)} ${"-".repeat(8)}   --------`);

let surprises = 0;
for (const [label, code, expected] of CASES) {
  const r = ram.priceCode(code);
  const cost = r.error ? `ERR` : r.cost;
  const honored = !r.error && r.cost < BASELINE;
  const wanted = expected !== "IGNORED" && expected !== "full price";
  if (honored !== wanted) surprises++;
  console.log(`  ${label.padEnd(46)} ${String(cost).padStart(8)}   ${expected}${honored !== wanted ? "   <-- DISAGREES WITH THE READING OF SOURCE" : ""}`);
}

console.log(
  surprises
    ? `\n  ${surprises} row(s) disagree with the reading of the source above. Believe the measurement.\n`
    : `\n  All rows match the reading of RamCalculations.ts cited in this file's header.\n`,
);

console.log(`  The eleven IGNORED rows are the point. Every one of them is a plausible way to`);
console.log(`  write the call, every one silently yields FULL price, and nothing anywhere says so:`);
console.log(`  no warning, no log line, no error. The script simply costs what it always did.\n`);
