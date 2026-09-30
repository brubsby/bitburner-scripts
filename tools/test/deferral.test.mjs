// [DF] INSTALL DEFERRED REPEATEDLY, and the inputs that moved the held exit.
//
// Live BN9 2026-09-30, the life installed at 08:19:55Z
// (fixture-bn9-defer-1150: every plan pass 08:24-12:30Z, slimmed, with the
// exit inputs of five pass pairs, the rep-rate series and the gate's hold
// candidates). The committed install moved 09:35Z -> 11:35Z (09:14Z switch)
// -> 11:54Z (10:10Z) -> 13:24Z (11:50Z), each switch "expected 1.8-3.2h
// sooner". Every switch went to a BitRunners HOLD (200,000 rep for Neural
// Accelerator in 2.3h / 1.7h / 1.6h) that nothing worked: the slot stayed on
// New Tokyo, BitRunners gained ~2,000 rep an hour, the record dropped the
// hold, and the next pass re-planned the committed batch as a plain wait
// (hacking x1.277 -> x1.138): +3.3h on the held exit with no event, and 30
// min later the same hold won again. Realised against promised, per switch:
//   09:14Z promised exit 23:18Z; incumbent's 02:36Z; at 12:35Z 04:07Z (+4.8h)
//   10:10Z promised exit 23:07Z; incumbent's 02:04Z; at 12:35Z 04:07Z (+5.0h)
//   11:50Z promised exit 00:40Z; incumbent's 03:08Z; at 12:35Z 04:07Z (+3.5h)
// The other no-event jumps (tools/sim/exitjump/attribute-pair.mjs on the
// pairs): 09:14 -> 09:19 the rep rate (16.9 -> 4.0 rep/s, +7.6h) and the
// hold's batch (+3.3h); 09:24 -> 09:29 the rep rate (4.4 -> 17.8, -7.4h);
// 11:50 -> 11:55 the hold's batch (+2.7-3.3h); 10:30 -> 10:35 the Go favor
// stream vanishing for one pass (+1.9h) and a batch flip (+0.5-0.7h).
//
//   DF1 THE LEDGER        replayed over the live passes: three deferrals, the
//                         check passes through 11:50Z and FAILS from 11:55Z
//                         (each promise overshot by more than its own gain);
//                         planCheck fails it; a plan whose waits delivered,
//                         and a single deferral, pass
//   DF2 THE HOLD CARRIED  a hold wait's record keeps its hold, basisOf
//                         returns it, and the next pass's committed option
//                         carries it
//   DF3 THE SLOT          installHoldOf enacts a committed hold (joined, short
//                         of the target, before the install) and nothing else;
//                         progress.js points the work slot at it
//   DF4 ONE SLOT          a hold elsewhere stops the worked faction's grind in
//                         the batch a wait buys (advancedOffersOf); progress.js
//                         builds every wait's offers through it
//   DF5 THE BATCH         committedBatchOf keeps the committed batch through
//                         the live flips (10:30 -> 10:35, 11:05 -> 11:10) and
//                         makes the lost hold batch (11:50 -> 11:55) an event
//   DF6 THE REP RATE      the median of the last hour holds the live 09:19-
//                         09:39Z series within 15% of the steady rate; the
//                         09:24 -> 09:29 jump on the smoothed rate is < 1h
//   DF7 WIRING            progress.js smooths the base rep rate on the
//                         schedule record, carries the Go favor stream through
//                         an opponent switch, and publishes the deferral check

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const P = await import("../../plan.js");
const FP = await import("../../factionplan.js");
const E = await import("../../exitplan.js");
const B = await import("../../bayes.js");

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-defer-1150.json"), "utf8"));
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8");
const fin = (x) => typeof x === "number" && isFinite(x);
const pointOf = (inputs, basis) => {
  const g = basis?.gains ?? null;
  return E.bestExitPolicy({ ...inputs, firstInstallH: Math.max(0, basis?.waitH ?? 0), ...(g ? { installGains: g, nextInstallGain: g.hacking ?? null } : {}) }, 400, 1).best?.hours ?? null;
};

