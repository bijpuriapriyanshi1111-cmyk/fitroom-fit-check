#!/usr/bin/env python3
"""
A tiny web server for FitRoom Fit Check. start.command runs this.

It does the same job as `python3 -m http.server`, with two differences:
  1. It tells the browser never to keep old copies of the files, so a normal refresh
     always shows the latest version (the plain server lets browsers show stale files).
  2. It only answers on this computer (127.0.0.1), so nobody else on your wifi can open it.

Usage:  python3 serve.py [port]      (the default port is 8765)
"""
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))      # serve the folder this file is in
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler)
    print("Serving FitRoom Fit Check at http://localhost:%d" % port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
