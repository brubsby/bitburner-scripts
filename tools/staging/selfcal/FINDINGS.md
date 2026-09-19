# Self-calibrating hack-yield correction for batch.js — working findings

## F1. The two multipliers (game source, v3, ~/Repos/bitburner)

`src/Hacking.ts:44-56` `calculatePercentMoneyHacked`:
    percent = (difficultyMult * skillMult * person.mults.hacking_money * currentNodeMults.ScriptHackMoney) / 240
    clamped to [0,1]

`src/Netscript/NetscriptHelpers.tsx:628-648` (the ns.hack landing):
    moneyDrained = server.moneyAvailable * percentHacked * threads     // linear in threads, NOT compounding
    moneyDrained clamped to [0, server.moneyAvailable]
    server.moneyAvailable -= moneyDrained
    moneyGained = moneyDrained * currentNodeMults.ScriptHackMoneyGain  // <-- SECOND, DIFFERENT multiplier
    Player.gainMoney(moneyGained)

So there are TWO node multipliers on this path and they are not the same thing:
  * ScriptHackMoney      scales what LEAVES THE SERVER.  0.2 in BN4.  Missing from batch.js hackFraction.
  * ScriptHackMoneyGain  scales what the PLAYER RECEIVES from that drain.  1 everywhere
                         EXCEPT BitNode 8 where it is 0 (BitNode.tsx:772-773).

`batch.js` `s.earned` is accumulated from drops in `ns.getServerMoneyAvailable`, i.e. it measures
moneyDrained, NOT player income. In BN4 (Gain=1) they coincide. In BN8 `earned` would report
billions while the player receives exactly $0.

ScriptHackMoney values across the node table (BitNode.tsx): 1 (default/BN1), 0.2 (BN2), 0.2 (BN3?),
0.15, 0.75, 0.5, 0.3, 0.1, 0.5, dec (BN12, level-dependent), 0.2, 0.3.  Never > 1.

## F2. Consequence for the estimator
phi_model (batch.js inlined hackFraction) differs from phi_true (game) by EXACTLY the constant
ScriptHackMoney, because every other factor in the two expressions is identical and is read live.
So the residual, measured correctly, is a single GLOBAL scalar, not a per-target one.

## F3. The 0.322 composite, decomposed against the live save

