// tools/sim/gameplan — learning as we play (pure: no game bundle, no telemetry).
//
//   GP6 THE g MODEL WITH COVARIATES (gmodel.mjs): a synthetic population with a
//       known beta and tau is recovered; leave-one-out prefers the covariate
//       model when the covariate drives g and does not reward it when it does
//       not; the hand latent's LOO path reproduces economy.mjs's formula; the
//       posterior's joint draws carry the model's correlation, and a reading of
//       one node moves a correlated node by the hierarchy's share of the surprise.
//   GP7 KG, THE BOUND, THE TAILS, MULTI-FIDELITY (adaptive.mjs, discrepancy.mjs):
//       on a synthetic lattice whose best continuation after A turns on node B's
//       parameter, the knowledge gradient of playing A is positive when A's reading
//       is correlated with B's and ~0 when it is not (the correlation is what
//       propagates); every draw's perfect-information optimum is <= the open-loop
//       policy's held-out total, and equal to it when there is no uncertainty;
//       CVaR(0.9) on known distributions; the multi-fidelity estimator with a fixed
//       coefficient is unbiased and recovers a known surrogate bias; the discrepancy
//       sd is recovered from synthetic residuals.
//
// CALIBRATION: none of these is a game quantity — they test the estimators'
// properties on synthetic inputs whose answer is known. The models' calibration
// state is in tools/sim/gameplan/{gmodel,discrepancy,adaptive}.mjs headers.

import { Check } from './harness.mjs'
import { makeState, lattice } from '../sim/gameplan/state.mjs'
import { buildTable, solveDP } from '../sim/gameplan/search.mjs'
import { rng, normal, drawZ, worldOf } from '../sim/gameplan/params.mjs'
import { fitBLR, betaSummary, looCompare, handLatent, gJointOf, predictJoint } from '../sim/gameplan/gmodel.mjs'
import { posteriorOf, emptyStore } from '../sim/gameplan/posterior.mjs'
import { cvar, infoRelaxation, foldsOf, openLoop, kgOfMove, mfmc } from '../sim/gameplan/adaptive.mjs'
import { fitDiscrepancy, lnHoursMoments } from '../sim/gameplan/discrepancy.mjs'

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const sd = (xs) => Math.sqrt(xs.reduce((a, x) => a + (x - mean(xs)) ** 2, 0) / (xs.length - 1))

/** A synthetic BitNode table: node n's multipliers, AMC varying, the rest drawn once (seeded). */
function synthMults(seed = 3) {
  const r = rng(seed)
  const t = new Map()
  for (let n = 1; n <= 14; n++)
    t.set(n, {
      AugmentationMoneyCost: [1, 1, 3, 1, 2, 1, 3, 1, 1, 5, 2, 1, 1, 1.5][n - 1],
      ScriptHackMoney: Math.exp(-1.2 * r()),
      ServerMaxMoney: Math.exp(-2 * r()),
      ScriptHackMoneyGain: 1,
      HackingLevelMultiplier: Math.exp(-r()),
      WorldDaemonDifficulty: 1 + 4 * r(),
    })
  return (n) => t.get(n)
}

