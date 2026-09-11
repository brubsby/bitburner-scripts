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
| 1 | **Contract rewards are $75M base, not $4,000** — `contract.js` was off by 18,750x and one-shot, sitting on ~$50M/hr of standing EV. | §1a | trivial | **done** |
| 2 | **`Encryption I: Caesar Cipher` is the only unsolved contract type that can spawn in our run** (no Source-Files ⇒ `maxDif = 1` ⇒ 5 types only). ~20% of spawns, 5 lines of code. | §1b, §1e | trivial | **done** |
| 3 | **Target ranking is missing the grow cost.** `auto.js` scores `M·φ/T`; the derivation says `M / (T·(1.98/φ + 6.16/k))`. It systematically over-ranks high-money / low-growth servers. Also missing the hack-chance factor. | §5 | small | **done** (~4x in sim) |
| 4 | **`hack.js` is not a batcher** — it is a one-action-at-a-time wave loop that sleeps a full weaken duration each cycle, so RAM duty cycle is ~25% on its best cycles. The premise in the brief is wrong. | §3 | — | know it |
| 5 | **The HWGW schedule is not a decision.** Throughput = `(money per RAM-second) × total RAM`; the batch period cancels out. Greedy just-in-time is optimal, and the real free variable — hack fraction — has a closed-form answer: **make it as small as integrality allows**. Gives the optimizer a hard ceiling to measure against. | §3 | derivation done | **hand to optimizer** |
| 6 | **Server cost is exactly linear ($55,000/GB) in BN1 and upgrades cost the difference**, so there is provably nothing to optimize in *when* to buy — spend immediately, always. `buyserv.js`'s policy is right; it just buys at most one server per 120s tick and leaves cash idle. | §2 | small | yes, small |
| 7 | **`hacknet.js` has a `js.` → `ns.` typo at line 208** (instant ReferenceError) and is written for Hacknet *Servers*, which need SF9. Dormant either way. | §7 | trivial | no (dead code) |
| 8 | **Grow-thread inversion is already solved optimally inside the game** — and the game's own source explains why the popular Lambert-W approach is *wrong* (floating-point range). `ns.growthAnalyze` is the uncorrected version and overestimates; `hack.js` bisects on it where a two-op closed form exists. | §4 | small | yes, small |
| 9 | **The growth-rate constant is clamped below security 8.571**, so "weaken to exactly min for cheaper grows" is false on low-security targets. Corrects a natural but wrong tuning instinct. | §8b | — | know it |
| 10 | ~~**Multi-target thread allocation is not our problem.**~~ **Wrong above ~2TB** — the saturation point is real and we are past it. Greedy is right *with a capacity cap*; past the cap marginal return is **negative**, not zero. | §6, §9h | — | **corrected** |
| 11 | Stock tick draws its move *magnitude* once per tick for all stocks (`const v = Math.random()` outside the loop) — a correlation nobody seems to have documented. Irrelevant until we can afford $30B of API access. | §8a | — | park |

### Second pass — for the batcher build (§9)

| # | Finding | Where | Act now? |
| --- | --- | --- | --- |
| B1 | **Op landings use a bare `window.setTimeout`, not the 200ms engine tick.** Resolution is ~1ms. Every "separations below 200ms are pointless" claim in community material is a non-sequitur. | §9a | know it |
| B2 | **An op's duration is fixed at the `ns.hack/grow/weaken` call and its landing is then immutable.** You cannot desync an op in flight, and you cannot correct one either. This is the fact the whole design hangs on. | §9a | know it |
| B3 | **Two desync sources, pushing opposite ways.** Level-ups make everything launched *after* them **shorter** (382ms per level at our state, levels every few seconds under a real batcher). Security elevation during a batch's own 2ε unsafe windows makes anything launched *inside* them **longer** — by 10-60x the separation constant, from the first batch onward. The second is the bigger one and is what the community calls a "task collision". | §9b, §9b′ | **design around both** |
| B3a | Because the remedies are opposite (launch late vs launch at min security), **`additionalMsec` is the thing that makes both satisfiable** — it decouples launch time from landing time. It is also why a JIT batcher without safe-window scheduling is *worse* than a shotgun. | §9b′, §9e | know it |
| B3b | **Phase-lock the batch launch to the middle of a safe window** (phase `3.5ε` in the repeating `4ε` landing cycle). One line of arithmetic; removes the dominant desync mechanism outright for a periodic batcher. Probably the highest value-per-line item in §9. | §9e | **yes** |
| B4 | **A failed `ns.exec` returns 0 silently**, producing a *partial* batch — the worst possible state. Highest-probability real failure; two-line guard. | §9d(1) | **yes** |
| B5 | **In-flight ops do not survive a reload**; workers restart `main()` from the top. A "sleep until timestamp" worker will fire instantly on every one of them at once. And the reload *also* replays offline grow/weaken onto the live servers and jumps the hacking level, so every cached figure is stale. Fix: `{ temporary: true }` (excluded from the save) + a deadline sanity check + re-measure on startup. | §9d(3) | **yes** |
| B6 | **Over-provisioning grow and weaken is free** — excess grow threads add *zero* security (fortify is capped at threads actually used) and security floors at min. Over-provisioning hack is not. Prep generously; guard only the hack. | §9f | **yes** |
| B7 | **No passive server growth or security decay exists in v3.** Money and security are pure integrators of your own ops, so any systematic bias accumulates without bound. This is why open-loop batchers rot over hours. | §9f | know it |
| B8 | **Separation ε is a capacity parameter, not a safety parameter.** Per-target RAM capacity is `6.725·T/ε` GB. Recommend **50ms**, recomputed rather than hardcoded; the game's own v3 docs say 5-50ms, and every source quoting 200-1000ms predates `additionalMsec`. | §9g, §9j | **yes** |
| B8a | **Build the padded periodic batcher, not a JIT one.** JIT's whole theoretical prize is the 29-45% of RAM-seconds that padding wastes; the one published head-to-head measured a real JIT at **25-40%** of a simpler cycling batcher. Measure against §3's ceiling and only chase JIT if the gap exceeds ~1.4x. | §9e, §9j | **yes** |
| B8b | **Recovery: cancel the next hack, don't re-prep.** Community-converged, self-correcting, and near-free given B6. A late op should be **abandoned, not fired late** — firing late converts a timing error into a state error. | §9f, §9j | **yes** |
| B9 | **Keep workers dumb.** RAM is `cost × threads`, so one `getServerSecurityLevel` in a 400-thread grow worker costs 40GB. All sensing belongs in the controller. | §9d(6) | **yes** |
| B10 | v3 no longer needs unique args to run duplicate scripts (`preventDuplicates` defaults false). The v1/v2 random-batch-id idiom is obsolete. | §9c | know it |

### The two or three worth doing this week

1. ~~**§1 — contracts.**~~ **Done** — `ctscan.js`/`ctsolve.js`/`ctsolvers.js`
   ship all five reachable types. §1e closes the audit.
2. ~~**§5 — fix the target ranking in `auto.js`.**~~ **Done** — the index
   `M/(T·(1.98/φ + 6.16/k))` validated at ~4x in simulation and shipped.
3. **§3 — give the optimizer the throughput ceiling.** Not a code change:
   `money/sec ≤ (m/R)·Ω` evaluated at `f → 0` is the number any batcher can be
   scored against, which turns "is candidate A better than candidate B" into
   "how close is A to the bound".
