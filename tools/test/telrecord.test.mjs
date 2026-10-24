// [TR] The daemon's append-only run record (tools/telrecord.mjs).
//
// A node review (2026-10-23) found no Bladeburner history, no sleeve history,
// no route/exit history and no node-entry estimate; decisions.jsonl and
// installs.jsonl had stopped on 09-17 because their writer, tools/dash.mjs,
// was a dashboard nobody restarted. Machine sleep left no trace at all.
//
//   TR1 the save digest carries Bladeburner and sleeves (shapes as in the live
//       save, 2026-10-24), and the daemon is wired to the recorder
//   TR2 run.jsonl's row: the acting Bladeburner script, rank, action, black ops,
//       stamina, slot owner/Simulacrum, sleeve tasks, route, exit
//   TR3 decisions.jsonl rows only on a real change, compact (never the body)
//   TR4 installs.jsonl and the node-entry / node-plan events
//   TR5 thinJsonl bounds a sample file and keeps every line whole
//   TR6 daemon start says how long nothing was recorded; a clock jump is a sleep gap

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO } from "./ram.mjs";
import {
  RunRecorder,
  bbActorOf,
  bladeburnerOfSave,
  decisionRows,
  installRow,
  readJsonl,
  runRecord,
  sleevesOfSave,
  thinJsonl,
} from "../telrecord.mjs";

const NOW = Date.parse("2026-10-24T02:30:00Z");
const iso = (ms) => new Date(ms).toISOString();
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), "telrecord-"));

// PlayerSave.data as the save has it (fields seen in the live BN13 save, 2026-10-24).
const SAVE_PLAYER = {
  bitNodeN: 13,
  lastNodeReset: 1792792822668,
  lastAugReset: 1792792822668,
  bladeburner: {
    ctor: "Bladeburner",
    data: { rank: 2216.79, maxRank: 2216.79, stamina: 245.76, maxStamina: 246.47, action: { type: "Operations", name: "Raid" }, actionTimeCurrent: 35, actionTimeToComplete: 80, numBlackOpsComplete: 0, skillPoints: 64, _teamSize: 4, city: "Aevum" },
  },
  sleeves: [
    { ctor: "Sleeve", data: { sync: 100, shock: 91.1, currentWork: { ctor: "SleeveInfiltrateWork", data: { type: "INFILTRATE", cyclesWorked: 286 } } } },
    { ctor: "Sleeve", data: { sync: 100, shock: 0, currentWork: { ctor: "SleeveFactionWork", data: { type: "FACTION", factionName: "CyberSec", factionWorkType: "hacking" } } } },
    { ctor: "Sleeve", data: { sync: 50, shock: 0, currentWork: { ctor: "SleeveCrimeWork", data: { type: "CRIME", crimeType: "Homicide" } } } },
    { ctor: "Sleeve", data: { sync: 50, shock: 0, currentWork: null } },
  ],
};

const telFiles = ({ bbAt = iso(NOW - 30e3), bbHealth = "ok", liteAt = iso(NOW - 3600e3), liteHealth = "stopped", planNode = 13 } = {}) => ({
  "bladeburner.txt": JSON.stringify({
    at: bbAt,
    health: bbHealth,
    daemon: "bladeburner.js",
    rank: 2166.51,
    stamina: 246.08,
    maxStamina: 246.08,
    blackOps: { done: 0, next: "Operation Typhoon", reqdRank: 2500 },
    slot: { owner: "body", ours: true, simulacrum: true, by: "progress.js" },
    action: { type: "Operations", name: "Raid", level: 8, city: "Aevum", why: "long text" },
    rankPerHour: 1323.75,
    resting: false,
    samples: new Array(61).fill({ at: bbAt, rank: 1, stamina: 1 }),
    cities: [{ name: "Aevum" }],
  }),
  "bb-lite.txt": JSON.stringify({ at: liteAt, health: liteHealth, daemon: "bb-lite", rank: 12, result: "acting", exited: liteHealth === "stopped" }),
  "sleeve.txt": JSON.stringify({ at: iso(NOW), health: "ok", objective: "money", assigned: [{ i: 0, task: "INFILTRATE" }, { i: 1, task: "CRIME:Homicide" }] }),
  "progress.txt": JSON.stringify({ at: iso(NOW), did: ["last batch (2026-10-24T02:25:35.109Z): 3 of 3 done", "waits for $1,125,200,000 (have $272,366,200)"], todo: ["852 more CyberSec reputation"], route: { route: "blade", priced: "blade", pinned: false, held: true }, slot: { owner: "body" } }),
  "plan.txt": JSON.stringify({ at: iso(NOW), node: planNode, health: "blocked", ver: "juw2uc.54", decidedAt: iso(NOW - 900e3), exit: { meanH: 10.563, q10: 7.27, q50: 10.555, q90: 13.58, source: "install decision (never, the Bladeburner route)" } }),
  "installgate.txt": JSON.stringify({ at: iso(NOW), install: false, why: "hold: 3.2h to the exit", queued: 0, M: 1.5, Meff: 1.4, favorGain: 2, goBonusPct: 0, huge: "x".repeat(50000) }),
  "factionplan.txt": JSON.stringify({ at: iso(NOW), workingFaction: "CyberSec", segments: [{ faction: "CyberSec", untilRep: 852.4 }] }),
});

