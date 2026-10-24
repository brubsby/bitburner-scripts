// THE ENTRY DRY-RUN: no node should start on a hold or broken pricing.
//
//   node tools/sim/entry/dryrun.mjs --node 5 --level 2 [--save FILE] [--boot-s 90] [--out FILE] [--keep-tel DIR]
//   node tools/sim/entry/dryrun.mjs --chain 5.2,5.3,8.2 [--save FILE] [--summary FILE]
//
// BN11.1 lost ~0.8h to a start-of-node gift pricing hold; BN10.3 ~5.5h to an absurd Covenant combat leg,
// hack + gift unpriced and a 35x-low income model. Each was found live. This finds them before the exit.
//
// THE STATE IS THE GAME'S (world.mjs): the live save loaded by loadGame, the current node destroyed (its
// SF +1), --chain's earlier nodes' SFs added, then Prestige.ts prestigeSourceFile into the target — home
// RAM per SF9/SF1, $1262 (BN8's own), the SF9.3 hacknet server, every sleeve (SF10 + the Covenant's) at
// level 1, augmentations reset, SF12's NeuroFlux, the /tel files of the last node SURVIVING as they do.
//
// THE CODE IS THE STACK'S, with the game's ns (NetscriptFunctions over WorkerScripts):
//   1. boot     boot.js and whatever it, the watchdog and act.js start, running concurrently in real time
//               for --boot-s (default 90) with the game loop ticking (Engine.updateGame: work, sleeves,
//               hacknet; autosave off) — the node's first minute as the stack lives it.
//   2. entry    the watchdog and act.js stopped; every snapshot actor, then one full progress.js pass (the
//               route + gift chain, the Covenant mandate, the install gate, the slot, every decision), then
//               act.js resumed for one cycle (it executes the orders through its own gates), stanek.js and
//               endgame.js (--dry) one cycle each.
//   3. joined   where the Bladeburner division exists: combat to 100, Player.startBladeburner (SF7.3's
//               Simulacrum arrives here), the snapshots and one more progress.js pass.
// evaluate.mjs reads what they published through the readers' own functions (stanekplan's gift gate,
// bbslot's claim) and names every decision that came out unpriced, held, absurd (> 1000h or non-finite)
// or blocked, with the cause the publisher gave.
//
// WHAT IS NOT THE GAME (stated): a script's module is node's import of this checkout (build.mjs's compile
// seam), not the game's blob compile; time is real time (90s of boot, not the node's first hour — a
// measured income does not exist yet, so the priors are what is tested); the save's own copies of the
// scripts are replaced by this checkout's. NOT CALIBRATED as a forecast of hours: it is a detector.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../../..')
const argv = process.argv.slice(2)
const opt = (k, d = null) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d
}
const has = (k) => argv.includes(`--${k}`)

/** "5.2,5.3" -> [{node:5, level:2}, ...] */
export function parseChain(s) {
  return String(s)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const m = /^(?:BN)?(\d+)\.(\d+)$/i.exec(x)
      if (!m) throw new Error(`--chain: '${x}' is not N.L`)
      return { node: +m[1], level: +m[2] }
    })
}
/** The Source-Files each entry of a chain needs beyond the save + the cleared node: the earlier entries cleared, and SF N at L-1. */
export function chainExtras(chain) {
  return chain.map((t, i) => {
    const m = new Map()
    for (const p of chain.slice(0, i)) m.set(p.node, Math.max(m.get(p.node) ?? 0, p.level))
    if (t.level > 1) m.set(t.node, Math.max(m.get(t.node) ?? 0, t.level - 1))
    return [...m]
  })
}

async function saveFile() {
  const s = opt('save')
  if (s) return s
  const W = await import('./world.mjs')
  const to = path.join(os.tmpdir(), `entry-dryrun-save-${process.pid}.json`)
  return W.fetchSave(to)
}

