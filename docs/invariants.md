# Invariants — the things that must not silently become false

Every entry here was learned by being wrong about it, usually expensively. The
point of the list is that each one is **checkable**, and `npm test` is where it
gets checked. Prose in CLAUDE.md did not stop any of these from happening twice.

Format: the property, where it came from, and what going wrong looks like.
"Silent" is noted where it applies, because the silent ones are the reason the
suite exists — a loud failure gets fixed the day it happens.

---

## A. Formulas must match the game's source

The game is at `~/Repos/bitburner` and is the authority. A constant copied into
a script is a fork, and forks drift.

| # | property | source | if wrong |
| --- | --- | --- | --- |
| A1 | `repFromDonation = amt/1e6 * faction_rep * FactionWorkRepGain` — **three** factors | `Faction/formulas/donation.ts:8` | Under-donates in any node where the third factor < 1. Was stated with two factors in CLAUDE.md, docs and nfg.js. **Silent.** |
| A2 | `favorNeededToDonate() = floor(150 * FavorToDonateToFaction)` | `donation.ts:17` | 150 hardcoded in nfg.js. BN3 is 75, BN8 is 0 — we would wait for favor we did not need. |
| A3 | `repToFavor(r) = ln(1+r/25000)/ln(1.02)`, so `favorToRep(150) = 462,490` | `Faction/formulas/favor.ts:12` | The entire "bank favor before installing" endgame is sized off this. |
| A4 | NeuroFlux cost = `base * 1.14^level * 1.9^queued`, queued counting NFG itself | `AugmentationHelpers.ts:127-160` (`getAugCost`) + `Augmentation.ts:238-246` (`getLevel`, where 'counts itself' lives) | Mis-sizes the NFG wall (~12 levels) and the pre-install buy order. |
| A5 | Augmentation money cost ×1.9 per queued non-SoA aug; **reputation cost does not scale**. The 1.9 is SF11-level-0 only — the ladder is `[1, 0.96, 0.94, 0.93]` (`AugmentationHelpers.ts:30`) | `AugmentationHelpers.ts:29-36` | Buying cheapest-first costs strictly more. |
| A6 | Home RAM/cores upgrade costs (`homecost.js`) | `PlayerObjectServerMethods.ts:30,42` | homeup mis-reports affordability; caps are 2^30 GB and 8 cores. |
| A7 | `getHackingWorkRepGain` is linear in hacking level, `faction_rep`, `(1+favor/100)`, the share bonus, **`currentNodeMults.FactionWorkRepGain`** (`reputation.ts:13`) and `calculateIntelligenceBonus(int,1)`; the numerator also carries `int/3` and an SF15≥3 charisma term | `PersonObjects/formulas/reputation.ts:13,16` | Every grind estimate. Model was once 2.7× off here. The node factor and intelligence are both identity in BN1 with no SF5, which is why this row was written without them — the identical mechanism as A1. |
| A8 | `w0r1d_d43m0n` needs `3000 * WorldDaemonDifficulty` | `Server/data/servers.ts:1553` | The endgame gate. 9000 in BN4, 15000 in BN2. |
| A9 | Go `getDifficultyMultiplier = (komi+0.5)*0.25`, **independent of board size** except 5×5-vs-Illuminati | `Go/effects/effect.ts:132-135` | Board-size choice. 13×13 costs 71%. |
| A10 | Go winstreak caps at ×3 at 8 wins; negative streak is ×0.5; **breaking a dry streak pays `1 + 0.5·min(dryStreak,8)`, up to ×5** — above the cap | `Go/effects/effect.ts:119-130` | Node power rate. The ×5 branch is why the multiplier is path-dependent and has to be played out rather than derived from a win rate. |
| A11 | Go cheat access = `sf14 > 1 \|\| (sf14 === 1 && bitNodeN === 14)` | `netscriptGoImplementation.ts:488` | **Silent.** Capability exists and is never used. |
| A12 | Home RAM at node entry: 128 (SF9≥2) / 32 (SF1>0) / 8 | `Prestige.ts:242-248` | The bootstrap budget. We have never run at 8. |
| A13 | Singularity RAM ×16/×4/×1 by SF4 level, **full price inside BN4** | `RamCostGenerator.ts:82-96` | Budgets wrong by up to 16×. |
| A14 | `prestigeHomeComputer` preserves `maxRam`/`cpuCores`, clears `serversOnNetwork`, and does **not** clear text files (`Server/ServerHelpers.ts:226-239`). Money is reset **elsewhere**, by `Player.prestigeAugmentation` to `1000 + CONSTANTS.Donations` = **$1,262** (`PlayerObjectGeneralMethods.ts:102`), then increased by each owned aug's `startingMoney` (`Prestige.ts:85-88`) | two files, not one | Spend-before-install; stale lock/busy files carrying over. The '$1m' this row used to claim is CashRoot Starter Kit only — BN4 opened on $1,262. |
| A15 | `prestigeAugmentation` sets favor from rep, then zeroes rep and `isMember` | `Faction/Faction.ts:79-83` | Install ordering. Rep earned then installed is gone. |

