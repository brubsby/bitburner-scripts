# Game knowledge, mined from the script corpus and re-checked against source

Every item below was cross-checked against `~/Repos/bitburner` (v3.0.2) during the
2026-09-13 triage. Items are marked **VERIFIED** (with file:line) or **STALE**
(what the script believes, and what the game now does).

A STALE fact recorded as true is worse than a lost one — most of this corpus was
written against Bitburner v1 and a lot of it silently no longer holds.

Things already in CLAUDE.md are cross-referenced, not repeated.

---

## 1. LIVE BUGS found during the triage

Ordered by blast radius.

### git.js ignores its own `--no-clobber` and defaults to a stranger's repo
`git.js:38` passes the flag commented out — `readDirectory(ns, url /*, flags["no-clobber"]*/)` — so `noClobber` is always `undefined` and the guard at `:11-13` never fires. Defaults are `username: "brubsby"`. Running it overwrites every root `.js` with a third party's copy, and the daemon hot-deploys the result into the live game within 150ms. **Highest blast radius in the repo.** Archive it; the RFA daemon is the deploy path now.

### progress.js reads three fields `ns.getPlayer()` does not return
`getPlayer()` returns exactly 13 fields (`NetscriptFunctions.ts:1371-1390`). It does **not** return `factionInvitations`, `currentWork`, or `focus`.
- `:80` — without SF4, `player.factionInvitations ?? []` is **always `[]`**, so its headline feature (telling a human which invites to accept) never emits a line, in exactly the BitNode where only a human can accept them.
- `:98` — `player.currentWork` is always `undefined`, so `:102` always fires *"NO FACTION WORK RUNNING — reputation is earning ZERO"*, including while focused faction work runs normally. A false alarm that cannot be switched off.
- `:110` — `else if (player.focus === false)` is **unreachable** (`undefined !== false`, and it is the `else` of a branch that always takes the other arm).

Correct sources are `singularity.getCurrentWork()` (0.5GB) and `singularity.isFocused()` (0.1GB), both SF4-only. There is **no ungated NS read** of invitations, current work, or focus — which is why `upkeep.js` reads the DOM, and why it is right to.

### bashrc.js cannot work at all
`bashrc.js:4-5` targets `terminal-input-text-box`; the element id is **`terminal-input`** (`TerminalInput.tsx:450`) and the old id appears nowhere in `src/`, so it throws `TypeError: null.value`. Even corrected, setting `.value` does not update React state and the Enter handler is `onKeyDown` **on the input**, not a document listener — a document-level synthetic event never reaches it. This is exactly the v1 pattern `cmd.js` was written to replace. All 23 aliased scripts still exist, so it is worth porting onto cmd.js's submit path rather than deleting.

### nfg.js hardcodes `MIN_FAVOR = 150`
`ns.getFavorToDonate()` costs **0.1GB**, needs no Source-File, and returns `floor(BaseFavorToDonate * FavorToDonateToFaction)` (`NetscriptFunctions.ts:1368-1370`). Hardcoding refuses at 75 favor in BN3 and at 0 favor in BN8, where donations are free. Invariant A2, unfixed in the shipped file.

### nfg.js's faction-name regex is a fixed seven-faction list
`nfg.js:159` matches only BitRunners / The Black Hand / NiteSec / Sector-12 / CyberSec / Netburners / Tian Di Hui. **Daedalus — the endgame faction — resolves to `'?'`**, so `--faction Daedalus` can never select it. `augbuy.js:156-162` carries the full 28-name list; the two should share a module.

### faction.js: root is not backdoor
`faction.js:329` tests `ns.hasRootAccess(target)`; the game tests `backdoorInstalled` (`FactionJoinCondition.ts:43-53`). It will report CSEC/NiteSec/BlackHand/BitRunners joinable the moment you NUKE them. The home-RAM requirements it also carries (32/64/128GB) **no longer exist** — those factions are backdoor-only now.

