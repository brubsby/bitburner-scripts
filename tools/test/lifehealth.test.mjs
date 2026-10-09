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
  return checks;
}
