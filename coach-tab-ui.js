(function initCoachTabUi(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.IHBBCoachTabUI = api;
})(typeof window !== 'undefined' ? window : globalThis, function coachTabUiFactory() {
  const icons = Object.freeze({
    primary: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"></rect><path d="M9 8h6M9 12h6M9 16h4"></path></svg>',
    plan: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4M8 3v4M3 10h18"></path></svg>',
    explain: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 22h4"></path><path d="M8.2 14.8A7 7 0 1 1 15.8 14.8c-.9.7-1.3 1.4-1.3 2.2h-5c0-.8-.4-1.5-1.3-2.2Z"></path></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>'
  });

  function safeList(value, limit) {
    return Array.isArray(value) ? value.filter(Boolean).slice(0, limit) : [];
  }

  function renderPrimaryAction(element, card, escapeHtml) {
    if (!element) return;
    if (!card) {
      element.innerHTML = '';
      return;
    }
    element.innerHTML = `
      <button class="coach-home-action coach-home-action-primary" type="button" data-workspace-index="0">
        <span class="coach-home-action-icon">${icons.primary}</span>
        <span class="coach-home-action-copy">
          <strong>${escapeHtml(card.title || card.label || 'Ask the coach')}</strong>
          <span>${escapeHtml(card.copy || card.reason || 'Get a clear explanation and one useful next step.')}</span>
        </span>
        <span class="coach-home-action-arrow">${icons.arrow}</span>
      </button>`;
  }

  function renderStarterActions(element, starters, escapeHtml) {
    if (!element) return;
    const items = safeList(starters, 2);
    element.innerHTML = items.map((starter, index) => `
      <button class="coach-home-action coach-home-action-secondary" type="button" data-starter-index="${index}">
        <span class="coach-home-action-icon">${index === 0 ? icons.plan : icons.explain}</span>
        <span class="coach-home-action-copy"><strong>${escapeHtml(starter.label || 'Suggested question')}</strong></span>
        <span class="coach-home-action-arrow">${icons.arrow}</span>
      </button>`).join('');
  }

  function renderAssistantUtilities(index, role, busy) {
    const roleTool = role === 'teacher'
      ? '<button type="button" data-tool="send-class">Move to class draft</button>'
      : '<button type="button" data-tool="save-notebook">Save to Mistake Notebook</button>';
    return `
      <div class="coach-answer-footer">
        <div class="coach-answer-follow-through">
          <button class="coach-answer-link" type="button" data-message-index="${index}" data-tool="expand" ${busy ? 'disabled' : ''}>Explain more</button>
          <button class="coach-answer-link" type="button" data-message-index="${index}" data-tool="ask">Ask something else</button>
        </div>
        <details class="coach-answer-more">
          <summary aria-label="More answer actions" title="More answer actions">•••</summary>
          <div class="coach-answer-more-menu" data-message-index="${index}">
            <button type="button" data-tool="copy">Copy answer</button>
            ${roleTool}
          </div>
        </details>
      </div>`;
  }

  function renderMessages(options) {
    const {
      element,
      messages = [],
      busy = false,
      role = 'student',
      escapeHtml,
      isStreaming,
      visibleText,
      renderText,
      renderSectionBody,
      busyText = 'Reviewing your recent context…'
    } = options || {};
    if (!element || typeof escapeHtml !== 'function') return;

    const html = messages.map((message, index) => {
      if (message?.role === 'user') {
        return `<div class="coach-chat-message user"><p class="coach-chat-message-text">${escapeHtml(message.text || '')}</p></div>`;
      }
      const streaming = Boolean(isStreaming?.(message));
      const text = visibleText ? visibleText(message) : String(message?.text || '');
      const sections = streaming ? [] : safeList(message?.sections, 3);
      const links = streaming ? [] : safeList(message?.links, 2);
      const followUps = streaming ? [] : safeList(message?.followUps, 2);
      const actions = streaming ? [] : safeList(message?.actions, 2);
      const bodyHtml = text || streaming
        ? (renderText ? renderText(text || '', streaming) : `<p class="coach-chat-message-text">${escapeHtml(text || '')}</p>`)
        : '';
      const sectionHtml = sections.length ? `<div class="coach-answer-sections">${sections.map(section => `
        <section class="coach-answer-section">
          <h4>${escapeHtml(section.heading || '')}</h4>
          ${renderSectionBody ? renderSectionBody(section.body || '') : `<p>${escapeHtml(section.body || '')}</p>`}
        </section>`).join('')}</div>` : '';
      const actionsHtml = actions.length ? `<div class="coach-answer-actions">${actions.map((action, actionIndex) => `
        <button class="coach-answer-action ${actionIndex === 0 ? 'primary' : 'secondary'}" type="button" data-message-index="${index}" data-action-index="${actionIndex}">${escapeHtml(action.label || 'Continue')}</button>`).join('')}</div>` : '';
      const followUpsHtml = followUps.length ? `<div class="coach-chat-followups">${followUps.map((followUp, followUpIndex) => `
        <button class="coach-answer-link" type="button" data-message-index="${index}" data-followup-index="${followUpIndex}">${escapeHtml(followUp.label || 'Follow up')}</button>`).join('')}</div>` : '';
      const linksHtml = links.length ? `<div class="coach-chat-links">${links.map(link => `
        <a href="${escapeHtml(link.url || '')}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label || 'Reference')}</a>`).join('')}</div>` : '';
      const fallbackHtml = !streaming && message?.source === 'fallback'
        ? '<p class="coach-answer-notice">Live coaching is unavailable, so this answer uses the built-in study guide.</p>'
        : '';

      return `
        <article class="coach-chat-message assistant">
          <div class="coach-answer-heading">
            <span class="coach-answer-mark" aria-hidden="true">✦</span>
            ${!streaming && message?.title ? `<h3 class="coach-chat-message-title">${escapeHtml(message.title)}</h3>` : '<span class="sr-only">Coach answer</span>'}
          </div>
          ${bodyHtml}
          ${sectionHtml}
          ${actionsHtml}
          ${followUpsHtml}
          ${linksHtml}
          ${fallbackHtml}
          ${streaming ? '' : renderAssistantUtilities(index, role, busy)}
        </article>`;
    }).join('');

    const busyHtml = busy ? `
      <div class="coach-chat-thinking" role="status">
        <div class="coach-chat-thinking-dots" aria-hidden="true"><span></span><span></span><span></span></div>
        <span>${escapeHtml(busyText)}</span>
      </div>` : '';
    element.innerHTML = `${html}${busyHtml}`;
  }

  function syncState(rootElement, messages, busy) {
    if (!rootElement) return;
    const hasConversation = Boolean((Array.isArray(messages) && messages.length) || busy);
    rootElement.dataset.chatPristine = hasConversation ? 'false' : 'true';
    rootElement.dataset.chatAsked = hasConversation ? 'true' : 'false';
    const reset = rootElement.querySelector('#coach-chat-new');
    if (reset) reset.hidden = !hasConversation;
  }

  function autoGrow(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(180, Math.max(56, textarea.scrollHeight))}px`;
  }

  function isSendKey(event) {
    return event?.key === 'Enter' && !event.shiftKey && !event.isComposing;
  }

  return {
    renderPrimaryAction,
    renderStarterActions,
    renderMessages,
    syncState,
    autoGrow,
    isSendKey
  };
});
