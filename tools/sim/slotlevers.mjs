// THE WORK SLOT'S LEVERS ON THE EXIT — every answer a with-vs-without exit
// simulation on the plan layer: the committed install's trajectory
// (plan.trajectoryOf on its basis), the plan's own posterior draws (rebuilt
// from the record's summary, as fours.mjs does), common random numbers (one
// noise key per trajectory, the same draws for every option) and the
// commitment rule (plan.decideAmong: switch only on a positive expected gain
// better in >= 80% of the paired draws).
//
//   node tools/sim/slotlevers.mjs [--inputs exitinputs.json --plan plan.json]
//        [--sleeve sleeve.json] [--go go.json] [--prereq snap-prereq.json]
//        [--only 1,2,3,4,go]
//
// Inputs default to the live /tel files over the control port (read-only).
//
// THE LEVERS (the hash audit, cca3ab9: in BN9's final window the WORK SLOT
// binds — grafts + the Daedalus reputation leg — not money):
//   1  bank the exit faction's favor in an earlier life (exitplan favorLife:
//      a second install whose life joins Daedalus and grinds R rep; the final
//      window works at x(1 + favor/100) and may donate past 150)
//   2  the final window's hacking-work joins: generated contracts split k ways
//      (contractRep.factions) — k as published vs Daedalus alone
//   3  sleeves on the exit faction's work in the final window vs studying
//      (their exp transfer) vs neither
//   4  where the committed graft set is grafted: this life (free slot while
//      the book compounds) vs the final window — the committed schedule, the
//      final window alone, and graftplan.scheduleGen's pick
//   go the exit faction's favor from IPvGO wins after the join (exitplan
//      favorStream), measured from /tel/go.txt
//
// ON THE LIVE 2026-09-30 00:00Z INPUTS (tools/test/fixture-bn9-slot-0000.json,
// [SL4]; means over the plan's 24 draws, the committed exit 28.22h):
//   1  +0.40h at 150 favor (the life costs more than x2.5 saves; +2.16h beside
//      the Go stream): not taken — simulated only, not wired
//   2  -1.16h for Daedalus alone (k 8 -> 1); a join's best buy (Neuralstimulator
//      as an upper bound) does not pay its share: the join policy
//   3  -0.008h (a sleeve on Daedalus), -0.015h (the fleet studying): nothing;
//      the audit's -0.81h was the player's exp mults on the sleeves' flat exp
//   4  -4.71h: the costliest 9 in this life, not the cheapest 8 (the search)
//   go -1.77h: the favor the Go wins give Daedalus after the join (priced)
//   together -7.00h (28.22h -> 21.22h)
//
// CALIBRATION: the CHECK line reproduces the plan's committed install exit
// (its Monte Carlo mean on the same draws and noise key) from the published
// inputs; every other number is the exit simulator's, with its calibration.
// NOT SIMULATED (stated where it matters): the terminal install's batch (the
// augmentations bought with The Red Pill), and the Daedalus augmentations a
// favor life's banked reputation could buy.
import "../test/gameresolve.mjs";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../test/gameresolve.mjs";

const X = await import(path.join(REPO_ROOT, "exitplan.js"));
const P = await import(path.join(REPO_ROOT, "plan.js"));
const GP = await import(path.join(REPO_ROOT, "graftplan.js"));
const FV = await import(path.join(REPO_ROOT, "favor.js"));

const argv = process.argv.slice(2);
const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
async function tel(f) {
  const r = await fetch("http://localhost:12526/rpc", { method: "POST", body: JSON.stringify({ method: "getFile", params: { server: "home", filename: f } }) });
  const j = await r.json();
  return JSON.parse(j.result);
}
const load = async (flag, file) => (arg(flag) ? JSON.parse(fs.readFileSync(arg(flag), "utf8")) : await tel(file).catch(() => null));
const ei = await load("--inputs", "/tel/exitinputs.txt");
const plan = await load("--plan", "/tel/plan.txt");
const sleeve = await load("--sleeve", "/tel/sleeve.txt");
const go = await load("--go", "/tel/go.txt");
const prereqRec = await load("--prereq", "/tel/snap-prereq.txt");
const only = arg("--only") ? new Set(arg("--only").split(",")) : null;
const want = (k) => !only || only.has(k);

