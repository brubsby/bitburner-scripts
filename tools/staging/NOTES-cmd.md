# cmd.js — resource safety and observability

Staged at `tools/staging/cmd.js`. **Not deployed.** `tools/` is in `SKIP_DIRS`
(`tools/rfa-daemon.mjs`), so nothing here reaches the live game; the root
`cmd.js` is untouched and still running. The game is minutes from an
augmentation install and `cmd.js` is the only way to drive the terminal, so this
does not go live until somebody decides to land it.

Line references of the form `File.ts:NN` are into `~/Repos/bitburner`
(`bitburner-official/bitburner-src` fork) and were read, not recalled.

Conventions follow the two staged changes already in this directory:
`tools/staging/lock.js` (+ `NOTES-lock.md`) and `tools/staging/status.js`
(+ `NOTES-observability.md`). No third reporting style was invented.

---

## 1. The leaks

| # | Leak | Where it was | What it cost |
|---|---|---|---|
| 1 | **`/tel/ui-lock.txt`** | `acquire(ns,'cmd.js')` at :187, `release(ns)` at :339, **no `try` anywhere between** — ~150 lines of DOM walking, terminal driving and unbounded waiting. | Any throw stranded the global UI mutex. `upkeep.js` stands down while the file exists, so faction work runs unfocused at 80% until the TTL expires — the same failure that cost ~3 hours once. This is the **longest-held** lock in the repo (a `backdoor` batch holds it for minutes) and was the **least protected**. |
| 2 | **`/cmd/busy.txt`** | written :195, removed only at :338 on the happy path. | `augbuy.js:56` waits for that file to vanish before touching the screen. A leaked busy file stalls the augmentation purchase path for its full 30s wait — during an install, when both scripts are on the critical path. `autobuy.js:76` and `backdoor.js:132` treat it the same way and simply stop queueing. |
| 3 | **A killed/thrown batch left `/cmd/out.txt` stale** | written once, after the command loop. | A caller that polled for the absence of `/cmd/busy.txt` and then read `/cmd/out.txt` got the **previous** batch's JSON — plausible timestamp, plausible results, wrong batch. See §4. |
| 4 | **No telemetry at all** | there was no status file, and no `catch`. | A crashed bridge is indistinguishable from an idle one. Commands just stop being answered. |
| 5 | *(consequence)* **a throw killed the bridge outright** | `main()` had no `catch`, so the first throw ended the process. | Every subsequent batch sat in `/cmd/in.txt` forever, with leaks 1–4 in place. |

All of them are closed by the same mechanism: **`ns.atExit`**, plus a
`try`/`catch`/`finally` per batch.

`ns.atExit` costs **0GB** (`RamCostGenerator.ts:605`) and its callbacks run from
`stopAndCleanUpWorkerScript()` **before** `ws.stopFlag = true` and before
`removeWorkerScript()` (`killWorkerScript.ts:56-86`), with `ws.runningFn`
already cleared — so synchronous `ns.write` / `ns.rm` inside it still work. Each
callback is invoked in its own `try`/`catch` (`:72-76`), so one throwing does not
prevent the others.

`atExit` is keyed by id — `(ctx.workerScript.atExit ??= new Map()).set(id, cb)`,
`NetscriptFunctions.ts:1395-1398` — and registering the same id twice
**replaces** the callback. `tools/staging/lock.js`'s `acquire()` registers under
`'ui-lock'`, so this file uses **`'cmd-bridge'`**. Both survive. Insertion order
puts `cmd-bridge` first (registered at the top of `main`, before the first
`acquire`), and since it calls `release(ns)` itself the lock.js one is then a
no-op — `release()` re-reads the file and only removes it if the pid still
matches, so releasing twice is harmless.

---

## 2. Exit-path matrix

`L` = `/tel/ui-lock.txt` released, `B` = `/cmd/busy.txt` removed,
`O` = `/cmd/out.txt` describes *this* batch, `T` = `/tel/cmd.txt` says what
happened.

