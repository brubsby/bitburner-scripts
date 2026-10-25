// [DN] BITNODE 15 — "The Secrets of the Dark Net" — played LAST (the user, 2026-10-25: BN8.2 -> BN8.3 ->
// BN15.1). It was ruled out until then, so every piece here guards a place the stack used to exclude it,
// or a mechanic the stack had never met.
//
//   DN1 SOLVERS      dnetplan.solverOf against the game's own generators (DarkNet/controllers/
//                    ServerGenerator.ts) and checkPassword (effects/authentication.ts), the feedback
//                    passed through the log line heartbleed returns (JSON of the response): every
//                    solvable model solves at every difficulty it is generated at; KingOfTheHill is
//                    declared unsolvable, never silently looped on
//   DN2 THE LABS     dnetplan.LABS = the game's labData (names, depth, charisma, maze size); labOf puts
//                    The Red Pill in BN15's 5th lab and the 7th elsewhere (labyrinth.ts:404-427, read here)
//   DN3 THE MAZE     labStep walks the game's generateMaze to its end for every lab size
//   DN4 THE PLANNER  BN15 is a lattice node, owed once (SF15 target 1), LAST: no order puts it before
//                    another owed clear (solveDP = brute force under the rule, bestPath, firstMoves);
//                    the 'lab' route prices BN15, the Daedalus 'hack'/'stanek' routes do not apply there
//   DN5 THE EXIT     watchdog.nextNodeArgsOf passes --next 15 from the plan (it capped at 14); endgame.js
//                    refuses a maxed BN15 like any node; only endgame.js destroys a node
//   DN6 THE ROUTE    routepin.nodeRouteOf: in BN15 the stack acts on the black ops whatever 'hack' prices
//                    at (the entry dry-run priced hack 20h vs blade 139h on a Daedalus Red Pill that does
//                    not exist there); the priced key survives for the commitment rule; /route-pin.txt wins;
//                    the health check does not call the rule a stray pin; progress.js is wired to it
//   DN7 RAM / WIRING dnet.js fits a darknet server (16GB less its 2GB block) and darkweb's 16GB; the
//                    watchdog runs dnet-seed.js only where the darknet is reachable (0GB gate)
//
// CALIBRATION: none needed for DN1-DN3 (both sides are the game's rules); DN4-DN7 are routing.
import fs from 'node:fs'
import path from 'node:path'
import { Check } from './harness.mjs'
import { REPO_ROOT } from './gameresolve.mjs'
import '../sim/env.mjs'

const g = await import('../sim/game.bundle.mjs')
const dp = await import('../../dnetplan.js')
const GAME_SRC = path.resolve(REPO_ROOT, '../bitburner/src')
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')

/** A darknet server as checkPassword reads it (only these fields for the guessable models). */
function serverOf(cfg, difficulty, hostname = 'dn-test') {
  return { hostname, ip: '1.2.3.4', password: cfg.password, modelId: cfg.modelId, staticPasswordHint: cfg.staticPasswordHint, passwordHintData: cfg.passwordHintData ?? '', difficulty, depth: 3, serversOnNetwork: [], maxRam: 16, hasAdminRights: false }
}
const detailsOf = (srv) => ({ modelId: srv.modelId, passwordHint: srv.staticPasswordHint, data: srv.passwordHintData, passwordLength: srv.password.length, passwordFormat: g.DnetGen.getPasswordType(srv.password), difficulty: srv.difficulty })

/** Play a solver against the game; returns {solved, tries, why}. */
export function playSolver(srv, cap = 900) {
  const s = dp.solverOf(detailsOf(srv), srv.hostname)
  if (!s.solvable) return { solved: false, tries: 0, why: s.why, unsolvable: true }
  const hist = []
  for (let i = 0; i < cap; i++) {
    const guess = s.nextGuess(hist)
    if (guess === null) return { solved: false, tries: i, why: `gave up: ${s.why}` }
    const r = g.dnetCheckPassword(srv, guess, 1, 0)
    if (r.code === 200) return { solved: true, tries: i + 1 }
    const line = JSON.stringify(r)
    hist.push({ guess, fb: s.feedback ? dp.feedbackOf([line], guess) : null })
  }
  return { solved: false, tries: cap, why: 'cap' }
}

