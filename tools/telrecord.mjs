// The daemon's APPEND-ONLY run record: what tools/rfa-daemon.mjs writes to
// .telemetry/ besides the overwrite-in-place mirror of /tel/*.txt.
//
// Kept free of side effects on import so tools/test/telrecord.test.mjs can drive
// it against a scratch directory without starting a daemon.
//
// WHY (node review, 2026-10-23). Every /tel/*.txt is overwritten each pass, so
// the game keeps only the latest state of anything. A node review could not say
// what Bladeburner was doing an hour ago (bladeburner.txt's `samples` cover the
// last hour), what the sleeves did, what route and exit the plan held over the
// node, or what the plan expected when the node was entered. decisions.jsonl and
// installs.jsonl had answered part of that until 09-17 — they were written by
// tools/dash.mjs, a dashboard nobody restarted, so they stopped silently. The
// writers now live here, inside the always-on systemd service.
//
//   history.jsonl    (existing) the save digest every SAVE_FILE_MS; now also
//                    `bladeburner`, `sleeves`, lastNodeReset/lastAugReset
//   run.jsonl        one row per telemetry poll (30s): Bladeburner actor/rank/
//                    action/black ops/stamina/slot, sleeve tasks, route, exit
//   decisions.jsonl  a row when a DECISION changes (installgate, factionplan,
//                    progress) — the signature fields only, never the whole body
//   installs.jsonl   a row per install (lastAugReset moved), with the augs added
//   events.jsonl     node-entry (node, SFs, time, the plan's estimate),
//                    node-plan (the first in-node exit estimate), daemon
//                    start/stop and SLEEP GAPS (the machine was suspended)
//
// BOUNDED: the sample files are thinned when they pass a cap (thinJsonl): the
// newest `keepBytes` stay intact and every k-th older line is kept, so the long
// history survives at lower density. Event files are tiny and never thinned.

import fs from "node:fs";
import path from "node:path";

export const CAPS = {
  "history.jsonl": { maxBytes: 64e6, keepBytes: 24e6 },
  "run.jsonl": { maxBytes: 32e6, keepBytes: 12e6 },
  "decisions.jsonl": { maxBytes: 16e6, keepBytes: 8e6 },
};

/* ---------------------------------------------------------------- the save */

const num = (x, d = 2) => (typeof x === "number" && Number.isFinite(x) ? +x.toFixed(d) : x ?? null);

/** Bladeburner from PlayerSave.data.bladeburner — authoritative whichever script acts. */
export function bladeburnerOfSave(p) {
  const b = p?.bladeburner?.data ?? p?.bladeburner;
  if (!b || typeof b !== "object") return null;
  return {
    rank: num(b.rank),
    stamina: num(b.stamina),
    maxStamina: num(b.maxStamina),
    action: b.action?.type ? `${b.action.type}/${b.action.name ?? ""}` : null,
    actionTime: [num(b.actionTimeCurrent, 1), num(b.actionTimeToComplete, 1)],
    city: b.city ?? null,
    blackOpsDone: b.numBlackOpsComplete ?? null,
    skillPoints: b.skillPoints ?? null,
    teamSize: b._teamSize ?? b.teamSize ?? null,
  };
}

/** One short string per sleeve: work type plus its target (faction, crime, class, action). */
export function sleeveTaskOf(work) {
  if (!work) return "idle";
  const d = work.data ?? work;
  const type = d.type ?? String(work.ctor ?? "?").replace(/^Sleeve|Work$/g, "");
  const target =
    d.factionName ?? d.crimeType ?? d.companyName ?? d.classType ?? d.actionId?.name ?? d.actionName ?? null;
  const how = d.factionWorkType ?? null;
  return [type, target, how].filter((x) => x != null && x !== "").join(":");
}

export function sleevesOfSave(p) {
  if (!Array.isArray(p?.sleeves)) return null;
  return p.sleeves.map((s) => {
    const d = s?.data ?? s ?? {};
    return { task: sleeveTaskOf(d.currentWork), sync: num(d.sync, 1), shock: num(d.shock, 1) };
  });
}

/* ------------------------------------------------------ the /tel mirror files */

