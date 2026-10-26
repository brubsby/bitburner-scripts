// THE LABYRINTH HARNESS (BitNode 15): the darknet route played by THIS checkout's scripts against the
// game's own darknet (DarkNet/*: the network, its mutations, every password model, the labyrinth, the
// lab caches, the install) — the measurement behind routes.mjs LAB15 and routepin labReady.
//
//   DNET_WARP=8 node tools/sim/entry/dnetlab.mjs --save F [--labs 1-5] [--limit-min 240] [--cha-over 1.02]
//                                                [--extra-sf '[[8,3]]'] [--farm-min 10] [--out F]
//
// THE STATE IS THE GAME'S (world.mjs enterNode): the live save, the current node destroyed, BitNode 15
// entered by Prestige.ts (DarkscapeNavigator given, the darknet populated by the game). Per lab, in order:
//   charisma   SET to the lab's requirement x --cha-over (the charisma plan's job, chaplan.js — priced
//              separately; this harness measures everything ELSE a lab life costs), re-set after every
//              install (an install resets exp)
//   the crawl  dnet-seed.js on home, which keeps dnet.js on darkweb; every crawler, gap ride, lab walk and
//              cache open is the stack's own code with the game's real ns
//   the clear  the lab's reward cache opened -> the reward QUEUED (Player.queuedAugmentations): the
//              milestone; then the game's installAugmentations (the install path's effect) and the next lab
// Milestones on the ENGINE'S clock (cycles x 200ms; warp.mjs only speeds the timers): the deepest row a
// crawler stands on over time, each air gap crossed, the lab seen / cleared / reward queued.
// --farm-min N: before the labs, the charisma farm (dnet-cha.js) at the entry state for N game-minutes,
// its exp/s per GB measured against chaplan.farmRateOf (the model the trajectory prices with).
//
// CALIBRATION: the farm phase prints the game's measured exp beside chaplan's model (modelErr, every run).
// The lab phases ARE the game's darknet, so their minutes need no model check — but they are NOT CALIBRATED
// as a forecast of a lab LIFE's hours: charisma is injected, and the life's economy (money, home RAM, the
// charisma augmentations it buys) is not played here (tools/sim/lab15.mjs states that part as ASSUMED).
// NOT THE GAME: modules are imported by node (build.mjs's compile seam); charisma is injected (stated);
// the install is the game's installAugmentations, not the install gate's decision (installgate's lab
// rule is tested in tools/test/dnet.test.mjs). Timers are warped (warp.mjs); the clock of record is cycles.
import './warp.mjs'
import { WARP, realSleep } from './warp.mjs'
import fs from 'node:fs'

const argv = process.argv.slice(2)
const opt = (k, d = null) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d
}
const W = await import('./world.mjs')
const { G } = W
const dp = await import('../../../dnetplan.js')
const cp = await import('../../../chaplan.js')

const labsArg = String(opt('labs', '1-5')).split('-').map(Number)
const [labFrom, labTo] = [labsArg[0], labsArg[1] ?? labsArg[0]]
const limitMin = Number(opt('limit-min', 240))
const chaOver = Number(opt('cha-over', 1.02))
const farmMin = Number(opt('farm-min', 0))
const out = { at: new Date(Date.UTC(2000, 0)).toISOString(), warp: WARP, labs: [], farm: null, notes: [] }

const facts = await W.enterNode({ saveFile: opt('save'), node: 15, extraSf: JSON.parse(opt('extra-sf', '[[8,3]]')) })
out.entry = { level: facts.level, home: facts.home, sleeves: facts.sleeves, int: facts.intelligence }
G.Engine.Counters.autoSaveCounter = Infinity
G.Engine.Counters.exportSaveData = Infinity
let cycles = 0
const ticker = setInterval(() => {
  try {
    G.Engine.updateGame(1)
    cycles++
  } catch (e) {
    out.notes.push(`engine tick threw: ${String(e).slice(0, 160)}`)
  }
}, 200)
const gameMin = () => (cycles * 0.2) / 60
const P = G.Player
const chaMult = () => P.mults.charisma * (G.currentNodeMults.CharismaLevelMultiplier ?? 1)
const setCha = (level) => {
  const need = G.calculateExp(level, chaMult()) + 1
  if (P.exp.charisma < need) P.exp.charisma = need
  P.updateSkillLevels()
}
const killAll = () => {
  for (const ws of [...G.workerScripts.values()]) G.killWorkerScript(ws)
}
const crawlerRows = () => {
  const rows = []
  for (const ws of G.workerScripts.values()) {
    if (ws.name !== 'dnet.js') continue
    const s = G.GetServer(ws.hostname)
    if (s && Number.isFinite(s.depth) && s.depth >= 0) rows.push(s.depth)
  }
  return rows
}

