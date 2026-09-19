# Stage-aware bootstrap — staged, not deployed

Closes test failure **B2**: the stack could not start itself on a virgin
BitNode entry, and could not start its full self on the 32GB save we are
running now.

Nothing here has been pushed to the game. Every file in this directory is a
replacement for, or an addition to, a repo-root script. **Review, then deploy
all six at once** — see *Deploy* below, which has a live-game hazard in it.

---

## The defect, restated

Home RAM at BitNode entry is not one number (`Prestige.ts:242-248`):

| | condition | home |
|---|---|---|
| | SF9 level 2+ | 128GB |
| | SF1 level 1+ | 32GB |
| | otherwise | **8GB** |

and script RAM is not one number either (`RamCostGenerator.ts:82-96`): ten root
scripts change price with the Source-File 4 level, `autobuy.js` by 11.3x
(5.85GB inside BN4, 65.85GB at SF4.1 elsewhere).

`boot.js` declared **one static list** of ten home-pinned scripts totalling
82.60GB, and cost 7.90GB itself. On an 8GB home that left 0.10GB free — less
than the cheapest thing in its own list — so it launched nothing, printed ten
"no host with NGB free" lines and exited 0. On the 32GB save it managed four of
ten. There is no list that is right at 8GB, 32GB, 128GB and 16TB.

**The fix is not a shorter list. It is an ordered, budgeted plan.**

---

## The design

Three files carry it.

### `stack.js` — pure planner, no `ns`, free to import

`planStack(manifest, { homeRam, costOf, bootRam, minOps })` → `{ admit, defer }`.

Three rules, in this order:

1. **Order by value, not by fit.** Every manifest entry declares a `tier` — the
   smallest home at which it is worth its RAM — and a `rank`, and a `why`. At
   8GB the only thing worth home RAM is something that earns money and hacking
   experience, because every other capability in the collection is downstream
   of those two.
2. **Budget on actual cost.** `costOf` is `ns.getScriptRam` in the game, which
   returns the price *in the current regime*. So `autobuy.js` is admitted at
   5.85GB inside BitNode 4 and correctly refused at 65.85GB on an SF4.1 save,
   with no Source-File arithmetic in the planner at all. (The offline predictor
   for the same number is `sfgate.js`'s `singularityRamMultiplier`; the test
   suite uses it to check all five regimes without a running game.)
3. **Never starve the workers.** `minOps = 4` thread-slots are reserved off the
   top, *before* any daemon is considered. One HGW batch is four concurrent
   operations (`batch.js:365-366`).

Pure, so `npm test` runs the shipped planner rather than a copy of it
(CLAUDE.md, "Separate pure logic from `ns` I/O").

### `boot.js` — 7.90GB → **6.20GB**, and it *leaves*

Four things moved out, and one moved in:

| out | GB | to |
|---|---|---|
| `ns.scriptKill` | 1.00 | `retire.js` |
| `ns.getServer` | 2.00 | `bootnag.js` |
| `ns.getPlayer` | 0.50 | `bootnag.js` |
| `ns.getServerMoneyAvailable` | 0.10 | `bootnag.js` |
| `ns.hasTorRouter` | 0.05 | dropped — torbuy exits by itself |
| **in** | | |
| `ns.spawn` | **+2.00** | deliberate, see below |

`ns.spawn` is the whole 8GB tier. `ns.exec` launches into a home that still
contains the launcher; `ns.spawn` kills the caller and *then* launches
(`NetscriptFunctions.ts:644-650` — `killWorkerScript`, then `spawnCb`
immediately when `spawnDelay` is 0). So:

```
ns.exec   launcher 4.20GB resident  -> 3.80GB free -> 1 worker thread
ns.spawn  launcher 6.20GB, then gone -> 8.00GB free -> 4 worker threads
```

A more expensive launcher that leaves beats a cheaper one that stays. boot.js
exec's the daemons (resident), then **spawns the worker as its last act** with a
thread count it *measures* rather than trusts — `spare(home) + its own RAM` —
so a one-shot still finishing cannot make the spawn fail outright.

The manifest is **plain data**: no arrow functions, no `function`, no `ns.`.
Three parsers in the test suite read that array, and one that has to be
*executed* to be understood is one they will disagree about. `[B7.1]` asserts it.

