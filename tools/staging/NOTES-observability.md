# Observability fix: five scripts that wrote no telemetry on error

Staged in `tools/staging/`. **Nothing here is live.** `tools/` is not synced to
the game, so these files must be moved to the repo root by whoever deploys —
see *Deployment prerequisite* at the bottom, which is not optional.

| File | Status file | Was | Now |
| --- | --- | --- | --- |
| `status.js` | — | did not exist | new shared module, 0GB to import |
| `tel.js` | `/tel/status.txt` | no try at all — one throw killed the reporter | never dies; error and exit both publish |
| `buyserv.js` | `/tel/buyserv.txt` | `catch { ns.print }` | catch publishes; atExit publishes |
| `upkeep.js` | `/tel/upkeep.txt` | `catch { ns.print }` | catch publishes; atExit publishes |
| `torbuy.js` | `/tel/torbuy.txt` | `catch { ns.print; release }` | catch publishes; atExit publishes + releases |
| `augbuy.js` | `/tel/augbuy.txt` | no try/catch around the whole sequence | try/catch/finally + atExit; **lock leak fixed** |

---

## The shared module: `status.js`

### Why this shape

Three exit paths have to publish, and only two of them are reachable from
inside the script:

1. **success** — `note('ok', …)` at the end of the try
2. **handled error** — `note('error', …)` from the catch (the batch.js fix,
   generalised)
3. **everything else** — `note.exit(…)` from `ns.atExit`: a `kill`, a killall,
   an augmentation install, or a throw that escapes every handler

(3) is the one no `try/finally` can reach, and for a long-running loop it is
the *likely* one — the watchdog kills and relaunches things routinely. It is
also the only way "this process is gone" can ever appear in the file, which for
`tel.js` is the entire bug: a status file that stops being written is
indistinguishable from a world that stopped changing.

Surface:

```js
describe(err)                 // throw -> "TypeError: … <- at foo (bar.js:12)" , capped at 400 chars
publish(ns, file, body)       // the raw write; never throws, falls back to a minimal body
record(errors, err, keep=20)  // push a bounded failure tail; returns the rendered text
reporter(ns, file, base)      // -> note(health, fields), with note.exit(health, fields)
```

`reporter` emits `at` first, then `health`, then `base`, then the caller's
fields — **caller fields win**, which is what lets every existing status file
keep its own `result` / `work` / `note` / `fleet` names (things read those) and
merely gain `health` alongside. Nothing was renamed or removed anywhere.

`health` is the uniform one-glance word, matching the one `batch.js` already
publishes: `ok | waiting | locked | error | stopped`.

`base` may be a thunk, which is how the moving counters (`refocused`,
`exportClaims`, the rolling `errors` tail) get onto *every* write without each
call site restating them.

### Why the error tail exists

Without it a loop that throws once an hour publishes an error for five seconds
and then overwrites it with `ok` forever — visible only to someone looking at
exactly the right five seconds. `errors: errors.slice(-5)` now rides along on
the **healthy** writes too, which is what `batch.js` already does and the reason
its incident was eventually diagnosable.

### Why importing it is free — verified, not assumed

Netscript bills per *identifier* in the import graph: `Script/RamCalculations.ts`
overrides the `MemberExpression` walker to visit the property as well as the
object, so the bare name `scp` costs 0.6GB wherever it appears, on any object,
reachable or not.

`status.js` references exactly one ns function: **`ns.write`, which is 0GB**
(`Netscript/RamCostGenerator.ts:632`, alongside `read: 0` and `atExit: 0`). It
has no `eval('document')` (that would be 25GB). Import cost: **0GB**, same class
as `homecost.js`.

Verified mechanically rather than by eye: a checker was written that parses each
file with acorn using the game's own visitor overrides and cross-references
every identifier against the `RamCosts` table extracted from
`RamCostGenerator.ts`. `status.js` and `homecost.js` both come back with zero
priced references; `lock.js` comes back with `fileExists=0.1, rm=0.6`, which
matches.

### What is deliberately NOT in the module

- **`ns.scp` (0.6GB) + `ns.getHostname` (0.05GB).** The daemon only mirrors
  `/tel/*` off *home* (`tools/rfa-daemon.mjs:262-268`), so a script on a rooted
  server must copy its status over. Putting that here would bill 0.65GB to
  **every** importer, including ones that only ever run on home. `tel.js`,
  `buyserv.js` and `batch.js` already reference both and do the copy inline —
  it stays there, where it is already paid for. Each of those now has a local
  `mirror()` closure so the error and exit paths can use it too.
- **`ns.rm` (0.6GB), `ns.fileExists` (0.1GB), anything that reads the game.** A
  reporter must not need the world to be readable in order to report that the
  world is unreadable.

