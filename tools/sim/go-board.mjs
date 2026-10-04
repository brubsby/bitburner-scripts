// Shared harness helpers for the IPvGO studies (go-w0.mjs, go-boardsize.mjs).
//
// THE LAYOUT SEED. offlineNodes.ts:13 deals the offline-node layout from
// `new WHRNG(Player.totalPlaytime ?? new Date().getTime())`. The harness's
// Player is a real PlayerObject whose totalPlaytime is 0 and never advances,
// and `0 ?? x` is 0 — so without this every getNewBoardState call deals the
// SAME layout. A study run that way measures one board, however many games it
// plays: on 2026-10-03 the 5x5 Illuminati "30% win" figure turned out to be
// one layout (a single corner hole), played over and over.
//
// The live game's playtime is effectively uniform over WHRNG's 30000-second
// seed cycle (seed = (T/1000) % 30000, Casino/RNG.ts), so a uniform draw over
// that cycle reproduces the live layout distribution.

/** Move Player.totalPlaytime to a random point of the WHRNG seed cycle. */
export function randomizeLayout(g) {
  g.Player.totalPlaytime = Math.floor(Math.random() * 30000) * 1000 + 1000;
}

/**
 * A REPRODUCIBLE deal: game `i` of a run seeded `seed` gets the same board in
 * every arm, so two solver configurations are compared on identical boards
 * (paired, far less variance than independent draws). The layout is the
 * playtime seed (offlineNodes.ts:13); the handicap stones are placed with
 * Math.random (boardState.ts applyHandicap), so that is seeded for the call.
 */
export function dealPaired(g, size, opponent, seed, i) {
  g.Player.totalPlaytime = ((seed * 7919 + i * 104729) % 30000) * 1000 + 1000;
  let s = (seed * 2654435761 + i * 40503 + 1) >>> 0 || 1;
  const real = Math.random;
  Math.random = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  try {
    return g.getNewBoardState(size, opponent, true);
  } finally {
    Math.random = real;
  }
}