// ------------------------------------------------------------------ one node, in this process
async function one() {
  const t0 = Date.now()
  const W = await import('./world.mjs')
  const { G } = W
  const { evaluate, acceptConsistencyOf } = await import('./evaluate.mjs')
  const { canAccessCotMG, canJoinBladeburner } = await import('../../../sfgate.js')
  const { bitNodeMults } = await import('../../../bitNodeMultipliers.js')
  const node = Number(opt('node'))
  const level = Number(opt('level', 0)) || null
  const extraSf = JSON.parse(opt('extra-sf', '[]'))
  const steps = []
  const step = (what, r) => steps.push({ what, ...r, t: Math.round((Date.now() - t0) / 1000) })
  const facts = await W.enterNode({ saveFile: await saveFile(), node, extraSf })
  if (level && facts.level !== level) throw new Error(`entering BN${node} gives level ${facts.level}, not ${level}: the save's SF${node} with --extra-sf ${JSON.stringify(extraSf)}`)
  W.deployRepo()
  // the game loop (real time): work, sleeves, hacknet, counters — never the autosave
  G.Engine.Counters.autoSaveCounter = Infinity
  G.Engine.Counters.exportSaveData = Infinity
  const ticker = setInterval(() => {
    try {
      G.Engine.updateGame(1)
    } catch (e) {
      step('engine tick threw', { error: String(e).slice(0, 200) })
    }
  }, 200)
  const killAll = (names) => {
    for (const ws of [...G.workerScripts.values()]) if (!names || names.includes(ws.name)) G.killWorkerScript(ws)
  }
  const runToEnd = async (name, args = [], { host = 'home', timeoutMs = 600e3 } = {}) => {
    let h = host
    let r = W.launch(name, { host, args })
    if (!r.pid && host === 'home' && name.startsWith('snap-')) {
      // act.js's own placement for a snapshot actor that does not fit on home: any rooted host with room
      // (never the planner: progress.js raises on home and must run there — refused is a finding)
      for (const s of G.GetAllServers()) {
        if (!s.hasAdminRights || s.hostname === 'home') continue
        if (!s.scripts.has(name)) for (const f of fs.readdirSync(REPO).filter((x) => x.endsWith('.js'))) s.writeToScriptFile(f, fs.readFileSync(path.join(REPO, f), 'utf8'))
        r = W.launch(name, { host: s.hostname, args })
        if (r.pid) {
          h = s.hostname
          break
        }
      }
    }
    if (!r.pid) return { ok: false, why: r.why }
    const until = Date.now() + timeoutMs
    while (G.workerScripts.has(r.pid) && Date.now() < until) await W.sleepMs(100)
    const timedOut = G.workerScripts.has(r.pid)
    if (timedOut) G.killWorkerScript(G.workerScripts.get(r.pid))
    return { ok: !timedOut, host: h, ram: r.ram, why: timedOut ? `still running after ${timeoutMs / 1000}s (killed)` : null }
  }
  const cycle = async (name, file, ms = 60e3, args = []) => {
    const before = W.readHome(file)
    const r = W.launch(name, { args })
    if (!r.pid) return { ok: false, why: r.why }
    const until = Date.now() + ms
    while (G.workerScripts.has(r.pid) && Date.now() < until && W.readHome(file) === before) await W.sleepMs(200)
    const ws = G.workerScripts.get(r.pid)
    if (ws) {
      ws.atExit = null // a daemon stopped after its cycle: its kill-time record must not overwrite the cycle's
      G.killWorkerScript(ws)
    }
    return { ok: W.readHome(file) !== before, why: W.readHome(file) === before ? `${file} not written in ${ms / 1000}s` : null }
  }
  const snapshots = async () => {
    const out = []
    for (const s of ['snap-owned.js', 'snap-catalog.js', 'snap-augprice.js', 'snap-augstats.js', 'snap-prereq.js', 'snap-rep.js', 'snap-invites.js', 'snap-static.js']) {
      const r = await runToEnd(s, [], { timeoutMs: 60e3 })
      if (!r.ok) out.push(`${s}: ${r.why}`)
    }
    return out
  }
  const probe = W.probeNs()
  const infoNow = () => probe.getResetInfo()
  const read = (file, raw = false) => {
    const t = W.readHome(file)
    if (raw) return t || null
    if (!t) return null
    try {
      return JSON.parse(t)
    } catch {
      return null
    }
  }
  read.ns = probe
  const phases = []
  const keepTel = (phase) => {
    if (!opt('keep-tel')) return
    for (const f of W.homeFiles()) {
      if (!f.startsWith('tel/')) continue
      const to = path.join(opt('keep-tel'), phase, f.slice(4))
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.writeFileSync(to, W.readHome(f))
    }
  }
  // the forced planner pass: its own failure to run (no room on home, a timeout) is a finding — the stack's
  // earlier pass on file must never stand in for it
  let passFail = null
  const plannerPass = async (label) => {
    const r = await runToEnd('progress.js', [], { timeoutMs: Number(opt('pass-s', 900)) * 1000 })
    step(label, r)
    passFail = r.ok ? null : { level: 'fail', kind: 'NOT RUN', decision: 'progress.js', what: `the planner pass did not run to its end (${label})`, cause: r.why }
  }
  const judge = (phase) => {
    keepTel(phase)
    const info = infoNow()
    const findings = [...(passFail ? [{ ...passFail, phase }] : []), ...evaluate({ read, info, canCotMG: canAccessCotMG(info), phase })]
    const prog = read('/tel/progress.txt')
    const plan = read('/tel/plan.txt')
    const br = plan?.decisions?.bladeRoute
    phases.push({
      phase,
      findings,
      decisions: {
        route: br ? { key: br.key, hackH: br.hackH ?? null, bladeH: br.bladeH ?? null, unpriced: br.unpriced ?? [], held: !!br.held, why: String(br.why ?? '').slice(0, 300) } : null,
        gift: prog?.route?.gift ? { accepted: prog.route.gift.accepted, accept: prog.route.gift.accept, why: String(prog.route.gift.why ?? '').slice(0, 300) } : null,
        exitH: plan?.exit?.meanH ?? null,
        slot: prog?.slot ? { owner: prog.slot.owner, why: String(prog.slot.why ?? '').slice(0, 200) } : null,
        install: plan?.decisions?.install ? { key: plan.decisions.install.key, why: String(plan.decisions.install.why ?? '').slice(0, 200) } : null,
        income: prog?.income ? { perSec: prog.income.incomePerSec, source: prog.income.source, why: String(prog.income.why ?? '').slice(0, 160) } : null,
        incomeModel: read('/tel/exitinputs.txt')?.inputs?.incomeModelWhy ?? null,
      },
    })
  }

  // 1. boot
  const bootS = Number(opt('boot-s', 90))
  const boot = W.launch('boot.js')
  step('boot.js', { ok: !!boot.pid, why: boot.why ?? null })
  await W.sleepMs(bootS * 1000)
  step('stack after boot', { running: W.running().map((x) => `${x.name}@${x.host}`).filter((x) => !/^[hgw]\.js@/.test(x)) })
  const bootRec = read('/tel/boot.txt')
  if (bootRec?.failed?.length) step('boot.txt failed', { failed: bootRec.failed })

  // 2. entry: the planner's first full pass
  killAll(['watchdog.js', 'act.js', 'progress.js'])
  const snap = await snapshots()
  step('snapshots', { ok: !snap.length, why: snap.join('; ') || null })
  await plannerPass('progress.js')
  step('act.js cycle', await cycle('act.js', '/tel/act.txt', 45e3))
  if (canAccessCotMG(infoNow())) step('stanek.js cycle', await cycle('stanek.js', '/tel/stanek.txt', 60e3))
  step('endgame.js', await runToEnd('endgame.js', ['--next', String(Number(opt('next', 0)) || node), '--dry'], { timeoutMs: 60e3 }))
  judge('entry')

  // 2b. accepted: stanek.js took the gift on the chain's verdict — the next pass prices the route WITH it
  // from the live state; the accept must survive its own re-pricing (evaluate.acceptConsistencyOf)
  const entryRoute = read('/tel/plan.txt')?.decisions?.bladeRoute ?? null
  const genesis = (i) => [...(i.ownedAugs?.keys?.() ?? [])].includes("Stanek's Gift - Genesis")
  if (canAccessCotMG(infoNow()) && genesis(infoNow()) && entryRoute?.gift?.chain) {
    const s1 = await snapshots()
    step('snapshots (accepted)', { ok: !s1.length, why: s1.join('; ') || null })
    await plannerPass('progress.js (accepted)')
    judge('accepted')
    phases[phases.length - 1].findings.push(...acceptConsistencyOf({ entry: entryRoute, accepted: read('/tel/plan.txt')?.decisions?.bladeRoute ?? null }))
  }

  // 3. joined: the Bladeburner division (SF7.3's Simulacrum at the join)
  const info = infoNow()
  if (canJoinBladeburner(info) && bitNodeMults(info)?.BladeburnerRank > 0 && !has('no-join')) {
    const P = G.Player
    for (const s of ['strength', 'defense', 'dexterity', 'agility']) P.exp[s] = Math.max(P.exp[s], G.calculateExp(100, P.mults[s] * (G.currentNodeMults[`${s[0].toUpperCase()}${s.slice(1)}LevelMultiplier`] ?? 1)) + 1)
    P.updateSkillLevels()
    if (!P.bladeburner) P.startBladeburner()
    step('joined Bladeburner', { combat: ['strength', 'defense', 'dexterity', 'agility'].map((s) => P.skills[s]), simulacrum: P.augmentations.some((a) => a.name === "The Blade's Simulacrum") })
    killAll(['progress.js'])
    const s2 = await snapshots()
    step('snapshots (joined)', { ok: !s2.length, why: s2.join('; ') || null })
    await plannerPass('progress.js (joined)')
    step('act.js cycle (joined)', await cycle('act.js', '/tel/act.txt', 45e3))
    judge('joined')
  }
  clearInterval(ticker)

  const findings = phases.flatMap((p) => p.findings)
  return { label: `BN${node}.${facts.level}`, node, level: facts.level, ok: !findings.some((f) => f.level === 'fail'), facts, findings, phases, steps, ms: Date.now() - t0 }
}

