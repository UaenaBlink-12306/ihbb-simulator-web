import logging
import os
import json
from typing import List, Dict, Any
from http.server import BaseHTTPRequestHandler, HTTPServer
import socket
from urllib.parse import urlparse

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)
from dotenv import load_dotenv

load_dotenv()

PORT = int(os.environ.get("IHBB_SERVER_PORT", "5057"))
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY")
DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"
MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")


def normalize(s: str) -> str:
    return " ".join("".join(ch.lower() if ch.isalnum() else " " for ch in (s or "")).split())


def normalize_compact(s: str) -> str:
    return "".join(ch.lower() for ch in (s or "") if ch.isalnum())


def basic_match(user: str, expected: str, aliases: List[str]) -> bool:
    nu = normalize_compact(user)
    if not nu:
        return False
    if nu == normalize_compact(expected):
        return True
    for a in aliases or []:
        if nu == normalize_compact(a):
            return True
    return False


def parse_json_from_content(content: str) -> Dict[str, Any]:
    txt = (content or "").strip()
    if not txt:
        return {}
    try:
        return json.loads(txt)
    except Exception:
        pass
    cleaned = txt
    if cleaned.startswith("```"):
        cleaned = cleaned.lstrip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
    cleaned = cleaned.rstrip("`").strip()
    s = cleaned.find("{")
    e = cleaned.rfind("}")
    if s == -1 or e == -1 or e <= s:
        return {}
    try:
        return json.loads(cleaned[s:e + 1])
    except Exception:
        return {}


def token_overlap_ratio(a: str, b: str) -> float:
    aa = set((a or "").split())
    bb = set((b or "").split())
    if not aa or not bb:
        return 0.0
    overlap = sum(1 for x in aa if x in bb)
    return overlap / float(max(1, min(len(aa), len(bb))))


def guess_topic(question: str) -> str:
    t = normalize(question)
    if not t:
        return "General"
    if any(k in t for k in ["battle", "war", "campaign", "siege", "army", "navy", "admiral", "military"]):
        return "Military"
    if any(k in t for k in ["treaty", "law", "constitution", "election", "parliament", "policy", "minister"]):
        return "Politics"
    if any(k in t for k in ["religion", "church", "pope", "caliph", "buddh", "islam", "hindu", "christian"]):
        return "Religion"
    if any(k in t for k in ["econom", "trade", "bank", "tax", "industry", "market", "finance"]):
        return "Economy"
    if any(k in t for k in ["art", "painting", "novel", "poem", "literature", "music", "composer"]):
        return "Culture"
    if any(k in t for k in ["science", "physics", "chemistry", "biology", "medicine", "theory", "astronomy"]):
        return "Science"
    return "General"


def icon_for_focus(region: str, topic: str) -> str:
    region_icons = {
        "africa": "🌍",
        "europe": "🏰",
        "north america": "🦅",
        "latin america": "🗿",
        "middle east": "🕌",
        "east asia": "🏯",
        "south asia": "🪷",
        "southeast asia": "🌴",
        "central asia": "🐎",
        "oceania": "🌊",
        "world": "🌐",
    }
    topic_icons = {
        "military": "⚔️",
        "politics": "🏛️",
        "religion": "🕯️",
        "economy": "💰",
        "culture": "🎭",
        "science": "🧪",
        "general": "📘",
    }
    r = (region or "").strip().lower()
    t = (topic or "").strip().lower()
    return region_icons.get(r) or topic_icons.get(t) or "📘"


def fallback_next_check(question: str) -> str:
    q = normalize(question)
    if any(k in q for k in ["battle", "war", "campaign", "siege"]):
        return "What broader political or territorial change followed that conflict?"
    if any(k in q for k in ["treaty", "law", "constitution"]):
        return "What long-term political effect did that decision produce?"
    return "What cause-and-effect relationship best explains this answer in its historical context?"


def is_concept_check_valid(next_q: str, question: str, expected: str) -> bool:
    nq = normalize(next_q)
    oq = normalize(question)
    ex = normalize(expected)
    if len(nq) < 18:
        return False
    if nq == oq:
        return False
    if len(ex) >= 4 and ex in nq:
        return False
    return token_overlap_ratio(nq, oq) < 0.72


