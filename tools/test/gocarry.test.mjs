// [GC] go.js's startup incumbent is THIS LIFE's last arm, not a hard-coded default.
//
// THE BUG (live 2026-10-08 20:04Z, BN9.2, exit held so no install planned).
// goplan.chooseOpponent refuses ('no measured install window') and the
// incumbent stands. go.js began every process with
// `let opponent = keyOfGame(flags.opponent) ?? 'Daedalus'`, so after a routine
// restart (every deploy restarts go.js) the "incumbent" was Daedalus@5 without
// cheats (~7.8 power/s), not the Tetrads@5-with-cheats (~10.3 power/s) the
// same life had been farming. The fix reads the previous /tel/go.txt and
// carries its arm over when its lastAugReset AND bitNode match getResetInfo()
// (telemetry survives installs and BitNode entries — CLAUDE.md).
//
//   GC1 carriedArmOf: same life carries the arm; another life, another node,
//       an unreadable/absent file, an unknown opponent, a non-arm size, and an
//       ineligible hidden opponent each fall back BY NAME.
//   GC2 go.js main() on a mock game in the refusal regime: the first board is
//       the carried arm (Tetrads@7), not Daedalus@5; the source is published.
//       Another life's go.txt -> the default, said so. --opponent wins.
//       A game in progress is still resumed against ITS opponent.

import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO } from "./ram.mjs";
import "./gameresolve.mjs";

const LIFE = 1_700_000_000_000;
const NODE = 9;

