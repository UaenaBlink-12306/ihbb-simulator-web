"""Import official Asia PDF/Word packets without replacing existing IDs or groups.

Pass the checked-in manifest and a directory containing each manifest path.
Use --extract-only first to inspect marker counts and packet-defined topic groups.
Raw text caches and full audits belong outside committed source.
"""
from __future__ import annotations
import argparse
import concurrent.futures
import copy
import hashlib
from collections import Counter, defaultdict
from difflib import SequenceMatcher
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from import_question_pdfs import (RawPair, extract_pdf, extract_pages, canonical,
    clean_question, answer_core, build_new_items, write_json, near_duplicate, tokenize)
from group_bowl_third_quarters import read_packet, extract_groups

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
PARSER_FINGERPRINT = hashlib.sha256(b''.join((Path(__file__).parent / name).read_bytes()
    for name in ['import_asia_archive.py', 'import_question_pdfs.py', 'group_bowl_third_quarters.py'])).hexdigest()[:16]

def docx_pages(path):
    """Restore native decimal list numbers, which are absent from w:t text."""
    with zipfile.ZipFile(path) as archive:
        document = ET.fromstring(archive.read('word/document.xml'))
        numbering = ET.fromstring(archive.read('word/numbering.xml')) if 'word/numbering.xml' in archive.namelist() else ET.Element('empty')
    abstracts = {n.get(W+'abstractNumId'): n for n in numbering.findall(W+'abstractNum')}
    nums = {n.get(W+'numId'): n for n in numbering.findall(W+'num')}
    counters = {}
    pages, lines = [], []
    for para in document.iter(W+'p'):
        text = ''.join((e.text or '') if e.tag == W+'t' else '\n' if e.tag == W+'br' else '\t' if e.tag == W+'tab' else '' for e in para.iter())
        prop = para.find(W+'pPr/'+W+'numPr')
        if prop is not None and text.strip():
            num_id = prop.find(W+'numId')
            level = prop.find(W+'ilvl')
            num_id = num_id.get(W+'val') if num_id is not None else None
            level = level.get(W+'val') if level is not None else '0'
            num = nums.get(num_id)
            abstract_id = num.find(W+'abstractNumId') if num is not None else None
            abstract = abstracts.get(abstract_id.get(W+'val')) if abstract_id is not None else None
            lvl = next((x for x in abstract.findall(W+'lvl') if x.get(W+'ilvl') == level), None) if abstract is not None else None
            fmt = lvl.find(W+'numFmt') if lvl is not None else None
            if fmt is not None and fmt.get(W+'val') == 'decimal':
                start = lvl.find(W+'start')
                initial = int(start.get(W+'val')) if start is not None else 1
                override = next((x for x in num.findall(W+'lvlOverride') if x.get(W+'ilvl') == level), None)
                restart = override.find(W+'startOverride') if override is not None else None
                if restart is not None:
                    initial = int(restart.get(W+'val'))
                key = (num_id, level)
                counters[key] = counters.get(key, initial-1) + 1
                text = f'({counters[key]}) ' + text
        if para.find(W+'pPr/'+W+'pageBreakBefore') is not None and lines:
            pages.append('\n'.join(lines)); lines = []
        lines.append(text)
    if lines:
        pages.append('\n'.join(lines))
    return pages

def extract_packet(job):
    source_root, packet, cache = job
    path = source_root / packet['path']
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    target = cache / ('asia-' + hashlib.sha256((packet['path']+digest+PARSER_FINGERPRINT).encode()).hexdigest() + '.json')
    if target.exists():
        return json.loads(target.read_text(encoding='utf-8'))
    if path.suffix.lower() == '.docx':
        pages = docx_pages(path)
        pairs, audit = extract_pages(pages, packet['path'])
    else:
        pairs, audit = extract_pdf(path, packet['path'])
        _, data = read_packet((path, packet['path'], cache))
        pages = data['pages']
    groups = extract_groups(pages) if 'bowl' in path.name.lower() else []
    for group in groups:
        group['packet'] = packet['path']
    result = {'path': packet['path'], 'sha256': digest, 'audit': audit,
        'pairs': [vars(pair) for pair in pairs], 'groups': groups}
    target.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    return result

