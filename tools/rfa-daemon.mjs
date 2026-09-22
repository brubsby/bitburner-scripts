#!/usr/bin/env node
// Bitburner Remote File API daemon.
//
// - Serves the RFA websocket (the game connects to us) on RFA_PORT.
// - Pushes every tracked script to `home` on connect, and again whenever it
//   changes on disk (hot reload).
// - Polls the game save for telemetry and writes a digest + jsonl history.
// - Exposes a small HTTP control port so one-off RFA calls can be made from a
//   shell without stealing the websocket.

import { WebSocketServer } from "ws";
import http from "node:http";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RFA_PORT = Number(process.env.RFA_PORT ?? 12525);
const CTL_PORT = Number(process.env.CTL_PORT ?? 12526);
const TEL_DIR = process.env.TEL_DIR ?? path.join(ROOT, ".telemetry");
const SAVE_POLL_MS = Number(process.env.SAVE_POLL_MS ?? 30_000);
// Deploy drift: a cheap metadata screen runs on every telemetry poll; every
// DRIFT_FULL_EVERY polls it compares full content instead, and every
// DRIFT_SWEEP_EVERY polls it also checks the copies on other servers.
const DRIFT_FULL_EVERY = Number(process.env.DRIFT_FULL_EVERY ?? 10); // ~5 min
const DRIFT_SWEEP_EVERY = Number(process.env.DRIFT_SWEEP_EVERY ?? 20); // ~10 min

// Directories we never sync into the game.
const SKIP_DIRS = new Set(["node_modules", "tools", "variants", "archive", "min", ".git", ".telemetry", ".idea"]);

