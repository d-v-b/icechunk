// Bundle the napi-generated wasm32-wasip1 browser loader into one ES module next to the wasm.
//
// Usage: node bundle.mjs <napi output dir> <site dir>
// Needs esbuild, and @napi-rs/wasm-runtime + @emnapi/{core,runtime} v2 resolvable from the
// napi output dir.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

const [napiDir, siteDir] = process.argv.slice(2).map((p) => resolve(p))

// napi-rs CLI 3.10 wires up emnapi's async-work and thread-safe-function plugins from
// @napi-rs/wasm-runtime 1.x, which are written against emnapi 1's plugin context. The
// non-threaded archive (`libemnapi-basic-napi-rs.a`) only ships with emnapi 2, whose
// @emnapi/core carries matching plugins, so the loader takes them from there instead.
const loader = readFileSync(join(napiDir, 'icechunk.wasip1-browser.js'), 'utf8')
const patched = loader
  .replace(
    "import { createContext as __emnapiCreateContext } from '@emnapi/runtime'",
    "import { createContext as __emnapiCreateContext } from '@emnapi/runtime'\n" +
      "import { asyncWork as __emnapiCoreAsyncWork, tsfn as __emnapiCoreTSFN } from '@emnapi/core/plugins'",
  )
  .replace(
    '      __emnapiAsyncWorkPlugin,\n      __emnapiTSFNPlugin,\n',
    '      __emnapiCoreAsyncWork,\n      __emnapiCoreTSFN,\n',
  )
if (!patched.includes('__emnapiCoreTSFN,')) throw new Error('loader layout changed; patch not applied')
const entry = join(napiDir, 'icechunk.wasip1-browser.patched.js')
writeFileSync(entry, patched)

await build({
  entryPoints: [entry],
  outfile: join(siteDir, 'icechunk.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
})
copyFileSync(join(napiDir, 'icechunk.wasm32-wasip1.wasm'), join(siteDir, 'icechunk.wasm32-wasip1.wasm'))
