/********************* Utilities & UI *********************/
const $ = (id) => document.getElementById(id);
const SHOW = (id) => {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = $(id); if (el) el.classList.add('active');
  if (typeof updateSetupMobileDock === 'function') updateSetupMobileDock();
};
const navSet = (which) => {
  document.querySelectorAll('.nav a').forEach(a => a.classList.remove('active'));
  const el = $(which); if (el) el.classList.add('active');
};
const toast = (msg) => {
  const t = $('toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
};
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const prettyDur = (s) => { s = Math.round(s); if (s < 60) return s + 's'; const m = Math.floor(s / 60), r = s % 60; return `${m}m ${r}s`; };
const fmtDate = (ts) => new Date(ts).toLocaleString();
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const vibrate = (pat) => { try { if (Settings.haptics && navigator.vibrate) navigator.vibrate(pat); } catch { /* noop */ } };

/********************* Storage keys *********************/
const KEY_SETTINGS = 'ihbb_v2_settings';
const KEY_SESS = 'ihbb_v2_sessions';
const KEY_WRONG = 'ihbb_v2_wrong_srs';   // { [id]: {box,dueAt,lastSeen,lapses,answer,aliases,q} }
const KEY_LIBRARY = 'ihbb_v2_library';     // {sets:[{id,name,items:[]}], activeSetId}
const KEY_PRESETS = 'ihbb_v2_presets';
const KEY_WRONG_SYNC_SEEN = 'ihbb_v2_wrong_sync_seen'; // per-user marker: <prefix>_<userId>
const KEY_SESS_SYNC_SEEN = 'ihbb_v2_session_sync_seen'; // per-user marker: <prefix>_<userId>
const KEY_COACH_LOCAL = 'ihbb_v2_coach_attempts';
const KEY_COACH_PENDING = 'ihbb_v2_coach_pending';
const KEY_COACH_DRILL = 'ihbb_student_coach_drill';
const KEY_COACH_CHAT_ACTION = 'ihbb_v2_coach_chat_action';
const WRONG_SYNC_TABLE = 'user_wrong_questions';
const SESSION_SYNC_TABLE = 'user_drill_sessions';
const COACH_SYNC_TABLE = 'user_coach_attempts';
const GENERATED_QUESTIONS_BANK_URL = './generated_questions_bank.json';

const WrongSync = {
  userId: null,
  enabled: true,
  ready: false,
  warned: false,
  queue: Promise.resolve()
};
const SessionSync = {
  userId: null,
  enabled: true,
  warned: false,
  queue: Promise.resolve()
};
const CoachSync = {
  userId: null,
  enabled: true,
  warned: false,
  queue: Promise.resolve()
};

/********************* Global State *********************/
const Settings = {
  voice: null, rate: 1.0, strict: false,
  autoAdvance: false, autoAdvanceDelay: 1,
  cueTicks: true, cueBeep: true, haptics: true
};
const Library = { sets: [], activeSetId: null };
let Presets = {};
let CurrentProfileRole = '';
let PendingCoachGeneration = false;

const App = {
  pool: [], order: [], i: 0, correct: 0, startTs: 0,
  sessionBuzzTimes: [], resultsCorrect: [],
  curItem: null, phase: 'idle', // idle|reading|countdown|answering|done
  size: 10, mode: 'random', filters: { cat: '', cats: [], era: '', eras: [], src: '' },
  lastLines: [], readingAbort: false, buzzStart: 0, buzzAt: null,
  rollingSentences: [], _cdIv: null,
  autoGrade: true,
  sessionId: null,
  submitBusy: false,
  sessionOverrideItems: null
};

const EXPLICIT_NO_ATTEMPT_ANSWERS = new Set([
  "I don't know",
  'IDK',
  'idk',
  'I have no idea'
]);

function isExplicitNoAttemptAnswer(text, { allowBlank = false } = {}) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return allowBlank;
  if (trimmed === 'just not attempting to answer') return true;
  return EXPLICIT_NO_ATTEMPT_ANSWERS.has(trimmed);
}

function normalizeQuestionId(id) {
  const out = String(id || '').trim();
  return out || null;
}
function normalizeQuestionIds(ids) {
  const seen = new Set();
  const out = [];
  for (const raw of (ids || [])) {
    const id = normalizeQuestionId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
function wrongSyncSeenKey(userId) { return `${KEY_WRONG_SYNC_SEEN}_${userId}`; }
function getWrongSyncSeen(userId) {
  try { return localStorage.getItem(wrongSyncSeenKey(userId)) === '1'; } catch { return false; }
}
function setWrongSyncSeen(userId) {
  try { localStorage.setItem(wrongSyncSeenKey(userId), '1'); } catch { /* noop */ }
}
function sessSyncSeenKey(userId) { return `${KEY_SESS_SYNC_SEEN}_${userId}`; }
function getSessSyncSeen(userId) {
  try { return localStorage.getItem(sessSyncSeenKey(userId)) === '1'; } catch { return false; }
}
function setSessSyncSeen(userId) {
  try { localStorage.setItem(sessSyncSeenKey(userId), '1'); } catch { /* noop */ }
}
function isWrongSyncSchemaIssue(err) {
  const code = String(err?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  return (
    code === '42P01' || code === 'PGRST205' || code === 'PGRST204' ||
    msg.includes('does not exist') ||
    msg.includes('permission denied') ||
    msg.includes('policy')
  );
}
function handleWrongSyncError(err) {
  console.warn('[WrongSync] disabled:', err);
  WrongSync.enabled = false;
  if (WrongSync.warned) return;
  WrongSync.warned = true;
  if (isWrongSyncSchemaIssue(err)) toast('Cloud wrong-bank sync unavailable (setup missing). Using local only.');
}
function queueWrongSync(task) {
  if (!WrongSync.enabled || !WrongSync.userId || !window.supabaseClient) return;
  WrongSync.queue = WrongSync.queue
    .then(async () => {
      if (!WrongSync.enabled || !WrongSync.userId || !window.supabaseClient) return;
      await task(window.supabaseClient, WrongSync.userId);
    })
    .catch(handleWrongSyncError);
}
function handleSessionSyncError(err) {
  console.warn('[SessionSync] disabled:', err);
  SessionSync.enabled = false;
  if (SessionSync.warned) return;
  SessionSync.warned = true;
  if (isWrongSyncSchemaIssue(err)) toast('Cloud session sync unavailable (setup missing). Analytics may be incomplete.');
}
async function ensureSessionSyncUserId() {
  if (SessionSync.userId) return SessionSync.userId;
  if (!window.supabaseClient) return null;
  const { data, error } = await window.supabaseClient.auth.getSession();
  if (error) throw error;
  const userId = data?.session?.user?.id || null;
  if (userId) SessionSync.userId = userId;
  return userId;
}
function queueSessionSync(task) {
  if (!SessionSync.enabled || !window.supabaseClient) return;
  SessionSync.queue = SessionSync.queue
    .then(async () => {
      if (!SessionSync.enabled || !window.supabaseClient) return;
      const userId = await ensureSessionSyncUserId();
      if (!userId) return;
      await task(window.supabaseClient, userId);
    })
    .catch(handleSessionSyncError);
}

function handleCoachSyncError(err) {
  console.warn('[CoachSync] sync error:', err);
  if (!isWrongSyncSchemaIssue(err)) return;
  CoachSync.enabled = false;
  if (CoachSync.warned) return;
  CoachSync.warned = true;
  toast('Cloud AI notebook sync unavailable. Using local notebook on this device.');
}
async function ensureCoachSyncUserId() {
  if (CoachSync.userId) return CoachSync.userId;
  if (!window.supabaseClient) return null;
  const { data, error } = await window.supabaseClient.auth.getSession();
  if (error) throw error;
  const userId = data?.session?.user?.id || null;
  if (userId) CoachSync.userId = userId;
  return userId;
}
function queueCoachSync(task) {
  if (!CoachSync.enabled || !window.supabaseClient) return;
  CoachSync.queue = CoachSync.queue
    .then(async () => {
      if (!CoachSync.enabled || !window.supabaseClient) return;
      const userId = await ensureCoachSyncUserId();
      if (!userId) return;
      await task(window.supabaseClient, userId);
    })
    .catch(handleCoachSyncError);
}

function safeReadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}
function setJsonSafe(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* noop */ }
}
function inferSourceFallbackForSet(set) {
  const name = String(set?.name || '').trim();
  if (Array.isArray(set?.items) && set.items.length && set.items.every(item => String(item?.meta?.source || '').trim() === 'generated')) {
    return 'generated';
  }
  if (set?.volatile || /IHBB Questions/i.test(name)) return 'original';
  return '';
}
function ensureSetItemSources(set, fallback = '') {
  if (!set || !Array.isArray(set.items)) return false;
  let changed = false;
  for (const item of set.items) {
    if (!item.meta || typeof item.meta !== 'object') {
      item.meta = { category: '', era: '', source: '' };
      changed = true;
    }
    const next = String(item.meta?.source || '').trim() || fallback;
    if (next && item.meta.source !== next) {
      item.meta.source = next;
      changed = true;
    }
  }
  return changed;
}
function migrateLibrarySources() {
  if (!Array.isArray(Library.sets) || !Library.sets.length) return;
  let changed = false;
  for (const set of Library.sets) {
    changed = ensureSetItemSources(set, inferSourceFallbackForSet(set)) || changed;
  }
  if (changed) saveLibrarySafe('migrateLibrarySources');
}
async function ensureCurrentProfileRole() {
  if (CurrentProfileRole) return CurrentProfileRole;
  if (!window.supabaseClient) return '';
  try {
    const userId = await ensureSessionSyncUserId();
    if (!userId) return '';
    const { data, error } = await window.supabaseClient
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();
    if (error) throw error;
    CurrentProfileRole = String(data?.role || '').trim();
  } catch {
    CurrentProfileRole = '';
  }
  return CurrentProfileRole;
}
function isNotebookAttemptRecord(record) {
  return !!record && !record.correct;
}
function getCoachLocal() {
  const arr = safeReadJson(KEY_COACH_LOCAL, []);
  const safe = Array.isArray(arr) ? arr.filter(isNotebookAttemptRecord) : [];
  if (Array.isArray(arr) && safe.length !== arr.length) setJsonSafe(KEY_COACH_LOCAL, safe.slice(0, 300));
  return safe;
}
function setCoachLocal(arr) {
  const safe = Array.isArray(arr) ? arr.filter(isNotebookAttemptRecord).slice(0, 300) : [];
  setJsonSafe(KEY_COACH_LOCAL, safe);
}
function upsertCoachLocal(record) {
  if (!isNotebookAttemptRecord(record)) return;
  const arr = getCoachLocal();
  const id = String(record?.client_attempt_id || '').trim();
  if (!id) return;
  const idx = arr.findIndex(x => String(x?.client_attempt_id || '') === id);
  if (idx >= 0) arr[idx] = record;
  else arr.unshift(record);
  setCoachLocal(arr);
}
function getCoachPending() {
  const arr = safeReadJson(KEY_COACH_PENDING, []);
  const safe = Array.isArray(arr) ? arr.filter(isNotebookAttemptRecord) : [];
  if (Array.isArray(arr) && safe.length !== arr.length) setJsonSafe(KEY_COACH_PENDING, safe.slice(0, 300));
  return safe;
}
function setCoachPending(arr) {
  const safe = Array.isArray(arr) ? arr.filter(isNotebookAttemptRecord).slice(0, 300) : [];
  setJsonSafe(KEY_COACH_PENDING, safe);
}
function enqueueCoachPending(record) {
  if (!isNotebookAttemptRecord(record)) return;
  const arr = getCoachPending();
  const id = String(record?.client_attempt_id || '').trim();
  if (!id) return;
  const idx = arr.findIndex(x => String(x?.client_attempt_id || '') === id);
  if (idx >= 0) arr[idx] = record;
  else arr.unshift(record);
  setCoachPending(arr);
}
function removeCoachPending(attemptId) {
  const id = String(attemptId || '').trim();
  if (!id) return;
  const arr = getCoachPending().filter(x => String(x?.client_attempt_id || '') !== id);
  setCoachPending(arr);
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function topicFromQuestion(q) {
  const t = String(q || '').toLowerCase();
  if (/(battle|war|campaign|siege|army|navy|admiral|military)/.test(t)) return 'Military';
  if (/(treaty|law|constitution|election|parliament|policy|president|minister)/.test(t)) return 'Politics';
  if (/(religion|church|pope|caliph|buddh|islam|hindu|christian)/.test(t)) return 'Religion';
  if (/(econom|trade|bank|tax|industry|market|finance)/.test(t)) return 'Economy';
  if (/(art|painting|novel|poem|literature|music|composer)/.test(t)) return 'Culture';
  if (/(science|physics|chemistry|biology|medicine|theory|astronomy)/.test(t)) return 'Science';
  return 'General';
}
function iconForStudyFocus(region, topic) {
  const regionIcons = {
    'africa': '🌍',
    'europe': '🏰',
    'north america': '🦅',
    'latin america': '🗿',
    'middle east': '🕌',
    'east asia': '🏯',
    'south asia': '🪷',
    'southeast asia': '🌴',
    'central asia': '🐎',
    'oceania': '🌊',
    'world': '🌐'
  };
  const topicIcons = {
    'military': '⚔️',
    'politics': '🏛️',
    'religion': '🕯️',
    'economy': '💰',
    'culture': '🎭',
    'science': '🧪',
    'general': '📘'
  };
  const r = String(region || '').toLowerCase();
  const t = String(topic || '').toLowerCase();
  return regionIcons[r] || topicIcons[t] || '📘';
}
function canonicalAnswerText(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const cleaned = value
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[ ,;:.]+$/g, '')
    .trim();
  return cleaned || value;
}
function coachWikiLinkForAnswer(raw) {
  const canonical = canonicalAnswerText(raw);
  if (!canonical) return '';
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(canonical.replace(/\s+/g, '_'))}`;
}
function fallbackCoachFacts(region, era, topic) {
  const r = String(region || 'this region');
  const e = String(era || 'this period');
  const t = String(topic || 'General').toLowerCase();
  return [
    `Place this answer in ${e}; similar clues in different eras often point somewhere else.`,
    `Keep it tied to ${r}; cross-region lookalikes are a common trap.`,
    `This is most testable through ${t} consequences, titles, and signature events rather than isolated name recall.`
  ];
}
function normalizeCoachList(items, fallback = [], max = 4) {
  const list = Array.isArray(items) ? items : [];
  const normalized = list.map(x => String(x || '').trim()).filter(Boolean).slice(0, max);
  if (normalized.length) return normalized;
  return (Array.isArray(fallback) ? fallback : []).map(x => String(x || '').trim()).filter(Boolean).slice(0, max);
}
function coachListHtml(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return '';
  return `<ul>${list.map(item => `<li>${escHtml(item)}</li>`).join('')}</ul>`;
}
function coachWikiHtml(coach) {
  const canonical = String(coach?.canonical_answer || '').trim();
  const wikiLink = String(coach?.wiki_link || '').trim();
  if (!wikiLink) return '';
  const linkText = canonical || 'Wikipedia';
  return `<div class="coach-section"><b>Read More:</b> <a class="coach-link" href="${escHtml(wikiLink)}" target="_blank" rel="noopener noreferrer">${escHtml(linkText)}</a></div>`;
}
function fallbackCoachForItem(item, correct, reason, userAnswer = '') {
  const region = String(item?.meta?.category || 'World') || 'World';
  const era = String(item?.meta?.era || '');
  const topic = topicFromQuestion(item?.question || '');
  const explanationBullets = [
    correct
      ? 'Your answer already matched the expected target, so the main job is remembering the exact clue pattern that made it uniquely right.'
      : (userAnswer
        ? `Your answer "${userAnswer}" was in the same topic neighborhood, but the clue set narrowed to a different answer.`
        : 'Your response was close to the topic area, but the clue set narrowed to a different answer.'),
    `Use ${era || 'the era'} and ${region || 'the region'} as elimination anchors before you commit.`,
    `Prioritize ${topic.toLowerCase()} clues such as names, titles, offices, or signature events that point to only one target.`,
    reason || 'Focus on the clue that uniquely separates the expected answer from nearby lookalikes.'
  ].filter(Boolean);
  const canonicalAnswer = canonicalAnswerText(item?.answer || '');
  return {
    summary: correct
      ? 'You got it right. Keep tying clues to specific context.'
      : 'This looks like a near miss from overlapping concepts.',
    error_diagnosis: correct
      ? 'Your response matched the required entity.'
      : 'Your response likely overlapped with a related but different answer.',
    overlap_explainer: reason || 'Use uniquely identifying clues to separate close answers.',
    explanation: explanationBullets.join(' '),
    explanation_bullets: explanationBullets,
    related_facts: fallbackCoachFacts(region, era, topic),
    key_clues: [
      'Look for clues that uniquely identify one entity.',
      'Use era and region to narrow options.',
      'Prioritize named events and proper nouns.',
      'Prefer titles and offices over broad topic similarity.'
    ],
    study_tip: `Run a short drill on ${region}${era ? ` in ${era}` : ''} and stop on the first clue that rules out the closest lookalike.`,
    canonical_answer: canonicalAnswer,
    wiki_link: coachWikiLinkForAnswer(canonicalAnswer),
    study_focus: { region, era, topic, icon: iconForStudyFocus(region, topic) },
    confidence: 'low'
  };
}
function normalizeCoach(coach, item, correct, reason) {
  const c = (coach && typeof coach === 'object') ? coach : {};
  const sf = (c.study_focus && typeof c.study_focus === 'object') ? c.study_focus : {};
  const region = String(sf.region || item?.meta?.category || 'World').trim() || 'World';
  const era = String(sf.era || item?.meta?.era || '').trim();
  const topic = String(sf.topic || topicFromQuestion(item?.question || '')).trim() || 'General';
  const icon = String(sf.icon || iconForStudyFocus(region, topic)).trim() || iconForStudyFocus(region, topic);
  const clues = Array.isArray(c.key_clues) ? c.key_clues.map(x => String(x || '').trim()).filter(Boolean).slice(0, 4) : [];
  const explanationBullets = normalizeCoachList(c.explanation_bullets || (c.explanation ? [c.explanation] : []), [
    correct
      ? 'You identified the right entity and context.'
      : 'Your answer overlapped with a related but different concept.',
    `Use ${era || 'the era'} and ${region || 'the region'} to eliminate close alternatives.`,
    `Prioritize ${topic.toLowerCase()} clues that point to one specific target.`
  ], 5);
  const relatedFacts = normalizeCoachList(c.related_facts, fallbackCoachFacts(region, era, topic), 5);
  const canonicalAnswer = canonicalAnswerText(c.canonical_answer || item?.answer || '');
  const wikiLink = String(c.wiki_link || coachWikiLinkForAnswer(canonicalAnswer)).trim();
  const confidence = ['high', 'medium', 'low'].includes(String(c.confidence || '').toLowerCase()) ? String(c.confidence).toLowerCase() : 'low';
  return {
    summary: String(c.summary || (correct ? 'Correct answer with good clue alignment.' : 'Answer not accepted; review clue disambiguation.')).trim(),
    explanation: String(c.explanation || explanationBullets.join(' ')).trim(),
    explanation_bullets: explanationBullets,
    related_facts: relatedFacts,
    error_diagnosis: String(c.error_diagnosis || (correct ? 'You identified the right entity.' : 'This answer likely mixed with a related concept.')).trim(),
    overlap_explainer: String(c.overlap_explainer || reason || 'Focus on clues that uniquely identify the expected answer.').trim(),
    key_clues: clues.length ? clues : [
      'Track the clue that uniquely identifies the answer.',
      'Use era and region to eliminate close alternatives.',
      'Prioritize named events and figures.',
      'Prefer titles and offices over broad topic similarity.'
    ],
    study_tip: String(c.study_tip || c.memory_hook || c.next_check_question || `Run a short drill on ${region}${era ? ` in ${era}` : ''} and stop on the first clue that rules out the closest lookalike.`).trim(),
    canonical_answer: canonicalAnswer,
    wiki_link: wikiLink,
    study_focus: { region, era, topic, icon },
    confidence
  };
}
function clearCoachCard() {
  const el = $('coach-card');
  if (!el) return;
  el.innerHTML = '';
  try { delete el.dataset.attempt; } catch { /* noop */ }
  el.style.display = 'none';
}
function renderCoachCard(coach) {
  const el = $('coach-card');
  if (!el) return;
  if (!coach) { clearCoachCard(); return; }
  const focus = coach.study_focus || {};
  const explanationBullets = Array.isArray(coach.explanation_bullets) ? coach.explanation_bullets : [];
  const relatedFacts = Array.isArray(coach.related_facts) ? coach.related_facts : [];
  const clues = Array.isArray(coach.key_clues) ? coach.key_clues : [];
  el.innerHTML = `
    <div class="coach-head">
      <div class="coach-icon">${escHtml(focus.icon || '📘')}</div>
      <div>
        <div class="coach-title">DeepSeek Coach</div>
        <div class="coach-focus">${escHtml(focus.region || 'World')} ${focus.era ? '• ' + escHtml(focus.era) : ''} ${focus.topic ? '• ' + escHtml(focus.topic) : ''}</div>
      </div>
      <div class="grow"></div>
      <div class="coach-confidence">${escHtml(String(coach.confidence || 'low').toUpperCase())}</div>
    </div>
    <div class="coach-section"><b>Summary:</b> ${escHtml(coach.summary || '')}</div>
    <div class="coach-section"><b>Error Diagnosis:</b> ${escHtml(coach.error_diagnosis || '')}</div>
    <div class="coach-section"><b>Overlap Explainer:</b> ${escHtml(coach.overlap_explainer || '')}</div>
    <div class="coach-section"><b>Why This Answer Fits:</b>${coachListHtml(explanationBullets)}</div>
    <div class="coach-section"><b>Key Clues:</b>${coachListHtml(clues)}</div>
    <div class="coach-section"><b>Related Facts:</b>${coachListHtml(relatedFacts)}</div>
    <div class="coach-section"><b>Study Tip:</b> ${escHtml(coach.study_tip || '')}</div>
    ${coachWikiHtml(coach)}
  `;
  el.style.display = 'block';
}

const CoachNotebook = { records: [], loaded: false };
let CoachFocusSuggestions = [];
let ReviewCoachFocusSuggestions = [];
const COACH_CHAT_STARTERS = [
  { label: 'What next?', prompt: 'What should I practice next in this practice hub?' },
  { label: 'Wrong-bank or notebook?', prompt: 'Should I use Wrong-bank or AI Notebook right now?' },
  { label: 'Build a focused drill', prompt: 'Recommend a focused drill and launch the best next practice.' }
];
const COACH_CHAT_ALLOWED_ACTIONS = new Set([
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
const COACH_CHAT_SUPPRESS_KEY = 'ihbb_v2_coach_chat_suppressed';
const COACH_CHAT_UI_KEY = 'ihbb_v2_coach_chat_ui';
const COACH_CHAT_SIZE_PRESETS = {
  standard: 820,
  wide: 980,
  focus: 1140
};
const CoachChat = {
  open: false,
  busy: false,
  source: 'ready',
  messages: [],
  autoReasons: new Set(),
  recentIncorrect: null,
  currentStarters: [],
  suggestedReason: 'manual',
  workspaceCards: [],
  ui: {
    mode: 'auto',
    size: 'standard',
    width: COACH_CHAT_SIZE_PRESETS.standard,
    fullscreen: false
  },
  resizing: null
};

function clampCoachChatWidth(value) {
  const min = 720;
  const max = Math.max(min, window.innerWidth - 32);
  const parsed = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : COACH_CHAT_SIZE_PRESETS.standard));
}

function loadCoachChatUiPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(COACH_CHAT_UI_KEY) || '{}');
    const mode = ['auto', 'coach', 'knowledge'].includes(String(raw.mode || '').trim()) ? String(raw.mode).trim() : 'auto';
    const sizeRaw = String(raw.size || '').trim();
    const size = sizeRaw === 'custom' || Object.prototype.hasOwnProperty.call(COACH_CHAT_SIZE_PRESETS, sizeRaw) ? sizeRaw : 'standard';
    const width = clampCoachChatWidth(raw.width || COACH_CHAT_SIZE_PRESETS[size] || COACH_CHAT_SIZE_PRESETS.standard);
    CoachChat.ui = {
      mode,
      size,
      width,
      fullscreen: !!raw.fullscreen
    };
  } catch {
    CoachChat.ui = {
      mode: 'auto',
      size: 'standard',
      width: COACH_CHAT_SIZE_PRESETS.standard,
      fullscreen: false
    };
  }
}

function saveCoachChatUiPrefs() {
  try {
    localStorage.setItem(COACH_CHAT_UI_KEY, JSON.stringify({
      mode: CoachChat.ui.mode,
      size: CoachChat.ui.size,
      width: CoachChat.ui.width,
      fullscreen: CoachChat.ui.fullscreen
    }));
  } catch { /* noop */ }
}

loadCoachChatUiPrefs();

function trimCoachChatMessages() {
  if (CoachChat.messages.length > 18) {
    CoachChat.messages = CoachChat.messages.slice(-18);
  }
}

function pushCoachChatMessage(message) {
  if (!message || typeof message !== 'object') return;
  CoachChat.messages.push(message);
  trimCoachChatMessages();
}

function coachChatFocusTitle(focus) {
  return buildFocusTitle(focus);
}

function getCoachChatRecentIncorrect() {
  const recent = CoachChat.recentIncorrect;
  if (!recent || (Date.now() - Number(recent.ts || 0)) > (30 * 60 * 1000)) return null;
  return {
    key: String(recent.key || '').trim(),
    title: String(recent.title || '').trim() || coachChatFocusTitle(recent),
    region: String(recent.region || '').trim(),
    era: String(recent.era || '').trim(),
    topic: String(recent.topic || '').trim(),
    reason: String(recent.reason || '').trim(),
    attemptId: String(recent.attemptId || '').trim()
  };
}

function readCoachChatSessions() {
  const raw = safeReadJson(KEY_SESS, []);
  return Array.isArray(raw) ? raw : [];
}

function buildCoachChatSetupFilterText() {
  const cats = Array.isArray(App.filters.cats) ? App.filters.cats.filter(Boolean) : [];
  const eras = Array.isArray(App.filters.eras) ? App.filters.eras.filter(Boolean) : [];
  const filterCats = cats.length
    ? `${cats.length} region${cats.length === 1 ? '' : 's'}`
    : (App.filters.cat ? App.filters.cat : 'All regions');
  const filterEras = eras.length
    ? `${eras.length} era${eras.length === 1 ? '' : 's'}`
    : (App.filters.era ? getEraName(App.filters.era) : 'All eras');
  const filterSrc = App.filters.src ? App.filters.src : 'All sources';
  return `${filterCats} • ${filterEras} • ${filterSrc}`;
}

function buildCoachChatStudyContext() {
  const sessions = readCoachChatSessions();
  const lastSession = sessions[0] || null;
  const recentSlice = sessions.slice(0, 5);
  const recentAccuracy = recentSlice.length
    ? Math.round(recentSlice.reduce((sum, session) => sum + Number(session?.acc || 0), 0) / recentSlice.length)
    : 0;
  const lastTs = Number(lastSession?.ts || 0);
  const daysSinceLastSession = lastTs ? Math.floor((Date.now() - lastTs) / 86400000) : 0;
  const topFocuses = buildCoachFocusSuggestions(CoachNotebook.records).slice(0, 4).map(focus => ({
    key: String(focus.key || '').trim(),
    title: String(focus.title || '').trim(),
    region: String(focus.region || '').trim(),
    era: String(focus.era || '').trim(),
    topic: String(focus.topic || '').trim(),
    priority: String(focus.priority || 'medium').trim(),
    reason: String(focus.reason || '').trim(),
    action: String(focus.action || '').trim()
  }));
  const recentIncorrect = getCoachChatRecentIncorrect();
  const set = getActiveSet();
  const activeView = document.querySelector('.view.active');
  return {
    current_view: String(activeView?.id || 'view-setup').trim(),
    wrong_bank: {
      due_now: srsDueList().length,
      total: wrongRecords().length
    },
    coach_notebook: {
      total: Array.isArray(CoachNotebook.records) ? CoachNotebook.records.length : 0,
      open_lessons: Array.isArray(CoachNotebook.records) ? CoachNotebook.records.filter(record => !record.mastered).length : 0,
      top_focuses: topFocuses
    },
    session_history: {
      total_sessions: sessions.length,
      recent_accuracy: recentAccuracy,
      days_since_last_session: daysSinceLastSession,
      last_session: lastSession ? {
        accuracy: Number(lastSession.acc || 0),
        total: Number(lastSession.total || 0),
        correct: Number(lastSession.correct || 0),
        duration_seconds: Number(lastSession.dur || 0),
        timestamp: lastTs
      } : null
    },
    setup: {
      mode: modeLabel(App.mode),
      length: sessionLengthLabel(App.size, set),
      filters: buildCoachChatSetupFilterText()
    },
    active_set: {
      name: String(set?.name || '').trim(),
      item_count: Array.isArray(set?.items) ? set.items.length : 0
    },
    recent_incorrect: recentIncorrect ? {
      key: recentIncorrect.key,
      title: recentIncorrect.title,
      region: recentIncorrect.region,
      era: recentIncorrect.era,
      topic: recentIncorrect.topic,
      reason: recentIncorrect.reason,
      attempt_id: recentIncorrect.attemptId
    } : null
  };
}

function buildCoachChatSummary(snapshot) {
  const recentIncorrect = snapshot?.recent_incorrect;
  const topFocus = snapshot?.coach_notebook?.top_focuses?.[0];
  if (CoachChat.ui.mode === 'knowledge') {
    return 'Ask for explanations, timelines, comparisons, or background on any IHBB topic.';
  }
  if (recentIncorrect?.title) {
    return `Last miss: ${recentIncorrect.title}.`;
  }
  if ((snapshot?.wrong_bank?.due_now || 0) > 0) {
    return `${snapshot.wrong_bank.due_now} wrong-bank card${snapshot.wrong_bank.due_now === 1 ? '' : 's'} due now.`;
  }
  if (topFocus?.title) {
    return `Top notebook focus: ${topFocus.title}.`;
  }
  if ((snapshot?.session_history?.total_sessions || 0) <= 0) {
    return 'No recent practice history yet.';
  }
  return `Current setup: ${snapshot?.setup?.mode || 'Practice'} • ${snapshot?.setup?.filters || 'All filters'}`;
}

function updateCoachChatSourceLabel() {
  const sourceEl = $('coach-chat-source');
  if (!sourceEl) return;
  let label = 'Ready';
  if (CoachChat.busy) label = 'Thinking';
  else if (CoachChat.source === 'deepseek') label = 'DeepSeek';
  else if (CoachChat.source === 'fallback') label = 'Local plan';
  sourceEl.textContent = `${label} • ${coachChatModeLabel(CoachChat.ui.mode)}`;
}

function renderCoachChatStatus(snapshot) {
  const summaryEl = $('coach-chat-context-summary');
  if (summaryEl) summaryEl.textContent = buildCoachChatSummary(snapshot);

  const pillsEl = $('coach-chat-status-pills');
  if (pillsEl) {
    const pills = [];
    if (CoachChat.ui.mode === 'knowledge') pills.push('Knowledge mode');
    if ((snapshot?.wrong_bank?.due_now || 0) > 0) pills.push(`Wrong-bank due ${snapshot.wrong_bank.due_now}`);
    if ((snapshot?.coach_notebook?.open_lessons || 0) > 0) pills.push(`Notebook open ${snapshot.coach_notebook.open_lessons}`);
    if (CoachChat.ui.mode !== 'knowledge' && (snapshot?.session_history?.recent_accuracy || 0) > 0) pills.push(`Recent accuracy ${snapshot.session_history.recent_accuracy}%`);
    if (!pills.length && snapshot?.active_set?.name) pills.push(snapshot.active_set.name);
    pillsEl.innerHTML = pills.length
      ? pills.slice(0, 2).map(text => `<span class="coach-chat-status-pill">${escHtml(text)}</span>`).join('')
      : `<span class="coach-chat-status-pill">${CoachChat.ui.mode === 'knowledge' ? 'Concept help ready.' : 'Study help ready.'}</span>`;
  }

  const noteEl = $('coach-chat-launcher-note');
  const countEl = $('coach-chat-launcher-count');
  if (noteEl) {
    if (CoachChat.ui.mode === 'knowledge') noteEl.textContent = 'Ask any concept';
    else if (snapshot?.recent_incorrect?.title) noteEl.textContent = 'Fix the last miss';
    else if ((snapshot?.wrong_bank?.due_now || 0) > 0) noteEl.textContent = `${snapshot.wrong_bank.due_now} due in Wrong-bank`;
    else if ((snapshot?.coach_notebook?.open_lessons || 0) > 0) noteEl.textContent = `${snapshot.coach_notebook.open_lessons} notebook lesson${snapshot.coach_notebook.open_lessons === 1 ? '' : 's'}`;
    else noteEl.textContent = 'Ask for a drill';
  }
  if (countEl) {
    const count = Math.max(snapshot?.wrong_bank?.due_now || 0, snapshot?.coach_notebook?.open_lessons || 0);
    countEl.textContent = String(count || 0);
    countEl.classList.toggle('hidden', !count);
  }
}

function isCoachChatPristine() {
  return !CoachChat.busy && !CoachChat.messages.length;
}

function hasCoachChatUserQuestion() {
  return CoachChat.messages.some(message => String(message?.role || '').trim() === 'user');
}

function limitCoachChatStarters(list = []) {
  return list.slice(0, isCoachChatPristine() ? 2 : 3);
}

function buildCoachChatStarters(snapshot = buildCoachChatStudyContext()) {
  const recent = snapshot?.recent_incorrect || null;
  const wrongDue = snapshot?.wrong_bank?.due_now || 0;
  const notebookOpen = snapshot?.coach_notebook?.open_lessons || 0;
  const topFocus = snapshot?.coach_notebook?.top_focuses?.[0] || null;
  const topFocusTitle = topFocus?.title || coachChatFocusTitle(topFocus);
  const recentTitle = String(recent?.title || '').trim();
  const knowledgeTopic = recentTitle || topFocusTitle || snapshot?.active_set?.name || 'this topic';
  if (CoachChat.ui.mode === 'knowledge') {
    return limitCoachChatStarters([
      { label: 'Explain it', prompt: `Explain ${knowledgeTopic} in detail and why it matters in IHBB.` },
      { label: 'Give a timeline', prompt: `Give me a clear timeline of ${knowledgeTopic}.` },
      { label: 'Common confusions', prompt: `What are the most common confusions or mix-ups around ${knowledgeTopic}?` }
    ]);
  }
  if (CoachChat.suggestedReason === 'miss' && recentTitle) {
    return limitCoachChatStarters([
      { label: 'Last miss', prompt: `Why did I miss ${recentTitle}, and what should I practice next?` },
      { label: 'Best tool', prompt: `For ${recentTitle}, should I use Wrong-bank, AI Notebook, or a generated drill first?` },
      { label: 'Corrective drill', prompt: `Build me a corrective practice plan for ${recentTitle}.` }
    ]);
  }
  if (wrongDue >= 3) {
    return limitCoachChatStarters([
      { label: 'Wrong-bank first', prompt: `I have ${wrongDue} due wrong-bank cards. Should I clear those before anything else?` },
      { label: 'After SRS', prompt: 'After I finish my due wrong-bank cards, what should I train next?' },
      { label: 'Fresh drill', prompt: topFocusTitle ? `Turn ${topFocusTitle} into a fresh drill after my due review.` : 'Recommend the best fresh drill after my due wrong-bank review.' }
    ]);
  }
  if ((CoachChat.suggestedReason === 'notebook' || notebookOpen > 0) && topFocusTitle) {
    return limitCoachChatStarters([
      { label: 'Notebook focus', prompt: `Which AI Notebook focus should I train next if ${topFocusTitle} keeps showing up?` },
      { label: 'From lesson to drill', prompt: `How should I turn ${topFocusTitle} from AI Notebook into actual practice?` },
      { label: 'Best next move', prompt: `Is ${topFocusTitle} better for Wrong-bank, AI Notebook review, or a fresh generated drill right now?` }
    ]);
  }
  return limitCoachChatStarters(COACH_CHAT_STARTERS);
}

function renderCoachChatStarters(snapshot) {
  const startersEl = $('coach-chat-starters');
  if (!startersEl) return;
  if (hasCoachChatUserQuestion()) {
    CoachChat.currentStarters = [];
    startersEl.innerHTML = '';
    return;
  }
  CoachChat.currentStarters = buildCoachChatStarters(snapshot);
  startersEl.innerHTML = CoachChat.currentStarters.map((starter, index) => `
    <button class="coach-chat-starter" type="button" data-starter-index="${index}">
      <span class="coach-chat-starter-label">${escHtml(starter.label || 'Suggested question')}</span>
      <span class="coach-chat-starter-text">${escHtml(starter.prompt || '')}</span>
    </button>
  `).join('');
}

function renderCoachChatWorkspace(snapshot) {
  const el = $('coach-chat-workspace');
  if (!el) return;
  const topFocus = snapshot?.coach_notebook?.top_focuses?.[0] || null;
  const knowledgeCard = {
    kicker: 'Ask',
    title: CoachChat.ui.mode === 'knowledge' ? 'Knowledge mode' : 'Concept help',
    copy: 'Explain a topic, get a timeline, or compare two ideas.',
    action: { kind: 'mode', mode: 'knowledge', label: CoachChat.ui.mode === 'knowledge' ? 'Knowledge mode active' : 'Switch to Knowledge' }
  };
  const primaryCard = (snapshot?.wrong_bank?.due_now || 0) > 0
    ? {
      kicker: 'Next step',
      title: `Review ${snapshot.wrong_bank.due_now} due`,
      copy: 'Clear the due queue first.',
      action: { kind: 'action', id: 'practice_due_now', label: 'Start due review' }
    }
    : topFocus?.key
      ? {
        kicker: 'Next step',
        title: topFocus.title,
        copy: 'Top saved focus.',
        action: { kind: 'action', id: 'apply_top_focus', focus_key: topFocus.key, label: `Apply ${topFocus.title}` }
      }
      : {
        kicker: 'Next step',
        title: 'Start practice',
        copy: `${snapshot?.setup?.mode || 'Practice'} • ${snapshot?.setup?.length || 'Flexible'}`,
        action: { kind: 'action', id: 'start_current_session', label: 'Start session' }
      };
  const cards = isCoachChatPristine()
    ? [primaryCard, knowledgeCard]
    : [
      {
        kicker: 'Wrong-bank',
        title: (snapshot?.wrong_bank?.due_now || 0) > 0 ? `Review ${snapshot.wrong_bank.due_now} due` : 'Wrong-bank',
        copy: (snapshot?.wrong_bank?.due_now || 0) > 0 ? 'Best next review block' : 'Use after new misses',
        action: (snapshot?.wrong_bank?.due_now || 0) > 0
          ? { kind: 'action', id: 'practice_due_now', label: 'Start due review' }
          : { kind: 'prompt', label: 'Ask when to use it', prompt: 'When is Wrong-bank better than a fresh drill?' }
      },
      {
        kicker: 'AI Notebook',
        title: topFocus?.title || 'Open Notebook',
        copy: topFocus?.title ? 'Top saved focus' : `${snapshot?.coach_notebook?.open_lessons || 0} open lesson${(snapshot?.coach_notebook?.open_lessons || 0) === 1 ? '' : 's'}`,
        action: topFocus?.key
          ? { kind: 'action', id: 'apply_top_focus', focus_key: topFocus.key, label: `Apply ${topFocus.title}` }
          : { kind: 'action', id: 'open_ai_notebook', label: 'Open Notebook' }
      },
      {
        kicker: 'Current drill',
        title: 'Start practice',
        copy: `${snapshot?.setup?.mode || 'Practice'} • ${snapshot?.setup?.length || 'Flexible'}`,
        action: { kind: 'action', id: 'start_current_session', label: 'Start session' }
      },
      knowledgeCard
    ];
  el.innerHTML = cards.map((card, index) => `
    <button class="coach-chat-workspace-card" type="button" data-workspace-index="${index}">
      <span class="coach-chat-workspace-kicker">${escHtml(card.kicker)}</span>
      <span class="coach-chat-workspace-title">${escHtml(card.title)}</span>
      <span class="coach-chat-workspace-copy">${escHtml(card.copy)}</span>
    </button>
  `).join('');
  CoachChat.workspaceCards = cards;
}

function coachChatMessageHtml(message, index) {
  const metaLabel = message.role === 'user'
    ? 'You'
    : (message.source === 'deepseek' ? 'DeepSeek' : 'Local plan');
  const actions = Array.isArray(message.actions) ? message.actions : [];
  const highlights = Array.isArray(message.highlights) ? message.highlights : [];
  const sections = Array.isArray(message.sections) ? message.sections : [];
  const links = Array.isArray(message.links) ? message.links : [];
  const followUps = Array.isArray(message.followUps) ? message.followUps : [];
  const toolsHtml = message.role === 'assistant' ? `
    <div class="coach-chat-message-tools">
      <button class="coach-chat-tool" type="button" data-message-index="${index}" data-tool="copy">Copy answer</button>
    </div>
  ` : '';
  return `
    <div class="coach-chat-message ${message.role === 'user' ? 'user' : 'assistant'}">
      <div class="coach-chat-message-meta">
        <span>${escHtml(metaLabel)}</span>
        <span>${escHtml(message.role === 'user' ? 'Prompt' : (message.mode === 'knowledge' ? 'Knowledge brief' : 'Practice advice'))}</span>
      </div>
      ${message.role === 'assistant' && message.title ? `<h3 class="coach-chat-message-title">${escHtml(message.title)}</h3>` : ''}
      <p class="coach-chat-message-text">${escHtml(message.text || '')}</p>
      ${highlights.length ? `<div class="coach-chat-highlights">${highlights.map(item => `<span class="coach-chat-highlight">${escHtml(item)}</span>`).join('')}</div>` : ''}
      ${sections.length ? `<div class="coach-chat-sections">${sections.map(section => `
        <div class="coach-chat-section-card">
          <h4>${escHtml(section.heading)}</h4>
          <p>${escHtml(section.body)}</p>
        </div>
      `).join('')}</div>` : ''}
      ${links.length ? `<div class="coach-chat-links">${links.map(link => `
        <a class="coach-chat-link-card" href="${escHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escHtml(link.label)}</a>
      `).join('')}</div>` : ''}
      ${followUps.length ? `<div class="coach-chat-followups">${followUps.map((followUp, followUpIndex) => `
        <button class="coach-chat-followup" type="button" data-message-index="${index}" data-followup-index="${followUpIndex}">${escHtml(followUp.label)}</button>
      `).join('')}</div>` : ''}
      ${actions.length ? `
        <div class="coach-chat-actions">
          ${actions.map((action, actionIndex) => `
            <button class="coach-chat-action" type="button" data-message-index="${index}" data-action-index="${actionIndex}">
              <span class="coach-chat-action-label">${escHtml(action.label || 'Run action')}</span>
              <span class="coach-chat-action-reason">${escHtml(action.reason || 'Recommended from your current study state.')}</span>
            </button>
          `).join('')}
        </div>
      ` : ''}
      ${toolsHtml}
    </div>
  `;
}

function renderCoachChatMessages() {
  const bodyEl = $('coach-chat-body');
  const messagesEl = $('coach-chat-messages');
  if (!messagesEl) return;
  const html = CoachChat.messages.map((message, index) => coachChatMessageHtml(message, index)).join('');
  const busyHtml = CoachChat.busy ? `
    <div class="coach-chat-message assistant coach-chat-thinking">
      <div class="coach-chat-message-meta">
        <span>DeepSeek</span>
        <span>Thinking</span>
      </div>
      <div class="coach-chat-thinking-bubble">
        <div class="coach-chat-thinking-dots" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="coach-chat-loading">${CoachChat.ui.mode === 'knowledge' ? 'DeepSeek is building a detailed study brief with references.' : 'DeepSeek is reviewing your wrong-bank, notebook, and setup.'}</div>
      </div>
    </div>
  ` : '';
  messagesEl.innerHTML = html || busyHtml
    ? `${html}${busyHtml}`
    : `<div class="coach-chat-empty">
        <div class="coach-chat-empty-title">${CoachChat.ui.mode === 'knowledge' ? 'Ask about any IHBB topic.' : 'Start with one quick question.'}</div>
        <p class="coach-chat-empty-text">${CoachChat.ui.mode === 'knowledge'
      ? 'Pick a prompt or type a topic when you want an explanation, timeline, or comparison.'
      : 'Pick a prompt or type what you want to practice next.'}</p>
      </div>`;
  if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setCoachChatOpenState(open) {
  CoachChat.open = !!open;
  const launcher = $('coach-chat-launcher');
  const sidebar = $('coach-chat-sidebar');
  const backdrop = $('coach-chat-backdrop');
  if (launcher) launcher.setAttribute('aria-expanded', CoachChat.open ? 'true' : 'false');
  if (sidebar) {
    sidebar.classList.toggle('open', CoachChat.open);
    sidebar.classList.toggle('fullscreen', !!CoachChat.ui.fullscreen);
    sidebar.setAttribute('aria-hidden', CoachChat.open ? 'false' : 'true');
    sidebar.dataset.chatPristine = isCoachChatPristine() ? 'true' : 'false';
    sidebar.dataset.chatAsked = hasCoachChatUserQuestion() ? 'true' : 'false';
    sidebar.style.setProperty('--coach-chat-width', `${clampCoachChatWidth(CoachChat.ui.width)}px`);
  }
  if (backdrop) backdrop.hidden = !CoachChat.open;
  document.body.classList.toggle('coach-chat-open', CoachChat.open);
}

function renderCoachChatChrome() {
  const snapshot = buildCoachChatStudyContext();
  renderCoachChatStatus(snapshot);
  renderCoachChatWorkspace(snapshot);
  renderCoachChatStarters(snapshot);
  renderCoachChatMessages();
  updateCoachChatSourceLabel();
  setCoachChatOpenState(CoachChat.open);
  const sendBtn = $('coach-chat-send');
  const hintEl = $('coach-chat-hint');
  const modeButtons = Array.from(document.querySelectorAll('#coach-chat-mode-switch .coach-chat-mode-btn'));
  const sizeButtons = Array.from(document.querySelectorAll('#coach-chat-size-presets .coach-chat-size-btn'));
  const fullBtn = $('coach-chat-fullscreen');
  if (sendBtn) sendBtn.disabled = !!CoachChat.busy;
  if (hintEl) {
    hintEl.textContent = CoachChat.ui.mode === 'knowledge'
      ? 'Knowledge mode gives long-form explanations and reference links.'
      : 'Coach mode stays tied to your practice state and only answers when asked.';
  }
  modeButtons.forEach(button => {
    const active = String(button.dataset.mode || '') === CoachChat.ui.mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  sizeButtons.forEach(button => {
    const active = String(button.dataset.size || '') === CoachChat.ui.size && !CoachChat.ui.fullscreen;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  if (fullBtn) {
    fullBtn.textContent = CoachChat.ui.fullscreen ? 'Windowed' : 'Full Screen';
    fullBtn.setAttribute('aria-pressed', CoachChat.ui.fullscreen ? 'true' : 'false');
  }
}

function coachChatModeLabel(mode = 'auto') {
  if (mode === 'knowledge') return 'Knowledge';
  if (mode === 'coach') return 'Coach';
  return 'Auto';
}

function resolveCoachChatMode(message = '', snapshot = buildCoachChatStudyContext()) {
  if (CoachChat.ui.mode === 'coach' || CoachChat.ui.mode === 'knowledge') return CoachChat.ui.mode;
  const prompt = String(message || '').trim().toLowerCase();
  const coachTerms = ['wrong bank', 'wrong-bank', 'srs', 'notebook', 'ai notebook', 'lesson', 'coach', 'practice', 'train', 'drill', 'session', 'review', 'setup', 'focus', 'assignment'];
  const knowledgeTerms = ['who ', 'what ', 'when ', 'where ', 'why ', 'how ', 'explain', 'define', 'describe', 'summarize', 'summary', 'timeline', 'compare', 'contrast', 'significance', 'overview', 'background', 'concept'];
  if (coachTerms.some(term => prompt.includes(term))) return 'coach';
  if (knowledgeTerms.some(term => prompt.includes(term))) return 'knowledge';
  if (!(snapshot?.session_history?.total_sessions || 0) && !(snapshot?.coach_notebook?.total || 0)) return 'knowledge';
  return 'coach';
}

function coachChatTopicFromMessage(message = '', snapshot = buildCoachChatStudyContext(), resolvedMode = resolveCoachChatMode(message, snapshot)) {
  const raw = String(message || '').trim();
  const recentTitle = String(snapshot?.recent_incorrect?.title || '').trim();
  const topFocusTitle = String(snapshot?.coach_notebook?.top_focuses?.[0]?.title || '').trim();
  if (!raw) return resolvedMode === 'knowledge' ? (recentTitle || topFocusTitle) : recentTitle;
  const prompt = raw
    .replace(/^[^a-zA-Z0-9]*(who|what|when|where|why|how)\s+(is|was|were|are|did|do|does)\s+/i, '')
    .replace(/^(explain|define|describe|outline|summarize|compare|contrast|tell me about|give me (a )?timeline of|what is the significance of|what was the significance of|what caused|what were the causes of|what happened in)\s+/i, '')
    .replace(/[?.!]+$/g, '')
    .trim();
  return prompt || recentTitle || topFocusTitle;
}

function coachChatWikipediaLink(topic = '') {
  const clean = String(topic || '').trim().replace(/[?.!]+$/g, '');
  if (!clean) return '';
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(clean.replace(/\s+/g, '_'))}`;
}

