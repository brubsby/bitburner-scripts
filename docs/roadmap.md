# BN1 roadmap — decision document

Every number is cited to a file in `~/Repos/bitburner` (v3.0.2, commit `b5b09b8a8`) or to
`.telemetry/`. Anything I could not verify is marked **UNVERIFIED**.

**State when this was written** (`/poll`, 2026-09-11T20:27Z): hacking **100**, **$488k**,
**14/72 rooted**, home **16GB / 1 core**, ~220GB total network RAM, 0 purchased servers,
**CyberSec joined**, no augs, no Source-Files, Sector-12.

In the ~13 minutes this document took to write, the game-player agent upgraded home 8→16GB
($1.01m), bought the TOR router ($200k) and `BruteSSH.exe` ($500k), rooted and backdoored
`CSEC`, and accepted the CyberSec invite. §0 is therefore closed; it is kept because the same
mechanics govern the remaining four ports and four backdoors. Hacking just crossed **100**,
which is the `FTPCrack.exe` creation threshold — that is milestone #3 and it is live now.

---

## The one-paragraph thesis

**Hacking experience is the binding constraint, not money.** Measured from
`.telemetry/history.jsonl`: hacking went 83 → 91 in 540s, which is
`exp(91) - exp(83) = 8,361 - 6,400 = 1,961` exp → **~3.6 exp/s**
(skill↔exp via `src/PersonObjects/formulas/skill.ts`: `skill = floor(32·ln(exp+534.6) − 200)`).
NiteSec needs hacking ~220 = **500,785 exp**. At 3.6 exp/s that is **38 hours**. Exp scales
linearly with concurrent hack/grow/weaken threads, i.e. with RAM
(`calculateHackingExpGain = 3 + 0.3·baseDifficulty` *per thread per completed op*,
`src/Hacking.ts:30-38`). So the whole early game is:

> **money → RAM → threads → exp → hacking level → backdoors → factions → augs**

and the fastest available money is **coding contracts** (§5), not hacking. That is the
single most actionable finding in this document.

---

## Milestones in order

| # | Milestone | Trigger | Cost | Unlocks |
| --- | --- | --- | --- | --- |
| 1 | **Harvest the coding-contract backlog** | **now** | ~0 (needs a split solver, §5) | ~$6.25m + ~490 CyberSec rep *expected per contract*; ~10 already on the map |
| 2 | ~~Accept CyberSec~~ | — | — | **done 20:27** |
| 3 | **Create `FTPCrack.exe`** (do not buy — saves $1.5m) | **hacking ≥ 100, reached** | $0 + ~30 min of game time | 2-port servers, incl. `avmnite-02h` |
| 4 | **Buy purchased servers with contract money** | $5m+ | $55k/GB | linear exp + income; 25 × 1TB cap |
| 5 | **Backdoor `avmnite-02h` → NiteSec** | hacking ~220 | free | NiteSec augs (best early hacking set) |
| 6 | **Create `relaySMTP.exe`** | hacking ≥ 250 | $0 + ~2h game time | 3-port servers, `I.I.I.I` |
| 7 | **First aug install** | see §2 | resets hacking to 1 | permanent multipliers + favor |
| 8 | Backdoor `I.I.I.I` → The Black Hand | hacking ~365 | free | mid-game hacking augs |
| 9 | `HTTPWorm` (hacking 500 / $30m), `run4theh111z` → BitRunners | hacking ~550 | — | top hacking augs |
| 10 | `SQLInject` (hacking 750 / $250m) | — | — | 5-port servers, eventually `w0r1d_d43m0n` |

---

## 0. The CyberSec thread (mechanics, now satisfied)

`csec-test.msg` is the hacking-50 rumor trigger (`src/Message/MessageHelpers.tsx:81`), not
the invite. The invite condition is exactly one thing:

> `[FactionName.CyberSec]: inviteReqs: [haveBackdooredServer(SpecialServers.CyberSecServer)]`
> — `src/Faction/FactionInfo.tsx:489`

`CSEC` (`src/Server/data/SpecialServers.ts`) — `requiredHackingSkill` rolled in **51–60**,
`numOpenPortsRequired: 1`, network layer 2, 8GB RAM, **no money, no growth**
(`src/Server/data/servers.ts:1519-1534`). `backdoor` checks admin rights first, then
`hacking >= requiredHackingSkill` (`src/Terminal/commands/backdoor.ts:30-38`); duration is
`calculateHackingTime/4` (line 60).

**The invite is now pending and does not expire** (`Player.factionInvitations` persists
until prestige). See §5 for why it is worth *delaying* acceptance by one batch of contracts.

### Program creation vs. purchase — the general rule

`skillMult = 1 + ((hacking / reqLevel) − 1) / 5`, applied to real time, ×0.8 if not focused
(`src/Work/CreateProgramWork.ts:57-70`, `CONSTANTS.BaseFocusBonus = 0.8`).
Creation is free and does not block scripts — only the human's clicking.

| Program | Create lvl | Base time | Darkweb price | Verdict |
| --- | --- | --- | --- | --- |
| BruteSSH | 50 | 10 min | $500k | (already bought) |
| **FTPCrack** | **100** | **30 min** | **$1.5m** | **create** — player is at 96 |
| relaySMTP | 250 | 2 h | $5m | create if idle, else buy |
| HTTPWorm | 500 | 4 h | $30m | buy |
| SQLInject | 750 | 8 h | $250m | create — $250m is a lot even late |
| DeepscanV1 | 75 | 15 min | $500k | create; `scan-analyze` depth 5 |
| AutoLink | 25 | 15 min | $1m | create; makes manual `connect` painless |
| ServerProfiler | 75 | 30 min | $500k | skip, telemetry already covers it |
| Formulas.exe | 1000 | 4 h | $5b | far off; would let the sim run in-game |

Sources: `src/Programs/Programs.ts:49-330`, `src/DarkWeb/DarkWebItems.ts`,
`CONSTANTS.TorRouterCost = 200e3` (`src/Constants.ts:44`).

---

## 1. Critical path to the first aug install — what to buy, and when

### Purchased servers are the best RAM per dollar, by a wide margin

`getCloudServerCost(ram) = ram × 55,000 × CloudServerCost × CloudServerSoftcap^max(0, log2(ram)−6)`
(`src/Server/ServerPurchases.ts:22-40`, `ServerConstants.BaseCostFor1GBOfRamServer = 55000`).
BN1 leaves both multipliers at 1, so it is a **flat $55k/GB**. Limit **25 servers**, max
**1,048,576GB** each (`src/Server/data/Constants.ts`).

Home RAM: `currentRam × 32,000 × 1.58^log2(currentRam)`
(`src/PersonObjects/Player/PlayerObjectServerMethods.ts:30-40`) — superlinear and quickly awful:

| Home upgrade | Cost | | Cloud server | Cost |
| --- | --- | --- | --- | --- |
| 16 → 32GB | $3.19m | | 32GB | $1.76m |
| 32 → 64GB | $10.08m | | 64GB | $3.52m |
| 64 → 128GB | $31.86m | | 128GB | $7.04m |
| 128 → 256GB | $100.68m | | 256GB | $14.08m |
| 256 → 512GB | $318.16m | | 512GB | $28.16m |
| 512 → 1024GB | $1.005b | | 1024GB | $56.32m |

**But home RAM survives an aug install and purchased servers do not.** On prestige,
`Player.purchasedServers = []` (`src/PersonObjects/Player/PlayerObjectGeneralMethods.ts:109`)
and `prestigeAllServers()` deletes everything except home (`src/Prestige.ts:74`); the home
`Server` object is kept and only its *programs*, messages and `ramUsed` are cleared
(`src/Server/ServerHelpers.ts:226-240`) — `maxRam` is untouched.

**Rule:** buy cloud RAM freely while grinding toward an install; spend on home RAM only when
you are genuinely about to reset, or when home is so small it can't host the coordinator.
Practical floor: get home to **32GB** at some point so `contract.js`-class scripts
(20GB+ of `ns.codingcontract` RAM, §5) and `hack.js` (11.2GB) can coexist.

### Hacknet is a trap in BN1

Production `= level × 1.5 × 1.035^(ram−1) × (cores+5)/6`
(`src/Hacknet/formulas/HacknetNodes.ts:4-11`; constants in `src/Hacknet/data/Constants.ts`).
A node at level 200 / 64GB / 1 core yields **~$2,620/s** and costs **~$36m** to build
(levels ~$30.7m + RAM ~$5.4m) — ~3.8h payback, and cores are hopeless
(1→16 cores ≈ **$370m** for a 3.5× multiplier). The same $36m buys ~650GB of cloud RAM,
which both earns *and* generates hacking exp. **Do not build hacknet for income.**

The *only* reason to touch hacknet is the **Netburners** invite:
`hacking ≥ 80, totalHacknetRam ≥ 8, totalHacknetCores ≥ 4, totalHacknetLevels ≥ 100`
(`src/Faction/FactionInfo.tsx:675`). Cheapest satisfying build is 4 nodes, each RAM 1→2 and
level 1→25: ≈ $12.6k (nodes) + $120k (RAM) + $78k (levels) ≈ **$211k**.
Do it only if you want Netburners — and see the warning in §5 about faction count diluting
contract rep rewards. Netburners' own augs are all `hacknet_node_*` multipliers, i.e. traps.

### Stock market

`stock.js` exists. The WSE account, TIX API and 4S data are money sinks in the hundreds of
millions; they are not on the critical path before the first install. **UNVERIFIED** — I did
not read the v3 stock-unlock prices this pass.

---

## 2. What to rush

### Which faction first: **CyberSec, then NiteSec**

CyberSec is the only faction reachable without travel, combat stats, karma, or money, and it
is already invited. NiteSec is the first faction with genuinely strong hacking augs.
Reputation mechanics that govern everything here:

- **Rep does not carry across an install.** `Faction.prestigeAugmentation()` converts rep to
  **favor** and then sets `playerReputation = 0` (`src/Faction/Faction.ts:77-84`).
  `favor` gives a permanent `1 + favor/100` multiplier on future rep gain
  (`src/PersonObjects/formulas/reputation.ts:8-14`). `favorToRep(f) = 25000·(e^{0.0198·f} − 1)`
  (`src/Faction/formulas/favor.ts`) → 18.75k banked rep ≈ **28 favor** ≈ +28% forever.
  Donations unlock at **150 favor** = **462,500 rep** (`CONSTANTS.BaseFavorToDonate = 150`,
  `DonateMoneyToRepDivisor = 1e6`) — far away; ignore for now.
- **Therefore: buy every aug you can afford from a faction *before* installing.** Unspent rep
  is not lost, but it is only worth its favor conversion.
- Manual hacking-work rep rate (`getHackingWorkRepGain`, `CONSTANTS.MaxSkillLevel = 975`,
  and `currentNodeMults.FactionWorkRepGain` — reputation.ts:13,
  5 cycles/s): **`rep/s = 5 × hacking / 975 × (1 + favor/100) × shareBonus`**.
  At hacking 100 that is **0.51 rep/s ≈ 1,850 rep/hour** of the human sitting there. Slow.
- `ns.share()` multiplies faction rep gain by `1 + ln(effectiveThreads)/25`
  (`src/NetworkShare/Share.ts:43-48`). At 4GB/thread that is a poor trade: 1,000 threads
  (4TB!) is only **+27.6%**. Only worth running while actively doing faction work, and only
  from RAM that would otherwise idle.

### Augmentations that matter, and the traps

Costs from `src/Augmentation/Augmentations.ts`. **Money cost is multiplied by
`1.9^(number already queued)`; reputation cost is not** (`getAugCost`,
`src/Augmentation/AugmentationHelpers.ts:120-163`, `CONSTANTS.MultipleAugMultiplier = 1.9`).
**⇒ Always buy the most expensive augmentation first in a purchase batch.**

**CyberSec (worth buying, in this order for rep-reachability):**

| Aug | Rep | Base $ | Effect |
| --- | --- | --- | --- |
| NeuroFluxGovernor | 500 × 1.14^lvl | $750k × 1.14^lvl | +1% to *every* multiplier, infinitely repeatable |
| Neurotrainer I | 1,000 | $4m | hacking_exp ×1.10 |
| SynapticEnhancement | 2,000 | $7.5m | hacking_speed ×1.03 |
| BitWire | 3,750 | $10m | hacking ×1.05 |
| CranialSignalProcessorsG1 | 10,000 | $70m | hacking ×1.05, speed ×1.01 |
| CranialSignalProcessorsG2 | 18,750 | $125m | hacking ×1.07, speed ×1.02, chance ×1.05 |

All six cost **18,750 rep** (the max, not the sum) and, bought most-expensive-first,
**$397.6m** for the five non-NFG ones. Given `hacking_exp ×1.10` directly attacks the
binding constraint, **Neurotrainer I is the best $4m in the game right now.**

**NiteSec (the real prize, needs hacking ~220):** NeuralRetentionEnhancement (20k rep, $250m,
**hacking_exp ×1.25**), CRTX42-AA (45k rep, $225m, hacking ×1.08 + exp ×1.15),
ArtificialSynapticPotentiation (6.25k, $80m), Neurotrainer II (10k, $45m, exp ×1.15),
plus the CyberSec list again (BitWire, CSP G1/G2 are shared).

**Traps:**
- Every `hacknet_node_*` aug (all of Netburners) — the hacknet itself is not worth running.
- `Targeting I/II`, `WiredReflexes`, `NanofiberWeave`, `Magnetism` — combat/charisma stats,
  useless on a pure-hacking BN1 route.
- `SpeechEnhancement` / `SpeechProcessor` / `NuoptimalInjectorImplant` / `ADR-V1 Pheromone` —
  company-reputation augs; only matter if you take a corporate job, which you would only do
  for Fulcrum/megacorp factions much later.
- **`CashRoot Starter Kit` (Sector-12, 12.5k rep, $125m) is *not* a trap** — it grants
  `startingMoney: 1e6` **and `BruteSSH.exe`** on every future install
  (`src/Augmentation/Augmentations.ts:320-327`), which removes the entire opening bottleneck
  you just lived through. Sector-12's invite is trivially cheap:
  `locatedInCity(Sector-12)` (already true) **and `$15m`** (`FactionInfo.tsx:541`) — the
  invite will fire on its own the moment you hold $15m. Worth taking before install #1 or #2.

---

## 3. Backdoors and story servers

Exactly five servers gate a faction by backdoor (`haveBackdooredServer` appears only at
`src/Faction/FactionInfo.tsx` lines 379, 402, 419, 465, 489). All are
`moneyAvailable: 0, serverGrowth: 0` — **keys, never hack targets**. Required-skill values
are per-playthrough rolls in the ranges below; `analyze` in game shows this save's roll.

| Order | Server | Faction | Req. hacking | Ports | Layer | Last port needs |
| --- | --- | --- | --- | --- | --- | --- |
| 1 ✅ | `CSEC` | CyberSec | 51–60 | 1 | 2 | BruteSSH |
| 2 | `avmnite-02h` | NiteSec | **202–220** | 2 | 4 | FTPCrack |
| 3 | `I.I.I.I` | The Black Hand | **340–365** | 3 | 5 | relaySMTP |
| 4 | `run4theh111z` | BitRunners | **505–550** | 4 | 11 | HTTPWorm |
| — | `fulcrumassets` | Fulcrum Secret Tech | (also needs a Fulcrum job) | 5 | 1 | SQLInject |
| — | `.` | *none* | 505–550 | 4 | 13 | HTTPWorm |
| — | `The-Cave` | *none* (Daedalus is not backdoor-gated) | 925 | 5 | 15 | SQLInject |
| — | `w0r1d_d43m0n` | **ends BN1** | **3000** | 5 | — | SQLInject |

(`src/Server/data/servers.ts:1446-1556`.)

`auto.js` already opens every port it has a program for and NUKEs
(`auto.js:29-71`), so a new `.exe` on home turns into new rooted servers automatically. The
human only has to `connect` and run `backdoor` — that part cannot be scripted without SF4.

Rumor/message thresholds that announce each faction
(`src/Message/MessageHelpers.tsx:74-92`): hacking 25 → `jumper0` + `fl1ght.exe`;
40 → `jumper1`; 50 → **csec-test** (received); 175 → `jumper2`; **200 → nitesec-test**;
325 → `jumper3`; 490 → `jumper4`; 500 → BitRunners test.

Notes:
- **The Dark Army is not invited by backdooring `.`** — its reqs are karma/kills/city/combat.
- `DeepscanV1.exe` (`scan-analyze` depth 5) makes `avmnite-02h` (layer 4) findable by hand;
  `AutoLink.exe` makes `connect` one click. Both are cheap to create — worth it purely to
  save the human's time on steps 2–4 above.

---

## 4. The BN1 endgame, and Source-File 4

### What ends BitNode 1

Install a backdoor on **`w0r1d_d43m0n`** (`src/Terminal/commands/backdoor.ts:62+`). Requires:

1. **hacking ≥ 3000** — `requiredHackingSkill: 3000` (`servers.ts:1553`) ×
   `WorldDaemonDifficulty`, which is **1** in BN1 (`src/BitNode/BitNodeMultipliers.ts:180`).