export async function run() {
  const checks = [];
  const go = await import(path.join(REPO, "go.js"));

  /* ------------------------------------------------------------------ GC1 */
  const c1 = new Check("GC1", "carriedArmOf carries this life's arm and refuses everything else by name");
  {
    const reset = { lastAugReset: LIFE, currentNode: NODE };
    const rec = (o) => JSON.stringify({ opponent: "Tetrads", arm: "Tetrads@5", boardSize: 5, lastAugReset: LIFE, bitNode: NODE, ...o });
    const f = go.carriedArmOf;
    c1.examined(1);
    if (typeof f !== "function") c1.fail("go.js must export carriedArmOf(text, reset, o)");
    else {
      const cases = [
        { text: rec({}), want: { opponent: "Tetrads", size: 5 }, why: /carried over.*Tetrads@5/ },
        { text: rec({ arm: "Illuminati@7" }), want: { opponent: "Illuminati", size: 7 }, why: /Illuminati@7/ },
        // An older record without `arm`: opponent + boardSize, game spelling.
        { text: rec({ arm: undefined, opponent: "The Black Hand", boardSize: 9 }), want: { opponent: "TheBlackHand", size: 9 }, why: /TheBlackHand@9/ },
        { text: rec({ lastAugReset: LIFE - 1 }), want: { opponent: null }, why: /another life/ },
        { text: rec({ bitNode: 2 }), want: { opponent: null }, why: /BitNode 2/ },
        { text: "", want: { opponent: null }, why: /no last go\.txt/ },
        { text: "{not json", want: { opponent: null }, why: /unreadable/ },
        { text: rec({ arm: "Nobody@5", opponent: "Nobody" }), want: { opponent: null }, why: /no known opponent/ },
        { text: rec({ arm: "Tetrads@11" }), want: { opponent: null }, why: /not an arm size/ },
        { text: rec({ arm: "w0r1d_d43m0n@19" }), want: { opponent: null }, why: /not eligible/ },
        { text: rec({ arm: "w0r1d_d43m0n@19" }), o: { w0Eligible: true }, want: { opponent: "w0r1d_d43m0n", size: 19 }, why: /w0r1d_d43m0n@19/ },
      ];
      for (const { text, o, want, why } of cases) {
        c1.examined(1);
        const r = f(text, reset, o);
        if (r.opponent !== want.opponent || (want.size !== undefined && r.size !== want.size)) c1.fail(`carriedArmOf(${text.slice(0, 60)}) should be ${JSON.stringify(want)}, got ${JSON.stringify(r)}`);
        if (!why.test(r.why ?? "")) c1.fail(`the why must name the cause (${why}), got ${JSON.stringify(r.why)}`);
      }
      // No reset info at all: never carried.
      c1.examined(1);
      if (f(rec({}), {}).opponent !== null) c1.fail("without getResetInfo's lastAugReset nothing can be shown to be this life's");
    }
  }
  checks.push(c1);

  /* ------------------------------------------------------------------ GC2 */
  const c2 = new Check("GC2", "go.js main(): a restart in the refusal regime keeps this life's arm, not Daedalus@5");
  {
    const runMain = async ({ prior = null, args = [], flagsOpp = "Daedalus", inProgress = null } = {}) => {
      const files = new Map();
      const published = [];
      const resets = [];
      const board = (n) => Array.from({ length: n }, () => ".".repeat(n));
      let B = board(5);
      let player = inProgress ? "Black" : "None";
      let cur = inProgress ?? "Daedalus";
      const stats = {};
      const st = (who) => (stats[who] ??= { wins: 10, losses: 0, winStreak: 10, highestWinStreak: 10, bonusPercent: 1 });
      // THE REFUSAL REGIME, as live: this life's goWeights exist but no
      // install window is measured (the exit is held), so chooseOpponent
      // refuses and the incumbent stands.
      files.set("/tel/installgate.txt", JSON.stringify({ lastAugReset: LIFE, objective: { goWeights: { weights: { combat: 1, faction_rep: 1, hacking_speed: 1 }, windowH: null } } }));
      if (prior) files.set("/tel/go.txt", JSON.stringify(prior));
      const ns = {
        args,
        flags: () => ({ size: 5, maxms: 5, idle: 1, topk: 8, remotems: 0, games: 1, opponent: flagsOpp, pin: false }),
        disableLog() {},
        tprint() {},
        print() {},
        getResetInfo: () => ({ lastAugReset: LIFE, currentNode: NODE, ownedSF: new Map(), ownedAugs: new Map() }),
        getHostname: () => "home",
        scp() {},
        read: (f) => files.get(f) ?? "",
        fileExists: () => false,
        atExit() {},
        write: (f, data, mode) => {
          files.set(f, mode === "a" ? (files.get(f) ?? "") + data : data);
          if (f === "/tel/go.txt") published.push(JSON.parse(data));
          if (f === "/go/req.txt") {
            const q = JSON.parse(data);
            const [x, y] = q.valid?.[0] ?? [0, 0];
            files.set("/go/move.txt", JSON.stringify({ seq: q.seq, x, y, backend: q.backend ?? "uct", mode: q.backend === "model" ? "session" : undefined, release: "r3", top: [[x, y, 0.9, 10, 1]] }));
          }
        },
        sleep: () => new Promise((r) => setTimeout(r, 0)),
        exec: () => 0,
        isRunning: () => false,
        go: {
          analysis: {
            getStats: () => JSON.parse(JSON.stringify(stats)),
            getValidMoves: () => B.map((c) => [...c].map(() => true)),
          },
          resetBoardState: (who, size) => {
            resets.push([who, size]);
            cur = who;
            st(who);
            B = board(size);
            player = "Black";
          },
          getGameState: () => ({ komi: 5.5, blackScore: 20, whiteScore: 5.5, previousMove: [0, 0], currentPlayer: player }),
          getBoardState: () => B,
          getMoveHistory: () => (inProgress ? [board(5)] : []),
          getCurrentPlayer: () => player,
          getOpponent: () => cur,
          makeMove: () => {
            st(cur).wins++;
            st(cur).winStreak++;
            player = "None";
            inProgress = null;
            return Promise.resolve({ type: "gameOver", x: null, y: null });
          },
          passTurn: () => Promise.resolve({ type: "gameOver", x: null, y: null }),
          opponentNextTurn: () => Promise.resolve({ type: "move", x: 1, y: 1 }),
        },
      };
      st("Daedalus");
      st("Tetrads");
      await Promise.race([go.main(ns), new Promise((_, rej) => setTimeout(() => rej(new Error("main() did not finish in 30s")), 30000))]);
      return { resets, published, last: published[published.length - 1] ?? null };
    };
    const sameLife = { opponent: "Tetrads", arm: "Tetrads@7", boardSize: 7, lastAugReset: LIFE, bitNode: NODE, opponentWhy: "priced earlier this life" };
    try {
      // The live case: same life, the pricing refuses -> the carried arm.
      const a = await runMain({ prior: sameLife });
      c2.examined(3);
      if (!/no measured install window/.test(a.last?.opponentWhy ?? "")) c2.fail("the mock must be in the refusal regime (chooseOpponent: 'no measured install window')", a.last?.opponentWhy);
      if (JSON.stringify(a.resets[0]) !== JSON.stringify(["Tetrads", 7])) c2.fail(`a restart during a refusal must keep this life's arm Tetrads@7, got the first board ${JSON.stringify(a.resets[0])} (the hard-coded Daedalus@5 is the 2026-10-08 bug)`);
      const startWhy = a.published[0]?.opponentStartup ?? a.published[0]?.opponentWhy ?? "";
      if (!/carried over from this life's last go\.txt \(Tetrads@7\)/.test(startWhy)) c2.fail("the startup source must be published (opponentStartup)", startWhy);
      c2.note(`same life: first board ${JSON.stringify(a.resets[0])}; startup '${startWhy}'`);

      // Another life's go.txt (telemetry survives installs): the default, said so.
      const b = await runMain({ prior: { ...sameLife, lastAugReset: LIFE - 3600e3 } });
      c2.examined(2);
      if (JSON.stringify(b.resets[0]) !== JSON.stringify(["Daedalus", 5])) c2.fail(`another life's go.txt must not be carried; got ${JSON.stringify(b.resets[0])}`);
      const bWhy = b.published[0]?.opponentStartup ?? b.published[0]?.opponentWhy ?? "";
      if (!/startup default.*another life/.test(bWhy)) c2.fail("the fallback must say why it is the default", bWhy);

      // Another BitNode with a colliding lastAugReset: not carried.
      const n = await runMain({ prior: { ...sameLife, bitNode: 2 } });
      c2.examined(1);
      if (JSON.stringify(n.resets[0]) !== JSON.stringify(["Daedalus", 5])) c2.fail(`another node's go.txt must not be carried; got ${JSON.stringify(n.resets[0])}`);

      // An explicit --opponent is the operator's.
      const e = await runMain({ prior: sameLife, args: ["--opponent", "Illuminati"], flagsOpp: "Illuminati" });
      c2.examined(1);
      if (e.resets[0]?.[0] !== "Illuminati") c2.fail(`--opponent must win over the carried arm; got ${JSON.stringify(e.resets[0])}`);

      // RESUME still wins: a game in progress is continued against its own opponent.
      const r = await runMain({ prior: sameLife, inProgress: "Illuminati" });
      c2.examined(2);
      if (r.resets.length) c2.fail(`a game in progress must be resumed, not reset; resetBoardState ran ${JSON.stringify(r.resets)}`);
      if (r.last?.opponent !== "Illuminati" || r.last?.resumed !== 1) c2.fail(`the resumed game is against its own opponent (Illuminati), got ${r.last?.opponent} resumed=${r.last?.resumed}`);
    } catch (err) {
      c2.fail(String(err?.stack ?? err).slice(0, 500));
    }
  }
  checks.push(c2);
  return checks;
}