This is the constraint to defend. One careless call added here raises the floor
of every importer at once, multiplied by thread count.

---

## RAM delta: **0.00GB on all five**

Measured, not estimated. The set of priced ns identifiers is *byte-identical*
between each original and its staged version:

| File | priced ns refs before | after | delta |
| --- | --- | --- | --- |
| `tel.js` | scan .2, ps .2, scp .6, hasRootAccess .05, getServerMaxRam .05, getServerUsedRam .05, getServerMoneyAvailable .1, getServerMaxMoney .1, getServerSecurityLevel .1, getServerMinSecurityLevel .1, getServerRequiredHackingLevel .1, getTotalScriptIncome .1, getTotalScriptExpGain .1, getHostname .05, getPlayer .5 | identical | **0** |
| `buyserv.js` | getServerNames 1.05, purchaseServer 2.25, upgradeServer .25, getServerCost .25, getServerUpgradeCost .1, getServerLimit .05, getRamLimit .05, getServerMaxRam .05, getServerMoneyAvailable .1, fileExists .1, scp .6, getHostname .05, `grow` .15 | identical | **0** |
| `upkeep.js` | fileExists .1, getPlayer .5, `document` 25 | identical | **0** |
| `torbuy.js` | hasTorRouter .05, getServerMoneyAvailable .1, `document` 25, + lock.js | identical | **0** |
| `augbuy.js` | fileExists .1, `attempt` 10, `document` 25, + lock.js | identical | **0** |

Why zero:

- `status.js` contributes nothing (above).
- `ns.atExit` is **0GB** (`RamCostGenerator.ts:605`).
- `ns.write` is **0GB** (`:632`) — it was already being called in four of the
  five; `tel.js` gained no new ns surface at all.
- The `mirror()` closures in `tel.js` / `buyserv.js` hoist `ns.scp` and
  `ns.getHostname` calls that were already inline in the same file. Hoisting a
  call site does not change the identifier set.
- `const self = …` — `ns.self` is 0GB (`:601`), so the name is safe. `batch.js`
  already uses it.

Every new identifier introduced (`note`, `say`, `mirror`, `errors`, `record`,
`describe`, `reporter`, `settled`, `finished`, `lastGood`, `staleSince`,
`source`, …) was checked against the `RamCosts` table and none of them collide.
This mattered more than it sounds — see the `attempt` finding below.

`tel.js` therefore still fits in its ~4GB slot on a rooted server. It is
unchanged, not merely "close".

---

## Lock leaks

### `augbuy.js` — real leak, fixed

**Everything between `acquire(ns, 'augbuy')` and the final `release(ns)` ran
with no `try`/`finally`** — roughly ten seconds of DOM walking, `.click()`s,
`parentElement` chains and regex against `innerText`. A single throw in there
(a MUI class change, an undefined element, a bad edit) left `/tel/ui-lock.txt`
in place with nothing holding it, for its full 300s TTL, and `upkeep.js` stood
down for the duration. That is the failure that cost ~3 hours of unfocused (80%)
faction work.

Fixed two ways:

- `try { …whole sequence… } catch { out('error', describe(err)) } finally { release(ns) }`
- `ns.atExit(() => { release(ns); if (!finished) note.exit('error', …) })`, which
  also covers being killed mid-sequence — a `finally` cannot.

The ~8 scattered `release(ns)` calls on the handled paths were **left exactly as
they were**. `release()` re-reads the file and only removes it if `pid` still
matches, so releasing twice is a no-op; keeping them keeps this an observability
change rather than a rewrite of control flow.

### `torbuy.js` — no leak on the throw path, leak on the kill path, fixed

Its `catch` already called `release(ns)`, so a throw was handled. But it holds
the lock across ~4s of navigation, and being killed there (watchdog, killall,
install) left it behind. The `atExit` now releases unconditionally.

### `tel.js`, `buyserv.js`, `upkeep.js` — no lock involvement

None of them take the lock. `upkeep.js` only *observes* it (`fileExists(LOCK)`)
and stands down, which is unchanged.

### Not touched, but worth knowing

`nfg.js` and `homeup.js` both release in a `finally`, which is correct for
throws — but neither has an `atExit`, so both still leak the lock if killed
mid-sequence. `homeup.js` additionally calls `report(...)` *before* `release(...)`
outside any handler, so a throw inside `report` would leak. Three-line fixes,
but they are outside this task's file list and both are root files; flagging
rather than editing.

---

## Per-file changes

### `tel.js` — the important one

