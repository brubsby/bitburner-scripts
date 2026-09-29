// [PP] The plan's exit simulation is cheap enough to finish its Monte Carlo,
// and one pass prices one committed trajectory on one draw set.
//
// Live BN9 2026-09-29 13:44 (after 1622032, the formula priors): PLAN BLOCKED
// THE PAGE (one exit simulation 318ms against a 50ms limit, 'plan-install'
// step 30 of 31) and PLAN UNDER-SAMPLED (3 of 24 draws). The profile of that
// pass's replay (fixture-bn9-plancpu-1341.json): the shaped climb's 1%-level
// chunks (exitplan.hoursToLevelShaped / expAfterHours, ~60% of the CPU) inside
// a policy search that, at the purchase model's 0.5h cadence, priced ~340
// install counts per simulation.
//
//   PP1  the climb in closed form (exponential integral) against the chunked
//        integration and a fine Simpson reference, over M 0.5-50, the rate's
//        slope and flat part, exp0 and the level (6000 included): < 0.5% on
//        hours against the chunks, < 1e-6 against the fine integral
//   PP2  the policy search strides past its head: the same best install count
//        and exit as the one-by-one search, on every fixture's inputs x draws
//        x install waits (with and without the purchase model's cadence)
//   PP3  CPU GUARD: the 13:41 install decision (10 options) and the graft
//        decision on the 13:56 basis, replayed in coop.js slices at the live
//        budgets: all 24 draws inside the work budget with margin, no step
//        over the slice, no block over the limit
//   PP4  PLAN INCONSISTENT (13:56, 71.683h vs 74.324h, both n = 24): the
//        install decision re-plans its committed batch while the graft
//        decision priced the last pass's — same noise and inputs keys, another
//        trajectory. Named (INCONSISTENT BATCH), rebased, exactly equal after.
//        And a budget-stopped decision is compared on the draws both priced.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const X = await import("../../exitplan.js");
const P = await import("../../plan.js");
const CO = await import("../../coop.js");
const GP = await import("../../gangplan.js");
const GW = await import("../../gangworth.js");
const { bitNodeMults } = await import("../../bitNodeMultipliers.js");
const { RW_PRIOR } = await import("../../traderw.js");

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-plancpu-1341.json"), "utf8"));

/** The 13:41 pass's posteriors, rebuilt from its published summary (plan.posteriorSummary). */
function postOf(ps) {
  const c = ps.cadence;
  return {
    drift: { s: ps.s, nu: ps.driftNu ?? 4, a: 2, b: 2 * ps.s * ps.s },
    gymSdLn: 0.1,
    cadence: c ? { rate: { mean: Math.log(c.lnPerHour), sd: c.rateSdLn }, life: { mean: Math.log(c.cycleHours), sd: c.lifeSdLn }, own: { weight: c.ownWeight } } : null,
    expPost: ps.exp ? { perSec: ps.exp.perSec, sd: ps.exp.sdLn } : null,
    income: ps.income ? { perSec: ps.income.perSec, mean: Math.log(ps.income.perSec), sd: ps.income.sdLn } : null,
  };
}
const POST = postOf(F.posteriors1341);
const DRAWS = P.makeDraws(POST, P.PLAN.N, P.seedOf(1790660521043, 9));
const INPUTS = { ...F.exitinputs, cadenceFrom: F.exitinputs.cadenceFrom ?? "purchase model" };
const DRAWS0 = DRAWS;
const INPUTS0 = INPUTS;
// THE CURVE r(W) as progress.js now passes it (traderw.js; plan.traderBeliefOf
// on the prior — no rows past the first hour): capitalReturnPerSec = r0,
// capitalScaleW = W*, capitalShape; the draws move both.
const CURVE_BELIEF = (() => {
  const b = P.traderBeliefOf([{ t: 0, wealth: 1e6, lifePnl: 0 }, { t: 10, wealth: 1e6, lifePnl: 0 }]);
  return { inputs: { capitalReturnPerSec: b.r, capitalScaleW: b.Wstar, capitalShape: b.shape }, draws: P.makeDraws({ ...POST, trader: b.post }, P.PLAN.N, P.seedOf(1790660521043, 9)), belief: b };
})();
const NOW = Date.parse(F.at1341);

