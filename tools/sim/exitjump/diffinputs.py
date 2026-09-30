#!/usr/bin/env python3
# Diff two /tel/exitinputs.txt records field by field (descriptive text fields last).
#   python3 tools/sim/exitjump/diffinputs.py a.json b.json
import json, sys

a = json.load(open(sys.argv[1]))
b = json.load(open(sys.argv[2]))
print(a["at"], "->", b["at"])
A, B = a["inputs"], b["inputs"]
text = {"capitalFit", "streams", "expSource", "incomeSource", "repSource", "cadence", "freshHacknet", "contractRep", "hacknet", "freshHackCum", "favorStreamWhy", "favorStreamAt"}
for k in sorted(set(A) | set(B)):
    if k in text:
        continue
    sa, sb = json.dumps(A.get(k)), json.dumps(B.get(k))
    if sa != sb:
        print(k, "|", sa[:200], "|", sb[:200])
for k in ["repSource", "expSource", "incomeSource", "streams"]:
    print(k)
    print("   ", json.dumps(A.get(k))[:400])
    print("   ", json.dumps(B.get(k))[:400])
