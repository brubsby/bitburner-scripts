// [TX] TWO EXITS AT INSTALL — BitNode 9, 2026-09-29 05:42.
//
// At 05:31 /tel/plan.txt committed to installing at 05:41:25 (w0.166): exit
// 70.558h, 80% 62.3-78.6h. At 05:42 act.js installed 18 augmentations on
// "the simulated exit installing now is 104.0h". One act, two exits, 34h
// apart — and the consistency check of the day said "one trajectory".
//
// ROOT CAUSE (fixture-bn9-install-0542.json): the plan's wait options were
// priced with batches from a planPurchases call of their own (progress.js
// futures) that omitted the count tickets (ticketsWanted) and the oneoff
// context the purchase step's plan carries. BN9 is short of Daedalus's
// distinct-augmentation count, so the purchase step buys TICKETS first
// (x1.02 hacking, x1.06 income: what was actually bought), while every wait
// priced a hacking batch it never buys (x1.397 hacking, x1.951 income — and
// that income gain persisted into every later life through persistLift).
// "Install now" priced the real batch: ~101h. "Wait 15 minutes": ~71h. The
// plan committed the phantom; when the wait ran out, 'now' re-priced on the
// real batch and the install ran on 104h.
//
// THE FIX: one batch function for every install time — progress.js
// futureBatchAt -> replanAt (the purchase step's own planner) for the waits
// and the committed install (re-planned each pass, point.committedGains),
// which at wait 0 IS the purchase step's plan. And the check that makes the
// class loud: plan.installExitsOf compares the install actor's exit, the
// plan's 'now' and the exit the plan committed for the same install
// (carried through the pass on which the wait runs out); planCheck and
// installRecordCheck (healthcheck F) fail "TWO EXITS AT INSTALL".
//
// CALIBRATION: TX1 reproduces the live 30h gap between 'now' (101.6h point)
// and a 15-minute wait (71.5h point) in shape on this life's last full
// exit-input record (02:56); the exit model itself is the one the plan runs.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const X = await import("../../exitplan.js");
const P = await import("../../plan.js");
const A = await import("../../augplan.js");

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-install-0542.json"), "utf8"));
const I = F.exitinputs0256.inputs;
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

// The gains of the 18 augmentations act.js actually bought (installGainsOf's products).
const bought = (() => {
  const names = F.installLast0542.batch;
  const prod = (keys) => names.reduce((g, n) => keys.reduce((h, k) => h * (F.boughtMults[n]?.[k] > 0 ? F.boughtMults[n][k] : 1), g), 1);
  return { hacking: prod(["hacking"]), rep: prod(["faction_rep"]), income: prod(["hacking_money", "hacking_chance", "hacking_speed"]), exp: prod(["hacking_exp"]) };
})();
const phantom = F.planInstall0536.gains; // the committed w0.166/w0.083 batch
const nowH = (x) => X.bestExitPolicy({ ...x, firstInstallH: 0 }, 400, 1).best?.hours ?? null;
const waitH = (x, w, g) => X.bestExitPolicy({ ...x, firstInstallH: w, ...(g ? { installGains: g, nextInstallGain: g.hacking } : {}) }, 400, 1).best?.hours ?? null;
const draws = P.makeDraws(P.posteriorsOf({ exitSamples: [] }), 24, 0x5eed);
const T0 = Date.parse("2026-09-29T05:26:25Z");

