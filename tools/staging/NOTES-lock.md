# lock.js v2 — global UI/terminal mutex

Staged at `tools/staging/lock.js`. **Not deployed.** `tools/` is not synced to the
game, which is deliberate: the live game is mid-run and approaching an install,
and a broken `lock.js` at the repo root would go live within ~150ms.

Line references of the form `File.ts:NN` are into `~/Repos/bitburner`
(`bitburner-official/bitburner-src` fork). Everything asserted below was read
out of that tree, not recalled.

---

## 1. What was wrong

| # | Problem | Consequence |
|---|---|---|
| 1 | Staleness decided by a 300s TTL | A live-but-slow holder had its lock **stolen while still clicking** — the exact corruption the lock exists to prevent. A dead holder blocked everyone for the full 5 minutes (the ~3h `upkeep` outage was this, compounded by #5). |
| 2 | No host in the record | Cosmetic here — see §3, pids are global — but you cannot diagnose a bad lock without it. |
| 3 | **`current()` read two different servers** | `ns.fileExists(LOCK,'home')` + `ns.read(LOCK)` (local) + `ns.rm(LOCK,'home')`. On any host but `home` this silently never acquires. |
| 4 | Leak on kill | `finally` does not run when a script is killed; `watchdog`/`killall`/tail-kill all leak the lock for a full TTL. |
| 5 | **An unparseable lock file was immortal** | The legacy fallback returned `{at: Date.now()}` *recomputed on every read*, so `Date.now() - at > STALE_MS` was permanently false. A corrupt or hand-written lock file deadlocked every caller forever, with no message. This is a strictly worse bug than the one the TTL was added to fix. |
| 6 | 150ms sleep + re-read on every acquire | Harmless but pointless (§4). |

---

## 2. The new design

Record (JSON, `/tel/ui-lock.txt` on `home`):

```json
{"v":2,"owner":"augbuy","pid":1234,"host":"home","file":"augbuy.js",
 "inst":"lock2:m1x8q2:7fa3e1","at":1757700000000}
```

**Liveness replaces the timer.**

```
ns.isRunning(pid)                              NetscriptFunctions.ts:1028-1030
  -> helpers.getRunningScript(ctx, pid)
  -> findRunningScriptByPid(pid)               NetscriptHelpers.tsx:829-832
  -> workerScripts.get(pid)                    Script/ScriptHelpers.ts:105-109
```

`workerScripts` is one global `Map` keyed by pid. A dead holder is detected on
the next 500ms poll instead of after 300s, and a live holder is **never**
stolen from on a timer alone.

**Instance nonce, carried in a Netscript port, kills the ABA problem.**
`NetscriptPorts` is a plain in-memory `Map` (`NetscriptWorker.ts:38`), is not in
the save file, and is emptied by `prestigeWorkerScripts()`
(`NetscriptWorker.ts:40-46`) — called from `Prestige.ts:57` and `:204` and
`AugmentationHelpers.ts:76`, i.e. on every install. A page reload clears it too,
because it is just a module-level `Map`. Port 12525 therefore holds a token that
is unique to this run of the game process; a lock record whose `inst` does not
match is from a previous life, so its pid being "alive" is an impostor.

**`ns.atExit` plugs the leaks, from inside `lock.js`, for free.**
`acquire()` registers `ns.atExit(() => release(ns), 'ui-lock')`. `atExit`
callbacks run from `stopAndCleanUpWorkerScript()` **before** `ws.stopFlag = true`
(`killWorkerScript.ts:64-84`), so synchronous ns calls inside them still work
(`checkEnvFlags` at `NetscriptHelpers.tsx:449-466` passes, and `ws.runningFn` was
cleared on line 63). Every termination path funnels through there: normal return
and uncaught throw both call `killWorkerScript` (`NetscriptWorker.ts:144-159`), as
does an external `ns.kill`. Callers that throw, return early, or get killed now
release anyway — **without editing a single caller**.

**Off-`home` is refused loudly.** `ns.write(filename, data, mode)` and
`ns.read(filename)` take no host and always act on
`ctx.workerScript.getServer()` (`NetscriptFunctions.ts:1041` and `:1078`), while
`ns.fileExists`/`ns.rm` do take one. There is no way to write a file to another
server from Netscript, so a cross-host mutex through a file is not expressible.
`acquire()` now checks `ns.self().server !== 'home'` and returns false with a
message rather than spinning to its deadline in silence.

**Other changes:** re-entrant `acquire()` by the same pid succeeds (and refreshes)
instead of deadlocking against itself; `holder()` now reports `alive` and the
steal reason; a `withLock(ns, owner, fn)` wrapper is exported so callers can
become leak-proof by construction; the 150ms sleep is gone (the re-read is kept
but re-labelled as an assertion that the write landed, which is what it actually
is).

### What the TTL is still for — the cases liveness cannot cover

1. **A holder that is alive but wedged** (an unbounded DOM poll, an `await` that
   never settles). `isRunning` says "alive" and it is; nothing observable
   separates it from a slow-but-working holder. `STALE_HUNG_MS = 30min`, and the
   steal prints loudly. 30 minutes is safe now precisely because every *fast*
   failure mode is caught in one 500ms poll.
2. **A record with no usable pid** — hand-written, pre-mutex flag file, or
   corrupt. `STALE_LEGACY_MS = 300s`, measured from *when the file was first
   seen*, not from a timestamp it may not carry. This is the fix for bug #5.
3. **v1 records** (no `inst`). During rollout, and for any stale copy of the old
   `lock.js` on another server, a v1 record gets pid-liveness plus the timer —
   strictly better than v1, and never worse. Forward-compatible too: old code
   reading a v2 record just ignores `inst` and behaves as it does today.

### Deliberately NOT covered

Tab close/reload while holding: `atExit` does not run. Case handled by the nonce
on the next `acquire`, at no cost.

---

## 3. Does the record need a host? No — but it records one anyway

`generateNextPid()` (`Netscript/Pid.ts:6-26`) will not return a pid that
`workerScripts.has()`, and `workerScripts` is global across all servers. So a
pid is unique game-wide among live processes, and `ns.isRunning(pid)` /
`ns.getRunningScript(pid)` take the `findRunningScriptByPid` branch
(`NetscriptHelpers.tsx:829-832`) which never looks at a host. **No host is
required for the liveness check to be correct.**

Pids are *not* unique over time: `resetPidCounter()` (`Pid.ts:38-40`) sets the
counter back to 1 on every prestige (`Prestige.ts:194`, `:360`), and the counter
is module state so a page reload resets it too — while `/tel/ui-lock.txt` on home
survives all three. That is the ABA hole; the nonce closes it, not a host field.

`host` and `file` are recorded regardless, because `ns.self()` is 0GB and they
are the first two things you want when a lock misbehaves.

---

## 4. The race: check-write-reread is safe, and the re-read is not what makes it safe

**Conclusion: there is no race on the acquire path, because there is no yield
point between the check and the write.** The comment in v1 (*"scripts interleave
at every await — so 'file missing, therefore mine' is not safe on its own"*) is
half right: they do interleave at every await, and there is **no await between
the check and the write**, so the pair is atomic.

Evidence:

1. **Netscript v2 scripts are ordinary JS modules on the browser main thread.**
   `NetscriptJSEvaluator.ts` compiles each to a blob and `import()`s it;
   `startNetscript2Script` just `await mainFunc(ns)` (`NetscriptWorker.ts:66`).
   There is no worker, no second thread.
2. **Every ns call is synchronous end to end unless it returns a promise.** The
   API proxy wrapper is exactly
   `checkEnvFlags(ctx); updateDynamicRam(ctx, cost); return field(ctx, ...args)`
   (`Netscript/APIWrapper.ts:78-82`) — no `await`, no microtask.
   `ns.read` (`NetscriptFunctions.ts:1076-1078`), `ns.write` (`:1036-1056`) and
   `ns.fileExists` are plain in-memory `Map` operations on the `Server` object.
3. **The only yield is an explicit delay.** `netscriptDelay`
   (`NetscriptHelpers.tsx:468-481`) hands control back via
   `window.setTimeout` — the event loop, main thread. Nothing else can run until
   the script awaits.
4. **NS1 is gone.** The one execution model that *could* preempt mid-statement
   was the NS1 interpreter, and `.script` files no longer run at all
   (`NetscriptWorker.ts:106-107`: `"Running .script files is unsupported."`). So
   the atomicity argument has no exception in this game version.

Therefore in

```js
const held = current(ns)      // ns.read      — sync
const why  = stealReason(...) // ns.isRunning — sync
writeRecord(ns, owner, who)   // ns.write     — sync
```

no other script can observe or modify the file between the three. Two waiters
cannot both conclude "free". The `await ns.sleep(POLL_MS)` sits at the *bottom*
of the loop, after the decision, which is the correct place for it.

The re-read is kept, but it is **not** a race check (with no intervening await it
is tautologically true). It is an assertion that `ns.write` actually landed —
believing we hold a lock we do not is worse than not having one — and it now
costs nothing, since the 150ms sleep that used to precede it is gone.

### The real concurrency hazard in this file, which is not a race

`lock.js`'s **module scope is shared by every script that imports it.**
`NetscriptJSEvaluator.ts` caches `LoadedModule`s by generated code
(`moduleCache`, `NetscriptJSEvaluator.ts:41`, used at `:175-212`) and importing
the same blob URL returns the same module namespace — so there is exactly one
instance of `lock.js`'s module scope for the whole game, live-shared between
`cmd.js`, `augbuy.js`, `nfg.js`, and it outlives any individual script.

This bit during development: an obvious `ns.self()` memo at module scope would
have handed the *first* caller's pid to every later caller, and `release()` would
then have deleted another script's lock. The staged file carries a banner comment
about it, uses `ns.pid` (free, allocates nothing) everywhere a pid is all that is
needed, and keeps only file-scoped state (`legacySeenRaw`/`legacySeenAt`) up
there, which is legitimately global and self-invalidating.

**This is a hazard for every other module in the repo too** (`common.js`,
`golib.js`, `constants.js`, …). Any module-level `let` in a shared module is
shared between all running scripts. Worth a line in CLAUDE.md.

---

## 5. RAM

Method: identifier-level accounting matching the game's own calculator.
`RamCalculations.ts:404-409` adds **every AST `Identifier` by bare name** (and
member-expression property names) to the dependency map, then
`RamCalculations.ts:243-246` prices each name once against `RamCosts` —
`loadedFns[ref]` guarantees *once per name across the whole import graph*. I
reproduced that with the game's own acorn over each script and its imports.
Verify before shipping with `curl -X POST localhost:12526/rpc -d
'{"method":"calculateRam",...}'` or the daemon's push log.

Relevant unit costs (`Netscript/RamCostGenerator.ts`): `isRunning` 0.1,
`fileExists` 0.1, `rm` 0.6 (`Scp`), `ps` 0.2, `getRunningScript` 0.3,
`self` 0, `atExit` 0, `getPortHandle`/`peek`/`write`/`clear`/`read`/`sleep`/
`tprint`/`print` 0, base 1.6.

### `lock.js` itself

| | names it contributes | standalone |
|---|---|---|
| v1 | `fileExists` 0.1, `rm` 0.6 | **2.30 GB** |
| v2 | `isRunning` 0.1, `rm` 0.6 | **2.30 GB** |

Net zero, because dropping `ns.fileExists` pays for `ns.isRunning` exactly.
`ns.read` returns `''` for a missing file at 0GB, so the existence probe was
never needed — and removing it also removes the host mismatch of §1.3. The nonce
(ports), `ns.self()` and `ns.atExit` are all 0GB.

### Every importer

| script | v1 | v2 | delta |
|---|---|---|---|
| `homeup.js` | 4.45 | 4.45 | **0.00** |
| `torbuy.js` | 2.45 | 2.45 | **0.00** |
| `nfg.js` | 2.40 | 2.40 | **0.00** |
| `settings.js` | 2.30 | 2.30 | **0.00** |
| `augbuy.js` | 12.30 | 12.40 | **+0.10** |
| `cmd.js` | 8.05 | 8.15 | **+0.10** |
| `upkeep.js` (does not import it) | 2.20 | 2.20 | 0.00 |

**Total repo cost: +0.20 GB**, on two single-threaded scripts. The four that pay
nothing already sourced `fileExists` solely from `lock.js`; the two that pay
+0.10 call `ns.fileExists` themselves, so the saving does not accrue to them.

Nothing multi-threaded imports `lock.js` — the whole importer set is the six
one-shot UI/terminal drivers — so there is no thread multiplier anywhere in this
change.

### Verdict: **ship it.**

+0.20 GB total, against removing a 5-minute steal-from-a-live-holder window, a
5-minute block on a dead holder, a permanent deadlock on a corrupt lock file, and
every kill-path leak. The alternative considered — `ns.getRunningScript(pid)` at
0.3GB, which would also verify the holder's filename and server and so harden the
ABA case without the port — was rejected for two reasons: the nonce already
covers ABA exactly and costs nothing, and `getRunningScript` goes through
`createPublicRunningScript` (`NetscriptHelpers.tsx:864-896`) which copies the
holder's entire log array on **every 500ms poll**. `ns.isRunning` is a `Map`
lookup. On a shared browser main thread that difference matters more than the
0.2GB does.

No `go.js`/`go-cheat.js`-style split is warranted: the expensive surface here
would have been 0.3GB, and the design got the cost to 0.1GB without one. If a
future version does want `getRunningScript`, put it in a separate script rather
than in `lock.js` — but it should not need to.

### Free 10GB sitting in `augbuy.js` (not mine to fix)

`augbuy.js:62` is `for (let attempt = 0; attempt < 3; attempt++)`.
`RamCalculations.ts:404-409` prices identifiers by bare name and
`RamCostGenerator.ts:387` is `codingcontract.attempt = 10`. **That loop variable
costs 10 GB.** `augbuy.js` is 12.30 GB and would be **2.30 GB** if it were
renamed to `try_`/`pass`/`i`. Nothing else in the importer set has this footgun —
`cmd.js`'s 8.05 GB and `homeup.js`'s 4.45 GB are all genuine calls. Handing this
to the error-handling agent, since `augbuy.js` is theirs; their staged rewrite
still carries it (`tools/staging/augbuy.js:108`).

---

## 6. Caller leak audit

`ns.atExit` in v2 closes every one of these *for the lock specifically*, without
editing any caller. They are still listed because (a) each also leaks whatever
else it was holding, and (b) an explicit `finally` releases **sooner**, which
matters when the next script is waiting.

> **Coordination with the error-handling agent.** Their staged `augbuy.js:85`
> and `torbuy.js:81` already register `ns.atExit(() => { release(ns); ... })`
> with **no id**, i.e. id `"default"` (`NetscriptFunctions.ts:1395-1399`). The
> `atExit` map is keyed by that id, so a second registration under the same key
> silently *replaces* the first. `lock.js` therefore registers under the
> explicit id `'ui-lock'`, which coexists with theirs: both callbacks run, and
> the second `release()` is a no-op because it pid-checks. **Anything else that
> adds an `atExit` in these scripts must also use a distinct id**, or it will
> delete somebody's status note.

**Do not edit — owned by the error-handling agent** (`augbuy.js`, `torbuy.js`,
`upkeep.js`, `tel.js`, `buyserv.js`):

| file | state | leak |
|---|---|---|
| `augbuy.js` | **worst.** No `try` at all: `acquire` at :45, then **six** scattered `release()` calls on individual return paths (:99, :126, :136, :169, :177, :190). | Any throw between them leaks. The DOM walk is full of throwables — `n.innerText` at :91 on a null `parentElement`, `b.closest(...)` at :119/:125, `doc.querySelectorAll` — and this is the script that runs during the install. Wrap the body in `try/finally`, or use `withLock`. |
| `torbuy.js` | `acquire` at :74 inside a `try` opened at :63, `catch` at :147 calls `release` (:149). | Mostly covered. `release()` also runs on paths where the lock was never taken — harmless (it pid-checks), but it reads as if it were meaningful. A `finally` would be clearer than a `catch` that both logs and releases. |
| `upkeep.js` | Does **not** import `lock.js`; it hardcodes the path at :70 and checks `ns.fileExists(LOCK, 'home')` at :119 to stand down. | No leak, and correctly host-qualified. One note: the duplicated path constant can drift from `lock.js`'s `LOCK`. |
| `tel.js`, `buyserv.js` | Do not touch the lock at all. | — |

**Not owned by that agent, but still root `.js` — I could not touch these either:**

| file | state | leak |
|---|---|---|
| `cmd.js` | `acquire` at :187, `release` at :339, **no `try`** around ~150 lines of terminal driving and DOM work. | Any throw leaks the lock *and* `/cmd/busy.txt` (written :195, removed only at :338). `/cmd/busy.txt` then blocks `augbuy.js`'s wait loop at :56 for its full 30s. This is the longest-held lock in the repo (`backdoor` batches) and the least protected. It does call `touch(ns)` every 30s during a backdoor (:282), which is correct and now only matters for the 30-minute wedge backstop. |
| `nfg.js` | `try` / `catch` / **`finally { release }`** at :215-217. | Clean. The model for the others. |
| `homeup.js` | `try`/`catch` at :113-176, `release` at :181 *outside* it. | `report(ns, ...)` at :179 sits between the catch and the release; if it throws, the lock leaks. Move `release` into a `finally`. |
| `settings.js` | `try`/`catch` at :118-158, `release` at :170 outside it. | Same shape: the `ns.write(STATUS, ...)` at :160-164 is between the catch and the release. Same fix. |

Nobody calls `touch()` except `cmd.js`. With a 30-minute backstop that is fine
for every current holder, but `nfg.js` can loop for a long time buying NFG levels
— if it ever exceeds 30 minutes under the lock it should `touch()` per iteration.

---

## 7. What I did not fix

- **Nothing is deployed.** `tools/staging/lock.js` has to be copied to
  `lock.js` at the repo root to take effect, and that push goes live in ~150ms.
  Do it when the install is not imminent, and verify with the `getFile` diff in
  CLAUDE.md — the auto-push has silently failed before.
- **Scripts already running keep the old code** (CLAUDE.md, "Editing a file does
  not restart it"). After deploying, kill and let `watchdog.js` revive the
  importers, or old and new records coexist. They are designed to coexist (§2.3),
  but the old code still has bug #5.
- **Caller `try/finally` blocks** — not edited, per the file-ownership split.
  `atExit` makes them non-critical; they are still the right thing.
- **`augbuy.js`'s 10GB `attempt` identifier** — reported, not touched.
- **`upkeep.js` hardcodes `/tel/ui-lock.txt`** instead of importing `LOCK` from
  `lock.js`. Importing it would cost `upkeep.js` +0.6GB (`rm`), which is why it
  probably should not — but then the constant should move to `constants.js`.
- **`boot.js` should `ns.rm('/tel/ui-lock.txt','home')` on startup.** After an
  install, `boot.js` is run by hand (CLAUDE.md, install procedure step 4) and is
  the only thing guaranteed to run first; clearing the lock there would make the
  post-install state unambiguous rather than relying on the nonce. Root `.js`,
  so not touched.
- **Port 12525 is now reserved** by `lock.js`. Nothing in the repo uses Netscript
  ports today (checked), but nothing enforces it either. If another script ever
  clears that port while a lock is held, the nonce regenerates and the holder
  looks like an impostor — it would be stolen from while alive. Cheap guard if it
  ever matters: require `!ns.isRunning(pid)` as well before believing a nonce
  mismatch. Not done, because it would also defeat the fast post-reload recovery
  that is the nonce's main job.
- **No test.** The interesting states (dead holder, post-prestige ABA, corrupt
  file) are all reachable from `tools/sim/`, which stands the real game up under
  jsdom; a harness there would be worth more than any of the above. Out of scope
  for this pass.
