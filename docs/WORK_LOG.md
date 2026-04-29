# Work Log

## April 29, 2026

- Audited the unauthenticated login/signup entry point, dashboard update logs, and local run setup.
- Improved the signup flow so new accounts no longer redirect into the protected app route without context when Supabase does not start a session.
- Added signup password guidance for new accounts and switched password autocomplete between `current-password` and `new-password` based on the selected auth mode.
- Updated the student-facing and teacher-facing What's New sections with the signup password guidance release note.
- Synced the Login and Sign Up tab active classes plus `aria-selected` state through the shared auth mode setter so programmatic mode changes keep the visual and accessibility state aligned.
- Added a second What's New note for the auth tab state sync.
- Removed the explicit signup email redirect option plus signup and account-page email-check wording because the Supabase backend is not ready for that flow.
- Added a repository rule to avoid account verification or verification-email features until the Supabase backend is fixed and the user explicitly asks for them.
