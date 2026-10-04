// The Go dashboard WITHOUT the daemon's route — for a daemon started before
// /go existed (it needs one restart to gain it, and a restart drops the game's
// websocket). Same module, same page, reads the game through the daemon's
// existing /rpc.
//
//   node tools/godash-serve.mjs        then open http://localhost:12528/go
//   PORT=9999 CTL=http://localhost:12526 node tools/godash-serve.mjs
//
// Hot like the daemon route: tools/godash.mjs is re-imported when it changes.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PORT = Number(process.env.PORT ?? 12528);
const CTL = process.env.CTL ?? "http://localhost:12526";
const MOD = path.join(HERE, "godash.mjs");

let connected = false;
async function rpc(method, params) {
  const r = await fetch(`${CTL}/rpc`, { method: "POST", body: JSON.stringify({ method, params }), signal: AbortSignal.timeout(5000) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j.result;
}
async function refreshConnected() {
  try {
    const r = await fetch(`${CTL}/status`, { signal: AbortSignal.timeout(3000) });
    connected = !!(await r.json()).connected;
  } catch {
    connected = false;
  }
}

const ctx = { rpc, TEL_DIR: process.env.TEL_DIR ?? path.join(ROOT, ".telemetry"), connected: () => connected, store: null };
let loaded = { mtime: 0, mod: null };
async function load() {
  const mtime = fs.statSync(MOD).mtimeMs;
  if (mtime !== loaded.mtime) {
    loaded = { mtime, mod: await import(`${pathToFileURL(MOD).href}?v=${mtime}`) };
    ctx.store ??= loaded.mod.newStore();
  }
  return loaded.mod;
}

await refreshConnected();
setInterval(refreshConnected, 10_000).unref();
http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/") url.pathname = "/go";
      if (await (await load()).handle(req, url, res, ctx)) return;
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("try /go");
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(e.stack ?? e));
    }
  })
  .listen(PORT, () => console.log(`go dashboard: http://localhost:${PORT}/go (game via ${CTL})`));
