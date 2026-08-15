/* no-autofill.js
 *
 * Prevents autofill and saved-credential suggestions on non-login text fields.
 * Real username, email and password inputs remain available to password
 * managers. Browsers retain final control over their native UI, so this guard
 * combines the standards-based hint with protections for common heuristics.
 *
 * The script runs synchronously from <head> and installs a MutationObserver
 * before <body> is parsed, so dynamically-created fields are covered too.
 */
(function () {
  'use strict';

  var hardened = (typeof WeakSet === 'function') ? new WeakSet() : null;
  var nameStates = (typeof WeakMap === 'function') ? new WeakMap() : null;
  var relockFields = [];
  var nameSequence = 0;
  var pageToken = Date.now().toString(36) + Math.random().toString(36).slice(2);

  // Input types that are genuine credential fields and must keep autofill.
  var CREDENTIAL_TYPES = { email: true, password: true };
  var CREDENTIAL_TOKENS = {
    username: true,
    'current-password': true,
    'new-password': true
  };

  // Text-like fields that get the repeated readonly/focus lock.
  var TEXT_LIKE_TYPES = { text: true, search: true, tel: true, url: true };

  // Anti-autofill attributes (browser + third-party password managers).
  var IGNORE_ATTRS = {
    autocomplete: 'off',
    'data-lpignore': 'true',           // LastPass
    'data-1p-ignore': 'true',          // 1Password
    'data-bwignore': 'true',           // Bitwarden
    'data-protonpass-ignore': 'true',  // Proton Pass
    'data-keeper-ignore': 'true',      // Keeper
    'data-keeper-lock-ignore': 'true', // Keeper
    'data-form-type': 'other',         // Dashlane / generic form-field hint
    'data-autofill-guard': 'true'
  };

  function isCredentialInput(el) {
    var type = String(el.getAttribute('type') || 'text').toLowerCase();
    if (CREDENTIAL_TYPES[type]) return true;

    var tokens = String(el.getAttribute('autocomplete') || '')
      .toLowerCase()
      .split(/\s+/);
    for (var i = 0; i < tokens.length; i++) {
      if (CREDENTIAL_TOKENS[tokens[i]]) return true;
    }
    return false;
  }

  function isTextField(el, tag) {
    if (tag === 'textarea') return true;
    if (tag !== 'input') return false;
    var type = String(el.getAttribute('type') || 'text').toLowerCase();
    return !!TEXT_LIKE_TYPES[type];
  }

  function applyIgnoreAttrs(el) {
    Object.keys(IGNORE_ATTRS).forEach(function (key) {
      el.setAttribute(key, IGNORE_ATTRS[key]);
    });
  }

  function getOwningForm(el) {
    if (el.form) return el.form;
    if (typeof el.closest === 'function') return el.closest('form');
    return null;
  }

  function rotateFieldName(el) {
    if (!nameStates) return;
    var state = nameStates.get(el);
    if (!state) return;
    state.current = 'field-' + pageToken + '-' + (++nameSequence);
    el.setAttribute('name', state.current);
  }

  function neutralizeFieldName(el) {
    if (!nameStates || nameStates.has(el)) return;
    var originalName = String(el.getAttribute('name') || '');
    if (!originalName) return;

    var state = { original: originalName, current: '' };
    nameStates.set(el, state);
    rotateFieldName(el);

    // Keep native/FormData submission semantics if a future text field uses a
    // name inside a form. The browser only sees the opaque runtime name.
    var form = getOwningForm(el);
    if (form && typeof form.addEventListener === 'function') {
      form.addEventListener('formdata', function (event) {
        var data = event.formData;
        if (!data || typeof data.getAll !== 'function') return;
        var values = data.getAll(state.current);
        if (!values.length) return;
        data.delete(state.current);
        for (var i = 0; i < values.length; i++) {
          data.append(state.original, values[i]);
        }
      });
    }
  }

  function lockBetweenFocuses(el) {
    // Preserve genuinely read-only output fields; they are already ineligible
    // for autofill and must never become editable.
    if (el.hasAttribute('readonly')) return;

    var focusCycle = 0;
    var lock = function () {
      focusCycle += 1;
      el.setAttribute('readonly', 'readonly');
      rotateFieldName(el);
    };
    var unlock = function () {
      el.removeAttribute('readonly');
    };

    lock();
    relockFields.push(lock);

    // A focused field is editable after the first click. Chromium can treat a
    // second pointer-down as a new request for saved credentials, even with
    // autocomplete="off". Re-lock during capture so the browser's default
    // pointer/click handling always sees an immutable field. The click handler
    // below unlocks it again after that gesture has completely finished.
    var relockFocusedDesktopField = function (event) {
      var pointerType = String(event.pointerType || 'mouse').toLowerCase();
      var primaryButton = typeof event.button !== 'number' || event.button === 0;
      if (primaryButton && pointerType !== 'touch' && document.activeElement === el && !el.hasAttribute('readonly')) {
        lock();
      }
    };
    el.addEventListener('pointerdown', relockFocusedDesktopField, { capture: true });
    el.addEventListener('mousedown', function (event) {
      // Legacy fallback. In Pointer Events browsers the pointerdown listener
      // has already locked the field, so this becomes a no-op.
      relockFocusedDesktopField(event);
    }, { capture: true });

    // Desktop: remain readonly through both focus and the click's default
    // action. Unlocking synchronously in click still lets Chromium re-evaluate
    // the field and open its credential popup.
    el.addEventListener('click', function () {
      var scheduledCycle = focusCycle;
      setTimeout(function () {
        if (scheduledCycle === focusCycle && document.activeElement === el) {
          unlock();
        }
      }, 0);
    });

    // Keyboard users can Tab to a locked field; unlocking during keydown or
    // beforeinput occurs soon enough for the intended character to be entered.
    el.addEventListener('keydown', unlock);
    el.addEventListener('beforeinput', unlock);

    // Touch devices: a readonly field won't raise the on-screen keyboard, so
    // unlock during the user's touch gesture. The name and ignore attributes
    // remain active to suppress credential matching on that path.
    el.addEventListener('touchstart', unlock, { passive: true });
    el.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch' || (e.pointerType === 'pen' && document.activeElement !== el)) unlock();
    });

    // The previous implementation unlocked only once. Re-locking on every
    // blur prevents saved-login suggestions from returning on later clicks.
    el.addEventListener('blur', lock);
  }

  function hardenField(el) {
    if (!el || el.nodeType !== 1) return;
    if (hardened) {
      if (hardened.has(el)) return;
      hardened.add(el);
    }

    var tag = String(el.tagName || '').toLowerCase();

    // Keep real username/email/password fields fully autofillable.
    if (tag === 'input' && isCredentialInput(el)) return;

    var textField = isTextField(el, tag);
    var editable = textField || el.hasAttribute('contenteditable');
    if (!editable) return;

    applyIgnoreAttrs(el);
    neutralizeFieldName(el);

    if (textField) lockBetweenFocuses(el);
  }

  var SELECTOR = 'input, textarea, [contenteditable]';

  function scan(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    var nodes = root.querySelectorAll(SELECTOR);
    for (var i = 0; i < nodes.length; i++) hardenField(nodes[i]);
  }

  function startObserver() {
    if (typeof MutationObserver === 'undefined') return;
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        if (!added) continue;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (!node || node.nodeType !== 1) continue;
          if (typeof node.matches === 'function' && node.matches(SELECTOR)) {
            hardenField(node);
          }
          if (typeof node.querySelectorAll === 'function') scan(node);
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function init() {
    // Install the observer first so fields are hardened as soon as they exist.
    startObserver();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        scan(document);
      });
    } else {
      scan(document);
    }
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pageshow', function () {
      for (var i = 0; i < relockFields.length; i++) relockFields[i]();
    });
  }

  init();
})();
