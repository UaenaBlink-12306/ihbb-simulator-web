/********************* Utilities & UI *********************/
const $ = (id) => document.getElementById(id);
const SHOW = (id) => {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = $(id); if (el) el.classList.add('active');
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
const WRONG_SYNC_TABLE = 'user_wrong_questions';
const SESSION_SYNC_TABLE = 'user_drill_sessions';
const COACH_SYNC_TABLE = 'user_coach_attempts';

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

const App = {
  pool: [], order: [], i: 0, correct: 0, startTs: 0,
  sessionBuzzTimes: [], resultsCorrect: [],
  curItem: null, phase: 'idle', // idle|reading|countdown|answering|done
  size: 10, mode: 'random', filters: { cat: '', cats: [], era: '', eras: [], src: '' },
  lastLines: [], readingAbort: false, buzzStart: 0, buzzAt: null,
  rollingSentences: [], _cdIv: null,
  autoGrade: true,
  sessionId: null,
  submitBusy: false
};

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
  toast('Cloud coach sync unavailable (setup missing). Using local notebook.');
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
function getCoachLocal() {
  const arr = safeReadJson(KEY_COACH_LOCAL, []);
  return Array.isArray(arr) ? arr : [];
}
function setCoachLocal(arr) { setJsonSafe(KEY_COACH_LOCAL, Array.isArray(arr) ? arr.slice(0, 300) : []); }
function upsertCoachLocal(record) {
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
  return Array.isArray(arr) ? arr : [];
}
function setCoachPending(arr) { setJsonSafe(KEY_COACH_PENDING, Array.isArray(arr) ? arr.slice(0, 300) : []); }
function enqueueCoachPending(record) {
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
function fallbackCoachForItem(item, correct, reason) {
  const region = String(item?.meta?.category || 'World') || 'World';
  const era = String(item?.meta?.era || '');
  const topic = topicFromQuestion(item?.question || '');
  return {
    summary: correct
      ? 'You got it right. Keep tying clues to specific context.'
      : 'This looks like a near miss from overlapping concepts.',
    error_diagnosis: correct
      ? 'Your response matched the required entity.'
      : 'Your response likely overlapped with a related but different answer.',
    overlap_explainer: reason || 'Use uniquely identifying clues to separate close answers.',
    key_clues: [
      'Look for clues that uniquely identify one entity.',
      'Use era and region to narrow options.',
      'Prioritize named events and proper nouns.'
    ],
    memory_hook: 'One distinctive clue -> one canonical answer.',
    next_check_question: 'What cause-and-effect relationship best explains this answer in context?',
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
  const confidence = ['high', 'medium', 'low'].includes(String(c.confidence || '').toLowerCase()) ? String(c.confidence).toLowerCase() : 'low';
  return {
    summary: String(c.summary || (correct ? 'Correct answer with good clue alignment.' : 'Answer not accepted; review clue disambiguation.')).trim(),
    error_diagnosis: String(c.error_diagnosis || (correct ? 'You identified the right entity.' : 'This answer likely mixed with a related concept.')).trim(),
    overlap_explainer: String(c.overlap_explainer || reason || 'Focus on clues that uniquely identify the expected answer.').trim(),
    key_clues: clues.length ? clues : [
      'Track the clue that uniquely identifies the answer.',
      'Use era and region to eliminate close alternatives.',
      'Prioritize named events and figures.'
    ],
    memory_hook: String(c.memory_hook || 'Anchor one unique clue to one canonical answer.').trim(),
    next_check_question: String(c.next_check_question || 'What consequence or context best confirms this answer?').trim(),
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
    <div class="coach-section"><b>Key Clues:</b><ul>${clues.map(c => `<li>${escHtml(c)}</li>`).join('')}</ul></div>
    <div class="coach-section"><b>Memory Hook:</b> ${escHtml(coach.memory_hook || '')}</div>
    <div class="coach-section"><b>Next Check:</b> ${escHtml(coach.next_check_question || '')}</div>
  `;
  el.style.display = 'block';
}

const CoachNotebook = { records: [], loaded: false };

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
  if (!cats.length) { wrap.appendChild(document.createTextNode('(No categories — run build_db.py)')); return; }
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
}

// Setup screen: render multi-select era chips
function renderEraChips(eras) {
  const wrap = $('era-chips'); if (!wrap) return;
  const eraList = sortEraCodes((eras || []).slice());
  wrap.innerHTML = '';
  if (!eraList.length) { wrap.appendChild(document.createTextNode('(No eras — run build_db.py)')); return; }

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
  } catch { /* noop */ }
}

/********************* Pool build & UI helpers *********************/
function buildPool() {
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
function setPracticeButtons({ buzz, next, right, wrong, replay, alias, flag }) {
  const bz = $('btn-buzz'); if (bz) bz.disabled = !buzz;
  const nx = $('btn-next'); if (nx) nx.disabled = !next;
  const r = $('btn-right'); if (r) r.disabled = !right;
  const w = $('btn-wrong'); if (w) w.disabled = !wrong;
  const rp = $('btn-replay'); if (rp) rp.disabled = !replay;
  const al = $('btn-alias'); if (al) al.disabled = !alias;
  const fl = $('btn-flag'); if (fl) fl.disabled = !flag;
  const cp = $('btn-copy-answer'); if (cp && App.phase !== 'answering') cp.disabled = true;
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
  navSet('nav-review'); SHOW('view-review'); renderHistory(); renderWrongBank(); drawCharts(); refreshCoachNotebook(false);
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
    });
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
        const recs = (Array.isArray(data) ? data : []).map(normalizeCoachAttemptRecord);
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
  const local = getCoachLocal().map(normalizeCoachAttemptRecord);
  CoachNotebook.records = local;
  CoachNotebook.loaded = true;
  return local;
}

function renderCoachNotebook() {
  const listEl = $('coach-list');
  if (!listEl) return;
  const countEl = $('coach-count');
  const q = (($('coach-search') && $('coach-search').value) || '').trim().toLowerCase();
  const filter = (($('coach-filter') && $('coach-filter').value) || 'all').toLowerCase();
  const rows = (CoachNotebook.records || []).filter(r => {
    if (filter === 'todo' && r.mastered) return false;
    if (filter === 'mastered' && !r.mastered) return false;
    if (!q) return true;
    const hay = `${r.question_text} ${r.expected_answer} ${r.user_answer} ${r.reason} ${r.focus_topic} ${r.category} ${r.era}`.toLowerCase();
    return hay.includes(q);
  });
  if (countEl) countEl.textContent = String(rows.length);
  if (!rows.length) {
    listEl.innerHTML = `<div class="coach-empty">No coach lessons found.</div>`;
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
          <div class="grow"></div>
          <button class="btn ghost coach-toggle-mastered" data-mastered="${r.mastered ? '1' : '0'}" data-attempt="${escHtml(r.client_attempt_id)}">${r.mastered ? 'Unmark Mastered' : 'Mark Mastered'}</button>
        </div>
        <details>
          <summary>${escHtml((r.question_text || '').slice(0, 180))}${(r.question_text || '').length > 180 ? '…' : ''}</summary>
          <div class="coach-note-body">
            <div><b>Your answer:</b> ${escHtml(r.user_answer || '(blank)')}</div>
            <div><b>Expected:</b> ${escHtml(r.expected_answer || '')}</div>
            <div><b>Summary:</b> ${escHtml(coach.summary || '')}</div>
            <div><b>Error Diagnosis:</b> ${escHtml(coach.error_diagnosis || '')}</div>
            <div><b>Overlap Explainer:</b> ${escHtml(coach.overlap_explainer || '')}</div>
            <div><b>Memory Hook:</b> ${escHtml(coach.memory_hook || '')}</div>
            <div><b>Next Check:</b> ${escHtml(coach.next_check_question || '')}</div>
          </div>
        </details>
      </div>
    `;
  }).join('');
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
  for (const s of arr) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${fmtDate(s.ts)}</td><td>${s.total}</td><td>${s.correct}</td><td>${s.acc}%</td><td>${prettyDur(s.dur)}</td><td><button class='btn ghost' data-replay='${s.ts}'>Repeat</button></td>`;
    tb.appendChild(tr);
  }
  tb.querySelectorAll('button[data-replay]').forEach(b => b.onclick = () => repeatSession(b.dataset.replay));
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
  for (const { id, rec, item } of recs) {
    const ans = (item?.answer) || rec.answer || '';
    if (q && !ans.toLowerCase().includes(q)) continue;
    const dueTxt = rec.dueAt ? new Date(rec.dueAt).toLocaleDateString() : '—';
    const aliases = (rec.aliases?.length ? rec.aliases : (item?.aliases || []));
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${ans}</td><td class='stat'>${rec.box || 1}</td><td>${dueTxt}</td><td>${(aliases || []).slice(0, 3).join(', ')}</td><td><button class='btn ghost' data-del='${id}'>Delete</button></td>`;
    tb.appendChild(tr);
  }
  tb.querySelectorAll('button[data-del]').forEach(b => b.onclick = () => {
    const id = normalizeQuestionId(b.dataset.del);
    if (!id) return;
    const s = getSRS();
    delete s[id];
    setSRS(s);
    syncWrongIdsDelete([id]);
    renderWrongBank();
  });
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
$('qs-picker')?.addEventListener('change', (e) => { Library.activeSetId = e.target.value || null; saveLibrary(); updateSetMeta(); });
$('btn-upload-json')?.addEventListener('click', () => { const fi = $('fileInput'); if (fi) fi.click(); });
$('btn-demo-fetch')?.addEventListener('click', () => { tryFetchDefault(true); });

// Mode chips
$('mode-chips')?.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip'); if (!chip) return;
  document.querySelectorAll('#mode-chips .chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active'); App.mode = chip.dataset.mode;
});
// Length chips
$('len-chips')?.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip'); if (!chip) return;
  document.querySelectorAll('#len-chips .chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active'); const v = chip.dataset.n;
  const lc = $('len-custom');
  if (v === 'custom') { if (lc) { lc.style.display = 'inline-block'; lc.focus(); } }
  else { if (lc) lc.style.display = 'none'; App.size = (v === 'all') ? 'all' : Number(v || 10); }
});
$('len-custom')?.addEventListener('input', () => {
  const lc = $('len-custom'); const n = parseInt((lc && lc.value) || '10', 10);
  App.size = isNaN(n) ? 10 : clamp(n, 1, 500);
});

