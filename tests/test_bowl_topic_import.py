import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from group_bowl_third_quarters import extract_groups


class BowlTopicImportTests(unittest.TestCase):
    def test_shared_page_topics_and_fourth_quarter_boundary(self):
        pages = ['''Third Quarter Categories: 1. Rome 2. Egypt
Rome
Concerning ancient Rome, name the...
(1) Capital city. ANSWER: Rome
(2) River through that city.
ANSWER: Tiber
Egypt
Name the...
(1) River through Egypt.
ANSWER: Nile
(2) Last Ptolemaic queen.
ANSWER: Cleopatra
Fourth Quarter
(1) A long tossup that must not enter the Egypt topic.
ANSWER: Something else''']
        groups = extract_groups(pages)
        self.assertEqual([g['topic'] for g in groups], ['Rome', 'Egypt'])
        self.assertEqual([len(g['questions']) for g in groups], [2, 2])
        self.assertEqual(groups[0]['questions'][1]['answer'], 'Tiber')
        self.assertEqual(groups[1]['questions'][-1]['answer'], 'Cleopatra')

    def test_heading_on_previous_page_numeric_title_and_compact_numbering(self):
        pages = ['Third Quarter\nThe Silk Road', '''Name the...
(1) Animal supplying silk.
ANSWER: Silkworm
(2) Destination empire.
ANSWER: Rome
1848
In the year 1848...
1.Writer of the Communist Manifesto.
ANSWER: Karl Marx
2.A European country.
ANSWER: France
Fourth Quarter''']
        groups = extract_groups(pages)
        self.assertEqual([g['topic'] for g in groups], ['The Silk Road', '1848'])
        self.assertEqual(groups[1]['questions'][0]['answer'], 'Karl Marx')

    def test_repeated_printed_question_one_does_not_split_a_topic(self):
        pages = ['''Third Quarter
American War
Name the...
(1) First clue.
ANSWER: One
(1) Second clue with a numbering typo in the packet.
ANSWER: Two
(2) Third clue.
ANSWER: Three
Fourth Quarter''']
        groups = extract_groups(pages)
        self.assertEqual(len(groups), 1)
        self.assertEqual(len(groups[0]['questions']), 3)


if __name__ == '__main__':
    unittest.main()