function coachChatAction(id, label, reason, options = {}) {
  const action = { id, label, reason };
  const key = String(options?.focus_key || options?.focusKey || '').trim();
  const query = String(options?.query || '').trim();
  if (key) action.focus_key = key;
  if (query) action.query = query;
  return action;
}

function dedupeCoachChatActions(actions) {
  const out = [];
  const seen = new Set();
  for (const action of (actions || [])) {
    const id = String(action?.id || '').trim();
    if (!COACH_CHAT_ALLOWED_ACTIONS.has(id)) continue;
    const focusKey = String(action?.focus_key || '').trim();
    const query = String(action?.query || '').trim();
    const key = `${id}|${focusKey}|${query}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id,
      label: String(action?.label || '').trim() || id.replace(/_/g, ' '),
      reason: String(action?.reason || '').trim() || 'Recommended from your current study context.',
      focus_key: focusKey,
      query
    });
  }
  return out.slice(0, 3);
}

function normalizeCoachChatSections(raw) {
  return Array.isArray(raw)
    ? raw.map(section => {
      const heading = String(section?.heading || section?.title || '').trim();
      const body = String(section?.body || section?.text || section?.content || '').trim();
      return heading && body ? { heading, body } : null;
    }).filter(Boolean).slice(0, 4)
    : [];
}

function normalizeCoachChatLinks(raw) {
  return Array.isArray(raw)
    ? raw.map(link => {
      const label = String(link?.label || link?.title || '').trim();
      const url = String(link?.url || '').trim();
      if (!label || !/^https:\/\//i.test(url)) return null;
      return { label, url, kind: String(link?.kind || link?.type || 'reference').trim() || 'reference' };
    }).filter(Boolean).slice(0, 4)
    : [];
}

function normalizeCoachChatFollowUps(raw) {
  return Array.isArray(raw)
    ? raw.map(item => {
      const label = String(item?.label || item?.title || '').trim();
      const prompt = String(item?.prompt || item?.message || '').trim();
      return label && prompt ? { label, prompt } : null;
    }).filter(Boolean).slice(0, 4)
    : [];
}

function normalizeCoachChatHighlights(raw) {
  return Array.isArray(raw)
    ? raw.map(item => String(item || '').trim()).filter(Boolean).slice(0, 4)
    : [];
}

function buildLocalCoachChatReply(message, snapshot = buildCoachChatStudyContext()) {
  const prompt = String(message || '').trim().toLowerCase();
  const mode = resolveCoachChatMode(message, snapshot);
  const wrongDue = snapshot?.wrong_bank?.due_now || 0;
  const wrongTotal = snapshot?.wrong_bank?.total || 0;
  const notebookOpen = snapshot?.coach_notebook?.open_lessons || 0;
  const topFocus = snapshot?.coach_notebook?.top_focuses?.[0] || null;
  const topFocusTitle = topFocus?.title || coachChatFocusTitle(topFocus);
  const topFocusKey = String(topFocus?.key || '').trim();
  const recentIncorrect = snapshot?.recent_incorrect || null;
  const recentAccuracy = snapshot?.session_history?.recent_accuracy || 0;
  const totalSessions = snapshot?.session_history?.total_sessions || 0;
  const daysSinceLastSession = snapshot?.session_history?.days_since_last_session || 0;
  const topic = coachChatTopicFromMessage(message, snapshot, mode);
  const actions = [];
  const highlights = [];
  let reply = '';
  let title = 'Practice plan';
  let sections = [];
  let followUps = [];

  if (mode === 'knowledge') {
    const wiki = coachChatWikipediaLink(topic);
    return {
      source: 'fallback',
      mode: 'knowledge',
      title: topic ? `Study brief: ${topic}` : 'Study brief',
      topic,
      message: topic
        ? `This looks like a knowledge question about ${topic}. When DeepSeek is available, I can answer it in detail here. Right now I can still structure the topic, suggest the best follow-up prompts, and give you a reference link.`
        : 'This looks like a knowledge question. When DeepSeek is available, I can answer it in detail here. Right now I can still frame the topic and give you the best follow-up prompts.',
      highlights: ['Knowledge mode', topic ? 'Wikipedia reference ready' : 'Reference lookup ready'].filter(Boolean),
      sections: [
        { heading: 'What to lock in first', body: topic ? `Start with the definition, timeframe, main actors, and why ${topic} matters in the broader historical story.` : 'Start with the definition, timeframe, main actors, and why the topic matters in the broader historical story.' },
        { heading: 'What IHBB usually rewards', body: 'Be ready to explain causes, turning points, significance, comparisons, and the larger regional or chronological pattern around the concept.' },
        { heading: 'Best follow-up prompts', body: 'Ask for a timeline, significance, comparison, common confusions, or likely clue patterns if you want a stronger study brief.' }
      ],
      links: wiki ? [{ label: `Wikipedia: ${topic}`, url: wiki, kind: 'wikipedia' }] : [],
      follow_ups: [
        { label: 'Give me a timeline', prompt: topic ? `Give me a clear timeline of ${topic}.` : 'Give me a clear timeline of this topic.' },
        { label: 'Why it matters', prompt: topic ? `Why is ${topic} historically significant?` : 'Why is this topic historically significant?' },
        { label: 'Common confusions', prompt: topic ? `What are the most common confusions around ${topic}?` : 'What are the most common confusions around this topic?' }
      ],
      quick_actions: dedupeCoachChatActions(topic ? [coachChatAction('open_library', `Search ${topic}`, 'Open the question library and search this topic.', { query: topic })] : [])
    };
  }

  if (prompt.includes('wrong-bank') || prompt.includes('wrong bank') || prompt.includes('srs')) {
    title = wrongDue > 0 ? 'Clear the due review loop first' : 'Wrong-bank is not the blocker right now';
    if (wrongDue > 0) {
      reply = `Wrong-bank is the right tool when you want spaced repetition on misses instead of fresh coverage. You have ${wrongDue} due card${wrongDue === 1 ? '' : 's'} out of ${wrongTotal} tracked right now.`;
      actions.push(coachChatAction('practice_due_now', `Practice ${wrongDue} due card${wrongDue === 1 ? '' : 's'}`, 'Start the due SRS queue immediately.'));
      sections = [
        { heading: 'Why this tool fits', body: 'Wrong-bank is for repetition on misses you have already created, not for brand-new coverage.' },
        { heading: 'Best next move', body: `Clear the ${wrongDue} due card${wrongDue === 1 ? '' : 's'} first, then decide whether you still need a fresh focused drill.` }
      ];
    } else {
      reply = 'Wrong-bank works best after regular drills create misses to revisit. Nothing is due right now, so a fresh targeted block is the better move.';
      if (topFocusKey) actions.push(coachChatAction('generate_focus_drill', `Generate ${topFocusTitle}`, 'Create fresh questions around the recurring blind spot.', { focus_key: topFocusKey }));
      actions.push(coachChatAction('open_review', 'Open Review', 'Check your review state before deciding.'));
      sections = [
        { heading: 'Why not Wrong-bank', body: 'There is nothing due right now, so SRS will not give you enough reps to move the needle.' },
        { heading: 'Better option', body: topFocusKey ? `Use ${topFocusTitle} for a short targeted block.` : 'Use a short targeted or mixed block to create new evidence.' }
      ];
    }
  } else if (prompt.includes('notebook') || prompt.includes('lesson') || prompt.includes('coach')) {
    title = topFocusKey ? `Notebook plan for ${topFocusTitle}` : 'Use AI Notebook for explanation, not repetition';
    reply = `AI Notebook is best when you need explanation and pattern review, not repetition of the exact same misses. You have ${notebookOpen} open lesson${notebookOpen === 1 ? '' : 's'}${topFocusKey ? `, and ${topFocusTitle} is the clearest recurring lane.` : '.'}`;
    actions.push(coachChatAction('open_ai_notebook', 'Open AI Notebook', 'Review saved DeepSeek lessons and mastery state.'));
    if (topFocusKey) {
      actions.push(coachChatAction('apply_top_focus', `Apply ${topFocusTitle}`, 'Load that focus into the practice builder.', { focus_key: topFocusKey }));
      actions.push(coachChatAction('generate_focus_drill', `Generate ${topFocusTitle}`, 'Turn that notebook pattern into a fresh drill.', { focus_key: topFocusKey }));
    }
    sections = [
      { heading: 'What Notebook is for', body: 'Use it to understand why you missed something, spot recurring patterns, and collect the right mental model.' },
      { heading: 'Best next move', body: topFocusKey ? `Review the lesson for ${topFocusTitle}, then either apply that focus to setup or generate a short drill from it.` : 'Open the lesson, review the explanation once, and then test yourself in practice.' }
    ];
  } else if (recentIncorrect?.title) {
    title = `Recover from ${recentIncorrect.title}`;
    reply = `You just missed ${recentIncorrect.title}. Review the notebook explanation once, then run a short focused set before going back to mixed drilling.`;
    actions.push(coachChatAction('open_ai_notebook', 'Open the lesson', 'Reopen the saved explanation for this miss.'));
    actions.push(coachChatAction('generate_focus_drill', `Generate ${recentIncorrect.title}`, 'Build a short corrective drill from the same lane.', { focus_key: recentIncorrect.key }));
    actions.push(coachChatAction('review_last_misses', 'Review recent misses', 'Revisit the review queue before resuming mixed practice.'));
    sections = [
      { heading: 'Why this matters', body: 'A fresh miss is the highest-signal evidence you have. Fixing it immediately usually pays off faster than adding more random volume.' },
      { heading: 'Best sequence', body: 'Review the explanation, run a short corrective drill, then return to mixed practice once the mistake is no longer repeating.' }
    ];
  } else if (wrongDue >= 3) {
    title = 'Close the due queue before adding new volume';
    reply = `You have ${wrongDue} due wrong-bank cards. That is the cleanest next move because it closes the loop on known misses before you add more volume.`;
    actions.push(coachChatAction('practice_due_now', `Practice ${wrongDue} due card${wrongDue === 1 ? '' : 's'}`, 'Start the due SRS queue now.'));
    if (topFocusKey) actions.push(coachChatAction('generate_focus_drill', `Generate ${topFocusTitle}`, 'Follow SRS with a short fresh drill in the same lane.', { focus_key: topFocusKey }));
  } else if (topFocusKey && (notebookOpen > 0 || recentAccuracy < 70)) {
    title = `Make ${topFocusTitle} the next targeted block`;
    reply = `Your notebook keeps pointing back to ${topFocusTitle}. Use that as the next targeted block, then return to mixed practice after accuracy stabilizes.`;
    actions.push(coachChatAction('apply_top_focus', `Apply ${topFocusTitle}`, 'Load the recurring notebook focus into setup.', { focus_key: topFocusKey }));
    actions.push(coachChatAction('generate_focus_drill', `Generate ${topFocusTitle}`, 'Create fresh questions in the same lane.', { focus_key: topFocusKey }));
    actions.push(coachChatAction('open_ai_notebook', 'Open AI Notebook', 'Review the supporting explanations first.'));
  } else if (totalSessions <= 0) {
    title = 'Get one clean baseline session first';
    reply = 'Start with one normal mixed drill to create enough evidence for stronger recommendations. Once you miss a few questions, Wrong-bank and AI Notebook become much more useful.';
    actions.push(coachChatAction('start_current_session', 'Start current session', 'Begin the drill you have configured now.'));
    actions.push(coachChatAction('open_setup', 'Open setup', 'Tune region, era, and mode before starting.'));
  } else {
    const freshness = daysSinceLastSession > 0
      ? `Your last session was about ${daysSinceLastSession} day${daysSinceLastSession === 1 ? '' : 's'} ago. `
      : 'You already have recent practice data. ';
    reply = `${freshness}The best structure is one targeted block for a weak lane and one mixed block to test transfer.${topFocusKey ? ` Right now ${topFocusTitle} is the clearest place to focus first.` : ' Right now a short mixed drill is enough to keep momentum.'}`;
    title = topFocusKey ? `Use ${topFocusTitle} as the next smart block` : 'Keep momentum with one targeted block and one mixed block';
    if (topFocusKey) actions.push(coachChatAction('apply_top_focus', `Apply ${topFocusTitle}`, 'Set up a targeted block first.', { focus_key: topFocusKey }));
    actions.push(coachChatAction('start_current_session', 'Start current session', 'Run the current practice setup.'));
    actions.push(coachChatAction('open_review', 'Open Review', 'Check wrong-bank and session debrief before deciding.'));
  }

  if (wrongDue > 0) highlights.push(`${wrongDue} due in Wrong-bank`);
  if (notebookOpen > 0) highlights.push(`${notebookOpen} notebook lesson${notebookOpen === 1 ? '' : 's'} open`);
  if (recentAccuracy > 0) highlights.push(`Recent accuracy ${recentAccuracy}%`);
  followUps = followUps.length ? followUps : [
    { label: 'Make this more detailed', prompt: `${String(reply || '').trim()} Give me the more detailed version.`.trim() },
    { label: 'Turn this into a plan', prompt: 'Turn this into a short practice plan I can follow right now.' }
  ];
  const links = [];
  const linkTopic = recentIncorrect?.title || topFocusTitle || topic;
  const wiki = coachChatWikipediaLink(linkTopic);
  if (wiki && linkTopic) links.push({ label: `Wikipedia: ${linkTopic}`, url: wiki, kind: 'wikipedia' });
  if (linkTopic && actions.length < 3) actions.push(coachChatAction('open_library', `Search ${linkTopic}`, 'Open the question library and search this topic.', { query: linkTopic }));

  return {
    source: 'fallback',
    mode: 'coach',
    title,
    topic: linkTopic,
    message: reply,
    highlights,
    sections,
    links,
    follow_ups: followUps,
    quick_actions: dedupeCoachChatActions(actions)
  };
}

function normalizeCoachChatReply(raw, payload, snapshot) {
  const fallback = buildLocalCoachChatReply(payload?.message || '', snapshot, payload?.assistant_mode || CoachChat.ui.mode);
  const validFocusKeys = new Set([
    ...(snapshot?.coach_notebook?.top_focuses || []).map(focus => String(focus?.key || '').trim()),
    String(snapshot?.recent_incorrect?.key || '').trim()
  ].filter(Boolean));
  const obj = (raw && typeof raw === 'object') ? raw : {};
  const actions = Array.isArray(obj.quick_actions)
    ? dedupeCoachChatActions(obj.quick_actions.map(action => ({
      id: String(action?.id || '').trim(),
      label: String(action?.label || action?.title || '').trim(),
      reason: String(action?.reason || '').trim(),
      focus_key: validFocusKeys.has(String(action?.focus_key || '').trim()) ? String(action?.focus_key || '').trim() : '',
      query: String(action?.query || '').trim()
    })))
    : [];
  const links = normalizeCoachChatLinks(obj?.links);
  return {
    source: String(obj?.source || '').trim().toLowerCase() === 'deepseek' ? 'deepseek' : 'fallback',
    mode: String(obj?.mode || '').trim() === 'knowledge' ? 'knowledge' : fallback.mode,
    title: String(obj?.title || '').trim() || fallback.title,
    topic: String(obj?.topic || '').trim() || fallback.topic,
    message: String(obj?.message || '').trim() || fallback.message,
    highlights: normalizeCoachChatHighlights(obj?.highlights).length ? normalizeCoachChatHighlights(obj?.highlights) : fallback.highlights,
    sections: normalizeCoachChatSections(obj?.sections).length ? normalizeCoachChatSections(obj?.sections) : fallback.sections,
    links: links.length ? links : fallback.links,
    follow_ups: normalizeCoachChatFollowUps(obj?.follow_ups).length ? normalizeCoachChatFollowUps(obj?.follow_ups) : fallback.follow_ups,
    quick_actions: actions.length ? actions : fallback.quick_actions
  };
}

async function requestCoachChatReply(message) {
  const snapshot = buildCoachChatStudyContext();
  const payload = {
    message: String(message || '').trim(),
    conversation: CoachChat.messages
      .filter(entry => entry && ['user', 'assistant'].includes(entry.role))
      .slice(-8)
      .map(entry => ({ role: entry.role, content: String(entry.text || '').trim() }))
      .filter(entry => entry.content),
    study_context: snapshot,
    assistant_mode: CoachChat.ui.mode
  };
  const response = await fetch('/api/coach-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const raw = await response.json().catch(() => ({}));
  if (!response.ok && !raw?.message) {
    throw new Error(`Coach chat failed (${response.status})`);
  }
  return normalizeCoachChatReply(raw, payload, snapshot);
}

function clearCoachChatConversation() {
  CoachChat.messages = [];
  CoachChat.source = 'ready';
  renderCoachChatChrome();
}

function setCoachChatMode(mode = 'auto') {
  const next = ['auto', 'coach', 'knowledge'].includes(String(mode || '').trim()) ? String(mode).trim() : 'auto';
  CoachChat.ui.mode = next;
  saveCoachChatUiPrefs();
  renderCoachChatChrome();
}

function setCoachChatSizePreset(size = 'standard') {
  const next = Object.prototype.hasOwnProperty.call(COACH_CHAT_SIZE_PRESETS, String(size || '').trim()) ? String(size).trim() : 'standard';
  CoachChat.ui.size = next;
  CoachChat.ui.width = clampCoachChatWidth(COACH_CHAT_SIZE_PRESETS[next]);
  CoachChat.ui.fullscreen = false;
  saveCoachChatUiPrefs();
  renderCoachChatChrome();
}

function toggleCoachChatFullscreen() {
  CoachChat.ui.fullscreen = !CoachChat.ui.fullscreen;
  saveCoachChatUiPrefs();
  renderCoachChatChrome();
}

function beginCoachChatResize(event) {
  if (window.innerWidth <= 900 || CoachChat.ui.fullscreen) return;
  CoachChat.resizing = { startX: event.clientX };
  document.body.classList.add('coach-chat-resizing');
  event.preventDefault();
}

function coachChatPromptForReason(reason = 'manual') {
  if (reason === 'miss') {
    return 'I just missed a question. What should I practice next, and should I use AI Notebook, Wrong-bank, or a generated focus drill?';
  }
  if (reason === 'wrong-bank') {
    return 'What should I do with my due wrong-bank cards right now?';
  }
  if (reason === 'notebook') {
    return 'Which AI Notebook focus should I train next?';
  }
  return 'What should I practice next in this practice hub?';
}

function isCoachChatAutoSuppressed() {
  try { return sessionStorage.getItem(COACH_CHAT_SUPPRESS_KEY) === '1'; } catch { return false; }
}

function openCoachChat(options = {}) {
  if (!options.auto) {
    try { sessionStorage.removeItem(COACH_CHAT_SUPPRESS_KEY); } catch { /* noop */ }
  }
  CoachChat.suggestedReason = String(options.reason || 'manual').trim() || 'manual';
  CoachChat.open = true;
  renderCoachChatChrome();
  if (options.focusInput !== false) {
    setTimeout(() => $('coach-chat-input')?.focus(), 80);
  }
}

function closeCoachChat({ manual = true } = {}) {
  if (manual) {
    try { sessionStorage.setItem(COACH_CHAT_SUPPRESS_KEY, '1'); } catch { /* noop */ }
  }
  CoachChat.open = false;
  renderCoachChatChrome();
}

function maybeAutoOpenCoachChat(reason = 'init') {
  if (CoachChat.open || CoachChat.busy || isCoachChatAutoSuppressed() || CoachChat.autoReasons.has(reason)) return false;
  const snapshot = buildCoachChatStudyContext();
  if (reason === 'miss' && snapshot?.recent_incorrect?.title) {
    CoachChat.suggestedReason = 'miss';
    renderCoachChatChrome();
    return false;
  } else if ((snapshot?.wrong_bank?.due_now || 0) >= 3) {
  } else if ((snapshot?.coach_notebook?.open_lessons || 0) >= 2 && snapshot?.coach_notebook?.top_focuses?.[0]?.title) {
  } else {
    return false;
  }
  CoachChat.autoReasons.add(reason);
  openCoachChat({ auto: true, focusInput: false, reason, seed: false });
  return true;
}

function resolveCoachChatActionFocus(action) {
  const key = String(action?.focus_key || '').trim();
  if (key) {
    const focus = buildCoachFocusSuggestions(CoachNotebook.records).find(item => String(item?.key || '').trim() === key);
    if (focus) return focus;
    const recent = getCoachChatRecentIncorrect();
    if (recent && String(recent.key || '').trim() === key) return recent;
  }
  const recentIncorrect = getCoachChatRecentIncorrect();
  return buildCoachFocusSuggestions(CoachNotebook.records)[0] || recentIncorrect || null;
}

async function performCoachChatAction(action = {}) {
  const actionId = String(action?.id || '').trim();
  if (!COACH_CHAT_ALLOWED_ACTIONS.has(actionId)) return;
  const focus = resolveCoachChatActionFocus(action);
  switch (actionId) {
    case 'practice_due_now':
    case 'review_last_misses':
      closeCoachChat({ manual: false });
      reviewMissedNow();
      return;
    case 'open_ai_notebook':
      await openCoachNotebook(getCoachChatRecentIncorrect()?.attemptId || '');
      return;
    case 'apply_top_focus':
      if (!focus) { toast('No notebook focus is ready yet'); return; }
      closeCoachChat({ manual: false });
      await openCoachFocusDrill(focus, { createdFrom: 'coach-chat-apply' });
      return;
    case 'generate_focus_drill':
      if (!focus) { toast('No focus is ready to generate'); return; }
      closeCoachChat({ manual: false });
      await startGeneratedFocusDrill(focus, { count: 6, createdFrom: 'coach-chat-generate' });
      return;
    case 'start_current_session':
      closeCoachChat({ manual: false });
      startSession();
      return;
    case 'open_setup':
      navSet('nav-setup');
      SHOW('view-setup');
      renderCoachChatChrome();
      return;
    case 'open_review':
      navSet('nav-review');
      SHOW('view-review');
      renderHistory();
      renderWrongBank();
      drawCharts();
      flushCoachPending();
      await refreshCoachNotebook(true);
      renderCoachChatChrome();
      return;
    case 'open_library':
      closeCoachChat({ manual: false });
      navSet('nav-library');
      SHOW('view-library');
      if ($('lib-search')) $('lib-search').value = String(action?.query || '').trim();
      renderLibraryTable();
      return;
    default:
      return;
  }
}

async function sendCoachChatMessage(rawMessage, options = {}) {
  const message = String(rawMessage || '').trim();
  if (!message || CoachChat.busy) return false;
  if (!options.hiddenUserMessage) {
    pushCoachChatMessage({ role: 'user', text: message, source: 'user', actions: [], highlights: [], sections: [], links: [], followUps: [] });
  }
  CoachChat.busy = true;
  CoachChat.source = 'ready';
  renderCoachChatChrome();
  try {
    const reply = await requestCoachChatReply(message);
    CoachChat.source = reply.source === 'deepseek' ? 'deepseek' : 'fallback';
    pushCoachChatMessage({
      role: 'assistant',
      text: String(reply.message || '').trim(),
      source: CoachChat.source,
      mode: String(reply.mode || '').trim() === 'knowledge' ? 'knowledge' : 'coach',
      title: String(reply.title || '').trim(),
      topic: String(reply.topic || '').trim(),
      highlights: Array.isArray(reply.highlights) ? reply.highlights : [],
      sections: Array.isArray(reply.sections) ? reply.sections : [],
      links: Array.isArray(reply.links) ? reply.links : [],
      followUps: Array.isArray(reply.follow_ups) ? reply.follow_ups : [],
      actions: Array.isArray(reply.quick_actions) ? reply.quick_actions : []
    });
  } catch (err) {
    const fallback = buildLocalCoachChatReply(message);
    CoachChat.source = 'fallback';
    pushCoachChatMessage({
      role: 'assistant',
      text: String(fallback.message || '').trim(),
      source: 'fallback',
      mode: String(fallback.mode || '').trim() === 'knowledge' ? 'knowledge' : 'coach',
      title: String(fallback.title || '').trim(),
      topic: String(fallback.topic || '').trim(),
      highlights: Array.isArray(fallback.highlights) ? fallback.highlights : [],
      sections: Array.isArray(fallback.sections) ? fallback.sections : [],
      links: Array.isArray(fallback.links) ? fallback.links : [],
      followUps: Array.isArray(fallback.follow_ups) ? fallback.follow_ups : [],
      actions: Array.isArray(fallback.quick_actions) ? fallback.quick_actions : []
    });
  } finally {
    CoachChat.busy = false;
    renderCoachChatChrome();
  }
  return true;
}

function coachFocusFromRecord(record) {
  const coach = normalizeCoach(record?.coach, {
    question: record?.question_text || '',
    meta: { category: record?.category || '', era: record?.era || '', source: record?.source || '' }
  }, !!record?.correct, String(record?.reason || ''));
  const focus = coach.study_focus || {};
  return {
    region: String(focus.region || record?.category || '').trim(),
    era: String(focus.era || record?.era || '').trim(),
    topic: String(focus.topic || record?.focus_topic || '').trim(),
    icon: String(focus.icon || '📘').trim() || '📘',
    coach
  };
}

function buildCoachFocusSuggestions(records = CoachNotebook.records) {
  const map = new Map();
  for (const record of (records || [])) {
    const focus = coachFocusFromRecord(record);
    if (!focus.region && !focus.era && !focus.topic) continue;
    const key = `${focus.region}|${focus.era}|${focus.topic}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        region: focus.region,
        era: focus.era,
        topic: focus.topic,
        icon: focus.icon,
        attempts: 0,
        incorrect: 0,
        unresolved: 0,
        latestTs: 0,
        sample: record,
        coach: focus.coach
      });
    }
    const entry = map.get(key);
    entry.attempts += 1;
    if (!record.correct) entry.incorrect += 1;
    if (!record.mastered) entry.unresolved += 1;
    const ts = record.created_at ? new Date(record.created_at).getTime() : 0;
    if (ts >= entry.latestTs) {
      entry.latestTs = ts;
      entry.sample = record;
      entry.coach = focus.coach;
    }
  }

  return Array.from(map.values())
    .sort((a, b) => (b.unresolved - a.unresolved) || (b.incorrect - a.incorrect) || (b.attempts - a.attempts) || (b.latestTs - a.latestTs))
    .map(entry => {
      const title = [entry.region, entry.era, entry.topic].filter(Boolean).join(' • ') || 'Coach focus';
      const priority = entry.unresolved >= 3 || entry.incorrect >= 2 ? 'high' : (entry.unresolved >= 1 ? 'medium' : 'low');
      return {
        key: entry.key,
        title,
        region: entry.region,
        era: entry.era,
        topic: entry.topic,
        icon: entry.icon,
        meta: `${entry.unresolved} open lesson${entry.unresolved === 1 ? '' : 's'} • ${entry.incorrect} incorrect`,
        reason: entry.coach?.summary || entry.coach?.error_diagnosis || entry.sample?.reason || 'DeepSeek has highlighted this area repeatedly in recent practice.',
        action: entry.coach?.study_tip || entry.coach?.key_clues?.[0] || entry.coach?.related_facts?.[0] || 'Run a targeted drill on this focus.',
        priority,
        attemptId: String(entry.sample?.client_attempt_id || '').trim()
      };
    })
    .slice(0, 4);
}

