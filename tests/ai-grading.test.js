'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { requestGrade } = require('../lib/client-security');
const { requestDeepSeekJson } = require('../api/_deepseek');
const { authenticateRequest } = require('../api/_security');

const client = () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) } });
const answer = { question: 'Who founded the Mongol Empire?', expected: 'Genghis Khan', user_answer: 'Genghis Khan', client_attempt_id: 'stable-attempt' };
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
const completion = value => json({ choices: [{ message: { content: JSON.stringify(value) } }] });
const options = { retryDelayMs: 0 };

test('a dropped browser request retries the same answer and attempt with authentication', async t => {
  const requests = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    requests.push({ url, init });
    if (requests.length === 1) throw new TypeError('Failed to fetch');
    return json({ correct: true, source: 'deepseek' });
  });
  let retries = 0;
  const result = await requestGrade(client(), answer, { ...options, onRetry: () => retries++ });
  assert.equal(result.correct, true);
  assert.equal(requests.length, 2);
  assert.equal(retries, 1);
  assert.equal(requests[0].init.body, requests[1].init.body);
  assert.equal(requests[1].init.headers.get('Authorization'), 'Bearer test-token');
});

test('temporary HTTP failures and incomplete grades recover without treating missing verdicts as wrong', async t => {
  const responses = [json({ error: 'temporary' }, 503), json({ reason: 'incomplete' }), json({ correct: true })];
  t.mock.method(global, 'fetch', async () => responses.shift());
  assert.equal((await requestGrade(client(), answer, options)).correct, true);
  assert.equal(responses.length, 0);
});

test('truncated browser JSON retries', async t => {
  let calls = 0;
  t.mock.method(global, 'fetch', async () => ++calls === 1 ? new Response('{"correct":') : json({ correct: true }));
  assert.equal((await requestGrade(client(), answer, options)).correct, true);
  assert.equal(calls, 2);
});

test('stalled response body is aborted and recovered within the request deadline', async t => {
  let calls = 0;
  let signal;
  t.mock.method(global, 'fetch', async (url, init) => {
    if (++calls > 1) return json({ correct: true });
    signal = init.signal;
    return { ok: true, json: () => new Promise(() => {}) };
  });
  assert.equal((await requestGrade(client(), answer, { ...options, attemptTimeoutMs: 15 })).correct, true);
  assert.equal(signal.aborted, true);
  assert.equal(calls, 2);
});

test('stalled session lookup cannot leave grading waiting forever', async t => {
  let lookups = 0;
  let calls = 0;
  const authClient = client();
  authClient.auth.getSession = () => ++lookups === 1 ? new Promise(() => {}) : Promise.resolve({ data: { session: { access_token: 'test-token' } } });
  t.mock.method(global, 'fetch', async () => { calls++; return json({ correct: true }); });
  assert.equal((await requestGrade(authClient, answer, { ...options, attemptTimeoutMs: 15 })).correct, true);
  assert.equal(calls, 1);
});

test('a 401 refreshes the session once and sends the new access token', async t => {
  const authClient = client();
  let token = 'expired';
  let refreshes = 0;
  let calls = 0;
  authClient.auth.getSession = async () => ({ data: { session: { access_token: token } } });
  authClient.auth.refreshSession = async () => { refreshes++; token = 'renewed'; return { error: null }; };
  t.mock.method(global, 'fetch', async (url, init) => {
    calls++;
    return init.headers.get('Authorization') === 'Bearer expired' ? json({}, 401) : json({ correct: true });
  });
  assert.equal((await requestGrade(authClient, answer, options)).correct, true);
  assert.equal(refreshes, 1);
  assert.equal(calls, 2);
});

test('rejected credentials, quota and bad requests do not cause retry storms', async t => {
  for (const status of [400, 401, 403, 413, 429]) {
    let calls = 0;
    const mock = t.mock.method(global, 'fetch', async () => { calls++; return json({}, status); });
    await assert.rejects(requestGrade(client(), answer, options));
    assert.equal(calls, 1, String(status));
    mock.mock.restore();
  }
});

test('permanent outages stop after three browser attempts; server fallbacks are not retried', async t => {
  let calls = 0;
  const mock = t.mock.method(global, 'fetch', async () => { calls++; throw new TypeError('NetworkError'); });
  await assert.rejects(requestGrade(client(), answer, options));
  assert.equal(calls, 3);
  mock.mock.restore();
  calls = 0;
  t.mock.method(global, 'fetch', async () => { calls++; return json({ correct: false, source: 'fallback' }); });
  assert.equal((await requestGrade(client(), answer, options)).source, 'fallback');
  assert.equal(calls, 1);
});

