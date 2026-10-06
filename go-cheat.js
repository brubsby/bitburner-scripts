// Plays ONE IPvGO two-move cheat, and only when it is certain to succeed.
// Exists as a separate script purely to isolate its RAM cost.
//
//   run go-cheat.js x1 y1 x2 y2 [maxWaitMs]
//
// Netscript charges a script for every ns function anywhere in its import
// graph, whether or not the call is ever reached — so a reference to
// ns.go.cheat.* inside go.js would cost that RAM in every BitNode, including
// the ones where the API throws "requires Source-File 14.2" on contact. Scripts
// are billed independently, so putting the gated calls behind their own file
// means the cost is paid only when a life can actually use them. go.js probes
// the gate (sfgate.canUseGoCheat: SF14 >= 2, or SF14 == 1 inside BitNode 14 —
// netscriptGoImplementation.ts:487-496) before it ever execs this.
//
// THE ROLL IS KNOWN BEFORE THE CALL. Every cheat rolls
// `new WHRNG(Player.totalPlaytime).random()` (netscriptGoImplementation.ts:512)
// against cheatSuccessChance (:561-567). That generator is a sawtooth in
// playtime with a 59s period (golib.cheatRoll), and getPlayer().totalPlaytime
// is the same number: read it, and call the cheat in the SAME synchronous
// tick (no await in between — the ns wrapper runs the body synchronously,
// Netscript/APIWrapper.ts:77-82), and the outcome is decided before we commit.
// So this never fails a cheat: it waits for the window (r <= chance), up to
// maxWaitMs, or gives up and lets go.js play a normal move. A failed cheat is
// what costs: a skipped turn, and once any cheat has been tried in the game a
// 10% chance of ejection — forceEndGoGame, no node power for the game, the
// streak reset (:521-531, scoring.ts:101-108). None of that can happen here.
//
// Only playTwoMoves is referenced (8GB). removeRouter / repairOfflineNode /
// destroyNode are 8GB EACH and priced below playTwoMoves (go.js header), so
// they are not paid for. Total: 1.6 base + 0.5 getPlayer + 1 chance + 8.
//
// The result is written to /tel/go-cheat.txt and go.js reads it back: whether
// a cheat was played (`cheated`), the opponent's reply type, the roll, the
// chance, how long it waited, and a playtime calibration go.js uses to decide
// whether exec'ing this is worth it at all next turn.
import { cheatRoll, cheatWaitS } from 'golib.js'

const STATUS = '/tel/go-cheat.txt'

export async function main(ns) {
  ns.disableLog('ALL')
  const [x1, y1, x2, y2, maxWaitArg] = ns.args
  const maxWait = Number.isFinite(Number(maxWaitArg)) ? Number(maxWaitArg) : 10000
  const t0 = Date.now()
  const result = { at: new Date().toISOString(), kind: 'twoMoves', moves: [[x1, y1], [x2, y2]], cheated: false, error: null }

  try {
    while (true) {
      // ONE synchronous block from the read to the call: nothing between them
      // yields, so Player.totalPlaytime cannot move (engine.tsx:94 advances it
      // only in the game loop, which cannot run inside this block).
      const pl = ns.getPlayer()
      const T = pl.totalPlaytime
      const p = ns.go.cheat.getCheatSuccessChance()
      const r = cheatRoll(T)
      // crime_success itself (go.js prices Slum Snakes' cheat channel on it):
      // the chance alone cannot give it once the chance caps at 1.
      result.calib = { T, at: Date.now(), p, crime: pl.mults?.crime_success ?? null }
      if (r <= p - 1e-12) {
        result.roll = r
        result.cheated = true
        result.waitedMs = Date.now() - t0
        const play = ns.go.cheat.playTwoMoves(x1, y1, x2, y2)
        const reply = await play
        result.reply = reply?.type ?? null
        // Where the AI answered (the per-game log replays cheat turns from it).
        if (reply?.type === 'move') result.replyAt = `${reply.x},${reply.y}`
        break
      }
      const w = cheatWaitS(T, p) * 1000
      if (Date.now() - t0 + w > maxWait) {
        result.why = `window opens in ${Math.round(w)}ms of playtime, past the ${maxWait}ms wait (chance ${p.toFixed(4)}, roll ${r.toFixed(4)})`
        break
      }
      // Sleep to just before the window, then poll each tick (200ms engine
      // cycles; a window is at least one tick wide when chance >= 0.0034).
      await ns.sleep(Math.max(20, Math.min(w - 100, 2000)))
    }
  } catch (err) {
    result.error = String(err).slice(0, 300)
  }

  ns.write(STATUS, JSON.stringify(result), 'w')
}
