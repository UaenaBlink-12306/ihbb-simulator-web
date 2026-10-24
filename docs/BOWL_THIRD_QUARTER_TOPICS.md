# Bowl third-quarter topic groups

The Practice Hub's built-in IHBB Question Bank now indexes 1,905 third-quarter
groups from 635 distinct, text-readable official Bowl packets. Each group retains
the packet's topic, shared prompt, and six- or eight-question order. Packet versions
remain separate, including middle-school and high-school variants.

`questions.json` keeps its existing `items` array. All 37,032 pre-existing items,
their IDs, text, answers, aliases, and classifications were preserved. Restoring
complete groups recovered 114 additional source clues that the older extraction
had omitted. The bank now has 37,146 items; 9,512 distinct items participate in
the topic groups. Shared clues can appear in multiple packet groups without
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

The Library also offers **Show third-quarter questions only**, an original-topic
selector, and topic/packet search. Topic mode shows each packet slot in order,
including its clue text; shared questions can appear in more than one packet
version. Region/era filters still narrow browsing. Question popups show the
shared prompt and packet. Practice filtered starts exactly the matching questions
(one selected topic stays in packet order; mixed-topic practice removes repeated
question IDs and uses the configured session length).
