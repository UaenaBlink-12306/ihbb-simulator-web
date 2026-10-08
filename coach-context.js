(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.IHBBCoachContext = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const DAY = 86400000;
  const REGIONS = ['Africa', 'Central Asia', 'East Asia', 'Europe', 'Latin America', 'Middle East', 'North America', 'Oceania', 'South Asia', 'Southeast Asia', 'World'];
  const ERAS = ['8000 BCE – 600 BCE', '600 BCE – 600 CE', '600 CE – 1450 CE', '1450 CE – 1750 CE', '1750 – 1914', '1914 – 1991', '1991 – Present'];
  const ACTIONS = new Set(['start_assignment', 'retry_assignment', 'start_due_review', 'start_focus_drill', 'start_baseline', 'practice_saved_set', 'review_live_bee', 'open_notebook', 'open_analytics', 'open_library', 'create_targeted_drill']);
  const text = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const rows = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const stamp = value => number(value) || (Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0);
  const normalized = value => text(value, 4000).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const questionTextIndex = new WeakMap();
  const isCorrect = value => value === true || value === 1 || value === 'true';
  const eraCode = value => {
    const raw = text(String(value || ''), 80);
    if (/^0?[1-7]$/.test(raw)) return raw.padStart(2, '0');
    const index = ERAS.findIndex(era => normalized(era) === normalized(raw));
    return index < 0 ? '' : String(index + 1).padStart(2, '0');
  };
  const region = value => REGIONS.find(item => item.toLowerCase() === text(value).toLowerCase()) || '';

  function preferences(raw = {}) {
    return {
      goal: ['adaptive', 'assignments', 'review', 'tournament'].includes(raw.goal) ? raw.goal : 'adaptive',
      minutes: Math.max(3, Math.min(60, Math.round(number(raw.minutes, 10)))),
      topic: text(raw.topic, 120),
      region: region(raw.region),
      era: eraCode(raw.era),
      allow_generated: raw.allow_generated !== false
    };
  }

  // Preserve constraints across follow-ups; only an explicit new constraint replaces one.
  function requestPreferences(saved, message = '') {
    const next = preferences(saved);
    const time = message.match(/\b(\d{1,2})\s*(?:minutes?|mins?)\b|([0-9]{1,2})\s*分钟/i);
    if (time) next.minutes = Math.max(3, Math.min(60, Number(time[1] || time[2])));
    if (/\b(clear|reset|remove) (?:my |the )?(?:topic|focus)|\bmixed (?:practice|drill)|清除.*重点/i.test(message)) {
      next.topic = ''; next.region = ''; next.era = '';
    }
    const topic = message.match(/(?:focus on|practice(?: only)?(?: on| about)?|train(?: on| in)?|study(?: only)?|questions? (?:on|about)|练习|专注于)\s+(.+?)(?=[.!?\n]|\s+(?:for|in|with|using)\s+\d|$)/i);
    if (topic && !/^(next|now|it|that|my|the due|due|mistakes|review|tools?|plans?|sessions?|drills?|recommendations?|assignments?|more|again|with|using|for|before|after)\b/i.test(topic[1])) {
      const value = text(topic[1].replace(/\s+(?:for|in)\s+\d.*$/i, ''), 120);
      const exactRegion = region(value);
      const exactEra = eraCode(value);
      next.topic = exactRegion || exactEra ? '' : value;
      next.region = exactRegion; next.era = exactEra;
    }
    return next;
  }

  async function readAllPages(makeQuery, options = {}) {
    const pageSize = options.pageSize || 500;
    const maxPages = options.maxPages || 100;
    const all = [];
    for (let page = 0; page < maxPages; page += 1) {
      const result = await makeQuery().range(page * pageSize, (page + 1) * pageSize - 1);
      if (result.error) return { data: all, status: all.length ? 'partial' : 'unavailable' };
      const batch = rows(result.data);
      all.push(...batch);
      if (batch.length < pageSize) return { data: all, status: 'ready' };
    }
    return { data: all, status: 'partial' };
  }

  function mergeRecords(local, cloud, keyOf) {
    const merged = new Map();
    for (const row of [...rows(local), ...rows(cloud)]) {
      const key = keyOf(row);
      if (key) merged.set(key, row);
    }
    return [...merged.values()];
  }

  function question(raw) {
    const q = text(raw?.question || raw?.question_text || raw?.q, 14000);
    const answer = text(raw?.answer || raw?.answer_text || raw?.expected_answer, 1000);
    if (!q || !answer) return null;
    return {
      id: text(String(raw.id || raw.question_id || ''), 200), question: q, answer,
      aliases: Array.isArray(raw.aliases) ? raw.aliases.map(item => text(item, 150)).filter(Boolean) : [],
      meta: { category: region(raw.meta?.category || raw.category || raw.region), era: eraCode(raw.meta?.era || raw.era), source: text(raw.meta?.source || raw.source, 80) }
    };
  }

  function matchesQuestion(raw, filters = {}) {
    if (!raw || typeof raw !== 'object') return false;
    const meta = raw?.meta || raw || {};
    if (filters.region && region(meta.category || meta.region) !== filters.region) return false;
    if (filters.era && eraCode(meta.era) !== filters.era) return false;
    if (!filters.topic) return true;
    const tokens = normalized(filters.topic).split(' ').filter(token => !['the', 'a', 'an', 'of', 'in', 'on', 'and', 'history', 'questions'].includes(token));
    if (!tokens.length) return false;
    let haystack = questionTextIndex.get(raw);
    if (!haystack) {
      haystack = ` ${normalized(`${raw.question || raw.question_text || raw.q || ''} ${raw.answer || raw.expected_answer || ''} ${raw.focus_topic || ''}`)} `;
      questionTextIndex.set(raw, haystack);
    }
    return tokens.every(token => haystack.includes(` ${token} `));
  }

  function performance(sessions, now, questionById) {
    const result = { total_sessions: sessions.length, total_attempts: 0, accuracy: null, recent_attempts: 0, recent_accuracy: null, last_practiced_at: 0, dimensions: [], recent_sessions: [], seen_ids: [], weekly_attempts: 0, weekly_correct: 0, active_days_this_week: 0 };
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const activeDays = new Set();
    let correct = 0, recentCorrect = 0;
    const dimensions = new Map();
    const seen = new Set();
    const sorted = sessions.slice().sort((a, b) => stamp(b.ts || b.created_at) - stamp(a.ts || a.created_at));
    for (const session of sorted) {
      const ts = stamp(session.ts || session.created_at);
      const answers = Array.isArray(session.results) ? session.results : [];
      const total = Math.max(0, number(session.total, answers.length));
      const successes = Math.min(total, Math.max(0, number(session.correct, answers.filter(isCorrect).length)));
      result.total_attempts += total; correct += successes;
      if (ts >= weekStart.getTime()) {
        result.weekly_attempts += total; result.weekly_correct += successes;
        activeDays.add(new Date(ts).toDateString());
      }
      result.last_practiced_at = Math.max(result.last_practiced_at, ts);
      const recent = ts > 0 && now - ts <= 30 * DAY;
      if (recent) { result.recent_attempts += total; recentCorrect += successes; }
      const ids = Array.isArray(session.items) ? session.items : [];
      ids.forEach(id => seen.add(text(String(id), 200)));
      for (let index = 0; index < answers.length; index += 1) {
        const meta = session.meta?.[index] || questionById.get(String(ids[index]))?.meta || {};
        const cat = region(meta.category), era = eraCode(meta.era);
        for (const [key, filter] of [[`region:${cat}`, { region: cat }], [`era:${era}`, { era }], [`lane:${cat}:${era}`, { region: cat, era }]]) {
          if ((key.startsWith('region') && !cat) || (key.startsWith('era') && !era) || (key.startsWith('lane') && (!cat || !era))) continue;
          if (!dimensions.has(key)) dimensions.set(key, { key, ...filter, attempts: 0, correct: 0, recent_attempts: 0, recent_correct: 0 });
          const dim = dimensions.get(key);
          dim.attempts += 1; if (isCorrect(answers[index])) dim.correct += 1;
          if (recent) { dim.recent_attempts += 1; if (isCorrect(answers[index])) dim.recent_correct += 1; }
        }
      }
      if (result.recent_sessions.length < 8) result.recent_sessions.push({ timestamp: ts, total, correct: successes, accuracy: total ? Math.round(successes / total * 100) : null, duration_seconds: number(session.dur) });
    }
    result.accuracy = result.total_attempts ? Math.round(correct / result.total_attempts * 100) : null;
    result.recent_accuracy = result.recent_attempts ? Math.round(recentCorrect / result.recent_attempts * 100) : null;
    result.dimensions = [...dimensions.values()].map(dim => ({ ...dim, accuracy: Math.round(dim.correct / dim.attempts * 100), recent_accuracy: dim.recent_attempts ? Math.round(dim.recent_correct / dim.recent_attempts * 100) : null }));
    result.seen_ids = [...seen].filter(Boolean);
    result.active_days_this_week = activeDays.size;
    return result;
  }

  function liveBeeEvidence(games, userId, now = Date.now()) {
    const sorted = rows(games).slice().sort((a, b) => stamp(b.created_at) - stamp(a.created_at));
    const evidence = { total_games: sorted.length, personal_attempts: 0, personal_correct: 0, accuracy: null, untracked_games: 0, recent_results: [], recent_misses: [] };
    const owner = attempt => text(attempt?.userId || attempt?.user_id || attempt?.id, 200);
    for (const game of sorted) {
      let review = game.review;
      if (typeof review === 'string') { try { review = JSON.parse(review); } catch { review = []; } }
      let tracked = false, gameAttempts = 0, gameCorrect = 0;
      const misses = [];
      rows(review).forEach((round, index) => {
        const personal = rows(round.attempts).filter(attempt => owner(attempt) === userId);
        if (personal.length) tracked = true;
        gameAttempts += personal.length;
        gameCorrect += personal.filter(attempt => isCorrect(attempt.correct)).length;
        const missed = personal.length && !personal.some(attempt => isCorrect(attempt.correct)) && owner(round.solvedBy) !== userId;
        if (!missed) return;
        const item = question({ ...round, id: round.question_id || round.id || `bee_${game.id}_${index}` });
        if (item) misses.push(item);
      });
      evidence.personal_attempts += gameAttempts; evidence.personal_correct += gameCorrect;
      if (!tracked) evidence.untracked_games += 1;
      if (evidence.recent_results.length < 5) evidence.recent_results.push({ id: text(game.id, 200), played_at: stamp(game.created_at), rank: number(game.my_rank), score: number(game.my_score), personal_attempts: gameAttempts, personal_correct: gameCorrect, personal_misses: misses.length, tracked });
      if (stamp(game.created_at) >= now - 30 * DAY) evidence.recent_misses.push(...misses);
    }
    evidence.accuracy = evidence.personal_attempts ? Math.round(evidence.personal_correct / evidence.personal_attempts * 100) : null;
    evidence.recent_misses = [...new Map(evidence.recent_misses.map(item => [item.id, item])).values()];
    return evidence;
  }

  function notebook(records, bank, prefs) {
    const groups = new Map();
    let total = 0, mastered = 0;
    const lessons = [];
    for (const record of records) {
      if (isCorrect(record.correct)) continue;
      total += 1;
      if (record.mastered) { mastered += 1; continue; }
      const focus = record.coach?.study_focus || {};
      const filters = { region: region(focus.region || record.category), era: eraCode(focus.era || record.era), topic: text(focus.topic || record.focus_topic || (!focus.region && !record.category && !focus.era && !record.era ? record.expected_answer?.split('(')[0] : ''), 120) };
      const key = [filters.region, filters.era, filters.topic].join('|');
      if (!groups.has(key)) groups.set(key, { key, ...filters, open_lessons: 0, latest_at: 0, lesson_id: '', summary: '', reference: null });
      const group = groups.get(key);
      group.open_lessons += 1;
      const timestamp = stamp(record.created_at);
      const id = text(record.client_attempt_id || record.id, 200);
      const ref = question({ id, question: record.question_text, answer: record.expected_answer, category: record.category, era: record.era });
      if (timestamp >= group.latest_at) {
        group.latest_at = timestamp; group.lesson_id = id;
        group.summary = text(record.coach?.summary || record.reason, 500);
        group.reference = ref;
      }
      lessons.push({ id, ...filters, answer: text(record.expected_answer, 120), summary: text(record.coach?.summary || record.reason, 500), key_clues: Array.isArray(record.coach?.key_clues) ? record.coach.key_clues.map(clue => text(clue, 200)).slice(0, 4) : [], timestamp });
    }
    const focuses = [...groups.values()].filter(group => group.region || group.era || group.topic).map(group => ({ ...group, bank_matches: null }))
      .sort((a, b) => b.open_lessons - a.open_lessons || b.latest_at - a.latest_at || a.key.localeCompare(b.key));
    // Every lesson contributes to ranking. Only candidate actions need a bank
    // scan; scanning the entire bank for every historical focus is wasteful.
    const candidate = focuses.find(group => (!prefs.region || group.region === prefs.region) && (!prefs.era || group.era === prefs.era));
    for (const group of new Set([focuses[0], candidate].filter(Boolean))) group.bank_matches = bank.filter(item => matchesQuestion(item, group)).length;
    return { total, mastered, open_lessons: total - mastered, focuses, recent_lessons: lessons.sort((a, b) => b.timestamp - a.timestamp).slice(0, 8) };
  }

  function buildSnapshot(raw, now = Date.now()) {
    const bank = rows(raw.bank);
    const questionById = new Map(bank.map(item => [String(item.id), item]));
    const sessions = mergeRecords(raw.local_sessions, raw.cloud_sessions, row => text(row.client_session_id || row.sid, 200) || `${stamp(row.ts || row.created_at)}:${row.total}:${row.correct}:${JSON.stringify(row.items || [])}`);
    const notes = mergeRecords(raw.local_notebook, raw.cloud_notebook, row => text(row.client_attempt_id || row.id, 200) || `${row.created_at}:${row.question_text}`);
    const prefs = preferences(raw.preferences);
    const localWrong = raw.local_wrong && typeof raw.local_wrong === 'object' ? raw.local_wrong : {};
    const cloudIds = new Set(rows(raw.cloud_wrong).map(row => text(row.question_id, 200)).filter(Boolean));
    const wrongIds = raw.sources?.mistakes === 'ready' && raw.wrong_synced
      ? [...cloudIds] : [...new Set([...Object.keys(localWrong), ...cloudIds])];
    const mistakes = wrongIds.map(id => {
      const rec = localWrong[id];
      const item = questionById.get(id) || question({ id, q: rec?.q, answer: rec?.answer, meta: rec?.meta || { category: rec?.category, era: rec?.era, source: rec?.source }, aliases: rec?.aliases });
      return { id, due_at: rec ? number(rec.dueAt) : null, schedule_known: !!rec, available: !!item, region: item?.meta?.category || '', era: item?.meta?.era || '', lapses: number(rec?.lapses) };
    });
    const submissionMap = new Map(rows(raw.submissions).map(submission => [String(submission.assignment_id), submission]));
    const assignments = rows(raw.assignments).map(row => {
      const sub = submissionMap.get(String(row.id));
      const checkpoint = raw.checkpoints?.[row.id];
      return { id: text(row.id, 200), title: text(row.title, 150), instructions: text(row.instructions, 600), class_name: text(row.classes?.name || row.class_name, 100), due_at: stamp(row.due_date), completed: !!sub, answered: number(checkpoint?.answered), question_count: number(checkpoint?.total || row.question_count), saved_progress: !!checkpoint, score: sub ? { correct: number(sub.correct), total: number(sub.total) } : null, retry_count: number(raw.retries?.[row.id]) };
    }).filter(row => row.id);
    const sets = mergeRecords(raw.local_sets, raw.cloud_sets, row => text(row.id, 200)).map(set => ({ id: text(set.id, 200), name: text(set.name || set.title, 150), item_count: rows(set.items).length, matching_count: rows(set.items).filter(item => matchesQuestion(item, prefs)).length, visibility: text(set.visibility || 'local', 30) })).filter(set => set.id && set.item_count > 0);
    const history = performance(sessions, now, questionById);
    const weeklyGoal = rows(raw.weekly_goals).find(goal => {
      const goalDate = stamp(goal.week_start);
      return goalDate <= now && now - goalDate < 7 * DAY;
    });
    const catalog = new Map();
    for (const item of bank) {
      const cat = region(item.meta?.category), era = eraCode(item.meta?.era);
      const key = `${cat}|${era}`;
      if (!catalog.has(key)) catalog.set(key, { region: cat, era, count: 0 });
      catalog.get(key).count += 1;
    }
    return {
      version: 1, captured_at: now,
      learner: { display_name: text(raw.profile?.display_name, 100), role: 'student' },
      assistant_preferences: { response_detail: text(raw.profile?.account_settings?.assistant_response_detail, 30), thinking_enabled: !!raw.profile?.account_settings?.assistant_thinking_enabled },
      preferences: prefs, current_view: text(raw.current_view, 60),
      setup: { mode: text(raw.settings?.mode, 40), captions: !!raw.settings?.captions, active_set_id: text(raw.active_set_id, 200) },
      classes: rows(raw.classes).map(row => ({ id: text(row.class_id || row.id, 200), name: text(row.classes?.name || row.name, 100) })),
      assignments, performance: history, notebook: notebook(notes, bank, prefs),
      mistakes: { total: mistakes.length, due_now: mistakes.filter(row => row.schedule_known && row.due_at <= now).length, unknown_schedule: mistakes.filter(row => !row.schedule_known).length, items: mistakes },
      saved_sets: sets,
      bank: { total: bank.length, matching_count: bank.filter(item => matchesQuestion(item, prefs)).length, matching_filters: { region: prefs.region, era: prefs.era, topic: prefs.topic }, coverage: [...catalog.values()] },
      live_bee: liveBeeEvidence(raw.games, raw.uid, now),
      weekly_goal: { configured: !!weeklyGoal, target_questions: weeklyGoal ? number(weeklyGoal.target_questions, 50) : null, target_accuracy: weeklyGoal ? number(weeklyGoal.target_accuracy, 70) : null, answered: history.weekly_attempts, accuracy: history.weekly_attempts ? Math.round(history.weekly_correct / history.weekly_attempts * 100) : null, active_days: history.active_days_this_week },
      recent_actions: rows(raw.recent_actions).slice(-5).map(action => ({ id: text(action.id, 50), label: text(action.label, 160), timestamp: stamp(action.timestamp) })),
      sources: { ...(raw.sources || {}), local: 'ready' },
      capabilities: { generate: raw.can_generate !== false }
    };
  }

  function focusLabel(filters) {
    return [filters.topic, filters.region, filters.era ? ERAS[Number(filters.era) - 1] : ''].filter(Boolean).join(' · ') || 'mixed history';
  }

  function matchingCoverage(context, filters) {
    return rows(context.bank?.coverage).filter(row => (!filters.region || row.region === filters.region) && (!filters.era || row.era === filters.era)).reduce((sum, row) => sum + number(row.count), 0);
  }

  function actionKey(action) {
    return [action?.id, action?.target_id || '', action?.filters?.region || '', action?.filters?.era || '', action?.filters?.topic || '', number(action?.count)].join('|');
  }

  function plan(context, message = '', savedPreferences) {
    const prefs = requestPreferences(savedPreferences || context.preferences, message);
    let count = Math.max(3, Math.min(20, Math.floor(prefs.minutes / 1.5)));
    const remaining = context.weekly_goal?.configured ? number(context.weekly_goal.target_questions) - number(context.weekly_goal.answered) : 0;
    if (remaining > 0) count = Math.min(count, remaining);
    const now = number(context.captured_at, Date.now());
    const actions = [];
    const add = (id, label, reason, evidence, extra = {}) => {
      const action = { id, label, reason, evidence, ...extra };
      action.key = actionKey(action);
      if (!actions.some(existing => existing.key === action.key)) actions.push(action);
    };
    const pending = rows(context.assignments).filter(row => !row.completed).sort((a, b) => (a.due_at || Infinity) - (b.due_at || Infinity) || a.id.localeCompare(b.id));
    const urgent = pending.find(row => row.due_at && row.due_at <= now + 3 * DAY);
    const explicitFocus = !!(prefs.topic || prefs.region || prefs.era);
    const avoidAssignments = /\b(?:not|skip|ignore|no)\s+(?:the |my )?(?:assignments?|homework)\b/i.test(message);
    const assignmentRequest = /\b(?:assignment|homework)\b|作业/i.test(message) || prefs.goal === 'assignments';
    const reviewRequest = /\b(?:due|srs|spaced|review mistakes|mistake cards)\b|复习错题/i.test(message) || prefs.goal === 'review';
    const lessonRequest = /\b(?:explain|understand|confus|lesson|notebook)\w*\b|解释|不理解/i.test(message) && !/\b(?:choice|tool|recommendation|plan)\b/i.test(message);
    const retry = rows(context.assignments).filter(row => row.completed && row.retry_count > 0).sort((a, b) => b.retry_count - a.retry_count || a.id.localeCompare(b.id))[0];
    const selectedAssignment = assignmentRequest ? (pending.find(row => normalized(message).includes(normalized(row.title))) || pending[0]) : urgent || pending.find(row => row.saved_progress);
    if (!avoidAssignments && selectedAssignment && (assignmentRequest || !explicitFocus && !reviewRequest && !lessonRequest)) {
      const due = selectedAssignment.due_at ? selectedAssignment.due_at <= now ? 'overdue' : `due ${new Date(selectedAssignment.due_at).toISOString().slice(0, 10)}` : 'no deadline';
      add('start_assignment', `${selectedAssignment.saved_progress ? 'Continue' : 'Start'} ${selectedAssignment.title}`, selectedAssignment.saved_progress ? 'Resume your saved answers instead of restarting class work.' : 'Finish the nearest class deadline before adding new practice.', `${selectedAssignment.class_name || 'Class assignment'} · ${due}${selectedAssignment.saved_progress ? ` · ${selectedAssignment.answered}/${selectedAssignment.question_count} answered` : ''}`, { target_id: selectedAssignment.id, minutes: prefs.minutes });
    } else if (assignmentRequest && retry && !avoidAssignments) {
      add('retry_assignment', `Redo missed: ${retry.title}`, 'Revisit the exact questions missed in this completed assignment.', `${retry.retry_count} saved misses · original score stays unchanged`, { target_id: retry.id, minutes: prefs.minutes });
    }
    const due = rows(context.mistakes?.items).filter(row => row.available && row.schedule_known && row.due_at <= now && (!prefs.region || row.region === prefs.region) && (!prefs.era || row.era === prefs.era));
    // Topic-filtered drills need actual matching question text, not a guessed SRS topic.
    if (due.length && !prefs.topic && !lessonRequest) {
      add('start_due_review', `Review ${Math.min(count, due.length)} due mistake${Math.min(count, due.length) === 1 ? '' : 's'}`, 'These questions are scheduled for recall now. A short spaced review is the most direct reinforcement.', `${due.length} playable cards due${context.mistakes.unknown_schedule ? ` · ${context.mistakes.unknown_schedule} cloud cards have no local schedule` : ''}`, { question_ids: due.sort((a, b) => a.due_at - b.due_at || a.id.localeCompare(b.id)).slice(0, count).map(row => row.id), count: Math.min(count, due.length), minutes: prefs.minutes });
    }
    const beeMisses = rows(context.live_bee?.recent_misses).filter(item => matchesQuestion(item, prefs));
    if ((prefs.goal === 'tournament' || /\b(?:live bee|competition|tournament)\b/i.test(message)) && beeMisses.length) {
      add('review_live_bee', 'Revisit your missed Live Bee clues', 'Practice the questions you personally missed in recent competition before adding new material.', `${beeMisses.length} recent personal misses · room results are not counted as your answers`, { question_ids: beeMisses.slice(0, count).map(item => item.id), count: Math.min(count, beeMisses.length), minutes: prefs.minutes });
    }
    const focuses = rows(context.notebook?.focuses).filter(focus => focus.open_lessons > 0 && (!prefs.region || focus.region === prefs.region) && (!prefs.era || focus.era === prefs.era) && (!prefs.topic || normalized(focus.topic).includes(normalized(prefs.topic)) || normalized(prefs.topic).includes(normalized(focus.topic)) && focus.topic));
    const focus = focuses[0];
    if (lessonRequest && focus) add('open_notebook', 'Read the matching notebook lesson', 'Understand the missed clue before testing it again.', `${focus.open_lessons} open lesson${focus.open_lessons === 1 ? '' : 's'} · ${focusLabel(focus)}`, { target_id: focus.lesson_id });
    let filters = explicitFocus ? { region: prefs.region, era: prefs.era, topic: prefs.topic } : focus ? { region: focus.region, era: focus.era, topic: focus.topic } : null;
    let evidence = explicitFocus ? `Your requested focus: ${focusLabel(filters)} · ${prefs.minutes} minutes` : focus ? `${focus.open_lessons} unresolved notebook lesson${focus.open_lessons === 1 ? '' : 's'} · ${focus.summary || focusLabel(focus)}` : '';
    if (!filters) {
      const weak = rows(context.performance?.dimensions).filter(dim => dim.recent_attempts >= 5 && dim.recent_accuracy < (context.weekly_goal?.target_accuracy || 75) && matchingCoverage(context, dim) > 0).sort((a, b) => a.recent_accuracy - b.recent_accuracy || b.recent_attempts - a.recent_attempts || Number(!!b.region && !!b.era) - Number(!!a.region && !!a.era) || a.key.localeCompare(b.key))[0];
      if (weak) { filters = { region: weak.region || '', era: weak.era || '', topic: '' }; evidence = `${weak.recent_accuracy}% accuracy across ${weak.recent_attempts} attempts in the last 30 days`; }
    }
    if (filters) {
      const sameFilter = ['region', 'era', 'topic'].every(key => (context.bank?.matching_filters?.[key] || '') === (filters[key] || ''));
      const matches = explicitFocus ? (sameFilter ? number(context.bank?.matching_count) : filters.topic ? 0 : matchingCoverage(context, filters)) : filters.topic ? number(focus?.bank_matches) : matchingCoverage(context, filters);
      if (matches > 0) add('start_focus_drill', `Practice ${focusLabel(filters)}`, 'Use existing questions that match this focus. Keep this block narrow, then check your new results.', evidence, { filters, count: Math.min(count, matches), minutes: prefs.minutes });
      else if (prefs.allow_generated && context.capabilities?.generate) add('create_targeted_drill', `Create a ${focusLabel(filters)} drill`, 'No matching questions are available in the loaded bank. Create a small targeted set before practicing.', evidence, { filters, count: Math.min(6, count), minutes: prefs.minutes, reference: focus?.reference || null });
      else add('open_library', 'Find matching questions', 'There are no playable questions for this exact focus yet. Browse or import a matching set.', evidence, { query: filters.topic || focusLabel(filters) });
    }
    const setRequest = message.match(/(?:practice|use|open) (?:the )?["“]?(.+?)["”]? (?:set|collection)\b/i);
    const wantedSet = rows(context.saved_sets).find(set => (setRequest && normalized(set.name) === normalized(setRequest[1])) || /study later/i.test(message) && set.id === 'study_later');
    if (wantedSet?.matching_count > 0) {
      actions.length = 0;
      add('practice_saved_set', `Practice ${wantedSet.name}`, 'Use the saved questions you asked to practice.', `${wantedSet.matching_count} matching questions available`, { target_id: wantedSet.id, filters: { region: prefs.region, era: prefs.era, topic: prefs.topic }, count: Math.min(count, wantedSet.matching_count), minutes: prefs.minutes });
    }
    if (!actions.length && number(context.bank?.total) > 0) add('start_baseline', context.performance?.total_attempts ? 'Start a short mixed check' : 'Start a baseline drill', context.performance?.total_attempts ? 'There is no urgent review or supported weak area right now. Check recall with a small mixed block.' : 'Complete a short mixed drill to give the Coach evidence about your strengths and gaps.', context.performance?.total_attempts ? `${context.performance.recent_attempts} attempts in the last 30 days; no weak area has enough recent evidence` : 'No completed practice evidence yet', { count: Math.min(count, context.bank.total), minutes: prefs.minutes, filters: {} });
    if (!actions.length) add('open_library', 'Open the question library', 'Load or import questions before starting practice.', 'No playable question bank is available', { query: prefs.topic });
    const primary = actions[0];
    const alternative = actions.find(action => action.id !== primary.id && !['open_library', 'open_analytics'].includes(action.id)) || null;
    const partial = Object.entries(context.sources || {}).filter(([, status]) => status !== 'ready').map(([source]) => source);
    return { version: 1, title: primary.label, message: primary.reason, evidence: primary.evidence, primary, alternative, preferences: prefs, stop_rule: primary.id === 'start_assignment' ? `Work for ${prefs.minutes} minutes, saving progress if you need to stop.` : primary.id === 'open_notebook' ? 'Read the lesson, recall its key clues without looking, then run the matching drill.' : `Finish this ${primary.count || 'short'}-question block, then use the new results to choose the next step.`, warnings: [partial.length ? `Some context is unavailable or partial: ${partial.join(', ')}. Recommendations use the evidence loaded so far.` : '', urgent && primary.id !== 'start_assignment' ? `Class work still needs attention: ${urgent.title}.` : ''].filter(Boolean) };
  }

  function compactContext(context) {
    // Aggregate every record locally. Send complete totals/dimensions with explicit
    // recent examples, rather than sending raw question banks or identity tokens.
    const { seen_ids, ...performanceSummary } = context.performance || {};
    return {
      version: 1, captured_at: context.captured_at, learner: context.learner, assistant_preferences: context.assistant_preferences, weekly_goal: context.weekly_goal,
      preferences: preferences(context.preferences), current_view: context.current_view,
      setup: context.setup, classes: rows(context.classes), performance: performanceSummary,
      mistakes: { total: context.mistakes?.total, due_now: context.mistakes?.due_now, unknown_schedule: context.mistakes?.unknown_schedule, items: rows(context.mistakes?.items).filter(item => item.available && item.schedule_known && item.due_at <= context.captured_at).sort((a, b) => a.due_at - b.due_at).slice(0, 100) },
      notebook: { total: context.notebook?.total, mastered: context.notebook?.mastered, open_lessons: context.notebook?.open_lessons, recent_lessons: rows(context.notebook?.recent_lessons), focuses: rows(context.notebook?.focuses).slice(0, 30).map(({ reference, ...focus }) => focus), focus_count: context.notebook?.focus_count || rows(context.notebook?.focuses).length },
      saved_sets: rows(context.saved_sets).slice(0, 100), saved_set_count: context.saved_set_count || rows(context.saved_sets).length,
      assignments: rows(context.assignments).slice().sort((a, b) => Number(a.completed) - Number(b.completed) || (a.due_at || Infinity) - (b.due_at || Infinity) || String(a.id).localeCompare(String(b.id))).slice(0, 150), assignment_count: context.assignment_count || rows(context.assignments).length,
      bank: context.bank, live_bee: { ...context.live_bee, recent_misses: rows(context.live_bee?.recent_misses).slice(0, 20) }, recent_actions: rows(context.recent_actions), sources: context.sources, capabilities: context.capabilities
    };
  }

  function validAction(action, offered) {
    if (!action || !ACTIONS.has(action.id)) return null;
    return rows(offered).find(candidate => actionKey(candidate) === actionKey(action)) || null;
  }

  function validateHandoff(raw, userId, now = Date.now()) {
    if (!raw || raw.mode !== 'coach_preview_drill' || raw.user_id !== userId || !number(raw.ts) || now - raw.ts > 10 * 60000 || raw.ts > now + 60000) return null;
    const items = rows(raw.items).slice(0, 30).map(question).filter(Boolean);
    const unique = new Map(items.filter(item => item.id).map(item => [item.id, item]));
    if (!unique.size) return null;
    return { title: text(raw.title, 160) || 'Coach practice', items: [...unique.values()] };
  }

  return Object.freeze({ REGIONS, ERAS, ACTIONS, preferences, requestPreferences, readAllPages, mergeRecords, question, matchesQuestion, buildSnapshot, liveBeeEvidence, plan, compactContext, validAction, actionKey, validateHandoff, focusLabel });
});