const I = ei.inputs;
const at = Date.parse(ei.at);
const basis = P.basisOf(plan.decisions.install, at);
const g = basis?.gains ?? null;
const ps = plan.posteriors;
const c = ps.cadence;
const post = {
  drift: { s: ps.s, nu: ps.driftNu ?? 4, a: 2, b: 2 * ps.s * ps.s },
  gymSdLn: ps.gymSdLn ?? 0.1,
  cadence: c ? { rate: { mean: Math.log(c.lnPerHour), sd: c.rateSdLn }, life: { mean: Math.log(c.cycleHours), sd: c.lifeSdLn }, own: { weight: c.ownWeight } } : null,
  expPost: ps.exp ? { perSec: ps.exp.perSec, sd: ps.exp.sdLn } : null,
  income: ps.income ? { perSec: ps.income.perSec, mean: Math.log(ps.income.perSec), sd: ps.income.sdLn } : null,
  trader: ps.trader ? { perSec: { mean: ps.trader.mean, sd: ps.trader.sd }, lnWstar: { mean: Math.log(ps.trader.Wstar), sd: ps.trader.lnWstarSd }, rho: ps.trader.rho } : null,
};
const draws = P.makeDraws(post, P.PLAN.N, P.seedOf(plan.lastAugReset, plan.node));
const traj = P.trajectoryOf(basis);
// A trajectory FORCED to at least `min` installs (a lever that needs a life the committed policy may not have).
const forced = (min) => (x) => {
  const r = X.bestExitPolicy({ ...x, firstInstallH: Math.max(0, basis?.waitH ?? 0), ...(g ? { installGains: g, nextInstallGain: g.hacking ?? null } : {}) }, 400, min);
  return r.degenerate ? null : r.best?.hours ?? null;
};
const H = (x) => (typeof x === "number" && isFinite(x) ? `${x.toFixed(3)}h` : String(x));
const D = (a, b) => (typeof a === "number" && typeof b === "number" ? `${b - a >= 0 ? "+" : ""}${(b - a).toFixed(3)}h` : "?");

// ONE DECISION: options {key, inputs, f?} on the shared draws, the first the incumbent.
function decideLever(title, opts) {
  const options = opts.map((o) => {
    const f = o.f ?? traj;
    return { key: o.key, noiseKey: P.noiseKeyOf(basis, o.inputs), sim: (d) => f(P.applyDraw(o.inputs, d), d) };
  });
  const points = Object.fromEntries(opts.map((o) => [o.key, (o.f ?? traj)(o.inputs)]));
  const d = P.decideAmong({ options, prev: { key: opts[0].key }, draws, redecide: true, budgetMs: 1e9, pointOf: (k) => points[k] });
  console.log(`\n${title}`);
  const base = d.options.find((o) => o.key === opts[0].key);
  for (const o of d.options) console.log(`  ${o.key.padEnd(34)} point ${H(points[o.key]).padStart(9)}  mean ${H(o.meanH).padStart(9)} (${D(base.meanH, o.meanH).padStart(8)})  q10 ${o.q10} q90 ${o.q90}  P(best) ${o.pBest}`);
  console.log(`  commitment rule: ${d.key} — ${d.why}`);
  return { d, points };
}

console.log(`exit inputs ${ei.at} (BN${ei.bitNode}); plan ${plan.at}; basis ${basis?.kind} ${basis?.waitH?.toFixed(2)}h; ${draws.length} draws`);
{
  const nk = P.noiseKeyOf(basis, I);
  const ev = P.evaluate([{ key: "c", noiseKey: nk, sim: (d) => traj(P.applyDraw(I, d), d) }], draws, { budgetMs: 1e9 });
  const xs = ev.samples.c.filter((x) => typeof x === "number");
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const pm = plan.decisions.install.meanH;
  console.log(`CHECK the plan's committed install: mean ${pm}h (${plan.decisions.install.noiseKey}) vs this replay ${mean.toFixed(3)}h (${nk}): ${(((mean / pm) - 1) * 100).toFixed(2)}%; point ${H(traj(I))}`);
}
const best0 = P.policyOf(basis, I).best;
for (const l of best0.legs) console.log(`   ${l.leg.padEnd(24)} ${l.hours.toFixed(2).padStart(6)}h  ${(l.detail ?? "").slice(0, 110)}`);

