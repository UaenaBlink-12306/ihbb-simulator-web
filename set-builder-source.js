(function initSetBuilderSourceUi(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SetBuilderSourceUI = api;
})(typeof window !== 'undefined' ? window : globalThis, function createSetBuilderSourceUi() {
  'use strict';

  const AI_SOURCE_KEYS = new Set(['ai', 'ai-generated', 'deepseek', 'generated', 'generated draft']);

  function sourceKind(question) {
    const raw = String(question?.meta?.source || question?.source || '').trim().toLowerCase();
    return AI_SOURCE_KEYS.has(raw) ? 'ai' : 'bank';
  }

  function sourceCounts(questions) {
    return (Array.isArray(questions) ? questions : []).reduce((counts, question) => {
      counts[sourceKind(question)] += 1;
      return counts;
    }, { bank: 0, ai: 0 });
  }

  function renderSummary(questions, scope = document) {
    if (!scope?.querySelectorAll) return sourceCounts(questions);
    const counts = sourceCounts(questions);
    scope.querySelectorAll('[data-builder-source-count]').forEach((node) => {
      const key = node.dataset.builderSourceCount;
      if (key in counts) node.textContent = counts[key];
    });
    scope.querySelectorAll('.builder-source-summary').forEach((node) => {
      node.dataset.hasAi = counts.ai > 0 ? 'true' : 'false';
      node.dataset.hasBank = counts.bank > 0 ? 'true' : 'false';
    });
    return counts;
  }

  function selectSource(source, scope = document, options = {}) {
    if (!scope?.querySelectorAll || !['bank', 'ai'].includes(source)) return;
    scope.querySelectorAll('[data-builder-source]').forEach((button) => {
      const selected = button.dataset.builderSource === source;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      button.setAttribute('tabindex', selected ? '0' : '-1');
    });
    scope.querySelectorAll('[data-builder-source-panel]').forEach((panel) => {
      const selected = panel.dataset.builderSourcePanel === source;
      panel.classList.toggle('hidden', !selected);
      panel.setAttribute('aria-hidden', selected ? 'false' : 'true');
    });
    if (options.focusPanel) {
      const panel = scope.querySelector(`[data-builder-source-panel="${source}"]`);
      panel?.querySelector('input:not([type="hidden"]), select, button')?.focus({ preventScroll: true });
    }
    if (typeof CustomEvent === 'function') {
      scope.dispatchEvent(new CustomEvent('builder-source-change', { detail: { source } }));
    }
  }

  function init(scope = document) {
    if (!scope?.querySelectorAll) return;
    const buttons = Array.from(scope.querySelectorAll('[data-builder-source]'));
    if (!buttons.length) return;
    buttons.forEach((button, index) => {
      button.addEventListener('click', () => selectSource(button.dataset.builderSource, scope, { focusPanel: true }));
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
        const next = buttons[(index + direction + buttons.length) % buttons.length];
        selectSource(next.dataset.builderSource, scope);
        next.focus();
      });
    });
    const active = buttons.find((button) => button.classList.contains('is-active')) || buttons[0];
    selectSource(active.dataset.builderSource || 'bank', scope);
    renderSummary([], scope);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init(document));
    else init(document);
  }

  return Object.freeze({ init, renderSummary, selectSource, sourceCounts, sourceKind });
});
