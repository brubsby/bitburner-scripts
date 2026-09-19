// What the capability compiler is actually worth, across regimes we are not in.
//
//   node tools/compile/payoff.mjs
//   node tools/compile/payoff.mjs --json
//
// CLAUDE.md's "write for every stage of the game" is the reason this exists as
// a table rather than a number. Everything in this repo was measured in one
// save; invariant B6 says script RAM is a *function* of BitNode and SF4 level,
// and `progress.js` is 41.45GB in BitNode 4 and 627.95GB at SF4.1 elsewhere.
// A payoff figure quoted from the current save would be exactly the "true here,
// false elsewhere" failure.
//
// CALIBRATION: every number below comes from the game's own
// Script/RamCalculations.ts via tools/test/ram.mjs, which reproduces the live
// game's `calculateRam` to 0.00%. This script re-runs that calibration against
// the running game and prints the error before it prints any table. If the
// daemon is unreachable it says UNCALIBRATED in as many words — a table with no
// stated calibration reads as "checked and fine", which is the state that
// produced two fabricated validations in this repo.

import { makeProfile } from "./profile.mjs";
import { compile } from "./build.mjs";
import * as ram from "../test/ram.mjs";

/**
 * The four regimes. Chosen to bracket the two things that move: whether the
 * Singularity API exists at all, and what it costs when it does.
 */
const REGIMES = [
  { label: "BN4 (now)", bitNode: 4, sf: { 1: 1 }, note: "Singularity free, no SF4 needed (BitNodeUtils.ts:17)" },
  { label: "BN1 no SF", bitNode: 1, sf: {}, note: "the first-ever run: nothing gated is reachable" },
  { label: "BN1 SF4.1", bitNode: 1, sf: { 1: 1, 4: 1 }, note: "Singularity at x16 RAM (RamCostGenerator.ts:82-96)" },
  { label: "BN14 SF14.1", bitNode: 14, sf: { 14: 1 }, note: "go.cheat legal ONLY because we are inside BN14" },
];

// Which outputs are permanent residents. This is the only sum that means
// anything: a one-shot helper's RAM is paid for the seconds it runs, so adding
// it to a total would inflate the answer in the compiler's favour.
const RESIDENT = ["go.js", "autobuy.js"];

const ROWS = ["go.js", "go-cheat.js", "autobuy.js", "autobuy-sing.js", "profilecheck.js"];

/**
 * The third option, and the one that needs no build system at all:
 * `ns.ramOverride(X)` as the first statement of `main` in the HANDWRITTEN file.
 * See tools/compile/ramoverride.mjs for the rules and the eleven ways to write
 * it that are silently ignored.
 *
 * The number X has to be at least what the script's reachable paths actually
 * use at run time, because exceeding it KILLS the script
 * (NetscriptHelpers.tsx:498-520). So the floor is:
 *
 *     the compiled cost  +  every ns function the handwritten file still CALLS
 *                           in this regime but the compiled file removed
 *
 * That second term is where the hand judgement lives, and it is exactly the
 * reachability reasoning the RAM checker refuses to do. Both of these are one
 * call: the 1GB `ns.getResetInfo()` capability probe, which the compiled
 * versions evaluate at build time and the handwritten versions must still make.
 * `ns.exec` and `ns.isRunning` are REFERENCED by the handwritten go.js but
 * unreachable when the probe says the save cannot cheat, so they are excluded —
 * and being wrong about that is a crash loop, not a bad number.
 */
const OVERRIDE_EXTRA = {
  "go.js": { "ns.getResetInfo": 1.0 },
  "autobuy.js": { "ns.getResetInfo": 1.0 },
};
const overrideFloor = (name, compiled) =>
  compiled == null ? null : Math.round((compiled + Object.values(OVERRIDE_EXTRA[name] ?? {}).reduce((a, b) => a + b, 0)) * 100) / 100;

