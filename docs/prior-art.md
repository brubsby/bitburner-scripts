# Prior art

What our scripts actually solve, stated abstractly, and what is known about each
problem. Owned by the **prior-art** agent.

Status legend: **[verified]** read in game source or our source; **[claim]** a
citation asserts it, not checked against source; **[inferred]** my reasoning.

Game source read at `~/Repos/bitburner` @ `b5b09b8a8` = `v3.0.1-190`
(package version 3.0.2). Every community claim below is checked against that
tree and labelled with the version it was written for.

## Ranked findings

Ranked by expected payoff ÷ effort.

| # | Finding | Where | Effort | Act now? |
| --- | --- | --- | --- | --- |
| 1 | **Contract rewards are $75M base, not $4,000** — `contract.js` is off by 18,750x and is a one-shot script sitting on ~$50M/hr of standing EV. Put it on a loop. | §1a | trivial | **yes** |
| 2 | **`Encryption I: Caesar Cipher` is the only unsolved contract type that can spawn in our run** (no Source-Files ⇒ `maxDif = 1` ⇒ 5 types only). ~20% of spawns, 5 lines of code. | §1b | trivial | **yes** |
| 3 | **Target ranking is missing the grow cost.** `auto.js` scores `M·φ/T`; the derivation says `M / (T·(1.98/φ + 6.16/k))`. It systematically over-ranks high-money / low-growth servers. Also missing the hack-chance factor. | §5 | small | **yes** |
| 4 | **`hack.js` is not a batcher** — it is a one-action-at-a-time wave loop that sleeps a full weaken duration each cycle, so RAM duty cycle is ~25% on its best cycles. The premise in the brief is wrong. | §3 | — | know it |
| 5 | **The HWGW schedule is not a decision.** Throughput = `(money per RAM-second) × total RAM`; the batch period cancels out. Greedy just-in-time is optimal, and the real free variable — hack fraction — has a closed-form answer: **make it as small as integrality allows**. Gives the optimizer a hard ceiling to measure against. | §3 | derivation done | **hand to optimizer** |
| 6 | **Server cost is exactly linear ($55,000/GB) in BN1 and upgrades cost the difference**, so there is provably nothing to optimize in *when* to buy — spend immediately, always. `buyserv.js`'s policy is right; it just buys at most one server per 120s tick and leaves cash idle. | §2 | small | yes, small |
| 7 | **`hacknet.js` has a `js.` → `ns.` typo at line 208** (instant ReferenceError) and is written for Hacknet *Servers*, which need SF9. Dormant either way. | §7 | trivial | no (dead code) |
| 8 | **Grow-thread inversion is already solved optimally inside the game** — and the game's own source explains why the popular Lambert-W approach is *wrong* (floating-point range). `ns.growthAnalyze` is the uncorrected version and overestimates; `hack.js` bisects on it where a two-op closed form exists. | §4 | small | yes, small |
| 9 | **The growth-rate constant is clamped below security 8.571**, so "weaken to exactly min for cheaper grows" is false on low-security targets. Corrects a natural but wrong tuning instinct. | §8b | — | know it |
| 10 | **Multi-target thread allocation is not our problem.** Return per target is *linear*, not concave, up to a saturation point around 1TB of RAM. Greedy all-on-one is exactly optimal at our scale. `auto.js` is already right. | §6 | — | leave alone |
| 11 | Stock tick draws its move *magnitude* once per tick for all stocks (`const v = Math.random()` outside the loop) — a correlation nobody seems to have documented. Irrelevant until we can afford $30B of API access. | §8a | — | park |

### The two or three worth doing this week

1. **§1 — contracts.** Add `Encryption I`, fix the reward constant, and run
   `contract.js` on a timer. Highest money-per-line in the whole document, and
   it is money we are currently letting expire on the network.
2. **§5 — fix the target ranking in `auto.js`.** One formula, derived not
   guessed, with `ns.getServerGrowth` (0.1GB) as the only new call.
3. **§3 — give the optimizer the throughput ceiling.** Not a code change:
   `money/sec ≤ (m/R)·Ω` evaluated at `f → 0` is the number any batcher can be
   scored against, which turns "is candidate A better than candidate B" into
   "how close is A to the bound".

### Where the literature says we are already right

- **`buyserv.js`'s "buy the largest affordable"** — with a linear cost curve
  and no lumps there is no optimal-stopping problem to solve. Do not go looking
  for one. (§2)
- **`auto.js` pointing everything at one target** — exactly optimal, not an
  approximation, until the fleet reaches ~1TB. (§6)
- **The just-in-time batch schedule** everyone uses — optimal, because the
  period cancels out of the throughput expression. (§3)
- **`hacknet.js`'s payoff-time gate** — the economically correct criterion,
  already present. (§7)
- **Not building a bandit for target selection** — the problem is fully
  observed; there is nothing to explore, and with switching costs no index
  policy is optimal anyway (Banks & Sundaram 1994). (§5)

## 1. Coding contracts

Game version checked: `~/Repos/bitburner` @ `b5b09b8a8` (`v3.0.1-190`,
package version 3.0.2). Every claim below is read from that tree.

### 1a. The reward constant in `contract.js` is wrong by ~18,750x [verified]

`contract.js:6` — `const contract_base_money_gain = 4000`.

Game: `src/Constants.ts:91-93`
```
CodingContractBaseFactionRepGain: 2500,
CodingContractBaseCompanyRepGain: 4000,
CodingContractBaseMoneyGain: 75e6,
```

`src/PersonObjects/Player/PlayerObjectGeneralMethods.ts:501-561`:
```
adjustedScaling = rewardScaling / 3          // rewardScaling defaults to 1
moneyGain = 75e6 * difficulty * BN.CodingContractMoney * adjustedScaling
```

So a money contract pays **$25M × difficulty** at default scaling, not
$4,000 × difficulty. Rep constants (2500 / 4000) are still right but also
get the `/3`.

There is a second effect worth knowing: reward types that cannot be paid
**fall back to money, recursing with the already-divided scaling**
(lines 514-552). With no factions and no job — our current state:

| Rolled reward | What actually happens | Payout at difficulty 1 |
| --- | --- | --- |
| Money | direct | 75e6/3 = **$25.0M** |
| FactionReputation | no hacking factions → Money at scaling 1/3 | 75e6/9 = **$8.33M** |
| FactionReputationAll | same | **$8.33M** |
| CompanyReputation | no jobs → Faction* at 1/3 → no factions → Money at 1/9 | 75e6/27 = **$2.78M** |

`getRandomReward` (`ContractGenerator.ts:179-190`) picks uniformly from the
four, so **EV ≈ $11.1M per contract while we have no factions and no job.**
Once we join a hacking faction the two faction rolls become 833 rep instead,
and money EV drops to $25M × 1/4 = $6.25M per contract.

