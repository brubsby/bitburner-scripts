// DOM shim for the bn9 bundle — the same approach as tools/sim/env.mjs, kept
// separate so importing this never rebuilds the shared bundle. It must stay
// SYNCHRONOUS (rebuild via execFileSync): an async sibling module is not
// guaranteed to finish before the bundle evaluates (CLAUDE.md, the
// load-order traps).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
const w = dom.window;
const G = globalThis;
for (const key of Object.getOwnPropertyNames(w)) {
  if (key === "globalThis" || key in G) continue;
  try {
    Object.defineProperty(G, key, Object.getOwnPropertyDescriptor(w, key));
  } catch {
    /* non-configurable; replaced below where it matters */
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

// Rebuild when missing or older than the game source it bundles.
const OUT = path.join(HERE, "game.bundle.mjs");
const SRC = path.resolve(HERE, "../../../../bitburner/src/Hacknet/formulas/HacknetServers.ts");
const stale = !fs.existsSync(OUT) || (fs.existsSync(SRC) && fs.statSync(SRC).mtimeMs > fs.statSync(OUT).mtimeMs);
if (stale) execFileSync(process.execPath, [path.join(HERE, "build.mjs")], { stdio: "inherit" });
