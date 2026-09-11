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

---

## 2026-09-11 ~22:52 UTC — resume after 2nd context cutoff, contracts harvested

**State on pickup:** hacking 176, money $8.526m, 15/73 rooted, home 16GB/1
core. `auto.js` (pid 34) and `buyserv.js` (pid 33) were already running the
current-revision code — screen scrollback showed the lead's own prior restart
of both (killall on joesguns, run buyserv.js; kill/run auto.js on home)
already done in this same session before the cutoff. Did not restart either
again.

**Coding contracts — the main event.**
1. `kill auto.js` on home.
2. `run ctscan.js` — failed first try ("requires 12.00GB", home didn't have
   enough free with orphaned `early.js` (pid 49, 3 threads, target
   harakiri-sushi) still running after auto.js died. `kill early.js` (by
   script name) said "No such script is running" — this version apparently
   needs args to match or doesn't do fuzzy match; `kill 49` (by PID) worked.
   Re-ran `run ctscan.js` — succeeded: **21 contracts found** across the
   network: 7x Total Ways to Sum, 4x Encryption I: Caesar Cipher, 4x
   Algorithmic Stock Trader I, 3x Subarray with Maximum Sum, 3x Find Largest
   Prime Factor. Written to `/tmp/contracts.json` (in-game path).
3. `run ctsolve.js --dry` — **21 solved, 0 wrong, 0 skipped**. Printed every
   answer (Caesar cipher strings, stock trader profits, prime factors, etc.)
   without submitting. Looked sane on inspection — answers matched contract
   type constraints, no obvious garbage.
4. `run ctsolve.js` for real — **21 solved, 0 wrong, 0 skipped**, exact match
   with the dry run. Rewards: 4 contracts paid **$25.000m each** (foodnstuff,
   unitalife, blade, ecorp = $100m total), the rest paid CyberSec faction
   reputation (833.3 or 277.7 rep each, ~15 contracts).
5. **Money: $5.006m -> $105.006m** in one shot (started ~$8.5m, buyserv had
   spent it down to ~$5m on server RAM by the time contracts ran).
6. `run auto.js` again on home — pid 66, redeployed fine.

**No decisions needed here** — ctsolve.js only solves types it has a solver
for and reported 0 skipped, meaning either it has solvers for every type
present or got lucky; either way 0 wrong is the number that mattered and
that's clean.

**Faction check pending** — telemetry poll before this cycle showed
`factions: ["CyberSec"]` (already joined, presumably by the lead earlier this
session — the open decision noted in the prior log entry about "should I join
CyberSec" appears resolved) and `factionInvitations: ["Sector-12"]` pending.
Contract-solving just added ~833 rep x ~15 contracts to CyberSec on top of
whatever it had. Have not yet opened the Factions tab to confirm/act on the
Sector-12 invite — next step.

**Next:** buy FTPCrack.exe ($1.5m, plenty of money now), check Factions tab
and report available factions, then watch for new contracts periodically.

**FTPCrack.exe bought** ($1.5m via darkweb terminal, `connect darkweb` / `buy
FTPCrack.exe`) — achievement popup confirmed purchase. auto.js already
picking up newly-reachable 2-port servers: rooted climbed 18 -> 20 within a
couple minutes of purchase (76 total reachable now).

**auto.js died once after the post-contract restart** — pid 66 (started right
after `run auto.js`) was gone from the process list ~90s later with no error
printed anywhere (checked `tail auto.js`: "No script named auto.js ... is
running", so no crash log survived; checked the script source — the main loop
is a `while(true)` wrapped in try/catch that only returns early if
`ns.getScriptRam(worker)` fails, which can't be it since it had already
completed at least one deploy cycle, confirmed by an orphaned `early.js` pid
67 on home targeting harakiri-sushi). Cause unknown — possibly transient
during the FTPCrack purchase / navigate-to-darkweb sequence, possibly
unrelated. **Restarted it once** (`run auto.js`, now pid 69) per the "restart
if it dies" rule; confirmed stable through cycle 2 and beyond via
`tel/auto.txt`, and it is still running as of this checkpoint. Flagging in
case it recurs — if auto.js keeps dying, that's a real bug worth the
optimizer's attention, not a one-off.

**Faction check:** CyberSec already joined (visible under "Your Factions" on
the Factions tab, 6 augmentations available there). No pending CyberSec
invite to accept — already resolved before this session, nothing to do.
**Sector-12 invitation is pending** ("Join!" button showing) — left
un-clicked since the brief only asked me to resolve CyberSec; this is a
separate city faction, not blocking anything. Rumor panel mentions NiteSec
may recruit once hacking skills impress them (i.e. once avmnite-02h is
backdoored) — not yet reachable, needs 2 open ports and hacking ~202-220;
now have 2 ports (BruteSSH + FTPCrack) but level is 176, still short.

**buyserv.js is spending fast and well:** since the contract windfall it
bought a 1024GB and a 512GB purchased server in quick succession (fleet now
4 servers, 1728GB total), money down from $105m to ~$19m, reserve ($2m)
intact. Working as designed.

**State at end of this cycle:** hacking 176, money ~$19m, 20/76 servers
rooted, auto.js pid 69 (home) and buyserv.js pid 33 (joesguns) both running
current code. CyberSec joined, Sector-12 invite pending (unresolved,
low-priority). FTPCrack.exe owned. No contracts currently outstanding (just
harvested all 21); worth re-running `ctscan.js`/`ctsolve.js` periodically as
new ones spawn.

**Suggested next steps for whoever picks this up:** (1) periodically re-run
ctscan/ctsolve — contracts regenerate over time; (2) decide on Sector-12
invite (low stakes, can wait for researcher's faction-order guidance); (3)
keep an eye on auto.js liveness given the unexplained death this cycle; (4)
NiteSec/avmnite-02h becomes reachable once hacking level clears ~202-220,
which should happen soon given current income.
