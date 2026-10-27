# Work postponed until the weekly Claude usage resets

Written 2026-10-12 when the usage governor (tools/usage_governor.py) dropped the session
to `minimal` (74% used, projecting 216% at full). When the governor steps the level UP
it points here: work this list at the new level's budget, highest value first, and
strike items as they land (commit hashes). Check `python3 tools/usage_governor.py --status`
before starting each subagent.

## Planning model (highest value: these steer every node)
1. ~~**Cross-node growth prior ignores money multipliers.**~~ DONE 2026-10-14 (route-level g, calib.mjs; README "2026-10-14"): the 11x was the gift double count + route terms on a bare-simulation g, not the money mults (LOO rejects them as covariates). Original note: gameplan's g for unplayed
   nodes came from a shared difficulty factor; BN13 was priced 0.078 ln(M)/h vs 0.007
   measured (~11x, 28h vs 150-500h). Add node money multipliers (ServerMaxMoney x
   ScriptHackMoney, hacknet, crime, FactionWorkRepGain, aug cost) as explicit covariates.
2. ~~**Gift value over-assumed.**~~ DONE 2026-10-23 (giftcal.mjs -> stanekplan.GIFT_CAL: 43 measured gift lives,
   kappa 0.886 on the ln effect + a 0.35h charger start; rms 0.264 -> 0.165; BN13 W 2.10 -> 1.55). Original: The stanek route assumes x3 hacking on a 2PB home; BN13
   measured ~x1.5 on 128-512GB with charges wiped every install (~12% exit saving vs 30%).
   Recalibrate stanek.mjs from BN13 observations.
3. **Missing CLEAR_LEGS Go-farm entries** — observe.mjs WITHHELD the k readings for
   BN9.2 and BN7.1. Add them so the posterior learns from those runs.
4. **Re-solve the node order** (plan.mjs) at BN13.1's end with the above fixed; the
   rule is to take the top-ranked node (may no longer be BN9.3; watchdog --next 9 now).

