#!/usr/bin/env python3
"""THE SMALL NET: distil the walls-KataGo b18 net into a net small enough to
run inside the Go solver's own process (tools/katago/smallnet.mjs), so the
opponent-model search gets KataGo's move prior with no GPU round trip.

  venv/bin/python distill_train.py --data d5.jsonl --size 5 --blocks 4 --ch 32 --epochs 12 --out sn5.json

Data: tools/sim/go-distill-gen.mjs (positions on the game's own boards, holes
included, labelled by the teacher's raw policy / win / ownership). The name
carries "train" on purpose: tools/thermal-watch.sh SIGSTOPs it when the GPU
is hot (a pause is harmless — no wall-clock logic here). A checkpoint is
written after every epoch (--out + .pt) and resumed with --resume.

Inputs (planes over the N x N board, column-major idx x*N+y like the game's
simple board): black, white, empty, hole, ones, komi/10.
Outputs: policy logits per point + pass, black's win logit, ownership (tanh).
Loss: soft cross-entropy to the teacher's policy + BCE to its win probability
+ 0.25 * mean squared ownership error. Prints top-1 agreement and KL on the
held-out 5% every epoch.
"""
import argparse, json, math, os, random, sys, time
import numpy as np
import torch, torch.nn as nn, torch.nn.functional as F

ap = argparse.ArgumentParser()
ap.add_argument("--data", nargs="+", required=True)
ap.add_argument("--size", type=int, required=True)
ap.add_argument("--blocks", type=int, default=4)
ap.add_argument("--ch", type=int, default=32)
ap.add_argument("--epochs", type=int, default=12)
ap.add_argument("--batch", type=int, default=512)
ap.add_argument("--lr", type=float, default=2e-3)
ap.add_argument("--out", required=True)
ap.add_argument("--resume", action="store_true")
args = ap.parse_args()
N = args.size
dev = "cuda" if torch.cuda.is_available() else "cpu"
torch.set_num_threads(4)

def load(paths):
    X, P, W, O = [], [], [], []
    for path in paths:
        with open(path) as f:
            for line in f:
                r = json.loads(line)
                if r["N"] != N: continue
                b = r["b"]
                x = np.zeros((6, N * N), np.float32)
                for i, c in enumerate(b):
                    x["XO.#".index(c), i] = 1
                x[4] = 1
                x[5] = r["komi"] / 10
                X.append(x.reshape(6, N, N)); P.append(r["p"]); W.append(r["w"]); O.append(r["o"])
    return (torch.tensor(np.array(X)), torch.tensor(np.array(P, np.float32)), torch.tensor(np.array(W, np.float32)), torch.tensor(np.array(O, np.float32)))

class Block(nn.Module):
    def __init__(s, c):
        super().__init__(); s.a = nn.Conv2d(c, c, 3, padding=1); s.b = nn.Conv2d(c, c, 3, padding=1)
    def forward(s, x):
        return F.relu(x + s.b(F.relu(s.a(x))))

class Net(nn.Module):
    def __init__(s, blocks, c):
        super().__init__()
        s.inp = nn.Conv2d(6, c, 3, padding=1)
        s.blocks = nn.ModuleList([Block(c) for _ in range(blocks)])
        s.pol = nn.Conv2d(c, 1, 1)
        s.own = nn.Conv2d(c, 1, 1)
        s.passfc = nn.Linear(c, 1)
        s.v1 = nn.Linear(c, 32); s.v2 = nn.Linear(32, 1)
    def forward(s, x):
        h = F.relu(s.inp(x))
        for bl in s.blocks: h = bl(h)
        g = h.mean(dim=(2, 3))
        pol = torch.cat([s.pol(h).flatten(1), s.passfc(g)], 1)
        v = s.v2(F.relu(s.v1(g))).squeeze(1)
        own = torch.tanh(s.own(h).flatten(1))
        return pol, v, own

t0 = time.time()
X, P, W, O = load(args.data)
n = len(X)
perm = torch.randperm(n, generator=torch.Generator().manual_seed(1))
nv = max(1000, n // 20)
vi, ti = perm[:nv], perm[nv:]
print(f"{n} positions ({len(ti)} train, {nv} held out), loaded in {time.time()-t0:.0f}s, device {dev}", flush=True)
net = Net(args.blocks, args.ch).to(dev)
opt = torch.optim.AdamW(net.parameters(), lr=args.lr, weight_decay=1e-4)
start = 0
ck = args.out + ".pt"
if args.resume and os.path.exists(ck):
    st = torch.load(ck); net.load_state_dict(st["net"]); opt.load_state_dict(st["opt"]); start = st["epoch"] + 1
steps = args.epochs * math.ceil(len(ti) / args.batch)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=steps, last_epoch=start * math.ceil(len(ti) / args.batch) - 1)

def losses(idx):
    x, p, w, o = X[idx].to(dev), P[idx].to(dev), W[idx].to(dev), O[idx].to(dev)
    pl, vl, ol = net(x)
    lp = F.log_softmax(pl, 1)
    lpol = -(p * lp).sum(1).mean()
    lv = F.binary_cross_entropy_with_logits(vl, w)
    lo = ((ol - o) ** 2).mean()
    return lpol, lv, lo, lp, p

def evaluate():
    net.eval()
    with torch.no_grad():
        tot = {"pol": 0, "kl": 0, "v": 0, "o": 0, "top1": 0}
        for i in range(0, nv, 4096):
            idx = vi[i:i + 4096]
            lpol, lv, lo, lp, p = losses(idx)
            ent = -(p * torch.log(p.clamp_min(1e-9))).sum(1).mean()
            k = len(idx)
            tot["pol"] += lpol.item() * k; tot["kl"] += (lpol - ent).item() * k; tot["v"] += lv.item() * k; tot["o"] += lo.item() * k
            tot["top1"] += (lp.argmax(1) == p.argmax(1)).float().sum().item()
    net.train()
    return {k: v / nv for k, v in tot.items()}

for ep in range(start, args.epochs):
    order = ti[torch.randperm(len(ti))]
    t1 = time.time()
    for i in range(0, len(order), args.batch):
        lpol, lv, lo, _, _ = losses(order[i:i + args.batch])
        loss = lpol + lv + 0.25 * lo
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
    m = evaluate()
    print(f"epoch {ep}: held-out policy CE {m['pol']:.4f} KL {m['kl']:.4f} top1 {m['top1']:.3f} | win BCE {m['v']:.4f} | own MSE {m['o']:.4f} ({time.time()-t1:.0f}s)", flush=True)
    torch.save({"net": net.state_dict(), "opt": opt.state_dict(), "epoch": ep}, ck)

# The weights for smallnet.mjs: conv weights [out][in][3][3] flattened, biases.
sd = {k: v.detach().cpu().numpy() for k, v in net.state_dict().items()}
J = {"size": N, "blocks": args.blocks, "ch": args.ch, "inputs": ["black", "white", "empty", "hole", "ones", "komi/10"], "heldOut": evaluate(),
     "w": {k: [round(float(x), 6) for x in v.flatten()] for k, v in sd.items()}, "shapes": {k: list(v.shape) for k, v in sd.items()}}
with open(args.out, "w") as f: json.dump(J, f)
print(f"wrote {args.out}", flush=True)
