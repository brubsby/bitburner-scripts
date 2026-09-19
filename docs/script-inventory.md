# Root script inventory

Every `.js` at the repo root, classified. **70 files.**

Written 2026-09-13, in **BitNode 4**, home = 32GB, SF1.1 only, 9 rooted servers,
no factions joined, ~$4.5m. Live state read from `.telemetry/state.json`; the
RAM column is the game's own `calculateRam` over the control port on that day,
so it is **BitNode 4 pricing** — Singularity at full price with no Source-File
(`RamCostGenerator.ts:82-96`, the `Player.bitNodeN === 4` branch at :84).
Outside BN4 without SF4.2+ every Singularity figure below is ×16.

Nothing here has been moved. The recommended moves are in
`tools/staging/archive-plan.sh`; game knowledge mined out of these files is in
`docs/game-knowledge.md`.

## Counts

| class | n |
| --- | --- |
| ACTIVE | 30 |
| UTILITY | 19 |
| FUTURE | 7 |
| SUPERSEDED | 8 |
| BROKEN/DEAD | 6 |

**Archive candidates: 14** (SUPERSEDED + BROKEN/DEAD). Everything else stays.

## Two things that made this less obvious than it looks

**We are in BitNode 4, so "never run" is not "dead".** `SF4Cost` returns full
price when `Player.bitNodeN === 4` (`RamCostGenerator.ts:84`) — the Singularity
API is live *right now* with no Source-File. `crime.js`, `training.js`,
`faction.js`, `createProgram.js`, `healer.js` and `progress.js` were dead weight
for the whole of BitNode 1 and are usable today. None of them is archived.

**`tools/staging/` supersession is a PLAN, not a fact.** `sing-faction.js`,
`sing-donate.js`, `sing-shop.js`, `sing-aug*.js`, `sing-install.js`,
`augplan.js`, and the `tools/staging/boot/` set (`stack.js`, `hgw.js`,
`retire.js`, `bootnag.js`) are **not deployed and have never been run**. Where
one of them would replace a root script it is noted as *staged*, and **no
staged replacement is used as grounds for archiving anything.** `tools/staging/
boot/NOTES-boot.md:213` says it explicitly: "Nothing was deleted. Every script
in the old STACK, and every script in `watchdog.js`'s WATCHED, is in the
manifest."

**`.variants/dom-ui/` already preserves all of this.** It holds 66 of the 70
root files verbatim as of the end of BitNode 1 (everything except
`autobuy-sing.js`, `seed.js`, `sfgate.js`, `storyservers.js`, all of which
post-date the snapshot). **Every file recommended for archiving is already
snapshotted there**, so the archive move loses nothing even if it were wrong.

---

## ACTIVE — 30

In `boot.js`'s `STACK`, `watchdog.js`'s `WATCHED`, imported by one of those, a
worker, or the opening.