function gp6() {
  const c = new Check('GP6', 'the g model with covariates: synthetic beta recovered, LOO picks the covariate model only when it helps, the hand latent reproduced, joint draws correlated, a reading propagates')
  // (1) recover beta and tau from a synthetic population (40 nodes, 2 covariates)
  {
    const r = rng(11)
    const beta = [-2.9, 0.35, -0.25]
    const tau = 0.2
    const data = Array.from({ length: 40 }, () => {
      const x = [1, normal(r), normal(r)]
      const lg = beta.reduce((a, b, i) => a + b * x[i], 0) + tau * normal(r)
      return { x, y: lg + 0.15 * normal(r), sd: 0.15 }
    })
    const b = betaSummary(fitBLR(data, { p: 3 }))
    c.examined(4)
    beta.forEach((t, i) => {
      const z = (b.mean[i] - t) / b.sd[i]
      if (Math.abs(z) > 3) c.fail(`beta_${i}: posterior ${b.mean[i].toFixed(3)} +- ${b.sd[i].toFixed(3)} vs truth ${t} (${z.toFixed(1)} sd)`)
    })
    if (Math.abs(b.tauMean - tau) > 3 * b.tauSd + 0.02) c.fail(`tau: posterior ${b.tauMean.toFixed(3)} +- ${b.tauSd.toFixed(3)} vs truth ${tau}`)
    c.note(`recover: 40 synthetic nodes, truth beta ${beta.join(', ')} tau ${tau} -> ${b.mean.map((x, i) => `${x.toFixed(3)}+-${b.sd[i].toFixed(3)}`).join(', ')}, tau ${b.tauMean.toFixed(3)}+-${b.tauSd.toFixed(3)}`)
  }
  const mo = synthMults()
  // (2) LOO: g driven by AMC (strongly) -> a covariate model beats the exchangeable one; g with no covariate effect -> no reward
  {
    const r = rng(21)
    const nodes = [1, 2, 3, 4, 5, 7, 9, 10, 11, 14]
    const drive = nodes.map((bn) => ({ bn, g: Math.exp(-2.8 - 0.8 * Math.log(mo(bn).AugmentationMoneyCost) + 0.08 * normal(r)) }))
    const flat = nodes.map((bn) => ({ bn, g: Math.exp(-2.8 + 0.3 * normal(r)) }))
    const L1 = looCompare(drive, mo)
    const L0 = looCompare(flat, mo)
    c.examined(2)
    const covBest = Math.max(L1.models.amc.elpd, L1.models.full.elpd)
    if (!(covBest > L1.models.exch.elpd + 1)) c.fail(`LOO with g driven by AMC: covariate elpd ${covBest.toFixed(2)} not above exchangeable ${L1.models.exch.elpd.toFixed(2)} + 1`)
    if (!(L0.models.full.elpd < L0.models.exch.elpd + 1)) c.fail(`LOO with no covariate effect: full ${L0.models.full.elpd.toFixed(2)} rewarded over exchangeable ${L0.models.exch.elpd.toFixed(2)} by > 1`)
    c.note(`LOO, g driven by ln AMC (10 nodes): exch ${L1.models.exch.elpd.toFixed(2)} amc ${L1.models.amc.elpd.toFixed(2)} full ${L1.models.full.elpd.toFixed(2)} -> ${L1.best}; no covariate effect: exch ${L0.models.exch.elpd.toFixed(2)} amc ${L0.models.amc.elpd.toFixed(2)} full ${L0.models.full.elpd.toFixed(2)} -> ${L0.best}`)
  }
  // (3) the hand latent as LOO sees it is economy.mjs's formula: gamma from the AMC != 1 runs, lo/mid/hi min/gm/max
  {
    const runs = [{ bn: 1, g: 0.05 }, { bn: 2, g: 0.1 }, { bn: 10, g: 0.03 }]
    const h = handLatent(runs, (n) => mo(n).AugmentationMoneyCost)
    const gm1 = Math.sqrt(0.05 * 0.1)
    const gamma = Math.log(gm1 / 0.03) / Math.log(5)
    const norms = runs.map((x) => x.g * Math.pow(mo(x.bn).AugmentationMoneyCost, gamma))
    c.examined(1)
    if (Math.abs(h.gamma - gamma) > 1e-12 || Math.abs(h.lo - Math.min(...norms)) > 1e-12 || Math.abs(h.hi - Math.max(...norms)) > 1e-12) c.fail(`handLatent: gamma ${h.gamma} vs ${gamma}`)
  }
  // (4) posterior + draws: the covariate model's joint draws reproduce its correlation; worldOf reads them back
  {
    const runs = [1, 2, 4, 8, 9, 10].map((bn, i) => ({ bn, g: [0.052, 0.138, 0.067, 0.04, 0.05, 0.035][i] }))
    const econ = { gScen: { lo: 0.04, mid: 0.063, hi: 0.138 }, gamma: 0.37, amc: Object.fromEntries([...Array(14)].map((_, i) => [i + 1, mo(i + 1).AugmentationMoneyCost])), ownG: new Map(runs.map((x) => [x.bn, x.g])), profile: { cycleHours: 2 }, runs }
    const post = posteriorOf(emptyStore(), econ, { gModel: 'full', multsOf: mo })
    const J = post.applied.gJoint
    c.examined(1)
    if (!J || post.gReg.chosen !== 'full') {
      c.fail('posteriorOf(gModel full) did not hand the draws a joint model')
      return c
    }
    const [a, b] = [J.nodes[0], J.nodes[1]]
    const r = rng(9)
    const xs = []
    const ys = []
    const ws = []
    for (let i = 0; i < 20000; i++) {
      const z = drawZ(r, J.nodes, post.applied)
      xs.push(J.mean.get(a) + J.sd.get(a) * z[`g${a}`])
      ys.push(J.mean.get(b) + J.sd.get(b) * z[`g${b}`])
      if (i < 5) ws.push(Math.abs(Math.log(worldOf(post.applied, z).g(a)) - xs[i]))
    }
    const corr = mean(xs.map((x, i) => (x - mean(xs)) * (ys[i] - mean(ys)))) / (sd(xs) * sd(ys))
    const model = J.cov[0][1] / Math.sqrt(J.cov[0][0] * J.cov[1][1])
    c.examined(2)
    if (Math.abs(corr - model) > 0.04) c.fail(`joint draws: corr(ln g${a}, ln g${b}) ${corr.toFixed(3)} vs the model's ${model.toFixed(3)}`)
    if (Math.abs(mean(xs) - J.mean.get(a)) > (4 * J.sd.get(a)) / Math.sqrt(xs.length) || Math.abs(sd(xs) / J.sd.get(a) - 1) > 0.05) c.fail(`joint draws: ln g${a} mean ${mean(xs).toFixed(3)} sd ${sd(xs).toFixed(3)} vs ${J.mean.get(a).toFixed(3)} / ${J.sd.get(a).toFixed(3)}`)
    if (Math.max(...ws) > 1e-9) c.fail(`worldOf does not read the joint draw back: |ln g - draw| ${Math.max(...ws)}`)
    c.note(`joint draws (20000): corr(BN${a}, BN${b}) ${corr.toFixed(3)} vs model ${model.toFixed(3)}; worldOf reproduces each draw's ln g`)
    // (5) propagation: a reading of node a that is +0.6 above its mean moves node b by ~ cov/var x the surprise (mixture over tau: approximate)
    const data = runs.map((x) => ({ bn: x.bn, y: Math.log(x.g), sd: 0.15 }))
    const J0 = gJointOf('full', data, [a, b], mo)
    const surprise = 0.6
    const J1 = gJointOf('full', [...data, { bn: a, y: J0.mean.get(a) + surprise, sd: 0.15 }], [b], mo)
    const moved = J1.mean.get(b) - J0.mean.get(b)
    const linear = (J0.cov[0][1] / (J0.cov[0][0] + 0.15 ** 2)) * surprise
    c.examined(1)
    if (!(Math.sign(moved) === Math.sign(linear) && Math.abs(moved - linear) < 0.5 * Math.abs(linear) + 0.01)) c.fail(`propagation: a +${surprise} reading of BN${a} moved BN${b} by ${moved.toFixed(4)}, the Gaussian share predicts ${linear.toFixed(4)}`)
    c.note(`propagation: BN${a} read +${surprise} -> BN${b} ${moved >= 0 ? '+' : ''}${moved.toFixed(4)} in ln g (linear-Gaussian share ${linear.toFixed(4)})`)
  }
  return c
}

