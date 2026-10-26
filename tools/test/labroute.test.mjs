// [LR] BITNODE 15's LABYRINTH ROUTE AS A PRICED ARM (labroute.js, labtraj.js, chaplan.labScheduleOf,
// plan.decideBladeRouteGen `lab`, tools/sim/chatraj.mjs, tools/sim/lab15.mjs) — the two conditions that kept
// routepin NODE_ROUTE_RULES[15].labReady false: the charisma climb priced end to end, and an exit with a lab arm
// that falls back to the black ops.
//
//   LR1 THE TRAJECTORY   labtraj.js is chatraj.mjs's: its band, labs' due fractions, final window and leg
//                        quantiles reproduce from its own clears (a hand edit or a stale regeneration fails);
//                        products are monotone, farm RAM capped
//   LR2 THE BASE         labroute.sfChaMultOf = the game's applySourceFile charisma for every SF1/2/3 level
//   LR3 THE SCHEDULE     chaplan.labScheduleOf: labs in lives where the climb fits, a forced install per lab
//                        1-4, a hold past the last pre-final life, a FAIL past the cap with its detection time;
//                        from / exp0 price from a live state; the farm stops at FARM_MAX workers (dnet-seed's)
//   LR4 THE FALLBACK     plan.decideBladeRouteGen `lab`: the 'hack' option is the lab arm; on a stalled
//                        climb (no further growth) a failed trajectory is priced as the black ops from the
//                        stall and the decision moves to 'blade' — both by the point and through the draws;
//                        a held climb is bounded by the same fallback; the stall moving re-decides a held route
//   LR5 THE STALL        labroute.labStallOf: the multiplier under the band's q10 (beyond its tolerance), a lab
//                        past the clears' q75 due fraction (beyond its slack); on the trajectory: not stalled
//   LR6 THE HEALTH CHECK LAB CLIMB STALLED from the SAVE (charisma level/exp, the lab augmentations): fires on a
//                        stalled save, an unpriced arm, a lab index the planner read differently; silent on a
//                        healthy one and off the lab route
//   LR7 THE WIRING       progress.js builds the arm pair and hands it to the decision (`lab:`), falls back to the
//                        black ops' rule when it cannot; the farm stops when the acted route is 'blade'
//   LR8 THE PRICE        lab15.mjs (routes.mjs LAB15) is the measured trajectories' leg, not an assumed column;
//                        the live arm at the BN15.1 entry state prices the lab route under the black ops
//   LR9 THE FLAG         labReady true lifts the rule (both arms priced); false binds it; the pin wins
//
// CALIBRATION: the climb is chaplan's (DN11, -2.7% against the game); the trajectories are measured
// (labtraj.js); the transfer to BN15 is NOT CALIBRATED (stated in chatraj.mjs and lab15.mjs).
import fs from 'node:fs'
import path from 'node:path'
import { Check } from './harness.mjs'
import { REPO_ROOT } from './gameresolve.mjs'

const L = await import('labroute.js')
const CP = await import('chaplan.js')
const P = await import('plan.js')
const BB = await import('bbplan.js')
const { LAB_TRAJ } = await import('labtraj.js')

const drain = (g) => {
  let r = g.next()
  while (!r.done) r = g.next()
  return r.value
}
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')

