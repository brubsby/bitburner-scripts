# Work postponed until the weekly Claude usage resets

Written 2026-10-12 when the usage governor (tools/usage_governor.py) dropped the session
to `minimal` (74% used, projecting 216% at full). When the governor steps the level UP
it points here: work this list at the new level's budget, highest value first, and
strike items as they land (commit hashes). Check `python3 tools/usage_governor.py --status`
before starting each subagent.

## Planning model (highest value: these steer every node)
1. **Cross-node growth prior ignores money multipliers.** gameplan's g for unplayed
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
11. **OPTIONS OFF BASIS** (grafts row priced on another pass's basis).
12. **Split controller oscillates on flat surfaces** on the hacking route (1208h vs 1210h)
    — hold when the gain is inside the estimate's noise.
13. **HOME UNPRICED** counts "unaffordable by the install" as unpriced — decide whether a
    priced "not yet" should satisfy it.
14. **PLAN MISCALIBRATED** e-process has been failing since 2026-10-04.

## Game play
15. **Gang wanted penalty** drifting below 0.9 with 5 of 9 on justice (BN13); a watch fires
    below 0.8. Check the justice plan's forecast against the measured drift.
16. **Stanek layout for Bladeburner routes** (fragments are all hacking; no combat layout).
17. **Sleeve throw-fallback** is only source-checked (cec58da) — add an executed test.

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
22. **An alert path that doesn't need the session** (autogtnh has a chat sentinel + phone
    push): healthcheck -> notification while the session is out of usage.
23. **PP3c timing budget** was raised to 0.9 of 1.2s (f0c87ad) — review.
