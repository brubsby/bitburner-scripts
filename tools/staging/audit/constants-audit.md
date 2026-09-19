# Constants audit — hardcoded disagreements, drift, and BN1-vs-BN4 landmines

Scope: boot.js STACK + watchdog.js WATCHED (the live BN4 stack), plus
bitNodeMultipliers.js and the RAM figures the RFA control port can check.
Read-only. Game source cited from `~/Repos/bitburner`.

Live stack confirmed by reading both files directly:

- **boot.js STACK**: batch.js, cmd.js, ctauto.js, tel.js, watchdog.js, upkeep.js,
  backdoor.js, torbuy.js, settings.js, go.js, buyserv.js, share.js
- **watchdog.js WATCHED**: batch.js, cmd.js, ctauto.js, tel.js, upkeep.js,
  backdoor.js, torbuy.js, go.js, share.js, buyserv.js, autobuy.js, progress.js,
  faction.js, endgame.js, nfg.js, homeup.js

Live telemetry at time of audit (2026-09-14): BitNode 4, watchdog cycle 38,
all daemons `running` except torbuy.js (`stopped: invariant false`, TOR
already owned) — health "ok". `npm test` was also run (read-only, no game
interaction) for cross-checks; 55 checks, 6 FAIL (all under the *staged*,
undeployed `[B2]`/`[B7]` bootstrap in `tools/staging/boot/`, not the live
root scripts), 18 WARN. Several WARNs below are lifted directly from that
run because they are exactly this audit's target (constants that drifted).

---

## RANKED FINDINGS

### 1. [LIVE, CONFIRMED] `shareThreads` — boot.js's copy is stale against watchdog.js's fixed copy

- **boot.js:106-121** (`function shareThreads(ns, frac = 0.8)`): floor is
  `Math.max(600, Math.min(250000, Math.floor((biggest * frac) / perThread)))`
  — i.e. **always asks for at least 600 threads** (2,400GB at 4GB/thread,
  confirmed via `calculateRam` on `share.js` = 4GB) **on a single host**.
- **watchdog.js:560-572** (same function name, same signature shape): rewritten
  09-13 to `MIN_USEFUL = 32` and **returns 0** ("do not launch") if the biggest
  free block can't even fit 32 threads, capped at 250,000 — no floor above what
  fits.
- watchdog.js's own header (lines 540-558) documents exactly why: the 600
  floor "was survivable while the BitNode-1 fleet was enormous; after an
  install the fleet is ~1.5TB... the request could never be satisfied and the
  watchdog reported `blocked: no host with room` forever." **boot.js was never
  updated to match** — it still carries the pre-fix version verbatim, including
  the stale doc comment above it (boot.js:88-104) that still argues for 600
  vs 2040 as if that were the current logic.
