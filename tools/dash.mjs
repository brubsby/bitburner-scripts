// A dense live dashboard for the run. Read-only, and deliberately NOT part of
// the RFA daemon.
//
//   node tools/dash.mjs            then open http://localhost:12527
//   PORT=9999 node tools/dash.mjs
//
// WHY THIS IS A SEPARATE PROCESS.
//
// Everything here could have been another endpoint on tools/rfa-daemon.mjs,
// which already polls the save. But that daemon holds the game's websocket, and
// restarting it drops the connection — the game then needs a MANUAL reconnect
// through Options -> Remote API, which no script can do. Any change to that
// file costs a human interruption. A dashboard is exactly the kind of thing
// that gets iterated on twenty times in an afternoon, so it lives out here and
// talks to the daemon through its existing HTTP control port. Nothing in this
// file can take the game offline.
//
// TWO SPEEDS, because the two kinds of data cost different amounts.
//
//   deep  (30s)  the whole save via getSaveFile: ~1.1MB, gunzipped and parsed.
//                Every server, every running script, the player, factions, Go.
//                This is where nearly all the information is, and it is far too
//                expensive to pull every second on the machine that is also
//                running the game.
//   fast  (2s)   /tel/fast.txt, a few hundred bytes written by fast.js, which
//                carries the numbers whose staleness is actually felt: money,
//                level, income, home RAM.
//   files (5s)   the other /tel/*.txt a script publishes — batch, go, watchdog,
//                installgate and so on.
//
// The page then refreshes off this process's cache once a second, so it feels
// live without any of that cost reaching the game.
//
// STALENESS IS DISPLAYED, NEVER HIDDEN. Every panel carries the age of the data
// behind it. A dashboard whose numbers freeze while still looking authoritative
// is worse than no dashboard — it is the "silent failure" case from CLAUDE.md
// in visual form, so each source publishes its own `ageMs` and the page marks
// anything stale rather than rendering a stale number as a live one.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEL = path.join(REPO, ".telemetry");
const CTL = Number(process.env.CTL_PORT ?? 12526);
const PORT = Number(process.env.PORT ?? 12527);

const DEEP_MS = Number(process.env.DEEP_MS ?? 30000);
const FAST_MS = Number(process.env.FAST_MS ?? 2000);
const FILES_MS = Number(process.env.FILES_MS ?? 5000);

const log = (...a) => console.log(`[dash ${new Date().toISOString().slice(11, 19)}]`, ...a);

/* ------------------------------------------------------------------ the daemon */

