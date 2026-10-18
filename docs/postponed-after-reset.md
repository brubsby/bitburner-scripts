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
2. **Gift value over-assumed.** The stanek route assumes x3 hacking on a 2PB home; BN13
   measured ~x1.5 on 128-512GB with charges wiped every install (~12% exit saving vs 30%).
   Recalibrate stanek.mjs from BN13 observations.
3. **Missing CLEAR_LEGS Go-farm entries** — observe.mjs WITHHELD the k readings for
   BN9.2 and BN7.1. Add them so the posterior learns from those runs.
4. **Re-solve the node order** (plan.mjs) at BN13.1's end with the above fixed; the
   rule is to take the top-ranked node (may no longer be BN9.3; watchdog --next 9 now).

## Live exit model (BN13 findings)
5. **Install actor vs new life disagree** (EXIT JUMP AT INSTALL: 42h priced -> 75h at
   22:08Z) — different builders for the next life's pricing; not the search (f0c87ad).
6. **Aug catalogue frozen at the factions joined now** — later lives can't buy from new
   factions (largest pessimistic gap per the BN13 audit).
7. **Daedalus 30-aug requirement absent from the BN13 exit** (optimistic gap).
8. **eBudget / eRep measure 0 in BN13** — later lives credit nothing for extra money/rep.
9. **Trader model far too optimistic** ($1.5b/12h projected vs ~$2.7m realised).
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
0b. **Exit blocked on home RAM by RESIDENTS (HIGH, before BN10.3's exit)**: BN7.2 (10-16) and BN11.2 (10-18)
    both finished every black op, then endgame.js could not raise to 37.2GB on a 128GB home. The reserve
    (fc777a6) only stops batch.js workers; home was full of residents (stock.js 28.6, ctauto.js 22,
    go-cheat.js 11.1, batch.js 9.8, watchdog 8.9, cmd.js 8.2 ...). Unblocked by hand both times (kill
    ctauto/go-cheat, run endgame.js --next N). Fix: endgame.js must exit whatever home holds — e.g. run
    the destroy from any rooted host with >= 37.2GB free (Singularity works from any host), or have the
    launchers of transient residents (ctauto.js, go-cheat.js) honour /tel/reserve-endgame.txt.
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