### Other live defects
- `crime.js` — **all 12 crime names are invalid enum members** (`"shoplift"` vs `"Shoplift"`). `nsGetMember` is strict without `{fuzzy:true}`, so it throws on the first `getCrimeChance` call. Also under-counts karma: failure still awards `karma/4` (`CrimeWork.ts:77`), so expectation is `karma·(3·chance+1)/4`, not `karma·chance`.
- `training.js` — `"Study Computer Science"` and `"Data Strucures"` throw (members are `"Computer Science"`, `"Data Structures"`); **all four gym stats throw** (`GymType` is `"str"/"def"/"dex"/"agi"`). Gym base cost/exp are 2.67×/4× wrong (game: `money:-120, exp:1`, `ClassWork.tsx:54-73`).
- `healer.js` — `ns.getPlayer().hp < ns.getPlayer().max_hp` compares an object to `undefined`, always false. **Runs forever and never heals.** Correct test is `hp.current < hp.max`.
- `infiltration.js` — TypeError at `:315`; `damage < player.max_hp` is false for every location, so the sorted list is empty.
- `sleeve.js` — `js.sleeve` (not `ns.`) ReferenceError; `getSleeveStats`/`getInformation` removed in v2.2.0 (→ `getSleeve`); `getTask()` wrong arity.
- `bladeburner.js` — every action-type string invalid (`"contract"` vs `"Contracts"`); `currantAction` typo; **`getActionTime` returns ms, not seconds**, and the script multiplies by 1000 → sleeps 1000× too long; duplicate object key silently overrides Stealth Retirement Operation with wrong values.
- `stock.js` — **`Math.sgn` does not exist** (`:57`), called from `ns.print` on the first iteration, so it throws immediately. `unpurchasedStocks` is never cleared and grows ~33/cycle forever.
- `contract.js` — Generate IP Addresses has **no `difficulty`**, so `--print-expected` returns `NaN` throughout. Four other difficulties stale. Solves 16 of the game's 30 contract types.
- `pserv.js` — see §6; fails in the opposite direction to what was documented.

---

## 2. The single most useful discovery: `ns.ramOverride()`

**`ns.ramOverride(n)` costs 0GB** (`RamCostGenerator.ts:657`) and a **literal** argument is honoured *statically*: `RamCalculations.ts:383-401` matches a call whose callee is `ramOverride`, and if the literal is `>= 1.6` it **replaces the script's computed RAM cost outright**.

This is the sanctioned escape hatch for precisely the problem the `go.js`/`go-cheat.js` and `autobuy.js`/`autobuy-sing.js` splits exist to work around. A script can declare its own price and grow it at runtime. It is mentioned nowhere in CLAUDE.md, `invariants.md`, or any of the 19 script headers — and it may be a simpler answer than either the file split or the compiler.

## 3. Two RAM exemptions nobody had recorded

- **`Object.prototype` property names are free.** `RamCalculations.ts:346` collects `Object.getOwnPropertyNames(Object.prototype)` and `:408-410` returns early on them — so `toString`, `valueOf`, `constructor`, `hasOwnProperty`, `isPrototypeOf`, `__proto__` etc. never cost anything.
- **`localStorage` is free.** Only the exact identifiers `document` and `window` carry the 25GB `Dom` cost (`RamCalculations.ts:184-192`); `localStorage` is not in the cost tree. This is why this codebase uses localStorage as an IPC bus at all — and note `document` + `window` together is **50GB**, which is why `cmd.js` and `nfg.js` `eval` both.

---

## 4. Focus, and the augmentation that deletes half of upkeep.js

`CONSTANTS.BaseFocusBonus = 0.8` (`Constants.ts:87`) — **VERIFIED**.

**STALE omission:** `PlayerObjectGeneralMethods.ts:622-628` —
```ts
if (!this.hasAugmentation(AugmentationName.NeuroreceptorManager, true)) {
  focus = this.focus ? 1 : CONSTANTS.BaseFocusBonus;
}
```
**Owning the Neuroreceptor Management Implant makes unfocused work earn 100%.** It costs 0.75e5 rep / $5.5e8 (`Augmentations.ts:1230-1232`) — cheap. It makes `upkeep.js`'s refocus job a no-op *and* removes the correctness hazard behind half the UI-driving rules (the refocus dance in cmd.js/augbuy.js/nfg.js/settings.js/torbuy.js). A much better buy than the docs imply.

Applied at exactly six sites: `FactionWork.tsx:39,44`, `CompanyWork.tsx:37` (full-time only), `CrimeWork.ts:65` (**including karma**), `CreateProgramWork.ts:59`, `GraftingWork.tsx:41`. **Hacking and batching are unaffected.**

---

## 5. The anticheat boundary — one site the repo missed

CLAUDE.md's table re-verified line by line, all correct. **Missing ninth site: `Arcade/ui/BBCabinet.tsx:17`** (a `message`-event guard, not a click faucet). Also: `Casino/utils.ts`'s `trusted()` is imported by **CoinFlip, SlotMachine and Roulette**, not just Blackjack.

