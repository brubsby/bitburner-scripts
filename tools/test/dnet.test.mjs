// [DN] BITNODE 15 — "The Secrets of the Dark Net" — played LAST (the user, 2026-10-25: BN8.2 -> BN8.3 ->
// BN15.1). It was ruled out until then, so every piece here guards a place the stack used to exclude it,
// or a mechanic the stack had never met.
//
//   DN1 SOLVERS      dnetplan.solverOf against the game's own generators (DarkNet/controllers/
//                    ServerGenerator.ts) and checkPassword (effects/authentication.ts), the feedback
//                    passed through the log line heartbleed returns (JSON of the response): every
//                    solvable model solves at every difficulty it is generated at — KingOfTheHill too
//                    (the hill climb, >= 92% on the first seed, its AGREEMENT step pinned on its own); an
//                    unknown model is declared unsolvable, never silently looped on
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
//                    watchdog runs dnet-seed.js only where the darknet is reachable (0GB gate); the walker,
//                    rider and farm worker cost what the plan prices them at
//   DN8 AIR GAPS     rows 8/16/24 are the game's gaps; the rider's target can land past the gap (the move
//                    rule read from effects.ts); the crawler starts it at a gap edge
//   DN9 LAB WALK     labViewOf reads the game's move replies; a reply-driven walk ends every lab's maze;
//                    the walker pays no scp/exec per thread; the crawler starts it with its host's threads
//   DN10 LAB INSTALL dnetplan.labInstallOf + installgate's labInstall: a queued lab reward installs on the
//                    lab route only (M = 1 would hold it otherwise); a mandated hold still wins
//   DN11 CHARISMA    chaplan's level/exp/auth-time are the game's (calculateSkill/Exp, calculateAuthenticationTime);
//                    the farm model's calibration (dnetlab.mjs --farm-min: -2.7%) stays inside 10%
//   DN12 BUYING      objective.charismaValue = (withoutH - withH) / hoursPerLn on chaplan's climbs, on the lab
//                    route only; augplan buys a charisma aug there and not elsewhere
//   DN13 THE FARM    dnet-seed.farmStep: workers in home's free RAM above the reserve, on the lab route, stopped
//                    at the lab's charisma x1.02, outside BN15, or with no room (and saying so)
//
// CALIBRATION: none needed for DN1-DN3, DN8-DN9, DN11's ports (both sides are the game's rules); DN11's farm
// carries its measured error; DN4-DN7, DN10, DN12-DN13 are routing / wiring.
import fs from 'node:fs'
import path from 'node:path'
import { Check } from './harness.mjs'
import { REPO_ROOT } from './gameresolve.mjs'
import '../sim/env.mjs'

const g = await import('../sim/game.bundle.mjs')
const dp = await import('../../dnetplan.js')
const cp = await import('../../chaplan.js')
const GAME_SRC = path.resolve(REPO_ROOT, '../bitburner/src')
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')

/** A darknet server as checkPassword reads it (only these fields for the guessable models). */
function serverOf(cfg, difficulty, hostname = 'dn-test') {
  return { hostname, ip: '1.2.3.4', password: cfg.password, modelId: cfg.modelId, staticPasswordHint: cfg.staticPasswordHint, passwordHintData: cfg.passwordHintData ?? '', difficulty, depth: 3, serversOnNetwork: [], maxRam: 16, hasAdminRights: false }
}
const detailsOf = (srv) => ({ modelId: srv.modelId, passwordHint: srv.staticPasswordHint, data: srv.passwordHintData, passwordLength: srv.password.length, passwordFormat: g.DnetGen.getPasswordType(srv.password), difficulty: srv.difficulty })