// The player's faction_rep, from the published base rate where it is the
// formula estimate (trajectory.estimateBaseRepPerSec: (hacking + int/3)/975 x
// faction_rep x 5 x share): the donation price's multiplier.
const frm = I.repFromEstimate ? I.repPerSec / ((I.hacking / 975) * 5) : null;
const donationFor = (rep) => (frm ? (rep * 1e6) / frm : null);

// THE GO FAVOR STREAM (favor.goFavorStreamOf on /tel/go.txt): --gph /
// --pwin / --gorep override a go.js that has just restarted (its counters are
// this process's) or predates favorRep.
const goSt = (() => {
  const gs = go ?? {};
  const hrs = gs.processStartedAt ? (Date.parse(gs.at) - Date.parse(gs.processStartedAt)) / 3.6e6 : null;
  const gph = arg("--gph") ? +arg("--gph") : hrs > 0 && gs.gamesThisProcess > 0 ? gs.gamesThisProcess / hrs : null;
  const pWin = arg("--pwin") ? +arg("--pwin") : gs.wins + gs.losses > 0 ? gs.wins / (gs.wins + gs.losses) : null;
  const banked = arg("--gorep") ? +arg("--gorep") : gs.favorRep?.Daedalus ?? null;
  return FV.goFavorStreamOf({ gamesPerHour: gph, pWin, sf14: gs.sf14 ?? 0, banked });
})();
const goStream = goSt.repPerH > 0 ? { repPerH: goSt.repPerH, capRep: goSt.capRep } : null;

if (want("1")) {
  const R150 = FV.favorToRep(I.favorToDonate ?? 150);
  const opts = [{ key: "no favor life", inputs: I }];
  for (const R of [100e3, 250e3, R150, 1e6]) opts.push({ key: `favor life ${Math.round(R / 1e3)}k (${FV.repToFavor(R).toFixed(0)} favor)`, inputs: { ...I, favorLife: { rep: R }, donationCost: donationFor(I.terminalRep) }, f: forced(2) });
  console.log(`\nLEVER 1 inputs: favor ${I.exitFavor} now, donations at ${I.favorToDonate} (favorToRep ${Math.round(R150)}); faction_rep ${frm?.toFixed(3) ?? "?"} (derived from the formula estimate), Red Pill by donation $${((donationFor(I.terminalRep) ?? 0) / 1e9).toFixed(0)}b at today's multipliers`);
  const { points } = decideLever("LEVER 1  BANK THE EXIT FACTION'S FAVOR IN AN EARLIER LIFE (forced: a second install whose life joins and grinds)", opts);
  const x = { ...I, favorLife: { rep: R150 }, donationCost: donationFor(I.terminalRep) };
  const b = X.bestExitPolicy({ ...x, firstInstallH: basis.waitH, installGains: g, nextInstallGain: g.hacking }, 400, 2).best;
  console.log(`  the 150-favor route, leg by leg (${b.installsFirst} installs, ${H(b.hours)}):`);
  for (const l of b.legs) console.log(`     ${l.leg.padEnd(24)} ${l.hours.toFixed(2).padStart(6)}h  ${(l.detail ?? "").slice(0, 110)}`);
  const two = forced(2)(I);
  console.log(`  the same second install without the favor life: ${H(two)}; the favor is free (banked, no life): ${H(traj({ ...I, exitFavor: 150, donationCost: donationFor(I.terminalRep) }))}`);
  console.log(`  unforced (the policy search may keep one install): ${H(traj(x))} vs ${H(points["no favor life"])}`);
  if (goStream) {
    const G = { ...I, favorStream: goStream };
    const o2 = [{ key: "no favor life (Go stream)", inputs: G }];
    for (const R of [FV.favorToRep(150) - goStream.capRep, R150]) o2.push({ key: `favor life ${Math.round(R / 1e3)}k (Go stream)`, inputs: { ...G, favorLife: { rep: R }, donationCost: donationFor(I.terminalRep) }, f: forced(2) });
    decideLever("LEVER 1b THE SAME WITH THE GO FAVOR STREAM IN THE FINAL WINDOW (the favor life banks the rest of 150)", o2);
  }
}

