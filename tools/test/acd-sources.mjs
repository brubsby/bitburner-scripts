// File enumeration and text-scanning helpers for the section A / C / D checks.
//
// Namespaced `acd-` because `tools/test/` is shared with the RAM suite, which
// has its own `trackedFiles()` in ram.mjs written for a different question
// (what the daemon deploys). This one answers "what does this repo *claim*",
// which includes prose — CLAUDE.md and docs/ are where two of the three
// three-factor-donation bugs actually lived.
//
// Nothing here reads the game or the daemon. It is all filesystem and regex.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "../..");

/** Never walked at all: generated, vendored, or not text we wrote. */
const NEVER = new Set(["node_modules", ".git", ".telemetry", ".idea", "backups"]);

/**
 * Walked but never *failed* on. These are deliberately preserved copies, not
 * live code: `variants/` is the no-Source-File script set kept verbatim
 * (docs/autonomy.md:9), `archive/` and `min/` are history. A finding in one is
 * real and gets reported — as a WARN, with the path — but it must not turn the
 * suite permanently red for a file nobody is allowed to edit.
 */
export const FROZEN = ["variants/", "archive/", "min/"];

/** Files that are bundles or dumps rather than something a human wrote. */
const GENERATED = new Set(["NetscriptDefinitions.d.ts", "game.bundle.mjs", "ram.bundle.mjs", "package-lock.json"]);

const TEXT_EXT = /\.(js|mjs|jsx|ts|tsx|md|txt|json)$/;

export function isFrozen(rel) {
  return FROZEN.some((f) => rel.startsWith(f));
}

/** Every text file in the repo, as repo-relative paths. */
export function allFiles(dir = REPO, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (NEVER.has(entry.name) || entry.name.startsWith(".")) continue;
      out.push(...allFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`));
    } else if (GENERATED.has(entry.name)) continue;
    else if (TEXT_EXT.test(entry.name)) out.push(`${prefix}${entry.name}`);
  }
  return out;
}

/** Root-level `.js` — the set that hot-deploys into the live game. */
export function rootScripts() {
  return allFiles()
    .filter((f) => f.endsWith(".js") && !f.includes("/"))
    .sort();
}

export const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
export const lines = (rel) => read(rel).split("\n");

/**
 * Every line in the repo matching `re`, with a window of context.
 *
 * Returns {file, line, text, window} where `window` is the matched line plus
 * `pad` lines either side joined by \n — the formulas in this repo wrap across
 * lines in both prose and code (CLAUDE.md:436-437 is the donation formula split
 * over two), so a same-line-only check reports drift that is not there.
 */
export function grepRepo(re, { pad = 2, files = null, includeTests = false } = {}) {
  const out = [];
  for (const rel of files ?? allFiles()) {
    // The suite talks about the formulas it checks, so without this every
    // check fails on its own explanatory comment. The cost is that a wrong
    // formula written inside tools/test/ is not caught by tools/test/.
    if (!includeTests && rel.startsWith("tools/test/")) continue;
    let src;
    try {
      src = lines(rel);
    } catch {
      continue;
    }
    for (let i = 0; i < src.length; i++) {
      if (!re.test(src[i])) continue;
      re.lastIndex = 0;
      out.push({
        file: rel,
        line: i + 1,
        text: src[i].trim(),
        window: src.slice(Math.max(0, i - pad), i + pad + 1).join("\n"),
        frozen: isFrozen(rel),
      });
    }
  }
  return out;
}

/* ------------------------------------------------------- the game's source */

export const GAME = path.resolve(REPO, "../bitburner");

export function gameSource(rel) {
  return fs.readFileSync(path.join(GAME, rel), "utf8");
}

/**
 * Pull out a top-level function body from a game .ts file, with the line it
 * starts on, so a textual assertion can cite it.
 *
 * This is the weak form of check and is labelled as such wherever it is used:
 * it asserts on the *text* of an expression rather than its value, so it
 * survives a rename and misses a change made somewhere else. Used only where
 * the thing being checked cannot be imported and called — a React component, a
 * branch inside a prestige routine that needs a whole live Player.
 */
export function gameFunction(rel, name) {
  const src = gameSource(rel).split("\n");
  const start = src.findIndex((l) => new RegExp(`(function|const|export function)\\s+${name}\\b`).test(l));
  if (start < 0) return null;
  let depth = 0;
  let seen = false;
  const body = [];
  for (let i = start; i < src.length; i++) {
    body.push(src[i]);
    for (const ch of src[i]) {
      if (ch === "{") {
        depth++;
        seen = true;
      } else if (ch === "}") depth--;
    }
    if (seen && depth === 0) break;
  }
  return { file: rel, line: start + 1, text: body.join("\n") };
}

/**
 * Collapse hits that are the same sentence wrapped across lines.
 *
 * A formula written in prose spans two or three lines and matches on each of
 * them, which turns one piece of drift into three identical failures and makes
 * the output look worse than the repo is.
 */
export function dedupeAdjacent(hits, within = 3) {
  const out = [];
  for (const h of hits) {
    const prev = out[out.length - 1];
    if (prev && prev.file === h.file && h.line - prev.line <= within) continue;
    out.push(h);
  }
  return out;
}

/** `rel:line` the way every citation in this repo is written. */
export const cite = (rel, line) => `${rel}:${line}`;

export const rel = (a, b) => (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-12));
