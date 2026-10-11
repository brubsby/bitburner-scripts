// [PS] THE INSTALL-COUNT SEARCH FINDS THE EXIT: past runs of lives that buy
// nothing, and past 400 installs.
//
// Live BN13.1 2026-10-11: the plan's exit swung 45h -> 98h -> 1686h between
// passes; healthcheck 21:04Z "SWITCH ARTEFACT: L0.5 -> L8 gains 9283.9h
// against a 72.5h exit (> 10x) — the incumbent (9356.5h), 20883.0h when last
// priced"; earlier EXIT UNSTABLE and TWO EXITS AT INSTALL (0h/190h/250h).
//
// The cause (exitplan.bestExitPolicyGen) was two stops that assumed the exit
// over the install count k is unimodal and near:
//   - the 15-worse rule: one by one until 15 policies in a row fail to beat
//     the best. Lives that buy nothing leave flat or rising runs that end in
//     a drop — on the 19:27Z inputs the exit is EQUAL on 17..32 installs
//     (5.68e8h) and falls to 1623h at 249; the rule stopped at 32 and
//     returned 5.68e8h. (0d49ae1's samebuilder tests had to optimise
//     exhaustively for this reason.)
//   - maxInstalls = 400, whatever the life length: at L0.5 that is 200h of
//     lives, and a slow draw's optimum sits at 553-1131 installs — priced at
//     the 400 edge as 1443h .. 3.4e12h. That is the L0.5 incumbent's 9356.5h.
// Fixed: the search runs to the HORIZON — (k - 1) cycleHours reaching the
// best exit, past which no policy can win — up to POLICY_FAR, and probes
// past every optimum it settles on at doubling distances to that horizon.
//
//   PS1 FLAT RUN      the 19:27Z inputs (fixture-bn13-samebuilder-1927): the
//                     exit is flat on 17..32 then falls; the old 15-worse walk
//                     stops at 5.68e8h, the search finds the exhaustive 1623h
//   PS2 RISE, THEN DIP a gang arm (fixture-bn9-plancpu-1341, 14:16 inputs on
//                     the r(W) curve): the exit rises from 1 install, then
//                     halves near 270 — every draw at the exhaustive optimum
//   PS3 THE HORIZON   the 21:03Z life length options (fixture-bn13-
//                     lifelength-2103): every option x 24 draws feasible and
//                     in a sane band, L0.5 at the exhaustive optimum past 400
//                     (not its 400 edge), and not 10x the committed L8
//   PS4 PASS TO PASS  the same options under small input moves (income +-2%,
//                     exp +1%, the wait +0.1h, the rate's sd -5%): no option
//                     moves 10% (the live exits moved 10x); same inputs, same exit
//   PS5 THE BOUND     the horizon is sound: exitHours(k) >= (k - 1) cycleHours
//                     on every input set here, k to POLICY_FAR
//   PS6 CPU           the 21:03Z options' 240 searches: fewer policies a search
//                     than the capped search priced (28.5), every step < 10ms

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const X = await import("../../exitplan.js");
const P = await import("../../plan.js");
const LP = await import("../../lifeplan.js");
const GP = await import("../../gangplan.js");
const GW = await import("../../gangworth.js");
const { bitNodeMults } = await import("../../bitNodeMultipliers.js");
const fx = (f) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test", f), "utf8"));

