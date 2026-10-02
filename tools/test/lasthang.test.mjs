// [LH1] tools/lasthang-engine.mjs prints EngineMonitor v3 resume episodes:
// cause, unseen duration, post-resume blocking, the before/after-first-frame
// stamp, the profiler's top frames and UI parking; v2 records still render.
import { Check } from './harness.mjs'
import { report, episodeLines, unseenLines } from '../lasthang-engine.mjs'

const T0 = Date.parse('2026-10-02T12:50:20Z')
const RESUME = Date.parse('2026-10-02T23:02:03Z')

function v3record() {
  return {
    v: 3,
    page: T0 - 3600e3,
    alive: RESUME + 600e3,
    episodeRingCols: ['t', 'ticks', 'cycles', 'engMs', 'maxTickMs', 'maxGapMs', 'resumes', 'starts', 'longTasks', 'maxLongMs', 'commits', 'maxCommitMs', 'heapMB'],
    unseen: { open: null, parkUI: true, periods: 1, focused: true, rafs: 9000, lastRafAt: RESUME + 600e3, lastWatchAt: RESUME + 600e3 },
    profiler: { supported: true, started: 612, summarized: 1, error: null, running: false },
    resumeEpisodes: [
      {
        cause: 'blur-noframes',
        unseenAt: T0,
        shownAt: RESUME,
        unseenMs: RESUME - T0,
        endedBy: 'focus',
        backdatedMs: 427138,
        parked: true,
        parkedAfterMs: 60000,
        parkMs: 4,
        remountMs: 85,
        markerAtStart: `${T0 - 50}|r|0|7|progress.js:sleep`,
        markerAtResume: `${RESUME - 900}|i|0|0|idle`,
        heapAtStart: 900,
        heapAtResume: 950,
        heapMax: 1400,
        firstTickAfterMs: 427200,
        firstTickCycles: 2100,
        firstTickMs: 30,
        firstRafAfterMs: 427938,
        ticks: 600,
        cycles: 4000,
        engMs: 900,
        maxTickMs: 40,
        longCount: 3,
        longest: { at: RESUME, ms: 427138, type: 'longtask', labels: [], framed: false },
        longestTaskMs: 427138,
        longestFrameMs: 427938,
        blockedMs: 427338,
        loafBlockingMs: 0,
        tasks: [
          { after: 0, ms: 427138, type: 'longtask', framed: false },
          { after: 431000, ms: 300, type: 'longtask', framed: true },
        ],
        react: { n: 12, ms: 80, maxMs: 20 },
        ring: [[Math.floor(RESUME / 1000), 1, 5, 3, 3, 0, 4, 0, 0, 0, 0, 0, 950]],
        profile: {
          sampleIntervalMs: 50,
          fromMs: -2000,
          toMs: 460000,
          samples: 9000,
          emptySamples: 8500,
          emptyMs: 425000,
          markers: { style: 3000, layout: 4000, gc: 1500 },
          top: [{ name: 'renderAll', res: 'http://localhost:8000/main.bundle.js', line: 99, col: 7, ms: 1200, n: 24 }],
        },
        windowMs: 600000,
      },
    ],
  }
}

export async function run() {
  const c = new Check('LH1', 'lasthang-engine prints v3 resume episodes (cause, duration, blocking, first-frame stamp, profiler top frames)')
  const rec = v3record()
  const text = episodeLines(rec).join('\n') + '\n' + unseenLines(rec).join('\n')
  const want = [
    ['cause and duration', /BLUR-NOFRAMES 10\.2h/],
    ['backdated resume', /7\.1min late: main thread blocked/],
    ['marker at start', /open marker at start: progress\.js:sleep/],
    ['blocked total', /blocked: 7\.1min/],
    ['first-frame stamp', /BEFORE first frame/],
    ['after first frame', /after first frame/],
    ['profiler frame', /renderAll\s+http:\/\/localhost:8000\/main\.bundle\.js:99:7/],
    ['profiler markers', /markers style 3000, layout 4000, gc 1500/],
    ['empty samples', /8500 with no JS/],
    ['per-second slice', /per second: t ticks cycles/],
    ['profiler state', /PROFILER\s+available; started 612, summarized 1/],
    ['parked', /UI PARKED after 60\.0s \(park 4ms, remount 85ms/],
    ['parking state', /UI parking on/],
  ]
  c.examined(want.length + 4)
  for (const [what, re] of want) if (!re.test(text)) c.fail(`episode output lacks ${what}`, re.toString())

  // a v3 record with no episodes says so; a v2 one still renders
  const none = episodeLines({ v: 3, resumeEpisodes: [] }).join('\n')
  if (!/none \(no unseen period/.test(none)) c.fail('v3 with no episodes is silent', none)
  const v2 = episodeLines({
    v: 2,
    resumeEpisodes: [{ shownAt: RESUME, hiddenMs: 120000, firstTickAfterMs: null, ticks: 0, cycles: 0, engMs: 0, maxTickMs: 0, longCount: 0, longest: null, windowMs: 120000 }],
  }).join('\n')
  if (!/HIDDEN 2\.0min/.test(v2)) c.fail('v2 episode does not render', v2)
  const unparked = episodeLines({ v: 3, resumeEpisodes: [{ ...rec.resumeEpisodes[0], parked: false, parkSkip: 'off', parkedAfterMs: undefined }] }).join('\n')
  if (!/UI not parked \(off\)/.test(unparked)) c.fail('an unparked episode does not say why', unparked.slice(0, 300))

  // the whole report runs on a dump holding the record
  const dump = { [`bbEngine:${rec.page}`]: JSON.stringify(rec), [`bbEngine:${rec.page}:open`]: `${RESUME}|i|0|0|idle`, _thisPage: rec.page + 1 }
  const full = report(dump, 'fixture')
  if (!/RESUME EPISODES \(1;/.test(full)) c.fail('report() omits the episodes', full.slice(0, 400))
  return c
}
