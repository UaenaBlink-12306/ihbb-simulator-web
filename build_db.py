import os
import json
import re
import time
from typing import List, Dict, Any, Tuple, Optional

try:
    import requests  # type: ignore
except Exception:
    requests = None  # handled below


HERE = os.path.dirname(os.path.abspath(__file__))
SRC_TXT = os.path.join(HERE, "extracted_questions_answers.txt")
OUT_JSON = os.path.join(HERE, "questions.json")

# OpenRouter / DeepSeek config (re-uses the same env vars as server.py)
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = os.environ.get("OPENROUTER_MODEL", "deepseek/deepseek-chat-v3.1:free")
SITE_URL = os.environ.get("OPENROUTER_SITE_URL", "")
SITE_NAME = os.environ.get("OPENROUTER_SITE_NAME", "")


def read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()


def mk_item(q: str, a: str, meta: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    return {
        "id": str(abs(hash(q + "\n" + a))) + "_" + str(int(time.time()*1000) % 100000),
        "question": q,
        "answer": a,
        "aliases": [],
        "meta": {
            "category": (meta or {}).get("category", ""),  # used as Region in UI
            "era": (meta or {}).get("era", ""),
            "source": (meta or {}).get("source", ""),
        },
    }


_ALIAS_RE = re.compile(r"\[(?:accept|also|or)\s*([^\]]+)\]|\((?:accept|also|or)\s*([^)]+)\)", re.I)


def sanitize_item(it: Dict[str, Any]) -> None:
    it["question"] = re.sub(r"\s+", " ", it.get("question", "")).strip()
    ans = re.sub(r"\s+", " ", it.get("answer", "")).strip()
    # Pull out aliases
    aliases = it.get("aliases") or []
    for m in _ALIAS_RE.finditer(ans):
        chunk = (m.group(1) or m.group(2) or "").strip()
        if chunk:
            aliases.append(chunk)
    ans = _ALIAS_RE.sub("", ans).strip()
    # Remove trailing set/source notes like years or packet info
    ans = re.sub(r"(\d{4}.*?(Round|Regional|Extra|Packet|Bee|Bowl|Championship).*)$", "", ans, flags=re.I).strip()
    ans = re.sub(r"(\d{4}.*)$", "", ans).strip()
    ans = ans.strip('"')
    it["answer"] = ans
    it["aliases"] = aliases


def parse_qa(txt: str) -> List[Dict[str, Any]]:
    lines = txt.replace("\r", "").split("\n")
    items: List[Dict[str, Any]] = []
    cur_q: List[str] = []
    cur_a: List[str] = []
    stage = "find"  # find|q|a

    def push():
        nonlocal cur_q, cur_a
        if cur_q and cur_a:
            it = mk_item(" ".join(cur_q).strip(), " ".join(cur_a).strip(), {})
            sanitize_item(it)
            items.append(it)
        cur_q, cur_a = [], []

    for raw in lines:
        line = raw.strip()
        if re.match(r"^\d+\.", line) or re.match(r"^Question\s*:", line, flags=re.I):
            push(); stage = "q"
            t = re.sub(r"^\d+\.\s*", "", line)
            t = re.sub(r"^Question\s*:\s*", "", t, flags=re.I)
            cur_q.append(t)
            continue
        if re.match(r"^Answer\s*:", line, flags=re.I):
            stage = "a"; cur_a.append(re.sub(r"^Answer\s*:\s*", "", line, flags=re.I))
            continue
        if not line:
            continue
        if stage == "q":
            cur_q.append(line)
        elif stage == "a":
            cur_a.append(line)
    push()
    return items


REGIONS = [
    "World",
    "Africa",
    "North America",
    "Latin America",
    "Europe",
    "Middle East",
    "East Asia",
    "South Asia",
    "Southeast Asia",
    "Central Asia",
    "Oceania",
]


def categorize_with_openrouter(question: str) -> str:
    if not (OPENROUTER_API_KEY and requests):
        return naive_region(question)
    headers = {"Authorization": f"Bearer {OPENROUTER_API_KEY}", "Content-Type": "application/json"}
    if SITE_URL:
        headers["HTTP-Referer"] = SITE_URL
    if SITE_NAME:
        headers["X-Title"] = SITE_NAME
    system = (
        "You are a historian and dataset labeler. "
        "Classify the REGION most relevant to the given history quiz-bowl question.\n"
        f"Choose ONE from this list ONLY: {', '.join(REGIONS)}.\n"
        "If a question spans multiple areas, choose the most specific region; if global, choose 'World'.\n"
        "Reply ONLY as compact JSON: {\"region\": \"<one option>\"}."
    )
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": question[:2000]},
        ],
        "temperature": 0.0,
    }
    try:
        r = requests.post(OPENROUTER_URL, headers=headers, json=body, timeout=30)
        r.raise_for_status()
        data = r.json()
        content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
        s, e = content.find("{"), content.rfind("}")
        if s != -1 and e != -1 and e > s:
            obj = json.loads(content[s:e+1])
            region = str(obj.get("region", "")).strip()
            if region in REGIONS:
                return region
    except Exception:
        pass
    return naive_region(question)


