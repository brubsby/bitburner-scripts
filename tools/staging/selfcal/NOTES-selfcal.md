# Self-calibrating hack yield for `batch.js`

Staged, not deployed. `tools/` is in the daemon's `SKIP_DIRS`, so nothing here
touches the running game.

```
tools/staging/selfcal/
  batch.js             the candidate. diff against the repo root's batch.js
  verify-selfcal.mjs   57 checks: the decomposition, convergence across BitNodes, stability
  smoke.mjs            runs the candidate's REAL main() against a simulated BitNode 4
  impact.mjs           what it does to the plan, the placement and the income on the live fleet
  snap-live.mjs        read-only getSaveFile -> live-servers.json (input to the two above)
  FINDINGS.md          the evidence, written as it was found
```

```bash
node tools/staging/selfcal/snap-live.mjs        # refresh the live world
node tools/staging/selfcal/verify-selfcal.mjs   # PASS: 57 checks
node tools/staging/selfcal/smoke.mjs --hours 2  # PASS, and prints the A/B
node tools/staging/selfcal/impact.mjs           # the live-fleet plan table
```

## Deploy

```bash
cp tools/staging/selfcal/batch.js batch.js      # hot-deploys within ~150ms
curl -s localhost:12526/verify                  # confirm it landed (the push has silently dropped edits)
kill batch.js                                   # in-game; the watchdog brings it back within 30s
```

Then watch `/tel/batch.txt`. Expected sequence on a 1-target, ~3.7TB fleet:

| t | `calibration.verdict` | `calibration.y` |
| --- | --- | --- |
| 0 | `cold`, `samples: 0` | 1 — identical planning to today |
| ~1 weakenTime (~2min) | `cold`, samples climbing | 1 |
| +~50s (12 samples) | `ok` | starts falling |
| +161s | `ok`, `spread: 0` | **0.2** |

`y` cannot fall faster than 1%/s, so 1.0 → 0.2 takes 161 seconds by construction.
After the first status write past 12 samples it persists to `/tel/batch-cal.txt`,
so a later restart skips the whole ramp.

**Rollback is `run batch.js --nocal`** — same file, uncorrected planning, and it
says `verdict: "off"` in the status rather than going quiet. Full rollback is
restoring the previous `batch.js` from git.

## What to look at, and what each thing means

```jsonc
"calibration": {
  "verdict": "ok",                 // ok | cold | unstable | per-target-disagreement
                                   // | DISAGREES-WITH-FORMULAS | off
  "says":    "...",                // one sentence saying what the verdict means
  "y": 0.2,                        // the correction in force
  "p10": 0.2, "p50": 0.2, "p90": 0.2,
  "spread": 0,                     // (p90-p10)/p50. SHOULD BE 0 — see below
  "formulasExe": false,
  "expect": "currentNodeMults.ScriptHackMoney",
  "perTargetSpread": 0,            // per-target estimates should agree: it is a global constant
  "skipped": 0, "clamped": 0, "missed": 109,
  "tickMs": 200, "maxTickMs": 300
}
```

`spread` is the one to watch. Every sample is an *exact* reading of the same
constant — `h` and the pre-hack balance both cancel out of it — so a clean stream
has spread exactly 0. A non-zero spread means one of the identification
assumptions has broken, not that the estimate is noisy.

Per target:

```jsonc
"cal": { "y": 0.2, "n": 723, "min": 0.2, "max": 0.2,
         "landings": 832, "chanceObs": 0.849, "chanceModel": 0.836,
         "planVsReal": 0.982, "skipped": 0, "clamped": 0, "inFlight": 38 }
```

- `chanceObs` vs `chanceModel` — hack chance, measured and modelled side by
  side. `planBatch` already carries chance in `p.money`; the correction
  deliberately does NOT absorb it, and this pair is how a double-count would be
  caught.
- `planVsReal` — everything the plan promised for batches that have landed
  against everything that actually fell, geometrically forgotten so it is a
  recent number. **This is the 0.32 that started the investigation, computed
  with the right denominator.** It converges to `moneyPct/100`, i.e. once
  corrected the only term left in it is the balance at landing.

## Buying `Formulas.exe` ($5e9)

