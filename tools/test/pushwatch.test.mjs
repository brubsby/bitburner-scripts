// [PW] The daemon's auto-push notices every save, and says so when it does not.
//
// THE BUG CLASS THIS EXISTS FOR. On 2026-09-28 edits to go.js and objective.js
// never reached the game; the healthcheck showed "STALE on home: go.js" for 20+
// minutes while goplan.js, saved in the same window, was pushed in 150ms. The
// daemon watched with `fs.watch(ROOT, { recursive: true })`, which on Linux is
// Node's JS emulation: one inotify watch per FILE inode, never re-armed when a
// save replaces the inode (write temp + rename). After one atomic save a file
// is deaf for the daemon's lifetime. Nothing errors; nothing logs.
//
//   PW1 The root cause, reproduced — and DirWatcher, its replacement, SEEN to
//       deliver every save the recursive watcher drops, including the ones
//       after an atomic replace, a new subdirectory and a replaced directory.
//   PW2 PushLedger reports disk content that was never pushed, and nothing else
//       (a touch or a same-content atomic save is not "pending").
//   PW3 autoPushVerdict() fires AUTO-PUSH NOT DELIVERING on a persistent
//       difference, keyed so a file being edited repeatedly cannot reset its
//       own clock; stays quiet on a fresh one; flags a daemon with no ledger.
//   PW4 The daemon and healthcheck are actually wired to the above.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO } from "./ram.mjs";
import { DirWatcher, PushLedger, autoPushVerdict } from "../pushwatch.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SETTLE = 250;

function atomicWrite(file, content) {
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

/** Apply `steps` to a scratch tree under a watcher and record which steps produced an event for go.js. */
async function exercise(makeWatcher, dir) {
  const got = [];
  const w = makeWatcher((rel) => got.push(rel));
  await sleep(SETTLE);
  const f = path.join(dir, "go.js");
  const heard = {};
  const step = async (name, fn) => {
    got.length = 0;
    fn();
    await sleep(SETTLE);
    heard[name] = got.includes("go.js");
  };
  await step("in-place save", () => fs.writeFileSync(f, "inplace-1"));
  await step("atomic save #1", () => atomicWrite(f, "atomic-1"));
  await step("atomic save #2", () => atomicWrite(f, "atomic-2"));
  await step("in-place save after atomic", () => fs.writeFileSync(f, "inplace-2"));
  await step("atomic save #3", () => atomicWrite(f, "atomic-3"));
  w.close();
  return heard;
}

function scratch(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `pushwatch-${tag}-`));
  fs.writeFileSync(path.join(d, "go.js"), "orig");
  return d;
}

