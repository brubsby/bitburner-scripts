// Bundle the game's OWN coding-contract table into a module node can import.
//
//   node tools/staging/contracts/build-contracts.mjs [--game ../bitburner]
//
// Why this exists rather than reusing tools/sim/build.mjs: the simulator bundle
// drags in React, MUI and the theme, so it only initialises under jsdom
// (tools/sim/env.mjs). `CodingContractTypes` needs none of that — it is pure
// data and pure functions — and the one browser-only import in its graph
// (`exceptionAlert`, reached from two contracts' unreachable null branches) is
// stubbed here. The result loads under plain `node` in a few milliseconds.
//
// The point of bundling at all: `CodingContractTypes[name].generate()` and
// `.solver(state, answer)` are the *real* generator and the *real* validator.
// A solver tested against them is tested against the acceptance criterion the
// live game will apply, not against what we believe the problem statement says.
// See CLAUDE.md, "Fidelity: model the real game".

import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argGame = process.argv.indexOf("--game");
export const GAME = path.resolve(argGame > -1 ? process.argv[argGame + 1] : path.join(HERE, "../../../../bitburner"));
export const OUT = path.join(HERE, "contracts.bundle.mjs");

const ENTRY = `
export { CodingContractTypes } from "${GAME}/src/CodingContract/ContractTypes";
export { CodingContractName } from "${GAME}/src/CodingContract/Enums";
export { CodingContract } from "${GAME}/src/CodingContract/Contract";
`;

// exceptionAlert is a .tsx that imports React, MUI and the live Player. It is
// only called from branches the game itself describes as impossible ("Unexpected
// null when calculating the answer"). Stub it, but make the stub THROW rather
// than no-op: if a contract ever actually reaches it, that is a finding, and a
// silent stub would turn it into a `false` the test would report as "solver
// wrong" while pointing at nothing.
const stubExceptionAlert = {
  name: "stub-exception-alert",
  setup(build) {
    build.onResolve({ filter: /utils\/helpers\/exceptionAlert$/ }, (args) => ({
      path: args.path,
      namespace: "stub-ea",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub-ea" }, () => ({
      contents:
        "export function exceptionAlert(e) { throw e instanceof Error ? e : new Error(String(e)); }\n" +
        "export function writeCrashReportToHome() {}\n",
      loader: "js",
    }));
  },
};

export async function build({ quiet = false } = {}) {
  if (!fs.existsSync(path.join(GAME, "src/CodingContract/ContractTypes.ts"))) {
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
      target: "node20",
      outfile: OUT,
      alias: {
        "@enums": path.join(GAME, "src/Enums"),
        "@nsdefs": path.join(GAME, "src/ScriptEditor/NetscriptDefinitions"),
        "@player": path.join(GAME, "src/Player"),
      },
      plugins: [stubExceptionAlert],
      logLevel: quiet ? "silent" : "error",
      metafile: true,
    });
    const modules = Object.keys(result.metafile.inputs).length;
    if (!quiet) {
      const version = JSON.parse(fs.readFileSync(path.join(GAME, "package.json"), "utf8")).version;
      console.log(`bundled bitburner v${version} coding contracts — ${modules} modules -> ${OUT}`);
    }
    return { modules, out: OUT };
  } finally {
    fs.rmSync(entryFile, { force: true });
  }
}

/** Rebuild when the bundle is missing or any game contract source is newer. */
export async function buildIfStale({ quiet = true } = {}) {
  const dir = path.join(GAME, "src/CodingContract");
  let newest = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else newest = Math.max(newest, fs.statSync(p).mtimeMs);
    }
  };
  if (!fs.existsSync(dir)) throw new Error(`no bitburner coding-contract source at ${dir}`);
  walk(dir);
  const have = fs.existsSync(OUT) ? fs.statSync(OUT).mtimeMs : 0;
  if (have > newest) return { rebuilt: false, out: OUT };
  await build({ quiet });
  return { rebuilt: true, out: OUT };
}

if (import.meta.url === `file://${process.argv[1]}`) await build();
