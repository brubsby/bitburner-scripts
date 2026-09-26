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
