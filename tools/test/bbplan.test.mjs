// bbplan.js against the GAME: every Bladeburner formula the daemon, the skill
// planner and the exit model use is compared with the game's own classes
// (tools/sim/nodechoice bundle of ~/Repos/bitburner) on random states.
//
//   BB1  the data tables (contracts, operations, 21 black ops, skills) equal Bladeburner/data/*.ts
//   BB2  success chance = Action.getSuccessChance (all 9 levelled actions + 21 black ops, random people/skills/cities/teams)
//   BB3  action time = getActionTime; rank gain/loss = Formulas.ts (BN6, BN7, BN13 multipliers)
//   BB4  skill cost / max upgrade count / skill multipliers = Skill.ts and Bladeburner.updateSkillMultipliers (every node's SkillCost)
//   BB5  stamina: max and gain per second = calculateMaxStamina / calculateStaminaGainPerSecond
//   BB6  exp per attempt = getActionStats; successes per level = LevelableAction; skill points = changeRank
//   BB7  the ENV inversion the daemon uses recovers the chance at every level and under a skill purchase
//   BB8  the policy: never an exhausted action, black op when eligible and sure, Field Analysis when nothing clears, rest when tired
//   BB9  the skill planner spends within the points held, and a skill purchase it makes raises its objective
//
// A failure to load the bundle FAILS (it is not a pass — CLAUDE.md "a test
// that stops testing and still reports green").

import './gameresolve.mjs'
import { Check } from './harness.mjs'

const bp = await import('bbplan.js')

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const close = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b))

