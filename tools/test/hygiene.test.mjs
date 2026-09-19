// docs/invariants.md section D — repo hygiene.
//
//   node tools/test/hygiene.test.mjs
//
// Four properties of the repo as a set of bytes on disk, rather than of any
// formula. Three of them are about the deploy path being *checkable*: the
// verifier and the pusher must agree on what is deployed (D1), the files must
// be greppable at all (D2), and the preserved script set must never reach the
// game (D3). The fourth (D4) is the existing verifier, wired in rather than
// reimplemented.
//
// D2 deserves a word because it is the one that reads as paranoia and is not.
// `grep` prints "Binary file ... matches" — or with -I nothing at all — when a
// file contains a NUL, and the tooling around this repo consumes grep output.
// tools/verify-deploy.mjs contained one, and grep answered "no matches" twice
// for a string that was plainly in the file. A search that lies about absence
// is worse than no search.
//
// CALIBRATION: D4 is itself the calibration — it compares this repo's bytes
// against the bytes inside the running game over the control port, and prints
// the count either way. When the daemon is unreachable it says so in as many
// words rather than passing quietly: D4 has three outcomes, and "could not
// check" is deliberately not "fine" (tools/verify-deploy.mjs exits 2 for it).
// D1-D3 are pure filesystem assertions and need no live measurement.

import { Check } from "./harness.mjs";
import { REPO, read, allFiles } from "./acd-sources.mjs";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const CONTROL = process.env.BB_CONTROL ?? "http://localhost:12526";

