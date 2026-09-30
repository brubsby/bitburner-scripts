// THE LIFE LENGTH AS A PLAN DECISION, replayed on captured passes.
//
//   node tools/sim/exitjump/lifelength.mjs <fixture.json | dir-of-/tmp/fx/hist> [HHMMSS ...]
//
// A fixture is {passes: [{at, node, lastAugReset, plan, inputs, inputsAt}]}
// (tools/test/fixture-bn9-lifelength-0714.json). For each pass: the purchase
// model's chooser as shipped (the L it published, the exit the plan published)
// against plan.decideLifeLengthGen run pass after pass on the same inputs, the
// incumbent carried, the committed install (the previous pass's) as its basis.
//
// CALIBRATION: the CHECK line of each pass re-prices the PUBLISHED trajectory
// (the pass's own install basis, the published inputs at the chooser's L) and
// prints its error against the plan's published point (decisions.install.pointH
// or exit.pointH). The per-L cadence is rebuilt from the published table's
// gains (lnMean where the capture carries it, else the 4-decimal gain: stated)
// and the posterior's own-lives weight (plan.posteriors.cadence.ownWeight).
import "../../test/gameresolve.mjs";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../../test/gameresolve.mjs";

const P = await import(path.join(REPO_ROOT, "plan.js"));
const LP = await import(path.join(REPO_ROOT, "lifeplan.js"));

/** The draws' posterior from a plan record's published summary (plan.posteriorSummary). */
export function postOf(ps) {
  const c = ps?.cadence;
  const t = ps?.trader;
  return {
    drift: { s: ps.s, nu: ps.driftNu ?? 4, a: 2, b: 2 * ps.s * ps.s },
    gymSdLn: 0.1,
    cadence: c ? { rate: { mean: Math.log(c.lnPerHour), sd: c.rateSdLn }, life: { mean: Math.log(c.cycleHours), sd: c.lifeSdLn }, own: { weight: c.ownWeight } } : null,
    expPost: ps.exp ? { perSec: ps.exp.perSec, sd: ps.exp.sdLn } : null,
    income: ps.income ? { perSec: ps.income.perSec, mean: Math.log(ps.income.perSec), sd: ps.income.sdLn } : null,
    trader: t && Number.isFinite(t.mean) ? { perSec: { mean: t.mean, sd: t.sd }, ...(Number.isFinite(t.Wstar) ? { lnWstar: { mean: Math.log(t.Wstar), sd: t.lnWstarSd ?? 0.3 } } : {}), rho: t.rho ?? 0 } : null,
  };
}

/**
 * The cadence posterior at the published inputs' L, as lifeplan.lifeCadenceAt
 * reads it: its mean is the published median rate (cadenceRateMedian), its
 * model the published model rate at that L, its sd and own-lives weight the
 * plan's published posterior.
 */
export function cadencePostOf(inputs, plan) {
  const pc = plan?.posteriors?.cadence;
  const r = inputs.cadenceRateMedian;
  const m = inputs.cadence?.model?.lnPerHour;
  if (!(r > 0) || !(m > 0) || !pc) return null;
  return { rate: { mean: Math.log(r), sd: pc.rateSdLn, weight: pc.ownWeight }, modelPrior: { lnPerHour: m, cycleHours: inputs.cycleHours }, why: "rebuilt from the capture (cadenceRateMedian, cadence.model, posteriors.cadence)" };
}

/** Base inputs and per-L options of one captured pass. */
export function optionsOf(pass) {
  const I = pass.inputs;
  const rec = { table: I.cadence?.table ?? [], moneyCalibration: I.cadence?.moneyCalibration ?? null, afterBatch: I.cadence?.afterBatch ?? null };
  const post = cadencePostOf(I, pass.plan);
  const base = { ...I };
  const opts = [];
  for (const row of rec.table) {
    const x = LP.lifeInputsOf(base, rec, row.L, post);
    if (x) opts.push({ L: row.L, inputs: x, cad: LP.lifeCadenceAt(row, post) });
  }
  return { base, rec, post, opts };
}

