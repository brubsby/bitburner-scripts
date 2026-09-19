// Compile tools/compile/src/*.js for one capability profile, price every output
// with the game's own RAM calculator, and REFUSE TO WRITE if anything got more
// expensive than the handwritten script it replaces.
//
//   node tools/compile/build.mjs                     # for the live save
//   node tools/compile/build.mjs --bitnode 1         # BN1, no Source-Files
//   node tools/compile/build.mjs --bitnode 1 --sf 4:1
//   node tools/compile/build.mjs --bitnode 14 --sf 14:1
//   node tools/compile/build.mjs --dry-run           # price, print, write nothing
//
// Nothing here touches the repo root or the running game. Output goes to
// tools/compile/dist/, which the daemon does not walk (SKIP_DIRS contains
// "tools"), so a broken build cannot hot-deploy.
//
// ===========================================================================
// MODULE SUBSTITUTION, NOT BRANCH ELIMINATION
//
// The capability difference between "this save can call ns.singularity.*" and
// "it cannot" is not an `if`. It is a different implementation of the same
// small interface — which module gets linked, decided once, at build time, from
// a profile read out of the live save:
//
//   caps/buy.js      ->  src/caps/buy-sing.js     |  src/caps/buy-terminal.js
//   caps/go-cheat.js ->  src/caps/go-cheat-on.js  |  src/caps/go-cheat-off.js
//
// So the build is plain `--bundle` with tree-shaking and NO minify flags of any
// kind. That matters for three reasons, in increasing order of importance:
//
//   1. The output keeps real newlines, one statement per line, and the original
//      identifiers. A Bitburner stack trace names a line in the DEPLOYED file
//      and the game does not consume sourcemaps, so the deployed file being
//      legible is the entire debugging story.
//      It does NOT keep the comments — esbuild drops all but a few incidental
//      ones, measured at 201 -> 12 lines for go.js and 144 -> 12 for autobuy.js,
//      including every file:line citation into the game source. That is a real
//      cost of this approach and it is not fixable by a flag. See
//      NOTES-compile.md §3.
//
//   2. --minify-syntax would leave `if (false)` corpses folded into comma
//      sequences and collapse the statement-per-line structure that makes a
//      line number mean anything.
//
//   3. --minify-identifiers is actively dangerous. The RAM checker prices every
//      bare Identifier BY NAME, on any object, walking the whole RamCosts tree
//      (Script/RamCalculations.ts:407, findFunc :225-243). Measured on esbuild
//      0.28.2: a module with enough locals to exhaust the single-character name
//      pool emits `cat` (8GB), `ls` (0.2GB), `ps` (0.2GB) and `rm` (0.6GB) as
//      variable names. Minification can therefore SILENTLY INCREASE the RAM of
//      the script it minified. This repo has been bitten by that class five
//      times with hand-written names; a renamer does it systematically.
//
// ===========================================================================
// WHY THE RAM GATE IS NOT OPTIONAL
//
// Identifier rewriting happens WITHOUT any minify flag. esbuild renames on
// collision when it hoists two modules into one scope — `ns` becomes `ns2`,
// `main` becomes `main2` — and either of those can change the bill:
//
//   - a rename TO a priced name adds its cost;
//   - `main` renamed to `main2` silently disables ns.ramOverride, which the
//     game only honours on a FunctionDeclaration literally named `main`
//     (RamCalculations.ts:484-487).
//
// So the build prices its own output with Script/RamCalculations.ts and fails
// on any regression. A build step that can make things more expensive, and that
// prints "built 5 files" either way, is a new instance of the failure this repo
// keeps having: it kept running, it kept reporting, and it was wrong.

import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { profileFromArgs, describeProfile, REPO } from "./profile.mjs";
import * as ram from "../test/ram.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "src");
const DIST = path.join(HERE, "dist");

/* ----------------------------------------------------------------- aliases */

/**
 * The capability seams. Each is one import specifier with two implementations
 * and one interface; `cap` names the sfgate predicate that chooses.
 *
 * This table IS the capability surface of the prototype. Adding a seam means
 * adding a row, not editing a build script — and the two implementations are
 * ordinary files that can be read side by side, which an `if` scattered through
 * a 300-line script is not.
 */