/** The ledger and the check, pass by pass, as publishPlan builds them. */
function replay(passes) {
  let prev = null;
  const out = [];
  for (const p of passes) {
    const rec = { ...p };
    rec.installDeferrals = P.installDeferralsOf(prev, rec);
    rec.installDeferral = P.installDeferralCheckOf(rec);
    out.push(rec);
    prev = rec;
  }
  return out;
}

export async function run() {
  const checks = [];

  {
    const c = new Check("DF1", "INSTALL DEFERRED REPEATEDLY: replayed over the live 2026-09-30 passes the ledger holds the three switches to a later install, the check passes through 11:50Z and fails from 11:55Z; planCheck fails it; waits that delivered, and one deferral, pass");
    const recs = replay(F.passes);
    c.examined(recs.length);
    const last = recs.at(-1);
    const L = last.installDeferrals ?? [];
    c.note(`ledger: ${L.map((d) => `${d.at.slice(11, 16)}Z ${d.fromInstallAt.slice(11, 16)}->${d.toInstallAt.slice(11, 16)}Z promised ${d.promisedExitAt.slice(11, 16)}Z (gain ${d.gainH}h${d.hold ? `, ${d.hold} hold` : ""})`).join("; ")}`);
    if (L.length !== 3 || L.map((d) => d.at.slice(11, 16)).join(",") !== "09:14,10:10,11:50") c.fail("the ledger must hold the three live deferrals (09:14, 10:10, 11:50)", JSON.stringify(L.map((d) => d.at)));
    const at = (hhmm) => recs.find((r) => r.at.slice(11, 16) === hhmm);
    const r1150 = at("11:50");
    const r1155 = at("11:55");
    const r1145 = at("11:45");
    c.note(`11:45Z: ${r1145.installDeferral.why.slice(0, 200)}`);
    c.note(`11:55Z: ${r1155.installDeferral.why.slice(0, 400)}`);
    if (r1145.installDeferral.ok === false) c.fail("11:45Z (two deferrals) must not fail", r1145.installDeferral.why);
    if (r1150.installDeferral.ok === false) c.fail("11:50Z (the third deferral's own pass: its promise is this pass's exit) must not fail", r1150.installDeferral.why);
    if (r1155.installDeferral.ok !== false || !/^INSTALL DEFERRED REPEATEDLY/.test(r1155.installDeferral.why)) c.fail("11:55Z must fail: each promise overshot by more than its gain", JSON.stringify(r1155.installDeferral).slice(0, 300));
    if (last.installDeferral.ok !== false) c.fail("the last pass (12:30Z) must still fail", last.installDeferral.why);
    const pc = P.planCheck({ ...last, at: last.at }, { now: Date.parse(last.at) });
    if (!pc.fails.some((f) => /^INSTALL DEFERRED REPEATEDLY/.test(f.what))) c.fail("planCheck must fail INSTALL DEFERRED REPEATEDLY", JSON.stringify(pc.fails.map((f) => f.what.slice(0, 80))));
    // Control: the same switches, the exit then arriving as each promised
    // (the exit falls 1h per hour from the last promise).
    const lastPromise = Date.parse(L.at(-1).promisedExitAt);
    const delivered = replay(F.passes.map((p) => (Date.parse(p.at) > Date.parse(L.at(-1).at) ? { ...p, exit: { ...p.exit, meanH: (lastPromise - Date.parse(p.at)) / 3.6e6 } } : p)));
    if (delivered.at(-1).installDeferral.ok === false) c.fail("control: waits that delivered their promise must pass", delivered.at(-1).installDeferral.why);
    // One deferral, overshot: a note, not a failure.
    const one = P.installDeferralCheckOf({ at: last.at, exit: last.exit, installDeferrals: [L[0]] });
    if (one.ok === false) c.fail("one deferral must not fail (n = 3)", one.why);
    // Another life's ledger is not carried.
    const other = P.installDeferralsOf({ ...last, lastAugReset: 1 }, { ...F.passes.at(-1) });
    if (other.length) c.fail("a ledger from another life must not be carried", JSON.stringify(other));
    checks.push(c);
  }

  {
    const c = new Check("DF2", "THE HOLD CARRIED: a hold wait's record keeps its hold, basisOf returns it, and the next pass's committed option carries it");
    const pr = F.pairs["1150-1155"];
    const inputs = pr.a.exitinputs.inputs;
    const now = Date.parse(pr.a.plan.at);
    const holdGains = pr.a.plan.decisions.install.gains;
    const post = { drift: { s: 0.1, nu: 4, a: 2, b: 0.02 }, jitter: B.PRIORS.jitter, gymSdLn: 0.1, cadence: null, expPost: null, income: null, trader: null };
    const draws = P.makeDraws(post, 4, 7);
    const hold = { faction: "BitRunners", repTarget: 200000 };
    const d = P.decideInstall({ inputs, point: { waits: [{ waitH: 1.5595, hours: pr.a.plan.decisions.install.pointH, installGains: holdGains, hold }] }, draws, redecide: true, now, clock: () => 0 });
    c.examined(3);
    if (d.spec?.hold?.faction !== "BitRunners" || d.spec.hold.repTarget !== 200000) c.fail("the hold wait's record must keep its hold", JSON.stringify(d.spec));
    const b = P.basisOf(d, now + 5 * 60e3);
    if (b?.hold?.faction !== "BitRunners") c.fail("basisOf must return the committed hold", JSON.stringify(b));
    const d2 = P.decideInstall({ inputs: pr.b.exitinputs.inputs, point: { waits: [], committedGains: holdGains }, prev: d, draws, redecide: false, now: now + 5 * 60e3, clock: () => 0 });
    if (d2.spec?.hold?.faction !== "BitRunners") c.fail("the next pass's committed option must carry the hold", JSON.stringify(d2.spec));
    c.note(`committed ${d.key} (hold ${d.spec?.hold?.faction}), next pass ${d2.key} spec.hold ${d2.spec?.hold?.faction ?? "none"}`);
    checks.push(c);
  }

  {
    const c = new Check("DF3", "THE SLOT: installHoldOf enacts a committed hold (joined, short of its target, before the install) and nothing else; progress.js points the work slot at it");
    const now = Date.parse("2026-09-30T11:55:00Z");
    const rec = { key: "w1.476", installAt: now + 1.4 * 3.6e6, spec: { kind: "wait", hold: { faction: "BitRunners", repTarget: 200000 } } };
    const rep = (v) => () => v;
    const cases = [
      ["joined, 14,898 of 200,000", installHoldOf(rec, { joined: ["BitRunners", "New Tokyo"], repOf: rep(14898) }), "BitRunners"],
      ["target reached", installHoldOf(rec, { joined: ["BitRunners"], repOf: rep(200001) }), null],
      ["install time passed", installHoldOf({ ...rec, installAt: now - 1 }, { joined: ["BitRunners"], repOf: rep(1) }), null],
      ["not joined", installHoldOf(rec, { joined: ["New Tokyo"], repOf: rep(1) }), "none"],
      ["another life's plan", installHoldOf(rec, { joined: ["BitRunners"], repOf: rep(1), lastAugReset: 2, planLife: 1 }), null],
      ["a plain wait", installHoldOf({ ...rec, spec: { kind: "wait" } }, { joined: ["BitRunners"], repOf: rep(1) }), null],
    ];
    function installHoldOf(r, o) {
      return P.installHoldOf(r, { now, ...o });
    }
    c.examined(cases.length);
    for (const [name, got, want] of cases) {
      const f = got === null ? null : got.faction ?? "none";
      if (f !== want) c.fail(`${name}: expected ${want}, got ${JSON.stringify(got)}`);
    }
    const src = code("progress.js");
    if (!/installHoldOf\(pr\?\.decisions\?\.install/.test(src) || !/scheduleTarget = holdLead\.faction/.test(src)) c.fail("progress.js must point the work slot at the committed hold (installHoldOf -> scheduleTarget)");
    if (!/holdLead\?\.faction \? null :/.test(src)) c.fail("a committed hold must take the slot from the schedule's company desk too");
    checks.push(c);
  }

  {
    const c = new Check("DF4", "ONE SLOT: a hold elsewhere stops the worked faction's grind in the batch a wait buys; progress.js builds every wait's offers through advancedOffersOf");
    const offers = [
      { name: "a", faction: "New Tokyo", factionRep: 10000 },
      { name: "b", faction: "BitRunners", factionRep: 14712 },
      { name: "c", faction: "Slum Snakes", factionRep: 5e6 },
    ];
    const rep = (xs, f) => xs.find((o) => o.faction === f).factionRep;
    const plain = FP.advancedOffersOf(offers, { workingF: "New Tokyo", repGain: 40000 });
    const held = FP.advancedOffersOf(offers, { workingF: "New Tokyo", repGain: 40000, hold: { faction: "BitRunners", repTarget: 200000 } });
    const same = FP.advancedOffersOf(offers, { workingF: "BitRunners", repGain: 40000, hold: { faction: "BitRunners", repTarget: 200000 } });
    const gang = FP.advancedOffersOf(offers, { workingF: "New Tokyo", repGain: 40000, hold: { faction: "BitRunners", repTarget: 200000 }, gangFaction: "Slum Snakes", gangRep: 6e6 });
    c.examined(4);
    if (rep(plain, "New Tokyo") !== 50000 || rep(plain, "BitRunners") !== 14712) c.fail("a plain wait grinds the worked faction only", JSON.stringify(plain));
    if (rep(held, "New Tokyo") !== 10000 || rep(held, "BitRunners") !== 200000) c.fail("a hold elsewhere moves the slot: the worked faction does not also grind", JSON.stringify(held));
    if (rep(same, "BitRunners") !== 200000) c.fail("a hold at the worked faction reaches its target", JSON.stringify(same));
    if (rep(gang, "Slum Snakes") !== 6e6) c.fail("the gang faction's reputation accrues whatever the slot does", JSON.stringify(gang));
    const src = code("progress.js");
    if (!/advancedOffersOf\(offers, \{ workingF, repGain, hold/.test(src)) c.fail("progress.js futureBatchAt must build the offers through advancedOffersOf");
    if (/if \(repGain > 0 && o\.faction === workingF\) rep \+= repGain/.test(src)) c.fail("the inline two-places-at-once advance is back in progress.js");
    checks.push(c);
  }

  {
    const c = new Check("DF5", "THE BATCH ON EVENTS: committedBatchOf keeps the committed batch through the live flips and makes the lost hold batch an event");
    const rows = [];
    for (const [name, want] of [["1030-1035", "held"], ["1105-1110", "held"], ["1150-1155", "event"]]) {
      const pr = F.pairs[name];
      const now = Date.parse(pr.b.plan.at);
      const basisB = P.basisOf(pr.b.plan.decisions.install, now);
      const prevGains = pr.a.plan.decisions.install.gains;
      const newGains = pr.b.plan.decisions.install.gains;
      const prevH = pointOf(pr.b.exitinputs.inputs, { ...basisB, gains: prevGains });
      const newH = pointOf(pr.b.exitinputs.inputs, { ...basisB, gains: newGains });
      const cb = P.committedBatchOf({ prevGains, newGains, prevH, newH, waitH: basisB.waitH });
      const got = cb.event ? "event" : cb.held ? "held" : "taken";
      rows.push(`${name}: ${prevH.toFixed(2)}h -> ${newH.toFixed(2)}h: ${got} (${cb.why})`);
      if (got !== want) c.fail(`${name}: expected ${want}, got ${got}`, cb.why);
    }
    c.examined(rows.length);
    for (const r of rows) c.note(r);
    const g1 = { hacking: 1.1, rep: 1, income: 1, exp: 1 };
    const g2 = { hacking: 1.2, rep: 1, income: 1, exp: 1 };
    const fresh = P.committedBatchOf({ prevGains: g1, newGains: g2, prevH: 15, newH: 15.2, waitH: 0.3 });
    if (fresh.held || fresh.event) c.fail("in the wait's last half hour the re-planned batch (what the install buys) is taken", fresh.why);
    const same = P.committedBatchOf({ prevGains: g1, newGains: { ...g1 }, prevH: null, newH: null, waitH: 2 });
    if (same.held || same.event) c.fail("the same batch is simply the re-planned one", same.why);
    const src = code("progress.js");
    if (!/committedBatchOf\(\{ prevGains: spec\.gains/.test(src) || !/if \(cb\.event\) \{\s*pcx\.events = \[\.\.\.\(pcx\.events \?\? \[\]\), cb\.event\]\s*pcx\.redecide = true/.test(src)) c.fail("progress.js must keep the committed batch through committedBatchOf and raise its move as an event");
    checks.push(c);
  }

  {
    const c = new Check("DF6", "THE REP RATE: the median of the last hour holds the live 09:19-09:39Z series within 15% of the steady rate; the 09:24 -> 09:29 jump on the smoothed rate is < 1h");
    const S = F.repSeries.filter((x) => fin(x.v));
    const rows = [];
    let worst = 0;
    for (const x of S) {
      const t = Date.parse(x.at);
      if (t < Date.parse("2026-09-30T09:19Z") || t > Date.parse("2026-09-30T09:40Z")) continue;
      const r = P.robustRateOf(S.filter((y) => Date.parse(y.at) <= t).map((y) => ({ at: y.at, v: y.v })), t);
      worst = Math.max(worst, Math.abs(Math.log(r.v / 17)));
      rows.push(`${x.at.slice(11, 16)} raw ${x.v.toFixed(1)} -> ${r.v.toFixed(1)}`);
    }
    c.examined(rows.length);
    c.note(rows.join("; "));
    if (!(rows.length >= 4) || worst > Math.log(1.15)) c.fail(`the smoothed rate must stay within 15% of ~17 rep/s through the live dips (worst x${Math.exp(worst).toFixed(2)})`);
    const pr = F.pairs["0924-0929"];
    const smooth = (p) => P.robustRateOf(S.filter((y) => Date.parse(y.at) <= Date.parse(p.plan.at) + 5e3), Date.parse(p.plan.at) + 5e3).v;
    const bA = P.basisOf(pr.a.plan.decisions.install, Date.parse(pr.a.plan.at));
    const bB = P.basisOf(pr.b.plan.decisions.install, Date.parse(pr.b.plan.at));
    const rawA = pointOf(pr.a.exitinputs.inputs, bA), rawAB = pointOf({ ...pr.a.exitinputs.inputs, repPerSec: pr.b.exitinputs.inputs.repPerSec }, bA);
    const smA = pointOf({ ...pr.a.exitinputs.inputs, repPerSec: smooth(pr.a) }, bA), smAB = pointOf({ ...pr.a.exitinputs.inputs, repPerSec: smooth(pr.b) }, bA);
    c.note(`09:24 -> 09:29 rep group: raw ${pr.a.exitinputs.inputs.repPerSec.toFixed(1)} -> ${pr.b.exitinputs.inputs.repPerSec.toFixed(1)} rep/s moves the point ${(rawAB - rawA).toFixed(2)}h; smoothed ${smooth(pr.a).toFixed(1)} -> ${smooth(pr.b).toFixed(1)} moves it ${(smAB - smA).toFixed(2)}h`);
    if (!(Math.abs(rawAB - rawA) > 5)) c.fail("control: the raw rep flip must reproduce the live jump (> 5h)");
    if (!(Math.abs(smAB - smA) < 1)) c.fail("the smoothed rate must move the point < 1h", `${(smAB - smA).toFixed(2)}h`);
    void bB;
    checks.push(c);
  }

  {
    const c = new Check("DF7", "WIRING: progress.js smooths the base rep rate on the schedule record, carries the Go favor stream through an opponent switch, publishes the deferral check and the committed batch");
    const src = code("progress.js");
    c.examined(4);
    if (!/const baseRepSmooth = robustRateOf\(baseRepObs, now\)\s*\n\s*if \(baseRepSmooth\.v !== null\) base = baseRepSmooth\.v/.test(src) || !/baseRepObs,\s*\n\s*baseRepWhy/.test(src)) c.fail("planFactionWork must publish the smoothed base rep rate and carry its samples on the schedule record");
    if (!/favorStreamWhy: `carried from \$\{prev\.inputs\.favorStreamAt\}/.test(src)) c.fail("goFavorStreamInputOf must carry the last stream through an opponent switch");
    if (!/rec\.installDeferrals = installDeferralsOf\(pc\.prevAny \?\? null, rec\)/.test(src) || !/rec\.installDeferral = installDeferralCheckOf\(rec\)/.test(src)) c.fail("publishPlan must record the deferral ledger and its check");
    if (!/committedBatch: pc\.committedBatch \?\? null/.test(src)) c.fail("publishPlan must record the committed batch verdict");
    checks.push(c);
  }

  return checks;
}
