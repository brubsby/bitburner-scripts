// Bundles the game's OWN RAM calculator so the test suite prices scripts with
// `Script/RamCalculations.ts` rather than a hand-port of it.
//
//   node tools/test/build-ram.mjs [--game ../../bitburner]
//
// Why not reuse tools/sim/build.mjs: that bundle is owned by the simulator and
// its ENTRY is a formulas surface. This one drags in the whole Netscript RAM
// cost tree plus acorn, which the simulator has no use for, and rebuilding a
// shared artifact under another agent is how work gets clobbered (CLAUDE.md,
// "Agent roles"). Same esbuild recipe, different entry, different outfile.
//
// The two traps from tools/sim/env.mjs apply here too and are handled the same
// way: this module stays synchronous at import time and the consumer pulls the
// bundle in with a dynamic import.

import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argGame = process.argv.indexOf("--game");
export const GAME = path.resolve(argGame > -1 ? process.argv[argGame + 1] : path.join(HERE, "../../../bitburner"));
export const OUT = path.join(HERE, "ram.bundle.mjs");

const ENTRY = `
// The real thing. Walks the AST with acorn the way the game does, prices every
// bare identifier by name through findFunc, and follows imports.
export { calculateRamUsage } from "${GAME}/src/Script/RamCalculations";
export { RamCalculationErrorCode } from "${GAME}/src/Script/RamCalculationErrorCodes";
export { RamCosts, RamCostConstants } from "${GAME}/src/Netscript/RamCostGenerator";
// Singularity RAM is a FUNCTION of bitNodeN and SF4 level (RamCostGenerator.ts:82-96),
// so pricing a script is not BitNode-independent. Exporting Player lets the
// suite ask "what would this cost on a save with SF4.1 / inside BN4 / neither".
// setPlayer, not Player: the bundle never runs the game's init, so the Player
// singleton is undefined and SF4Cost() would throw the moment a singularity
// identifier is priced. RamCostGenerator.ts touches exactly two Player members
// (grep: lines 84 and 87 — bitNodeN and activeSourceFileLvl), so a two-field
// stub is a complete substitute rather than an approximation.
export { setPlayer } from "${GAME}/src/Player";
export { getBitNodeMultipliers } from "${GAME}/src/BitNode/BitNode";
export { ServerConstants } from "${GAME}/src/Server/data/Constants";
export { CONSTANTS } from "${GAME}/src/Constants";
// Real per-server growth/money/security, so a placement test runs against the
// game's own servers instead of invented ones. A 5-target synthetic server list
// once produced a completely fictional validation result in this repo.
export { serverMetadata } from "${GAME}/src/Server/data/servers";
// The same acorn the game parses with, so a check that needs to know which
// identifiers are LOCAL declarations sees exactly the AST RamCalculations saw.
export * as acorn from "${GAME}/node_modules/acorn/dist/acorn.mjs";
// NOT exported: canAccessBitNodeFeature. It reaches GetServer -> AllServers and
// pulls the React UI in with it (15,643 modules vs 53, and a DOM needed at
// module init — the trap tools/sim/env.mjs exists to handle). Its rule is three
// lines and is checked against its source text in sfgate.test.mjs instead.
// NOT exported: checkCheatApiAccess. Importing netscriptGoImplementation drags
// the entire React UI into the bundle (15,643 modules, and it needs a DOM at
// module-init). The go.cheat rule is verified against its source text instead —
// see sfgate.test.mjs, which asserts both clauses are still present at the
// cited lines rather than trusting a second reading of them.
`;

const rawPlugin = {
  name: "raw",
  setup(build) {
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
  if (!fs.existsSync(path.join(GAME, "src/Script/RamCalculations.ts"))) {
    throw new Error(`no bitburner source at ${GAME} — pass --game <path to bitburner-src checkout>`);
  }
  const entryFile = path.join(HERE, ".entry.ram.generated.ts");
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
      banner: { js: `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);` },
      logLevel: quiet ? "silent" : "error",
      metafile: true,
    });
    if (!quiet) {
      const version = JSON.parse(fs.readFileSync(path.join(GAME, "package.json"), "utf8")).version;
      console.log(
        `bundled bitburner v${version} RAM calculator — ${Object.keys(result.metafile.inputs).length} modules -> ${path.relative(process.cwd(), OUT)}`,
      );
    }
    return { out: OUT };
  } finally {
    fs.rmSync(entryFile, { force: true });
  }
}

/** Rebuild only if the bundle is missing or older than the game's src/. */
export function isStale() {
  if (!fs.existsSync(OUT)) return true;
  const bundleMtime = fs.statSync(OUT).mtimeMs;
  let newest = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
        const m = fs.statSync(p).mtimeMs;
        if (m > newest) newest = m;
      }
    }
  };
  walk(path.join(GAME, "src"));
  return newest > bundleMtime;
}

if (import.meta.url === `file://${process.argv[1]}`) await build();