function coachFocusCardHtml(focus, index, actionClass) {
  if (!focus) return '';
  const scope = actionClass === 'coach-review-focus' ? 'review' : 'setup';
  return `
    <div class="coach-focus-card">
      <div class="coach-focus-head">
        <div>
          <div class="coach-focus-title">${escHtml(focus.icon || '📘')} ${escHtml(focus.title || 'Coach focus')}</div>
          <div class="coach-focus-meta">${escHtml(focus.meta || 'DeepSeek focus')}</div>
        </div>
        <span class="analytics-ai-priority ${escHtml(focus.priority || 'medium')}">${escHtml(focus.priority || 'medium')}</span>
      </div>
      <p class="coach-focus-reason">${escHtml(focus.reason || 'This area is worth reviewing before your next mixed drill.')}</p>
      <div class="coach-focus-tags">
        ${focus.region ? `<span class="coach-focus-pill">Region: ${escHtml(focus.region)}</span>` : ''}
        ${focus.era ? `<span class="coach-focus-pill">Era: ${escHtml(focus.era)}</span>` : ''}
        ${focus.topic ? `<span class="coach-focus-pill">Topic: ${escHtml(focus.topic)}</span>` : ''}
      </div>
      <div class="coach-focus-actions">
        <button class="btn pri ${actionClass}" type="button" data-focus-index="${index}" data-focus-scope="${scope}">Apply Focus</button>
        <button class="btn ghost coach-generate-focus" type="button" data-focus-index="${index}" data-focus-scope="${scope}">Generate Drill</button>
        ${focus.attemptId ? `<button class="btn ghost coach-jump-note" type="button" data-attempt="${escHtml(focus.attemptId)}">Open Lesson</button>` : `<button class="btn ghost coach-open-notebook" type="button">Open AI Notebook</button>`}
      </div>
    </div>
  `;
}

function coachEraToCode(rawEra, set) {
  const era = String(rawEra || '').trim();
  if (!era) return '';
  if (ERA_NAMES[era]) return era;
  const direct = Object.entries(ERA_NAMES).find(([, label]) => String(label).trim().toLowerCase() === era.toLowerCase());
  if (direct) return direct[0];
  const available = sortEraCodes([...new Set((set?.items || []).map(it => String(it.meta?.era || '').trim()).filter(Boolean))]);
  const fuzzy = available.find(code => String(getEraName(code)).trim().toLowerCase() === era.toLowerCase());
  return fuzzy || '';
}

function coachFocusMatchInSet(focus, set) {
  const categories = new Set((set?.items || []).map(it => String(it.meta?.category || '').trim()).filter(Boolean));
  const region = categories.has(String(focus?.region || '').trim()) ? String(focus.region).trim() : '';
  const eraCode = coachEraToCode(focus?.era, set);
  const score = (region ? 1 : 0) + (eraCode ? 1 : 0);
  return { region, eraCode, score };
}

function resolveCoachFocusSet(focus) {
  const activeSet = getActiveSet();
  const activeMatch = activeSet ? coachFocusMatchInSet(focus, activeSet) : { region: '', eraCode: '', score: 0 };
  const needsStructuredMatch = !!String(focus?.region || '').trim() || !!String(focus?.era || '').trim();
  if (!needsStructuredMatch && activeSet) {
    return { set: activeSet, match: activeMatch };
  }
  if (activeSet && activeMatch.score > 0) {
    return { set: activeSet, match: activeMatch };
  }
  let best = null;
  for (const set of (Library.sets || [])) {
    const match = coachFocusMatchInSet(focus, set);
    if (!best || match.score > best.match.score) {
      best = { set, match };
    }
  }
  if (best && (best.match.score > 0 || !needsStructuredMatch)) return best;
  return { set: activeSet, match: activeMatch };
}

function applyCoachFocusToSetup(focus, showToast = true) {
  const resolved = resolveCoachFocusSet(focus);
  const set = resolved?.set || getActiveSet();
  if (!set || !focus) {
    if (showToast) toast('Load a set before applying a coach focus');
    return false;
  }
  const hasFilterTarget = !!String(focus.region || '').trim() || !!String(focus.era || '').trim();
  const region = String(resolved?.match?.region || '').trim();
  const eraCode = String(resolved?.match?.eraCode || '').trim();
  if (hasFilterTarget && !region && !eraCode) {
    if (showToast) toast('No loaded question set matches this focus yet');
    return false;
  }
  if (set.id !== Library.activeSetId) {
    Library.activeSetId = set.id;
    saveLibrary();
    renderLibrarySelectors();
    updateSetMeta();
  }
  const categories = new Set((set.items || []).map(it => String(it.meta?.category || '').trim()).filter(Boolean));
  App.filters.cat = region;
  App.filters.cats = region ? [region] : [];
  App.filters.era = eraCode;
  App.filters.eras = eraCode ? [eraCode] : [];
  const fc = $('filter-cat'); if (fc) fc.value = region;
  renderCategoryChips([...categories]);
  renderEraChips(sortEraCodes([...new Set((set.items || []).map(it => String(it.meta?.era || '').trim()).filter(Boolean))]));
  updateSetupOverview();
  renderSetupCoachGuide();
  if (showToast) {
    if (region || eraCode) toast(`Coach focus applied: ${focus.title}`);
    else toast(`Opened setup for ${focus.title}. No region or era filter was needed.`);
  }
  return true;
}