async function rpc(method, params = {}) {
  const r = await fetch(`http://127.0.0.1:${CTL}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  if (!r.ok) throw new Error(`${method}: HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error}`);
  return j.result;
}

/** The save is a reviver tree: each section is itself a JSON string. */
function section(save, name) {
  try {
    const v = save?.data?.[name];
    return typeof v === "string" ? JSON.parse(v) : v;
  } catch {
    return undefined;
  }
}

/* -------------------------------------------------------------- the wide digest */

/**
 * Everything worth showing, pulled out of one save.
 *
 * Deliberately wider than the daemon's own digest(), which keeps a dozen
 * scalars. The two facts most worth having are the ones it drops: per-script
 * `onlineMoneyMade`/`onlineExpGained` (so income can be attributed to the
 * script that earned it) and `moneySourceA/B` (the game's own breakdown of
 * where money came from, by category, which no amount of differencing a balance
 * can reconstruct).
 */
function deepDigest(save) {
  const p = section(save, "PlayerSave")?.data ?? {};
  const servers = section(save, "AllServersSave") ?? {};
  const go = section(save, "GoSave") ?? {};
  const factions = section(save, "FactionsSave") ?? {};

  const hosts = [];
  const scripts = [];
  let rooted = 0;
  let contracts = 0;
  let fleetMax = 0;
  let fleetUsed = 0;

  for (const key of Object.keys(servers)) {
    const s = servers[key]?.data ?? servers[key];
    if (!s || typeof s !== "object" || !s.hostname) continue;

    // Used RAM is not stored; it is the sum of what the running scripts hold.
    //
    // THIS UNDERCOUNTS, STRUCTURALLY, AND THE FLEET PANEL MUST NOT TRUST IT.
    // BaseServer.ts:301-313 omits every RunningScript with `temporary: true`
    // from the save, and batch.js execs all of its workers that way
    // (batch.js:1502, 1791). So the batcher's threads — which are essentially
    // the entire fleet load — are invisible here by construction. Measured:
    // this path reported 91GB of 3,356 (3%) while batch.js's own telemetry
    // reported 546 of 612 (89.3%) at the same instant.
    //
    // What survives is the RESIDENT stack (daemons and jobs, which are not
    // temporary), so this number is still meaningful — it is just a different
    // number than "fleet utilisation", and the page labels it as such.
    let used = 0;
    for (const entry of s.runningScripts ?? []) {
      const r = entry?.data ?? entry;
      if (!r) continue;
      const ram = (r.ramUsage ?? 0) * (r.threads ?? 1);
      used += ram;
      scripts.push({
        filename: r.filename,
        server: s.hostname,
        threads: r.threads ?? 1,
        ram,
        args: r.args ?? [],
        money: r.onlineMoneyMade ?? 0,
        exp: r.onlineExpGained ?? 0,
        uptime: r.onlineRunningTime ?? 0,
      });
    }

    if (s.hasAdminRights) rooted++;
    contracts += (s.contracts ?? []).length;
    // Only ROOTED hosts count toward the fleet. Including the other 60-odd
    // servers put the denominator at 3,356GB against batch.js's 612GB and made
    // a busy fleet render as 3% utilised.
    if (s.hasAdminRights) {
      fleetMax += s.maxRam ?? 0;
      fleetUsed += used;
    }

    hosts.push({
      host: s.hostname,
      maxRam: s.maxRam ?? 0,
      used,
      root: !!s.hasAdminRights,
      backdoor: !!s.backdoorInstalled,
      bought: !!s.purchasedByPlayer,
      money: s.moneyAvailable ?? 0,
      moneyMax: s.moneyMax ?? 0,
      sec: s.hackDifficulty ?? 0,
      minSec: s.minDifficulty ?? 0,
      req: s.requiredHackingSkill ?? 0,
      ports: s.numOpenPortsRequired ?? 0,
      contracts: (s.contracts ?? []).length,
    });
  }

  // Per-script rates. onlineMoneyMade is cumulative for the life of the
  // process, so dividing by its own uptime gives the average that process has
  // actually achieved — which is what you want when comparing two earners.
  for (const s of scripts) {
    s.moneyPerSec = s.uptime > 0 ? s.money / s.uptime : 0;
    s.expPerSec = s.uptime > 0 ? s.exp / s.uptime : 0;
  }
  scripts.sort((a, b) => b.moneyPerSec - a.moneyPerSec || b.ram - a.ram);
  hosts.sort((a, b) => b.maxRam - a.maxRam);

  return {
    at: Date.now(),
    player: {
      bitNode: p.bitNodeN,
      money: p.money,
      skills: p.skills ?? {},
      exp: p.exp ?? {},
      mults: p.mults ?? {},
      karma: p.karma,
      city: p.city,
      location: p.location,
      focus: p.focus,
      currentWork: p.currentWork ?? null,
      factions: p.factions ?? [],
      invitations: p.factionInvitations ?? [],
      // FULL objects, with levels. The RFA daemon's own digest stores
      // augmentation NAMES only, which makes every NeuroFlux level invisible —
      // and NeuroFlux is most of what installs actually buy. Reconstructing
      // "what did that install purchase?" from name-only history reported seven
      // of twelve installs as having bought NOTHING, which was false.
      augs: p.augmentations ?? [],
      queuedAugs: p.queuedAugmentations ?? [],
      sourceFiles: p.sourceFiles ?? {},
      lastAugReset: p.lastAugReset,
      lastNodeReset: p.lastNodeReset,
      playtimeSinceLastAug: p.playtimeSinceLastAug,
      totalPlaytime: p.totalPlaytime,
      // The game's own attribution of where money came from. `A` is this life,
      // `B` is all time (PlayerObject: moneySourceA is reset on install).
      moneySourceA: p.moneySourceA ?? null,
      moneySourceB: p.moneySourceB ?? null,
      scriptProd: p.scriptProdSinceLastAug,
      hacknet: (p.hacknetNodes ?? []).length,
      sleeves: (p.sleeves ?? []).length,
      hasTor: !!p.hasTorRouter,
    },
    fleet: { rooted, total: hosts.length, maxRam: fleetMax, usedRam: fleetUsed, contracts },
    hosts,
    scripts,
    go: go?.currentGame ?? null,
    factions,
  };
}

/* ------------------------------------------------------------------- the cache */

const cache = {
  deep: null,
  deepAt: 0,
  deepError: null,
  fast: null,
  fastAt: 0,
  fastError: null,
  files: {},
  filesAt: 0,
  history: [],
};

async function pollDeep() {
  try {
    const raw = await rpc("getSaveFile");
    const text = raw.binary
      ? zlib.gunzipSync(Buffer.from(raw.save, "latin1")).toString("utf8")
      : Buffer.from(raw.save, "base64").toString("utf8");
    const next = deepDigest(JSON.parse(text));
    // INSTALL AUDIT TRAIL. An install is irreversible and its justification is
    // only checkable afterwards, so record the augmentation set WITH LEVELS
    // whenever it changes. One line per change, not per poll, so the file stays
    // small and every row is an event rather than a sample.
    try {
      const sig = (a) => (a ?? []).map((x) => `${x.name}@${x.level ?? 1}`).sort().join("|");
      if (cache.deep && sig(cache.deep.player.augs) !== sig(next.player.augs)) {
        fs.appendFileSync(
          path.join(TEL, "installs.jsonl"),
          JSON.stringify({
            at: new Date().toISOString(),
            before: cache.deep.player.augs,
            after: next.player.augs,
            moneyBefore: cache.deep.player.money,
            hackingBefore: cache.deep.player.skills?.hacking,
            hackingAfter: next.player.skills?.hacking,
            multBefore: cache.deep.player.mults?.hacking,
            multAfter: next.player.mults?.hacking,
          }) + "\n",
        );
      }
    } catch {
      /* the audit trail must never break the poll */
    }
    cache.deep = next;
    cache.deepAt = Date.now();
    cache.deepError = null;
  } catch (e) {
    // Keep the last good value AND record the failure. Dropping to null would
    // blank the page, which reads as "nothing is happening" rather than as
    // "the poll is broken" — a different and much more misleading claim.
    cache.deepError = String(e.message ?? e);
  }
}

async function pollFast() {
  try {
    const txt = await rpc("getFile", { server: "home", filename: "/tel/fast.txt" });
    cache.fast = JSON.parse(txt);
    cache.fastAt = Date.now();
    cache.fastError = null;
  } catch (e) {
    cache.fastError = String(e.message ?? e);
  }
}

/**
 * Decisions worth a HISTORY, and the signature that says one changed.
 *
 * Every /tel/*.txt is overwritten in place, so the game keeps only the latest
 * state of anything. That is fine for "is it healthy right now" and useless for
 * "why did it do that" — and the most consequential thing in the stack, the
 * install gate, is exactly the thing whose reasoning vanished. After twelve
 * installs it was not possible to answer what any of them bought or why the
 * gate held for six hours, because each pass overwrote the last.
 *
 * So changes to DECISION files are appended to .telemetry/decisions.jsonl. The
 * signature deliberately excludes timestamps: these files rewrite every pass,
 * and logging every rewrite would bury the handful of rows where something
 * actually changed. High-frequency STATE files (batch.txt and friends) are not
 * here on purpose — they are samples, not decisions, and history.jsonl already
 * covers that shape.
 */
const DECISIONS = {
  installgate: (d) => JSON.stringify([d.install, d.why, d.queued, d.M, d.Meff, d.favorGain, d.goBonusPct]),
  factionplan: (d) => JSON.stringify([d.workingFaction, (d.segments ?? []).map((g) => [g.faction, Math.round(g.untilRep)])]),
  progress: (d) => JSON.stringify([d.did, d.todo]),
};
const lastDecision = {};

/** The /tel/*.txt the daemon already mirrors to disk. Free — no game traffic. */
function pollFiles() {
  try {
    const out = {};
    for (const f of fs.readdirSync(TEL)) {
      if (!f.endsWith(".txt")) continue;
      try {
        const key = f.replace(/\.txt$/, "");
        const body = JSON.parse(fs.readFileSync(path.join(TEL, f), "utf8"));
        out[key] = { mtime: fs.statSync(path.join(TEL, f)).mtimeMs, body };

        // Append a row only when the DECISION changed, not on every rewrite.
        const sign = DECISIONS[key];
        if (sign) {
          const sig = sign(body);
          if (lastDecision[key] !== undefined && lastDecision[key] !== sig) {
            fs.appendFileSync(
              path.join(TEL, "decisions.jsonl"),
              JSON.stringify({ at: new Date().toISOString(), source: key, ...body }) + "\n",
            );
          }
          lastDecision[key] = sig;
        }
      } catch {
        /* a file mid-write, or not JSON */
      }
    }
    cache.files = out;
    cache.filesAt = Date.now();
  } catch {
    /* .telemetry may not exist yet */
  }
}

/** Tail of the daemon's history for sparklines. Cheap: last N lines only. */
function pollHistory(n = 240) {
  try {
    const p = path.join(TEL, "history.jsonl");
    if (!fs.existsSync(p)) return;
    const lines = fs.readFileSync(p, "utf8").trimEnd().split("\n").slice(-n);
    cache.history = lines
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    /* non-fatal */
  }
}

/* -------------------------------------------------------------------- the page */

// Read PER REQUEST, not once at startup.
//
// This was a module-level readFileSync, which meant every edit to dash.html
// needed a restart of this process to show up — and iteration speed is the
// entire stated reason this is not part of the RFA daemon. Caching the page
// here reintroduced exactly the friction the split was meant to remove, and did
// it silently: the server kept serving the old markup with a completely healthy
// log. The file is a few KB and this is a localhost dashboard, so re-reading it
// costs nothing worth measuring.
const PAGE_PATH = path.join(REPO, "tools/dash.html");
const page = () => fs.readFileSync(PAGE_PATH, "utf8");

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/data.json") {
      const now = Date.now();
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(
        JSON.stringify({
          now,
          deep: cache.deep,
          deepAgeMs: cache.deepAt ? now - cache.deepAt : null,
          deepError: cache.deepError,
          fast: cache.fast,
          fastAgeMs: cache.fastAt ? now - cache.fastAt : null,
          fastError: cache.fastError,
          files: cache.files,
          filesAgeMs: cache.filesAt ? now - cache.filesAt : null,
          history: cache.history,
        }),
      );
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(page());
  })
  .listen(PORT, () => log(`dashboard on http://localhost:${PORT}  (deep ${DEEP_MS}ms, fast ${FAST_MS}ms)`));

await pollDeep();
await pollFast();
pollFiles();
pollHistory();

setInterval(pollDeep, DEEP_MS);
setInterval(pollFast, FAST_MS);
setInterval(() => {
  pollFiles();
  pollHistory();
}, FILES_MS);
