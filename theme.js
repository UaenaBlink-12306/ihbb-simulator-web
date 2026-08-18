(function initIHBBTheme() {
  'use strict';

  const STORAGE_KEY = 'ihbb_theme_preference';
  const VALID_PREFERENCES = new Set(['light', 'dark', 'system']);
  const root = document.documentElement;
  const systemTheme = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

  function normalizePreference(value) {
    return VALID_PREFERENCES.has(value) ? value : 'system';
  }

  function readPreference() {
    try {
      return normalizePreference(localStorage.getItem(STORAGE_KEY));
    } catch {
      return 'system';
    }
  }

  function resolveTheme(preference) {
    if (preference !== 'system') return preference;
    return systemTheme?.matches ? 'dark' : 'light';
  }

  let activePreference = readPreference();

  function syncThemeControls() {
    const resolvedTheme = resolveTheme(activePreference);
    document.querySelectorAll('[data-theme-option]').forEach((control) => {
      control.checked = control.value === activePreference;
    });
    document.querySelectorAll('[data-theme-status]').forEach((status) => {
      status.textContent = activePreference === 'system'
        ? `Following your system (${resolvedTheme} mode).`
        : `Using ${resolvedTheme} mode on this device.`;
    });
  }

  function applyTheme(preference) {
    activePreference = normalizePreference(preference);
    const resolvedTheme = resolveTheme(activePreference);
    root.dataset.theme = resolvedTheme;
    root.dataset.themePreference = activePreference;
    root.style.colorScheme = resolvedTheme;
    syncThemeControls();
  }

  function setPreference(preference) {
    const normalized = normalizePreference(preference);
    try {
      localStorage.setItem(STORAGE_KEY, normalized);
    } catch {
      // The active page can still use the requested theme when storage is unavailable.
    }
    applyTheme(normalized);
    window.dispatchEvent(new CustomEvent('ihbbthemechange', {
      detail: {
        preference: activePreference,
        theme: resolveTheme(activePreference)
      }
    }));
  }

  applyTheme(activePreference);

  function bindThemeControls() {
    syncThemeControls();
    document.addEventListener('change', (event) => {
      const control = event.target.closest?.('[data-theme-option]');
      if (!control) return;
      setPreference(control.value);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindThemeControls, { once: true });
  } else {
    bindThemeControls();
  }

  systemTheme?.addEventListener?.('change', () => {
    if (activePreference === 'system') applyTheme(activePreference);
  });

  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) applyTheme(event.newValue);
  });

  window.IHBBTheme = Object.freeze({
    getPreference: () => activePreference,
    getTheme: () => resolveTheme(activePreference),
    setPreference
  });
}());
