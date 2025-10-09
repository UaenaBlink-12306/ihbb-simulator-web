import os
import json
from typing import List, Dict, Any
from http.server import BaseHTTPRequestHandler, HTTPServer
import socket
from urllib.parse import urlparse

import requests


PORT = int(os.environ.get("IHBB_SERVER_PORT", "5057"))
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = os.environ.get("OPENROUTER_MODEL", "deepseek/deepseek-chat-v3.1:free")
SITE_URL = os.environ.get("OPENROUTER_SITE_URL", "")
SITE_NAME = os.environ.get("OPENROUTER_SITE_NAME", "")


def normalize(s: str) -> str:
    return " ".join("".join(ch.lower() if ch.isalnum() else " " for ch in (s or "")).split())


def basic_match(user: str, expected: str, aliases: List[str]) -> bool:
    nu = normalize(user)
    if not nu:
        return False
    if nu == normalize(expected):
        return True
    for a in aliases or []:
        if nu == normalize(a):
            return True
    return False


def grade_with_openrouter(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not OPENROUTER_API_KEY:
        return {
            "correct": basic_match(payload.get("user_answer", ""), payload.get("expected", ""), payload.get("aliases", [])),
            "reason": "OPENROUTER_API_KEY not set; used fallback matcher"
        }

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    if SITE_URL:
        headers["HTTP-Referer"] = SITE_URL
    if SITE_NAME:
        headers["X-Title"] = SITE_NAME

    system = (
        "You are a concise, strict grader for quiz-bowl short answers.\n"
        "Given the question (for context), the expected canonical answer and list of accepted aliases,\n"
        "decide if the user's short answer should be marked correct under strict academic rules.\n"
        "Ignore punctuation/casing; accept common synonyms and alias strings provided.\n"
        "If strict=true, require the key entity; partials that could map to multiple entities are incorrect.\n"
        "Reply ONLY as a compact JSON object: {\"correct\": true|false, \"reason\": string}."
    )

    user = {
        "question": payload.get("question", ""),
        "expected": payload.get("expected", ""),
        "aliases": payload.get("aliases", []),
        "user_answer": payload.get("user_answer", ""),
        "strict": bool(payload.get("strict", True)),
    }

    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
        ],
        "temperature": 0.0,
    }

    try:
        r = requests.post(OPENROUTER_URL, headers=headers, json=body, timeout=20)
        r.raise_for_status()
        data = r.json()
        content = data["choices"][0]["message"]["content"] if data.get("choices") else ""
        # Extract JSON
        start = content.find("{")
        end = content.rfind("}")
        if start != -1 and end != -1 and end > start:
            obj = json.loads(content[start:end+1])
            return {"correct": bool(obj.get("correct", False)), "reason": str(obj.get("reason", ""))}
    except Exception:
        pass

    # Fallback
    return {
        "correct": basic_match(user.get("user_answer", ""), user.get("expected", ""), user.get("aliases", [])),
        "reason": "LLM grading unavailable; used fallback matcher"
    }


BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def guess_type(path: str) -> str:
    ext = os.path.splitext(path)[1].lower()
    return {
        ".html": "text/html; charset=utf-8",
        ".htm": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".mjs": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".txt": "text/plain; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".ico": "image/x-icon",
    }.get(ext, "application/octet-stream")


def safe_join(base: str, *paths: str) -> str:
    # Prevent directory traversal; resolve final path and ensure it stays within base
    joined = os.path.join(base, *paths)
    norm = os.path.normpath(joined)
    if not norm.startswith(os.path.abspath(base)):
        raise ValueError("Unsafe path")
    return norm


class Handler(BaseHTTPRequestHandler):
    def _set_headers(self, code=200, content_type="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        # CORS
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS, GET")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers(204)

    def do_GET(self):
        parsed = urlparse(self.path)
        # Health check
        if parsed.path == "/health":
            self._set_headers(200)
            self.wfile.write(b"{\"ok\":true}")
            return

        # Static file serving from BASE_DIR
        rel = parsed.path.lstrip("/")
        if not rel:
            rel = "index.html"
        try:
            full = safe_join(BASE_DIR, rel)
        except ValueError:
            self._set_headers(400)
            self.wfile.write(b"{\"error\":\"bad path\"}")
            return

        if os.path.isdir(full):
            full = os.path.join(full, "index.html")

        if os.path.exists(full) and os.path.isfile(full):
            try:
                with open(full, "rb") as f:
                    data = f.read()
                self._set_headers(200, guess_type(full))
                self.wfile.write(data)
            except Exception:
                self._set_headers(500)
                self.wfile.write(b"{\"error\":\"read failed\"}")
        else:
            self._set_headers(404)
            self.wfile.write(b"{}")

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/grade":
            self._set_headers(404)
            self.wfile.write(b"{}")
            return
        try:
            length = int(self.headers.get('content-length', '0'))
            body = self.rfile.read(length) if length else b"{}"
            payload = json.loads(body.decode('utf-8') or "{}")
        except Exception:
            self._set_headers(400)
            self.wfile.write(b"{\"error\":\"invalid json\"}")
            return

        result = grade_with_openrouter(payload)
        self._set_headers(200)
        self.wfile.write(json.dumps(result).encode('utf-8'))


class NoFQDNHTTPServer(HTTPServer):
    """
    HTTPServer variant that avoids socket.getfqdn(host) during bind.
    Fixes UnicodeDecodeError on some Windows setups with non-UTF8 hostnames.
    Compatible with Python 3.7.
    """

    def server_bind(self):  # override to skip getfqdn
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.socket.bind(self.server_address)
        host, port = self.server_address[:2]
        # Avoid getfqdn; set a simple name
        self.server_name = "localhost"
        self.server_port = port


def run():
    server = NoFQDNHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"* Grader server listening on http://127.0.0.1:{PORT}")
    print("* Set OPENROUTER_API_KEY env var to enable DeepSeek via OpenRouter")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    run()
