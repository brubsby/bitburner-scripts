// Faction invitations, joining, and faction work — the one thing a life could
// not automate.
//
//   run sing-faction.js                      check invites, join per policy
//   run sing-faction.js join "Sector-12"     join one named faction (override)
//   run sing-faction.js work CyberSec hacking
//   run sing-faction.js work CyberSec hacking --focus no
//   run sing-faction.js stop
//
// ---------------------------------------------------------------------------
// Why this script exists at all.
//
// `Faction/ui/FactionsRoot.tsx:87-93`:
//
//     function acceptInvitation(event, factionName) {
//       if (!event.isTrusted || !Factions[factionName].alreadyInvited || ...) return
//
// `event.isTrusted` is tested BEFORE the invite is even looked up, so there is
// no partial path: a synthetic `.click()` returns silently, in every BitNode,
// forever. That was the single blocker on a headless playthrough — ~5 human
// clicks per install cycle for the whole of BitNode 1.
//
// `NetscriptFunctions/Singularity.ts:750-771` is the other door:
//
//     joinFaction: (ctx, _facName) => {
//       helpers.checkSingularityAccess(ctx)
//       ...already a member? ...not invited? ...else joinFaction(fac)
//
// No `isTrusted`, no DOM, no event. Verified by reading both files, not
// recalled. This script is that call plus the policy around it.
//
// ---------------------------------------------------------------------------
// RAM: 13.7GB. Every Singularity reference is in the job description.
//
//   base                       1.6   RamCostConstants.Base (RamCostGenerator.ts:11)
//   checkFactionInvitations    3     SingularityFn2, :188 — the input to the policy
//   joinFaction                3     SingularityFn2, :189 — the point of the script
//   workForFaction             3     SingularityFn2, :190
//   stopAction                 1     SingularityFn1/2, :175 — the only way to end work
//   getCurrentWork             0.5   :221 — idempotency; also guards setFocus, which
//                                    THROWS when Player.currentWork is null (:540-542)
//   setFocus                   0.1   :214
//   getPlayer                  0.5   SingularityFn1/4 (:661) — .factions for the policy
//                                    and the status file. NOT a Singularity call.
//   getResetInfo               1     :664 — see below. NOT a Singularity call.
//
// `getResetInfo` earns its 1GB twice over:
//
//   1. `.ownedAugs` is `new Map(Player.augmentations.map(...))`
//      (NetscriptFunctions.ts:1444) — INSTALLED augmentations, which is exactly
//      what `focusPenalty()` tests: `hasAugmentation(NeuroreceptorManager, true)`
//      with `ignoreQueued = true` (PlayerObjectGeneralMethods.ts:624,
//      Person.ts:232). So it answers "does focusing still matter?" for 1GB
//      instead of the 5GB `getOwnedAugmentations` (SingularityFn3, :201).
//   2. `.currentNode` puts the BitNode in the telemetry, so a reader never has
//      to guess which multiplier set was in force.
//
// NOT referenced, deliberately:
//
//   - `getFactionEnemies` (3GB, :187). The enemy graph is six static entries in
//     `Faction/FactionInfo.tsx` and is not BitNode-dependent; it is inlined
//     below with line citations. This is the licensed kind of RAM trade from
//     CLAUDE.md — deliberate, documented, real behaviour named — and 3GB is 23%
//     of this script.
//   - `getFactionRep` / `getFactionFavor` (1GB each). Reputation is
//     sing-donate.js's business; this script starts work, it does not decide
//     how much is enough.
//   - `getFactionWorkTypes` (1GB). `workForFaction` already returns false and
//     logs when a faction does not offer the type (:790-793 etc.), so paying to
//     pre-check buys nothing but a nicer message.
//   - anything from sing-aug.js or sing-donate.js. Joining and donating do not
//     need to be atomic with each other, so per the rule in docs/autonomy.md
//     they are separate scripts.
//
// ⚠ A LOCAL VARIABLE NAME CAN COST RAM — `RamCalculations.ts:436-438` walks the
// `property` side of every MemberExpression and `findFunc` (:226-244) resolves
// bare names against the whole RamCosts tree, so an identifier that collides
// with any ns function in any namespace is billed. Audit new names rather than
// eyeballing them; the script is in NOTES-faction.md §5.

import { reporter, describe, record } from 'status.js'

const STATUS = '/tel/sing-faction.txt'