`attachMath` already prefers `ns.formulas.hacking.hackPercent`, which is the game
evaluating its own formula with every multiplier included by construction. The
moment that file exists:

- `calibration.formulasExe` flips to `true` and the sample window is **discarded**
  (a note says so) — samples taken against the port say nothing about samples
  taken against the game's own formula;
- `calibration.p50` must then read **1.0**, and `y` becomes a no-op;
- if it does not, `verdict` becomes `DISAGREES-WITH-FORMULAS` and names the
  reading. That is the whole self-check: the same mechanism, unchanged, must
  read 1.0 with Formulas and `ScriptHackMoney` without.

## Two things to patch afterwards

1. **`tools/sim/verify-batch.mjs` cannot see this class of bug and says PASS.**
   It does `await import("./game.bundle.mjs")` directly instead of importing
   `./game.mjs`, so `setBitNode()` never runs and `currentNodeMults` stays at
   the module default — every field 1, i.e. BitNode 1. It currently reports
   `"phi": 0` error over 1,080 checks against a game configured for BN1 while
   the shipped phi is 5x high in the BN4 we are in. The fix is one line:

   ```diff
   -const g = await import("./game.bundle.mjs");
   +import { setBitNode } from "./game.mjs";          // configures physics from the live save
   +const g = await import("./game.bundle.mjs");
   ```

   Note that after the fix it will FAIL on `phi`, correctly and permanently:
   `hackFraction` is *deliberately* the port without the node term. The right
   assertion there is the decomposition — `game phi === hackFraction(...) *
   currentNodeMults.ScriptHackMoney` — which `verify-selfcal.mjs` §1 already
   proves exactly across BN1/4/5/6/9/12.

2. **`tools/sim/verify-alloc-shipped.mjs` §0 will start reporting a plan
   mismatch** once this is deployed, because it builds its own target with
   `t.phi = B.hackFraction(...)` — the uncorrected value — and compares against
   a live plan that is now corrected. One line:

   ```diff
   -    t.phi = B.hackFraction(t.level, t.required, t.minSec, mults);
   +    t.phi = B.hackFraction(t.level, t.required, t.minSec, mults) * (CAL_Y ?? 1);
   ```

   with `CAL_Y = bt.calibration?.y`. (That §0 check also flaps for an unrelated
   reason: the live planner caps `h` at the largest *free* block, which the
   status file does not report. `verify-selfcal.mjs` §7 checks the identity
   `f === phi_model * h` at the live `h` instead, which cannot flap.)

## Known limitations, stated rather than discovered later

- **`ScriptHackMoneyGain` is not modelled.** It is the *other* node multiplier
  on the hack path (`NetscriptHelpers.tsx:648`) and it scales what the player
  receives from a drain rather than what leaves the server. It is 1 in every
  BitNode except **8**, where it is 0. `earned` here is accumulated from balance
  drops, so it is server drain: equal to income everywhere except BN8, where
  scripted hacking pays nothing at all and this controller is the wrong tool.
  Measuring it would need the worker to report `ns.hack()`'s return value
  (`tryWritePort`/`readPort` are both 0GB) and compare it with the drain.
- **`ServerGrowthRate` and `ServerWeakenRate` are still hardcoded to 1** in
  `growthK` and `WEAKEN_PER_THREAD`. Both happen to be 1 in BN4, which is why
  `verify-alloc-shipped` §1 reports `k` as exact while `phi` is 5x out. The same
  measurement trick would work on grow (observe the rise against the predicted
  rise) and is the obvious follow-on; `bncheck.mjs` already lists both as
  BitNode assumptions.
- **The estimator cannot learn faster than one weakenTime**, because that is how
  long the first batch takes to land. Persistence is the only way around it, and
  persistence is fenced by a server fingerprint rather than by a BitNode read,
  because `ns.getPlayer()` does not return the BitNode and `totalPlaytime` never
  resets. See FINDINGS.md §F6.
- **Nothing here proves the corrected controller earns more in the real game.**
  `smoke.mjs` measures 2.2x against a simulated BN4 and `impact.mjs` models
  2.25x on the live fleet, both offline. Only running it measures it.
