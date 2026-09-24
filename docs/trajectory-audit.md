# Trajectory audit: decisions still priced by shortcut

2026-09-24. The rule is in CLAUDE.md, "Decisions compare simulated
trajectories — never a shortcut". This is the list of decisions that still
break it. It came from a read-only sweep; nothing here has been re-priced yet
unless it is marked done. Ranked by how much money or time the decision moves.

## Already correct (templates)

- `progress.js covenantExitOf`: `bestExitPolicy({...inputs(), covenant})` vs
  base, on `exitInputsOf`. Cross-node value is published as not simulated.
- `progress.js sleeveAugExitOf`: same shape, and it spends the price and
  re-plans the pending augs (**done 2026-09-24**, was sleeveplan
  `sleeveAugBatch`).
- `gangworth.js gangGainHours`: exit with and without gang income.
- `nodeplan.js workSlotCost`: exit with the slot on rep vs crime, iterated to
  a fixed point.
- `graftplan.js chooseGrafts`: re-prices the exit per graft set.

## Still shortcuts

| # | Decision | Where | Shortcut | Simulator gap |
|---|---|---|---|---|
| 1 | install now vs hold | installgate.js:415,481 | `ln(M)/A` vs `ln(M_future)/(A+wait)` | first-install time plus its gain |
| 2 | budget split: home / fleet / hacknet / augs / join | budget.js:137,147,230; objective.js:664 `homeLn`; progress.js `budgetClaim` | payback vs `income x horizon`; `ln(m)/price` | income as a function of home RAM; cycle length responding to spend |
| 3 | work slot: crime vs faction | progress.js ~2602 | `moneyLn(crime $/h)` vs schedule ln/h | mostly there (`nodeplan.workSlotCost`) |
| 4 | which faction to work | factionplan.js:205 | greedy `acc/hoursAll` | per-cycle mult gain as a function of the schedule |
| 5 | gang worth its karma gate | gangworth.js:160 | gain from t=0 minus the grind as flat hours; income-scale fallback | delayed income step; work-slot hours outside the final window |
| 6 | combat augs to shorten the karma grind | objective.js:572 | `moneyLn(gangIncome x saved)` | as #5 |
| 7 | hacknet | hacknetplan.js:157,170; hacknet.js:211 | `payback < remainingH` | in-life income steps |
| 9 | sleeve task: sync / shock / train-vs-work / objective ladder | sleeveplan.js:130,297,310,459; progress.js ladder | break-even `100/rate`; `afterRate x (H-T)`; fixed ordering | `sleeveExp {perSec, delayH}`; the ladder is expressible now through `planFleet` |
| 10 | charisma / company path | objective.js:140 | rate x horizon | no company-path leg |
| 11 | NFG donation-threshold crossing | progress.js ~672 | one window's income in NFG levels | donation only modelled for the exit faction |
| 12 | gang equipment | gang.js:296 | gang sim with/without, but scored by `moneyLn` over a gang horizon | score through the exit instead |
| 13 | stock entry | stockplan.js:125 | `capital x edge x H > entry` | dormant (`edgePerHour: null`) |

Underneath the list: `objective.deriveWeights` is `N x elasticity`
(remaining windows x a measured elasticity), which is rate x horizon. Every
aug-plan ranking and every `moneyLn` conversion inherits it.

## Extensions to exitplan that unlock most of it

1. First-install time with its `nextInstallGain` (#1).
2. Time-stepped income `incomeSteps: [{atH, perSec}]`: gang, hacknet, home
   RAM, servers (#2, #5, #6, #7).
3. `sleeveExp {perSec, delayH}` (#9).
4. A generic upfront spend debited in any window (every purchase).
5. `multGainPerCycle` as a function of rep and spend (#3, #4).