fs.mkdirSync(TEL_DIR, { recursive: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ------------------------------------------------------------------ files */

function trackedFiles(dir = ROOT, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      out.push(...trackedFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`));
    } else if (entry.name === "NetscriptDefinitions.d.ts") {
      continue; // local typing aid only — the game already has it
    } else if (/\.(js|jsx|ts|tsx|txt|script)$/.test(entry.name)) {
      out.push({ local: path.join(dir, entry.name), remote: `${prefix}${entry.name}` });
    }
  }
  return out;
}

/* -------------------------------------------------------------- rfa client */

let socket = null;
let nextId = 1;
const pending = new Map();
const ramCache = new Map();

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    if (!socket || socket.readyState !== socket.OPEN) return reject(new Error("game not connected"));
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`timeout: ${method}`));
    }, 30_000);
  });
}

/**
 * Hostnames we have seen, from the last decoded save. Used to find stale copies
 * of a script sitting on other servers.
 */
const knownHosts = new Set(["home"]);

/* ---------------------------------------------------------- verification */

// The push is not reliable. On 2026-09-12 two consecutive edits (boot.js,
// watchdog.js) never reached the game; nothing reported an error and the game
// kept running the old code, so the fix looked applied and had no effect. Twice
// that cost a debugging session. Everything below exists so that stops being
// something a human has to remember to check.
//
// Two distinct failures are covered, because they need different mechanisms:
//   1. the push ran but did not land  -> readback(), right after every push
//   2. the watcher never fired at all -> driftCheck(), on the telemetry poll
// Only (1) is visible from inside pushFile; (2) is invisible by construction,
// since the code that would notice is the code that never ran.

const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex").slice(0, 8);

function loud(lines) {
  const width = Math.max(...lines.map((l) => l.length)) + 2;
  log("!".repeat(width));
  for (const l of lines) log("! " + l);
  log("!".repeat(width));
}

/** Read a file straight back out of the game and confirm it is what we sent. */
async function readback(remote, content, server) {
  try {
    const got = await rpc("getFile", { filename: remote, server });
    if (got === content) return true;
    loud([
      `PUSH DID NOT LAND: ${remote} on ${server}`,
      `  sent ${sha(content)} (${Buffer.byteLength(content)}B), game has ${sha(got)} (${Buffer.byteLength(got)}B)`,
      `  the game is running OLD CODE for this file — curl -s localhost:12526/sync`,
    ]);
  } catch (e) {
    loud([
      `PUSH DID NOT LAND: ${remote} on ${server}`,
      `  readback failed: ${e.message ?? e}`,
      `  the game is running OLD CODE for this file — curl -s localhost:12526/sync`,
    ]);
  }
  return false;
}

/**
 * Push to home, then overwrite any copy of the same file living on another
 * server.
 *
 * Scripts get spread around in-game with `scp`, and those copies do not track
 * the original. Editing a file here updated home and left every copy stale, so
 * a supervisor restarted on another host silently came back running old code —
 * which is how a fixed `watchdog.js` kept resurrecting a retired `auto.js`, and
 * cost a debugging session to find. `/sync` had the same blind spot, so the
 * obvious way to check made the problem look absent.
 */
async function propagate(remote, content) {
  const targets = [];
  for (const host of knownHosts) {
    if (host === "home") continue;
    try {
      const names = await rpc("getFileNames", { server: host });
      if (names.includes(remote)) targets.push(host);
    } catch {
      // Server may have been deleted since the last save; skip it.
    }
  }
  for (const host of targets) {
    const sent = await rpc("pushFile", { filename: remote, content, server: host }).then(
      () => true,
      (e) => {
        log(`propagate ${remote} -> ${host} failed: ${e.message ?? e}`);
        return false;
      },
    );
    if (sent) await readback(remote, content, host);
  }
  if (targets.length) log(`  propagated ${remote} to ${targets.length} other server(s): ${targets.join(", ")}`);
  return targets.length;
}

async function pushFile({ local, remote }, { verify = true } = {}) {
  const content = fs.readFileSync(local, "utf8");
  await rpc("pushFile", { filename: remote, content, server: "home" });
  let ram = null;
  if (/\.(js|jsx|ts|tsx)$/.test(remote)) {
    ram = await rpc("calculateRam", { filename: remote, server: "home" }).catch((e) => String(e.message ?? e));
  }
  const prev = ramCache.get(remote);
  ramCache.set(remote, ram);
  const delta = typeof ram === "number" && typeof prev === "number" && ram !== prev ? ` (was ${prev}GB)` : "";
  log(`push ${remote}${typeof ram === "number" ? ` — ${ram}GB${delta}` : ram ? ` — RAM: ${ram}` : ""}`);
  // Read it straight back. A push that is ACKed and silently does nothing is
  // the failure this daemon has actually produced, and one cheap round trip
  // catches it at the moment it happens rather than two debugging sessions
  // later. syncAll passes verify:false and checks the whole set once at the end
  // instead, so a 66-file sync does not double its RPC count.
  if (verify) await readback(remote, content, "home");
  // Only scripts get copied around in-game, and only worth doing once we have
  // seen the server list at least once.
  if (/\.(js|jsx|ts|tsx)$/.test(remote) && knownHosts.size > 1) await propagate(remote, content);
  return ram;
}

async function syncAll() {
  const files = trackedFiles();
  let ok = 0;
  const errors = [];
  // Files are pushed alphabetically, so a script can land before the module it
  // imports and fail to compile. Push everything, then re-check whatever the
  // game called invalid now that its dependencies are present.
  const invalid = [];
  for (const f of files) {
    try {
      const ram = await pushFile(f, { verify: false });
      ok++;
      if (typeof ram === "string") invalid.push(f);
    } catch (e) {
      errors.push(`${f.remote}: ${e.message ?? e}`);
    }
  }
  for (const f of invalid) {
    const ram = await rpc("calculateRam", { filename: f.remote, server: "home" }).catch((e) => String(e.message ?? e));
    if (typeof ram === "number") log(`recheck ${f.remote} — ${ram}GB (deps now present)`);
    else errors.push(`${f.remote}: ${ram}`);
  }
  log(`initial sync: ${ok}/${files.length} files`);
  if (errors.length) log("sync errors:\n  " + errors.join("\n  "));
  const drift = await driftCheck({ sweepOthers: true, full: true });
  return { ok, total: files.length, errors, drift };
}

/**
 * Compare every tracked file against the game and shout about anything that
 * does not match.
 *
 * This is the half that catches a push which never happened. fs.watch can drop
 * events — and when it does, no code in the push path runs, so the push path
 * cannot notice. Only an independent periodic comparison can. It runs on the
 * telemetry poll (one extra getAllFiles per 30s) and sweeps the other servers
 * every DRIFT_SWEEP_EVERY polls, because a copy scp'd elsewhere goes stale on
 * its own schedule and home looking correct proves nothing about it.
 *
 * It reports; it never repairs. A self-healing check would hide how often the
 * push is broken, and silently rewriting files under a running game is exactly
 * the class of surprise this project does not need.
 */
let lastDriftKey = "";

async function driftCheck({ sweepOthers = false, full = false } = {}) {
  if (!socket || socket.readyState !== socket.OPEN) return null;
  const tracked = new Map(trackedFiles().map((f) => [f.remote, { local: f.local, mtime: fs.statSync(f.local).mtimeMs }]));
  const problems = [];
  const read = (remote) => fs.readFileSync(tracked.get(remote).local, "utf8");

  /** Confirm a suspicion by exact content compare, so nothing is reported on a heuristic alone. */
  const confirm = async (remote, host) => {
    const disk = read(remote);
    const got = await rpc("getFile", { filename: remote, server: host }).catch(() => null);
    if (got === null) problems.push(`MISSING on ${host}: ${remote} (disk ${sha(disk)})`);
    else if (got !== disk) problems.push(`STALE on ${host}: ${remote} — disk ${sha(disk)}, game ${sha(got)}`);
  };

  try {
    if (full) {
      const inGame = new Map((await rpc("getAllFiles", { server: "home" })).map((f) => [f.filename, f.content]));
      for (const remote of tracked.keys()) {
        const got = inGame.get(remote);
        const disk = read(remote);
        if (got === undefined) problems.push(`MISSING on home: ${remote} (disk ${sha(disk)})`);
        else if (got !== disk) problems.push(`STALE on home: ${remote} — disk ${sha(disk)}, game ${sha(got)}`);
      }
    } else {
      // getAllFiles on home moves ~2MB and costs the game's main thread
      // 150-300ms; at poll frequency that is not free. getAllFileMetadata is
      // ~34ms and is enough to *screen*: the game stamps mtime on every write
      // (Paths/FileMetadata.ts:26, set via Script.ts:38), so a disk mtime newer
      // than the game's means the game has not received the file since it was
      // last saved — which is exactly the bug. Size catches an in-game
      // overwrite. Only suspects get their content fetched and compared.
      const meta = new Map((await rpc("getAllFileMetadata", { server: "home" })).map((m) => [m.filename, m]));
      for (const [remote, f] of tracked) {
        const m = meta.get(remote);
        if (!m) problems.push(`MISSING on home: ${remote} (disk ${sha(read(remote))})`);
        else if (f.mtime > m.mtime || m.size !== Buffer.byteLength(read(remote))) await confirm(remote, "home");
      }
    }
  } catch (e) {
    log(`drift check failed: ${e.message ?? e}`);
    return null;
  }

  // Other servers only carry copies, and only a handful of files each, so the
  // name list is enough to decide what is worth fetching. Home looking correct
  // proves nothing about these — that is the second trap in CLAUDE.md.
  if (sweepOthers) {
    for (const host of knownHosts) {
      if (host === "home") continue;
      try {
        for (const name of await rpc("getFileNames", { server: host })) {
          if (tracked.has(name)) await confirm(name, host);
        }
      } catch {
        // Server deleted since the last save, or not rooted any more.
      }
    }
  }

  const key = problems.join("\n");
  if (problems.length && key !== lastDriftKey) {
    loud([
      `DEPLOY OUT OF SYNC — ${problems.length} file(s) in the game do not match disk`,
      ...problems.map((p) => "  " + p),
      `  the game is running OLD CODE — curl -s localhost:12526/sync`,
      `  detail: node tools/verify-deploy.mjs`,
    ]);
  } else if (problems.length) {
    log(`still out of sync: ${problems.length} file(s) — node tools/verify-deploy.mjs`);
  } else if (lastDriftKey) {
    log("deploy back in sync");
  }
  lastDriftKey = key;
  return problems;
}

/* -------------------------------------------------------------- telemetry */

async function decodeSave(result) {
  const raw = result.binary
    ? zlib.gunzipSync(Buffer.from(result.save, "latin1")).toString("utf8")
    : Buffer.from(result.save, "base64").toString("utf8");
  return JSON.parse(raw);
}

// The save is a reviver tree: every section is a JSON string that must be
// parsed again. Pull what we care about, defensively — schema drifts between
// game versions and a missing field must not kill the poll loop.
function digest(save) {
  const sect = (name) => {
    try {
      const v = save?.data?.[name];
      return typeof v === "string" ? JSON.parse(v) : v;
    } catch {
      return undefined;
    }
  };
  const p = sect("PlayerSave")?.data ?? {};
  const servers = sect("AllServersSave") ?? {};
  const skills = p.skills ?? {};
  const money = p.money;

  const owned = [];
  let homeRam = null;
  let homeCores = null;
  let rooted = 0;
  let totalServers = 0;
  for (const key of Object.keys(servers)) {
    const s = servers[key]?.data ?? servers[key];
    if (!s || typeof s !== "object") continue;
    totalServers++;
    // Remember rooted hosts so an edited script can be propagated to any copy
    // of it living out there — see propagate().
    if (s.hasAdminRights && s.hostname) knownHosts.add(s.hostname);
    if (s.hasAdminRights) rooted++;
    if (s.hostname === "home") {
      homeRam = s.maxRam;
      homeCores = s.cpuCores;
    } else if (s.purchasedByPlayer) {
      owned.push({ hostname: s.hostname, ram: s.maxRam });
    }
  }

  return {
    at: new Date().toISOString(),
    bitNode: p.bitNodeN,
    money,
    skills: {
      hacking: skills.hacking,
      strength: skills.strength,
      defense: skills.defense,
      dexterity: skills.dexterity,
      agility: skills.agility,
      charisma: skills.charisma,
      intelligence: skills.intelligence,
    },
    karma: p.karma,
    numPeopleKilled: p.numPeopleKilled,
    city: p.city,
    location: p.location,
    home: { ram: homeRam, cores: homeCores },
    purchasedServers: owned.sort((a, b) => b.ram - a.ram),
    servers: { rooted, total: totalServers },
    factions: p.factions,
    factionInvitations: p.factionInvitations,
    // Reputation and favor per faction, and what the player is currently
    // working on. There is no NS call for faction reputation without
    // Source-File 4, so this was being read off the Factions screen by an agent
    // with a browser — which made the one number on the critical path the most
    // expensive number to observe, and meant nothing was tracking its rate.
    // The save has it: FactionsSave, plus PlayerSave.currentWork for whether
    // the work is actually running and whether it is focused (worth 25%).
    factionRep: sect("FactionsSave")
      ? Object.fromEntries(
          Object.entries(sect("FactionsSave"))
            .map(([name, f]) => [name, f?.data ?? f])
            .filter(([, f]) => f && (f.playerReputation > 0 || f.favor > 0))
            .map(([name, f]) => [
              name,
              { rep: Math.round(f.playerReputation ?? 0), favor: Math.round(f.favor ?? 0) },
            ]),
        )
      : {},
    currentWork: p.currentWork
      ? { type: p.currentWork.ctor ?? null, faction: p.currentWork.data?.factionName ?? null }
      : null,
    focused: p.focus ?? null,
    jobs: p.jobs,
    augmentations: (p.augmentations ?? []).map((a) => a?.data?.name ?? a?.name ?? a),
    queuedAugmentations: (p.queuedAugmentations ?? []).map((a) => a?.data?.name ?? a?.name ?? a),
    sourceFiles: p.sourceFiles,
    exploits: p.exploits,
    playtimeSinceLastAug: p.playtimeSinceLastAug,
    totalPlaytime: p.totalPlaytime,
    // EXPERIENCE, not just the level. Level is logarithmic in exp, so at a
    // mature multiplier it can sit still for an hour while exp climbs steadily
    // — a movement check reading the level would call that a stall. Without
    // this field tools/healthcheck.mjs's "hacking experience has not
    // increased" test read `undefined`, skipped itself on every run, and
    // reported a pass: a check that examines nothing looks exactly like a
    // check that passed.
    exp: p.exp,
  };
}

let lastDigest = null;

async function pollTelemetry() {
  if (!socket || socket.readyState !== socket.OPEN) return;
  try {
    const result = await rpc("getSaveFile");
    const d = digest(await decodeSave(result));
    lastDigest = d;
    fs.writeFileSync(path.join(TEL_DIR, "state.json"), JSON.stringify(d, null, 2));
    fs.appendFileSync(path.join(TEL_DIR, "history.jsonl"), JSON.stringify(d) + "\n");
  } catch (e) {
    log("telemetry poll failed:", e.message ?? e);
  }
  // Anything the in-game scripts leave in /tel/ gets mirrored out to disk.
  try {
    const names = await rpc("getFileNames", { server: "home" });
    for (const name of names.filter((n) => n.startsWith("tel/"))) {
      const content = await rpc("getFile", { filename: name, server: "home" });
      const dest = path.join(TEL_DIR, name.slice(4).replace(/\//g, "_"));
      fs.writeFileSync(dest, content);
    }
  } catch {
    /* non-fatal */
  }
}

/* ----------------------------------------------------------------- server */

const wss = new WebSocketServer({ port: RFA_PORT });
log(`RFA websocket listening on ${RFA_PORT}`);

wss.on("connection", (ws) => {
  if (socket && socket.readyState === socket.OPEN) socket.close();
  socket = ws;
  log("game connected");

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error !== undefined) p.reject(new Error(String(msg.error)));
    else p.resolve(msg.result);
  });

  ws.on("close", () => {
    log("game disconnected");
    if (socket === ws) socket = null;
  });
  ws.on("error", (e) => log("ws error:", e.message));

  (async () => {
    try {
      const defs = await rpc("getDefinitionFile");
      fs.writeFileSync(path.join(ROOT, "NetscriptDefinitions.d.ts"), defs);
      log("wrote NetscriptDefinitions.d.ts");
    } catch (e) {
      log("could not fetch definitions:", e.message ?? e);
    }
    await syncAll();
    await pollTelemetry();
  })();
});

let pollCount = 0;
setInterval(async () => {
  await pollTelemetry();
  // Piggy-backed on the existing poll rather than given its own timer, so the
  // two never interleave RPCs on the same socket. The cheap metadata screen
  // runs every poll; the exact full compare and the other-server sweep are
  // rarer, because they cost the game's main thread real milliseconds.
  pollCount++;
  await driftCheck({
    sweepOthers: pollCount % DRIFT_SWEEP_EVERY === 0,
    full: pollCount % DRIFT_FULL_EVERY === 0,
  }).catch((e) => log(`drift check error: ${e.message ?? e}`));
}, SAVE_POLL_MS);

/* ------------------------------------------------------------ file watcher */

const debounce = new Map();
fs.watch(ROOT, { recursive: true }, (_event, filename) => {
  if (!filename) return;
  const rel = filename.split(path.sep).join("/");
  if (rel.split("/").some((seg) => SKIP_DIRS.has(seg)) || rel.startsWith(".")) return;
  if (!/\.(js|jsx|ts|tsx|txt|script)$/.test(rel)) return;
  if (rel === "NetscriptDefinitions.d.ts") return;

  clearTimeout(debounce.get(rel));
  debounce.set(
    rel,
    setTimeout(async () => {
      debounce.delete(rel);
      const local = path.join(ROOT, rel);
      if (!fs.existsSync(local)) {
        await rpc("deleteFile", { filename: rel, server: "home" }).then(
          () => log(`delete ${rel}`),
          (e) => log(`delete ${rel} failed: ${e.message ?? e}`),
        );
        return;
      }
      await pushFile({ local, remote: rel }).catch((e) => log(`push ${rel} failed: ${e.message ?? e}`));
    }, 150),
  );
});

/* ----------------------------------------------------------- go solver */
//
// The IPvGO search runs in its own OS process (tools/go-solver.mjs) because
// Netscript shares the browser's main thread — see that file's header. Until
// 2026-09-20 the only thing that ever started it was a human typing
// `npm run gosolver`, and on 2026-09-20 it was found to have been absent for
// the whole of a 67-hour daemon session spanning three BitNodes. Nothing
// noticed: go.js falls back to a 20ms local search and keeps reporting
// health 'ok', so the run degraded to exactly the regime the external solver
// exists to escape and said nothing.
//
// A run with no human in it cannot depend on a human starting a process, so
// the daemon owns its lifetime. This is supervision, not a one-shot spawn:
// the solver is restarted on any exit, with backoff, and killed when the
// daemon goes down so `npm run daemon` twice does not leave orphans.
//
// GO_SOLVER=0 disables it, for the case where it is being run by hand with
// different flags — two solvers answering the same /go/req.txt would race on
// `seq` and each would waste the other's work.
const GO_SOLVER = process.env.GO_SOLVER !== "0";
const GO_SOLVER_MAXMS = process.env.GO_SOLVER_MAXMS ?? "800";
const GO_SOLVER_POLL = process.env.GO_SOLVER_POLL ?? "150";
// Backoff bounds. The floor is not zero: a solver that dies instantly (a
// syntax error in golib.js, say) would otherwise spin a restart loop that is
// itself a bigger CPU cost than the search.
const SOLVER_BACKOFF_MIN_MS = 1_000;
const SOLVER_BACKOFF_MAX_MS = 60_000;
// An exit sooner than this is a failure to start rather than a crash mid-run,
// and is what escalates the backoff.
const SOLVER_HEALTHY_MS = 30_000;

const solver = { child: null, restarts: 0, startedAt: null, lastExit: null, backoffMs: SOLVER_BACKOFF_MIN_MS, stopping: false };

function startSolver() {
  if (!GO_SOLVER || solver.stopping || solver.child) return;
  const args = ["tools/go-solver.mjs", "--maxms", String(GO_SOLVER_MAXMS), "--poll", String(GO_SOLVER_POLL)];
  // The solver lowers its own scheduling priority to 19 on startup
  // (go-solver.mjs:40), so it needs no `nice` wrapper here — and wrapping it
  // would put a shell between us and the child, which would break the kill
  // on shutdown below.
  const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  solver.child = child;
  solver.startedAt = Date.now();

  const relay = (stream, tag) => {
    let buf = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) log(`${tag} ${line.trim()}`);
    });
  };
  relay(child.stdout, "gosolver:");
  relay(child.stderr, "gosolver!");

  child.on("error", (e) => log(`gosolver! spawn failed: ${e.message ?? e}`));
  child.on("exit", (code, signal) => {
    const ranMs = Date.now() - (solver.startedAt ?? Date.now());
    solver.child = null;
    solver.lastExit = { at: new Date().toISOString(), code, signal, ranMs };
    if (solver.stopping) return;
    solver.restarts++;
    // A solver that ran a healthy while and then died gets an immediate retry;
    // one that could not stay up backs off, so a permanent fault costs one log
    // line a minute rather than a busy loop.
    if (ranMs >= SOLVER_HEALTHY_MS) solver.backoffMs = SOLVER_BACKOFF_MIN_MS;
    else solver.backoffMs = Math.min(SOLVER_BACKOFF_MAX_MS, solver.backoffMs * 2);
    log(`gosolver! exited code=${code} signal=${signal} after ${(ranMs / 1000).toFixed(1)}s — restart #${solver.restarts} in ${solver.backoffMs}ms`);
    setTimeout(startSolver, solver.backoffMs).unref?.();
  });
}

function stopSolver() {
  solver.stopping = true;
  if (solver.child) solver.child.kill("SIGTERM");
}

if (GO_SOLVER) startSolver();
else log("gosolver: disabled by GO_SOLVER=0");

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    stopSolver();
    process.exit(0);
  });
}
process.on("exit", stopSolver);