const SEAMS = [
  { spec: "caps/go-cheat.js", cap: "CAP_GO_CHEAT", on: "caps/go-cheat-on.js", off: "caps/go-cheat-off.js" },
  { spec: "caps/buy.js", cap: "CAP_SINGULARITY", on: "caps/buy-sing.js", off: "caps/buy-terminal.js" },
];

/** The virtual module profilecheck.js reads its own build identity from. */
const PROFILE_MODULE = "caps/build-profile.js";

/**
 * Modules that stay real imports in the output instead of being inlined.
 *
 * golib.js and status.js are shared, deployed modules — bundling a copy into
 * every output would duplicate them for no RAM benefit (an import contributes
 * its ns cost either way) and would defeat the one-source-of-truth half of
 * CLAUDE.md's pure-logic rule.
 *
 * sfgate.js is external for a different reason: profilecheck.js must evaluate
 * those rules at RUNTIME against the live save. It is the one thing in the dist
 * deliberately NOT compiled against the profile — a check compiled from the
 * same assumption it is checking would be worth nothing.
 */
const EXTERNAL = ["golib.js", "status.js", "sfgate.js"];

/* ----------------------------------------------------------------- targets */

/**
 * `baseline` names the HANDWRITTEN script at the repo root that this output
 * replaces. That is the whole contract: an output with no baseline cannot be
 * checked for a regression, and the gate says so rather than passing it.
 *
 * `requires` is the capability whose absence means the file should not exist at
 * all. dist/go-cheat.js in a save that cannot cheat is not a smaller file, it
 * is no file — the one thing a build does that a runtime gate cannot.
 */
const TARGETS = [
  { out: "go.js", entry: "go.js", baseline: "go.js" },
  { out: "go-cheat.js", entry: "go-cheat.js", baseline: "go-cheat.js", requires: "CAP_GO_CHEAT" },
  { out: "autobuy.js", entry: "autobuy.js", baseline: "autobuy.js" },
  { out: "autobuy-sing.js", entry: "autobuy-sing.js", baseline: "autobuy-sing.js", requires: "CAP_SINGULARITY" },
  // No baseline: no handwritten counterpart exists, because this is the check
  // the build step itself makes necessary. Priced and reported, not gated.
  { out: "profilecheck.js", entry: "profilecheck.js", baseline: null },
];

/* ----------------------------------------------------------------- compile */

/** Which files this profile will emit — needed before compiling, for the manifest. */
const emittedFor = (profile) => TARGETS.filter((t) => !t.requires || profile.caps[t.requires]).map((t) => t.out);

/**
 * The resolver. Three jobs, in order, and the order is the point:
 *   1. the capability seams   -> the implementation this profile selected
 *   2. the virtual profile module
 *   3. deployed shared modules -> left as external imports
 *   4. anything else bare      -> resolved against src/ then the repo root,
 *      because Netscript imports are written `from 'golib.js'`, not './'.
 *
 * A seam that resolves to nothing is an ERROR, not a pass-through. esbuild then
 * fails the build by name, loudly, at build time — which is the correct place
 * for "you forgot to provide an implementation".
 */
function resolver(profile) {
  const chosen = new Map(SEAMS.map((s) => [s.spec, path.join(SRC, profile.caps[s.cap] ? s.on : s.off)]));
  return {
    name: "capability-seams",
    setup(b) {
      b.onResolve({ filter: /^caps\// }, (args) => {
        if (args.path === PROFILE_MODULE) return { path: PROFILE_MODULE, namespace: "build-profile" };
        const target = chosen.get(args.path);
        if (!target) return { errors: [{ text: `no capability seam declared for "${args.path}" — add it to SEAMS in tools/compile/build.mjs` }] };
        if (!fs.existsSync(target)) return { errors: [{ text: `seam "${args.path}" selects ${target}, which does not exist` }] };
        return { path: target };
      });

      // The build's own identity, as a module rather than a set of `define`
      // substitutions. Generated, so it cannot go stale relative to the profile
      // that produced the dist beside it.
      b.onLoad({ filter: /.*/, namespace: "build-profile" }, () => ({
        contents:
          `// GENERATED by tools/compile/build.mjs — the identity of this dist.\n` +
          `export const BUILD_STAMP = ${JSON.stringify(profile.stamp)}\n` +
          `export const BUILD_CAPS = ${JSON.stringify(Object.fromEntries(Object.entries(profile.caps).filter(([k]) => k.startsWith("CAP_"))), null, 2)}\n` +
          `export const BUILD_FILES = ${JSON.stringify(emittedFor(profile))}\n`,
        loader: "js",
      }));

      b.onResolve({ filter: /^[^./]/ }, (args) => {
        if (EXTERNAL.includes(args.path)) return { path: args.path, external: true };
        for (const dir of [SRC, REPO]) {
          const p = path.join(dir, args.path);
          if (fs.existsSync(p)) return { path: p };
        }
        return null;
      });
    },
  };
}

