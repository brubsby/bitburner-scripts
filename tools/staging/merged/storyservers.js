// The five story servers, and the faction each one's backdoor unlocks.
//
// Pure data, no ns calls, free to import (CLAUDE.md, "Separate pure logic from
// ns I/O"). It exists so backdoor.js and watchdog.js can answer questions about
// the same list without either of them owning it.
//
// That mattered enough to make a file for. watchdog.js used to answer "does
// backdoor.js still have work to do?" by reading /tel/backdoor.txt — the
// telemetry backdoor.js itself writes — precisely so that the target list would
// not have to be duplicated. That is a circular gate (invariants C4): the
// predicate kills backdoor.js on false, text files survive a prestige
// (Server/ServerHelpers.ts:226-239 clears programs, serversOnNetwork and
// ramUsed but NOT files), so a file left by the previous life saying "nothing
// remaining" would kill backdoor.js in the NEXT life and never relaunch it —
// silently, permanently, with faction invitations gated behind it.
//
// Sharing the list here lets the predicate be answered from game state instead
// (ns.getServer(host).backdoorInstalled), with no duplication and nothing to
// drift.
//
// The list itself is the game's own: these are the servers whose
// `backdoorInstalled` a faction's requirement reads (Faction/FactionInfo.tsx
// checks `getServer(...).backdoorInstalled` for each). Order is the order they
// unlock in, which is the order to attempt them in.
export const STORY_SERVERS = [
  ['CSEC', 'CyberSec'],
  ['avmnite-02h', 'NiteSec'],
  ['I.I.I.I', 'The Black Hand'],
  ['run4theh111z', 'BitRunners'],
  ['fulcrumassets', 'Fulcrum Secret Technologies'],
]
