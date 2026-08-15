'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../lib/no-autofill.js'), 'utf8');
const read = (relative) => fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');

class FakeTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, extra = {}) {
    const event = { type, target: this, pointerType: '', ...extra };
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
}

class FakeField extends FakeTarget {
  constructor(tagName, attrs = {}) {
    super();
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this.attributes = new Map(Object.entries(attrs));
    this.form = null;
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  matches() {
    return true;
  }

  querySelectorAll() {
    return [];
  }

  closest() {
    return this.form;
  }
}

function runGuard(fields) {
  const timers = [];
  const window = new FakeTarget();
  const document = new FakeTarget();
  document.readyState = 'complete';
  document.activeElement = null;
  document.documentElement = {};
  document.querySelectorAll = () => fields;

  let mutationCallback = null;
  class FakeMutationObserver {
    constructor(callback) {
      mutationCallback = callback;
    }

    observe() {}
  }

  vm.runInNewContext(source, {
    document,
    window,
    MutationObserver: FakeMutationObserver,
    WeakMap,
    WeakSet,
    setTimeout: (callback) => timers.push(callback)
  });

  return {
    document,
    window,
    flushTimers() {
      while (timers.length) timers.shift()();
    },
    addDynamic(field) {
      mutationCallback([{ addedNodes: [field] }]);
    }
  };
}

test('guards non-credential text fields but leaves real login fields untouched', () => {
  const search = new FakeField('input', { type: 'search', name: 'dashboard-search' });
  const answer = new FakeField('textarea');
  const email = new FakeField('input', { type: 'email', autocomplete: 'username' });
  const password = new FakeField('input', { type: 'password', autocomplete: 'current-password' });
  const textUsername = new FakeField('input', { type: 'text', autocomplete: 'username' });
  const checkbox = new FakeField('input', { type: 'checkbox' });

  runGuard([search, answer, email, password, textUsername, checkbox]);

  assert.equal(search.getAttribute('autocomplete'), 'off');
  assert.equal(search.getAttribute('data-bwignore'), 'true');
  assert.equal(search.getAttribute('data-protonpass-ignore'), 'true');
  assert.notEqual(search.getAttribute('name'), 'dashboard-search');
  assert.equal(search.hasAttribute('readonly'), true);
  assert.equal(answer.hasAttribute('readonly'), true);

  for (const credential of [email, password, textUsername]) {
    assert.equal(credential.getAttribute('data-autofill-guard'), null);
    assert.equal(credential.hasAttribute('readonly'), false);
  }
  assert.equal(checkbox.getAttribute('autocomplete'), null);
});

test('stays readonly through click, unlocks for typing, and relocks after every blur', () => {
  const field = new FakeField('input', { type: 'text', name: 'question-search' });
  const guard = runGuard([field]);
  const firstOpaqueName = field.getAttribute('name');

  guard.document.activeElement = field;
  field.dispatch('click');
  assert.equal(field.hasAttribute('readonly'), true);
  guard.flushTimers();
  assert.equal(field.hasAttribute('readonly'), false);

  guard.document.activeElement = null;
  field.dispatch('blur');
  assert.equal(field.hasAttribute('readonly'), true);
  assert.notEqual(field.getAttribute('name'), firstOpaqueName);

  guard.document.activeElement = field;
  field.dispatch('keydown');
  assert.equal(field.hasAttribute('readonly'), false);

  field.dispatch('blur');
  field.dispatch('click');
  guard.document.activeElement = null;
  guard.flushTimers();
  assert.equal(field.hasAttribute('readonly'), true, 'a stale click timer must not unlock a blurred field');
});

test('hardens text fields added after initial page parsing', () => {
  const guard = runGuard([]);
  const dynamic = new FakeField('input', { type: 'search', name: 'late-search' });

  guard.addDynamic(dynamic);

  assert.equal(dynamic.getAttribute('autocomplete'), 'off');
  assert.equal(dynamic.getAttribute('data-autofill-guard'), 'true');
  assert.equal(dynamic.hasAttribute('readonly'), true);
  assert.notEqual(dynamic.getAttribute('name'), 'late-search');
});

test('all app pages load the shared guard and page scripts do not override it', () => {
  const htmlFiles = fs.readdirSync(path.resolve(__dirname, '..'))
    .filter((file) => file.endsWith('.html'));

  for (const file of htmlFiles) {
    assert.match(read(file), /<script src="lib\/no-autofill\.js"><\/script>/, file);
  }

  for (const file of ['student.js', 'teacher.js']) {
    const pageScript = read(file);
    assert.doesNotMatch(pageScript, /hardenDashboardSwitcherAutofill/, file);
    assert.doesNotMatch(pageScript, /unlockForUserInput/, file);
  }
});
