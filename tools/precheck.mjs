// Check a candidate root script BEFORE it is saved into the repo.
//
//   node tools/precheck.mjs <candidate path> <root name, e.g. progress.js>
//
// Why this exists: the daemon pushes every root .js into the running game
// within ~150ms of the save (CLAUDE.md, "Hot reload"), so a file is live the
// moment it is written — there is no deploy step to gate. On 2026-09-24 three
// edits went live broken inside one session: a syntax error in progress.js
// and, twice, a local identifier named like an ns function (`share`, `run`)
// that the RAM calculator billed, pushing progress.js past its ramOverride
// ceiling. Each was caught by the suite, minutes after it was already running.
//
// So stage the edit in a scratch file, run this, and only then move it into
// place. It checks:
//   1. syntax (node --check), and
//   2. the static RAM price of the candidate against the file it replaces
//      (tools/test/ram.mjs, the game's own calculator, any ramOverride
//      stripped) — a rise is refused unless --allow-ram-rise is given, because
//      an unintended rise is exactly the silent failure above.
// Exit 0 ok, 1 refused, 2 could not check.

import { execFileSync } from "node:child_process";
import fs from "node:fs";

const [cand, name] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const allowRise = process.argv.includes("--allow-ram-rise");
if (!cand || !name) {
  console.error("usage: node tools/precheck.mjs <candidate> <root name> [--allow-ram-rise]");
  process.exit(2);
}
// As .mjs: a .js outside a package with "type": "module" is parsed with
// module detection, and `node --check` then passed a file ending in
// `function (` — checked 2026-09-24. Forcing ESM makes the check real.
const asModule = `${cand}.precheck.mjs`;
fs.copyFileSync(cand, asModule);
try {
  execFileSync(process.execPath, ["--check", asModule], { stdio: "pipe" });
  fs.unlinkSync(asModule);
} catch (e) {
  try { fs.unlinkSync(asModule); } catch {}
  console.error(`precheck: SYNTAX ERROR in ${cand}\n${String(e.stderr || e).slice(0, 800)}`);
  process.exit(1);
}
let m;
try {
  m = await import("./test/ram.mjs");
  await m.load();
} catch (e) {
  console.error(`precheck: could not load the RAM calculator: ${e}`);
  process.exit(2);
}
const strip = (code) => code.replace(/ns\.ramOverride\([^)]*\)/, "0");
const price = (code) => m.priceCode(strip(code), name)?.cost;
const now = fs.existsSync(`${m.REPO}/${name}`) ? price(fs.readFileSync(`${m.REPO}/${name}`, "utf8")) : null;
const next = price(fs.readFileSync(cand, "utf8"));
if (typeof next !== "number") {
  console.error(`precheck: the candidate does not price (${JSON.stringify(next)}) — refusing`);
  process.exit(1);
}
const line = `precheck: ${name} static RAM ${now ?? "new"} -> ${next} GB`;
if (typeof now === "number" && next > now + 1e-9 && !allowRise) {
  console.error(`${line} — REFUSED: unintended rise? (--allow-ram-rise if deliberate)`);
  process.exit(1);
}
console.log(`${line} — ok`);
