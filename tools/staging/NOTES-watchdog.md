# watchdog.js lifecycle redesign — staging notes

Staged at `tools/staging/watchdog.js`. **Not deployed.** `tools/` is not synced
to the game, which is the point: the live `watchdog.js` is the process that keeps
the run alive, and a root-level save goes live in ~150ms.

---

## The new model

The overloaded `stopWhenFalse` boolean is gone. So is `when`. An entry declares
its lifecycle kind by **the name of its predicate**, and there is nothing else to
set:

| field | kind | predicate false means | on false |
| --- | --- | --- | --- |
| `invariant: (ns) => …` | DAEMON | the running process is now *wrong* | **kill** + do not launch |
| `trigger: (ns) => …` | JOB | the work is done, or not worth starting | do not launch, **never kill** |
| *(neither)* | DAEMON | — | always restart |

Why the predicate name rather than a separate `kind:` field:

- **Terse.** Most of the list is `{ script, host, args }` and stays exactly that.
  A guarded entry costs one token more than before (`when` → `invariant`), not a
  new line.
- **Not wrong by omission.** There is no field to forget. Kind only changes
  behaviour when a predicate exists, and a predicate cannot be written without
  naming its kind. The 2026-09-12 bug class — "the flag defaulted to the wrong
  meaning" — is not expressible.
- **No redundancy to drift.** A `kind:` field alongside a `when:` is two places
  to state one fact, which is how the original overload happened in the first
  place.

`kind: JOB` is still accepted as an explicit override, purely so a hypothetical
one-shot with *no* trigger can get job-style accounting. `checkEntry()` rejects
any combination that disagrees with itself.

### The rule that must not be re-collapsed

```
predicate false  ->  NEVER launch        (both kinds — unconditional on kind)
predicate false  ->  kill if DAEMON      (only the kill is conditional)
```

In the code the `continue` that blocks the launch sits **outside** the kill
branch. That is deliberate: the original bug was that the `continue` lived
*inside* the combined test, so `stopWhenFalse: false` suppressed the launch gate
as a side effect of suppressing the kill. Any future edit that makes the launch
gate depend on `kind` is reintroducing it.

### Legacy keys are a hard error, not ignored

`checkEntry()` refuses any entry carrying `when` or `stopWhenFalse`, prints a
`CONFIG ERROR` to the terminal at startup, and skips that entry.

This is the single most important defensive detail in the rewrite. Renaming a
field usually degrades silently: paste an old entry out of git history and it
arrives with *no recognised guard*, i.e. unguarded — which for `nfg.js` is
precisely the 30-second relaunch storm this work exists to eliminate, with
nothing in any log to say so. Failing loudly is noisy; silently dropping a guard
is expensive.

---

## Every entry, its kind, and why

Behaviour is unchanged for all thirteen. The only deliberate behavioural change
in the whole file is the JOB cooldown (see below), which affects rows 12–13.

| # | script | kind | predicate | why this kind | behaviour vs today |
| --- | --- | --- | --- | --- | --- |
| 1 | `batch.js` | DAEMON | none | `while (true)` hacking controller; must always be resident. Absence = crash. | identical |
| 2 | `cmd.js` | DAEMON | none | `while (true)` terminal bridge; everything headless depends on it. | identical |
| 3 | `ctauto.js` | DAEMON | none | `while (true)` contract sweep on an interval. Never exits. | identical |
| 4 | `tel.js` | DAEMON | none | `while (true)` telemetry writer. Never exits. | identical |
| 5 | `upkeep.js` | DAEMON | none | `while (true)` focus reclaimer. Self-guarding — it is a no-op with no faction work — which is exactly why it needs no predicate. | identical |
| 6 | `backdoor.js` | **DAEMON** | `invariant`: `/tel/backdoor.txt` still lists remaining targets | Not obvious, and worth stating. It is a `while (true)` poller that waits *hours* for the hacking level to rise, not a one-shot. "A story server is still un-backdoored" is a statement about whether this process has any business existing, so killing on false is right. Harmless too: it returns on its own at `done.length === TARGETS.length`, and it drives the cmd.js bridge rather than the UI, so it holds no lock a kill could strand. | identical (`stopWhenFalse` was unset → killed) |
| 7 | `torbuy.js` | **DAEMON** | `invariant`: `!ns.hasTorRouter()` | Same shape as backdoor: a `while (true)` poller that sits waiting for money for as long as it takes. "We do not own TOR" is the condition under which the process is legitimate, not a "there is work to start" trigger — once TOR is bought, a surviving torbuy can only hold the screen. | identical (was killed) |
| 8 | `go.js` | DAEMON | none | Plays games forever (`games: -1`). Never exits. | identical |
| 9 | `share.js` | **DAEMON** | `invariant`: at least one faction joined | The canonical invariant and the reason the kind exists. `ns.share()` multiplies *faction work* rep, so with no faction joined it is a literal no-op — 2040 threads × 4GB = 8.16TB held for hours after an install dropped every faction. Declining to restart is not enough; the RAM was already committed and had to be reclaimed. | identical |
| 10 | `buyserv.js` | DAEMON | none | `while (true)` fleet buyer; derives its own reserve each tick. | identical |
| 11 | `autobuy.js` | DAEMON | none | `while (true)` program buyer with its own in-flight tracking. | identical |
| 12 | `nfg.js` | **JOB** | `trigger`: money ≥ last reported `nextCost` | One-shot. Takes the UI lock, buys up to `--max` NeuroFlux levels, writes telemetry, exits. **Spending the money is the job**, so the trigger going false is success. This is the entry that was killed mid-purchase: it never reached its final write, so it read as idle for hours while actually buying nine levels and 19.4M reputation. | identical, **plus** the 5-minute floor |
| 13 | `homeup.js` | **JOB** | `trigger`: `nextHomeUpgrade(...)` is affordable with reserve | One-shot. Takes the UI lock, walks to Alpha Enterprises, buys home RAM/cores, exits. Same shape as nfg: doing the work is what falsifies the trigger. | identical, **plus** the 5-minute floor |