def naive_region(text: str, answer: str = "") -> str:
    """A stronger keyword-based region classifier.
    - Uses weighted keyword/phrase scoring across both question and answer
    - Prioritizes matches in the answer (entity) over incidental context in the question
    - Falls back to 'World' when no signal is detected

    This remains heuristic, but avoids obvious mislabels like
    Carthage→Europe (due to 'Rome') or Beethoven→Middle East (due to 'Israeli').
    """
    t = (text or "").lower()
    a = (answer or "").lower()

    def wscore(hay: str, needles: Dict[str, float]) -> float:
        s = 0.0
        for k, w in needles.items():
            # simple word/phrase presence (word boundary for single words)
            if " " in k:
                if k in hay:
                    s += w
            else:
                # word boundary-ish: strip punctuation to reduce false positives
                if re.search(rf"\b{re.escape(k)}\b", hay):
                    s += w
        return s

    # Keyword weights (add only compact, high-signal tokens)
    KW: Dict[str, Dict[str, float]] = {
        "North America": {
            # countries & markers
            "united states": 2.5, "u.s.": 2.5, "usa": 2.5, "america": 1.0, "canada": 2.0,
            # cities/figures/events
            "washington": 1.0, "new york": 1.2, "boston": 1.0, "chicago": 1.5, "philadelphia": 1.0,
            "al capone": 3.0, "st. valentine": 2.0, "civil war": 1.0,
        },
        "Latin America": {
            # countries/regions (include Caribbean)
            "mexico": 2.0, "aztec": 2.0, "maya": 2.0, "inca": 2.0,
            "brazil": 2.0, "peru": 2.0, "chile": 2.0, "argentina": 2.0, "paraguay": 2.0, "uruguay": 2.0,
            "bolivia": 2.0, "colombia": 2.0, "venezuela": 2.0, "ecuador": 2.0, "caribbean": 2.0,
            # specific islands/cities
            "haiti": 2.0, "trinidad": 3.0, "tobago": 3.0, "port of spain": 3.0, "jamaica": 2.0, "cuba": 2.0,
        },
        "Europe": {
            # countries/regions
            "europe": 1.0, "britain": 2.0, "england": 2.0, "scotland": 1.5, "wales": 1.5, "ireland": 1.5,
            "france": 2.0, "french": 1.5, "germany": 2.0, "german": 1.5, "spain": 2.0, "italy": 2.0,
            "rome": 1.0, "roman": 0.8, "byzantine": 1.0, "austria": 2.0, "hungary": 1.5, "poland": 1.5,
            "sweden": 1.2, "norway": 1.2, "denmark": 1.2, "finland": 1.2, "russia": 1.8, "ukraine": 1.5,
            "prussia": 1.5, "napoleon": 3.0, "beethoven": 3.0, "wellington": 2.5, "waterloo": 2.0,
            "dönitz": 2.5, "doenitz": 2.5, "u-boat": 1.8, "dunkirk": 2.0, "dover": 3.0,
        },
        "Middle East": {
            "middle east": 2.0, "israel": 1.5, "palestine": 1.5, "iraq": 2.0, "iran": 2.0, "persia": 2.0,
            "saudi": 2.0, "turkey": 1.5, "syria": 1.8, "lebanon": 1.5, "jordan": 1.5, "arab": 1.2,
            "caliph": 1.5, "abbasid": 2.0, "umayyad": 2.0, "mamluk": 1.5, "ayyubid": 1.5,
        },
        "Africa": {
            "africa": 1.0, "egypt": 2.5, "nubia": 1.8, "ethiopia": 2.0, "axum": 2.0,
            "mali": 2.0, "songhai": 2.0, "ghana": 1.5, "zulu": 2.0, "ashanti": 2.0,
            "carthage": 4.0, "maghreb": 2.0, "berber": 1.5, "sahara": 1.5, "bantu": 1.5,
            "swahili": 1.5, "malindi": 1.5, "edfu": 1.5, "horus": 3.0,
        },
        "East Asia": {
            "china": 2.5, "chinese": 2.0, "ming": 2.0, "qing": 2.0, "han": 1.5, "song": 1.2, "yuan": 1.2,
            "tang": 1.2, "zhou": 1.0, "japan": 2.5, "tokugawa": 2.0, "edo": 2.0, "kyoto": 1.5,
            "samurai": 1.5, "shogun": 1.5, "korea": 2.0, "goryeo": 1.5, "joseon": 1.8, "hanseong": 1.2,
            "zheng he": 3.5, "nankai": 2.0, "kanto": 2.0,
        },
        "South Asia": {
            "india": 2.5, "indian": 1.5, "mughal": 2.0, "delhi sultanate": 2.5, "maurya": 2.0, "gupta": 2.0,
            "ashoka": 2.0, "raj": 1.5, "bengal": 1.5, "maratha": 1.8, "sikh": 1.5, "punjab": 1.5, "deccan": 1.5,
        },
        "Southeast Asia": {
            "vietnam": 2.0, "siam": 1.8, "thailand": 1.8, "laos": 1.5, "cambodia": 1.8, "khmer": 2.0, "angkor": 2.0,
            "malacca": 2.0, "majapahit": 2.0, "indonesia": 2.0, "borneo": 1.5, "philippines": 2.0,
            "luzon": 1.5, "mindanao": 1.5, "burma": 1.5, "myanmar": 1.5,
        },
        "Central Asia": {
            "bukhara": 2.0, "samarkand": 2.0, "timur": 2.0, "tamerlane": 2.0,
            "kazakh": 1.5, "uzbek": 1.5, "kyrgyz": 1.5, "tajik": 1.5, "turkmen": 1.5, "steppe": 1.0,
            "mongol empire": 2.0,
        },
        "Oceania": {
            "australia": 2.5, "new zealand": 2.5, "aboriginal": 2.0, "maori": 2.0,
            "polynesia": 1.5, "micronesia": 1.5, "melanesia": 1.5, "papua": 1.5, "fiji": 1.5, "tahiti": 1.5,
        },
    }

    # Scores: answer weighted heavier than question context
    scores: Dict[str, float] = {r: 0.0 for r in REGIONS}
    for r, kw in KW.items():
        scores[r] += wscore(t, kw) * 1.0
        scores[r] += wscore(a, kw) * 3.0

    # Decide winner
    best_region, best_score = None, 0.0
    for r, s in scores.items():
        if s > best_score:
            best_region, best_score = r, s

    # No signal → World
    if not best_region or best_score <= 0.0:
        return "World"
    return best_region


