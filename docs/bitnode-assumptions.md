# Load-bearing BitNode assumptions

Everything in this repo was written and measured inside **BitNode 1**, where all
55 `BitNodeMultipliers` equal 1 and no Source-File is owned. Several scripts bake
that in as a hardcoded constant. Inside the game's RAM budget that is a
legitimate, documented trade (see the fidelity rule in CLAUDE.md) — but it means
**entering a new BitNode silently invalidates parts of the stack**.

## Check this first, before playing a new BitNode

```bash
node tools/sim/bncheck.mjs 12          # what breaks in BN12
node tools/sim/bncheck.mjs 12 --all    # also list what still holds
node tools/sim/bncheck.mjs --survey    # one line per BitNode
```

`getBitNodeMultipliers(n, lvl)` is a pure function of the BitNode number
(`src/BitNode/BitNode.tsx:564`), so this computes the answer for a BitNode we
have **not entered yet**, from the game's own source — no Source-File, no
guessing, no waiting to be surprised.

## Survey (generated 2026-09-12, game v3.0.2)

| BitNode | violations |
| --- | --- |
| BN1 | 0 — everything here was written for it |
| BN2 | 3 |
| BN3 | 6 |
| BN4, BN5, BN6, BN7, BN8, BN9, BN13 | 4 |
| BN10 | 6 |
| BN11 | 5 |
| **BN12** | **13 of 15** |
| BN14 | 3 |

**No BitNode other than BN1 leaves the stack intact.** The two that matter most:

- **`ServerWeakenRate` / `ServerGrowthRate`** (BN2, BN11, BN12) — these are
  hardcoded in `batch.js` (`WEAKEN_PER_THREAD = 0.05`) or folded into
  `growthK`. Getting them wrong desyncs the batcher, which is the engine the
  whole run depends on. Fix before playing, not after.
- **`CloudServerSoftcap`** (almost everywhere) — cloud pricing stops being
  linear, so `buyserv`'s concentrate-don't-level policy becomes the wrong
  shape. BN11 sets it to **2**, which makes a 1PB server ~32,000× the flat-rate
  price.

## Structural assumptions the multipliers do not capture

These are not `BitNodeMultipliers` and `bncheck` only lists them as reminders:

- **No Source-File 4.** `cmd.js`, `augbuy.js`, `torbuy.js`, `nfg.js` and
  `backdoor.js` all drive the DOM because `ns.singularity.*` throws. They keep
  working with SF4 — they are just needlessly fragile and slow compared with the
  API that becomes available.
- **Intelligence is 0** (unlocks with SF5). `batch.js` omits the intelligence
  terms from the hacking formulas and `reputation.ts` adds `int/3` to work gain,
  so every estimate becomes low once intelligence exists.
- **Hacknet nodes, not servers** (SF9 changes this). `hacknet.js` buys nodes to
  qualify for Netburners; with SF9 they become servers with a different API,
  different costs, and they contribute RAM.
- **`go.cheat` needs SF14.2.** Already gated correctly in `go.js`; the cheat
  policy in `go-cheat.js` only becomes live there.
- **Joining a faction always needs a trusted click** (`FactionsRoot.tsx:89`).
  This is not BitNode-dependent and never becomes automatable.

## Keeping this honest

`bncheck.mjs` is the source of truth; this file is the narrative. When a script
gains a new hardcoded constant that depends on a multiplier, **add it to the
`ASSUMPTIONS` table in the same commit** — the table is what makes the next
BitNode a checklist instead of a series of mysterious failures.
