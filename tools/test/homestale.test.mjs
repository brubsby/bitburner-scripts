// HOMEUP BLOCKED / HOME UNPRICED on records from before the life or the node
// (live BN12 2026-10-09, ~15-min lives; healthcheck 19:40Z).
//
//   HS1  watchdog.js "homeup.js blocked 11 cycles" -> health 'error': the
//        install at 19:34:44Z left installgate.txt on the previous life
//        (lastAugReset 1791571764703) until progress.js's first pass of the
//        new one rewrote it at 19:39:49Z (joinClaim 1e11, planned false: both
//        claims readable). 11 cycles x 30s = the 5.1 min gap. Not a missing
//        field: the fail-closed readers refusing a stale life, escalated as
//        "cannot resolve itself" though progress.js resolves it. Inside the
//        first GATE_NEW_LIFE_MIN of a life a previous-life gate holds the
//        upgrade (no spend) WITHOUT blocking; past it, or a gate from no
//        life at all, it blocks as before. A job that stops being blocked
//        drops its stale blockedFor count from the record.
//   HS2  HOME UNPRICED read /tel/homeup.txt from BitNode 9 (2026-10-07,
//        homeRam 128, cores 1, next RAM $503m) against a 65536GB/4-core home
//        — homeup.js has not run this node. The next upgrade comes from the
//        watchdog's own priced record (jobs['homeup.js'].next, now carrying
//        the home it priced); a homeup.txt whose home is not the live one is
//        rejected, named.
//   HS3  progress.js priced the home spend's gain on that record's homeRam
//        (128) and cores (1): it now takes the home the watchdog priced.
import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const B = await import("../../budget.js");
const L = await import("../lifehealth.mjs");
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8");

export async function run() {
  const checks = [];
  const c1 = new Check("HS1", "a previous life's installgate in a new life's first minutes holds the home upgrade without blocking; later, or from no life, it blocks");
  {
    c1.examined(5);
    const oldGate = JSON.stringify({ at: "2026-10-09T19:34:29.896Z", lastAugReset: 1791571764703, joinClaim: 1e11, planned: true, plan: { totalCost: 2e9 } });
    const life = 1791574485019; // 19:34:45Z
    const at = (min) => life + min * 60e3;
    const young = B.gateNewLifeWait?.(oldGate, life, at(4));
    if (!(young && typeof young.why === "string" && /previous life/.test(young.why))) c1.fail(`4 min into the life a previous-life gate must WAIT, not block: ${JSON.stringify(young)}`);
    if (B.gateNewLifeWait?.(oldGate, life, at(12)) !== null) c1.fail("12 min into the life it must no longer be excused (blocked by the readers)");
    const sameLife = JSON.stringify({ lastAugReset: life, joinClaim: null });
    if (B.gateNewLifeWait?.(sameLife, life, at(2)) !== null) c1.fail("this life's gate with an unreadable claim is NOT excused: the publisher missed a field");
    if (B.gateNewLifeWait?.("", life, at(2)) !== null || B.gateNewLifeWait?.("{nope", life, at(2)) !== null) c1.fail("absent or malformed gate is not excused");
    const wd = code("watchdog.js");
    c1.examined(1);
    if (!/const wait = gateNewLifeWait\(claimSrc, claimLife, Date\.now\(\)\)/.test(wd) || !/if \(wait\) return false/.test(wd)) c1.fail("watchdog homeup trigger must hold (return false) on gateNewLifeWait before the claim readers block");
    if (!/if \(!blocked\) delete rec\.blockedFor/.test(wd)) c1.fail("a job no longer blocked must drop its blockedFor count from the record");
  }
  checks.push(c1);

  const c2 = new Check("HS2", "the healthcheck's next home upgrade is the watchdog's priced record; a homeup.txt for another home is rejected");
  {
    c2.examined(4);
    const stale = { at: "2026-10-07T15:04:08.569Z", next: { kind: "RAM", cost: 503418951.7 }, homeRam: 128, cores: 1 };
    const wd = { jobs: { "homeup.js": { next: { kind: "cores", cost: 3164062500000, homeRam: 65536, cores: 4 } } } };
    const home = { ram: 65536, cores: 4 };
    const a = L.homeNextOf?.({ homeup: stale, watchdog: wd, home });
    if (!(a?.next?.kind === "cores" && a.next.cost === 3164062500000)) c2.fail(`the watchdog's priced next must win: ${JSON.stringify(a)}`);
    const b = L.homeNextOf?.({ homeup: stale, watchdog: null, home });
    if (!(b && b.next === null && /128GB/.test(b.why))) c2.fail(`a homeup.txt for a 128GB home against a 65536GB one is rejected, named: ${JSON.stringify(b)}`);
    const c = L.homeNextOf?.({ homeup: { ...stale, homeRam: 65536, cores: 4 }, watchdog: null, home });
    if (!(c?.next?.kind === "RAM")) c2.fail(`a homeup.txt for the live home stands: ${JSON.stringify(c)}`);
    if (L.homeNextOf?.({ homeup: null, watchdog: null, home })?.next !== null) c2.fail("nothing to read is no next");
    const hc = code("tools/healthcheck.mjs");
    c2.examined(1);
    if (!/const huNext = homeNextOf\(\{ homeup: readTel\("homeup\.txt"\), watchdog: tel\["watchdog\.txt"\] \?\? readTel\("watchdog\.txt"\), home: state\.home \}\)\.next/.test(hc)) c2.fail("healthcheck F7 must take the next upgrade from homeNextOf");
  }
  checks.push(c2);

  const c3 = new Check("HS3", "progress.js prices home on the home the watchdog priced, never on a stale homeup.txt's homeRam/cores");
  {
    c3.examined(1);
    const wd = code("watchdog.js");
    if (!/homeNext = next \? \{ \.\.\.next, homeRam: ram, cores \} : null/.test(wd)) c3.fail("the watchdog's homeup record must carry the home it priced (homeRam, cores)");
    const pj = code("progress.js");
    if (!/const homeRam = wdNext\?\.homeRam > 0 \? wdNext\.homeRam : null/.test(pj) || !/const homeCores = wdNext\?\.cores > 0 \? wdNext\.cores : null/.test(pj)) c3.fail("progress.js must take homeRam/cores from the watchdog's record");
  }
  checks.push(c3);
  return checks;
}
