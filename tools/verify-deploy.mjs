#!/usr/bin/env node
// verify-deploy — is what the game is running actually what is on disk?
//
// The hot reload in tools/rfa-daemon.mjs is not reliable. On 2026-09-12 two
// consecutive edits (boot.js, watchdog.js) never reached the game; nothing
// reported an error and the game kept executing the old code, so the fix looked
// applied and simply had no effect. CLAUDE.md's remedy was "diff it by hand
// after editing anything you are about to rely on" — a detection mechanism that
// depends on a human remembering, which is not a mechanism. This is.
//
// It talks to the ALREADY-RUNNING daemon over the control port, so it never
// needs a restart (a restart drops the game's websocket and needs a manual
// reconnect in Options). Every call it makes is read-only: getFileNames,
// getAllFiles, getFile, getSaveFile. It NEVER calls pushFile or deleteFile —
// verifying must not be able to change what it is verifying, and a tool that
// silently repairs is a tool that hides how often the push is broken.
//
//   node tools/verify-deploy.mjs            # everything, every server
//   node tools/verify-deploy.mjs --home-only
//   node tools/verify-deploy.mjs --servers home,n00dles
//   node tools/verify-deploy.mjs --quiet    # silent unless something is wrong
//   node tools/verify-deploy.mjs --json
//
// Exit codes: 0 in sync · 1 out of sync · 2 could not check (daemon down,
// game not connected, RPC failure). 2 is deliberately distinct from 1: "I could
// not tell" must never be mistaken for "it is fine", which is the exact failure
// mode this tool exists to kill.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CTL = `http://localhost:${process.env.CTL_PORT ?? 12526}`;

// Must stay identical to rfa-daemon.mjs. If the daemon's idea of "tracked"
// drifts from ours we would verify a different set of files than the one that
// gets pushed, and report all-clear on a file nobody deploys.
const SKIP_DIRS = new Set(["node_modules", "tools", "variants", "archive", "min", ".git", ".telemetry", ".idea"]);
const TRACKED_EXT = /\.(js|jsx|ts|tsx|txt|script)$/;

// Files that live in the game and are *supposed* to have no counterpart on
// disk: written by in-game scripts, shipped by the game itself, or left by the
// bridge. Anything in the game that is not tracked and not on this list is an
// orphan — most likely a script deleted from disk that is still sitting in the
// game where the watchdog can relaunch it.
const GAME_OWNED = [
  /^NetscriptDefinitions\.d\.ts$/,
  /^APIBreakInfo-[\d.]+\.txt$/,
  /^(tel|cmd|go|log|data)\//, // telemetry, the cmd.js bridge, the Go solver
  /\.wip\.(js|jsx|ts|tsx)$/, // the game's own sample scripts, scattered on servers
  /\.(lit|msg|cct|exe)$/,
];
const isGameOwned = (name) => GAME_OWNED.some((re) => re.test(name));

/* ------------------------------------------------------------------- args */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const OPTS = {
  homeOnly: flag("home-only"),
  servers: opt("servers", null),
  json: flag("json"),
  quiet: flag("quiet"),
  verbose: flag("verbose"),
  retry: Number(opt("retry", 0)),
  retryDelay: Number(opt("retry-delay", 400)),
  concurrency: Number(opt("concurrency", 6)),
};

if (flag("help") || flag("h")) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 30).join("\n").replace(/^\/\/ ?/gm, ""));
  process.exit(0);
}

/* ------------------------------------------------------------------- util */

const tty = process.stdout.isTTY && !OPTS.json;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = (s) => c(31, s);
const green = (s) => c(32, s);
const yellow = (s) => c(33, s);
const dim = (s) => c(2, s);
const bold = (s) => c(1, s);

const hash = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex").slice(0, 8);

class CheckError extends Error {}

