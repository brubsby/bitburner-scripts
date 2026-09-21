// IS THE RUN ON THE HAPPY PATH? One command, one verdict, no browser.
//
//   node tools/healthcheck.mjs            check, print, exit 0/1
//   node tools/healthcheck.mjs --json     machine-readable
//   node tools/healthcheck.mjs --quiet    print only when something is wrong
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, and what it is shaped by.
//
// Every failure this run has actually hit was SILENT. Not a crash — a
// component reporting healthy while doing nothing, or doing the wrong thing
// correctly. The list, all from 2026-09-20/21:
//
//   * the Go solver had never been started in a 67-hour daemon session; go.js
//     fell back to a 20ms local search and published health 'ok' throughout.
//   * homeup.js bought home 32GB -> 256GB over 6.8h while /tel/boot.txt still
//     said tier 32, so the stack was never re-planned. Its own telemetry said
//     'waiting', truthfully.
//   * progress.js threw ReferenceError on every pass. The watchdog noticed
//     ("failing 8 cycles") — nothing else did.
//   * act.js was frozen by a heartbeat-as-lock and trained strength to 137
//     against a target of 30.
//   * an install dropped the faction, and the join branch ran Shoplift at
//     0.0173 karma/s while 3,689 karma from the gang gate.
//
// Not one of those is detectable by asking "is anything reporting an error?".
// Four of the five needed a SECOND SAMPLE to see: the quantity that should
// have been moving was not. So this file keeps its last sample and checks
// MOVEMENT, not just liveness.
//
// FAIL CLOSED. An unreadable input is reported as UNKNOWN and counts as a
// problem, never as a pass. "I could not tell" and "it is fine" are different
// answers and the whole point of this file is to stop them reading alike.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEL = path.join(ROOT, ".telemetry");
const STATE = path.join(TEL, "healthcheck-last.json");
const CTL = process.env.CTL_PORT ?? 12526;
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const QUIET = argv.includes("--quiet");

const problems = [];
const notes = [];
const fail = (what, detail) => problems.push({ what, detail: detail ?? null });
const note = (line) => notes.push(line);