export async function run() {
  const out = []

  {
    const c = new Check('LR1', "THE TRAJECTORY: labtraj.js reproduces from its own measured clears (band, labs due, final window, leg quantiles)")
    const CT = await import('../sim/chatraj.mjs')
    const sum = CT.summarize(LAB_TRAJ.clears)
    c.examined(LAB_TRAJ.clears.length)
    if (!(LAB_TRAJ.clears.length >= 8)) c.fail(`labtraj.js carries ${LAB_TRAJ.clears.length} clears: regenerate with chatraj.mjs --write`)
    if (JSON.stringify(sum.band) !== JSON.stringify(LAB_TRAJ.band)) c.fail('the band is not the clears\' (chatraj.mjs --write was not re-run, or labtraj.js was edited by hand)')
    if (JSON.stringify(sum.labDue) !== JSON.stringify(LAB_TRAJ.labDue)) c.fail("the labs' due fractions are not the clears'")
    if (sum.finalFrac !== LAB_TRAJ.finalFrac) c.fail(`finalFrac ${LAB_TRAJ.finalFrac} vs the clears' ${sum.finalFrac}`)
    if (Math.abs(sum.leg.mid - LAB_TRAJ.leg.mid) > 1e-3) c.fail(`leg mid ${LAB_TRAJ.leg.mid} vs the clears' ${sum.leg.mid}`)
    for (const t of LAB_TRAJ.clears) {
      for (let i = 1; i < t.lives.length; i++) if (t.lives[i][2] < t.lives[i - 1][2]) c.fail(`BN${t.bn} ${t.at}: the product falls at life ${i} (${t.lives[i - 1][2]} -> ${t.lives[i][2]}): never monotone`)
      if (t.lives.some((l) => l[3] > CP.FARM_MAX_GB)) c.fail(`BN${t.bn} ${t.at}: a life's farm RAM over FARM_MAX_GB`)
    }
    c.note(`${LAB_TRAJ.n} clears (${LAB_TRAJ.measuredAt}); leg lo/mid/hi ${LAB_TRAJ.leg.lo}/${LAB_TRAJ.leg.mid}/${LAB_TRAJ.leg.hi}h; ${LAB_TRAJ.fails} fail; band q50 at 0.9: ${L.bandAt(0.9).q50}`)
    out.push(c)
  }

  {
    const c = new Check('LR2', "THE BASE: sfChaMultOf is the game's applySourceFile charisma at every SF1/2/3 level")
    const { sfMults } = await import('../sim/nodechoice/hackexit.mjs')
    for (const sf of [[], [[1, 1]], [[1, 3], [2, 3], [3, 3]], [[2, 2], [3, 1]], [[1, 2], [5, 3], [3, 2]]]) {
      c.examined(1)
      const want = sfMults(sf).charisma
      const got = L.sfChaMultOf(sf)
      if (Math.abs(got / want - 1) > 1e-9) c.fail(`SFs ${JSON.stringify(sf)}: ${got} vs the game's ${want}`)
    }
    out.push(c)
  }

  {
    const c = new Check('LR3', 'THE SCHEDULE: labs ride the lives; forced installs; holds; a fail past the cap with its detection time; live from / exp0; the farm cap')
    const base = { mult: 2.28, expMult: 1.29, int: 157 }
    const lives = (prod, n = 12, len = 2) => Array.from({ length: n }, (_, j) => ({ startH: j * len, lenH: len, prod, ramGB: 900 }))
    const hi = CP.labScheduleOf({ lives: lives(2.6), base, crawlMin: CP.CRAWL_MIN })
    const lo = CP.labScheduleOf({ lives: lives(1.0), base, crawlMin: CP.CRAWL_MIN })
    const mid = CP.labScheduleOf({ lives: [...lives(1.0, 8), ...lives(2.6, 4).map((l, j) => ({ ...l, startH: (8 + j) * 2 }))], base, crawlMin: CP.CRAWL_MIN })
    c.examined(3)
    if (hi.failed || hi.labs.length !== 5 || hi.labs.some((l) => l.held) || Math.abs(hi.legH - 4 * CP.LAB_INSTALL_H) > 1e-9) c.fail(`a high product: five labs in lives, leg = 4 forced installs (${4 * CP.LAB_INSTALL_H}h), got ${JSON.stringify({ leg: hi.legH, failed: hi.failed })}`)
    if (!lo.failed || !Number.isFinite(lo.detectH) || lo.detectH !== 20) c.fail(`a flat product of 1 (mult 2.28 x the lab augmentations) cannot reach 2500/3000: FAIL, detected at the last pre-final life's start (20h), got ${JSON.stringify({ failed: lo.failed, detect: lo.detectH })}`)
    if (mid.failed || mid.labs.find((l) => l.lab === 5)?.life < 8) c.fail('a product that rises late: labs 4-5 wait for the rise (lab 5 in a life >= 8), not failed', JSON.stringify(mid.labs))
    // from / exp0: three labs installed (their charisma already in the base), the 4th's exp half in hand
    const from3 = CP.labScheduleOf({ lives: lives(2.6), base: { ...base, mult: 2.28 * 1.05 * 1.06 * 1.07 }, crawlMin: CP.CRAWL_MIN, from: 3 })
    c.examined(1)
    if (from3.labs.length !== 2 || from3.labs[0].lab !== 4 || Math.abs(from3.labs[0].mult - hi.labs[3].mult) > 1e-3) c.fail("from 3: labs 4-5 only, at the same multiplier as the full schedule's lab 4 (the installed labs' charisma not applied twice)", JSON.stringify(from3.labs.map((l) => [l.lab, l.mult])))
    const need = CP.expFor(Math.ceil(2500 * 1.02), hi.labs[3].mult)
    const half = CP.labScheduleOf({ lives: lives(2.6), base: { ...base, mult: 2.28 * 1.05 * 1.06 * 1.07 }, crawlMin: CP.CRAWL_MIN, from: 3, exp0: need * 0.99 })
    if (!(half.labs[0].climbH < from3.labs[0].climbH * 0.5)) c.fail(`exp0 at 99% of lab 4's need: its climb must be a fraction of the climb from 0 (${half.labs[0].climbH}h vs ${from3.labs[0].climbH}h)`)
    // the farm: past FARM_MAX workers RAM buys nothing (dnet-seed.js farmStep's cap, imported from chaplan)
    const a = CP.climbOf({ target: 3060, mult: 5, expMult: 1.29, ramGB: CP.FARM_MAX_GB, int: 157 }).h
    const b = CP.climbOf({ target: 3060, mult: 5, expMult: 1.29, ramGB: 16 * CP.FARM_MAX_GB, int: 157 }).h
    c.examined(2)
    if (Math.abs(a - b) > 1e-9) c.fail(`the farm is capped at FARM_MAX workers: 900GB ${a}h vs 14.4TB ${b}h`)
    if (!/import\s*\{[^}]*\bFARM_MAX\b[^}]*\}\s*from\s*'chaplan\.js'/.test(code('dnet-seed.js')) || /const FARM_MAX\s*=/.test(code('dnet-seed.js'))) c.fail("dnet-seed.js must take FARM_MAX from chaplan.js (one cap the model prices and the farm runs)")
    out.push(c)
  }

  {
    const c = new Check('LR4', "THE FALLBACK: the lab arm is the 'hack' option; a stalled climb's failed trajectories are the black ops from the stall, and the decision moves to 'blade'")
    const mults = { strength: 1.12, defense: 1.12, dexterity: 1.12, agility: 1.12, charisma: 1.12, strength_exp: 1.15, defense_exp: 1.15, dexterity_exp: 1.15, agility_exp: 1.15, charisma_exp: 1.15, bladeburner_success_chance: 1, bladeburner_max_stamina: 1, bladeburner_stamina_gain: 1 }
    const person = { skills: { hacking: 900, strength: 300, defense: 300, dexterity: 300, agility: 300, charisma: 250, intelligence: 131 }, exp: Object.fromEntries(['strength', 'defense', 'dexterity', 'agility', 'charisma'].map((k) => [k, BB.expForLevel(300, 1.12)])), mults }
    const tel = { joined: true, rank: 500, skillPoints: 0, blackOps: { done: 0 }, levels: { "Blade's Intuition": 20, 'Digital Observer': 20 } }
    const s0 = BB.bladeStartOf({ tel, person, sleeves: { infiltrate: 5, support: 0, fa: 0 }, gymExpPerSec: 37.661, install: null })
    const trajGen = function* (x) {
      return x.fakeH
    }
    // stub arms: the normal climb reaches every lab (+1h); the stalled one fails, seen 3h from now
    const arm = (failed) => ({ n: 4, legOf: () => (failed ? { legH: 999, failed: true, detectH: 3, heldH: 0 } : { legH: 1, failed: false, detectH: null, heldH: 0 }) })
    const labIn = (stalled) => ({ arms: { normal: arm(false), stalled: arm(true) }, stallOf: () => ({ stalled, kind: stalled ? 'mult' : null, why: stalled ? 'test stall' : 'on the trajectory' }), nodeH: 1, labIndex: 2, why: 'test' })
    const go = (lab, extra = {}) => drain(P.decideBladeRouteGen({ base: { fakeH: 5, cycleHours: 2 }, traj: (x) => x.fakeH, trajGen, bladeStart: s0, draws: [], post: false, lab, ...extra }))
    const ref = go(null)
    const bladeH = ref.bladeH
    c.examined(1)
    if (!(bladeH > 5 + 1 && bladeH < 3 + bladeH)) c.fail(`the fixture needs the black ops slower than the lab route (5h + 1h), got blade ${bladeH}h`)
    const ok = go(labIn(false))
    const st = go(labIn(true))
    c.examined(2)
    c.note(`blade ${bladeH}h; lab arm on the trajectory ${ok.hackH}h -> ${ok.key}; stalled ${st.hackH}h -> ${st.key} (${st.lab?.stallWhy})`)
    if (ok.key !== 'hack' || Math.abs(ok.hackH - 6) > 1e-6 || ok.lab?.priced !== true || ok.lab.stalled !== false) c.fail(`on the trajectory: the lab arm 5h + 1h = 6h must win as 'hack', got ${ok.key} at ${ok.hackH}h`, JSON.stringify(ok.lab))
    if (st.key !== 'blade' || Math.abs(st.hackH - (3 + bladeH)) > 1e-6 || st.lab?.stalled !== true || st.lab?.pFail !== 1) c.fail(`stalled: every trajectory fails, the arm is the black ops from the stall (3h + ${bladeH}h) and the route is 'blade', got ${st.key} at ${st.hackH}h`, JSON.stringify(st.lab))
    // through the draws (post): the same verdicts with the band on
    const draws = P.makeDraws({ drift: { s: 0.01, nu: 4, a: 2, b: 0.0002 } }, 24, 11)
    const okD = go(labIn(false), { draws, post: true, budgetMs: 1e9, node: 15 })
    const stD = go(labIn(true), { draws, post: true, budgetMs: 1e9, node: 15 })
    c.examined(2)
    if (okD.key !== 'hack') c.fail(`with draws (node 15's band): the lab route must win on the trajectory, got ${okD.key}`, okD.why)
    if (stD.key !== 'blade') c.fail(`with draws: the stalled climb must fall back to the black ops, got ${stD.key}`, stD.why)
    const hm = (stD.options ?? []).find((o) => o.key === 'hack')?.meanH
    if (!(hm > bladeH && hm < 3 + 3 * bladeH)) c.fail(`the stalled lab arm's draws must be the fallback — 3h to the stall, then the draw's black ops (mean in (${bladeH}, ${(3 + 3 * bladeH).toFixed(1)})h; the lab route's own 999h leg never) — got ${hm}`)
    // a HELD climb: bounded by falling back at its detection
    const held = { n: 1, legOf: () => ({ legH: 500, failed: false, detectH: 2, heldH: 499 }) }
    const hd = go({ arms: { normal: held, stalled: held }, stallOf: () => ({ stalled: false }), nodeH: 1, labIndex: 3, why: 'held' })
    c.examined(1)
    if (!(Math.abs(hd.hackH - Math.min(5 + 500, 2 + bladeH)) < 1e-6)) c.fail(`a held climb is bounded by the fallback at its detection: min(5 + 500, 2 + ${bladeH}), got ${hd.hackH}`)
    // the stall moving is an event: a route held on 'hack' re-decides
    const prev = { key: 'hack', meanH: 6, decidedAt: new Date().toISOString(), lab: { stalled: false } }
    const moved = go(labIn(true), { draws, post: true, budgetMs: 1e9, node: 15, prev, redecide: false })
    c.examined(1)
    if (moved.key !== 'blade') c.fail(`a held 'hack' whose climb stalls since must re-decide to the black ops, got ${moved.key} (held ${moved.held})`, moved.why)
    // the insurance bound is published, never acted on silently
    if (!st.lab?.insurance || !Number.isFinite(st.lab.insurance.valueUpperH) || st.lab.insurance.run !== false) c.fail('the record must publish the parallel-Bladeburner insurance bound (and not run it)', JSON.stringify(st.lab?.insurance))
    out.push(c)
  }

  {
    const c = new Check('LR5', "THE STALL: under the band's q10 or a lab past the clears' q75 due fraction (each beyond its tolerance); on the trajectory: not stalled")
    const band = [{ phi: 0, q10: 1 }, { phi: 0.5, q10: 1.2 }, { phi: 0.8, q10: 1.5 }]
    const labDue = [{ lab: 1, q75: 0.05 }, { lab: 2, q75: 0.1 }, { lab: 3, q75: 0.5 }, { lab: 4, q75: 0.9 }, { lab: 5, q75: null }]
    const cases = [
      [{ phi: 0.6, prod: 1.3, labIndex: 3 }, false, null, 'on the trajectory'],
      [{ phi: 0.6, prod: 1.1, labIndex: 3 }, true, 'mult', 'product under q10 1.2 by > 5%'],
      [{ phi: 0.6, prod: 1.15, labIndex: 3 }, false, null, 'within the tolerance'],
      [{ phi: 0.65, prod: 1.3, labIndex: 2 }, true, 'labs', 'lab 3 past 0.5 + 0.1'],
      [{ phi: 0.55, prod: 1.3, labIndex: 2 }, false, null, 'lab 3 within the slack'],
      [{ phi: 0.95, prod: 1.6, labIndex: 4 }, false, null, 'lab 5 has no due fraction (most clears never install it before the end)'],
    ]
    for (const [x, want, kind, what] of cases) {
      c.examined(1)
      const v = L.labStallOf({ ...x, band, labDue })
      if (v.stalled !== want || (want && v.kind !== kind)) c.fail(`${what}: stalled ${v.stalled} (${v.kind}), want ${want} (${kind})`, v.why)
    }
    if (!L.labStallOf({ phi: NaN, prod: 1, labIndex: 0 }).unread) c.fail('an unread input must say so (never "not stalled" silently)')
    out.push(c)
  }

  {
    const c = new Check('LR6', 'THE HEALTH CHECK: LAB CLIMB STALLED from the save — stalled, unpriced, a stale lab index; silent when healthy or off the lab route')
    const now = Date.parse('2026-11-01T00:00:00Z')
    const sf = { ctor: 'JSONMap', data: [[1, 3], [2, 3], [3, 3]] }
    const sfm = L.sfChaMultOf(sf.data) * 1.1
    // a save whose charisma reads total mult `m`: level = m x (32 ln(exp + 534.6) - 200) at exp 1e8
    const save = ({ m, hours, labs }) => {
      const exp = 1e8
      return { bitNode: 15, lastNodeReset: now - hours * 3.6e6, skills: { charisma: Math.floor(m * (32 * Math.log(exp + 534.6) - 200)) }, exp: { charisma: exp }, augmentations: L.LAB_AUG_NAMES.slice(0, labs), sourceFiles: sf }
    }
    const route = (lab) => ({ route: 'hack', lab: { priced: true, totalH: 30, labIndex: 3, stalled: false, why: 'test', ...lab } })
    const q10 = L.bandAt(0.8).q10
    const healthy = L.labClimbHealthOf({ sf: sf.data, state: save({ m: sfm * q10 * 1.3, hours: 24, labs: 3 }), route: route({}), now })
    const behind = L.labClimbHealthOf({ sf: sf.data, state: save({ m: sfm * q10 * 0.8, hours: 24, labs: 3 }), route: route({}), now })
    const stale = L.labClimbHealthOf({ sf: sf.data, state: save({ m: sfm * q10 * 1.3, hours: 24, labs: 4 }), route: route({}), now })
    const unp = L.labClimbHealthOf({ sf: sf.data, state: save({ m: sfm * q10 * 1.3, hours: 24, labs: 3 }), route: route({ priced: false, why: 'unread: home RAM' }), now })
    const off = L.labClimbHealthOf({ sf: sf.data, state: save({ m: sfm * q10 * 0.8, hours: 24, labs: 3 }), route: { route: 'blade', lab: route({}).lab }, now })
    const other = L.labClimbHealthOf({ state: { ...save({ m: 1, hours: 24, labs: 0 }), bitNode: 14 }, route: route({}), now })
    c.examined(6)
    if (healthy.length) c.fail('a save on the trajectory must not fire', JSON.stringify(healthy))
    if (!behind.some((p) => p.problem === 'LAB CLIMB STALLED' && /q10/.test(p.detail))) c.fail(`a save under the band's q10 (${q10}) at node fraction 0.8 must fire`, JSON.stringify(behind))
    if (!stale.some((p) => /lab index/.test(p.detail))) c.fail('a lab index the planner read differently from the save must fire', JSON.stringify(stale))
    if (!unp.some((p) => /unpriced/.test(p.detail))) c.fail('an unpriced lab arm on the lab route must fire', JSON.stringify(unp))
    if (off.length || other.length) c.fail('off the lab route (blade) or outside BN15: silent', JSON.stringify({ off, other }))
    const hc = fs.readFileSync(path.join(REPO_ROOT, 'tools/healthcheck.mjs'), 'utf8')
    c.examined(1)
    if (!/labClimbHealthOf\(\{\s*state,[^\n]*sf: state\?\.sourceFiles\?\.data/.test(hc)) c.fail('tools/healthcheck.mjs must run labClimbHealthOf on the save digest (its Source-File levels included)')
    out.push(c)
  }

  {
    const c = new Check('LR7', "THE WIRING: progress.js hands the decision the arm pair or falls back to the black ops' rule; the farm stops on the black ops")
    const pg = code('progress.js')
    c.examined(4)
    if (!/lab = labArmInputOf\(ns, info, player, base\)/.test(pg)) c.fail('progress.js bladeRouteOf must build the lab arm (labArmInputOf) on BN15 with labReady')
    if (!/let rule = nodeRuleOf\(info\.currentNode, pin\)/.test(pg)) c.fail('the route decision must still take the node rule (routepin.nodeRuleOf) where labReady is false')
    if (!/if \(!lab\.arms\) rule = \{ route: 'blade'/.test(pg)) c.fail("an unbuildable lab arm must fall back to the black ops' rule (never BN15's Daedalus exit as 'hack')")
    if (!/= yield\* decideBladeRouteGen\(\{ base, traj: trajectoryOf\(basis, \{\}\)[^\n]*\brule, lab: lab\?\.arms \? lab : null \}\)/.test(pg)) c.fail('progress.js must pass the lab arm to decideBladeRouteGen')
    if (!/arms: \{ normal: labArmOf\(\{ \.\.\.common, stalled: false \}\), stalled: labArmOf\(\{ \.\.\.common, stalled: true \}\) \}/.test(pg)) c.fail('labArmInputOf must build both arms (on the trajectory and stalled)')
    const seed = await import('../../dnet-seed.js')
    const mk = (routeTxt) => {
      const ns = {
        killed: [],
        execs: 0,
        getResetInfo: () => ({ currentNode: 15, lastAugReset: 77, ownedAugs: new Map(), ownedSF: new Map([[4, 3]]) }),
        ps: () => [{ pid: 9, filename: 'dnet-cha.js' }],
        getPlayer: () => ({ skills: { charisma: 100 } }),
        kill: (pid) => ns.killed.push(pid),
        getServerMaxRam: () => 4096,
        getServerUsedRam: () => 100,
        exec: () => ++ns.execs,
        read: () => routeTxt,
      }
      return ns
    }
    const on = { 15: { labReady: true } }
    const blade = mk(JSON.stringify({ route: { route: 'blade', node: 15, lastAugReset: 77 } }))
    const rb = seed.farmStep(blade, { farmSeq: 0 }, on)
    const lab = mk(JSON.stringify({ route: { route: 'hack', node: 15, lastAugReset: 77 } }))
    const rl = seed.farmStep(lab, { farmSeq: 0 }, on)
    const old = mk(JSON.stringify({ route: { route: 'blade', node: 15, lastAugReset: 1 } }))
    const ro = seed.farmStep(old, { farmSeq: 0 }, on)
    c.examined(3)
    if (rb.on || blade.killed.length !== 1 || blade.execs) c.fail("the acted route 'blade' (the fallback): the farm must stop", JSON.stringify(rb))
    if (!rl.on || !lab.execs) c.fail("the acted route 'hack' (the labyrinth's): the farm runs", JSON.stringify(rl))
    if (!ro.on) c.fail("another life's 'blade' record is not this life's route: the farm runs", JSON.stringify(ro))
    out.push(c)
  }

  {
    const c = new Check('LR8', "THE PRICE: lab15.mjs is the measured trajectories' leg; the live arm at the BN15.1 entry state prices the lab route under the black ops")
    const L15 = await import('../sim/lab15.mjs')
    const R = await import('../sim/gameplan/routes.mjs')
    const legs = L15.legsOf()
    c.examined(3)
    if (Math.abs(R.LAB15.mid - +legs.mid.toFixed(2)) > 1e-9) c.fail(`routes.mjs LAB15.mid ${R.LAB15.mid} is not lab15.mjs's measured leg ${legs.mid}`)
    if (/SCENARIOS\s*=\s*\{\s*lo:\s*\{\s*aug:/.test(fs.readFileSync(path.join(REPO_ROOT, 'tools/sim/lab15.mjs'), 'utf8'))) c.fail('the assumed charisma-augmentation columns came back into lab15.mjs')
    if (!(R.LAB15.pFail >= 0 && R.LAB15.pFail < 0.5)) c.fail(`P(fail) ${R.LAB15.pFail} must be published (and is the minority of the measured trajectories)`)
    // the BN15.1 entry as the dry-run reads it: SF1/2/3.3, no augmentation, the hacking exit ~23.4h, the black ops ~157h
    const arm = L.labArmOf({ live: { mult: L.sfChaMultOf([[1, 3], [2, 3], [3, 3]]), nodeMult: 1.1, expMult: 1.2928, int: 157, exp: 0, labIndex: 0 }, nodeH: 0.05, lifeAgeH: 0.05, cycleH: 2, farmGB: 900 })
    const vals = Array.from({ length: arm.n }, (_, i) => arm.legOf(23.4, i)).map((r) => (r.failed ? r.detectH + 157 : r.heldH > 0 ? Math.min(23.4 + r.legH, r.detectH + 157) : 23.4 + r.legH))
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length
    c.examined(1)
    c.note(`entry: lab arm ${mean.toFixed(1)}h (hack 23.4h + the labs, failures as the black ops) vs blade 157h; legs ${Array.from({ length: arm.n }, (_, i) => arm.legOf(23.4, i)).map((r) => (r.failed ? 'F' : r.legH)).join(' ')}`)
    if (!(mean < 157)) c.fail(`the lab arm at the entry must price under the black ops (${mean.toFixed(1)}h vs 157h)`)
    // ONE MODEL: the live arm at a node start priced on T15 lays each trajectory's own lives — it reproduces lab15.mjs's legs
    const at15 = Array.from({ length: arm.n }, (_, i) => arm.legOf(LAB_TRAJ.transfer.T15, i))
    c.examined(1)
    const off = legs.rows.map((r) => r.s)
    const bad = at15.map((r, i) => (r.failed !== off[i].failed || (!r.failed && Math.abs(r.legH - off[i].legH) > 0.5) ? `#${i} live ${r.failed ? 'F' : r.legH} vs lab15 ${off[i].failed ? 'F' : off[i].legH}` : null)).filter(Boolean)
    if (bad.length) c.fail(`the live arm at T15 and lab15.mjs price the same trajectories differently: ${bad.join('; ')}`)
    // the published exit on the labyrinth route is the route's (evaluate.exitOffRouteOf), never the install decision's Daedalus exit
    const EV = await import('../sim/entry/evaluate.mjs')
    const plan = (source) => ({ decisions: { bladeRoute: { key: 'hack', hackH: 72, bladeH: 157, lab: { priced: true } } }, exit: { meanH: 90, q50: 42, source } })
    c.examined(2)
    if (!EV.exitOffRouteOf(plan('the committed trajectory (nothing queued)'))) c.fail("the lab route published with the hacking trajectory's exit must read OFF ROUTE")
    if (EV.exitOffRouteOf(plan('the labyrinth route (the hacking exit + the labs ...)'))) c.fail("the lab route's own exit must pass")
    if (!/labEx \? brEx/.test(code('progress.js'))) c.fail("progress.js publishPlan must publish the labyrinth route's distribution on the lab arm")
    // the STALLED arm: no further growth — at the entry's product no trajectory reaches 2500/3000
    const flat = L.labArmOf({ live: { mult: L.sfChaMultOf([[1, 3], [2, 3], [3, 3]]), nodeMult: 1.1, expMult: 1.2928, int: 157, exp: 0, labIndex: 0 }, nodeH: 0.05, lifeAgeH: 0.05, cycleH: 2, farmGB: 900, stalled: true })
    const fl = Array.from({ length: flat.n }, (_, i) => flat.legOf(23.4, i))
    c.examined(1)
    if (!fl.every((r) => r.failed && Number.isFinite(r.detectH))) c.fail(`the stalled arm (no growth) at the entry's product must fail every trajectory with a detection time, got ${fl.map((r) => (r.failed ? 'F' : r.legH)).join(' ')}`)
    out.push(c)
  }

  {
    const c = new Check('LR9', "THE FLAG: labReady true lifts BN15's rule (both arms priced, nothing wrapped); false binds it again; the pin still wins")
    const rp = await import('../../routepin.js')
    const ON = { ...rp.NODE_ROUTE_RULES, 15: { ...rp.NODE_ROUTE_RULES[15], labReady: true } }
    const OFF = { ...rp.NODE_ROUTE_RULES, 15: { ...rp.NODE_ROUTE_RULES[15], labReady: false } }
    const none = rp.routePinOf('', 15)
    const d = { key: 'hack', hackH: 61, bladeH: 157 }
    c.examined(4)
    if (rp.nodeRuleOf(15, none, ON) !== null || rp.nodeRouteOf(d, 15, none, ON) !== d) c.fail('labReady true: no rule, the decision acted as priced')
    if (rp.nodeRuleOf(15, none, OFF)?.route !== 'blade' || rp.nodeRouteOf(d, 15, none, OFF).key !== 'blade') c.fail('labReady false: the black ops rule binds')
    if (rp.nodeRuleOf(15, rp.routePinOf('hack', 15), OFF) !== null) c.fail('/route-pin.txt still wins over the rule')
    c.note(`the live flag: labReady ${rp.NODE_ROUTE_RULES[15]?.labReady}`)
    // the flag's state and the code it gates agree: labReady true needs the arm (labroute.js) and the health check wired
    if (rp.NODE_ROUTE_RULES[15]?.labReady === true && !/labClimbHealthOf/.test(fs.readFileSync(path.join(REPO_ROOT, 'tools/healthcheck.mjs'), 'utf8'))) c.fail('labReady true without LAB CLIMB STALLED in the health check')
    out.push(c)
  }

  return out
}
