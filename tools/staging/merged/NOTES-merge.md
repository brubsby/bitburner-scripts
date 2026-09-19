# Merged deployable set — `tools/staging/c1/` + `tools/staging/gates/` + current repo root

**Nothing here is live.** `tools/` is not pushed to the game (`SKIP_DIRS` in
`tools/rfa-daemon.mjs`). Deploy order is at the bottom and is not optional —
two of these files are brand-new modules that their importers cannot compile
without.

The point of the merge: **SF3, C4 and C1 pass simultaneously**, which none of
the three inputs achieves alone. Measured with the real `npm test` against a
shadow repo, before/after table below.

---

## 1. What is in here, and where each line came from

| file | base | merged in | net |
| --- | --- | --- | --- |
| `autobuy.js` | gates | c1's reporter/atExit/catch | byte-different from both |
| `backdoor.js` | c1 | gates' `STORY_SERVERS` import | byte-different from both |
| `nfg.js` | c1 | gates' `nextCost` comment | byte-different from both |
| `watchdog.js` | c1 | gates' 5 hunks + 2 fixes of mine | byte-different from both |
| `batch.js` `ctauto.js` `go.js` `homeup.js` `settings.js` `share.js` | c1 | — | identical to `c1/` |
| `sfgate.js` `autobuy-sing.js` `storyservers.js` | gates | — | identical to `gates/` |
| `status.js` | root | — | **identical to the deployed root file**; carried here only so the set is self-contained. No push needed. |

`.variants/` and `tools/staging/boot/` were not read for content and not
touched. See §6 for what the boot agent will have to reconcile.

### Root fixes that had to survive, and did

- **`go.js`'s `sf14`.** `c1/go.js` was re-staged *after* the root fix: it
  already carries `const reset = ns.getResetInfo()` / `const sf14 =
  sfLevel(reset, 14)` and the `sfgate.js` import as unchanged context; its only
  edit in that region is the comment. Diffed against the **current** root, not
  against the older one, and the fix is present verbatim.
- **`augbuy.js`'s C7 bridge wait.** Neither staged set touches `augbuy.js`, so
  it is not in this directory. Do not copy anything over it.
- `root/sfgate.js` (07:38) is **older** than `gates/sfgate.js` (08:44) and is a
  strict subset of it — every export it has is still exported, unchanged in
  meaning, plus eleven new ones. Nothing was lost by taking the gates version.

---

## 2. Per-file merge, and the conflicts adjudicated

### `autobuy.js` — base gates, c1 layered on

The two sets edit the same `ns.write` and the same `catch`, so this is the only
literal textual conflict in the set.

- Took gates wholesale for structure: the `canUseSingularity` probe, the
  `autobuy-sing.js` exec, the two shopping lists, the `inFlight` entry for TOR,
  the exec-returns-0 fallback to the terminal.
- Took c1's `reporter`/`errors`/`ns.atExit('status')` block and its `catch`
  body verbatim.
- **The conflicting status write:** kept gates' *payload* (it gained `route` and
  `torRequested`, which are the only external evidence of which of the two
  routes is live) and c1's *mechanism* (`note('ok', …)` so `health`, the rolling
  `errors` tail and the `recent` thunk ride along, and so the `atExit` path can
  republish it). Field names from both survive; nothing was renamed.

**Adjudicated: gates was right that the old gate was not a gate.** `try { const
sing = ns.singularity } catch` catches an exception that can never fire, because
`Script/RamCalculations.ts:407` bills the identifier before a line executes. The
measured price of the old file outside BN4 at SF4.1 was **65.85GB** on a script
in `boot.js`'s STACK and `watchdog.js`'s WATCHED — it would have been
permanently unlaunchable and would have logged "no host with room" every 30s
forever. The split takes it to **4.15GB in every regime**.

One gates change that looks like a behaviour change and is not: `queue(ns, tor ?
wanted : ['connect darkweb', ...wanted, 'home'])` became `queue(ns, wanted)`.
`wanted` is only ever populated inside `if (tor)` (and, in the exec-fallback,
only for `item !== TOR_ITEM`), so the `!tor` arm of that ternary was unreachable
dead code in the original. Verified in the merged file, not assumed.

