// [SC] No root script references an identifier that does not exist.
//
// THE BUG THIS EXISTS FOR, in production, on 2026-09-20:
//
//   ReferenceError: node is not defined
//       at act (home/progress.js:1594:44)
//
// progress.js is the planner. `karmaChannelCtx(ns, info, player, node)` was
// called with a fourth argument that is not in scope at the call site, and
// every pass of the planner threw before it could do anything. The function
// itself has a try/catch that degrades to `{gangPending:false}` — useless,
// because the throw happened at the CALL, outside it.
//
// Nothing in this repo could have caught it. `node --check` parses and does
// not resolve; the RAM checker walks the AST for ns member expressions and
// does not care about scope; every behavioural test imports pure modules, and
// this line lives in the ns-bound half of progress.js that no test imports.
// So it shipped, and the only thing that noticed was the game.
//
// This check resolves every identifier reference in every root script against
// the scope chain it actually sits in. It is deliberately a SCOPE check and
// not a linter: it does not care about style, unused bindings, or shadowing.
//
// WHAT IT DOES NOT CATCH
//   * A name that exists but holds the wrong value. Scope is not types.
//   * `globalThis.foo` / `window.foo` — member access is not a reference.
//   * Anything reached only through eval or a computed property.
//   * A genuinely global browser API not in GLOBALS below reads as a failure;
//     that is the intended direction. Add it to the list WITH a reason, since
//     Netscript scripts have no business reaching for most of them.

import { Check } from "./harness.mjs";
import { load, rootScripts, source, parseModule } from "./ram.mjs";

// Standard library and the handful of host globals a Netscript module may see.
// Deliberately short: this list is the definition of "exists without being
// declared", so every addition widens what the check will accept.
const GLOBALS = new Set([
  "globalThis", "undefined", "NaN", "Infinity",
  "Object", "Array", "Function", "Boolean", "Number", "String", "Symbol", "BigInt",
  "Math", "JSON", "Date", "RegExp", "Error", "TypeError", "RangeError", "SyntaxError", "EvalError", "ReferenceError", "URIError",
  "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "Promise", "Proxy", "Reflect",
  "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array",
  "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array", "ArrayBuffer", "SharedArrayBuffer", "DataView",
  "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURI", "encodeURIComponent", "decodeURI", "decodeURIComponent",
  "console", "structuredClone", "queueMicrotask", "Intl", "AggregateError", "atob", "btoa",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  // The game runs scripts in the browser; a few files legitimately reach the
  // DOM (infiltration helpers read the screen).
  "window", "document", "navigator", "performance", "fetch", "URL", "Blob", "eval",
  // localStorage: bitNodeMultipliers.js and common.js cache across script
  // restarts through it — the game runs in a browser and this is the only
  // storage that survives a kill. KeyboardEvent: deepscan.js synthesises key
  // presses to drive the terminal.
  "localStorage", "sessionStorage", "KeyboardEvent",
]);

/* -------------------------------------------------------------------------
 * A small scope analyser. Acorn gives an ESTree AST; this walks it, building
 * scopes and collecting references, then resolves each reference against the
 * chain it was seen in.
 */
const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

