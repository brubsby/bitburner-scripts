// THE SMALL NET, in process: the distilled walls-KataGo net
// (tools/katago/distill_train.py) evaluated in plain JS — the opponent-model
// search's move prior with no GPU and no round trip (golib.modelSession
// opts.nn: eval(board, komi) -> { policy, pass, winB, areaB }).
//
//   const sn = loadSmallNet("sn5.json"); const e = sn.eval(boardStrings, komi)
//
// Same arithmetic as the PyTorch module: 3x3 convs with zero padding, ReLU,
// residual blocks, a 1x1 policy head + a pass logit from the global mean, a
// win logit from the global mean, tanh ownership. Checked against PyTorch's
// own output by tools/katago/distill_check.py (printed max error).

import fs from "node:fs";

export function loadSmallNet(file) {
  const J = typeof file === "string" ? JSON.parse(fs.readFileSync(file, "utf8")) : file;
  return makeSmallNet(J);
}

export function makeSmallNet(J) {
  const N = J.size, C = J.ch, B = J.blocks, A = N * N;
  const W = {};
  for (const [k, v] of Object.entries(J.w)) W[k] = Float32Array.from(v);
  // conv(in: [cin][A], weight [cout][cin][k][k], bias) -> [cout][A]
  // Per tap (dx, dy): the output range it touches and the input offset — the
  // inner loops are branch-free runs over contiguous y.
  const taps = [];
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) taps.push({ k: (dx + 1) * 3 + (dy + 1), x0: Math.max(0, -dx), x1: Math.min(N, N - dx), y0: Math.max(0, -dy), y1: Math.min(N, N - dy), off: dx * N + dy });
  const conv3 = (inp, cin, w, b, cout, out) => {
    for (let o = 0; o < cout; o++) {
      const ob = o * A;
      const bo = b[o];
      for (let i = 0; i < A; i++) out[ob + i] = bo;
      for (let c = 0; c < cin; c++) {
        const ib = c * A, wb = (o * cin + c) * 9;
        for (let t = 0; t < 9; t++) {
          const T = taps[t];
          const wt = w[wb + T.k];
          if (wt === 0) continue;
          for (let x = T.x0; x < T.x1; x++) {
            const rowO = ob + x * N, rowI = ib + x * N + T.off;
            for (let y = T.y0; y < T.y1; y++) out[rowO + y] += wt * inp[rowI + y];
          }
        }
      }
    }
  };
  const relu = (a) => {
    for (let i = 0; i < a.length; i++) if (a[i] < 0) a[i] = 0;
  };
  const h = new Float32Array(C * A), t = new Float32Array(C * A), t2 = new Float32Array(C * A), inp = new Float32Array(6 * A);
  return {
    size: N,
    heldOut: J.heldOut ?? null,
    eval(board, komi) {
      inp.fill(0);
      for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++) {
          const i = x * N + y, c = board[x][y];
          inp[("XO.#".indexOf(c)) * A + i] = 1;
          inp[4 * A + i] = 1;
          inp[5 * A + i] = komi / 10;
        }
      // PyTorch's Conv2d indexes [out][in][kh][kw] over (H, W) = our (x, y): the input tensor is x.reshape(6, N, N) of column-major idx x*N+y.
      conv3(inp, 6, W["inp.weight"], W["inp.bias"], C, h);
      relu(h);
      for (let k = 0; k < B; k++) {
        conv3(h, C, W[`blocks.${k}.a.weight`], W[`blocks.${k}.a.bias`], C, t);
        relu(t);
        conv3(t, C, W[`blocks.${k}.b.weight`], W[`blocks.${k}.b.bias`], C, t2);
        for (let i = 0; i < h.length; i++) h[i] = Math.max(0, h[i] + t2[i]);
      }
      const g = new Float32Array(C);
      for (let c = 0; c < C; c++) {
        let s = 0;
        for (let i = 0; i < A; i++) s += h[c * A + i];
        g[c] = s / A;
      }
      const logits = new Float64Array(A + 1);
      const own = new Float64Array(A);
      const pw = W["pol.weight"], ow = W["own.weight"];
      for (let i = 0; i < A; i++) {
        let s = W["pol.bias"][0], o = W["own.bias"][0];
        for (let c = 0; c < C; c++) {
          s += pw[c] * h[c * A + i];
          o += ow[c] * h[c * A + i];
        }
        logits[i] = s;
        own[i] = Math.tanh(o);
      }
      let ps = W["passfc.bias"][0];
      for (let c = 0; c < C; c++) ps += W["passfc.weight"][c] * g[c];
      logits[A] = ps;
      const v1 = new Float64Array(32);
      for (let j = 0; j < 32; j++) {
        let s = W["v1.bias"][j];
        for (let c = 0; c < C; c++) s += W["v1.weight"][j * C + c] * g[c];
        v1[j] = Math.max(0, s);
      }
      let vl = W["v2.bias"][0];
      for (let j = 0; j < 32; j++) vl += W["v2.weight"][j] * v1[j];
      // softmax over the points that are empty (legal-ish) and pass
      let m = -Infinity;
      for (let i = 0; i <= A; i++) if (i === A || board[(i / N) | 0][i % N] === ".") m = Math.max(m, logits[i]);
      let z = 0;
      const policy = new Float64Array(A);
      for (let i = 0; i < A; i++) if (board[(i / N) | 0][i % N] === ".") z += policy[i] = Math.exp(logits[i] - m);
      const pass = Math.exp(logits[A] - m);
      z += pass;
      for (let i = 0; i < A; i++) policy[i] /= z;
      let areaB = 0;
      for (let i = 0; i < A; i++) if (board[(i / N) | 0][i % N] !== "#") areaB += (1 + own[i]) / 2;
      return { policy, pass: pass / z, winB: 1 / (1 + Math.exp(-vl)), areaB, logits };
    },
  };
}
