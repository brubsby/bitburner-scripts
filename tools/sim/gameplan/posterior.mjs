// THE POSTERIOR STORE: every uncertain parameter's distribution as the hand
// prior updated by what finished (and in-progress) nodes measured.
//
// Pure (no game import), so the tests run it without the bundle.
//
// THE FILE: tools/sim/gameplan/posterior.json (committed), schema
// 'gameplan-posterior' version POSTERIOR_VERSION:
//   { schema, version, updatedAt, model{...}, observations[...], posterior{...} }
// `observations` is the log, the ONLY input besides the hand prior: the
// posterior is recomputed from (hand prior + log) every time it is read, and
// `posterior` is that result written out for people and diffs. A log entry is
//   { key, param, value, sd, space, at, source, node?, clear?, inBase?, note? }
// keyed so re-observing the same thing is a no-op (observe.mjs: a node's clear
// is `param|BNn.l|completion time`; an in-run reading `param|source|at`).
// `inBase: true` marks evidence the hand prior was BUILT from (economy.mjs's
// MEASURED_RUNS for g; BN6.1 for k and open, bbcal6.mjs): logged so the store
// says what produced it, never applied twice.
//
// THE BASE (kept as is): the hand lo/mid/hi of effects.SF_PARAMS and
// params.BB_PARAMS (10th / 50th / 90th percentile of a split normal), and the
// economy's latent g (economy.mjs: lo/mid/hi = min / geometric mean / max of
// the measured runs' AMC-normalised g, common-factor share RHO). With an empty
// log every draw is EXACTLY the hand prior's (GP3 and the hand-prior plan
// reproduce bit for bit).
//
// THE UPDATES
//   scalar parameter (k, open, every SF_PARAMS entry): the prior is the hand
//     split normal over its standard-normal position z, v(z) = max(min,
//     splitQ(lo, mid, hi, z)); the posterior is the prior density x the
//     likelihood on a z grid, and a draw maps its z through the quantile map
//     z -> Qpost(Phi(z)) — so the draw/VOI machinery (z per parameter) is
//     unchanged, a clipped prior (w0's mass at 0) is handled exactly, and the
//     shape away from the data stays the hand one.
//     Likelihood: LOG-NORMAL on rates, ln(obs) ~ N(ln v, sd^2) — the shape the
//     calibrations already use (g backed out in ln g, k a ratio live/model);
//     `space: 'lin'` (obs ~ N(v, sd^2), sd in the parameter's units) for a
//     reading that can be 0 (w0 measured at 0: the opponent never lost).
//   g (hierarchical): x_n = ln(g_n x AMC_n^gamma) (economy.mjs's normalised
//     log growth). Population: x_n = mu + tau e_n for every node not measured
//     in the base; mu ~ N(ln gScen.mid, RHO s^2), tau^2 = (1 - RHO) s^2,
//     s = (ln hi - ln lo)/(2 x 1.2816) — exactly the hand draw's variance and
//     common share. A base-measured node: x_n ~ N(ln measured, SIGMA_PLAYED^2),
//     its information already inside mu. An observation y = x_n + N(0, sd^2)
//     is a Kalman update of the joint Gaussian (mu, x_1..x_14): exact,
//     order-independent, and an observed UNPLAYED node pulls mu and with it
//     every unplayed node (the hierarchy), shrinking toward the population.
//     The draw keeps the hand split-normal shape: x = m + (splitQ(z) - ln mid)
//     x sd_post/s, common share rho = Var(mu)/(Var(mu) + tau^2).
//
// NOT CALIBRATED: the observation sds (OBS_SD) and tau's share (RHO) are
// stated assumptions; tau is not learned (hierFit below fits it from the
// runs for a cross-check only).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SF_PARAMS, splitQ } from './effects.mjs'
import { BB_PARAMS, RHO, SIGMA_PLAYED } from './params.mjs'
import { looCompare, gJointOf, MODEL_WHAT } from './gmodel.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const POSTERIOR_FILE = path.join(HERE, 'posterior.json')
export const POSTERIOR_SCHEMA = 'gameplan-posterior'
export const POSTERIOR_VERSION = 1
const Z90 = 1.2816

