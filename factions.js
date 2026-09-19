// Every faction in the game, as data.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// ---------------------------------------------------------------------------
//
// THE RULE IT ENSHRINES: **every faction and every augmentation is a
// candidate.** Nothing is excluded by a list someone wrote once.
//
// progress.js used to build its candidate set from `[...HACK_FACTIONS,
// ...MEGACORPS]` — six hand-picked hacking factions plus the twelve company
// factions. That is 18 of the 34 real factions, and the 16 it omitted were not
// ranked poorly, they were INVISIBLE: they appeared in neither `joinForecasts`
// nor `unpriceable`, so no telemetry anywhere said they had been skipped.
//
// The cost, measured in BitNode 1 with the run 9 distinct augmentations short
// of Daedalus's 30 and the hacking multiplier already sufficient to exit:
//
//     Tian Di Hui    8 augmentations   138,750 rep    $808m     <- not a candidate
//     Netburners     5 augmentations    28,125 rep    $121m     <- unpriceable
//     ECorp          9 augmentations  8,350,000 rep   $46b      <- what was chosen
//
// The schedule was grinding 1,138,561 reputation at ECorp, budgeted at 5.8
// hours, for augmentations whose multipliers the run no longer needed — while
// 13 augmentations sat behind ~167,000 reputation, about twenty minutes at the
// rate in its own plan. Its own Daedalus forecast said the augmentation count
// was 92.5 HOURS away. The cheap route was not rejected; it could not be seen.
//
// A hand-written subset is a silent cap on the search space, and this file is
// the fix: the whole space, verified against the game's own enum by the test
// suite so it cannot drift as the game adds factions.
//
// ---------------------------------------------------------------------------
// WHAT IS AND IS NOT HERE
// ---------------------------------------------------------------------------
//
// `unknown`, `rumored` and `known` are members of the FactionName enum used as
// DISCOVERY STATES (Faction/Enums.ts), not factions — they are excluded here
// and the test asserts that exclusion explicitly rather than silently, so a
// future reader does not "restore" them.
//
// Membership rules the CALLER still has to apply, because they are policy and
// not data:
//   - the six CITY factions conflict with each other (joining one bans the
//     rest of an incompatible set) — factionplan.bestCompatibleSet prices that.
//   - Daedalus, Illuminati, The Covenant are endgame factions with their own
//     gates.
//   - some factions are unreachable in some BitNodes (Bladeburners needs SF6/7,
//     Church of the Machine God needs SF13, Shadows of Anarchy needs SF10).
//     They are listed anyway: an unreachable faction prices as unjoinable via
//     its requirements, which is a MEASURED refusal, and that is strictly
//     better than an absence nobody can audit.

export const ALL_FACTIONS = [
  'Illuminati',
  'Daedalus',
  'The Covenant',
  'ECorp',
  'MegaCorp',
  'Bachman & Associates',
  'Blade Industries',
  'NWO',
  'Clarke Incorporated',
  'OmniTek Incorporated',
  'Four Sigma',
  'KuaiGong International',
  'Fulcrum Secret Technologies',
  'BitRunners',
  'The Black Hand',
  'NiteSec',
  'Aevum',
  'Chongqing',
  'Ishima',
  'New Tokyo',
  'Sector-12',
  'Volhaven',
  'Speakers for the Dead',
  'The Dark Army',
  'The Syndicate',
  'Silhouette',
  'Tetrads',
  'Slum Snakes',
  'Netburners',
  'Tian Di Hui',
  'CyberSec',
  'Bladeburners',
  'Church of the Machine God',
  'Shadows of Anarchy',
]

/** Enum members that are discovery STATES, not factions. Asserted by the suite. */
export const NON_FACTIONS = ['unknown', 'rumored', 'known']
