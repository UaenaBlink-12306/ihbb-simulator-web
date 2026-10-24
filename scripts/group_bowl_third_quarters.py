"""Restore packet-defined Bowl third-quarter groups without guessing from clue length.

Run with --pdf-root pointing at the original official packets. Existing IDs and
question/answer text are retained. The audit retains the raw source clues,
restoration totals, and any repairs to defective source wording.
"""
from __future__ import annotations
import argparse
import concurrent.futures
import hashlib
import json
import logging
import re
from pathlib import Path
from import_question_pdfs import (compact, canonical, normalize_chars,
    repeated_page_headers, cleaned_page_lines, clean_question,
    clean_answer, answer_core, RawPair, build_new_items)

START = re.compile(r"^(?:(?:Third\s+Quarter|Quarter\s*3)(?:\s*[-–—:].*)?|Sixty[- ]Second Rounds?|60[- ]Second Rounds?)\s*:?$", re.I)
STOP = re.compile(r"^(?:Fourth\s+Quarter|Quarter\s*4|Second Half|Tiebreakers?|Extra Questions?)\b", re.I)
NUMBER_RE = re.compile(r'^\s*(?:\((\d{1,2})\)\s*|(\d{1,2})[.)]\s*)(\S.*)$')
GROUP_ANSWER = re.compile(r'^\s*(?:ANSWER|ANS)(?:\s*[:.]\s*|\s+(?!some\b))', re.I)
PROMPT = re.compile(r"^(?:Name\b|Concerning\b|Regarding\b|Which\b|What\b|Who\b|Identify\b|Given\b|For each\b|In (?!Memoriam\b)|During\b|With regard|If an answer|Before, during|Answer some)", re.I)

def read_packet(job):
    path, relative, cache = job
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    target = cache / (digest + '.json')
    if target.exists():
        return relative, json.loads(target.read_text(encoding='utf-8'))
    from pypdf import PdfReader
    logging.getLogger('pypdf').setLevel(logging.ERROR)
    try:
        reader = PdfReader(path)
        pages = [normalize_chars(p.extract_text(extraction_mode='layout').replace('\t\r', ' ')) for p in reader.pages]
        # Use line boundaries supplied by the layout reader; some older packets
        # encode carriage returns between every word.
        result = {'sha256': digest, 'pages': pages}
    except Exception as exc:
        result = {'sha256': digest, 'error': str(exc), 'pages': []}
    target.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    return relative, result