/**
 * The in-run observation channel (README "Observations"): JSON lines
 * { param, value, sd, at, source, node?, space?, key? } in the telemetry dir.
 * gameplan-obs.txt is the rfa-daemon's mirror of the game's /tel/gameplan-obs.txt
 * (gameplan-obs.js appends it); gameplan-obs.jsonl is for writers outside the game.
 */
export const OBS_FILES = ['gameplan-obs.txt', 'gameplan-obs.jsonl']

/** Default observation sds (log space). ASSUMED: run-to-run noise of one reading. */
export const OBS_SD = {
  g: SIGMA_PLAYED, // a node's backed-out g: the same spread the planner gives a replay
  k: 0.1, // one Bladeburner leg / the bbsim median: seed spread + fleet timing
  open: 0.25, // one opening (entry -> combat 100): crime/gym luck, the first install's timing
}

/** The scalar parameters and how a z becomes a value (worldOf's own clipping). */
export function scalarSpecs() {
  const s = {}
  for (const [id, p] of Object.entries(BB_PARAMS)) s[id] = { ...p, min: id === 'k' ? 0.3 : 0.5 }
  for (const [id, p] of Object.entries(SF_PARAMS)) s[id] = id === 'z9' ? { ...p, identity: true } : { ...p }
  return s
}
export const valueAt = (spec, z) => (spec.identity ? z : Math.max(spec.min ?? -Infinity, splitQ(spec.lo, spec.mid, spec.hi, z)))

// ---------------------------------------------------------------------------
// scalar update on a z grid
// ---------------------------------------------------------------------------
const ZG_LO = -8
const ZG_HI = 8
const ZG_N = 3201
const ZG = Array.from({ length: ZG_N }, (_, i) => ZG_LO + (i * (ZG_HI - ZG_LO)) / (ZG_N - 1))
const PRIOR_CDF = cdfOf(ZG.map((z) => -0.5 * z * z))

function cdfOf(logp) {
  const mx = Math.max(...logp)
  if (!isFinite(mx)) return null
  const p = logp.map((x) => Math.exp(x - mx))
  const c = new Float64Array(p.length)
  for (let i = 1; i < p.length; i++) c[i] = c[i - 1] + 0.5 * (p[i] + p[i - 1])
  const tot = c[c.length - 1]
  for (let i = 0; i < c.length; i++) c[i] /= tot
  return c
}
/** Linear interpolation of y over increasing xs at x (clamped). */
function interp(xs, ys, x) {
  if (x <= xs[0]) return ys[0]
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1]
  let lo = 0
  let hi = xs.length - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (xs[m] <= x) lo = m
    else hi = m
  }
  const t = xs[hi] === xs[lo] ? 0 : (x - xs[lo]) / (xs[hi] - xs[lo])
  return ys[lo] + t * (ys[hi] - ys[lo])
}
/** Log-likelihood of one reading at parameter value v. */
export function logLik(o, v) {
  if (o.space === 'lin') return -0.5 * ((o.value - v) / o.sd) ** 2
  if (!(v > 0) || !(o.value > 0)) return -Infinity
  return -0.5 * ((Math.log(o.value) - Math.log(v)) / o.sd) ** 2
}

/**
 * The posterior of one scalar parameter given its readings: a monotone map
 * z_prior -> z_post (identity when there are none), and its summary.
 */
export function scalarPosterior(spec, obs) {
  if (!obs.length) return { map: (z) => z, n: 0 }
  const logp = ZG.map((z) => {
    const v = valueAt(spec, z)
    let lp = -0.5 * z * z
    for (const o of obs) lp += logLik(o, v)
    return lp
  })
  const cdf = cdfOf(logp)
  if (!cdf) throw new Error(`posterior of ${spec.what ?? '?'}: the readings exclude the whole prior (check value/space)`)
  // z -> u = prior CDF(z) -> z' = posterior CDF^-1(u)
  const map = (z) => interp(Array.from(cdf), ZG, interp(ZG, Array.from(PRIOR_CDF), z))
  // collapse the grid into a lookup on the prior's z (fast in the draws)
  const zs = Array.from({ length: 1201 }, (_, i) => -6 + i * 0.01)
  const tab = zs.map(map)
  return { map: (z) => interp(zs, tab, z), n: obs.length }
}

// ---------------------------------------------------------------------------
// g: the hierarchical Gaussian
// ---------------------------------------------------------------------------
/**
 * The base: (mu, x_1..x_N) jointly Gaussian from the economy's hand latent and
 * the base-measured nodes. econ: { gScen, gamma, amc, ownG Map }.
 */
