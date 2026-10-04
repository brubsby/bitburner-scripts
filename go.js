// Farms IPvGO node power. Which opponent is PRICED each game (goplan.chooseOpponent);
// Daedalus (faction reputation) is only the startup default.
//
//   run go.js                      13x13 vs Daedalus, forever
//   run go.js --size 9             smaller, faster, easier to win
//   run go.js --maxms 20           think less per move (cooler, weaker)
//   run go.js --idle 500           longer pauses between moves
//   run go.js --size 13            bigger board, ~4x the CPU per playout
//
// ---------------------------------------------------------------------------
// Why bother
//
// `calculateMults()` (src/Go/effects/effect.ts:68-101) maps the Daedalus
// opponent to `mults.faction_rep`, and `p.mults.faction_rep` is a direct factor
// in getHackingWorkRepGain (src/PersonObjects/formulas/reputation.ts:19) — the
// exact quantity every faction grind here is rate-limited by. Crucially this
// runs *concurrently* with faction work: ns.go.makeMove is not player work, so
// it costs no work time, only RAM.
//
//     effect = 1 + ln(n+1) * (n+1)^0.3 * 0.002 * 1.1   (Daedalus bonusPower)
//     n=1,000 -> x1.121     n=3,000 -> x1.195     n=10,000 -> x1.321
//
// Per game: `blackScore.sum * 1.5 * winstreakMultiplier` (scoring.ts:86-89,
// difficultyMultiplier = (komi+0.5)*0.25 = 1.5 at Daedalus komi 5.5).
//
// ---------------------------------------------------------------------------
// Why search rather than heuristics
//
// The first version of this scored by hand-tuned heuristics and was wiped off
// the board — final score black 0, white 46.5 on a 7x7 — which banks exactly
// zero however many games it plays. The opponent is not a search engine: it
// picks among growth/surround/defend/expansion/pattern moves with a per-faction
// `smart` probability (src/Go/boardAnalysis/goAI.ts:176-205). A bounded MCTS
// beats that reliably, and the win streak is worth 6x (0.5x while losing, up to
// 3.0x at an 8-win streak, effect.ts:119-130), so playing well is most of the
// value.
//
// Netscript charges RAM for *ns function references*, not code size or CPU, so
// the search itself is free — this file costs the same as the heuristic version
// did. What it does cost is main-thread time, which is shared with the game's
// own loop, hence the playout budget and the periodic yields.
//
// ---------------------------------------------------------------------------
// CHEAT POLICY: as many two-move cheats as the clock allows, never a failed one.
//
// ACCESS (netscriptGoImplementation.ts:487-496, sfgate.canUseGoCheat): SF14
// level >= 2 anywhere, or level exactly 1 while inside BitNode 14. So the
// FIRST BN14 run (holding no SF14: BN14.1) has NO cheats; BN14.2 does, and
// SF14.2+ opens them in every node. Without access every ns.go.cheat call
// throws "requires Source-File 14.2".
//
//   chance(k) = min(1, 0.6 * (0.7 - 0.02k)^k * crime_success + (SF14.3 ? 0.25 : 0))
//               (:561-567; k = cheats already tried THIS game; crime_success is
//               the player multiplier — BN14's CrimeSuccessRate 0.4 does NOT
//               enter, it is applied only in Crime.ts:132)
//   k:  0     1     2     3     4     5     6     7     8     9
//       .600  .408  .261  .157  .089  .047  .023  .010  .0043 .0017
//
//   success: the effect, then the AI replies (it IS our turn)          (:517-520)
//   failure: k == 0 -> our turn is passed;                              (:528-530)
//            k >= 1 -> 10% ejected: forceEndGoGame — a loss, the streak
//            reset, and NO node power for the game (scoring.ts:101-108) (:521-527)
//
// THE ROLL IS A CLOCK. It is `new WHRNG(Player.totalPlaytime).random()`
// (:512), and one Wichmann-Hill step from a seed of T/1000 is a sawtooth in
// playtime rising 0.01693/s with a 59.06s period (golib.cheatRoll — checked
// bit-for-bit against the game's class, tools/sim/go-cheatroll-check.mjs).
// getPlayer().totalPlaytime is the same number, and an ns call runs its body
// synchronously (Netscript/APIWrapper.ts:77-82), so go-cheat.js reads T and
// calls in one tick, only when roll <= chance: every cheat it plays succeeds,
// so the eject branch is unreachable and there is no tail risk to price.
// The window is chance x 59s wide and comes round every 59s, so at k = 0-3 it
// is usually open on some turn soon and at k = 8 it needs a wait of up to a
// minute; maxWaitMs caps that. (A hidden, throttled tab advances playtime in
// 60s jumps — nearly the period — so windows are then rarely hit; harmless,
// go-cheat.js just declines.)
//
// WHAT EACH CHEAT IS WORTH (netscriptGoImplementation.ts:572-672, RAM from
// Netscript/RamCostGenerator.ts go.cheat):
//   playTwoMoves   +1 stone of tempo for us, every time.             8GB  USED
//   removeRouter   deletes ANY router — but costs our move, so vs a
//                  plain move it is -1 white stone instead of +1
//                  black: a wash except at a cutting/eye point.     8GB
//   destroyNode    an empty point goes offline — same move cost; a
//                  liberty/eye-killer, never territory for us.      8GB
//   repairOfflineNode  '#' -> empty: one point of possible territory
//                  for a whole move.                                8GB
//   getCheatSuccessChance / getCheatCount                           1GB each
// Only playTwoMoves dominates a normal move unconditionally; the other three
// need tactical reading to beat one, so they are not referenced (8GB each).
//
// MEASURED (tools/sim/go-w0.mjs --cheat, the game's own AI, 800ms solver,
// crime_success 1; harness, NOT CALIBRATED live):
//   5x5 Illuminati  none       n=60  win 30%  black 7.5   10.7k power/h
//                   blind x1   n=60  win 38%  black 6.6   12.0k  (one unseen roll a game)
//                   predicted  n=60  win 90%  black 15.9  37.7k  (2.2 cheats/game, 0 ejections)
//   5x5 Daedalus    none       n=50  win 100% black 15.7  10.2k
//                   predicted  n=50  win 100% black 16.6  11.1k  (+9%)
//   19x19 hidden    none       n=6   win 0%   black 86.7   961/h
//                   predicted  n=4   win 0%   black 89.8   876/h  (9 cheats/game,
//                   58s of waiting and a second solver round trip each: the
//                   game is lost either way, so +3 area does not pay the time)
// Priced positive on the small boards only: SETTINGS.cheat.maxSize.
// So with cheats open, 5x5 Illuminati (x8 difficulty) out-earns everything by
// ~3.5x; the Thompson posterior learns that from the live outcomes.
//
// RAM: the calls live in go-cheat.js (11.1GB, exec'd only when the gate is
// open), because Netscript bills every ns function in the import graph
// whether or not it is reachable. go.js itself gains nothing: exec, isRunning
// and read were already referenced. Each game's cheats are logged in
// /tel/go.txt (`cheat`, `cheatLog`) and each helper run in /tel/go-cheat.txt.
//
// ---------------------------------------------------------------------------
// THE OPPONENT MODEL (2026-10-03). The opponent is not an adversary; it is the
// game's own getMove (Go/boardAnalysis/goAI.ts) — a fixed rule cascade whose
// only randomness is a few WHRNG draws. tools/goai bundles that exact code
// (verified reply-for-reply against the game, tools/goai/check.mjs) and the
// solver's `model` backend (golib.chooseMoveModel) searches against it as a
// chance node instead of against a minimax phantom. On boards up to
// SETTINGS.model.maxSize every request asks for it, with the opponent's name
// and ns.go.getMoveHistory() (the AI's superko filter reads previousBoards).
// Measured headless (tools/sim/go-w0.mjs, the game's own AI, 800ms, a fresh
// paired offline-node layout per game — the old 30% figure below was ONE
// layout, see tools/sim/go-board.mjs):
//   5x5 Illuminati   uct 30% (n=30)  ->  model 99% (n=70); every other
//   opponent 97-100% (goplan POWER_PER_HOUR has the table)
// Full per-opponent table: the MODEL block above SETTINGS. A solver that
// cannot load the model answers with uct and says so (`backend`/`fallback`
// in its reply); modelHealth() turns that into health 'warn'.
//
// ---------------------------------------------------------------------------
// CPU budget — this runs forever in the background on someone's laptop.
//
// The search is time-boxed rather than playout-boxed: `--maxms` caps the
// milliseconds spent thinking per move, and `--idle` sleeps between moves, so
// average CPU is roughly maxms/(maxms+idle) of one core — about 15% at the
// defaults. A playout count cannot bound CPU because the cost of a playout
// scales with board size and occupancy, so the same budget behaves completely
// differently on 9x9 and 13x13.
//
// 9x9 is the default deliberately: playout cost scales with the number of
// points, so 13x13 is roughly 4x the work per playout for a multiplier that
// grows only as ln(n)*n^0.3. Smaller boards are also easier to hold a lead on,
// and the win streak is worth up to 3x — more than the extra territory.
// ---------------------------------------------------------------------------

import { chooseMove, applyMove, cheatChance, cheatWaitS, powerObjective } from 'golib.js'
import { canUseGoCheat, canJoinBladeburner, sfLevel } from 'sfgate.js'
import {
  chooseOpponent,
  nodePowerFromBonus,
  OPPONENTS,
  gameName,
  keyOfGame,
  W0,
  W0_PRIOR,
  W0_MEASURED_MIN,
  W0_FILE,
  OBS_FILE,
  THOMPSON,
  WIN_RATE,
  POWER_PER_HOUR,
  parsePosterior,
  posteriorOf,
  updatePosterior,
  drawWinRates,
  w0Eligible,
  routeOf,
  hackLevelWeight,
  exploreW0,
  w0RecordAdd,
  w0Obs,
  obsDue,
  weightsFor,
  solverVersion,
  armPosterior,
  armDraw,
  armPrior,
  splitArm,
  rateScale,
  armVersion,
  ARM_SIZES,
} from 'goplan.js'
// Pure data module (no ns surface): the BitNode table, for GoPower.
import { bitNodeMults } from 'bitNodeMultipliers.js'
// Free to import: status.js references only ns.write (0GB). See its header.
import { reporter, describe, record } from 'status.js'

