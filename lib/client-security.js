(function initIhbbSecurity(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.IHBBSecurity = api;
})(typeof window !== 'undefined' ? window : globalThis, function createIhbbSecurity() {
  'use strict';

  function safeWikipediaUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'en.wikipedia.org') return '';
      return parsed.href;
    } catch {
      return '';
    }
  }

  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function finiteNumber(value, fallback = 0) {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  async function authenticatedFetch(client, input, init = {}) {
    if (!client?.auth?.getSession) {
      const error = new Error('Authentication is unavailable.');
      error.code = 'AUTH_UNAVAILABLE';
      throw error;
    }
    const { data, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    const token = String(data?.session?.access_token || '').trim();
    if (!token) {
      const error = new Error('Please sign in to use AI features.');
      error.code = 'AUTH_REQUIRED';
      throw error;
    }
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  }

  function transientError(error) {
    return error?.retryable === true || error instanceof TypeError || error instanceof SyntaxError
      || ['AbortError', 'TimeoutError', 'AuthRetryableFetchError'].includes(error?.name);
  }

  function gradingError(message, code, retryable = false) {
    return Object.assign(new Error(message), { code, retryable });
  }

  async function gradingAttempt(client, body, timeoutMs, refreshSession) {
    const controller = new AbortController();
    let timer;
    try {
      // Include session lookup and reading the response body in the deadline.
      return await Promise.race([
        (async () => {
          if (refreshSession) {
            const result = await client.auth.refreshSession();
            if (result.error) throw result.error;
          }
          const response = await authenticatedFetch(client, '/api/grade', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body, signal: controller.signal, cache: 'no-store'
          });
          if (!response.ok) {
            const data = await response.json().catch(() => null);
            const status = response.status;
            const code = status === 401 ? 'AUTH_REQUIRED' : status === 429 ? 'QUOTA_EXCEEDED' : 'AI_UNAVAILABLE';
            const error = gradingError(data?.error || `Grading service error (${status}).`, code,
              [408, 425, 500, 502, 503, 504].includes(status));
            error.status = status;
            const retryAfter = response.headers.get('Retry-After');
            error.retryAfterMs = retryAfter
              ? (/^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now()))
              : 0;
            throw error;
          }
          const data = await response.json();
          if (!data || typeof data.correct !== 'boolean') {
            throw gradingError('The grading response was incomplete.', 'INVALID_GRADE', true);
          }
          return data;
        })(),
        new Promise((resolve, reject) => {
          timer = setTimeout(() => {
            reject(gradingError('The grading request timed out.', 'GRADE_TIMEOUT', true));
            controller.abort();
          }, timeoutMs);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function waitForGradingRetry(delayMs) {
    return new Promise(resolve => {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const events = typeof window !== 'undefined' ? window : null;
      const finish = () => {
        clearTimeout(timer);
        events?.removeEventListener('online', finish);
        resolve();
      };
      const timer = setTimeout(finish, offline ? Math.max(delayMs, 4000) : delayMs);
      if (offline) events?.addEventListener('online', finish, { once: true });
    });
  }

  async function requestGrade(client, payload, options = {}) {
    const body = JSON.stringify(payload);
    const coaching = !!payload.coach_enabled;
    const deadline = Date.now() + (options.totalTimeoutMs ?? (coaching ? 75000 : 60000));
    let refreshSession = false;
    let refreshed = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw gradingError('The grading request timed out.', 'GRADE_TIMEOUT');
        return await gradingAttempt(client, body,
          Math.min(remaining, options.attemptTimeoutMs ?? (coaching ? 55000 : 40000)), refreshSession);
      } catch (error) {
        refreshSession = false;
        if (error?.status === 401 && !refreshed && client?.auth?.refreshSession) {
          refreshSession = true;
          refreshed = true;
        } else if (!transientError(error)) {
          throw error;
        }
        if (attempt === 2) throw error;
        const delay = Math.max(error.retryAfterMs || 0, (options.retryDelayMs ?? 500) * (2 ** attempt) + Math.random() * 250);
        if (Date.now() + Math.max(delay, 4000) >= deadline) throw error;
        options.onRetry?.({ attempt: attempt + 2 });
        await waitForGradingRetry(delay);
      }
    }
  }

  return Object.freeze({ authenticatedFetch, requestGrade, csvCell, finiteNumber, safeWikipediaUrl });
});