Counts: **11 DAEMON, 2 JOB.** Three DAEMONs carry an invariant (rows 6, 7, 9);
the other eight have no predicate at all and are the terse
`{ script, host, args }` case. Both JOBs carry a trigger.

---

## The JOB minimum interval

`JOB_MIN_INTERVAL = 300000` (5 minutes), applied to JOBs only, measured from
last launch, per script.

### Justified from the observed failures, not chosen

The failure pattern is **trigger true, work impossible, retry in 30s forever**,
and it is structural rather than incidental: *a JOB's trigger is computed from
telemetry the JOB itself writes, so a job that cannot finish cannot teach its own
trigger anything.* Only a clock breaks that loop. Both JOBs can enter it:

- **nfg.js** gates on `nextCost` out of `/tel/nfg.txt`. A run that cannot take
  the UI lock (`note('error', 'could not take the UI lock'); return`) or dies
  before its final write leaves `nextCost` stale or absent, and the gate falls
  through to the flat `money > 1e12`. That constant is permanently true once
  income is large — the recorded cost was **82 relaunches in half an hour**,
  each taking the global lock to rediscover the same shortfall.
- **homeup.js** gates on exact arithmetic (`nextHomeUpgrade`), so its trigger
  cannot go stale — but `could not reach Alpha Enterprises (in Sector-12?)` is a
  real exit path in that script and it spends no money, so the trigger stays
  true and the next tick tries again 30s later. Same loop, different cause. The
  corrected launch gate does not help here; only the clock does.

### Why 300000 specifically

Taken from `lock.js:40` (`STALE_MS = 300000`), this repo's existing answer to
"how long may a legitimate UI sequence hold the screen". Reusing it makes the
cadence mean something precise rather than being a round number:

> **A JOB may not be relaunched until the previous attempt would already have
> been declared dead and had its lock stolen.**

