# sing-faction.js / sing-donate.js — the faction half of the autonomous stack

Staged at `tools/staging/`. **Not deployed.** `tools/` is in `SKIP_DIRS`
(`tools/rfa-daemon.mjs`), so nothing here reaches the live game. Nothing was
pushed; every daemon call made while writing these was `calculateRam` or
`/status`.

Line references of the form `File.ts:NN` are into `~/Repos/bitburner`
(`bitburner-official/bitburner-src` fork) and were **read, not recalled**.
Conventions follow the staged set already here — `status.js` for reporting, one
`NOTES-*.md` per change. No new reporting style was invented.

---

## 1. The blocker, confirmed from both sides

`Faction/ui/FactionsRoot.tsx:87-93`:

```tsx
function acceptInvitation(event, factionName): void {
  if (!event.isTrusted || !Factions[factionName].alreadyInvited || Factions[factionName].isBanned) {
    return;
  }
  joinFaction(Factions[factionName]);
```

`event.isTrusted` is the **first** clause. It is evaluated before the invite is
looked up and before the ban check, so there is no partial path and no
diagnostic — a synthetic `.click()` returns silently, in every BitNode. This is
what cost ~5 human clicks per install cycle for the whole of BitNode 1.

`NetscriptFunctions/Singularity.ts:750-771`:

```ts
joinFaction: (ctx, _facName) => {
  helpers.checkSingularityAccess(ctx);
  const facName = getEnumHelper("FactionName").nsGetMember(ctx, _facName);
  if (Player.factions.includes(facName)) { ...return false }
  if (!Player.factionInvitations.includes(facName)) { ...return false }
  const fac = Factions[facName];
  joinFaction(fac);
```

`checkSingularityAccess` and nothing else. No event, no DOM, no `isTrusted`.
Both files were opened; this is the verification the brief asked for.

Worth noting for the `variants/dom-ui/` set: the guard is on the **UI handler**,
not on `FactionHelpers.joinFaction`. The anticheat boundary is drawn around the
React callback, and Singularity is a separate, deliberately ungated door.

---

## 2. The join policy

### 2.1 What is actually mutually exclusive

`Faction/FactionHelpers.tsx:44-51`, inside `joinFaction()`:

```ts
for (const enemy of faction.getInfo().enemies) {
  if (Factions[enemy]) Factions[enemy].isBanned = true;
}
Player.factionInvitations = Player.factionInvitations.filter(
  (factionName) => !Factions[factionName].isMember && !Factions[factionName].isBanned);
```

The ban is permanent for the life, and banned factions are dropped from the
invitation list — so the game itself enforces the choice after the fact. The
policy only has to get the *first* commitment right.

`enemies:` is non-empty for **exactly six factions**. Grepping the whole of
`Faction/FactionInfo.tsx` gives six hits — `:498, :508, :520, :530, :540, :552`
— and all six are city factions.

> **Correction to the brief:** the crime factions are **not** mutually exclusive
> in this version. Slum Snakes, Tetrads, Silhouette, The Syndicate, The Dark
> Army and Speakers for the Dead (`FactionInfo.tsx:560-666`) declare no
> `enemies` at all. Community guides that say otherwise predate this source.
> There is nothing to protect there, so the script joins every crime invite it
> sees, in any order.

### 2.2 The city graph is asymmetric, and that is the whole decision

| faction | bans (`enemies`) |
| --- | --- |
| Aevum | Chongqing, New Tokyo, Ishima, Volhaven — **not Sector-12** |
| Sector-12 | Chongqing, New Tokyo, Ishima, Volhaven — **not Aevum** |
| Chongqing | Sector-12, Aevum, Volhaven |
| Ishima | Sector-12, Aevum, Volhaven |
| New Tokyo | Sector-12, Aevum, Volhaven |
| Volhaven | all five others |

Read as a graph, that is not six choices but three blocs:

```
west      { Sector-12, Aevum }              2 memberships
east      { Chongqing, New Tokyo, Ishima }  3 memberships
volhaven  { Volhaven }                      1 membership
```