## Live exit model (BN13 findings)
5. **Install actor vs new life disagree** (EXIT JUMP AT INSTALL: 42h priced -> 75h at
   22:08Z) — different builders for the next life's pricing; not the search (f0c87ad).
   BN8 (2026-10-24): where it bit there, the count route's trajectory priced 1 ticket an install while the
   install comparison searched the composition (same inputs, two exits: 227h published vs ~39h) — fixed
   (countexit.bestCountRoute searches n; routeExitFixed / plan's route spec carry it; NG1). The general
   builder split outside BN8 is still open.
6. **Aug catalogue frozen at the factions joined now** — later lives can't buy from new
   factions (largest pessimistic gap per the BN13 audit).
   BN8 (2026-10-24): the count ladder now carries every unjoined, unbanned faction's augmentations as later-life
   tickets (countModelOf `later`, ticketLadder laterOnly; NG2) — at BN8.2's entry it was EMPTY and the route's
   27 others were padded at its own $2.5m. Still open: the purchase model's catalogue (cadenceOffersNow) is the
   node's joined factions, so a fresh BN8 entry has no life length decision until the first join; outside BN8.
7. **Daedalus 30-aug requirement absent from the BN13 exit** (optimistic gap). 2026-10-23: priced in BN8's own
   model (gameplan bn8.mjs: 30 installed, $100b, hacking 2500); still absent from the general exitplan (BN8 live
   has countplan's count route).
8. **eBudget / eRep measure 0 in BN13** — later lives credit nothing for extra money/rep.
9. **Trader model far too optimistic** ($1.5b/12h projected vs ~$2.7m realised). 2026-10-23: r(W, market age) fitted
   on every ledger market-life (rwage.mjs -> traderw.RW_AGE; -4%/-3% in money over BN8's books vs -81%/-68% for the
   fresh-market prior); used by BN8's exit (exitplan capitalAge, progress.js capitalAgeOverrideOf). Still open:
   every OTHER node's live belief (bayes.traderRwPosterior) has no age (live 2026-10-23: r0 1.51/h, W* $6.5e12 for a
   fresh life against a $5e10 knee at 1h).
10. **Fresh-life income formula still ~x19 high** (opener purchase schedule copied from BN9).
    2026-10-18 (BN10.3, incomecal.mjs): the steady formula (freshlife.steadyIncomeOf) at the
    WHOLE fleet reads ~x13 over the live income because the split holds the fleet on the exp
    farm (pipelines 2.5TB of 52TB); at the pipelines' RAM it is x1.2 (q 0.83-0.87). On the late
    lives of BN10.1/13.1/9.1 the formula is x0.46-0.71 (measured includes the other streams).
    The exit's money legs now price income from the state (exitplan incomeModelOf) — the
    level-scaled extrapolation it replaced was x1e-4 low by the late lives.
11. **OPTIONS OFF BASIS** (grafts row priced on another pass's basis).
12. **Split controller oscillates on flat surfaces** on the hacking route (1208h vs 1210h)
    — hold when the gain is inside the estimate's noise.
13. **HOME UNPRICED** counts "unaffordable by the install" as unpriced — decide whether a
    priced "not yet" should satisfy it.
14. **PLAN MISCALIBRATED** e-process has been failing since 2026-10-04.

## Game play
15a. **Home on the Bladeburner route prices at exactly 0** (BN9.3 2026-10-13: withH = withoutH = 13.20h, buy false at $503m with $34b wealth in the trader's book). The black-op exit model credits no RAM effect, yet RAM gates bladeburner.js (92GB vs bb-lite) and sleeve.js (50GB); and on that route money has no other use, so a tie should buy (with a priced raise from the book). Price the RAM-gated scripts into the blade exit.
15. **Gang wanted penalty** drifting below 0.9 with 5 of 9 on justice (BN13); a watch fires
    below 0.8. Check the justice plan's forecast against the measured drift.
16. **Stanek layout for Bladeburner routes** (fragments are all hacking; no combat layout).
17. **Sleeve throw-fallback** is only source-checked (cec58da) — add an executed test.

17b. DONE 2026-10-16 (route part): `plan.decideBladeRouteGen` takes `mandate` (progress.js
    `covenantMandateOf`): the hacking arm carries exitplan `covenant`, the Bladeburner arm is the black-op
    exit + the mandated hacking trajectory per draw (upper estimate; the lower one and whether it flips are
    published as `decisions.bladeRoute.mandate`); an unpriced mandate leaves both arms unpriced. Tests MC1-MC5
    (tools/test/covenantroute.test.mjs). Still open below: the banked-money and per-sleeve items.
    The stock trader cannot fund the $1e17 (tools/sim/stocks/capacity.mjs): the market's capacity is $6e12 at
    an install; perfect foresight long+short earns $2.6e16 by a 61h-old market, $1.9e17 by 200h; the shipped
    4S trader $1.35e15 by 61h (live calibration: the sim is -62%/bin low at books >= $1e12, BN9.3's aged market).
    Item 9's trader error is the opposite sign at large books: traderw's RW_PRIOR is fitted on 5h fresh
    markets (W* = $1e12), and an aged market's capacity is 2-60x that — r(W) needs market age as an input.
17b-orig. **BN10.3 live route must know about the Covenant purchase** (1247ba4/5858261): gameplan plays the
    buying BN10.3 as a ~48h hacking+Stanek clear; the live route pricer doesn't know about the $1e17 mandate,
    so if it picks Bladeburner there, endgame.js holds the exit until the money arrives, possibly for a long time.
    Also: the leg ignores the final window's banked money (~1h long); the per-sleeve base value re-derives
    6.6e-3 vs the committed 7.2e-3; gameplan RT4 (income calibration vs BN8/14/9) fails, unverified whether that predates this work.

17c. **Server spend ignores Stanek's charge host** (2026-10-17, before BN10.3): installgate spendExit.servers prices
    cloud servers for batching only. highestCharge = one charge call's threads on ONE host, the effect ~ ln(threads)/60,
    so one big server (BN10: x5 cost, 15 max, 512TB cap) lifts each fragment's term ~0.088 -> ~0.21. Price
    "buy the big charge host" vs not as trajectories with the gift's gain included, for BN10.3's hacking + gift lives.

## Go
18. **Opening books for hard layouts** — subagent was running at the cut; deploy/verify
    its result.
19. Open loss classes: Illuminati hard-board pair cheats (14:40/15:21 10-11), opening
    strength on hard layouts (14:46 10-11, 04:17/04:24 10-12, 07:13 10-12), Daedalus
    stale ponder residual (01:25 10-12), Daedalus 17:16 unclassified, SlumSnakes 03:05
    unreproduced, Daedalus 12:29 10-12 (record in scratchpad go-loss-batch.txt).
20. **Netburners ponderDepth** measured -3.9% (too slow at 200ms) — a cheaper variant?
21. **Pass the 4-aug Illuminati question to the picker**: posterior already tracks it; consider
    a crime-conditioned prior for node entry.

## Tooling
0. ~~**Game socket auto-reconnect**~~ DONE 2026-10-17: live test — `systemctl --user restart bitburner-daemon` at 13:05:20Z, rfalink reconnected in ~5s (reconnects 1), no hand reconnect. (high priority for unattended play): the daemon is now the
   systemd service `bitburner-daemon` (077a2ee), but after any service restart the game's RFA
   socket sits at "Reconnecting" until someone calls newRemoteFileApiConnection() from the page.
   Make the game reconnect itself (an in-game watcher, e.g. rfalink.js, retrying via the module).
   **2026-10-13 finding:** rfalink.js already does exactly this (245cc6b; watchdog job, retries
   every 60s) and is running, `/tel/rfalink.txt` Online, reconnects 0. The daemon log shows one
   connect (10-12 18:29) and no restart since, so the reconnect-after-restart path is UNTESTED live.
   Remaining work: one deliberate `systemctl --user restart bitburner-daemon` (needs the user's ok)
   and confirm reconnects -> 1 within ~70s without a hand reconnect.
0b. ~~**Exit blocked on home RAM by RESIDENTS**~~ DONE fd7f74f (watchdog evicts ctauto/go-cheat while the reserve stands; untested live until the next exit): BN7.2 (10-16) and BN11.2 (10-18)
    both finished every black op, then endgame.js could not raise to 37.2GB on a 128GB home. The reserve
    (fc777a6) only stops batch.js workers; home was full of residents (stock.js 28.6, ctauto.js 22,
    go-cheat.js 11.1, batch.js 9.8, watchdog 8.9, cmd.js 8.2 ...). Unblocked by hand both times (kill
    ctauto/go-cheat, run endgame.js --next N). Fix: endgame.js must exit whatever home holds — e.g. run
    the destroy from any rooted host with >= 37.2GB free (Singularity works from any host), or have the
    launchers of transient residents (ctauto.js, go-cheat.js) honour /tel/reserve-endgame.txt.
0c. ~~**NO INSTALL false positive in a saving final window**~~ DONE 2026-10-24 (lifehealth.noInstallVerdict, LH5): no install
    planned (The Red Pill installed, the committed install 'never', the gate's holdForever or Covenant saving, this life) is a note;
    EXIT NOT APPROACHING watches it. Original: (2026-10-19 BN10.3): fired at 0.7h into the
    final life ("3x the 0.2h window") while cash grew $7e13 -> $7e14 in 20 min toward the $1e17 Covenant
    sleeve. The check should read the plan's final-window money leg (no install planned) instead of the window.
0d. ~~**EXIT NOT APPROACHING spans a node change**~~ DONE 2026-10-24 (lifehealth.exitHistOf, LH4): samples carry lastNodeReset,
    the life and the exit's basis (blade/hack); the history resets at the node's entry and at an install that changes the basis.
    PLANNER IDLE / NO RANK PROGRESS are windowed on the newest sample N min old (LH6/LH7: they never fired at a 15-min cadence). Original: (2026-10-21 17:11Z): compared BN3.1's last exit (4.3h) with BN3.2's
    first (10.3h) 0.5h after the entry and fired. The window must reset at lastNodeReset (and at installs if the
    model's basis changes).
0e. ~~**Body slot lent to crime/faction work after the Bladeburner join costs time**~~ DONE 2026-10-24 (bbplan.bladeLendGen,
    decisions.bladeRoute.lend, BL1-BL5): with the Simulacrum the lend displaces the class beside the actions (a due graft goes first);
    priced as the black-op exit with the money crime in the slot (its exp, its money into the graft schedule) vs the class (its fee out),
    paired members, lent only past -0.02h and 2 se. BN7.3 fixture: the whole slot +0.17 +- 0.07h, 29% +0.00 +- 0.06h (class keeps it).
    Faction work is never a priced lend (its rep pays only at an install). Original: (bbboot.mjs, f49e76b):
    in bbsim the 29% post-join lend measured +0.19h BN5.2, +0.63h BN13.3 (−0.03h BN2.2). progress.js owns the
    slot policy; price the lend as a trajectory on the Bladeburner exit rather than assuming it free.
0g. **BN8: the live exit's growth is not the trader's money** (bn8 calibration 2026-10-23, the dry run of
    exitplan.bestExitPolicy at BN8.2's start with live-shaped inputs): ~118h, 37 installs of 2.7h ("install cycles
    100.7h") against bn8.mjs's 30-32h — the per-life gain is the cadence posterior (BN8.1's 1.0376 a 2.72h life) and
    lifeplan's purchase model buys rep by work only ("NOT MODELLED: donations"), where in BN8 (FavorToDonate 0)
    every rep point is money. Make lifeplan.lifeBatch donate the rep shortfall at $1e6/faction_rep where the
    threshold is 0, and price freshLifeMoney on a fresh market (capitalAge age 0). Risk: BN8.1's one-aug lives.
    DONE 2026-10-24 (tools/sim/gameplan/bn8live.mjs, tests LD1-LD5): lifeBatch donates wherever a faction is at
    the threshold (progress.js repDonate); the count exit (the plan's BN8 trajectory) paid each faction's rep per
    ticket at 1.9^j, took the purchase shape on its ticket lives and budgeted on today's market — fixed. BN8.2's
    entry on the dry-run's inputs: 80.7h on 9 installs -> 38.6h on 3 (gameplan 31.7h never / 30.4h gift).
    Left: with nothing installed the life length decision prices basis null without the count (9.5h).
    DONE 2026-10-24 (NG5): with no install committed, the life length, 4S and graft decisions price the committed
    count route (countRouteBasisOf: /tel/countroute.txt carries the route, its composition and life length).
    Same commit: the 4S decision on BN8's trader (RW_AGE 4S x RW_BN8, NG4; 4S also enters the count lives'
    budgets), home RAM bought at installs moves BN8's trader (NG3; bn8live 39.2h -> 30.5h vs gameplan 31.7h),
    the Daedalus IPvGO farm prices the final window's donation (NG6) and go.js plays BN8's farm per phase off
    bn8.mjs goWeightsTable (goplan.STOCK_GO_WEIGHTS, B85, NG7). BN8.2 entry dry-run published exit 227h -> 49.8h
    mean (q50 31.1h).
0h. **Stale source guards red at HEAD** (2026-10-23): bn8.test B8w flags `readJson(ns, STATUS)` (a read) as a
    writer; B8af's regex wants `placeTrader(ns, all, hosts)` (seed.js passes liteHold). Both FAIL at b60e48e, so a
    real regression in either would be masked. Also planperf PP3/PP3c CPU guards (1217ms vs 800ms, loaded machine).
0f. ~~**BR3 CPU budget**~~ PASSES unloaded (2026-10-24 05:27Z) — failed once at 1248ms vs 1200ms right after f49e76b (machine loaded by 4 agents) —
    re-run alone; if it holds, slice the bootstrap pricing step.
0h. **Exit inputs drift between passes** (c249a8f's author): the hack arm moved 14.3h -> 18.2h one pass after a
    blade accept in BN5.2 — eRep 0.11 -> 0 and the income formula evaluated at a different age (1.67h vs 2.08h).
    exitInputsOf should give the same inputs for the same state.
    DONE 2026-10-24 (tests ID1-ID6; dry-run INPUT DRIFT): eRep / eBudget were read off the install gate — the last
    pass's record, at a node's first pass the last node's (BN13's 0.6293 / 0.2476; the entry pass itself measured
    0 / 0) — now this pass's measurement (passElasticityOf); installGainsOf's grow exponent was the gate's growShare
    (now batcherCalOf, this pass); the hacknet model carried hacknet.js's multipliers from its last run (lagged the
    accept a pass; now the player's). The income formula's age is NOT drift: formulaRatePrior reads the formula at
    max(age, its first-income hour), and Genesis's x0.9 (Augmentations.ts:1593-1617) moves that hour (1.67h -> 2.08h).
    BN5.2 hack arm across entry/again/accepted/joined: 8.02 / 18.51 / 18.15 / 18.15h -> 18.51 / 18.51 / 18.16 / 18.15h.
    Left (0i): the blade arm's re-price after the accept (BN2.2 11.6h -> 13.2h) is the gift's pricing, not the inputs.
0i. ~~**Stanek allocation f is still priced on the fleet held at entry**~~ DONE 2026-10-24: decisions.stanek prices
    every f on the route arms' charger (hackGiftInputsOf on chainHackChargerOf), one grid with the chain; BN5.2's
    accepted state replayed: f 0.1 -> 0.3, the chain's (SG26).
0j. **BN15 leftovers** (4e2a70e): stock.js buys 4S on the hack-priced decision while BN15 plays the black ops;
    the hack arm swung 26h -> 5.7h after the accept (published only); CLAUDE.md's BN15 figure (104.5/113h) is stale;
    the in-game exit model declines the gift in BN15 (155.9 vs 154.2h, noisy: a member 125 -> 225h) while the
    game-class sim says the gift saves ~11h — decide on the sim before BN15's entry.
22. **An alert path that doesn't need the session** (autogtnh has a chat sentinel + phone
    push): healthcheck -> notification while the session is out of usage.
23. **PP3c timing budget** was raised to 0.9 of 1.2s (f0c87ad) — review.

## autogtnh (postponed 2026-10-17 17:05 UTC, governor off; keep-working cron 71e65050 deleted, re-create it on step-up)
1. **MA corridor-wall module**: waits on the user's site answer (Desk `ma-module-site`); then the steel/Black Steel/EV
   circuit input prep (agent stopped at start), dev rehearsal, build (robot #1 best; #4/#5 lack geolyzer/Angel).
2. **Steam black-start step B**: mint Drain Module + Shutter Module patterns, use 16x Silver/Blue Alloy cable, move the
   dock charger 160,65,48 enable onto the AE-alive signal first (autogtnh STATUS top, 4c84105).
3. **Own-infra Desk phase 2** (in-game OC desk screen); tailscale serve stays off (user: "Not yet").
4. Agents still running at the cut may have left follow-ups: Empty Cell priority + press channel, rocket kit,
   spawn-egg answer (relay to the Desk `spawner-souls`), base Fishing Port gate, cane soil swap. Read their reports.

## autogtnh Solar Factory T1 (postponed 2026-10-19 ~17:00 UTC, governor off)
Plan done (autogtnh docs/research/solar-factory.md section 7, plan `sf-t1-p1m1`, site + AE what-if OK). On step-up:
mint/craft the chains (20 Damascus frames via EV mixer + EBF + extruder + assembler; controller; panel chain; 2
Industrial Diamonds via Coal Chunk + 4 Dynamite), dev-rehearse (structure, G2 P2P -> EV hatch, Dual Interface + pipe
split), then robot #1: under-deck trunk, `multiblock build`, port bus + P2P paste, verify, patterns, test craft.

## ~~factorio-balancer-sat head-to-head vs Raynquist, TU+IB~~ DONE 2026-10-27 (factorio-balancer-sat 9115124, 45146e5)
Run from the laptop session over SSH (agent A). docs/h2h-tuib.md, tools/h2htuib/, library source brubsby-h2h-tuib
(38 designs, all traced back, splnet TU + IB01, exhaustive game sweeps on shards 2700+, 0 failing rows); balancerdb
re-imported. Strict wins: 2-4 and 4-2 TU at 6x4 with 5 splitters (his 6); 4-4 corner in the any table. New drop-in
frontier points for 14 shapes; 1-4 / 4-1 proven Pareto-optimal; 3-4 / 4-3 / 3-3 / 4-4 need his k (no TU+IB net
with fewer splitters). Still open: 6-1 / 7-1 (his footprint unreachable in the model), 2-8 (k=9 enum z3 unknown),
3-6, 6-3, 4-6, 6-4, 4-8, 8-4, 8-8 (cells time out near his length), 4-4 merge / split geometries.
