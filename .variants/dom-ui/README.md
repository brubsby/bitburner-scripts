# dom-ui — the no-Source-File script set

Snapshot of every root-level script as it stood at the end of **BitNode 1**,
taken 2026-09-13 immediately before entering BitNode 4.

This is the version of the bot that **works with no Source-Files at all**. It
drives the game's DOM from inside Netscript (`eval('document')`) because
`ns.singularity.*` throws without SF4, and it is the set to restore for any
BitNode where SF4 is unavailable or too expensive.

## Why it exists separately

Inside BitNode 4, `SF4Cost` returns full price with no Source-File
(`Netscript/RamCostGenerator.ts:84`), so the Singularity API is free of the x16
tax there and the bot can be genuinely autonomous. Everywhere else without SF4
the API throws, and everywhere else *with* SF4.1 it costs x16 — so both sets
stay useful and neither supersedes the other.

| | dom-ui (this) | singularity (root, from BN4 on) |
| --- | --- | --- |
| Needs | nothing | SF4, or being inside BN4 |
| Faction joins | **impossible** — `isTrusted` (`FactionsRoot.tsx:89`) | `singularity.joinFaction`, no check |
| Aug purchase | DOM click on the aug's MUI Paper | `singularity.purchaseAugmentation` |
| TOR / programs | DOM click at Alpha Enterprises | `singularity.purchaseTor` / `purchaseProgram` |
| Home upgrades | DOM click, price read from the button | `singularity.upgradeHomeRam` / `upgradeHomeCores` |
| Faction work | DOM click, sidebar hidden while focused | `singularity.workForFaction` |
| Donations | typed into a React controlled input | `singularity.donateToFaction` |
| Terminal | `cmd.js` bridge, native setter + Enter | mostly unnecessary |

## Restoring it

```bash
cp archive/dom-ui/*.js .          # NOTE: hot-deploys within ~150ms
cp archive/dom-ui/package.json.snapshot package.json
npm run verify
```

`archive/` is in the daemon's `SKIP_DIRS` (`tools/rfa-daemon.mjs:31`), so
nothing in here is pushed to the game until it is copied to the repo root.
That is deliberate: two copies of the same logic live in the game at once is
how the stale-instance traps in CLAUDE.md happen.

## What is known-broken in here

Nothing known at snapshot time — this set completed BitNode 1. But note the
fixes that landed only hours before the snapshot and have therefore seen
little running time: the `watchdog.js` daemon/job lifecycle split, PID-liveness
in `lock.js`, `status.js` error reporting across five scripts, and the
`cmd.js` stale-`out.txt` fix. See `tools/staging/NOTES-*.md` for each.