async function main() {
  await ram.load();

  // --- calibration first, before any conclusion is drawn from the numbers ---
  const cal = await ram.calibrate(["go.js", "autobuy.js", "autobuy-sing.js"]);
  if (!cal.calibrated) {
    console.log(`\n  UNCALIBRATED: ${cal.reason}`);
    console.log(`  The table below is from the game's source but has NOT been checked against the running game.\n`);
  } else {
    console.log(`\n  calibration vs the LIVE game's calculateRam (bn${cal.state.bitNode}):`);
    for (const r of cal.rows) {
      console.log(
        `    ${r.name.padEnd(18)} offline ${String(r.mine).padStart(7)}   live ${String(r.live ?? "n/a").padStart(7)}   err ${
          r.err == null ? "n/a" : `${(100 * r.err).toFixed(2)}%`
        }${r.note ? `  (${r.note})` : ""}`,
      );
    }
  }

  const table = new Map(); // row -> regime -> {hand, comp, emitted}
  for (const name of ROWS) table.set(name, new Map());

  for (const R of REGIMES) {
    const profile = makeProfile({ bitNode: R.bitNode, sf: R.sf, source: `payoff: ${R.label}` });
    const artifacts = await compile(profile);
    ram.asSave({ bitNode: R.bitNode, sf: R.sf });
    for (const name of ROWS) {
      const handwritten = ram.ramOf(name);
      const code = artifacts.get(name);
      table.get(name).set(R.label, {
        hand: handwritten.error ? null : handwritten.cost,
        comp: code ? ram.priceOverlay({ [name]: code }, name).cost : null,
        emitted: !!code,
        caps: profile.caps,
      });
    }
  }

  /* ------------------------------------------------------------- printing */

  const w = 13;
  const head = REGIMES.map((r) => r.label.padStart(w)).join("");
  console.log(`\n  Script RAM (GB), priced under four regimes. "—" = the compiler does not emit the file.\n`);
  console.log(`  ${"".padEnd(26)}${head}`);
  console.log(`  ${"".padEnd(26)}${REGIMES.map(() => "-------------".padStart(w)).join("")}`);

  for (const name of ROWS) {
    const cells = REGIMES.map((R) => {
      const c = table.get(name).get(R.label);
      return (c.hand == null ? "n/a" : c.hand.toFixed(2)).padStart(w);
    }).join("");
    console.log(`  ${(name + " handwritten").padEnd(26)}${cells}`);
    const cells2 = REGIMES.map((R) => {
      const c = table.get(name).get(R.label);
      return (c.emitted ? c.comp.toFixed(2) : "—").padStart(w);
    }).join("");
    console.log(`  ${(name + " compiled").padEnd(26)}${cells2}`);
    if (OVERRIDE_EXTRA[name]) {
      const cellsO = REGIMES.map((R) => {
        const c = table.get(name).get(R.label);
        return (overrideFloor(name, c.emitted ? c.comp : null)?.toFixed(2) ?? "—").padStart(w);
      }).join("");
      console.log(`  ${(name + " ramOverride").padEnd(26)}${cellsO}`);
    }
    const cells3 = REGIMES.map((R) => {
      const c = table.get(name).get(R.label);
      if (!c.emitted) return "not emitted".padStart(w);
      if (c.hand == null) return "new".padStart(w);
      const d = c.comp - c.hand;
      return `${d > 0 ? "+" : ""}${d.toFixed(2)}`.padStart(w);
    }).join("");
    console.log(`  ${"  delta".padEnd(26)}${cells3}`);
    console.log("");
  }

  console.log(`  RESIDENT TOTAL — only the scripts that stay running (${RESIDENT.join(" + ")}).`);
  console.log(`  A one-shot helper's RAM is paid for the seconds it runs, so it is deliberately excluded.\n`);
  const sum = (pick) => REGIMES.map((R) => RESIDENT.reduce((a, n) => a + pick(table.get(n).get(R.label)), 0));
  const hand = sum((c) => c.hand ?? 0);
  const comp = sum((c) => (c.emitted ? c.comp : 0));
  const over = REGIMES.map((R) => RESIDENT.reduce((a, n) => {
    const c = table.get(n).get(R.label);
    return a + (overrideFloor(n, c.emitted ? c.comp : null) ?? c.hand ?? 0);
  }, 0));
  console.log(`  ${"handwritten, as shipped".padEnd(26)}${hand.map((v) => v.toFixed(2).padStart(w)).join("")}`);
  console.log(`  ${"+ ns.ramOverride (no build)".padEnd(26)}${over.map((v) => v.toFixed(2).padStart(w)).join("")}`);
  console.log(`  ${"compiled".padEnd(26)}${comp.map((v) => v.toFixed(2).padStart(w)).join("")}`);
  console.log(
    `  ${"saved by ramOverride".padEnd(26)}${hand.map((v, i) => `${(v - over[i]).toFixed(2)} (${(((v - over[i]) / v) * 100).toFixed(0)}%)`.padStart(w)).join("")}`,
  );
  console.log(
    `  ${"saved by compiling".padEnd(26)}${hand.map((v, i) => `${(v - comp[i]).toFixed(2)} (${(((v - comp[i]) / v) * 100).toFixed(0)}%)`.padStart(w)).join("")}`,
  );
  console.log(
    `  ${"compiler's MARGIN over it".padEnd(26)}${over.map((v, i) => `${(v - comp[i]).toFixed(2)}`.padStart(w)).join("")}`,
  );
  console.log(
    `\n  That last row is the decision. It is the two 1GB ns.getResetInfo() probes that\n` +
      `  a build step can evaluate ahead of time and a one-line ramOverride cannot.\n` +
      `  Everything else the compiler saves, ramOverride also saves, with no build system.\n`,
  );
  console.log(
    `  ${"+ profilecheck".padEnd(26)}${REGIMES.map((R) => (comp[REGIMES.indexOf(R)] + table.get("profilecheck.js").get(R.label).comp).toFixed(2).padStart(w)).join("")}`,
  );
  console.log(
    `\n  The last row is the honest one: the compiler's saving has to pay for the\n` +
      `  mismatch check it makes necessary. profilecheck.js is a one-shot, so it is\n` +
      `  NOT resident — it is added here only to show it does not eat the win.\n`,
  );

  console.log(`  home RAM at node entry for each regime (Prestige.ts:242-248), which is what the saving is a fraction of:`);
  console.log(
    `  ${"".padEnd(26)}${REGIMES.map((R) => `${makeProfile({ bitNode: R.bitNode, sf: R.sf }).homeStartRam}GB`.padStart(w)).join("")}\n`,
  );
  for (const R of REGIMES) console.log(`    ${R.label.padEnd(13)} ${R.note}`);
  console.log("");

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify([...table].map(([k, v]) => [k, [...v]]), null, 2));
  }
}

await main();
