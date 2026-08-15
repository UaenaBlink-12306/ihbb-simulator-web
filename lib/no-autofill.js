/* no-autofill.js
 *
 * Blocks browser autofill and saved-password suggestion dropdowns on every
 * search box, text box, textarea and other editable field across the app.
 *
 * Real credential fields — <input type="email"> (username) and
 * <input type="password"> — are left untouched so login and account flows
 * keep working with the browser's password manager.
 *
 * Technique (same approach already used for the dashboard switcher / join
 * code inputs):
 *   1. autocomplete="off" plus third-party password-manager ignore hints.
 *   2. The readonly-on-focus trick: browsers and password managers skip
 *      readonly fields, so we lock each field until the user actually
 *      interacts with it, then unlock it so typing works normally.
 *
 * The script runs synchronously from <head> and installs a MutationObserver
 * before <body> is parsed, so even dynamically-created fields get hardened.
 */
(function () {
  'use strict';

  var hardened = (typeof WeakSet === 'function') ? new WeakSet() : null;

  // Input types that are genuine credential fields and must keep autofill.
  var CREDENTIAL_TYPES = { email: true, password: true };

  // Text-like fields that get the readonly-on-focus lock.
  var TEXT_LIKE_TYPES = { text: true, search: true };

  // Anti-autofill attributes (browser + third-party password managers).
  var IGNORE_ATTRS = {
    autocomplete: 'off',
    'data-lpignore': 'true',           // LastPass
    'data-1p-ignore': 'true',          // 1Password
    'data-bwignore': 'true',           // Bitwarden
    'data-keeper-lock-ignore': 'true', // Keeper
    'data-form-type': 'other'          // Dashlane / generic form-field hint
  };

  function isCredentialInput(el) {
    var type = String(el.getAttribute('type') || 'text').toLowerCase();
    return !!CREDENTIAL_TYPES[type];
  }

  function applyIgnoreAttrs(el) {
    Object.keys(IGNORE_ATTRS).forEach(function (key) {
      el.setAttribute(key, IGNORE_ATTRS[key]);
    });
  }

  function lockUntilUserInput(el) {
    if (el.hasAttribute('readonly')) return;
    el.setAttribute('readonly', 'readonly');
    var unlock = function () {
      el.removeAttribute('readonly');
    };
    // Unlock as soon as a human genuinely starts to interact. The lock only
    // exists to stop silent autofill/suggestion injection before that point.
    ['pointerdown', 'touchstart', 'keydown', 'beforeinput', 'focus'].forEach(function (evt) {
      el.addEventListener(evt, unlock, { once: true, passive: true });
    });
  }

  function hardenField(el) {
    if (!el || el.nodeType !== 1) return;
    if (hardened) {
      if (hardened.has(el)) return;
      hardened.add(el);
    }

    var tag = String(el.tagName || '').toLowerCase();

    // Keep real username/email + password fields fully autofillable.
    if (tag === 'input' && isCredentialInput(el)) return;

    applyIgnoreAttrs(el);

    var type = String(el.getAttribute('type') || 'text').toLowerCase();
    var isTextLike = tag === 'textarea' || (tag === 'input' && TEXT_LIKE_TYPES[type]);
    if (isTextLike) lockUntilUserInput(el);
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

  init();
})();