4. **§9 — de-risk the batcher before it ships.** B4 (check every `exec` pid),
   B5 (`{temporary: true}` + deadline check, so a reload cannot fire every
   pending hack at once) and B6 (prep generously, guard only the hack) are each
   a handful of lines and each prevent a class of unattended failure.

### Where the literature says we are already right

- **`buyserv.js`'s "buy the largest affordable"** — with a linear cost curve
  and no lumps there is no optimal-stopping problem to solve. Do not go looking
  for one. (§2)
- ~~**`auto.js` pointing everything at one target**~~ — **retracted above
  ~2TB**, see §9h. Optimal only up to the per-target capacity `batchRAM·T/ε`.
- **The just-in-time batch schedule** everyone uses — optimal, because the
  period cancels out of the throughput expression. (§3) And, separately from
  the throughput argument, JIT *launching* is the only design that is immune to
  level-up drift (§9e).
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

### 1e. Audit closed [verified, re-checked against the shipped code]

The work landed as `ctscan.js` / `ctsolve.js` / `ctsolvers.js`, split that way
because `attempt` (10GB) plus `getContractType` and `getData` (5GB each) will
not fit in one script at our RAM. Re-audited against
`src/CodingContract/Enums.ts`:

- **17 of 30 types implemented**, up from 16. The addition is
  `Encryption I: Caesar Cipher` (`ctsolvers.js:399-406`), which was the entire
  §1b gap.
- **All five difficulty-1 types are now covered.** With zero Source-Files
  `maxDif = 1`, so the 13 remaining types **cannot spawn in this run**. The
  audit is closed until the first aug install grants an SF.
- The 13 still missing are exactly the §1c table:
  `Total Ways to Sum II`, `Array Jumping Game II`, `Shortest Path in a Grid`,
  `HammingCodes` (both directions), `Proper 2-Coloring of a Graph`,
  `Compression I/II/III`, `Encryption II: Vigenère`, `Square Root`,
  `Total Number of Primes`, `Largest Rectangle in a Matrix`. §1c has the optimal
  algorithm and the specific trap for each; that is the implementation brief for
  the day SFs arrive. Write them in difficulty order — `Encryption II`,
  `Total Ways to Sum II`, `Compression I: RLE` and `Total Number of Primes` are
  difficulty 2 and become reachable at the *first* SF level, so they are the
  only four worth pre-writing.
- `ctsolve.js` correctly **skips** unknown types rather than guessing.
  Contracts self-destruct after a bounded `numTriesRemaining`, so a guess is
  strictly negative EV against a solver we will write later. Keep that
  behaviour.
- Stale but harmless: `ctsolve.js` still passes `{ returnReward: true }` as the
  4th argument to `ns.codingcontract.attempt`, which v3 ignores (§1d) — the
  reward string is returned unconditionally now, so the code works by accident.
  If the signature ever tightens its argument validation this breaks silently.

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

> **Superseded in part — read §9h first.** The saturation formula below is
> right and matches what the optimizer measured, but the verdict I drew from it
> ("put everything on one target") dropped the capacity constraint and is wrong
> above ~2TB. §9h has the reconciliation.

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

~~Nothing to act on. `auto.js`'s single-target concentration is optimal for our
RAM scale, and will stay optimal until the fleet is on the order of 1TB.~~

**Revised.** Single-target concentration is optimal only *up to* the per-target
capacity `batchRAM · T/ε`, which the optimizer measured at 2.5-4.5TB and which
we passed some time ago. Greedy fractional-knapsack-with-capacities is still the
right algorithm — it just has a cap in it, and I dropped the cap. Past the cap
the marginal return on RAM is **negative**, not zero, because oversubscribed
batches collide and the damage compounds. See §9h for the full reconciliation
and §9g for how ε sets the cap.

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

- ~~**No published, version-current (v3.x) reference batcher**~~ — **found on
  the second pass, and it was in the repo the whole time**: the game ships its
  own batcher documentation at
  `src/Documentation/doc/en/programming/hackingalgorithms.md`. See §9i. The rest
  of this bullet stands for the *external* material:
  The community material I found — the Steam
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


## 9. What actually breaks a batcher (second pass, for the build)

This section exists because the optimizer is building a real HWGW batcher and
the failure modes are not in §3. §3 asked "what schedule maximises throughput"
and answered "the schedule is not the decision variable". That is still true.
**But it assumed the schedule is executed as planned**, and the whole difficulty
of a batcher is that it is not. Everything below is about the gap between the
plan and what the runtime does with it.

Game source re-read for this section at the same tree (`b5b09b8a8`,
`v3.0.1-190`, package `3.0.2`).

### 9a. How ops are actually scheduled — and the one fact that matters most

The netscript runtime does **not** schedule hack/grow/weaken on the 200ms game
tick. `src/Netscript/NetscriptHelpers.tsx:468-482`:

```ts
function netscriptDelay(ctx: NetscriptContext, time: number): Promise<void> {
  const ws = ctx.workerScript;
  return new Promise(function (resolve, reject) {
    ws.delay = window.setTimeout(() => { … resolve(); }, time);
```

**It is a bare `window.setTimeout`.** [verified] So:

- **Landing resolution is browser timer resolution, not 200ms.** The 200ms
  `CONSTANTS.MilliPerCycle` engine loop (`src/engine.tsx:415-441`) drives
  hacknet, stocks, faction rep, contract generation and autosave; it has nothing
  to do with op landings. Any community guide that tells you separations below
  200ms are pointless "because the game ticks at 200ms" is wrong about v3, and
  as far as I can tell was already wrong about v2.
- The effective floor is 1ms, because the WebIDL `long` conversion on
  `setTimeout` truncates the fractional part. A batch whose ideal landings are
  0.4ms apart will have *identical* `setTimeout` delays. [inferred from the
  WHATWG spec, not from Bitburner source]

And the single most important structural fact, from the same function plus the
call sites (`NetscriptFunctions.ts:262,282,354`, `NetscriptHelpers.tsx:591-615`):

> **An op's duration is computed once, at the instant `ns.hack/grow/weaken` is
> called, and the landing time is then immutable.** Nothing that happens during
> the flight — level-ups, security changes, other landings — moves it. The only
> thing that can cancel it is `killWorkerScript`, which does
> `clearTimeout(ws.delay)` and rejects with `ScriptDeath`
> (`killWorkerScript.ts:56-60`).

That cuts both ways and is the key to the whole design:

- **Good:** you cannot desync an op that is already in flight. There is no
  accumulating error inside a flight.
- **Bad:** you cannot correct one either. Every correction has to happen
  *before* the call, which means the batcher's control authority ends
  `opDuration` before each landing.

### 9b. Desync mechanism #1: level-ups. Quantified

All three durations are `∝ 1/(hackingLevel + 50)` (`src/Hacking.ts:58-93`):

```
hackTime = 5 · (2.5·requiredHackingSkill·hackDifficulty + 500) / (skills.hacking + 50)
growTime = 3.2 · hackTime      weakenTime = 4 · hackTime
```

and **the hacking level is recomputed synchronously inside every op's landing
handler** — `Player.gainHackingExp(expGain)` → `Person.gainHackingExp`
(`src/PersonObjects/Person.ts:49-63`) assigns `this.skills.hacking =
calculateSkill(...)` immediately. There is no deferral to the game tick.
[verified]

So a level-up can happen at *any* landing, and from that instant every
*subsequently launched* op is shorter by a factor `(L+50)/(L+51)`:

```
Δ(weakenTime) per level  =  weakenTime / (L + 50)
```

