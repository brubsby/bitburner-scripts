# BitNode 6 — day-one runbook (Bladeburner)

Nothing below has run against a live Bladeburner yet. BN6 is the calibration:
every number the plan uses for the Bladeburner route is **simulated**, and the
first hours exist to compare those numbers with what the game shows.

## What runs, and who owns what

| piece | file | what it does |
| --- | --- | --- |
| formulas, policy, exit model | `bbplan.js` (pure) | success chance, time, rank, stamina, skills ([BB1-BB9] check every formula against the game's classes); `chooseAction`, `planSkills`, `bladeExit` |
| the daemon | `bladeburner.js` (boot tier 128, `anywhere`, 3.25GB declared, raised to 92.75GB) | joins at combat 100, joins the faction at rank 25, buys skills, picks city/action/level, acts **only while `slot.owner === 'bladeburner'`**, publishes `/tel/bladeburner.txt`. Never destroys anything. |
| the lean daemon | `bb-lite.js` (boot tier 32, `anywhere`, 5.6GB; watched) + one-shot actors `bb-lite-{join,read,act,skill,level}.js` (9.6-14.6GB) | the division from combat 100 at any home size: joins, acts by `bbplan.chooseAction` under `LITE_POLICY` (pinTop: autolevel, one city), skills hourly; publishes `/tel/bb-lite.txt` and `/tel/bladeburner.txt` (`daemon: 'bb-lite'`); stands down for bladeburner.js (the handover below) |
| the route decision | `plan.decideBladeRouteGen`, `progress.js bladeRouteOf` | `decisions.bladeRoute` in `/tel/plan.txt`: `hack` vs `blade`, both exits (`hackH`, `bladeH`) on the same draws |
| the slot | `progress.js` | on `blade`: gym to combat 100 as a body leg (`slot.owner 'body'`, `bodyLeg.forFaction 'Bladeburners'`), then `slot.owner 'bladeburner'`; no new grafts; desk/crime/faction work yield |
| sleeves | `sleeveplan.bladeFleetGen`, `sleeve.js` | on `blade` and joined: infiltrate / support / field-analysis mix priced as exits; `/tel/sleeve.txt` `blade` |
| the exit | `endgame.js` | reads `getNextBlackOp() === null` from the game **before** the World Daemon; leaves through the same `leave()` as the hacking route (`/endgame-hold.txt`, Covenant mandate, `--next`) |
| health | `tools/bbhealth.mjs` via `tools/healthcheck.mjs` | BLADEBURNER SILENT, ORDER NOT HELD, NO RANK PROGRESS, STAMINA STUCK, ACTION FAILING, MODEL OFF, EXIT READY NOT TAKEN |

## Before the flume (still in BN9)

1. Deploy (`curl -s localhost:12526/sync`, then `npm run verify`). Nothing changes in BN9: every Bladeburner path is gated on `canJoinBladeburner` and returns at the floor.
2. **The watchdog's endgame is `--next 6`.** Once in BN6 that same `--next 6` would *re-enter BN6* the moment the 21st black op is done. Decide the node after BN6 before then, or put `/endgame-hold.txt` in place at BN6 entry (healthcheck reports a held exit as a note, not a failure).

## First hour in BN6

Run `curl -s localhost:12526/status` (connected: true) before believing any telemetry.

1. **Boot.** `boot.js` runs from the destroy callback. Below 128GB home, `bladeburner.js` is deferred (`/tel/boot.txt`) and healthcheck notes it. At 128GB it needs a host with **92.75GB free**; `boot: FAILED bladeburner.js: planned 92.75GB but no host had it free` means buy/grow a server and `run boot.js` again (homeup.js re-runs boot on every home upgrade).
2. **The route.** `/tel/plan.txt` → `decisions.bladeRoute`: `key`, `hackH`, `bladeH`, `why`, `options[]`. At entry the hacking arm is usually still degenerate (no income yet), so expect `blade`. Re-check once income is measured: the simulated BN6 numbers below say `blade` in every economy except a BN2-like one with combat-aug growth credited to neither arm.
3. **The slot.** `/tel/progress.txt` `slot.owner`: `body` while the gym trains combat to 100 (fees need cash — the body leg says so in `todo` when it cannot pay), then `bladeburner`. The save digest's `currentWork` must be **null** while it is `bladeburner` (faction work cancels a Bladeburner action every tick).
4. **The daemon.** `/tel/bladeburner.txt`:
   - `result`: `not-joined` → `acting`/`started`; `joined: true`; `factionJoined` once rank ≥ 25.
   - `slot.ours: true`, `running` = the action, `action.why`.
   - `rank`, `rankPerHour` (measured over the last hour of samples).
   - **`calibration`**: `timeFormulaS` must equal `timeGameS` (healthcheck MODEL OFF fails otherwise); `maxStaminaFormula` vs `maxStaminaGame`.
   - **`outcomes`**: `observed` vs `expected` success over the last 20 attempts (ACTION FAILING below half).
   - `env.contracts` / `env.operations`: the ENV recovered from the API's low-end chance.
   - `purchases`: skills bought and why.
5. **Sleeves.** `/tel/sleeve.txt` → `blade.config` (infiltrate/support/fa), `blade.hours`, `blade.byConfig`, `blade.cpuMs`; `assigned[].task` reads `INFILTRATE` / `BLADEBURNER` / `SUPPORT`; `refusals` empty. Until the player is in the division the fleet keeps its ordinary plan (`blade.on: false` with the reason).
6. **Health.** `node tools/healthcheck.mjs` (Bladeburner notes and failures), then keep `bash tools/watch-run.sh 900 12 baseline` running.

## Calibrating (hours 1-6)

The plan's blade arm is `bbplan.bladeExit`; it has never seen a live division.

- Published exit: with `bladeRoute.key === 'blade'`, `/tel/plan.txt` `exit` IS the Bladeburner route (`source: the Bladeburner route …`), so healthcheck's **EXIT NOT APPROACHING** watches it. It should fall about an hour per hour.
- Compare `rankPerHour` with the model's trajectory: `tools/sim/bb6.mjs` prints the model against the game's classes; a live rank rate far off the model's at the same skills/stats is the first calibration number.
- `outcomes.observed` vs `expected` is the success model's check; `calibration` the time and stamina formulas'.
- Write what you measure into `docs/pricing-gaps.md` (the table for calibration probes).

## Simulated BN6 exit, by route (none of it measured)

From `TELEMETRY=… node tools/sim/bb6.mjs --seeds 9` (2026-09-30), hours from entry, our stack (SF1.3 2.1 4.2 5.1 8.1 9.1 10.1), 5 sleeves:

| economy (hacking-multiplier growth g, measured nodes) | hacking route (World Daemon at 6000) | Bladeburner, pessimistic (no combat augs; installs every 2.63h reset exp) | Bladeburner, optimistic (combat multiplier grows at the node's g) |
| --- | --- | --- | --- |
| lo, g 0.041/h (BN8-like) | 71.6h | 35.5h [31.5-38.2] | 24.5h |
| mid, g 0.063/h | 46.9h | 35.5h [31.5-38.2] | 22.4h [22.1-22.8] |
| hi, g 0.138/h (BN2-like) | 21.4h | 35.5h [31.5-38.2] | 17.2h [16.8-17.3] |

- Bladeburner hours are the game's own classes (`tools/sim/nodechoice/bbsim.mjs`) running the daemon's policy (`bbplan.chooseAction/planSkills`), median [IQR] of 9 seeds; the hacking hours are `exitplan.bestExitPolicy` from a fresh BN6 entry (`hackexit.mjs`).
- Pessimistic Bladeburner beats the hacking route in the lo and mid economies; in a BN2-like economy only the optimistic bound does. The plan decides between them on live inputs (`decisions.bladeRoute`), with the blade arm at the pessimistic combat growth.
- Both routes assume money never binds and start at the gym with the opening already paid: the real opening adds its hours to both.
- The in-game model (`bbplan.bladeExit`) against those game-physics medians: -2% (no installs), +15% (installs), +13% / +6% (optimistic). It runs slow, so the plan's comparison leans toward the hacking route.
- The policy thresholds hardly matter (33.0-35.8h over a 4x4 grid). The sleeves matter some: the model's pick (1 infiltrate, 4 field analysis) came in at 30.3h against 31.8h for all-infiltrate in game physics (3 seeds).

## Installs on the Bladeburner route

Live 2026-10-01 the route committed `blade` (~29h) while the install decision still priced the World Daemon exit (`now` 186h vs its commitment 237h: TWO EXITS AT INSTALL; gate `exitH` 133h; the 10:17Z install priced at 155.8h, its next life published 29.2h: EXIT JUMP). Now, with `decisions.bladeRoute.key === 'blade'`:

- **Every install option is the black-op exit** (`progress.js bladeInstallCompareOf`): `now` (the batch bought now with the queue), each future's batch, and `never`, each one `bbplan.bladeExit` of that install from the route's own start (`pc.bladeCtx.startFor`). `decisions.install.route` reads `blade`; its noise keys are `bladeburner|at:<minute>` / `bladeburner`.
- **What an install does there** (game source): rank, skills, skill points, black ops done and the stamina bonus persist (`Prestige.ts:152-155`, `Bladeburner.ts:260-264` — no re-join, no combat-100 bar); every exp and stat resets, so the policy retrains combat at the gym (the model retrains at the start of a life that begins below the bar, and after each install); the batch's combat level/exp and `bladeburner_*` multipliers move the success chance and stamina (`bbplan.bladeContentOf`); The Blade's Simulacrum runs the gym beside the actions. Not modelled: money after the reset (the retrain's fees) — optimistic for an install.
- **One exit**: the route's blade arm is priced on the committed install plan (one install at its time, or none — never the hacking cadence), on the same noise key, so `plan.txt exit`, the gate's `exitH` (the decision's q50) and the install actor's exit (`exitNowH`, the blade `now`) are one trajectory. A hack-priced record is not the blade decision's incumbent (it re-decides). The gate (`installgate.shouldInstall` with `bladeRoute`) obeys that decision; the Daedalus count and the hacking `M` do not hold it.
- On the live 11:07Z state (NeuroFlux-only batch, x1.03 combat): `never` 25.7h, `now` 26.1h, waits 26.6-27.5h — the plan holds (an install only resets combat). A batch doubling combat would install at once (14.6h). `tools/test/bladeinstall.test.mjs` [BI1-BI7].
- **The Blade's Simulacrum** (`decisions.bladeRoute.simulacrum`, `bbplan.simulacrumVerdictGen`): priced on the exit — reach (money and Bladeburners reputation at the measured rates), the exit installing it at the reach, and the no-cost bound. Live: $150b at ~$31m/h is ~4,800h away (reputation ~16h at 2 x faction_rep x favour per rank); installed now at no cost it would save ~3.1h of ~25.7h. Ordered only when the verdict buys and both are there now.
- **The slot handoff**: `bladeburner.js` re-reads the claim immediately before `startAction` (which ends the player's work first, `Bladeburner.ts:179`) and treats an order batch newer than the claim that starts work as a handoff, not a claim. `act.js` re-issues the owner's last work order when the game shows no work (`actplan.reissueWorkOf`, `/tel/act.txt reissue`): the 10:27Z defense gym was gone 30s after it started and nothing ran until the 10:32Z batch.

## The first live calibration (2026-10-01)

`tools/sim/bbcal.mjs` replays it; `tools/test/bladecal.test.mjs` [BC1-BC11] holds it (fixture `tools/test/fixture-bn6-bladecal-1322.json`).

- **The success formula is the game's.** At 13:22Z the formula gave Operation Typhoon 0.03696; the game showed [0.0363, 0.0370]. Retirement L10 at Chongqing's TRUE population: 0.566 predicted, 21/36 (12:40-13:23Z) and 81/135 (lifetime) realised. Success posterior on that window: k 1.03 x/÷ 1.06.
- **The populations were estimates.** `getCityEstimatedPopulation` is the estimate. The game rolls on the true population, and the exit model priced the estimate. One end of every range the API shows is the chance at the estimate. A black op has no city term, so its range is [p·r, p] or [p, p·r], with r = pop/popEst (`bbplan.popRatioFromRange`). The daemon now reads r in all six cities every pass and decides on the REAL chance. It used to decide on the low end, which was 46% of the real chance while Chongqing's estimate read 1.72e9 against ~1.16e9. Field Analysis is now only for an unreadable range. Volhaven's true 1.42e9 (estimate 1.03e9) is the best city.
- **The drift, attributed (11:07 -> 13:22Z, the model as shipped, one input group at a time):** the cities' estimates +2.96h (Field Analysis corrected Chongqing 1.72e9 -> 1.18e9 and New Tokyo 1.38e9 -> 1.16e9; New Tokyo is truly 0.80e9), maxLevels +0.89h (successes reset to 0 in the model), rank -0.17h, the player's stats -2.15h. Net +0.92h over 2.25h of wall time, against the -2.25h a held plan expects. The 12:17 -> 12:22Z +1.92h step left the no-install Simulacrum bound flat (21.73 -> 21.67h), so it was not in rank, counts or levels. The model's response to a city estimate is discontinuous: on the 13:22 state one estimate 1.30e9 -> 1.18e9 moves the exit +1.8h. On the true populations an estimate correction moves nothing.
- **The fleet nobody ran.** sleeve.js priced every Bladeburner fleet with installs every `cycleHours` (8-12h). None finished in 400h, so the sleeves kept their ordinary plan (Homicide, later Recovery). progress.js then priced five infiltrators. The published exit was 26.6h; the sleeves as they ran give 42.7h. Now the route prices `bbplan.bladeFleetOf` (the committed config, else the tasks as assigned), and sleeve.js prices on the route's own install basis (`bladeInstallOfBasis`).
- **The rank calibration ratio** (realised gain / model gain from 13:22Z, 8.8h, 162 -> 1028): the shipped model as published (popEst, five infiltrators) 1.21; the shipped model on the sleeves as run 1.02. By hour on the as-run start: 0.96, 1.11, 1.18, 1.29, 1.29, 1.31, 1.16, 1.07, 1.02. The plan now keeps this as a posterior (`decisions.bladeRoute.calibration.rank`): hour windows of the model's own path, prior k = 1 x/÷ 1.47, weighted by hours. It applies k to the exit (rankScale).
- **Stamina is a state.** The start is banked or owed rest at the chamber's rate (passive 1.39/min + chamber 0.67/min = the logs' 2.06/min); the steps keep the duty cycle.
- **Policy fixes:**
  - The action is chosen per wall second, at its stamina duty: the player acts ~42% of the time.
  - Cyber's Edge is priced. The daemon's skill view had `maxStaminaBase: false`, so no stamina skill ever moved its objective, and Cyber's Edge sat at 0.
  - Skill points are saved for the best value per point.
  - The daemon spends skill points hourly, as the model simulates (`POLICY.skillEveryS`). It used to spend every minute. Game physics, seed 1 from BN6 entry: spending every 60s takes 39.1h, every 600s 34.3h, hourly 28.1h (`tools/sim/bbskillcadence.mjs`).
  - Resting stays in the chamber: Field Analysis instead pays less per stamina-bound second, (R > f·(1 + D/h): 0.029 vs 0.023 rank/s live).
- Healthcheck MODEL OFF (success) fires at 200+ attempts, |ln k| > 0.3 and 3 sd. The plan applies the posterior k to every Bladeburner exit (`successScale`).
- **Measured outcomes.** The old rule ("the rank moved by half a success") read a read spanning several completions as one success. It published 20/20 while the game counted 45/61. Now attempts come from the worked action's count against its growth twin, and successes from the rank (`attemptsOf`).
- **The population read, checked on the game's own classes** (bbdaemon [BD5]). Every read population equals the true one (worst 0.1%). The measured success k is 0.98-1.08. That came after two fixes:
  - The side of the range now comes from a city-dependent action's own range (`popRatioFromRanges`), not the formula's chance, which inverted r. The harness read k 1.1-2.5, e.g. 400/400 at 0.59 predicted.
  - Attempts are kept out of the calibration where the estimate clamped (ENV a lower bound).
- **Events (EXIT UNSTABLE):**
  - These are events: the fleet changing, a black op, a random event in the best city (true population > 4%), a calibration update.
  - These are not events: an estimate correction, and the model's own drift.

## The 10:10Z install (2026-10-02): EXIT JUMP, and the fleet that was never priced

The install priced the next life at 18.65h. The new life published 3.41h at 0.13h (EXIT JUMP AT INSTALL, -15.1h), 3.48h, then 13.39h and 14.35h (EXIT UNSTABLE, held, no event). `tools/sim/exitjump/attribute-bn6-1010.mjs` replays each pass from the fixture `tools/test/fixture-bn6-exitjump-1010.json`, within 1% for 10:18-10:33Z. It then swaps the install's own projection of the new life with the actual inputs, one group at a time. `tools/test/bladejump.test.mjs` [BJ1-BJ9] holds it.

- **The fleet was the jump: -13.2h.** Every other group moved the exit by less than 0.4h: the retrain, stamina, the posteriors, the cities, the skills, the multipliers, rank, counts, and the install basis. sleeve.js built its person with no city and no money. `bestGym` therefore returned null, and so did the gym rate. With an install in the route's basis, the exit model priced every fleet as unfinishable: the retrain cost Infinity. With no install, the retrain below the bar came free. So sleeve.js committed infiltrators only in the new life's first passes, which had no blade-priced install yet (10:18-10:23Z, 4-5 infiltrate, ~3.4h). Everywhere else the sleeves stayed at the gym (~14-18h). Five infiltrators are worth ~13h here. Assassination and Stealth Retirement at level 22 are capped by their counts, and infiltration adds sqrt(n)/2 to every count each minute.
- **Fixes.**
  - sleeve.js prices on the plan's gym rate (`decisions.bladeRoute.start`), or else the player's own, now with city and money.
  - The model refuses a retrain it cannot price, and names the reason. sleeveplan passes that reason on.
  - The basis carries its batch (`installBasis.blade`).
  - A committed fleet stands on a near tie (`FLEET_KEEP`, 0.1h).
  - healthcheck fails BLADE FLEET UNPRICED.
- **The retrain as it runs.** It is one gym leg per stat, and each leg lasts at least one progress.js pass (`POLICY.retrainLegS` 300s). The stat keeps training past the bar until the leg ends. Live this took 0.38h (strength 19 -> 247 in one leg). The model had charged 0.05h, so every install was 0.33h too cheap. bbsim runs the same legs.
- **The skill clock is the daemon's.** bladeburner.js publishes `skillsAt`. The model spends hourly from that time, instead of at every pass's t = 0, where it spent points the daemon holds. An install restarts the daemon, which then spends at once, before the retrain. bbsim does the same. bb6 model vs game: worst 24% -> 19%.
- **Posteriors are carried.** The rank windows cross lives through `pc.prevAny`: k 1.065 (7 windows) -> 1.078 (8). bladeburner.js re-reads its own success groups. They are empty anyway, because every chance read is >= 0.97 or unread. The group moves the exit by < 0.4h.
- **After the fixes, on the fixture.** The fleet is i5 before and after the install. The install's 'now' prices 3.50h, and the new life gives 3.47h at 0.05h and 3.40h at 0.13h, off by +0.02h and +0.04h after the elapsed time. The held 10:28 -> 10:33Z move is +0.07h with no fleet and +0.05h with i5; it was +0.97h.
- **Still in the model (named).** The black-op chance plateau is the remaining sensitivity. When the next black op is rank-eligible below `blackThr` 0.8, the exit is the hourly skill spend at which its chance crosses 0.8. That makes the exit discontinuous in its inputs by up to about an hour. It is ~10h long with no fleet and ~1.5h with five infiltrators. In the retrain window, 10:18 -> 10:23Z moved the no-install exit by +0.76h. Two cadence fixes were tried, daemon and model alike:
  - spend every 300s while blocked;
  - spend when a plan would unblock the op.

  Each smoothed the 10:33Z state, which came out 1.5h faster, and each was 5.5-5.9h worse on the 11:07Z 2026-10-01 state, because points went to chance instead of to the rank skills that compound. Not adopted. Without a fleet, `blackThr` matters: on the 10:33Z state, 17.5h at 0.8 against 11.7h at 0.4-0.5. With five infiltrators it does not (3.5-3.7h).
- **The install cadence.** `tools/sim/exitjump/cadence-bn6-1033.mjs` prices it on the 10:33Z state.
  - With the fleet the route will run (i5), installing the 9-aug batch at 1.38h gives 3.81h against 3.94h never installing. That -0.13h is inside the model's resolution, and the old 0.05h retrain made it look 0.1h better than that.
  - On the sleeves as they ran (none), the same install was worth -3.1h. That is the 10h plateau, where combat multipliers buy the chance.
  - So the frequent installs were real on the inputs the plan had, and those inputs were the bug. With the fleet, an install ~1.4h out is not worth its retrain.

## bb-lite: the division from combat 100 (2026-10-02)

BN6's division waited for a host with 92.75GB free: combat 100 at +2.38h, home 1024GB (the first such host) at +4.01h, the install there reset combat, and the division existed by +6.10h (the Bladeburners faction record). BN4 at a 64GB home had no host over 32GB. bladeburner.js is 25 `ns.bladeburner` functions at 4GB each (not SF4-scaled).

- **The shape.** `bb-lite.js` references no 4GB call (5.6GB). Its actors run one at a time wherever act.js's do (home's action slot, 19.4GB in BN4 and at SF4.3) and answer on port 12611: join (division, faction at rank 25), read (ranges, counts, max levels, the next black op), act (stamina, rank, the running action, the claim, startAction), skill (hourly, `planSkills`), level (autolevel back on, once per process). A Bladeburner action needs no resident script: the game repeats it (`Bladeburner.processAction`).
- **What it gives up** (`bbliteplan.js` header): other cities, levels below the autolevel max, the team size, stopping a leftover action, the calibration reads. On the game's classes from a fresh join at combat 105: lean rank / full rank = 0.62-0.73 over the first 4h (`tools/sim/bblite-savings.mjs`).
- **The slot.** `bbslot.slotClaim`: progress.js's `slot.owner` when the planner has a fresh pass this life, else act.js's bootstrap claim (`/tel/act.txt` `slot`, actplan 0b). The act actor re-reads it on its own host immediately before `startAction`.
- **The handover.** bladeburner.js does nothing (no start, stop or skill) while `/tel/bb-lite.txt` is alive (`liteAliveOf`), publishing `handover-wait`; bb-lite sees `daemon: 'bladeburner.js'` and exits `handed-over`; the watchdog also stops bb-lite once bladeburner.js runs anywhere (invariant). The game repeats the last action through the gap.
- **The route before the planner** (actplan 0b): where the division exists and the plan has not said `hack`, the bootstrap trains combat to 100 — the gym when its fee is paid for the hold, else the best money crime (`bodyplan.combatBarPlanOf`: on the 17:27Z BN4 state mixed 1.15h, gym only 2.76h — the live idle stall, crime only 4.92h) — then claims the slot for Bladeburner. progress.js's gym legs use the same pricing, and an unpaid gym never leaves a claimed slot idle.
- **The fleet before the join** (`sleeveplan.preJoinFleetObjectiveOf`): the exit is the join plus a leg the fleet does not move, so the objective is what brings combat 100 soonest: money (sleeve crime money is NOT scaled by shock, `SleeveCrimeWork.getExp` scaleWorkStats(.., false) — `sleeveCrimeRates` scaled it until now), the gym (exp x shockBonus x sync: ~0 at the entry's shock 100), never karma (the gang is priced on the World Daemon exit). In the division: sleeve.js's Bladeburner mix.
- **Hours saved** (`tools/sim/bblite-savings.mjs`, saved = (full join - lean join) x lean/full 0.625): BN6 1.4h (join at its earliest possible, +4.63h) to 2.3h (at the faction record's bound); BN4 this run ~3.3h (0.4-6.1h: the full daemon's first host projected at ~+9.1h from BN4's pace to 64GB, x0.5-x1.5); a future SF6 node with actplan 0b from the entry ~4.3h (1.5-7.2h).

## The BN4.3 drift (2026-10-03): the inputs, not the mechanics

The black-op exit fell 2.54h per wall hour over BN4.3 (`exitcal.js`: t -2.6, X 3.18, PLAN MISCALIBRATED). By life it fell 1.3-2.4h/h in life 3 (bb-lite), 6.3h/h in life 4 (bb-lite, then the full daemon at 02:14Z), and 6.4h/h over life 5's first 1.75h (bb-lite after the 03:08Z install), then rose ~0.6h/h while the sleeves sat idle. `tools/sim/bbcal4.mjs` replays it from the states the run left behind (fixtures `fixture-bn4-homeblade-0100`, `-gymless-0237`, `-bladecal-life5`: a recorder's 5-minute saves from 09:59Z). `tools/test/bladecal4.test.mjs` [B4-1..10] holds it.

- **The mechanics hold.** From life 4's 02:41Z state, through the install, with the sleeves and the daemon as they actually ran, the model's finish (17:51Z) is within 0.6h of the finish it gives from the 09:59Z capture (18:27Z). That is 7.3h apart, -0.92h/h. From 09:59Z with the full daemon and the fleet running, its revisions fall 0.96h/h, and its rank path matches the game's over each next half hour to within 1% (mean 1.001).
- **What was wrong (each fixed in the model, no fudge factor):**
  - **Unread cities.** bb-lite reads no city, and its record overwrote the full daemon's reads. The model then priced six cities at the START's order statistics (1.07-1.43e9), at any division age. At 6.8h the six true populations were 1.19-2.69e9. The model now uses `cityPriorOf(age)`, the game's start plus its random events (`bbcityprior.mjs`), with the age from `joinedAt` on the record. On the 01:24Z state with the fleet, this prices 22.5h against 22.3h mean over drawn cities; the old default priced 25.3h. bb-lite now carries the full daemon's last reads (`carriedOf`: dated cities, aged in expectation, and the success calibration).
  - **Unread counts.** Raid's count, which bb-lite never reads, was 75.5 (the start's mean). It is now that mean plus its growth since the join. The end of the trajectory is bound by counts: about 53 counts of every operation are worth ~6h of exit with no fleet.
  - **The lean daemon priced as the full one.** While bb-lite acts, the model now runs its policy (pinned levels, one city, no Raid, team 0) until the expected handover. `bbliteplan.leanUntilOf` gives that as the placement (0.25h) at 128GB, as an approved home purchase, or as never. homeplan prices the tier as a `{full: true}` step, not as x1/LITE_OVER_FULL on top of a full-daemon trajectory.
  - **A fleet from another life.** After the install, sleeve.txt still held life 4's committed i1s4. Sleeve.prestige stops every sleeve, and sleeve.js had no host until 09:20Z. `bladeFleetOf(fleet, {lifeStart})` now prices none from a record older than the install. On the 09:59Z state that was 2.3h of exit.
  - **Black ops at the scaled chance.** The model attempted Typhoon at 0.738 x 1.206 = 0.89, while the daemon waited on the shown 0.738. A black op has no city term, so the success calibration (measured on contracts and operations) no longer applies to it.
  - **k measured on another trajectory.** The rank windows were bb-lite's against the full-daemon model on default cities (1.12-2.75), then the full daemon's with a fleet that was not running (0.38-0.84). k read 1.24, then 1.05, and corrected neither error. v2 (`rankWindowOkOf`) counts a window only for the full daemon, with every city read and this life's fleet. v1 windows are dropped, so k restarts at 1 and now measures the model's error alone.
- **One residual, named.** The 01:24 -> 02:41Z pair still falls 3.25h/h. Given the cities actually read, it falls 0.8h/h. The realised cities were ~2 sd above the age prior (the prior is unbiased over draws: [B4-2]). The prior's convexity costs ~0.2-1.5h, optimistic.
- **The planners' k (gameplan, nextnode): one definition.** k = (node hours - opening) / the planner's own CLEAN leg, which is exactly what the route formula multiplies and what `gameplan/observe.mjs` reads a clear with. On BN6.1 that is 1.223. The base was 0.916, which is bbcal6's live leg over the leg as run with the fleet 24.8h late: a different denominator. It is now 1.068 / 1.223 / 1.535. The in-game rank k is the model's own error (~1). The planners' k carries the operations as well.

## If it goes wrong

| symptom | where | fix |
| --- | --- | --- |
| BLADEBURNER SILENT | boot.txt, bb-lite.txt | neither daemon placed: bb-lite.js needs 5.6GB anywhere (watchdog revives it); bladeburner.js a 92.75GB host |
| BB-LITE STARVED | bb-lite.txt actorErrors | no rooted host has 9.6-14.6GB free for an actor: free home's action slot or buy a server |
| ORDER NOT HELD (FactionWork) | act.txt decision.why, orders.txt | something started faction work while progress.js holds the slot for Bladeburner |
| `slot-not-ours` forever | plan.txt decisions.bladeRoute | the plan chose `hack` (read `why`, `hackH`, `bladeH`) — correct if the hacking exit is faster |
| NO RANK PROGRESS / ACTION FAILING | bladeburner.txt action, env, cities | estimate wrong (Field Analysis should be chosen when the shown range is > 10% wide), or chaos (Diplomacy past 50) |
| STAMINA STUCK | bladeburner.txt samples | the chamber is not running: is the slot ours? |
| BLADE FLEET UNPRICED | sleeve.txt blade.why, plan.txt decisions.bladeRoute.start | the model's reason is in `why`; "no gym rate" means the start has none (plan.txt `start.gymExpPerSec`) |
| MODEL OFF | bladeburner.txt calibration | the game source moved: `npm test -- bbplan` against the new source |
| EXIT READY, NOT TAKEN | endgame.txt | `held` = /endgame-hold.txt (deliberate); `ready` = endgame has no `--next` |

Manual testing hooks: `run bladeburner.js --own-slot` acts without progress.js's claim (and will fight faction work — testing only).