// ------------------------------------------------------------------ a chain, one child process per node
function runChain() {
  const chain = parseChain(opt('chain'))
  const extras = chainExtras(chain)
  const save = opt('save')
  const out = []
  for (let i = 0; i < chain.length; i++) {
    const t = chain[i]
    const file = path.join(os.tmpdir(), `entry-dryrun-${process.pid}-${t.node}.${t.level}.json`)
    const args = [path.join(HERE, 'dryrun.mjs'), '--node', String(t.node), '--level', String(t.level), '--extra-sf', JSON.stringify(extras[i]), '--save', save, '--out', file, '--boot-s', opt('boot-s', '90')]
    if (chain[i + 1]) args.push('--next', String(chain[i + 1].node))
    if (opt('keep-tel')) args.push('--keep-tel', path.join(opt('keep-tel'), `BN${t.node}.${t.level}`))
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 45 * 60e3, maxBuffer: 64 << 20 })
    let rec = null
    try {
      rec = JSON.parse(fs.readFileSync(file, 'utf8'))
      fs.rmSync(file, { force: true })
    } catch {
      rec = { label: `BN${t.node}.${t.level}`, node: t.node, level: t.level, ok: false, findings: [{ level: 'fail', kind: 'NOT RUN', decision: 'dry-run', what: `the dry-run of BN${t.node}.${t.level} did not finish (exit ${r.status}${r.signal ? `, ${r.signal}` : ''})`, cause: String(r.stderr || r.stdout || r.error || '').slice(-600) }] }
    }
    out.push(rec)
    process.stderr.write(`${rec.label}: ${rec.ok ? 'ok' : `${rec.findings.filter((f) => f.level === 'fail').length} problem(s)`}\n`)
  }
  return out
}