### `hgw.js` — the 2.00GB worker

```
base 1.60 + hack 0.10 + grow 0.15 + weaken 0.15 = 2.00GB   x4 = exactly 8GB
```

Those four are required to be an HGW loop at all, so **any** self-threaded
worker that fits four ops in 8GB has 0.00GB left for reading server state.
`early.js` reads four state functions at 0.10 each, which is why four threads of
it need 9.60GB and cannot bootstrap a virgin BitNode — by 1.60GB.

It decides from the *return values*, which are free:

- `ns.weaken` returns the security removed, exactly 0 at minimum security
  (`NetscriptFunctions.ts:359-376`).
- `ns.grow` returns `moneyAfter/moneyBefore`, exactly 1 at maximum money
  (`ServerHelpers.ts:204-223`); a grow that changes nothing also fortifies
  nothing, so the probe is free of security cost.
- `ns.hack` returns the money stolen, 0 on a failed roll
  (`NetscriptHelpers.tsx:648-677`); a failed hack does not fortify either.

Money stolen is `money * percentHacked * threads`, so the yield of a hack is
proportional to the money on the server — comparing this hack's yield with the
first hack's yield after a full grow measures the money fraction directly. That
is how `early.js`'s `floor` argument keeps working with no
`getServerMoneyAvailable`.

**What the trade costs, stated rather than hidden:** one weaken and one grow per
cycle are spent discovering that the server is already prepped (~5-10% of
throughput on a short cycle), and it drives to minimum security rather than to
`early.js`'s measured +5 slack band. It is a worse worker and is meant to be. It
runs at exactly one tier — home under 32GB — where the alternative is not
`early.js` but nothing at all.

It imports `status.js` and registers `ns.atExit`, and still prices at **exactly
2.00GB** — `status.js` references only `ns.write` (0GB) and `atExit` is 0GB. It
writes once at startup and once on exit, never per cycle: at hundreds of threads
all writing the same file, a per-cycle write would be the dominant cost of the
cheapest script in the collection.

**NOT CALIBRATED.** The yield-proportionality proxy is derived from game source
and has never been measured in a running BitNode, because this save has always
had SF1 and has never seen an 8GB home. Its *RAM* is checked every run by `[B2]`
against the game's own `calculateRam`. Its *throughput* is not.

### `retire.js` (2.85GB) and `bootnag.js` (4.35GB)

The go.js / go-cheat.js lever, twice. Both are capabilities boot.js used to
inline; neither is deleted, both are now paid for only where they are affordable.

- `retire.js` stops a named script everywhere. exec'd only when a deferred entry
  is genuinely running — which on a virgin entry is never, because nothing has
  ever been started there.
- `bootnag.js` is the human-facing half of the old report (`getServer` +
  `getPlayer`). Admitted at 128GB. Below that the machine-readable half is still
  written to `/tel/boot.txt`, for free, at every tier.

### `seed.js` — two changes

1. **Picks the worker per host**: `early.js` where four threads of it fit
   (`free >= 2.40 * 4`), `hgw.js` where they do not. The opening fleet spans a
   4GB n00dles and a 16GB foodnstuff; nothing there is one-size.
2. **Drops the hacking-level test from rooting.** `ns.nuke` checks the open port
   count and nothing else (`NetscriptFunctions.ts:504-521`) — the level gates
   *hacking* a server, not rooting it. The old guard left joesguns (16GB, level
   10) and nectar-net (16GB, level 20) unrooted through the whole early climb,
   for no reason: **a host is RAM whether or not it is a target.** On a virgin
   8GB entry that is most of the ~100GB of 0-port servers.

---

## The tier table

BN4 base pricing. `boot.js` 6.20GB, transient. Full output: `npm test stage`.

| home | worker | on home | off home (costs the home budget nothing) |
|---|---|---|---|
| **8** (entry, no SF) | `hgw.js` 2.00 **x4** = 8.00 | — | `seed.js --watch` 6.40 |
| **16** | `hgw.js` 2.00 x8 | — | `seed.js` |
| **32** (entry, SF1) | `early.js` 2.40 **x7** | torbuy 2.45, cmd 8.15, backdoor 4.60, settings 2.30¹ | seed 6.40, tel 4.00 |
| **64** | `early.js` x11 | + watchdog 7.80, upkeep 2.20, autobuy 5.85², homeup 4.45³ | + buyserv 6.50 |
| **128** (entry, SF9.2) | none — batch.js places h/g/w, 32 slots free | + batch 8.80, nfg 2.40³, go 20.30, bootnag 4.35; − seed/early retired | + share 4.00 |
| **256+** | | + ctauto 22.00 | |