- **Currency**: boot.js only runs at `run boot.js`, i.e. once per session start
  and once by hand after every augmentation install (mandatory per this repo's
  own install procedure). The live cloud fleet right now is ~2,124GB across 50
  hosts (`/tel/batch.txt`), so a 2,400GB single-host ask cannot be satisfied by
  the cloud fleet alone — but home is 16,384GB (`/tel` / test `[A14]`) and
  boot.js's `placeOn()` falls back to home when no cloud host fits, so it is an
  **open question** whether the next boot actually fails to place share.js or
  merely piles it onto home instead of the cloud fleet. What is *not* open: the
  two functions disagree, and boot.js's own header names the exact incident
  this caused before ("Booting it unconditionally burned 2040 threads x 4GB =
  8.16TB... for the entire post-install stretch") — the fix for that landed in
  watchdog.js only.
- **Fix shape** (not applied, audit is read-only): boot.js's `shareThreads`
  should be deleted and the entry should call the same function watchdog.js
  uses, or the two should import a shared implementation.

### 2. [LATENT, mostly] nfg.js / homeup.js reserve: three-way and two-way drift between script default and supervisor arg

- **nfg.js:77** `['reserve', 2e12]` (internal default) vs **watchdog.js:163,409**
  `NFG_RESERVE = 5e11` passed as `--reserve` — a **4x** disagreement. Also
  **nfg.js:4** header example `run nfg.js --reserve 5e12` (yet a third figure,
  10x the default, just an example — not itself a bug, but three different
  numbers now live in one small area of the system: 5e12 (example), 2e12
  (default), 5e11 (what actually runs)).
- **homeup.js:83-84** `['reserve', 1e12]` (internal default) vs
  **watchdog.js:462** `args: ['--reserve', 2e12]` — a **2x** disagreement.
- **Currency**: LATENT for both. Neither script is in boot.js's STACK — both
  are launched only through watchdog.js's WATCHED list, which **always** passes
  an explicit `--reserve`, so the internal default is never reached by the
  supervised path. It only matters if a human runs `run nfg.js` or
  `run homeup.js` bare from the terminal (which this repo's own docs say does
  happen — "the game-player... run and retarget scripts"), in which case the
  manually-launched instance would hold back a different amount of money than
  the automated one does, silently. This is exactly the shape boot.js's own
  comment warns about for buyserv.js ("an explicit figure here overrides the
  reserve... and a figure that was right for one life is wrong for the next")
  but the fix (deriving the reserve from game state, as buyserv.js now does)
  was not applied to nfg.js or homeup.js's *defaults* — only to what the
  watchdog passes.

### 3. [LIVE, confirmed by `npm test` [A1]] nfg.js's donation formula ignores `FactionWorkRepGain`, and the safety margin it relies on is razor-thin in BN4

- **nfg.js:214-216**:
  ```js
  // faction_rep >= 1 always, so this is an upper bound on what is needed.
  const cost = shortfall * 1e6
  ```
  This inverts `repFromDonation(amt) = amt/1e6 * faction_rep * FactionWorkRepGain`
  (donation.ts:8, confirmed by `npm test` [A1]) assuming the *product*
  `faction_rep * FactionWorkRepGain >= 1`. `FactionWorkRepGain = 0.75` in BN4
  (BitNode.tsx:645, confirmed by `bncheck.mjs` and `npm test` [A1]/[A7]).
  nfg.js's own header (lines 27-30) says this is deliberate, banking on the
  player's `faction_rep` multiplier being ~1.33 from the Go IPvGO bonus to
  offset the 0.75.
- CLAUDE.md itself already flags this as a live risk: "at BN4's 0.75 a
  `faction_rep` of 1.33 makes the safety margin a **0.25% shortfall**... Measure
  the rate, do not assume it." **nfg.js does not measure it** — there is no
  read of `ns.getPlayer().mults.faction_rep` or any bounded probe anywhere in
  the file; it is a static assumption.
- `npm test` [A1] independently confirms this exact gap today (WARN, not
  FAIL): "the bound holds only while `FactionWorkRepGain >= 1/faction_rep`"
  flagged against nfg.js:214, and also against three stale copies under
  `tools/staging/` carrying the identical comment.
- **Currency**: checked against live telemetry (`/tel/nfg.txt`): currently
  `haveRep 171,445,000` vs `needRep 145,156,000` for the level nfg.js is
  stalled on — a healthy ~18% surplus, not the ~0.25% margin CLAUDE.md warns
  is possible. So **this is not biting right now**, but the code has no guard
  against the Go bonus (which fluctuates — go.js's own header says the bonus
  "simply stops growing" if go.js dies) dropping the effective `faction_rep`
  below 1.333, at which point nfg.js would silently under-donate and loop
  (bounded by `JOB_MIN_INTERVAL` = 5 min) forever without ever affording the
  level, with no error — exactly the silent-failure shape this repo's CLAUDE.md
  says is the most expensive bug class it has had.

### 4. [DOC DRIFT, values currently agree] watchdog.js cites a nonexistent constant name/line in lock.js

- **watchdog.js:132-133**: "The number is 300000ms, taken from lock.js:40
  (`STALE_MS`) rather than chosen."
- **lock.js** has no identifier `STALE_MS` anywhere (grep confirms). The
  relevant constant is **`STALE_LEGACY_MS = 300000`**, declared at
  **lock.js:139**, not line 40 (line 40 is a comment about `ns.isRunning`).
  There is also **`STALE_HUNG_MS = 1800000`** at lock.js:136.
- **Currency**: the *value* watchdog.js uses (`JOB_MIN_INTERVAL = 300000`,
  watchdog.js:153) does still match `STALE_LEGACY_MS`'s current value, so
  nothing is broken today. But the citation is broken on both axes (name and
  line), so if `STALE_LEGACY_MS` is ever tuned, nobody following this comment
  back to lock.js would find it — the two numbers would silently diverge with
  a comment that looks like it still proves they can't.

### 5. [LATENT / registration drift] bncheck.mjs's own ASSUMPTIONS table cites code locations that have moved

Found via `npm test` → `[C5]` (WARN), independent of anything I derived by hand:

- `[cloud-cost]` says `CloudServerCost` lives in **buyserv.js**, citing
  `55000` — buyserv.js no longer contains that literal on a relevant line (it
  now prices through `ns.cloud.getServerCost`/`getServerUpgradeCost` live).
- `[faction-rep]` says `FactionWorkRepGain` lives in **share.js**, citing
  `1000000` — share.js no longer contains that literal.
- `[go-power]` says `GoPower` lives in **golib.js**, citing `0.002` — golib.js
  no longer contains it (the `0.002` constant is now only in **go.js:19**,
  itself missing the `GoPower` multiplier entirely, see finding 7).
- Also: `WorldDaemonDifficulty` is used correctly (endgame.js reads the live
  server value, not a hardcoded 9000) but has **no formal ASSUMPTIONS entry**
  in bncheck.mjs at all, despite differing by BitNode (1 in BN1, 3 in BN4, 5 in
  BN2) and appearing as a literal in 9 repo files.
- **Currency**: none of these change program behavior — they are the
  self-check's own bookkeeping going stale, which is precisely the "registered
  as checked, no longer true" trap CLAUDE.md warns about generally. Worth
  fixing because a stale citation reads as "verified" when it no longer is.

### 6. [LATENT] bitNodeMultipliers.js's fallback table is missing 14 of 54 real keys

`~/Repos/bitburner/src/BitNode/BitNodeMultipliers.ts` declares 54 members.
`bitNodeMultipliers.js`'s `defaultBitNodeMultipliers` (already patched
2026-09-13 for the known v1-name and `DaedalusAugsRequirement` bugs per its own
header) carries only 40. Missing entirely — a lookup of any of these through
`readBitNodeMults()` silently returns `undefined`, not 1:

```
CompanyWorkRepGain, CorporationDivisions, CorporationSoftcap, CrimeSuccessRate,
DarknetLabyrinthRewardsTheRedPill, DarknetMoneyMultiplier, GangSoftcap,
GangUniqueAugs, GoPower, HackingSpeedMultiplier, CloudServerSoftcap,
StaneksGiftPowerMultiplier, StaneksGiftExtraSize, WorldDaemonDifficulty
```

- **Currency**: checked every root-script importer of `bitNodeMultipliers.js`
  (`readBitNodeMults`): only **faction.js** (`DaedalusAugsRequirement`, present
  and correct at 30), **infiltration.js** (`InfiltrationRep`/`InfiltrationMoney`,
  both present, both dormant — not in STACK/WATCHED), and **bladeburner.js**
  (imports it but does not read any key from it, only discusses RAM cost in a
  comment; also not in STACK/WATCHED). **No live script reads any of the 14
  missing keys through this table today** — `go.js` hardcodes its own `0.002`
  constant directly (see finding 7) rather than going through this module, and
  `buyserv.js` never references `CloudServerSoftcap` at all (it prices live).
  So this is a real gap, but fully latent: nothing breaks until some future
  script adds a `readBitNodeMults().GoPower`-style lookup and gets `undefined`
  instead of a loud error.

### 7. [LATENT in BN4, live formula gap] go.js hardcodes the IPvGO effect formula without `GoPower`

- **go.js:19** (comment, restated as code further down):
  `effect = 1 + ln(n+1) * (n+1)^0.3 * 0.002 * 1.1` — no `GoPower` term.
- Real formula, **effect.ts:20**:
  `1 + Math.log(nodes+1) * Math.pow(nodes+1, 0.3) * 0.002 * power * currentNodeMults.GoPower * sourceFileBonus`.
- `GoPower` is 1 in BN4 (not listed in `BitNode.tsx` case 4, defaults to 1) and
  4 in BN14 (`BitNode.tsx:1040`, confirmed by `npm test`'s citation of
  `effect.ts:20`). **Currency: not costing anything in BN4 today** (the missing
  factor is 1 here), but it is a literal BN1/BN4-shaped hardcode that would be
  4x wrong if this stack were ever used inside BitNode 14, and boot.js's own
  header explicitly frames go.js as the reputation-multiplier engine for the
  rest of the run ("Farms IPvGO node power vs Daedalus -> faction_rep
  multiplier on every rep stream"), so a silent 4x-under-count the day this
  code runs in BN14 fits the exact failure shape this repo's CLAUDE.md warns
  about ("True here, false elsewhere").

### 8. [LATENT, BN4 unaffected] homecost.js omits `HomeComputerRamCost`

Found via `npm test` → `[A6]`: "HomeComputerRamCost is not read by homecost.js:
at 1.5 the 16TB upgrade is $4.752e+11 vs our $3.168e+11." `homecost.js` is the
pure-arithmetic module `homeup.js` (live, WATCHED) uses to price the next RAM
upgrade, and it never multiplies by `currentNodeMults.HomeComputerRamCost`
(`PlayerObjectServerMethods.ts:38`). `HomeComputerRamCost` is not set for BN4
in `BitNode.tsx` (defaults to 1), so **this is not costing anything in the
current life** — but the day a BitNode that does set it is entered,
`homeup.js`'s trigger (`watchdog.js:473-476`, comparing money to
`next.cost + 2e12`) would silently use the wrong price, either buying early or
refusing to buy when affordable, with no error.

### 9. [Confirmed correct / not a bug — sanity check] TOR_COST

`torbuy.js:36` and `autobuy.js:50` both hardcode `TOR_COST = 200e3`, agreeing
with each other and with the game's `CONSTANTS.TorRouterCost = 200e3`
(`~/Repos/bitburner/src/Constants.ts:44`). No BitNodeMultiplier applies to it.
Checked because it's a duplicated literal across two files (the shape this
audit was looking for) — this one is fine.

