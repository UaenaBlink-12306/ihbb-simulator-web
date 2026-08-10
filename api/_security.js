'use strict';

const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '');
const SUPABASE_AUTH_KEY = String(
  process.env.SUPABASE_PUBLISHABLE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || ''
).trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();

function sendError(res, status, error, extra = {}) {
  res.status(status).json({ error, ...extra });
  return null;
}

function headerValue(req, name) {
  const value = req?.headers?.[name] ?? req?.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? String(value[0] || '').trim() : String(value || '').trim();
}

function bearerToken(req) {
  const match = headerValue(req, 'authorization').match(/^Bearer\s+(.+)$/i);
  return String(match?.[1] || '').trim();
}

function clientIp(req) {
  return headerValue(req, 'x-forwarded-for').split(',')[0].trim()
    || headerValue(req, 'x-real-ip')
    || String(req?.socket?.remoteAddress || '').trim()
    || 'unknown';
}

function bodySize(req) {
  const declared = Number.parseInt(headerValue(req, 'content-length'), 10);
  if (Number.isFinite(declared) && declared >= 0) return declared;
  try {
    return Buffer.byteLength(typeof req?.body === 'string' ? req.body : JSON.stringify(req?.body || {}), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

async function parseJsonResponse(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

async function authenticateRequest(req) {
  const token = bearerToken(req);
  if (!token) return { error: 'Authentication required.', status: 401 };
  if (!SUPABASE_URL || !SUPABASE_AUTH_KEY) return { error: 'Authentication is not configured.', status: 503 };
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_AUTH_KEY, Authorization: `Bearer ${token}` }
    });
  } catch {
    return { error: 'Authentication service is unavailable.', status: 503 };
  }
  const user = await parseJsonResponse(response);
  if (!response.ok || !user?.id) return { error: 'Authentication required.', status: 401 };
  return { user, token };
}

async function fetchProfileRole(userId) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return '';
  const url = new URL(`${SUPABASE_URL}/rest/v1/profiles`);
  url.searchParams.set('id', `eq.${userId}`);
  url.searchParams.set('select', 'role');
  url.searchParams.set('limit', '1');
  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  const rows = await parseJsonResponse(response);
  if (!response.ok) return '';
  return String(Array.isArray(rows) ? rows[0]?.role : '').trim().toLowerCase();
}

async function consumeRateLimit(bucket, subject, limit, windowSeconds) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return { allowed: false, unavailable: true };
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/consume_security_rate_limit`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_bucket: String(bucket || '').slice(0, 80),
        p_subject: String(subject || '').slice(0, 160),
        p_limit: Math.max(1, Math.min(10000, Number(limit) || 1)),
        p_window_seconds: Math.max(1, Math.min(86400, Number(windowSeconds) || 60))
      })
    });
  } catch {
    return { allowed: false, unavailable: true };
  }
  const value = await parseJsonResponse(response);
  if (!response.ok) return { allowed: false, unavailable: true };
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row.allowed !== 'boolean') return { allowed: false, unavailable: true };
  return {
    allowed: row.allowed,
    retryAfterSeconds: Math.max(1, Number(row.retry_after_seconds) || windowSeconds)
  };
}

async function requireAiAccess(req, res, options = {}) {
  const maxBodyBytes = Math.max(1024, Number(options.maxBodyBytes) || 131072);
  if (bodySize(req) > maxBodyBytes) return sendError(res, 413, 'Request body is too large.');
  const auth = await authenticateRequest(req);
  if (auth.error) return sendError(res, auth.status, auth.error);
  if (options.teacherOnly) {
    const role = await fetchProfileRole(auth.user.id);
    if (role !== 'teacher') return sendError(res, 403, 'Teacher access required.');
  }
  const quota = await consumeRateLimit(
    `ai:${String(options.endpoint || 'unknown')}`,
    auth.user.id,
    Number(options.limit) || 60,
    Number(options.windowSeconds) || 3600
  );
  if (quota.unavailable) return sendError(res, 503, 'AI quota enforcement is unavailable.');
  if (!quota.allowed) return sendError(res, 429, 'AI request quota exceeded.', { retry_after_seconds: quota.retryAfterSeconds });
  return auth;
}

module.exports = {
  authenticateRequest,
  bearerToken,
  bodySize,
  clientIp,
  consumeRateLimit,
  requireAiAccess
};
