import { createMemoryStorage } from './memory-storage.mjs'

const encode = (value) => new TextEncoder().encode(JSON.stringify(value))

/**
 * Write a small repository into in-memory storage and return every stored object.
 *
 * The repository holds a root group, and an int32 array `temperature` of 12 elements in
 * 3 chunks of 4: chunk 0 is written as bytes, chunks 1 and 2 are virtual references to
 * `${chunkBaseUrl}chunks.bin` (bytes 0-15 and 16-31).
 *
 * @param {object} ic - the icechunk module (`Storage`, `Repository`)
 * @param {string} chunkBaseUrl - HTTP prefix the virtual chunks live under, ending in `/`
 */
export async function writeRepo(ic, chunkBaseUrl) {
  const { storage, objects } = createMemoryStorage(ic.Storage)
  const config = {
    virtualChunkContainers: {
      [chunkBaseUrl]: {
        urlPrefix: chunkBaseUrl,
        store: { type: 'Http', field0: { opts: {}, headers: {} } },
      },
    },
  }
  const repo = await ic.Repository.create(storage, config, null, {
    [chunkBaseUrl]: { type: 'HttpAccess' },
  })
  const session = await repo.writableSession('main')
  const store = session.store

  await store.set('zarr.json', encode({ zarr_format: 3, node_type: 'group', attributes: {} }))
  await store.set(
    'temperature/zarr.json',
    encode({
      zarr_format: 3,
      node_type: 'array',
      shape: [12],
      data_type: 'int32',
      chunk_grid: { name: 'regular', configuration: { chunk_shape: [4] } },
      chunk_key_encoding: { name: 'default', configuration: { separator: '/' } },
      fill_value: 0,
      codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
      attributes: { written_by: 'icechunk wasm32-wasip1 (single-threaded)' },
    }),
  )
  await store.set('temperature/c/0', new Uint8Array(new Int32Array([0, 1, 2, 3]).buffer))
  const url = `${chunkBaseUrl}chunks.bin`
  await store.setVirtualRef('temperature/c/1', url, 0, 16, null, null, true)
  await store.setVirtualRef('temperature/c/2', url, 16, 16, null, null, true)

  const snapshotId = await session.commit('written in a page without cross-origin isolation')

  const toBase64 = (bytes) => {
    let s = ''
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s)
  }
  return {
    snapshotId,
    objects: [...objects]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, obj]) => ({ path, size: obj.data.length, base64: toBase64(obj.data) })),
  }
}