| file | GB | why |
| --- | --- | --- |
| `boot.js` | 7.90 | The opening. Defines `STACK`; must be run by hand after an install (autoexec is skipped — `NetscriptWorker.ts:247`). |
| `batch.js` | 8.80 | STACK + WATCHED. The HWGW controller; the earner. |
| `cmd.js` | 8.15 | STACK + WATCHED. Terminal bridge — the whole headless control path. |
| `ctauto.js` | 22.00 | STACK + WATCHED. Finds and solves coding contracts forever. |
| `tel.js` | 4.00 | STACK + WATCHED. The telemetry source; the save excludes running scripts. |
| `watchdog.js` | 7.90 | STACK. Restarts everything in `WATCHED`. |
| `upkeep.js` | 2.20 | STACK + WATCHED. Reclaims the 25% focus bonus and the 24h export bonus. |
| `backdoor.js` | 4.60 | STACK + WATCHED. Roots/backdoors the five story servers; gates every faction. |
| `torbuy.js` | 2.45 | STACK + WATCHED (invariant `!hasTorRouter`). Clicks the TOR button. |
| `settings.js` | 2.30 | STACK. Turns off the confirmation modals every UI script would otherwise have to fight. |
| `go.js` | 20.30 | STACK + WATCHED. IPvGO node power → `faction_rep`. |
| `buyserv.js` | 6.50 | STACK + WATCHED. Cash → cloud RAM. |
| `share.js` | 4.00 | STACK + WATCHED (invariant: a faction is joined). |
| `autobuy.js` | 4.15 | WATCHED. Buys TOR + port programs, Singularity first, terminal fallback. |
| `nfg.js` | 2.40 | WATCHED (JOB). Donations → NeuroFlux levels. |
| `homeup.js` | 4.45 | WATCHED (JOB). The only purchase that survives an install. |
| `h.js` | 1.70 | Worker. One `ns.hack` with `additionalMsec`, then exits. |
| `g.js` | 1.75 | Worker. |
| `w.js` | 1.75 | Worker. |
| `seed.js` | 6.40 | The opening earner. `ns.exec`s `early.js` per host; running right now. |
| `early.js` | 2.40 | Exec'd by `seed.js`. The small HGW loop that bridges the opening. Staged `tools/staging/boot/hgw.js` would replace it — *staged, not deployed*. |
| `status.js` | 1.60 | Imported by 12 scripts. The `reporter`/`describe`/`record` contract behind invariant C1. |
| `lock.js` | 2.30 | Imported by `augbuy`, `cmd`, `homeup`, `nfg`, `settings`, `torbuy`. The global UI lock. |
| `storyservers.js` | 1.60 | Imported by `backdoor.js` and `watchdog.js`. Pure data; exists to break a circular gate (C4). |
| `homecost.js` | 1.60 | Imported by `homeup.js` and `watchdog.js`. Pure arithmetic, no ns calls. |
| `sfgate.js` | 1.60 | Imported by `autobuy`, `autobuy-sing`, `go`. Source-File capability rules, pure. |
| `golib.js` | 1.80 | Imported by `go.js`. The Go rules/eval/search; runs under plain `node`. |
| `go-cheat.js` | 33.60 | `ns.exec`'d by `go.js:261`. **Dormant until SF14.2** — that is the point: it isolates 33.6GB out of `go.js`'s hot path. Archiving it would break `go.js`'s exec. |
| `ctsolvers.js` | 1.60 | Imported by `ctauto.js` and `ctsolve.js`. No ns calls, so free to import. |
| `autobuy-sing.js` | 6.60 | `ns.exec`'d by `autobuy.js:223`. The Singularity half, split out so `autobuy.js` is 4.15GB and not 65.85GB at SF4.1. |

## UTILITY — 19

Operator-run one-shots, and the shared libraries the legacy scripts import.
Kept unless genuinely duplicated.