/** Load a fixture, or build the passes from a /tmp/fx/hist directory for the given HHMMSS stamps. */
export function loadPasses(src, stamps = []) {
  if (fs.statSync(src).isFile()) return JSON.parse(fs.readFileSync(src, "utf8")).passes;
  const files = fs.readdirSync(src).sort();
  // An empty capture (the recorder caught a write in progress) reads as nothing.
  const read = (f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(src, f), "utf8"));
    } catch {
      return null;
    }
  };
  // A range "HHMMSS-HHMMSS" takes every plan snapshot in it (the recorder's names are UTC, one per change).
  const plans = files.filter((f) => f.startsWith("plan.txt."));
  const sel = stamps.flatMap((t) => {
    const m = /^(\d{6})-(\d{6})$/.exec(t);
    return m ? plans.map((f) => f.split(".")[2]).filter((s) => s >= m[1] && s <= m[2]) : [t];
  });
  const eis = files.filter((f) => f.startsWith("exitinputs.txt.")).map((f) => ({ f, at: null }));
  return sel.flatMap((t) => {
    const pf = plans.find((f) => f.startsWith(`plan.txt.${t}.`));
    if (!pf) return [];
    const plan = read(pf);
    if (!plan?.at) return [];
    // The exit inputs the same pass published (within 3 minutes of the plan).
    let best = null;
    for (const e of eis) {
      if (e.at === null) e.at = Date.parse(read(e.f)?.at ?? "");
      if (!Number.isFinite(e.at)) continue;
      const dt = Math.abs(e.at - Date.parse(plan.at));
      if (dt < 180e3 && (!best || dt < best.dt)) best = { ...e, dt };
    }
    if (!best) return [];
    const ei = read(best.f);
    return [{ stamp: t, at: plan.at, node: plan.node, lastAugReset: plan.lastAugReset, plan, inputs: ei.inputs, inputsAt: ei.at }];
  });
}

/**
 * Replay the passes in order. `prevOf(k)`: the previous pass whose install
 * decision is the basis (same life), the lifeLength incumbent carried from
 * the replay's own last decision (any life of the node). Returns the rows.
 */
