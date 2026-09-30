// THE PURCHASE MODEL WITH AND WITHOUT THE NEXT INSTALL'S BATCH, on a capture.
//
//   node tools/sim/exitjump/cadence-batch.mjs <capture.json>
//
// A capture is {snap-owned, snap-catalog, snap-augprice, snap-augstats,
// snap-prereq, snap-rep, node-factions, exitinputs, installgate, plan} as the
// /tel files (tools/test/fixture-bn9-cadence-0850.json is one). The catalogue
// is rebuilt as progress.js builds it (offers of the node's factions at today's
// prices and favour, reputation 0; lifeplan.catalogueFromOffers) and the
// cadence chosen (lifeplan.cadenceByPurchases) with the gate's batch in the
// catalogue — as shipped before this fix — and owned (lifeplan.ownedAfterBatch).
// Then the gate's committed install is priced on each (exitplan.bestExitPolicy).
//
// CALIBRATION: the CHECK line reproduces the capture's own cadence table (the
// 'as shipped' row) from the rebuilt catalogue; its money scale is the one
// the table implies at 6h (freshLifeMoney x scale = the table's money).
import "../../test/gameresolve.mjs";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../../test/gameresolve.mjs";

const L = await import(path.join(REPO_ROOT, "lifeplan.js"));
const E = await import(path.join(REPO_ROOT, "exitplan.js"));
const P = await import(path.join(REPO_ROOT, "plan.js"));

export function rebuild(C) {
  const d = (f) => C[f]?.data ?? null;
  const owned = d("snap-owned.txt");
  const cat = d("snap-catalog.txt").augs;
  const price = d("snap-augprice.txt");
  const stats = d("snap-augstats.txt").stats;
  const prereq = d("snap-prereq.txt").prereq;
  const rep = d("snap-rep.txt");
  const installed = new Set(owned.owned);
  const pending = owned.purchased.filter((n) => !installed.has(n));
  const isSoa = (n) => /^SoA - /.test(n);
  const unqueue = Math.pow(1.9, pending.filter((n) => !isSoa(n)).length);
  const factions = C["node-factions.txt"].factions;
  const offers = [];
  for (const f of factions)
    for (const aug of cat[f] ?? []) {
      if (!(price.price[aug] > 0)) continue;
      offers.push({ name: aug, faction: f, baseCost: price.price[aug] / (isSoa(aug) ? 1 : unqueue), repReq: price.repReq[aug], factionRep: 0, mults: stats[aug] ?? {}, prereqs: prereq[aug] ?? [], favor: rep.favor?.[f] ?? 0, nfgLevel: 0 });
    }
  const ownedAll = new Set([...installed, ...pending]);
  const inputs = { ...C["exitinputs.txt"].inputs };
  delete inputs.finalGrafts;
  delete inputs.lifeGrafts;
  delete inputs.graftStartMoney;
  const batch = [...pending, ...(C["installgate.txt"].plan?.buy ?? []).map((b) => b.name)];
  return { offers, ownedAll, inputs, batch, node: C["exitinputs.txt"].bitNode };
}
export function cadenceOf(R, { afterBatch }) {
  const { owned, nfgLevel0 } = afterBatch ? L.ownedAfterBatch(R.ownedAll, R.batch) : { owned: R.ownedAll, nfgLevel0: 0 };
  const catal = L.catalogueFromOffers(R.offers, owned);
  const t6 = R.table?.find((r) => r.L === 6);
  const scale = t6 ? t6.money / L.freshLifeMoney(R.inputs, 6, 1) : 1;
  return L.cadenceByPurchases({ inputs: R.inputs, catalogue: catal, favor: catal.favor, owned: [...owned], repPerHour0: R.inputs.repPerSec * 3600, moneyScale: scale, bestExitPolicy: E.bestExitPolicy, nfgLevel0 });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const C = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const R = rebuild(C);
  R.table = C["exitinputs.txt"].inputs.cadence?.table ?? null;
  const shipped = cadenceOf(R, { afterBatch: false });
  const fixed = cadenceOf(R, { afterBatch: true });
  const row = (c) => c.table.map((r) => `L${r.L} x${r.gain} H${r.H}`).join("  ");
  console.log(`capture ${C["exitinputs.txt"].at}; batch (${R.batch.length}): ${R.batch.join(", ")}`);
  console.log(`CHECK the capture's table:  ${R.table.map((r) => `L${r.L} x${r.gain} H${r.H}`).join("  ")}`);
  console.log(`      rebuilt, as shipped:  ${row(shipped)}`);
  console.log(`      batch owned (fixed):  ${row(fixed)}`);
  console.log(`chosen: as shipped ${shipped.cycleHours}h x${shipped.multGainPerCycle.toFixed(4)}; batch owned ${fixed.cycleHours}h x${fixed.multGainPerCycle.toFixed(4)}`);
  // The committed install on each cadence (the published point inputs, grafts carried).
  const plan = C["plan.txt"];
  const basis = P.basisOf(plan.decisions?.install ?? null, Date.parse(plan.at));
  const full = C["exitinputs.txt"].inputs;
  const g = basis?.gains ?? null;
  const price = (over) => E.bestExitPolicy({ ...full, ...over, firstInstallH: Math.max(0, basis?.waitH ?? 0), ...(g ? { installGains: g, nextInstallGain: g.hacking } : {}) }, 400, 1).best?.hours;
  // The posterior blends the model with measured lives: the shipped point is
  // the published multGainPerCycle; the fixed one scales its ln by the model's ratio.
  const r = Math.log(fixed.multGainPerCycle) / fixed.cycleHours / (Math.log(shipped.multGainPerCycle) / shipped.cycleHours);
  const lnPost = Math.log(full.multGainPerCycle) / full.cycleHours;
  console.log(`committed ${plan.decisions?.install?.key} (published point ${plan.decisions?.install?.pointH}h): as shipped ${price({})?.toFixed(2)}h; model with the batch owned ${price({ cycleHours: fixed.cycleHours, multGainPerCycle: fixed.multGainPerCycle })?.toFixed(2)}h; posterior rate scaled by the model's ${r.toFixed(3)} ${price({ cycleHours: fixed.cycleHours, multGainPerCycle: Math.exp(lnPost * r * fixed.cycleHours) })?.toFixed(2)}h`);
}
