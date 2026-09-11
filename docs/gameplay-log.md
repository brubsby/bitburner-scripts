# Gameplay log — game-player agent

Append-only. Newest entries at the bottom. Checkpoint as you go, not at the end.

---

## 2026-09-11 ~20:15 UTC — resume after context cutoff

**State on pickup:** hacking 86, money $2.198m, 8/72 rooted, home 8GB/1 core,
`auto.js` running on home (pid 24), `buyserv.js` running on joesguns (pid 23).
`auto.txt` showed target `foodnstuff`, ramUsed 97/108, but `incomePerSec: 0`
in both `status.txt` and `auto.txt` at poll time — transient (security was
elevated on all farms, 14-15 vs min 3-7, so early.js was mostly
weaken/grow-ing, not hacking) rather than the loop being stuck; did not
restart anything.

`docs/roadmap.md` (researcher's) is still mostly `[TODO]` — did not wait on
it, per instructions.

**Live thread: CyberSec invite.** Confirmed from game source
(`~/Repos/bitburner/src/Server/data/servers.ts` line ~1519): hostname is
literally `CSEC` (`SpecialServers.CyberSecServer`), `requiredHackingSkill`
51-60, `numOpenPortsRequired: 1`, networkLayer 2. Player hacking level (86)
was already well above the requirement — the blocker was root access, not
level.

Path from home: `home -> iron-gym -> CSEC` (found by chaining
`connect X; scan; home;` for each of home's 7 neighbors in one terminal
command — chained `;` commands DO work in this terminal, they just render
after a short delay, don't assume a blank-looking screenshot means nothing
happened).

**Actions taken (all via browser, all live in-game state changes):**
1. City -> Sector-12 -> Alpha Enterprises (a `LocationType.TechVendor`
   location — confirmed via `GenericLocation.tsx`/`TechVendorLocation.tsx`
   that TOR router, home RAM, and home cores buttons all live on any
   TechVendor location, not a special "buy TOR" screen).
2. Bought TOR router — $200k.
3. Bought home RAM upgrade 8GB -> 16GB — $1.01m. This unlocks `hack.js`
   (11.2GB) as flagged in the brief. **Not yet swapped in** — auto.js/early.js
   still doing the hacking; hack.js is a separate real batcher owned by
   nobody currently running it.
4. Terminal `buy BruteSSH.exe` — $500k (cheapest port opener, sufficient
   since CSEC only needs 1 port).
5. Terminal note: `brutessh CSEC` / `nuke CSEC` are **not** terminal
   commands in this version — the correct incantation is `run BruteSSH.exe`
   / `run NUKE.exe` while connected to the target. (`ns.brutessh()` /
   `ns.nuke()` are the Netscript function names, singularity/script-side
   only.) By the time I ran these, `auto.js` had *already* rooted CSEC on
   its own the moment BruteSSH.exe appeared on home — confirms auto.js
   picks up new port openers automatically, no manual nuke needed once a
   program exists.
6. `backdoor` in terminal on CSEC — succeeded (~13s). **A CyberSec faction
   invitation popped up immediately after.**

**Decision point — did NOT join.** Clicked "Decide later" rather than
"Join". Reasoning: `docs/roadmap.md` §3 (backdoors/factions) and the
faction-first decision are explicitly the researcher's call and still
`[TODO]`; joining doesn't require haste (invitation persists, shown as a
badge on the Factions nav item) and multiple factions can typically be
joined later without losing this one. **This needs a decision from the lead
or researcher** — join CyberSec now, or hold until the roadmap says which
faction to prioritize first.

**Money after all of the above:** ~$488k (started $2.198m). This is below
`buyserv.js`'s $2m reserve, so it will simply idle on server purchases until
the hacking income rebuilds the balance — not a problem, just noting why
buyserv may look quiet for a while.

**Loose end spotted:** `.telemetry/buyserv.txt` does not exist at all
(status.txt confirms buyserv.js *is* running, pid 23 on joesguns). Need to
check buyserv.js's write path/interval — possibly just hasn't hit its first
write yet, or a path bug. Follow-up needed, did not fix yet.

**Next up this session:** verify buyserv.txt, look at remaining ~$488k for
more darkweb programs or hold it, check for coding contracts, check whether
avmnite-02h (NiteSec) is reachable/rootable now that TOR+BruteSSH exist.