if (want("2")) {
  const k0 = I.contractRep?.factions;
  if (!I.contractRep) console.log("\nLEVER 2: no contractRep on the inputs (no hacknet servers / ctauto) — nothing to split");
  else {
    const opts = [{ key: `k=${k0} (published)`, inputs: I }];
    for (const k of [...new Set([4, 2, 1])].filter((k) => k !== k0)) opts.push({ key: `k=${k}`, inputs: { ...I, contractRep: { ...I.contractRep, factions: k } } });
    decideLever("LEVER 2  THE FINAL WINDOW'S HACKING-WORK JOINS (generated contracts' rep split k ways)", opts);
    // What a join buys in the final window: an augmentation of the terminal
    // batch (NOT SIMULATED by the exit: the batch bought with The Red Pill).
    // Upper bound: Neuralstimulator's hacking_exp x1.12 (The Black Hand /
    // the cities, 50k rep) as a free graft from the window's start — it would
    // act only on the climb after the terminal install.
    const nstim = { name: "Neuralstimulator (upper bound)", cost: 0, paid: true, slotH: 0, hacking: 1, exp: 1.12, rep: 1, money: 1 };
    const withJoin = { ...I, contractRep: { ...I.contractRep, factions: 2 }, finalGrafts: [...(I.finalGrafts ?? []), nstim] };
    decideLever("LEVER 2b Daedalus alone vs Daedalus + The Black Hand for Neuralstimulator (x1.12 exp from the window's start: an UPPER bound)", [{ key: "k=1", inputs: { ...I, contractRep: { ...I.contractRep, factions: 1 } } }, { key: "k=2 + Neuralstimulator", inputs: withJoin }]);
  }
}

if (want("3")) {
  const by = sleeve?.byObjective ?? {};
  const rep = by.rep ?? 0;
  const exp = by.exp ?? 0;
  console.log(`\nLEVER 3 inputs: the fleet's best sleeve on faction work ${rep.toFixed(3)} rep/s (${sleeve?.factionWorkType ?? "?"}, one sleeve per faction; x shock, no sync; favor applies, the player's graft entropy does not); studying ${exp.toFixed(1)} exp/s to the player; the player's base rate ${I.repPerSec.toFixed(2)}/s at hacking ${I.hacking}`);
  const fee = 1600 * (sleeve?.sleeves ?? 1);
  decideLever("LEVER 3  SLEEVES IN THE FINAL WINDOW: on Daedalus vs studying vs neither", [
    { key: "none", inputs: I },
    { key: "sleeve on Daedalus (rep leg)", inputs: { ...I, sleeveRep: { perSec: rep, delayH: 0 } } },
    { key: "sleeves study (flat exp, fee)", inputs: { ...I, expPerSec: I.expPerSec + exp, expFlatPerSec: (I.expFlatPerSec ?? 0) + exp, spendPerSec: fee } },
    { key: "sleeves study (sleeveExp, fee)", inputs: { ...I, sleeveExp: { perSec: exp, delayH: 0 }, spendPerSec: fee } },
  ]);
  // sleeve.js's own price of one sleeve's study (sleeveplan.sleeveExitOf ->
  // exitplan sleeveExp): the default policy on the published record.
  const SP = await import(path.join(REPO_ROOT, "sleeveplan.js"));
  const exitOf = SP.sleeveExitOf(ei, ei.lastAugReset, X.bestExitPolicy, at);
  const one = exp / Math.max(1, sleeve?.sleeves ?? 1);
  if (exitOf) console.log(`  sleeve.js's price (sleeveExitOf, one sleeve ${one.toFixed(1)} exp/s and its $1600/s fee): study ${H(exitOf("exp", { perSec: one, delayH: 0, spendPerSec: 1600 }))} vs idle ${H(exitOf("exp", { perSec: 0, delayH: 0 }))}; the fleet: ${H(exitOf("exp", { perSec: exp, delayH: 0, spendPerSec: fee }))}`);
}

