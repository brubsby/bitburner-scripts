# Bitburner scripts — working notes

Personal Netscript collection for [Bitburner](https://github.com/bitburner-official/bitburner-src),
plus the tooling that lets an agent iterate on it against a live game.

## The two repos

| Path | What it is |
| --- | --- |
| `~/Repos/bitburner-scripts` | This repo. Netscript at the root, tooling under `tools/`. |
| `~/Repos/bitburner` | Fork of the game. Fast-forwarded from v0.52.9 (2021) to upstream `bitburner-official/bitburner-src`. |

The fork's original parent `danielyxie/bitburner` is dead — upstream is
`bitburner-official/bitburner-src`, added as the `upstream` remote.

**The game source is the authority on every mechanic.** Read it rather than
recalling how Bitburner worked; v2 and v3 changed the API and several formulas
substantially, and most material on the web predates that.

## Running the loop

```bash
cd ~/Repos/bitburner && npm run start:dev     # game at http://localhost:8000
cd ~/Repos/bitburner-scripts && npm run daemon # RFA websocket 12525, control HTTP 12526
npm run gosolver                               # external Go search (optional but wanted)
```

`gosolver` is the IPvGO brain: go.js in-game writes each position to
`/go/req.txt`, this process answers `/go/move.txt` with a real UCT search
(`golib.js`), niced to 19 so it only uses idle CPU. Netscript shares the
browser main thread, so meaningful search cannot run in-game — 20ms/move lost
90 straight to the Daedalus AI. go.js falls back to its own weak local search
if the solver is not running, so this process dying degrades the bot rather
than stopping it. The watchdog cannot restart OS processes — if Go results
look weak, check this is alive first.

Then in-game: Options → Remote API → port `12525` → Connect.

- `tools/rfa-daemon.mjs` serves the Remote File API; **the game connects to us**.
- Restarting the daemon drops the game's websocket. It shows "Reconnecting" but
  often will not recover on its own. **Suspending the machine does the same
  thing** — the game keeps running on wake, the socket does not, and telemetry
  silently freezes at the moment of sleep while the run carries on. Avoid
  restarting it while agents are working.

**Reconnecting does NOT need a human.** This said "reconnect by hand in Options",
which is wrong: it is reachable from the page, so an agent with browser access
can do it. The Options UI is also often *unavailable* exactly when needed,
because focused faction work hides the entire sidebar. Go to the module instead:

```js
let req = null
window.webpackChunkbitburner.push([['rfa_' + Date.now()], {}, (r) => (req = r)])
const m = req.c['./src/RemoteFileAPI/RemoteFileAPI.ts'].exports
m.getRemoteFileApiConnectionStatus()   // "Online" | "Reconnecting" | ...
if (!m.isRemoteFileApiConnectionLive()) m.newRemoteFileApiConnection()
```

Observed live: status `"Reconnecting"`, `isRemoteFileApiConnectionLive()` false
and stuck there after a machine sleep; one `newRemoteFileApiConnection()`
returned it to `"Online"` in three seconds. The overview's "Remote API status"
icon button did **not** do it, and neither Escape nor the modal close button
reached the dialog queue — a deep stack of install modals was covering the UI.
Those clear with a synthetic document keydown, which `AlertManager` listens for:

```js
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
```

**Check `curl localhost:12526/status` for `connected: true` before trusting any
telemetry read.** A frozen `lastTelemetry` is the only symptom, and stale
telemetry reads exactly like a quiet game.

### Hot reload — the thing to be careful about

**Every `.js` at the repo root is pushed into the running game within ~150ms of
being saved.** A broken save goes live immediately. The daemon logs each push
with its in-game RAM cost and the delta from the previous push, which is the
fastest signal that an edit got expensive.

**Only these directories are skipped**, and the list is exact — it is
`SKIP_DIRS` in `tools/rfa-daemon.mjs`: `node_modules/`, `tools/`, `variants/`,
`archive/`, `min/`, `.git/`, `.telemetry/`, `.idea/`, plus anything starting with
a dot — which is why the preserved set lives in `.variants/`: adding a NEW name
to SKIP_DIRS only takes effect when the daemon restarts, while the dot rule
works immediately.
**Put experiments in `tools/`.**

`docs/`, `backups/` and `cw/` are *walked*. They look safe only because the
extension filter is `.js .jsx .ts .tsx .txt .script` and they happen to contain
`.md` and `.json` — so **a `.js` or `.txt` dropped into `docs/` hot-deploys into
the live game**, and `cw/exports.js` already does. This file said otherwise for
a long time; it was wrong, which is worth remembering before trusting any other
"safe place" claim here over the daemon source.

**Copies on other servers.** A script `scp`'d to another host does not track the
original, so editing a file used to update home and leave every copy stale — and
a supervisor restarted on another host would silently come back running old
code. `/sync` had the same blind spot, so the obvious way to check made the
problem look absent. The daemon now overwrites every copy it can find on a
push, and `watchdog.js` re-copies from home before relaunching anything. If you
are ever debugging "the fix didn't take", check the file on the *target* server,
not home.

Scripts are pushed alphabetically, so a file can land before a module it
imports and fail to compile; the daemon rechecks those once everything is
present.

**The auto-push is not reliable — verify before trusting it.** On 2026-09-12
two consecutive edits (`boot.js`, `watchdog.js`) never reached the game at all;
only an explicit `curl localhost:12526/sync` delivered them. Nothing reported an
error, and the running game happily executed the old code, so the fix looked
applied and simply had no effect. Two separate debugging sessions were derailed
by it.

```bash
npm run verify        # every tracked file vs every server; exit 1 if anything differs
npm run verify:home   # home only, ~350ms
curl -s localhost:12526/sync   # the fix, when it reports drift
```

`tools/verify-deploy.mjs` names the file, the server, the two hashes and the
first differing line. It is read-only — it never pushes, because a check that
silently repairs hides how often the push is broken. Run it after editing
anything you are about to rely on, and gate anything expensive on it; exit 2
means "could not check", which is deliberately not the same as "fine".

The daemon checks itself too, so this is not only something to remember: it
reads every push straight back out of the game, and on each telemetry poll
screens `getAllFileMetadata` for a disk mtime newer than the game's — which
catches the case where the file watcher never fired at all and no push-path
code ran to notice. Both log a `!!!!!` banner naming the file. Mismatches are
reported, never auto-fixed.

Editing a file does **not** restart it. A running script keeps its old code until
killed; `watchdog.js` revives anything in its list within 30s, so the usual way
to reload something is to kill it and let the watchdog bring it back.

**A stale instance actively fights the new code**, and it is hard to recognise
because the symptoms look like a bug in whatever you are currently debugging. A
pre-refactor `torbuy.js` kept looping every 20s — navigating to Alpha
Enterprises (so every page under inspection "mysteriously" snapped back there)
and calling an unconditional `ns.rm('/tel/ui-lock.txt')` (so the new mutex kept
vanishing). Two separate investigations were derailed by it. **When behaviour
contradicts the code you are reading, check what is actually running** —
`ps home` or the process list in `.telemetry/status.txt` — before theorising.

### Control port

```bash
curl localhost:12526/status          # connected? files tracked? last telemetry?
curl localhost:12526/state           # latest decoded save digest
curl localhost:12526/poll            # force a telemetry refresh, then print it
curl localhost:12526/sync            # re-push everything
curl localhost:12526/hosts           # rooted hostnames (the RFA has no way to list servers)
curl localhost:12526/verify          # disk vs game; HTTP 409 if anything drifted
curl -X POST localhost:12526/rpc -d '{"method":"getFileNames","params":{"server":"home"}}'
```

`/hosts` and `/verify` need a daemon restart to appear; everything else is live.

`/rpc` passes through to any Remote File API method: `pushFile`, `getFile`,
`deleteFile`, `getFileNames`, `getAllFiles`, `calculateRam`,
`getDefinitionFile`, `getSaveFile`, and — undocumented above but present in
`RemoteFileAPI/MessageHandlers.ts` — `getFileMetadata` and `getAllFileMetadata`,
which return `size`/`atime`/`mtime`/`btime`. `getAllFileMetadata` on home costs
~34ms against ~200ms and 2.1MB for `getAllFiles`, and the game stamps `mtime` on
every write, so it is the cheap way to ask "has the game seen my latest save?".

**Body legs (combat stats, karma, kills) are priced and acted on.** `bodyplan.js` is
the model (gym rate, crime trajectory), `joinplan.js` prices them as ACTIVE
legs, and the body step in `progress.js` performs them (crime first, then one
gym class per stat, at the named gym). Kills and every skill's exp reset at an
install; karma does not. A leg longer than the remaining window is reported as
`unreachable in one install window` with `why`, never as null. The
calibration probe on 2026-09-19 matched the game exactly (gym 37.661 exp/s,
Homicide chance 0.6628); `docs/pricing-gaps.md` has the table.

**A BitNode entry (flume or destruction) kills every script and NOTHING reboots
the stack.** Measured 2026-09-19: after `enterBitNode(true, 5, 2, ...)` the game sat
at hacking 1, $1,262, zero processes for 40 minutes while stale telemetry files
(from before the flume) read like a live run. cmd.js is dead too, so the bridge
cannot help. From the page:

```js
let req = null
window.webpackChunkbitburner.push([['boot_' + Date.now()], {}, (r) => (req = r)])
await req.c['./src/Terminal.ts'].exports.Terminal.executeCommands('run boot.js')
```

(`./src/Terminal/Terminal.ts` exports the class; the INSTANCE is in `./src/Terminal.ts`.)
Flume itself: `req.c['./src/RedPill.tsx'].exports.enterBitNode(true, from, to,
req.c['./src/BitNode/BitNodeUtils.ts'].exports.getDefaultBitNodeOptions())`.
Check `runningScriptMap` on home before believing any telemetry stamp.

**BitNode 2 plan (gangs).** `gangplan.js` (pure) + `gang.js` (daemon, 256GB home
tier, watched). progress.js targets the cheapest gang faction first in a
gang-capable node and the body step performs its crime/gym legs; gang.js
creates the gang on join and publishes `/tel/gang.txt` (`phase`, assignments
with reasons, rates, ascensions, purchases, refusals). Nothing can start until
home reaches the Singularity allocation (~1.3TB at SF4.1, ~9h in BN5) — the
join needs it. Exit bar in BN2 is hacking 15,000; faction rep is halved.

**Early-game Singularity: act.js.** progress.js refuses to run until home spares
its whole acting block (1,305GB at SF4.1). `act.js` (~6GB, anywhere) decides with
`actplan.js` and runs ONE single-call actor at a time — `act-join/work/crime/gym/
travel.js`, 33.8-82.2GB at SF4.1 — on whichever rooted host has the room, then
idles the moment `/tel/progress.txt` is fresh and not `ram-raise-denied`.
Telemetry: `/tel/act.txt` (`decision.why`, `last.outcome`, `work`). The floor is
the largest single call: the crime loop (82.2GB) waits for a 128GB host, join and
work (49.6GB) for a 64GB one. SF4.2 quarters all of it.

**Never `git checkout -- <file>` in this repo.** The working tree is far ahead of
HEAD (boot.js: 653 lines on disk, 128 committed); a checkout to "undo one edit"
reverted the entire tiered manifest on 2026-09-19 and the sync pushed it to every
host. Undo edits by re-editing. boot.js was rebuilt from `backups/` (the game-save
snapshots hold every script on home — `AllServersSave.home.scripts`) plus the
edits recorded in the session transcript; 15 of 16 recorded manifest texts
matched, batch.js's `why` wording may differ slightly from the lost version.

**Telemetry files survive a BitNode entry.** `/tel/factionplan.txt` from BN5 was
read as a live schedule in BN2. Anything that reads a plan must check its
`lastAugReset` against `ns.getResetInfo()`, as act.js and budget.js do.

**The UI lock works from any host.** lock.js takes an injected transport
(`setLockTransport`, installed by homeup.js) that pulls home's copy before a
read and pushes after a write; on home it is a no-op. Before this, homeup.js
placed "anywhere" refused every pass and home sat at 32GB with $3m.

**The planner does not act; act.js does.** progress.js writes `/tel/orders.txt`
(join, work, crime, gym, travel, company, course, focus, tor, program, donate,
buyaug, install — each with `why`) and act.js executes the batch in order with
the matching `act-*.js` actor (32-100GB each, one resident at a time). A failed
donate/buyaug stops the rest of that chain; install runs only with something
queued and after the homeup spend-down. Each batch executes once, keyed by its
stamp, same life only. Outcomes: `/tel/act.txt` `orders.results`.

**The planner reads snapshots, not Singularity.** `snapshot.js` turns
`/tel/snap-*.txt` (written by `snap-*.js`, one read family each, 51-99GB at
SF4.1, run by act.js every minute and after every order batch) into the view
progress.js calls under unpriced names. progress.js prices 8.45GB flat and refuses
a pass (`snapshots-missing`) when a family is absent, from another life
(dynamic) or another node (static). The Source-File 4 multiplier now touches only
the actors, one at a time; the whole loop runs from a 128GB home.

## Driving the game without the browser

`cmd.js` is a terminal bridge. It runs in-game, watches a file, and types
whatever it finds into the real terminal — so **any terminal command can be run
over the Remote File API, with no browser at all**.

```bash
# queue commands
curl -s -X POST localhost:12526/rpc -d '{"method":"pushFile","params":{
  "filename":"/cmd/in.txt","server":"home",
  "content":"connect n00dles\nbackdoor\nhome"}}'

# read what the terminal printed
curl -s -X POST localhost:12526/rpc -d '{"method":"getFile","params":{
  "filename":"/cmd/out.txt","server":"home"}}'
```

- `/cmd/in.txt` — one command per line; consumed and deleted.
- `/cmd/out.txt` — JSON, each command with the terminal output it produced.
- `/cmd/busy.txt` — present while a batch is running.

**Wait on `in.txt` OR `busy.txt`, never on `busy.txt` alone.** The bridge polls,
so between your write to `in.txt` and its pickup there is a window in which
neither file exists — poll only `busy.txt` and you conclude "finished" before it
started, then read `out.txt` and get the *previous* batch's complete,
well-formed JSON with nothing to distinguish it from yours. `autobuy.js:76` and
`backdoor.js:132` already wait on both; this line used to say `busy.txt` alone
and was wrong.

**Prefer this over browser automation for anything the terminal can do** —
`connect`, `backdoor`, `buy`, `run`, `kill`, `scp`, `analyze`, `ps`, `free`.
It is faster, it is scriptable, and it cannot mistype. Two browser sessions
typing into the same terminal input *will* interleave into corrupt commands;
that has already happened.

The browser is still required for things with no terminal equivalent: the
Factions UI (accepting invites, starting faction work), the City/company UI
(buying home RAM at Alpha Enterprises, augmentations), Create Program, and
reading the character overview.

Refuses `softreset`, `b1tflum3` and `wd`. Not a security boundary — anything
with file access could do it anyway — just a guard against a typo in a queued
batch costing hours.

How it works, since it is non-obvious: `Terminal.executeCommands` is not
reachable from Netscript, and the input is a React controlled component, so
setting `.value` updates the element but not React's state — and Enter reads
React's state (`TerminalInput.tsx:244`). The bridge goes through the native
value setter, fires the `input` event React listens for, then sends Enter.
`document`/`window` are reached via `eval` so the RAM checker does not see
them, the same trick `infilhelper.js` uses.

## Telemetry

In `.telemetry/` (gitignored). Run `curl -s localhost:12526/poll` first — the
save-derived files only refresh every 30s.

| File | Source | Contains |
| --- | --- | --- |
| `state.json` | game save, decoded | money, skills, karma, augs, factions, servers, playtime |
| `history.jsonl` | same, appended | the above over time, so rates are measurable |
| `status.txt` | `tel.js` running in-game | processes, income/sec, per-server money and security |
| `errors.txt` | `errlog.js` running in-game | **the error modals the player sees** — type, script, server, pid, occurrences, message |
| `hacknet.txt` | hacknet.js | `phase` (`netburners` / `claimant` / `refused`), `best` upgrade, `verdict.why`, `spendable`, `bought`. Phase 2 buys only when payback < remaining life AND budget.js leaves the money (money-return exception through the home claim). |

**Reading `currentWork` out of the save: it is nested.** `PlayerSave.data.currentWork`
is `{ctor: "FactionWork", data: {type, factionName, factionWorkType, cyclesWorked}}`,
so `work.type` is `undefined` and only `work.data.type` is the answer. Reading the
outer level reports "not working" for a character who is working, which is a false
negative in the direction that matters — it says the one quantity that cannot be
bought is earning nothing. In-game, do not read this from `ns.getPlayer()` at all:
that payload has no work field (NetscriptFunctions.ts:1371-1389), which is why
`progress.js` reads it from Singularity.

**Home is not free real estate — two reserves must be jointly satisfiable.**
`progress.js` raises itself to a Singularity allocation with `ns.ramOverride` and
needs it as ONE contiguous block on home: `13 + 6.25*mult` GB (the largest single actor), which at SF4.1 is
**113GB** (was 1197 before the acts and reads moved to act.js and the snapshot actors). Anything that sizes itself from home's raw free space will eat it.
`watchdog.js`'s `shareThreads()` did exactly that — 80% of the largest free block,
home included — and `share.js` took **960GB, then 1112GB** of a 2048GB home while
`progress.js` was denied 1192.85GB pass after pass. Self-defeating in the obvious
direction: share multiplies *faction work* reputation and `progress.js` is what
starts the faction work, so it bought a bonus on an activity that was not running.
`batch.js` had the mirror bug — when home is also the largest fleet host,
`reserveFor('home')` summed both reserves and demanded 2157GB of a 2048GB machine,
with nothing checking the sum. The `13 + 6.25*mult` formula is now duplicated in
three files on purpose (importing `progress.js` would drag its whole Singularity
graph into each); **[R6] is what keeps the copies honest.**

**Read `errors.txt` before concluding that a script "found nothing".** An agent
over the RFA cannot see the game's error modals, so an uncaught exception and a
clean run that produced no output are indistinguishable — the crashed script
writes nothing either way. `errlog.js` closes that gap by mirroring `ErrorState`
(`src/ErrorHandling/ErrorState.tsx`), the game's own ring buffer of the last 100
errors. It reads that rather than scraping the modal because `DisplayError`'s
`updateActiveError` only raises a modal `if (!ActiveError)`: while one modal is
up, every later error is recorded but never shown, so a scraper would miss
precisely the errors that arrive in a storm.

`health` is `ok`, `unresolved` (could not reach ErrorState — `errors` is then
`null`, never `[]`) or `stopped`. It reaches a module singleton through the
webpack module cache, so it is the one thing here that a game upgrade could
break; that is why it fails loud and names the reason.

This was not cheap to learn. `ctscan.js` died twice — once out of RAM before it
ever launched, once on `JSON.stringify` refusing a BigInt — wrote nothing either
time, and the silence was reported as "there are no contracts on the network".
There were **49, worth ~$1.9b**, which on collection took the run from $1.2m and
13/70 rooted to $1.57b and 70/70 in about a minute.

**Still not covered:** `Cannot run X — this script requires NGB` is a *launch*
failure, not a runtime one. It never reaches `ErrorState`. It appears in the
terminal (so `cmd.js` sees it in `/cmd/out.txt`), and `ns.exec` returns pid `0`
rather than throwing — so callers must check the return value, not assume.

The save **excludes running scripts** — that is why `tel.js` exists. It writes
`/tel/status.txt` in-game and the daemon mirrors it out. It needs ~4GB, so it
normally runs on a rooted server rather than eating home RAM.

## The simulator

`tools/sim/` does **not** reimplement the game. `build.mjs` bundles
`~/Repos/bitburner` with esbuild and `env.mjs` stands it up under jsdom, so
`game.mjs` re-exports the real `calculateHackingTime`, `calculateGrowMoney`,
`calculatePercentMoneyHacked`, `numCycleForGrowthCorrected` and friends. To use
a formula that isn't exported yet, add it to `ENTRY` in `build.mjs`.

```bash
node tools/sim/run.mjs --snapshot              # capture the live world
node tools/sim/run.mjs --minutes 60 --seeds 5  # compare strategies
node tools/sim/run.mjs --only early-n00dles --json
```

- `engine.mjs` supplies only what the game couples to React and its worker
  runtime: a clock, a RAM allocator, an event queue. Op *duration* is computed
  at launch and its *effect* at landing, matching the game — that gap is the
  whole reason batching is hard.
- Worlds come from the live save, so servers have this playthrough's real
  randomized stats. `freshStart()` rolls back to a pristine BN1 opening.
- Hacking is probabilistic. **Always compare medians over several seeds.**

### Two load-order traps, both already handled in `env.mjs`

Changing that file without knowing these will break it in a way that is hard to
read:

1. jsdom's `window` carries its own `globalThis` property. Copying the window
   surface onto the global wholesale rebinds the identifier, and every
   subsequent shim lands on the jsdom window instead of node's real global —
   where the game bundle looks for it. The copy loop skips `globalThis` and the
   module holds a captured `const G` reference.
2. A top-level `await` makes a module async, and ES modules do **not** guarantee
   an async module finishes before its *siblings* evaluate. `env.mjs` must stay
   synchronous (its rebuild runs via `execFileSync`) or the game bundle starts
   running before the DOM exists. `game.mjs` pulls the bundle in with a dynamic
   `await import` for the same reason.

## Failure must be loud

**A failure that produces no signal is worse than a crash, and this repo has
produced dozens of them.** Every expensive bug here has had the same shape: the
system kept running, kept reporting, and was wrong. A thrown exception gets
fixed the day it happens. A silent one survives an entire BitNode.

So the rule, and it outranks elegance, brevity and RAM:

> **Anything that can be wrong must be able to say so, through a path that does
> not depend on the thing that is wrong.**

### The shapes it takes

Each of these is real, each cost hours, and each looked healthy from outside.

| shape | what happened |
| --- | --- |
| **The diagnostic shares a failure path with the fault** | `go.js` referenced an undeclared `sf14` *inside the status object*, so every completed game threw from within `JSON.stringify`'s argument list — and the only record of the failure was the file that failed to be written. `batch.js` had the same bug: the status write sat at the end of the `try`, so any earlier throw skipped it and the error log with it. |
| **A guard that can never fire** | `autobuy.js` wrapped `const sing = ns.singularity` in `try/catch`. RAM is billed statically before a line executes, so the catch was decoration. It read as a Source-File gate for months. |
| **A lookup that silently defaults** | `pserv.js` reads `getBitNodeMultipliers().PurchasedServerCost` — the Bitburner *v1* name. The game renamed it `CloudServerCost`, and our defaults table still carries the v1 key, so the factor is **always 1** whatever the BitNode says. No error, wrong number. |
| **A tool refusing to answer, read as answering "no"** | `grep` returns "no matches" on a file containing a NUL byte, because it silently classifies it as binary. `tools/verify-deploy.mjs` had one. Two separate searches came back empty on text that was plainly there. |
| **A test that stops testing and still reports green** | `placement.test.mjs` did `await import(REPO + "batch.js")`, which worked only while `batch.js` had no imports. One import later the module threw at load and check **B5 silently stopped running**. |
| **An exemption that never matches** | `sfgate.test.mjs`'s allow-list scans string-stripped source, so it can never match a filename and is always empty. `go-cheat.js` passes only by accident. |
| **A plan that cannot be executed, discovered by failing** | `planBatch` returned batches no host could hold: 7,274 placement failures, 0 batches, $0 in 27 minutes, reporting `health: stalled` and never throwing. |
| **A stale artifact read as current** | `/cmd/out.txt` returned the *previous* batch's complete, well-formed JSON with nothing marking it stale. `.telemetry/*.txt` survives a prestige and is read as this life's. `/tel/status.txt` keeps answering after `tel.js` dies. |
| **A config change that does not take effect** | `SKIP_DIRS` edited in the daemon source while the *running* daemon holds the old list in memory — so every `/sync` kept re-pushing 66 files that had just been deleted, including after the fix was reported done. |
| **True here, false elsewhere** | `FactionWorkRepGain` is 1 in BitNode 1, so omitting it from `repFromDonation` was harmless for a whole BitNode and a 25% error the moment we left. "$1m after an install" was CashRoot Starter Kit, not the game. |

### What that obliges

1. **Publish on every exit path** — return, handled error, uncaught throw, and
   kill. `ns.atExit` is 0GB and runs before teardown, so a killed script can
   still say why. Enforced by invariant C1.
2. **Never let "I could not tell" encode as "it is fine."** `verify-deploy`
   exits 0 in sync, 1 out of sync, **2 could not check**, and the distinction is
   the point. Extend that discipline anywhere a check can decline to run.

   Three mechanical consequences, all learned the expensive way (invariant B8):

   - **Unknown and zero are different values, and the difference must survive
     the call site.** `budget.js`'s `augClaim()` returns `null` for unknown and a
     number — including 0 — for known. That is useless if a caller writes
     `augClaim(...) ?? 0`, which silently converts every failure into permission
     to spend. That coercion was written at **two** call sites within minutes of
     the module landing, and every unit test stayed green: a property asserted
     only *inside* the thing it protects is not asserted at all. Check the
     callers, not just the guard.
   - **Absence is never a signal.** Publish "nothing to report" explicitly —
     `progress.js` writes `planned: false` every pass — so that a missing file
     can only mean the publisher died. If absence means both "idle" and "dead",
     every reader has to guess, and they will guess permissively.

     **And that applies per FIELD, not just per file.** A record that is present
     and well-formed still reads as unknown to any claimant whose field it
     omits. `/tel/installgate.txt` is read by *two* functions in `budget.js`:
     `augClaim` accepts `plan: null` + `planned: false` as a known zero, while
     `joinClaim` accepts **only a finite number** and blocks on anything else —
     correctly, because the publisher emits `null` exactly when it could not
     read the candidate set. `progress.js`'s can't-raise-RAM path published the
     record without a `joinClaim` field, so the fail-closed reader did its job
     and froze the run. The deadlock that path was *written to fix* came back
     unchanged, one claimant to the left:

     > progress.js can't raise RAM → claim reads unknown → `homeup.js` won't buy
     > home RAM → home never grows → progress.js can never raise RAM

     Live in BitNode 5: home pinned at 512GB holding **$3.92b**, `progress.js`
     needing 1192GB, `homeup.js` launched **zero** times across 16 cycles.
     **Adding a claimant to `budget.js` means updating every publisher** —
     `[C9]` now fails the suite if any gate write omits a mandatory field.

   - **A diagnostic must name the right cause.** The same block reported "the
     augmentation claim is unreadable — `augClaim` refuses a stale
     `lastAugReset`". `augClaim` was answering correctly; `joinClaim` was the
     one returning null. A message that misnames its cause is worse than a bare
     "blocked", because it spends the reader's time disproving it — here, on
     verifying a `lastAugReset` that matched perfectly all along.
   - **A check you have not seen fail is not evidence.** BU6's first version used
     `/augClaim\s*\([^)]*\)/`, which stops at the `)` inside a nested argument,
     and reported PASS against the bug deliberately put back. Reintroduce the
     defect and watch the check go red before believing it.
3. **Prefer a loud wrong answer to a quiet default.** A missing key should throw,
   not resolve to 1. If a default is genuinely right, say so at the site.
4. **A predicate must not depend on the thing it guards** (invariant C4). Ask
   the game, not a file the gated script writes.
5. **Verify against a signal the operation itself did not produce.** Read the
   state back (`backdoorInstalled`, the price multiplier, `maxRam`), not the
   fact that you clicked. A disabled MUI button swallows `.click()` in silence.
6. **A model states its calibration, or states that it has none.** Silence reads
   as "checked and fine" — which is exactly the state that produced two
   fabricated validations.
7. **When a tool returns nothing, establish that it looked.** Especially `grep`,
   `find`, and any allow-list.

### The test for whether you have obeyed it

Not "does this work" but: **if this were broken right now, how would I find
out, and how long would it take?** If the answer is "someone eventually notices
the numbers look wrong", it is not finished. `npm test` encodes as much of this
as is statically checkable; the rest is a habit.

## Fidelity: model the real game, except where RAM says otherwise

Every piece of tooling should model the game as it actually behaves. There is
exactly one licensed reason to diverge, and it applies to one side of the line.

**Off-line tooling (`tools/sim/**`, analysis, docs) has no RAM budget, so it has
no excuse.** Use the game's own source, its own constants, its own starting
conditions. Where the real formula is exported by `game.mjs`, call it rather
than reimplementing it. An approximation here is a bug, and it will be an
expensive one, because everything downstream is a decision made on its output.

**In-game scripts pay RAM per NS function referenced anywhere in their import
graph, multiplied by thread count.** There, an approximation that saves RAM can
be correct engineering — but it has to be a *deliberate, documented* trade with
the real behaviour named. `auto.js` inlining `calculatePercentMoneyHacked`
rather than calling `ns.hackAnalyze` saves 0.9GB *and* is more accurate for its
purpose; `h.js`/`g.js`/`w.js` carry no guards at all because one stray call in a
400-thread worker costs 40GB. Both are fine. Silently using a wrong constant to
avoid a lookup is not.

Failures of this rule have been the most expensive bugs in this project:

- `freshStart()` set servers to full money; real ones start at 4% of max
  (`Server.ts:75-77`). Every simulated world was 25x too rich, the opening grow
  phase did not exist, and the simulator scored a configuration in the billions
  that earned $0 for two hours in the real game.
- The simulator priced threads at 1.7/1.75GB while the supervisor actually
  deployed a 2.4GB worker — 30% too cheap.
- `contract.js` carried a v1-era reward constant of 4000 against the real
  `75e6`, so contracts looked worthless for years of play.
- `h.js`/`g.js`/`w.js` slept and then acted, so ops read the world at wake time
  rather than launch time — the dominant desync mechanism.
- The simulator scored end-of-run cash, which punishes every strategy that
  reinvests. Scoring cumulative earnings reversed the ranking outright.

The pattern is the same each time: a plausible-looking simplification, never
checked against source, silently deciding every measurement built on top of it.
**When a number matters, read it out of `~/Repos/bitburner` and cite the file and
line in a comment.**

### Calibrate against the live game, or say the model is uncalibrated

Reading the formula out of source fixes one failure mode. It does not fix the
other: **a model's inputs can be stale and its overall scale wrong while every
formula in it is exactly right.** That is the mode that has produced fabricated
validation data twice.

- A hand-written Go opponent in an offline harness reported a **100% win rate**
  for our solver at every setting. The same solver then lost **10 straight**
  games in the real game. Every rule in the harness was correct; the opponent
  was a strawman, so the number measured nothing.
- A **5-target synthetic server list** produced a "failed" target-count
  validation. It was fiction. Real data from the live save gave a completely
  different — and correct — answer.

Both numbers looked plausible, neither was checked against the running game, and
a decision was made on each.

⇒ **Any offline model whose output drives a decision must reproduce a quantity
the live game already displays, and print the error, before its conclusions are
used.** Not "can be checked" — checked, in the file, on every run, with the
error on screen whether it passes or fails. An error of 1% and an error of 40%
must both be visible; only failures being printed is how a 40% error survives.

The live measurements are free and read-only: `.telemetry/state.json`,
`history.jsonl` (rates, on the game's own `totalPlaytime` clock),
`status.txt` (processes, income, exp/s), `batch.txt` (the batcher's own plan and
earnings per target), plus `getSaveFile` and `calculateRam` over the control
port. `tools/sim/calibrate.mjs` wraps all of them and carries the `checkWithin`
reporter; `node tools/sim/calibrate.mjs` prints every live measurement at once.

This is not theoretical. It has caught, in this repo:

- `daedalus-plan.mjs` off by **~2.7x** — wrong `faction_rep` value, and a
  missing cycles-per-second conversion. The calibration line made it obvious
  instead of silently producing a wrong recommendation.
- The same file again, from **stale hardcoded inputs**: `faction_rep` had moved
  3.20 → 3.52, banked exp 1.56e11 → 1.05e12 and the exp rate 2.8e7 → 1.9e8 while
  the constants sat still, putting its rep/sec **24% low**. It now reads those
  inputs live and asserts to within 1%.
- `target-count.mjs` / `alloc.mjs` over-predicting income by **+40%**, with
  every formula correct: batch RAM matched the live batcher to 0.1% and $/batch
  to 1.5%, but the saturation cap assumes a pipeline lands a batch every
  `4*spacing` = 0.80s and the live controller achieves 0.84–1.20s.

Two rules follow, and the second matters as much as the first:

1. **State the tolerance next to the decision it protects**, not as a hope. Five
   percent of a ten-hour grind is half an hour, which is smaller than the gap
   between the plans being compared — so 5% is the right tolerance there and 15%
   is not.
2. **A model that cannot be calibrated must say so at the top of the file, with
   the reason.** Silence reads as "checked and fine", which is exactly the state
   that produced both fabricated validations. `probe-batch.mjs`,
   `probe-rank.mjs`, `target-count-alloc.mjs`'s greedy arm and `ev.mjs`'s
   experience price all carry a `NOT CALIBRATED` header naming what is missing.
   Genuinely uncheckable is fine — `bncheck.mjs` answers about BitNodes we have
   not entered and nothing live can confirm it. Unlabelled is not.

`verify-batch.mjs` (hand-ported formula vs game source),
`verify-alloc-shipped.mjs` §0 (offline `batch.js` vs `batch.js` running in the
game) and `fidelity/backtest.mjs` (simulator vs recorded history) are the three
existing shapes. Add to one of them rather than inventing a fourth.

## Before entering a new BitNode

```bash
node tools/sim/bncheck.mjs <n>     # what this repo gets wrong in BitNode n
node tools/sim/bncheck.mjs --survey
```

Everything here was written and measured in **BitNode 1**, where all 55
BitNodeMultipliers are 1. Several scripts bake that in as a constant — a
legitimate RAM trade inside the game, and silently wrong the moment the BitNode
changes. **No BitNode other than BN1 leaves the stack intact**; BN12 breaks 13
of 15 checked assumptions.

`getBitNodeMultipliers(n, lvl)` is a pure function of the BitNode number, so
bncheck answers for a node we have not entered yet, from game source. The two
that actually stop the run working are `ServerWeakenRate`/`ServerGrowthRate`
(hardcoded in batch.js — desyncs the batcher) and `CloudServerSoftcap` (makes
buyserv buy the wrong fleet shape). Full narrative and the structural
assumptions the multipliers do not capture: `docs/bitnode-assumptions.md`.

**When a script gains a constant that depends on a multiplier, add it to the
`ASSUMPTIONS` table in bncheck.mjs in the same commit.** That table is what
turns arriving in a new BitNode into a checklist rather than a debugging
session.

## Write for every stage of the game, and for headless play

**The goal of this project is to run an entire playthrough headlessly.** Every
script should therefore be correct at *any* Source-File level and *any* point in
a run, not just the one the save happens to be at today. Two patterns follow
from that, and both are worth a small cost now for a large one avoided later.

### 1. Gate optional APIs, do not delete them — and isolate their RAM

Netscript bills a script for every ns function in its import graph **whether or
not the call is reachable**. So a reference to a Source-File-gated API costs its
RAM in every BitNode, including the ones where touching it throws.

The wrong fixes are to delete the feature (the script is then wrong the moment
the Source-File arrives) or to keep it inline (every life pays for it). The
right fix is to **probe cheaply and put the expensive surface in its own
script**, because scripts are billed independently:

```js
// caller: 1GB probe, not an 8GB permanent reference
const sf14 = ns.getResetInfo().ownedSF?.get(14) ?? 0
if (sf14 >= 2) ns.exec('go-cheat.js', 'home', 1, 'twoMoves', x1, y1, x2, y2)
```

`go.js` / `go-cheat.js` is the worked example: inlining `ns.go.cheat.*` cost
25.8GB in a BitNode that cannot call it; the split is **20.3GB**, with the 33.6GB
helper paid only on a save that can actually use it. `autobuy.js` does the same
thing in the other direction — singularity first, terminal fallback — so it
needs no rewrite when SF4 appears.

### 2. Separate pure logic from `ns` I/O

Anything that is *computation* rather than *game interaction* belongs in a
module with no ns calls, which the game script imports. Importing such a module
is free (it contributes no ns cost), and it buys two things:

- **One source of truth.** `golib.js` holds the Go rules, evaluation and search;
  `go.js` only plays games with it. Re-deriving liberty counting or scoring in a
  second consumer is how two copies quietly stop agreeing.
- **Headless testing and tuning.** A pure module runs under plain `node`, so
  strategy can be measured without spending game time or heating the machine.
  The Go search was tuned this way in minutes:

  ```
  node tune.mjs 9 30 8 10   # size maxms topK games -> winRate, avgScore, ms/move
  ```

  which showed search quality saturating at 30ms/move — 60ms bought nothing.
  That experiment is impossible if the logic can only run inside the game.

Prefer this split whenever a script starts containing real logic. The RAM is
free, the drift risk goes away, and it moves the repo toward a playthrough that
can be simulated end to end rather than only observed.

## Reputation is a purchase, not a grind — bank favor before every install

The single most valuable thing an install does is convert reputation into
**favor**, and favor at 150 unlocks **donations**, after which reputation stops
being earned and starts being bought:

```
Faction.ts:79          prestigeAugmentation: setFavor(addRepToFavor(favor, playerReputation))
                       ...then playerReputation = 0 and isMember = false
favor.ts:12            repToFavor(r)  = ln(1 + r/25000) / ln(1.02)
donation.ts:17         favorNeededToDonate() = 150 * FavorToDonateToFaction
donation.ts:8          repFromDonation(amt) = amt / 1e6 * mults.faction_rep
                                              * currentNodeMults.FactionWorkRepGain
```

`favorToRep(150) = 462,490`. So **462,490 reputation banked with a faction
before an install** is worth vastly more than 462,490 reputation, because
afterwards that faction's reputation costs
`rep * 1e6 / faction_rep / FactionWorkRepGain` dollars.

**That third factor is not decoration.** It is 1 in BitNode 1, which is why this
section was written without it and stayed right — and 0.75 in BitNode 4, 0.5 in
BitNode 2, 0.6 in BitNode 13. `nfg.js` deliberately over-donates by computing
the amount as if `faction_rep = 1`, on the reasoning that the real multiplier is
always >= 1 so the error is a surplus. With `FactionWorkRepGain` in the product
that reasoning breaks: the true break-even is `faction_rep = 1/FactionWorkRepGain`,
so at BN4's 0.75 a `faction_rep` of 1.33 makes the "safety margin" a **0.25%
shortfall**, and in a node with 0.2 the shorthand would under-donate five-fold.
**Measure the rate, do not assume it** — donate a bounded probe, read the
reputation delta, size the real donation from that.

The Red Pill is the worked example. It needs 2.5M Daedalus reputation, which is
a **ten-hour grind** at favor 0 — Daedalus starts at 0 favor and reputation gain
carries a `(1 + favor/100)` term (`reputation.ts:16`), so it accrues 2.3x slower
than at a faction we have installed against before. With 150 favor it is
**$692b**, about four seconds of a mature fleet's income. Same augmentation,
same reputation, four orders of magnitude difference in cost.

Three consequences, all easy to get backwards:

- **Never grind a faction's reputation past what you will spend.** Beyond the
  augmentations you intend to buy, stop at exactly `favorToRep(150)` and bank it
  through an install. Past 150 favor, extra favor only buys a work bonus you
  will not use, because you will be donating.
- **Queued augmentations do nothing.** Multipliers move at install only, so
  reputation earned toward a multiplier you have not installed yet is earned at
  the old rate. If an install is coming, do it *before* the long grind, not
  after.
- **Buy in descending intrinsic price — which is NOT "NeuroFlux first".** The
  j-th purchase of a cycle costs `intrinsic * 1.9^j`, so the weight belongs to
  the *position*: by the rearrangement inequality the expensive items want the
  cheap early positions. NFG's money price is
  `baseCost * 1.14^level * 1.9^queuedAugs` (`AugmentationHelpers.ts:133-138`)
  with every queued NFG feeding both exponents, so it climbs 2.17x per level
  within a cycle and walls out after ~12. The `1.9^queued` term resets at
  install, which is the other reason intermediate installs pay for themselves.

  This file used to say "buy NeuroFlux before other augmentations". **That is
  right in the endgame and wrong early, sometimes by a lot.** NFG starts at
  $750k (`Augmentations.ts:1160`), so early levels are the *cheapest* things
  available and spending the cheap positions on them pushes real augmentations
  into the expensive ones. On a realistic six-augmentation BitNode 4 list at
  $1t, NFG-first buys **5 levels** where correct ordering buys **13** — same
  augmentations, same money. The two converge around NFG level ~55, which is
  why the rule looked true when it was written: it was written at level 82+.

  The general rule that covers both ends: repeatedly take whichever available
  item maximises `C / (1.9^size - 1)` — either the next augmentation or the
  best *prefix* of the NFG chain, since NFG levels must be taken in ascending
  order. That is exactly optimal against brute-force over every interleaving.
  Ordering is not priority: ordinary augmentations are still *selected* first
  against the whole budget; NFG takes the remainder.

`tools/sim/daedalus-plan.mjs` models this end to end. It reads every input from
the live save and `.telemetry/` at run time and prints a CHECK block first,
reproducing the game's own rep/sec readout to within 1% before it says anything
about plans. Re-run it rather than re-deriving — and if the CHECK fails, believe
the CHECK.

## The install procedure — follow it exactly

Installing augmentations is the only irreversible action in normal play, and it
destroys more than it looks. Do these in order, every time:

1. **Back up the save.** No browser needed — the RFA reads it directly, and
   that path does *not* consume the 24h export-favor bonus:
   ```bash
   curl -s -X POST localhost:12526/rpc -d '{"method":"getSaveFile"}' > save.json
   # decode: gzip(result.save as latin1) -> JSON, write to backups/
   ```
2. **`run homeup.js --reserve 0`** — spend every remaining dollar on home RAM
   and cores. **This is not optional.** `prestigeHomeComputer`
   (Server/ServerHelpers.ts:226-239) resets programs, `serversOnNetwork` and
   `ramUsed` but touches **neither `maxRam` nor `cpuCores`**, so home RAM and
   cores are permanent for the whole BitNode — while money resets to **$1262**
   (`money = 1000 + CONSTANTS.Donations`, PlayerObjectGeneralMethods.ts:102),
   plus each owned augmentation's `startingMoney` (Prestige.ts:85-88). The $1m
   this file used to claim is CashRoot Starter Kit alone, and is not a floor to
   rely on: BitNode 4 opened on exactly $1262. Every
   dollar held at Install is destroyed. We once installed holding **$2.07
   quadrillion** with home at 16.38TB and 1 core; that was pure loss, and
   buyserv.js had been diligently spending on *cloud* servers, which the install
   also destroys. Cash is worth nothing across the boundary; home is forever.
3. **Buy augmentations most-expensive-first** — money cost multiplies by 1.9 per
   already-queued aug, reputation cost does not. Buy every NeuroFlux level the
   reputation allows; NFG is +1% to *all* multipliers per level, stacks
   multiplicatively, and is sold by every faction.
4. **Install**, then **`run boot.js`** by hand — the autoexec does NOT fire after
   a prestige (NetscriptWorker.ts:247 skips servers with no saved running
   scripts, and an install kills them all).
5. Expect TOR to be gone: `serversOnNetwork = []` clears the darkweb link, so
   `hasTorRouter()` goes false and `torbuy.js` must re-buy it. This is why
   `autobuy.js` alone could never bootstrap a life.

## The anticheat boundary — what can and cannot be automated

The game guards a specific list of actions with `event.isTrusted`, which a
synthetic `.click()` can never satisfy. This is deliberate and narrowly aimed at
**resource faucets** — anything that hands you something for a click, and would
therefore be farmable by a scripted loop:

| guard | protects |
| --- | --- |
| `Faction/ui/FactionsRoot.tsx:89` `acceptInvitation` | free faction joins |
| `Casino/utils.ts` `trusted()`, `Casino/Blackjack.tsx` | printing money |
| `Locations/ui/SlumsLocation.tsx:25` | crime rewards |
| `Locations/ui/HospitalLocation.tsx:23` | free healing |
| `Locations/ui/CompanyLocation.tsx:62,71` | job applications, starting infiltration |
| `Infiltration/ui/InfiltrationRoot.tsx:74` | the minigames (a synthetic key **hospitalises you**) |
| `Programs/ui/ProgramsRoot.tsx:96,108` | free program creation |

`Exploits/Unclickable.tsx` is the giveaway that this is intentional: an
invisible button that grants an exploit achievement, but only for a trusted
click.

**Everything else is ungated.** Navigation, the Options switches, augmentation
`Buy`, home RAM/cores, the TOR button — all respond to synthetic clicks, which
is exactly why `augbuy.js`, `homeup.js`, `torbuy.js` and `settings.js` work from
inside the game with no Source-File and no browser extension.

⇒ **The one thing a life cannot automate is accepting faction invitations.**
`acceptInvitation` tests `isTrusted` *before* it checks the invite even exists,
so there is no partial path. It needs a real input event: a human click, or the
browser tool's `computer` action (CDP-generated events are trusted; that is why
those worked where `.click()` silently did nothing). Budget ~5 clicks per
install cycle and do not waste time trying to script around it.

### Two ways this will mislead you

- **A failed synthetic click is silent.** No error, no modal, nothing — exactly
  like clicking a disabled button. Do not infer "anticheat" from "nothing
  happened"; check the source for an `isTrusted` guard first. Options
  navigation was misdiagnosed as anticheat for precisely this reason, twice.
- **Focused faction work hides the whole sidebar**, so nav elements are not
  merely unclickable, they are *absent*. A "button not found" while work is
  focused means unfocus first, not that the selector is wrong.

## Driving the UI from *inside* the game

Some things have no NS API without Source-File 4 — joining factions, buying
augmentations, buying the TOR router. That does not make them a human job. A
Netscript process can reach the DOM through `eval('document')` (eval so the RAM
checker never prices it), which is how `cmd.js`, `upkeep.js`, `augbuy.js` and
`torbuy.js` all work. No browser extension, no external agent, no Source-File.

Hard-won rules for this, every one of which cost a silent failure:

- **Focused faction work hides the entire sidebar.** Only "Stop Faction work"
  and "Do something else simultaneously" exist. Unfocus first, refocus after —
  `upkeep.js` reclaims the 25% if you forget.
- **Bind a button to its own card, never by walking ancestors.** Each
  augmentation is one MUI `<Paper>`, so `btn.closest('.MuiPaper-root')` is
  exact. An ancestor walk reaches a container spanning many rows and silently
  matches the wrong button — `augbuy.js` clicked whichever Buy came first for
  three debugging rounds because of this.
- **Check `.disabled`.** A disabled MUI button swallows `.click()` with no
  error and no modal, so "I clicked and nothing happened" is usually "rep or
  money short". Say which.
- **Do not assume a confirm modal.** `Settings.SuppressBuyAugmentationConfirmation`
  makes the Buy click purchase *immediately* with no dialog
  (`AugmentationsPage.tsx:251-257`), so absence of a modal is ambiguous.
  Verify against a real signal — the page's "Price multiplier: x N" moves by
  1.9 per queued aug. **`ns.getPlayer()` does not expose
  `queuedAugmentations`**, so a queue-length check silently reads `undefined`
  on both sides and reports failure on every success.
- **Match modal buttons across the whole document, not `offsetParent`-visible
  ones.** MUI portals can render positioned outside the viewport.
- **Take `/tel/ui-lock.txt`** before any multi-step UI sequence; `upkeep.js`
  stands down while it exists, otherwise it clicks Focus mid-sequence and drags
  the screen away. Release it in a `finally`-ish path — a lock left behind once
  cost ~3 hours of unfocused (80%) faction work.
- **Wait out `/cmd/busy.txt`** if launched from the bridge: cmd.js clicks Focus
  as its last act and will undo your navigation.

## Netscript v3 notes

The scripts were migrated from the 2021 API; 117 call sites moved. What bit:

- Most of the API is namespaced now: `ns.format.*` (no more `nFormat`),
  `ns.cloud.*` for purchased servers, `ns.stock.getPrice` (the `Stock` infix is
  gone), `ns.singularity.*`, `ns.ui.openTail`.
- Semantics changed in places, not just names: `getServerRam` returned a
  `[max, used]` pair that no longer exists; `hackAnalyzePercent` became
  `hackAnalyze`, returning a *fraction*; `getTimeSinceLastAug` is now derived
  from `getResetInfo().lastAugReset`.
- **Checking names against the definitions file does not catch arity changes.**
  `getScriptIncome()` still exists but no longer accepts zero arguments — that
  one was only caught because telemetry printed `$None/s`. Assume more lurk in
  scripts that have not been run yet.
- Get the current definitions from the running game itself:
  `curl -X POST localhost:12526/rpc -d '{"method":"getDefinitionFile"}'`. The
  daemon writes it to `NetscriptDefinitions.d.ts` on connect.

### Source-File 4 gates a lot

`ns.singularity.*` throws without SF4. On a first BN1 run that leaves
`crime.js`, `training.js`, `faction.js`, `buyProgram.js`, `createProgram.js`,
`healer.js` and `bladeburner.js` dormant. What they automate has to be done by
hand in the UI — legitimate to recommend, it just costs the player's attention.

## Agent roles

Four specialists run in parallel with **non-overlapping file ownership**. Keep
it that way; three agents editing one repo is how work gets clobbered.

| Agent | Owns | Job |
| --- | --- | --- |
| **game-player** | the browser, `/cmd/in.txt`, in-game actions | Continuously look for something to optimize with the tools on hand: watch telemetry, find idle RAM and newly rootable servers, run and retarget scripts, suggest features. **Use the `cmd.js` bridge for anything the terminal can do; reach for the browser only for the Factions, City and Create Program UIs.** |
| **optimizer** | `tools/sim/**` | Use the simulator to find measurably better strategies, then turn winners into real scripts. Medians over seeds, never single runs. |
| **researcher** | `docs/roadmap.md` | One level up: the critical path to the first aug install, what to rush, which faction first, backdoor order, what ends BN1. |
| **prior-art** | `docs/prior-art.md` | State our problems abstractly, then find what is actually known about them — academic and community both. |

Standing rules for all of them:

- Only the game-player touches the browser **or the `cmd.js` bridge**. The game
  is open in a specific tab; opening a new one would start a *different* save.
  Two writers on the terminal input interleave into corrupt commands — this has
  happened, producing `kill 154run cmd.js`. The bridge serialises through a file
  and is the safer of the two, but it is still one queue with one owner.
- Nothing resets progress (soft reset, install augs, delete save) without
  asking the lead first.
- Nobody restarts the RFA daemon.
- Root-level `.js` edits go live instantly — say so explicitly when reporting,
  and do not overwrite scripts another agent owns.
- Subagents commit nothing. The lead handles git.
- Verify against the game source or telemetry. Do not assert mechanics from
  memory of older versions, and say which version a community source targeted.

The lead agent reports to the human at a high level and does the committing.

## Current run

BitNode 1, fresh start, no Source-Files. Live numbers are in `.telemetry/` —
read them rather than trusting anything written here, which goes stale.

`hack.js` is the real batcher at 11.2GB and needs home RAM past 8GB to run;
`early.js` is the small HGW loop that bridges the opening. Early sim results
say the threshold loop is fine but pinning it to one target costs roughly 3x
versus retargeting as the hacking level rises.

### Reloading a script on a non-adjacent host

`Terminal.executeCommands('connect X; kill y.js')` only works when X is adjacent
to home — for anything placed "anywhere" (gang.js, hacknet.js, act.js, which the
watchdog does NOT revive) kill through the game's own worker table, then re-run
the idempotent boot:

```js
const ws = req.c['./src/Netscript/WorkerScripts.ts'].exports.workerScripts
const kill = req.c['./src/Netscript/killWorkerScript.ts'].exports.killWorkerScript
for (const w of [...ws.values()].filter((w) => w.name === 'gang.js')) kill(w)
await req.c['./src/Terminal.ts'].exports.Terminal.executeCommands('home; run boot.js')
```
