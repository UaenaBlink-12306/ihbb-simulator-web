(function () {
  const FEEDBACK_TABLE = 'app_feedback';
  const CATEGORIES = ['App Bug', 'Club Suggestion', 'General Complaint'];
  const STATUS_LABELS = {
    pending: 'Pending',
    in_review: 'In Review',
    resolved: 'Resolved'
  };

  document.addEventListener('DOMContentLoaded', () => {
    const shell = document.querySelector('.dashboard-shell, .page-shell');
    if (!shell || document.getElementById('app-feedback-dock')) return;
    shell.insertAdjacentHTML('beforeend', feedbackDockHtml());
    initFeedbackDock();
  });

  function feedbackDockHtml() {
    return `
      <section id="app-feedback-dock" class="feedback-dock" aria-labelledby="feedback-dock-title">
        <button id="feedback-toggle" class="feedback-toggle" type="button" aria-expanded="false" aria-controls="feedback-panel">
          <span class="feedback-toggle-main">
            <span id="feedback-dock-title" class="feedback-toggle-title">Complain to me</span>
            <span id="feedback-summary" class="feedback-toggle-summary">Send an issue or check responses.</span>
          </span>
          <span id="feedback-toggle-icon" class="feedback-toggle-icon" aria-hidden="true">+</span>
        </button>
        <div id="feedback-panel" class="feedback-panel hidden">
          <form id="feedback-form" class="feedback-form">
            <div class="feedback-form-head">
              <div>
                <div class="eyebrow">Feedback</div>
                <h3>Submit an issue</h3>
              </div>
              <button id="feedback-submit" class="btn pri" type="submit">Submit</button>
            </div>
            <div class="feedback-form-grid">
              <div class="input-group">
                <label for="feedback-category">Category</label>
                <select id="feedback-category" required>
                  ${CATEGORIES.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('')}
                </select>
              </div>
              <div class="input-group feedback-message-group">
                <label for="feedback-message">Message</label>
                <textarea id="feedback-message" rows="4" maxlength="4000" placeholder="What is broken, confusing, or worth changing?" required></textarea>
              </div>
              <label class="feedback-anonymous-option" for="feedback-anonymous">
                <input id="feedback-anonymous" type="checkbox">
                <span>
                  <strong>Submit anonymously</strong>
                  <small>Your dashboard history still shows this item, but the admin inbox will hide your name.</small>
                </span>
              </label>
            </div>
            <div id="feedback-status-message" class="feedback-status-message" aria-live="polite"></div>
          </form>
          <div class="feedback-history">
            <div class="feedback-history-head">
              <div>
                <div class="eyebrow">History</div>
                <h3>Previous feedback</h3>
              </div>
              <button id="feedback-refresh" class="btn ghost" type="button">Refresh</button>
            </div>
            <div id="feedback-history-list" class="feedback-history-list">
              <p class="muted">Loading feedback...</p>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function initFeedbackDock() {
    const sb = window.supabaseClient;
    const toggle = document.getElementById('feedback-toggle');
    const panel = document.getElementById('feedback-panel');
    const icon = document.getElementById('feedback-toggle-icon');
    const form = document.getElementById('feedback-form');
    const category = document.getElementById('feedback-category');
    const message = document.getElementById('feedback-message');
    const anonymous = document.getElementById('feedback-anonymous');
    const submit = document.getElementById('feedback-submit');
    const refresh = document.getElementById('feedback-refresh');
    const statusMessage = document.getElementById('feedback-status-message');
    const summary = document.getElementById('feedback-summary');
    const historyList = document.getElementById('feedback-history-list');
    const state = { open: false, loaded: false, loading: false };

    if (!toggle || !panel || !form || !category || !message || !anonymous || !submit || !refresh || !historyList) return;

    toggle.addEventListener('click', () => {
      state.open = !state.open;
      panel.classList.toggle('hidden', !state.open);
      toggle.setAttribute('aria-expanded', state.open ? 'true' : 'false');
      if (icon) icon.textContent = state.open ? '-' : '+';
      if (state.open && !state.loaded && !state.loading) {
        void loadFeedbackHistory({ quiet: true });
      }
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void submitFeedback();
    });

    refresh.addEventListener('click', () => {
      void loadFeedbackHistory({ quiet: false });
    });

    if (!sb) {
      disableFeedback('Feedback is unavailable because Supabase is not loaded.');
      return;
    }

    void loadFeedbackHistory({ quiet: true });

    async function getActiveSession() {
      const { data, error } = await sb.auth.getSession();
      if (error) throw error;
      const session = data && data.session;
      if (!session) throw new Error('Please sign in again before sending feedback.');
      return session;
    }

    async function submitFeedback() {
      const selectedCategory = String(category.value || '').trim();
      const feedbackMessage = String(message.value || '').trim();
      if (!CATEGORIES.includes(selectedCategory)) {
        alert('Please choose a feedback category.');
        category.focus();
        return;
      }
      if (!feedbackMessage) {
        alert('Please write a message before submitting.');
        message.focus();
        return;
      }

      const submitAnonymously = anonymous.checked;
      setStatus('Submitting feedback...', 'loading');
      setSubmitting(true);
      try {
        await getActiveSession();
        const { error } = await sb
          .from(FEEDBACK_TABLE)
          .insert({
            category: selectedCategory,
            message: feedbackMessage,
            is_anonymous: submitAnonymously
          });
        if (error) throw error;
        form.reset();
        category.value = CATEGORIES[0];
        setStatus(submitAnonymously ? 'Anonymous feedback submitted. Your history has been refreshed.' : 'Feedback submitted. Your history has been refreshed.', 'success');
        alert(submitAnonymously ? 'Anonymous feedback submitted. I will review it soon.' : 'Feedback submitted. I will review it soon.');
        await loadFeedbackHistory({ quiet: true });
      } catch (error) {
        const text = error && error.message ? error.message : 'Feedback could not be submitted.';
        setStatus(text, 'error');
        alert(text);
      } finally {
        setSubmitting(false);
      }
    }

    async function loadFeedbackHistory({ quiet = false } = {}) {
      state.loading = true;
      if (state.open) {
        historyList.innerHTML = '<p class="muted">Loading feedback...</p>';
      }
      if (summary) summary.textContent = 'Checking feedback history...';
      refresh.disabled = true;
      try {
        await getActiveSession();
        const { data, error } = await sb
          .from(FEEDBACK_TABLE)
          .select('id, category, message, status, admin_response, is_anonymous, created_at')
          .order('created_at', { ascending: false });
        if (error) throw error;
        const rows = Array.isArray(data) ? data : [];
        state.loaded = true;
        renderFeedbackRows(rows);
      } catch (error) {
        const text = error && error.message ? error.message : 'Feedback history could not be loaded.';
        if (summary) summary.textContent = 'Feedback history unavailable.';
        if (state.open) {
          historyList.innerHTML = `<div class="card-muted-box text-bad">${escapeHtml(text)}</div>`;
        }
        if (!quiet) alert(text);
      } finally {
        state.loading = false;
        refresh.disabled = false;
      }
    }

    function renderFeedbackRows(rows) {
      if (summary) {
        summary.textContent = rows.length
          ? `${rows.length} previous ${rows.length === 1 ? 'issue' : 'issues'}`
          : 'No previous feedback yet.';
      }
      if (!rows.length) {
        historyList.innerHTML = '<div class="card-muted-box">No feedback submitted yet.</div>';
        return;
      }
      historyList.innerHTML = rows.map((row) => {
        const status = normalizeStatus(row && row.status);
        const response = String((row && row.admin_response) || '').trim();
        return `
          <article class="feedback-item">
            <div class="feedback-item-head">
              <div>
                <h4>${escapeHtml(row && row.category ? row.category : 'Feedback')}</h4>
                <div class="feedback-date">${escapeHtml(formatDate(row && row.created_at))}${row?.is_anonymous ? ' • Submitted anonymously' : ''}</div>
              </div>
              <span class="feedback-status feedback-status-${escapeHtml(status)}">${escapeHtml(STATUS_LABELS[status])}</span>
            </div>
            <p class="feedback-message">${escapeHtml(row && row.message ? row.message : '')}</p>
            ${response ? `
              <div class="feedback-admin-response">
                <strong>Response</strong>
                <p>${escapeHtml(response)}</p>
              </div>
            ` : ''}
          </article>
        `;
      }).join('');
    }

    function setSubmitting(isSubmitting) {
      submit.disabled = isSubmitting;
      submit.textContent = isSubmitting ? 'Submitting...' : 'Submit';
      category.disabled = isSubmitting;
      message.disabled = isSubmitting;
      anonymous.disabled = isSubmitting;
    }

    function setStatus(text, type) {
      if (!statusMessage) return;
      statusMessage.textContent = text || '';
      statusMessage.className = `feedback-status-message ${type || ''}`.trim();
    }

    function disableFeedback(text) {
      setStatus(text, 'error');
      if (summary) summary.textContent = text;
      submit.disabled = true;
      refresh.disabled = true;
      category.disabled = true;
      message.disabled = true;
      anonymous.disabled = true;
    }
  }

  function normalizeStatus(value) {
    const status = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(STATUS_LABELS, status) ? status : 'pending';
  }

  function formatDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleString([], {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