function readPendingCoachDrill() {
  const raw = safeReadJson(KEY_COACH_DRILL, null);
  if (!raw || typeof raw !== 'object') return null;
  const ts = Number(raw.ts || 0);
  if (ts && (Date.now() - ts) > 2 * 60 * 60 * 1000) {
    try { localStorage.removeItem(KEY_COACH_DRILL); } catch { /* noop */ }
    return null;
  }
  return raw;
}

function clearPendingCoachDrill() {
  try { localStorage.removeItem(KEY_COACH_DRILL); } catch { /* noop */ }
}

function writePendingCoachChatAction(mode, extra = {}) {
  const payload = {
    mode: String(mode || '').trim(),
    ts: Date.now(),
    ...extra
  };
  try { localStorage.setItem(KEY_COACH_CHAT_ACTION, JSON.stringify(payload)); } catch { /* noop */ }
}

function readPendingCoachChatAction() {
  const raw = safeReadJson(KEY_COACH_CHAT_ACTION, null);
  if (!raw || typeof raw !== 'object') return null;
  const mode = String(raw.mode || '').trim();
  if (!mode) return null;
  const ts = Number(raw.ts || 0);
  if (ts && (Date.now() - ts) > 30 * 60 * 1000) {
    try { localStorage.removeItem(KEY_COACH_CHAT_ACTION); } catch { /* noop */ }
    return null;
  }
  return raw;
}

function clearPendingCoachChatAction() {
  try { localStorage.removeItem(KEY_COACH_CHAT_ACTION); } catch { /* noop */ }
}

async function applyPendingCoachChatAction() {
  const pending = readPendingCoachChatAction();
  if (!pending) return false;
  clearPendingCoachChatAction();
  const mode = String(pending.mode || '').trim();
  if (mode === 'practice_due_now' || mode === 'review_last_misses') {
    navSet('nav-review');
    SHOW('view-review');
    renderHistory();
    renderWrongBank();
    drawCharts();
    await refreshCoachNotebook(false);
    if (wrongRecords().length) {
      reviewMissedNow();
    } else {
      toast('Wrong bank empty');
    }
    return true;
  }
  if (mode === 'open_review') {
    navSet('nav-review');
    SHOW('view-review');
    renderHistory();
    renderWrongBank();
    drawCharts();
    await refreshCoachNotebook(false);
    return true;
  }
  if (mode === 'open_library') {
    navSet('nav-library');
    SHOW('view-library');
    if ($('lib-search')) $('lib-search').value = String(pending.query || '').trim();
    renderLibraryTable();
    return true;
  }
  if (mode === 'start_current_session') {
    navSet('nav-setup');
    SHOW('view-setup');
    if (getActiveSet()) startSession();
    else toast('Load a set before starting practice');
    return true;
  }
  navSet('nav-setup');
  SHOW('view-setup');
  return true;
}

function applyPendingCoachGuidedDrill() {
  const pending = readPendingCoachDrill();
  if (!pending) return false;
  const focus = {
    title: String(pending.title || '').trim() || [pending.region, pending.era, pending.topic].filter(Boolean).join(' • ') || 'Coach focus',
    region: String(pending.region || '').trim(),
    era: String(pending.era || '').trim(),
    topic: String(pending.topic || '').trim()
  };
  const pendingMode = String(pending.mode || 'guided').trim() || 'guided';
  if (pendingMode === 'generate') {
    if (!PendingCoachGeneration) {
      PendingCoachGeneration = true;
      void startGeneratedFocusDrill(focus, {
        count: 6,
        createdFrom: String(pending.source || 'student-dashboard').trim() || 'student-dashboard',
        clearPending: true
      }).finally(() => {
        PendingCoachGeneration = false;
      });
    }
    return false;
  }
  const applied = applyCoachFocusToSetup(focus, false);
  if (applied) {
    clearPendingCoachDrill();
    toast(`Coach drill ready: ${focus.title}`);
  } else if (!PendingCoachGeneration) {
    PendingCoachGeneration = true;
    void startGeneratedFocusDrill(focus, {
      count: 6,
      createdFrom: String(pending.source || 'student-dashboard').trim() || 'student-dashboard',
      clearPending: true
    }).finally(() => {
      PendingCoachGeneration = false;
    });
  }
  return applied;
}

async function openCoachFocusDrill(focus, options = {}) {
  if (!focus) {
    toast('No coach focus available yet');
    return false;
  }
  const applied = applyCoachFocusToSetup(focus, false);
  if (applied) {
    toast(`Coach focus applied: ${buildFocusTitle(focus)}`);
    if (options.navigate !== false) {
      navSet('nav-setup');
      SHOW('view-setup');
    }
    return true;
  }
  return startGeneratedFocusDrill(focus, {
    count: options.count || 6,
    createdFrom: String(options.createdFrom || 'coach-focus').trim() || 'coach-focus',
    clearPending: !!options.clearPending
  });
}

function renderSetupCoachGuide() {
  CoachFocusSuggestions = buildCoachFocusSuggestions(CoachNotebook.records);
  const notebookApplyBtn = $('btn-coach-apply-top');
  if (notebookApplyBtn) notebookApplyBtn.disabled = !CoachFocusSuggestions.length;
}

async function clearCoachNotebook() {
  const total = Array.isArray(CoachNotebook.records) ? CoachNotebook.records.length : 0;
  if (!total) {
    toast('AI notebook is already empty');
    return;
  }
  const firstWarning = confirm(`Clear ${total} saved AI notebook lesson${total === 1 ? '' : 's'}? This cannot be undone.`);
  if (!firstWarning) return;
  const secondWarning = confirm('This will remove your saved AI notebook lessons from this device and, if available, from cloud sync as well. Continue?');
  if (!secondWarning) return;

  CoachNotebook.records = [];
  CoachNotebook.loaded = true;
  setCoachLocal([]);
  setCoachPending([]);
  clearPendingCoachDrill();
  renderCoachNotebook();
  renderSessionCoachDebrief();

  let cloudCleared = false;
  if (CoachSync.enabled && window.supabaseClient) {
    try {
      await CoachSync.queue.catch(() => {});
      const userId = await ensureCoachSyncUserId();
      if (userId) {
        const { error } = await window.supabaseClient
          .from(COACH_SYNC_TABLE)
          .delete()
          .eq('user_id', userId);
        if (error) throw error;
        cloudCleared = true;
      }
    } catch (err) {
      handleCoachSyncError(err);
    }
  }

  playFeedbackCue('unmastered');
  toast(cloudCleared ? 'AI notebook cleared locally and in the cloud' : 'AI notebook cleared on this device');
}

function renderSessionCoachDebrief() {
  const focusWrap = $('review-coach-focuses');
  const noteEl = $('review-coach-note');
  const applyBtn = $('btn-review-coach-apply');
  if (!focusWrap || !noteEl || !applyBtn) return;
  const lastSessionId = String(JSON.parse(localStorage.getItem(KEY_SESS) || '[]')?.[0]?.sid || '').trim();
  const sessionRecords = lastSessionId
    ? (CoachNotebook.records || []).filter(r => String(r?.client_session_id || '') === lastSessionId)
    : [];
  const sessionFocuses = buildCoachFocusSuggestions(sessionRecords);
  const source = sessionFocuses.length ? sessionFocuses : CoachFocusSuggestions.slice(0, 2);
  ReviewCoachFocusSuggestions = source.slice(0, 2);
  applyBtn.disabled = !source.length;
  if (!source.length) {
    focusWrap.innerHTML = `<div class="coach-empty">Finish a session and the review page will surface the coach lesson patterns worth drilling next.</div>`;
    noteEl.textContent = 'Finish a session and the review page will surface the coach lesson patterns worth drilling next.';
    ReviewCoachFocusSuggestions = [];
    return;
  }
  const lead = source[0];
  noteEl.textContent = sessionFocuses.length
    ? `This session kept returning to ${lead.title}. Drill that lane now before going back to mixed practice.`
    : `No session-specific coach lesson is ready yet, so the review page is using your broader top coach focus: ${lead.title}.`;
  focusWrap.innerHTML = ReviewCoachFocusSuggestions.map((focus, index) => coachFocusCardHtml(focus, index, 'coach-review-focus')).join('');
}

function coachFocusFromAttemptId(attemptId) {
  const id = String(attemptId || '').trim();
  if (!id) return null;
  const record = (CoachNotebook.records || []).find(r => String(r?.client_attempt_id || '').trim() === id);
  if (!record) return null;
  const focus = coachFocusFromRecord(record);
  return {
    title: [focus.region, focus.era, focus.topic].filter(Boolean).join(' • ') || 'Coach focus',
    region: focus.region,
    era: focus.era,
    topic: focus.topic,
    icon: focus.icon,
    attemptId: id
  };
}

async function showCoachView(forceCloud = true) {
  navSet('nav-coach');
  SHOW('view-coach');
  flushCoachPending();
  await refreshCoachNotebook(forceCloud);
}

async function openCoachNotebook(attemptId = '') {
  await showCoachView(true);
  if (!attemptId) return;
  setTimeout(() => {
    const target = Array.from(document.querySelectorAll('.coach-note'))
      .find(el => String(el.dataset.attempt || '') === String(attemptId));
    const details = target?.querySelector('details');
    if (details) details.open = true;
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 40);
}

// Detect assignment launch early so init can avoid overriding the assignment set.
const URL_PARAMS = new URLSearchParams(window.location.search);
const ASSIGNMENT_ID = URL_PARAMS.get('assignment');
const ASSIGNMENT_STORAGE_KEY = ASSIGNMENT_ID ? ('ihbb_assignment_' + ASSIGNMENT_ID) : null;
const HAS_ASSIGNMENT_PAYLOAD = (() => {
  if (!ASSIGNMENT_STORAGE_KEY) return false;
  try { return !!localStorage.getItem(ASSIGNMENT_STORAGE_KEY); } catch { return false; }
})();

/********************* Voices *********************/
const PREF = [/Microsoft .* Online .*Natural/i, /Google US English/i, /en[-_]?US/i, /en[-_]?GB/i];
const englishOnly = (arr) => arr.filter(v => /^en(-|_)?/i.test(v.lang) || /English/i.test(v.name));
const scoreVoice = (v) => {
  let s = 0;
  for (let i = 0; i < PREF.length; i++) {
    if (PREF[i].test(v.name) || PREF[i].test(v.lang || "")) { s += (PREF.length - i) * 10; break; }
  }
  if (/en(-|_)US/i.test(v.lang || "") || /US/i.test(v.name)) s += 3;
  if (/Natural|Neural/i.test(v.name)) s += 2;
  return s;
};

function populateVoices() {
  const all = speechSynthesis.getVoices();
  const eng = englishOnly(all).sort((a, b) => (scoreVoice(b) - scoreVoice(a)) || a.name.localeCompare(b.name));
  const sel = $('voiceSel'); if (!sel) return;
  sel.innerHTML = '';
  for (const v of eng) { const o = document.createElement('option'); o.value = v.name; o.textContent = `${v.name} • ${v.lang}`; sel.appendChild(o); }
  if (eng.length) { sel.value = Settings.voice && eng.some(v => v.name === Settings.voice) ? Settings.voice : eng[0].name; Settings.voice = sel.value; }
}
speechSynthesis.onvoiceschanged = populateVoices;

const rate = () => parseFloat(($('rate') && $('rate').value) || '1.0');
const curVoice = () => speechSynthesis.getVoices().find(v => v.name === ($('voiceSel') && $('voiceSel').value));

function stopSpeech() { try { window.speechSynthesis.cancel(); } catch { /* noop */ } }
function speakOnce(text, voice, r = 1.0, pitch = 1.0, maxMs = 45000) {
  try { window.speechSynthesis.cancel(); } catch { }
  try { window.speechSynthesis.resume(); } catch { }
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = r; u.pitch = pitch;
    let done = false;
    const finish = () => { if (done) return; done = true; resolve(); };
    const t = setTimeout(() => { try { window.speechSynthesis.cancel(); } catch { } finish(); }, maxMs);
    u.onend = () => { clearTimeout(t); finish(); };
    u.onerror = () => { clearTimeout(t); finish(); };
    window.speechSynthesis.speak(u);
  });
}
function splitSentences(text) {
  const parts = text.replace(/\s+/g, ' ').match(/[^.!?;—]+[.!?;—]?/g) || [text];
  return parts.map(s => s.trim()).filter(Boolean);
}
async function readProgressive(text) {
  App.rollingSentences = splitSentences(text);
  App.lastLines = [];
  for (const s of App.rollingSentences) {
    if (App.readingAbort) break;
    App.lastLines.push(s); if (App.lastLines.length > 2) App.lastLines.shift();
    await speakOnce(s, curVoice(), rate(), 1.0, 15000);
  }
}
function replayLast() {
  if (!App.lastLines.length) return;
  speakOnce(App.lastLines.join(' '), curVoice(), rate(), 1.0, 12000);
}
document.addEventListener('visibilitychange', () => {
  try { if (document.visibilityState === 'visible') window.speechSynthesis.resume(); } catch { }
});

/********************* Beeps (WebAudio) *********************/
let ac = null;
function AC() { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { } } return ac; }
function beep(freq = 880, dur = 0.11, type = 'sine', peak = 0.25) {
  const ctx = AC(); if (!ctx) return;
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.connect(g); g.connect(ctx.destination);
  o.frequency.value = freq; o.type = type;
  g.gain.setValueAtTime(0.0001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(peak, ctx.currentTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  o.start(); o.stop(ctx.currentTime + dur);
}
const FEEDBACK_HAPTICS = Object.freeze({
  tap: [8],
  nav: [10],
  start: [12, 32, 12],
  next: [9],
  buzz: [20],
  reveal: [10, 18, 10],
  submit: [10],
  correct: [14, 28, 20],
  wrong: [38, 50, 16],
  finish: [26, 34, 26],
  mastered: [8, 20, 14],
  unmastered: [18]
});
function playFeedbackCue(name, opts = {}) {
  const allowSound = (opts.sound !== false) && !!Settings.cueBeep;
  const allowHaptic = (opts.haptic !== false) && !!Settings.haptics;

  if (allowSound) {
    if (name === 'tap') {
      beep(980, 0.03, 'triangle', 0.07);
    } else if (name === 'nav') {
      beep(700, 0.035, 'triangle', 0.08);
    } else if (name === 'start') {
      beep(740, 0.07, 'triangle', 0.12);
      setTimeout(() => beep(988, 0.09, 'triangle', 0.13), 95);
    } else if (name === 'next') {
      beep(840, 0.04, 'sine', 0.09);
    } else if (name === 'buzz') {
      beep(620, 0.05, 'square', 0.12);
      setTimeout(() => beep(760, 0.06, 'square', 0.12), 70);
    } else if (name === 'reveal') {
      beep(520, 0.06, 'triangle', 0.1);
      setTimeout(() => beep(650, 0.07, 'triangle', 0.1), 85);
    } else if (name === 'submit') {
      beep(560, 0.05, 'sine', 0.1);
      setTimeout(() => beep(620, 0.05, 'sine', 0.1), 70);
    } else if (name === 'correct') {
      beep(880, 0.08, 'sine', 0.16);
      setTimeout(() => beep(1320, 0.11, 'sine', 0.16), 95);
    } else if (name === 'wrong') {
      beep(230, 0.14, 'sawtooth', 0.15);
      setTimeout(() => beep(170, 0.16, 'sawtooth', 0.14), 130);
    } else if (name === 'finish') {
      beep(659, 0.08, 'triangle', 0.13);
      setTimeout(() => beep(784, 0.08, 'triangle', 0.13), 85);
      setTimeout(() => beep(988, 0.12, 'triangle', 0.14), 170);
    } else if (name === 'mastered') {
      beep(760, 0.06, 'triangle', 0.1);
      setTimeout(() => beep(1010, 0.08, 'triangle', 0.12), 90);
    } else if (name === 'unmastered') {
      beep(340, 0.08, 'triangle', 0.09);
    }
  }

  if (!allowHaptic) return;
  const pattern = FEEDBACK_HAPTICS[name];
  if (pattern) vibrate(pattern);
}

/********************* Library & Parsing *********************/
function loadAll() {
  try { Object.assign(Settings, JSON.parse(localStorage.getItem(KEY_SETTINGS) || '{}')); } catch { }
  try { const L = JSON.parse(localStorage.getItem(KEY_LIBRARY) || '{}'); if (L && L.sets) Object.assign(Library, L); } catch { }
  try { Presets = JSON.parse(localStorage.getItem(KEY_PRESETS) || '{}'); } catch { }
}
function saveLibrary() {
  try {
    const toSave = Object.assign({}, Library, { sets: Library.sets.filter(s => !s.volatile) });
    localStorage.setItem(KEY_LIBRARY, JSON.stringify(toSave));
  } catch (err) {
    throw err;
  }
}
function saveSettings() { localStorage.setItem(KEY_SETTINGS, JSON.stringify(Settings)); }
function savePresets() { localStorage.setItem(KEY_PRESETS, JSON.stringify(Presets)); }

function renderLibrarySelectors() {
  const sel1 = $('qs-picker'); const sel2 = $('lib-set-sel'); if (!sel1 || !sel2) return;
  sel1.innerHTML = ''; sel2.innerHTML = '';
  if (!Library.sets.length) {
    const o = document.createElement('option'); o.value = ''; o.textContent = '(no sets — run build_db.py or import)';
    sel1.appendChild(o); sel2.appendChild(o.cloneNode(true));
    const qm = $('qs-meta'); if (qm) qm.textContent = 'Run build_db.py to generate questions.json';
    const lc = $('lib-count'); if (lc) lc.textContent = '0';
    const lca = $('lib-cats'); if (lca) lca.textContent = '—';
    const le = $('lib-eras'); if (le) le.textContent = '—';
    updateSetupOverview();
    return;
  }
  for (const s of Library.sets) {
    const o = document.createElement('option'); o.value = s.id; o.textContent = s.name;
    sel1.appendChild(o); sel2.appendChild(o.cloneNode(true));
  }
  if (!Library.activeSetId) Library.activeSetId = Library.sets[0].id;
  sel1.value = Library.activeSetId; sel2.value = Library.activeSetId;
  updateSetMeta();
}
function getActiveSet() { return Library.sets.find(s => s.id === Library.activeSetId) || null; }

function updateSetMeta() {
  const set = getActiveSet();
  const qm = $('qs-meta'); if (qm) qm.textContent = set ? `Items: ${set.items.length}` : '—';
  const lc = $('lib-count'); if (lc) lc.textContent = set ? String(set.items.length) : '0';
  const cats = set ? [...new Set(set.items.map(it => it.meta?.category || '').filter(Boolean))] : [];
  const eras = set ? sortEraCodes([...new Set(set.items.map(it => it.meta?.era || '').filter(Boolean))]) : [];
  const lca = $('lib-cats'); if (lca) lca.textContent = cats.length ? String(cats.length) : '—';
  const le = $('lib-eras'); if (le) le.textContent = eras.length ? String(eras.length) : '—';

  const fc = $('filter-cat'); const fs = $('filter-src');
  if (fc) {
    fc.innerHTML = '<option value="">All</option>';
    for (const c of cats) { const o = document.createElement('option'); o.value = c; o.textContent = c; fc.appendChild(o); }
    if (App.filters.cat) {
      try { fc.value = App.filters.cat; } catch { }
    }
  }
  if (fs) {
    fs.innerHTML = '<option value="">All</option>';
    const srcs = set ? [...new Set(set.items.map(it => it.meta?.source || '').filter(Boolean))] : [];
    for (const s of srcs) { const o = document.createElement('option'); o.value = s; o.textContent = s; fs.appendChild(o); }
  }

  const lfc = $('lib-filter-cat'); const lfe = $('lib-filter-era');
  if (lfc) { lfc.innerHTML = '<option value="">All regions</option>'; for (const c of cats) { const o = document.createElement('option'); o.value = c; o.textContent = c; lfc.appendChild(o); } }
  if (lfe) { lfe.innerHTML = '<option value="">All eras</option>'; for (const e of eras) { const o = document.createElement('option'); o.value = e; o.textContent = getEraName(e); lfe.appendChild(o); } }

  updateFilterRow();
  renderCategoryChips(cats);
  renderEraChips(eras);
  updateSetupOverview();
  applyPendingCoachGuidedDrill();
}

const ERA_NAMES = {
  "01": "8000 BCE – 600 BCE",
  "02": "600 BCE – 600 CE",
  "03": "600 CE – 1450 CE",
  "04": "1450 CE – 1750 CE",
  "05": "1750 – 1914",
  "06": "1914 – 1991",
  "07": "1991 – Present"
};

function buildFocusTitle(focus) {
  return [focus?.region, focus?.era, focus?.topic].filter(Boolean).join(' • ') || String(focus?.title || '').trim() || 'Targeted Focus';
}

function questionMergeKey(item) {
  const question = String(item?.question || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const answer = String(item?.answer || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!question || !answer) return '';
  return `${answer}::${question}`;
}

function findSharedQuestionSet() {
  const sets = Array.isArray(Library.sets) ? Library.sets : [];
  return sets.find(set => /IHBB Questions/i.test(String(set?.name || '').trim()))
    || sets.find(set => set?.volatile)
    || sets[0]
    || null;
}

function mergeQuestionItems(existingItems, incomingItems) {
  const nextItems = Array.isArray(existingItems) ? existingItems.slice() : [];
  const byId = new Map();
  const byKey = new Map();
  for (const existing of nextItems) {
    const id = String(existing?.id || '').trim();
    const key = questionMergeKey(existing);
    if (id) byId.set(id, existing);
    if (key) byKey.set(key, existing);
  }
  const sessionItems = [];
  let insertedCount = 0;
  for (const raw of (incomingItems || [])) {
    const item = normalizeJsonItem(raw);
    if (!item) continue;
    item.meta = { ...(item.meta || {}), source: String(item?.meta?.source || 'generated').trim() || 'generated' };
    const id = String(item.id || '').trim();
    const key = questionMergeKey(item);
    const existing = (id && byId.get(id)) || (key && byKey.get(key)) || null;
    if (existing) {
      sessionItems.push(existing);
      continue;
    }
    nextItems.push(item);
    if (id) byId.set(id, item);
    if (key) byKey.set(key, item);
    sessionItems.push(item);
    insertedCount++;
  }
  return { items: nextItems, sessionItems, insertedCount };
}

function mergeGeneratedQuestionsIntoSharedLibrary(incomingItems, { activate = true } = {}) {
  Library.sets = Array.isArray(Library.sets) ? Library.sets : [];
  let set = findSharedQuestionSet();
  if (!set) {
    set = { id: uid(), name: 'IHBB Questions', items: [], volatile: true };
    Library.sets.unshift(set);
  }
  const merged = mergeQuestionItems(set.items || [], incomingItems);
  set.items = merged.items;
  if (activate || !Library.activeSetId) Library.activeSetId = set.id;
  renderLibrarySelectors();
  renderLibraryTable();
  updateSetMeta();
  updateFilterRowSafe();
  updateSetupOverview();
  return {
    set,
    sessionItems: merged.sessionItems,
    insertedCount: merged.insertedCount,
    totalCount: set.items.length
  };
}

async function fetchSharedGeneratedQuestionItems() {
  try {
    const res = await fetch(GENERATED_QUESTIONS_BANK_URL, { cache: 'no-cache' });
    if (!res.ok) return [];
    const obj = await res.json();
    if (Array.isArray(obj?.items)) {
      return normalizeJsonItems(obj.items);
    }
    if (Array.isArray(obj?.sets)) {
      return obj.sets.flatMap(set => normalizeJsonItems(set?.items || []));
    }
    const parsed = parseJsonImport(obj, 'Shared Generated Questions');
    if (!parsed) return [];
    if (parsed.type === 'library') {
      return parsed.sets.flatMap(set => Array.isArray(set?.items) ? set.items : []);
    }
    return Array.isArray(parsed.set?.items) ? parsed.set.items : [];
  } catch (err) {
    console.warn('[GeneratedQuestions] shared bank unavailable:', err);
    return [];
  }
}

function collectAvoidAnswers(focus = null) {
  const answers = new Set();
  for (const set of (Library.sets || [])) {
    for (const item of (set?.items || [])) {
      const sameRegion = !focus?.region || String(item?.meta?.category || '').trim() === String(focus.region || '').trim();
      const sameEra = !focus?.era || String(item?.meta?.era || '').trim() === String(coachEraToCode(focus.era, set) || focus.era || '').trim();
      if (sameRegion || sameEra || String(item?.meta?.source || '').trim() === 'generated') {
        const answer = String(item?.answer || '').trim();
        if (answer) answers.add(answer);
      }
      if (answers.size >= 60) return Array.from(answers);
    }
  }
  return Array.from(answers);
}

async function requestGeneratedQuestions(options = {}) {
  const payload = {
    count: Math.max(1, Math.min(12, Number.parseInt(String(options.count || 5), 10) || 5)),
    region: String(options.region || '').trim() || 'World',
    era: String(options.era || '').trim(),
    topic: String(options.topic || '').trim(),
    creator_role: String(options.creatorRole || '').trim() || 'student',
    created_from: String(options.createdFrom || '').trim() || 'practice',
    focus_reason: String(options.reason || '').trim(),
    reference_question: String(options.referenceQuestion || '').trim(),
    reference_answer: String(options.referenceAnswer || '').trim(),
    wrong_answer: String(options.wrongAnswer || '').trim(),
    avoid_answers: Array.isArray(options.avoidAnswers) ? options.avoidAnswers : collectAvoidAnswers(options)
  };
  const res = await fetch('/api/generate-questions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    throw new Error(data?.error || `Question generation failed (${res.status})`);
  }
  return {
    items: (data.items || []).map(normalizeJsonItem).filter(Boolean),
    persistence: data?.persistence || null
  };
}

async function startGeneratedFocusDrill(focus, options = {}) {
  if (!focus) {
    toast('No focus available to generate');
    return false;
  }
  const title = buildFocusTitle(focus);
  const eraCode = String(coachEraToCode(focus.era, getActiveSet()) || focus.era || '').trim();
  const creatorRole = String(options.creatorRole || await ensureCurrentProfileRole() || 'student').trim() || 'student';
  const count = Math.max(1, Math.min(12, Number.parseInt(String(options.count || 6), 10) || 6));
  try {
    toast(`Generating ${count} fresh questions for ${title}...`);
    const generated = await requestGeneratedQuestions({
      count,
      region: String(focus.region || '').trim() || 'World',
      era: eraCode,
      topic: String(focus.topic || '').trim(),
      creatorRole,
      createdFrom: String(options.createdFrom || 'coach-focus').trim() || 'coach-focus',
      reason: String(focus.reason || options.reason || '').trim(),
      avoidAnswers: collectAvoidAnswers({ region: focus.region, era: eraCode, topic: focus.topic })
    });
    const items = generated.items || [];
    if (!items.length) throw new Error('No valid generated questions were returned.');
    const mergeResult = mergeGeneratedQuestionsIntoSharedLibrary(items, { activate: true });
    App.sessionOverrideItems = mergeResult.sessionItems.slice();
    App.size = 'all';
    App.mode = 'sequential';
    App.filters = { cat: '', cats: [], era: '', eras: [], src: '' };
    if (options.clearPending) clearPendingCoachDrill();
    if (options.startSession !== false) startSession();
    const persistence = generated.persistence || {};
    const sharedAdded = Number(persistence.shared_bank_added || 0);
    const persistenceNote = persistence.warning
      ? ` ${String(persistence.warning).trim()}`
      : (sharedAdded > 0
        ? ` Added ${sharedAdded} to the shared bank.`
        : ' Already present in the shared bank.');
    toast(`Generated ${mergeResult.sessionItems.length} fresh question${mergeResult.sessionItems.length === 1 ? '' : 's'} for ${title}.${persistenceNote}`);
    return true;
  } catch (err) {
    toast(String(err?.message || err || 'Question generation failed'));
    return false;
  }
}

function getEraName(code) {
  return ERA_NAMES[code] || code;
}

function sortEraCodes(codes) {
  return (codes || []).slice().sort((a, b) => {
    const na = Number.parseInt(String(a), 10);
    const nb = Number.parseInt(String(b), 10);
    const aNum = Number.isFinite(na);
    const bNum = Number.isFinite(nb);
    if (aNum && bNum && na !== nb) return na - nb;
    if (aNum !== bNum) return aNum ? -1 : 1;
    return String(a).localeCompare(String(b));
  });
}

function updateFilterRow() {
  const set = getActiveSet();
  const hasMeta = set && set.items.some(it => it.meta?.category || it.meta?.era || it.meta?.source);
  const row = $('filter-row'); if (row) row.style.display = hasMeta ? 'flex' : 'none';
}

// Legacy meta-categories kept for backward-compatibility with old saved presets.
const CATEGORY_GROUPS = {
  'Asian History': ['East Asia', 'South Asia', 'Southeast Asia', 'Central Asia'],
  'Americas': ['North America', 'Latin America'],
};

function expandCategorySelection(selected) {
  const out = new Set();
  for (const s of selected) {
    if (CATEGORY_GROUPS[s]) CATEGORY_GROUPS[s].forEach(r => out.add(r));
    else out.add(s);
  }
  return Array.from(out);
}

// Setup screen: render multi-select category chips
function renderCategoryChips(cats) {
  const wrap = $('cat-chips'); if (!wrap) return;
  wrap.innerHTML = '';
  if (!cats.length) { wrap.appendChild(document.createTextNode('(No categories — run build_db.py)')); updateSetupOverview(); return; }
  // All chip
  const all = document.createElement('div');
  all.className = 'chip' + ((Array.isArray(App.filters.cats) && App.filters.cats.length) ? '' : ' active');
  all.textContent = 'All regions';
  all.dataset.cat = '';
  all.onclick = () => {
    App.filters.cats = [];
    App.filters.cat = '';
    renderCategoryChips(cats);
  };
  wrap.appendChild(all);
  // Category chips (every region directly selectable)
  const expanded = new Set(expandCategorySelection(Array.isArray(App.filters.cats) ? App.filters.cats : []));
  const chipCats = (cats || []).slice().sort((a, b) => String(a).localeCompare(String(b)));
  for (const c of chipCats) {
    const chip = document.createElement('div');
    const isActive = expanded.has(c);
    chip.className = 'chip' + (isActive ? ' active' : '');
    chip.textContent = c;
    chip.dataset.cat = c;
    chip.onclick = () => {
      const sel = new Set(expandCategorySelection(App.filters.cats || []));
      if (sel.has(c)) sel.delete(c); else sel.add(c);
      App.filters.cats = Array.from(sel);
      App.filters.cat = '';
      renderCategoryChips(cats);
    };
    wrap.appendChild(chip);
  }
  updateSetupOverview();
}

// Setup screen: render multi-select era chips
function renderEraChips(eras) {
  const wrap = $('era-chips'); if (!wrap) return;
  const eraList = sortEraCodes((eras || []).slice());
  wrap.innerHTML = '';
  if (!eraList.length) { wrap.appendChild(document.createTextNode('(No eras — run build_db.py)')); updateSetupOverview(); return; }

  // Backward compatibility with old presets that stored only filters.era
  if (!Array.isArray(App.filters.eras)) App.filters.eras = [];
  if (!App.filters.eras.length && App.filters.era) App.filters.eras = [App.filters.era];
  App.filters.eras = App.filters.eras.filter(Boolean).filter(e => eraList.includes(e));
  App.filters.era = App.filters.eras.length === 1 ? App.filters.eras[0] : '';

  // All eras chip
  const all = document.createElement('div');
  all.className = 'chip' + (App.filters.eras.length ? '' : ' active');
  all.textContent = 'All eras';
  all.onclick = () => {
    App.filters.eras = [];
    App.filters.era = '';
    renderEraChips(eraList);
  };
  wrap.appendChild(all);

  // Era chips
  const selected = new Set(App.filters.eras || []);
  for (const e of eraList) {
    const chip = document.createElement('div');
    chip.className = 'chip' + (selected.has(e) ? ' active' : '');
    chip.textContent = getEraName(e);
    chip.dataset.era = e;
    chip.onclick = () => {
      const sel = new Set(App.filters.eras || []);
      if (sel.has(e)) sel.delete(e); else sel.add(e);
      App.filters.eras = Array.from(sel);
      App.filters.era = App.filters.eras.length === 1 ? App.filters.eras[0] : '';
      renderEraChips(eraList);
    };
    wrap.appendChild(chip);
  }
  updateSetupOverview();
}

// Parser & Sanitizer
function mkItem(q, a, meta = {}) {
  return { id: uid(), question: q, answer: a, aliases: [], meta: { category: meta.category || '', era: meta.era || '', source: meta.source || '' } };
}
function sanitizeItem(it) {
  if (!it || typeof it !== 'object') return;
  if (!Array.isArray(it.aliases)) it.aliases = [];
  it.question = String(it.question || '').replace(/\s+/g, ' ').trim();
  let ans = String(it.answer || '').replace(/\s+/g, ' ').trim();
  const aliasRe = /\[(?:accept|also|or)\s*([^\]]+)\]|\((?:accept|also|or)\s*([^)]+)\)/ig;
  let m; while ((m = aliasRe.exec(ans))) { const chunk = (m[1] || m[2] || '').trim(); if (chunk) it.aliases.push(chunk); }
  ans = ans.replace(aliasRe, '').trim();
  ans = ans.replace(/(\d{4}.*?(Round|Regional|Extra|Packet|Bee|Bowl|Championship).*)$/i, '').trim();
  ans = ans.replace(/(\d{4}.*)$/, '').trim();
  ans = ans.replace(/^"|"$/g, '').trim();
  it.answer = ans;
}
function parseQA(txt) {
  const lines = txt.replace(/\r/g, '').split(/\n/);
  let items = [], curQ = [], curA = [], meta = {}, stage = 'find';
  function push() { if (curQ.length && curA.length) items.push(mkItem(curQ.join(' ').trim(), curA.join(' ').trim(), meta)); curQ = []; curA = []; meta = {}; }
  for (const raw of lines) {
    const line = raw.trim();
    if (/^\d+\./.test(line) || /^Question\s*:/i.test(line)) { push(); stage = 'q'; const t = line.replace(/^\d+\.\s*/, '').replace(/^Question\s*:\s*/i, ''); curQ.push(t); continue; }
    if (/^Answer\s*:/i.test(line)) { stage = 'a'; curA.push(line.replace(/^Answer\s*:\s*/i, '')); continue; }
    if (!line) continue;
    if (stage === 'q') curQ.push(line);
    else if (stage === 'a') curA.push(line);
  }
  push();
  for (const it of items) sanitizeItem(it);
  return items;
}
function stringVal(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}
function toAliasArray(v) {
  if (Array.isArray(v)) return v.map(stringVal).filter(Boolean);
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    return s.split(/[;,|]/).map(x => x.trim()).filter(Boolean);
  }
  return [];
}
function normalizeMeta(raw) {
  const m = raw?.meta || raw?.metadata || {};
  return {
    category: stringVal(raw?.category ?? raw?.cat ?? raw?.region ?? m?.category ?? m?.cat ?? m?.region),
    era: stringVal(raw?.era ?? raw?.period ?? m?.era ?? m?.period),
    source: stringVal(raw?.source ?? raw?.src ?? m?.source ?? m?.src)
  };
}
function normalizeJsonItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const q = stringVal(raw.question ?? raw.q ?? raw.prompt ?? raw.text ?? raw.body);
  const a = stringVal(raw.answer ?? raw.a ?? raw.response ?? raw.correct ?? raw.solution);
  if (!q || !a) return null;
  const aliases = [
    ...toAliasArray(raw.aliases),
    ...toAliasArray(raw.accept),
    ...toAliasArray(raw.accepted),
    ...toAliasArray(raw.alts)
  ];
  const item = { id: stringVal(raw.id) || uid(), question: q, answer: a, aliases, meta: normalizeMeta(raw) };
  sanitizeItem(item);
  item.aliases = Array.from(new Set((item.aliases || []).map(stringVal).filter(Boolean)));
  return item.question && item.answer ? item : null;
}
function normalizeJsonItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  const out = [];
  for (const raw of rawItems) {
    const it = normalizeJsonItem(raw);
    if (it) out.push(it);
  }
  return out;
}
const IMPORT_LOG_PREFIX = '[IHBB Import]';
function topKeys(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  return Object.keys(obj).slice(0, 20);
}
function logImport(level, msg, extra) {
  const fn = (console && console[level]) ? console[level] : console.log;
  if (extra === undefined) fn(`${IMPORT_LOG_PREFIX} ${msg}`);
  else fn(`${IMPORT_LOG_PREFIX} ${msg}`, extra);
}
function saveLibrarySafe(context = 'saveLibrary') {
  try {
    saveLibrary();
    return true;
  } catch (err) {
    logImport('error', `${context}: saveLibrary failed: ${(err && err.name) || 'Error'}: ${(err && err.message) || String(err)}`, err);
    return false;
  }
}
function extractQuestionArray(obj) {
  if (Array.isArray(obj)) return obj;
  if (!obj || typeof obj !== 'object') return null;
  const directKeys = ['items', 'questions', 'data', 'records', 'rows'];
  for (const k of directKeys) {
    if (Array.isArray(obj[k])) return obj[k];
  }
  const nestedKeys = ['set', 'questionSet', 'payload', 'result', 'results', 'data'];
  for (const k of nestedKeys) {
    const v = obj[k];
    if (!v || typeof v !== 'object') continue;
    for (const kk of directKeys) {
      if (Array.isArray(v[kk])) return v[kk];
    }
  }
  return null;
}
function parseJsonImport(obj, fallbackName = 'Imported JSON') {
  if (!obj || typeof obj !== 'object') {
    logImport('error', 'parseJsonImport: root is not an object/array', { type: typeof obj });
    return null;
  }
  logImport('info', 'parseJsonImport: begin', {
    isArrayRoot: Array.isArray(obj),
    keys: topKeys(obj),
    fallbackName
  });
  if (Array.isArray(obj?.sets)) {
    const sets = [];
    obj.sets.forEach((s, i) => {
      const rawItems = extractQuestionArray(s);
      const items = normalizeJsonItems(rawItems);
      if (!items.length) return;
      sets.push({ id: stringVal(s?.id) || uid(), name: stringVal(s?.name) || `Set ${i + 1}`, items, volatile: fallbackName === 'IHBB Questions' });
    });
    if (sets.length) {
      return { type: 'library', sets, activeSetId: stringVal(obj.activeSetId) || sets[0]?.id || null };
    }
    logImport('warn', 'parseJsonImport: found sets but none contained valid questions', {
      setCount: obj.sets.length
    });
  }
  const rawItems = extractQuestionArray(obj);
  const items = normalizeJsonItems(rawItems);
  if (!items.length) {
    logImport('error', 'parseJsonImport: no valid question items found', {
      keys: topKeys(obj),
      rawItemsDetected: Array.isArray(rawItems),
      rawItemsLength: Array.isArray(rawItems) ? rawItems.length : 0
    });
    return null;
  }
  logImport('info', 'parseJsonImport: parsed single set', { itemCount: items.length });
  return { type: 'set', set: { id: stringVal(obj.id) || uid(), name: stringVal(obj.name) || fallbackName, items, volatile: fallbackName === 'IHBB Questions' } };
}
function importSetFromJsonObject(obj, fallbackName) {
  logImport('info', 'importSetFromJsonObject: start', {
    fallbackName,
    rootIsArray: Array.isArray(obj),
    keys: topKeys(obj)
  });
  const parsed = parseJsonImport(obj, fallbackName);
  if (!parsed) {
    logImport('error', 'importSetFromJsonObject: failed to parse JSON');
    toast('Invalid JSON format: expected a question array, an object with items/questions, or a library with sets');
    return false;
  }
  try {
    if (parsed.type === 'library') {
      Library.sets = parsed.sets;
      Library.activeSetId = parsed.activeSetId || parsed.sets[0]?.id || null;
      const persisted = saveLibrarySafe('library import');
      renderLibrarySelectors(); renderLibraryTable(); updateSetMeta();
      logImport('info', 'importSetFromJsonObject: library imported', {
        setCount: parsed.sets.length,
        activeSetId: Library.activeSetId,
        persisted
      });
      toast(persisted ? `Imported library (${parsed.sets.length} sets)` : `Imported library (${parsed.sets.length} sets) - not saved (storage full)`);
      return true;
    }
    const set = parsed.set;
    Library.sets.unshift(set); Library.activeSetId = set.id;
    const persisted = saveLibrarySafe('set import');
    renderLibrarySelectors(); renderLibraryTable(); updateSetMeta();
    logImport('info', 'importSetFromJsonObject: set imported', {
      setName: set.name,
      itemCount: set.items.length,
      activeSetId: Library.activeSetId,
      persisted
    });
    toast(persisted ? `Imported ${set.items.length} questions from JSON` : `Imported ${set.items.length} questions - not saved (storage full)`);
    return true;
  } catch (err) {
    logImport('error', `importSetFromJsonObject: runtime failure: ${(err && err.name) || 'Error'}: ${(err && err.message) || String(err)}`, err);
    toast('Import failed. Check Console [IHBB Import]');
    return false;
  }
}
function importSetFromText(name, txt) {
  const items = parseQA(txt);
  if (!items.length) { toast('No questions detected'); return null; }
  const set = { id: uid(), name: name || `Imported ${new Date().toLocaleString()}`, items };
  Library.sets.unshift(set); Library.activeSetId = set.id; saveLibrary(); renderLibrarySelectors(); renderLibraryTable(); toast(`Loaded ${items.length} items`);
  return set;
}

