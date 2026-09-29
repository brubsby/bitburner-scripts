// Disk-change detection for tools/rfa-daemon.mjs, plus the healthcheck's
// verdict on whether the auto-push is actually delivering.
//
// Kept free of side effects on import so tools/test/pushwatch.test.mjs can
// drive it against a scratch directory without starting a daemon.
//
// WHY THIS EXISTS (2026-09-28). go.js and objective.js edits sat undelivered
// for 20+ minutes while goplan.js edits in the same window were pushed within
// 150ms. The daemon used `fs.watch(ROOT, { recursive: true })`. On Linux, Node
// (v20+, still in v24) implements `recursive` in JS
// (lib/internal/fs/recursive_watch.js): it opens one inotify watch PER FILE,
// on that file's inode, and keys it by path. An editor/agent that saves by
// "write temp file, rename over the original" replaces the inode. Node's
// directory handler then rescans, sees the path already in its map and does not
// re-watch it, so the path's watch is left on the dead inode — the file is deaf
// for the rest of the daemon's life. Every later save, in place or atomic,
// produces no event at all. Evidence: go.js's current inode was born
// 2026-09-26 15:23:53Z, which is the exact timestamp of the last watcher push
// of go.js in the daemon log; goplan.js (inode from 09-21, edited in place)
// kept working. Reproduced in tools/test/pushwatch.test.mjs (PW1).
//
// Two independent fixes, because the second one is what makes the first
// unnecessary to trust:
//   1. DirWatcher watches DIRECTORIES, non-recursively, one per tracked
//      directory. A directory inotify watch reports children by name
//      (IN_MODIFY, IN_MOVED_TO, IN_CREATE ...), so replacing a child's inode
//      cannot orphan it.
//   2. PushLedger records what was last pushed for every file, and the daemon
//      rescans disk every few seconds against it. Anything that changed on
//      disk and was not pushed is pushed, and counted as a WATCHER MISS, loudly.
//      That scan is disk-side change detection — the watcher's job — not drift
//      repair: a file the GAME changed is never touched by it (its disk
//      signature has not moved), which keeps driftCheck's "report, never
//      repair" rule intact.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const TRACKED_EXT = /\.(js|jsx|ts|tsx|txt|script)$/;

export const contentHash = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex").slice(0, 8);

/** Cheap change screen. ino catches an atomic replace even when size and mtime collide. */
export function signature(file) {
  const st = fs.statSync(file);
  return `${st.ino}:${st.size}:${st.mtimeMs}`;
}

/* ------------------------------------------------------------ DirWatcher */

/**
 * Non-recursive fs.watch on `root` and every directory under it that
 * `skipDir(relDir)` does not reject. `onChange(relPath)` gets repo-relative
 * paths with "/" separators, for files and directories alike; filtering is the
 * caller's job.
 *
 * `sync()` re-walks the tree: it adds watchers for new directories, drops ones
 * that vanished, and replaces a watcher whose directory was itself replaced
 * (different inode) — the directory-level version of the bug above. The
 * daemon calls it from its periodic scan, so a lost watcher heals within one
 * scan interval instead of never.
 */
export class DirWatcher {
  constructor({ root, skipDir = () => false, onChange, onError = () => {} }) {
    this.root = root;
    this.skipDir = skipDir;
    this.onChange = onChange;
    this.onError = onError;
    this.watchers = new Map(); // relDir ("" = root) -> { w, ino }
    this.events = 0;
    this.lastEventAt = null;
    this.errors = 0;
    this.rewatched = 0;
  }

  #dirs(rel = "", out = []) {
    out.push(rel);
    let entries;
    try {
      entries = fs.readdirSync(path.join(this.root, rel), { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (this.skipDir(child, e.name)) continue;
      this.#dirs(child, out);
    }
    return out;
  }

  #watch(rel, ino) {
    const abs = path.join(this.root, rel);
    let w;
    try {
      w = fs.watch(abs, { persistent: true }, (_event, name) => {
        this.events++;
        this.lastEventAt = Date.now();
        if (!name) {
          // Overflow or an event without a name: we cannot tell what changed,
          // so re-walk; the ledger scan will find the file itself.
          this.sync();
          return;
        }
        const relPath = rel ? `${rel}/${name}` : String(name);
        // A directory created (or moved in) under a watched one needs its own
        // watcher before anything saved inside it can be seen.
        try {
          if (fs.statSync(path.join(this.root, relPath)).isDirectory()) this.sync();
        } catch {
          /* gone again, or a file */
        }
        this.onChange(relPath);
      });
    } catch (e) {
      this.errors++;
      this.onError(rel, e);
      return;
    }
    w.on("error", (e) => {
      this.errors++;
      this.onError(rel, e);
      w.close();
      if (this.watchers.get(rel)?.w === w) this.watchers.delete(rel);
    });
    this.watchers.set(rel, { w, ino });
  }