Spawn rate [verified]: `src/engine.tsx:204` calls `tryGeneratingRandomContract(3)`
every 3000 engine ticks (200ms each) = every 10 minutes; each try succeeds with
p ≈ 0.25 while the world has few contracts (`ContractGenerator.ts:29-68`). So
**~0.75 contracts per 10 min ≈ 4.5/hr ≈ $50M/hr of expected value** sitting on
the network right now, and `contract.js` is not on a timer — it is a one-shot
script. **Action: run it on a loop.**

### 1b. Only difficulty ≤ 1 contracts can spawn in our run [verified]

`ContractGenerator.ts:83-86`:
```
const totalSFs = [...Player.sourceFiles].reduce((t,[_,lvl]) => t+lvl, 0);
const maxDif = 2 * totalSFs + 1;
const problemType = getRandomProblemType(maxDif);   // filters difficulty <= maxDif
```

We have zero Source-Files, so `maxDif = 1` and only these five types generate:

| Type | difficulty | in `contract.js`? |
| --- | --- | --- |
| Find Largest Prime Factor | 1 | yes |
| Subarray with Maximum Sum | 1 | yes |
| Total Ways to Sum | 1 | yes |
| Algorithmic Stock Trader I | 1 | yes |
| **Encryption I: Caesar Cipher** | 1 | **no** |

So the practical gap today is exactly one contract type — roughly **20% of all
spawns, ~$2.2M/hr of EV** — and it is a five-line function. This is the single
highest value-per-effort item in this document.

Spec (`src/CodingContract/contracts/Encryption.ts:58-66`, and note it is a
**left** shift, i.e. decrypt-shaped):
```js
// data = [plaintext (uppercase, spaces), shift]
data[0].split('').map(a => a === ' ' ? a
  : String.fromCharCode(((a.charCodeAt(0) - 65 - data[1] + 26) % 26) + 65)).join('')
```

Everything else in section 1c only matters after the first aug install starts
handing us Source-Files, at which point `maxDif` rises by 2 per SF level.

### 1c. Full type inventory: 30 types, `contract.js` covers 16 [verified]

`src/CodingContract/Enums.ts` lists 30 `CodingContractName` values.
`contract.js:38-409` implements 16. Missing, with the known-optimal algorithm
and complexity:

| Type | diff | Abstract problem | Optimal algorithm | Complexity |
| --- | --- | --- | --- | --- |
| Encryption I: Caesar Cipher | 1 | modular character shift | direct | O(n) |
| Encryption II: Vigenère Cipher | 2 | polyalphabetic shift by repeating key | direct | O(n) |
| Total Ways to Sum II | 2 | bounded coin-change **counting** | 1-D DP over coins outer, sum inner | O(n·S) |
| Compression I: RLE | 2 | run-length encode, runs capped at 9 | greedy is optimal (runs are independent) | O(n) |
| Total Number of Primes | 2 | π(hi) − π(lo−1), range ≤ 1e6, hi ≤ 6e6 | **segmented** sieve of Eratosthenes | O((hi−lo)·log log hi + √hi) |
| Array Jumping Game II | 3 | min jumps to end of array | greedy BFS-by-levels (Jump Game II) | O(n) |
| Compression II: LZ Decompress | 4 | run the decoder | direct simulation | O(n) |
| Square Root | 5 | ⌊√N⌉ for a ~200-digit BigInt | integer Newton / Karatsuba sqrt on BigInt | O(log N) iterations |
| HammingCodes: Int → Binary | 6 | extended Hamming encode (SEC-DED) | parity over index bitmasks + overall parity | O(b log b) |
| Largest Rectangle in a Matrix | 6 | max all-zero axis-aligned rectangle in 0/1 matrix | per-row histogram + monotonic stack | O(R·C) |
| Proper 2-Coloring of a Graph | 7 | bipartiteness test + witness | BFS/DFS 2-coloring | O(V+E) |
| Shortest Path in a Grid | 7 | shortest path, unit weights, obstacles | BFS (A*/Manhattan optional) | O(R·C) |
| HammingCodes: Binary → Int | 9 | decode with single-bit correction | XOR of set-bit indices = error position | O(b) |
| Compression III: LZ Compress | 10 | **minimum-length** LZ encoding | DP over (literal-vs-backref, offset 1-9, run len 0-9) | O(n·100) |

Notes worth carrying:

- **Compression III is the one where greedy is genuinely wrong.** The game's own
  reference implementation (`contracts/Compression.ts:202-230`) is a DP carrying
  100 states per character (`state[i][j]`, i = 0 literal else backref offset,
  j = length), which is exactly the standard "optimal parsing" formulation for
  LZ77-family codecs (Katajainen & Raita; the same idea as zopfli's shortest-path
  parse). Anyone who ships a greedy longest-match encoder here loses. The
  checker is lenient in one useful way: `solver` accepts **any** encoding with
  `answer.length <= optimal.length` that round-trips, so we only need to tie.
- **Largest Rectangle** is also lenient: `solver` only requires the rectangle be
  valid (all zeros, in bounds) and have **area equal to** the optimum
  (`contracts/LargestRectangle.ts:120-152`). Ties are free. Note the answer is a
  corner pair `[[r1,c1],[r2,c2]]`, not an area.
- **Total Number of Primes** was deliberately designed (comment at
  `contracts/TotalPrimesInRange.ts:18-20`) so a precomputed prime table is
  impractical and a naive per-value primality test is slow-but-possible. The
  intended answer is a sieve; a segmented sieve is the textbook fit for
  `[lo, hi]` with `hi ≤ 6e6, hi−lo ≤ 1e6`.
- **Square Root** requires `BigInt`. `getData` returns `n² + offset` where the
  offset can land on the **rounding boundary** — `generate()` explicitly spends
  half its rolls on the edge cases `offset = ±(n−1)`, since round(√x) = n exactly
  on `[n²−n+1, n²+n+1)`. Anything using `Math.sqrt` or `Number` loses precision
  at 200 digits and will fail those. Use integer Newton on BigInt with a
  `BigInt(Math.sqrt(...))`-derived seed, then a final `±1` correction against
  `(r+1)² ≤ x` and the round-half rule.
- **HammingCodes: Binary → Integer** is the classic one-line trick: XOR together
  the indices of all set bits; the result is the (1-indexed) position of the
  flipped bit, 0 if clean. Flip it, then read the data bits. Worth stating
  because the obvious implementation (recompute every parity group) is fine too
  but people get the bit ordering wrong.

### 1d. Things `contract.js` does that are *not* broken [verified]