export async function run() {
  const checks = [];

  // -----------------------------------------------------------------------
  const c1 = new Check("TX1", "THE PHANTOM WAIT (live BN9 05:21-05:42): a 15-minute wait priced with a batch the purchase step never buys reads ~30h sooner than installing now; the same wait priced with the batch the planner actually buys is within its 15 minutes of 'now' (continuity at wait 0)");
  {
    c1.examined(4);
    const live = F.planInstall0536;
    c1.note(`live 05:36 plan: committed ${live.key} ${live.meanH}h on gains ${JSON.stringify(phantom)}; live 05:21 options: now ${F.plan0531 && 101.632}h point vs w0.25 71.474h point; bought batch gains ${JSON.stringify(Object.fromEntries(Object.entries(bought).map(([k, v]) => [k, +v.toFixed(3)])))}`);
    if (!(bought.hacking < 1.05 && phantom.hacking > 1.35)) c1.fail("fixture: the bought batch should be a ticket batch (hacking ~x1.02) and the committed one a hacking batch (x1.397)");
    const hNow = nowH(I);
    const hPhantom = waitH(I, 0.25, phantom);
    const hSame = waitH(I, 0.25, I.installGains);
    c1.note(`02:56 inputs: now ${hNow?.toFixed(2)}h (the purchase step's batch ${JSON.stringify(I.installGains)}); w0.25 on the phantom batch ${hPhantom?.toFixed(2)}h; w0.25 on the purchase step's batch ${hSame?.toFixed(2)}h`);
    if (!(hNow - hPhantom > 25)) c1.fail(`the phantom batch should reproduce the ~30h gap (got ${(hNow - hPhantom).toFixed(1)}h)`);
    if (!(Math.abs(hSame - hNow) <= 0.5)) c1.fail(`one batch function: a 15-minute wait with the same batch must price within ~15 minutes of now (got ${(hSame - hNow).toFixed(2)}h)`);
    // The batch mechanism itself: with the count tickets the planner buys
    // tickets first; without them (the futures' old argument list) the same
    // money buys the hacking augmentation.
    c1.examined(1);
    const base = { r: 1.9, nodeMoneyMult: 1, owned: [], soaOwned: 0 };
    const real = { name: "Real", faction: "F", baseCost: 60e9, repReq: 0, factionRep: 1, mults: { hacking: 1.4, hacking_money: 1.5 }, prereqs: [] };
    const tix = Array.from({ length: 8 }, (_, i) => ({ name: `T${i}`, faction: "F", baseCost: (1 + i) * 1e8, repReq: 0, factionRep: 1, mults: { hacknet_node_money: 1.1 }, prereqs: [] }));
    const withT = A.planPurchases({ ...base, offers: [real, ...tix], money: 196e9, ticketsWanted: 8 });
    const noT = A.planPurchases({ ...base, offers: [real, ...tix], money: 196e9 });
    const has = (p, n) => (p?.buy ?? []).some((b) => b.name === n);
    c1.note(`planPurchases at $196b: with ticketsWanted ${withT.buy.map((b) => b.name).join(",")}; without ${noT.buy.map((b) => b.name).join(",")}`);
    if (JSON.stringify(withT.buy.map((b) => b.name).sort()) === JSON.stringify(noT.buy.map((b) => b.name).sort())) c1.fail("the count tickets must change the batch (otherwise the omitted argument would not matter)");
    if (!has(noT, "Real")) c1.fail("without tickets the planner buys the hacking augmentation");
  }
  checks.push(c1);

  // -----------------------------------------------------------------------
  const c2 = new Check("TX2", "THE INCIDENT, REPLAYED THROUGH THE PLAN: committing to a wait priced on the phantom batch, then installing when it runs out, is TWO EXITS AT INSTALL (the plan's 'now' and the actor's exit against the commitment)");
  {
    c2.examined(3);
    const hNow = nowH(I);
    const hPh = waitH(I, 0.25, phantom);
    // Pass A (as live): 'now' against a 15-minute wait on the phantom batch.
    const A1 = P.decideInstall({ inputs: I, point: { now: { hours: hNow }, waits: [{ waitH: 0.25, hours: hPh, installGains: phantom }] }, draws, now: T0, budgetMs: 1e9 });
    c2.note(`pass A: ${A1.key} ${A1.meanH}h (commitment ${A1.commitment?.key} ${A1.commitment?.meanH}h), 'now' ${A1.options?.find((o) => o.key === "now")?.meanH}h`);
    if (A1.key !== "w0.25") c2.fail(`fixture: the phantom wait should win pass A (got ${A1.key})`);
    // Pass B: the wait has run out.
    const tB = T0 + 0.25 * 3.6e6 + 60e3;
    const B1 = P.decideInstall({ inputs: I, point: { now: { hours: hNow } }, prev: A1, draws, now: tB, budgetMs: 1e9 });
    c2.note(`pass B (+16 min): ${B1.key} ${B1.meanH}h, elapsedFrom ${B1.elapsedFrom}, commitment carried ${B1.commitment?.key} ${B1.commitment?.meanH}h`);
    if (B1.key !== "now" || B1.elapsedFrom !== "w0.25") c2.fail("when the committed wait runs out the plan installs now, by elapse");
    if (B1.commitment?.key !== "w0.25") c2.fail("the commitment made for this install must be carried through the pass on which the wait runs out");
    const ie = P.installExitsOf(B1, { actorH: hNow, now: tB, si: 0.02 });
    c2.note(ie.why);
    if (ie.ok !== false || !/^TWO EXITS AT INSTALL/.test(ie.why)) c2.fail("the incident's shape must fail TWO EXITS AT INSTALL");
    if (!ie.checks?.some((k) => /actor/.test(k.what) && !k.ok)) c2.fail("the install actor's exit against the commitment must be one of the failing comparisons");
    // The live record shape: 05:36's committed w0.083 (no commitment field yet) at elapse.
    c2.examined(1);
    const liveRec = F.planInstall0536;
    const tL = liveRec.installAt + 30e3;
    const BL = P.decideInstall({ inputs: I, point: { now: { hours: hNow } }, prev: liveRec, draws, now: tL, budgetMs: 1e9 });
    const ieL = P.installExitsOf(BL, { actorH: hNow, now: tL, si: 0.02 });
    c2.note(`live record at 05:41:55: ${BL.key} ${BL.meanH}h against the carried ${BL.commitment?.key} ${BL.commitment?.meanH}h (the record predates commitments: its own exit, undated) -> ${ieL.why}`);
    if (ieL.ok !== false) c2.fail("the live 05:36 committed record (no commitment field) must be carried and fail TWO EXITS AT INSTALL at elapse");
  }
  checks.push(c2);

  // -----------------------------------------------------------------------
  const c3 = new Check("TX3", "ONE BATCH FUNCTION: waits and the committed install priced on the purchase step's batch agree with 'now' at the install (one exit); and a commitment made on the phantom is healed the pass the committed batch is re-planned (point.committedGains)");
  {
    c3.examined(3);
    const hNow = nowH(I);
    const g = I.installGains;
    // Fixed pass A: only the wait on offer, so the plan commits to it.
    const A2 = P.decideInstall({ inputs: I, point: { waits: [{ waitH: 0.25, hours: waitH(I, 0.25, g), installGains: g }] }, draws, now: T0, budgetMs: 1e9 });
    const tB = T0 + 0.25 * 3.6e6 + 60e3;
    const B2 = P.decideInstall({ inputs: I, point: { now: { hours: hNow } }, prev: A2, draws, now: tB, budgetMs: 1e9 });
    const ie2 = P.installExitsOf(B2, { actorH: hNow, now: tB, si: 0.02 });
    c3.note(`fixed: committed ${A2.key} ${A2.meanH}h -> at elapse 'now' ${B2.meanH}h, actor ${hNow.toFixed(2)}h: ${ie2.why}`);
    if (ie2.ok !== true) c3.fail("with one batch function the install's exits must agree");
    // Heal: commit on the phantom, then a held pass re-plans the committed batch.
    const A1 = P.decideInstall({ inputs: I, point: { now: { hours: hNow }, waits: [{ waitH: 0.25, hours: waitH(I, 0.25, phantom), installGains: phantom }] }, draws, now: T0, budgetMs: 1e9 });
    const tM = T0 + 0.15 * 3.6e6;
    const M1 = P.decideInstall({ inputs: I, point: { now: { hours: hNow }, committedGains: g }, prev: A1, redecide: false, draws, now: tM, budgetMs: 1e9 });
    const B3 = P.decideInstall({ inputs: I, point: { now: { hours: hNow } }, prev: M1, draws, now: tB, budgetMs: 1e9 });
    const ie3 = P.installExitsOf(B3, { actorH: hNow, now: tB, si: 0.02 });
    c3.note(`healed: phantom commitment ${A1.meanH}h -> held pass re-planned ${M1.key} ${M1.meanH}h (gains ${JSON.stringify(M1.gains)}) -> install ${B3.meanH}h: ${ie3.why}`);
    if (JSON.stringify(M1.gains) !== JSON.stringify(g)) c3.fail("a held committed install must carry this pass's batch (point.committedGains), not the frozen one");
    if (ie3.ok !== true) c3.fail("once the committed batch is re-planned the install's exits must agree");
    // Without committedGains the frozen phantom persists (the bug, kept visible).
    c3.examined(1);
    const M0 = P.decideInstall({ inputs: I, point: { now: { hours: hNow } }, prev: A1, redecide: false, draws, now: tM, budgetMs: 1e9 });
    if (JSON.stringify(M0.gains) !== JSON.stringify(phantom)) c3.fail("fixture: without a re-planned batch the commitment keeps its frozen gains");
  }
  checks.push(c3);

  // -----------------------------------------------------------------------
  const c4 = new Check("TX4", "LOUD WHERE IT IS READ: planCheck fails TWO EXITS AT INSTALL on the plan's own check (not as a graft inconsistency), and installRecordCheck fails it from /tel/install-last.txt after the install — the healthcheck's F section runs both");
  {
    c4.examined(4);
    const now = Date.parse(F.installLast0542.at) + 10 * 60e3;
    const bad = { ok: false, why: "TWO EXITS AT INSTALL: the install actor's 104.00h vs the commitment w0.166's point 70.1h priced 10 min ago differ by 33.9h (tolerance 5.2h)", checks: [] };
    const cons = P.consistencyOf({ key: "now", meanH: 104, pointH: 104, n: 24, commitment: { key: "w0.166", meanH: 70.558, pointH: 70.1, at: new Date(now - 10 * 60e3).toISOString() } }, null, { si: 0.02, atInstall: { actorH: 104, now } });
    c4.note(`consistencyOf at install: ok ${cons.ok}, graftOk ${cons.graftOk}: ${cons.why}`);
    if (cons.ok !== false || cons.install?.ok !== false) c4.fail("consistencyOf must carry the install check's failure");
    const plan = { at: new Date(now).toISOString(), lastAugReset: 1, health: "inconsistent", consistency: cons };
    const r = P.planCheck(plan, { now });
    const w = r.fails.map((f) => f.what);
    c4.note(`planCheck: ${w.join(" | ")}`);
    if (!w.some((x) => x.startsWith("TWO EXITS AT INSTALL"))) c4.fail("planCheck must fail TWO EXITS AT INSTALL");
    if (w.some((x) => x.startsWith("PLAN INCONSISTENT"))) c4.fail("an install-exit failure is not a graft-basis inconsistency");
    const rec = { ...F.installLast0542, exits: { ok: false, why: bad.why, actorH: 104, planKey: "now" } };
    const ri = P.installRecordCheck(rec, { now });
    c4.note(`installRecordCheck: ${ri.fails.map((f) => f.what).join(" | ") || ri.notes.join(" | ")}`);
    if (!ri.fails.some((f) => f.what.startsWith("TWO EXITS AT INSTALL"))) c4.fail("installRecordCheck must fail TWO EXITS AT INSTALL on the recorded verdict");
    const old = P.installRecordCheck(F.installLast0542, { now });
    if (old.fails.length) c4.fail("a record from before exits were recorded is a note, not a failure");
    const stale = P.installRecordCheck(rec, { now: now + 13 * 3.6e6 });
    if (stale.fails.length) c4.fail("the failure is held for 12h after the install, not forever");
    // The graft-only record shape (bayes.test BY12/BY17) is unchanged.
    c4.examined(1);
    const g = P.planCheck({ at: new Date(now).toISOString(), consistency: { ok: false, why: "INCONSISTENT: x" } }, { now });
    if (!g.fails.some((f) => f.what.startsWith("PLAN INCONSISTENT"))) c4.fail("a graft inconsistency still fails PLAN INCONSISTENT");
  }
  checks.push(c4);

  // -----------------------------------------------------------------------
  const c5 = new Check("TX5", "THE WIRING (source guards): progress.js plans every wait's batch through futureBatchAt -> replanAt (no planPurchases call of its own), passes the re-planned committed batch, runs the install check with the actor's exit, and the install order carries the verdict into act.js's record; healthcheck F reads it");
  {
    const prog = code("progress.js");
    const act = code("act.js");
    const hc = code("tools/healthcheck.mjs");
    c5.examined(6);
    const loop = prog.slice(prog.indexOf("futureBatchAt = (waitH"), prog.indexOf("incomeCalibration = scoreIncome("));
    if (!/const f = replanAt\(liveCapital \+ moneyGain, advanced\)/.test(loop)) c5.fail("futureBatchAt must plan through replanAt (the purchase step's planner)");
    if (/planPurchases\(/.test(loop)) c5.fail("the futures must not call planPurchases with an argument list of their own (the count tickets were lost that way)");
    if (!/const fb = futureBatchAt\(waitH, cand\)/.test(loop)) c5.fail("every wait candidate's batch comes from futureBatchAt");
    if (!/never: \{ hours: never\.best\?\.hours \?\? null \}, committedGains \}/.test(prog)) c5.fail("the install decision must receive the committed install's re-planned batch");
    if (!/atInstall: \{ actorH:/.test(prog)) c5.fail("progress.js must compare the install actor's exit (consistencyOf atInstall)");
    if (!/orders\[orders\.length - 1\]\.exits = /.test(prog)) c5.fail("the install order must carry the exit verdict");
    if (!/exits: o\.exits \?\? null/.test(act)) c5.fail("act.js must record the order's exits in /tel/install-last.txt");
    if (!/installRecordCheck\(readTel\("install-last\.txt"\)/.test(hc)) c5.fail("healthcheck section F must run installRecordCheck on /tel/install-last.txt");
  }
  checks.push(c5);

  return checks;
}