const GEN = () => [
  ['getNoPasswordConfig', [0, 1]],
  ['getEchoVulnConfig', [1, 2]],
  ['getDefaultPasswordConfig', [1, 2]],
  ['getCaptchaConfig', [1, 2, 4, 8]],
  ['getDogNameConfig', [3, 6]],
  ['getYesn_tConfig', [3, 8, 12, 18]],
  ['getBufferOverflowConfig', [3, 10]],
  ['getSortedEchoVulnConfig', [1, 5, 12, 20, 30, 45]],
  ['getMastermindHintConfig', [5, 10, 17, 25, 40]],
  ['getRomanNumeralConfig', [3, 7, 9, 20, 40]],
  ['getGuessNumberConfig', [3, 10, 30, 50]],
  ['getConvertToBase10Config', [3, 10, 13, 30]],
  ['getDivisibilityTestConfig', [5, 12, 13, 25, 40]],
  ['getPacketSnifferConfig', [3, 10, 16, 20, 40]],
  ['getSpiceLevelConfig', [5, 9, 20]],
  ['getLargestPrimeFactorConfig', [10, 20, 40]],
  ['getLargeDictionaryConfig', [10, 30]],
  ['getEuCountryDictionaryConfig', [10, 30]],
  ['getTimingAttackConfig', [10, 17, 30]],
  ['getBinaryEncodedConfig', [10, 30]],
  ['getParseArithmeticExpressionConfig', [10, 13, 17, 21, 30]],
  ['getXorMaskEncryptedPasswordConfig', [10, 30]],
  ['getTripleModuloConfig', [10, 30, 50]],
]

