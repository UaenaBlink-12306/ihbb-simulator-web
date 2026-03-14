const crypto = require('crypto');

const {
  loadGeneratedModerationState,
  updateReviewStatus,
  approveAllGeneratedQuestions,
  getQuestionsJsonCount
} = require('../lib/generated-review-store');

const ADMIN_COOKIE = 'ihbb_admin_session';
const ADMIN_EMAIL = String(process.env.IHBB_ADMIN_EMAIL || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD_HASH = String(process.env.IHBB_ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD_HASH || '').trim();
const ADMIN_PASSWORD_PLAIN = String(process.env.IHBB_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '').trim();
const ADMIN_SESSION_SECRET = String(
  process.env.IHBB_ADMIN_SESSION_SECRET
  || process.env.ADMIN_SESSION_SECRET
  || process.env.ADMIN_PASSWORD_HASH
  || process.env.ADMIN_PASSWORD
  || ''
).trim();

const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://laexxsgzldivvizwfjcn.supabase.co').trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const APP_TABLES = [
  { name: 'profiles', orderBy: 'created_at.desc', limit: 200 },
  { name: 'classes', orderBy: 'created_at.desc', limit: 200 },
  { name: 'class_students', orderBy: 'joined_at.desc', limit: 200 },
  { name: 'assignments', orderBy: 'created_at.desc', limit: 200 },
  { name: 'assignment_submissions', orderBy: 'submitted_at.desc', limit: 200 },
  { name: 'user_wrong_questions', orderBy: 'created_at.desc', limit: 200 },
  { name: 'user_drill_sessions', orderBy: 'created_at.desc', limit: 200 },
  { name: 'user_coach_attempts', orderBy: 'created_at.desc', limit: 200 }
];

function stringValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function json(res, statusCode, payload, extraHeaders = {}) {
  Object.entries(extraHeaders || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) res.setHeader(key, value);
  });
  return res.status(statusCode).json(payload);
}

function toBase64Url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(input) {
  const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function signValue(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function createSessionToken(email) {
  const payload = {
    email,
    iat: Date.now(),
    exp: Date.now() + (SESSION_MAX_AGE_SECONDS * 1000)
  };
  const body = toBase64Url(JSON.stringify(payload));
  const signature = signValue(body, ADMIN_SESSION_SECRET);
  return `${body}.${signature}`;
}

function verifySessionToken(token) {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature || !ADMIN_SESSION_SECRET) return null;
  const expected = signValue(body, ADMIN_SESSION_SECRET);
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (sigBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(fromBase64Url(body));
    if (!payload?.exp || Number(payload.exp) < Date.now()) return null;
    if (String(payload.email || '').trim().toLowerCase() !== ADMIN_EMAIL) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = String(req.headers?.cookie || '');
  return header.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.split('=');
    const name = stringValue(key);
    if (!name) return acc;
    acc[name] = decodeURIComponent(rest.join('=') || '');
    return acc;
  }, {});
}

function isSecureRequest(req) {
  const proto = stringValue(req.headers['x-forwarded-proto']).toLowerCase();
  return proto === 'https';
}

