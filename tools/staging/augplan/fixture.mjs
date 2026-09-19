// Pull a REAL augmentation offer set out of the game and write it to
// fixture.json, so the planner's tests and the greedy-vs-planner measurement
// run against this playthrough's actual catalogue instead of invented numbers.
//
//   node tools/staging/augplan/fixture.mjs
//
// WHY A FIXTURE AND NOT A LIVE READ. The live save (2026-09-13) has
// `factions: []` and SF1.1 only — no Source-File 4, so `ns.singularity` throws
// and progress.js's purchasing path is dormant. There is no live offer set to
// measure against; see NOTES.md §7. What IS real and is used here is the
// catalogue: baseCost, baseRepRequirement, mults and the selling factions for
// every augmentation, read out of the game's own `Augmentations` table, plus
// the faction list this run's HACK_FACTIONS (progress.js:189-196) will join.
//
// CALIBRATION: the money and reputation numbers in this file are the game's
// own, taken from `~/Repos/bitburner`, and every cost the tests compute from
// them is cross-checked against the game's own `getAugCost` in AP6. What is
// NOT calibrated is the *reputation the run will actually have* when it plans —
// that is a scenario parameter swept over a range rather than a measurement,
// and the measurement script prints the range it swept.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "../../sim/env.mjs";
const g = await import("../../sim/game.bundle.mjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** progress.js:189-196 — the factions a hacking run joins, best first. */
export const HACK_FACTIONS = ["Daedalus", "BitRunners", "The Black Hand", "NiteSec", "CyberSec", "Netburners"];

const SOA = new Set(g.soaAugmentationNames);
const NFG = "NeuroFlux Governor";

const rows = [];
for (const aug of Object.values(g.Augmentations)) {
  rows.push({
    name: aug.name,
    baseCost: aug.baseCost,
    baseRepRequirement: aug.baseRepRequirement,
    mults: { ...aug.mults },
    prereqs: [...(aug.prereqs ?? [])],
    factions: [...(aug.factions ?? [])],
    isNFG: aug.name === NFG,
    isSoA: SOA.has(aug.name),
  });
}

const out = {
  generatedAt: new Date().toISOString(),
  gameVersion: JSON.parse(fs.readFileSync(path.join(HERE, "../../../../bitburner/package.json"), "utf8")).version,
  constants: {
    MultipleAugMultiplier: g.CONSTANTS.MultipleAugMultiplier,
    NeuroFluxGovernorLevelMult: g.CONSTANTS.NeuroFluxGovernorLevelMult,
    SoACostMult: g.CONSTANTS.SoACostMult,
    SoARepMult: g.CONSTANTS.SoARepMult,
  },
  bn4: {
    AugmentationMoneyCost: g.getBitNodeMultipliers(4, 1).AugmentationMoneyCost,
    AugmentationRepCost: g.getBitNodeMultipliers(4, 1).AugmentationRepCost,
    FactionWorkRepGain: g.getBitNodeMultipliers(4, 1).FactionWorkRepGain,
  },
  soaAugmentationNames: [...g.soaAugmentationNames],
  hackFactions: HACK_FACTIONS,
  augmentations: rows,
};

fs.writeFileSync(path.join(HERE, "fixture.json"), JSON.stringify(out, null, 1));
console.log(`fixture.json: ${rows.length} augmentations, game v${out.gameVersion}`);
console.log(`BN4 AugmentationMoneyCost=${out.bn4.AugmentationMoneyCost} AugmentationRepCost=${out.bn4.AugmentationRepCost}`);
// jsdom keeps timers alive; without this the process never exits.
process.exit(0);
