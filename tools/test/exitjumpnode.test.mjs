// [NJ] A NODE ENTRY IS NOT AN INSTALL: EXIT JUMP AT INSTALL compares an
// install only with the next life in the SAME BitNode instance.
//
// Live 2026-10-09 (fixture-exitjump-nodechange.json, the records as the game
// wrote them): The Red Pill's install at 22:21:20Z in BN12.1 (terminal, actor
// 0.50h), the node destroyed at 22:25:22Z into BN12.2 — the new life's
// lastAugReset 4 minutes after the install, inside EXIT_JUMP.matchMin, so
// installBeganLife took it for the install's life. Its passes then failed
// "EXIT JUMP AT INSTALL (2026-10-09T22:21:20.437Z): the new life's point
// 15.02h vs the install actor's 0.50h less 0.67h: +15.183h", and the
// healthcheck kept failing on /tel/exitjump.txt after the bit-flume into BN7.
//
//   NJ1 THE LIVE SHAPE    exitJumpOf on the BN12.2 life (lastNodeReset =
//                         its lastAugReset, after the install): not compared,
//                         "not compared: node changed"; and a carried failing
//                         verdict is dropped, not kept
//   NJ2 THE HEALTHCHECK   installRecordCheck on the live install-last.txt and
//                         exitjump.txt (no stamps: the records predate them)
//                         with the BN7 plan.txt: no failure, a note naming it
//   NJ3 STAMPS            a record stamped with node / lastNodeReset: another
//                         node or another instance of the same node is not
//                         compared, in exitJumpOf and in installRecordCheck
//   NJ4 STILL A CHECK     the same numbers inside one node instance (not
//                         terminal, the node entered before the install) still
//                         fail EXIT JUMP AT INSTALL
//   NJ5 WIRING            act.js stamps install-last.txt with the node and its
//                         entry; progress.js passes both to exitJumpOf and
//                         stamps exitjump.txt with them

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const P = await import("../../plan.js");
const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-exitjump-nodechange.json"), "utf8"));
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8");
const REC = F.installLast;
const JUMP = F.exitJump;
const POST = F.post;
const AT = Date.parse(POST.worstAt);
const jumpOf = (rec, over = {}) => P.exitJumpOf(rec, POST.worstExit, { lastAugReset: POST.lastAugReset, now: AT, prev: null, ver: JUMP.ver, ...over });
// The BN7 plan.txt carries no exitJump for this install (the life is not the install's).
const PLAN7 = { node: F.now.node, exitJump: { ok: null, why: "the last install record is not the install that began this life" } };