function analyse(ast) {
  const refs = []; // {name, scope, line}
  const moduleScope = { vars: new Set(), parent: null, fn: true };

  /** Bind every name a binding pattern introduces. */
  function declarePattern(node, scope) {
    if (!node) return;
    switch (node.type) {
      case "Identifier":
        scope.vars.add(node.name);
        break;
      case "ObjectPattern":
        for (const p of node.properties) {
          if (p.type === "RestElement") declarePattern(p.argument, scope);
          else {
            // A computed key is an expression evaluated in the OUTER scope.
            if (p.computed) walk(p.key, scope);
            declarePattern(p.value, scope);
          }
        }
        break;
      case "ArrayPattern":
        for (const el of node.elements) declarePattern(el, scope);
        break;
      case "AssignmentPattern":
        declarePattern(node.left, scope);
        walk(node.right, scope); // the default is an expression
        break;
      case "RestElement":
        declarePattern(node.argument, scope);
        break;
      default:
        walk(node, scope);
    }
  }

  /** `var` and function declarations hoist to the nearest function scope. */
  const fnScope = (scope) => {
    let s = scope;
    while (s && !s.fn) s = s.parent;
    return s ?? moduleScope;
  };

  /** Hoist declarations visible throughout `body` before walking it. */
  function hoist(body, scope) {
    for (const st of body) {
      if (!st) continue;
      if (st.type === "FunctionDeclaration" && st.id) scope.vars.add(st.id.name);
      else if (st.type === "ClassDeclaration" && st.id) scope.vars.add(st.id.name);
      else if (st.type === "VariableDeclaration") {
        for (const d of st.declarations) declarePattern(d.id, st.kind === "var" ? fnScope(scope) : scope);
      } else if (st.type === "ImportDeclaration") {
        for (const sp of st.specifiers) scope.vars.add(sp.local.name);
      } else if (st.type === "ExportNamedDeclaration" && st.declaration) {
        hoist([st.declaration], scope);
      } else if (st.type === "ExportDefaultDeclaration" && st.declaration?.id) {
        scope.vars.add(st.declaration.id.name);
      }
      // `var` nested inside blocks/loops also hoists to the function scope.
      if (st.type !== "FunctionDeclaration" && !FUNCTION_TYPES.has(st.type)) hoistNestedVars(st, scope);
    }
  }

  function hoistNestedVars(node, scope) {
    if (!node || typeof node !== "object") return;
    if (FUNCTION_TYPES.has(node.type)) return; // a new function scope owns its vars
    if (node.type === "VariableDeclaration" && node.kind === "var") {
      for (const d of node.declarations) declarePattern(d.id, fnScope(scope));
    }
    for (const k of Object.keys(node)) {
      if (k === "type" || k === "loc" || k === "range" || k === "start" || k === "end") continue;
      const v = node[k];
      if (Array.isArray(v)) for (const c of v) hoistNestedVars(c, scope);
      else if (v && typeof v.type === "string") hoistNestedVars(v, scope);
    }
  }

  function walk(node, scope) {
    if (!node || typeof node !== "object") return;
    switch (node.type) {
      case "Identifier":
        refs.push({ name: node.name, scope, pos: node.start });
        return;
      case "MemberExpression":
        walk(node.object, scope);
        if (node.computed) walk(node.property, scope);
        return;
      case "Property":
        if (node.computed) walk(node.key, scope);
        walk(node.value, scope);
        return;
      case "PropertyDefinition":
      case "MethodDefinition":
        if (node.computed) walk(node.key, scope);
        walk(node.value, scope);
        return;
      case "LabeledStatement":
        walk(node.body, scope);
        return;
      case "BreakStatement":
      case "ContinueStatement":
        return;
      case "ImportDeclaration":
      case "ExportAllDeclaration":
        return;
      case "ExportNamedDeclaration":
        // `export { a as b }` with no source: `a` is a real reference.
        if (node.declaration) walk(node.declaration, scope);
        else if (!node.source) for (const sp of node.specifiers) walk(sp.local, scope);
        return;
      case "MetaProperty":
        return;
      default:
        break;
    }

    if (FUNCTION_TYPES.has(node.type)) {
      const inner = { vars: new Set(), parent: scope, fn: true };
      if (node.type !== "ArrowFunctionExpression") inner.vars.add("arguments");
      // A named function expression can refer to itself.
      if (node.id && node.type === "FunctionExpression") inner.vars.add(node.id.name);
      for (const p of node.params) declarePattern(p, inner);
      if (node.body.type === "BlockStatement") {
        hoist(node.body.body, inner);
        for (const st of node.body.body) walk(st, inner);
      } else {
        walk(node.body, inner);
      }
      return;
    }

    if (node.type === "BlockStatement") {
      const inner = { vars: new Set(), parent: scope, fn: false };
      hoist(node.body, inner);
      for (const st of node.body) walk(st, inner);
      return;
    }

    if (node.type === "CatchClause") {
      const inner = { vars: new Set(), parent: scope, fn: false };
      if (node.param) declarePattern(node.param, inner);
      hoist(node.body.body, inner);
      for (const st of node.body.body) walk(st, inner);
      return;
    }

    if (node.type === "ForStatement" || node.type === "ForInStatement" || node.type === "ForOfStatement") {
      const inner = { vars: new Set(), parent: scope, fn: false };
      const init = node.init ?? node.left;
      if (init?.type === "VariableDeclaration") {
        for (const d of init.declarations) {
          declarePattern(d.id, init.kind === "var" ? fnScope(scope) : inner);
          if (d.init) walk(d.init, inner);
        }
      } else if (init) walk(init, inner);
      if (node.right) walk(node.right, inner);
      if (node.test) walk(node.test, inner);
      if (node.update) walk(node.update, inner);
      if (node.body?.type === "BlockStatement") {
        const b = { vars: new Set(), parent: inner, fn: false };
        hoist(node.body.body, b);
        for (const st of node.body.body) walk(st, b);
      } else walk(node.body, inner);
      return;
    }

    if (node.type === "VariableDeclaration") {
      for (const d of node.declarations) {
        declarePattern(d.id, node.kind === "var" ? fnScope(scope) : scope);
        if (d.init) walk(d.init, scope);
      }
      return;
    }

    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      if (node.id) scope.vars.add(node.id.name);
      const inner = { vars: new Set(), parent: scope, fn: false };
      if (node.id) inner.vars.add(node.id.name);
      if (node.superClass) walk(node.superClass, inner);
      for (const el of node.body.body) walk(el, inner);
      return;
    }

    for (const k of Object.keys(node)) {
      if (k === "type" || k === "loc" || k === "range" || k === "start" || k === "end") continue;
      const v = node[k];
      if (Array.isArray(v)) for (const c of v) walk(c, scope);
      else if (v && typeof v.type === "string") walk(v, scope);
    }
  }

  hoist(ast.body, moduleScope);
  for (const st of ast.body) walk(st, moduleScope);

  const unresolved = [];
  for (const r of refs) {
    if (GLOBALS.has(r.name)) continue;
    let s = r.scope;
    let found = false;
    while (s) {
      if (s.vars.has(r.name)) {
        found = true;
        break;
      }
      s = s.parent;
    }
    if (!found) unresolved.push(r);
  }
  return unresolved;
}

