// Bundles the game's own source into a module node can import, so the
// simulator runs against the real formulas instead of a hand-port that drifts
// every time upstream changes.
//
//   node tools/sim/build.mjs [--game ../bitburner]
//
// Anything browser-only that the dependency graph drags in (the Monaco script
// editor, the babel/swc transformers) is replaced with a permissive proxy —
// the simulator never calls into it, it just has to survive module init.

import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argGame = process.argv.indexOf("--game");
export const GAME = path.resolve(argGame > -1 ? process.argv[argGame + 1] : path.join(HERE, "../../../bitburner"));
export const OUT = path.join(HERE, "game.bundle.mjs");

/** Surface of the game we want available to the simulator. */
const ENTRY = `
export * from "${GAME}/src/Hacking";
export * from "${GAME}/src/Server/formulas/grow";
export * from "${GAME}/src/PersonObjects/formulas/skill";
export { numCycleForGrowthCorrected, getCoreBonus, getWeakenEffect, processSingleServerGrowth } from "${GAME}/src/Server/ServerHelpers";
export { Server } from "${GAME}/src/Server/Server";
export { ServerConstants } from "${GAME}/src/Server/data/Constants";
export { currentNodeMults, replaceCurrentNodeMults } from "${GAME}/src/BitNode/BitNodeMultipliers";
// The SETTER, not just the value. Without it nothing could ever change
// currentNodeMults from its default of all 1s (a bare BitNodeMultipliers), so
// every model under tools/sim silently computed BitNode 1 physics — 5x too high
// on hack money and 2.5x too high on exp in BitNode 4, with every formula
// individually correct. See setBitNode() in game.mjs.
export { initBitNodeMultipliers } from "${GAME}/src/BitNode/BitNode";
// Pure function of (bitNode, level): lets tooling compute the multipliers of a
// BitNode we have not entered yet. See tools/sim/bncheck.mjs.
export { getBitNodeMultipliers } from "${GAME}/src/BitNode/BitNode";
export { getUpgradeHomeRamCost, getUpgradeHomeCoresCost } from "${GAME}/src/PersonObjects/Player/PlayerObjectServerMethods";
export { calculateIntelligenceBonus } from "${GAME}/src/PersonObjects/formulas/intelligence";
export { getCloudServerCost, getCloudServerLimit, getCloudServerMaxRam } from "${GAME}/src/Server/ServerPurchases";
export { CONSTANTS } from "${GAME}/src/Constants";
export { DarkWebItems } from "${GAME}/src/DarkWeb/DarkWebItems";

// --- Reputation, favor, donations, augmentation pricing, prestige ---------
// Added for tools/test/formulas.test.mjs (docs/invariants.md section A). Every
// one of these is a formula this repo has a hand-written copy of, in a script
// or in prose; exporting the real thing is what lets the suite compare
// source against source instead of against a re-typed constant.
export { repFromDonation, donationForRep, favorNeededToDonate } from "${GAME}/src/Faction/formulas/donation";
export { favorToRep, repToFavor, addRepToFavor, MaxFavor } from "${GAME}/src/Faction/formulas/favor";
export { getHackingWorkRepGain, getFactionSecurityWorkRepGain, getFactionFieldWorkRepGain } from "${GAME}/src/PersonObjects/formulas/reputation";
export { getAugCost, getGenericAugmentationPriceMultiplier, getBaseAugmentationPriceMultiplier, soaAugmentationNames } from "${GAME}/src/Augmentation/AugmentationHelpers";
export { Augmentations, initAugmentations } from "${GAME}/src/Augmentation/Augmentations";
export { Faction } from "${GAME}/src/Faction/Faction";
export { prestigeHomeComputer } from "${GAME}/src/Server/ServerHelpers";
export { serverMetadata } from "${GAME}/src/Server/data/servers";
export { RamCosts, RamCostConstants, getRamCost } from "${GAME}/src/Netscript/RamCostGenerator";
// Player is a live binding assigned by setPlayer; the RAM ladder and the
// augmentation price multiplier are functions OF player state, so a test that
// cannot move it has tested exactly one save.
export { Player, setPlayer } from "@player";
export { calculateCurrentShareBonus } from "${GAME}/src/NetworkShare/Share";

// IPvGO. Exported so the Go bot can be tuned against the game's *real*
// opponent instead of a stand-in. This is not a nicety: a hand-written greedy
// opponent in an offline harness reported a 100% win rate for golib.js at every
// setting, while the same code lost 10 straight games in the actual game. The
// harness was measuring a strawman. See the fidelity rule above — offline
// tooling has no RAM budget and therefore no excuse for not using game source.
export { getMove } from "${GAME}/src/Go/boardAnalysis/goAI";
export { getNewBoardState, makeMove, passTurn } from "${GAME}/src/Go/boardState/boardState";
export { getAllValidMoves, simpleBoardFromBoard } from "${GAME}/src/Go/boardAnalysis/boardAnalysis";
export { getScore, getOpponentStats } from "${GAME}/src/Go/boardAnalysis/scoring";
export { CalculateEffect, getWinstreakMultiplier, getDifficultyMultiplier } from "${GAME}/src/Go/effects/effect";
export { GoColor, GoOpponent } from "${GAME}/src/Go/Enums";
export { Go } from "${GAME}/src/Go/Go";
export { opponentDetails } from "${GAME}/src/Go/Constants";
`;