The two omissions in the table are load-bearing and easy to miss: **Sector-12
and Aevum are simultaneously joinable**, and the three eastern cities are
mutually compatible because none of them lists another eastern city.

### 2.3 Chosen: `west` (Sector-12, then Aevum). Why.

Augmentation lists extracted from `Augmentation/Augmentations.ts`, unique to
each bloc:

| bloc | unique augmentations that matter |
| --- | --- |
| west | **CashRoot Starter Kit** (S12) rep 1.25e4 / $1.25e8 — `startingMoney: 1e6` + `CompletedProgramName.bruteSsh` (`:320-327`)<br>**PCMatrix** (Aevum) rep 1e5 / $2e9 — `faction_rep 1.0777`, `company_rep 1.0777`, `crime_money 1.0777` |
| east | **Neuregen** (Chongqing) `hacking_exp 1.4`<br>~~DataJack~~ — see below |
| volhaven | CombatRib2, DermaForce — combat only |

Three reasons, in order of weight:

1. **CashRoot is the bootstrap fix, and this bot has to bootstrap itself.**
   CLAUDE.md's install procedure records that `prestigeHomeComputer` clears
   `serversOnNetwork`, which takes the darkweb link with it — TOR is gone,
   `hasTorRouter()` goes false, and "`autobuy.js` alone could never bootstrap a
   life". CashRoot hands back **$1262 and BruteSSH at every single install**,
   permanently. For a stack whose whole purpose is surviving an install with no
   human, that is worth more than any multiplier on the board.

2. **PCMatrix compounds on the thing this pair of scripts is for.**
   `person.mults.faction_rep` appears in *both*
   `getHackingWorkRepGain` (`formulas/reputation.ts:17`) and
   `repFromDonation` (`formulas/donation.ts:8-10`). +7.77% makes the grind
   faster *and* every future donation cheaper, for the rest of the BitNode.

3. **The eastern bloc's headline prize is not actually unique.** DataJack
   (`hacking_money 1.25`) is sold by `BitRunners, TheBlackHand, NiteSec,
   Chongqing, NewTokyo` — the first three are hacking factions we join under
   Rule 1 anyway. So paying three memberships for the eastern bloc buys exactly
   one augmentation we cannot get elsewhere (Neuregen, an *experience*
   multiplier), against CashRoot plus PCMatrix. Volhaven is strictly dominated:
   most expensive to be invited to ($50m), bans the most, and is combat-only.

**This is a deliberate, documented lock-out**, which is what the brief required.
It is reversible only by not having made it: `--bloc east|volhaven|none`.
`--bloc none` forgoes nothing permanently — city invites are re-issued whenever
their `inviteReqs` hold, so declining today costs nothing but a later invite.

### 2.4 Rule 1: everything without `enemies` is joined on sight

Nothing is forgone and a faction you are not in sells you nothing. That covers
every hacking faction, every megacorp, every crime faction, Netburners, Tian Di
Hui, Daedalus and the endgame three.

`decide()` is exported and pure (no `ns`), so the policy is testable under plain
`node`. 16 cases pass, including every bloc × every city and the two
"simultaneously joinable" pairs.

---

## 3. Focus, and why the script decides rather than guessing

`focusPenalty()` (`PlayerObjectGeneralMethods.ts:622-628`):

```ts
let focus = 1;
if (!this.hasAugmentation(AugmentationName.NeuroreceptorManager, true)) {
  focus = this.focus ? 1 : CONSTANTS.BaseFocusBonus;   // 0.8, Constants.ts:87
}
```

So unfocused work is 80%, i.e. focused work is **+25%** — *unless* the
Neuroreceptor Management Implant is installed, in which case the penalty does
not exist and focusing is pure cost. The cost is real: focused work routes to
`Page.Work` (`Singularity.ts:545-546`), and CLAUDE.md records that this **hides
the entire sidebar**, which is how `augbuy.js` / `torbuy.js` / `upkeep.js` lose
their buttons — a failure that has cost this project hours twice.