def extract_groups(pages):
    if pages and re.search(r"International Academic Bowl", pages[0], re.I):
        return []
    pages = ['\n'.join(compact(line) for line in page.split('\n')) for page in pages]
    pages = [re.sub(r'(?m)^(\d{4})$', r'TOPIC_YEAR: \1', page) for page in pages]
    pages = [re.sub(r'(?im)^(?:(?:Bowl Round \d+|N?HBB[^\n]*)\s*[-–—]\s*)?Third Quarter\b[^\n]*$', 'Third Quarter', page) for page in pages]
    pages = [re.sub(r'(?im)^(\s*(?:Third\s+Quarter|Quarter\s*3))\s+(The categories)', r'\1\n\2', page) for page in pages]
    pages = [re.sub(r'(\S)[ \t]+((?:ANSWER|ANS)\s*:)', r'\1\n\2', page) for page in pages]
    headers = repeated_page_headers(pages)
    section = []
    active = False
    for page_no, page in enumerate(pages, 1):
        for line in cleaned_page_lines(page, headers):
            line = line.removeprefix('TOPIC_YEAR: ')
            if line == 'DRAFT':
                continue
            if START.match(line):
                active = True
                continue
            if active and STOP.match(line):
                active = False
            if active:
                section.append((line, page_no))
    starts = [i for i, (line, _) in enumerate(section) if (m := NUMBER_RE.match(line)) and int(m.group(1) or m.group(2)) == 1 and (i == 0 or not GROUP_ANSWER.match(section[i-1][0]))]
    result = []
    for pos, start in enumerate(starts):
        page_no = section[start][1]
        # Topic titles and shared prompts precede Q1, normally on its page.
        prefix_start = start
        while prefix_start and not NUMBER_RE.match(section[prefix_start-1][0]) and not GROUP_ANSWER.match(section[prefix_start-1][0]):
            prefix_start -= 1
        prefix = [line for line, _ in section[prefix_start:start]]
        same_page = [line for line, page in section[prefix_start:start] if page == page_no]
        if same_page and not PROMPT.match(same_page[0]):
            prefix = same_page
        if not prefix:
            continue
        prompt_at = next((i for i, line in enumerate(prefix) if PROMPT.match(line)), len(prefix))
        title_lines = prefix[:prompt_at]
        # Older category listings share a page with the first topic. The actual
        # title is the last line before its shared prompt.
        if any(re.search(r'categor(?:y|ies)', line, re.I) for line in title_lines):
            title_lines = title_lines[-1:]
        # Some shared prompts are full sentences rather than "Name the...".
        # Keep those sentences in the prompt, not in the topic heading.
        if len(title_lines) > 1:
            heading_at = next((i for i, line in enumerate(title_lines) if not re.search(r'[\]};.!?]', line) and not line.startswith('<')), 0)
            prompt_at = heading_at + 1
            title_lines = title_lines[heading_at:heading_at+1]
        topic = compact(' '.join(title_lines))
        prompt = compact(' '.join(prefix[prompt_at:]))
        if not topic or len(topic) > 200:
            continue
        end = starts[pos+1] if pos+1 < len(starts) else len(section)
        numbered = [(i, NUMBER_RE.match(section[i][0])) for i in range(start, end) if NUMBER_RE.match(section[i][0])]
        questions = []
        for qi, (index, marker) in enumerate(numbered):
            finish = numbered[qi+1][0] if qi+1 < len(numbered) else end
            # Stop at the next topic heading, including topics sharing a page.
            if qi + 1 == len(numbered) and pos + 1 < len(starts):
                next_page = section[starts[pos+1]][1]
                while finish > index + 1 and section[finish-1][1] == next_page and not NUMBER_RE.match(section[finish-1][0]) and not GROUP_ANSWER.match(section[finish-1][0]):
                    finish -= 1
            block = [marker.group(3)] + [line for line, _ in section[index+1:finish]]
            answer_at = next((j for j, line in enumerate(block) if GROUP_ANSWER.match(line)), None)
            if answer_at is None:
                continue
            questions.append({'number': int(marker.group(1) or marker.group(2)), 'question': clean_question(block[:answer_at]), 'answer': clean_answer([GROUP_ANSWER.sub('', block[answer_at])] + block[answer_at+1:]), 'page': section[index][1]})
        if questions:
            result.append({'topic': topic, 'prompt': prompt, 'page': page_no, 'questions': questions})
    return result

def question_key(value):
    return canonical(re.sub(r'\[.*?\]', '', value))

