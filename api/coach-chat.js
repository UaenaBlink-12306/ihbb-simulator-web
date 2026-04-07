const ALLOWED_ACTIONS = new Set([
  'practice_due_now',
  'review_last_misses',
  'open_ai_notebook',
  'apply_top_focus',
  'generate_focus_drill',
  'start_current_session',
  'open_setup',
  'open_review',
  'open_library'
]);

const ALLOWED_MODES = new Set(['auto', 'coach', 'knowledge']);
const COACH_INTENT_TERMS = [
  'wrong bank', 'srs', 'notebook', 'ai notebook', 'lesson', 'coach',
  'practice', 'train', 'drill', 'session', 'review', 'setup', 'focus',
  'due card', 'due now', 'assignment', 'next step', 'next steps',
  'next move', 'future step', 'future steps', 'study plan', 'practice plan'
];
const KNOWLEDGE_INTENT_TERMS = [
  'explain', 'define', 'describe', 'summarize', 'summary', 'timeline',
  'compare', 'contrast', 'significance', 'importance', 'overview',
  'background', 'concept', 'cause', 'causes', 'effect', 'effects',
  'turning point', 'detail', 'details', 'in detail', 'teach me',
  'help me understand', 'break down', 'elaborate', 'deeper', 'more context'
];
const COACH_INTENT_PATTERNS = [
  /\bwhat should i\b/,
  /\bwhat do i do next\b/,
  /\bwhat should i do next\b/,
  /\bwhat should i practice next\b/,
  /\bhow should i\b/,
  /\bshould i use\b/,
  /\bnext step\b/,
  /\bnext steps\b/,
  /\bnext move\b/,
  /\bfuture step\b/,
  /\bfuture steps\b/,
  /\bbuild me\b.*\b(plan|drill|session)\b/,
  /\bmake me\b.*\b(plan|drill|session)\b/,
  /\bturn this into\b.*\b(plan|drill|session)\b/
];
const KNOWLEDGE_INTENT_PATTERNS = [
  /\bwho (is|was|were|are|did|do|does)\b/,
  /\bwhat (is|was|were|are|did|do|does|happened|caused)\b/,
  /\bwhen (did|was|were|is|are)\b/,
  /\bwhere (is|was|were|did)\b/,
  /\bwhy\b/,
  /\bhow (did|do|does|was|were|is|are)\b/,
  /\btell me about\b/,
  /\bgive me (?:a )?timeline of\b/,
  /\bwhat is the significance of\b/,
  /\bwhat was the significance of\b/,
  /\bwhat caused\b/,
  /\bwhat were the causes of\b/,
  /\bwhat happened in\b/
];

function stringValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function normalizeText(value) {
  return stringValue(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function countPatternHits(message, patterns = []) {
  return patterns.reduce((total, pattern) => total + (pattern.test(message) ? 1 : 0), 0);
}

function countTermHits(message, terms = []) {
  return terms.reduce((total, term) => total + (message.includes(term) ? 1 : 0), 0);
}

function analyzeIntent(message) {
  const normalized = normalizeText(message);
  const coachPatternHits = countPatternHits(normalized, COACH_INTENT_PATTERNS);
  const knowledgePatternHits = countPatternHits(normalized, KNOWLEDGE_INTENT_PATTERNS);
  const coachTermHits = countTermHits(normalized, COACH_INTENT_TERMS);
  const knowledgeTermHits = countTermHits(normalized, KNOWLEDGE_INTENT_TERMS);
  const coachScore = coachPatternHits * 3 + coachTermHits;
  const knowledgeScore = knowledgePatternHits * 4 + knowledgeTermHits;

  return {
    normalized,
    coachScore,
    knowledgeScore,
    strongCoach: coachPatternHits > 0,
    strongKnowledge: knowledgePatternHits > 0,
    mixedIntent: coachScore > 0 && knowledgeScore > 0,
    asksForFutureSteps: /\b(next step|next steps|next move|future step|future steps|what should i do next|what should i practice next)\b/.test(normalized),
    asksForExplanation: knowledgePatternHits > 0 || knowledgeTermHits > 0
  };
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

function normalizeMode(value, fallback = 'auto') {
  const mode = stringValue(value).toLowerCase();
  return ALLOWED_MODES.has(mode) ? mode : fallback;
}

function looksLikeCoachIntent(message) {
  return analyzeIntent(message).coachScore > 0;
}

function looksLikeKnowledgeIntent(message) {
  return analyzeIntent(message).knowledgeScore > 0;
}

function wikiLinkForTopic(topic) {
  const clean = stringValue(topic).replace(/[?.!]+$/g, '').trim();
  if (!clean) return '';
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(clean.replace(/\s+/g, '_'))}`;
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

function resolveMode(payload, context = normalizeContext(payload)) {
  const requested = normalizeMode(payload.assistant_mode, 'auto');
  if (requested === 'coach' || requested === 'knowledge') return requested;
  const intent = analyzeIntent(payload.message);
  if (!intent.normalized) return 'coach';
  if (intent.knowledgeScore > intent.coachScore) return 'knowledge';
  if (intent.coachScore > intent.knowledgeScore) {
    if (intent.strongKnowledge && intent.coachScore - intent.knowledgeScore <= 2) return 'knowledge';
    return 'coach';
  }
  if (intent.strongKnowledge && !intent.strongCoach) return 'knowledge';
  if (intent.strongCoach && !intent.strongKnowledge) return 'coach';
  if (intent.knowledgeScore > 0) return 'knowledge';
  if (!context?.session_history?.total_sessions && !context?.coach_notebook?.total) return 'knowledge';
  return 'coach';
}

function extractTopic(payload, context = normalizeContext(payload), resolvedMode = resolveMode(payload, context)) {
  const direct = stringValue(payload.topic);
  if (direct) return direct.slice(0, 120);

  const message = stringValue(payload.message);
  const intent = analyzeIntent(message);
  const normalized = intent.normalized;
  const recentTitle = focusTitle(context.recent_incorrect || {});
  const topFocusTitle = focusTitle(context.coach_notebook.top_focuses[0] || {});
  if (!message) return resolvedMode === 'knowledge' ? (recentTitle || topFocusTitle) : (recentTitle || '');
  if (resolvedMode !== 'knowledge' && intent.coachScore > 0 && intent.knowledgeScore === 0) return recentTitle || topFocusTitle;

  let topic = message
    .replace(/^[^a-zA-Z0-9]*(who|what|when|where|why|how)\s+(is|was|were|are|did|do|does)\s+/i, '')
    .replace(/^(explain|define|describe|outline|summarize|compare|contrast|tell me about|give me (a )?timeline of|what is the significance of|what was the significance of|what caused|what were the causes of|what happened in)\s+/i, '')
    .replace(/^(what should i (study|practice|review|learn|work on|do)( next)?( about| for)?\s*)/i, '')
    .replace(/^(how should i (study|practice|train|review|use|approach|learn)\s+)/i, '')
    .replace(/^(should i use\s+)/i, '')
    .replace(/^(build me|make me|turn this into)\s+(a\s+)?(short\s+)?(study plan|practice plan|plan|drill|session)\s+(for|on)\s+/i, '')
    .replace(/[?.!]+$/g, '')
    .trim();
  if (!topic) topic = message.replace(/[?.!]+$/g, '').trim();
  if (topic.length > 120) topic = `${topic.slice(0, 117).trim()}...`;
  if (!topic) return recentTitle || topFocusTitle;
  const normalizedTopic = normalizeText(topic);
  if (resolvedMode !== 'knowledge' && looksLikeCoachIntent(normalizedTopic) && !looksLikeKnowledgeIntent(normalizedTopic)) {
    return recentTitle || topFocusTitle;
  }
  return topic;
}

function makeAction(id, label, reason, opts = {}) {
  const action = { id, label, reason };
  const focusKey = stringValue(opts.focus_key);
  const query = stringValue(opts.query);
  if (focusKey) action.focus_key = focusKey;
  if (query) action.query = query;
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
    const query = stringValue(action.query);
    const key = `${id}|${focusKey}|${query}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(makeAction(
      id,
      stringValue(action.label || action.title) || id.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase()),
      stringValue(action.reason) || 'Recommended from your current study context.',
      { focus_key: focusKey, query }
    ));
  }
  return out.slice(0, 3);
}

