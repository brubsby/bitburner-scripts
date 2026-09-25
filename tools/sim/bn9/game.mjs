// The bn9 bundle, importable from node. The bundle is pulled in with a
// dynamic import so it evaluates strictly after env.mjs has built the DOM.
import "./env.mjs";

const game = await import("./game.bundle.mjs");

/** Point the node multipliers at BitNode n (the game's own table). */
export function setBitNode(n, level = 1) {
  const m = game.getBitNodeMultipliers(n, level);
  game.replaceCurrentNodeMults(m);
  return m;
}

export default game;