/** The 13:41 install decision's point, as progress.js builds it (the waits from 2h on carry the planned batch). */
function pointOf(inputs, gains) {
  const H = (spec) => P.trajectoryOf(spec)(inputs);
  const waits = F.install1341.waitsH.map((w) => {
    const g = w >= F.install1341.gainsFromH ? gains : null;
    return { waitH: w, hours: H({ kind: "wait", waitH: w, gains: g }), installGains: g };
  });
  return { now: { hours: H({ kind: "wait", waitH: 0 }) }, waits, never: { hours: H({ kind: "never" }) }, committedGains: gains };
}

export async function run() {
  const checks = [];

  // ---------------------------------------------------------------------
  {
    const c = new Check("PP1", "the shaped climb in closed form: < 0.5% on hours against the 1% chunks, < 1e-6 against a fine integral, over M 0.5-50, slope, flat part, exp0 and level (6000 included)");
    // dt/dL = u / (32 M r(L)), u = exp((L/M + 200)/32): Simpson in L.
    const fine = (L0, L1, M, F0, k, n = 20000) => {
      const f = (L) => Math.exp((L / M + 200) / 32) / (32 * M) / (F0 + k * (Math.max(1, L) + 50));
      const h = (L1 - L0) / n;
      let s = f(L0) + f(L1);
      for (let i = 1; i < n; i++) s += f(L0 + i * h) * (i % 2 ? 4 : 2);
      return (s * h) / 3 / 3600;
    };
    const contL = (E, M) => M * (32 * Math.log(E + 534.6) - 200);
    let n = 0;
    let worstChunk = 0;
    let worstFine = 0;
    let worstTrip = 0;
    let worstAfter = 0;
    let worstShort = 0;
    let tClosed = 0;
    let tChunk = 0;
    for (const M of [0.5, 0.7, 1, 1.0005, 2, 5, 10, 20, 50]) {
      for (const k of [0.03, 0.3, 3]) {
        for (const flatShare of [0, 0.5]) {
          // flat part: a share of the rate at level 200 (a sleeve's transfer)
          const F0 = flatShare > 0 ? (flatShare / (1 - flatShare)) * k * 250 : 0;
          const rate = X.affineRate(F0, k);
          const plain = (l) => F0 + k * (Math.max(1, l) + 50);
          for (const from of [0, 200, 1000]) {
            for (const level of [2500, 6000]) {
              const e0 = from === 0 ? 0 : X.expForLevel(from, M);
              const need = X.expForLevel(level, M);
              if (!(need > e0) || !Number.isFinite(need)) continue;
              n++;
              let a = performance.now();
              const hc = X.hoursToLevelShaped(level, M, e0, rate);
              tClosed += performance.now() - a;
              a = performance.now();
              const hk = X.hoursToLevelChunked(level, M, e0, plain);
              tChunk += performance.now() - a;
              worstChunk = Math.max(worstChunk, Math.abs(hc / hk - 1));
              worstFine = Math.max(worstFine, Math.abs(hc / fine(Math.max(1, contL(e0, M)), level, M, F0, k) - 1) * (contL(e0, M) >= 1 ? 1 : 0));
              // Round trip: the exp after the climb's hours is the level's.
              worstTrip = Math.max(worstTrip, Math.abs((X.expAfterHours(e0, hc, M, rate) + 534.6) / (need + 534.6) - 1));
              // Part-way: the chunked exp after the same hours is reached by the closed clock within 0.5% of those hours.
              for (const fr of [0.01, 0.3, 0.9]) {
                const eK = X.expAfterHoursChunked(e0, hc * fr, M, plain);
                const tBack = X.hoursToLevelShaped(contL(eK, M), M, e0, rate);
                worstAfter = Math.max(worstAfter, Math.abs(tBack / (hc * fr) - 1));
              }
              // A 36s step (the reputation leg's minutes: the second-order path, or the clock where the level jumps)
              // against RK4 on the increment dE/dt = r(L(e0 + d)) (the
              // increment carried on its own: e0 + d loses d's digits at large e0).
              const eS = X.expAfterHours(e0, 0.01, M, rate);
              const u0 = e0 + 534.6;
              const L0 = contL(e0, M);
              const f = (d) => plain(L0 + 32 * M * Math.log1p(d / u0));
              let d = 0;
              const hS = 36 / 5000;
              for (let i = 0; i < 5000; i++) {
                const k1 = f(d), k2 = f(d + (hS * k1) / 2), k3 = f(d + (hS * k2) / 2), k4 = f(d + hS * k3);
                d += (hS * (k1 + 2 * k2 + 2 * k3 + k4)) / 6;
              }
              // Only where the increment survives in doubles at all (else neither path can represent it).
              if (d > 1e-6 * u0) worstShort = Math.max(worstShort, Math.abs((eS - e0) / d - 1));
            }
          }
        }
      }
    }
    c.examined(n);
    c.note(`${n} climbs: closed vs chunks worst ${(100 * worstChunk).toFixed(3)}%; vs a fine Simpson integral ${worstFine.toExponential(1)}; round trip ${worstTrip.toExponential(1)}; chunked exp part-way, closed clock ${(100 * worstAfter).toFixed(3)}% of the hours; short-step path ${worstShort.toExponential(1)}`);
    c.note(`time: closed ${tClosed.toFixed(1)}ms vs chunks ${tChunk.toFixed(1)}ms (x${(tChunk / tClosed).toFixed(0)})`);
    if (!(worstChunk < 0.005)) c.fail(`the closed form must agree with the chunked climb within 0.5% on hours (worst ${(100 * worstChunk).toFixed(3)}%)`);
    if (!(worstFine < 1e-6)) c.fail(`the closed form must be the integral (vs a fine Simpson integral ${worstFine.toExponential(2)})`);
    if (!(worstTrip < 1e-6)) c.fail(`expAfterHours must invert the climb (worst ${worstTrip.toExponential(2)})`);
    if (!(worstAfter < 0.005)) c.fail(`expAfterHours must agree with the chunks within 0.5% on hours (worst ${(100 * worstAfter).toFixed(3)}%)`);
    // taylorStep takes a step when the first omitted term is < 1e-6 of it: the step is held to 2e-6.
    if (!(worstShort < 2e-6)) c.fail(`a 36s step (series or clock) must land within 2e-6 of the integral (worst ${worstShort.toExponential(2)})`);
    if (!(tChunk > 5 * tClosed)) c.fail(`the closed form must be much cheaper than the chunks (${tClosed.toFixed(1)}ms vs ${tChunk.toFixed(1)}ms)`);
    // Wiring: every rate the exit builds is tagged affine, so the closed form is what runs.
    const shaped = X.expRateShape(300, { scales: true, ref: 200, flat: 50 });
    const flat = X.expRateShape(300);
    if (!(shaped.affine && flat.affine && shaped(450) === 50 + 250 * (500 / 250) && flat(4000) === 300)) c.fail("expRateShape must return a tagged affine rate with the same values");
    const src = fs.readFileSync(path.join(REPO_ROOT, "exitplan.js"), "utf8");
    if (!/const rateAt = base\.affine \? affineRate\(/.test(src)) c.fail("the sleeve's segment rate must stay affine (else the climb falls back to the chunks)");
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("PP2", "the policy search strides past its head: the same best install count and exit as the one-by-one search, on every fixture's inputs");
    const linear = (o, max = 400, min = 0) => {
      let best = null;
      let worse = 0;
      let tried = 0;
      for (let k = min; k <= max; k++) {
        const r = X.exitHours({ ...o, installsFirst: k });
        tried++;
        const ok = typeof r.hours === "number" && Number.isFinite(r.hours);
        if (ok && (best === null || r.hours < best.hours)) {
          best = { hours: r.hours, k };
          worse = 0;
        } else if (best !== null && ok && ++worse >= 15) break;
      }
      return { best, tried };
    };
    const sets = [];
    const find = (o, f) => {
      if (!o || typeof o !== "object") return;
      if (o.hackingMult && o.exitLevel && o.incomePerSec !== undefined) return void sets.push([f, o]);
      for (const k of Object.keys(o)) find(o[k], f);
    };
    for (const f of fs.readdirSync(path.join(REPO_ROOT, "tools/test")).filter((x) => x.startsWith("fixture-") && x.endsWith(".json"))) find(JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test", f), "utf8")), f);
    const post = { drift: { a: 2, b: 0.02, nu: 4 }, gymSdLn: 0.1, expPost: { sd: 0.2 }, cadence: { rate: { mean: Math.log(0.01), sd: 0.8 }, life: { mean: Math.log(3), sd: 0.8 } }, income: { mean: Math.log(1e4), sd: 1 } };
    const draws = P.makeDraws(post, 3, 3);
    let n = 0;
    let same = 0;
    let triedL = 0;
    let triedG = 0;
    const bad = [];
    for (const [f, I] of sets) {
      for (const d of draws) {
        for (const w of [0, 4]) {
          for (const pm of [false, true]) {
            const x = { ...P.applyDraw({ ...I, ...(pm ? { cadenceFrom: "purchase model", cycleHours: 0.5 } : {}) }, d), firstInstallH: w };
            const L = linear(x);
            const G = X.bestExitPolicy(x, 400, 0);
            n++;
            triedL += L.tried;
            triedG += G.tried.length;
            const ok = (!L.best && !G.best) || (L.best && G.best && L.best.k === G.best.installsFirst && L.best.hours === G.best.hours);
            if (ok) same++;
            else bad.push(`${f} draw ${d.i} wait ${w}${pm ? " 0.5h cycles" : ""}: one-by-one ${L.best?.k}/${L.best?.hours} vs ${G.best?.installsFirst}/${G.best?.hours}`);
          }
        }
      }
    }
    c.examined(n);
    c.note(`${sets.length} fixture input sets x ${draws.length} draws x 2 waits x 2 cadences: ${same}/${n} identical; policies priced ${(triedG / n).toFixed(1)} per search vs ${(triedL / n).toFixed(1)} one by one`);
    if (same !== n) c.fail(`the strided search must find the one-by-one optimum (${n - same} differ)`, bad.slice(0, 5).join("\n"));
    // The generator is the same search, one policy per step.
    const x = { ...P.applyDraw(INPUTS, DRAWS[0]), firstInstallH: 4, installGains: F.install1341.gains, nextInstallGain: F.install1341.gains.hacking };
    const g = X.bestExitPolicyGen({ ...x, hackingExp: x.hackingExp + 1 }, 400, 1);
    let steps = 0;
    let r;
    while (!(r = g.next()).done) steps++;
    const s = X.bestExitPolicy({ ...x, hackingExp: x.hackingExp + 1 }, 400, 1);
    if (!(r.value.best.hours === s.best.hours && steps === r.value.tried.length)) c.fail("bestExitPolicyGen must be the same search, yielding once per policy priced", `${steps} steps, ${r.value.tried.length} tried`);
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  for (const [ID, CURVE] of [["PP3", null], ["PP3c", CURVE_BELIEF]]) {
    const INPUTS = CURVE ? { ...INPUTS0, ...CURVE.inputs } : INPUTS0;
    const DRAWS = CURVE ? CURVE.draws : DRAWS0;
    const c = new Check(ID, (CURVE ? "ON THE CURVE r(W) (traderw.js: the trader's return at its own book, level and knee drawn): " : "") + "CPU GUARD, a full re-deciding plan pass replayed on the live BN9 inputs in coop.js slices at the live budgets: install (10 options), grafts, the graft rebase, the 4S TIX API (2), gang (3 arms) and sleeve objective (4) — every decision all 24 draws inside the one work budget with margin, no step near the slice");
    const gains = F.install1341.gains;
    const point = pointOf(INPUTS, gains);
    const prev = { key: F.install1341.key, installAt: F.install1341.installAt, gains, spec: { kind: "wait", installAt: F.install1341.installAt, waitH: 4, gains }, decidedAt: F.at1341, why: "fixture" };
    const withG = { ...INPUTS, finalGrafts: F.grafts1356.grafts, graftStartMoney: F.grafts1356.startMoney };
    const basisOf = (g) => P.basisOf({ key: F.install1356.key, installAt: F.install1356.installAt, gains: g, spec: { ...F.install1356.spec, gains: g } }, Date.parse(F.at1356));
    const graftOpts = (basis) => {
      const traj = P.trajectoryOf(basis);
      return [
        { key: "none", noiseKey: P.noiseKeyOf(basis, INPUTS), sim: (d) => traj(P.applyDraw(INPUTS, d), d) },
        { key: "grafts", noiseKey: P.noiseKeyOf(basis, withG), sim: (d) => traj(P.applyDraw(withG, d), d) },
      ];
    };
    // The gang's income as progress.js gangScheduleNow simulates it where no
    // gang has earned yet (BitNode 9's softcap), and the pending gang's grind
    // (karma -51068 of -54000 at 14:19; stated hours — this guards CPU, not the answer).
    const sim = GP.simulateGang({ faction: "Slum Snakes", isHacking: false, respect: 1, wantedLevel: 1, territory: 1 / 7, power: 1, territoryClashChance: 0, territoryWarfareEngaged: false }, [], { softcap: bitNodeMults(9).GangSoftcap, horizonH: 100, stepSec: 300, mode: "money", assignFn: GP.trainRatio(4.2, false, 1), ascend: { minGain: 1.09 }, rivals: Object.fromEntries(["Tetrads", "The Syndicate", "The Dark Army", "Speakers for the Dead", "NiteSec", "The Black Hand"].map((n) => [n, { power: 1, territory: 1 / 7 }])), warfare: { fraction: 0, engageRatio: 1 } });
    const sched = GW.gangIncomeSchedule(sim);
    const grinds = { fleet: 2.0, player: 1.2 };
    const eBudget = F.exitinputs1416.eBudget ?? 0.1;
    const armH = (k, b) => {
      const r = GW.gangArms(X.bestExitPolicy, b, sched, k === "none" ? {} : { [k]: grinds[k] }, eBudget, 400, { lower: false });
      return k === "none" ? r.withoutH : r.arms?.[k]?.withH ?? null;
    };
    // The sleeve objective's candidates (progress.js sleeveObjectiveByExit, gang pending): each a gang exit after its grind.
    const by = { karma: 0.5, rep: 3, exp: 50, money: 1e4 };
    const finish = (inputs) => GW.gangExit(X.bestExitPolicy, inputs, sched, grinds.fleet, eBudget)?.withH ?? null;
    const sleeveFns = [
      ["karma", (b) => finish(b)],
      ["rep", (b) => finish({ ...b, sleeveRep: { perSec: by.rep, delayH: 0 }, repBoost: { K: (b.repPerSec + by.rep) / b.repPerSec, e: 0.3 } })],
      ["exp", (b) => finish({ ...b, expPerSec: (b.expPerSec ?? 0) + by.exp, spendPerSec: 1600 })],
      ["money", (b) => finish({ ...b, extraIncome: [{ atH: 0, perSec: by.money }], eBudget })],
    ];
    const pacer = CO.makePacer({ sliceMs: P.PLAN.sliceMs, yieldFn: () => new Promise((r) => setImmediate(r)), memory: new Map() });
    const budget = P.PLAN.budgetMs;
    const decisions = {};
    const left = () => Math.max(20, budget - Object.values(decisions).reduce((a, d) => a + (d?.ms ?? 0), 0));
    decisions.grafts = await pacer.slices(P.decideAmongGen({ options: graftOpts(basisOf(F.install1341.gains)), draws: DRAWS, redecide: true, budgetMs: left(), clock: pacer.cpuNow }), "plan-grafts");
    decisions.install = await pacer.slices(P.decideInstallGen({ inputs: INPUTS, point, prev, draws: DRAWS, redecide: true, budgetMs: left(), clock: pacer.cpuNow, now: NOW }), "plan-install");
    decisions.graftsRebased = await pacer.slices(P.decideAmongGen({ options: graftOpts(basisOf(F.install1356.gains)), draws: DRAWS, redecide: true, budgetMs: left(), clock: pacer.cpuNow }), "plan-graftsRebased");
    // The 4S TIX API (progress.js fourSDecisionOf): none vs bought this life, on the committed basis with the grafts carried.
    {
      const basis = basisOf(F.install1356.gains);
      const traj = P.trajectoryOf(basis);
      const pr = RW_PRIOR["4S-long"];
      const withF = { ...withG, fourS: { cost: 25e9 * bitNodeMults(9).FourSigmaMarketDataApiCost, when: "life1", r0PerSec: pr.r0PerHour / 3600, Wstar: pr.Wstar, shape: pr.shape } };
      const nk = P.noiseKeyOf(basis, withG);
      decisions.fourS = await pacer.slices(P.decideAmongGen({ options: [{ key: "none", noiseKey: nk, sim: (d) => traj(P.applyDraw(withG, d), d) }, { key: "now", noiseKey: nk, sim: (d) => traj(P.applyDraw(withF, d), d) }], prev: { key: "none" }, draws: DRAWS, redecide: true, budgetMs: left(), clock: pacer.cpuNow }), "plan-fourS");
    }
    // The gang and sleeve decisions on the 14:16 pass's inputs (the 13:41 ones price the default policy degenerate: no gang arm would run).
    const I2 = CURVE ? { ...F.exitinputs1416, ...CURVE.inputs } : F.exitinputs1416;
    const { inputs: b0 } = GW.withRepEstimate(I2);
    decisions.gang = await pacer.slices(P.decideAmongGen({ options: ["none", "fleet", "player"].map((k) => ({ key: k, sim: (dr) => armH(k, P.applyDraw(b0, dr)) })), draws: DRAWS, redecide: true, budgetMs: left(), clock: pacer.cpuNow }), "plan-gang");
    decisions.sleeveObjective = await pacer.slices(P.decideAmongGen({ options: sleeveFns.map(([k, f]) => ({ key: k, sim: (dr) => f(P.applyDraw(I2, dr)) })), draws: DRAWS, redecide: true, budgetMs: left(), clock: pacer.cpuNow }), "plan-sleeveObjective");
    const spent = Object.values(decisions).reduce((a, d) => a + (d?.ms ?? 0), 0);
    c.examined(Object.keys(decisions).length);
    for (const [name, d] of Object.entries(decisions)) {
      const sec = pacer.stats.sections[`plan-${name}`];
      c.note(`${name.padEnd(15)} ${String(d.key).padEnd(7)} mean ${d.meanH}h on ${d.n}/${DRAWS.length} draws, ${d.ms}ms work, ${sec.steps} steps, longest ${sec.maxStepMs.toFixed(1)}ms`);
      if (!(d.n === DRAWS.length && d.overBudget === false)) c.fail(`${name}: all ${DRAWS.length} draws must price inside the pass's budget (${d.n}, over budget ${d.overBudget})`);
      if (!(sec.maxStepMs < P.PLAN.sliceMs / 2)) c.fail(`${name}: a ${sec.maxStepMs.toFixed(1)}ms step approaches the ${P.PLAN.sliceMs}ms slice`);
    }
    c.note(`live 13:41 (before): install ${F.install1341.key} ${F.install1341.meanH}h on ${F.install1341.n} draws, ${F.install1341.cpu.sections["plan-install"].cpuMs}ms, longest step ${F.install1341.cpu.sections["plan-install"].maxStepMs}ms`);
    c.note(`pass: ${spent.toFixed(0)}ms of the ${budget}ms work budget (margin: at most two thirds), longest block ${pacer.stats.maxBlockMs.toFixed(1)}ms (slice ${P.PLAN.sliceMs}ms, limit ${P.PLAN.maxBlockMs}ms)`);
    if (!(spent <= 0.67 * budget)) c.fail(`the pass's decisions must use at most two thirds of the ${budget}ms budget on the dev machine (used ${spent.toFixed(0)}ms)`);
    // THE MARGIN UNDER THE GUARD (2026-09-29: PP3c ran 740-800ms against the
    // 804ms limit): the target is two thirds of the limit, a WARN past it —
    // not a FAIL, the dev machine's load moves a pass by +-10%.
    else if (!(spent <= (2 / 3) * 0.67 * budget)) c.warn(`the pass used ${spent.toFixed(0)}ms: past the margin target ${((2 / 3) * 0.67 * budget).toFixed(0)}ms (two thirds of the ${(0.67 * budget).toFixed(0)}ms limit)`);
    if (!(pacer.stats.maxBlockMs <= P.PLAN.maxBlockMs)) c.fail(`a ${pacer.stats.maxBlockMs.toFixed(1)}ms block exceeds ${P.PLAN.maxBlockMs}ms`);
    // Slicing changes nothing (the generator path is the sync path).
    const sync = P.decideInstall({ inputs: INPUTS, point, prev, draws: DRAWS, redecide: true, budgetMs: 1e9, now: NOW });
    if (!(sync.key === decisions.install.key && sync.meanH === decisions.install.meanH)) c.fail("the sliced install decision must equal the synchronous one", `${sync.key} ${sync.meanH} vs ${decisions.install.key} ${decisions.install.meanH}`);
    // The sleeve objective prices its gang exit without re-reading telemetry per draw (source guard).
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    const sleeveSrc = prog.slice(prog.indexOf("async function sleeveObjectiveByExit"), prog.indexOf("async function sleeveObjectiveByExit") + 6000);
    if (!/const gangExitOf = gang \? gangExitCtx\(ns, info\) : null/.test(sleeveSrc) || /gangExitNow\(ns, info, inputs/.test(sleeveSrc)) c.fail("the sleeve objective must read the gang schedule and eBudget once per pass (gangExitCtx), not per draw");
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("PP4", "ONE TRAJECTORY, ONE DRAW SET: the install decision's re-planned batch vs the graft decision's last-pass batch (live 13:56: 71.683h vs 74.324h, both n = 24) is named and rebased; a budget-stopped decision is compared on the draws both priced");
    const A = F.install1356.gains; // this pass's re-planned committed batch
    const B = F.install1341.gains; // an earlier pass's batch for the same install time
    const at = Date.parse(F.at1356);
    const inputs = { ...INPUTS, finalGrafts: F.grafts1356.grafts, graftStartMoney: F.grafts1356.startMoney };
    const rec = (gains) => ({ key: F.install1356.key, installAt: F.install1356.installAt, gains, spec: { ...F.install1356.spec, gains }, decidedAt: F.at1341, why: "fixture" });
    // The install decision, held on its committed wait with this pass's batch.
    const inst = P.decideInstall({ inputs, point: { committedGains: A }, prev: rec(A), draws: DRAWS, redecide: false, budgetMs: 1e9, now: at });
    // The graft decision, priced on the LAST pass's record (batch B), then rebased on the install's (A).
    const graftsOn = (gains, draws = DRAWS, budgetMs = 1e9, clk) => {
      const basis = P.basisOf(rec(gains), at);
      const t = P.trajectoryOf(basis);
      const d = P.decideAmong({ options: [{ key: "grafts", noiseKey: P.noiseKeyOf(basis, inputs), sim: (dr) => t(P.applyDraw(inputs, dr), dr) }], draws, budgetMs, ...(clk ? { clock: clk } : {}) });
      return { ...d, basisNoiseKey: P.noiseKeyOf(basis, inputs), basisGainsKey: P.gainsKeyOf(basis.gains), inputsKey: P.inputsKeyOf(inputs) };
    };
    const gOld = graftsOn(B);
    const gNew = graftsOn(A);
    const instK = { ...inst, inputsKey: P.inputsKeyOf(inputs) };
    const blind = P.consistencyOf({ ...instK, gainsKey: undefined, samples: undefined }, { ...gOld, basisGainsKey: undefined, samples: undefined });
    const named = P.consistencyOf(instK, gOld);
    const rebased = P.consistencyOf(instK, gNew);
    c.examined(4);
    c.note(`install held ${inst.key} (batch hacking x${A.hacking.toFixed(3)}): ${inst.meanH}h on ${inst.n} draws; grafts on the last pass's batch (x${B.hacking.toFixed(3)}): ${gOld.meanH}h — keys: noise ${inst.noiseKey === gOld.basisNoiseKey ? "same" : "differ"}, inputs same, batch ${inst.gainsKey} vs ${gOld.basisGainsKey}`);
    c.note(`without the batch key (the live check): ${blind.why}`);
    c.note(`with it: ${named.why}; rebased: ${rebased.why}`);
    if (!(inst.n === DRAWS.length && gOld.n === DRAWS.length)) c.fail("fixture: both decisions price every draw (the live pair were both n = 24: not a truncation)");
    if (!(blind.ok === false && blind.sameBasis === true)) c.fail("fixture: the two batches must read as INCONSISTENT on the same basis (else the check proves nothing)", JSON.stringify(blind));
    if (!(named.ok === false && named.sameBatch === false && /INCONSISTENT BATCH/.test(named.why))) c.fail("a graft decision priced on another batch for the same install time must be named as such", JSON.stringify(named));
    if (!(rebased.ok === true && rebased.diffH === 0)) c.fail("rebased on the install decision's batch, the two decisions must price one exit exactly", JSON.stringify(rebased));
    // The rebase fires on a batch that differs (source guard).
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    if (!/inst\.gainsKey !== undefined && gd\.basisGainsKey !== inst\.gainsKey/.test(prog) || !/basisGainsKey: gainsKeyOf\(spec\.gains \?\? null\)/.test(prog)) c.fail("progress.js must rebase the graft decision when its basis batch differs from the install decision's, and record the batch it rebased onto");
    // CAUSE 2 — draw subsets: the install decision stopped at 3 draws (as
    // live 13:44), the graft decision priced 24, same trajectory. Their
    // means are over different draws; compared on the 3 both priced they
    // agree exactly.
    let ticks = 0;
    const slowClock = () => (ticks++ < 2 ? 0 : 1e9); // start, then the check before draw 3: the budget binds there
    const inst3 = P.decideInstall({ inputs, point: { committedGains: A }, prev: rec(A), draws: DRAWS, redecide: false, budgetMs: 1, clock: slowClock, now: at });
    const i3 = { ...inst3, inputsKey: P.inputsKeyOf(inputs) };
    const prefixBlind = P.consistencyOf({ ...i3, samples: undefined }, { ...gNew, samples: undefined });
    const prefix = P.consistencyOf(i3, gNew);
    c.note(`install stopped at ${inst3.n} draws: ${inst3.meanH}h vs grafts ${gNew.meanH}h on ${gNew.n} — means over different draws: diff ${prefixBlind.diffH}h (tol ${prefixBlind.tolH}h); on the common draws: ${prefix.why}`);
    if (!(inst3.n < DRAWS.length && inst3.n >= 2)) c.fail(`fixture: the budget must stop the install decision early (n ${inst3.n})`);
    if (!(prefixBlind.diffH !== 0)) c.fail("fixture: means over different draw prefixes should differ (else the check proves nothing)");
    if (!(prefix.ok === true && prefix.diffH === 0 && prefix.common?.n === inst3.n)) c.fail("two decisions of one trajectory must be compared on the draws both priced — and then agree exactly", JSON.stringify(prefix));
    checks.push(c);
  }

  return checks;
}
