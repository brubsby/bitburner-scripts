# Audit: inefficiency / unsoundness survey — BitNode 4, 2026-09-14

Objective: hacking multiplier. `skill = mult * (32*ln(exp+534.6) - 200)`
(PersonObjects/formulas/skill.ts:13). BN4 exit needs hacking 9000
(WorldDaemonDifficulty 3, BitNode.tsx:652).

Live state at audit time (from `getSaveFile`, read-only):
BN4, hacking 183, exp 5.2e4, mult.hacking 1.2437, money $38M, 1 faction
(CyberSec, rep 3.9k favor 14), fleet 2,124GB @ 92% util, 25/25 purchased-server
slots used for 704GB total, home 512GB/1 core, 43 unrooted servers (lowest needs
hacking 424).

---------------------------------------------------------------------------
# COSTING NOW
---------------------------------------------------------------------------

## 1. The install gate's published justification is stale, and the trade it says is impossible has been executed three times in the last four hours. (confidence: high)

`watchdog.js` (progress.js entry, the comment beginning "INSTALLS ARE ENABLED
AGAIN, because the decision now has a model behind it") states:

> installgate.js now decides, on one expression: an install must pay its rebuild
> back within the expected remaining time in this BitNode, i.e. H* = A/(M-1) <
> horizon. The +1% case is refused by arithmetic (M = 1.01 demands a horizon a
> hundred times the life's age) ... Both directions are asserted by
> tools/test/installgate.test.mjs [IG1, IG2], with IG1 replaying the exact trade
> that went wrong.

Every clause of that is now false:

* `grep -n "horizon\|A/(M-1)\|payback" installgate.js` returns **nothing**.
  There is no horizon term. The shipped rule (installgate.js:213-216) is
  `install = stalled && expOk && stalledFor >= minStalls`, a renewal-reward
  stall detector with a 3-sample (15-minute) persistence counter.
* installgate.js's own header (lines 43-50) says the `A/ln(M)` model
  "went wrong ... the live run did exactly that, installing a single NeuroFlux
  three times in under an hour". So the comment cites the superseded version.
* IG1 is not "the trade that went wrong" — it checks `skillFromExp`
  (installgate.test.mjs:26-56). **IG3 (installgate.test.mjs:80-100) asserts the
  exact opposite of the watchdog comment**: `if (!d.install) c3.fail('a stalled
  cycle holding one NeuroFlux refused to install')` at M = 1.0303. The suite
  fails if the +1% case is refused.
* The only real brake is the stall counter, and the header says so of the
  experience term: "BE HONEST ABOUT ITS STRENGTH: this is a WEAK constraint ...
  it stops an install in the opening seconds of a life and never again."

### The measured cost (differenced from .telemetry/history.jsonl, BN4 rows)

Three installs since entering BN4 13.6h ago:

| when | queue | hacking | money | pserv fleet | rooted | CyberSec rep | life |
|---|---|---|---|---|---|---|---|
| 21:11:45 | (NFG levels) | 260 -> 1 | **$876,124,111 -> $1,262** | 0 | 71 -> 9 | 56 -> 0 | 588 min |
| 22:57:16 | 5x NFG + Neurotrainer I | 179 -> 1 | $58,432,534 -> $1,262 | 224GB -> 0 | 56 -> 9 | 5,470 -> 0 | 105 min |
| 23:57:46 | **1x NeuroFlux Governor, M = 1.0303** | 161 -> 1 | $2,712,884 -> $1,262 | 392GB -> 0 | 40 -> 9 | 1,669 -> 0 | 60 min |

The third is precisely the +3% trade the watchdog comment says "is refused by
arithmetic". Recovery to hacking 161 took **49 minutes** (23:57:46 -> 00:46:46),
i.e. 82% of the following 60-minute life was spent climbing back to the level it
started at, to bank +3.03%.

Net over the last four hours: multiplier 1.16 -> 1.2437 (+7.2%), hacking level
260 -> 183 (-77). `installgate.txt` right now reads `queued: 3, M=1.1146,
stalledFor: 1` of 3 — install #4 is roughly ten minutes away.

### What the model omits from the cost of an install

`progressFactor` (installgate.js:88-105) values only the queued augmentations'
multiplier product. The rebuild side is not in the expression at all. An install
additionally destroys, every time:

* the purchased-server fleet (Prestige.ts, 25 slots to 0) — 392GB last time,
  bought for real money;
* every root (71 -> 9 at install #1), so the port-opener investment re-pays;
* **Go nodePower and the faction_rep bonus it buys.** `Go.prestigeAugmentation()`
  (Go.ts:34-47) zeroes `nodePower`, `wins`, `losses`, `winStreak`. That bonus is
  currently **+26.1% faction_rep** (`.telemetry/go.txt` `factionRepBonusPct`) —
  the single largest reputation multiplier in the run, and it is reset each time;
* the share.js bonus's substrate (fleet RAM), currently +17.1%;
* faction reputation (converted to favor, which is the one thing that survives).

Cost against the objective: hard to bound exactly, but the measurement above is
unambiguous — 49 of 60 minutes of a life spent recovering for +3.03%. Whatever
the right cadence is, "install whenever nothing was bought for 15 minutes" is
not a statement about it, and the comment authorising it describes a rule that
does not exist.

**Not asserting the correct cadence.** Open question: the renewal-reward rule is
the right *shape*; what it is missing is the rebuild term, and `A` (life age) is
not a proxy for it because the rebuild is a fixed cost, not proportional to A.

---------------------------------------------------------------------------

## 2. `faction.js` reads v1 player fields. It crashes on every hourly run and its answers are inverted. (confidence: high — live crash in telemetry)

`ns.getPlayer()` returns exactly hp, skills, exp, mults, city, numPeopleKilled,
money, location, totalPlaytime, jobs, factions, entropy, karma
(NetscriptFunctions.ts:1371-1389). There is no flat `hacking_skill`, `strength`,
`defense`, `dexterity`, `agility`.

`common.js:90` was fixed to set `player.hacking = player.skills?.hacking ?? 0`,
and `common.js:83` claims that is "the field faction.js compares against every
faction's hacking requirement". **faction.js never reads `player.hacking`.**
`grep -n "player\.hacking\b" faction.js` -> no matches. It reads:

* `faction.js:430,438` `requirements.hacking > player.hacking_skill`
* `faction.js:486,499` `requirements.hacking <= player.hacking_skill`
* `faction.js:431-434,439-442,487-490,501-508` `player.strength/defense/dexterity/agility`

So the fix landed on a dead field and the defect is untouched.

Two live consequences, in opposite directions:

**(a) `areFactionRequirementsMet` (faction.js:429-444) can never fail a
hacking or combat requirement.** `2500 > undefined` is `false`, so the clause
never returns false. Every hacking-gated and combat-gated faction — including
Daedalus at hacking 2500 — reads as *requirements met* at hacking 183. This is
the *opposite* of what common.js's comment describes, and worse: the map is
over-permissive, not under-permissive.

**(b) `getUnmetRequirements` (faction.js:485-508) never deletes
`hacking_combat_or`**, which is the boolean `true` at `faction.js:111`
(Daedalus). It reaches `ns.format.number(requirementEntry[1], 3)` at
**faction.js:589** and throws.

Live evidence, `.telemetry/faction.txt`:
```
"health": "stopped",
"errors": ["...TYPE ERROR ... format.number: 'n' must be a number.
            Is of type 'boolean', value: true ... faction.js:L589@act"]
```
The throw is inside the argument list of the single `ns.tprint` template
(faction.js:587-599), so `--print-factions` emits **nothing at all** — the
"diagnostic shares a failure path with the fault" shape, CLAUDE.md:263.

`watchdog.js:361` launches it hourly with `['--print-factions','--no-companies']`
and the comment immediately above (watchdog.js:356-359) says the flag is passed
*precisely* so that "silence from a reporter" cannot happen. It is producing
silence, and `watchdog.txt` reports `"health": "ok"` with `faction.js: cooling
down` — the watchdog reports launch state and never reads the job's own health.

Cost: the only script that maps which faction to target next — which reputation
stream buys the next multiplier — has produced nothing since the run began.
Related but distinct from the already-documented `faction.js:329` root-vs-backdoor
bug (docs/game-knowledge.md §1).

---------------------------------------------------------------------------

## 3. `homeup.js` can never fire again this life: its trigger threshold is 1,000x above the ceiling `buyserv.js` holds the account at. (confidence: high — arithmetic on two live constants)

* `watchdog.js:474-475`:
  `trigger: (ns) => { const next = nextHomeUpgrade(...); return !!next && ns.getServerMoneyAvailable('home') >= next.cost + 2e12 }`
* `buyserv.js:75` `floorReserve: 2e9`, and buyserv spends the **entire** surplus
  above its reserve **every 15 seconds** (`buyserv.js:180-182`, `interval: 15000`).

So the account is held at ~$2e9 (once port openers are owned) while homeup
needs $2.001e12 in hand at a watchdog tick. Money would have to jump 1,000x
within one 15-second buyserv window. It cannot. `homeup` reads
`"idle: trigger false"` in `watchdog.txt` and has not run since 19:47
(`.telemetry/homeup.txt`, and that run used `--reserve 5e7`, not the 2e12 the
watchdog passes).

Why it matters against the objective: home RAM and cores are the **only**
purchases that survive an install (prestigeHomeComputer, Server/ServerHelpers.ts:
226-239, touches neither `maxRam` nor `cpuCores`). Home is 512GB / **1 core**,
next upgrade $1.005b (`.telemetry/homeup.txt` `nextCost`). Every dollar above
$2e9 is going into cloud servers that the next install deletes — and with finding
#1 running, installs are arriving roughly hourly. This is the "$2.07 quadrillion
thrown away" failure with the sign flipped: not hoarding cash through an install,
but routing 100% of income into the destructible channel because the permanent
channel's gate is unreachable.

Also: home has **1 core**. Cores multiply grow/weaken effectiveness
(`coreBonus` is used at batch.js:842) and survive installs too.

---------------------------------------------------------------------------

## 4. `boot.js`'s `shareThreads` still carries the `Math.max(600, ...)` floor that was removed from `watchdog.js`. (confidence: high)

`boot.js:119`:
```js
return Math.max(600, Math.min(250000, Math.floor((biggest * frac) / perThread)))
```
`watchdog.js:560-572` is the same function, fixed: `MIN_USEFUL = 32`, and it
returns 0 (meaning "do not launch") below that. The two copies have drifted and
boot.js kept the outage-shaped floor.

600 threads x 4GB = 2,400GB in a single `ns.exec`, which cannot be split across
hosts. The live fleet is 2,124GB with a 512GB largest host, so the request is
unsatisfiable. `boot.js` runs at exactly one moment: **immediately after every
install** — which, per finding #1, is roughly hourly — and that is the window
where the fleet is smallest and the reputation multiplier matters most.

Currently masked: the watchdog re-places share within 30s (share.js is running
at 72 threads, `.telemetry/share.txt`, `watchdog.txt` share.js `count: 1`). So
the live cost is ~30s per install, but the defect is the same class that
previously cost a permanent +17% reputation, sitting in the copy nothing else
covers.

---------------------------------------------------------------------------

## 5. `.telemetry/` carries four orphan files with no writer and no timestamp, describing a world that no longer exists. (confidence: high)

Cross-referencing every `.telemetry/*.txt` against `grep -rl "/tel/<name>"` over
the root scripts:

| file | `at` field | writer in live scripts |
|---|---|---|
| `freeram.txt` | **none** | **none** |
| `mults.txt` | **none** | **none** (already noted in docs/horizon.md:145) |
| `tor-probe.txt` | **none** | **none** |
| `joinfac.txt` | 2026-09-13T20:48 | **none** |
| `auto.txt` | 2026-09-12T03:39 | none (retired auto.js) |

`freeram.txt` is the dangerous one, because it is exactly the file a human or
agent consults for "where is the idle RAM":
```json
"top": [ { "h": "pserv-694-0", "max": 1048576, "free": 942378.75 }, ... ]
```
That is a 1PB server with 942TB free. It does not exist; the largest host on the
network is home at 512GB. The file has **no timestamp**, so nothing — not the
dashboard, not a reader — can tell it is from a previous life. Text files survive
a prestige (Server/ServerHelpers.ts:226-239), which is why it is still there.

`joinfac.txt` says `joined: ["CyberSec","NiteSec"]`; the save has only CyberSec
as a member (NiteSec rep 0, favor 1.46 — it was reset by install #1).

`tor-probe.txt` lists 30+ `pserv-694-*` / `pserv-15740-*` hosts, none of which
exist.

Cost: no script reads these, so this is zero *machine* cost — but it is
non-zero agent/human cost, and it is the "stale artifact read as current" shape
that CLAUDE.md:270 names by file.

---------------------------------------------------------------------------

## 6. `fast.js` publishes the dashboard's headline numbers, died two hours ago, said so loudly, and nothing is watching. (confidence: high)

`.telemetry/fast.txt`:
```
"health": "stopped", "at": "2026-09-13T22:57:06Z",
"detail": "fast.js is no longer publishing — dashboard headline numbers are frozen",
"hacking": 179, "money": 62048270, "scriptIncome": 20555, "homeUsed": 374
```
`tools/dash.mjs:250` reads `/tel/fast.txt` for its 2-second lane. `fast.js`
appears in **neither** `boot.js`'s STACK nor `watchdog.js`'s WATCHED
(`grep -n "fast.js" boot.js watchdog.js` -> no matches). It exited at the moment
of install #2 (22:57:16) and has not run since.

So the dashboard's live numbers have been frozen for two hours, showing hacking
179 / $62M / home 374GB against a real 183 / $38M / 385GB. The `atExit` publish
worked exactly as designed — CLAUDE.md's rule 1 — and there was no consumer of
the alarm. This is the second half of "failure must be loud": loud to whom.

---------------------------------------------------------------------------

## 7. `upkeep.js` has never claimed the 24h export favor bonus, and clicks a nav element without verifying it navigated. (confidence: medium on cause, high on symptom)

`.telemetry/upkeep.txt`: `"exportClaims": 0`, `"note": "Backup Save button not
found"`. The button is `Backup Save {exportBonusStr()}`
(Augmentation/ui/AugmentationsRoot.tsx:180, label helper at :95-98), and
upkeep.js:217 matches it with `textContent.trim().startsWith('Backup Save')` and
`offsetParent !== null` — which should match whether or not the bonus is
available. "not found" therefore means the Augmentations page was not rendered
when it looked, i.e. `navItem('Augmentations').click()` at upkeep.js:212 did not
navigate.

upkeep.js never checks that it did. CLAUDE.md's own rule 5 — "Verify against a
signal the operation itself did not produce ... A disabled MUI button swallows
`.click()` in silence" — is the rule being broken. I could not confirm the cause
without the browser, so **this is an open question**, not an assertion.

Cost: small right now. +1 favor per joined faction per 24h, with one faction at
favor 14; rep gain carries `(1 + favor/100)` (reputation.ts:16), so the claim is
worth <1% of the rep stream today. It scales with faction count. The recurring
cost is 4 seconds of unfocused work per hour (EXPORT_CHECK = 3600000,
upkeep.js:78; it unfocuses at :205-210 to reach the page) for nothing.

Also worth noting: `upkeep.js` is the one DOM-driving script that does **not**
import `lock.js` (`homeup/torbuy/augbuy/nfg/settings/cmd` all do). It does read
the lock file and stand down (upkeep.js:148), so this is not unguarded — but the
guard is a re-implementation rather than the shared module.

---------------------------------------------------------------------------
# LATENT / NOT COSTING NOW
---------------------------------------------------------------------------

## 8. `createProgram.js` can never find a program to create. (v1 field, same class as #2)

`createProgram.js:189`:
```js
.filter(program => ns.getPlayer().hacking_skill >= programs[program].hacking_level_required)
```
`undefined >= n` is false for every n, so `getCreateProgramTasks` returns `{}`
unconditionally. `createProgram.js:229` then does
`program = Object.keys(getCreateProgramTasks(ns)).shift()` -> `undefined` ->
`ns.singularity.createProgram(undefined)`.

Mirror defect on the single-program path: `createProgram.js:202` takes
`player = ns.getPlayer()` and `:222` tests `player.hacking < req`, which is
`undefined < n` -> false, so the "level not met" guard can never fire either.

Not in STACK or WATCHED, so dormant — but `buyProgram.js` imports its `programs`
table (docs/script-inventory.md:114), and the repo's stated goal is a headless
playthrough at any SF level.

## 9. `nfg.js` reserve: three different figures in three places.

* `nfg.js:4` (header/usage): `run nfg.js --reserve 5e12  keep this much back`
* `nfg.js:77` (actual default): `['reserve', 2e12]`
* `watchdog.js:164` `NFG_RESERVE = 5e11`, passed as `--reserve` (watchdog.js:~415)

The supervisor always passes the flag, so 5e11 wins and behaviour is currently
correct; the header is wrong by 10x against the code beside it and 100x against
what actually runs. Same shape as the already-known drift, one layer deeper.

`homeup.js:84` default `['reserve', 1e12]` vs watchdog's `2e12` — same pattern,
also masked by the supervisor always passing it.

## 10. Duplicated logic that can drift.

* `scanAll(ns)` — **six byte-identical copies**: `boot.js:122`, `batch.js:221`,
  `ctauto.js:26`, `ctscan.js:17`, `tel.js:40`, `watchdog.js:574`. All six already
  reference `ns.scan`, so a shared module would cost **zero** extra RAM in any of
  them (CLAUDE.md "Separate pure logic from ns I/O" — importing is free). There
  is no RAM justification for the duplication.
* `byText` — five copies: `homeup.js:47`, `torbuy.js:52`, `augbuy.js:58`,
  `nfg.js:46` (identical arrow form) and `upkeep.js:86` (function form). All use
  exact `trim() === text`; they agree today.
* `tryRoot` — `backdoor.js:63` and `batch.js:235`.
* `reserveFor` (buyserv.js:83-88) and `reserveNow` (buyserv.js:107-112) are the
  **same function body in the same file**; only `reserveNow` is called.
  `reserveFor` is dead code that a future edit can silently diverge from.
* `shareThreads` — see finding #4, already drifted.

## 11. `getScriptRam(...) || 4` hides a missing file.

`boot.js:107` and `watchdog.js:561`: `ns.getScriptRam('share.js','home') || 4`.
`getScriptRam` returns 0 for a file that is not there, so "share.js is missing
from home" silently becomes "assume 4GB/thread" and the exec then fails for a
different reason. The fallback value is correct; the silence is not.

---------------------------------------------------------------------------
# NEGATIVE RESULTS (searches that looked and found nothing)
---------------------------------------------------------------------------

* **`0 ?? fallback`**: swept every `??` in the repo (excluding node_modules,
  archive, .variants, min, cw) whose right-hand side is not a trivial
  `''/[]/{}/null/false/true/'literal'`. 120 sites reviewed. The two known
  instances (go.js's `totalPlaytime`, watchdog.js's `threads`) are both fixed
  and both carry a comment naming the trap (go.js:104-105, watchdog.js:818-821).
  **No new live `0 ?? x` defect found.** The closest candidates —
  `installgate.js:139-141`, `lock.js:219`, `batch.js:842`, `augplan.js:452` —
  all have left-hand sides where 0 and absent mean the same thing.
* The dangerous `||`-with-numeric-default analogue: 6 sites across the live
  stack; `cmd.js:194` `Number(threadsRaw) || 1` is the *safe* direction (the fix
  for the documented `0 ?? 1` bug), `tel.js:57` and `batch.js:1370-1371` are
  harmless. Only finding #11 is worth noting.
* Fleet is **not** idle: independent measurement from `.telemetry/status.txt`
  (tel.js reads `ns.ps`, so unlike the save it does see `temporary: true`
  workers) gives 2,124GB total / 1,956GB used = **92.1%**, 181 processes,
  h.js 534 threads / g.js 209 / w.js 175 / share.js 72. The save-derived figure
  is 0% for the known BaseServer.ts:301-313 reason; do not use it.
* No unrooted server is currently reachable: the cheapest of the 43 needs
  hacking 424 (aevum-police) against a live 183, and 40 of them need 5 ports
  against 3 owned. buyserv's $30M reserve is correctly holding for HTTPWorm.exe
  (4th port opener), which unlocks `run4theh111z` (512GB) among others.

---------------------------------------------------------------------------
# ADDED AFTER THE PARALLEL SWEEPS (rank: #12 belongs at position 3)
---------------------------------------------------------------------------

## 12. `buyserv.js`'s entire purchasing policy rests on a pricing claim that is false in BitNode 4. Measured live cost so far: 18% of the fleet. (confidence: high — the arithmetic reproduces the exact dollar figure in the save)

`getCloudServerCost` (Server/ServerPurchases.ts:22-41):
```
cost(ram) = ram * 55000 * CloudServerCost * CloudServerSoftcap ^ max(0, log2(ram) - 6)
```
BN4 sets `CloudServerSoftcap: 1.2` (BitNode.tsx:632) and leaves `CloudServerCost`
at its default 1. So **above 64GB the price per GB rises 20% per doubling**:
$55k/GB at 64, $66k at 128, $79.2k at 256, $95k at 512, $114k at 1024.

`buyserv.js:14-21` states the opposite as its premise:
> getCloudServerCost is *linear* ... a flat $55,000/GB at every size, the softcap
> exponent ... being raised to CloudServerSoftcap = 1 ... There is no volume
> discount to wait for and no optimal-stopping problem.

and `buyserv.js:164-178` builds the "Concentrate, do not level" policy on it:
> total RAM for a given spend is the same however it is distributed

Both are BN1 facts. In BN4 they are false, and the policy the second one
justifies — upgrade the **largest** server that is not at cap (buyserv.js:184-202)
— is exactly the most expensive shape available.

### Live confirmation, to the dollar

Current fleet (`.telemetry/buyserv.txt`): 1x256, 1x128, 1x64, 10x16, 12x8 = 704GB.
Pricing each at the formula above:
```
256: 256*55000*1.2^2 = 20,275,200
128: 128*55000*1.2^1 =  8,448,000
 64:  64*55000*1.2^0 =  3,520,000
10x16:                  8,800,000
12x 8:                  5,280,000
                      -----------
                      $46,323,200
```
`Player.moneySourceA.servers` in the live save is **-46,323,200**. Exact match,
so the formula and the spend are both confirmed rather than assumed.

The same $46,323,200 spread evenly across the 25 slots buys 25x32GB for
$44,000,000 (all below the 64GB softcap knee) plus one 32->64 upgrade for
$1,760,000 = **832GB for $45,760,000**. That is **+18% RAM for less money**,
today, at the smallest sizes where the penalty is mildest.

### It gets worse, and it compounds with the slot limit

The policy only ever touches the largest server, so the other 24 slots are
**frozen at 8-16GB permanently** — the rule never returns to them. Projecting to
a $600M budget:

| policy | result |
|---|---|
| concentrate (current) | one 4,096GB server for $672M (1.2^6 = 2.99x per-GB penalty) + 24 slots stuck at 8-16GB ~ **4.35TB** |
| even across 25 slots | 25 x 256GB for $506M ~ **6.4TB** |

i.e. ~50% more RAM per dollar, growing with every doubling. And the 25-slot cap
(`ns.cloud.getServerLimit()`, currently 25/25 used) is the scarce resource:
freezing 22 of them at 8GB while one grows wastes both the slots and the price
curve.

The placement argument in the comment is real — a batch must fit on one host —
but it is a trade whose price the comment states as zero. In BN4 it is not zero,
and nothing measures it. `tools/sim/bncheck.mjs` already flags CloudServerSoftcap
as a BN4 break; the shipped header still asserts the BN1 claim as fact.

Cost against the objective: RAM is the batcher's throughput and therefore the
hacking-exp and money channels; 18% of it is being given away now and the
fraction grows with every doubling.

## 13. The check that is supposed to prove `go-cheat.js` is Source-File-gated cannot see the file at all. (from the test-suite sweep; confidence: high)

`tools/test/sfgate.test.mjs` [SF3] is the assertion behind invariant B4. Two
independent defects disarm it:

* `sfgate.test.mjs:266` builds its "exempt because a gated caller execs it by
  name" allow-list by regexing `codeOnly(caller)` for `['"][\w.-]+\.js['"]` — but
  `codeOnly()` (`tools/test/ram.mjs:200-206`) has already replaced every string
  literal with the two characters `""`. The regex matches **zero** times against
  stripped source, always. This is the exemption-that-never-matches shape
  CLAUDE.md:268 already names — still present in the code, not merely historical.
* Independently, the family pattern at `sfgate.test.mjs:48`, `ns: /^go\.cheat\./`,
  can never match: the game's RAM calculator records the entry as
  `cheat.playTwoMoves`, not `go.cheat.playTwoMoves`.

Net: `go-cheat.js` appears in SF3's output as neither PASS, WARN, nor FAIL. It is
invisible to the check, so B4 is asserted by a check that cannot fail for the one
file it exists for.

## 14. Other items confirmed by the parallel sweeps

* `nfg.js:214-216` sizes donations assuming `faction_rep >= 1` is a sufficient
  safety margin. With `FactionWorkRepGain = 0.75` in BN4 the true break-even is
  `faction_rep = 1/0.75 = 1.33`, so the "margin" is thin and unmeasured. `[A1]`
  in `npm test` flags the same line. Live telemetry currently shows ~18% surplus,
  so it is not biting today.
* `watchdog.js` cites "`lock.js:40 (STALE_MS)`" — no such identifier or line;
  the real constant is `STALE_LEGACY_MS` at lock.js:139. The values agree
  (300000) by coincidence, not through a working reference.
* `bitNodeMultipliers.js`'s fallback table omits 14 of the game's 54 keys
  (including `CloudServerSoftcap` and `WorldDaemonDifficulty`). No live script
  currently reads a missing key through that module, so this is latent — but it
  is the same defaults-table shape as the documented `PurchasedServerCost` ->
  `CloudServerCost` rename.
* `go.js` hardcodes the IPvGO effect formula (`* 0.002 * 1.1`) with no `GoPower`
  term. `GoPower = 1` in BN4, so harmless here; 4x wrong in BN14.
* `npm test`: 55 declared checks, 55 executed, 6 FAIL — all `[B2]`. The claim
  that all six are the virgin-8GB case is not quite right: four are at 8GB, two
  at 32GB (SF1-owned, which is this save's actual entry tier). Same root cause:
  `boot.js`'s STACK is an untiered flat list; the fix is staged under
  `tools/staging/boot/` and `[B7]` WARNs loudly that it is not deployed.
* `ramoverride.test.mjs` [R5] is fixed — it now checks `raiseCovers(root.concat(staged))`
  (line 277/499). `placement.test.mjs` [B5] is fixed too (imports the root
  `batch.js` via a `file:`-URL specifier rewrite). Both historical defects from
  the brief are closed.
* `docs/invariants.md` has 32 entries (A1-15, B1-6, C1-7, D1-4), not 30. Only B4
  is compromised, for the reason in #13.