/** Compile every target for `profile`, in memory. Returns Map(outName -> code). */
export async function compile(profile) {
  const out = new Map();
  const plugin = resolver(profile);
  for (const t of TARGETS) {
    if (t.requires && !profile.caps[t.requires]) continue; // not emitted at all
    const res = await esbuild.build({
      entryPoints: [path.join(SRC, t.entry)],
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      treeShaking: true,
      // Deliberately absent: minifySyntax, minifyIdentifiers, minifyWhitespace.
      // See this file's header. The defaults are false; they are named here so
      // that turning one on later is a visible edit rather than an omission.
      minify: false,
      // keepNames is deliberately OFF. It preserves Function.prototype.name by
      // wrapping every declaration in `__name(fn, "fn")`, which nothing in
      // Netscript reads and which adds a `/* @__PURE__ */ __name(...)` to every
      // line — noise in the one artifact whose legibility is the argument for
      // this approach over minification.
      keepNames: false,
      legalComments: "inline",
      plugins: [plugin],
      logLevel: "warning",
    });
    if (res.outputFiles.length !== 1) throw new Error(`${t.out}: expected 1 output, got ${res.outputFiles.length}`);
    out.set(t.out, header(profile, t) + res.outputFiles[0].text);
  }
  return out;
}

/** A compiled file must say what it was compiled for — a stack trace will not. */
const header = (profile, t) =>
  `// GENERATED by tools/compile/build.mjs from tools/compile/src/${t.entry}\n` +
  `// profile ${profile.stamp}  home ${profile.homeRam}GB  (${profile.source})\n` +
  `// DO NOT EDIT. Edit the source and rebuild; this file is overwritten.\n`;

/* ------------------------------------------------------------- the RAM gate */

/**
 * Two things the RAM number cannot tell you on its own, both silent.
 *
 * 1. An unresolved capability seam left in the output as a real import. The
 *    game would fail to compile the script at `run` time — loud, but in the
 *    game, after a deploy, rather than here.
 *
 * 2. `main` not emitted as a FunctionDeclaration named exactly `main`. The game
 *    honours ns.ramOverride only in that shape (RamCalculations.ts:484-487) and
 *    esbuild renames on collision with no minify flag involved, so a bundled
 *    module that happens to declare `main` turns the entry into `main2` and any
 *    future ramOverride silently stops applying. Nothing currently in this
 *    prototype uses ramOverride; the check is here because the interaction is
 *    invisible and the cost of noticing it later is a wrong RAM number.
 */