Live numbers pulled read-only from `getSaveFile` at 2026-09-13T20:18Z:
  phantasy: moneyMax 67,500,000  required 100  minDifficulty 7  growth 35  (moneyAvailable == moneyMax)
  player:   hacking 248, intelligence 0, mults.hacking_money 1.16, hacking_chance 1.16
  BitNode 4.

  phi_model = (100-7)/100 * (248-99)/248 * 1.16 / 240 = 0.00270040
  plan h=20 -> f = 0.054008 -> telemetry reports fPct 5.4   EXACT MATCH, so phi_model is confirmed.
  chance    = ((434-100)/434) * 0.93 * 1.16 = 0.83024      (intelligence 0 -> bonus term is exactly 1)
  planned $/batch = f * moneyMax * chance = $3,026,700      (verify-alloc-shipped prints $3.1m)
  realised $/batch (cumulative earned / cumulative batches) = $855,981
  ratio = 0.2828  (the user measured 0.322 an hour earlier, same quantity, different moment)

  If ScriptHackMoney were the whole story the ratio would be 0.200.  The residual 1.41x is NOT
  chance — chance appears in BOTH numerator and denominator and cancels exactly.  It is:

   (a) h is not constant.  planBatch's h-sweep is 1..8 then x1.3, so h takes values 20/26/34/45.
       The live `ps` shows an in-flight h.js with **34 threads** at the same moment the published
       plan says h=20.  phi rises with hacking level ((L-99)/L), so the optimal h FALLS as the
       level climbs; over this 1.6h run the level went ~150 -> 251 and h went ~34 -> 20.
       Dividing CUMULATIVE earnings by the CURRENT plan compares different plans.
   (b) landed/launched < 1 (drains, in-flight at kill, the run's first prep).
   (c) money below moneyMax when a hack lands (here ~0, the target is pinned at max).

  => the naive ratio is a product of four things and only one of them is the multiplier.
     The estimator must divide by the h THAT BATCH launched with and the money THAT HACK saw.

## F4. tools/sim/verify-batch.mjs cannot see this bug (and says PASS)

It does `const g = await import("./game.bundle.mjs")` directly instead of importing `./game.mjs`,
so `setBitNode()` is never called and `currentNodeMults` stays at the module default — every
field 1, i.e. BitNode 1. Output today:

    { "checks": 1080, "worstRelativeError": { "phi": 0, ... } }
    PASS: every formula within 1% of the game across the sweep

phi error 0 against a game configured for BN1, while the shipped phi is 5x high in the BN4 we are
actually in. This is the same failure `game.mjs`'s setBitNode comment describes, one level up:
the fix exists and this file routes around it.

`tools/sim/verify-alloc-shipped.mjs` DOES import `./game.mjs` and therefore already fails loudly:

    1. batch.js's inlined src/Hacking.ts ports vs the game's own formulas
      FAIL snapshot.json: worst relative error 4.00e+0 n00dles.phi port=0.004125 game=0.000825
      FAIL snapshot-live.json: worst relative error 4.00e+0 zb-institute.phi ...
    0. FAIL $/batch summed over live targets: model $3.1m vs live $0.8m  err +273.4%

## F5. RAM prices confirmed from src/Netscript/RamCostGenerator.ts
  write 0, read 0, tryWritePort 0, readPort 0, peek 0, getPortHandle 0, ramOverride 0
  hackAnalyze 1.00, getResetInfo 1.00, getServerMoneyAvailable 0.10, fileExists 0.10
=> the correction can be measured, applied and PERSISTED at 0GB.
   `ns.hackAnalyze(host) / hackFraction(level, required, CURRENT sec, mults)` would read
   ScriptHackMoney exactly and instantly for +1.00GB (difficulty cancels, so it works at any
   security) — the cheapest exact cold start, offered but not taken.

## F6. getPlayer() has no bitNodeN; totalPlaytime never resets
`NetscriptFunctions.ts:1371-1389` returns 13 fields, none of them the BitNode.
`totalPlaytime` is monotone for the whole save (`engine.tsx:93`), so it cannot fence a
persisted calibration against a BitNode change.
But `Prestige.ts:98` calls `initForeignServers` on EVERY install, which re-randomises
moneyMax / requiredHackingSkill / minDifficulty. So "(host, moneyMax, required, minSec) is
unchanged" is a zero-cost fingerprint that holds across a restart and breaks across an install
or a BitNode change — exactly the fence a persisted value needs.

## F7. The decomposition, final form

Let phi0 = batch.js's model hack fraction per thread at minSec, phi* = the game's.

    Y = phi* / phi0   ==  currentNodeMults.ScriptHackMoney     (fallback ports)
                      ==  1                                    (Formulas.exe branch)

proved exactly (rel err < 1e-12) over BN1/4/5/6/9/12(level 1 and 6) in
verify-selfcal.mjs section 1.

At a landing (NetscriptHelpers.tsx:628-645) the game does
    drain = moneyAvailable * phi* * threads       clamped to moneyAvailable
so for one identified landing
    x = drain / (moneyBefore * phi0 * h) = Y      -- h cancels, moneyBefore cancels

Which term goes where:
  ScriptHackMoney      -> IS x.
  hack chance          -> NOT in x. A failed hack drains nothing, so conditioning on
                          "money fell" conditions on success and chance divides out.
                          Measured separately as landed-with-drop / landings and
                          published next to planBatch's own chance.
  placeFail/execFail/
  partial/unsafeSkip   -> NOT in x. A flight record exists only for a batch whose
                          every exec succeeded.
  drains               -> NOT in x. In-flight hacks still land and are still sampled.
  money < moneyMax     -> NOT in x. The denominator is the measured pre-landing balance.
  h drifting           -> NOT in x. The denominator is the h recorded AT LAUNCH.

Measured live 2026-09-13 21:00Z: realised/planned = 0.33 (user reported 0.322).
  0.33 = 0.2 (ScriptHackMoney) x ~1.65 (h drift: the plan's h fell 34 -> 15 as the
  level climbed 150 -> 258 and phi rose with it, while `earned` is cumulative)
  x (landed/launched).  Chance cancels entirely.

## F8. Safety direction
y > Y -> plan under-hacks, grow over-delivers, target stays pinned at max. This is
         today's behaviour at y=1 and has run for hours.
y < Y -> plan over-hacks, grow under-sized, error integrates (no passive regrowth).
=> approach Y from ABOVE. Cold start 1 (>= Y everywhere: ScriptHackMoney <= 1 in the
   whole table). Point estimate is the UPPER quartile, and every contamination mode
   biases it up. Rises are instant, falls are rate limited to 1%/s. The game's drain
   clamp — the only place a sample can read low — is unreachable from above, and if
   one is seen anyway it forces an immediate step up.

## F9. Measured results (all offline, game formulas, BN4 physics)
  RAM: 8.80GB -> 8.80GB, delta 0.00GB, under BN1/BN4 x SF1/SF4.3 (game's own calculateRam)
  verify-selfcal.mjs: PASS 57 checks
  smoke.mjs (real main(), 2h simulated BN4): PASS, 2.21x income, y=0.2, spread 0,
      planVsReal 0.982, drains 0, placeFails 0, money held at 100%
  impact.mjs (live 3.7TB fleet): $146,588/s -> $330,622/s modelled; hack op grows
      34GB -> 381GB but still fits one block, and income is flat (+-4%) across
      largest-free-block from 32GB to 1024GB, so the B5 single-block ceiling
      degrades the batch size rather than the income.
  target-count argmax stays n=1 before and after.

## F10. A harness bug worth recording
smoke.mjs first reported the target sitting at 81% of max money after the correction,
which read exactly like a batcher desync. It was the harness: `calculateGrowMoney`'s
fourth parameter is the executing host's core COUNT (it calls getCoreBonus itself,
grow.ts:25,37) and the harness passed a core BONUS. On a 12-core host that under-grew
by 1.6x. Same class as the bug being fixed: a plausible value in the wrong units,
never checked against source. Fixed; money now holds at 100%.