// RE-CHECKED 2026-10-03 with the current solver (tools/sim/go-study.mjs +
// go-study-report.mjs: go-w0.mjs games, paired fresh layouts, mirror pass,
// live clock from the AI's waitCycles and pattern rows, effect.ts payout with
// streak and difficulty multipliers). Best power/h per opponent, any solver:
//                 5x5            7x7           9x9           13x13 (uct, n=3)
//   Illuminati    50201 model    3519 model    3721 model    3010
//   Daedalus       9657 model    4882 uct      8772 uct      3570
//   Tetrads        9629 model   10045 uct*     4628 uct        -
//   SlumSnakes     8574 uct      8513 uct      5894 uct        -
//   TheBlackHand   7393 model    5919 model    5614 model      -
//   Netburners     5398 model    4554 model    3543 uct      3126
// (* n=8, 8/8 won; within noise of 5x5.) 5x5 stays best for every opponent;
// Illuminati's x8 difficulty exists only there. 30 games/arm at 5x5, 6-8 at
// 7/9. Live CHECK passed (Tetrads 5x5: harness 93.3% vs live 92.7%).
//
// Board size and pacing are MEASURED, not chosen — 1,099 games against the
// game's own getMove (tools/sim/go-boardsize.mjs).
//
// Node power accrues every game, win or lose:
//   nodePower += blackScore.sum * difficultyMultiplier * winstreakMultiplier
// and getDifficultyMultiplier(komi, boardSize) = (komi+0.5)*0.25 does NOT
// depend on board size against Daedalus (effect.ts:132-135; boardSize is used
// only for the 5x5-vs-Illuminati special case). So a bigger board buys more
// score per game and nothing else, while costing throughput — and throughput is
// what the rate is made of.
//
// RE-MEASURED at n=110 per arm after a harness bug was found: offlineNodes.ts:13
// seeds obstacles from `Player.totalPlaytime ?? Date.now()`, offline playtime is
// 0, and `0 ?? x` is 0 — so every board in the original 1,099-game study was the
// SAME LAYOUT per size (30 fresh 5x5 boards produced 1 distinct layout; with the
// seed randomised, 136 of 200). The conclusion survived the fix; the evidence
// behind it did not, and these are the numbers from the corrected run:
//
//   power/hour   5x5 @800ms   8612   <- this
//                5x5 @400ms   7495
//                5x5 @1500ms  6818
//                9x9 @800ms   4910
//                7x7 @800ms   4484
//                13x13        1333
//
// Paired bootstrap over the 110 matched layouts puts every 5x5 arm above every
// 7x7 and 9x9 arm at p<=0.008. WITHIN 5x5 the three budgets cannot be separated
// (5x1500 - 5x800 = -1770 [-3999, +283], p~0.089) — so 800ms is chosen on the
// point estimate, not on a significant difference, and that is stated rather
// than dressed up.
//
// Live calibration against the 5x1500 arm: 1.6% error on win rate, 0.5% on
// moves per game.
//
// The 800ms figure assumes the FAST golib: profiling put 50.6% of playout time
// in the liberty walk and 0.5% in GC, and stopping that walk as soon as the
// answer is known (libsAtLeast) bought 1.87x the playouts per second. Most of
// the power/hour gain here is spending that on throughput rather than ondeeper
// search — at equal wall-clock, more search buys +2.6pp win rate and ZERO
// power/hour (p=0.969). The solver is past diminishing returns on strength.
//
// idle 100 not 400: fixed loop overhead was 745ms/turn, LARGER than the search
// itself at this budget. Pair with `--poll 150` on tools/go-solver.mjs.
//
// 19x19 — THE HIDDEN OPPONENT (w0r1d_d43m0n). Measured 2026-10-03 headless
// against the game's own getMove on the board the game deals (bitverse shape,
// 7 white handicap routers, komi 9.5; tools/sim/go-w0.mjs, report
// go-w0-report.mjs). NOT CALIBRATED live: no game against it has been played.
// Wall clock is modelled (our think + ~0.55s round trip per move, 200ms per AI
// waitCycle, 10ms per pattern row, plus the AI's compute under node).
//
//   solver @800ms                      n   win   black        power/h
//   as on 5x5 (binary win objective)   6   0%    68.5+-11.3    697+-121
//   + node-power objective, may pass   6   0%    84.3+-5.7     948+-80
//   + widening, ordered replies        6   0%    86.7+-6.4     961+-80   <- bigBoard
//   same @2500ms                       1   0%    82            ~620
//   same @400ms                        6   0%    64.0+-11.6    709+-134
//
// It is NOT winnable at this strength — 7 handicap stones plus 9.5 komi; every
// playout loses, which is exactly why the binary objective was flat — so the
// lever is black's AREA (node power credits it win or lose, x2.5 x0.5 on a
// loss) and game length. More think time bought nothing per hour.
const SETTINGS = {
  opponent: 'Daedalus',
  size: 5,
  maxms: 20,      // local fallback only; the external solver does the real search
  // idle: pause between moves. 100ms until 2026-10-04; with the external
  // solver this process does no search, so the pause bought nothing but wall
  // clock (live: 100 of the ~1545ms a 5x5 turn took). The throttle detector
  // (throttleHealth) needs >= 5s regardless, so it is unaffected.
  idle: 10,
  // replyPollMs: how often the solver's answer (/go/move.txt, ns.read: 0GB)
  // is checked. 250ms until 2026-10-04: every answer, even an instant
  // pondered one, then waited for the first 250ms poll (live, observed over
  // the RFA bridge: request -> answer 196ms, read at 250). Paired with
  // go-solver's 25ms request poll while a game is on.
  replyPollMs: 25,
  topK: 8,
  statusFile: '/tel/go.txt',
  // THE CHEAT POLICY, when the API is open (see the header): playTwoMoves,
  // only on a turn where go-cheat.js can SEE the roll succeed — so up to
  // `maxPerGame` free stones of tempo a game and never a failure. A cheat is
  // skipped while the window is estimated further than `maxWaitMs` away, and
  // abandoned for the game once chance(k) is narrower than one engine tick
  // (minChance: 200ms of a 59.06s sawtooth = 0.0034), where the window can be
  // stepped over. fromTurn: not on the first move (no shape to extend).
  // maxSize: cheats only on boards up to this size — measured positive on 5x5
  // and negative per hour on the hidden opponent's 19x19 (header).
  cheat: { maxPerGame: 12, fromTurn: 2, maxWaitMs: 10000, minChance: 0.0034, maxSize: 9 },
  // THE BIG BOARD (the hidden opponent's 19x19; any size >= 13). Sent to the
  // solver per request; 5x5 requests carry nothing and search exactly as
  // measured. Measured headless against the game's own AI on the bitverse
  // board (tools/sim/go-w0.mjs) — see the header's 19x19 block.
  //
  // backend: which engine plays the big board.
  //   'auto'   KataGo whenever the solver says an engine can answer
  //            (/go/katago.txt: the GPU host, else the local CPU engine —
  //            katagoAvailable below), else uct. THE DEFAULT: the hidden
  //            opponent's explore batch (goplan.exploreW0) plays it as soon as
  //            The Red Pill is installed, with no setting to flip.
  //   'katago' always ask KataGo (the solver answers uct, and says why, if it cannot)
  //   'uct'    never KataGo
  // Measured headless on the hidden opponent (tools/katago/README.md):
  // uct 0/6 (black ~87, ~961 power/h); KataGo b10 CPU 400 visits 4/5 (black
  // 135-145, ~2336/h, ~7s a move on two threads); the GPU figures are in the
  // README. visits: per engine — the GPU affords more in less time.
  // historyCap: boards of move history sent (the solver's ponder needs only
  // the AI's recent superko window; 19x19 boards are 361 characters each).
  bigBoard: { maxms: 800, opts: { allowPass: true, widen: { k0: 8, k: 2 }, themHeur: true }, backend: 'auto', visits: { gpu: 800, cpu: 400 }, historyCap: 8 },
  // THE OPPONENT-MODEL SEARCH (tools/go-solver.mjs backend 'model'): boards up
  // to maxSize are searched against the game's own getMove. maxms is the
  // per-move budget sent with each request; historyCap bounds the superko
  // history sent (previousBoards, most recent first). See the MODEL block in
  // the header for the measurements.
  // maxSize 5: on 7x7 and 9x9 the model search measured no better than uct
  // and often worse (the model costs 3-8ms a call there, so the tree is
  // shallow; Daedalus 9x9 model 67% vs uct 100%, n=6) — see go-study-report.
  // maxmsBy: the per-move budget per opponent (goplan keys), measured
  // 2026-10-03 at 200/400/800ms, 30 games each (go-study-report): the easy
  // opponents are won at 100% with less thought, and a shorter move is a
  // shorter game — Daedalus 9656 -> 12978/h at 400ms, Netburners 5399 ->
  // 6553/h at 200ms. Illuminati needs the full 800 (400ms: 87% won, -14%/h).
  // maxms is the default for anything unlisted.
  model: {
    maxSize: 5,
    maxms: 800,
    maxmsBy: { Illuminati: 800, Daedalus: 400, Tetrads: 400, TheBlackHand: 400, SlumSnakes: 400, Netburners: 200 },
    historyCap: 120,
  },
  // The solver-absence alarm. See solverHealth() below.
  solverWarnAfter: 10,
  solverMinShare: 0.5,
  // A switch commits this many games before the opponent is re-priced. See
  // pickOpponent: the commitment is what chooseOpponent's dwell block prices.
  minDwellGames: 5,
  // Game length used for that block until this process has timed 3 games.
  defaultGameH: 1 / 60,
  // RELEASE 3 — see the RELEASE 3 block below SETTINGS for what each measured.
  // power: the model search values a game as the node power it banks minus
  // the time it takes (golib.powerObjective), at this opponent's live streak.
  //   turnS: seconds a turn costs until this process has timed 20 moves;
  //   lossScale: the priced streak-reset cost x this (1 = as priced).
  power: { on: false, turnS: 1.2, lossScale: 1 },
  // mirror, PER OPPONENT (default for the rest): when the AI passes and we
  // are ahead — 'always' pass at once (release 2), or 'search': PLAY ON, the
  // solver decides (PASS ends the game exactly; a stone only when its line
  // wins >= golib.SAFE_CONTINUE). 'search' turns the POWER OBJECTIVE on for
  // that opponent's games (the time cost is what makes playing on pay: it
  // was measured that way, release 3b), whatever power.on says.
  // Measured (tools/sim/go-w0.mjs, 30 paired games, harness):
  //   Tetrads     control 20425/h (black 16.3)  play-on+time 23991/h (black 20.4, 30/30)  ON
  //               play-on with no time cost 17878/h (black 21.3, 19.3 s/game): the area costs more time than it earns
  //   Illuminati  control 103626/h (29/30)  play-on+time 102825/h (28/30)  off until loss-scale is measured
  // An opponent switches on here once its arm beats control with no extra losses.
  mirror: { default: 'always', Tetrads: 'search' },
  // presend: play the solver's pre-sent answer (/go/ponder.txt) the moment the
  // AI's reply matches its board, with no request.
  presend: false,
  // clock: send the playtime (the AI's RNG seed, playtimeReader) with each
  // request, so the solver draws the AI's next reply from its seeds.
  clock: false,
  // THE SOLVER-ABSENCE WAIT. A move the solver does not answer is played by
  // the 20ms local search, which loses games (localLoss: the share of games
  // lost on the fallback, tools/sim/go-w0.mjs --local) — and a loss resets the
  // streak. So the wait for a slow or restarting solver is PRICED per game:
  // up to localLoss x (the loss's cost in node power) / (the power rate) of
  // waiting, capped at capMs, before the fallback plays.
  solverWait: { localLoss: { default: 0.5 }, capMs: 180000 },
  // THE PER-GAME LOG: one JSON line per game, the last `keep` kept.
  gameLog: { file: '/tel/go-games.txt', keep: 500, slack: 100 },
  // THOMPSON OVER OPPONENT x BOARD SIZE (release 3a, goplan ARM_PRIOR): each
  // game boundary draws every arm's power per second from its posterior and
  // prices the arms as it priced opponents. on: false = the 5x5 board only
  // (flags.size), as before. historyKeep: the arm picks kept in /tel/go.txt.
  // katagoVisits: the visits a KataGo arm below 19x19 is played at (what
  // the study measured: katago200gpup).
  arms: { on: true, historyKeep: 50, katagoVisits: 200 },
  // A game in progress is RESUMED (never reset: a reset forfeits it — a loss
  // and the streak). After this many consecutive errors on one game it is
  // reset after all (an error that repeats on every resume would hold the farm).
  resumeMaxErrors: 4,
}

/**
 * Is the external solver actually answering?
 *
 * THIS CHECK EXISTS BECAUSE ITS ABSENCE COST A WHOLE BITNODE. The fallback
 * below ("if no reply arrives, think locally") is the graceful-degradation
 * rule working exactly as designed, and on 2026-09-20 tools/go-solver.mjs was
 * found never to have been started in a 67-hour daemon session spanning BN5,
 * BN2 and BN4. go.js had been playing every move with the 20ms local search —
 * the regime its own header records as losing 90 straight games — while
 * publishing `health: 'ok'` the entire time. `remoteMoves: 0` and
 * `localMoves: 47` were both sitting in /tel/go.txt; nothing read them.
 *
 * Degrading quietly is correct. Degrading SILENTLY is not, and those are
 * different things: the first keeps playing, the second removes the operator's
 * ability to know it is happening. Every board-size and opponent measurement
 * in this project is taken at 800ms against the external solver, so a run
 * without it is not a slightly worse version of the configuration those
 * measurements chose — it is a regime none of them describe.
 *
 * Refuses to judge under `warnAfter` moves rather than warning early: a solver
 * that has just been restarted by the daemon legitimately misses the first
 * move or two, and an alarm that cries wolf on every startup is one that gets
 * ignored on the run that matters.
 *
 * THE DENOMINATOR IS remoteMoves + localMoves, not `moves`. They are different
 * counters and the difference is not cosmetic: `moves` only increments when a
 * ranked move was actually played (go.js:384), while every turn we ASK for a
 * move increments exactly one of remote/local. A live reading right after this
 * shipped showed `moves: 21` against `remote 20 + local 4 = 24` — so dividing
 * by `moves` inflates the share and can exceed 1, making the degraded-solver
 * branch fire later than intended or not at all. The quantity being measured
 * is "of the move requests, how many did the solver answer", and that is the
 * sum of the two counters by construction.
 *
 * @param {object} o
 * @param {number} o.remoteMoves  requests the solver answered
 * @param {number} o.localMoves   requests that fell back to the local search
 * @returns {{health: 'ok'|'warn', detail: string|null, solverShare: number|null}}
 */
export function solverHealth(o = {}) {
  const { remoteMoves, localMoves } = o
  const warnAfter = typeof o.warnAfter === 'number' ? o.warnAfter : SETTINGS.solverWarnAfter
  const minShare = typeof o.minShare === 'number' ? o.minShare : SETTINGS.solverMinShare
  const r = typeof remoteMoves === 'number' && isFinite(remoteMoves) ? remoteMoves : 0
  const l = typeof localMoves === 'number' && isFinite(localMoves) ? localMoves : 0
  const n = r + l
  if (n < warnAfter) return { health: 'ok', detail: null, solverShare: null }
  // `answered`, not `share`: `share` is a priced bare ns name and naming a
  // local that costs go.js 2.40GB of RAM for an API it never calls. The RAM
  // checker (invariant B1) caught it; it is not a style preference.
  const answered = r / n
  if (r === 0) {
    return {
      health: 'warn',
      detail:
        `external Go solver is not answering — all ${n} move requests used the ${SETTINGS.maxms}ms local fallback. ` +
        `Node power per hour is a fraction of the measured figure. Is tools/go-solver.mjs running? ` +
        `The daemon supervises it; check GET localhost:12526/status -> goSolver.`,
      solverShare: 0,
    }
  }
  if (answered < minShare) {
    return {
      health: 'warn',
      detail:
        `external Go solver answered only ${r} of ${n} moves (${(100 * answered).toFixed(0)}%) — it is restarting, ` +
        `timing out, or slower than --remotems. Check localhost:12526/status -> goSolver.restarts.`,
      solverShare: answered,
    }
  }
  return { health: 'ok', detail: null, solverShare: answered }
}

