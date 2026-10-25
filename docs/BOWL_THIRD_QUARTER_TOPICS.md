# Bowl third-quarter topic groups

The Practice Hub's built-in IHBB Question Bank now indexes 2,520 third-quarter
groups, including 615 Asia topic sets from 205 linked Bowl packets. The existing
1,905 groups come from 635 distinct, text-readable Canada, Europe, and US packets. Each group retains
the packet's topic, shared prompt, and six- or eight-question order. Packet versions
remain separate, including middle-school and high-school variants.

`questions.json` keeps its existing `items` array. All 37,032 pre-existing items,
their IDs, text, answers, aliases, and classifications were preserved. Restoring
complete groups recovered 114 additional source clues that the older extraction
had omitted. Before the Asia archive import, the bank had 37,146 items; 9,512 distinct items
participated in those original topic groups. See the Asia import below for current totals. Shared clues can appear in multiple packet groups without
duplicating bank items. If a source packet prints a clue twice, both ordered
slots are retained.

The additional root field `bowlThirdQuarterGroups` contains records shaped as:

```json
{
  "id": "bowl-q3-<stable packet/topic/page hash>",
  "topic": "Eisenhower Administration",
  "prompt": "Name the...",
  "packet": "Canada/.../2017-2018-IHBB-Alpha-Set-High-School-Bowl-Round-1.pdf",
  "questionIds": ["<Q1 item ID>", "<Q2 item ID>"]
}
```

The references preserve original order while allowing the same existing question
ID to retain its practice history. Legacy imports without groups still work.
Selecting a topic practices its complete sequence, overriding region, era, source,
and length filters. Clearing the topic returns to ordinary practice. Assignment,
saved-set, and Coach session overrides retain their own question selection.

## Rebuilding from the source packets

The restoration utility uses Python and `pypdf`, plus the existing importer for
text cleanup and classification. Install `pypdf` in the chosen Python environment
if it is unavailable, then run from the repository root:

```sh
python scripts/group_bowl_third_quarters.py --pdf-root "D:/New IHBB Questions" --cache "<temporary PDF text cache>" --audit "<temporary audit.json>"
```

Use `--extract-only` to audit packet structure without writing the bank. Cache and
audit outputs belong outside committed source. The audit lists each packet's
group count, raw source clues, restoration totals, and any wording repairs.
The 671 distinct PDF inputs included academic packets, extras, and image-only
files; these do not produce inferred topic groups. No sentence-length heuristic
or generated topic labels were used.

One official export repeats its sixth Byzantine Empire clue in its eighth slot
while retaining the eighth answer. Its correct eighth clue was recovered from
the parallel official `Europe/HS-Bowl-Round-6.pdf`, whose other seven questions
match. The audit records this repair. Existing curated bank wording takes
precedence when the same stable source ID is encountered again.

## Verification

Data checks validate every topic reference and source group size, uniqueness of
bank IDs and questions, and preservation of the original bank. Parser tests cover
shared-page groups, headings on the preceding page, numeric topic names, inline
answers, compact numbering, and duplicated printed question numbers. Browser
checks exercise topic search, complete six/eight-question sessions, clearing a
topic, empty search, notebook switching, legacy-cache refresh, and phone layout.
Browser checks use isolated account fixtures, not a live authenticated account.

The Library offers **Show third-quarter sets only**, an original-topic selector,
and topic/packet search. Each result is one complete packet-defined set. Open
a set to read every numbered question and answer, and use **Practice entire set**
to launch all six or eight questions in packet order. Region and era filters
find packages containing matching questions; they never remove questions from
an opened set. The ordinary question table stays available when set mode is off.

## Asia archive import (October 25, 2026)

The [official Asia practice archive](https://iacompetitionsasia.com/history-bee-bowl-practice-materials/)
contains the 14 entries shown in the supplied reference: the two samples plus the
2017–2022 season and championship collections. Its 310 linked files include 22
native Word packets. We downloaded all 308 available files (290 distinct file
hashes), extracting 14,663 source question-and-answer occurrences. Shared
middle-school/high-school questions and copies across divisions mean this number
is not a count of unique additions. The import adds 1,388 unique missing questions, bringing the bank to 38,534.
All 37,146 pre-existing questions and 1,905 groups are kept unchanged.

The Asia Bowl packets contribute 615 complete topics and 4,326 ordered clue slots.
They use the same Practice Hub topic picker and Library third-quarter set browser,
including searches for `Asia/` and packet names. Bee questions and other Bowl
quarters remain ordinary bank questions. The two legacy sample DOC links currently
return HTTP 404; neither invented substitutes nor third-party copies are included.

[ASIA_ARCHIVE_IMPORT.json](ASIA_ARCHIVE_IMPORT.json) records every archive heading,
source URL, file hash, extraction count, and topic size, including unavailable
links. Full raw-text audits are temporary artifacts outside committed source.
Rebuild using Python with `pypdf` and `pdfplumber`, after downloading each manifest
URL to its relative `path` under the source directory:

```sh
python scripts/import_asia_archive.py --source-root "<downloaded packets>" --manifest docs/ASIA_ARCHIVE_IMPORT.json --cache "<temporary cache>" --audit "<temporary audit.json>" --extract-only
```

Omit `--extract-only` to merge after reviewing the extraction. A nonzero answer-marker
delta or incomplete Bowl topic aborts the merge. Native DOCX automatic numbering
and restarts are read from Word XML. The parsers also recognize a printed
`ANSWR:` typo and inline bonus answers found in these packets.
