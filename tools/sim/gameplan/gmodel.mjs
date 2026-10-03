// THE g MODEL WITH COVARIATES: a hierarchical prior on every node's latent
// growth g (economy.mjs) in which the node's KNOWN BitNode multipliers shift
// its mean, and leave-one-out over the played nodes decides whether that beats
// the exchangeable population.
//
// Pure (no game import): the multipliers come in as a function multsOf(n),
// the game's getBitNodeMultipliers in plan.mjs (BitNode/BitNode.tsx), a
// synthetic table in the tests.
//
// PRIOR ART: Hong, Kveton, Zaheer, Ghavamzadeh, AISTATS 2022 (hierarchical
// Thompson sampling: a shared hyper-prior, per-task parameters drawn around
// it); Wan et al. 2021 (metadata-based multi-task bandits: task metadata x_n
// regress the task mean, ln g_n = beta'x_n + v_n); Gelman 2006 (half-normal /
// half-Cauchy priors on a group-level sd when there are few groups).
//
// THE MODEL
//   y_r = ln g_r + e_r,      e_r ~ N(0, sd_r^2)      (sd 0.15 = OBS_SD.g: one run's replay noise)
//   ln g_n = beta' x_n + v_n, v_n ~ N(0, tau^2)       (every node, played or not)
//   beta_0 ~ N(ln 0.06, 1)                             (weak: the intercept is the population level)
//   beta_j ~ N(0, SB^2) on STANDARDISED features, SB = 0.3 — "shrink hard": with
//            6 played runs a coefficient must earn its keep against the data
//   tau ~ half-normal(TAU_SCALE = 0.5) (Gelman 2006; half-Cauchy as a check)
// beta is integrated out analytically given tau (Gaussian), tau on a grid —
// the posterior and every predictive are exact mixtures over the grid.
//
// THE FEATURES (x_n, standardised over BitNodes 1-14 — fixed by the game, not
// fitted): ln AugmentationMoneyCost (the incumbent's one covariate: economy.mjs
// normalises by AMC^gamma), ln(ScriptHackMoney x ServerMaxMoney x
// ScriptHackMoneyGain) (hackexit.freshInputs' own moneyFactor; BN8's is 0 —
// floored at MONEY_FLOOR, BN9's 0.001, "as hacking-poor as the poorest node":
// its money was the trader's), ln HackingLevelMultiplier, ln
// WorldDaemonDifficulty. NOT a feature: the route — every g reading is a
// hacking-route clear (routes.mjs chooses the route per clear, given g), so
// "route" does not vary over the data; BN2's gang and BN8's trader are
// absorbed in their g (hackexit.mjs header).
//
// NOT CALIBRATED: SB, TAU_SCALE and the feature set are stated choices. What
// the data say about them is printed every run: the LOO table (elpd of every
// candidate, the per-run residuals) — and `auto` keeps the best by LOO.

const Z90 = 1.2816
export const MONEY_FLOOR = 1e-3
export const SB = 0.3
export const TAU_SCALE = 0.5
export const B0 = { mean: Math.log(0.06), sd: 1 }

export const FEATURES = {
  lnAMC: (m) => Math.log(m.AugmentationMoneyCost),
  lnMoney: (m) => Math.log(Math.max(MONEY_FLOOR, m.ScriptHackMoney * m.ServerMaxMoney * m.ScriptHackMoneyGain)),
  lnHack: (m) => Math.log(m.HackingLevelMultiplier),
  lnWDD: (m) => Math.log(m.WorldDaemonDifficulty),
}
/** The candidate models: their feature lists ('hand' is economy.mjs's latent, not a regression). */
export const MODELS = {
  exch: [],
  amc: ['lnAMC'],
  full: ['lnAMC', 'lnMoney', 'lnHack', 'lnWDD'],
}
export const MODEL_WHAT = {
  hand: "economy.mjs's latent: lo/mid/hi = min/gm/max of the runs' g x AMC^gamma as p10/p90, gamma from the AMC != 1 runs",
  exch: 'hierarchical, exchangeable: ln g_n = b0 + v_n',
  amc: 'hierarchical, ln g_n = b0 + b1 ln AMC_n + v_n',
  full: 'hierarchical, ln g_n = b0 + b(ln AMC, ln money, ln HackingLevel, ln WorldDaemon) + v_n',
}