export function gBase(econ, { rho = RHO, sigmaPlayed = SIGMA_PLAYED, nodes = 14 } = {}) {
  const lnmid = Math.log(econ.gScen.mid)
  const s = (Math.log(econ.gScen.hi) - Math.log(econ.gScen.lo)) / (2 * Z90)
  const vMu = rho * s * s
  const tau2 = (1 - rho) * s * s
  const N = nodes + 1
  const m = new Float64Array(N)
  const P = Array.from({ length: N }, () => new Float64Array(N))
  m[0] = lnmid
  P[0][0] = vMu
  const unplayed = []
  for (let n = 1; n <= nodes; n++) {
    if (econ.ownG.has(n)) {
      m[n] = Math.log(econ.ownG.get(n)) + econ.gamma * Math.log(econ.amc[n])
      P[n][n] = sigmaPlayed * sigmaPlayed
    } else {
      m[n] = lnmid
      P[n][n] = vMu + tau2
      P[n][0] = P[0][n] = vMu
      for (const k of unplayed) P[n][k] = P[k][n] = vMu
      unplayed.push(n)
    }
  }
  return { m, P, tau2, s, lnmid, nodes, base: new Set(econ.ownG.keys()), observed: new Set() }
}
/** Kalman update with y = x_n + N(0, r2) (in place). */
export function gUpdate(G, n, y, r2) {
  const N = G.m.length
  const Pn = Array.from({ length: N }, (_, i) => G.P[i][n])
  const S = Pn[n] + r2
  const innov = y - G.m[n]
  for (let i = 0; i < N; i++) G.m[i] += (Pn[i] / S) * innov
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) G.P[i][j] -= (Pn[i] * Pn[j]) / S
  G.observed.add(n)
  return G
}
/** The draw parameters the posterior hands worldOf / drawZ. */
export function gSummary(G) {
  const vMu = G.P[0][0]
  const vUn = vMu + G.tau2
  return {
    mu: G.m[0],
    sdMu: Math.sqrt(vMu),
    gShift: G.m[0] - G.lnmid,
    gScale: Math.sqrt(vUn) / G.s,
    rho: vMu / vUn,
    node: (n) => ({ m: G.m[n], sd: Math.sqrt(G.P[n][n]) }),
  }
}

/**
 * Cross-check only: a fully hierarchical fit of readings ys (each with sd
 * sigma) under a flat prior on mu and a grid on tau — the posterior
 * predictive of an UNSEEN node's x as {p10, p50, p90}, and tau's posterior mean.
 */
export function hierFit(ys, sigma, { tauMax = 3, nTau = 300 } = {}) {
  const taus = Array.from({ length: nTau }, (_, i) => ((i + 0.5) * tauMax) / nTau)
  const comps = taus.map((tau) => {
    const w = 1 / (tau * tau + sigma * sigma)
    const W = w * ys.length
    const mbar = ys.reduce((a, y) => a + y, 0) / ys.length
    const ss = ys.reduce((a, y) => a + w * (y - mbar) ** 2, 0)
    const logml = 0.5 * ys.length * Math.log(w) - 0.5 * Math.log(W) - 0.5 * ss
    return { tau, logml, m: mbar, sd: Math.sqrt(1 / W + tau * tau) }
  })
  const mx = Math.max(...comps.map((c) => c.logml))
  for (const c of comps) c.w = Math.exp(c.logml - mx)
  const tw = comps.reduce((a, c) => a + c.w, 0)
  const lo = Math.min(...ys) - 4 * tauMax
  const hi = Math.max(...ys) + 4 * tauMax
  const xs = Array.from({ length: 4001 }, (_, i) => lo + (i * (hi - lo)) / 4000)
  const lp = xs.map((x) => Math.log(comps.reduce((a, c) => a + (c.w / tw) * Math.exp(-0.5 * ((x - c.m) / c.sd) ** 2) / c.sd, 0) + 1e-300))
  const cdf = Array.from(cdfOf(lp))
  const q = (u) => interp(cdf, xs, u)
  return { p10: q(0.1), p50: q(0.5), p90: q(0.9), tauMean: comps.reduce((a, c) => a + (c.w / tw) * c.tau, 0) }
}