async function pw1() {
  const c = new Check("PW1", "DirWatcher hears every save, including the ones Node's recursive fs.watch drops after an atomic replace");
  const dirs = [];
  try {
    // The root cause, so the fix is measured against the real failure and not
    // a description of it. On a platform with native recursive watching this
    // may not reproduce; that is a note, not a failure — the fix must work
    // either way.
    const d0 = scratch("recursive");
    dirs.push(d0);
    const old = await exercise((cb) => fs.watch(d0, { recursive: true }, (_e, f) => f && cb(String(f))), d0);
    const deaf = Object.entries(old).filter(([, v]) => !v).map(([k]) => k);
    c.examined(Object.keys(old).length);
    c.note(
      `fs.watch recursive on ${process.platform} node ${process.version}: ` +
        (deaf.length ? `DEAF to ${deaf.join(", ")} — the 2026-09-28 bug, reproduced` : "heard every save (bug does not reproduce here)"),
    );

    const d1 = scratch("dirwatch");
    dirs.push(d1);
    const neu = await exercise((cb) => new DirWatcher({ root: d1, onChange: cb }).sync(), d1);
    c.examined(Object.keys(neu).length);
    for (const [k, v] of Object.entries(neu)) if (!v) c.fail(`DirWatcher did not hear: ${k}`, "that save would never reach the game");
    c.note(`DirWatcher heard ${Object.values(neu).filter(Boolean).length}/${Object.keys(neu).length} saves`);

    // New subdirectory, and a directory replaced wholesale (the directory-level
    // version of the inode swap). The first is handled by the event; the
    // second by sync(), which the daemon runs every scan.
    const d2 = scratch("subdir");
    dirs.push(d2);
    const got = [];
    const w = new DirWatcher({ root: d2, skipDir: (_rel, name) => name.startsWith("."), onChange: (r) => got.push(r) }).sync();
    await sleep(SETTLE);
    fs.mkdirSync(path.join(d2, "sub"));
    await sleep(SETTLE);
    fs.writeFileSync(path.join(d2, "sub", "a.js"), "1");
    await sleep(SETTLE);
    c.examined(1);
    if (!got.includes("sub/a.js")) c.fail("a file saved in a NEW subdirectory was not heard", `events: ${got.join(", ") || "none"}`);

    fs.renameSync(path.join(d2, "sub"), path.join(d2, ".old-sub"));
    fs.mkdirSync(path.join(d2, "sub"));
    w.sync();
    await sleep(SETTLE);
    got.length = 0;
    fs.writeFileSync(path.join(d2, "sub", "b.js"), "2");
    await sleep(SETTLE);
    c.examined(1);
    if (!got.includes("sub/b.js")) c.fail("after its directory was replaced, a save inside it was not heard", `events: ${got.join(", ") || "none"}`);

    fs.mkdirSync(path.join(d2, ".hidden"));
    w.sync();
    c.examined(1);
    if (w.watchers.has(".hidden")) c.fail("skipDir was ignored: a skipped directory is being watched");
    c.note(`subdir/replace/skip: watching ${w.state().dirs} dir(s), ${w.state().rewatched} re-watched after replacement`);
    w.close();
  } finally {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
  return c;
}

async function pw2() {
  const c = new Check("PW2", "PushLedger reports disk changes that were never pushed, and only those");
  const d = scratch("ledger");
  try {
    let t = 1_000_000;
    const L = new PushLedger({ now: () => t });
    const files = [{ local: path.join(d, "go.js"), remote: "go.js" }];
    const expect = (what, want) => {
      c.examined(1);
      const got = L.scan(files).map((p) => p.remote);
      if (JSON.stringify(got) !== JSON.stringify(want)) c.fail(`${what}: pending ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    };
    expect("never pushed", ["go.js"]);
    L.recordPush("go.js", files[0].local, fs.readFileSync(files[0].local, "utf8"), "sync");
    expect("just pushed", []);
    fs.writeFileSync(files[0].local, "edited");
    t += 60_000;
    expect("edited in place, not pushed", ["go.js"]);
    t += 6 * 60_000;
    c.examined(1);
    if (L.state().oldestPendingMin !== 6) c.fail(`pending clock ${L.state().oldestPendingMin} min, expected 6 (it must not restart per scan)`);
    atomicWrite(files[0].local, "edited again");
    t += 60_000;
    L.scan(files);
    c.examined(1);
    if (L.state().oldestPendingMin !== 7) c.fail(`a second edit restarted the pending clock (${L.state().oldestPendingMin} min, expected 7)`);
    L.recordPush("go.js", files[0].local, "edited again", "scan");
    expect("pushed by the scan", []);
    atomicWrite(files[0].local, "edited again"); // new inode, same bytes
    expect("same-content atomic save", []);
    const now = new Date(Date.now() + 5000);
    fs.utimesSync(files[0].local, now, now);
    expect("touch", []);
    L.recordMiss(["go.js"]);
    const st = L.state();
    c.examined(1);
    if (st.watcherMisses !== 1 || st.lastPushVia !== "scan" || st.pushes !== 2) c.fail("state() does not carry misses / via / push count", JSON.stringify(st));
    c.note(`state after the sequence: ${JSON.stringify({ pending: st.pending, pushes: st.pushes, misses: st.watcherMisses, via: st.lastPushVia })}`);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
  return c;
}

function pw3() {
  const c = new Check("PW3", "autoPushVerdict() says AUTO-PUSH NOT DELIVERING on a persistent difference, and not otherwise");
  const T = Date.parse("2026-09-28T02:52:00Z");
  const iso = (min) => new Date(T - min * 60000).toISOString();
  const healthyPush = {
    lastPushAt: iso(1), lastPushFile: "goplan.js", lastPushVia: "watch", pushes: 5, pending: 0, pendingFiles: [],
    oldestPendingSince: null, oldestPendingMin: 0, watcherMisses: 0, lastMiss: null, lastError: null,
    watcher: { kind: "per-directory", dirs: 7, events: 40, lastEventAt: iso(1) }, drift: { files: 0, since: null },
  };
  const NDF = /AUTO-PUSH NOT DELIVERING/;
  const cases = [
    // The live reading: go.js first seen stale at 02:31, now 02:52.
    { why: "the 2026-09-28 reading: go.js stale 21 min", status: { push: healthyPush }, problems: ["STALE on home: go.js — disk 93b5005e, game 86c3cb02"], firstSeen: { "home:go.js": iso(21) }, fires: true },
    { why: "a difference seen for the first time", status: { push: healthyPush }, problems: ["STALE on home: go.js — disk 93b5005e, game 86c3cb02"], firstSeen: {}, fires: false },
    { why: "under the threshold", status: { push: healthyPush }, problems: ["STALE on home: go.js — disk 1, game 2"], firstSeen: { "home:go.js": iso(4) }, fires: false },
    // objective.js changed disk hash four times in two minutes during the
    // incident. The clock must survive that.
    { why: "disk hash changed since first seen", status: { push: healthyPush }, problems: ["STALE on home: objective.js — disk 9c0dd919, game 84f86ce6"], firstSeen: { "home:objective.js": iso(8) }, fires: true },
    { why: "MISSING counts too", status: { push: healthyPush }, problems: ["MISSING on home: new.js (disk 1)"], firstSeen: { "home:new.js": iso(9) }, fires: true },
    { why: "only another server's scp'd copy differs", status: { push: healthyPush }, problems: ["STALE on joesguns: objective.js — disk 1, game 2"], firstSeen: { "joesguns:objective.js": iso(30) }, fires: false },
    { why: "daemon ledger: pending 12 min, verify clean", status: { push: { ...healthyPush, pending: 1, pendingFiles: ["go.js"], oldestPendingMin: 12 } }, problems: [], firstSeen: {}, fires: true },
    { why: "daemon ledger: pending 1 min", status: { push: { ...healthyPush, pending: 1, pendingFiles: ["go.js"], oldestPendingMin: 1 } }, problems: [], firstSeen: {}, fires: false },
    { why: "all clean", status: { push: healthyPush }, problems: [], firstSeen: { "home:go.js": iso(30) }, fires: false },
  ];
  let fired = 0;
  for (const k of cases) {
    const v = autoPushVerdict({ status: k.status, problems: k.problems, firstSeen: k.firstSeen, now: T, maxMin: 5 });
    const did = v.fails.some((f) => NDF.test(f.what));
    fired += did;
    c.examined(1);
    if (did !== k.fires) c.fail(`${k.why}: ${did ? "fired" : "silent"}, expected ${k.fires ? "fired" : "silent"}`, JSON.stringify(v.fails));
    if (did && !/last push goplan\.js/.test(v.fails.find((f) => NDF.test(f.what)).detail)) c.fail(`${k.why}: the failure does not carry the daemon's push state`);
  }
  c.note(`${cases.length} cases, ${fired} fired`);

  // The clock is carried forward, and cleared when the difference goes away.
  const v1 = autoPushVerdict({ status: { push: healthyPush }, problems: ["STALE on home: go.js — disk a, game b"], firstSeen: { "home:go.js": iso(3), "home:gone.js": iso(50) }, now: T });
  c.examined(1);
  if (v1.firstSeen["home:go.js"] !== iso(3)) c.fail("firstSeen was not carried forward — the clock restarts every run and never reaches the threshold");
  if ("home:gone.js" in v1.firstSeen) c.fail("a resolved difference kept its old first-seen time — its next occurrence would fire instantly");

  // A daemon that publishes no ledger is the daemon with the bug.
  const v2 = autoPushVerdict({ status: { connected: true }, problems: [], now: T });
  c.examined(1);
  if (!v2.fails.some((f) => /does not report push state/.test(f.what))) c.fail("a daemon without /status .push is not flagged");
  return c;
}

function pw4() {
  const c = new Check("PW4", "the daemon and healthcheck are wired to the per-directory watcher, the ledger scan and the verdict");
  const daemon = fs.readFileSync(path.join(REPO, "tools/rfa-daemon.mjs"), "utf8");
  const hc = fs.readFileSync(path.join(REPO, "tools/healthcheck.mjs"), "utf8");
  const code = daemon.replace(/^\s*\/\/.*$/gm, "");
  const need = [
    [/fs\.watch\([^)]*recursive:\s*true/.test(code), false, "rfa-daemon.mjs uses fs.watch({recursive:true}) — deaf after an atomic save on Linux"],
    [/new DirWatcher\(/.test(code), true, "rfa-daemon.mjs does not use DirWatcher"],
    [/ledger\.scan\(trackedFiles\(\)\)/.test(code), true, "rfa-daemon.mjs has no periodic ledger scan — a missed event is lost for good"],
    [/watcher\.sync\(\)/.test(code), true, "rfa-daemon.mjs never re-syncs its directory watchers"],
    [/push:\s*\{\s*\.\.\.ledger\.state\(\)/.test(code), true, "/status does not publish the push ledger"],
    [/ledger\.recordPush\(/.test(code), true, "pushFile does not record into the ledger"],
    [/autoPushVerdict\(/.test(hc), true, "healthcheck.mjs does not call autoPushVerdict"],
  ];
  for (const [got, want, msg] of need) {
    c.examined(1);
    if (got !== want) c.fail(msg);
  }
  c.note(`${need.length} wiring facts checked in rfa-daemon.mjs and healthcheck.mjs`);
  return c;
}

export async function run() {
  return [await pw1(), await pw2(), pw3(), pw4()];
}