// ---------------------------------------------------------------------------
// small dense linear algebra (p <= 5, n <= ~30)
// ---------------------------------------------------------------------------
export function chol(A) {
  const n = A.length
  const L = Array.from({ length: n }, () => new Float64Array(n))
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = A[i][j]
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]
      if (i === j) {
        if (!(s > -1e-12)) throw new Error(`chol: not positive definite (pivot ${s})`)
        L[i][i] = Math.sqrt(Math.max(s, 1e-300))
      } else L[i][j] = s / L[j][j]
    }
  return L
}
function cholSolve(L, b) {
  const n = L.length
  const y = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = b[i]
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k]
    y[i] = s / L[i][i]
  }
  const x = new Float64Array(n)
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]
    x[i] = s / L[i][i]
  }
  return x
}
const inv = (A) => {
  const L = chol(A)
  return A.map((_, j) => {
    const e = new Float64Array(A.length)
    e[j] = 1
    return cholSolve(L, e)
  })
}
const logDet = (L) => 2 * L.reduce((a, r, i) => a + Math.log(r[i]), 0)
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0)
const mv = (A, x) => A.map((r) => dot(r, x))
const quad = (x, A, y) => dot(x, mv(A, y))

// ---------------------------------------------------------------------------
// features
// ---------------------------------------------------------------------------
/** Standardisation of every feature over BitNodes 1..14 (population moments of the game's table). */
export function featureStats(multsOf, nodes = [...Array(14)].map((_, i) => i + 1)) {
  const st = {}
  for (const [k, f] of Object.entries(FEATURES)) {
    const v = nodes.map((n) => f(multsOf(n)))
    const m = v.reduce((a, b) => a + b, 0) / v.length
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1
    st[k] = { m, sd }
  }
  return st
}
/** The design row of node n: [1, standardised features...]. */
export const rowOf = (n, feats, multsOf, st) => [1, ...feats.map((k) => (FEATURES[k](multsOf(n)) - st[k].m) / st[k].sd)]

// ---------------------------------------------------------------------------
// the regression, tau on a grid
// ---------------------------------------------------------------------------
export const TAU_GRID = Array.from({ length: 240 }, (_, i) => 0.005 + i * 0.0075) // 0.005 .. 1.8
export const tauPriors = {
  halfNormal: (s) => (t) => -0.5 * (t / s) ** 2,
  halfCauchy: (s) => (t) => -Math.log(1 + (t / s) ** 2),
}

/**
 * Fit: data = [{ x: row, y: ln g, sd }]. Returns the posterior as a mixture
 * over the tau grid: { comps: [{tau, w, mB, VB}], p, logZ }.
 */
export function fitBLR(data, { p, sb = SB, b0 = B0, tauPrior = tauPriors.halfNormal(TAU_SCALE), grid = TAU_GRID } = {}) {
  p = p ?? data[0]?.x.length ?? 1
  const m0 = new Float64Array(p)
  m0[0] = b0.mean
  const S0 = Array.from({ length: p }, (_, i) => Float64Array.from({ length: p }, (_, j) => (i === j ? (i === 0 ? b0.sd ** 2 : sb ** 2) : 0)))
  const S0i = inv(S0)
  const X = data.map((d) => d.x)
  const y = data.map((d) => d.y)
  const comps = grid.map((tau) => {
    const R = data.map((d) => tau * tau + d.sd * d.sd)
    // posterior of beta given tau
    const P = S0i.map((r, i) => Float64Array.from(r, (v, j) => v + X.reduce((a, x, k) => a + (x[i] * x[j]) / R[k], 0)))
    const VB = inv(P)
    const rhs = Float64Array.from({ length: p }, (_, i) => dot(S0i[i], m0) + X.reduce((a, x, k) => a + (x[i] * y[k]) / R[k], 0))
    const mB = mv(VB, rhs)
    // marginal likelihood of y given tau: N(X m0, X S0 X' + R)
    let lml = 0
    if (data.length) {
      const K = X.map((xi, i) => Float64Array.from(X, (xj, j) => quad(xi, S0, xj) + (i === j ? R[i] : 0)))
      const L = chol(K)
      const r = Float64Array.from(y, (v, i) => v - dot(X[i], m0))
      lml = -0.5 * (logDet(L) + dot(r, cholSolve(L, r)))
    }
    return { tau, lw: lml + tauPrior(tau), mB, VB }
  })
  const mx = Math.max(...comps.map((c) => c.lw))
  let tot = 0
  for (const c of comps) tot += c.w = Math.exp(c.lw - mx)
  for (const c of comps) c.w /= tot
  return { comps, p, logZ: mx + Math.log(tot / grid.length) }
}

/** log predictive density of a reading y (sd) at design row x. */
export function logPred(fit, x, y, sd) {
  let s = 0
  for (const c of fit.comps) {
    if (c.w < 1e-12) continue
    const v = quad(x, c.VB, x) + c.tau * c.tau + sd * sd
    s += c.w * Math.exp(-0.5 * (y - dot(x, c.mB)) ** 2 / v) / Math.sqrt(2 * Math.PI * v)
  }
  return Math.log(s + 1e-300)
}