const fin = (h) => typeof h === "number" && Number.isFinite(h);
/** Every policy from min to the horizon (or POLICY_FAR): the reference optimum. */
function exhaustive(o, max = 400, min = 1) {
  const L = o.cycleHours > 0 ? o.cycleHours : null;
  const far = max >= 400 ? 4000 : max; // exitplan POLICY_MAX / POLICY_FAR, spelled out: the reference must not move with the search
  let best = null;
  for (let k = min; k <= far; k++) {
    if (best && L && (k - 1) * L >= best.h) break;
    const h = X.exitHours(o, k, true).hours;
    if (fin(h) && (best === null || h < best.h)) best = { h, k };
  }
  return best;
}
/** The search as it was (HEAD before this fix): one by one from min, 15 non-improving in a row ends it, 400 at most. */
function oldWalk(o, max = 400, min = 1) {
  let best = null;
  let worse = 0;
  for (let k = min; k <= max; k++) {
    const h = X.exitHours(o, k, true).hours;
    if (fin(h) && (best === null || h < best.h)) {
      best = { h, k };
      worse = 0;
    } else if (best && fin(h) && ++worse >= 15) return { ...best, stoppedAt: k };
  }
  return { ...best, stoppedAt: max };
}
const same = (r, ex) => (ex === null ? !r.best : r.best && Math.abs(r.best.hours - ex.h) <= 1e-9 * ex.h);

// The 21:03Z life length options, rebuilt through lifeInputsOf (see the fixture's `source`).
const LL = fx("fixture-bn13-lifelength-2103.json");
const LI = LL.inputs;
const REC = { table: LI.cadence.table, moneyCalibration: LI.cadence.moneyCalibration, afterBatch: LI.cadence.afterBatch };
const optionOf = (row, I = LI) => {
  const x0 = LP.lifeInputsOf(I, REC, row.L, null);
  return { ...x0, multGainPerCycle: row.perLife, firstInstallH: LL.waitH, cadence: { ...x0.cadence, post: { mean: Math.log(Math.log(row.perLife) / row.L), sd: I.cadence.post.sd, weight: I.cadence.post.weight } } };
};
const OPTIONS = LL.lifeLength.table.map((row) => ({ L: row.L, x: optionOf(row) }));
const DRAWS = P.makeDraws({ drift: { a: 2, b: 0.02, nu: 4 }, gymSdLn: 0.1 }, P.PLAN.N, P.seedOf(LL.lastAugReset, LL.bitNode));
const drawn = (x, d) => P.applyDraw(x, { zCad: d.zCad, expMult: 1 });
/** An option's mean over the draws, an infeasible draw at 1.5x the worst priced (plan.summarize). */
function meanOf(x) {
  const hs = DRAWS.map((d) => {
    const r = X.bestExitPolicy(drawn(x, d), 400, 1);
    return r.degenerate ? null : (r.best?.hours ?? null);
  });
  const ok = hs.filter(fin);
  const worst = Math.max(...ok);
  return { mean: hs.reduce((a, h) => a + (fin(h) ? h : 1.5 * worst), 0) / hs.length, feasible: ok.length, hs };
}

