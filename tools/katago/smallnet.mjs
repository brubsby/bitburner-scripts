// THE SMALL NET, in process: the distilled walls-KataGo net
// (tools/katago/distill_train.py) evaluated in plain JS — the opponent-model
// search's move prior with no GPU and no round trip (golib.modelSession
// opts.nn: eval(board, komi) -> { policy, pass, winB, areaB }).
//
//   const sn = loadSmallNet("sn5.json"); const e = sn.eval(boardStrings, komi)
//
// Same arithmetic as the PyTorch module: 3x3 convs with zero padding, ReLU,
// residual blocks, a 1x1 policy head + a pass logit from the global mean, a
// win logit from the global mean, tanh ownership (+ an optional outcome head,
// `vo`, trained on real games against the game's AIs). Checked against
// PyTorch's own output by tools/katago/smallnet-check.mjs (printed max error).
//
// SPEED: each 3x3 conv is im2col (a gather table built once per board size:
// for every output point, its 9 input points or a zero slot) followed by one
// contiguous dot product per (output channel, point) over cin*9 weights laid
// out tap-major — the hot loop is a single Float32Array dot of length cin*9.

import fs from "node:fs";

export function loadSmallNet(file) {
  const J = typeof file === "string" ? JSON.parse(fs.readFileSync(file, "utf8")) : file;
  return makeSmallNet(J);
}