const parse = (text) => {
  if (text == null) return null;
  try {
    return typeof text === "string" ? JSON.parse(text) : text;
  } catch {
    return null;
  }
};
const ageMin = (at, nowMs) => {
  const t = Date.parse(at ?? "");
  return Number.isFinite(t) ? (nowMs - t) / 60000 : Infinity;
};

/**
 * Which Bladeburner actor is acting: bladeburner.js (the full daemon) or
 * bb-lite.js. A file whose health is "stopped" or which has not been written for
 * `staleMin` is not acting; both can be stale ("none").
 */
export function bbActorOf(bb, lite, nowMs, staleMin = 10) {
  const live = (f) => f && f.health !== "stopped" && !f.exited && ageMin(f.at, nowMs) <= staleMin;
  if (live(bb)) return "bladeburner.js";
  if (live(lite)) return "bb-lite.js";
  return "none";
}

/** files: { "bladeburner.txt": text, ... } — the mirror's contents this poll. */
export function runRecord(files, nowMs = Date.now()) {
  const bb = parse(files["bladeburner.txt"]);
  const lite = parse(files["bb-lite.txt"]);
  const sl = parse(files["sleeve.txt"]);
  const pr = parse(files["progress.txt"]);
  const pl = parse(files["plan.txt"]);
  const actor = bbActorOf(bb, lite, nowMs);
  const src = actor === "bb-lite.js" ? lite : bb;
  const rec = { at: new Date(nowMs).toISOString() };
  if (bb || lite)
    rec.bb = {
      actor,
      health: { full: bb?.health ?? null, lite: lite?.health ?? null },
      at: src?.at ?? null,
      rank: num(src?.rank ?? bb?.rank),
      rankPerHour: num(bb?.rankPerHour, 1),
      action: bb?.action?.name
        ? `${bb.action.type}/${bb.action.name}${bb.action.level ? ` L${bb.action.level}` : ""}${bb.action.city ? ` @${bb.action.city}` : ""}`
        : src?.result ?? null,
      blackOps: bb?.blackOps ? { done: bb.blackOps.done ?? null, next: bb.blackOps.next ?? null } : null,
      stamina: bb?.stamina != null ? [num(bb.stamina), num(bb.maxStamina)] : null,
      slot: bb?.slot ? { owner: bb.slot.owner ?? null, simulacrum: !!bb.slot.simulacrum, ours: bb.slot.ours ?? null } : null,
      resting: bb?.resting ?? null,
    };
  if (sl)
    rec.sleeves = {
      objective: sl.objective ?? null,
      tasks: Array.isArray(sl.assigned) ? sl.assigned.map((a) => a?.task ?? null) : null,
      health: sl.health ?? null,
    };
  if (pr) {
    rec.route = pr.route
      ? { route: pr.route.route ?? null, priced: pr.route.priced ?? null, pinned: !!pr.route.pinned, held: pr.route.held ?? null }
      : null;
    rec.slot = pr.slot?.owner ?? null;
  }
  if (pl)
    rec.plan = {
      node: pl.node ?? null,
      health: pl.health ?? null,
      ver: pl.ver ?? null,
      decidedAt: pl.decidedAt ?? null,
      exit: pl.exit
        ? { meanH: num(pl.exit.meanH, 3), q10: num(pl.exit.q10, 3), q50: num(pl.exit.q50, 3), q90: num(pl.exit.q90, 3), source: pl.exit.source ?? null }
        : null,
    };
  return rec;
}

/* ------------------------------------------------------------- decisions */

// The signature says WHETHER a decision changed; timestamps and numbers are
// masked so a rewrite with a new clock or a ticking dollar figure is not a
// change. The row carries the real values. (tools/dash.mjs logged the whole
// body on every signature change: 10MB in four days, mostly factionplan's
// untilRep ticking down.)
const mask = (v) =>
  JSON.stringify(v ?? null)
    .replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, "T")
    .replace(/\d[\d,.]*/g, "#");