| Path | Before | After | What runs |
|---|---|---|---|
| **Normal return** (batch completes) | L ✅ B ✅ O ✅ T ✗ | **L ✅ B ✅ O ✅ T ✅** | end of the batch block: `publishOut('ok')`, `note('ok')`, then `finally` → `release` + `dropBusy`. |
| **Handled error** (NS command throws, `submit` throws) | L ✅ B ✅ O ✅ T ✗ | **L ✅ B ✅ O ✅ T ✅** | unchanged: the per-command `catch` records `{command, output:null, error}` and continues. Now each such row is also published immediately. |
| **Uncaught throw mid-batch** (DOM shape change, `getElementById('terminal')` null, bad edit) | L ❌ B ❌ O ❌ *stale* T ✗ — **and the bridge died** | **L ✅ B ✅ O ✅ (`status:"error"`, partial results + stack) T ✅ (`health:"error"`) — bridge keeps serving** | batch `catch` → `publishOut('error', describe(err))`, `note('error')`, `record(errors, err)`; `finally` → `release` + `dropBusy`; 5s backoff; loop continues. |
| **Throw outside the batch** (`ns.fileExists`, `acquire`) | died | **loop survives, `T` = `error`, 1s backoff** | outer `catch`. Nothing to release (either the inner `finally` ran, or we never acquired). |
| **`kill cmd.js` / `killall` / tail-window kill** | L ❌ B ❌ O ❌ *stale* T ✗ | **L ✅ B ✅ O ✅ (`status:"aborted"`, partial results) T ✅ (`health:"stopped"`)** | `ns.atExit('cmd-bridge')`. `killWorkerScript` → `stopAndCleanUpWorkerScript` for every external kill. |
| **Augmentation install** | L ❌ B ❌ O ❌ *stale* | **L ✅ B ✅ O ✅ T ✅** | same `atExit`. `prestigeAugmentation()` calls `prestigeWorkerScripts()` **first** — *"We must kill all scripts before doing anything else"* (`Prestige.ts:54-57`) — which loops `killWorkerScript(ws)` (`NetscriptWorker.ts:40-46`), so the callback runs with home's filesystem still intact. |
| **Tab close / page reload** | L ❌ B ❌ | **L ❌ B ❌** (unchanged) | `atExit` does not run. Covered downstream: `cmd.js` clears a stale `/cmd/busy.txt` at startup (kept from the original), and lock.js v2's instance nonce (port 12525) invalidates the surviving lock record on the next `acquire`. With the current v1 lock.js it is the 300s TTL, as today. |

**Why the install row matters more than it looks.** `prestigeHomeComputer()`
(`Server/ServerHelpers.ts:226-239`) resets programs, `serversOnNetwork`,
`isConnectedTo`, `ramUsed` and `messages` — it does **not** touch text files. So
`/cmd/busy.txt` and `/tel/ui-lock.txt` **survive an augmentation install**.
Without this change, the first life after an install boots with a stale busy
file (blocking `augbuy.js`'s wait loop) and a stale lock (standing `upkeep.js`
down) left over from the *previous* life. That is precisely the moment the repo
can least afford it.

---

## 3. RAM delta: **+0.00GB** (8.05 → 8.05)

Measured, not estimated, and the measurement reproduces the known figure.

A checker was written for this (kept in the session scratchpad, not in the repo)
that parses a file with acorn using the game's own walk rules —
`RamCalculations.ts:405-440`: the `Identifier` visitor adds every bare name, and
the overridden `MemberExpression` visitor walks **`node.property` as well as
`node.object`**, so `x.attempt` is priced exactly like `attempt` — then resolves
each name against the whole `RamCosts` tree the way `findFunc`
(`RamCalculations.ts:225-243`) does: **by bare name, recursing into every
namespace**. Imports are followed, `eval('document')`/`eval('window')` are
invisible to it exactly as they are to the game.

