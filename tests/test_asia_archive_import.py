import copy
import sys
import io
import unittest
import zipfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from import_asia_archive import docx_pages, merge_archive
from import_question_pdfs import extract_pages, stable_id
from group_bowl_third_quarters import extract_groups

class AsiaArchiveImportTests(unittest.TestCase):
    def test_native_word_list_numbers_and_restart_are_restored(self):
        ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
        def para(text, num=None):
            prop = f'<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="{num}"/></w:numPr></w:pPr>' if num else ''
            return f'<w:p>{prop}<w:r><w:t>{text}</w:t></w:r></w:p>'
        text = ''.join([para('Third Quarter'), para('Silk Road'), para('Name the...'),
            para('Animal supplying silk.', '1'), para('ANSWER: Silkworm'),
            para('Destination empire.', '1'), para('ANSWER: Rome'),
            para('1848'), para('In the year 1848...'),
            para('Writer of the Communist Manifesto.', '2'), para('ANSWER: Karl Marx'),
            para('Fourth Quarter')])
        numbering = '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>'
        numbering += '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>'
        path = io.BytesIO()
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr('word/document.xml', f'<w:document xmlns:w="{ns}"><w:body>{text}</w:body></w:document>')
            archive.writestr('word/numbering.xml', f'<w:numbering xmlns:w="{ns}">{numbering}</w:numbering>')
        path.seek(0)
        pages = docx_pages(path)
        groups = extract_groups(pages)
        self.assertEqual([g['topic'] for g in groups], ['Silk Road', '1848'])
        self.assertEqual([len(g['questions']) for g in groups], [2, 1])
        pairs, audit = extract_pages(pages, 'packet.docx')
        self.assertEqual(audit['marker_pair_delta'], 0)
        self.assertEqual(len(pairs), 3)

    def test_misspelled_source_answer_marker_keeps_first_topic_slot(self):
        pages = ['Third Quarter\nBoxer Rebellion\nName the...\n(1) Religion opposed by the Boxers.\nANSWR: Christianity\n(2) Ruling dynasty.\nANSWER: Qing\nFourth Quarter']
        groups = extract_groups(pages)
        self.assertEqual([q['answer'] for q in groups[0]['questions']], ['Christianity', 'Qing'])
        pairs, audit = extract_pages(pages, 'packet.pdf')
        self.assertEqual(len(pairs), 2)
        self.assertEqual(audit['answer_markers'], 2)
        self.assertEqual(audit['marker_pair_delta'], 0)

    def test_inline_bonus_answer_is_a_separate_question(self):
        pairs, audit = extract_pages(['First Quarter\n(1) This European country entered the war.\nANSWER: Italy\nBONUS: Who led the Virgin Lands Campaign? ANSWER: Nikita Khrushchev'], 'packet.pdf')
        self.assertEqual(len(pairs), 2)
        self.assertEqual(pairs[1].answer, 'Nikita Khrushchev')
        self.assertEqual(audit['answer_markers'], 2)
        self.assertEqual(audit['marker_pair_delta'], 0)

    def test_merging_retains_existing_items_ids_and_other_division_groups(self):
        item = {'id': 'existing', 'question': 'Capital of France?', 'answer': 'Paris', 'aliases': ['City of Paris'], 'meta': {'category': 'Europe', 'era': '', 'source': 'original'}}
        old_group = {'id': 'old', 'topic': 'France', 'prompt': '', 'packet': 'Europe/round.pdf', 'questionIds': ['existing']}
        payload = {'items': [copy.deepcopy(item)], 'bowlThirdQuarterGroups': [copy.deepcopy(old_group)]}
        packet = {'path': 'Asia/round.docx', 'pairs': [dict(question='Capital of France?', answer='Paris', source_pdf='Asia/round.docx', context='')], 'groups': [{'topic': 'China', 'prompt': 'Name the...', 'packet': 'Asia/round.docx', 'page': 1, 'questions': [{'number': 1, 'question': 'Capital city.', 'answer': 'Beijing'}]}]}
        report, _ = merge_archive(payload, [packet])
        self.assertEqual(payload['items'][0], item)
        self.assertEqual(payload['bowlThirdQuarterGroups'][0], old_group)
        self.assertEqual(report['questions_added'], 1)
        self.assertEqual(report['third_quarter_groups_added'], 1)
        group = payload['bowlThirdQuarterGroups'][1]
        self.assertEqual(group['questionIds'], [payload['items'][1]['id']])
        repeated = copy.deepcopy(payload)
        merge_archive(payload, [packet])
        self.assertEqual(payload, repeated)

    def test_previously_curated_wording_keeps_its_stable_source_id(self):
        source = 'Capital of France?'
        item = {'id': stable_id(source, 'Paris'), 'question': 'This city on the Seine is the capital of France.', 'answer': 'Paris', 'aliases': [], 'meta': {'category': 'Europe', 'era': '', 'source': 'original'}}
        payload = {'items': [copy.deepcopy(item)], 'bowlThirdQuarterGroups': []}
        report, _ = merge_archive(payload, [{'path': 'Asia/bee.pdf', 'pairs': [{'question': source, 'answer': 'Paris', 'source_pdf': 'Asia/bee.pdf', 'context': ''}], 'groups': []}])
        self.assertEqual(payload['items'], [item])
        self.assertEqual(report['questions_added'], 0)

if __name__ == '__main__':
    unittest.main()
