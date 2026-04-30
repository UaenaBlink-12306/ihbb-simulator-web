document.addEventListener('DOMContentLoaded', () => {
  const FILE_MODE = window.location.protocol === 'file:';
  const state = {
    authenticated: false,
    data: null,
    generatedFilter: 'all',
    generatedSearch: '',
    feedbackFilter: 'open',
    feedbackSearch: '',
    feedbackArchiveSearch: '',
    userSearch: '',
    localAdminOrigin: 'http://127.0.0.1:5057'
  };

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const avatarCatalog = window.AvatarCatalog || {};
  const normalizeAvatarId = (value) => {
    if (typeof avatarCatalog.normalizeAvatarId === 'function') return avatarCatalog.normalizeAvatarId(value);
    return 'penguin';
  };
  const avatarAssetPath = (value) => {
    if (typeof avatarCatalog.avatarAssetPath === 'function') return avatarCatalog.avatarAssetPath(value);
    return `/assets/avatars/${normalizeAvatarId(value)}.png`;
  };
  const applyAvatarImage = (img, value, altText) => {
    if (!img) return;
    if (typeof avatarCatalog.applyAvatarImage === 'function') {
      avatarCatalog.applyAvatarImage(img, value, altText);
      return;
    }
    img.alt = altText || 'Avatar';
    img.src = avatarAssetPath(value);
  };
  const userAvatarHtml = (value, name) => {
    const resolvedAvatarId = normalizeAvatarId(value);
    return `<span style="width:40px;height:40px;flex:0 0 auto;display:inline-grid;place-items:center;overflow:hidden;border-radius:14px;border:1px solid rgba(125,211,252,0.48);background:radial-gradient(circle at 30% 24%, rgba(255,255,255,0.62), transparent 34%), linear-gradient(180deg, #dff4ff, #b8e2ff);box-shadow:inset 0 1px 0 rgba(255,255,255,0.6), 0 14px 24px -24px rgba(8,47,73,0.45);"><img data-avatar-id="${esc(resolvedAvatarId)}" src="${esc(avatarAssetPath(resolvedAvatarId))}" alt="${esc(name || 'User')} avatar" style="width:80%;height:80%;display:block;object-fit:contain;transform:scale(1.12);transform-origin:center;"></span>`;
  };
  const hydrateAvatarImages = (root) => {
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    scope.querySelectorAll('img[data-avatar-id]').forEach((img) => {
      applyAvatarImage(img, img.dataset.avatarId, img.alt || 'Avatar');
    });
  };

  const formatDate = (value) => {
    const text = String(value || '').trim();
    if (!text) return '—';
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return text;
    return date.toLocaleString();
  };

  const FEEDBACK_STATUS_LABELS = {
    pending: 'Pending',
    in_review: 'In Review',
    needs_more_info: 'Needs More Info',
    resolved: 'Resolved'
  };
  const FEEDBACK_PHOTO_LIMIT = 3;
  const FEEDBACK_PHOTO_MAX_DATA_URL_CHARS = Math.ceil(1536 * 1024 * 1.38) + 128;
  const FEEDBACK_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

  const normalizeFeedbackStatus = (value) => {
    const status = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(FEEDBACK_STATUS_LABELS, status) ? status : 'pending';
  };

  const snapshotRows = (name) => {
    const tables = state.data?.database?.tables;
    if (!Array.isArray(tables)) return [];
    const table = tables.find((item) => item?.name === name);
    return Array.isArray(table?.rows) ? table.rows : [];
  };

  function localAdminUrl(origin = state.localAdminOrigin) {
    return `${String(origin || 'http://127.0.0.1:5057').replace(/\/+$/, '')}/admin.html`;
  }

  function setLocalAdminOrigin(origin) {
    state.localAdminOrigin = String(origin || 'http://127.0.0.1:5057').replace(/\/+$/, '');
    const urlEl = $('admin-local-url');
    if (urlEl) urlEl.textContent = localAdminUrl();
  }

  function showFileMode(message, type = 'muted') {
    $('admin-file-panel')?.classList.remove('hidden');
    $('admin-auth-panel')?.classList.add('hidden');
    $('admin-console')?.classList.add('hidden');
    $('admin-refresh') && ($('admin-refresh').disabled = true);
    $('admin-logout')?.classList.add('hidden');
    const statusEl = $('admin-file-status');
    if (statusEl) {
      statusEl.className = `card-muted-box${type === 'error' ? ' text-bad' : ''}`;
      statusEl.textContent = message;
    }
  }

  function handleFileMode() {
    setLocalAdminOrigin(state.localAdminOrigin);
    showFileMode('This page was opened as a local file, so the admin API and cookie session cannot work here. Start `python server.py`, then open the HTTP URL below.', 'error');
  }

  function showAlert(message, type = 'error') {
    const box = $('admin-alert');
    if (!box) return;
    if (!message) {
      box.className = 'alert hidden';
      box.textContent = '';
      return;
    }
    box.className = `alert ${type}`;
    box.textContent = message;
  }

  async function apiGet(action) {
    const response = await fetch(`/api/admin?action=${encodeURIComponent(action)}`, {
      credentials: 'same-origin'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
    return data;
  }

  async function apiPost(payload) {
    const response = await fetch('/api/admin', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
    return data;
  }

  function renderSummary() {
    const el = $('admin-summary');
    if (!el) return;
    const summary = state.data?.summary || {};
    const feedbackRows = snapshotRows('app_feedback');
    const openFeedbackCount = feedbackRows.filter((row) => {
      const status = normalizeFeedbackStatus(row?.status);
      return status === 'pending' || status === 'in_review' || status === 'needs_more_info';
    }).length;
    const replyNeededCount = feedbackRows.filter((row) => {
      const status = normalizeFeedbackStatus(row?.status);
      return status !== 'resolved' && !hasAdminResponse(row);
    }).length;
    const resolvedFeedbackCount = feedbackRows.filter((row) => normalizeFeedbackStatus(row?.status) === 'resolved').length;
    const items = [
      ['Open feedback', openFeedbackCount, 'Pending, in-review, or needs-more-info complaints.'],
      ['Reply needed', replyNeededCount, 'Open complaints without an admin response yet.'],
      ['Resolved archive', resolvedFeedbackCount, 'Completed complaints available for later review.'],
      ['Pending generated', summary.generated_pending || 0, 'Needs explicit admin keep/delete review.'],
      ['Total generated', summary.generated_total || 0, 'Merged generated questions tracked by the review ledger.'],
      ['Main bank size', summary.questions_total || 0, 'Current `questions.json` question count.'],
      ['Auth users', summary.auth_users_total || 0, 'Supabase auth users visible with service role.'],
      ['Visible user rows', summary.surfaced_users_total || 0, 'Combined auth + profile user directory.']
    ];
    el.innerHTML = items.map(([label, value, note]) => `
      <div class="metric-card admin-metric-card">
        <div class="metric-label">${esc(label)}</div>
        <div class="metric-value">${esc(String(value))}</div>
        <div class="metric-note">${esc(note)}</div>
      </div>
    `).join('');
  }

  function renderGenerated() {
    const list = $('admin-generated-list');
    if (!list) return;
    const filter = state.generatedFilter;
    const needle = state.generatedSearch.toLowerCase();
    const items = (state.data?.generated || []).filter((item) => {
      const status = String(item?.review_status || 'pending').toLowerCase();
      if (filter !== 'all' && status !== filter) return false;
      if (!needle) return true;
      const haystack = [
        item?.answer,
        item?.question,
        item?.topic,
        item?.meta?.category,
        item?.meta?.era,
        item?.created_from,
        item?.created_by_role
      ].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
    $('admin-approve-all').disabled = !(state.data?.generated || []).some((item) => item?.review_status === 'pending');
    if (!items.length) {
      list.innerHTML = `<div class="card-muted-box">No generated questions match the current filters.</div>`;
      return;
    }
    list.innerHTML = items.map((item) => {
      const status = String(item?.review_status || 'pending').toLowerCase();
      const canApprove = status === 'pending';
      const canDelete = status !== 'deleted';
      return `
        <article class="admin-generated-item">
          <div class="admin-generated-head">
            <div>
              <div class="eyebrow">${esc(item?.meta?.category || 'World')} • ${esc(item?.meta?.era || '—')} • ${esc(status)}</div>
              <h3>${esc(item?.answer || 'Untitled')}</h3>
            </div>
            <div class="admin-generated-actions">
              <button class="btn ghost admin-generated-action" type="button" data-action="approve" data-id="${esc(item?.id)}" ${canApprove ? '' : 'disabled'}>Approve</button>
              <button class="btn bad admin-generated-action" type="button" data-action="delete" data-id="${esc(item?.id)}" ${canDelete ? '' : 'disabled'}>Delete</button>
            </div>
          </div>
          <p class="admin-generated-question">${esc(item?.question || '')}</p>
          <div class="admin-generated-meta">
            <span>Topic: ${esc(item?.topic || 'General')}</span>
            <span>Created from: ${esc(item?.created_from || 'practice')}</span>
            <span>Role: ${esc(item?.created_by_role || 'unknown')}</span>
            <span>Queued: ${esc(formatDate(item?.review_created_at))}</span>
            <span>Reviewed: ${esc(formatDate(item?.reviewed_at))}</span>
            <span>Merged: ${item?.merged === false ? 'No' : 'Yes'}</span>
          </div>
        </article>
      `;
    }).join('');
  }

  function hasAdminResponse(row) {
    return String(row?.admin_response || '').trim().length > 0;
  }

  function parseThreadMessages(value) {
    let raw = value;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch {
        raw = [];
      }
    }
    if (!Array.isArray(raw)) return [];
    return raw.map((item) => {
      const role = String(item?.role || '').trim().toLowerCase() === 'admin' ? 'admin' : 'user';
      const message = String(item?.message || item?.text || '').trim();
      if (!message) return null;
      return {
        role,
        message,
        created_at: String(item?.created_at || '').trim(),
        attachments: parseFeedbackPhotoAttachments(item?.attachments || item?.photo_attachments)
      };
    }).filter(Boolean);
  }

  function feedbackThreadMessages(row, { includeOriginal = false, userLabel = 'User' } = {}) {
    const messages = [];
    const original = String(row?.message || '').trim();
    if (includeOriginal && original) {
      messages.push({
        role: 'user',
        label: userLabel,
        message: original,
        created_at: row?.created_at,
        attachments: parseFeedbackPhotoAttachments(row?.photo_attachments)
      });
    }
    const thread = parseThreadMessages(row?.thread_messages);
    const response = String(row?.admin_response || '').trim();
    const hasResponseInThread = response && thread.some((item) => item.role === 'admin' && item.message === response);
    if (response && !hasResponseInThread) {
      messages.push({
        role: 'admin',
        label: 'Admin',
        message: response,
        created_at: row?.updated_at,
        attachments: []
      });
    }
    thread.forEach((item) => {
      messages.push({
        ...item,
        label: item.role === 'admin' ? 'Admin' : userLabel
      });
    });
    return messages;
  }

  function feedbackThreadHtml(row, userLabel) {
    const messages = feedbackThreadMessages(row, { includeOriginal: false, userLabel });
    if (!messages.length) return '';
    return `
      <div class="feedback-thread admin-feedback-thread" aria-label="Feedback conversation">
        ${messages.map((item) => `
          <div class="feedback-thread-message is-${esc(item.role)}">
            <div class="feedback-thread-meta">
              <strong>${esc(item.label)}</strong>
              <span>${esc(formatDate(item.created_at))}</span>
            </div>
            <p>${esc(item.message)}</p>
            ${feedbackPhotoGalleryHtml(item.attachments)}
          </div>
        `).join('')}
      </div>
    `;
  }

  function parseFeedbackPhotoAttachments(value) {
    let raw = value;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch {
        raw = [];
      }
    }
    if (!Array.isArray(raw)) return [];
    return raw
      .map(normalizeFeedbackPhotoAttachment)
      .filter(Boolean)
      .slice(0, FEEDBACK_PHOTO_LIMIT);
  }

  function normalizeFeedbackPhotoAttachment(item) {
    if (!item || typeof item !== 'object') return null;
    const type = String(item.type || '').trim().toLowerCase();
    const dataUrl = String(item.data_url || item.dataUrl || '').trim();
    if (!FEEDBACK_PHOTO_TYPES.has(type)) return null;
    if (!dataUrl.startsWith(`data:${type};base64,`)) return null;
    if (dataUrl.length > FEEDBACK_PHOTO_MAX_DATA_URL_CHARS) return null;
    return {
      name: String(item.name || 'Photo').trim().slice(0, 100) || 'Photo',
      type,
      data_url: dataUrl
    };
  }

  function feedbackPhotoGalleryHtml(attachments) {
    const photos = parseFeedbackPhotoAttachments(attachments);
    if (!photos.length) return '';
    return `
      <div class="feedback-photo-gallery admin-feedback-photo-gallery" aria-label="Attached photos">
        ${photos.map((photo) => `
          <a class="feedback-photo-thumb" href="${esc(photo.data_url)}" target="_blank" rel="noopener" title="${esc(photo.name)}">
            <img src="${esc(photo.data_url)}" alt="${esc(photo.name)}">
            <span>${esc(photo.name)}</span>
          </a>
        `).join('')}
      </div>
    `;
  }

  function feedbackMatchesSearch(row, user, needle) {
    if (!needle) return true;
    const haystack = [
      row?.category,
      row?.message,
      row?.admin_response,
      ...parseFeedbackPhotoAttachments(row?.photo_attachments).map((photo) => photo.name),
      ...parseThreadMessages(row?.thread_messages).map((item) => item.message),
      row?.created_at,
      row?.updated_at,
      row?.user_id,
      user?.email,
      user?.display_name
    ].join(' ').toLowerCase();
    return haystack.includes(needle);
  }

  function feedbackStatsHtml(items) {
    return items.map(([label, value]) => `
      <div class="admin-feedback-count">
        <strong>${Number(value) || 0}</strong>
        <span>${esc(label)}</span>
      </div>
    `).join('');
  }

  function feedbackPreferredName(user) {
    return String(user?.display_name || '').trim();
  }

  function feedbackCardHtml(row, usersById) {
    const id = String(row?.id || '');
    const status = normalizeFeedbackStatus(row?.status);
    const isAnonymous = Boolean(row?.is_anonymous);
    const user = usersById.get(String(row?.user_id || '')) || {};
    const preferredName = feedbackPreferredName(user);
    const userLabel = isAnonymous ? 'Anonymous user' : (preferredName || 'Preferred name not set');
    const senderLabel = isAnonymous
      ? 'Sender hidden by anonymous submission'
      : (preferredName ? `Preferred name: ${preferredName}` : 'Preferred name not set in profile');
    const replyBadge = hasAdminResponse(row) ? '' : '<span class="admin-feedback-badge reply-needed">Reply needed</span>';
    return `
      <article class="admin-generated-item admin-feedback-item is-${esc(status)}" data-id="${esc(id)}">
        <div class="admin-generated-head">
          <div>
            <div class="admin-feedback-titleline">
              <div class="eyebrow">${esc(row?.category || 'Feedback')} • ${esc(FEEDBACK_STATUS_LABELS[status])}${isAnonymous ? ' • Anonymous' : ''}</div>
              ${replyBadge}
            </div>
            <h3>${esc(userLabel)}</h3>
          </div>
          <div class="admin-generated-actions">
            <select class="admin-feedback-status" aria-label="Feedback status">
              ${Object.entries(FEEDBACK_STATUS_LABELS).map(([value, label]) => `<option value="${esc(value)}" ${value === status ? 'selected' : ''}>${esc(label)}</option>`).join('')}
            </select>
            <button class="btn pri admin-feedback-save" type="button" data-id="${esc(id)}">Save Response</button>
          </div>
        </div>
        <p class="admin-generated-question">${esc(row?.message || '')}</p>
        ${feedbackPhotoGalleryHtml(row?.photo_attachments)}
        <div class="admin-generated-meta">
          <span>${esc(senderLabel)}</span>
          <span>Submitted: ${esc(formatDate(row?.created_at))}</span>
          <span>Updated: ${esc(formatDate(row?.updated_at))}</span>
        </div>
        ${feedbackThreadHtml(row, userLabel)}
        <label class="admin-feedback-response-field">
          <span>Admin response</span>
          <textarea class="admin-feedback-response" rows="3" maxlength="4000" placeholder="Write the response users will see in their dashboard history.">${esc(row?.admin_response || '')}</textarea>
        </label>
      </article>
    `;
  }

  function renderFeedbackInbox() {
    const list = $('admin-feedback-list');
    const stats = $('admin-feedback-stats');
    if (!list) return;
    const serviceConfigured = Boolean(state.data?.database?.service_role_configured);
    if (!serviceConfigured) {
      if (stats) stats.innerHTML = '';
      list.innerHTML = `<div class="card-muted-box">Set <code>SUPABASE_SERVICE_ROLE_KEY</code> on the server to unlock feedback responses.</div>`;
      return;
    }
    const usersById = new Map((state.data?.users || []).map((user) => [String(user?.id || ''), user]));
    const filter = state.feedbackFilter;
    const allRows = snapshotRows('app_feedback');
    const counts = allRows.reduce((acc, row) => {
      const status = normalizeFeedbackStatus(row?.status);
      acc[status] = (acc[status] || 0) + 1;
      if (status !== 'resolved') acc.open += 1;
      if (status !== 'resolved' && !hasAdminResponse(row)) acc.replyNeeded += 1;
      return acc;
    }, { open: 0, pending: 0, in_review: 0, resolved: 0, replyNeeded: 0 });
    if (stats) {
      stats.innerHTML = feedbackStatsHtml([
        ['Open', counts.open],
        ['Pending', counts.pending],
        ['In Review', counts.in_review],
        ['Needs Info', counts.needs_more_info],
        ['Reply Needed', counts.replyNeeded]
      ]);
    }
    const needle = state.feedbackSearch.trim().toLowerCase();
    const rows = allRows.filter((row) => {
      const status = normalizeFeedbackStatus(row?.status);
      if (status === 'resolved') return false;
      if (filter === 'reply_needed' && hasAdminResponse(row)) return false;
      if (filter === 'reply_needed') {
        const user = usersById.get(String(row?.user_id || '')) || {};
        return feedbackMatchesSearch(row, user, needle);
      }
      if (filter !== 'open' && status !== filter) return false;
      const user = usersById.get(String(row?.user_id || '')) || {};
      return feedbackMatchesSearch(row, user, needle);
    });
    if (!rows.length) {
      list.innerHTML = `<div class="card-muted-box">No feedback rows match the current filter. If this table is missing, run the app feedback migration in Supabase.</div>`;
      return;
    }
    list.innerHTML = rows.map((row) => feedbackCardHtml(row, usersById)).join('');
  }

  function renderFeedbackArchive() {
    const list = $('admin-feedback-archive-list');
    const stats = $('admin-feedback-archive-stats');
    if (!list) return;
    const serviceConfigured = Boolean(state.data?.database?.service_role_configured);
    if (!serviceConfigured) {
      if (stats) stats.innerHTML = '';
      list.innerHTML = `<div class="card-muted-box">Set <code>SUPABASE_SERVICE_ROLE_KEY</code> on the server to unlock the resolved complaint archive.</div>`;
      return;
    }
    const usersById = new Map((state.data?.users || []).map((user) => [String(user?.id || ''), user]));
    const allRows = snapshotRows('app_feedback');
    const resolvedRows = allRows.filter((row) => normalizeFeedbackStatus(row?.status) === 'resolved');
    const replyNeededCount = resolvedRows.filter((row) => !hasAdminResponse(row)).length;
    if (stats) {
      stats.innerHTML = feedbackStatsHtml([
        ['Resolved', resolvedRows.length],
        ['Reply Needed', replyNeededCount]
      ]);
    }
    const needle = state.feedbackArchiveSearch.trim().toLowerCase();
    const rows = resolvedRows.filter((row) => {
      const user = usersById.get(String(row?.user_id || '')) || {};
      return feedbackMatchesSearch(row, user, needle);
    });
    if (!rows.length) {
      list.innerHTML = `<div class="card-muted-box">No resolved complaints match the current archive search.</div>`;
      return;
    }
    list.innerHTML = rows.map((row) => feedbackCardHtml(row, usersById)).join('');
  }

  function renderUsers() {
    const el = $('admin-users');
    if (!el) return;
    const search = state.userSearch.toLowerCase();
    const serviceConfigured = Boolean(state.data?.database?.service_role_configured);
    if (!serviceConfigured) {
      el.innerHTML = `<div class="card-muted-box">Set <code>SUPABASE_SERVICE_ROLE_KEY</code> on the server to unlock the full user directory.</div>`;
      return;
    }
    const users = (state.data?.users || []).filter((user) => {
      if (!search) return true;
      return [
        user?.email,
        user?.display_name,
        user?.role,
        user?.class_code,
        user?.id
      ].join(' ').toLowerCase().includes(search);
    });
    if (!users.length) {
      el.innerHTML = `<div class="card-muted-box">No users match the current search.</div>`;
      return;
    }
    el.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr>
            <th>Email / User</th>
            <th>Role</th>
            <th>Classes</th>
            <th>Submissions</th>
            <th>Wrong Bank</th>
            <th>Sessions</th>
            <th>Coach</th>
            <th>Feedback</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          ${users.map((user) => `
            <tr>
              <td>
                <div style="display:flex;align-items:flex-start;gap:12px;min-width:0;">
                  ${userAvatarHtml(user?.avatar_id, user?.display_name || user?.email || user?.id || 'Unknown')}
                  <div style="min-width:0;">
                    <strong>${esc(user?.email || user?.display_name || user?.id || 'Unknown')}</strong>
                    <div class="admin-cell-note">${esc(user?.display_name || 'No display name')}</div>
                    <div class="admin-cell-note">${esc(user?.id || '')}</div>
                  </div>
                </div>
              </td>
              <td>${esc(user?.role || '—')}</td>
              <td>${esc(`${user?.joined_classes || 0} joined / ${user?.owned_classes || 0} owned`)}</td>
              <td>${esc(user?.assignment_submissions || 0)}</td>
              <td>${esc(user?.wrong_bank_rows || 0)}</td>
              <td>${esc(user?.drill_sessions || 0)}</td>
              <td>${esc(user?.coach_attempts || 0)}</td>
              <td>${esc(user?.feedback_rows || 0)}</td>
              <td>${esc(formatDate(user?.created_at || user?.profile_created_at))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    hydrateAvatarImages(el);
  }

  function renderDatabase() {
    const el = $('admin-database');
    if (!el) return;
    const database = state.data?.database || {};
    const warnings = Array.isArray(database.warnings) ? database.warnings : [];
    if (!database.service_role_configured) {
      el.innerHTML = `
        <div class="card-muted-box">
          <p>Set <code>SUPABASE_SERVICE_ROLE_KEY</code> on the server to unlock raw table browsing and auth-user inspection.</p>
        </div>
      `;
      return;
    }
    const tables = Array.isArray(database.tables) ? database.tables : [];
    el.innerHTML = `
      ${warnings.length ? `<div class="card-muted-box admin-warning-list">${warnings.map((warning) => `<div>${esc(warning)}</div>`).join('')}</div>` : ''}
      ${tables.map((table) => `
        <details class="admin-table-details">
          <summary>${esc(table?.name || 'table')} (${esc(table?.count || 0)})</summary>
          <pre>${esc(JSON.stringify(table?.rows || [], null, 2))}</pre>
        </details>
      `).join('')}
    `;
  }

  function renderConfigBanner() {
    const el = $('admin-config-banner');
    if (!el) return;
    const config = state.data?.config || {};
    const warnings = [];
    if (!config.admin_configured) warnings.push('Admin credentials are not configured on this server.');
    if (!config.service_role_configured) warnings.push('Supabase service role access is not configured, so the database browser and auth-user list are limited.');
    if (!warnings.length) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = `<div class="admin-warning-list">${warnings.map((warning) => `<div>${esc(warning)}</div>`).join('')}</div>`;
  }

  function renderAll() {
    const consoleEl = $('admin-console');
    const authEl = $('admin-auth-panel');
    $('admin-refresh').disabled = !state.authenticated;
    $('admin-logout').classList.toggle('hidden', !state.authenticated);
    consoleEl?.classList.toggle('hidden', !state.authenticated);
    authEl?.classList.toggle('hidden', state.authenticated);
    if (!state.authenticated) return;
    renderConfigBanner();
    renderSummary();
    renderGenerated();
    renderFeedbackInbox();
    renderFeedbackArchive();
    renderUsers();
    renderDatabase();
  }

  async function loadData() {
    const data = await apiGet('data');
    state.data = data;
    state.authenticated = true;
    renderAll();
  }

  async function refreshStatus() {
    const status = await apiGet('status');
    state.authenticated = Boolean(status?.authenticated);
    const note = $('admin-auth-note');
    if (note) {
      if (!status?.config?.admin_configured) {
        note.textContent = 'Admin login is not configured yet. Set IHBB_ADMIN_EMAIL, IHBB_ADMIN_PASSWORD_HASH, and IHBB_ADMIN_SESSION_SECRET on the server first.';
      } else {
        note.textContent = `Sign in with the server-configured admin account for ${status?.config?.admin_email || 'this app'}.`;
      }
    }
    renderAll();
    if (state.authenticated) {
      await loadData();
    }
  }

  $('admin-login-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    showAlert('');
    const submit = $('admin-login-submit');
    if (submit) submit.disabled = true;
    try {
      await apiPost({
        action: 'login',
        email: $('admin-email')?.value || '',
        password: $('admin-password')?.value || ''
      });
      $('admin-password').value = '';
      await loadData();
    } catch (error) {
      showAlert(error.message || 'Admin sign in failed.');
    } finally {
      if (submit) submit.disabled = false;
    }
  });

  $('admin-refresh')?.addEventListener('click', async () => {
    showAlert('');
    try {
      await loadData();
    } catch (error) {
      showAlert(error.message || 'Refresh failed.');
    }
  });

  $('admin-logout')?.addEventListener('click', async () => {
    showAlert('');
    try {
      await apiPost({ action: 'logout' });
    } catch {}
    state.authenticated = false;
    state.data = null;
    renderAll();
  });

  $('admin-generated-filter')?.addEventListener('change', (event) => {
    state.generatedFilter = String(event.target?.value || 'all');
    renderGenerated();
  });

  $('admin-generated-search')?.addEventListener('input', (event) => {
    state.generatedSearch = String(event.target?.value || '');
    renderGenerated();
  });

  $('admin-user-search')?.addEventListener('input', (event) => {
    state.userSearch = String(event.target?.value || '');
    renderUsers();
  });

  $('admin-feedback-filter')?.addEventListener('change', (event) => {
    state.feedbackFilter = String(event.target?.value || 'open');
    renderFeedbackInbox();
  });

  $('admin-feedback-search')?.addEventListener('input', (event) => {
    state.feedbackSearch = String(event.target?.value || '');
    renderFeedbackInbox();
  });

  $('admin-feedback-archive-search')?.addEventListener('input', (event) => {
    state.feedbackArchiveSearch = String(event.target?.value || '');
    renderFeedbackArchive();
  });

  $('admin-approve-all')?.addEventListener('click', async () => {
    showAlert('');
    try {
      await apiPost({ action: 'approve_all' });
      await loadData();
    } catch (error) {
      showAlert(error.message || 'Approve all failed.');
    }
  });

  $('admin-generated-list')?.addEventListener('click', async (event) => {
    const button = event.target.closest('.admin-generated-action');
    if (!button) return;
    const action = String(button.dataset.action || '');
    const id = String(button.dataset.id || '');
    if (!action || !id) return;
    showAlert('');
    button.disabled = true;
    try {
      await apiPost({ action, id });
      await loadData();
    } catch (error) {
      showAlert(error.message || 'Action failed.');
      button.disabled = false;
    }
  });

  async function handleFeedbackSave(event) {
    const button = event.target.closest('.admin-feedback-save');
    if (!button) return;
    const item = button.closest('.admin-feedback-item');
    const id = String(button.dataset.id || item?.dataset.id || '');
    if (!id || !item) return;
    const status = String(item.querySelector('.admin-feedback-status')?.value || 'pending');
    const adminResponse = String(item.querySelector('.admin-feedback-response')?.value || '');
    showAlert('');
    button.disabled = true;
    button.textContent = 'Saving...';
    try {
      await apiPost({
        action: 'update_feedback',
        id,
        status,
        admin_response: adminResponse
      });
      showAlert('Feedback response saved.', 'success');
      await loadData();
    } catch (error) {
      showAlert(error.message || 'Feedback response failed.');
      button.disabled = false;
      button.textContent = 'Save Response';
    }
  }

  $('admin-feedback-list')?.addEventListener('click', handleFeedbackSave);
  $('admin-feedback-archive-list')?.addEventListener('click', handleFeedbackSave);

  $('admin-open-local')?.addEventListener('click', () => {
    window.location.href = localAdminUrl();
  });

  $('admin-retry-local')?.addEventListener('click', () => {
    window.location.href = localAdminUrl();
  });

  if (FILE_MODE) {
    handleFileMode();
    return;
  }

  refreshStatus().catch((error) => {
    showAlert(error.message || 'Admin status check failed.');
  });
});