def append_unique(existing, candidates, provenance):
    """Index old questions once and compare only new candidates.

    Cheap upper bounds preserve the existing importer's similarity thresholds
    without repeating full sequence comparisons for every common answer.
    """
    exact = {canonical(item['question']): item for item in existing}
    by_id = {item['id']: item for item in existing}
    by_answer = defaultdict(list)
    keys = {item['id']: canonical(item['question']) for item in existing}
    tokens = {}
    for item in existing:
        by_answer[answer_core(item['answer'])].append(item)
    added, report = [], Counter()
    for item in candidates:
        key = canonical(item['question'])
        previous, fuzzy = by_id.get(item['id']) or exact.get(key), False
        if previous is None:
            for other in by_answer.get(answer_core(item['answer']), []):
                left, right = sorted((key, keys[other['id']]), key=len)
                ratio = len(left) / max(1, len(right))
                if ratio < 0.78:
                    continue
                match = len(left) >= 120 and left in right
                if not match:
                    sequence = SequenceMatcher(None, left, right, autojunk=False)
                    match = sequence.quick_ratio() >= 0.965 and sequence.ratio() >= 0.965
                if not match and ratio >= 0.86:
                    if item['id'] not in tokens:
                        tokens[item['id']] = set(tokenize(item['question']))
                    if other['id'] not in tokens:
                        tokens[other['id']] = set(tokenize(other['question']))
                    union = tokens[item['id']] | tokens[other['id']]
                    match = bool(union) and len(tokens[item['id']] & tokens[other['id']])/len(union) >= 0.92
                if match:
                    previous, fuzzy = other, True
                    break
        if previous is not None:
            report['fuzzy_duplicate' if fuzzy else 'exact_duplicate'] += 1
            if item['id'] != previous['id'] and item['id'] in provenance:
                provenance.setdefault(previous['id'], []).extend(provenance.pop(item['id']))
            exact[key] = previous
            continue
        added.append(item)
        by_id[item['id']] = item
        exact[key] = item
        keys[item['id']] = key
        by_answer[answer_core(item['answer'])].append(item)
    report['existing_input'] = len(existing)
    report['candidate_input'] = len(candidates)
    report['new_unique_added'] = len(added)
    return added, dict(report)