### `backdoor.js` — base c1, gates layered on

Disjoint except for the `remaining:` expression, which both sides touch.

- `const TARGETS = [...]` → `import { STORY_SERVERS } from 'storyservers.js'`,
  and the three use sites (`for (… of …)`, `.filter`, `done.length === …`).
- Everything c1 added is kept: `errors`, `hackingLevel`, `settled`, the
  `reporter` thunk, the `atExit('status')`, the settled-before-publish ordering
  on the two terminal returns, the catch.

**One comment I rewrote rather than carried.** c1's comment above the reporter
thunk said `done`/`remaining` must ride on every write *because watchdog.js's
invariant parses `remaining` out of this file*. After the gates change that is
no longer true and repeating it would point the next reader straight back at the
circular gate. The fields are kept (a human reads them, and `note.exit` should
not publish a body that silently drops them), and the comment now says so and
says explicitly not to re-point a predicate at them.

### `nfg.js` — base c1, gates layered on

Both sides rewrote the comment above `let nextCost = null`; nothing else
overlaps.

- Took gates' replacement comment verbatim (`nextCost` is now for a human; the
  watchdog must not gate on it again).
- **Rewrote c1's `atExit` justification paragraph.** It argued that publishing
  `nextCost` on the kill path matters *because the watchdog's trigger reads it
  and degrades to `money > 1e12` without it* — an argument for a mechanism gates
  deleted. The `atExit` itself is kept unchanged and is still clearly worth
  having (a kill between `donate` and the augmentation click spends the money
  and buys nothing, and from outside that was indistinguishable from a run that
  found nothing to do); the comment now gives that reason instead of the dead
  one.
- `say()` keeps c1's exact `(result, detail)` signature, so every call site is
  unmoved.

### `watchdog.js` — base c1, gates layered on

The largest file and, structurally, the easiest: c1 rewrote `main()`'s loop and
added a helper; gates rewrote header prose and two WATCHED entries. They collide
nowhere.

From **c1**, kept whole: the `reporter` with the base thunk producing the exact
existing telemetry body (`since`, `jobMinIntervalMs`, `daemons`, `jobs`, derived
`restarts`) plus `cycles`/`errors`; the `atExit('status')`; the move of
`scanAll` + the entry loop + the telemetry write *inside* a `try` (a throw there
killed the one process that notices deaths); `health: 'degraded'` when any entry
is in `state: 'error'`; and `modulesOf()` so `ns.scp` carries a script's imports.

From **gates**, kept whole: the `storyservers.js` import; the rewritten
`JOB_MIN_INTERVAL` header paragraph for nfg; `const NFG_RESERVE = 5e11` shared
between the entry's `--reserve` arg and its trigger; the backdoor invariant
rewritten to `STORY_SERVERS.some(([h]) => !ns.serverExists(h) ||
!ns.getServer(h).backdoorInstalled)`; the nfg trigger rewritten to
`ns.getServerMoneyAvailable('home') > NFG_RESERVE`; all the accompanying
comments.

Two things I changed on top of both, both minimal:

1. **Indentation.** `c1/watchdog.js` left the three `ns.scp`-with-imports lines
   at the pre-`try` indent inside the new `try` block. Whitespace only.
2. **A wrong number in a gates comment.** It claimed "the only new cost here is
   `serverExists` at 0.05GB". Measured with the game's own calculator it is
   **0.10GB** (`watchdog.js` 7.80 → 7.90GB, and the entry list diff is exactly
   `+serverExists=0.1`, nothing else). Corrected in place and labelled as a
   correction, because a RAM figure in a comment is the kind of thing the next
   person copies.

I also added `storyservers.js` to `modulesOf()`'s list of "modules that import
nothing" — that list is the stated reason the helper only has to recurse one
level, and `backdoor.js` now pulls in a module that was not on it.

---

## 3. Where I think an author got it wrong