function normalizeHighlights(raw) {
  return Array.isArray(raw)
    ? raw.map(item => stringValue(item)).filter(Boolean).slice(0, 4)
    : [];
}

function normalizeSections(raw) {
  return Array.isArray(raw)
    ? raw.map((item) => {
        if (!item || typeof item !== 'object') return null;
        const heading = stringValue(item.heading || item.title);
        const body = stringValue(item.body || item.text || item.content);
        if (!heading || !body) return null;
        return { heading, body };
      }).filter(Boolean).slice(0, 4)
    : [];
}

function normalizeLinks(raw) {
  return Array.isArray(raw)
    ? raw.map((item) => {
        if (!item || typeof item !== 'object') return null;
        const label = stringValue(item.label || item.title);
        const url = stringValue(item.url);
        if (!label || !/^https:\/\//i.test(url)) return null;
        return {
          label,
          url,
          kind: stringValue(item.kind || item.type) || 'reference'
        };
      }).filter(Boolean).slice(0, 4)
    : [];
}

function normalizeFollowUps(raw) {
  return Array.isArray(raw)
    ? raw.map((item) => {
        if (!item || typeof item !== 'object') return null;
        const label = stringValue(item.label || item.title);
        const prompt = stringValue(item.prompt || item.message);
        if (!label || !prompt) return null;
        return { label, prompt };
      }).filter(Boolean).slice(0, 4)
    : [];
}

function buildCoachFallback(payload, context = normalizeContext(payload)) {
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
  const libraryTopic = recentFocusTitle || topFocusTitle;
  const actions = [];
  const highlights = [];
  let title = 'Practice plan';
  let message = '';
  let sections = [];
  let followUps = [];

  if (wrongDue > 0) highlights.push(`${wrongDue} due in Wrong-bank`);
  if (notebookOpen > 0) highlights.push(`${notebookOpen} notebook lesson${notebookOpen === 1 ? '' : 's'} open`);
  if (context.session_history.recent_accuracy > 0) highlights.push(`Recent accuracy ${context.session_history.recent_accuracy}%`);
  if (context.setup.mode) highlights.push(context.setup.mode);

  if (userMessage.includes('wrong bank') || userMessage.includes('srs')) {
    title = wrongDue > 0 ? 'Clear the due review loop first' : 'Wrong-bank is not the blocker right now';
    if (wrongDue > 0) {
      message = `Wrong-bank is the right tool when you want spaced repetition on misses instead of fresh coverage. You currently have ${wrongDue} due card${wrongDue === 1 ? '' : 's'} out of ${wrongTotal} tracked.`;
      actions.push(makeAction('practice_due_now', `Practice ${wrongDue} due card${wrongDue === 1 ? '' : 's'}`, 'Start the due SRS queue immediately.'));
      if (topFocusKey) actions.push(makeAction('generate_focus_drill', `Generate ${topFocusTitle}`, 'Follow due review with a short fresh drill in the same lane.', { focus_key: topFocusKey }));
      sections = [
        { heading: 'Why this tool fits', body: 'Wrong-bank is for repetition on misses you have already created, not for brand-new coverage.' },
        { heading: 'Best next move', body: `Clear the ${wrongDue} due card${wrongDue === 1 ? '' : 's'} first, then decide whether you still need a fresh focused drill.` },
        { heading: 'Do this after review', body: topFocusKey ? `If ${topFocusTitle} still feels shaky, generate a short corrective set before returning to mixed practice.` : 'If something still feels shaky after review, switch to a short focused drill before returning to mixed practice.' }
      ];
    } else {
      message = 'Wrong-bank works best after you build up misses in regular drills. Right now nothing is due, so a fresh targeted session is the better move.';
      if (topFocusKey) actions.push(makeAction('generate_focus_drill', `Generate ${topFocusTitle}`, 'Create fresh questions around the recurring blind spot.', { focus_key: topFocusKey }));
      actions.push(makeAction('open_review', 'Open Review', 'Check your wrong-bank status and recent session debrief.'));
      sections = [
        { heading: 'Why not Wrong-bank', body: 'There is nothing due right now, so SRS will not give you enough reps to move the needle.' },
        { heading: 'Better option', body: topFocusKey ? `Use ${topFocusTitle} for a short targeted block.` : 'Use a short targeted or mixed block to create new evidence.' },
        { heading: 'When to return', body: 'Come back to Wrong-bank after you create a few new misses and the queue starts to mature.' }
      ];
    }
    followUps = [
      { label: 'When should I use Wrong-bank?', prompt: 'When is Wrong-bank better than a fresh drill?' },
      { label: 'What after review?', prompt: 'After I finish my due wrong-bank cards, what should I do next?' },
      { label: 'Build a corrective block', prompt: 'Turn my current weak spot into a short corrective practice block.' }
    ];
  } else if (userMessage.includes('notebook') || userMessage.includes('ai notebook') || userMessage.includes('lesson') || userMessage.includes('coach')) {
    title = topFocusKey ? `Notebook plan for ${topFocusTitle}` : 'Use AI Notebook for explanation, not repetition';
    message = `AI Notebook is best when you need explanation and pattern review, not repetition of the exact same misses. You have ${notebookOpen} open lesson${notebookOpen === 1 ? '' : 's'}${topFocusKey ? `, and ${topFocusTitle} is the clearest recurring lane.` : '.'}`;
    actions.push(makeAction('open_ai_notebook', 'Open AI Notebook', 'Review saved DeepSeek lessons and mastery state.'));
    if (topFocusKey) {
      actions.push(makeAction('apply_top_focus', `Apply ${topFocusTitle}`, 'Load that focus into the practice builder.', { focus_key: topFocusKey }));
      actions.push(makeAction('generate_focus_drill', `Generate ${topFocusTitle}`, 'Turn that notebook pattern into a fresh drill.', { focus_key: topFocusKey }));
    }
    sections = [
      { heading: 'What Notebook is for', body: 'Use it to understand why you missed something, spot recurring patterns, and collect the right mental model.' },
      { heading: 'Best next move', body: topFocusKey ? `Review the lesson for ${topFocusTitle}, then either apply that focus to setup or generate a short drill from it.` : 'Open the lesson, review the explanation once, and then test yourself in practice.' },
      { heading: 'What not to do', body: 'Do not sit in explanation mode for too long. Use it to clarify, then go back into active recall quickly.' }
    ];
    followUps = [
      { label: 'Turn a lesson into practice', prompt: topFocusKey ? `How should I turn ${topFocusTitle} from AI Notebook into actual practice?` : 'How should I turn an AI Notebook lesson into actual practice?' },
      { label: 'Notebook or Wrong-bank?', prompt: 'When is AI Notebook better than Wrong-bank?' },
      { label: 'Best focus next', prompt: 'Which notebook focus should I train next?' }
    ];
  } else if (recentFocusKey) {
    title = `Recover from ${recentFocusTitle}`;
    message = `You just hit a miss tied to ${recentFocusTitle}. Do not jump straight back to mixed drilling. Review the notebook explanation once, then run a short focused set before returning to broader practice.`;
    actions.push(makeAction('open_ai_notebook', 'Open the lesson', 'Review the saved DeepSeek explanation for this miss.'));
    actions.push(makeAction('generate_focus_drill', `Generate ${recentFocusTitle}`, 'Build a short corrective drill from the same lane.', { focus_key: recentFocusKey }));
    actions.push(makeAction('review_last_misses', 'Review recent misses', 'Revisit the review queue before resuming mixed practice.'));
    sections = [
      { heading: 'Why this matters', body: 'A fresh miss is the highest-signal evidence you have. Fixing it immediately usually pays off faster than adding more random volume.' },
      { heading: 'Best sequence', body: 'Review the explanation, run a short corrective drill, then return to mixed practice once the mistake is no longer repeating.' },
      { heading: 'What to watch for', body: stringValue(recentIncorrect.reason) || 'Pay attention to whether this miss came from chronology, identification, or confusing similar concepts.' }
    ];
    followUps = [
      { label: 'Why did I miss it?', prompt: `Why did I miss ${recentFocusTitle}, and what pattern should I fix?` },
      { label: 'Corrective drill', prompt: `Build me a corrective practice plan for ${recentFocusTitle}.` },
      { label: 'Explain the concept', prompt: `Explain ${recentFocusTitle} in detail and why it matters in IHBB.` }
    ];
  } else if (wrongDue >= 3) {
    title = 'Close the due queue before adding new volume';
    message = `You have ${wrongDue} due wrong-bank cards. That is the cleanest next move because it closes the loop on known misses before you add more volume.`;
    actions.push(makeAction('practice_due_now', `Practice ${wrongDue} due card${wrongDue === 1 ? '' : 's'}`, 'Start the due SRS queue now.'));
    if (topFocusKey) actions.push(makeAction('generate_focus_drill', `Generate ${topFocusTitle}`, 'Follow SRS with a short fresh drill in the same lane.', { focus_key: topFocusKey }));
    sections = [
      { heading: 'Why this comes first', body: 'Due SRS cards represent known mistakes that are ready for reinforcement right now.' },
      { heading: 'Best next move', body: `Clear the ${wrongDue} due card${wrongDue === 1 ? '' : 's'} before starting another long mixed session.` },
      { heading: 'What after that', body: topFocusKey ? `If ${topFocusTitle} still looks shaky, run a short focused drill next.` : 'If you still feel shaky after the due queue, add one short focused block.' }
    ];
    followUps = [
      { label: 'After due cards', prompt: 'After I finish my due wrong-bank cards, what should I practice next?' },
      { label: 'Use my top focus', prompt: topFocusKey ? `How should I train ${topFocusTitle} after wrong-bank?` : 'How should I train my top weak area after wrong-bank?' },
      { label: 'Build a short plan', prompt: 'Build me a 15-minute practice plan from my current state.' }
    ];
  } else if (topFocusKey && (notebookOpen > 0 || recentAccuracy < 70)) {
    title = `Make ${topFocusTitle} the next targeted block`;
    message = `Your notebook keeps pointing back to ${topFocusTitle}. Use that as the next targeted block, then return to mixed practice after accuracy stabilizes.`;
    actions.push(makeAction('apply_top_focus', `Apply ${topFocusTitle}`, 'Load the recurring notebook focus into setup.', { focus_key: topFocusKey }));
    actions.push(makeAction('generate_focus_drill', `Generate ${topFocusTitle}`, 'Create fresh questions in the same lane.', { focus_key: topFocusKey }));
    actions.push(makeAction('open_ai_notebook', 'Open AI Notebook', 'Review the supporting explanations first.'));
    sections = [
      { heading: 'Why this focus', body: 'It is the strongest repeated signal in your notebook and recent accuracy is still soft enough that focused reps should help.' },
      { heading: 'Best next move', body: 'Apply the focus or generate a short drill so your next practice block attacks the right lane directly.' },
      { heading: 'Exit condition', body: 'Go back to broader mixed drilling once accuracy stops dipping on this lane.' }
    ];
    followUps = [
      { label: 'Explain this focus', prompt: `Explain ${topFocusTitle} in detail and give me the most important background.` },
      { label: 'Build the drill', prompt: `Turn ${topFocusTitle} into the best next targeted drill.` },
      { label: 'Why this lane?', prompt: `Why does ${topFocusTitle} keep showing up as a weak lane for me?` }
    ];
  } else if (totalSessions <= 0) {
    title = 'Get one clean baseline session first';
    message = 'Start with one normal mixed drill to create enough evidence for better recommendations. Once you miss a few questions, Wrong-bank and AI Notebook become much more valuable.';
    actions.push(makeAction('start_current_session', 'Start current session', 'Begin the drill you have configured now.'));
    actions.push(makeAction('open_setup', 'Open setup', 'Tune region, era, and mode before starting.'));
    sections = [
      { heading: 'Why start simple', body: 'The assistant gets much better once it can see what you actually miss and how you perform in a real session.' },
      { heading: 'Best next move', body: 'Run one normal mixed drill from your current setup and let the data come in.' },
      { heading: 'What the assistant will use later', body: 'Recent misses feed AI Notebook, repeated misses feed Wrong-bank, and session history makes later recommendations sharper.' }
    ];
    followUps = [
      { label: 'Design my first drill', prompt: 'Help me set up the best first practice drill.' },
      { label: 'How long should it be?', prompt: 'What is the best session length for my first drill?' },
      { label: 'What after my first run?', prompt: 'After my first session, what should I look at next?' }
    ];
  } else {
    const freshness = daysSinceLastSession > 0
      ? `Your last session was about ${daysSinceLastSession} day${daysSinceLastSession === 1 ? '' : 's'} ago. `
      : 'You already have recent practice data. ';
    title = topFocusKey ? `Use ${topFocusTitle} as the next smart block` : 'Keep momentum with one targeted block and one mixed block';
    message = `${freshness}The best structure is one targeted block for a weak lane and one mixed block to test transfer. ${topFocusKey ? `Right now ${topFocusTitle} is the clearest place to focus first.` : 'Right now a short mixed drill is enough to keep momentum.'}`;
    if (topFocusKey) actions.push(makeAction('apply_top_focus', `Apply ${topFocusTitle}`, 'Set up a targeted block first.', { focus_key: topFocusKey }));
    actions.push(makeAction('start_current_session', 'Start current session', 'Run the current practice setup.'));
    actions.push(makeAction('open_review', 'Open Review', 'Check wrong-bank and session debrief before deciding.'));
    sections = [
      { heading: 'Why this structure works', body: 'A targeted block fixes one weak lane while a mixed block checks whether the improvement transfers under wider pressure.' },
      { heading: 'Best next move', body: topFocusKey ? `Use ${topFocusTitle} first, then finish with a mixed round.` : 'Start a short mixed round and watch what the next weak lane turns out to be.' },
      { heading: 'What to inspect after', body: 'Check review data, wrong-bank status, and notebook patterns before choosing the following session.' }
    ];
    followUps = [
      { label: 'Make this a 20-minute plan', prompt: 'Turn my current study state into a 20-minute practice plan.' },
      { label: 'Use the top focus', prompt: topFocusKey ? `How should I use ${topFocusTitle} in my next drill?` : 'How should I use my top focus in the next drill?' },
      { label: 'Explain the weak lane', prompt: topFocusKey ? `Explain ${topFocusTitle} in detail so I stop missing it.` : 'Explain my current weak lane in detail.' }
    ];
  }

  const links = [];
  if (libraryTopic) {
    const wiki = wikiLinkForTopic(libraryTopic);
    if (wiki) links.push({ label: `Wikipedia: ${libraryTopic}`, url: wiki, kind: 'wikipedia' });
  }
  if (libraryTopic && actions.length < 3) {
    actions.push(makeAction('open_library', `Search ${libraryTopic}`, 'Open the question library and search this topic.', { query: libraryTopic }));
  }

  return {
    source: 'fallback',
    mode: 'coach',
    title,
    topic: libraryTopic,
    message,
    highlights: highlights.slice(0, 4),
    sections,
    links,
    follow_ups: followUps,
    quick_actions: dedupeActions(actions)
  };
}

function buildKnowledgeFallback(payload, context = normalizeContext(payload)) {
  const topic = extractTopic(payload, context, 'knowledge');
  const wiki = wikiLinkForTopic(topic);
  const actions = [];
  if (topic) actions.push(makeAction('open_library', `Search ${topic}`, 'Open the question library and search this topic.', { query: topic }));
  if (context.coach_notebook.top_focuses[0]?.key && actions.length < 3) {
    const topFocus = context.coach_notebook.top_focuses[0];
    actions.push(makeAction('apply_top_focus', `Apply ${focusTitle(topFocus)}`, 'Turn your top notebook focus into a targeted practice block.', { focus_key: stringValue(topFocus.key) }));
  }

  return {
    source: 'fallback',
    mode: 'knowledge',
    title: topic ? `Study brief: ${topic}` : 'Study brief',
    topic,
    message: topic
      ? `This looks like a knowledge question about ${topic}. When DeepSeek is available, I can give a full detailed explanation here. Right now I can still structure the topic, point you to the right reference, and suggest the best follow-up questions.`
      : 'This looks like a knowledge question. When DeepSeek is available, I can answer it in full detail here. Right now I can still frame the topic and point you to the best follow-up prompts.',
    highlights: [
      'Knowledge mode',
      topic ? 'Wikipedia reference ready' : 'Reference lookup ready',
      context.coach_notebook.top_focuses[0]?.title ? `Top focus: ${focusTitle(context.coach_notebook.top_focuses[0])}` : 'Use follow-up prompts for depth'
    ].filter(Boolean).slice(0, 4),
    sections: [
      {
        heading: 'What to lock in first',
        body: topic
          ? `Start with the definition, timeframe, main actors, and why ${topic} matters in the broader historical story.`
          : 'Start with the definition, timeframe, main actors, and why the topic matters in the broader historical story.'
      },
      {
        heading: 'What IHBB usually rewards',
        body: 'Be ready to explain causes, turning points, significance, comparisons, and the larger regional or chronological pattern around the concept.'
      },
      {
        heading: 'Best follow-up prompts',
        body: 'Ask for a timeline, significance, comparison, common confusions, or likely clue patterns if you want a stronger study brief.'
      }
    ],
    links: wiki ? [{ label: `Wikipedia: ${topic}`, url: wiki, kind: 'wikipedia' }] : [],
    follow_ups: topic ? [
      { label: 'Give me a timeline', prompt: `Give me a clear timeline of ${topic}.` },
      { label: 'Why it matters', prompt: `Why is ${topic} historically significant?` },
      { label: 'Common confusions', prompt: `What are the most common confusions or mix-ups around ${topic}?` }
    ] : [
      { label: 'Give me a timeline', prompt: 'Give me a clear timeline of this topic.' },
      { label: 'Why it matters', prompt: 'Why is this topic historically significant?' },
      { label: 'Common confusions', prompt: 'What are the most common confusions around this topic?' }
    ],
    quick_actions: dedupeActions(actions)
  };
}

function buildFallback(payload) {
  const context = normalizeContext(payload);
  const mode = resolveMode(payload, context);
  return mode === 'knowledge'
    ? buildKnowledgeFallback(payload, context)
    : buildCoachFallback(payload, context);
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
          {
            focus_key: validFocusKeys.has(focusKey) ? focusKey : '',
            query: stringValue(action.query)
          }
        );
      }).filter(Boolean)
    : [];
  const mode = normalizeMode(obj.mode, fallback.mode === 'knowledge' ? 'knowledge' : 'coach');
  const topic = stringValue(obj.topic) || fallback.topic;
  const links = normalizeLinks(obj.links);
  const fallbackLinks = Array.isArray(fallback.links) ? fallback.links : [];
  const mergedLinks = links.length
    ? links
    : (topic ? [{ label: `Wikipedia: ${topic}`, url: wikiLinkForTopic(topic), kind: 'wikipedia' }].filter(item => item.url) : fallbackLinks);

  return {
    source: 'deepseek',
    mode,
    title: stringValue(obj.title) || fallback.title,
    topic,
    message: stringValue(obj.message) || fallback.message,
    highlights: normalizeHighlights(obj.highlights).length ? normalizeHighlights(obj.highlights) : fallback.highlights,
    sections: normalizeSections(obj.sections).length ? normalizeSections(obj.sections) : fallback.sections,
    links: mergedLinks.slice(0, 4),
    follow_ups: normalizeFollowUps(obj.follow_ups).length ? normalizeFollowUps(obj.follow_ups) : fallback.follow_ups,
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
    const resolvedMode = resolveMode(payload, context);
    const intent = analyzeIntent(payload.message);
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
      'You are the DeepSeek personal study assistant inside an IHBB training app.',
      'You have two jobs:',
      '1) Coach mode: recommend the best next study move using the provided app context and built-in app actions.',
      '2) Knowledge mode: answer history and IHBB concept questions in detail, with structured sections and at least one Wikipedia link when a topic is clear.',
      'Respect the requested assistant_mode when it is "coach" or "knowledge". If it is "auto", choose the best mode.',
      'When the request is auto or mixed, use the user payload and intent_hint to detect the dominant goal.',
      'Knowledge intent means explanation, background, timeline, comparison, causes, significance, or helping the user understand a topic.',
      'Coach intent means next-step advice, future steps, what to practice, how to study, or which app tool to use next.',
      'If both intents appear, keep the answer weighted toward the dominant one.',
      'Knowledge-first replies should spend most of the space on knowledge and keep any study-next-steps to one short final section only if the user asked for it.',
      'Coaching-first replies should spend most of the space on practical next actions and only include brief background unless the user explicitly asked for depth.',
      'In knowledge mode, let the sections carry the explanation. Do not let quick actions crowd out the historical content.',
      'In coach mode, prefer sections like Best Next Move, Why This Tool Fits, and What To Do After.',
      'Available app actions and surfaces:',
      '- Wrong-bank (SRS) practices previously missed questions that are due.',
      '- AI Notebook stores DeepSeek lessons from incorrect answers.',
      '- Apply Top Focus loads a recurring notebook focus into the practice builder.',
      '- Generate Focus Drill creates fresh generated questions for a focus.',
      '- Review Last Misses opens review and starts practice on misses.',
      '- Start Current Session launches the current practice setup.',
      '- Open Setup, Open Review, Open AI Notebook, and Open Library navigate to those surfaces.',
      'Do not invent any other controls, tabs, or data.',
      'If you are uncertain about a historical fact, say so instead of bluffing.',
      'Coach mode should stay practical and tied to the user context.',
      'Knowledge mode should be more detailed and structured.',
      `Recommend at most 3 quick actions and only use these action ids: ${Array.from(ALLOWED_ACTIONS).sort().join(', ')}.`,
      `If you use focus_key, it must exactly match one of these keys: ${validFocusKeys.length ? validFocusKeys.join(', ') : '(none available)'}.`,
      'Return strict JSON only with this shape:',
      '{"mode":"coach|knowledge","title":"string","topic":"string","message":"string","highlights":["string"],"sections":[{"heading":"string","body":"string"}],"links":[{"label":"string","url":"https://...","kind":"reference"}],"follow_ups":[{"label":"string","prompt":"string"}],"quick_actions":[{"id":"action_id","label":"string","reason":"string","focus_key":"optional","query":"optional"}]}'
    ].join('\n');

    const user = {
      assistant_mode: resolvedMode,
      intent_hint: {
        detected_mode: resolvedMode,
        mixed_intent: intent.mixedIntent,
        asks_for_future_steps: intent.asksForFutureSteps,
        asks_for_explanation: intent.asksForExplanation,
        coach_score: intent.coachScore,
        knowledge_score: intent.knowledgeScore
      },
      message: stringValue(payload.message) || 'What should I practice next?',
      conversation,
      study_context: context,
      fallback_plan: fallback
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
        temperature: resolvedMode === 'knowledge' ? 0.18 : 0.2,
        max_tokens: resolvedMode === 'knowledge' ? 1400 : 900
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