export function replay(passes, { log = false, incumbent = null } = {}) {
  let prevLL = incumbent;
  let prevPlan = null;
  let pending = false;
  const out = [];
  for (const ps of passes) {
    const now = Date.parse(ps.at);
    // A gap in the capture (> 7 min: a pass or more missing) starts a segment: its first pass's basis is its own
    // install decision (the last pass's is not in the capture) — stated.
    const gap = prevPlan && now - Date.parse(prevPlan.at) > 7 * 60e3;
    if (gap) prevPlan = { ...ps.plan, at: ps.at };
    const sameLife = prevPlan && prevPlan.lastAugReset === ps.lastAugReset;
    const basis = sameLife ? P.basisOf(prevPlan.decisions?.install ?? null, now) : null;
    const draws = P.makeDraws(postOf(ps.plan.posteriors), P.PLAN.N, P.seedOf(ps.lastAugReset, ps.node));
    const { opts } = optionsOf(ps);
    // The shipped plan's events this pass, less the chooser (it was never an event): a new life, the max age, a
    // graft switch, a stream — the rule re-decides on them, and on nothing else.
    // The graft decision comes after the life length in a pass (progress.js): its switch is this pass's event for
    // the decisions after it, and the life length's on the next pass (lifeLengthPending).
    const events = ps.plan.events ?? [];
    const late = (e) => /graft/.test(e);
    const redecide = events.some((e) => !late(e)) || pending || !prevLL;
    pending = events.some(late);
    const d = P.decideLifeLength({ options: opts, basis, prev: prevLL, draws, redecide, now, budgetMs: 1e9, reachSd: ps.plan.posteriors?.s ?? null });
    // The shipped trajectory re-priced (the CHECK): the pass's own basis and the published inputs.
    const ownBasis = P.basisOf(ps.plan.decisions?.install ?? null, now);
    let checkH = null;
    try {
      checkH = P.trajectoryOf(ownBasis)(ps.inputs);
    } catch {
      checkH = null;
    }
    const pubPoint = ps.plan.decisions?.install?.pointH ?? ps.plan.decisions?.exit?.pointH ?? null;
    // THE EXIT THE PLAN PUBLISHES on the committed L: the pass's own committed trajectory (its install decision,
    // else — nothing queued — the committed install of the life so far, else the default policy) on the inputs at
    // the committed L, on the same draws and noise key an install decision would use.
    const pubBasis = ps.plan.decisions?.install?.key ? ownBasis : basis;
    const inL = opts.find((o) => P.lifeKeyOf(o.L) === d.key)?.inputs ?? null;
    let pub = null;
    if (inL) {
      const traj = P.trajectoryOf(pubBasis);
      pub = P.decideAmong({ options: [{ key: "plan", noiseKey: P.noiseKeyOf(pubBasis, inL), sim: (dr) => traj(P.applyDraw(inL, dr), dr) }], draws, redecide: true, budgetMs: 1e9, now });
    }
    const row = { stamp: ps.stamp ?? ps.at.slice(11, 19), at: ps.at, events: events.length, eventList: events, oldL: ps.inputs.cycleHours, oldExit: ps.plan.exit?.meanH ?? null, oldStable: ps.plan.exitStability ?? null, newL: d.lifeH, newKey: d.key, newExit: pub?.meanH ?? null, newSamples: pub?.samples ?? null, lifeMean: d.meanH, newPoint: d.pointH, held: d.held === true, switched: d.switched === true, pWin: d.pWin ?? null, gainH: d.gainH ?? null, n: d.n, table: d.table, options: d.options, why: d.why, basis: d.basis, decision: d, checkH, pubPoint };
    // EXIT UNSTABLE on the replay (plan.exitStabilityOf), as progress.js records it: this pass's published exit
    // against the last one's, the life length decision's switch an event.
    const rec = { at: ps.at, node: ps.node, lastAugReset: ps.lastAugReset, ver: "replay", events: [...events.filter((e) => !late(e) || true), ...(d.switched ? [`the committed life length switched ${d.from} -> ${d.key}`] : [])], exit: { meanH: row.newExit, at: ps.at }, decisions: { install: { samples: row.newSamples, n: pub?.n }, lifeLength: { key: d.key, lifeH: d.lifeH } } };
    row.newStable = out.length ? P.exitStabilityOf(out[out.length - 1].rec, rec) : null;
    row.rec = rec;
    out.push(row);
    if (log) {
      const tb = (d.table ?? []).map((t) => `${t.L}:${t.pointH ?? "-"}${t.drawn ? "*" : ""}`).join(" ");
      const st = (s) => (s?.ok === true ? "stable" : s?.ok === false ? "UNSTABLE" : "n/a");
      console.log(`${row.stamp} ${events.length ? "EVENT" : "held "} OLD L${row.oldL} exit ${row.oldExit}h (${st(row.oldStable)}) | NEW ${d.key} ${d.held ? "held" : d.switched ? `SWITCH from ${d.from} (P ${d.pWin})` : "stays"}, exit ${row.newExit}h (${st(row.newStable)}${row.newStable?.ok !== null && row.newStable ? `: ${row.newStable.diffH ?? ""}h vs tol ${row.newStable.tolH ?? ""}h` : ""}) | points ${tb}`);
      console.log(`         CHECK the shipped trajectory re-priced ${checkH?.toFixed(2) ?? "?"}h vs published point ${pubPoint ?? "?"}h (${checkH && pubPoint ? `${((checkH / pubPoint - 1) * 100).toFixed(1)}%` : "?"}) — ${String(d.why).slice(0, 150)}`);
    }
    prevLL = d.key ? d : prevLL;
    prevPlan = ps.plan;
  }
  return out;
}

/**
 * THE LIFE LENGTH'S SHARE OF A NO-EVENT MOVE, isolated. For consecutive passes
 * A -> B of one life where B re-decided nothing: both priced on A's committed
 * install (its spec and batch — the committed batch is re-planned every pass,
 * a separate mover this does not measure), each on its own inputs, on the
 * life's draws; once at the L each pass published (the chooser) and once at
 * the L the replayed decision committed. EXIT UNSTABLE's rule
 * (plan.exitStabilityOf) on each pair. `rows`: replay()'s output.
 */
