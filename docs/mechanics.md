# Mechanics matrix — every faucet, against the one objective

**Objective.** Minimise the node's simulated exit time: `exitplan.bestExitPolicy`
/ `countexit`, wrapped by the Bayesian plan layer (`plan.js` + `bayes.js`,
committed to `/tel/plan.txt`, design in `docs/bayes.md`). A mechanic is
**aligned** when its use is decided by a with-vs-without comparison on that
simulator (directly, or through `plan.decide*` on the shared draws). It is
**proxy** when a local objective decides it (named). It is **unused** when
nothing in the stack performs it although the node allows it, and **gated**
when the game forbids or zeroes it here.

**State audited:** BitNode 8, SF1.2 / 2.1 / 4.2 / 5.1 / 10.1, 5 sleeves
(memory 100), 30 augmentations installed. Exit: hacking 3000 (x
WorldDaemonDifficulty 1), Daedalus ($100b, hacking 2500, 30 augs) -> The Red
Pill (2.5M rep, donatable at favor 0) -> w0r1d_d43m0n. Game source v3,
`~/Repos/bitburner/src`; paths below are relative to it.

**BitNode 8 multipliers that decide the matrix** (`BitNode/BitNode.tsx:764-791`;
everything else at the default 1): ScriptHackMoneyGain **0** (hacking drains at
ScriptHackMoney 0.3 but pays nothing — `NetscriptHelpers.tsx:648`),
CompanyWorkMoney / CrimeMoney / HacknetNodeMoney / ManualHackMoney /
CodingContractMoney / InfiltrationMoney / DarknetMoneyMultiplier **0**,
FavorToDonateToFaction **0** (donations from favor 0, `donation.ts:16-17`),
GangSoftcap / GangUniqueAugs **0**, Corporation* **0**, BladeburnerRank **0**,
StaneksGiftExtraSize **-99**, CloudServerSoftcap 4. Start money $250m and a
re-initialised market at every install (`Prestige.ts:38,158-170`). So the
only money is the stock trader's compounding return, and reputation is a
price.

Counts (rows below): **aligned 17 · proxy 13 · unused-but-available 6 · gated 11.**

## Money

| mechanic | BN8 gate | script(s) | decided by |
| --- | --- | --- | --- |
| Hacking money (batcher) | ScriptHackMoneyGain 0: **gated** (pays $0) | batch.js | — (the batcher runs in exp mode, `expfarm.expMode`) |
| Stock trading (the book) | open; shorts and orders allowed (`StockMarket.ts:47`, `bitNodeN !== 8` test) | stock.js, stockstrat.js | **proxy**: per-tick edge / Bayes signals, always on. Its measured return is the exit's `capitalReturnPerSec` (bayes posterior), so it is the objective's input, not its decision |
| Stock manipulation by grow/hack on `manip` hosts | open (ScriptHackMoney 0.3 still moves prices) | batch.js + expfarm.manipVerdict | **aligned**: exit with vs without the manip hosts (two `bestExitPolicy` runs) |
| 4S TIX API ($25b x FourSigmaMarketDataApiCost 1) | open (`StockMarketCosts.ts`) | stock.js -> `stockplan.buy4SVerdict` | **proxy**: trader WEALTH over the remaining life, with vs without; the exit comparison in progress.js is dead code (`edgePerHour = null`, progress.js ~2722) |
| 4S data ($1b) | open | — | **unused** (the TIX API subsumes it for a script) |
| Coding-contract money | CodingContractMoney 0 and the reward is not even offered (`ContractGenerator.ts:186`): **gated** | ctauto.js | — |
| Company salary | CompanyWorkMoney 0: **gated** | — | — |
| Crime money | CrimeMoney 0: **gated** | act-crime.js (`crimeAlt` exit-sim prices it at $0 and faction work keeps the slot) | aligned, and correctly never chosen |
| Hacknet node money / hashes | HacknetNodeMoney 0; hashes need SF9 (`HacknetHelpers.tsx:34`): **gated** | hacknet.js, hashspend.js | aligned where open (`spendExit.hacknet`, `decideHashSpend`) |
| Infiltration money | InfiltrationMoney 0 and `isTrusted` (`InfiltrationRoot.tsx:74`): **gated** | infiltration.js (never launched) | — |
| Casino | `isTrusted` (`Casino/utils.ts:5`) — no multiplier in BN8, $10b cap: **gated by anticheat** | — | — |
| Gang money | GangSoftcap 0 (`Gang/formulas/formulas.ts:27,71`): **gated in effect** | gang.js | aligned (gangworth: structurally worthless, karma gate not paid) |
| Corporation | needs SF3 (`PlayerObjectCorporationMethods.ts:8`): **gated** | — | — |

## Reputation, favor, access