/********************* Presets *********************/
function renderPresets() {
  const sel = $('presetSel'); if (!sel) return;
  sel.innerHTML = '<option value="">Load preset…</option>';
  for (const k of Object.keys(Presets)) { const o = document.createElement('option'); o.value = k; o.textContent = k; sel.appendChild(o); }
}
function setChipActive(groupId, value, attr = 'n') {
  document.querySelectorAll(`#${groupId} .chip`).forEach(el => {
    el.classList.toggle('active', el.dataset[attr] === String(value));
  });
}
function setLenFromPreset(size) {
  const chips = Array.from(document.querySelectorAll('#len-chips .chip'));
  chips.forEach(c => c.classList.remove('active'));
  let matched = chips.find(c => c.dataset.n === String(size) || (size === 'all' && c.dataset.n === 'all'));
  if (matched) {
    matched.classList.add('active');
    if (matched.dataset.n === 'custom') {
      const lc = $('len-custom'); if (lc) { lc.style.display = 'inline-block'; lc.value = typeof size === 'number' ? size : ''; }
      App.size = typeof size === 'number' ? clamp(size, 1, 500) : 10;
    } else {
      const lc = $('len-custom'); if (lc) lc.style.display = 'none';
      App.size = (matched.dataset.n === 'all') ? 'all' : Number(matched.dataset.n || 10);
    }
  } else {
    const customChip = chips.find(c => c.dataset.n === 'custom');
    if (customChip) customChip.classList.add('active');
    const lc = $('len-custom'); if (lc) { lc.style.display = 'inline-block'; lc.value = typeof size === 'number' ? size : ''; }
    App.size = typeof size === 'number' ? clamp(size, 1, 500) : 10;
  }
}
function updateFilterRowSafe() { try { updateFilterRow(); } catch { } }
function applyPreset(p) {
  if (!p) return;
  try {
    Settings.voice = p.voice; const vs = $('voiceSel'); if (vs) vs.value = p.voice;
    const rr = $('rate'); if (rr) rr.value = p.rate;
    Settings.strict = !!p.strict; const sm = $('strictMode'); if (sm) sm.checked = Settings.strict;
    Settings.autoAdvance = !!p.autoAdvance; const aa = $('autoAdvance'); if (aa) aa.checked = Settings.autoAdvance;
    const aad = $('autoAdvanceDelay'); if (aad) aad.value = p.autoAdvanceDelay || 1;
    Settings.cueTicks = !!p.cueTicks; const ct = $('cueTicks'); if (ct) ct.checked = Settings.cueTicks;
    Settings.cueBeep = !!p.cueBeep; const cb = $('cueBeep'); if (cb) cb.checked = Settings.cueBeep;
    Settings.haptics = !!p.haptics; const hp = $('haptics'); if (hp) hp.checked = Settings.haptics;
    App.mode = p.mode; setChipActive('mode-chips', p.mode, 'mode');
    if (p.size !== undefined) setLenFromPreset(p.size);
    if (p.filters) {
      // Merge with defaults to keep new keys like 'cats' and 'eras'
      App.filters = Object.assign({ cat: '', cats: [], era: '', eras: [], src: '' }, p.filters);
    }
    if (!Array.isArray(App.filters.eras)) App.filters.eras = App.filters.era ? [App.filters.era] : [];
    App.filters.era = App.filters.eras.length === 1 ? App.filters.eras[0] : '';
    updateFilterRowSafe(); saveSettings();
    // Sync chips to preset selection
    try {
      const set = getActiveSet();
      const cats = set ? [...new Set(set.items.map(it => it.meta?.category || '').filter(Boolean))] : [];
      const eras = set ? sortEraCodes([...new Set(set.items.map(it => it.meta?.era || '').filter(Boolean))]) : [];
      renderCategoryChips(cats);
      renderEraChips(eras);
    } catch { }
    updateSetupOverview();
  } catch { /* noop */ }
}

/********************* Pool build & UI helpers *********************/
function buildPool() {
  if (Array.isArray(App.sessionOverrideItems) && App.sessionOverrideItems.length) {
    App.pool = App.sessionOverrideItems.slice();
    return;
  }
  const set = getActiveSet(); if (!set) { App.pool = []; return; }
  let arr = set.items.slice();
  // Multi-category filter from Setup chips
  if (Array.isArray(App.filters.cats) && App.filters.cats.length) {
    arr = arr.filter(it => App.filters.cats.includes((it.meta?.category || '')));
  }
  if (App.filters.cat) arr = arr.filter(it => (it.meta?.category || '') === App.filters.cat);
  if (Array.isArray(App.filters.eras) && App.filters.eras.length) arr = arr.filter(it => App.filters.eras.includes((it.meta?.era || '')));
  else if (App.filters.era) arr = arr.filter(it => (it.meta?.era || '') === App.filters.era);
  if (App.filters.src) arr = arr.filter(it => (it.meta?.source || '') === App.filters.src);
  App.pool = arr;
}
const shuffle = (n) => [...Array(n).keys()].sort(() => Math.random() - 0.5);
function sampleIndices(n, k) { const idx = shuffle(n); return k === 'all' ? idx : idx.slice(0, Math.min(n, Number(k) || 10)); }
function updateHeader() {
  const t = $('drill-total'); if (t) t.textContent = App.order.length || '—';
  const c = $('drill-correct'); if (c) c.textContent = String(App.correct);
  const acc = App.order.length ? Math.round(App.correct / App.order.length * 100) + '%' : '—';
  const a = $('drill-acc'); if (a) a.textContent = acc;
  const p = $('drill-progress'); if (p) p.textContent = `${Math.min(App.i, App.order.length)} / ${App.order.length}`;
  const bf = $('barfill'); if (bf) bf.style.width = (App.order.length ? (App.i / App.order.length * 100) : 0) + '%';
}
function modeLabel(mode) {
  if (mode === 'sequential') return 'Sequential';
  if (mode === 'srs') return 'Wrong-bank (SRS)';
  return 'Random';
}
function sessionLengthLabel(size, set) {
  if (size === 'all') {
    const total = Number(set?.items?.length || App.pool.length || 0);
    return total ? `All ${total} questions` : 'All available questions';
  }
  const n = Number(size || 10);
  return `${n} question${n === 1 ? '' : 's'}`;
}
function compactVoiceName(name) {
  const raw = String(name || '').trim();
  if (!raw) return 'Auto voice';
  return raw
    .replace(/\s*•.*$/, '')
    .replace(/^Microsoft\s+/i, '')
    .replace(/\s+Online.*$/i, '')
    .trim() || raw;
}
function updateSetupOverview() {
  const set = getActiveSet();
  const cats = Array.isArray(App.filters.cats) ? App.filters.cats.filter(Boolean) : [];
  const eras = Array.isArray(App.filters.eras) ? App.filters.eras.filter(Boolean) : [];
  const setText = set ? `${set.name} (${set.items.length} items)` : 'No set loaded';
  const filterCats = cats.length
    ? `${cats.length} region${cats.length === 1 ? '' : 's'}`
    : (App.filters.cat ? App.filters.cat : 'All regions');
  const filterEras = eras.length
    ? `${eras.length} era${eras.length === 1 ? '' : 's'}`
    : (App.filters.era ? getEraName(App.filters.era) : 'All eras');
  const filterSrc = App.filters.src ? App.filters.src : 'All sources';
  const advancedSummary = [
    Settings.strict ? 'Strict spelling' : 'Flexible grading',
    Settings.autoAdvance ? `Auto-advance ${Settings.autoAdvanceDelay || 1}s` : 'Manual pacing',
    Settings.haptics ? 'Haptics on' : 'Haptics off'
  ].join(' • ');
  const lengthText = sessionLengthLabel(App.size, set);
  const filterSummary = `${filterCats} • ${filterEras} • ${filterSrc}`;

  const setEl = $('setup-summary-set'); if (setEl) setEl.textContent = setText;
  const modeEl = $('setup-summary-mode'); if (modeEl) modeEl.textContent = modeLabel(App.mode);
  const lengthEl = $('setup-summary-length'); if (lengthEl) lengthEl.textContent = lengthText;
  const filtersEl = $('setup-summary-filters'); if (filtersEl) filtersEl.textContent = filterSummary;
  const advEl = $('setup-summary-advanced'); if (advEl) advEl.textContent = advancedSummary;

  const pills = $('setup-summary-advanced-pills');
  if (pills) {
    const voiceLabel = compactVoiceName(Settings.voice || ($('voiceSel') && $('voiceSel').value));
    const rateLabel = `Rate ${rate().toFixed(2)}x`;
    const tickLabel = Settings.cueTicks ? 'Countdown ticks' : 'Silent countdown';
    const cueLabel = Settings.cueBeep ? 'Feedback cues on' : 'Feedback cues off';
    pills.innerHTML = [voiceLabel, rateLabel, tickLabel, cueLabel]
      .map(label => `<div class="summary-pill">${escHtml(label)}</div>`)
      .join('');
  }

  const nextEl = $('setup-summary-next');
  let nextText = 'Choose a set and tighten filters only if you want a more focused drill.';
  if (nextEl) {
    if (!set) {
      nextText = 'Upload or reload questions.json to unlock the full drill builder.';
    } else if (App.mode === 'srs' && !wrongRecords().length) {
      nextText = 'Wrong-bank mode becomes useful after you miss questions in a regular session.';
    } else if (cats.length || App.filters.cat || eras.length || App.filters.era || App.filters.src) {
      nextText = 'This session is ready. Start now or save the combination as a preset for later.';
    }
    nextEl.textContent = nextText;
  }

  const mobileSummaryEl = $('setup-mobile-summary');
  if (mobileSummaryEl) {
    mobileSummaryEl.textContent = set
      ? `${lengthText} • ${filterCats} • ${filterSrc}`
      : 'Load or reload a question set to unlock a drill.';
  }
  const mobileModeEl = $('setup-mobile-mode'); if (mobileModeEl) mobileModeEl.textContent = modeLabel(App.mode);
  const mobileNextEl = $('setup-mobile-next'); if (mobileNextEl) mobileNextEl.textContent = nextText;
  const mobileDockModeEl = $('setup-mobile-dock-mode'); if (mobileDockModeEl) mobileDockModeEl.textContent = modeLabel(App.mode);
  const mobileDockSummaryEl = $('setup-mobile-dock-summary');
  if (mobileDockSummaryEl) {
    mobileDockSummaryEl.textContent = set
      ? `${lengthText} • ${filterCats} • ${filterSrc}`
      : 'Load or reload a question set to unlock a drill.';
  }
  updateSetupMobileDock();
  renderCoachChatChrome();
}

function updateSetupMobileDock() {
  const dock = $('setup-mobile-dock');
  if (!dock) return;
  const activeViewId = document.querySelector('.view.active')?.id || '';
  const showDock = shouldRenderMobileRecordLists() && activeViewId === 'view-setup';
  dock.hidden = !showDock;
}

function setPracticeButtons({ buzz, next, right, wrong, replay, alias, flag }) {
  const bz = $('btn-buzz'); if (bz) bz.disabled = !buzz;
  const nx = $('btn-next'); if (nx) nx.disabled = !next;
  const r = $('btn-right'); if (r) r.disabled = !right;
  const w = $('btn-wrong'); if (w) w.disabled = !wrong;
  const rp = $('btn-replay'); if (rp) rp.disabled = !replay;
  const al = $('btn-alias'); if (al) al.disabled = !alias;
  const fl = $('btn-flag'); if (fl) fl.disabled = !flag;
}
function setPracticeAuxControlsDisabled(disabled) {
  const pause = $('btn-pause'); if (pause) pause.disabled = !!disabled;
  const quit = $('btn-quit'); if (quit) quit.disabled = !!disabled;
  const copy = $('btn-copy-answer'); if (copy) copy.disabled = !!disabled;
}
function lockPracticeDuringGrade() {
  const bz = $('btn-buzz'); if (bz) bz.classList.remove('pulse');
  setPracticeButtons({ buzz: false, next: false, right: false, wrong: false, replay: false, alias: false, flag: false });
  setPracticeAuxControlsDisabled(true);
}
function unlockPracticeAfterGrade() {
  setPracticeAuxControlsDisabled(false);
}