def merge_archive(payload, packets):
    """Keep the complete old bank unchanged; append unique source questions."""
    original = copy.deepcopy(payload['items'])
    raw_groups = [g for packet in packets for g in packet['groups']]
    pairs = []
    for packet in packets:
        clues = [(canonical(q['question']), answer_core(q['answer'])) for g in packet['groups'] for q in g['questions']]
        for pair in packet['pairs']:
            if not any(canonical(pair['question']).endswith(key) and answer_core(pair['answer']) == answer for key, answer in clues):
                pairs.append(RawPair(**pair))
    # Give every short clue its original shared prompt and topic. Existing
    # extraction may have omitted numeric answers; groups are authoritative.
    for group in raw_groups:
        context = f"Concerning {group['topic']}, {group['prompt'] or 'name the following.'}"
        for question in group['questions']:
            pairs.append(RawPair(clean_question([question['question']], context), question['answer'], group['packet'], context))
    print(f'Classifying {len(pairs)} source candidates', flush=True)
    candidates, provenance, classification = build_new_items(pairs, original)
    print('Deduplicating new candidates against the unchanged bank', flush=True)
    added, dedupe = append_unique(original, candidates, provenance)
    payload['items'].extend(added)
    print(f'Linking {len(raw_groups)} topic groups ({len(added)} new questions)', flush=True)
    by_question = {canonical(item['question']): item for item in payload['items']}
    by_answer = {}
    for item in payload['items']:
        by_answer.setdefault(answer_core(item['answer']), []).append(item)
    groups = list(payload.get('bowlThirdQuarterGroups', []))
    original_group_count = len(groups)
    known = {group['id'] for group in groups}
    for raw in raw_groups:
        refs = []
        context = f"Concerning {raw['topic']}, {raw['prompt'] or 'name the following.'}"
        for question in raw['questions']:
            text = clean_question([question['question']], context)
            item = by_question.get(canonical(text))
            if item is None:
                key = canonical(question['question'])
                matches = [i for i in by_answer.get(answer_core(question['answer']), []) if canonical(i['question']).endswith(key)]
                matches.sort(key=lambda i: (canonical(raw['topic']) not in canonical(i['question']), len(i['question'])))
                item = matches[0] if matches else None
            if item is None:
                matches = [i for i in by_answer.get(answer_core(question['answer']), []) if near_duplicate(i['question'], text)]
                item = matches[0] if matches else None
            if item is None:
                raise ValueError(f"Unresolved topic clue: {raw['packet']} / {raw['topic']} / {question['number']}")
            refs.append(item['id'])
        group_id = 'bowl-q3-' + hashlib.sha256((raw['packet']+'\n'+raw['topic']+'\n'+str(raw['page'])).encode()).hexdigest()[:16]
        if group_id not in known:
            groups.append({'id': group_id, 'topic': raw['topic'], 'prompt': raw['prompt'], 'packet': raw['packet'], 'questionIds': refs})
            known.add(group_id)
    payload['bowlThirdQuarterGroups'] = groups
    assert payload['items'][:len(original)] == original
    return {'questions_before': len(original), 'questions_added': len(added), 'questions_after': len(payload['items']),
        'raw_pairs': len(pairs), 'third_quarter_groups_added': len(groups)-original_group_count,
        'deduplication': dedupe, 'classification': classification}, provenance

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--audit', type=Path, required=True)
    parser.add_argument('--bank', type=Path, default=Path('questions.json'))
    parser.add_argument('--workers', type=int, default=6)
    parser.add_argument('--extract-only', action='store_true')
    args = parser.parse_args()
    if args.workers < 1:
        parser.error('--workers must be at least 1')
    manifest = json.loads(args.manifest.read_text(encoding='utf-8'))
    sources = manifest if isinstance(manifest, list) else manifest['packets']
    args.cache.mkdir(parents=True, exist_ok=True)
    sources = [p for p in sources if not p.get('error') and p.get('status') != 'unavailable']
    for packet in sources:
        path = (args.source_root / packet['path']).resolve()
        if not path.is_relative_to(args.source_root.resolve()):
            raise ValueError('Packet path is outside --source-root')
        if packet.get('sha256') and hashlib.sha256(path.read_bytes()).hexdigest() != packet['sha256']:
            raise ValueError(f"Source hash mismatch: {packet['path']}")
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        packets = []
        for index, packet in enumerate(pool.map(extract_packet, [(args.source_root, p, args.cache) for p in sources]), 1):
            packets.append(packet)
            if index % 25 == 0:
                print(f'{index}/{len(sources)} packets extracted', flush=True)
    report = {'packets': packets}
    if not args.extract_only:
        for packet in packets:
            if packet['audit']['status'] != 'ok' or packet['audit']['marker_pair_delta']:
                raise ValueError(f"Unreviewed extraction: {packet['path']}")
            if 'bowl' in Path(packet['path']).name.lower() and (len(packet['groups']) != 3 or any(len(g['questions']) not in [6,8] for g in packet['groups'])):
                raise ValueError(f"Incomplete third quarter: {packet['path']}")
        payload = json.loads(args.bank.read_text(encoding='utf-8-sig'))
        before = len(payload.get('bowlThirdQuarterGroups', []))
        report['merge'], report['provenance'] = merge_archive(payload, packets)
        report['merge']['third_quarter_groups_added'] = len(payload['bowlThirdQuarterGroups']) - before
        write_json(args.bank, payload)
    write_json(args.audit, report)
    print(json.dumps(report.get('merge') or {'packets':len(packets),'pairs':sum(len(p['pairs']) for p in packets),'groups':sum(len(p['groups']) for p in packets)}), flush=True)

if __name__ == '__main__':
    main()
