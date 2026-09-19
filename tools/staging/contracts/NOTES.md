# Coding-contract solvers — the 13 that were missing

Staged 2026-09-13. Files here:

| file | what it is |
| --- | --- |
| `ctsolvers.js` | **drop-in replacement for the repo-root `ctsolvers.js`.** The existing 17 entries are byte-for-byte unchanged; 13 new ones are appended after the Caesar-cipher `push`. |
| `ctsolvers.test.mjs` | checks CT0–CT6. Round-trips every type against the game's own generator and validator. |
| `build-contracts.mjs` | esbuilds `src/CodingContract/` out of `~/Repos/bitburner` into `contracts.bundle.mjs` so the test can call the real `generate()` / `isSolution()`. |
| `contracts.bundle.mjs` | generated, 325KB; rebuilt automatically when the game source is newer. **Wants a `.gitignore` line** — `tools/sim/game.bundle.mjs` and `tools/sim/.entry.generated.ts` are already listed there and this is the same kind of artifact. Not added here because `.gitignore` is the lead's file. |

```bash
node tools/staging/contracts/ctsolvers.test.mjs        # ~12s, 14,350 instances
CT_N=2000 node tools/staging/contracts/ctsolvers.test.mjs
CTSOLVERS=$PWD/ctsolvers.js node tools/staging/contracts/ctsolvers.test.mjs   # after deploying
```

The test is **not** yet in `tools/test/`, so `npm test` does not run it. Moving it
there is one `mv` plus changing `TARGET` — but note it adds ~12s to a suite whose
whole design goal is "a couple of seconds on every save", so the natural home may
be a separate `npm run test:contracts`. That is a call for whoever deploys this.

## Result

**13 of 13 solved. 63,000 offline instances, 0 rejected, 0 thrown, 0 skipped.**
Nothing was left out. Every solver is accepted by the game's own validator.

| contract | instances | accepted | approach |
| --- | --- | --- | --- |
| Array Jumping Game II | 5,000 | 100.000% | port of `getAnswer` |
| Compression I: RLE Compression | 5,000 | 100.000% | port of `getAnswer` |
| Compression II: LZ Decompression | 5,000 | 100.000% | port of `comprLZDecode` |
| Compression III: LZ Compression | 5,000 | 100.000% | port of `comprLZEncode` (the shortest-encoding DP) |
| Encryption II: Vigenère Cipher | 5,000 | 100.000% | port of `getAnswer` |
| HammingCodes: Encoded Binary to Integer | 5,000 | 100.000% | port of `HammingDecode` |
| HammingCodes: Integer to Encoded Binary | 5,000 | 100.000% | port of `HammingEncode` |
| Largest Rectangle in a Matrix | 5,000 | 100.000% | port of `getAnswer` |
| Proper 2-Coloring of a Graph | 5,000 | 100.000% | own BFS (game has no answer key) |
| Shortest Path in a Grid | 5,000 | 100.000% | own reverse BFS (game has no answer key) |
| Square Root | 5,000 | 100.000% | own BigInt Newton + round-to-nearest |
| Total Number of Primes | 2,000 | 100.000% | port of the segmented sieve |
| Total Ways to Sum II | 5,000 | 100.000% | port of `getAnswer` |

The other 17 were re-checked in the same run and are also at 100% (500 each,
150 for Find All Valid Math Expressions), so nothing in the existing file has
drifted against game v3.0.2.

RAM: **0GB added.** `ctsolvers.js` prices at 1.6GB, which is the bare script
base cost, so its contribution to an importer is 0.00GB; `ctauto.js` stays at
22GB. Measured with `tools/test/ram.mjs` (the game's own
`RamCalculations.calculateRamUsage`) via `priceOverlay`, and asserted by CT5 on
every run.

## The governing decision: port the validator, don't solve the problem