## B. RAM

| # | property | if wrong |
| --- | --- | --- |
| B1 | No identifier — **including local variables** — collides with a name in the ns cost tree | `attempt` cost 10GB, `probe` 0.2GB, `grow`/`share` also hit. **Silent.** The checker prices every bare Identifier by name (`Script/RamCalculations.ts:407`) and walks MemberExpression properties too. |
| B2 | The bootstrap set fits in `homeStartRam` for every SF tier, with room to run a worker | At 8GB today: batch.js 11.2, go.js 20.3, cmd.js 8.15 all unrunnable; boot.js 7.9 leaves 0.1GB. |
| B3 | Any offline RAM calculator reproduces the game's `calculateRam` exactly | An unvalidated calculator is fabricated validation — this repo has shipped that twice. |
| B4 | A Source-File-gated API is isolated in its own script, not referenced from a hot one | Referenced-but-unreachable calls are still billed, in every BitNode. |
| B5 | A planned allocation is placeable on a **single host**, not merely affordable against the fleet total | `ns.exec` cannot spread one op's threads. batch.js sizes against `totalRam` (batch.js:841-842, and `totalRam` sums **maxRam**, :573) then places into **free** blocks (:581). Observed 2026-09-13 on a 148GB opening fleet: plan `h=11` = 18.7GB contiguous, largest free block 16GB → `placeFails 7274, batches 0, $0.00 over 27 minutes`. **Silent** — it reported `health: stalled` and never threw. boot.js already applies the right rule to share.js ("a fraction of the largest free block, not of the fleet"); batch.js does not. Root cause: `planBatch` returns `best ?? build(1)` (batch.js:381), so when nothing fits the budget it returns a plan that ignores the budget rather than `null`. |
| B8 | "Could not determine" must never be collapsed into a permissive value | A reader that turns an unreadable input into `0`, `true` or "no constraint" converts every failure into permission. `budget.js`'s `augClaim` returns `null` for unknown and a number (including **0**) for known — and `augClaim(...) ?? 0` at a call site defeats the whole module. That coercion was written at TWO call sites within minutes of the module landing, and every unit test stayed green, because a property asserted only inside the thing it protects is not asserted at all. Corollary: **absence is never a signal.** `progress.js` publishes `planned: false` on every pass, so a missing file means the publisher is dead rather than "nothing to do". Asserted by [BU2] (the module blocks) and [BU6] (no caller bypasses it, verified by reintroducing the bug). **Silent.** |
| B6 | Script RAM is not one number — it is a function of BitNode and SF4 level | Singularity costs ×16/×4/×1 (`RamCostGenerator.ts:82-96`). `progress.js` is 41.45GB inside BN4 and 627.95GB at SF4.1 elsewhere; `autobuy.js` is 5.85 → 65.85GB and is in the watchdog stack. Every figure in `docs/autonomy.md` is the BN4 price. |

## C. Structure and lifecycle

| # | property | if wrong |
| --- | --- | --- |
| C1 | Every script publishes status on **every** exit path: return, handled error, throw, and kill (`ns.atExit`) | Five scripts wrote nothing on error for most of BN1. A dead script is indistinguishable from an idle one. **Silent.** |
| C2 | A script holding the UI lock releases it on every path including kill | A leaked lock cost ~3h of degraded work; it also survives an install (A14). |
| C3 | Watchdog: a false predicate **never launches**; it kills only for daemons, never for jobs | One overloaded boolean launched nfg/homeup every 30s regardless of their trigger. |
| C4 | No circular gate: a predicate must not depend on telemetry written only by the thing it gates | homeup published `nextCost: null` meaning "maxed" when it meant "could not read", and froze itself. **Silent.** |
| C5 | Constants that depend on a BitNode multiplier are registered in `bncheck.mjs` ASSUMPTIONS | Arriving in a new node becomes a debugging session instead of a checklist. |
| C6 | Any model whose output drives a decision reproduces a live quantity and prints the error | Caught a 2.7× scale error and a +38.5% throughput error that formulas alone did not. |
| C7 | Callers of the cmd bridge wait on `in.txt` **or** `busy.txt`, never `busy.txt` alone | Returns the previous batch's complete, well-formed JSON with nothing marking it stale. **Silent.** |

## D. Repo hygiene

| # | property | if wrong |
| --- | --- | --- |
| D1 | `SKIP_DIRS` is identical in `tools/rfa-daemon.mjs` and `tools/verify-deploy.mjs` | Verify a different set than gets pushed, and report all-clear on a file nobody deploys. |
| D2 | No source file contains a raw NUL or other byte that makes `grep` treat it as binary | `grep` returns "no matches" rather than "I refused to look". **Silent.** |
| D3 | Nothing in `.variants/` is ever pushed to the game | Two copies of the same logic live — the stale-instance trap that derailed two debugging sessions. |
| D4 | Root `.js` deployed == root `.js` on disk | The auto-push has silently dropped edits; `npm run verify` is the check. |