// ---------------------------------------------------------------------------
// THE MOVE WATCHDOG, AND WHY IT COUNTS SCHEDULER TURNS RATHER THAN SECONDS.
//
// Incident 2026-09-26: after a restart at 14:26 go.js logged one opponent
// switch and then, as far as anyone could see, nothing — /tel/go.txt frozen,
// no new /go/req.txt for 30+ minutes. It looked like an ns.go.makeMove promise
// that never resolved. It was not. Every in-game write that day landed at
// hh:mm:54.xxx (errors.txt, status.txt, batch.txt, /go/req.txt ...) and
// /tel/human.txt said `visible: false`: the game's tab was hidden and Chrome's
// intensive timer throttling was firing chained timers ONCE A MINUTE. The
// opponent's reply is a chain of setTimeouts (waitCycle, goAI.ts:877; one per
// retrieveMoveOption, :849; one per row in findAnyMatchedPatterns,
// patternMatching.ts:104), so each reply took that many MINUTES — requests
// landed at 14:42:54 and 14:59:54, 17 minutes apart, the same game. Only a
// COMPLETED game published, and a 5x5 game at ~17 min a move takes hours.
//
// Measured with tools/sim/go-aicost.mjs (30 games per opponent, 5x5, the
// game's own getMove): Illuminati replies take 6.9 timer hops on average,
// p99 15, max 15; Daedalus 9.5 / 15 / 15. Visible tab: ~1.4-1.9 s a reply.
// Hidden tab: ~7-10 minutes, up to 15.
//
// So a wall-clock timeout is wrong in BOTH directions: one well above the
// visible 3s would fire on every hidden-tab move and forfeit every game
// (resetBoardState resets the win streak), and one above the hidden 15 min
// would sit for a quarter hour on a real deadlock in a visible tab. The unit
// that is right in both regimes is the scheduler turn: our own 1s slice timer
// is throttled exactly like the AI's chain, so "the opponent has not replied
// in N of our ticks" means the same thing whether a tick is 1s or 60s.
// Threshold: 60 ticks (4x the measured maximum of 15 hops) AND 60s of wall
// clock (20x a visible-tab reply).
//
// The game source was read for a genuine never-resolves path, and there is
// one class: handleNextTurn's AI chain (goAI.ts:83-120) returns WITHOUT
// resolving the waiting player's promise when the board changed underneath it
// ("Stale game" / "AI move attempted, but the board state has changed"), and
// swallows any exception into exceptionAlert. Every in-game reset path
// (resetBoardState, the UI's new-subnet, a save load, prestigeSourceFile)
// goes through resetAI, which DOES resolve the waiter with gameOver, so with
// one script driving the board no path was found that strands us — and no
// CRASH_REPORT_*.txt was on home, so the chain did not throw. The watchdog is
// here because "no path was found" is not "no path exists", and the cost of
// being wrong is a farm that waits forever while publishing nothing.
// ---------------------------------------------------------------------------
export const MOVE_WATCH = { sliceMs: 1000, maxTicks: 60, minMs: 60000 }

/**
 * Await an ns.go move promise, but never forever.
 *
 * Resolves {ok:true, value, ticks, ms} when the promise settles (rejections
 * are rethrown — an invalid move is the caller's error, not a stall), or
 * {ok:false, ticks, ms} once BOTH `maxTicks` slices and `minMs` have passed
 * without a reply. `onTick(ticks, ms)` runs after each slice: it is where the
 * caller publishes a heartbeat, because a stalled move is exactly when the
 * status file must keep moving.
 *
 * Uses plain setTimeout, NOT ns.sleep/ns.asleep: those mark the script busy
 * (ws.runningFn, NetscriptHelpers.tsx:469-481) until they fire, so racing one
 * against the move and letting the move win would leave a pending sleep that
 * makes the NEXT ns call fail the concurrency check and kill the script.
 * ns.go.makeMove does not set runningFn, so ns calls (the heartbeat's
 * ns.write) are legal while it is pending.
 */
export async function awaitMove(pending, opts = {}) {
  const sliceMs = opts.sliceMs ?? MOVE_WATCH.sliceMs
  const maxTicks = opts.maxTicks ?? MOVE_WATCH.maxTicks
  const minMs = opts.minMs ?? MOVE_WATCH.minMs
  const now = opts.now ?? (() => Date.now())
  const t0 = now()
  let settled = null
  const done = Promise.resolve(pending).then(
    (value) => (settled = { value }),
    (error) => (settled = { error }),
  )
  let ticks = 0
  for (;;) {
    let timer = null
    const slice = new Promise((resolve) => (timer = setTimeout(resolve, sliceMs)))
    await Promise.race([done, slice])
    clearTimeout(timer)
    if (settled) {
      if ('error' in settled) throw settled.error
      return { ok: true, value: settled.value, ticks, ms: now() - t0 }
    }
    ticks++
    const ms = now() - t0
    if (opts.onTick) opts.onTick(ticks, ms)
    if (ticks >= maxTicks && ms >= minMs) return { ok: false, ticks, ms }
  }
}

/**
 * Are the page's timers being throttled? Judged from one ns.sleep: asked for
 * `askedMs`, took `sleptMs`. A visible tab overshoots by milliseconds, a
 * briefly hidden one aligns to 1s; intensive throttling (hidden 5+ min) aligns
 * to a minute. 5s and 20x the request separate those cleanly.
 */
export function throttleHealth(sleptMs, askedMs) {
  if (typeof sleptMs !== 'number' || !isFinite(sleptMs) || typeof askedMs !== 'number') return { throttled: false, detail: null }
  if (sleptMs < 5000 || sleptMs < 20 * askedMs) return { throttled: false, detail: null }
  return {
    throttled: true,
    detail:
      `page timers are throttled: a ${askedMs}ms sleep took ${(sleptMs / 1000).toFixed(0)}s. The game tab is hidden and ` +
      `Chrome fires chained timers about once a minute, so each opponent reply (7-15 timer hops, tools/sim/go-aicost.mjs) ` +
      `takes 7-15 MINUTES and a game takes hours. Not a deadlock. Make the tab visible (or run the game with background ` +
      `throttling disabled) to get the measured power/hour back.`,
  }
}

/**
 * One health word for /tel/go.txt out of the three things that can be wrong:
 * the solver (solverHealth), a move that had to be abandoned (the watchdog),
 * and throttled timers. Any of them is 'warn'; the detail names the first
 * that applies, and each carries its own counter in the file regardless.
 * A stall stays a warning for an hour after it happened — long enough for a
 * reader polling every 30 minutes to see it, short enough that one recovered
 * stall does not fail every health check for the rest of the life.
 */
export function goHealth({ solver, model = null, moveStalls = 0, lastStallAt = null, throttle = null, now = Date.now() } = {}) {
  const recentStall = moveStalls > 0 && typeof lastStallAt === 'number' && now - lastStallAt < 3600e3
  if (recentStall) {
    return {
      health: 'warn',
      detail:
        `${moveStalls} move(s) never got an opponent reply within ${MOVE_WATCH.maxTicks} scheduler turns and ` +
        `${MOVE_WATCH.minMs / 1000}s; the board was reset to recover (that game's win streak is forfeit). See errors.`,
    }
  }
  if (throttle?.throttled) return { health: 'warn', detail: throttle.detail }
  if (solver && solver.health !== 'ok') return { health: solver.health, detail: solver.detail }
  if (model && model.health !== 'ok') return { health: model.health, detail: model.detail }
  return { health: 'ok', detail: null }
}

/**
 * Is the opponent-model backend actually answering the requests that ask for it?
 *
 * The model search (tools/go-solver.mjs backend 'model', golib.chooseMoveModel)
 * is what took 5x5 Illuminati from 28% to ~90% won headless. The solver falls
 * back to uct when it cannot load the model (no game source to bundle, no
 * esbuild, a throw) — correct degradation, and exactly the shape that has to
 * be visible: a farm on the fallback earns a fraction of what the opponent
 * pricing assumes. Same thresholds as solverHealth.
 */
/**
 * Can a KataGo engine answer? Read from /go/katago.txt, which
 * tools/go-solver.mjs publishes (every 5 min and on change): `gpu` (the remote
 * host answers its probe and is not marked down), `cpu` (the local engine is
 * installed). Stale (> 15 min: the solver is not running or not publishing),
 * missing or unparseable is NOT available — and says which. Pure; tested.
 * @returns {{ok: boolean, gpu: boolean, cpu: boolean, why: string|null}}
 */
export function katagoAvailable(text, now = Date.now()) {
  let rec = null
  try {
    rec = JSON.parse(text || 'null')
  } catch {
    return { ok: false, gpu: false, cpu: false, why: '/go/katago.txt unparseable' }
  }
  if (!rec || typeof rec !== 'object') return { ok: false, gpu: false, cpu: false, why: 'no /go/katago.txt (a go-solver older than the KataGo service, or not running)' }
  const age = now - Date.parse(rec.at)
  if (!(age <= 15 * 60e3)) return { ok: false, gpu: false, cpu: false, why: `/go/katago.txt is ${Number.isFinite(age) ? Math.round(age / 60e3) + ' min' : 'undated'} old — the solver is not publishing` }
  const gpu = rec.gpu === true
  const cpu = rec.cpu === true
  return { ok: gpu || cpu, gpu, cpu, why: gpu || cpu ? null : `no engine: GPU ${rec.remote?.why ?? 'off'}; CPU not installed` }
}

export function modelHealth({ modelAsked = 0, modelAnswered = 0, modelFallbackWhy = null } = {}) {
  if (modelAsked < SETTINGS.solverWarnAfter) return { health: 'ok', detail: null }
  if (modelAnswered / modelAsked >= SETTINGS.solverMinShare) return { health: 'ok', detail: null }
  return {
    health: 'warn',
    detail:
      `the solver answered only ${modelAnswered} of ${modelAsked} opponent-model requests with the model ` +
      `(the rest fell back to uct: ${modelFallbackWhy ?? 'no reason given'}). Win rates are the uct ones until ` +
      `tools/go-solver.mjs restarts with a loadable backend (model: node tools/goai/build.mjs; katago: bash tools/katago/install.sh).`,
  }
}

/**
 * PRE-SENT ANSWER (release 3): the solver's answer to the position the AI's
 * reply just produced, if it published one. `text` is /go/ponder.txt
 * ({answers: [{b, pc, x, y | pass}]}); a match needs the SAME board (every
 * point) and pass state, and the move must be in the game's own valid list
 * (superko lives there, not in the solver's tree). Pure.
 * @returns {{answer: {x, y} | {pass: true} | null, had: boolean}} had: answers were on file
 */
export function presentAnswer(text, boardStrings, valid, oppPassed) {
  let rec = null
  try {
    rec = JSON.parse(text || 'null')
  } catch {
    return { answer: null, had: false }
  }
  const answers = Array.isArray(rec?.answers) ? rec.answers : []
  if (!answers.length) return { answer: null, had: false }
  const key = boardStrings.join('')
  const pc = oppPassed ? 1 : 0
  for (const a of answers) {
    if (a?.b !== key || a.pc !== pc) continue
    if (a.pass) return { answer: { pass: true }, had: true }
    if (Number.isInteger(a.x) && Number.isInteger(a.y) && valid?.[a.x]?.[a.y] === true) return { answer: { x: a.x, y: a.y }, had: true }
  }
  return { answer: null, had: true }
}

/**
 * How long a move may wait for the solver beyond the usual timeout, this game
 * (ms): the expected cost of playing on the 20ms fallback — the share of games
 * it loses x what a loss costs in node power (golib.powerObjective: the win's
 * pay over the loss's, plus the streak ramp it resets) — over the power rate,
 * less what this game already waited, capped. Pure.
 */
export function solverWaitBudgetMs({ objective, eBlack, ratePerS, localLoss, capMs, waitedMs = 0 }) {
  if (!objective || !(ratePerS > 0) || !(localLoss > 0)) return 0
  const lossCost = eBlack * objective.diff * (objective.winMult - objective.lossMult) + objective.lossFuture
  const budget = Math.min(capMs, (1000 * localLoss * lossCost) / ratePerS)
  return Math.max(0, budget - waitedMs)
}

/** The per-game log, bounded: the last `keep` lines of `text` (one JSON record each). Pure. */
export function trimGameLog(text, keep) {
  const lines = String(text || '').split('\n').filter((l) => l.trim())
  return lines.slice(-keep).join('\n') + (lines.length ? '\n' : '')
}

/**
 * THE PLAYTIME, free in RAM: Player.totalPlaytime read from the game's webpack
 * module cache (the errlog.js / cmd.js eval trick: nothing the RAM checker
 * prices). go.js sends it with every request — the AI's RNG is seeded with it
 * (goAI.ts:184) — and it fails LOUD: `why` names the failure and every request
 * then goes without it (the solver draws free seeds, as in release 2).
 */
