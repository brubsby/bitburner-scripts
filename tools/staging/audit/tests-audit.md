# Audit: structurally-blind checks in tools/test/ and docs/invariants.md

Scope: read-only audit. No files touched outside this directory. Standard used:
CLAUDE.md "Failure must be loud" (~line 245-300): a check must be able to say
so through a path that does not depend on the thing that is wrong; an
allow-list/exemption must be provable to fire; "0 examined" must be
distinguishable from "checked and clean."

Legend: CONFIRMED = verified by reading code and/or executing it directly.
SUSPECTED = plausible from reading, not independently executed.

---

## 1. Tests aimed at the wrong source tree

Full read of all 12 files under tools/test/ (11 `*.test.mjs` + support modules
`ram.mjs`, `acd-sources.mjs`, `harness.mjs`, `gameresolve.mjs`, `build-ram.mjs`).
`gameresolve.mjs:31` sets `REPO_ROOT = path.resolve(HERE, '../..')` = repo root,
and its `registerHooks` resolve makes any bare `<name>.js` specifier that
exists at repo root resolve there (`gameresolve.mjs:35-46`). `ram.mjs`'s
`rootScripts()` (`ram.mjs:49-54`) and `acd-sources.mjs`'s `rootScripts()`
(`acd-sources.mjs:53-57`) both filter to root-level `.js` only (no `/` in the
relative path) — this is the read set for nearly every check.

| file | what it reads | staged/compile awareness |
| --- | --- | --- |
| augplan.test.mjs | root `augplan.js`, `installgate.js` (bare specifiers via `gameresolve.mjs`, confirmed at :39-40) | comments at :313, :472 mention `tools/staging/augplan.js` — these are **historical prose** about where a bug used to live, not the import target. CONFIRMED not a live aim bug: the actual `import("augplan.js")` resolves to root. |
| bnconst.test.mjs | root scripts via `ram.mjs` `rootScripts()`/`source()`; game source via `GAME` (bitburner checkout) | — |
| formulas.test.mjs | root `sfgate.js`, `homecost.js` (`:43-44`, relative `../../` from `tools/test/`) + game bundle | — |
| hygiene.test.mjs | whole repo via `acd-sources.mjs` `allFiles()`; live daemon via RPC for D3/D4 | — |
| installgate.test.mjs | root `installgate.js` (`:12`, relative `../../`) | — |
| placement.test.mjs (B5) | root `batch.js`, loaded via `importRootScript()` (:60-66) which rewrites only the *import specifiers* inside the byte-identical source read from `REPO`, plus live `.telemetry/status.txt` | **FIXED**, and the fix is self-documented at :44-58: this file used to do a bare `await import(path)` that "worked by accident" while batch.js had no imports, then silently stopped running (0 checks) the moment batch.js gained one. Current code reads the real file's bytes and only rewrites specifiers to `file:` URLs. CONFIRMED fixed. |
| ramoverride.test.mjs (R1-R5) | **root scripts** (`rootSubjects()`, ram.mjs `rootScripts()`) **and** `tools/staging/ramoverride/*.js` (`STAGING`, :67), both as first-class subjects | R5 (`raiseCovers`) is the check named in the task brief. **CONFIRMED FIXED**: comment at :467-497 documents the exact historical bug (`raiseCovers(staged)` reported PASS while reading a stale draft, root `progress.js` was actually 5GB short and silently denied its raise) and the call site at :277 is `raiseCovers(root.concat(staged))` — both trees, root first. |
| ram.test.mjs (B1, B2) | root scripts via `ram.mjs` | — |
| sfgate.test.mjs (SF1-SF3) | root scripts (`rootScripts()`) + game source (bitburner checkout) for citations | See §2 — the exemption-matching code inside SF3 has an unfixed aim/matching bug, though it does target root scripts. |
| stage.test.mjs (B7) | **either** `tools/staging/boot/*` **or** root, decided by `resolve()` (:86-104): root wins only once `boot.js` itself carries the tiered shape (`rank:` + `planStack`). While staged, it prints a **loud WARN** naming exactly which files are staged and states in the WARN text that "[B2] against the root files is what says whether the game can bootstrap itself today." | CONFIRMED **not blind** — this is the self-aware pattern CLAUDE.md wants: a green B7 cannot be misread as "the game boots today" because the WARN says so every run. Current run: WARN, staged (`tools/staging/boot/` — boot.js, bootnag.js, hgw.js, retire.js, seed.js, stack.js). |
| structure.test.mjs (C1-C4,C6,C7) | root scripts (managed set derived from `boot.js` STACK + `watchdog.js` WATCHED, both read from disk) | Explicitly documents its own blind spots in a header comment (:21-36) — a good pattern, not a bug. |

