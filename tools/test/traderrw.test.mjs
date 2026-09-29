// [RW] THE TRADER'S RETURN AS A FUNCTION OF ITS BOOK, r(W) (traderw.js).
//
// One pooled rate (bayes.traderPosterior, 0.38-0.53/h live BN9 2026-09-29)
// read a $1m book, a $3b one and a $194b one as noisy measurements of one
// number, and the exit compounded every book at it. The game says otherwise:
// below ~$2.2m the trader cannot pay its $100k commissions (stockstrat
// commissionCover) and never trades; maxShares and the forecast damage its
// own orders do cap what the market absorbs, so r W saturates at ~$2-5e11/h
// pre-4S. The prior is the shipped strategy on the game's own market
// (tools/sim/stocks/rw.mjs), the posterior updates its level r0 and knee W*
// from the ledger (bayes.traderRwPosterior), and every money leg integrates
// dW/dt = r(W) W + income.
//
//   RW1  THE PRIOR IS THE SIM: RW_PRIOR's curve against every simulated bin
//        (rw-data/*.json, both regimes), rwfit.mjs re-fitting the committed
//        data reproduces the constants, and the curve is 0 below Wmin
//   RW2  THE POSTERIOR: no rows = the prior; a synthetic ledger drawn from a
//        known curve with the sim's noise is recovered; the recorded BN9
//        ledger (fixture-bn9-stockhist-rw.txt) is fitted, a life's first
//        hour does not move it, and a life's many intervals are not many lives
//   RW3  THE EXIT LEGS INTEGRATE r(W): hoursToMoney, moneyAfter, capitalAfter
//        and the marginal future value against a fine RK4 of the same ODE; a
//        flat input is exactly the old closed form; the plan's draws carry
//        W* and progress.js passes the curve into the exit inputs
//   RW4  CPU: the posterior on a full ledger in a few ms; the table's error;
//        the plan pass on the curve is guarded by planperf PP3c

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const T = await import("../../traderw.js");
const B = await import("../../bayes.js");
const P = await import("../../plan.js");
const X = await import("../../exitplan.js");
const C = await import("../../countexit.js");
const H = await import("../../hacknetplan.js");
const FIT = await import("../sim/stocks/rwfit.mjs");

const rowsOf = (f) =>
  fs
    .readFileSync(path.join(REPO_ROOT, f), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const PRE = T.RW_PRIOR["pre-long"];
const shapeFn = (pr) => (W, Ws) => T.rwShape(W, Ws, pr.shape);

/** A seeded normal. */
function rng(seed) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
}

/** A ledger of `lives` runs, each compounding from W0 on the curve (r0, W*) with the sim's noise, a row every 10 ticks. */
function synthLedger({ r0, Wstar, lives = 4, hours = 6, W0s = [1e9, 3e10, 2e11, 8e11], seed = 1, tauRel = 0.2 }) {
  const z = rng(seed);
  const rows = [];
  const sig = PRE.sigma;
  for (let l = 0; l < lives; l++) {
    const u = 1 + tauRel * z();
    let W = W0s[l % W0s.length];
    let pnl = 0;
    for (let t = 0; t <= hours * 600; t += 10) {
      rows.push({ t, wealth: W, lifePnl: pnl, externalFlows: 0 });
      const dtH = 10 * 6 / 3600;
      const s = sig.sigma0 * Math.pow(1 + Math.pow(W / sig.sWstar, sig.n), -1 / sig.n);
      const x = r0 * u * T.rwShape(W, Wstar, PRE.shape) + (s / Math.sqrt(dtH)) * z();
      const g = Math.exp(x * dtH);
      pnl += W * (g - 1);
      W *= g;
    }
  }
  return rows;
}