1. **gates, `watchdog.js` comment: `serverExists` is 0.10GB, not 0.05GB.**
   Fixed above. The *conclusion* (worth paying) is unaffected.

2. **c1, `nfg.js` and `backdoor.js`: two comments justified themselves by a
   watchdog mechanism gates removes.** Not a code defect — but a comment that
   tells the next reader "the watchdog gates on this field" is precisely how a
   circular gate gets re-introduced by someone being helpful. Rewritten, code
   untouched.

3. **gates, `autobuy-sing.js`: the "TOR first" comment does not match the
   code.** It says "TOR first if it was asked for: every `purchaseProgram` needs
   the darkweb", but the loop simply iterates `ns.args` in order. It is correct
   *today* only because `autobuy.js` happens to push `TOR_ITEM` before the
   program names (the TOR block runs before the program block). Left as-is —
   fixing it is a behaviour change in a file neither set asked me to redesign —
   but it is a latent ordering dependency between two files with nothing
   asserting it.

4. **gates, `autobuy.js`: the no-SF4 TOR warning is now inside the `inFlight`
   retry window.** Harmless (`warnedTor` already made it once-only) but it means
   the warning can now be delayed up to `RETRY_MS` past the moment TOR first
   becomes affordable. Left as-is.

5. **c1's own note already flags it and I agree: `augbuy.js:108` still spends
   10GB on a loop variable named `attempt`.** Out of this task's file list;
   `[B1]` reports it every run.

6. **Neither set fixed `boot.js`'s `scp`.** `watchdog.js` now copies a script's
   imports (`modulesOf`); `boot.js:211` (live) and `tools/staging/boot/boot.js:437`
   (staged) still do `ns.scp(script, host, 'home')` for the script alone. Any
   script `boot.js` places off-home that imports `status.js` will fail to
   compile there. Today that is `share.js` and, depending on placement,
   `batch.js`. This is the single most likely way this deploy bites, and it is
   in a file I was told not to touch. **Flagged for the boot agent.**

---

## 4. Verification — real `npm test`, shadow repo

Method, same as the previous two agents: `tar`-copied the repo (minus
`node_modules`, `.git`) to `scratchpad/shadow/bitburner-scripts`, symlinked
`node_modules`, and put a `bitburner` symlink alongside it so
`build-ram.mjs`'s `GAME = REPO/../bitburner` resolves. `shadow/` is the frozen
BEFORE; `shadow2/` is the same snapshot with these 14 files copied over the
root. Both run the real `node tools/test/run.mjs`. Nothing was written to the
repo root and the daemon was never written to.

A frozen snapshot is the baseline rather than a live `npm test` on purpose:
`tools/staging/boot/` is being edited by another agent and `[B7]` flipped
FAIL→WARN between two consecutive runs while I was measuring.

| check | before | after | note |
| --- | --- | --- | --- |
| **C1** every managed script publishes on return/error/throw/kill | **FAIL** (10 failures; 10 of 15 scripts `MISSING`) | **PASS** | all 15 now `status.js=y atExit=y catch-publishes=y` |
| **C4** no circular gate | **FAIL** (2: backdoor, nfg) | **PASS** | 20 `/tel/` files, 20 with exactly one writer, no predicate reads its own gatee |
| **SF3** every SF-gated API routed through `sfgate.js` | **FAIL** (6) | **WARN** | 5 failures were missing `sfgate.js` exports, 1 was ungated `ns.singularity` in `autobuy.js`. Residual WARNs are all dormant scripts no boot path runs (`bladeburner.js`, `crime.js`, `sleeve.js`, …) — unchanged, and out of scope |
| **C3** watchdog predicate semantics | PASS | PASS | 13 entries, 11 daemon / 2 job; `continue` still outside the kill branch |
| **B1** identifier/ns-name collisions | WARN (9 across 68) | WARN (9 across 70) | **no new collision** from any merged file or either new module |
| **B5** batch plans placeable | PASS | PASS | untouched |
| **SF1/SF2** | PASS | PASS | SF1 examined 24 → 48 (the widened `sfgate.js`) |
| **B2** RAM budget by stage | **FAIL** ×7 | **FAIL** ×7 | composition changed — see below |
| **D4** deployed == on disk | PASS | **FAIL** ×13 | **shadow artifact**, see below |
| everything else (A1–A15, C2, C5, C6, C7, D1–D3, B7) | unchanged | unchanged | |
| **totals** | 25 FAIL, 48 WARN | **20 FAIL, 42 WARN** | |

