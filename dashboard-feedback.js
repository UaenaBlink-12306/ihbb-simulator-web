(function () {
  const FEEDBACK_TABLE = 'app_feedback';
  const CATEGORIES = ['App Bug', 'Club Suggestion', 'General Complaint'];
  const STATUS_LABELS = {
    pending: 'Pending',
    in_review: 'In Review',
    needs_more_info: 'Needs More Info',
    resolved: 'Resolved'
  };
  const RESOLVED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
  const FEEDBACK_PHOTO_LIMIT = 3;
  const FEEDBACK_PHOTO_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
  const FEEDBACK_PHOTO_MAX_STORED_BYTES = 1536 * 1024;
  const FEEDBACK_PHOTO_MAX_DATA_URL_CHARS = Math.ceil(FEEDBACK_PHOTO_MAX_STORED_BYTES * 1.38) + 128;
  const FEEDBACK_PHOTO_MAX_EDGE = 1600;
  const FEEDBACK_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

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
              <div class="input-group feedback-photo-field">
                <label for="feedback-photos">Photos (optional)</label>
                <input id="feedback-photos" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple>
                <div class="feedback-photo-hint">Attach up to ${FEEDBACK_PHOTO_LIMIT} JPG, PNG, WebP, or GIF photos.</div>
                <div id="feedback-photo-preview" class="feedback-photo-preview" aria-live="polite"></div>
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
    const photos = document.getElementById('feedback-photos');
    const photoPreview = document.getElementById('feedback-photo-preview');
    const anonymous = document.getElementById('feedback-anonymous');
    const submit = document.getElementById('feedback-submit');
    const refresh = document.getElementById('feedback-refresh');
    const statusMessage = document.getElementById('feedback-status-message');
    const summary = document.getElementById('feedback-summary');
    const historyList = document.getElementById('feedback-history-list');
    const state = { open: false, loaded: false, loading: false, submitting: false, photosProcessing: false };
    let selectedPhotos = [];
    let photoSelectionVersion = 0;

    if (!toggle || !panel || !form || !category || !message || !photos || !anonymous || !submit || !refresh || !historyList) return;

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

    photos.addEventListener('change', () => {
      const version = ++photoSelectionVersion;
      void updateSelectedFeedbackPhotos(Array.from(photos.files || []), version);
    });

    photoPreview?.addEventListener('click', (event) => {
      const button = event.target.closest('.feedback-photo-remove');
      if (!button) return;
      const index = Number(button.dataset.index);
      if (!Number.isInteger(index) || index < 0 || index >= selectedPhotos.length) return;
      selectedPhotos.splice(index, 1);
      photos.value = '';
      renderFeedbackPhotoPreview();
      setStatus(selectedPhotos.length ? `${selectedPhotos.length} ${selectedPhotos.length === 1 ? 'photo' : 'photos'} ready to attach.` : '', selectedPhotos.length ? 'success' : '');
    });

    historyList.addEventListener('click', (event) => {
      const button = event.target.closest('.feedback-delete-resolved');
      if (!button) return;
      void deleteResolvedFeedback(button);
    });

    historyList.addEventListener('submit', (event) => {
      const replyForm = event.target.closest('.feedback-reply-form');
      if (!replyForm) return;
      event.preventDefault();
      void replyToFeedback(replyForm);
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
      if (state.photosProcessing) {
        setStatus('Photos are still being prepared. Try submitting again in a moment.', 'loading');
        return;
      }

      const submitAnonymously = anonymous.checked;
      setStatus('Submitting feedback...', 'loading');
      setSubmitting(true);
      try {
        await getActiveSession();
        const payload = {
          category: selectedCategory,
          message: feedbackMessage,
          is_anonymous: submitAnonymously
        };
        if (selectedPhotos.length) {
          payload.photo_attachments = selectedPhotos.map((photo) => ({
            name: photo.name,
            type: photo.type,
            size: photo.size,
            width: photo.width,
            height: photo.height,
            data_url: photo.data_url
          }));
        }
        const { error } = await sb
          .from(FEEDBACK_TABLE)
          .insert(payload);
        if (error) throw error;
        form.reset();
        category.value = CATEGORIES[0];
        selectedPhotos = [];
        renderFeedbackPhotoPreview();
        setStatus(submitAnonymously ? 'Anonymous feedback submitted. Your history has been refreshed.' : 'Feedback submitted. Your history has been refreshed.', 'success');
        alert(submitAnonymously ? 'Anonymous feedback submitted. I will review it soon.' : 'Feedback submitted. I will review it soon.');
        await loadFeedbackHistory({ quiet: true });
      } catch (error) {
        const text = isMissingPhotoColumnError(error)
          ? 'Photo uploads need the app feedback photo migration before they can be saved.'
          : (error && error.message ? error.message : 'Feedback could not be submitted.');
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
        await purgeResolvedFeedback();
        const { data, error } = await sb
          .from(FEEDBACK_TABLE)
          .select('*')
          .order('created_at', { ascending: false });
        if (error) throw error;
        const rows = (Array.isArray(data) ? data : []).filter((row) => !isExpiredResolvedFeedback(row));
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

    async function purgeResolvedFeedback() {
      const { error } = await sb.rpc('purge_resolved_app_feedback');
      if (error && !isMissingRpcError(error)) {
        console.warn('Resolved feedback cleanup skipped:', error.message || error);
      }
    }

    async function deleteResolvedFeedback(button) {
      const feedbackId = String(button?.dataset?.id || '').trim();
      if (!feedbackId) return;
      if (!confirm('Delete this resolved feedback item from your history?')) return;

      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = 'Deleting...';
      setStatus('Deleting resolved feedback...', 'loading');
      try {
        const session = await getActiveSession();
        await requestFeedbackDelete(feedbackId, session.access_token);
        setStatus('Resolved feedback deleted.', 'success');
        await loadFeedbackHistory({ quiet: true });
      } catch (error) {
        const text = error && error.message ? error.message : 'Resolved feedback could not be deleted.';
        setStatus(text, 'error');
        alert(text);
        button.disabled = false;
        button.textContent = originalText || 'Delete';
      }
    }

    async function replyToFeedback(formEl) {
      const feedbackId = String(formEl?.dataset?.id || '').trim();
      const textarea = formEl?.querySelector('.feedback-reply-message');
      const button = formEl?.querySelector('.feedback-reply-submit');
      const replyText = String(textarea?.value || '').trim();
      if (!feedbackId || !textarea || !button) return;
      if (!replyText) {
        alert('Please write a reply before sending.');
        textarea.focus();
        return;
      }

      button.disabled = true;
      textarea.disabled = true;
      button.textContent = 'Sending...';
      setStatus('Sending reply...', 'loading');
      try {
        const session = await getActiveSession();
        await requestFeedbackReply(feedbackId, replyText, session.access_token);
        setStatus('Reply sent. The complaint is back in review.', 'success');
        await loadFeedbackHistory({ quiet: true });
      } catch (error) {
        const text = error && error.message ? error.message : 'Reply could not be sent.';
        setStatus(text, 'error');
        alert(text);
        button.disabled = false;
        textarea.disabled = false;
        button.textContent = 'Send Reply';
      }
    }

    async function requestFeedbackDelete(feedbackId, accessToken) {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken || ''}`
        },
        body: JSON.stringify({
          action: 'delete_resolved',
          id: feedbackId
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || `Delete failed (${response.status}).`);
      }
      return data;
    }

    async function requestFeedbackReply(feedbackId, messageText, accessToken) {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken || ''}`
        },
        body: JSON.stringify({
          action: 'reply_to_feedback',
          id: feedbackId,
          message: messageText
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || `Reply failed (${response.status}).`);
      }
      return data;
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
        const id = String((row && row.id) || '');
        const canDelete = status === 'resolved' && id;
        const canReply = status === 'needs_more_info' && id;
        return `
          <article class="feedback-item">
            <div class="feedback-item-head">
              <div>
                <h4>${escapeHtml(row && row.category ? row.category : 'Feedback')}</h4>
                <div class="feedback-date">${escapeHtml(formatDate(row && row.created_at))}${row?.is_anonymous ? ' • Submitted anonymously' : ''}</div>
              </div>
              <div class="feedback-item-actions">
                <span class="feedback-status feedback-status-${escapeHtml(status)}">${escapeHtml(STATUS_LABELS[status])}</span>
                ${canDelete ? `<button class="btn ghost feedback-delete-resolved" type="button" data-id="${escapeHtml(id)}">Delete</button>` : ''}
              </div>
            </div>
            ${feedbackThreadHtml(row, { includeOriginal: true, userLabel: 'You' })}
            ${canReply ? `
              <form class="feedback-reply-form" data-id="${escapeHtml(id)}">
                <label class="feedback-reply-field">
                  <span>Reply to admin</span>
                  <textarea class="feedback-reply-message" rows="3" maxlength="4000" placeholder="Add the details requested by the admin." required></textarea>
                </label>
                <div class="feedback-reply-actions">
                  <button class="btn pri feedback-reply-submit" type="submit">Send Reply</button>
                </div>
              </form>
            ` : ''}
          </article>
        `;
      }).join('');
    }

    async function updateSelectedFeedbackPhotos(files, version) {
      if (!files.length) {
        selectedPhotos = [];
        renderFeedbackPhotoPreview();
        setStatus('', '');
        setPhotosProcessing(false);
        return;
      }

      setPhotosProcessing(true);
      setStatus('Preparing photos...', 'loading');
      try {
        const limitedFiles = files.slice(0, FEEDBACK_PHOTO_LIMIT);
        const tooMany = files.length > FEEDBACK_PHOTO_LIMIT;
        const prepared = [];
        for (const file of limitedFiles) {
          prepared.push(await prepareFeedbackPhoto(file));
        }
        if (version !== photoSelectionVersion) return;
        selectedPhotos = prepared;
        renderFeedbackPhotoPreview();
        const readyText = `${prepared.length} ${prepared.length === 1 ? 'photo' : 'photos'} ready to attach.`;
        setStatus(tooMany ? `${readyText} Only the first ${FEEDBACK_PHOTO_LIMIT} were kept.` : readyText, 'success');
      } catch (error) {
        if (version !== photoSelectionVersion) return;
        selectedPhotos = [];
        photos.value = '';
        renderFeedbackPhotoPreview();
        setStatus(error?.message || 'Photos could not be prepared.', 'error');
      } finally {
        if (version === photoSelectionVersion) setPhotosProcessing(false);
      }
    }

    function renderFeedbackPhotoPreview() {
      if (!photoPreview) return;
      if (!selectedPhotos.length) {
        photoPreview.innerHTML = '';
        return;
      }
      photoPreview.innerHTML = selectedPhotos.map((photo, index) => `
        <div class="feedback-photo-chip">
          <img src="${escapeHtml(photo.data_url)}" alt="${escapeHtml(photo.name || 'Attached photo')} preview">
          <span>
            <strong>${escapeHtml(photo.name || 'Photo')}</strong>
            <small>${escapeHtml(formatFileSize(photo.size))}${photo.width && photo.height ? ` • ${escapeHtml(String(photo.width))}x${escapeHtml(String(photo.height))}` : ''}</small>
          </span>
          <button class="feedback-photo-remove" type="button" data-index="${escapeHtml(String(index))}" aria-label="Remove ${escapeHtml(photo.name || 'photo')}">&times;</button>
        </div>
      `).join('');
    }

    function setSubmitting(isSubmitting) {
      state.submitting = isSubmitting;
      syncFeedbackControls();
    }

    function setPhotosProcessing(isProcessing) {
      state.photosProcessing = isProcessing;
      syncFeedbackControls();
    }

    function syncFeedbackControls() {
      const busy = state.submitting || state.photosProcessing;
      submit.disabled = busy;
      submit.textContent = state.submitting ? 'Submitting...' : (state.photosProcessing ? 'Preparing photos...' : 'Submit');
      category.disabled = state.submitting;
      message.disabled = state.submitting;
      photos.disabled = busy;
      anonymous.disabled = state.submitting;
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
      photos.disabled = true;
      anonymous.disabled = true;
    }
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

  function buildThreadMessages(row, { includeOriginal = false, userLabel = 'User' } = {}) {
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

  function feedbackThreadHtml(row, options = {}) {
    const messages = buildThreadMessages(row, options);
    if (!messages.length) return '';
    return `
      <div class="feedback-thread" aria-label="Feedback conversation">
        ${messages.map((item) => `
          <div class="feedback-thread-message is-${escapeHtml(item.role)}">
            <div class="feedback-thread-meta">
              <strong>${escapeHtml(item.label)}</strong>
              <span>${escapeHtml(formatDate(item.created_at))}</span>
            </div>
            <p>${escapeHtml(item.message)}</p>
            ${feedbackPhotoGalleryHtml(item.attachments)}
          </div>
        `).join('')}
      </div>
    `;
  }

  function normalizeStatus(value) {
    const status = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(STATUS_LABELS, status) ? status : 'pending';
  }

  function isExpiredResolvedFeedback(row) {
    if (normalizeStatus(row && row.status) !== 'resolved') return false;
    const date = new Date((row && row.updated_at) || (row && row.created_at) || '');
    if (Number.isNaN(date.getTime())) return false;
    return Date.now() - date.getTime() >= RESOLVED_RETENTION_MS;
  }

  function isMissingRpcError(error) {
    const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`.toLowerCase();
    return text.includes('purge_resolved_app_feedback') || text.includes('could not find the function') || text.includes('pgrst202');
  }

  function isMissingPhotoColumnError(error) {
    const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`.toLowerCase();
    return text.includes('photo_attachments') && (text.includes('column') || text.includes('schema cache'));
  }

  async function prepareFeedbackPhoto(file) {
    if (!file || typeof file !== 'object') throw new Error('Choose a valid photo file.');
    const type = String(file.type || '').toLowerCase();
    if (!FEEDBACK_PHOTO_TYPES.has(type)) {
      throw new Error(`"${file.name || 'Photo'}" must be a JPG, PNG, WebP, or GIF image.`);
    }
    if (file.size > FEEDBACK_PHOTO_MAX_SOURCE_BYTES) {
      throw new Error(`"${file.name || 'Photo'}" is too large. Choose a photo under ${formatFileSize(FEEDBACK_PHOTO_MAX_SOURCE_BYTES)}.`);
    }

    const originalDataUrl = await blobToDataUrl(file);
    const image = await loadFeedbackPhoto(originalDataUrl);
    if (type === 'image/gif') {
      if (file.size > FEEDBACK_PHOTO_MAX_STORED_BYTES) {
        throw new Error(`"${file.name || 'Photo'}" is too large for GIF upload. Try a JPG or PNG instead.`);
      }
      const photo = normalizeFeedbackPhotoAttachment({
        name: file.name || 'photo.gif',
        type,
        size: file.size,
        width: image.width,
        height: image.height,
        data_url: originalDataUrl
      });
      if (!photo) throw new Error(`"${file.name || 'Photo'}" could not be prepared.`);
      return photo;
    }

    let maxEdge = FEEDBACK_PHOTO_MAX_EDGE;
    let quality = 0.82;
    let bestBlob = null;
    let bestDimensions = { width: image.width, height: image.height };
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const dimensions = scaledPhotoDimensions(image.width, image.height, maxEdge);
      const canvas = document.createElement('canvas');
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('This browser could not prepare the selected photo.');
      ctx.drawImage(image, 0, 0, dimensions.width, dimensions.height);
      const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
      if (!bestBlob || blob.size < bestBlob.size) {
        bestBlob = blob;
        bestDimensions = dimensions;
      }
      if (blob.size <= FEEDBACK_PHOTO_MAX_STORED_BYTES) break;
      if (quality > 0.62) {
        quality = Math.max(0.62, quality - 0.1);
      } else {
        maxEdge = Math.max(900, Math.floor(maxEdge * 0.8));
        quality = 0.78;
      }
    }

    if (!bestBlob || bestBlob.size > FEEDBACK_PHOTO_MAX_STORED_BYTES) {
      throw new Error(`"${file.name || 'Photo'}" is still too large after compression. Try a smaller photo.`);
    }
    const photo = normalizeFeedbackPhotoAttachment({
      name: feedbackPhotoOutputName(file.name || 'photo.jpg'),
      type: 'image/jpeg',
      size: bestBlob.size,
      width: bestDimensions.width,
      height: bestDimensions.height,
      data_url: await blobToDataUrl(bestBlob)
    });
    if (!photo) throw new Error(`"${file.name || 'Photo'}" could not be prepared.`);
    return photo;
  }

  function feedbackPhotoOutputName(name) {
    const base = String(name || 'photo').replace(/\.[^.]+$/, '').replace(/[^\w .()-]/g, '_').trim().slice(0, 80) || 'photo';
    return `${base}.jpg`;
  }

  function scaledPhotoDimensions(width, height, maxEdge) {
    const safeWidth = Math.max(1, Number(width) || 1);
    const safeHeight = Math.max(1, Number(height) || 1);
    const edge = Math.max(1, Number(maxEdge) || FEEDBACK_PHOTO_MAX_EDGE);
    const scale = Math.min(1, edge / Math.max(safeWidth, safeHeight));
    return {
      width: Math.max(1, Math.round(safeWidth * scale)),
      height: Math.max(1, Math.round(safeHeight * scale))
    };
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('The selected photo could not be read.'));
      reader.readAsDataURL(blob);
    });
  }

  function loadFeedbackPhoto(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('The selected photo could not be opened.'));
      image.src = dataUrl;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('The selected photo could not be compressed.'));
      }, type, quality);
    });
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
    const name = String(item.name || 'Photo').trim().slice(0, 100) || 'Photo';
    const size = Math.max(0, Number(item.size) || 0);
    const width = Math.max(0, Number(item.width) || 0);
    const height = Math.max(0, Number(item.height) || 0);
    return { name, type, size, width, height, data_url: dataUrl };
  }

  function feedbackPhotoGalleryHtml(attachments) {
    const photos = parseFeedbackPhotoAttachments(attachments);
    if (!photos.length) return '';
    return `
      <div class="feedback-photo-gallery" aria-label="Attached photos">
        ${photos.map((photo) => `
          <a class="feedback-photo-thumb" href="${escapeHtml(photo.data_url)}" target="_blank" rel="noopener" title="${escapeHtml(photo.name)}">
            <img src="${escapeHtml(photo.data_url)}" alt="${escapeHtml(photo.name)}">
            <span>${escapeHtml(photo.name)}</span>
          </a>
        `).join('')}
      </div>
    `;
  }

  function formatFileSize(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
    if (value >= 1024) return `${Math.round(value / 1024)} KB`;
    return `${Math.round(value)} B`;
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
