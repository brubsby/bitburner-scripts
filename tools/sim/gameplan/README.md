# gameplan — the whole remaining game, ordered

Which BitNode to play next, and the full order of every clear still owed
(every Source-File to level 3, SF12 once, BN15 excluded), minimising the total
hours to finish the game.

```bash
node tools/sim/gameplan/plan.mjs                       # state + node in progress from telemetry
node tools/sim/gameplan/plan.mjs --draws 200 --seed 7  # more draws
node tools/sim/gameplan/plan.mjs --state 1.3,2.1,4.3,5.1,6.1,8.1,9.1,10.1 --in-progress none
node tools/sim/gameplan/plan.mjs --build-only          # build / extend the surrogate cache only
node tools/test/run.mjs gameplan                       # GP1-GP3
```

Run it after every clear: it reads the state from `.telemetry/history.jsonl`
(the Source-Files on entry to the current node, and the node itself, which it
treats as committed) and re-plans from there. Use one process, 2GB heap is plenty
(peak RSS ~0.6GB).

## The pieces

| file | what it is |
| --- | --- |
| `state.mjs` | the state (SF level vector + intelligence), what is owed, the lattice and its mixed-radix index |
| `effects.mjs` | **one entry per Source-File**: its effect on a clear, the game source it rests on, and its status (SIMULATED / ASSUMED / NOT PRICED), with the ASSUMED lo/mid/hi |
| `economy.mjs` | telemetry -> the measured g of every played node (the calibration), the latent g for unplayed nodes |
| `params.mjs` | the uncertain parameters, their distributions (lo/mid/hi = p10/p50/p90 split normal), worlds and draws |
| `surrogate.mjs` | the slow sims precomputed over the reachable grid, cached on disk, interpolated |
| `routes.mjs` | the routes (hack, blade, and the node-special hooks) and `clearTime` = C(node, state, world) |
| `search.mjs` | exact DP over the lattice; nextnode's local search ported for comparison; brute force for the tests |
| `plan.mjs` | the CLI |
| `selftest.mjs` | the game-dependent half of `tools/test/gameplan.test.mjs` (GP2, GP3), run in a child process |

C(node, state) is `min` over the routes that apply:

- **hack**: `max(0.5 H, H - early)`, `H` = `hackexit.hackExitHours` at
  `g = g(node) x prod gFactor(SF)`; `early` = sum of the SFs' first-life savings.
- **blade**: `open - min(early, open - 0.5) + leg(node, SF6, SF7) x k`, `leg` = bbsim median.
- **go (BN14), stocks (BN8), corp (BN3), stanek (BN13)**: placeholders, return null — NOT CALIBRATED.

The order search is exact: V(s) = min_n C(n, s) + V(s + n) over the 1.5-3M states
of the lattice, in reverse index order (a clear always raises the index). C is
tabulated over the *live* feature space only (SFs some effect reads); inert SFs
(2, 3, 13 in phase 1) are pure cost.

## Uncertainty

A draw sets every parameter: g per node (unplayed: a common factor with share
RHO = 0.5 plus a node term, through the latent's lo/mid/hi; played: the measured
g x exp(0.15 z)), k, open, and each ASSUMED SF effect. Every first move is priced
on the same draws (each followed by that draw's own optimal continuation), so
the regret table is paired. Two plans come out of it:

- the **recommended next node**: lowest expected total, with P(best) and the
  regret quantiles — the decision you take now and then re-plan;
- the **robust fixed order**: the exact best order *committed in advance*, which
  is the DP on the mean clear-time table (a fixed order's expected total is the
  sum of expected clear times).

The **value of information** table bins the draws on one parameter at a time
(EVPPI: hours a perfect reading of that parameter would save) and sweeps it to
its p10 / p90 with everything else at the median: a parameter whose sweep
changes the best first move is a model that, if wrong, flips the decision. The
EVPPI noise floor (a placebo parameter) is printed beside it.

## The cache

`.cache/hack.json` and `.cache/bb.json` (gitignored), one entry per sim call,
keyed by `sha1(code hash + the call's spec)`:

- hack: `exitplan.js` + `hackexit.mjs` + `SURROGATE_VERSION`, and
  `{node, level, sf key, profile, g}` — so new telemetry (a different profile)
  or an exitplan edit invalidates exactly those entries;
- bb: nextnode's scheme (`bbsim.mjs` + `bbjobs.mjs` + the bundle's size), and
  the full bbsim spec.

A build only computes missing entries (the Bladeburner runner saves every 20
sims, so a killed build resumes). Costs measured on this machine: a hack grid
point ~0.9ms (961 g-points x 39 curves = 37,479 points, ~30s from cold), a
Bladeburner sim ~0.17s (156 cells x 15 seeds = 2,340 sims, ~7 min from cold,
one process at nice 15). A plan with 100 draws is ~2-3 min.

## Phase 2: replacing a placeholder

Everything a phase-2 model needs to touch is one entry in one table:

1. **A node-special route (BN14 Go first).** Give the hook in `routes.mjs` an
   `hours({node, lv, world, S})` that returns hours (null = not available).
   If it needs a slow sim, add its grid to `surrogate.mjs` the way the
   Bladeburner grid is done (spec -> key -> cache -> lookup on `S`) and its
   uncertain inputs to `params.mjs` (`paramIds`, `drawZ`, `worldOf`) so the
   draws and the VOI table see them. Change its `status` string. Nothing else
   changes: the DP picks the route up wherever it is the cheapest.
2. **A Source-File effect.** Replace the entry in `effects.mjs`: keep the
   role(s) (`hackKey`, `bbKey`, `gFactor`, `early`, `nodeLevel`), change the
   function and `status`, and move its parameters into `SF_PARAMS` (with
   lo/mid/hi) if it is still uncertain. A new `hackKey`/`bbKey` level
   dependency enlarges the surrogate grid automatically (rebuild with
   `--build-only`). An SF that gains any role stops being inert and enters the
   feature table — the DP's cost grows by its level count, nothing else.
3. **A newly played node.** When a node finishes on the hacking route, add the
   run to `economy.MEASURED_RUNS` (pinned by its start time): its own g then
   replaces the latent for that node, and the CHECK line reproduces its hours.
   A Bladeburner clear is a calibration of `k` instead: rerun
   `nodechoice/bbcal6.mjs`'s method on it and update `BB_PARAMS.k`.
4. **A new state dimension** (intelligence on the lattice, SF12 past level 1):
   add it to `state.lattice`; the DP is exact over whatever the lattice is, but
   its size multiplies. Past ~20M states switch to A* with the bound
   "sum over owed clears of the cheapest clear at the best reachable state".

Keep GP3 green while doing it: it pins this planner to nextnode.mjs's numbers
wherever the models still coincide; when a phase-2 change is *meant* to move
them, update the expected values in `selftest.mjs` in the same commit and say why.