// Lever 4's search, kept for the combined exit below.
let schedPick = null;
if (want("4")) {
  const all = [...(I.lifeGrafts ?? []), ...(I.finalGrafts ?? [])];
  const specs = all.map(({ life, ...s }) => s);
  const pre = prereqRec?.data?.prereq ?? {};
  const chosen = specs.map((s) => ({ name: s.name, prereqs: pre[s.name] ?? [] }));
  const without = { ...I };
  delete without.lifeGrafts;
  delete without.finalGrafts;
  delete without.graftStartMoney;
  const finalOnly = { ...without, finalGrafts: specs, graftStartMoney: I.graftStartMoney ?? 0 };
  const t0 = Date.now();
  const gen = GP.scheduleGen({ chosen, specs, priceExit: (x) => traj(x), without, join: I.joinMoney ?? 0, fraction: 0, finalH: traj(finalOnly) });
  let r = gen.next();
  while (!r.done) r = gen.next();
  const s = r.value;
  const ms = Date.now() - t0;
  const life = new Map(s.lifeGrafts.map((x) => [x.name, x.life]));
  const pick = { ...without, lifeGrafts: specs.filter((x) => life.has(x.name)).map((x) => ({ ...x, life: life.get(x.name) })), finalGrafts: specs.filter((x) => !life.has(x.name)), graftStartMoney: s.startMoney ?? 0 };
  schedPick = pick;
  console.log(`\nLEVER 4 inputs: ${specs.length} committed grafts, ${(I.lifeGrafts ?? []).length} scheduled in life 1 (${(I.lifeGrafts ?? []).reduce((a, x) => a + x.slotH, 0).toFixed(2)}h of slot); the search (${ms}ms, ${s.summary.tried.length} priced): ${s.summary.family}, ${s.summary.early} early (${[...life.keys()].join(", ")})`);
  const fams = [...new Set(s.summary.tried.map((t) => t.family))];
  for (const f of fams) console.log(`  ${f}: ${s.summary.tried.filter((t) => t.family === f).map((t) => `${t.c}:${t.h}`).join(" ")}`);
  decideLever("LEVER 4  WHERE THE COMMITTED SET IS GRAFTED", [
    { key: "committed schedule", inputs: I },
    { key: "final window only", inputs: finalOnly },
    { key: `search: ${s.summary.family} x${s.summary.early}`, inputs: pick },
  ]);
}

if (want("go")) {
  console.log(`\nGO inputs: opponent ${go?.opponent}; ${goSt.why}`);
  if (goStream) decideLever("GO  THE EXIT FACTION'S FAVOR FROM IPvGO WINS DURING THE REP LEG (go.js keeps Daedalus after the join)", [{ key: "no Go favor", inputs: I }, { key: "Go favor from the join", inputs: { ...I, favorStream: goStream } }]);
}

// THE EXIT BEFORE AND AFTER what is implemented: the final window's joins
// (k = 1 under the policy), the schedule search's pick, the Go favor stream.
if (!only) {
  const after = { ...(schedPick ?? I), ...(I.contractRep ? { contractRep: { ...I.contractRep, factions: 1 } } : {}), ...(goStream ? { favorStream: goStream } : {}) };
  decideLever("THE EXIT: published inputs vs the implemented levers together (joins k=1, the searched schedule, the Go favor stream)", [{ key: "before", inputs: I }, { key: "after", inputs: after }]);
  const b = P.policyOf(basis, after).best;
  for (const l of b.legs) console.log(`   ${l.leg.padEnd(24)} ${l.hours.toFixed(2).padStart(6)}h  ${(l.detail ?? "").slice(0, 110)}`);
}
