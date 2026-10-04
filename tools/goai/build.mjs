// Bundles the game's OWN IPvGO opponent (src/Go/boardAnalysis/goAI.ts and the
// board code under it) into a small standalone module the solver can call as
// an opponent model.
//
//   node tools/goai/build.mjs [--game ../bitburner]   -> tools/goai/goai.bundle.mjs
//
// Why the game's code and not a port: the opponent is the game's getMove, and
// a hand-port is exactly the "plausible simplification never checked against
// source" this repo keeps paying for (CLAUDE.md, Fidelity). Bundling it keeps
// the model bit-for-bit the opponent, at the price of a build step.
//
// What is stubbed, and why it does not change a single decision:
//   - utils/Utility.sleep -> an already-resolved promise. getMove awaits
//     waitCycle (200ms / 40ms) and patternMatching sleeps 10ms per column; those
//     are UI pacing (goAI.ts:877-883, patternMatching.ts:104), not logic.
//   - Go/Go.ts -> a plain object. The AI touches Go.storedCycles (pacing only)
//     and boardAnalysis's highlight helpers touch Go.currentGame/GoEvents (UI).
//   - @player -> totalPlaytime is only the RNG seed when no rngOverride is given;
//     the model ALWAYS passes one.
//   - scoring.ts / exceptionAlert -> passTurn's endGoGame path, which the model
//     never reaches (it never ends a game).
// Everything that decides a move — goAI.ts, boardAnalysis.ts, boardState.ts,
// controlledTerritory.ts, patternMatching.ts, Casino/RNG.ts (WHRNG) — is the
// game's source, unmodified.
//
// The bundle is gitignored like tools/sim/game.bundle.mjs; tools/goai/model.mjs
// builds it on first use when missing or older than the game source.

// esbuild is imported lazily (in build()): the solver imports this module for
// stale()/OUT, and a missing devDependency must cost the model, not the solver.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argGame = process.argv.indexOf("--game");
export const GAME = path.resolve(argGame > -1 ? process.argv[argGame + 1] : path.join(HERE, "../../../bitburner"));
export const OUT = path.join(HERE, "goai.bundle.mjs");
const GAME_REAL = fs.existsSync(GAME) ? fs.realpathSync(GAME) : GAME;

/** Source files whose change must trigger a rebuild. */
export const SOURCES = [
  "src/Go/boardAnalysis/goAI.ts",
  "src/Go/boardAnalysis/boardAnalysis.ts",
  "src/Go/boardAnalysis/controlledTerritory.ts",
  "src/Go/boardAnalysis/patternMatching.ts",
  "src/Go/boardState/boardState.ts",
  "src/Go/boardState/offlineNodes.ts",
  "src/Go/Constants.ts",
  "src/Casino/RNG.ts",
];

const ENTRY = `
export { getMove } from "${GAME}/src/Go/boardAnalysis/goAI";
export { getNewBoardStateFromSimpleBoard, makeMove, passTurn, updateChains } from "${GAME}/src/Go/boardState/boardState";
export { getAllValidMoves, simpleBoardFromBoard, evaluateIfMoveIsValid } from "${GAME}/src/Go/boardAnalysis/boardAnalysis";
export { opponentDetails } from "${GAME}/src/Go/Constants";
export { GoColor, GoOpponent, GoValidity, GoPlayType } from "${GAME}/src/Go/Enums";
`;

// Stubs, keyed by the resolved source path's tail.
const STUBS = {
  "src/utils/Utility": `export function sleep() { return Promise.resolve(); }`,
  "src/utils/helpers/exceptionAlert": `export function exceptionAlert(e) { throw e; }`,
  "src/Go/Go": `
    export const getEmptyHighlightedPoints = (size = 7) => Array.from({ length: size }, () => Array.from({ length: size }, () => null));
    export const Go = { currentGame: { board: [], previousBoards: [], passCount: 0, previousPlayer: null }, storedCycles: 0, stats: {} };
    export const GoEvents = { emit() {}, subscribe() { return () => {}; } };`,
  "src/Go/boardAnalysis/scoring": `
    export function endGoGame() { throw new Error("goai model: endGoGame reached — the model never ends a game"); }
    export function getScore() { throw new Error("goai model: getScore is not bundled"); }`,
  "src/Player": `export const Player = { totalPlaytime: 1, hasAugmentation: () => false, activeSourceFileLvl: () => 0, bitNodeN: 1 };`,
};

