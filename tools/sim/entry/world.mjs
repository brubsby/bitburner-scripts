// A BITNODE ENTRY MADE BY THE GAME, and this repo's scripts run against it with a REAL ns.
//
// enterNode(): the live save loaded by the game's own loadGame (SaveObject.ts), the destroyed node's
// Source-File given (RedPill.tsx enterBitNode -> giveSourceFile), then Prestige.ts prestigeSourceFile —
// home RAM per SF9/SF1, $1262 (BN8: its starting money), the SF9.3 hacknet server, the sleeves
// (SF10 + the Covenant's, reset to level 1), augmentations reset (SF12's NeuroFlux given back), the
// stock market per SF8, Stanek's gift cleared. Nothing re-typed. The /tel files on home SURVIVE, exactly
// as they do in the game (CLAUDE.md "Telemetry files survive a BitNode entry").
//
// runScript(): the repo's file (this checkout, not the save's copy) placed on home with
// writeToScriptFile, its RAM the game's static calculator (Script.getRamUsage), a RunningScript and a
// WorkerScript over NetscriptFunctions (tools/staging/ramoverride/rt-probe.mjs: the real dynamic-RAM
// accounting, ramOverride included) — only the module is imported by node instead of the game's blob
// compile. A script that would not fit on home, or is killed by the runtime, says so.
import './env.mjs'
import '../../test/gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { pathToFileURL } from 'node:url'
import { REPO_ROOT } from '../../test/gameresolve.mjs'

export const G = await import('./game.bundle.mjs')

/** The save as the RFA returns it ({result:{save}} gzip latin1), a raw .json.gz backup, or plain JSON text. */
export function saveBytesOf(file) {
  const buf = fs.readFileSync(file)
  if (buf[0] === 0x1f && buf[1] === 0x8b) return new Uint8Array(buf)
  const txt = buf.toString('utf8')
  const j = JSON.parse(txt)
  if (j?.result?.save) return new Uint8Array(Buffer.from(j.result.save, 'latin1'))
  if (j?.ctor === 'BitburnerSaveObject') return new Uint8Array(zlib.gzipSync(Buffer.from(txt, 'utf8')))
  throw new Error(`${file}: not a save (expected the RFA getSaveFile reply, a .json.gz backup, or the save JSON)`)
}