`--focus auto` (the default) reads the answer for **1GB** instead of 5:
`getResetInfo().ownedAugs` is `new Map(Player.augmentations.map(...))`
(`NetscriptFunctions.ts:1444`) — *installed* augmentations, which is exactly
what `hasAugmentation(name, ignoreQueued = true)` tests (`Person.ts:232`). That
is the same answer `getOwnedAugmentations` (SingularityFn3, 5GB) would give, at
a fifth of the price. `--focus yes|no` overrides.

`setFocus` **throws** when `Player.currentWork === null`
(`Singularity.ts:540-542`), so it is only ever called behind a `getCurrentWork()`
check.

---

## 4. Idempotency, and the one thing switching work does *not* cost

`getCurrentWork()` returns `FactionWork.APICopy()` —
`{ type:'FACTION', factionName, factionWorkType, cyclesWorked, nextCompletion }`
(`Work/FactionWork.tsx:71-79`). Re-exec with the same faction and type and the
script corrects focus if needed and otherwise does nothing.

Reputation is **not** at risk when switching. `FactionWork.process()` adds
`getReputationRate() * cycles` to `faction.playerReputation` on **every cycle**
(`FactionWork.tsx:52-54`), not at `finish()`. So `stopAction` is not needed to
bank progress, and re-issuing `workForFaction` never loses reputation. What it
*does* destroy is `cyclesWorked`, which resets to 0 — which makes the telemetry
unreadable, and telemetry is the point. Hence the guard.

---

## 5. RAM — measured method, audited result

The daemon can only price files already in the game and **nothing was pushed**,
so both numbers are reasoned from `Netscript/RamCostGenerator.ts` and
`Script/RamCalculations.ts`. The reasoning is not freehand: it was implemented
as a walker (acorn + the harvested cost table, following `findFunc`'s
by-bare-name recursive resolution) and **calibrated against the live game
first**, per CLAUDE.md's rule that a model must reproduce something the game
already displays before its output is used.

```
file          model   live (calculateRam)
status.js      1.60   1.6    MATCH
lock.js        2.30   2.3    MATCH
nfg.js         2.40   2.4    MATCH
homecost.js    1.60   1.6    MATCH
```

4/4 exact. Applied to the staged files:

### sing-faction.js — **13.70 GB**

| ref | GB | why this script needs it |
| --- | --- | --- |
| base | 1.6 | `RamCostConstants.Base` |
| `checkFactionInvitations` | 3 | the input to the policy — and it *acts*: it zeroes `Engine.Counters.checkFactionInvitations` and runs `Engine.checkCounters()` (`Singularity.ts:742-748`), so newly-earned invites are issued on this call instead of up to a counter-period later |
| `joinFaction` | 3 | the entire point of the script (§1) |
| `workForFaction` | 3 | start faction work |
| `stopAction` | 1 | the only way to end work; `workForFaction` cannot express "nothing" |
| `getCurrentWork` | 0.5 | idempotency (§4), and the guard that stops `setFocus` throwing |
| `setFocus` | 0.1 | the 25% (§3) |
| `getPlayer` | 0.5 | `.factions` for the policy and the status file. Not a Singularity call |
| `getResetInfo` | 1 | `.ownedAugs` → the focus decision at 1/5 the price of `getOwnedAugmentations` (§3); `.currentNode` into telemetry. Not a Singularity call |

### sing-donate.js — **10.10 GB**

| ref | GB | why this script needs it |
| --- | --- | --- |
| base | 1.6 | |
| `donateToFaction` | 5 | the job |
| `getFactionRep` | 1 | the target, and **both ends of the calibration measurement** (§6) |
| `getFactionFavor` | 1 | `donateToFaction` returns a bare `false` when favor is short (`:920-931`), indistinguishable from every other `false`. The director needs "favor 143 of 150" to decide between "keep grinding" and "give up" |
| `getPlayer` | 0.5 | `.mults.faction_rep`, `.money` (so no separate `getServerMoneyAvailable`), `.factions` to fail fast |
| `getResetInfo` | 1 | `.currentNode` — the BitNode multiplier and favor threshold are node-dependent (§6) |

### Deliberately not referenced