/** The node the save is in (the one the chain's first entry leaves), read off the save itself. */
function saveNodeOf(file) {
  try {
    const buf = fs.readFileSync(file)
    let txt
    if (buf[0] === 0x1f && buf[1] === 0x8b) txt = zlib.gunzipSync(buf).toString('utf8')
    else {
      const j = JSON.parse(buf.toString('utf8'))
      txt = j?.result?.save ? zlib.gunzipSync(Buffer.from(j.result.save, 'latin1')).toString('utf8') : JSON.stringify(j)
    }
    return JSON.parse(JSON.parse(txt).data.PlayerSave).data.bitNodeN ?? null
  } catch {
    return null
  }
}

export function summaryOf(results, extra = {}) {
  return {
    at: new Date().toISOString(),
    by: 'tools/sim/entry/dryrun.mjs',
    ok: results.every((r) => r.ok),
    nodes: results.map((r) => ({ label: r.label, ok: r.ok, problems: (r.findings ?? []).filter((f) => f.level === 'fail').map((f) => `${f.kind} ${f.decision}: ${f.what}${f.cause ? ` — ${f.cause}` : ''}`), notes: (r.findings ?? []).filter((f) => f.level === 'note').map((f) => `${f.kind} ${f.decision}: ${f.what}`), decisions: r.phases?.map((p) => ({ phase: p.phase, ...p.decisions })) ?? null })),
    ...extra,
  }
}

