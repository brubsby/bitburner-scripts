// [TDZ] no function's top-level statement reads a let/const declared LATER at
// that same level — a ReferenceError ("Cannot access 'x' before
// initialization") the moment the statement runs. Twice on 2026-09-25 a
// hoisted block in progress.js act() read `pending`, then `count`, before
// their declarations; nothing in the suite executes act(), so both went live.
// Reads inside nested functions are exempt (they run later); so are
// declarations the reader shadows. Every function in the root scripts listed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Check } from "./harness.mjs";
import { load, parseModule } from "./ram.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FILES = ["progress.js", "act.js", "sleeve.js", "sleeveaug.js", "gang.js", "hacknet.js", "buyserv.js", "watchdog.js", "endgame.js", "upkeep.js", "cmd.js"];

const isFn = (n) => n && (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression");

/** Names a block declares with let/const/class/function (it shadows them). */
function blockDecls(stmts) {
  const names = new Set();
  for (const st of stmts ?? []) {
    if (st.type === "VariableDeclaration" && st.kind !== "var") for (const d of st.declarations) collectPattern(d.id, names);
    if ((st.type === "FunctionDeclaration" || st.type === "ClassDeclaration") && st.id) names.add(st.id.name);
  }
  return names;
}
function collectPattern(p, names) {
  if (!p) return;
  if (p.type === "Identifier") names.add(p.name);
  else if (p.type === "ObjectPattern") p.properties.forEach((x) => collectPattern(x.value ?? x.argument, names));
  else if (p.type === "ArrayPattern") p.elements.forEach((x) => collectPattern(x, names));
  else if (p.type === "RestElement") collectPattern(p.argument, names);
  else if (p.type === "AssignmentPattern") collectPattern(p.left, names);
}

/** Identifiers READ eagerly in `node`: not inside nested functions, not a
 *  declaration's own name, not a name an inner block shadows. */
function eagerReads(node, out = [], shadowed = new Set()) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const x of node) eagerReads(x, out, shadowed);
    return out;
  }
  if (isFn(node)) return out;
  if (node.type === "Identifier") {
    if (!shadowed.has(node.name)) out.push(node);
    return out;
  }
  let inner = shadowed;
  if ((node.type === "BlockStatement" || node.type === "Program" || node.type === "StaticBlock") && Array.isArray(node.body)) {
    const own = blockDecls(node.body);
    if (own.size) inner = new Set([...shadowed, ...own]);
  }
  if ((node.type === "ForStatement" || node.type === "ForOfStatement" || node.type === "ForInStatement") && (node.init ?? node.left)?.type === "VariableDeclaration") {
    const own = new Set();
    for (const d of (node.init ?? node.left).declarations) collectPattern(d.id, own);
    inner = new Set([...shadowed, ...own]);
  }
  if (node.type === "CatchClause" && node.param) {
    const own = new Set();
    collectPattern(node.param, own);
    inner = new Set([...shadowed, ...own]);
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
    if (node.type === "MemberExpression" && k === "property" && !node.computed) continue;
    if (node.type === "Property" && k === "key" && !node.computed) continue;
    if (node.type === "VariableDeclarator" && k === "id") continue;
    if (v && typeof v === "object") eagerReads(v, out, inner);
  }
  return out;
}

let SRC = "";
const lineOf = (pos) => SRC.slice(0, pos).split("\n").length;
function checkBody(body, file, fails) {
  const decls = new Map(); // name -> index of the top-level statement declaring it
  body.forEach((st, i) => {
    if (st.type === "VariableDeclaration" && st.kind !== "var") for (const d of st.declarations) if (d.id.type === "Identifier") decls.set(d.id.name, i);
  });
  body.forEach((st, i) => {
    for (const id of eagerReads(st)) {
      const at = decls.get(id.name);
      if (at !== undefined && at > i) fails.push(`${file}:${lineOf(id.start)} reads '${id.name}' before its declaration at line ${lineOf(body[at].start)}`);
    }
  });
  // Recurse into every function body.
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (isFn(n) && n.body?.type === "BlockStatement") checkBody(n.body.body, file, fails);
    for (const [k, v] of Object.entries(n)) if (k !== "type" && v && typeof v === "object") walk(v);
  };
  body.forEach((st) => walk(st));
}

export async function run() {
  await load();
  const c = new Check("TDZ1", "no function reads a let/const before its declaration at the same level");
  let n = 0;
  for (const f of FILES) {
    const p = path.join(REPO, f);
    if (!fs.existsSync(p)) continue;
    SRC = fs.readFileSync(p, "utf8");
    const ast = parseModule(SRC);
    const fails = [];
    // Only function bodies: module top level is initialised before main runs.
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (isFn(node) && node.body?.type === "BlockStatement") {
        checkBody(node.body.body, f, fails);
        return;
      }
      for (const [k, v] of Object.entries(node)) if (k !== "type" && v && typeof v === "object") walk(v);
    };
    walk(ast.body);
    n++;
    for (const x of [...new Set(fails)]) c.fail(x);
  }
  c.examined(n);
  if (!n) c.fail("no file examined");
  return [c];
}