Consequences: at most one retry can ever be in flight; the 82-per-30-minutes
storm becomes at most 6; two UI jobs can no longer stack behind each other's
lock (`acquire`'s default wait is 180s, well inside the window).

The cost when the work is real is nil. nfg buys everything it can afford in a
single run (nine levels in the run that was being killed), and home upgrade
prices rise 1.58× per doubling — at no point in a run does a home upgrade become
affordable and then un-affordable inside five minutes.

### What it is not

It only **delays a launch**. It does not modify the trigger, never kills, and
**never applies to a DAEMON** — a crashed daemon still comes back on the very
next 30s tick, which is the entire reason this script exists. Per-entry override
via `minIntervalMs` is supported but unused.

The clock is **restored from `/tel/watchdog.txt` at startup**. Without that,
`kill watchdog.js; run watchdog.js` — which the gameplay log shows happening
repeatedly around contract cycles — would silently disarm the rate limit.

---

## Telemetry

`/tel/watchdog.txt` gains a per-kind split. The flat `restarts` map is kept (the
gameplay log quotes `restarts: {}` as the all-healthy signal) but is now derived.

```jsonc
{
  "at": "...",
  "since": "...",              // this watchdog process started here — a count with no window is not a rate
  "jobMinIntervalMs": 300000,
  "daemons": {                 // nonzero count here is a QUESTION: what is killing it?
    "batch.js":  { "kind": "daemon", "count": 0, "lastLaunch": null, "state": "running",              "lastError": null },
    "share.js":  { "kind": "daemon", "count": 2, "lastLaunch": "...", "state": "stopped: invariant false", "lastError": null }
  },
  "jobs": {                    // nonzero count here is WORK GETTING DONE
    "nfg.js":    { "kind": "job",    "count": 9, "lastLaunch": "...", "state": "cooling down: 214s",  "lastError": null },
    "homeup.js": { "kind": "job",    "count": 3, "lastLaunch": "...", "state": "idle: trigger false", "lastError": null }
  },
  "restarts": { "batch.js": 0, "share.js": 2, "nfg.js": 9, "homeup.js": 3 }
}
```

Three things this fixes:

1. **The ambiguity the brief names.** 23 launches of a JOB is 23 successful
   pieces of work and probably the healthiest line in the file; 23 restarts of a
   DAEMON means something is crashing every few minutes. They were the same
   number in the same map. The terminal line says it too — `run #9` for a job,
   `restart #9` for a daemon.
2. **`state`.** Previously "not running because its guard says no", "not running
   because there is no RAM", and "not running because it just ran" all looked
   identical from outside the game — i.e. like nothing at all. Now they are
   `idle: trigger false` / `blocked: no host with room` / `cooling down: Ns` /
   `stopped: invariant false` / `running` / `error`.
3. **`lastError`.** The per-entry `catch` only did `ns.print`, so a predicate
   throwing every cycle was invisible outside the tail — and it silently means
   *that entry is not being managed at all*.

Note the collection quirk recorded in `docs/gameplay-log.md:277-281`: the daemon
only mirrors `tel/*` from `home`, and the watchdog usually runs on a purchased
server, so read this file by RPC against the host it is actually running on.

---

## Also changed (all behaviour-neutral, all deliberate)

1. **The thread count is computed inside the `try`, and only for an entry about
   to launch.** It was evaluated for every entry on every cycle, *outside* the
   `try` — so a throw inside `shareThreads` would have propagated out of the
   `for`, out of the `while (true)`, and killed the watchdog. The process that
   keeps the run alive had an unguarded call in its hot loop. This also stops a
   full network walk happening every 30s for an entry that is already running or
   whose invariant is false.

2. **One network walk per cycle instead of one per entry.** `scanAll()` was
   called from `running()`, `placeFor()` and `shareThreads()` independently —
   ~13+ BFS walks per tick. Hoisted to one per cycle and passed down. Topology
   only changes when buyserv buys a server, and noticing that 30s later is
   invisible.

3. **The orphaned `homeup.js` comment block was moved to the `homeup.js`
   entry.** In the current file the long "Convert surplus cash into home
   RAM/cores…" comment sits immediately above the **`nfg.js`** entry (old lines
   113–126), separated from `homeup.js` by the entire nfg entry. Anyone reading
   top-down attributes it to nfg. Text unchanged; position fixed.

4. **Comments preserved and extended.** Every explanatory comment in the current
   file is carried over — the `auto.js` silent vanish, `buyserv --reserve 700e6`
   / $197.2m, backdoor's 17 restarts, share's 8.16TB and the 600-vs-2040
   sizing, the $2.07 quadrillion install, nfg's 82 relaunches, homeup's circular
   telemetry gate, the stale-`scp` resurrection of `auto.js`, the
   purchased-server-as-host trap. Added: the full lifecycle model as a header
   block, the anatomy of the `stopWhenFalse` bug with the specific structural
   rule that prevents its return, the justification for `JOB_MIN_INTERVAL`, and
   the DAEMON-vs-JOB reasoning for `backdoor.js` and `torbuy.js` (the two
   non-obvious classifications).

---

## RAM

**Expected delta: 0.00GB. Unchanged at 7.8GB.**

Netscript prices the set of distinct `ns.*` member expressions reachable in the
AST, not the number of call sites or lines. The two sets are byte-identical:

```
disableLog exec getPlayer getScriptRam getServer getServerMaxRam
getServerMoneyAvailable getServerUsedRam hasRootAccess hasTorRouter print ps
read scan scp scriptKill sleep tprint write
```

Verified by extracting every `ns.<member>` from both files and diffing — no
additions, no removals. (`ns.share` appears in both, in comments only, which the
AST walk does not see.)

