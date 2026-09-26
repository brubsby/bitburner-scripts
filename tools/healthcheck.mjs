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
import { wealthNegativeCheck } from "../nodeecon.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEL = path.join(ROOT, ".telemetry");
const STATE = path.join(TEL, "healthcheck-last.json");
const CTL = process.env.CTL_PORT ?? 12526;
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const QUIET = argv.includes("--quiet");

const num = (v) => typeof v === "number" && isFinite(v);
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
// Fetched before the freshness loop, which needs the current life's start to
// tell "this component is stalled" from "this component has not started yet".
const state = await ctl("/state");
// Budget per file: how stale is too stale. A job that runs every few minutes
// gets a wider budget than a resident daemon.
const FRESH = { "act.txt": 15, "progress.txt": 45, "watchdog.txt": 20, "batch.txt": 20, "go.txt": 30, "gang.txt": 20, "sleeve.txt": 20 };
const tel = {};
// Files carried over from a previous life: their CONTENTS are history, so a
// movement check comparing them reports a stall in a component that has not
// started yet. go.js is tier 128 and a fresh node is back at 32GB.
const staleFromLastLife = new Set();
for (const [name, budget] of Object.entries(FRESH)) {
  const d = readTel(name);
  tel[name] = d;
  if (!d) {
    // gang.txt legitimately absent before a gang node's first gang.js run.
    if (name === "gang.txt" || name === "sleeve.txt") continue;
    fail(`/tel/${name} is missing or unparseable`, "UNKNOWN is not a pass — the component may be dead");
    continue;
  }
  const age = ageMin(d.at);
  if (age === null) fail(`/tel/${name} has no readable timestamp`);
  else if (age > budget) {
    // A file left behind by the previous BitNode is not a stalled component,
    // it is a component that has not started yet. `lastAugReset` moves on
    // every install and every node change, so a file older than the current
    // life is from a stack that no longer exists.
    // The current life began `playtimeSinceLastAug` ago — the one field /state
    // actually carries for this. Anything published before that is from a
    // stack that no longer exists, not a stalled one. (lastAugReset would be
    // the direct answer and /state does not publish it.)
    const lifeStartMs = num(state.playtimeSinceLastAug) ? Date.now() - state.playtimeSinceLastAug : null;
    const bornLastLife = lifeStartMs !== null && Date.parse(d.at) < lifeStartMs;
    if (bornLastLife) {
      staleFromLastLife.add(name);
      note(`/tel/${name} is ${age.toFixed(0)} min old and from a PREVIOUS life — not yet republished this one`);
    }
    else fail(`/tel/${name} is ${age.toFixed(0)} min stale (budget ${budget})`, `health '${d.health}' — a stale file reporting 'ok' is the shape every silent failure here has taken`);
  }
  if (d.health === "error") fail(`${name} reports health 'error'`, String(d.detail ?? "").slice(0, 200));
}
if (tel["watchdog.txt"]?.detail) note(`watchdog: ${String(tel["watchdog.txt"].detail).slice(0, 160)}`);
// go.js warns when the solver is not answering — the check that was missing.
if (tel["go.txt"]?.health === "warn") fail("go.js reports health 'warn'", String(tel["go.txt"].detail ?? "").slice(0, 200));

/* ------------------------------------------------- D. movement vs last */
const prev = (() => {
  try {
    return JSON.parse(fs.readFileSync(STATE, "utf8"));
  } catch {
    return null;
  }
})();

