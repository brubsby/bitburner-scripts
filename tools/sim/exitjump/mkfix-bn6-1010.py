#!/usr/bin/env python3
# Builds tools/test/fixture-bn6-exitjump-1010.json from the records captured
# around the live BN6 install of 2026-10-02 10:10:17Z (/tmp/bjx: the live
# /tel files at 10:36Z, the recorder's plan.txt snapshots 10:05-10:33Z, the
# history.jsonl rows 10:00-10:36Z, the save at 10:40Z decoded to a digest).
# Kept beside attribute-bn6-1010.mjs so the fixture can be rebuilt.
import json, os, sys

D = sys.argv[1] if len(sys.argv) > 1 else "/tmp/bjx"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "test", "fixture-bn6-exitjump-1010.json")


def ld(name):
    return json.load(open(os.path.join(D, name)))


def snap(prefix):
    H = os.path.join(D, "hist")
    f = next(x for x in sorted(os.listdir(H)) if x.startswith(prefix))
    return json.load(open(os.path.join(H, f)))


def slim_route(br):
    br = dict(br or {})
    br.pop("samples", None)
    cal = br.get("calibration") or {}
    rk = dict(cal.get("rank") or {})
    rk.pop("pending", None)
    br["calibration"] = {**cal, "rank": rk}
    return br


def slim_install(i):
    i = dict(i or {})
    i.pop("samples", None)
    return i


PASSES = ["100529", "101038", "101339", "101842", "102344", "102846", "103348"]
passes = []
for p in PASSES:
    d = snap("plan.txt." + p)
    passes.append({"at": d["at"], "lastAugReset": d["lastAugReset"], "exit": d.get("exit"), "install": slim_install(d["decisions"].get("install")), "bladeRoute": slim_route(d["decisions"].get("bladeRoute"))})

hist = []
for line in open(os.path.join(D, "history.jsonl")):
    try:
        r = json.loads(line)
    except Exception:
        continue
    if "2026-10-02T09:55" <= r.get("at", "") <= "2026-10-02T10:40":
        cw = r.get("currentWork")
        hist.append({"at": r["at"], "skills": r["skills"], "exp": r["exp"], "work": (cw or {}).get("type") if isinstance(cw, dict) else None, "playtimeSinceLastAug": r.get("playtimeSinceLastAug")})

il = ld("install-last.txt")
il.pop("carry", None)
aug = ld("snap-augstats.txt")["data"]["stats"]
dig = ld("save-digest.json")
slv = ld("sleeve.txt")
fx = {
    "note": "Live BN6 2026-10-02, the 10:10:17Z install (20 augs, Bladeburner route) and the new life's passes to 10:33Z (tools/sim/exitjump/attribute-bn6-1010.mjs, tools/test/bladejump.test.mjs). passes: plan.txt decisions.install/bladeRoute of each pass (the recorder's snapshots); history: the save digest's skills/exp every ~5 min; bladeburner: /tel/bladeburner.txt 10:35Z (rank, levels, counts, cities, stamina samples since the install); save: the save at 10:40Z (the player's multipliers, every city's TRUE population, the actions' successes); sleeve: /tel/sleeve.txt 10:33Z; installLast: /tel/install-last.txt (carry dropped); exitjump: /tel/exitjump.txt.",
    "installLast": il,
    "exitjump": ld("exitjump.txt"),
    "passes": passes,
    "history": hist,
    "bladeburner": ld("bladeburner.txt"),
    "save": {"at": dig["at"], "player": dig["player"], "cities": dig["cities"], "actions": dig["actions"], "rank": dig["rank"], "bo": dig["bo"], "sleeves": dig["sleeves"]},
    "sleeve": {"at": slv["at"], "blade": slv["blade"], "assigned": slv["assigned"]},
    "augstats": {n: aug[n] for n in il["batch"] if n in aug},
}
missing = [n for n in il["batch"] if n not in aug]
if missing:
    sys.exit(f"augstats missing for {missing}")
json.dump(fx, open(OUT, "w"), separators=(",", ":"))
print(OUT, os.path.getsize(OUT), "bytes;", len(passes), "passes,", len(hist), "history rows")