  sync() {
    const want = new Set(this.#dirs());
    for (const [rel, { w }] of this.watchers) {
      if (!want.has(rel)) {
        w.close();
        this.watchers.delete(rel);
      }
    }
    for (const rel of want) {
      let ino;
      try {
        ino = fs.statSync(path.join(this.root, rel)).ino;
      } catch {
        continue;
      }
      const cur = this.watchers.get(rel);
      if (cur && cur.ino === ino) continue;
      if (cur) {
        cur.w.close();
        this.rewatched++;
      }
      this.#watch(rel, ino);
    }
    return this;
  }

  close() {
    for (const { w } of this.watchers.values()) w.close();
    this.watchers.clear();
  }

  state() {
    return {
      kind: "per-directory",
      dirs: this.watchers.size,
      events: this.events,
      lastEventAt: this.lastEventAt ? new Date(this.lastEventAt).toISOString() : null,
      errors: this.errors,
      rewatched: this.rewatched,
    };
  }
}

/* ------------------------------------------------------------ PushLedger */

/**
 * What the daemon last delivered to home, per file, and what is on disk now.
 *
 * `pending()` is the honest answer to "is there anything on disk the game has
 * not been sent?" — independent of whether any watcher fired.
 */
export class PushLedger {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.files = new Map(); // remote -> { sig, hash, at }
    this.pendingSince = new Map(); // remote -> ms first seen differing
    this.lastPush = null; // { at, file, via }
    this.lastError = null; // { at, file, message }
    this.pushes = 0;
    this.misses = 0; // pushes the scan had to make because no watcher did
    this.lastMiss = null; // { at, files }
  }

  /** Record a successful push of `content` read from `local`. */
  recordPush(remote, local, content, via = "watch") {
    let sig = null;
    try {
      sig = signature(local);
    } catch {
      /* deleted between read and record */
    }
    const at = this.now();
    this.files.set(remote, { sig, hash: contentHash(content), at });
    this.pendingSince.delete(remote);
    this.lastPush = { at, file: remote, via };
    this.pushes++;
  }

  recordDelete(remote) {
    this.files.delete(remote);
    this.pendingSince.delete(remote);
  }

  recordError(remote, message) {
    this.lastError = { at: this.now(), file: remote, message: String(message) };
  }

  recordMiss(files) {
    this.misses += files.length;
    this.lastMiss = { at: this.now(), files: [...files] };
  }

  /**
   * Compare disk against what was pushed. `tracked` is [{ local, remote }].
   * Returns the files whose content differs from the last push, oldest first,
   * each with how long it has been seen differing. A signature change with
   * identical content (a touch, a no-op save) is absorbed, not reported.
   */
  scan(tracked) {
    const now = this.now();
    const out = [];
    const seen = new Set();
    for (const { local, remote } of tracked) {
      seen.add(remote);
      let sig;
      try {
        sig = signature(local);
      } catch {
        continue;
      }
      const rec = this.files.get(remote);
      if (rec && rec.sig === sig) {
        this.pendingSince.delete(remote);
        continue;
      }
      if (rec) {
        let content;
        try {
          content = fs.readFileSync(local, "utf8");
        } catch {
          continue;
        }
        if (contentHash(content) === rec.hash) {
          rec.sig = sig;
          this.pendingSince.delete(remote);
          continue;
        }
      }
      if (!this.pendingSince.has(remote)) this.pendingSince.set(remote, now);
      out.push({ local, remote, sinceMs: this.pendingSince.get(remote), ageMs: now - this.pendingSince.get(remote) });
    }
    for (const remote of this.pendingSince.keys()) if (!seen.has(remote)) this.pendingSince.delete(remote);
    return out.sort((a, b) => a.sinceMs - b.sinceMs);
  }

