# A capability-profile compiler — prototype, measurements, and a recommendation against it

**Recommendation up front: do not adopt this.** The game already ships the
feature it was built to provide (`ns.ramOverride`), which delivers most of the
saving for one line per script instead of a build system. The compiler's
measured advantage over that one line is **2.00GB of resident RAM, flat across
every regime tested** — and it introduces a new silent failure mode whose
mitigation is a 2.70GB boot-time check. The prototype works, the numbers are
real, and it still does not pay.

What *is* worth taking from this is in [§8](#8-what-to-do-instead).

Everything below is measured with the game's own `Script/RamCalculations.ts`
via `tools/test/ram.mjs`, which reproduces the live game's `calculateRam` to
**0.00%** — printed on every run of every script here.

```bash
node tools/compile/profile.mjs                    # derive a profile from the LIVE save
node tools/compile/profile.mjs --bitnode 14 --sf 14:1
node tools/compile/build.mjs                      # compile + RAM gate + write dist/
node tools/compile/build.mjs --bitnode 1 --dry-run
node tools/compile/payoff.mjs                     # the four-regime table
node tools/compile/flags.mjs                      # which esbuild flags matter, and which are dangerous
node tools/compile/ramoverride.mjs                # what ns.ramOverride actually does
node tools/compile/gate-selftest.mjs              # prove the RAM gate can actually fail
```

---

## 1. What was built

| file | what it is |
| --- | --- |
| `profile.mjs` | `(bitNode, sourceFiles, homeRam, ownedAugs)` from the live save via `getSaveFile`, read-only; or hand-set with `--bitnode/--sf/--home-ram`. Capability rules are **imported from `sfgate.js`**, never restated. |
| `build.mjs` | esbuild `--bundle`, tree-shaking, **no minify flags**. Capability seams are resolved by module substitution. Prices its own output and refuses to write on any regression. |
| `src/` | `go.js`, `go-cheat.js`, `autobuy.js`, `autobuy-sing.js`, `profilecheck.js`, plus `src/caps/` |
| `src/caps/` | the two implementations of each seam: `go-cheat-{on,off}.js`, `buy-{sing,terminal}.js` |
| `payoff.mjs` | the four-regime table, including the `ramOverride` comparison |
| `flags.mjs` | the esbuild flag sweep and the minifier-hazard demonstration |
| `gate-selftest.mjs` | damages a good build three ways; asserts the gate rejects them and accepts the control |
| `ramoverride.mjs` | 17 probes of `ns.ramOverride`'s real semantics |

Nothing at the repo root or in `.variants/` was created, modified or deleted.
`src/` was derived from the shipped originals by copying, never by moving.

### Module substitution, not branch elimination

The capability difference is not an `if`, it is a different implementation of
the same small interface. Which one gets linked is decided once, at build time,
from the profile:

```
caps/go-cheat.js  ->  src/caps/go-cheat-on.js   |  src/caps/go-cheat-off.js
caps/buy.js       ->  src/caps/buy-sing.js      |  src/caps/buy-terminal.js
```

`src/go.js` contains no build-time constant and no Source-File `if`. It calls
`requestCheat(...)`; in a save that cannot cheat that function is two lines
returning `false` and referencing no ns function at all, so `ns.exec` (1.3GB),
`ns.isRunning` (0.1GB) and the 1GB `ns.getResetInfo()` probe are simply not in
the bundle. Netscript prices identifiers, not reachability
(`RamCalculations.ts:407`) — which is exactly why no runtime gate could ever
have done this.

The cheat *policy* — one per game, only once the position has shape, never a
second — now exists in **one copy** that both builds share. That is the real
maintenance argument for the approach, and it is the only one that survived.

---

## 2. The measured payoff, across four regimes

Script RAM in GB. `—` = the build does not emit the file at all.

| | BN4 (now) | BN1 no SF | BN1 SF4.1 | BN14 SF14.1 |
| --- | ---: | ---: | ---: | ---: |
| **go.js** handwritten | 20.30 | 20.30 | 20.30 | 20.30 |
| **go.js** compiled | **17.80** | **17.80** | **17.80** | **19.30** |
| **go-cheat.js** handwritten | 33.60 | 33.60 | 33.60 | 33.60 |
| **go-cheat.js** compiled | — | — | — | 33.60 |
| **autobuy.js** handwritten | 4.15 | 4.15 | 4.15 | 4.15 |
| **autobuy.js** compiled | **3.15** | **1.85** | **3.15** | **1.85** |
| **autobuy-sing.js** handwritten | 6.60 | 66.60 | 66.60 | 66.60 |
| **autobuy-sing.js** compiled | **5.60** | — | **65.60** | — |
| **profilecheck.js** (new, one-shot) | 2.70 | 2.70 | 2.70 | 2.70 |

**Resident total** — only `go.js + autobuy.js`, the two that stay running. A
one-shot helper's RAM is paid for the seconds it runs, so including it would
inflate the answer in the compiler's favour:

| | BN4 | BN1 no SF | BN1 SF4.1 | BN14 SF14.1 |
| --- | ---: | ---: | ---: | ---: |
| handwritten, as shipped | 24.45 | 24.45 | 24.45 | 24.45 |
| + `ns.ramOverride` (no build step) | 22.95 | 21.65 | 22.95 | 23.15 |
| compiled | 20.95 | 19.65 | 20.95 | 21.15 |
| saved by ramOverride | 1.50 (6%) | 2.80 (11%) | 1.50 (6%) | 1.30 (5%) |
| saved by compiling | 3.50 (14%) | 4.80 (20%) | 3.50 (14%) | 3.30 (13%) |
| **compiler's margin over ramOverride** | **2.00** | **2.00** | **2.00** | **2.00** |

Three things in that table are worth naming explicitly.

**`go-cheat.js` compiles to exactly its handwritten cost, 33.60 → 33.60.** That
is the result to want: the compiler is a no-op on a file that was already in the
right shape. It is also the clearest evidence that the handwritten split was not
the problem.

**"Not emitted" is 0GB saved, and the tool says so on every run.** A
handwritten `go-cheat.js` sitting on disk in a BitNode that cannot cheat costs
nothing, because it is never run. Scoring its absence as "-33.6GB" would be the
fabricated-number failure this repo has shipped twice. What not emitting it
actually buys is that a capability cannot misfire — worth something, worth zero
gigabytes.

**The margin is flat at 2.00GB** because it is exactly the two 1GB
`ns.getResetInfo()` probes that a build can evaluate ahead of time and a
one-line override cannot. Against a home that starts at 8GB (`Prestige.ts:242-248`)
2.00GB is not nothing. Against the 2.70GB one-shot the compiler makes necessary,
and against a build system, it is not much.

---

## 3. What the compiled output actually looks like

Plain `--bundle` with tree-shaking. Real newlines, original identifiers,
statement per line, `const` preserved, longest line 135 characters.

```js
// GENERATED by tools/compile/build.mjs from tools/compile/src/go.js
// profile bn4/sf1.1  home 32GB  (live save)
// DO NOT EDIT. Edit the source and rebuild; this file is overwritten.
import { chooseMove } from "golib.js";

// tools/compile/src/caps/go-cheat-off.js
var cheatAvailable = () => false;
async function requestCheat() {
  return false;
}

// tools/compile/src/go.js
import { reporter, describe, record } from "status.js";
var SETTINGS = {
  opponent: "Daedalus",
  ...
        if (!cheated && ranked && ranked.length >= 2 && guard > 4) {
          cheated = true;
          cheatsTried++;
          if (await requestCheat(ns, SETTINGS.cheat, ranked[0].x, ranked[0].y, ranked[1].x, ranked[1].y)) {
            await ns.sleep(flags.idle);
            continue;
          }
        }
```

Compare what `--minify-syntax` produced on the same source in the first version
of this prototype — `!0` for `true`, `2e5` for `200000`, `for (;;)` for
`while (true)`, and whole `if`/`else` blocks fused into comma sequences:

```js
      (asked === void 0 || now - asked >= RETRY_MS) && (inFlight.set(TOR_ITEM, now), sing.push(TOR_ITEM), wantTor = !0);
```

That is the difference the flag makes, and it is why the shipped build does not
use it. It also buys **0.00GB** (§4).

### Two things that are NOT preserved, and one matters

**Identifiers are renamed on collision, with no minify flag at all.** In
`dist/autobuy.js` the bundler emitted `ROUTE2`, `bridgeBusy2`, `TOR_ADVICE2` and
`buy2`, because `caps/buy-sing.js` re-exports names `caps/buy-terminal.js` also
defines. Harmless here — none collides with a priced ns name — but it is
uncontrolled renaming in a build whose correctness depends on names, which is
why the RAM gate is not optional (§5).

**Comments are destroyed.** This is the significant one:

| | source | deployed |
| --- | ---: | ---: |
| `go.js` comment lines | 201 | 12 |
| `autobuy.js` comment lines | 144 | 12 |

esbuild keeps only comments in a few incidental positions (inside object and
array literals); the rest go, including every `file:line` citation into
`~/Repos/bitburner`. In a repo whose central discipline is "when a number
matters, read it out of the game source and cite the file and line in a
comment", shipping an artifact with 94% of its reasoning removed is a real cost.
Anyone reading the file *in the game* — the script editor, `getFile` over the
RFA, an agent debugging at 3am — sees code with no explanation. There is no
esbuild option that fixes this.

---

## 4. Which esbuild flags actually matter

`node tools/compile/flags.mjs`, priced under BN1 with no Source-Files:

```
  go.js   handwritten 20.30GB
    bundle, no tree-shaking       17.8GB   -2.50    144 lines   13ms
    + tree-shaking  (SHIPPED)     17.8GB   -2.50    146 lines    4ms
    + minify-syntax               17.8GB   -2.50    114 lines    3ms
    + minify-identifiers          17.8GB   -2.50    114 lines    4ms

  autobuy.js   handwritten 4.15GB
    bundle, no tree-shaking        1.85GB  -2.30    120 lines    3ms
    + tree-shaking  (SHIPPED)      1.85GB  -2.30    120 lines    3ms
    + minify-syntax                1.85GB  -2.30     85 lines    3ms
    + minify-identifiers           1.85GB  -2.30     85 lines    3ms
```

**Once the capability seam is a module boundary, plain bundling gets the whole
saving.** Tree-shaking buys 0.00GB and minification buys 0.00GB — they have
nothing left to remove, because the losing implementation was never imported.
Builds are 3–20ms for the whole dist.

This is a correction to the premise the prototype started from. With the
capability expressed as an `if` on a build-time constant, `--minify-syntax` was
load-bearing (tree-shaking alone left 1.10–1.30GB on the table, because esbuild
folds `if (false) f()` in the parser but removes "statements after a return"
in a much later pass — so the losing half of an entry switch survived as a whole
top-level function with every ns identifier still on the bill; **the RAM gate
caught exactly that, at +0.55GB, on the first run**). With the capability
expressed as a module, none of that arises.

### `--minify-identifiers` is a live hazard, measured

It buys nothing above, so there is no reason to use it — but it is worth
recording *why* it must stay off, because "it did not happen on my two files"
is how a latent hazard gets called safe. Forced past its single-character name
pool (5,000 locals in one scope), esbuild 0.28.2 emits:

```
    5,000 locals in one scope -> esbuild emits 3389 names of <=2 characters.
    4 of them are names the RAM checker PRICES: cat=8GB, rm=0.6GB, ls=0.2GB, ps=0.2GB
```

The checker prices every bare Identifier by name, on any object
(`RamCalculations.ts:407`, `findFunc` `:225-243`). So minification can silently
**increase** the RAM of the script it minified — the same class that cost this
repo `attempt` (10GB), `share` (2.4GB), `run` (1GB), `probe` (0.2GB) and `grow`
(0.15GB), except systematic.

---

## 5. Why the RAM gate is mandatory, and what it caught

`build.mjs` prices every output with the game's own calculator under the
profile's regime and **refuses to write anything** on a regression. The check is
**two-sided**:

- never worse than the **handwritten baseline**, priced under the same regime
  (invariant B6: RAM is a function of BitNode and SF4 level, so a gate that
  priced once would be comparing two different questions);
- never worse than the **last build of the same profile** — a ratchet, recorded
  as `costs` in `dist/PROFILE.json` and written only by a build that passed.

It also checks, independently:

- **name collisions** — does anything the output *declares* share a name with
  something the cost tree prices? A regression against the baseline is one way
  to notice a bad identifier, but a name the original *also* carried nets to
  zero and stays invisible.
- **an unresolved `caps/` import** surviving into the output.
- **`main` emitted as a `FunctionDeclaration` literally named `main`** — because
  `ns.ramOverride` is honoured only in that exact shape
  (`RamCalculations.ts:484-487`), and esbuild renames `main` → `main2` on
  collision with no minify flag involved. Nothing here uses `ramOverride` yet;
  the check exists because the interaction is invisible and §7 recommends
  `ramOverride`.

`node tools/compile/gate-selftest.mjs` damages a good build in three specific
ways and asserts the gate rejects exactly those and accepts the control — because
a checker that has never been shown a known-bad input has not been shown to
detect anything, and this repo has shipped two calculators and one allow-list
with that problem.

It has already earned its place three times:

1. **+0.55GB on `autobuy-sing.js`**, from esbuild's pass ordering leaving a dead
   top-level function alive (§4). The build reported success; the gate did not.
2. **A "successful" build for entirely the wrong profile.** `for a in "--bitnode 1"
   ...; node build.mjs $a` — zsh does not word-split unquoted parameters, so the
   flag arrived as one token, `indexOf("--bitnode")` missed, and three
   consecutive builds meant to be BN1, BN1+SF4.1 and BN14 were all silently
   built for the live save. Each printed a correct-looking header, a passing RAM
   gate and an identical table. It took three readings to notice that three
   "different" regimes had produced byte-identical output.

   That is precisely the failure this prototype exists to protect against —
   *a build produced for the wrong regime, reporting success* — and it happened
   to the build tool itself within an hour. `profile.mjs` now **refuses
   unrecognised arguments** rather than falling back to the live save. It is
   also the strongest single argument for §7's runtime check: had that dist been
   deployed, nothing in the game would have complained either.

3. **The gate itself was blind, and the self-test found it.** The first version
   compared only against the handwritten baseline. Injecting a live
   `ns.singularity.purchaseTor()` reference into the compiled `go.js` added 2GB
   and **the gate passed** — 17.80 + 2.00 is still under the handwritten 20.30.
   Since the whole point of the build is to sit well below the original, that
   gap is where most possible regressions live. Fixed by the ratchet above; the
   same injection is now rejected by name. Worth stating plainly: a RAM gate
   that only compares against the thing it is replacing will wave through any
   regression smaller than its own advantage.

---

## 6. The four hard questions

### 6.1 Verification — `verify-deploy.mjs`

`tools/verify-deploy.mjs` walks the repo from `ROOT`, skipping `SKIP_DIRS`
(which contains `tools`), hashes every tracked file, and compares against the
game on every rooted host. Anything in the game that is neither tracked nor
`GAME_OWNED` is reported as an **orphan**. Invariant D1 requires its `SKIP_DIRS`
to stay identical to the daemon's; invariant D4 is "root `.js` deployed == root
`.js` on disk".

**With a build step, three things break.** (Describing, not changing, as asked.)

1. **The thing on disk is no longer the thing deployed.** `dist/go.js` is what
   the game runs; `src/go.js` is what a human edits. Under `SKIP_DIRS`, `tools/`
   is skipped — so `dist/` is invisible to both the daemon and verify. There is
   **no deploy path for a dist at all** without changing the daemon, and the
   obvious shortcut (emit to the repo root) makes every root `.js` a generated
   file that hot-deploys on write, which is both against the constraint here and
   a bad idea: an editor saving `go.js` at the root would push generated code
   over the build's output and the two would silently diverge.

2. **Every compiled script becomes an orphan or a mismatch.** If `dist/` were
   deployed while `src/` stayed on disk, verify would hash `src/go.js` against
   the game's compiled `go.js` and report a diff on every file, forever. If
   `src/` were also skipped, verify would report every deployed script as an
   orphan — "most likely a script deleted from disk that is still sitting in the
   game where the watchdog can relaunch it", which is exactly the wrong
   diagnosis.

3. **A second staleness axis appears, and nothing watches it.** Today there is
   one question: does the game match disk? With a build there are three, and the
   new one is the dangerous one:
   - does the game match `dist/`? (verify's current job, retargeted)
   - **is `dist/` current with respect to `src/`?**
   - was `dist/` built for *this save*? (§6.3)

   The middle question has no analogue today and fails silently: edit
   `src/go.js`, forget to rebuild, and the game keeps running last hour's build
   while both the editor and `npm run verify` report everything in sync. That is
   the `SKIP_DIRS`-edited-in-a-running-daemon failure with a new coat of paint.

**What the check should become**, if this were adopted:

- Verify **game vs `dist/`**, not game vs source. `trackedFiles()` gains a
  "deployment root" that is `dist/` for compiled scripts and the repo root for
  everything else, and the two sets must partition cleanly — a name appearing in
  both is an error, not a preference.
- Add a **staleness check with its own exit code**: rebuild into memory and
  compare against `dist/` on disk. Byte-identical, or `dist` is stale. It must be
  its own failure, distinct from "game does not match dist", because the fixes
  differ (`build` vs `sync`).
- Add a **profile check**: `dist/PROFILE.json` (already written by `build.mjs`)
  against the live save's BitNode and Source-Files. Exit non-zero on mismatch.
- Keep the 0 / 1 / 2 discipline and extend it: "could not check" must stay
  distinct, and now there are more ways to be unable to check (daemon down, the
  game not connected, `dist/` absent, the source failing to compile). A build
  failure must never read as "in sync".

That is three new checks and a partitioned file set, added to a tool whose whole
value is that it is simple enough to trust.

### 6.2 Debuggability

Better than feared, because no minifier runs — and still worse than today.

A Bitburner stack trace names a line in the **deployed** file, and the game does
not consume sourcemaps. So the question is only whether the deployed file is
legible, and it largely is: one statement per line, original identifiers,
longest line 135 characters.

But line numbers do not survive:

| | root | `src/` | `dist/` |
| --- | ---: | ---: | ---: |
| `go.js` total lines | 328 | 353 | 148 |
| the `go error:` handler | :320 | :345 | :138 |

The offset is not constant — it depends on how many comment lines were stripped
above any given point — so `go.js:138` cannot be mapped back by arithmetic. In
practice you open `dist/go.js`, read the line, and grep that text in `src/`.
That works, and it is a step down from "the stack trace names the file you
edit".

The sharper costs are the ones already named in §3: **94% of comments gone**,
and identifiers silently renamed (`buy2`, `ROUTE2`). A trace pointing at `buy2`
in a file with no comments is a materially worse debugging position than one
pointing at `buy` in the annotated original — and debugging is done in the
middle of a live run, where re-deriving why a line exists is the expensive part.

### 6.3 A wrong profile

Two directions, and they are not symmetric.

| | what happens | how loud |
| --- | --- | --- |
| **compiled for "has SF4", we do not** | `ns.singularity.*` throws on first call | loud, but only in a one-shot helper's status file, and only once something tries to buy. Hours. |
| **compiled for "no SF4", we have it** | **nothing throws.** autobuy takes the terminal route, go never cheats, the stack runs slightly worse forever and reports itself perfectly healthy. | **silent, indefinitely** |

The second is the shape CLAUDE.md calls the most expensive class of bug in this
repo, and **a build step adds it**. Nothing downstream can detect it, because
nothing downstream knows what it is missing. It is also not hypothetical — the
zsh word-splitting incident in §5 produced exactly this dist.

**The proposed self-check**, implemented as `src/profilecheck.js` → 2.70GB,
one-shot, run once from `boot.js` before anything else starts:

- `build.mjs` generates a **virtual module** `caps/build-profile.js` exporting
  `BUILD_STAMP` (`"bn4/sf1.1"`), `BUILD_CAPS` (the twelve derived booleans) and
  `BUILD_FILES` (what this dist should contain). Every output therefore carries
  the identity of its own regime.
- At boot, one 1GB `ns.getResetInfo()`, then the capabilities are **re-derived
  through `sfgate.js` at runtime** and compared. Not a stamp comparison: a stamp
  match would pass in the case where the dist is old and `sfgate.js` has since
  been *corrected*, which is the `sf14 >= 2` bug arriving a second time by
  another road.
- It reports `lost` (silent capability loss) and `missing` (will throw)
  separately, names the rebuild command, writes `/tel/profilecheck.txt`, and
  prints a `!!!!!` line to the terminal — the silent arm is the one that needs
  the terminal, because a stack that runs is a stack nobody investigates.
- It also checks `BUILD_FILES` actually exist on home (0.1GB), which catches a
  partial push — `go.js` compiled to exec `go-cheat.js` while `go-cheat.js` is
  absent — that no capability comparison can see.
- "Could not check" is reported as `health: unknown` with a `!!!!!` line, never
  as `ok`. Its predicate does not depend on anything the build produced
  (invariant C4): it asks the game, and compares against a manifest.
- `build.mjs` **refuses to build** if `profilecheck.js` does not check every
  capability the profile derives, so the check cannot silently become narrower
  than the thing it guards.

This works. It is also 2.70GB and a whole extra script to buy back safety that
the handwritten code has for free, against a 2.00GB resident saving.

### 6.4 What this does NOT solve

- **It does not time-share RAM, which is the thing the handwritten splits are
  actually for.** Module substitution decides *which code exists*; a separate
  script decides *when its RAM is paid*. `ns.singularity.purchaseTor` +
  `purchaseProgram` is 4GB base and **64GB at SF4.1**, and `autobuy.js` is a
  permanent resident in `boot.js`'s STACK and `watchdog.js`'s WATCHED list.
  Compiling the helper inline would pay that for the whole life to save a 1.3GB
  `ns.exec`. So the compiled dist keeps `autobuy-sing.js` and `go-cheat.js` as
  separate scripts — **the split survives the compiler entirely.** The compiler
  removes the duplicated *policy*, not the split.
- **It does not deploy.** `SKIP_DIRS` contains `tools`, so nothing in `dist/`
  reaches the game. A real adoption needs daemon changes (§6.1).
- **It does not test behaviour.** The gate proves cost, not correctness. Nothing
  here established that compiled `autobuy.js` still buys programs; it
  established that it is cheaper and structurally intact. A build step that can
  change semantics needs behavioural tests, and this prototype has none.
- **It does not help the hot path.** `h.js`/`g.js`/`w.js` carry no guards at all
  because one stray call in a 400-thread worker costs 40GB. They have no
  capability branches to remove. The same is true of `batch.js`, which is the
  largest resident in the stack.
- **It does not change what a script costs once the capability is present.**
  `autobuy-sing.js` is 66.60GB at SF4.1 handwritten and 65.60GB compiled. The
  16x Singularity tax is untouched.
- **It does not remove the need for `sfgate.js`.** The rules still have to be
  right; the compiler just evaluates them earlier.
- **It cannot see `eval`.** `cmd.js`, `upkeep.js`, `augbuy.js` and `torbuy.js`
  reach the DOM through `eval('document')` precisely so the RAM checker never
  prices them. Those scripts have nothing for a compiler to remove either.
- **It adds a build artifact to a repo whose defining hazard is stale
  artifacts.** CLAUDE.md's list already includes a stale `/cmd/out.txt`, stale
  `.telemetry/*`, a stale `/tel/status.txt`, a stale `SKIP_DIRS` in a running
  daemon, and an auto-push that silently dropped two edits. A `dist/` that can
  be out of date with respect to `src/` is one more of exactly that thing.

---

## 7. `ns.ramOverride` — the game's own answer, verified

`node tools/compile/ramoverride.mjs` (17 probes, priced with the game's
calculator, calibrated 0.00% against the live game).

### What it does

```
RamCostGenerator.ts:657        ramOverride: 0                 <- the call is free
RamCalculations.ts:484-487     checkRamOverride runs ONLY for a FunctionDeclaration
                               whose id.name === "main"
RamCalculations.ts:352-360     ...on the FIRST statement of its body, which must be
                               an ExpressionStatement wrapping a CallExpression with
                               exactly ONE argument
RamCalculations.ts:383-384     the callee identifier must be `ramOverride`
RamCalculations.ts:388-395     the argument must be a numeric Literal >= RamCostConstants.Base (1.6)
RamCalculations.ts:174-181     only the ENTRY module's override counts; one in an
                               imported module is DISCARDED. A match ends the
                               calculation immediately and REPLACES the computed cost.
```

Runtime (`NetscriptFunctions.ts:1202-1222`, `NetscriptHelpers.tsx:484-520`):
a script may **raise** its allocation at run time if the server has the free RAM,
and may lower it only down to `dynamicRamUsage` — the running total of every ns
function it has already called. `dynamicRamUsage` never decreases. Exceeding the
allocation **kills the script**, with an error that names `ramOverride` as a
likely cause.

### Where it suffices on its own — which is most of what the compiler was for

The coordinator's reading was that it "lets a script declare a lower cost but
does nothing about the code still being present". That is correct, **and the
code being present was never the problem.** Referencing a Source-File-gated API
costs RAM; it does not throw. Only *calling* it throws. So a script can carry
`ns.singularity.*` in a BitNode that cannot call it, declare 1.6GB, never take
that branch, and be correct. Measured:

```
no override at all (BN1 + SF4.1)                  33.60GB
ramOverride(1.6) as first statement                1.60GB
```

That is the compiler's headline use case, solved in one line, with no build
step, no dist, no deploy pipeline, no verify change, and no profile.

It is also **strictly more powerful in one dimension the compiler cannot reach**:
because the number can be a build-time floor and then *raised at run time*, a
script can declare 1.6GB, read `ns.getResetInfo()`, and grow to whatever this
regime actually needs — regime-adaptive, with no build.

### Where it does not suffice

1. **It cannot go below what the script actually uses, and the floor is
   cumulative.** `dynamicRamUsage` only ever rises, so the raise-then-lower
   pattern does not work within one process: once `purchaseTor` has been called,
   that cost is accounted for the life of the script. **Releasing RAM still
   requires a separate script.** So `ramOverride` does not replace the
   `go.js`/`go-cheat.js` or `autobuy`/`autobuy-sing` splits either — nothing does.
2. **The number is a hand-written literal, and getting it wrong is a crash
   loop.** Too low, and the script is killed at the first call that crosses the
   line — which may be hours in, on a rare path (the error handler, the
   once-a-life TOR purchase), after which `watchdog.js` restarts it and it dies
   again. Loud, but late and repeating.
3. **Determining the number requires exactly the reachability reasoning the RAM
   checker refuses to do**, done by hand. This is the strongest argument for a
   build step, and it has a cheap answer: use the compiler *offline as a
   measuring tool* to compute the floor, then ship the literal.
4. **It has eleven silent failure modes.** Every one of these yields full price
   with no warning, no log line and no error — the script simply costs what it
   always did:

   ```
   below Base: ramOverride(1.5)                    IGNORED
   ramOverride(0)                                  IGNORED
   non-literal: ramOverride(v)                     IGNORED
   expression: ramOverride(1.6+0)                  IGNORED
   not the first statement                         IGNORED
   arrow: export const main = async () => {}       IGNORED
   in a helper function, not main                  IGNORED
   renamed + re-exported: export {main2 as main}   IGNORED
   destructured: const {ramOverride}=ns            IGNORED
   inside if(false){}                              IGNORED
   a second call, anywhere                         NOT READ
   ```

   `ns.disableLog('ALL')` as the first line of `main` — which nearly every
   script in this repo does — silently disables it. So does `export const main =
   async (ns) => {}`. So does bundling, if esbuild renames `main`.

That list is the one real risk in adopting `ramOverride`, and unlike the
compiler's risks it is **statically checkable offline in about ten lines**:
price the file, and assert the result equals the literal. §8.

---

## 8. What to do instead

1. **Adopt `ns.ramOverride` for the specific scripts that reference a gated API
   they cannot call in some regimes.** One line, no build system, ~60% of the
   compiler's saving.

2. **Gate every use of it with a test**, in `tools/test/ram.mjs`'s existing
   suite, that turns the eleven silent modes into a loud one: for each script
   whose source contains `ramOverride(`, assert `ramOf(script).cost` equals the
   literal, under **all four regimes**. A silently-ignored override then fails
   `npm test` the day it is written instead of costing RAM forever. This is the
   single highest-value item on this list and it is a few lines.

3. **Require every `ramOverride` to carry a comment naming the ns functions the
   number excludes and why they cannot be called in the regimes it covers.**
   That is the reachability argument the game will not check, written down where
   the next reader can audit it. A wrong one is a crash loop, so it deserves the
   same treatment as a hardcoded BitNode multiplier: register it in
   `bncheck.mjs`'s `ASSUMPTIONS` (invariant C5).

4. **Keep the handwritten splits.** `go.js`/`go-cheat.js` and
   `autobuy.js`/`autobuy-sing.js` solve RAM *time-sharing*, which neither
   `ramOverride` nor a compiler can do. The compiled dist reproduced both splits
   unchanged, and `go-cheat.js` compiled to exactly its handwritten cost.

5. **Keep `tools/compile/` as a measuring instrument, not a build step.**
   `build.mjs --dry-run` computes the minimum safe `ramOverride` for a script in
   a regime we are not in, and `payoff.mjs` prices any script across four
   regimes. That is genuinely useful and carries none of §6's costs, because
   nothing it produces is ever deployed.

6. **Consider `profilecheck.js` on its own merits, later.** Without a build step
   it has less to catch, but "assert at boot what this save can actually do, and
   say so loudly" is cheap and independently sound — it would also catch a
   hardcoded gate that has gone stale, which is how `go.js` lost the cheat API
   for a whole BitNode.

### If it were adopted anyway

The RAM gate is non-negotiable, the `--minify-identifiers` prohibition is
non-negotiable, and `profilecheck.js` must ship in the same change — the wrong-profile
failure is silent and a build step introduces it. `verify-deploy.mjs` needs the
three changes in §6.1 *before* the first dist is deployed, not after.

---

## 9. Honest scorecard

| | handwritten (today) | + `ramOverride` | compiled |
| --- | --- | --- | --- |
| resident RAM, BN1 no SF | 24.45GB | 21.65GB | 19.65GB |
| lines changed to get there | — | 2 | a build system |
| new silent failure modes | — | 1 (ignored override) | 1 (wrong profile) |
| how that failure is caught | — | offline test, ~10 lines | 2.70GB boot check + gate + verify changes |
| comments in the deployed file | 100% | 100% | 6% |
| deploy path exists today | yes | yes | **no** |
| stack trace points at the file you edit | yes | yes | no |

The prototype does what it was asked to do, the gate caught two real faults
including one in itself, and the measurements are calibrated. The conclusion is
still that a 2.00GB resident saving does not buy a build system in a repo whose
most expensive recurring bug is a stale artifact that reports success.
