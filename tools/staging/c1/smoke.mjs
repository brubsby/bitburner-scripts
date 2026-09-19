// Exercise the new reporting paths of the staged scripts under a fake ns.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const REPO = '/home/tbusby/Repos/bitburner-scripts'
const STAGE = `${REPO}/tools/staging/c1`

async function loadStaged(name) {
  const src = fs
    .readFileSync(path.join(STAGE, name), 'utf8')
    .replace(/(^\s*import[^'"]*['"])([^'"]+)(['"])/gm, (all, head, spec, tail) => {
      const t = path.join(REPO, spec.replace(/^\.?\//, ''))
      return fs.existsSync(t) ? head + pathToFileURL(t).href + tail : all
    })
  return import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`)
}

// The only way out of a `while (true)` whose catch handles everything is to
// throw from a call site that is OUTSIDE any try — which for every script here
// is the sleep at the bottom of the loop (share.js's is in the catch, still
// outside its nested reporting try). That the sentinel could not escape any
// other way is itself the point of the exercise.
class Stop extends Error {}
function fakeNs(over = {}, maxSleeps = 2) {
  const files = new Map()
  const exits = new Map()
  let slept = 0
  const ns = {
    files,
    exits,
    disableLog() {},
    print() {},
    tprint() {},
    write: (f, c) => files.set(f, c),
    read: (f) => files.get(f) ?? '',
    fileExists: (f) => files.has(f),
    atExit: (cb, id = 'default') => exits.set(id, cb),
    self: () => ({ threads: 600 }),
    sleep: () => {
      if (++slept > maxSleeps) throw new Stop('enough')
      return Promise.resolve()
    },
    flags: (spec) => Object.fromEntries(spec.map(([k, v]) => [k, v])),
    getServerMoneyAvailable: () => 5e12,
    getServerMaxRam: () => 16384,
    getServer: () => ({ cpuCores: 7 }),
    format: { number: (n) => String(n) },
    ...over,
  }
  return ns
}

// homeup.js / nfg.js / settings.js reach the DOM through eval('document') at
// module scope (so the RAM checker never prices it). The paths exercised here
// never touch it; it only has to exist.
globalThis.document = { querySelectorAll: () => [], body: { innerText: '' } }
globalThis.window = {}

let failures = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failures++
}

/* ---------------------------------------------------------- share.js ----- */
{
  const m = await loadStaged('share.js')
  let n = 0
  const ns = fakeNs({
    share: () => {
      n++
      if (n === 3) throw new TypeError('synthetic share failure')
      return Promise.resolve()
    },
  }, 0)
  try {
    await m.main(ns)
  } catch (e) {
    if (!(e instanceof Stop)) throw e
  }
  const body = JSON.parse(ns.files.get('/tel/share.txt'))
  check('share.js publishes /tel/share.txt', !!body)
  check('share.js reports its thread count', body.threads === 600, `threads=${body.threads}`)
  check('share.js keeps an error tail', Array.isArray(body.errors) && body.errors.length === 1, JSON.stringify(body.errors))
  check('share.js error tail names the throw', /TypeError: synthetic share failure/.test(body.errors[0] ?? ''))
  // the atExit path
  check('share.js registered atExit under id "status"', ns.exits.has('status'))
  ns.exits.get('status')()
  const dead = JSON.parse(ns.files.get('/tel/share.txt'))
  check('share.js atExit publishes stopped', dead.health === 'stopped' && dead.exited === true, JSON.stringify({ health: dead.health, exited: dead.exited }))
  check('share.js atExit keeps rounds/threads', dead.threads === 600 && typeof dead.rounds === 'number')
  check('share.js atExit records staleSince', typeof dead.staleSince === 'string')
}

/* --------------------------------------------------------- ctauto.js ----- */
{
  const m = await loadStaged('ctauto.js')
  let cycles = 0
  const ns = fakeNs({
    scan: () => {
      cycles++
      if (cycles === 1) throw new RangeError('synthetic scan failure')
      return []
    },
    ls: () => [],
    codingcontract: { getContractType: () => '', getData: () => null, attempt: () => 0 },
  }, 0)
  try {
    await m.main(ns)
  } catch (e) {
    if (!(e instanceof Stop)) throw e
  }
  const body = JSON.parse(ns.files.get('/tel/ctauto.txt'))
  check('ctauto.js publishes from the catch', body.health === 'error', `health=${body.health}`)
  check('ctauto.js keeps its totals on the error path', body.solved === 0 && body.wrong === 0 && Array.isArray(body.rewards))
  check('ctauto.js error carries a stack', /RangeError: synthetic scan failure/.test(body.detail ?? ''))
  ns.exits.get('status')()
  check('ctauto.js atExit publishes stopped', JSON.parse(ns.files.get('/tel/ctauto.txt')).health === 'stopped')
}

/* ------------------------------------------------------- backdoor.js ----- */
{
  const m = await loadStaged('backdoor.js')
  const ns = fakeNs({
    getHackingLevel: () => 10,
    serverExists: () => true,
    getServer: () => ({ backdoorInstalled: false }),
    getServerRequiredHackingLevel: () => 9999,
    getServerNumPortsRequired: () => 5,
    hasRootAccess: () => false,
    scan: () => [],
  }, 0)
  try {
    await m.main(ns)
  } catch (e) {
    if (!(e instanceof Stop)) throw e
  }
  const body = JSON.parse(ns.files.get('/tel/backdoor.txt'))
  check('backdoor.js publishes remaining[] (watchdog reads it)', Array.isArray(body.remaining) && body.remaining.length === 5, JSON.stringify(body.remaining))
  check('backdoor.js keeps hackingLevel', body.hackingLevel === 10)
  ns.exits.get('status')()
  const dead = JSON.parse(ns.files.get('/tel/backdoor.txt'))
  check('backdoor.js atExit still carries remaining[]', Array.isArray(dead.remaining) && dead.remaining.length === 5)
  check('backdoor.js atExit publishes stopped', dead.health === 'stopped')
}

/* --------------------------------------------------------- homeup.js ----- */
{
  const m = await loadStaged('homeup.js')
  // No money: takes the early "waiting" return without touching the UI.
  const ns = fakeNs({ getServerMoneyAvailable: () => 1 })
  await m.main(ns)
  const body = JSON.parse(ns.files.get('/tel/homeup.txt'))
  check('homeup.js early return publishes', body.health === 'waiting', `health=${body.health}`)
  check('homeup.js publishes a finite nextCost (C4)', typeof body.nextCost === 'number' && body.nextCost > 0, `nextCost=${body.nextCost}`)
  check('homeup.js keeps reserve/money/dry/bought/notes', body.reserve === 1e12 && typeof body.money === 'number' && body.dry === false && Array.isArray(body.bought) && Array.isArray(body.notes))
  ns.exits.get('status')()
  check('homeup.js atExit does NOT overwrite a settled verdict', JSON.parse(ns.files.get('/tel/homeup.txt')).health === 'waiting')
}

/* ------------------------------------------------------- watchdog.js ----- */
{
  const m = await loadStaged('watchdog.js')
  let cycles = 0
  const ns = fakeNs({
    scan: () => {
      cycles++
      if (cycles === 1) throw new ReferenceError('synthetic topology failure')
      return ['home']
    },
    hasRootAccess: () => false,
    ps: () => [],
    getScriptRam: () => 1,
    getServerUsedRam: () => 0,
    getPlayer: () => ({ factions: [] }),
    hasTorRouter: () => true,
  }, 1)
  try {
    await m.main(ns)
  } catch (e) {
    if (!(e instanceof Stop)) throw e
  }
  const body = JSON.parse(ns.files.get('/tel/watchdog.txt'))
  check('watchdog.js survives a throw in the cycle scaffolding', cycles === 2, `cycles=${cycles}`)
  // Cycle 1 threw and published health 'error'; cycle 2 recovered and
  // republished, which is the intended behaviour — so the surviving evidence of
  // the throw is the rolling tail, which is exactly why status.js has one.
  check('watchdog.js recovers and republishes after a cycle throw', body.health === 'degraded', `health=${body.health}`)
  check('watchdog.js keeps the throw in its rolling tail', /ReferenceError: synthetic topology failure/.test((body.errors ?? []).join('\n')))
  // 'degraded', not 'ok': the unstubbed ns.exec made every launch throw, which
  // the per-entry catch recorded as state 'error'. That is the new signal
  // working — an entry that is not being managed no longer reads as healthy.
  check('watchdog.js counts faulted entries', body.faulted > 0, `faulted=${body.faulted}`)
  check('watchdog.js keeps daemons/jobs/restarts/since on the error path', !!body.daemons && !!body.jobs && !!body.restarts && typeof body.since === 'string')
  ns.exits.get('status')()
  check('watchdog.js atExit publishes stopped', JSON.parse(ns.files.get('/tel/watchdog.txt')).health === 'stopped')
}

/* -------------------------------------------------------- autobuy.js ----- */
{
  const m = await loadStaged('autobuy.js')
  let cycles = 0
  const ns = fakeNs({
    hasTorRouter: () => {
      cycles++
      if (cycles === 1) throw new SyntaxError('synthetic tor probe failure')
      return true
    },
    getServerMoneyAvailable: () => 1e12,
    singularity: null,
  }, 1)
  try {
    await m.main(ns)
  } catch (e) {
    if (!(e instanceof Stop)) throw e
  }
  const body = JSON.parse(ns.files.get('/tel/autobuy.txt'))
  check('autobuy.js publishes /tel/autobuy.txt', !!body)
  check('autobuy.js recovers after a throw', cycles === 2, `cycles=${cycles}`)
  check('autobuy.js keeps tor/owned/missing on the good tick', body.tor === true && Array.isArray(body.owned) && typeof body.missing === 'number')
  check('autobuy.js keeps the throw in its rolling tail', /SyntaxError: synthetic tor probe failure/.test((body.errors ?? []).join('\n')))
  ns.exits.get('status')()
  check('autobuy.js atExit publishes stopped', JSON.parse(ns.files.get('/tel/autobuy.txt')).health === 'stopped')
}

/* ------------------------------------------------------------- go.js ----- */
{
  const m = await loadStaged('go.js')
  let n = 0
  const ns = fakeNs({
    getResetInfo: () => ({ ownedSF: new Map([[14, 3]]), currentNode: 4 }),
    getServerMaxRam: () => 16384,
    go: {
      resetBoardState: () => {
        n++
        throw new EvalError('synthetic board failure')
      },
      getGameState: () => ({ komi: 5.5 }),
      analysis: { getValidMoves: () => [], getStats: () => ({}) },
    },
  }, 1)
  try {
    await m.main(ns)
  } catch (e) {
    if (!(e instanceof Stop)) throw e
  }
  const body = JSON.parse(ns.files.get('/tel/go.txt'))
  // The bug: `sf14` was referenced in the status write and declared nowhere, so
  // every write threw ReferenceError into the loop's own catch and the file was
  // never created at all.
  check('go.js publishes /tel/go.txt at all', !!body)
  check('go.js sf14 is a real value, not a ReferenceError', body.sf14 === 3, `sf14=${body.sf14}`)
  check('go.js publishes from the catch', body.health === 'error', `health=${body.health}`)
  check('go.js error carries a stack', /EvalError: synthetic board failure/.test(body.detail ?? ''))
  check('go.js keeps opponent/boardSize/games/moves', body.opponent === 'Daedalus' && body.boardSize === 5 && body.games === 0 && body.moves === 0)
  ns.exits.get('status')()
  check('go.js atExit publishes stopped', JSON.parse(ns.files.get('/tel/go.txt')).health === 'stopped')
}

/* ---------------------------------------------------------- batch.js ----- */
{
  const m = await loadStaged('batch.js')
  const ns = fakeNs({
    getHostname: () => 'joesguns',
    getScriptRam: () => 0, // workers missing on home -> the early return
    scp: () => true,
  })
  await m.main(ns)
  const body = JSON.parse(ns.files.get('/tel/batch.txt'))
  check('batch.js early return publishes instead of only tprinting', body.health === 'error', `health=${body.health}`)
  check('batch.js names the reason', /workers missing on home/.test(body.detail ?? ''))
  check('batch.js publishes controller (which host)', body.controller === 'joesguns')
  check('batch.js registered atExit under id "status"', ns.exits.has('status'))
  ns.exits.get('status')()
  const dead = JSON.parse(ns.files.get('/tel/batch.txt'))
  check('batch.js atExit publishes stopped', dead.health === 'stopped' && dead.exited === true)
  // note.exit republishes the prior body and overlays at/health/exited/
  // staleSince plus whatever fields it is given — so `detail` is deliberately
  // replaced with the exit reason, while everything it does NOT name survives.
  check('batch.js atExit keeps fields it does not override', dead.controller === 'joesguns' && Array.isArray(dead.errors))
  check('batch.js atExit stamps staleSince from the prior write', dead.staleSince === body.at, `${dead.staleSince} vs ${body.at}`)
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall smoke checks passed')
process.exit(failures ? 1 : 0)