1. **The loop no longer dies on a throw.** It previously had no `try` at all, so
   one bad tick exited `main()` and the process vanished. `/tel/status.txt` then
   simply stopped changing — indistinguishable from a game that stopped
   changing, which is exactly how every downstream reader ends up consuming
   history as the present.
2. **The error write preserves the last good payload.** `note('error', {
   ...lastGood, error, staleSince, consecutiveErrors })`. Replacing it with a
   stub would break every reader that expects `processes` and `servers`; leaving
   it untouched is the silent-staleness bug. Keeping both — old payload, new
   header — is the only option that breaks nobody and lies to nobody.
3. **`atExit` publishes `health: 'stopped'`** with `exited: true` and
   `staleSince`, and mirrors it to home. This is the single highest-value line
   in the change: it is what makes a dead telemetry source say so.
4. New fields, all additive: `health`, `source` (which server is reporting,
   like `batch.js`'s `controller`), `errors` (rolling tail of 5), and on the bad
   paths `error` / `staleSince` / `consecutiveErrors` / `exited`.
   **No existing field was renamed or removed.**

`scanAll()` and the whole snapshot-building body are untouched, including the
`getTotalScriptIncome()[1]` comment.

### `buyserv.js`

- `catch` now publishes `health: 'error'` with the stack, the rolling error
  tail, the `reserve` it was working with, and the partial `log` of what it
  managed before throwing — then mirrors to home.
- `reserve` hoisted out of the `try` (was `const` inside) so the catch can
  report it. Only scoping changed; the value and the branch are identical.
- `atExit` publishes `stopped`. Worth having: a dead `buyserv` looks exactly
  like a healthy one from the outside (money accumulates, nothing complains).
- The purchase policy — concentrate-don't-level, largest affordable doubling,
  the 12-pass loop, `reserveNow` — is untouched.

### `upkeep.js`

- Both `ns.write` blocks became `say(...)`; the same fields go out, plus
  `health` and `errors`, plus `idleTicks`/`idleSeconds` now also on the
  "standing down" write (previously only on the normal one).
- `catch` publishes `health: 'error'` with the described throw in `note`.
- `state` hoisted out of the `try` so the error path can report **the last known
  work state** rather than overwriting `work` with something no reader expects.
  `work` keeps its `focused | unfocused | idle | locked` vocabulary; failure
  lives in `health` and `note`.
- `atExit` publishes `stopped`. A dead `upkeep` is worth 20% of all faction
  reputation, continuously, and looks like nothing at all.
- Focus logic, the export-bonus 24h gate, the `joined > 0` guard: untouched.

### `torbuy.js`

- `catch` publishes `health: 'error'` + `result: 'error'` + the stack, in
  addition to the existing `ns.print` and `release`.
- `say()` keeps its exact `(result, detail)` signature, so no call site moved;
  it now also sets a `settled` flag on `'ok'` so the `atExit` cannot overwrite a
  successful purchase with `stopped`.
- `atExit` releases the lock and, if not settled, publishes `stopped`.

### `augbuy.js`

- Whole sequence wrapped in `try`/`catch`/`finally` (lock leak, above).
- `out()` keeps its exact `(result, detail)` signature and its exact field names;
  every one of its ~8 call sites is character-for-character unchanged.
- `catch` publishes `result: 'error'` with the stack **and** prints a terminal
  line — previously an unhandled throw produced nothing whatsoever, which a
  caller cannot distinguish from "never launched".
- `atExit` releases the lock and reports if the run never reported.
- Every comment and every DOM heuristic preserved verbatim.

---

## Deployment prerequisite — read this before moving anything to root

**`status.js` must exist on every server that runs one of these scripts, or the
importing script will not compile there.** The RAM/import check is static and a
missing module is a hard failure, not a degradation.

This matters because:

- `tel.js` normally runs on a **rooted server**, not home (that is the whole
  point of it — it needs ~4GB).
- `buyserv.js` has been observed running on `joesguns` (`docs/gameplay-log.md`).
- Neither `watchdog.js:300` nor `boot.js:196` copies a script's *imports* — both
  do `ns.scp(script, target, 'home')` for the script alone. `lock.js` and
  `homecost.js` have the same latent gap today; it just has not bitten because
  their importers all run on home.
- The daemon's push overwrites *existing* copies; it does not create a copy of a
  brand-new module on a server that has never seen it.

So the deploy order is: land `status.js` on home first, confirm it, then the
five scripts, then `scp` the module to any host running `tel.js` / `buyserv.js`
before those are restarted. The durable fix is to teach `watchdog.js` and
`boot.js` to copy a script's module dependencies alongside it — I did **not**
make that change: `watchdog.js` is a root file and, as of this writing, another
agent has a modified `watchdog.js` staged in this same directory.

---

## Things I was unsure about, or deliberately left alone

- **`ns.write` is free, contrary to the brief.** The task said to check how
  `batch.js`/`homeup.js` pay for it; the game says `write: 0` and `read: 0`
  (`RamCostGenerator.ts:632,634`). What they actually pay for is the *mirroring*
  — `ns.scp` 0.6GB plus `ns.getHostname` 0.05GB — and that is the thing kept out
  of the shared module. The design conclusion is the same either way, but the
  reason is different, so it is written down here.

- **`augbuy.js` is paying 10GB for a loop variable.** `for (let attempt = 0; …)`
  — the RAM checker resolves bare identifiers against the *whole* `RamCosts`
  tree by name (`findFunc` recurses into namespaces), so `attempt` matches
  `ns.codingcontract.attempt` = 10GB (`RamCostGenerator.ts:388`). Renaming it to
  `tries` would recover 10GB for free. **Not done** — it is a behaviour-neutral
  change but it is not observability, and the brief says not to improve things I
  happen to dislike. Same class of trap as `buyserv.js`'s `let grow = null`
  (0.15GB, `ns.grow`). Worth a sweep across the repo at some point.

- **Making `tel.js` survive a bad tick is technically a behaviour change.** It
  used to die; now it logs and continues. I judged this in-scope because "the
  reporter is dead" is the failure being fixed, and because `batch.js` already
  carries the same "Never die. A bad tick is recoverable; a dead controller is
  not." reasoning. If that is not wanted, deleting the `try` wrapper leaves the
  `atExit` — which alone fixes the silent part, just not the dying part.

- **`buyserv.js`'s error write drops `money` / `owned` / `fleet`.** It could
  preserve the last good payload the way `tel.js` does. I chose not to, because
  re-reading the game inside a catch is how a catch block throws, and those
  fields are cheap for a reader to get elsewhere. `tel.js` gets the preservation
  treatment because it is the *only* source for what it reports.

- **`augbuy.js` does not restore focus on the error path.** `nfg.js` clicks
  Focus in its `finally`; I did not add that, because it is behaviour rather
  than observability and because `upkeep.js` refocuses within 15s once the lock
  is released — which now actually happens. Cheap to add if wanted.

- **Field-order changes.** `health` is now the second key in every status file
  (after `at`). JSON key order is not semantic and every previous field is still
  present under its old name, but if anything downstream does a line-oriented
  diff or a positional parse it will notice. I found no such reader:
  `watchdog.js` reads `/tel/backdoor.txt` `.remaining` and `/tel/nfg.txt`
  `.nextCost` by key, and the daemon mirrors bytes without parsing.

- **Not verified against the running game.** I did not touch ports 12525/12526,
  so the RAM figures are derived from `RamCostGenerator.ts` and a static
  identifier audit rather than read off `calculateRam`. Since every delta is
  zero and the identifier sets are identical, the daemon's push log should show
  `+0.00` for all five; **if it does not, stop and read it** — that means the
  model above is wrong somewhere.

- **Another agent is staging `lock.js` and `watchdog.js` in this same
  directory** (`tools/staging/lock.js`, `NOTES-watchdog.md`, timestamps
  alongside mine). Their `lock.js` solves the leak from the other end —
  `acquire()` registers `ns.atExit(() => release(ns), 'ui-lock')` itself — which
  is compatible with what I did but overlaps it. Two things for whoever lands
  these:
  - `ns.atExit` keys callbacks by id (`NetscriptFunctions.ts:1395-1398`), and
    their registration uses the id `'ui-lock'` while mine uses the default. Both
    will run; `release()` is ownership-checked, so the second is a no-op. No
    conflict, just redundancy — mine can be dropped from `augbuy.js`/`torbuy.js`
    if their `lock.js` lands, but the `try`/`finally` in `augbuy.js` should stay
    either way since it also publishes telemetry.
  - Their `acquire()` gains a `SKIPPED` symbol return. That is **truthy**, and
    `augbuy.js`/`torbuy.js`/`nfg.js`/`homeup.js` all test it as
    `if (!(await acquire(...)))`. I did not change those call sites. Somebody
    should check that interaction before both land.

- Syntax-checked with
  `node --input-type=module -e "$(sed 's|^import .*||' FILE)"`: `status.js`,
  `tel.js` and `buyserv.js` parse and run to completion silently; `upkeep.js`,
  `torbuy.js` and `augbuy.js` reach `ReferenceError: document is not defined`,
  which means the parse succeeded. `status.js` was additionally exercised under
  plain `node` against a fake `ns` — ok/error/exit bodies, the no-prior-note
  exit, the error tail, and the unserialisable-payload fallback.