/********************* SRS *********************/
function getSRS() { try { return JSON.parse(localStorage.getItem(KEY_WRONG) || '{}'); } catch { return {}; } }
function setSRS(s) { localStorage.setItem(KEY_WRONG, JSON.stringify(s)); }
function makeDefaultSRSRecord() {
  const now = Date.now();
  return { box: 1, dueAt: now, lastSeen: now, lapses: 0, answer: '', aliases: [], q: '' };
}
function syncWrongIdsAdd(ids) {
  const qids = normalizeQuestionIds(ids);
  if (!qids.length) return;
  queueWrongSync(async (sb, userId) => {
    const rows = qids.map(question_id => ({ user_id: userId, question_id }));
    const { error } = await sb.from(WRONG_SYNC_TABLE).upsert(rows, { onConflict: 'user_id,question_id' });
    if (error) throw error;
  });
}
function syncWrongIdsDelete(ids) {
  const qids = normalizeQuestionIds(ids);
  if (!qids.length) return;
  queueWrongSync(async (sb, userId) => {
    const { error } = await sb.from(WRONG_SYNC_TABLE).delete().eq('user_id', userId).in('question_id', qids);
    if (error) throw error;
  });
}
function syncWrongIdsClearAll() {
  queueWrongSync(async (sb, userId) => {
    const { error } = await sb.from(WRONG_SYNC_TABLE).delete().eq('user_id', userId);
    if (error) throw error;
  });
}
async function initWrongBankSync() {
  if (!window.supabaseClient || !WrongSync.enabled) return;
  try {
    const { data, error } = await window.supabaseClient.auth.getSession();
    if (error) throw error;
    const userId = data?.session?.user?.id || null;
    if (!userId) return;
    WrongSync.userId = userId;
    SessionSync.userId = userId;
    CoachSync.userId = userId;

    const { data: remoteRows, error: remoteErr } = await window.supabaseClient
      .from(WRONG_SYNC_TABLE)
      .select('question_id')
      .eq('user_id', userId);
    if (remoteErr) throw remoteErr;

    let remoteIds = normalizeQuestionIds((remoteRows || []).map(r => r.question_id));
    const local = getSRS();
    const localIds = normalizeQuestionIds(Object.keys(local));
    const seen = getWrongSyncSeen(userId);

    // First successful sync on this device: migrate existing local wrong-bank if cloud is still empty.
    if (!seen && !remoteIds.length && localIds.length) {
      const rows = localIds.map(question_id => ({ user_id: userId, question_id }));
      const { error: upErr } = await window.supabaseClient
        .from(WRONG_SYNC_TABLE)
        .upsert(rows, { onConflict: 'user_id,question_id' });
      if (upErr) throw upErr;
      remoteIds = localIds.slice();
    }

    // Cloud becomes source of truth after sync is enabled.
    const remoteSet = new Set(remoteIds);
    let changed = false;
    for (const id of Object.keys(local)) {
      if (!remoteSet.has(id)) { delete local[id]; changed = true; }
    }
    for (const id of remoteIds) {
      if (!local[id]) { local[id] = makeDefaultSRSRecord(); changed = true; }
    }
    if (changed) setSRS(local);

    setWrongSyncSeen(userId);
    WrongSync.ready = true;
    renderWrongBank();
  } catch (err) {
    handleWrongSyncError(err);
  }
}
function srsAddWrong(item) {
  const qid = normalizeQuestionId(item?.id);
  if (!qid) return;
  const s = getSRS(); const now = Date.now();
  if (!s[qid]) s[qid] = { box: 1, dueAt: now, lastSeen: now, lapses: 0, answer: item.answer, aliases: item.aliases || [], q: item.question };
  else { s[qid].box = 1; s[qid].dueAt = now; s[qid].lastSeen = now; s[qid].lapses = (s[qid].lapses || 0) + 1; s[qid].answer = item.answer; s[qid].q = item.question; }
  setSRS(s);
  syncWrongIdsAdd([qid]);
}
const BOX_DELAY = { 1: 0, 2: 24 * 3600 * 1000, 3: 3 * 24 * 3600 * 1000, 4: 7 * 24 * 3600 * 1000, 5: 14 * 24 * 3600 * 1000 };
function srsMark(itemId, isRight) {
  const s = getSRS(); const now = Date.now(); const rec = s[itemId]; if (!rec) return;
  if (isRight) { rec.box = Math.min(5, (rec.box || 1) + 1); rec.dueAt = now + (BOX_DELAY[rec.box] || 0); }
  else { rec.box = 1; rec.dueAt = now; rec.lapses = (rec.lapses || 0) + 1; }
  rec.lastSeen = now; setSRS(s);
}
function srsDueList() { const s = getSRS(); const now = Date.now(); return Object.entries(s).filter(([_, rec]) => (rec.dueAt || 0) <= now).map(([id]) => id); }
function srsBuildPseudoItems(ids) { const s = getSRS(); return ids.map(id => ({ id, question: (s[id]?.q) || '(Question audio only)', answer: (s[id]?.answer) || '(answer)', aliases: (s[id]?.aliases) || [], meta: { category: '', era: '', source: '' } })); }

/********************* Session Flow *********************/
function startSession() {
  const set = getActiveSet(); if (!set && App.mode !== 'srs') { toast('No active set'); return; }
  App.correct = 0; App.sessionBuzzTimes = []; App.resultsCorrect = []; App.i = 0; App.phase = 'idle';
  App.sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  App.submitBusy = false;
  clearCoachCard();
  const ans = $('answer'); if (ans) ans.textContent = '';
  const cd = $('countdown'); if (cd) cd.textContent = '';
  const st = $('status'); if (st) st.textContent = 'Preparing…';
  const bt = $('buzz-time'); if (bt) bt.textContent = '—';
  unlockPracticeAfterGrade();
  const cp = $('btn-copy-answer'); if (cp) cp.disabled = true;
  if (App._cdIv) { clearInterval(App._cdIv); App._cdIv = null; }

  if (App.mode === 'srs') {
    const dueIds = srsDueList();
    const map = set ? new Map(set.items.map(it => [it.id, it])) : new Map();
    let pool = dueIds.map(id => map.get(id) || null).filter(Boolean);
    const missingIds = dueIds.filter(id => !map.has(id));
    pool = pool.concat(srsBuildPseudoItems(missingIds));
    if (!pool.length) {
      const s = getSRS(); const allIds = Object.keys(s); if (!allIds.length) { toast('Wrong bank empty'); return; }
      const found = allIds.map(id => map.get(id) || null).filter(Boolean);
      const miss = allIds.filter(id => !map.has(id));
      pool = found.concat(srsBuildPseudoItems(miss));
    }
    App.pool = pool; App.order = sampleIndices(App.pool.length, App.size);
  } else {
    buildPool(); if (!App.pool.length) { toast('No items in pool with current filters'); return; }
    if (App.mode === 'sequential') {
      const total = App.pool.length;
      const want = App.size === 'all' ? total : Math.min(total, Number(App.size) || 10);
      App.order = [...Array(total).keys()].slice(0, want);
    } else {
      App.order = sampleIndices(App.pool.length, App.size);
    }
  }
  App.sessionOverrideItems = null;

  App.startTs = performance.now();
  updateHeader();
  navSet('nav-practice'); SHOW('view-practice');
  playFeedbackCue('start');
  // Auto-scroll to the bottom of the practice view
  setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 150);
  nextQuestion(true);
}

async function nextQuestion(first = false) {
  stopSpeech(); App.readingAbort = false;
  App.submitBusy = false;
  clearCoachCard();
  const ans = $('answer'); if (ans) ans.textContent = '';
  const cd = $('countdown'); if (cd) cd.textContent = '';
  const bt = $('buzz-time'); if (bt) bt.textContent = '—';
  unlockPracticeAfterGrade();
  const cp = $('btn-copy-answer'); if (cp) cp.disabled = true;
  if (App._cdIv) { clearInterval(App._cdIv); App._cdIv = null; }

  if (!first) App.i++;
  if (App.i >= App.order.length) { finishSession(); return; }
  if (!first) playFeedbackCue('next', { haptic: false });
  updateHeader();

  const item = App.pool[App.order[App.i]]; App.curItem = item; App.phase = 'reading';
  const st = $('status'); if (st) st.textContent = Settings.strict ? 'Reading… (strict mode)' : 'Reading…';
  setPracticeButtons({ buzz: true, next: true, right: false, wrong: false, replay: false, alias: false, flag: true });
  const nx = $('btn-next'); if (nx) nx.disabled = true;
  const bz = $('btn-buzz'); if (bz) bz.classList.add('pulse');

  App.buzzStart = performance.now(); App.buzzAt = null;
  await readProgressive(item.question);
  if (App.phase !== 'reading') return;
  startCountdown(5);
}

function startCountdown(sec) {
  App.phase = 'countdown';
  let t = clamp(sec, 1, 30);
  const cd = $('countdown'); if (cd) cd.textContent = `${t}`;
  setPracticeButtons({ buzz: false, next: false, right: false, wrong: false, replay: false, alias: false, flag: false });

  const iv = setInterval(() => {
    t--;
    if (Settings.cueTicks) beep(660, 0.06);
    if (Settings.haptics) vibrate(12);
    if (t <= 0) {
      clearInterval(iv); App._cdIv = null;
      const cd2 = $('countdown'); if (cd2) cd2.textContent = '';
      if (Settings.cueBeep) beep(1040, 0.12);
      showAnswer();
    } else {
      const cd3 = $('countdown'); if (cd3) cd3.textContent = `${t}`;
    }
  }, 1000);
  App._cdIv = iv;
}

function buzz() {
  if (App.phase !== 'reading') return;
  App.readingAbort = true; stopSpeech(); App.phase = 'countdown';
  const ms = performance.now() - App.buzzStart; App.buzzAt = ms / 1000;
  const bt = $('buzz-time'); if (bt) bt.textContent = `${App.buzzAt.toFixed(2)}s`;
  const bz = $('btn-buzz'); if (bz) bz.classList.remove('pulse');
  playFeedbackCue('buzz');
  startCountdown(5);
}

function showAnswer() {
  App.phase = 'answering';
  const item = App.curItem;
  const ansText = Settings.strict ? `标准答案：${item.answer}` :
    `标准答案：${item.answer}${(item.aliases?.length ? `  (aliases: ${item.aliases.slice(0, 3).join(' • ')})` : '')}`;
  const ans = $('answer'); if (ans) ans.textContent = ansText;
  playFeedbackCue('reveal');
  speakOnce(`标准答案：${item.answer}`, curVoice(), rate(), 1.0, 12000);
  unlockPracticeAfterGrade();
  setPracticeButtons({ buzz: false, next: false, right: true, wrong: true, replay: true, alias: true, flag: true });
  const cp = $('btn-copy-answer'); if (cp) cp.disabled = false;
}

function markRight() {
  if (App.phase !== 'answering') return;
  playFeedbackCue('correct');
  App.correct++; App.resultsCorrect.push(true); App.sessionBuzzTimes.push(App.buzzAt || 0); finishMark(true);
}
function markWrong() {
  if (App.phase !== 'answering') return;
  playFeedbackCue('wrong');
  srsAddWrong(App.curItem); App.resultsCorrect.push(false); App.sessionBuzzTimes.push(App.buzzAt || 0); finishMark(false);
}

function finishMark(isRight) {
  unlockPracticeAfterGrade();
  if (App.mode === 'srs') srsMark(App.curItem.id, isRight);
  if (Settings.autoAdvance) {
    setPracticeButtons({ buzz: false, next: false, right: false, wrong: false, replay: true, alias: true, flag: true });
    const delay = clamp(parseInt(($('autoAdvanceDelay') && $('autoAdvanceDelay').value) || '1', 10), 0, 5);
    setTimeout(() => { nextQuestion(false); }, delay * 1000);
  } else {
    setPracticeButtons({ buzz: false, next: true, right: false, wrong: false, replay: true, alias: true, flag: true });
    const nx = $('btn-next'); if (nx) nx.disabled = false;
  }
  updateHeader();
}

function finishSession() {
  stopSpeech(); if (App._cdIv) { clearInterval(App._cdIv); App._cdIv = null; }
  App.phase = 'done';
  playFeedbackCue('finish');
  const durSec = (performance.now() - App.startTs) / 1000;
  const total = App.order.length, correct = App.correct, acc = total ? Math.round(correct / total * 100) : 0;
  const st = $('status'); if (st) st.textContent = `Complete — ${correct}/${total} (${acc}%).`;
  setPracticeButtons({ buzz: false, next: false, right: false, wrong: false, replay: false, alias: false, flag: false });
  pushSession(total, correct, durSec, App.sessionBuzzTimes, App.pool, App.order, App.resultsCorrect, App.sessionId);
  navSet('nav-review'); SHOW('view-review'); renderHistory(); renderWrongBank(); drawCharts();
  void refreshCoachNotebook(false).then(() => {
    renderCoachChatChrome();
    maybeAutoOpenCoachChat('review');
  });
}

function pushSession(total, correct, durSec, buzzTimes, pool, order, results, sessionId = null) {
  const arr = JSON.parse(localStorage.getItem(KEY_SESS) || '[]');
  const itemIds = order.map(i => pool[i]?.id).filter(Boolean);
  const res = results.slice(0, itemIds.length);
  const meta = order.slice(0, itemIds.length).map(i => {
    const it = pool[i] || {};
    return {
      category: it.meta?.category || '',
      era: it.meta?.era || '',
      source: it.meta?.source || ''
    };
  });
  const record = {
    sid: String(sessionId || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    ts: Date.now(),
    total,
    correct,
    acc: total ? Math.round(correct / total * 100) : 0,
    dur: Math.round(durSec),
    buzz: buzzTimes,
    items: itemIds,
    results: res,
    meta
  };
  arr.unshift(record);
  localStorage.setItem(KEY_SESS, JSON.stringify(arr.slice(0, 200)));
  syncSessionRecord(record);
}

function normalizeSessionRecordForSync(record) {
  const buzz = Array.isArray(record?.buzz) ? record.buzz.map(x => Number(x)).filter(x => Number.isFinite(x)) : [];
  const items = Array.isArray(record?.items) ? record.items.map(x => String(x || '').trim()).filter(Boolean) : [];
  const results = Array.isArray(record?.results) ? record.results.map(x => !!x).slice(0, items.length) : [];
  const meta = Array.isArray(record?.meta) ? record.meta.slice(0, items.length).map(m => ({
    category: String(m?.category || ''),
    era: String(m?.era || ''),
    source: String(m?.source || '')
  })) : [];
  const total = Number(record?.total) || 0;
  const correct = Number(record?.correct) || 0;
  return {
    sid: String(record?.sid || '').trim() || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: Number(record?.ts) || Date.now(),
    total,
    correct,
    dur: Number(record?.dur) || 0,
    buzz,
    items,
    results,
    meta
  };
}

function syncSessionRecord(record) {
  const safe = normalizeSessionRecordForSync(record);
  queueSessionSync(async (sb, userId) => {
    const { error } = await sb
      .from(SESSION_SYNC_TABLE)
      .upsert({
        user_id: userId,
        client_session_id: safe.sid,
        ts: safe.ts,
        total: safe.total,
        correct: safe.correct,
        dur: safe.dur,
        buzz: safe.buzz,
        items: safe.items,
        results: safe.results,
        meta: safe.meta
      }, { onConflict: 'user_id,client_session_id' });
    if (error) throw error;
  });
}

function backfillLocalSessionsToCloud() {
  queueSessionSync(async (sb, userId) => {
    if (getSessSyncSeen(userId)) return;
    const raw = JSON.parse(localStorage.getItem(KEY_SESS) || '[]');
    const arr = Array.isArray(raw) ? raw : [];
    if (!arr.length) { setSessSyncSeen(userId); return; }
    const rows = arr.slice(0, 200).map((rec, idx) => {
      const safe = normalizeSessionRecordForSync(rec);
      const sid = safe.sid || `legacy_${safe.ts}_${idx}`;
      return {
        user_id: userId,
        client_session_id: sid,
        ts: safe.ts,
        total: safe.total,
        correct: safe.correct,
        dur: safe.dur,
        buzz: safe.buzz,
        items: safe.items,
        results: safe.results,
        meta: safe.meta
      };
    });
    const { error } = await sb.from(SESSION_SYNC_TABLE).upsert(rows, { onConflict: 'user_id,client_session_id' });
    if (error) throw error;
    setSessSyncSeen(userId);
  });
}

function normalizeCoachAttemptRecord(record) {
  if (!isNotebookAttemptRecord(record)) return null;
  const coach = normalizeCoach(record?.coach, {
    question: record?.question_text || '',
    meta: {
      category: record?.category || '',
      era: record?.era || '',
      source: record?.source || ''
    }
  }, !!record?.correct, String(record?.reason || ''));
  return {
    client_attempt_id: String(record?.client_attempt_id || '').trim() || `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    client_session_id: String(record?.client_session_id || '').trim(),
    question_id: String(record?.question_id || '').trim(),
    question_text: String(record?.question_text || '').trim(),
    expected_answer: String(record?.expected_answer || '').trim(),
    user_answer: String(record?.user_answer || '').trim(),
    correct: !!record?.correct,
    reason: String(record?.reason || '').trim(),
    coach,
    category: String(record?.category || coach?.study_focus?.region || ''),
    era: String(record?.era || coach?.study_focus?.era || ''),
    source: String(record?.source || ''),
    focus_topic: String(record?.focus_topic || coach?.study_focus?.topic || ''),
    mastered: !!record?.mastered,
    mastered_at: record?.mastered_at || null,
    created_at: record?.created_at || new Date().toISOString()
  };
}

function syncCoachAttempt(record) {
  const safe = normalizeCoachAttemptRecord(record);
  if (!safe) return;
  enqueueCoachPending(safe);
  queueCoachSync(async (sb, userId) => {
    const { error } = await sb.from(COACH_SYNC_TABLE).upsert({
      user_id: userId,
      client_attempt_id: safe.client_attempt_id,
      client_session_id: safe.client_session_id || null,
      question_id: safe.question_id || null,
      question_text: safe.question_text,
      expected_answer: safe.expected_answer,
      user_answer: safe.user_answer,
      correct: safe.correct,
      reason: safe.reason,
      coach: safe.coach,
      category: safe.category,
      era: safe.era,
      source: safe.source,
      focus_topic: safe.focus_topic,
      mastered: safe.mastered,
      mastered_at: safe.mastered_at
    }, { onConflict: 'user_id,client_attempt_id' });
    if (error) throw error;
    removeCoachPending(safe.client_attempt_id);
  });
}

function flushCoachPending() {
  const pending = getCoachPending();
  if (!pending.length) return;
  queueCoachSync(async (sb, userId) => {
    const rows = pending.map(x => {
      const safe = normalizeCoachAttemptRecord(x);
      if (!safe) return null;
      return {
        user_id: userId,
        client_attempt_id: safe.client_attempt_id,
        client_session_id: safe.client_session_id || null,
        question_id: safe.question_id || null,
        question_text: safe.question_text,
        expected_answer: safe.expected_answer,
        user_answer: safe.user_answer,
        correct: safe.correct,
        reason: safe.reason,
        coach: safe.coach,
        category: safe.category,
        era: safe.era,
        source: safe.source,
        focus_topic: safe.focus_topic,
        mastered: safe.mastered,
        mastered_at: safe.mastered_at
      };
    }).filter(Boolean);
    if (!rows.length) {
      setCoachPending([]);
      return;
    }
    const { error } = await sb.from(COACH_SYNC_TABLE).upsert(rows, { onConflict: 'user_id,client_attempt_id' });
    if (error) throw error;
    setCoachPending([]);
  });
}

async function fetchCoachNotebookRecords(forceCloud = false) {
  if (window.supabaseClient && CoachSync.enabled) {
    try {
      const userId = await ensureCoachSyncUserId();
      if (userId) {
        const { data, error } = await window.supabaseClient
          .from(COACH_SYNC_TABLE)
          .select('client_attempt_id,client_session_id,question_id,question_text,expected_answer,user_answer,correct,reason,coach,category,era,source,focus_topic,mastered,mastered_at,created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(200);
        if (error) throw error;
        const recs = (Array.isArray(data) ? data : []).map(normalizeCoachAttemptRecord).filter(Boolean);
        CoachNotebook.records = recs;
        setCoachLocal(recs);
        CoachNotebook.loaded = true;
        return recs;
      }
    } catch (err) {
      if (forceCloud) handleCoachSyncError(err);
      console.warn('Coach notebook cloud fetch failed; using local.', err);
    }
  }
  const local = getCoachLocal().map(normalizeCoachAttemptRecord).filter(Boolean);
  CoachNotebook.records = local;
  CoachNotebook.loaded = true;
  return local;
}

function renderCoachNotebook() {
  const listEl = $('coach-list');
  if (!listEl) return;
  const countEl = $('coach-count');
  const openCountEl = $('coach-open-count');
  const masteredCountEl = $('coach-mastered-count');
  const clearBtn = $('btn-coach-clear');
  const q = (($('coach-search') && $('coach-search').value) || '').trim().toLowerCase();
  const filter = (($('coach-filter') && $('coach-filter').value) || 'todo').toLowerCase();
  const allRows = Array.isArray(CoachNotebook.records) ? CoachNotebook.records : [];
  if (countEl) countEl.textContent = String(allRows.length);
  if (openCountEl) openCountEl.textContent = String(allRows.filter(r => !r.mastered).length);
  if (masteredCountEl) masteredCountEl.textContent = String(allRows.filter(r => !!r.mastered).length);
  if (clearBtn) clearBtn.disabled = !allRows.length;
  const rows = allRows.filter(r => {
    if (filter === 'todo' && r.mastered) return false;
    if (filter === 'mastered' && !r.mastered) return false;
    if (!q) return true;
    const hay = `${r.question_text} ${r.expected_answer} ${r.user_answer} ${r.reason} ${r.focus_topic} ${r.category} ${r.era}`.toLowerCase();
    return hay.includes(q);
  });
  if (!rows.length) {
    listEl.innerHTML = `<div class="coach-empty">No coach lessons found.</div>`;
    renderSetupCoachGuide();
    renderSessionCoachDebrief();
    renderCoachChatChrome();
    return;
  }
  listEl.innerHTML = rows.map(r => {
    const coach = normalizeCoach(r.coach, { question: r.question_text, meta: { category: r.category, era: r.era, source: r.source } }, r.correct, r.reason);
    const focus = coach.study_focus || {};
    const created = r.created_at ? new Date(r.created_at).toLocaleString() : '—';
    return `
      <div class="coach-note ${r.mastered ? 'mastered' : ''}" data-attempt="${escHtml(r.client_attempt_id)}">
        <div class="coach-note-head">
          <div class="coach-note-icon">${escHtml(focus.icon || '📘')}</div>
          <div class="coach-note-meta">
            <div><b>${r.correct ? '✓ Correct' : '✗ Incorrect'}</b> • ${escHtml(created)}</div>
            <div class="muted">${escHtml(focus.region || 'World')} ${focus.era ? '• ' + escHtml(focus.era) : ''} ${focus.topic ? '• ' + escHtml(focus.topic) : ''}</div>
          </div>
        </div>
        <details>
          <summary>${escHtml((r.question_text || '').slice(0, 180))}${(r.question_text || '').length > 180 ? '…' : ''}</summary>
          <div class="coach-note-body">
            <div><b>Your answer:</b> ${escHtml(r.user_answer || '(blank)')}</div>
            <div><b>Expected:</b> ${escHtml(r.expected_answer || '')}</div>
            <div><b>Summary:</b> ${escHtml(coach.summary || '')}</div>
            <div><b>Error Diagnosis:</b> ${escHtml(coach.error_diagnosis || '')}</div>
            <div><b>Overlap Explainer:</b> ${escHtml(coach.overlap_explainer || '')}</div>
            <div><b>Why This Answer Fits:</b>${coachListHtml(coach.explanation_bullets || [])}</div>
            <div><b>Key Clues:</b>${coachListHtml(coach.key_clues || [])}</div>
            <div><b>Related Facts:</b>${coachListHtml(coach.related_facts || [])}</div>
            <div><b>Study Tip:</b> ${escHtml(coach.study_tip || '')}</div>
            ${coachWikiHtml(coach)}
            <div class="coach-note-actions">
              <button class="btn pri coach-apply-note-focus" type="button" data-attempt="${escHtml(r.client_attempt_id)}">Practice this focus</button>
              <button class="btn ghost coach-toggle-mastered" data-mastered="${r.mastered ? '1' : '0'}" data-attempt="${escHtml(r.client_attempt_id)}">${r.mastered ? 'Unmark Mastered' : 'Mark Mastered'}</button>
            </div>
          </div>
        </details>
      </div>
    `;
  }).join('');
  renderSetupCoachGuide();
  renderSessionCoachDebrief();
  renderCoachChatChrome();
}

async function refreshCoachNotebook(forceCloud = false) {
  await fetchCoachNotebookRecords(forceCloud);
  renderCoachNotebook();
}

function setCoachMasteredLocal(attemptId, mastered) {
  const id = String(attemptId || '');
  if (!id) return null;
  const local = getCoachLocal();
  const idx = local.findIndex(x => String(x?.client_attempt_id || '') === id);
  if (idx === -1) return null;
  local[idx].mastered = !!mastered;
  local[idx].mastered_at = mastered ? new Date().toISOString() : null;
  setCoachLocal(local);
  return local[idx];
}

function toggleCoachMastered(attemptId, mastered) {
  const id = String(attemptId || '');
  if (!id) return;
  const idx = CoachNotebook.records.findIndex(x => String(x?.client_attempt_id || '') === id);
  if (idx === -1) return;
  CoachNotebook.records[idx].mastered = !!mastered;
  CoachNotebook.records[idx].mastered_at = mastered ? new Date().toISOString() : null;
  const updated = setCoachMasteredLocal(id, mastered);
  playFeedbackCue(mastered ? 'mastered' : 'unmastered');
  renderCoachNotebook();
  if (!updated) return;
  syncCoachAttempt(updated);
}

/********************* Review & Wrong bank *********************/
function shouldRenderMobileRecordLists() {
  return !!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches);
}

function mobileRecordPills(entries = []) {
  return entries
    .filter(([_, value]) => value === 0 || String(value || '').trim())
    .map(([label, value]) => `
      <span class="mobile-record-pill">
        <span class="mobile-record-pill-label">${escHtml(label)}</span>
        <span>${escHtml(String(value))}</span>
      </span>
    `)
    .join('');
}

function mobileRecordCard({ eyebrow = '', title = '', pills = [], details = [], actionHtml = '' } = {}) {
  const pillsHtml = mobileRecordPills(pills);
  const detailsHtml = details
    .filter(detail => String(detail || '').trim())
    .map(detail => `<p class="mobile-record-detail">${detail}</p>`)
    .join('');
  return `
    <article class="mobile-record-card">
      ${eyebrow ? `<div class="mobile-record-eyebrow">${escHtml(eyebrow)}</div>` : ''}
      <h3 class="mobile-record-title">${escHtml(String(title || '').trim() || 'Untitled')}</h3>
      ${pillsHtml ? `<div class="mobile-record-pills">${pillsHtml}</div>` : ''}
      ${detailsHtml ? `<div class="mobile-record-details">${detailsHtml}</div>` : ''}
      ${actionHtml ? `<div class="mobile-record-actions">${actionHtml}</div>` : ''}
    </article>
  `;
}

function renderMobileRecordList(containerId, cards, emptyTitle, emptyCopy) {
  const container = $(containerId);
  if (!container) return;
  if (!shouldRenderMobileRecordLists()) {
    container.innerHTML = '';
    return;
  }
  if (!cards.length) {
    container.innerHTML = `
      <div class="list-empty mobile-record-empty">
        <div class="empty-kicker">${escHtml(emptyTitle)}</div>
        <p class="empty-copy">${escHtml(emptyCopy)}</p>
      </div>
    `;
    return;
  }
  container.innerHTML = cards.join('');
}

function renderHistory() {
  const arr = JSON.parse(localStorage.getItem(KEY_SESS) || '[]');
  const tb = document.querySelector('#tbl-history tbody'); if (!tb) return;
  tb.innerHTML = '';
  if (arr[0]) {
    $('r-last-total').textContent = arr[0].total;
    $('r-last-correct').textContent = arr[0].correct;
    $('r-last-acc').textContent = arr[0].acc + '%';
    $('r-last-dur').textContent = prettyDur(arr[0].dur);
  } else {
    $('r-last-total').textContent = '—';
    $('r-last-correct').textContent = '—';
    $('r-last-acc').textContent = '—';
    $('r-last-dur').textContent = '—';
  }
  const mobileCards = [];
  for (const s of arr) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${fmtDate(s.ts)}</td><td>${s.total}</td><td>${s.correct}</td><td>${s.acc}%</td><td>${prettyDur(s.dur)}</td><td><button class='btn ghost' data-replay='${s.ts}'>Repeat</button></td>`;
    tb.appendChild(tr);
    mobileCards.push(mobileRecordCard({
      eyebrow: fmtDate(s.ts),
      title: `${s.correct}/${s.total} correct`,
      pills: [
        ['Accuracy', `${s.acc}%`],
        ['Duration', prettyDur(s.dur)]
      ],
      details: [
        `Finished on ${escHtml(fmtDate(s.ts))}.`
      ],
      actionHtml: `<button class="btn ghost" data-replay="${escHtml(String(s.ts))}">Repeat</button>`
    }));
  }
  const bindRepeatButtons = (root) => {
    root?.querySelectorAll('button[data-replay]').forEach(b => b.onclick = () => repeatSession(b.dataset.replay));
  };
  bindRepeatButtons(tb);
  renderMobileRecordList('history-mobile-list', mobileCards, 'No history yet', 'Complete a drill to store a replayable session here.');
  bindRepeatButtons($('history-mobile-list'));
}

function repeatSession(ts) {
  const arr = JSON.parse(localStorage.getItem(KEY_SESS) || '[]');
  const s = arr.find(x => String(x.ts) === String(ts));
  if (!s) { toast('Session not found'); return; }
  const set = getActiveSet();
  const map = set ? new Map(set.items.map(it => [it.id, it])) : new Map();
  App.mode = 'random'; setChipActive('mode-chips', 'random', 'mode');
  App.pool = s.items.map(id => map.get(id)).filter(Boolean);
  App.order = [...Array(App.pool.length).keys()];
  App.size = App.pool.length;
  startSession();
}

function wrongRecords() {
  const s = getSRS(); const set = getActiveSet(); const map = set ? new Map(set.items.map(it => [it.id, it])) : new Map();
  return Object.entries(s).map(([id, rec]) => ({ id, rec, item: map.get(id) || null }));
}

function renderWrongBank() {
  const recs = wrongRecords();
  const wc = $('wrong-count'); if (wc) wc.textContent = String(recs.length);
  const due = srsDueList().length; const dt = $('due-today'); if (dt) dt.textContent = String(due);
  const q = (($('wrong-search') && $('wrong-search').value) || '').toLowerCase();
  const tb = document.querySelector('#tbl-wrong tbody'); if (!tb) return; tb.innerHTML = '';
  const mobileCards = [];
  for (const { id, rec, item } of recs) {
    const ans = (item?.answer) || rec.answer || '';
    if (q && !ans.toLowerCase().includes(q)) continue;
    const dueTxt = rec.dueAt ? new Date(rec.dueAt).toLocaleDateString() : '—';
    const aliases = (rec.aliases?.length ? rec.aliases : (item?.aliases || []));
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${ans}</td><td class='stat'>${rec.box || 1}</td><td>${dueTxt}</td><td>${(aliases || []).slice(0, 3).join(', ')}</td><td><button class='btn ghost' data-del='${id}'>Delete</button></td>`;
    tb.appendChild(tr);
    mobileCards.push(mobileRecordCard({
      eyebrow: 'Wrong-bank item',
      title: ans,
      pills: [
        ['Box', rec.box || 1],
        ['Due', dueTxt]
      ],
      details: [
        (aliases || []).length ? `Aliases: ${escHtml((aliases || []).slice(0, 3).join(', '))}` : 'Aliases: —'
      ],
      actionHtml: `<button class="btn ghost" data-del="${escHtml(String(id))}">Delete</button>`
    }));
  }
  const bindDeleteButtons = (root) => {
    root?.querySelectorAll('button[data-del]').forEach(b => b.onclick = () => {
      const id = normalizeQuestionId(b.dataset.del);
      if (!id) return;
      const s = getSRS();
      delete s[id];
      setSRS(s);
      syncWrongIdsDelete([id]);
      renderWrongBank();
    });
  };
  bindDeleteButtons(tb);
  renderMobileRecordList('wrong-mobile-list', mobileCards, 'Wrong-bank is empty', 'Miss a question in practice and it will show up here for spaced repetition.');
  bindDeleteButtons($('wrong-mobile-list'));
  renderCoachChatChrome();
}

function reviewMissedNow() {
  const recs = wrongRecords().sort((a, b) => (a.rec.dueAt || 0) - (b.rec.dueAt || 0));
  if (!recs.length) { toast('Wrong bank empty'); return; }
  App.mode = 'srs'; setChipActive('mode-chips', 'srs', 'mode'); startSession();
}

function exportWrong() {
  const recs = wrongRecords();
  const content = recs.map(x => `Question: ${(x.item?.question) || x.rec.q || '(audio-only)'}\n标准答案: ${(x.item?.answer) || x.rec.answer}\n`).join('\n');
  const blob = new Blob([content || '（空）'], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'wrong_questions.txt'; a.click(); URL.revokeObjectURL(url);
  toast('Exported wrong.txt');
}

/********************* Charts (SVG mini) *********************/
function drawCharts() { drawBuzzChart(); drawAccByCat(); }
function svgEmpty(msg) { return `<text x='50%' y='50%' text-anchor='middle' dominant-baseline='middle' fill='currentColor' opacity='.55'>${msg}</text>`; }
function barChart(vals, labels, percent = false) {
  const svgNS = 'http://www.w3.org/2000/svg'; const w = 640, h = 180, pad = 30;
  const max = Math.max(1, ...vals);
  const svg = document.createElementNS(svgNS, 'svg'); svg.setAttribute('viewBox', '0 0 640 180');
  const defs = document.createElementNS(svgNS, 'defs'); const lg = document.createElementNS(svgNS, 'linearGradient');
  const gid = 'g' + Math.random().toString(36).slice(2);
  lg.setAttribute('id', gid); lg.setAttribute('x1', '0'); lg.setAttribute('x2', '1'); lg.setAttribute('y1', '0'); lg.setAttribute('y2', '0');
  const s1 = document.createElementNS(svgNS, 'stop'); s1.setAttribute('offset', '0%'); s1.setAttribute('stop-color', 'var(--accent)');
  const s2 = document.createElementNS(svgNS, 'stop'); s2.setAttribute('offset', '100%'); s2.setAttribute('stop-color', 'var(--accent2)');
  lg.appendChild(s1); lg.appendChild(s2); defs.appendChild(lg); svg.appendChild(defs);

  const g = document.createElementNS(svgNS, 'g');
  const bw = (w - 2 * pad) / vals.length * 0.7, gap = (w - 2 * pad) / vals.length * 0.3;
  for (let i = 0; i < vals.length; i++) {
    const x = pad + i * (bw + gap);
    const hh = Math.max(1, (h - 2 * pad) * vals[i] / max);
    const y = h - pad - hh;
    const r = document.createElementNS(svgNS, 'rect');
    r.setAttribute('x', String(x)); r.setAttribute('y', String(y)); r.setAttribute('width', String(bw)); r.setAttribute('height', String(hh)); r.setAttribute('rx', '6');
    r.setAttribute('fill', `url(#${gid})`); r.style.filter = 'drop-shadow(0 4px 10px rgba(0,0,0,.25))';
    g.appendChild(r);

    const t = document.createElementNS(svgNS, 'text'); t.setAttribute('x', String(x + bw / 2)); t.setAttribute('y', String(y - 6));
    t.setAttribute('text-anchor', 'middle'); t.setAttribute('fill', 'currentColor'); t.setAttribute('font-size', '12');
    t.textContent = percent ? (vals[i] + '%') : String(vals[i]); g.appendChild(t);

    const l = document.createElementNS(svgNS, 'text'); l.setAttribute('x', String(x + bw / 2)); l.setAttribute('y', String(h - 8));
    l.setAttribute('text-anchor', 'middle'); l.setAttribute('fill', 'currentColor'); l.setAttribute('font-size', '12');
    l.textContent = labels[i]; g.appendChild(l);
  }
  svg.appendChild(g); return svg;
}
function drawBuzzChart() {
  const svg = $('chart-buzz'); if (!svg) return; svg.innerHTML = '';
  const arr = JSON.parse(localStorage.getItem(KEY_SESS) || '[]');
  const buzz = (arr[0]?.buzz || []).filter(x => typeof x === 'number');
  if (!buzz.length) { svg.innerHTML = svgEmpty('No buzz data'); return; }
  const bins = [0, 0, 0, 0];
  for (const t of buzz) { if (t < 3) bins[0]++; else if (t < 6) bins[1]++; else if (t < 9) bins[2]++; else bins[3]++; }
  svg.appendChild(barChart(bins, ['0–3s', '3–6s', '6–9s', '9s+']));
}
function drawAccByCat() {
  const svg = $('chart-acc-cat'); if (!svg) return; svg.innerHTML = '';
  const arr = JSON.parse(localStorage.getItem(KEY_SESS) || '[]'); if (!arr[0]) { svg.innerHTML = svgEmpty('No session'); return; }
  const set = getActiveSet(); const id2item = set ? new Map(set.items.map(it => [it.id, it])) : new Map();
  const ids = arr[0].items || []; const results = arr[0].results || [];
  if (!ids.length || !set) { svg.innerHTML = svgEmpty('No regions'); return; }
  const catStats = {};
  ids.forEach((id, idx) => {
    const it = id2item.get(id); if (!it) return;
    const cat = (it.meta?.category) || '—';
    if (!catStats[cat]) catStats[cat] = { n: 0, correct: 0 };
    catStats[cat].n++; if (results[idx]) catStats[cat].correct++;
  });
  const cats = Object.keys(catStats); if (!cats.length) { svg.innerHTML = svgEmpty('No regions'); return; }
  const vals = cats.map(c => Math.round(catStats[c].correct * 100 / (catStats[c].n || 1)));
  svg.appendChild(barChart(vals, cats, true));
}

/********************* Event wiring *********************/
// Nav
$('nav-setup')?.addEventListener('click', (e) => { e.preventDefault(); playFeedbackCue('nav'); navSet('nav-setup'); SHOW('view-setup'); });
$('nav-practice')?.addEventListener('click', (e) => {
  e.preventDefault(); playFeedbackCue('nav'); navSet('nav-practice'); SHOW('view-practice');
  setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 150);
});
$('nav-review')?.addEventListener('click', async (e) => {
  e.preventDefault();
  playFeedbackCue('nav');
  navSet('nav-review');
  SHOW('view-review');
  renderHistory();
  renderWrongBank();
  drawCharts();
  flushCoachPending();
  await refreshCoachNotebook(true);
});
$('nav-coach')?.addEventListener('click', async (e) => {
  e.preventDefault();
  playFeedbackCue('nav');
  await showCoachView(true);
});
$('nav-library')?.addEventListener('click', (e) => { e.preventDefault(); playFeedbackCue('nav'); navSet('nav-library'); SHOW('view-library'); renderLibraryTable(); });
$('nav-help')?.addEventListener('click', (e) => { e.preventDefault(); playFeedbackCue('nav'); openHelp(); });

// Advanced toggle
$('advToggle')?.addEventListener('click', () => {
  playFeedbackCue('tap', { sound: false });
  const wrapper = $('advBodyWrapper');
  const car = $('advCaret');
  if (!wrapper || !car) return;

  wrapper.classList.toggle('open');
  if (wrapper.classList.contains('open')) {
    car.classList.remove('rotate');
  } else {
    car.classList.add('rotate');
  }
});

// Setup events
$('fileInput')?.addEventListener('change', async (e) => {
  const f = e.target.files?.[0]; if (!f) return;
  logImport('info', 'manual upload selected', {
    name: f.name,
    size: f.size,
    type: f.type || '(empty)'
  });
  const txt = await f.text();
  logImport('info', 'manual upload read complete', { chars: txt.length });
  let obj;
  try {
    obj = JSON.parse(txt);
  } catch (err) {
    logImport('error', `manual upload JSON.parse failed: ${(err && err.name) || 'Error'}: ${(err && err.message) || String(err)}`, err);
    toast('Invalid JSON');
    e.target.value = '';
    return;
  }
  logImport('info', 'manual upload JSON.parse success', {
    rootIsArray: Array.isArray(obj),
    keys: topKeys(obj)
  });
  const ok = importSetFromJsonObject(obj, f.name.replace(/\.[^.]+$/, ''));
  if (!ok) logImport('error', 'manual upload failed after parse (see previous [IHBB Import] error)');
  e.target.value = '';
});
$('qs-preview')?.addEventListener('click', () => {
  const set = getActiveSet(); if (!set) { toast('No set'); return; }
  const samp = set.items.slice(0, 5).map((it, i) => `${i + 1}. ${it.question.slice(0, 100)}…\nAnswer: ${it.answer}`).join('\n\n'); alert(samp);
});
$('qs-picker')?.addEventListener('change', (e) => { Library.activeSetId = e.target.value || null; saveLibrary(); updateSetMeta(); updateSetupOverview(); });
$('btn-upload-json')?.addEventListener('click', () => { const fi = $('fileInput'); if (fi) fi.click(); });
$('btn-demo-fetch')?.addEventListener('click', () => { tryFetchDefault(true); });

// Mode chips
$('mode-chips')?.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip'); if (!chip) return;
  document.querySelectorAll('#mode-chips .chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active'); App.mode = chip.dataset.mode;
  updateSetupOverview();
});
// Length chips
$('len-chips')?.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip'); if (!chip) return;
  document.querySelectorAll('#len-chips .chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active'); const v = chip.dataset.n;
  const lc = $('len-custom');
  if (v === 'custom') { if (lc) { lc.style.display = 'inline-block'; lc.focus(); } }
  else { if (lc) lc.style.display = 'none'; App.size = (v === 'all') ? 'all' : Number(v || 10); }
  updateSetupOverview();
});
$('len-custom')?.addEventListener('input', () => {
  const lc = $('len-custom'); const n = parseInt((lc && lc.value) || '10', 10);
  App.size = isNaN(n) ? 10 : clamp(n, 1, 500);
  updateSetupOverview();
});

