// Run the same write as the browser page, under Node, against a wasm32-wasip1 build.
// Usage: node node-smoke.mjs <path to icechunk.wasip1.cjs>
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { writeRepo } from './write-repo.mjs'

const ic = createRequire(import.meta.url)(resolve(process.argv[2]))
const result = await writeRepo(ic, 'http://localhost:8000/')
console.log(JSON.stringify({ snapshotId: result.snapshotId, objects: result.objects.map(({ path, size }) => ({ path, size })) }, null, 2))