**The infiltration penalty is maximal and deliberate.** `InfiltrationRoot.tsx:75` calls `onFailure({automated:true})` and `Infiltration.ts:145-151` sets `damage = Player.hp.current` — a synthetic keypress kills you outright.

**SF4 dissolves the one hole.** `singularity.joinFaction` (`Singularity.ts:750-769`) has **no `isTrusted` check**. CLAUDE.md states "the one thing a life cannot automate is accepting faction invitations" absolutely; it is true only without SF4.

---

## 6. Purchased servers — fails opposite to what was documented

`pserv.js` reads `getBitNodeMultipliers().PurchasedServerCost`, the **v1** name. The game renamed it `CloudServerCost` (`BitNodeMultipliers.ts:131`, migration at `utils/APIBreaks/3.0.0.ts:461-464`).

- **Without SF5** the local defaults table supplies `PurchasedServerCost: 1` → factor 1, as CLAUDE.md records.
- **With SF5 it gets worse.** The real multiplier object is saved and has no such key → `55000 * undefined` = **`NaN`**, every affordability test is false, and **pserv.js silently buys nothing, forever.**

Also **STALE**: the real cost is `ram · 55000 · CloudServerCost · CloudServerSoftcap^max(0, log2(ram)−6)` (`ServerPurchases.ts:22-41`). **BN4 sets `CloudServerSoftcap = 1.2`**, so a 1TB server costs **12.8×** what the linear model thinks. And the destroy-and-rebuy upgrade loop is obsolete — `ns.cloud.upgradeServer()` charges only the difference.

`bitNodeMultipliers.js` also has 5 dead keys, 18 missing ones, and `DaedalusAugsRequirement: 1` where the game's default is **30** — and it is an absolute count, not a scale factor, so `faction.js:20`'s `30 * mult` yields **900** with SF5.

**It cost 4GB to every importer** because the *identifier* `getBitNodeMultipliers` collides with the 4GB ns call — and the charge landed on each importer's own source, not on the module. Measured after the fix:

```
bare script                            1.60GB
importing readBitNodeMults             1.60GB   <- the module contributes 0
a local named getBitNodeMultipliers    5.60GB   <- the 4GB was always the NAME
```

**Already recovered, 2026-09-13**: the export was renamed to `readBitNodeMults` and the three surviving importers updated — bladeburner 91.60 → 87.60, faction 29.20 → 25.20, infiltration 9.40 → 5.40, i.e. **12GB banked**. (`pserv.js` and `contract.js` were archived, so the "20GB across five importers" originally written here was never all available.) Nothing further is recoverable; a later reading that finds "importing this costs 0GB" is correct and is not a contradiction.

---

## 7. Contracts, factions, programs — corrected constants

**Contracts.** Reward constants (2500 / 4000 / 75e6) **VERIFIED** (`Constants.ts:91-93`), and the `/3` is real: `adjustedScaling = rewardScaling/3` (`PlayerObjectGeneralMethods.ts:510`). **A difficulty-1 contract pays exactly $25m in BN4.** The reward-type probability model in `contract.js:461-497` is **fiction** — the game picks uniformly among 4 types with no reference to player state (`ContractGenerator.ts:186-196`). Naturally-spawned contracts are difficulty-capped at `2·(sum of SF levels)+1` (`:82-86`), so **with no Source-Files only difficulty-1 contracts spawn** — all already solvable.

**Factions.** Megacorp factions need **400e3** rep (`CONSTANTS.CorpFactionRepRequirement`), not the 200e3/250e3 the script carries — but a backdoor on the company's server multiplies the requirement by **0.75** → 300e3 (`Constants.ts:110`, `Company/utils.ts:15-19`). `fulcrumassets` is **not** a backdoor-only unlock: Fulcrum also needs employment + corp rep (`FactionInfo.tsx:376-380`), so backdooring all five story servers unlocks **four** factions.

**Daedalus is an OR:** 30 augs, $100b, and `someCondition([hacking 2500, all combat 1500])` (`FactionInfo.tsx:141-145`). `nfg.js`'s header omits the combat alternative and hardcodes 30 where the game reads `currentNodeMults.DaedalusAugsRequirement`.

**`keepOnInstall`:** faction *invitations* survive an install for factions with `FactionInfo.keep` — the ten megacorps plus Shadows of Anarchy (`Prestige.ts:61-66`). So "budget ~5 clicks per install" is lower for corp factions.