/**
 * A synthetic lattice of three owed clears (nodes 1 = A, 2 = B, 3 = C): after A
 * the order B,C costs 20 + 5 zB and C,B costs 20 — the best continuation turns
 * on zB's sign. Per draw: zA, zB with correlation rho; tables built per draw.
 */
function synthKG(rho, N, seed, noUncertainty = false) {
  const pairs = []
  for (let n = 1; n <= 14; n++) pairs.push([n, n === 12 ? 1 : 3])
  pairs[0][1] = 2
  pairs[1][1] = 2
  pairs[2][1] = 2
  const start = makeState(pairs)
  const L = lattice(start)
  const r = rng(seed)
  const tabs = []
  const sig = []
  const star = []
  let T0 = null
  for (let i = 0; i < N; i++) {
    const zA = noUncertainty ? 0 : normal(r)
    const zB = noUncertainty ? 0.3 : rho * zA + Math.sqrt(1 - rho * rho) * normal(r)
    const jitter = noUncertainty ? 0 : normal(r)
    const clearFn = (n, lv) => (n === 1 ? 10 + jitter : n === 2 ? (lv(3) < 3 ? 10 + 5 * zB : 10) : 10)
    const T = buildTable(L, clearFn, () => true)
    T0 = T0 ?? T
    tabs.push(Float32Array.from(T.C))
    sig.push(zA)
    star.push(solveDP(L, T)[0])
  }
  return { L, T: T0, tabs, sig, star }
}

