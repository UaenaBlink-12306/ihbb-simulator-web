(function initCoachTabUi(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.IHBBCoachTabUI = api;
})(typeof window !== 'undefined' ? window : globalThis, function coachTabUiFactory() {
  const icons = Object.freeze({
    sparkle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c.8 4.2 2.3 5.7 6.5 6.5-4.2.8-5.7 2.3-6.5 6.5-.8-4.2-2.3-5.7-6.5-6.5C9.7 8.7 11.2 7.2 12 3Z"></path><path d="M18.5 15.5c.4 1.9 1 2.5 3 3-2 .4-2.6 1-3 3-.4-2-1-2.6-3-3 2-.5 2.6-1.1 3-3Z"></path></svg>',
    primary: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2.5"></rect><path d="M9 8h6M9 12h6M9 16h4"></path></svg>',
    plan: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2.5"></rect><path d="M16 3v4M8 3v4M3 10h18"></path><path d="m9.5 15.5 2 2 3.5-3.5"></path></svg>',
    explain: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 22h4"></path><path d="M8.2 14.9A7 7 0 1 1 15.8 14.9c-.9.7-1.3 1.4-1.3 2.1h-5c0-.7-.4-1.4-1.3-2.1Z"></path></svg>',
    target: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"></circle><circle cx="12" cy="12" r="4.5"></circle><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"></circle></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"></path><path d="m5 12 7-7 7 7"></path></svg>',
    reset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 2.64-6.36L3 8"></path><path d="M3 3v5h5"></path></svg>',
    link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"></path><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"></path></svg>',
    lightning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"></path></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>',
    notebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"></path></svg>',
    megaphone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 18-7-6 15-4-4"></path><path d="M11 15 8 20l-3 1 2-6"></path></svg>',
    bookmark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"></path></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>'
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
        <span class="coach-home-action-icon" aria-hidden="true">${icons.target}</span>
        <span class="coach-home-action-copy">
          <span class="coach-home-action-kicker">Recommended for you</span>
          <strong>${escapeHtml(card.title || card.label || 'Ask the coach')}</strong>
          <span>${escapeHtml(card.copy || card.reason || 'Get a clear explanation and one useful next step.')}</span>
        </span>
        <span class="coach-home-action-arrow" aria-hidden="true">${icons.arrow}</span>
      </button>`;
  }

  function renderStarterActions(element, starters, escapeHtml) {
    if (!element) return;
    const items = safeList(starters, 2);
    element.innerHTML = items.map((starter, index) => `
      <button class="coach-home-action coach-home-action-secondary" type="button" data-starter-index="${index}">
        <span class="coach-home-action-icon" aria-hidden="true">${index === 0 ? icons.plan : icons.explain}</span>
        <span class="coach-home-action-copy">
          <span class="coach-home-action-kicker">Try asking</span>
          <strong>${escapeHtml(starter.label || 'Suggested question')}</strong>
        </span>
        <span class="coach-home-action-arrow" aria-hidden="true">${icons.arrow}</span>
      </button>`).join('');
  }

  function coachIdentity(role) {
    return role === 'teacher'
      ? { name: 'Planning Coach', hint: 'Plans lessons, assignments, and class moves from your dashboard data.' }
      : { name: 'Coach', hint: 'Personalized coaching from your recent practice.' };
  }

  function sourceChip(message, escapeHtml) {
    if (!message) return '';
    let label = 'Personalized';
    let tone = 'teal';
    if (message.source === 'fallback') {
      label = 'Study guide';
      tone = 'amber';
    } else if (message.source === 'deepseek') {
      label = 'DeepSeek';
      tone = 'blue';
    }
    return `<span class="coach-answer-chip ${tone}" title="${escapeHtml(message.source === 'fallback' ? 'Live coaching is unavailable; this answer uses the built-in study guide.' : 'Answer built from your recent practice context.')}">${escapeHtml(label)}</span>`;
  }

  function renderAssistantUtilities(index, role, busy) {
    const roleTool = role === 'teacher'
      ? '<button type="button" data-tool="send-class">' + icons.megaphone + '<span>Move to class draft</span></button>'
      : '<button type="button" data-tool="save-notebook">' + icons.bookmark + '<span>Save to Mistake Notebook</span></button>';
    return `
      <div class="coach-answer-footer">
        <div class="coach-answer-follow-through">
          <button class="coach-answer-link" type="button" data-message-index="${index}" data-tool="expand" ${busy ? 'disabled' : ''}>Explain more</button>
          <button class="coach-answer-link" type="button" data-message-index="${index}" data-tool="ask">Ask something else</button>
        </div>
        <details class="coach-answer-more">
          <summary aria-label="More answer actions" title="More answer actions"><span aria-hidden="true">•••</span></summary>
          <div class="coach-answer-more-menu" data-message-index="${index}">
            <button type="button" data-tool="copy">${icons.copy}<span>Copy answer</span></button>
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

    const identity = coachIdentity(role);
    const lastIndex = messages.length - 1;

    const html = messages.map((message, index) => {
      if (message?.role === 'user') {
        return `<div class="coach-chat-message user">
          <p class="coach-chat-user-label">You</p>
          <p class="coach-chat-message-text">${escapeHtml(message.text || '')}</p>
        </div>`;
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
      const sectionHtml = sections.length ? `<div class="coach-answer-sections">${sections.map((section, sectionIndex) => `
        <section class="coach-answer-section">
          <div class="coach-answer-section-head">
            <span class="coach-answer-section-num" aria-hidden="true">${sectionIndex + 1}</span>
            <h4>${escapeHtml(section.heading || '')}</h4>
          </div>
          ${renderSectionBody ? renderSectionBody(section.body || '') : `<p>${escapeHtml(section.body || '')}</p>`}
        </section>`).join('')}</div>` : '';
      const actionsHtml = actions.length ? `<div class="coach-answer-actions">${actions.map((action, actionIndex) => `
        <button class="coach-answer-action ${actionIndex === 0 ? 'primary' : 'secondary'}" type="button" data-message-index="${index}" data-action-index="${actionIndex}">
          <span class="coach-answer-action-label">${escapeHtml(action.label || 'Continue')}</span>
          ${action.reason ? `<span class="coach-answer-action-reason">${escapeHtml(action.reason)}</span>` : ''}
        </button>`).join('')}</div>` : '';
      const followUpsHtml = followUps.length ? `<div class="coach-answer-followups">${followUps.map((followUp, followUpIndex) => `
        <button class="coach-answer-followup" type="button" data-message-index="${index}" data-followup-index="${followUpIndex}">
          ${icons.lightning}
          <span>${escapeHtml(followUp.label || 'Follow up')}</span>
        </button>`).join('')}</div>` : '';
      const linksHtml = links.length ? `<div class="coach-chat-links">${links.map(link => `
        <a href="${escapeHtml(link.url || '')}" target="_blank" rel="noopener noreferrer">
          ${icons.link}
          <span>${escapeHtml(link.label || 'Reference')}</span>
        </a>`).join('')}</div>` : '';
      const fallbackHtml = !streaming && message?.source === 'fallback'
        ? '<p class="coach-answer-notice">Live coaching is unavailable, so this answer uses the built-in study guide.</p>'
        : '';
      const enterClass = (!streaming && !busy && index === lastIndex) ? ' coach-chat-message-enter' : '';

      return `
        <article class="coach-chat-message assistant${streaming ? ' streaming' : ''}${enterClass}">
          <header class="coach-answer-heading">
            <span class="coach-answer-avatar" aria-hidden="true">${icons.sparkle}</span>
            <div class="coach-answer-identity">
              <span class="coach-answer-name">${identity.name}</span>
              ${streaming ? '<span class="coach-answer-chip blue">Answering…</span>' : sourceChip(message, escapeHtml)}
            </div>
          </header>
          ${!streaming && message?.title ? `<h3 class="coach-chat-message-title">${escapeHtml(message.title)}</h3>` : ''}
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
        <span class="coach-chat-thinking-avatar" aria-hidden="true">${icons.sparkle}</span>
        <span class="coach-chat-thinking-copy">
          <span class="coach-chat-thinking-title">${identity.name} is reviewing your context</span>
          <span class="coach-chat-thinking-text">${escapeHtml(busyText)}</span>
        </span>
        <span class="coach-chat-thinking-dots" aria-hidden="true"><span></span><span></span><span></span></span>
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
    isSendKey,
    icons
  };
});