// Donates RAM to the faction you are working for, raising reputation gain.
//
//   run share.js -t 600
//
// ns.share() adds this script's threads to a global pool for ~10s at a time.
// Every faction-work reputation formula is multiplied by
// calculateCurrentShareBonus() (src/PersonObjects/formulas/reputation.ts:22),
// which is:
//
//     bonus = 1 + ln(shareThreads) / 25          src/NetworkShare/Share.ts:43
//
// That is steeply concave, which is the whole reason this script takes a thread
// count rather than eating the fleet. At 4GB per thread:
//
//      threads     RAM      bonus
//         100     0.4TB     1.184
//         300     1.2TB     1.228
//         600     2.4TB     1.256     <- roughly 7% of a 36TB fleet
//       1,500     6.0TB     1.293
//       9,000    36.0TB     1.364     <- the entire fleet, for 11% more
//
// So ~600 threads buys about three quarters of the maximum bonus for a
// fifteenth of the RAM. Everything beyond that is far better spent hacking,
// because hacking experience raises the hacking level and reputation gain is
// *linear* in it (reputation.ts:18) — the level channel outruns the share
// channel quickly.
//
// Only worth running while there is a reputation target. It does nothing at all
// if you are not working for a faction.

export async function main(ns) {
  ns.disableLog('ALL')
  while (true) {
    await ns.share()
  }
}