2. **5 open ports** — so `SQLInject.exe` is mandatory.
3. **The Red Pill installed.** The server is invisible unless
   `Player.hasAugmentation(TheRedPill, true)` (`src/Server/ServerHelpers.ts:340-343`), and it
   is only wired onto `The-Cave`'s network at prestige (`src/Prestige.ts:175-179`).

`TheRedPill`: **2,500,000 rep, $0**, sold only by **Daedalus**
(`src/Augmentation/Augmentations.ts:1953-1960`).

**Daedalus invite** (`src/Faction/FactionInfo.tsx:138-149`):
**30 augmentations installed** (`DaedalusAugsRequirement = 30` in BN1,
`src/BitNode/BitNodeMultipliers.ts:61`; NeuroFluxGovernor levels count),
**$100,000,000,000**, and **hacking ≥ 2500** *or* all four combat skills ≥ 1500.

So: 30 augs → $100b → hacking 2500 → Daedalus → 2.5m rep → Red Pill → hacking 3000 →
SQLInject → backdoor. Finishing BN1 grants **SF1**: 32GB starting home RAM and +16/24/28%
to all multipliers (`src/BitNode/BitNode.tsx:62-72`).

**Does anything decided today change that timeline?** Only one thing materially: **how soon
the install treadmill starts.** The 30-aug counter and the multiplier compounding are the
whole game; every hour spent at 3.6 exp/s without augs is an hour that does not count toward
either. Nothing else in this document (hacknet, stocks, which port program, purchased-server
sizing) changes the endgame more than a rounding error.

### Source-File 4 — confirmed unobtainable in BN1

**SF4 is the reward for destroying BitNode 4, "The Singularity"**
(`src/BitNode/BitNode.tsx:141-169`). There is no other source: it cannot be bought, found,
or unlocked from inside BN1. Its effect is to make `ns.singularity.*` usable in other
BitNodes, with a RAM penalty of **16× at level 1, 4× at level 2, 1× at level 3**.

**Consequence for this run:** `crime.js`, `training.js`, `faction.js`, `buyProgram.js`,
`createProgram.js`, `healer.js`, `bladeburner.js` stay dormant for the *entire* BitNode. Plan
permanently around a human doing these by hand:

| Must be clicked by the human | How often | Worth their attention? |
| --- | --- | --- |
| `connect` + `backdoor` on story servers | 4 times all node | **Yes** — each is a faction |
| Accept faction invites | per faction | Yes, seconds |
| Faction work for reputation | continuous | **Only when rep is the blocker** — 0.5 rep/s is grim; prefer contract rep (§5) |
| `create <program>.exe` | ~6 times | **Yes** — free, saves $1.5m–$250m |
| Buy + install augmentations | per reset | Yes, unavoidable |
| Travel / gym / university | rarely | No, on a pure-hacking route |

Even after SF4 in a later node, the 16× RAM penalty makes singularity calls expensive on a
small home machine — budget for that before rewriting the dormant scripts.

---

## 5. Coding contracts — the highest-value unautomated thing on the board

### What they pay in v3

`gainCodingContractReward` (`src/PersonObjects/Player/PlayerObjectGeneralMethods.ts:501-570`),
with `CONSTANTS.CodingContractBaseMoneyGain = 75e6`,
`CodingContractBaseFactionRepGain = 2500`, `CodingContractBaseCompanyRepGain = 4000`
(`src/Constants.ts:91-93`) and `adjustedScaling = rewardScaling / 3` (default `rewardScaling = 1`):

- **Money** = `75e6 × difficulty × CodingContractMoney × (1/3)` → **$25m × difficulty** in BN1.
- **FactionReputation** = `2500 × difficulty × (1/3)` → **833 rep × difficulty** to one random
  faction that offers hacking work.
- **FactionReputationAll** = same total, **split evenly** across all your hacking factions.
- **CompanyReputation** = `4000 × difficulty / 3` to a random employer.

**The fallback chain is the important part.** With no faction, faction rewards recurse into
Money *with the already-divided scaling*, dividing by 3 again:

| Rolled type (¼ each) | With **0 factions, 0 jobs** | With **1 faction (CyberSec)** |
| --- | --- | --- |
| FactionReputation | → Money **$8.33m** | 833 rep |
| FactionReputationAll | → Money **$8.33m** | 833 rep |
| CompanyReputation | → faction → Money **$2.78m** | → 278 rep |
| Money | **$25m** | **$25m** |
| **expected value** | **~$11.1m** | **~$6.25m + ~490 rep** |

### Difficulty is pinned to 1 right now

`maxDif = 2 × (total Source-File levels) + 1` (`src/CodingContract/ContractGenerator.ts:82-86`).
**With zero Source-Files, `maxDif = 1`**, so only these five types can spawn
(`difficulty: 1` in `src/CodingContract/contracts/`):

1. `Find Largest Prime Factor`
2. `Subarray with Maximum Sum`
3. `Total Ways to Sum`
4. `Algorithmic Stock Trader I`
5. `Encryption I: Caesar Cipher`

All five are trivial to solve. The flip side: rewards can't scale past difficulty 1 this
whole BitNode, so a contract is worth **$25m / 833 rep at most**, never more.

### Spawn rate and existing backlog

`tryGeneratingRandomContract` runs **3 tries every 10 minutes**, each ~25% likely while the
world holds few contracts (`src/CodingContract/ContractGenerator.ts:16-70`) → **~4.5
contracts/hour**, placed on a random non-purchased, non-`w0r1d_d43m0n` server. At ~2.2h of
playtime there should already be **~10 contracts sitting on the map**, expected value
**~$110m** at current (zero-faction) reward rates. That dwarfs the ~$40k/min the hacking loop
is producing.

There is **no admin-rights check** on `ns.codingcontract.*`
(`src/NetscriptFunctions/CodingContract.ts:12-60`) — contracts on unrooted servers count.

### The RAM problem, and the way around it

`contract.js` in this repo costs **26.35GB** (measured via `/rpc calculateRam`). Home is
16GB; no server on the map exceeds 16GB. The cost floor is structural
(`src/Netscript/RamCostGenerator.ts:387-394`, `CodingContractBase = 10`):
`attempt` 10GB + `getContractType` 5GB + `getData` 5GB + `ns.ls` 0.2 + base 1.6 = **21.8GB**.

**Recommended fix — split it in two and run the halves sequentially on 16GB home:**

- *reader*: `ns.ls` + `getContractType` + `getData` → writes JSON to a file. **≈11.8GB.**
- *solver*: reads that file, computes answers, `ns.codingcontract.attempt`. **≈11.8GB.**

That needs no purchase and works today. Alternatively buy one 32GB cloud server ($1.76m,
unaffordable at $488k right now but trivially so after the first contract).

Two defects in the existing `contract.js` to fix first — **I have not touched it; root `.js`
is owned by other agents:**

1. **It cannot solve `Encryption I: Caesar Cipher`** — 1 of the 5 spawnable types, so ~20%
   of contracts. Its solver table (`contract.js:37-410`) has 16 entries and Caesar is not
   among them. The spec (`src/CodingContract/contracts/Encryption.ts:60-70`): `data =
   [plaintext, leftShift]`, answer is a **string**, uppercase A–Z only, **spaces pass
   through unchanged**, `out = String.fromCharCode(((c − 65 − shift + 26) % 26) + 65)`.
   I checked the other four spawnable solvers (`Find Largest Prime Factor`,
   `Subarray with Maximum Sum`, `Total Ways to Sum`, `Algorithmic Stock Trader I`) against
   v3 line by line — **they are correct**. Returning a string from Stock Trader I is fine:
   `isValid` runs `convertAnswer` on string answers first (`Contract.ts:113-135`). But note
   `Algorithmic Stock Trader I` has `numTries: 5`, not the usual 10 — a buggy solver burns
   the contract fast.
2. It depends on the `BB_SERVER_MAP` localStorage key written by `spider.js:142`, so
   `spider.js` must have run first; and its hard-coded
   `contract_base_money_gain = 4000` (`contract.js:6`) is a 2021 value — the real constant is
   **75e6** with a 1/3 scaling. Only the `--print-expected` reporting is wrong, not the
   solving, but the number it prints is off by ~4 orders of magnitude.

### Sequencing note (now moot, but keep it for the next reset)

The zero-faction fallback makes contracts pay ~$11.1m each; with one faction joined it is
~$6.25m + ~490 rep. **CyberSec was accepted at 20:27, before any contract was solved**, so
the ~10-contract backlog is now worth roughly **$62m + 4,900 CyberSec rep** instead of
**$110m**. That is not a bad outcome — 4,900 rep is ~2.7 hours of a human clicking faction
work at 0.51 rep/s, and it is most of the way to `BitWire` (3,750) — but it is worth knowing
for next time: **on a fresh reset, clear the contract backlog before accepting the first
faction invite** if money is the binding constraint, and after if rep is.

**Corollary that still applies — keep your hacking-faction count low.** `FactionReputationAll`
splits its total across every faction offering hacking work, and `FactionReputation` picks one
at random. Joining Netburners/Tian Di Hui "because they're cheap" **dilutes** the rep flowing
to the faction whose augs you actually want. Join a faction when you intend to buy from it.

---

## Open questions / unverified

- Stock market unlock costs (WSE, TIX, 4S) in v3 — not read this pass.
- Whether `auto.js`/`buyserv.js` will spend money the moment it lands (they bought TOR +
  BruteSSH + a home upgrade unprompted between 20:14 and 20:24). If contract money is meant
  to go into cloud RAM in one lump, someone should check `buyserv.js`'s buying rule first.
- The actual number of contracts currently on the map — needs an in-game `ns.ls` sweep.
- Exact live roll of `avmnite-02h`'s `requiredHackingSkill` (202–220) — `analyze` it in game.

---
---

# Part II — revision, 2026-09-11 23:00Z

Written ~2.5 hours after Part I. **Part I's headline projection was wrong by more than an
order of magnitude** and several of its rankings invert once money stops being scarce.
Everything below supersedes Part I where they conflict. Same citation rules.

## TL;DR — the next three moves, and the trigger

1. **Retarget the exp fleet off `phantasy` onto `joesguns` or `foodnstuff`.** Free, instant,
   **~6× on experience** (28.3 exp/s measured → ~200 projected, model validated to 1.3% on
   two independent samples). Turns "NiteSec in ~2 hours" into "NiteSec in 20 minutes". §6.
2. **Upgrade home RAM 16 → 128GB for $45.1m.** Home RAM is the *only* purchase that survives
   an install, and it is the only lever on the two-hour dead zone that every future install
   pays. This **reverses Part I's cloud-over-home ranking** for money held near a reset. §7.
3. **Backdoor `avmnite-02h` at hacking 213** (exact, read from the save — not the 202–220
   range) → NiteSec invite → the human starts NiteSec hacking work immediately. Reputation,
   not experience and not money, is now the constraint. §8.

**Install trigger: NiteSec reputation 20,000 and $400m in the bank.** Buy, in this order,
NeuralRetentionEnhancement → Neurotrainer II → Neurotrainer I → NeuroFluxGovernor ×3.
**$390m, `hacking_exp` ×1.63, 6 of the 30 augs Daedalus wants.** Do not install before
NiteSec (the best CyberSec-only batch is ×1.14 exp for $144m, for the same reset cost); do not wait past
it (CRTX42-AA at 45,000 rep is 4–6 more hours of clicking, and is cheaper next life anyway
once favor kicks in). §7.

⚠️ **`buyserv.js` spends every dollar every 15 seconds** now that both port openers are
owned. The aug money cannot be accumulated until someone restarts it as
`run buyserv.js --reserve 400e6`. This is the most likely way the install slips by hours. §9.

**Do not accept the pending Sector-12 invite** — it halves the contract reputation reaching
NiteSec, and this reverses Part I's advice on CashRoot Starter Kit. §8.

**State at 22:56Z** (decoded from the live save via `POST /rpc {"method":"getSaveFile"}` —
this is a read-only telemetry path, no browser involved, and it carries far more than
`state.json` does):

| | Part I (20:27Z) | now (22:56Z) |
| --- | --- | --- |
| hacking | 100 | **176** (127,812 exp) |
| money | $488k | **$47m**, and `buyserv.js` is converting it to RAM as fast as it lands |
| purchased-server RAM | 0 | **1,232GB** → 2,016GB by 23:02 |
| total rooted RAM | ~236GB | **1,580GB** |
| CyberSec rep | 0 | **11,209** |
| programs | BruteSSH | BruteSSH + **FTPCrack** |
| contracts on the map | ~10 | **0 — the backlog is fully harvested** |
| factions | CyberSec | CyberSec (+ Sector-12 **invite pending, not accepted**) |

---

## 6. The exp projection was wrong by ~40×. Re-derivation.

Part I measured **3.6 exp/s** at ~108GB of fleet and projected NiteSec at 38 hours. Two
things were true and one inference was missing:

1. `calculateHackingExpGain = (3 + 0.3·baseDifficulty) · mults.hacking_exp · HackExpGain`
   (`src/Hacking.ts:30-38`), and **`grow` and `weaken` award exactly the same amount as
   `hack`** — `const expGain = calculateHackingExpGain(server, Player) * threads` appears
   identically in the `hack`, `grow` and `weaken` bodies
   (`src/NetscriptFunctions.ts:291`, `:365`, and the weaken block at `:365+`). The award does
   **not** depend on whether the op accomplished anything. So exp is *exactly* linear in
   threads, with no saturation as a target gets over-grown or drained.
2. Fleet RAM is linear in money (`$55k/GB` flat, Part I §1) and money arrives in $25m lumps.

⇒ **exp/s is linear in cumulative money spent on RAM.** Part I extrapolated a rate measured
at $0 of fleet spend across 38 hours during which the fleet grew 15×. That is the error.

Measured since: hacking 117→176 between 20:40 and 22:52 is 106,700 exp in 7,888s = **13.5
exp/s average**; the last half hour of that window (168→176) ran at **14.7 exp/s** on a
~236GB fleet. The fleet is now ~2,400GB.

### Measure exp from the save, not from level crossings

Level crossings are useless as an instrument here: the telemetry poll interval has drifted to
~4 minutes and, more importantly, **exp arrives in lumps**. With ~1,000 threads all running
the same op against the same target, every thread lands at once; on a target with a 480s
weaken time the player's exp counter is flat for eight minutes and then jumps by thousands.
`PlayerSave.exp.hacking` from `POST /rpc {"method":"getSaveFile"}` is exact and free:

```
23:06:22  exp=139,361.9  hk=179   (flat)
23:07:08  exp=139,361.9  hk=179   (flat)
23:07:53  exp=147,956.9  hk=181   +8,595 in one tick
```

Averaged over the 713s from 22:56 to 23:07:53: **28.3 exp/s on a 2,396GB fleet.** A later
sample (23:07:53 → 23:10:58, +7,605 exp) gives **41.1 exp/s** as hacking climbed 179→182 and
`phantasy`'s security fell toward minimum; over the whole 22:56–23:11 window it is
**30.8 exp/s**. Use ~30–40 exp/s as the current figure. The fleet was still ~2,400GB
throughout, and `auto.js` was still on `phantasy` at 23:11.

### That is ~6× worse than it should be, because of the target

A predictive model, validated twice: measured exp/s = `(3 + 0.3·baseDifficulty) / hackTime ×
threads × F`, with `hackTime = 5·(2.5·reqHack·hackDifficulty)/(hacking + 50)` and `F` the
fraction of ops that are hack-equivalent-speed (grow is 3.2× slower, weaken 4×).

| sample | target | threads | predicted (F=1) | measured | implied F |
| --- | --- | --- | --- | --- | --- |
| 22:53, hacking 176 | harakiri-sushi | 142 | 37.6 | 14.7 | **0.391** |
| 23:07, hacking 179 | phantasy | 977 | 73.2 | 28.3 | **0.386** |

Two independent samples, 7× apart in thread count, agree on `F` to **1.3%**. The model is
sound. Applying it at the current 977 threads and hacking 179:

| target | projected exp/s | time to hacking 213 |
| --- | --- | --- |
| **joesguns at min security** | **209** | **20 min** |
| **foodnstuff** | **202** | 21 min |
| sigma-cosmetics | 175 | 24 min |
| **joesguns at current security** | **171** | 25 min |
| harakiri-sushi | 102 | 42 min |
| **`phantasy` — what `auto.js` is targeting now** | **28.5** | **149 min** |
| silver-helix | 17.8 | 239 min |

`auto.js` picks its target by money rate (`.telemetry/auto.txt`: `"target": "phantasy",
"targetRatePerSec": 512`) and retargeted upward as hacking rose. **That is the right rule
when money binds and the wrong rule now** — it has spent the entire 10× fleet expansion
buying back a 4× worse target, netting only 2×. The fleet grew from 236GB to 2,396GB and the
exp rate went from 14.7/s to 28.3/s.

