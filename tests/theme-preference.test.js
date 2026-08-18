const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const themeSource = fs.readFileSync(path.join(root, 'theme.js'), 'utf8');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function createThemeRuntime({ storedPreference = null, systemIsDark = false } = {}) {
  const storage = new Map();
  if (storedPreference !== null) storage.set('ihbb_theme_preference', storedPreference);

  const controls = ['light', 'dark', 'system'].map((value) => ({ value, checked: false }));
  const status = { textContent: '' };
  const rootElement = { dataset: {}, style: {} };
  const media = {
    matches: systemIsDark,
    addEventListener(type, listener) {
      if (type === 'change') this.changeListener = listener;
    }
  };
  const windowListeners = {};
  const dispatchedEvents = [];

  const document = {
    documentElement: rootElement,
    readyState: 'complete',
    querySelectorAll(selector) {
      if (selector === '[data-theme-option]') return controls;
      if (selector === '[data-theme-status]') return [status];
      return [];
    },
    addEventListener() {}
  };

  const window = {
    matchMedia: () => media,
    addEventListener(type, listener) {
      windowListeners[type] = listener;
    },
    dispatchEvent(event) {
      dispatchedEvents.push(event);
    }
  };

  const context = {
    window,
    document,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    },
    CustomEvent: class CustomEvent {
      constructor(type, options) {
        this.type = type;
        this.detail = options?.detail;
      }
    },
    Set
  };

  vm.runInNewContext(themeSource, context, { filename: 'theme.js' });
  return { storage, controls, status, rootElement, media, window, windowListeners, dispatchedEvents };
}

test('System is the default and follows the current operating-system theme', () => {
  const runtime = createThemeRuntime({ systemIsDark: true });
  assert.equal(runtime.rootElement.dataset.themePreference, 'system');
  assert.equal(runtime.rootElement.dataset.theme, 'dark');
  assert.equal(runtime.rootElement.style.colorScheme, 'dark');
  assert.equal(runtime.controls.find((control) => control.value === 'system').checked, true);
  assert.match(runtime.status.textContent, /Following your system \(dark mode\)/);
});

test('Light and Dark choices persist and apply immediately', () => {
  const runtime = createThemeRuntime({ systemIsDark: false });
  runtime.window.IHBBTheme.setPreference('dark');

  assert.equal(runtime.storage.get('ihbb_theme_preference'), 'dark');
  assert.equal(runtime.rootElement.dataset.theme, 'dark');
  assert.equal(runtime.rootElement.dataset.themePreference, 'dark');
  assert.equal(runtime.controls.find((control) => control.value === 'dark').checked, true);
  assert.equal(runtime.dispatchedEvents.at(-1).type, 'ihbbthemechange');
  assert.equal(runtime.dispatchedEvents.at(-1).detail.theme, 'dark');
});

test('System preference responds to operating-system changes', () => {
  const runtime = createThemeRuntime({ storedPreference: 'system', systemIsDark: false });
  runtime.media.matches = true;
  runtime.media.changeListener();
  assert.equal(runtime.rootElement.dataset.theme, 'dark');
  assert.match(runtime.status.textContent, /Following your system \(dark mode\)/);
});

test('Every app page loads the theme before the stylesheet', () => {
  for (const file of ['admin.html', 'index.html', 'livebee.html', 'login.html', 'onboarding.html', 'profile.html', 'student.html', 'teacher.html']) {
    const html = read(file);
    assert.ok(html.indexOf('src="theme.js"') >= 0, `${file} should load theme.js`);
    assert.ok(html.indexOf('src="theme.js"') < html.indexOf('href="styles.css"'), `${file} should apply the theme before CSS renders`);
  }
});

test('Student and teacher Account tabs expose all three choices and release notes', () => {
  for (const file of ['student.html', 'teacher.html']) {
    const html = read(file);
    assert.match(html, /<legend>Appearance<\/legend>/);
    for (const preference of ['light', 'dark', 'system']) {
      assert.match(html, new RegExp(`value="${preference}" data-theme-option`));
    }
    assert.match(html, /Light, Dark &amp; System Themes/);
  }
});
