// [TL] THE CHECKS THAT WATCH THE RUN MUST THEMSELVES RUN.
//
// 2026-09-27: three static `import ... from "../<game module>.js"` lines in
// tools/healthcheck.mjs were linked before its gameresolve.mjs import could
// register the bare-name resolver, so the healthcheck crashed at startup
// ("Cannot find package 'sfgate.js'") and the scheduled watcher could only say
// "HEALTHCHECK DID NOT ANSWER". A watcher that cannot run is the silent
// failure it exists to catch.
//
//   TL1  no tool that the operator runs statically imports a root game module
//        (they must use `await import()` after gameresolve.mjs);
//   TL2  every root module the healthcheck imports resolves and loads under
//        the game resolver (the failure mode above, checked without running
//        the healthcheck, which writes its live sample).

import fs from "node:fs";
import path from "node:path";
import "./gameresolve.mjs";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const TOOLS = ["tools/healthcheck.mjs"];

export async function run() {
  const c1 = new Check("TL1", "operator tools import root game modules only dynamically, after the resolver");
  for (const rel of TOOLS) {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
    c1.examined(1);
    for (const m of src.matchAll(/^\s*import\s+[^;]*?from\s+["']\.\.\/([A-Za-z0-9_-]+\.js)["']/gm)) c1.fail(`${rel} statically imports ../${m[1]}`, "link-time imports run before gameresolve.mjs registers the bare-name resolver — use `await import()` after it");
  }
  const c2 = new Check("TL2", "every root module the healthcheck imports resolves and loads (no startup crash)");
  for (const rel of TOOLS) {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
    for (const m of src.matchAll(/import\(["']\.\.\/([A-Za-z0-9_-]+\.js)["']\)/g)) {
      c2.examined(1);
      try {
        await import(path.join(REPO_ROOT, m[1]));
      } catch (e) {
        c2.fail(`${rel} cannot load ../${m[1]}`, String(e?.message ?? e).slice(0, 200));
      }
    }
  }
  if (!c2.counted) c2.fail("found no dynamic imports to check — the scan did not look");
  return [c1, c2];
}
