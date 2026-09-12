# Morning handoff

State as of the overnight handoff. Everything below runs unattended; the
install is the one thing that cannot, because buying and installing
augmentations are `ns.singularity.*` calls and Source-File 4 is unobtainable in
BitNode 1.

## Where things stood

| | |
| --- | --- |
| NiteSec reputation | 7,502 of 20,000, **focused**, +2.29/s |
| CyberSec reputation | 11,556 |
| Hacking level | 344 |
| Home RAM | **16,384GB** — the only RAM that survives an install |
| Fleet | ~463TB, 25/25 cloud servers |
| Money | ~$11b, income ~$2m/s and rising as the batcher preps 8 targets |

Running, all guarded by `watchdog.js`:

```
batch.js     home          HWGW controller, 8 targets
ctauto.js    home          solves coding contracts on a loop
share.js     pserv-67930   2,040 threads, x1.30 reputation
cmd.js       home          terminal/NS bridge
tel.js       home          telemetry
watchdog.js  home          restarts any of the above
buyserv.js   joesguns      parked at --reserve 1e15
```

Check everything in one call:

```bash
curl -s --max-time 25 localhost:12526/poll >/dev/null
python3 -c "
import json
s=json.load(open('.telemetry/state.json')); d=json.load(open('.telemetry/status.txt'))
print(s['factionRep'], 'focused:', s['focused'], 'work:', s['currentWork'])
print('money', d['money'], 'hack', d['hackingLevel'])"
curl -s -X POST localhost:12526/rpc -d '{"method":"getFile","params":{"filename":"/tel/batch.txt","server":"home"}}'
```

## The one thing that can silently go wrong

**Focus reverts.** It was observed flipping back to unfocused with no browser
action in between. Unfocused costs 20% of the reputation rate
(`CONSTANTS.BaseFocusBonus = 0.8`). Worse, if the *work itself* stops, the rate
falls to the idle trickle of ~0.04/s — a 50x loss that looks like nothing at
all from the outside.

`state.json` now carries `focused` and `currentWork`, so this is checkable
without a browser. **Check it first.** If `currentWork` is null, restart the
NiteSec hacking work in the Factions UI; if `focused` is false, click Focus and
verify a few seconds later rather than immediately.

## When reputation reaches 20,000

Money is **wiped on install** — `prestigeAugmentation` sets
`this.money = 1000 + Donations`. Purchased servers are destroyed too. Home RAM
and augmentations survive. So **spend down to the install cost before
installing**; anything left is destroyed.

The researcher's revised batch (`docs/roadmap.md` Part IV) is **8 augmentations
+ 10 NeuroFlux levels, ~$251b**, giving `hacking_exp` x1.83, reputation rate
x1.44, and 18 of the 30 augmentations Daedalus requires. That supersedes the
earlier "7 augs for $669m" plan, which was written when money was scarce.

Reputation is **not** consumed by purchases — only money is — so buy the most
expensive augmentation first: the money cost multiplies by `1.9^(number already
queued)` while the reputation cost does not.

Two open questions worth deciding rather than defaulting:

1. **Go further than 20,000?** At NiteSec 50,000 the batch reaches `exp x2.07`
   and 55.5 favor rather than 29.7. That is ~6 more hours of grinding, or ~1
   hour if infiltration works (below).
2. **Buy the 32.77TB home RAM rung first?** $316.8b, and home RAM is the only
   thing that survives. At overnight income this is affordable alongside the
   install.

## Worth testing, and cheap to test

**Infiltration** may be ~10x the current reputation rate — `calculateReward`
hardcodes 465 and is stat-independent, so Joe's Guns in Sector-12 is playable
now at ~850 rep per 50-second run. But max HP is 10 and a miss costs 9.39, so
it allows **one mistake per run**, and it cannot be scripted (`isTrusted ===
false` key events are a guaranteed hospitalisation). Break-even is clearing
about half the minigames. **One run answers it.** See `docs/roadmap.md` Part IV.

**Export Game** grants +1 favor to every joined faction, once per 24h, for one
click (`ExportBonus.tsx:12-20`). Never used. The RFA `getSaveFile` telemetry
path does *not* consume it.

## After the install

Faction membership is wiped and the map respawns, so:

- Backdoor CSEC and `avmnite-02h` quickly and **accept both invites
  immediately** — each joined faction starts 150 rep/hour passive, and
  reputation is the binding constraint. (This reverses Part III's "join
  nothing" advice, which was correct when contract money mattered and is worth
  0.7 seconds of hacking income now.)
- **Take no job**, ever — it costs a work slot and cuts contract faction
  reputation by a third.
- Lower `buyserv.js`'s reserve so it rebuilds the cloud fleet; it is parked at
  `1e15` only because marginal cloud RAM is worthless *right now*.
- Story-server required hacking levels **re-roll at prestige**, so the recorded
  213/348/539 do not carry over.
