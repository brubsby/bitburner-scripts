#!/usr/bin/env python3
"""THE SMALL NET: distil the walls-KataGo b18 net into a net small enough to
run inside the Go solver's own process (tools/katago/smallnet.mjs), and train
OUTCOME heads on real games against the game's AIs under our own policy.

  venv/bin/python distill_train.py --data d5.jsonl --size 5 --blocks 4 --ch 32 --epochs 12 --out sn5.json
  venv/bin/python distill_train.py --data o5.jsonl --size 5 --init sn5.json.pt --outcome 1 --out sn5o.json

Data: tools/sim/go-distill-gen.mjs — teacher positions (policy p, win w,
ownership o), and with --from-traces the same plus the game's real outcome
under our policy (won, area = black's final area / playable points, tl = our
turns left). The name carries "train" on purpose: tools/thermal-watch.sh
SIGSTOPs it when the GPU is hot (a pause is harmless — no wall-clock logic
here). A checkpoint is written after every epoch (--out + .pt) and resumed
with --resume.

Inputs (planes over the N x N board, column-major idx x*N+y like the game's
simple board): black, white, empty, hole, ones, komi/10.
Outputs: policy logits per point + pass, the teacher's win logit, ownership
(tanh), and (--outcome) vo: won logit, ar: final-area logit, tl: turns left / N^2.
Loss: --teacher x (soft CE to the teacher's policy + BCE to its win + 0.25 x
ownership MSE) + --outcome x (BCE won + BCE area + 10 x MSE turns). Prints the
held-out top-1 agreement, KL, area MAE and turns MAE every epoch.
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
ap.add_argument("--init", default=None, help="start from this checkpoint (.pt) — fine-tune")
ap.add_argument("--outcome", type=float, default=0.0, help="weight of the outcome heads")
ap.add_argument("--teacher", type=float, default=1.0, help="weight of the teacher losses")
ap.add_argument("--cheat-inputs", action="store_true", help="4 more input planes: the cheat outlook (present, cheats so far / 12, the next cheat's chance, the roll's phase) — zero where a row has none")
args = ap.parse_args()
N = args.size
CIN = 10 if args.cheat_inputs else 6
dev = "cuda" if torch.cuda.is_available() else "cpu"
torch.set_num_threads(4)

def load(paths):
    X, P, W, O, Y = [], [], [], [], []
    for path in paths:
        with open(path) as f:
            for line in f:
                r = json.loads(line)
                if r["N"] != N: continue
                b = r["b"]
                x = np.zeros((CIN, N * N), np.float32)
                for i, c in enumerate(b):
                    x["XO.#".index(c), i] = 1
                x[4] = 1
                x[5] = r["komi"] / 10
                cs = r.get("cs")
                if CIN > 6 and cs and cs.get("on", 1):
                    x[6] = 1; x[7] = cs["ch"] / 12; x[8] = cs["pc"]; x[9] = cs["cr"]
                X.append(x.reshape(CIN, N, N)); P.append(r["p"]); W.append(r["w"]); O.append(r["o"])
                Y.append([r.get("won", -1), r.get("area", -1), r["tl"] / (N * N) if "tl" in r else -1])
    return (torch.tensor(np.array(X)), torch.tensor(np.array(P, np.float32)), torch.tensor(np.array(W, np.float32)),
            torch.tensor(np.array(O, np.float32)), torch.tensor(np.array(Y, np.float32)))

class Block(nn.Module):
    def __init__(s, c):
        super().__init__(); s.a = nn.Conv2d(c, c, 3, padding=1); s.b = nn.Conv2d(c, c, 3, padding=1)
    def forward(s, x):
        return F.relu(x + s.b(F.relu(s.a(x))))

class Net(nn.Module):
    def __init__(s, blocks, c):
        super().__init__()
        s.inp = nn.Conv2d(CIN, c, 3, padding=1)
        s.blocks = nn.ModuleList([Block(c) for _ in range(blocks)])
        s.pol = nn.Conv2d(c, 1, 1)
        s.own = nn.Conv2d(c, 1, 1)
        s.passfc = nn.Linear(c, 1)
        s.v1 = nn.Linear(c, 32); s.v2 = nn.Linear(32, 1)
        s.vo1 = nn.Linear(c, 32); s.vo2 = nn.Linear(32, 1)
        s.ar1 = nn.Linear(c, 32); s.ar2 = nn.Linear(32, 1)
        s.tl1 = nn.Linear(c, 32); s.tl2 = nn.Linear(32, 1)
    def forward(s, x):
        h = F.relu(s.inp(x))
        for bl in s.blocks: h = bl(h)
        g = h.mean(dim=(2, 3))
        pol = torch.cat([s.pol(h).flatten(1), s.passfc(g)], 1)
        v = s.v2(F.relu(s.v1(g))).squeeze(1)
        own = torch.tanh(s.own(h).flatten(1))
        out = (s.vo2(F.relu(s.vo1(g))).squeeze(1), s.ar2(F.relu(s.ar1(g))).squeeze(1), s.tl2(F.relu(s.tl1(g))).squeeze(1))
        return pol, v, own, out

t0 = time.time()
X, P, W, O, Y = load(args.data)
n = len(X)
perm = torch.randperm(n, generator=torch.Generator().manual_seed(1))
nv = max(1000, n // 20)
vi, ti = perm[:nv], perm[nv:]
print(f"{n} positions ({len(ti)} train, {nv} held out; {(Y[:, 0] >= 0).sum().item()} with outcomes), loaded in {time.time()-t0:.0f}s, device {dev}", flush=True)
net = Net(args.blocks, args.ch).to(dev)
opt = torch.optim.AdamW(net.parameters(), lr=args.lr, weight_decay=1e-4)
start = 0
ck = args.out + ".pt"
if args.init:
    st0 = torch.load(args.init)["net"]
    w0 = st0["inp.weight"]
    if w0.shape[1] < CIN:  # a 6-plane net grown to the cheat planes: the new planes start at 0
        st0["inp.weight"] = torch.cat([w0, torch.zeros(w0.shape[0], CIN - w0.shape[1], 3, 3, device=w0.device, dtype=w0.dtype)], 1)
    net.load_state_dict(st0, strict=False)
    print(f"initialised from {args.init}", flush=True)
if args.resume and os.path.exists(ck):
    st = torch.load(ck); net.load_state_dict(st["net"]); opt.load_state_dict(st["opt"]); start = st["epoch"] + 1
steps = args.epochs * math.ceil(len(ti) / args.batch)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=steps)
for _ in range(start * math.ceil(len(ti) / args.batch)): sched.step()

def losses(idx):
    x, p, w, o, y = X[idx].to(dev), P[idx].to(dev), W[idx].to(dev), O[idx].to(dev), Y[idx].to(dev)
    pl, vl, ol, (vo, ar, tl) = net(x)
    lp = F.log_softmax(pl, 1)
    lpol = -(p * lp).sum(1).mean()
    lv = F.binary_cross_entropy_with_logits(vl, w)
    lo = ((ol - o) ** 2).mean()
    m = (y[:, 0] >= 0).float()
    k = m.sum().clamp_min(1)
    per = F.binary_cross_entropy_with_logits(vo, y[:, 0].clamp(0, 1), reduction="none") + F.binary_cross_entropy_with_logits(ar, y[:, 1].clamp(0, 1), reduction="none") + 10 * (F.relu(tl) - y[:, 2].clamp_min(0)) ** 2
    lout = (per * m).sum() / k
    return lpol, lv, lo, lp, p, lout, (vo, ar, tl, y, m)

def evaluate():
    net.eval()
    with torch.no_grad():
        tot = {"pol": 0, "kl": 0, "v": 0, "o": 0, "top1": 0, "out": 0}
        aMAE = tMAE = no = 0.0
        for i in range(0, nv, 4096):
            idx = vi[i:i + 4096]
            lpol, lv, lo, lp, p, lout, (vo, ar, tl, y, m) = losses(idx)
            ent = -(p * torch.log(p.clamp_min(1e-9))).sum(1).mean()
            k = len(idx)
            tot["pol"] += lpol.item() * k; tot["kl"] += (lpol - ent).item() * k; tot["v"] += lv.item() * k; tot["o"] += lo.item() * k; tot["out"] += lout.item() * k
            tot["top1"] += (lp.argmax(1) == p.argmax(1)).float().sum().item()
            aMAE += ((torch.sigmoid(ar) - y[:, 1]).abs() * m).sum().item(); tMAE += ((F.relu(tl) - y[:, 2]).abs() * m).sum().item() * N * N; no += m.sum().item()
    net.train()
    r = {k: v / nv for k, v in tot.items()}
    r["areaMAE"] = aMAE / max(1, no); r["turnsMAE"] = tMAE / max(1, no)
    return r

for ep in range(start, args.epochs):
    order = ti[torch.randperm(len(ti))]
    t1 = time.time()
    for i in range(0, len(order), args.batch):
        lpol, lv, lo, _, _, lout, _ = losses(order[i:i + args.batch])
        loss = args.teacher * (lpol + lv + 0.25 * lo) + args.outcome * lout
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
    m = evaluate()
    print(f"epoch {ep}: held-out policy CE {m['pol']:.4f} KL {m['kl']:.4f} top1 {m['top1']:.3f} | win BCE {m['v']:.4f} | own MSE {m['o']:.4f} | outcome {m['out']:.4f} area MAE {m['areaMAE']:.4f} turns MAE {m['turnsMAE']:.2f} ({time.time()-t1:.0f}s)", flush=True)
    torch.save({"net": net.state_dict(), "opt": opt.state_dict(), "epoch": ep}, ck)

# The weights for smallnet.mjs (outcome heads only when trained).
sd = {k: v.detach().cpu().numpy() for k, v in net.state_dict().items()}
if args.outcome <= 0:
    sd = {k: v for k, v in sd.items() if not k.startswith(("vo", "ar", "tl"))}
J = {"size": N, "blocks": args.blocks, "ch": args.ch, "inputs": ["black", "white", "empty", "hole", "ones", "komi/10"] + (["cheatPresent", "cheats/12", "cheatChance", "cheatPhase"] if CIN > 6 else []), "heldOut": evaluate(),
     "w": {k: [round(float(x), 6) for x in v.flatten()] for k, v in sd.items()}, "shapes": {k: list(v.shape) for k, v in sd.items()}}
with open(args.out, "w") as f: json.dump(J, f)
print(f"wrote {args.out}", flush=True)