Numbers for our actual state (telemetry: `hackingLevel` 179, target
`harakiri-sushi`, `requiredHackingSkill` 40, `weakenTime` ≈ 87s at min
security, 60 exp/sec with only 106 threads running):

| | value |
| --- | --- |
| level-up every | ~74s at 60 exp/s (Δexp per level = 3.17% of total exp; `calculateSkill = floor(32·ln(exp+534.6) − 200)`) |
| schedule shift per level-up | **382ms** |
| shift accumulated during one batch's 87s flight | ~450ms now, and **scales with thread count** |

Put a real batcher on the current 2.3TB fleet and exp/sec goes up by roughly the
thread ratio — ~1300 op-threads instead of 106 — so a level every 5-10 seconds,
i.e. **several seconds of cumulative schedule shift inside a single batch's
flight window.** Against a 50-200ms separation constant that is not a
perturbation, it is a rout.

Three consequences worth stating precisely:

1. **The drift is one-directional.** Levels only go up, so durations only go
   down, so *later* batches always catch up on *earlier* ones. The failure is
   always "a young batch's hack overtakes an old batch's grow", never the
   reverse. That makes the failure mode predictable and the guard one-sided.
2. **Intra-batch drift is avoidable exactly.** If all four ops of a batch read
   `calculateHackingTime` at the same instant, their relative offsets are exact
   forever. Two ways to get that: (a) launch all four in one synchronous burst
   and pad with `additionalMsec`; (b) launch each op just-in-time from an
   absolute landing timestamp. Both are analysed in §9e.
3. **Cross-batch drift is the residual**, and its size is `4T·ΔL/(L+50)` over
   whatever window separates two batches. The batcher must either keep that
   window short, re-plan on level change, or make collisions harmless.

A corollary that kills one obvious idea: you cannot "predict" the level-up and
pre-compensate, because exp arrives in lumps at landings whose success is
random (`hack` grants full exp on success, exp/4 on failure —
`NetscriptHelpers.tsx:614-690`). The level is a jump process you observe, not a
schedule you know.

### 9b′. Desync mechanism #2: the unsafe window. Bigger than level-ups, and it points the other way

