// EXIT UNSTABLE, live BN9 2026-09-30 21:56:15Z -> 22:01:15Z: the committed
// trajectory 6.389h -> 4.328h with no event (-2.0h against 1.16h).
//
//   node tools/sim/exitjump/unstable-2201.mjs [fixture.json]   (tools/test/fixture-bn9-exitjump-2131.json `unstable`)
//
// Daedalus was re-joined between the two passes (money $161b -> $233b): the
// offer appeared, and with it exitFavor 0 -> 131.6, joinMoney/joinLevel ->
// 0 and exitRep 6390. This prices both passes on the committed trajectory
// (plan.trajectoryOf on the previous pass's install decision), then the
// 21:56 inputs with the favor the faction already held (what progress.js now
// publishes before the join). CALIBRATION: the CHECK line reproduces both
// recorded exits' points first.
import "../../test/gameresolve.mjs";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../../test/gameresolve.mjs";

const P = await import(path.join(REPO_ROOT, "plan.js"));
const U = JSON.parse(fs.readFileSync(process.argv[2] ?? path.join(REPO_ROOT, "tools/test/fixture-bn9-exitjump-2131.json"), "utf8")).unstable;
const aI = U.a;
const bI = U.b;
const aP = U.a;
const bP = U.b;
const traj = (install, at) => P.trajectoryOf(P.basisOf(install ?? null, Date.parse(at)), {});
const ta = traj(U.prevInstall, aI.at);
const tb = traj(U.a.install, bI.at);
const ha = ta(aI.inputs);
const hb = tb(bI.inputs);
console.log(`CHECK 21:56 ${ha.toFixed(3)}h (recorded exit mean ${aP.exit.meanH}h, ${aP.exit.source}); 22:01 ${hb.toFixed(3)}h (recorded ${bP.exit.meanH}h)`);
const rows = [
  ["21:56 with Daedalus's favor 131.6 (held all life)", { exitFavor: bI.inputs.exitFavor }],
  ["  + the 22:01 join (joinMoney/joinLevel 0, rep 6390)", { exitFavor: bI.inputs.exitFavor, joinMoney: 0, joinLevel: 0, exitRep: bI.inputs.exitRep }],
];
for (const [name, over] of rows) {
  const h = ta({ ...aI.inputs, ...over });
  console.log(`${name.padEnd(56)} ${h.toFixed(3)}h (${(h - ha >= 0 ? "+" : "") + (h - ha).toFixed(3)}h)`);
}