export async function run() {
  const checks = []
  const load = new Check('BB0', 'the game bundle (tools/sim/nodechoice) loads — every BB check below runs the game\'s own Bladeburner classes')
  checks.push(load)
  let g, setBitNode
  try {
    const m = await import('../sim/nodechoice/game.mjs')
    g = m.default
    setBitNode = m.setBitNode
    load.examined(1)
  } catch (e) {
    load.fail('could not load tools/sim/nodechoice/game.mjs — the formula checks cannot run, which is NOT a pass', String(e?.stack ?? e).slice(0, 500))
    return checks
  }

  // A fresh game person in the division, in node n.
  const fresh = (n = 6) => {
    setBitNode(n, 1)
    g.initSourceFiles()
    const P = new g.PlayerObject()
    g.setPlayer(P)
    P.bitNodeN = n
    P.sourceFiles = new Map()
    P.resetMultipliers()
    for (const s of ['strength', 'defense', 'dexterity', 'agility']) P.exp[s] = g.calculateExp(100, P.mults[s])
    P.updateSkillLevels()
    P.startBladeburner()
    return P
  }
  const randomize = (P, r) => {
    const bb = P.bladeburner
    for (const s of ['hacking', 'strength', 'defense', 'dexterity', 'agility', 'charisma']) P.skills[s] = Math.floor(Math.exp(r() * Math.log(3000)))
    P.skills.intelligence = Math.floor(r() * 300)
    P.mults.bladeburner_success_chance = 1 + r() * 2
    P.mults.bladeburner_max_stamina = 1 + r()
    P.mults.bladeburner_stamina_gain = 1 + r()
    for (const name of Object.keys(bp.SKILLS)) bb.setSkillLevel(name, Math.floor(r() * r() * 120))
    bb.staminaBonus = r() * 50
    bb.calculateMaxStamina()
    bb.stamina = bb.maxStamina * (0.2 + r())
    bb.stamina = Math.min(bb.stamina, bb.maxStamina)
    const city = bb.getCurrentCity()
    city.pop = 1e8 + r() * 3e9
    city.popEst = city.pop * (0.5 + r())
    city.chaos = r() < 0.5 ? r() * 40 : 50 + r() * 200
    city.comms = Math.floor(r() * 5)
    for (const o of [...Object.values(bb.operations), ...bb.blackOperationArray]) o.teamCount = Math.floor(r() * 30)
    for (const a of [...Object.values(bb.contracts), ...Object.values(bb.operations)]) {
      a.maxLevel = 1 + Math.floor(r() * 60)
      a.level = 1 + Math.floor(r() * a.maxLevel)
    }
  }
  const personOf = (P) => ({ skills: { ...P.skills }, mults: { ...P.mults } })
  const envOfGame = (P, d, a) => {
    const bb = P.bladeburner
    const c = bb.getCurrentCity()
    return { int: P.skills.intelligence, stamina: bb.stamina, maxStamina: bb.maxStamina, pop: c.pop, chaos: c.chaos, comms: c.comms, teamCount: a.teamCount ?? 0, augMult: P.mults.bladeburner_success_chance }
  }

  // ---- BB1: the tables ----
  {
    const c = new Check('BB1', 'bbplan data tables equal the game\'s Bladeburner/data (contracts, operations, black ops, skills)')
    checks.push(c)
    setBitNode(6, 1)
    const contracts = g.createContracts()
    const ops = g.createOperations()
    const black = Object.values(g.createBlackOperations()).sort((a, b) => a.n - b.n)
    const cmpVec = (label, mine, game) => {
      for (let i = 0; i < bp.STATS.length; i++) if (mine[i] !== game[bp.STATS[i]]) c.fail(`${label}[${bp.STATS[i]}]: bbplan ${mine[i]} vs game ${game[bp.STATS[i]]}`)
    }
    const cmpLev = (mine, a) => {
      for (const k of ['baseDifficulty', 'difficultyFac', 'rewardFac', 'rankGain', 'rankLoss', 'hpLoss', 'isStealth', 'isKill', 'minCount', 'maxCount']) {
        c.examined(1)
        if (mine[k] !== a[k]) c.fail(`${a.name}.${k}: bbplan ${mine[k]} vs game ${a[k]}`)
      }
      cmpVec(`${a.name}.weights`, mine.weights, a.weights)
      cmpVec(`${a.name}.decays`, mine.decays, a.decays)
      // growthFunction is random: its support must sit inside the stated range and reach both ends.
      let lo = Infinity
      let hi = -Infinity
      for (let i = 0; i < 4000; i++) {
        const v = a.growthFunction()
        lo = Math.min(lo, v)
        hi = Math.max(hi, v)
      }
      if (lo !== mine.growth[0] || hi !== mine.growth[1]) c.fail(`${a.name}.growth: bbplan [${mine.growth}] vs game support [${lo}, ${hi}]`)
    }
    for (const a of Object.values(contracts)) bp.CONTRACTS[a.name] ? cmpLev(bp.CONTRACTS[a.name], a) : c.fail(`contract ${a.name} missing from bbplan`)
    for (const a of Object.values(ops)) bp.OPERATIONS[a.name] ? cmpLev(bp.OPERATIONS[a.name], a) : c.fail(`operation ${a.name} missing from bbplan`)
    if (Object.keys(bp.CONTRACTS).length !== Object.keys(contracts).length || Object.keys(bp.OPERATIONS).length !== Object.keys(ops).length) c.fail('bbplan has a different number of contracts/operations from the game')
    if (black.length !== bp.BLACK_OPS.length) c.fail(`black ops: bbplan ${bp.BLACK_OPS.length} vs game ${black.length}`)
    black.forEach((b, i) => {
      const m = bp.BLACK_OPS[i]
      for (const k of ['name', 'reqdRank', 'baseDifficulty', 'rankGain', 'rankLoss', 'hpLoss', 'isStealth', 'isKill', 'n']) {
        c.examined(1)
        if (m?.[k] !== b[k]) c.fail(`black op #${i} ${b.name}.${k}: bbplan ${m?.[k]} vs game ${b[k]}`)
      }
      if (m) {
        cmpVec(`${b.name}.weights`, m.weights, b.weights)
        cmpVec(`${b.name}.decays`, m.decays, b.decays)
      }
    })
    if (bp.BLACK_OPS[20]?.name !== bp.DAEDALUS) c.fail('the 21st black op is not Operation Daedalus')
    for (const s of Object.values(g.BladeburnerSkills)) {
      const m = bp.SKILLS[s.name]
      c.examined(1)
      if (!m) {
        c.fail(`skill ${s.name} missing from bbplan`)
        continue
      }
      if (m.baseCost !== s.baseCost || m.costInc !== s.costInc || (m.maxLvl === Infinity ? s.maxLvl !== Number.MAX_VALUE : m.maxLvl !== s.maxLvl)) c.fail(`skill ${s.name}: bbplan ${JSON.stringify(m)} vs game base ${s.baseCost} inc ${s.costInc} max ${s.maxLvl}`)
      if (JSON.stringify(m.mults) !== JSON.stringify(s.mults)) c.fail(`skill ${s.name} mults: bbplan ${JSON.stringify(m.mults)} vs game ${JSON.stringify(s.mults)}`)
    }
    if (Object.keys(bp.SKILLS).length !== Object.keys(g.BladeburnerSkills).length) c.fail('bbplan has a different number of skills from the game')
    for (const [k, v] of Object.entries(bp.BBC)) {
      c.examined(1)
      if (g.BladeburnerConstants[k] !== v) c.fail(`BBC.${k}: bbplan ${v} vs game ${g.BladeburnerConstants[k]}`)
    }
    c.note(`${Object.keys(contracts).length} contracts, ${Object.keys(ops).length} operations, ${black.length} black ops, ${Object.keys(g.BladeburnerSkills).length} skills, ${Object.keys(bp.BBC).length} constants`)
  }

  // ---- BB2: success chance ----
  {
    const c = new Check('BB2', 'bbplan success chance (ENV x core x skill mults / difficulty) equals Action.getSuccessChance on random states')
    checks.push(c)
    const P = fresh(6)
    const bb = P.bladeburner
    const r = rng(7)
    let worst = 0
    let clamped = 0
    for (let trial = 0; trial < 300; trial++) {
      randomize(P, r)
      const sm = { ...bb.skillMultipliers }
      const person = personOf(P)
      const acts = [...Object.values(bb.contracts), ...Object.values(bb.operations), ...bb.blackOperationArray]
      for (const a of acts) {
        const d = bp.dataOf(a.name)
        const level = a.level ?? 1
        const mine = bp.successChance(d, level, person, sm, envOfGame(P, d, a))
        const game = a.getSuccessChance(bb, P, { est: false })
        c.examined(1)
        if (game >= 1) clamped++
        const err = Math.abs(mine - game)
        worst = Math.max(worst, err)
        if (err > 1e-9) {
          c.fail(`${a.name} L${level}: bbplan ${mine} vs game ${game}`)
          if (c.fails.length > 5) break
        }
      }
      if (c.fails.length > 5) break
    }
    c.note(`worst |error| ${worst.toExponential(2)}; ${clamped} of the comparisons were clamped at 1`)
  }

  // ---- BB3: action time and rank ----
  {
    const c = new Check('BB3', 'action time = Action.getActionTime; rank gain/loss = Formulas.ts in BN6 (x1), BN7 (x0.6) and BN13 (x0.45)')
    checks.push(c)
    for (const n of [6, 7, 13]) {
      const P = fresh(n)
      const bb = P.bladeburner
      const r = rng(11 + n)
      const mults = setBitNode(n, 1)
      for (let trial = 0; trial < 120; trial++) {
        randomize(P, r)
        const sm = { ...bb.skillMultipliers }
        for (const a of [...Object.values(bb.contracts), ...Object.values(bb.operations), ...bb.blackOperationArray]) {
          const d = bp.dataOf(a.name)
          const L = a.level ?? 1
          c.examined(3)
          const t = bp.actionTime(d, L, personOf(P), sm)
          const tg = a.getActionTime(bb, P)
          if (t !== tg) c.fail(`BN${n} ${a.name} L${L} time: bbplan ${t} vs game ${tg}`)
          const rg = bp.rankGainOf(d, L, mults.BladeburnerRank)
          const rgg = g.calculateActionRankGain(a, L)
          if (!close(rg, rgg)) c.fail(`BN${n} ${a.name} L${L} rank gain: bbplan ${rg} vs game ${rgg}`)
          const rl = bp.rankLossOf(d, L)
          const rlg = g.calculateActionRankLoss(a, L)
          if (!close(rl, rlg)) c.fail(`BN${n} ${a.name} L${L} rank loss: bbplan ${rl} vs game ${rlg}`)
          if (c.fails.length > 5) break
        }
      }
      const fa = g.BladeburnerGeneralActions[bp.GENERAL.fieldAnalysis]
      c.examined(1)
      if (!close(bp.fieldAnalysisRank(mults.BladeburnerRank), g.calculateActionRankGain(fa))) c.fail(`BN${n} Field Analysis rank: bbplan ${bp.fieldAnalysisRank(mults.BladeburnerRank)} vs game ${g.calculateActionRankGain(fa)}`)
    }
    setBitNode(6, 1)
  }

  // ---- BB4: skills ----
  {
    const c = new Check('BB4', 'skill cost and max upgrade count = Skill.ts (every node\'s BladeburnerSkillCost); skill multipliers = updateSkillMultipliers')
    checks.push(c)
    const r = rng(5)
    for (const n of [1, 6, 7, 9, 13, 14]) {
      const mult = setBitNode(n, 1).BladeburnerSkillCost
      for (const s of Object.values(g.BladeburnerSkills)) {
        for (let k = 0; k < 40; k++) {
          const lvl = Math.floor(r() * 400)
          const cnt = 1 + Math.floor(r() * 50)
          if (lvl + cnt > s.maxLvl) continue
          c.examined(2)
          const mine = bp.skillCost(s.name, lvl, cnt, mult)
          const game = s.calculateCost(lvl, cnt)
          if (mine !== game) c.fail(`BN${n} ${s.name} cost(${lvl}, ${cnt}): bbplan ${mine} vs game ${game}`)
          const sp = Math.floor(r() * 1e5)
          const mu = bp.maxUpgradeCount(s.name, lvl, sp, mult)
          const gu = s.calculateMaxUpgradeCount(lvl, sp)
          if (mu !== gu) c.fail(`BN${n} ${s.name} maxUpgradeCount(${lvl}, ${sp}): bbplan ${mu} vs game ${gu}`)
        }
      }
    }
    setBitNode(6, 1)
    const P = fresh(6)
    const bb = P.bladeburner
    for (let trial = 0; trial < 100; trial++) {
      const levels = {}
      for (const name of Object.keys(bp.SKILLS)) {
        levels[name] = Math.floor(r() * 300)
        bb.setSkillLevel(name, levels[name])
      }
      const mine = bp.skillMultsOf(levels)
      const game = bb.skillMultipliers
      c.examined(1)
      for (const k of new Set([...Object.keys(mine), ...Object.keys(game)])) if (!close(mine[k] ?? 1, game[k] ?? 1)) c.fail(`skill mult ${k}: bbplan ${mine[k]} vs game ${game[k]}`)
    }
  }

  // ---- BB5: stamina ----
  {
    const c = new Check('BB5', 'max stamina and stamina gain per second = Bladeburner.calculateMaxStamina / calculateStaminaGainPerSecond')
    checks.push(c)
    const P = fresh(6)
    const bb = P.bladeburner
    const r = rng(17)
    for (let trial = 0; trial < 200; trial++) {
      randomize(P, r)
      bb.calculateMaxStamina()
      const sm = { ...bb.skillMultipliers }
      const max = bp.maxStaminaOf(personOf(P), sm, bb.staminaBonus)
      c.examined(2)
      if (!close(max, bb.maxStamina)) c.fail(`max stamina: bbplan ${max} vs game ${bb.maxStamina}`)
      const gain = bp.staminaGainOf(personOf(P), sm, bb.maxStamina)
      const gg = bb.calculateStaminaGainPerSecond()
      if (!close(gain, gg)) c.fail(`stamina gain: bbplan ${gain} vs game ${gg}`)
      if (c.fails.length > 5) break
    }
  }

  // ---- BB6: exp, levels, skill points ----
  {
    const c = new Check('BB6', 'exp per attempt = getActionStats; successes per level = getSuccessesNeededForNextLevel; skill points = changeRank')
    checks.push(c)
    const P = fresh(6)
    const bb = P.bladeburner
    const r = rng(23)
    const short = { hacking: 'hackExp', strength: 'strExp', defense: 'defExp', dexterity: 'dexExp', agility: 'agiExp', charisma: 'chaExp', intelligence: 'intExp' }
    for (let trial = 0; trial < 60; trial++) {
      randomize(P, r)
      const sm = { ...bb.skillMultipliers }
      for (const a of [...Object.values(bb.contracts), ...Object.values(bb.operations), ...bb.blackOperationArray]) {
        const d = bp.dataOf(a.name)
        for (const success of [true, false]) {
          const mine = bp.actionExpOf(d, a.level ?? 1, personOf(P), sm, success)
          const game = bb.getActionStats(a, P, success)
          c.examined(1)
          for (const s of bp.STATS) if (!close(mine[s], game[short[s]])) c.fail(`${a.name} ${success ? 'success' : 'failure'} ${s} exp: bbplan ${mine[s]} vs game ${game[short[s]]}`)
        }
      }
      if (c.fails.length > 5) break
    }
    for (const a of [...Object.values(bb.contracts), ...Object.values(bb.operations)]) {
      const d = bp.dataOf(a.name)
      for (let m = 1; m < 200; m += 7) {
        a.maxLevel = m
        c.examined(1)
        const game = a.getSuccessesNeededForNextLevel(bp.perLevelOf(d))
        if (bp.successesNeeded(m, bp.perLevelOf(d)) !== game) c.fail(`${a.name} successes for level ${m + 1}: bbplan ${bp.successesNeeded(m, bp.perLevelOf(d))} vs game ${game}`)
      }
    }
    // Skill points: rank changes in random steps, both directions.
    const P2 = fresh(6)
    const b2 = P2.bladeburner
    for (let i = 0; i < 400; i++) {
      b2.changeRank(P2, (r() - 0.3) * 50)
      c.examined(1)
      if (b2.totalSkillPoints !== bp.totalSkillPointsAt(b2.maxRank)) {
        c.fail(`after rank changes: game totalSkillPoints ${b2.totalSkillPoints} vs bbplan floor(maxRank/3) ${bp.totalSkillPointsAt(b2.maxRank)} (maxRank ${b2.maxRank})`)
        break
      }
    }
  }

  // ---- BB7: the ENV inversion ----
  {
    const c = new Check('BB7', 'one observed chance per action recovers ENV, and from it the chance at every level and under a skill purchase (what the daemon does with the API)')
    checks.push(c)
    const P = fresh(6)
    const bb = P.bladeburner
    const r = rng(29)
    let n = 0
    for (let trial = 0; trial < 150; trial++) {
      randomize(P, r)
      const person = personOf(P)
      const sm = { ...bb.skillMultipliers }
      for (const a of [...Object.values(bb.contracts), ...Object.values(bb.operations)]) {
        const d = bp.dataOf(a.name)
        const probeL = a.maxLevel
        a.level = probeL
        const p = a.getSuccessChance(bb, P, { est: false })
        if (!(p > 0 && p < 1)) continue
        const K = bp.envFromChance(p, d, probeL, person, sm)
        for (const L of [1, Math.max(1, Math.floor(probeL / 2)), probeL]) {
          a.level = L
          const game = a.getSuccessChance(bb, P, { est: false })
          c.examined(1)
          n++
          if (!close(bp.pFrom(K, d, L, person, sm), game, 1e-7)) c.fail(`${a.name} L${L} from ENV at L${probeL}: ${bp.pFrom(K, d, L, person, sm)} vs game ${game}`)
        }
        // A skill purchase: Blade's Intuition +10, Reaper +10.
        const lv = { ...bb.skills }
        const sm2 = bp.skillMultsOf({ ...lv, "Blade's Intuition": (lv["Blade's Intuition"] ?? 0) + 10, Reaper: (lv.Reaper ?? 0) + 10 })
        bb.setSkillLevel("Blade's Intuition", (lv["Blade's Intuition"] ?? 0) + 10)
        bb.setSkillLevel('Reaper', (lv.Reaper ?? 0) + 10)
        a.level = probeL
        const game2 = a.getSuccessChance(bb, P, { est: false })
        c.examined(1)
        if (!close(bp.pFrom(K, d, probeL, person, sm2), game2, 1e-7)) c.fail(`${a.name} after a purchase: ${bp.pFrom(K, d, probeL, person, sm2)} vs game ${game2}`)
        bb.setSkillLevel("Blade's Intuition", lv["Blade's Intuition"] ?? 0)
        bb.setSkillLevel('Reaper', lv.Reaper ?? 0)
        if (c.fails.length > 5) break
      }
      if (c.fails.length > 5) break
    }
    if (n < 100) c.fail(`only ${n} unclamped comparisons — the check is not looking`)
  }

  // ---- BB8: the policy ----
  {
    const c = new Check('BB8', 'chooseAction: never an exhausted action; the black op when eligible and >= blackThr; Field Analysis when nothing clears; rest while tired')
    checks.push(c)
    const person = { skills: { hacking: 100, strength: 300, defense: 300, dexterity: 300, agility: 300, charisma: 100, intelligence: 0 }, mults: {} }
    const base = (over = {}) => ({
      person, sm: {}, levels: {}, bnRank: 1, rank: 0, stamina: 100, maxStamina: 100, staminaGain: 1, resting: false, chaos: 0, comms: 10,
      actions: bp.LEVELED.map((d) => ({ d, count: 50, maxLevel: 10, K: 1, width: 0 })),
      blackOp: { d: bp.BLACK_OPS[0], K: 1, width: 0 },
      ...over,
    })
    const v1 = base()
    const a1 = bp.chooseAction(v1)
    c.examined(1)
    if (!a1.name || a1.type === bp.TYPE.blackOp) c.fail(`below the black op's rank it chose ${JSON.stringify(a1)}`)
    const ex = base({ actions: base().actions.map((a) => (a.d.name === a1.name ? { ...a, count: 0.5 } : a)) })
    const a2 = bp.chooseAction(ex)
    c.examined(1)
    if (a2.name === a1.name) c.fail(`chose ${a1.name} with count 0.5 (< 1)`)
    // Eligible and sure: a huge ENV makes the black op certain.
    const a3 = bp.chooseAction(base({ rank: 3000, blackOp: { d: bp.BLACK_OPS[0], K: 1e6, width: 0 } }))
    c.examined(1)
    if (a3.type !== bp.TYPE.blackOp) c.fail(`eligible and certain black op not chosen: ${JSON.stringify(a3)}`)
    // Eligible but unlikely: not chosen.
    const a4 = bp.chooseAction(base({ rank: 3000, blackOp: { d: bp.BLACK_OPS[0], K: 1e-3, width: 0 } }))
    c.examined(1)
    if (a4.type === bp.TYPE.blackOp) c.fail(`black op at ~0% chosen: ${JSON.stringify(a4)}`)
    const a5 = bp.chooseAction(base({ actions: base().actions.map((a) => ({ ...a, K: 1e-6 })) }))
    c.examined(1)
    if (a5.name !== bp.GENERAL.fieldAnalysis) c.fail(`nothing clears minP, expected Field Analysis, got ${JSON.stringify(a5)}`)
    const a6 = bp.chooseAction(base({ resting: true }))
    c.examined(1)
    if (a6.name !== bp.GENERAL.regen) c.fail(`resting, expected the regeneration chamber, got ${JSON.stringify(a6)}`)
    const a7 = bp.chooseAction(base({ chaos: 80 }))
    c.examined(1)
    if (a7.name !== bp.GENERAL.diplomacy) c.fail(`chaos 80, expected Diplomacy, got ${JSON.stringify(a7)}`)
    // Raid with no communities is never chosen.
    const raidOnly = base({ comms: 0, actions: base().actions.map((a) => ({ ...a, count: a.d.name === 'Raid' ? 50 : 0 })) })
    c.examined(1)
    if (bp.chooseAction(raidOnly).name === 'Raid') c.fail('Raid chosen in a city with no communities')
    // The chosen level clears minP on the LOW end.
    const b = bp.bestLevel(v1.actions.find((a) => a.d.name === a1.name), v1)
    c.examined(1)
    if (!(b && b.p >= bp.POLICY.minP)) c.fail(`chosen level's chance ${b?.p} below minP`)
  }

  // ---- BB9: the skill planner ----
  {
    const c = new Check('BB9', 'planSkills spends within the points held, in positive counts, and each purchase raises the objective it was scored on')
    checks.push(c)
    const person = { skills: { hacking: 100, strength: 200, defense: 200, dexterity: 200, agility: 200, charisma: 100, intelligence: 0 }, mults: {} }
    const r = rng(31)
    for (let trial = 0; trial < 40; trial++) {
      const levels = {}
      for (const name of bp.POLICY.skills) levels[name] = Math.floor(r() * 40)
      const v = {
        person, levels, sm: bp.skillMultsOf(levels), bnRank: 1, rank: 1000 + r() * 50000, stamina: 100, maxStamina: 100, staminaGain: 1, resting: false, chaos: 0, comms: 10,
        actions: bp.LEVELED.map((d) => ({ d, count: 50, maxLevel: 20, K: 0.5 + r(), width: 0 })),
        blackOp: { d: bp.BLACK_OPS[Math.floor(r() * 21)], K: 0.5 + r(), width: 0 },
      }
      const sp = Math.floor(r() * 5000)
      const buys = bp.planSkills(v, sp)
      const spent = buys.reduce((s, b) => s + b.cost, 0)
      c.examined(1)
      if (spent > sp) c.fail(`spent ${spent} of ${sp} points`)
      if (buys.some((b) => !(b.count >= 1) || !(b.cost > 0))) c.fail(`a non-positive purchase: ${JSON.stringify(buys)}`)
      const lv2 = { ...levels }
      for (const b of buys) lv2[b.name] = (lv2[b.name] ?? 0) + b.count
      const s0 = bp.skillScore(v)
      const s1 = bp.skillScore({ ...v, levels: lv2, sm: bp.skillMultsOf(lv2) })
      if (buys.length && s1.kind === s0.kind && s1.v < s0.v - 1e-12) c.fail(`purchases ${JSON.stringify(buys)} lowered the objective ${s0.v} -> ${s1.v}`)
    }
  }
  return checks
}
