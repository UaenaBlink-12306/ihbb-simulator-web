const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://laexxsgzldivvizwfjcn.supabase.co').trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();

function stringValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function json(res, statusCode, payload) {
  return res.status(statusCode).json(payload);
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

function assertConfigured() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const error = new Error('Feedback cleanup is not configured on this server.');
    error.statusCode = 503;
    throw error;
  }
}

function bearerToken(req) {
  const header = stringValue(req.headers?.authorization || req.headers?.Authorization);
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function fetchSupabase(pathname, searchParams = new URLSearchParams(), options = {}) {
  assertConfigured();
  const url = new URL(pathname, SUPABASE_URL);
  searchParams.forEach((value, key) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: options.authorization || `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=representation'
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
  return data;
}

async function getAuthenticatedUserId(req) {
  const token = bearerToken(req);
  if (!token) {
    const error = new Error('Please sign in again before deleting feedback.');
    error.statusCode = 401;
    throw error;
  }
  const user = await fetchSupabase('/auth/v1/user', new URLSearchParams(), {
    prefer: '',
    authorization: `Bearer ${token}`
  });
  const userId = stringValue(user?.id);
  if (!userId) {
    const error = new Error('Please sign in again before deleting feedback.');
    error.statusCode = 401;
    throw error;
  }
  return userId;
}

function assertFeedbackId(value) {
  const id = stringValue(value);
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(id)) {
    const error = new Error('A valid feedback ID is required.');
    error.statusCode = 400;
    throw error;
  }
  return id;
}

async function deleteResolvedFeedback(req, feedbackId) {
  const id = assertFeedbackId(feedbackId);
  const userId = await getAuthenticatedUserId(req);
  const lookupParams = new URLSearchParams();
  lookupParams.set('id', `eq.${id}`);
  lookupParams.set('select', 'id,user_id,status');
  lookupParams.set('limit', '1');
  const rows = await fetchSupabase('/rest/v1/app_feedback', lookupParams, { prefer: 'count=exact' });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || stringValue(row.user_id) !== userId) {
    const error = new Error('Feedback row not found.');
    error.statusCode = 404;
    throw error;
  }
  if (stringValue(row.status).toLowerCase() !== 'resolved') {
    const error = new Error('Only resolved feedback can be deleted from your history.');
    error.statusCode = 409;
    throw error;
  }

  const deleteParams = new URLSearchParams();
  deleteParams.set('id', `eq.${id}`);
  deleteParams.set('select', 'id');
  const deletedRows = await fetchSupabase('/rest/v1/app_feedback', deleteParams, {
    method: 'DELETE',
    prefer: 'return=representation'
  });
  return Array.isArray(deletedRows) ? deletedRows.length : 0;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed.' });
  }
  const body = await parseRequestBody(req);
  const action = stringValue(body.action).toLowerCase();
  try {
    if (action === 'delete_resolved') {
      const deleted = await deleteResolvedFeedback(req, body.id);
      return json(res, 200, { ok: true, deleted });
    }
    return json(res, 400, { error: 'Unknown feedback action.' });
  } catch (error) {
    return json(res, error.statusCode || 500, { error: error.message || 'Feedback action failed.' });
  }
};