**Retargeting to `joesguns` or `foodnstuff` is worth ~6× on exp and turns "NiteSec in 2.5
hours" into "NiteSec in 20 minutes."** It costs nothing. This is the highest-value action
available right now, and it belongs to whoever owns `auto.js`/`early.js` — not to me.

### What that means for NiteSec

**`avmnite-02h` requires hacking `213`** — exact, read from `AllServersSave`, not the
202–220 range. (Also read out of the same save, so no one needs to `analyze` them:
`I.I.I.I` = **348**, `.` = **523**, `run4theh111z` = **539**, `The-Cave` = 925,
`fulcrumassets` = 1233, `w0r1d_d43m0n` = 3000.)

`exp(213) = e^(413/32) − 534.6 = 402,287`. From 147,957 (measured 23:07:53) that is
**254,330 exp** — **~2 hours at the rate actually being achieved, or ~20 minutes at the rate
the same fleet would achieve on a sensible target** (see below).

**FTPCrack.exe is already on home**, so `avmnite-02h` needs no purchase and no program — only
the level, then `connect` + `backdoor`. **NiteSec is tens of minutes away, not 38 hours.**

### Why the cheap targets win — the per-thread table

Exp per op is `3 + 0.3·baseDifficulty`; op time is
`5·(2.5·reqHack·hackDifficulty + 500)/(hacking + 50)` (`src/Hacking.ts:58-79`), with grow at
3.2× and weaken at 4× that. **The exp award is identical for all three ops**, so the only
thing that matters is ops-per-second: **low `requiredHackingSkill` and low current security
win**, and `baseDifficulty` helps only through the numerator. Hack-time basis, live server
stats, hacking 176:

| target | exp/s/thread at *current* security | at min security |
| --- | --- | --- |
| **joesguns** (req 10) | 0.445 | **0.542** |
| **foodnstuff** (req 1) | **0.524** | 0.534 |
| sigma-cosmetics (req 5) | 0.455 | 0.505 |
| nectar-net (req 20) | 0.327 | 0.479 |
| harakiri-sushi (req 40) | 0.265 | 0.339 |
| neo-net (req 50) | 0.131 | 0.316 |
| iron-gym (req 100) | 0.068 | 0.181 |
| `phantasy` (req 100) — **current target** | **0.074** | 0.181 |
| silver-helix (req 150) | 0.046 | 0.128 |

The counter-intuitive part: **`phantasy` and `silver-helix` are the *worst* exp targets
precisely because they are the *best* money targets.** High `requiredHackingSkill` is what
makes a server rich and it is also what makes every op on it slow. Money and exp want
opposite targets, and with 2,400GB there is room to split the fleet: exp-farm `joesguns` /
`foodnstuff`, money-batch `silver-helix` ($1.125b max) and `phantasy` ($600m) — both already
rooted.

Prepping helps too but less than retargeting: `joesguns` at min security (5.0) is 22% better
than at its current 10.5, whereas moving off `phantasy` is worth 600%.

### Where the exp curve stops paying

`skill = floor(32·ln(exp + 534.6) − 200)` is logarithmic, so exp *cost* is exponential in
level. From the current 127,812:

| target level | exp needed | Δ from now | at 150 exp/s |
| --- | --- | --- | --- |
| 213 (`avmnite-02h`) | 402,287 | 274,475 | 30 min |
| 250 | 1,279,631 | 1.15m | 2.1 h |
| 300 | 6,106,794 | 5.98m | 11 h |
| 348 (`I.I.I.I`) | 27.5m | 27.4m | 51 h |
| 400 | 139.0m | 138.9m | 257 h |
| 539 (`run4theh111z`) | 3.0b | — | forever |

**Hacking 213–250 is the natural plateau for this life.** `I.I.I.I` (348) is 51 hours away at
a constant 150 exp/s and only reachable by growing the fleet another order of magnitude —
which is a *money* problem, i.e. a post-install problem. Past ~250 the binding constraint
stops being exp and becomes **reputation**, which is bounded by human clicking, not by RAM.
That flip is the whole reason to install.

---

## 7. The first install — the actual call

### What an install costs, precisely

`installAugmentations` → `prestigeAugmentation` (`src/Prestige.ts:60-110`):

- `prestigeAllServers()` deletes every server but home, then **`initForeignServers()`
  re-creates the world from scratch** — so **every coding contract on the map is destroyed**,
  and so is every purchased server, every root, and every backdoor.
- `prestigeHomeComputer(homeComp)` clears home's **programs** (keeping `NUKE`/`fl1ght`) but
  **not `maxRam`** — home RAM is the only purchasable thing that survives.
- Money resets; then `for (const ownedAug of Player.augmentations) Player.gainMoney(aug.startingMoney)`
  and `homeComp.pushProgram(program)` — this is the CashRoot hook.
- `faction.prestigeAugmentation()` banks rep as favor and zeroes rep
  (`src/Faction/Faction.ts:77-84`). `repToFavor(r) = ln(1 + r/25000)/0.019802627`
  (`src/Faction/formulas/favor.ts`). **Current CyberSec 11,209 rep → 18.7 favor → +18.7% rep
  rate forever.**
- Faction *invites* survive only for factions with `keep: true` in `FactionInfo.tsx`;
  Sector-12 has no such flag, so its invite is lost and must be re-earned (trivial — it
  re-fires at $15m).

So the real cost of an install is **the dead zone**: hacking 1, $1,000, no port programs, no
roots, and a 16GB home. This run's dead zone (18:16 → 20:14, hacking 1 → first $700k → TOR +
BruteSSH) took **two hours**.

### Therefore: buy home RAM. This reverses Part I's ranking.

Part I said "cloud RAM over home RAM over hacknet" and that is right *within a life*, on
$/GB. It is wrong *across* an install, because during the dead zone **cloud RAM cannot be
bought at any price — there is no money.** Home RAM is the only thing that shortens the dead
zone, and you pay for it once instead of every cycle.

`getUpgradeHomeRamCost = currentRam × 32,000 × 1.58^log2(currentRam)`
(`src/PersonObjects/Player/PlayerObjectServerMethods.ts:30-40`, verified again):

| step | cost | cumulative from 16GB |
| --- | --- | --- |
| 16 → 32GB | $3.19m | $3.19m |
| 32 → 64GB | $10.08m | $13.3m |
| 64 → 128GB | $31.86m | **$45.1m** |
| 128 → 256GB | $100.7m | $145.8m |
| 256 → 512GB | $318.2m | $464.0m |

**Buy to 128GB now ($45.1m total).** 128GB of home RAM is ~53 `early.js` threads from the
first second of every future life — more than the entire fleet had at 22:20 when it was
producing 14.7 exp/s. It should cut a two-hour dead zone to roughly fifteen minutes, and it
does that on every install for the rest of the BitNode. 128→256GB ($100.7m) is worth it once
you are committed to ≥4 more installs. 256→512GB ($318m) is not, yet. **Home cores are a
trap: `1e9 × 7.5^cores` — the first extra core is $1 billion**
(`getUpgradeHomeCoresCost`, same file).

### The 1.9^n batch multiplier is much more punishing than Part I implied

`getAugCost`: `moneyCost = baseCost × 1.9^(queued non-SoA augs) × AugmentationMoneyCost`
(`src/Augmentation/AugmentationHelpers.ts:120-163`, `getGenericAugmentationPriceMultiplier`
at `:32-36`; BN1 leaves `AugmentationMoneyCost = 1`). Rep cost is **not** multiplied.
Buying most-expensive-first minimises the total — but the total still explodes:

| batch | exp mult | cost |
| --- | --- | --- |
| NeuralRetEnh + Neurotrainer2 + Neurotrainer1 | **×1.581** | **$350m** |
| + ArtificialSynapticPotentiation | ×1.693 | $592m |
| + CSPG1 + SynapticEnhancement + CSPG2 + ENM + BitWire (all 9) | ×1.74 | **$5.57b** |

The nine-aug batch costs 16× the three-aug batch for **+10% more exp**. Part I's "buy every
aug you can afford before installing" is wrong. The correct rule is:

> **Buy the three or four augs with the best effect-per-base-dollar and install. Everything
> past ~4 augs in one batch is priced out by 1.9^n. Short cycles beat big batches, because
> rep resets but favor compounds.**

### Which augs, ranked by what actually binds (`hacking_exp × hacking_speed`)