Twenty of the thirty contracts validate with a literal
`getAnswer(data) === answer`, and another six compare element-by-element against
`getAnswer` (Spiralize Matrix, Generate IP Addresses, Merge Overlapping
Intervals, Sanitize Parentheses, Find All Valid Math Expressions, and Square Root
against its own stored root). For all of those there is exactly one accepted
answer and it is whatever the game's own function returns — so the solver is a
direct port of that function, not an independent implementation. This matters
more than it sounds:

- **Array Jumping Game II's** `getAnswer` (`ArrayJumpingGame.ts:91-111`) is a
  hand-rolled greedy, not the textbook minimum-jumps BFS, and it answers **0**
  for an unreachable last index where the textbook answer is infinity. A correct
  BFS would be rejected on the unreachable cases — 90 of 500 sampled instances.
- **Largest Rectangle's** `getAnswer` terminates its expansion loops on
  `undefined >= number` being false (`LargestRectangle.ts:96-97`). The comment in
  the game source says this is deliberate. It is preserved verbatim.
- **HammingCodes decode** ends in `parseInt(ans, 2)` (`HammingCode.ts:256`),
  which is lossy above 2^53 while the inputs reach 2^57
  (`HammingCode.ts:79`). Using BigInt here would be *more correct* and would
  fail, because the validator compares against the identically-lossy value.

Only four validators accept more than one answer: Shortest Path (any shortest
UDLR path), Proper 2-Coloring (any valid coloring, or `[]`), Compression III (any
encoding no longer than the game's that decodes back), and Largest Rectangle (any
1-free rectangle of the same area). The first three get real solvers written from
scratch, because the game supplies no answer key for them at all — `getAnswer`
returns `null`. Largest Rectangle is still a port, since porting gives both the
area and a known-clear rectangle for free.

## Things that were surprising

**Square Root's data is a `BigInt`, and its stored state is not its data.**
It is the only contract with a `getData` (`ContractTypes.ts:47`,
`SquareRoot.ts:167-170`): the save holds `[root, offset]` as decimal strings and
`ns.codingcontract.getData()` hands Netscript `root² + offset` as a real
`bigint`. It is also the only one that needs **round-to-nearest, not floor** —
the generator spends half its instances on exactly that boundary
(`SquareRoot.ts:157-163`), and CT4 confirms both sides occur (207 down / 293 up
in 500). A floor-only solver would pass roughly half the time, which is the worst
possible failure mode for something that destroys contracts.

**Compression III is the one contract where "close" is not "wrong".** Its
validator is `answer.length <= encoded.length && comprLZDecode(answer) === plain`
(`Compression.ts:158`) — an inequality, not an equality. The game's encoder is a
DP over (chunk kind, pending length) and the ported version drops one thing: the
game breaks ties between equal-length candidates **at random**
(`Compression.ts:213-217`), stated in its own comment to be purely so that
Compression II gets a wider variety of inputs. Randomness cannot change a state's
minimum *length*, only which equally-short string is kept, so taking the first is
safe. CT3 asserts the stronger property that our length equals the game's optimum
**exactly**, every time, rather than merely being accepted — 0 excess over 500
instances.

**Largest Rectangle's validator only compares AREA, not corners**
(`LargestRectangle.ts:151-152`) — after separately re-checking the submitted
rectangle contains no 1s. So a different rectangle of equal area is accepted.
Porting `getAnswer` gets both properties for free.

**`Proper 2-Coloring` and `Shortest Path in a Grid` have no answer key at all**:
their `getAnswer` returns `null`. One consequence worth knowing operationally —
when a contract of these types self-destructs, `NetscriptFunctions/CodingContract.ts:66-68`
has no solution to print, so the log says nothing about what the answer was.

**Reward scales with the game's own `difficulty` field.** Money is
`75e6 * difficulty * CodingContractMoney * (rewardScaling/3)`
(`PlayerObjectGeneralMethods.ts:559-560`, `Constants.ts:93`), and BitNode 4 is
absent from the `CodingContractMoney` overrides in `BitNode.tsx`, so it takes the
default of 1 (`BitNodeMultipliers.ts:31`) — confirmed, contracts are not nerfed
here. That makes the newly-covered high-difficulty types disproportionately
valuable: **Compression III is difficulty 10 and HammingCodes-decode is 9**,
against 1–3 for most of what was already covered.

