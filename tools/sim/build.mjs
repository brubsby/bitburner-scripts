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
export { currentNodeMults } from "${GAME}/src/BitNode/BitNodeMultipliers";
export { getUpgradeHomeRamCost, getUpgradeHomeCoresCost } from "${GAME}/src/PersonObjects/Player/PlayerObjectServerMethods";
export { calculateIntelligenceBonus } from "${GAME}/src/PersonObjects/formulas/intelligence";
export { getCloudServerCost, getCloudServerLimit, getCloudServerMaxRam } from "${GAME}/src/Server/ServerPurchases";
export { CONSTANTS } from "${GAME}/src/Constants";
export { DarkWebItems } from "${GAME}/src/DarkWeb/DarkWebItems";
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
