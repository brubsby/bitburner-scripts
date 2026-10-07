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
  const c6 = new Check("GC6", "joint pairs are legal for playTwoMoves: both stones legal on the board BEFORE either (the 2026-10-07 05:25Z wipe position)");
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
          if (!valid[sx][sy] || !valid[t[0]][t[1]]) { bad++; c6.fail(`pair ${t[0]},${t[1]}+${sx},${sy}: a stone not legal on the board before the first`); }
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
      // own-eye fill is 3,2 (white in atari with no escape) — no pair exists.
      const board = ["#OO#.", "#OXXX", "#OOX.", "#O.XX", "#.O#."];
      const validList = model.validMoves(board, []);
      const valid = board.map((col, x) => [...col].map((_, y) => validList.some(([vx, vy]) => vx === x && vy === y)));
      const reply = (b, o) => model.reply(b, { ...o, opponent: "Tetrads" });
      const sess = golib.modelSession(5, 5.5, { reply }, { pairs: [6, 5], pairsOnly: true, seed: 7 });
      const r0 = sess.setRoot(board, valid, { cheat: { fns: [() => true, () => true], cheats: 1 } });
      c7.examined(1);
      if (!r0) c7.fail("setRoot returned null (PASS only) where 3,2 is legal and winning");
      else {
        await sess.search({ maxms: 400 });
        const b = sess.best();
        c7.examined(1);
        if (!b?.length || b[0].x !== 3 || b[0].y !== 2 || b[0].second) c7.fail("the single 3,2 must be chosen", JSON.stringify(b?.[0] ?? null));
        else c7.note(`3,2 chosen, win rate ${b[0].top?.[0]?.[4]}`);
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
            if (!valid[e[0]]?.[e[1]] || !valid[sx]?.[sy]) c8.fail(`an illegal pair searched: ${e[0]},${e[1]}+${sx},${sy}`, board.join("/"));
          }
          if (t?.second) {
            pairsSeen++;
            if (!open) c8.fail("a pair where the cheat window is closed", board.join("/"));
            if (!valid[t.x]?.[t.y] || !valid[t.second.x]?.[t.second.y] || (t.x === t.second.x && t.y === t.second.y)) c8.fail(`an illegal pair ${t.x},${t.y}+${t.second.x},${t.second.y} (both must be in the game's valid list before either stone)`, board.join("/"));
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
      // A live position (audit, 2026-10-07 07:18:05Z ply 5) where the single
      // search plays a stone. --fault-joint-pass 5: the first 5 searches with
      // pairs answer PASS (injected) — the guard must turn each into a stone.
      const board = ["....#", ".X...", "#.XX.", "OOOX.", "O#O.#"];
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
  return [c1, c2, c3, c4, c5, c6, c7, c8, c9];
}
