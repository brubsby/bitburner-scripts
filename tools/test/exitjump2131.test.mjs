// [IR] AN INSTALL RESETS THE EXIT FACTION — the install prices the life that follows.
//
// Live BN9 2026-09-30 (fixture-bn9-exitjump-2131.json): the 21:31:41Z install
// (10 NeuroFlux levels, not terminal) was priced 'now' at 4.571h (plan mean
// 4.50h); the new life's first pass priced point 7.27h / mean 7.42h at 0.08h
// — EXIT JUMP AT INSTALL +2.8h against a 1.09h tolerance.
// tools/sim/exitjump/attribute-2131.mjs, group by group:
//   the new life priced the Red Pill's 2.5m rep at favor 0: Daedalus was not
//     re-joined yet, and exitFavor read only the offer's favor — Daedalus
//     held 131.6 (x2.32 on the grind)                               -2.05h
//   the pre-install sim counted the 201k rep in hand after the install +0.13h
//     ...at favor 85.5 where the install banks 131.4                -0.30h
//     ...and joined (no $100b / hacking 2500 re-join; hidden here by
//     the slot's grafts)                                              0.00h
//   ...at a rate carrying the +51% IPvGO faction_rep the install zeroes +0.60h
//
//   IR1 THE INCIDENT REPRODUCED  the old model on the recorded inputs: the
//                                actor's 4.571h (<1%), the new life's 7.267h
//                                (<1%), and EXIT JUMP fails
//   IR2 THE INSTALL RESETS IT    exitplan: under a policy with an install the
//                                rep in hand is 0, the favor is the install's
//                                addRepToFavor, the re-join is hoarded and the
//                                IPvGO bonus is out of the rate; holding to the
//                                exit (no install) keeps all four as today
//   IR3 THE FIX ON THE FIXTURE   the pre inputs with the re-join and the bonus,
//                                the post inputs at Daedalus's favor: EXIT JUMP
//                                passes (plan.exitJumpOf)
//   IR4 THE HOLD CLOCK           progress.js lifeGraftHoldOf: a life-1 graft
//                                pending for hours while no install is due
//                                does not release the hold the first time an
//                                install is; the cap runs from the first
//                                install held, at the leg priced then
//   IR6 EXIT UNSTABLE AT THE JOIN the same input moving back: 21:56Z ->
//                                22:01Z (6.389h -> 4.328h, no event) is
//                                Daedalus re-joined — exitFavor 0 -> 131.6 as
//                                its offer appeared; priced at the favor it
//                                held all life the step is inside tolerance
//   IR5 WIRING                   progress.js publishes the favor member or
//                                not, the re-join requirement and the IPvGO
//                                bonus; the held branch starts the clock

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const P = await import("../../plan.js");
const E = await import("../../exitplan.js");
const FV = await import("../../favor.js");

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-exitjump-2131.json"), "utf8"));
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
const PRE = F.pre.inputs;
const POST = F.post.inputs;
const G = F.pre.install.batchGains;
const GO = 1 + F.pre.goBonusPct / 100;
const pricePre = (over = {}) => E.bestExitPolicy({ ...PRE, firstInstallH: 0, installGains: G, nextInstallGain: G.hacking, ...over }, 400, 1).best;
const pricePost = (over = {}) => E.bestExitPolicy({ ...POST, ...over }).best;
// The old model on the current code: the rep in hand counted after the install at today's favor.
const OLD = { terminalRep: PRE.terminalRep - PRE.exitRep, exitRep: 0 };
const jumpOf = (preH, postH) => P.exitJumpOf({ ...F.installLast, exits: { actorH: preH } }, { pointH: postH, n: 24 }, { lastAugReset: F.post.lastAugReset, now: Date.parse(F.post.exitJump.first.at) });
const f3 = (x) => x.toFixed(3);

