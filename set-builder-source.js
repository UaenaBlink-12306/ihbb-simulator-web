(function initSetBuilderSourceUi(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SetBuilderSourceUI = api;
})(typeof window !== 'undefined' ? window : globalThis, function createSetBuilderSourceUi() {
  'use strict';

  const AI_SOURCE_KEYS = new Set(['ai', 'ai-generated', 'deepseek', 'generated', 'generated draft']);

  function normalizedIdentityPart(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function questionIdentity(question) {
    if (!question || typeof question !== 'object') return '';
    const bankKey = String(question?.meta?.bank_key || question?.bank_key || '').trim();
    if (bankKey) return `bank:${bankKey}`;
    const explicit = String(question.id || question.question_id || '').trim();
    if (explicit) return `id:${explicit}`;
    const answer = normalizedIdentityPart(question.answer || question.a || question.answer_text);
    const prompt = normalizedIdentityPart(question.question || question.q || question.question_text);
    const category = normalizedIdentityPart(question?.meta?.category || question.category);
    const era = normalizedIdentityPart(question?.meta?.era || question.era);
    return answer || prompt ? `content:${answer}::${prompt}::${category}::${era}` : '';
  }

  function questionContentFingerprint(question) {
    if (!question || typeof question !== 'object') return '';
    const answer = normalizedIdentityPart(question.answer || question.a || question.answer_text);
    const prompt = normalizedIdentityPart(question.question || question.q || question.question_text);
    return answer || prompt ? `${answer}::${prompt}` : '';
  }

  function randomUniqueQuestions(candidates, count, excluded = [], random = Math.random) {
    const requested = Math.max(0, Number.parseInt(String(count || 0), 10) || 0);
    if (!requested) return [];
    const excludedIds = new Set((Array.isArray(excluded) ? excluded : []).map(questionIdentity).filter(Boolean));
    const excludedContent = new Set((Array.isArray(excluded) ? excluded : []).map(questionContentFingerprint).filter(Boolean));
    const seenIds = new Set();
    const seenContent = new Set();
    const pool = [];

    (Array.isArray(candidates) ? candidates : []).forEach((question) => {
      const id = questionIdentity(question);
      const content = questionContentFingerprint(question);
      if (!id || !content || excludedIds.has(id) || excludedContent.has(content) || seenIds.has(id) || seenContent.has(content)) return;
      seenIds.add(id);
      seenContent.add(content);
      pool.push(question);
    });

    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.max(0, Math.min(0.999999999, Number(random()) || 0)) * (index + 1));
      [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    }
    return pool.slice(0, Math.min(requested, pool.length));
  }

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

  return Object.freeze({
    init,
    questionContentFingerprint,
    questionIdentity,
    randomUniqueQuestions,
    renderSummary,
    selectSource,
    sourceCounts,
    sourceKind
  });
});