| file | GB | why it stays |
| --- | --- | --- |
| `augbuy.js` | 2.40 | The **only deployed way to buy an augmentation.** Drives the aug card's MUI `<Paper>` from inside the game. Staged `sing-augbuy.js` would replace it — *staged, not deployed*, and `.variants/dom-ui` keeps the DOM route anyway for non-BN4 lives. |
| `killall.js` | 2.55 | Kill a script by name across every rooted host. The terminal's `killall` only touches the connected server. **Wins over `killhack.js`.** |
| `process.js` | 4.65 | `--kill/--run/--restart` with argument inference. Not duplicated by `killall.js` — that one cannot restart. |
| `findpath.js` | 3.80 | Live BFS route to a server + its hack level/ports/money/RAM. **Wins over `find.js`**, which needs a localStorage blob nothing writes any more. |
| `ctscan.js` | 12.00 | Phase 1 of the low-RAM contract path. **Not superseded by `ctauto.js`:** 12.00 + 12.30 fits where `ctauto.js`'s 22.00 does not, which is exactly the 8–32GB opening we are in. |
| `ctsolve.js` | 12.30 | Phase 2, same reason. `--dry` is the only way to see answers before submitting. |
| `serverrank.js` | 2.90 | Live ranking table, no localStorage dependency. Human-readable target picking. |
| `deepscan.js` | 3.70 | Network tree with per-server tooltips. The *display* works; its click-to-connect uses the pre-React terminal-input trick and does not (see `docs/game-knowledge.md` § "Driving the terminal"). Kept for the tree. |
| `eval.js` | 1.60 | Three lines. Run arbitrary JS in the game's context. Irreplaceable for debugging, costs nothing. |
| `steve.js` | 1.60 | Pure name generator, **imported by `gang.js`**. Cannot be archived independently of it. |
| `healer.js` | 2.60 | `ns.singularity.hospitalize` — **live in BN4**. Four lines that matter before infiltration or combat crime. Its `try/catch` around a Singularity call is decorative (RAM is billed statically) but the call itself works. |
| `hacknet.js` | 6.70 | Buys hacknet capacity to the Netburners invite thresholds, then stops. No Source-File needed; usable today. |
| `crime.js` | 20.60 | `ns.singularity.commitCrime` — **live in BN4**. Combat stats are all 1 in this save and karma is 0. Uses v1 lowercase crime names and `common.js`'s broken player shim; see game-knowledge. |
| `training.js` | 13.75 | `ns.singularity.gymWorkout`/`universityCourse` — **live in BN4**. |
| `faction.js` | 29.20 | Carries the faction **requirements table**, which is the data `sleeve.js` imports and which nothing else in the repo holds. Live in BN4. Staged `sing-faction.js` replaces the *actions*, not the table — *staged, not deployed*. |
| `createProgram.js` | 11.75 | `ns.singularity.createProgram` — live in BN4 — and its `programs` table is **imported by `buyProgram.js`**. |
| `progress.js` | 41.45 | The Singularity director prototype. **Cannot run today** — 41.45GB against a 32GB home (invariant B6). Kept because it is the nearest thing to `autopilot.js` in `docs/autonomy.md` and the staged `sing-*` set is its intended successor — *staged, not deployed*. |
| `common.js` | 7.75 | Shared library for 10 legacy scripts. **Contains a live bug** (`player.hacking_skill`, see below). Cannot be archived while any consumer stays. |
| `constants.js` | 1.60 | Pure data, imported by `training.js` and `sleeve.js`. `travel_cost = 200000` still matches `Constants.ts:28`. |

## FUTURE — 7

Needs a Source-File, BitNode or mechanic we have not reached. **Keep all.**

| file | GB | unlocked by | would it run today? |
| --- | --- | --- | --- |
| `gang.js` | 9.60 | **BN2 / SF2.** `ns.gang.*` throws otherwise. | No. Also needs karma ≤ −54,000; this save is at karma 0. |
| `bladeburner.js` | 91.60 | **BN6 or BN7 / SF6.** | No — and 91.6GB is ~3× this home anyway. Imports the broken `bitNodeMultipliers.js`. |
| `sleeve.js` | 61.25 | **BN10 / SF10.** | No. Imports `faction.js`, which is why `faction.js` cannot be archived either. |
| `stock.js` | 24.70 | **BN8**, or buying WSE+TIX+4S outright (~$51b) in any node. | Not SF-gated, just far out of budget at $4.5m. Header says "Requires access to the TIX API and the 4S Mkt Data API". |
| `hash.js` | 7.60 | **BN9 / SF9** — hashes only exist with hacknet *servers*. `ns.hacknet.numHashes()` is meaningless on nodes. | No. |
| `infiltration.js` | 9.40 | Infiltration — **never fully automatable.** `Infiltration/ui/InfiltrationRoot.tsx` gates the minigames on `isTrusted`, and a synthetic key *hospitalises you*. | Partially: its location/reward tables are readable. Imports the broken `bitNodeMultipliers.js`. |
| `infilhelper.js` | 1.60 | Same mechanic. Imports `/cw/exports.js` — note `cw/` **is** walked and deployed by the daemon. | The overlay would render; the minigames still need a human. |

## SUPERSEDED — 8

A newer script does the job strictly better and **nothing imports these**.