// ---------------------------------------------------------------------------
// The exclusivity graph.
//
// `Faction/FactionHelpers.tsx:44-47`, inside joinFaction():
//
//     for (const enemy of faction.getInfo().enemies) {
//       if (Factions[enemy]) Factions[enemy].isBanned = true
//     }
//
// and :48-51 then drops every banned faction from `factionInvitations`. The ban
// is permanent for the life. `enemies` is non-empty for exactly six factions —
// the six city factions — and for nobody else. Checked by grepping `enemies:`
// across the whole of FactionInfo.tsx: six hits, at :498, :508, :520, :530,
// :540, :552.
//
// **The crime factions are NOT mutually exclusive in this version.** Slum
// Snakes, Tetrads, Silhouette, The Syndicate, The Dark Army and Speakers for
// the Dead all declare no `enemies` at all (FactionInfo.tsx:560-666), so they
// can be joined freely and in any order. Older guides say otherwise; the source
// does not. There is nothing to protect there, so this script joins every crime
// invite it sees.
//
// The city graph is asymmetric and that asymmetry is the whole game:
const CITY_ENEMIES = {
  // FactionInfo.tsx:498 — note the absence of Sector-12
  Aevum: ['Chongqing', 'New Tokyo', 'Ishima', 'Volhaven'],
  // :508
  Chongqing: ['Sector-12', 'Aevum', 'Volhaven'],
  // :520
  Ishima: ['Sector-12', 'Aevum', 'Volhaven'],
  // :530
  'New Tokyo': ['Sector-12', 'Aevum', 'Volhaven'],
  // :540 — note the absence of Aevum
  'Sector-12': ['Chongqing', 'New Tokyo', 'Ishima', 'Volhaven'],
  // :552 — bans all five others
  Volhaven: ['Chongqing', 'Sector-12', 'New Tokyo', 'Aevum', 'Ishima'],
}

// ---------------------------------------------------------------------------
// The join policy.
//
// Rule 1: join anything with no enemies, immediately. Nothing is forgone, and a
// faction you are not in sells you nothing. That is every hacking faction
// (CyberSec, NiteSec, The Black Hand, BitRunners), every megacorp, every crime
// faction, Netburners, Tian Di Hui, Daedalus, and the endgame three.
//
// Rule 2: among the six city factions, commit to ONE bloc and never deviate.
// Reading CITY_ENEMIES as a graph gives three blocs, not six choices:
//
//     {Sector-12, Aevum}                 — each omits the other from its enemies
//     {Chongqing, New Tokyo, Ishima}     — each lists only S12/Aevum/Volhaven
//     {Volhaven}                         — bans the other five
//
// So the real decision is "which of three", and the western bloc is worth two
// memberships, the eastern three, Volhaven one.
//
// CHOSEN: the western bloc, Sector-12 then Aevum. The augmentation lists
// (extracted from Augmentation/Augmentations.ts) decide it:
//
//   Sector-12 only : CashRoot Starter Kit  rep 1.25e4  $1.25e8
//                    startingMoney 1e6 + CompletedProgramName.bruteSsh (:320-327)
//   Aevum only     : PCMatrix              rep 1.0e5   $2.0e9
//                    faction_rep 1.0777, company_rep 1.0777, crime_money 1.0777
//
// CashRoot is the one augmentation that addresses the structural hole CLAUDE.md
// names in the install procedure: after a prestige, `serversOnNetwork = []`
// takes TOR with it, so a fresh life has no money, no port openers and no
// darkweb. CashRoot hands back $1262 AND BruteSSH at every single install,
// forever. In a bot that must restart itself with no human, that is worth more
// than any multiplier.
//
// PCMatrix's faction_rep 1.0777 is the compounding one: `person.mults.faction_rep`
// appears in BOTH `getHackingWorkRepGain` (formulas/reputation.ts:17) and
// `repFromDonation` (formulas/donation.ts:8-10), so it makes grinding faster and
// every future donation cheaper, for the rest of the BitNode.
//
// What the eastern bloc is giving up, and why it is affordable: its only real
// hacking prizes are DataJack (hacking_money 1.25) and Neuregen (hacking_exp
// 1.4). **DataJack is also sold by BitRunners, The Black Hand and NiteSec**
// (Augmentations.ts, factions list) — all three of which we join anyway under
// Rule 1 — so the eastern bloc's unique contribution collapses to Neuregen, one
// experience multiplier, against CashRoot's bootstrap and PCMatrix's compounding
// rep. Volhaven is strictly dominated: it costs five memberships and its unique
// augmentations (CombatRib2, DermaForce) are combat.
//
// This is a deliberate, documented lock-out, which is what the brief asked for.
// Override it with `--bloc east` or `--bloc volhaven` if a later run wants the
// combat line; `--bloc none` refuses every city invite and forgoes nothing
// permanently, because a city invite re-arrives whenever the money condition
// holds (FactionInfo.tsx inviteReqs are re-evaluated every check).
const BLOCS = {
  west: ['Sector-12', 'Aevum'],
  east: ['Chongqing', 'New Tokyo', 'Ishima'],
  volhaven: ['Volhaven'],
  none: [],
}