It prices the **current root `cmd.js` at exactly 8.05GB**, which is the figure in
the brief, so the model is right.

| | priced identifiers | total |
|---|---|---|
| root `cmd.js` (today) | `exec` 1.3, `getServer` 2, `scriptKill` 1, `rm` .6, `scp` .6, `killall` .5, `ps` .2, `fileExists` .1, `getServerMaxRam` .05, `getServerUsedRam` .05, `getHostname` .05 | **8.05** (1.6 base + 6.45) |
| `tools/staging/cmd.js` + **current root `lock.js`** | *identical set* | **8.05** |
| `tools/staging/cmd.js` + **staged `lock.js` v2** | + `isRunning` 0.1 | 8.15 |

So the delta of **this** change is **0.00GB**. The 0.10GB in the last row is
`ns.isRunning` inside the staged `lock.js` v2 — it belongs to that change, is
already documented in `NOTES-lock.md`, and appears no matter which caller
imports it.

Why zero:

- `ns.atExit` **0GB** (`RamCostGenerator.ts:605`), `ns.write` **0GB** (`:632`),
  `ns.read` **0GB** (`:634`), `ns.exit` **0GB** (`:604`) — so `note.exit` is free
  too.
- `status.js` references only `ns.write`; importing it is 0GB. Confirmed by the
  checker: adding the import changed nothing.
- `ns.rm` and `ns.fileExists` were already referenced by the original.
- No ns function is referenced that was not referenced before.

**The bare-identifier trap was checked explicitly.** Every name this change
introduces was looked up in the extracted `RamCosts` table (502 entries): `live`,
`emit`, `tally`, `note`, `errors`, `detail`, `queued`, `beatAt`, `busyHeld`,
`dropBusy`, `publishOut`, `state`, `why`, `row`, `failed`, `status`, `record`,
`publish`, `describe`, `reporter`. **None of them are in the table.** For
contrast, the same lookup returns `attempt` → 10 (`ns.codingcontract.attempt`,
the 10GB `augbuy.js` is paying for a loop variable), `grow` → 0.15 and `share`
→ 2.4, so the check is live and not vacuously passing.

No existing identifier was renamed, so no existing cost could move.

Verification commands used:

```
node --input-type=module -e "$(sed 's|^import .*||' tools/staging/cmd.js)"
  -> ReferenceError: document is not defined     (i.e. it PARSED)
```

The control flow was additionally exercised under plain `node` against a fake
`ns` and a fake `document` (four scenarios: clean batch, mid-batch DOM throw,
kill mid-batch, kill while idle). All four produce the matrix in §2 —
in particular the killed batch leaves no busy file, no lock, and an
`/cmd/out.txt` reading `"status": "aborted"`, `"completed": 3`, `"queued": 4`
with the three finished commands in it.

---

## 4. `/cmd/out.txt` staleness — it **was** broken, and it is now fixed

**The question:** a caller polls for the absence of `/cmd/busy.txt`, then reads
`/cmd/out.txt`. If a batch throws halfway, does it see partial results or
nothing?

**Before: neither. It saw the *previous batch's* results and could not tell.**
`/cmd/out.txt` was written exactly once, after the command loop. A throw
anywhere in the loop skipped that write, so the file kept the last *successful*
batch's JSON — complete, well-formed, with its own `at` timestamp. Combined with
leak 2 the caller usually hung instead (busy never disappeared, so it timed out
and at least knew something was wrong). **Fixing the busy leak alone would have
made this worse**: busy now vanishes promptly, so the caller reads the file
immediately and gets a confident, wrong answer. The two fixes have to land
together.

**After**, the file always describes the newest batch:

- Stamped **`status: "running"` with `results: []` at batch start**, in the same
  synchronous step that consumes `/cmd/in.txt` and creates `/cmd/busy.txt`. The
  previous batch's output is therefore gone the instant the new batch exists —
  it can never be mistaken for the new one.
- **Republished after every command** (`emit()`), so partial progress is always
  visible, including while a long `backdoor` is still running.
