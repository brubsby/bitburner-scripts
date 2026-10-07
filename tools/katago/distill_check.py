#!/usr/bin/env python3
"""Check tools/katago/smallnet.mjs against PyTorch on held-out positions:
writes the net's own logits for the first K positions of --data to --ref (JSON
lines), which tools/katago/smallnet-check.mjs compares to the JS output.

  venv/bin/python distill_check.py --net sn5.json --data d5.jsonl --ref ref5.jsonl
"""
import argparse, json
import numpy as np, torch
import torch.nn.functional as F

ap = argparse.ArgumentParser()
ap.add_argument("--net", required=True); ap.add_argument("--data", required=True); ap.add_argument("--ref", required=True); ap.add_argument("--k", type=int, default=50)
a = ap.parse_args()
J = json.load(open(a.net)); N, C, B = J["size"], J["ch"], J["blocks"]
T = {k: torch.tensor(np.array(v, np.float32).reshape(J["shapes"][k])) for k, v in J["w"].items()}
def net(x):
    h = F.relu(F.conv2d(x, T["inp.weight"], T["inp.bias"], padding=1))
    for k in range(B):
        t = F.relu(F.conv2d(h, T[f"blocks.{k}.a.weight"], T[f"blocks.{k}.a.bias"], padding=1))
        h = F.relu(h + F.conv2d(t, T[f"blocks.{k}.b.weight"], T[f"blocks.{k}.b.bias"], padding=1))
    g = h.mean(dim=(2, 3))
    pol = torch.cat([F.conv2d(h, T["pol.weight"], T["pol.bias"]).flatten(1), g @ T["passfc.weight"].T + T["passfc.bias"]], 1)
    v = (F.relu(g @ T["v1.weight"].T + T["v1.bias"]) @ T["v2.weight"].T + T["v2.bias"]).squeeze(1)
    return pol, v
out = open(a.ref, "w")
for i, line in enumerate(open(a.data)):
    if i >= a.k: break
    r = json.loads(line)
    if r["N"] != N: continue
    x = np.zeros((6, N * N), np.float32)
    for j, c in enumerate(r["b"]): x["XO.#".index(c), j] = 1
    x[4] = 1; x[5] = r["komi"] / 10
    pol, v = net(torch.tensor(x.reshape(1, 6, N, N)))
    out.write(json.dumps({"b": r["b"], "komi": r["komi"], "logits": pol[0].tolist(), "v": float(v[0])}) + "\n")
print("ok")
