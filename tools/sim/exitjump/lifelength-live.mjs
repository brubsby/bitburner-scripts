// THE LIVE COMMITTED LIFE LENGTH, replayed: the life length decision run pass
// after pass over the recorder's captures (tools/sim/exitjump/lifelength.mjs
// replay), then re-decided on the latest captured pass with the replay's
// incumbent — its options, key and why.
//
//   node tools/sim/exitjump/lifelength-live.mjs [/tmp/fx/hist] [HHMMSS-HHMMSS]
//
// CALIBRATION: as lifelength.mjs (the CHECK of each pass: the shipped
// trajectory re-priced against the pass's published point), printed for the
// latest pass.
import "../../test/gameresolve.mjs";
import path from "node:path";
import { REPO_ROOT } from "../../test/gameresolve.mjs";

const P = await import(path.join(REPO_ROOT, "plan.js"));
const R = await import("./lifelength.mjs");

const [src = "/tmp/fx/hist", range = "065400-235959"] = process.argv.slice(2);
const passes = R.loadPasses(src, [range]);
const rows = R.replay(passes);
const last = passes[passes.length - 1];
const lr = rows[rows.length - 1];
const lastRe = [...rows].reverse().find((r) => !r.held);
console.log(`${passes.length} passes ${passes[0].at} .. ${last.at}; the chooser changed L ${rows.filter((r, k) => k && r.oldL !== rows[k - 1].oldL).length} times, the committed length switched ${rows.filter((r) => r.switched).length} times`);
console.log(`latest pass ${last.at}: chooser L${lr.oldL} (published exit ${lr.oldExit}h); committed ${lr.newKey} ${lr.held ? "held" : lr.switched ? "SWITCHED" : "stays"}, exit on it ${lr.newExit}h; CHECK shipped point ${lr.checkH?.toFixed(2)}h vs published ${lr.pubPoint ?? "-"}h`);
console.log(`last re-decision ${lastRe.at}: ${lastRe.newKey} — ${lastRe.why}`);
for (const o of lastRe.options ?? []) console.log(`   option ${o.key.padEnd(4)} point ${o.pointH}h mean ${o.meanH}h 80% ${o.q10}-${o.q90}h P(best) ${o.pBest}`);
// Re-decided on the latest pass itself (an event now): what the rule says today.
const prevPlan = passes[passes.length - 2]?.plan;
const now = Date.parse(last.at);
const basis = prevPlan && prevPlan.lastAugReset === last.lastAugReset ? P.basisOf(prevPlan.decisions?.install ?? null, now) : null;
const draws = P.makeDraws(R.postOf(last.plan.posteriors), P.PLAN.N, P.seedOf(last.lastAugReset, last.node));
const d = P.decideLifeLength({ options: R.optionsOf(last).opts, basis, prev: lr.decision, draws, redecide: true, now, budgetMs: 1e9, reachSd: last.plan.posteriors?.s ?? null });
console.log(`re-decided on the latest pass (basis ${JSON.stringify(d.basis)}): ${d.key} — ${d.why}`);
for (const o of d.options ?? []) console.log(`   option ${o.key.padEnd(4)} point ${o.pointH}h mean ${o.meanH}h 80% ${o.q10}-${o.q90}h P(best) ${o.pBest}`);
console.log(`   points: ${d.table.map((t) => `L${t.L} ${t.pointH}h (x${t.perLife} a life)`).join(", ")}`);
if (d.screen) console.log(`   screen: ${d.screen}`);