I expected the string-returning solvers (`Algorithmic Stock Trader I/II` return
`.toString()`, `Merge Overlapping Intervals` returns `"[1,3],[4,6]"`) to be
rejected now that `validateAnswer` demands `number` and `[number,number][]`
(`ContractTypes.ts`, per-contract `validateAnswer`). They are not:
`CodingContract.isValid` (`src/CodingContract/Contract.ts:115-127`) runs
`convertAnswer` on any **string** answer first, and `parseArrayString` adds the
missing outer brackets. So the legacy string path still works. Leave it alone.

The authoritative input/answer type table is in our own
`NetscriptDefinitions.d.ts:9819-9850` (`CodingContractSignatures`) — use it
rather than guessing, it is generated from the live game.

One real but harmless staleness: `ns.codingcontract.attempt` now takes
`(answer, filename, host?)` and always returns the reward string
(`src/NetscriptFunctions/CodingContract.ts:88-92`); the
`{ returnReward: true }` 4th argument at `contract.js:540` is ignored.
`ns.codingcontract.getContract(fn, host)` is the newer ergonomic API — it hands
back `{type, data, submit, difficulty, numTriesRemaining}` in one call and
would remove three RAM-costing calls per contract.

### Verdict

Worth acting on **now**: (1) add Encryption I, (2) run `contract.js` on a
~5-minute loop instead of one-shot, (3) fix the reward constant so
`--print-expected` stops lying. That is maybe 30 lines for something on the
order of $50M/hr in the current game state. The other 13 solvers are
**not** worth writing until we have Source-Files, because those contracts
cannot spawn.

## 2. Reinvestment timing (server purchasing)

### The formulation is degenerate, and that is the finding [verified]

`src/Server/ServerPurchases.ts:22-40`:
```ts
const upg = Math.max(0, Math.log2(sanitizedRam) - 6);
return sanitizedRam * 55000 * currentNodeMults.CloudServerCost
                   * Math.pow(currentNodeMults.CloudServerSoftcap, upg);
```
In BN1 `CloudServerCost = 1` and `CloudServerSoftcap = 1`
(`src/BitNode/BitNodeMultipliers.ts:131,134`), so the `upg` term is exactly 1
and

> **cost(ram) = ram × $55,000. Purely linear. No economy of scale, no softcap.**

And `getCloudServerUpgradeCost` (line 42-52) is
`getCloudServerCost(new) − getCloudServerCost(old)` — i.e. **upgrading later
costs exactly the difference, with no penalty.**

Two consequences that kill the interesting version of the problem:

1. **There is no reason to save up.** The usual "optimal stopping / should I
   wait for the bigger machine" question exists only when the cost curve is
   concave or there is a lump. Here `cost` is linear and `upgrade` is exactly
   the marginal cost, so a dollar spent on 8GB now and topped up to 16GB later
   buys exactly the same RAM as a dollar held and spent on 16GB later — minus
   the income the 8GB would have earned in the meantime. **Spending immediately
   strictly dominates waiting** as long as marginal RAM has positive marginal
   return.
2. This is the classic result that a **linear-cost, positive-marginal-return
   reinvestment problem has a bang-bang optimal policy**: invest everything,
   always. It is the deterministic degenerate case of the
   Kelly/Merton problem — Kelly's fractional bet only appears when the return
   is *stochastic* and losses are possible; here buying RAM cannot lose money,
   so the Kelly fraction is 1. No literature needed beyond noting that the
   stochastic machinery does not apply.

The only structure left is:

- **The 25-server cap** (`CloudServerLimit: 25`, `src/Server/data/Constants.ts`)
  and **1,048,576GB per server**. Since price is linear, the cap is a pure
  quantity ceiling, not a shape in the cost function. It does not change the
  policy until you are near it.
- **Purchased servers are destroyed on aug install** —
  `src/Prestige.ts:72-80`, "Delete all servers except home computer". Home RAM
  and cores survive (`prestigeHomeComputer` clears only programs/scripts).
- **Home RAM is superlinear and permanent.**
  `getUpgradeHomeRamCost` (`src/PersonObjects/Player/PlayerObjectServerMethods.ts:30-40`)
  = `currentRam × 32000 × 1.58^log2(currentRam)`, so the price *per GB added* is
  `32000 × R^log2(1.58) = 32000 × R^0.66`.

| Home RAM now | cost of the doubling | $/GB gained | vs pserv $55k/GB |
| --- | --- | --- | --- |
| 8GB | $1.02M | $128k | 2.3x |
| 32GB | $10.1M | $316k | 5.7x |
| 128GB | $100M | $781k | 14x |
| 512GB | $993M | $1.94M | 35x |

### So what is the actual decision?