const readTel = (name) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(TEL, name), "utf8"));
  } catch {
    return null;
  }
};
const ageMin = (iso) => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? (Date.now() - t) / 60000 : null;
};
const ctl = async (route, ms = 20000) => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(`http://127.0.0.1:${CTL}${route}`, { signal: ac.signal });
    return await res.json();
  } catch (e) {
    return { __error: String(e.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
};

/* ---------------------------------------------------------- A. plumbing */
const status = await ctl("/status");
if (status.__error) {
  fail("daemon control port unreachable", `${status.__error} — tools/rfa-daemon.mjs is not running, so nothing is syncing or mirroring telemetry`);
} else {
  if (!status.connected) fail("the game is not connected to the daemon", "telemetry is frozen; reconnect via RemoteFileAPI.newRemoteFileApiConnection()");
  const gs = status.goSolver;
  if (!gs) fail("daemon does not report goSolver", "this daemon predates the supervisor — restart it so the solver is supervised");
  else if (gs.enabled && !gs.running) fail("the Go solver is not running", `restarts ${gs.restarts}, lastExit ${JSON.stringify(gs.lastExit)}`);
  else if (gs.enabled) note(`solver up ${gs.upSec}s, ${gs.restarts} restart(s)`);
}

/* -------------------------------------------------------- B. deployment */
const verify = await ctl("/verify", 90000);
if (verify.__error) fail("deploy verify failed to answer", verify.__error);
else if (verify.error) {
  // /verify answers 503 {error} when the game is not connected. That is the
  // SAME fact A already reported, not a second independent one — printing
  // "0 file(s) differ" here reads as a drift finding and is noise.
  note(`deploy not verifiable: ${verify.error}`);
} else if (!verify.ok) {
  const list = verify.problems ?? [];
  fail(`${list.length} file(s) differ between disk and the game`, list.slice(0, 5).join("; "));
}

/* ------------------------------------------------- C. liveness + health */
// Budget per file: how stale is too stale. A job that runs every few minutes
// gets a wider budget than a resident daemon.
const FRESH = { "act.txt": 15, "progress.txt": 45, "watchdog.txt": 20, "batch.txt": 20, "go.txt": 30, "gang.txt": 20 };
const tel = {};
for (const [name, budget] of Object.entries(FRESH)) {
  const d = readTel(name);
  tel[name] = d;
  if (!d) {
    // gang.txt legitimately absent before a gang node's first gang.js run.
    if (name === "gang.txt") continue;
    fail(`/tel/${name} is missing or unparseable`, "UNKNOWN is not a pass — the component may be dead");
    continue;
  }
  const age = ageMin(d.at);
  if (age === null) fail(`/tel/${name} has no readable timestamp`);
  else if (age > budget) fail(`/tel/${name} is ${age.toFixed(0)} min stale (budget ${budget})`, `health '${d.health}' — a stale file reporting 'ok' is the shape every silent failure here has taken`);
  if (d.health === "error") fail(`${name} reports health 'error'`, String(d.detail ?? "").slice(0, 200));
}
if (tel["watchdog.txt"]?.detail) note(`watchdog: ${String(tel["watchdog.txt"].detail).slice(0, 160)}`);
// go.js warns when the solver is not answering — the check that was missing.
if (tel["go.txt"]?.health === "warn") fail("go.js reports health 'warn'", String(tel["go.txt"].detail ?? "").slice(0, 200));

/* ------------------------------------------------- D. movement vs last */
const state = await ctl("/state");
const prev = (() => {
  try {
    return JSON.parse(fs.readFileSync(STATE, "utf8"));
  } catch {
    return null;
  }
})();

const now = {
  at: new Date().toISOString(),
  money: state.money ?? null,
  karma: state.karma ?? null,
  hacking: state.skills?.hacking ?? null,
  hackingExp: state.exp?.hacking ?? null,
  homeRam: state.home?.ram ?? null,
  augs: (state.augmentations ?? []).length,
  lastAugReset: state.lastAugReset ?? null,
  gangFaction: tel["gang.txt"]?.faction ?? null,
  gangRespect: tel["gang.txt"]?.respect ?? null,
  gangTerritory: tel["gang.txt"]?.territory ?? null,
  goBonusPct: tel["go.txt"]?.factionRepBonusPct ?? null,
  goRemote: tel["go.txt"]?.remoteMoves ?? null,
  batchPerSec: tel["batch.txt"]?.totals?.earnedPerSec ?? null,
};

if (state.__error) fail("daemon /state unreadable", state.__error);

if (!prev) {
  note("no previous sample — movement checks skipped THIS RUN ONLY (they are the point of this file)");
} else {
  const dtMin = (Date.parse(now.at) - Date.parse(prev.at)) / 60000;
  note(`compared against a sample ${dtMin.toFixed(0)} min old`);
  const moved = (a, b) => a !== null && b !== null && a !== b;

  // The batcher must be earning. Zero is the shape of "running but idle".
  if (now.batchPerSec !== null && !(now.batchPerSec > 0)) fail("batch.js reports $0/s earned", "the batcher is running but landing nothing");

  // Go power must climb while go.js is alive; the bonus resets on install, so
  // an install since the last sample legitimately drops it.
  const installed = moved(prev.lastAugReset, now.lastAugReset);
  if (installed) note(`an install landed since the last sample (${now.augs} augmentations owned)`);
  if (now.goRemote !== null && prev.goRemote !== null && now.goRemote === prev.goRemote && !installed) {
    fail("go.js has answered no new solver moves since the last sample", "the farm is stalled or the solver stopped");
  }

  // The gang is this node's whole plan: before it exists karma must fall
  // toward the gate; after it exists respect must climb.
  if (!now.gangFaction) {
    if (now.karma !== null && prev.karma !== null && now.karma >= prev.karma) {
      fail(`karma is not falling (${Math.round(prev.karma)} -> ${Math.round(now.karma)})`, "no gang yet, so karma is the gate — a flat karma means the work slot is on something else");
    } else if (now.karma !== null) {
      note(`karma ${Math.round(prev.karma)} -> ${Math.round(now.karma)}`);
    }
  } else {
    if (now.gangRespect !== null && prev.gangRespect !== null && !(now.gangRespect > prev.gangRespect)) {
      fail("gang respect is not growing", `${prev.gangRespect} -> ${now.gangRespect}`);
    }
    note(`gang ${now.gangFaction}: respect ${Math.round(now.gangRespect ?? 0).toLocaleString()}, territory ${((now.gangTerritory ?? 0) * 100).toFixed(1)}%`);
  }

  // Hacking experience is the exit currency. It may only reset on an install.
  if (now.hackingExp !== null && prev.hackingExp !== null && now.hackingExp <= prev.hackingExp && !installed) {
    fail("hacking experience has not increased", "nothing is hacking — the exit level is the node's end condition");
  }

  // Home RAM only ever goes up within a node.
  if (now.homeRam !== null && prev.homeRam !== null && now.homeRam < prev.homeRam) {
    fail(`home RAM went DOWN (${prev.homeRam} -> ${now.homeRam})`, "only a BitNode change does that");
  }
}

/* ------------------------------------------------------ E. the decision */
const act = tel["act.txt"];
if (act && act.decision?.kind === "idle" && !act.decision?.why) fail("act.js is idle with no stated reason");
if (act?.decision?.why) note(`act.js: ${String(act.decision.why).slice(0, 150)}`);

try {
  fs.writeFileSync(STATE, JSON.stringify(now, null, 1));
} catch (e) {
  fail("could not write the healthcheck sample", `${e.message} — the next run has nothing to compare against`);
}

/* ------------------------------------------------------------- verdict */
const ok = problems.length === 0;
if (JSON_OUT) {
  console.log(JSON.stringify({ ok, at: now.at, problems, notes, sample: now }, null, 1));
} else if (!(QUIET && ok)) {
  console.log(ok ? "HAPPY PATH — no problems found" : `${problems.length} PROBLEM(S)`);
  for (const p of problems) {
    console.log(`  ! ${p.what}`);
    if (p.detail) console.log(`      ${p.detail}`);
  }
  for (const n of notes) console.log(`  . ${n}`);
}
process.exit(ok ? 0 : 1);