/** A fine RK4 of dW/dt = E(W) + f (the capital after `warm` hours), to the target: hours. */
function refHours(target, o) {
  const c = T.capitalOf(o);
  const f = o.flatPerSec || 0;
  let W = o.money0;
  let t = 0;
  const warm = (o.capitalWarmupH || 0) * 3600;
  if (warm > 0) {
    if (W + f * warm >= target) return (target - W) / f / 3600;
    W += f * warm;
    t = warm;
  }
  const E = (w) => T.capitalEarnAt(w, c) + f;
  for (let i = 0; i < 5e6 && W < target; i++) {
    const e1 = E(W);
    const dt = Math.min(Math.max(1, (1e-3 * W) / Math.max(e1, 1e-9)), 3600);
    const k2 = E(W + (e1 * dt) / 2);
    const k3 = E(W + (k2 * dt) / 2);
    const k4 = E(W + k3 * dt);
    const dW = ((e1 + 2 * k2 + 2 * k3 + k4) * dt) / 6;
    if (W + dW >= target) return (t + (dt * (target - W)) / dW) / 3600;
    W += dW;
    t += dt;
  }
  return Infinity;
}
function refAfter(W0, hours, o) {
  const c = T.capitalOf(o);
  const f = o.flatPerSec || 0;
  const E = (w) => T.capitalEarnAt(w, c) + f;
  let W = W0;
  let t = 0;
  const Tm = hours * 3600;
  while (t < Tm) {
    const e1 = E(W);
    const dt = Math.min(Tm - t, Math.max(1, (1e-3 * W) / Math.max(e1, 1e-9)), 600);
    const k2 = E(W + (e1 * dt) / 2);
    const k3 = E(W + (k2 * dt) / 2);
    const k4 = E(W + k3 * dt);
    W += ((e1 + 2 * k2 + 2 * k3 + k4) * dt) / 6;
    t += dt;
  }
  return W;
}