// SPEEDUPS: behaviour-identical rewrites of the two hottest spots, applied to
// the source text at bundle time. Profiled on 765 replies to real 5x5
// positions: checkMatch was 48.8% of the model's self time — it re-expands the
// 128 rotated/mirrored 3x3 patterns on every call and re-joins/splits each
// pattern for every board point. Here the expansion is computed once (it is a
// pure function of the constant pattern table) and each pattern's characters
// are split once. Same comparisons, same order, same result.
// Every `from` must be found verbatim or the build FAILS: a silent no-op here
// would leave a slow model; a partial edit could leave a wrong one.
// tools/goai/check.mjs asserts reply-for-reply identity with the full game.
// The second is getBoardCopy's structuredClone (18% after the first fix): a
// plain-object copy that preserves shared references exactly as structured
// cloning does (a point's `liberties` entries are the board's own points).
const SPEEDUPS = {
  // Third and fourth (9x9 profile: getAllNeighbors' reduce + getAllChains-find
  // ~45% of self time): the chain-id lookup in getAllNeighboringChains was a
  // linear allChains.find per neighbour, and isPointInChain a linear scan per
  // neighbour. Both become per-call hash lookups. The id map is rebuilt on
  // every call (never cached across calls: boards are mutated by updateChains),
  // keeps find()'s FIRST-match semantics, and a miss still adds a fresh [] each
  // time exactly as `|| []` did. Membership stays by coordinates, not identity
  // (callers pass chains from evaluation boards against the original board).
  "src/Go/boardAnalysis/boardAnalysis.ts": [
    {
      from: `  const neighboringChains = playerNeighbors.reduce(
    (neighborChains, neighbor) =>
      neighborChains.add(allChains.find((chain) => chain[0].chain === neighbor.chain) || []),
    new Set<PointState[]>(),
  );`,
      to: `  const byId = new Map<string, PointState[]>();
  for (const c of allChains) if (!byId.has(c[0].chain)) byId.set(c[0].chain, c);
  const neighboringChains = playerNeighbors.reduce(
    (neighborChains, neighbor) => neighborChains.add(byId.get(neighbor.chain) || []),
    new Set<PointState[]>(),
  );`,
    },
    {
      from: `  const allNeighbors = chain.reduce((chainNeighbors: Set<PointState>, point: PointState) => {
    getArrayFromNeighbor(findNeighbors(board, point.x, point.y))
      .filter((neighborPoint) => !isPointInChain(neighborPoint, chain))`,
      to: `  const inChain = new Set<number>();
  for (const p of chain) inChain.add(p.x * 4096 + p.y);
  const allNeighbors = chain.reduce((chainNeighbors: Set<PointState>, point: PointState) => {
    getArrayFromNeighbor(findNeighbors(board, point.x, point.y))
      .filter((neighborPoint) => !inChain.has(neighborPoint.x * 4096 + neighborPoint.y))`,
    },
  ],
  "src/Go/boardState/boardState.ts": [
    {
      from: `export function getBoardCopy(board: Board): Board {
  return structuredClone(board);
}`,
      to: `export function getBoardCopy(board: Board): Board {
  const seen = new Map<PointState, PointState>();
  const copy = (p: PointState | null | undefined): any => {
    if (p === null || p === undefined) return p;
    let c = seen.get(p);
    if (c) return c;
    c = { ...p };
    seen.set(p, c);
    if (p.liberties) c.liberties = p.liberties.map(copy);
    return c;
  };
  return board.map((column) => column.map(copy));
}`,
    },
  ],
  "src/Go/boardAnalysis/patternMatching.ts": [
    {
      from: "  const patterns = expandAllThreeByThreePatterns();",
      to: "  const patterns = (__goaiExpanded ??= expandAllThreeByThreePatterns());",
    },
    {
      from: `function checkMatch(neighborhood: (PointState | null)[][], pattern: string[], player: GoColor) {
  const patternArr = pattern.join("").split("");
  const neighborhoodArray = neighborhood.flat();
  return patternArr.every((str, index) => matches(str, neighborhoodArray[index], player));
}`,
      to: `let __goaiExpanded: string[][] | undefined;
const __goaiSplit = new Map<string[], string[]>();
function checkMatch(neighborhood: (PointState | null)[][], pattern: string[], player: GoColor) {
  let patternArr = __goaiSplit.get(pattern);
  if (!patternArr) {
    patternArr = pattern.join("").split("");
    __goaiSplit.set(pattern, patternArr);
  }
  for (let index = 0; index < 9; index++) {
    if (!matches(patternArr[index], neighborhood[(index / 3) | 0][index % 3], player)) return false;
  }
  return true;
}`,
    },
  ],
};