Nothing new was reached for deliberately: no `ns.getRunningScript`, `ns.self`,
`ns.getHostname`, `ns.format.*`, `ns.ui.*`. The telemetry improvements are built
from `Date`, `JSON` and `Object.keys`, which are free. The import of
`homecost.js` is unchanged and still pure arithmetic.

Not verified against the live `calculateRam` RPC — that means touching port
12526, which is out of scope for this task. Worth a single `calculateRam` call
at deploy time to confirm.

`??=` was avoided (written out longhand) because no root-level script in this
repo uses logical assignment yet, and watchdog.js is not the file to discover a
parser limit on.

---

## Verification performed

- Parses: `node --input-type=module -e "$(cat tools/staging/watchdog.js | sed 's|^import .*||')"` → clean exit.
- Driven against a fake `ns` (17 assertions, all passing) covering: JOB with a
  false trigger is neither launched nor killed; DAEMON with a false invariant is
  killed and not launched; a JOB with a true trigger launches once and is then
  rate-limited; a DAEMON relaunches on the very next tick with no cooldown;
  daemon counters count restarts and the legacy `restarts` map still populates;
  the cooldown survives a watchdog restart via telemetry; `torbuy` is killed once
  TOR is owned; `backdoor` is killed when nothing remains; `share.js` is placed
  off-home with a computed thread count.

---

## Deliberately left alone

- **`INTERVAL = 30000`.** The daemon cadence is correct and the JOB problem is
  now solved at the JOB layer, where it belongs.
- **Every predicate body.** Byte-for-byte as-is, including nfg's `money > 1e12`
  fallback. It is a known-bad constant, but changing it is a separate decision
  with its own evidence, and the cooldown now bounds its damage.
- **All hosts, args and thread policy.** `share.js` sizing, the `--reserve`
  values, `host: 'home'` everywhere.
- **`torbuy.js` classification**, despite the tension noted below.
- **The `!target` → `continue` ordering** relative to the running-check. For
  `host: 'home'` the target is always truthy, and for `share.js` the outcome is
  identical either way, so the original order is kept to keep the diff honest.

---

## Still wrong in watchdog.js, and NOT fixed

1. **A DAEMON kill can strand the global UI lock.** `torbuy.js` takes
   `/tel/ui-lock.txt`, and there is a narrow window between TOR being purchased
   (the invariant going false) and its `release(ns)` a few hundred ms later. A
   watchdog tick landing in that window kills it holding the lock. `lock.js`'s
   300s TTL eventually steals it, but that is up to five minutes of every other
   UI script standing down. Correct fix: refuse to kill anything while it holds
   the lock, or make the kill lock-aware. Not done — it changes behaviour, and
   the brief was to preserve it.

2. **Nothing detects a *thrashing* daemon.** A daemon that crashes on startup is
   relaunched every 30s forever. The new telemetry makes it *visible* (count
   climbing against `since`), but the watchdog itself will not back off, and
   `batch.js` failing to start is a far more expensive loop than nfg's was.
   DAEMONs deliberately have no cooldown; what they want instead is exponential
   backoff *after N restarts in M minutes*, which is a different mechanism and
   needs its own evidence.

3. **`running()` matches on filename only, ignoring args.** A `batch.js`
   restarted by hand with different flags counts as "running", so the watchdog
   will never correct it back to the args in this list. Given the
   `buyserv --reserve 700e6` incident, an args mismatch is arguably a fault
   worth reporting — at minimum it should be surfaced in telemetry.

4. **The predicates are the only thing that knows what a script *does*, and they
   live here rather than with the script.** `backdoor.js` and `nfg.js` publish
   telemetry specifically for this file to read; `homeup.js`'s gate is
   re-derived here from `homecost.js` because reading homeup's own telemetry is
   circular. That is the right call each time, but it means the watchdog and
   three scripts have a contract that nothing checks. A predicate that silently
   starts throwing (a renamed telemetry key, say) falls into the `catch` and the
   entry stops being managed — now at least visible via `lastError`, but not
   actionable automatically.

5. **A JOB that exits *immediately* on every run is indistinguishable from one
   doing work.** The launch count goes up either way. Bounding the damage needed
   run *duration*, which would need `ns.getRunningScript` (a new ns reference,
   i.e. real RAM) or a convention that jobs report an outcome. The cooldown caps
   the cost at 12 wasted runs/hour, which was judged good enough for now.

6. **Only one watchdog is assumed.** Two watchdogs on different hosts each keep
   their own `lastLaunch`, and they would each write `/tel/watchdog.txt` on their
   own server, so neither rate limit would see the other's launches. The
   gameplay log shows the watchdog being killed and restarted by hand often
   enough that a brief overlap is plausible. No interlock exists, before or
   after this change.
