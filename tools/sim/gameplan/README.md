# gameplan — the whole remaining game, ordered

Which BitNode to play next, and the full order of every clear still owed
(every Source-File to level 3, SF12 once, BN15 excluded), minimising the total
hours to finish the game.

```bash
node tools/sim/gameplan/plan.mjs                       # state + node in progress from telemetry
node tools/sim/gameplan/plan.mjs --draws 200 --seed 7  # more draws
node tools/sim/gameplan/plan.mjs --state 1.3,2.1,4.3,5.1,6.1,8.1,9.1,10.1 --in-progress none
node tools/sim/gameplan/plan.mjs --build-only          # build / extend the surrogate cache only
node tools/sim/gameplan/plan.mjs --observe             # ingest telemetry into posterior.json, then plan on it
node tools/sim/gameplan/observe.mjs [--dry-run]        # the ingest alone: how the posterior moved
node tools/sim/gameplan/plan.mjs --prior               # the hand prior only (ignore posterior.json)
node tools/test/run.mjs gameplan                       # GP1-GP5
```

Run `plan.mjs --observe` after every clear: it reads the state from
`.telemetry/history.jsonl` (the Source-Files on entry to the current node, and
the node itself, which it treats as committed), folds what the finished nodes
measured into `posterior.json` (commit it), and re-plans from there. Use one
process, 2GB heap is plenty (peak RSS ~0.6GB).

## The pieces

