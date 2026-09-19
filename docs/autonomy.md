# The autonomous stack — design

Target: **a full playthrough with no human input.** BitNode 4 is where this gets
built, because `SF4Cost` returns full price when `Player.bitNodeN === 4`
(`Netscript/RamCostGenerator.ts:84`) — the Singularity API is available with no
Source-File and no x16 tax, so the design can be exercised at its real cost.

The DOM-driving set that completed BitNode 1 is preserved verbatim in
`.variants/dom-ui/`. It is not obsolete: without SF4 the Singularity API throws,
and with SF4.1 it costs 16x. Both sets stay.

## The one thing this buys

`Faction/ui/FactionsRoot.tsx:89` checks `event.isTrusted` before it even looks
at whether the invite exists, so **no script in any BitNode can accept a faction
invitation**. `singularity.joinFaction` (`NetscriptFunctions/Singularity.ts:750`)
has no such check — only `checkSingularityAccess`. That single call is the
difference between "mostly automated" and "autonomous"; everything else here is
cheaper and more reliable than clicking, but only this was impossible.

## The binding constraint: RAM is charged statically, per script

Netscript prices every ns function referenced anywhere in a script's import
graph, whether or not the call is reachable, and multiplies by threads. The
Singularity calls we need cost 2-5GB **each**:

```
joinFaction 3   workForFaction 3   donateToFaction 5   purchaseAugmentation 5
getAugmentationsFromFaction 5   installAugmentations 5   getOwnedAugmentations 5
purchaseTor 2   purchaseProgram 2   upgradeHomeRam 3   upgradeHomeCores 3
checkFactionInvitations 3   installBackdoor 2   connect 2   commitCrime 5
```

A single "do everything" script would exceed a 32GB home before doing anything.
So the stack is **one cheap director that execs narrow specialists**, each
referencing the smallest possible slice of the API. This is the `go.js` /
`go-cheat.js` split from CLAUDE.md, applied as the primary structure rather than
as an optimisation.

**Rule: a specialist references only the Singularity functions in its own job.**
If two jobs do not need to be atomic with each other, they are two scripts.

## Modules

| script | owns | Singularity surface |
| --- | --- | --- |
| `autopilot.js` | the director: decides what should happen next and execs a specialist | none, or the cheapest reads only |
| `sing-faction.js` | check invites, join, start/stop faction work | `checkFactionInvitations`, `joinFaction`, `workForFaction`, `stopAction` |
| `sing-aug.js` | what to buy and in what order, buy it, install | `getAugmentationsFromFaction`, `getAugmentationPrice`, `getAugmentationRepReq`, `purchaseAugmentation`, `installAugmentations` |
| `sing-donate.js` | favor-gated reputation purchase | `donateToFaction`, `getFactionRep` |
| `sing-shop.js` | TOR, port programs, home RAM/cores | `purchaseTor`, `purchaseProgram`, `upgradeHomeRam`, `upgradeHomeCores` |
| `sing-backdoor.js` | route and backdoor story servers | `connect`, `installBackdoor` |

Unchanged and already correct: `batch.js`, `buyserv.js`, `watchdog.js`,
`tel.js`, `go.js`, `golib.js`, `lock.js`, `status.js`, `homecost.js`,
`contract.js`.

`lock.js` is **not needed between Singularity specialists** — they do not touch
the DOM, so they do not race for the screen. Keep taking it only where a script
still drives the UI.

## What the director must know, and where it comes from

These are the mechanics the BitNode 1 run established. They are not
re-derivable from the API and must be encoded in `autopilot.js`:

1. **Reputation converts to favor at install, and favor 150 unlocks donations.**
   `favorToRep(150) = 462,490`. Bank exactly that with a faction before an
   install and its reputation becomes a purchase forever after. See the
   "Reputation is a purchase" section of CLAUDE.md.
2. **Queued augmentations do nothing.** Multipliers move only at install, so a
   multiplier earned late in a life is worth nothing for that life's grind.
3. **NeuroFlux money price is `base * 1.14^level * 1.9^queued`** and every
   queued NFG counts toward the exponent — it walls out after ~12 levels and the
   `1.9^queued` term resets at install.
4. **Home RAM and cores survive an install; money does not.** Spend to zero
   before installing (`homeup --reserve 0` equivalent).
5. **Buy most-expensive-first**; money cost multiplies 1.9x per queued aug,
   reputation cost does not.

## BitNode 4 specifics

```
ScriptHackMoney 0.2   ServerMaxMoney 0.1125   HackExpGain 0.4
FactionWorkRepGain 0.75   CloudServerSoftcap 1.2   WorldDaemonDifficulty 3
CrimeMoney 0.2   CompanyWorkMoney 0.1   HacknetNodeMoney 0.05
```

`ServerWeakenRate` and `ServerGrowthRate` are both **1**, so `batch.js`'s
hardcoded constants are correct here — BN4 is one of the few nodes where that
holds.

Money is the hard part: `0.2 * 0.1125` means a server yields about **2.3% of
what the same server yields in BN1**. The donation → NeuroFlux engine will be
far slower, and `w0r1d_d43m0n` needs hacking **9000** (3000 x
WorldDaemonDifficulty), which needs a hacking multiplier around 15 against the
7.94 that finished BN1.

## Testing

Specialists must be runnable and observable one at a time. Every one writes
`/tel/<name>.txt` through `status.js` on every exit path including `atExit`, so
a failure is visible rather than silent — five scripts wrote nothing on error
for most of BitNode 1 and it cost hours.
