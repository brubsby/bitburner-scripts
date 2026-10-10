// [GC] The Go cheat channel: crime_success (Slum Snakes' bonus) priced by the
// cheat-on farm's rate gain (goplan cheatGain, mechanistic; chooseOpponent o.cheat).
//
//   GC1 cheatElasticity: positive on a rising segment of the table, 0 on a
//       falling one and outside it.
//   GC2 chooseOpponent: with cheats on and crime_success below the table's
//       knee, Slum Snakes (no exit weight of its own) is chosen at 0 node
//       power; at/above the knee it is not; with no o.cheat it is skipped BY
//       NAME, never priced as 0 silently.
import { Check } from "./harness.mjs";

export async function run() {
  const g = await import("../../goplan.js");
  const c1 = new Check("GC1", "the mechanistic cheat gain: availability rises with crime and with SF14.3; gain and elasticity are smooth and positive, small past the knee");
  {
    const a1 = g.cheatAvailability(1.5872), a2 = g.cheatAvailability(4), a3 = g.cheatAvailability(1.5872, { sf14: 3 });
    const e = (a) => a.reduce((x, y) => x + y, 0);
    c1.examined(6);
    if (!(e(a2) > e(a1))) c1.fail(`more crime must mean more cheats: ${e(a1).toFixed(2)} -> ${e(a2).toFixed(2)}`);
    if (!(e(a3) > e(a1))) c1.fail("SF14.3's +0.25 must mean more cheats");
    const gs = [1.2, 1.5872, 2.5, 4, 10, 25].map((c) => g.cheatGain(c));
    for (let i = 1; i < gs.length; i++) if (!(gs[i] >= gs[i - 1] - 1e-9)) c1.fail(`gain must not fall with crime: ${gs.map((x) => x.toFixed(3))}`);
    const el = [1.5872, 2.5, 10, 40].map((c) => g.cheatElasticity(c));
    if (!(el[0] > 0 && el[1] > 0 && el[2] > 0)) c1.fail(`elasticity must stay positive past the old table's end: ${el.map((x) => x.toFixed(4))}`);
    if (!(el[0] > el[2])) c1.fail("elasticity must fall as cheats saturate");
    if (g.cheatElasticity(0) !== 0) c1.fail("no crime: elasticity 0");
    c1.note(`gain at 1.2/1.59/2.5/4/10/25: ${gs.map((x) => x.toFixed(3)).join(" ")}; elasticity at 1.59/2.5/10/40: ${el.map((x) => x.toFixed(4)).join(" ")}`);
  }
  const c2 = new Check("GC2", "chooseOpponent prices Slum Snakes through the cheat channel, and only then");
  {
    const base = { weights: { combat: 1, faction_rep: 0.2, hacking_speed: 0.1, hacking_money: 0.1 }, windowH: 10, incumbent: "Tetrads", goPower: 4, sf14: 2 };
    const np = { Tetrads: 20000, SlumSnakes: 0, Daedalus: 20000, Illuminati: 20000, TheBlackHand: 20000, Netburners: 20000 };
    const low = g.chooseOpponent({ ...base, nodePower: np, cheat: { on: ["Tetrads"], crime: 1.5872, lifeLeftH: 8 } });
    // A very short life left: the warm-up cannot pay back.
    const atKnee = g.chooseOpponent({ ...base, nodePower: np, cheat: { on: ["Tetrads"], crime: 1.5872, lifeLeftH: 0.001 } });
    const none = g.chooseOpponent({ ...base, nodePower: np });
    c2.examined(3);
    if (low.opponent !== "SlumSnakes") c2.fail(`below the knee with cheats on, Slum Snakes must be chosen at 0 node power: ${low.opponent} (${low.why.slice(0, 200)})`);
    if (atKnee.opponent === "SlumSnakes") c2.fail("with ~no life left Slum Snakes cannot pay back and must not be chosen (horizon-aware)");
    if (!/SlumSnakes \(crime_success/.test(none.why)) c2.fail("with no cheat input Slum Snakes must be skipped by name", none.why.slice(-300));
    c2.note(`low: ${low.why.slice(0, 160)}`);
  }
  const c3 = new Check("GC3", "with arms (Thompson), the cheat channel prices Slum Snakes on 5x5 only — never a bigger board");
  {
    const base = { weights: { combat: 1, faction_rep: 0.2, hacking_speed: 0.1, hacking_money: 0.1 }, windowH: 10, incumbent: "Tetrads", goPower: 4, sf14: 2 };
    const np = { Tetrads: 20000, SlumSnakes: 0, Daedalus: 20000, Illuminati: 20000, TheBlackHand: 20000, Netburners: 20000 };
    // SlumSnakes@9 drawn wildly optimistic (a thin posterior): it must still get no cheat value.
    const arms = { "Tetrads@5": { pph: 24000, p: 0.99 }, "SlumSnakes@5": { pph: 20000, p: 0.98 }, "SlumSnakes@9": { pph: 400000, p: 0.99 }, "SlumSnakes@7": { pph: 300000, p: 0.99 } };
    const r = g.chooseOpponent({ ...base, nodePower: np, arms, incumbentArm: "Tetrads@5", cheat: { on: ["Tetrads"], crime: 1.5872, lifeLeftH: 8 } });
    c3.examined(2);
    if (r.arm !== "SlumSnakes@5") c3.fail(`the cheat channel must pick SlumSnakes@5, got ${r.arm}`, r.why.slice(0, 300));
    if (!/SlumSnakes@9 \(crime_success: the cheat channel is priced on 5x5 only\)/.test(r.why)) c3.fail("SlumSnakes@9 must be skipped by name", r.why.slice(-400));
  }
  const c4 = new Check("GC4", "the cheat horizon: a forecast's REMAINING hours are not reduced by the life's age (live shape: life started 14:43Z, exit 11.82h away, no install)");
  {
    const lastAugReset = Date.parse("2026-10-06T14:43:00Z");
    const now = Date.parse("2026-10-07T01:01:00Z"); // 10.3h into the life
    const blade = g.weightsFor({ lastAugReset, objective: { goWeights: { weights: { combat: 1 }, windowH: 11.82, remainingH: 11.82, asOf: now } } }, lastAugReset, {});
    const l1 = g.lifeLeftHOf(blade, { now, lastAugReset });
    const later = g.lifeLeftHOf(blade, { now: now + 1.5 * 3.6e6, lastAugReset });
    const full = g.lifeLeftHOf({ source: "goWeights", windowH: 14, remainingH: null }, { now, lastAugReset });
    const early = g.lifeLeftHOf({ source: "early", windowH: 8 }, { now, lastAugReset });
    c4.examined(4);
    if (!(Math.abs(l1.h - 11.82) < 1e-6)) c4.fail(`a fresh blade forecast of 11.82h left must read 11.82h, got ${l1.h} (${l1.source})`);
    if (!(Math.abs(later.h - 10.32) < 1e-6)) c4.fail(`1.5h after the pass it must read 10.32h, got ${later.h}`);
    if (!(Math.abs(full.h - 3.7) < 1e-6)) c4.fail(`a FULL 14h window 10.3h into the life leaves 3.7h, got ${full.h}`);
    if (!(early.h === 0.25 && /ASSUMED/.test(early.source))) c4.fail(`the early placeholder window must be named ASSUMED and floored: ${JSON.stringify(early)}`);
    c4.note(`${l1.h.toFixed(2)}h (${l1.source}); full window: ${full.h.toFixed(2)}h; early: ${early.h}h (${early.source})`);
  }
  const c5 = new Check("GC5", "the joint cheat end to end: go-solver answers a pair (second stone) when the request's roll says a cheat is available, and a single when it is not");
  {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const http = await import("node:http");
    const { spawn } = await import("node:child_process");
    const { REPO } = await import("./ram.mjs");
    const { loadModel } = await import(path.join(REPO, "tools/goai/model.mjs"));
    const model = await loadModel();
    if (!model) c5.warn("the opponent model could not load — GC5 did NOT run");
    else {
      const board = [".....", ".....", ".....", ".....", "....."];
      const valid = model.validMoves(board, []);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gocheat-"));
      const files = new Map();
      const pushed = [];
      const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (d) => (body += d));
        req.on("end", () => {
          const { method, params } = JSON.parse(body || "{}");
          if (method === "getFile") res.end(JSON.stringify({ result: files.get(params.filename) ?? null }));
          else if (method === "pushFile") {
            files.set(params.filename, params.content);
            if (params.filename === "/go/move.txt") pushed.push(JSON.parse(params.content));
            res.end(JSON.stringify({ result: "OK" }));
          } else res.end(JSON.stringify({ error: "unknown" }));
        });
      });
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      const port = server.address().port;
      const child = spawn(process.execPath, [path.join(REPO, "tools/go-solver.mjs"), "--maxms", "600", "--poll", "40", "--rpc", `http://127.0.0.1:${port}/rpc`, "--katago-remote", "none", "--ponder-cap-ms", "800", "--book-dir", dir, "--no-presend"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, KATAGO_DIR: "/nonexistent-katago" } });
      let stderr = "";
      child.stderr.on("data", (d) => (stderr += d));
      const wait = async (pred, ms = 20000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          const v = pred();
          if (v) return v;
          await new Promise((r) => setTimeout(r, 30));
        }
        return null;
      };
      try {
        // crime 20: chance(0) = 1, so the window is open whatever the roll.
        const T = 200 * 5123457;
        files.set("/go/req.txt", JSON.stringify({ seq: 1, size: 5, komi: 5.5, backend: "model", opponent: "Tetrads", board, valid, history: [], turnS: 1.06, T, cheat: { crime: 20, sf14: 0, cheats: 0, max: 12, turn: 3, fromTurn: 2, minChance: 0.0034 } }));
        const a = await wait(() => pushed.find((m) => m.seq === 1));
        c5.examined(2);
        if (!a) throw new Error(`no reply: ${stderr.slice(-300)}`);
        if (!a.second) c5.fail("a request whose roll is in the window must be answered with a PAIR (second stone)", JSON.stringify(a));
        else if ((a.second.x === a.x && a.second.y === a.y) || board[a.second.x][a.second.y] !== ".") c5.fail("the second stone must be a different empty point", JSON.stringify(a));
        // crime 0.001: no cheat can be available.
        files.set("/go/req.txt", JSON.stringify({ seq: 2, size: 5, komi: 5.5, backend: "model", opponent: "Tetrads", board: ["X....", ".....", ".....", ".....", "...O."], valid: model.validMoves(["X....", ".....", ".....", ".....", "...O."], []), history: [], turnS: 1.06, T: T + 7000, cheat: { crime: 0.001, sf14: 0, cheats: 0, max: 12, turn: 3, fromTurn: 2, minChance: 0.0034 } }));
        const b2 = await wait(() => pushed.find((m) => m.seq === 2));
        c5.examined(1);
        if (!b2) throw new Error(`no second reply: ${stderr.slice(-300)}`);
        if (b2.second) c5.fail("with no cheat available the answer must be a single stone", JSON.stringify(b2));
        c5.note(`pair answer ${a.x},${a.y} + ${a.second?.x},${a.second?.y}; no-cheat answer ${b2.x},${b2.y}`);
      } catch (e) {
        c5.fail(String(e?.message ?? e).slice(0, 300));
      } finally {
        child.kill();
        server.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  // THE GAME'S PAIR RULE (Go.ts playTwoMoves: validateMove x2 with { repeat:
  // false, suicide: false }, both stones set at once, then captures): each
  // point need only be EMPTY before the cheat. Ours: the first stone is in the
  // game's valid list (a legal single), the second empty before and not a
  // suicide after the first (golib secondOk, go.js pairSecondPoints).
  const pairLegal = (golib, board, valid, x1, y1, x2, y2) => {
    if (!valid[x1]?.[y1] || (x1 === x2 && y1 === y2) || board[x2]?.[y2] !== ".") return false;
    const b1 = golib.applyMove(board, x1, y1);
    return !!b1 && b1[x2][y2] === "." && !!golib.applyMove(b1, x2, y2);
  };
  const c6 = new Check("GC6", "joint pairs are legal for playTwoMoves as the game rules it: the first stone a legal single, the second EMPTY before the cheat and no suicide after the first (the 2026-10-07 05:25Z position: 1,4+0,1 is legal — 0,1 is a suicide alone, a capture after 1,4)");
  {
    const path = await import("node:path");
    const { REPO } = await import("./ram.mjs");
    const { loadModel } = await import(path.join(REPO, "tools/goai/model.mjs"));
    const golib = await import(path.join(REPO, "golib.js"));
    const model = await loadModel();
    if (!model) c6.warn("the opponent model could not load — GC6 did NOT run");
    else {
      // Live, before our 8th move: the pair 1,4+0,1 was chosen — 0,1 is a
      // suicide until 1,4 captures, so the game refuses it, go.js dropped it
      // and played 1,4 alone (self-atari, 8 stones lost).
      const board = ["#.OOO", "#OOX.", "#XOXX", "#XXXO", "#.#O."];
      const validList = model.validMoves(board, []);
      const valid = board.map((col, x) => [...col].map((_, y) => validList.some(([vx, vy]) => vx === x && vy === y)));
      const reply = (b, o) => model.reply(b, { ...o, opponent: "Tetrads" });
      let bad = 0;
      let pairs = 0;
      for (let rep = 0; rep < 3; rep++) {
        const sess = golib.modelSession(5, 5.5, { reply }, { pairs: [6, 5], pairsOnly: true, seed: 11 + rep });
        sess.setRoot(board, valid, { cheat: { fns: [() => true], cheats: 1 } });
        await sess.search({ maxms: 600 });
        const r = sess.best();
        c6.examined(1);
        for (const t of r?.[0]?.top ?? []) {
          if (t.length < 6) continue;
          pairs++;
          const sx = (t[5] / 5) | 0, sy = t[5] % 5;
          if (!pairLegal(golib, board, valid, t[0], t[1], sx, sy)) { bad++; c6.fail(`pair ${t[0]},${t[1]}+${sx},${sy}: not legal under the game's pair rule`); }
        }
      }
      if (!pairs) c6.fail("no pairs searched where a cheat is available — the check examined nothing");
      c6.note(`${pairs} top pairs over 3 searches, ${bad} illegal`);
    }
  }
  const c7 = new Check("GC7", "pairsOnly with NO legal pair keeps the singles (the 2026-10-07 07:39Z loss: PASS-only root, a 50ms pass on a won board)");
  {
    const path = await import("node:path");
    const { REPO } = await import("./ram.mjs");
    const { loadModel } = await import(path.join(REPO, "tools/goai/model.mjs"));
    const golib = await import(path.join(REPO, "golib.js"));
    const model = await loadModel();
    if (!model) c7.warn("the opponent model could not load — GC7 did NOT run");
    else {
      // After our cheat 1,4+3,4 and the AI's 0,1: the only stone that is not an
      // own-eye fill is 3,2 (white in atari with no escape). Under the old
      // valid-list rule (opts.pairSecond 'valid') no pair exists — the case
      // this check was written for. Under the game's rule 3,2+4,1 is a pair
      // (4,1 a suicide alone, a capture of 4,2 after 3,2): 3,2 first either way.
      const board = ["#OO#.", "#OXXX", "#OOX.", "#O.XX", "#.O#."];
      const validList = model.validMoves(board, []);
      const valid = board.map((col, x) => [...col].map((_, y) => validList.some(([vx, vy]) => vx === x && vy === y)));
      const reply = (b, o) => model.reply(b, { ...o, opponent: "Tetrads" });
      for (const rule of ["valid", "game"]) {
        const sess = golib.modelSession(5, 5.5, { reply }, { pairs: [6, 5], pairsOnly: true, seed: 7, ...(rule === "game" ? { pairSecond: "game" } : {}) });
        const r0 = sess.setRoot(board, valid, { cheat: { fns: [() => true, () => true], cheats: 1 } });
        c7.examined(1);
        if (!r0) { c7.fail(`rule ${rule}: setRoot returned null (PASS only) where 3,2 is legal and winning`); continue; }
        await sess.search({ maxms: 400 });
        const b = sess.best();
        c7.examined(1);
        if (rule === "valid" && (!b?.length || b[0].x !== 3 || b[0].y !== 2 || b[0].second)) c7.fail("rule valid (no pair exists): the single 3,2 must be chosen", JSON.stringify(b?.[0] ?? null));
        else if (rule === "game" && (!b?.length || b[0].x !== 3 || b[0].y !== 2 || (b[0].second && !pairLegal(golib, board, valid, 3, 2, b[0].second.x, b[0].second.y)))) c7.fail("rule game: 3,2 (alone or with a legal second stone) must be chosen", JSON.stringify(b?.[0] ?? null));
        else c7.note(`rule ${rule}: 3,2${b[0].second ? `+${b[0].second.x},${b[0].second.y}` : ""} chosen, win rate ${b[0].top?.[0]?.[4]}`);
        if (sess.jointGuard.hits) c7.fail(`the pass-only guard fired ${sess.jointGuard.hits}x: a pair filter emptied a node (the guard hides it, the fix must not need it)`, JSON.stringify(sess.jointGuard.last));
      }
    }
  }
  const c8 = new Check("GC8", "joint pair search, PROPERTY over random positions (cheat window open and closed): every pair legal under playTwoMoves, never a PASS-only root where the plain search has stones, the pass-only guard never needed");
  {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { REPO } = await import("./ram.mjs");
    const { loadModel } = await import(path.join(REPO, "tools/goai/model.mjs"));
    const golib = await import(path.join(REPO, "golib.js"));
    const model = await loadModel();
    if (!model) c8.warn("the opponent model could not load — GC8 did NOT run");
    else {
      const layouts = JSON.parse(fs.readFileSync(path.join(REPO, "tools/goai/layouts-5.json"), "utf8")).layouts.slice(0, 40);
      // A fixed stream: the same positions on every run.
      let seed = 12345;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
      const reply = (b, o) => model.reply(b, { ...o, opponent: "Tetrads" });
      const grid = (board, list) => board.map((col, x) => [...col].map((_, y) => list.some(([a, b]) => a === x && b === y)));
      let positions = 0, pairsSeen = 0, passPairs = 0, guards = 0;
      const POS = 60;
      for (let n = 0; n < POS; n++) {
        const lay = layouts[(rnd() * layouts.length) | 0].key;
        let board = [0, 1, 2, 3, 4].map((x) => lay.slice(x * 5, x * 5 + 5));
        const history = [];
        const plies = 2 + ((rnd() * 9) | 0);
        let ok = true;
        for (let k = 0; k < plies && ok; k++) {
          const v = model.validMoves(board, history);
          if (!v.length) { ok = false; break; }
          const [x, y] = v[(rnd() * v.length) | 0];
          const nb = golib.applyMove(board, x, y);
          if (!nb) { ok = false; break; }
          history.unshift(board.join(""));
          board = nb;
          const r = await reply(board, { history, passCount: 0, rng: (rnd() * 3e7) | 0 });
          if (!r) { ok = false; break; }
          // White's stone with its captures: golib.applyMove on the colour-swapped board.
          const swap = (bd) => bd.map((col) => col.replace(/[XO]/g, (c) => (c === "X" ? "O" : "X")));
          const wb = golib.applyMove(swap(board), r.x, r.y);
          if (!wb) { ok = false; break; }
          history.unshift(board.join(""));
          board = swap(wb);
        }
        if (!ok) continue;
        const list = model.validMoves(board, history);
        const valid = grid(board, list);
        for (const open of [true, false]) {
          positions++;
          const sp = golib.modelSession(5, 5.5, { reply }, { pairs: [6, 5], pairsOnly: true, seed: 100 + n });
          const ss = golib.modelSession(5, 5.5, { reply }, { seed: 100 + n });
          const rp = sp.setRoot(board, valid, { history, cheat: { fns: open ? [() => true, () => true] : null, cheats: 1 } });
          const rs = ss.setRoot(board, valid, { history });
          c8.examined(1);
          if (!rp && rs) { c8.fail(`a PASS-only root with pairs (open ${open}) where the plain search has stones`, board.join("/")); continue; }
          if (!rp) continue;
          await sp.search({ maxms: 5000, untilWork: 120, untilVisits: 6100 });
          const b = sp.best();
          guards += sp.jointGuard.hits;
          if (sp.jointGuard.hits) c8.fail(`the pass-only guard fired (open ${open})`, JSON.stringify(sp.jointGuard.last));
          const t = b?.[0];
          // Every searched pair in the top 3, not only the chosen one.
          for (const e of t?.top ?? []) {
            if (e.length < 6) continue;
            const sx = (e[5] / 5) | 0, sy = e[5] % 5;
            if (!pairLegal(golib, board, valid, e[0], e[1], sx, sy)) c8.fail(`an illegal pair searched: ${e[0]},${e[1]}+${sx},${sy}`, board.join("/"));
          }
          if (t?.second) {
            pairsSeen++;
            if (!open) c8.fail("a pair where the cheat window is closed", board.join("/"));
            if (!pairLegal(golib, board, valid, t.x, t.y, t.second.x, t.second.y)) c8.fail(`an illegal pair ${t.x},${t.y}+${t.second.x},${t.second.y} (the first a legal single, the second empty before and no suicide after the first)`, board.join("/"));
          } else if (!t && rs) {
            // a pass where stones exist: must also be the plain search's answer
            await ss.search({ maxms: 5000, untilWork: 120, untilVisits: 6100 });
            const sb = ss.best();
            if (sb && sb.length) { passPairs++; c8.fail(`PASS with pairs on (open ${open}) where the plain search plays ${sb[0].x},${sb[0].y}`, board.join("/")); }
          }
        }
      }
      if (positions < 60) c8.fail(`only ${positions} positions examined (the generator failed) — the property was not tested`);
      c8.note(`${positions} position/window cases, ${pairsSeen} pair answers, ${passPairs} bad passes, guard hits ${guards}`);
    }
  }
  const c9 = new Check("GC9", "go-solver's pass guard: with the cheat window open, a PASS chosen among pairs is re-searched without pairs — never answered where the single search plays a stone");
  {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const http = await import("node:http");
    const { spawn } = await import("node:child_process");
    const { REPO } = await import("./ram.mjs");
    const { loadModel } = await import(path.join(REPO, "tools/goai/model.mjs"));
    const model = await loadModel();
    if (!model) c9.warn("the opponent model could not load — GC9 did NOT run");
    else {
      // An open board, where the single search never passes (a marginal
      // position made the check flaky: the single search itself passed).
      // --fault-joint-pass 5: the first 5 searches with pairs answer PASS
      // (injected) — the guard must turn each into a stone.
      const board = [".....", ".X...", ".....", "...O.", "....."];
      const valid = model.validMoves(board, []);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gocheat9-"));
      const files = new Map();
      const pushed = [];
      const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (d) => (body += d));
        req.on("end", () => {
          const { method, params } = JSON.parse(body || "{}");
          if (method === "getFile") res.end(JSON.stringify({ result: files.get(params.filename) ?? null }));
          else if (method === "pushFile") {
            files.set(params.filename, params.content);
            if (params.filename === "/go/move.txt") pushed.push(JSON.parse(params.content));
            res.end(JSON.stringify({ result: "OK" }));
          } else res.end(JSON.stringify({ error: "unknown" }));
        });
      });
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      const port = server.address().port;
      const child = spawn(process.execPath, [path.join(REPO, "tools/go-solver.mjs"), "--maxms", "300", "--poll", "40", "--rpc", `http://127.0.0.1:${port}/rpc`, "--katago-remote", "none", "--ponder-cap-ms", "0", "--book-dir", dir, "--no-presend", "--fault-joint-pass", "5"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, KATAGO_DIR: "/nonexistent-katago" } });
      let stderr = "";
      child.stderr.on("data", (d) => (stderr += d));
      const wait = async (pred, ms = 20000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          const v = pred();
          if (v) return v;
          await new Promise((r) => setTimeout(r, 30));
        }
        return null;
      };
      try {
        let passes = 0, guarded = 0;
        const T = 200 * 5123457;
        for (let seq = 1; seq <= 10; seq++) {
          // A different (fresh) position key each time defeats reuse: alternate komi.
          files.set("/go/req.txt", JSON.stringify({ seq, size: 5, komi: seq % 2 ? 5.5 : 6.5, backend: "model", opponent: "Tetrads", board, valid, history: [], turnS: 1.06, T: T + seq * 7000, cheat: { crime: 20, sf14: 0, cheats: 2, max: 12, turn: 6, fromTurn: 2, minChance: 0.0034 } }));
          const a = await wait(() => pushed.find((m) => m.seq === seq));
          c9.examined(1);
          if (!a) throw new Error(`no reply to seq ${seq}: ${stderr.slice(-300)}`);
          if (a.pass) passes++;
          if (a.jointGuard) guarded++;
        }
        if (passes) c9.fail(`${passes}/10 answers were PASS where the single search plays a stone`);
        if (guarded < 5) c9.fail(`the guard fired ${guarded}x for 5 injected passes among pairs`);
        c9.note(`10 requests, ${passes} passes, the guard turned ${guarded} pass(es) among pairs into stones`);
      } catch (e) {
        c9.fail(String(e?.message ?? e).slice(0, 300));
      } finally {
        child.kill();
        server.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  const c10 = new Check("GC10", "a played cheat's outcome is read off the board: a reply capturing BOTH stones is a capture (move history), a cheat that placed neither is a failure; the chance at SF14.3 in a crime-1 node (BN9.2) carries the +0.25");
  {
    const path = await import("node:path");
    const { REPO } = await import("./ram.mjs");
    const G = await import(path.join(REPO, "golib.js"));
    const place = (b, x, y, c) => b.map((col, i) => (i === x ? col.slice(0, y) + c + col.slice(y + 1) : col));
    // The live 22:34Z shape (mirrored to a corner): our 4,3+4,4 under white
    // 3,3 / 3,4, the AI answers 4,2 and takes both.
    const before = [".....", ".....", ".....", "...OO", "....."];
    const stones = [[4, 3], [4, 4]];
    const placed = place(place(before, 4, 3, "X"), 4, 4, "X");
    const after = place(before, 4, 2, "O"); // both readings give this board
    const cases = [
      ["both captured, history holds the stones", G.cheatOutcome(before, stones, { x: 4, y: 2 }, after, placed), "played"],
      ["both captured, history without the stones", G.cheatOutcome(before, stones, { x: 4, y: 2 }, after, before), "failed"],
      ["both captured, no history", G.cheatOutcome(before, stones, { x: 4, y: 2 }, after, null), "unknown"],
      ["played, nothing captured", G.cheatOutcome(before, stones, { x: 0, y: 0 }, place(placed, 0, 0, "O"), null), "played"],
      ["failed, reply elsewhere", G.cheatOutcome(before, stones, { x: 0, y: 0 }, place(before, 0, 0, "O"), null), "failed"],
      ["played, the AI passed", G.cheatOutcome(before, stones, null, placed, null), "played"],
      ["neither reading", G.cheatOutcome(before, stones, { x: 0, y: 0 }, place(before, 1, 1, "O"), null), "unknown"],
    ];
    for (const [what, got, want] of cases) {
      c10.examined(1);
      if (got !== want) c10.fail(`${what}: ${got}, want ${want}`);
    }
    // cheatSuccessChance (netscriptGoImplementation.ts:561-567) at SF14.3 and
    // crime_success 1.0 (a fresh node, no Slum Snakes power): 0.6 + 0.25 at k=0,
    // min(1, ...) capped, and the bonus present at every k.
    const want = (k, crime, sf) => Math.max(Math.min(0.6 * (0.7 - 0.02 * k) ** k * crime + (sf === 3 ? 0.25 : 0), 1), 0);
    for (const [k, crime, sf] of [[0, 1, 3], [1, 1, 3], [4, 1, 3], [11, 1, 3], [0, 2.5, 3], [2, 1, 2], [0, 1, 0]]) {
      c10.examined(1);
      const got = G.cheatChance(k, crime, sf);
      if (Math.abs(got - want(k, crime, sf)) > 1e-12) c10.fail(`cheatChance(${k}, ${crime}, SF14.${sf}) = ${got}, game ${want(k, crime, sf)}`);
    }
    if (Math.abs(G.cheatChance(0, 1, 3) - 0.85) > 1e-12) c10.fail(`cheatChance(0, crime 1, SF14.3) must be 0.85, got ${G.cheatChance(0, 1, 3)}`);
  }
  const c11 = new Check("GC11", "the hard-move pair (go.js SETTINGS.cheat.hardBelow, the 2026-10-08 19:08Z loss): a single winning under hardBelow asks for the pair jointly; the pre-sent answer carries its win rate; a declined pair never plays its first stone alone");
  {
    const path = await import("node:path");
    const fs = await import("node:fs");
    const { REPO } = await import("./ram.mjs");
    await import("./gameresolve.mjs"); // root scripts import bare names ('golib.js')
    const go = await import(path.join(REPO, "go.js"));
    const hb = go.SETTINGS.cheat.hardBelow;
    c11.examined(1);
    if (!(hb > 0 && hb < 1)) c11.fail(`SETTINGS.cheat.hardBelow is ${hb}: the hard-move pair is off (the 19:08Z loss's greedy chain is back)`);
    for (const [wr, thr, want] of [[0.28, 0.5, true], [0.5, 0.5, false], [0.9, 0.5, false], [null, 0.5, false], [undefined, 0.5, false], [NaN, 0.5, false], [0.1, 0, false]]) {
      c11.examined(1);
      if (go.hardPairWanted(wr, thr) !== want) c11.fail(`hardPairWanted(${wr}, ${thr}) = ${go.hardPairWanted(wr, thr)}, want ${want} (an unknown win rate never asks)`);
    }
    // The pre-sent path: the ponder's wr reaches go.js (the 19:08Z cheat's first stone was pre-sent).
    const B = [".....", ".....", ".....", ".....", "....."];
    const valid = B.map(() => [true, true, true, true, true]);
    const text = JSON.stringify({ answers: [{ b: B.join(""), pc: 0, x: 4, y: 2, wr: 0.28 }] });
    const a = go.presentAnswer(text, B, valid, false).answer;
    c11.examined(1);
    if (!(a && a.x === 4 && a.y === 2 && a.wr === 0.28)) c11.fail(`presentAnswer dropped the ponder's wr: ${JSON.stringify(a)}`);
    // The loop: the cheat plays first+pairSecond; a cheat not played falls through to ranked[0] (the single).
    const src = fs.readFileSync(path.join(REPO, "go.js"), "utf8");
    for (const [what, re] of [
      ["the hard request carries `cheat` (the solver searches pairs)", /hardPairWanted\(singleWr\)[\s\S]{0,600}askSolver\(boardStrings, validList, \{ cheat: \{/],
      ["the cheat is played from the hard pair", /tryCheat\(boardStrings, validList, first, pairSecond[,)]/],
      ["a declined hard pair plays the single (ranked[0]), never the pair's first stone", /ns\.go\.makeMove\(ranked\[0\]\.x, ranked\[0\]\.y\)/],
      ["the solver, which committed the pair, is told the single played", /src === 'pre' \|\| hardDeclined\) notifySolver/],
      ["a pre-sent PAIR (the ponder after a hard request searches pairs) is not played with joint off", /if \(pre\.answer\?\.second && !SETTINGS\.cheat\.joint\)/],
    ]) {
      c11.examined(1);
      if (!re.test(src)) c11.fail(`go.js: ${what} — not found`);
    }
  }
  const c12 = new Check("GC12", "THE DECLINE and the hard pair's extension (go.js SETTINGS.cheat.decline / hardAdaptive, the 2026-10-09 02:21:48Z and 02:32:31Z Illuminati losses): a second stone or hard pair winning under the single is not played; the hard request carries its own adaptive budget");
  {
    const path = await import("node:path");
    const fs = await import("node:fs");
    const { REPO } = await import("./ram.mjs");
    await import("./gameresolve.mjs");
    const go = await import(path.join(REPO, "go.js"));
    const S = go.SETTINGS.cheat;
    c12.examined(1);
    if (!(S.decline >= 0 && S.decline < 0.5)) c12.fail(`SETTINGS.cheat.decline is ${S.decline}: the decline is off (the 02:32:31Z eye-fill cheat 4,4+3,1 is back)`);
    c12.examined(1);
    const ha = S.hardAdaptive?.Illuminati;
    if (!(ha && ha.thr > 0 && ha.mult > 1)) c12.fail(`SETTINGS.cheat.hardAdaptive.Illuminati is ${JSON.stringify(ha)}: the 800ms hard-pair search is back (the 02:21:48Z loss)`);
    // 02:32:31Z ply 6: single 0.998, the fill's line ~0 -> declined.
    for (const [w1, w2, m, want] of [[0.998, 0, 0.1, true], [0.6, 0.55, 0.1, false], [0.6, 0.49, 0.1, true], [0.3, 0.9, 0.1, false], [null, 0, 0.1, false], [0.9, undefined, 0.1, false], [0.9, NaN, 0.1, false], [0.9, 0, null, false]]) {
      c12.examined(1);
      if (go.cheatDeclined(w1, w2, m) !== want) c12.fail(`cheatDeclined(${w1}, ${w2}, ${m}) = ${go.cheatDeclined(w1, w2, m)}, want ${want} (an unknown win rate never declines)`);
    }
    const src = fs.readFileSync(path.join(REPO, "go.js"), "utf8");
    const sol = fs.readFileSync(path.join(REPO, "tools", "go-solver.mjs"), "utf8");
    for (const [what, re, text] of [
      ["the greedy second stone is checked against the single's win rate", /if \(asked && cheatDeclined\(singleWr, lastTop\?\.\[0\]\?\.\[4\]\)/, src],
      ["tryCheat is given the single's win rate", /tryCheat\(boardStrings, validList, first, pairSecond, singleWr\)/, src],
      ["a hard pair is checked against the single's win rate", /cheatDeclined\(singleWr, lastTop\?\.\[0\]\?\.\[4\]\)[\s\S]{0,200}if \(!pairDeclined && p0\?\.second/, src],
      ["the hard request carries hardAdaptive (pair-only)", /adaptive: ha, adaptivePairOnly: true/, src],
      ["a solver that answered a second-stone request is told the single played", /hardDeclined = hardAsked \|\| !!c\.asked/, src],
      ["the solver keeps the pre-send filter across a pair-only adaptive request", /if \(!req\.adaptivePairOnly\) lastAdaptive =/, sol],
    ]) {
      c12.examined(1);
      if (!re.test(text)) c12.fail(`${what} — not found`);
    }
  }
  const c13 = new Check("GC13", "THE SECOND STONE WITHOUT THE NET (go.js SETTINGS.cheat.secondNet, the 2026-10-09 10:56/11:26/11:34Z Illuminati losses): Illuminati's second-stone request says secondNet false, the solver roots it at nnDepth -1, and golib then never asks the net");
  {
    const path = await import("node:path");
    const fs = await import("node:fs");
    const { REPO } = await import("./ram.mjs");
    await import("./gameresolve.mjs");
    const go = await import(path.join(REPO, "go.js"));
    for (const [opp, want] of [["Illuminati", false], ["Tetrads", true], ["Daedalus", true]]) {
      c13.examined(1);
      if (go.secondNetFor(opp) !== want) c13.fail(`secondNetFor(${opp}) = ${go.secondNetFor(opp)}, want ${want}${opp === "Illuminati" ? " (the net's second-stone search is back: every second stone read ~0 at 10:56Z)" : " (measured only on Illuminati)"}`);
    }
    const src = fs.readFileSync(path.join(REPO, "go.js"), "utf8");
    const sol = fs.readFileSync(path.join(REPO, "tools", "go-solver.mjs"), "utf8");
    for (const [what, re, text] of [
      ["the second-stone request carries secondNet false where secondNetFor says so", /askSolver\(board2, valid2, [^\n]*secondNetFor\(opponent\) \? \{\} : \{ secondNet: false \}/, src],
      ["the solver roots a secondNet:false request at nnDepth -1", /req\.secondNet === false \? \{ nnDepth: -1 \}/, sol],
      ["the per-game log keeps the cheat decision's inputs (w, d, t)", /cheatNote = \{[^\n]*d: c\.declined/, src],
    ]) {
      c13.examined(1);
      if (!re.test(text)) c13.fail(`${what} — not found`);
    }
    // golib: a session with a counting net; nnDepth -1 asks it nothing, the default asks it.
    const golib = await import(path.join(REPO, "golib.js"));
    const N = 5;
    const board = [".....", ".....", "..O..", ".....", "....."];
    const valid = board.map((col) => [...col].map((c) => c === "."));
    let evals = 0;
    const nn = { eval: async () => { evals++; return { policy: new Float32Array(N * N).fill(1 / (N * N)), pass: 0.01, winB: 0.5, areaB: 12 }; }, mix: 0, maxDepth: 1 };
    const reply = () => null; // the AI passes
    for (const [nnDepth, wantAsked] of [[-1, false], [undefined, true]]) {
      evals = 0;
      const sess = golib.modelSession(N, 7.5, { reply }, { seed: 1, nn });
      sess.setRoot(board, valid, { history: [], opponentPassed: false, ...(nnDepth !== undefined ? { nnDepth } : {}) });
      await sess.search({ maxms: 2000, untilWork: 50, untilVisits: 2000 });
      c13.examined(1);
      if ((evals > 0) !== wantAsked) c13.fail(`setRoot nnDepth ${nnDepth}: the net was asked ${evals} times, want ${wantAsked ? "> 0" : "0"}`);
      // commit restores the session's own depth for the ponder.
      if (nnDepth === -1) {
        const b = sess.best();
        evals = 0;
        sess.commit(b?.[0]?.x ?? null, b?.[0]?.y ?? null);
        await sess.ponder?.(300);
        c13.examined(1);
        if (sess.ponder && evals === 0) c13.warn("after a no-net second stone the ponder never asked the net (commit did not restore nnDepth?)");
      }
    }
  }
  const c14 = new Check("GC14", "THE DECLINE ONLY FOR A HARMFUL SECOND STONE (go.js SETTINGS.cheat.declineHarm): the win rates decline a second stone only when it fills our own eye or self-ataris (golib.stoneHarm) — live declined 1.36 good cheats a game on a 100ms search's win rate");
  {
    const path = await import("node:path");
    const fs = await import("node:fs");
    const { REPO } = await import("./ram.mjs");
    const go = await import(path.join(REPO, "go.js"));
    const golib = await import(path.join(REPO, "golib.js"));
    c14.examined(1);
    if (go.SETTINGS.cheat.declineHarm !== true) c14.fail(`SETTINGS.cheat.declineHarm is ${go.SETTINGS.cheat.declineHarm}: every second stone reading under the single is declined again (1.36 a game live, most of them good cheats)`);
    // board strings are columns (board[x][y]).
    for (const [what, board, x, y, want] of [
      ["the 02:32:31Z second stone 3,1 (after 4,4): an own-eye fill", [".OOOO", "OXOO.", "XXXX#", "#.XXX", "##X.X"], 3, 1, "eye"],
      ["the 11:34:09Z second stone 1,4 (after 3,1): a plain stone", ["#.#.#", ".XOX.", ".XOO.", "#XXO.", "....#"], 1, 4, null],
      ["the 11:26:53Z second stone 1,2 (after 3,2): a plain stone", ["...#.", ".O...", "#.OX.", "#.X..", "...##"], 1, 2, null],
      ["a lone stone pushed into white's mouth: self-atari", [".O...", "O....", ".....", ".....", "....."], 0, 0, "atari"],
      ["a stone that captures is never harm", ["XO...", ".X...", ".....", ".....", "....."], 0, 2, null],
      ["an occupied point is no stone at all", ["XO...", ".....", ".....", ".....", "....."], 0, 1, null],
    ]) {
      c14.examined(1);
      const got = golib.stoneHarm(board, x, y);
      if (got !== want) c14.fail(`${what}: stoneHarm = ${got}, want ${want}`);
    }
    const src = fs.readFileSync(path.join(REPO, "go.js"), "utf8");
    c14.examined(1);
    if (!/cheatDeclined\(singleWr, lastTop\?\.\[0\]\?\.\[4\]\) && \(!SETTINGS\.cheat\.declineHarm \|\| stoneHarm\(board2, second\[0\]\.x, second\[0\]\.y\)\)/.test(src)) c14.fail("tryCheat's decline is not gated on stoneHarm(board2, second) — not found");
  }
  const c15 = new Check("GC15", "THE GAME'S SECOND-STONE RULE (go.js SETTINGS.cheat.secondRule 'game', the 2026-10-09 22:10:40Z Illuminati loss): a cheat's second stone may be a suicide ALONE that captures after the first — 2,1+1,0 takes white's six stones; the old valid-list rule never offered 1,0");
  {
    const path = await import("node:path");
    const fs = await import("node:fs");
    const { REPO } = await import("./ram.mjs");
    await import("./gameresolve.mjs");
    const go = await import(path.join(REPO, "go.js"));
    const golib = await import(path.join(REPO, "golib.js"));
    const { loadModel } = await import(path.join(REPO, "tools/goai/model.mjs"));
    const model = await loadModel();
    // Live, before our 7th move (ply 6): white's 0,1/1,1/0,2/1,2/2,2/2,3 on two
    // liberties, 1,0 (a suicide for black alone) and 2,1; black's 0,3/1,3 in
    // atari at 0,4. Board strings are columns (board[x][y]).
    const board = ["#OOX.", ".OOX#", "#.OOX", ".XXXX", "#.#X."];
    const first = { x: 2, y: 1 };
    const board2 = golib.applyMove(board, first.x, first.y);
    const has10 = (list) => list.some(([x, y]) => x === 1 && y === 0);
    c15.examined(1);
    // Live stays 'valid' (the game's rule measured, not paid: go.js SETTINGS.cheat.secondRule).
    if (!["game", "valid"].includes(go.SETTINGS.cheat.secondRule)) c15.fail(`SETTINGS.cheat.secondRule is ${go.SETTINGS.cheat.secondRule}: neither 'game' nor 'valid'`);
    else c15.note(`live secondRule: ${go.SETTINGS.cheat.secondRule}`);
    c15.examined(1);
    const pts = go.pairSecondPoints(board, board2, first);
    if (!has10(pts)) c15.fail(`pairSecondPoints after 2,1 lacks 1,0: ${JSON.stringify(pts)}`);
    if (pts.some(([x, y]) => board[x][y] !== "." || (x === first.x && y === first.y))) c15.fail("pairSecondPoints offered a point not empty before the cheat (or the first stone)");
    // A point the first stone's capture empties is NOT a legal second stone (not empty before).
    c15.examined(1);
    const capB = ["XO...", ".X...", ".....", ".....", "....."];
    const capB2 = golib.applyMove(capB, 0, 2);
    if (go.pairSecondPoints(capB, capB2, { x: 0, y: 2 }).some(([x, y]) => x === 0 && y === 1)) c15.fail("pairSecondPoints offered 0,1, emptied only by the first stone's capture (the game: not empty before)");
    const src = fs.readFileSync(path.join(REPO, "go.js"), "utf8");
    c15.examined(1);
    if (!/const valid2 = SETTINGS\.cheat\.secondRule === 'valid' \? [^\n]*: pairSecondPoints\(board, board2, first\)/.test(src)) c15.fail("tryCheat's second-stone list is not pairSecondPoints under secondRule 'game' — not found");
    if (!model) c15.warn("the opponent model could not load — the search half of GC15 did NOT run");
    else {
      const validList = model.validMoves(board, []);
      c15.examined(1);
      if (has10(validList)) c15.fail("the game's valid list now offers 1,0 before the cheat — the position no longer shows the rule");
      const reply = (b, o) => model.reply(b, { ...o, opponent: "Illuminati" });
      const grid = (list) => board.map((col, x) => [...col].map((_, y) => list.some(([a, b]) => a === x && b === y)));
      // The greedy second stone: a 100-work search on board2 over each rule's list.
      for (const [rule, list] of [["game", pts], ["valid", validList.filter(([x, y]) => !(x === 2 && y === 1) && board2[x][y] === ".")]]) {
        const sess = golib.modelSession(5, 7.5, { reply }, { seed: 3 });
        sess.setRoot(board2, grid(list), { history: [board.join("")], opponentPassed: false, nnDepth: -1 });
        await sess.search({ maxms: 20000, untilWork: 100, untilVisits: 4000 });
        const b = sess.best();
        const mv = b && b.length ? `${b[0].x},${b[0].y}` : "PASS";
        c15.examined(1);
        if (rule === "game" && mv !== "1,0") c15.fail(`the second-stone search under the game's rule chose ${mv}, not the capture 1,0`);
        if (rule === "valid" && mv === "1,0") c15.fail("the old rule's search chose 1,0 — the list was not the valid list");
        c15.note(`second stone after 2,1, rule ${rule}: ${mv} (${b?.[0]?.top?.[0]?.[4] ?? "-"})`);
      }
      // The pair search (the hard pair): a pair taking 1,0 under the game's
      // rule; none with second stone 1,0 under opts.pairSecond 'valid'.
      for (const [rule, opts] of [["game", { pairSecond: "game" }], ["valid", {}]]) {
        const sess = golib.modelSession(5, 7.5, { reply }, { pairs: [6, 5], pairsOnly: true, seed: 5, ...opts });
        sess.setRoot(board, grid(validList), { history: [], cheat: { fns: [() => true], cheats: 2 } });
        await sess.search({ maxms: 20000, untilWork: 400, untilVisits: 16000 });
        const t = sess.best()?.[0];
        const second10 = (t?.top ?? []).some((e) => e.length >= 6 && e[5] === 1 * 5 + 0);
        c15.examined(1);
        if (rule === "game" && !(t?.second?.x === 1 && t?.second?.y === 0)) c15.fail(`the pair search under the game's rule chose ${t ? `${t.x},${t.y}+${t.second?.x},${t.second?.y}` : "PASS"}, not a pair taking 1,0`);
        if (rule === "valid" && second10) c15.fail("the pair search under pairSecond 'valid' searched a pair with second stone 1,0");
        c15.note(`pair search, rule ${rule}: ${t ? `${t.x},${t.y}+${t.second?.x},${t.second?.y} (${t.top?.[0]?.[4]})` : "PASS"}`);
      }
    }
  }
  const c16 = new Check("GC16", "THE SECOND-STONE ROOT (golib setRoot cheatSecond, go.js secondStone): its board stays out of the AI's history (playTwoMoves records none) and its PASS is 'no second stone'; a root whose PASS ends the game lost expands its stones (the 02:32:31Z ko retake, the 10:56:22Z ply-8 pass)");
  {
    const path = await import("node:path");
    const fs = await import("node:fs");
    const { REPO } = await import("./ram.mjs");
    await import("./gameresolve.mjs");
    const go = await import(path.join(REPO, "go.js"));
    const golib = await import(path.join(REPO, "golib.js"));
    const R = await import(path.join(REPO, "tools/sim/go-regress.mjs"));
    const { loadModel } = await import(path.join(REPO, "tools/goai/model.mjs"));
    const model = await loadModel();
    const src = fs.readFileSync(path.join(REPO, "go.js"), "utf8");
    const sol = fs.readFileSync(path.join(REPO, "tools", "go-solver.mjs"), "utf8");
    for (const [what, re, text] of [
      ["go.js's second-stone request says secondStone under secondRoot 'game'", /askSolver\(board2, valid2, \{ \.\.\.\(SETTINGS\.cheat\.secondRoot === 'game' \? \{ secondStone: true \} : \{\}\),/, src],
      ["go-solver roots a secondStone request with cheatSecond", /req\.secondStone \? \{ cheatSecond: true \}/, sol],
    ]) {
      c16.examined(1);
      if (!re.test(text)) c16.fail(`${what} — not found`);
    }
    if (!model) c16.warn("the opponent model could not load — the search half of GC16 did NOT run");
    else {
      const reply = (b, o) => model.reply(b, { ...o, opponent: "Illuminati" });
      const grid = (board, list) => board.map((col, x) => [...col].map((_, y) => list.some(([a, b]) => a === x && b === y)));
      // 02:32:31Z, ply 6, after the single 4,4: 0,0 retakes the ko (1,0's last
      // liberty). The game lets white retake at once — the board it makes is
      // the board after 4,4, which no game history holds — so 4,4+0,0 only
      // hands white the ko; the single alone wins (21-7.5 replayed).
      const P = [".OOOO", "OXOO.", "XXXX#", "#.XXX", "##X.."];
      const B2 = golib.applyMove(P, 4, 4);
      const pts = go.pairSecondPoints(P, B2, { x: 4, y: 4 });
      for (const cs of [true, false]) {
        const sess = golib.modelSession(5, 7.5, { reply }, { seed: 1 });
        sess.setRoot(B2, grid(B2, pts), { history: [], opponentPassed: false, nnDepth: -1, cheatSecond: cs });
        await sess.search({ maxms: 20000, untilWork: 100, untilVisits: 4000 });
        const b = sess.best();
        const mv = b && b.length ? `${b[0].x},${b[0].y}` : "none";
        c16.examined(1);
        if (cs && mv !== "none") c16.fail(`cheatSecond: the second-stone search chose ${mv}, not 'no second stone' (the ko retake 0,0 reads won only if white cannot retake)`, JSON.stringify(sess.rootStats()));
        else if (!cs && mv !== "0,0") c16.warn(`without cheatSecond the search no longer chooses the retake 0,0 (${mv}) — the contrast drifted`);
        else c16.note(`02:32:31Z second stone after 4,4, cheatSecond ${cs}: ${mv}`);
      }
      // 10:56:22Z, ply 8 on the line the game's rule plays: white passed and
      // black's PASS ends the game lost; the net gives every stone ~0 prior.
      const L = [".O#.#", "OOOX.", "O.OXX", "#OX.X", ".X.X."];
      const nn = await R.solverNn("Illuminati", 5);
      const sess = golib.modelSession(5, 7.5, { reply }, { seed: 1, nn });
      sess.setRoot(L, grid(L, model.validMoves(L, [])), { history: [], opponentPassed: true });
      await sess.search({ maxms: 20000, untilWork: 400, untilVisits: 16000 });
      const b = sess.best();
      c16.examined(1);
      if (!b || !b.length) c16.fail("the root whose PASS ends the game lost passed — its stones were never expanded (the 10:56:22Z ply-8 loss)", JSON.stringify(sess.rootStats()));
      else c16.note(`10:56:22Z ply 8 after the AI's pass: ${b[0].x},${b[0].y}`);
    }
  }
  return [c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13, c14, c15, c16];
}
