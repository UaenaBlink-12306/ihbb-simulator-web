'use strict';

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function providerError(code, retryable = false) {
  return Object.assign(new Error('DeepSeek could not complete the request.'), { code, retryable });
}

function parseContent(content) {
  const text = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  try { return start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : null; } catch { return null; }
}

async function requestDeepSeekJson(payload, { validate, timeoutMs = 12000 } = {}) {
  // Two provider attempts at most, including malformed/empty JSON responses.
  // The body deadline also covers DeepSeek's whitespace keep-alive responses.
  let jsonMode = true;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const body = { ...payload };
          if (!jsonMode) {
            delete body.response_format;
            body.max_tokens = Math.min(4096, (Number(payload.max_tokens) || 300) * 2);
          }
          const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
            body: JSON.stringify(body), signal: controller.signal
          });
          if (!response.ok) {
            const error = providerError(`PROVIDER_HTTP_${response.status}`, RETRYABLE_STATUS.has(response.status));
            const retryAfter = response.headers.get('Retry-After');
            error.retryAfterMs = retryAfter
              ? (/^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now()))
              : 0;
            await response.body?.cancel();
            throw error;
          }
          let data;
          try { data = await response.json(); } catch { throw providerError('PROVIDER_INVALID_JSON', true); }
          const parsed = parseContent(data?.choices?.[0]?.message?.content);
          if (!parsed || (validate && !validate(parsed))) throw providerError('PROVIDER_INVALID_JSON', true);
          return parsed;
        })(),
        new Promise((resolve, reject) => {
          timer = setTimeout(() => {
            reject(providerError('PROVIDER_TIMEOUT', true));
            controller.abort();
          }, timeoutMs);
        })
      ]);
    } catch (error) {
      const retryable = error.retryable || error instanceof TypeError || error.name === 'AbortError';
      // Never retry bad keys, balance errors, or invalid request parameters.
      if (!retryable || attempt === 1) throw error;
      if (error.code === 'PROVIDER_INVALID_JSON') jsonMode = false;
      const delay = Math.max(error.retryAfterMs || 0, 500 + Math.random() * 250);
      // A long provider cooldown cannot fit within the server's 60-second budget.
      if (delay > 2000) throw error;
      clearTimeout(timer);
      await new Promise(resolve => setTimeout(resolve, delay));
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { requestDeepSeekJson };