const lineOf = (code, pos) => code.slice(0, pos).split("\n").length;

export async function run() {
  const c = new Check("SC1", "every identifier a root script references actually exists in scope");
  // parseModule() comes out of the game bundle, and rootScripts() is empty
  // until it is loaded — a check that examines 0 files prints PASS, which is
  // the "fabricated validation" shape CLAUDE.md names. The guard below makes
  // that state a FAIL instead.
  await load();
  const scripts = rootScripts();
  let refsChecked = 0;

  for (const name of scripts) {
    let code;
    try {
      code = source(name);
    } catch {
      continue;
    }
    let ast;
    try {
      ast = parseModule(code);
    } catch (e) {
      c.fail(`${name} does not parse: ${e.message}`);
      continue;
    }
    c.examined(1);
    let unresolved;
    try {
      unresolved = analyse(ast);
    } catch (e) {
      // A walker that throws is a broken check, not a clean file. Say so.
      c.fail(`${name}: the scope analyser threw — ${e.message}`, "this check cannot vouch for this file");
      continue;
    }
    refsChecked++;
    // Deduplicate by name: one line per missing identifier is enough to fix it.
    const seen = new Map();
    for (const u of unresolved) if (!seen.has(u.name)) seen.set(u.name, u);
    for (const [ident, u] of seen) {
      c.fail(
        `${name}:${lineOf(code, u.pos)} references \`${ident}\`, which is not declared in any enclosing scope`,
        `This throws ReferenceError the moment the line runs. A try/catch INSIDE the function being called ` +
          `does not help: the throw happens at the call site. (progress.js shipped exactly this on 2026-09-20 ` +
          `and the planner was down until the game reported it.)`,
      );
    }
  }
  if (!refsChecked) c.fail("scope-resolved ZERO scripts", "the corpus was empty — this is a rotted check, not a clean repo");
  c.note(`${refsChecked} root script(s) fully scope-resolved against ${GLOBALS.size} permitted globals`);
  return [c];
}
