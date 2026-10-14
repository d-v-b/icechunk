"""Open the repository the browser page wrote, with Python icechunk.

Usage: python read_back.py <directory holding the saved objects> <chunk base URL>

The chunk base URL must serve `chunks.bin` (the page's own server does) for the
virtual chunks to resolve.
"""

import json
import sys

import icechunk
import zarr

repo_dir, base_url = sys.argv[1], sys.argv[2]

config = icechunk.RepositoryConfig.default()
config.set_virtual_chunk_container(
    icechunk.VirtualChunkContainer(base_url, icechunk.http_store())
)
repo = icechunk.Repository.open(
    icechunk.local_filesystem_storage(repo_dir),
    config=config,
    authorize_virtual_chunk_access={base_url: None},
)
session = repo.readonly_session("main")
array = zarr.open_array(session.store, path="temperature", mode="r")

refs = sorted(session.all_virtual_chunk_locations())
history = [(s.id, s.message) for s in repo.ancestry(branch="main")]
print(
    json.dumps(
        {
            "spec_version": repo.spec_version,
            "ancestry": history,
            "array_metadata": array.metadata.to_dict(),
            "virtual_chunk_locations": refs,
            "values": array[:].tolist(),
        },
        indent=2,
        default=str,
    )
)