export async function run() {
  const checks = []

  {
    const c = new Check('DN1', "SOLVERS: dnetplan.solverOf solves every generated model through the game's checkPassword and log-line feedback")
    const stats = {}
    for (const [fn, diffs] of GEN()) {
      const make = g.DnetGen[fn]
      if (typeof make !== 'function') {
        c.fail(`the game no longer exports ${fn}`, 'ServerGenerator.ts changed: re-read it and the solver')
        continue
      }
      for (const d of diffs)
        for (let k = 0; k < 12; k++) {
          let cfg
          let srv
          let res
          try {
            cfg = make(d)
            srv = serverOf(cfg, d)
            res = playSolver(srv)
          } catch (e) {
            // capturePackets can reach the live network (packetSniffing.ts getRandomData): not a solver fault
            if (fn === 'getPacketSnifferConfig') continue
            c.fail(`${fn}(${d}) threw`, String(e?.stack ?? e).slice(0, 300))
            continue
          }
          c.examined(1)
          const st = (stats[cfg.modelId] ??= { n: 0, max: 0, sum: 0 })
          st.n++
          st.sum += res.tries
          st.max = Math.max(st.max, res.tries)
          if (!res.solved) c.fail(`${cfg.modelId} at difficulty ${d} not solved: ${res.why}`, `password '${cfg.password}' hint '${cfg.staticPasswordHint}' data '${cfg.passwordHintData ?? ''}'`)
        }
    }
    // the one model left unsolved must say so (the crawler reports it as `unsolved`)
    const koth = dp.solverOf({ modelId: 'KingOfTheHill', passwordLength: 3, passwordFormat: 'numeric' })
    if (koth.solvable !== false || !/not solved/.test(koth.why)) c.fail('KingOfTheHill must be declared unsolvable with its reason', JSON.stringify(koth))
    // every model the game defines is either solved here or named unsolved
    for (const id of Object.values(g.DnetModelIds)) {
      if (!Object.values(dp.MODEL).includes(id)) c.fail(`the game defines model '${id}' that dnetplan.MODEL does not name`, 'Enums.ts ModelIds grew: add a solver or an explicit unsolved entry')
    }
    c.note(Object.entries(stats).map(([m, s]) => `${m} ${(s.sum / s.n).toFixed(1)}/${s.max}`).join(', ') + ' (mean/max attempts)')
    checks.push(c)
  }

  {
    const c = new Check('DN2', "THE LABS: dnetplan.LABS is the game's labData, and The Red Pill is BN15's 5th lab (the 7th elsewhere)")
    for (const L of dp.LABS) {
      const G = g.labData[L.name]
      c.examined(1)
      if (!G) c.fail(`lab ${L.name} is not in the game's labData`)
      else if (G.depth !== L.depth || G.cha !== L.cha || G.mazeWidth !== L.w || G.mazeHeight !== L.h) c.fail(`lab ${L.name} differs from the game`, JSON.stringify({ ours: L, game: G }))
    }
    if (Object.keys(g.labData).length !== dp.LABS.length) c.fail(`the game has ${Object.keys(g.labData).length} labs, dnetplan ${dp.LABS.length}`)
    // the rule itself, read from the source so an upstream change is seen
    const lab = fs.readFileSync(path.join(GAME_SRC, 'DarkNet/effects/labyrinth.ts'), 'utf8')
    if (!/Player\.bitNodeN === 15 && nextAug === AugmentationName\.TheLaw && !hasAugment\(AugmentationName\.TheRedPill\)/.test(lab)) c.fail("labyrinth.ts no longer puts The Red Pill in BN15's 5th lab — re-read getLabAugReward")
    const fh = fs.readFileSync(path.join(GAME_SRC, 'Faction/FactionHelpers.tsx'), 'utf8')
    if (!/Player\.bitNodeN === 15 && faction\.name == FactionName\.Daedalus/.test(fh)) c.fail('FactionHelpers.tsx no longer removes The Red Pill from Daedalus in BN15 — the node route rule (routepin.NODE_ROUTE_RULES) rests on it')
    const A = dp.LAB_AUGS
    const set = (...xs) => new Set(xs)
    const cases = [
      [set(), 15, 0, A[0], 5],
      [set(A[0], A[1], A[2]), 15, 3, A[3], 2],
      [set(A[0], A[1], A[2], A[3]), 15, 4, dp.RED_PILL, 1],
      [set(A[0], A[1], A[2], A[3], dp.RED_PILL), 15, 5, A[4], 0],
      [set(A[0], A[1], A[2], A[3]), 8, 4, A[4], 3],
      [set(...A), 8, 6, dp.RED_PILL, 1],
      [set(...A), 12, 7, 'NeuroFlux Governor', null, 0],
    ]
    for (const [inst, node, idx, reward, toTrp, trp = 1] of cases) {
      c.examined(1)
      const r = dp.labOf(inst, node, trp)
      if (r.index !== idx || r.reward !== reward || r.labsToRedPill !== toTrp) c.fail(`labOf(${[...inst].length} installed, BN${node}) = ${JSON.stringify({ i: r.index, reward: r.reward, toTrp: r.labsToRedPill })}`, `want index ${idx}, reward ${reward}, labs to TRP ${toTrp}`)
    }
    checks.push(c)
  }

  {
    const c = new Check('DN3', "THE MAZE: labStep walks the game's generateMaze to its end at every lab size")
    for (const L of dp.LABS.slice(0, 5)) {
      for (let k = 0; k < 3; k++) {
        const maze = g.dnetGenerateMaze(L.w, L.h)
        // the game's ends (labyrinth.ts getLabMaze / getPositionInLab): offset by 0/2/4 cells where the lab says so
        const off = () => (g.labData[L.name].offsetStartAndEnd ? Math.floor(Math.random() * 3) * 2 : 0)
        const end = [maze[0].length - 2 - off(), maze.length - 2 - off()]
        let pos = [1 + off(), 1 + off()]
        const st = {}
        let steps = 0
        let ok = false
        const open = (x, y) => maze[y]?.[x] === ' '
        for (; steps < 20000; steps++) {
          const [x, y] = pos
          const rep = { coords: [x, y], north: open(x, y - 1), east: open(x + 1, y), south: open(x, y + 1), west: open(x - 1, y) }
          const dir = dp.labStep(st, rep)
          if (dir === null) break
          const [dx, dy] = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] }[dir]
          if (!open(x + dx, y + dy)) {
            c.fail(`${L.name}: labStep walked into a wall at ${x},${y} going ${dir}`)
            break
          }
          pos = [x + 2 * dx, y + 2 * dy]
          if (pos[0] === end[0] && pos[1] === end[1]) {
            ok = true
            break
          }
        }
        c.examined(1)
        if (!ok) c.fail(`${L.name} (${L.w}x${L.h}): the walk did not reach the end in ${steps} steps`)
        else if (k === 0) c.note(`${L.name} ${L.w}x${L.h}: ${steps + 1} moves`)
      }
    }
    checks.push(c)
  }

  {
    const c = new Check('DN4', 'THE PLANNER: BN15 is owed once and LAST; the lab route prices it, the Daedalus routes do not')
    const S = await import('../sim/gameplan/state.mjs')
    const Q = await import('../sim/gameplan/search.mjs')
    const R = await import('../sim/gameplan/routes.mjs')
    if (!S.NODES.includes(15)) c.fail('state.NODES does not include 15')
    if (S.targetOf(15) !== 1) c.fail(`SF15's default target is ${S.targetOf(15)}, the user's decision is 1 (BN15.1)`)
    // the live vector at BN8.2 (2026-10-25): every SF at 3 but SF8.1, SF12.1
    const live = S.makeState([[1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 1], [9, 3], [10, 3], [11, 3], [12, 1], [13, 3], [14, 3]])
    if (S.owed(live).join(',') !== '8,8,15') c.fail(`owed from BN8.1's vector: ${S.owed(live).join(',')}, want 8,8,15`)
    // a table where BN15 is the cheapest clear by far: the LAST rule must still put it at the end
    // every SF at its target except SF8.1 and SF3.2: owed 3, 8, 8, 15 (a small lattice brute force can enumerate)
    const done = (over) => S.makeState(S.NODES.map((n) => [n, n === 12 ? 1 : n === 15 ? 0 : 3]).map(([n, l]) => [n, over[n] ?? l]))
    const start = done({ 8: 1, 3: 2 })
    const L = S.lattice(start)
    // ...and SF15 makes BN8 cheaper (a state-dependent table): the unconstrained optimum would play BN15 FIRST,
    // so a solveDP that ignored the rule would price below brute force under it
    const T = Q.buildTable(L, (n, lv) => (n === 15 ? 1 : n === 8 ? (lv(15) > 0 ? 5 : 30) : 20), (n) => n === 15)
    const V = Q.solveDP(L, T)
    const bf = Q.bruteForce(L, T)
    const path0 = Q.bestPath(L, T, V)
    c.examined(3)
    if (Math.abs(V[0] - bf.T) > 1e-9) c.fail(`solveDP ${V[0]} != brute force ${bf.T} under the LAST rule`)
    if (path0.at(-1)?.n !== 15 || path0.findIndex((s) => s.n === 15) !== path0.length - 1) c.fail(`the best path does not end with BN15: ${path0.map((s) => s.n).join(',')}`)
    if (bf.seq.at(-1) !== 15) c.fail(`brute force does not end with BN15: ${bf.seq.join(',')}`)
    const fm = Q.firstMoves(L, T, V)
    const f15 = fm.find((x) => x.n === 15)
    if (!f15) c.fail('BN15 is not owed on the lattice (the old exclusion is back)')
    else {
      if (isFinite(f15.T)) c.fail('BN15 as the FIRST move must be infeasible (Infinity) while other clears are owed')
      if (isFinite(Q.evalOrder(L, T, [15, 3, 8, 8]).T)) c.fail('an order with BN15 first must cost Infinity')
      for (const first of [3, 8]) if (Q.localSearch(L, T, first).seq.at(-1) !== 15) c.fail(`localSearch from BN${first} does not end with BN15`)
    }
    // --sf15 3: three clears, all after everything else
    S.setSf15Target(3)
    try {
      const L3 = S.lattice(done({ 8: 2 }))
      const T3 = Q.buildTable(L3, (n) => (n === 15 ? 1 : 50), () => false)
      const p3 = Q.bestPath(L3, T3, Q.solveDP(L3, T3)).map((s) => s.n).join(',')
      if (p3 !== '8,15,15,15') c.fail(`--sf15 3 from SF8.2: path ${p3}, want 8,15,15,15`)
    } finally {
      S.setSf15Target(1)
    }
    // the routes: no Daedalus Red Pill in BN15
    const lv = () => 3
    const world = { phase1: false }
    const by = Object.fromEntries(R.ROUTES.map((r) => [r.id, r]))
    if (by.hack.applies(15, lv, world)) c.fail("the 'hack' route applies to BN15 — it prices a Daedalus Red Pill that BN15 does not sell")
    if (!by.lab?.applies(15, lv, { ...world, lab15Ready: true })) c.fail("no 'lab' route for BN15 (plan.mjs --lab15-ready)")
    // the planner prices only what the stack can play: the lab route waits for routepin's labReady
    const rp0 = await import('../../routepin.js')
    if (!!by.lab?.applies(15, lv, world) !== (rp0.NODE_ROUTE_RULES[15]?.labReady === true)) c.fail("the 'lab' route's availability must follow routepin.NODE_ROUTE_RULES[15].labReady")
    if (by.lab?.applies(14, lv, world)) c.fail("the 'lab' route must be BN15's alone")
    if (by.stanek.applies(15, lv, { ...world, stanekOff: false })) c.fail("the 'stanek' route (hacking + gift) applies to BN15")
    if (!(R.LAB15.lo < R.LAB15.mid && R.LAB15.mid < R.LAB15.hi) || !/ASSUMED/.test(R.LAB15.status)) c.fail('LAB15 must carry lo < mid < hi and say it is ASSUMED')
    checks.push(c)
  }

  {
    const c = new Check('DN5', 'THE EXIT: the watchdog passes --next 15 from the plan; endgame.js refuses a maxed BN15; one actor destroys')
    const wd = await import('../../watchdog.js')
    const nsOf = (rec, node, lvl) => ({ read: () => JSON.stringify(rec), getResetInfo: () => ({ currentNode: node, ownedSF: new Map([[node, lvl]]) }) })
    const fb = ['--next', 8]
    const cases = [
      [{ next: 15, from: 8, fromSF: 2 }, 8, 2, ['--next', 15]],
      [{ next: 16, from: 8, fromSF: 2 }, 8, 2, fb],
      [{ next: 15, from: 8, fromSF: 1 }, 8, 2, fb],
      [{ next: 8, from: 8, fromSF: 1 }, 8, 1, ['--next', 8]],
    ]
    for (const [rec, node, lvl, want] of cases) {
      c.examined(1)
      const got = wd.nextNodeArgsOf(nsOf(rec, node, lvl), fb)
      if (JSON.stringify(got) !== JSON.stringify(want)) c.fail(`nextNodeArgsOf(${JSON.stringify(rec)}) in BN${node}.${lvl} = ${JSON.stringify(got)}`, `want ${JSON.stringify(want)}`)
    }
    if (wd.NEXT_NODE_MAX !== 15) c.fail(`NEXT_NODE_MAX ${wd.NEXT_NODE_MAX}, want 15`)
    const eg = code('endgame.js')
    if (!/after >= 3 \? after : null/.test(eg) || !/n === 12\) return null/.test(eg)) c.fail('endgame.js lost its replay guard (a maxed node — BN15.3 included — is refused)')
    if (/<= ?14/.test(eg)) c.fail('endgame.js caps the next node at 14')
    if (!/currentNode === 15/.test(eg)) c.fail("endgame.js does not say where BN15's Red Pill comes from (the labyrinth, not Daedalus)")
    // the only destroyer
    const callers = fs.readdirSync(REPO_ROOT).filter((f) => f.endsWith('.js') && /destroyW0r1dD43m0n\s*\(/.test(code(f).replace(/\/\/[^\n]*/g, '')))
    if (callers.join(',') !== 'endgame.js') c.fail(`destroyW0r1dD43m0n is called by ${callers.join(', ')}`)
    if (/w0r1d_d43m0n/.test(code('dnet.js') + code('dnetplan.js') + code('dnet-seed.js'))) c.fail('the darknet scripts name w0r1d_d43m0n')
    checks.push(c)
  }

  {
    const c = new Check('DN6', "THE ROUTE: in BN15 the stack acts on the black ops (no Daedalus Red Pill); the priced key survives; the pin wins")
    const rp = await import('../../routepin.js')
    // the BN15.1 entry dry-run's decision (2026-10-25): hack 20.016h, blade 139.273h -> 'hack'
    const d = { key: 'hack', hackH: 20.016, bladeH: 139.273, why: 'priced' }
    const none = rp.routePinOf('', 15)
    const acted = rp.nodeRouteOf(rp.pinnedRouteOf(d, none), 15, none)
    c.examined(5)
    if (acted.key !== 'blade' || acted.nodeRule?.forced !== true || acted.nodeRule.pricedKey !== 'hack') c.fail('BN15: the acted key must be blade, forced, priced hack', JSON.stringify(acted).slice(0, 300))
    if (rp.unpinnedOf(acted).key !== 'hack') c.fail('unpinnedOf must hand the commitment rule the PRICED key (hack)')
    const rep = rp.routeReportOf(none, acted)
    if (rep.route !== 'blade' || rep.priced !== 'hack' || rep.nodeRule?.forced !== true) c.fail('routeReportOf must publish route blade, priced hack, the node rule', JSON.stringify(rep))
    if (rp.routeHealthOf({ route: { ...rep, node: 15 }, node: 15 }).some((p) => p.key === 'ROUTE NOT THE PRICED ONE')) c.fail('the health check calls the node rule a stray pin')
    // a stray difference (no rule) still fails the health check
    if (!rp.routeHealthOf({ route: { route: 'blade', priced: 'hack', pinned: false, node: 15 }, node: 15 }).some((p) => p.key === 'ROUTE NOT THE PRICED ONE')) c.fail('a route differing from the priced one with no rule must still fail ROUTE NOT THE PRICED ONE')
    const pin = rp.routePinOf('hack', 15)
    const pinned = rp.nodeRouteOf(rp.pinnedRouteOf({ key: 'blade', hackH: 20, bladeH: 139 }, pin), 15, pin)
    if (pinned.key !== 'hack') c.fail('/route-pin.txt hack must win over the node rule (the user\'s word)')
    for (const n of [1, 8, 14]) if (rp.nodeRouteOf(d, n, none) !== d) c.fail(`the node rule touches BN${n}`)
    if (rp.nodeRouteOf({ key: 'blade' }, 15, none).nodeRule?.forced !== false) c.fail('BN15 priced blade: the rule records itself, not forced')
    const pg = code('progress.js')
    if (!/nodeRouteOf\(pinnedRouteOf\(priced, pin\), info\.currentNode, pin\)/.test(pg)) c.fail('progress.js does not act on nodeRouteOf(pinnedRouteOf(priced, pin), …)')
    if ((pg.match(/nodeRouteOf\(/g) ?? []).length < 2) c.fail("progress.js's throw path does not apply the node rule (a throw would default to the hacking route in BN15)")
    checks.push(c)
  }

  {
    const c = new Check('DN7', "RAM / WIRING: dnet.js fits a darknet server and darkweb; the watchdog gates dnet-seed.js on darknet access")
    const ram = await import('./ram.mjs')
    await ram.load()
    ram.asSave({ bitNode: 15, sf: {} })
    const crawler = ram.ramOf('dnet.js').cost
    const seed = ram.ramOf('dnet-seed.js').cost
    c.examined(2)
    c.note(`dnet.js ${crawler}GB per copy, dnet-seed.js ${seed}GB on home`)
    // a 16GB darknet server blocks at most 2GB (ramblock.ts getRamBlock); darkweb has 16GB, no block
    if (!(crawler <= 14)) c.fail(`dnet.js costs ${crawler}GB: it no longer fits a 16GB darknet server with its 2GB block`)
    if (!(seed <= 4)) c.fail(`dnet-seed.js costs ${seed}GB (budget 4GB on home)`)
    const wdc = code('watchdog.js')
    if (!/script: 'dnet-seed\.js'[^\n]*invariant: \(ns\) => hasDarknetAccess\(ns\.getResetInfo\(\)\)/.test(wdc)) c.fail('the watchdog does not run dnet-seed.js gated on sfgate.hasDarknetAccess')
    const sg = await import('../../sfgate.js')
    const info = (node, sf15) => ({ currentNode: node, ownedSF: new Map(sf15 ? [[15, sf15]] : []) })
    if (!sg.hasDarknetAccess(info(15, 0)) || !sg.hasDarknetAccess(info(8, 1)) || sg.hasDarknetAccess(info(8, 0))) c.fail('hasDarknetAccess: BN15 or SF15 only')
    checks.push(c)
  }

  return checks
}