---

## 2026-09-11 ~20:22 UTC — follow-up checks, same session

**`buyserv.txt` mirroring gap — diagnosed, not fixed.** `.telemetry/buyserv.txt`
never appears because `buyserv.js` runs on **joesguns** and writes to
`/tel/buyserv.txt` on joesguns's own filesystem. `tools/rfa-daemon.mjs`
(line ~200) only mirrors `tel/*` files where `server: "home"` in
`getFileNames`/`getFile`. Confirmed via RPC — the file exists and updates
fine on joesguns (`curl -X POST localhost:12526/rpc -d
'{"method":"getFile","params":{"filename":"tel/buyserv.txt","server":"joesguns"}}'`),
it's just invisible to the normal `.telemetry/` read path. Left as-is —
`tools/**` is the optimizer's, and this is cosmetic (buyserv's actual
reserve/purchase logic is unaffected). **Workaround:** poll it directly via
RPC with `server: "joesguns"` instead of reading `.telemetry/buyserv.txt`.

**auto.js auto-rooted 4 more servers on its own** the moment BruteSSH.exe
appeared on home: CSEC, max-hardware, zer0, neo-net. Rooted went 8 → 12,
RAM pool 108GB → 220GB (partly from CSEC/max-hardware/zer0/neo-net's own RAM,
partly from home's 8→16GB). No manual nuking was needed beyond the one CSEC
attempt (which turned out already-rooted by the time I got to it — auto.js
is fast). Confirms the "buy any port opener and auto.js does the rest" model
in the brief works as described.

**`incomePerSec: 0` in telemetry — transient, not a bug.** Checked
`ns.getTotalScriptIncome()` semantics in `NetscriptDefinitions.d.ts`: index
`[0]` is the *current* $/sec rate, `[1]` is the lifetime-since-aug rate. The
in-game Active Scripts page shows "$289.322/sec" but that number
(`ScriptProduction.tsx`) is `Player.scriptProdSinceLastAug /
Player.playtimeSinceLastAug` — a **lifetime average**, not a live rate, so it
doesn't contradict a momentary 0. Confirmed real behavior instead by
snapshotting per-server `money`/`security` twice a few seconds apart:
foodnstuff's money rose ($2.101m → $2.234m) and security fell (8.13 → 7.8)
between polls with no player income change — i.e. early.js is mid
grow/weaken cycle on a server sitting at ~4% of max money (recently hacked
hard), not stalled. Income will resume in bursts once security nears the
floor and money rebuilds enough for hack() to fire meaningfully. No action
taken; false alarm.

**avmnite-02h (NiteSec) — not yet reachable.** `requiredHackingSkill`
202-220 (source: `servers.ts` line ~1486), needs 2 open ports (have 1,
BruteSSH only). Current hacking level 92. Not actionable yet; revisit once
level climbs past ~220 and there's $1.5m+ spare for FTPCrack.exe. All other
faction servers (BitRunners 505-550, Black Hand 340-365, Dark Army,
Daedalus 925, WorldDaemon 3000) are much further out.

**No coding contracts found.** Checked `getFileNames` on all 9 then-rooted
servers plus CSEC/iron-gym for `.cct` files — none present. `contract.js`
in this repo depends on a stale `BB_SERVER_MAP` in localStorage from an old
`spider.js`/`find.js` pair that isn't part of the current auto.js
architecture; did not run `spider.js` since it calls `ns.spawn(...)` at the
end (defaults to spawning `hack.js`, which won't even fit in home's current
16GB alongside auto.js) — avoided it as an unnecessary risk to the
supervisor. Re-check contracts by hand (RPC `getFileNames` sweep) rather
than reviving that script.

**Money at end of this cycle:** ~$488k, unchanged since last spend (expected,
per the income analysis above — will move once a hack cycle lands).
Deferred further darkweb spending (FTPCrack etc.) — nothing currently
reachable needs a 2nd port, and buyserv's $2m reserve is more useful to
refill first.

**Open decision for the lead:** CyberSec faction invite is pending (badge on
Factions nav, "Decide later" was clicked). Awaiting roadmap.md guidance on
faction order before joining.
