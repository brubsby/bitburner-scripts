// [RI] A READY ROUTE INSTALLS, AND A LIFE STOPS DEFERRING.
//
// Live BN8.3, 2026-10-31 12:55Z -> 2026-11-01 12:41Z (~24h of play, the life
// 47h online since its 10-28 02:31Z install): the count route was "nextSENS
// Gene Modification at Clarke Incorporated via ready" (detour 0, Clarke rep
// 13.46M against its requirement), $1.44e14 in hand and a 29-augmentation
// batch buyable (the Daedalus count 9 short). The install decision held
// 'r0.5' — "install once the route's detour is done, + 0.5h" — every pass:
//
//   * the route option's install was priced at detour + extra FROM THIS PASS,
//     so with the detour at 0 it was "install in 0.5h" forever (the exit read
//     6.2-7.0h for a day, EXIT NOT APPROACHING);
//   * its record's `install` was `key === 'now'`, so no route option could
//     ever install, however long it was held;
//   * 'r0' (the route's augmentation in a batch bought now) was dropped by the
//     `waitH > 0` filter, leaving 'now' priced WITHOUT the route (9.6h) as the
//     only install option;
//   * the gate published the route's waitH as its EXIT hours ("waiting 6.7h");
//   * the deferral ledger records only switches with an install time, and a
//     route record had none — 6 of 6 earlier deferrals had already missed by
//     80-93h and nothing refused the next one.
//
//   RI1 THE ANCHOR      a ready route's install time is fixed at the
//                       commitment and carried while held; it installs when it
//                       runs out (the old code re-anchored: install never)
//   RI2 R0              a ready route's extra-0 option is priced and installs
//                       at once when chosen
//   RI3 THE HARD BOUND  DEFER.n deferrals overshot -> every later install is
//                       refused and the decision installs now; under the bound
//                       the better wait still wins; nothing installing now
//                       priced -> the bound is not applied (and says so)
//   RI4 THE SLIDE       a HELD commitment whose install time slides (no
//                       switch) is entered in the ledger and fails the check
//   RI5 WIRING          progress.js hands the previous record's deferral check
//                       to the install decision

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const P = await import("../../plan.js");
const B = await import("../../bayes.js");

const H = 3.6e6;
const T0 = Date.parse("2026-11-01T12:40:00Z");
const ROUTE = { name: "nextSENS Gene Modification", faction: "Clarke Incorporated", via: "ready", detourH: 0, price: 1.925e9, laterPrice: 1.925e9, hacking: 1.2 };
const COUNT = { short: 9, ladder: [] };
const POST = { drift: { s: 0.1, nu: 4, a: 2, b: 0.02 }, jitter: B.PRIORS.jitter, gymSdLn: 0.1, cadence: null, expPost: null, income: null, trader: null };
const DRAWS = P.makeDraws(POST, 8, 7);

// A deterministic trajectory per spec (the live points): installing now
// without the route 9.6h; the route at its remaining extra e: 6.2 + 0.5 e;
// a plain wait w: 9.6 + w (or what `waitHours` says).
function trajOfWith(waitHours = {}) {
  const hours = (spec, d) => {
    const j = 0.01 * ((d?.i ?? 0) % 3);
    if (spec.kind === "route") return 6.2 + 0.5 * (spec.extra ?? 0) + j;
    if (spec.kind === "never") return 50 + j;
    const w = spec.waitH ?? 0;
    if (w <= 0.05) return 9.6 + j;
    const k = Object.keys(waitHours).find((x) => Math.abs(+x - w) < 0.01);
    return (k !== undefined ? waitHours[k] : 9.6 + w) + j;
  };
  return (spec) => ({
    f: (x, d) => hours(spec, d),
    fg: function* (x, d) {
      return hours(spec, d);
    },
    noiseKey: `t:${spec.kind}:${spec.extra ?? spec.waitH ?? ""}`,
  });
}
const routeWaits = (extras, extraHours = (e) => 6.2 + 0.5 * e) => extras.map((e) => ({ waitH: e, hours: extraHours(e), n: 9, lifeH: 3, extra: e, route: ROUTE }));
const decide = (o) => P.decideInstall({ inputs: {}, count: COUNT, draws: DRAWS, clock: () => 0, sameLife: true, trajOf: trajOfWith(o.waitHours), ...o });

