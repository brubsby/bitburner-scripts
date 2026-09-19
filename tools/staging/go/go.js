// Farms IPvGO node power against Daedalus, which multiplies faction reputation.
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
// Cheat policy: exactly one per game, and only with Source-File 14.2.
//
// ns.go.cheat.* throws "The go.cheat API requires Source-File 14.2" without it,
// so this life cannot use it — but the policy is implemented and gated rather
// than removed, because these scripts have to be correct at every stage of the
// game, not just the current one.
//
//   chance = 0.6 * (0.7 - 0.02*cheatCount)^cheatCount * crime_success
//            (netscriptGoImplementation.ts:561-567)
//
// so the first cheat of a game is 60% and the fourth is under 9%. The asymmetry
// that decides the policy is the failure branch (:504-531):
//
//   - with `priorCheatCount === 0` a failure only **skips a turn**; the eject
//     branch is gated on priorCheatCount being truthy, so the first cheat of a
//     game carries no tail risk at all.
//   - with any prior cheat, a failure has a 10% chance of forceEndGoGame, which
//     calls resetWinstreak and **never runs the nodePower accrual** — that
//     lives only in endGoGame (scoring.ts:46). An ejection therefore forfeits
//     the entire game's farming *and* resets the streak multiplier.
//
// One cheat is free; the second risks everything the game was worth. So: one.
//
// The call itself lives in go-cheat.js. Netscript bills a script for every ns
// function in its import graph whether or not it is reachable, so referencing
// ns.go.cheat.* here would cost 8GB in every BitNode including the ones where
// it cannot be called. The probe (ns.getResetInfo().ownedSF) costs 1GB.
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

