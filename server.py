import logging
import os
import json
import math
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


def fallback_related_facts(region: str, era: str, topic: str) -> List[str]:
    r = str(region or "this region")
    e = str(era or "this period")
    t = str(topic or "General").lower()
    return [
        f"Fact 1: [Timeline Anchor] - Place this in {e}; similar clues in different eras often indicate different answers.",
        f"Fact 2: [Regional Anchor] - Keep it tied to {r}; cross-region lookalikes are a common trap.",
        f"Fact 3: [Theme Link] - This is most testable through {t} consequences, not isolated name recall.",
    ]


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
    explanation = (
        "The clue set points to a unique target, and your response matched that target within the right context."
        if correct else
        "The likely issue is conceptual overlap: your response may be related, but the clues narrow to a different target in this context."
    )
    related_facts = fallback_related_facts(region, era, topic)
    next_check = fallback_next_check(str(payload.get("question", "")))
    return {
        "summary": "You got it right. Keep tying clues to the specific historical context." if correct else "This was likely a near-miss in concept matching rather than total misunderstanding.",
        "explanation": explanation,
        "related_facts": related_facts,
        "key_clues": [
            "Identify the most specific clue that disambiguates lookalikes.",
            "Lock the answer to a timeline or region anchor before committing."
        ],
        "memory_hook": "Anchor one distinctive clue to one named entity.",
        "study_focus": {
            "region": region,
            "era": era,
            "topic": topic,
            "icon": icon_for_focus(region, topic),
        },
        "error_diagnosis": explanation,
        "overlap_explainer": reason or related_facts[0],
        "next_check_question": next_check,
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
        related_facts = [str(x).strip() for x in rc.get("related_facts") if str(x).strip()][:3]
    fallback_facts = fallback_related_facts(region, era, topic)
    explanation = str(
        rc.get("explanation")
        or rc.get("error_diagnosis")
        or ("You identified the right entity and context." if correct else "Your response likely overlapped with a related but different concept.")
    ).strip()
    next_check_raw = str(rc.get("next_check_question") or "").strip()
    next_check = next_check_raw or fallback_next_check(str(payload.get("question", "")))
    merged_related_facts = related_facts or fallback_facts
    confidence = str(rc.get("confidence", "")).lower()
    if confidence not in ("high", "medium", "low"):
        confidence = "low"
    return {
        "summary": str(rc.get("summary") or ("Correct answer with good clue alignment." if correct else "This answer was not accepted; review clue disambiguation.")).strip(),
        "explanation": explanation,
        "related_facts": merged_related_facts,
        "error_diagnosis": explanation,
        "overlap_explainer": str(rc.get("overlap_explainer") or " | ".join(merged_related_facts) or reason or "Use the most specific clues to separate related answers.").strip(),
        "key_clues": key_clues or [
            "Track clues that uniquely identify the expected answer.",
            "Use era and region to eliminate close alternatives."
        ],
        "memory_hook": str(rc.get("memory_hook") or "Pair one unique clue with one canonical answer.").strip(),
        "next_check_question": next_check,
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
            out["coach"] = fallback_coach(payload, locked_correct, out["reason"])
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
            coach_only_system = (
                "Act as an expert polymath and memory architect. Generate only coaching content for an already-graded answer.\n"
                "Do not re-grade. Respect provided is_correct and reason as the locked verdict.\n"
                "INSTRUCTIONS:\n"
                "1) Explain the underlying logic/significance in 2-3 punchy sentences.\n"
                "2) Provide 3 related high-value facts linked to the correct answer.\n"
                "3) If is_correct is false, clearly separate user answer vs expected answer.\n"
                "4) Provide one vivid mnemonic.\n"
                "Return strict JSON with this shape only:\n"
                "{\"coach\": {"
                "\"summary\": \"1-sentence definitive takeaway.\", "
                "\"explanation\": \"Deep context explaining the logic of the answer.\", "
                "\"related_facts\": ["
                "\"Fact 1: [Connection Type] - [Data]\", "
                "\"Fact 2: [Connection Type] - [Data]\", "
                "\"Fact 3: [Connection Type] - [Data]\"], "
                "\"key_clues\": ["
                "\"Specific word in the question that gives it away\", "
                "\"A chronological or spatial anchor\"], "
                "\"memory_hook\": \"A short, sticky mnemonic or visual association.\", "
                "\"study_focus\": {\"region\": \"String\", \"era\": \"String\", \"topic\": \"String\"}}}"
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
            return {"correct": locked_correct, "reason": locked_reason, "coach": coach}

        coach_system = (
            "Act as an expert polymath and memory architect. Your goal is to provide a high-density \"Micro-Lesson\" "
            "that helps a student not just memorize a fact, but understand its place in a broader system of knowledge.\n"
            "First, grade the answer and return top-level fields: {\"correct\": boolean, \"reason\": string}. "
            "Use this grading verdict as is_correct when writing coach content.\n"
            "CONTEXT KEYS PROVIDED: question, expected_answer, user_answer, aliases, strict, category, meta, coach_depth.\n"
            "INSTRUCTIONS:\n"
            "1) THE \"WHY\": Explain the underlying logic or historical significance in 2-3 punchy sentences.\n"
            "2) THE \"DEEP SCAN\" (3 RELATED FACTS): Provide three additional high-value facts contextually linked to the answer.\n"
            "3) ERROR CORRECTION: If is_correct is false, briefly explain the specific difference between the user answer and the correct one.\n"
            "4) MEMORY ANCHOR: Provide one vivid, strange, or rhythmic mnemonic.\n"
            "Use question-specific clues and avoid generic encyclopedia dumps.\n"
            "OUTPUT FORMAT (Strict JSON, no markdown):\n"
            "{\"correct\": boolean, \"reason\": string, \"coach\": {"
            "\"summary\": \"1-sentence definitive takeaway.\", "
            "\"explanation\": \"Deep context explaining the logic of the answer.\", "
            "\"related_facts\": ["
            "\"Fact 1: [Connection Type] - [Data]\", "
            "\"Fact 2: [Connection Type] - [Data]\", "
            "\"Fact 3: [Connection Type] - [Data]\"], "
            "\"key_clues\": ["
            "\"Specific word in the question that gives it away\", "
            "\"A chronological or spatial anchor\"], "
            "\"memory_hook\": \"A short, sticky mnemonic or visual association.\", "
            "\"study_focus\": {\"region\": \"String\", \"era\": \"String\", \"topic\": \"String\"}}}"
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
        if parsed.path not in ("/grade", "/api/grade", "/analytics-insights", "/api/analytics-insights"):
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
        else:
            result = analytics_insights_with_deepseek(payload)
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