  state() {
    const now = this.now();
    const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
    const pend = [...this.pendingSince.entries()].sort((a, b) => a[1] - b[1]);
    return {
      lastPushAt: iso(this.lastPush?.at),
      lastPushFile: this.lastPush?.file ?? null,
      lastPushVia: this.lastPush?.via ?? null,
      pushes: this.pushes,
      pending: pend.length,
      pendingFiles: pend.slice(0, 10).map(([f]) => f),
      oldestPendingSince: iso(pend[0]?.[1]),
      oldestPendingMin: pend.length ? +((now - pend[0][1]) / 60000).toFixed(1) : 0,
      watcherMisses: this.misses,
      lastMiss: this.lastMiss ? { at: iso(this.lastMiss.at), files: this.lastMiss.files } : null,
      lastError: this.lastError ? { ...this.lastError, at: iso(this.lastError.at) } : null,
    };
  }
}

/* ------------------------------------------------------- healthcheck side */

/**
 * The healthcheck's verdict on auto-push delivery. Pure.
 *
 *   status    the daemon's /status body (may lack `push` on an old daemon)
 *   problems  /verify's problem strings ("STALE on home: go.js — disk .., game ..")
 *   firstSeen { "home:go.js": iso } persisted by the caller between runs
 *   now       ms
 *   maxMin    how long a disk/game difference may last before it is a failure
 *
 * Keyed by host+file, NOT by hash: during the incident objective.js's disk hash
 * changed four times in two minutes while the game kept the same old copy. A
 * hash-keyed clock would have restarted on every save and never fired.
 *
 * Returns { fails: [{what, detail}], notes: [string], firstSeen }.
 */
export function autoPushVerdict({ status, problems = [], firstSeen = {}, now = Date.now(), maxMin = 5 }) {
  const fails = [];
  const notes = [];
  const seen = {};
  for (const p of problems) {
    const m = /^(?:STALE|MISSING) on ([^:]+): (\S+)/.exec(p);
    if (!m) continue;
    const key = `${m[1]}:${m[2]}`;
    seen[key] = firstSeen[key] ?? new Date(now).toISOString();
  }
  const push = status?.push ?? null;
  const daemonState = push
    ? `daemon: last push ${push.lastPushFile ?? "-"} at ${push.lastPushAt ?? "never"} (${push.lastPushVia ?? "-"}), ` +
      `pending ${push.pending}${push.pending ? ` [${push.pendingFiles.join(", ")}] oldest ${push.oldestPendingMin} min` : ""}, ` +
      `watcher ${push.watcher?.kind ?? "?"} ${push.watcher?.dirs ?? "?"} dir(s) ${push.watcher?.events ?? "?"} event(s) last ${push.watcher?.lastEventAt ?? "never"}, ` +
      `misses ${push.watcherMisses}` +
      (push.lastError ? `, last error ${push.lastError.file}: ${push.lastError.message} at ${push.lastError.at}` : "")
    : "daemon publishes no push state";

  // Only home is the auto-push's job; other servers carry scp'd copies that
  // propagate() refreshes on a push but that can also go stale on their own.
  const aged = Object.entries(seen)
    .filter(([k]) => k.startsWith("home:"))
    .map(([k, iso]) => ({ file: k.slice(5), min: (now - Date.parse(iso)) / 60000 }))
    .filter((x) => x.min >= maxMin)
    .sort((a, b) => b.min - a.min);
  const pendingOld = push && push.pending > 0 && push.oldestPendingMin >= maxMin;

  if (aged.length || pendingOld) {
    const files = aged.length
      ? aged.map((x) => `${x.file} (${x.min.toFixed(0)} min)`).join(", ")
      : `${push.pendingFiles.join(", ")} (${push.oldestPendingMin} min)`;
    fails.push({
      what: `AUTO-PUSH NOT DELIVERING: disk and game have differed for >= ${maxMin} min: ${files}`,
      detail: `${daemonState} — the game is running OLD CODE; curl -s localhost:12526/sync delivers it, then find out why the push did not`,
    });
  }
  if (!push) {
    fails.push({
      what: "daemon does not report push state (/status .push)",
      detail:
        "this daemon predates the auto-push fix of 2026-09-28 — its recursive fs.watch goes deaf to a file after one atomic save; " +
        "restart it (npm run daemon) when the user allows",
    });
  } else {
    notes.push(`auto-push: ${daemonState}`);
  }
  return { fails, notes, firstSeen: seen };
}
