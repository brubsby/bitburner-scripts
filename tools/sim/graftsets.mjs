// THE BEST GRAFT SET, WITH AND WITHOUT QLINK, on a captured live plan
// (tools/sim/capture-plan.mjs): graftplan.chooseGrafts on the committed
// install decision's trajectory (plan.basisOf / trajectoryOf) — the graft
// decision's own pricing — seeded as progress.js seeds it (the committed
// set, the node's memory), with no CPU budget.
//
//   node tools/sim/graftsets.mjs capture.json [--4s]
//
// Three runs: the search as shipped (QLink free to stay or go), QLink forced
// (seeded and never pruned: a search whose candidates hold it and whose prune
// cannot drop it), and QLink excluded from the candidates. Each prints the
// set, its schedule, start balance and the point exit, then the committed
// (captured) set re-priced on the same trajectory.
// CALIBRATION: the CHECK line re-prices the committed set against the plan's
// own graft decision (decisions.grafts.withH) on the captured inputs.
import "../test/gameresolve.mjs";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../test/gameresolve.mjs";

const P = await import(path.join(REPO_ROOT, "plan.js"));
const GP = await import(path.join(REPO_ROOT, "graftplan.js"));
const T = await import(path.join(REPO_ROOT, "traderw.js"));

const argv = process.argv.slice(2);
const C = JSON.parse(fs.readFileSync(argv[0] ?? "/tmp/plan-capture.json", "utf8"));
const four = argv.includes("--4s");
const I = { ...C.exitinputs.inputs };
if (four) {
  const pr = T.RW_PRIOR["4S-long"];
  Object.assign(I, { capitalReturnPerSec: pr.r0PerHour / 3600, capitalScaleW: pr.Wstar, capitalShape: pr.shape, fourS: null });
}
const base = { ...I };
delete base.finalGrafts;
delete base.lifeGrafts;
delete base.graftStartMoney;
const basis = P.basisOf(C.plan.decisions?.install ?? null, Date.parse(C.exitinputs.at));
const traj = P.trajectoryOf(basis);
const committed = [...(I.lifeGrafts ?? []), ...(I.finalGrafts ?? [])];
const seed = committed.map((g) => g.name);
const mem = C.plan.graftMemory?.names ?? [];
const intel = C.plan.decisions?.grafts?.intelligence ?? 0;
const inst = C.owned ?? [];
console.log(`capture ${C.at}: basis ${basis?.kind} wait ${basis?.waitH?.toFixed(2)}h${four ? ", trader on the 4S prior curve" : ""}; ${C.candidates.length} candidates`);
const committedH = traj({ ...base, lifeGrafts: I.lifeGrafts, finalGrafts: I.finalGrafts, graftStartMoney: I.graftStartMoney });
console.log(`CHECK the plan's graft decision withH ${C.plan.decisions?.grafts?.withH}h vs the committed set re-priced here ${committedH?.toFixed(3)}h`);
console.log(`committed set (${committed.length}, start $${(I.graftStartMoney / 1e9).toFixed(1)}b): ${committedH?.toFixed(2)}h; nothing: ${traj(base)}`);
function run(label, cands, opts = {}) {
  let n = 0;
  const priceExit = (x) => {
    n++;
    return traj(x);
  };
  const t0 = performance.now();
  const r = GP.chooseGrafts({ candidates: cands, priceExit, base, intelligence: intel, ownedNames: inst, seeds: [seed, mem], budgetMs: Infinity, ...opts });
  const cost = (r.grafts ?? []).reduce((a, g) => a + g.cost, 0);
  const life = (r.grafts ?? []).filter((g) => g.life);
  console.log(`\n${label}: ${r.grafts?.length ?? "refused"} grafts, exit ${r.withH?.toFixed(2)}h (without ${r.withoutH ?? "unpriced"}), $${(cost / 1e9).toFixed(1)}b, start $${((r.startMoney ?? 0) / 1e9).toFixed(1)}b, ${life.length} in life 1; ${n} sims, ${(performance.now() - t0).toFixed(0)}ms`);
  console.log(`  set: ${(r.grafts ?? []).map((g) => `${g.name}${g.life ? `@${g.life}` : ""}`).join(", ")}`);
  if (r.pruned?.length) console.log(`  pruned: ${r.pruned.join(", ")}`);
  return r;
}
run("search as shipped (QLink free)", C.candidates);
// QLink forced: the search's prune may not drop it — price it by excluding QLink from what the prune may drop:
// run the search with QLink as an owned-at-start graft is not the same (no cost); instead search the
// rest with QLink's spec always appended in the final window.
const q = C.candidates.find((c) => c.name === "QLink");
if (q) {
  const qs = GP.graftSpecOf(q, intel);
  let n = 0;
  const priceWithQ = (x) => {
    n++;
    return traj({ ...x, finalGrafts: [...(x.finalGrafts ?? []), qs], graftStartMoney: x.graftStartMoney ?? 0 });
  };
  const r = GP.chooseGrafts({ candidates: C.candidates.filter((c) => c.name !== "QLink"), priceExit: priceWithQ, base, intelligence: intel, ownedNames: inst, seeds: [seed.filter((s) => s !== "QLink"), mem.filter((s) => s !== "QLink")], budgetMs: Infinity });
  console.log(`\nQLink forced (final window) + the best rest: ${(r.grafts?.length ?? 0) + 1} grafts, exit ${r.withH?.toFixed(2)}h; ${n} sims`);
  console.log(`  set: QLink, ${(r.grafts ?? []).map((g) => `${g.name}${g.life ? `@${g.life}` : ""}`).join(", ")}`);
}
run("QLink excluded", C.candidates.filter((c) => c.name !== "QLink"));