export const DECISIONS = {
  "installgate.txt": (d) => ({
    sig: mask([d.install, d.why, d.queued]),
    row: { install: d.install, why: d.why, queued: d.queued, M: d.M, Meff: d.Meff, favorGain: d.favorGain, goBonusPct: d.goBonusPct },
  }),
  "factionplan.txt": (d) => ({
    sig: JSON.stringify([d.workingFaction ?? null, (d.segments ?? []).map((g) => g.faction)]),
    row: { workingFaction: d.workingFaction ?? null, segments: (d.segments ?? []).map((g) => [g.faction, Math.round(g.untilRep ?? 0)]) },
  }),
  "progress.txt": (d) => ({ sig: mask([d.did, d.todo]), row: { did: d.did, todo: d.todo } }),
};

/** Rows for decisions whose signature changed since `last` (mutated). First sight only primes. */
export function decisionRows(files, last, nowMs = Date.now()) {
  const rows = [];
  for (const [name, sign] of Object.entries(DECISIONS)) {
    const d = parse(files[name]);
    if (!d) continue;
    let s;
    try {
      s = sign(d);
    } catch {
      continue;
    }
    if (last[name] !== undefined && last[name] !== s.sig)
      rows.push({ at: new Date(nowMs).toISOString(), source: name.replace(/\.txt$/, ""), fileAt: d.at ?? null, ...s.row });
    last[name] = s.sig;
  }
  return rows;
}

/* ----------------------------------------------------------- installs, nodes */

const augNames = (d) => (d?.augmentations ?? []).map(String);

/** An install moved lastAugReset. `prev` is the previous digest (may come from history.jsonl's last line). */
export function installRow(prev, cur) {
  if (!prev || !cur || prev.lastAugReset == null || cur.lastAugReset == null) return null;
  if (prev.lastAugReset === cur.lastAugReset) return null;
  const before = new Set(augNames(prev));
  return {
    at: cur.at,
    resetAt: new Date(cur.lastAugReset).toISOString(),
    node: cur.bitNode,
    nodeChanged: prev.bitNode !== cur.bitNode || prev.lastNodeReset !== cur.lastNodeReset,
    added: augNames(cur).filter((a) => !before.has(a)),
    augCount: augNames(cur).length,
    queuedBefore: prev.queuedAugmentations ?? null,
    moneyBefore: prev.money ?? null,
    hackingBefore: prev.skills?.hacking ?? null,
    hackingAfter: cur.skills?.hacking ?? null,
    prevSampleAt: prev.at ?? null,
  };
}

export const nodeKeyOf = (d) => (d?.bitNode != null && d?.lastNodeReset != null ? `${d.bitNode}@${d.lastNodeReset}` : null);

export function sfMapOf(sourceFiles) {
  const data = Array.isArray(sourceFiles) ? sourceFiles : sourceFiles?.data ?? null;
  if (Array.isArray(data)) return Object.fromEntries(data);
  return sourceFiles && typeof sourceFiles === "object" ? sourceFiles : null;
}

/**
 * The node-entry record. `nextNode` is the repo's next-node.txt (plan.mjs's order,
 * solved when the previous node was in progress), `plan` /tel/plan.txt — whose
 * exit is only this node's when plan.node matches (it survives a node entry).
 */
export function nodeEntryRow(d, nextNode, plan, { firstSight = false } = {}) {
  const planHere = plan && plan.node === d.bitNode && plan.exit;
  return {
    at: d.at,
    kind: "node-entry",
    key: nodeKeyOf(d),
    node: d.bitNode,
    enteredAt: new Date(d.lastNodeReset).toISOString(),
    // The daemon was not running at the entry: the row is late, not the entry.
    firstSight,
    sourceFiles: sfMapOf(d.sourceFiles),
    totalPlaytime: d.totalPlaytime ?? null,
    nextNode: nextNode ?? null,
    // Did the order solved in the PREVIOUS node name this one? Unknown (null) once next-node.txt
    // has been re-solved inside this node (`from` = this node).
    predicted: nextNode && nextNode.from !== d.bitNode ? nextNode.next === d.bitNode : null,
    planEstimate: planHere
      ? { meanH: plan.exit.meanH, q10: plan.exit.q10, q50: plan.exit.q50, q90: plan.exit.q90, source: plan.exit.source, decidedAt: plan.decidedAt ?? null }
      : null,
    planNode: plan?.node ?? null,
  };
}

