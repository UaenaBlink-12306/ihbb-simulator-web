// config.js
// Initialize Supabase Client
// Please replace these placeholders with your actual Supabase URL and Anon Key
const SUPABASE_URL = 'https://laexxsgzldivvizwfjcn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhZXh4c2d6bGRpdnZpendmamNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0OTg0ODQsImV4cCI6MjA4ODA3NDQ4NH0.t5pMj7nrwqmIyhklkPQb8gyxdNl29LaEoBOdNJNaKZ4';
const AUTH_RECOVERY_NOTICE_KEY = 'ihbb_auth_recovery_notice';
const SUPABASE_BROWSER_STORAGE_KEY = /^sb-.*-(auth-token|code-verifier)$/;
const AUTH_RECOVERY_NOTICE = 'Your saved session could not be restored. Please sign in again.';

function clearSupabaseBrowserStorage(storage) {
    if (!storage) return;
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (typeof key === 'string' && SUPABASE_BROWSER_STORAGE_KEY.test(key)) {
            keys.push(key);
        }
    }
    keys.forEach((key) => storage.removeItem(key));
}

function clearBrokenSupabaseSession() {
    try {
        clearSupabaseBrowserStorage(window.localStorage);
    } catch (error) {
        console.warn('[Supabase] Failed to clear local auth storage.', error);
    }
    try {
        clearSupabaseBrowserStorage(window.sessionStorage);
    } catch (error) {
        console.warn('[Supabase] Failed to clear session auth storage.', error);
    }
    try {
        window.sessionStorage.setItem(AUTH_RECOVERY_NOTICE_KEY, AUTH_RECOVERY_NOTICE);
    } catch (error) {
        console.warn('[Supabase] Failed to store auth recovery notice.', error);
    }
}

function readAuthRecoveryNotice() {
    try {
        const message = window.sessionStorage.getItem(AUTH_RECOVERY_NOTICE_KEY);
        if (!message) return '';
        window.sessionStorage.removeItem(AUTH_RECOVERY_NOTICE_KEY);
        return message;
    } catch (error) {
        console.warn('[Supabase] Failed to read auth recovery notice.', error);
        return '';
    }
}

function isRecoverableSessionError(error) {
    const name = String(error?.name || '').trim();
    const message = String(error?.message || '').trim();
    return (
        name === 'AuthRetryableFetchError' ||
        /failed to fetch/i.test(message) ||
        /network/i.test(message) ||
        /refresh token/i.test(message) ||
        /empty_response/i.test(message)
    );
}

// Ensure this script runs after the Supabase CDN script is loaded
if (window.supabase) {
    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const originalGetSession = client.auth.getSession.bind(client.auth);

    client.auth.getSession = async (...args) => {
        try {
            const result = await originalGetSession(...args);
            if (result?.error) throw result.error;
            return result;
        } catch (error) {
            if (!isRecoverableSessionError(error)) {
                console.warn('[Supabase] Session lookup failed; falling back to a signed-out state.', error);
            } else {
                console.warn('[Supabase] Saved session refresh failed; clearing local auth state.', error);
            }
            clearBrokenSupabaseSession();
            return { data: { session: null }, error: null };
        }
    };

    window.supabaseClient = client;
    window.readIhbbAuthRecoveryNotice = readAuthRecoveryNotice;
} else {
    console.warn("Supabase SDK not loaded. Ensure the CDN script is included.");
}
