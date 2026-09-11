// Builds a simulator world from a real game save, so strategies are compared
// against this playthrough's actual randomized servers rather than the base
// data table.

import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";


const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SNAPSHOT_PATH = path.join(HERE, "snapshot.json");

const SERVER_FIELDS = [
  "hostname",
  "maxRam",
  "moneyAvailable",
  "moneyMax",
  "hackDifficulty",
  "minDifficulty",
  "baseDifficulty",
  "requiredHackingSkill",
  "serverGrowth",
  "numOpenPortsRequired",
  "hasAdminRights",
  "purchasedByPlayer",
  "cpuCores",
  "serversOnNetwork",
];

/** Pull a fresh snapshot from the running game via the daemon's control port. */
export async function fetchSnapshot(ctlPort = 12526) {
  const res = await fetch(`http://localhost:${ctlPort}/rpc`, {
    method: "POST",
    body: JSON.stringify({ method: "getSaveFile" }),
  });
  const { result, error } = await res.json();
  if (error) throw new Error(error);

  const raw = result.binary
    ? zlib.gunzipSync(Buffer.from(result.save, "latin1")).toString("utf8")
    : Buffer.from(result.save, "base64").toString("utf8");
  return snapshotFromSave(JSON.parse(raw));
}

export function snapshotFromSave(save) {
  const player = JSON.parse(save.data.PlayerSave).data;
  const allServers = JSON.parse(save.data.AllServersSave);

  const servers = [];
  for (const key of Object.keys(allServers)) {
    const s = allServers[key]?.data ?? allServers[key];
    if (!s?.hostname) continue;
    const out = {};
    for (const f of SERVER_FIELDS) out[f] = s[f];
    out.moneyAvailable ??= 0;
    out.moneyMax ??= 0;
    servers.push(out);
  }

  const home = servers.find((s) => s.hostname === "home");
  return {
    capturedAt: new Date().toISOString(),
    bitNode: player.bitNodeN,
    player: {
      money: player.money,
      hackExp: player.exp?.hacking ?? 0,
      hacking: player.skills?.hacking ?? 1,
      homeRam: home?.maxRam ?? 8,
      homeCores: home?.cpuCores ?? 1,
    },
    servers,
  };
}

/**
 * A pristine BN1 opening: level 1, $1k, 8GB home, nothing rooted. Server
 * money/security are rolled back to full so strategy comparisons all start
 * from the same untouched world.
 */
export function freshStart(snapshot) {
  const world = structuredClone(snapshot);
  world.player = { money: 1000, hackExp: 0, hacking: 1, homeRam: 8, homeCores: 1 };
  for (const s of world.servers) {
    if (s.hostname === "home") {
      s.maxRam = 8;
      s.cpuCores = 1;
      s.hasAdminRights = true;
      continue;
    }
    s.hasAdminRights = false;
    s.moneyAvailable = s.moneyMax;
    s.hackDifficulty = s.baseDifficulty ?? s.hackDifficulty;
  }
  return world;
}

export function loadSnapshot(file = SNAPSHOT_PATH) {
  if (!fs.existsSync(file)) throw new Error(`no snapshot at ${file} — run: node tools/sim/run.mjs --snapshot`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function saveSnapshot(snapshot, file = SNAPSHOT_PATH) {
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
  return file;
}


