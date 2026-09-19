#!/usr/bin/env node
// Read-only snapshot of the live save's rooted money servers and player mults,
// for verify-selfcal.mjs section 7.
//
//   node tools/staging/selfcal/snap-live.mjs
//
// Uses only getSaveFile over the control port. It never pushes, never deletes
// and never restarts anything.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const res = await fetch(`http://localhost:${process.env.CTL_PORT ?? 12526}/rpc`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ method: "getSaveFile" }),
  signal: AbortSignal.timeout(30000),
});
const j = await res.json();
const raw = zlib.gunzipSync(Buffer.from(j.result.save, "latin1")).toString("utf8");
const d = JSON.parse(raw);
const p = JSON.parse(d.data.PlayerSave).data;
const all = JSON.parse(d.data.AllServersSave);
const servers = {};
for (const k of Object.keys(all)) {
  const s = all[k].data;
  if (!s.hasAdminRights || !(s.moneyMax > 0)) continue;
  servers[s.hostname] = {
    hostname: s.hostname,
    moneyMax: s.moneyMax,
    moneyAvailable: s.moneyAvailable,
    minDifficulty: s.minDifficulty,
    requiredHackingSkill: s.requiredHackingSkill,
    serverGrowth: s.serverGrowth,
  };
}
const out = {
  at: new Date().toISOString(),
  bitNode: p.bitNodeN,
  hacking: p.skills.hacking,
  intelligence: p.skills.intelligence,
  mults: p.mults,
  servers,
};
fs.writeFileSync(path.join(HERE, "live-servers.json"), JSON.stringify(out, null, 1));
console.log(
  `wrote live-servers.json: BitNode ${out.bitNode}, hacking ${out.hacking}, ${Object.keys(servers).length} rooted money servers, hacking_money ${out.mults.hacking_money}`,
);
