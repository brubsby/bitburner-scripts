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
  gangMembers: tel["gang.txt"]?.members ?? null,
  gangTerritory: tel["gang.txt"]?.territory ?? null,
  goBonusPct: tel["go.txt"]?.factionRepBonusPct ?? null,
  goRemote: tel["go.txt"]?.remoteMoves ?? null,
  batchPerSec: tel["batch.txt"]?.totals?.earnedPerSec ?? null,
};

if (state.__error) fail("daemon /state unreadable", state.__error);

// Telemetry advances on its own cadence — the daemon mirrors the save every
// 30s, gang.js and go.js publish per tick — so two samples taken close
// together read the SAME numbers and every movement check fires at once.
// That is a false positive manufactured by the checker, and it showed up the
// first time this file was run twice in a minute. Movement needs a real
// interval to be movement.
const MIN_INTERVAL_MIN = 5;
const dtMin = prev ? (Date.parse(now.at) - Date.parse(prev.at)) / 60000 : null;
if (!prev) {
  note("no previous sample — movement checks skipped THIS RUN ONLY (they are the point of this file)");
} else if (dtMin < MIN_INTERVAL_MIN) {
  note(`previous sample is only ${dtMin.toFixed(1)} min old (need ${MIN_INTERVAL_MIN}) — movement checks skipped, and the sample is NOT overwritten so the next run still has a real baseline`);
} else {
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
    // A FLAT RESPECT IS NOT AUTOMATICALLY A STALL. gangplan's policy search
    // deliberately TRAINS first: greedy assignment never trained, and training
    // first reached the first unlock 8x sooner (28.5h -> 3.4h) because respect
    // per second is a function of stats that barely exist at recruitment. A
    // gang whose every member is on a training task earns exactly zero respect
    // and is behaving correctly.
    //
    // This check said otherwise on its first encounter with a fresh gang
    // (respect 1 -> 1, three members on Train Combat, an ascension round at
    // x1.647 already banked) — a false positive, and a false positive nobody
    // can fix is how a check gets ignored and then deleted.
    //
    // So: training is a legitimate non-growing state, but training FOREVER is
    // not. The state file carries when the current training stretch began and
    // this fails once it outlasts any plausible one.
    const TRAIN_BUDGET_H = 6;
    const assignments = Object.values(tel["gang.txt"]?.assignments ?? {});
    const training = assignments.length > 0 && assignments.every((t) => /^Train /.test(String(t)));
    const grew = now.gangRespect !== null && prev.gangRespect !== null && now.gangRespect > prev.gangRespect;
    if (grew) {
      now.trainingSince = null;
    } else if (training) {
      now.trainingSince = prev.trainingSince ?? prev.at;
      const h = (Date.parse(now.at) - Date.parse(now.trainingSince)) / 3600000;
      if (h > TRAIN_BUDGET_H) {
        fail(`the gang has been training ${h.toFixed(1)}h with no respect earned`, `budget ${TRAIN_BUDGET_H}h — the policy trains before earning, but not indefinitely; check factionplan.txt gang.unlocks and gang.txt policy.k`);
      } else {
        note(`gang training ${h.toFixed(1)}h/${TRAIN_BUDGET_H}h (respect stays flat by design: ${assignments.length} member(s) on training tasks)`);
      }
    } else if (now.gangRespect !== null && prev.gangRespect !== null) {
      // RESPECT IS NOT MONOTONIC. Ascension subtracts the member's earned
      // respect from the gang total (Gang.ts:391), so a fall is the expected
      // reading right after one — and the faction REPUTATION it feeds is
      // computed from GROSS gains, which an ascension never reduces. What is
      // NOT expected is a fall with no ascension behind it.
      const asc = tel["gang.txt"]?.ascended ?? [];
      const since = asc.filter((a) => Date.parse(a.at ?? "") > Date.parse(prev.at));
      if (since.length) {
        note(`gang respect ${Math.round(prev.gangRespect).toLocaleString()} -> ${Math.round(now.gangRespect).toLocaleString()} across ${since.length} ascension(s) — ascension pays respect for stat multipliers`);
        // ...but an ascension that buys nothing is pure loss, and the live
        // guard let a x1.000 loop run for an hour before it was caught.
        const noop = since.filter((a) => /gain x1\.000/.test(String(a.why ?? "")));
        if (noop.length) fail(`${noop.length} ascension(s) at gain x1.000`, `an ascension that multiplies stats by 1 cannot pay: it resets earned respect and destroys the member's equipment. Members: ${[...new Set(noop.map((a) => a.name))].join(", ")}`);
      } else {
        fail("gang respect is not growing, nobody is training, and no ascension explains it", `${Math.round(prev.gangRespect)} -> ${Math.round(now.gangRespect)}, assignments ${JSON.stringify(tel["gang.txt"]?.assignments ?? null)}`);
      }
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
  // Do NOT overwrite a baseline the run was too close to use: doing so would
  // reset the clock on every quick re-run and movement would never be checked.
  if (!prev || dtMin >= MIN_INTERVAL_MIN) fs.writeFileSync(STATE, JSON.stringify(now, null, 1));
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
