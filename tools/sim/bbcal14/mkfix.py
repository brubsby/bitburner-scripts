#!/usr/bin/env python3
# Builds tools/test/fixture-bn14-bladecal-passes.json from the recorder's
# captures of live BN14.1 (2026-10-04, /tmp/bbk14/cap: every minute
# /tel/bladeburner.txt, plan.txt, sleeve.txt, exitinputs.txt, installgate.txt;
# every 5 min the save's player and Bladeburner) — one entry per plan pass,
# with the inputs progress.js bladeRouteOf builds the exit from — plus this
# life's rank windows and published exit samples (installgate
# exitCalibration.samples). Kept beside tools/sim/bbcal14.mjs so the fixture
# can be rebuilt.
import json, os, sys, glob

D = sys.argv[1] if len(sys.argv) > 1 else "/tmp/bbk14/cap"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "test", "fixture-bn14-bladecal-passes.json")
KEEP_TEL = ["at", "bitNode", "lastAugReset", "daemon", "result", "joined", "joinedAt", "rank", "skillPoints", "levels", "stamina", "maxStamina", "staminaBonus", "city", "team", "blackOps", "counts", "maxLevels", "cities", "citiesAt", "successes", "skillsAt"]


def load(f):
    try:
        return json.load(open(f))
    except Exception:
        return None


stamps = sorted(f.split("plan.txt.")[1] for f in glob.glob(os.path.join(D, "plan.txt.*")))
saves = sorted(f.split("save.")[1][:-5] for f in glob.glob(os.path.join(D, "save.*.json")))
passes, seen = [], None
for st in stamps:
    plan = load(os.path.join(D, "plan.txt." + st))
    if not plan or plan.get("at") == seen:
        continue
    seen = plan["at"]
    tel = load(os.path.join(D, "bladeburner.txt." + st))
    ei = load(os.path.join(D, "exitinputs.txt." + st)) or {}
    sv = [s for s in saves if s <= st] or saves[:1]
    if not tel or not sv:
        continue
    save = load(os.path.join(D, "save." + sv[-1] + ".json"))
    br = plan["decisions"]["bladeRoute"]
    cal = br.get("calibration") or {}
    P = save["player"]
    passes.append({
        "at": plan["at"],
        "tel": {k: tel.get(k) for k in KEEP_TEL if k in tel},
        "person": {"skills": P["skills"], "exp": P["exp"], "mults": P["mults"], "city": P["city"], "money": P["money"], "saveAt": save["at"]},
        "wealth": (ei.get("inputs") or {}).get("money"),
        "flatPerSec": (ei.get("inputs") or {}).get("flatIncomePerSec", 0),
        "bladeRoute": {"bladeH": br.get("bladeH"), "samples": br.get("samples"), "sleeves": br.get("sleeves"), "start": br.get("start"), "installBasis": br.get("installBasis"),
                       "calibration": {"success": {k: (cal.get("success") or {}).get(k) for k in ("k", "lnK", "sdLn", "n", "applied")},
                                       "rank": {k: (cal.get("rank") or {}).get(k) for k in ("k", "lnK", "sdLn", "n", "applied")}}},
        "exit": plan.get("exit"),
        "events": plan.get("events"),
    })
plan = load(sorted(glob.glob(os.path.join(D, "plan.txt.*")))[-1])
ig = load(sorted(glob.glob(os.path.join(D, "installgate.txt.*")))[-1])
life = plan["lastAugReset"]
fx = {
    "note": "Live BN14.1 2026-10-04 (the life since 01:32Z, the Bladeburner route): one entry per plan pass from the recorder (tools/sim/bbcal14.mjs replays them), the rank windows of the life, and its published exit samples. Built by tools/sim/bbcal14/mkfix.py.",
    "lastAugReset": life,
    "passes": passes,
    "rankWindows": plan["decisions"]["bladeRoute"]["calibration"]["rank"].get("samples", []),
    "exitSamples": [s for s in ig["exitCalibration"]["samples"] if s.get("life") == life],
    "calibration": {k: plan["calibration"].get(k) for k in ("n", "why", "verdict")},
}
json.dump(fx, open(OUT, "w"), separators=(",", ":"))
print(OUT, os.path.getsize(OUT), "bytes;", len(passes), "passes")