export async function run() {
  const checks = [];

  {
    const c = new Check("IR1", "THE INCIDENT REPRODUCED: the old model on the recorded inputs prices the actor's 'now' and the new life's point within 1%, and EXIT JUMP fails");
    const pre = pricePre(OLD).hours;
    const post = pricePost().hours;
    c.examined(2);
    c.note(`pre 'now' ${f3(pre)}h vs the actor's ${F.pre.install.pointH}h; post ${f3(post)}h vs the new life's ${F.post.exitJump.first.pointH}h`);
    if (Math.abs(pre / F.pre.install.pointH - 1) > 0.01) c.fail(`the pre side does not reproduce the actor: ${pre} vs ${F.pre.install.pointH}`);
    if (Math.abs(post / F.post.exitJump.first.pointH - 1) > 0.01) c.fail(`the post side does not reproduce the new life: ${post} vs ${F.post.exitJump.first.pointH}`);
    const j = jumpOf(pre, post);
    c.note(j.why.slice(0, 220));
    if (j.ok !== false) c.fail(`EXIT JUMP must fail on the old model: ${j.why}`);
    checks.push(c);
  }

  {
    const c = new Check("IR2", "THE INSTALL RESETS THE EXIT FACTION (exitplan): after an install the rep in hand is 0, the favor is addRepToFavor(favor, rep), the re-join is priced and the IPvGO rep bonus is out of the rate; holding to the exit keeps today's");
    const fav = FV.addRepToFavor(PRE.exitFavor, PRE.exitRep);
    const base = { ...PRE, firstInstallH: 0, installGains: G, nextInstallGain: G.hacking };
    for (const k of [1, 2]) {
      const a = E.exitHours(base, k, true).hours;
      const b = E.exitHours({ ...base, exitRep: 0, exitFavor: fav }, k, true).hours;
      c.note(`${k} install(s): as published ${f3(a)}h; 0 rep at favor ${fav.toFixed(1)} ${f3(b)}h`);
      if (Math.abs(a - b) > 1e-9) c.fail(`${k} install(s): the rep in hand must convert to favor at the install (${a} vs ${b})`);
    }
    const h0 = E.exitHours(base, 0, true).hours;
    const h0z = E.exitHours({ ...base, exitRep: 0 }, 0, true).hours;
    c.note(`no install: ${f3(h0)}h with the rep in hand, ${f3(h0z)}h without`);
    if (!(h0 < h0z)) c.fail(`holding to the exit, the rep in hand counts (${h0} vs ${h0z})`);
    // The re-join: a member (joinMoney 0) hoards $100b after an install and not before one.
    const legsOf = (o, k) => E.exitHours(o, k, false).legs.map((l) => l.leg);
    const withRe = { ...base, rejoinMoney: F.pre.rejoinMoney, rejoinLevel: F.pre.rejoinLevel };
    const L1 = legsOf(withRe, 1);
    const L0 = legsOf(withRe, 0);
    c.examined(5);
    if (!L1.includes("hoard join money")) c.fail(`after an install the re-join money is hoarded: legs ${L1.join(", ")}`);
    if (L0.includes("hoard join money")) c.fail(`a member holding to the exit has nothing to join: legs ${L0.join(", ")}`);
    // The IPvGO bonus: out of the rate after an install, kept without one.
    const r1 = E.exitHours({ ...base, preInstallRepMult: GO }, 1, true).hours;
    const r1n = E.exitHours({ ...base, repPerSec: PRE.repPerSec / GO }, 1, true).hours;
    const r0 = E.exitHours({ ...base, preInstallRepMult: GO }, 0, true).hours;
    c.note(`the +${F.pre.goBonusPct.toFixed(1)}% bonus: 1 install ${f3(E.exitHours(base, 1, true).hours)}h -> ${f3(r1)}h (= the rate / ${GO.toFixed(3)}: ${f3(r1n)}h); no install ${f3(h0)}h -> ${f3(r0)}h`);
    if (Math.abs(r1 - r1n) > 1e-9) c.fail(`after an install the bonus is divided out of the rate (${r1} vs ${r1n})`);
    if (Math.abs(r0 - h0) > 1e-9) c.fail(`holding to the exit keeps the bonus (${r0} vs ${h0})`);
    checks.push(c);
  }

  {
    const c = new Check("IR3", "THE FIX ON THE FIXTURE: the actor's 'now' with the re-join and the IPvGO bonus, the new life at Daedalus's favor — EXIT JUMP passes");
    const pre = pricePre({ rejoinMoney: F.pre.rejoinMoney, rejoinLevel: F.pre.rejoinLevel, preInstallRepMult: GO }).hours;
    const post = pricePost({ exitFavor: F.post.daedalusFavor }).hours;
    const j = jumpOf(pre, post);
    c.examined(1);
    c.note(`pre 'now' ${f3(pre)}h (old ${f3(pricePre(OLD).hours)}h); post ${f3(post)}h (published ${F.post.exitJump.first.pointH}h): ${j.why.slice(0, 200)}`);
    if (j.ok !== true) c.fail(`EXIT JUMP must pass on the fixed model: ${j.why}`);
    checks.push(c);
  }

  {
    const c = new Check("IR4", "THE HOLD CLOCK: a life-1 graft pending for hours while no install is due still holds the first install that is; released only past the cap from the first install held");
    const src = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    const m = src.match(/let lifeHoldSince = null[\s\S]*?\nfunction lifeGraftHoldStart[\s\S]*?\n}\n/);
    if (!m) {
      c.fail("progress.js: lifeHoldSince / lifeGraftHoldOf / lifeGraftHoldStart not found");
      checks.push(c);
    } else {
      const H = new Function(`${m[0]}\nreturn { lifeGraftHoldOf, lifeGraftHoldStart }`)();
      const reset = F.pre.lastAugReset;
      const d = (legH) => ({ key: "grafts", grafts: [{ name: "OmniTek InfoLoad", life: 1 }], lifeNow: { lifeH: legH } });
      const none = new Set();
      const t = (hhmm) => Date.parse(`2026-09-30T${hhmm}:00Z`);
      // Pending from 18:36Z under a counting-down wait: no install held.
      for (const [at, leg] of [["18:36", 3.83], ["19:31", 2.92], ["20:31", 1.92], ["21:26", 0.999]]) {
        const h = H.lifeGraftHoldOf(d(leg), none, reset, t(at));
        if (!h.hold) c.fail(`${at}Z: nothing held yet, the hold must stand (${h.why})`);
      }
      // 21:31Z: the install is due, priced with the graft first (0.92h) — held; the clock starts.
      const h1 = H.lifeGraftHoldOf(d(0.916), none, reset, t("21:31"));
      if (!h1.hold) c.fail(`21:31Z: the first install due must be held for this life's graft (${h1.why})`);
      H.lifeGraftHoldStart(h1, t("21:31"));
      const h2 = H.lifeGraftHoldOf(d(0.5), none, reset, t("23:30"));
      const h3 = H.lifeGraftHoldOf(d(0.5), none, reset, t("21:31") + 2.8 * 3.6e6);
      c.examined(7);
      c.note(`21:31Z ${h1.why}; 23:30Z hold ${h2.hold} (${h2.heldH?.toFixed(2)}h of ${h2.capH?.toFixed(2)}h); +2.8h ${h3.why}`);
      if (!h2.hold) c.fail(`2.0h after the first held install the cap (3 x 0.92h) has not passed: ${h2.why}`);
      if (h3.hold) c.fail(`past the cap from the first held install the hold is released: ${h3.why}`);
      // Grafts done: the clock resets.
      H.lifeGraftHoldOf({ key: "grafts", grafts: [] }, none, reset, t("21:31") + 2.9 * 3.6e6);
      const h4 = H.lifeGraftHoldOf(d(0.9), none, reset, t("21:31") + 3 * 3.6e6);
      if (!h4.hold || h4.heldH !== 0) c.fail(`a new pending graft after the set emptied starts unheld: ${h4.why}`);
      checks.push(c);
    }
  }

  {
    const c = new Check("IR6", "EXIT UNSTABLE AT THE JOIN (22:01Z): the -2.0h step is the favor published only once Daedalus re-joined; at the favor it held all life the step is inside the recorded tolerance");
    const U = F.unstable;
    const trajA = P.trajectoryOf(P.basisOf(U.prevInstall ?? null, Date.parse(U.a.at)), {});
    const trajB = P.trajectoryOf(P.basisOf(U.a.install ?? null, Date.parse(U.b.at)), {});
    const dt = (Date.parse(U.b.at) - Date.parse(U.a.at)) / 3.6e6;
    const tol = U.b.exitStability.tolH;
    const ha = trajA(U.a.inputs);
    const hb = trajB(U.b.inputs);
    const haF = trajA({ ...U.a.inputs, exitFavor: U.b.inputs.exitFavor });
    c.examined(3);
    c.note(`21:56Z ${f3(ha)}h (recorded mean ${U.a.exit.meanH}h) -> 22:01Z ${f3(hb)}h (recorded ${U.b.exit.meanH}h): ${f3(hb - ha + dt)}h against ${tol}h; at Daedalus's favor ${U.b.inputs.exitFavor.toFixed(1)} before the join: 21:56Z ${f3(haF)}h, step ${f3(hb - haF + dt)}h`);
    if (U.a.inputs.exitFavor !== 0 || !(U.b.inputs.exitFavor > 100) || U.b.inputs.joinMoney !== 0 || !(U.a.inputs.joinMoney > 0)) c.fail("the fixture's two passes are not the join (favor 0 -> >100, joinMoney > 0 -> 0)");
    if (!(Math.abs(hb - ha + dt) > tol)) c.fail(`the recorded step must reproduce beyond tolerance: ${hb - ha + dt} vs ${tol}`);
    if (!(Math.abs(hb - haF + dt) <= tol)) c.fail(`at the favor held all life the join must not move the exit beyond tolerance: ${hb - haF + dt} vs ${tol}`);
    checks.push(c);
  }

  {
    const c = new Check("IR5", "WIRING: progress.js publishes the exit faction's favor member or not, the re-join requirement and the IPvGO bonus; the held-install branch starts the hold's clock");
    const src = code("progress.js");
    const need = [
      [/exitFavor: rp\?\.favor \?\? exitFactionNow\?\.favor \?\? 0/, "exitFavor falls back to the faction's own favor (snapshot factionFavor)"],
      [/exitFactionNow = \{ favor: [^\n]*sing\.factionFavor\(EXIT_FACTION\)|const fav = sing\.factionFavor\(EXIT_FACTION\)/, "the favor read from the snapshot, member or not"],
      [/rejoinMoney: moneyNeeds\(exitFactionNow\?\.reqs\)/, "rejoinMoney from the invitation's static requirements"],
      [/rejoinLevel: exitFactionHackReq\(/, "rejoinLevel from the invitation's hacking branch"],
      [/preInstallRepMult: 1 \+ goBonus\(ns\) \/ 100/, "the IPvGO rep bonus the install zeroes"],
      [/lifeGraftHold\?\.hold\) \{\s*lifeGraftHoldStart\(lifeGraftHold\)/, "the held branch starts the clock"],
      [/exitFactionNow = null\s*\{/, "reset every pass"],
    ];
    c.examined(need.length);
    for (const [re, what] of need) if (!re.test(src)) c.fail(`progress.js: ${what}`);
    checks.push(c);
  }

  return checks;
}
