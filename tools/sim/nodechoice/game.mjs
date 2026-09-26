// The nodechoice bundle, importable from node: the game's own Bladeburner,
// Sleeve and Player classes. Pulled in with a dynamic import so it evaluates
// strictly after env.mjs has built the DOM (CLAUDE.md, the load-order traps).
import "./env.mjs";

const game = await import("./game.bundle.mjs");
// The formatters the game builds on its settings event (ui/formatNumber.ts:30).
game.FormatsNeedToChange.emit();

/** Point the node multipliers at BitNode n (the game's own table). */
export function setBitNode(n, level = 1) {
  const m = game.getBitNodeMultipliers(n, level);
  game.replaceCurrentNodeMults(m);
  return m;
}

export default game;