/** Read-only RPC against the daemon. Never pushFile, never deleteFile. */
async function rpc(method, params) {
  const res = await fetch(`${CONTROL}/rpc`, {
    method: "POST",
    body: JSON.stringify({ method, params }),
    signal: AbortSignal.timeout(8000),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

/* ================================================================== D1 ==== */

/** The `new Set([...])` assigned to `name`, as an array of strings. */
function setLiteral(src, name) {
  const m = src.match(new RegExp(`${name}\\s*=\\s*new Set\\(\\[([^\\]]*)\\]`));
  if (!m) return null;
  return [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}

function d1() {
  const c = new Check("D1", "SKIP_DIRS is identical in tools/rfa-daemon.mjs and tools/verify-deploy.mjs");

  const daemon = setLiteral(read("tools/rfa-daemon.mjs"), "SKIP_DIRS");
  const verify = setLiteral(read("tools/verify-deploy.mjs"), "SKIP_DIRS");
  c.examined(2);
  if (!daemon || !verify) {
    c.fail("could not parse SKIP_DIRS from both files", `daemon=${daemon ? "ok" : "MISSING"} verify=${verify ? "ok" : "MISSING"}`);
    return c;
  }
  c.note(`rfa-daemon.mjs   SKIP_DIRS = ${daemon.join(", ")}`);
  c.note(`verify-deploy.mjs SKIP_DIRS = ${verify.join(", ")}`);

  const missingFromVerify = daemon.filter((d) => !verify.includes(d));
  const extraInVerify = verify.filter((d) => !daemon.includes(d));
  if (missingFromVerify.length || extraInVerify.length) {
    c.fail(
      "the pusher and the verifier disagree about what is deployed",
      `only the daemon skips: ${missingFromVerify.join(", ") || "-"}\n` +
        `       only the verifier skips: ${extraInVerify.join(", ") || "-"}\n` +
        "       a directory skipped by only one of them is either verified and never pushed, or pushed and never verified",
    );
  }

  // The same list is written out in prose in CLAUDE.md, and prose drifts too.
  // That sentence is what anyone reads before deciding where to put a file.
  const claude = read("CLAUDE.md");
  // Capture the whole sentence, not up to the first "." — the list itself
  // contains `.git` and `.telemetry`, so a lazy full stop truncates it.
  const stated = claude.match(/`SKIP_DIRS` in\s*\n?`?tools\/rfa-daemon\.mjs`?:([\s\S]{0,300}?dot\.)/);
  c.examined(1);
  if (!stated) {
    c.warn("CLAUDE.md no longer states the SKIP_DIRS list", "nothing to cross-check the prose against");
  } else {
    const named = [...stated[1].matchAll(/`([\w.]+)\/?`/g)].map((m) => m[1]);
    // The sentence ends "plus anything starting with a dot", so the dot
    // directories are covered by that clause rather than by name.
    const coversDotfiles = /starting with a dot/i.test(stated[1]);
    const missingFromDocs = daemon.filter((d) => !named.includes(d) && !(coversDotfiles && d.startsWith(".")));
    c.note(`CLAUDE.md states: ${named.join(", ")}`);
    if (missingFromDocs.length) {
      c.fail(
        `CLAUDE.md's stated SKIP_DIRS omits ${missingFromDocs.join(", ")}`,
        "the sentence says the list is exact, so an omission reads as “this directory IS pushed” — which for\n" +
          "       variants/ is the opposite of the truth and of D3",
      );
    }
  }
  return c;
}

/* ================================================================== D2 ==== */

function d2() {
  const c = new Check("D2", "no source file contains a byte that makes grep treat it as binary");

  // What grep itself does: a NUL in the first buffer makes the file binary.
  // Checking the whole file rather than the first 32KB, because the cost is
  // nothing and a NUL past the threshold still corrupts anything that reads
  // the file as text.
  let scanned = 0;
  let bytes = 0;
  for (const rel of allFiles()) {
    const buf = fs.readFileSync(path.join(REPO, rel));
    scanned++;
    bytes += buf.length;
    const nul = buf.indexOf(0);
    if (nul >= 0) {
      const line = buf.subarray(0, nul).toString("utf8").split("\n").length;
      c.fail(`${rel} contains a NUL byte at offset ${nul} (line ${line})`, "grep reports “no matches” rather than “I refused to look”");
      continue;
    }
    // Lone surrogates and other invalid UTF-8 also break text tooling, and a
    // round trip through the decoder is the cheapest way to notice.
    const text = buf.toString("utf8");
    if (text.includes("�") && !buf.includes(Buffer.from("�", "utf8"))) {
      c.fail(`${rel} contains invalid UTF-8`, "decoding produced a replacement character that is not in the file");
    }
  }
  c.examined(scanned);
  c.note(`${scanned} text files, ${(bytes / 1024).toFixed(0)}KB, scanned byte by byte for NUL and invalid UTF-8`);
  return c;
}

/* ================================================================== D3 ==== */

async function d3() {
  const c = new Check("D3", "nothing under variants/ is ever pushed to the game");

  const daemonSrc = read("tools/rfa-daemon.mjs");
  const skip = setLiteral(daemonSrc, "SKIP_DIRS") ?? [];
  c.examined(1);
  if (!skip.includes("variants")) {
    c.fail("`variants` is not in the daemon's SKIP_DIRS", "every file under variants/ hot-deploys into the live game, and the stale-instance trap is back");
  } else {
    c.note("tools/rfa-daemon.mjs SKIP_DIRS contains `variants`");
  }

  // Two independent paths push a file: the initial walk and the file watcher.
  // They filter separately (rfa-daemon.mjs:43 and :492), so both have to
  // reject variants/ — the walk being right does not stop the watcher pushing
  // a variants/ file the moment it is saved.
  const watcher = daemonSrc.match(/rel\.split\("\/"\)\.some\(\(seg\) => SKIP_DIRS\.has\(seg\)\)/);
  c.examined(1);
  if (!watcher) {
    c.fail("the daemon's file watcher no longer filters every path segment through SKIP_DIRS", "a nested variants/ path could slip past the walk filter");
  } else {
    c.note("the file-watcher path filter tests every segment against SKIP_DIRS, so nested paths are covered too");
  }

  // And the end-to-end statement: reproduce the daemon's own walk and assert
  // it yields nothing under variants/.
  const skipSet = new Set(skip);
  const walk = (dir, prefix = "") => {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (skipSet.has(e.name) || e.name.startsWith(".")) continue;
        out.push(...walk(path.join(dir, e.name), `${prefix}${e.name}/`));
      } else if (e.name === "NetscriptDefinitions.d.ts") continue;
      else if (/\.(js|jsx|ts|tsx|txt|script)$/.test(e.name)) out.push(`${prefix}${e.name}`);
    }
    return out;
  };
  const tracked = walk(REPO);
  const leaked = tracked.filter((f) => f.startsWith("variants/") || f.startsWith(".variants/"));
  c.examined(tracked.length);
  // The preserved set moved to `.variants/` on 2026-09-13. The reason is worth
  // keeping: adding `variants` to the daemon's SKIP_DIRS fixed the SOURCE, but
  // the running daemon holds that list in memory, so every /sync kept
  // re-pushing all 66 files — including after they had been deleted and the
  // fix reported as done. A dot-prefixed directory is skipped by the daemon's
  // OTHER rule (`entry.name.startsWith(".")`), which needs no restart. Accept
  // either name so this check is correct before and after a daemon restart.
  const variantDir = [".variants", "variants"].map((d) => path.join(REPO, d)).find((d) => fs.existsSync(d));
  const variantFiles = variantDir
    ? fs.readdirSync(variantDir, { recursive: true }).filter((f) => String(f).endsWith(".js"))
    : [];
  c.note(`${tracked.length} files would be pushed; ${variantFiles.length} .js files exist under variants/; ${leaked.length} of them are in the push set`);
  if (leaked.length) c.fail(`${leaked.length} variants/ files are in the push set`, leaked.slice(0, 5).join("\n"));

  // The static half above says "nothing will be pushed from now on". It says
  // nothing about what is ALREADY in the game — and "ever pushed" is a claim
  // about the game's filesystem, not about the daemon's future behaviour. So
  // ask the game. Read-only: getFileNames, nothing else.
  try {
    const names = await rpc("getFileNames", { server: "home" });
    c.examined(names.length);
    const inGame = names.filter((n) => String(n).startsWith("variants/"));
    c.note(`home has ${names.length} files; ${inGame.length} of them are under variants/`);
    if (inGame.length) {
      c.fail(
        `${inGame.length} variants/ files are present in the RUNNING GAME`,
        `${inGame.slice(0, 6).join(", ")}${inGame.length > 6 ? ", ..." : ""}\n` +
          "       SKIP_DIRS stops them being pushed again; it does not remove what an earlier push left behind.\n" +
          "       This is the two-copies-of-the-same-logic state D3 exists to prevent — `run variants/dom-ui/torbuy.js`\n" +
          "       is one tab-completion away, and every one of them is stale by construction.",
      );
    }
  } catch (e) {
    c.warn("could not ask the game which files it holds", `${CONTROL} — ${e.message}\n       the live half of D3 is UNVERIFIED, not fine`);
  }
  return c;
}

/* ================================================================== D4 ==== */

function d4() {
  const c = new Check("D4", "deployed == on disk (tools/verify-deploy.mjs, wired in rather than reimplemented)");

  // Read-only by construction: verify-deploy never pushes, because a check that
  // silently repairs hides how often the push is broken (CLAUDE.md).
  let out = "";
  let code = 0;
  try {
    out = execFileSync(process.execPath, [path.join(REPO, "tools/verify-deploy.mjs"), "--json"], {
      cwd: REPO,
      encoding: "utf8",
      timeout: 60000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    code = e.status ?? -1;
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  c.examined(1);

  if (code === 2) {
    // Deliberately not a pass. "Could not check" is its own outcome and the
    // whole reason verify-deploy has three exit codes.
    c.warn("could not verify — the game or the daemon is not reachable", `${out.trim().slice(0, 300)}\n       D4 is UNVERIFIED, not fine. Start the daemon and connect the game to check it.`);
    return c;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(out.slice(out.indexOf("{")));
  } catch {
    /* not JSON — fall through to the raw text */
  }
  if (parsed) {
    const problems = parsed.problems ?? [];
    c.examined(problems.length);
    const byKind = {};
    for (const p of problems) (byKind[p.kind ?? "?"] ??= []).push(p);
    c.note(`verify-deploy: ok=${parsed.ok}, ${problems.length} problem(s) — ${Object.entries(byKind).map(([k, v]) => `${k}:${v.length}`).join(", ") || "none"}`);
    // This is the one live check in the suite, so it can be red for a reason
    // that is not a bug: a root .js saved seconds ago has not been pushed yet.
    // verify-deploy already retries once for exactly that; `ageMs` in each
    // problem says how long ago the file changed, so a small number means
    // "someone is editing right now", not "the push dropped an edit".
    const fresh = problems.filter((p) => Number(p.ageMs) < 120000);
    if (fresh.length) c.note(`${fresh.length} of them changed on disk in the last 2 minutes — likely an edit still in flight, not a dropped push`);

    // An orphan under a SKIP_DIRS directory is not "the push dropped an edit",
    // it is "something that should never have been pushed is still there" —
    // which is D3's business, not D4's. Reported here so the count is visible
    // and failed there so it is attributed to the right invariant.
    const skip = new Set(setLiteral(read("tools/rfa-daemon.mjs"), "SKIP_DIRS") ?? []);
    const skippedOrphans = (byKind.orphan ?? []).filter((p) => skip.has(String(p.file ?? "").split("/")[0]));
    if (skippedOrphans.length) {
      c.warn(`${skippedOrphans.length} orphan(s) in the game live under a SKIP_DIRS directory`, `see D3 — ${[...new Set(skippedOrphans.map((p) => String(p.file).split("/")[0]))].join(", ")}`);
    }
    for (const p of problems) {
      if (skippedOrphans.includes(p)) continue;
      c.fail(`${p.kind ?? "problem"}: ${p.file ?? p.filename ?? "?"} on ${p.host ?? p.server ?? "?"}`, JSON.stringify(p).slice(0, 400));
    }
    if (!parsed.ok && !problems.length) c.fail("verify-deploy reported not-ok with no itemised problems", out.slice(0, 400));
  } else if (code !== 0) {
    c.fail(`verify-deploy exited ${code}`, out.trim().slice(0, 600));
  } else {
    c.note(out.trim().slice(0, 300));
  }
  return c;
}

/* ======================================================================== */


export async function run() {
  return [d1(), d2(), await d3(), d4()];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const checks = await run();
  for (const c of checks) c.print();
  const failed = checks.filter((c) => c.fails.length).length;
  console.log(`\n${checks.length} checks, ${failed} failing`);
  process.exit(failed ? 1 : 0);
}
