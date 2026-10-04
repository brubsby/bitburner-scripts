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
node tools/test/run.mjs gameplan                       # GP1-GP8, SL1-SL4
TELEMETRY=<.telemetry> node tools/sim/gameplan/sleeves.mjs   # re-derive the hacking route's d10 and the 5th Covenant sleeve's price
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
| `economy.mjs` | telemetry -> the measured g of every played node (the calibration), the latent g for unplayed nodes; the profile the hacking exit runs on (`--rates fit`: rates.mjs's fitted exp/s and $/s; `--rates const`: the old constants) |
| `rates.mjs` | the hacking route's exp/s and $/s FITTED: a progress-level model per channel (`ln rate = offset_n + a_n + b ln(Lpk/1000)`, the offset the node's multipliers from source, b pooled within-node, a_n hierarchical on the money factor), evaluated at the node's exit level for the final window; the node in progress's own reading (`xr<n>`/`ir<n>`, observe.mjs); its leave-one-out CHECK |
| `ratestest.mjs` | RT3-RT5's game half (`tools/test/gameplan-rates.test.mjs`): the old constants reproduce the old numbers, the played nodes' leave-one-out hours and rates, the in-run reading's reach |
| `params.mjs` | the uncertain parameters, their hand distributions (lo/mid/hi = p10/p50/p90 split normal), worlds and draws (through the posterior when one is applied) |
| `posterior.mjs` | the posterior store: the hand prior + the observation log -> every parameter's posterior (z-grid update for scalars, hierarchical Gaussian for g), the measurability table behind EXPLORE |
| `gmodel.mjs` | the g prior with covariates: hierarchical regression of ln g on the BitNode multipliers, tau on a grid, leave-one-out model choice, the joint sampler the draws use |
| `discrepancy.mjs` | the model-discrepancy term on unplayed nodes' hours, its sd fitted to the played runs' leave-one-out residuals |
| `adaptive.mjs` | knowledge gradient with correlated beliefs, the information-relaxation bound, CVaR, multi-fidelity Monte Carlo — over the per-draw tables, cross-fitted |
| `posterior.json` | the store (committed): the observation log, keyed, and the posterior summary it produces |
| `observe.mjs` | telemetry (history.jsonl + the in-run channel) -> readings -> the log; prints how the posterior moved; the node in progress's own readings (its opening, its exp/income levels `xr<n>`/`ir<n>`, its g once two hacking-route lives are finished) |
| `../../../gameplan-obs.js` | the game-side writer of the in-run channel (`/tel/gameplan-obs.txt` on home) |
| `surrogate.mjs` | the slow sims precomputed over the reachable grid, cached on disk, interpolated |
| `routes.mjs` | the routes (hack, blade, and the node-special hooks) and `clearTime` = C(node, state, world) |
| `search.mjs` | exact DP over the lattice; nextnode's local search ported for comparison; brute force for the tests |
| `plan.mjs` | the CLI |
| `stanek.mjs` | Stanek's Gift (SF13, BN13): the layout per grid (cached in `.cache/stanek-layouts.json`), the gift's factors on the hacking route (exit divisor W, g factor, favor-life factor) from `../../../stanekplan.js` (the pure model: catalogue, grid, effect, charge, placement optimiser, the per-life charging model) |
| `stanektest.mjs` | ST1's game-source half: stanekplan.js against the game's own CotMG classes (tools/sim bundle), its own child |
| `sleeves.mjs` | the sleeve fleet: the count rule (min(3, SF10 + (BN10 ? 1 : 0)) + 4 Covenant), the hacking route's DERIVED d10 (an extra sleeve's money-crime trajectory through exitplan's per-life lift on the measured lives) and the 5th Covenant sleeve's price; its CLI re-derives them |
| `sleevetest.mjs` | SL1-SL3's game half: the count against the game's recalculateNumberOfOwnedSleeves (tools/sim bundle); 5 sleeves = the old surrogate, monotone in sleeves (the cache) |
| `go.mjs` | the IPvGO model (phase 2): the Go bonus scale GoPower x the SF14 doubling, the favor life, the w0r1d_d43m0n exit divisor over its window (the post-TRP climb fixed point), the derived w0 prior, the g channel — source formulas, measured BN9 farm, ASSUMED bounds, each labelled |
| `selftest.mjs` | the game-dependent half of `tools/test/gameplan.test.mjs` (GP2, GP3, GP4's simulation half), run in a child process |
| `gotest.mjs` | GP4's game-source half: go.mjs against the game's own CalculateEffect / getMaxRep / endGoGame / favor (tools/sim bundle), its own child |

C(node, state) is `min` over the routes that apply:

- **hack**: `max(0.5 Hx, Hx - early)`, `Hx = max(min(H, .5), H - ln(W)/g) + favor(node, SF14) - favor_ref(node)`,
  `H` = `hackexit.hackExitHours` at `g = g(node) x prod gFactor(SF) x goG(GoPower x SF14 doubling)`,
  its final window at the node's FITTED exp/s and $/s (rates.mjs; `--rates const`: the old constants);
  `W` the w0r1d_d43m0n exit divisor (effect(w0 x the window), the window the post-TRP climb's fixed point), `favor` the favor life (go.mjs); `early` = sum of the SFs' first-life savings.
  Every node but BN14.
- **blade**: `open' - min(early, open' - 0.5) + leg(node, SF6, SF7, sleeves) x k`, `leg` = bbsim median,
  `open' = open + gym(node) - gym(BN6)` (bbsim's time to combat 100 at the node's combat multipliers);
  `sleeves` = the fleet the clear runs with (sleeves.mjs: 5 today, 6/7 at SF10.2/10.3, +1 inside BN10),
  the leg at 6/7 = the 5-infiltrator leg x leg(live pick, n) / leg(live pick, 5) (surrogate's fleet axis).
- **go (BN14)**: the hack formula at GoPower 4 (BN14's own route; hack does not apply there) — MODELLED (phase 2).
- **stanek** (any node where the gift is available: BN13, or SF13 >= 1): the hack formula (BN14: go)
  with Stanek's Gift accepted at the node's start — `g x gMul`, `W x W_gift`, `favor x favorMul`
  (stanek.mjs). The min over routes IS the accept-or-never decision, per node and world.
  MODELLED from source; the Bladeburner route with the gift is NOT PRICED.
- **stocks (BN8), corp (BN3)**: placeholders, return null — NOT CALIBRATED.

### The IPvGO model (go.mjs) — what is measured, from source, assumed

| | |
| --- | --- |
| SOURCE | `effect = 1 + ln(n+1)(n+1)^0.3 x 0.002 x bonusPower x GoPower x (SF14?2:1)`; favor `getMaxRep()/200` per even-streak win to `getMaxRep()` = 100/200/300/400k at SF14 0-3; donations at favor 150 x FavorToDonate; faction rep `x FactionWorkRepGain x (1 + favor/100)`; node power zeroed per install; w0r1d_d43m0n (bonusPower 2, hacking level) after The Red Pill; BN14's multipliers. GP4 runs each against the game. |
| MEASURED | Daedalus 4391 power/h, win 0.85 (goplan.js, 60 games at 5x5); 160 games/h (go.txt, BN9); Daedalus work rep/h per level 72/97/150 and the favor-life level 3500/4700/5900 (history.jsonl, BN1/4/5/8/9/10) |
| DERIVED | `w0` (w0r1d_d43m0n node power/h): **1020 / 1570 / 2380** (p10/p50/p90; was an ASSUMED 0/200/1000). The game's payout (endGoGame: black's score x 2.5 for komi 9.5 x the streak multiplier — 0.5 on a loss, 1 + 0.5 min(dry, 8) on a win that breaks a dry streak, 1 + 0.25 min(streak, 8) otherwise; the streak resets each life) in the streak chain's stationary state, composed by Monte Carlo (go.mjs `w0PriorMC`, 20k draws) with four uncertain inputs (go.mjs `W0_PRIOR_INPUTS`, each with its reason): **win rate** Beta(1.4, 26.1), mean 0.05 — Illuminati 5x5 (same AI move set; ~0.2 live, 0.25 harness) as a wide Beta(1.4, 5.6), then the harnesses on the bitverse board itself (go-boardsize 19x1500 and go-w0.mjs: **0 wins in 41**) at half weight; **black's score on a loss** 0.5 x Beta(8, 4.5) of 267, mean 85 — the 19x19 node-power search go.js plays scores 84-87 in the harness (the 5x5 search: 29-97, mean 68) — at a win rate near 0 this is the floor; **on a win** 0.5 + 0.5 Beta(2, 5.5) of 267 (a win needs ~135+); **games/h** 7.5 / 8.8 / 10.5 (~150 moves a side; an AI reply waits 4.4 x 200ms + 19 x 10ms + ~0.4s compute, our move is the 800ms search + ~0.55s round trip and idle — the same clocks give 5x5's live 175/h). At win rate 0 the composition gives 8.8 x 0.5 x 2.5 x 86.7 = 954/h against go-w0.mjs's measured 961/h; the median is higher because a rare win breaks a long dry streak at x5. Rank correlation with w0: win rate 0.81, games/h 0.38, loss score 0.35, win score 0.14. GP4 plays the payout through the game's endGoGame; GP8 re-derives the constants and checks goplan.js's `W0_PRIOR` (1570/h at refP 0.051) agrees. go.js's measured rate still updates it (the obs channel below). NOT CALIBRATED live: no game against the hidden opponent has been played. |
| WINDOW | w0r1d_d43m0n is played from **The Red Pill install to the exit hack** (node power and streak zeroed at that install, Go.ts:34-47), alone: on the hacking route after the terminal install goplan.hackLevelWeight prices the climb while goweights' channels are ~0 (no install left for money/rep, no pre-install exp), so chooseOpponent never shares the slot. Its length is the **post-TRP climb** of the hacking route's own simulation (`climb to exit level`, the surrogate's climb table `.cache/climb.json`, averaged over one install-sawtooth tooth in ln g: 0.3-1.3h by node) **shortened by the bonus it banks**: the exit is `M x W(t) x u(exp t) >= E` and node power lands per finished game, so the window is the exact first passage with W a step per game (go.mjs `goWindow`; its continuous limit is the fixed point `L = T(u0 / W(w0 L))` — GP8: bisection = the damped map, and the per-game scan converges to it as the game length -> 0). `W = effect(w0 x games)` at the node's scale (GoPower 4 in BN14, else 1; x2 with SF14) divides the exit level through the exit shift (ln W / g, installs re-planned). **The result: about one game** (~0.11-0.19h) — u is logarithmic in exp, so the first game's ~10% (BN14: ~40%; with SF14.1 ~80%) clears what is left of the climb — W ~1.10 at GoPower 1 nearly whatever w0 is. `--w0-window 1` restores the old fixed 1h; `--w0-prior 0,200,1000` the old prior (GP4 (d): w0 = 0, or a fixed 1h, reproduces the old numbers). NOT PRICED, flagged: today's exitplan does not know the hidden opponent, so live the bonus only shortens the climb (L0 - L*, ~0.2-1h; `--w0-live` prices that instead of the exit shift); an exitplan that anticipated it would install The Red Pill earlier and farm a longer climb (the Go term w0 d ln W/dL beats g at the climb's end) — worth roughly 6-13h a hacking clear at GoPower 1 and ~40h+ in BN14 on the same model (tools/sim/gameplan: go.mjs WHAT IT SAYS). |
| ASSUMED | `eps14` (g's elasticity to the Go rate bonus, 0/0.12/0.3 — mid = nextnode's d14), 1h of Go before the favor grind |
| NOT PRICED | go.cheat (BN14.2, SF14.2+), the Tetrads bonus on the gym, hacknet |

The favor life's reference is the one inside the g it was measured with: a
played node's own (at SF14 0), else the measured runs' mean (BN2 excluded: the
gang sold its Red Pill). So played nodes reproduce at SF14 0 and SF14 moves
every node through its favor life, g and W.

### Stanek's Gift (stanekplan.js, stanek.mjs) — source, measured, assumed

| | |
| --- | --- |
| SOURCE | catalogue (Fragment.ts), geometry (fullAt/neighbors), grid `9 + StaneksGiftExtraSize + SF13` (StaneksGift.ts:20-32), effect `1 + ln(h+1)/60 x ((n+1)/5)^0.07 x power x boost x node power`, charge (numCharge x highest = sum of threads), Church rep per charge `faction_rep x t^0.95 x (favor+100)/1000`, 1 charge/s/script, 2GB a thread, cores bonus, charges cleared per install (layout kept), Genesis x0.9 / Awakening (1e6 rep) x0.95 / Serenity (1e8) x1, accept only before any non-NeuroFlux aug (Prestige.ts:184). ST1 runs every one against the game. |
| MEASURED | home RAM at a no-gift hacking exit, log2 GB p10/p50/p90 15/21/22.5 (history.jsonl, 10 exits) and its shape `log2 R = 8 + (exit - 8) (t/H)^2`, 7 cores at the exit |
| POLICY | one charging script on home, f of its RAM, round robin; f chosen per node and world (0.1%-50%); layout per grid optimised once at Hg 2.5, f 0.2 (exact up to 5x5 — ST2 vs brute force — best-found past it, marked `~`) |
| ASSUMED | `stEpsM` 0.03/0.09/0.2 (g's elasticity to income), `stEpsR` 0.03/0.12/0.3 (to faction rep), `stFr` 2/4/8 (the augs' faction_rep at the node's end: the Church clock), `stDuty` 0.6/0.9/1; the hack threads' share of a batch's RAM 0.22 (FIXED); the favor life at 0.8 of the node (FIXED) |
| NOT PRICED | the Bladeburner route with the gift (bbsim has no Stanek multipliers: a Bladeburner clear never accepts), bonus time, charging from purchased servers, ZOE sleeves |

Channels into the SAME exit simulation the no-gift clear runs: the final life's
hacking skill and exp term at the exit (W, through exitShift — at W 1.25-4 within
~0.5-2h of hackexit at exitLevel/W on BN1/5/11/13, slightly optimistic at W >= 2),
the node-averaged income (speed x skill x chance x money/grow mix x (1 - f)) and
faction rep through the elasticities (g), and the favor life (1/(skill x rep)).
The gift run's length feeds its own home-RAM curve (RAM is a function of hours
into a no-gift node, so a shorter run exits on a smaller home: a fixed point).
`--no-stanek` prices the gift never accepted: the pre-Stanek plan, draw for draw
(Stanek's parameters have their own random stream).

Results 2026-10-03 (BN14.1 in progress, posterior after BN4.3, 100 draws, seed 1):
gift verdict ACCEPT on every hacking-route node (BN13 ~13.5-14.4h saved; BN5 ~10.5h;
BN7 ~11h; BN10 6.5-8h; BN12 6-7h; BN9 4.5-6.5h; BN8 4h; BN2 2-4h; BN14 ~2.4h),
never on the Bladeburner-route nodes (BN3, BN6, BN11: the blade route stays cheaper).
SF13's own value 76.4h, BN13's gift inside BN13 35.3h (mid world). E[T] best first
move 898.6h -> 794.0h; BN13.1 moves from the last three slots to 4th (mid world)
and 1st in the robust order; the recommended next node stays BN11.1 (P(best) 72% ->
57%, BN13.1 now +1.1 +- 0.4h behind). Cost: 2.1s a draw, peak RSS 1.7GB (0.8GB
with `--no-stanek`): the table is 4x larger with SF13 live.

### The sleeve fleet (sleeves.mjs) — source, simulated, derived, assumed

| | |
| --- | --- |
| SOURCE | `sleeves = min(3, SF10 + (BN10 ? 1 : 0)) + sleevesFromCovenant` (SleeveCovenantPurchases.tsx:63; SL1 runs the game's recalculateNumberOfOwnedSleeves over 96 cases); 4 Covenant sleeves held, so 5 today, 6 at SF10.2, 7 at SF10.3, and one more inside BN10 (BN10.2 at SF10.1: 6; BN10.3 at SF10.2: 7). The 5th Covenant sleeve: getSleeveCost(4) = 10^4 x $10t = $1e17, BN10 only. |
| SIMULATED (Bladeburner) | bbsim (the game's classes) at 5, 6, 7 sleeves under the live fleet rule — sleeve.js's committed mix is bbplan.chooseSleeveConfigGen's "the fastest of sleeveConfigs(n)"; here the fastest on the game's classes per (node, n) at SF6.1/SF7.0 on selection seeds 101-105 (the picks: i1/f4 at 5 on BN6/11, i2/f4 and i3/f4 at 6/7 — infiltrate/field analysis). The plan's leg = the 5-infiltrator leg (k's definition) x leg(pick n)/leg(pick 5) on seeds 1..15, floored at the n-1 ratio (an extra sleeve may idle). 9555 sims, ~30 min once, bb.json 2.4MB. |
| DERIVED (hacking) | the live policy gives one sleeve a faction (setToFactionWork throws on a second), so a 6th/7th sleeve falls through to its best money crime. exitplan prices that money as a per-life lift k^eBudget; on hackexit's fresh inputs (income NOT CALIBRATED, $1e7-5e8/s at level 1) it is ~0, so the lift is applied to the six measured runs' lives (peak money / life length) with the new sleeve's own trajectory (skills 1, shock 100 falling passively, training by its crime and the fleet's hand-off): d10 per unit CrimeMoney 0.03% / 0.72% / 3.8% (lo/mid/hi; was the hand 0 / 1% / 3% node-free), the node's g x (1 + d10 x CrimeMoney) per sleeve past 5. |
| ASSUMED | eBudget 0.05/0.15/0.3 (ln 1.1 / ln 1.9 mid), a life's income / its peak-money bound 3/1.5/1 |
| NOT PRICED | a sleeve on a second faction's rep (the live policy never assigns one), the exp transfer (<= 16 exp/s at sync 1), the 5th Covenant sleeve as a move (no Covenant axis in the state: printed against its price), the fleet before the Bladeburner join |

`--five-sleeves` prices 5 sleeves everywhere (SF10.2/10.3 and BN10's own sleeve worth nothing).

Results 2026-10-03 (BN14.1 in progress, 100 draws, seed 1). Bladeburner leg ratio at 6 / 7
sleeves (SF6.1/SF7.0): BN3, BN6, BN11, BN2 1.000 / 1.000 (the 5-fleet already saturates the
21 black ops: these are the plan's Bladeburner clears), BN10 0.980, BN13 0.993, BN5 0.935,
BN9 0.908, BN12 0.839, BN7 1.000 / 0.922, BN14 1.000 / 0.949. Hacking route per sleeve
(mid): BN11 -1.2h, BN14 -0.5h, BN9 -0.2h, BN2 -0.1h. SF10.2/10.3's two sleeves are worth
8.1h, BN10's own temporary sleeve 4.0h (12.1h together; the old d10 guess credited
~6.7h); BN10's clears move to the Bladeburner route (70.4h at SF10.1, 6 sleeves) and to
slots 17-18 (were 10 and 15, hacking with the gift). E[T] best first move 809.2h ->
802.2h; the recommendation stays BN11.1 (P(best) 60%, BN13.1 +1.5 +- 0.5h). The 5th
Covenant sleeve costs 22.4h of BN10's late income plus the Covenant's 850s in one
window, against ~4h for one more sleeve: not worth holding for.

The order search is exact: V(s) = min_n C(n, s) + V(s + n) over the 1.5-3M states
of the lattice, in reverse index order (a clear always raises the index). C is
tabulated over the *live* feature space only (SFs some effect reads); inert SFs
(2, 3 now; 13 too in phase 1 and with `--no-stanek`) are pure cost.

## Uncertainty

A draw sets every parameter: g per node (unplayed: the covariate model's joint
posterior when leave-one-out keeps it — gmodel.mjs, "Learning as we play" — else
a common factor with share RHO = 0.5 plus a node term, through the latent's
lo/mid/hi; played: the measured g x exp(0.15 z)), k, open, each ASSUMED SF
effect, and each unplayed node's model discrepancy (discrepancy.mjs). Every first move is priced
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

## Learning as we play (gmodel.mjs, discrepancy.mjs, adaptive.mjs)

Five additions from a prior-art review, each printed by every plan run
(`--no-adapt` skips 3-5; GP6/GP7 in `tools/test/gameplan-learn.test.mjs`
test them on synthetic inputs whose answer is known).

1. **A g prior with covariates** (Hong et al. AISTATS 2022 hierarchical TS;
   Wan et al. 2021 metadata bandits; Gelman 2006). `ln g_n = beta'x_n + v_n`,
   `v_n ~ N(0, tau^2)`, x = standardised ln AugmentationMoneyCost, ln(ScriptHackMoney
   x ServerMaxMoney x ScriptHackMoneyGain) (BN8's 0 floored at 0.001), ln
   HackingLevelMultiplier, ln WorldDaemonDifficulty, read from the game's
   multiplier table. Slopes `N(0, 0.3^2)` (shrink hard: 6 runs), intercept
   `N(ln 0.06, 1)`, tau half-normal(0.5); beta integrated out exactly, tau on
   a grid. Route is not a feature: every g reading is a hacking-route clear.
   `--g-model auto` (default) keeps the best of hand / exch / amc / full by
   leave-one-out log predictive density over the played runs. The draws sample
   the joint posterior predictive, so the unplayed nodes are correlated through
   the shared beta and tau. An extra parameter, `tauG`, carries the draw's tau.
2. **The knowledge gradient with correlated beliefs** (Frazier, Powell &
   Dayanik 2009; KG(*)). Playing A reveals a reading: g_A on the hacking route,
   k on the Bladeburner route, with OBS_SD noise. The order after A is then
   re-chosen on the *conditional* mean table. Each table entry is regressed on
   the reading over the draws (Strong et al. 2015 regression EVSI), behind a
   2-s.e. significance gate, and split into 5 bins. Through the draws, this
   conditioning moves every correlated parameter. KG = E[J0] - E[J], with J0 =
   A then the best fixed order. KG(m) uses A's m owed readings, KG(inf) a
   perfect reading, and KG* = max_m KG(m)/m. The table shows them beside the
   old EVPPI.
3. **The information-relaxation bound** (Brown, Smith & Sun 2010, zero
   penalty): the mean over draws of each draw's perfect-information optimum.
   No non-anticipative policy beats it. It is compared with our policies (open
   loop; the recommendation then one re-plan on its reading), charged on
   held-out draws and paired.
4. **Multi-fidelity and model discrepancy** (Peherstorfer et al. 2018;
   Kennedy & O'Hagan 2001; Brynjarsdottir & O'Hagan 2014). The high fidelity
   prices two fixed orders on `--mf-k` draws with direct hackexit calls; the
   surrogate on all draws is the control variate. This yields the surrogate's
   bias. The discrepancy term multiplies an unplayed node's simulated hours
   by `exp(delta_n)`, `delta_n ~ N(0, sd^2)`. Its sd's posterior comes from
   each played run's measured hours against the hours simulated under the g
   model's leave-one-out predictive (half-normal 0.15 prior). The draws use
   `sqrt E[sd^2]`; `--no-disc` turns it off.
5. **A risk report** (Lin, Ren & Zhou 2022). The table gives CVaR(0.9) per
   first move (held-out, with and without the one update, and with
   perfect-information continuations) and for the robust order. A FLAG fires
   when the risk-neutral choice's CVaR exceeds the runner-up's by more than 5h.

Every policy in 2, 3 and 5 is chosen on one half of the draws and charged on
the other (2-fold cross-fitting). An estimate that only looks good on the draws
that chose it is therefore not credited, and a negative KG is reported as
measured.

### Results on 2026-10-03 (BN4.3 in progress, 100 draws, seed 1)

- **Model kept by LOO: `full`.** elpd: full -4.28, exch -6.47 (-2.18 +- 2.35), amc
  -6.83, hand -10.29 (-6.01 +- 5.70). Same winner with half-Cauchy(0.25) on tau
  and with slope prior sd 0.15 or 0.6. The hand latent fails on BN2 (LOO z 3.92).
  The full model explains BN2 mostly through WorldDaemonDifficulty (slope +0.26
  +- 0.12; the others are within 1.2 sd of 0); BN2's z drops to 1.22. Tau is
  0.26 +- 0.19. Six runs and a 2-nat margin: the evidence is real but thin.
- **New unplayed g, p10/p50/p90 (hand -> full):** BN14 .035/.054/.119 ->
  .050/.089/.158; BN13 .041/.063/.138 -> .034/.070/.148; BN11 .031/.049/.107 ->
  .025/.040/.065; BN7 .027/.042/.092 -> .024/.041/.070. BN3, BN5 and BN6 are
  roughly unchanged. Between unplayed nodes the model's correlation is
  0.0-0.2, against the hand latent's 0.5 common factor.
- **What moved.** The mid-world optimum fell 988.3 -> 919.9h (paired). Most of
  that is BN14: BN14.1 drops 59.3 -> 36.7h and is now the 4th clear, not the
  5th. E[T] for BN11.1 first went 913.8 -> 903.2h; these are different draws,
  with a sampling s.e. of about 14h. BN11.1 stays first in every view: P(best)
  45 -> 56%.
- **Discrepancy.** The played runs' LOO residuals sit inside the predictive
  (|r/sqrt v| <= 1.22). The sd posterior is 0.107 mean, p10 0.016, p90 0.221,
  i.e. close to its prior, and the draws use 0.134. On paired draws it moves
  E[T] 904.3 -> 903.2h; the robust order and the first move are unchanged.
- **Surrogate bias** (multi-fidelity, 20 draws re-priced with direct hackexit):
  -0.004 +- 0.036h on the robust order's 913h. That is zero for decision
  purposes, and the robust vs runner-up difference is unchanged (-1.36 -> -1.35h).
- **EXPLORE, before -> after.** Before, EVPPI was g6 0.16h, g7 0.10h, all else
  0. After, it is g7 0.14h and everything else 0. The KG of playing any node next
  is 0 or negative within 2 s.e. (BN11.1 -0.14 +- 0.31, BN14.1 -0.01 +- 0.02).
  The one-update policy matches open loop (913.5 vs 913.4h), and no node is worth
  playing out of order to learn.
- **Information relaxation.** Bound 902.0h against open loop 913.4h: gap 11.4
  +- 0.7h (1.2%). That is over 1h, hence the sketch below.
- **CVaR(0.9).** BN11.1 1191.7h vs BN14.1 1190.4h: +1.3h, under the 5h flag.
  The risk-neutral choice is not worse in the tail.

### Fitted rates, the gang covariate, BN14's in-run readings (2026-10-04, BN14.1 in progress, 100 draws, seed 1)

The reconciliation of 2821627 (offline BN14.1 ~30-34h on the Go route against live 96-278h hack /
~77h blade) blamed three offline inputs. Each, re-examined:

- **exp/s and $/s (rates.mjs).** The constants are replaced by a progress-level model fitted to
  every run since BN2 (history.jsonl, 10-min windows): exp slope b 3.34 +- 0.09 in ln(peak level),
  income 3.57 +- 0.14; node level a_n hierarchical (exp: alpha 11.9, money elasticity 0.28 +- 0.31,
  node spread tau 2.2; income: tau 2.7). Leave-one-out on the finished runs' final windows: every
  |z| <= 2.2, but the predictive sd is ~2.9 in ln (a factor ~18): the transfer of a rate to an
  unplayed node is uncertain to an order of magnitude, and the plan prints it. BN14's final window:
  exp 3.7e8/s (constant: 8.9e8), $6.8e11/s (constant: $3.5e7/s at level 1). **The hours barely
  move**: the exit's level term is logarithmic in exp (BN14 at g 0.0929: 40.2h constant, 40.6h
  fitted). The live 72.9 exp/s and $1273/s at level 98, extrapolated with (level + 50) and no fleet
  growth, ARE material on the same simulation: 65.6h at g 0.093, +25-30h at every g. That is the
  live exit's own extrapolation, not an offline error. Played nodes re-back-out: BN1 0.052 -> 0.0725,
  BN4.2 0.067 -> 0.074, the rest within 3%. `--rates const` reproduces the old numbers (RT3).
- **g (gmodel.mjs `gang`).** With BN2 marked as the native gang node, the WDD slope falls
  0.223 -> 0.130 and BN14's g 0.093 -> 0.073 (fullG). LOO keeps **full** (elpd -3.67; exchG -4.29,
  amcG -4.34, fullG -4.42; all within 1 s.e.), so the draws are unchanged: BN14 g p10/p50/p90
  0.054 / 0.093 / 0.160. Under the old constants the same comparison picked amcG (-3.07 vs -4.28,
  BN14 0.048): six runs cannot separate "WDD" from "BN2's gang", and BN1's re-backed-out g tips it.
  Live's cadence reads g ~0.012/h (exitinputs: x1.346 per 24h): at that g the same simulation gives
  295h. g is the gap, and no BN14 data can read it yet (0 installs; the node is on the Bladeburner
  route, whose lives do not read g).
- **In-run readings (observe.mjs).** BN14.1 adds `xr14` (its exp level at the pooled slope:
  1.08e5, sd 1.07; BN14's level 11.40 +- 2.64 -> 11.56 +- 0.99, final window 3.4e8 -> 3.7e8/s),
  no `ir14` (no spending-free window past level 50 yet), no `g14` (Bladeburner route), and its
  opening (combat 100 at 3.09h, less a simulated gym scale of ~2.7h: 0.39h), which pulls the shared
  `open` 3.13 -> 1.28h. That reading probably holds the gym scale's error for BN14's 0.5 combat
  multipliers as much as an opening.

Results: BN14.1 offline (entry state): go route 36.5h (g 0.098, Hsim 39.4h), Bladeburner 124.9h
(live ~77h blade). Next after BN14.1: **BN11.1** (E[T] 801.3h, P(best) 72%; BN13.1 +2.7 +- 0.4h),
against 802.2h before. BN14.2/14.3 stay 25th/26th (stanek, 20.7h/20.6h; robust order the same).
Hindsight from the entry state: BN14.1 first E[T] 838.2h vs BN11.1 first 833.7h (+4.5 +- 0.5h,
P(best) 1%) on the model's own 36.5h BN14.1; priced at the live ~77h it is ~+45h.

### A Bayes-adaptive outer loop: not built, sketched

The gap between the bound and our best policy is 11.4 +- 0.7h (1.2%). That is
over the 1h line, so a learning policy *could* pay, up to that much. But the
zero-penalty bound credits foresight of everything, including the SF effects
(phi11, eps14, d10, d8, e43, z9) and each unplayed node's own idiosyncrasy.
Nothing can measure those before the decision they would inform. The
measurable part is what the KG table prices: no reading's KG is
distinguishable from 0, and the one-update policy does not beat open loop. So
most of the 11.5h is unlearnable foresight, not missing adaptivity. Raise the
penalty (BSS's tighter bounds) before building anything.

If it is built: **BAMCP with root sampling** (Guez, Silver & Dayan 2013).
- **Belief state.** (SF lattice state, the readings so far). The learnable
  readings are 7 unplayed g's, k, open, and 6 SF-effect parameters that become
  readable once their SF is held: 15 continuous readings. Discretised at K = 5
  levels each, that gives 1.5M lattice states x 6^15 ~ 4.7e11 x 1.5e6 belief
  states. An exact DP is out of reach.
- **Root sampling.** Draw one world per simulation from the posterior at the
  root and never update inside the tree. With the already-built pool of N
  world tables (plan.mjs `tabs`, 1.5MB each), one simulation costs about 28
  table lookups plus a rollout. The rollout follows the conditional-mean-table
  DP (this file's KG continuation).
- **Tree.** Tree nodes are the lattice state plus the bucketed readings, so a
  node's belief is the subset of the pool consistent with its readings. That
  makes this a pool-partitioning decision tree, and the KG table is its depth-1
  case. Tree size is at most simulations x depth (28). About 1e5 simulations
  fit in a few minutes.
- **Prerequisite.** Pool size: the depth-1 KG is already noise-limited at 100
  draws. A tree needs thousands of world tables, at 1.4s and 1.5MB each.

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
- **k has ONE definition** (resolved 2026-10-03): `k = (hours - opening +
  early) / leg`, `leg` = the planner's own (bbsim, the fleet from the join) —
  the quantity the route formula multiplies, and the one this step reads a
  clear with. BN6.1 reads **1.223** ((35.79 - 2.38)/27.32), and that is now
  the base mid (`params.BB_PARAMS.k`: 1.068 / 1.223 / 1.535, the old
  opt/pess spread around it). The old base 0.916 was bbcal6's live leg over
  the leg *as run* (the sleeve fleet 24.8h late): another denominator than
  the one it multiplied, 25% optimistic on every Bladeburner route.
  `nodechoice/bbcal6.mjs` and `nextnode.mjs` print and use the same
  definition. What k holds: everything between the clean simulated leg and
  a live one — operations (sleeves idle after an install, the lean bb-lite
  daemon until a host holds the full one) and model error. The in-game exit
  model's own calibration (`bbplan` rank windows, v2) is the model's error
  alone: it prices the state as it is and measures only the full daemon's
  windows on complete inputs, so it reads ~1 where bladeExit tracks bbsim.

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
| `param` | `w0`, `goP`, `rep14`, `lvl14`, `eps14`, `k`, `open`, `phi11`, `d10`, `d8`, `e43`, `z9`, `g<n>`, or `xr<n>` / `ir<n>` (node n's exp / income level exp(a_n), rates.mjs; log space) |
| `value` | in the parameter's units (w0: raw node power per hour against w0r1d_d43m0n, before GoPower / the SF14 doubling — go.mjs applies the scale; goP: Daedalus power/h / 4391) |
| `sd` | its standard error: in the parameter's units (`space: 'lin'`), or of ln(value) (`space: 'log'`: 0.2 = ~20%). A lin sd is floored at 1% of the prior's p10-p90 width (w0: 14/h), so a "never scored" 0 +- 0 is a reading, not a certainty |
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
