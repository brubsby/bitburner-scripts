// Time each darknet solver against the game's generator (debug aid for tools/test/dnet.test.mjs DN1).
//   node tools/staging/dnet-solvers.mjs [generatorName] [difficulty]
import '../test/gameresolve.mjs'
import '../sim/env.mjs'
const g = await import('../sim/game.bundle.mjs')
const dp = await import('../../dnetplan.js')
const [only, dOnly] = process.argv.slice(2)
const fns = Object.keys(g.DnetGen).filter((k) => /^get.*Config$/.test(k) && (!only || k === only))
for (const fn of fns) {
  for (const d of dOnly ? [Number(dOnly)] : [1, 5, 10, 20, 40]) {
    const t0 = performance.now()
    let worst = 0
    let fails = 0
    for (let k = 0; k < Number(process.env.REPS ?? 5); k++) {
      let cfg
      try {
        cfg = g.DnetGen[fn](d)
      } catch (e) {
        console.log(fn, d, 'gen threw', String(e).slice(0, 80))
        break
      }
      const srv = { hostname: 'dn-test', password: cfg.password, modelId: cfg.modelId, staticPasswordHint: cfg.staticPasswordHint, passwordHintData: cfg.passwordHintData ?? '', difficulty: d, serversOnNetwork: [], maxRam: 16 }
      const det = { modelId: srv.modelId, passwordHint: srv.staticPasswordHint, data: srv.passwordHintData, passwordLength: srv.password.length, passwordFormat: g.DnetGen.getPasswordType(srv.password), difficulty: d }
      const s = dp.solverOf(det, 'dn-test')
      if (!s.solvable) {
        console.log(fn, d, 'unsolvable:', s.why)
        break
      }
      const hist = []
      let ok = false
      let i = 0
      for (; i < 900; i++) {
        const guess = s.nextGuess(hist)
        if (guess === null) break
        let r
        try {
          r = g.dnetCheckPassword(srv, guess, 1, 0)
        } catch (e) {
          console.log(fn, d, 'check threw', String(e).slice(0, 100))
          break
        }
        if (r.code === 200) {
          ok = true
          break
        }
        hist.push({ guess, fb: s.feedback ? dp.feedbackOf([JSON.stringify(r)], guess) : null })
      }
      worst = Math.max(worst, i + 1)
      if (!ok) {
        fails++
        console.log(`  FAIL ${fn}(${d}) pw '${cfg.password}' data '${cfg.passwordHintData ?? ''}' last '${hist.at(-1)?.guess}' fb ${JSON.stringify(hist.at(-1)?.fb)}`)
      }
    }
    console.log(`${fn}(${d}): worst ${worst} tries, ${fails} fails, ${(performance.now() - t0).toFixed(0)}ms`)
  }
}