/** Joint predictive of ln g at rows Xs (mixture moments): { mean[], cov[][], sd[] }. */
export function predictJoint(fit, Xs) {
  const k = Xs.length
  const mean = new Float64Array(k)
  const second = Array.from({ length: k }, () => new Float64Array(k))
  for (const c of fit.comps) {
    if (c.w < 1e-12) continue
    const mu = Xs.map((x) => dot(x, c.mB))
    for (let i = 0; i < k; i++) {
      mean[i] += c.w * mu[i]
      for (let j = 0; j < k; j++) second[i][j] += c.w * (quad(Xs[i], c.VB, Xs[j]) + (i === j ? c.tau * c.tau : 0) + mu[i] * mu[j])
    }
  }
  const cov = second.map((r, i) => Float64Array.from(r, (v, j) => v - mean[i] * mean[j]))
  return { mean, cov, sd: Array.from(mean, (_, i) => Math.sqrt(cov[i][i])) }
}

/** Posterior mean and sd of beta (mixture moments) and of tau. */
export function betaSummary(fit) {
  const p = fit.p
  const m = new Float64Array(p)
  const s2 = new Float64Array(p)
  let tm = 0
  let t2 = 0
  for (const c of fit.comps) {
    for (let i = 0; i < p; i++) {
      m[i] += c.w * c.mB[i]
      s2[i] += c.w * (c.VB[i][i] + c.mB[i] ** 2)
    }
    tm += c.w * c.tau
    t2 += c.w * c.tau * c.tau
  }
  return { mean: Array.from(m), sd: Array.from(s2, (v, i) => Math.sqrt(Math.max(0, v - m[i] ** 2))), tauMean: tm, tauSd: Math.sqrt(Math.max(0, t2 - tm * tm)) }
}

/**
 * A sampler of the JOINT posterior predictive of ln g over rows Xs: tau drawn
 * from its grid posterior by the quantile of zTau, then ln g = mean(tau) +
 * chol(cov(tau)) u. Exact for the hierarchical model (not moment-matched).
 */
export function jointSampler(fit, Xs) {
  const live = fit.comps.filter((c) => c.w > 1e-9)
  const tot = live.reduce((a, c) => a + c.w, 0)
  const cdf = []
  let acc = 0
  for (const c of live) cdf.push((acc += c.w / tot))
  const cache = new Map()
  const compOf = (zTau) => {
    const u = Phi(zTau)
    let i = cdf.findIndex((x) => x >= u)
    if (i < 0) i = live.length - 1
    let e = cache.get(i)
    if (!e) {
      const c = live[i]
      const mu = Xs.map((x) => dot(x, c.mB))
      const cov = Xs.map((xi, a) => Float64Array.from(Xs, (xj, b) => quad(xi, c.VB, xj) + (a === b ? c.tau * c.tau : 0)))
      e = { mu, L: chol(cov), tau: c.tau }
      cache.set(i, e)
    }
    return e
  }
  return {
    sample(zTau, u) {
      const { mu, L } = compOf(zTau)
      return mu.map((m, i) => m + L[i].reduce((s, l, k) => (k <= i ? s + l * u[k] : s), 0))
    },
    tauOf: (zTau) => compOf(zTau).tau,
  }
}

/** Standard normal CDF (Abramowitz-Stegun 7.1.26 via erf; |error| < 1.5e-7). */
export function Phi(z) {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2))
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2)
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y)
}

