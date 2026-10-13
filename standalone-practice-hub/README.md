# Practice Hub (Standalone)

The core practice loop extracted from `ihbb-simulator-web` as a self-contained app:
upload any JSON question file, drill it with filters, and grade answers — locally
first, then optionally with DeepSeek AI.

## Quick start

**Option A — static only (no AI grading server):**
open `index.html` in a browser, or serve the folder with any static server.
Grading falls back to local lenient matching; optionally paste a DeepSeek key
in the ⚙ Settings dialog for AI grading from the browser.

**Option B — with DeepSeek as an environment variable (recommended):**

```bash
# Linux / macOS / Git Bash
DEEPSEEK_API_KEY=sk-xxx node server.js

# Windows PowerShell
$env:DEEPSEEK_API_KEY="sk-xxx"; node server.js

# or: npm start after setting the env var
```

Then open http://localhost:3000. The key is read from `DEEPSEEK_API_KEY` and
never appears in the browser. Optional env vars: `DEEPSEEK_MODEL`
(default `deepseek-chat`), `PORT` (default `3000`).

## JSON format

All of these work (field aliases `q`/`prompt`/`text`, `a`/`correct`/`solution` also accepted):

```json
{ "items": [
  { "id": "q1",
    "question": "Which treaty ended WWI?",
    "answer": "Treaty of Versailles",
    "aliases": ["Versailles"],
    "meta": { "category": "Europe", "era": "06", "source": "original" } }
] }
```

- A bare array of questions also works.
- `meta` is optional — it powers the Region / Era / Source filters.
- Era codes: `01` 8000 BCE–600 BCE, `02` 600 BCE–600 CE, `03` 600–1450,
  `04` 1450–1750, `05` 1750–1914, `06` 1914–1991, `07` 1991–Present.
- A multi-set library `{ "sets": [{ "name": "...", "items": [...] }] }` uses the first (or `activeSetId`) set.

## Filters

- **Region** (multi-select chips) — from `meta.category`
- **Era** (multi-select chips) — from `meta.era`
- **Source** — from `meta.source` (defaults to `original`)
- **Session length** — 10 / 15 / 20 / 50 / All / Custom (1–500)
- **Timer** — 10/20/30/60s or off; **Strict mode** disables lenient spelling

## Grading pipeline

1. Local match: exact (normalized) → alias match → lenient spelling (Levenshtein).
2. Only if local match fails and a key exists: DeepSeek chat completions
   (`response_format: json_object`, temperature 0), returning `{correct, reason}`.
3. If DeepSeek flags only a spelling issue, lenient matching can still accept it (unless Strict mode).

You can also override the verdict with the ✓/✗ self-grade buttons after each reveal.

## Deploying

The folder is fully static (`index.html`, `app.js`, `styles.css`, `config.js`,
`sample-questions.json`) — drop it on any static host. Include `server.js` +
`package.json` when you want the environment-variable AI grading proxy.