/* ------------------------------------------------------------ control port */

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const send = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body, null, 2));
    };
    const body = [];
    req.on("data", (c) => body.push(c));
    req.on("end", async () => {
      try {
        if (url.pathname === "/status") {
          return send(200, {
            connected: !!socket && socket.readyState === socket.OPEN,
            tracked: trackedFiles().length,
            lastTelemetry: lastDigest?.at ?? null,
            // Published so "is the solver alive?" is answerable without ps.
            // go.js can see its own remoteMoves but not why they stopped.
            goSolver: !GO_SOLVER
              ? { enabled: false }
              : {
                  enabled: true,
                  running: !!solver.child,
                  pid: solver.child?.pid ?? null,
                  upSec: solver.child && solver.startedAt ? Math.round((Date.now() - solver.startedAt) / 1000) : 0,
                  restarts: solver.restarts,
                  lastExit: solver.lastExit,
                },
          });
        }
        // Rooted hosts from the last decoded save. The RFA has no "list
        // servers" method, so without this tools/verify-deploy.mjs has to pull
        // and gunzip the whole save just to learn where to look.
        if (url.pathname === "/hosts") return send(200, { hosts: [...knownHosts] });
        if (url.pathname === "/verify") {
          const problems = await driftCheck({ full: true, sweepOthers: !url.searchParams.has("home-only") });
          if (problems === null) return send(503, { error: "game not connected" });
          return send(problems.length ? 409 : 200, { ok: !problems.length, problems });
        }
        if (url.pathname === "/state") return send(200, lastDigest ?? {});
        if (url.pathname === "/poll") {
          await pollTelemetry();
          return send(200, lastDigest ?? {});
        }
        if (url.pathname === "/sync") return send(200, await syncAll());
        if (url.pathname === "/rpc") {
          const { method, params } = JSON.parse(Buffer.concat(body).toString() || "{}");
          return send(200, { result: await rpc(method, params) });
        }
        send(404, { error: "unknown endpoint" });
      } catch (e) {
        send(500, { error: String(e.message ?? e) });
      }
    });
  })
  .listen(CTL_PORT, () => log(`control HTTP listening on ${CTL_PORT}`));