| file | what it is |
| --- | --- |
| `state.mjs` | the state (SF level vector + intelligence), what is owed, the lattice and its mixed-radix index |
| `effects.mjs` | **one entry per Source-File**: its effect on a clear, the game source it rests on, and its status (SIMULATED / ASSUMED / NOT PRICED), with the ASSUMED lo/mid/hi |
| `economy.mjs` | telemetry -> the measured g of every played node (the calibration), the latent g for unplayed nodes |
| `params.mjs` | the uncertain parameters, their hand distributions (lo/mid/hi = p10/p50/p90 split normal), worlds and draws (through the posterior when one is applied) |
| `posterior.mjs` | the posterior store: the hand prior + the observation log -> every parameter's posterior (z-grid update for scalars, hierarchical Gaussian for g), the measurability table behind EXPLORE |
| `posterior.json` | the store (committed): the observation log, keyed, and the posterior summary it produces |
| `observe.mjs` | telemetry (history.jsonl + the in-run channel) -> readings -> the log; prints how the posterior moved |
| `../../../gameplan-obs.js` | the game-side writer of the in-run channel (`/tel/gameplan-obs.txt` on home) |
| `surrogate.mjs` | the slow sims precomputed over the reachable grid, cached on disk, interpolated |
| `routes.mjs` | the routes (hack, blade, and the node-special hooks) and `clearTime` = C(node, state, world) |
| `search.mjs` | exact DP over the lattice; nextnode's local search ported for comparison; brute force for the tests |
| `plan.mjs` | the CLI |
| `go.mjs` | the IPvGO model (phase 2): the Go bonus scale GoPower x the SF14 doubling, the favor life, the w0r1d_d43m0n exit divisor, the g channel — source formulas, measured BN9 farm, ASSUMED bounds, each labelled |
| `selftest.mjs` | the game-dependent half of `tools/test/gameplan.test.mjs` (GP2, GP3, GP4's simulation half), run in a child process |
| `gotest.mjs` | GP4's game-source half: go.mjs against the game's own CalculateEffect / getMaxRep / endGoGame / favor (tools/sim bundle), its own child |

C(node, state) is `min` over the routes that apply:

- **hack**: `max(0.5 Hx, Hx - early)`, `Hx = max(min(H, .5), H - ln(W)/g) + favor(node, SF14) - favor_ref(node)`,
  `H` = `hackexit.hackExitHours` at `g = g(node) x prod gFactor(SF) x goG(GoPower x SF14 doubling)`;
  `W` the w0r1d_d43m0n exit divisor, `favor` the favor life (go.mjs); `early` = sum of the SFs' first-life savings.
  Every node but BN14.
- **blade**: `open' - min(early, open' - 0.5) + leg(node, SF6, SF7) x k`, `leg` = bbsim median,
  `open' = open + gym(node) - gym(BN6)` (bbsim's time to combat 100 at the node's combat multipliers).
- **go (BN14)**: the hack formula at GoPower 4 (BN14's own route; hack does not apply there) — MODELLED (phase 2).
- **stocks (BN8), corp (BN3), stanek (BN13)**: placeholders, return null — NOT CALIBRATED.

### The IPvGO model (go.mjs) — what is measured, from source, assumed

| | |
| --- | --- |
| SOURCE | `effect = 1 + ln(n+1)(n+1)^0.3 x 0.002 x bonusPower x GoPower x (SF14?2:1)`; favor `getMaxRep()/200` per even-streak win to `getMaxRep()` = 100/200/300/400k at SF14 0-3; donations at favor 150 x FavorToDonate; faction rep `x FactionWorkRepGain x (1 + favor/100)`; node power zeroed per install; w0r1d_d43m0n (bonusPower 2, hacking level) after The Red Pill; BN14's multipliers. GP4 runs each against the game. |
| MEASURED | Daedalus 4391 power/h, win 0.85 (goplan.js, 60 games at 5x5); 160 games/h (go.txt, BN9); Daedalus work rep/h per level 72/97/150 and the favor-life level 3500/4700/5900 (history.jsonl, BN1/4/5/8/9/10) |
| ASSUMED | `eps14` (g's elasticity to the Go rate bonus, 0/0.12/0.3 — mid = nextnode's d14), `w0` (w0r1d_d43m0n power/h, 0/200/1000 — never played), 1h of Go before the favor grind and of w0r1d_d43m0n before the exit hack |
| NOT PRICED | go.cheat (BN14.2, SF14.2+), the Tetrads bonus on the gym, hacknet |

The favor life's reference is the one inside the g it was measured with: a
played node's own (at SF14 0), else the measured runs' mean (BN2 excluded: the
gang sold its Red Pill). So played nodes reproduce at SF14 0 and SF14 moves
every node through its favor life, g and W.

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

The **EXPLORE** table puts each parameter's EVPPI (net of the floor) beside
what measuring it costs before the next decision (`posterior.measurability`):
w0 ~0h in any node after The Red Pill (the Go agent's w0r1d_d43m0n games), goP
free from the running farm, rep14/lvl14 free in a hacking-route node, k/open
free with a Bladeburner clear, a node's g only by playing it (after the
decision; the row prints what playing it next costs), the SF-effect parameters
only once their Source-File is held. A row is worth taking when it can happen
before the decision and saves more than it costs; the EXPLORATION line names
them, or says none is.

## The posterior: learning from finished nodes

`posterior.json` = the hand prior (the lo/mid/hi above, kept as the base) +
a log of readings. The posterior is recomputed from the two on every read;
the file's `posterior` block is that result written out for diffs.

- **Scalars** (k, open, every SF_PARAMS entry): prior = the hand split normal
  over its z; likelihood **log-normal** on the value (`ln obs ~ N(ln v, sd^2)`,
  the shape the calibrations use: g in ln g, k a ratio), or normal for a
  `space: 'lin'` reading (a w0 of 0). Posterior on a z grid; a draw maps its z
  through `z -> Qpost(Phi(z))`, so the draws, VOI and sweeps are unchanged in
  form and a clipped prior (w0's mass at 0) is exact.
- **g, hierarchical**: `x_n = ln(g_n AMC_n^gamma)`; every node not measured in
  the base is `mu + tau e_n` with `mu ~ N(ln mid, RHO s^2)`, `tau^2 = (1-RHO) s^2`
  (exactly the hand draw's variance and common share); a base-measured node is
  `N(ln g, SIGMA_PLAYED^2)`. A reading is a Kalman update of the joint
  Gaussian: an observed unplayed node pulls `mu`, hence every unplayed node,
  by `vMu/(vMu+tau^2+sd^2)` of its surprise, and shrinks the common share.
  tau is not learned (observe prints a full hierarchical fit of the base runs
  as a cross-check of the hand latent).
- **What observe reads** from history.jsonl (from the first measured run on,
  segments >= 2h): a finished hacking-route clear (hacking level >= 1000) ->
  `g<n>` backed out of its hours (economy's calibration, sd 0.15); a finished
  Bladeburner clear -> `k = (hours - opening) / bbsim leg` (the k that makes
  routes.mjs reproduce it, sd 0.1); a Bladeburner node's opening (entry ->
  combat 100, first life, less the node's gym scale; in progress or not) ->
  `open` (sd 0.25). The sds are ASSUMED.
- **Idempotent**: a reading's key is `param|BNn.l|completion time` (open: the
  node's start time); a key already in the log is skipped. Evidence the hand
  prior was built from — economy.MEASURED_RUNS for g, BN6.1 for k (bbcal6) and
  open — is logged `inBase: true` and never applied twice.
- **An open discrepancy, logged not applied**: BN6.1 read through the
  planner's own blade formula gives k = 1.22 ((35.79 - 2.38)/27.32), not the
  base 0.916 — bbcal6 divided by the leg *as run* (the sleeve fleet joined
  24.8h late), the grid's leg is the clean one (fleet from the join). If the
  next Bladeburner clear (BN4.3) also reads above 1, the base k is the wrong
  one. Priced with the BN6 reading applied (2026-10-03): E[T] 913.8 -> 963.5h,
  BN11.1 still first (P(best) 59%).

### Observations: the in-run channel

For measurements not tied to a node's completion (the Go agent's w0, a Go
farm rate, a Daedalus rep rate), one JSON line per reading:

```
{ "param": "w0", "value": 121.04, "sd": 4.1, "at": "2026-10-04T15:00:00Z",
  "source": "go.js: 40 games vs ????????????" }
```

(exactly what go.js publishes every 20 games against w0r1d_d43m0n, goplan.w0Obs)

| field | |
| --- | --- |
| `param` | `w0`, `goP`, `rep14`, `lvl14`, `eps14`, `k`, `open`, `phi11`, `d10`, `d8`, `e43`, `z9`, or `g<n>` |
| `value` | in the parameter's units (w0: raw node power per hour against w0r1d_d43m0n, before GoPower / the SF14 doubling — go.mjs applies the scale; goP: Daedalus power/h / 4391) |
| `sd` | its standard error: in the parameter's units (`space: 'lin'`), or of ln(value) (`space: 'log'`: 0.2 = ~20%). A lin sd is floored at 1% of the hand p10-p90 width (w0: 10/h), so a "never scored" 0 +- 0 is a reading, not a certainty |
| `space` | default `'lin'` for w0 (go.js's delta-method sd is absolute, and 0 is a real value), `'log'` for everything else |
| `at`, `source` | ISO time and who measured it how; with `param` they form the default key |
| `stream` | optional: readings of one stream are CUMULATIVE re-estimates, so only the latest (by `at`) is applied, the rest are logged as superseded. Inferred from a source of the form `<who>: <n> games vs <opponent>` (go.js's), as `param\|who\|opponent` |
| `node`, `key` | optional: the BitNode; an explicit dedup key |

Write it in-game with `recordObs(ns, {...})` from `gameplan-obs.js`: it appends
to `/tel/gameplan-obs.txt` **on home** (the daemon mirrors only home's `/tel/*`,
to `.telemetry/gameplan-obs.txt`; the helper throws on any other host). Tools
outside the game append the same lines to `.telemetry/gameplan-obs.jsonl`.
observe.mjs reads both, validates each line (an unknown param, a non-positive
log sd or a value <= 0 in log space is rejected and printed), and logs it by
key, so a mirrored file re-read every poll counts each reading once — and a
reading already in posterior.json survives the game file being truncated.
GP5 runs goplan.w0Obs's own output through the reader.

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
3. **A newly played node.** Run `plan.mjs --observe` and commit
   `posterior.json`: a hacking-route clear becomes that node's g (and pulls the
   unplayed population), a Bladeburner clear a reading of k and open. Adding
   the run to `economy.MEASURED_RUNS` instead (the phase-1 way) rebuilds the
   hand latent around it; the next observe re-flags its logged reading
   `inBase` (observe.mjs `baseIn` is derived from MEASURED_RUNS), so it is not
   counted twice.
4. **A new state dimension** (intelligence on the lattice, SF12 past level 1):
   add it to `state.lattice`; the DP is exact over whatever the lattice is, but
   its size multiplies. Past ~20M states switch to A* with the bound
   "sum over owed clears of the cheapest clear at the best reachable state".

Keep GP3 green while doing it: it pins this planner to nextnode.mjs's numbers
wherever the models still coincide; when a phase-2 change is *meant* to move
them, update the expected values in `selftest.mjs` in the same commit and say why —
or, as the IPvGO model does, put the change behind `worldOf(..., {phase1: true})`
(and `hackHours(..., {speed1: true})`) so GP3 keeps reproducing phase 1 exactly
and the new terms get their own check (GP4).