| not used | GB saved | instead |
| --- | --- | --- |
| `getFactionEnemies` | 3 | six static entries, inlined with `FactionInfo.tsx` line citations. Not BitNode-dependent. This is 23% of sing-faction.js |
| `getOwnedAugmentations` | 5 | `getResetInfo().ownedAugs` at 1GB (§3) |
| `getFactionWorkTypes` | 1 | `workForFaction` already returns false and logs when the type is not offered (`:790-793` etc.) — paying to predict a free failure |
| `getBitNodeMultipliers` | 4 | SF5-gated, and the probe measures the one number it would supply (§6) |
| `getAugmentation*` | 2.5–5 | sing-aug.js's surface; see §7 |
| `getServerMoneyAvailable` | 0.1 | `getPlayer().money` |

### ⚠ The hazard this audit caught

`RamCalculations.ts:436-438` walks a MemberExpression's **`property`** as well as
its `object`, so every Identifier — including plain local variable names —
becomes a dependency. `findFunc` (`:226-244`) then resolves each one by **bare
name, recursively, over the entire RamCosts tree**, so a name that collides with
any ns function in any namespace is billed.

The calibration amount in sing-donate.js was originally `const probe`. That
silently cost **0.2GB** via `dnet.probe` (`RamCostGenerator.ts:244`). It is
`calAmount` for that reason and no other. The audit is cheap; run it on any edit:

```bash
nice -n 19 node -e '
const acorn=require("/home/tbusby/Repos/bitburner/node_modules/acorn"),
      walk=require("/home/tbusby/Repos/bitburner/node_modules/acorn-walk"),fs=require("fs");
const g=fs.readFileSync("/home/tbusby/Repos/bitburner/src/Netscript/RamCostGenerator.ts","utf8");
const C={}; for(const m of g.matchAll(/^\s{2}(\w+):\s*([0-9.]+),/gm)) C[m[1]]=+m[2];
const cost={}; const add=(n,v)=>{if(!(n in cost)||v>cost[n])cost[n]=v};
for(const m of g.matchAll(/^\s+(\w+):\s*(?:SF4Cost\()?\s*(?:RamCostConstants\.)?([A-Za-z0-9_.]+)\s*(?:\/\s*([0-9.]+))?\s*\)?,?\s*$/gm)){
  const v=/^[0-9.]+$/.test(m[2])?+m[2]:(C[m[2]]??null); if(v===null)continue; add(m[1],v/(m[3]?+m[3]:1));}
const ast=acorn.parse(fs.readFileSync(process.argv[1],"utf8"),{ecmaVersion:2022,sourceType:"module"});
const ids=new Set(); walk.simple(ast,{Identifier(n){ids.add(n.name)},
  MemberExpression(n){if(!n.computed&&n.property&&n.property.name)ids.add(n.property.name)}});
let t=1.6; for(const i of [...ids].sort()) if(cost[i]>0){t+=cost[i];console.log("   ",i.padEnd(26),cost[i])}
console.log("TOTAL",t.toFixed(2),"GB");' tools/staging/sing-donate.js
```

### The budget consequence, stated plainly

Home is 32GB and `batch.js` (11.2GB) must keep running.

```
batch.js          11.2
sing-faction.js   13.7   -> 24.9 / 32   ok, 7.1 free
sing-donate.js    10.1   -> 21.3 / 32   ok, 10.7 free
both at once      35.0   -> DOES NOT FIT
```

**`autopilot.js` must serialise the specialists**, not fire them concurrently.
Both are one-shot (do the work, write telemetry, exit), so serialising costs
nothing. If a future home layout makes that inconvenient, the available cut is
splitting sing-faction.js again — invites+join is 8.1GB, work+focus+stop is
6.2GB — which is the same rule from `docs/autonomy.md` applied one level deeper.

---

## 6. The donation formula, and the factor everything omits

**Read, not recalled** — `Faction/formulas/donation.ts:8-10`:

```ts
export function repFromDonation(amt: number, person: IPerson): number {
  return (amt / CONSTANTS.DonateMoneyToRepDivisor)
       * person.mults.faction_rep
       * currentNodeMults.FactionWorkRepGain;
}
```

