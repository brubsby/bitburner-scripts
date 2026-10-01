#!/usr/bin/env node
// Read the game's EngineMonitor records and say what the page was doing when
// it froze.
//
// The fork's src/Diagnostics/EngineMonitor.ts writes, per page (keyed by
// performance.timeOrigin, like trace.js):
//   bbEngine:<page>        JSON record, flushed ~1/s and on visibility changes
//   bbEngine:<page>:open   "<epochMs>|<kind>|<numCycles>|<pid>|<label>", written
//                          synchronously BEFORE each engine phase / NS resume /
//                          main() / exec / compile / RFA request, and "idle"
//                          when an engine tick ends.
// After a killed freeze the :open marker is the last instrumented thing the
// page started.
//
// Sources (first that works):
//   node tools/lasthang-engine.mjs dump.json     a localStorage dump (object of key -> string)
//   node tools/lasthang-engine.mjs -             the same on stdin
//   node tools/lasthang-engine.mjs --rpc         /tel/engine-dump.txt via the RFA daemon (localhost:12526)
//   node tools/lasthang-engine.mjs               .telemetry/engine-dump.txt (the daemon's mirror)
// Produce the dump in-game with `run enginedump.js`, or from the page console:
//   copy(JSON.stringify(Object.fromEntries(Object.keys(localStorage)
//     .filter(k => /^bb(Engine|Trace):/.test(k)).map(k => [k, localStorage[k]]))))
//
// Options: --page <id> (default: the newest page older than the dumping page,
// i.e. the one that died; --latest for the newest), --json (machine output),
// --ring <n> seconds of per-second counters to print (default 30).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const CTL = `http://localhost:${process.env.CTL_PORT ?? 12526}`

const argv = process.argv.slice(2)
const flag = (f) => argv.includes(f)
const opt = (f, d) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d
}
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--page', '--ring'].includes(argv[i - 1])))

async function loadDump() {
  const src = positional[0]
  if (src === '-') return { from: 'stdin', text: fs.readFileSync(0, 'utf8') }
  if (src) return { from: src, text: fs.readFileSync(src, 'utf8') }
  if (flag('--rpc')) {
    const res = await fetch(`${CTL}/rpc`, {
      method: 'POST',
      body: JSON.stringify({ method: 'getFile', params: { filename: '/tel/engine-dump.txt', server: 'home' } }),
    })
    const j = await res.json()
    if (!j.result) throw new Error(`rpc getFile failed: ${JSON.stringify(j).slice(0, 200)} (run enginedump.js in-game first)`)
    return { from: 'rpc /tel/engine-dump.txt', text: j.result }
  }
  const p = path.join(ROOT, '.telemetry', 'engine-dump.txt')
  return { from: p, text: fs.readFileSync(p, 'utf8') }
}

const iso = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : '-')
const hms = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString().slice(11, 23) : '-')
const dur = (ms) => {
  if (!Number.isFinite(ms)) return '-'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 120e3) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 7200e3) return `${(ms / 60e3).toFixed(1)}min`
  return `${(ms / 3600e3).toFixed(1)}h`
}
const pad = (s, n) => String(s).padEnd(n)
const lpad = (s, n) => String(s).padStart(n)

export function parseMarker(s) {
  if (!s) return null
  const p = String(s).split('|')
  if (p.length < 5) return null
  return { at: Number(p[0]), kind: p[1], cycles: Number(p[2]), pid: Number(p[3]), label: p.slice(4).join('|') }
}

const KIND = {
  p: 'engine phase',
  r: 'Netscript resume',
  m: 'script main() start',
  x: 'ns.exec/run/spawn',
  c: 'script compile',
  i: 'engine idle',
}

export function interpret(marker, rec) {
  if (!marker) return 'no open marker: the monitor never ran on that page (old build, or disabled with bbEngineMonitor=off)'
  const skips = rec?.cur?.markerSkips ?? 0
  const skipNote = skips
    ? ` (NOTE: ${skips} resume/exec markers were skipped by the per-second budget in the last second, so a later event may have gone unmarked)`
    : ''
  switch (marker.kind) {
    case 'p':
      return `the ENGINE was inside "${marker.label}" (numCycles ${marker.cycles}) and never left it. That phase is the culprit.`
    case 'r':
      return (
        `the last instrumented event was a timer resuming ${marker.label} (pid ${marker.pid}). The freeze is that ` +
        `continuation's synchronous run, or something unmarked that ran after it: a script woken by an engine promise ` +
        `(nextUpdate/port/Go), a React render, or GC.${skipNote}`
      )
    case 'm':
      return `script ${marker.label.replace(/:main$/, '')} (pid ${marker.pid}) had just started main(); its first synchronous segment (up to its first await) is the suspect${skipNote}.`
    case 'x':
      return `inside ${marker.label} (pid ${marker.pid} calling): ns.exec/run/spawn never returned — RAM calculation, script creation or compile.`
    case 'c':
      return `inside an uncached ${marker.label}: parse/transform of the script (and its imports) never returned.`
    case 'i':
      return (
        'the engine tick had FINISHED and no Netscript timer resume, main(), exec or RFA request started after it. ' +
        'The freeze is outside every instrumented path: microtask continuations of scripts woken by engine promises ' +
        '(gang/stock/bladeburner nextUpdate, ports, Go), a requestAnimationFrame React render, an uninstrumented event ' +
        'handler, or garbage collection (check heapMB in the ring).'
      )
    default:
      return `unknown marker kind ${marker.kind}`
  }
}

