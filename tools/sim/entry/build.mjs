// The game's NETSCRIPT RUNTIME and its BitNode entry, bundled for the entry dry-run
// (tools/sim/entry/dryrun.mjs): a node-start state made by the game's own
// Prestige.ts prestigeSourceFile, and a REAL `ns` (NetscriptFunctions over a
// WorkerScript, the recipe tools/staging/ramoverride/rt-probe.mjs proved) that the
// planner runs against — nothing re-typed (CLAUDE.md "Fidelity").
//
//   node tools/sim/entry/build.mjs [--game <bitburner checkout>]
//
// ~15k modules (the React UI comes with NetscriptFunctions); env.mjs rebuilds it
// when the game source or this file is newer than the bundle.

import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argGame = process.argv.indexOf("--game");
// the game beside this repo; a worktree (no sibling) falls back to ~/Repos/bitburner
const SIBLING = path.join(HERE, "../../../../bitburner");
export const GAME = path.resolve(argGame > -1 ? process.argv[argGame + 1] : fs.existsSync(path.join(SIBLING, "src")) ? SIBLING : path.join(process.env.HOME ?? "", "Repos/bitburner"));
export const OUT = path.join(HERE, "game.bundle.mjs");

const ENTRY = `
export { helpers } from "${GAME}/src/Netscript/NetscriptHelpers";
export { WorkerScript } from "${GAME}/src/Netscript/WorkerScript";
export { workerScripts } from "${GAME}/src/Netscript/WorkerScripts";
export { killWorkerScript } from "${GAME}/src/Netscript/killWorkerScript";
export { ScriptDeath } from "${GAME}/src/Netscript/ScriptDeath";
export { NetscriptFunctions } from "${GAME}/src/NetscriptFunctions";
export { startWorkerScript } from "${GAME}/src/NetscriptWorker";
export { Engine } from "${GAME}/src/engine";
export { Server } from "${GAME}/src/Server/Server";
export { Player, setPlayer } from "@player";
export { PlayerObject } from "${GAME}/src/PersonObjects/Player/PlayerObject";
export { AddToAllServers, GetServer, GetAllServers } from "${GAME}/src/Server/AllServers";
export { initForeignServers } from "${GAME}/src/Server/ServerHelpers";
export { Script } from "${GAME}/src/Script/Script";
export { RunningScript } from "${GAME}/src/Script/RunningScript";
export { prestigeSourceFile, prestigeAugmentation } from "${GAME}/src/Prestige";
export { initBitNodeMultipliers, getBitNodeMultipliers } from "${GAME}/src/BitNode/BitNode";
export { currentNodeMults } from "${GAME}/src/BitNode/BitNodeMultipliers";
export { setBitNodeOptions, getDefaultBitNodeOptions } from "${GAME}/src/BitNode/BitNodeUtils";
export { initSourceFiles } from "${GAME}/src/SourceFile/SourceFiles";
export { Factions } from "${GAME}/src/Faction/Factions";
export { Companies } from "${GAME}/src/Company/Companies";
export { Augmentations } from "${GAME}/src/Augmentation/Augmentations";
export { staneksGift } from "${GAME}/src/CotMG/Helper";
export { calculateExp } from "${GAME}/src/PersonObjects/formulas/skill";
export { FormatsNeedToChange } from "${GAME}/src/ui/formatNumber";
export { CONSTANTS } from "${GAME}/src/Constants";
export { loadGame } from "${GAME}/src/SaveObject";
export { DarknetState } from "${GAME}/src/DarkNet/models/DarknetState";
export { getLabyrinthDetails, getNetDepth } from "${GAME}/src/DarkNet/effects/labyrinth";
export { getAllDarknetServers } from "${GAME}/src/DarkNet/utils/darknetNetworkUtils";
export { installAugmentations } from "${GAME}/src/Augmentation/AugmentationHelpers";
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

// THE ONE SEAM: the game compiles a script by importing a blob: URL, which node cannot. compile() defers to
// globalThis.__ENTRY_COMPILE(script) when it is set (world.mjs: node imports this checkout's file), so
// ns.exec / ns.run / ns.spawn keep every real check — RAM, root, threads, pids — and only the module load
// differs. A game whose compile() moved fails the build loudly, never silently unhooked.
const COMPILE_SIG = "export function compile(script: Script, scripts: Map<ScriptFilePath, Script>): Promise<ScriptModule> {";
const compileHook = {
  name: "entry-compile-hook",
  setup(b) {
    b.onLoad({ filter: /NetscriptJSEvaluator\.ts$/ }, (a) => {
      const src = fs.readFileSync(a.path, "utf8");
      if (!src.includes(COMPILE_SIG)) throw new Error(`${a.path}: compile()'s signature changed — the entry dry-run's module hook would not apply`);
      return { contents: src.replace(COMPILE_SIG, `${COMPILE_SIG}\n  const __hook = (globalThis as any).__ENTRY_COMPILE;\n  if (__hook) return __hook(script);`), loader: "ts" };
    });
  },
};

export async function build() {
  if (!fs.existsSync(path.join(GAME, "src/Prestige.ts"))) throw new Error(`no bitburner source at ${GAME} — pass --game <path to bitburner-src checkout>`);
  const entry = path.join(HERE, ".entry.generated.ts");
  fs.writeFileSync(entry, ENTRY);
  try {
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node20",
      outfile: OUT,
      alias: { "@player": path.join(GAME, "src/Player"), "@enums": path.join(GAME, "src/Enums"), "@nsdefs": path.join(GAME, "src/ScriptEditor/NetscriptDefinitions") },
      loader: { ".js": "jsx", ".ts": "ts", ".tsx": "tsx", ".png": "dataurl", ".jpg": "dataurl", ".svg": "text", ".css": "text", ".wav": "dataurl", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".mp3": "dataurl" },
      jsx: "automatic",
      plugins: [rawPlugin, stubPlugin, compileHook],
      define: { "process.env.NODE_ENV": '"production"' },
      banner: { js: `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);` },
      logLevel: "error",
    });
  } finally {
    fs.rmSync(entry, { force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await build();
