// Periodic save snapshots, taken from OUTSIDE the game.
//
//   node tools/snapshot.mjs              one snapshot, then exit
//   node tools/snapshot.mjs --watch      every 20 minutes, forever
//   node tools/snapshot.mjs --keep 40    how many to retain (default 24)
//
// Why this exists, and why it replaced a rule rather than implementing one.
//
// CLAUDE.md's install procedure used to open with "back up the save", as step 1
// of an irreversible action. That is fine for a human driving, and impossible
// for the autonomous loop: no Netscript API can export a save, so an in-game
// director can never satisfy it. Leaving it as a precondition would have meant
// `autopilot.js` may never install — which is most of a playthrough.
//
// So the requirement moved instead of being dropped. Backups stop being a gate
// on the install and become a background property of the harness: snapshot on a
// clock, keep a rolling window, and the loop never waits for anything.
//
// This is free in game terms, which is the fact that makes it viable. The 24h
// export bonus is granted by `giveExportBonus()`, called inside `exportGame()`
// (SaveObject.ts:239) — the *UI* export path. The Remote File API's
// `getSaveFile` handler calls `getSaveData()` directly
// (RemoteFileAPI/MessageHandlers.ts:228-229) and never touches the bonus. So
// snapshotting every twenty minutes costs the run nothing.
//
// What it deliberately does NOT do: restore. Writing a save back into a running
// game is the one operation that can destroy a playthrough outright, and it
// should be a deliberate human act with the file in hand, not something a tool
// offers.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "backups");
const CTL = `http://localhost:${process.env.CTL_PORT ?? 12526}`;

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
};
const WATCH = argv.includes("--watch");
const KEEP = Number(flag("keep", 24));
const EVERY = Number(flag("every", 20 * 60 * 1000));

async function rpc(method) {
  const res = await fetch(`${CTL}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error}`);
  return j.result;
}

async function snapshot() {
  const result = await rpc("getSaveFile");
  const raw = zlib.gunzipSync(Buffer.from(result.save, "latin1")).toString("utf8");

  // Label the file with what it is, so a directory listing is a history rather
  // than a pile of timestamps. Pulled from the save itself, not from anything
  // this process believes.
  let label = "unknown";
  try {
    const p = JSON.parse(JSON.parse(raw).data.PlayerSave).data;
    label = `BN${p.bitNodeN}-hack${p.skills.hacking}-augs${p.augmentations.length}`;
  } catch {
    /* keep going: an unlabelled backup is worth far more than no backup */
  }

  fs.mkdirSync(DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const file = path.join(DIR, `auto-${stamp}-${label}.json.gz`);
  fs.writeFileSync(file, zlib.gzipSync(raw));

  // Rolling window. Only ever prunes files this tool wrote — the hand-taken
  // pre-install backups are named differently and are never touched, because
  // those are the ones someone chose to keep.
  const mine = fs
    .readdirSync(DIR)
    .filter((f) => f.startsWith("auto-"))
    .sort();
  const dropped = mine.slice(0, Math.max(0, mine.length - KEEP));
  for (const f of dropped) fs.rmSync(path.join(DIR, f));

  return { file: path.basename(file), bytes: fs.statSync(file).size, kept: mine.length - dropped.length, dropped: dropped.length };
}

do {
  try {
    const r = await snapshot();
    console.log(`snapshot: ${r.file} (${(r.bytes / 1024).toFixed(0)}KB) — keeping ${r.kept}${r.dropped ? `, pruned ${r.dropped}` : ""}`);
  } catch (err) {
    // Never exit the watch loop on a transient failure: the daemon restarting or
    // the game being momentarily disconnected must not silently end backups.
    console.error(`snapshot FAILED: ${err.message}`);
    if (!WATCH) process.exit(2);
  }
  if (WATCH) await new Promise((r) => setTimeout(r, EVERY));
} while (WATCH);