/**
 * Decide, for one invitation, whether joining it forecloses something.
 *
 * Returns { join: boolean, why: string }. Pure — no ns, so it is free and
 * testable under plain node.
 */
export function decide(faction, bloc, joinedSoFar) {
  if (!CITY_ENEMIES[faction]) return { join: true, why: 'no enemies; nothing is forgone' }

  const allowed = BLOCS[bloc] || BLOCS.west
  if (!allowed.includes(faction)) {
    return { join: false, why: `city faction outside the '${bloc}' bloc — joining would ban ${CITY_ENEMIES[faction].join(', ')}` }
  }

  // Within-bloc safety net. The blocs above are internally compatible by
  // construction, but if the table is ever edited this catches the mistake
  // before it becomes permanent rather than after.
  const banned = CITY_ENEMIES[faction]
  const clash = allowed.find((f) => f !== faction && banned.includes(f))
  if (clash) return { join: false, why: `bloc is inconsistent: joining ${faction} would ban ${clash}` }

  const clashJoined = joinedSoFar.find((f) => banned.includes(f))
  if (clashJoined) return { join: false, why: `already in ${clashJoined}, which ${faction} would... (unreachable; game already filtered)` }

  return { join: true, why: `in the '${bloc}' bloc` }
}

export async function main(ns) {
  const flags = ns.flags([
    ['bloc', 'west'],
    // 'auto' | 'yes' | 'no'. See the focus section below.
    ['focus', 'auto'],
    ['help', false],
  ])
  const [verb = 'invites', argA, argB] = flags._

  ns.disableLog('ALL')

  const errors = []
  const joined = []
  let node = null
  let memberships = []

  const note = reporter(ns, STATUS, () => ({
    verb,
    bitNode: node,
    joined,
    factions: memberships.length,
    errors: errors.slice(-5),
  }))
  // The path no try/finally can reach: a kill, a killall, an install, or a
  // throw past every handler. status.js:186-211.
  ns.atExit(() => note.exit('stopped', { detail: 'sing-faction.js exited' }))

  if (flags.help) {
    ns.tprint('sing-faction.js [invites|join <faction>|work <faction> <type>|stop] [--bloc west|east|volhaven|none] [--focus auto|yes|no]')
    note('ok', { result: 'ok', detail: 'help' })
    return
  }

  try {
    const reset = ns.getResetInfo()
    node = reset.currentNode
    memberships = ns.getPlayer().factions

    // `focusPenalty()` is `focus ? 1 : CONSTANTS.BaseFocusBonus` (0.8,
    // Constants.ts:87) — UNLESS the Neuroreceptor Management Implant is
    // installed, in which case the penalty does not exist at all
    // (PlayerObjectGeneralMethods.ts:622-628). With it, unfocused work is worth
    // the same 100% and we should never focus: focused work routes the UI to
    // Page.Work (Singularity.ts:545-546) and CLAUDE.md records that this hides
    // the entire sidebar, which is how augbuy.js / torbuy.js / upkeep.js lose
    // their buttons. Costing the run ~3 hours of 80% work once is the reason
    // that warning exists; so is not blocking the DOM scripts for nothing.
    const hasNRM = reset.ownedAugs.has('Neuroreceptor Management Implant')
    const wantFocus = flags.focus === 'yes' ? true : flags.focus === 'no' ? false : !hasNRM

    if (verb === 'stop') {
      const wasWorking = ns.singularity.stopAction()
      note('ok', { result: 'ok', detail: wasWorking ? 'stopped work' : 'was not working' })
      ns.tprint(`sing-faction: ${wasWorking ? 'stopped' : 'nothing to stop'}`)
      return
    }

    if (verb === 'work') {
      if (!argA) throw new Error('work needs a faction name, e.g. work CyberSec hacking')
      const type = String(argB || 'hacking')
      // Work/Enums.ts:1-5 — the enum is exactly these three, lowercase.
      if (!['hacking', 'field', 'security'].includes(type)) {
        throw new Error(`work type must be hacking|field|security, got '${type}'`)
      }

      // --- idempotency ----------------------------------------------------
      // The requirement is "if already working the right thing, do nothing".
      // getCurrentWork() is Player.currentWork.APICopy(); for FactionWork that
      // is { type:'FACTION', factionName, factionWorkType, cyclesWorked,
      // nextCompletion } (Work/FactionWork.tsx:71-79).
      //
      // Re-issuing workForFaction is not free even though it looks idempotent:
      // it calls Player.startWork with a brand new FactionWork, which resets
      // cyclesWorked. Reputation itself is safe — FactionWork.process() adds
      // `getReputationRate() * cycles` to faction.playerReputation on EVERY
      // cycle (:52-54), not at finish — so nothing banked is ever lost by
      // switching. But a status file whose cyclesWorked keeps resetting to 0
      // makes progress unreadable, and that is the whole point of /tel.
      const cur = ns.singularity.getCurrentWork()
      const already =
        cur && cur.type === 'FACTION' && cur.factionName === argA && cur.factionWorkType === type

      if (already) {
        // Focus is the one thing still worth correcting in place: it is a
        // 25% swing (1 / 0.8) and setFocus is a no-op returning false when
        // already in the requested state (Singularity.ts:544-552).
        const changed = ns.singularity.setFocus(wantFocus)
        note('ok', {
          result: 'ok',
          detail: `already working ${type} for ${argA} (${Math.round(cur.cyclesWorked)} cycles)${changed ? `; focus -> ${wantFocus}` : ''}`,
          work: { faction: argA, type, cyclesWorked: cur.cyclesWorked, focus: wantFocus, focusFree: hasNRM },
        })
        ns.tprint(`sing-faction: already working ${type} for ${argA}`)
        return
      }

      const ok = ns.singularity.workForFaction(argA, type, wantFocus)
      if (!ok) {
        // workForFaction returns false for: in a gang for this faction
        // (:775-778), not a member (:780-783), or the faction does not offer
        // this work type (:790-793 / :806-809 / :822-825). It logs which.
        note('error', {
          result: 'error',
          detail: `workForFaction('${argA}','${type}') returned false — not a member, gang faction, or that work type is not offered`,
          factionsJoined: memberships,
        })
        ns.tprint(`sing-faction: could not work ${type} for ${argA}`)
        return
      }

      note('ok', {
        result: 'ok',
        detail: `working ${type} for ${argA}, focus=${wantFocus}${hasNRM ? ' (NRM installed: unfocused is full rate)' : ''}`,
        work: { faction: argA, type, cyclesWorked: 0, focus: wantFocus, focusFree: hasNRM },
      })
      ns.tprint(`sing-faction: working ${type} for ${argA} (focus ${wantFocus})`)
      return
    }

    // --- invites / join -----------------------------------------------------
    // checkFactionInvitations does more than read: it zeroes
    // Engine.Counters.checkFactionInvitations and runs Engine.checkCounters()
    // (Singularity.ts:742-748), so invites that have just become earnable are
    // issued on this call rather than up to a counter-period later. That is why
    // this is the read even on the explicit-join path.
    const invites = ns.singularity.checkFactionInvitations()
    const skipped = []

    const candidates = verb === 'join' ? (argA ? [argA] : []) : invites
    if (verb === 'join' && argA && !invites.includes(argA)) {
      note('error', { result: 'error', detail: `no pending invitation from '${argA}'; pending: ${invites.join(', ') || 'none'}` })
      ns.tprint(`sing-faction: no invitation from ${argA}`)
      return
    }

    for (const faction of candidates) {
      // An explicit `join <faction>` is a human/director override and bypasses
      // the bloc policy on purpose — but it still reports what it foreclosed.
      const d = verb === 'join' ? { join: true, why: 'explicit override' } : decide(faction, flags.bloc, joined)
      if (!d.join) {
        skipped.push({ faction, why: d.why })
        continue
      }
      if (ns.singularity.joinFaction(faction)) {
        joined.push(faction)
        const bans = CITY_ENEMIES[faction]
        if (bans) ns.tprint(`sing-faction: joined ${faction} — PERMANENTLY banned from ${bans.join(', ')}`)
        else ns.tprint(`sing-faction: joined ${faction}`)
      } else {
        // false means already a member, or not invited (:753-762). Neither is
        // an error worth failing the run over; record it and move on.
        skipped.push({ faction, why: 'joinFaction returned false (already a member, or invite withdrawn)' })
      }
    }

    memberships = ns.getPlayer().factions

    note('ok', {
      result: 'ok',
      detail: joined.length
        ? `joined ${joined.join(', ')}`
        : invites.length
          ? `${invites.length} invite(s) pending, none joinable under bloc '${flags.bloc}'`
          : 'no pending invitations',
      bloc: flags.bloc,
      pending: invites,
      skipped,
      memberships,
    })
    if (!joined.length) ns.tprint(`sing-faction: ${invites.length} pending, joined none (bloc ${flags.bloc})`)
  } catch (err) {
    ns.print(record(errors, err))
    note('error', { result: 'error', detail: describe(err) })
    ns.tprint(`sing-faction: ERROR ${describe(err)}`)
  }
}