// ---------------------------------------------------------------------------
// the store
// ---------------------------------------------------------------------------
export function emptyStore() {
  return {
    schema: POSTERIOR_SCHEMA,
    version: POSTERIOR_VERSION,
    updatedAt: null,
    model: {
      scalar: 'hand split normal (lo/mid/hi = p10/p50/p90) x log-normal likelihood, on a z grid',
      g: 'x_n = ln(g_n AMC_n^gamma) ~ N(mu, tau^2); mu ~ N(ln gScen.mid, RHO s^2), tau^2 = (1-RHO) s^2; base-measured nodes N(ln g, SIGMA_PLAYED^2)',
      RHO,
      SIGMA_PLAYED,
      OBS_SD,
    },
    observations: [],
    posterior: {},
  }
}
export function loadStore(file = POSTERIOR_FILE) {
  if (!fs.existsSync(file)) return emptyStore()
  const st = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (st.schema !== POSTERIOR_SCHEMA) throw new Error(`${file}: not a ${POSTERIOR_SCHEMA} file`)
  if (st.version > POSTERIOR_VERSION) throw new Error(`${file}: version ${st.version} is newer than this code (${POSTERIOR_VERSION})`)
  return st
}
export function saveStore(st, file = POSTERIOR_FILE) {
  st.observations.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  fs.writeFileSync(file, JSON.stringify(st, null, 1) + '\n')
}

/**
 * The space a reading's sd is in when it does not say: w0 is 'lin' (absolute
 * sd in node power/h, and a measured 0 is meaningful) — what go.js publishes
 * (goplan.w0Obs: the ratio estimator's delta-method sd); everything else 'log'.
 */
export const DEFAULT_SPACE = { w0: 'lin' }
/**
 * A lin reading's sd floor: 1% of the hand prior's p10-p90 width (w0: 10/h).
 * A run that never scored reads value 0, sd 0 — a real reading, not an infinitely precise one.
 */
export const linSdFloor = (spec) => 0.01 * Math.abs(spec.hi - spec.lo)
/**
 * The stream a reading belongs to: readings of one stream are CUMULATIVE
 * estimates (each re-estimates from all the games so far), so only the latest
 * (by `at`) is applied and the rest are superseded. Explicit `stream`, or a
 * source of go.js's form '<who>: <n> games vs <opponent>' -> 'param|who|opponent'.
 * null = an independent reading.
 */
export function streamOf(o) {
  if (o.stream) return String(o.stream)
  const m = /^(.+?): \d+ games vs (.+)$/.exec(String(o.source ?? ''))
  return m ? `${o.param}|${m[1]}|${m[2]}` : null
}

/** Validate and normalise one reading; returns [obs, null] or [null, why]. */
export function normaliseObs(o, specs = scalarSpecs()) {
  if (!o || typeof o !== 'object') return [null, 'not an object']
  const param = String(o.param ?? '')
  const isG = /^g([1-9]|1[0-4])$/.test(param)
  if (!isG && !specs[param]) return [null, `unknown param '${param}'`]
  const value = Number(o.value)
  if (!isFinite(value)) return [null, `${param}: value ${o.value} not a number`]
  const space = o.space === 'lin' || o.space === 'log' ? o.space : DEFAULT_SPACE[param] ?? 'log'
  if (isG && space !== 'log') return [null, `${param}: g readings are log space only`]
  let sd = Number(o.sd ?? (isG ? OBS_SD.g : OBS_SD[param]))
  if (space === 'lin' && sd >= 0) sd = Math.max(sd, linSdFloor(specs[param]))
  if (!(sd > 0)) return [null, `${param}: sd ${o.sd} must be > 0`]
  if (space === 'log' && !(value > 0)) return [null, `${param}: value ${value} <= 0 in log space (send space:'lin' with an absolute sd)`]
  const at = String(o.at ?? '')
  const source = String(o.source ?? 'unknown')
  const key = String(o.key ?? `${param}|${source}|${at}`)
  const out = { key, param, value, sd, space, at, source }
  const stream = streamOf({ ...o, param })
  if (stream) out.stream = stream
  for (const k of ['node', 'clear', 'inBase', 'note']) if (o[k] !== undefined) out[k] = o[k]
  return [out, null]
}