### 10. [Investigated, NOT a bug] `ScriptHackMoney = 0.2` in BN4 — looks severe in `bncheck.mjs`, is actually live-mitigated

`bncheck.mjs`'s automated severity ranking puts this at the top (severity
6.97, "the run stops working") because `batch.js`'s raw `hackFraction` formula
doesn't apply `currentNodeMults.ScriptHackMoney` (Hacking.ts:54, = 0.2 in BN4).
**But** `batch.js` has a live self-calibration system (documented at length in
its own header, `batch.js:274-374`) that measures the discrepancy at runtime
and corrects for it. Confirmed against live telemetry (`/tel/batch.txt`):
`calibration.verdict: "ok"`, `y: 0.2` (exactly matching `ScriptHackMoney`),
`applied: "t.phi = phi_model * 0.2"`, spread 0 over 128 samples. **This is not
presently a live bug** — flagging only because a naive reading of
`bncheck.mjs`'s severity ranking would misidentify it as the worst issue in
the stack, when the actual worst-ranked *structural* assumption
(`CloudServerSoftcap`, sev 0.79, see below) is a real live discrepancy that
bncheck ranks *lower* only because its formula weighting doesn't know about
batch.js's calibration safety net for the other one.

### 11. [Already known/tracked, confirmed still live] buyserv.js's fleet-shape reasoning assumes BN1-linear cloud pricing

