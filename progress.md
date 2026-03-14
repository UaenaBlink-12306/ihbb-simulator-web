Original prompt: Add DeepSeek-powered question generation so students and teachers can generate new IHBB questions for focused practice and assignments. Generated questions should be stored persistently, use the existing bank shape with new IDs plus region/era/source metadata, follow a progressive clue structure, and solve the current "No loaded question set matches this focus yet" dead-end. Before coding, ensure existing questions are labeled with source "original". After implementation, verify the UX in-browser with a registered test account and push the work to GitHub.

Notes:
- User updated clue structure requirement from 3 clues to 4 clues total: hard, medium, medium, giveaway.
- User wants existing bank labeled with source "original" and generated questions labeled with source "generated".
- Hosted durability is a concern; current static questions.json alone is not a good primary runtime write target.

TODO:
- Audit existing source values in questions.json and current auth/register flow.
- Decide generated-question persistence model and how it merges into the runtime library.
- Add generation flows for student and teacher surfaces.
- Run end-to-end browser QA with account registration.

Progress updates:
- Backfilled all 6,190 canonical questions in questions.json to meta.source = "original".
- Updated build_db.py so future rebuilt canonical questions default to source "original".
- Added generated-question endpoint scaffolding in both api/generate-questions.js and server.py with 4-clue validation.
- Added generated-question persistence docs to SUPABASE_SETUP.md and assignment schema extensions for aliases/source.
- Added teacher-side DeepSeek draft builder UI inside Create Assignment.
- Added practice/student focus generation flow so coach actions can generate drills instead of dead-ending.
- Added runtime migration so cached default banks without source metadata are upgraded to "original".

QA notes:
- Registered fresh teacher and student test accounts through the real signup/onboarding flow.
- Verified teacher Create Assignment page renders the new DeepSeek Draft Builder UI.
- Verified student coach/dashboard flow exposes a Generate Drill action and routes into the practice hub generation path.
- Local end-to-end question generation is currently blocked by an invalid DEEPSEEK_API_KEY in .env; the UI now surfaces "DeepSeek API key is invalid." instead of a generic failure.

Remaining follow-up:
- Re-run full teacher/student generation success-path QA once a valid DeepSeek key is configured.
- Optional: apply the new Supabase SQL migration so generated question persistence and assignment source/alias storage work in the hosted database.

UI refresh follow-up:
- 2026-03-13: Added a shared frosted-glass/floating-card system in styles.css for heroes, cards, tab strips, form controls, metrics, and repeated dashboard surfaces, with restrained blur usage for performance.
- 2026-03-13: Added shared favicon.svg links across all HTML entry points and generated a fallback favicon.ico to clear the default favicon 404 in browser verification.
- 2026-03-13: Verified login.html through Playwright on desktop and mobile. Artifacts saved to output/playwright/login-desktop-glass.png and output/playwright/login-mobile-glass.png.
- 2026-03-13: Found and fixed mobile overflow on .auth-card by adding shared box-sizing: border-box; rechecked at 430x950 and confirmed the card fits within the viewport.
- 2026-03-13: Reordered the student Assignments tab so the To Do / Completed lists render before the DeepSeek assignment support card.
- 2026-03-13: Removed the Practice Hub hero blurb and metric cards from index.html so the top header only shows the badge, title, and action buttons.
- 2026-03-14: Added a DeepSeek training sidebar to the Practice Hub with a fixed top-right launcher, slide-in panel, close/backdrop handling, context pills, starter prompts, and chat-driven quick actions.
- 2026-03-14: Added `/api/coach-chat` in both `server.py` and `api/coach-chat.js`, with DeepSeek-backed responses plus a local fallback plan that explains Wrong-bank, AI Notebook, and next-practice recommendations from live study context.
- 2026-03-14: Wired chat actions into existing drill flows so one click can start due-card review, open AI Notebook, apply a top focus, generate a drill, or start the current session.
- 2026-03-14: Added auto-open heuristics for urgent cases (recent miss, stacked wrong-bank due cards, multiple open notebook lessons) while respecting manual dismissal for the rest of the tab session.
- 2026-03-14: Browser QA passed for manual launcher open and miss-triggered auto-open with fresh student accounts. Verified the sidebar can start due-card practice in one click and closes itself when practice begins. Artifacts saved to `output/playwright/sidebar-practice-hub.png`, `output/playwright/sidebar-open-initial.png`, `output/playwright/sidebar-after-miss-auto.png`, and `output/playwright/sidebar-after-action.png`.
- 2026-03-14: Moved the DeepSeek launcher to a bottom-right floating position so it no longer covers Practice Hub header actions, and reused the same launcher/sidebar UI on the student dashboard for a more consistent cross-page coach experience.
- 2026-03-14: Added dashboard-side DeepSeek chat wiring in `student.js`, including coach/notebook context, dashboard quick actions, and Practice Hub handoff storage for actions like due-card review.
- 2026-03-14: Browser QA confirmed the launcher no longer overlaps logout/navigation buttons on either `student.html` or `index.html?drill=1`. Artifacts saved to `output/playwright/student-dashboard-chat-launcher.png`, `output/playwright/student-dashboard-chat-open.png`, and `output/playwright/practice-hub-chat-launcher-bottom-right.png`.
- 2026-03-14: Restyled the DeepSeek coach UI to a compact light-mode launcher plus a frosted-glass, elevated-card sidebar that visually matches the refreshed app instead of using a dark drawer treatment.
- 2026-03-14: Added safe-space layout variables plus JS-based launcher offset syncing on both `app.js` and `student.js` so the floating trigger stays away from fixed bottom UI and preserves room at the end of the page.
- 2026-03-14: Browser QA via a temporary local static server confirmed the smaller launcher clears the dashboard header actions and the Practice Hub viewport while the open panel renders with the new light frosted treatment. Artifacts saved to `output/playwright/coach-chat-practice-mobile-safe.png`, `output/playwright/coach-chat-practice-open-light.png`, `output/playwright/coach-chat-dashboard-launcher-compact.png`, and `output/playwright/coach-chat-dashboard-open-light.png`.
- 2026-03-14: Moved the DeepSeek launcher out of its floating bottom-right position and into the header action area on both `index.html` and `student.html`, keeping it top-right without overlaying page content.
- 2026-03-14: Removed the now-unused launcher offset/safe-space sync logic from `app.js` and `student.js`; the header-mounted trigger no longer needs viewport collision handling.
- 2026-03-14: Browser QA confirmed the launcher now sits at the top-right edge of the hero action group on desktop and mobile, with the mobile Practice Hub stacking it above the action buttons instead of overlapping them. Artifacts saved to `output/playwright/coach-chat-practice-top-right-mobile.png`, `output/playwright/coach-chat-practice-top-right-open.png`, and `output/playwright/coach-chat-dashboard-top-right.png`.
