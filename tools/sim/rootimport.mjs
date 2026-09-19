// Import a repo-root Netscript file from node.
//
//   const batch = await importRootScript("batch.js");
//
// Netscript resolves a bare specifier like `from 'status.js'` against the
// server's file list; node resolves it against node_modules and throws
// ERR_MODULE_NOT_FOUND. So the moment a root script gains its first import,
// every offline tool that did `await import("../../batch.js")` dies **at module
// load** — before any check runs, with a stack trace that looks like a missing
// dependency rather than a dead calibration.
//
// That has now happened three times from a single change (batch.js gaining
// `status.js`): `placement.test.mjs` silently stopped running invariant B5 for
// two hours, and `verify-batch.mjs` and `verify-alloc-shipped.mjs` — the two
// tools whose whole job is checking the batcher's formulas against game source —
// were dead with nobody noticing. A tool that cannot start reports nothing, and
// nothing is indistinguishable from passing.
//
// Rewriting only the specifier text keeps the measured code byte-identical to
// the shipped file, which is the entire point of importing the real thing.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function importRootScript(name) {
  const src = fs
    .readFileSync(path.join(REPO, name), "utf8")
    .replace(/(^\s*import[^'"]*['"])([^'"]+)(['"])/gm, (all, head, spec, tail) => {
      const target = path.join(REPO, spec.replace(/^\.?\//, ""));
      return fs.existsSync(target) ? head + pathToFileURL(target).href + tail : all;
    });
  return import(`data:text/javascript;base64,${Buffer.from(src).toString("base64")}`);
}