def fallback_coach(payload: Dict[str, Any], correct: bool, reason: str) -> Dict[str, Any]:
    meta = payload.get("meta", {}) if isinstance(payload.get("meta"), dict) else {}
    region = str(meta.get("category") or meta.get("region") or "World")
    era = str(meta.get("era") or "")
    topic = guess_topic(str(payload.get("question", "")))
    return {
        "summary": "You got it right. Keep tying clues to the specific historical context." if correct else "This was likely a near-miss in concept matching rather than total misunderstanding.",
        "error_diagnosis": "Your answer aligned with the required entity and context." if correct else "Your answer did not match the expected entity under strict identification, likely due to overlap with a related concept.",
        "overlap_explainer": reason or "Focus on the clue combination that uniquely identifies the expected answer.",
        "key_clues": [
            "Identify which clue is unique rather than merely related.",
            "Prioritize clues that narrow to one entity.",
            "Cross-check timeframe and region before finalizing."
        ],
        "memory_hook": "Anchor one distinctive clue to one named entity.",
        "next_check_question": fallback_next_check(str(payload.get("question", ""))),
        "study_focus": {
            "region": region,
            "era": era,
            "topic": topic,
            "icon": icon_for_focus(region, topic),
        },
        "confidence": "low",
    }


def normalize_coach(raw: Any, payload: Dict[str, Any], correct: bool, reason: str) -> Dict[str, Any]:
    rc = raw if isinstance(raw, dict) else {}
    meta = payload.get("meta", {}) if isinstance(payload.get("meta"), dict) else {}
    sf = rc.get("study_focus", {}) if isinstance(rc.get("study_focus"), dict) else {}
    region = str(sf.get("region") or meta.get("category") or meta.get("region") or "World").strip() or "World"
    era = str(sf.get("era") or meta.get("era") or "").strip()
    topic = str(sf.get("topic") or guess_topic(str(payload.get("question", "")))).strip() or "General"
    icon = str(sf.get("icon") or icon_for_focus(region, topic)).strip() or icon_for_focus(region, topic)
    key_clues = []
    if isinstance(rc.get("key_clues"), list):
        key_clues = [str(x).strip() for x in rc.get("key_clues") if str(x).strip()][:4]
    confidence = str(rc.get("confidence", "")).lower()
    if confidence not in ("high", "medium", "low"):
        confidence = "low"
    return {
        "summary": str(rc.get("summary") or ("Correct answer with good clue alignment." if correct else "This answer was not accepted; review clue disambiguation.")).strip(),
        "error_diagnosis": str(rc.get("error_diagnosis") or ("You identified the right entity." if correct else "The response likely overlapped with a related but different concept.")).strip(),
        "overlap_explainer": str(rc.get("overlap_explainer") or reason or "Use the most specific clues to separate related answers.").strip(),
        "key_clues": key_clues or [
            "Track clues that uniquely identify the expected answer.",
            "Use era and region to eliminate close alternatives.",
            "Prioritize proper nouns and named events."
        ],
        "memory_hook": str(rc.get("memory_hook") or "Pair one unique clue with one canonical answer.").strip(),
        "next_check_question": str(rc.get("next_check_question") or "").strip(),
        "study_focus": {
            "region": region,
            "era": era,
            "topic": topic,
            "icon": icon,
        },
        "confidence": confidence,
    }


def call_deepseek(messages: List[Dict[str, str]], max_tokens: int = 300) -> Dict[str, Any]:
    headers = {
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
        "Content-Type": "application/json",
    }
    body = {
        "model": MODEL,
        "messages": messages,
        "temperature": 0.0,
        "response_format": {"type": "json_object"},
        "max_tokens": max_tokens,
    }
    r = requests.post(DEEPSEEK_URL, headers=headers, json=body, timeout=30)
    r.raise_for_status()
    data = r.json()
    content = data["choices"][0]["message"]["content"] if data.get("choices") else ""
    return parse_json_from_content(content)


