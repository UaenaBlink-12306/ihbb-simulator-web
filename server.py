import logging
import os
import json
import math
import re
import uuid
from typing import List, Dict, Any, Tuple
from http.server import BaseHTTPRequestHandler, HTTPServer
import socket
from urllib.parse import urlparse, quote

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)
from dotenv import load_dotenv

load_dotenv()

PORT = int(os.environ.get("IHBB_SERVER_PORT", "5057"))
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY")
DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"
MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")

REGION_OPTIONS = [
    "Africa",
    "Central Asia",
    "East Asia",
    "Europe",
    "Latin America",
    "Middle East",
    "North America",
    "Oceania",
    "South Asia",
    "Southeast Asia",
    "World",
]

ERA_LABELS = {
    "01": "8000 BCE – 600 BCE",
    "02": "600 BCE – 600 CE",
    "03": "600 CE – 1450 CE",
    "04": "1450 CE – 1750 CE",
    "05": "1750 – 1914",
    "06": "1914 – 1991",
    "07": "1991 – Present",
}


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


def string_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float, bool)):
        return str(value)
    return ""


def to_alias_array(value: Any) -> List[str]:
    if isinstance(value, list):
        return list(dict.fromkeys(string_value(v) for v in value if string_value(v)))
    if isinstance(value, str):
        return list(dict.fromkeys(part.strip() for part in re.split(r"[;,|]", value) if part.strip()))
    return []


def split_sentences(text: str) -> List[str]:
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    if not cleaned:
        return []
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+(?=[A-Z\"'])", cleaned) if part.strip()]


def normalize_region(value: Any) -> str:
    text = string_value(value).lower()
    if not text:
        return ""
    for region in REGION_OPTIONS:
        if region.lower() == text:
            return region
    alias_map = {
        "americas": "North America",
        "america": "North America",
        "northamerica": "North America",
        "latinamerica": "Latin America",
        "middleeast": "Middle East",
        "eastasia": "East Asia",
        "southasia": "South Asia",
        "southeastasia": "Southeast Asia",
        "centralasia": "Central Asia",
    }
    return alias_map.get(re.sub(r"[^a-z]+", "", text), "")


def normalize_era_code(value: Any) -> str:
    text = string_value(value)
    if not text:
        return ""
    if text in ERA_LABELS:
        return text
    lower = text.lower()
    for code, label in ERA_LABELS.items():
        if label.lower() == lower:
            return code
    normalized_text = re.sub(r"[^a-z0-9]+", " ", lower).strip()
    for code, label in ERA_LABELS.items():
        normalized_label = re.sub(r"[^a-z0-9]+", " ", label.lower()).strip()
        if normalized_text and (normalized_text in normalized_label or normalized_label in normalized_text):
            return code
    if "8000" in lower or "600 bce" in lower:
        return "01"
    if "600 ce" in lower or "classical" in lower:
        return "02"
    if "1450" in lower:
        return "03"
    if "1750" in lower:
        return "04"
    if "1914" in lower:
        return "05"
    if "1991" in lower:
        return "06"
    if "present" in lower or "modern" in lower:
        return "07"
    return ""


def make_generated_id() -> str:
    return f"gen_{uuid.uuid4().hex[:16]}"


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


def fallback_related_facts(region: str, era: str, topic: str) -> List[str]:
    r = str(region or "this region")
    e = str(era or "this period")
    t = str(topic or "General").lower()
    return [
        f"Fact 1: [Timeline Anchor] - Place this in {e}; similar clues in different eras often indicate different answers.",
        f"Fact 2: [Regional Anchor] - Keep it tied to {r}; cross-region lookalikes are a common trap.",
        f"Fact 3: [Theme Link] - This is most testable through {t} consequences, not isolated name recall.",
    ]


def canonical_answer_text(answer: str) -> str:
    txt = str(answer or "").strip()
    if not txt:
        return ""
    txt = re.sub(r"\s*\([^)]*\)", "", txt)
    txt = re.sub(r"\s*\[[^\]]*\]", "", txt)
    txt = re.sub(r"\s+", " ", txt).strip(" ,;:.")
    return txt or str(answer or "").strip()


def wiki_link_for_answer(answer: str) -> str:
    canonical = canonical_answer_text(answer)
    if not canonical:
        return ""
    slug = canonical.replace(" ", "_")
    return f"https://en.wikipedia.org/wiki/{quote(slug, safe='()_')}"


def fallback_explanation_bullets(payload: Dict[str, Any], correct: bool, reason: str, region: str, era: str, topic: str) -> List[str]:
    user_answer = str(payload.get("user_answer", payload.get("answer", ""))).strip()
    comparison = (
        "Your answer already matched the expected target, so the job now is to remember which clues made it uniquely correct."
        if correct else
        (f"Your answer '{user_answer}' was in the same topic neighborhood, but the clue set narrowed to a different answer." if user_answer else "Your response was close to the topic area, but the clue set narrowed to a different answer.")
    )
    anchors = f"Use {era or 'the era'} and {region or 'the region'} as elimination anchors before committing to an answer."
    topic_note = f"Prioritize {topic.lower()} clues such as names, titles, offices, or signature events that point to only one target."
    reason_note = reason or "Focus on the clue that uniquely separates the expected answer from nearby lookalikes."
    return [comparison, anchors, topic_note, reason_note]


def fallback_study_tip(region: str, era: str, topic: str) -> str:
    return f"Run a short drill on {region or 'this region'} {('in ' + era) if era else ''} and stop on the first clue that rules out the closest lookalike. Focus especially on {topic.lower()} triggers.".strip()