- Final state is one of `ok` / `error` / `aborted`, with `error` carrying the
  stack (`describe(err)`) and `completed` / `queued` saying how far it got.

**The ordering is safe against an outside reader.** Netscript v2 scripts are
ordinary JS on the browser main thread and every ns call is synchronous unless it
returns a promise (`Netscript/APIWrapper.ts:78-82`), so the
`read(IN)` → `rm(IN)` → `write(BUSY)` → `write(OUT, running)` sequence contains
no `await` and cannot be observed half-done — the RFA handler cannot run in the
middle of it.

**Shape compatibility.** `at` and `results` keep their names and meaning;
everything else (`status`, `startedAt`, `queued`, `completed`, `error`) is
additive, and each `results[]` row is unchanged
(`{command, output, error, via?}`). Nothing in the repo parses this file —
`autobuy.js`, `backdoor.js` and `augbuy.js` only test `/cmd/busy.txt` and
`/cmd/in.txt` for existence, and the daemon never reads it — so the only
consumers are external `getFile` callers and the humans/agents reading them.

### The one race left, which cmd.js cannot fix alone

A caller that pushes `/cmd/in.txt` and polls **only** `/cmd/busy.txt` can look
*before the bridge has picked the batch up*: busy does not exist yet, so it reads
`out.txt` and gets the last batch. That is a protocol hole, not a leak, and no
amount of care inside cmd.js closes it.

Mitigations now available, in order of strength:

