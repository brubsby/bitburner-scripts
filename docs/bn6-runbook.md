# BitNode 6 — day-one runbook (Bladeburner)

Nothing below has run against a live Bladeburner yet. BN6 is the calibration:
every number the plan uses for the Bladeburner route is **simulated**, and the
first hours exist to compare those numbers with what the game shows.

## What runs, and who owns what

| piece | file | what it does |
| --- | --- | --- |
| formulas, policy, exit model | `bbplan.js` (pure) | success chance, time, rank, stamina, skills ([BB1-BB9] check every formula against the game's classes); `chooseAction`, `planSkills`, `bladeExit` |
| the daemon | `bladeburner.js` (boot tier 128, `anywhere`, 3.25GB declared, raised to 92.75GB) | joins at combat 100, joins the faction at rank 25, buys skills, picks city/action/level, acts **only while `slot.owner === 'bladeburner'`**, publishes `/tel/bladeburner.txt`. Never destroys anything. |
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

## If it goes wrong

| symptom | where | fix |
| --- | --- | --- |
| BLADEBURNER SILENT | boot.txt | no 92.75GB host: grow the fleet, `run boot.js` |
| ORDER NOT HELD (FactionWork) | act.txt decision.why, orders.txt | something started faction work while progress.js holds the slot for Bladeburner |
| `slot-not-ours` forever | plan.txt decisions.bladeRoute | the plan chose `hack` (read `why`, `hackH`, `bladeH`) — correct if the hacking exit is faster |
| NO RANK PROGRESS / ACTION FAILING | bladeburner.txt action, env, cities | estimate wrong (Field Analysis should be chosen when the shown range is > 10% wide), or chaos (Diplomacy past 50) |
| STAMINA STUCK | bladeburner.txt samples | the chamber is not running: is the slot ours? |
| MODEL OFF | bladeburner.txt calibration | the game source moved: `npm test -- bbplan` against the new source |
| EXIT READY, NOT TAKEN | endgame.txt | `held` = /endgame-hold.txt (deliberate); `ready` = endgame has no `--next` |

Manual testing hooks: `run bladeburner.js --own-slot` acts without progress.js's claim (and will fight faction work — testing only).