def restore_bank(payload, raw_groups):
    """Add ordered ID references; retain every existing question and its ID."""
    items = payload['items']
    original_items = list(items)
    by_suffix = {}
    cached_keys = {}
    for item in items:
        key = question_key(item['question'])
        cached_keys[item['id']] = key
        for size in range(1, min(20, len(key)) + 1):
            by_suffix.setdefault(key[-size:], []).append(item)
    pending = []
    pending_keys = {}
    groups = []
    repairs = []
    for raw in raw_groups:
        questions = raw['questions']
        # One official export repeats its Q6 wording at Q8, while retaining the
        # Q8 answer. Recover that wording only from a parallel official packet
        # with the same topic and all other questions identical.
        seen_questions = set()
        for index, question in enumerate(questions):
            key = question_key(question['question'])
            if key in seen_questions:
                for parallel in raw_groups:
                    if parallel is raw or question_key(parallel['topic']) != question_key(raw['topic']) or len(parallel['questions']) != len(questions):
                        continue
                    replacement = parallel['questions'][index]
                    if answer_core(replacement['answer']) == answer_core(question['answer']) and question_key(replacement['question']) != key and all(question_key(a['question']) == question_key(b['question']) for i, (a, b) in enumerate(zip(questions, parallel['questions'])) if i != index):
                        repairs.append({'packet': raw['packet'], 'topic': raw['topic'], 'number': question['number'], 'wording_from': parallel['packet']})
                        question['question'] = replacement['question']
                        key = question_key(question['question'])
                        break
            seen_questions.add(key)
        references = []
        for question in questions:
            key = question_key(question['question'])
            candidates = by_suffix.get(key[-20:], [])
            matches = [item for item in candidates if cached_keys[item['id']].endswith(key)]
            if matches:
                matches.sort(key=lambda item: (cached_keys[item['id']] != key, question_key(raw['topic']) not in cached_keys[item['id']]))
                references.append(matches[0]['id'])
                continue
            # Recover source clues lost in the old extraction (notably numeric
            # answers). Include the shared topic so generic clues remain useful.
            context = f"Concerning {raw['topic']}, {raw['prompt'] or 'name the following.'}"
            text = clean_question([question['question']], context)
            new_key = canonical(text)
            if new_key not in pending_keys:
                pending_keys[new_key] = len(pending)
                pending.append(RawPair(question=text, answer=question['answer'], source_pdf=raw['packet'], context=context))
            references.append(('new', pending_keys[new_key]))
        group_id = 'bowl-q3-' + hashlib.sha256((raw['packet'] + '\n' + raw['topic'] + '\n' + str(raw['page'])).encode('utf-8')).hexdigest()[:16]
        groups.append({'id': group_id, 'topic': raw['topic'], 'prompt': raw['prompt'], 'packet': raw['packet'], 'questionIds': references})
    recovered, _, _ = build_new_items(pending, original_items) if pending else ([], {}, {})
    by_id = {item['id']: item for item in original_items}
    by_question = {canonical(item['question']): item for item in original_items}
    recovered_ids = []
    unique_recovered = []
    for item in recovered:
        # Curated wording can change after an official ID was assigned. Keep
        # that curated item when its stable source ID is encountered again.
        existing = by_id.get(item['id']) or by_question.get(canonical(item['question']))
        if existing:
            recovered_ids.append(existing['id'])
        else:
            recovered_ids.append(item['id'])
            unique_recovered.append(item)
            by_id[item['id']] = item
            by_question[canonical(item['question'])] = item
    for group in groups:
        group['questionIds'] = [recovered_ids[ref[1]] if isinstance(ref, tuple) else ref for ref in group['questionIds']]
        # Retain repeated slots when a packet itself prints the same clue twice.
    items.extend(unique_recovered)
    payload['bowlThirdQuarterGroups'] = groups
    return {'original_questions_retained': len(original_items), 'recovered_source_questions': len(unique_recovered), 'topic_groups': len(groups), 'grouped_questions': len({qid for group in groups for qid in group['questionIds']}), 'source_wording_repairs': repairs}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pdf-root', type=Path, required=True)
    parser.add_argument('--bank', type=Path, default=Path('questions.json'))
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--audit', type=Path, required=True)
    parser.add_argument('--workers', type=int, default=8)
    parser.add_argument('--extract-only', action='store_true')
    args = parser.parse_args()
    if not args.pdf_root.is_dir():
        parser.error('--pdf-root must be the existing packet directory')
    args.cache.mkdir(parents=True, exist_ok=True)
    paths = sorted((p for p in args.pdf_root.rglob('*.pdf') if 'bowl' in str(p).lower()), key=lambda p: str(p).lower())
    raw_groups = []
    seen = set()
    files = []
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        for relative, data in pool.map(read_packet, [(p, p.relative_to(args.pdf_root).as_posix(), args.cache) for p in paths]):
            if data['sha256'] in seen:
                continue
            seen.add(data['sha256'])
            groups = extract_groups(data['pages'])
            files.append({'path': relative, 'groups': len(groups), 'error': data.get('error')})
            for group in groups:
                group['packet'] = relative
                raw_groups.append(group)
            if len(files) % 50 == 0:
                print(f'Read {len(files)} packets, {len(raw_groups)} topics', flush=True)
    report = {'files': files, 'groups': raw_groups}
    if not args.extract_only:
        if not raw_groups:
            raise ValueError('No packet-defined topics found; the question bank was not changed')
        payload = json.loads(args.bank.read_text(encoding='utf-8-sig'))
        report['restoration'] = restore_bank(payload, raw_groups)
        args.bank.write_text(json.dumps(payload, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    args.audit.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'packets':len(files), 'groups':len(raw_groups), 'questions':sum(len(g['questions']) for g in raw_groups)}), flush=True)

if __name__ == '__main__':
    main()
