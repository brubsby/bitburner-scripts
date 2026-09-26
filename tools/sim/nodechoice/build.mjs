// The game's own Bladeburner, Sleeve and Player code, bundled for the
// next-BitNode comparison (tools/sim/nodechoice/). The Bladeburner exit is
// simulated by RUNNING the game's classes — Bladeburner.process(), the real
// actions, skills, cities, black operations, and real Sleeve work objects —
// rather than re-typing their formulas (CLAUDE.md "Fidelity").
//
//   node tools/sim/nodechoice/build.mjs [--game <bitburner checkout>]
//
// Deliberately SEPARATE from tools/sim/build.mjs (shared): same technique —
// esbuild over ~/Repos/bitburner, browser-only modules stubbed — with an entry
// of its own, following tools/sim/bn9/. env.mjs rebuilds it when the game
// source is newer than the bundle.

import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argGame = process.argv.indexOf("--game");
export const GAME = path.resolve(argGame > -1 ? process.argv[argGame + 1] : path.join(HERE, "../../../../bitburner"));
export const OUT = path.join(HERE, "game.bundle.mjs");

const ENTRY = `
export { Bladeburner } from "${GAME}/src/Bladeburner/Bladeburner";
export { BladeburnerConstants } from "${GAME}/src/Bladeburner/data/Constants";
export { Skills as BladeburnerSkills } from "${GAME}/src/Bladeburner/data/Skills";
export * from "${GAME}/src/Bladeburner/Enums";
export { calculateActionRankGain } from "${GAME}/src/Bladeburner/Formulas";
export { PlayerObject } from "${GAME}/src/PersonObjects/Player/PlayerObject";
export { Sleeve } from "${GAME}/src/PersonObjects/Sleeve/Sleeve";
export { SleeveInfiltrateWork } from "${GAME}/src/PersonObjects/Sleeve/Work/SleeveInfiltrateWork";
export { SleeveSupportWork } from "${GAME}/src/PersonObjects/Sleeve/Work/SleeveSupportWork";
export { SleeveBladeburnerWork } from "${GAME}/src/PersonObjects/Sleeve/Work/SleeveBladeburnerWork";
export { SleeveClassWork } from "${GAME}/src/PersonObjects/Sleeve/Work/SleeveClassWork";
export { GymType, LocationName, CityName, FactionName } from "@enums";
export { Player, setPlayer } from "@player";
export { Factions } from "${GAME}/src/Faction/Factions";
export { currentNodeMults, replaceCurrentNodeMults } from "${GAME}/src/BitNode/BitNodeMultipliers";
export { getBitNodeMultipliers } from "${GAME}/src/BitNode/BitNode";
export { calculateSkill, calculateExp } from "${GAME}/src/PersonObjects/formulas/skill";
export { applySourceFile } from "${GAME}/src/SourceFile/applySourceFile";
export { initSourceFiles } from "${GAME}/src/SourceFile/SourceFiles";
export { calculateClassEarnings } from "${GAME}/src/Work/Formulas";
export { Augmentations } from "${GAME}/src/Augmentation/Augmentations";
export { CONSTANTS } from "${GAME}/src/Constants";
// Number formatters are built lazily on this event (ui/formatNumber.ts:30); the
// Bladeburner log strings format HP on every damaging failure, so emit it once.
export { FormatsNeedToChange } from "${GAME}/src/ui/formatNumber";
`;

const rawPlugin = {
  name: "raw",
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, "")), namespace: "raw" }));
    b.onLoad({ filter: /.*/, namespace: "raw" }, (a) => ({ contents: fs.readFileSync(a.path, "utf8"), loader: "text" }));
  },
};

const stubPlugin = {
  name: "stub-browser-only",
  setup(b) {
    const filter = /^(monaco-editor|monaco-vim|@monaco-editor|@swc\/wasm-web|@babel\/standalone)/;
    b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "module.exports = new Proxy({}, { get: () => function () {} });", loader: "js" }));
  },
};

export async function build() {
  if (!fs.existsSync(path.join(GAME, "src/Bladeburner/Bladeburner.ts"))) {
    throw new Error(`no bitburner source at ${GAME} — pass --game <path to bitburner-src checkout>`);
  }
  const entry = path.join(HERE, ".entry.generated.ts");
  fs.writeFileSync(entry, ENTRY);
  try {
    await esbuild.build({
      entryPoints: [entry],
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
      loader: { ".png": "dataurl", ".jpg": "dataurl", ".svg": "text", ".css": "text", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".mp3": "dataurl", ".wav": "dataurl" },
      banner: { js: `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);` },
      logLevel: "error",
    });
  } finally {
    fs.rmSync(entry, { force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await build();