export async function run() {
  const checks = [];

  {
    const c = new Check("NJ1", "THE LIVE SHAPE: the BN12.1 Red Pill install against the BN12.2 life is not compared ('not compared: node changed'), and a carried failing verdict is dropped");
    const j = jumpOf(REC, { node: POST.node, lastNodeReset: POST.lastNodeReset });
    c.note(j.why);
    if (j.ok !== null) c.fail(`a node entry is not an install: expected ok null, got ${j.ok} (${j.why})`);
    if (!/^not compared: node changed/.test(String(j.why))) c.fail(`the reason must say 'not compared: node changed': ${j.why}`);
    if (j.install) c.fail("no install side may be recorded (progress.js writes /tel/exitjump.txt only for a record with an install)");
    // The same life with the failing record carried from an earlier pass.
    const k = P.exitJumpOf(REC, POST.worstExit, { lastAugReset: POST.lastAugReset, now: AT, prev: JUMP, ver: JUMP.ver, node: POST.node, lastNodeReset: POST.lastNodeReset });
    if (k.ok !== null) c.fail(`the carried failing verdict must not survive a node change: ${k.why}`);
    // Without the node stamps (an old caller): the terminal install alone says it.
    const t = jumpOf(REC);
    c.note(`no life stamps: ${t.why}`);
    if (t.ok !== null || !/node changed/.test(String(t.why))) c.fail(`The Red Pill's install ends the node: ${t.why}`);
    c.examined(3);
    checks.push(c);
  }

  {
    const c = new Check("NJ2", "THE HEALTHCHECK: installRecordCheck on the live install-last.txt / exitjump.txt (unstamped) and the BN7 plan.txt reports no EXIT JUMP AT INSTALL, a note naming the node change");
    const r = P.installRecordCheck(REC, { now: Date.parse(F.now.at), jump: JUMP, plan: PLAN7 });
    for (const n of r.notes) c.note(n.slice(0, 200));
    if (r.fails.some((f) => /EXIT JUMP AT INSTALL/.test(f.what))) c.fail(`still fails across the node change: ${r.fails.map((f) => f.what).join(" | ").slice(0, 300)}`);
    if (!r.notes.some((n) => /not compared: node changed/.test(n))) c.fail("the note must say 'not compared: node changed'");
    c.examined(1);
    checks.push(c);
  }

  {
    const c = new Check("NJ3", "STAMPS: an install stamped with another BitNode, or another instance of the same one, is not compared (exitJumpOf and installRecordCheck)");
    const base = { ...REC, terminal: false };
    const cases = [
      ["another BitNode", { ...base, node: 12, lastNodeReset: 1791500000000 }, { node: 7, lastNodeReset: 1791500000000 }],
      ["another instance", { ...base, node: 12, lastNodeReset: 1791500000000 }, { node: 12, lastNodeReset: 1791584722890 }],
      ["entered after the install", base, { node: null, lastNodeReset: POST.lastNodeReset }],
    ];
    for (const [name, rec, life] of cases) {
      const j = jumpOf(rec, life);
      c.note(`${name}: ${j.why}`);
      if (j.ok !== null || !/^not compared: node changed/.test(String(j.why))) c.fail(`${name}: ${j.why}`);
      const hj = { ...JUMP, node: life.node, lastNodeReset: life.lastNodeReset };
      const r = P.installRecordCheck(rec, { now: Date.parse(F.now.at), jump: hj, plan: PLAN7 });
      if (r.fails.some((f) => /EXIT JUMP AT INSTALL/.test(f.what))) c.fail(`${name}: the healthcheck still fails on the stamped jump record`);
    }
    c.examined(cases.length * 2);
    checks.push(c);
  }

  {
    const c = new Check("NJ4", "STILL A CHECK: the same numbers inside one node instance fail EXIT JUMP AT INSTALL, in exitJumpOf and in the healthcheck");
    const same = { ...REC, terminal: false, node: 12, lastNodeReset: 1791500000000 };
    const j = jumpOf(same, { node: 12, lastNodeReset: 1791500000000 });
    c.note(String(j.why).slice(0, 200));
    if (j.ok !== false || !/EXIT JUMP AT INSTALL/.test(String(j.why))) c.fail(`one node instance: the jump must still fail: ${j.why}`);
    const r = P.installRecordCheck(same, { now: Date.parse(F.now.at), jump: { ...JUMP, node: 12, lastNodeReset: 1791500000000 }, plan: PLAN7 });
    if (!r.fails.some((f) => /EXIT JUMP AT INSTALL/.test(f.what))) c.fail("one node instance: the healthcheck must still fail");
    c.examined(2);
    checks.push(c);
  }

  {
    const c = new Check("NJ5", "WIRING: act.js stamps install-last.txt with currentNode and lastNodeReset; progress.js passes both to exitJumpOf and stamps exitjump.txt");
    const act = code("act.js");
    const prog = code("progress.js");
    if (!/install-last\.txt', JSON\.stringify\(\{[^\n]*node: info\.currentNode[^\n]*lastNodeReset: info\.lastNodeReset/.test(act)) c.fail("act.js: the install record carries no node / lastNodeReset stamp");
    if (!/exitJumpOf\([^\n]*node: info\?\.currentNode[^\n]*lastNodeReset: info\?\.lastNodeReset/.test(prog)) c.fail("progress.js: exitJumpOf is not given the life's node and lastNodeReset");
    if (!/exitjump\.txt', JSON\.stringify\(\{[^\n]*node: info\?\.currentNode[^\n]*lastNodeReset: info\?\.lastNodeReset/.test(prog)) c.fail("progress.js: /tel/exitjump.txt carries no node / lastNodeReset stamp");
    c.examined(3);
    checks.push(c);
  }

  return checks;
}