// Filters
['filter-cat', 'filter-src'].forEach(id => $(id)?.addEventListener('change', (e) => {
  const k = id.split('-')[1]; App.filters[k] = e.target.value;
  updateSetupOverview();
}));

// Presets
$('savePreset')?.addEventListener('click', () => {
  const name = prompt('Preset name'); if (!name) return;
  Presets[name] = {
    voice: Settings.voice, rate: rate(),
    strict: ($('strictMode') && $('strictMode').checked) || false,
    autoAdvance: ($('autoAdvance') && $('autoAdvance').checked) || false,
    autoAdvanceDelay: parseInt(($('autoAdvanceDelay') && $('autoAdvanceDelay').value) || '1', 10) || 1,
    cueTicks: ($('cueTicks') && $('cueTicks').checked) || false,
    cueBeep: ($('cueBeep') && $('cueBeep').checked) || false,
    haptics: ($('haptics') && $('haptics').checked) || false,
    mode: App.mode, size: App.size, filters: App.filters, setId: Library.activeSetId
  };
  savePresets(); renderPresets(); toast('Preset saved');
});
$('presetSel')?.addEventListener('change', (e) => { const n = e.target.value; if (!n) return; applyPreset(Presets[n]); toast('Preset loaded'); });
$('delPreset')?.addEventListener('click', () => { const sel = $('presetSel'); if (!sel || !sel.value) return; delete Presets[sel.value]; savePresets(); renderPresets(); toast('Preset deleted'); });

// Voice & advanced
$('voiceSel')?.addEventListener('change', () => { Settings.voice = $('voiceSel').value; saveSettings(); updateSetupOverview(); });
$('rate')?.addEventListener('input', () => { Settings.rate = rate(); saveSettings(); updateSetupOverview(); });
$('testVoice')?.addEventListener('click', () => speakOnce("Pronunciation test: Yelü Abaoji, Sforza, Shapur, Tenochtitlan, Samarkand.", curVoice(), rate()));
['strictMode', 'autoAdvance', 'cueTicks', 'cueBeep', 'haptics'].forEach(id => $(id)?.addEventListener('change', () => {
  const el = $(id); if (!el) return;
  const key = id === 'strictMode' ? 'strict' : id;
  Settings[key] = el.checked; saveSettings(); updateSetupOverview();
}));
$('autoAdvanceDelay')?.addEventListener('input', () => {
  const el = $('autoAdvanceDelay'); Settings.autoAdvanceDelay = parseInt((el && el.value) || '1', 10) || 1; saveSettings(); updateSetupOverview();
});

function startLastPresetSession() {
  const first = Object.values(Presets)[0];
  if (first) applyPreset(first);
  startSession();
}

$('startSession')?.addEventListener('click', startSession);
$('startSessionMobile')?.addEventListener('click', startSession);
$('startSessionDock')?.addEventListener('click', startSession);
$('startLast')?.addEventListener('click', startLastPresetSession);
$('startLastMobile')?.addEventListener('click', startLastPresetSession);
$('startLastDock')?.addEventListener('click', startLastPresetSession);

// Practice buttons
$('btn-buzz')?.addEventListener('click', buzz);
$('btn-next')?.addEventListener('click', () => { const nx = $('btn-next'); if (nx && !nx.disabled) nextQuestion(false); });
$('btn-right')?.addEventListener('click', markRight);
$('btn-wrong')?.addEventListener('click', markWrong);
$('btn-replay')?.addEventListener('click', replayLast);
$('btn-copy-answer')?.addEventListener('click', async () => {
  if (!App.curItem) return;
  try { await navigator.clipboard.writeText(App.curItem.answer); playFeedbackCue('mastered'); toast('Answer copied'); }
  catch { playFeedbackCue('wrong'); toast('Copy failed'); }
});
$('btn-quit')?.addEventListener('click', () => {
  if (confirm('Quit this session? Progress will be lost for this run.')) {
    playFeedbackCue('nav');
    stopSpeech(); App.phase = 'idle'; navSet('nav-setup'); SHOW('view-setup');
  }
});
$('btn-pause')?.addEventListener('click', () => {
  if (App.phase === 'reading') {
    playFeedbackCue('tap', { sound: false });
    App.readingAbort = true; stopSpeech();
    const st = $('status'); if (st) st.textContent = 'Paused';
    const bz = $('btn-buzz'); if (bz) bz.classList.remove('pulse');
    setPracticeButtons({ buzz: true, next: false, right: false, wrong: false, replay: true, alias: false, flag: false });
  }
});
$('btn-alias')?.addEventListener('click', () => {
  if (!App.curItem) return; const v = prompt('Add an alias (accepted form) for this answer:', '');
  if (!v) return; App.curItem.aliases = App.curItem.aliases || []; App.curItem.aliases.push(v.trim()); playFeedbackCue('mastered'); toast('Alias added (local)');
});
$('btn-flag')?.addEventListener('click', () => { playFeedbackCue('tap', { sound: false }); toast('Flag noted (local only)'); });

// Review actions
$('btn-export-wrong')?.addEventListener('click', exportWrong);
$('btn-clear-wrong')?.addEventListener('click', () => {
  setSRS({});
  syncWrongIdsClearAll();
  playFeedbackCue('unmastered');
  renderWrongBank();
  toast('Wrong bank cleared');
});
$('btn-review-misses')?.addEventListener('click', reviewMissedNow);
$('btn-practice-due')?.addEventListener('click', reviewMissedNow);
$('wrong-refresh')?.addEventListener('click', async () => {
  await initWrongBankSync();
  renderWrongBank();
});
$('wrong-search')?.addEventListener('input', renderWrongBank);
$('btn-clear-history')?.addEventListener('click', () => { localStorage.removeItem(KEY_SESS); playFeedbackCue('unmastered'); renderHistory(); toast('History cleared'); });
$('coach-refresh')?.addEventListener('click', async () => {
  playFeedbackCue('tap', { sound: false });
  flushCoachPending();
  await refreshCoachNotebook(true);
});
$('btn-review-coach-apply')?.addEventListener('click', () => {
  const focus = ReviewCoachFocusSuggestions[0] || CoachFocusSuggestions[0] || null;
  void openCoachFocusDrill(focus, { createdFrom: 'review-top' });
});
$('btn-review-coach-notebook')?.addEventListener('click', () => openCoachNotebook());
$('btn-coach-apply-top')?.addEventListener('click', () => {
  const focus = CoachFocusSuggestions[0] || null;
  void openCoachFocusDrill(focus, { createdFrom: 'notebook-top' });
});
$('btn-coach-clear')?.addEventListener('click', () => { void clearCoachNotebook(); });
$('btn-coach-back-review')?.addEventListener('click', async () => {
  playFeedbackCue('nav');
  navSet('nav-review');
  SHOW('view-review');
  renderHistory();
  renderWrongBank();
  drawCharts();
  flushCoachPending();
  await refreshCoachNotebook(true);
});
$('coach-search')?.addEventListener('input', renderCoachNotebook);
$('coach-filter')?.addEventListener('change', renderCoachNotebook);
$('coach-list')?.addEventListener('click', (e) => {
  const applyBtn = e.target.closest('.coach-apply-note-focus');
  if (applyBtn) {
    const focus = coachFocusFromAttemptId(applyBtn.dataset.attempt || '');
    void openCoachFocusDrill(focus, { createdFrom: 'notebook-note' });
    return;
  }
  const btn = e.target.closest('.coach-toggle-mastered');
  if (!btn) return;
  const id = btn.dataset.attempt || '';
  const next = (btn.dataset.mastered || '0') !== '1';
  toggleCoachMastered(id, next);
});
document.addEventListener('click', (e) => {
  const setupApplyBtn = e.target.closest('.coach-apply-focus');
  if (setupApplyBtn) {
    const focus = CoachFocusSuggestions[Number(setupApplyBtn.dataset.focusIndex) || 0] || null;
    void openCoachFocusDrill(focus, { createdFrom: 'coach-card' });
    return;
  }
  const reviewApplyBtn = e.target.closest('.coach-review-focus');
  if (reviewApplyBtn) {
    const focus = ReviewCoachFocusSuggestions[Number(reviewApplyBtn.dataset.focusIndex) || 0] || null;
    void openCoachFocusDrill(focus, { createdFrom: 'review-card' });
    return;
  }
  const generateBtn = e.target.closest('.coach-generate-focus');
  if (generateBtn) {
    const scope = String(generateBtn.dataset.focusScope || 'setup').trim();
    const source = scope === 'review' ? ReviewCoachFocusSuggestions : CoachFocusSuggestions;
    const focus = source[Number(generateBtn.dataset.focusIndex) || 0] || null;
    void startGeneratedFocusDrill(focus, { count: 6, createdFrom: 'coach-card-generate' });
    return;
  }
  const noteBtn = e.target.closest('.coach-jump-note');
  if (noteBtn) {
    openCoachNotebook(noteBtn.dataset.attempt || '');
    return;
  }
  if (e.target.closest('.coach-open-notebook')) {
    openCoachNotebook();
  }
});

