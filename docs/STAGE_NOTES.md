# Stage Notes

## April 29, 2026

- Stage focus: reduce account-creation confusion before users reach student or teacher onboarding.
- Evidence target: verify the login page renders, Sign Up mode exposes new-account password guidance, short passwords are blocked client-side, and signup responses without an immediate session stay on the auth screen with a non-email success alert.
- Follow-up watch item: run a full hosted signup check with the reusable Codex test account once credentials are available, without creating a fresh account for routine smoke tests.
- Second pass focus: keep the auth mode tabs visually and semantically accurate after click-driven and programmatic mode changes.
- Second pass evidence target: verify Login starts as selected, Sign Up becomes selected after clicking it, and the no-session signup path returns selection to Login.
- Constraint: do not add account verification, email-confirmation, or verification-email UX until the Supabase backend is fixed and the user explicitly asks for it.