// ---------------------------------------------------------------- the charisma farm (dnet-cha.js)
if (farmMin > 0) {
  W.deployRepo()
  const home = P.getHomeComputer()
  const e0 = P.exp.charisma
  const c0 = P.skills.charisma
  const m0 = gameMin()
  const want = Number(opt('farm-workers', 40))
  const pids = []
  for (let i = 0; i < want; i++) {
    const r = W.launch('dnet-cha.js', { args: ['darkweb', '--once-min', String(farmMin), `#${i}`] })
    if (!r.pid) {
      out.notes.push(`farm worker ${i}: ${r.why}`)
      break
    }
    pids.push(r.pid)
  }
  const t0 = Date.now()
  // the model at each level the farm passes through, integrated on the same clock (cycles)
  let modelExp = 0
  let last = gameMin()
  while (pids.some((p) => G.workerScripts.has(p)) && gameMin() - m0 < farmMin + 0.5) {
    await realSleep(500)
    const now = gameMin()
    modelExp += cp.farmRateOf({ cha: P.skills.charisma, workers: pids.length, expMult: P.mults.charisma_exp, int: P.skills.intelligence }) * (now - last) * 60
    last = now
  }
  killAll()
  const secs = (gameMin() - m0) * 60
  const gained = P.exp.charisma - e0
  out.farm = {
    workers: pids.length,
    gameSec: +secs.toFixed(1),
    achievedWarp: +((secs * 1000) / (Date.now() - t0)).toFixed(2),
    homeRam: home.maxRam,
    int: P.skills.intelligence,
    chaExpMult: P.mults.charisma_exp,
    chaFrom: c0,
    chaTo: P.skills.charisma,
    expGained: gained,
    expPerSec: gained / secs,
    modelExp,
    modelErr: modelExp > 0 ? +((gained - modelExp) / modelExp).toFixed(4) : null,
  }
  console.log('FARM', JSON.stringify(out.farm))
}

// ---------------------------------------------------------------- the labs
for (let k = labFrom; k <= labTo; k++) {
  const installed = new Set(P.augmentations.map((a) => a.name))
  const lab = dp.labOf(installed, 15)
  const rec = { lab: k, name: lab.lab.name, depth: lab.lab.depth, cha: lab.lab.cha, reward: lab.reward, gameDepth: G.getNetDepth(), rows: {}, gaps: {}, events: [] }
  if (lab.index !== k - 1) {
    rec.error = `the save faces lab ${lab.index + 1}, not ${k} (installed: ${[...installed].filter((a) => dp.LAB_AUGS.includes(a) || a === dp.RED_PILL).join(', ') || 'no lab augs'})`
    out.labs.push(rec)
    break
  }
  setCha(Math.ceil(lab.lab.cha * chaOver))
  rec.chaSet = P.skills.charisma
  W.deployRepo()
  const m0 = gameMin()
  const seed = W.launch('dnet-seed.js')
  rec.seed = seed.pid ? 'started' : seed.why
  let deepest = -1
  let lastLog = 0
  while (gameMin() - m0 < limitMin) {
    await realSleep(500)
    setCha(Math.ceil(lab.lab.cha * chaOver)) // the farm's job, held constant here
    const t = gameMin() - m0
    const rows = crawlerRows()
    const d = rows.length ? Math.max(...rows) : -1
    if (d > deepest) {
      for (let r = deepest + 1; r <= d; r++) if (!dp.isAirGap(r)) rec.rows[r] ??= +t.toFixed(2)
      for (const g of [8, 16, 24]) if (deepest < g && d > g) rec.gaps[g] ??= +t.toFixed(2)
      deepest = d
    }
    const labSrv = G.GetServer(lab.lab.name)
    if (labSrv?.hasAdminRights && rec.clearedMin === undefined) rec.clearedMin = +t.toFixed(2)
    const queued = P.queuedAugmentations.map((a) => a.name)
    if (queued.includes(lab.reward)) {
      rec.queuedMin = +t.toFixed(2)
      break
    }
    if (t - lastLog >= 5) {
      lastLog = t
      const tel = W.readHomeJson('/tel/dnet.txt')
      rec.events.push({ t: +t.toFixed(1), crawlers: rows.length, deepest: d, rooted: tel?.rooted ?? null, lab: tel?.lab ?? null, gaveUp: tel?.gaveUp ?? null })
      console.log(`lab ${k} t=${t.toFixed(1)}min crawlers ${rows.length} deepest ${d} rooted ${tel?.rooted} lab ${JSON.stringify(tel?.lab)}`)
    }
  }
  rec.tel = W.readHomeJson('/tel/dnet.txt')
  rec.minutes = +(gameMin() - m0).toFixed(2)
  out.labs.push(rec)
  console.log(`LAB ${k}`, JSON.stringify({ ...rec, events: undefined, tel: undefined }))
  killAll()
  if (rec.queuedMin === undefined) break
  // the install (the game's own: every script killed, prestigeAugmentation, the darknet repopulated deeper)
  G.installAugmentations()
  if (!P.augmentations.some((a) => a.name === lab.reward)) {
    rec.error = `${lab.reward} not installed after installAugmentations`
    break
  }
}
clearInterval(ticker)
out.gameMin = +gameMin().toFixed(2)
if (opt('out')) fs.writeFileSync(opt('out'), JSON.stringify(out, null, 1))
console.log(JSON.stringify({ ...out, labs: out.labs.map((l) => ({ ...l, events: undefined, tel: undefined })) }, null, 1))
process.exit(0)