import { chooseMove } from 'golib.js'
import { canUseGoCheat, sfLevel } from 'sfgate.js'
// Free to import: status.js references only ns.write (0GB). See its header.
import { reporter, describe, record } from 'status.js'

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
//   power/hour   5x5 @800ms  5310   <- this
//                9x9 @1500ms 2844   (what we ran all of BN1)
//                13x13       831
//
// 5x5 wins by 1.87x on 3.0x the games per hour and a better streak multiplier
// (getWinstreakMultiplier caps at x3 after 8 straight wins — on 9x9 we never
// once reached it in 45 games, best streak 6; on 5x5 the harness held the cap
// for 42 consecutive games). Half the score per game is the price, and it is
// cheap.
//
// 800ms not 1500: win rate 88.5% vs 94.9%, but 74.8 games/hour vs 59.8. Above
// ~800ms the win rate no longer pays for the lost throughput — 5x5@3000ms
// cannot beat 800ms even if granted a hypothetical 100% win rate.
//
// idle 100 not 400: fixed loop overhead was 745ms/turn, LARGER than the search
// itself at this budget. Pair with `--poll 150` on tools/go-solver.mjs.
const SETTINGS = {
  opponent: 'Daedalus',
  size: 5,
  maxms: 20,      // local fallback only; the external solver does the real search
  idle: 100,      // pause between moves; with maxms this sets the duty cycle
  topK: 8,
  statusFile: '/tel/go.txt',
  // Which cheat, when available. playTwoMoves nets +1 stone of tempo at 60%
  // against -1 turn at 40%.
  cheat: 'twoMoves',
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
  const canCheat = canUseGoCheat(reset) && ns.fileExists('go-cheat.js', 'home')

  let games = 0
  let moves = 0
  let cheatsTried = 0
  let seq = 0
  let remoteMoves = 0
  let localMoves = 0
  // Times we ended a game by mirroring the opponent's pass while ahead, and
  // times we saw their pass but were behind so had to keep playing. Both are
  // reported: a mirrorPasses that stays 0 across many games means the rule is
  // not firing, which is the silent failure this fix is most exposed to.
  let mirrorPasses = 0
  let passedBehind = 0

  const errors = []
  // Counters that move ride on every write via the thunk, so the error and exit
  // paths still say how much had been banked. Every existing field keeps its
  // name and position in spirit; `health` and `errors` are additive.
  const note = reporter(ns, SETTINGS.statusFile, () => ({
    opponent: flags.opponent,
    boardSize: N,
    maxms: flags.maxms,
    idle: flags.idle,
    sf14,
    cheatsTried,
    remoteMoves,
    localMoves,
    mirrorPasses,
    passedBehind,
    games,
    moves,
    errors: errors.slice(-5),
  }))

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
  }, 'status')

  note('ok', { detail: `starting vs ${flags.opponent} on ${N}x${N}` })

  while (flags.games < 0 || games < flags.games) {
    try {
      ns.go.resetBoardState(flags.opponent, N)
      await ns.sleep(100)

      const komi = ns.go.getGameState()?.komi ?? 5.5
      let done = false
      let guard = 0
      let cheated = !canCheat

      while (!done && guard++ < 4000) {
        const boardStrings = ns.go.getBoardState()
        const valid = ns.go.analysis.getValidMoves()

        // Remote-first: hand the position to the external solver (real UCT on
        // its own nice-19 OS process — see tools/go-solver.mjs) and wait
        // briefly. Netscript shares the browser main thread, so thinking here
        // is bounded to ~20ms a move, which lost 90 straight games; thinking
        // out there costs the game thread nothing. If no reply arrives (solver
        // not running, daemon down), fall back to the local flat search — the
        // bot degrades instead of stopping.
        let ranked = null
        seq++
        const validList = []
        for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if (valid[x]?.[y]) validList.push([x, y])
        ns.write('/go/req.txt', JSON.stringify({ seq, size: N, komi, board: boardStrings, valid: validList }), 'w')
        for (let waited = 0; waited < flags.remotems; waited += 250) {
          await ns.sleep(250)
          try {
            const reply = JSON.parse(ns.read('/go/move.txt') || '{}')
            if (reply.seq === seq) {
              ranked = reply.pass ? [] : [{ x: reply.x, y: reply.y }]
              remoteMoves++
              break
            }
          } catch {
            /* not written yet */
          }
        }
        if (ranked === null) {
          ranked = chooseMove(boardStrings, valid, N, komi, flags.maxms, flags.topk)
          localMoves++
        }

        // The single permitted cheat, once the position has some shape.
        if (!cheated && ranked && ranked.length >= 2 && guard > 4) {
          cheated = true
          cheatsTried++
          const pid = ns.exec('go-cheat.js', 'home', 1, SETTINGS.cheat, ranked[0].x, ranked[0].y, ranked[1].x, ranked[1].y)
          if (pid) {
            while (ns.isRunning(pid)) await ns.sleep(40)
            // No return value needed: every cheat acts on the board, which the
            // next iteration re-reads. A failed cheat simply skipped our turn.
            await ns.sleep(flags.idle)
            continue
          }
        }

        const res =
          !ranked || !ranked.length
            ? await ns.go.passTurn()
            : await ns.go.makeMove(ranked[0].x, ranked[0].y)
        if (ranked && ranked.length) moves++

        if (!res || res.type === 'gameOver') done = true

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
          if (ahead === true) {
            mirrorPasses++
            const end = await ns.go.passTurn()
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
        await ns.sleep(flags.idle)
      }

      games++
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
      const s = ns.go.analysis.getStats()[flags.opponent] || {}
      const bonusPercent = s.bonusPercent ?? 0

      note('ok', {
        wins: s.wins ?? 0,
        losses: s.losses ?? 0,
        winStreak: s.winStreak ?? 0,
        highestWinStreak: s.highestWinStreak ?? 0,
        factionRepBonusPct: Number(bonusPercent.toFixed(3)),
        factionRepMult: Number((1 + bonusPercent / 100).toFixed(4)),
        finalScore,
      })
      ns.print(`game ${games}: ${s.wins ?? 0}W/${s.losses ?? 0}L faction_rep +${bonusPercent.toFixed(2)}%`)
    } catch (err) {
      // ALWAYS surface the failure. The status write was the last statement of
      // this try and a throw above it skipped the whole record — which is not a
      // hypothetical here, it is what the undefined `sf14` above did for every
      // completed game: printed one line to a log nobody reads and left
      // /tel/go.txt absent. Nothing in here reads the game, so the report
      // cannot become the failure.
      try {
        const detail = record(errors, err)
        ns.print(`go error: ${detail}`)
        note('error', { detail: describe(err) })
      } catch {
        /* nothing left to try */
      }
      await ns.sleep(5000)
    }
  }
}
