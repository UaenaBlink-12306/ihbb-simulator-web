# Work Log

## April 29, 2026

- Audited the unauthenticated login/signup entry point, dashboard update logs, and local run setup.
- Improved the signup flow so email-confirmation signups show a clear success message on the auth screen instead of redirecting into the protected app route without context.
- Added signup password guidance for new accounts and switched password autocomplete between `current-password` and `new-password` based on the selected auth mode.
- Updated the student-facing and teacher-facing What's New sections with the signup clarity release note.
- Synced the Login and Sign Up tab active classes plus `aria-selected` state through the shared auth mode setter so programmatic mode changes keep the visual and accessibility state aligned.
- Added a second What's New note for the auth tab state sync.
