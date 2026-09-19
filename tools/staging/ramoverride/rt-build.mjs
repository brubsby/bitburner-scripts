// Bundles the game's NETSCRIPT RUNTIME (not just its RAM calculator) so
// rt-probe.mjs can drive the real ns object under node.
//
//   node tools/staging/ramoverride/rt-build.mjs
//
// tools/test/build-ram.mjs deliberately exports only Script/RamCalculations and
// the cost tree, because dragging the React UI in costs 15,623 modules against
// 53. This one pays that price on purpose: the question it answers — does a
// mid-script ns.ramOverride(higher) actually let the next gated call through —
// cannot be answered by a calculator, only by NetscriptFunctions.ts and
// APIWrapper.ts running for real. ~11MB of bundle, regenerated on demand and
// not kept.
//
// Same esbuild recipe as tools/sim/build.mjs, different entry, different
// outfile, so no shared artifact is clobbered.
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
const GAME = "/home/tbusby/Repos/bitburner";
const ENTRY = `
export { helpers } from "${GAME}/src/Netscript/NetscriptHelpers";
export { WorkerScript } from "${GAME}/src/Netscript/WorkerScript";
export { NetscriptFunctions } from "${GAME}/src/NetscriptFunctions";
export { Server } from "${GAME}/src/Server/Server";
export { Player, setPlayer } from "@player";
export { RamCostConstants, getRamCost } from "${GAME}/src/Netscript/RamCostGenerator";
export { AddToAllServers, GetServer } from "${GAME}/src/Server/AllServers";
export { Script } from "${GAME}/src/Script/Script";
export { RunningScript } from "${GAME}/src/Script/RunningScript";
`;
const rawPlugin = {
  name: "raw",
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({ path: path.resolve(args.resolveDir, args.path.replace(/\?raw$/, "")), namespace: "raw" }));
    build.onLoad({ filter: /.*/, namespace: "raw" }, (args) => ({ contents: fs.readFileSync(args.path, "utf8"), loader: "text" }));
  },
};
const stubPlugin = {
  name: "stub",
  setup(build) {
    const filter = /^(monaco-editor|monaco-vim|@monaco-editor|@swc\/wasm-web|@babel\/standalone)/;
    build.onResolve({ filter }, (args) => ({ path: args.path, namespace: "stub" }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "module.exports = new Proxy({}, { get: () => function () {} });", loader: "js" }));
  },
};
const r = await esbuild.build({
  stdin: { contents: ENTRY, resolveDir: GAME, loader: "ts" },
  bundle: true, format: "esm", platform: "node", target: "node20",
  alias: { "@player": GAME + "/src/Player", "@enums": GAME + "/src/Enums", "@nsdefs": GAME + "/src/ScriptEditor/NetscriptDefinitions" },
  outfile: "/home/tbusby/Repos/bitburner-scripts/tools/staging/ramoverride/rt.bundle.mjs",
  loader: { ".js": "jsx", ".ts": "ts", ".tsx": "tsx", ".png": "dataurl", ".jpg": "dataurl", ".svg": "text", ".css": "text", ".wav": "dataurl", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".mp3": "dataurl" },
  jsx: "automatic",
  plugins: [rawPlugin, stubPlugin],
  metafile: true,
  logLevel: "warning",
  define: { "process.env.NODE_ENV": '"production"' },
  banner: { js: 'import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);' },
});
console.log("modules:", Object.keys(r.metafile.inputs).length);