There are **three** factors, not two. The brief's formula — and CLAUDE.md's
"Reputation is a purchase" section, and nfg.js's header — all give
`amt / 1e6 * faction_rep` and drop `currentNodeMults.FactionWorkRepGain`, which
is **0.75 in BitNode 4** (`BitNode.tsx:645`). `DonateMoneyToRepDivisor` is `1e6`
(`Constants.ts:33`), as stated.

`favorNeededToDonate()` is confirmed, with a caveat:

```ts
// donation.ts:17
Math.floor(CONSTANTS.BaseFavorToDonate * currentNodeMults.FavorToDonateToFaction)
```

`BaseFavorToDonate = 150` (`Constants.ts:31`), and BN4 does not set
`FavorToDonateToFaction`, so it defaults to 1 (`BitNodeMultipliers.ts:143`) and
the threshold here is **150 exactly**. It is not 150 everywhere — BN3 halves it
to 75, BN8 zeroes it — so the script reads `getResetInfo().currentNode` rather
than hardcoding.

### What the real multiplier does to the amount

This is the finding the brief asked for, and it is worse than "the amount is
different":

nfg.js over-donates *on purpose*, by assuming `faction_rep = 1` so that the
computed dollar figure is "an upper bound". Its own comment records the live
multiplier as ~1.33. In BitNode 4 that assumption delivers

```
rep = shortfall × 1.33 × 0.75 = shortfall × 0.9975
```

— a **0.25% shortfall, not a surplus.** The break-even is exactly
`faction_rep = 1 / 0.75 = 4/3`. Below it, the "always an upper bound" comment is
simply false in this BitNode, and a purchase that looked funded misses by a
hair. Verified numerically against the shipped `expectedRate()`.

Correctly: `donation = rep × 1e6 / faction_rep / FactionWorkRepGain`, so at
`faction_rep = 1.33` in BN4 the right amount is **~1.0025× the shortfall in
dollars** where the shorthand says 1.0× — and in BN14 (`FactionWorkRepGain 0.2`)
the shorthand would be **5× too cheap**.

### It measures rather than trusting the table

The per-node table covers BitNodes 1-15, but BN12 scales its multipliers by
level (`BitNode.tsx:964`) and a hardcoded table is precisely the failure mode
that put `daedalus-plan.mjs` 24% out. So the table is **not** what the amount is
computed from. The script:

1. computes the expected rate from `getPlayer().mults.faction_rep` × the table;
2. donates a bounded probe and reads the reputation delta;
3. prints a `CHECK` line with expected, measured and the **error percent, on
   every run, pass or fail**;
4. sizes the real donation from the **measured** rate;
5. re-runs the affordability gate against that measured rate before the large
   amount moves.

The measurement is exact, not statistical. `donate()` mutates
`faction.playerReputation` synchronously (`donation.ts:30`) and `getFactionRep`
reads that same field (`Singularity.ts:876-881`), and there is **no `await`
between the three calls** — so no game cycle can tick and concurrent faction
work (`FactionWork.process`) cannot contaminate the delta. *Do not put a sleep
in that block.* The `CHECK` line will read ≈ -25% error against the naive
shorthand in BN4, which is the node multiplier announcing itself.

---

## 7. How the check-rep-before-price bug is prevented

The original, `nfg.js:141-176`:

```js
const shortfall = needRep - haveRep
if (!(shortfall > 0)) {              // rep already sufficient ->
    const price = ...                //   the ONLY place price is read
    break
}
const cost = shortfall * 1e6         // rep short ->
if (money - cost < flags.reserve)    //   affordability of the DONATION only
    break
donate(cost)                         //   the augmentation's own price: never read
```

The money price is consulted **only on the branch that does not spend money**.
On the branch that does, it is not consulted at all. That bought $10.5t of
reputation for a NeuroFlux level whose dollar price was out of reach.

The asymmetry that makes it expensive: **a failed purchase does not consume
reputation, but the donation has already consumed money.** Donating too early is
recoverable; donating for something unaffordable is permanent loss.

Two structural defences, not a comment:

1. **`--price` has no usable default.** Omit it and the script exits
   `blocked` having spent nothing; `--unpriced` is required to opt out
   explicitly. The original bug was one of *omission*, so omission is made
   fatal — it cannot recur by forgetting.