**Programs.** All hacking levels and creation times **VERIFIED**. Darkweb prices **VERIFIED** except **ServerProfiler is $500e3, not $1e6**. **`Formulas.exe` (level 1000, $5e9) is missing from both `createProgram.js` and `buyProgram.js`.** Intelligence exp is a flat **0.1/second worked**, independent of program (`CreateProgramWork.ts:79-81`) — the script's per-program ranking is meaningless. And **intelligence lowers program requirements**: `clamp(level − intelligence/2, 1)` (`Programs.ts:26-28`), so both scripts refuse programs the game would allow.

---

## 8. Infiltration — the table is perfect, every formula around it is stale

All 35 locations in `infiltration.js:4-180` diff **exactly** against `LocationsMetadata.ts`. Impressive for a 2021 table.

But: **rewards no longer depend on your stats** — `calculateReward` hard-codes the stat total at **465** (`Infiltration/formulas/game.ts:55-57`), so the whole "raise defense to unlock better targets" model is obsolete. There is a new global **diminishing-returns term**, `calculateMarketDemandMultiplier` (`game.ts:25-34`), multiplying both money and rep by `1 − 1e-3·floors²` with a ~35s half-life EMA — it clamps to zero at ~31.6 accumulated floors and is *exactly* the term that punishes naive auto-infiltration. Rep also carries a **`balanceMultiplier` step function of security level** (`victory.ts:94-108`) that deliberately penalises the high-security locations the script optimises toward, inverting its ranking.

`ns.infiltration.getPossibleLocations()` costs **0GB** and replaces the whole 180-line table.

Two `infilhelper.js` minigame strings no longer match: `"Say something nice about the guard."` has **no trailing period** in the game, and `"Slash when his guard is down!"` was **rewritten entirely** (`SlashGame.tsx:30-32` now uses explicit `guardingEndTime` states). Also `"Type it backward"` becomes `"Type it"` when WKSharmonizer is owned.

---

## 9. Corrections to CLAUDE.md's own citations

- **The autoexec-after-install *reasoning* is wrong, the conclusion is right.** `loadAllRunningScripts()` is called only from `engine.tsx:282` — the game-**load** path — and never from `Prestige.ts`. So the autoexec does not fire after an install because the install never runs the load path, not because `rsList` is empty. Current phrasing implies a page reload after an install would also skip it, which the code does not say.
- `w0r1d_d43m0n`'s `requiredHackingSkill: 3000` is at `servers.ts:1553`, but the `× WorldDaemonDifficulty` is applied at **`ServerHelpers.ts:423`** — the fact lives in two files.
- `FavorToDonateToFaction` lives in `BitNodeMultipliers.ts:143`; only the base 150 is in `Constants.ts`.
- The favor term in `getHackingWorkRepGain` is at `reputation.ts:9`, not `:16`.
- NFG's $750k base is at `Augmentations.ts:1161`, not `:1160`.
- **NFG is +1.000262%, not +1%** — every multiplier is `1.01 + Donations/1e6/100` (`Augmentations.ts:9,1170-1189`) — and it covers hacking/combat/charisma/exp/company_rep/faction_rep/crime but **not** hacknet or bladeburner.
- `singularity.exportGame()` and `hasExportGameBonus()` exist (`Singularity.ts:1193-1204`), so `upkeep.js`'s "the DOM is the only route to the export bonus" is true only without SF4.
- **Share threads are not threads:** `calculateEffectiveSharedThreads = threads × intelligenceBonus × getCoreBonus(cores)` (`Share.ts:22-25`). `watchdog.js`'s `shareThreads()` picks the largest free block ignoring cores — home at 8 cores gives **×1.4375** for the same RAM.
- `sfgate.js` is missing **`restrictHomePCUpgrade`**, a BitNode option that caps home at **128GB / 8 cores** (`ServerPurchases.ts:173`) — in such a node `homeup`'s trigger stays true against a button that permanently refuses.

---

## 10. Strict enums are the dominant breakage class

`nsGetMember` without `{fuzzy:true}` is used for CrimeType, UniversityClassType, GymType, BladeburnerActionType, HashUpgradeEnum, CityName, FactionName and CompanyName. **Four scripts die on it** (`crime.js`, `training.js`, `sleeve.js`, `bladeburner.js`) and in every case the fix is a string edit. `ns.enums.*` is exposed in the definitions — using it would make these unbreakable.