test('long Retry-After stops retries that cannot fit in the overall deadline', async t => {
  let calls = 0;
  t.mock.method(global, 'fetch', async () => { calls++; return json({}, 503, { 'Retry-After': '120' }); });
  await assert.rejects(requestGrade(client(), answer, options));
  assert.equal(calls, 1);
});

test('provider overload retries, but key and balance errors stop immediately', async t => {
  for (const status of [429, 500, 503, 401, 402, 422]) {
    let calls = 0;
    const mock = t.mock.method(global, 'fetch', async () => ++calls === 1 ? json({}, status) : completion({ correct: true }));
    if ([429, 500, 503].includes(status)) {
      assert.equal((await requestDeepSeekJson({}, { validate: x => typeof x.correct === 'boolean' })).correct, true);
      assert.equal(calls, 2);
    } else {
      await assert.rejects(requestDeepSeekJson({}), { code: `PROVIDER_HTTP_${status}` });
      assert.equal(calls, 1);
    }
    mock.mock.restore();
  }
});

test('empty or invalid provider JSON retries without JSON mode and validates verdict shape', async t => {
  const bodies = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return completion(bodies.length === 1 ? { correct: 'false' } : { correct: false });
  });
  const result = await requestDeepSeekJson({ response_format: { type: 'json_object' } }, { validate: x => typeof x.correct === 'boolean' });
  assert.equal(result.correct, false);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].response_format, undefined);
});

test('provider body timeout aborts the original connection and retries only once', async t => {
  let calls = 0;
  const signals = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    signals.push(init.signal);
    calls++;
    return { ok: true, json: () => new Promise(() => {}) };
  });
  await assert.rejects(requestDeepSeekJson({}, { timeoutMs: 15 }), { code: 'PROVIDER_TIMEOUT' });
  assert.equal(calls, 2);
  assert.ok(signals.every(signal => signal.aborted));
});

test('auth service overload stays retryable instead of impersonating an expired sign-in', async t => {
  t.mock.method(global, 'fetch', async () => json({}, 503));
  const result = await authenticateRequest({ headers: { authorization: 'Bearer test-token' } });
  assert.equal(result.status, 503);
});

function configSession(error) {
  const deleted = [];
  const storage = { length: 1, key: () => 'sb-project-auth-token', removeItem: key => deleted.push(key), setItem() {} };
  const window = { localStorage: storage, sessionStorage: storage, supabase: { createClient: () => ({ auth: { getSession: async () => ({ error }) } }) } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../config.js'), 'utf8'), { window, console: { warn() {} }, TypeError });
  return { window, deleted };
}

test('temporary session lookup failures preserve saved sign-in; invalid refresh tokens still clear it', async () => {
  const network = configSession(Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError' }));
  const result = await network.window.supabaseClient.auth.getSession();
  assert.equal(result.error.retryable, true);
  assert.equal(network.deleted.length, 0);
  const invalid = configSession(new Error('Invalid refresh token'));
  assert.equal((await invalid.window.supabaseClient.auth.getSession()).data.session, null);
  assert.ok(invalid.deleted.length > 0);
});

test('grade handler labels provider fallbacks and preserves a locked coaching verdict', async () => {
  let providerCalls = 0;
  const sandbox = { module: { exports: {} }, process: { env: { DEEPSEEK_API_KEY: 'fixture-only' } }, console: { warn() {} },
    require: name => name === './_security' ? { requireAiAccess: async () => ({ user: { id: 'fixture-user' } }) }
      : { requestDeepSeekJson: async () => { providerCalls++; throw Object.assign(new Error('unavailable'), { code: 'PROVIDER_TIMEOUT' }); } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../api/grade.js'), 'utf8'), sandbox);
  let output;
  const response = { status(code) { assert.equal(code, 200); return this; }, json(value) { output = value; } };
  await sandbox.module.exports({ method: 'POST', body: answer }, response);
  assert.equal(output.correct, true);
  assert.equal(output.source, 'fallback');
  assert.equal(output.fallback_code, 'PROVIDER_TIMEOUT');
  await sandbox.module.exports({ method: 'POST', body: { ...answer, coach_enabled: true, coach_only: true, correct: false, reason: 'Prior AI verdict' } }, response);
  assert.equal(output.correct, false);
  assert.equal(output.reason, 'Prior AI verdict');
  assert.equal(output.source, 'fallback');
  assert.ok(output.coach);
  assert.equal(providerCalls, 2);
});