| mechanic | BN8 gate | script(s) | decided by |
| --- | --- | --- | --- |
| Faction work (hacking/field/security) | open; FactionWorkRepGain 1 | act-work.js via progress.js orders | **aligned** where the count gate binds (`plan.decideRoute`); otherwise **proxy**: factionplan schedule on exit-SENSITIVITY weights (`objective.exitWeights`) |
| Donations | open from favor 0 | act-donate.js (augplan batch) | **proxy**: augplan DP on exit-sensitivity weights; when to install is aligned (`plan.decideInstall`) |
| Favor (install banking) | open, but donations need none in BN8 | installgate / favor.js | aligned through the install decision |
| Company work (rep) | CompanyWorkRepGain 1 | act-company.js, companyplan.js | **proxy**: the committed route's company leg / schedule `workH` |
| Coding-contract rep (faction / all-factions / company) | open: faction rep to a RANDOM joined hacking faction at solve time (`PlayerObjectGeneralMethods.ts:514-533`), company rep to a random held job, re-rolled to faction rep with none. The only lever is WHEN a contract is solved (the joined set then); contracts on foreign servers are destroyed at install (`AllServers.ts:136` clears the map) | ctauto.js (solves on sight) | **proxy**: "solve everything now"; contractplan forecasts the rep, which never reaches the exit inputs |
| share() | open; bonus 1 + ln(threads)/25 (`NetworkShare/Share.ts:43-49`) on faction work (hacking: all of it; field/security: the hacking term), sleeves included, not company work | share.js via watchdog `shareThreads` | **proxy**: 80% of the largest free block, >= 32 threads, whenever a faction is joined — competes with the exp farm for fleet RAM, unpriced |
| IPvGO | open (no gate; SF14 doubles power) | go.js, goplan.js, go-solver.mjs | **proxy**: opponent by exit-sensitivity channel weights (`goplan.chooseOpponent`), always playing. Wins also give favor to a MEMBER faction (`Go/boardAnalysis/scoring.ts:66-78`) — unpriced |
| Faction invitations | `acceptInvitation` isTrusted in the UI; Singularity joinFaction open | act-join.js | aligned via the route / schedule targets |
| Backdoors | open | backdoor.js -> act-backdoor.js | **proxy**: every reachable story server, always |
| TOR / port openers | open | act-buyprogram.js | **aligned** in BN8 (`programExit`, `spendExit.programs`); torbuy.js is ungated elsewhere |
| Create program | isTrusted in the UI (`ProgramsRoot.tsx:96`); Singularity createProgram open | createProgram.js (never launched) | **unused** (buying is priced instead) |
| Travel | open ($200k) | act-travel.js | **proxy**: follows a join / gym / graft requirement |
| Infiltration rep | InfiltrationRep 1 but isTrusted: **gated by anticheat** | — | — |

## Exp, levels, multipliers

| mechanic | BN8 gate | script(s) | decided by |
| --- | --- | --- | --- |
| Hacking exp (exp farm on the fleet) | open (HackExpGain 1) | batch.js exp mode (expfarm.js) | **proxy**: always maximise weaken-exp; the manip carve-out is aligned |
| Home RAM / cores | open (persist through installs) | homeup.js, act-homeram.js | **aligned**: `spendExit.home` through `plan.decideSpend` (exp is the return in BN8) |
| Cloud servers | open (softcap 4) | buyserv.js, fleetshape.js | **aligned**: `spendExit.servers` |
| Augmentations (purchase) | open | progress.js augplan -> act-buyaug.js | **proxy**: augplan DP on exit-sensitivity weights (the batch); **aligned**: when to install (`plan.decideInstall`) |
| NeuroFlux Governor | open | augplan (SF4), nfg.js (no-SF4 fallback) | proxy (augplan DP); nfg.js: a money-reserve rule |
| Install timing | open | installgate / plan.decideInstall | **aligned** |
| **Grafting** (SF10.1 -> `canAccessBitNodeFeature(10)`, `PlayerObjectGeneralMethods.ts:577`) | open: baseCost x 3, no rep, no install, entropy x0.98 on every multiplier per graft | graftplan.js, act-graft.js | was **unused** (priced module never wired, and its pricing was a shortcut); now **aligned** — see Fix 1 |
| Sleeve task objective (karma / rep / exp / money) | open (SF10) | sleeve.js / sleeveplan.js | **aligned**: `plan.decideAmong` over the objectives |
| Sleeve synchronise / shock recovery | open | sleeveplan | **aligned** (`sleeveExitOf`, two exits each) |
| Sleeve faction work | open, one sleeve per faction (`Sleeve.ts:153`), FactionWorkRepGain applies, share applies | sleeve.js | aligned (the rep objective) — but the OTHER four sleeves under 'rep' fall to a money crime, which BN8 prices at $0, and are left idle (`sleeve.txt` 2026-09-26: "cannot price any crime") — **unused capacity** |
| Sleeve study / gym | open | sleeve.js | aligned under the exp objective |
| Sleeve crime (karma) | open, CrimeMoney 0 | sleeve.js | aligned (gang verdict) |
| Sleeve company work | open; moves stock prices (`SleeveCompanyWork.ts:48`) | — | **unused** (company rep unneeded; the price influence is unpriced) |
| Sleeve bladeburner / infiltrate / support | need Player.bladeburner: **gated** | — | — |
| Sleeve augmentations | open at shock 0 (`Sleeve.ts:357`) | sleeveaug.js | **aligned** (`spendExitFromRecord`) |
| Sleeve purchase / memory (Covenant) | needs BN10 (`SleeveCovenantPurchases.tsx:30`): **gated** here | sleeveaug.js | aligned where open (covenantExitOf) |
| Crime (player, karma/kills) | open | act-crime.js, bodyplan | **proxy**: joinplan blockers (hours to the invitation) |
| Gym / university | open | act-gym.js, act-course.js | **proxy**: joinplan blockers |
| Go bonuses (faction_rep, hacking_speed, hacking level...) | open | go.js | proxy (above) |
| Stanek's Gift | needs SF13 and size 9-99: **gated** | — | — |
| Bladeburner | needs SF6/7; BladeburnerRank 0: **gated** | bladeburner.js (never launched) | — |
| Intelligence | open (SF5.1: `Person.ts:184`) | — (earned by Singularity calls, installs, grafting) | **unused as a goal** — read as an input (graft time, sync) |
| SF1/SF5 multipliers, exploits (SF-1) | static | — | not a decision |

