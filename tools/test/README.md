# `npm test` — does this collection work in a BitNode we have not played?

Everything in this repo was written and measured in one environment: BitNode 1,
Source-File 1, home grown to terabytes. None of those are properties of the
code. This suite asserts the properties that must hold at **any** home RAM, at
**any** Source-File level, and under **any** BitNode multipliers, and it is
expected to be red whenever they do not.

```bash
npm test                        # everything
npm test -- ram sfgate          # only the named modules
npm test -- --warn-fatal        # treat WARN as failure too
```

Exit codes: `0` all pass, `1` at least one FAIL, `2` a check module itself threw
(deliberately not the same as "the collection is fine").

## Adding a check

Discovery is a glob over `tools/test/*.test.mjs`. There is no registry to edit
and no import list to merge — drop a file in, name it `<thing>.test.mjs`, and it
runs. Support modules must **not** match that pattern, which is why the RAM
calculator is `ram.mjs` and its checks are `ram.test.mjs`.

```js
import { Check } from './harness.mjs'

export async function run() {
  const c = new Check('X1', 'what this asserts')
  c.examined(n)                      // how many things were actually looked at
  c.note('a measurement, printed pass or fail')
  c.fail('what is wrong', 'detail')  // sets exit code 1
  c.warn('what is wrong', 'detail')  // printed, not fatal
  return c                           // or an array of Checks, or a promise
}
```

**FAIL vs WARN.** FAIL means a playthrough is broken somewhere the stack
actually reaches — anything in `boot.js`'s `STACK`, `watchdog.js`'s `WATCHED`,
or anything they import. WARN means a genuine defect in code no boot path runs.
Both print in full; only FAIL is fatal. The split exists so the suite can report
the long tail of dormant-script problems without going permanently red, because
a suite nobody can keep green gets deleted.

**Print what you checked, not only what you found.** A check that silently
examined zero files prints exactly like a check that passed. `c.examined()` and
`c.note()` are how that is made visible.

## What is here

| module | asserts |
| --- | --- |
| `ram.test.mjs` | **A** the collection is viable at 8/32/128GB home and under every SF4 pricing regime; **B1** no identifier collides with a priced ns name |
| `placement.test.mjs` | **B5** every plan `batch.js` produces can actually be placed on a real fleet |
| `sfgate.test.mjs` | **C1** `sfgate.js` still matches game source; **C2** nothing open-codes a Source-File comparison; **C3** every gated API family is routed through `sfgate.js`, and the family table is complete against the game |
| `bnconst.test.mjs` | **D** every BitNode-multiplier-dependent constant in a root `.js` is registered in `bncheck.mjs`, and every registration is still true |

Support modules (not discovered): `harness.mjs`, `ram.mjs`, `build-ram.mjs`.

## The RAM calculator

`tools/test/ram.mjs` does not reimplement Bitburner's RAM accounting. It bundles
the game's own `Script/RamCalculations.ts` with esbuild and calls it. That
matters because the game prices every **bare identifier by name**, recursing the
whole `RamCosts` tree — which is how a local variable called `attempt` cost a
script 10GB via `ns.codingcontract.attempt`, and a local called `probe` cost
0.2GB via `dnet.probe`. A "count the `ns.` call sites" checker gets that wrong
silently.

It is **calibrated on every run**: `ram.test.mjs` asks the live game for
`calculateRam` on ten scripts over the control port (read-only) and prints the
error whether it passes or fails. If the daemon is unreachable it prints
`*** UNCALIBRATED ***` in as many words rather than staying quiet.

The bundle is rebuilt automatically when `~/Repos/bitburner/src` is newer than
`ram.bundle.mjs`; `node tools/test/build-ram.mjs` forces it.

Two things it deliberately does not export, both because they drag the entire
React UI into the bundle (15,643 modules against 53, and a DOM needed at module
init): `canAccessBitNodeFeature` and `checkCheatApiAccess`. Those two rules are
checked against their source text instead.

## Self-tests

`B1` feeds itself the two identifier collisions this repo has actually hit
(`attempt` 10GB, `probe` 0.2GB) and fails if it does not detect them. A detector
that has never fired is indistinguishable from one that cannot fire, and
"0 collisions found" is exactly what a broken one prints.

## What this suite does not cover

- **Runtime behaviour.** Everything here is static or offline. A script that
  compiles, fits in RAM and gates its APIs correctly can still be wrong.
- **Anything outside root `.js`.** `docs/` carries several multiplier-dependent
  numbers that `bnconst.test.mjs` does not scan.
- **Whether a WARN matters.** The FAIL/WARN split is reachability from
  `boot.js`/`watchdog.js`, which is a proxy for importance, not importance.