function pickPage(dump) {
  const pages = new Set()
  for (const k of Object.keys(dump)) {
    const m = /^bbEngine:(\d+)/.exec(k)
    if (m) pages.add(Number(m[1]))
  }
  const sorted = [...pages].sort((a, b) => b - a)
  const want = opt('--page')
  if (want) return { pages: sorted, page: Number(want) }
  if (flag('--latest')) return { pages: sorted, page: sorted[0] }
  const self = Number(dump._thisPage)
  const earlier = sorted.filter((p) => !Number.isFinite(self) || p < self)
  return { pages: sorted, page: earlier[0] ?? sorted[0] }
}

function report(dump, from) {
  const { pages, page } = pickPage(dump)
  const out = []
  const say = (s = '') => out.push(s)
  if (page === undefined) {
    say(`no bbEngine records in ${from}`)
    return out.join('\n')
  }
  let rec = null
  try {
    rec = JSON.parse(dump[`bbEngine:${page}`] ?? 'null')
  } catch {
    rec = null
  }
  const marker = parseMarker(dump[`bbEngine:${page}:open`])
  let trace = null
  try {
    trace = JSON.parse(dump[`bbTrace:${page}`] ?? 'null')
  } catch {
    trace = null
  }

  say(`source: ${from}`)
  say(`pages: ${pages.map((p) => `${p}${p === page ? '*' : ''}`).join(' ')}   (dumped from page ${dump._thisPage ?? '?'} at ${iso(dump._dumpedAt)})`)
  say(`page ${page}: loaded ${iso(page)}; record last flushed ${iso(rec?.alive)}`)
  say('')
  if (marker) {
    say(`OPEN MARKER  ${iso(marker.at)}  [${KIND[marker.kind] ?? marker.kind}]  ${marker.label}${marker.pid ? `  pid ${marker.pid}` : ''}${marker.cycles ? `  numCycles ${marker.cycles}` : ''}`)
    if (rec?.alive) say(`             ${dur(marker.at - rec.alive)} after the last record flush`)
    if (trace?.alive) say(`             trace.js last alive ${iso(trace.alive)} (${dur(marker.at - trace.alive)} before the marker)`)
  }
  say(`VERDICT: ${interpret(marker, rec)}`)
  if (rec?.stack?.length) say(`open stack at last flush: ${rec.stack.join(' > ')}`)
  say('')

  if (trace) {
    const open = Object.entries(trace.sections ?? {}).filter(([, v]) => v?.in && (!v.out || v.out < v.in))
    say(`trace.js sections open: ${open.length ? open.map(([k, v]) => `${k} since ${hms(v.in)}`).join(', ') : 'none'}`)
    const lastOut = Object.entries(trace.sections ?? {})
      .map(([k, v]) => [k, Math.max(v?.in ?? 0, v?.out ?? 0)])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
    say(`trace.js most recent: ${lastOut.map(([k, t]) => `${k}@${hms(t)}`).join('  ')}`)
    say('')
  }

  if (!rec) {
    say('(no JSON record for this page)')
    return out.join('\n')
  }

  const t = rec.tick ?? {}
  const tot = rec.totals ?? {}
  say(`ENGINE  ticks ${tot.ticks}  cycles ${tot.cycles}  maxTick ${dur(t.maxTickMs)} at ${hms(t.maxTickAt)}  maxGap ${dur(t.maxGapMs)} at ${hms(t.maxGapAt)}  maxCycles ${t.maxCycles} at ${hms(t.maxCyclesAt)}  unbalanced ${rec.unbalanced}`)
  say(`SCRIPTS started ${tot.starts}  ended ${tot.ends}  resumes ${tot.resumes}  mains ${tot.mains}  execs ${tot.execs}  running ${tot.running} (max ${tot.maxRunning})`)
  if (t.bigGaps?.length) {
    say('tick gaps > 5s (throttled / locked / suspended / recovered stall):')
    for (const g of t.bigGaps.slice(-10)) say(`  ${hms(g.at)}  gap ${lpad(dur(g.gapMs), 8)}  numCycles ${g.cycles}  visible ${g.visible}`)
  }
  say('')

  const vis = rec.visibility ?? {}
  say(`VISIBILITY now ${vis.visible} since ${hms(vis.since)}`)
  for (const e of (vis.events ?? []).slice(-12)) say(`  ${iso(e.at)}  ${pad(e.ev, 9)}${e.afterMs !== undefined ? ` after ${dur(e.afterMs)} in the previous state` : ''}`)
  say('')

  const phases = Object.entries(rec.phases ?? {}).sort((a, b) => b[1].maxMs - a[1].maxMs)
  say('PHASES (by max)                          n      avg      max   max at        cycles@max')
  for (const [k, v] of phases.slice(0, 25)) {
    say(`  ${pad(k, 36)} ${lpad(v.n, 7)} ${lpad((v.totalMs / Math.max(1, v.n)).toFixed(2), 8)} ${lpad(v.maxMs.toFixed(1), 8)}   ${pad(hms(v.maxAt), 12)}  ${v.maxCycles}`)
  }
  say('')

  const ring = [...(rec.ring ?? []), rec.cur].filter(Boolean)
  const n = Number(opt('--ring', 30))
  say(`LAST ${n} ACTIVE SECONDS (the last row is the unfinished second)`)
  say('  time      starts ends resum mains execs  run ticks cycles  engMs maxTick  maxGap heapMB LT maxLT  writes/skip  top start / top resume')
  for (const b of ring.slice(-n)) {
    say(
      `  ${new Date(b.t * 1000).toISOString().slice(11, 19)} ${lpad(b.starts, 6)} ${lpad(b.ends, 4)} ${lpad(b.resumes, 5)} ${lpad(b.mains, 5)} ${lpad(b.execs, 5)} ${lpad(b.running, 4)} ${lpad(b.ticks, 5)} ${lpad(b.cycles, 6)} ${lpad(Math.round(b.engMs), 6)} ${lpad(Math.round(b.maxTickMs), 7)} ${lpad(dur(b.maxGapMs), 7)} ${lpad(b.heapMB ?? '-', 6)} ${lpad(b.longTasks, 2)} ${lpad(Math.round(b.maxLongMs), 5)}  ${lpad(b.markerWrites, 5)}/${pad(b.markerSkips, 5)}  ${b.topStart ?? '-'} / ${b.topResume ?? '-'}`,
    )
  }
  const heaps = ring.map((b) => b.heapMB).filter((x) => Number.isFinite(x))
  if (heaps.length > 1) say(`  heap over the ring: ${heaps[0]}MB -> ${heaps[heaps.length - 1]}MB (max ${Math.max(...heaps)}MB)`)
  say('')

  const lt = rec.longTasks ?? {}
  say(`LONG TASKS (observer: ${(lt.supported ?? []).join(', ') || 'unsupported'}; ${lt.count ?? 0} longtasks total)`)
  for (const x of lt.top ?? []) {
    say(`  ${iso(x.at)}  ${lpad(dur(x.ms), 7)}  ${pad(x.type, 20)} ${x.labels?.length ? `markers: ${x.labels.join(', ')}` : 'no markers inside'}`)
    for (const s of x.scripts ?? []) say(`      ${lpad(s.ms, 6)}ms  ${s.invoker}  ${s.fn}  ${s.src}`)
  }
  if (rec.slowExec?.length) {
    say('SLOWEST exec/compile (> 5ms, synchronous part)')
    for (const x of rec.slowExec) say(`  ${iso(x.at)}  ${lpad(dur(x.ms), 7)}  ${x.what}  ${x.file}`)
  }
  say('')
  const o = rec.overhead ?? {}
  say(`OVERHEAD  self ${o.selfMs}ms = ${o.pctWall}% of wall time; per engine tick avg ${o.perTickUsAvg}us, max ${o.perTickUsMax}us (a cycle is 200000us); marker writes ${o.markerWrites}, skipped ${o.markerSkips}; flushes ${o.flushes}, max ${o.maxFlushMs}ms`)
  return out.join('\n')
}

async function mainCli() {
  const { from, text } = await loadDump()
  const dump = JSON.parse(text)
  if (flag('--json')) {
    const { page } = pickPage(dump)
    const rec = JSON.parse(dump[`bbEngine:${page}`] ?? 'null')
    const marker = parseMarker(dump[`bbEngine:${page}:open`])
    console.log(JSON.stringify({ page, marker, verdict: interpret(marker, rec), record: rec }, null, 2))
    return
  }
  console.log(report(dump, from))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mainCli().catch((e) => {
    console.error(`lasthang-engine: ${e.message}`)
    process.exit(1)
  })
}

export { report }
