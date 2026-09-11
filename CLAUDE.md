# Bitburner scripts — working notes

Personal Netscript collection for [Bitburner](https://github.com/bitburner-official/bitburner-src),
plus the tooling that lets an agent iterate on it against a live game.

## The two repos

| Path | What it is |
| --- | --- |
| `~/Repos/bitburner-scripts` | This repo. Netscript at the root, tooling under `tools/`. |
| `~/Repos/bitburner` | Fork of the game. Fast-forwarded from v0.52.9 (2021) to upstream `bitburner-official/bitburner-src`. |

The fork's original parent `danielyxie/bitburner` is dead — upstream is
`bitburner-official/bitburner-src`, added as the `upstream` remote.

**The game source is the authority on every mechanic.** Read it rather than
recalling how Bitburner worked; v2 and v3 changed the API and several formulas
substantially, and most material on the web predates that.

## Running the loop

```bash
cd ~/Repos/bitburner && npm run start:dev     # game at http://localhost:8000
cd ~/Repos/bitburner-scripts && npm run daemon # RFA websocket 12525, control HTTP 12526
```

Then in-game: Options → Remote API → port `12525` → Connect.

- `tools/rfa-daemon.mjs` serves the Remote File API; **the game connects to us**.
- Restarting the daemon drops the game's websocket. It shows "Reconnecting" but
  often will not recover on its own — reconnect by hand in Options. Avoid
  restarting it while agents are working.

### Hot reload — the thing to be careful about

**Every `.js` at the repo root is pushed into the running game within ~150ms of
being saved.** A broken save goes live immediately. The daemon logs each push
with its in-game RAM cost and the delta from the previous push, which is the
fastest signal that an edit got expensive.

Not synced: `tools/`, `docs/`, `archive/`, `min/`, `node_modules/`,
`.telemetry/`, and `NetscriptDefinitions.d.ts`. Put experiments there.

Scripts are pushed alphabetically, so a file can land before a module it
imports and fail to compile; the daemon rechecks those once everything is
present.

### Control port

```bash
curl localhost:12526/status          # connected? files tracked? last telemetry?
curl localhost:12526/state           # latest decoded save digest
curl localhost:12526/poll            # force a telemetry refresh, then print it
curl localhost:12526/sync            # re-push everything
curl -X POST localhost:12526/rpc -d '{"method":"getFileNames","params":{"server":"home"}}'
```

`/rpc` passes through to any Remote File API method: `pushFile`, `getFile`,
`deleteFile`, `getFileNames`, `getAllFiles`, `calculateRam`,
`getDefinitionFile`, `getSaveFile`.

## Telemetry

In `.telemetry/` (gitignored). Run `curl -s localhost:12526/poll` first — the
save-derived files only refresh every 30s.

| File | Source | Contains |
| --- | --- | --- |
| `state.json` | game save, decoded | money, skills, karma, augs, factions, servers, playtime |
| `history.jsonl` | same, appended | the above over time, so rates are measurable |
| `status.txt` | `tel.js` running in-game | processes, income/sec, per-server money and security |

The save **excludes running scripts** — that is why `tel.js` exists. It writes
`/tel/status.txt` in-game and the daemon mirrors it out. It needs ~4GB, so it
normally runs on a rooted server rather than eating home RAM.

## The simulator

`tools/sim/` does **not** reimplement the game. `build.mjs` bundles
`~/Repos/bitburner` with esbuild and `env.mjs` stands it up under jsdom, so
`game.mjs` re-exports the real `calculateHackingTime`, `calculateGrowMoney`,
`calculatePercentMoneyHacked`, `numCycleForGrowthCorrected` and friends. To use
a formula that isn't exported yet, add it to `ENTRY` in `build.mjs`.

```bash
node tools/sim/run.mjs --snapshot              # capture the live world
node tools/sim/run.mjs --minutes 60 --seeds 5  # compare strategies
node tools/sim/run.mjs --only early-n00dles --json
```

- `engine.mjs` supplies only what the game couples to React and its worker
  runtime: a clock, a RAM allocator, an event queue. Op *duration* is computed
  at launch and its *effect* at landing, matching the game — that gap is the
  whole reason batching is hard.
- Worlds come from the live save, so servers have this playthrough's real
  randomized stats. `freshStart()` rolls back to a pristine BN1 opening.
- Hacking is probabilistic. **Always compare medians over several seeds.**

### Two load-order traps, both already handled in `env.mjs`

Changing that file without knowing these will break it in a way that is hard to
read:

1. jsdom's `window` carries its own `globalThis` property. Copying the window
   surface onto the global wholesale rebinds the identifier, and every
   subsequent shim lands on the jsdom window instead of node's real global —
   where the game bundle looks for it. The copy loop skips `globalThis` and the
   module holds a captured `const G` reference.
2. A top-level `await` makes a module async, and ES modules do **not** guarantee
   an async module finishes before its *siblings* evaluate. `env.mjs` must stay
   synchronous (its rebuild runs via `execFileSync`) or the game bundle starts
   running before the DOM exists. `game.mjs` pulls the bundle in with a dynamic
   `await import` for the same reason.

## Netscript v3 notes

The scripts were migrated from the 2021 API; 117 call sites moved. What bit:

- Most of the API is namespaced now: `ns.format.*` (no more `nFormat`),
  `ns.cloud.*` for purchased servers, `ns.stock.getPrice` (the `Stock` infix is
  gone), `ns.singularity.*`, `ns.ui.openTail`.
- Semantics changed in places, not just names: `getServerRam` returned a
  `[max, used]` pair that no longer exists; `hackAnalyzePercent` became
  `hackAnalyze`, returning a *fraction*; `getTimeSinceLastAug` is now derived
  from `getResetInfo().lastAugReset`.
- **Checking names against the definitions file does not catch arity changes.**
  `getScriptIncome()` still exists but no longer accepts zero arguments — that
  one was only caught because telemetry printed `$None/s`. Assume more lurk in
  scripts that have not been run yet.
- Get the current definitions from the running game itself:
  `curl -X POST localhost:12526/rpc -d '{"method":"getDefinitionFile"}'`. The
  daemon writes it to `NetscriptDefinitions.d.ts` on connect.

### Source-File 4 gates a lot

`ns.singularity.*` throws without SF4. On a first BN1 run that leaves
`crime.js`, `training.js`, `faction.js`, `buyProgram.js`, `createProgram.js`,
`healer.js` and `bladeburner.js` dormant. What they automate has to be done by
hand in the UI — legitimate to recommend, it just costs the player's attention.

## Agent roles

Four specialists run in parallel with **non-overlapping file ownership**. Keep
it that way; three agents editing one repo is how work gets clobbered.

| Agent | Owns | Job |
| --- | --- | --- |
| **game-player** | the browser, in-game actions | Continuously look for something to optimize with the tools on hand: watch telemetry, find idle RAM and newly rootable servers, run and retarget scripts, click the UI, suggest features. |
| **optimizer** | `tools/sim/**` | Use the simulator to find measurably better strategies, then turn winners into real scripts. Medians over seeds, never single runs. |
| **researcher** | `docs/roadmap.md` | One level up: the critical path to the first aug install, what to rush, which faction first, backdoor order, what ends BN1. |
| **prior-art** | `docs/prior-art.md` | State our problems abstractly, then find what is actually known about them — academic and community both. |

Standing rules for all of them:

- Only the game-player touches the browser. The game is open in a specific tab;
  opening a new one would start a *different* save.
- Nothing resets progress (soft reset, install augs, delete save) without
  asking the lead first.
- Nobody restarts the RFA daemon.
- Root-level `.js` edits go live instantly — say so explicitly when reporting,
  and do not overwrite scripts another agent owns.
- Subagents commit nothing. The lead handles git.
- Verify against the game source or telemetry. Do not assert mechanics from
  memory of older versions, and say which version a community source targeted.

The lead agent reports to the human at a high level and does the committing.

## Current run

BitNode 1, fresh start, no Source-Files. Live numbers are in `.telemetry/` —
read them rather than trusting anything written here, which goes stale.

`hack.js` is the real batcher at 11.2GB and needs home RAM past 8GB to run;
`early.js` is the small HGW loop that bridges the opening. Early sim results
say the threshold loop is fine but pinning it to one target costs roughly 3x
versus retargeting as the hacking level rises.
