# Prior art: Bitburner stock-market bots

Researched 2026-09-25. Mechanics are checked against the game source (`bitburner-src` `dev` branch
read on 2026-09-25, v3.0.x; files `src/StockMarket/{StockMarket,Stock,StockMarketHelpers,PlayerInfluencing}.ts`,
`src/StockMarket/data/InitStockMetadata.ts`, `src/DarkNet/effects/effects.ts`) and the v0/v1/v2/v3
changelogs. Reddit could not be fetched (blocked); Reddit links below are cited second-hand and unverified.

## 1. Sources

| Source | Version / date | What it does | What we take |
|---|---|---|---|
| [alainbryden `stockmaster.js`](https://github.com/alainbryden/bitburner-scripts/blob/main/stockmaster.js) | Maintained. Last commits 2026-02-22 and 2025-07-19 ("Prepare for breaking changes in v3.0.0"), so it targets v2.x through v3 and already uses the v3 names (`hasTixApiAccess`). | A long/short trader that works before 4S (pre-4S) and after. It estimates the forecast from up/down counts, detects the global 75-tick cycle by cross-stock "inversion" agreement, avoids buying close to the cycle boundary, checks commission and spread, and buys 4S automatically. | The best reference design. See section 2. |
| [Official doc `stockmarket.md`](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Documentation/doc/en/basic/stockmarket.md) | v3 (dev) | Qualitative: spread, flat commission, the hidden second-order forecast, hack/grow/company-work influence, and that large transactions move the forecast. | Confirms forecast-only impact and gives no numbers. |
| [Readthedocs fork, stock market page](https://bitburner-fork-oddiz.readthedocs.io/en/latest/basicgameplay/stockmarket.html) | v1.6.4 (2022) | Same text as the official doc. Already says transactions influence the forecast, not the price. | Only for history. |
| [API docs `bitburner.stock.md`](https://github.com/bitburner-official/bitburner-src/blob/dev/markdown/bitburner.stock.md), [`StockMarketConstants`](https://github.com/bitburner-official/bitburner-src/blob/dev/markdown/bitburner.stockmarketconstants.md) | v3 | `nextUpdate`, `getConstants` (`msPerStockUpdate`, `msPerStockUpdateMin`, `TicksPerCycle`, `StockMarketCommission`, `WseAccountCost`, `TixApiCost`, `MarketData4SCost`, `MarketDataTixApi4SCost`). | Read the constants at runtime and don't hard-code them. |
| [DeepWiki: Stock Market](https://deepwiki.com/bitburner-official/bitburner-src/7.6-stock-market) | Auto-generated from dev (2025/26) | Summarises otlkMag, the spread and `forecastChangePerPriceMovement = 0.006`. Base costs: WSE $200m, TIX API $5b, 4S data $1b, 4S TIX API $25b. | Confirms the costs. |
| Changelogs: [v0](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Documentation/doc/en/changelog-v0.md), [v1](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Documentation/doc/en/changelog-v1.md), [v2](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Documentation/doc/en/changelog-v2.md), [v3](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Documentation/doc/en/changelog.md) | all | Dates when each mechanic was added or removed. | See section 5. |
| [Herzfinsternis/bitburner](https://github.com/Herzfinsternis/bitburner) (README, `stockHist.js`, `stockBB2.js`) | June 2022 (v1.x/v2.0). Written for the BN8 "no 4S" challenge. | Pre-4S trading by linear-regression slope of price over 70 points plus a "slope of slope" correction. Author reports roughly 40-60%/h from $250m. | Trend-following on price works, but more slowly than counting up/down ticks. Hand-tuned, no cycle model. It links the Reddit thread [vlup0m "BN8 without 4S market data"](https://www.reddit.com/r/Bitburner/comments/vlup0m/bn8_without_4s_market_data/), which we did not fetch. |
| [Steam: "Ghost of wall street Bitnode"](https://steamcommunity.com/app/1812820/discussions/0/3200370471678237793/) | Jan 2022 (v1.x) | BN8 openers. Max-buy JGN at reset, run `grow` on joesguns with `{stock:true}` and work for Joe's Guns: reportedly about 600% in 20h, enough for $1b 4S. Also an EMA forecast `f = 0.99 f + 0.01·[up]`. | Manipulation plus company work is a known BN8 opener. EMA α=0.01 (about 100-tick memory) is too slow for 75-tick cycles. |
| [Steam: "Stock Market" discussion](https://steamcommunity.com/app/1812820/discussions/0/3601219829880011567/) | 2022-23 (v2.x) | Folk rules: count about 15 recent ticks (10 up / 5 down means about 0.66), buy at forecast >0.6, sell below 0.5, don't poll faster than 4s. | 15 ticks gives a standard error of about 0.12, which is too noisy (section 3). |
| [Steam guide "Stock Market for Dummies"](https://steamcommunity.com/sharedfiles/filedetails/?id=2860330999), [Steam guide "Script for BN8"](https://steamcommunity.com/sharedfiles/filedetails/?id=2812251114) | 2022 (v1.x/v2.0, going by the ID range) | Beginner 4S threshold traders. | We could not fetch them (HTTP 429). Listed for completeness. |

## 2. Community bots in detail

### alainbryden `stockmaster.js` (v2.x to v3)

Constants and defaults (verbatim from source):
- `marketCycleLength = 75`, `maxTickHistory = 151`, `inversionDetectionTolerance = 0.10`,
  `inversionLagTolerance = 5`, `inversionAgreementThreshold` starts at 6 and after the first detection rises to
  `max(14, count)`. The comment notes "33 total stocks * 45% inversion chance each cycle = ~15 expected inversions per cycle".
- Pre-4S windows: `pre-4s-min-tick-history 21`, `pre-4s-forecast-window 51` (the comment still says "Default 76"),
  `pre-4s-inversion-detection-window 10`, `pre-4s-min-blackout-window 10`, `pre-4s-minimum-hold-time 10`.
- Thresholds: pre-4S buy needs ER > 15 bp (0.0015) and `|p-0.5| > 0.15`, and sells below 5 bp. With 4S it buys above
  1 bp and sells at 0 (that is, when p crosses 0.5).
- Sizing: `fracH 0.2` (cash kept in hand), `fracB 0.4` (only buy when cash/corpus exceeds this), `diversification 0.34`
  (maximum share of the portfolio in one stock pre-4S), `buy-4s-budget 0.8`.

Algorithm:
- **Forecast estimate** = fraction of up-ticks in the window `min(forecastWindow, ticksSinceLastTrustedInversion)`, so
  history from before a detected flip is dropped. `probStdDev = sqrt(p(1-p)/n)`. Pre-4S it shrinks the edge by 1 σ toward
  0.5 before use (`conservativeProb`).
- **Volatility estimate** pre-4S = the largest single-tick |Δp|/p in the 151-tick history. This is an estimate of `mv/100`,
  the maximum of `av`.
- **Expected return** = `vol · (p − 0.5)`. This is exact to first order: E[r] = E[av]·(2p−1) and E[av] = (mv/100)/2.
- **Inversion test**: `detectInversion(p1, p2)`, where p1 is the forecast over ticks [10, 85) ago and p2 the forecast over
  the last 10 ticks. It fires when they sit on opposite sides of 0.5 by at least 0.05 and `p2 ≈ 1−p1` within 0.10.
- **Cycle phase detection**: if at least `inversionAgreementThreshold` stocks show an inversion on the same tick, the bot
  sets `detectedCycleTick = 10` (the detection lag of the 10-tick window). Per-stock inversions are only "trusted" while
  the phase is in [5, 15] ticks after the boundary, which filters false positives. With 4S it compares the forecast
  against the previous tick, and the flip is visible at tick 0.
- **Timing guards**: it does not buy if `ceil(log(ask/bid)/log(1+|ER|))` (ticks to recover the spread) is at least the
  ticks left in the cycle. It skips buys whose expected gain before the boundary, `N·price·((1+|ER|)^ticksLeft − 1)`, is
  at most 2× commission. If the cycle has not been detected yet, it assumes the boundary is at most 10 ticks away.
- **Shorts**: enabled with SF8.2 or inside BN8. Short value is `shares·(2·avgPrice − ask)`.
- **4S purchase**: once the corpus can cover `4S data + 4S API` (base $1b + $25b, times the BitNode multipliers) within
  80% of the corpus, it liquidates if needed and buys.
- **Not modelled**: the forecast degradation caused by its own trades, the second-order forecast, manipulation, and Kelly
  sizing. It sizes by fixed fractions and the diversification cap.

### Other approaches seen
- **Up/down count over a short window** (Steam, about 15 ticks). Simple but noisy.
- **EMA of the up indicator** (Steam BN8 thread, α=0.01). Its memory spans more than one cycle, so after a flip the
  estimate lags badly.
- **Price regression slope** (Herzfinsternis). Price is a multiplicative walk with random step size, so the slope mixes
  the direction edge with volatility. Counting ticks isolates p.
- **Pure 4S threshold bots** (buy when forecast > 0.6, sell below 0.5). Most beginner scripts do this.

## 3. Mechanics: what is known, checked against the source

**Tick.** `processStockPrices` runs every `msPerStockUpdate` = 6s. It drops to `msPerStockUpdateMin` = 4s while stored
(offline) cycles are being consumed. `ns.stock.nextUpdate()` (added v2.5.1) resolves after each update and costs 0GB.

**Price step.** One `v = Math.random()` is drawn per tick and **shared by all stocks**, and `av = v·mv/100`. Each stock
then draws its own direction with `chc = (50 ± otlkMag)/100`: up means `price·(1+av)`, down means `price/(1+av)`. So in a
given tick every stock's |log-return| is `ln(1+v·mv_i/100)` with the same v. The ratio between two stocks' moves reveals
the ratio of their mv, and a single tick reveals v times mv. No community script uses this. It would let a bot pin
volatility down quickly without 4S.

**Forecast.** `getForecast = (b ? 50+otlkMag : 50−otlkMag)/100`.
- Each tick otlkMag moves by `otlkMag·av`. The step is ×10 if otlkMag < 5 and set to 1 if otlkMag ≤ 1.
- It moves toward the second-order forecast `otlkMagForecast` with increase-chance `(50 + clamp(ff − absForecast, ±45))/100`.
- **Also in the source:** `otlkMagForecast` itself takes a ±(step/2) random walk with 50/50 odds every tick
  (`cycleForecastForecast`).
- Typical drift is small: otlkMag 10 with av around 0.4% gives about 0.04 points per tick. Within a cycle, p is roughly
  stationary.

**Cycle and flip.**
- A single global counter `ticksUntilCycle` is shared by all stocks. It starts at `randomInt(1, 75)` when the market is
  initialised; the random start was added in v2.5.2, "randomization to timing for forecast change events".
- Every 75 ticks each stock independently flips `b` and sets `ff → 100−ff`, with probability 0.45.
- Because the phase is shared, cross-stock agreement (about 15 of 33 stocks flipping on the same tick) identifies the
  phase. This is alainbryden's method.

**Soft cap.**
- `cap = randomInt(1e3·price0, 25e3·price0)`. It is hidden and re-rolled at every reset.
- While `price >= cap`, `chc = 0.1` and `b = false`. The `b=false` persists after the price drops back below the cap,
  until a later flip.
- In practice the cap is only reached after very long runs.

**Spread.** `ask = price·(1+spread%)` and `bid = price·(1−spread%)`. Across the 33 stocks `spreadPerc` is 0.1–2.0%
(median range 0.3–1.0%), so a round trip costs about 2·spread%. Ticks needed to earn the spread back ≈
`ln(ask/bid)/ln(1+|ER|)`.

**Commission.** $100k per transaction (`StockMarketCommission`), charged on buy and on sell. It only matters for small
corpora.

**maxShares.** `round(0.2·totalShares/1e5)·1e5`, where `totalShares = marketCap/price0`. That is about 2.4m–23m shares per
stock and counts long and short together. It is the binding size limit once the corpus is large.

**Transaction forecast degradation (v0.47.1+). There is no price impact.**
- Every `shareTxForMovement` shares traded, buys and sells alike, lower otlkMag by 0.006, with a floor at 5
  (`StockForecastInfluenceLimit`). A floor at 5 means forecast 0.55 or 0.45, and stocks already below 5 are unaffected.
- **Also in the source:** `otlkMagForecast` is lowered by `0.006·mv/100` per chunk.
- **Also in the source:** the `shareTxUntilMovement` counter carries over between transactions and regains only +10
  shares per tick. Splitting an order therefore does not reduce the degradation.
- `shareTxForMovement` is 12k–216k (random per stock within its range). A full maxShares position is about 20–480
  chunks, which costs roughly 0.1–2.9 otlkMag points on entry and the same again on exit.
  - Example: ECorp at otlkMag 19 (p 0.69) with about 356 chunks loses about 2.1 points, to p ≈ 0.67.

**Player influence (all act on `otlkMagForecast`, not on price or otlkMag directly).**
- `hack(..., {stock:true})`: with probability `moneyHacked/moneyMax`, ff −0.1 (toward bearish).
- `grow(..., {stock:true})`: with probability `moneyGrown/moneyMax`, ff +0.1.
- Company work: with probability `0.002·cycles`, ff +(0.001·performance).
- Because otlkMag chases ff only stochastically and ff also random-walks, manipulation is slow. It pays mainly by pushing
  ff far past the current forecast so the drift stays one-sided. A flip then mirrors ff, which turns the manipulation
  against you.

**v3 DarkNet.** `getDarknetVolatilityMult(sym)` multiplies `mv` by up to ×4 while "stock promotions" charges are active.
The charges decay ×0.4 each 75-tick cycle, and `getVolatility` includes this multiplier. No prior art covers it yet.

**Access and costs (base, × BitNode multipliers).**
- WSE $200m, TIX API $5b, 4S data $1b, 4S TIX API $25b. BN9: ×5 and ×4.
- Since v3.0.0 TIX access no longer requires a WSE account.
- Shorts need BN8 or SF8.2. Limit/stop orders need SF8.3.
- Installing re-initialises the market and **all shares are lost without refund**, so liquidate before installing.

**BN8.**
- $250m at the start and after every install. WSE and TIX are free.
- `ScriptHackMoneyGain = 0`: hack drains the server (`ScriptHackMoney 0.3`) but pays nothing (v0.49.2, 2021).
- Money comes only from trading (plus casino and similar). Hack and grow therefore only serve as forecast levers.
- There is also a challenge: "Destroy BN8 without purchasing 4S".

## 4. Theory

### Forecast estimation from tick counts
- Up-ticks over n ticks follow Binomial(n, p). The MLE is k/n with standard error `sqrt(p(1−p)/n)`. At p=0.6 that
  is 0.126 for n=15, 0.069 for n=51 and 0.057 for n=75.
- The longest useful window is the time since the last cycle boundary, so the estimate resets with up to 45% chance
  every 75 ticks.
- A better estimator than a fixed window: a Beta posterior per stock, reset (mixed) at each known boundary. The prior
  after a boundary is `0.55·Beta(old) + 0.45·Beta(mirrored old)`.

### Flip detection: sequential testing and change points
- Each observation carries log-likelihood ratio `±ln(p/q)` (H1: flipped). The per-tick information is the KL
  divergence `D = (p−q)·ln(p/q)`.
- A Wald SPRT or Page's CUSUM ([Page 1954](https://doi.org/10.1093/biomet/41.1-2.100)) with threshold `h = ln(1/α)`
  has an expected delay of about `h/D`. With α≈0.05 (h≈3):

  | p | D (nats/tick) | expected delay |
  |---|---|---|
  | 0.55 | 0.020 | ~150 ticks (useless) |
  | 0.60 | 0.081 | ~37 |
  | 0.65 | 0.186 | ~16 |
  | 0.70 | 0.339 | ~9 |
  | 0.75 | 0.549 | ~5.5 |

  This is why pre-4S bots only trade stocks with |p−0.5| ≳ 0.15. alainbryden's 10-tick window with a 0.10 tolerance
  is a crude fixed-sample version of this test.
- **Bayesian online change-point detection** ([Adams & MacKay 2007](https://arxiv.org/abs/0710.3742)) with a known
  hazard fits this setting well. The hazard is 0.45 exactly at the phase tick and 0 elsewhere, so the posterior needs
  no run-length search:
  `P(flip | k ups in n post-boundary ticks) = 0.45·L1 / (0.45·L1 + 0.55·L0)`, where `L0 = p^k q^(n−k)` and
  `L1 = q^k p^(n−k)`.
- The phase itself has 75 hypotheses, and the likelihood of each can be summed over all 33 stocks. This detects the
  phase faster and more reliably than a vote threshold.
- With 4S the flip is observed directly at the boundary tick: the forecast jumps to 1−p.

### Kelly sizing for a biased multiplicative walk
- **Even-money bet** (win +1 w.p. p, lose the stake w.p. q): f* = p − q. **This does not apply here**, because a tick
  never loses the stake.
- **Walk with up factor (1+a) and down factor 1/(1+a):** the per-tick return is +a or −a/(1+a). Maximising
  `p·ln(1+fa) + q·ln(1 − f·a/(1+a))` gives `f* = (p(1+a) − q)/a`.
  - Example: p=0.6, a=0.01 gives f* ≈ 20.6.
  - With random `a ~ U(0, m)` (m = mv/100), for small a: f* ≈ `(2p−1)·E[a]/E[a²] = 1.5(2p−1)/m`, which is tens of
    times the corpus.
  - **Conclusion:** unlevered (f ≤ 1), Kelly always says put everything in the best edge. Kelly is not the binding
    constraint. The binding constraints are flip risk, detection delay, the spread, maxShares and self-inflicted
    forecast degradation.
- Log growth of a full position ≈ `(2p−1)·E[ln(1+a)] ≈ (2p−1)·m/2` per tick.
  - Example: ECorp at p=0.69 and m≈0.45% gives about 0.086%/tick, or about 6.6% per 75-tick cycle before costs.
- Where fractional-Kelly caution belongs pre-4S is in the uncertainty about p. The 1σ shrinkage in alainbryden is
  equivalent in spirit. See [Kelly criterion](https://en.wikipedia.org/wiki/Kelly_criterion) and
  [Thorp 2006](https://www.edwardothorp.com/wp-content/uploads/2016/11/TheKellyCriterionAndTheStockMarket.pdf).

### Market impact literature: why it mostly does not transfer
- **Almgren–Chriss** (J. Risk 3(2), 2000; [preprint](https://www.smallake.kr/wp-content/uploads/2016/03/optliq.pdf)) trade off
  temporary/permanent *price* impact (linear in trading rate) against timing risk. That is why real orders are sliced
  over time.
- **The square-root law** ([Tóth et al. 2011](https://arxiv.org/abs/1105.1694); Bouchaud) holds that impact ∝ σ·√(Q/V).
- **Bitburner (v0.47.1+) differs on three counts:**
  - There is zero price impact. You always fill at ask/bid.
  - Impact falls on the *drift* (otlkMag), not the price. It is linear in total shares, permanent apart from slow
    re-drift toward ff, and path-independent, because the counter regenerates only 10 shares per tick.
  - Buys and sells both push toward 50.
- So slicing is pointless. The real cost of trading N shares is the lost future edge on the whole remaining position:
  `ΔotlkMag = 0.006·N/shareTxForMovement` per leg, applied to every share held until exit.
  - That makes the optimal size a concave problem: the marginal share lowers the drift of all the others.
  - It also makes churn (exit and re-enter within a cycle) doubly expensive.
- The only Almgren–Chriss-like trade-off left is *when* to exit near a possible flip. Waiting for flip confirmation
  costs the detection delay, while exiting early costs the spread and commission on re-entry.

## 5. What is outdated or wrong in older sources

| Claim / mechanic | Status |
|---|---|
| Large orders move the **price**, including mid-transaction | Existed only from **v0.47.0 (May 2019) to v0.47.1 (June 2019)**. v0.47.1 changelog: "Transactions no longer influence stock prices (but they still influence forecast)". Every v1/v2/v3 source should describe forecast-only impact. Any v1-era text claiming price impact is wrong even for v1. |
| `ns.stock.*` namespace came in v2 | It came in **v0.58.0 (Oct 2021)**: "All stock market functions are now under the 'stock' namespace". v1 migration: `getStockForecast` became `stock.getForecast` and so on. |
| v2 renames | v2.0.0 (2022-07): `stock.buy/sell/short` became `buyStock/sellStock/buyShort`. |
| v3 renames | v3.0.0 (2026-05): `hasWSEAccount` → `hasWseAccount`, `hasTIXAPIAccess` → `hasTixApiAccess`, `has4SDataTIXAPI` → `has4SDataTixApi`; constants `WSEAccountCost` → `WseAccountCost`, `TIXAPICost` → `TixApiCost`. TIX no longer requires WSE. `getStockFromSymbol` duplicate removed (v3.0.1). |
| Cycle aligned to market init (phase known = 0) | Before v2.5.2 (Dec 2023) the first flip came 75 ticks after init. Since then the start is random in 1–75. Scripts that count from reset are wrong. |
| Manual terminal hack earns money in BN8 | Removed by v0.49.2 (2021). BN8 hack pays $0. |
| 4S TIX API $20b | Raised to $25b in v0.43.0 (2019). |
| Polling with `sleep` for tick detection | Since v2.5.1 `ns.stock.nextUpdate()` is the correct method, and it costs 0GB. |
| alainbryden comment "forecast-window Default 76" | Actual default is 51. |
| Volatility is static per stock | In v3, DarkNet stock promotions can raise effective volatility up to ×4 (it decays per cycle). |

## 6. Implications for our design

1. **Tick sync.** Drive the loop from `await ns.stock.nextUpdate()` (0GB) and read constants from
   `ns.stock.getConstants()`.
2. **Phase.** Keep a 75-way likelihood over the global phase, summed across all 33 stocks. With 4S, flips are
   observed exactly and the phase locks after the first boundary. Pre-4S, use the Bayesian mixture at the known
   boundary instead of fixed windows.
3. **Volatility pre-4S.** Use the shared-v structure. The ratios of |ln(p_t/p_{t−1})| across stocks within a tick
   identify mv_i/mv_j, and the maximum over time identifies mv. This converges much faster than per-stock max-move.
4. **Sizing.** Kelly says all-in unlevered, so allocate by expected log growth net of costs. The costs are spread,
   commission, and forecast degradation that is linear in shares traded (both legs, all held shares). Cap at maxShares.
   Rank by `(2p−1)·E[ln(1+a)]` over the ticks until the next boundary, minus costs.
5. **Flip handling.** With 4S, exit on the boundary tick if the forecast crosses 0.5. Pre-4S, only hold stocks whose
   |p−0.5| makes the expected CUSUM delay short (≳0.15). Weigh early exit against the expected loss during the
   detection delay.
6. **No churn.** Every share traded degrades the forecast permanently, and splitting doesn't help, so avoid partial
   rebalancing.
7. **Install.** Liquidate before any install, because shares vanish without refund. In BN8, $250m returns at each
   install.
8. **BN8 levers.** `grow` with `{stock:true}` on longs' servers, `hack` with `{stock:true}` on shorts' servers, and
   company work all act on ff at ±0.1 per success (0.001·perf for work). Price them against the flip risk that
   mirrors ff.
