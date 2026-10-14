/**
 * In-memory Icechunk storage implemented in JS, for `Storage.newCustom`.
 *
 * Objects live in a `Map` from path to `{ data, etag, lastModified }`, so a caller can dump
 * the written repository afterwards. Conditional writes follow the ETag semantics Icechunk
 * expects from object stores: a `previousVersion` with an etag must match the stored one, and a
 * `previousVersion` without one means "create only".
 */
export function createMemoryStorage(Storage) {
  const objects = new Map()
  let counter = 0
  const nextEtag = () => `"${(++counter).toString(16)}"`
  const notFound = (path) => new Error(`ObjectNotFound: ${path}`)

  const storage = Storage.newCustom({
    canWrite: async () => true,

    getObjectRange: async (_err, { path, rangeStart, rangeEnd }) => {
      const obj = objects.get(path)
      if (!obj) throw notFound(path)
      const data = obj.data.subarray(rangeStart ?? 0, rangeEnd ?? obj.data.length)
      return { data, version: { etag: obj.etag } }
    },

    putObject: async (_err, { path, data, previousVersion }) => {
      const current = objects.get(path)
      if (previousVersion) {
        const stale = previousVersion.etag
          ? current?.etag !== previousVersion.etag
          : current !== undefined
        if (stale) return { kind: 'not_on_latest_version' }
      }
      const etag = nextEtag()
      objects.set(path, { data: new Uint8Array(data), etag, lastModified: new Date() })
      return { kind: 'updated', newVersion: { etag } }
    },

    copyObject: async (_err, { from, to, version }) => {
      const src = objects.get(from)
      if (!src) throw notFound(from)
      if (version?.etag && src.etag !== version.etag) return { kind: 'not_on_latest_version' }
      const etag = nextEtag()
      objects.set(to, { data: src.data, etag, lastModified: new Date() })
      return { kind: 'updated', newVersion: { etag } }
    },

    // ids are relative to the prefix, like the object_store backends return them
    listObjects: async (_err, prefix) => {
      const dir = prefix.endsWith('/') ? prefix : `${prefix}/`
      return [...objects]
        .filter(([path]) => path.startsWith(dir))
        .map(([path, obj]) => ({
          id: path.slice(dir.length),
          createdAt: obj.lastModified,
          sizeBytes: obj.data.length,
        }))
    },

    deleteBatch: async (_err, { prefix, batch }) => {
      const dir = prefix.endsWith('/') ? prefix : `${prefix}/`
      let deletedObjects = 0
      let deletedBytes = 0
      for (const { id, size } of batch) {
        if (objects.delete(dir + id)) {
          deletedObjects += 1
          deletedBytes += size
        }
      }
      return { deletedObjects, deletedBytes }
    },

    getObjectLastModified: async (_err, path) => {
      const obj = objects.get(path)
      if (!obj) throw notFound(path)
      return obj.lastModified
    },

    getObjectConditional: async (_err, { path, previousVersion }) => {
      const obj = objects.get(path)
      if (!obj) throw notFound(path)
      if (previousVersion?.etag === obj.etag) return { kind: 'on_latest_version' }
      return { kind: 'modified', data: obj.data, newVersion: { etag: obj.etag } }
    },
  })

  return { storage, objects }
}