/** The readings the posterior applies: not in the base, and only the latest of each stream. */
export function appliedObs(observations) {
  const latest = new Map()
  for (const o of observations) {
    if (o.inBase || !o.stream) continue
    const cur = latest.get(o.stream)
    if (!cur || o.at > cur.at) latest.set(o.stream, o)
  }
  return observations.filter((o) => !o.inBase && (!o.stream || latest.get(o.stream) === o))
}

/** Merge readings into the store's log by key. Returns { added, dup, rejected[] }. */
export function mergeObs(st, readings, specs = scalarSpecs()) {
  const have = new Set(st.observations.map((o) => o.key))
  let added = 0
  let dup = 0
  const rejected = []
  for (const r of readings) {
    const [o, why] = normaliseObs(r, specs)
    if (!o) {
      rejected.push(why)
      continue
    }
    if (have.has(o.key)) {
      dup++
      continue
    }
    st.observations.push(o)
    have.add(o.key)
    added++
  }
  return { added, dup, rejected }
}

/**
 * The g model with covariates (gmodel.mjs) on the base runs + the applied g
 * readings. gModel: 'auto' (the best of hand / exch / amc / full by LOO over
 * the runs) or a model name. Returns { chosen, loo, joint (the unplayed
 * nodes' joint posterior predictive, null under hand), ownG, gSd }.
 * A node with readings since the base: its own posterior = the model's
 * predictive for it fitted WITHOUT its readings, times their likelihood.
 */
export function regressionG(econ, live, { gModel = 'auto', multsOf, gOpts = {} } = {}) {
  if (typeof multsOf !== 'function') throw new Error(`posterior: gModel '${gModel}' needs multsOf(n) (the BitNode multipliers)`)
  const runs = econ.runs.map((r) => ({ bn: r.bn, g: r.g, sd: OBS_SD.g }))
  const loo = runs.length >= 3 ? looCompare(runs, multsOf, { opts: gOpts }) : null
  const chosen = gModel === 'auto' ? loo?.best ?? 'hand' : gModel
  const out = { chosen, loo, what: MODEL_WHAT[chosen], joint: null, ownG: new Map(econ.ownG), gSd: new Map() }
  if (chosen === 'hand') return out
  const readings = live.filter((x) => /^g\d+$/.test(x.param)).map((o) => ({ bn: Number(o.param.slice(1)), y: Math.log(o.value), sd: o.sd }))
  const data = [...runs.map((r) => ({ bn: r.bn, y: Math.log(r.g), sd: r.sd })), ...readings]
  const seen = [...new Set(readings.map((r) => r.bn))]
  for (const n of seen) {
    const pr = gJointOf(chosen, data.filter((d) => !(d.bn === n && readings.includes(d))), [n], multsOf, gOpts)
    let prec = 1 / pr.sd.get(n) ** 2
    let num = pr.mean.get(n) * prec
    for (const r of readings.filter((x) => x.bn === n)) {
      prec += 1 / r.sd ** 2
      num += r.y / r.sd ** 2
    }
    out.ownG.set(n, Math.exp(num / prec))
    out.gSd.set(n, Math.sqrt(1 / prec))
  }
  const unplayed = [...Array(14)].map((_, i) => i + 1).filter((n) => !out.ownG.has(n))
  out.joint = gJointOf(chosen, data, unplayed, multsOf, gOpts)
  return out
}

/**
 * The posterior from (hand prior + log): { scalar{id: {map, n}}, G, g (gSummary),
 * applied: econ with gShift/gScale/rho/gSd and the newly observed nodes' g }.
 * econ is economy.measureEconomy()'s (ownG as a Map).
 */