### The two remaining FAILs, and which are real

**`[D4]` is an artifact of the method and not a finding.** It compares disk
against the *live game*, and the live game is running the root files, so all 14
merged files legitimately differ. It reports them itself as "13 of them changed
on disk in the last 2 minutes — likely an edit still in flight". It passed in the
BEFORE shadow, which is the control that says the method is sound. Expect it to
pass again once these are deployed and `curl localhost:12526/sync` has run.

**`[B2]` is 7 failures before and 7 after, but one real failure was removed and
one artifact added.**

- **Removed (real):** `B2.5 autobuy.js is in the boot/watchdog stack and fits at
  8GB only in some Source-File regimes — 5.85GB at best, 65.85GB at worst`. Gone.
  `autobuy.js` is now 4.15GB in every regime and is no longer SF4-variable at
  all. This is the single most valuable line in the whole merge.
- **Added (artifact):** `offline RAM calculator disagrees with the running game
  — watchdog.js: offline 7.9 vs live 7.8 (1.28%)`. That is the calibration
  probe comparing the merged `watchdog.js` against the one running in the game.
  It is the `+0.10GB` of `ns.serverExists`, correctly measured, and it will
  disappear the moment the file is deployed. Max error on the other nine
  calibration scripts is 0.00%.
- **Unchanged (real, pre-existing, not mine):** the six 8GB/32GB failures —
  `boot.js`'s flat 82.60GB home-pinned stack does not fit at 8GB or 32GB, no
  earning configuration fits at 8GB. These are `boot.js`'s, they are what
  `tools/staging/boot/` exists to fix, and `[B7]` tracks that design. This merge
  neither helps nor hurts them (the stack total moved 82.60 → 82.70GB, the
  `serverExists` 0.10).

---

## 5. RAM, three regimes, the game's own calculator