export function playtimeReader() {
  let player = null
  let why = null
  const resolve = () => {
    const win = eval('window')
    const hook = win.webpackChunkbitburner
    if (!hook || typeof hook.push !== 'function') throw new Error('window.webpackChunkbitburner missing')
    let req = null
    hook.push([[`gopt_${Date.now()}`], {}, (r) => (req = r)])
    const mod = req?.c?.['./src/Player.ts']?.exports
    if (!mod || typeof mod.Player?.totalPlaytime !== 'number') throw new Error('Player.totalPlaytime not found in ./src/Player.ts')
    return mod
  }
  return {
    now() {
      if (why) return null
      try {
        if (!player) player = resolve()
        const t = player.Player.totalPlaytime
        return typeof t === 'number' && t > 0 ? t : null
      } catch (e) {
        why = `playtime unreadable (${String(e?.message ?? e).slice(0, 80)}) — requests go without it; the solver draws free seeds`
        return null
      }
    },
    get why() {
      return why
    },
  }
}

export async function main(ns) {
  const flags = ns.flags([
    ['size', SETTINGS.size],
    ['maxms', SETTINGS.maxms],
    ['idle', SETTINGS.idle],
    ['topk', SETTINGS.topK],
    // How long to wait for the external solver before thinking locally. The
    // solver spends ~1.5s searching, plus two file-poll hops.
    ['remotems', 14000],
    ['games', -1],
    ['opponent', SETTINGS.opponent],
    // THE USER'S PIN. Hold --opponent until this life's goWeights exist
    // (progress.js's priced weights), instead of the early-game pricing. A
    // human's standing choice (live BN14.1, 19:10Z: the user put the farm on
    // The Black Hand) must not be undone by a heuristic five games later; the
    // planner's own weights, once published, do re-price. The same pin
    // survives a relaunch (the watchdog starts go.js with no args) as the
    // file /go/pin.txt on home holding the opponent's name.
    ['pin', false],
  ])
  ns.disableLog('ALL')
  const duty = Math.round((100 * flags.maxms) / (flags.maxms + flags.idle))
  ns.tprint(
    `go.js: vs ${flags.opponent} on ${flags.size}x${flags.size}, ` +
      `${flags.maxms}ms think / ${flags.idle}ms idle (~${duty}% of one core)`,
  )

  const N = flags.size
  // 1GB probe instead of an 8GB permanent reference; see the header.
  //
  // The rule is NOT `sf14 >= 2`. netscriptGoImplementation.ts:488-489 allows
  // level > 1, OR level exactly 1 while inside BitNode 14 — so the old check
  // would have left the cheat API switched off for the whole of the one
  // BitNode that is built around it, silently and with no error. Every
  // Source-File capability has an "or you are inside that node" clause; they
  // live in sfgate.js so this class of mistake is made once.
  //
  // One getResetInfo() call, two consumers. `sf14` was referenced in the status
  // write below and DECLARED NOWHERE — a plain ReferenceError thrown out of
  // JSON.stringify's argument list, once per completed game, caught by the
  // loop's own `catch (err)` and printed to the script log and nowhere else.
  // The effect was that /tel/go.txt was never written at all: no wins, no
  // streak, no faction_rep multiplier, on the script whose whole purpose is
  // moving that multiplier. This is the C1 failure in its purest form — the
  // status write shared a failure path with the thing it was reporting on — and
  // it is fixed by declaring the value rather than by deleting the field, since
  // whether the cheat API is available is exactly what a reader wants to know.
  const reset = ns.getResetInfo()
  const sf14 = sfLevel(reset, 14)

  /**
   * THE OPPONENT IS A CHANNEL CHOICE, re-priced at every game boundary.
   *
   * `SETTINGS.opponent` was a constant carried out of BitNode 2, where the run
   * was reputation-bound and the gang sold The Red Pill. Every opponent feeds a
   * different multiplier, so that constant is a standing bet on which channel
   * matters — and nothing re-examined it.
   *
   * SWITCHING DISCARDS NOTHING. This block used to say the opposite — "a
   * switch made mid-life throws away whatever the incumbent has banked" — and
   * refused any switch once the incumbent's bonus passed 1%. On 2026-09-28
   * that held BN9 on Daedalus at +67% faction_rep while faction_rep weighed 0
   * and Illuminati priced higher. The game says otherwise: nodePower is per
   * opponent and zeroed ONLY by an install (Go/Go.ts:25-47), and
   * updateGoMults applies EVERY opponent's effect at once (effect.ts:59-101),
   * so Daedalus's bonus keeps paying while we play someone else. winStreak is
   * per opponent too, and only pauses.
   *
   * So the question is marginal: which board's NEXT game buys the most
   * objective, at each opponent's CURRENT node power (read back from
   * getStats' bonusPercent, which inverts exactly). chooseOpponent answers it.
   * The one real switching cost is the win streak: both streaks PAUSE (stats
   * are per opponent; scoring.ts touches only the finished game's opponent),
   * so the challenger's next games earn at its own paused streak rather than
   * the steady state. chooseOpponent prices that over the dwell (streakFactor).
   * Churn is the other friction, and it is priced rather than vetoed:
   * a switch commits `minDwellGames` games before re-pricing, and is made only
   * when that committed block is worth more on the challenger than on the
   * incumbent (chooseOpponent's dwell block).
   *
   * `ns.read` is 0GB and the gate file is on home; ns.scp pulls it because
   * boot.js may place this script off home (invariant C10).
   */
  const GATE_FILE = '/tel/installgate.txt'
  const PLAN_FILE = '/tel/plan.txt'
  const EXIT_FILE = '/tel/exitinputs.txt'
  const goPower = bitNodeMults(reset?.currentNode)?.GoPower ?? 1
  // Home's /tel files from wherever this runs (C10): ns.read is local, so off
  // home a file is pulled first. Writes go back to home the same way, since the
  // daemon mirrors /tel only off home. scp/getHostname are already paid for.
  const here = ns.getHostname()
  const readHome = (file) => {
    if (here !== 'home') ns.scp(file, here, 'home')
    return ns.read(file)
  }
  const writeHome = (file, text, mode = 'w') => {
    // An append off home appends to home's CURRENT copy, not a stale local one.
    if (mode === 'a' && here !== 'home') ns.scp(file, here, 'home')
    ns.write(file, text, mode)
    if (here !== 'home') ns.scp(file, 'home', here)
  }

  // THOMPSON SAMPLING (goplan.js). The posterior counts survive restarts in a
  // small file on home; an unreadable one starts from the priors — which ARE
  // the old point estimates — and says so in /tel/go.txt.
  const loaded = parsePosterior(readHome(THOMPSON.file))
  let posterior = loaded.state
  let posteriorWhy = loaded.why
  let lastDraw = null
  // THE HIDDEN OPPONENT (goplan.js THE HIDDEN OPPONENT). Eligibility is the
  // installed Red Pill, read from the getResetInfo() this script already pays
  // for; an install restarts go.js, so reading it once is exact.
  const w0 = w0Eligible(reset)
  let w0Rec = null
  try {
    const r = JSON.parse(readHome(W0_FILE) || 'null')
    w0Rec = r?.v === 1 ? r : null
  } catch {
    /* no record yet */
  }
  let w0Explore = null
  let w0Weight = null
  /** The hidden opponent's rate: measured once W0_MEASURED_MIN games exist, else the prior. */
  const w0RateOf = () => {
    const r = w0Rec?.rate
    if (r && r.n >= W0_MEASURED_MIN && r.value > 0) return { pph: r.value, ref: r.wins / r.n, source: `measured, ${r.n} games` }
    return { pph: W0_PRIOR.powerPerHour, ref: W0_PRIOR.refP, source: 'prior (unmeasured)' }
  }
  /** { opponent: nodePower } for every priced opponent; 0 for one never played this life. */
  const nodePowerOf = (stats) => {
    const out = {}
    for (const [name, meta] of Object.entries(OPPONENTS)) {
      // getStats() is keyed by the game's enum value ("The Black Hand"), not our key.
      const pct = stats?.[meta.game]?.bonusPercent
      out[name] = pct === undefined ? 0 : nodePowerFromBonus(pct, meta.power, goPower, sf14)
    }
    return out
  }
  /** { opponent: current winStreak } — each resumes from its own paused streak. */
  const streaksOf = (stats) => {
    const out = {}
    for (const [name, meta] of Object.entries(OPPONENTS)) out[name] = stats?.[meta.game]?.winStreak ?? 0
    return out
  }
  // THE EARLY-GAME READINGS (goplan.earlyGoWeights): income streams, what the
  // work slot is doing, the Bladeburner route. All /tel reads from home (0GB),
  // each dropped when stale or from another life.
  let earlyWhy = null
  let weightsSource = null
  let pinned = null
  const PIN_FILE = '/go/pin.txt'
  /** The pinned opponent's key, or null: --pin with --opponent, else /go/pin.txt on home. */
  const pinOf = () => {
    if (flags.pin) return keyOfGame(flags.opponent)
    return keyOfGame(String(readHome(PIN_FILE) || '').trim())
  }
  const earlyInputs = () => {
    const rec = (file) => {
      try {
        return JSON.parse(readHome(file) || 'null')
      } catch {
        return null
      }
    }
    const fresh = (r, min) => !!r && Date.now() - Date.parse(r.at) < min * 60e3
    const thisLife = (r) => !!r && r.lastAugReset === reset?.lastAugReset
    const st = rec('/tel/status.txt')
    const bt = rec('/tel/batch.txt')
    const hn = rec('/tel/hacknet.txt')
    const pr = rec('/tel/progress.txt')
    const act = rec('/tel/act.txt')
    const bbFull = rec('/tel/bladeburner.txt')
    const bbLite = rec('/tel/bb-lite.txt')
    let planRec = null
    try {
      planRec = JSON.parse(readHome(PLAN_FILE) || 'null')
    } catch {
      /* no plan: the route is presumed */
    }
    const batchPerSec = fresh(bt, 10) ? bt?.totals?.earnedPerSec : null
    const node = reset?.currentNode
    const mults = bitNodeMults(node)
    const joined = [bbFull, bbLite].some((b) => b?.bitNode === node && b?.joined === true)
    return {
      // The batcher's own figure when it runs; else all script income, which
      // before the trader runs is the hacking workers'.
      hackIncome: typeof batchPerSec === 'number' ? batchPerSec : fresh(st, 10) ? st?.incomePerSec ?? null : null,
      hacknetIncome: fresh(hn, 10) && thisLife(hn) ? hn?.moneyPerSec ?? null : null,
      // progress.js's claim on the slot when it is live, else what act.js
      // has the player doing this life.
      work: (fresh(pr, 15) && pr?.slot?.owner) || (fresh(act, 15) && thisLife(act) ? act?.work?.kind ?? null : null),
      blade: { open: canJoinBladeburner(reset) && (mults?.BladeburnerRank ?? 0) > 0, route: routeOf(planRec, node), joined },
      nodeMults: mults,
    }
  }
  // The solver version an opponent's posterior is read at: the model session
  // on the small board, KataGo or uct on the hidden opponent's 19x19.
  const verOf = (name) => (name === W0 ? armVersion(katagoAvail?.ok ? 'katago' : 'uct') : armVersion(N <= SETTINGS.model.maxSize ? 'model' : 'uct'))
  // THE ARM BEING PLAYED (release 3a): the board size goes with the opponent.
  let armSize = N
  let armDrawn = {}
  let armWhy = null
  const armHistory = []
  /** Per-arm posterior summary for /tel/go.txt (see the status fields). Never throws. */
  const armStatus = () => {
    try {
      const now = Date.now()
      const katagoOk = !!katagoAvail?.ok
      const out = {}
      const r = (v, d = 3) => (typeof v === 'number' && isFinite(v) ? Number(v.toFixed(d)) : null)
      for (const name of Object.keys(OPPONENTS)) {
        if (name === W0) {
          if (!w0.eligible) continue
          const p = posteriorOf(posterior, W0, 19, { ver: verOf(W0), now })
          out[`${W0}@19`] = { mean: r(p.mean), sd: r(p.sd), games: p.games, n: r(p.n, 2), backend: katagoOk ? 'katago' : 'uct', version: verOf(W0), powerPerHour: Math.round(w0RateOf().pph), drawn: armDrawn[`${W0}@19`] ?? null }
          continue
        }
        for (const size of ARM_SIZES) {
          const p = armPosterior(posterior, name, size, { now, katagoOk })
          if (!p) continue
          out[`${name}@${size}`] = { mean: r(p.mean), sd: r(p.sd), games: p.games, n: r(p.n, 2), backend: p.backend, version: p.version, powerPerHour: p.powerPerHour === null ? null : Math.round(p.powerPerHour), drawn: armDrawn[`${name}@${size}`] ?? null }
        }
      }
      return out
    } catch (e) {
      return { error: describe(e) }
    }
  }
  const pickOpponent = (current, stats, dwellH) => {
    try {
      // MEASUREMENT FIRST: a capped batch against the hidden opponent while
      // its posterior is wide (goplan.exploreW0) — its rate is worth more to
      // the node-order planner than the in-node price says.
      const ex = exploreW0({ eligible: w0.eligible, state: posterior, solverOk: solverHealth({ remoteMoves, localMoves }).health === 'ok' })
      w0Explore = ex.why
      if (ex.explore) return { opponent: W0, size: 19, why: ex.why, switched: current !== W0 }
      const gate = JSON.parse(readHome(GATE_FILE) || 'null')
      // THE WEIGHTS ARE THE GO BONUS'S OWN (goweights.js, published by
      // progress.js as objective.goWeights): exit hours per ln of each
      // channel with the multiplier applied only to the stream it moves
      // (hack() income, not the trader's; hacknet; the player's rep; script
      // exp) and only until the next install, which zeroes it. NOT
      // objective.weights: those price an augmentation — the whole income,
      // every later life — and overstated hacking_speed ~10^5x (2026-09-29).
      //
      // NO goWeights FOR THIS LIFE (another life's gate, no gate, or a
      // refusing pass) -> the early-game weights (goplan.earlyGoWeights): what
      // the current life is using, from cheap telemetry. Until 2026-10-03 this
      // path refused and the incumbent stood, which in a fresh node is
      // whatever the last process happened to be playing (BN14.1: Daedalus,
      // with no faction joined). goplan.weightsFor makes the choice.
      const wf = weightsFor(gate, reset?.lastAugReset, earlyInputs)
      earlyWhy = wf.source === 'early' ? wf.why : null
      weightsSource = wf.source
      // THE PIN holds only while the weights are the early heuristic.
      const pin = pinOf()
      pinned = pin
      if (pin && wf.source === 'early') return { opponent: pin, size: N, why: `pinned to ${pin} (${flags.pin ? '--pin' : PIN_FILE}) until this life's goWeights exist; the early pricing would say: ${wf.why}`, switched: current !== pin || armSize !== N }
      //
      // goPower comes from the BitNode table, which is the authority — the
      // gate file never carried it, and defaulting to 1 would under-price
      // every opponent by 4x in BitNode 14.
      //
      // THE HIDDEN OPPONENT'S WEIGHT is not goweights' (no Go channel there
      // feeds the skill level): goplan.hackLevelWeight prices the post-Red-Pill
      // climb with and without the bonus on progress.js's exit inputs, and the
      // Bladeburner route (plan.txt decisions.bladeRoute) is a known 0.
      if (w0.eligible) {
        let planRec = null
        let exitRec = null
        try {
          planRec = JSON.parse(readHome(PLAN_FILE) || 'null')
          exitRec = JSON.parse(readHome(EXIT_FILE) || 'null')
        } catch {
          /* unreadable: hackLevelWeight refuses by name */
        }
        w0Weight = hackLevelWeight(exitRec, { route: routeOf(planRec, reset?.currentNode), lastAugReset: reset?.lastAugReset })
      }
      const hackW = typeof w0Weight?.weight === 'number' ? { hacking: w0Weight.weight } : {}
      // ONE THOMPSON DRAW PER ARM, per game boundary; priced exactly as before.
      // Each opponent's 5x5 win rate at the version that plays it now (the
      // model session; the hidden opponent's 19x19 KataGo or uct): evidence
      // from another solver version does not count (goplan THE SOLVER VERSION).
      const draw = {}
      for (const name of Object.keys(OPPONENTS)) Object.assign(draw, drawWinRates(posterior, [name], N, Math.random, { ver: verOf(name), now: Date.now() }))
      lastDraw = Object.fromEntries(Object.entries(draw).map(([k, v]) => [k, Number(v.toFixed(3))]))
      const w0r = w0RateOf()
      // THE ARMS (SETTINGS.arms): one power-per-second draw per opponent x
      // size from its posterior at the version that would play it now; the
      // hidden opponent from its measured-or-prior rate at a drawn win rate.
      let arms = null
      if (SETTINGS.arms.on) {
        const now = Date.now()
        const katagoOk = katagoAvailable(readHome('/go/katago.txt')).ok
        arms = {}
        const drawnNow = {}
        for (const name of Object.keys(OPPONENTS)) {
          if (name === W0) continue
          for (const size of ARM_SIZES) {
            const post = armPosterior(posterior, name, size, { now, katagoOk })
            if (!post) continue
            const d = armDraw(post)
            if (!(d.pps > 0)) continue
            arms[`${name}@${size}`] = { pph: 3600 * d.pps, p: d.p }
            drawnNow[`${name}@${size}`] = { winRate: Number(d.p.toFixed(3)), powerPerSecond: Number(d.pps.toFixed(4)), powerPerHour: Math.round(3600 * d.pps), backend: post.backend }
          }
        }
        if (w0.eligible && draw[W0] !== undefined) {
          const sc = rateScale(draw[W0], w0r.ref)
          if (sc) {
            arms[`${W0}@19`] = { pph: w0r.pph * sc, p: draw[W0] }
            drawnNow[`${W0}@19`] = { winRate: Number(draw[W0].toFixed(3)), powerPerSecond: Number(((w0r.pph * sc) / 3600).toFixed(4)), powerPerHour: Math.round(w0r.pph * sc), backend: 'katago' }
          }
        }
        armDrawn = drawnNow
      }
      const pick = chooseOpponent({
        ...(arms ? { arms, incumbentArm: `${current}@${current === W0 ? 19 : armSize}` } : {}),
        weights: { ...wf.weights, ...hackW },
        // The Bladeburner route's weights carry their own life (the committed
        // install, or the black-op exit): goweights.bladeGoWeightsGen.
        windowH: wf.windowH,
        incumbent: current,
        nodePower: nodePowerOf(stats),
        dwellH,
        dwellGames: SETTINGS.minDwellGames,
        streaks: streaksOf(stats),
        boardSize: N,
        goPower,
        sf14,
        winRates: draw,
        powerPerHour: { ...POWER_PER_HOUR, [W0]: w0r.pph },
        refWinRates: { ...WIN_RATE, [W0]: w0r.ref },
        redPill: w0.eligible,
      })
      const why = wf.source === 'early' ? `[early-game weights: ${wf.phase}; goWeights: ${wf.gwWhy}] ${pick.why}` : pick.why
      const size = arms ? pick.size ?? armSize : N
      if (pick.refused || !pick.opponent || (pick.opponent === current && size === armSize)) return { opponent: current, size: armSize, why, switched: false }
      return { opponent: pick.opponent, size, why, switched: true }
    } catch (e) {
      return { opponent: current, size: armSize, why: `opponent pricing failed: ${String(e).slice(0, 80)}`, switched: false }
    }
  }
  // Our key internally (goplan.OPPONENTS); the flag may carry either spelling.
  let opponent = keyOfGame(flags.opponent) ?? 'Daedalus'
  let opponentWhy = 'startup default'
  const canCheat = canUseGoCheat(reset) && ns.fileExists('go-cheat.js', 'home')
  // Cheats are switched off for the rest of the process if a played cheat's
  // stones are missing from the next board twice — the prediction would then
  // be wrong (a game update to the RNG or the formula), and a wrong prediction
  // is the one thing that makes a cheat costly. Said in /tel/go.txt.
  let cheatOn = canCheat
  let cheatOffWhy = canCheat ? null : 'the go.cheat API is closed (needs SF14 >= 2, or SF14 == 1 inside BitNode 14)'
  // Playtime calibration from go-cheat.js's last run: {T, at, crime}.
  let cheatCalib = null
  let cheatsPlayed = 0
  let cheatUnverified = 0
  const cheatLog = []

  // PER-PROCESS counters: they restart at 0 whenever go.js restarts (every
  // deploy). wins/losses/winStreak below are the game's own per-LIFE stats for
  // the current opponent — a different clock, so the two never have to agree.
  let gamesThisProcess = 0
  const processStartedAt = Date.now()
  // Games against the current opponent since the last switch. Starts at the
  // dwell, because no switch has been committed to yet.
  let gamesSinceSwitch = SETTINGS.minDwellGames
  let moves = 0
  let cheatsTried = 0
  // SEQ MUST NOT REPEAT ACROSS RESTARTS OF THIS SCRIPT.
  //
  // go.js and the external solver coordinate through two files: this writes
  // /go/req.txt with a sequence number, the solver answers into /go/move.txt
  // with the same number, and this accepts the reply only when the numbers
  // match. That match is the ONLY thing tying a move to the board it was
  // computed for.
  //
  // Starting at 0 made the number unique only within one process. Restarting
  // go.js — which happens on every deploy — began counting from 0 again while
  // /go/move.txt still held the previous run's reply. The first few requests
  // then matched a STALE answer computed for a completely different board, and
  // the game rejected it:
  //
  //     go.makeMove: The point 2,2 is occupied by a router
  //
  // Seeding from the clock makes a collision require two runs starting in the
  // same millisecond AND reaching the same move count, which cannot happen
  // across a restart. The solver only compares `req.seq !== lastSeq`, so any
  // non-repeating sequence satisfies it.
  let seq = Date.now() % 1e9
  let remoteMoves = 0
  let localMoves = 0
  // The opponent-model backend: requests that asked for it, replies that came
  // from it, and the solver's last stated reason when one did not.
  let modelAsked = 0
  let modelAnswered = 0
  let modelFallbackWhy = null
  // KataGo (the big board): whether the solver reported an engine at the last
  // game start, which engine answered, and answers served from a ponder
  // (also the model's: the solver precomputes the reply it predicts).
  let katagoAvail = null
  const katagoWhere = { gpu: 0, cpu: 0 }
  let ponderHits = 0
  const timing = { moves: 0, ask: 0, play: 0, loop: 0 }
  // How the solver's model search ran ('session': tree reuse + continuous
  // ponder, release 2), from its replies; the study report matches on it.
  let solverMode = null
  // RELEASE 3. preHits: moves played from a pre-sent answer (no request);
  // preMisses: AI replies that found answers on file but none for this board.
  let preHits = 0
  let preMisses = 0
  // Games continued (not reset) after a restart or an error, and the
  // consecutive errors on the game in progress.
  let resumed = 0
  let gameErrors = 0
  // The solver's version (its last reply; goplan.solverVersion) and its seed
  // calibration ({req, pre}: observed / informative / predicted / weights).
  let solverVer = null
  let seedLive = null
  // Play-on after the AI's pass while ahead (SETTINGS.mirror 'search'):
  // times, and the points and seconds it bought.
  const playOn = { games: 0, stones: 0, points: 0, seconds: 0 }
  // Waits beyond the usual solver timeout (SETTINGS.solverWait), ms.
  let solverWaitedMs = 0
  // Our final score per opponent (running mean): the objective's eBlack.
  const meanBlack = {}
  const clockRead = playtimeReader()
  // The per-game log's line count (read once; trimmed when over keep + slack).
  let logLines = null
  // Times we ended a game by mirroring the opponent's pass while ahead, and
  // times we saw their pass but were behind so had to keep playing. Both are
  // reported: a mirrorPasses that stays 0 across many games means the rule is
  // not firing, which is the silent failure this fix is most exposed to.
  let mirrorPasses = 0
  let passedBehind = 0
  // The watchdog's record (see MOVE_WATCH). moveStalls counts moves abandoned
  // because the opponent never replied; the tick/ms pair is the last reply's
  // cost, which is how a reader tells "slow" (throttled) from "stuck".
  let moveStalls = 0
  let lastStallAt = null
  let lastReply = null
  let lastSleepMs = null
  let throttle = { throttled: false, detail: null }
  // The last completed game's fields, carried on every heartbeat so a
  // timer-driven write never drops factionRepBonusPct (progress.js reads it).
  let gameFields = {}
  // The board actually being played: N for every opponent but the hidden one,
  // which the game always plays on its fixed 19x19 (boardState.ts:26-30).
  let gameSize = N
  let lastPublishAt = 0
  let phase = 'starting'

  const errors = []
  // Counters that move ride on every write via the thunk, so the error and exit
  // paths still say how much had been banked. Every existing field keeps its
  // name and position in spirit; `health` and `errors` are additive.
  const note = reporter(ns, SETTINGS.statusFile, () => ({
    opponent,
    opponentWhy,
    // Which weights priced the last choice: progress.js's goWeights for this
    // life, or the early-game weights (and the readings behind them).
    weightsSource,
    earlyWhy,
    pinned,
    host: here,
    bitNode: reset?.currentNode ?? null,
    lastAugReset: reset?.lastAugReset ?? null,
    goPower,
    boardSize: gameSize,
    // The Thompson state behind the choice: the last draw, each arm's posterior
    // mean/sd/raw games, and why the counts are empty if they are.
    thompson: {
      draw: lastDraw,
      arms: Object.fromEntries(
        Object.keys(OPPONENTS).map((k) => {
          const p = posteriorOf(posterior, k, N, { ver: verOf(k), now: Date.now() })
          return [k, { mean: Number(p.mean.toFixed(3)), sd: Number(p.sd.toFixed(3)), games: p.games }]
        }),
      ),
      ...(posteriorWhy ? { why: posteriorWhy } : {}),
    },
    w0: {
      eligible: w0.eligible,
      why: w0.why,
      explore: w0Explore,
      weight: w0Weight,
      rate: w0RateOf(),
      games: w0Rec?.totals?.games ?? 0,
    },
    maxms: flags.maxms,
    idle: flags.idle,
    sf14,
    cheatsTried,
    cheatsPlayed,
    cheatOn,
    cheatOffWhy,
    cheatUnverified,
    cheatLog: cheatLog.slice(-10),
    remoteMoves,
    localMoves,
    modelAsked,
    modelAnswered,
    modelFallbackWhy,
    katago: { available: katagoAvail, where: katagoWhere, backend: SETTINGS.bigBoard.backend },
    ponderHits,
    // RELEASE 3: pre-sent answers played / missed, games resumed rather than
    // reset, the solver version the posterior is keyed on, the seed-lag
    // calibration the solver reports, whether the playtime is readable, the
    // play-on after the AI's pass, and the priced waits for an absent solver.
    // THE ARMS (release 3a; names are a dashboard's contract — keep them):
    //   arm         the opponent@size being played ('Tetrads@5')
    //   armWhy      why it was chosen (the pricing's sentence)
    //   arms        per arm: mean/sd (win-rate posterior), games (raw, all
    //               versions), n (evidence at the current version), backend,
    //               version, powerPerHour (posterior-mean estimate), drawn:
    //               the last draw {winRate, powerPerSecond, powerPerHour} or null
    //   armHistory  the last SETTINGS.arms.historyKeep picks [{at, arm, switched}]
    arm: `${opponent}@${opponent === W0 ? 19 : armSize}`,
    armWhy,
    arms: armStatus(),
    armHistory: armHistory.slice(),
    presend: { hits: preHits, misses: preMisses },
    resumed,
    solverVersion: solverVer,
    seed: seedLive,
    clock: !SETTINGS.clock ? { ok: false, why: 'off (SETTINGS.clock)' } : clockRead.why ? { ok: false, why: clockRead.why } : { ok: true },
    playOn,
    solverWaitedMs,
    // Where a turn's wall clock goes (mean ms per move this process): ask =
    // request written -> answer read (solver pickup + search + our poll),
    // play = makeMove's await (the AI's reply, its timer hops), loop = the
    // whole move iteration. The per-turn breakdown tools/sim calibrates to.
    turnTiming: timing.moves ? { moves: timing.moves, askMs: Math.round(timing.ask / timing.moves), playMs: Math.round(timing.play / timing.moves), loopMs: Math.round(timing.loop / timing.moves) } : null,
    solverMode,
    mirrorPasses,
    passedBehind,
    gamesThisProcess,
    processStartedAt: new Date(processStartedAt).toISOString(),
    moves,
    moveStalls,
    lastStallAt: lastStallAt ? new Date(lastStallAt).toISOString() : null,
    lastReply,
    lastSleepMs,
    throttled: throttle.throttled,
    phase,
    errors: errors.slice(-5),
  }))
  // Off home the status file is written locally and the daemon mirrors /tel
  // from home only: push every publish to home (C10; scp is already paid for).
  const toHome = () => {
    if (here !== 'home') ns.scp(SETTINGS.statusFile, 'home', here)
  }
  const publishAt = (health, fields) => {
    lastPublishAt = Date.now()
    const out = note(health, fields)
    toHome()
    return out
  }

  // PUBLISH ON A TIMER, NOT ONLY PER GAME. The per-game write was the only
  // one, so a game that takes hours (throttled timers, 2026-09-26) or never
  // ends (a stranded move) left /tel/go.txt frozen at its start — which reads
  // exactly like "go.js is dead". Called from the move loop and from every
  // watchdog tick; it writes at most once a minute. Never throws: a heartbeat
  // must not be what breaks the loop it reports on.
  const HEARTBEAT_MS = 60000
  const heartbeat = () => {
    if (Date.now() - lastPublishAt < HEARTBEAT_MS) return
    try {
      const h = goHealth({ solver: solverHealth({ remoteMoves, localMoves }), model: modelHealth({ modelAsked, modelAnswered, modelFallbackWhy }), moveStalls, lastStallAt, throttle })
      publishAt(h.health, { ...gameFields, heartbeat: true, ...(h.detail ? { detail: h.detail } : {}) })
    } catch (e) {
      ns.print(`go heartbeat failed: ${describe(e)}`)
    }
  }
  // Every ns.go promise in the move loop goes through here.
  const watched = async (pending) => {
    const w = await awaitMove(pending, { onTick: heartbeat })
    if (w.ok) lastReply = { ticks: w.ticks, ms: w.ms }
    return w
  }

  // The path no try/catch can reach: killed by the watchdog, caught in a
  // killall, or destroyed by an augmentation install. ns.atExit costs 0GB and
  // runs before the worker is torn down (killWorkerScript.ts:64-84), so the
  // write still lands. This is worth having precisely because a dead go.js is
  // invisible: node power is banked, never spent, so nothing downstream
  // complains — the faction_rep multiplier simply stops climbing and every
  // reputation estimate quietly goes optimistic. Explicit id so it can never
  // replace the 'ui-lock' callback lock.js registers.
  ns.atExit(() => {
    note.exit('stopped', { detail: 'go.js is no longer playing — the faction_rep bonus has stopped growing' })
    toHome()
  }, 'status')

  publishAt('ok', { detail: `starting vs ${opponent} on ${N}x${N}` })

  while (flags.games < 0 || gamesThisProcess < flags.games) {
    try {
      // RESUME, NEVER FORFEIT (release 3). A game left in progress — by a
      // restart (every deploy restarts go.js), an outage, or an error thrown
      // out of the move loop below — is CONTINUED. resetBoardState on a board
      // with moves on it scores the game as a LOSS and resets the streak
      // (netscriptGoImplementation.ts:363-366, resetWinstreak): deploys and
      // an outage cost streaks of 26 and 244 on 2026-10-04 that way. A game
      // that keeps throwing is reset after SETTINGS.resumeMaxErrors attempts.
      // getCurrentPlayer / getOpponent / opponentNextTurn are 0GB.
      const inProgress = (() => {
        try {
          const player = ns.go.getCurrentPlayer()
          if (player !== 'Black' && player !== 'White') return null
          // No stone yet: a reset forfeits nothing (the check above needs previousBoards).
          if (!ns.go.getMoveHistory().length) return null
          const key = keyOfGame(ns.go.getOpponent())
          return key ? { key, player } : null
        } catch {
          return null // an API without these (a test's mock): play as before
        }
      })()
      const resumedGame = !!inProgress && gameErrors < SETTINGS.resumeMaxErrors
      if (resumedGame) {
        if (inProgress.key !== opponent) {
          opponentWhy = `resumed the game in progress against ${inProgress.key} (was ${opponent})`
          opponent = inProgress.key
        }
        resumed++
        ns.print(`resuming the game in progress vs ${opponent} (${inProgress.player} to move)`)
      } else {
        if (inProgress) record(errors, new Error(`the game in progress vs ${inProgress.key} failed ${gameErrors} times in a row — resetting it (a forfeit)`))
        gameErrors = 0
      }
      // Re-priced at the game boundary — never mid-game, which would abandon a
      // position — and only once the last switch's committed dwell is served.
      // An install needs no special case: it zeroes every opponent's power,
      // and the marginal pricing reads that straight out of getStats.
      if (!resumedGame && gamesSinceSwitch >= SETTINGS.minDwellGames) {
        const gameH = gamesThisProcess >= 3 ? (Date.now() - processStartedAt) / 3600e3 / gamesThisProcess : SETTINGS.defaultGameH
        const pick = pickOpponent(opponent, ns.go.analysis.getStats(), SETTINGS.minDwellGames * gameH)
        const was = `${opponent}@${armSize}`
        opponent = pick.opponent
        opponentWhy = pick.why
        armWhy = pick.why
        if (Number.isFinite(pick.size)) armSize = pick.size
        armHistory.push({ at: new Date().toISOString(), arm: `${opponent}@${opponent === W0 ? 19 : armSize}`, switched: !!pick.switched })
        if (armHistory.length > SETTINGS.arms.historyKeep) armHistory.splice(0, armHistory.length - SETTINGS.arms.historyKeep)
        // Published AFTER the assignment: the status thunk reads `opponent`,
        // and announcing a switch beside the old name reads as no switch.
        if (pick.switched) {
          gamesSinceSwitch = 0
          publishAt('ok', { ...gameFields, detail: `opponent ${was} -> ${opponent}@${armSize}` })
          ns.print(`switching opponent ${was} -> ${opponent}@${armSize}`)
        }
      }
      // What this opponent had banked before the game, for the per-game
      // outcome and power (the posterior update and the hidden opponent's
      // measurement). getStats is keyed by the game's enum value.
      const preStats = ns.go.analysis.getStats()?.[gameName(opponent)] ?? null
      const gameStartedAt = Date.now()
      // The opponent's last action was a pass: our pass would END the game.
      let oppPassed = false
      let done = false
      let resumeStalled = false
      if (!resumedGame) {
        // The game's enum value, never our key: "TheBlackHand" throws (Go/Enums.ts).
        ns.go.resetBoardState(gameName(opponent), armSize)
        await ns.sleep(100)
      } else if (inProgress.player === 'White') {
        // The AI's reply to our last move is still coming: wait for it.
        const w = await watched(ns.go.opponentNextTurn(false))
        if (w.ok) {
          if (!w.value || w.value.type === 'gameOver') done = true
          oppPassed = w.value?.type === 'pass'
        } else resumeStalled = true
      } else {
        // Our move. The AI passed last if no stone of its changed the board
        // (getPreviousMove is null with history present: boardAnalysis.ts:693).
        try {
          oppPassed = ns.go.getGameState()?.previousMove === null
        } catch {
          oppPassed = false
        }
      }
      // The hidden opponent's board is 19x19 whatever was asked; every loop
      // below sizes itself from the board the game actually dealt.
      const board0 = ns.go.getBoardState()
      gameSize = board0.length || N
      const size = gameSize

      const komi = ns.go.getGameState()?.komi ?? 5.5
      let stalled = resumeStalled
      let guard = 0
      phase = 'playing'
      // This game's cheats: played (all succeed by construction), declined
      // (go-cheat.js saw the window too far off), skipped (estimated too far
      // to exec at all), waitedMs (playtime waited for windows).
      const cheat = { played: 0, declined: 0, skipped: 0, waitedMs: 0, noRam: false }
      let pendingVerify = null
      // What the solver is told beyond the position (SETTINGS.bigBoard): on
      // 19x19 a time budget and search options, including the NODE POWER
      // objective at this opponent's streak multipliers (effect.ts:119-130:
      // a win after streak s pays 1+0.25*min(s+1,8), or 1+0.5*min(-s,8) when
      // it breaks a dry streak; a loss pays 0.5). Empty below 13x13.
      const solverReq = (() => {
        if (size < 19) return {}
        const st = preStats?.winStreak ?? 0
        const win = st < 0 ? 1 + 0.5 * Math.min(-st, 8) : 1 + 0.25 * Math.min(st + 1, 8)
        return { maxms: SETTINGS.bigBoard.maxms, opts: { ...SETTINGS.bigBoard.opts, objective: { win, loss: 0.5 } } }
      })()
      // THE OPPONENT-MODEL BACKEND (SETTINGS.model): up to maxSize, the solver
      // searches against the game's own getMove (tools/goai) instead of a
      // minimax phantom, so it needs the opponent and the move history (the
      // AI's superko filter reads BoardState.previousBoards). getMoveHistory
      // is 0GB (RamCostGenerator.ts:308).
      const useModel = size <= SETTINGS.model.maxSize
      // KataGo on the big board (SETTINGS.bigBoard.backend): the solver answers
      // with uct and says why when it is not installed (tools/katago/install.sh).
      if (size > SETTINGS.model.maxSize) katagoAvail = katagoAvailable(readHome('/go/katago.txt'))
      // 7x7-13x13 (release 3a): the arm's measured backend (goplan armPrior)
      // — KataGo when it pays there and an engine answers, else uct.
      const armBackend = size > SETTINGS.model.maxSize && size < 19 ? armPrior(opponent, size, !!katagoAvail?.ok)?.backend ?? 'uct' : null
      const useKatago = size >= 19 ? SETTINGS.bigBoard.backend === 'katago' || (SETTINGS.bigBoard.backend === 'auto' && !!katagoAvail?.ok) : armBackend === 'katago'
      const wantBackend = useModel ? 'model' : useKatago ? 'katago' : null
      const remoteWait = Math.max(flags.remotems, (solverReq.maxms ?? 0) + 6000, useModel ? SETTINGS.model.maxms + 6000 : 0, useKatago ? 60000 : 0)
      // THE POWER OBJECTIVE (SETTINGS.power, golib.powerObjective): this
      // game's node power at this opponent's streak — the win's multiplier,
      // a loss's 0.5 and the ramp it resets — less the rate x the seconds a
      // turn costs (measured here once 20 moves are timed).
      let points = 0
      for (const col of board0) for (const c of col) if (c !== '#') points++
      const turnS = timing.moves >= 20 ? timing.loop / timing.moves / 1000 : SETTINGS.power.turnS
      const eBlack = meanBlack[opponent] ?? 0.68 * points
      const ratePerS = (POWER_PER_HOUR[opponent] ?? 0) / 3600
      const priced = powerObjective({ streak: preStats?.winStreak ?? 0, komi, size, eBlack, rate: ratePerS, turnS, lossScale: SETTINGS.power.lossScale })
      // Play-on for this opponent (SETTINGS.mirror) brings the objective with it.
      const mirrorMode = SETTINGS.mirror[opponent] ?? SETTINGS.mirror.default
      const objective = useModel && (SETTINGS.power.on || mirrorMode === 'search') ? priced : null
      // THE PRICED WAIT for an absent solver (SETTINGS.solverWait), this game.
      let waitedExtra = 0
      const waitBudget = () => (useModel ? solverWaitBudgetMs({ objective: priced, eBlack, ratePerS, localLoss: SETTINGS.solverWait.localLoss[opponent] ?? SETTINGS.solverWait.localLoss.default, capMs: SETTINGS.solverWait.capMs, waitedMs: waitedExtra }) : 0)
      // The solver version of each answer this game (the posterior's key).
      const verCount = {}
      // The search's top 3 on the last answer (the per-game log).
      let lastTop = null
      /** The request object (seq advanced). `count`: a real question (not a notice). */
      const solverRequest = (board, validList, count = true) => {
        seq++
        const opts = solverReq.opts ? { ...solverReq.opts, opponentPassed: oppPassed } : undefined
        let modelReq = {}
        if (useModel) {
          let history = []
          try {
            history = ns.go.getMoveHistory().slice(0, SETTINGS.model.historyCap).map((b) => b.join(''))
          } catch (e) {
            record(errors, new Error(`getMoveHistory: ${describe(e)} — the model search runs without superko history`))
          }
          // T: the playtime the AI's RNG is seeded from (playtimeReader).
          const T = SETTINGS.clock ? clockRead.now() : null
          modelReq = { backend: 'model', opponent: gameName(opponent), history, opponentPassed: oppPassed, ...(solverReq.maxms ? {} : { maxms: SETTINGS.model.maxmsBy[opponent] ?? SETTINGS.model.maxms }), ...(T ? { T } : {}), turnS, ...(objective ? { objective } : {}) }
          if (count) modelAsked++
        } else if (useKatago) {
          // The opponent and recent history let the solver PONDER the AI's
          // likely replies (tools/go-solver.mjs); fallback: uct, said in the reply.
          let history = []
          try {
            history = ns.go.getMoveHistory().slice(0, SETTINGS.bigBoard.historyCap).map((b) => b.join(''))
          } catch (e) {
            record(errors, new Error(`getMoveHistory: ${describe(e)} — KataGo runs without ponder history`))
          }
          modelReq = { backend: 'katago', visits: size >= 19 ? SETTINGS.bigBoard.visits : SETTINGS.arms.katagoVisits, opponent: gameName(opponent), history, fallback: 'uct' }
          if (count) modelAsked++
        }
        return { seq, size, komi, board, valid: validList, ...(solverReq.maxms ? { maxms: solverReq.maxms } : {}), ...(opts ? { opts } : {}), ...modelReq }
      }
      /**
       * The NOTICE (release 3): we played a pre-sent answer with no request;
       * the solver re-roots there and ponders on. Fire and forget.
       */
      const notifySolver = (board, validList, played) => {
        const q = solverRequest(board, validList, false)
        ns.write('/go/req.txt', JSON.stringify({ ...q, played }), 'w')
        if (here !== 'home') ns.scp('/go/req.txt', 'home', here)
      }
      /** One solver round trip; null if no reply in time. */
      const askSolver = async (board, validList) => {
        const q = solverRequest(board, validList)
        // THE SOLVER TALKS TO HOME. tools/go-solver.mjs reads /go/req.txt and
        // writes /go/move.txt on home over the Remote File API, and ns.read
        // and ns.write are local — so off home (a Go node places this
        // wherever the room is: raiseplace goPlacementOf) the request is
        // pushed to home after the write and the reply pulled before every
        // read. Without this an off-home go.js asks a solver that never sees
        // the question and plays every move on the 20ms fallback (C10).
        ns.write('/go/req.txt', JSON.stringify(q), 'w')
        if (here !== 'home') ns.scp('/go/req.txt', 'home', here)
        // Past the usual timeout, wait on only while the priced budget lasts.
        const limit = remoteWait + waitBudget()
        for (let waited = 0; waited < limit; waited += SETTINGS.replyPollMs) {
          await ns.sleep(SETTINGS.replyPollMs)
          if (waited >= remoteWait) {
            waitedExtra += SETTINGS.replyPollMs
            solverWaitedMs += SETTINGS.replyPollMs
            heartbeat()
          }
          try {
            const reply = JSON.parse(readHome('/go/move.txt') || '{}')
            if (reply.seq === q.seq) {
              solverVer = solverVersion(reply)
              verCount[solverVer] = (verCount[solverVer] ?? 0) + 1
              if (reply.seed) seedLive = reply.seed
              lastTop = Array.isArray(reply.top) ? reply.top : null
              // Which backend actually answered: a model request answered by
              // uct (no bundle, no game source, a throw) is counted and named
              // — degraded, never silent (modelHealth).
              if (wantBackend) {
                if (reply.backend === wantBackend) modelAnswered++
                else modelFallbackWhy = reply.fallback ?? `solver answered with backend ${reply.backend ?? 'unknown (a solver older than the model backend?)'}`
              }
              if (reply.backend === 'katago') katagoWhere[String(reply.where ?? '').startsWith('gpu') ? 'gpu' : 'cpu']++
              if (reply.pondered === 'hit') ponderHits++
              if (reply.mode) solverMode = reply.mode
              return reply.pass ? [] : [{ x: reply.x, y: reply.y }]
            }
          } catch {
            /* not written yet */
          }
        }
        return null
      }
      /**
       * One two-move cheat, if the window allows; see CHEAT POLICY. Returns
       * {played, reply}. Never plays a cheat it cannot see succeed.
       */
      const tryCheat = async (board, validList, first) => {
        const k = cheat.played
        const p = cheatChance(k, cheatCalib?.crime ?? 1, sf14)
        if (p < SETTINGS.cheat.minChance) return { played: false }
        if (cheatCalib) {
          // Playtime advances with the wall clock while the tab is live; a
          // throttled tab only makes this optimistic, and go-cheat.js decides
          // on the exact value anyway.
          const w = cheatWaitS(cheatCalib.T + (Date.now() - cheatCalib.at), p) * 1000
          if (w > SETTINGS.cheat.maxWaitMs + 1500) {
            cheat.skipped++
            return { played: false }
          }
        }
        const board2 = applyMove(board, first.x, first.y)
        if (!board2) return { played: false }
        // playTwoMoves validates BOTH points on the board before either stone.
        const valid2 = validList.filter(([x, y]) => !(x === first.x && y === first.y) && board2[x][y] === '.')
        if (!valid2.length) return { played: false }
        const second = await askSolver(board2, valid2)
        if (!second || !second.length) return { played: false }
        const execAt = Date.now()
        const pid = ns.exec('go-cheat.js', 'home', 1, first.x, first.y, second[0].x, second[0].y, SETTINGS.cheat.maxWaitMs)
        if (!pid) {
          record(errors, new Error('go-cheat.js did not start (pid 0): no room on home for its 11.1GB — no more cheats this game'))
          cheat.noRam = true
          return { played: false }
        }
        cheatsTried++
        while (ns.isRunning(pid)) {
          await ns.sleep(50)
          heartbeat()
        }
        let st = null
        try {
          // go-cheat.js runs on home and writes its result there.
          st = JSON.parse(readHome('/tel/go-cheat.txt') || 'null')
        } catch {
          /* unreadable is handled below */
        }
        if (!st || !(Date.parse(st.at) >= execAt - 2000)) {
          record(errors, new Error('go-cheat.js left no result for this run'))
          return { played: false }
        }
        if (st.calib && Number.isFinite(st.calib.T)) {
          const base = 0.6 * (0.7 - 0.02 * k) ** k
          const crime = (st.calib.p - (sf14 === 3 ? 0.25 : 0)) / base
          cheatCalib = { T: st.calib.T, at: st.calib.at, crime: Number.isFinite(crime) && crime > 0 ? crime : 1 }
        }
        if (st.error) {
          record(errors, new Error(`go-cheat.js: ${st.error}`))
          return { played: false }
        }
        if (!st.cheated) {
          cheat.declined++
          return { played: false }
        }
        cheat.played++
        cheatsPlayed++
        cheat.waitedMs += st.waitedMs ?? 0
        pendingVerify = [[first.x, first.y], [second[0].x, second[0].y]]
        return { played: true, reply: st.reply }
      }

      // THE PER-GAME LOG (SETTINGS.gameLog): every turn — our move, where it
      // came from (pre: a pre-sent answer, req: a solver request, loc: the
      // local fallback, cheat), ask and AI ms, the AI's reply, and the search's
      // top 3 [x, y, value, visits, winRate] when the solver sent them.
      const moveLog = []
      const startBoard = board0.join('')
      // Play-on after the AI's pass while ahead: black's score and the time
      // when it first happened this game (SETTINGS.mirror 'search').
      let passAhead = null
      let stonesAfterPass = 0
      let presentGame = 0
      while (!done && !stalled && guard++ < 4000) {
        const loop0 = Date.now()
        const boardStrings = ns.go.getBoardState()
        const valid = ns.go.analysis.getValidMoves()
        // A played cheat's two stones must be on the board the AI handed back.
        if (pendingVerify) {
          const ok = pendingVerify.every(([x, y]) => boardStrings[x]?.[y] === 'X')
          pendingVerify = null
          if (!ok) {
            cheatUnverified++
            record(errors, new Error(`a predicted cheat's stones are missing from the next board (${cheatUnverified} so far) — captured by the reply, or the prediction is wrong`))
            if (cheatUnverified >= 2) {
              cheatOn = false
              cheatOffWhy = 'two predicted cheats were not on the board afterwards — the roll prediction no longer matches the game; cheats OFF for this process'
            }
          }
        }

        // Remote-first: hand the position to the external solver (real UCT on
        // its own nice-19 OS process — see tools/go-solver.mjs) and wait
        // briefly. Netscript shares the browser main thread, so thinking here
        // is bounded to ~20ms a move, which lost 90 straight games; thinking
        // out there costs the game thread nothing. If no reply arrives (solver
        // not running, daemon down), fall back to the local flat search — the
        // bot degrades instead of stopping.
        const validList = []
        for (let x = 0; x < size; x++) for (let y = 0; y < size; y++) if (valid[x]?.[y]) validList.push([x, y])
        const ask0 = Date.now()
        // PRE-SENT (SETTINGS.presend): the solver already answered this exact
        // position while the AI was thinking — play it now, no round trip.
        let src = 'req'
        let ranked = null
        lastTop = null
        if (SETTINGS.presend && useModel) {
          const pre = presentAnswer(readHome('/go/ponder.txt'), boardStrings, valid, oppPassed)
          if (pre.answer) {
            ranked = pre.answer.pass ? [] : [{ x: pre.answer.x, y: pre.answer.y }]
            src = 'pre'
            preHits++
            presentGame++
            remoteMoves++
          } else if (pre.had) preMisses++
        }
        if (src !== 'pre') {
          ranked = await askSolver(boardStrings, validList)
          if (ranked !== null) remoteMoves++
          else {
            ranked = chooseMove(boardStrings, valid, size, komi, flags.maxms, flags.topk)
            localMoves++
            src = 'loc'
            verCount.local = (verCount.local ?? 0) + 1
            // The fallback never plays on after a winning pass: it cannot price it.
            if (oppPassed && passAhead) ranked = []
          }
        }
        const askMs = Date.now() - ask0

        // A cheat replaces this turn's move when the clock allows (CHEAT POLICY).
        if (cheatOn && size <= SETTINGS.cheat.maxSize && !cheat.noRam && ranked && ranked.length && guard >= SETTINGS.cheat.fromTurn && cheat.played < SETTINGS.cheat.maxPerGame) {
          const c = await tryCheat(boardStrings, validList, ranked[0])
          if (c.played) {
            moves++
            moveLog.push({ m: `${ranked[0].x},${ranked[0].y}+`, s: 'cheat', a: askMs, r: c.reply ?? 'G' })
            oppPassed = c.reply === 'pass'
            if (!c.reply || c.reply === 'gameOver') done = true
            await ns.sleep(flags.idle)
            continue
          }
        }

        const play0 = Date.now()
        const stone = !!(ranked && ranked.length)
        const pending = stone ? ns.go.makeMove(ranked[0].x, ranked[0].y) : ns.go.passTurn()
        // The solver learns of a pre-sent move here (it re-roots and ponders
        // on while the AI thinks); written while the move is pending, which
        // ns.go allows (see awaitMove).
        if (src === 'pre') notifySolver(boardStrings, validList, stone ? { x: ranked[0].x, y: ranked[0].y } : { pass: true })
        if (oppPassed && passAhead) {
          if (stone) stonesAfterPass++
          else mirrorPasses++
        }
        const played = await watched(pending)
        if (!played.ok) {
          stalled = true
          break
        }
        const res = played.value
        const playMs = Date.now() - play0
        if (stone) moves++
        moveLog.push({ m: stone ? `${ranked[0].x},${ranked[0].y}` : 'P', s: src, a: askMs, p: playMs, r: !res || res.type === 'gameOver' ? 'G' : res.type === 'pass' ? 'P' : `${res.x},${res.y}`, ...(lastTop ? { t: lastTop } : {}) })
        gameErrors = 0

        if (!res || res.type === 'gameOver') done = true
        oppPassed = res?.type === 'pass'

        // MIRROR THE OPPONENT'S PASS WHEN AHEAD.
        //
        // Every makeMove/passTurn resolves to the opponent's reply, typed
        // "move" | "pass" | "gameOver" (NetscriptDefinitions.d.ts:5536). This
        // checked only gameOver and threw `pass` away — so when the opponent
        // passed we answered with a move, and boardState.ts:136 resets
        // passCount to 0 on ANY real move. Their pass was wiped and they got
        // another turn.
        //
        // That trade is strictly negative for us. getScore is `pieces +
        // territory` (scoring.ts), so playing into our own territory gains a
        // piece and loses a point of territory: score-neutral. Their extra
        // turn is not neutral. We were paying a free opponent move per pass
        // for nothing, repeatedly, in exactly the won positions where there is
        // nothing left to gain and everything to lose.
        //
        // The decision needs no estimate. Two consecutive passes end the game
        // (boardState.ts:155), and getGameState returns live blackScore and
        // whiteScore straight from getScore — the same function that decides
        // the final result, with komi already inside whiteScore. Because our
        // pass ENDS the game, those numbers are not a forecast of the outcome,
        // they are the outcome. Komi is fractional (5.5 here) so no exact tie
        // is possible and `>` is the whole rule.
        //
        // Free in RAM: passTurn 0GB, getGameState 0GB (RamCostGenerator.ts:306,310).
        if (!done && res.type === 'pass') {
          let ahead = null
          try {
            const gs = ns.go.getGameState()
            ahead = gs.blackScore > gs.whiteScore
          } catch (e) {
            // Never silently treat "could not tell" as "we are fine". Falling
            // through to a normal move is the old behaviour, which is safe;
            // passing on a bad read would hand away a live game.
            errors.push(`getGameState after opponent pass: ${e}`)
          }
          // PLAY ON (SETTINGS.mirror 'search', release 3): dead white stones
          // stay on the board (getScore never removes them) and white's area
          // may still shrink, so ending at once is not free. The solver is
          // asked with opponentPassed: its PASS ends the game exactly, a stone
          // is played only when its line keeps the win (golib SAFE_CONTINUE)
          // and the power per second beats ending now. Needs a live solver.
          const searchDecides = ahead === true && mirrorMode === 'search' && useModel && src !== 'loc'
          if (searchDecides) {
            if (!passAhead) {
              let b0 = null
              try {
                b0 = ns.go.getGameState().blackScore
              } catch {
                /* scored at the end anyway */
              }
              passAhead = { black: b0, at: Date.now() }
            }
          } else if (ahead === true) {
            mirrorPasses++
            const ended = await watched(ns.go.passTurn())
            if (!ended.ok) {
              stalled = true
              break
            }
            const end = ended.value
            // Two passes end it. If the game somehow continues, do NOT assume
            // it ended — let the loop carry on rather than abandon a live board.
            if (!end || end.type === 'gameOver') done = true
          } else if (ahead === false) {
            // Behind when they passed: passing would LOSE. Keep playing — this
            // is the one case where continuing is right.
            passedBehind++
          }
        }
        // The duty cycle. The opponent AI already sleeps 200ms per move
        // (goAI.ts waitCycle), so idling here costs almost no wall-clock game
        // speed while keeping average CPU low.
        const slept0 = Date.now()
        await ns.sleep(flags.idle)
        lastSleepMs = Date.now() - slept0
        throttle = throttleHealth(lastSleepMs, flags.idle)
        timing.moves++
        timing.ask += askMs
        timing.play += playMs
        timing.loop += Date.now() - loop0
        heartbeat()
      }

      if (stalled) {
        // The opponent never answered. Say so everywhere a reader might look,
        // then recover: resetBoardState -> resetGoPromises -> resetAI resolves
        // the stranded promise with gameOver (goAI.ts:136-149) and starts a
        // clean board. It forfeits this game's streak; waiting forever
        // forfeits everything after it.
        moveStalls++
        lastStallAt = Date.now()
        const msg =
          `MOVE STALL #${moveStalls}: no opponent reply to our move in ${MOVE_WATCH.maxTicks} scheduler turns ` +
          `(>= ${MOVE_WATCH.minMs / 1000}s; a normal reply is <= 15 turns) vs ${opponent} — resetting the board`
        record(errors, new Error(msg))
        ns.print(`!!!!! ${msg}`)
        ns.tprint(`go.js: ${msg}`)
        phase = 'recovering from stall'
        const h = goHealth({ solver: solverHealth({ remoteMoves, localMoves }), model: modelHealth({ modelAsked, modelAnswered, modelFallbackWhy }), moveStalls, lastStallAt, throttle })
        publishAt(h.health, { ...gameFields, detail: h.detail })
        ns.go.resetBoardState(gameName(opponent), armSize)
        continue
      }

      gamesThisProcess++
      gamesSinceSwitch++
      let finalScore = null
      try {
        const gs = ns.go.getGameState()
        finalScore = { black: gs.blackScore, white: gs.whiteScore }
      } catch {
        /* between games */
      }

      // getStats() exposes bonusPercent, NOT nodePower
      // (netscriptGoImplementation.ts:378-396). Reading a `nodePower` field
      // returns undefined and prints a flat 0 on every game, which looks
      // exactly like "the bot banks nothing" — it cost an hour of chasing a
      // gameplay problem that did not exist.
      const all = ns.go.analysis.getStats()
      const s = all[gameName(opponent)] || {}
      // factionRepBonusPct is DAEDALUS's bonus, whoever is being played:
      // progress.js and installgate read it as the faction_rep multiplier, and
      // Daedalus is the only opponent that feeds faction_rep (effect.ts:92-95).
      // Taking it from the current opponent would publish Illuminati's
      // hacking_speed bonus as reputation the moment the board switched.
      const bonusPercent = all.Daedalus?.bonusPercent ?? 0
      // Every opponent's live bonus: all of them apply at once.
      const bonuses = {}
      for (const [name, st] of Object.entries(all)) if (typeof st?.bonusPercent === 'number') bonuses[name] = Number(st.bonusPercent.toFixed(3))
      // THE FAVOR EACH OPPONENT'S WINS HAVE GIVEN ITS FACTION this node, as
      // rep-equivalent (getStats `rep`, netscriptGoImplementation.ts:378-396;
      // kept through installs, capped at getMaxRep()): what is left of it is
      // the favor a member still gains from winning (favor.goFavorStreamOf,
      // the exit's favorStream).
      const favorRep = {}
      for (const [name, st] of Object.entries(all)) if (typeof st?.rep === 'number') favorRep[name] = Math.round(st.rep)

      // THE OUTCOME, INTO THE POSTERIOR. Won = the game's own win counter
      // moved (scoring.ts:56-58), not our reading of the score. Its own try:
      // a failed persist must not cost this game's status write.
      // The solver version most of this game's moves came from: the
      // posterior's evidence is kept per version (goplan.solverVersion).
      const gameVer = Object.entries(verCount).sort((a, z) => z[1] - a[1])[0]?.[0]
      try {
        const won = (s.wins ?? 0) > (preStats?.wins ?? 0)
        posterior = updatePosterior(posterior, opponent, size, won, undefined, undefined, gameVer, { black: finalScore?.black, seconds: (Date.now() - gameStartedAt) / 1000 })
        posteriorWhy = null
        writeHome(THOMPSON.file, JSON.stringify(posterior))
        if (opponent === W0) {
          // THE MEASUREMENT: node power this game banked (getStats' bonus,
          // inverted exactly) over the wall-clock it took.
          const bp = OPPONENTS[W0].power
          const n0 = preStats?.bonusPercent === undefined ? 0 : nodePowerFromBonus(preStats.bonusPercent, bp, goPower, sf14)
          const n1 = s.bonusPercent === undefined ? null : nodePowerFromBonus(s.bonusPercent, bp, goPower, sf14)
          const at = new Date().toISOString()
          w0Rec = w0RecordAdd(w0Rec, {
            at,
            won,
            black: finalScore?.black ?? null,
            white: finalScore?.white ?? null,
            power: typeof n0 === 'number' && typeof n1 === 'number' ? Math.max(0, n1 - n0) : null,
            hours: (Date.now() - gameStartedAt) / 3600e3,
            solverShare: solverHealth({ remoteMoves, localMoves }).solverShare,
            cheats: cheat.played,
          })
          writeHome(W0_FILE, JSON.stringify(w0Rec))
          // The gameplan observation channel, every OBS_EVERY games against it.
          const obs = obsDue(w0Rec.totals.games) ? w0Obs(w0Rec.rate, at) : null
          if (obs) writeHome(OBS_FILE, JSON.stringify(obs) + '\n', 'a')
        }
      } catch (e) {
        record(errors, e)
        posteriorWhy = `posterior/measurement write failed: ${describe(e)}`
      }

      // The solver alarm rides the same write as everything else, so a reader
      // that already parses /tel/go.txt gets it for free and one that only
      // looks at `health` still sees it.
      //
      // goHealth folds in the move watchdog and timer throttling, but the
      // solver's own verdict is still an input and still wins when it is the
      // only thing wrong.
      // THE PER-GAME RECORD (SETTINGS.gameLog), its own try: a failed write
      // must not cost the status write below.
      try {
        const won = (s.wins ?? 0) > (preStats?.wins ?? 0)
        if (typeof finalScore?.black === 'number') meanBlack[opponent] = meanBlack[opponent] === undefined ? finalScore.black : 0.9 * meanBlack[opponent] + 0.1 * finalScore.black
        const bp = OPPONENTS[opponent]?.power
        const n0 = preStats?.bonusPercent === undefined ? 0 : nodePowerFromBonus(preStats.bonusPercent, bp, goPower, sf14)
        const n1 = s.bonusPercent === undefined ? null : nodePowerFromBonus(s.bonusPercent, bp, goPower, sf14)
        const secs = (Date.now() - gameStartedAt) / 1000
        let after = null
        if (passAhead) {
          after = { stones: stonesAfterPass, points: typeof passAhead.black === 'number' && typeof finalScore?.black === 'number' ? finalScore.black - passAhead.black : null, seconds: Math.round((Date.now() - passAhead.at) / 100) / 10 }
          playOn.games++
          playOn.stones += stonesAfterPass
          playOn.points += after.points ?? 0
          playOn.seconds = Math.round((playOn.seconds + after.seconds) * 10) / 10
        }
        const gameRec = {
          at: new Date().toISOString(),
          opponent,
          size,
          komi,
          resumed: resumedGame,
          start: startBoard,
          moves: moveLog,
          black: finalScore?.black ?? null,
          white: finalScore?.white ?? null,
          won,
          streakBefore: preStats?.winStreak ?? null,
          streakAfter: s.winStreak ?? null,
          power: typeof n0 === 'number' && typeof n1 === 'number' ? Math.round((n1 - n0) * 100) / 100 : null,
          seconds: Math.round(secs * 10) / 10,
          presend: presentGame,
          ver: gameVer ?? null,
          playOn: after,
          objective: objective ? { winMult: objective.winMult, lossFuture: Math.round(objective.lossFuture), turnCost: Math.round(objective.turnCost * 100) / 100 } : null,
        }
        const file = SETTINGS.gameLog.file
        if (logLines === null) logLines = String(readHome(file) || '').split('\n').filter((l) => l.trim()).length
        writeHome(file, JSON.stringify(gameRec) + '\n', 'a')
        logLines++
        if (logLines > SETTINGS.gameLog.keep + SETTINGS.gameLog.slack) {
          writeHome(file, trimGameLog(readHome(file), SETTINGS.gameLog.keep))
          logLines = SETTINGS.gameLog.keep
        }
      } catch (e) {
        record(errors, new Error(`per-game log: ${describe(e)}`))
      }

      const solver = solverHealth({ remoteMoves, localMoves })
      const h = goHealth({ solver, model: modelHealth({ modelAsked, modelAnswered, modelFallbackWhy }), moveStalls, lastStallAt, throttle })
      phase = 'between games'
      if (canCheat) {
        cheatLog.push({ at: new Date().toISOString(), opponent, ...cheat, won: (s.wins ?? 0) > (preStats?.wins ?? 0), black: finalScore?.black ?? null, white: finalScore?.white ?? null })
        if (cheatLog.length > 50) cheatLog.splice(0, cheatLog.length - 50)
      }
      gameFields = {
        cheat: canCheat ? { ...cheat } : null,
        wins: s.wins ?? 0,
        losses: s.losses ?? 0,
        winStreak: s.winStreak ?? 0,
        highestWinStreak: s.highestWinStreak ?? 0,
        factionRepBonusPct: Number(bonusPercent.toFixed(3)),
        factionRepMult: Number((1 + bonusPercent / 100).toFixed(4)),
        bonuses,
        favorRep,
        gamesSinceSwitch,
        finalScore,
        solverShare: solver.solverShare,
      }
      publishAt(h.health, { ...gameFields, ...(h.detail ? { detail: h.detail } : {}) })
      ns.print(`game ${gamesThisProcess} (this process) vs ${opponent}: ${s.wins ?? 0}W/${s.losses ?? 0}L this life, faction_rep +${bonusPercent.toFixed(2)}%`)
    } catch (err) {
      // ALWAYS surface the failure. The status write was the last statement of
      // this try and a throw above it skipped the whole record — which is not a
      // hypothetical here, it is what the undefined `sf14` above did for every
      // completed game: printed one line to a log nobody reads and left
      // /tel/go.txt absent. Nothing in here reads the game, so the report
      // cannot become the failure.
      // A game still in progress is RESUMED by the next iteration (never reset:
      // a reset forfeits it) — unless this keeps happening (resumeMaxErrors).
      gameErrors++
      try {
        const detail = record(errors, err)
        ns.print(`go error: ${detail}`)
        publishAt('error', { ...gameFields, detail: describe(err) })
      } catch {
        /* nothing left to try */
      }
      await ns.sleep(5000)
    }
  }
}
