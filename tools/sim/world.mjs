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
  "programs",
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
      // Owned programs live on the home *server* record, not on the player.
      // Without them a --live run cannot root anything new, because
      // portsOpenable would read as zero however many openers are owned.
      programs: home?.programs ?? [],
      hasTor: servers.some((s) => s.hostname === "darkweb"),
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
  world.player.programs = [];
  world.player.hasTor = false;
  for (const s of world.servers) {
    if (s.hostname === "home") {
      s.maxRam = 8;
      s.cpuCores = 1;
      s.hasAdminRights = true;
      continue;
    }
    s.hasAdminRights = false;
    // An untouched server holds a twenty-fifth of its maximum, not all of it.
    // src/Server/Server.ts:75-77 sets moneyAvailable from the base figure in
    // the server table and moneyMax to 25x that same figure, so every server
    // in a fresh BitNode starts at 4%.
    //
    // Setting this to moneyMax made every simulated world 25x richer than a
    // real one and deleted the opening grow phase entirely — which is the
    // phase that dominates the early game. The live game spent 128 minutes
    // climbing foodnstuff from 4% to the 50% floor where early.js will hack,
    // earning nothing, while the simulator had it earning from the first
    // minute. Every comparison measured before this was fixed started from a
    // world that cannot occur.
    s.moneyAvailable = s.moneyMax / 25;
    // baseDifficulty is the starting difficulty, and minDifficulty is a third
    // of it (Server.ts:80-84), so this line is already right — a fresh server
    // sits at 3x its minimum security.
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


