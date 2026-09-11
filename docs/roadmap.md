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
