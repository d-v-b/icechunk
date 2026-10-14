# Single-threaded wasm in a page without cross-origin isolation

The published wasm build (`wasm32-wasip1-threads`) runs Tokio in Web Workers and shares
memory with them through `SharedArrayBuffer`. Browsers only expose `SharedArrayBuffer` to
cross-origin-isolated pages, so that build needs the page to send
`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.
Static hosts such as GitHub Pages can't send them.

This example builds the bindings for plain `wasm32-wasip1` instead: one thread, no
`SharedArrayBuffer`, no workers. `#[napi] async fn` futures are polled from the JS event loop
by a small napi `AsyncRuntime` backend (`src/st_runtime.rs`). The page writes a repository into
an in-memory JS storage: a group, an int32 array with one chunk written as bytes and two virtual
references to an HTTP URL, then a commit. It reports `crossOriginIsolated` (expected `false`).

## Build

Needs a wasm-capable clang (for zstd's C sources) and emnapi 2, which ships the non-threaded
`libemnapi-basic-napi-rs.a` archive. emnapi 1.x only has threaded napi-rs archives.

```sh
cd icechunk-js
npm install --no-save emnapi@2.0.0-beta.1 @emnapi/core@2.0.0-beta.1 @emnapi/runtime@2.0.0-beta.1 esbuild
CC_wasm32_wasip1=clang AR_wasm32_wasip1=llvm-ar CFLAGS_wasm32_wasip1=-nostdlibinc \
  npx napi build --platform --release --target wasm32-wasip1 --output-dir dist-wasip1
mkdir -p site && cp examples/browser-single-thread/{index.html,write-repo.mjs,memory-storage.mjs} site/
node examples/browser-single-thread/bundle.mjs dist-wasip1 site
```

`bundle.mjs` swaps the generated loader's emnapi plugins for the ones in `@emnapi/core` 2 (the
napi-rs CLI 3.10 loader takes them from `@napi-rs/wasm-runtime` 1.x, which targets emnapi 1)
and bundles everything into `site/icechunk.js` next to the wasm.

## Run and check

```sh
python3 -c "import struct; open('site/chunks.bin','wb').write(struct.pack('<8i', *range(4, 12)))"
python3 examples/browser-single-thread/serve.py site 8000 &   # no COOP/COEP, supports Range
node examples/browser-single-thread/run-page.mjs http://localhost:8000/index.html repo-out
python examples/browser-single-thread/read_back.py repo-out http://localhost:8000/
```

`run-page.mjs` drives headless Chromium with Playwright and saves the stored objects to
`repo-out`. `read_back.py` opens them with Python icechunk and reads the array:
`[0, 1, …, 11]`, where 4–11 come from the virtual references. `node-smoke.mjs` runs the same
write under Node against `icechunk.wasip1.cjs`.

## What single-threaded wasm gives up

- No parallelism: decoding, compression and storage calls interleave on the page's thread,
  so large commits block it while they run.
- Retry backoff doesn't wait: no timer is reachable from icechunk core, so retries run back
  to back (`icechunk::compat::sleep`).
- Manifest preloading, a detached background task, is skipped.
- Anything that blocks a thread (napi's `block_on`) fails with an error.