const now = {
  at: new Date().toISOString(),
  // CASH, from the save — not wealth. Where stock.js holds the book cash
  // reads ~$0 on a run worth billions; `wealth` below adds the trader's equity.
  money: state.money ?? null,
  cash: num(state.money) ? state.money : null,
  equity: (() => {
    const st = tel["stock.txt"] ?? readTel("stock.txt");
    const age = ageMin(st?.at);
    return st && age !== null && age < 10 && num(st.equity) ? st.equity : null;
  })(),
  karma: state.karma ?? null,
  hacking: state.skills?.hacking ?? null,
  hackingExp: state.exp?.hacking ?? null,
  homeRam: state.home?.ram ?? null,
  augs: (state.augmentations ?? []).length,
  // /state does NOT publish lastAugReset, so this read `undefined` and the
  // install-detection branch below was dead: `installed` was always false.
  // playtimeSinceLastAug is the field it does publish, and an install resets
  // it to ~0, so a DROP is an install.
  lifeMs: num(state.playtimeSinceLastAug) ? state.playtimeSinceLastAug : null,
  bitNode: state.bitNode ?? null,
  gangFaction: tel["gang.txt"]?.faction ?? null,
  gangRespect: tel["gang.txt"]?.respect ?? null,
  gangMembers: tel["gang.txt"]?.members ?? null,
  gangTerritory: tel["gang.txt"]?.territory ?? null,
  goBonusPct: tel["go.txt"]?.factionRepBonusPct ?? null,
  sleeveSyncMin: tel["sleeve.txt"]?.syncMin ?? null,
  sleeveKarmaYield: tel["sleeve.txt"]?.karmaYield ?? null,
  goRemote: tel["go.txt"]?.remoteMoves ?? null,
  batchPerSec: tel["batch.txt"]?.totals?.earnedPerSec ?? null,
  // For the promise checks: combat exp, and the Covenant campaign's claimed
  // stat and rates (installgate covenantExit), so the next run can compare
  // the progress the plan promised with the progress the game shows.
  combatExp: state.exp ? { strength: state.exp.strength, defense: state.exp.defense, dexterity: state.exp.dexterity, agility: state.exp.agility } : null,
  campaign: (() => {
    const c = tel["installgate.txt"]?.covenantExit;
    if (!c?.active || c.member) return null;
    const leg = (c.combatLegs ?? []).find((l) => l.stat === c.trainStat);
    return leg ? { stat: c.trainStat, rate: (leg.playerRate ?? 0) + (leg.sleeveRate ?? 0) } : null;
  })(),
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
} else if (prev.bitNode !== null && now.bitNode !== null && prev.bitNode !== now.bitNode) {
  // A BITNODE CHANGE INVALIDATES EVERY MOVEMENT CHECK AT ONCE, and each one
  // fires: prestigeSourceFile sets home RAM back to 32 (Prestige.ts:245),
  // zeroes karma and the gang, strips every augmentation and resets hacking to
  // 1, while the scripts that publish /tel are still coming back up. Checking
  // a new node against the old one's numbers reports five failures and not one
  // of them is real — which is how a checker teaches its reader to ignore it.
  //
  // The transition itself is the news, so it is reported as such and the
  // baseline is replaced.
  note(`BitNode ${prev.bitNode} -> ${now.bitNode}: movement checks reset, this sample becomes the new baseline`);
} else if (dtMin < MIN_INTERVAL_MIN) {
  note(`previous sample is only ${dtMin.toFixed(1)} min old (need ${MIN_INTERVAL_MIN}) — movement checks skipped, and the sample is NOT overwritten so the next run still has a real baseline`);
} else {
  note(`compared against a sample ${dtMin.toFixed(0)} min old`);
  const moved = (a, b) => a !== null && b !== null && a !== b;

  // A CAMPAIGN'S PROMISED PROGRESS: the stat it trains must rise at roughly
  // the rate its estimate assumed. Off by more than 2x either way is a broken
  // estimate (live: '~1h of combat' was really ~325h); no rise at all is a
  // campaign that is not happening.
  if (prev.campaign && now.campaign && prev.campaign.stat === now.campaign.stat && prev.combatExp && now.combatExp) {
    const st = now.campaign.stat;
    const got = now.combatExp[st] - prev.combatExp[st];
    const expect = prev.campaign.rate * dtMin * 60;
    if (!(got > 0)) fail(`CAMPAIGN NOT MOVING: ${st} exp did not rise in ${dtMin.toFixed(0)} min while the Covenant campaign claims to train it`);
    else if (expect > 0 && (got / expect < 0.5 || got / expect > 2)) fail(`CAMPAIGN ESTIMATE OFF: ${st} gained ${Math.round(got)} exp in ${dtMin.toFixed(0)} min; the estimate assumed ${Math.round(expect)} (${(got / expect).toFixed(2)}x) — its hours are not to be trusted`);
    else note(`campaign: ${st} +${Math.round(got)} exp in ${dtMin.toFixed(0)} min (${(got / expect).toFixed(2)}x the estimate)`);
  }

  // The batcher must be earning. Zero is the shape of "running but idle".
  // In a node where hacking pays nothing (BN8: ScriptHackMoneyGain 0) batch.js
  // farms EXP by design and $0/s is correct; there the thing that must move is
  // hacking exp, so check that instead of crying wolf (2026-09-25).
  const farming = !!tel["batch.txt"]?.expFarm;
  if (farming) {
    if (num(prev.hackingExp) && num(now.hackingExp) && !(now.hackingExp > prev.hackingExp) && !(num(now.lifeMs) && num(prev.lifeMs) && now.lifeMs < prev.lifeMs)) fail(`EXP FARM NOT MOVING: hacking exp flat over ${dtMin.toFixed(0)} min while batch.js is in exp mode`);
  } else if (now.batchPerSec !== null && !(now.batchPerSec > 0)) fail("batch.js reports $0/s earned", "the batcher is running but landing nothing");

  // Go power must climb while go.js is alive; the bonus resets on install, so
  // an install since the last sample legitimately drops it.
  const installed = now.lifeMs !== null && prev.lifeMs !== null && now.lifeMs < prev.lifeMs;
  if (installed) note(`an install landed since the last sample (${now.augs} augmentations owned)`);
  if (!staleFromLastLife.has("go.txt") && now.goRemote !== null && prev.goRemote !== null && now.goRemote === prev.goRemote && !installed) {
    fail("go.js has answered no new solver moves since the last sample", "the farm is stalled or the solver stopped");
  }

  // The gang is this node's whole plan: before it exists karma must fall
  // toward the gate; after it exists respect must climb.
  if (!now.gangFaction) {
    // KARMA IS ONLY A GATE WHERE THE GANG IS WORTH ITS PRICE. This branch read
    // "no gang" as "karma must be falling", which was true while every node was
    // assumed to want one. gangworth.js prices that per node now, and BitNode
    // 10 answers NO on income scale alone — so the run deliberately stopped
    // grinding, and this check called the correct behaviour a problem for
    // several hours.
    //
    // A check that cries wolf on intended behaviour is worse than no check:
    // it is the one that gets skimmed past, and then the real stall is skimmed
    // past with it. The verdict is read from the same file act.js gates on, so
    // the monitor and the actor cannot disagree about what the run is doing.
    const verdict = readTel("installgate.txt")?.gangWorth ?? null;
    const karmaIsTheGate = verdict?.worth !== false;
    if (!karmaIsTheGate) {
      note(`karma flat at ${Math.round(now.karma ?? 0)} and that is CORRECT — the gang is priced NOT worth its gate in this node, so the work slot is elsewhere`);
    } else if (now.karma !== null && prev.karma !== null && now.karma >= prev.karma) {
      fail(
        `karma is not falling (${Math.round(prev.karma)} -> ${Math.round(now.karma)})`,
        verdict?.worth === true
          ? "the gang IS priced worth its gate here, so karma is the gate — a flat karma means the work slot is on something else"
          : "no gang yet and the gang is UNPRICED, so karma is still assumed to be the gate — a flat karma means the work slot is on something else",
      );
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
  //
  // THE INPUT IS CHECKED BEFORE THE CONDITION. This read `state.exp?.hacking`,
  // which the daemon did not publish, so it was null on every run and the test
  // skipped itself in silence while the file printed HAPPY PATH — the precise
  // shape of "a check that examined zero things looks like a check that
  // passed". The daemon now publishes `exp`; if it ever stops, that is a
  // finding, not a pass.
  if (now.hackingExp === null) {
    fail("hacking experience is unreadable", "daemon /state carries no exp.hacking — the exit-progress check cannot run, and a check that cannot run must not read as a pass");
  } else if (prev.hackingExp !== null && now.hackingExp <= prev.hackingExp && !installed) {
    fail("hacking experience has not increased", "nothing is hacking — the exit level is the node's end condition");
  }

  // Home RAM only ever goes up within a node.
  if (now.homeRam !== null && prev.homeRam !== null && now.homeRam < prev.homeRam) {
    fail(`home RAM went DOWN (${prev.homeRam} -> ${now.homeRam})`, "only a BitNode change does that");
  }
}

/* ------------------------------------------------------ D2. the watchdog */
//
// IS ANYTHING RESTARTING ANYTHING? The watchdog is the only supervisor inside
// the game, and it has no supervisor of its own — so its absence is the one
// failure that disables recovery from every other failure.
//
// It went missing for four and a half hours in BitNode 10 on 2026-09-22 and
// this file PASSED throughout. It even printed "watchdog.js is no longer
// running" — but that was a `detail` string copied out of PREVIOUS-LIFE
// telemetry, prose in the notes rather than a check. Reporting a sentence is
// not the same as testing the claim it makes.
//
// The consequence was a deadlock: homeup.js --watch retires in favour of the
// watchdog, the watchdog did not fit at 64GB once the action slot tripled on
// leaving BitNode 4, and nothing else admitted below it can raise home RAM —
// so home could never reach the size at which the watchdog would fit.
//
// A DEFERRED watchdog is not an excused absence, unlike sleeve.js's: boot.js
// explaining why it could not fit is the DIAGNOSIS of the deadlock, not a
// reason to accept it. So the reason is attached to the failure, never
// substituted for it.
const WATCHDOG_TIER = 64;
// PROMISES AGAINST THE GAME (2026-09-25: "i tell you to do something, you say
// it's happening, i have to ensure it actually happens, it doesn't"). What the
// planner CLAIMS is checked against what the save shows, every run, no
// baseline needed: the work slot's owner must match the work actually running.
{
  const pr = tel["progress.txt"];
  const owner = pr?.slot?.owner ?? null;
  const ageMin = pr?.at ? (Date.now() - Date.parse(pr.at)) / 60000 : null;
  const actual = state.currentWork?.type ?? null;
  const want = { body: ["ClassWork", "CrimeWork"], faction: ["FactionWork"], crime: ["CrimeWork"] }[owner];
  if (want && ageMin !== null && ageMin < 15) {
    if (!want.includes(actual)) fail(`ORDER NOT HELD: progress.js claims the work slot for '${owner}' work, but the game is running ${actual ?? "nothing"}`, "something else took the slot (act.js? a stale order?) — the plan is not happening");
    else note(`work slot: '${owner}' claimed and the game is running ${actual}`);
  }
}
// THE STOCK TRADER (stock.js). In BitNode 8 it is the whole income, so a dead
// or erroring trader is a stalled node, and a live one earning far below what
// the offline harness promised is an ESTIMATE OFF, not a quiet market.
{
  const st = tel["stock.txt"] ?? readTel("stock.txt");
  const age = ageMin(st?.at);
  if (state.bitNode === 8) {
    if (!st) fail("STOCK TRADER MISSING: BitNode 8 and no /tel/stock.txt — the only income is not running");
    else if (!(age !== null && age < 5)) fail(`STOCK TRADER STALE: /tel/stock.txt is ${age?.toFixed(0) ?? "?"} min old (health ${st.health})`, "stock.js died or the mirror froze — check connected:true first");
    else if (st.health === "error" || st.health === "stopped") fail(`STOCK TRADER ${String(st.health).toUpperCase()}: ${st.error ?? st.detail ?? st.why ?? ""}`.slice(0, 200));
  }
  if (st && age !== null && age < 5) {
    const rph = num(st.returnPerSec) ? st.returnPerSec * 3600 : null;
    note(`stock: ${st.mode}, equity $${((st.equity ?? 0) / 1e9).toFixed(2)}b, cash $${((st.cash ?? 0) / 1e9).toFixed(2)}b, return ${rph === null ? "unmeasured" : (rph * 100).toFixed(1) + "%/h"} over the last hour, ${st.counters?.refused ?? 0} refused`);
    // Offline the shipped rule's median is ~60-95%/h ln-growth below $1e11
    // (stockplan.RATE_TABLE). A full hour measured below a quarter of that
    // is outside anything the harness saw as a median.
    if (rph !== null && (st.counters?.ticks ?? 0) >= 600 && (st.equity ?? 0) + (st.cash ?? 0) < 1e11 && rph < 0.15)
      fail(`STOCK ESTIMATE OFF: ${(rph * 100).toFixed(1)}%/h measured over the last hour against ~60-95%/h offline`, "the harness is NOT CALIBRATED; read /tel/stock.txt last.refused and diag before trusting RATE_TABLE");
  }
}

// THE LAST HANG (trace.js via tel.js): what the previous page was running
// when it stopped, published after a reload. Reported for a day.
{
  const h = readTel("lasthang.txt");
  if (h?.at && Date.now() - Date.parse(h.at) < 24 * 3600e3) {
    const tr = (h.visibilityTransitions ?? []).map((x) => `${x.at.slice(11, 19)} ${x.visible ? "shown" : "hidden"}`).join(", ");
    note(`last page stop: alive until ${h.lastAlive ?? "?"}; ${h.why}${tr ? `; visibility: ${tr}` : ""}`);
  }
}

// THE PAGE'S HEAP (tel.js heapMB): the renderer died 2026-09-25 after hours
// of play. Over 3GB of a ~4.4GB limit is a problem; otherwise reported.
{
  const heap = readTel("status.txt")?.heapMB;
  if (typeof heap === "number") {
    if (heap > 3000) fail(`page heap ${heap} MB — near the renderer's limit; a leak will kill the tab`, "reload the tab soon (it resumes from autosave)");
    else note(`page heap ${heap} MB`);
  } else note("page heap unreported (tel.js heapMB missing — tel.js not restarted since the field was added?)");
}
const GRACE_MIN = 10; // a fresh life legitimately has not booted it yet
const lifeMin = now.lifeMs !== null ? now.lifeMs / 60000 : null;
if (now.homeRam !== null && now.homeRam >= WATCHDOG_TIER && (lifeMin === null || lifeMin > GRACE_MIN)) {
  const wdTel = tel["watchdog.txt"];
  const absent = !wdTel || staleFromLastLife.has("watchdog.txt");
  if (absent) {
    const boot = readTel("boot.txt");
    const why =
      (boot?.defer ?? []).find((d) => /watchdog\.js/.test(String(d?.script ?? "")))?.why ??
      (boot?.failed ?? []).find((x) => /^watchdog\.js:/.test(String(x))) ??
      "boot.js records neither a defer nor a failure for it";
    fail(
      `home is ${now.homeRam}GB but watchdog.js has not published this life`,
      `nothing is reviving dead scripts or running jobs, and the home-RAM ratchet retires in its favour — this is the shape that froze BitNode 10 for 4.5h. boot.js says: ${String(why).slice(0, 220)}`,
    );
  } else {
    note(`watchdog: publishing this life (health '${wdTel.health}')`);
  }
}

/* --------------------------------------------------------- E. sleeves */
//
// ARE SLEEVES ACTUALLY EARNING? The reason this run came to BitNode 10, and
// the one mechanic where "assigned and working" and "producing anything" come
// apart by two orders of magnitude.
//
// SleeveCrimeWork.ts:47 credits the player `crime.karma * sleeve.syncBonus()`,
// syncBonus() is sync/100, and a fresh sleeve starts at sync = max(memory, 1).
// So eight sleeves committing Homicide at sync 1 deliver 8% of ONE player's
// karma rate while every count-based reading says the fleet is fully deployed.
// That is why karmaYield — the sum of syncBonus() across sleeves — is the
// number checked here, not the assignment count.
const sleeve = tel["sleeve.txt"];
// sleeve.js is a tier-64 manifest entry, so below that home size its absence
// is the plan working, not a fault.
const SLEEVE_TIER = 64;
const sleevesExpected = now.homeRam !== null && now.homeRam >= SLEEVE_TIER;
if (!sleevesExpected) {
  note(`sleeves: home is ${now.homeRam}GB and sleeve.js is admitted at ${SLEEVE_TIER}GB — not expected yet`);
} else if (!sleeve) {
  // EXPLAINED ABSENCE IS NOT SILENT ABSENCE. boot.js refuses to place an entry
  // no host can hold and records the refusal, which is the system working —
  // sleeve.js needs 41.75GB free and a 64GB home with the fleet loaded has
  // none. Failing on that trains the reader to ignore the sleeve section
  // during exactly the hours it is expected to be quiet. An absence with NO
  // recorded reason is still a failure, because that is the shape of a driver
  // that died without saying so.
  const bootFail = (readTel("boot.txt")?.failed ?? []).find((x) => /^sleeve\.js:/.test(String(x)));
  if (bootFail) note(`sleeves: not placed — ${bootFail} (boot.js refused rather than starting it somewhere it cannot raise)`);
  else fail("home is past sleeve.js's tier, /tel/sleeve.txt does not exist, and boot.js records no reason", "a driver that is simply absent, with nothing explaining it, is the silent-failure shape");
} else {
  if (sleeve.result === "refusals") fail(`${(sleeve.refusals ?? []).length} sleeve assignment(s) refused by the game`, String(sleeve.detail ?? ""));
  if (!num(sleeve.sleeves) || sleeve.sleeves <= 0) fail("sleeve.js reports zero sleeves", "Source-File 10 grants one per level and BitNode 10 grants up to eight");
  if (num(sleeve.karmaYield)) {
    note(`sleeves: ${sleeve.sleeves}, sync mean ${num(sleeve.syncMean) ? sleeve.syncMean.toFixed(1) : "?"} / min ${num(sleeve.syncMin) ? sleeve.syncMin.toFixed(1) : "?"}, karma yield ${sleeve.karmaYield.toFixed(2)}x a player`);
    // SYNC IS ONLY WORTH BUYING FOR THE OBJECTIVES IT SCALES. syncBonus()
    // appears in exactly two places in the game — the exp handed to the player
    // (Sleeve/Work/Work.ts:19) and karma (SleeveCrimeWork.ts:47). It does NOT
    // scale money, and it does NOT scale faction reputation.
    //
    // So a fleet earning money or reputation SHOULD leave sync where it is,
    // and this check would then fail forever on correct behaviour — the same
    // defect the karma-movement check above had, and one introduced by the very
    // change that taught the planner to stop synchronising. Two checks crying
    // wolf about one deliberate decision is how the real stall gets skimmed
    // past. The objective is read from the plan the fleet is actually following.
    const sleeveObjective = sleeve.objective ?? readTel("sleeveplan.txt")?.objective ?? null;
    const syncIsWorthBuying = sleeveObjective === null || sleeveObjective === "karma";
    if (num(sleeve.syncMin) && sleeve.syncMin < 100 && !syncIsWorthBuying) {
      note(`sleeve sync flat at ${sleeve.syncMin.toFixed(1)} and that is CORRECT — the objective is '${sleeveObjective}', which sync does not scale`);
    } else if (num(sleeve.syncMin) && sleeve.syncMin < 100 && prev && num(prev.sleeveSyncMin) && sleeve.syncMin <= prev.sleeveSyncMin && dtMin >= MIN_INTERVAL_MIN) {
      fail(`sleeve sync is not rising (min ${prev.sleeveSyncMin.toFixed(1)} -> ${sleeve.syncMin.toFixed(1)})`, `the objective is '${sleeveObjective ?? "unknown"}', which sync DOES scale — karma from a sleeve is sync/100, so an unsynchronised sleeve earns almost nothing`);
    }
  } else {
    fail("sleeve.js publishes no karmaYield", "without sync there is no way to tell a working fleet from a fully-assigned idle one");
  }
}

/* ------------------------------------------- F. is the RUN progressing? */
// Everything above asks whether each COMPONENT is healthy. On 2026-09-25 the
// whole of BN8 stalled for 5.8h with every component healthy and this file
// printing HAPPY PATH: the trader compounded $250m -> $57b while the planner
// did nothing (income read null, every purchase gated on cash the fully
// invested trader never held), no aug was bought, no install happened and
// hacking sat at 485. Component health cannot see that. These checks read the
// OBJECTIVE — the exit — and fail when the run is not getting closer to it.
// An unreadable objective is a failure, never a pass.
{
  const gate = readTel("installgate.txt");
  const prog = tel["progress.txt"];
  // The ONE published exit (progress.js exitH: the model that decides);
  // the sensitivity record's copy for records written before it existed.
  const exitH = num(gate?.exitH) ? gate.exitH : gate?.objective?.exitSensitivity?.exitH;
  // The planner's own forecast calibration (installgate exitCalibration).
  const cal = gate?.exitCalibration;
  // PLAN NOT EXECUTED: the committed count route's current leg (progress.txt
  // slot.routeLeg) must be what the player is DOING — the save's currentWork,
  // and the job for a company leg. Live 2026-09-26 a committed Bachman route
  // held for three passes with no job, the slot unclaimed and the player on
  // another faction's work. Two samples in a row, so one pass of travel or a
  // join in flight is not a failure.
  {
    const leg = prog?.slot?.routeLeg ?? null;
    const cw = state.currentWork ?? null;
    const type = String(cw?.type ?? cw?.data?.type ?? "");
    const jobs = state.jobs && typeof state.jobs === "object" ? state.jobs : {};
    let mismatch = null;
    if (leg && leg.kind === "company" && !(/Company/i.test(type) && leg.target in jobs)) mismatch = `route leg is company work at ${leg.target}; the save shows ${type || "no work"} and jobs ${JSON.stringify(Object.keys(jobs))}`;
    else if (leg && leg.kind === "faction" && !(/Faction/i.test(type) && (cw?.faction ?? cw?.data?.factionName) === leg.target)) mismatch = `route leg is faction work at ${leg.target}; the save shows ${type || "no work"}${cw?.faction ? " for " + cw.faction : ""}`;
    else if (leg && leg.kind === "body" && !/Class|Crime/i.test(type)) mismatch = `route leg is the gym/crime for ${leg.faction}; the save shows ${type || "no work"}`;
    now.planMismatch = mismatch;
    if (mismatch && prev?.planMismatch) fail(`PLAN NOT EXECUTED: ${mismatch}`, `previous sample: ${prev.planMismatch} — the committed route (${leg.aug} at ${leg.faction}) is not what the player is doing`);
    else if (mismatch) note(`route leg not yet executing (one sample): ${mismatch}`);
    else if (leg) note(`route leg executing: ${leg.kind} ${leg.target}`);
  }
  // ONE EXIT: the count route's exit on the gate's own inputs is one of the
  // gate's candidates, so the published exit can never be later than it.
  const cr = gate?.countRoute?.chosen;
  if (cr && num(cr.gateExitH) && num(gate?.exitH) && gate.exitH > cr.gateExitH + 0.01) fail(`TWO EXITS: installgate exitH ${gate.exitH.toFixed(2)}h is later than its own chosen count route's ${cr.gateExitH.toFixed(2)}h`, "the route was ranked but never entered the gate's comparison — the published exit and the plan disagree");
  if (cal && num(cal.realisedPerH)) note(`exit forecast: ${cal.realisedPerH.toFixed(2)}h/h realised vs ${cal.predictedPerH}h/h predicted, error ${num(cal.errPerH) ? cal.errPerH.toFixed(2) : "?"}h/h over ${cal.pairs} pairs`);
  const windowH = gate?.objective?.windowH;
  now.exitH = num(exitH) ? exitH : null;
  now.queued = (state.queuedAugmentations ?? []).length;
  now.didCount = Array.isArray(prog?.did) ? prog.did.length : null;
  now.todo0 = Array.isArray(prog?.todo) ? String(prog.todo[0] ?? "") : null;
  now.working = !!(state.currentWork && (state.currentWork.type ?? state.currentWork.data?.type));
  const sameNode = prev && prev.bitNode === now.bitNode;
  const hist = (sameNode && Array.isArray(prev.etaHist) ? prev.etaHist : []).filter((h) => num(h.exitH));
  now.etaHist = [...hist, ...(now.exitH !== null ? [{ at: now.at, exitH: now.exitH }] : [])].slice(-48);

  if (now.exitH === null) fail("EXIT UNPRICED: installgate.txt carries no exitH", "the run cannot say how far it is from the end — every decision that prices a trajectory is flying blind");
  else note(`exit ETA ${now.exitH.toFixed(1)}h`);

  // F1: the exit must approach. Over at least an hour of samples in this node,
  // the projected exit should fall by at least half the wall time that passed.
  const oldest = now.etaHist.find((h) => (Date.parse(now.at) - Date.parse(h.at)) / 3.6e6 >= 1);
  if (oldest && now.exitH !== null) {
    const elapsedH = (Date.parse(now.at) - Date.parse(oldest.at)) / 3.6e6;
    const gainedH = oldest.exitH - now.exitH;
    if (gainedH < 0.5 * elapsedH) fail(`EXIT NOT APPROACHING: projected exit ${oldest.exitH.toFixed(1)}h -> ${now.exitH.toFixed(1)}h over ${elapsedH.toFixed(1)}h of wall time`, "the run is spending time without getting closer to the end — find which leg is stuck (progress.txt todo, installgate plan)");
  }
  // F2: installs must happen on the cadence the plan itself assumes.
  const lifeH = num(now.lifeMs) ? now.lifeMs / 3.6e6 : null;
  // A hold the count-aware exit simulation chose (installgate countDecidedBy
  // 'exit-sim') is a priced decision, not a stall — the objective check F1
  // (EXIT NOT APPROACHING) still covers it if that simulation is wrong.
  // First fired falsely on 2026-09-26 01:03 against a 0.4h window prior while
  // the sim priced a 4h wait.
  const pricedHold = gate?.countDecidedBy === "exit-sim";
  if (lifeH !== null && num(windowH) && lifeH > 3 * windowH && now.queued === 0 && pricedHold) note(`install held by the simulated exit (life ${lifeH.toFixed(1)}h): ${String(gate?.countTimingWhy ?? "").slice(0, 120)}`);
  else if (lifeH !== null && num(windowH) && lifeH > 3 * windowH && now.queued === 0) fail(`NO INSTALL: this life is ${lifeH.toFixed(1)}h old, 3x the ${windowH.toFixed(1)}h window the plan assumes, and nothing is queued`, `installgate planned=${gate?.planned}, plan=${gate?.plan === null ? "null" : "set"} — capital that is never converted into augmentations is not progress`);
  // F3: the planner must act, or change what it is waiting on.
  if (prev && sameNode && dtMin >= 30 && now.didCount === 0 && prev.didCount === 0 && now.todo0 !== null && now.todo0 === prev.todo0) fail(`PLANNER IDLE: progress.js did nothing across ${dtMin.toFixed(0)} min, still waiting on: ${now.todo0.slice(0, 160)}`);
  // F4: a measured income the planner cannot see.
  if (prog && prog.income == null) {
    const st = readTel("stock.txt");
    if (st && num(st.returnPerSec)) fail(`progress.js reads income null while stock.txt publishes returnPerSec ${st.returnPerSec.toExponential(2)}`, "the planner's income path is broken, not the trader");
  }
  // F6: WEALTH NEGATIVE — cash + equity below zero, or cash below zero in two
  // samples running. Class/gym fees are charged with no balance check; on
  // 2026-09-25 sleeves at ZB drained a liquidated book to -$2.4m and the life
  // had to be soft-reset by hand. act.js's escape (nodeecon.softlockStep)
  // should have caught it; this fails if it did not.
  now.wealth = num(now.cash) ? now.cash + (num(now.equity) ? now.equity : 0) : null;
  for (const w of wealthNegativeCheck({ cash: now.cash, equity: now.equity }, prev && sameNode ? { cash: prev.cash } : null)) fail(w, `act.js softlock record: ${String(readTel("softlock.txt")?.why ?? "none").slice(0, 160)}`);
  // F5: the player's work slot must be in use.
  if (!now.working && prev && sameNode && prev.working === false && dtMin >= MIN_INTERVAL_MIN) fail("PLAYER IDLE: no current work across two samples", "the work slot is the one resource that cannot be bought");
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