export function lengthPairs(passes, rows) {
  const out = [];
  for (let k = 1; k < passes.length; k++) {
    const A = passes[k - 1];
    const B = passes[k];
    if (A.lastAugReset !== B.lastAugReset || (B.plan.events ?? []).length || rows[k].switched || Date.parse(B.at) - Date.parse(A.at) > 7 * 60e3) continue;
    const inst = A.plan.decisions?.install;
    if (!inst?.key) continue;
    const draws = P.makeDraws(postOf(B.plan.posteriors), P.PLAN.N, P.seedOf(B.lastAugReset, B.node));
    const at = (ps, L) => {
      const now = Date.parse(ps.at);
      const basis = P.basisOf(inst, now);
      const x = optionsOf(ps).opts.find((o) => o.L === L)?.inputs;
      if (!basis || !x) return null;
      const traj = P.trajectoryOf(basis);
      const d = P.decideAmong({ options: [{ key: "plan", noiseKey: P.noiseKeyOf(basis, x), sim: (dr) => traj(P.applyDraw(x, dr), dr) }], draws, redecide: true, budgetMs: 1e9, now });
      return { at: ps.at, node: ps.node, lastAugReset: ps.lastAugReset, ver: "pair", events: [], exit: { meanH: d.meanH, at: ps.at }, decisions: { install: { samples: d.samples, n: d.n }, lifeLength: { key: P.lifeKeyOf(L), lifeH: L } } };
    };
    const oldA = at(A, A.inputs.cycleHours);
    const oldB = at(B, B.inputs.cycleHours);
    const newA = at(A, rows[k - 1].newL);
    const newB = at(B, rows[k].newL);
    if (!oldA || !oldB || !newA || !newB) continue;
    // The chooser's move is not an event: priced as the same L (the pair's own L on each side), the rule's
    // EXIT UNSTABLE reads the move itself — so the L check is dropped on the old pair, the numbers kept.
    const strip = (r) => ({ ...r, decisions: { install: r.decisions.install } });
    out.push({ from: A.stamp, to: B.stamp, oldL: [A.inputs.cycleHours, B.inputs.cycleHours], newL: [rows[k - 1].newL, rows[k].newL], old: P.exitStabilityOf(strip(oldA), strip(oldB)), new: P.exitStabilityOf(newA, newB) });
  }
  return out;
}

/** A pass as the fixture keeps it: what the replay reads, nothing the simulation skips. */
export function slimPass(ps) {
  const { freshHackCum, hacknet, streams, capitalFit, incomeSource, expSource, repSource, ...inputs } = ps.inputs;
  void freshHackCum, hacknet, streams, capitalFit, incomeSource, expSource, repSource;
  const pl = ps.plan;
  const inst = pl.decisions?.install ?? null;
  const pick = (o, ks) => (o ? Object.fromEntries(ks.filter((k) => k in o).map((k) => [k, o[k]])) : null);
  const { rw, why, ...trader } = pl.posteriors?.trader ?? {};
  void rw, why;
  return {
    stamp: ps.stamp,
    at: ps.at,
    node: ps.node,
    lastAugReset: ps.lastAugReset,
    inputsAt: ps.inputsAt,
    inputs,
    plan: {
      at: pl.at,
      node: pl.node,
      lastAugReset: pl.lastAugReset,
      ver: pl.ver,
      events: pl.events,
      exit: pl.exit,
      exitStability: pick(pl.exitStability, ["ok", "prevH", "curH", "diffH", "tolH", "why"]),
      posteriors: { s: pl.posteriors?.s, driftNu: pl.posteriors?.driftNu, cadence: pl.posteriors?.cadence ?? null, exp: pick(pl.posteriors?.exp, ["perSec", "sdLn"]), income: pick(pl.posteriors?.income, ["perSec", "sdLn"]), trader: pl.posteriors?.trader ? trader : null },
      decisions: { install: pick(inst, ["key", "install", "installAt", "waitH", "gains", "fixed", "spec", "noiseKey", "meanH", "pointH", "held", "n"]), exit: pick(pl.decisions?.exit, ["key", "meanH", "pointH"]) },
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const out = argv.includes("--fixture") ? argv[argv.indexOf("--fixture") + 1] : null;
  const [src, ...stamps] = argv.filter((a, i) => a !== "--fixture" && argv[i - 1] !== "--fixture");
  const passes = loadPasses(src, stamps);
  if (out) {
    fs.writeFileSync(out, JSON.stringify({ source: `/tmp/fx/hist (the recorder /tmp/fx/poll.sh), BN9 2026-09-30, passes ${stamps.join(" ")}: plan.txt with the exitinputs.txt the same pass published`, passes: passes.map(slimPass) }));
    console.log(`wrote ${out}: ${passes.length} passes`);
    process.exit(0);
  }
  const rows = replay(passes, { log: true });
  console.log("\nTHE LIFE LENGTH'S SHARE of each no-event move (both passes on the earlier pass's committed install and batch):");
  for (const p of lengthPairs(passes, rows)) {
    const s = (x) => `${x.prevH}h -> ${x.curH}h ${x.ok ? "ok" : "UNSTABLE"} (${x.diffH > 0 ? "+" : ""}${x.diffH}h, tol ${x.tolH}h)`;
    console.log(`${p.from}->${p.to}  chooser L${p.oldL[0]}->L${p.oldL[1]}: ${s(p.old)}   |   committed L${p.newL[0]}->L${p.newL[1]}: ${s(p.new)}`);
  }
}
