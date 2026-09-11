// Side-effect module: stands up a browser environment and makes sure the game
// bundle is current. Must be imported *before* game.bundle.mjs — ES module
// imports are evaluated in order, which is the only reason this is a separate
// file rather than code at the top of game.mjs.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { GAME, OUT } from "./build.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});
const w = dom.window;
// Capture the real global up front. jsdom's window exposes its own
// `globalThis` property, and copying that across rebinds the identifier for
// the rest of this module — every shim would then land on the jsdom window
// instead of node's global, where the game bundle looks for it.
const G = globalThis;

for (const key of Object.getOwnPropertyNames(w)) {
  if (key === "globalThis" || key in G) continue;
  try {
    Object.defineProperty(G, key, Object.getOwnPropertyDescriptor(w, key));
  } catch {
    /* non-configurable globals are replaced explicitly below */
  }
}
for (const key of ["window", "self", "navigator", "location"]) {
  try {
    Object.defineProperty(G, key, {
      value: key === "window" || key === "self" ? w : w[key],
      configurable: true,
      writable: true,
    });
  } catch {
    /* already equivalent */
  }
}

// jsdom implements neither constructable stylesheets nor adoptedStyleSheets,
// and the game's theme setup uses both at module-init time.
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

// Rebuild when the bundle is missing or the game source has moved on. This
// runs as a synchronous subprocess on purpose: a top-level await here would
// make this module async, and ES modules do not guarantee that an async
// sibling finishes before its siblings evaluate — the game bundle would start
// running before the environment above exists.
const stale =
  !fs.existsSync(OUT) || fs.statSync(path.join(GAME, "src/Hacking.ts")).mtimeMs > fs.statSync(OUT).mtimeMs;
if (stale) execFileSync(process.execPath, [path.join(HERE, "build.mjs")], { stdio: "inherit" });

export const jsdom = dom;