¹ `kind: 'oneshot'` — exits in seconds, so it is budgeted transiently rather
  than given a permanent slot.
² admitted on `ns.getScriptRam`, so on an SF4.1 save it costs 65.85GB and is
  correctly deferred until home can hold it (at 64GB the plan defers it and
  says so; at 128GB it admits it and defers `go.js` instead).
³ `kind: 'job'` — budgeted here so its RAM is not handed to a daemon, but
  launched by `watchdog.js` on its trigger, never from boot.

### What is deferred, and why

Deferrals are data, not omissions — every one carries a reason into
`/tel/boot.txt`. The ones that are judgement calls:

- **`watchdog.js` to 64GB.** Resilience is worth 7.80GB only once there is a
  stack worth reviving. `seed.js`'s own header already makes this argument at
  32GB: three worker threads, "too expensive in the one phase where threads are
  the whole game".
- **`batch.js` to 128GB.** This is invariant **B5**, not a RAM judgement.
  batch.js sizes a plan against the fleet TOTAL and then has to place each op on
  a SINGLE host, so on an opening fleet it reports `placeFails` forever and
  earns nothing — 7,274 failures and $0 over 27 minutes, observed. `seed.js` +
  `early.js` is strictly better until batch.js plans against the largest free
  *block*. **When B5 is fixed, lower this tier.**
- **`go.js` to 128GB.** 20.30GB is eight `early.js` threads, and it needs the
  external solver running to beat a Daedalus-grade opponent.
- **`ctauto.js` to 256GB.** Contracts pay ~$25m and reputation that cannot be
  bought below 150 favour — but 22.00GB is nine `early.js` threads and contracts
  are sparse early. Last in, not first.
- **`torbuy.js` to 32GB.** It polls for the $200k TOR router; an 8GB opening
  does not have it, and the poller would hold a worker thread for the whole wait.

Nothing was deleted. Every script in the old STACK, and every script in
`watchdog.js`'s WATCHED, is in the manifest with a tier and a reason — `[B7.3]`
fails if any entry is never admitted at any home size up to 1024GB, and
`[B7.9]` fails if the watchdog watches something the manifest does not declare.

---

## Deploy

**Order matters and there is a live-game hazard.**

1. Copy all six into the repo root *together*:
   `boot.js  stack.js  hgw.js  retire.js  bootnag.js  seed.js`.
   `boot.js` sorts before `stack.js`, so it lands first and fails to compile
   until `stack.js` arrives; the daemon rechecks once everything is present
   (CLAUDE.md). Then `curl -s localhost:12526/verify` — the auto-push has
   silently dropped edits before.
2. `npm test ram stage` — `[B2]` should go green and `[B7]` should lose its
   "STAGED, not deployed" warning.
3. **Before running it on the live save:** `run boot.js --dry`. It plans, writes
   `/tel/boot.txt`, prints, and starts/stops/roots nothing.

   The hazard: this save is on a **32GB** home. The plan at 32GB defers
   `watchdog.js`, `go.js`, `ctauto.js`, `batch.js`, `autobuy.js`, `buyserv.js`,
   `upkeep.js`, `share.js`, `nfg.js` and `homeup.js`, and boot.js is idempotent
   *in both directions* — so a real run will `retire.js` every one of those that
   is currently running. That is the design working, and at 32GB it is the right
   answer, but it is a large visible change to a game that is currently earning.
   Read the dry run first, and consider buying home RAM to 64GB before the real
   run if you would rather keep the watchdog.
4. Only after that: `run boot.js`.

Editing a file does not restart it — the running `boot.js` process does not
exist (it exits), so there is nothing stale to kill.

---

## Changes wanted in files owned by other agents

Described rather than made, per the brief.

### `watchdog.js` (c1)