## Endgame

| mechanic | BN8 gate | script(s) | decided by |
| --- | --- | --- | --- |
| Daedalus invite | 30 augs, $100b, hacking 2500 (`FactionInfo.tsx:142`) | progress.js join step | aligned (the join money is an exit leg) |
| The Red Pill (2.5M rep, $0) | open, donatable | augplan + act-donate | proxy (augplan) — and its rep leg is **missing from the exit** until Daedalus is joined (`exitInputsOf` takes `terminalRep` from the Red Pill OFFER, which exists only once joined): the exit is short by the donation leg (~$1.5t at faction_rep ~1.6) until then |
| w0r1d_d43m0n | hacking 3000 x WorldDaemonDifficulty 1 | endgame.js | proxy: acts when the level is met |
| Illuminati / Covenant | $150b hacking 1500 combat 1200 / $75b 850 850 | — | not on the exit path (Covenant sleeves gated in BN8) |

## Fixes made from this matrix (2026-09-26)

1. **Grafting, priced by the exit and executed in the final window.**
   `exitplan` gained `finalGrafts` (paid from the final window's money once
   the balance reaches `graftStartMoney`, one at a time on the work slot,
   entropy folded in, the climb waiting for the last graft);
   `graftplan.chooseGrafts` now decides withH - withoutH on one input set and
   searches the start balance; progress.js commits it through
   `plan.decideAmong(none, grafts)` (`/tel/plan.txt` `decisions.grafts`),
   carries the committed set into every other decision's trajectory, orders
   a graft only when the committed trajectory's final window is now, and
   holds any install while a graft runs. On the live inputs (fixture
   `tools/test/fixture-bn8-graft.mjs`): **70.9h -> 23.1h** (point), eleven
   grafts, $98.6b, 13.9h of slot, starting at a $119b balance.
2. **The BN8 money integrator** (`exitplan.hoursToMoney`): compounding legs
   landed on the chord of a 2.5h step (8.03h for $250m -> $100b against the
   exact 8.50h), the warm-up was rounded up to a whole step (+2h on the hoard),
   and the level-scaled income was held for 2.5h at a time. A leg split in
   two read 3h shorter than the same money in one leg — which is exactly how
   a graft (a payment mid-hoard) would have been flattered. Now landed by
   bisection on the step's own curve, warm-up cut at its hour, and the step
   bounded by 1/100 of the leg's compounding length: split and whole agree to
   0.04h; the no-graft exit moved 73.7h -> 70.9h.

## Open gaps, ranked (not fixed here)

- **Red Pill rep leg absent before Daedalus is joined** (see Endgame): every
  exit is short by the donation leg, and every rep-producing choice (share,
  sleeve rep, contract timing, Go's faction_rep) is valued at ~0 by the exit
  until then. Pricing it from the catalogue (`snap-catalog` lists Daedalus's
  augs; the Red Pill's rep requirement is static) fixes the valuation.
- **Idle sleeves under the 'rep' objective** (four of five in BN8): give them
  the next-best task (study) — worth ~0.03-0.04h on today's inputs (+64 exp/s
  on 7,560), i.e. small.
- **4S TIX API by trader wealth, not the exit.** Under BN8 the wealth
  trajectory IS the money leg, so the proxy is close; the exit version is
  `spendExit` with the 4S regime's growth rate as the capital return.
- **share() and the exp farm** compete for fleet RAM by a free-block rule.
  With the rep leg priced, the comparison is exit(with share threads' RAM on
  the farm) vs exit(with the share bonus on faction/sleeve rep).
- **Contract solve timing**: the reward faction is drawn among the factions
  joined AT SOLVE TIME; holding contracts until only the target is joined
  (e.g. just after the final window's Daedalus join, ~4.5 contracts/h x
  ~3.5k rep) would steer ~15k rep/h at the Red Pill. Needs the rep leg priced
  first to be decided by the exit.