export function posteriorOf(st, econ, { rho = RHO, sigmaPlayed = SIGMA_PLAYED, gModel = 'hand', multsOf = null, gOpts = {} } = {}) {
  const specs = scalarSpecs()
  const live = appliedObs(st.observations)
  const scalar = {}
  for (const [id, spec] of Object.entries(specs)) scalar[id] = scalarPosterior(spec, live.filter((o) => o.param === id))
  if (gModel !== 'hand') {
    const reg = regressionG(econ, live, { gModel, multsOf, gOpts })
    if (reg.chosen !== 'hand') {
      const applied = { ...econ, ownG: reg.ownG, gSd: reg.gSd, gJoint: reg.joint, zMap: Object.fromEntries(Object.entries(scalar).filter(([, v]) => v.n).map(([k, v]) => [k, v.map])) }
      return { scalar, specs, G: null, g: null, gReg: reg, applied, nObs: live.length }
    }
    const out = posteriorOf(st, econ, { rho, sigmaPlayed })
    out.gReg = reg
    return out
  }
  const G = gBase(econ, { rho, sigmaPlayed })
  for (const o of live.filter((x) => /^g\d+$/.test(x.param))) {
    const n = Number(o.param.slice(1))
    gUpdate(G, n, Math.log(o.value) + econ.gamma * Math.log(econ.amc[n]), o.sd * o.sd)
  }
  const g = gSummary(G)
  // no g reading: exactly the hand latent (no rounding through the Gaussian)
  if (!G.observed.size) Object.assign(g, { gShift: 0, gScale: 1, rho })
  const ownG = new Map(econ.ownG)
  const gSd = new Map()
  for (const n of G.observed) {
    const { m, sd } = g.node(n)
    ownG.set(n, Math.exp(m) * Math.pow(econ.amc[n], -econ.gamma))
    gSd.set(n, sd)
  }
  const nObs = live.length
  const applied = { ...econ, ownG, gSd, gShift: g.gShift, gScale: g.gScale, rho: g.rho, zMap: Object.fromEntries(Object.entries(scalar).filter(([, v]) => v.n).map(([k, v]) => [k, v.map])) }
  return { scalar, specs, G, g, applied, nObs }
}

/** p10/p50/p90 of every parameter under the hand prior and the posterior (for the store and the printout). */
export function summarise(post, econ) {
  const out = {}
  const qs = [-Z90, 0, Z90]
  const r = (x) => +x.toPrecision(4)
  for (const [id, spec] of Object.entries(post.specs)) {
    const sc = post.scalar[id]
    out[id] = { prior: qs.map((z) => r(valueAt(spec, z))), post: qs.map((z) => r(valueAt(spec, sc.map(z)))), n: sc.n }
  }
  if (post.gReg?.joint) {
    // the covariate model: every unplayed node's own p10/p50/p90 (no AMC normalisation — AMC is a feature)
    const J = post.gReg.joint
    const lg = ['lo', 'mid', 'hi'].map((k) => Math.log(econ.gScen[k]))
    for (const n of J.nodes) {
      const hand = qs.map((z) => r(Math.exp(splitQ(lg[0], lg[1], lg[2], z)) * Math.pow(econ.amc[n], -econ.gamma)))
      out[`g${n}`] = { prior: hand, post: qs.map((z) => r(Math.exp(J.mean.get(n) + z * J.sd.get(n)))), n: 0, what: `g /h of unplayed BN${n}: hand latent (prior) vs the ${J.name} model (post)` }
    }
    for (const [n, sd] of post.gReg.gSd) out[`g${n}`] = { prior: econ.ownG.get(n) ? [r(econ.ownG.get(n)), SIGMA_PLAYED] : null, post: [r(post.applied.ownG.get(n)), r(sd)], what: 'g /h and its log sd' }
    out.gModel = { chosen: post.gReg.chosen, what: post.gReg.what, elpd: post.gReg.loo ? Object.fromEntries(Object.entries(post.gReg.loo.models).map(([k, v]) => [k, r(v.elpd)])) : null, beta: J.beta.mean.map(r), betaSd: J.beta.sd.map(r), feats: J.feats, tau: [r(J.beta.tauMean), r(J.beta.tauSd)] }
    return out
  }
  // g of an unplayed node, AMC-normalised (x AMC^-gamma per node)
  const lg = ['lo', 'mid', 'hi'].map((k) => Math.log(econ.gScen[k]))
  const gq = (z, shift, scale) => Math.exp(lg[1] + shift + (splitQ(lg[0], lg[1], lg[2], z) - lg[1]) * scale)
  out.gUnplayed = {
    prior: qs.map((z) => r(gq(z, 0, 1))),
    post: qs.map((z) => r(gq(z, post.g.gShift, post.g.gScale))),
    rho: [RHO, r(post.g.rho)],
    n: post.G.observed.size,
    what: 'normalised g (x AMC^-gamma) of an unplayed node; rho = common-factor share',
  }
  if (post.gReg) out.gModel = { chosen: 'hand', what: post.gReg.what, elpd: post.gReg.loo ? Object.fromEntries(Object.entries(post.gReg.loo.models).map(([k, v]) => [k, r(v.elpd)])) : null }
  for (const n of post.G.observed) {
    const { m, sd } = post.g.node(n)
    const g0 = econ.ownG.get(n)
    out[`g${n}`] = { prior: g0 ? [r(g0), SIGMA_PLAYED] : null, post: [r(Math.exp(m) * Math.pow(econ.amc[n], -econ.gamma)), r(sd)], what: 'g /h and its log sd' }
  }
  return out
}