/* -------------------------------------------------------------- the files */

export function appendJsonl(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + "\n");
}

/** The last complete JSON line of a file, read from its tail only (history.jsonl is large). */
export function lastJsonLine(file, tailBytes = 256 * 1024) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const n = Math.min(size, tailBytes);
    const buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, size - n);
    const lines = buf.toString("utf8").trimEnd().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(lines[i]);
      } catch {
        /* a partial first line, or a torn last one */
      }
    }
  } catch {
    /* absent */
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return null;
}

export function readJsonl(file) {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Thin a jsonl past `maxBytes`: lines in the newest `keepBytes` are kept, older
 * ones 1 in `stride` (chosen so the old part shrinks to ~keepBytes/2). Chunked,
 * synchronous (no append can interleave in this process), temp + rename.
 * Returns null when under the cap, else { before, after, stride }.
 */
export function thinJsonl(file, { maxBytes, keepBytes }) {
  let size;
  try {
    size = fs.statSync(file).size;
  } catch {
    return null;
  }
  if (size <= maxBytes) return null;
  const cut = size - keepBytes;
  const stride = Math.max(2, Math.ceil(cut / (keepBytes / 2)));
  const tmp = `${file}.thin.${process.pid}`;
  const fdIn = fs.openSync(file, "r");
  const fdOut = fs.openSync(tmp, "w");
  try {
    const CHUNK = 4 * 1024 * 1024;
    const buf = Buffer.alloc(CHUNK);
    let carry = Buffer.alloc(0);
    let pos = 0; // file offset of carry[0]
    let idx = 0;
    for (;;) {
      const n = fs.readSync(fdIn, buf, 0, CHUNK, pos + carry.length);
      const data = n ? Buffer.concat([carry, buf.subarray(0, n)]) : carry;
      let start = 0;
      let nl;
      while ((nl = data.indexOf(10, start)) !== -1) {
        const lineStart = pos + start;
        if (lineStart >= cut || idx % stride === 0) fs.writeSync(fdOut, data, start, nl + 1 - start);
        idx++;
        start = nl + 1;
      }
      pos += start;
      carry = Buffer.from(data.subarray(start));
      if (!n) {
        if (carry.length) fs.writeSync(fdOut, carry); // a torn last line: keep it
        break;
      }
    }
  } finally {
    fs.closeSync(fdIn);
    fs.closeSync(fdOut);
  }
  fs.renameSync(tmp, file);
  return { before: size, after: fs.statSync(file).size, stride };
}

/* ----------------------------------------------------------- the recorder */

/**
 * The daemon's hooks. Every method swallows its own errors into `log`: the run
 * record must never break the poll — but a failure is logged, never silent.
 */
export class RunRecorder {
  constructor({ dir, root, log = () => {}, gapMs = 90_000 }) {
    this.dir = dir;
    this.root = root;
    this.log = log;
    this.gapMs = gapMs;
    this.lastDecision = {};
    this.prevDigest = null;
    this.lastRun = null;
    this.events = readJsonl(this.f("events.jsonl"));
    const entries = this.events.filter((e) => e.kind === "node-entry");
    this.nodeKey = entries.length ? entries[entries.length - 1].key : null;
    this.planned = new Set(this.events.filter((e) => e.kind === "node-plan").map((e) => e.key));
    this.tick = Date.now();
  }
  f(name) {
    return path.join(this.dir, name);
  }
  event(row) {
    try {
      appendJsonl(this.f("events.jsonl"), row);
    } catch (e) {
      this.log(`run record: events.jsonl append failed: ${e.message ?? e}`);
    }
  }

  /** Daemon start: say how long nothing was recorded (a stop, a crash, a sleep). */
  start(nowMs = Date.now()) {
    const last = lastJsonLine(this.f("run.jsonl"));
    const lastAt = Date.parse(last?.at ?? "");
    const downSec = Number.isFinite(lastAt) ? Math.round((nowMs - lastAt) / 1000) : null;
    this.event({ at: new Date(nowMs).toISOString(), kind: "daemon-start", pid: process.pid, lastRunAt: last?.at ?? null, downSec });
    if (downSec != null && downSec * 1000 > this.gapMs)
      this.log(`!!! RUN RECORD GAP: nothing recorded for ${(downSec / 3600).toFixed(2)}h before this start (last run.jsonl row ${last.at}) — the daemon was down or the machine slept`);
  }
  stop(signal, nowMs = Date.now()) {
    this.event({ at: new Date(nowMs).toISOString(), kind: "daemon-stop", pid: process.pid, signal });
  }

  /** A wall-clock jump between timer ticks is a suspend/hibernate. Call every ~10s. */
  heartbeat(nowMs = Date.now()) {
    const dt = nowMs - this.tick;
    this.tick = nowMs;
    if (dt <= this.gapMs) return null;
    const row = { at: new Date(nowMs).toISOString(), kind: "sleep-gap", from: new Date(nowMs - dt).toISOString(), sec: Math.round(dt / 1000) };
    this.event(row);
    this.log(`!!! SLEEP GAP: the daemon's clock jumped ${(dt / 3600e3).toFixed(2)}h (${row.from} -> ${row.at}) — the machine was suspended; the game's socket will not survive it`);
    return row;
  }

  /** After each save digest (history.jsonl append): installs and node entries. */
  onDigest(d) {
    try {
      const prev = this.prevDigest ?? lastJsonLine(this.f("history.jsonl"));
      const ins = installRow(prev, d);
      if (ins) appendJsonl(this.f("installs.jsonl"), ins);
      const key = nodeKeyOf(d);
      if (key && key !== this.nodeKey) {
        const nextNode = parse(readOr(path.join(this.root, "next-node.txt")));
        const plan = parse(readOr(this.f("plan.txt")));
        // First sight: no entry recorded yet and the previous digest is from this same node, so the
        // entry happened before this record existed (history rows before 10-23 carry no lastNodeReset).
        const firstSight = this.nodeKey === null && (nodeKeyOf(prev) === key || (nodeKeyOf(prev) === null && prev?.bitNode === d.bitNode));
        this.event(nodeEntryRow(d, nextNode, plan, { firstSight }));
        this.nodeKey = key;
        this.log(`run record: node entry BN${d.bitNode} (${key}) logged to events.jsonl`);
      }
      this.prevDigest = d;
    } catch (e) {
      this.log(`run record: digest hooks failed: ${e.message ?? e}`);
    }
  }

  /** After each /tel mirror pass: the per-poll row, decisions, the node's first plan estimate. */
  onTelFiles(files, nowMs = Date.now()) {
    try {
      const rec = runRecord(files, nowMs);
      const node = this.nodeKey ? Number(this.nodeKey.split("@")[0]) : null;
      if (rec.plan && node != null) rec.plan.thisNode = rec.plan.node === node;
      appendJsonl(this.f("run.jsonl"), rec);
      this.lastRun = rec;
      for (const row of decisionRows(files, this.lastDecision, nowMs)) appendJsonl(this.f("decisions.jsonl"), row);
      if (this.nodeKey && rec.plan?.thisNode && rec.plan.exit && !this.planned.has(this.nodeKey)) {
        this.planned.add(this.nodeKey);
        this.event({ at: rec.at, kind: "node-plan", key: this.nodeKey, node, exit: rec.plan.exit, decidedAt: rec.plan.decidedAt, ver: rec.plan.ver });
      }
    } catch (e) {
      this.log(`run record: /tel hooks failed: ${e.message ?? e}`);
    }
  }

  /** Thin the sample files past their caps. Cheap when under (one stat each). */
  bound() {
    for (const [name, cap] of Object.entries(CAPS)) {
      try {
        const r = thinJsonl(this.f(name), cap);
        if (r) this.log(`run record: thinned ${name} ${(r.before / 1e6).toFixed(1)}MB -> ${(r.after / 1e6).toFixed(1)}MB (older lines 1 in ${r.stride})`);
      } catch (e) {
        this.log(`run record: thinning ${name} failed: ${e.message ?? e}`);
      }
    }
  }
}

function readOr(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}
