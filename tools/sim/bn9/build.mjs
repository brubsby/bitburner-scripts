// The game's own hacknet-server, hash-upgrade and hacking formulas, bundled
// for tools/test/hashplan.test.mjs — so hacknetplan.js / hashplan.js are
// checked against the source they port, not against a re-typed constant.
//
//   node tools/sim/bn9/build.mjs [--game <bitburner checkout>]
//
// Deliberately SEPARATE from tools/sim/build.mjs (shared, owned elsewhere):
// same technique — esbuild over ~/Repos/bitburner, browser-only modules
// stubbed — with an entry of its own. env.mjs rebuilds it when the game
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
export * as HServerF from "${GAME}/src/Hacknet/formulas/HacknetServers";
export { HacknetServerConstants } from "${GAME}/src/Hacknet/data/Constants";
export { HashUpgrades } from "${GAME}/src/Hacknet/HashUpgrades";
export { HashManager } from "${GAME}/src/Hacknet/HashManager";
export { HashUpgradeEnum } from "${GAME}/src/Hacknet/Enums";
export { calculateHackingTime, calculatePercentMoneyHacked, calculateHackingChance } from "${GAME}/src/Hacking";
export { calculateServerGrowthLog } from "${GAME}/src/Server/formulas/grow";
export { Server } from "${GAME}/src/Server/Server";
export { currentNodeMults, replaceCurrentNodeMults } from "${GAME}/src/BitNode/BitNodeMultipliers";
export { getBitNodeMultipliers } from "${GAME}/src/BitNode/BitNode";
export { getUpgradeHomeRamCost } from "${GAME}/src/PersonObjects/Player/PlayerObjectServerMethods";
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
  if (!fs.existsSync(path.join(GAME, "src/Hacknet/formulas/HacknetServers.ts"))) {
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