def grade_with_deepseek(payload: Dict[str, Any]) -> Dict[str, Any]:
    question = str(payload.get("question", ""))
    expected = str(payload.get("expected", ""))
    aliases = payload.get("aliases", []) if isinstance(payload.get("aliases"), list) else []
    user_answer = str(payload.get("user_answer", payload.get("answer", "")))
    strict = bool(payload.get("strict", True))
    coach_enabled = bool(payload.get("coach_enabled", False))
    coach_depth = str(payload.get("coach_depth", "full"))

    fallback_correct = basic_match(user_answer, expected, aliases)

    if not DEEPSEEK_API_KEY:
        out = {
            "correct": fallback_correct,
            "reason": "DEEPSEEK_API_KEY not set; used fallback matcher"
        }
        if coach_enabled:
            out["coach"] = fallback_coach(payload, fallback_correct, out["reason"])
        return out

    try:
        if not coach_enabled:
            system = (
                "You are a strict IHBB short-answer grader.\n"
                "Return only JSON: {\"correct\": boolean, \"reason\": string}."
            )
            user = {
                "question": question,
                "expected": expected,
                "aliases": aliases,
                "user_answer": user_answer,
                "strict": strict,
            }
            obj = call_deepseek([
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
            ], max_tokens=220)
            if not isinstance(obj, dict) or not isinstance(obj.get("correct"), bool):
                return {
                    "correct": fallback_correct,
                    "reason": "Could not parse DeepSeek response; used fallback matcher"
                }
            return {"correct": bool(obj.get("correct")), "reason": str(obj.get("reason", ""))}

        coach_system = (
            "You are an IHBB grading + coaching assistant.\n"
            "Be error-centric: explain why the user answer may feel plausible and where overlap/confusion occurs.\n"
            "Use question-specific clues only; avoid generic encyclopedia exposition.\n"
            "next_check_question must be a concept-check about cause/effect/context, not a repetition.\n"
            "Do not include the exact expected answer string inside next_check_question.\n"
            "Return strict JSON:\n"
            "{\"correct\": boolean, \"reason\": string, \"coach\": {"
            "\"summary\": string, \"error_diagnosis\": string, \"overlap_explainer\": string, "
            "\"key_clues\": string[], \"memory_hook\": string, \"next_check_question\": string, "
            "\"study_focus\": {\"region\": string, \"era\": string, \"topic\": string, \"icon\": string}, "
            "\"confidence\": \"high|medium|low\"}}"
        )
        coach_user = {
            "question": question,
            "expected": expected,
            "aliases": aliases,
            "user_answer": user_answer,
            "strict": strict,
            "coach_depth": coach_depth,
            "meta": payload.get("meta", {}),
        }
        obj = call_deepseek([
            {"role": "system", "content": coach_system},
            {"role": "user", "content": json.dumps(coach_user, ensure_ascii=False)},
        ], max_tokens=900)
        if not isinstance(obj, dict) or not isinstance(obj.get("correct"), bool):
            reason = "Could not parse DeepSeek response; used fallback matcher"
            return {
                "correct": fallback_correct,
                "reason": reason,
                "coach": fallback_coach(payload, fallback_correct, reason)
            }

        correct = bool(obj.get("correct"))
        reason = str(obj.get("reason", ""))
        coach = normalize_coach(obj.get("coach", obj), payload, correct, reason)
        if not is_concept_check_valid(str(coach.get("next_check_question", "")), question, expected):
            fix = call_deepseek([
                {
                    "role": "system",
                    "content": "Rewrite only next_check_question as a concept-check (cause/effect/context), not a repetition, and do not include expected answer text. Return JSON: {\"next_check_question\": string}."
                },
                {
                    "role": "user",
                    "content": json.dumps({
                        "original_question": question,
                        "expected_answer": expected,
                        "bad_next_check_question": coach.get("next_check_question", "")
                    }, ensure_ascii=False)
                }
            ], max_tokens=140)
            fixed_q = str(fix.get("next_check_question", "")).strip() if isinstance(fix, dict) else ""
            coach["next_check_question"] = fixed_q if is_concept_check_valid(fixed_q, question, expected) else fallback_next_check(question)
        return {"correct": correct, "reason": reason, "coach": coach}

    except requests.exceptions.Timeout as e:
        log.error("DeepSeek API request timeout: %s", e)
    except requests.exceptions.ConnectionError as e:
        log.error("DeepSeek API connection error: %s", e)
    except requests.exceptions.HTTPError as e:
        log.error("DeepSeek API HTTP error: %s, response: %s", e, getattr(e.response, "text", ""))
    except Exception as e:
        log.exception("DeepSeek API unexpected error: %s", e)

    reason = "LLM grading unavailable; used fallback matcher"
    out = {"correct": fallback_correct, "reason": reason}
    if coach_enabled:
        out["coach"] = fallback_coach(payload, fallback_correct, reason)
    return out


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
        if parsed.path not in ("/grade", "/api/grade"):
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

        result = grade_with_deepseek(payload)
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
    print("* Set DEEPSEEK_API_KEY env var to enable DeepSeek API grading")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    run()