// ---------------------------------------------------------------------------
// the incumbent (economy.mjs's hand latent), as a predictive — for LOO only
// ---------------------------------------------------------------------------
const gm = (xs) => Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length)
/** economy.measureEconomy's latent from runs [{bn, g}] and amc(n): {gamma, lo, mid, hi}. */
export function handLatent(runs, amc) {
  const amc1 = runs.filter((c) => amc(c.bn) === 1)
  const other = runs.filter((c) => amc(c.bn) !== 1)
  // with no AMC != 1 run the formula is 0/0: gamma 0 (no information about it)
  const gamma = other.length && amc1.length ? other.map((c) => Math.log(gm(amc1.map((x) => x.g)) / c.g) / Math.log(amc(c.bn))).reduce((a, b) => a + b, 0) / other.length : 0
  const norms = runs.map((c) => c.g * Math.pow(amc(c.bn), gamma))
  return { gamma, lo: Math.min(...norms), mid: gm(norms), hi: Math.max(...norms) }
}
/** log density of a reading y = ln g + N(0, sd^2) under the hand latent for a node with AMC a. */
export function handLogPred(h, a, y, sd) {
  const mid = Math.log(h.mid) - h.gamma * Math.log(a)
  const sL = Math.max(1e-6, (Math.log(h.mid) - Math.log(h.lo)) / Z90)
  const sR = Math.max(1e-6, (Math.log(h.hi) - Math.log(h.mid)) / Z90)
  // the two-piece density (0.5 mass each side, params.mjs's splitQ) convolved with N(0, sd^2), numerically
  const N = 4001
  const lo = mid - 8 * sL - 6 * sd
  const hi = mid + 8 * sR + 6 * sd
  const dx = (hi - lo) / (N - 1)
  let s = 0
  for (let i = 0; i < N; i++) {
    const x = lo + i * dx
    const pz = x < mid ? Math.exp(-0.5 * ((x - mid) / sL) ** 2) / (sL * Math.sqrt(2 * Math.PI)) : Math.exp(-0.5 * ((x - mid) / sR) ** 2) / (sR * Math.sqrt(2 * Math.PI))
    s += pz * Math.exp(-0.5 * ((y - x) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI))
  }
  return Math.log(s * dx + 1e-300)
}
/** The hand latent's predictive mean / sd of ln g (two-piece moments) for a node with AMC a. */
export function handMoments(h, a) {
  const mid = Math.log(h.mid) - h.gamma * Math.log(a)
  const sL = (Math.log(h.mid) - Math.log(h.lo)) / Z90
  const sR = (Math.log(h.hi) - Math.log(h.mid)) / Z90
  const k = Math.sqrt(2 / Math.PI)
  const m = mid + 0.5 * k * (sR - sL)
  const v = 0.5 * (sL * sL + sR * sR) - (0.5 * k * (sR - sL)) ** 2
  return { mean: m, sd: Math.sqrt(v) }
}

// ---------------------------------------------------------------------------
// leave-one-out over the played runs
// ---------------------------------------------------------------------------
/**
 * runs: [{bn, g, sd?}] (one reading of ln g each). Returns, per model, the
 * LOO log predictive density of every held-out run and their sum (elpd), with
 * the predictive mean/sd for the residual table. The best model is the max elpd.
 */
export function looCompare(runs, multsOf, { models = ['hand', ...Object.keys(MODELS)], sdObs = 0.15, opts = {} } = {}) {
  const st = featureStats(multsOf)
  const amc = (n) => multsOf(n).AugmentationMoneyCost
  const out = {}
  for (const name of models) {
    const per = runs.map((r, i) => {
      const train = runs.filter((_, j) => j !== i)
      const y = Math.log(r.g)
      const sd = r.sd ?? sdObs
      if (name === 'hand') {
        const h = handLatent(train, amc)
        const mo = handMoments(h, amc(r.bn))
        return { bn: r.bn, y, lp: handLogPred(h, amc(r.bn), y, sd), mean: mo.mean, sd: Math.sqrt(mo.sd ** 2 + sd * sd) }
      }
      const feats = MODELS[name]
      const fit = fitBLR(train.map((t) => ({ x: rowOf(t.bn, feats, multsOf, st), y: Math.log(t.g), sd: t.sd ?? sdObs })), { ...opts, p: feats.length + 1 })
      const x = rowOf(r.bn, feats, multsOf, st)
      const pj = predictJoint(fit, [x])
      return { bn: r.bn, y, lp: logPred(fit, x, y, sd), mean: pj.mean[0], sd: Math.sqrt(pj.cov[0][0] + sd * sd) }
    })
    out[name] = { per, elpd: per.reduce((a, p) => a + p.lp, 0), rmse: Math.sqrt(per.reduce((a, p) => a + (p.y - p.mean) ** 2, 0) / per.length), z: per.map((p) => (p.y - p.mean) / p.sd) }
  }
  const best = Object.entries(out).sort((a, b) => b[1].elpd - a[1].elpd)[0][0]
  return { models: out, best, st }
}

/**
 * The fitted joint posterior of ln g for `nodes` given data rows (runs plus
 * applied readings) under regression model `name` — what posterior.mjs hands
 * the draws: { nodes, mean Map, sd Map, cov, sampler, fit, beta }.
 */
export function gJointOf(name, data, nodes, multsOf, opts = {}) {
  const feats = MODELS[name]
  if (!feats) throw new Error(`gmodel: no regression model '${name}' (have ${Object.keys(MODELS).join(', ')})`)
  const st = featureStats(multsOf)
  const fit = fitBLR(data.map((d) => ({ x: rowOf(d.bn, feats, multsOf, st), y: d.y, sd: d.sd })), { ...opts, p: feats.length + 1 })
  const Xs = nodes.map((n) => rowOf(n, feats, multsOf, st))
  const pj = predictJoint(fit, Xs)
  const mean = new Map(nodes.map((n, i) => [n, pj.mean[i]]))
  const sd = new Map(nodes.map((n, i) => [n, pj.sd[i]]))
  return { name, feats, nodes, mean, sd, cov: pj.cov, sampler: jointSampler(fit, Xs), fit, beta: betaSummary(fit), st }
}