| file | GB | replaced by | evidence |
| --- | --- | --- | --- |
| `hack.js` | 11.20 | `batch.js` (+`h/g/w.js`) | The v1 threshold loop. `ns.spawn('spider.js', 1, 'hack.js')` at :279 and a self-managed `BB_SERVER_MAP` in localStorage at :17,:31,:37. `batch.js`'s own header: "Replaces the threshold loop … it caps income at roughly one target's max money per cycle however much RAM you add". `batch.js` is in STACK + WATCHED; `hack.js` is in neither and nothing imports it. **Cited by `tools/sim/bncheck.mjs:146` — see the archive plan.** |
| `auto.js` | 5.60 | `batch.js` + `seed.js`/`early.js` | `batch.js:5-17` names `auto.js + early.js` as what it replaces. Not in STACK or WATCHED; `watchdog.js`'s header describes `auto.js` only as the historical reason the watchdog exists. |
| `spider.js` | 7.70 | `batch.js` / `seed.js` (rooting + placement) and `backdoor.js` | Its whole job is walking the net, rooting, writing `BB_SERVER_MAP` to localStorage and spawning `hack.js` (:150). Every consumer of that map is itself archived here. Only `tools/sim/fidelity/supervisor.mjs` mentions it, in prose. |
| `pserv.js` | 12.65 | `buyserv.js` | `buyserv.js` is in STACK + WATCHED; `pserv.js` is in neither. `tools/sim/bncheck.mjs:104` states it outright: "pserv.js is superseded by buyserv.js and not in the boot stack, which is the only reason this is not impact 3." It also carries the `PurchasedServerCost` bug (below). **Cited in bncheck — see the archive plan.** |
| `contract.js` | 26.35 | `ctauto.js` + `ctsolvers.js` | `ctsolvers.js:1` — "Coding-contract solvers, **extracted from contract.js** so they can be shared". `ctauto.js` is in STACK + WATCHED and does scan+solve in one resident script. `contract.js` still reads `BB_SERVER_MAP`-era state and costs 26.35GB. **Cited by `bncheck.mjs:242` — see the archive plan.** |
| `brain.js` | 2.90 | `ctauto.js` | Six lines: `ns.exec("contract.js","home")` every five minutes. Both its purpose and its callee are superseded. |
| `buyProgram.js` | 11.70 | `autobuy.js` + `autobuy-sing.js` | `autobuy.js` is in WATCHED and buys TOR **and** the port programs, Singularity-first with a terminal fallback, at 4.15GB against 11.70GB. `buyProgram.js` imports `createProgram.js` and `common.js` (which is broken, below). |
| `git.js` | 1.75 | `tools/rfa-daemon.mjs` | Pulls `.js` from `github.com/brubsby/bitburner-scripts` and `ns.write`s it over root files **inside the game**. That is the exact drift `npm run verify` exists to detect, and the daemon owns deployment now. Hazardous rather than merely redundant. |

## BROKEN/DEAD — 6

Non-functional, or wrong in a way that makes them a hazard.