def categorize_items(items: List[Dict[str, Any]], sleep_s: float = 0.0) -> None:
    for i, it in enumerate(items, 1):
        q = it.get("question", "")
        region = categorize_with_openrouter(q)
        # If OpenRouter unavailable, enhance fallback by considering the answer token
        if not OPENROUTER_API_KEY or requests is None:
            region = naive_region(q, it.get("answer", ""))
        it.setdefault("meta", {})["category"] = region  # use category field as Region in UI
        if sleep_s:
            time.sleep(sleep_s)
        if i % 20 == 0:
            print(f"Categorized {i}/{len(items)}...")


def build():
    if not os.path.exists(SRC_TXT):
        raise FileNotFoundError(f"Not found: {SRC_TXT}")
    txt = read_text(SRC_TXT)
    items = parse_qa(txt)
    if not items:
        raise RuntimeError("No questions parsed from extracted_questions_answers.txt")
    print(f"Parsed items: {len(items)}")

    if not OPENROUTER_API_KEY:
        print("OPENROUTER_API_KEY not set; using naive region heuristic.")
    if requests is None and OPENROUTER_API_KEY:
        print("'requests' module not available; falling back to naive heuristic.")
    if OPENROUTER_API_KEY and requests is not None:
        print(f"Using OpenRouter model for region categorization: {MODEL}")

    categorize_items(items, sleep_s=0.0)

    out = {
        "id": f"set_{int(time.time())}",
        "name": "IHBB Questions (categorized by region)",
        "items": items,
    }
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"Wrote {OUT_JSON}")


if __name__ == "__main__":
    build()