1. **`autobuy.js` needs a RAM gate.** This is the remaining half of invariant
   B2 row 5. boot.js now refuses to admit autobuy at 65.85GB on a home that
   cannot hold it, but the watchdog's WATCHED list is static and will keep
   trying every 30s. The narrow fix is an `invariant` on the entry:

   ```js
   invariant: (ns) => ns.getScriptRam('autobuy.js', 'home') <= ns.getServerMaxRam('home') / 4,
   ```

   `ns.getScriptRam` is already referenced in watchdog.js, so this is free.

2. **Better: the watchdog should watch what boot.js admitted.** WATCHED and
   STACK are two hand-maintained lists of the same thing, which is how
   `autobuy.js` ended up gated in one and ungated in the other. `/tel/boot.txt`
   now carries the admitted set with costs; a watchdog that reads it gets
   tiering, regime-aware pricing and retirement for free, and `[C4]`'s circular
   gate complaint about `/tel/backdoor.txt` gets a second writer. `[B7.9]`
   currently asserts only that the two lists have the same *membership*.

3. `share.js`'s and `torbuy.js`'s invariants stay where they are — boot.js no
   longer carries a duplicate `when` for either (that is where the 0.05GB
   `ns.hasTorRouter` and 0.50GB `ns.scriptKill` went).

### `batch.js` (c1)

`planBatch` returns `best ?? build(1)` (batch.js:381), so when nothing fits the
budget it returns a plan that ignores the budget. Until that returns `null` and
the sizing is against the largest free **block** rather than `totalRam`,
batch.js is tiered at 128GB in the manifest and `seed.js`/`early.js` do the
work below that. Fixing B5 is worth roughly one whole tier of income — lower the
tier in the same change.

### `early.js` and `share.js` (c1) — new `[C1]` failures, both free to fix

Deploying this manifest grows `[C1]`'s managed set from 15 scripts to 19
(`boot.js` STACK + `watchdog.js` WATCHED), which pulls `early.js`, `seed.js`,
`hgw.js` and `bootnag.js` in. The four staged here are already converted;
**`early.js` is the one new failure and it costs 0.00GB to close** — `status.js`
references only `ns.write` (0GB) and `ns.atExit` is 0GB, which is how `hgw.js`
publishes on every exit path and still prices at exactly 2.00GB.

`share.js` already failed `[C1]`; this only makes it visible in a stack that
now declares it.

### `autobuy.js` (gates)

`[SF3]` still fails it for using `ns.singularity.purchaseTor` /
`purchaseProgram` with no `sfgate.js` gate. That is what makes its RAM swing
11.3x. If the singularity half moves into its own script the way `go.js` /
`go-cheat.js` does, autobuy's tier in the manifest can come down from 64GB, and
the B2.5 hazard disappears at the source rather than being budgeted around.

---

## What `npm test` now asserts that it did not

`[B2]` in `tools/test/ram.test.mjs` — same check, three corrections so it asks
the right question of a tiered launcher, plus one new sub-check:

- `bootStack(where, tier)` reads `tier` / `until` / `role` / `kind` out of the
  manifest. An entry with **no** tier is treated as wanted at every home size,
  so a flat list measures exactly as it did before.
- `B2.2` / `B2.4` split the home set by **how it is started**: an exec'd entry
  competes with the resident launcher and must fit in `T - boot`; a *spawned*
  entry does not, because the spawn terminates the launcher first. Whether
  boot.js spawns is read out of boot.js's own source, not assumed.
- **`B2.4b` is new and is stricter than `B2.4`**: once the launcher is gone, the
  resident set plus `MIN_OPS` worker slots must still fit. A daemon set that fits
  but leaves no room to hack is a machine watching itself.
- `B2.5` skips tiers below an entry's declared tier — sound only because
  `[B7.9]` asserts the watchdog and the manifest agree on membership.

`[B7]` in `tools/test/stage.test.mjs` is new and runs the **shipped planner**
over 10 home sizes x 5 Source-File regimes (177 plans): the manifest is data
(B7.1), everything prices in every regime (B7.2), nothing is deferred forever
(B7.3), every deferral has a reason (B7.4), the plan fits both transiently and
in steady state (B7.5), `MIN_OPS` slots survive (B7.6), something earns (B7.7),
growing home never silently drops an entry (B7.8), and the watchdog's list and
the manifest agree (B7.9). It reads the staged copies until they are deployed
and says so as a WARN.
