// Run a mutation test WITHOUT deploying the mutant.
//
//   node tools/mutant.mjs <file.js> <from> <to> <test-module> [<test-module>...]
//
// Saving a root .js is deploying it (the daemon pushes within ~150ms), so the
// usual "mutate, run the suite, restore" put every mutant into the running
// game for the seconds in between — an inverted install rule, a gate that
// ignored its exit comparison — on 2026-09-24, dozens of times. This copies
// the repo into a scratch directory outside the daemon's watch, applies the
// mutation to the COPY, runs the named test modules there, and reports.
//
// `from` must occur exactly once in the file (the same discipline as the
// Edit tool): a mutation that silently matches nothing is a mutant that was
// never tested. Exit 0 = the mutant was CAUGHT (some check failed), 1 = it
// SURVIVED (every check passed), 2 = could not run.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [file, from, to, ...modules] = process.argv.slice(2);
if (!file || from === undefined || to === undefined || !modules.length) {
  console.error("usage: node tools/mutant.mjs <file.js> <from> <to> <test-module>...");
  process.exit(2);
}
const src = fs.readFileSync(path.join(REPO, file), "utf8");
const n = src.split(from).length - 1;
if (n !== 1) {
  console.error(`mutant: '${from.slice(0, 60)}' occurs ${n} times in ${file} — must be exactly once`);
  process.exit(2);
}
// The tests find the game as the repo's sibling (../bitburner) and some
// resolve back to ../bitburner-scripts from there, so the sandbox reproduces
// the PAIR: <root>/bitburner-scripts (the copy) beside <root>/bitburner (a
// link to the real game source).
const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "mutant-"));
const dir = path.join(root, path.basename(REPO));
fs.mkdirSync(dir);
const GAME_REAL = path.resolve(REPO, "../bitburner");
if (fs.existsSync(GAME_REAL)) fs.symlinkSync(GAME_REAL, path.join(root, "bitburner"));
try {
  // Everything but the heavy/irrelevant trees; node_modules is linked.
  for (const e of fs.readdirSync(REPO)) {
    if ([".git", "node_modules", ".telemetry", "backups"].includes(e)) continue
    fs.cpSync(path.join(REPO, e), path.join(dir, e), { recursive: true });
  }
  if (fs.existsSync(path.join(REPO, "node_modules"))) fs.symlinkSync(path.join(REPO, "node_modules"), path.join(dir, "node_modules"));
  fs.writeFileSync(path.join(dir, file), src.replace(from, to));
  let out = "";
  try {
    out = execFileSync(process.execPath, [path.join(dir, "tools/test/run.mjs"), ...modules], { cwd: dir, encoding: "utf8", stdio: "pipe", timeout: 600000 });
  } catch (e) {
    out = String(e.stdout || "") + String(e.stderr || "");
  }
  // A module that THREW did not test anything: that is "could not run", never
  // "caught" — a sandbox that breaks the suite would otherwise report every
  // mutant as caught.
  if (/module\(s\) threw/.test(out)) {
    console.log(`COULD NOT RUN — a test module threw in the sandbox:\n${out.split("\n").filter((l) => /threw|Error/.test(l)).slice(0, 4).join("\n")}`);
    process.exit(2);
  }
  const fails = out.split("\n").filter((l) => /^\s+FAIL /.test(l));
  if (fails.length) {
    console.log(`CAUGHT (${fails.length}):\n${fails.slice(0, 4).join("\n")}`);
    process.exit(0);
  }
  console.log(`SURVIVED — no check failed:\n${out.split("\n").slice(-2).join("\n")}`);
  process.exit(1);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