`CloudServerSoftcap = 1.2` in BN4 (`BitNode.tsx:632`), not 1. `buyserv.js`'s
header (lines 14-20) and its "concentrate, do not level" policy (lines
164-179) are justified by "no volume discount... waiting to afford a bigger
server is never cheaper" — true only at `CloudServerSoftcap = 1`. At 1.2,
`getCloudServerCost` (`ServerPurchases.ts:22-41`) is
`ram * base * CloudServerCost * CloudServerSoftcap^max(0, log2(ram)-6)`, so
concentrating RAM into one huge server now costs a real, compounding premium
per doubling above 64GB that a level fleet would not pay. `buyserv.js` does
not hardcode the wrong price (it calls `ns.cloud.getServerUpgradeCost` live,
so it never overpays) — it hardcodes the wrong **shape of policy**. This is
already tracked in this repo's own `tools/sim/bncheck.mjs` ASSUMPTIONS table
(`linear-cloud-pricing`, impact 3) and confirmed still present by both my
reading and `node tools/sim/bncheck.mjs 4`. Not new, but worth restating here
because it is the one live, currently-in-effect BN1-vs-BN4 constant mismatch
in the whole stack that actually changes buying behavior today (every
`buyserv.js` tick, 15s cadence).

---

## RAM figures (item 4)