// Filters
['filter-cat', 'filter-src'].forEach(id => $(id)?.addEventListener('change', (e) => {
  const k = id.split('-')[1]; App.filters[k] = e.target.value;
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
$('voiceSel')?.addEventListener('change', () => { Settings.voice = $('voiceSel').value; saveSettings(); });
$('rate')?.addEventListener('input', () => { Settings.rate = rate(); saveSettings(); });
$('testVoice')?.addEventListener('click', () => speakOnce("Pronunciation test: Yelü Abaoji, Sforza, Shapur, Tenochtitlan, Samarkand.", curVoice(), rate()));
['strictMode', 'autoAdvance', 'cueTicks', 'cueBeep', 'haptics'].forEach(id => $(id)?.addEventListener('change', () => {
  const el = $(id); if (!el) return;
  const key = id === 'strictMode' ? 'strict' : id;
  Settings[key] = el.checked; saveSettings();
}));
$('autoAdvanceDelay')?.addEventListener('input', () => {
  const el = $('autoAdvanceDelay'); Settings.autoAdvanceDelay = parseInt((el && el.value) || '1', 10) || 1; saveSettings();
});

$('startSession')?.addEventListener('click', startSession);
$('startLast')?.addEventListener('click', () => { const first = Object.values(Presets)[0]; if (first) { applyPreset(first); } startSession(); });

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
$('coach-search')?.addEventListener('input', renderCoachNotebook);
$('coach-filter')?.addEventListener('change', renderCoachNotebook);
$('coach-list')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.coach-toggle-mastered');
  if (!btn) return;
  const id = btn.dataset.attempt || '';
  const next = (btn.dataset.mastered || '0') !== '1';
  toggleCoachMastered(id, next);
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
  tb.innerHTML = ''; if (!set) return;
  const q = (($('lib-search') && $('lib-search').value) || '').toLowerCase();
  const fc = ($('lib-filter-cat') && $('lib-filter-cat').value) || '';
  const fe = ($('lib-filter-era') && $('lib-filter-era').value) || '';
  set.items.forEach((it, idx) => {
    if (q && !it.answer.toLowerCase().includes(q) && !it.question.toLowerCase().includes(q)) return;
    if (fc && (it.meta?.category || '') !== fc) return;
    if (fe && (it.meta?.era || '') !== fe) return;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class='stat'>${idx + 1}</td><td>${it.answer}</td><td>${(it.aliases || []).slice(0, 3).join(', ')}</td><td>${it.meta?.category || ''}</td><td>${getEraName(it.meta?.era || '')}</td><td>${it.meta?.source || ''}</td>`;
    tb.appendChild(tr);
  });
}

// Help overlay
function openHelp() { const ov = $('overlay'); if (ov) ov.classList.add('show'); }
$('openHelp')?.addEventListener('click', openHelp);
$('closeHelp')?.addEventListener('click', () => { const ov = $('overlay'); if (ov) ov.classList.remove('show'); });
$('overlay')?.addEventListener('click', (e) => { if (e.target && e.target.id === 'overlay') { const ov = $('overlay'); if (ov) ov.classList.remove('show'); } });

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
  if (e.key === '?') { e.preventDefault(); const ov = $('overlay'); if (ov?.classList.contains('show')) ov.classList.remove('show'); else openHelp(); return; }
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes((document.activeElement && document.activeElement.tagName) || '')) return;
  const vp = $('view-practice'); if (vp && vp.classList.contains('active')) {
    if (e.code === 'Space') { e.preventDefault(); buzz(); }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); markRight(); }
    if (e.key === 'w' || e.key === 'W') { e.preventDefault(); markWrong(); }
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); const nx = $('btn-next'); if (nx && !nx.disabled) nextQuestion(false); }
    if (e.key === 'l' || e.key === 'L') { e.preventDefault(); replayLast(); }
    if (e.key === 'c' || e.key === 'C') { e.preventDefault(); const b = $('btn-copy-answer'); if (b && !b.disabled) b.click(); }
  }
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
      if (parsed.type === 'library') {
        Library.sets = parsed.sets; Library.activeSetId = parsed.activeSetId || (parsed.sets[0]?.id || null);
        saveLibrary(); renderLibrarySelectors(); renderLibraryTable(); updateSetMeta();
        renderWrongBank();
        toast(`Loaded questions.json (${parsed.sets.length} sets)`);
        return true;
      }
      const set = parsed.set;
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
  refreshCoachNotebook(false);
  // Auto-load questions.json on startup (from build_db.py)
  if (!(ASSIGNMENT_ID && HAS_ASSIGNMENT_PAYLOAD)) {
    tryFetchDefault(false);
  }
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
  const userAns = (inputEl && inputEl.value) || '';

  const item = App.curItem || { question: '', answer: '', aliases: [] };
  const st = $('status'); if (st) st.textContent = 'Grading...';
  const clientAttemptId = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Fallback matcher
  const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const basicMatch = (u, gold, aliases) => {
    const nu = normalize(u), ng = normalize(gold);
    if (nu && nu === ng) return true;
    for (const a of (aliases || [])) if (nu === normalize(a)) return true;
    return false;
  };

  const coachLoadingText = 'Incorrect — building your coach micro-lesson...';
  let correct = false;
  let reason = '';
  try {
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
  } catch (e) {
    reason = 'Offline grading fallback used';
    correct = basicMatch(userAns, item.answer, item.aliases);
  }
  const quickCoach = fallbackCoachForItem(item, correct, reason);

  // Reveal canonical answer and finalize
  App.phase = 'answering';
  const ansText = Settings.strict ? `标准答案：${item.answer}` : `标准答案：${item.answer}${(item.aliases?.length ? `  (aliases: ${item.aliases.slice(0, 3).join(', ')})` : '')}`;
  const ans = $('answer'); if (ans) ans.textContent = ansText + (reason ? `  — ${correct ? '✓' : '✗'} ${reason}` : `  — ${correct ? '✓' : '✗'}`);
  const coachEl = $('coach-card');
  if (coachEl) coachEl.dataset.attempt = clientAttemptId;
  if (correct) {
    if (st) st.textContent = 'Correct.';
    renderCoachCard(quickCoach);
  } else {
    if (st) st.textContent = coachLoadingText;
    const loadingCoach = normalizeCoach({
      summary: 'Incorrect. Generating targeted DeepSeek coaching...',
      error_diagnosis: 'Analyzing your answer against the expected concept...',
      overlap_explainer: 'Preparing a focused misconception breakdown...',
      key_clues: ['Reviewing clues that disambiguate this question.', 'Generating timeline/region anchors.'],
      memory_hook: 'Building memory anchor...',
      next_check_question: 'Preparing concept-check...',
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

  const coachRecord = {
    client_attempt_id: clientAttemptId,
    client_session_id: String(App.sessionId || ''),
    question_id: String(item.id || ''),
    question_text: String(item.question || ''),
    expected_answer: String(item.answer || ''),
    user_answer: String(userAns || ''),
    correct: !!correct,
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

  if (correct) {
    playFeedbackCue('correct');
    App.correct++; App.resultsCorrect.push(true);
  } else {
    playFeedbackCue('wrong');
    srsAddWrong(item); App.resultsCorrect.push(false);
  }
  App.sessionBuzzTimes.push(App.buzzAt || 0);
  finishMark(correct);
  App.submitBusy = false;

  // Wrong answers get a second, separate coach request after grading is already returned.
  if (!correct) {
    const fetchCoachAsync = async () => {
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
        coachRecord.coach = finalCoach;
        coachRecord.focus_topic = String(finalCoach?.study_focus?.topic || '');
        upsertCoachLocal(coachRecord);
        syncCoachAttempt(coachRecord);

        const liveCoachEl = $('coach-card');
        if (liveCoachEl && liveCoachEl.dataset.attempt === clientAttemptId) {
          renderCoachCard(finalCoach);
          if (st) st.textContent = 'Incorrect — coach lesson ready.';
        }
      } catch (err) {
        const fallback = fallbackCoachForItem(item, correct, reason || 'Coach unavailable.');
        coachRecord.coach = fallback;
        coachRecord.focus_topic = String(fallback?.study_focus?.topic || '');
        upsertCoachLocal(coachRecord);
        syncCoachAttempt(coachRecord);
        const liveCoachEl = $('coach-card');
        if (liveCoachEl && liveCoachEl.dataset.attempt === clientAttemptId) {
          renderCoachCard(fallback);
          if (st) st.textContent = 'Incorrect — quick coaching shown (network issue).';
        }
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
      aliases: [],
      meta: { category: q.category || '', era: q.era || '' }
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