Extracted from `src/Augmentation/Augmentations.ts` (each entry's `factions:` array):

| aug | faction | rep | base $ | exp-rate mult | hacking mult | $ per 1% exp |
| --- | --- | --- | --- | --- | --- | --- |
| **Neurotrainer I** | CyberSec | 1,000 | $4m | ×1.10 | — | **$0.40m** ← best in the game |
| **Neurotrainer II** | NiteSec | 10,000 | $45m | ×1.15 | — | **$3.0m** |
| **NeuralRetentionEnhancement** | NiteSec | 20,000 | $250m | **×1.25** | — | $10.0m |
| SynapticEnhancement | CyberSec | 2,000 | $7.5m | ×1.03 | — | $2.5m |
| ArtificialSynapticPotentiation | NiteSec | 6,250 | $80m | ×1.071 | — | $11.3m |
| CRTX42-AA | NiteSec | 45,000 | $225m | ×1.15 | ×1.08 | $15.0m |
| CranialSignalProcessors G2 | CyberSec/NiteSec | 18,750 | $125m | ×1.02 | ×1.07 | $62.5m |
| CranialSignalProcessors G1 | CyberSec/NiteSec | 10,000 | $70m | ×1.01 | ×1.05 | $70m |
| CranialSignalProcessors G3 | NiteSec | 50,000 | $550m | ×1.02 | ×1.09 | $275m |
| **BitWire** | CyberSec/NiteSec | 3,750 | $10m | ×1.00 | ×1.05 | — |
| **ENM** | NiteSec | 15,000 | $250m | ×1.00 | ×1.08 | — |
| DataJack | NiteSec | 112,500 | $450m | — | `hacking_money` ×1.25 | — |

**`NeuroFluxGovernor` is sold by CyberSec** — and by every faction except SoA, Bladeburners
and the Church; its `factions:` field is `Object.values(FactionName).filter(...)`
(`Augmentations.ts:1197-1202`). Base **500 rep / $750k**, both ×`1.14^level`
(`CONSTANTS.NeuroFluxGovernorLevelMult = 1.14`), and the money side *also* takes the 1.9^n
batch multiplier. It gives **+1% to essentially every multiplier** including `hacking_exp`,
and **each level counts toward Daedalus's 30-augmentation requirement**. Bought as the last
items of a batch that already has 3 augs queued: level 1 = $5.1m, level 2 = $11.1m,
level 3 = $24.1m, level 4 = $52.2m, level 5 = $113m. **Take three levels (~$40m for +3%
everything and +3 toward the Daedalus counter); stop there.**

### The recommended install-#1 batch

| order | aug | rep | multiplier applied | cost |
| --- | --- | --- | --- | --- |
| 1 | NeuralRetentionEnhancement (NiteSec) | 20,000 | ×1.9⁰ | $250.0m |
| 2 | Neurotrainer II (NiteSec) | 10,000 | ×1.9¹ | $85.5m |
| 3 | Neurotrainer I (CyberSec) | 1,000 | ×1.9² | $14.4m |
| 4 | NeuroFluxGovernor lvl 1 | 500 | ×1.9³ | $5.1m |
| 5 | NeuroFluxGovernor lvl 2 | 570 | ×1.9⁴ | $11.1m |
| 6 | NeuroFluxGovernor lvl 3 | 650 | ×1.9⁵ | $24.1m |
| | **total** | | | **$390.4m** |

Result: `hacking_exp` **×1.63**, and +3% to hacking, hacking_speed, hacking_chance,
hacking_money and everything else. **6 of the 30 augs Daedalus wants.** Rep required:
**NiteSec 20,000** and **CyberSec 1,000** (already have 11,209). NFG must be bought last and
in ascending level — `getLevel()` increments per purchase, so you cannot buy level 3 first.

### ⇒ The trigger

> **Install when NiteSec reputation reaches 20,000 and cash is ≥ $400m. Do not install
> before NiteSec; do not wait past it.**

Both halves matter:

- **Not before.** The whole CyberSec-only batch reachable today (Neurotrainer I +
  SynapticEnhancement + BitWire + CSPG1, $144m at 11,209 rep) is worth only `hacking_exp`
  ×1.10 / `hacking_speed` ×1.04. NiteSec quadruples the value of the same reset for the same
  reset cost. NiteSec is ~30 minutes of exp away. There is no version of "install now" that
  wins.
- **Not past it.** CRTX42-AA (45,000 rep) and CSPG3 (50,000 rep) are 4–6 more hours of human
  faction-work clicking for +15% exp and +17% hacking. Those same hours spent *after* the
  install compound against a 1.63× exp multiplier instead of a 1.0× one — and because rep
  resets to favor while favor is permanent, CRTX42-AA is *cheaper* to reach on install #2
  (NiteSec favor ≈ `repToFavor(20000)` = **29.7**, i.e. **+29.7% rep rate** next life).
- **The fleet is not the thing to protect.** It is worth ~$110m of purchased RAM today and
  will be worth more tomorrow, but it is rebuilt from income, and income after a 2,000GB-era
  install comes back in under an hour (see §9). What the reset actually costs is the dead
  zone, and §7's home-RAM purchase is the lever on that — not delay.

**The binding constraint on that trigger is NiteSec rep, not money** (§8). Plan accordingly:
the human should start NiteSec faction work the minute the invite lands.

---

## 8. Reputation is the new bottleneck — the numbers

`getHackingWorkRepGain(p, favor) = (hacking + int/3)/975 × mults.faction_rep ×
currentNodeMults.FactionWorkRepGain ×
(1 + favor/100) × shareBonus` **per cycle**, at 5 cycles/s
(`src/PersonObjects/formulas/reputation.ts:16-25`, `CONSTANTS.MaxSkillLevel = 975`,
`gameCPS = 5`). Unfocused work is ×0.8 (`Player.focusPenalty()`,
`PlayerObjectGeneralMethods.ts:622-626`, `CONSTANTS.BaseFocusBonus`).

| source | rep/hour at hacking 213 | notes |
| --- | --- | --- |
| faction hacking work, **focused** | **3,932** | human must not use the UI |
| faction hacking work, **unfocused** | **3,146** | ×0.8; **scripts keep running either way** |
| coding contracts | ~2,200 | 4.5 contracts/h × ~490 rep, **split across all hacking factions** |
| `ns.share()` on 500 threads (2TB) | ×1.249 on the work rows only | `1 + ln(effectiveThreads)/25`, `src/NetworkShare/Share.ts:43-48` |

Faction hacking work also grants hacking exp — but only `hackExp: 2` per cycle scaled by
`1/gameCPS`, i.e. **2 exp/s** (`FactionWorkStats`, `src/Work/Formulas.ts:39-41`). Against a
fleet doing 100+ exp/s that is noise. **So faction work and script grinding are not a
trade-off — they run in parallel.** The human clicking "Hacking Contracts" for NiteSec costs
the run nothing but their attention.

**NiteSec 0 → 20,000 rep ≈ 4–5 hours** of unfocused faction work plus contract drip. That,
not money and not exp, is the length of the runway to install #1.

Three consequences:

1. **Do not accept the Sector-12 invite yet.** `Sector12` has `offerHackingWork: true`
   (`FactionInfo.tsx:541-545`), and contract rep rewards either pick one hacking faction at
   random or split evenly across all of them (`gainCodingContractReward`,
   `PlayerObjectGeneralMethods.ts:514-536`). Joining Sector-12 **halves the contract rep
   reaching NiteSec** for a faction whose only hacking aug, Neuralstimulator, costs 50,000
   rep and **$3b**. This reverses Part I's "worth taking before install #1 or #2". The invite
   costs nothing to leave pending; take it *after* NiteSec rep is banked, or never. Same
   argument, more strongly, for Netburners and Tian Di Hui.
2. **CashRoot Starter Kit is a trap at this stage** — not because the effect is bad
   (`startingMoney: 1e6` + `BruteSSH.exe` every install is genuinely good) but because it
   costs **12,500 Sector-12 rep** you can only earn by joining Sector-12 and diluting NiteSec,
   plus **$125m** competing directly with NeuralRetentionEnhancement. And $45m of home RAM
   buys down the same dead zone far harder than $1m of starting cash does. Revisit around
   install #3, once NiteSec rep is favor-accelerated.
3. Once hacking is past ~250 and rep is the only thing left to earn, **`ns.share()` on the
   idle fleet is finally worth running** (+25% on faction work at 500 threads, 2.4GB each,
   `RamCostGenerator.ts:575`). Not before — while exp still pays, share is a bad trade.

**`NeuroreceptorManager`** (Tian Di Hui, 75,000 rep, $550m) removes the focus penalty
entirely — `focusPenalty()` returns 1 unconditionally if you own it. That is the classic
"human attention" aug and it is worth remembering, but 75,000 Tian Di Hui rep is many lives
away.

---

## 9. What the contract windfall should buy — revised ranking

The backlog paid out: **CyberSec went 0 → 11,209 rep and $488k → $105m between 22:35 and
22:53.** Both facts come from the decoded save. Reward distribution confirmed:
`getRandomReward` picks uniformly from 4 types when `CodingContractMoney > 0`
(`ContractGenerator.ts:179-190`), so with exactly one faction joined the EV is
**$6.25m + ~486 rep per contract**, and with **zero** factions it is **$11.1m** (all three rep
types fall back through `Money` with the scaling already divided). **There are now 0 contracts
on the map**; they respawn at ~4.5/hour, so contracts are a ~$28m/h + ~2,200 rep/h drip, not
a windfall, until the next reset.

Spend order, revised:

1. **Home RAM to 128GB — $45.1m.** New at #1. It is the only purchase that survives an
   install, and it is the only lever on the dead zone. Manual UI purchase (no SF4).
2. **Reserve $400m for the install-#1 aug batch.** ⚠️ **`buyserv.js` spends the entire
   surplus every 15 seconds** — `floorReserve: 0` once BruteSSH and FTPCrack are owned, which
   they now both are, and it loops `while surplus > 0` buying the largest affordable server
   (`buyserv.js`, SETTINGS + the `for (let pass = 0; pass < 12; pass++)` loop). **Money
   cannot be accumulated for augs while it runs at default settings.** Restart it as
   `run buyserv.js --reserve 400e6` when the aug batch becomes the goal. This is the single
   most likely way the install gets accidentally delayed by hours.
3. **Cloud RAM — everything else, immediately.** Still correct within a life: flat $55k/GB,
   no volume discount, exp exactly linear in threads. `buyserv.js`'s own reasoning holds.
4. **Not more port programs.** `relaySMTP` ($5m / hacking 250) opens `I.I.I.I` at hacking
   **348** — 51 hours of exp away, i.e. a later-life purchase. The 2-port world
   (BruteSSH + FTPCrack, both owned) already reaches everything relevant: `avmnite-02h` (213),
   `omega-net` (215, $1.7b), `crush-fitness` (235, $1.3b), `johnson-ortho` (275, $2.0b),
   `the-hub` (318, $4.45b). There is nothing to buy access to.
5. **Not hacknet.** Unchanged from Part I §1.
6. **Not the stock market.** Resolved below.

### Stock market — Part I's UNVERIFIED, resolved

`src/StockMarket/data/Constants.ts`, with BN1 leaving `FourSigmaMarketDataCost` and
`FourSigmaMarketDataApiCost` at 1 (`BitNodeMultipliers.ts:85,88`):

| unlock | cost |
| --- | --- |
| WSE account (manual trading in the UI) | **$200,000,000** |
| **TIX API** (required for any `ns.stock.*` call, i.e. for `stock.js`) | **$5,000,000,000** |
| 4S Market Data | $1,000,000,000 |
| 4S Market Data TIX API | $25,000,000,000 |
| commission per trade | $100,000 |

**`stock.js` cannot run for $5.2b — that is off the table for this BitNode's early lives.**
Manual WSE at $200m is affordable but is a coin flip without 4S data and needs constant human
clicking. **Verdict: ignore the stock market entirely until well after multiple installs.**
Part I's open question is closed.

---

## 10. Revised milestone list

| # | Milestone | Trigger | Status |
| --- | --- | --- | --- |
| 1 | Harvest the contract backlog | — | ✅ done 22:35–22:53, $105m + 11,209 rep |
| 2 | Accept CyberSec | — | ✅ |
| 3 | Create/own FTPCrack | — | ✅ on home |
| 4 | **Retarget the exp fleet off `phantasy` → `joesguns`/`foodnstuff`** | **now** | **~6× exp for free**; 2.5 h → 20 min to NiteSec (§6) |
| 5 | **Home RAM 16 → 128GB, $45.1m** | **now** | survives every install (§7) |
| 6 | **Backdoor `avmnite-02h` → NiteSec** | **hacking 213** | 20 min retargeted / 2.5 h as-is |
| 7 | **Human works NiteSec hacking contracts** | on invite | 4–5 h to 20,000 rep — the runway (§8) |
| 8 | **`run buyserv.js --reserve 400e6`** | when NiteSec rep > ~12k | otherwise the aug money is spent (§9) |
| 9 | **Install: NRE + NT2 + NT1 + NFG×3, $390m** | **NiteSec rep 20,000 + $400m** | exp ×1.63, 6/30 Daedalus augs |
| 10 | Post-install: **do not join any faction** until the fleet is rebuilt | — | zero-faction contracts pay $11.1m vs $6.25m (§9) |
| 11 | Rejoin CyberSec/NiteSec, repeat on a ~4 h cycle | — | favor compounds: +18.7% / +29.7% rep rate |
| 12 | `relaySMTP` → `I.I.I.I` (hacking 348) | several lives out | 27m exp; needs ~10× the fleet |

### The post-install opening, worth planning now

Because rep rewards fall back to money with **no faction joined**, and because the map
respawns empty, the optimal first hour after an install is:

1. Do **not** accept any faction invite. Contracts pay **$11.1m** EV each instead of $6.25m.
2. Run `contract.js` from minute one on 128GB of home RAM — it needs ~21.8GB structurally
   (Part I §5) and home will finally fit it without the reader/solver split.
3. Buy cloud RAM with everything; re-root; re-level.
4. Join CyberSec and NiteSec only once hacking income dominates contract income — at that
   point the contract stream is worth more as rep than as money.

⚠️ **`contract.js` still cannot solve `Encryption I: Caesar Cipher`** (Part I §5, defect 1),
which is 1 of the only 5 contract types that can spawn at `maxDif = 1`. That is ~20% of all
contract value — ~$5.5m/hour — being left on the map. Unowned by me; still unfixed as of
22:56.

---

## Open questions after Part II

- ~~Actual sustained exp/s at ~2,000GB~~ — **resolved: 28.3 exp/s measured on a 2,396GB
  fleet**, against ~200 predicted for the same fleet on a sensible target. The instrument to
  use is `PlayerSave.exp.hacking` from `POST /rpc {"method":"getSaveFile"}`, sampled over
  ≥10 minutes; level crossings and `status.txt`'s `expPerSec` are both too coarse because exp
  arrives in multi-thousand lumps every weaken-cycle.
- **Hacking income is ~0.** `status.txt` reports `incomePerSec: 0`, and money sat at exactly
  $487,820 from 20:20 to 22:35 — every dollar since has come from contracts. Every rooted
  server except `foodnstuff` and `n00dles` is sitting at 4% of max money with security well
  above minimum. The fleet is generating exp but no money. Rebuilding after an install
  assumes income recovers; **that assumption is currently unverified and belongs to whoever
  owns `hack.js`.**
- ~~New purchased servers may be idling~~ — **resolved**: by 23:05 `auto.txt` reports
  `ramUsed: 2353 / ramTotal: 2380` and no server in `status.txt` has `usedRam: 0`. `auto.js`
  picks up mid-run purchases within a cycle. The 22:53 snapshot was just caught between
  `buyserv.js` buying and `auto.js`'s next cycle.
- **Home's 16GB is idle** (`status.txt`, `home: usedRam 0`). Small, but it is 6 more
  `early.js` threads and it is free.
- The `F ≈ 0.389` hack-equivalent-op fraction is an empirical fit from two samples of the
  *same* script (`early.js`) on *unprepped* targets. A real batcher that holds a target at
  min security should push `F` toward 1.0 — i.e. there may be another ~2.5× in exp on top of
  the retargeting, but that is the optimizer's number to establish, not mine.

---
---

# Part III — the contract-dilution question, priced. 2026-09-11 23:40Z

Written ~40 minutes after Part II, to answer one question the lead posed: *does joining a
faction cost us contract money, and if so is NiteSec still worth joining?* The answer turned
out to be short, and checking it surfaced two larger things — hacking income came alive and is
now enormous, and the fleet is in a pathological saturation state. Part III supersedes
Part II where they conflict.

## TL;DR

1. **Joining NiteSec costs exactly $0 of contract income. Accept the invite the second it
   appears.** The money cliff is entirely between *zero* factions and *one*; it does not
   deepen with the second, third or tenth. We crossed it at 20:27 and cannot uncross it. §11.
2. **The Sector-12 mistake is real but small, and an install erases it.** It halved contract
   rep (already observed live: a contract at 23:16 paid `833.3 rep for Sector-12`), but cost
   no money. `Player.factions = []` on prestige, so it is gone at install #1. §11.
3. **Never take a job.** With ≥1 faction, a job converts the 25% `CompanyReputation` roll from
   faction rep into *company* rep and adds no money. Strictly negative. §11.
4. **Money is no longer a constraint at all.** Measured after the `auto.js` fix:
   `moneySourceA.hacking` went **$0 → $772.9m between 23:20 and 23:45 = $1.86b/hour**. The
   $400m aug budget is ~13 minutes of income. §12.
5. **⚠️ The fleet is badly saturated and is now losing more than it gains.** 10,352GB, 4,419
   `early.js` threads, all on `phantasy`, all in lockstep. At 23:38 the *entire fleet* had
   been blocked on a single 423-second `weaken` for seven minutes, earning 3.5 exp/s and $0.
   More RAM now makes this **worse**, not better. §13.
6. **Revised install trigger: NiteSec rep 20,000 + $700m** (up from $400m — money is free now,
   so buy `ArtificialSynapticPotentiation` too). §14.

---

## 11. Contract reward dilution — the actual arithmetic

### The distribution is uniform over four types

`getRandomReward()` (`src/CodingContract/ContractGenerator.ts:179-190`) builds
`[FactionReputation, FactionReputationAll, CompanyReputation]` and pushes `Money` when
`currentNodeMults.CodingContractMoney > 0` (it is 1 in BN1), then returns
`{ type: getRandomIntInclusive(0, validRewardTypes.length - 1) }`. Note it returns the **index**
as the type — which is correct only because `CodingContractRewardType` is a numeric enum
declared in exactly that order (`src/CodingContract/Contract.ts:13-18`:
`FactionReputation=0, FactionReputationAll=1, CompanyReputation=2, Money=3`).

⇒ **Uniform 25% per type.** No weighting, no scaling by faction count.

### The fallback chain, read precisely

`gainCodingContractReward` (`src/PersonObjects/Player/PlayerObjectGeneralMethods.ts:501-570`).
`adjustedScaling = rewardScaling / 3`, and **each recursion passes `adjustedScaling` in as the
next call's `rewardScaling`**, so every hop divides by 3 again:

- `FactionReputation` → if `factionsThatAllowHacking.length === 0`, recurse into **`Money`**
  (line 517). Otherwise **one faction chosen at random** gets `2500 × difficulty × scaling/3`.
- `FactionReputationAll` → same zero-faction fallback (line 527). Otherwise
  `floor(total / n)` to **each** of the n factions.
- `CompanyReputation` → if `Object.keys(Player.jobs).length === 0`, recurse into
  **`FactionReputation` or `FactionReputationAll`, 50/50** (lines 540-548) — **not** into
  `Money`. It only reaches money if you also have zero factions, two hops later.
- `Money` → `75e6 × difficulty × CodingContractMoney × scaling/3`.

**The lead's framing was one step off:** no-job pushes rewards toward *faction rep*, not toward
money. Money only appears when the faction list is empty.

### The priced table (difficulty 1, `rewardScaling` 1, BN1)

| situation | money EV / contract | rep EV / contract **to one named faction** |
| --- | --- | --- |
| **0 factions, no job** | **$11.111m** | — |
| 0 factions, **with a job** | $10.417m | — |
| 1 faction (CyberSec, 20:27–23:12) | **$6.250m** | 485.9 |
| **2 factions (CyberSec + Sector-12 — now)** | **$6.250m** | **242.8** |
| 2 factions **+ a job** | $6.250m | 208.2 |
| **3 factions (+ NiteSec)** | **$6.250m** | **161.8** |
| 4 factions | $6.250m | 121.4 |

> **The money column is flat at $6.250m for every n ≥ 1.** Faction count changes *only* the rep
> split. There is no per-faction money tax.

At the ~4.5 contracts/hour spawn rate (`tryGeneratingRandomContract`, 3 tries/10min at
p ≈ 0.25 when the map is near-empty — `ContractGenerator.ts:16-70`):

| | contract $/hour | rep/hour to the faction you care about |
| --- | --- | --- |
| 0 factions | **$50.0m** | 0 |
| 1 faction | $28.1m | 2,187 |
| 2 factions (now) | $28.1m | 1,092 |
| 3 factions (+NiteSec) | $28.1m | **728** |

### Answers to the four questions

**1. Distribution.** Uniform 25%. Money EV per contract is $11.111m with zero factions and no
job, $6.250m with one or more factions. The cliff is 1.78× and it is a *step*, not a slope.

**2. Join NiteSec?** **Yes, immediately on invite.** It costs $0. NiteSec reputation is
obtainable no other way, and it is the sole source of `NeuralRetentionEnhancement`
(exp ×1.25) and `Neurotrainer II` (exp ×1.15) — the difference between an install worth
exp ×1.13 and one worth exp ×1.63. Declining to join would forfeit that to save nothing.
Acceptance also switches on **+150 rep/hour of passive gain** that starts the moment you
join and is *not* split across factions (see Open Questions: `processPassiveFactionRepGain`,
`src/Faction/FactionHelpers.tsx:132-170`) — so every minute of delay is a minute of NiteSec
rep burned, against the one quantity that actually gates the install.

**3. Sequencing trick?** **Worth exactly $0 — do not do it.** Delaying NiteSec acceptance
cannot raise contract money above $6.250m/contract, because CyberSec and Sector-12 are already
joined and one faction is enough to switch off the money fallback. Every minute of delay
instead *loses* 728 rep/h of contract drip plus the entire ~3,146 rep/h faction-work stream,
against the constraint that actually binds. The only window where the trick ever existed was
before the *first* faction, i.e. before 20:27, and it recurs post-install (§15).

**4. Does a job matter?** **Take no job.** With ≥1 faction a job costs `0.25 × 2500/9 / n`
faction rep per contract (69.4/n) and returns 1,333 company reputation, which is worth nothing
on a pure-hacking route. With *zero* factions a job is worse still — $10.417m vs $11.111m EV.
There is no configuration in which a job helps.

### Live confirmation, and the Sector-12 post-mortem

`.telemetry/contracts.txt` at 23:16:30 — the first contract solved after joining Sector-12:

```
"rewards": [ "Gained 833.3333333333333 faction reputation for Sector-12" ]
```

That is `FactionReputation` picking Sector-12 out of two, exactly as modelled. Save at 23:23:
CyberSec **11,275** rep, Sector-12 **859.6**.

**How much did the mistake cost?** Only rep, and only on contracts solved while both are
joined. At ~4.5 contracts/h the loss is ~1,092 rep/h that would otherwise reach CyberSec (and
later NiteSec). Over a 5-hour runway to install #1 that is ~5,500 NiteSec rep — roughly
1.4 hours of extra unfocused faction clicking. Annoying; not structural.

**And it is erased by the install.** `Player.prestigeAugmentation()` sets
`this.factions = []` and `this.factionInvitations = []`
(`src/PersonObjects/Player/PlayerObjectGeneralMethods.ts:109-113`), and
`Faction.prestigeAugmentation()` sets `isMember = false` after banking favor
(`src/Faction/Faction.ts:77-85`). No faction in `FactionInfo.tsx` carries the `keep` flag in
this version — `grep "keep: true"` returns nothing — so **no invites survive either**. Post
install you are factionless, and §15's zero-faction opening applies in full.

**Corollary — the rule to carry forward:** faction count is a *rep* decision only. The
question "should I join X" reduces to "will X's share of the rep split cost me more than X's
augs are worth", and money never enters it. Joining CyberSec + NiteSec and nothing else is
right; Sector-12 was wrong on rep grounds alone, at roughly the cost stated above.

---

## 12. Hacking income came alive — and money stopped being the constraint

The `auto.js` retarget bug is fixed and the effect is dramatic. From the decoded save
(`moneySourceA`, which is cumulative since the last install):

| source | lifetime this install |
| --- | --- |
| **hacking (scripts)** | **$477.2m** |
| coding contracts | $100.0m |
| purchased servers | **−$571.8m** |
| cash in hand at 23:31 | $3.2m |

Money sat at exactly $2,305,577.31 from 23:07 to 23:20 — hacking income was still $0 for that
whole window, because `early.js`'s `MONEY_FLOOR = 0.5` had the fleet growing `phantasy` and it
had not yet crossed 50% of its $600m cap. It crossed, and **$477m arrived in roughly eleven
minutes.** `buyserv.js` converted all of it: purchased-server RAM went **2,032GB → 10,352GB**
in the same window.

**Measured, not extrapolated** (`POST /rpc {"method":"getSaveFile"}`, 20s sampling,
23:24–23:38): the phantasy cycle is `grow → weaken → hack → weaken`, drains the server to zero
and refills it to its $600m cap each time.

**Two complete cycles measured**, `moneySourceA.hacking` sampled from the save:

| clock | hacking income, cumulative | Δ |
| --- | --- | --- |
| 23:20 | $0 | — |
| 23:31 | $477.2m | +$477.2m |
| 23:45 | **$772.9m** | +$295.7m |

⇒ **$772.9m in 25 minutes = $515k/s = $1.86b/hour**, lumpy at ~500s granularity (per-cycle
revenue is pinned at the target's `moneyMax`). `auto.txt` reported `incomePerSec: 289,361` at
23:25, which is the script-lifetime average and understates the steady state because it
includes the dead opening. Cash in hand at 23:45 was **$298.9m and climbing** —
purchased-server RAM has been flat at 10,352GB since 23:29, so `buyserv.js` has stopped
spending and the aug budget is accumulating unaided.

**This inverts Part II's priorities.** Part II treated $400m as a target to be defended from
`buyserv.js` over hours. It is now ~20 minutes of income. Consequences:

- **`run buyserv.js --reserve 700e6` costs almost nothing** (§13 explains why: the fleet is
  already past the point where more RAM raises income). Part II called this "the single most
  likely way the install slips by hours" — it is still the right command, but the reason is now
  *the fleet is oversized*, not *the money is scarce*.
- **Home RAM is affordable well past 128GB.** Part II's $45.1m ladder to 128GB is ~3 minutes of
  income. 256GB is $145.8m cumulative; 512GB is $464m cumulative. At $1.5b/h even 512GB is
  ~20 minutes. Home RAM is the *only* purchase that survives an install
  (`prestigeHomeComputer` clears programs, not `maxRam` — `src/Server/ServerHelpers.ts:226-240`),
  and home is **still 16GB** — the Part II recommendation was never actioned. **This is now the
  single best use of money on the board.**
- **The 1.9^n aug batch multiplier is much less binding than Part II claimed.** See §14.

---

## 13. ⚠️ The fleet is saturated, and more RAM now makes it worse

At 23:26: `ramUsed 10,625 / ramTotal 10,652`, **4,419 `early.js` threads, all 26 processes
targeting `phantasy`** (`.telemetry/status.txt`). That is the failure mode.

Security changes are **linear in threads** (`src/Server/data/Constants.ts:9-10`:
`ServerFortifyAmount 0.002`, `ServerWeakenAmount 0.05`; grow fortifies at 2×). So at 4,419
threads a single full-fleet `grow` raises `phantasy` security by **+17.7**, and a single full
fleet `hack` by **+8.8** — against a `minDifficulty` of 7. And op time is linear in security:

> `hackTime = 5 × (2.5 · requiredHackingSkill · hackDifficulty + 500) / (hacking + 50)`
> (`src/Hacking.ts:58-79`), grow ×3.2, weaken ×4.

`phantasy` has `requiredHackingSkill = 100`, so each point of security costs
`2.5 × 100 = 250` in the numerator. The observed cycle:

| clock | state | what the whole fleet is doing |
| --- | --- | --- |
| 23:26 | sec 11.8, $175m | growing (230s) |
| 23:29 | sec **18.25**, $600m (capped) | grow landed, +6.5 security |
| 23:29–23:38 | sec 18.25, $600m | **one 423-second `weaken`. 3.5 exp/s. $0 income.** |

Measured exp across the full 342s sample window: **117 exp/s**; across the last 160s of it,
while blocked on that weaken: **3.5 exp/s**. (`status.txt`'s `expPerSec: 33.04` is a lagging
average and should not be used — Part II's instrument note stands: sample
`PlayerSave.exp.hacking` from the save.)

**Three separate defects compound here:**

1. **Single target.** Income per cycle is capped at the target's `moneyMax`. `phantasy` is
   $600m. Threads beyond the ~1,000 needed to drain and refill it in one op each buy **zero**
   extra income.
2. **More threads lengthen the cycle.** Bigger security spikes ⇒ longer weakens ⇒ fewer
   cycles/hour ⇒ **less** money and less exp. The fleet is past the peak of its own curve.
3. **Lockstep.** Every process runs the same `if security > min+5 … elif money < 50% … else`
   ladder against the same target, so they all choose the same op and all block together.
   There is no pipelining at all.

### Per-thread exp rates, live, hacking 189

Recomputed from the decoded save (`requiredHackingSkill`, `hackDifficulty`, `minDifficulty`,
`baseDifficulty` all read from `AllServersSave`), on a hack-time basis:

| target | req | cur sec | min sec | exp/s/thread @cur | @min | maxMoney |
| --- | --- | --- | --- | --- | --- | --- |
| **joesguns** | 10 | 10.5 | 5 | 0.4703 | **0.5736** | $62.5m |
| **foodnstuff** | 1 | 7.1 | 3 | **0.5539** | 0.5651 | $50m |
| sigma-cosmetics | 5 | 7.7 | 3 | 0.4808 | 0.5336 | $58m |
| nectar-net | 20 | 14.9 | 7 | 0.3455 | 0.5061 | $69m |
| hong-fang-tea | 30 | 15.0 | 5 | 0.2206 | 0.4097 | $75m |
| harakiri-sushi | 40 | 9.7 | 5 | 0.2434 | 0.3585 | $100m |
| n00dles | 1 | 1.9 | 1 | 0.3125 | 0.3139 | $2m |
| max-hardware | 80 | 15.0 | 5 | 0.1024 | 0.2390 | $250m |
| **`phantasy` — current target** | 100 | 11.8 | 7 | **0.1251** | 0.1912 | **$600m** |
| iron-gym | 100 | 30.0 | 10 | 0.0717 | 0.1912 | $500m |
| silver-helix | 150 | 30.0 | 10 | 0.0488 | 0.1350 | **$1,125m** |

**The key structural fact — and it is why low-`requiredHackingSkill` targets are so much more
robust:** security enters op time multiplied by `requiredHackingSkill`. A +17.7 security spike
costs `phantasy` (req 100) **ten times** more seconds than it costs `joesguns` (req 10). So
`joesguns` tolerates an oversized fleet gracefully and `phantasy` does not. Even *saturated* —
4,419 threads, security spiked to 22.7 — `joesguns` ops run 22–89s against `phantasy`'s
141–565s.

### Revised recommendation on the Part II retarget

Part II's milestone #4 ("retarget the fleet off `phantasy` → `joesguns`/`foodnstuff`, ~6× exp,
free") was **never actioned**, and it is **still directionally right but no longer the top
item**, because the fleet grew 4.3× in the meantime and dragged exp up with it anyway.
Restated for current conditions:

- **It is no longer worth a whole-fleet switch.** Hacking is 189 and `avmnite-02h` needs 213 =
  171,800 more exp. At the ~117 exp/s actually measured that is **~25 minutes**. Retargeting
  might make it ~6, and would cost ~10× income for the window ($62m/cycle vs $600m/cycle).
  Saving 19 minutes is not worth giving up the money engine.
- **What it wants instead is a split, and the split is worth more than the retarget ever was.**
  There is 10,352GB available and `phantasy` saturates at ~1,000 threads (4GB each ≈ 4TB, and
  honestly less). Suggested allocation, for whoever owns `auto.js`:

  | slice | target | why |
  | --- | --- | --- |
  | ~1,000 threads | `phantasy` | saturates the $600m cap; more threads *lengthen* the cycle |
  | ~1,000 threads | `silver-helix` | $1,125m cap, already rooted, currently untouched |
  | remainder (~2,400) | `joesguns` + `foodnstuff`, split | 4.6× the exp/thread of `phantasy` |

  This should raise **both** income (two money targets instead of one, each with a shorter
  cycle) and exp (most threads on cheap targets) simultaneously. The lockstep problem argues
  for splitting across targets even at equal exp/thread.
- **`buyserv.js` should stop buying.** Past saturation, marginal RAM on a single target has
  negative return. `run buyserv.js --reserve 700e6` both funds the install and stops the bleed.
  Revisit once the fleet is split across ≥4 targets.

---

## 14. Revised install trigger

Batch costs recomputed with `getAugCost`'s `baseCost × 1.9^(queued)`
(`src/Augmentation/AugmentationHelpers.ts:120-163`), most-expensive-first, NFG levels last and
ascending. Aug stats re-extracted from `src/Augmentation/Augmentations.ts`:

| batch | augs | exp | speed | hacking | cost |
| --- | --- | --- | --- | --- | --- |
| *CyberSec-only (11,275 rep) — no NiteSec* | | | | | |
| NT1 + NFG×3 | 4 | ×1.133 | ×1.030 | ×1.030 | **$15.2m** |
| NT1 + SynEnh + BitWire + CSPG1 + NFG×3 | 7 | ×1.133 | ×1.072 | ×1.136 | $220.3m |
| *with NiteSec 20,000 rep* | | | | | |
| NRE + NT2 + NT1 + NFG×3 *(Part II's batch)* | 6 | ×1.629 | ×1.051 | ×1.030 | $390.4m |
| **NRE + NT2 + NT1 + ASP + NFG×3** | **7** | **×1.711** | ×1.072 | ×1.030 | **$668.7m** |
| + CSPG2 + CSPG1 + BitWire + SynEnh | 11 | ×1.711 | ×1.137 | ×1.215 | $3,801.7m |
| *with NiteSec 45,000 rep* | | | | | |
| all 9 + NFG×3 (adds CRTX42-AA) | 12 | ×1.967 | ×1.137 | ×1.313 | $7,425.8m |

> ### ⇒ **Install when NiteSec reputation reaches 20,000 and cash is ≥ $700m.**
> Buy, in this order: **NeuralRetentionEnhancement → ArtificialSynapticPotentiation →
> Neurotrainer II → Neurotrainer I → NeuroFluxGovernor ×3.**
> **$668.7m, 7 augs, `hacking_exp` ×1.711, `hacking_speed` ×1.072, +3% to everything else.**

Changes from Part II's trigger, and why:

- **$400m → $700m.** `ArtificialSynapticPotentiation` (NiteSec, 6,250 rep, $80m base,
  exp ×1.05 / speed ×1.02 / chance ×1.05) was excluded by Part II purely on the $242m its
  1.9^n slot cost. At $1.5b/h that is ~10 minutes of income for +5% exp forever. It is in.
- **Still stop at 7 augs.** The next step up — adding CSPG2/CSPG1/BitWire/SynEnh — costs
  **$3.13b more for zero extra exp** (they are hacking/speed/money augs) and only
  +6% speed / +18% hacking. At ~$1.5b/h that is 2 hours of income for a rounding error against
  exp ×1.711. **The Part II rule survives: short cycles beat big batches.**
- **Still do not wait for CRTX42-AA (45,000 rep).** 25,000 more rep is ~6 more hours of human
  clicking, and it is *cheaper next life* — `repToFavor(20000)` = **29.7 favor** ⇒ +29.7% rep
  rate on NiteSec after install #1 (`src/Faction/formulas/favor.ts`).
- **Buy home RAM before the install, not after.** It is the only survivor. At current income,
  take home to **256GB ($145.8m cumulative from 16GB)** — Part II's 128GB target was priced
  when $45m was two hours of income; it is now three minutes. Do not buy cores:
  `1e9 × 7.5^cores`, the first is $1b.

### Is a CyberSec-only install now, skipping NiteSec, better?

No, and the margin is wide. The case *for* it is real — `NT1 + NFG×3` costs **$15.2m** for
exp ×1.133 and 4 Daedalus augs, banks CyberSec 11,275 rep as **20.6 favor**, and erases the
Sector-12 membership. But:

- NiteSec is ~25 minutes of exp away (hacking 189 → 213), not hours.
- The NiteSec batch is worth **exp ×1.711 vs ×1.133** — 51% more exp rate, forever, for the
  same single reset cost.
- The binding cost of the NiteSec path is **~5 hours of human faction clicking**, not money and
  not exp. Those 5 hours can be spent while the fleet keeps earning, so their true cost is only
  the human's attention.
- A CyberSec-only install now would throw away the 11,275 CyberSec rep's *usefulness* (it is
  banked as favor either way) and re-enter the dead zone with a 16GB home, for a multiplier
  one-third the size.

**Verdict: unchanged from Part II — do not install before NiteSec.** But the reason has shifted:
Part II said "NiteSec quadruples the value of the same reset"; the correct statement is
"NiteSec is the only source of exp ×1.25 and ×1.15 augs, it costs no money to join, and it is
25 minutes of exp away."

### The runway, re-timed

| gate | quantity | rate | time |
| --- | --- | --- | --- |
| hacking 196 → 213 (23:45) | 161,000 exp | **88 exp/s measured** over 8.7 min | **~30 min** |
| NiteSec 0 → 20,000 rep | 20,000 | 3,146/h unfocused + 728/h contracts + **150/h passive** | **~5.0 h** |
| cash $299m → $700m | $401m | **$1.86b/h measured** | **~13 min** |

**Money is the *shortest* pole now, not the longest.** Reputation is ~10× everything else.

**Reputation is the runway and nothing else is close.** The human should start NiteSec hacking
work the minute the invite lands; unfocused is fine (×0.8, `Player.focusPenalty()`,
`PlayerObjectGeneralMethods.ts:622-626`) and scripts run either way.

---

## 14b. Revised milestone list (supersedes Part II §10)

| # | Milestone | Trigger | Owner | Status @23:45 |
| --- | --- | --- | --- | --- |
| 1 | Harvest contract backlog | — | — | done, $100m + 11,275 CyberSec rep |
| 2 | CyberSec joined | — | — | done |
| 3 | FTPCrack on home | — | — | done |
| 4 | ~~Retarget whole fleet to joesguns~~ | — | auto.js | **withdrawn** — replaced by #5 (§13) |
| 5 | **Split the fleet: ~1k threads `phantasy`, ~1k `silver-helix`, rest `joesguns`/`foodnstuff`** | **now** | auto.js | 10,352GB all on one target, lockstep-blocked (§13) |
| 6 | **`run buyserv.js --reserve 700e6`** | **now** | game-player | appears already stopped; confirm |
| 7 | **Home RAM 16 → 256GB, $145.8m** | **now** — 5 min of income | game-player (UI) | still 16GB; only purchase that survives an install |
| 8 | **Backdoor `avmnite-02h`** | **hacking 213** (exact, from save) | game-player | ~30 min away at 88 exp/s |
| 9 | **Accept NiteSec the instant it is offered** | on invite | game-player | costs $0, +150 rep/h passive immediately (§11) |
| 10 | **Human works NiteSec hacking contracts, unfocused** | on invite | game-player | **~5 h — this is the whole runway** (§14) |
| 11 | **Install: NRE + ASP + NT2 + NT1 + NFG×3, $668.7m** | **NiteSec 20,000 rep + $700m** | game-player | exp ×1.711, 7/30 Daedalus augs |
| 12 | Post-install: **join nothing, take no job** until fleet rebuilt | — | all | contracts pay $11.111m vs $6.250m (§15) |
| 13 | Fix `contract.js` Caesar cipher solver | anytime | whoever owns it | ~20% of contract value, ~$10m/h post-install |

**Do not** join Netburners, Tian Di Hui, or any further faction: they cost no money but each
one cuts the contract-rep share reaching NiteSec by another slice (§11), and their augs are
hacknet/charisma traps (Part I §2).

---

## 15. The post-install opening — unchanged, and now the *only* place sequencing pays

Because faction membership is wiped (§11) and the map respawns empty, install #1 lands you at
zero factions, where contracts pay **$11.111m** EV instead of $6.250m — a **1.78×** multiplier
on the only income that exists during the dead zone.

1. **Accept no faction invite, and take no job,** until the fleet is rebuilt. CyberSec's invite
   will not survive the install anyway (no `keep` flag), so it costs nothing to leave `CSEC`
   un-backdoored for the first hour.
2. **Run `contract.js` from minute one.** At 256GB of home RAM its structural 21.8GB fits
   trivially and the Part I reader/solver split is unnecessary.
3. ⚠️ **`contract.js` still cannot solve `Encryption I: Caesar Cipher`** — 1 of only 5 types
   that can spawn at `maxDif = 1`, so ~20% of contract value, now worth **~$10m/hour** at the
   zero-faction rate. Flagged in Part I §5 and Part II §10; still unfixed at 23:40. Not my file.
4. Buy cloud RAM with everything, **split across ≥4 targets from the start** (§13).
5. Join CyberSec, then NiteSec, only once hacking income dominates contract income — which,
   given §12, will now be within the first hour, not several.

---

## Open questions after Part III

- ~~Sustained income is measured over one cycle~~ — **resolved, two full cycles measured.**
  `moneySourceA.hacking` went **$0 (23:20) → $477.2m (23:31) → $772.9m (23:45)**. That is
  **$772.9m in 25 minutes = $515k/s = $1.86b/hour**, across two complete drain cycles of
  ~500s each yielding $477m and $296m. Cash in hand at 23:45 is **$298.9m and rising** —
  `buyserv.js` has stopped buying (purchased RAM flat at 10,352GB since 23:29), so the
  install budget is now accumulating on its own. **$700m is ~15 minutes away.**
- ~~CyberSec and Sector-12 rep both rising at 0.042 rep/s with no work in progress~~ —
  **resolved: it is passive faction reputation gain**, which neither Part I nor Part II
  accounted for. `processPassiveFactionRepGain` (`src/Faction/FactionHelpers.tsx:132-170`,
  called from `src/engine.tsx:181` at 5 cycles/s, `FactionPassiveRepGain = 1` in BN1):

  > `favorMult = min(0.1, favor/1000 + 0.01)`;
  > `rate = max(hRep·favorMult, sRep·favorMult, fRep·favorMult, **1/120**)` per cycle.

  At favor 0 and hacking 189, `hRep × favorMult = 0.00194`, which is below the `1/120`
  floor — so **every joined faction earns a flat `5/120` = 0.04167 rep/s = 150 rep/hour**,
  passively, forever. Measured CyberSec gain over 523s: **0.0417 rep/s**, matching the floor
  to four digits.

  **Two consequences, both favouring joining NiteSec sooner:**
  1. Passive rep is granted **per faction, independently — it does not split.** Unlike
     contract rep, joining more factions does not dilute it. Joining NiteSec is worth
     **+150 rep/hour from the moment of acceptance**, on top of everything else.
  2. It only escapes the `1/120` floor once `favor` is high enough that
     `hacking/975 × (favor/1000 + 0.01) > 1/120`, i.e. `favor > ~33` at hacking 213. After
     install #1 banks NiteSec 20,000 rep as **29.7 favor**, passive rep roughly doubles to
     ~280 rep/h and keeps scaling. Small, but it compounds in the right direction and is
     another reason short install cycles beat long ones.
- **`ArtificialSynapticPotentiation`'s exp multiplier is ×1.05, not the ×1.071 Part II
  listed** (re-read from `Augmentations.ts:62`). Part II's §7 table also listed
  **`EnhancedMyelinSheathing` as a NiteSec aug at 15,000 rep / $250m — that is wrong.** It is
  **100,000 rep / $1.375b** and sold by Fulcrum Secret Technologies, BitRunners and
  The Black Hand only. Corrected here; it is not reachable this life.
- The `F ≈ 0.389` fit from Part II §6 no longer holds at this thread count — the implied `F`
  during the saturated weaken is ~0.06. `F` is not a constant; it is a function of
  threads-per-target. Whoever models this should treat the security spike as the state
  variable, not fit a scalar.

---
---

# Part IV — the multiplier audit. 2026-09-12 01:40Z

Written after the lead found four mechanics Parts I–III never mentioned (`ns.share()`, the
focus penalty, rep being linear in hacking level, and rooting not being level-gated). This part
does not refine Parts I–III; it **systematically enumerates every factor in the three
formulas that matter** and then hunts the systems this document had never opened. Parts I–III
stand except where marked **STALE** in §20.

**Live state, measured from the save at 01:36Z** (`POST /rpc {"method":"getSaveFile"}`):

| | value | |
| --- | --- | --- |
| hacking | **318** (11,023,092 exp) | exp 5,934/s (`.telemetry/status.txt` 00:51) |
| money | **$21.3b** in hand | **current** income $33.1m/s ≈ **$119b/h** (`status.txt` 00:51). Lifetime hacking income is only $25.0b over 6.7 h — that average includes hours at ~$0 and **must not be used as the rate**. |
| network RAM | **268,484 GB** across 97 servers | home **2048 GB** |
| threads running | 234,657 (`h/g/w.js`) + **2,040 `share.js`** | share bonus **1.3048** |
| NiteSec | **5,063 rep**, favor 0 | CyberSec 11,509, Sector-12 1,094, all favor 0 |
| work in progress | `FactionWork` NiteSec hacking, **`focus: true`** | 72 min elapsed |
| every `Player.mults` field | **exactly 1.0** | no augs, no SFs, no Go bonuses |
| backdoors installed | `CSEC`, `avmnite-02h` only | |

**Rep model validated live.** Over a 624.8 s window NiteSec went 3,831.4 → 5,062.7 =
**1.9707 rep/s**. Predicted from `5 × (avg hacking 297 / 975) × 1.3048 × 1.0` = 1.9873 rep/s —
**0.8% error**. Over the same window CyberSec (not the active faction) gained exactly
0.04167 rep/s = the `1/120`-per-cycle passive floor. Both formulas are confirmed in the live
game, not just in source.

---

## 16. The complete multiplier audit

Method: trace each formula end to end and list **every** factor, including the ones equal to 1.
`ns.share()` and focus were missed because they are exactly this — factors that sit at 1.0
until you deliberately turn them on.

### 16a. Faction reputation — every factor

`FactionWork.getReputationRate()` (`src/Work/FactionWork.tsx:38-41`) =
`calculateFactionRep(...) × Player.focusPenalty()`, applied per cycle at 5 cycles/s
(`CONSTANTS.MilliPerCycle = 200`, `src/Constants.ts:19`), via `calculateFactionRep`
(`src/Work/Formulas.ts:82-89`) → `getHackingWorkRepGain`
(`src/PersonObjects/formulas/reputation.ts:16-24`):

| # | factor | source | value now | ceiling / how to move it |
| --- | --- | --- | --- | --- |
| 1 | `p.skills.hacking / 975` | `reputation.ts:18`, `CONSTANTS.MaxSkillLevel` (`Constants.ts:16`) | 318/975 = **0.326** | **linear in hacking level.** exp → level is logarithmic (§16b), so this is the slow lever |
| 2 | `p.skills.intelligence / 3` (added to hacking) | `reputation.ts:18` | **0** | **permanently 0.** `gainIntelligenceExp` is a no-op unless `sourceFileLvl(5) > 0 \|\| bitNodeN === 5` (`src/PersonObjects/Person.ts:184`). Dead this BitNode. |
| 3 | `getDarknetCharismaBonus(p, 0.1)` | `reputation.ts:18,54-59` | **0** | needs SF15 ≥ 3. Dead. |
| 4 | `p.mults.faction_rep` | `reputation.ts:19` | **1.000** | **movable — see §19 (Go/Daedalus) and NeuroFluxGovernor (+1%/level)** |
| 5 | `calculateIntelligenceBonus(int, 1)` = `1 + int^0.8/600` | `reputation.ts:20`, `formulas/intelligence.ts:1-3` | **1.000** | locked at 1 because int is locked at 0 |
| 6 | `1 + favor/100` | `reputation.ts:21` via `mult()` at `:8-14` | **1.000** | favor only accrues on **install** (`src/Faction/Faction.ts:79`) or **+1 per save export** (§16d) |
| 7 | `currentNodeMults.FactionWorkRepGain` | `reputation.ts:13` | **1.000** | BN1 returns a bare `new BitNodeMultipliers()` — **every BitNode multiplier in this run is exactly 1** (`src/BitNode/BitNode.tsx:566-568`) |
| 8 | `calculateCurrentShareBonus()` = `1 + ln(shareThreads)/25` | `reputation.ts:22`, `src/NetworkShare/Share.ts:43-48` | **1.3048** (2,040 threads) | logarithmic — see §16c |
| 9 | `Player.focusPenalty()` | `FactionWork.tsx:39`, `PlayerObjectGeneralMethods.ts:622-628` | **1.000 (focused)** | already claimed. `NeuroreceptorManager` (Tian Di Hui, 75k rep) removes the penalty permanently |
| 10 | 5 cycles/s | `Formulas.ts:38` | ×5 | fixed |

**Factors 4 and 8 are the only two that are both movable and currently below their ceiling.**
Factor 1 is movable but logarithmically expensive. Everything else is pinned by a missing
Source-File or by BN1's flat multiplier table.

Note factor 4 also multiplies the **passive** rep stream and **donations**, and factor 1 is
itself multiplied by `p.mults.hacking` (§16b) — so a `hacking` augmentation is a *reputation*
augmentation. Parts I–III's aug tables never said this.

**Every faction-reputation source in the game** (exhaustive grep for `playerReputation` writes):

| source | file | available to us? |
| --- | --- | --- |
| faction work | `src/Work/FactionWork.tsx:51` | **yes — running** |
| passive gain, `max(hRep·favorMult, …, 1/120)` per cycle | `src/Faction/FactionHelpers.tsx:132-170` | **yes — 150 rep/h per joined faction, measured** |
| coding contracts | `PlayerObjectGeneralMethods.ts:521,533` | **yes — ~162 rep/contract at 3 factions** |
| **offline progress** | `src/engine.tsx:284-309` | **yes — see §16d** |
| **infiltration** (`Trade for reputation`) | `src/Infiltration/ui/Victory.tsx:71-83` | **YES — §17** |
| donation | `src/Faction/formulas/donation.ts:32` | needs 150 favor (462,490 banked rep). Not this life |
| Stanek's Gift charge | `src/CotMG/StaneksGift.ts:41` | no — CotMG needs SF13 (`FactionInfo.tsx:759`) |
| gang | `src/Gang/Gang.ts:154` | no — SF2 (`PlayerObjectGangMethods.ts:19-20`) |
| corporation bribery | `src/Corporation/Actions.ts:647` | no — SF3 |
| Bladeburner | `src/Bladeburner/Bladeburner.ts:1279` | no — SF6/7 |
| sleeve faction work | `SleeveFactionWork.ts:52` | no — SF10 |
| **Go win streaks (favor, not rep)** | `src/Go/boardAnalysis/scoring.ts:66-79` | yes but useless — §19 |

### 16b. Hacking experience — every factor

`calculateHackingExpGain` (`src/Hacking.ts:30-38`), awarded per thread per completed op:

| # | factor | value now | notes |
| --- | --- | --- | --- |
| 1 | `3 + 0.3 × server.baseDifficulty` | target-dependent | the only target-quality term |
| 2 | `person.mults.hacking_exp` | **1.000** | augs only. Best batch reachable = **×1.83** (§21) |
| 3 | `currentNodeMults.HackExpGain` | **1.000** | BN1 |
| 4 | × threads | 234,657 | linear, no saturation |
| 5 | ÷ op time | `5 × (2.5·reqHack·hackDifficulty + 500) / (hacking + 50) / (mults.hacking_speed × HackingSpeedMultiplier × intBonus)` (`Hacking.ts:58-79`) | `hacking_speed` **1.000**; intBonus **1.000** |

**Two corrections to Part II §6.** Part II asserted "grow and weaken award exactly the same
amount as hack". That is true only for a *successful hack that actually drained money*:
`expGainedOnFailure = expGainedOnSuccess / 4`, and **`expGainedOnSuccess` is set to the
failure value when `moneyDrained === 0`** (`src/Netscript/NetscriptHelpers.tsx:619-641`).
`grow` and `weaken` have no such branch. So **on a drained or over-hacked target, `hack`
threads earn a quarter of what `grow`/`weaken` threads earn.** For a pure-exp slice of the
fleet, weaken is strictly the best op.

**exp → level** (`src/PersonObjects/Person.ts:59-62`, `formulas/skill.ts:8-14`):

> `skill = floor(mults.hacking × HackingLevelMultiplier × (32·ln(exp + 534.6) − 200))`

`mults.hacking` multiplies the **level**, not the exp. So `BitWire` (×1.05), `CSPG1` (×1.05),
`CSPG2` (×1.07), `CRTX42-AA` (×1.08) each raise the hacking level by their full percentage —
and therefore raise **faction reputation rate** by the same percentage, permanently.
**Parts I–III ranked these purely as hack-success augs. They are reputation augs.** This is the
single largest re-ranking in Part IV.

### 16c. `ns.share()` — priced properly

`startSharing(threads, cpuCores)` (`src/NetworkShare/Share.ts:22-41`):

> `effectiveThreads = threads × calculateIntelligenceBonus(int, 2) × getCoreBonus(cores)`
> `bonus = 1 + ln(shareThreads)/25`

- `calculateIntelligenceBonus(0, 2)` = **1.000** (int locked at 0).
- `getCoreBonus(cores) = 1 + (cores − 1)/16` (`src/Server/ServerHelpers.ts:315-318`). Home has
  1 core and purchased servers have 1 core, so this is **1.000**. Home cores cost
  `1e9 × 7.5^cores` — $1b for the first, buying a ×1.0625 on share threads *on home only*.
  Not worth it: the log makes a ×1.0625 on threads worth +0.24% on the bonus.
- RAM: **2.4 GB/thread** (`src/Netscript/RamCostGenerator.ts:575`). `ns.getSharePower()` reads
  the live bonus for 0.2 GB (`:576`, `NetscriptFunctions.ts:394-396`).

The bonus is logarithmic, so **each doubling of share threads is worth a flat +2.77 points of
absolute bonus (ln2/25 = 0.0277)** — currently +2.1% relative:

| share threads | RAM | bonus | vs today |
| --- | --- | --- | --- |
| 2,040 (**now**) | 4.9 TB | 1.3048 | — |
| 8,000 | 19 TB | 1.3597 | +4.2% |
| **30,000** | **72 TB** | **1.4124** | **+8.2%** |
| 65,000 | 156 TB | 1.4433 | +10.6% |
| 110,000 (whole fleet) | 264 TB | 1.4643 | +12.2% |

**Where the optimum is.** Marginal relative rep per share thread is `1/(25·T·B(T))`.
Marginal relative rep per *hacking* thread, over a horizon τ, is
`(32/E)·(e_t·τ)/hacking` where `e_t` = measured exp/s/thread. At the live figures
(E = 11.0m, hacking 318, 5,934 exp/s over 232,617 hacking threads ⇒ `e_t` = 0.0255) and τ = 1 h,
the two are equal at **T ≈ 30,000 threads**. The estimate is coarse — ±25% on `e_t` moves the
crossover between ~25,000 and ~35,000 — but the bonus varies by less than 1% across that whole
range, so the precision does not matter. Below it share wins; above it exp wins.

> **Recommendation: raise `share.js` from 2,040 to ~30,000 threads (≈72 TB of the 268 TB
> fleet).** Worth **+8% on every rep stream**. Going further is possible but pays ~2% per
> doubling. This is real but it is not a game-changer — Parts II/III were right that share is a
> modest lever; they were wrong only in leaving it at 1.8% of the fleet.

Note the bonus applies to **faction rep only**. It does **not** apply to company rep
(`calculateCompanyWorkStats`, `src/Work/Formulas.ts:124-158` — no share term) and not to
infiltration rep (`src/Infiltration/formulas/victory.ts:28-63` — no share term).

### 16d. Two free multipliers nobody has claimed

**1. Exporting the save grants +1 favor to every joined faction, once per 24 real hours.**
`giveExportBonus()` (`src/ExportBonus.tsx:6-20`) is called from `exportGame()`
(`src/SaveObject.ts:239`), and the Augmentations page labels the button
"(+1 favor to all factions)" (`src/Augmentation/ui/AugmentationsRoot.tsx:96`).
Favor is `1 + favor/100` on rep gain — so this is **+1% rep rate on all three factions,
permanently, for one click**. It has never been claimed this run.
**Important:** the RFA `getSaveFile` path we use for telemetry calls `getSaveData()` directly
(`src/RemoteFileAPI/MessageHandlers.ts:228-238`) and does **not** trigger the bonus, so it is
still available. The human must click Options → Export Game in the UI.

**2. Offline progress runs faction work at full focused rate.** `src/engine.tsx:284-287`:

```ts
if (Player.currentWork !== null) { Player.focus = true; Player.processWork(numCyclesOffline); }
else if (Player.bitNodeN !== 2) { /* rep = max(hRep,sRep,fRep) / factions.length, to EVERY faction */ }
```

So while the game is closed:
- **with faction work active**: NiteSec earns the *full focused* rate ≈ **1.63 rep/s** at
  hacking 318. (Share bonus is 1.0 during the catch-up: `shareThreads` is a module-level `let`
  reset by the page load and `processWork(numCyclesOffline)` runs synchronously before any
  restarted script can call `ns.share()`. **Inferred from load order, not measured.**)
- **idle**: all three factions each earn `rate / 3` ≈ 0.54 rep/s — 13× better than the
  0.0417 rep/s online idle floor;
- **working a job**: zero faction rep offline.

⇒ **Never leave the game open and idle.** Online-with-focused-work (1.97 rep/s) beats
offline-with-work (1.63 rep/s) beats offline-idle (0.54 rep/s) beats online-idle (0.042 rep/s)
by a factor of 47. If the human has to step away, **leave faction work running and close the
tab** rather than leaving it open doing nothing.

### 16e. Money — for completeness

`calculatePercentMoneyHacked` (`src/Hacking.ts:41-56`) ×
`currentNodeMults.ScriptHackMoneyGain` (`NetscriptHelpers.tsx:648`). Movable factors:
`person.mults.hacking_money` (**1.000**, movable via CSPG3 ×1.15, DataJack ×1.25, and Go/Black
Hand — §19) and `currentNodeMults.ScriptHackMoney` / `ScriptHackMoneyGain` (**1.000**, BN1).
`moneySourceA` enumerates every money channel in the game: hacking, codingcontract, casino,
class, corporation, crime, darknet, gang, hacknet, infiltration, sleeves, stock, work.
**Money is not a constraint and is not worth another hour of anyone's analysis** — see §21.

---

## 17. Infiltration — yes, it is a real reputation source, and it is ~10×

**Not Source-File gated at all.** No `activeSourceFileLvl` reference exists anywhere under
`src/Infiltration/**`.

### The reward

`Victory.tsx:71-83` → `calculateTradeInformationRepReward`
(`src/Infiltration/formulas/victory.ts:28-63`):

> `rep = (reward+1)^1.1 × SSL^1.1 × balanceMultiplier × marketMult × 30 × maxLevel × 1.005^maxLevel`

with `reward = clamp(SSL − 465^0.9/250, 0, 3)` (`formulas/game.ts:55-57`) — note the **hard-coded
465**, so **the reward does not depend on your stats at all** in v3. `balanceMultiplier` is a
step function of `SSL` (`victory.ts:36-51`; 0.45 below SSL 4). `currentNodeMults.InfiltrationRep`
= 1 in BN1. **There is no favor term, no `faction_rep` term, and no share term** — infiltration
rep is flat.

The faction is chosen from a dropdown of `Player.factions` filtered by `offersWork()`
(`Victory.tsx:118-124`) — **NiteSec qualifies**, and the amount does not depend on which you pick.

`handleInfiltrators()` additionally grants **Shadows of Anarchy** rep on every completion
(`Victory.tsx:89-94`, `victory.ts:65-86`), and the first completion sends the SoA invite
(`FactionInfo.tsx:789-806`, requirement is literally "Complete an infiltration").

### The stat gate — this is the whole story

`calculateDifficulty` (`game.ts:41-53`):

> `difficulty = max(0, SSL − (str+def+dex+agi+cha)^0.9/250 − intelligence/1600)`,
> refused if `≥ MaxDifficultyForInfiltration = 3.5` (`game.ts:4`, `ui/Intro.tsx:206`)

With our stats summing to **5**, the correction is `5^0.9/250 = 0.017` — effectively zero.
So the gate is essentially `SSL < 3.5`. Sector-12 locations
(`src/Locations/data/LocationsMetadata.ts`):

| location | SSL | levels | difficulty at our stats | playable | rep/run |
| --- | --- | --- | --- | --- | --- |
| **Joe's Guns** | 3.13 | 5 | 3.113 | **YES** | **850** |
| Alpha Enterprises | 3.62 | 10 | 3.603 | no | 2,401 |
| Carmichael Security | 4.66 | 15 | 4.643 | no | 4,845 |
| DeltaOne / Universal Energy | 5.90 | 12 | 5.883 | no | — |
| Icarus Microsystems | 6.02 | 17 | 6.003 | no | — |
| Four Sigma | 8.18 | 25 | 8.163 | no | — |
| Blade Industries | 10.59 | 25 | 10.573 | no | — |
| MegaCorp | 16.36 | 31 | 16.343 | no | — |

Elsewhere in the world, also open at our stats: **Ishima Omega Software** (SSL 3.2, 10 levels,
**1,831 rep/run**), **Aevum NetLink** (SSL 3.29, 6 levels, 1,144 rep), New Tokyo Noodle Bar
(SSL 2.5, 5 levels, 518 rep). Travel is $200k.

**Per-floor rep is what matters for wall-clock**: Aevum NetLink 191 > Ishima Omega 183 >
**Joe's Guns 170** > New Tokyo 104. They are within 12% of each other, so **Joe's Guns wins on
"no travel required"**.

### The price

- **Every minigame runs at Brutal**, because difficulty 3.11 clamps to the top of the
  interpolation band (`src/Infiltration/model/Difficulty.ts:22-28`, `Infiltration.ts:91-93`).
  Brutal timers: Slash **250 ms hit window** (`SlashModel.ts:74-76`), Bracket 2,500 ms,
  Bribe 2,500 ms, CheatCode 3,000 ms, Backward 8,000 ms, WireCutting 4,000 ms,
  Cyberpunk2077 10,000 ms, Minesweeper 15,000 ms.
- **Max HP is 10.** `hp.max = floor(10 + defense/10)` (`src/PersonObjects/Person.ts:96`) and
  defense is 1. Damage per failed minigame is `SSL × 3` = **9.39** (`Infiltration/utils.ts:34-36`).
  **You survive exactly one mistake per run**; the second hospitalises you and cancels the
  entire run (`Infiltration.ts:82-88,139-157`). Hospital cost is `min(money×0.1, ΔHP×100e3)`
  = $1m — irrelevant. The lost run is the cost.
- **It cannot be scripted.** Any key event with `isTrusted === false` calls
  `onFailure({automated: true})`, which sets damage to current HP — guaranteed hospitalisation
  (`src/Infiltration/ui/InfiltrationRoot.tsx:73-78`). Starting one also needs a trusted click
  (`CompanyLocation.tsx:62-64`). There is no NS function to play an infiltration; `ns.infiltration.*`
  is read-only (`src/NetscriptFunctions/Infiltration.ts:68-84`).
- **Chaining is throttled.** `marketMult = 1 − 1e-3 × floors²` where `floors` is an EMA decaying
  at 2e-5/ms (`game.ts:6,18-34`) — a 35-second half-life. At one 5-floor run per ~50 s the
  steady state is ≈ 0.975, i.e. negligible. The code's own comment notes the optimum sits at
  `marketMult = 2/3`, which is 21.9 floors/min — faster than a human can play, so **we will
  never hit the throttle**.

### The number

~170 rep/floor, 5 floors, ~0.9 s countdown + one minigame per floor, plus UI navigation.
At a realistic 40–60 s per attempt and a per-minigame Brutal hit rate `q`
(a run needs 5 successes with at most 1 failure, `P = q⁵(1 + 5(1−q))`):

| `q` | P(clear) | rep/h @50 s/attempt | vs 7,094 rep/h measured today |
| --- | --- | --- | --- |
| 0.95 | 0.97 | ~59,000 | **8.3×** |
| 0.85 | 0.79 | ~48,000 | 6.8× |
| 0.70 | 0.42 | ~26,000 | 3.6× |
| 0.50 | 0.11 | ~6,700 | **0.9× — break-even** |

> **Verdict: infiltration is the largest untapped lever in the run, and it is the only one that
> attacks reputation by an order of magnitude rather than a few percent.** At a 70% per-minigame
> hit rate it is 3.6× faction work; at 85% it is ~7×. **Below a ~55% hit rate it is worse than
> just clicking faction work**, because failed runs are total losses.

**The honest caveat, and it is a real one:** the 250 ms Slash window and the 2.5 s
Bracket/Bribe windows are near the limit of what a screenshot-driven browser agent can do, and
the `isTrusted` check means any attempt to shortcut with synthetic events is instant
hospitalisation. **Do not commit to this plan on paper. Run ONE Joe's Guns attempt, count the
minigames cleared, and compute `q` before deciding.** That single run costs ~1 minute and
~850 rep of upside; guessing wrong costs hours.

**Cheap unlock if `q` turns out good:** the gate sums str+def+dex+agi+**charisma**, so any
39 points of any of them (total 44) opens Alpha Enterprises — 2,401 rep/run, 240 rep/floor,
same city. But Alpha's damage is `3.62 × 3 = 10.86 > 10 HP`, so **defense must reach 10+ first**
or a single miss ends the run. Training defense to ~44 solves both at once (HP 14, total stats 48).

**Shadows of Anarchy** is worth joining if we infiltrate at all — it costs nothing, `keepOnInstall:
true` so the invite survives installs, and its augs (10,000 rep base, ×1.3 rep / ×7 money per
SoA aug owned, `CONSTANTS.SoACostMult/SoARepMult`) each trivialise one minigame.
`WKSharmonizer` is the general one: ×1.3 timers, ×1.2 trade rep, ×2 SoA rep, ×0.5 damage.
They are `isSpecial`, so **they do not inflate the 1.9^n price of other augs**
(`AugmentationHelpers.ts:32-37`). They only take effect after an install.

---

## 18. The "Special Campaign" button on NiteSec — identified, harmless

The heading comes from `src/Faction/ui/Info.tsx:40-55`, which renders
`factionInfo.campaign()` for any faction that defines one. Every gang-capable faction gets
`GangCampaign` attached (`FactionInfo.tsx:827-829`), and **NiteSec is in
`GangConstants.Names`** (`src/Gang/data/Constants.ts:17-26`).

`GangCampaign` (`src/Faction/ui/GangCampaign.tsx:48-56`) branches on `knowAboutBitverse()`:

```ts
export function knowAboutBitverse(): boolean {
  for (const sfActiveLevel of Player.activeSourceFiles.values()) if (sfActiveLevel > 0) return true;
  return false;
}                                        // src/BitNode/BitNodeUtils.ts:21-28
```

We have **zero Source-Files**, so it returns `false` and the component renders
`GangIncompleteCampaign` (`GangCampaign.tsx:17-46`) — the "Execute the formation plan" button.

> **What it does: opens a `Modal` containing four lines of corrupted ASCII
> ("`#@)($*&@__Y0U__^%$#@&*()__HAV3__…__N0T__…__S33N__…__TH3__…__TRU1H__`") and nothing else.**
> `onClick={() => setOpen(true)}`. There is no state change, no cost, no `Player` mutation, no
> faction effect, no achievement. It is pure flavour text pointing at BitNode 2.

**It is completely safe to click and completely pointless.** The real gang branch requires
`Player.canAccessGang()`, which returns
`{success: false, message: "You do not have Source-File 2."}` before it even looks at karma
(`src/PersonObjects/Player/PlayerObjectGangMethods.ts:19-20`). The same pattern appears on
The Covenant's page (`CovenantCampaign.tsx:9-44`, BN10) and CotMG's (BN13).

---

## 19. The systems we had never opened

| system | reachable in BN1 with 0 SFs? | gate | helps reputation? |
| --- | --- | --- | --- |
| Gang | **no** | `PlayerObjectGangMethods.ts:19-20` — SF2, checked *before* karma | would be the best rep engine in the game (`Gang.ts:154`, respect/75). Dead. |
| Corporation | **no** | `PlayerObjectCorporationMethods.ts:8-10` — SF3 | — |
| Bladeburner | **no** | `PlayerObjectBladeburnerMethods.ts:6-8` — SF6/7; faction also needs `haveSomeSourceFile(6,7)` (`FactionInfo.tsx:708`) | — |
| Duplicate Sleeves | **no** | `SleeveCovenantPurchases.tsx:62-63` — SF10/BN10 | — |
| Stanek's Gift / CotMG | **no** | `canAccessCotMG()` = `canAccessBitNodeFeature(13)`; invite lists `haveSourceFile(13)` (`FactionInfo.tsx:759`) | `StaneksGift.ts:41` would grant rep. Dead. |
| Hacknet **Servers** | **no** | `hasHacknetServers()` — SF9 | we get Hacknet **Nodes** only |
| Hacknet Nodes | yes | — | only as the Netburners ticket; every Netburners aug is `hacknet_node_*`. Still a trap. |
| Casino | yes | — | **no rep.** `$10b lifetime cap` (`src/Casino/Game.ts:4-19`), and no `Faction` reference anywhere under `src/Casino/`. Money is not scarce. Ignore. |
| Stock market | yes | — | no. WSE $200m / TIX API $5b / 4S $1b / 4S TIX $25b (`src/StockMarket/data/Constants.ts:3-11`). At $21b and rising, TIX is now *affordable* — but it produces money, which we do not need. Ignore. |
| Arcade | **no** | `ArcadeRoot.tsx:17-18` — SF1 ("This machine is broken.") | — |
| Exploits ("SF -1") | yes, 9 of 11 | `src/Exploits/Exploit.ts` | each is ×1.001 on essentially every mult incl. `faction_rep` (`applyExploits.ts:9-46`). All nine = **+0.9%**. Persist across installs. Not a strategy. |
| **Go (IPvGO)** | **YES — completely ungated** | plain `<Button>` at Sector-12 CIA, `SpecialLocation.tsx:466-476` | **yes, indirectly — see below** |
| DarkNet | yes, for $50m | `hasDarknetAccess()` = `canAccessBitNodeFeature(15) \|\| hasProgram(darkscape)`; `darkscape` is a darkweb purchase at $50m, or $30m at Chongqing's Shadowed Walkway (`DarkNet/Constants.ts:5-7`, `DarkWebItems.ts:16-17`) | **no.** Grep for `reputation`/`faction` under `src/DarkNet/` returns one dictionary string. It grants money (`moneySourceA.darknet`) and charisma only. Ignore — money is not scarce. |

### Go is the real find, and it is a `faction_rep` multiplier

Entry is a **plain button with no gate of any kind** at the Sector-12 CIA, where we already are.
The full `ns.go.*` API is available at ordinary RAM costs (`RamCostGenerator.ts:304-333`), so it
is **fully scriptable and costs zero human attention**.

`calculateMults()` (`src/Go/effects/effect.ts:68-101`) maps each opponent to a `Player.mults`
field, and `CalculateEffect` (`:16-22`) is:

> `1 + ln(nodes+1) × (nodes+1)^0.3 × 0.002 × bonusPower × GoPower(=1 in BN1) × (SF14 ? 2 : 1)`

| opponent | multiplier granted | `bonusPower` (`src/Go/Constants.ts`) |
| --- | --- | --- |
| **Daedalus** | **`faction_rep` and `company_rep`** | **1.1** |
| Illuminati | `hacking_speed` | 0.7 |
| The Black Hand | `hacking_money` | 0.9 |
| Netburners / Slum Snakes / Tetrads | hacknet / crime / combat | — |

**You do not need to be a member of the faction to earn its multiplier** — membership is only
checked for the separate favor grant (`scoring.ts:66-73`). `nodePower` accrues as
`blackScore × getDifficultyMultiplier(komi, boardSize) × getWinstreakMultiplier(...)`
(`scoring.ts:86-89`) — and crucially **that line sits outside the win/lose branch**, so a
*loss* still banks nodePower at the 0.5× streak multiplier (`effect.ts:119-130`). A mediocre
bot still farms. Daedalus komi is 5.5 ⇒ `difficultyMultiplier = 1.5`; win streaks cap at ×3.

| nodePower vs Daedalus | `faction_rep` multiplier |
| --- | --- |
| 300 | ×1.070 |
| 1,000 | ×1.121 |
| 3,000 | ×1.195 |
| 10,000 | ×1.321 |

Mults are recomputed at the end of every game via `Player.applyEntropy` → `updateGoMults()`
(`scoring.ts:98`, `PlayerObjectAugmentationMethods.ts:8-19`). The AI sleeps 200 ms per move
(`goAI.ts:876-882`), so a 13×13 game is on the order of a minute or two.

**⇒ `Player.mults.faction_rep` is a multiplier we have been leaving at exactly 1.0, and Go is
the only way to move it this life.** A Go bot playing Daedalus is worth roughly **+12% to +20%
on every reputation stream** — faction work, passive, contracts — for perhaps 20–40 minutes of
*script* time and zero human attention. **This is optimizer work and it is the best
RAM-free lever on the board after infiltration.**

Two caveats, both verified: `Go.prestigeAugmentation()` zeroes `nodePower` on install
(`src/Go/Go.ts:34-47`), so it is a per-life grind; and the separate favor-from-winstreak path
caps at `repToFavor(100000) = 81.3 favor` and only for factions you are a *member* of — below
the 150 needed to donate, and NiteSec is not a Go opponent. **Farm Daedalus for the multiplier;
ignore the favor path.**

### Company employment — re-verified, still "never take a job"

Re-checked now that rep, not money, binds. The answer is unchanged and the reasons are stronger:

1. **There is one work slot.** `Player.startWork` cancels whatever you were doing
   (`src/PersonObjects/Player/PlayerObjectWorkMethods.ts:5-10`); `Player.currentWork` is a single
   nullable field. **Company work and faction work are mutually exclusive.**
2. **Our best reachable job is slower than faction work.** Company rep is
   `jobPerformance × mults.company_rep × (1 + companyFavor/100) × CompanyWorkRepGain × focusBonus`
   (`src/Work/Formulas.ts:124-158`, `CompanyPosition.ts:156-172`) — **no share bonus, no
   intelligence bonus**. At charisma 1 every position above the intern tier is out (the lowest
   charisma gate in any tech track is 51 + a company offset ≥ 74). `software0`/`IT0` yield
   ~1.06–1.13 rep/s versus **1.97 rep/s measured** on NiteSec faction work — and it is company
   rep, which buys nothing we want.
3. **A job costs exactly one third of our contract faction rep.** The `CompanyReputation` roll
   (25% of contracts) falls back to `FactionReputation`/`FactionReputationAll` only when
   `Player.jobs` is empty (`PlayerObjectGeneralMethods.ts:539-552`). With a job, 50% of contracts
   feed faction rep instead of 75%.
4. **A job zeroes offline faction rep** (§16d).

Company-rep-gated factions all want **400,000 company rep**
(`CONSTANTS.CorpFactionRepRequirement`, `src/Constants.ts:25`; ten megacorps at
`FactionInfo.tsx:191,214,240,256,276,292,312,333,352,376`) — 75–100 hours away at intern rates.
Their hacking augs are excellent (ENM Core V3 exp ×1.25, Xanipher hacking ×1.20, OmniTek
InfoLoad ×1.20/×1.25) but sit behind another 400k–1.75m *faction* rep on top. **Post-install-#5
territory at the earliest.** One useful note for then: backdooring a company's server cuts the
requirement to 75% (`CompanyRequiredReputationMultiplier: 0.75`, `src/Constants.ts:110`,
applied in `src/Company/utils.ts:15-19`).

Only **three augmentations reachable from CyberSec / NiteSec / Sector-12 carry a `faction_rep`
multiplier, and it is only NeuroFluxGovernor** (`faction_rep: 1.01 + donationBonus`,
`Augmentations.ts:1186`). Every other `faction_rep` aug (ADR-V1/V2, SNA, SmartJaw, Shadow's
Simulacrum, PCMatrix) belongs to a faction we cannot reach.

### Backdoors — what we have not done, and what they are worth

Only **`CSEC` and `avmnite-02h`** are backdoored (read from `AllServersSave`). Every effect of
`backdoorInstalled` in the codebase:

1. **Faction invites** — `FactionJoinCondition.ts:48-56`, five story servers. `I.I.I.I` (348),
   `run4theh111z` (539), `fulcrumassets` (1233, also needs a Fulcrum job). Out of reach.
2. **Direct `connect` from anywhere** — `validateConnections` (`src/Server/ServerHelpers.ts:276`)
   lets you connect to a backdoored server from any host. Pure QoL.
3. **10% discount on university/gym classes** at that location — `src/Work/Formulas.ts:100-105`.
   Relevant **only if we pursue the infiltration stat training in §17** (Rothman University is
   `rothman-uni`; Powerhouse Gym is `powerhouse-fitness`).
4. **25% cut to company reputation requirements** — `src/Company/utils.ts:15-19`. Irrelevant now.
5. Achievements / milestones / `analyze` display. Cosmetic.

**There is no reputation, money, or experience reward for backdooring anything.** Nothing on the
backdoor list is worth doing right now except the two we have.

Also worth recording: a **manual terminal `hack`** sets `server.backdoorInstalled = true` on
success (`src/Netscript/NetscriptHelpers.tsx:670-676`) — but the five story servers have
`moneyAvailable: 0`, so `moneyDrained === 0` and it still requires meeting the hacking level.
Not a shortcut.

---

## 20. What in Parts I–III is now stale

| item | status |
| --- | --- |
| Part I §5 / II §10 / III §15 — **"`contract.js` cannot solve Encryption I: Caesar Cipher"**, flagged three times | **STALE. Fixed.** `ctsolvers.js:399` carries a `'Encryption I: Caesar Cipher'` solver. Remove the warning. |
| Part I §1 "Hacknet is a trap" | stands |
| Part I §2 "buy every aug you can afford before installing" | **STALE** — superseded by Part II, and now superseded again by §21: with money effectively unlimited the constraint is the 1.9^n *time* cost, not affordability |
| Part I §2 "CashRoot Starter Kit is not a trap" | **STALE** — reversed by Part III §8/II, and irrelevant now: home RAM is 2048 GB and survives installs, so $1m of starting cash is noise |
| Part I §5 sequencing "clear contracts before the first faction" | **STALE** — see §21; contract money is now ~0.02% of income |
| Part II §6 "grow and weaken award exactly the same as hack" | **STALE/imprecise** — see §16b, `hack` pays ¼ when the target is drained |
| Part II §7 "home RAM to 128 GB" / Part III "to 256 GB" | **DONE and exceeded** — home is **2048 GB** |
| Part II §8 / III §13 "`ns.share()` is a bad trade / only worth it past hacking 250" | **STALE** — it is running (2,040 threads) and should be ~13× larger (§16c) |
| Part II §9 / III §13 "`run buyserv.js --reserve`, the aug money will be spent" | **STALE** — $21.3b in hand, aug batch costs ~$2.5b. Non-issue. |
| Part III §11 "no faction in `FactionInfo.tsx` carries the `keep` flag — `grep 'keep: true'` returns nothing" | **WRONG METHOD, right answer for us.** The field is **`keepOnInstall`** (`FactionInfo.tsx:56,105`) and **13 factions set it true** (ten megacorps, The Covenant, CotMG, Shadows of Anarchy). None of ours do, so our conclusion held by luck. Matters for SoA (§17). |
| Part III §12 "$1.86b/hour" | **STALE, 60× low** — `incomePerSec` is $33.1m/s ≈ **$119b/h** (`.telemetry/status.txt` 00:51) |
| Part III §14 "install trigger: NiteSec 20,000 + $700m" | **SUPERSEDED** — §21 |
| Part III §14b milestone 12 / §15 "post-install: join nothing, take no job" | **HALF STALE** — "take no job" is right and now better-argued (§19). "Join nothing" was a *money* argument and money no longer matters: see §21. |
| Part III §15 "contracts pay $11.111m at zero factions" | **ARITHMETIC CONFIRMED** (§21) — and **no longer decision-relevant** |
| Part I §3 / II §6 story-server levels (`avmnite-02h` 213, `I.I.I.I` 348, …) | **STALE after any install** — `initForeignServers()` re-rolls the world at prestige (`src/Prestige.ts`), so all of these re-roll within their ranges |
| Part II/III claims that reputation is the sole bottleneck | **stands, and is now the only thing on the critical path** |

---

## 21. Revised install trigger

### The two facts that change the calculation

**1. Reputation is not spent when you buy an augmentation — only money is.**
`purchaseAugmentation` checks `faction.playerReputation < augCosts.repCost` and then calls
`Player.queueAugmentation` + `Player.loseMoney` (`src/Faction/FactionHelpers.tsx:97-124`).
So at NiteSec reputation `R` you may buy **every** aug with `repCost ≤ R`, **plus** NeuroFlux
Governor levels while `500 × 1.14^L ≤ R` — i.e. `L ≤ log₁.₁₄(R/500)`:

| NiteSec rep | NFG levels purchasable |
| --- | --- |
| 5,063 (now) | 18 |
| 20,000 | 29 |
| 50,000 | 36 |

**2. Money now costs time in minutes, so the 1.9^n batch multiplier is a *schedule* constraint,
not a budget one.** `getAugCost` (`src/Augmentation/AugmentationHelpers.ts:127-163`):
`moneyCost = baseCost × 1.9^(queued non-SoA augs)`, rep cost **not** multiplied. At $119b/h:

| batch | money | time to earn |
| --- | --- | --- |
| 8 hacking augs at NiteSec 20,000 | $2.93b | **90 seconds** |
| 10 hacking augs at NiteSec 50,000 | $16.5b | **8 minutes** |
| + 8 NFG levels on top of 10 augs | $207.2b | **1.7 hours** |
| + 10 NFG levels on top of 8 augs | $251.1b | **2.1 hours** |
| + 12 NFG levels on top of 8 augs | ~$1.2t | ~10 hours |

⇒ **NFG count, not aug selection, is now what the batch costs.** Each level is +1% to *every*
multiplier — including `hacking`, `hacking_exp`, and `faction_rep` — and **+1 toward Daedalus's
30**. The practical ceiling is ~9–11 levels before the 2.166× per-level cost ratio
(`1.14 × 1.9`) outruns any sane earning window.

### Aug data, re-read from source (correcting Parts II/III)

`src/Augmentation/Augmentations.ts`. Rep costs are NiteSec unless noted.

| aug | rep | base $ | `hacking_exp` | `hacking` | `hacking_speed` | line |
| --- | --- | --- | --- | --- | --- | --- |
| Neurotrainer I (CyberSec) | 1,000 | $4m | **1.10** | — | — | 1242-1256 |
| SynapticEnhancement (CyberSec) | 2,000 | $7.5m | — | — | 1.03 | 1726-1733 |
| BitWire | 3,750 | $10m | — | **1.05** | — | 181-188 |
| ArtificialSynapticPotentiation | 6,250 | $80m | 1.05 | — | 1.02 | 62-71 |
| Neurotrainer II | 10,000 | $45m | **1.15** | — | — | 1258-1271 |
| CranialSignalProcessors G1 | 10,000 | $70m | — | **1.05** | 1.01 | 418-428 |
| CranialSignalProcessors G2 (prereq G1) | 18,750 | $125m | — | **1.07** | 1.02 | 430-442 |
| **NeuralRetentionEnhancement** | **20,000** | $250m | **1.25** | — | — | 1118-1125 |
| **CRTX42-AA** | **45,000** | $225m | **1.15** | **1.08** | — | 309-318 |
| **CranialSignalProcessors G3** (prereq G1,G2) | **50,000** | $550m | — | **1.09** | 1.02 | 444-456 |
| NeuroFluxGovernor (any faction) | 500×1.14^L | $750k×1.14^L | 1.01/lvl | 1.01/lvl | 1.01/lvl | 1159-1186 |

Part II's table listed `ArtificialSynapticPotentiation` exp as ×1.071 (it is **×1.05**, already
corrected in Part III) and mis-attributed `EnhancedMyelinSheathing` to NiteSec. Both stand
corrected. **And per §16b, the `hacking` column is a reputation column.**

### Three candidate triggers, priced

`hacking` and `faction_rep` both multiply the reputation rate; `hacking_exp` and `hacking_speed`
multiply how fast the next life re-levels.

| trigger | augs | NFG | money | `hacking_exp` | **rep-rate effect** (`hacking × faction_rep`) | Daedalus count | NiteSec favor banked |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **A — install now** (NiteSec 5,063) | 4 | 12 | $89.5b | ×1.24 | ×1.40 | **16** | 9.3 |
| **B — NiteSec 20,000** (~2.1 h) | 8 | 10 | $251b | ×1.83 | ×1.44 | **18** | **29.7** |
| **C — NiteSec 50,000** (~6 h clicking / ~1 h infiltrating) | 10 | 8 | $207b | **×2.07** | **×1.63** | **18** | **55.5** |

(A's four augs are NT1 + SynEnh + BitWire + CSPG1, all reachable on CyberSec's 11,509.
B adds NRE, ASP, NT2, CSPG2. C adds CRTX42-AA and CSPG3. `repToFavor` from
`src/Faction/formulas/favor.ts:17-19`.)

> ### ⇒ The trigger, restated
>
> **If infiltration clears at `q ≥ 0.7` (§17): go to NiteSec 50,000 — option C.** It is ~1 hour
> of infiltration, it is worth `hacking_exp ×2.07` and `rep-rate ×1.63` against B's ×1.83/×1.44,
> and it banks **55.5 favor** instead of 29.7 — +55% on every future life's reputation rate.
>
> **If infiltration does not clear: install at NiteSec 20,000 — option B**, exactly as Part III
> said, but buy **eight** augs plus **ten** NFG levels for ~$251b rather than seven augs for
> $669m. The money is 2.1 hours of income and it buys 18 of Daedalus's 30 augmentations in one
> reset instead of 7.
>
> **Do not install now (A).** It is 16 Daedalus augs for $89.5b, but it forfeits
> `NeuralRetentionEnhancement` (the only ×1.25 exp aug in reach) and banks 8 favor instead of
> 30–55. NiteSec 20,000 is two hours away; there is no version of "install now" that wins.

Buy order within the batch: **descending base cost, NFG last and ascending**, with the one
forced exception that `CSPG1 → CSPG2 → CSPG3` must be bought in that order (`prereqs`,
`Augmentations.ts:438,452`).

### Sanity-check of §15's post-install plan

**The $11.111m figure is arithmetically correct.** `gainCodingContractReward`
(`PlayerObjectGeneralMethods.ts:501-570`) with `adjustedScaling = rewardScaling/3` and each
recursion passing `adjustedScaling` in as the next `rewardScaling`:
FactionReputation → Money at 1/9 = $8.333m; FactionReputationAll → same; CompanyReputation →
50/50 into a faction type at 1/3, which with zero factions recurses to Money at 1/27 = $2.778m;
Money = $25m. Uniform 25% each (`ContractGenerator.ts:179-190`) ⇒ **$11.111m**. With ≥1 faction
it is **$6.250m**, flat for every `n ≥ 1`.

**But the conclusion drawn from it is now wrong.** At ~4.5 contracts/hour the zero-faction
premium is `4.5 × $4.861m = $21.9m/hour` — **0.018% of the $119b/h the fleet earns**, or about
0.7 seconds of hacking income. Meanwhile each joined faction begins earning **150 rep/hour
passively the moment you accept** (`FactionHelpers.tsx:132-170`, measured at exactly 0.04167
rep/s), and reputation is the only constraint that exists.

> **§15 rule 1 is reversed.** After install #1: **backdoor `CSEC` and `avmnite-02h` as fast as
> possible and accept both invites immediately.** Do not delay for contract money.
> "Take no job" (§15's other half) stands and is now better argued (§19).

The rest of §15 holds, with two updates: home RAM is **2048 GB** and survives the install
(`prestigeHomeComputer` clears programs, not `maxRam` — `src/Server/ServerHelpers.ts:226-240`),
so the dead zone should be minutes; and with `mults.hacking ≈ 1.3` and `hacking_exp ≈ 1.8–2.1`,
re-reaching a story server's level is trivial — `calculateSkill` with mult 1.3 needs only
~87,000 exp for level 213 (`formulas/skill.ts:8-14`). **Note the story servers' required levels
re-roll at prestige**, so Part II's exact values (213 / 348 / 539) do not carry over.

---

## 22. Revised critical path

Everything below is ordered by **rep per unit of the constraint it consumes**.

| # | action | owner | consumes | worth | status |
| --- | --- | --- | --- | --- | --- |
| 1 | **Run ONE Joe's Guns infiltration and count minigames cleared** | game-player | ~1 min of attention | decides whether the runway is 1 h or 6 h (§17) | **do this first** |
| 2 | **Click Options → Export Game once** | game-player | one click | **+1 favor to all three factions = +1% rep forever**, free (§16d) | never done |
| 3 | **Raise `share.js` 2,040 → ~30,000 threads** (72 TB of 268 TB) | game-player | idle RAM | **+8% on every rep stream** (§16c) | 1.8% of fleet allocated |
| 4 | **Keep NiteSec faction work focused** | game-player | human attention | ×1.25 vs unfocused | **already correct** — `focus: true`, verified in save |
| 5 | **Write a Go bot farming Daedalus on 13×13** | optimizer | script time only | **`faction_rep` ×1.12–1.20** — the only way to move that multiplier this life (§19) | nobody has looked at Go |
| 6 | If stepping away: **leave faction work running and close the tab** | game-player | — | 1.63 rep/s offline vs 0.042 rep/s online-idle (§16d) | — |
| 7 | **Install at NiteSec 50,000 if infiltration works, else 20,000** | game-player | ~1 h or ~2.1 h | 18 Daedalus augs, exp ×1.83–2.07, rep-rate ×1.44–1.63 (§21) | NiteSec 5,063 |
| 8 | Post-install: **backdoor CSEC + avmnite-02h and join immediately** | game-player | minutes | 150 rep/h ×2 + contract rep, from minute one (§21) | reverses §15 |
| 9 | ~~Fix `contract.js` Caesar solver~~ | — | — | — | **done, `ctsolvers.js:399`** |
| 10 | **Do not** take a job, join a 4th faction, build hacknet, buy TIX, or buy DarkNet access | all | — | all verified negative or neutral (§19) | — |

**The one-line summary:** reputation is still the only thing on the critical path, every
multiplier on it except `share` and `focus` is pinned at 1.0 by a missing Source-File — **except
`Player.mults.faction_rep`, which Go can move, and `Player.mults.hacking`, which augmentations
move and which Parts I–III never counted as a reputation multiplier.** The single biggest
unknown in the run is whether a browser agent can clear Brutal infiltration minigames; that is
an hour-vs-six-hours question and it costs one minute to answer.

---

## Open questions after Part IV

- **`q`, the per-minigame Brutal hit rate.** Everything in §17 hinges on it and it cannot be
  derived from source. One Joe's Guns run answers it.
- **Go game wall-clock and win rate vs Daedalus.** I verified the reward formulas and that
  losses still bank nodePower at 0.5×, but not how long a 13×13 game takes in practice or
  whether a simple bot wins often enough for the ×3 streak multiplier. Optimizer's number.
- **Marginal exp/s per thread.** §16c's share-vs-exp crossover at ~30,000 threads uses
  `e_t = 0.0255 exp/s/thread` derived from 5,934 exp/s over 232,617 threads. That is a fleet
  average on a saturated `phantasy`, not a marginal rate; if the fleet were split across targets
  the crossover would move *down* (less share). Treat 30,000 as an upper bound.
- **Whether `ns.share()` threads should live on home.** `getCoreBonus` is the only per-server
  term and every server has 1 core, so it does not matter today — but if anyone ever buys a home
  core ($1b for the first, `1e9 × 7.5^cores`), share on home would be worth ×1.0625 on threads,
  which the log turns into +0.24%. Do not buy cores.
- **Infiltration combat/charisma training.** §17's Alpha Enterprises unlock needs 44 total stats
  *and* defense ≥ 10 for the HP. I did not price how long Rothman University / Powerhouse Gym
  take to deliver that, nor whether the 10% backdoor discount on those locations is worth the
  two backdoors.