export async function run() {
  const checks = [];

  // ---------------------------------------------------------------------
  {
    const c = new Check("PS1", "FLAT RUN: on the 19:27Z inputs the exit is flat on 17..32 installs, then falls — the old 15-worse walk stops at 5.68e8h, the search finds the exhaustive optimum");
    const I = fx("fixture-bn13-samebuilder-1927.json").inputs;
    for (const w of [0, 1]) {
      const x = { ...I, firstInstallH: w };
      const h = (k) => X.exitHours(x, k, true).hours;
      const flat = [17, 24, 32].map(h);
      c.examined(1);
      if (!(Math.abs(flat[0] - flat[2]) <= 1e-6 * flat[0] && Math.abs(flat[0] - flat[1]) <= 1e-6 * flat[0] && h(33) < flat[0] / 2)) c.fail(`fixture (w${w}): the exit must be flat on 17..32 and fall at 33 (${flat.map((v) => v.toPrecision(4)).join(", ")} -> ${h(33).toPrecision(4)})`);
      const old = oldWalk(x);
      const ex = exhaustive(x);
      const r = X.bestExitPolicy(x, 400, 1);
      c.note(`w${w}: old walk ${old.h.toPrecision(4)}h at ${old.k} (stopped at ${old.stoppedAt}); exhaustive ${ex.h.toFixed(1)}h at ${ex.k}; search ${r.best?.hours?.toFixed(1)}h at ${r.best?.installsFirst} (${r.tried.length} policies)`);
      if (!(old.h > 1e8 && old.stoppedAt <= 32)) c.fail(`the old walk's stop is the cause: it must stop in the flat run (${old.h} at ${old.k}, stopped ${old.stoppedAt})`);
      if (!same(r, ex)) c.fail(`w${w}: the search must find the exhaustive optimum ${ex.h.toFixed(1)}h at ${ex.k} (got ${r.best?.hours}h at ${r.best?.installsFirst})`);
    }
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("PS2", "RISE, THEN DIP: a gang arm's exit rises from 1 install and halves near 270 (BN9 14:16 inputs on the r(W) curve) — every draw's search at the exhaustive optimum");
    const F = fx("fixture-bn9-plancpu-1341.json");
    const b = P.traderBeliefOf([{ t: 0, wealth: 1e6, lifePnl: 0 }, { t: 10, wealth: 1e6, lifePnl: 0 }]);
    const ps = F.posteriors1341;
    const cd = ps.cadence;
    const post = { drift: { s: ps.s, nu: 4, a: 2, b: 2 * ps.s * ps.s }, gymSdLn: 0.1, cadence: { rate: { mean: Math.log(cd.lnPerHour), sd: cd.rateSdLn }, life: { mean: Math.log(cd.cycleHours), sd: cd.lifeSdLn }, own: { weight: cd.ownWeight } }, expPost: { perSec: ps.exp.perSec, sd: ps.exp.sdLn }, income: { perSec: ps.income.perSec, mean: Math.log(ps.income.perSec), sd: ps.income.sdLn }, trader: b.post };
    const draws = P.makeDraws(post, 6, P.seedOf(1790660521043, 9));
    const { inputs: b0 } = GW.withRepEstimate({ ...F.exitinputs1416, capitalReturnPerSec: b.r, capitalScaleW: b.Wstar, capitalShape: b.shape });
    const sim = GP.simulateGang({ faction: "Slum Snakes", isHacking: false, respect: 1, wantedLevel: 1, territory: 1 / 7, power: 1, territoryClashChance: 0, territoryWarfareEngaged: false }, [], { softcap: bitNodeMults(9).GangSoftcap, horizonH: 100, stepSec: 300, mode: "money", assignFn: GP.trainRatio(4.2, false, 1), ascend: { minGain: 1.09 }, rivals: Object.fromEntries(["Tetrads", "The Syndicate", "The Dark Army", "Speakers for the Dead", "NiteSec", "The Black Hand"].map((n) => [n, { power: 1, territory: 1 / 7 }])), warfare: { fraction: 0, engageRatio: 1 } });
    const sched = GW.gangIncomeSchedule(sim);
    let n = 0;
    let dips = 0;
    const bad = [];
    const lines = [];
    const checked = (o, max = 400, min = 0) => {
      const r = X.bestExitPolicy(o, max, min);
      const ex = exhaustive(o, max, min ?? 0);
      n++;
      if (!same(r, ex)) bad.push(`${r.best?.hours?.toFixed(1)}h at ${r.best?.installsFirst} vs ${ex?.h?.toFixed(1)}h at ${ex?.k}`);
      const old = oldWalk(o, max, min ?? 0);
      if (ex && old.h > 1.5 * ex.h) {
        dips++;
        if (lines.length < 3) lines.push(`old walk ${old.h.toFixed(1)}h at ${old.k}, exhaustive and search ${ex.h.toFixed(1)}h at ${ex.k}`);
      }
      return r;
    };
    for (const d of draws) GW.gangArms(checked, P.applyDraw(b0, d), sched, { fleet: 2.0 }, F.exitinputs1416.eBudget ?? 0.1, 400, { lower: false });
    c.examined(n);
    c.note(`${n} searches (the arm with and without the gang, ${draws.length} draws): ${n - bad.length} at the exhaustive optimum; ${dips} where the old walk stopped >1.5x above it — ${lines.join("; ")}`);
    if (bad.length) c.fail(`every search must find the exhaustive optimum (${bad.length} of ${n} differ)`, bad.slice(0, 4).join("\n"));
    if (!(dips >= 1)) c.fail("fixture: the old walk must miss the dip on some draw (the shape this check guards)");
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("PS3", "THE HORIZON: the 21:03Z life length options x 24 draws — every option feasible in a sane band, L0.5 at the exhaustive optimum past 400 installs, not 10x the committed L8");
    const means = {};
    for (const o of OPTIONS) {
      const m = meanOf(o.x);
      means[o.L] = m;
      c.examined(DRAWS.length);
      if (m.feasible !== DRAWS.length) c.fail(`L${o.L}: every draw must price (${m.feasible}/${DRAWS.length} feasible)`);
      if (!(m.mean < 1000)) c.fail(`L${o.L}: mean ${m.mean.toFixed(1)}h is not a sane exit (live L0.5 9356.5h)`);
    }
    const best = Math.min(...Object.values(means).map((m) => m.mean));
    c.note(OPTIONS.map((o) => `L${o.L} ${means[o.L].mean.toFixed(1)}h`).join(", ") + ` (live 21:03Z: L0.5 ${LL.lifeLength.options.find((x) => x.key === "L0.5")?.meanH}h, L8 ${LL.lifeLength.options.find((x) => x.key === "L8")?.meanH}h)`);
    for (const o of OPTIONS) if (!(means[o.L].mean <= 5 * best)) c.fail(`L${o.L}: ${means[o.L].mean.toFixed(1)}h is past 5x the best option's ${best.toFixed(1)}h`);
    if (!(means[0.5].mean < 10 * means[8].mean)) c.fail(`L0.5 (${means[0.5].mean.toFixed(1)}h) must not price 10x L8 (${means[8].mean.toFixed(1)}h): the SWITCH ARTEFACT`);
    // L0.5 draw by draw against every policy to the horizon; its slow draws
    // sit past 400 installs. A sawtooth tooth narrower than its distance from
    // the best can slip between two probes (draw 14: 90.2h at 96 against
    // 82.8h at 129): at most one draw, within 10%.
    const x05 = OPTIONS.find((o) => o.L === 0.5).x;
    let past = 0;
    const bad = [];
    const off = [];
    let worstEdge = null;
    for (const d of DRAWS) {
      const x = drawn(x05, d);
      const r = X.bestExitPolicy(x, 400, 1);
      const ex = exhaustive(x);
      if (!same(r, ex)) (r.best && r.best.hours <= 1.1 * ex.h ? off : bad).push(`draw ${d.i}: ${r.best?.hours?.toFixed(1)}h at ${r.best?.installsFirst} vs ${ex.h.toFixed(1)}h at ${ex.k}`);
      if (ex.k > 400) {
        past++;
        const edge = X.exitHours(x, 400, true).hours;
        if (!worstEdge || edge / ex.h > worstEdge.ratio) worstEdge = { ratio: edge / ex.h, edge, ex };
      }
    }
    c.note(`L0.5: ${DRAWS.length - bad.length - off.length}/${DRAWS.length} draws at the exhaustive optimum${off.length ? ` (within 10%: ${off.join("; ")})` : ""}; ${past} past 400 installs (worst: ${worstEdge?.ex.h.toFixed(1)}h at ${worstEdge?.ex.k}, against ${worstEdge?.edge.toPrecision(3)}h at the old 400 edge)`);
    if (bad.length || off.length > 1) c.fail("L0.5: every draw must find the exhaustive optimum (one within 10% allowed)", [...bad, ...off].slice(0, 4).join("\n"));
    if (!(past >= 3 && worstEdge.ratio > 10)) c.fail(`fixture: L0.5's slow draws must sit past 400 installs, the edge priced >10x (${past}, x${worstEdge?.ratio})`);
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("PS4", "PASS TO PASS: the 21:03Z options under small input moves (income +-2%, exp +1%, the wait +0.1h, the rate's sd -5%) move < 10%; the same inputs price the same exit");
    const moves = [
      ["income -2%", (x) => ({ ...x, incomePerSec: x.incomePerSec * 0.98 })],
      ["income +2%", (x) => ({ ...x, incomePerSec: x.incomePerSec * 1.02 })],
      ["exp +1%", (x) => ({ ...x, hackingExp: x.hackingExp * 1.01 })],
      ["wait +0.1h", (x) => ({ ...x, firstInstallH: x.firstInstallH + 0.1 })],
      ["rate sd -5%", (x) => ({ ...x, cadence: { ...x.cadence, post: { ...x.cadence.post, sd: x.cadence.post.sd * 0.95 } } })],
    ];
    let worst = { r: 1 };
    for (const o of OPTIONS) {
      const m0 = meanOf(o.x).mean;
      const again = meanOf({ ...o.x }).mean;
      if (again !== m0) c.fail(`L${o.L}: the same inputs must price the same exit (${m0} vs ${again})`);
      for (const [name, f] of moves) {
        const m = meanOf(f(o.x)).mean;
        const r = Math.max(m, m0) / Math.min(m, m0);
        c.examined(1);
        if (r > worst.r) worst = { r, L: o.L, name, m0, m };
        if (!(r < 1.1)) c.fail(`L${o.L} ${name}: ${m0.toFixed(1)}h -> ${m.toFixed(1)}h (x${r.toFixed(2)})`);
      }
    }
    c.note(`largest move: L${worst.L} ${worst.name} ${worst.m0?.toFixed(1)}h -> ${worst.m?.toFixed(1)}h (x${worst.r.toFixed(3)})`);
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("PS5", "THE BOUND: exitHours(k) >= (k - 1) x cycleHours on every input set here, k to POLICY_FAR — no policy past the horizon can win");
    const sets = [["samebuilder 19:27Z", fx("fixture-bn13-samebuilder-1927.json").inputs], ...OPTIONS.flatMap((o) => [-1.5, 0, 1.5].map((z) => [`L${o.L} z${z}`, P.applyDraw(o.x, { zCad: z, expMult: 1 })]))];
    const ks = [1, 2, 5, 10, 30, 100, 300, 700, 1500, 4000];
    const bad = [];
    for (const [name, x] of sets) {
      for (const k of ks) {
        const h = X.exitHours(x, k, true).hours;
        c.examined(1);
        if (fin(h) && h < (k - 1) * x.cycleHours) bad.push(`${name} k ${k}: ${h}h < ${(k - 1) * x.cycleHours}h`);
      }
    }
    c.note(`${sets.length} input sets x ${ks.length} install counts`);
    if (bad.length) c.fail("an exit below its own lives' hours: the horizon would cut off a winner", bad.slice(0, 4).join("\n"));
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("PS6", "CPU: the 21:03Z options' 240 searches price fewer policies a search than the capped search (28.5) and every step stays under 10ms");
    let n = 0;
    let pol = 0;
    let longest = 0;
    for (const o of OPTIONS) {
      for (const d of DRAWS) {
        const g = X.bestExitPolicyGen({ ...drawn(o.x, d), hackingExp: o.x.hackingExp + 1e-3 }, 400, 1); // past the memo
        let r;
        let t = performance.now();
        while (!(r = g.next()).done) {
          const t1 = performance.now();
          if (n > 0) longest = Math.max(longest, t1 - t);
          t = t1;
        }
        n++;
        pol += r.value.tried.length;
      }
    }
    c.examined(n);
    c.note(`${n} searches, ${(pol / n).toFixed(1)} policies a search (the capped search: 28.5), longest step ${longest.toFixed(1)}ms`);
    if (!(pol / n < 25)) c.fail(`${(pol / n).toFixed(1)} policies a search`);
    if (!(longest < 10)) c.warn(`a ${longest.toFixed(1)}ms step (the game's page runs it 2-4x slower against the ${P.PLAN.sliceMs}ms slice)`);
    checks.push(c);
  }

  return checks;
}
