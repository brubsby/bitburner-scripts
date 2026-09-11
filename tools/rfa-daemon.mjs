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
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RFA_PORT = Number(process.env.RFA_PORT ?? 12525);
const CTL_PORT = Number(process.env.CTL_PORT ?? 12526);
const TEL_DIR = process.env.TEL_DIR ?? path.join(ROOT, ".telemetry");
const SAVE_POLL_MS = Number(process.env.SAVE_POLL_MS ?? 30_000);

// Directories we never sync into the game.
const SKIP_DIRS = new Set(["node_modules", "tools", "archive", "min", ".git", ".telemetry", ".idea"]);

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

async function pushFile({ local, remote }) {
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
      const ram = await pushFile(f);
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
  return { ok, total: files.length, errors };
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
    jobs: p.jobs,
    augmentations: (p.augmentations ?? []).map((a) => a?.data?.name ?? a?.name ?? a),
    queuedAugmentations: (p.queuedAugmentations ?? []).map((a) => a?.data?.name ?? a?.name ?? a),
    sourceFiles: p.sourceFiles,
    exploits: p.exploits,
    playtimeSinceLastAug: p.playtimeSinceLastAug,
    totalPlaytime: p.totalPlaytime,
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

setInterval(pollTelemetry, SAVE_POLL_MS);

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
          });
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
