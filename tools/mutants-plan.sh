#!/bin/bash
# Mutation tests of the switch rule and its wiring (sandboxed by tools/mutant.mjs).
cd "$(dirname "$0")/.."
run() { echo "== $1: $2"; node tools/mutant.mjs "$1" "$2" "$3" bayes 2>&1 | head -3; }
run plan.js 'if (best && best.gain > 0 && best.pWin >= theta) {' 'if (best && best.gain > 0) {'
run plan.js 'if (best && best.gain > 0 && best.pWin >= theta) {' 'if (best && best.pWin >= theta) {'
run plan.js 'const D = c.map((hc, d) => hc - (filled[k][d] + cost))' 'const D = c.map((hc, d) => hc - filled[k][d])'
run plan.js 'if (committed === null || !filled[committed]) {' 'if (committed === null) {'
run plan.js '  return Math.exp(sc * d.zc + Math.sqrt(si2) * zi - d.s2 / 2)' '  return Math.exp(sc * normalOf(rngOf(hashOf(key + d.i))) + Math.sqrt(si2) * zi - d.s2 / 2)'
run plan.js "    const zT = normalOf(st('trader'))" "    const zT = normalOf(rngOf(Date.now() + i))"
run plan.js 'if (n >= 2 && now() - t0 > budgetMs) {' 'if (false) {'
run plan.js "if (prev.lastAugReset !== cur.lastAugReset) ev.push('new life (install)')" "if (false) ev.push('new life (install)')"
run installgate.js "exitWait = bayes.install || bayes.key === 'never' ? null : {" "exitWait = true ? null : {"
run installgate.js "const bayes = exitDecides && ex.bayes && typeof ex.bayes.install === 'boolean' ? ex.bayes : null" "const bayes = null"
run bayes.js "  return { m: (k0 * m0 + S) / k, k, a: a0 + n / 2, b: b0 + 0.5 * ss + (0.5 * k0 * W * (xbar - m0) ** 2) / k, n }" "  return { m: (k0 * m0 + S) / k, k, a: a0 + n / 2, b: b0 + 0.5 * ss, n }"
run bayes.js "  const tau2 = Math.max(0, (Q - (g.length - 1)) / C)" "  const tau2 = 0"
run plan.js '  const buy = deltaH < 0 && pBuy >= theta' '  const buy = deltaH < 0'
run plan.js '  const buy = deltaH < 0 && pBuy >= theta' '  const buy = pBuy >= 0.5'
run plan.js '  if (!redecide && committedKey) return { key: committedKey, ...stats[committedKey], held: true' '  if (false) return { key: committedKey, ...stats[committedKey], held: true'
run plan.js '  if (c && fin(c.cover80) && c.n >= PLAN_CAL.minN && (c.cover80 < PLAN_CAL.lo || c.cover80 > PLAN_CAL.hi))' '  if (c && fin(c.cover80) && c.n >= PLAN_CAL.minN && (c.cover80 < PLAN_CAL.lo))'
run coop.js '          if (yieldFn && t2 - sliceStart + step >= sliceMs) {' '          if (false) {'
run coop.js '  const cpuNow = () => st.cpuMs + (running ? now() - sliceStart : 0)' '  const cpuNow = () => now()'
run graftplan.js '      const h = yield* withRun([...chosen, ...bundle])' '      const h = drain(withRun([...chosen, ...bundle]))'
run progress.js '    const basis = basisOf(pc.prev?.decisions?.install ?? null, Date.now())' '    const basis = null'
run plan.js '      samples[o.key].push(fin(h) ? h * discrepancyOf(d, o.noiseKey ?? o.key) : null)' '      samples[o.key].push(fin(h) ? h * discrepancyOf(d, o.key) : null)'
run bayes.js '    if (a.ver !== b.ver) {' '    if (false) {'
run bayes.js '    w = xs.map((x) => (nu + 1) / (nu + (x * x) / s2))' '    w = xs.map(() => 1)'
run progress.js 'life: info?.lastAugReset ?? null, source, ver: MODEL_VERSION, boot: PLANNER_BOOT }' 'life: info?.lastAugReset ?? null, source }'
# loop guards (module 'loops'): each mutant is caught by LP1 (static) or LP3 (behaviour)
runl() { echo "== $1: $2"; node tools/mutant.mjs "$1" "$2" "$3" loops 2>&1 | head -3; }
runl bayes.js "  if (!(typeof u === 'number' && u >= 0 && u < 1)) throw" "  if (false) throw"
runl bayes.js "      if (j >= SAMPLER_CAP.gammaInner) throw new SamplingError" "      if (false) throw new SamplingError"
runl coop.js "    if (steps > cap) throw new LoopCapError" "    if (false) throw new LoopCapError"
runl countexit.js "      if (spent + p > budget || levels > 200) break" "      if (spent + p > budget) break"
# a fresh life is not blind (BY14)
run plan.js "  if (inputs.incomeFromPrior === true && fin(d.incomeLn)) o.incomePerSec = Math.exp(d.incomeLn)" "  if (false) o.incomePerSec = Math.exp(d.incomeLn)"
run plan.js "  if (inputs.repFromEstimate === true && fin(inputs.repPerSec) && fin(d.repResid)) o.repPerSec = inputs.repPerSec * d.repResid" "  if (false) o.repPerSec = inputs.repPerSec * d.repResid"
run bayes.js "  const sd = Math.sqrt(sdMean * sdMean + sLife2 + extra * extra)" "  const sd = Math.sqrt(sdMean * sdMean + extra * extra)"
run progress.js "      return pr ? { incomePerSec: pr.perSec, incomeFromPrior: true, incomeSource: pr.label } : {}" "      return {}"
# the install cadence is a posterior (BY15)
run bayes.js "    else if (!(l.g >= C.stallLn)) b.stalls++" "    else if (false) b.stalls++"
run bayes.js "    if (prev && prev.node === e.bitNode && start !== null && prev.start !== null && Math.abs(prev.start - start) <= dupTolH) {" "    if (false) {"
run bayes.js "    const next = nx ? (nx.node === lives[i].node ? nx.hackMult : null) : lives[i].node === node && fin(hackMultNow) && hackMultNow > 0 ? hackMultNow : null" "    const next = nx ? nx.hackMult : null"
run bayes.js "    return { mean: (pm / pv + own[key] / v) / prec, sd: Math.sqrt(1 / prec), prior, weight: 1 / v / prec }" "    return { mean: own[key], sd: Math.sqrt(v), prior, weight: 1 }"
run bayes.js "    return { mean: (pm / pv + own[key] / v) / prec, sd: Math.sqrt(1 / prec), prior, weight: 1 / v / prec }" "    return { mean: pm, sd: Math.sqrt(pv), prior, weight: 0 }"
run bayes.js "      if (m === node) continue" "      if (false) continue"
run bayes.js "    const c = typeof covOf === 'function' ? covOf(n) : 0" "    const c = 0"
run plan.js "  if (fin(d.cycleH) && d.cycleH > 0 && fin(inputs.cycleHours) && inputs.cycleHours > 0) o.cycleHours = d.cycleH" "  if (false) o.cycleHours = d.cycleH"
run plan.js "    const ln = cad && fin(cad.rate?.mean) && fin(cad.rate?.sd) ? Math.exp(cad.rate.mean + cad.rate.sd * normalOf(st('cadenceRate'))) : null" "    const ln = cad && fin(cad.rate?.mean) ? Math.exp(cad.rate.mean) : null"
run progress.js "cadence: installCadence(ledger, info?.currentNode, cadenceOptsOf(ns.getPlayer()))?.posterior ?? null })" "cadence: null })"
# the aug claim survives every installgate write (structure C9b)
runs() { echo "== $1: $2"; node tools/mutant.mjs "$1" "$2" "$3" structure 2>&1 | head -3; }
runs installgate.js "    planDecision: bayes ? { key: bayes.key," "    plan: bayes ? { key: bayes.key,"
runs watchdog.js "        if (!Number.isFinite(augClaim(claimSrc, claimLife))) unreadable.push" "        if (!isFinite(augClaim(claimSrc, claimLife))) unreadable.push"
runs watchdog.js "          return Number.isFinite(join) &&" "          return isFinite(join) &&"
# the committed plan decides the count batch; count-rule lives are their own regime (BY16, BY15)
run installgate.js "  const countByPlan = !countBySim && exitDecides && !!bayes && bayes.key !== 'never'" "  const countByPlan = false"
run installgate.js "  const countByPlan = !countBySim && exitDecides && !!bayes && bayes.key !== 'never'" "  const countByPlan = !countBySim && exitDecides && !!bayes"
run bayes.js "    else if (l.regime === 'count') b.count++" "    else if (false) b.count++"
# one basis is a trajectory and its inputs (BY17)
run progress.js "          const rp = pcx.graftReprice(spec, pcx.installInputs ?? null)" "          const rp = pcx.graftReprice(spec)"
run progress.js "(gd.basisNoiseKey !== inst.noiseKey || (inst.inputsKey && gd.inputsKey !== inst.inputsKey))" "(gd.basisNoiseKey !== inst.noiseKey)"
run plan.js "  if (sameBasis && install.inputsKey && grafts.inputsKey && install.inputsKey !== grafts.inputsKey) {" "  if (false) {"
# the life's length from what a life buys (BY18)
run lifeplan.js "  const rate = (f) => repPerHour0 * (1 + (state.favor?.[f] ?? 0) / 100)" "  const rate = (f) => repPerHour0"
run lifeplan.js "      if (!h || usedH() + h.extra > L + 1e-9) continue" "      if (!h) continue"
run lifeplan.js "      if (rq > repBest || batchCost([...prices, p]) > money || levels > 200) break" "      if (batchCost([...prices, p]) > money || levels > 200) break"
run plan.js "  if (inputs.cadenceFrom === 'purchase model') {" "  if (false) {"