**Three of the thirty give fewer than ten tries**, which is why "skip rather than
guess" is the rule: `Array Jumping Game` gets **1**
(`ArrayJumpingGame.ts:39`), `Array Jumping Game II` gets 3
(`:90`), `Proper 2-Coloring` gets 5 (`Proper2ColoringOfAGraph.ts:7`),
`Algorithmic Stock Trader I` gets 5 (`AlgorithmicStockTrader.ts:35`). Everything
else is 10 (`Contract.ts:107`) except Merge Overlapping Intervals at 15.

## Traps that were real

- **The `è`.** `Encryption II: Vigenère Cipher` uses U+00E8 precomposed (NFC),
  not `e` + U+0300. Dispatch is `find(m => m.name === contract.type)`, so a
  decomposed spelling produces a solver that never fires and looks exactly like
  no solver. CT1 asserts the whole name set is equal to the game's in **both**
  directions and additionally compares the Vigenère name codepoint-by-codepoint.
  A mutation test confirmed CT1 fires on an ASCII `e`.
- **Falsy correct answers.** Three of the new solvers legitimately answer `""`,
  `[]` or `0`, and `ctauto.js:95` skips on `undefined`/`null` only — which is
  correct and must stay that way. CT4 exists because CT2 can only have tested
  those paths if random generation actually produced them; it fails if any of the
  three branches was never reached, and prints the count either way (110/500,
  170/500, 90/500 at the default sample).
- **Identifier names cost RAM.** The game prices every *referenced* bare
  identifier by name against the whole `RamCosts` tree, so a local called
  `attempt` in a solver would add 10GB to `ctauto.js`, resident. Confirmed
  empirically while building CT5: a declared-but-unused `attempt` is free, a
  referenced one costs 10GB. CT5 prices the file with the game's own calculator
  rather than grepping for `ns.`.

## Residual risk, stated rather than left implicit

1. **The test measures `~/Repos/bitburner` at v3.0.2, not the running game.** If
   the browser is running a different build of the contract code, these solvers
   are validated against the wrong spec. CT0 prints the bundled version on every
   run so this is visible rather than assumed. There is no way to close this gap
   without attempting a live contract, which is exactly what must not be done.
2. **`Total Number of Primes` costs ~12ms of main-thread time per contract**
   (1e6-wide segmented sieve). Netscript shares the browser main thread, so a
   scan that finds several of them will stutter the UI briefly. It is well under
   the pre-existing `Find All Valid Math Expressions` at ~53ms, so this does not
   make anything new of the problem, but it is not free either.
3. **Compression III's guarantee is relative to the game's DP, not to true
   optimality.** If upstream ever replaces that DP with a better one, our answer
   becomes longer than the new optimum and is rejected. The bundle rebuilds
   whenever `src/CodingContract` is newer, so CT3 would go red rather than the
   game silently eating contracts — provided the test is actually run.
4. **`Total Ways to Sum II` can exceed 2^53** for a large `n` with a small coin
   set. Both sides accumulate in the same order with the same doubles, so the
   comparison stays exact, but the number printed is not the true count.
5. The solver for Compression III **self-checks** (decodes its own answer and
   compares) before returning, and throws rather than answering if that fails.
   Same for anything else that could only be reached by a broken assumption:
   throwing makes `ctauto.js:90-94` count it as skipped, leaving the contract
   intact. There is no path in this file that answers on a guess.

## Not done

- Nothing was deployed. The root-level `ctsolvers.js` is untouched; CT0 says so
  explicitly on every run ("DIFFERENT from the file under test").
- No live contract was attempted.
- The test is not wired into `npm test` (see the top of this file).