// Library actions
$('lib-set-sel')?.addEventListener('change', (e) => { Library.activeSetId = e.target.value || null; saveLibrary(); renderLibrarySelectors(); renderLibraryTable(); });
$('lib-new-set')?.addEventListener('click', () => { const fi = $('fileInput'); if (fi) fi.click(); });
$('lib-sanitize-all')?.addEventListener('click', () => {
  const set = getActiveSet(); if (!set) { toast('No set'); return; }
  for (const it of set.items) sanitizeItem(it); saveLibrary(); renderLibraryTable(); toast('Sanitized');
});
$('lib-export-json')?.addEventListener('click', () => {
  const set = getActiveSet(); if (!set) { toast('No set'); return; }
  const blob = new Blob([JSON.stringify(set, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${set.name}.json`; a.click(); URL.revokeObjectURL(url);
});
$('lib-search')?.addEventListener('input', renderLibraryTable);
// Keep Library region filter in sync with Setup filter and App.filters
$('lib-filter-cat')?.addEventListener('change', (e) => {
  renderLibraryTable();
  const v = e.target.value || '';
  const fc = $('filter-cat'); if (fc) fc.value = v;
  App.filters.cat = v;
  App.filters.cats = v ? [v] : [];
  // Sync Setup chips
  try {
    const set = getActiveSet();
    const cats = set ? [...new Set(set.items.map(it => it.meta?.category || '').filter(Boolean))] : [];
    renderCategoryChips(cats);
  } catch { }
});
$('lib-filter-era')?.addEventListener('change', renderLibraryTable);

// Quick-start practice with current Library filters
$('lib-practice-filtered')?.addEventListener('click', () => {
  const rc = ($('lib-filter-cat') && $('lib-filter-cat').value) || '';
  const re = ($('lib-filter-era') && $('lib-filter-era').value) || '';
  const fc = $('filter-cat'); if (fc) fc.value = rc; App.filters.cat = rc;
  App.filters.era = re;
  App.filters.eras = re ? [re] : [];
  App.filters.cats = rc ? [rc] : [];
  try {
    const set = getActiveSet();
    const cats = set ? [...new Set(set.items.map(it => it.meta?.category || '').filter(Boolean))] : [];
    const eras = set ? sortEraCodes([...new Set(set.items.map(it => it.meta?.era || '').filter(Boolean))]) : [];
    renderCategoryChips(cats);
    renderEraChips(eras);
  } catch { }
  navSet('nav-setup'); SHOW('view-setup');
  toast(rc ? `Region set to ${rc}` : 'All regions selected');
});

// Import JSON (full library or single set)
$('lib-import-btn')?.addEventListener('click', () => { const fi = $('lib-import-json'); if (fi) fi.click(); });
$('lib-import-json')?.addEventListener('change', async (e) => {
  const f = e.target.files?.[0]; if (!f) return;
  logImport('info', 'library import selected', {
    name: f.name,
    size: f.size,
    type: f.type || '(empty)'
  });
  const txt = await f.text();
  logImport('info', 'library import read complete', { chars: txt.length });
  let obj;
  try {
    obj = JSON.parse(txt);
  } catch (err) {
    logImport('error', `library import JSON.parse failed: ${(err && err.name) || 'Error'}: ${(err && err.message) || String(err)}`, err);
    toast('Invalid JSON');
    e.target.value = '';
    return;
  }
  logImport('info', 'library import JSON.parse success', {
    rootIsArray: Array.isArray(obj),
    keys: topKeys(obj)
  });
  const ok = importSetFromJsonObject(obj, f.name.replace(/\.[^.]+$/, ''));
  if (!ok) logImport('error', 'library import failed after parse (see previous [IHBB Import] error)');
  e.target.value = '';
});

// Export all sets
$('lib-export-all')?.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(Library, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'library.json'; a.click(); URL.revokeObjectURL(url);
});

// Merge duplicates by normalized answer
function normalizeAnswerKey(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function mergeDuplicatesInActiveSet() {
  const set = getActiveSet(); if (!set) { toast('No set'); return; }
  const keyToItem = new Map(); const removed = [];
  const merged = [];
  for (const it of set.items) {
    const k = normalizeAnswerKey(it.answer);
    const ex = keyToItem.get(k);
    if (!ex) { keyToItem.set(k, it); merged.push(it); }
    else {
      const alias = new Set([...(ex.aliases || []), ...(it.aliases || [])]);
      ex.aliases = Array.from(alias);
      if ((it.question || '').length && (it.question || '').length < (ex.question || '').length) ex.question = it.question;
      removed.push(it.id);
    }
  }
  set.items = merged; saveLibrary(); renderLibrarySelectors(); renderLibraryTable();
  toast(`Merged duplicates: ${removed.length}`);
}
$('lib-merge-dupes')?.addEventListener('click', mergeDuplicatesInActiveSet);
function renderLibraryTable() {
  const set = getActiveSet(); const tb = document.querySelector('#tbl-lib tbody'); if (!tb) return;
  tb.innerHTML = '';
  if (!set) {
    renderMobileRecordList('lib-mobile-list', [], 'No set loaded', 'Load or import a question set to browse the library.');
    return;
  }
  const q = (($('lib-search') && $('lib-search').value) || '').toLowerCase();
  const fc = ($('lib-filter-cat') && $('lib-filter-cat').value) || '';
  const fe = ($('lib-filter-era') && $('lib-filter-era').value) || '';
  const mobileCards = [];
  set.items.forEach((it, idx) => {
    if (q && !it.answer.toLowerCase().includes(q) && !it.question.toLowerCase().includes(q)) return;
    if (fc && (it.meta?.category || '') !== fc) return;
    if (fe && (it.meta?.era || '') !== fe) return;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class='stat'>${idx + 1}</td><td>${it.answer}</td><td>${(it.aliases || []).slice(0, 3).join(', ')}</td><td>${it.meta?.category || ''}</td><td>${getEraName(it.meta?.era || '')}</td><td>${it.meta?.source || ''}</td>`;
    tb.appendChild(tr);
    mobileCards.push(mobileRecordCard({
      eyebrow: `Question ${idx + 1}`,
      title: it.answer,
      pills: [
        ['Region', it.meta?.category || '—'],
        ['Era', getEraName(it.meta?.era || '') || '—']
      ],
      details: [
        (it.aliases || []).length ? `Aliases: ${escHtml((it.aliases || []).slice(0, 3).join(', '))}` : 'Aliases: —',
        it.meta?.source ? `Source: ${escHtml(it.meta.source)}` : ''
      ]
    }));
  });
  renderMobileRecordList('lib-mobile-list', mobileCards, 'No questions match', 'Try broadening the search term or clearing one of the active filters.');
}

// Help overlay
function openHelp() { const ov = $('overlay'); if (ov) ov.classList.add('show'); }
$('openHelp')?.addEventListener('click', openHelp);
$('closeHelp')?.addEventListener('click', () => { const ov = $('overlay'); if (ov) ov.classList.remove('show'); });
$('overlay')?.addEventListener('click', (e) => { if (e.target && e.target.id === 'overlay') { const ov = $('overlay'); if (ov) ov.classList.remove('show'); } });

// DeepSeek sidebar chat
$('coach-chat-launcher')?.addEventListener('click', () => {
  openCoachChat({ auto: false, seed: false, reason: 'manual' });
});
$('coach-chat-new')?.addEventListener('click', clearCoachChatConversation);
$('coach-chat-fullscreen')?.addEventListener('click', toggleCoachChatFullscreen);
$('coach-chat-mode-switch')?.addEventListener('click', (e) => {
  const button = e.target.closest('.coach-chat-mode-btn');
  if (!button) return;
  setCoachChatMode(button.dataset.mode || 'auto');
});
$('coach-chat-size-presets')?.addEventListener('click', (e) => {
  const button = e.target.closest('.coach-chat-size-btn');
  if (!button) return;
  setCoachChatSizePreset(button.dataset.size || 'standard');
});
$('coach-chat-close')?.addEventListener('click', () => closeCoachChat({ manual: true }));
$('coach-chat-backdrop')?.addEventListener('click', () => closeCoachChat({ manual: true }));
$('coach-chat-resize-handle')?.addEventListener('pointerdown', beginCoachChatResize);
$('coach-chat-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('coach-chat-input');
  const message = String(input?.value || '').trim();
  if (!message) return;
  if (input) input.value = '';
  void sendCoachChatMessage(message);
});
$('coach-chat-workspace')?.addEventListener('click', (e) => {
  const button = e.target.closest('.coach-chat-workspace-card');
  if (!button) return;
  const card = CoachChat.workspaceCards?.[Number(button.dataset.workspaceIndex) || 0];
  if (!card?.action) return;
  if (card.action.kind === 'mode') {
    setCoachChatMode(card.action.mode || 'knowledge');
    return;
  }
  if (card.action.kind === 'prompt') {
    void sendCoachChatMessage(card.action.prompt || '');
    return;
  }
  void performCoachChatAction(card.action);
});
$('coach-chat-starters')?.addEventListener('click', (e) => {
  const button = e.target.closest('.coach-chat-starter');
  if (!button) return;
  const starter = CoachChat.currentStarters?.[Number(button.dataset.starterIndex) || 0];
  if (!starter?.prompt) return;
  void sendCoachChatMessage(starter.prompt);
});
$('coach-chat-messages')?.addEventListener('click', (e) => {
  const followUpButton = e.target.closest('.coach-chat-followup');
  if (followUpButton) {
    const messageIndex = Number(followUpButton.dataset.messageIndex);
    const followUpIndex = Number(followUpButton.dataset.followupIndex);
    const followUp = CoachChat.messages?.[messageIndex]?.followUps?.[followUpIndex];
    if (followUp?.prompt) void sendCoachChatMessage(followUp.prompt);
    return;
  }
  const toolButton = e.target.closest('.coach-chat-tool');
  if (toolButton) {
    const messageIndex = Number(toolButton.dataset.messageIndex);
    const message = CoachChat.messages?.[messageIndex];
    if (message?.text) {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(String(message.text || '').trim()).then(() => toast('Assistant answer copied')).catch(() => toast('Copy failed'));
      } else {
        toast('Copy unavailable');
      }
    }
    return;
  }
  const button = e.target.closest('.coach-chat-action');
  if (!button) return;
  const messageIndex = Number(button.dataset.messageIndex);
  const actionIndex = Number(button.dataset.actionIndex);
  const action = CoachChat.messages?.[messageIndex]?.actions?.[actionIndex];
  if (!action) return;
  void performCoachChatAction(action);
});

// Lightweight haptics for most clickable controls; major actions have dedicated cues.
document.addEventListener('click', (e) => {
  const ctl = e.target && e.target.closest ? e.target.closest('button, .btn, .chip, .buzz') : null;
  if (!ctl || ctl.disabled) return;
  if (ctl.classList && ctl.classList.contains('coach-toggle-mastered')) return;
  const id = String(ctl.id || '');
  if ([
    'startSession', 'startLast',
    'btn-buzz', 'btn-right', 'btn-wrong', 'btn-submit-answer', 'btn-next',
    'btn-copy-answer', 'btn-quit', 'btn-pause', 'btn-alias', 'btn-flag',
    'btn-clear-wrong', 'btn-clear-history', 'coach-refresh'
  ].includes(id)) return;
  playFeedbackCue('tap', { sound: false, haptic: true });
}, true);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && CoachChat.open) { e.preventDefault(); closeCoachChat({ manual: true }); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); CoachChat.open ? closeCoachChat({ manual: true }) : openCoachChat({ auto: false, seed: false, reason: 'manual' }); return; }
  if (CoachChat.open && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleCoachChatFullscreen(); return; }
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes((document.activeElement && document.activeElement.tagName) || '')) return;
  const vp = $('view-practice'); if (vp && vp.classList.contains('active')) {
    if (e.code === 'Space') { e.preventDefault(); buzz(); }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); markRight(); }
    if (e.key === 'w' || e.key === 'W') { e.preventDefault(); markWrong(); }
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); const nx = $('btn-next'); if (nx && !nx.disabled) nextQuestion(false); }
    if (e.key === 'l' || e.key === 'L') { e.preventDefault(); const rp = $('btn-replay'); if (rp && !rp.disabled) replayLast(); }
    if (e.key === 'c' || e.key === 'C') { e.preventDefault(); const b = $('btn-copy-answer'); if (b && !b.disabled) b.click(); }
  }
});
$('coach-chat-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('coach-chat-form')?.requestSubmit();
  }
});
document.addEventListener('pointermove', (e) => {
  if (!CoachChat.resizing) return;
  CoachChat.ui.width = clampCoachChatWidth(window.innerWidth - e.clientX - 16);
  CoachChat.ui.size = 'custom';
  saveCoachChatUiPrefs();
  renderCoachChatChrome();
});
document.addEventListener('pointerup', () => {
  if (!CoachChat.resizing) return;
  CoachChat.resizing = null;
  document.body.classList.remove('coach-chat-resizing');
});

let responsiveRenderTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(responsiveRenderTimer);
  responsiveRenderTimer = setTimeout(() => {
    renderHistory();
    renderWrongBank();
    renderLibraryTable();
    updateSetupMobileDock();
  }, 120);
});

/********************* Default fetch — loads categorized JSON only *********************/
async function tryFetchDefault(force = false) {
  // Ensure the default volatile questions exist in memory on startup.
  if (!force && Array.isArray(Library.sets)) {
    if (Library.sets.some(s => s.volatile || s.name?.includes('IHBB Questions'))) {
      logImport('info', 'startup default load skipped because default set is already loaded', { localSetCount: Library.sets.length });
      return false;
    }
  }

  if (typeof location !== 'undefined' && !location.protocol.startsWith('http')) {
    if (!force) return false;
    logImport('warn', 'default fetch blocked by non-http protocol', { protocol: location.protocol });
    toast('Open via http(s) or run a local server to load questions.json');
    return false;
  }
  try {
    logImport('info', 'fetching questions.json', { force });
    const rj = await fetch('./questions.json', { cache: 'no-cache' });
    logImport('info', 'questions.json fetch response', { ok: rj.ok, status: rj.status });
    if (rj.ok) {
      const obj = await rj.json();
      const parsed = parseJsonImport(obj, 'IHBB Questions');
      if (!parsed) { toast('questions.json format is invalid'); return false; }
      const sharedGeneratedItems = await fetchSharedGeneratedQuestionItems();
      if (parsed.type === 'library') {
        (parsed.sets || []).forEach(set => ensureSetItemSources(set, 'original'));
        if (sharedGeneratedItems.length) {
          const targetSet = parsed.sets.find(set => /IHBB Questions/i.test(String(set?.name || '').trim())) || parsed.sets[0];
          if (targetSet) {
            const merged = mergeQuestionItems(targetSet.items || [], sharedGeneratedItems);
            targetSet.items = merged.items;
          }
        }
        Library.sets = parsed.sets; Library.activeSetId = parsed.activeSetId || (parsed.sets[0]?.id || null);
        saveLibrary(); renderLibrarySelectors(); renderLibraryTable(); updateSetMeta();
        renderWrongBank();
        toast(`Loaded questions.json (${parsed.sets.length} sets)`);
        return true;
      }
      const set = parsed.set;
      ensureSetItemSources(set, 'original');
      if (sharedGeneratedItems.length) {
        const merged = mergeQuestionItems(set.items || [], sharedGeneratedItems);
        set.items = merged.items;
      }
      Library.sets.unshift(set); Library.activeSetId = set.id;
      saveLibrary(); renderLibrarySelectors(); renderLibraryTable(); updateSetMeta();
      renderWrongBank();
      const catCount = new Set(set.items.map(it => it.meta?.category || '').filter(Boolean)).size;
      toast(`Loaded ${set.items.length} questions${catCount ? ` • ${catCount} categories` : ''}`);
      return true;
    }
  } catch (err) {
    logImport('error', 'questions.json fetch/parse failed', {
      name: err?.name,
      message: err?.message,
      stack: err?.stack
    });
  }
  toast('No questions.json found. Run: python build_db.py');
  return false;
}

/********************* Init *********************/
(async function init() {
  loadAll(); populateVoices();
  migrateLibrarySources();
  const rr = $('rate'); if (rr) rr.value = Settings.rate || 1.0;
  const sm = $('strictMode'); if (sm) sm.checked = (Settings.strict ?? false);
  const aa = $('autoAdvance'); if (aa) aa.checked = !!Settings.autoAdvance;
  const aad = $('autoAdvanceDelay'); if (aad) aad.value = Settings.autoAdvanceDelay || 1;
  const ct = $('cueTicks'); if (ct) ct.checked = (Settings.cueTicks ?? true);
  const cb = $('cueBeep'); if (cb) cb.checked = (Settings.cueBeep ?? true);
  const hp = $('haptics'); if (hp) hp.checked = (Settings.haptics ?? true);
  renderPresets(); renderLibrarySelectors(); updateFilterRow();
  try { const p = document.querySelector('#lib-cats')?.parentElement; if (p) p.innerHTML = p.innerHTML.replace('Categories:', 'Regions:'); } catch { }
  renderHistory(); renderWrongBank();
  await initWrongBankSync();
  backfillLocalSessionsToCloud();
  flushCoachPending();
  await refreshCoachNotebook(false);
  // Auto-load questions.json on startup (from build_db.py)
  if (!(ASSIGNMENT_ID && HAS_ASSIGNMENT_PAYLOAD)) {
    await tryFetchDefault(false);
  }
  updateSetupOverview();
  renderCoachChatChrome();
  await applyPendingCoachChatAction();
  setTimeout(() => { maybeAutoOpenCoachChat('init'); }, 500);
})();

/*** Auto-grade overrides and typing phase ***/
// Override countdown to start a 10s typing phase
let __orig_startCountdown = (typeof startCountdown === 'function') ? startCountdown : null;
startCountdown = function (sec) {
  startTypingPhase(10);
};

function startTypingPhase(sec) {
  const st = $('status'); if (st) st.textContent = `Type your answer (${sec}s)`;
  App.phase = 'typing';
  App.submitBusy = false;
  const row = $('typing-row'); if (row) row.style.display = 'flex';
  const inp = $('user-answer'); if (inp) { inp.disabled = false; inp.value = ''; setTimeout(() => inp.focus(), 0); }
  const sb = $('btn-submit-answer'); if (sb) sb.disabled = false;
  unlockPracticeAfterGrade();
  const cp = $('btn-copy-answer'); if (cp) cp.disabled = true;

  let t = 10; // fixed 10 seconds
  const cd = $('countdown'); if (cd) cd.textContent = `${t}`;
  setPracticeButtons({ buzz: false, next: false, right: false, wrong: false, replay: false, alias: false, flag: false });

  if (App._cdIv) { clearInterval(App._cdIv); App._cdIv = null; }
  const iv = setInterval(() => {
    t--;
    if (Settings.cueTicks) beep(660, 0.06);
    if (Settings.haptics) vibrate(12);
    if (t <= 0) {
      clearInterval(iv); App._cdIv = null;
      const cd2 = $('countdown'); if (cd2) cd2.textContent = '';
      if (Settings.cueBeep) beep(1040, 0.12);
      submitAnswer(true);
    } else {
      const cd3 = $('countdown'); if (cd3) cd3.textContent = `${t}`;
    }
  }, 1000);
  App._cdIv = iv;
}

async function submitAnswer(auto = false) {
  if (App.submitBusy) return;
  if (App.phase !== 'typing') return;
  App.submitBusy = true;
  if (!auto) playFeedbackCue('submit');
  if (App._cdIv) { clearInterval(App._cdIv); App._cdIv = null; }
  const row = $('typing-row'); if (row) row.style.display = 'none';
  const inputEl = $('user-answer');
  const submitBtn = $('btn-submit-answer');
  if (inputEl) inputEl.disabled = true;
  if (submitBtn) submitBtn.disabled = true;
  lockPracticeDuringGrade();
  const userAns = (inputEl && inputEl.value) || '';

  const item = App.curItem || { question: '', answer: '', aliases: [] };
  App.phase = 'grading';
  const st = $('status'); if (st) st.textContent = 'Grading...';
  const ans = $('answer'); if (ans) ans.textContent = 'Grading...';
  clearCoachCard();
  const clientAttemptId = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Fallback matcher
  const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const basicMatch = (u, gold, aliases) => {
    const nu = normalize(u), ng = normalize(gold);
    if (nu && nu === ng) return true;
    for (const a of (aliases || [])) if (nu === normalize(a)) return true;
    return false;
  };

  const skipDeepSeekForNoAttempt = isExplicitNoAttemptAnswer(userAns, { allowBlank: true });
  const coachLoadingText = skipDeepSeekForNoAttempt
    ? 'No attempt submitted — building a quick study note...'
    : 'Incorrect — building your coach micro-lesson...';
  let correct = false;
  let reason = '';
  try {
    if (skipDeepSeekForNoAttempt) {
      correct = false;
      reason = 'No attempt submitted.';
    } else {
      const res = await fetch('/api/grade', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: item.question,
          question_id: item.id,
          expected: item.answer,
          aliases: item.aliases || [],
          answer: userAns,
          user_answer: userAns,
          strict: !!Settings.strict,
          client_attempt_id: clientAttemptId,
          coach_enabled: false,
          meta: {
            category: item.meta?.category || '',
            era: item.meta?.era || '',
            source: item.meta?.source || ''
          }
        })
      });
      if (res.ok) {
        const data = await res.json();
        correct = !!data.correct; reason = data.reason || '';
      } else {
        reason = `Server error ${res.status}`;
        correct = basicMatch(userAns, item.answer, item.aliases);
      }
    }
  } catch (e) {
    reason = 'Offline grading fallback used';
    correct = basicMatch(userAns, item.answer, item.aliases);
  }
  const quickCoach = fallbackCoachForItem(item, correct, reason, userAns);

  // Reveal canonical answer and finalize
  const ansText = Settings.strict ? `标准答案：${item.answer}` : `标准答案：${item.answer}${(item.aliases?.length ? `  (aliases: ${item.aliases.slice(0, 3).join(', ')})` : '')}`;
  if (ans) ans.textContent = ansText + (reason ? `  — ${correct ? '✓' : '✗'} ${reason}` : `  — ${correct ? '✓' : '✗'}`);
  const coachEl = $('coach-card');
  if (coachEl) {
    if (correct) {
      try { delete coachEl.dataset.attempt; } catch { /* noop */ }
    } else {
      coachEl.dataset.attempt = clientAttemptId;
    }
  }
  if (correct) {
    App.phase = 'graded';
    if (st) st.textContent = 'Correct.';
    clearCoachCard();
  } else {
    App.phase = 'coach-loading';
    if (st) st.textContent = coachLoadingText;
    const loadingCoach = normalizeCoach({
      summary: skipDeepSeekForNoAttempt
        ? 'No attempt submitted. Preparing a quick study note without AI grading...'
        : 'Incorrect. Generating personalized DeepSeek coaching...',
      error_diagnosis: skipDeepSeekForNoAttempt
        ? 'This answer was marked as a no-attempt and skipped AI grading.'
        : 'Analyzing your answer against the expected concept...',
      overlap_explainer: skipDeepSeekForNoAttempt
        ? 'Preparing a concise explanation so you can study the right concept immediately.'
        : 'Preparing a focused misconception breakdown...',
      explanation_bullets: [
        skipDeepSeekForNoAttempt
          ? 'The response matched a no-attempt phrase, so AI grading was skipped.'
          : 'Grading is complete and the coach is now building a personalized explanation.',
        skipDeepSeekForNoAttempt
          ? 'You will still get a study note anchored to the accepted answer.'
          : 'This lesson will compare your answer directly against the accepted answer.',
        'High-value facts and clue anchors are being assembled now.'
      ],
      related_facts: ['Collecting supporting facts for this answer.', 'Building timeline and region anchors.'],
      key_clues: ['Reviewing clues that disambiguate this question.', 'Generating timeline and region anchors.'],
      study_tip: 'Preparing your next study move...',
      canonical_answer: canonicalAnswerText(item.answer),
      wiki_link: coachWikiLinkForAnswer(item.answer),
      study_focus: {
        region: item.meta?.category || 'World',
        era: item.meta?.era || '',
        topic: topicFromQuestion(item.question),
        icon: iconForStudyFocus(item.meta?.category || 'World', topicFromQuestion(item.question))
      },
      confidence: 'low'
    }, item, correct, reason);
    renderCoachCard(loadingCoach);
  }
  speakOnce(`标准答案：${item.answer}`, curVoice(), rate(), 1.0, 12000);

  if (correct) {
    playFeedbackCue('correct');
    App.correct++; App.resultsCorrect.push(true);
    App.sessionBuzzTimes.push(App.buzzAt || 0);
    App.submitBusy = false;
    finishMark(true);
  } else {
    playFeedbackCue('wrong');
    srsAddWrong(item); App.resultsCorrect.push(false);
    App.sessionBuzzTimes.push(App.buzzAt || 0);
  }

  // Wrong answers get a second, separate coach request after grading is already returned.
  if (!correct) {
    const coachRecord = {
      client_attempt_id: clientAttemptId,
      client_session_id: String(App.sessionId || ''),
      question_id: String(item.id || ''),
      question_text: String(item.question || ''),
      expected_answer: String(item.answer || ''),
      user_answer: String(userAns || ''),
      correct: false,
      reason: String(reason || ''),
      coach: quickCoach,
      category: String(item.meta?.category || ''),
      era: String(item.meta?.era || ''),
      source: String(item.meta?.source || ''),
      focus_topic: String(quickCoach?.study_focus?.topic || ''),
      mastered: false,
      mastered_at: null,
      created_at: new Date().toISOString()
    };
    upsertCoachLocal(coachRecord);
    syncCoachAttempt(coachRecord);
    const finalizeIncorrectCoach = (finalCoach, statusText) => {
      coachRecord.coach = finalCoach;
      coachRecord.focus_topic = String(finalCoach?.study_focus?.topic || '');
      upsertCoachLocal(coachRecord);
      syncCoachAttempt(coachRecord);
      const focus = finalCoach?.study_focus || {};
      const recentTitle = [focus.region, focus.era, focus.topic].filter(Boolean).join(' • ') || coachChatFocusTitle(focus) || 'Recent miss';
      CoachChat.recentIncorrect = {
        key: [focus.region, focus.era, focus.topic].filter(Boolean).join('|'),
        title: recentTitle,
        region: String(focus.region || item.meta?.category || '').trim(),
        era: String(focus.era || item.meta?.era || '').trim(),
        topic: String(focus.topic || '').trim(),
        reason: String(finalCoach?.summary || finalCoach?.study_tip || reason || '').trim(),
        attemptId: clientAttemptId,
        ts: Date.now()
      };
      const liveCoachEl = $('coach-card');
      if (liveCoachEl && liveCoachEl.dataset.attempt === clientAttemptId) {
        renderCoachCard(finalCoach);
      }
      App.phase = 'graded';
      if (st) st.textContent = statusText;
      App.submitBusy = false;
      renderCoachChatChrome();
      finishMark(false);
      maybeAutoOpenCoachChat('miss');
    };
    const fetchCoachAsync = async () => {
      if (skipDeepSeekForNoAttempt) {
        const fallback = fallbackCoachForItem(item, false, reason || 'No attempt submitted.', userAns);
        finalizeIncorrectCoach(fallback, 'No attempt submitted — quick coaching ready.');
        return;
      }
      try {
        const coachRes = await fetch('/api/grade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: item.question,
            question_id: item.id,
            expected: item.answer,
            expected_answer: item.answer,
            aliases: item.aliases || [],
            answer: userAns,
            user_answer: userAns,
            strict: !!Settings.strict,
            coach_enabled: true,
            coach_only: true,
            coach_depth: 'full',
            correct: !!correct,
            reason: String(reason || ''),
            client_attempt_id: clientAttemptId,
            meta: {
              category: item.meta?.category || '',
              era: item.meta?.era || '',
              source: item.meta?.source || ''
            }
          })
        });
        if (!coachRes.ok) throw new Error(`Server error ${coachRes.status}`);
        const coachData = await coachRes.json();
        const finalCoach = normalizeCoach(coachData?.coach, item, correct, reason);
        finalizeIncorrectCoach(finalCoach, 'Incorrect — coach lesson ready.');
      } catch (err) {
        const fallback = fallbackCoachForItem(item, correct, reason || 'Coach unavailable.', userAns);
        finalizeIncorrectCoach(fallback, 'Incorrect — quick coaching shown (network issue).');
      }
    };
    void fetchCoachAsync();
  }
}

// Hook up UI for manual submit (optional early submit)
$('btn-submit-answer')?.addEventListener('click', () => submitAnswer(false));
$('user-answer')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitAnswer(false); } });

// Disable manual R/W when autoGrade is enabled
try {
  const __origMarkRight = markRight; const __origMarkWrong = markWrong;
  window.markRight = function () { if (App.autoGrade) return; return __origMarkRight(); };
  window.markWrong = function () { if (App.autoGrade) return; return __origMarkWrong(); };
} catch { }

/********************* Assignment Integration *********************/
// When opened with ?assignment=<id>, load assignment questions from localStorage
// and auto-start the practice session so the student goes straight to the buzz button.
(function assignmentHook() {
  const assignId = ASSIGNMENT_ID;
  if (!assignId) return;

  const storageKey = ASSIGNMENT_STORAGE_KEY || ('ihbb_assignment_' + assignId);
  const raw = localStorage.getItem(storageKey);
  if (!raw) return;

  try {
    const assignData = JSON.parse(raw);
    const items = (assignData.questions || []).map(q => ({
      id: q.question_id || q.id || uid(),
      question: q.question_text || q.question || q.q || '',
      answer: q.answer_text || q.answer || q.a || '',
      aliases: Array.isArray(q.aliases) ? q.aliases : [],
      meta: { category: q.category || '', era: q.era || '', source: q.source || '' }
    }));

    if (!items.length) return;

    // Inject as a volatile library set
    const set = { id: 'assignment_' + assignId, name: assignData.title || 'Assignment', items, volatile: true };
    Library.sets.unshift(set);
    Library.activeSetId = set.id;
    renderLibrarySelectors();
    updateSetMeta();

    // Set session length to ALL questions and mode to sequential
    App.size = 'all';
    App.mode = 'sequential';
    App.filters = { cat: '', cats: [], era: '', eras: [], src: '' };

    // Auto-start the session after a short delay (DOM needs to be ready)
    setTimeout(() => {
      toast('📝 Starting assignment: ' + (assignData.title || 'Assignment'));
      startSession();
    }, 500);

    // Monitor for session end (review view becomes active) and submit score.
    // Session completion phase is "done" in this app.
    const checkDone = setInterval(() => {
      const reviewActive = document.getElementById('view-review')?.classList.contains('active');
      const sessionComplete = App.phase === 'done' || (App.phase === 'idle' && App.i >= App.order.length);
      if (reviewActive && sessionComplete) {
        clearInterval(checkDone);
        submitAssignmentScore(assignId, items.length);
      }
    }, 500);

  } catch (e) {
    console.error('Assignment hook error:', e);
  }

  async function submitAssignmentScore(aId, total) {
    if (window._assignmentSubmitted) return;
    window._assignmentSubmitted = true;
    try {
      if (!window.supabaseClient) return;
      const { data: { session } } = await window.supabaseClient.auth.getSession();
      if (!session) return;
      const { error } = await window.supabaseClient
        .from('assignment_submissions')
        .upsert({
          assignment_id: aId,
          student_id: session.user.id,
          total: total,
          correct: App.correct || 0
        }, { onConflict: 'assignment_id,student_id' });
      if (error) throw error;
      localStorage.removeItem(storageKey);
      toast('✅ Assignment score submitted! Returning to dashboard...');
      setTimeout(() => { window.location.href = 'student.html'; }, 2500);
    } catch (e) {
      window._assignmentSubmitted = false;
      console.error('Score submit error:', e);
      toast('Could not submit assignment score. Please retry.');
    }
  }
})();
