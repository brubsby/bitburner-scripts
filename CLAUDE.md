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

**Copies on other servers.** A script `scp`'d to another host does not track the
original, so editing a file used to update home and leave every copy stale — and
a supervisor restarted on another host would silently come back running old
code. `/sync` had the same blind spot, so the obvious way to check made the
problem look absent. The daemon now overwrites every copy it can find on a
push, and `watchdog.js` re-copies from home before relaunching anything. If you
are ever debugging "the fix didn't take", check the file on the *target* server,
not home.

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

## Driving the game without the browser

`cmd.js` is a terminal bridge. It runs in-game, watches a file, and types
whatever it finds into the real terminal — so **any terminal command can be run
over the Remote File API, with no browser at all**.

```bash
# queue commands
curl -s -X POST localhost:12526/rpc -d '{"method":"pushFile","params":{
  "filename":"/cmd/in.txt","server":"home",
  "content":"connect n00dles\nbackdoor\nhome"}}'

# read what the terminal printed
curl -s -X POST localhost:12526/rpc -d '{"method":"getFile","params":{
  "filename":"/cmd/out.txt","server":"home"}}'
```

- `/cmd/in.txt` — one command per line; consumed and deleted.
- `/cmd/out.txt` — JSON, each command with the terminal output it produced.
- `/cmd/busy.txt` — present while a batch is running; poll for its absence.

**Prefer this over browser automation for anything the terminal can do** —
`connect`, `backdoor`, `buy`, `run`, `kill`, `scp`, `analyze`, `ps`, `free`.
It is faster, it is scriptable, and it cannot mistype. Two browser sessions
typing into the same terminal input *will* interleave into corrupt commands;
that has already happened.

The browser is still required for things with no terminal equivalent: the
Factions UI (accepting invites, starting faction work), the City/company UI
(buying home RAM at Alpha Enterprises, augmentations), Create Program, and
reading the character overview.

Refuses `softreset`, `b1tflum3` and `wd`. Not a security boundary — anything
with file access could do it anyway — just a guard against a typo in a queued
batch costing hours.

How it works, since it is non-obvious: `Terminal.executeCommands` is not
reachable from Netscript, and the input is a React controlled component, so
setting `.value` updates the element but not React's state — and Enter reads
React's state (`TerminalInput.tsx:244`). The bridge goes through the native
value setter, fires the `input` event React listens for, then sends Enter.
`document`/`window` are reached via `eval` so the RAM checker does not see
them, the same trick `infilhelper.js` uses.

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

## Fidelity: model the real game, except where RAM says otherwise

Every piece of tooling should model the game as it actually behaves. There is
exactly one licensed reason to diverge, and it applies to one side of the line.

**Off-line tooling (`tools/sim/**`, analysis, docs) has no RAM budget, so it has
no excuse.** Use the game's own source, its own constants, its own starting
conditions. Where the real formula is exported by `game.mjs`, call it rather
than reimplementing it. An approximation here is a bug, and it will be an
expensive one, because everything downstream is a decision made on its output.

**In-game scripts pay RAM per NS function referenced anywhere in their import
graph, multiplied by thread count.** There, an approximation that saves RAM can
be correct engineering — but it has to be a *deliberate, documented* trade with
the real behaviour named. `auto.js` inlining `calculatePercentMoneyHacked`
rather than calling `ns.hackAnalyze` saves 0.9GB *and* is more accurate for its
purpose; `h.js`/`g.js`/`w.js` carry no guards at all because one stray call in a
400-thread worker costs 40GB. Both are fine. Silently using a wrong constant to
avoid a lookup is not.

Failures of this rule have been the most expensive bugs in this project:

- `freshStart()` set servers to full money; real ones start at 4% of max
  (`Server.ts:75-77`). Every simulated world was 25x too rich, the opening grow
  phase did not exist, and the simulator scored a configuration in the billions
  that earned $0 for two hours in the real game.
- The simulator priced threads at 1.7/1.75GB while the supervisor actually
  deployed a 2.4GB worker — 30% too cheap.
- `contract.js` carried a v1-era reward constant of 4000 against the real
  `75e6`, so contracts looked worthless for years of play.
- `h.js`/`g.js`/`w.js` slept and then acted, so ops read the world at wake time
  rather than launch time — the dominant desync mechanism.
- The simulator scored end-of-run cash, which punishes every strategy that
  reinvests. Scoring cumulative earnings reversed the ranking outright.

The pattern is the same each time: a plausible-looking simplification, never
checked against source, silently deciding every measurement built on top of it.
**When a number matters, read it out of `~/Repos/bitburner` and cite the file and
line in a comment.**

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
| **game-player** | the browser, `/cmd/in.txt`, in-game actions | Continuously look for something to optimize with the tools on hand: watch telemetry, find idle RAM and newly rootable servers, run and retarget scripts, suggest features. **Use the `cmd.js` bridge for anything the terminal can do; reach for the browser only for the Factions, City and Create Program UIs.** |
| **optimizer** | `tools/sim/**` | Use the simulator to find measurably better strategies, then turn winners into real scripts. Medians over seeds, never single runs. |
| **researcher** | `docs/roadmap.md` | One level up: the critical path to the first aug install, what to rush, which faction first, backdoor order, what ends BN1. |
| **prior-art** | `docs/prior-art.md` | State our problems abstractly, then find what is actually known about them — academic and community both. |

Standing rules for all of them:

- Only the game-player touches the browser **or the `cmd.js` bridge**. The game
  is open in a specific tab; opening a new one would start a *different* save.
  Two writers on the terminal input interleave into corrupt commands — this has
  happened, producing `kill 154run cmd.js`. The bridge serialises through a file
  and is the safer of the two, but it is still one queue with one owner.
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
