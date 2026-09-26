// The money-read scanner behind [W1] (wealth.test.mjs). Not a check itself —
// named without `.test.mjs` so the runner does not import it as one.
//
// A "money read" is any read of the PLAYER'S CASH in a root script:
//   ns.getServerMoneyAvailable('home'), ns.getPlayer().money (and ?.() forms),
//   player.money / player?.money, and `<v>.money` where the file binds <v> to
//   ns.getPlayer() or to act.js's state.player.
// Comments are stripped first (a line that only MENTIONS the call is not a
// read); string contents are kept, so a read inside a template still counts.
import fs from "node:fs";
import path from "node:path";

/** Replace comments with spaces, keeping line numbers and string contents. */
export function stripComments(src) {
  let out = "";
  let i = 0;
  let mode = null; // null | "'" | '"' | "`" | "line" | "block"
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === "line") {
      if (c === "\n") {
        mode = null;
        out += c;
      } else out += " ";
      i++;
      continue;
    }
    if (mode === "block") {
      if (c === "*" && n === "/") {
        mode = null;
        out += "  ";
        i += 2;
        continue;
      }
      out += c === "\n" ? c : " ";
      i++;
      continue;
    }
    if (mode) {
      out += c;
      if (c === "\\") {
        out += n ?? "";
        i += 2;
        continue;
      }
      if (c === mode) mode = null;
      i++;
      continue;
    }
    if (c === "/" && n === "/") {
      mode = "line";
      out += "  ";
      i += 2;
      continue;
    }
    if (c === "/" && n === "*") {
      mode = "block";
      out += "  ";
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") mode = c;
    out += c;
    i++;
  }
  return out;
}

const BASE = [/getServerMoneyAvailable\(\s*['"]home['"]\s*\)/, /getPlayer\??\.?\(\)\??\.money\b/, /\bplayer\??\.money\b/];

/** Every cash read in the root scripts: [{file, line, text}]. */
export function scanMoneyReads(root) {
  const hits = [];
  const files = fs.readdirSync(root).filter((f) => f.endsWith(".js")).sort();
  for (const f of files) {
    const code = stripComments(fs.readFileSync(path.join(root, f), "utf8"));
    const pats = [...BASE];
    for (const m of code.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:ns\.getPlayer\??\.?\(\)|s\.player)(?!\w)/g)) {
      if (m[1] !== "player") pats.push(new RegExp(`\\b${m[1]}\\??\\.money\\b`));
    }
    code.split("\n").forEach((line, k) => {
      if (pats.some((p) => p.test(line))) hits.push({ file: f, line: k + 1, text: line.trim() });
    });
  }
  return { files: files.length, hits };
}

/** A read on a line that already combines cash with the trader's book. */
export const isWealthLine = (text) => /\bstockEquity\b|\bequity\b|\bwealthOf\b|\bwealth\b|\bstockNow\b/.test(text);