function gp7() {
  const c = new Check('GP7', 'learning: KG propagates through correlation, the information-relaxation bound holds (and is tight with no uncertainty), CVaR exact, multi-fidelity unbiased, discrepancy recovered')
  // (1) KG: correlated reading -> positive; uncorrelated -> ~0
  {
    const N = 400
    const hi = synthKG(0.9, N, 5)
    const lo = synthKG(0, N, 6)
    const kHi = kgOfMove(hi.L, hi.T, hi.tabs, hi.sig, 1, { bins: 5 })
    const kLo = kgOfMove(lo.L, lo.T, lo.tabs, lo.sig, 1, { bins: 5 })
    // with a perfect reading of zB the saving is 5 E[zB-] = 5 x 0.399; through rho 0.9 and 5 bins, a bit less
    c.examined(2)
    if (!(kHi.kg > 1 && kHi.kg > 3 * kHi.se)) c.fail(`KG with rho 0.9: ${kHi.kg.toFixed(3)} +- ${kHi.se.toFixed(3)} (want > 1 and > 3 s.e.)`)
    if (!(Math.abs(kLo.kg) < 0.25)) c.fail(`KG with rho 0: ${kLo.kg.toFixed(3)} +- ${kLo.se.toFixed(3)} (want ~0)`)
    c.note(`KG of playing A when the continuation turns on B (perfect-information value 5 x 0.399 = 2.00h): rho(A,B) 0.9 -> ${kHi.kg.toFixed(3)} +- ${kHi.se.toFixed(3)}h; rho 0 -> ${kLo.kg.toFixed(3)} +- ${kLo.se.toFixed(3)}h`)
    // ungated slopes on the uncorrelated case: the noise the gate exists to stop
    const kNo = kgOfMove(lo.L, lo.T, lo.tabs, lo.sig, 1, { bins: 5, gate: 0 })
    c.note(`  the same uncorrelated case without the significance gate: ${kNo.kg.toFixed(3)} +- ${kNo.se.toFixed(3)}h`)
    // (2) the bound: every draw's PI optimum <= the open-loop held-out total; equal with no uncertainty
    const ol = openLoop(hi.L, hi.T, hi.tabs, [1, 2, 3])
    const ir = infoRelaxation(hi.star, ol.robust)
    c.examined(2)
    if (ir.violations || !(ir.gap >= 0)) c.fail(`bound: ${ir.violations} draws where the policy beat its draw's perfect-information optimum; gap ${ir.gap}`)
    const nu = synthKG(0, 40, 7, true)
    const ir0 = infoRelaxation(nu.star, openLoop(nu.L, nu.T, nu.tabs, [1, 2, 3]).robust)
    if (Math.abs(ir0.gap) > 1e-4) c.fail(`bound with no uncertainty: gap ${ir0.gap} (want 0)`)
    c.note(`information relaxation: synthetic (rho 0.9) bound ${ir.bound.toFixed(2)} <= open loop ${ir.policy.toFixed(2)} (gap ${ir.gap.toFixed(2)} +- ${ir.se.toFixed(2)}, 0 violations); no uncertainty: gap ${ir0.gap.toExponential(1)}`)
  }
  // (3) CVaR on known distributions
  {
    const u = Array.from({ length: 100 }, (_, i) => i + 1)
    const r = rng(4)
    const z = Array.from({ length: 200000 }, () => normal(r))
    const exact = Math.exp(-0.5 * 1.2815516 ** 2) / Math.sqrt(2 * Math.PI) / 0.1
    c.examined(3)
    if (Math.abs(cvar(u, 0.9) - 95.5) > 1e-9) c.fail(`CVaR.9 of 1..100: ${cvar(u, 0.9)} (want 95.5)`)
    if (Math.abs(cvar(z, 0.9) - exact) > 0.02) c.fail(`CVaR.9 of N(0,1): ${cvar(z, 0.9).toFixed(4)} (want ${exact.toFixed(4)})`)
    if (Math.abs(cvar([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 0.9) - (15 + 0.5 * 14) / 1.5) > 1e-9) c.fail('CVaR.9 with a fractional atom')
    c.note(`CVaR.9: 1..100 -> ${cvar(u, 0.9)}; N(0,1) (200k) -> ${cvar(z, 0.9).toFixed(4)} (exact ${exact.toFixed(4)})`)
  }
  // (4) multi-fidelity: fixed alpha -> unbiased; the surrogate bias recovered
  {
    const r = rng(8)
    const f = (x) => 100 + 20 * x + 3 * x * x
    const bias = -0.7
    const truth = 100 + 3 // E[f(Z)], Z ~ N(0,1)
    const est = []
    const bs = []
    for (let rep = 0; rep < 3000; rep++) {
      const xs = Array.from({ length: 60 }, () => normal(r))
      const lf = xs.map((x) => f(x) + bias + 0.5 * normal(r))
      const hf = xs.slice(0, 8).map(f)
      const m = mfmc(hf, lf.slice(0, 8), lf, { alpha: 1 })
      est.push(m.est)
      bs.push(m.bias)
    }
    const se = sd(est) / Math.sqrt(est.length)
    c.examined(2)
    if (Math.abs(mean(est) - truth) > 4 * se) c.fail(`MFMC (alpha 1): mean of 3000 estimates ${mean(est).toFixed(3)} vs E[HF] ${truth} (s.e. ${se.toFixed(3)})`)
    if (Math.abs(mean(bs) + bias) > 0.05) c.fail(`MFMC: surrogate bias estimate ${(-mean(bs)).toFixed(3)} vs ${bias}`)
    const one = mfmc([1, 2, 3, 4].map(f), [1, 2, 3, 4].map((x) => f(x) - 1), [1, 2, 3, 4, 5].map((x) => f(x) - 1))
    c.note(`MFMC: 3000 replications (K 8 of N 60, fixed alpha 1): mean ${mean(est).toFixed(3)} vs E[HF] ${truth} (+- ${se.toFixed(3)}); bias recovered ${(-mean(bs)).toFixed(3)} (truth ${bias}); variance vs HF alone x${(sd(est) ** 2 / (sd(Array.from({ length: 3000 }, () => mean(Array.from({ length: 8 }, () => f(normal(r)))))) ** 2)).toFixed(3)}; optimal alpha on an exact shift ${one.alpha.toFixed(3)}`)
  }
  // (5) discrepancy: residuals with a known excess sd are recovered; a calibrated predictive gives ~0
  {
    const r = rng(12)
    const mk = (s) => Array.from({ length: 400 }, () => ({ r: Math.sqrt(0.04 + s * s) * normal(r), v: 0.04 }))
    const d1 = fitDiscrepancy(mk(0.3))
    const d0 = fitDiscrepancy(mk(0))
    const m = lnHoursMoments((g) => 1 / g, Math.log(0.05), 0.3)
    c.examined(3)
    if (Math.abs(d1.mean - 0.3) > 0.05) c.fail(`discrepancy: sd 0.3 in the residuals -> posterior mean ${d1.mean.toFixed(3)}`)
    if (!(d0.mean < 0.06)) c.fail(`discrepancy: calibrated residuals -> posterior mean ${d0.mean.toFixed(3)} (want ~0)`)
    if (Math.abs(m.mean + Math.log(0.05)) > 1e-9 || Math.abs(m.var - 0.09) > 1e-9) c.fail(`Gauss-Hermite: ln(1/g) moments ${m.mean}, ${m.var}`)
    c.note(`discrepancy: 400 residuals with excess sd 0.3 -> ${d1.mean.toFixed(3)} (p10 ${d1.p10.toFixed(3)} p90 ${d1.p90.toFixed(3)}); calibrated -> ${d0.mean.toFixed(3)}`)
  }
  return c
}

export async function run() {
  return [gp6(), gp7()]
}
