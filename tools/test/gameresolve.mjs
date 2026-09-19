// Make Netscript's import spelling work under node.
//
//   import './gameresolve.mjs'                  // side-effect, before any import
//   const m = await import('./augplan.js')
//
// In the game every script lives on one flat filesystem, so `import { x } from
// 'installgate.js'` is how a root module is reached. Node sees that as a bare
// specifier and throws ERR_MODULE_NOT_FOUND. The usual workaround is to write a
// relative path in the staged file and change it on deploy — which means the
// file that was tested is not the file that ships, and this repo has already
// been bitten by "the fix looked applied and simply had no effect".
//
// So instead the staged file carries the DEPLOYED spelling and this hook
// resolves it: any bare `<name>.js` that exists at the repo root resolves
// there. Anything else — 'ws', 'node:fs', './sibling.js' — falls through
// untouched.
//
// node:module's registerHooks is synchronous and in-thread (Node >= 22.15), so
// this needs no loader thread and no --import flag.

import { registerHooks } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// '../..' because this now lives at tools/test/, not tools/staging/augplan/.
// It was '../../..' while staged, and moving the file without moving this line
// silently turned every bare specifier into ERR_MODULE_NOT_FOUND — the hook was
// registered and simply resolved nothing.
export const REPO_ROOT = path.resolve(HERE, '../..')

const BARE_GAME_MODULE = /^[A-Za-z0-9_-]+\.js$/

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (BARE_GAME_MODULE.test(specifier)) {
      const p = path.join(REPO_ROOT, specifier)
      if (fs.existsSync(p)) return { url: pathToFileURL(p).href, shortCircuit: true }
      // NOT an error: `decimal.js`, `raf.js` and friends are real npm packages
      // whose names happen to end in `.js`, and jsdom requires them. Falling
      // through leaves node's own ERR_MODULE_NOT_FOUND to report a genuinely
      // missing module, which is loud enough and names the specifier.
    }
    return nextResolve(specifier, context)
  },
})
