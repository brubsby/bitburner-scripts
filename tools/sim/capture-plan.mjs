// CAPTURE THE LIVE PLAN'S INPUTS as a fixture: /tel/exitinputs.txt,
// /tel/plan.txt, /tel/stock.txt and the graft candidates rebuilt from the
// snapshot families exactly as progress.js graftDecisionOf builds them
// (graftplan.graftCandidatesOf on snap-catalog/augstats/prereq/augprice/owned).
//
//   node tools/sim/capture-plan.mjs out.json
//
// Read-only: getFile over the control port, nothing written in the game.
// CALIBRATION: none needed — it computes nothing of its own; the candidates
// are graftplan.graftCandidatesOf's, the planner's own function.
import "../test/gameresolve.mjs";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../test/gameresolve.mjs";

const GP = await import(path.join(REPO_ROOT, "graftplan.js"));
const { bitNodeMults } = await import(path.join(REPO_ROOT, "bitNodeMultipliers.js"));

async function tel(file) {
  const r = await fetch("http://localhost:12526/rpc", { method: "POST", body: JSON.stringify({ method: "getFile", params: { server: "home", filename: file } }) });
  const j = await r.json();
  return j.result ? JSON.parse(j.result) : null;
}
const [ei, plan, stock, ...snaps] = await Promise.all(["/tel/exitinputs.txt", "/tel/plan.txt", "/tel/stock.txt", "/tel/snap-owned.txt", "/tel/snap-catalog.txt", "/tel/snap-augprice.txt", "/tel/snap-augstats.txt", "/tel/snap-prereq.txt"].map(tel));
const [owned, catalog, price, stats, prereq] = snaps.map((s) => s?.data ?? null);
const names = [...new Set(Object.values(catalog?.augs ?? {}).flat())];
const node = ei?.bitNode ?? plan?.node;
const installed0 = new Set(owned?.owned ?? []);
const pending = (owned?.purchased ?? []).filter((n) => !installed0.has(n));
const installed = owned?.owned ?? [];
const isSoa = (n) => /^SoA - /.test(n);
const candidates = GP.graftCandidatesOf({
  names,
  stats: stats?.stats ?? {},
  prereqs: prereq?.prereq ?? {},
  price: price?.price ?? {},
  owned: new Set([...installed, ...pending]),
  augMoneyCost: bitNodeMults(node)?.AugmentationMoneyCost,
  queuedNonSoA: pending.filter((n) => !isSoa(n)).length,
  sf11: 0,
});
const out = { at: new Date().toISOString(), node, exitinputs: ei, plan, stock, candidates, owned: installed, pending };
const file = process.argv[2] ?? "/tmp/plan-capture.json";
fs.writeFileSync(file, JSON.stringify(out));
console.log(`${file}: ${candidates.length} candidates (QLink ${candidates.some((c) => c.name === "QLink") ? "in" : "out"}), installed ${installed.length}, pending ${pending.length}, inputs ${ei?.at}, plan ${plan?.at} exit ${plan?.exit?.meanH}h`);