/** Play a solver against the game; returns {solved, tries, why}. */
export function playSolver(srv, cap = 900, retryNo = 0) {
  const s = dp.solverOf(detailsOf(srv), srv.hostname, retryNo)
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
    // KingOfTheHill (BN15/SF15 only): the hill climb on the altitude, against the game's own generator and
    // getKingOfTheHillAltitude, at every difficulty band (hill counts 1..9, passwords 2..10 digits). The
    // crawler retries a give-up with a new seed (dnet.js solveHost -> solverOf(d, h, retryNo)): 3 seeds.
    {
      const make = g.DnetGen.getKingOfTheHillConfig
      let n = 0
      let sum = 0
      let max = 0
      let first = 0
      for (const d of [3, 8, 16, 24, 32, 40, 54, 60])
        for (let k = 0; k < 15; k++) {
          const cfg = make(d)
          const srv = serverOf(cfg, d)
          let res = null
          let tries = 0
          for (let seed = 0; seed < 3 && !res?.solved; seed++) {
            res = playSolver(srv, 120, seed)
            tries += res.tries
          }
          n++
          c.examined(1)
          if (res.solved && tries === res.tries) first++
          if (!res.solved) c.fail(`KingOfTheHill at difficulty ${d} not solved in 3 seeds: ${res.why}`, `password '${cfg.password}'`)
          else {
            sum += tries
            max = Math.max(max, tries)
          }
        }
      c.note(`KingOfTheHill ${n} servers: ${(sum / n).toFixed(1)} attempts mean, ${max} max, ${first}/${n} on the first seed`)
      // each attempt is an authentication (seconds deep in the net): the climb must be efficient, not just
      // eventually right — measured 2026-10-25: ~10.5 mean, >= 97% on the first seed (without the
      // AGREEMENT step ~70-85% at difficulty 24+)
      if (first < 0.92 * n) c.fail(`KingOfTheHill solved on the first seed ${first}/${n} times (want >= 92%)`)
      if (sum / n > 16) c.fail(`KingOfTheHill takes ${(sum / n).toFixed(1)} attempts on average (want <= 16)`)
    }
    // THE AGREEMENT STEP, pinned on its own (the climb above usually gets there without it, slower): two
    // altitudes read inside the password's clean 3% window, both far below any peak, name P at once
    {
      let cfg = null
      for (let k = 0; k < 500 && !cfg; k++) {
        const x = g.DnetGen.getKingOfTheHillConfig(40)
        if (Number(x.password) >= 0.75 * 10 ** x.password.length) cfg = x // a window >= 2.25w wide each side
      }
      c.examined(1)
      if (!cfg) c.fail('no KingOfTheHill password near the top of its range in 500 draws (the generator changed?)')
      else {
        const srv = serverOf(cfg, 40)
        const P = Number(cfg.password)
        const w = 10 ** Math.max(cfg.password.length - 2, 0) + 1
        const at = (x) => {
          const r = g.dnetCheckPassword(srv, String(x), 1, 0)
          return { guess: String(x), fb: dp.feedbackOf([JSON.stringify(r)], String(x)) }
        }
        const s = dp.solverOf(detailsOf(srv), srv.hostname)
        const next = s.nextGuess([at(Math.round(P + 1.2 * w)), at(Math.round(P - 1.5 * w))])
        if (next !== cfg.password) c.fail(`two clean-window altitudes (P + 1.2w, P - 1.5w) must name P at once: got ${next}, P ${cfg.password}`)
      }
    }
    // a model the solvers do not know must say so (the crawler reports it as `unsolved`)
    const alien = dp.solverOf({ modelId: 'NotAModel', passwordLength: 3, passwordFormat: 'numeric' })
    if (alien.solvable !== false || !/unknown model/.test(alien.why)) c.fail('an unknown model must be declared unsolvable with its reason', JSON.stringify(alien))
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
    if (!(R.LAB15.lo <= R.LAB15.mid && R.LAB15.mid <= R.LAB15.hi && R.LAB15.lo < R.LAB15.hi) || !/DERIVED/.test(R.LAB15.status) || !/NOT CALIBRATED/.test(R.LAB15.status) || !Number.isFinite(R.LAB15.pFail)) c.fail('LAB15 must carry lo <= mid <= hi (lo < hi), its P(fail), say it is DERIVED and name what is NOT CALIBRATED (the transfer of the measured charisma trajectories to BN15)')
    // the leg is lab15.mjs's, not a typed constant: its mid is the mid scenario's legOf
    const L15 = await import('../sim/lab15.mjs')
    if (Math.abs(R.LAB15.mid - +L15.legOf(L15.SCENARIOS.mid).h.toFixed(2)) > 1e-9) c.fail(`LAB15.mid ${R.LAB15.mid} is not lab15.mjs's mid leg`)
    // every lab's crawl is MEASURED (dnetlab.mjs), none a per-row estimate
    for (const [k, v] of Object.entries(L15.CRAWL_MIN)) if (typeof v !== 'number') c.warn(`lab ${k}'s crawl is not measured yet (a per-row estimate prices it)`)
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
    for (const f of ['dnet.js', 'dnetplan.js', 'dnet-seed.js', 'dnet-lab.js', 'dnet-ride.js', 'dnet-cha.js', 'dnet-stasis.js', 'chaplan.js']) if (/w0r1d_d43m0n/.test(code(f))) c.fail(`${f} names w0r1d_d43m0n: only endgame.js paths to it`)
    checks.push(c)
  }

  {
    const c = new Check('DN6', "THE ROUTE: in BN15 the stack acts on the black ops (no Daedalus Red Pill); the priced key survives; the pin wins")
    const rp0 = await import('../../routepin.js')
    // the rule as it binds while the labyrinth route is not built (labReady false); DN14 covers labReady true
    const OFF = { ...rp0.NODE_ROUTE_RULES, 15: { ...rp0.NODE_ROUTE_RULES[15], labReady: false } }
    const rp = { ...rp0, nodeRouteOf: (d, n, p) => rp0.nodeRouteOf(d, n, p, OFF), nodeRuleOf: (n, p) => rp0.nodeRuleOf(n, p, OFF) }
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
    // 3.7GB + the farm's reads (2026-10-25: getResetInfo 1, getPlayer 0.5, kill 0.5, ps 0.2, home RAM 0.1) = 6.0
    if (!(seed <= 6)) c.fail(`dnet-seed.js costs ${seed}GB (budget 6GB on home: the crawl seed + the charisma farm)`)
    const wdc = code('watchdog.js')
    if (!/script: 'dnet-seed\.js'[^\n]*invariant: \(ns\) => hasDarknetAccess\(ns\.getResetInfo\(\)\)/.test(wdc)) c.fail('the watchdog does not run dnet-seed.js gated on sfgate.hasDarknetAccess')
    const sg = await import('../../sfgate.js')
    const info = (node, sf15) => ({ currentNode: node, ownedSF: new Map(sf15 ? [[15, sf15]] : []) })
    if (!sg.hasDarknetAccess(info(15, 0)) || !sg.hasDarknetAccess(info(8, 1)) || sg.hasDarknetAccess(info(8, 0))) c.fail('hasDarknetAccess: BN15 or SF15 only')
    // the helpers each crawler starts on its own host: the walker's threads and the farm's workers are RAM per copy
    const walker = ram.ramOf('dnet-lab.js').cost
    const rider = ram.ramOf('dnet-ride.js').cost
    const farm = ram.ramOf('dnet-cha.js').cost
    c.examined(3)
    c.note(`dnet-lab.js ${walker}GB/thread, dnet-ride.js ${rider}GB/thread, dnet-cha.js ${farm}GB/worker`)
    if (!(walker <= 2.05)) c.fail(`dnet-lab.js costs ${walker}GB a thread: every thread pays it (1.6 + authenticate 0.4 + getHostname; no scp/exec — the crawler opens the cache)`)
    if (farm !== cp.WORKER_GB) c.fail(`dnet-cha.js costs ${farm}GB but chaplan.WORKER_GB says ${cp.WORKER_GB}: the climb's farm is priced on the wrong worker`)
    if (!(rider <= 5.75)) c.fail(`dnet-ride.js costs ${rider}GB a thread (1.6 + induceServerMigration 4 + getDepth/getHostname)`)
    for (const f of [dp.LAB_WALKER, dp.RIDER]) if (!dp.DNET_FILES.includes(f)) c.fail(`${f} is not in DNET_FILES: a crawler's children would not carry it`)
    checks.push(c)
  }

  {
    const c = new Check('DN8', "THE AIR GAPS: rows 8/16/24 are the game's gaps; the rider picks a crawler-carrying neighbour whose migration reaches past the gap")
    if (g.DNET_AIR_GAP !== dp.AIR_GAP) c.fail(`Enums.ts AIR_GAP_DEPTH is ${g.DNET_AIR_GAP}, dnetplan.AIR_GAP ${dp.AIR_GAP}`)
    for (let r = 0; r < 40; r++) {
      c.examined(1)
      const game = !!r && !(r % g.DNET_AIR_GAP) // darknetNetworkUtils.ts isOnAirGap
      if (dp.isAirGap(r) !== game) c.fail(`row ${r}: isAirGap ${dp.isAirGap(r)}, game ${game}`)
      if (dp.gapBelowOf(r) !== ((r + 1) % 8 === 0)) c.fail(`row ${r}: gapBelowOf ${dp.gapBelowOf(r)}, want ${(r + 1) % 8 === 0} (the row above a gap)`)
    }
    // the move rule the rider leans on, read from source (an upstream change must be seen)
    const eff = fs.readFileSync(path.join(GAME_SRC, 'DarkNet/effects/effects.ts'), 'utf8')
    if (!/if \(newCharge >= 1\) \{\s*moveDarknetServer\(server, 2, 4\);/.test(eff)) c.fail('effects.ts chargeServerMigration no longer moves the server within [difficulty - 2, difficulty + 4] — re-read it (riderTargetOf)')
    const mv = fs.readFileSync(path.join(GAME_SRC, 'DarkNet/controllers/NetworkMovement.ts'), 'utf8')
    if (/killServerScripts\(server/.test(mv.slice(mv.indexOf('export const moveDarknetServer'), mv.indexOf('const disconnectRandomServer')))) c.fail('moveDarknetServer now kills the scripts on the moved server: riding a gap no longer carries the crawler')
    // the choice: from row 7, a difficulty-9 carrier reaches 9..13 (5 of its 7 rows past the gap)
    const pick = dp.riderTargetOf([{ host: 'a', diff: 3 }, { host: 'b', diff: 9 }, { host: 'c', diff: 7 }], 7)
    c.examined(3)
    if (pick?.host !== 'b') c.fail(`riderTargetOf picked ${pick?.host}, want b (diff 9)`)
    if (dp.riderTargetOf([{ host: 'a', diff: 3 }], 7) !== null) c.fail('a carrier that cannot reach past row 8 (difficulty 3 -> rows 1..7) must not be picked')
    if (dp.riderTargetOf([], 15) !== null) c.fail('no carriers: null (the crawler reports no-carrier)')
    // the crawler is wired to it
    const dn = code('dnet.js')
    if (!/gapBelowOf\(depth\)/.test(dn) || !/riderTargetOf\(carriers, depth\)/.test(dn) || !/ns\.exec\(RIDER, me/.test(dn)) c.fail('dnet.js does not start the rider at a gap edge')
    checks.push(c)
  }

  {
    const c = new Check('DN9', "THE LAB WALK: labViewOf reads the game's own move replies; the walker walks the game's mazes on them alone")
    const lab = fs.readFileSync(path.join(GAME_SRC, 'DarkNet/effects/labyrinth.ts'), 'utf8')
    for (const re of [/message: `You have moved to \$\{newLocation\[0\]\},\$\{newLocation\[1\]\}\.`/, /You cannot go that way\. You are still at \$\{initialX\},\$\{initialY\}\./]) if (!re.test(lab)) c.fail(`labyrinth.ts no longer replies ${re} — labViewOf parses it`)
    for (const L of dp.LABS.slice(0, 5)) {
      const maze = g.dnetGenerateMaze(L.w, L.h)
      const end = [maze[0].length - 2, maze.length - 2]
      let pos = [1, 1]
      const open = (x, y) => maze[y]?.[x] === ' '
      const st = {}
      let view = { coords: pos, north: open(1, 0), east: open(2, 1), south: open(1, 2), west: open(0, 1) }
      let ok = false
      let steps = 0
      for (; steps < 20000; steps++) {
        const dir = dp.labStep(st, view)
        if (dir === null) break
        const [dx, dy] = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] }[dir]
        const wall = !open(pos[0] + dx, pos[1] + dy)
        if (!wall) pos = [pos[0] + 2 * dx, pos[1] + 2 * dy]
        if (pos[0] === end[0] && pos[1] === end[1]) {
          ok = true
          break
        }
        // the game's reply (handleLabyrinthPassword), rebuilt from its own getSurroundingsVisualized
        const msg = wall ? `You cannot go that way. You are still at ${pos[0]},${pos[1]}.` : `You have moved to ${pos[0]},${pos[1]}.`
        const v = dp.labViewOf(msg, g.dnetSurroundings(maze, pos[0], pos[1], 1, true, false))
        if (!v) {
          c.fail(`${L.name}: labViewOf could not read the reply '${msg}'`)
          break
        }
        if (v.coords[0] !== pos[0] || v.coords[1] !== pos[1]) c.fail(`${L.name}: labViewOf read ${v.coords} at ${pos}`)
        view = v
      }
      c.examined(1)
      if (!ok) c.fail(`${L.name}: the reply-driven walk did not reach the end (${steps} steps)`)
      else c.note(`${L.name}: ${steps + 1} authentications`)
    }
    // the walker is its own script, threaded, with no per-thread scp/exec; the crawler opens the cache
    const w = code('dnet-lab.js')
    if (/ns\.(scp|exec)\(/.test(w.replace(/\/\/[^\n]*/g, ''))) c.fail('dnet-lab.js calls scp/exec: every thread of the walker pays 1.9GB for it')
    if (!/labViewOf\(msg, a\?\.data\)/.test(w)) c.fail('dnet-lab.js does not walk on the authenticate reply (labViewOf)')
    const dn = code('dnet.js')
    if (!/ns\.exec\(LAB_WALKER, me, \{ threads \}, lab\)/.test(dn)) c.fail('dnet.js does not start the walker with its host\'s threads')
    checks.push(c)
  }

  {
    const c = new Check('DN10', 'THE LAB INSTALL: a queued lab reward installs through the gate on the lab route, and only there')
    const ig = await import('../../installgate.js')
    const A = dp.LAB_AUGS
    // M = 1: a lab reward carries little or no hacking multiplier (Wings: charisma/agility/dnet money) — every rate test holds it
    const base = { ageMs: 60e3, M: 1, queued: 1, prev: { ageMs: 30e3, M: 1 }, exp: 1e6, target: 6000 }
    const yes = dp.labInstallOf({ node: 15, labRoute: true, installed: new Set([A[0]]), queued: [A[1]] })
    c.examined(6)
    if (!yes.install || yes.aug !== A[1] || yes.lab !== 2) c.fail('lab 2 cleared (Boots queued, Wings installed): install', JSON.stringify(yes))
    if (dp.labInstallOf({ node: 15, labRoute: false, installed: new Set([A[0]]), queued: [A[1]] }).install) c.fail('off the lab route (labReady false / the black ops): no lab install')
    if (dp.labInstallOf({ node: 8, labRoute: true, installed: new Set(), queued: [A[0]] }).install) c.fail('outside BN15: no lab install')
    if (dp.labInstallOf({ node: 15, labRoute: true, installed: new Set(), queued: [A[1]] }).install) c.fail("a queued aug that is not the current lab's reward is not a lab install")
    if (dp.labInstallOf({ node: 15, labRoute: true, installed: new Set(A.slice(0, 4)), queued: [dp.RED_PILL] }).install) c.fail("The Red Pill (lab 5) is the terminal install's rule, not the lab rule")
    // the gate: M = 1 holds an ordinary batch and installs a queued lab reward
    const held = ig.shouldInstall({ ...base })
    const lab = ig.shouldInstall({ ...base, labInstall: yes })
    if (held.install) c.fail('control: a batch with no multiplier gain (M = 1) must hold', held.why)
    if (!lab.install || !/THE LAB INSTALL/.test(lab.why)) c.fail('the gate must install a queued lab reward (THE LAB INSTALL)', lab.why)
    const mandated = ig.shouldInstall({ ...base, labInstall: yes, binding: { destroyedByInstall: true, mandated: true, why: 'a campaign' } })
    c.examined(3)
    if (mandated.install) c.fail('a mandated hold outranks the lab install (as it does the terminal one)')
    const pg = code('progress.js')
    if (!/labInstall: labInstallOf\(\{/.test(pg)) c.fail('progress.js does not hand the gate labInstallOf')
    checks.push(c)
  }

  {
    const c = new Check('DN11', "THE CHARISMA MODEL: chaplan's level, exp and authentication time are the game's; the farm rate is calibrated")
    for (const m of [1.1, 2.28, 4.5]) for (const lv of [300, 600, 1500, 2500, 3000]) {
      c.examined(1)
      const e = g.calculateExp(lv, m)
      if (Number.isFinite(e) && cp.levelOf(e + 1, m) !== g.calculateSkill(e + 1, m)) c.fail(`levelOf(${e}, ${m}) ${cp.levelOf(e + 1, m)} != game ${g.calculateSkill(e + 1, m)}`)
      if (Number.isFinite(e) && e > 1e3 && Math.abs(cp.expFor(lv, m) - e) / e > 1e-9) c.fail(`expFor(${lv}, ${m}) ${cp.expFor(lv, m)} != game ${e}`)
    }
    const servers = [cp.DARKWEB, { req: 300, diff: 7, depth: 6 }, { req: 3000, diff: 10, depth: 29 }, { req: 2600, diff: 27, depth: 28 }]
    for (const s of servers) for (const cha of [10, 300, 1500, 3001]) for (const threads of [1, 50]) {
      c.examined(1)
      const ours = cp.authTimeMs(s, { cha, int: 157, threads })
      const game = g.dnetAuthTime({ requiredCharismaSkill: s.req, difficulty: s.diff, depth: s.depth, modelId: 'x' }, { skills: { charisma: cha, intelligence: 157 } }, threads)
      if (Math.abs(ours - game) / game > 1e-9) c.fail(`authTimeMs(${JSON.stringify(s)}, cha ${cha}, ${threads}t) ${ours} != game ${game}`)
    }
    // the farm, measured in the game's own darknet (tools/sim/entry/dnetlab.mjs --farm-min 3, 2026-10-25):
    // 40 workers on darkweb, charisma 2 -> 687, 5.82e6 exp in 181 game-seconds vs the model's 5.98e6 (-2.7%)
    const FARM_CAL = { measured: 5816626, model: 5979480, workers: 40, sec: 181 }
    const err = (FARM_CAL.measured - FARM_CAL.model) / FARM_CAL.model
    c.note(`farm calibration: measured/model ${(1 + err).toFixed(3)} (40 workers, 181s, charisma 2 -> 687)`)
    if (Math.abs(err) > 0.1) c.fail(`the farm model is ${(err * 100).toFixed(1)}% off the game's heartbleed (tolerance 10%: the climb hours ride on it)`)
    // the climb is monotone in the multiplier and finite only with a farm
    const h = (m) => cp.climbOf({ target: 3000, mult: m, ramGB: 1024 }).h
    c.examined(3)
    if (!(h(6) < h(5) && h(5) < h(4.6))) c.fail(`climbOf not decreasing in the multiplier: ${h(4.6)}, ${h(5)}, ${h(6)}`)
    if (cp.climbOf({ target: 600, mult: 2.28, ramGB: 0 }).h !== Infinity) c.fail('no farm RAM and no other source: the climb must be Infinity, never 0')
    if (cp.climbOf({ target: 300, mult: 2.28, ramGB: 1024, exp0: 1e9 }).h !== 0) c.fail('already past the target: 0h')
    checks.push(c)
  }

  {
    const c = new Check('DN12', 'CHARISMA-AWARE BUYING: on the lab route a charisma aug is priced by the climbs it shortens (with vs without); elsewhere it is not')
    const ob = await import('../../objective.js')
    const ap = await import('../../augplan.js')
    const player = { mults: { charisma: 2.0727, charisma_exp: 1.29 }, skills: { intelligence: 157 } }
    const ctx = cp.chaLabsCtxOf({ node: 15, labRoute: true, labIndex: 1, player, nodeMult: 1.1, homeGB: 2048, reserveGb: 177, hoursPerLn: 20 })
    const jaw = { name: 'SmartJaw', mults: { charisma: 1.5, charisma_exp: 1.5, company_rep: 1.25 } }
    const v = ob.charismaValue(jaw, ctx)
    c.examined(4)
    if (!(v.ln > 0)) c.fail('SmartJaw on the lab route (lab 2 next) must price above 0', JSON.stringify(v))
    // the value IS the comparison: with - without on the same inputs, through hoursPerLn
    const cmp = cp.chaAugValueOf({ m: 1.5, mx: 1.5, mult: ctx.chaLabs.mult, expMult: ctx.chaLabs.expMult, ramGB: ctx.chaLabs.ramGB, int: 157, labs: ctx.chaLabs.labs })
    if (Math.abs(v.ln - cmp.savedH / 20) > 1e-9) c.fail(`charismaValue ${v.ln} is not (withoutH - withH) / hoursPerLn = ${cmp.savedH / 20}`)
    if (ob.charismaValue(jaw, cp.chaLabsCtxOf({ node: 15, labRoute: false, labIndex: 1, player, nodeMult: 1.1, homeGB: 2048, hoursPerLn: 20 })).ln !== 0) c.fail('off the lab route a charisma aug must price 0')
    if (ob.charismaValue(jaw, cp.chaLabsCtxOf({ node: 14, labRoute: true, labIndex: 1, player, nodeMult: 1, homeGB: 2048, hoursPerLn: 20 })).ln !== 0) c.fail('outside BN15 a charisma aug must price 0')
    const unread = ob.charismaValue(jaw, cp.chaLabsCtxOf({ node: 15, labRoute: true, labIndex: 1, player, nodeMult: 1.1, homeGB: 2048, hoursPerLn: null }))
    c.examined(1)
    if (unread.ln !== 0 || !/unpriced/.test(unread.reason ?? '')) c.fail('an unreadable hoursPerLn must price 0 WITH the reason', JSON.stringify(unread))
    // the planner buys it on the lab route and not without (a two-offer set, money for one)
    const offers = [
      { name: 'SmartJaw', faction: 'Bachman & Associates', baseCost: 2.75e9, repReq: 0, factionRep: 1e9, mults: jaw.mults },
      { name: 'Wired Reflexes', faction: 'Tian Di Hui', baseCost: 2.5e9, repReq: 0, factionRep: 1e9, mults: { agility: 1.05, dexterity: 1.05 } },
    ]
    const plan = (oneoff) => ap.planPurchases({ offers, money: 3e9, owned: [], oneoff })
    const on = plan({ ...ctx })
    const off = plan({})
    c.examined(2)
    if (!(on.buy ?? []).some((b) => b.name === 'SmartJaw')) c.fail('on the lab route the planner must buy SmartJaw', JSON.stringify(on.skipped ?? []).slice(0, 300))
    if ((off.buy ?? []).some((b) => b.name === 'SmartJaw')) c.fail('off the lab route SmartJaw (no hacking value) must not be bought')
    // an augmentation with hacking value AND charisma is worth BOTH on the lab route (augplan's m > 1 branch):
    // against a slightly better pure-hacking one, money for one, the charisma one wins there and only there
    const both = [
      { name: 'Xanipher', faction: 'NWO', baseCost: 4.25e9, repReq: 0, factionRep: 1e9, mults: { hacking: 1.2, charisma: 1.2, charisma_exp: 1.15 } },
      { name: 'Pure Hack', faction: 'NWO', baseCost: 4.2e9, repReq: 0, factionRep: 1e9, mults: { hacking: 1.25 } },
    ]
    const pick = (oneoff) => (ap.planPurchases({ offers: both, money: 4.3e9, owned: [], oneoff }).buy ?? []).map((b) => b.name)
    c.examined(2)
    if (!pick({ ...ctx }).includes('Xanipher')) c.fail('on the lab route a hacking+charisma aug must carry its charisma value too', pick({ ...ctx }).join(','))
    if (!pick({}).includes('Pure Hack')) c.fail('off the lab route the better pure-hacking aug must win', pick({}).join(','))
    const pg = code('progress.js')
    if (!/\? chaLabsCtxOf\(\{/.test(pg)) c.fail("progress.js does not hand the planner the charisma context (oneoffBase)")
    checks.push(c)
  }

  {
    const c = new Check('DN13', "THE FARM: dnet-seed.js grows heartbleed workers into home's FREE RAM above the reserve while charisma is short of the lab, on the lab route only, and stops at the lab")
    const seed = await import('../../dnet-seed.js')
    const fl = await import('../../freshlife.js')
    const sg = await import('../../sfgate.js')
    const mk = ({ node = 15, cha = 100, installed = [], maxRam = 4096, usedRam = 200, workers = 0 }) => {
      const procs = Array.from({ length: workers }, (_, i) => ({ pid: 1000 + i, filename: 'dnet-cha.js' }))
      const ns = {
        killed: [],
        execs: 0,
        getResetInfo: () => ({ currentNode: node, ownedAugs: new Map(installed.map((a) => [a, 1])), ownedSF: new Map([[4, 3]]) }),
        ps: () => procs,
        getPlayer: () => ({ skills: { charisma: cha } }),
        kill: (pid) => ns.killed.push(pid),
        getServerMaxRam: () => maxRam,
        getServerUsedRam: () => usedRam,
        exec: () => ++ns.execs,
      }
      return ns
    }
    const on = { 15: { labReady: true } }
    const off = { 15: { labReady: false } }
    const reserve = fl.homeReserveGb(sg.singularityRamMultiplier({ currentNode: 15, ownedSF: new Map([[4, 3]]) }))
    let ns = mk({})
    let r = seed.farmStep(ns, { farmSeq: 0 }, on)
    c.examined(5)
    const want = Math.min(400, Math.floor((4096 - 200 - reserve) / cp.WORKER_GB))
    if (!r.on || ns.execs !== want) c.fail(`lab 1 short (charisma 100 < 306): ${ns.execs} workers started, want ${want} (free above the ${reserve}GB reserve / ${cp.WORKER_GB}GB)`, JSON.stringify(r))
    ns = mk({ workers: 5 })
    r = seed.farmStep(ns, { farmSeq: 0 }, off)
    if (r.on || ns.killed.length !== 5 || ns.execs) c.fail('the route rule off (labReady false): the farm must stop and start nothing', JSON.stringify(r))
    ns = mk({ cha: 700, installed: [dp.LAB_AUGS[0]], workers: 3 })
    r = seed.farmStep(ns, { farmSeq: 0 }, on)
    if (r.on || ns.killed.length !== 3 || r.need !== 612) c.fail('charisma 700 past lab 2 (600 x 1.02 = 612): the farm must stop', JSON.stringify(r))
    ns = mk({ node: 14, workers: 2 })
    r = seed.farmStep(ns, { farmSeq: 0 }, on)
    if (r.on || ns.killed.length !== 2) c.fail('outside BN15 the farm must stop', JSON.stringify(r))
    ns = mk({ usedRam: 4090 })
    r = seed.farmStep(ns, { farmSeq: 0 }, on)
    if (!r.on || ns.execs !== 0 || !/no free home RAM/.test(r.why ?? '')) c.fail('no free RAM above the reserve: no worker, and it says so', JSON.stringify(r))
    checks.push(c)
  }

  return checks
}