async function rpc(method, params) {
  let res;
  try {
    res = await fetch(`${CTL}/rpc`, {
      method: "POST",
      body: JSON.stringify({ method, params }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new CheckError(`control port ${CTL} unreachable (${e.message}) — is \`npm run daemon\` up?`);
  }
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (body.error) throw new CheckError(`${method}: ${body.error}`);
  return body.result;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}

/* -------------------------------------------------------------- disk side */

function trackedFiles(dir = ROOT, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      out.push(...trackedFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`));
    } else if (entry.name === "NetscriptDefinitions.d.ts") {
      continue;
    } else if (TRACKED_EXT.test(entry.name)) {
      const local = path.join(dir, entry.name);
      const content = fs.readFileSync(local, "utf8");
      out.push({
        local,
        remote: `${prefix}${entry.name}`,
        content,
        hash: hash(content),
        bytes: Buffer.byteLength(content),
        mtime: fs.statSync(local).mtimeMs,
      });
    }
  }
  return out;
}

/* -------------------------------------------------------------- game side */

// The RFA has no "list servers" method, so the host list has to come from
// somewhere. /hosts is the daemon's own knownHosts set and is free; it only
// exists after the daemon is next restarted, so fall back to decoding the save,
// which is exactly what the daemon does to build that set in the first place.
async function discoverHosts() {
  if (OPTS.servers) return OPTS.servers.split(",").map((s) => s.trim()).filter(Boolean);
  if (OPTS.homeOnly) return ["home"];
  try {
    const res = await fetch(`${CTL}/hosts`, { signal: AbortSignal.timeout(5_000) });
    if (res.ok) {
      const body = await res.json();
      if (Array.isArray(body.hosts) && body.hosts.length) return body.hosts;
    }
  } catch {
    /* daemon predates /hosts, or is mid-restart — fall through */
  }
  const save = await rpc("getSaveFile");
  const raw = save.binary
    ? zlib.gunzipSync(Buffer.from(save.save, "latin1")).toString("utf8")
    : Buffer.from(save.save, "base64").toString("utf8");
  const servers = JSON.parse(JSON.parse(raw).data.AllServersSave);
  const hosts = new Set(["home"]);
  for (const key of Object.keys(servers)) {
    const s = servers[key]?.data ?? servers[key];
    // Only rooted hosts: the daemon can only push where we have admin rights,
    // so an unrooted host holding a stale copy is not something a sync can fix
    // and flagging it would be noise.
    if (s?.hostname && s.hasAdminRights) hosts.add(s.hostname);
  }
  return [...hosts];
}

/* ------------------------------------------------------------- comparison */

function firstDifference(disk, game) {
  const a = disk.split("\n");
  const b = game.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      const clip = (s) => (s === undefined ? "<end of file>" : s.length > 96 ? s.slice(0, 96) + "…" : s);
      return { line: i + 1, disk: clip(a[i]), game: clip(b[i]) };
    }
  }
  return null; // differ only in trailing bytes a split cannot see
}

async function checkServer(host, tracked) {
  const byName = new Map(tracked.map((f) => [f.remote, f]));
  const files = await rpc("getAllFiles", { server: host });
  const problems = [];
  const seen = new Set();

  for (const { filename, content } of files) {
    seen.add(filename);
    const disk = byName.get(filename);
    if (!disk) {
      // Only home is expected to hold the full set; other servers legitimately
      // carry a subset scp'd around, so "in game, not on disk" is only a
      // finding when it is a script we could have deleted from the repo.
      if (!isGameOwned(filename) && host === "home") {
        problems.push({ kind: "orphan", host, file: filename, gameHash: hash(content), gameBytes: content.length });
      }
      continue;
    }
    if (content === disk.content) continue;
    problems.push({
      kind: "differs",
      host,
      file: filename,
      diskHash: disk.hash,
      diskBytes: disk.bytes,
      gameHash: hash(content),
      gameBytes: Buffer.byteLength(content),
      ageMs: Date.now() - disk.mtime,
      diff: firstDifference(disk.content, content),
    });
  }

  // Only home is required to hold everything. A file absent from another server
  // was simply never scp'd there, which is not a deploy failure.
  if (host === "home") {
    for (const f of tracked) {
      if (!seen.has(f.remote)) {
        problems.push({ kind: "missing", host, file: f.remote, diskHash: f.hash, diskBytes: f.bytes, ageMs: Date.now() - f.mtime });
      }
    }
  }
  return { host, fileCount: files.length, problems };
}

/* ---------------------------------------------------------------- reports */

const age = (ms) =>
  ms < 1000 ? `${ms | 0}ms` : ms < 90_000 ? `${(ms / 1000).toFixed(0)}s` : ms < 5_400_000 ? `${(ms / 60_000).toFixed(0)}m` : `${(ms / 3_600_000).toFixed(1)}h`;

function report(problems, stats) {
  const out = [];
  const p = (s = "") => out.push(s);

  // Group by file, because one stale h.js across forty servers is one problem,
  // not forty, and printing it forty times buries the other three.
  const byFile = new Map();
  for (const prob of problems) {
    const key = `${prob.kind}\u0000${prob.file}\u0000${prob.diskHash ?? ""}\u0000${prob.gameHash ?? ""}`;
    if (!byFile.has(key)) byFile.set(key, { ...prob, hosts: [] });
    byFile.get(key).hosts.push(prob.host);
  }
  // home first — it is the source every other copy is made from.
  const groups = [...byFile.values()].sort(
    (a, b) => Number(b.hosts.includes("home")) - Number(a.hosts.includes("home")) || a.file.localeCompare(b.file),
  );

  p(bold(red(`verify-deploy: OUT OF SYNC`)) + dim(`  —  ${problems.length} problem(s) over ${stats.servers} server(s)`));
  p();
  for (const g of groups) {
    const where = g.hosts.length > 3 ? `${g.hosts.slice(0, 3).join(", ")} +${g.hosts.length - 3} more` : g.hosts.join(", ");
    if (g.kind === "missing") {
      p(`  ${red("MISSING IN GAME")}  ${bold(g.file)}  ${dim(`on ${where}`)}`);
      p(`      disk ${g.diskHash} ${g.diskBytes}B, saved ${age(g.ageMs)} ago — the game has no copy at all`);
    } else if (g.kind === "orphan") {
      p(`  ${yellow("IN GAME ONLY")}     ${bold(g.file)}  ${dim(`on ${where}`)}`);
      p(`      game ${g.gameHash} ${g.gameBytes}B, nothing on disk — deleted from the repo but still live`);
    } else {
      p(`  ${red("DIFFERS")}          ${bold(g.file)}  ${dim(`on ${where}`)}`);
      p(`      disk ${g.diskHash} ${g.diskBytes}B (saved ${age(g.ageMs)} ago)  vs  game ${g.gameHash} ${g.gameBytes}B`);
      if (g.diff) {
        p(`      first difference, line ${g.diff.line}:`);
        p(`        ${dim("disk")}  ${g.diff.disk}`);
        p(`        ${dim("game")}  ${g.diff.game}`);
      } else {
        p(`      differs only in trailing whitespace`);
      }
    }
    p();
  }
  const homeBad = groups.some((g) => g.hosts.includes("home"));
  p(dim(`  fix: ${homeBad ? "curl -s localhost:12526/sync" : "curl -s localhost:12526/sync   (re-pushes home and propagates to every copy)"}`));
  p(dim(`  then re-run this. A running script keeps its old code until killed — see CLAUDE.md.`));
  return out.join("\n");
}

/* ------------------------------------------------------------------- main */

async function run() {
  const started = Date.now();

  let status;
  try {
    const res = await fetch(`${CTL}/status`, { signal: AbortSignal.timeout(5_000) });
    status = await res.json();
  } catch (e) {
    throw new CheckError(`control port ${CTL} unreachable (${e.message}) — is \`npm run daemon\` up?`);
  }
  if (!status.connected) {
    throw new CheckError("daemon is up but the game is not connected — reconnect in Options → Remote API, port 12525");
  }

  const tracked = trackedFiles();
  const hosts = await discoverHosts();
  const results = await pool(hosts, OPTS.concurrency, async (host) => {
    try {
      return await checkServer(host, tracked);
    } catch (e) {
      // A server deleted since the save was written is not a deploy failure.
      if (/Invalid hostname/i.test(e.message)) return { host, fileCount: 0, problems: [], gone: true };
      throw e;
    }
  });

  const problems = results.flatMap((r) => r.problems);
  const stats = {
    tracked: tracked.length,
    servers: results.filter((r) => !r.gone).length,
    serversWithCopies: results.filter((r) => r.problems.length || r.fileCount).length,
    ms: Date.now() - started,
  };
  return { problems, stats, results };
}

let attempt = 0;
let outcome;
for (;;) {
  try {
    outcome = await run();
  } catch (e) {
    if (e instanceof CheckError) {
      console.error(bold(red("verify-deploy: CANNOT VERIFY")) + `  ${e.message}`);
      process.exit(2);
    }
    throw e;
  }
  // A push may have been in flight when we looked. Retrying costs a round trip
  // and removes the only false positive this tool can produce.
  if (!outcome.problems.length || attempt++ >= OPTS.retry) break;
  await new Promise((r) => setTimeout(r, OPTS.retryDelay));
}

const { problems, stats } = outcome;

if (OPTS.json) {
  console.log(JSON.stringify({ ok: !problems.length, ...stats, problems }, null, 2));
} else if (problems.length) {
  console.error(report(problems, stats));
} else if (!OPTS.quiet) {
  console.log(
    green("verify-deploy: in sync") +
      dim(`  —  ${stats.tracked} tracked files vs ${stats.servers} server(s), ${stats.ms}ms`),
  );
}

process.exit(problems.length ? 1 : 0);
