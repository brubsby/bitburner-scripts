// THE FACTION WORK THE GAME OFFERS — pure, shared by progress.js (the
// player's work order), sleeveplan.js (sleeves) and contractplan.js
// (contract reputation reaches hacking-work factions only).
//
// FactionInfo.tsx offerHackingWork / offerFieldWork / offerSecurityWork.
// Three factions offer NONE: the Church of the Machine God (rep only from
// Stanek charging), Bladeburners (rank) and Shadows of Anarchy (infiltration).
// workForFaction returns false for every type there, so such a faction must
// never be a work target — its rep has its own mechanism, priced apart.
// Live BN13.1 2026-10-12 12:52Z: the schedule ordered the player's work at
// the Church; act-work.js failed every type. [FW1] re-parses FactionInfo.tsx.

export const HACKING_WORK_FACTIONS = new Set([
  'Illuminati', 'Daedalus', 'The Covenant', 'ECorp', 'MegaCorp', 'Bachman & Associates', 'Blade Industries', 'NWO',
  'Clarke Incorporated', 'OmniTek Incorporated', 'Four Sigma', 'KuaiGong International', 'Fulcrum Secret Technologies',
  'BitRunners', 'The Black Hand', 'NiteSec', 'CyberSec', 'Aevum', 'Chongqing', 'Ishima', 'New Tokyo', 'Sector-12',
  'Volhaven', 'Speakers for the Dead', 'The Dark Army', 'The Syndicate', 'Silhouette', 'Netburners', 'Tian Di Hui',
])
export const FIELD_WORK_FACTIONS = new Set([
  'Illuminati', 'Daedalus', 'The Covenant', 'ECorp', 'MegaCorp', 'Bachman & Associates', 'Blade Industries', 'NWO',
  'Clarke Incorporated', 'OmniTek Incorporated', 'Four Sigma', 'KuaiGong International', 'The Black Hand', 'Aevum',
  'Chongqing', 'Ishima', 'New Tokyo', 'Sector-12', 'Volhaven', 'Speakers for the Dead', 'The Dark Army', 'The Syndicate',
  'Silhouette', 'Tetrads', 'Slum Snakes',
])
export const SECURITY_WORK_FACTIONS = new Set([
  'ECorp', 'MegaCorp', 'Bachman & Associates', 'Blade Industries', 'NWO', 'Clarke Incorporated', 'OmniTek Incorporated',
  'Four Sigma', 'KuaiGong International', 'Fulcrum Secret Technologies', 'Aevum', 'Chongqing', 'Ishima', 'New Tokyo',
  'Sector-12', 'Volhaven', 'Speakers for the Dead', 'The Syndicate', 'Tetrads', 'Slum Snakes', 'Tian Di Hui',
])

/** The work types `faction` offers, hacking first (act-work.js's order). [] = none. */
export function workTypesOf(faction) {
  const out = []
  if (HACKING_WORK_FACTIONS.has(faction)) out.push('hacking')
  if (FIELD_WORK_FACTIONS.has(faction)) out.push('field')
  if (SECURITY_WORK_FACTIONS.has(faction)) out.push('security')
  return out
}

/** Does `faction` offer any faction work at all? Unknown names: no (fail closed). */
export const offersFactionWork = (faction) => workTypesOf(faction).length > 0

/** The joined factions the player can work: not the gang's, not one offering no work. */
export const workableOf = (factions, gangFaction = null) => (Array.isArray(factions) ? factions.filter((f) => f !== gangFaction && offersFactionWork(f)) : [])

/** The first of `candidates` (priority order) that offers work, else null. */
export const workTargetOf = (candidates) => (candidates ?? []).find((f) => typeof f === 'string' && offersFactionWork(f)) ?? null
