#!/usr/bin/env python3
"""Extract official IHBB/IAC packet PDFs into the simulator question-bank schema.

The importer is intentionally deterministic. It records a per-PDF extraction audit,
classifies region/era from the existing curated bank, removes exact and conservative
near-duplicates, writes a standalone new-question set, and rewrites the merged bank.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import math
import os
import re
import statistics
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Iterable, Sequence


CATEGORIES = [
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
ERAS = ["", "01", "02", "03", "04", "05", "06", "07"]

NUMBER_RE = re.compile(
    r"^\s*(?:\((\d{1,3})\)(?:[ARD](?=[A-Z])|\s+)|(\d{1,3})[.)]\s+)(.*\S)\s*$"
)
# A few packet exports attach their one-letter difficulty code directly to the
# marker (for example, "DANSWER:"). Treat that code as layout metadata.
ANSWER_RE = re.compile(r"(?im)^\s*[ARD]?(?:ANSWER|ANS)\s*:\s*")
BONUS_RE = re.compile(r"(?im)^\s*(?:BONUS(?:\s+QUESTION)?|TOSSUP)\s*:\s*")
CONTEXT_RE = re.compile(
    r"^(?!\s*(?:\(\d{1,3}\)|\d{1,3}[.)]))(?:Concerning\b.*\bname\b|Regarding\b.*\bname\b|"
    r"For each of the following\b|Given\b.+,\s*name\b|Name the following\b|"
    r"Name the\b.+(?:\.{2,}|…)$|What\b.+(?:\.{2,}|…)$|Name the(?:\.{2,}|…)$|"
    r".*(?:\.{2,}|…)$)",
    re.IGNORECASE,
)
SECTION_RE = re.compile(
    r"^(?:(?:First|Second|Third|Fourth) Quarter|Regulation (?:Questions|Tossups)|"
    r"Quarter\s+[1-4]|"
    r"(?:First|Second) Half|Sixty[- ]Second Rounds?|Tiebreakers?|Extra Questions?|"
    r"Bee Round(?:\s+\d+)?|Bowl Round(?:\s+\d+)?)$",
    re.IGNORECASE,
)
PAGE_NUMBER_RE = re.compile(r"^(?:Page\s+\d+(?:\s+of\s+\d+)?|\d+\s+of\s+\d+)$", re.IGNORECASE)
BARE_NUMBER_RE = re.compile(r"^\d{1,4}$")
AUTHOR_LINE_RE = re.compile(r"^\s*[\[<]([^\]>]{1,80})[\]>]\s*$")
YEAR_RE = re.compile(r"(?<!\d)(\d{3,4})\s*(B\.?C\.?E?\.?|A\.?D\.?|C\.?E\.?)?(?!\d)", re.IGNORECASE)
CENTURY_RE = re.compile(
    r"(?<!\d)(\d{1,2})(?:st|nd|rd|th)[- ]centur(?:y|ies)\s*(B\.?C\.?E?\.?|A\.?D\.?|C\.?E\.?)?",
    re.IGNORECASE,
)

STOPWORDS = {
    "a", "about", "after", "again", "against", "all", "also", "an", "and", "another", "any",
    "are", "as", "at", "be", "became", "because", "been", "before", "being", "between", "both",
    "but", "by", "called", "can", "during", "each", "for", "from", "had", "has", "have", "he",
    "her", "his", "how", "in", "into", "is", "it", "its", "later", "led", "may", "most", "name",
    "named", "new", "not", "of", "on", "one", "or", "other", "over", "points", "said", "than",
    "that", "the", "their", "them", "then", "these", "they", "this", "those", "through", "to", "under",
    "was", "were", "what", "when", "where", "which", "while", "who", "whose", "with", "would",
}


@dataclass
class RawPair:
    question: str
    answer: str
    source_pdf: str
    context: str = ""


@dataclass
class Block:
    lines: list[str] = field(default_factory=list)
    context: str = ""


def normalize_chars(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "")
    return (
        value.replace("\u00ad", "")
        .replace("ﬁ", "fi")
        .replace("ﬂ", "fl")
        .replace("\u200b", "")
        .replace("\ufeff", "")
        .replace("\uf0b7", " ")
        .replace("\r", "")
    )


def compact(value: str) -> str:
    return re.sub(r"\s+", " ", normalize_chars(value)).strip()


def canonical(value: str) -> str:
    value = unicodedata.normalize("NFKD", compact(value)).casefold()
    return "".join(ch for ch in value if ch.isalnum())


def answer_core(value: str) -> str:
    value = compact(value)
    value = re.sub(r"\[\[.*?\]\]", " ", value)
    value = re.split(r"\s+(?:\(|\[)(?:or|accept|prompt|do not|be lenient)\b", value, maxsplit=1, flags=re.I)[0]
    value = re.split(r"\s*;\s*(?:or|accept|prompt|do not)\b", value, maxsplit=1, flags=re.I)[0]
    value = re.sub(r"^(?:the|a|an)\s+", "", value, flags=re.I)
    return canonical(value)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def author_credit(line: str) -> bool:
    match = AUTHOR_LINE_RE.match(line)
    if not match:
        return False
    inner = match.group(1).strip()
    if re.search(r"\b(?:accept|prompt|or|pronunciation|read|until|before|after)\b", inner, re.I):
        return False
    words = re.findall(r"[A-Za-zÀ-ÖØ-öø-ÿ'’-]+", inner)
    return 1 <= len(words) <= 6 and not re.search(r"[.!?;:]", inner)


def repeated_page_headers(pages: Sequence[str]) -> set[str]:
    positions: Counter[str] = Counter()
    for page in pages:
        lines = [compact(line) for line in normalize_chars(page).splitlines() if compact(line)]
        for line in lines[:3]:
            if len(line) <= 180:
                positions[line] += 1
    threshold = max(2, math.ceil(len(pages) * 0.45))
    return {line for line, count in positions.items() if count >= threshold}


def cleaned_page_lines(page_text: str, headers: set[str]) -> list[str]:
    result: list[str] = []
    category_listing = False
    source_lines = [compact(raw) for raw in normalize_chars(page_text).splitlines() if compact(raw)]
    for index, line in enumerate(source_lines):
        if not line or line in headers or PAGE_NUMBER_RE.match(line):
            continue
        # Some packets use a bare page number as the first or last line. Keep
        # interior numbers because they may be a year, a numeric answer, or a
        # formula subscript (for example, the 4 in CH4).
        if BARE_NUMBER_RE.match(line) and (index <= 1 or index >= len(source_lines) - 2):
            continue
        if re.fullmatch(r"[ARD]", line):
            continue
        if re.match(r"^(?:NHB|NHBB|IHBB)\b.{0,100}\b(?:19|20)\d{2}(?:-\d{2,4})?$", line, re.I):
            continue
        if (
            re.search(r"\bPage\s+\d+(?:\s+of\s+\d+)?$", line, re.I)
            and re.search(r"\b(?:History|IHBB|NHB|NHBB|Academic Bowl)\b", line, re.I)
        ):
            continue
        if re.match(r"^(?:©|Copyright\b)", line, re.I):
            continue
        if re.match(
            r"^(?:(?:First|Second|Third|Fourth) Quarter\s*:?[ ]*)?The categories are\b",
            line,
            re.I,
        ):
            category_listing = True
            continue
        if category_listing:
            if re.match(r"^\d{1,2}[.)]\s+.{1,140}$", line):
                continue
            category_listing = False
        result.append(line)
    return result


def join_wrapped(lines: Iterable[str]) -> str:
    output = ""
    for raw in lines:
        line = compact(raw)
        if not line:
            continue
        if not output:
            output = line
        elif output.endswith("-"):
            output += line
        else:
            output += " " + line
    return compact(output)


def clean_question(lines: Sequence[str], context: str = "") -> str:
    kept: list[str] = []
    for line in lines:
        if author_credit(line) or PAGE_NUMBER_RE.match(line) or SECTION_RE.match(line):
            continue
        if re.fullmatch(r"(?:Bowl|Bee)\s+Round\s+\d+", compact(line), re.I):
            continue
        if re.match(r"^Tiebreakers?\s*/\s*extras?\b", compact(line), re.I):
            continue
        if re.match(r"^(?:Only read if|Read only if|Do not read)\b", line, re.I):
            continue
        if re.match(r"^(?:Written|Edited|Packet|Round)\s+by\b", line, re.I):
            continue
        kept.append(line)
    text = join_wrapped(kept)
    # Backup/tiebreaker instructions are sometimes printed on the same line as
    # the real prompt. Remove only the label so the question itself survives.
    text = re.sub(r"^\s*EXTRA\s+QUESTIONS?\b[\s:–—‐-]*", "", text, flags=re.I)
    text = re.sub(
        r"^\s*(?:Only read if|Read only if|Do not read)\b.*?\btiebreaker\b[!:.\s-]*",
        "",
        text,
        flags=re.I,
    )
    # If a bonus label is embedded after the preceding tossup/answer because
    # of a PDF line-break quirk, the following answer belongs to the bonus.
    # Keep the bonus prompt and discard the unrelated prefix.
    bonus_markers = list(re.finditer(r"\bBONUS(?:\s+QUESTION)?\s*:\s*", text, re.I))
    if bonus_markers:
        text = text[bonus_markers[-1].end() :]
    # Packet labels such as "BONUS." or "TOSSUP:" are layout metadata, not
    # part of the prompt shown to students. Accept either punctuation style.
    text = re.sub(
        r"^[^\w]*\d*\s*(?:BONUS(?:\s+QUESTION)?|TOSSUP)\s*[:.]\s*",
        "",
        text,
        flags=re.I,
    )
    text = re.sub(r"^END OF [A-Z\s-]+?(?=(?:TB|TIEBREAKER)\s*\d+)", "", text, flags=re.I)
    text = re.sub(r"^\s*(?:TB|TIEBREAKER)\s*\d+\s*[:.)-]?\s*", "", text, flags=re.I)
    text = re.sub(r"\s*\((?:\+|\*)\)\s*", " ", text)
    text = re.sub(r"\s*<[^>]{1,40}>\s*\{[IVX]+\}", " ", text)
    text = text.replace("MISSING", " ")
    text = re.sub(r"\bQUESTION\s+(?:e?wline|newline)\b", " ", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip(" -")
    context = compact(context).rstrip(". ")
    if context and not canonical(text).startswith(canonical(context)[:40]):
        if context.endswith(".."):  # a source ellipsis becomes a natural continuation
            context = context.rstrip(".")
        if context.lower().endswith("name the") and text:
            # Lowercase an ordinary sentence-starting word ("State" ->
            # "state") while preserving initialisms such as "US" and "UK".
            if len(text) > 1 and text[0].isupper() and text[1].islower():
                text = text[:1].lower() + text[1:]
            text = context + " " + text
        else:
            text = context + " " + text
    return compact(text)


def clean_answer(lines: Sequence[str]) -> str:
    kept: list[str] = []
    for line in lines:
        # Bare years (for example, "ANSWER: 1683") are legitimate answers.
        # Page-number-only lines have already been removed at the page stage.
        if author_credit(line) or SECTION_RE.match(line):
            continue
        if re.match(r"^(?:Written|Edited|Packet)\s+by\b", line, re.I):
            continue
        if re.match(r"^The categories are\s*:?$", line, re.I):
            break
        kept.append(line)
    text = join_wrapped(kept)
    # Page/section labels often follow the final answer on the same extracted
    # line. They are layout metadata, never part of an answer.
    text = re.sub(
        r"\s+[ARD]?\s*EXTRA\s+QUESTIONS?\b.*$",
        "",
        text,
        flags=re.I,
    )
    text = re.sub(r"\s+TIEBREAKERS?(?:\s*/\s*EXTRAS?)?\b.*$", "", text, flags=re.I)
    text = re.sub(r"\s+(?:NHB|NHBB|IHBB|IAC)\b.{0,180}$", "", text, flags=re.I)
    text = re.sub(r"\s+(?:First|Second|Third|Fourth) Quarter\b.*$", "", text, flags=re.I)
    text = re.sub(r"\s*<[^>]{1,40}>\s*\{[IVX]+\}", " ", text)
    text = re.sub(r"\s+[ARD]\s*$", "", text)
    text = text.replace("MISSING", " ")
    text = re.sub(r"\bQUESTION\s+(?:e?wline|newline)\b", " ", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip(" -")
    return text


def valid_pair(question: str, answer: str) -> tuple[bool, str]:
    question_words = re.findall(r"[A-Za-zÀ-ÖØ-öø-ÿ]+", question)
    valid_single_word_prompt = len(question) >= 8 and len(question_words) == 1 and question.rstrip().endswith("?")
    if len(question) < 8 or (len(question_words) < 2 and not valid_single_word_prompt):
        return False, "question_too_short"
    if len(question) > 3500:
        return False, "question_too_long"
    if not answer:
        return False, "missing_answer"
    if len(answer) > 1200:
        return False, "answer_too_long"
    if (
        ANSWER_RE.search(answer)
        or BONUS_RE.search(answer)
        or re.search(r"\b(?:ANSWER|ANS|BONUS|TOSSUP)\s*:", answer, re.I)
        or re.search(r"\(\d{1,3}\)\s+[A-Za-z]", answer)
    ):
        return False, "embedded_marker"
    if not any(ch.isalpha() for ch in question):
        return False, "question_without_letters"
    if re.match(
        r"^(?:the categories are|round \d+|page \d+|scoresheet|rules?|only read if|read only if|"
        r"do not read|extra questions?|tiebreakers?)\b",
        question,
        re.I,
    ):
        return False, "non_question_heading"
    return True, ""


ANSWER_CONTINUATION_RE = re.compile(
    r"^(?:[\[(]|accept\b|also accept\b|prompt\b|do not\b|be lenient\b|or\b|either\b|"
    r"the underlined\b)",
    re.IGNORECASE,
)


def has_open_delimiter(lines: Sequence[str]) -> bool:
    text = " ".join(lines)
    return text.count("(") > text.count(")") or text.count("[") > text.count("]")


def split_answer_segment(lines: Sequence[str], is_last: bool) -> tuple[list[str], list[str]]:
    """Separate an answer prefix from the next unnumbered bonus question."""
    content = [line for line in lines if compact(line)]
    if not content:
        return [], []
    if is_last:
        return content, []
    answer = [content[0]]
    for index, line in enumerate(content[1:], 1):
        stripped = compact(line)
        previous = compact(answer[-1])
        if NUMBER_RE.match(stripped) or BONUS_RE.match(stripped) or SECTION_RE.match(stripped):
            return answer, content[index:]
        continuation = (
            has_open_delimiter(answer)
            or bool(ANSWER_CONTINUATION_RE.match(stripped))
            or bool(
                re.match(
                    r"^(?:before|after|until|on)\b.{0,220}\b(?:read|mentioned|prompt|accept|given|said)\b",
                    stripped,
                    re.I,
                )
            )
            or (
                stripped[:1].islower()
                and not re.match(
                    r"^(?:this|these|that|those|after|before|while|during|when|where|who|what|"
                    r"which|how|upon|once|in|on|at|as|following)\b",
                    stripped,
                    re.I,
                )
            )
            or previous.endswith((",", ";", ":", "/", "-"))
        )
        if continuation:
            answer.append(line)
            continue
        return answer, content[index:]
    return answer, []


def parse_block(block: Block, source_pdf: str) -> tuple[list[RawPair], list[dict], int]:
    text = "\n".join(block.lines).strip()
    if not text or not ANSWER_RE.search(text):
        return [], [], 0
    pairs: list[tuple[list[str], list[str]]] = []
    lines = text.splitlines()
    marker_indices = [index for index, line in enumerate(lines) if ANSWER_RE.match(line)]
    question_lines = lines[: marker_indices[0]]
    structural_markers = 0
    for marker_number, marker_index in enumerate(marker_indices):
        next_index = marker_indices[marker_number + 1] if marker_number + 1 < len(marker_indices) else len(lines)
        inline_answer = ANSWER_RE.sub("", lines[marker_index], count=1)
        segment = ([inline_answer] if compact(inline_answer) else []) + lines[marker_index + 1 : next_index]

        # A small number of packets accidentally print ANSWER: before a bonus
        # prompt. When no question is waiting, treat that segment as the next
        # question rather than inventing an answer pair.
        if not any(compact(line) for line in question_lines):
            question_lines = segment
            structural_markers += 1
            continue

        answer_lines, next_question = split_answer_segment(
            segment,
            is_last=marker_number == len(marker_indices) - 1,
        )
        pairs.append((question_lines, answer_lines))
        question_lines = next_question

    accepted: list[RawPair] = []
    rejected: list[dict] = []
    for question_lines, answer_lines in pairs:
        question = clean_question(question_lines, block.context)
        answer = clean_answer(answer_lines)
        valid, reason = valid_pair(question, answer)
        if valid:
            accepted.append(RawPair(question=question, answer=answer, source_pdf=source_pdf, context=block.context))
        else:
            rejected.append(
                {
                    "reason": reason,
                    "question": question[:500],
                    "answer": answer[:300],
                }
            )
    return accepted, rejected, structural_markers


def parse_unlabeled_numbered(
    pages: Sequence[str], headers: set[str], source_pdf: str
) -> tuple[list[RawPair], list[dict]]:
    """Parse rare packets that put each answer after a question mark without a label."""
    blocks: list[list[str]] = []
    current: list[str] | None = None
    for page in pages:
        for line in cleaned_page_lines(page, headers):
            number = NUMBER_RE.match(line)
            if number:
                if current:
                    blocks.append(current)
                current = [number.group(3)]
            elif current is not None:
                current.append(line)
    if current:
        blocks.append(current)

    accepted: list[RawPair] = []
    rejected: list[dict] = []
    for lines in blocks:
        prompt_indices = [
            index
            for index, line in enumerate(lines)
            if re.search(
                r"\bfor\s+(?:the|ten|10)\s+points?\b",
                " ".join(lines[max(0, index - 1) : index + 1]),
                re.I,
            )
        ]
        end_index = -1
        if prompt_indices:
            for index in range(prompt_indices[-1], len(lines)):
                if re.search(r"[?.][\]\)\"'’”]*$", compact(lines[index])):
                    end_index = index
                    break
            if end_index < 0 and len(lines) >= 2:
                # A few originals omit terminal punctuation on the prompt; in
                # this format the final line is still the standalone answer.
                end_index = len(lines) - 2
        question = clean_question(lines[: end_index + 1]) if end_index >= 0 else ""
        answer = clean_answer(lines[end_index + 1 :]) if end_index >= 0 else ""
        valid, reason = valid_pair(question, answer)
        if valid:
            accepted.append(RawPair(question=question, answer=answer, source_pdf=source_pdf))
        else:
            rejected.append({"reason": reason or "unlabeled_boundary", "question": question[:500], "answer": answer[:300]})
    return accepted, rejected


def parse_global_labeled(
    pages: Sequence[str], headers: set[str], source_pdf: str
) -> list[RawPair]:
    """Recover full, unnumbered tossups that appear between labeled answers."""
    lines: list[str] = []
    for page in pages:
        lines.extend(cleaned_page_lines(page, headers))
    marker_indices = [index for index, line in enumerate(lines) if ANSWER_RE.match(line)]
    if not marker_indices:
        return []

    def trim_number_prefix(question_lines: Sequence[str]) -> list[str]:
        last_number = -1
        replacement = ""
        for index, line in enumerate(question_lines):
            number = NUMBER_RE.match(line)
            if number:
                last_number = index
                replacement = number.group(3)
        if last_number >= 0:
            return [replacement, *question_lines[last_number + 1 :]]
        return list(question_lines)

    recovered: list[RawPair] = []
    question_lines = trim_number_prefix(lines[: marker_indices[0]])
    for marker_number, marker_index in enumerate(marker_indices):
        next_index = marker_indices[marker_number + 1] if marker_number + 1 < len(marker_indices) else len(lines)
        inline_answer = ANSWER_RE.sub("", lines[marker_index], count=1)
        segment = ([inline_answer] if compact(inline_answer) else []) + lines[marker_index + 1 : next_index]
        if not any(compact(line) for line in question_lines):
            question_lines = trim_number_prefix(segment)
            continue
        answer_lines, next_question = split_answer_segment(
            segment,
            is_last=marker_number == len(marker_indices) - 1,
        )
        question = clean_question(trim_number_prefix(question_lines))
        answer = clean_answer(answer_lines)
        valid, _ = valid_pair(question, answer)
        # Context-aware pairs already present in the block pass are filtered by
        # answer/question identity before these recovery pairs are added.
        if valid:
            recovered.append(RawPair(question=question, answer=answer, source_pdf=source_pdf))
        question_lines = trim_number_prefix(next_question)
    return recovered


def extract_pdf(path: Path, relative_path: str) -> tuple[list[RawPair], dict]:
    import pdfplumber

    audit: dict = {
        "path": relative_path,
        "sha256": sha256_file(path),
        "bytes": path.stat().st_size,
        "pages": 0,
        "answer_markers": 0,
        "extracted_pairs": 0,
        "rejected_pairs": 0,
        "rejected_examples": [],
        "status": "ok",
    }
    try:
        with pdfplumber.open(path) as pdf:
            pages = [(page.extract_text(x_tolerance=2, y_tolerance=3) or "") for page in pdf.pages]
    except Exception as exc:  # pragma: no cover - depends on third-party PDFs
        audit["status"] = "error"
        audit["error"] = f"{type(exc).__name__}: {exc}"
        return [], audit

    audit["pages"] = len(pages)
    headers = repeated_page_headers(pages)
    audit["removed_repeated_headers"] = sorted(headers)
    audit["answer_markers"] = sum(len(ANSWER_RE.findall(normalize_chars(page))) for page in pages)

    blocks: list[Block] = []
    current: Block | None = None
    active_context = ""
    collecting_context = False
    current_section = ""
    orphan_topic = ""
    skipping_category_listing = False

    def topic_from_line(value: str) -> str:
        return compact(ANSWER_RE.sub("", value, count=1))

    def finish_current() -> None:
        nonlocal current
        if current and current.lines:
            blocks.append(current)
        current = None

    for page in pages:
        lines = cleaned_page_lines(page, headers)
        first_content = True
        for line_index, line in enumerate(lines):
            if SECTION_RE.match(line):
                if current and ANSWER_RE.search("\n".join(current.lines)):
                    finish_current()
                current_section = line.lower()
                active_context = ""
                skipping_category_listing = bool(
                    re.search(r"third quarter|quarter\s*3", current_section, re.I)
                )
                collecting_context = False
                first_content = False
                continue

            if skipping_category_listing:
                category_number = NUMBER_RE.match(line)
                if (
                    category_number
                    and len(line) <= 180
                    and not re.search(r"[?]$", category_number.group(3))
                ):
                    first_content = False
                    continue
                skipping_category_listing = False

            if CONTEXT_RE.match(line) and (
                current is None or ANSWER_RE.search("\n".join(current.lines))
            ):
                context_line = line
                if line[:1].islower():
                    prefix_lines: list[str] = []
                    for candidate in reversed(lines[max(0, line_index - 3) : line_index]):
                        if (
                            ANSWER_RE.match(candidate)
                            or BONUS_RE.match(candidate)
                            or NUMBER_RE.match(candidate)
                            or SECTION_RE.match(candidate)
                        ):
                            break
                        prefix_lines.insert(0, candidate)
                    if prefix_lines:
                        context_line = join_wrapped([*prefix_lines, line])
                if not orphan_topic and line_index:
                    prior_line = lines[line_index - 1]
                    if (
                        len(prior_line) < 140
                        and not re.search(r"[.!?;:]$", prior_line)
                        and not ANSWER_RE.match(prior_line)
                        and not BONUS_RE.match(prior_line)
                        and not NUMBER_RE.match(prior_line)
                    ):
                        orphan_topic = topic_from_line(prior_line)
                if current and current.lines:
                    trailing = current.lines[-1]
                    if (
                        ANSWER_RE.search("\n".join(current.lines[:-1]))
                        and len(trailing) < 140
                        and not re.search(r"[.!?;:]$", trailing)
                        and not ANSWER_RE.match(trailing)
                    ):
                        orphan_topic = topic_from_line(current.lines.pop())
                if current:
                    finish_current()
                if re.fullmatch(r"Name the(?:\.{2,}|…)", line, re.I) and orphan_topic:
                    active_context = f"Concerning {orphan_topic}, name the"
                else:
                    active_context = context_line
                orphan_topic = ""
                collecting_context = True
                first_content = False
                continue

            number = NUMBER_RE.match(line)
            if number:
                finish_current()
                current = Block(lines=[number.group(3)], context=active_context)
                collecting_context = False
                first_content = False
                continue

            if collecting_context and current is None:
                # Capture a wrapped shared category prompt, but never swallow a
                # packet marker or a new short topic heading.
                if ANSWER_RE.match(line) or BONUS_RE.match(line) or SECTION_RE.match(line):
                    collecting_context = False
                elif len(active_context) + len(line) < 700:
                    active_context = compact(active_context + " " + line)
                    first_content = False
                    continue

            if current is not None:
                # A short title at the start of a new page after a completed
                # answer is a category heading, not part of that answer.
                if (
                    first_content
                    and ANSWER_RE.search("\n".join(current.lines))
                    and len(line) < 100
                    and not re.search(r"[.!?;:]$", line)
                    and not ANSWER_RE.match(line)
                    and not BONUS_RE.match(line)
                ):
                    finish_current()
                    orphan_topic = line
                else:
                    current.lines.append(line)
            elif len(line) < 140 and not re.search(r"[.!?;:]$", line):
                orphan_topic = topic_from_line(line)
            first_content = False
    finish_current()

    pairs: list[RawPair] = []
    rejected: list[dict] = []
    structural_markers = 0
    for block in blocks:
        block_pairs, block_rejected, block_structural = parse_block(block, relative_path)
        pairs.extend(block_pairs)
        rejected.extend(block_rejected)
        structural_markers += block_structural
    recovered_pairs: list[RawPair] = []
    if audit["answer_markers"] > len(pairs) + structural_markers:
        seen_answers = {answer_core(pair.answer) or canonical(pair.answer) for pair in pairs}
        seen_questions = {canonical(pair.question) for pair in pairs}
        for pair in parse_global_labeled(pages, headers, relative_path):
            answer_key = answer_core(pair.answer) or canonical(pair.answer)
            question_key = canonical(pair.question)
            if answer_key and answer_key not in seen_answers and question_key not in seen_questions:
                recovered_pairs.append(pair)
                seen_answers.add(answer_key)
                seen_questions.add(question_key)
        pairs.extend(recovered_pairs)
    labeled_pairs = len(pairs)
    unlabeled_pairs: list[RawPair] = []
    unlabeled_rejected: list[dict] = []
    if not pairs and not audit["answer_markers"]:
        unlabeled_pairs, unlabeled_rejected = parse_unlabeled_numbered(pages, headers, relative_path)
        pairs.extend(unlabeled_pairs)
        rejected.extend(unlabeled_rejected)
    audit["extracted_pairs"] = len(pairs)
    audit["labeled_pairs"] = labeled_pairs
    audit["unlabeled_pairs"] = len(unlabeled_pairs)
    audit["global_recovered_pairs"] = len(recovered_pairs)
    audit["structural_answer_markers"] = structural_markers
    audit["rejected_pairs"] = len(rejected)
    audit["rejected_examples"] = rejected[:20]
    audit["marker_pair_delta"] = audit["answer_markers"] - labeled_pairs - structural_markers
    if not pairs:
        audit["status"] = "no_pairs"
    return pairs, audit


def tokenize(value: str) -> list[str]:
    words = re.findall(r"[a-z][a-z'’-]{1,}", normalize_chars(value).casefold())
    words = [word.strip("'’-") for word in words if word not in STOPWORDS and len(word.strip("'’-")) > 1]
    return words[:600]


class NaiveBayesText:
    def __init__(self, labels: Sequence[str]) -> None:
        self.labels = list(labels)
        self.docs: Counter[str] = Counter()
        self.counts: dict[str, Counter[str]] = {label: Counter() for label in self.labels}
        self.totals: Counter[str] = Counter()
        self.vocabulary: set[str] = set()
        self.priors: dict[str, float] = {}
        self.denominators: dict[str, int] = {}

    def fit(self, rows: Iterable[tuple[str, str]]) -> None:
        for text, label in rows:
            if label not in self.counts:
                continue
            self.docs[label] += 1
            tokens = tokenize(text)
            self.counts[label].update(tokens)
            self.totals[label] += len(tokens)
            self.vocabulary.update(tokens)
        vocab_size = max(1, len(self.vocabulary))
        total_docs = sum(self.docs.values())
        self.priors = {
            label: math.log((self.docs[label] + 1) / (total_docs + len(self.labels)))
            for label in self.labels
        }
        self.denominators = {label: self.totals[label] + vocab_size for label in self.labels}

    def predict(self, text: str, default: str, minimum_margin: float = 1.4) -> str:
        tokens = tokenize(text)
        if not tokens or not sum(self.docs.values()):
            return default
        token_counts = Counter(tokens)
        scores: dict[str, float] = {}
        for label in self.labels:
            score = self.priors[label]
            denominator = self.denominators[label]
            for token, count in token_counts.items():
                score += count * math.log((self.counts[label][token] + 1) / denominator)
            scores[label] = score
        ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
        if len(ranked) > 1 and ranked[0][1] - ranked[1][1] < minimum_margin:
            return default
        return ranked[0][0]


def majority_profiles(items: Sequence[dict], field: str) -> dict[str, str]:
    counts: dict[str, Counter[str]] = defaultdict(Counter)
    for item in items:
        key = answer_core(item.get("answer", ""))
        label = compact((item.get("meta") or {}).get(field, ""))
        if key and label:
            counts[key][label] += 1
    profiles: dict[str, str] = {}
    for key, options in counts.items():
        label, count = options.most_common(1)[0]
        if count / sum(options.values()) >= 0.6:
            profiles[key] = label
    return profiles


def year_to_era(year: float) -> str:
    if year < -600:
        return "01"
    if year < 600:
        return "02"
    if year < 1450:
        return "03"
    if year < 1750:
        return "04"
    if year < 1914:
        return "05"
    if year < 1991:
        return "06"
    return "07"


def explicit_era(text: str) -> str:
    years: list[float] = []
    occupied_spans: list[tuple[int, int]] = []
    for match in CENTURY_RE.finditer(text):
        century = int(match.group(1))
        suffix = compact(match.group(2)).replace(".", "").upper()
        midpoint = (century - 0.5) * 100
        if suffix.startswith("B"):
            midpoint = -midpoint
        years.append(midpoint)
        occupied_spans.append(match.span())
    for match in YEAR_RE.finditer(text):
        if any(start <= match.start() < end for start, end in occupied_spans):
            continue
        year = int(match.group(1))
        suffix = compact(match.group(2)).replace(".", "").upper()
        if year < 100 and not suffix:
            continue
        if suffix.startswith("B"):
            year = -year
        years.append(float(year))
    return year_to_era(statistics.median(years)) if years else ""


def normalized_item(item: dict) -> dict:
    meta = item.get("meta") if isinstance(item.get("meta"), dict) else {}
    aliases = item.get("aliases") if isinstance(item.get("aliases"), list) else []
    return {
        "id": compact(item.get("id", "")),
        "question": compact(item.get("question", "")),
        # Apply the same layout cleanup to legacy rows so the merged bank does
        # not preserve old quarter/page labels as part of an answer.
        "answer": clean_answer([item.get("answer", "")]),
        "aliases": [compact(alias) for alias in aliases if compact(alias)],
        "meta": {
            "category": compact(meta.get("category", "")),
            "era": compact(meta.get("era", "")),
            "source": compact(meta.get("source", "")) or "original",
        },
    }


def stable_id(question: str, answer: str) -> str:
    digest = hashlib.sha256((canonical(question) + "\0" + canonical(answer)).encode("utf-8")).hexdigest()
    return f"official_{digest[:20]}"


def near_duplicate(left: str, right: str) -> bool:
    left_key = canonical(left)
    right_key = canonical(right)
    if not left_key or not right_key:
        return False
    if left_key == right_key:
        return True
    shorter, longer = sorted((left_key, right_key), key=len)
    length_ratio = len(shorter) / max(1, len(longer))
    if len(shorter) >= 120 and shorter in longer and length_ratio >= 0.78:
        return True
    if length_ratio < 0.78:
        return False
    sequence_ratio = SequenceMatcher(None, shorter, longer, autojunk=False).ratio()
    if sequence_ratio >= 0.965:
        return True
    left_tokens = set(tokenize(left))
    right_tokens = set(tokenize(right))
    union = left_tokens | right_tokens
    jaccard = len(left_tokens & right_tokens) / len(union) if union else 0
    return length_ratio >= 0.86 and jaccard >= 0.92


def merge_duplicate(kept: dict, duplicate: dict, fuzzy: bool = False) -> None:
    if fuzzy and len(duplicate.get("question", "")) > len(kept.get("question", "")):
        kept["question"] = duplicate["question"]
    aliases = list(kept.get("aliases") or [])
    kept_answer_key = answer_core(kept.get("answer", ""))
    duplicate_answer = compact(duplicate.get("answer", ""))
    if duplicate_answer and answer_core(duplicate_answer) != kept_answer_key:
        aliases.append(duplicate_answer)
    aliases.extend(duplicate.get("aliases") or [])
    seen: set[str] = set()
    kept["aliases"] = [
        alias for alias in aliases
        if canonical(alias) and canonical(alias) != canonical(kept.get("answer", ""))
        and not (canonical(alias) in seen or seen.add(canonical(alias)))
    ]


def deduplicate(existing: Sequence[dict], new_items: Sequence[dict], provenance: dict[str, list[str]]) -> tuple[list[dict], list[dict], dict]:
    rows = [(normalized_item(item), "existing") for item in existing]
    rows.extend((normalized_item(item), "new") for item in new_items)
    survivors: list[dict] = []
    origins: list[str] = []
    exact: dict[str, int] = {}
    by_answer: dict[str, list[int]] = defaultdict(list)
    report = Counter()

    for item, origin in rows:
        question_key = canonical(item["question"])
        if not question_key or not item["answer"]:
            report[f"invalid_{origin}"] += 1
            continue
        duplicate_index = exact.get(question_key)
        fuzzy = False
        if duplicate_index is None:
            core = answer_core(item["answer"])
            candidates = by_answer.get(core, []) if core else []
            for candidate_index in candidates:
                if near_duplicate(survivors[candidate_index]["question"], item["question"]):
                    duplicate_index = candidate_index
                    fuzzy = True
                    break
        if duplicate_index is not None:
            previous_question_key = canonical(survivors[duplicate_index]["question"])
            merge_duplicate(survivors[duplicate_index], item, fuzzy=fuzzy)
            merged_question_key = canonical(survivors[duplicate_index]["question"])
            if merged_question_key and merged_question_key != previous_question_key:
                # A fuzzy merge may retain the longer wording. Index both
                # forms so a later exact copy of either cannot survive.
                exact[merged_question_key] = duplicate_index
            report[f"{origin}_{'fuzzy' if fuzzy else 'exact'}_duplicate"] += 1
            kept_id = survivors[duplicate_index]["id"]
            if item["id"] != kept_id and item["id"] in provenance:
                provenance.setdefault(kept_id, []).extend(provenance.pop(item["id"]))
            continue
        index = len(survivors)
        survivors.append(item)
        origins.append(origin)
        exact[question_key] = index
        core = answer_core(item["answer"])
        if core:
            by_answer[core].append(index)

    new_survivors = [item for item, origin in zip(survivors, origins) if origin == "new"]
    report["existing_input"] = len(existing)
    report["new_input"] = len(new_items)
    report["merged_unique"] = len(survivors)
    report["new_unique_added"] = len(new_survivors)
    return survivors, new_survivors, dict(sorted(report.items()))


def build_new_items(raw_pairs: Sequence[RawPair], existing: Sequence[dict]) -> tuple[list[dict], dict[str, list[str]], dict]:
    category_model = NaiveBayesText(CATEGORIES)
    era_model = NaiveBayesText(ERAS)
    category_model.fit(
        (f"{item.get('question', '')} {item.get('answer', '')}", compact((item.get("meta") or {}).get("category", "")))
        for item in existing
    )
    era_model.fit(
        (f"{item.get('question', '')} {item.get('answer', '')}", compact((item.get("meta") or {}).get("era", "")))
        for item in existing
    )
    category_profiles = majority_profiles(existing, "category")
    era_profiles = majority_profiles(existing, "era")

    items: list[dict] = []
    provenance: dict[str, list[str]] = defaultdict(list)
    classification_sources = Counter()
    for pair in raw_pairs:
        key = answer_core(pair.answer)
        category = category_profiles.get(key, "")
        if category:
            classification_sources["category_answer_match"] += 1
        else:
            category = category_model.predict(f"{pair.question} {pair.answer}", "World", 1.6)
            classification_sources["category_text_model"] += 1
        era = era_profiles.get(key, "")
        if era:
            classification_sources["era_answer_match"] += 1
        else:
            era = explicit_era(pair.question)
            if era:
                classification_sources["era_explicit_date"] += 1
            else:
                era = era_model.predict(f"{pair.question} {pair.answer}", "", 1.7)
                classification_sources["era_text_model"] += 1
        if category not in CATEGORIES:
            category = "World"
        if era not in ERAS:
            era = ""
        item_id = stable_id(pair.question, pair.answer)
        item = {
            "id": item_id,
            "question": pair.question,
            "answer": pair.answer,
            "aliases": [],
            "meta": {"category": category, "era": era, "source": "original"},
        }
        items.append(item)
        provenance[item_id].append(pair.source_pdf)
    return items, dict(provenance), dict(sorted(classification_sources.items()))


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def extract_pdf_job(job: tuple[Path, str]) -> tuple[list[RawPair], dict]:
    """Top-level worker wrapper so Windows process spawning can pickle it."""
    return extract_pdf(*job)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf-root", type=Path, required=True)
    parser.add_argument("--existing", type=Path, default=Path("questions.json"))
    parser.add_argument("--new-output", type=Path, default=Path("new_questions.json"))
    parser.add_argument("--merged-output", type=Path, default=Path("questions.json"))
    parser.add_argument("--audit-output", type=Path, required=True)
    parser.add_argument(
        "--workers",
        type=int,
        default=min(8, os.cpu_count() or 1),
        help="PDF extraction workers (default: up to 8 local processes)",
    )
    parser.add_argument(
        "--extract-only",
        action="store_true",
        help="stop after writing the per-PDF extraction audit",
    )
    args = parser.parse_args()
    if args.workers < 1:
        parser.error("--workers must be at least 1")

    existing_payload = json.loads(args.existing.read_text(encoding="utf-8-sig"))
    existing_items = existing_payload.get("items")
    if not isinstance(existing_items, list):
        raise ValueError("existing question bank must contain an items array")

    pdf_paths = sorted(args.pdf_root.rglob("*.pdf"), key=lambda path: str(path).casefold())
    raw_pairs: list[RawPair] = []
    file_audits: list[dict] = []
    seen_pdf_hashes: dict[str, str] = {}
    unique_jobs: list[tuple[Path, str]] = []
    for pdf_path in pdf_paths:
        relative = str(pdf_path.relative_to(args.pdf_root)).replace("\\", "/")
        digest = sha256_file(pdf_path)
        if digest in seen_pdf_hashes:
            file_audits.append(
                {
                    "path": relative,
                    "sha256": digest,
                    "bytes": pdf_path.stat().st_size,
                    "status": "duplicate_file",
                    "duplicate_of": seen_pdf_hashes[digest],
                }
            )
            continue
        seen_pdf_hashes[digest] = relative
        unique_jobs.append((pdf_path, relative))

    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as executor:
        results = executor.map(extract_pdf_job, unique_jobs, chunksize=1)
        for index, (job, result) in enumerate(zip(unique_jobs, results), 1):
            pairs, audit = result
            raw_pairs.extend(pairs)
            file_audits.append(audit)
            print(
                f"[{index}/{len(unique_jobs)} unique] {job[1]}: "
                f"{audit['status']} ({len(pairs)} pairs)",
                flush=True,
            )

    file_audits.sort(key=lambda audit: audit["path"].casefold())

    if args.extract_only:
        status_counts = Counter(audit.get("status", "unknown") for audit in file_audits)
        audit_payload = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "pdf_root": str(args.pdf_root.resolve()),
            "pdfs_discovered": len(pdf_paths),
            "unique_pdf_files": len(seen_pdf_hashes),
            "file_status_counts": dict(sorted(status_counts.items())),
            "answer_markers": sum(audit.get("answer_markers", 0) for audit in file_audits),
            "raw_pairs_extracted": len(raw_pairs),
            "files": file_audits,
        }
        write_json(args.audit_output, audit_payload)
        print(json.dumps({"pdfs": len(pdf_paths), "raw_pairs": len(raw_pairs), "audit": str(args.audit_output)}, indent=2))
        return 0

    candidate_items, provenance, classification_sources = build_new_items(raw_pairs, existing_items)
    merged_items, new_items, dedupe_report = deduplicate(existing_items, candidate_items, provenance)

    category_order = {category: index for index, category in enumerate(CATEGORIES)}
    new_items.sort(
        key=lambda item: (
            category_order.get(item["meta"]["category"], 999),
            item["meta"]["era"],
            canonical(item["answer"]),
            canonical(item["question"]),
        )
    )
    new_payload = {
        "id": "set_official_import_20260829",
        "name": "New official IHBB questions (Europe, Canada, and US divisions)",
        "categories": list(existing_payload.get("categories") or CATEGORIES),
        "items": new_items,
    }
    merged_payload = dict(existing_payload)
    merged_payload["items"] = merged_items
    write_json(args.new_output, new_payload)
    write_json(args.merged_output, merged_payload)

    status_counts = Counter(audit.get("status", "unknown") for audit in file_audits)
    category_counts = Counter(item["meta"]["category"] for item in new_items)
    era_counts = Counter(item["meta"]["era"] for item in new_items)
    audit_payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "pdf_root": str(args.pdf_root.resolve()),
        "pdfs_discovered": len(pdf_paths),
        "unique_pdf_files": len(seen_pdf_hashes),
        "file_status_counts": dict(sorted(status_counts.items())),
        "answer_markers": sum(audit.get("answer_markers", 0) for audit in file_audits),
        "raw_pairs_extracted": len(raw_pairs),
        "candidate_items": len(candidate_items),
        "deduplication": dedupe_report,
        "classification_sources": classification_sources,
        "new_category_counts": dict(sorted(category_counts.items())),
        "new_era_counts": dict(sorted(era_counts.items())),
        "provenance": {key: sorted(set(value)) for key, value in sorted(provenance.items())},
        "files": file_audits,
    }
    write_json(args.audit_output, audit_payload)
    print(json.dumps({
        "pdfs": len(pdf_paths),
        "raw_pairs": len(raw_pairs),
        "new_unique": len(new_items),
        "merged_unique": len(merged_items),
        "audit": str(args.audit_output),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