2. **The gate is `money >= donation + price + reserve`**, evaluated before any
   money moves, and **re-evaluated after calibration** with the measured rate,
   at which point only the bounded probe has been spent. Never
   `money >= donation`.

`--check` prices the whole thing and spends nothing, so the director can ask
"what would this cost?" for free.

Ordering in the script is deliberate and worth preserving:
membership → favor → *is there any reputation shortfall at all* → **price gate**
→ probe → re-gate → donate → verify against the target.

---

## 8. What could not be done without a second script

**Pricing the thing the reputation is for.** `getAugmentationsFromFaction` is
5GB and `getAugmentationPrice` 2.5GB (`RamCostGenerator.ts:204-208`). Putting
either in sing-donate.js — already 5GB of `donateToFaction` — would import
sing-aug.js's whole reason for existing into the donor, for one number. So the
caller passes `--price` down, and the mandatory-flag design (§7) converts that
into a safety property rather than a leak.

That is the concrete cost of `docs/autonomy.md`'s split rule, and it is the
right trade: joining, donating and buying do not need to be atomic with one
another. What they *do* need is a director that sequences them, because §5 shows
sing-faction and sing-donate cannot be resident at the same time alongside
`batch.js`.

Two smaller things also landed on the other side of the line:

- **sing-donate cannot tell "faction offers no work" from other refusals.**
  `donateToFaction` refuses when `!faction.getInfo().offersWork()`
  (`Singularity.ts:907-910`) — Bladeburners, Church of the Machine God, Shadows
  of Anarchy. Predicting that costs 1GB (`getFactionWorkTypes`) to avoid a
  failure that is already free, since every guard returns before `donate()` is
  called. The probe's return value reports it instead.
- **sing-faction cannot decide *which* faction to work for.** That needs
  augmentation requirements and a plan; it is `autopilot.js` / `sing-aug.js`
  work. This script takes a name and a type, and is correct about focus,
  idempotency and telemetry.

---

## 9. Testing done, and what has not been tested

Done, all offline and read-only:

- **Parse gate** — `node --input-type=module -e "$(sed 's|^import .*||' FILE)"`
  on both files. Clean.
- **RAM model calibrated 4/4 against the live game** before being used (§5),
  then applied: 13.70GB and 10.10GB with no unaccounted-for references. It
  caught a real 0.2GB accidental charge.
- **Pure-logic unit tests under plain `node`** — `decide()`, `expectedRate()`,
  `favorNeeded()` are exported and `ns`-free. 16 cases: every bloc × every city,
  both "simultaneously joinable" pairs, crime factions, `--bloc none`, the BN3 /
  BN4 / BN8 favor thresholds, and the 4/3 donation break-even. All pass.

Not done, and it should be said rather than left silent:

- **Neither script has been run in the game.** No file was pushed, per the
  brief. The first live run of sing-donate.js should use `--check`.
- **The probe has never actually moved money.** The no-`await` atomicity
  argument is read out of the source (`donation.ts:30`,
  `Singularity.ts:876-881`) and is sound, but the first real run is the first
  test of it. The `CHECK` line exists so that run reports its own error.
- **`--bloc east|volhaven` are untested paths** in the sense that no game has
  taken them. The policy logic is unit-tested; the consequences are permanent.

## 10. Before landing

- `bncheck.mjs` — per CLAUDE.md, "when a script gains a constant that depends on
  a multiplier, add it to the `ASSUMPTIONS` table in the same commit."
  sing-donate.js gains two: `FactionWorkRepGain` (**0.75 in BN4**, and the
  repo-wide donation shorthand does not know it exists) and
  `FavorToDonateToFaction`. The second is arguably the more urgent entry,
  because the stale shorthand is currently in CLAUDE.md, nfg.js and
  docs/autonomy.md, not just in one script.
- The CLAUDE.md "Reputation is a purchase" block cites
  `donation.ts:8 repFromDonation(amt) = amt / 1e6 * mults.faction_rep`. That is
  the two-factor form and is wrong outside BN1. Worth fixing there, since it is
  the sentence everything else is derived from.