I originally wrote that level-ups were the only real desync source. **That was
wrong**, and the mechanism I missed is the one the community actually names.
From [bitburner-src issue #274](https://github.com/bitburner-official/bitburner-src/issues/274)
(v2.2.0, 59 parallel batches at 200ms spacing, reporter insisting no level-up
occurred), @Caldwell-74's diagnosis — which closed the issue:

> *"thats most likely just a task collision issue — after hack or grow security
> is increased; if a task starts in the timeframe between them and the following
> weaken, the time of that task is longer than what you would expect /
> calculated"*
>
> *"for the task time calculation the moment they **start** their task is
> important, not when the script is launched. even if you stop launching scripts
> before the first task is finished with that sleep, they might sleep into an
> unsafe window"*

Verified against source. `calculateHackingTime` is linear in `hackDifficulty`
(`src/Hacking.ts:58-79`), so an op **launched** while security is above minimum
runs **longer** than planned:

```
ΔT/T  =  2.5·R·ΔD / (2.5·R·D + 500)         R = requiredHackingSkill, D = hackDifficulty
```

And a correct batch *deliberately* raises security twice per batch: from the
hack landing until W1 lands (`+0.002·h`), and from the grow landing until W2
lands (`+0.004·g`). Those are unsafe windows of width ε each, so in a
steady-state stream **security is elevated roughly half the time.**

Magnitude on our target (`harakiri-sushi`, R=40, D=5, `weakenTime` 87s):

| elevation | source | ΔT on a weaken |
| --- | --- | --- |
| +0.002 | 1 hack thread | 17ms |
| +0.008 | 2 grow threads | 70ms |
| +0.12 | 30 grow threads | 1.05s |

So on a realistic batch the unsafe-window inflation is **10-60x the separation
constant**, and unlike level-up drift it is present from the very first batch,
has nothing to do with experience, and does not go away as the game matures.
This is the dominant desync source, and it is what every community "safe
window" scheduler exists to dodge (jjclark1982's `scheduleForSafeWindows`,
xxxsinx's *"keeps a list of all active batches and avoids all unsafe windows"*).

**The two mechanisms push in opposite directions and have opposite remedies.**
That is the key structural fact for choosing a design:

| | makes ops… | remedy |
| --- | --- | --- |
| **Level-up** (§9b) | **shorter**, for everything launched after the level-up | launch **late**, reading the duration fresh — i.e. JIT |
| **Unsafe window** (§9b′) | **longer**, for anything launched during the 2ε per batch when security is up | launch at a **known-min-security instant** — i.e. all-at-once, or only in safe windows |

A design that only defends against one of them is exposed to the other, and
that — not sleep jitter — is what the "shotgun vs JIT" argument is really about.
`additionalMsec` is what makes both satisfiable at once, because it decouples
*when you launch* from *when you land*: launch inside a safe window, read the
duration there, and pad the remainder. The pad itself is immune to both
mechanisms, since it is added after `calculateHackingTime`
(`NetscriptFunctions.ts:272,336`; `NetscriptHelpers.tsx:598`).

A third, cheaper defence that the community uses and that follows directly from
§9f: **over-provision grow**. DarkTechnomancer's guide overestimates grow
threads by 1% (*"This helps prevent level ups from causing desyncs"*), Tamagosci
uses `GROW_THREADS_MULTIPLIER = 1.05`, alainbryden has a
`--recovery-thread-padding` that **auto-escalates up to 10x when RAM utilisation
is low**. §9f's result — excess grow threads add *zero* security — is the reason
this is nearly free, and none of those three sources states that reason.

### 9c. The mechanisms that turn out **not** to matter

I expected these to be the story and they are not. Recording the negatives
because each one is a trap someone will otherwise spend a day on.

- **`ns.sleep` jitter / event-loop congestion does not reorder landings.**
  Timer tasks fire in expiry order (and for equal delays, in the order the
  timers were created — that ordering is an explicit WHATWG HTML spec
  requirement for `setTimeout`). [claim, HTML spec; not Bitburner source] If the
  main thread stalls — a React render, the 60s autosave serialising the whole
  save — every timer that expired during the stall fires afterwards *in order*.
  So a stall **collapses separations to zero but preserves the order**, and
  since H/W/G/W only care about order, a collapsed batch still works.
- **Background-tab throttling likewise preserves order** — but it is far worse
  than "throttling". Chrome throttles hidden-tab timers to ~1/s and to ~1/min
  after 5 minutes hidden, and Bitburner has no `visibilitychange` handling at
  all (nothing in `engine.tsx` or `ui/GameRoot.tsx`) [verified by absence]. The
  game's own docs put it bluntly
  (`src/Documentation/doc/en/programming/offlineandbonustime.md`): *"it is not
  possible for Bitburner scripts to run when … the browser tab is inactive."*
  Ordering is still preserved, so this is not a *reordering* problem — but see
  §9d(3), because coming back from a backgrounded period is much nastier than
  being in one. **A batcher is a foreground-tab-only construct.** If unattended
  throughput matters, the community answer is to run it headless under VNC
  rather than to defend against it in script.
- **Launch latency is sub-millisecond once warm.** `ns.exec` →
  `runScriptFromScript` → `startWorkerScript` → `createAndAddWorkerScript`
  (`NetscriptWorker.ts:100-165`) calls `startNetscript2Script`, which does
  `await compile(script, scripts)`. `compile` returns the **cached**
  `script.mod.module` promise if the module was ever loaded
  (`NetscriptJSEvaluator.ts:43-47`, plus a `moduleCache` keyed on transformed
  code). So after the first launch of a worker on a host, the child's `main()`
  runs in a microtask of the launching task. **Four `ns.exec` calls with no
  `await` between them therefore all see the same `Date.now()` and the same
  `skills.hacking`.** The first launch of a given script on a given server is a
  real dynamic `import()` of a blob URL and is much slower — warm every worker
  once at startup.
- **v3 does not require unique args to run duplicate scripts.**
  `parseRunOptions` sets `preventDuplicates: false` by default
  (`NetscriptHelpers.tsx:254-272`) and `runScriptFromScript` only checks for
  duplicates when it is set (`NetscriptWorker.ts:329-340`). The v1/early-v2
  idiom of passing a random batch id purely to dodge the duplicate check is
  obsolete — keep the id if you want it for identification, but it is not load
  bearing. [verified]

### 9d. Runtime hazards that *do* bite, read out of the source

These are all read out of the game, and none of them appear in the community
material I have seen.

**(1) A failed `ns.exec` is silent and returns 0.** `runScriptFromScript`
(`NetscriptWorker.ts:314-353`) logs and returns `0` when the RAM check fails
(`createAndAddWorkerScript` "Not enough RAM…") or when the file is missing.
A batcher that does not check the returned pid will happily launch a **partial
batch** — H and W1 placed, G rejected — and a partial batch is exactly the
worst case: the hack lands, nothing regrows it, and one weaken repairs half the
security. This is the highest-probability real failure in the whole design and
it is a two-line guard. **Check every pid; if any op of a batch fails to
launch, kill the ones that did.**

**(2) RAM is released at landing, not at plan time.** `killWorkerScript` →
`removeWorkerScript` runs when the worker's `main()` resolves, i.e. one
microtask after its op lands. The last weaken of a batch holds its RAM until
`4T + 3ε`. A scheduler that computes free RAM from its own model rather than
from `ns.getServerMaxRam − ns.getServerUsedRam` will drift into (1) above.

**(3) In-flight ops do not survive a page reload — and the reload *also moves
the world*.** `loadAllRunningScripts`
(`NetscriptWorker.ts:218-263`) restarts every saved `RunningScript` by calling
`startWorkerScript`, which runs `main()` **from the top**. Nothing about the
pending `setTimeout` is saved. So a refresh, a crash, or a save import
instantaneously converts every in-flight batch into a cohort of workers that all
restart at once — and a worker written as "sleep until absolute timestamp X,
then hack" will find X in the past and hack **immediately, all of them at
once**. That strips the target and spikes security in one frame. Two
mitigations, both verified in source:
   - Launch workers with `{ temporary: true }`. `BaseServer.toJSONBase`
     (`src/Server/BaseServer.ts:305-313`) filters `rs.temporary` out of
     `runningScripts` before serialising, so temporary workers are simply absent
     after a reload. This *also* shrinks the save — with a dense batcher there
     are thousands of `RunningScript` objects, and they are serialised on every
     60s autosave, which is a main-thread stall (see 9c).
   - Have each worker sanity-check its deadline on start: if
     `landAt − Date.now()` is less than its own op duration, exit instead of
     firing.

   And the world is not where you left it either. `loadAllRunningScripts` calls
   `scriptCalculateOfflineProduction` per saved script
   (`src/Script/ScriptHelpers.ts:14-91`), which **replays grow and weaken at 50%
   of the script's recorded rate** for the elapsed wall time —
   `processSingleServerGrowth(server, timesGrown, …)` and
   `serv.weaken(weakenAmount * timesWeakened)`, both applied to the live server
   — and grants `confidence · (onlineExpGained/onlineRunningTime) · timePassed`
   of hacking exp, so **the hacking level jumps too**. Hack is *not* replayed;
   money is granted directly. So after any gap, every cached figure a batcher
   holds — server money, server security, `T` — is stale at once. A batcher must
   re-measure from scratch on startup and never trust a persisted plan.
   (`{temporary: true}` workers are not saved, so they contribute no offline
   production at all — which is the behaviour you want here, not a loss.)

**(4) A negative `additionalMsec` throws and kills the worker.**
`validateHGWOptions` (`NetscriptHelpers.tsx:396-418`) throws on `< 0` and on
`> 1e9`. A batcher computing `pad = landAt − now − opTime` will produce
negatives whenever it is late. Clamp to 0 — or better, treat "pad would be
negative" as "this op is unschedulable, abandon the batch" (§9j: the community
consensus is that a late op should be abandoned, not fired late). The `1e9`
ceiling is not arbitrary: it was added in v2.5.2 after
[issue #940](https://github.com/bitburner-official/bitburner-src/issues/940),
because `setTimeout` uses signed 32-bit math and a delay ≥ 2³¹ ms **fires
immediately**. Maintainer @d0sboots: *"It's not `additionalMsec` itself that is
overflowing, but rather the underlying call to `setTimeout`, which uses signed
32-bit integer math for historical reasons that are now set in stone."* Our
`weakenTime` plus a pad cannot reach 2³¹ under the 1e9 cap, so this is guarded —
but it confirms §9a's reading that the whole mechanism is one bare
`setTimeout`.

**(5) `checkEnvFlags` kills a worker that calls a second ns function while one
is in flight** ("Concurrent calls to Netscript functions are not allowed",
`NetscriptHelpers.tsx:455-467`). Only relevant if a worker tries to be clever
with un-awaited promises.

**(6) Worker RAM is multiplied by threads**, `roundToTwo(ramUsage * threads)`
(`NetscriptWorker.ts:110`). Base cost 1.6GB; `hack` +0.1, `grow`/`weaken` +0.15
(`RamCostGenerator.ts:11-20`). So a hack worker is 1.70GB and a grow/weaken
worker 1.75GB — **per thread**. Adding one `ns.getServerSecurityLevel` guard to
a worker costs +0.1GB/thread, which on a 400-thread grow is +40GB. **Keep
workers dumb; put every sensing call in the controller, where it is paid once.**
This is a quantitative argument for the controller/worker split, not a stylistic
one.

### 9e. The two honest designs, and what each is exposed to

**Design A — single-burst launch with `additionalMsec`** (the game's own docs
call this the *shotgun*, §9i). Read `T` once, exec all four workers with no
`await` between the execs, each carrying a pad so that the landings are
`4T, 4T+ε, 4T+2ε, 4T+3ε`:

```
pad(hack)    = 3T                pad(weaken1) = ε
pad(grow)    = 0.8T + 2ε         pad(weaken2) = 3ε
```

All four durations derive from one reading of `skills.hacking`, so the batch is
internally exact **by construction** — ε can be 1ms and the order still holds.
Two costs:

- Cross-batch drift remains: batch `n+1` launched `p` later has a smaller `T`,
  and collides with batch `n` when `p < 4·ΔT + 3ε`, i.e. roughly when the period
  is shorter than the drift accumulated over it.
- **Padding costs RAM-seconds**, and §3's ratio bound silently assumed it away.
  A padded op holds its RAM for the *whole* `4T`, not for its own duration. For
  a minimal batch (1 hack, 2 grow, 2 weaken) the RAM-seconds go from
  `T·(1.7·1 + 5.6·2 + 7·2) = 26.9T` unpadded to `4T·8.7 = 34.8T` padded —
  **+29%**, and worse for hack-heavy batches, since a padded hack holds RAM 4x
  longer than it needs to. Since §3 showed throughput is exactly
  `(money per RAM-second) × Ω`, that 29% is 29% of income.

Design A's compensating virtue, which I missed on the first pass: all four ops
read the server at **one** instant, so if that instant is at minimum security,
all four durations are correct and §9b′ cannot touch the batch. And because a
periodic Design A launches exactly once per period on a schedule it controls
entirely, it can *choose* that instant.

Worth being precise, because this is the actionable form. In steady state the
landings repeat with period `4ε` at phases `0, ε, 2ε, 3ε` = H, W1, G, W2.
Security is elevated on `[0, ε)` (hack landed, W1 pending) and on `[2ε, 3ε)`
(grow landed, W2 pending), and at minimum on `[ε, 2ε)` and `[3ε, 4ε)`. So:

> **Phase-lock the batch launch to the middle of a safe window** — e.g. phase
> `3.5ε` — and Design A is structurally immune to unsafe-window inflation. That
> is one line of arithmetic and it removes the dominant desync mechanism
> entirely.

This is the real reason the padded design survives in practice despite being
open-loop, and it is also why Design B cannot borrow the trick: B launches four
times per period at phases set by `landAt − opDuration(now)`, and `opDuration`
is not a multiple of ε, so its launch phases are effectively arbitrary. B has to
compute the safe windows and schedule into them; A only has to pick a constant.

**Design B — just-in-time launch against an absolute landing time.** The
controller decides `landAt` for each op and launches each op at
`landAt − opDuration(now)`, reading the duration at that moment. Because the
duration is read at the launch instant, the landing is at `landAt` **exactly**,
regardless of how many level-ups happened since the batch was planned. This is
drift-free *across* batches as well as within them, which Design A is not. It is
a closed-loop controller on landing time; Design A is open-loop.

Design B's exposure is the mirror image: it launches continuously, so roughly
half its launch instants fall inside an unsafe window (§9b′) and those ops land
late by 10-60x the separation constant. **A JIT batcher that does not do
safe-window scheduling is worse than a shotgun, not better.** This is the
single most important thing the community material adds to my source reading,
and it explains an otherwise baffling empirical result (§9j): xxxsinx measured
his own JIT batcher at *25-40%* of the income of his simpler cycling batcher.

The cost of B is that the controller (or worker) must wake four times per batch
instead of once, and must re-read a duration each time — `ns.getHackTime` /
`getGrowTime` / `getWeakenTime` are 0.05GB each (`GetHackTime`,
`RamCostGenerator.ts:48`), paid once in the controller.

A units trap that will bite exactly once: `ns.getHackTime` and friends return
**milliseconds** (`NetscriptFunctions.ts:1225-1239` multiply the internal
seconds-valued `calculateHackingTime` by 1000), `additionalMsec` is
milliseconds, and the internal formulas are seconds. `hack.js:325-338` already
carries a migration shim that divides by 1000 and multiplies by 1000 again for
no reason — don't copy it.

**Recommendation, revised after reading the community material: build A first.**
Specifically a *periodic* batcher — batches deployed at a fixed interval `p`,
each batch launched as one padded burst — not a shotgun that fires everything at
once. Reasons, in order of weight:

1. **It is immune to the dominant desync mechanism** (§9b′) by construction,
   and only exposed to the weaker one (§9b), which thread over-provisioning and
   a cancel-next-hack rule largely absorb (§9f).
2. **Its theoretical headroom is only ~1.4x.** Padding costs 29-45% of
   RAM-seconds versus a perfect JIT, and by §3 that is exactly 29-45% of income.
   That is the entire prize for the much harder design.
3. **The one published head-to-head goes the other way.** xxxsinx, who wrote
   both, measured his JIT at 25-40% of his cycling batcher's income (§9j). And
   DarkTechnomancer — whose guide the maintainers point to — says JIT is
   *"marginal"* over periodic and *"extremely fragile to user error"*.
4. It is far less code, which matters because it will run unattended.

Build it, measure it against §3's `(m/R)·Ω` ceiling, and **only** chase JIT if
the measured gap exceeds ~1.4x — because below that, JIT cannot be the
explanation.

The distinction worth holding onto if JIT is ever attempted: the official docs'
"shotgun vs JIT" framing conflates two independent choices — *when you launch*
(all at once vs just-in-time) and *how you place the landing* (`additionalMsec`
pad vs raw duration). A JIT batcher still wants the pad; what it additionally
needs is a **projected security timeline** so it only launches in safe windows.
The controller owns the entire landing schedule, so it knows that timeline
exactly — there is nothing to estimate. That is the piece to get right, and it
is the piece both published JIT implementations spend most of their code on.

The thing **not** to build is the true **shotgun** — plan N batches into the
future from one reading of `T` and exec them all right now with escalating pads.
"Periodic" and "shotgun" differ in exactly one respect and it is the one that
matters: a periodic batcher re-reads `T` and the server state once per period,
so each batch is planned against a fresh world; a shotgun reads once and then
commits N batches to a plan it can no longer revise. That makes the shotgun
maximally exposed to §9b — every batch in the wave inherits the same stale `T`,
and the first level-up invalidates all of them at once — and its failure is
unbounded, because nothing in the wave re-reads anything. It is the most
tempting shape because it needs no timer management at all. The official docs
list it as the easy build and name its own risks (§9i); take the extra loop.

### 9f. Recovery discipline, derived rather than borrowed

The community answer is "detect desync, kill everything, re-prep". The source
says something sharper, and it is the most useful thing in this section:

> **Over-provisioning grow and weaken is free. Over-provisioning hack is not.**

Three verified asymmetries:

| op | overshoot behaviour | cost of overshooting |
| --- | --- | --- |
| `weaken` | `Server.capDifficulty()` floors `hackDifficulty` at `minDifficulty` (`src/Server/Server.ts:92-105`) | none — extra weaken threads are wasted RAM and **still earn full exp** |
| `grow` | money clamps at `moneyMax`; and `processSingleServerGrowth` fortifies by `2·0.002·min(ceil(usedCycles), threads)` where `usedCycles` is the threads *actually needed* (`ServerHelpers.ts:204-214`) | none — **excess grow threads add no security at all** |
| `hack` | `moneyDrained = moneyAvailable · percentHacked · threads`, clamped to `moneyAvailable` (`NetscriptHelpers.tsx:628-645`) | **strips the server to 0**; fortify is capped at `min(threads, ceil(1/percentHacked))` but the money is gone |

So the correct discipline is not symmetric error-handling, it is:

1. **Prep generously.** Weaken-to-min and grow-to-max with a margin; the margin
   costs RAM-seconds and nothing else. There is no reason to compute prep
   threads tightly.
2. **Guard only the hack.** It is the only op that can damage state. The guard
   is one-sided because the drift is one-sided (§9b): the danger is always a
   hack arriving *early*, onto a server that the previous batch has not yet
   regrown.
3. **Recovery is always possible.** `netscriptCanGrow`/`netscriptCanWeaken`
   (`src/Hacking/netscriptCanHack.ts:49-55`) only check root access — no hacking
   level requirement, no security ceiling. And `calculateGrowMoney`'s additive
   `+threads` term means a server at $0 can always be regrown. So there is no
   absorbing state; the only question is how much RAM-time recovery costs.

There **is** a near-absorbing state worth naming, though. Security has positive
feedback: `hackDifficulty` raises all three durations linearly
(`2.5·requiredHackingSkill·hackDifficulty + 500`), so a security spike makes the
weaken that repairs it slower, during which more hacks land. At
`hackDifficulty ≥ 100` both `calculatePercentMoneyHacked` and
`calculateHackingChance` return **0** (`src/Hacking.ts:13,45`) and the target
earns literally nothing until weakened back. This is the "death spiral" and it
is real — but note it is a *spiral*, not a trap: weaken still works at
difficulty 100 and security is floored at `minDifficulty`, so it always
terminates.

The other integrator is money, and this is the one that silently eats income:
**there is no passive server growth or security decay while the game is
running.** I checked the engine loop for it (`engine.tsx:81-140` — it processes
work, stocks, gang, Stanek, corporation, bladeburner, sleeves, hacknet,
counters; it never touches `GetAllServers`) [verified by absence]. So
`moneyAvailable` and `hackDifficulty` are **pure integrators of your own ops**,
with no restoring force. (The one exception is the offline replay in §9d(3),
which fires exactly once per load and moves both.) Any systematic bias in a batcher's thread
arithmetic — an off-by-one in grow threads, `growthAnalyze`'s known
overestimate (§4), a hack that occasionally lands early — accumulates without
bound. **This is the structural reason an open-loop batcher degrades over hours
and a closed-loop one does not**, and it is the single best argument for
re-measuring the server every batch instead of trusting the plan.

Practical form of the guard, in decreasing order of value:

- **Controller-side, per batch:** before launching, read `moneyAvailable` and
  `hackDifficulty`. If money < ~99% of max or security > min + tolerance,
  **launch a prep batch (weaken/grow only) instead of an HWGW batch.** Costs
  0.2GB in the controller, total. This alone converts a divergent system into a
  convergent one.
- **On level change:** `ns.getHackingLevel()` is 0.05GB. Compare it to the value
  the in-flight batches were planned against; if it moved, stop launching new
  batches until the in-flight window drains. Expensive early (levels move every
  few seconds) which is why Design B, which does not care about level changes,
  is worth the extra timer wakeups.
- **Hard reset:** kill all workers on the target, wait `weakenTime`, re-prep.
  Correct but slow — it costs a full `4T` of the fleet. Keep it as the
  last-resort path triggered by "security > min + 5 for N consecutive
  observations", not as the routine mechanism.

### 9g. The separation constant

What it has to be bigger than, in order:

| Constraint | Value | Source |
| --- | --- | --- |
| `setTimeout` integer truncation | 1ms | WHATWG spec [claim] |
| Landing handler work (`gainMoney`, `recordHack`, log) | sub-ms | [inferred] |
| Intra-batch duration error, Design A or B | **0** | §9e [verified mechanism] |
| Intra-batch duration error, naive sequential launch | `4T·ΔL/(L+50)`, ~380ms/level for us | §9b [verified] |

and what it has to be smaller than:

> **Per-target RAM capacity is `R_batch / (4ε)`**, where `R_batch` is the
> batch's RAM-*seconds*. Each batch produces four landings and no two landings
> on one target may be closer than ε, so the period floor is `p = 4ε` and the
> in-use RAM is `R_batch/p`. **Halving ε doubles a target's capacity.**

For a JIT batch with 1 hack, 2 grow, 2 weaken:
`R_batch = T·(1.7·1 + 1.75·3.2·2 + 1.75·4·2) = 26.9·T` GB·s, so

```
Ω_cap(one target)  =  6.725 · T / ε        [GB, with T and ε in the same units]
```

With `T = 21.8s` (`harakiri-sushi` at min security, hacking level 179):

| ε | period 4ε | batches in flight | RAM absorbed by one target |
| --- | --- | --- | --- |
| 20ms | 80ms | 1090 | 7.3TB |
| 50ms | 200ms | 436 | 2.9TB |
| 100ms | 400ms | 218 | 1.5TB |
| 200ms | 800ms | 109 | 0.73TB |
| 500ms | 2.0s | 44 | 0.29TB |

That is the entire trade-off, and it says the constant is **not** a magic
number — it is the knob that sets how much RAM one target can absorb.

**Recommendation: ε = 50ms, treated as a variable rather than a constant, with
a hard floor of ~20ms and a ceiling of ~200ms.** Justification:

1. **It does not have to cover jitter, and cannot cover the real drift
   anyway.** A single-burst launch (Design A) makes intra-batch duration error
   exactly zero (§9e), and §9c shows landing *order* survives stalls and
   background throttling regardless. Meanwhile the two drift sources that *do*
   exist are 380ms (§9b) and 0.1-3s (§9b′) — no sane ε covers those, so raising
   ε to "be safe" buys nothing while costing capacity linearly. The "separation
   must exceed the worst-case sleep jitter" framing that most pre-2023 guides
   use is simply the wrong framing for v3: separation is a **capacity**
   parameter, not a **safety** parameter.
2. **It agrees with the version-current sources.** The game's own v3
   documentation recommends **5-50ms** between batch steps for a JIT batcher
   (§9i), justified as the time the controller needs to do its own work, and the
   reference guide the maintainers point to ships `spacer = 5` (§9j). 50ms is
   the conservative end of that range.
3. **It matches the RAM we actually have.** At 50ms one target absorbs ~2.9TB,
   just above our current 2.3TB fleet — so a single well-chosen target still
   absorbs everything, and we have headroom before §9h's spill rule binds.
4. **It leaves 200ms of batch period**, i.e. ~12 animation frames for the main
   thread to do 4 script launches, 4 landings and a React pass. Going below
   ~20ms puts the controller's own work inside the separation and is where the
   official docs stop recommending it.

**What it depends on**, so it can be recomputed rather than re-guessed:

```
ε  =  clamp( 6.725 · T / Ω_target ,  20ms ,  200ms )
```

`T` shrinks continuously as the hacking level rises, and `Ω` grows as servers
are bought, so this wants recomputing every retarget, not hardcoding. When the
clamp binds at 20ms, that is the signal to open a second target (§9h) rather
than to push ε lower.

For contrast, our `hack.js`'s hardcoded `15 * 1000` ms offsets
(`hack.js:339-340`) are **300x** too large by this analysis and, as recorded in
§3, clamp to zero below `weakenTime = 30s` anyway — they are wrong in both
directions at once.

**Do not use 200ms "because the game ticks at 200ms".** That is the most common
justification in community material and §9a shows it is a non-sequitur: op
landings never touch the engine tick. 200ms may still be a defensible value —
it is the top of the sane range — but not for that reason, and at our fleet
size it caps one target at 0.73TB, which would force a three-way split we do
not otherwise need.

### 9h. Reconciliation: target saturation (correcting §6)

The optimizer measured single-target as correct at 108GB and catastrophic above
~3TB, with a 2.5-4.5TB crossover; §6 said greedy all-on-one is exactly optimal
up to ~1TB. **These are the same phenomenon and the same formula**, and the
disagreement is in two places, only one of which is my error.

*Where we agree.* §6's saturation point was
`RAM ≈ 6.95GB · T/ε` — literally `batchRAM × batches-in-flight`, which is the
optimizer's "analytical bound on batches-in-flight per target". Plugging in
their conditions rather than mine closes most of the gap: I used
`batchRAM = 6.95GB` (the absolute integrality floor: 1 hack, 1 grow, 2 weaken)
and `T = 30s`; a realistic minimal batch is 8.7GB (grow rounds to 2 threads on
most targets) and the targets in question have `T` of 40-60s. `8.7 × 50/0.2 =
2.2TB`, and at ε slightly above 200ms you land inside their measured 2.5-4.5TB
band. So the *mechanism* was right and the *constant* was under-estimated by
roughly 2-3x. Both numbers move with ε, which §9g now makes explicit.

*Where I was wrong, and it is not the saturation point.* §6 modelled the problem
as a **fractional knapsack with capacities** — `max Σ rate_i·Ω_i` s.t.
`Ω_i ≤ cap_i` — and greedy on that gives "fill the best target to its cap, then
the next", which is exactly the optimizer's measured answer. The model was
fine. **The verdict I wrote on top of it was not**: I compressed it to "put
everything on the single best target, exactly optimal", dropped the cap from the
ranked-findings table entry (#10), and told the reader to leave `auto.js` alone.
That is the error. The correct statement was always "greedy *up to the cap*,
then spill to the next target".

*Where the model was genuinely incomplete.* I assumed excess RAM beyond `cap_i`
is simply **unusable** — that utility is linear then flat. A real batcher does
not refuse the RAM; it launches batches at a period below `4ε` and they collide.
And §9f shows collisions are not neutral: an early hack steals `f` of a
*depleted* pool (revenue lost) and fortifies security (every subsequent op
slowed), while the grow that was sized for a `f·M` deficit now undershoots,
compounding. Because §9f's "no passive regrowth, pure integrator" result holds,
that compounding has no restoring force. So past the cap the marginal return on
RAM is **negative, not zero**, and the utility is linear-then-*decreasing*. That
explains why the optimizer measured 8.6TB single-target earning a *quarter* of
the three-way split rather than merely a third: a third would be the flat-cap
prediction, and the extra factor is the collision damage.

The practical upshot, and it is a design requirement not a tuning note:

> **A batcher must refuse to oversubscribe a target.** Cap batches-in-flight at
> `T/ε` per target and spill the surplus RAM to the next target (or to prep, or
> to `ns.share`). Without that cap the allocation problem is not just
> mis-solved, it is actively self-harming — and a scheduler that "uses all
> available RAM" is the natural way to build exactly that bug.

### 9i. What the game's own v3 documentation says [verified — it ships with the game]

`~/Repos/bitburner/src/Documentation/doc/en/programming/hackingalgorithms.md`
is in the v3.0.2 tree and is the **only batcher reference I found that is
version-current by construction**. It should outrank every Steam guide and
Reddit thread in this document. Its taxonomy, verbatim:

| Design | Doc's framing | Failure mode it names |
| --- | --- | --- |
| **EHT** (early-hack-template) | the `if security > min weaken / elif money < max grow / else hack` loop | "tends to make all your scripts on every server do the same thing"; "risk of over-hacking… to \$0, or maximum security"; RAM cost multiplied by threads |
| **Controller** | central script, dumb workers (`await ns.hack(target)` and nothing else) | — (this is the recommended base) |
| **Proto-batcher** | `\|=Batch=\|\|=Batch=\|…` — next batch only starts when the previous finishes | no pipelining; implicitly the 25%-duty-cycle problem §3 found in `hack.js` |
| **Shotgun** | pad every op with `additionalMsec` to a common length, launch as many batches in parallel as possible | "not very RAM efficient because the scripts take up RAM during their delay timer"; "intensive on real-life hardware"; recommends capping parallel batches at ~100,000 "to reduce the risk of the game soft-crashing (also called a 'black screen')" |
| **JIT** | weave batches into each other so each op holds RAM only for its own duration | "much more complex"; "very precise timing constraints"; needs "good communication between worker scripts and the controller" |

Four things in it are worth quoting because they settle questions in this
document:

1. **On `sleep` vs `additionalMsec`** — "due to JavaScript limitations, the
   delay duration is not millisecond-precise and can cause the functions to
   finish out of order. Instead, the hack, grow and weaken functions have a
   special option called `additionalMsec` that allows more precise delays."
   This is the official endorsement of §9e's mechanism.
2. **On the separation constant** — "it's important to leave a space between
   each batch step to allow for any calculations or launching of future
   batches - **typically between 5-50ms**." Note the justification is
   *controller work*, not timer jitter, which is exactly §9g's reading.
3. **On adaptive workers** — "at this precision of timing, it becomes important
   to consider how much the situation has changed between launching the script
   and the hack, grow or weaken function starting to run. The **worker scripts
   may need to adaptively change their delay value** to compensate for other
   factors and complete on time." That is Design B (closed-loop on an absolute
   landing time) recommended by the game's own docs, and the "situation has
   changed" it is gesturing at is §9b's level-up drift.
4. **On RAM and worker weight** — "analysis functions such as
   `getServerSecurityLevel` and `getServerMoneyAvailable` can be kept on the
   central controller, making the 'worker' scripts much lighter in RAM cost."
   Same conclusion as §9d(6), reached from the same `cost × threads` fact.

**Consensus answer to "which design for an unattended long-running setup": JIT,
with a controller and dumb workers.** The docs are unambiguous that shotgun is
the easier build and JIT is the better one ("maximises RAM efficiency",
"maximises income, especially in low RAM"), and shotgun's named risk —
soft-crashing the browser by holding tens of thousands of parallel scripts — is
precisely an *unattended-run* risk. Our §9e analysis adds the reason the docs
do not give: shotgun's full-length padding also freezes each batch's plan at
launch, which is what makes it maximally exposed to level-up drift.

One number from the docs that is *not* a constraint for us: the ~100,000
parallel batch soft-crash ceiling. At ε=50ms and T=22s a single target holds
~436 batches. We are three orders of magnitude away from that limit, so it
should not shape the design.

### 9j. Published batchers: what they actually use, and the version each assumed

Read from source where a repo exists. The version column is the important one —
the February 2023 introduction of `additionalMsec` (v2.2.2,
[PR #371](https://github.com/bitburner-official/bitburner-src/pull/371)) splits
this material cleanly in two, and **everything written before it is answering a
different question**.

| Source | Separation | Version | Rationale given |
| --- | --- | --- | --- |
| **Official docs, original** ([hackingalgorithms.rst @ v1.6.4](https://github.com/danielyxie/bitburner/blob/v1.6.4/doc/source/advancedgameplay/hackingalgorithms.rst), Jan 2022) | **20-200ms** | v1.x | *"may range between 20ms and 200ms … Anything lower than 20ms will not work due to javascript limitations."* |
| **Official docs, current** (§9i, rewritten Aug 2025, [PR #2288](https://github.com/bitburner-official/bitburner-src/pull/2288)) | **5-50ms** JIT; ~0 between shotgun batches | v2.8+/v3 | controller work, not jitter |
| [DarkTechnomancer's batching guide](https://darktechnomancer.github.io/) — the one the maintainers point to | **`spacer = 5`** | v2.5+ | *"Have your tasks ending within 1-2ms of when they are supposed to"*; auto-increments when RAM can't support the depth |
| [Tamagosci `hacking/JIT.js`](https://github.com/Tamagosci/bitburner/blob/main/hacking/JIT.js) | 10ms intra-batch, 70ms inter-batch | v2.6-2.8 | comment: *"Keep below BATCH_SPACER and above 4ms"* — an explicit nod to the HTML nested-timer clamp |
| [xxxsinx `scheduler.js`](https://github.com/xxxsinx/bitburner/blob/main/scheduler.js) | 25-30ms; abort tolerance `SPACER/1.5` | v2.x | — |
| [alainbryden `daemon.js`](https://github.com/alainbryden/bitburner-scripts/blob/main/daemon.js) (the most-installed community script) | **1000ms** (`cycle-timing-delay 4000` / 4) | v2.x | *"The smaller this is, the more batches we can schedule … but the greater the chance of a misfire"* |
| [Kupo's HWGW Manager](https://steamcommunity.com/sharedfiles/filedetails/?id=2825770722) (Jun 2022) | 100ms | v1.6/v2.0 | none stated |
| Steam threads, 2022 | 200ms → 500ms → 1000ms | v1.x/v2.0 | raised **in response to desyncs** |

The shape of that table is the finding: **pre-`additionalMsec` sources cluster
at 100-1000ms and got there by raising the number until desyncs stopped;
post-`additionalMsec` sources cluster at 5-30ms.** Anyone copying a number from
the first group into a v3 batcher is importing a workaround for a problem that
no longer exists, and paying for it in per-target capacity (§9g). Our
`hack.js`'s 15,000ms is off the bottom of even the old table.

Two things I take from the community that source reading would not have given
me:

- **The empirical head-to-head.** xxxsinx wrote both a cycling (re-prepping)
  batcher and a JIT one and measured the JIT at **25-40% of the cycling
  batcher's $/sec**. That is the strongest available evidence that JIT's
  theoretical RAM advantage does not survive implementation, and it is why §9e
  recommends building the padded periodic design first.
- **Recovery patterns, named.** Four recur across every working long-running
  batcher, and all four are cheap:
  1. **Cancel the next hack** when the target is found unprepped, rather than
     re-prepping. DarkTechnomancer: *"if the server isn't prepped, then we
     cancel the next hack to let the server fix itself … the program is
     self-correcting."* Tamagosci cancels hack+weaken1 if money is low and
     hack+grow if security is high. This is the modern default and it is
     strictly better than (2).
  2. **Kill-all-and-re-prep at a cycle boundary.** xxxsinx's `manager.js`
     ("cycling batcher") — simplest and most robust, but pays a full prep.
     Mitigated by keeping a second target prepped and ping-ponging, which is
     also DarkTechnomancer's suggested answer to level-ups.
  3. **Per-op abort guard evaluated at op start**, not at plan time.
     jjclark1982: if `actualServer.hackDifficulty > job.startDifficulty`, do not
     start. This is the direct defence against §9b′.
  4. **Thread over-provisioning** as passive insurance (1%, 5%, 20% and
     auto-escalating-to-10x in the four sources surveyed). §9f explains why it
     is nearly free and none of them do.
- **Drift tolerance as a cancel criterion**, not a correction: xxxsinx drops a
  task whose start has drifted past `SPACER/1.5`; alainbryden toasts
  `Misfire: Hack started N ms too late`; DarkTechnomancer's workers report their
  own lateness back over a port and the controller absorbs it globally. The
  common principle: **a late op should be abandoned, not fired late.** Firing
  late is what turns a timing error into a state error.

Also worth carrying: `port.nextWrite()` is the modern replacement for
`ns.sleep` in a controller loop, because it guarantees the listener runs
immediately after the writer with nothing interleaved. Three of the surveyed
batchers drive their main loop off it.

**What the research could not reach.** Reddit is not fetchable by our tooling,
and the Bitburner Discord — which multiple maintainer comments identify as
where the live consensus actually is — is not web-indexed. Several primary
sources (issue #940, PR #2288, abesto's gitbook) point there explicitly. Treat
§9j as a survey of what is *published*, not of what is *known*.


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

Batcher references, ordered by how much they should be trusted for v3 (§9i, §9j):

1. **`~/Repos/bitburner/src/Documentation/doc/en/programming/hackingalgorithms.md`** — ships *inside* v3.0.2, so it is version-current by construction. Taxonomy (EHT / controller / proto / shotgun / JIT), the 5-50ms separation figure, the `additionalMsec`-over-`sleep` argument, and the adaptive-worker recommendation all come from here. Rewritten Aug 2025 in [PR #2288](https://github.com/bitburner-official/bitburner-src/pull/2288). Companion: `.../offlineandbonustime.md` on inactive tabs and script restart.
2. [DarkTechnomancer, *A Beginner's Guide to Batching*](https://darktechnomancer.github.io/) ([repo](https://github.com/DarkTechnomancer/darktechnomancer.github.io)) — v2.5+, post-`additionalMsec`. The glossary the official docs adopted; `spacer = 5`; the cancel-next-hack self-healing rule.
3. [bitburner-src issue #274](https://github.com/bitburner-official/bitburner-src/issues/274) — v2.2.0. The definitive account of **task collisions** (§9b′), and the reason `sleep`-then-`hack` is structurally broken.
4. [PR #371](https://github.com/bitburner-official/bitburner-src/pull/371) (d0sboots, Feb 2023) — introduces `additionalMsec`; the design rationale for "launch all four at one instant" in the author's own words. [Issue #940](https://github.com/bitburner-official/bitburner-src/issues/940) — the `setTimeout` signed-32-bit overflow that produced the 1e9 cap.
5. Published batchers read for their constants: [Tamagosci](https://github.com/Tamagosci/bitburner/blob/main/hacking/JIT.js), [xxxsinx](https://github.com/xxxsinx/bitburner), [jjclark1982](https://github.com/jjclark1982/bitburner-scripts), [alainbryden `daemon.js`](https://github.com/alainbryden/bitburner-scripts/blob/main/daemon.js), [Nolshine](https://github.com/Nolshine/bitburner-scripts), [JasonGoemaat](https://github.com/JasonGoemaat/bitburner-batcher).
6. **v1/early-v2, numerically stale — cited for how the consensus moved, not for values:** [hackingalgorithms.rst @ v1.6.4](https://github.com/danielyxie/bitburner/blob/v1.6.4/doc/source/advancedgameplay/hackingalgorithms.rst) (20-200ms), [Kupo's HWGW Manager](https://steamcommunity.com/sharedfiles/filedetails/?id=2825770722) (100ms), [Batch HWGW](https://steamcommunity.com/app/1812820/discussions/4/4731597528368392803/) and [HWGW RAM usage](https://steamcommunity.com/app/1812820/discussions/4/4633736485039828636/) Steam threads (200-1000ms).

**Not reached:** r/Bitburner (not fetchable by our tooling) and the Bitburner
Discord (not web-indexed), which maintainer comments repeatedly identify as
where the live consensus actually lives. §9j is a survey of the published
record, not of the state of the art.

Game source (authoritative, all paths relative to `~/Repos/bitburner`):
`src/Hacking.ts`, `src/Server/formulas/grow.ts`, `src/Server/ServerHelpers.ts`,
`src/Server/ServerPurchases.ts`, `src/Server/data/Constants.ts`,
`src/CodingContract/*`, `src/Constants.ts`,
`src/PersonObjects/Player/PlayerObjectGeneralMethods.ts`,
`src/PersonObjects/Player/PlayerObjectServerMethods.ts`,
`src/Hacknet/formulas/HacknetNodes.ts`, `src/Hacknet/data/Constants.ts`,
`src/StockMarket/StockMarket.ts`, `src/StockMarket/data/Constants.ts`,
`src/Netscript/RamCostGenerator.ts`, `src/Prestige.ts`, `src/engine.tsx`,
`src/BitNode/BitNode.tsx`, `src/BitNode/BitNodeMultipliers.ts`,
`src/Netscript/NetscriptHelpers.tsx`, `src/NetscriptWorker.ts`,
`src/NetscriptJSEvaluator.ts`, `src/Netscript/killWorkerScript.ts`,
`src/Server/Server.ts`, `src/Server/BaseServer.ts`,
`src/PersonObjects/Person.ts`, `src/PersonObjects/formulas/skill.ts`,
`src/Hacking/netscriptCanHack.ts`.
