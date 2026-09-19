// docs/invariants.md section C — structure and lifecycle.
//
//   node tools/test/structure.test.mjs
//
// ---------------------------------------------------------------------------
// These are static checks over source text, and static checks over source text
// have exactly one failure mode that matters: a false positive nobody can fix
// gets the check deleted, and then the real regression it would have caught
// lands unnoticed. So every check here is written to be *precise* rather than
// complete, and every one says at the bottom of this comment what it
// deliberately does not catch.
//
// The scope is the MANAGED SET — the scripts boot.js starts and watchdog.js
// keeps alive — rather than every .js at the repo root. Two thirds of the root
// files are one-shot terminal utilities (`find.js`, `ps`-alikes, `ctscan.js`)
// that a human types and reads the output of; holding them to a daemon's
// observability contract would make this permanently red for no gain. The
// managed set is derived from the two launch lists, not hardcoded here, so a
// script joining the stack is automatically held to the contract.
//
// WHAT THESE DO NOT CATCH
//   * C1 recognises a status write by NAME (note/say/out/report/publish/
//     ns.write). A script that publishes through some other spelling reads as
//     silent, and a script that calls note() with garbage reads as healthy.
//     Nothing here checks the *content* of a status file.
//   * C1 does not check that atExit's callback actually publishes — only that
//     one is registered. lock.js registers an atExit that only releases.
//   * C2 checks the structural guarantee in lock.js (acquire registers the
//     release) rather than tracing every caller's control flow. A caller that
//     writes its own lock file without going through lock.js is invisible.
//   * C3 and C4 parse watchdog.js's WATCHED array as text. A predicate built
//     at runtime, or an entry pushed onto the array elsewhere, is not seen.
//   * C6 asks whether a calibration line EXISTS, not whether it passes. A
//     model that prints "CHECK: 300% error" satisfies it.
//   * C7 looks at how a wait is spelled, not at whether the wait is correct.
//
// CALIBRATION: not applicable and not claimed. Nothing here models a game
// quantity — these are assertions about this repo's own source, and the source
// is the ground truth for them. C6 is the check that keeps the *other* files
// calibrated.

import { Check } from "./harness.mjs";
import { read, lines, rootScripts, allFiles, grepRepo, dedupeAdjacent } from "./acd-sources.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIM = path.resolve(HERE, "../sim");

/* ------------------------------------------------------------- text tools */

/** The `{...}` block that starts at or after `from`, balanced, as a string. */
function block(src, from) {
  const open = src.indexOf("{", from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { start: open, end: i + 1, text: src.slice(open, i + 1) };
    }
  }
  return null;
}

/** The `[...]` array literal named `name`, as a string. */
function arrayLiteral(src, name) {
  const at = src.indexOf(`${name} = [`);
  if (at < 0) return null;
  const open = src.indexOf("[", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

/**
 * Split an array literal of object entries into one string per `{...}` entry.
 * Depth-aware, so a predicate containing its own braces stays with its entry.
 */
function entriesOf(arrayText) {
  const out = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < arrayText.length; i++) {
    const ch = arrayText[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) out.push(arrayText.slice(start, i + 1));
    }
  }
  return out;
}

const scriptOf = (entry) => (entry.match(/script:\s*'([^']+)'/) || [])[1];

/**
 * Drop comments so a prose mention is not parsed as a key.
 *
 * watchdog.js's nfg entry carries the comment "TRIGGER, not invariant:", which
 * a naive `invariant\s*:` scan reads as a second predicate. The comments in
 * that file are the most valuable thing in it; stripping them for parsing is
 * the alternative to asking anyone to write less of them.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"\\])\/\/.*$/gm, "$1");
}

/* ------------------------------------------------------- the managed set */

/** Scripts boot.js launches and watchdog.js keeps alive, derived from both lists. */
function managedSet() {
  const bootList = entriesOf(stripComments(arrayLiteral(read("boot.js"), "STACK") ?? "[]")).map(scriptOf);
  const watchList = entriesOf(stripComments(arrayLiteral(read("watchdog.js"), "WATCHED") ?? "[]")).map(scriptOf);
  return {
    boot: bootList.filter(Boolean),
    watched: watchList.filter(Boolean),
    all: [...new Set([...bootList, ...watchList].filter(Boolean))].sort(),
  };
}

