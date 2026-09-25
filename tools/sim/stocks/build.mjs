// Bundles the game's OWN stock-market code for the offline harness, beside the
// shared tools/sim/build.mjs (which is deliberately not touched: other agents
// own it, and this surface is only the stock market's).
//
//   node tools/sim/stocks/build.mjs [--game <bitburner-src checkout>]
//
// What is exported is exactly what the market does between two reads of a
// trading script: processStockPrices (the tick, the 75-tick cycle flips and
// the otlkMag drift), the four transaction functions with their spread,
// commission and forecast degradation, and the two hack()/grow() influence
// hooks. Nothing here is a port — the harness calls these functions.

import esbuild from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The game source. The shared build resolves `../../../bitburner` from
 * tools/sim, i.e. a sibling of the repo — which is wrong inside a git worktree
 * (.claude/worktrees/<name>/), so this tries that, then ~/Repos/bitburner, and
 * says which one it used. A missing source THROWS: a harness that silently ran
 * without the real market would be the strawman-opponent failure again.
 */
export function resolveGame() {
  const argGame = process.argv.indexOf("--game");
  const cands = [
    argGame > -1 ? process.argv[argGame + 1] : null,
    process.env.BITBURNER_SRC,
    path.join(HERE, "../../../../bitburner"),
    path.join(os.homedir(), "Repos/bitburner"),
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(path.join(c, "src/StockMarket/StockMarket.ts"))) return path.resolve(c);
  throw new Error(`no bitburner source with src/StockMarket found; tried ${cands.join(", ")} — pass --game or BITBURNER_SRC`);
}

export const GAME = resolveGame();
export const OUT = path.join(HERE, "stocks.bundle.mjs");

const ENTRY = `
export { StockMarket, SymbolToStockMap, initStockMarket, processStockPrices, deleteStockMarket } from "${GAME}/src/StockMarket/StockMarket";
export { Stock, StockForecastInfluenceLimit } from "${GAME}/src/StockMarket/Stock";
export { buyStock, sellStock, shortStock, sellShort } from "${GAME}/src/StockMarket/BuyingAndSelling";
export { getBuyTransactionCost, getSellTransactionGain, processTransactionForecastMovement, forecastChangePerPriceMovement } from "${GAME}/src/StockMarket/StockMarketHelpers";
export { influenceStockThroughServerHack, influenceStockThroughServerGrow, forecastForecastChangeFromHack } from "${GAME}/src/StockMarket/PlayerInfluencing";
export { StockMarketConstants } from "${GAME}/src/StockMarket/data/Constants";
export { InitStockMetadata } from "${GAME}/src/StockMarket/data/InitStockMetadata";
export { getStockMarket4SDataCost, getStockMarket4STixApiCost } from "${GAME}/src/StockMarket/StockMarketCosts";
export { StockSymbol } from "${GAME}/src/StockMarket/Enums";
export { serverMetadata } from "${GAME}/src/Server/data/servers";
export { CONSTANTS } from "${GAME}/src/Constants";
export { getBitNodeMultipliers } from "${GAME}/src/BitNode/BitNode";
export { currentNodeMults, replaceCurrentNodeMults } from "${GAME}/src/BitNode/BitNodeMultipliers";
export { Player, setPlayer } from "@player";
`;

const rawPlugin = {
  name: "raw",
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({ path: path.resolve(args.resolveDir, args.path.replace(/\?raw$/, "")), namespace: "raw" }));
    build.onLoad({ filter: /.*/, namespace: "raw" }, (args) => ({ contents: fs.readFileSync(args.path, "utf8"), loader: "text" }));
  },
};
const stubPlugin = {
  name: "stub-browser-only",
  setup(build) {
    const filter = /^(monaco-editor|monaco-vim|@monaco-editor|@swc\/wasm-web|@babel\/standalone)/;
    build.onResolve({ filter }, (args) => ({ path: args.path, namespace: "stub" }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "module.exports = new Proxy({}, { get: () => function () {} });", loader: "js" }));
  },
};

export async function build({ quiet = false } = {}) {
  const entryFile = path.join(HERE, ".entry.generated.ts");
  fs.writeFileSync(entryFile, ENTRY);
  try {
    await esbuild.build({
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
      loader: { ".png": "dataurl", ".jpg": "dataurl", ".svg": "text", ".css": "text", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".mp3": "dataurl", ".wav": "dataurl" },
      banner: { js: `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);` },
      logLevel: quiet ? "silent" : "error",
    });
    if (!quiet) {
      const version = JSON.parse(fs.readFileSync(path.join(GAME, "package.json"), "utf8")).version;
      console.log(`bundled bitburner v${version} stock market (${GAME}) -> ${path.relative(process.cwd(), OUT)}`);
    }
  } finally {
    fs.rmSync(entryFile, { force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await build();