`tools/test/ram.mjs` (bundles the game's `Script/RamCalculations.ts`), priced in
the BEFORE and AFTER shadow repos. Regimes: inside BN4; BN1 with no Source-Files;
BN1 with SF4.1 (the ×16 singularity ladder, `RamCostGenerator.ts:82-96`).

| file | BN4 before → after | BN1 no SF before → after | BN1 SF4.1 before → after |
| --- | --- | --- | --- |
| `autobuy.js` | 5.85 → **4.15** | 65.85 → **4.15** | 65.85 → **4.15** |
| `autobuy-sing.js` | — → 6.60 | — → 66.60 | — → 66.60 |
| `backdoor.js` | 4.60 → 4.60 | 4.60 → 4.60 | 4.60 → 4.60 |
| `batch.js` | 8.80 → 8.80 | 8.80 → 8.80 | 8.80 → 8.80 |
| `ctauto.js` | 22.00 → 22.00 | 22.00 → 22.00 | 22.00 → 22.00 |
| `go.js` | 20.30 → 20.30 | 20.30 → 20.30 | 20.30 → 20.30 |
| `homeup.js` | 4.45 → 4.45 | 4.45 → 4.45 | 4.45 → 4.45 |
| `nfg.js` | 2.40 → 2.40 | 2.40 → 2.40 | 2.40 → 2.40 |
| `settings.js` | 2.30 → 2.30 | 2.30 → 2.30 | 2.30 → 2.30 |
| `sfgate.js` | 1.60 → 1.60 | 1.60 → 1.60 | 1.60 → 1.60 |
| `share.js` | 4.00 → 4.00 | 4.00 → 4.00 | 4.00 → 4.00 |
| `status.js` | 1.60 → 1.60 | 1.60 → 1.60 | 1.60 → 1.60 |
| `storyservers.js` | — → 1.60 | — → 1.60 | — → 1.60 |
| **`watchdog.js`** | 7.80 → **7.90** | 7.80 → **7.90** | 7.80 → **7.90** |

(1.60GB is the empty-script base for a pure module. `sfgate.js`, `status.js` and
`storyservers.js` contribute **0GB to an importer** — none of them references a
priced ns name; the 1.60 is only what they would cost if you typed `run` on
them.)

### Increases, flagged

**`watchdog.js` +0.10GB, 7.80 → 7.90GB.** The entry-set diff is exactly
`+serverExists=0.1` and nothing else. Priced the two staged files separately to
attribute it: `gates/watchdog.js` alone is 7.90, `c1/watchdog.js` alone is 7.80
— so **all of it is gates' de-circularised backdoor invariant, and c1's
`modulesOf()` is genuinely free** (`ns.read` is 0GB and was already referenced by
`restoreLaunchClock`). Worth it: it buys the removal of an invariant that could
kill `backdoor.js` for an entire life across a prestige, and it is a
single-threaded resident so there is no thread multiplier.

**`autobuy-sing.js` is new, at 6.60 / 66.60 / 66.60GB.** This is not a regression
— it is the same Singularity surface, relocated. It is not in `boot.js`'s STACK
or `watchdog.js`'s WATCHED, it is exec'd for a few seconds at a time, and it is
exec'd *only* when `canUseSingularity` is true. The 66.60GB column is a price
that is never paid: in a save with no SF4 the gate is false and nothing execs it.
`autobuy.js` itself, which *is* a permanent resident, dropped **61.70GB** in both
BN1 columns. `[B2]` confirms `autobuy-sing.js` is now merely listed among the
SF4-variable scripts rather than being a stack member that cannot fit.

**Everything else: 0.00GB, in all three regimes.** Both staging notes predicted
zero for the C1 conversion; measured, they were right — `status.js` references
only `ns.write` (0GB) and `ns.atExit` is 0GB.

---

## 6. `watchdog.js`'s WATCHED vs the staged boot tiering — for the boot agent

Not merged, per instructions; `tools/staging/boot/` is being edited live. What
will need reconciling:

- **WATCHED is a flat list; the staged `stack.js` is tiered and budgeted.** All
  13 WATCHED entries are wanted unconditionally at any home size. At an 8GB or
  32GB entry the watchdog will therefore try to (re)start `ctauto.js` (22.00GB),
  `go.js` (20.30GB) and `batch.js` (8.80GB) every 30s and record `blocked: no
  host with room` — for exactly the entries `boot.js` deliberately *deferred*.
  It is not harmful (no kill, no exec) and it is now at least visible in
  `/tel/watchdog.txt` rather than invisible, but "deferred by plan" and "blocked
  by accident" are the same string. The clean fix is for WATCHED to consult the
  same `stack.js` plan; that is a boot-stack decision, not a merge decision.
- **Four scripts in the staged manifest are not in WATCHED at all**: `hgw.js`,
  `early.js`, `seed.js`, `bootnag.js`. If they die, nothing revives them.
  `hgw.js`/`early.js` are the 8GB-tier earners, i.e. the only income at that
  tier.
- **Two earners overlap.** The staged manifest can admit `early.js`/`hgw.js`
  while WATCHED unconditionally restarts `batch.js`. The existing
  "do not add `auto.js` back alongside `batch.js`" comment in WATCHED is the
  same hazard, already written down.
- **`boot.js`'s `scp` does not copy imports** (§3.6). `watchdog.js` now does.
  Whichever of the two launches `share.js` off-home first decides whether
  `status.js` is there.
- `NFG_RESERVE` (5e11) now lives in `watchdog.js` and is shared between the nfg
  entry's `--reserve` arg and its trigger. If the boot stack ever launches
  `nfg.js` itself it must use the same number or the two will disagree about
  when there is work.

---

## 7. DEPLOY ORDER

Every root `.js` hot-deploys in ~150ms, and a script that imports a module the
game has not seen **fails to compile** — it does not degrade. So modules first.

**Phase 0 — modules that do not exist in the game yet.** Land these and confirm
before anything imports them.

1. `storyservers.js` → root *(new; imported by `backdoor.js` and `watchdog.js`)*
2. `autobuy-sing.js` → root *(new; `exec`'d by `autobuy.js`; itself imports
   `sfgate.js`, which is already deployed)*

**Phase 1 — the updated shared module.**

3. `sfgate.js` → root *(strict superset of the deployed one: eleven new exports,
   no export removed or changed in meaning. `go.js` imports `sfLevel` /
   `canUseGoCheat` from it and both still exist, so this is safe to land before
   its importers and safe to land while they are running.)*

`status.js` needs **no push** — the copy in this directory is byte-identical to
the deployed root file. Confirm it is present on home before phase 2 anyway;
nine of these files import it.

**Phase 2 — verify before going further.** The auto-push has silently dropped
edits (CLAUDE.md; two consecutive edits never reached the game on 2026-09-12).

```bash
npm run verify:home          # exit 1 if anything differs
curl -s localhost:12526/sync # only if verify reports drift
```

**Phase 3 — the leaf scripts.** Order among these does not matter; none imports
another.

4. `share.js`, `ctauto.js`, `go.js`, `batch.js`, `settings.js`, `homeup.js`,
   `nfg.js`, `backdoor.js`, `autobuy.js`

**Phase 4 — `watchdog.js` last**, then `npm run verify`.

**Phase 5 — restart, and restart the watchdog FIRST.** Editing a file does not
restart it; a running script keeps its old code.

- The **old** watchdog `scp`s a script *alone*. The **new** one copies its
  imports. `share.js` runs off-home and now imports `status.js`, so if you
  restart `share.js` while the old watchdog is still resident, it will be placed
  on a rooted server without `status.js` and will not compile — and the symptom
  is a daemon that is silently not there, which is the exact failure this change
  exists to remove.
- The watchdog does not restart itself and nothing else restarts it. Kill it and
  `run watchdog.js` by hand (via the `cmd.js` bridge — game-player owns that
  queue), then let it revive everything else at its own 30s cadence.
- Expect `backdoor.js` to be **killed once** shortly after the new watchdog
  comes up if every story server is already backdoored. That is the new
  invariant reading game state and is correct.
- Expect `nfg.js` to be launchable again as soon as money exceeds `5e11`, capped
  at one launch per 5 minutes by `JOB_MIN_INTERVAL`.

**Do not copy `augbuy.js`, `boot.js`, `lock.js`, `tel.js`, `torbuy.js`,
`upkeep.js` or `buyserv.js` from anywhere.** They are not in this directory and
the root copies are current.

---

## 8. Verification performed on the files themselves

- Every file parses:
  `node --input-type=module -e "$(sed 's|^import .*||' FILE)"` — `autobuy.js`,
  `autobuy-sing.js`, `backdoor.js`, `batch.js`, `ctauto.js`, `go.js`,
  `sfgate.js`, `share.js`, `status.js`, `storyservers.js`, `watchdog.js` exit
  clean; `homeup.js`, `nfg.js`, `settings.js` reach `ReferenceError: document is
  not defined`, i.e. parsed.
- Line-level audit both ways for each of the four merged files: every line
  removed relative to `c1/` is a line `gates/` replaced, and every line removed
  relative to `gates/` is a line `c1/` replaced. No third-party deletions.
- RAM priced with the game's own calculator in three regimes, plus a separate
  attribution run pricing `gates/watchdog.js` and `c1/watchdog.js` in isolation
  to locate the +0.10GB.
- Read-only against the daemon throughout: the only contact is `ram.test.mjs`'s
  own `calculateRam` calibration and `verify-deploy.mjs`'s read, both already
  wired into `npm test`. No `pushFile`, no `deleteFile`, no restart, no browser,
  no `/cmd/in.txt`, no `git`.