def fallback_coach(payload: Dict[str, Any], correct: bool, reason: str) -> Dict[str, Any]:
    meta = payload.get("meta", {}) if isinstance(payload.get("meta"), dict) else {}
    region = str(meta.get("category") or meta.get("region") or "World")
    era = str(meta.get("era") or "")
    topic = guess_topic(str(payload.get("question", "")))
    explanation_bullets = fallback_explanation_bullets(payload, correct, reason, region, era, topic)
    related_facts = fallback_related_facts(region, era, topic)
    canonical_answer = canonical_answer_text(str(payload.get("expected", payload.get("expected_answer", ""))))
    return {
        "summary": "You got it right. Keep tying clues to the specific historical context." if correct else "This was likely a near-miss in concept matching rather than total misunderstanding.",
        "explanation": " ".join(explanation_bullets),
        "explanation_bullets": explanation_bullets,
        "related_facts": related_facts,
        "key_clues": [
            "Identify the most specific clue that disambiguates lookalikes.",
            "Lock the answer to a timeline or region anchor before committing.",
            "Prefer named events, titles, and offices over broad topic similarity."
        ],
        "study_tip": fallback_study_tip(region, era, topic),
        "canonical_answer": canonical_answer,
        "wiki_link": wiki_link_for_answer(canonical_answer),
        "study_focus": {
            "region": region,
            "era": era,
            "topic": topic,
            "icon": icon_for_focus(region, topic),
        },
        "error_diagnosis": reason or explanation_bullets[0],
        "overlap_explainer": reason or related_facts[0],
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
    related_facts = []
    if isinstance(rc.get("related_facts"), list):
        related_facts = [str(x).strip() for x in rc.get("related_facts") if str(x).strip()][:5]
    explanation_bullets = []
    if isinstance(rc.get("explanation_bullets"), list):
        explanation_bullets = [str(x).strip() for x in rc.get("explanation_bullets") if str(x).strip()][:5]
    elif str(rc.get("explanation") or "").strip():
        explanation_bullets = [str(rc.get("explanation")).strip()]
    fallback_facts = fallback_related_facts(region, era, topic)
    merged_explanation = explanation_bullets or fallback_explanation_bullets(payload, correct, reason, region, era, topic)
    merged_related_facts = related_facts or fallback_facts
    canonical_answer = canonical_answer_text(str(rc.get("canonical_answer") or payload.get("expected") or payload.get("expected_answer") or ""))
    wiki_link = str(rc.get("wiki_link") or wiki_link_for_answer(canonical_answer)).strip()
    confidence = str(rc.get("confidence", "")).lower()
    if confidence not in ("high", "medium", "low"):
        confidence = "low"
    return {
        "summary": str(rc.get("summary") or ("Correct answer with good clue alignment." if correct else "This answer was not accepted; review clue disambiguation.")).strip(),
        "explanation": " ".join(merged_explanation).strip(),
        "explanation_bullets": merged_explanation,
        "related_facts": merged_related_facts,
        "error_diagnosis": str(rc.get("error_diagnosis") or reason or merged_explanation[0]).strip(),
        "overlap_explainer": str(rc.get("overlap_explainer") or " | ".join(merged_related_facts) or reason or "Use the most specific clues to separate related answers.").strip(),
        "key_clues": key_clues or [
            "Track clues that uniquely identify the expected answer.",
            "Use era and region to eliminate close alternatives.",
            "Prefer named events, titles, and offices over broad topic overlap."
        ],
        "study_tip": str(rc.get("study_tip") or rc.get("memory_hook") or rc.get("next_check_question") or fallback_study_tip(region, era, topic)).strip(),
        "canonical_answer": canonical_answer,
        "wiki_link": wiki_link,
        "study_focus": {
            "region": region,
            "era": era,
            "topic": topic,
            "icon": icon,
        },
        "confidence": confidence,
    }


def call_deepseek(messages: List[Dict[str, str]], max_tokens: int = 300, temperature: float = 0.0) -> Dict[str, Any]:
    headers = {
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
        "Content-Type": "application/json",
    }
    body = {
        "model": MODEL,
        "messages": messages,
        "temperature": temperature,
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
    expected = str(payload.get("expected", payload.get("expected_answer", "")))
    aliases = payload.get("aliases", []) if isinstance(payload.get("aliases"), list) else []
    user_answer = str(payload.get("user_answer", payload.get("answer", "")))
    strict = bool(payload.get("strict", True))
    coach_enabled = bool(payload.get("coach_enabled", False))
    coach_only = bool(payload.get("coach_only", False))
    coach_depth = str(payload.get("coach_depth", "full"))
    supplied_correct = payload.get("correct") if isinstance(payload.get("correct"), bool) else None
    supplied_reason = str(payload.get("reason", payload.get("grade_reason", "")))

    fallback_correct = basic_match(user_answer, expected, aliases)

    if not DEEPSEEK_API_KEY:
        locked_correct = supplied_correct if (coach_only and supplied_correct is not None) else fallback_correct
        locked_reason = supplied_reason if coach_only and supplied_reason else "DEEPSEEK_API_KEY not set; used fallback matcher"
        out = {
            "correct": locked_correct,
            "reason": locked_reason
        }
        if coach_enabled:
            out["coach"] = None if locked_correct else fallback_coach(payload, locked_correct, out["reason"])
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

        if coach_only:
            locked_correct = fallback_correct if supplied_correct is None else bool(supplied_correct)
            locked_reason = supplied_reason or ("Correct by prior grading pass." if locked_correct else "Incorrect by prior grading pass.")
            if locked_correct:
                return {"correct": locked_correct, "reason": locked_reason, "coach": None}
            coach_only_system = (
                "Act as a personalized IHBB coach. Generate only coaching content for an already-graded incorrect answer.\n"
                "Do not re-grade. Respect provided is_correct and reason as the locked verdict.\n"
                "Address the student directly and use their wrong answer to explain the mismatch.\n"
                "Do not write a paragraph block; use bullet-style strings in arrays.\n"
                "INSTRUCTIONS:\n"
                "1) summary: one concise personalized takeaway.\n"
                "2) error_diagnosis: explicitly state why the student's answer missed.\n"
                "3) overlap_explainer: explain the distinction between the student's answer and the correct answer.\n"
                "4) explanation_bullets: 3 to 4 short bullet strings that teach the answer in context.\n"
                "5) related_facts: 3 to 5 short bullet strings with valuable adjacent facts.\n"
                "6) key_clues: 2 to 4 short bullet strings quoting or paraphrasing the best giveaway clues.\n"
                "7) study_tip: one concrete next study move.\n"
                "8) canonical_answer: the clean answer only, with parenthetical grading notes removed.\n"
                "9) wiki_link: https://en.wikipedia.org/wiki/{canonical_answer_with_spaces_replaced_by_underscores}.\n"
                "Return strict JSON with this shape only:\n"
                "{\"coach\": {"
                "\"summary\": \"1-sentence definitive takeaway.\", "
                "\"error_diagnosis\": \"Why the student's answer was not accepted.\", "
                "\"overlap_explainer\": \"How the wrong answer overlaps with but differs from the right one.\", "
                "\"explanation_bullets\": ["
                "\"Personalized teaching bullet 1\", "
                "\"Personalized teaching bullet 2\", "
                "\"Personalized teaching bullet 3\"], "
                "\"related_facts\": ["
                "\"Fact bullet 1\", "
                "\"Fact bullet 2\", "
                "\"Fact bullet 3\"], "
                "\"key_clues\": ["
                "\"Specific clue that gives it away\", "
                "\"A chronological or spatial anchor\"], "
                "\"study_tip\": \"A concrete next drill or recall move.\", "
                "\"canonical_answer\": \"Clean canonical answer only\", "
                "\"wiki_link\": \"https://en.wikipedia.org/wiki/Clean_Canonical_Answer\", "
                "\"study_focus\": {\"region\": \"String\", \"era\": \"String\", \"topic\": \"String\"}, "
                "\"confidence\": \"low|medium|high\"}}"
            )
            coach_only_user = {
                "question": question,
                "expected_answer": expected,
                "aliases": aliases,
                "user_answer": user_answer,
                "is_correct": locked_correct,
                "reason": locked_reason,
                "category": str((payload.get("meta", {}) or {}).get("category", "")) if isinstance(payload.get("meta"), dict) else "",
                "strict": strict,
                "coach_depth": coach_depth,
                "meta": payload.get("meta", {}),
            }
            coach_obj = call_deepseek([
                {"role": "system", "content": coach_only_system},
                {"role": "user", "content": json.dumps(coach_only_user, ensure_ascii=False)},
            ], max_tokens=760)
            if not isinstance(coach_obj, dict):
                return {
                    "correct": locked_correct,
                    "reason": locked_reason,
                    "coach": fallback_coach(payload, locked_correct, locked_reason)
                }
            coach = normalize_coach(coach_obj.get("coach", coach_obj), payload, locked_correct, locked_reason)
            return {"correct": locked_correct, "reason": locked_reason, "coach": coach}

        coach_system = (
            "Act as a personalized IHBB coach. Your goal is to provide a high-density \"Micro-Lesson\" "
            "that helps a student not just memorize a fact, but understand its place in a broader system of knowledge.\n"
            "First, grade the answer and return top-level fields: {\"correct\": boolean, \"reason\": string}. "
            "If the answer is correct, return coach as null. Only generate coach content for incorrect answers.\n"
            "CONTEXT KEYS PROVIDED: question, expected_answer, user_answer, aliases, strict, category, meta, coach_depth.\n"
            "INSTRUCTIONS:\n"
            "1) Personalize the lesson to the student's wrong answer.\n"
            "2) Do not write one large paragraph; use bullet-style strings in arrays.\n"
            "3) explanation_bullets: 3 to 4 short bullets teaching why the correct answer fits.\n"
            "4) related_facts: 3 to 5 short bullets with valuable adjacent facts.\n"
            "5) key_clues: 2 to 4 short bullets identifying the best giveaway clues.\n"
            "6) canonical_answer must be the clean answer only, with parenthetical grading notes removed.\n"
            "7) wiki_link must be https://en.wikipedia.org/wiki/{canonical_answer_with_spaces_replaced_by_underscores}.\n"
            "Use question-specific clues and avoid generic encyclopedia dumps.\n"
            "OUTPUT FORMAT (Strict JSON, no markdown):\n"
            "{\"correct\": boolean, \"reason\": string, \"coach\": {"
            "\"summary\": \"1-sentence definitive takeaway.\", "
            "\"error_diagnosis\": \"Why the student's answer was not accepted.\", "
            "\"overlap_explainer\": \"How the wrong answer overlaps with but differs from the right one.\", "
            "\"explanation_bullets\": ["
            "\"Personalized teaching bullet 1\", "
            "\"Personalized teaching bullet 2\", "
            "\"Personalized teaching bullet 3\"], "
            "\"related_facts\": ["
            "\"Fact bullet 1\", "
            "\"Fact bullet 2\", "
            "\"Fact bullet 3\"], "
            "\"key_clues\": ["
            "\"Specific clue that gives it away\", "
            "\"A chronological or spatial anchor\"], "
            "\"study_tip\": \"A concrete next drill or recall move.\", "
            "\"canonical_answer\": \"Clean canonical answer only\", "
            "\"wiki_link\": \"https://en.wikipedia.org/wiki/Clean_Canonical_Answer\", "
            "\"study_focus\": {\"region\": \"String\", \"era\": \"String\", \"topic\": \"String\"}, "
            "\"confidence\": \"low|medium|high\"}}"
        )
        coach_user = {
            "question": question,
            "expected_answer": expected,
            "aliases": aliases,
            "user_answer": user_answer,
            "category": str((payload.get("meta", {}) or {}).get("category", "")) if isinstance(payload.get("meta"), dict) else "",
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
                "coach": None if fallback_correct else fallback_coach(payload, fallback_correct, reason)
            }

        correct = bool(obj.get("correct"))
        reason = str(obj.get("reason", ""))
        if correct:
            return {"correct": correct, "reason": reason, "coach": None}
        coach = normalize_coach(obj.get("coach", obj), payload, correct, reason)
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
        out["coach"] = None if fallback_correct else fallback_coach(payload, fallback_correct, reason)
    return out


def analytics_num(value: Any, digits: int = None) -> Any:
    try:
        num = float(value)
    except Exception:
        return None
    if not math.isfinite(num):
        return None
    if digits is not None:
        num = round(num, digits)
    return num


def normalize_analytics_summary(payload: Dict[str, Any]) -> Dict[str, Any]:
    summary = payload.get("summary", {}) if isinstance(payload.get("summary"), dict) else {}
    return {
        "total_attempts": int(analytics_num(summary.get("total_attempts"), 0) or 0),
        "total_accuracy": max(0, min(100, int(analytics_num(summary.get("total_accuracy"), 0) or 0))),
        "avg_buzz_seconds": analytics_num(summary.get("avg_buzz_seconds"), 2),
        "sessions": int(analytics_num(summary.get("sessions"), 0) or 0),
        "active_days": int(analytics_num(summary.get("active_days"), 0) or 0),
        "fastest_buzz_seconds": analytics_num(summary.get("fastest_buzz_seconds"), 2),
        "accuracy_delta_7d": analytics_num(summary.get("accuracy_delta_7d"), 1),
        "buzz_delta_7d": analytics_num(summary.get("buzz_delta_7d"), 2),
    }


def normalize_analytics_area(raw: Any) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    name = str(raw.get("name") or raw.get("title") or "").strip()
    if not name:
        return {}
    dim = str(raw.get("dim") or raw.get("dimension") or "Focus").strip() or "Focus"
    attempts = int(analytics_num(raw.get("attempts"), 0) or 0)
    correct = int(analytics_num(raw.get("correct"), 0) or 0)
    accuracy = int(analytics_num(raw.get("accuracy"), 0) or 0)
    accuracy = max(0, min(100, accuracy))
    return {
        "name": name,
        "dim": dim,
        "attempts": attempts,
        "correct": correct,
        "accuracy": accuracy,
        "avg_buzz": analytics_num(raw.get("avg_buzz"), 2),
    }


def collect_analytics_areas(payload: Dict[str, Any], key: str) -> List[Dict[str, Any]]:
    raw = payload.get(key, [])
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw:
        area = normalize_analytics_area(item)
        if area:
            out.append(area)
    return out


def dedupe_analytics_areas(areas: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    seen = set()
    for area in areas or []:
        dim = str(area.get("dim") or "Focus").strip() or "Focus"
        name = str(area.get("name") or "").strip()
        if not name:
            continue
        key = f"{dim}|{name}"
        if key in seen:
            continue
        seen.add(key)
        out.append(dict(area, dim=dim, name=name))
    return out


def analytics_priority(area: Dict[str, Any]) -> str:
    accuracy = int(area.get("accuracy") or 0)
    attempts = int(area.get("attempts") or 0)
    if accuracy < 50 or attempts >= 10:
        return "high"
    if accuracy < 70:
        return "medium"
    return "low"


def analytics_action(area: Dict[str, Any]) -> str:
    dim = str(area.get("dim") or "").strip().lower()
    name = str(area.get("name") or "this area").strip()
    if dim == "era":
        return f"Run two short drills in {name} and write down three timeline anchors before buzzing."
    if dim == "region":
        return f"Practice {name} in mixed-region sets and wait for one uniquely regional clue before buzzing in."
    return f"Build one short focused set on {name} and slow your buzz until the disambiguating clue appears."


def fallback_analytics_insights(payload: Dict[str, Any]) -> Dict[str, Any]:
    window_days = int(analytics_num(payload.get("window_days"), 0) or 30)
    summary = normalize_analytics_summary(payload)
    blind_spots = collect_analytics_areas(payload, "blind_spots")
    weak_eras = collect_analytics_areas(payload, "weak_eras")
    weak_regions = collect_analytics_areas(payload, "weak_regions")
    strengths = collect_analytics_areas(payload, "strengths")

    weak_candidates = dedupe_analytics_areas(blind_spots + weak_eras + weak_regions)[:3]
    weak_areas = []
    for area in weak_candidates:
        weak_areas.append({
            "title": f"{area['dim']}: {area['name']}",
            "dimension": area["dim"],
            "why": (
                "You are missing too many questions in this slice for it to stay in mixed practice."
                if area["accuracy"] < 55 else
                "This segment is trailing the rest of your chart and is likely dragging overall accuracy down."
            ),
            "evidence": (
                f"{area['accuracy']}% accuracy over {area['attempts']} questions"
                + (f" with a {area['avg_buzz']:.2f}s average buzz." if area.get("avg_buzz") else ".")
            ),
            "action": analytics_action(area),
            "priority": analytics_priority(area),
        })

    wins = [
        f"{area['dim']}: {area['name']} is holding at {area['accuracy']}% across {area['attempts']} questions."
        for area in strengths[:2]
    ]

    next_steps = []
    if weak_areas:
        next_steps.extend([area["action"] for area in weak_areas[:2]])
    if summary["active_days"] < 5:
        next_steps.append("Add three shorter practice days this week so weak-area review is repeated instead of crammed.")
    if summary["accuracy_delta_7d"] is not None and summary["accuracy_delta_7d"] < 0:
        next_steps.append("Pause mixed drilling for one session and rebuild accuracy with targeted review before speeding up again.")
    if not next_steps:
        next_steps.append("Keep one mixed drill and one targeted weak-area drill in the same week to stabilize gains.")

    headline = (
        f"{weak_areas[0]['title']} is the clearest weak area to improve next."
        if weak_areas else
        "Your analytics are starting to show a few workable study patterns."
    )
    overview = (
        f"Over the last {window_days} days you answered {summary['total_attempts']} questions at "
        f"{summary['total_accuracy']}% accuracy across {summary['sessions']} sessions and "
        f"{summary['active_days']} active days."
    )
    attempts = summary["total_attempts"]
    confidence = "high" if attempts >= 40 else ("medium" if attempts >= 15 else "low")
    return {
        "headline": headline,
        "overview": overview,
        "weak_areas": weak_areas,
        "wins": wins,
        "next_steps": next_steps[:4],
        "confidence": confidence,
    }


def normalize_analytics_insights(raw: Any, payload: Dict[str, Any]) -> Dict[str, Any]:
    fallback = fallback_analytics_insights(payload)
    obj = raw if isinstance(raw, dict) else {}
    weak_areas = []
    raw_weak = obj.get("weak_areas", [])
    if isinstance(raw_weak, list):
        for idx, item in enumerate(raw_weak[:3]):
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or item.get("name") or "").strip()
            if not title:
                continue
            fb = fallback["weak_areas"][idx] if idx < len(fallback["weak_areas"]) else {
                "why": "This slice is underperforming compared with the rest of your recent practice.",
                "evidence": "Recent drill results show this area needs more attention.",
                "action": "Run one short focused drill on this area before returning to mixed practice.",
                "priority": "medium",
            }
            priority = str(item.get("priority") or "").strip().lower()
            if priority not in ("high", "medium", "low"):
                priority = fb["priority"]
            weak_areas.append({
                "title": title,
                "dimension": str(item.get("dimension") or item.get("dim") or "Focus").strip() or "Focus",
                "why": str(item.get("why") or item.get("diagnosis") or "").strip() or fb["why"],
                "evidence": str(item.get("evidence") or "").strip() or fb["evidence"],
                "action": str(item.get("action") or item.get("recommendation") or "").strip() or fb["action"],
                "priority": priority,
            })

    wins = []
    if isinstance(obj.get("wins"), list):
        wins = [str(x).strip() for x in obj.get("wins", []) if str(x).strip()][:3]

    next_steps = []
    if isinstance(obj.get("next_steps"), list):
        next_steps = [str(x).strip() for x in obj.get("next_steps", []) if str(x).strip()][:4]

    confidence = str(obj.get("confidence") or "").strip().lower()
    if confidence not in ("high", "medium", "low"):
        confidence = fallback["confidence"]

    return {
        "headline": str(obj.get("headline") or "").strip() or fallback["headline"],
        "overview": str(obj.get("overview") or "").strip() or fallback["overview"],
        "weak_areas": weak_areas or fallback["weak_areas"],
        "wins": wins or fallback["wins"],
        "next_steps": next_steps or fallback["next_steps"],
        "confidence": confidence,
    }


def analytics_insights_with_deepseek(payload: Dict[str, Any]) -> Dict[str, Any]:
    fallback = fallback_analytics_insights(payload)
    if not DEEPSEEK_API_KEY:
        return {"source": "fallback", "insights": fallback}

    try:
        system = (
            "You are an IHBB analytics coach. You are given only aggregated 30-day performance data.\n"
            "Identify the student's weakest eras and regions, explain why they matter, and propose specific next steps.\n"
            "Do not invent data that is not present. Keep the advice concise and practical.\n"
            "Return strict JSON only with this shape:\n"
            "{\"headline\":\"string\","
            "\"overview\":\"string\","
            "\"weak_areas\":[{\"title\":\"string\",\"dimension\":\"string\",\"why\":\"string\",\"evidence\":\"string\",\"action\":\"string\",\"priority\":\"high|medium|low\"}],"
            "\"wins\":[\"string\"],"
            "\"next_steps\":[\"string\"],"
            "\"confidence\":\"high|medium|low\"}"
        )
        user = {
            "window_days": int(analytics_num(payload.get("window_days"), 0) or 30),
            "summary": normalize_analytics_summary(payload),
            "blind_spots": collect_analytics_areas(payload, "blind_spots"),
            "weak_eras": collect_analytics_areas(payload, "weak_eras"),
            "weak_regions": collect_analytics_areas(payload, "weak_regions"),
            "strengths": collect_analytics_areas(payload, "strengths"),
        }
        obj = call_deepseek([
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
        ], max_tokens=720)
        return {"source": "deepseek", "insights": normalize_analytics_insights(obj, payload)}
    except requests.exceptions.Timeout as e:
        log.error("DeepSeek analytics timeout: %s", e)
    except requests.exceptions.ConnectionError as e:
        log.error("DeepSeek analytics connection error: %s", e)
    except requests.exceptions.HTTPError as e:
        log.error("DeepSeek analytics HTTP error: %s, response: %s", e, getattr(e.response, "text", ""))
    except Exception as e:
        log.exception("DeepSeek analytics unexpected error: %s", e)

    return {"source": "fallback", "insights": fallback}


COACH_CHAT_ALLOWED_ACTIONS = {
    "practice_due_now",
    "review_last_misses",
    "open_ai_notebook",
    "apply_top_focus",
    "generate_focus_drill",
    "start_current_session",
    "open_setup",
    "open_review",
}


def safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def normalize_coach_chat_focus(raw: Any) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    priority = string_value(raw.get("priority")).lower()
    if priority not in ("high", "medium", "low"):
        priority = "medium"
    return {
        "key": string_value(raw.get("key")),
        "title": string_value(raw.get("title")),
        "region": string_value(raw.get("region")),
        "era": string_value(raw.get("era")),
        "topic": string_value(raw.get("topic")),
        "reason": string_value(raw.get("reason")),
        "action": string_value(raw.get("action")),
        "priority": priority,
    }


def normalize_coach_chat_context(payload: Dict[str, Any]) -> Dict[str, Any]:
    raw = payload.get("study_context") if isinstance(payload.get("study_context"), dict) else {}
    wrong = raw.get("wrong_bank") if isinstance(raw.get("wrong_bank"), dict) else {}
    notebook = raw.get("coach_notebook") if isinstance(raw.get("coach_notebook"), dict) else {}
    session_history = raw.get("session_history") if isinstance(raw.get("session_history"), dict) else {}
    last_session = session_history.get("last_session") if isinstance(session_history.get("last_session"), dict) else {}
    recent_incorrect = raw.get("recent_incorrect") if isinstance(raw.get("recent_incorrect"), dict) else {}
    setup = raw.get("setup") if isinstance(raw.get("setup"), dict) else {}
    active_set = raw.get("active_set") if isinstance(raw.get("active_set"), dict) else {}
    top_focuses = [normalize_coach_chat_focus(x) for x in (notebook.get("top_focuses") if isinstance(notebook.get("top_focuses"), list) else [])]
    top_focuses = [x for x in top_focuses if x.get("key") or x.get("title")]
    recent_focus = normalize_coach_chat_focus(recent_incorrect)
    return {
        "current_view": string_value(raw.get("current_view")),
        "wrong_bank": {
            "due_now": max(0, safe_int(wrong.get("due_now"), 0)),
            "total": max(0, safe_int(wrong.get("total"), 0)),
        },
        "coach_notebook": {
            "open_lessons": max(0, safe_int(notebook.get("open_lessons"), 0)),
            "total": max(0, safe_int(notebook.get("total"), 0)),
            "top_focuses": top_focuses[:4],
        },
        "session_history": {
            "total_sessions": max(0, safe_int(session_history.get("total_sessions"), 0)),
            "recent_accuracy": max(0, min(100, safe_int(session_history.get("recent_accuracy"), 0))),
            "days_since_last_session": max(0, safe_int(session_history.get("days_since_last_session"), 0)),
            "last_session": {
                "accuracy": max(0, min(100, safe_int(last_session.get("accuracy"), 0))),
                "total": max(0, safe_int(last_session.get("total"), 0)),
                "correct": max(0, safe_int(last_session.get("correct"), 0)),
                "duration_seconds": max(0, safe_int(last_session.get("duration_seconds"), 0)),
                "timestamp": safe_int(last_session.get("timestamp"), 0),
            } if last_session else {},
        },
        "setup": {
            "mode": string_value(setup.get("mode")),
            "length": string_value(setup.get("length")),
            "filters": string_value(setup.get("filters")),
        },
        "active_set": {
            "name": string_value(active_set.get("name")),
            "item_count": max(0, safe_int(active_set.get("item_count"), 0)),
        },
        "recent_incorrect": recent_focus,
    }


def coach_chat_focus_title(focus: Dict[str, Any]) -> str:
    if not isinstance(focus, dict):
        return ""
    return string_value(focus.get("title")) or " • ".join(part for part in [
        string_value(focus.get("region")),
        string_value(focus.get("era")),
        string_value(focus.get("topic")),
    ] if part) or "your top focus"


def coach_chat_action(action_id: str, label: str, reason: str, focus_key: str = "") -> Dict[str, Any]:
    out = {
        "id": action_id,
        "label": label,
        "reason": reason,
    }
    focus_key = string_value(focus_key)
    if focus_key:
        out["focus_key"] = focus_key
    return out


def dedupe_coach_chat_actions(actions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    seen = set()
    for action in actions or []:
        if not isinstance(action, dict):
            continue
        action_id = string_value(action.get("id"))
        if action_id not in COACH_CHAT_ALLOWED_ACTIONS:
            continue
        focus_key = string_value(action.get("focus_key"))
        key = f"{action_id}|{focus_key}"
        if key in seen:
            continue
        seen.add(key)
        out.append(action)
    return out[:3]


def fallback_coach_chat(payload: Dict[str, Any]) -> Dict[str, Any]:
    context = normalize_coach_chat_context(payload)
    user_message = normalize(string_value(payload.get("message")))
    wrong_due = context["wrong_bank"]["due_now"]
    wrong_total = context["wrong_bank"]["total"]
    notebook_open = context["coach_notebook"]["open_lessons"]
    top_focuses = context["coach_notebook"]["top_focuses"]
    top_focus = top_focuses[0] if top_focuses else {}
    recent_incorrect = context["recent_incorrect"] if isinstance(context.get("recent_incorrect"), dict) else {}
    recent_accuracy = context["session_history"]["recent_accuracy"]
    total_sessions = context["session_history"]["total_sessions"]
    last_days = context["session_history"]["days_since_last_session"]
    focus_title = coach_chat_focus_title(top_focus)
    focus_key = string_value(top_focus.get("key"))
    recent_focus_title = coach_chat_focus_title(recent_incorrect)
    recent_focus_key = string_value(recent_incorrect.get("key"))

    actions: List[Dict[str, Any]] = []
    if "wrong bank" in user_message or "srs" in user_message:
        if wrong_due > 0:
            message = (
                f"Wrong-bank is the right tool when you want spaced repetition on misses instead of fresh coverage. "
                f"You currently have {wrong_due} due card{'s' if wrong_due != 1 else ''} out of {wrong_total} tracked."
            )
            actions.append(coach_chat_action("practice_due_now", f"Practice {wrong_due} due card{'s' if wrong_due != 1 else ''}", "Start the due SRS queue immediately."))
        else:
            message = (
                "Wrong-bank works best after you build up misses in regular drills. "
                "Right now nothing is due, so a fresh targeted session is the better move."
            )
            if focus_key:
                actions.append(coach_chat_action("generate_focus_drill", f"Generate {focus_title}", "Create fresh questions around the recurring blind spot.", focus_key))
            actions.append(coach_chat_action("open_review", "Open Review", "Check your wrong-bank status and recent session debrief."))
    elif "notebook" in user_message or "ai notebook" in user_message or "lesson" in user_message or "coach" in user_message:
        message = (
            "AI Notebook is best when you need explanation and pattern review, not repetition of the exact same misses. "
            f"You have {notebook_open} open lesson{'s' if notebook_open != 1 else ''}"
            + (f", and {focus_title} is the clearest recurring lane." if focus_key else ".")
        )
        actions.append(coach_chat_action("open_ai_notebook", "Open AI Notebook", "Review saved DeepSeek lessons and mastery state."))
        if focus_key:
            actions.append(coach_chat_action("apply_top_focus", f"Apply {focus_title}", "Load that focus into the practice builder.", focus_key))
            actions.append(coach_chat_action("generate_focus_drill", f"Generate {focus_title}", "Turn that notebook pattern into a fresh drill.", focus_key))
    elif recent_focus_key:
        message = (
            f"You just hit a miss tied to {recent_focus_title}. Do not jump straight back to mixed drilling. "
            "Review the notebook explanation once, then run a short focused set before returning to broader practice."
        )
        actions.append(coach_chat_action("open_ai_notebook", "Open the lesson", "Review the saved DeepSeek explanation for this miss."))
        actions.append(coach_chat_action("generate_focus_drill", f"Generate {recent_focus_title}", "Build a short corrective drill from the same lane.", recent_focus_key))
        actions.append(coach_chat_action("review_last_misses", "Review recent misses", "Revisit the review queue before resuming mixed practice."))
    elif wrong_due >= 3:
        message = (
            f"You have {wrong_due} due wrong-bank card{'s' if wrong_due != 1 else ''}. "
            "That is the cleanest next move because it closes the loop on known misses before you add more volume."
        )
        actions.append(coach_chat_action("practice_due_now", f"Practice {wrong_due} due card{'s' if wrong_due != 1 else ''}", "Start the due SRS queue now."))
        if focus_key:
            actions.append(coach_chat_action("generate_focus_drill", f"Generate {focus_title}", "Follow SRS with a short fresh drill in the same lane.", focus_key))
    elif focus_key and (notebook_open > 0 or recent_accuracy < 70):
        message = (
            f"Your notebook keeps pointing back to {focus_title}. "
            "Use that as the next targeted block, then return to mixed practice after accuracy stabilizes."
        )
        actions.append(coach_chat_action("apply_top_focus", f"Apply {focus_title}", "Load the recurring notebook focus into setup.", focus_key))
        actions.append(coach_chat_action("generate_focus_drill", f"Generate {focus_title}", "Create fresh questions in the same lane.", focus_key))
        actions.append(coach_chat_action("open_ai_notebook", "Open AI Notebook", "Review the supporting explanations first."))
    elif total_sessions <= 0:
        message = (
            "Start with one normal mixed drill to create enough evidence for better recommendations. "
            "Once you miss a few questions, Wrong-bank and AI Notebook become much more valuable."
        )
        actions.append(coach_chat_action("start_current_session", "Start current session", "Begin the drill you have configured now."))
        actions.append(coach_chat_action("open_setup", "Open setup", "Tune region, era, and mode before starting."))
    else:
        freshness = (
            f"Your last session was about {last_days} day{'s' if last_days != 1 else ''} ago. "
            if last_days else
            "You already have recent practice data. "
        )
        message = (
            freshness
            + "The best structure is one targeted block for a weak lane and one mixed block to test transfer. "
            + (f"Right now {focus_title} is the clearest place to focus first." if focus_key else "Right now a short mixed drill is enough to keep momentum.")
        )
        if focus_key:
            actions.append(coach_chat_action("apply_top_focus", f"Apply {focus_title}", "Set up a targeted block first.", focus_key))
        actions.append(coach_chat_action("start_current_session", "Start current session", "Run the current practice setup."))
        actions.append(coach_chat_action("open_review", "Open Review", "Check wrong-bank and session debrief before deciding."))

    return {
        "source": "fallback",
        "message": message,
        "quick_actions": dedupe_coach_chat_actions(actions),
    }


def normalize_coach_chat_response(raw: Any, payload: Dict[str, Any]) -> Dict[str, Any]:
    fallback = fallback_coach_chat(payload)
    obj = raw if isinstance(raw, dict) else {}
    context = normalize_coach_chat_context(payload)
    focus_lookup = {
        focus.get("key"): focus
        for focus in context.get("coach_notebook", {}).get("top_focuses", [])
        if focus.get("key")
    }
    recent_focus = context.get("recent_incorrect", {})
    if recent_focus.get("key"):
        focus_lookup[recent_focus["key"]] = recent_focus

    actions = []
    raw_actions = obj.get("quick_actions", [])
    if isinstance(raw_actions, list):
        for item in raw_actions[:4]:
            if not isinstance(item, dict):
                continue
            action_id = string_value(item.get("id"))
            if action_id not in COACH_CHAT_ALLOWED_ACTIONS:
                continue
            focus_key = string_value(item.get("focus_key"))
            if focus_key and focus_key not in focus_lookup:
                focus_key = ""
            actions.append(coach_chat_action(
                action_id,
                string_value(item.get("label")) or string_value(item.get("title")) or action_id.replace("_", " ").title(),
                string_value(item.get("reason")) or "Recommended from your current practice context.",
                focus_key,
            ))

    message = string_value(obj.get("message"))
    if not message:
        message = fallback["message"]
    return {
        "source": "deepseek",
        "message": message,
        "quick_actions": dedupe_coach_chat_actions(actions or fallback["quick_actions"]),
    }


def coach_chat_with_deepseek(payload: Dict[str, Any]) -> Dict[str, Any]:
    fallback = fallback_coach_chat(payload)
    if not DEEPSEEK_API_KEY:
        return fallback

    context = normalize_coach_chat_context(payload)
    conversation = []
    raw_conversation = payload.get("conversation", [])
    if isinstance(raw_conversation, list):
        for item in raw_conversation[-8:]:
            if not isinstance(item, dict):
                continue
            role = string_value(item.get("role")).lower()
            if role not in ("user", "assistant"):
                continue
            content = string_value(item.get("content"))
            if not content:
                continue
            conversation.append({"role": role, "content": content})

    top_focus_keys = [focus.get("key") for focus in context.get("coach_notebook", {}).get("top_focuses", []) if focus.get("key")]
    recent_focus = context.get("recent_incorrect", {})
    if recent_focus.get("key") and recent_focus["key"] not in top_focus_keys:
        top_focus_keys.append(recent_focus["key"])

    system = (
        "You are the DeepSeek training sidebar inside an IHBB Practice Hub.\n"
        "Answer the user's study question clearly and accurately using only the provided app capabilities and study context.\n"
        "You may answer IHBB/history study questions directly, but if you are uncertain, say so instead of bluffing.\n"
        "Product capabilities you may mention:\n"
        "- Wrong-bank (SRS) practices previously missed questions that are due.\n"
        "- AI Notebook stores DeepSeek lessons from incorrect answers.\n"
        "- Apply Top Focus loads a recurring notebook focus into the practice builder.\n"
        "- Generate Focus Drill creates fresh generated questions for a focus.\n"
        "- Review Last Misses opens review and starts practice on misses.\n"
        "- Start Current Session launches the current practice setup.\n"
        "- Open Setup, Open Review, and Open AI Notebook navigate to those surfaces.\n"
        "Do not invent any other controls, tabs, or data.\n"
        "Keep the answer concise and practical.\n"
        "Recommend at most 3 quick actions and only use these action ids: "
        + ", ".join(sorted(COACH_CHAT_ALLOWED_ACTIONS))
        + ".\n"
        "If you use focus_key, it must exactly match one of these keys: "
        + (", ".join(top_focus_keys) if top_focus_keys else "(none available)")
        + ".\n"
        "Return strict JSON only with this shape:\n"
        "{\"message\":\"string\",\"quick_actions\":[{\"id\":\"action_id\",\"label\":\"string\",\"reason\":\"string\",\"focus_key\":\"optional\"}]}"
    )
    user = {
        "message": string_value(payload.get("message")) or "What should I practice next?",
        "conversation": conversation,
        "study_context": context,
        "fallback_plan": {
            "message": fallback["message"],
            "quick_actions": fallback["quick_actions"],
        },
    }

    try:
        obj = call_deepseek([
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
        ], max_tokens=700, temperature=0.2)
        return normalize_coach_chat_response(obj, payload)
    except requests.exceptions.Timeout as e:
        log.error("DeepSeek coach chat timeout: %s", e)
    except requests.exceptions.ConnectionError as e:
        log.error("DeepSeek coach chat connection error: %s", e)
    except requests.exceptions.HTTPError as e:
        log.error("DeepSeek coach chat HTTP error: %s, response: %s", e, getattr(e.response, "text", ""))
    except Exception as e:
        log.exception("DeepSeek coach chat unexpected error: %s", e)
    return fallback


def generate_questions_with_deepseek(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not DEEPSEEK_API_KEY:
        return {"error": "DeepSeek API key not configured."}

    try:
        count = int(payload.get("count", payload.get("num_questions", 5)) or 5)
    except Exception:
        count = 5
    count = max(1, min(12, count))
    region = normalize_region(payload.get("region", payload.get("category"))) or "World"
    era = normalize_era_code(payload.get("era", payload.get("era_code", payload.get("eraCode"))))
    topic = string_value(payload.get("topic", payload.get("focus_topic", payload.get("focus", payload.get("theme")))))
    creator_role = string_value(payload.get("creator_role", payload.get("role", "student"))) or "student"
    created_from = string_value(payload.get("created_from", payload.get("source_context", payload.get("purpose", "practice")))) or "practice"
    avoid_answers = {normalize_compact(v) for v in to_alias_array(payload.get("avoid_answers")) if normalize_compact(v)}
    reference_question = string_value(payload.get("reference_question"))
    reference_answer = string_value(payload.get("reference_answer"))
    wrong_answer = string_value(payload.get("wrong_answer"))
    focus_reason = string_value(payload.get("focus_reason", payload.get("reason")))

    system = (
        "You write IHBB-style history tossup practice questions.\n"
        "Return strict JSON only with this shape:\n"
        "{\"items\":[{\"question\":\"...\",\"answer\":\"...\",\"aliases\":[\"...\"],\"region\":\""
        + region
        + "\",\"era\":\""
        + (era or "code")
        + "\",\"topic\":\""
        + (topic or "General")
        + "\"}]}\n"
        "Every question must contain exactly 4 sentences total, in this order:\n"
        "Sentence 1 = hardest clue.\n"
        "Sentence 2 = medium clue.\n"
        "Sentence 3 = medium clue.\n"
        "Sentence 4 = easiest giveaway and must begin with \"For the point, name this\" or \"For the point, identify this\".\n"
        "Do not reveal or directly quote the answer before sentence 4.\n"
        "Use historically real, clue-rich facts. Avoid vague textbook summaries.\n"
        "Keep answers distinct from one another.\n"
        f"Region must be exactly one of: {', '.join(REGION_OPTIONS)}.\n"
        "Era must be one of these codes only: "
        + ", ".join(f"{code} ({label})" for code, label in ERA_LABELS.items())
        + ".\n"
        "Source is always generated."
    )
    user = {
        "count": count,
        "focus": {
            "region": region,
            "era_code": era,
            "era_label": ERA_LABELS.get(era, ""),
            "topic": topic,
            "creator_role": creator_role,
            "created_from": created_from,
        },
        "context": {
            "focus_reason": focus_reason,
            "reference_question": reference_question,
            "reference_answer": reference_answer,
            "wrong_answer": wrong_answer,
        },
        "avoid_answers": sorted(avoid_answers),
    }

    try:
        obj = call_deepseek(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
            ],
            max_tokens=2200,
            temperature=0.2,
        )
        raw_items = obj if isinstance(obj, list) else obj.get("items", obj.get("questions", [])) if isinstance(obj, dict) else []
        items: List[Dict[str, Any]] = []
        seen = set()
        for index, raw in enumerate(raw_items if isinstance(raw_items, list) else []):
            if not isinstance(raw, dict):
                continue
            question = re.sub(r"\s+", " ", string_value(raw.get("question", raw.get("prompt", raw.get("text", raw.get("body", "")))))).strip()
            answer = re.sub(r"\s+", " ", string_value(raw.get("answer", raw.get("canonical_answer", raw.get("solution", ""))))).strip()
            if not question or not answer:
                continue
            sentences = split_sentences(question)
            if len(sentences) != 4:
                continue
            first_three = normalize_compact(" ".join(sentences[:3]))
            answer_key = normalize_compact(answer)
            question_key = normalize_compact(question)
            if not answer_key or not question_key:
                continue
            if first_three and answer_key in first_three:
                continue
            if not re.search(r"for the point", sentences[3], re.I):
                continue
            dedupe_key = f"{answer_key}::{question_key}"
            if dedupe_key in seen or answer_key in avoid_answers:
                continue
            seen.add(dedupe_key)
            category = normalize_region(raw.get("category", raw.get("region", (raw.get("meta") or {}).get("category", region)))) or region or "World"
            era_code = normalize_era_code(raw.get("era", (raw.get("meta") or {}).get("era", era))) or era or ""
            items.append({
                "id": make_generated_id(),
                "question": question,
                "answer": answer,
                "aliases": to_alias_array(raw.get("aliases")),
                "meta": {
                    "category": category,
                    "era": era_code,
                    "source": "generated",
                },
                "topic": string_value(raw.get("topic", topic)),
                "created_from": created_from,
            })

        if not items:
            return {"error": "DeepSeek returned no valid generated questions."}

        persistence = persist_generated_items(items)

        return {
            "source": "deepseek",
            "requested": count,
            "returned": len(items),
            "items": items,
            "persistence": persistence,
        }
    except requests.exceptions.Timeout as e:
        log.error("DeepSeek generation timeout: %s", e)
        return {"error": "DeepSeek question generation timed out."}
    except requests.exceptions.ConnectionError as e:
        log.error("DeepSeek generation connection error: %s", e)
        return {"error": "Could not reach DeepSeek for question generation."}
    except requests.exceptions.HTTPError as e:
        log.error("DeepSeek generation HTTP error: %s, response: %s", e, getattr(e.response, "text", ""))
        status = getattr(e.response, "status_code", None)
        if status == 401:
            return {"error": "DeepSeek API key is invalid."}
        return {"error": f"DeepSeek question generation failed with HTTP {status or 'error'}."}
    except Exception as e:
        log.exception("DeepSeek generation unexpected error: %s", e)
        return {"error": "Question generation failed unexpectedly."}
    return {"error": "Question generation failed."}


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
QUESTIONS_JSON_PATH = os.path.join(BASE_DIR, "questions.json")
GENERATED_QUESTIONS_BANK_PATH = os.path.join(BASE_DIR, "generated_questions_bank.json")


def normalize_generated_bank_item(raw: Any) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    question = re.sub(r"\s+", " ", string_value(raw.get("question", raw.get("question_text", raw.get("prompt", raw.get("text", raw.get("body", ""))))))).strip()
    answer = re.sub(r"\s+", " ", string_value(raw.get("answer", raw.get("answer_text", raw.get("canonical_answer", raw.get("solution", "")))))).strip()
    if not question or not answer:
        return {}
    meta = raw.get("meta") or {}
    item = {
        "id": string_value(raw.get("id")) or make_generated_id(),
        "question": question,
        "answer": answer,
        "aliases": to_alias_array(raw.get("aliases")),
        "meta": {
            "category": normalize_region(raw.get("category", raw.get("region", meta.get("category")))) or "World",
            "era": normalize_era_code(raw.get("era", meta.get("era"))) or "",
            "source": "generated",
        },
    }
    topic = string_value(raw.get("topic"))
    if topic:
        item["topic"] = topic
    created_from = string_value(raw.get("created_from"))
    if created_from:
        item["created_from"] = created_from
    return item


def question_storage_key(raw: Any) -> str:
    if not isinstance(raw, dict):
        return ""
    answer = normalize_compact(string_value(raw.get("answer", raw.get("answer_text"))))
    question = normalize_compact(string_value(raw.get("question", raw.get("question_text"))))
    if not answer or not question:
        return ""
    return f"{answer}::{question}"


def merge_generated_items(existing_items: Any, incoming_items: Any) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], int]:
    next_items: List[Dict[str, Any]] = [item for item in (existing_items or []) if isinstance(item, dict)]
    by_id: Dict[str, Dict[str, Any]] = {}
    by_key: Dict[str, Dict[str, Any]] = {}
    for item in next_items:
        item_id = string_value(item.get("id"))
        key = question_storage_key(item)
        if item_id:
            by_id[item_id] = item
        if key:
            by_key[key] = item
    session_items: List[Dict[str, Any]] = []
    added = 0
    for raw in incoming_items or []:
        item = normalize_generated_bank_item(raw)
        if not item:
            continue
        item_id = string_value(item.get("id"))
        key = question_storage_key(item)
        existing = by_id.get(item_id) if item_id else None
        if not existing and key:
            existing = by_key.get(key)
        if existing:
            session_items.append(existing)
            continue
        next_items.append(item)
        if item_id:
            by_id[item_id] = item
        if key:
            by_key[key] = item
        session_items.append(item)
        added += 1
    return next_items, session_items, added


def atomic_write_json(path: str, payload: Any) -> None:
    tmp_path = path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def persist_generated_items(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    persistence = {
        "shared_bank_added": 0,
        "shared_bank_total": 0,
        "questions_json_added": 0,
        "questions_json_updated": False,
        "warning": "",
    }
    warnings: List[str] = []

    try:
        if os.path.exists(GENERATED_QUESTIONS_BANK_PATH):
            with open(GENERATED_QUESTIONS_BANK_PATH, "r", encoding="utf-8") as handle:
                bank_payload = json.load(handle)
        else:
            bank_payload = {"id": "generated_shared_bank", "name": "Shared Generated Questions", "items": []}
        merged_items, _, added = merge_generated_items(bank_payload.get("items"), items)
        bank_payload["id"] = bank_payload.get("id") or "generated_shared_bank"
        bank_payload["name"] = bank_payload.get("name") or "Shared Generated Questions"
        bank_payload["items"] = merged_items
        atomic_write_json(GENERATED_QUESTIONS_BANK_PATH, bank_payload)
        persistence["shared_bank_added"] = added
        persistence["shared_bank_total"] = len(merged_items)
    except Exception as exc:
        log.warning("Shared generated bank persist failed: %s", exc)
        warnings.append("Shared generated bank could not be updated on this server.")

    try:
        if os.path.exists(QUESTIONS_JSON_PATH):
            with open(QUESTIONS_JSON_PATH, "r", encoding="utf-8") as handle:
                questions_payload = json.load(handle)
            if isinstance(questions_payload, dict):
                merged_items, _, added = merge_generated_items(questions_payload.get("items"), items)
                questions_payload["items"] = merged_items
                atomic_write_json(QUESTIONS_JSON_PATH, questions_payload)
                persistence["questions_json_added"] = added
                persistence["questions_json_updated"] = True
    except Exception as exc:
        log.warning("questions.json merge failed: %s", exc)
        warnings.append("questions.json could not be rewritten on this server.")

    if warnings:
        persistence["warning"] = " ".join(warnings)
    return persistence


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
        if parsed.path not in (
            "/grade",
            "/api/grade",
            "/analytics-insights",
            "/api/analytics-insights",
            "/coach-chat",
            "/api/coach-chat",
            "/generate-questions",
            "/api/generate-questions",
        ):
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

        if parsed.path in ("/grade", "/api/grade"):
            result = grade_with_deepseek(payload)
        elif parsed.path in ("/analytics-insights", "/api/analytics-insights"):
            result = analytics_insights_with_deepseek(payload)
        elif parsed.path in ("/coach-chat", "/api/coach-chat"):
            result = coach_chat_with_deepseek(payload)
        else:
            result = generate_questions_with_deepseek(payload)
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