`calculateRam` via the RFA control port turned out to report **the script's
declared `ns.ramOverride()` floor**, not the full reachable-code static price,
for every script that calls `ns.ramOverride` as its first statement
(confirmed: `progress.js` → 2.6, matching its literal `ns.ramOverride(2.6)`;
`endgame.js` → 3.2, matching its literal `ns.ramOverride(3.2)`; `faction.js` →
2.6, same pattern). So it cannot be used to independently verify whether a
`RAISE_CEILING(mult)` constant reaches the script's true full price — that
check already exists in this repo as `tools/test/ramoverride.test.mjs`
[R1]-[R5], which I ran via `npm test`: **all five pass**, including [R5]
("a runtime `ns.ramOverride` raise reaches the script's full static price in
every regime"). `progress.js`'s own header documents a real past instance of
exactly this failure mode (shipped ceiling 39.7/mult against a true 44.7/mult
requirement, silently denying the raise) — already fixed to 49.7, and the
passing test suite is current evidence it's still correct.

For scripts with no override, `calculateRam` gave a straight answer, and
`watchdog.js`'s own in-comment claim (7.80 -> 7.90GB, watchdog.js:225-226) was
verified exactly: **7.9GB**, matching. No stated-vs-real RAM mismatches found
among batch.js (8.8GB), buyserv.js (6.5GB), homeup.js (4.45GB), nfg.js (2.4GB),
share.js (4GB) against any comment claiming a different figure.

No `ns.ramOverride` literal or `RAISE_CEILING` value was found *below* the
script's real static cost in the current code (that class of bug already
happened once, in progress.js, and is now caught by CI-style tests + fixed).

---

## Duplicated logic inventory (item 2)

| Function name | Files | Same logic? |
|---|---|---|
| `shareThreads` | boot.js:106, watchdog.js:560 | **NO — see finding 1.** Confirmed drift, live. |
| `scanAll` | boot.js:122, watchdog.js:574, ctscan.js:17, batch.js:221 | boot.js/watchdog.js versions are textually identical (BFS `ns.scan`); ctscan.js/batch.js are separate standalone tools, not compared for drift here (out of the live-stack scope) but same name across 4 files is itself worth a rename pass. |
| `RAISE_CEILING` | endgame.js:104, training.js:108, sleeve.js:117, progress.js:141, bladeburner.js:167, faction.js (`5.2 + 21*mult`), crime.js, healer.js, createProgram.js | **Not a bug by itself** — each is a per-file hand-measured constant (own base cost + own singularity surface), not one shared formula that drifted. Only progress.js, endgame.js, faction.js are in the live WATCHED list; the rest (training.js, sleeve.js, bladeburner.js, crime.js, healer.js, createProgram.js) are dormant — no SF4 owned this life, per boot.js/watchdog.js membership. All three live ones pass `ramoverride.test.mjs` [R5] today. |
| `reserveNow` / `reserveFor` | buyserv.js:83 and :107 | Two near-identical functions in the *same* file, both reading the same `SETTINGS.programs` list and returning the same thing — dead duplication, not a drift risk (they agree today because they're nearly copy-pasted), but pure redundancy worth collapsing. |

---

## What's already fixed and should NOT be re-reported as new

- `nfg.js` $5e12-vs-$5e11 (the audit prompt's own example): the *default* in
  nfg.js today is `2e12`, not `5e12` — someone already moved it partway. The
  remaining disagreement is `2e12` (default) vs `5e11` (watchdog-launched),
  see finding 2, and it's latent, not a 10x live problem.
- `shareThreads` 600-floor: watchdog.js's copy was already fixed 2026-09-13
  (`MIN_USEFUL = 32`). **boot.js's copy was not** — see finding 1. So the
  audit prompt's example is *half* fixed.
- The v1-era `PurchasedServerCost`/`RepToDonateToFaction`/
  `GangKarmaRequirement` key-renames in bitNodeMultipliers.js: already fixed
  2026-09-13 per that file's own header. `pserv.js` (which used the old names)
  is superseded by `buyserv.js` and not in the boot stack, per bncheck.mjs's
  own note.