/** Fetch the live save over the daemon's control port (read-only; does not consume the export bonus). */
export async function fetchSave(to, ctl = 'http://localhost:12526') {
  const res = await fetch(`${ctl}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'getSaveFile' }), signal: AbortSignal.timeout(60e3) })
  if (!res.ok) throw new Error(`getSaveFile: HTTP ${res.status}`)
  const j = await res.json()
  if (j.error || !j.result?.save) throw new Error(`getSaveFile: ${j.error ?? 'no save in the reply'}`)
  fs.writeFileSync(to, JSON.stringify(j))
  return to
}

/**
 * Load `saveFile`, destroy the current node (its Source-File +1, capped at 3; BN12 uncapped) and enter
 * `node`. `extraSf` adds Source-Files cleared on the way (a chain of entries), `sfOverride` replaces the
 * whole set. Returns the facts the dry-run states.
 */
export async function enterNode({ saveFile, node, extraSf = [], sfOverride = null, clearCurrent = true }) {
  G.initSourceFiles()
  G.FormatsNeedToChange.emit()
  const ok = await G.loadGame(saveBytesOf(saveFile))
  if (!ok) throw new Error(`loadGame refused ${saveFile}`)
  const P = G.Player
  const from = { node: P.bitNodeN, sf: [...P.sourceFiles] }
  G.initBitNodeMultipliers()
  const cap = (n) => (n === 12 ? Infinity : 3)
  const give = (n) => P.sourceFiles.set(n, Math.min(cap(n), (P.sourceFiles.get(n) ?? 0) + 1)) // SourceFile/applySourceFile + RedPill giveSourceFile
  if (sfOverride) P.sourceFiles = new Map(sfOverride)
  else {
    if (clearCurrent) give(P.bitNodeN)
    for (const [n, l] of extraSf) P.sourceFiles.set(n, Math.max(P.sourceFiles.get(n) ?? 0, l))
  }
  P.bitNodeN = node
  // The entry happens NOW: prestige stamps lastNodeReset/lastAugReset from Player.lastUpdate, which in a
  // save is the last game tick (a hidden tab's can be hours old — that read a node 2.08h old at its start).
  P.lastUpdate = Date.now()
  G.setBitNodeOptions(G.getDefaultBitNodeOptions())
  G.prestigeSourceFile(false) // a destroy, not a flume (Prestige.ts: SF5's intelligence exp)
  const home = P.getHomeComputer()
  return {
    from,
    node,
    level: (P.sourceFiles.get(node) ?? 0) + 1,
    sf: [...P.sourceFiles].sort((a, b) => a[0] - b[0]),
    home: { ram: home.maxRam, cores: home.cpuCores },
    money: P.money,
    sleeves: P.sleeves.length,
    sleevesFromCovenant: P.sleevesFromCovenant,
    hacknet: P.hacknetNodes.length,
    augs: P.augmentations.map((a) => `${a.name}${a.level > 1 ? ` x${a.level}` : ''}`),
    intelligence: P.skills.intelligence,
    lastNodeReset: P.lastNodeReset,
  }
}

/** Put every root .js of this checkout on home (the code under test, not the save's copies). */
export function deployRepo() {
  const home = G.Player.getHomeComputer()
  const names = fs.readdirSync(REPO_ROOT).filter((f) => f.endsWith('.js'))
  for (const f of names) home.writeToScriptFile(f, fs.readFileSync(path.join(REPO_ROOT, f), 'utf8'))
  return names.length
}

export function readHome(file) {
  const f = G.Player.getHomeComputer().getContentFile(file.replace(/^\//, ''))
  return f ? f.content : null
}
export function readHomeJson(file) {
  const t = readHome(file)
  if (!t) return null
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}
export function writeHome(file, content) {
  G.Player.getHomeComputer().writeToContentFile(file.replace(/^\//, ''), content)
}
export function removeHome(file) {
  return G.Player.getHomeComputer().removeFile(file.replace(/^\//, ''))
}
export function homeFiles() {
  return [...G.Player.getHomeComputer().textFiles.keys()]
}

/** The compile seam (build.mjs compileHook): every script the game starts is this checkout's file, imported by node. */
const MODS = new Map()
globalThis.__ENTRY_COMPILE = (script) => {
  const file = path.join(REPO_ROOT, script.filename)
  if (!MODS.has(file)) MODS.set(file, fs.existsSync(file) ? import(pathToFileURL(file).href) : Promise.resolve({ main: async () => { throw new Error(`${script.filename} is not a file of this checkout`) } }))
  return MODS.get(file)
}

/** Start a script the way the game does (NetscriptWorker.startWorkerScript: RAM, pid, the runtime). pid, or 0 with why. */
export function launch(name, { host = 'home', threads = 1, args = [] } = {}) {
  const server = G.GetServer(host)
  const script = server?.scripts.get(name)
  if (!script) return { pid: 0, why: `${name} is not on ${host}` }
  const ram = script.getRamUsage(server.scripts)
  if (ram === null) return { pid: 0, why: `${name}: the game's RAM calculator refused it` }
  const rs = new G.RunningScript(script, ram, args)
  rs.threads = threads
  const pid = G.startWorkerScript(rs, server)
  return pid ? { pid, ram } : { pid: 0, ram, why: `${name} did not start on ${host} (${ram}GB x${threads}; ${server.maxRam - server.ramUsed}GB free)` }
}
/** The game's running scripts: [{pid, name, host, ram, threads, args}]. */
export function running() {
  return [...G.workerScripts.values()].map((ws) => ({ pid: ws.pid, name: ws.name, host: ws.hostname, ram: ws.scriptRef.ramUsage, threads: ws.scriptRef.threads, args: ws.args }))
}
/**
 * A real ns for the dry-run's own reads (getResetInfo, the pure gates' file reads): a WorkerScript of an
 * in-memory script on home (never a repo file — a root .js here would hot-deploy into the live game),
 * with an allocation large enough that no read is refused for RAM. Not added to the running set.
 */
let PROBE = null
export function probeNs() {
  if (PROBE) return PROBE
  const home = G.Player.getHomeComputer()
  home.writeToScriptFile('entry-dryrun-probe.js', 'export async function main(ns) {}')
  const rs = new G.RunningScript(home.scripts.get('entry-dryrun-probe.js'), 1e6, [])
  PROBE = new G.WorkerScript(rs, 899999, G.NetscriptFunctions).vars
  return PROBE
}
export const sleepMs =(ms) => new Promise((r) => setTimeout(r, ms))

let PID = 900000
/**
 * Run one script's main() on home with the game's ns. Resolves { ok, ram, ms, error, killed, fit }.
 * `timeoutMs` kills it (the game's kill: atExit hooks run) — for daemons, after their first publish.
 */
export async function runScript(name, args = [], { timeoutMs = 600e3, until = null } = {}) {
  const home = G.Player.getHomeComputer()
  const script = home.scripts.get(name)
  if (!script) return { ok: false, error: `${name} is not on home` }
  const ram = script.getRamUsage(home.scripts)
  if (ram === null) return { ok: false, error: `${name}: the game's RAM calculator refused it (a syntax error or an unknown import)` }
  const free = home.maxRam - home.ramUsed
  if (ram > free) return { ok: false, ram, fit: false, error: `${name} needs ${ram}GB, home has ${free}GB free of ${home.maxRam}GB` }
  const rs = new G.RunningScript(script, ram, args)
  const pid = ++PID
  home.updateRamUsed(home.ramUsed + ram)
  const ws = new G.WorkerScript(rs, pid, G.NetscriptFunctions)
  G.workerScripts.set(pid, ws)
  home.runScript(rs)
  const t0 = Date.now()
  const mod = await import(pathToFileURL(path.join(REPO_ROOT, name)).href)
  let error = null
  let killed = false
  let timer = null
  let poll = null
  const done = new Promise((resolve) => {
    timer = setTimeout(() => {
      killed = `timeout ${timeoutMs}ms`
      G.killWorkerScript(ws)
      resolve()
    }, timeoutMs)
    if (until) {
      poll = setInterval(() => {
        try {
          if (until()) {
            killed = 'its first publish (a daemon: stopped there)'
            G.killWorkerScript(ws)
            resolve()
          }
        } catch {
          /* keep polling */
        }
      }, 50)
    }
  })
  await Promise.race([
    (async () => {
      try {
        await mod.main(ws.vars)
      } catch (e) {
        if (!(e instanceof G.ScriptDeath)) error = String(e?.stack ?? e).slice(0, 1200)
        else if (!killed) killed = `ScriptDeath: ${String(ws.scriptRef?.logs?.slice?.(-3)?.join(' | ') ?? '').slice(0, 400)}`
      }
    })(),
    done,
  ])
  clearTimeout(timer)
  if (poll) clearInterval(poll)
  if (!ws.stopFlag) G.killWorkerScript(ws)
  return { ok: !error && !(killed && !String(killed).startsWith('its first publish')), ram, ms: Date.now() - t0, error, killed, logs: (ws.scriptRef?.logs ?? []).slice(-12) }
}