export async function run() {
  const checks = [];

  // -------------------------------------------------------------------- RW1
  {
    const c = new Check("RW1", "THE PRIOR IS THE SIM: traderw.RW_PRIOR's r(W) against every simulated bin of the shipped trader on the game's market, both regimes; rwfit.mjs on the committed data reproduces the constants; 0 below the commission threshold");
    for (const regime of ["pre-long", "4S-long"]) {
      const pr = T.RW_PRIOR[regime];
      const rows = FIT.binsOf(regime);
      let worst = { d: 0 };
      for (const r of rows) {
        const m = pr.r0PerHour * T.rwShape(r.W, pr.Wstar, pr.shape);
        c.examined(1);
        if (r.W < pr.shape.Wmin * 0.9) {
          if (!(r.r < 0.02 && m === 0)) c.fail(`${regime} $${r.W.toExponential(2)}: below the commission threshold the trader is idle (sim ${r.r}) and the curve must be 0 (${m})`);
          continue;
        }
        if (r.n < 80) continue;
        // |error| within 0.05/h or 35% (the tail's rates are ~0.01/h).
        const d = Math.abs(m - r.r);
        if (d > worst.d) worst = { d, W: r.W, sim: r.r, m };
        if (!(d <= 0.05 || d <= 0.35 * r.r)) c.fail(`${regime} $${r.W.toExponential(2)}: curve ${m.toFixed(3)}/h vs sim ${r.r.toFixed(3)}/h (n ${r.n})`);
      }
      c.note(`${regime}: r0 ${pr.r0PerHour}/h, W* $${pr.Wstar.toExponential(2)}, Wmin $${pr.shape.Wmin.toExponential(2)}; worst bin $${worst.W?.toExponential(2)} curve ${worst.m?.toFixed(3)} vs sim ${worst.sim?.toFixed(3)}/h; ${T.rwTable(pr.r0PerHour / 3600, pr.Wstar, pr.shape, [1e6, 1e9, 1e11, 1e13]).map((x) => `$${x.W.toExponential(0)} ${x.perHour}`).join(", ")}`);
      const f = FIT.fit(regime);
      c.note(`${regime} re-fit: r0 ${f.r0.toFixed(4)} W* ${f.Wstar.toExponential(3)} n ${f.shape.n.toFixed(2)} hLo ${f.shape.hLo.toFixed(3)} (tauRel ${f.tauRel?.toFixed(3)})`);
      if (!(Math.abs(f.r0 / pr.r0PerHour - 1) < 0.02 && Math.abs(Math.log(f.Wstar / pr.Wstar)) < 0.1 && Math.abs(f.shape.Wmin / pr.shape.Wmin - 1) < 0.05)) c.fail(`${regime}: RW_PRIOR is not the fit of the committed sim data (re-run tools/sim/stocks/rwfit.mjs)`);
    }
    // Saturation: pre-4S E(W) = r W levels off at $1e11-1e12/h.
    const E = (W) => PRE.r0PerHour * T.rwShape(W, PRE.Wstar, PRE.shape) * W;
    c.note(`pre-4S E(W): $1e11 ${E(1e11).toExponential(2)}/h, $1e12 ${E(1e12).toExponential(2)}/h, $1e13 ${E(1e13).toExponential(2)}/h, $1e14 ${E(1e14).toExponential(2)}/h (r0 W* ${(PRE.r0PerHour * PRE.Wstar).toExponential(2)})`);
    if (!(E(1e14) < 2 * E(1e12) && E(1e14) <= PRE.r0PerHour * PRE.Wstar * 1.0001)) c.fail("the market's capacity: E(W) must saturate at r0 W*");
    checks.push(c);
  }

  // -------------------------------------------------------------------- RW2
  {
    const c = new Check("RW2", "THE POSTERIOR ON r0 AND W*: no rows is the prior; a synthetic ledger is recovered; the recorded BN9 ledger is fitted; a life's first hour and a life's many intervals are handled");
    const opts = { prior: PRE, shape: shapeFn(PRE) };
    const p0 = B.traderRwPosterior([], opts);
    c.examined(1);
    if (!(p0 && p0.source === "prior" && Math.abs(p0.perHour.mean / (PRE.r0PerHour * Math.exp((PRE.sdLnR0 ** 2) / 2)) - 1) < 0.03 && Math.abs(p0.lnWstar.mean - Math.log(PRE.Wstar)) < 0.02)) c.fail(`no rows: the posterior must be the prior (r0 ${p0?.perHour.mean} vs ${PRE.r0PerHour}, W* ${p0?.Wstar})`);
    if (B.traderRwPosterior([], { shape: shapeFn(PRE) }) !== null) c.fail("no prior: null, not a guess");
    // Synthetic recovery over seeds: truth inside the posterior's +-2.5 sd.
    let hits = 0;
    const truths = [{ r0: 0.5, Wstar: 1e12 }, { r0: 0.9, Wstar: 1.5e11 }, { r0: 0.7, Wstar: 4e11 }];
    for (const [k, tr] of truths.entries()) {
      for (let seed = 1; seed <= 3; seed++) {
        const p = B.traderRwPosterior(synthLedger({ ...tr, seed: seed * 7 + k }), opts);
        c.examined(1);
        const okR = Math.abs(p.perHour.mean - tr.r0) <= 2.5 * p.perHour.sd;
        const okW = Math.abs(p.lnWstar.mean - Math.log(tr.Wstar)) <= 2.5 * p.lnWstar.sd;
        if (okR && okW) hits++;
        if (seed === 1) c.note(`synthetic r0 ${tr.r0} W* ${tr.Wstar.toExponential(1)}: posterior r0 ${p.perHour.mean.toFixed(3)} +- ${p.perHour.sd.toFixed(3)}, W* ${p.Wstar.toExponential(2)} x/÷ ${Math.exp(p.lnWstar.sd).toFixed(2)} (kappa^2 ${p.kappa2})`);
      }
    }
    if (hits < 8) c.fail(`the posterior must cover the truth (+-2.5 sd) on >= 8 of 9 synthetic ledgers: ${hits}`);
    // The recorded ledger (BN9 2026-09-28/29: three lives, $3e8-$1e12 books).
    const rows = rowsOf("tools/test/fixture-bn9-stockhist-rw.txt");
    const p = B.traderRwPosterior(rows, opts);
    c.examined(rows.length);
    c.note(`recorded: ${p.why}`);
    c.note(`r(W): ${p.table.map((x) => `$${x.W.toExponential(0)} ${x.mean}+-${x.sd}`).join(", ")}`);
    if (!(p.source === "posterior" && p.lives >= 2 && p.points > 300)) c.fail(`the recorded ledger must be fitted (lives ${p.lives}, points ${p.points})`);
    if (!(p.perHour.sd < PRE.r0PerHour * PRE.sdLnR0)) c.fail("the ledger must narrow the level");
    const at = (W) => p.table.find((x) => x.W === W).mean;
    if (!(at(1e6) === 0 && at(1e11) > 0.4 && at(1e11) < 1 && at(1e13) < 0.2 * at(1e11))) c.fail(`r(W) must be 0 at $1m, the plateau at $1e11, and saturated by $1e13: ${at(1e6)}, ${at(1e11)}, ${at(1e13)}`);
    // A life's first hour is not the curve's (the sim drops it): the young
    // life's 16:18-16:30Z rows at 1.7/h do not move the posterior.
    const pre = B.traderRwPosterior(rows.filter((r) => r.at < "2026-09-29T16:18"), opts);
    const post = B.traderRwPosterior(rows.filter((r) => r.at < "2026-09-29T16:45"), opts);
    c.note(`first hour of the 16:18Z life: r0 ${pre.perHour.mean.toFixed(4)} before, ${post.perHour.mean.toFixed(4)} after`);
    if (Math.abs(pre.perHour.mean - post.perHour.mean) > 1e-9) c.fail("a life's first hour must not move the curve");
    // Many intervals of ONE life are one life: its sd is not sd_x / sqrt(n).
    const one = B.traderRwPosterior(synthLedger({ r0: 0.7, Wstar: 4e11, lives: 1, hours: 24, W0s: [1e9], seed: 3 }), opts);
    c.note(`one life, 24h: r0 sd ${one.perHour.sd.toFixed(3)}/h (tauRel ${PRE.tauRel} of the level carries the life's own scatter)`);
    if (!(one.perHour.sd > 0.5 * PRE.tauRel * one.perHour.mean)) c.fail(`one life's intervals must not pin the node's level: sd ${one.perHour.sd}`);
    // THE LEDGER (bayes.rwLedgerOf, progress.js /tel/stock-rw.txt): folded in
    // pass by pass from overlapping 360-row windows it equals the one-shot
    // fold, and keeps the rows that scrolled out of the window.
    {
      let led = null;
      for (let end = 360; end <= rows.length; end += 37) led = B.rwLedgerOf(led, rows.slice(Math.max(0, end - 360), end), { priors: T.RW_PRIOR });
      led = B.rwLedgerOf(led, rows.slice(-360), { priors: T.RW_PRIOR });
      const inc = B.traderRwPosterior(rows.slice(-360), { ...opts, ledger: JSON.parse(JSON.stringify(led)) });
      const win = B.traderRwPosterior(rows.slice(-360), opts);
      c.examined(1);
      c.note(`ledger: windows folded pass by pass r0 ${inc.perHour.mean.toFixed(4)} W* ${inc.Wstar.toExponential(3)} (${inc.points} intervals) vs one-shot ${p.perHour.mean.toFixed(4)} ${p.Wstar.toExponential(3)} (${p.points}); the last window alone ${win.perHour.mean.toFixed(4)} ${win.Wstar.toExponential(3)} (${win.points})`);
      if (!(inc.points === p.points && Math.abs(inc.perHour.mean - p.perHour.mean) < 1e-9 && Math.abs(inc.Wstar / p.Wstar - 1) < 1e-9)) c.fail("folding overlapping windows must equal the one-shot fold (no double count, nothing lost)");
    }
    // The belief (plan.traderBeliefOf): its point is the posterior's means, its draws the same distribution.
    const b = P.traderBeliefOf(rows);
    c.examined(1);
    if (!(b.r === p.perSec.mean && Math.abs(b.Wstar - p.Wstar) < 1 && b.shape === PRE.shape)) c.fail("traderBeliefOf's point must be the curve posterior's means");
    const four = P.traderBeliefOf(rows, { regime: "4S-long" });
    if (!(four.source === "prior" && four.regime === "4S-long")) c.fail(`4S: no row of the 4S regime (s4) — its prior, not the pre-4S rows: ${four.source}`);
    checks.push(c);
  }

  // -------------------------------------------------------------------- RW3
  {
    const c = new Check("RW3", "THE EXIT LEGS INTEGRATE dW/dt = r(W) W + income: hoursToMoney, moneyAfter, capitalAfter and the marginal future value against a fine RK4; flat inputs are the old closed forms; the draws carry W*; progress.js passes the curve");
    let worst = { e: 0 };
    let worst0 = 0;
    let n = 0;
    for (const m0 of [1e6, 3e7, 1e9, 1e11, 2e12]) {
      for (const tgt of [1e9, 1e11, 1e12, 1e13, 7.5e13]) {
        if (tgt <= m0) continue;
        for (const f of [0, 4e4, 1e7]) {
          if (f === 0 && m0 < PRE.shape.Wmin) continue;
          for (const ws of [0.3, 1, 3]) {
            for (const cap of [Infinity, 5.4e12]) {
              for (const warm of [0, 0.5]) {
                const o = { money0: m0, incomeAtLevel1: 0, mult: 1, exp0: 0, expPerSec: 0, flatPerSec: f, capitalReturnPerSec: PRE.r0PerHour / 3600, capitalScaleW: PRE.Wstar * ws, capitalShape: PRE.shape, capitalCap: cap, capitalWarmupH: warm, maxHours: 1e5 };
                const h = X.hoursToMoney(tgt, o);
                const r = refHours(tgt, o);
                const e = Math.abs(h / r - 1);
                n++;
                if (f === 0) worst0 = Math.max(worst0, e);
                if (e > worst.e) worst = { e, m0, tgt, f, ws, cap, warm, h, r };
              }
            }
          }
        }
      }
    }
    c.examined(n);
    c.note(`hoursToMoney vs RK4 over ${n} legs ($1m-$2t -> $1b-$75t, income 0/4e4/1e7 per s, W* x0.3-3, cap, warm-up): worst ${(100 * worst.e).toFixed(2)}% ($${worst.m0?.toExponential(0)} -> $${worst.tgt?.toExponential(1)}, income ${worst.f}: ${worst.h?.toFixed(3)}h vs ${worst.r?.toFixed(3)}h); capital alone worst ${(100 * worst0).toFixed(2)}%`);
    if (!(worst.e < 0.025)) c.fail(`a money leg on the curve must be within 2.5% of the ODE (the flat rate's own splitting error is 1.7%): ${(100 * worst.e).toFixed(2)}%`);
    if (!(worst0 < 0.006)) c.fail(`the capital alone must be within 0.6%: ${(100 * worst0).toFixed(2)}%`);
    // moneyAfter (count phase), capitalAfter (trajectory.incomeModel).
    let wA = 0;
    for (const m0 of [1e6, 1e9, 1e11, 3e12]) {
      for (const hrs of [0.5, 4, 40]) {
        for (const f of [0, 4e4]) {
          const o = { capitalReturnPerSec: PRE.r0PerHour / 3600, capitalScaleW: PRE.Wstar, capitalShape: PRE.shape, capitalCap: 5.4e12, flatPerSec: f };
          const ref = refAfter(m0, hrs, o);
          const e1 = Math.abs(C.moneyAfter(m0, hrs, o) / ref - 1);
          const e2 = f === 0 ? Math.abs(T.capitalAfter(m0, hrs * 3600, o) / ref - 1) : 0;
          wA = Math.max(wA, e1, e2);
          c.examined(1);
        }
      }
    }
    c.note(`moneyAfter / capitalAfter vs RK4: worst ${(100 * wA).toFixed(2)}%`);
    if (!(wA < 0.01)) c.fail(`moneyAfter/capitalAfter must be within 1%: ${(100 * wA).toFixed(2)}%`);
    // The marginal future value: lump = dW_T/dW_0 along the book's path.
    {
      const o = { capitalReturnPerSec: PRE.r0PerHour / 3600, capitalScaleW: PRE.Wstar, capitalShape: PRE.shape, capitalCap: 5.4e12 };
      let wF = 0;
      for (const m0 of [1e9, 1e11, 1e12]) {
        for (const hrs of [2, 20]) {
          const fv = H.capitalFV({ ...o, money: m0, capitalWarmupH: 0 }, hrs);
          const dm = m0 * 1e-3;
          const lumpFd = (refAfter(m0 + dm, hrs, o) - refAfter(m0, hrs, o)) / dm;
          wF = Math.max(wF, Math.abs(fv.lump / lumpFd - 1));
          c.examined(1);
        }
      }
      c.note(`capitalFV lump vs the ODE's dW_T/dW_0: worst ${(100 * wF).toFixed(2)}% (a marginal dollar on a saturating book earns less than the average one)`);
      if (!(wF < 0.02)) c.fail(`the marginal future value must follow the ODE within 2%: ${(100 * wF).toFixed(2)}%`);
    }
    // Flat inputs: exactly the old closed forms.
    {
      const r = 0.5 / 3600;
      const o = { money0: 1e9, incomeAtLevel1: 0, mult: 1, exp0: 0, expPerSec: 0, flatPerSec: 0, capitalReturnPerSec: r, maxHours: 1e5 };
      const h = X.hoursToMoney(1e11, o);
      const exact = Math.log(100) / 0.5;
      c.note(`flat: hoursToMoney $1b -> $100b at 0.5/h ${h.toFixed(6)}h vs ln(100)/r ${exact.toFixed(6)}h; moneyAfter ${C.moneyAfter(1e9, 3, { capitalReturnPerSec: r }).toExponential(6)} vs ${(1e9 * Math.exp(1.5)).toExponential(6)}`);
      if (!(Math.abs(h - exact) < 1e-3 && Math.abs(C.moneyAfter(1e9, 3, { capitalReturnPerSec: r }) / (1e9 * Math.exp(1.5)) - 1) < 1e-12)) c.fail("a flat rate (no capitalScaleW / capitalShape) must price exactly as before");
      if (T.isShaped({ capitalReturnPerSec: r, capitalCap: 1e12 })) c.fail("isShaped must be false without the curve's fields");
    }
    // The plan's draws: W* drawn (correlated with r0), applied only where the inputs carry the curve.
    {
      const rows = rowsOf("tools/test/fixture-bn9-stockhist-rw.txt");
      const b = P.traderBeliefOf(rows);
      const post = { drift: { s: 0.1, nu: 4, a: 2, b: 0.02 }, gymSdLn: 0.1, cadence: null, expPost: null, income: null, trader: b.post };
      const D = P.makeDraws(post, 400, 11);
      const lw = D.map((d) => Math.log(d.Wstar));
      const m = lw.reduce((a, x) => a + x, 0) / lw.length;
      const sd = Math.sqrt(lw.reduce((a, x) => a + (x - m) ** 2, 0) / lw.length);
      c.examined(D.length);
      c.note(`draws: ln W* mean ${m.toFixed(3)} (posterior ${b.post.lnWstar.mean.toFixed(3)}), sd ${sd.toFixed(3)} (${b.post.lnWstar.sd.toFixed(3)})`);
      if (!(Math.abs(m - b.post.lnWstar.mean) < 0.1 && Math.abs(sd / b.post.lnWstar.sd - 1) < 0.15)) c.fail("the draws' W* must be the posterior's");
      const curve = { capitalReturnPerSec: b.r, capitalScaleW: b.Wstar, capitalShape: b.shape };
      if (!(P.applyDraw(curve, D[0]).capitalScaleW === D[0].Wstar)) c.fail("applyDraw must set the drawn knee on curve inputs");
      if ("capitalScaleW" in P.applyDraw({ capitalReturnPerSec: b.r }, D[0])) c.fail("applyDraw must leave a flat input flat");
      // A move of the knee (or the curve's first appearance) re-decides, as a move of the level does.
      const cur = { lastAugReset: 1, now: Date.now(), trader: b.post };
      const prevP = { lastAugReset: 1, decidedAt: new Date().toISOString(), posteriors: { trader: { mean: b.post.perSec.mean, sd: b.post.perSec.sd } } };
      const e1 = P.redecideEvents(prevP, cur);
      const e2 = P.redecideEvents({ ...prevP, posteriors: { trader: { mean: b.post.perSec.mean, sd: b.post.perSec.sd, Wstar: b.Wstar * 5, lnWstarSd: b.post.lnWstar.sd } } }, cur);
      const e3 = P.redecideEvents({ ...prevP, posteriors: { trader: { mean: b.post.perSec.mean, sd: b.post.perSec.sd, Wstar: b.Wstar, lnWstarSd: b.post.lnWstar.sd } } }, cur);
      c.note(`redecide: no knee before -> ${JSON.stringify(e1)}; knee x5 -> ${JSON.stringify(e2)}; same -> ${JSON.stringify(e3)}`);
      if (!(e1.some((x) => /curve appeared/.test(x)) && e2.some((x) => /knee W\* moved/.test(x)) && e3.length === 0)) c.fail("the knee's move (or the curve's appearance) must be a re-decide event, and no move none");
    }
    // progress.js passes the curve from the same belief (source guard).
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    for (const [re, what] of [
      [/capitalScaleW: traderBeliefNow\(ns, info\)\?\.Wstar \?\? null/, "exit inputs: capitalScaleW from traderBeliefNow"],
      [/capitalShape: traderBeliefNow\(ns, info\)\?\.shape \?\? null/, "exit inputs: capitalShape from traderBeliefNow"],
            [/traderBeliefOf\(rows, \{ regime: rwRegimeOf\(stockNow\?\.mode\), ledger \}\)/, "traderBeliefNow: the regime from the trader's mode, the persistent ledger"],
      [/rwLedgerOf\(prev, rows, \{ priors: RW_PRIOR/, "stockRwLedgerNow folds the rows into /tel/stock-rw.txt"],
    ]) {
      c.examined(1);
      if (!re.test(prog)) c.fail(`progress.js: ${what}`);
    }
    // Every consumer of the capital term takes the curve.
    for (const [f, re] of [
      ["exitplan.js", /capitalScaleW, capitalShape, targetAt/],
      ["hacknet.js", /capitalScaleW: x\.capitalScaleW/],
      ["lifeplan.js", /capitalScaleW: inputs\.capitalScaleW/],
      ["trajectory.js", /isShaped\(o\)\) return capitalAfter/],
      ["hacknetplan.js", /isShaped\(capital\)\) return capitalMarginalFV/],
      ["countexit.js", /isShaped\(o\)/],
    ]) {
      c.examined(1);
      if (!re.test(fs.readFileSync(path.join(REPO_ROOT, f), "utf8"))) c.fail(`${f} must price the trader on the curve (${re})`);
    }
    checks.push(c);
  }

  // -------------------------------------------------------------------- RW4
  {
    const c = new Check("RW4", "CPU: the curve posterior on a full ledger in a few ms (once per pass); the s(W) table's error < 0.1%; the plan pass on the curve is planperf PP3c");
    const rows = rowsOf("tools/test/fixture-bn9-stockhist-rw.txt");
    B.traderRwPosterior(rows, { prior: PRE, shape: shapeFn(PRE) });
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) P.traderBeliefOf(rows);
    const ms = (performance.now() - t0) / 5;
    c.examined(rows.length);
    c.note(`traderBeliefOf on ${rows.length} rows: ${ms.toFixed(1)}ms`);
    if (!(ms < 40)) c.fail(`the belief must cost < 40ms a pass: ${ms.toFixed(1)}ms`);
    const cc = T.capitalOf({ capitalReturnPerSec: PRE.r0PerHour / 3600, capitalScaleW: PRE.Wstar, capitalShape: PRE.shape });
    let w = 0;
    for (let lw = Math.log10(PRE.shape.Wmin) + 0.01; lw < 16.9; lw += 0.0137) {
      const W = 10 ** lw;
      w = Math.max(w, Math.abs(T.capitalRateAt(W, cc) / ((PRE.r0PerHour / 3600) * T.rwShape(W, PRE.Wstar, PRE.shape)) - 1));
      c.examined(1);
    }
    c.note(`table vs formula: worst ${(100 * w).toFixed(3)}%`);
    if (!(w < 1e-3)) c.fail(`the s(W) table must be within 0.1% of the formula: ${(100 * w).toFixed(3)}%`);
    const pp = fs.readFileSync(path.join(REPO_ROOT, "tools/test/planperf.test.mjs"), "utf8");
    if (!/\["PP3c", CURVE_BELIEF\]/.test(pp)) c.fail("planperf must replay the plan pass on the curve (PP3c)");
    checks.push(c);
  }

  return checks;
}