function print(r) {
  console.log(`\n${r.label} ${r.ok ? 'OK' : 'PROBLEMS'}  (entered from BN${r.facts?.from?.node}: home ${r.facts?.home?.ram}GB, $${r.facts?.money}, ${r.facts?.sleeves} sleeves, hacknet ${r.facts?.hacknet}, augs ${r.facts?.augs?.join(', ') || '-'})`)
  for (const p of r.phases ?? []) {
    const d = p.decisions
    console.log(`  [${p.phase}] route ${d.route?.key ?? 'null'} (hack ${d.route?.hackH ?? '-'}h, blade ${d.route?.bladeH ?? '-'}h) gift accept ${d.gift ? JSON.stringify(d.gift.accept) : '-'} exit ${d.exitH ?? '-'}h slot ${d.slot?.owner ?? 'null'} income ${d.income?.perSec ?? '-'}/s (${d.incomeModel ?? '-'})`)
  }
  for (const f of r.findings ?? []) console.log(`  ${f.level === 'fail' ? '!!' : '--'} [${f.phase}] ${f.kind} ${f.decision}: ${f.what}${f.cause ? `\n       cause: ${f.cause}` : ''}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (opt('chain')) {
    if (!opt('save')) {
      const W = await import('./world.mjs')
      argv.push('--save', await W.fetchSave(path.join(os.tmpdir(), `entry-dryrun-save-${process.pid}.json`)))
    }
    const results = runChain()
    for (const r of results) print(r)
    const first = parseChain(opt('chain'))[0]
    const sum = summaryOf(results, { chain: opt('chain'), from: saveNodeOf(opt('save')), next: { node: first.node, level: first.level, label: `BN${first.node}.${first.level}` } })
    if (opt('summary')) fs.writeFileSync(opt('summary'), JSON.stringify(sum, null, 2))
    process.exit(sum.ok ? 0 : 1)
  } else {
    let r
    try {
      r = await one()
    } catch (e) {
      r = { label: `BN${opt('node')}.${opt('level') ?? '?'}`, ok: false, findings: [{ level: 'fail', kind: 'NOT RUN', decision: 'dry-run', what: 'the dry-run threw', cause: String(e?.stack ?? e).slice(0, 800) }] }
    }
    if (opt('out')) fs.writeFileSync(opt('out'), JSON.stringify(r))
    else print(r)
    process.exit(r.ok ? 0 : 1)
  }
}
