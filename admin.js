document.addEventListener('DOMContentLoaded', () => {
  const FILE_MODE = window.location.protocol === 'file:';
  const state = {
    authenticated: false,
    data: null,
    generatedFilter: 'all',
    generatedSearch: '',
    userSearch: '',
    localAdminOrigin: 'http://127.0.0.1:5057'
  };

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const formatDate = (value) => {
    const text = String(value || '').trim();
    if (!text) return '—';
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return text;
    return date.toLocaleString();
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
    const items = [
      ['Pending generated', summary.generated_pending || 0, 'Needs explicit admin keep/delete review.'],
      ['Total generated', summary.generated_total || 0, 'Merged generated questions tracked by the review ledger.'],
      ['Main bank size', summary.questions_total || 0, 'Current `questions.json` question count.'],
      ['Auth users', summary.auth_users_total || 0, 'Supabase auth users visible with service role.'],
      ['Visible user rows', summary.surfaced_users_total || 0, 'Combined auth + profile user directory.']
    ];
    el.innerHTML = items.map(([label, value, note]) => `
      <div class="metric-card admin-metric-card">
        <div class="metric-label">${esc(label)}</div>
        <div class="metric-value">${esc(value)}</div>
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
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          ${users.map((user) => `
            <tr>
              <td>
                <strong>${esc(user?.email || user?.display_name || user?.id || 'Unknown')}</strong>
                <div class="admin-cell-note">${esc(user?.display_name || 'No display name')}</div>
                <div class="admin-cell-note">${esc(user?.id || '')}</div>
              </td>
              <td>${esc(user?.role || '—')}</td>
              <td>${esc(`${user?.joined_classes || 0} joined / ${user?.owned_classes || 0} owned`)}</td>
              <td>${esc(user?.assignment_submissions || 0)}</td>
              <td>${esc(user?.wrong_bank_rows || 0)}</td>
              <td>${esc(user?.drill_sessions || 0)}</td>
              <td>${esc(user?.coach_attempts || 0)}</td>
              <td>${esc(formatDate(user?.created_at || user?.profile_created_at))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
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