/* ================================================================== C1 ==== */

/**
 * Does this text publish a status file?
 *
 * Two spellings, and the second one matters: batch.js writes through
 * `ns.write(SETTINGS.statusFile, ...)`, so a check that only recognises a
 * literal `/tel/...` argument reads the file that INVENTED this pattern as
 * silent. So the names bound to a /tel/ path are collected from the file first
 * and then looked for at the write site.
 */
function publishesIn(text, telNames) {
  if (/\b(note|say|out|report|publish|record)\s*\(/.test(text)) return true;
  for (const m of text.matchAll(/ns\.write\s*\(\s*([^,)]+)/g)) {
    const arg = m[1];
    if (/['"`]\/tel\//.test(arg)) return true;
    if ([...telNames].some((n) => new RegExp(`\\b${n}\\b`).test(arg))) return true;
  }
  return false;
}

/** Identifiers and properties this file binds to a /tel/ path. */
const telNamesOf = (src) => new Set([...src.matchAll(/(\w+)\s*[:=]\s*['"`]\/tel\//g)].map((m) => m[1]));

function c1(managed) {
  const c = new Check("C1", "every managed script publishes on return, handled error, throw AND kill");

  const rows = [];
  for (const script of managed.all) {
    let src;
    try {
      src = read(script);
    } catch {
      c.fail(`${script} is in a launch list but not on disk`, "boot.js or watchdog.js names a file that does not exist");
      continue;
    }
    c.examined(1);

    const telNames = telNamesOf(src);
    const importsStatus = /from\s+['"]status\.js['"]/.test(src);
    const hasAtExit = /ns\.atExit\s*\(/.test(src);

    // A handled-error path counts only if the catch body itself publishes —
    // that is the whole point of the module (status.js:19-25): a status write
    // that is the last statement of the `try` is skipped by the throw it exists
    // to report.
    let catchPublishes = false;
    let catchCount = 0;
    for (let i = src.indexOf("catch"); i >= 0; i = src.indexOf("catch", i + 1)) {
      const b = block(src, i);
      if (!b) continue;
      catchCount++;
      if (publishesIn(b.text, telNames)) catchPublishes = true;
    }

    // A success path: a publish that is not inside a catch.
    const publishesSomewhere = publishesIn(src, telNames);

    rows.push({ script, importsStatus, hasAtExit, catchCount, catchPublishes, publishesSomewhere });
  }

  for (const r of rows) {
    // Two tiers, split by how certain the signal is.
    //
    //   FAIL — no status write anywhere, or no ns.atExit. Both are
    //          unambiguous: atExit is the ONLY hook that fires on a kill, a
    //          killall, an install, or a throw past every handler, and it is
    //          either registered or it is not.
    //   WARN — a catch that does not itself publish. Usually the bug (a status
    //          write at the end of the try is skipped by the throw), but not
    //          always: watchdog.js records the failure into its per-entry
    //          record inside the catch and publishes the whole table at the end
    //          of the cycle, which satisfies the invariant by a route this
    //          check cannot see. Flagged, not failed, for that reason.
    const missing = [];
    if (!r.publishesSomewhere) missing.push("no status write at all");
    if (!r.hasAtExit) missing.push("no ns.atExit (kill/throw/install path)");
    if (r.publishesSomewhere && !r.catchPublishes) {
      c.warn(
        `${r.script}: ${r.catchCount ? "no catch block publishes" : "no catch around main"}`,
        "a status write at the end of the try is skipped by the throw it exists to report (status.js:19-25).\n" +
          "       Not failed: a script that records in the catch and publishes later in the same loop is also correct.",
      );
    }
    const mark = missing.length ? "MISSING" : r.catchPublishes ? "ok" : "ok (see warning)";
    c.note(
      `${r.script.padEnd(14)} status.js=${r.importsStatus ? "y" : "n"} atExit=${r.hasAtExit ? "y" : "n"} ` +
        `catches=${r.catchCount} catch-publishes=${r.catchPublishes ? "y" : "n"}  ${mark}`,
    );
    if (missing.length) c.fail(`${r.script}: ${missing.join("; ")}`, "tools/staging/NOTES-observability.md is the worked conversion");
  }
  c.note(`managed set = ${managed.all.length} scripts (boot.js STACK + watchdog.js WATCHED); ${rootScripts().length - managed.all.length} other root scripts not held to this`);
  return c;
}

/* ================================================================== C2 ==== */

function c2() {
  const c = new Check("C2", "a script holding the UI lock releases it on every path, including kill");

  // The structural guarantee lives in lock.js: acquire() registers the release
  // with ns.atExit before it returns true, so no caller can forget. Assert that
  // EVERY `return true` in acquire is preceded by a registration — one path
  // missing it silently reintroduces the ~3h leak.
  const src = read("lock.js");
  const at = src.indexOf("export async function acquire");
  const body = block(src, at);
  c.examined(1);
  if (!body) {
    c.fail("could not find acquire() in lock.js", "the structural guarantee C2 relies on is unverified");
    return c;
  }
  const returnsTrue = [...body.text.matchAll(/return true/g)].map((m) => m.index);
  const registrations = [...body.text.matchAll(/ns\.atExit\s*\(\s*\(\s*\)\s*=>\s*release\s*\(\s*ns\s*\)/g)].map((m) => m.index);
  c.note(`lock.js acquire(): ${returnsTrue.length} success returns, ${registrations.length} ns.atExit(release) registrations`);
  for (const r of returnsTrue) {
    const before = registrations.filter((x) => x < r && r - x < 200);
    c.examined(1);
    if (!before.length) {
      const line = body.text.slice(0, r).split("\n").length;
      c.fail(`acquire() has a success return with no atExit(release) before it`, `roughly lock.js line ${src.slice(0, at).split("\n").length + line}`);
    }
  }

  // Callers, and their own belt-and-braces. Not a failure to lack one — the
  // guarantee above covers it — but worth printing, because a caller that
  // releases in a `finally` AND relies on atExit is the state the repo is in
  // and the state it should stay in.
  const callers = rootScripts().filter((f) => /from\s+['"]lock\.js['"]/.test(read(f)) && /\bacquire\s*\(/.test(read(f)));
  for (const f of callers) {
    const s = read(f);
    c.examined(1);
    const inFinally = /finally\s*\{[^}]*release\s*\(/s.test(s);
    const inAtExit = /atExit\s*\([^)]*\)?[\s\S]{0,200}?release\s*\(/.test(s);
    c.note(`${f.padEnd(12)} acquire + release: finally=${inFinally ? "y" : "n"} atExit=${inAtExit ? "y" : "n"} (lock.js's own atExit covers both either way)`);
    if (!inFinally && !inAtExit) {
      c.warn(`${f} takes the lock and has neither a finally nor an atExit release`, "correct only for as long as lock.js keeps registering one for it");
    }
  }

  // SKIPPED is a Symbol, and a Symbol is truthy. Every caller testing
  // `if (!(await acquire(...)))` would treat it as success. acquire() must
  // therefore never return it — withLock() may.
  c.examined(1);
  if (/return\s+SKIPPED/.test(body.text)) {
    c.fail("acquire() can return the SKIPPED symbol", "SKIPPED is truthy, and every caller tests `if (!(await acquire(...)))`");
  } else {
    c.note("acquire() never returns the truthy SKIPPED symbol — `if (!(await acquire(...)))` is safe at every call site");
  }
  return c;
}

/* ================================================================== C3 ==== */

function c3() {
  const c = new Check("C3", "watchdog: a false predicate never launches; invariant kills, trigger does not");

  const src = read("watchdog.js");
  const list = arrayLiteral(src, "WATCHED");
  if (!list) {
    c.fail("could not find WATCHED in watchdog.js", "C3 is unverified");
    return c;
  }
  const entries = entriesOf(stripComments(list));

  // 0. Negative control. C3 passes today because the bug it describes was
  //    fixed, and a check that has never been seen to fail is indistinguishable
  //    from a check that cannot fail. Run the same parser over an entry in the
  //    old shape and assert it IS rejected, so a PASS above means something.
  const legacy = "{ script: 'nfg.js', host: 'home', args: [], when: (ns) => false, stopWhenFalse: false }";
  const caught = /(^|[\s,{])when\s*:/.test(stripComments(legacy)) && /stopWhenFalse\s*:/.test(stripComments(legacy));
  c.examined(1);
  c.note(`negative control: a synthetic entry carrying \`when\`/\`stopWhenFalse\` is ${caught ? "rejected" : "NOT REJECTED"} by this parser`);
  if (!caught) c.fail("the legacy-key parser does not fire on a known-bad entry", "every other result in C3 is therefore meaningless");

  // 1. Entry shape.
  let daemons = 0;
  let jobs = 0;
  for (const e of entries) {
    const name = scriptOf(e) ?? "?";
    c.examined(1);
    const hasInvariant = /(^|[\s,{])invariant\s*:/.test(e);
    const hasTrigger = /(^|[\s,{])trigger\s*:/.test(e);
    if (/(^|[\s,{])when\s*:/.test(e)) c.fail(`${name} uses the legacy key \`when\``, "rename to `invariant` (kills on false) or `trigger` (never kills)");
    if (/stopWhenFalse\s*:/.test(e)) c.fail(`${name} uses the legacy key \`stopWhenFalse\``, "the kind is carried by invariant vs trigger now");
    if (hasInvariant && hasTrigger) c.fail(`${name} has both invariant and trigger`, "an entry is one kind or the other");
    if (hasTrigger) jobs++;
    else daemons++;
  }
  c.note(`${entries.length} WATCHED entries: ${daemons} daemon(s), ${jobs} job(s); none carry \`when\` or \`stopWhenFalse\``);

  // 2. checkEntry must still reject the legacy keys, or a pasted entry arrives
  //    unguarded and the relaunch storm comes back with no warning.
  const ce = block(src, src.indexOf("function checkEntry"));
  c.examined(1);
  for (const key of ["when", "stopWhenFalse"]) {
    if (!ce || !new RegExp(`'${key}'\\s+in\\s+e`).test(ce.text)) {
      c.fail(`checkEntry() no longer rejects the legacy key \`${key}\``, "a copied-in entry would arrive unguarded");
    }
  }
  if (ce) c.note("checkEntry() still rejects `when` and `stopWhenFalse` by name");

  // 3. The structural invariant: the `continue` that prevents a launch must be
  //    OUTSIDE the kill branch. Collapsing them is the 2026-09-12 bug — one
  //    overloaded boolean launching nfg/homeup every 30s.
  // The guard's CONDITION changed when triggers gained a third answer —
  // `{ blocked: reason }`, for a guard that cannot decide rather than one that
  // says "not yet" (watchdog.js, the liveness block). What this check asserts
  // is unchanged and is about the guard's SHAPE, not its condition: the
  // launch-blocking `continue` stays outside the kill branch. Matching the
  // condition text is only how the block is located.
  const guardAt = src.indexOf("if (predicate && (blocked || !verdict))");
  const guard = block(src, guardAt);
  c.examined(1);
  if (guardAt < 0 || !guard) {
    c.fail("could not find the predicate guard in watchdog.js main()", "C3's structural half is unverified");
    return c;
  }
  // Depth 1 = directly inside the guard block. The kill branch sits deeper.
  const depthOf = (idx) => {
    let d = 0;
    for (let i = 0; i < idx; i++) {
      if (guard.text[i] === "{") d++;
      else if (guard.text[i] === "}") d--;
    }
    return d;
  };
  const continues = [...guard.text.matchAll(/\bcontinue\b/g)].map((m) => depthOf(m.index));
  const kills = [...guard.text.matchAll(/scriptKill\s*\(/g)].map((m) => depthOf(m.index));
  c.note(`predicate guard: \`continue\` at brace depth ${continues.join(",") || "none"}, \`scriptKill\` at depth ${kills.join(",") || "none"}`);
  if (!continues.includes(1)) {
    c.fail("the launch-blocking `continue` is not at the top level of the predicate guard", "if it moved inside the kill branch, a false trigger would launch a JOB every tick");
  }
  if (kills.some((d) => d <= 1)) {
    c.fail("scriptKill runs at the top level of the predicate guard", "a JOB whose trigger goes false because it did the work would be killed mid-run");
  }
  const daemonBranch = block(guard.text, guard.text.indexOf("if (kind === DAEMON)"));
  c.examined(1);
  if (!daemonBranch || !/scriptKill/.test(daemonBranch.text)) {
    c.fail("the kill is no longer inside an `if (kind === DAEMON)` branch", "invariant/trigger no longer decide the kill");
  } else {
    c.note("the kill is inside `if (kind === DAEMON)` and the `continue` is outside it — launch and kill are still two decisions");
  }
  return c;
}

/* ================================================================== C4 ==== */

function c4() {
  const c = new Check("C4", "no circular gate: a predicate must not read telemetry written only by what it gates");

  const src = read("watchdog.js");
  const entries = entriesOf(stripComments(arrayLiteral(src, "WATCHED") ?? "[]"));

  // Who writes each /tel/ file, across every root script.
  const writers = new Map();
  for (const f of rootScripts()) {
    const s = read(f);
    for (const m of s.matchAll(/['"](\/tel\/[\w.-]+)['"]/g)) {
      // A path that only ever appears in a read is not a write.
      const file = m[1];
      const usedForWrite =
        new RegExp(`write\\s*\\(\\s*['"]${file.replace(/[/.]/g, "\\$&")}`).test(s) ||
        new RegExp(`(STATUS|TELEMETRY|OUT|FILE)\\s*=\\s*['"]${file.replace(/[/.]/g, "\\$&")}`).test(s);
      if (!usedForWrite) continue;
      if (!writers.has(file)) writers.set(file, new Set());
      writers.get(file).add(f);
    }
  }
  c.note(`${writers.size} /tel/ files written by root scripts; ${[...writers].filter(([, w]) => w.size === 1).length} have exactly one writer`);

  for (const e of entries) {
    const script = scriptOf(e);
    if (!script) continue;
    c.examined(1);
    for (const m of e.matchAll(/read\s*\(\s*['"](\/tel\/[\w.-]+)['"]/g)) {
      const file = m[1];
      const who = writers.get(file) ?? new Set();
      const soleWriter = who.size === 1 && who.has(script);
      const kills = /(^|[\s,{])invariant\s*:/.test(e);
      c.note(`  ${script} predicate (${kills ? "invariant — KILLS on false" : "trigger"}) reads ${file}; written by ${[...who].join(", ") || "nothing on disk"}`);
      if (!soleWriter) continue;
      const hazard = kills
        ? `this predicate KILLS on false. Text files survive a prestige (A14), so a ${file} left saying\n` +
          "       \u201cnothing left to do\u201d by the previous life makes the watchdog kill and never relaunch it in the next one."
        : "a run that dies before its final write leaves the gate stale, and the script has to run to teach its own\n" +
          "       gate anything. watchdog.js's JOB_MIN_INTERVAL bounds the resulting storm but does not remove the loop.";
      c.fail(`circular gate: watchdog's ${script} predicate reads ${file}, which only ${script} writes`, hazard);
    }
  }
  return c;
}

/* ================================================================== C6 ==== */

function c6() {
  const c = new Check("C6", "every tools/sim model that drives a decision prints a CHECK or says NOT CALIBRATED");

  const files = fs
    .readdirSync(SIM, { recursive: true })
    .filter((f) => typeof f === "string" && f.endsWith(".mjs") && !f.includes("bundle"))
    .map((f) => `tools/sim/${f}`.replace(/\\/g, "/"));

  // A library is imported by something else in tools/sim; an entry point is
  // not. Only entry points produce a number a human then acts on, and the rule
  // in CLAUDE.md is about output that drives a decision.
  const corpus = files.map((f) => read(f));
  const isImported = (f) => {
    const base = path.basename(f);
    return corpus.some((src, i) => files[i] !== f && new RegExp(`["'./]${base.replace(".", "\\.")}["']`).test(src));
  };

  // Infrastructure: builds and stands up the bundle, computes nothing.
  const INFRA = new Set(["tools/sim/build.mjs", "tools/sim/env.mjs", "tools/sim/game.mjs"]);

  for (const f of files) {
    if (INFRA.has(f)) continue;
    if (isImported(f)) continue;
    c.examined(1);
    const src = read(f);
    const header = src.split("\n").slice(0, 80).join("\n");
    // "Says so at the top" in any of the spellings this repo actually uses.
    // go-tune.mjs's is "RESULTS FROM THIS FILE ARE SUSPECT", which is a
    // stronger statement than NOT CALIBRATED and must not be failed for being
    // more emphatic than the template.
    const declared = /NOT CALIBRATED|UNCALIBRATED|CALIBRATION|ARE SUSPECT|DO NOT DECIDE ANYTHING/i.test(header);
    const printsCheck = /console\.log\([^)]*CHECK|checkWithin|`?\s*CHECK\b/.test(src);
    // A header that states what the file can and cannot establish is doing the
    // right thing under a different name. Worth a WARN so the label gets
    // normalised, not a FAIL — this is a vocabulary gap, not a fidelity one.
    const caveated = /can and cannot|cannot (pin down|establish|prove)|should not be trusted/i.test(header);
    if (declared || printsCheck) {
      c.note(`${f.padEnd(36)} ${printsCheck ? "prints a CHECK" : ""}${printsCheck && declared ? " + " : ""}${declared ? "declares its calibration state in the header" : ""}`);
    } else if (caveated) {
      c.warn(`${f} bounds its own validity but uses neither marker`, "add a CHECK line or a NOT CALIBRATED header so the state is greppable");
    } else {
      c.fail(`${f} drives a decision with no calibration line and no NOT CALIBRATED header`, "CLAUDE.md: silence reads as \u201cchecked and fine\u201d, which is the state that produced two fabricated validations");
    }
  }

  const libs = files.filter((f) => isImported(f) && !INFRA.has(f));
  c.note(`${libs.length} file(s) under tools/sim are imported by another and treated as libraries, not models: ${libs.map((f) => path.basename(f)).join(", ")}`);
  return c;
}

/* ================================================================== C7 ==== */

function c7() {
  const c = new Check("C7", "callers of the cmd bridge wait on in.txt OR busy.txt, never busy.txt alone");

  // cmd.js is the bridge itself: it owns both files and is the thing the rule
  // protects callers from, so it is not a caller.
  const callers = rootScripts().filter((f) => f !== "cmd.js" && /cmd\/busy\.txt/.test(read(f)));

  for (const f of callers) {
    const src = lines(f);
    c.examined(1);
    // Every place the busy file is actually tested, as opposed to named in a
    // comment or assigned to a constant.
    let tests = 0;
    for (let i = 0; i < src.length; i++) {
      const line = src[i];
      if (!/fileExists\s*\(\s*(BUSY|['"]\/cmd\/busy\.txt['"])/.test(line)) continue;
      tests++;
      // The alternative may be on the same line or the one before (a multi-line
      // condition), so look at a small window rather than the line alone.
      const window = src.slice(Math.max(0, i - 1), i + 2).join("\n");
      const alsoIn = /CMD_IN|cmd\/in\.txt/.test(window);
      c.note(`${f}:${i + 1} ${line.trim().slice(0, 110)}`);
      if (!alsoIn) {
        c.fail(
          `${f}:${i + 1} waits on /cmd/busy.txt alone`,
          "between the write to in.txt and the bridge picking it up, neither file exists — this concludes\n" +
            "\u201cfinished\u201d before the batch started. autobuy.js and backdoor.js test both files.",
        );
      }
    }
    if (!tests) c.note(`${f}: mentions the busy file but never tests it`);
  }
  c.note(`${callers.length} root script(s) other than cmd.js reference /cmd/busy.txt`);
  return c;
}

/* ======================================================================== */

/**
 * C8 — a refused ns.exec must be observable.
 *
 * ns.exec does NOT throw when it cannot launch. It returns pid 0
 * (NetscriptFunctions.ts — runScriptFromScript returns 0 on failure), so a
 * discarded return value turns "could not start" into silence. That is the
 * exact shape CLAUDE.md calls the most expensive bug class in this repo: the
 * system keeps running, keeps reporting, and is wrong.
 *
 * Two real defects motivated this, both found by audit rather than by anything
 * failing loudly:
 *
 *   homeup.js  exec'd boot.js to re-plan after buying RAM, ignored the result,
 *              and then returned unconditionally. Its own comment says
 *              "nothing else re-runs the launcher at this tier" — so a refused
 *              exec meant home had grown and NOTHING would ever re-plan for it.
 *              A fixed point: money earned, never convertible into capability.
 *              BitNode 4 and 5 were both bridged by hand past this.
 *   seed.js    recorded placements but had no else branch, so a host that
 *              refused every worker was indistinguishable from one that needed
 *              none — the tprint reported the short list as the whole plan.
 *
 * What counts as observable: the call's value must reach a name or a test. A
 * bare `ns.exec(...)` as an expression statement is the failure. Assigning it
 * and then never reading the name is NOT caught here — that needs flow
 * analysis — so this is a floor, not a ceiling, and the note says so.
 */
function c8() {
  const c = new Check("C8", "no ns.exec result is discarded — exec returns 0 on refusal, it does not throw");

  const bare = [];
  let total = 0;
  for (const script of rootScripts()) {
    const src = read(script);
    // Blank comments and strings so prose about ns.exec is not evidence.
    const bareSrc = src
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
      .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');

    for (const line of bareSrc.split("\n")) {
      const i = line.indexOf("ns.exec(");
      if (i < 0) continue;
      total++;
      // Observable if the value is bound or tested: `const pid =`, `if (`,
      // `return`, `await`, `=>`, or used as an operand. Discarded if the call
      // begins the statement.
      const before = line.slice(0, i).trim();
      if (before === "" || before === "}" || before === "{" || before === ";") {
        bare.push(`${script}: ${line.trim().slice(0, 100)}`);
      }
    }
  }

  c.examined(total);
  c.note(`${total} ns.exec call site(s) across ${rootScripts().length} deployed root script(s)`);
  c.note("floor, not ceiling: this catches a DISCARDED value, not a captured-then-unread one");

  for (const b of bare) {
    c.fail(
      "ns.exec result discarded",
      `${b}\n       exec returns 0 when it cannot launch — bind the pid and report the refusal,\n` +
        "       or the failure is invisible to anything reading telemetry",
    );
  }
  return c;
}

/* ======================================================================== */

/**
 * C9 — every publish of the claim file carries EVERY claim field.
 *
 * /tel/installgate.txt is read by budget.js's augClaim and joinClaim, and both
 * fail closed: a field they cannot read is "unknown", which blocks spending
 * rather than licensing it. That is correct. The hazard is on the WRITING
 * side — a publisher that omits one field turns its own "nothing to report"
 * into "unknown" for that claimant, and every spender gated on it stops.
 *
 * This is not hypothetical and it is not a one-off. progress.js already
 * carried a fix for exactly this deadlock:
 *
 *   progress.js cannot raise RAM -> never rewrites the file
 *     -> the claim reads unknown -> homeup.js refuses to buy home RAM
 *       -> home never grows -> progress.js can never raise RAM
 *
 * That fix published `planned: false, plan: null`, which satisfies augClaim.
 * joinClaim was added later and is stricter — only a finite number counts — so
 * the omitted field rebuilt the identical deadlock one claimant to the left.
 * Live in BitNode 5: home stuck at 512GB holding $3.92b, progress.js needing
 * 1192GB, homeup.js launched zero times, and the operator-facing message
 * blaming augClaim, which was answering correctly.
 *
 * So: adding a claimant to budget.js means updating every publisher, and the
 * suite has to be what says so. This check fails if any write of the gate file
 * is missing a field some claim reader requires.
 */
function c9() {
  const c = new Check("C9", "every /tel/installgate.txt publish carries every field the claim readers require");

  // MANDATORY vs OPTIONAL is a semantic distinction no parser can infer, so it
  // is declared here with the reason, and the discovery below exists to stop
  // this list going quietly stale (the R6 checked-duplication pattern).
  //
  //   joinClaim   MANDATORY. budget.js: "ONLY a finite non-negative number is
  //               a claim" — absent reads as unknown and blocks every spender.
  //   budgetClaim OPTIONAL. Read only when `plan` is non-null, purely as a
  //               discount on the plan's gross cost, and falls back to
  //               plan.totalCost when absent. An omission here narrows nothing.
  const MANDATORY = ["joinClaim"];
  const KNOWN_OPTIONAL = ["budgetClaim"];

  const budget = read("budget.js");
  const discovered = [...new Set([...budget.matchAll(/\bd\.([A-Za-z_]\w*)/g)].map((m) => m[1]))].filter((f) =>
    f.endsWith("Claim"),
  );
  if (!discovered.length) {
    c.fail("found no *Claim field reads in budget.js", "the parser found nothing, which is not the same as there being nothing");
    return c;
  }
  // A claimant added to budget.js and classified in neither list is the case
  // that produced this bug: joinClaim landed after progress.js's publisher was
  // written, and nothing said so. Warn rather than fail — the suite cannot know
  // which it is, but it can refuse to stay silent.
  for (const f of discovered) {
    if (!MANDATORY.includes(f) && !KNOWN_OPTIONAL.includes(f)) {
      c.warn(
        `budget.js reads a claim field this check does not classify: ${f}`,
        "decide whether it is mandatory (publishers must always emit it) or optional (has a fallback),\n" +
          "       then add it to MANDATORY or KNOWN_OPTIONAL in this check",
      );
    }
  }
  const required = MANDATORY;
  c.note(`claim fields in budget.js: ${discovered.join(", ")} — mandatory: ${required.join(", ")}`);

  const src = read("progress.js");
  // Each ns.write(GATE, ...) call, with its argument text.
  let found = 0;
  for (let i = src.indexOf("ns.write("); i >= 0; i = src.indexOf("ns.write(", i + 1)) {
    const head = src.slice(i, i + 40);
    if (!/ns\.write\(\s*GATE\b/.test(head)) continue;
    found++;
    // Take the balanced argument list.
    let depth = 0;
    let end = i;
    for (let j = src.indexOf("(", i); j < src.length; j++) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    const call = src.slice(i, end + 1);
    const bare = call.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    const line = src.slice(0, i).split("\n").length;
    c.examined(1);
    for (const field of required) {
      if (!new RegExp(`\\b${field}\\s*:`).test(bare)) {
        c.fail(
          `progress.js:${line} publishes the claim file without \`${field}\``,
          `budget.js reads d.${field} and treats an absent field as UNKNOWN, which blocks every spender\n` +
            "       gated on it — publish an explicit number (0 when nothing is promised), never nothing",
        );
      }
    }
  }
  c.note(`${found} write(s) of the gate file in progress.js, each checked for ${required.length} field(s)`);
  if (!found) c.fail("no ns.write(GATE, ...) found in progress.js", "the parser looked and found nothing — that is a rotted check, not a clean repo");
  return c;
}

/* ======================================================================== */

export async function run() {
  const managed = managedSet();
  return [c1(managed), c2(), c3(), c4(), c6(), c7(), c8(), c9()];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const checks = await run();
  for (const c of checks) c.print();
  const failed = checks.filter((c) => c.fails.length).length;
  console.log(`\n${checks.length} checks, ${failed} failing`);
  process.exit(failed ? 1 : 0);
}
