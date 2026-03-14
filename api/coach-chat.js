const ALLOWED_ACTIONS = new Set([
  'practice_due_now',
  'review_last_misses',
  'open_ai_notebook',
  'apply_top_focus',
  'generate_focus_drill',
  'start_current_session',
  'open_setup',
  'open_review'
]);

function stringValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function normalizeText(value) {
  return stringValue(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseJsonFromContent(content) {
  if (!content) return null;
  const trimmed = String(content).trim();
  try {
    return JSON.parse(trimmed);
  } catch {}

  const cleaned = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function safeInt(value, fallback = 0) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeFocus(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const priorityRaw = stringValue(raw.priority).toLowerCase();
  return {
    key: stringValue(raw.key),
    title: stringValue(raw.title),
    region: stringValue(raw.region),
    era: stringValue(raw.era),
    topic: stringValue(raw.topic),
    reason: stringValue(raw.reason),
    action: stringValue(raw.action),
    priority: ['high', 'medium', 'low'].includes(priorityRaw) ? priorityRaw : 'medium'
  };
}

function normalizeContext(payload) {
  const raw = (payload.study_context && typeof payload.study_context === 'object') ? payload.study_context : {};
  const wrong = (raw.wrong_bank && typeof raw.wrong_bank === 'object') ? raw.wrong_bank : {};
  const notebook = (raw.coach_notebook && typeof raw.coach_notebook === 'object') ? raw.coach_notebook : {};
  const sessionHistory = (raw.session_history && typeof raw.session_history === 'object') ? raw.session_history : {};
  const lastSession = (sessionHistory.last_session && typeof sessionHistory.last_session === 'object') ? sessionHistory.last_session : {};
  const setup = (raw.setup && typeof raw.setup === 'object') ? raw.setup : {};
  const activeSet = (raw.active_set && typeof raw.active_set === 'object') ? raw.active_set : {};
  const recentIncorrect = normalizeFocus(raw.recent_incorrect) || {};
  const topFocuses = Array.isArray(notebook.top_focuses)
    ? notebook.top_focuses.map(normalizeFocus).filter(Boolean).slice(0, 4)
    : [];

  return {
    current_view: stringValue(raw.current_view),
    wrong_bank: {
      due_now: Math.max(0, safeInt(wrong.due_now, 0)),
      total: Math.max(0, safeInt(wrong.total, 0))
    },
    coach_notebook: {
      open_lessons: Math.max(0, safeInt(notebook.open_lessons, 0)),
      total: Math.max(0, safeInt(notebook.total, 0)),
      top_focuses: topFocuses
    },
    session_history: {
      total_sessions: Math.max(0, safeInt(sessionHistory.total_sessions, 0)),
      recent_accuracy: Math.max(0, Math.min(100, safeInt(sessionHistory.recent_accuracy, 0))),
      days_since_last_session: Math.max(0, safeInt(sessionHistory.days_since_last_session, 0)),
      last_session: Object.keys(lastSession).length ? {
        accuracy: Math.max(0, Math.min(100, safeInt(lastSession.accuracy, 0))),
        total: Math.max(0, safeInt(lastSession.total, 0)),
        correct: Math.max(0, safeInt(lastSession.correct, 0)),
        duration_seconds: Math.max(0, safeInt(lastSession.duration_seconds, 0)),
        timestamp: Math.max(0, safeInt(lastSession.timestamp, 0))
      } : {}
    },
    setup: {
      mode: stringValue(setup.mode),
      length: stringValue(setup.length),
      filters: stringValue(setup.filters)
    },
    active_set: {
      name: stringValue(activeSet.name),
      item_count: Math.max(0, safeInt(activeSet.item_count, 0))
    },
    recent_incorrect: recentIncorrect
  };
}

function focusTitle(focus) {
  if (!focus || typeof focus !== 'object') return '';
  return stringValue(focus.title)
    || [stringValue(focus.region), stringValue(focus.era), stringValue(focus.topic)].filter(Boolean).join(' • ')
    || 'your top focus';
}

function makeAction(id, label, reason, focusKey = '') {
  const action = { id, label, reason };
  const cleanFocusKey = stringValue(focusKey);
  if (cleanFocusKey) action.focus_key = cleanFocusKey;
  return action;
}

function dedupeActions(actions) {
  const seen = new Set();
  const out = [];
  for (const action of Array.isArray(actions) ? actions : []) {
    if (!action || typeof action !== 'object') continue;
    const id = stringValue(action.id);
    if (!ALLOWED_ACTIONS.has(id)) continue;
    const focusKey = stringValue(action.focus_key);
    const key = `${id}|${focusKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(action);
  }
  return out.slice(0, 3);
}

function buildFallback(payload) {
  const context = normalizeContext(payload);
  const userMessage = normalizeText(payload.message);
  const wrongDue = context.wrong_bank.due_now;
  const wrongTotal = context.wrong_bank.total;
  const notebookOpen = context.coach_notebook.open_lessons;
  const topFocus = context.coach_notebook.top_focuses[0] || {};
  const recentIncorrect = context.recent_incorrect || {};
  const recentAccuracy = context.session_history.recent_accuracy;
  const totalSessions = context.session_history.total_sessions;
  const daysSinceLastSession = context.session_history.days_since_last_session;
  const topFocusTitle = focusTitle(topFocus);
  const topFocusKey = stringValue(topFocus.key);
  const recentFocusTitle = focusTitle(recentIncorrect);
  const recentFocusKey = stringValue(recentIncorrect.key);
  const actions = [];
  let message = '';

  if (userMessage.includes('wrong bank') || userMessage.includes('srs')) {
    if (wrongDue > 0) {
      message = `Wrong-bank is the right tool when you want spaced repetition on misses instead of fresh coverage. You currently have ${wrongDue} due card${wrongDue === 1 ? '' : 's'} out of ${wrongTotal} tracked.`;
      actions.push(makeAction('practice_due_now', `Practice ${wrongDue} due card${wrongDue === 1 ? '' : 's'}`, 'Start the due SRS queue immediately.'));
    } else {
      message = 'Wrong-bank works best after you build up misses in regular drills. Right now nothing is due, so a fresh targeted session is the better move.';
      if (topFocusKey) actions.push(makeAction('generate_focus_drill', `Generate ${topFocusTitle}`, 'Create fresh questions around the recurring blind spot.', topFocusKey));
      actions.push(makeAction('open_review', 'Open Review', 'Check your wrong-bank status and recent session debrief.'));
    }
  } else if (userMessage.includes('notebook') || userMessage.includes('ai notebook') || userMessage.includes('lesson') || userMessage.includes('coach')) {
    message = `AI Notebook is best when you need explanation and pattern review, not repetition of the exact same misses. You have ${notebookOpen} open lesson${notebookOpen === 1 ? '' : 's'}${topFocusKey ? `, and ${topFocusTitle} is the clearest recurring lane.` : '.'}`;
    actions.push(makeAction('open_ai_notebook', 'Open AI Notebook', 'Review saved DeepSeek lessons and mastery state.'));
    if (topFocusKey) {
      actions.push(makeAction('apply_top_focus', `Apply ${topFocusTitle}`, 'Load that focus into the practice builder.', topFocusKey));
      actions.push(makeAction('generate_focus_drill', `Generate ${topFocusTitle}`, 'Turn that notebook pattern into a fresh drill.', topFocusKey));
    }
  } else if (recentFocusKey) {
    message = `You just hit a miss tied to ${recentFocusTitle}. Do not jump straight back to mixed drilling. Review the notebook explanation once, then run a short focused set before returning to broader practice.`;
    actions.push(makeAction('open_ai_notebook', 'Open the lesson', 'Review the saved DeepSeek explanation for this miss.'));
    actions.push(makeAction('generate_focus_drill', `Generate ${recentFocusTitle}`, 'Build a short corrective drill from the same lane.', recentFocusKey));
    actions.push(makeAction('review_last_misses', 'Review recent misses', 'Revisit the review queue before resuming mixed practice.'));
  } else if (wrongDue >= 3) {
    message = `You have ${wrongDue} due wrong-bank cards. That is the cleanest next move because it closes the loop on known misses before you add more volume.`;
    actions.push(makeAction('practice_due_now', `Practice ${wrongDue} due card${wrongDue === 1 ? '' : 's'}`, 'Start the due SRS queue now.'));
    if (topFocusKey) actions.push(makeAction('generate_focus_drill', `Generate ${topFocusTitle}`, 'Follow SRS with a short fresh drill in the same lane.', topFocusKey));
  } else if (topFocusKey && (notebookOpen > 0 || recentAccuracy < 70)) {
    message = `Your notebook keeps pointing back to ${topFocusTitle}. Use that as the next targeted block, then return to mixed practice after accuracy stabilizes.`;
    actions.push(makeAction('apply_top_focus', `Apply ${topFocusTitle}`, 'Load the recurring notebook focus into setup.', topFocusKey));
    actions.push(makeAction('generate_focus_drill', `Generate ${topFocusTitle}`, 'Create fresh questions in the same lane.', topFocusKey));
    actions.push(makeAction('open_ai_notebook', 'Open AI Notebook', 'Review the supporting explanations first.'));
  } else if (totalSessions <= 0) {
    message = 'Start with one normal mixed drill to create enough evidence for better recommendations. Once you miss a few questions, Wrong-bank and AI Notebook become much more valuable.';
    actions.push(makeAction('start_current_session', 'Start current session', 'Begin the drill you have configured now.'));
    actions.push(makeAction('open_setup', 'Open setup', 'Tune region, era, and mode before starting.'));
  } else {
    const freshness = daysSinceLastSession > 0
      ? `Your last session was about ${daysSinceLastSession} day${daysSinceLastSession === 1 ? '' : 's'} ago. `
      : 'You already have recent practice data. ';
    message = `${freshness}The best structure is one targeted block for a weak lane and one mixed block to test transfer. ${topFocusKey ? `Right now ${topFocusTitle} is the clearest place to focus first.` : 'Right now a short mixed drill is enough to keep momentum.'}`;
    if (topFocusKey) actions.push(makeAction('apply_top_focus', `Apply ${topFocusTitle}`, 'Set up a targeted block first.', topFocusKey));
    actions.push(makeAction('start_current_session', 'Start current session', 'Run the current practice setup.'));
    actions.push(makeAction('open_review', 'Open Review', 'Check wrong-bank and session debrief before deciding.'));
  }

  return {
    source: 'fallback',
    message,
    quick_actions: dedupeActions(actions)
  };
}

function normalizeResponse(raw, payload) {
  const fallback = buildFallback(payload);
  const obj = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const context = normalizeContext(payload);
  const validFocusKeys = new Set(
    [
      ...context.coach_notebook.top_focuses.map(focus => stringValue(focus.key)),
      stringValue(context.recent_incorrect?.key)
    ].filter(Boolean)
  );
  const actions = Array.isArray(obj.quick_actions)
    ? obj.quick_actions.map((action) => {
        if (!action || typeof action !== 'object') return null;
        const id = stringValue(action.id);
        if (!ALLOWED_ACTIONS.has(id)) return null;
        const focusKey = stringValue(action.focus_key);
        return makeAction(
          id,
          stringValue(action.label || action.title) || id.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()),
          stringValue(action.reason) || 'Recommended from your current study context.',
          validFocusKeys.has(focusKey) ? focusKey : ''
        );
      }).filter(Boolean)
    : [];

  return {
    source: 'deepseek',
    message: stringValue(obj.message) || fallback.message,
    quick_actions: dedupeActions(actions.length ? actions : fallback.quick_actions)
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let payload = {};
  try {
    payload = typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : (req.body || {});
    const fallback = buildFallback(payload);

    if (!process.env.DEEPSEEK_API_KEY) {
      return res.status(200).json(fallback);
    }

    const context = normalizeContext(payload);
    const conversation = Array.isArray(payload.conversation)
      ? payload.conversation.slice(-8).map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const role = stringValue(entry.role).toLowerCase();
          const content = stringValue(entry.content);
          if (!['user', 'assistant'].includes(role) || !content) return null;
          return { role, content };
        }).filter(Boolean)
      : [];
    const validFocusKeys = [
      ...context.coach_notebook.top_focuses.map(focus => stringValue(focus.key)),
      stringValue(context.recent_incorrect?.key)
    ].filter(Boolean);

    const system = [
      'You are the DeepSeek training sidebar inside an IHBB Practice Hub.',
      'Answer the user\'s study question clearly and accurately using only the provided app capabilities and study context.',
      'You may answer IHBB/history study questions directly, but if you are uncertain, say so instead of bluffing.',
      'Product capabilities you may mention:',
      '- Wrong-bank (SRS) practices previously missed questions that are due.',
      '- AI Notebook stores DeepSeek lessons from incorrect answers.',
      '- Apply Top Focus loads a recurring notebook focus into the practice builder.',
      '- Generate Focus Drill creates fresh generated questions for a focus.',
      '- Review Last Misses opens review and starts practice on misses.',
      '- Start Current Session launches the current practice setup.',
      '- Open Setup, Open Review, and Open AI Notebook navigate to those surfaces.',
      'Do not invent any other controls, tabs, or data.',
      'Keep the answer concise and practical.',
      `Recommend at most 3 quick actions and only use these action ids: ${Array.from(ALLOWED_ACTIONS).sort().join(', ')}.`,
      `If you use focus_key, it must exactly match one of these keys: ${validFocusKeys.length ? validFocusKeys.join(', ') : '(none available)'}.`,
      'Return strict JSON only with this shape:',
      '{"message":"string","quick_actions":[{"id":"action_id","label":"string","reason":"string","focus_key":"optional"}]}'
    ].join('\n');

    const user = {
      message: stringValue(payload.message) || 'What should I practice next?',
      conversation,
      study_context: context,
      fallback_plan: {
        message: fallback.message,
        quick_actions: fallback.quick_actions
      }
    };

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(user) }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 700
      })
    });

    const text = await response.text();
    if (!response.ok) {
      return res.status(200).json(fallback);
    }

    const data = JSON.parse(text);
    const raw = parseJsonFromContent(data?.choices?.[0]?.message?.content || '');
    return res.status(200).json(normalizeResponse(raw, payload));
  } catch (error) {
    return res.status(200).json(buildFallback(payload));
  }
};