const rawPlugin = {
  name: "raw",
  setup(build) {
    // Webpack's `?raw` suffix, which the game uses for literature content.
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: path.resolve(args.resolveDir, args.path.replace(/\?raw$/, "")),
      namespace: "raw",
    }));
    build.onLoad({ filter: /.*/, namespace: "raw" }, (args) => ({
      contents: fs.readFileSync(args.path, "utf8"),
      loader: "text",
    }));
  },
};

const stubPlugin = {
  name: "stub-browser-only",
  setup(build) {
    const filter = /^(monaco-editor|monaco-vim|@monaco-editor|@swc\/wasm-web|@babel\/standalone)/;
    build.onResolve({ filter }, (args) => ({ path: args.path, namespace: "stub" }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "module.exports = new Proxy({}, { get: () => function () {} });",
      loader: "js",
    }));
  },
};

export async function build({ quiet = false } = {}) {
  if (!fs.existsSync(path.join(GAME, "src/Hacking.ts"))) {
    throw new Error(`no bitburner source at ${GAME} — pass --game <path to bitburner-src checkout>`);
  }

  const entryFile = path.join(HERE, ".entry.generated.ts");
  fs.writeFileSync(entryFile, ENTRY);

  try {
    const result = await esbuild.build({
      entryPoints: [entryFile],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile: OUT,
      alias: {
        "@player": path.join(GAME, "src/Player"),
        "@enums": path.join(GAME, "src/Enums"),
        "@nsdefs": path.join(GAME, "src/ScriptEditor/NetscriptDefinitions"),
      },
      plugins: [rawPlugin, stubPlugin],
      loader: {
        ".png": "dataurl",
        ".jpg": "dataurl",
        ".svg": "text",
        ".css": "text",
        ".woff": "dataurl",
        ".woff2": "dataurl",
        ".ttf": "dataurl",
        ".mp3": "dataurl",
        ".wav": "dataurl",
      },
      // react-dom/server reaches for node builtins through require().
      banner: { js: `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);` },
      logLevel: quiet ? "silent" : "error",
      metafile: true,
    });

    const modules = Object.keys(result.metafile.inputs).length;
    if (!quiet) {
      const version = JSON.parse(fs.readFileSync(path.join(GAME, "package.json"), "utf8")).version;
      console.log(`bundled bitburner v${version} — ${modules} modules -> ${path.relative(process.cwd(), OUT)}`);
    }
    return { modules, out: OUT };
  } finally {
    fs.rmSync(entryFile, { force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await build();
