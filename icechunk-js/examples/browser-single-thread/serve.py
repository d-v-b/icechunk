"""Static file server with HTTP Range support and no COOP/COEP headers.

`python -m http.server` ignores Range, so virtual chunks served by it can't be read.
Usage: python serve.py <directory> [port]
"""

import functools
import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class RangeHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        match = re.fullmatch(r"bytes=(\d+)-(\d*)", self.headers.get("Range", ""))
        path = self.translate_path(self.path)
        if not match or not os.path.isfile(path):
            return super().send_head()
        size = os.path.getsize(path)
        start = int(match[1])
        end = min(int(match[2]) if match[2] else size - 1, size - 1)
        if start > end:
            self.send_error(416)
            return None
        f = open(path, "rb")
        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        return _Limited(f, end - start + 1)


class _Limited:
    """A file object that stops after `remaining` bytes, for `copyfile`."""

    def __init__(self, f, remaining):
        self.f, self.remaining = f, remaining

    def read(self, n=-1):
        n = self.remaining if n < 0 else min(n, self.remaining)
        data = self.f.read(n)
        self.remaining -= len(data)
        return data

    def close(self):
        self.f.close()


if __name__ == "__main__":
    directory = sys.argv[1]
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8000
    handler = functools.partial(RangeHandler, directory=directory)
    ThreadingHTTPServer(("localhost", port), handler).serve_forever()