export function makeSmallNet(J) {
  const N = J.size, C = J.ch, B = J.blocks, A = N * N;
  const W = {};
  for (const [k, v] of Object.entries(J.w)) W[k] = Float32Array.from(v);
  // The gather table: for output point p and tap t (dx, dy), the input point, or A (a zero slot).
  const gather = new Int32Array(A * 9);
  for (let x = 0; x < N; x++)
    for (let y = 0; y < N; y++)
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const u = x + dx, v = y + dy, t = (dx + 1) * 3 + (dy + 1);
          gather[(x * N + y) * 9 + t] = u < 0 || u >= N || v < 0 || v >= N ? A : u * N + v;
        }
  // Weights re-laid [cout][tap][cin] so a column (point p) is [tap][cin] contiguous too.
  const relayout = (w, cin, cout) => {
    const out = new Float32Array(cout * 9 * cin);
    for (let o = 0; o < cout; o++) for (let c = 0; c < cin; c++) for (let t = 0; t < 9; t++) out[(o * 9 + t) * cin + c] = w[(o * cin + c) * 9 + t];
    return out;
  };
  const convs = [{ w: relayout(W["inp.weight"], 6, C), b: W["inp.bias"], cin: 6 }];
  for (let k = 0; k < B; k++) {
    convs.push({ w: relayout(W[`blocks.${k}.a.weight`], C, C), b: W[`blocks.${k}.a.bias`], cin: C });
    convs.push({ w: relayout(W[`blocks.${k}.b.weight`], C, C), b: W[`blocks.${k}.b.bias`], cin: C });
  }
  // Activations are [point][channel] (channel-minor) with a zero row at index A.
  const col = new Float32Array(A * 9 * Math.max(C, 6));
  const conv = (inp, cv, cout, out) => {
    const cin = cv.cin, K = 9 * cin, w = cv.w, b = cv.b;
    for (let p = 0; p < A; p++) {
      const cb = p * K;
      for (let t = 0; t < 9; t++) {
        const src = gather[p * 9 + t] * cin, dst = cb + t * cin;
        for (let c = 0; c < cin; c++) col[dst + c] = inp[src + c];
      }
    }
    for (let p = 0; p < A; p++) {
      const cb = p * K, ob = p * cout;
      for (let o = 0; o < cout; o++) {
        const wb = o * K;
        let s0 = b[o], s1 = 0, s2 = 0, s3 = 0;
        let i = 0;
        for (; i + 3 < K; i += 4) {
          s0 += w[wb + i] * col[cb + i];
          s1 += w[wb + i + 1] * col[cb + i + 1];
          s2 += w[wb + i + 2] * col[cb + i + 2];
          s3 += w[wb + i + 3] * col[cb + i + 3];
        }
        for (; i < K; i++) s0 += w[wb + i] * col[cb + i];
        out[ob + o] = s0 + s1 + s2 + s3;
      }
    }
  };
  const inp = new Float32Array((A + 1) * 6), h = new Float32Array((A + 1) * C), t1 = new Float32Array((A + 1) * C), t2 = new Float32Array((A + 1) * C);
  const pw = W["pol.weight"], ow = W["own.weight"];
  const hasVo = !!W["vo2.weight"];
  return {
    size: N,
    heldOut: J.heldOut ?? null,
    eval(board, komi) {
      inp.fill(0);
      for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++) {
          const p = x * N + y, c = board[x][y];
          inp[p * 6 + "XO.#".indexOf(c)] = 1;
          inp[p * 6 + 4] = 1;
          inp[p * 6 + 5] = komi / 10;
        }
      conv(inp, convs[0], C, h);
      for (let i = 0; i < A * C; i++) if (h[i] < 0) h[i] = 0;
      for (let k = 0; k < B; k++) {
        conv(h, convs[1 + 2 * k], C, t1);
        for (let i = 0; i < A * C; i++) if (t1[i] < 0) t1[i] = 0;
        conv(t1, convs[2 + 2 * k], C, t2);
        for (let i = 0; i < A * C; i++) {
          const v = h[i] + t2[i];
          h[i] = v > 0 ? v : 0;
        }
      }
      const g = new Float64Array(C);
      for (let p = 0; p < A; p++) for (let c = 0; c < C; c++) g[c] += h[p * C + c];
      for (let c = 0; c < C; c++) g[c] /= A;
      const logits = new Float64Array(A + 1);
      const own = new Float64Array(A);
      for (let p = 0; p < A; p++) {
        let s = W["pol.bias"][0], o = W["own.bias"][0];
        for (let c = 0; c < C; c++) {
          const v = h[p * C + c];
          s += pw[c] * v;
          o += ow[c] * v;
        }
        logits[p] = s;
        own[p] = Math.tanh(o);
      }
      let ps = W["passfc.bias"][0];
      for (let c = 0; c < C; c++) ps += W["passfc.weight"][c] * g[c];
      logits[A] = ps;
      const mlp = (w1, b1, w2, b2) => {
        let out = b2[0];
        const H = b1.length;
        for (let j = 0; j < H; j++) {
          let s = b1[j];
          for (let c = 0; c < C; c++) s += w1[j * C + c] * g[c];
          if (s > 0) out += w2[j] * s;
        }
        return out;
      };
      const vl = mlp(W["v1.weight"], W["v1.bias"], W["v2.weight"], W["v2.bias"]);
      const vo = hasVo ? mlp(W["vo1.weight"], W["vo1.bias"], W["vo2.weight"], W["vo2.bias"]) : null;
      const ar = hasVo ? mlp(W["ar1.weight"], W["ar1.bias"], W["ar2.weight"], W["ar2.bias"]) : null;
      const tl = hasVo ? mlp(W["tl1.weight"], W["tl1.bias"], W["tl2.weight"], W["tl2.bias"]) : null;
      let m = -Infinity;
      for (let i = 0; i < A; i++) if (board[(i / N) | 0][i % N] === "." && logits[i] > m) m = logits[i];
      if (logits[A] > m) m = logits[A];
      let z = 0;
      const policy = new Float64Array(A);
      for (let i = 0; i < A; i++) if (board[(i / N) | 0][i % N] === ".") z += policy[i] = Math.exp(logits[i] - m);
      const pass = Math.exp(logits[A] - m);
      z += pass;
      for (let i = 0; i < A; i++) policy[i] /= z;
      let areaB = 0;
      for (let i = 0; i < A; i++) if (board[(i / N) | 0][i % N] !== "#") areaB += (1 + own[i]) / 2;
      // winB: the outcome head when the net has one (trained on real games against the game's AIs), else KataGo's.
      const winTeacher = 1 / (1 + Math.exp(-vl));
      // The outcome heads: black's final area (points) and our turns left, under our policy vs the game's AI.
      let playable = 0;
      for (let i = 0; i < A; i++) if (board[(i / N) | 0][i % N] !== "#") playable++;
      const out = hasVo ? { areaOut: playable / (1 + Math.exp(-ar)), turnsLeft: Math.max(0, tl) * A } : {};
      return { policy, pass: pass / z, winB: vo === null ? winTeacher : 1 / (1 + Math.exp(-vo)), winTeacher, areaB, logits, vl, vo, ...out };
    },
  };
}