1. **Poll `/cmd/in.txt` OR `/cmd/busy.txt`.** While either exists, the batch is
   in flight. `autobuy.js:76` and `backdoor.js:132` already do exactly this; the
   external `curl` recipe in `CLAUDE.md:156` says only "poll for its absence" and
   should say both. (**Not edited** — `CLAUDE.md` is the lead's file.)
2. **Check `status`.** `running` means do not read the results yet.
3. **Check `startedAt`** against when you pushed.

---

## 5. What else changed, and what deliberately did not

Changed, all of it resource-safety or reporting:

- `try` / `catch` / `finally` around each batch; an outer `try` / `catch` around
  the poll so a throw in `ns.fileExists` or `acquire` cannot kill the bridge.
- `ns.atExit(..., 'cmd-bridge')` releasing the lock, dropping the busy file,
  flushing `out.txt` and writing `health: 'stopped'`. Inside it the shared
  resources are given back **first**, each in its own `try`, so a failure while
  *reporting* cannot cost the lock.
- New status file **`/tel/cmd.txt`** via `status.js`'s `reporter`:
  `health` ∈ `ok | waiting | locked | error | stopped`, plus `batches`,
  `commandsRun`, `batchesFailed`, a rolling `errors` tail of 5, and `detail`.
  The daemon mirrors anything under `tel/` (`tools/rfa-daemon.mjs:416-419`), so
  it lands in `.telemetry/cmd.txt` with no daemon change.
- A 60s idle heartbeat (`health: 'waiting'`). Without it "alive and idle" and
  "dead" look the same in the status file, which is the whole failure class being
  fixed. One write a minute; `ns.write` is 0GB.
- `results.push(...)` → `emit(...)` at the six result sites, so every row is
  published as it happens. Same rows, same fields, same order.
- A 5s backoff after a failed batch. Almost every throw happens after
  `/cmd/in.txt` is consumed, so the loop just goes idle — but a throw in the
  `read`/`rm` pair itself would leave the input in place and spin the loop, and
  the lock, at 1Hz.
- `dropBusy()` only removes `/cmd/busy.txt` if *this* process wrote it.

Deliberately left exactly as it was:

- **Everything about the React path.** The native `value` setter, the `input`
  event React actually listens to, the separate Enter `keydown`
  (`TerminalInput.tsx:244`), `eval('document')`/`eval('window')` to hide 25GB
  each from the RAM checker, `showTerminal()`'s unfocus-then-click-nav order, the
  600ms wait for the Terminal tab to mount, `restoreFocus()`.
- **The backdoor completion logic**, verbatim, including the long comment that
  explains why line counting is the wrong instrument (the in-place progress bar
  problem) and why `ns.getServer(host).backdoorInstalled` is polled instead. The
  300s and 120s bounds, the 800ms stability window, the `slice(-8)` tail fallback
  and the `touch(ns)` every 30s are unchanged.
- `runNative()` — byte-identical. Same verbs, same strings.
- The `FORBIDDEN` list and the refusal row it produces.
- The prompt-echo filter and the 4000-char output cap.
- `connected` tracking and the `connect`/`home` regexes.
- The `acquire(ns, 'cmd.js')` call site and its default 180s wait. **Not**
  converted to staged `lock.js`'s `withLock()`: that would make this file
  depend on lock v2 landing first, and the `atExit` already makes it leak-proof
  under either version.
- The startup `if (ns.fileExists(BUSY,'home')) ns.rm(BUSY,'home')`.
- `/cmd/in.txt` semantics: read, then deleted, before anything executes.

---

## 6. Still wrong, not fixed here

1. **A failed batch loses its unrun commands.** `/cmd/in.txt` is deleted before
   the first command executes, so a throw at command 3 of 6 discards 4–6. I did
   **not** re-queue them: `/cmd/in.txt` is a live queue owned by the game-player
   agent, writing to it from here could stomp a batch pushed in the meantime, and
   re-running a partially-applied batch is not generally safe (`connect` /
   `backdoor` / `buy` are not idempotent in the way a caller would need). The
   caller can now see exactly which commands ran, which is the information needed
   to decide. **Flagged, not fixed.**
2. **The push-before-pickup race in §4** needs a one-line change in
   `CLAUDE.md`'s protocol description (poll `in.txt` *and* `busy.txt`). Not
   edited — not my file.
3. **`cmd.js` does not check it is running on home.** The lock file, the busy
   file and both `/cmd` files are home-relative, and `ns.write`/`ns.read` take no
   host (`NetscriptFunctions.ts:1041`, `:1078`). Staged `lock.js` v2 refuses
   off-home loudly; `cmd.js` would still half-work. Adding `ns.self().server`
   here is 0GB, but it is a behaviour change, not a leak, and lock v2 already
   covers the dangerous half.
4. **Two `cmd.js` instances would still fight.** The startup busy-file clear is
   unconditional, so a second instance wipes the first's busy flag. The lock
   serialises the actual terminal driving, so the damage is limited to the busy
   protocol — and two bridges is already a broken state that CLAUDE.md warns
   about.
5. **`augbuy.js` is still paying 10GB for a loop variable named `attempt`**
   (`RamCostGenerator.ts:388`). Confirmed again by the checker here. Out of scope
   for this file, already flagged in `NOTES-observability.md`, still worth a
   repo-wide sweep.
6. **Not verified against the running game.** Ports 12525/12526 were not touched
   as instructed, so the RAM figures come from `RamCostGenerator.ts` plus the
   static checker (which reproduces the live 8.05GB exactly), not from
   `calculateRam`. When this lands, the daemon's push log should read `+0.00`.
   **If it does not, stop and read it** — the model above is wrong somewhere.

---

## 7. Deployment order

1. **`status.js` must be on home before `cmd.js` lands.** The import is resolved
   statically; a missing module is a hard compile failure, not a degradation. It
   is the same prerequisite `NOTES-observability.md` lists, and it is already
   required by the four other staged scripts.
2. `cmd.js` only ever runs on home, so no `scp` of the module to other servers is
   needed for this file (unlike `tel.js` / `buyserv.js`).
3. Editing a file does not restart it: the running `cmd.js` keeps the old code
   until killed. Kill it and let `watchdog.js` bring it back — and expect the
   *old* process to leak its lock and busy file one last time on the way out,
   because the fix is in the new code, not the old.
4. Do this **between** batches, not during one, and not while an install is in
   flight.