// ---------------------------------------------------------------------------
// exploration: what each parameter costs to measure before the next decision
// ---------------------------------------------------------------------------
/**
 * How each parameter can be measured, and whether that can happen before the
 * next decision (the end of the node in progress). ctx: { node, route
 * ('hack'|'blade'|null), rec (recommended next node), dRec(n) (E[T] of
 * playing n next minus the recommendation's) }.
 * Returns { how, before (bool), cost (hours, or null = not before the decision), why }.
 * ASSUMED: the costs (0.05h for w0 = a few w0r1d_d43m0n games on the Go slot).
 */
export function measurability(id, ctx) {
  const cur = ctx.node ? `BN${ctx.node}` : 'the node in progress'
  const g = /^g(\d+)$/.exec(id)
  if (g) {
    const n = Number(g[1])
    if (n === ctx.rec) return { how: `play BN${n}`, before: false, cost: null, why: 'learned by the recommended clear itself' }
    const d = ctx.dRec(n)
    return { how: `play BN${n}`, before: false, cost: null, why: `only by playing it, after this decision${d === null || d === undefined ? '' : `; playing it next costs +${d.toFixed(1)}h in expectation`}` }
  }
  const d = /^delta(\d+)$/.exec(id)
  if (d) return { how: `play BN${d[1]}`, before: false, cost: null, why: 'the model discrepancy of an unplayed node: only its own clear measures it' }
  if (id === 'tauG') return { how: 'play unplayed nodes on the hacking route', before: false, cost: null, why: "the g population's spread (gmodel.mjs tau): every new node's g reading sharpens it" }
  const W0 = 'w0r1d_d43m0n games after The Red Pill (gameplan-obs channel)'
  switch (id) {
    case 'w0':
      return ctx.route === 'hack'
        ? { how: W0, before: true, cost: 0.05, why: `in ${cur}'s final window, after The Red Pill` }
        : { how: W0, before: false, cost: null, why: `${cur} is not on the hacking route (no Red Pill on its path) — the next hacking-route node's final window, ~0 cost` }
    case 'goP':
      return { how: 'the Go farm (goplan / go.txt), any node', before: true, cost: 0, why: 'passive: the farm is already running' }
    case 'rep14':
    case 'lvl14':
      return ctx.route === 'hack'
        ? { how: 'Daedalus faction work, a hacking-route life', before: true, cost: 0, why: `passive in ${cur}` }
        : { how: 'Daedalus faction work, a hacking-route life', before: false, cost: null, why: `${cur} does not grind Daedalus` }
    case 'k':
    case 'open':
      return ctx.route === 'blade'
        ? { how: 'a Bladeburner clear (observe.mjs)', before: true, cost: 0, why: `arrives with ${cur}'s clear (Bladeburner route), no extra cost${id === 'open' ? '; its opening is already read' : ''}` }
        : { how: 'a Bladeburner clear (observe.mjs)', before: false, cost: null, why: 'only by a Bladeburner clear' }
    case 'eps14':
      return { how: 'g measured with the Go bonus doubled', before: false, cost: null, why: 'needs SF14.1 (after BN14)' }
    case 'phi11':
      return { how: 'g measured at SF11.1+', before: false, cost: null, why: 'needs SF11 (after BN11)' }
    case 'd10':
      return { how: 'g measured at SF10.2+', before: false, cost: null, why: 'needs SF10.2' }
    case 'd8':
      return { how: 'g measured at SF8.2+', before: false, cost: null, why: 'needs SF8.2' }
    case 'e43':
      return { how: 'a first life at SF4.3', before: false, cost: null, why: `needs SF4.3${ctx.node === 4 ? ` (from the end of ${cur})` : ''}` }
    case 'z9':
      return { how: 'a first life at SF9.2+', before: false, cost: null, why: 'needs SF9.2' }
    default:
      return { how: '?', before: false, cost: null, why: 'no measurement defined' }
  }
}