function buildCookie(token, req, maxAgeSeconds = SESSION_MAX_AGE_SECONDS) {
  const parts = [
    `${ADMIN_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, maxAgeSeconds)}`
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

function adminConfigured() {
  return Boolean(ADMIN_EMAIL && ADMIN_SESSION_SECRET && (ADMIN_PASSWORD_HASH || ADMIN_PASSWORD_PLAIN));
}

function constantCompare(a, b) {
  const aBuf = Buffer.from(String(a || ''));
  const bBuf = Buffer.from(String(b || ''));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function verifyPassword(password) {
  const candidate = String(password || '');
  if (ADMIN_PASSWORD_HASH.startsWith('pbkdf2$')) {
    const [, iterationsText, saltText, expectedText] = ADMIN_PASSWORD_HASH.split('$');
    const iterations = Number.parseInt(iterationsText, 10) || 210000;
    const derived = crypto.pbkdf2Sync(candidate, saltText, iterations, 32, 'sha256').toString('base64url');
    return constantCompare(derived, expectedText);
  }
  if (ADMIN_PASSWORD_HASH) {
    return constantCompare(candidate, ADMIN_PASSWORD_HASH);
  }
  return ADMIN_PASSWORD_PLAIN ? constantCompare(candidate, ADMIN_PASSWORD_PLAIN) : false;
}

function getAuthenticatedAdmin(req) {
  const cookies = parseCookies(req);
  const payload = verifySessionToken(cookies[ADMIN_COOKIE]);
  return payload?.email || '';
}

async function parseRequestBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch {}
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function fetchSupabaseJson(pathname, searchParams = new URLSearchParams(), options = {}) {
  if (!SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_URL) {
    throw new Error('Supabase service role is not configured.');
  }
  const url = new URL(pathname, SUPABASE_URL);
  searchParams.forEach((value, key) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'count=exact',
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const error = new Error(data?.msg || data?.message || text || `${pathname} failed`);
    error.statusCode = response.status;
    throw error;
  }
  return {
    data,
    headers: response.headers
  };
}

async function fetchTableSnapshot(config) {
  const params = new URLSearchParams();
  params.set('select', '*');
  params.set('limit', String(config.limit || 200));
  if (config.orderBy) params.set('order', config.orderBy);
  const result = await fetchSupabaseJson(`/rest/v1/${config.name}`, params);
  const contentRange = result.headers.get('content-range') || '';
  const total = Number.parseInt((contentRange.split('/')[1] || ''), 10);
  return {
    name: config.name,
    count: Number.isFinite(total) ? total : (Array.isArray(result.data) ? result.data.length : 0),
    rows: Array.isArray(result.data) ? result.data : []
  };
}

async function fetchAuthUsers() {
  const users = [];
  let page = 1;
  while (page <= 5) {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('per_page', '200');
    const result = await fetchSupabaseJson('/auth/v1/admin/users', params, { prefer: '' });
    const pageUsers = Array.isArray(result.data?.users) ? result.data.users : [];
    users.push(...pageUsers);
    if (!pageUsers.length || pageUsers.length < 200) break;
    page += 1;
  }
  return users;
}

function countBy(rows, key) {
  const map = new Map();
  for (const row of (rows || [])) {
    const name = stringValue(row?.[key]);
    if (!name) continue;
    map.set(name, (map.get(name) || 0) + 1);
  }
  return map;
}

function buildUserDirectory(authUsers, tables) {
  const byTableName = Object.fromEntries((tables || []).map((table) => [table.name, table.rows || []]));
  const profiles = Array.isArray(byTableName.profiles) ? byTableName.profiles : [];
  const membershipsByStudent = countBy(byTableName.class_students, 'student_id');
  const classesByTeacher = countBy(byTableName.classes, 'teacher_id');
  const submissionsByStudent = countBy(byTableName.assignment_submissions, 'student_id');
  const wrongByUser = countBy(byTableName.user_wrong_questions, 'user_id');
  const sessionsByUser = countBy(byTableName.user_drill_sessions, 'user_id');
  const coachByUser = countBy(byTableName.user_coach_attempts, 'user_id');
  const profileById = new Map(profiles.map((profile) => [stringValue(profile.id), profile]));
  const users = [];
  const seen = new Set();
  for (const authUser of (authUsers || [])) {
    const id = stringValue(authUser.id);
    const profile = profileById.get(id) || {};
    if (id) seen.add(id);
    users.push({
      id,
      email: stringValue(authUser.email),
      email_confirmed_at: stringValue(authUser.email_confirmed_at),
      created_at: stringValue(authUser.created_at),
      last_sign_in_at: stringValue(authUser.last_sign_in_at),
      role: stringValue(profile.role),
      display_name: stringValue(profile.display_name),
      class_code: stringValue(profile.class_code),
      profile_created_at: stringValue(profile.created_at),
      joined_classes: membershipsByStudent.get(id) || 0,
      owned_classes: classesByTeacher.get(id) || 0,
      assignment_submissions: submissionsByStudent.get(id) || 0,
      wrong_bank_rows: wrongByUser.get(id) || 0,
      drill_sessions: sessionsByUser.get(id) || 0,
      coach_attempts: coachByUser.get(id) || 0
    });
  }
  for (const profile of profiles) {
    const id = stringValue(profile.id);
    if (!id || seen.has(id)) continue;
    users.push({
      id,
      email: '',
      email_confirmed_at: '',
      created_at: '',
      last_sign_in_at: '',
      role: stringValue(profile.role),
      display_name: stringValue(profile.display_name),
      class_code: stringValue(profile.class_code),
      profile_created_at: stringValue(profile.created_at),
      joined_classes: membershipsByStudent.get(id) || 0,
      owned_classes: classesByTeacher.get(id) || 0,
      assignment_submissions: submissionsByStudent.get(id) || 0,
      wrong_bank_rows: wrongByUser.get(id) || 0,
      drill_sessions: sessionsByUser.get(id) || 0,
      coach_attempts: coachByUser.get(id) || 0
    });
  }
  return users.sort((a, b) => String(a.email || a.display_name || a.id).localeCompare(String(b.email || b.display_name || b.id)));
}

async function fetchDatabaseSnapshot() {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return {
      service_role_configured: false,
      warnings: ['Set SUPABASE_SERVICE_ROLE_KEY in the server environment to unlock the full database browser and auth user list.'],
      auth_users: [],
      users: [],
      tables: []
    };
  }
  const warnings = [];
  const tableResults = [];
  for (const tableConfig of APP_TABLES) {
    try {
      tableResults.push(await fetchTableSnapshot(tableConfig));
    } catch (error) {
      warnings.push(`${tableConfig.name}: ${error.message}`);
    }
  }
  let authUsers = [];
  try {
    authUsers = await fetchAuthUsers();
  } catch (error) {
    warnings.push(`auth.users: ${error.message}`);
  }
  return {
    service_role_configured: true,
    warnings,
    auth_users: authUsers,
    users: buildUserDirectory(authUsers, tableResults),
    tables: tableResults
  };
}

async function buildAdminData() {
  const generatedState = await loadGeneratedModerationState();
  const questionsTotal = await getQuestionsJsonCount();
  const database = await fetchDatabaseSnapshot();
  const generatedRecords = generatedState.records;
  const pendingCount = generatedRecords.filter((item) => item.review_status === 'pending').length;
  return {
    config: {
      admin_configured: adminConfigured(),
      service_role_configured: database.service_role_configured,
      admin_email: ADMIN_EMAIL
    },
    summary: {
      generated_total: generatedRecords.length,
      generated_pending: pendingCount,
      questions_total: questionsTotal,
      auth_users_total: database.auth_users.length,
      surfaced_users_total: database.users.length
    },
    generated: generatedRecords,
    users: database.users,
    database
  };
}

module.exports = async function handler(req, res) {
  const action = stringValue(req.query?.action || req.body?.action || '').toLowerCase();
  if (req.method === 'GET') {
    if (action === 'data') {
      const email = getAuthenticatedAdmin(req);
      if (!email) return json(res, 401, { error: 'Admin session required.' });
      return json(res, 200, await buildAdminData());
    }
    return json(res, 200, {
      authenticated: Boolean(getAuthenticatedAdmin(req)),
      config: {
        admin_configured: adminConfigured(),
        service_role_configured: Boolean(SUPABASE_SERVICE_ROLE_KEY),
        admin_email: ADMIN_EMAIL
      }
    });
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed.' });
  }

  const body = await parseRequestBody(req);
  const postAction = stringValue(body.action).toLowerCase();

  if (postAction === 'login') {
    if (!adminConfigured()) {
      return json(res, 503, { error: 'Admin login is not configured on this server.' });
    }
    const email = stringValue(body.email).toLowerCase();
    const password = stringValue(body.password);
    if (email !== ADMIN_EMAIL || !verifyPassword(password)) {
      return json(res, 401, { error: 'Invalid admin credentials.' });
    }
    const token = createSessionToken(email);
    return json(
      res,
      200,
      {
        ok: true,
        authenticated: true,
        config: {
          admin_configured: true,
          service_role_configured: Boolean(SUPABASE_SERVICE_ROLE_KEY),
          admin_email: ADMIN_EMAIL
        }
      },
      { 'Set-Cookie': buildCookie(token, req) }
    );
  }

  if (postAction === 'logout') {
    return json(res, 200, { ok: true }, { 'Set-Cookie': buildCookie('', req, 0) });
  }

  const email = getAuthenticatedAdmin(req);
  if (!email) return json(res, 401, { error: 'Admin session required.' });

  if (postAction === 'approve') {
    const state = await updateReviewStatus('approve', body.id);
    return json(res, 200, {
      ok: true,
      generated: state.records,
      pending: state.records.filter((item) => item.review_status === 'pending').length
    });
  }

  if (postAction === 'delete') {
    const state = await updateReviewStatus('delete', body.id);
    return json(res, 200, {
      ok: true,
      generated: state.records,
      pending: state.records.filter((item) => item.review_status === 'pending').length
    });
  }

  if (postAction === 'approve_all') {
    const result = await approveAllGeneratedQuestions();
    return json(res, 200, {
      ok: true,
      changed: result.changed,
      generated: result.state.records,
      pending: result.state.records.filter((item) => item.review_status === 'pending').length
    });
  }

  return json(res, 400, { error: 'Unknown admin action.' });
};
