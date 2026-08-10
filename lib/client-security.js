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

  return Object.freeze({ authenticatedFetch, csvCell, finiteNumber, safeWikipediaUrl });
});