const speedupPlugin = {
  name: "goai-speedups",
  setup(build) {
    build.onLoad({ filter: /\.ts$/ }, (args) => {
      const rel = path.relative(GAME_REAL, args.path).replace(/\\/g, "/");
      const edits = SPEEDUPS[rel];
      if (!edits) return undefined;
      let src = fs.readFileSync(args.path, "utf8");
      for (const { from, to } of edits) {
        if (!src.includes(from)) throw new Error(`goai speedup: ${rel} no longer contains the text it rewrites — re-derive the speedup from the new source`);
        src = src.replace(from, to);
      }
      return { contents: src, loader: "ts" };
    });
  },
};

const stubPlugin = {
  name: "goai-stubs",
  setup(build) {
    build.onResolve({ filter: /^@player$/ }, () => ({ path: "src/Player", namespace: "goai-stub" }));
    // @enums is src/Enums.ts, which re-exports every subsystem's enums and
    // drags half the game in behind them. The Go code needs the Go enums and
    // AugmentationName/FactionName; re-export exactly those, from source.
    build.onResolve({ filter: /^@enums$/ }, () => ({ path: "@enums", namespace: "goai-enums" }));
    build.onLoad({ filter: /.*/, namespace: "goai-enums" }, () => ({
      contents:
        `export * from ${JSON.stringify(path.join(GAME, "src/Go/Enums.ts"))};\n` +
        `export { AugmentationName } from ${JSON.stringify(path.join(GAME, "src/Augmentation/Enums.ts"))};\n` +
        `export { FactionName } from ${JSON.stringify(path.join(GAME, "src/Faction/Enums.ts"))};\n`,
      loader: "ts",
      resolveDir: GAME,
    }));
    build.onResolve({ filter: /.*/ }, (args) => {
      if (process.env.GOAI_TRACE) console.error(`${args.importer} -> ${args.path}`);
      if (args.namespace === "goai-stub" || !args.resolveDir) return undefined;
      if (!args.path.startsWith(".")) return undefined;
      const abs = path.resolve(args.resolveDir, args.path);
      // esbuild hands us REAL paths; GAME may be a symlink (a worktree's sibling link).
      const rel = path.relative(GAME_REAL, abs).replace(/\\/g, "/").replace(/\.(ts|tsx)$/, "");
      if (STUBS[rel] !== undefined) return { path: rel, namespace: "goai-stub" };
      return undefined;
    });
    build.onLoad({ filter: /.*/, namespace: "goai-stub" }, (args) => ({ contents: STUBS[args.path], loader: "js" }));
  },
};

export async function build({ quiet = false } = {}) {
  if (!fs.existsSync(path.join(GAME, "src/Go/boardAnalysis/goAI.ts"))) {
    throw new Error(`no bitburner source at ${GAME} — pass --game <path to bitburner-src checkout>`);
  }
  const entryFile = path.join(HERE, ".entry.generated.ts");
  fs.writeFileSync(entryFile, ENTRY);
  try {
    const { default: esbuild } = await import("esbuild");
    const result = await esbuild.build({
      entryPoints: [entryFile],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile: OUT,
      plugins: [stubPlugin, speedupPlugin],
      logLevel: quiet ? "silent" : "error",
      metafile: true,
    });
    const inputs = Object.keys(result.metafile.inputs);
    if (!quiet) console.log(`goai: bundled ${inputs.length} modules -> ${path.relative(process.cwd(), OUT)} (${fs.statSync(OUT).size} bytes)`);
    return { modules: inputs.length, inputs, out: OUT };
  } finally {
    fs.rmSync(entryFile, { force: true });
  }
}

/** True when the bundle is missing or older than any source it was built from. */
export function stale() {
  if (!fs.existsSync(OUT)) return true;
  const t = fs.statSync(OUT).mtimeMs;
  return SOURCES.some((s) => {
    const p = path.join(GAME, s);
    return fs.existsSync(p) && fs.statSync(p).mtimeMs > t;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) await build();
