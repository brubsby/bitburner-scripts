#!/usr/bin/env python3
# Builds tools/test/fixture-bn4-bladecal-life5.json from the recorder's captures
# of live BN4.3 (2026-10-03, /tmp/bbk4/cap: every 5 min the save's player,
# Bladeburner and sleeves, and /tel/bladeburner.txt, /tel/plan.txt) plus the
# exit samples the plan published this node (/tel/installgate.txt
# exitCalibration.samples). Kept beside bbcal4.mjs so the fixture can be rebuilt.
import json, os, sys, glob

D = sys.argv[1] if len(sys.argv) > 1 else "/tmp/bbk4/cap"
TEL = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser("~/Repos/bitburner-scripts/.telemetry")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "test", "fixture-bn4-bladecal-life5.json")
KEEP_TEL = ["at", "bitNode", "lastAugReset", "daemon", "result", "joined", "rank", "skillPoints", "levels", "stamina", "maxStamina", "staminaBonus", "city", "team", "action", "blackOps", "counts", "maxLevels", "cities", "skillsAt", "slot"]
caps = []
for f in sorted(glob.glob(os.path.join(D, "save.*.json"))):
    stamp = f.split("save.")[1][:-5]
    try:
        sv = json.load(open(f))
        tel = json.load(open(os.path.join(D, "bladeburner.txt." + stamp)))
        plan = json.load(open(os.path.join(D, "plan.txt." + stamp)))
    except Exception as e:
        print("skip", stamp, e)
        continue
    bb = sv["bb"]
    acts = {}
    for fam in ("contracts", "operations"):
        for k, v in bb[fam].items():
            x = v.get("data", v)
            acts[k] = {"s": x["successes"], "f": x["failures"], "count": round(x["count"], 2), "level": x["level"], "maxLevel": x["maxLevel"]}
    br = plan["decisions"]["bladeRoute"]
    cal = br.get("calibration") or {}
    caps.append({
        "stamp": stamp,
        "at": sv["at"],
        "player": {k: sv["player"][k] for k in ("skills", "exp", "mults", "city")},
        "sleeves": [s.get("workCtor") for s in sv["sleeves"]],
        "bb": {"rank": bb["rank"], "maxRank": bb["maxRank"], "skillPoints": bb["skillPoints"], "stamina": bb["stamina"], "maxStamina": bb["maxStamina"], "blackOps": bb["numBlackOpsComplete"], "action": bb.get("action"), "actions": acts, "cities": {c: {"pop": v["data"]["pop"], "popEst": v["data"]["popEst"], "comms": v["data"]["comms"], "chaos": v["data"]["chaos"]} for c, v in bb["cities"].items()}},
        "tel": {k: tel.get(k) for k in KEEP_TEL},
        "plan": {"at": plan["at"], "bladeH": br.get("bladeH"), "meanH": br.get("meanH"), "sleeves": br.get("sleeves"), "fleet": br.get("fleet"), "state": br.get("state"), "installBasis": br.get("installBasis"), "start": br.get("start"),
                 "calibration": {"success": {k: (cal.get("success") or {}).get(k) for k in ("k", "applied", "n", "s")}, "rank": {k: (cal.get("rank") or {}).get(k) for k in ("k", "applied", "n", "hours", "samples", "skipped")}}},
    })
ig = json.load(open(os.path.join(TEL, "installgate.txt")))
fx = {
    "note": "Live BN4.3 2026-10-03, life 5 (install 03:08:17Z): the recorder's 5-minute captures from 09:59Z (the save's player/Bladeburner/sleeves, /tel/bladeburner.txt, the plan's published blade route) and the node's published exit samples. tools/sim/bbcal4.mjs replays them; tools/test/bladecal4.test.mjs holds it. Built by tools/sim/bbcal4/mkfix.py.",
    "installAt": "2026-10-03T03:08:17.490Z",
    "joinedAt": "2026-10-02T19:57:00Z",
    "exitSamples": ig["exitCalibration"]["samples"],
    "captures": caps,
}
json.dump(fx, open(OUT, "w"), separators=(",", ":"))
print(OUT, os.path.getsize(OUT), "bytes;", len(caps), "captures")
