(function (root) {
  'use strict';
  const core = root.IHBBCoachContext;
  if (!core) return;

  function mount(options) {
    const { sb, uid, getData, navigate, generate, alert: notify } = options;
    const drawer = document.getElementById('coach-preview-drawer');
    if (!drawer) return;
    const $ = id => document.getElementById(id);
    const key = suffix => `ihbb_coach_preview_${suffix}_${uid}`;
    const read = (storageKey, fallback) => {
      try { return JSON.parse(localStorage.getItem(storageKey) || 'null') ?? fallback; } catch { return fallback; }
    };
    const write = (storageKey, value) => {
      try { localStorage.setItem(storageKey, JSON.stringify(value)); return true; } catch { return false; }
    };
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    let prefs = core.preferences(read(key('preferences'), {}));
    let messages = read(key('messages'), []);
    if (!Array.isArray(messages)) messages = [];
    messages = messages.slice(-20).filter(message => message && ['user', 'assistant'].includes(message.role) && typeof message.text === 'string').map(message => ({ role: message.role, text: message.text.slice(0, 3000) }));
    let snapshot = null, raw = null, currentPlan = null, planMessage = '', loading = null, busy = false, actionBusy = false;
    let contextUpdatedAt = 0, previousFocus = null, requestNumber = 0;
    const cloud = {};
    const sourceNames = { classes: 'Classes', assignments: 'Assignments', submissions: 'Assignment results', sessions: 'Practice history', notebook: 'Notebook lessons', mistakes: 'Mistake cards', sets: 'Saved sets', games: 'Live Bee results', goals: 'Weekly goals' };
    const local = suffix => read(`ihbb_v2_${suffix}_${uid}`, suffix === 'wrong_srs' || suffix === 'library' || suffix === 'settings' ? {} : []);
    const normalizeSet = set => {
      let items = set.items || set.questions;
      if (typeof items === 'string') { try { items = JSON.parse(items); } catch { items = []; } }
      return { ...set, items: Array.isArray(items) ? items : [] };
    };

    async function fetchSource(name, factory) {
      try {
        const result = await core.readAllPages(factory);
        if (result.status === 'unavailable' && cloud[name]?.data?.length) {
          result.data = cloud[name].data; result.status = 'partial';
        }
        cloud[name] = result;
      } catch {
        cloud[name] = { data: cloud[name]?.data || [], status: cloud[name]?.data?.length ? 'partial' : 'unavailable' };
      }
    }

    async function refresh(force = false) {
      if (loading) { await loading; return rebuild(); }
      if (!force && contextUpdatedAt && Date.now() - contextUpdatedAt < 60000) return rebuild();
      $('coach-preview-status').textContent = 'Reading your practice context…';
      $('coach-preview-plan').setAttribute('aria-busy', 'true');
      disableControls(true);
      loading = (async () => {
        await fetchSource('classes', () => sb.from('class_students').select('class_id, classes(id, name)').eq('student_id', uid).order('class_id'));
        const ids = cloud.classes.data.map(row => row.class_id).filter(Boolean);
        await Promise.all([
          ids.length ? fetchSource('assignments', () => sb.from('assignments').select('id, title, instructions, class_id, due_date, classes(name)').in('class_id', ids).order('id')) : Promise.resolve(cloud.assignments = { data: [], status: cloud.classes.status === 'ready' ? 'ready' : 'unavailable' }),
          fetchSource('submissions', () => sb.from('assignment_submissions').select('assignment_id, correct, total, submitted_at').eq('student_id', uid).order('assignment_id')),
          fetchSource('sessions', () => sb.from('user_drill_sessions').select('client_session_id, ts, total, correct, dur, items, results, meta, created_at').eq('user_id', uid).gte('created_at', '2026-04-10T02:07:20Z').order('ts', { ascending: false }).order('client_session_id')),
          fetchSource('notebook', () => sb.from('user_coach_attempts').select('client_attempt_id, question_text, expected_answer, user_answer, correct, reason, coach, category, era, focus_topic, mastered, mastered_at, created_at').eq('user_id', uid).gte('created_at', '2026-04-10T02:07:20Z').order('created_at', { ascending: false }).order('client_attempt_id')),
          fetchSource('mistakes', () => sb.from('user_wrong_questions').select('question_id').eq('user_id', uid).gte('created_at', '2026-04-10T02:07:20Z').order('question_id')),
          fetchSource('sets', () => sb.from('question_sets').select('id, title, questions, visibility, class_id, creator_id').or(`creator_id.eq.${uid}${ids.length ? `,and(visibility.eq.class,class_id.in.(${ids.join(',')}))` : ''}`).order('id')),
          fetchSource('games', () => sb.from('livebee_game_reviews').select('id, room_code, my_score, summary, review, my_rank, created_at').eq('user_id', uid).order('created_at', { ascending: false }).order('id')),
          fetchSource('goals', () => sb.from('weekly_student_goals').select('week_start, target_questions, target_accuracy, weak_area_targets').eq('user_id', uid).order('week_start', { ascending: false }))
        ]);
        contextUpdatedAt = Date.now();
      })();
      try { await loading; } finally { loading = null; disableControls(false); }
      return rebuild();
    }

    function rebuild() {
      const base = getData();
      const library = local('library');
      const checkpoints = {}, retries = {};
      const assignments = cloud.assignments?.status === 'ready' ? cloud.assignments.data : core.mergeRecords(base.assignments, cloud.assignments?.data, row => row.id);
      for (const assignment of assignments) {
        const saved = root.AssignmentProgress?.read(uid, String(assignment.id), 'first');
        if (saved) checkpoints[assignment.id] = { answered: saved.results.length, total: saved.items.length };
        const retry = read(`ihbb_assignment_result_${assignment.id}_${uid}`, null);
        retries[assignment.id] = Array.isArray(retry?.missedIds) ? retry.missedIds.length : 0;
      }
      raw = {
        uid, profile: base.profile, bank: base.bank, current_view: base.current_view, preferences: prefs,
        settings: local('settings'), active_set_id: library.activeSetId,
        classes: cloud.classes?.data || base.classes,
        assignments, submissions: cloud.submissions?.status === 'ready' ? cloud.submissions.data : Object.values(base.submissions || {}), checkpoints, retries,
        local_sessions: local('sessions'), cloud_sessions: cloud.sessions?.data,
        local_notebook: local('coach_attempts'), cloud_notebook: cloud.notebook?.data,
        local_wrong: local('wrong_srs'), cloud_wrong: cloud.mistakes?.data,
        wrong_synced: !!localStorage.getItem(`ihbb_v2_wrong_sync_seen_${uid}`),
        local_sets: (library.sets || []).map(normalizeSet), cloud_sets: (cloud.sets?.data || []).map(normalizeSet),
        games: cloud.games?.data, weekly_goals: cloud.goals?.data, recent_actions: read(key('actions'), []),
        sources: Object.fromEntries(Object.entries(cloud).map(([name, result]) => [name, result.status])), can_generate: true
      };
      snapshot = core.buildSnapshot(raw);
      currentPlan = core.plan(snapshot, planMessage);
      render();
      return snapshot;
    }

    function disableControls(disabled) {
      $('coach-preview-send').disabled = disabled || busy || actionBusy;
      $('coach-preview-refresh').disabled = disabled || busy || actionBusy;
      drawer.querySelectorAll('[data-coach-preview-action]').forEach(button => { button.disabled = disabled || busy || actionBusy; });
      drawer.querySelectorAll('#coach-preview-preferences input, #coach-preview-preferences select, #coach-preview-preferences button, [data-coach-preview-prompt], #coach-preview-reset').forEach(control => { control.disabled = disabled || busy || actionBusy; });
    }

    function actionHtml(action, index, primary = false) {
      if (!action) return '';
      return `<button class="btn ${primary ? 'pri' : 'ghost'}" type="button" data-coach-preview-action="${index}">${esc(action.label)}</button>`;
    }

    function renderPlan(plan = currentPlan) {
      if (!plan) return;
      $('coach-preview-plan').removeAttribute('aria-busy');
      $('coach-preview-plan').innerHTML = `<div class="eyebrow">Your next step</div><h3>${esc(plan.title)}</h3><p>${esc(plan.message)}</p><p class="coach-preview-evidence">${esc(plan.evidence)}</p><p class="coach-preview-stop">${esc(plan.stop_rule)}</p><div class="coach-preview-actions">${actionHtml(plan.primary, 0, true)}${actionHtml(plan.alternative, 1)}</div>${plan.warnings.map(warning => `<p class="coach-preview-warning">${esc(warning)}</p>`).join('')}`;
      disableControls(!!loading);
    }

    function render() {
      const missing = Object.values(snapshot.sources).some(status => status !== 'ready');
      $('coach-preview-status').textContent = missing ? 'Using available context · some sources need a refresh' : 'Context up to date · one focused next step';
      const sourceList = Object.entries(sourceNames).map(([name, label]) => `<li><span>${label}</span><span>${snapshot.sources[name] === 'ready' ? 'Loaded' : snapshot.sources[name] === 'partial' ? 'Partial' : 'Unavailable'}</span></li>`).join('');
      const stats = [
        `${snapshot.performance.total_sessions} practice sessions · ${snapshot.performance.total_attempts} questions`,
        `${snapshot.performance.recent_attempts} questions in the last 30 days${snapshot.performance.recent_accuracy === null ? '' : ` · ${snapshot.performance.recent_accuracy}% accuracy`}`,
        `${snapshot.notebook.open_lessons} open lessons · ${snapshot.notebook.mastered} mastered`,
        `${snapshot.mistakes.due_now} due cards · ${snapshot.mistakes.unknown_schedule} with schedule unknown on this browser`,
        `${snapshot.assignments.filter(row => !row.completed).length} pending assignments · ${snapshot.saved_sets.length} saved sets`,
        `${snapshot.bank.total.toLocaleString()} bank questions · ${snapshot.live_bee.total_games} Live Bee results · ${snapshot.live_bee.personal_attempts} personal answers`,
        snapshot.weekly_goal.configured ? `${snapshot.weekly_goal.answered}/${snapshot.weekly_goal.target_questions} weekly questions · ${snapshot.weekly_goal.target_accuracy}% target accuracy` : 'No saved weekly target is available'
      ];
      $('coach-preview-context').innerHTML = `<p class="muted">Your signed-in history is combined with saved progress and goals on this browser. Every loaded session and lesson contributes to the totals and patterns; recent examples help explain them.</p><ul class="coach-preview-context-stats">${stats.map(stat => `<li>${esc(stat)}</li>`).join('')}</ul><ul class="coach-preview-sources">${sourceList}<li><span>Goals, time limit &amp; assignment checkpoints</span><span>This browser</span></li></ul>`;
      renderPlan();
    }

    function renderMessages() {
      $('coach-preview-messages').innerHTML = messages.map(message => `<div class="coach-preview-message ${message.role}"><span>${message.role === 'user' ? 'You' : 'Coach'}</span><p>${esc(message.text)}</p></div>`).join('');
      const body = $('coach-preview-scroll');
      if (messages.length) requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
    }

    function addMessage(role, content) {
      messages.push({ role, text: String(content).slice(0, 3000) });
      messages = messages.slice(-20);
      write(key('messages'), messages);
      renderMessages();
    }

    function syncPreferences() {
      $('coach-preview-goal').value = prefs.goal;
      $('coach-preview-minutes').value = String(prefs.minutes);
      $('coach-preview-topic').value = prefs.topic;
      $('coach-preview-region').value = prefs.region;
      $('coach-preview-era').value = prefs.era;
      $('coach-preview-generated').checked = prefs.allow_generated;
    }

    async function send(message) {
      const clean = String(message || '').trim().slice(0, 2000);
      if (!clean || busy || actionBusy) return;
      const priorAction = currentPlan?.primary;
      addMessage('user', clean);
      $('coach-preview-input').value = '';
      busy = true;
      const turn = ++requestNumber;
      $('coach-preview-chat-status').textContent = 'Checking your context…';
      disableControls(true);
      try {
        await refresh();
        if (/^(?:start (?:it|that)|do (?:it|that)|launch (?:it|that)|go ahead|开始|帮我开始)[.!\s]*$/i.test(clean) && priorAction) {
          busy = false;
          await execute(priorAction);
          return;
        }
        prefs = core.requestPreferences(prefs, clean);
        write(key('preferences'), prefs); syncPreferences();
        rebuild();
        planMessage = clean;
        currentPlan = core.plan(snapshot, clean, prefs);
        renderPlan();
        const response = await root.IHBBSecurity.authenticatedFetch(sb, '/api/coach-chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(25000),
          body: JSON.stringify({ request_type: 'coach_preview', message: clean, study_context: core.compactContext(snapshot), proposed_plan: currentPlan, conversation: messages.slice(-10).map(row => ({ role: row.role, content: row.text })), response_detail: 'compact' })
        });
        const reply = await response.json().catch(() => ({}));
        if (turn !== requestNumber) return;
        if (!response.ok || reply.request_type !== 'coach_preview') throw new Error('Coach explanation unavailable');
        addMessage('assistant', typeof reply.message === 'string' && reply.message.trim() ? reply.message : `${currentPlan.message}\n${currentPlan.evidence}\n${currentPlan.stop_rule}`);
        $('coach-preview-chat-status').textContent = reply.source === 'deepseek' ? 'Coach replied using your current context.' : 'Using the built-in Coach plan.';
      } catch {
        if (turn !== requestNumber) return;
        if (currentPlan) addMessage('assistant', `${currentPlan.message}\n${currentPlan.evidence}\n${currentPlan.stop_rule}`);
        $('coach-preview-chat-status').textContent = 'AI explanation is unavailable. Your context-based plan and actions still work.';
      } finally {
        busy = false; disableControls(!!loading);
      }
    }

    function playableQuestions(action) {
      const bank = raw.bank || [];
      if (action.id === 'review_live_bee') {
        const wanted = new Set(action.question_ids);
        return snapshot.live_bee.recent_misses.filter(item => wanted.has(item.id)).slice(0, action.count);
      }
      if (action.id === 'start_due_review') {
        const byId = new Map(bank.map(item => [String(item.id), item]));
        return action.question_ids.map(id => byId.get(id) || { id, ...raw.local_wrong[id], question: raw.local_wrong[id]?.q }).map(core.question).filter(Boolean);
      }
      const pool = action.id === 'practice_saved_set'
        ? core.mergeRecords(raw.local_sets, raw.cloud_sets, set => set.id).find(set => set.id === action.target_id)?.items || [] : bank;
      const seen = new Set(snapshot.performance.seen_ids);
      const candidates = pool.filter(item => core.matchesQuestion(item, action.filters)).map(core.question).filter(Boolean);
      // Prefer unseen questions; randomize within those tiers without widening filters.
      for (let index = candidates.length - 1; index > 0; index -= 1) {
        const other = Math.floor(Math.random() * (index + 1));
        [candidates[index], candidates[other]] = [candidates[other], candidates[index]];
      }
      candidates.sort((a, b) => Number(seen.has(a.id)) - Number(seen.has(b.id)));
      const unique = new Map(candidates.map(item => [item.id, item]));
      return [...unique.values()].slice(0, action.count);
    }

    async function execute(requested) {
      if (actionBusy || busy) return;
      actionBusy = true; disableControls(true);
      $('coach-preview-chat-status').textContent = 'Preparing your practice…';
      try {
        const session = await sb.auth.getSession();
        if (session.data?.session?.user?.id !== uid) throw new Error('Please sign in again before starting Coach practice.');
        // Refresh remote state before executing stale advice from another tab/session.
        await refresh(true);
        const freshPlan = core.plan(snapshot, '', prefs);
        const offered = [freshPlan.primary, freshPlan.alternative].filter(Boolean);
        // A deliberate alternative from the current chat keeps its intent, but must
        // still be producible from the fresh context and the same exact constraints.
        const originalIntentPlan = core.plan(snapshot, planMessage, prefs);
        offered.push(originalIntentPlan.primary, originalIntentPlan.alternative);
        const action = core.validAction(requested, offered.filter(Boolean));
        if (!action) {
          currentPlan = freshPlan; renderPlan();
          addMessage('assistant', 'Your context changed since that recommendation. I have refreshed the next step; use the updated action below.');
          return;
        }
        if (['start_due_review', 'start_focus_drill', 'start_baseline', 'practice_saved_set', 'review_live_bee'].includes(action.id)) {
          const items = playableQuestions(action);
          if (!items.length) throw new Error('No matching questions are available. Refresh your context or choose another focus.');
          const handoff = { mode: 'coach_preview_drill', user_id: uid, ts: Date.now(), title: action.label, items };
          if (!write(`ihbb_v2_coach_chat_action_${uid}`, handoff)) throw new Error('This browser could not save the practice launch. Enable site storage and try again.');
          recordAction(action); close();
          root.location.href = 'index.html?drill=1';
        } else if (action.id === 'create_targeted_drill') {
          await generate(action);
          recordAction(action);
        } else {
          await navigate(action);
          recordAction(action); close();
        }
      } catch (error) {
        const message = error?.message || 'Could not start this action. Try refreshing your context.';
        $('coach-preview-chat-status').textContent = message;
        notify?.(message, 'error');
      } finally { actionBusy = false; disableControls(!!loading); }
    }

    function recordAction(action) {
      const history = read(key('actions'), []);
      write(key('actions'), [...(Array.isArray(history) ? history : []), { id: action.id, label: action.label, timestamp: Date.now() }].slice(-20));
    }

    function open() {
      previousFocus = document.activeElement;
      drawer.classList.add('open'); drawer.removeAttribute('inert');
      drawer.setAttribute('aria-hidden', 'false');
      $('coach-preview-backdrop').hidden = false;
      $('btn-coach-preview').setAttribute('aria-expanded', 'true');
      document.body.classList.add('coach-preview-open');
      $('coach-preview-close').focus();
      void refresh().catch(() => { $('coach-preview-status').textContent = 'Could not read context. Use Refresh to try again.'; });
    }

    function close() {
      drawer.classList.remove('open'); drawer.setAttribute('inert', '');
      drawer.setAttribute('aria-hidden', 'true');
      $('coach-preview-backdrop').hidden = true;
      $('btn-coach-preview').setAttribute('aria-expanded', 'false');
      document.body.classList.remove('coach-preview-open');
      (previousFocus?.isConnected ? previousFocus : $('btn-coach-preview')).focus({ preventScroll: true });
    }

    $('coach-preview-region').innerHTML = `<option value="">Any region</option>${core.REGIONS.map(value => `<option>${esc(value)}</option>`).join('')}`;
    $('coach-preview-era').innerHTML = `<option value="">Any era</option>${core.ERAS.map((value, index) => `<option value="${String(index + 1).padStart(2, '0')}">${esc(value)}</option>`).join('')}`;
    syncPreferences(); renderMessages();
    $('btn-coach-preview').addEventListener('click', open);
    $('coach-preview-close').addEventListener('click', close);
    $('coach-preview-backdrop').addEventListener('click', close);
    $('coach-preview-refresh').addEventListener('click', () => { void refresh(true); });
    $('coach-preview-preferences').addEventListener('submit', event => {
      event.preventDefault();
      if (busy || actionBusy || loading) return;
      prefs = core.preferences({ goal: $('coach-preview-goal').value, minutes: $('coach-preview-minutes').value, topic: $('coach-preview-topic').value, region: $('coach-preview-region').value, era: $('coach-preview-era').value, allow_generated: $('coach-preview-generated').checked });
      planMessage = '';
      if (!write(key('preferences'), prefs)) notify?.('Goals could not be saved on this browser.', 'error');
      syncPreferences(); if (raw) rebuild();
      $('coach-preview-chat-status').textContent = 'Goals saved on this browser. Your next step is updated.';
    });
    $('coach-preview-form').addEventListener('submit', event => { event.preventDefault(); void send($('coach-preview-input').value); });
    $('coach-preview-input').addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send(event.target.value); }
    });
    $('coach-preview-reset').addEventListener('click', () => { if (busy || actionBusy) return; messages = []; planMessage = ''; write(key('messages'), []); renderMessages(); if (raw) rebuild(); $('coach-preview-chat-status').textContent = 'Conversation cleared. Your saved goals are kept.'; });
    drawer.addEventListener('click', event => {
      const button = event.target.closest('[data-coach-preview-action]');
      if (button) void execute(Number(button.dataset.coachPreviewAction) === 0 ? currentPlan?.primary : currentPlan?.alternative);
      const starter = event.target.closest('[data-coach-preview-prompt]');
      if (starter) void send(starter.dataset.coachPreviewPrompt);
    });
    document.addEventListener('keydown', event => {
      if (!drawer.classList.contains('open')) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...drawer.querySelectorAll('button, input, select, textarea, summary')].filter(el => !el.disabled && el.getClientRects().length);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    root.addEventListener('storage', event => {
      if (!event.key || !event.key.endsWith(`_${uid}`)) return;
      if (event.key === key('preferences')) { prefs = core.preferences(read(key('preferences'), {})); syncPreferences(); }
      contextUpdatedAt = 0;
      if (drawer.classList.contains('open') && !busy && !actionBusy) void refresh();
    });
    return { refresh, close };
  }

  root.IHBBCoachPreview = Object.freeze({ mount });
})(window);