**Finding 1.1 (CONFIRMED, was the task's seed bug, now FIXED):** `ramoverride.test.mjs` R5 checks root **and** staged scripts together. The task description's premise ("R5 ran raiseCovers(staged)") describes the state **before** the fix documented in the file's own comment; current code is `raiseCovers(root.concat(staged))` at ramoverride.test.mjs:277,499.

**Finding 1.2 (CONFIRMED, was the task's seed bug, now FIXED):** `placement.test.mjs` (B5) no longer does the bare `await import(path)` that silently stopped B5 running when batch.js gained an import; it now rewrites specifiers to `file:` URLs over the real file bytes.

**Finding 1.3 (new, not previously documented as fixed):** No test file under `tools/test/` ever reads `tools/compile/src/**` or `tools/compile/dist/**` (grep confirms zero references). That pipeline has its own internal gate (`tools/compile/build.mjs`'s "refuse to write if more expensive" check) and is explicitly excluded from the daemon's deploy walk, so this is very likely **by design**, not an oversight — flagged as SUSPECTED-benign rather than a defect, since I did not find any claim in CLAUDE.md or invariants.md that `npm test` covers it.

---

## 2. Allow-lists / filters that can never match

### 2.1 CONFIRMED, live, unfixed: `sfgate.test.mjs`'s `gatedCallers` allow-list

`ram.mjs:200-206` `codeOnly(name)` blanks every string/template literal to the
literal two characters `""`:
```
.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
```
`sfgate.test.mjs:262-269` builds the "this script is legitimately exec'd by a
gated caller" allow-list by scanning **that stripped text**:
```js
for (const caller of rootScripts()) {
  if (!importsOf(caller).has("sfgate.js")) continue;
  for (const m of codeOnly(caller).matchAll(/['"]([\w.-]+\.js)['"]/g)) {
    if (!gatedCallers.has(m[1])) gatedCallers.set(m[1], caller);
  }
}
```
Since every string in `codeOnly(caller)` has already been replaced by `""`,
the regex `/['"]([\w.-]+\.js)['"]/g` requires **at least one character**
between the quotes and can never match. Verified directly:
```
codeOnly: exec("", host)
matches on codeOnly: []
matches on raw:      [ "'go-cheat.js'" ]
```
`gatedCallers` is therefore **always empty**, for every run, regardless of
what any script actually does. This is exactly the defect CLAUDE.md already
names ("sfgate.test.mjs's allow-list scans string-stripped source, so it can
never match a filename. go-cheat.js passes only by accident") — but it is
**still present in the code today**, in this specific spot
(`sfgate.test.mjs:266`), not merely a historical note.

Consequence, traced end to end: `go.js` (root) imports `sfgate.js` and calls
`ns.exec('go-cheat.js', 'home', 1, ...)` (go.js:189) — exactly the
caller-gates-callee pattern the allow-list exists to recognize. Because the
allow-list can never populate, `go-cheat.js` is never recognized as exempt.
It currently escapes a FAIL only because of a **second, independent** defect
(2.2 below) that makes the family match for `go.cheat` never fire either —
i.e., go-cheat.js "passes only by accident," confirmed exactly as CLAUDE.md
says, and the accident is a different, still-broken mechanism from the one
the allow-list was supposed to provide.

### 2.2 CONFIRMED, live, unfixed, NOT previously documented: SF3's `go.cheat` family can never match any script's billed entries

`sfgate.test.mjs:48`:
```js
{ id: "go.cheat", sf: 14, ns: /^go\.cheat\./, ... }
```
`sfgate.test.mjs:276`: `const used = entries.filter((e) => f.ns.test(e));`
where `entries` are `ramOf(name).entries` names from the game's own RAM
calculator (`ram.mjs`). Directly queried:
```
ramOf("go-cheat.js").entries names:
  baseCost, cheat.playTwoMoves, cheat.removeRouter,
  cheat.repairOfflineNode, cheat.destroyNode
```
The calculator's flattened entry name for a *nested* namespace call
(`ns.go.cheat.playTwoMoves`) is `cheat.playTwoMoves` — it drops the outer `go.`
segment (RAM entries for `stock.*`, `gang.*`, `hacknet.*` retain their single
leading segment and DO match their family patterns, e.g.
`"stock.purchase4SMarketData"` matches `/^stock\.(...)/` — verified directly).
`f.ns = /^go\.cheat\./` therefore **can never match any real entry name**, for
any script, because no billed entry is ever spelled with a `go.` prefix. This
family clause in SF3 is dead code, independent of and in addition to the
`gatedCallers` bug in §2.1 — `go-cheat.js` is the only script in the whole
repo that calls `ns.go.cheat.*` (confirmed via C5's own "callers of the cheat
capability" grep, which lists only go.js/go-cheat.js and staging/compile
copies), so this family clause has **never fired, for any input, since it was
written.**

Net effect: two unrelated bugs both silently disarm the one check meant to
prove go-cheat.js is correctly gated. `npm test`'s SF3 currently reports WARN
for gang.js/hash.js/stock.js (3 real, correctly-detected gaps) and says
**nothing at all** about go-cheat.js — not PASS, not WARN, not FAIL. It is
invisible to the check, which is a stronger silent-failure shape than "passes
by accident": there is no line in the output naming go-cheat.js at all.

---

## 3. Tautological / vacuous assertions

No additional instances of "iterate empty collection and pass" or "regex that
can never match" were found beyond §2, after reading every `*.test.mjs` file
in full. Specific things checked and ruled out:

- `ramoverride.test.mjs` R1/R2 (`honoured()`) explicitly special-cases an empty
  subject set and **prints that it is empty** rather than silently passing
  (`ramoverride.test.mjs:289-299`), and R4 is a first-class negative control
  proving the detector fires on 13 documented bad shapes plus one positive
  control (`:396-465`). This is the correct pattern.
- `ram.test.mjs` B1 (`phantomCheck`) runs a self-test against the two
  historical real collisions (`attempt`, `probe`) before trusting the
  collector (`:145-159`) — correct pattern.
- `structure.test.mjs` C3 and C2 both carry an explicit negative control
  (a synthetic legacy-shaped entry that must be rejected) before trusting the
  parser (`:299-307` for C3; SKIPPED-symbol check for C2 at `:274-282`).
- `bnconst.test.mjs` (C5) reads its "base" values live from the game bundle
  rather than hardcoding them, and separately checks that a `bncheck.mjs`
  registration is still textually true of the file it cites (C5c) — this
  actually fired live in the run: 3 stale registrations flagged
  (`buyserv.js`/`share.js`/`golib.js` no longer contain the literal their
  bncheck entry claims). Real signal, not vacuous.
- All 15 `A*` checks in `formulas.test.mjs` contain at least one `c.fail(...)`
  call reachable from a real comparison against the game bundle (counts: A1:2,
  A2:3, A3:4, A4:5, A5:4, A6:4, A7:3, A8:4, A9:1, A10:2, A11:3, A12:3, A13:3,
  A14:5, A15:2 `c.fail` sites) — none is structurally incapable of failing.
  A9 has only one `c.fail` site; not independently deep-dived beyond
  confirming it exists and is reachable (SUSPECTED-fine, not exhaustively
  verified).

---

## 4. docs/invariants.md — every entry vs. what actually checks it

Note: the task brief says "30" invariants; the file as it stands has **32**
(A1-A15 = 15, B1-B6 = 6, C1-C7 = 7, D1-D4 = 4). Minor factual correction, not
a finding about the suite.

"Can fail" = a `c.fail(...)` call is reachable in the checking code from a
real comparison (not merely reachable in principle). Where I have a stronger
basis (self-test / negative control / live run evidence), it says CONFIRMED;
otherwise SUSPECTED based on code reading.

| # | invariant | asserted by | can it fail? |
|---|---|---|---|
| A1 | repFromDonation 3 factors | `[A1]` formulas.test.mjs | CONFIRMED — live comparison against game bundle; currently WARN (drift found in docs/nfg.js prose, not root code) |
| A2 | favorNeededToDonate floor(150*mult) | `[A2]` | CONFIRMED — PASS this run against game constant |
| A3 | repToFavor/favorToRep | `[A3]` | CONFIRMED |
| A4 | NFG cost formula | `[A4]` | CONFIRMED |
| A5 | Aug cost x1.9 ladder incl. SF11 | `[A5]` | CONFIRMED |
| A6 | homecost.js formulas | `[A6]` | CONFIRMED |
| A7 | getHackingWorkRepGain factors | `[A7]` | CONFIRMED — currently WARN (some factor identity-in-BN1 caveat, matches invariant's own footnote) |
| A8 | w0r1d_d43m0n threshold | `[A8]` | CONFIRMED |
| A9 | Go difficulty multiplier | `[A9]` | SUSPECTED-fine (1 fail site, not deep-dived) |
| A10 | Go winstreak multiplier | `[A10]` | CONFIRMED |
| A11 | Go cheat access rule | `[A11]` (formulas) + `[SF1]` (sfgate.test.mjs, cross-checked against game source text) | CONFIRMED, doubly checked |
| A12 | Home RAM at entry | `[A12]` + exercised structurally by `[B2]`'s `ENTRY_TIERS` | CONFIRMED |
| A13 | Singularity RAM x16/x4/x1 | `[A13]` + `[SF1]`'s differential ladder (executes the actual bundled cost fn) | CONFIRMED |
| A14 | prestigeHomeComputer preserves maxRam/cores | `[A14]` | CONFIRMED |
| A15 | prestigeAugmentation rep->favor->zero order | `[A15]` | CONFIRMED |
| B1 | no identifier collides with priced ns name | `[B1]` ram.test.mjs | CONFIRMED — self-test on `attempt`/`probe` proves detector fires; currently WARN (real hits, none in the "stacked" reachable set) |
| B2 | bootstrap fits every entry-tier home size | `[B2]` ram.test.mjs | CONFIRMED — **currently FAILS**, 6 FAIL entries, see §5 |
| B3 | offline RAM calc reproduces game's calculateRam | calibration inside `[B2]` (`calibrate()` in ram.mjs, RPC to live daemon) | CONFIRMED can fail (`c.fail("offline RAM calculator disagrees...")`); currently PASS at 0.00% error, but this arm only runs when the daemon/game is reachable — if unreachable it degrades to a WARN ("not calibrated"), never silently PASS |
| B4 | SF-gated API isolated in its own script | `[SF3]` sfgate.test.mjs | **PARTIALLY DEAD** — see §2. The mechanism can fail in general (gang.js/hash.js/stock.js are live counterexamples reported as WARN this run) but the one family it is most important for (`go.cheat`, the worked example CLAUDE.md and this repo's own header comments hold up as "the pattern") can **never** be evaluated at all, in either direction, due to two independent bugs (§2.1, §2.2) |
| B5 | plan placeable on a single host, not just fleet total | `[B5]` placement.test.mjs | CONFIRMED — reads shipped `place()`/`planBatch` verbatim out of root batch.js; regression fixture reproduces the exact 2026-09-13 incident |
| B6 | Script RAM is a function of BitNode/SF4 | exercised by `[B2]`'s REGIMES sweep, `[SF1]`'s differential ladder, `[R1]-[R5]`'s REGIMES, `[stage.test.mjs/B7]`'s REGIMES | CONFIRMED (multiple independent live comparisons against the bundled cost function) |
| C1 | every script publishes on every exit path | `[C1]` structure.test.mjs | CONFIRMED — currently PASS for the 18-script managed set; explicitly documents its own blind spots (publish-by-unrecognized-name, atExit-registered-but-empty) rather than hiding them |
| C2 | UI lock released on every path incl. kill | `[C2]` | CONFIRMED — asserts the structural guarantee in lock.js itself (every `return true` preceded by an atExit registration), not merely caller behavior |
| C3 | watchdog: false predicate never launches | `[C3]` | CONFIRMED — has an explicit negative control (:299-307) proving the parser rejects a known-bad legacy shape before trusting the PASS |
| C4 | no circular gate (predicate reads only what it doesn't gate) | `[C4]` | CONFIRMED — currently PASS, 29/29 tel files single-writer |
| C5 | BitNode-multiplier constants registered in bncheck.mjs | `[C5]` bnconst.test.mjs | CONFIRMED — currently WARN, 3 real stale-registration hits found live |
| C6 | sim models state calibration or admit none | `[C6]` structure.test.mjs | CONFIRMED — currently PASS across 15 files; explicitly notes it only checks a calibration line EXISTS, not that it passes (documented limitation, not a hidden one) |
| C7 | cmd bridge callers wait on in.txt OR busy.txt | `[C7]` | CONFIRMED — currently PASS, 4 real callers checked |
| D1 | SKIP_DIRS identical in daemon and verifier (+ CLAUDE.md prose) | `[D1]` hygiene.test.mjs | CONFIRMED — currently WARN (CLAUDE.md's stated list has drifted, live finding) |
| D2 | no NUL/invalid-UTF8 byte in tracked files | `[D2]` | CONFIRMED, scans every byte of every tracked file |
| D3 | nothing under variants/ ever pushed | `[D3]` | CONFIRMED — checks static SKIP_DIRS membership, the watcher's per-segment filter, a live re-walk, AND (when the daemon is reachable) the actual running game's file list; degrades to WARN "UNVERIFIED, not fine" rather than silent pass when the daemon is unreachable |
| D4 | deployed == on disk | `[D4]` (wraps `tools/verify-deploy.mjs`) | CONFIRMED — three-way exit code (ok/problems/could-not-check) is preserved into the Check, not collapsed to a boolean |

---

## 5. `npm test` run — 2026-09-13

Command: `nice -n 19 npm test 2>&1 | tail -120` (full output captured; excerpt
below). Full raw output saved only in this session's scratch, not persisted —
summarized here.

```
bitburner-scripts test suite  11 module(s): augplan.test.mjs, bnconst.test.mjs,
formulas.test.mjs, hygiene.test.mjs, installgate.test.mjs, placement.test.mjs,
ram.test.mjs, ramoverride.test.mjs, sfgate.test.mjs, stage.test.mjs,
structure.test.mjs
...
──── 55 checks, 2245 things examined, 6 FAIL, 18 WARN in 18963ms
     failing checks: B2
```

**Module/check count: CONFIRMED not silently short.** 11 modules ran; none
threw and none was reported as "no exported run()". I independently counted
every `[XX]` check-id header actually printed (55 exactly: AP1-10, C5, A1-15,
D1-4, IG1-7, B5/B2/B1, R1-5, SF1-3, B7, C1-C4/C6/C7 = 55) — matches the
runner's own declared total exactly. **No check silently failed to execute.**

**FAIL count and location: user's claim CONFIRMED, with one nuance.** All 6
FAILs are under `[B2]`, none elsewhere. However they are not exclusively
about the "virgin BitNode, never run at 8GB" case:
- 4 of the 6 are at the **8GB entry tier** (no SF1, no SF9.2) — the case the
  user describes as never having been run.
- **2 of the 6 are at the 32GB entry tier** (SF1 owned — *this save's actual
  history*, not a hypothetical): `B2.4` (home-pinned stack 82.50GB > 32GB) and
  `B2.4b` (steady state 89.50GB > 32GB).

So "known virgin-BitNode bootstrap gap" slightly understates it: the same
untiered/flat-list `boot.js` design also fails to fit a 32GB home, which is
the SF1 tier this save itself entered at. All 6 share one root cause per the
test's own diagnosis: `boot.js`'s `STACK` is a flat list wanted at every home
size (`B2` output: "boot.js's STACK is a FLAT LIST"), and the fix
(`tools/staging/boot/` tiered manifest + `stack.js` planner, checked by
`[B7]`) is staged but not deployed — `[B7]` itself prints a WARN saying so
every run. This matches "known" and "there is a documented, staged fix
in flight," which is the charitable reading of the user's claim.

18 WARNs, spread across C5(3), A1(1), A7(1... folded into A7's own warn), B1,
B7(2, both about staging), C2(2), SF3(3) — all individually legitimate,
non-vacuous findings per §3/§4 (each traced to a real textual/structural
condition, not an artifact of a broken check).