function structuralFaults(code) {
  const stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
  const faults = [];
  if (/from\s*""/.test(stripped) && /caps\//.test(code.match(/import[^\n]*caps\/[^\n]*/)?.[0] ?? ""))
    faults.push("a caps/ import survived into the output — the seam did not resolve");
  if (!/export\s+(async\s+)?function\s+main\b/.test(stripped) && !/\bexport\s*\{[^}]*\bmain\b/.test(stripped))
    faults.push("no exported main() — the game cannot run this");
  if (!/\bfunction\s+main\s*\(/.test(stripped))
    faults.push("main is not a FunctionDeclaration named `main` — ns.ramOverride would be silently ignored (RamCalculations.ts:484-487)");
  return faults;
}

/**
 * Price every output under `profile`'s regime and compare with the handwritten
 * baseline priced under the SAME regime.
 *
 * "Under the same regime" is load-bearing. Script RAM is a FUNCTION of BitNode
 * and SF4 level (invariant B6 — progress.js is 41.45GB in BN4 and 627.95GB at
 * SF4.1), so a gate that priced once would be comparing two different questions
 * and would wave a 16x regression through.
 */
/**
 * The cost of the LAST build for this same profile, from dist/PROFILE.json.
 *
 * WHY THIS EXISTS. The first version of the gate compared only against the
 * handwritten baseline, and a self-test found it blind: injecting a live
 * `ns.singularity.purchaseTor()` reference into the compiled go.js added 2GB and
 * the gate PASSED, because 17.80 + 2.00 is still under the handwritten 20.30.
 * Any regression that stays below the original is invisible to a one-sided
 * check — and since the whole point of the build is to be well below the
 * original, that is most of the space the regression can live in.
 *
 * So the gate is two-sided: never worse than the handwritten script, and never
 * worse than the last build of the same profile. The second is a ratchet, and
 * it is the one that catches a compiler change that quietly gives back what an
 * earlier one won.
 */
function previousCosts(profile, dir) {
  try {
    const prev = JSON.parse(fs.readFileSync(path.join(dir, "PROFILE.json"), "utf8"));
    // Only comparable if it was built for the same regime — costs are a
    // function of BitNode and SF4 level (invariant B6).
    return prev.stamp === profile.stamp ? (prev.costs ?? null) : null;
  } catch {
    return null; // no previous build; the ratchet starts here
  }
}

export async function gate(profile, artifacts, dir = DIST) {
  await ram.load();
  ram.asSave({ bitNode: profile.bitNode, sf: profile.sf });
  const prevCosts = previousCosts(profile, dir);

  const priced = ram.pricedNames();
  const rows = [];
  let failed = 0;

  for (const t of TARGETS) {
    const code = artifacts.get(t.out);
    if (!code) {
      rows.push({ out: t.out, note: `not emitted (needs ${t.requires})`, before: t.baseline ? ram.ramOf(t.baseline).cost : null, after: null });
      continue;
    }
    // Priced as if deployed at the root under its own name, so its external
    // imports resolve against the real deployed modules.
    const after = ram.priceOverlay({ [t.out]: code }, t.out);
    if (after.error) {
      rows.push({ out: t.out, before: null, after: null, error: after.error });
      failed++;
      continue;
    }
    const before = t.baseline ? ram.ramOf(t.baseline) : null;
    if (before?.error) {
      rows.push({ out: t.out, before: null, after: after.cost, error: `baseline ${t.baseline}: ${before.error}` });
      failed++;
      continue;
    }

    // The collision check, separate from the regression check. A regression is
    // one way to notice a bad identifier; it is not the only one, because a
    // name the ORIGINAL also carried nets to zero and stays invisible. This asks
    // the direct question: does anything this file DECLARES share a name with
    // something the cost tree prices?
    const decl = ram.declaredInCode(code);
    const collisions = decl?.found
      ? [...decl.found.keys()].filter((n) => priced.has(n)).map((n) => `${n} (${priced.get(n)}GB)`)
      : [];

    const structural = structuralFaults(code);
    const delta = before ? Math.round((after.cost - before.cost) * 100) / 100 : null;

    // The ratchet. See previousCosts().
    const prev = prevCosts?.[t.out] ?? null;
    const drift = prev == null ? null : Math.round((after.cost - prev) * 100) / 100;
    if (drift != null && drift > 0) structural.push(`costs ${drift}GB MORE than the last build of ${profile.stamp} (${prev} -> ${after.cost}) — a regression the handwritten baseline is too loose to catch`);

    const bad = (delta != null && delta > 0) || collisions.length > 0 || structural.length > 0;
    if (bad) failed++;
    rows.push({ out: t.out, baseline: t.baseline, before: before?.cost ?? null, after: after.cost, delta, prev, drift, collisions, structural, bad });
  }
  return { rows, failed };
}

export function printGate(profile, { rows, failed }) {
  const n = (v) => (v == null ? "     —" : `${v.toFixed(2)}`.padStart(6));
  console.log(`\n  RAM gate — priced with the game's own Script/RamCalculations.ts, under ${profile.stamp}\n`);
  console.log("  output              handwritten   compiled     delta");
  console.log("  ------------------- -----------  ---------  --------");
  for (const r of rows) {
    if (r.note) {
      // Deliberately NOT scored as a saving. A handwritten go-cheat.js sitting
      // on disk in a BitNode that cannot cheat costs 0GB of RUNNING RAM — it is
      // only paid for while exec'd, which is never. Calling its absence
      // "-33.6GB saved" would be the fabricated-number failure this repo has
      // shipped twice. Say what it actually buys, and give the number no credit.
      console.log(`  ${r.out.padEnd(19)} ${n(r.before)}      NOT EMITTED         —   ${r.note}`);
      console.log(`      (0GB saved: an unrun script costs nothing. What is saved is a capability that cannot misfire.)`);
      continue;
    }
    if (r.error) {
      console.log(`  ${r.out.padEnd(19)} ERROR: ${r.error}`);
      continue;
    }
    const pct = r.before ? ` (${r.delta > 0 ? "+" : ""}${((100 * r.delta) / r.before).toFixed(0)}%)` : "";
    const ratchet = r.prev == null ? "  (no prior build)" : r.drift === 0 ? "  = last build" : `  ${r.drift > 0 ? "+" : ""}${r.drift} vs last build`;
    console.log(`  ${r.out.padEnd(19)} ${n(r.before)}      ${n(r.after)}  ${n(r.delta)}${pct}${ratchet}${r.bad ? "   <-- REGRESSION" : ""}`);
    if (r.collisions?.length) console.log(`      !!!!! declared names the RAM checker prices: ${r.collisions.join(", ")}`);
    for (const f of r.structural ?? []) console.log(`      !!!!! ${f}`);
  }
  console.log(
    failed
      ? `\n  FAILED: ${failed} output(s) regressed, collided or are structurally wrong. Nothing was written.\n` +
          `  A build that silently costs more is the failure this gate exists to kill.\n`
      : `\n  OK: no output costs more than the handwritten script it replaces.\n`,
  );
}

/* ---------------------------------------------------------------------- main */

export function writeDist(profile, artifacts, rows, dir = DIST) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, code] of artifacts) fs.writeFileSync(path.join(dir, name), code);
  // `costs` is what makes the next build's ratchet possible. Written only on a
  // build that PASSED, so a rejected build can never lower the bar.
  const costs = Object.fromEntries(rows.filter((r) => r.after != null).map((r) => [r.out, r.after]));
  fs.writeFileSync(
    path.join(dir, "PROFILE.json"),
    JSON.stringify({ ...profile, builtAt: new Date().toISOString(), files: [...artifacts.keys()], costs }, null, 2),
  );
  return dir;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const profile = await profileFromArgs();
  console.log(describeProfile(profile));

  // The capability list the build derives and the list profilecheck.js
  // re-derives in game must be the same list, or the runtime mismatch check is
  // silently narrower than the thing it guards — a check that cannot fail for
  // half its subject matter, which is invariant C4's shape.
  const src = fs.readFileSync(path.join(SRC, "profilecheck.js"), "utf8");
  const unchecked = Object.keys(profile.caps).filter((k) => k.startsWith("CAP_") && !src.includes(`${k}:`));
  if (unchecked.length) {
    console.error(`\n  !!!!! src/profilecheck.js does not check: ${unchecked.join(", ")}`);
    console.error(`  The runtime mismatch check would be narrower than the build. Refusing.\n`);
    process.exit(1);
  }

  const t0 = performance.now();
  const artifacts = await compile(profile);
  const ms = performance.now() - t0;
  console.log(`\n  compiled ${artifacts.size} file(s) in ${ms.toFixed(0)}ms: ${[...artifacts.keys()].join(", ")}`);
  for (const s of SEAMS) console.log(`    ${s.spec.padEnd(20)} -> ${profile.caps[s.cap] ? s.on : s.off}`);

  const result = await gate(profile, artifacts);
  printGate(profile, result);

  if (result.failed) process.exit(1);
  if (process.argv.includes("--dry-run")) console.log("  --dry-run: nothing written.\n");
  else console.log(`  wrote ${writeDist(profile, artifacts, result.rows)}\n`);
}