function tr1() {
  const c = new Check("TR1", "the save digest carries Bladeburner and sleeves; the daemon is wired to the recorder");
  const bb = bladeburnerOfSave(SAVE_PLAYER);
  c.examined(1);
  if (!bb || bb.rank !== 2216.79 || bb.action !== "Operations/Raid" || bb.blackOpsDone !== 0 || bb.stamina !== 245.76 || bb.maxStamina !== 246.47)
    c.fail("bladeburnerOfSave misread the save", JSON.stringify(bb));
  if (bladeburnerOfSave({ bladeburner: null }) !== null) c.fail("no Bladeburner must be null, not an empty record");
  const sl = sleevesOfSave(SAVE_PLAYER);
  const tasks = (sl ?? []).map((s) => s.task);
  c.examined(tasks.length);
  const want = ["INFILTRATE", "FACTION:CyberSec:hacking", "CRIME:Homicide", "idle"];
  if (JSON.stringify(tasks) !== JSON.stringify(want)) c.fail("sleeve tasks", `${JSON.stringify(tasks)} != ${JSON.stringify(want)}`);
  c.note(`bb ${JSON.stringify(bb)}; sleeves ${JSON.stringify(tasks)}`);

  const src = fs.readFileSync(path.join(REPO, "tools", "rfa-daemon.mjs"), "utf8");
  for (const [what, re] of [
    ["digest: bladeburner", /bladeburner:\s*bladeburnerOfSave\(p\)/],
    ["digest: sleeves", /sleeves:\s*sleevesOfSave\(p\)/],
    ["digest: lastNodeReset", /lastNodeReset:\s*p\.lastNodeReset/],
    ["history append then recorder.onDigest", /history\.jsonl[^\n]*\n\s*recorder\.onDigest\(d\)/],
    ["the /tel mirror feeds recorder.onTelFiles", /recorder\.onTelFiles\(mirrored\)/],
    ["a sleep-gap heartbeat", /recorder\.heartbeat\(\)/],
    ["files bounded", /recorder\.bound\(\)/],
    ["a stop is recorded", /recorder\.stop\(sig\)/],
  ]) {
    c.examined(1);
    if (!re.test(src)) c.fail(`tools/rfa-daemon.mjs is not wired: ${what}`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
  c.examined(1);
  if (!/--what=[^ ]*sleep[^ ]*handle-lid-switch[^ ]* .*--mode=block/.test(pkg.scripts.daemon))
    c.fail("npm run daemon must hold a BLOCK sleep + handle-lid-switch inhibitor (logind's lid action ignores sleep locks)", pkg.scripts.daemon);
  return c;
}

function tr2() {
  const c = new Check("TR2", "run.jsonl row: Bladeburner actor/rank/action/black ops/stamina/slot, sleeves, route, exit");
  const r = runRecord(telFiles(), NOW);
  c.examined(1);
  const expect = {
    "bb.actor": [r.bb?.actor, "bladeburner.js"],
    "bb.rank": [r.bb?.rank, 2166.51],
    "bb.action": [r.bb?.action, "Operations/Raid L8 @Aevum"],
    "bb.blackOps.done": [r.bb?.blackOps?.done, 0],
    "bb.stamina": [JSON.stringify(r.bb?.stamina), "[246.08,246.08]"],
    "bb.slot.owner": [r.bb?.slot?.owner, "body"],
    "bb.slot.simulacrum": [r.bb?.slot?.simulacrum, true],
    "sleeves.tasks": [JSON.stringify(r.sleeves?.tasks), '["INFILTRATE","CRIME:Homicide"]'],
    "route.route": [r.route?.route, "blade"],
    "slot": [r.slot, "body"],
    "plan.exit.meanH": [r.plan?.exit?.meanH, 10.563],
    "plan.exit.q90": [r.plan?.exit?.q90, 13.58],
    "plan.node": [r.plan?.node, 13],
  };
  for (const [k, [got, want]] of Object.entries(expect)) {
    c.examined(1);
    if (got !== want) c.fail(`run record ${k}`, `${JSON.stringify(got)} != ${JSON.stringify(want)}`);
  }
  const bytes = JSON.stringify(r).length;
  c.note(`row ${bytes} bytes`);
  if (bytes > 1500) c.fail("run row is not compact (the samples/cities arrays leaked in?)", `${bytes} bytes`);
  // Actor selection: whichever script is fresh and not stopped.
  const cases = [
    [{}, "bladeburner.js"],
    [{ bbHealth: "stopped", liteAt: iso(NOW - 60e3), liteHealth: "ok" }, "bb-lite.js"],
    [{ bbAt: iso(NOW - 3600e3), liteAt: iso(NOW - 60e3), liteHealth: "ok" }, "bb-lite.js"],
    [{ bbAt: iso(NOW - 3600e3) }, "none"],
  ];
  for (const [o, want] of cases) {
    c.examined(1);
    const got = runRecord(telFiles(o), NOW).bb?.actor;
    if (got !== want) c.fail(`actor for ${JSON.stringify(o)}`, `${got} != ${want}`);
  }
  if (bbActorOf(null, null, NOW) !== "none") c.fail("no files must be 'none'");
  return c;
}

function tr3() {
  const c = new Check("TR3", "decisions.jsonl: a row only on a real change, with the signature fields only");
  const last = {};
  const f0 = telFiles();
  c.examined(1);
  if (decisionRows(f0, last, NOW).length) c.fail("first sight must only prime");
  // A rewrite with a new clock and ticking dollar figures is not a decision.
  const tick = { ...f0 };
  tick["progress.txt"] = f0["progress.txt"].replace("2026-10-24T02:25:35.109Z", "2026-10-24T02:29:01.000Z").replace("$272,366,200", "$301,000,000");
  tick["factionplan.txt"] = f0["factionplan.txt"].replace("852.4", "400.1");
  c.examined(1);
  const quiet = decisionRows(tick, last, NOW + 30e3);
  if (quiet.length) c.fail("a clock/number tick was logged as a decision", JSON.stringify(quiet.map((r) => r.source)));
  const flip = { ...tick };
  flip["installgate.txt"] = tick["installgate.txt"].replace('"install":false', '"install":true').replace("hold: 3.2h to the exit", "install now: the queue pays");
  flip["factionplan.txt"] = JSON.stringify({ workingFaction: "Tetrads", segments: [{ faction: "Tetrads", untilRep: 5000 }] });
  const rows = decisionRows(flip, last, NOW + 60e3);
  c.examined(rows.length);
  const srcs = rows.map((r) => r.source).sort().join(",");
  if (srcs !== "factionplan,installgate") c.fail("expected rows for installgate and factionplan", srcs);
  const ig = rows.find((r) => r.source === "installgate");
  if (ig && (ig.install !== true || "huge" in ig)) c.fail("installgate row must carry the decision fields and not the body", JSON.stringify(ig).slice(0, 200));
  c.note(`row sizes ${rows.map((r) => JSON.stringify(r).length).join(", ")} bytes`);
  return c;
}

function tr4() {
  const c = new Check("TR4", "installs.jsonl on an install; node-entry (SFs, time, plan estimate) and node-plan events");
  const dir = scratch();
  const root = scratch();
  try {
    fs.writeFileSync(path.join(root, "next-node.txt"), JSON.stringify({ at: iso(NOW - 864e5), next: 5, level: 2, label: "BN5.2", from: 13, ET: 114.3 }));
    fs.writeFileSync(path.join(dir, "plan.txt"), telFiles()["plan.txt"]);
    const logs = [];
    const rec = new RunRecorder({ dir, root, log: (m) => logs.push(m) });
    const base = { at: iso(NOW), bitNode: 13, lastNodeReset: 1000, lastAugReset: 1000, augmentations: ["A", "B"], queuedAugmentations: ["C"], money: 5e9, skills: { hacking: 900 }, sourceFiles: { ctor: "JSONMap", data: [[1, 3], [13, 2]] }, totalPlaytime: 1e9 };
    rec.onDigest(base);
    let ev = readJsonl(path.join(dir, "events.jsonl")).filter((e) => e.kind === "node-entry");
    c.examined(ev.length);
    if (ev.length !== 1) c.fail("the first digest must log the node it finds", JSON.stringify(ev));
    else if (ev[0].node !== 13 || ev[0].sourceFiles?.[13] !== 2 || ev[0].planEstimate?.meanH !== 10.563 || ev[0].enteredAt !== iso(1000))
      c.fail("node-entry fields", JSON.stringify(ev[0]));
    rec.onDigest({ ...base, at: iso(NOW + 300e3) });
    c.examined(1);
    if (readJsonl(path.join(dir, "events.jsonl")).filter((e) => e.kind === "node-entry").length !== 1) c.fail("the same node must not be logged twice");
    // An install: lastAugReset moves, C becomes installed.
    rec.onDigest({ ...base, at: iso(NOW + 600e3), lastAugReset: 2000, augmentations: ["A", "B", "C"], queuedAugmentations: [], money: 1262, skills: { hacking: 1 } });
    const ins = readJsonl(path.join(dir, "installs.jsonl"));
    c.examined(ins.length);
    if (ins.length !== 1 || JSON.stringify(ins[0].added) !== '["C"]' || ins[0].moneyBefore !== 5e9 || ins[0].nodeChanged) c.fail("install row", JSON.stringify(ins));
    // A NEW node (BN5): logged, predicted by next-node.txt, plan.txt still BN13's so no estimate.
    rec.onDigest({ ...base, at: iso(NOW + 900e3), bitNode: 5, lastNodeReset: 3000, lastAugReset: 3000, augmentations: [], sourceFiles: { ctor: "JSONMap", data: [[1, 3], [13, 3]] } });
    ev = readJsonl(path.join(dir, "events.jsonl")).filter((e) => e.kind === "node-entry");
    c.examined(ev.length);
    const e5 = ev[ev.length - 1];
    if (ev.length !== 2 || e5.node !== 5 || e5.predicted !== true || e5.planEstimate !== null || e5.planNode !== 13 || e5.firstSight !== false)
      c.fail("BN5 entry row", JSON.stringify(e5));
    // The first in-node plan estimate is logged once.
    rec.onTelFiles(telFiles({ planNode: 5 }), NOW + 960e3);
    rec.onTelFiles(telFiles({ planNode: 5 }), NOW + 990e3);
    const np = readJsonl(path.join(dir, "events.jsonl")).filter((e) => e.kind === "node-plan");
    c.examined(np.length);
    if (np.length !== 1 || np[0].node !== 5 || np[0].exit?.meanH !== 10.563) c.fail("node-plan event", JSON.stringify(np));
    const runs = readJsonl(path.join(dir, "run.jsonl"));
    if (runs.length !== 2 || runs[0].plan?.thisNode !== true) c.fail("run.jsonl rows", JSON.stringify(runs.map((r) => r.plan)));
    // A restarted daemon resumes the node key from events.jsonl (no duplicate entry).
    const rec2 = new RunRecorder({ dir, root, log: () => {} });
    rec2.onDigest({ ...base, at: iso(NOW + 1200e3), bitNode: 5, lastNodeReset: 3000, lastAugReset: 3000 });
    c.examined(1);
    if (readJsonl(path.join(dir, "events.jsonl")).filter((e) => e.kind === "node-entry").length !== 2) c.fail("a restart re-logged the node entry");
    if (installRow(null, base) !== null) c.fail("no previous digest must not invent an install");
    if (logs.some((l) => /failed/.test(l))) c.fail("the recorder logged a failure", logs.join(" | "));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
  return c;
}

function tr5() {
  const c = new Check("TR5", "thinJsonl: bounded, newest intact, older thinned, every line whole");
  const dir = scratch();
  try {
    const f = path.join(dir, "h.jsonl");
    const N = 5000;
    fs.writeFileSync(f, Array.from({ length: N }, (_, i) => JSON.stringify({ i, pad: "y".repeat(80 + (i % 37)) })).join("\n") + "\n");
    const size = fs.statSync(f).size;
    c.examined(N);
    if (thinJsonl(f, { maxBytes: size + 1, keepBytes: 1000 }) !== null) c.fail("under the cap must not touch the file");
    const r = thinJsonl(f, { maxBytes: size / 2, keepBytes: size / 5 });
    const rows = fs.readFileSync(f, "utf8").trimEnd().split("\n").map((l) => JSON.parse(l));
    c.note(`${(size / 1e3).toFixed(0)}kB -> ${(r.after / 1e3).toFixed(0)}kB, stride ${r.stride}, ${rows.length} of ${N} lines`);
    if (r.after > size / 2) c.fail("still over the cap after thinning", JSON.stringify(r));
    if (rows[rows.length - 1].i !== N - 1) c.fail("the newest line was lost");
    const tail = rows.filter((x) => x.i >= N * 0.85).map((x) => x.i);
    if (tail.length !== N - Math.ceil(N * 0.85)) c.fail("the newest part must be intact", `${tail.length} lines`);
    if (rows[0].i !== 0) c.fail("the oldest sample must survive thinning");
    for (let k = 1; k < rows.length; k++) if (rows[k].i <= rows[k - 1].i) c.fail("order broken", `${rows[k - 1].i} -> ${rows[k].i}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return c;
}

function tr6() {
  const c = new Check("TR6", "daemon start reports the unrecorded gap; a wall-clock jump is a sleep gap");
  const dir = scratch();
  try {
    // 10-19: last row 22:50Z, the machine hibernated, the daemon came back 04:04Z.
    fs.writeFileSync(path.join(dir, "run.jsonl"), JSON.stringify({ at: "2026-10-19T22:49:59.000Z" }) + "\n");
    const logs = [];
    const rec = new RunRecorder({ dir, root: dir, log: (m) => logs.push(m) });
    rec.start(Date.parse("2026-10-20T04:04:27Z"));
    const st = readJsonl(path.join(dir, "events.jsonl")).find((e) => e.kind === "daemon-start");
    c.examined(1);
    if (!st || st.downSec !== 18868) c.fail("daemon-start downSec", JSON.stringify(st));
    if (!logs.some((l) => /RUN RECORD GAP/.test(l))) c.fail("a long gap must be said out loud in the log", logs.join(" | "));
    rec.tick = NOW;
    c.examined(2);
    if (rec.heartbeat(NOW + 10e3) !== null) c.fail("a normal tick is not a gap");
    const g = rec.heartbeat(NOW + 10e3 + 5 * 3600e3);
    if (!g || g.sec !== 5 * 3600 || !logs.some((l) => /SLEEP GAP/.test(l))) c.fail("a 5h jump must be a sleep-gap event", JSON.stringify(g));
    rec.stop("SIGTERM", NOW);
    if (!readJsonl(path.join(dir, "events.jsonl")).some((e) => e.kind === "daemon-stop" && e.signal === "SIGTERM")) c.fail("daemon-stop not recorded");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return c;
}

export async function run() {
  return [tr1(), tr2(), tr3(), tr4(), tr5(), tr6()];
}