export async function run() {
  const checks = [];

  {
    const c = new Check("RI1", "THE ANCHOR: a ready route's r0.5 installs 0.5h after it is committed (held or re-decided), not 0.5h after every pass");
    const point = { now: { hours: 9.6, n: 9, lifeH: 3 }, waits: routeWaits([0.5, 2]) };
    const d0 = decide({ point, redecide: true, now: T0 });
    c.note(`t0: ${d0.key} install ${d0.install} routeInstallAt ${d0.routeInstallAt ? new Date(d0.routeInstallAt).toISOString() : null} waitH ${d0.waitH} (${String(d0.why).slice(0, 120)})`);
    if (d0.key !== "r0.5" || d0.install !== false) c.fail("fixture: the live decision commits r0.5 and holds", `${d0.key} install ${d0.install}`);
    if (d0.routeInstallAt !== T0 + 0.5 * H) c.fail("a ready route's install must be anchored at the commitment + its extra", String(d0.routeInstallAt));
    if (!(Math.abs(d0.waitH - 0.5) < 1e-9)) c.fail("a route record's waitH is its remaining wait, not its exit hours", String(d0.waitH));
    if (d0.installAt !== T0 + 0.5 * H) c.fail("a route record carries its install time (the deferral ledger reads it)", String(d0.installAt));
    let prev = d0;
    let firstInstall = null;
    const log = [];
    for (let m = 5; m <= 40; m += 5) {
      const now = T0 + m * 60e3;
      const d = decide({ point, prev, redecide: m % 15 === 0, now });
      log.push(`+${m}m ${d.key}${d.install ? " INSTALL" : ""}`);
      if (d.install && firstInstall === null) firstInstall = m;
      if (!d.install && d.routeInstallAt !== T0 + 0.5 * H) c.fail(`+${m}m: the held anchor must not move`, String(d.routeInstallAt));
      prev = d;
    }
    c.note(log.join(", "));
    c.examined(9);
    if (firstInstall === null) c.fail("the committed ready route never installed in 40 minutes (the live deadlock: re-anchored every pass)");
    else if (!(firstInstall >= 25 && firstInstall <= 30)) c.fail(`the install must fire as the 0.5h anchor runs out (27-30 min), fired at +${firstInstall}m`);
    checks.push(c);
  }

  {
    const c = new Check("RI2", "R0: a ready route's extra-0 option (the route's augmentation bought now) is priced, and installs when chosen");
    const d = decide({ point: { now: { hours: 9.6, n: 9, lifeH: 3 }, waits: routeWaits([0, 0.5, 2]) }, redecide: true, now: T0 });
    c.examined(1);
    c.note(`${d.key} install ${d.install} options ${(d.options ?? []).map((o) => `${o.key} ${o.meanH}`).join(", ")}`);
    if (!(d.options ?? []).some((o) => o.key === "r0") && d.key !== "r0") c.fail("r0 must be an option (it was dropped by waitH > 0)");
    if (d.key !== "r0" || d.install !== true) c.fail("r0 is the soonest exit and must install now", `${d.key} install ${d.install}`);
    checks.push(c);
  }

  {
    const c = new Check("RI3", "THE HARD BOUND: DEFER.n deferrals overshot -> later installs refused, install now; under the bound the better wait wins; nothing priced now -> not applied");
    const point = { now: { hours: 9.6 }, waits: [{ waitH: 2, hours: 5, n: null }] };
    const wh = { 2: 5 };
    const broke = { ok: false, n: 6, missed: 6, why: "INSTALL DEFERRED REPEATEDLY: ..." };
    const fine = { ok: true, n: 2, missed: 2 };
    const dB = P.decideInstall({ inputs: {}, point, draws: DRAWS, clock: () => 0, sameLife: true, trajOf: trajOfWith(wh), redecide: true, now: T0, deferral: broke });
    const dF = P.decideInstall({ inputs: {}, point, draws: DRAWS, clock: () => 0, sameLife: true, trajOf: trajOfWith(wh), redecide: true, now: T0, deferral: fine });
    const dN = P.decideInstall({ inputs: {}, point: { waits: point.waits }, draws: DRAWS, clock: () => 0, sameLife: true, trajOf: trajOfWith(wh), redecide: true, now: T0, deferral: broke });
    // The live shape: the committed ready route r0.5 under a broken ledger.
    const r05 = decide({ point: { now: { hours: 9.6, n: 9, lifeH: 3 }, waits: routeWaits([0.5, 2]) }, redecide: true, now: T0 });
    const dR = decide({ point: { now: { hours: 9.6, n: 9, lifeH: 3 }, waits: routeWaits([0.5, 2]) }, prev: r05, redecide: false, now: T0 + 5 * 60e3, deferral: broke });
    c.examined(4);
    c.note(`broken ledger: ${dB.key} install ${dB.install} (${String(dB.why).slice(0, 140)}); within the bound: ${dF.key}; no 'now' priced: ${dN.key} (${String(dN.deferralRefused?.why ?? "").slice(0, 100)}); held r0.5 under the bound: ${dR.key} install ${dR.install}`);
    if (dB.key !== "now" || dB.install !== true) c.fail("past the bound the 2h wait (5h vs 9.6h) must be refused and the install made now", `${dB.key} install ${dB.install}`);
    if (!dB.deferralRefused || !dB.deferralRefused.keys.includes("w2") || !/DEFERRAL REFUSED/.test(dB.why ?? "")) c.fail("the refusal must be published and named", JSON.stringify(dB.deferralRefused));
    if (dF.key !== "w2" || dF.install !== false) c.fail("within the bound the better wait must still win", `${dF.key}`);
    if (dN.key !== "w2" || !(dN.deferralRefused && dN.deferralRefused.keys.length === 0 && /NOT applied/.test(dN.deferralRefused.why))) c.fail("with nothing installing now priced the bound must not leave the decision empty, and must say it was not applied", JSON.stringify(dN.deferralRefused));
    if (dR.install !== true) c.fail("a held r0.5 under a broken ledger must be refused and the install made now", `${dR.key} install ${dR.install}`);
    if (P.deferralRefusalOf({ ok: false, missed: P.DEFER.n - 1 }) !== null || P.deferralRefusalOf({ ok: false, missed: P.DEFER.n }) === null || P.deferralRefusalOf({ ok: null }) !== null) c.fail("deferralRefusalOf must refuse at exactly DEFER.n missed and never on an unknown check");
    checks.push(c);
  }

  {
    const c = new Check("RI4", "THE SLIDE: a held commitment whose install time slides without a switch enters the ledger, and the check fails once DEFER.n slides overshoot");
    let prev = null;
    let last = null;
    const life = 1793154683390;
    for (let k = 0; k <= 6; k++) {
      const at = T0 + k * 0.6 * H;
      const inst = { key: "r0.5", install: false, switched: false, installAt: at + 0.5 * H, promisedInstallAt: T0 + 0.5 * H };
      const rec = { at: new Date(at).toISOString(), node: 8, lastAugReset: life, exit: { meanH: 6.5 }, decisions: { install: inst } };
      rec.installDeferrals = P.installDeferralsOf(prev, rec);
      rec.installDeferral = P.installDeferralCheckOf(rec);
      prev = rec;
      last = rec;
    }
    c.examined(7);
    c.note(`ledger ${last.installDeferrals.length} row(s); ${String(last.installDeferral.why).slice(0, 200)}`);
    if (!(last.installDeferrals.length >= P.DEFER.n) || !last.installDeferrals.every((d) => d.slid === true)) c.fail("every 0.6h slide of the held r0.5 must be a ledger row", JSON.stringify(last.installDeferrals.map((d) => d.at)));
    if (last.installDeferral.ok !== false) c.fail("the held, sliding commitment must fail INSTALL DEFERRED REPEATEDLY", last.installDeferral.why);
    // Control: a held commitment that keeps its install time is not a deferral.
    const a = { at: new Date(T0).toISOString(), node: 8, lastAugReset: life, exit: { meanH: 6.5 }, decisions: { install: { key: "r0.5", install: false, switched: false, installAt: T0 + 0.5 * H, promisedInstallAt: T0 + 0.5 * H } } };
    const b = { ...a, at: new Date(T0 + 0.2 * H).toISOString(), exit: { meanH: 6.3 } };
    if (P.installDeferralsOf(a, b).length) c.fail("a held commitment on its anchored install time must not enter the ledger");
    checks.push(c);
  }

  {
    const c = new Check("RI5", "WIRING: progress.js hands the previous plan record's deferral check to the install decision, and prices the ready route's r0");
    const src = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    c.examined(2);
    if (!/decideInstallGen\(\{[^\n]*deferral: pc\.prev\?\.installDeferral \?\? null/.test(src)) c.fail("planInstallOf must pass deferral: pc.prev?.installDeferral to decideInstallGen");
    if (!/for \(const extra of \[0, 0\.5, 2\]\)/.test(src)) c.fail("the route's waits must include extra 0 (r0: the route's augmentation bought now)");
    checks.push(c);
  }

  return checks;
}
