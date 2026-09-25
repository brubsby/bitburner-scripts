// Side-effect module: a browser environment for the stock bundle, then the
// bundle rebuilt if the game source moved. Modelled on tools/sim/env.mjs (read
// its header for the two load-order traps, both handled the same way here:
// the captured `G`, and staying synchronous). It is a separate copy only so
// that loading the stock harness does not rebuild the whole-game bundle.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { GAME, OUT } from "./build.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
const w = dom.window;
const G = globalThis;
for (const key of Object.getOwnPropertyNames(w)) {
  if (key === "globalThis" || key in G) continue;
  try {
    Object.defineProperty(G, key, Object.getOwnPropertyDescriptor(w, key));
  } catch {
    /* non-configurable */
  }
}
for (const key of ["window", "self", "navigator", "location"]) {
  try {
    Object.defineProperty(G, key, { value: key === "window" || key === "self" ? w : w[key], configurable: true, writable: true });
  } catch {
    /* already equivalent */
  }
}
if (!G.CSSStyleSheet) {
  G.CSSStyleSheet = class CSSStyleSheet {
    cssRules = [];
    replaceSync() {}
    replace() {
      return Promise.resolve(this);
    }
    insertRule() {
      return 0;
    }
  };
}
if (!G.document.adoptedStyleSheets) G.document.adoptedStyleSheets = [];

const SRC = ["StockMarket/StockMarket.ts", "StockMarket/Stock.ts", "StockMarket/StockMarketHelpers.ts", "StockMarket/BuyingAndSelling.tsx", "StockMarket/PlayerInfluencing.ts", "StockMarket/data/InitStockMetadata.ts"];
const newest = Math.max(...SRC.map((f) => fs.statSync(path.join(GAME, "src", f)).mtimeMs));
const stale = !fs.existsSync(OUT) || newest > fs.statSync(OUT).mtimeMs;
if (stale) execFileSync(process.execPath, [path.join(HERE, "build.mjs"), "--game", GAME], { stdio: "inherit" });

export const jsdom = dom;
