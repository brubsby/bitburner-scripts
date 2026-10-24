// ORDER NOT HELD and EXIT UNPRICED sampled inside the life's own pipeline
// (tools/lifehealth.mjs). Live BN12 2026-10-09, ~15-min lives:
//
//   LH1  ORDER NOT HELD at 18:39:25Z: orders.txt stamped 18:39:18.997Z
//        (crime Heist), act.txt still on the 18:34:19Z batch, the save on
//        FactionWork — pending, noted. The same claim once act.js has run
//        the batch, or 3+ min unexecuted, FAILS; a failed work order is named.
//   LH2  EXIT UNPRICED in the first minutes of a life (no gate yet: the
//        18:24:11Z install's first pass came 5.1 min later) is noted; past
//        the grace, or with an unreadable life age, it FAILS.
//   LH3  healthcheck.mjs runs both verdicts (and keeps the graft cause).
import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const L = await import("../lifehealth.mjs");
const HC = fs.readFileSync(path.join(REPO_ROOT, "tools/healthcheck.mjs"), "utf8");

export async function run() {
  const checks = [];
  const orders = { at: "2026-10-09T18:39:18.997Z", lastAugReset: 1791570252088, orders: [{ id: 1, kind: "crime", args: ["Heist"], why: "crime: exit 3.65h vs 3.79h (0.3h to the install)" }] };
  const actBefore = { orders: { at: "2026-10-09T18:34:19.494Z", count: 1, results: [{ id: 1, kind: "join", args: ["Tian Di Hui"], ok: true }] } };
  const actAfter = { orders: { at: orders.at, count: 1, results: [{ id: 1, kind: "crime", args: ["Heist"], ok: true, result: { at: "2026-10-09T18:39:30.402Z", ok: true } }] } };
  const base = { owner: "crime", want: ["CrimeWork"], actual: "FactionWork", orders };

  const c1 = new Check("LH1", "ORDER NOT HELD: a work order act.js has not yet run is pending for 3 min; executed or older, a mismatch fails and names the order's result");
  {
    c1.examined(6);
    const at1825 = Date.parse("2026-10-09T18:39:25.640Z");
    const v = L.orderHeldVerdict({ ...base, act: actBefore, nowMs: at1825 });
    if (v.fail || !/pending/.test(v.note ?? "")) c1.fail(`18:39:25Z (6s after the batch, act.js not yet run) must be pending: ${JSON.stringify(v)}`);
    const late = L.orderHeldVerdict({ ...base, act: actBefore, nowMs: Date.parse(orders.at) + 3.5 * 60e3 });
    if (!late.fail || !/has not run the batch/.test(late.fail.detail)) c1.fail(`unexecuted after 3.5 min must FAIL naming act.js: ${JSON.stringify(late)}`);
    const ranButLost = L.orderHeldVerdict({ ...base, act: actAfter, nowMs: at1825 + 60e3 });
    if (!ranButLost.fail || !/something else took the slot/.test(ranButLost.fail.detail)) c1.fail(`executed and not held must FAIL: ${JSON.stringify(ranButLost)}`);
    const failedOrder = L.orderHeldVerdict({ ...base, act: { orders: { at: orders.at, results: [{ id: 1, kind: "crime", ok: false, result: { error: "no host has 82GB" } }] } }, nowMs: at1825 + 30e3 });
    if (!failedOrder.fail || !/no host has 82GB/.test(failedOrder.fail.detail)) c1.fail(`a failed work order must be named: ${JSON.stringify(failedOrder)}`);
    const noWorkOrder = L.orderHeldVerdict({ ...base, orders: { ...orders, orders: [{ id: 1, kind: "join", args: ["X"] }] }, act: actBefore, nowMs: at1825 });
    if (!noWorkOrder.fail) c1.fail(`a batch without a work order cannot excuse the mismatch: ${JSON.stringify(noWorkOrder)}`);
    const held = L.orderHeldVerdict({ ...base, actual: "CrimeWork", act: actAfter, nowMs: at1825 + 30e3 });
    if (held.fail || !/claimed and the game is running CrimeWork/.test(held.note)) c1.fail(`held must note: ${JSON.stringify(held)}`);
  }
  checks.push(c1);

  const c2 = new Check("LH2", "EXIT UNPRICED: noted inside the first 10 min of a life (the save's playtimeSinceLastAug), FAILS after, and on an unreadable age");
  {
    c2.examined(3);
    const early = L.exitUnpricedVerdict({ lifeMs: 4400 + 5 * 60e3 });
    if (early.fail || !/not priced yet/.test(early.note ?? "")) c2.fail(`5 min into a life must be noted: ${JSON.stringify(early)}`);
    const late = L.exitUnpricedVerdict({ lifeMs: 12 * 60e3 });
    if (!late.fail || !/^EXIT UNPRICED/.test(late.fail.what)) c2.fail(`12 min into a life must FAIL: ${JSON.stringify(late)}`);
    const unknown = L.exitUnpricedVerdict({ lifeMs: undefined });
    if (!unknown.fail) c2.fail(`an unreadable life age must FAIL, not pass: ${JSON.stringify(unknown)}`);
  }
  checks.push(c2);

  const c3 = new Check("LH3", "healthcheck.mjs runs orderHeldVerdict and exitUnpricedVerdict (graft cause carried)");
  {
    c3.examined(1);
    if (!/orderHeldVerdict\(\{[^}]*orders: readTel\("orders\.txt"\)/.test(HC)) c3.fail("healthcheck must decide ORDER NOT HELD with orderHeldVerdict on orders.txt and act.txt");
    if (!/exitUnpricedVerdict\(\{ lifeMs: state\.playtimeSinceLastAug \}\)/.test(HC)) c3.fail("healthcheck must decide EXIT UNPRICED with exitUnpricedVerdict on the save's life age");
    if (/fail\(`ORDER NOT HELD: progress\.js claims/.test(HC)) c3.fail("the inline ORDER NOT HELD (no pending window) must be gone");
  }
  checks.push(c3);

  // LH4 (backlog 0d): EXIT NOT APPROACHING across BN3.1 -> BN3.2 (live 2026-10-21 17:11Z). Both are
  // BitNode 3; BN3.1's last exit 4.3h against BN3.2's first 10.3h, 0.5h after the entry.
  const c4 = new Check("LH4", "EXIT NOT APPROACHING: the history resets at the node's entry (lastNodeReset) and at an install that changes the exit's basis — and only then");
  {
    c4.examined(5);
    const T = Date.parse("2026-10-21T17:11:00Z");
    const at = (hAgo) => new Date(T - hAgo * 3.6e6).toISOString();
    const bn31 = 1792400000000, bn32 = T - 0.5 * 3.6e6;
    const prevHist = [
      { at: at(2.5), exitH: 6.0, node: 3, nodeReset: bn31, life: bn31 + 1, ver: "v1", basis: "blade" },
      { at: at(1.5), exitH: 4.3, node: 3, nodeReset: bn31, life: bn31 + 1, ver: "v1", basis: "blade" },
    ];
    const now = { at: at(0), exitH: 10.3, node: 3, nodeReset: bn32, life: bn32, ver: "v1", basis: "blade" };
    const eh = L.exitHistOf({ prevHist, now });
    const v = L.exitApproachVerdict({ hist: eh.hist, now });
    if (v.fail) c4.fail(`BN3.2's first exit compared with BN3.1's: ${v.fail.what}`);
    if (!eh.dropped.some((d) => /another entry of BitNode 3/.test(d))) c4.fail(`the reset must be said out loud: ${JSON.stringify(eh.dropped)}`);
    // The defect itself: with the node number alone (no nodeReset) the same samples fire.
    const legacy = L.exitHistOf({ prevHist: prevHist.map(({ nodeReset, ...h }) => h), now: { ...now, nodeReset: null } });
    if (!L.exitApproachVerdict({ hist: legacy.hist, now }).fail) c4.fail("without lastNodeReset the BN3.1/BN3.2 pair must fire (the regression this guards)");
    // Same node entry, same basis across an install: still compared (a stuck run still fails).
    const life2 = { ...now, nodeReset: bn31, life: bn31 + 2 };
    const kept = L.exitHistOf({ prevHist, now: life2 });
    if (!L.exitApproachVerdict({ hist: kept.hist, now: life2 }).fail) c4.fail("an install on the same basis must keep the comparison (4.3h -> 10.3h over 1.5h fails)");
    // An install that moved the exit to the other route's model: restarted.
    const hack = { ...life2, basis: "hack" };
    const moved = L.exitHistOf({ prevHist, now: hack });
    if (L.exitApproachVerdict({ hist: moved.hist, now: hack }).fail || !moved.dropped.some((d) => /changed the exit's basis \(blade -> hack\)/.test(d))) c4.fail(`an install that changed the basis must restart, named: ${JSON.stringify(moved.dropped)}`);
    // Within one life a basis change is NOT a reset (that is what the check watches).
    const sameLifeHack = { ...hack, life: bn31 + 1 };
    if (!L.exitApproachVerdict({ hist: L.exitHistOf({ prevHist, now: sameLifeHack }).hist, now: sameLifeHack }).fail) c4.fail("a basis change inside a life must not hide a stuck exit");
  }
  checks.push(c4);

  // LH5 (backlog 0c): NO INSTALL in the final window. BN10.3 2026-10-19: 0.7h into the life The Red Pill
  // was installed in, "3x the 0.2h window", cash $7e13 -> $7e14 in 20 min toward the $1e17 Covenant sleeve.
  const c5 = new Check("LH5", "NO INSTALL: no install planned (The Red Pill installed, the committed install 'never', the gate's hold or Covenant saving, this life) is a note; otherwise past 3x the window it fails");
  {
    c5.examined(7);
    const life = 1792100000000;
    const base = { lifeH: 0.7, windowH: 0.2, queued: 0, lastAugReset: life, gate: { lastAugReset: life, planned: false, plan: null } };
    const rp = L.noInstallVerdict({ ...base, augs: ["The Red Pill", "NeuroFlux Governor"] });
    if (rp.fail || !/Red Pill is installed/.test(rp.note ?? "")) c5.fail(`the BN10.3 final life must be a note: ${JSON.stringify(rp)}`);
    const never = L.noInstallVerdict({ ...base, plan: { lastAugReset: life, decisions: { install: { key: "never" } } } });
    if (never.fail || !/'never'/.test(never.note ?? "")) c5.fail(`a committed 'never' must be a note: ${JSON.stringify(never)}`);
    const neverOld = L.noInstallVerdict({ ...base, plan: { lastAugReset: life - 1, decisions: { install: { key: "never" } } } });
    if (!neverOld.fail) c5.fail("another life's 'never' must not excuse this life");
    const cov = L.noInstallVerdict({ ...base, gate: { ...base.gate, covenantExit: { active: true } } });
    if (cov.fail || !/Covenant/.test(cov.note ?? "")) c5.fail(`a Covenant campaign saving must be a note: ${JSON.stringify(cov)}`);
    const hold = L.noInstallVerdict({ ...base, gate: { ...base.gate, holdForever: true } });
    if (hold.fail) c5.fail("the gate's holdForever must be a note");
    const plain = L.noInstallVerdict({ ...base, plan: { lastAugReset: life, decisions: { install: { key: "w0.25" } } } });
    if (!plain.fail || !/^NO INSTALL/.test(plain.fail.what)) c5.fail(`a planned install that never comes must FAIL: ${JSON.stringify(plain)}`);
    const young = L.noInstallVerdict({ ...base, lifeH: 0.5 });
    if (young.fail || young.note) c5.fail("inside 3x the window: nothing");
  }
  checks.push(c5);

  // LH6: PLANNER IDLE at the 15-min cadence of watch-run.sh 900 and bitburner-notify.timer.
  const c6 = new Check("LH6", "PLANNER IDLE fires at a 15-min cadence: windowed on the newest stored sample >= 30 min old, all idle on the same todo, same node entry");
  {
    c6.examined(4);
    const T = Date.parse("2026-10-24T12:00:00Z");
    const drive = (samples) => {
      let hist = [];
      let last = {};
      for (const s of samples) {
        const nowMs = T + s.min * 60e3;
        const now = { node: 13, nodeReset: s.nodeReset ?? 1, didCount: s.did ?? 0, todo0: s.todo ?? "waiting on cash" };
        last = L.plannerIdleVerdict({ hist, now, nowMs });
        hist = L.pushHist(hist, { at: new Date(nowMs).toISOString(), ...now }, nowMs);
      }
      return last;
    };
    if (!drive([{ min: 0 }, { min: 15 }, { min: 30 }]).fail) c6.fail("idle at 0/15/30 min must FAIL at 30 (the 15-min pair alone never could)");
    if (drive([{ min: 0 }, { min: 15 }, { min: 29 }]).fail) c6.fail("29 min of idling is under the 30-min window");
    if (drive([{ min: 0 }, { min: 15, did: 2 }, { min: 30 }]).fail) c6.fail("an action in between is not idle");
    if (drive([{ min: 0, nodeReset: 1 }, { min: 15, nodeReset: 2 }, { min: 30, nodeReset: 2 }]).fail) c6.fail("a node entry in between restarts the window");
  }
  checks.push(c6);

  // LH7: NO RANK PROGRESS at a cadence whose samples land 14.x min apart (the timer's ~15).
  const c7 = new Check("LH7", "NO RANK PROGRESS fires on 14.5-min samples: windowed on the newest stored snapshot >= 15 min old; a node entry restarts it");
  {
    c7.examined(3);
    const { bladeburnerHealth } = await import("../bbhealth.mjs");
    const T = Date.parse("2026-10-24T12:00:00Z");
    const bbAt = (nowMs, rank) => ({ at: new Date(nowMs - 60e3).toISOString(), health: "ok", bitNode: 13, result: "acting", joined: true, rank, resting: false, stamina: 150, maxStamina: 200, slot: { owner: "bladeburner", ours: true }, running: { type: "Operations", name: "Raid" }, action: { name: "Raid", why: "Raid L10" }, blackOps: { done: 1 }, outcomes: null, calibration: null, samples: [], exitReady: false });
    const drive = (steps) => {
      let prev = null;
      let r = null;
      for (const s of steps) {
        const nowMs = T + s.min * 60e3;
        r = bladeburnerHealth({ bb: bbAt(nowMs, s.rank), pr: { at: new Date(nowMs - 60e3).toISOString(), slot: { owner: "bladeburner" } }, state: { bitNode: 13, lastNodeReset: s.nodeReset ?? 1, currentWork: null, home: { ram: 256 }, playtimeSinceLastAug: 5 * 3600e3 }, prev, nowMs });
        prev = r.snap;
      }
      return r.fails.filter((f) => /^NO RANK PROGRESS/.test(f.what));
    };
    if (!drive([{ min: 0, rank: 4000 }, { min: 14.5, rank: 4000 }, { min: 29, rank: 4000 }]).length) c7.fail("flat rank over 0 / 14.5 / 29 min must FAIL (the last sample alone is 14.5 min old)");
    if (drive([{ min: 0, rank: 4000 }, { min: 14.5, rank: 4000 }, { min: 29, rank: 4100 }]).length) c7.fail("a rising rank must not fail");
    if (drive([{ min: 0, rank: 4000, nodeReset: 1 }, { min: 14.5, rank: 4000, nodeReset: 2 }, { min: 29, rank: 4000, nodeReset: 2 }]).length) c7.fail("a node entry in between restarts the window");
  }
  checks.push(c7);

  const c8 = new Check("LH8", "healthcheck.mjs decides F1/F2/F3 with exitHistOf + exitApproachVerdict, noInstallVerdict, plannerIdleVerdict (no inline copies), and tags the node's entry");
  {
    c8.examined(1);
    if (!/exitHistOf\(\{ prevHist: prev\?\.etaHist, now: \{[^}]*nodeReset: now\.nodeReset[^}]*basis: exitBasis/.test(HC)) c8.fail("F1's history must come from exitHistOf with the node entry and the basis");
    if (!/exitApproachVerdict\(\{ hist: now\.etaHist/.test(HC)) c8.fail("F1 must be exitApproachVerdict");
    if (!/noInstallVerdict\(\{[^}]*augs: augNames, plan: planRec, gate/.test(HC)) c8.fail("F2 must be noInstallVerdict on the augs, plan.txt and the gate");
    if (!/plannerIdleVerdict\(\{ hist: ph/.test(HC) || !/now\.plannerHist = pushHist/.test(HC)) c8.fail("F3 must be plannerIdleVerdict on a stored history");
    if (/fail\(`(NO INSTALL|PLANNER IDLE|EXIT NOT APPROACHING):/.test(HC)) c8.fail("an inline copy of NO INSTALL / PLANNER IDLE / EXIT NOT APPROACHING is back");
    if (!/nodeReset: num\(state\.lastNodeReset\)/.test(HC)) c8.fail("the sample must carry the save's lastNodeReset");
  }
  checks.push(c8);
  return checks;
}
