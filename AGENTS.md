# AGENTS.md

## Repository Rules

- Remote repository for this project: `https://github.com/UaenaBlink-12306/ihbb-simulator-web.git`
- After finishing an app update, suggest 3 additional features that would be useful and practical for the application.
- When smoke testing signup/login or dashboard flows, do not create a new test account for every run. Create or identify one reusable Codex test account and use that same account for future smoke tests unless the task specifically requires a fresh account.
- Do not add account verification, email-confirmation, or verification-email features until the Supabase backend has been fixed and the user explicitly asks for that work.
- After making any edit in this repository, do not stop at local file changes.
- Stage only the files changed for the current task. Do not include unrelated user changes.
- Create a git commit after finishing the task.
- Push the commit immediately to `origin` on the current branch.
- Push to this github https://github.com/UaenaBlink-12306/ihbb-simulator-web every time you finish an edit.
- If the push is rejected because the remote changed, pull with rebase, resolve conflicts carefully without discarding user work, and push again.
- Do not force-push unless the user explicitly asks for it.
- In the final response, report the commit hash and whether the push succeeded.

## What's New updates (student.html and teacher.html)

- Every time you finish an app update, add a new dated entry to **both** the student-facing and teacher-facing "What's New" sections (`student.html` and `teacher.html`) so the two pages stay in sync. The wording may be tailored to each audience, but the date and described change must match.
- Each What's New page is organized into versioned **release blocks**, newest block at the top. One release block exists per release date, and multiple changes shipped on the same date share that release. A block is a `<details class="whatsnew-group">` whose summary shows the semantic version (`Version X.Y.Z`), the release date, and the update count; its body holds that release's dated entries. Only the newest (top) block is open (has the `open` attribute), and every older block stays collapsed so the newest version stays visible to users.
- Never place entries outside a release block and never delete the block wrappers: the page's What's New script (`dashboard-feedback.js`) expects this versioned layout.

### How to add a new version (determining the version number)

1. Look at the newest (top) release block in the file you are editing.
2. If that block is **already dated today**, do not create a new version. Insert your entry at the top of that block (newest entry first within the block) and keep its version number unchanged.
3. If the top block has an **earlier date**, create a new release block dated today above it and choose its version by bumping the previous newest version according to the kind of change you made:
   - **PATCH bump** (`X.Y.Z` + 1): bug fixes, repairs, small polish, or quality-of-life cleanups.
   - **MINOR bump** (`X.Y` + 1, reset `Z` to 0): new features or user-visible enhancements.
   - **MAJOR bump** (`X` + 1, reset `Y` and `Z` to 0): major redesigns or large new capabilities that reshape the app. Reserve majors for milestone releases. Historical examples to calibrate from: v2.0.0 — "5 Major Updates" plus Live Bee hosting and class-wide question sets (May 6, 2026); v3.0.0 — Security & Fair-Play hardening, source-first Set Builder, dedicated What's New tab (August 10, 2026); v4.0.0 — Mistake Notebook / Coach redesign (August 14, 2026); v5.0.0 — Liquid Glass light theme overhaul (August 20, 2026).
4. When in doubt between levels, use the smaller bump: a fix stays a patch, and an ordinary feature stays a minor, even if the entry reads impressively.
5. Use the same date and version number on both pages, and make the new block the only one with the `open` attribute.

### Block and entry templates

Newest (open) release block — copy this shape for a new version, keeping the indentation used in the file (CRLF line endings):

```html
<details class="whatsnew-group" open>
    <summary class="whatsnew-group-summary">
        <span class="whatsnew-group-title">Version X.Y.Z</span>
        <span class="whatsnew-group-meta">Month D, YYYY • N updates</span>
    </summary>
    <div class="whatsnew-group-list">
        <!-- entries, newest entry first -->
    </div>
</details>
```

Each dated entry inside a release block looks like this:

```html
<div class="list-item">
    <div>
        <h3 style="margin:0 0 4px;">Short change title</h3>
        <div class="pill">Month D, YYYY</div>
        <p class="muted" style="margin: 8px 0 0;">One or two plain-language sentences describing what changed and why it matters to the user.</p>
    </div>
</div>
```

Keep the newest version visible to users and always add entries to both `student.html` and `teacher.html`.