| file | GB | what is wrong |
| --- | --- | --- |
| `bitNodeMultipliers.js` | 5.60 | **The headline case.** Its defaults table is Bitburner *v1*. Five key names no longer exist in the game — `PurchasedServerCost`, `PurchasedServerLimit`, `PurchasedServerMaxRam`, `RepToDonateToFaction`, `GangKarmaRequirement` — and 18 current ones are missing, including `CloudServerCost`, `CloudServerSoftcap`, `WorldDaemonDifficulty`, `FavorToDonateToFaction`, `HackingSpeedMultiplier` and `GoPower`. `getBitNodeMultipliers()` returns that table, so every lookup of a renamed key silently resolves to `1` in **every** BitNode. Separately, the exported identifier is named `getBitNodeMultipliers`, which collides with `ns.getBitNodeMultipliers` in the RAM cost tree — the module alone prices at **5.60GB** (1.60 base + 4.00 for the collision), and **five** scripts pay it: `bladeburner.js`, `contract.js`, `faction.js`, `infiltration.js`, `pserv.js`. And `main()` writes whatever it got into localStorage under the same key, so running it *without* SF5 pins every consumer to the v1 defaults permanently. Details and the exact consumer sites in `docs/game-knowledge.md`. |
| `initHacking.js` | 5.25 | **Destructive.** `ns.rm()`s `common.js`, `hack.js`, `spider.js`, `find.js` and five files that do not exist, then `ns.wget`s replacements from `raw.githubusercontent.com/brubsby/bitburner/master/src/` — a path that does not serve this repo — then `ns.spawn('killAll.js', ...)`, which is not in the repo. Running it deletes live files and starts nothing. |
| `runHacking.js` | 4.70 | `ns.spawn('playerServers.js')` and `spider.js mainHack.js`. **Neither `playerServers.js` nor `mainHack.js` exists** anywhere in the repo. Every path through it fails. |
| `killhack.js` | 4.75 | Kills `h.js`, `g.js`, `w.js` — **the live batcher's workers** — then `throw new Error("Couldn't find server map")` whenever `BB_SERVER_MAP` is absent, which it is. So it half-executes and then throws. `killall.js` does the same job correctly, on a live scan, and never kills itself. |
| `bashrc.js` | 1.60 | Sets `terminal-input-text-box.value` and dispatches a raw `keydown`. The input is a React controlled component — setting `.value` updates the element but **not** React's state, and Enter reads React's state (`TerminalInput.tsx:244`). This is the exact failure `cmd.js` was written to fix. The aliases it installs also point at eight scripts archived here. |
| `find.js` | 1.95 | `getItem('BB_SERVER_MAP')` returns `undefined` when the blob is absent and the next line is `serverMap.servers` — a `TypeError` on every run. Only `spider.js` ever wrote that blob and `spider.js` is archived here. Its three jobs are covered by `findpath.js` (route), `ctscan.js` (contracts) and `backdoor.js` (story servers). |

---

## Files I was least confident about

- **`ctscan.js` / `ctsolve.js`** — `ctauto.js` does both in one resident script
  and is in the boot stack, which is a textbook supersession. Kept anyway
  because the split exists *for a RAM reason that is true again right now*:
  22.00GB does not fit a 32GB home running `batch.js` + `cmd.js` + `tel.js`,
  and 12.00 then 12.30 does. If home passes ~128GB for good, revisit.
- **`progress.js`** — unrunnable at 41.45GB on a 32GB home, and the staged
  `sing-*` set is explicitly its successor. Kept because that successor is
  staged and unrun, and because home RAM only goes up.
- **`git.js`** — classified SUPERSEDED rather than BROKEN because `fetch` from
  Netscript was not tested; it may simply work, which would make it worse, not
  better.
- **`deepscan.js`** — the click-to-connect half is dead for the same reason as
  `bashrc.js`, but the tree display is genuinely useful and independent of it.
  Kept whole rather than split.
- **`stock.js`** — filed FUTURE, but it is money-gated, not Source-File-gated.
  It becomes live the moment WSE+TIX+4S is affordable, in any BitNode.

## Consequences of executing the archive plan

Three, all of which the plan's comments repeat:

1. **`npm test` will fail `bnconst` C5b** until `tools/sim/bncheck.mjs` is
   updated. `bnconst.test.mjs:153-158` asserts that every filename named in an
   ASSUMPTIONS `where:` string exists. Three archive candidates are named there:
   `pserv.js` (:102, :119, :136), `hack.js` (:146) and `contract.js` (:242).
2. **`npm run verify` will report 14 orphans.** `tools/verify-deploy.mjs:44-49`
   treats a file present in the game but absent from disk as an orphan —
   "most likely a script deleted from disk that is still sitting in the game
   where the watchdog can relaunch it". `hygiene.test.mjs` D4 runs it, so
   `npm test` goes red too. Moving a file out of the root does **not** remove
   the copy the game already holds.
3. **Nothing else breaks.** Every test enumerates root scripts dynamically
   (`rootScripts`, `trackedFiles`); none imports an archive candidate.
   `archive/` is already in the daemon's `SKIP_DIRS`
   (`tools/rfa-daemon.mjs:31`), so nothing under it is ever pushed.