The real problem is not "when to buy" but **how to split the budget between
perishable cheap RAM (pservs) and permanent expensive RAM (home)**, with the
aug install as a known destruction event. That *is* a studied shape: it is
**equipment replacement / investment under a known obsolescence horizon**
(Terborgh's MAPI / the finite-horizon replacement problem), where the right
criterion is the value delivered per dollar over the remaining horizon, not
the value per dollar outright. Concretely:

- Let `H` = time remaining until the next aug install. A dollar into pserv RAM
  earns income for `H` then dies. A dollar into home RAM earns forever.
- Home RAM is 2.3x–35x more expensive per GB. So home RAM wins only when the
  remaining run is short relative to the number of future runs it will serve —
  which for the **first** BN1 install means home RAM is mostly justified by
  *unlocking scripts* (`hack.js` needs >8GB; `tel.js` 4GB), not by throughput.

### What `buyserv.js` does, and the gap

`buyserv.js:44-69`: with `surplus = money − $2M`, buy the **largest power of
two affordable**; once 25 servers are owned, upgrade the smallest.

This is **already essentially optimal** given the linear cost curve, and I want
to be explicit that the literature says we are right here: no cleverer stopping
rule exists for a linear cost with no lumps. The gaps are small and mechanical:

1. **It buys one server per 120s tick.** With linear pricing there is no reason
   to leave money idle; it should loop until the surplus can no longer afford
   the 8GB floor, or buy the single largest affordable then immediately
   continue. Early on, when income is $10k/s and the tick is 2 minutes, this
   is the difference between 1 and several purchases per tick. **Real, cheap
   fix.** [inferred from the cost curve, not measured]
2. **"Upgrade the smallest" is the wrong target once full.** With a linear
   price, *which* server you upgrade is irrelevant to cost — but it is not
   irrelevant to usability: a fleet of 25 equal servers fragments a fixed batch
   worse than a fleet with a few large machines, because an HWGW batch's
   grow/weaken block has to fit on **one** host. Raising the floor is the
   conservative choice and it maximises the number of hosts that can hold a
   given block, so this is defensible — but it is a bin-packing decision, not a
   cost decision, and should be justified that way. See §6.
3. **The $2M reserve is a proxy for the home 8→16GB upgrade.** That is a
   correct instinct (the table above shows home RAM is only worth buying when
   it unlocks something), but it is hardcoded; it should be
   `ns.singularity.getUpgradeHomeRamCost()` when SF4 exists and otherwise the
   closed form `R × 32000 × 1.58^log2(R)`, which needs no API call at all and
   costs 0GB.

### Verdict

The policy is right; the implementation leaves money idle between ticks. Worth
a small fix, not a redesign. **Do not** go looking for a clever optimal-stopping
rule here — the cost curve is linear and there is nothing to find.

**This conclusion is BN1-specific.** `src/BitNode/BitNode.tsx` sets
`CloudServerSoftcap` to 1.1–4 in other BitNodes (lines 577, 604, 632, 662, 696,
730, 766, 850, 892, 1000). Any value **> 1** makes
`softcap^(log2(ram)−6)` grow with size, i.e. **cost per GB rises with server
size** — and then "buy the largest affordable" is actively wrong: you want many
small servers, up to the 25-server cap, and the problem becomes a real
(if easy) convex allocation. Carry the softcap into the rule before leaving BN1.

## 3. HWGW batch scheduling

### First, a correction to the premise

**`hack.js` is not a batcher.** Read it (`hack.js:344-508`): each iteration
picks *one* action for the entire fleet — `weaken`, `grow`, or `hack` — by
threshold (`securityLevel > min + 1` → weaken; `money < 0.9 × max` → grow;
else hack), fires every rooted thread at that one action, then
`await ns.sleep(weakenTime + 300)` (line 508). It is a **synchronous
threshold wave loop**, one wave per weaken-duration. There is no pipelining and
no landing-order discipline beyond two hardcoded 15-second offsets
(`hack.js:339-340`), which clamp to zero whenever `weakenTime < 30s` — i.e.
always, in the early game.

Its duty cycle is the headline problem, not its scheduling: a `hack` wave
occupies RAM for `1T` and then sleeps `4T`, so peak-to-average RAM utilisation
is ≈25% on hack waves, and only some fraction of waves are hack waves at all.

`auto.js` + `early.js` (what is actually running) is different again: each host
gets its own independent `early.js` copy running a private
weaken/grow/hack threshold loop. RAM is never idle, which is better than
`hack.js`, but the hosts **decide independently against shared state**, so they
thundering-herd: everyone sees "money ≥ 75% of max" in the same tick, everyone
hacks, the server is stripped, then everyone grows. Classic.

### The abstract problem, and why it is easier than it looks

Durations are fixed and, importantly, **depend only on the target and the
player — not on which host runs the op** (`src/Hacking.ts:60-93`;
`grow = 3.2 × hack`, `weaken = 4 × hack`, all from the same
`calculateHackingTime`). Duration is computed at *launch* and the effect
applied at *landing*. RAM is a renewable resource held for the whole duration,
partitioned across hosts of differing capacity.

That makes it an RCPSP with a periodic objective, and yes — cyclic scheduling
to maximise throughput on identical parallel machines is
[strongly NP-hard in general](https://www.sciencedirect.com/science/article/abs/pii/0377221795001107)
([cyclic flow shop](https://www.sciencedirect.com/science/article/abs/pii/S0360835216300705),
[recurrent job shop](https://www.sciencedirect.com/science/article/abs/pii/0377221794903328)).
**But none of that hardness bites here, and it is worth writing down why.**

Consider a steady state of identical batches launched with period `p`. Weaken
is the longest op at `4T`, so the number of batches in flight is `4T/p`, each
holding its own RAM. Let `R` = RAM-seconds consumed by one batch and `m` = money
one batch steals. Then

```
in-flight RAM  ≈ R / p          (RAM-seconds per batch, spread over the period)
throughput     = m / p
```
so with total RAM `Ω`, the constraint `R/p ≤ Ω` gives

```
money/sec  ≤  (m / R) × Ω
```

**The period `p` cancels.** Throughput is `Ω` times the batch's *money per
RAM-second* — a pure ratio, with no scheduling decision in it at all. The
schedule only matters for (a) keeping landings in order, (b) integrality, and
(c) packing blocks onto hosts. So:

> **The greedy just-in-time schedule everyone uses is optimal, and the reason
> is that the schedule was never the decision variable. The decision variable
> is the hack fraction per batch.**

### And the hack fraction has a closed-form answer: make it as small as possible

Let `f` = fraction of max money stolen per batch, `φ` = fraction one hack thread
takes at min security (`calculatePercentMoneyHacked`, `src/Hacking.ts:44-58`),
`k = calculateServerGrowthLog(server, 1, …)` (`src/Server/formulas/grow.ts:8-28`).

- hack threads `h = f/φ`, RAM 1.7 each, held `1T`
- grow threads `g ≈ ln(1/(1−f))/k`, RAM 1.75 each, held `3.2T`
- weaken threads `w = (0.002h + 0.004g)/0.05` (`src/Server/data/Constants.ts`:
  `ServerFortifyAmount 0.002`, `ServerWeakenAmount 0.05`; grow fortifies
  **twice** as much, `ServerHelpers.ts:212`), RAM 1.75 each, held `4T`

RAM-seconds per batch:
```
R(f) = T · [ 1.98 · f/φ  +  6.16 · (−ln(1−f))/k ]
```
Money per batch `m = f·M`. So

```
m/R  =  M / ( T · [ 1.98/φ + 6.16/k · (−ln(1−f)/f) ] )
```

`−ln(1−f)/f` is strictly increasing on `(0,1)` with limit 1 as `f → 0`.
Therefore **money per RAM-second is strictly decreasing in the hack fraction,
and the optimum is the smallest `f` you can physically run.** Grow's cost is
convex in `f` while hack's is linear; that convexity is the whole story.

This matches the community consensus ("many small batches beat few fat ones",
"steal ~1% per batch") that shows up on the
[Steam batching threads](https://steamcommunity.com/app/1812820/discussions/4/4731597528368392803/)
and [Kupo's HWGW manager guide](https://steamcommunity.com/sharedfiles/filedetails/?id=2825770722) —
but those state it as a rule of thumb. It is a theorem, and the binding
constraint is not economics but **integrality**: every batch needs ≥1 hack,
≥1 grow and ≥2 weaken threads = `1.7 + 1.75 + 3.5 = 6.95GB` minimum, held for
`4T`. So the true optimum is:

```
f* = the smallest f such that h, g, w ≥ 1   (usually h = 1)
p  = max(4ε, 4T / (Ω / 6.95GB))             ε = landing separation, ~50–200ms
```

i.e. **shrink batches until threads hit 1, then shrink the period until RAM
runs out.** That is fully determined — there is nothing to search.

Caveats I did *not* verify: the game's `additionalMsec` option on
`ns.hack/grow/weaken` lets you pad an op so all four land together from a single
launch instant, which removes launch-time drift as an error source; and thread
counts must be recomputed when `hackingLevel` changes mid-batch, because `φ` and
`T` both move. Both are implementation concerns for the optimizer, not
open questions.

### Verdict

The scheduling theory says we need no scheduler. What we need is a pipeline,
and the gap between what we run (a 25%-duty-cycle wave loop, or uncoordinated
per-host loops) and the ratio bound above is large — plausibly 4-10x, but that
number is the optimizer agent's to measure in `tools/sim/`, not mine to assert.
**The useful thing to hand them is the bound itself**: `money/sec ≤ (m/R)·Ω`
evaluated at `f → 0` is the ceiling any batcher can reach, so they can measure
a candidate against a number rather than against another candidate.

## 4. Grow-threads inverse problem

### The problem [verified]

`src/Server/formulas/grow.ts:37-58` — after a grow with `x` threads:
```
n = (o + x) · exp(k·x)
```
where `o` = money before, `n` = money after, and
`k = calculateServerGrowthLog(server, 1, player, cores)`
`  = log1p(0.03 / hackDifficulty) · (serverGrowth/100) · BN.ServerGrowthRate
     · player.mults.hacking_grow · coreBonus`, capped at
`ServerMaxGrowthLog = 0.00349388925425578 = log1p(0.0035)`.

Inverting for `x` with both a linear and an exponential occurrence of `x` is a
Lambert-W form: `x = W(...)/k − o`.

### The known answer — and the game already implements it, better than W

This is the part worth carrying back. **The game's own source argues that the
Lambert-W route is the wrong answer**, and it is right.
`src/Server/ServerHelpers.ts:110-113`, verbatim:

> *"x appears in an exponent and outside it, this is usually solved using the
> productLog/lambert's W special function, but it turns out that due to
> floating-point range issues this approach is useless to us, so it will be
> ignored."*

The issue is concrete: `W(z)` here has `z ≈ (o·k)·exp(n·k)` and `n` can be
`1e12` while `k ~ 1e-3`, so the argument overflows double range long before the
answer does. Every community "just use Lambert W" snippet has this defect;
several were written against v1 where `moneyMax` was smaller and it mattered
less.

What the game does instead (`ServerHelpers.ts:92-200`) is the textbook
numerically-stable approach and is worth copying verbatim rather than
reinventing:

1. **Work in log form.** Solve `f(x) = log((o+x)/n) + k·x = 0` rather than the
   exponential form. `f' = 1/(o+x) + k > 0` and `f''< 0`, so `f` is strictly
   increasing and concave — Newton converges monotonically and unconditionally
   from any start above the root.
2. **Closed-form warm start.** One Newton step from `x₀ = n − o` gives
   `(n−o)/(1 + n·k)`; one step of the exponential-form Newton from `x₀ = 0`
   gives `(n−o)/(1 + o·k)`. They bracket, so the code uses the weighted
   denominator `1 + (n/16 + 15o/16)·k`. The comment claims this is chosen to be
   *exactly representable* in binary floating point and bounds the worst case to
   **3 iterations**, with 1-2 typical.
3. **Integer correction.** The loop exits at `|Δ| ≤ 1`, then explicitly checks
   `ceil(x)−1`, `ceil(x)` and `ceil(x)+1` against the forward formula
   (lines 179-198) so the returned integer is *exactly* the smallest thread
   count that reaches the target. No off-by-one.

This is a nice instance of the general principle for Lambert-W-shaped roots:
**take logs, then Newton with an algebraically-derived warm start**, which is
also what the standard `lambertw` implementations (Corless et al., *On the
Lambert W Function*, 1996 — Halley iteration on the log form) do internally.
Our situation is the case where you should skip the special function and go
straight to the iteration, because the intermediate `z` is the only thing that
overflows.

### The trap in the exposed API [verified]

There are **two** functions and they are not the same:

| Netscript call | Backing function | Accounts for the `+x` additive term? |
| --- | --- | --- |
| `ns.growthAnalyze(host, mult, cores)` | `numCycleForGrowth` = `log(mult)/k` (`ServerHelpers.ts:76-79`, `NetscriptFunctions.ts:307-318`) | **No** |
| `ns.formulas.hacking.growThreads(...)` | `numCycleForGrowthCorrected` (`NetscriptFunctions/Formulas.ts:198`) | **Yes** |

`ns.growthAnalyze` is the multiplicative-only approximation. It **over**estimates
threads, badly when `moneyAvailable` is small — at `o → 0` the true answer is
finite (the `+x` alone can carry the server up) while `log(max/o)/k → ∞`.
It is free of Source-File gating; `formulas.*` needs SF5.

**`hack.js` uses `ns.growthAnalyze` twice** — `getMoneyAfterGrowCycles`
(`hack.js:93-119`) does a 10-step *bisection* on `growthAnalyze` to invert it
back into a money figure. That is inverting an approximation with a bisection
where a closed form exists: `money after g threads = (o+g)·exp(k·g)`, clamped
at `moneyMax`, computable with two arithmetic ops and **zero** RAM cost (no NS
call at all — `k` needs only `serverGrowth`, `hackDifficulty` and the
`hacking_grow` mult, all cheap or cacheable). The bisection is also biased,
because it inherits `growthAnalyze`'s overestimate.

### Verdict

Nothing to invent — the optimum is implemented in the game and readable. Two
concrete actions, both small:

1. Anywhere we need "money after `g` grow threads", use the **forward** formula
   `min(moneyMax, (o+g)·exp(k·g))` directly. Deletes `hack.js:93-119` entirely
   and removes 10 NS calls per loop.
2. Anywhere we need "threads to reach `n` from `o`", port
   `numCycleForGrowthCorrected` into a local helper (≈20 lines, 0GB RAM) rather
   than calling `ns.growthAnalyze` (1GB, and wrong) or waiting for SF5. This is
   exactly what `tools/sim/` already re-exports, so the reference is in-repo.

Error behaviour worth compensating for: **none in the corrected function** — it
is exact to the integer by construction. The error to compensate for is
entirely in `growthAnalyze`, and the compensation is to stop using it.

## 5. Target selection

### It is not a bandit problem, and that is worth saying out loud

The brief asks whether this is a bandit / Gittins index problem. **No**, and the
reason is structural: a bandit exists because arm rewards are *unknown* and must
be learned. Here every parameter of every target is directly readable and
deterministic — `getServerMaxMoney`, `getServerMinSecurityLevel`,
`getServerGrowth`, `getServerRequiredHackingLevel` — and the reward formulas
(`src/Hacking.ts`, `src/Server/formulas/grow.ts`) are closed forms of those plus
the player's own skill. There is **nothing to explore**. Exploration/exploitation
machinery would be answering a question we do not have.

What remains is a deterministic index policy plus a **switching cost**: changing
target abandons the prep (weaken-to-min, grow-to-max) already invested in the
old server and requires paying it again on the new one. That is the one place
the literature has a sharp thing to say, and it is a negative result:
[Banks & Sundaram, *Switching Costs and the Gittins Index*, Econometrica 62(3)
1994, 687-694](https://link.springer.com/article/10.1007/s10645-004-2477-z) —
**with switching costs, no index on the arms can identify the optimal policy.**
So even if this *were* stochastic, "compute a score per target and take the max"
would not be optimal. The honest framing for us is a small deterministic DP over
(time, current target), or in practice a **hysteresis band**: switch only when
the new target's rate exceeds the current one by more than the prep cost
amortised over the expected holding time. Hysteresis is also what the
deterministic-deteriorating-bandit literature converges on
([Optimal hysteresis for deterministic two-armed bandits with switching
costs](https://www.sciencedirect.com/science/article/abs/pii/S0005109803002036)).

### Our ranking function is missing the grow term [verified + derived]

`auto.js:99-120`:
```js
const rate = (maxMoney * fraction) / (time / 1000)   // fraction = φ at min security
```
i.e. `M·φ/T`. From §3, the correct steady-state figure of merit — money per
RAM-second, which is what actually converts RAM into income — is

```
score = M / ( T · [ 1.98/φ  +  6.16/k ] )
```

`auto.js`'s score is `M·φ/T = M / (T · [1/φ])`. It therefore **models the hack
threads and ignores the grow threads entirely.** The `6.16/k` term is the cost of
putting the money back, and `k` (the per-thread growth log constant) varies by
more than an order of magnitude across servers — it is proportional to
`serverGrowth`, which ranges from single digits to ~100 across the BN1 network.

Consequence: `auto.js` systematically over-ranks **high-money, low-growth**
servers, which are precisely the ones that look most attractive on a naive
money-per-second reading and are most expensive to keep topped up. This is a
one-line fix with a derivation behind it, and it needs no new NS calls beyond
`ns.getServerGrowth` (0.1GB).

Second, smaller omission: `auto.js` does not multiply by **hacking chance**
(`calculateHackingChance`, `src/Hacking.ts:9-24`). A failed `ns.hack` returns
zero, so expected money is `chance × φ × M`. At min security with
`hackingLevel ≫ required` the chance approaches 1 and it does not matter; for
targets just at our level it can be well under 0.5. Since `bestTarget` only
filters `required ≤ hackingLevel`, freshly-unlocked servers are exactly the ones
being mis-scored — and those are the ones a level-driven retarget keeps
selecting.

`hack.js:184-186` has a different ranking again — a hand-inlined
`avgMoneyRateLambda` that does include the chance factor and a `/24000` term
(note: `calculatePercentMoneyHacked` divides by `balanceFactor = 240` and by
100 for percent, so `/24000` is right), then **min-max normalises** five
metrics and picks by one of them. The normalisation is harmless but pointless —
ranking by a monotone transform of a single metric is the same ranking — and the
metric it ends up using has the same missing-grow-term defect.

### Verdict

Two changes, both cheap, both derived rather than guessed:
1. Rank by `M / (T·(1.98/φ + 6.16/k))`, not `M·φ/T`.
2. Multiply by `calculateHackingChance`.

And one thing **not** to do: do not build a bandit, a Gittins index, or an
adaptive explorer. The problem is fully observed. Add hysteresis to the switch
decision instead — that is the only part the literature says is genuinely
subtle.

## 6. Thread allocation across targets

### The return per target is linear, not concave — so greedy is exactly optimal

The brief guesses "concave-ish return per target, so resource
allocation / knapsack structure". The derivation in §3 says otherwise, and the
difference matters:

`money/sec = (m/R) × Ω_target`. **Linear in the RAM assigned to that target**,
with slope `m/R`, up to a hard ceiling. It is not concave at all: doubling the
RAM on a target doubles its income until saturation, because you just run twice
as many identical batches.

The ceiling is where the batch period hits the minimum landing separation. With
one hack thread per batch, a batch takes `φ·M`, and consecutive batches can be
spaced no closer than the landing separation `ε` (four ops per batch, so
conventionally `p ≥ 4ε` unless you interleave):

```
max money/sec from one target  ≈  φ·M / (4ε)
RAM needed to reach it         ≈  6.95GB · 4T / (4ε)  =  6.95GB · T/ε
```

With `ε = 200ms` and a target whose hack time is 30s, saturating a *single*
target needs **~1,000GB**. Our whole fleet cap is 25 servers, and we are
currently nowhere near that.

So the allocation problem is: maximise `Σ rate_i · Ω_i` subject to `Σ Ω_i ≤ Ω`
and `Ω_i ≤ cap_i`. That is a **fractional knapsack with linear utilities**, for
which the greedy "fill the highest-rate item first, then the next" is provably
optimal (Dantzig, 1957) — no DP, no Lagrangian, nothing. And since our `Ω` is
far below `cap_best`, the greedy answer collapses to:

> **Put everything on the single best target.** `auto.js` already does this and
> it is correct — not as an approximation, but exactly.

### The real allocation problem is bin packing, not knapsack

The constraint that actually bites is that an HWGW batch's op blocks must each
fit **entirely on one host** — you cannot split a 400-thread grow across two
servers and have it count as one grow. So the problem is
**bin packing / vector packing of fixed-size blocks into bins of heterogeneous
capacity**, which is NP-hard but where First-Fit-Decreasing is within
11/9·OPT + 6/9 (Dósa's tight bound, 2007) and is what every published
Bitburner batcher uses.

This is where §2's "upgrade the smallest server" rule should be justified: a
uniform fleet maximises the number of hosts that can hold a given block, which
is the right objective for FFD. It is a packing decision masquerading as an
economic one.

### Verdict

Nothing to act on. `auto.js`'s single-target concentration is optimal for our
RAM scale, and will stay optimal until the fleet is on the order of 1TB. Record
the saturation formula `φ·M/(4ε)` so we notice when that stops being true. The
effort belongs in §3 (build a pipeline) and §5 (rank correctly), not here.

## 7. Hacknet upgrade ordering

### First: `hacknet.js` cannot run in this BitNode, and would crash if it could

Two verified blockers:

1. **`hacknet.js:208` says `js.hacknet.getNodeStats(index)`** — `js`, not `ns`.
   That is a plain `ReferenceError` on the first iteration of the main loop.
   One-character bug.
2. It is written for **Hacknet Servers**, not Hacknet Nodes — it upgrades
   `cache`, prices things with `ns.hacknet.hashCost`, and `hash.js` spends
   hashes. `hasHacknetServers()` is
   `canAccessBitNodeFeature(9) && !bitNodeOptions.disableHacknetServer`
   (`src/Hacknet/HacknetHelpers.tsx:34-36`). Without SF9 we have plain Hacknet
   *Nodes*: `ns.hacknet.hashCost` returns `Infinity`
   (`src/NetscriptFunctions/Hacknet.ts:173-181`), `upgradeCache` returns
   `false` (line 113-124), and `hash.js` is inert.

So this whole subsystem is dormant. Worth knowing before anyone spends time
tuning it.

### The formulation, and where greedy is and is not exact [verified + derived]

`src/Hacknet/formulas/HacknetNodes.ts:4-11`:
```
rate(level, ram, cores) = level · 1.5 · 1.035^(ram−1) · (cores+5)/6 · mult
```
Costs (`src/Hacknet/data/Constants.ts`, formulas lines 13-85), all geometric and
**independent of each other**:
```
level L → L+1 :   500      · 1.04^(L−1)
ram  2^j → 2^(j+1): 30,000 · 2^j · 1.28^j
cores C → C+1 : 500,000    · 1.48^(C−1)
new node n    : 1,000      · 1.85^n
```

The objective is **multiplicative across the three axes** while the budget
constraint is additive. That is a nonlinear knapsack, and the standard move is
the one the structure invites: **take logs**.

```
log rate = log(level) + (ram−1)·log(1.035) + log((cores+5)/6) + const
```
Now the objective is *separable and additive*, and for each axis the marginal
gain per dollar is **strictly decreasing**:

| axis | Δ log-rate for the next step | cost of that step | ratio |
| --- | --- | --- | --- |
| level | `log((L+1)/L)` ↓ | `500·1.04^(L−1)` ↑ | ↓ |
| ram | `2^j·log(1.035)` ↑ | `30,000·2^j·1.28^j` ↑ faster | `0.0344/(30,000·1.28^j)` ↓ |
| cores | `log((C+6)/(C+5))` ↓ | `500,000·1.48^(C−1)` ↑ | ↓ |

Non-increasing marginal return per unit cost on every axis is exactly the
condition under which the **incremental (greedy) algorithm is provably optimal**
for separable concave resource allocation — Fox's marginal allocation theorem
(1966), textbook treatment in Ibaraki & Katoh, *Resource Allocation Problems:
Algorithmic Approaches*, MIT Press 1988. So **for a single node, greedy on
Δlog(rate)/cost is exact. No DP needed.**

Where it stops being exact:

- Across nodes the objective is a **sum** of per-node products, and `log` does
  not distribute over a sum. Greedy across nodes is a heuristic. In practice
  nodes are symmetric so the optimum is near-symmetric and the loss is small
  [inferred, not measured].
- `hacknet.js` greedily maximises **Δrate/cost**, not **Δlog(rate)/cost**. For
  an additive across-node objective Δrate/cost is the right index, but it is
  myopic about the multiplicative coupling *inside* a node: buying RAM raises
  the value of every future level upgrade, and a Δrate/cost greedy does not see
  that. The objective is **supermodular** in (level, ram, cores), so the
  exchange argument that makes greedy exact does not apply. The symptom is
  predictable — it over-buys the cheap axis (levels) and under-buys RAM/cores.
  Since costs are independent, the *order* of purchases does not change the
  total price, only which set gets bought; fixing the index to
  `Δlog(rate)/cost` fixes the selection.
- The payoff-time gate (`isLevelUpgradeWorth(..., payoffTime)` etc.,
  `hacknet.js:243-262`) is the economically correct criterion and is already
  there. Keep it.

### Verdict

Low priority: the subsystem is dead in BN1 without SF9. If it is ever revived,
the change is to rank by `Δlog(rate)/cost` rather than `Δrate/cost`, and the
justification is Fox's marginal allocation theorem, not intuition. Do **not**
build a DP — the log transform makes greedy exact per node.

---

## 8. Other problems with real formulations

### 8a. Stock market — Kelly genuinely applies here (unlike §2), but we cannot afford to play

Verified mechanics, `src/StockMarket/StockMarket.ts:264-320`:
- Each tick a stock moves **up with probability `chc = (50 ± otlkMag)/100`**
  (sign from the hidden bull/bear flag `stock.b`), multiplying price by
  `(1+av)`, else dividing by `(1+av)`, where `av = v·volatility/100`.
- **`const v = Math.random()` is drawn once per tick, outside the per-stock
  loop** (line 264). So the *magnitude* of the move is perfectly correlated
  across all stocks in a tick; only the *direction* is independent. That is a
  real, exploitable structure and I have not seen it mentioned anywhere in the
  community material.
- Tick every 6s (`msPerStockUpdate: 6e3`), regime flip every 75 ticks
  (`TicksPerCycle: 75`, `stockMarketCycle()`).

Abstractly: a **multiplicative random walk with a biased Bernoulli whose bias is
a hidden two-state regime that switches on a known period.** Two textbook
problems stacked:

1. *Estimating the bias without 4S data* — Bernoulli parameter estimation with
   change points. The right tools are a **CUSUM / Page's test** or a Bayesian
   online change-point detector, not a moving average. `ns.stock.getForecast`
   hands you the answer directly, but it needs the 4S Market Data **API**.
2. *Sizing the position given an edge* — this is the real **Kelly criterion**
   setting (log-optimal growth, known edge, multiplicative returns). Worth
   contrasting with §2: Kelly does **not** apply to buying servers (no downside,
   linear cost ⇒ bet everything), but it does apply here.

`stock.js:19-20` computes `prob = 2·(forecast − 0.5)` and
`expRet = vol·prob/2`, then sorts by `expRet` and keeps a fixed 10-20% cash
band. That is a sensible expected-return ranking but the sizing is a fixed
fraction, not Kelly. Fixing it would be correct — and irrelevant, because:

**We cannot access any of this.** `src/StockMarket/data/Constants.ts:7-10`:
WSE account $200M, TIX API $5B, 4S data $1B, 4S API $25B. `stock.js`'s own
header says it requires the TIX **and** 4S APIs — $30B. That is a late-BN1
number. Park it.

### 8b. Prep ordering — and a growth-rate cap that is easy to get wrong

Weaken's effect is **independent of current security** — flat
`0.05 × (1 + (cores−1)/16) × BN.ServerWeakenRate`
(`getWeakenEffect`, `src/Server/ServerHelpers.ts:320-323`). Everything else
degrades with security, so weaken-first is the right instinct. But the exact
strength of the argument is not what I first assumed, and the difference is
worth recording because it changes a tuning constant:

**The grow constant is clamped below security 8.571.**
`src/Server/formulas/grow.ts:15-19`:
```ts
let adjGrowthLog = Math.log1p(0.03 / hackDifficulty);
if (adjGrowthLog >= ServerConstants.ServerMaxGrowthLog) adjGrowthLog = ServerConstants.ServerMaxGrowthLog;
```
with `ServerMaxGrowthLog = log1p(0.0035) = 0.003493…`. The cap binds whenever
`0.03/hackDifficulty ≥ 0.0035`, i.e. **`hackDifficulty ≤ 8.571`**. Verified
numerically:

| hackDifficulty | 1 | 5 | 8.57 | 10 | 20 | 50 |
| --- | --- | --- | --- | --- | --- | --- |
| effective `adjGrowthLog` | 0.003494 | 0.003494 | 0.003494 | 0.002996 | 0.001499 | 0.000600 |

So on a low-min-security target, **weakening from security 8 down to security 1
buys exactly zero extra grow rate.** Any claim of the form "growing at min
security is 2x cheaper" is only true above 8.571.

What security *does* still cost, unconditionally
(`src/Hacking.ts:44-93`):

- `calculatePercentMoneyHacked ∝ (100 − hackDifficulty)/100`
- `calculateHackingChance ∝ (100 − hackDifficulty)/100`
- **all three durations** `∝ (2.5·requiredHackingSkill·hackDifficulty + 500)`

The duration term is the interesting one because it is **server-dependent**: for
`n00dles` (`requiredHackingSkill = 1`) the `+500` swamps everything and security
barely affects timing at all; for a target requiring skill 500, the security
term is `1250 × hackDifficulty` and completely dominates. So the value of
prepping to *exactly* minimum scales with the target's required level.

Practical reading:
- `early.js:11` uses `securityThresh = min + 5`. On a low-`requiredHackingSkill`
  opener this is close to free, and the extra headroom avoids weaken churn — it
  is **defensible as written**, contrary to my first read. On a
  high-`requiredHackingSkill` target it is not; the threshold should scale with
  the target, or simply be `min + ~0.5`.
- `hack.js:6`'s `minSecurityLevelOffset: 1` is the safer default.

The one thing that *is* a strict ordering result: within a batch, the weaken
that repairs a hack must land **after** the hack and **before** the grow, which
is why the canonical landing order is H, W, G, W and not H, G, W, W — the grow
would otherwise run at elevated security and, above 8.571, at a genuinely worse
rate.

### 8c. Infiltration minigames

`infiltration.js` / `infilhelper.js` (331 + 164 lines) automate the minigames.
These are not optimization problems — each is a deterministic puzzle with a
known solution procedure (the game generates the answer and checks input). The
only one with any content is the "Cheat Code"/maze game, which is a shortest-path
in a small grid (BFS). No prior art worth importing. I did not audit them against
v3 for API drift; given SF4 is absent and infiltration is manual UI work, that
audit is low value right now.

### 8d. Things I looked for and did not find

- **No published, version-current (v3.x) reference batcher** that I could verify
  against source. The community material I found — the Steam
  [batching](https://steamcommunity.com/app/1812820/discussions/4/4731597528368392803/)
  and [RAM](https://steamcommunity.com/app/1812820/discussions/4/4633736485039828636/)
  threads and [Kupo's HWGW manager](https://steamcommunity.com/sharedfiles/filedetails/?id=2825770722) —
  is v2-era, states the right qualitative rules (small batches, 200ms
  separations, four ops per batch), and none of it contradicts the source I
  read. But the numbers in them (RAM per thread, `hackAnalyze` semantics) are
  the v2 ones and should not be copied.
- **No academic work on this specific scheduling shape**, and per §3 that is
  fine, because the shape collapses to a ratio.
- I did **not** find any source, community or otherwise, that had noticed the
  `const v = Math.random()` correlation in the stock tick (§8a) or the
  reward-fallback cascade in contract rewards (§1a). Both are read directly from
  source; treat them as unconfirmed by anyone else.

---

## Sources

Academic / general:

- [The complexity of a cyclic scheduling problem with identical machines and precedence constraints](https://www.sciencedirect.com/science/article/abs/pii/0377221795001107) — NP-hardness of periodic throughput maximization on identical machines. Cited in §3 to show why the *general* problem is hard, before showing ours is not.
- [Parallel metaheuristics for the cyclic flow shop scheduling problem](https://www.sciencedirect.com/science/article/abs/pii/S0360835216300705) and [Study of a NP-hard cyclic scheduling problem: the recurrent job-shop](https://www.sciencedirect.com/science/article/abs/pii/0377221794903328) — same point.
- Banks & Sundaram, *Switching Costs and the Gittins Index*, Econometrica 62(3) 1994, 687-694 — with switching costs, no index on the arms identifies the optimal policy. [Survey](https://link.springer.com/article/10.1007/s10645-004-2477-z). (§5)
- [Optimal hysteresis for a class of deterministic deteriorating two-armed bandit problems with switching costs](https://www.sciencedirect.com/science/article/abs/pii/S0005109803002036) — the hysteresis-band form the deterministic case converges to. (§5)
- Ibaraki & Katoh, *Resource Allocation Problems: Algorithmic Approaches*, MIT Press 1988 — greedy/incremental allocation is exact for separable concave objectives under a single budget (Fox's marginal allocation theorem, 1966). (§7)
- Corless, Gonnet, Hare, Jeffrey, Knuth, *On the Lambert W Function*, Adv. Comput. Math. 5 (1996) — the standard reference; relevant here mainly to note that the log-form Newton iteration the game uses is what W implementations do internally, without the overflow. (§4)
- Dantzig 1957 (fractional knapsack greedy) and Dósa 2007 (tight 11/9·OPT+6/9 bound for First-Fit-Decreasing). (§6)
- Katajainen & Raita / zopfli-style shortest-path optimal parsing for LZ77 — the standard framing of the game's own `comprLZEncode` DP. (§1c)

Community (all **v2-era**; none contradicted the v3 source I read, but their numeric details are stale):

- [Batch HWGW — Steam discussions](https://steamcommunity.com/app/1812820/discussions/4/4731597528368392803/)
- [HWGW RAM usage — Steam discussions](https://steamcommunity.com/app/1812820/discussions/4/4633736485039828636/)
- [Kupo's automated HWGW Manager guide](https://steamcommunity.com/sharedfiles/filedetails/?id=2825770722)

Game source (authoritative, all paths relative to `~/Repos/bitburner`):
`src/Hacking.ts`, `src/Server/formulas/grow.ts`, `src/Server/ServerHelpers.ts`,
`src/Server/ServerPurchases.ts`, `src/Server/data/Constants.ts`,
`src/CodingContract/*`, `src/Constants.ts`,
`src/PersonObjects/Player/PlayerObjectGeneralMethods.ts`,
`src/PersonObjects/Player/PlayerObjectServerMethods.ts`,
`src/Hacknet/formulas/HacknetNodes.ts`, `src/Hacknet/data/Constants.ts`,
`src/StockMarket/StockMarket.ts`, `src/StockMarket/data/Constants.ts`,
`src/Netscript/RamCostGenerator.ts`, `src/Prestige.ts`, `src/engine.tsx`,
`src/BitNode/BitNode.tsx`, `src/BitNode/BitNodeMultipliers.ts`.
