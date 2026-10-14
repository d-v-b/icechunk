// Load index.html in headless Chromium and save the repository it writes.
//
// Usage: node run-page.mjs <page url> <output dir>
// The page's server must not send COOP/COEP headers; this script records the headers it got.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright'

const [url, outDir] = process.argv.slice(2)
// CHROMIUM_PATH picks a specific browser build instead of the one Playwright pins
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
const page = await browser.newPage()
const logs = []
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))

const response = await page.goto(url)
const headers = response.headers()
await page.waitForFunction(() => window.__result !== undefined, null, { timeout: 60_000 })
const result = await page.evaluate(() => window.__result)
await browser.close()

for (const { path, base64 } of result.objects ?? []) {
  const file = join(outDir, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, Buffer.from(base64, 'base64'))
}
console.log(
  JSON.stringify(
    {
      documentHeaders: {
        'cross-origin-opener-policy': headers['cross-origin-opener-policy'] ?? null,
        'cross-origin-embedder-policy': headers['cross-origin-embedder-policy'] ?? null,
      },
      env: result.env,
      ok: result.ok,
      error: result.error,
      snapshotId: result.snapshotId,
      objects: result.objects?.map(({ path, size }) => `${path} (${size} B)`),
      logs,
    },
    null,
    2,
  ),
)
