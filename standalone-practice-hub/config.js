/**
 * Practice Hub — static configuration.
 *
 * DEEPSEEK API KEY AS ENVIRONMENT VARIABLE:
 * When the app is served by the bundled `server.js`, the key is read server-side
 * from the DEEPSEEK_API_KEY environment variable (and the model from
 * DEEPSEEK_MODEL). In that mode leave the values below empty — the frontend
 * simply calls POST /api/grade on the same origin.
 *
 * On a purely static host (no server), you may paste a key into the in-app
 * Settings dialog (stored in localStorage) or hardcode it here — but be aware
 * a hardcoded key is visible to anyone who loads the page.
 */
window.PRACTICE_HUB_CONFIG = {
    deepseekApiKey: "",            // fallback key for static hosting (prefer the env var via server.js)
    deepseekModel: "deepseek-chat" // e.g. "deepseek-chat", "deepseek-reasoner", or your DEEPSEEK_MODEL value
};
